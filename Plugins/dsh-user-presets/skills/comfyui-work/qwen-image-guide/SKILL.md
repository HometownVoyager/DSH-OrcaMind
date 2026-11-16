---
name: qwen-image-guide
description: "Qwen Image 2.1 官方模型特性、提示词撰写规则与工作流配置指南（Turbo 8步/标准40步、参数推荐、D盘模型资产）。在生成 Qwen Image 图像或配置其工作流时使用"
---

# Qwen Image 2.1 特性与提示词指南

Qwen Image 2.1 是通义开源的高质量图像生成模型，具备极高的写实画面质感与艺术表现力。

## 1. 本机模型资产

| 角色 | 文件名 | 节点加载配置 |
|---|---|---|
| Diffusion (标准版) | `qwen_image_2.1_int8_convrot.safetensors` | `UNETLoader` (weight_dtype: default) |
| Diffusion (Turbo 极速版) | `qwen_image_2.1_turbo_int8_convrot.safetensors` | `UNETLoader` (weight_dtype: default) |
| Text Encoder | `qwen3vl_8b_w4a8.safetensors`（本地工作流用） / `qwen3vl_8b_int8_convrot.safetensors`（官方模板默认） | `CLIPLoader` (type: `qwen_image`, device: default) |
| VAE | `qwen_image_2.1_vae_bf16.safetensors` | `VAELoader` |
| Cache 节点 (可选加速) | `QwenImage21Cache` | 连接于 UNETLoader 与 KSampler 之间 |

## 2. 推荐采样参数

- **分辨率**：推荐 1024x1024（基于 EmptySD3LatentImage 节点）。
- **标准版**：40 步，CFG 1.0，采样器 `euler` / 调度器 `simple`。
- **Turbo 版**：8 步，CFG 1.0，采样器 `euler` / 调度器 `simple`。
- **潜空间**：优先使用 `EmptySD3LatentImage`（更佳对比度与结构稳定性）。

## 3. 工作流模板位置

- 本地工作流库：`Workflows/qwen-image/`
  - `qwen-image-2.1-t2i.json`（标准 40 步，精细高品质）
  - `qwen-image-2.1-turbo-t2i.json`（Turbo 8 步，极速生图）

## 4. 图像编辑（Image Edit / i2i）与提示词增强

Qwen Image 2.1 的图像编辑走 `TextEncodeQwenImage21` 的 **`images` 自动增长输入口**（最多 16 张参考图，
官方模板实际暴露 10 个），参考图会被文本编码器看见、同时以 VAE latent 形式拼进序列。

### 必需的提示词增强（PE）权重

官方 Comfy-Org 模板挂了一个 `TextGenerate` 环节，先用 Qwen3.5-9B 把用户的简短指令改写成
结构化长提示词，再喂给生成模型。这一步依赖 **PE 专用权重**，本机已备齐：

| 用途 | 文件 |
|---|---|
| 文生图增强 | `text_encoders/qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors` |
| 图像编辑增强 | `text_encoders/qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors` |

> **t2i 与 i2i 是两个不同权重，不可混用**：编辑任务必须用 `pe_i2i`。用 t2i 权重改写编辑指令
> 会得到偏「重新生成」而非「在原图基础上改」的提示词。两者均已落地到 `D:\ComfyUI\models\text_encoders\`。

### `resolution` 参数取值（易踩坑）

`TextEncodeQwenImage21` 的 `resolution` **不是宽高**，而是**总像素预算**：参考图被等比缩放到约
`resolution × resolution` 像素（按 32 取整、保持宽高比）。设为 `0` 表示每张参考图保留自身尺寸
（仍按 32 取整）。**官方默认 1024，模型原生上限 2048（2K）**，并非 ComfyUI 节点 schema 标的 4096；
超过 2048 属越界使用。

### `generate_comfyui` 的图像编辑（i2i）用法

`generate_comfyui` 已原生支持参考图：传 `input_images` 即进入图生图/图像编辑模式。

    generate_comfyui(
      prompt="把这只猫改成在雪地里",
      input_images=["D:/path/to/cat.png"],   # 1–16 张，绝对路径
      pipeline="qwen_image",                  # 可省略（auto 会自动路由到 Qwen）
    )

工具会自动完成三件事，无需手工编排：

1. 把参考图上传到 ComfyUI 的 `input` 目录（`/upload/image`）——`LoadImage` 读不到
   ComfyUI input 目录之外的任意绝对路径，直接传工作区路径会被服务端拒绝；
2. 生成 `LoadImage` 节点并接到 `TextEncodeQwenImage21` 的自动增长口（API 图里展平写作
   `"images.image_1"` 键，槽位上限 16）；
3. 把 `KSampler` 的潜空间切到 `TextEncodeQwenImage21` 的第 3 个输出——它按第一张参考图的
   尺寸算 latent；沿用 t2i 的固定尺寸会让编辑结果整体偏移。

> **参考图只支持 Qwen Image 2.1 管线**：MOSS-Image 与 SD1.5 没有参考图入口。若当前路由会
> 落到它们（显式 `pipeline="moss_image"`、指定了 `checkpoint`、或指定了 MOSS 的文本编码器），
> 工具会**直接报错**，而不是静默忽略参考图（那样图照出，却和参考图毫无关系）。

## 5. 执行方式推荐

1. **文生图（推荐）**：直接 `generate_comfyui(prompt="...")`，英文提示词自动路由到 Qwen Image 2.1
   （本机有 Turbo 权重时优先 Turbo 8 步），自动注入参数、种子并完成落盘。
2. **图像编辑（推荐）**：`generate_comfyui(prompt="...", input_images=[...])`，自动上传参考图并接管构图。
3. **指定模板**：`generate_comfyui(prompt="...", workflow_path="Workflows/qwen-image/qwen-image-2.1-t2i.json")`。
4. **需要官方 PE 提示词增强环节**：才需经 `comfy-mcp` 走官方 image edit 模板（依赖 `pe_i2i` 权重）。
