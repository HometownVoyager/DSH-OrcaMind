#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""stepfpga-mcp 冒烟测试：真实 MCP stdio 握手 + 全流程工具调用。

用法（在 bundle 根目录）：
  python mcp/smoke_test.py            # 握手 + 查询类 + 建工程/写 LED/编译/读报告
  python mcp/smoke_test.py --full     # 追加 ModelSim 仿真

不接板卡也能跑完（program/jtag_status 会返回结构化 no-hardware）。
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

ROOT = Path(__file__).resolve().parent.parent
SERVER = Path(__file__).resolve().parent / "stepfpga_mcp.py"

ENV = {
    "STEPFPGA_WORKSPACE": os.environ.get("STEPFPGA_WORKSPACE", r"D:/Study/Quartus"),
    "STEPFPGA_QUARTUS_DIR": os.environ.get("STEPFPGA_QUARTUS_DIR", r"D:/Study/Quartus/quartus/bin64"),
    "STEPFPGA_MODELSIM_DIR": os.environ.get("STEPFPGA_MODELSIM_DIR", r"D:/Study/Quartus/modelsim_ase/win32aloem"),
    "STEPFPGA_DOCS_DIR": os.environ.get("STEPFPGA_DOCS_DIR", r"D:/Study/Quartus/STEP FPGA"),
    "STEPFPGA_DATA_DIR": str(ROOT / "data"),
    "STEPFPGA_PROJECTS_DIR": os.environ.get("STEPFPGA_PROJECTS_DIR", r"D:/Study/Quartus/projects"),
    "PYTHONIOENCODING": "utf-8",
    "PYTHONUTF8": "1",
}

LED_VERILOG = """// STEP FPGA 冒烟测试：8 位 LED 闪烁（12MHz 时钟）
// LED 低电平点亮；clk = PIN_J5 (12MHz)
module top (
    input  wire       clk,      // 12MHz
    input  wire       rst_n,    // KEY1, 低电平复位
    output reg  [7:0] led       // LED1..LED8, 低电平点亮
);
    parameter DIV = 24'd6_000_000;   // 0.5s @12MHz
    reg [23:0] cnt;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin cnt <= 24'd0; led <= 8'b1111_1110; end
        else if (cnt >= DIV - 1) begin cnt <= 24'd0; led <= {led[6:0], led[7]}; end
        else cnt <= cnt + 1'b1;
    end
endmodule
"""

TB_VERILOG = """`timescale 1ns/1ps
module tb;
    reg clk = 0, rst_n = 0;
    wire [7:0] led;
    always #41.667 clk = ~clk;   // 12MHz
    initial begin
        #100 rst_n = 1;
        #2_000_000 $display("SMOKE: led=%b", led);
        $display("SMOKE_OK");
        $finish;
    end
    top uut(.clk(clk), .rst_n(rst_n), .led(led));
endmodule
"""


def _show(label: str, res) -> dict:
    texts = [c.text for c in res.content if c.type == "text"]
    raw = "\n".join(texts)
    print(f"\n===== {label} =====")
    print(raw[:1600] + ("\n...[truncated]" if len(raw) > 1600 else ""))
    try:
        return json.loads(raw)
    except Exception:
        return {"_raw": raw}


async def main() -> int:
    full = "--full" in sys.argv
    params = StdioServerParameters(
        command=sys.executable, args=["-u", str(SERVER)], env=ENV, cwd=str(ROOT),
    )
    failures = []
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = [t.name for t in tools.tools]
            print("TOOLS:", len(names), names)
            expected = {"get_toolchain", "get_board_info", "list_experiments", "read_manual_page",
                        "create_project", "write_source", "set_assignments", "read_project",
                        "compile", "get_report", "simulate", "jtag_status", "program"}
            missing = expected - set(names)
            if missing:
                failures.append(f"缺少工具: {missing}")
            async def call(name: str, args: dict | None = None):
                return _show(name, await session.call_tool(name, args or {}))

            tc = await call("get_toolchain")
            if not tc.get("ok"):
                failures.append(f"get_toolchain 未全绿: {tc.get('checks')}")
            if not tc.get("checks", {}).get("max10_devinfo_55nm"):
                failures.append("缺 MAX 10 器件库 devinfo/55nm，编译会报 Error(20004)")
            board = await call("get_board_info", {"section": "board"})
            if board.get("board", {}).get("fpga", {}).get("device") != "10M08SAM153C8G":
                failures.append("board.yaml 器件不对")
            exps = await call("list_experiments")
            if exps.get("count") != 18:
                failures.append("实验索引不是 18 条")
            pg = await call("read_manual_page", {"page": 13})
            if "矩阵键盘" not in pg.get("text", ""):
                failures.append("PDF 抽文本失败")

            proj = "smoke_blink"
            cp = await call("create_project", {"name": proj, "top": "top", "overwrite": True})
            if not cp.get("ok"):
                failures.append(f"create_project 失败: {cp.get('detail', cp)}")
                return _finish(failures)
            await call("write_source", {"project": proj, "filename": "top.v", "content": LED_VERILOG})
            pins = {"clk": "PIN_J5", "rst_n": "PIN_J9",
                    "led[0]": "PIN_N15", "led[1]": "PIN_N14", "led[2]": "PIN_M14",
                    "led[3]": "PIN_M12", "led[4]": "PIN_L15", "led[5]": "PIN_K12",
                    "led[6]": "PIN_L11", "led[7]": "PIN_K11"}
            await call("set_assignments", {"project": proj, "pins": pins})
            await call("read_project", {"project": proj, "file": "smoke_blink.qsf"})
            comp = await call("compile", {"project": proj, "mode": "full"})
            if not comp.get("ok"):
                failures.append("compile 失败（见上）")
            rep = await call("get_report", {"project": proj, "detail": True})
            if not rep.get("sofGenerated"):
                failures.append("未生成 .sof")
            await call("jtag_status")
            await call("program", {"project": proj})
            if full:
                await call("write_source", {"project": proj, "filename": "tb.v",
                                            "content": TB_VERILOG, "register": False})
                await call("simulate", {"project": proj, "sources": ["top.v", "tb.v"], "top": "tb",
                                        "timeout": 120})
            res = await session.list_resources()
            print("\nRESOURCES:", [r.uri for r in res.resources])
    return _finish(failures)


def _finish(failures: list[str]) -> int:
    print("\n================ 冒烟结论 ================")
    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ALL PASS —— MCP 协议握手、13 工具注册、查询/建工程/写源码/约束/编译/报告/JTAG 均正常")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
