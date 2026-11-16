# MOSS-Image 标准工作流模板库

本目录收录 MOSS-Image 经过实测验证的 3 组标准 API 格式工作流，与 D 盘模型文件一一对应。

## 模型资产对应关系（均在 D 盘）

- **UNET / Diffusion**：
  - SFT 版本：`D:\ComfyUI\models\diffusion_models\moss_image_sft_int8_convrot.safetensors`
  - Base 版本：`D:\ComfyUI\models\diffusion_models\moss_image_base_int8_convrot.safetensors`
- **Text Encoder**：
  - `D:\ComfyUI\models\text_encoders\qwen3.5_9b_w4a8_gptq.safetensors`（CLIPLoader 类型为 `moss_image`）
- **VAE**：
  - `D:\ComfyUI\models\vae\flux2-vae_small.safetensors`

## 工作流清单

1. `moss-image-sft-t2i.json`
   - **用途**：精调版文生图（指令遵循好，推荐用于绝大部分场景）
   - **关键修改点**：节点 `3`（CLIPTextEncode 提示词）、节点 `7`（KSampler 种子 seed / steps / cfg）
2. `moss-image-base-t2i.json`
   - **用途**：基础版文生图（泛化与艺术质感）
   - **关键修改点**：节点 `3`（CLIPTextEncode 提示词）、节点 `7`（KSampler 种子与采样）
3. `moss-image-layout-t2i.json`
   - **用途**：带排版与文字渲染引导的文生图
   - **关键修改点**：节点 `19`（CreateBoundingBoxes 排版元素框列表）、节点 `20`（MOSSImageLayoutPrompt 整体描述及 `character_boxes` 标注）

## 官方推荐参数约定

- 分辨率：1024x1024
- 步数：25
- CFG：2.5
- 采样器：`er_sde` / 调度器：`simple`
- SLG（跳层）：跳第 22 层（SkipLayerGuidanceDiTSimple 节点已预设）
- 负向提示词：保持留空字符串 `""`

## 调用方式

### 方式 1：通过 `dsh-image-mcp` 的 `generate_comfyui`（全自动/开箱即用）
- **自动路由**：直接调用 `generate_comfyui(prompt="...")`，中文提示词且本地有 MOSS-Image 时会自动路由到 MOSS-Image 构图。
- **显式指定模板**：调用 `generate_comfyui(prompt="...", workflow_path="Workflows/moss-image/moss-image-sft-t2i.json", seed=123456)`，工具将自动解析并智能注入提示词、种子和尺寸，自动完成落盘与图片卡片返回。

### 方式 2：通过 `preset-comfyui-work` 的官方 `comfy-mcp`（工作流调度）
- 调用 `mcp__comfyui__run_workflow(workflow_path="D:/Tools/DeepSeek Harness/Workflows/moss-image/moss-image-sft-t2i.json", wait=True)` 提交并等待执行。

