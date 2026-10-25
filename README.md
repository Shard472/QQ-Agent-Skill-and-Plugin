<div align="center">

<img src="docs/banner.png" alt="鲸语 · voice" width="100%">

# 鲸语 · voice

**给 QQ Agent 用的语音条插件 —— 本地 GPT-SoVITS 合成，中日双语，按语言自动切换音色。**

[![QQ Agent](https://img.shields.io/badge/QQ%20Agent-0.4.x-4c8dff?style=flat-square)](#-环境要求)
[![GPT-SoVITS](https://img.shields.io/badge/GPT--SoVITS-api__v2-8b5cf6?style=flat-square)](https://github.com/RVC-Boss/GPT-SoVITS)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

</div>

---

## ✨ 它能做什么

一句话：**让她用「声音」说话，而不是打字。**

- 🎙 **发成真正的 QQ 语音条** —— 不是音频文件、不是链接，就是那个能点的语音气泡
- 🌏 **中日双语**，各用一套微调音色，**按语言自动切模型**
- 🔁 **自动翻译** —— 中文台词要日文语音时，她自己翻好再念，反过来也一样
- 🗣 **两种触发方式** —— 固定格式 `@她 语音 中文 内容`，或者直接说人话 `用语音说 主人晚安`
- 💬 **私聊免 @** —— 一对一场景下不用艾特，说人话就行
- 🔊 **响度归一 + 编码前增强** —— 尽量对抗 QQ silk 的"糊"
- 🛟 **失败不哑火** —— 翻译挂了就用原文，TTS 挂了就回退文字

<div align="center">

| 你说 | 她做 |
|:---|:---|
| `@她 语音 中文 主人晚上好` | 用中文音色念出来 |
| `@她 语音 日语 主人晚上好` | 自动译成日语 → 用日语音色念 |
| `@她 用语音说 早点休息` | 自然语言识别 → 中文语音 |
| `@她 来一句日语` | 她自己挑一句说 |
| `@她 今天吃什么` | —— 正常聊天，不发语音 |

</div>

## 📁 目录结构

仓库里**每个插件一个顶层文件夹**，文件夹名 = 插件 id：

```text
QQ-Agent-Skill-and-Plugin/
├── docs/
│   └── banner.png              # 题图
├── voice/                      # ← 鲸语（插件 id: voice）
│   ├── index.js                # 插件本体
│   ├── plugin.json             # 清单 + 配置项说明
│   └── README.md               # 详细文档
├── LICENSE
└── README.md
```

## 🚀 安装

```text
1. 把 voice/ 整个文件夹复制到 `<QQ Agent>/resources/app/plugins/`
2. 重启 QQ Agent（或等它热重载）
3. 设置页 → 插件 → 「鲸语（语音条）」→ 填路径和音色
```

> ⚠️ **不要把 `.git` 放进 `plugins/`** —— QQ Agent 的加载器会把 `.git` 目录当插件扫描，日志里会多一条加载失败。

## ⚙️ 配置

关键几项（完整说明在 [voice/README.md](voice/README.md)）：

```jsonc
{
  "ttsBaseUrl":   "http://127.0.0.1:9880",   // GPT-SoVITS api_v2 地址
  "gptSovitsDir": "D:\\GPT-SoVITS",          // 参考音频在它的 ref/ 下
  "pythonExe":    "D:\\GPT-SoVITS\\python310\\python.exe",
  "keyword":      "语音",                     // 触发词
  "defaultVoices": { "zh": "艾丽妮-中", "ja": "艾丽妮-日" },
  "voices": [
    {
      "name": "艾丽妮-中", "lang": "zh",
      "file": "艾丽妮-中-闲置.wav",             // 参考音频（3~10 秒！）
      "promptText": "危机当前，还能倒头就睡？…",  // 必须和参考音频逐字一致
      "splitMethod": "cut0",
      "config": "GPT_SoVITS/configs/tts_infer_zh.yaml",  // 按语言重启用
      "dsp": "v1"                                        // v1 / v2 / off
    }
  ]
}
```

## 🧠 它是怎么工作的

```text
消息 ──► 指令解析（固定格式 / 自然语言）
      ──► 语言判定（目标语言 ≠ 文本语言 → 自动翻译）
      ──► 音色选择（按语言 → 对应微调模型）
      ──► GPT-SoVITS /tts 合成 wav
      ──► 编码前处理（24kHz / 提亮 / 压缩，可关）
      ──► OneBot record 段 → QQ 语音条
```

**关键设计**：音色按**语言**选，不按指令里的词选 —— 避免"内容里刚好有'日语'两个字"被判成语言。

## ⚠️ 踩过的坑（都在这版里修好了）

| 坑 | 现象 | 解法 |
|:---|:---|:---|
| **CUDA Graph 崩** | 加载权重时原生崩溃 `access violation` | 启动加环境变量 `CUDAGraph=0` |
| **热切模型 OOM** | 小内存机器切权重时 `DefaultCPUAllocator` | 改用 `config`：**按语言重启服务**，一次只加载一套 |
| **配置被写坏** | `voices` 变成字符串 `"[object Object],…"` | 插件内置 `voicesFile` 兜底，独立 JSON 保底 |
| **参考音频超限** | `参考音频在3~10秒范围外` | api_v2 硬限制，切片必须 3~10 秒 |
| **音量过小** | 发出去几乎听不见 | 合成后做峰值归一 |

## 📚 文档

- [voice/README.md](voice/README.md) —— 完整用法、参数说明、故障排查
- 语音模型需要自己训练：参考音频 5~10 分钟单说话人干净语料，s2 微调几分钟出结果

## 📄 License

[MIT](LICENSE) —— 代码随便用。

> ⚠️ **音色与训练素材的版权归原权利人**。仓库里不含任何模型权重或音频素材，请勿商用或公开传播你训练的模型。
