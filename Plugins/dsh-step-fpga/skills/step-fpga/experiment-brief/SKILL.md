---
name: experiment-brief
description: "作业/竞赛任务开工规范：把题目拆成实验索引条目、读指导书对应页、确认外设与引脚、声明本轮范围再动手 —— 收到 STEP FPGA 作业题、课程设计或竞赛命题时使用"
---

# 实验任务拆解（STEP FPGA）

收到一个作业/竞赛题目时，先建立可核对的事实，再写代码。不凭记忆猜管脚、器件或实验页码。

## 流程

1. **定位实验**：`list_experiments(keyword=...)` 找最接近的章节；`list_experiments(experiment_id=...)` 取完整条目（章号、页码范围、任务、外设）。题目若跨多个实验，列出所有相关 id 并说明组合方式。
2. **读原理**：按条目 `pages` 用 `read_manual_page(page=...)` 抽文本；遇到引脚表/框图/时序图用 `render=true` 渲染成图看。把「实验任务/设计框图/关键时序」摘录进本轮回复。
3. **查板卡事实**：`get_board_info(section=onboard/header/peripherals/constraints)` 取引脚、电平、复用约束；`section=templates` 取可直接用的管脚分配模板。
4. **自检工具链**：`get_toolchain()` 全绿才继续；`max10_devinfo_55nm` 为 false 时先按 hint 修复，别硬编译。
5. **声明本轮范围**：动笔前用一两句说明本轮要交付什么（哪几个模块、是否含 testbench、是否烧录），与用户确认后执行。**不要一轮做完整个系统**。

## 纪律

- 引脚、器件、时钟频率一律以 `board.yaml` / 指导书为准；数据文件没写的，用 `read_manual_page` 或 `web_search` 核实后再用，绝不臆造。
- 12MHz 时钟 `PIN_J5`、LED/按键/数码管低电平有效、IO 3.3-V LVTTL 是默认基线；HDMI 与 TFT-LCD 的 DISP 管脚互斥，I2C 的 SDA 必须 `inout` 加上拉。
- 工程名/路径不得含中文与空格（Quartus 18.1 限制）；用 `create_project` 而非手写 .qsf。
