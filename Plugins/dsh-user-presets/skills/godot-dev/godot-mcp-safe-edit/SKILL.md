---
name: godot-mcp-safe-edit
description: "安全编辑 script_patch script_create scene_file 守卫 node_manage delete 可撤销 编辑器 undo dotnet build C# 防误用 tab 缩进 —— 当你编辑 .gd/.tscn/.cs、删节点或执行危险操作时使用"
---

## 安全编辑流（godot-ai 版）

编辑 `.gd`/`.tscn`/`.cs`、删节点、执行危险操作时的防护 checklist。统一全量指南参见 `D:/Tools/GoDot/GODOT_MCP_GUIDE.md`。

**checklist**：
- [ ] 1. 改 `.gd` **优先 `script_patch`**（精准补丁、返回 parse 校验并热重载）；整文件新建用 `script_create`。**禁用内置 Edit 工具改 .gd**（tab 缩进匹配率极低，且无校验回路）
- [ ] 2. 改 `.tscn` 走场景工具（`node_manage` / `node_set_property` / `node_create`），**不要手写 .tscn 文本**（uid/格式极易损坏整场景）
- [ ] 3. 防覆盖：所有写操作支持 `scene_file` 守卫——传当前场景文件名，编辑器当前场景不符时直接报 `EDITED_SCENE_MISMATCH` 拒绝写入
- [ ] 4. 删节点用 `node_manage(op="delete")`（场景根不可删；全部操作在编辑器 undo 范围内可回退）
- [ ] 5. C# 专项：写 .cs 走 `script_create` / `filesystem_manage(op="write_text")`（文本级，不编译）——**每次改动必须 shell `dotnet build <项目目录>` 验证，退出码 0 才算过**
- [ ] 6. 大批量定位用 `filesystem_manage`（op=`scan` / `search` 先找后动）

**常见偏离**：
- 用内置 Edit 改 .gd（tab 缩进失败 + 无 parse 回路）
- 手写 .tscn 文本（一个 uid/格式错就整场景损坏）
- C# 改完不 dotnet build（godot-ai 不报 C# 编译错误，这是唯一防线）
