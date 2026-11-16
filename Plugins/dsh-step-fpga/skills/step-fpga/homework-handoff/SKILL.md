---
name: homework-handoff
description: "作业/竞赛交付规范：整理工程目录、报告摘要、源码清单与可复现步骤，明确未上板验证项 —— 完成一个 STEP FPGA 实验、要交付作业/提交竞赛材料或写实验报告时使用"
---

# 交付整理（作业 / 竞赛）

编译通过后按此结构交付，避免"说做完但拿不出东西"。

## 交付物

1. **工程目录**：`projects/<name>/` 下的 `.qpf` / `.qsf` / `.sdc` / 全部 `.v` 源码 / `output_files/<name>.sof`。用 `read_project(project)` 拉出文件清单与体积。
2. **编译结论**：`get_report(project)` 的 `verdict`、`flow.flowStatus`、Fmax（`sta.fmax`）、最差 slack、逻辑资源（`flow.logicUtilization` / `pins`）、warnings 条数与解释。
3. **仿真结论**（若有）：`simulate` 的 `ok` + `transcriptTail` 关键输出。
4. **可复现步骤**：从 `create_project` 到 `program` 的调用序列 + 关键参数（pins、top、时钟），让评阅者能重跑。
5. **原理说明**：实验对应的指导书章节/页码（`list_experiments` + `read_manual_page`），模块划分与设计要点，一句话说清。

## 必写明的限制（诚实交付）

- 未接板卡 / `jtag_status().connected=false` 时，明确写「**仅完成编译与仿真，未上板验证**」，`program` 返回 `hardware: absent` 照实说，不要声称已烧录。
- MAX 10 的 `.sof` 掉电丢失；需要固化时说明要另用 `quartus_cpf` 转 `.jic`（本 MCP 未封装，需手动）。
- 指导书扫描页/图片内容以 `read_manual_page(render=true)` 目视确认过的为准，别把没看过的图当结论。

## 禁止

- 不把 `stdoutTail` 的几十行日志当交付结论；一切以 `get_report` 的结构化字段为准。
- 不口头宣称「功能正确」；逻辑正确性由 testbench 断言或上板现象支撑，二选一写清楚。
