# QQ Agent Skill & Plugin

给 [QQ Agent](https://github.com/) 用的技能与插件集合。

## 插件列表

| 插件 | 说明 |
|---|---|
| [`plugins/voice`](plugins/voice/) | **鲸语** —— 本地 GPT-SoVITS 合成语音，发成 QQ 语音条。支持中文/日文双语、按语言自动切模型、中文台词自动翻译成日语 |

## 安装方式

把对应目录整个拷到 `<QQ Agent>/resources/app/plugins/` 下，然后：

- 重启 QQ Agent，或等它的热重载自动扫到
- 在设置页 → **插件** 标签里找到它并配置

> 注意：**不要把 `.git` 目录放进 `plugins/`**，QQ Agent 的加载器会把 `.git` 当成插件扫描，日志里会多一条失败。
