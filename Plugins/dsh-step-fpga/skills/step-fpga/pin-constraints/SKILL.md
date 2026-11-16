---
name: pin-constraints
description: "管脚与时序约束规范：从 board.yaml 取引脚模板、set_assignments 落 .qsf + 12MHz .sdc、检查复用冲突与低电平有效 —— 给 STEP-MAX10 工程分配引脚、加时钟约束或 Fitter 报引脚冲突时使用"
---

# 管脚与时钟约束（STEP FPGA）

约束是编译能跑通的前提，先查后写。

## 事实基线

- 器件 `10M08SAM153C8G`，`FAMILY "MAX 10"`，IO 默认 `3.3-V LVTTL`。
- 板载时钟 `clk = PIN_J5 = 12MHz`；`.sdc` 用 `create_clock -period 83.333 [get_ports clk]`。
- 8 位 LED、4 位按键、DIP、数码管段选**低电平有效**；RGB 三色同理。
- `I2C_SCL=PIN_M4`、`I2C_SDA=PIN_P3` 为底板共享总线，SDA 必须声明 `inout` 并外接上拉。
- `DISP1..DISP8` 同时被 HDMI 与 TFT-LCD 复用，**二者只能选其一**，不要同时例化。

## 操作

1. `get_board_info(section=onboard)` / `section=header` 查具体 `PIN_XXX`；`section=templates` 取 `blink_led` / `key_led` / `uart_echo` / `voltmeter` 成组模板，比逐条查省事。
2. `set_assignments(project, pins={端口: PIN_XXX}, add_clock=true)` 一次写入管脚 + IO_STANDARD，并自动生成 12MHz `.sdc`。端口名带总线下标时写 `"led[0]"` 这类字符串。
3. 工具会检查**同一管脚被分给两个端口**的冲突；但跨 `set_assignments` 多次调用、或指导书里标注的电气复用冲突（HDMI/TFT、I2C 共享）要人工核对。
4. `read_project(project, file="<name>.qsf")` 复核写入结果；`compile` 后用 `get_report` 看 Fitter 是否还有 `Warning (15714)` 之类的 I/O 约束不全提示，逐条处理到清楚为止。

## 禁止

- 不要手写 `.qsf`/`.sdc` 文本绕过工具；不要用 `edit`/shell 改工程约束文件。
- 不确定的管脚先用 `read_manual_page(render=true)` 看指导书第 12 页引脚表，别填一个"差不多"的 `PIN_`。
