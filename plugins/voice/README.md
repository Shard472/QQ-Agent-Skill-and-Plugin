# QQ Agent 语音插件 · 鲸语（voice）

给 [QQ Agent](https://github.com/) 用的语音条插件：本地 GPT-SoVITS 合成，发成 QQ 语音条。

## 功能

- `@她 语音 中文/日语 内容` → 合成并发送语音条
- 自然语言也行（私聊免 @）：`用语音说 主人晚安`、`说一句给我听 你好呀`、`来一句日语`
- 中文台词说日语时**自动翻译**（反之亦然）
- 中文/日文各用一套微调音色，按语言自动切换
- 响度归一 + silk 编码前增强（可关）
- 失败自动降级为文字提示

## 依赖

- **GPT-SoVITS**（本地 api_v2 服务，默认 `127.0.0.1:9880`）
- SnowLuma / OneBot v11（发送语音条）
- 参考音频 3~10 秒（放 `GPT-SoVITS/ref/`）

## 安装

1. 把 `voice/` 目录放到 `<QQ Agent>/resources/app/plugins/`
2. 重启 QQ Agent（或等热重载）
3. 设置页 → 插件 → 鲸语 → 填 `gptSovitsDir` / `pythonExe` / 音色列表

## 配置要点

```json
{
  "ttsBaseUrl": "http://127.0.0.1:9880",
  "gptSovitsDir": "D:\\GPT-SoVITS",
  "keyword": "语音",
  "defaultVoices": { "zh": "艾丽妮-中", "ja": "艾丽妮-日" },
  "voices": [
    { "name": "艾丽妮-中", "lang": "zh", "file": "艾丽妮-中-闲置.wav",
      "promptText": "…参考音频的原话…", "splitMethod": "cut0",
      "config": "GPT_SoVITS/configs/tts_infer_zh.yaml", "dsp": "v1" },
    { "name": "艾丽妮-日", "lang": "ja", "file": "艾丽妮-日-B.wav",
      "promptText": "…", "splitMethod": "cut5",
      "config": "GPT_SoVITS/configs/tts_infer_ja.yaml", "dsp": "off" }
  ]
}
```

## 踩过的坑（重要）

1. **CUDA Graph 必须关**：GPT-SoVITS 的 `torch_static_cuda_graph` 在切换权重时会原生崩溃，插件启动服务时加了 `CUDAGraph=0`
2. **热切模型会内存 OOM**：小内存机器请用 `config`（按语言重启服务），而不是 `weights`（热切）
3. **`.git` 不能放在 `plugins/` 里**：QQ Agent 的加载器会把 `.git` 目录当插件扫描导致加载失败
4. **配置里的 `voices` 会被核心深合并写成字符串**：插件内置 `voicesFile` 兜底

## 许可

个人自用。语音模型/素材版权归原权利人，请勿商用或公开传播。
