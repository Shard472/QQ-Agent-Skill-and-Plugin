# Changelog

本仓库所有插件的版本变更记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## 🎨 画舫（comfy-draw）

### [0.4.3] — 2026-10-26

**Anima 全面接入 + 一堆线上踩坑修复。**

**新增**

- **Anima（DiT 2B）支持**：新增 `buildAnima()`，走 `UNETLoader` + `CLIPLoader(type=stable_diffusion)` + `VAELoader`
  + `LoraLoaderModelOnly`，euler/simple、30 步、CFG 4，与 SD 工作流并行存在
- **两档鲸鱼娘 Anima 预设**：`鲸鱼娘Anima`（默认，18 岁少女感）/ `鲸鱼娘成年`（成年比例）；
  旧的 SD1.5 `鲸鱼娘` 保留为快档
- **`defaultPreset` 设置**：没指定预设时用哪一档；说“鲸鱼娘”也会命中默认档
- **服装词典硬替换**：汉服=hanfu、和服=kimono、旗袍=qipao… 在交给 LLM 翻译**之前**替换，
  避免“汉服”被译成 bikini
- **Anima 独立限额**：`animaDailyCap`(5) / `animaCooldownSeconds`(120)，单独计数桶 `<会话>#anima`，
  不占普通额度
- **排障动作接口**：`action/status` / `startComfy` / `stopComfy` / `draw`
- **自动降级**：Anima 失败自动用 SD1.5 重画一次，群里不会空手

**修复**

- **夸一句“画得很好”会再画一张**：`parseImplicit` 只认句首“画”，把评价也当成了指令；
  现在以“得/的/完/好/不错/棒…”开头的直接不当指令，且画完 90 秒内只认显式 `/画`
- **私聊画不出来（等两分钟）**：`stopComfyAfterDraw` 开着时画完就关 ComfyUI，下次画图依赖自动拉起，
  而本机自动拉起不生效 → 默认改成关闭，并在拉起失败时返回可执行的手动命令
- **CUDA 崩了就废掉**：`torch.AcceleratorError: CUDA error` 后无法再画；现在检测到 CUDA/OOM
  会自动重启 ComfyUI 并重试一次
- **TTS 没关干净导致撞 CUDA**：停 TTS 后复检端口，没关掉就明确报错而不是拖到采样阶段
- **`presets` 被写成数组时造出假预设**：`{...s.presets}` 会生成 "0"~"14"；改成只接受纯对象
- **`1girl, solo` 丢失导致画成双人**：固化进预设，负向补 `2girls, multiple girls`
- **写状态失败**：`writeState` 没有 mkdir 数据目录，静默失败导致限额不计数
- **`Number(x) || 默认` 把 0 当成未设置**：限额/冷却填 0 会被忽略
- **`core.mjs` 改了热重载不生效**：ES 模块缓存，必须重启应用（文档已注明）
- **DSH 技能 CLI 读错配置层级**：一直读 `skills['comfy-draw'].comfyUrl`，实际在 `.settings` 下，
  导致配置从未生效；已兼容两种结构并透传 anima 模型名 / defaultPreset
- **启动方式**：优先 `cmd /c start "" /b <python>`（带 cwd）+ 单行 `cd /d … && python …`，.bat 作兜底；
  实测 .bat 路径在本机静默失败

**已知限制**

- Anima 分支暂不支持 `--放大`
- Anima 与 TTS 不能同跑（8 GB 卡上必崩）
- 应用内自动拉起 ComfyUI 在作者本机不生效，需手动启动或用 `action/startComfy` 观察结果

---

### [0.2.0] — 2026-10-25

首个公开版本。接本地 ComfyUI，让她在 QQ 里会画画。

**新增**

- **指令体系**：`/画 <描述> [--预设 名字] [--放大 N] [--种子 N] [--姿势 词] [--无骨骼]`，另有 `/画 帮助`
- **自然语言触发**：句首是画图意图（「画一张…」「帮我画个…」「来张图…」）即触发，不必打 `/画`；
  只认句首，闲聊里的「画风」不会误触发
- **5 套预设**：鲸鱼娘（角色立绘，SD1.5 768×1024 + 1.25× 二段放大）/ 头像 / 立绘 / 表情包（512，最快）/ 场景
- **中文自动翻标签**：用她自己的模型翻成 Danbooru 标签，去掉构图词（由预设统一控制），失败回退原文
- **7 套 OpenPose 骨骼**：站着 / 挥手 / 撑伞 / 坐着 / 走路 / 背手 / 回眸，按描述自动挑选，可 `--姿势` 指定
- **角色与服装映射**：提到角色自动补身份词；默认女仆装，描述里提到别的服装就自动让位
- **模型工具 `comfy_draw`**：她在聊天里也能自己决定画，与指令共用限额与并发锁
- **限额**：每人每天 10 张、冷却 60 秒、群里需 @（私聊免 @）
- **不抢话**：画图那轮用 `before-llm-messages` 提示 + `before-tool` 拦 `send_message`，
  避免出现「好，画…」之后又补一句「我哪来的笔」

**8 GB 显存适配**

- 画前探测 TTS（9880），在跑就先停；画完默认**不**自动重启（`restartVoiceAfterDraw=false`）
- 画完 20 秒关掉 ComfyUI（`stopComfyAfterDraw`），空闲显存从 3.2 GB 回落到约 0.8 GB
- 聊天路径用轻量预设（768×1024、1.25×、关 ControlNet）：ControlNet + 大图 + 高倍放大三者同上会压崩 ComfyUI
- 关掉默认的 SAG 引导：实测 896×1152 下必 OOM（FreeU + ControlNet 正常）

**修复**

- **钩子里没有 `sender`**：`before-context` 的 ctx 不含发送对象，改为自建 `onebot.mjs` 走 SnowLuma 的
  OneBot HTTP 接口发文字与图片（图片传 `file://` 路径，失败回退 base64）
- **自动拉起 ComfyUI 失败**：原先把长命令塞进 `cmd /c`，路径含括号（`ComfyUI (1)`）会被截断；
  改成先写 `data/comfyui-launch.bat` 再执行，并保留 `start /b` 兜底
- **失败后并发锁不释放**：出图失败时 150 秒锁没清，用户会一直看到「上一张还在画」；成功/失败两条路径都清
- **ControlNet 静默失效**：`ControlNetApplyAdvanced` 不传 `vae` 时这版 ComfyUI 会静默忽略；
  另外二段放大原先用未加 ControlNet 的条件，会把姿势改回去；两处都修了
- **输出文件名含中文**：部分环境 `fs.writeFileSync` 报 EPERM，文件名统一转 ASCII

**已知限制**

- 坐姿骨骼对 SD1.5 不可靠（会画成站姿），建议用文字描述「sitting on …, knees bent」
- SD1.5 在裙摆张开时偶发多数一条腿 / 多个头；已加对应负向词，仍非 100%
- ComfyUI 首次拉起约 25 秒，`/语音` 首次拉起 TTS 约 12 秒

## 🎙 鲸语（voice）

### [1.2.0] — 2026-10-25

**新增**

- 指令改为 `@她 语音 中文/日语 内容`，同时保留旧格式 `/语音 [ja|中文] 内容` 作为后备
- **自然语言触发**：`用语音说 …`、`说一句给我听 …`、`来一句日语`、`用日语讲 …`
- **私聊免 @**（群聊仍必须 @，避免误触发）
- **自动翻译**：中文台词说日语时自动翻成日语，反之亦然（同句缓存，失败回退原文）
- `dsp` 选项：`v1`（24kHz 提亮压缩）/ `v2`（更亮，可能齿音重）/ `off`（原始 32kHz）
- `voicesFile` 兜底：配置里的 `voices` 被写坏时自动读独立 JSON

**修复**

- 切模型时 CPU 内存 OOM：改为**按语言重启服务**（`config` 字段），不再热切
- 启动服务时加 `CUDAGraph=0`，规避 CUDA Graph 在加载权重时的原生崩溃（`access violation`）
- `keyword` 配置项之前没真正生效（硬编码了"语音"）

### [1.1.0] — 2026-10-24

**新增**

- 中日双语各一套微调音色，按语言自动切换（`/set_sovits_weights`）
- silk 编码前增强：24kHz 重采样 + 3kHz 提亮 +4dB + 3:1 压缩 + 峰值归一
- 原句过长自动切分（`maxChunks`）、同会话冷却（`cooldownSeconds`）、每日上限（`dailyCap`）
- 自动拉起 api_v2 服务（120 秒防重复启动）

### [1.0.0] — 2026-10-23

**初始版本**

- `/语音 <内容>` 合成并发送 QQ 语音条
- 单音色、单语言
- 基于 GPT-SoVITS `api_v2` + OneBot `record` 段

---

## 🤫 嘘（hush）

### [2.0.0] — 2026-10-25

**新增**

- **四档静音**：`atOnly`（只回@）/ `silent`（完全不说话）/ `sleep`（睡觉）/ `polite`（只回一句礼貌话）
- 档位词写在指令里：`/静音 完全 30`、`/静音 睡觉 8小时`、`/静音 礼貌 30`
- **静音记账**：记录期间消息数与被 @ 次数，解除时把数字递给她，用自己的口气汇报
- 状态持久化到 `data/hush-state.json`（重启不丢）
- `/静音 0` = 一直静音到手动解除
- `silent` / `sleep` 档用 `before-tool` 硬拦 `send_message` / `send_to` / `send_sticker` / `send_poke`
- 礼貌档冷却（`politeCooldownMin`，默认 10 分钟）

**修复**

- 解除静音时不再只是"生效了"，而是带上下文汇报

### [1.0.0] — 2026-10-24

**初始版本**

- 主人 `@她 /静音 30` → 该群响应档位强制 1 档（只回 @），到期自动恢复
- `@她 /说话` 立刻解除
- 复用核心 `config.commandMute.active`，零核心改动
