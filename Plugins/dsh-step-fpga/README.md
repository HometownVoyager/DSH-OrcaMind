# dsh-step-fpga —— STEP FPGA 实验预设 + 预设专属 MCP

面向「小脚丫 STEP-MAX10 核心板 + STEP BaseBoard V4.0 底板」的课程作业与竞赛，给 DSH（DeepSeek Harness）提供一个 Agent 预设，以及一个**只在选中该预设时才拉起**的 stdio MCP server。

调研 → 设计 → 确认 → 实现，全部内容落在这个配置型 bundle 里；不修改 DSH 自带文件，不改 profile 的 `package.json` / `cordis.patch.yml`。

---

## 1. 它解决什么

| 痛点 | 本 bundle 的做法 |
| --- | --- |
| 每次作业都要重新翻 288 页指导书找引脚、找实验页码 | `data/board.yaml` + `data/experiments.yaml` 结构化，MCP 直接查询 |
| 引脚/器件靠模型记忆，容易臆造 `PIN_XXX` | 唯一事实源是数据文件 + 指导书原页；工具不做猜测 |
| 编译报错后模型盲改代码 | `compile → get_report → 改代码 → compile` 闭环，报告结构化（Fmax/slack/资源/警告） |
| 几十个 MCP 工具的 schema 摊到所有预设的 token | `mcp-stepfpga` 行放在预设的 `config.plugins` 内，仅本预设可见 |
| 没接板卡/工具链暂不可用就拖垮整个 Harness | `failOnStartupError: false`，工具缺席但会话照常 |

## 2. 目录结构

```
dsh-step-fpga/
├── package.json                 # 配置型 bundle 清单（dsh.bundle.patch）
├── cordis.patch.yml             # 预设声明 + 插件表 + preset 作用域 MCP
├── locale/{en,zh}.json          # 显示元数据（meta.title / meta.description）
├── icon.svg                     # 原创图标（FPGA 芯片 + 引脚 + 时钟脉冲 + LED）
├── data/
│   ├── board.yaml               # 器件/时钟/引脚表/外设/约束模板/硬性约束
│   └── experiments.yaml         # 指导书 288 页、18 个实验（章 2-19）索引 + 参考文档
├── mcp/
│   ├── stepfpga_mcp.py          # stdio MCP server：13 工具 + 2 resource
│   └── smoke_test.py            # 真实 MCP 握手 + 全流程冒烟（--full 含 ModelSim）
├── skills/step-fpga/            # 4 个精简技能（仅本预设 customSkillDirs 挂载）
│   ├── experiment-brief/SKILL.md     # 任务拆解、读指导书、声明本轮范围
│   ├── pin-constraints/SKILL.md      # 管脚/时钟约束、复用冲突检查
│   ├── compile-debug/SKILL.md        # 编译-仿真-报告闭环、失败定位
│   └── homework-handoff/SKILL.md     # 交付整理、诚实写明未上板验证
├── requirements.txt             # 系统 Python 依赖
└── README.md
```

## 3. 预设

- **id**：`step-fpga`，**显示名**：`STEP FPGA 实验`，**order**：`60`（排在 20 个既有自建预设之后）。
- **Loader 行**：`preset-step-fpga`，写在 `insert:` 里（profile 里 `- id:` 顶层写法只对已存在行做覆盖，新行必须用 `insert`）。
- **persona**：精简工程化，约 20 行——硬事实 + 6 步作业流 + 纪律，不写长篇角色设定，不做双模式。
- **插件表**：与 `standard` 一致的全套工具，外加 `skill-filesystem.customSkillDirs` 指向本 bundle 的技能树；三个 `cordis:group`（planning / compaction / delegation）各带 `isolate`，因为预设内提供的 `planMode` / `compaction` / `toolResultPruner` / `workflowEngine` 服务不隔离会报 `Preset services require isolate realms`。
- **作用域**：`mcp-stepfpga` 是预设 `config.plugins` 的一行，不是 Host 行。DSH 的 `dsh-mcp-client` 只 consume Host 的 `tools`、不提供 service，因此不需要 `isolate`。官方 `packages/mcp/mcp-manager/README.md` 也明确「server 属于某个 agent preset 而非整个 Host 时，保留普通 `dsh-mcp-client` 行，manager 只管全局面」。

## 4. MCP（`mcp__stepfpga__*`）

13 个工具：

| 工具 | 作用 |
| --- | --- |
| `get_toolchain` | 自检 Quartus 18.1 / ModelSim ASE / MAX 10 器件库 / 资料与数据文件 |
| `get_board_info` | 板卡/引脚/外设/约束模板，按 section 与 name 筛选 |
| `list_experiments` | 18 个实验索引，按关键词或 id 过滤 |
| `read_manual_page` | 抽指导书某页文本，或 `render=true` 返回 PNG 图（看引脚表/框图） |
| `create_project` | 建 `.qpf/.qsf`：10M08SAM153C8G、3.3-V LVTTL、12MHz PIN_J5 |
| `write_source` | 写 Verilog/SV/VHDL/SDC 并登记进 `.qsf` |
| `set_assignments` | 追加管脚 + IO_STANDARD + 12MHz `.sdc`，查重复管脚冲突 |
| `read_project` | 列工程文件 / 读某个文件核对约束 |
| `compile` | `full` 或 `step`/`map`/`fit`/`sta`/`asm`，同工程互斥锁 |
| `get_report` | 汇总 flow/map/fit/sta 报告：错误/警告/Fmax/slack/资源/`.sof` |
| `simulate` | `vlib → vlog → vsim -c`，收集 transcript 与 `$display` 标记 |
| `jtag_status` | `jtagconfig`，无硬件返回结构化 `connected:false` |
| `program` | `quartus_pgm`，无硬件返回 `hardware:"absent"` 而不崩溃 |

2 个 resource：`stepfpga://board`、`stepfpga://experiments`。

### 关键配置（`cordis.patch.yml` 的 `mcp-stepfpga.config`）

- `serverName: stepfpga`（`^[A-Za-z0-9_-]{1,32}$`，避开已存在的 `image`/`comfyui`/`godot-ai`）→ 工具前缀 `mcp__stepfpga__*`。
- `transport: stdio`；`command` 用真实 Python 解释器绝对路径（不是 WindowsApps stub）：
  `C:/Users/HometownVoyager/AppData/Local/Programs/Python/Python312/python.exe`，`args: ['-u', '<bundle>/mcp/stepfpga_mcp.py']`。
- `env` 显式给出 `STEPFPGA_WORKSPACE` / `STEPFPGA_QUARTUS_DIR` / `STEPFPGA_MODELSIM_DIR` / `STEPFPGA_DOCS_DIR` / `STEPFPGA_DATA_DIR` / `STEPFPGA_PROJECTS_DIR` / `PYTHONIOENCODING` / `PYTHONUTF8`。DSH 对 stdio 子进程会 scrub 掉 `DSH_*` 与凭据类（含 `KEY/PASSWORD/SECRET/TOKEN`）环境变量，这些前缀不受影响。
- `toolCallTimeoutMs: 600000`：`quartus_sh --flow compile` 实测约 20–25s，留足余量。
- `failOnStartupError: false`：可选 MCP 启动失败不影响 Harness。

### 依赖

系统 Python 3.12 需 `mcp 2.3.0+`、`PyYAML`、`pymupdf`（见 `requirements.txt`）。`pymupdf` 仅用于 PDF 抽文本/渲染；缺失时 `read_manual_page` 返回可读错误，其余工具不受影响。

## 5. 板卡事实（来自 `data/*.yaml`，勿臆造）

- 核心板 `STEP-MAX10-08A`；FPGA `10M08SAM153C8G`（`MAX 10`，`SAM153`）；IO `3.3-V LVTTL`。
- 时钟 `clk = PIN_J5 = 12MHz` → `create_clock -period 83.333 [get_ports clk]`。
- 8 位 LED / 4 按键 / DIP / 数码管**低电平有效**；RGB LED1/LED2 各 3 脚；36 GPIO。
- `I2C_SCL=PIN_M4`、`I2C_SDA=PIN_P3` 共享，SDA 必须 `inout` + 上拉。
- `DISP1..DISP8` 被 HDMI 与 TFT-LCD 复用，**二者只能选其一**。
- 工程名/路径不得含中文与空格（Quartus 18.1 限制）。
- 烧录：`quartus_pgm -c USB-Blaster -m JTAG -o "p;<file>.sof"`；`.sof` 掉电丢失，固化需另转 `.jic`。

## 6. 安装与验证

安装（由 `plugin_manager` 完成包安装与 bundle 选择，勿手工改 profile）：

```
plugin_manager  action: install_bundle  target: D:\Tools\DeepSeek Harness\Plugins\dsh-step-fpga
```

验证（**新开会话**选择 `STEP FPGA 实验`，既有会话沿用启动时的插件 revision）：

1. `plugin_manager list_bundles` / `list_plugins`：`preset-step-fpga` 无 diagnostic。
2. `cordis_inspect_query` Host `Tool.listTools`：应出现 `mcp__stepfpga__*`；切回 `standard` 后消失。
3. 调用 `mcp__stepfpga__get_toolchain`，`checks` 全为 true。
4. 端到端：`create_project → write_source → set_assignments → compile → get_report → simulate`，`get_report.verdict` 为 PASS、`sofGenerated=true`。

### 本机冒烟结果（2026-11-11，未接板）

`python mcp/smoke_test.py --full` → `ALL PASS`：

- 13 工具 + 2 resource 注册，MCP stdio 握手正常。
- `get_toolchain().ok = true`，Quartus `18.1.0 Build 625 ... SJ Lite Edition`。
- 编译 `exitCode 0`，约 21s，生成 `output_files/smoke_blink.sof`（728573 bytes）。
- `get_report`：`flowStatus Successful`、`errors 0`、8 warnings + 1 critical warning（均是 18.1 Lite 的常规提示：未指定并行处理器、LogicLock 订阅、I/O 约束不全、3.3V 接口 AN 447 等）、`fmax 158.86 MHz`、`worstSetupSlackNs 77.038`、`timingMet true`、`logicUtilization 43 / 8,064`、`pins 10 / 112`。
- `simulate`：`vlib → vlog → vsim` 全绿，transcript 含 `SMOKE_OK`，`issues` 为空。
- `jtag_status`：`connected:false`（`No JTAG hardware available`）；`program` → `hardware:"absent"`。属预期。

## 7. 重要发现：MAX 10 器件库

本机 Quartus 18.1 Lite 根目录最初**缺少** `quartus/common/devinfo/55nm/`，`FAMILY "MAX 10"` 会报 `Error (20004): ... is not a valid device family, is not installed ...`。

已从安装包 `Quartus-lite-18.1.0.625-windows/components/max10-18.1.0.625.qdz` 解出 636 个文件（约 343MB）补到该目录，`get_family_list()` 现在包含 `{MAX 10}`，编译验证通过。

**因此 `quartus/common/devinfo/55nm/` 绝不能删**。`get_toolchain` 已把 `max10_devinfo_55nm` 列为显式自检项，缺失时 hint 指向这个 `.qdz`。

工作区清理（2026-11-11，经用户确认）：删掉 5.8G 的解压安装包目录、`logs/`、调研临时目录 `.stepfpga-research/`、以及字节级重复的原理图副本；**保留 `Quartus-lite-18.1.0.625-windows.zip`（5.3G）作为 `max10-*.qdz` 的来源备份**，保留 `quartus/`（含已补的 55nm 器件库）与 `modelsim_ase/`。删后重跑完整编译冒烟仍 ALL PASS。

## 8. 已知限制

- **`dsh-ops` 未接入**：本 profile 的 `dsh-ops` 行 `presets` 映射只列了 13 个既有自建预设，未含 `step-fpga`（经用户确认暂不接入）。因此新预设里不保证有 OPS 的文件/bash 等工具；但 MCP 的 13 个工具已覆盖建工程/写源码/约束/编译/仿真/报告全流程，不依赖 OPS。若日后需要 OPS 工具，用配置编辑器在 `dsh-ops` 行 `presets` 下加 `step-fpga: { enabled: true, files: true }` 即可（不要手写 profile 的其它部分）。
- 未接 USB-Blaster / 板卡：`jtag_status` 返回 `connected:false`，`program` 返回 `hardware:"absent"`——编译与仿真仍可用，但**无法完成上板验证**，交付时必须写明。
- `program` 只烧 `.sof`（掉电丢失）；`.jic` 固化、SignalTap、IP 集成等未封装。
- `simulate` 只跑 Verilog 行为级，不替代上板时序/电气验证。
- 无浏览器控制时，预设/插件在 Web UI 里的**渲染显示**（标题、描述、图标）只能核对资源与安装结果，不能声称已目视确认。
- 预设 revision 一经激活，被所有选用它的 Agent 共享（一个 MCP 进程，不是每会话一个）。
- 板卡知识以本机资料与官方管脚表为准；换板型/换底板需同步改 `data/board.yaml`。

## 9. 维护位置

| 要改什么 | 改哪里 |
| --- | --- |
| 引脚、器件、时钟、外设、约束模板 | `data/board.yaml` |
| 实验索引、页码、参考文档 | `data/experiments.yaml` |
| MCP 工具行为 / 报告解析 / 工具链路径 | `mcp/stepfpga_mcp.py` |
| 工作流纪律、交付规范 | `skills/step-fpga/*/SKILL.md` |
| persona、插件表、MCP 挂载与 env | `cordis.patch.yml` |
| 显示名/描述/图标 | `locale/*.json` / `icon.svg` |

改完 `cordis.patch.yml` 需用 `plugin_manager install_bundle` 重新安装，`application: applied` 后**新开会话**验证。

## 10. 参考

- [快速上手 STEP MAX10](https://wiki.stepfpga.com/%E5%BF%AB%E9%80%9F%E4%B8%8A%E6%89%8Bstep-max10)
- [官方 1.4 管脚分配](https://www.stepfpga.com/library/board-doc/FPGA/STEP%20BaseBoard%20v4.0/STEP%20BaseBoard%20v4.0%E5%AE%9E%E9%AA%8C%E6%8C%87%E5%AF%BC%E4%B9%A6/%E6%9D%BF%E5%8D%A1%E4%BB%8B%E7%BB%8D/1.4%20%E7%AE%A1%E8%84%9A%E5%88%86%E9%85%8D)
- [STEP-MAX10 硬件手册](https://wiki.stepfpga.com/_media/step-max10_%E7%A1%AC%E4%BB%B6%E6%89%8B%E5%86%8Cv1.2.pdf)
- [STEP BaseBoard V4.0 实验指导书目录](https://www.stepfpga.com/library/board-doc/category/step-baseboard-v40实验指导书)
- [Intel Quartus Prime 设计约束 / Tcl 指南](https://cdrdv2-public.intel.com/667110/ug-qpp-design-constraints-683143-667110.pdf)
- [stepfpga 官网](http://www.stepfpga.com)
