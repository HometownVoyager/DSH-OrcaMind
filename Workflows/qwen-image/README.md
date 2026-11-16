# Qwen Image 2.1 标准工作流模板库

本目录收录 Qwen Image 2.1 实测验证的标准 API 格式工作流，与本地模型资产无缝对应。

## 模型资产对应关系

- **UNET / Diffusion**：
  - 标准版：`qwen_image_2.1_int8_convrot.safetensors`
  - Turbo 极速版：`qwen_image_2.1_turbo_int8_convrot.safetensors`
- **Text Encoder**：
  - `qwen3vl_8b_w4a8.safetensors`（CLIPLoader 类型为 `qwen_image`）
- **VAE**：
  - `qwen_image_2.1_vae_bf16.safetensors`

## 工作流清单

1. `qwen-image-2.1-t2i.json`
   - **用途**：Qwen Image 2.1 标准文生图（40 步，精细度高，通用画面质感强）
   - **推荐参数**：步数 40，CFG 1.0，采样器 euler / 调度器 simple，分辨率 1024x1024
2. `qwen-image-2.1-turbo-t2i.json`
   - **用途**：Qwen Image 2.1 Turbo 极速文生图（8 步极速出图，出图仅需数秒）
   - **推荐参数**：步数 8，CFG 1.0，采样器 euler / 调度器 simple，分辨率 1024x1024

## 调用方式

- **通过 `dsh-image-mcp` 的 `generate_comfyui`**：
  ```json
  {
    "prompt": "A serene forest path with sunbeams through the canopy, photo",
    "workflow_path": "Workflows/qwen-image/qwen-image-2.1-t2i.json"
  }
  ```
  工具将自动解析并智能注入提示词、种子与分辨率，全自动完成落盘与会话图片返回。
