---
name: moss-image-guide
description: "MOSS-Image 官方模型特性、提示词撰写规则与工作流配置指南（原生中英双语、参数推荐、文字渲染、D盘模型资产）。在生成 MOSS-Image 图像或配置其工作流时使用"
---

# MOSS-Image 官方特性与提示词指南

MOSS-Image 是 OpenMOSS 团队开源的 5B 单流 DiT 图像生成模型，原生支持中英双语提示词与中文海报文字渲染。

## 1. 本机模型资产（全部位于 D 盘）

| 角色 | 文件名 | 物理路径 | 节点加载配置 |
|---|---|---|---|
| Diffusion (SFT) | `moss_image_sft_int8_convrot.safetensors` | `D:\ComfyUI\models\diffusion_models\` | `UNETLoader` (weight_dtype: default) |
| Diffusion (Base) | `moss_image_base_int8_convrot.safetensors` | `D:\ComfyUI\models\diffusion_models\` | `UNETLoader` (weight_dtype: default) |
| Text Encoder | `qwen3.5_9b_w4a8_gptq.safetensors` | `D:\ComfyUI\models\text_encoders\` | `CLIPLoader` (type: `moss_image`) |
| VAE | `flux2-vae_small.safetensors` | `D:\ComfyUI\models\vae\` | `VAELoader` |

注：SFT 版本为精调版，遵循复杂指令与图文排版能力更强；Base 版本更偏向通用底模风格。

## 2. 官方推荐采样参数

- **分辨率**：标准 1024x1024（基于 EmptyFlux2LatentImage 节点）。
- **采样步数**：25 步。
- **CFG**：2.5（官方标准）。
- **采样器**：`er_sde`。
- **调度器**：`simple`。
- **层引导 (SLG)**：使用 `SkipLayerGuidanceDiTSimple`，跳过 `double_layers: "22"`，`start_percent: 0`，`end_percent: 0.5`。
- **负向提示词**：默认留空字符串 `""` 即可，MOSS-Image 无需复杂的通用负向质量词。

## 3. 提示词编写规范

1. **语言选择**：
   - 原生支持纯中文自然语言描述，无需刻意翻译为英文。
   - 英文自然语言同样支持，两者表意均准确。
2. **文本结构**：
   - 采用自然语言描述主体、画面风格、环境光影、景深与构图细节。
   - 例：“一只橘色的猫坐在木质窗台上晒太阳，窗外是春天的绿树，阳光透过树叶洒在猫身上，柔和的光影，浅景深，高清写真摄影。”
3. **中文海报与文字排版渲染**：
   - 画面中需要出现的文字直接写在提示词中或用引号注明（如：「新年快乐」）。
   - 若需精细控制文字位置，使用 Layout 工作流中的 `MOSSImageLayoutPrompt` 节点，配置 `element: text` 及 `character_boxes`，精确指定标语或文字位置。

## 4. 工作流模板位置

- 本地工作流库：`Workflows/moss-image/`
  - `moss-image-sft-t2i.json`（SFT 文生图，推荐）
  - `moss-image-base-t2i.json`（Base 文生图）
  - `moss-image-layout-t2i.json`（版面与文字引导文生图）
- ComfyUI 内部官方模板备份：`D:\ComfyUI\MOSS-templates\`（界面导出格式，含 `nodes`/`links`，**不可**直接传给 `generate_comfyui` 的 `workflow_path`；需要的话请在 ComfyUI 里用「Save (API Format)」另存）

## 5. 官方提示词增强技能（已本地留存）

官方开源仓库 `OpenMOSS/MOSS-Image` 提供 `skills/moss-image-prompt-enhancer`，已完整下载到
本预设技能目录 `Plugins/dsh-user-presets/skills/comfyui-work/moss-image-prompt-enhancer/`（含
`SKILL.md`、`references/layout.md`、`scripts/compile_prompt.py`、`scripts/test_compile_prompt.py`、
`agents/openai.yaml`）。

适用时机：把用户的粗略构思扩写成详细 caption，或需要精确控制文字/元素摆放位置的 **Layout** 草稿。

**Layout 模式务必使用官方编译器，不要手算坐标**：模型实际接收的是 `abs_centralized` / `yxyx`
格式的居中坐标（每个盒子先按像素边缘取整，再分别减去 height/2 与 width/2，顺序为 y1,x1,y2,x2），
手算必错。`compile_prompt.py` 负责这步换算并校验越界盒子：

```bash
python "D:/Tools/DeepSeek Harness/Plugins/dsh-user-presets/skills/comfyui-work/moss-image-prompt-enhancer/scripts/compile_prompt.py" \
  draft.json --output prompt.txt
```

草稿约定要点：宽高必须是 16 的正整数倍且与生图分辨率一致；`bbox_coord_space="abs"`、
`bbox_format="xyxy"`；盒子为画布左上角起算的实际像素 `[x_min,y_min,x_max,y_max]`；
`label` 取 `object` / `character` / `text`；text 项必须带精确的可见字符串 `text`。
编译产物是一行紧凑 JSON，**直接作为正向提示词**贴给 MOSS-Image。

## 6. 执行方式推荐

1. **直接调用 `generate_comfyui`（最推荐）**：
   - 纯中文提示词自动选路 MOSS-Image，自动设置推荐参数（步数 25、CFG 2.5、er_sde+simple、SLG 22 层跳层）。
   - 或显式指定模板：`generate_comfyui(prompt="...", workflow_path="Workflows/moss-image/moss-image-sft-t2i.json")`。
2. **通过 `comfy-mcp` 的 `run_workflow`**：
   - 调用 `mcp__comfyui__run_workflow(workflow_path="D:/Tools/DeepSeek Harness/Workflows/moss-image/moss-image-sft-t2i.json", wait=True)`。
