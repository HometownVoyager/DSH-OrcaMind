#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""stepfpga-mcp —— 小脚丫 STEP-MAX10 / STEP BaseBoard V4.0 专用 MCP server (stdio)

设计原则（沿用 WEFT / quartus_mcp_server 的经验，但贴合本机 18.1）：
  * 只暴露少量高信息密度工具，返回结构化摘要，不倒 MB 级 .rpt 全文
  * 所有路径解析到工作区根之内，拒绝路径逃逸
  * 板卡知识来自 data/board.yaml 与 data/experiments.yaml，绝不硬编码猜测
  * 编译/仿真是耗时操作：同步执行并给出结构化结论（DSH 侧 toolCallTimeoutMs 已放宽）

环境变量（由 bundle 的 cordis.patch.yml 注入）：
  STEPFPGA_WORKSPACE   工作区根（默认 D:/Study/Quartus）
  STEPFPGA_QUARTUS_DIR  quartus/bin64 目录
  STEPFPGA_MODELSIM_DIR modelsim_ase/win32aloem 目录
  STEPFPGA_DOCS_DIR     资料目录（默认 <workspace>/STEP FPGA）
  STEPFPGA_DATA_DIR     bundle 的 data/ 目录（含 board.yaml / experiments.yaml）
  STEPFPGA_PROJECTS_DIR 工程根目录（默认 <workspace>/projects）
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import yaml
from mcp.server.mcpserver import MCPServer
from mcp.types import ImageContent, TextContent

# ── 环境 ────────────────────────────────────────────────────────────────
WORKSPACE = Path(os.environ.get("STEPFPGA_WORKSPACE", r"D:/Study/Quartus")).resolve()
QUARTUS_DIR = Path(os.environ.get(
    "STEPFPGA_QUARTUS_DIR", str(WORKSPACE / "quartus" / "bin64"))).resolve()
MODELSIM_DIR = Path(os.environ.get(
    "STEPFPGA_MODELSIM_DIR", str(WORKSPACE / "modelsim_ase" / "win32aloem"))).resolve()
DOCS_DIR = Path(os.environ.get("STEPFPGA_DOCS_DIR", str(WORKSPACE / "STEP FPGA"))).resolve()
DATA_DIR = Path(os.environ.get(
    "STEPFPGA_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data"))).resolve()
PROJECTS_DIR = Path(os.environ.get(
    "STEPFPGA_PROJECTS_DIR", str(WORKSPACE / "projects"))).resolve()

BOARD = yaml.safe_load((DATA_DIR / "board.yaml").read_text(encoding="utf-8"))
EXPS = yaml.safe_load((DATA_DIR / "experiments.yaml").read_text(encoding="utf-8"))
MANUAL = DOCS_DIR / "V4.0" / EXPS["manual"]["file"].split("/")[-1]

mcp = MCPServer(
    name="stepfpga",
    title="STEP FPGA 实验平台",
    description="小脚丫 STEP-MAX10 + BaseBoard V4.0 的板卡知识、Quartus 18.1 编译流与 ModelSim 仿真",
    instructions=(
        "你是 STEP FPGA 实验助手。先用 get_toolchain / get_board_info / list_experiments 建立事实，"
        "再用 create_project → write_source → set_assignments → compile → get_report 闭环。"
        "引脚与器件以 board.yaml 为准，不要臆造；编译失败先 get_report 再改代码。"
    ),
)

# ── 工具辅助 ────────────────────────────────────────────────────────────
def _txt(obj: Any) -> str:
    if isinstance(obj, str):
        return obj
    return json.dumps(obj, ensure_ascii=False, indent=2)


def _result(obj: Any) -> list:
    return [TextContent(type="text", text=_txt(obj))]


def _safe(rel: str, *, must_exist: bool = False, root: Path = WORKSPACE) -> Path | None:
    """把用户给的路径解析到 root 之内；拒绝绝对路径或 .. 逃逸。"""
    try:
        p = (root / rel).resolve()
        p.relative_to(root)
        if must_exist and not p.exists():
            return None
        return p
    except (ValueError, OSError):
        return None


def _run(argv: list[str], cwd: Path | None = None, timeout: int = 900) -> dict:
    """同步执行本机工具链命令，返回结构化结果（stdout/stderr 均截断）。"""
    t0 = time.time()
    try:
        cp = subprocess.run(
            [str(a) for a in argv], cwd=str(cwd or WORKSPACE),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout,
        )
        return {
            "ok": cp.returncode == 0,
            "exitCode": cp.returncode,
            "elapsedSec": round(time.time() - t0, 1),
            "command": " ".join(str(a) for a in argv),
            "stdoutTail": (cp.stdout or "")[-6000:],
            "stderrTail": (cp.stderr or "")[-3000:],
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "timedOut": True, "timeoutSec": timeout,
                "elapsedSec": round(time.time() - t0, 1),
                "command": " ".join(str(a) for a in argv)}
    except FileNotFoundError as e:
        return {"ok": False, "error": f"可执行文件不存在: {e}", "command": " ".join(str(a) for a in argv)}
    except Exception as e:  # noqa: BLE001 - 返回给模型诊断
        return {"ok": False, "error": repr(e)}


def _exe(name: str) -> str:
    """Quartus/ModelSim exe 路径（Windows 自动补 .exe）。"""
    p = QUARTUS_DIR / name
    if p.exists():
        return str(p)
    p2 = MODELSIM_DIR / name
    if p2.exists():
        return str(p2)
    return name


def _quartus_ok(binary: str) -> bool:
    return (QUARTUS_DIR / binary).exists() or (QUARTUS_DIR / (binary + ".exe")).exists()


def _project_dir(project: str) -> Path | None:
    return _safe(f"projects/{project}", must_exist=True, root=WORKSPACE)


# 编译互斥锁：同一工程同时只允许一个编译任务（Quartus db/ 不支持并发）
_COMPILE_LOCKS: dict[str, threading.Lock] = {}
_LOCK_GUARD = threading.Lock()


def _compile_lock(project: str) -> threading.Lock:
    with _LOCK_GUARD:
        return _COMPILE_LOCKS.setdefault(project, threading.Lock())


# ── 1. 工具链自检 ───────────────────────────────────────────────────────
@mcp.tool(description="自检本机 Quartus 18.1 / ModelSim ASE / 资料与数据文件是否可用。开工前先调用。")
def get_toolchain() -> list:
    # MAX 10 器件库：Quartus 18.1 Lite 默认安装可能缺 devinfo/55nm，
    # 缺了会报 Error (20004) family "MAX 10" not installed，必须显式自检。
    max10_devinfo = (QUARTUS_DIR.parent / "common" / "devinfo" / "55nm")
    # .ddb 器件库文件散布在 55nm/ 的子目录（如 zb8_non_vr_analog/），必须递归查。
    max10_ok = max10_devinfo.is_dir() and any(max10_devinfo.rglob("*.ddb"))
    checks = {
        "max10_devinfo_55nm": max10_ok,
        "quartus_sh": _quartus_ok("quartus_sh.exe"),
        "quartus_map": _quartus_ok("quartus_map.exe"),
        "quartus_fit": _quartus_ok("quartus_fit.exe"),
        "quartus_asm": _quartus_ok("quartus_asm.exe"),
        "quartus_sta": _quartus_ok("quartus_sta.exe"),
        "quartus_pgm": _quartus_ok("quartus_pgm.exe"),
        "jtagconfig": _quartus_ok("jtagconfig.exe"),
        "vlog": (MODELSIM_DIR / "vlog.exe").exists(),
        "vsim": (MODELSIM_DIR / "vsim.exe").exists(),
        "manual_pdf": MANUAL.exists(),
        "board_yaml": (DATA_DIR / "board.yaml").exists(),
        "experiments_yaml": (DATA_DIR / "experiments.yaml").exists(),
    }
    ver = _run([_exe("quartus_sh.exe"), "-v"], timeout=30)
    version = ""
    m = re.search(r"Version\s+([\d.]+\s+Build\s+\d+[^\r\n]*)", ver.get("stdoutTail", ""))
    if m:
        version = m.group(1).strip()
    all_ok = all(checks.values())
    return _result({
        "ok": all_ok, "version": version, "workspace": str(WORKSPACE),
        "quartusDir": str(QUARTUS_DIR), "modelsimDir": str(MODELSIM_DIR),
        "docsDir": str(DOCS_DIR), "dataDir": str(DATA_DIR),
        "projectsDir": str(PROJECTS_DIR), "manual": str(MANUAL),
        "checks": checks,
        "max10DevinfoDir": str(max10_devinfo),
        "hint": ("全为 true 即可开工。若 max10_devinfo_55nm 为 false，编译会报 Error(20004)："
                 "从安装包 components/max10-18.1.0.625.qdz 解压到 quartus/common/devinfo/55nm/；"
                 "vlog/vsim 为 false 只影响仿真"),
    })


# ── 2. 板卡信息 ─────────────────────────────────────────────────────────
@mcp.tool(description="查询 STEP-MAX10 / BaseBoard V4.0 的器件、12MHz 时钟、引脚表、外设与约束模板。section 可选 board/onboard/header/peripherals/templates/constraints/all；name 可进一步筛选单个信号或外设。")
def get_board_info(section: str = "all", name: str = "") -> list:
    sec = section.lower()
    mapping = {
        "board": {"board": BOARD["board"]},
        "onboard": {"onboard": BOARD["onboard"]},
        "header": {"baseboard_header": BOARD["baseboard_header"]},
        "peripherals": {"peripherals": BOARD["peripherals"]},
        "templates": {"assignment_templates": BOARD["assignment_templates"]},
        "constraints": {"constraints": BOARD["constraints"]},
    }
    if sec == "all":
        data: dict = {k: BOARD[k] for k in BOARD}
    elif sec in mapping:
        data = mapping[sec]
    else:
        return _result({"error": f"未知 section: {section}", "available": list(mapping) + ["all"]})
    if name:
        hit = {}
        for group, val in data.items():
            if isinstance(val, dict):
                for k, v in val.items():
                    if name.lower() in str(k).lower():
                        hit.setdefault(group, {})[k] = v
        data = hit or {"note": f"未找到 {name}", "topLevelKeys": list(data.keys())}
    return _result(data)


# ── 3. 实验索引 ─────────────────────────────────────────────────────────
@mcp.tool(description="列出《STEP BaseBoard v4.0 实验指导书》的 18 个实验索引；keyword 可按标题/外设/要点过滤；传 experiment_id 返回单个实验完整条目与所在页码。")
def list_experiments(keyword: str = "", experiment_id: str = "") -> list:
    items = EXPS["experiments"]
    if experiment_id:
        for e in items:
            if e["id"] == experiment_id or str(e["n"]) == experiment_id:
                return _result({"manual": EXPS["manual"], "experiment": e,
                                "reference_docs": EXPS["reference_docs"]})
        return _result({"error": f"未知实验 {experiment_id}", "ids": [e["id"] for e in items]})
    if keyword:
        k = keyword.lower()
        items = [e for e in items if k in json.dumps(e, ensure_ascii=False).lower()]
    return _result({
        "manual": EXPS["manual"], "count": len(items),
        "note": "章号 2-19 共 18 个实验；用 read_manual_page 按 pages 读原理，用 get_board_info 查引脚",
        "experiments": [{"n": e["n"], "id": e["id"], "title": e["title"],
                         "pages": e["pages"], "task": e["task"],
                         "peripherals": e["peripherals"]} for e in items],
    })


# ── 4. 读指导书页 ───────────────────────────────────────────────────────
@mcp.tool(description="按物理页码读实验指导书 PDF：render=false 抽该页文本，render=true 返回该页 PNG 图片（用于看引脚表/框图/电路图）。page 为 1-based；dpi 控制渲染分辨率，默认 110。")
def read_manual_page(page: int, render: bool = False, dpi: int = 110) -> list:
    if not MANUAL.exists():
        return _result({"error": "找不到实验指导书 PDF", "path": str(MANUAL)})
    pages_total = EXPS["manual"]["pages"]
    if page < 1 or page > pages_total:
        return _result({"error": f"页码越界 1..{pages_total}", "page": page})
    if render:
        try:
            import pymupdf
            doc = pymupdf.open(str(MANUAL))
            pg = doc[page - 1]
            zoom = dpi / 72.0
            pix = pg.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            png = pix.tobytes("png")
            doc.close()
            caption = (f"《{EXPS['manual']['title']}》第 {page} 页"
                       f"（{pix.width}x{pix.height}px，{len(png)//1024}KB）")
            return [TextContent(type="text", text=caption),
                    ImageContent(type="image", data=base64.b64encode(png).decode(), mime_type="image/png")]
        except Exception as e:  # noqa: BLE001
            return _result({"error": f"渲染失败: {e!r}", "hint": "可改用 render=false 抽文本"})
    try:
        import pymupdf
        doc = pymupdf.open(str(MANUAL))
        text = doc[page - 1].get_text().strip()
        doc.close()
        return _result({"page": page, "chars": len(text), "text": text[:12000],
                        "note": "本页若无文本层（纯图页），改用 render=true 渲染成图片查看"})
    except Exception as e:  # noqa: BLE001
        return _result({"error": f"抽文本失败: {e!r}"})


# ── 5. 建工程 ───────────────────────────────────────────────────────────
@mcp.tool(description="在工作区 projects/<name> 下创建 Quartus 18.1 工程（.qpf/.qsf + 默认约束：10M08SAM153C8G、3.3V LVTTL、12MHz PIN_J5）。source_files 是相对工程目录的 HDL 文件名列表（可先不填，随后 write_source 补）。工程名须为无中文/空格的合法标识符。")
def create_project(name: str, top: str = "top", source_files: list[str] | None = None,
                   overwrite: bool = False) -> list:
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name):
        return _result({"error": "工程名必须是字母开头的字母/数字/下划线，且不含中文与空格"})
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", top):
        return _result({"error": "顶层实体名非法"})
    d = _safe(f"projects/{name}", root=WORKSPACE)
    if d is None:
        return _result({"error": "路径逃逸工作区"})
    if d.exists() and any(d.iterdir()) and not overwrite:
        return _result({"error": f"工程已存在: {d}", "hint": "传 overwrite=true 重建，或换个名字"})
    if overwrite and d.exists():
        # 清掉上一次编译的中间产物，避免 db/ 里的旧网表让 --flow compile 走增量、
        # 也避免旧 .sof/报告混进 get_report 的结果。源码文件保留（write_source 会覆盖）。
        for stale in ("db", "output_files", "incremental_db"):
            shutil.rmtree(d / stale, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)
    (d / "output_files").mkdir(exist_ok=True)
    files = source_files or []
    dev = BOARD["board"]["fpga"]["quartus_device_name"]
    lines = [
        f'project_new "{name}" -overwrite',
        'set_global_assignment -name FAMILY "MAX 10"',
        f'set_global_assignment -name DEVICE {dev}',
        f'set_global_assignment -name TOP_LEVEL_ENTITY {top}',
        'set_global_assignment -name PROJECT_OUTPUT_DIRECTORY output_files',
        'set_global_assignment -name MIN_CORE_JUNCTION_TEMP 0',
        'set_global_assignment -name MAX_CORE_JUNCTION_TEMP 85',
        'set_global_assignment -name ERROR_CHECK_FREQUENCY_DIVISOR 1',
        'set_global_assignment -name EDA_SIMULATION_TOOL "ModelSim-Altera (Verilog)"',
        'set_global_assignment -name STRATIX_DEVICE_IO_STANDARD "3.3-V LVTTL"',
    ]
    for f in files:
        if not re.fullmatch(r"[A-Za-z0-9_.\-/]+", f) or ".." in f:
            return _result({"error": f"非法文件名: {f}"})
        if f.lower().endswith((".sv", ".svh")):
            typ = "SYSTEMVERILOG_FILE"
        elif f.lower().endswith((".v", ".vh")):
            typ = "VERILOG_FILE"
        elif f.lower().endswith((".vhd", ".vhdl")):
            typ = "VHDL_FILE"
        else:
            typ = "VERILOG_FILE"
        lines.append(f'set_global_assignment -name {typ} "{f}"')
    lines += [
        f'set_location_assignment {BOARD["board"]["clock"]["pin"]} -to clk',
        'project_close',
    ]
    tcl = d / "_create_project.tcl"
    tcl.write_text("\n".join(lines) + "\n", encoding="ascii")
    r = _run([_exe("quartus_sh.exe"), "-t", str(tcl)], cwd=d, timeout=180)
    if not r.get("ok"):
        return _result({"ok": False, "stage": "quartus_sh project_new", "detail": r,
                        "hint": "先用 get_toolchain 自检；看 detail.stdoutTail 里的 Tcl 报错"})
    qpf, qsf = d / f"{name}.qpf", d / f"{name}.qsf"
    return _result({
        "ok": True, "project": name, "top": top, "dir": str(d),
        "qpf": str(qpf) if qpf.exists() else None,
        "qsf": str(qsf) if qsf.exists() else None,
        "device": dev, "clock": BOARD["board"]["clock"],
        "sources": files,
        "next": ["write_source 写 Verilog", "set_assignments 加管脚约束", "compile 编译", "get_report 读结果"],
    })


# ── 6. 写源码 ───────────────────────────────────────────────────────────
@mcp.tool(description="把 Verilog/SystemVerilog 源码写入工程目录并登记进 .qsf。返回写入路径与登记结果；content 直接给完整源码文本，不执行任何代码。")
def write_source(project: str, filename: str, content: str, register: bool = True) -> list:
    d = _project_dir(project)
    if not d:
        return _result({"error": f"工程不存在: {project}", "hint": "先 create_project"})
    p = _safe(f"projects/{project}/{filename}", root=WORKSPACE)
    if p is None:
        return _result({"error": "路径逃逸或文件名非法"})
    if p.suffix.lower() not in (".v", ".sv", ".vh", ".svh", ".vhd", ".vhdl", ".sdc", ".mif", ".hex"):
        return _result({"error": f"不支持的文件类型: {p.suffix}"})
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    reg = {"registered": False, "note": "register=false，未登记"}
    if register and p.suffix.lower() in (".v", ".sv", ".vh", ".svh", ".vhd", ".vhdl", ".sdc"):
        qsf = d / f"{project}.qsf"
        typ = {"v": "VERILOG_FILE", "vh": "VERILOG_FILE", "sv": "SYSTEMVERILOG_FILE",
               "svh": "SYSTEMVERILOG_FILE", "vhd": "VHDL_FILE", "vhdl": "VHDL_FILE",
               "sdc": "SDC_FILE"}[p.suffix.lower().lstrip(".")]
        assign = f'set_global_assignment -name {typ} "{filename}"'
        existing = qsf.read_text(encoding="utf-8", errors="replace") if qsf.exists() else ""
        if assign not in existing:
            with qsf.open("a", encoding="ascii") as fh:
                fh.write("\n" + assign + "\n")
        reg = {"registered": True, "assignment": assign, "qsf": str(qsf)}
    return _result({"ok": True, "file": str(p), "bytes": p.stat().st_size, **reg})


# ── 7. 管脚约束 ─────────────────────────────────────────────────────────
@mcp.tool(description="给工程追加管脚/电平/时钟约束。pins 为 {端口名: PIN_XXX} 字典（用 get_board_info(section=templates) 取 STEP 模板，或 section=onboard/header 查管脚）；io_standard 默认 3.3-V LVTTL；add_clock 是否追加 12MHz create_clock。会检查重复管脚冲突。")
def set_assignments(project: str, pins: dict[str, str], io_standard: str = "3.3-V LVTTL",
                    add_clock: bool = True, clock_port: str = "clk") -> list:
    d = _project_dir(project)
    if not d:
        return _result({"error": f"工程不存在: {project}"})
    qsf = d / f"{project}.qsf"
    if not qsf.exists():
        return _result({"error": "找不到 .qsf，先 create_project"})
    if not pins:
        return _result({"error": "pins 不能为空"})
    bad = {port: pin for port, pin in pins.items() if not re.fullmatch(r"PIN_[A-Za-z0-9]+", str(pin))}
    if bad:
        return _result({"error": "管脚格式应为 PIN_XXX", "bad": bad})
    seen: dict[str, str] = {}
    for port, pin in pins.items():
        if pin in seen:
            return _result({"error": f"管脚冲突: {pin} 同时分配给 {seen[pin]} 与 {port}",
                            "hint": "查 get_board_info(section=onboard/header) 确认"})
        seen[pin] = port
    existing = qsf.read_text(encoding="utf-8", errors="replace")
    sdc = d / f"{project}.sdc"
    lines = ["", "# --- STEP FPGA assignments (stepfpga-mcp) ---"]
    for port, pin in pins.items():
        lines.append(f'set_location_assignment {pin} -to {port}')
        lines.append(f'set_instance_assignment -name IO_STANDARD "{io_standard}" -to {port}')
    if add_clock:
        lines.append(f'set_global_assignment -name SDC_FILE "{sdc.name}"')
        period = 1e9 / BOARD["board"]["clock"]["frequency_hz"]
        sdc.write_text(
            f"# STEP FPGA 12MHz onboard clock ({BOARD['board']['clock']['pin']})\n"
            f"create_clock -name {clock_port} -period {period:.3f} [get_ports {{{clock_port}}}]\n"
            "derive_pll_clocks\n"
            "derive_clock_uncertainty\n", encoding="utf-8")
    block = "\n".join(lines) + "\n"
    with qsf.open("a", encoding="ascii") as fh:
        fh.write(block)
    return _result({
        "ok": True, "project": project, "qsf": str(qsf), "assigned": len(pins),
        "pins": pins, "io_standard": io_standard, "clock_sdc": str(sdc) if add_clock else None,
        "hint": "compile 后用 get_report 检查 Fitter 是否报引脚冲突",
    })


# ── 8. 读工程 ───────────────────────────────────────────────────────────
@mcp.tool(description="列出工程目录文件，并可读取某个文件的内容（用于核对 .qsf 约束或源码）。文件名相对工程目录；不传 file 时只列清单。")
def read_project(project: str, file: str = "", max_chars: int = 12000) -> list:
    d = _project_dir(project)
    if not d:
        return _result({"error": f"工程不存在: {project}"})
    if file:
        p = _safe(f"projects/{project}/{file}", must_exist=True, root=WORKSPACE)
        if not p:
            return _result({"error": f"文件不存在或路径逃逸: {file}"})
        txt = p.read_text(encoding="utf-8", errors="replace")
        return _result({"file": str(p), "chars": len(txt), "truncated": len(txt) > max_chars,
                        "content": txt[:max_chars]})
    files = []
    for p in sorted(d.rglob("*")):
        if p.is_file():
            files.append({"path": p.relative_to(d).as_posix(), "bytes": p.stat().st_size})
    return _result({"project": project, "dir": str(d), "files": files[:120], "total": len(files)})


# ── 9. 编译 ─────────────────────────────────────────────────────────────
@mcp.tool(description="编译 Quartus 工程：mode=full 走 quartus_sh --flow compile（map+fit+sta+asm 全流程）；mode=step 依次调用 map/fit/sta/asm 便于定位失败阶段；也可 mode=map|fit|sta|asm 只跑单步。返回每步退出码与日志尾部；编译结果用 get_report 读摘要。")
def compile(project: str, mode: str = "full", timeout: int = 900) -> list:
    d = _project_dir(project)
    if not d:
        return _result({"error": f"工程不存在: {project}"})
    qpf = d / f"{project}.qpf"
    if not qpf.exists():
        return _result({"error": "缺少 .qpf，先 create_project"})
    valid = {"full", "step", "map", "fit", "sta", "asm"}
    if mode not in valid:
        return _result({"error": f"未知 mode: {mode}", "valid": sorted(valid)})
    lock = _compile_lock(project)
    if not lock.acquire(blocking=False):
        return _result({"error": f"工程 {project} 正在编译中，请稍后用 get_report 查看结果"})
    try:
        steps: list[tuple[str, list[str]]] = []
        if mode == "full":
            steps = [("compile", [_exe("quartus_sh.exe"), "--flow", "compile", project])]
        else:
            seq = ["map", "fit", "sta", "asm"] if mode == "step" else [mode]
            binaries = {"map": "quartus_map.exe", "fit": "quartus_fit.exe",
                        "sta": "quartus_sta.exe", "asm": "quartus_asm.exe"}
            steps = [(s, [_exe(binaries[s]), project]) for s in seq]
        results = []
        for label, argv in steps:
            r = _run(argv, cwd=d, timeout=timeout)
            r["step"] = label
            results.append(r)
            if not r.get("ok"):
                return _result({"ok": False, "project": project, "mode": mode,
                                "failedAt": label, "steps": results,
                                "hint": "先 get_report 看错误摘要，再改代码/约束后重新 compile"})
        sof = d / "output_files" / f"{project}.sof"
        return _result({
            "ok": True, "project": project, "mode": mode, "steps": results,
            "sof": str(sof) if sof.exists() else None,
            "next": ["get_report 读 Fmax/资源/警告", "program 烧录（需接 USB-Blaster 与板卡）"],
        })
    finally:
        lock.release()


# ── 10. 编译报告摘要 ─────────────────────────────────────────────────────
@mcp.tool(description="提取编译结果摘要：错误/警告、逻辑资源、Fmax/最差 slack、引脚数、.sof 是否生成。不返回 MB 级 .rpt 全文；要细节可传 detail=true 附带相关行。")
def get_report(project: str, detail: bool = False) -> list:
    d = _project_dir(project)
    if not d:
        return _result({"error": f"工程不存在: {project}"})
    out = d / "output_files"
    reports = {p.name: p for p in out.glob("*.rpt")} if out.exists() else {}
    flow = _parse_flow_report(reports.get(f"{project}.flow.rpt"))
    fit = _parse_fit_report(reports.get(f"{project}.fit.rpt"))
    sta = _parse_sta_report(reports.get(f"{project}.sta.rpt"))
    mapr = _parse_map_report(reports.get(f"{project}.map.rpt"))
    # flow.rpt 本身不列消息，真正的 Error/Warning 分散在 map/fit/sta/asm/pow/eda 的
    # .rpt 里。统一扫一遍并按 (类型,编号,正文) 去重，免得同一条 18236 被数 6 次。
    msgs = _scan_messages(reports)
    flow["errors"] = msgs["errors"]
    flow["warnings"] = msgs["warnings"]
    flow["criticalWarnings"] = msgs["criticalWarnings"]
    flow["errorCount"] = msgs["errorCount"]
    flow["warningCount"] = msgs["warningCount"]
    sof = out / f"{project}.sof"
    result = {
        "project": project,
        "sofGenerated": sof.exists(),
        "sof": str(sof) if sof.exists() else None,
        "sofBytes": sof.stat().st_size if sof.exists() else None,
        "reportsAvailable": list(reports.keys()),
        "flow": flow, "map": mapr, "fit": fit, "sta": sta,
        "messagesByFile": msgs["byFile"],
        "verdict": _verdict(flow, sof.exists()),
    }
    if detail and reports:
        result["detailLines"] = {
            n: _interesting_lines(p) for n, p in reports.items()
            if n.endswith((".flow.rpt", ".map.rpt", ".fit.rpt", ".sta.rpt"))
        }
    return _result(result)


def _interesting_lines(p: Path, limit: int = 60) -> list[str]:
    pat = re.compile(r"error|warning|critical|fmax|slack|logic utilization|total (pins|registers|memory bits|plls)|"
                     r"timing requirements|family|device|top-level entity", re.I)
    out = []
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        if pat.search(line) and line.strip():
            out.append(line.strip()[:220])
            if len(out) >= limit:
                break
    return out


def _parse_flow_report(p: Path | None) -> dict:
    """解析 flow.rpt 的 '; Key ; Value ;' 表格：Flow Status / 器件 / 资源 / 编译耗时。"""
    if not p:
        return {"available": False}
    t = p.read_text(encoding="utf-8", errors="replace")
    d: dict = {"available": True}

    def field(label: str) -> str:
        m = re.search(r"^\s*;\s*" + re.escape(label) + r"\s*;\s*(.*?)\s*;", t, re.M | re.I)
        return m.group(1).strip() if m else ""

    status = field("Flow Status")
    if status:
        d["flowStatus"] = status
        d["flowSuccessful"] = status.lower().startswith("successful")
    for key, label in (("family", "Family"), ("device", "Device"),
                       ("topLevelEntity", "Top-level Entity Name"),
                       ("revision", "Revision Name"),
                       ("timingModels", "Timing Models"),
                       ("quartusVersion", "Quartus Prime Version")):
        v = field(label)
        if v:
            d[key] = v
    # 资源占用形如 '43 / 8,064 ( < 1 % )'
    for key, label in (("logicUtilization", "Total logic elements"),
                       ("registers", "Total registers"),
                       ("pins", "Total pins"),
                       ("virtualPins", "Total virtual pins"),
                       ("memoryBits", "Total memory bits"),
                       ("plls", "Total PLLs")):
        v = field(label)
        if v:
            d[key] = v
    m = re.search(r"^\s*;\s*Total\s*;\s*([\d:]+)\s*;", t, re.M)
    if m:
        d["totalElapsed"] = m.group(1)
    # 错误/警告由 get_report 统一从各 .rpt 汇总后覆盖，这里给默认值保证字段存在。
    d.setdefault("errors", [])
    d.setdefault("warnings", [])
    d.setdefault("criticalWarnings", [])
    d.setdefault("errorCount", 0)
    d.setdefault("warningCount", 0)
    return d


def _scan_messages(reports: dict[str, Path]) -> dict:
    """扫所有 .rpt 里的 Error / Warning / Critical Warning 行并去重。"""
    pat = re.compile(r"^\s*(Critical Warning|Warning|Error)\s*\((\d+)\):\s*(.+)$", re.M | re.I)
    seen: dict[tuple[str, str, str], str] = {}
    by_file: dict[str, dict] = {}
    for name, p in sorted(reports.items()):
        t = p.read_text(encoding="utf-8", errors="replace")
        found = {"errors": [], "warnings": [], "criticalWarnings": []}
        for kind, code, msg in pat.findall(t):
            kind = kind.strip().title()
            key = (kind, code, msg.strip())
            seen.setdefault(key, name)
            bucket = {"Error": "errors", "Warning": "warnings",
                      "Critical Warning": "criticalWarnings"}[kind]
            text = f"{code}: {msg.strip()[:200]}"
            if text not in found[bucket]:
                found[bucket].append(text)
        if any(found.values()):
            by_file[name] = found
    errors = [f"{c}: {m}" for k, c, m in seen if k == "Error"]
    warnings = [f"{c}: {m}" for k, c, m in seen if k == "Warning"]
    critical = [f"{c}: {m}" for k, c, m in seen if k == "Critical Warning"]
    return {
        "errors": errors[:20], "warnings": warnings[:20], "criticalWarnings": critical[:20],
        "errorCount": len(errors), "warningCount": len(warnings) + len(critical),
        "byFile": by_file,
    }


def _parse_map_report(p: Path | None) -> dict:
    if not p:
        return {"available": False}
    t = p.read_text(encoding="utf-8", errors="replace")
    d: dict = {"available": True}
    m = re.search(r"Total logic elements\s*[;:]\s*([\d,]+)", t, re.I)
    if m: d["logicElements"] = int(m.group(1).replace(",", ""))
    m = re.search(r"Total registers\s*[;:]\s*([\d,]+)", t, re.I)
    if m: d["registers"] = int(m.group(1).replace(",", ""))
    m = re.search(r"Total memory bits\s*[;:]\s*([\d,]+)", t, re.I)
    if m: d["memoryBits"] = int(m.group(1).replace(",", ""))
    m = re.search(r"Total pins\s*[;:]\s*([\d,]+)", t, re.I)
    if m: d["pins"] = int(m.group(1).replace(",", ""))
    m = re.search(r"Total virtual pins\s*[;:]\s*([\d,]+)", t, re.I)
    if m: d["virtualPins"] = int(m.group(1).replace(",", ""))
    return d


def _parse_fit_report(p: Path | None) -> dict:
    if not p:
        return {"available": False}
    t = p.read_text(encoding="utf-8", errors="replace")
    d: dict = {"available": True}
    m = re.search(r"(?:Total\s+)?logic elements\s*[;:]\s*([\d,]+)\s*/\s*([\d,]+)", t, re.I)
    if m: d["logicUtilization"] = f"{m.group(1)} / {m.group(2)}"
    m = re.search(r"I/O pins?\s*[;:]\s*([\d,]+)\s*/\s*([\d,]+)", t, re.I)
    if m: d["ioPins"] = f"{m.group(1)} / {m.group(2)}"
    errs = re.findall(r"^Error\s*\((\d+)\):\s*(.+)$", t, re.M)
    warns = re.findall(r"^Warning\s*\((\d+)\):\s*(.+)$", t, re.M)
    d["errors"] = [f"{c}: {m2}" for c, m2 in errs[:10]]
    d["warnings"] = [f"{c}: {m2}" for c, m2 in warns[:10]]
    return d


def _parse_sta_report(p: Path | None) -> dict:
    """解析 sta.rpt：Fmax Summary 表、Worst-case Slack 表、Info(332146) 汇总。"""
    if not p:
        return {"available": False}
    t = p.read_text(encoding="utf-8", errors="replace")
    d: dict = {"available": True}
    # '; 158.86 MHz ; 158.86 MHz ; clk ;' —— Fmax Summary 表的数据行
    fmax_rows = re.findall(
        r"^\s*;\s*([\d.]+\s*MHz)\s*;\s*([\d.]+\s*MHz|[-]+)\s*;\s*(\S+)\s*;", t, re.M | re.I)
    if fmax_rows:
        d["clocks"] = [{"clock": c, "fmax": f, "restrictedFmax": rf}
                       for f, rf, c in fmax_rows]
        d["fmax"] = fmax_rows[0][0]
    # '; Worst-case Slack ; 77.038 ; ... ;' —— 多角汇总表
    m = re.search(r"^\s*;\s*Worst-case Slack\s*;\s*(-?[\d.]+)\s*;", t, re.M | re.I)
    if m:
        d["worstSetupSlackNs"] = float(m.group(1))
    # Info (332146): Worst-case setup slack is 77.038 / hold slack ...
    for pattern, key in (("setup", "setupSlackNs"), ("hold", "holdSlackNs"),
                         ("minimum pulse width", "minPulseWidthSlackNs")):
        m = re.search(rf"Worst-case {pattern} slack is (-?[\d.]+)", t, re.I)
        if m:
            d[key] = float(m.group(1))
    # 时序是否收敛：有任一 slack 为负即不收敛
    slacks = [v for k, v in d.items() if k.endswith("SlackNs") and isinstance(v, (int, float))]
    d["timingMet"] = bool(slacks) and all(v >= 0 for v in slacks)
    return d


def _verdict(flow: dict, sof: bool) -> str:
    if flow.get("errorCount"):
        return "FAIL: 编译有错误，按 flow.errors 修代码/约束"
    if not sof:
        return "INCOMPLETE: 尚未生成 .sof（可能未跑 compile 或编译中断）"
    if flow.get("warningCount"):
        return f"PASS with {flow['warningCount']} warnings: 已生成 .sof，检查 flow.warnings"
    return "PASS: 已生成 .sof，无错误"


# ── 11. ModelSim 仿真 ───────────────────────────────────────────────────
@mcp.tool(description="用 ModelSim ASE 批处理仿真：把 sources 里的 Verilog 编译进 work，vsim 运行 top 模块并执行 do_file（不传则用 run -all + quit -f 收集输出）。返回 transcript 尾部与断言/错误行。需要 testbench 里自行 $display/$finish。")
def simulate(project: str, sources: list[str], top: str = "tb", do_file: str = "",
             timeout: int = 300) -> list:
    d = _project_dir(project)
    if not d:
        return _result({"error": f"工程不存在: {project}"})
    if not sources:
        return _result({"error": "sources 不能为空"})
    vlib, vlog, vsim = (MODELSIM_DIR / "vlib.exe", MODELSIM_DIR / "vlog.exe",
                        MODELSIM_DIR / "vsim.exe")
    if not (vlib.exists() and vlog.exists() and vsim.exists()):
        return _result({"error": "ModelSim 不可用", "hint": "get_toolchain 自检 vlog/vsim"})
    paths = []
    for s in sources:
        p = _safe(f"projects/{project}/{s}", must_exist=True, root=WORKSPACE)
        if not p:
            return _result({"error": f"源文件不存在或逃逸: {s}"})
        paths.append(p)
    sim = d / "sim"
    sim.mkdir(exist_ok=True)
    steps = []
    # ModelSim 必须先在 sim/ 下建好 work 库，否则 vlog 报 (vlog-66) vlib.exe failed。
    r = _run([str(vlib), "work"], cwd=sim, timeout=60)
    r["step"] = "vlib"; steps.append(r)
    if not r.get("ok"):
        return _result({"ok": False, "failedAt": "vlib", "steps": steps})
    r = _run([str(vlog), "-work", "work", *[str(p) for p in paths]], cwd=sim, timeout=180)
    r["step"] = "vlog"; steps.append(r)
    if not r.get("ok"):
        return _result({"ok": False, "failedAt": "vlog", "steps": steps})
    if do_file:
        dp = _safe(f"projects/{project}/{do_file}", must_exist=True, root=WORKSPACE)
        if not dp:
            return _result({"error": f"do 文件不存在: {do_file}"})
        cmd = [str(vsim), "-c", "-do", f'do "{dp}"', "work." + top]
    else:
        cmd = [str(vsim), "-c", "-do", "run -all; quit -f", "work." + top]
    r = _run(cmd, cwd=sim, timeout=timeout)
    r["step"] = "vsim"; steps.append(r)
    transcript = ""
    tp = sim / "transcript"
    if tp.exists():
        transcript = tp.read_text(encoding="utf-8", errors="replace")
    issues = [ln for ln in transcript.splitlines()
              if re.search(r"\b(error|fatal|assert|\*\*)\b", ln, re.I)][:30]
    return _result({
        "ok": bool(r.get("ok")) and not issues, "project": project, "top": top,
        "steps": steps, "issues": issues,
        "transcriptTail": transcript[-6000:],
        "hint": "testbench 里用 $display 打印关键信号；没有 $finish 时靠 run -all 超时或 quit -f 收尾",
    })


# ── 12. JTAG 状态 ───────────────────────────────────────────────────────
@mcp.tool(description="检测 JTAG 下载器与链上器件（jtagconfig）。不接板时返回结构化 no-hardware，不算失败。")
def jtag_status() -> list:
    r = _run([_exe("jtagconfig.exe")], timeout=60)
    out = (r.get("stdoutTail", "") + "\n" + r.get("stderrTail", "")).strip()
    no_hw = "No JTAG hardware available" in out or not out
    return _result({
        "connected": not no_hw, "detail": r,
        "hint": "未连接板卡/USB-Blaster 时属正常；接上后 program 才能烧录",
    })


# ── 13. 烧录 ────────────────────────────────────────────────────────────
@mcp.tool(description="把工程的 .sof 经 USB-Blaster/JTAG 烧录到 STEP-MAX10。cable 默认 USB-Blaster；sof 可指定 output_files 下其它 .sof。无硬件时返回结构化提示而不是崩溃。烧录是写入硬件的操作，调用前请确认板卡已连接。")
def program(project: str, sof: str = "", cable: str = "USB-Blaster", timeout: int = 180) -> list:
    d = _project_dir(project)
    if not d:
        return _result({"error": f"工程不存在: {project}"})
    p = _safe(f"projects/{project}/output_files/{sof or project + '.sof'}",
              must_exist=True, root=WORKSPACE)
    if not p:
        return _result({"error": "找不到 .sof，先 compile", "hint": "get_report 确认 sofGenerated"})
    st = jtag_status()
    connected = False
    for c in st:
        if c.type == "text":
            try:
                connected = json.loads(c.text).get("connected", False)
            except Exception:
                pass
    if not connected:
        return _result({"ok": False, "hardware": "absent", "sof": str(p),
                        "message": "未检测到 JTAG 硬件，跳过烧录；接上 USB-Blaster 与板卡后重试",
                        "jtag": _txt(json.loads(st[0].text)) if st else None})
    r = _run([_exe("quartus_pgm.exe"), "-c", cable, "-m", "JTAG",
              "-o", f"p;{p}"], cwd=d, timeout=timeout)
    out = r.get("stdoutTail", "") + r.get("stderrTail", "")
    r["programSuccess"] = bool(re.search(r"Info:.*(success|Success)", out)) and "Error" not in out
    return _result({"ok": bool(r.get("ok")) and r["programSuccess"],
                    "sof": str(p), "cable": cable, "detail": r,
                    "hint": "烧录后按指导书观察实验现象；SOF 掉电丢失，需要固化时另用 quartus_cpf 转 JIC"})


# ── resources（可选，供 MCP resource 读取）────────────────────────────────
@mcp.resource("stepfpga://board", name="STEP 板卡信息", mime_type="application/json")
def board_resource() -> str:
    return json.dumps(BOARD, ensure_ascii=False, indent=2)


@mcp.resource("stepfpga://experiments", name="实验索引", mime_type="application/json")
def experiments_resource() -> str:
    return json.dumps(EXPS, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    mcp.run(transport="stdio")
