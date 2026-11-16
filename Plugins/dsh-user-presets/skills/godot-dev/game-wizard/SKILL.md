---
name: game-wizard
description: "游戏开发一条龙向导 从零做游戏 小白新手 2048 贪吃蛇 打砖块 godot-ai 验证 试玩 分享 —— 当用户说「做个游戏/我是新手/不知道从哪开始/帮我做一个能玩的游戏」或想要从想法到可分享游戏的完整引导时使用"
---

# 游戏一条龙向导(game_wizard)

把「想法 → 可玩 → 验证 → 可分享」串成阶段机,**每阶段有硬性 gate**——不问「文档写了吗」,问「游戏跑通了吗」。基于 godot-ai MCP(编辑器实时闭环)+ shell 兜底。

**何时不适用**:3D 大型项目/多人协作管线(本向导面向个人小游戏的第一次成功交付)。

## 第 0 步:四档分诊(先问一句,不要跳过)

| 档 | 用户画像 | 入口 |
|---|---|---|
| **A 没想法** | 「随便,好玩就行」 | 展示三模板一句话介绍(见下),让用户挑一个 + 说一个想改的点 |
| **B 模糊** | 「想做个消除类的/像贪吃蛇那样的」 | 问 2-3 个澄清:①玩法像哪个模板?②想要更快/更难/更大棋盘?③想改什么(速度/数值/规则)?→ 映射模板+调参方向 |
| **C 清晰** | 「做一个 2048,棋盘 5×5,出 4 概率高一点」 | 直接进 S1,需求映射到 GDD+调参表 |
| **D 已有项目** | 「我有个 Godot 项目想加点东西」 | 跳过 S1/S2 的模板部分,直接接入现有项目;验证/分享阶段(S3+)同款适用 |

三模板(选型即终局,别过度发散):
- **2048**——数字滑块合并,手脑放松,调参面:棋盘/胜利值/出 2 概率
- **贪吃蛇**——节奏紧张,调参面:速度/网格/穿墙
- **打砖块**——手感控球,调参面:挡板宽/球速/砖墙/生命

## 阶段机(顺序执行,每阶段 gate 不过不进下一阶段)

### S0 连接(硬前提)
- godot-ai 是「编辑器插件 + bridge」架构:**必须先让用户打开 Godot 编辑器并载入目标项目**(godot_ai 插件已启用);
- gate:`mcp__godot-ai__editor_state` 返回在线状态(含项目路径);不可用则请用户开编辑器,**不要盲目重试**;
- 引擎未装的情况:引导用户从官方 releases 安装(Godot 4.7.2 .NET 已预装于 `D:/Tools/GoDot/Godot_v4.7.2/`)。

### S1 造(在编辑器里搭出可玩 demo)
1. `scene_manage(op="create")` 建主场景(2D 用 Node2D 根;2048/贪吃蛇/打砖块均为 2D);
2. `node_create` 搭节点树(玩家/棋盘/UI 层),`script_create` 写 GDScript(返回 parse 校验,零错误才算过);
3. `project_manage(op="set_main_scene")` 设主场景;
- gate:`script_patch`/`script_create` 全部零 parse error,`scene_get_hierarchy` 结构完整,`project_run` 能拉起窗口。

### S2 改玩法(先 GDD 后代码)
1. 把玩法规则写成 `design/gdd/<slug>.md`(8 段设计文档)→ 与用户对齐要改的段;
2. **改数值**:集中到单一调参源(GDScript 常量区或 .tres 资源),`filesystem_manage(op="write_text")` / `script_patch` 修改;
3. **改规则**:改 `scripts/game.gd`(遵循 GDD 先更新),改完零 parse error;
4. gate:向导能向用户复述「改了什么、预期玩家体验变化」。

### S3 验证(硬门——本向导的灵魂)
- **运行时冒烟**:`project_run` 启动 → `game_manage`(op=`input_key`/`input_sequence`)按真实玩法驱动(如 2048 按方向键、蛇吃一次食物)→ `game_manage`(op=`get_scene_tree`/`get_node_info`)校验状态变化(分数变了/蛇长了/砖块少了)→ `project_manage(op="stop")`;
- **日志门**:`logs_read` 无 script error / push_error;
- **C# 项目**(如 .NET 工程):所有 C# 改动另行走 shell `dotnet build <项目目录>`,退出码 0;
- gate:冒烟操作全部符合预期 + 日志零错误;不达标 → 逐条修完重验。

### S4 导出(浏览器可玩,走 shell)
```bash
"D:/Tools/GoDot/Godot_v4.7.2/godot_console.exe" --headless --path <项目目录> --export-release "Web" build/web/index.html
```
- 首次需要 export templates(~1GB,编辑器 Editor → Manage Export Templates 下载,向用户确认后再装);
- gate:`build/web/index.html` 生成,本地起静态服务(如 `python -m http.server` 或任意静态服务器)浏览器打开可玩。

### S5 分享
- `editor_screenshot` 截关键画面;`build/web/` 目录部署到任意静态托管;
- 收尾清单:①S3 验证证据(冒烟结论+日志零错误)②截图 ③GDD(设计复盘素材)。

## 硬规则(向导纪律)

1. **S3 运行时冒烟是唯一 gate 真相**——不以「看起来能跑」「没报错」放行;
2. **改玩法顺序:GDD → 调参源 → 代码**;
3. 每阶段结束向用户**复述当前状态与下一步**,小白不该猜进度;
4. 编辑器必须开着;所有经编辑器 MCP 的改动都在编辑器 undo 范围内,可回退。

## 常见偏离

- 跳过 S3 直接导出 → 打回来:未验证的玩法不是「能玩」;
- 编辑器没开就想跑 MCP 工具 → 打回 S0:先开编辑器;
- 用户要加「一点小功能」导致跨档 → 保持模板纪律(新功能写进 GDD),不破坏阶段机。
