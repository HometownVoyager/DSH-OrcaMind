---
name: godot-router
description: "godot-mcp skill 路由器 不确定用哪个流程 入口匝道 决策树 E2E 安全编辑 验证闭环 动画审计 —— 当你不确定该用哪个 godot-mcp 流程、或需要把任务分发到具体子流程时使用。简单单工具操作(改单行/单次截图)不要用本 skill,直接调工具"
---

## godot-mcp 流程路由（godot-ai 版）

本 skill 是 godot-mcp skill 体系的路由器。当你不确定该用哪个流程时，按以下决策树分发。

**何时用**：用户请求模糊（如「帮我改场景」「验证一下」），或一个任务跨多个 skill 时。

**主流程（想法 → 可交付）**：
- [ ] 1. 改代码/场景 → screenshot-verify 留证 → godot-mcp-safe-edit 编辑 → godot-mcp-verify-loop 验证
- [ ] 2. 不确定怎么改 → 用 `game_manage` / `node_get_properties` 读真实状态，不要纸面猜

**入口匝道（按任务类型分流）**：
- [ ] E2E 测试 / 模拟输入 / 回归测试 → `godot-runtime-e2e`
- [ ] 动画/动效不对劲（卡顿/无弹性/方向反）→ `godot-tween-taste`
- [ ] 视觉验证（操作前后截图对比）→ `screenshot-verify`
- [ ] 安全编辑（.gd/.tscn/.cs 改动）→ `godot-mcp-safe-edit`
- [ ] 交付前自检 → `godot-mcp-verify-loop`
- [ ] 从零做一个能玩的游戏 → `game-wizard`

**何时不用 skill**：
- 改单行 .gd → 直接 `script_patch`
- 只读探索（看场景结构）→ 直接 `scene_get_hierarchy` / `node_get_properties`
- 单次截图 → 直接 `editor_screenshot`

**常见偏离**：
- 每个操作都走路由器（过度：简单操作直接调工具，路由器只在不确定时用）
- 路由后不验证（漏：即使路由器分发，收尾仍需 verify-loop 或 screenshot-verify）
