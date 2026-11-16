---
name: godot-runtime-e2e
description: "运行时 E2E 验证 project_run game_manage 模拟输入 input_sequence 状态断言 get_scene_tree logs_read 回归测试 截图留证 —— 当你需要验证运行时行为、做 E2E 测试、模拟输入或回归测试时使用"
---

## 运行时验证 / E2E 流程（godot-ai 版）

把「确认连接 → 启动游戏 → 模拟输入 → 读运行态断言 → 留证收尾」串成 checklist。统一全量指南参见 `D:/Tools/GoDot/GODOT_MCP_GUIDE.md`。

**何时用**：验证运行时行为、E2E 测试、模拟输入、回归测试、Bug 复现时。

**checklist**：
- [ ] 1. `editor_state` 确认编辑器在线（godot-ai 是编辑器插件架构，编辑器没开一切免谈）
- [ ] 2. `project_run` 启动游戏（由编辑器拉起，attach 通道已就绪）
- [ ] 3. `game_manage` 模拟输入（op=`input_key` / `input_mouse` / `input_sequence` / `input_gamepad`）；`suspend` / `resume` / `next_frame` 可做逐帧控制
- [ ] 4. 断言：`game_manage`（op=`get_scene_tree` / `get_node_info` / `get_ui_elements`）读运行态核对状态变化（分数变了/蛇长了/砖块少了）
- [ ] 5. 留证：`editor_screenshot` 截图；`logs_read` 确认零 script error
- [ ] 6. 收尾：`project_manage(op="stop")` 停止；C# 项目另跑 shell `dotnet build <项目目录>`（退出码 0）

**常见偏离**：
- 编辑器没开就调 MCP 工具（应先让用户开编辑器）
- 节点路径写运行时 `/root/...` 形态（godot-ai 的 path 一律是**编辑器场景路径**，如 `/Main/Camera3D`，从 `scene_get_hierarchy` 或 `game_manage` 返回值里取）
- 只模拟输入不断言状态（输入不是证据，状态变化才是）
- 只读游戏态不停进程（收尾必须 stop，避免孤儿游戏窗口）
