---
name: godot-mcp-verify-loop
description: "验证闭环 script_patch test_run logs_read dotnet build 交付门禁 编译 跨文件依赖 parse error 场景树完整性 —— 当你改完代码/场景需要验证或交付前自检时使用"
---

## 改 → 跑 → 验证闭环（godot-ai 版）

把「理解 → 改 → 跑 → 验证 → 交付门禁」串成 checklist，避免只跑一种验证就交付。统一全量指南参见 `D:/Tools/GoDot/GODOT_MCP_GUIDE.md`。

**何时用**：改完代码/场景后需要验证、交付前自检时。

**checklist**：
- [ ] 1. `scene_get_hierarchy` / `node_get_properties` / `script_manage(op="read")` — 理解现有结构
- [ ] 2. `script_patch`（精准补丁）/ `script_create` — 修改，**返回值零 parse error 才继续**
- [ ] 3. `test_run` — 跑测试（结果经 `test_manage(op="results_get")` 取回）
- [ ] 4. 运行时冒烟：`project_run` → `game_manage` 模拟输入 + 读运行态 → `logs_read` 零 error → `project_manage(op="stop")`
- [ ] 5. C# 专项：所有 .cs 改动 shell `dotnet build <项目目录>` 退出码 0（跨文件依赖/类型错误只有编译能兜住）
- [ ] 6. 交付门禁：parse 零错 + 测试全过 + 冒烟状态符合预期 + 日志零错误，四项齐才交付

**常见偏离**：
- script_patch 报错仍继续改下一处（带病叠加，回滚成本指数涨）
- GDScript 过了不查 C#（两套语言两条验证线，缺一不可）
- 只跑测试不做运行时冒烟（测试绿不代表玩法对）
