# 🎨 画舫（comfy-draw）

接本地 **ComfyUI**，让她在 QQ 里会画画。

```text
@她 画一张鲸鱼娘                    → 自然语言，不用记指令
@她 /画 鲸鱼娘 在海边挥手            → 自动识别角色 + 姿势
@她 /画 鲸鱼娘 穿泳装 在海边 --放大 2  → 服装/参数都能指定
@她 /画 帮助                        → 用法、预设、姿势一览
```

- 中文描述由**她自己的模型**翻成 Danbooru 标签，不用你写英文；**服装词走本地词典硬替换**（汉服/和服/旗袍…不会被译歪）
- 7 套预设：**鲸鱼娘Anima**（默认，18 岁少女感）/ **鲸鱼娘成年** / **鲸鱼娘**（SD1.5 快档）/ **头像** / **立绘** / **表情包**（最快）/ **场景**
- **Anima（DiT 2B）支持**：新底模，画风和角色一致性都比 SD1.5 高一档（详见第十节）
- 7 套 OpenPose 骨骼：站着 / 挥手 / 撑伞 / 坐着 / 走路 / 背手 / 回眸，按描述自动挑
- 8 GB 显存友好：画前停 TTS；CUDA 崩了自动重启重试，Anima 失败还会退回 SD1.5
- 限额：普通档每人每天 10 张 / 冷却 60 秒；**Anima 单独 5 张 / 冷却 120 秒**，用完不影响普通档
- 刚画完 90 秒内只认显式 `/画`，夸一句“画得很好”不会再画一张

---

## 一、它怎么工作

```text
消息 → before-context 钩子
        ├─ /画 指令 或「画一张…」自然语言 → 命中
        ├─ 限额检查（每天/冷却）
        ├─ TTS 在跑？先停掉（8 GB 卡上两者互斥）
        ├─ 回一句「好，画（鲸鱼娘，挥手）…」
        ├─ core.mjs 组工作流 → 提交 ComfyUI → 轮询出图
        ├─ OneBot 直接把图发出去（钩子里拿不到核心的 sender）
        └─ 20 秒后关掉 ComfyUI，把显存还回去
```

同时注册了模型工具 `comfy_draw`，她在聊天里可以自己决定画——与指令共用同一套限额与并发锁。

## 二、预设

| 预设 | 模型 | 尺寸 | 二段放大 | 用途 | 参考耗时 |
|:---|:---|:---|:---|:---|:---|
| **`鲸鱼娘Anima`**（默认） | Anima 2B | 832×1216 | — | 鲸鱼娘本命图，18 岁少女感 | **50~60 s** |
| `鲸鱼娘成年` | Anima 2B | 832×1216 | — | 同角色成年比例 | 50~60 s |
| `鲸鱼娘` | SD1.5 | 768×1024 | 1.25× | 旧版角色立绘，最快 | 45~60 s |
| `头像` | SDXL | 1024×1024 | — | 头像、特写 | 25~40 s |
| `立绘` | SDXL | 832×1216 | — | 全身立绘 | 25~40 s |
| `表情包` | SD1.5 | 512×512 | — | Q 版、贴纸 | ~9 s |
| `场景` | SDXL | 1216×832 | — | 横版风景/背景 | 25~40 s |

没指定预设时的兜底由 `defaultPreset` 决定（默认 `鲸鱼娘Anima`）；描述里说“鲸鱼娘”也会命中它。

> 想改尺寸/步数/CFG：设置页的 `presets` 里写同名键即可覆盖，不用改代码。

## 三、指令与参数

```text
/画 <描述> [--预设 名字] [--放大 2] [--种子 123] [--姿势 挥手] [--无骨骼]
```

| 参数 | 说明 |
|:---|:---|
| `--预设 名字` | 鲸鱼娘Anima / 鲸鱼娘成年 / 鲸鱼娘 / 头像 / 立绘 / 表情包 / 场景；不写按描述自动猜，猜不到用默认档 |
| `--放大 N` | 用 4x 模型放大到 N 倍（默认不额外放大，预设自带二段放大） |
| `--种子 N` | 固定种子复现；出图后她会在图片说明里带上 seed |
| `--姿势 词` | wave / hold / sit / walk / backhands / turn / stand，也认中文 |
| `--无骨骼` | 关掉骨骼约束，自由构图 |

自然语言触发只认**句首**是画图意图（「画一张…」「帮我画个…」「来张图…」），「这个画风不错」不会误触发。

## 四、安装

```text
1. 本文件夹整个拷到 <QQ Agent>/resources/app/plugins/comfy-draw/
2. 重启 QQ Agent（或等热重载）
3. 设置页 → 插件 → 画舫：填 ComfyUI 地址与模型名，打开开关
```

### 必填设置

| 键 | 说明 |
|:---|:---|
| `comfyUrl` | 默认 `http://127.0.0.1:8188` |
| `modelSd15` / `modelSdxl` | 你的 checkpoint 文件名（放进 `models/checkpoints`） |
| `upscaler` | 放大模型文件名，默认 `4x-AnimeSharp.pth` |

### 可选：没在跑就自动拉起 ComfyUI

填了 `comfyDir` + `comfyPython` 之后，ComfyUI 没起时会尝试自动启动（也可 `POST /api/skills/comfy-draw/action/startComfy` 手动触发）。

> ⚠️ **`stopComfyAfterDraw` 默认关闭**：开启后画完 20 秒会关掉 ComfyUI 释放显存，但下次画图就得靠自动拉起——作者本机实测自动拉起**不生效**（cmd / .bat / `start /b` 三种都试过），结果就是“等两分钟然后失败”。除非你确认自动拉起来能工作，否则保持关闭。

```text
comfyDir      ComfyUI 主目录（含 main.py）
comfyPython   那个 venv 里的 python.exe
comfyYaml     可选，桌面版的 --extra-model-paths-config
comfyInputDir / comfyOutputDir   可选，骨骼图与出图目录
```

> 留空也能用：插件会直接连正在运行的 ComfyUI。

## 五、环境要求

| 依赖 | 说明 |
|:---|:---|
| **ComfyUI** | 0.3.x 以上即可；需要 `ControlNet`（可选）、`FreeU_V2`（内置） |
| **模型** | 至少一个 SD1.5 或 SDXL checkpoint；角色预设还需要对应 LoRA |
| **骨骼模型** | 用姿势功能需要 `control_v11p_sd15_openpose.pth` 放进 `models/controlnet/` |
| **骨骼图** | `pose-*.png` 放 ComfyUI 的 `input/`（本仓库不含图片，可用 OpenPose 编辑器自己画） |
| **OneBot v11** | 发图走 SnowLuma 的 HTTP 接口，插件会自己从 `snowluma/config/onebot_*.json` 找端点与令牌 |
| **GPT-SoVITS** | 可选。若装了语音插件，画图前会自动停 TTS 腾显存 |

## 六、8 GB 显存的三条经验

| 现象 | 原因 | 做法 |
|:---|:---|:---|
| 出图时整个桌面崩 | SDXL 与 TTS 抢显存（TTS 约 2.5 GB） | 画前停 TTS（`autoStopVoice`），画完不自动重启 |
| `CUDA error: out of memory` | ControlNet + 大分辨率 + 高倍放大一起上 | 聊天路径用轻量预设（768×1024、1.25×、关骨骼） |
| TTS 启动即崩（`fbgemm.dll` / `c10.dll`） | 显卡被占满时硬起服务 | 常态不启动 TTS，用的时候再拉（见语音插件的 `startOnDemand`） |

## 七、数据与隐私

| 路径 | 内容 |
|:---|:---|
| `data/comfy-cache/` | 出图缓存（插件自己清理，可随时删） |
| `data/comfy-draw-state.json` | 当天每会话的画图计数（限额用） |
| `data/comfyui-launch.bat` | 自动拉起 ComfyUI 时生成的批处理 |
| `data/comfyui-boot*.log` | 可选，自动启动的日志 |

本插件**不发送任何提示词到外部网络**：翻译走你自己配的模型，出图走本机 ComfyUI，图片走你自己搭的 OneBot。

## 八、排错

| 现象 | 处理 |
|:---|:---|
| `画失败了：ComfyUI 没起来` | 先手动开 ComfyUI，或把 `comfyDir`/`comfyPython` 填对 |
| `上一张还在画啊` | 150 秒并发锁；等前一张出完，或重启插件 |
| 图能出但发不出去 | OneBot 端点/令牌不对；检查 `<QQ Agent>/snowluma/config/onebot_*.json` |
| 姿势不生效 | 骨骼模型没装、或 `pose-*.png` 不在 `input/`；用 `--姿势` 显式指定 |
| 中文描述出图很怪 | 模型翻译那层挂了会退回原文；看日志里的 `tag 翻译` 一行 |

## 九、文件

| 文件 | 作用 |
|:---|:---|
| `plugin.json` | 清单 + 设置项 + 设置页说明 |
| `index.js` | QQ 侧薄壳：指令解析、限额、钩子、工具注册 |
| `core.mjs` | 与 DSH 技能共用的核心：预设、工作流、放大、骨骼、TTS 互斥 |
| `onebot.mjs` | 发送通道（钩子里没有 `sender`，自己走 OneBot HTTP） |

`core.mjs` 是**故意**和 DSH 技能共用同一份的：两边参数永远一致，改一处两边一起变。

## 十、Anima（DiT）支持 · v0.4 新增

Anima 是 CircleStone Labs 与 Comfy Org 合作的 2B 动漫模型（DiT 架构，Qwen3-0.6B 文本编码器 + Qwen-Image VAE）。它在插件里和 SD1.5/SDXL 走**两条不同的工作流**。

### 需要哪些文件

```text
models/diffusion_models/anima-aesthetic-v1.1.safetensors   3.9 GB   （推荐；另有 anima-base-v1.0 / aesthetic-v1.0b）
models/text_encoders/qwen_3_06b_base.safetensors           1.1 GB
models/vae/qwen_image_vae.safetensors                      242 MB
models/loras/ds_whalemaid_comfy.safetensors                175 MB   （角色 LoRA，需转换，见下）
```

全部来自 [circlestone-labs/Anima](https://huggingface.co/circlestone-labs/Anima)，官方教程：[Anima Base v1 · ComfyUI Docs](https://docs.comfy.org/tutorials/image/anima/anima)。
设置页对应 `animaUnet` / `animaClip` / `animaVae` 三项。

### 角色 LoRA 必须转换格式

kohya 训练的 Anima LoRA 是 `lora_unet_blocks_*` 命名，ComfyUI 认不出来（实测 840 个键全部 `lora key not loaded`，权重 0 和 0.8 出图完全一样）。用 kohya 自带脚本转一次：

```bash
python networks/convert_anima_lora_to_comfy.py ds_whalemaid.safetensors ds_whalemaid_comfy.safetensors
```

转换后键名变成 `diffusion_model.blocks.0.cross_attn.k_proj.lora_A.weight`。

### 官方出图参数（别按 SD 的习惯来）

| 参数 | 值 |
|:---|:---|
| 加载器 | `UNETLoader` + `CLIPLoader(type=stable_diffusion)` + `VAELoader` |
| 采样器 / 调度器 | **euler / simple** |
| 步数 / CFG | **30 / 4**（CFG 这么低是正常的） |
| 尺寸 | 832×1216 或 1024×1024 |
| LoRA 节点 | `LoraLoaderModelOnly`（该 LoRA 没有 TE 部分） |

### 实测开销（RTX 4060 Laptop 8 GB）

| 档位 | 单张 | 显存峰值 |
|:---|:---|:---|
| Anima（30 步） | 45~60 s | **约 5.5 GB** |
| SD1.5 快档 | 9~45 s | ~2 GB |

Anima 与 TTS 同跑基本必崩（`torch.AcceleratorError: CUDA error`）。插件现在会：停 TTS 后**复检端口**，没关干净就直接报错；真崩了**重启 ComfyUI 再试一次**；还不行就**自动退回 SD1.5**，群里至少能拿到图。

### 内置的免踩坑处理

| 处理 | 说明 |
|:---|:---|
| `1girl, solo` 固化在预设里 | 否则 `18 years old` 这类词会让模型画成两个并排的人 |
| 服装词典 | 汉服=hanfu、和服=kimono、旗袍=qipao… 在翻译**之前**硬替换，避免“汉服”被译成 bikini |
| 女仆词自动让位 | 用户写了别的服装时，负向自动加 `apron, maid`，否则 LoRA 会硬塞围裙 |
| 长度词自己写 | 想要长裙必须写“长裙/及踝”，预设不会替你决定衣长 |
| 不支持 `--放大` | Anima 分支还没接放大模型（SD/SDXL 预设可用） |

### 排障接口

```text
POST /api/skills/comfy-draw/action/status       → ComfyUI 状态、显存、当前预设
POST /api/skills/comfy-draw/action/startComfy   → 手动触发自动拉起
POST /api/skills/comfy-draw/action/stopComfy    → 关掉 ComfyUI 释放显存
POST /api/skills/comfy-draw/action/draw         → {"prompt":"…","preset":"鲸鱼娘Anima"} 直接画一张
```

> 注意：`core.mjs` 是 ES 模块，`/api/skills/reload` 只会重新加载 `index.js`——**改了 core 必须重启 QQ Agent**。
