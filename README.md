
# QQ Agent 插件集

**给我自己那台机器用的插件仓库 —— 纯插件实现，不改核心代码。**

[![QQ Agent](https://img.shields.io/badge/QQ%20Agent-0.4.x-4c8dff?style=flat-square)](#-环境要求)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
[![Plugins](https://img.shields.io/badge/plugins-3-8b5cf6?style=flat-square)](#-插件列表)

</div>

---

## 📦 插件列表

> **每个插件一个顶层文件夹，文件夹名 = 插件 id**，整个文件夹拷进 `<QQ Agent>/resources/app/plugins/` 即可。

| 插件 | 版本 | 一句话 |
|:---|:---|:---|
| [🎙 **鲸语** `voice/`](voice/) | `1.2.0` | 本地 GPT-SoVITS 合成，把话发成**真正的 QQ 语音条**。中日双语、按语言切音色、中文台词自动翻日语 |
| [🤫 **嘘** `hush/`](hush/) | `2.0.0` | 主人在群里下**静音指令**：四档强度（只回@ / 完全不说话 / 睡觉 / 只回一句礼貌话），静音期间记账，解除时汇报 |
| [🎨 **画舫** `comfy-draw/`](comfy-draw/) | `0.2.0` | 接本地 **ComfyUI** 出图：中文自动翻标签、5 套预设、7 套姿势骨骼；画前停 TTS、画完关 ComfyUI，8 GB 显存也能跑|

## 🧩 插件速览

### 🎙 鲸语（voice）

让她用「声音」说话，而不是打字。

```text
@她 语音 中文 主人晚上好          → 中文音色念出来
@她 语音 日语 主人晚上好          → 自动译成日语再念
@她 用语音说 早点休息             → 自然语言识别（私聊免 @）
@她 来一句日语                    → 她自己挑一句说
@她 今天吃什么                    → 正常聊天，不发语音
```

- 音色按**语言**选，不按指令里的词选（避免内容里出现"日语"就误判）
- 失败不哑火：翻译挂了用原文，TTS 挂了回退文字
- 详见 [voice/README.md](voice/README.md)

### 🤫 嘘（hush）

群里太吵时让主人一键闭上她的嘴。

```text
@她 /静音 30                      → 只回 @，30 分钟后自动恢复
@她 /静音 完全 30                 → 完全不说话（连 @ 也不回）
@她 /静音 睡觉 8小时              → 睡觉档，醒来会问"刚才谁找我"
@她 /静音 礼貌 30                 → 被 @ 只回一句"我先安静会儿"
@她 /说话                         → 解除，并汇报静音期间来了多少条、被点名几次
```

- 纯插件实现：复用核心的 `commandMute`，再用 `before-tool` 把嘴捂住
- 静音记账存在 `data/hush-state.json`
- 详见 [hush/README.md](hush/README.md)

### 🎨 画舫（comfy-draw）

让她在 QQ 里会画画，模型跑在你自己机器上。

```text
@她 画一张鲸鱼娘                    → 自然语言，不用记指令
@她 /画 鲸鱼娘 在海边挥手            → 自动识别角色 + 姿势
@她 /画 鲸鱼娘 穿泳装 在海边 --放大 2  → 服装/参数都能指定
@她 /画 帮助                        → 用法、预设、姿势一览
```

- 中文描述由**她自己的模型**翻成 Danbooru 标签，不用手写英文
- 5 套预设：鲸鱼娘（角色立绘）/ 头像 / 立绘 / 表情包（最快）/ 场景
- 7 套 OpenPose 骨骼：站着 / 挥手 / 撑伞 / 坐着 / 走路 / 背手 / 回眸，按描述自动挑
- 8 GB 显存友好：画前停 TTS、画完关 ComfyUI，空闲约 0.8 GB
- 限额：每人每天 10 张、冷却 60 秒、群里需 @
- 详见 [comfy-draw/README.md](comfy-draw/README.md)

## 📁 目录结构

```text
QQ-Agent-Skill-and-Plugin/
├── docs/
│   └── banner.png          # 题图
├── voice/                  # ← 鲸语（插件 id: voice）
│   ├── index.js
│   ├── plugin.json
│   └── README.md
├── hush/                   # ← 嘘（插件 id: hush）
│   ├── index.js
│   ├── plugin.json
│   └── README.md
├── comfy-draw/             # ← 画舫（插件 id: comfy-draw）
│   ├── index.js            # QQ 侧：指令/限额/钩子/工具
│   ├── core.mjs            # 核心：预设/工作流/放大/骨骼/TTS 互斥
│   ├── onebot.mjs          # 发送通道（钩子里没有 sender）
│   ├── plugin.json
│   └── README.md
├── LICENSE
└── README.md
```

## 🚀 安装

```text
1. 把需要的插件文件夹（voice/ / hush/ / comfy-draw/）复制到
   <QQ Agent>/resources/app/plugins/
2. 重启 QQ Agent，或等它热重载
3. 设置页 → 插件 → 找到对应插件 → 配置
```

> ⚠️ **不要把 `.git` 目录放进 `plugins/`**
> QQ Agent 的加载器会把 `plugins/` 下所有子目录当插件扫描，`.git` 会被当成一个坏插件，日志里多一条加载失败。

## 🔧 环境要求

| 插件 | 依赖 |
|:---|:---|
| 鲸语 | **GPT-SoVITS**（本地 `api_v2`，默认 `127.0.0.1:9880`）+ SnowLuma / OneBot v11 + 3~10 秒参考音频 |
| 嘘 | 只要 QQ Agent 本身（`config.commandMute.enabled = true`） |
| 画舫 | **ComfyUI**（本地 `127.0.0.1:8188`）+ 一个 SD1.5/SDXL checkpoint；姿势功能另需 openpose ControlNet 与骨骼图 |

## 🧠 共同的设计取舍

| 取舍 | 原因 |
|:---|:---|
| **纯插件，不改核心** | QQ Agent 升级不会冲掉，也不用维护 fork |
| **复用核心已有字段** | 静音用 `commandMute`、语音走 OneBot `record` 段，不另造一套状态 |
| **失败就降级** | 任何外部依赖挂了都不应该让机器人失联 |
| **记账存单独 JSON** | 配置里的数组被核心深合并写坏过两次，独立文件更可靠 |
| **重活能省就省** | 画图/语音都按需启动、用完就关；8 GB 显存上同跑必崩 |

## 📅 版本记录

每个插件的变更见 [CHANGELOG.md](CHANGELOG.md)。当前版本：

| 插件 | 版本 | 最近变更 |
|:---|:---|:---|
| 鲸语 `voice/` | `1.2.0` | 自然语言触发、私聊免 @、自动翻译、按语言重启服务 |
| 嘘 `hush/` | `2.0.0` | 四档静音、静音记账、解除时汇报 |
| 画舫 `comfy-draw/` | `0.2.0` | ComfyUI 出图、姿势骨骼、按需启停、限额与并发锁 |

## 📄 License

[MIT](LICENSE) —— 代码随便用。

> ⚠️ **音色、模型与训练素材的版权归原权利人**。本仓库**不含**任何模型权重、LoRA 或音频素材，请勿商用或公开传播你训练的模型。生成的图片请自行确认训练数据的授权范围。
