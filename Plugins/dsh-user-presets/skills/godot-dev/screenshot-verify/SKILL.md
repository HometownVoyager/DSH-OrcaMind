---
name: screenshot-verify
description: "视觉验证闭环 截图留证 editor_screenshot 操作前后对比 渲染确认 视觉回归 —— 当你做了会影响视觉的操作、需要确认渲染结果、或怀疑渲染退化时使用"
---

## 视觉验证闭环（操作前后留证，godot-ai 版）

本 skill 是视觉验证原语，其他 skill 可 reach。核心原则：任何影响视觉的操作，操作前后都截图留证，对比确认。

**checklist**：
- [ ] 1. `editor_screenshot` — 操作前截图（基线留证）
- [ ] 2. 执行变更操作（`script_patch` / `node_manage` / `material_manage` 等）
- [ ] 3. `editor_screenshot` — 操作后截图（同视角同对象）
- [ ] 4. 人工或 AI 对比前后差异；异常项回 godot-mcp-safe-edit 修复后重验
- [ ] 5. 需要游戏画面（非编辑器视口）时：`project_run` 后对照运行窗口，或 `game_manage`（op=`get_ui_elements`）确认 UI 元素存在

**常见偏离**：
- 只截操作后不截操作前（漏基线，无法对比退化）
- 把编辑器视口截图当游戏运行画面（两者视口不同；游戏画面以 `project_run` 的窗口为准）
- 截图不记录操作上下文（留证要能对回「哪次改动的哪个状态」）
