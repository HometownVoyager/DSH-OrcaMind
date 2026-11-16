# dsh-image-mcp

DSH 生图 MCP 服务器（stdio，零依赖单文件 `server.mjs`）。给 DSH 里**所有**模型（Gemini / Claude / DeepSeek / Qwen / GLM……）提供三个生图工具：

| 工具 | 后端 | 说明 |
|---|---|---|
| `mcp__image__generate_nano_banana_2` | Antigravity OAuth | NB 2.1 完整版：先试 `gemini-nano-banana-2.1`（2026-10-06 GA），后端未推送时自动回落到当前唯一可用的图像模型（`gemini-3.1-flash-image`） |
| `mcp__image__generate_nano_banana_2_lite` | Antigravity OAuth | NB2 Lite（Gemini 3.1 Flash Image），实测可用，速度最快额度消耗最低 |
| `mcp__image__generate_comfyui` | 本机 ComfyUI HTTP API | 需 ComfyUI 正在运行；**auto 模式智能路由**：中文/海报文字排版优先走 **MOSS-Image**（5B SFT/Base 25步 er_sde+simple，cfg 2.5），英文/通用走 **Qwen Image 2.1**（Turbo 8 步/标准 40 步），无上述模型回落 SD1.5；支持入参 `workflow_path` 或环境变量传入自定义工作流模板 |

- 协议：MCP stdio（newline-delimited JSON-RPC），由 DSH 内置的 `@deepseek-ai/dsh-mcp-client` 拉起；这不是 cordis 插件，不需要装进 profile 的 node_modules，profile 里一条 `mcp-image` 配置即可
- 生成结果以**图片块**直接进会话（当前模型需接受图片输入），同时落盘
- **保存位置**：每个工具都接受 `save_dir`（绝对路径，或相对 DSH 工作区根的相对路径，如 `generated-images`、`Artifact/封面`）和 `filename`；都不传则落 `DSH_IMAGE_SAVE_DIR`（默认 `我的图片\DSH-Images`）
- Antigravity 路线复用 `.dsh/storages/antigravity-oauth.json` 凭据（与 dsh-antigravity 插件共享，自动刷新 token），消耗**同一个 Gemini 额度池**；生产端点图像 429 时自动切 sandbox 端点
- NB 2.1（`gemini-nano-banana-2.1`）2026-10-06 已在公开 API GA，但 2026-10-07 实测 Antigravity 后端仍未推送（2.1 及 9 个候选变体全 404）——`generate_nano_banana_2` 做成 ID 链自动回落（2.1 预铺链首），后端推送即自动启用，无需改代码

## Qwen Image 2.1 工作流（照抄用户 2026-09-22 实测图）

`UNETLoader(qwen_image_2.1_int8_convrot) → QwenImage21Cache(auto/default) → KSampler(euler/simple, 默认 40 步 cfg 1)`；
正负条件走 `CLIPLoader(qwen3vl_8b_w4a8, type=qwen_image) → TextEncodeQwenImage21`（prompt / negative_prompt / resolution；多参考图编辑也支持，纯文生图不带 images）；
潜空间用 `EmptySD3LatentImage(width,height)`，`VAELoader(qwen_image_2.1_vae_bf16)` 解码。
默认自动选路：unet 列表里有 qwen_image 就走 Qwen，参数 `model` / `text_encoder` / `vae` / `checkpoint` 可手动指定。

## ComfyUI 本机模型资产（2026-10-23 核对）

| 角色 | 文件 | 状态 |
|---|---|---|
| Qwen 2.1 DiT（标准） | `diffusion_models/qwen_image_2.1_int8_convrot.safetensors` | 完整 |
| Qwen 2.1 DiT（Turbo） | `diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors` | 完整 |
| MOSS DiT（SFT/Base） | `diffusion_models/moss_image_{sft,base}_int8_convrot.safetensors` | 完整 |
| Qwen 文本编码器 | `text_encoders/qwen3vl_8b_{int8_convrot,w4a8}.safetensors` | 完整 |
| MOSS 文本编码器 | `text_encoders/qwen3.5_9b_w4a8_gptq.safetensors` | 完整 |
| Qwen PE(t2i) 提示词增强 | `text_encoders/qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors` | 完整 |
| Qwen PE(i2i) 提示词增强 | `text_encoders/qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors` | 完整 |
| SDXL 底模 | `checkpoints/sd_xl_base_1.0.safetensors` | 完整 |

> PE 两个变体用于官方 Qwen Image 2.1 **图像编辑**工作流里的 `TextGenerate` 提示词增强环节
> （t2i 走文生图增强、i2i 走图像编辑增强），缺了会走不了官方 image edit 模板。
> `sd-v1-5-inpainting.ckpt` 仍在盘上但**被自动过滤**（9 通道语义与标准 4 通道文生图不兼容）。

## 图像编辑（i2i）用法

`generate_comfyui` 传 `input_images` 即进入图生图/图像编辑模式（1–16 张，绝对路径）：

    generate_comfyui(prompt="把这只猫改成在雪地里", input_images=["D:/path/to/cat.png"])

工具自动完成三件事：

1. **上传参考图**到 ComfyUI 的 `input` 目录（`/upload/image`）。`LoadImage` 只认自己 input
   目录里的名字，直接把工作区绝对路径塞给它会被服务端路径穿越检查拒绝（HTTP 400）。
2. 生成 `LoadImage` 节点并接到 `TextEncodeQwenImage21` 的自动增长口——API 图里必须展平成
   `"images.image_1"` 这种点号键，传嵌套对象或数组会被 `build_nested_inputs()` 处理成空值，
   参考图**静默丢失**（图照出，但和参考图无关）。槽位上限 16。
3. 把 `KSampler` 的潜空间切到 `TextEncodeQwenImage21` 的第 3 个输出（按第一张参考图尺寸算的
   latent）。沿用它 t2i 的固定尺寸会让编辑结果整体偏移。

> 参考图仅 Qwen Image 2.1 管线支持。若路由会落到 MOSS-Image / SD1.5（显式 `pipeline`、
> 指定了 `checkpoint`、或指定了 MOSS 的文本编码器），工具**直接报错**而不是静默忽略。

## 环境变量（在 profile 的 `cordis.patch.yml` 里配）

| 变量 | 默认 | 含义 |
|---|---|---|
| `DSH_IMAGE_CRED_PATH` | `DSH_HOME/storages/antigravity-oauth.json` | Antigravity OAuth 凭据 |
| `DSH_IMAGE_ENDPOINTS` | 官方生产 + sandbox | CloudCode 端点（逗号分隔，按序回落） |
| `DSH_IMAGE_NB2_MODELS` | `gemini-nano-banana-2.1,gemini-3.1-pro-image,gemini-3-pro-image-preview,gemini-3.1-flash-image` | NB 2.1 完整版的模型 ID 链（链首 404 时逐级回落） |
| `DSH_IMAGE_LITE_MODELS` | `gemini-3.1-flash-image` | Lite 的模型 ID 链 |
| `DSH_IMAGE_BASE_DIR` | 本脚本上两级（= DSH 工作区根） | 相对 `save_dir` 的基准目录 |
| `DSH_IMAGE_SAVE_DIR` | `我的图片\DSH-Images` | `save_dir` 未指定时的落盘目录 |
| `DSH_IMAGE_COMFY_URL` | 自动试 `127.0.0.1:8000` / `8188` | ComfyUI 地址 |
| `DSH_IMAGE_COMFY_WORKFLOW` | （无） | API 格式工作流模板路径；占位符 `%prompt%` `%negative_prompt%` `%checkpoint%` `%width%` `%height%` `%steps%` `%cfg%` `%seed%` `%batch%`（数值占位符写成字符串，替换时自动转数字）；模板模式下不自动选路 |

## 已修复（2026-10-23 第二轮审查：参考图与恶性静默错误）

- **P0 `generate_comfyui` 只能文生图，接不了参考图**（本次主要缺口）：`qwenGraph()` 从未接
  `TextEncodeQwenImage21` 的 `images` 口，也没有 `LoadImage` 前置节点，`pe_i2i` 权重形同虚设。
  现新增 `input_images` 参数（1–16 张），自动上传参考图、接线并切换到参考图尺寸的 latent。
  三个关键坑都已实测确认并在代码里规避：
  - `LoadImage` 只认 ComfyUI input 目录内的名字，传工作区绝对路径会被路径穿越检查拒绝（实测 HTTP 400
    `Invalid image file`）→ 必须先 `/upload/image` 上传；
  - 自动增长口在 API 图里必须展平成 `"images.image_1"` 点号键。传嵌套对象或数组虽能通过校验，
    但会被 `build_nested_inputs()` 处理成空值，**参考图静默丢失**（图照出、和参考图无关）——
    这是最难发现的一类错误；
  - 有参考图时要用 `TextEncodeQwenImage21` 的第 3 个输出做 latent，沿用 t2i 的固定尺寸会让编辑
    结果整体偏移（节点注释：`any other size shifts the edit`）。
- **P0 `CreateBoundingBoxes` 改尺寸导致排版静默错位**：`applyTemplateOverrides` 原来只把
  模板画布的 `width`/`height` 改成入参值，而 `editor_state` 里的标注框仍是**旧画布的绝对像素坐标**，
  于是改 2048 时所有框都挤在左上角——图正常出图、排版却是坏的。现新增
  `scaleBoundingBoxesState()`，改画布尺寸时同步等比缩放标注框。
- **P1 `resolution` 越界**：`TextEncodeQwenImage21` 的 `resolution` 是总像素预算，节点 schema
  上限写的 4096 只是 ComfyUI 通用上限，模型原生只到 2048。原来按 4096 夹，请求 4096 就是越界使用。
  现按 2048 夹（同时保留 `0` = 保留参考图自身尺寸）。
- **P1 参考图在不支持的管线上被静默忽略**：MOSS-Image / SD1.5 没有参考图入口，原来传了
  `input_images` 也会被无视（照样出图）。现在路由会落到它们时**直接报错**。
- **P2 `.slice(0, 4)` 静默丢图**：`batch_size` 合法取到 4，但历史里可能因重试或多个
  `SaveImage` 节点返回更多张，多出来的被无声丢弃。现改为超限才截断并写日志说明。
- **P2 `traceSource` 指数级递归**：`findConditioningNodes` 的递归只按 `depth` 限深、没有
  `seen` 集合，模板里的菱形连线（Reroute / 共享上游）会让同一子树被反复展开。现加访问记忆化。
- **P2 `buildSd15Graph` 选模顺序**：原来是「先找第一个 `.safetensors`」，会把列表里靠前的杂项
  权重当默认，SDXL/SD1.5 的好模型反而被跳过。现改为先按 SDXL → SD1.5 语义挑选，再用扩展名兜底。
- **P2 轮询先睡后查**：`runComfyPrompt` 每轮先 `sleep` 再查 history，命中缓存或 Turbo 少步数
  的任务（几百毫秒完成）也要白等 1.5s。现改为**先查后睡**，首轮 400ms、逐步退避到 3s。

## 已修复（2026-10-23 审查）

- **P0 `fetchObjectInfo` 早停导致缓存残缺**：原实现并发拉 8 个关键节点，凑够 3 个就 `abort()`
  其余请求。由于 `CLIPLoader` 返回体最大（含 32 个 type + 权重清单）几乎总是最慢，它每次都被
  中途取消，而那份**残缺响应还会带着 60s TTL 写进缓存**，使下游 `buildMossGraph` /
  `buildQwenGraph` / `buildSd15Graph` 取不到 CLIPLoader 的 type 与权重列表 —— 只要调用
  `generate_comfyui` 时不传 `workflow_path`，几乎必然报错。现改为**等待全部关键节点返回**
  （本机并发开销 3–41ms，可忽略），并只在 8 个节点全部到齐时才写缓存，否则回落全量接口。
- **P0 文本编码器误选 Prompt Enhancer 权重**：安装 Qwen-Image-2.1 的 PE 权重
  （`qwen3.5_9b_qwen_image_2.1_pe_{t2i,i2i}.*`）后，它们在 ComfyUI `clip_name` 列表里排到了
  MOSS 真正在用的 `qwen3.5_9b_w4a8_gptq` **前面**，而 `buildMossGraph` 的启发式正则 `/qwen3\.5/i`
  会优先命中它们 → CLIPLoader 加载不兼容分片，报
  `Tensor ... extends past the end of the file`，**MOSS 中文路由彻底不可用**。
  现新增 `isPromptEnhancer()` / `pickEncoder()` 统一排除 `_pe_t2i` / `_pe_i2i` 权重，
  MOSS 与 Qwen 两条选路都改走过滤后的候选表。
- **SDXL 默认值自适应**：`buildSd15Graph` 原来对所有 checkpoint 都用 SD1.5 的 512²/20 步。
  新增按文件名识别 SDXL，自动切到 1024²/25 步。

## 已验证（2026-10-03）

- `gemini-3.1-flash-image` 直连出图（JPEG ~455KB）✅
- MCP 握手 / tools/list / tools/call 全链路（图片块 + 落盘）✅
- **Qwen Image 2.1 文生图**（无头 ComfyUI 8189）：512² 6 步 20 秒出图；MCP 全链路 + `save_dir`/`filename` 指定落盘 ✅
- ComfyUI 未运行时的优雅报错 ✅
- **2026-10-07 NB 2.1 探测**：公开 API 已 GA，Antigravity 后端目录 27 模型仍唯一图像模型 `gemini-3.1-flash-image`（对照组出图正常）；`gemini-nano-banana-2.1` + 8 变体全 404；回落链已预铺 2.1 链首（v1.2.0）。NB 2.1 独有的 1:4/4:1/1:8/8:1 超宽比例待其上线后再扩 `aspect_ratio` 枚举

## 手动自测

```sh
node Plugins/dsh-image-mcp/server.mjs   # stderr 看日志，stdout 是 JSON-RPC
```
