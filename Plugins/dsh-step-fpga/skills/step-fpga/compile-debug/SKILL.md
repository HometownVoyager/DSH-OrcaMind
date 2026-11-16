---
name: compile-debug
description: "编译-仿真-报告闭环：create_project→write_source→set_assignments→compile→get_report→simulate，编译失败先读报告再改代码，禁止盲改 —— 编译 Quartus 工程、定位 Error(20004)/Fitter 报错或跑 ModelSim 时使用"
---

# 编译与调试闭环（STEP FPGA / Quartus 18.1）

标准顺序，不跳步：

```
get_toolchain
create_project(name, top)
write_source(project, "top.v", <Verilog>)       # 可多个模块文件 + tb.v(register=false)
set_assignments(project, pins=..., add_clock=true)
compile(project, mode="full")                   # 或 mode="step" 逐阶段定位
get_report(project, detail=true)                # 必读！
simulate(project, sources=["top.v","tb.v"], top="tb")  # 有 testbench 时
jtag_status / program                           # 接板才做
```

## 编译失败处理

1. **先 `get_report(detail=true)`**，看 `flow.errors` / `verdict` / `messagesByFile`，不要凭 `stdoutTail` 猜。
2. 常见错误：
   - `Error (20004) family "MAX 10" not installed` → `get_toolchain().checks.max10_devinfo_55nm` 为 false，按 hint 从 `max10-18.1.0.625.qdz` 补 `quartus/common/devinfo/55nm/`。
   - `Can't elaborate / undefined module` → 顶层实体名与 `top` 不一致，或 `write_source` 没登记进 .qsf（用 `read_project` 查）。
   - `Error (169177)/引脚冲突` → 回 `pin-constraints` 技能核对复用关系。
   - 时序不收敛 → 看 `sta.worstSetupSlackNs` 是否 < 0，先查 `.sdc` 是否生效。
3. 改代码/约束后**重新 `compile`**；`create_project(overwrite=true)` 会清掉旧 db/output_files，适合彻底重建。
4. `get_report` 里 `verdict=PASS` 且 `sofGenerated=true` 才算编译交付完成；`PASS with N warnings` 要能逐条解释警告来源。

## 仿真

- `simulate` 自动先建 `work` 库再 `vlog`、`vsim -c`；testbench 里用 `$display` 打关键信号、用 `$finish` 收尾。
- `transcriptTail` 里有 `SMOKE_OK` 之类标记、`issues` 为空、`ok=true` 才算仿真通过。
- 仿真只验证逻辑，不等价于上板；引脚/电气问题仍以 `get_report` + 实测为准。

## 烧录

`program` 会先 `jtag_status`；未接 USB-Blaster 时返回 `hardware:"absent"`，属正常，不算编译失败，也不要反复重试。
