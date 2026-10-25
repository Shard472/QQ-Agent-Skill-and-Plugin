// comfy-draw —— 让她会画画（QQ Agent 侧）
//
// 薄壳：翻译（用她自己的模型）+ 指令/工具 + 限流 + 发送；
// 真正的预设、工作流、上采样、VRAM 互斥、姿势骨骼映射都在同目录的 core.mjs 里，
// 与 DSH 技能共用同一份，避免两边参数漂移。

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getConfig } from '../../src/config.js';
import {
  DEFAULT_PRESETS, DEFAULT_NEGATIVE, POSE_CUES, draw as coreDraw, pickPreset, matchPose,
  stripCompositionTags, status as comfyStatus, models as comfyModels, internals as coreInternals,
  ensureComfy, stopComfy
} from './core.mjs';
import { sendText as obSendText, sendImage as obSendImage } from './onebot.mjs';

let api = null;

const DEFAULTS = {
  enabled: true,
  comfyUrl: 'http://127.0.0.1:8188',
  modelSd15: 'kohaku-v2.1.safetensors',
  modelSdxl: 'animagine-xl-4.0.safetensors',
  vaeSdxl: 'sdxl-vae-fp16-fix.safetensors',
  upscaler: '4x-AnimeSharp.pth',
  command: '/画',
  allowGroups: true,
  cooldownSeconds: 60,
  dailyCap: 10,
  timeoutSeconds: 300,
  defaultUpscale: 1,
  autoStopVoice: true,
  restartVoiceAfterDraw: false,
  restartVoiceDelayMs: 30000,
  ttsPort: 9880,
  gptSovitsDir: '',
  pythonExe: '',
  ttsConfig: 'GPT_SoVITS/configs/tts_infer_zh.yaml',
  qualityPrefix: 'masterpiece, best quality, very aesthetic, absurdres',
  comfyDir: '',
  comfyPython: '',
  comfyYaml: '',
  comfyInputDir: '',
  comfyOutputDir: '',
  negative: DEFAULT_NEGATIVE,
  // 聊天路径用轻量参数：8GB 显存上全开（ControlNet + 大图 + 高倍放大）会把 ComfyUI 一起带崩。
  // DSH 技能那边仍用 core 的默认高质量预设，两边互不影响。
  presets: {
    '鲸鱼娘': {
      model: 'sd15', width: 768, height: 1024, steps: 28, cfg: 6.5, sampler: 'euler_ancestral',
      extraTags: 'standing, legs together, two legs, detailed background, cinematic lighting',
      outfit: 'maid, maid headdress, white apron, frilled apron, navy blue dress, thighhighs',
      negative: 'extra tail, multiple tails, two tails, duplicate tail, floating whale, fish, whale plush, '
        + 'torn skirt, broken clothing, mismatched skirt layers, extra legs, three legs, fused legs, '
        + 'extra limbs, extra feet, two heads, duplicate head, extra face, two girls',
      hires: { scale: 1.25, denoise: 0.45, stepsRatio: 0.6 },
      freeu: { b1: 1.3, b2: 1.4, s1: 0.9, s2: 0.2 },
      controlnet: false,
      loras: [{ name: 'whalegirl', weight: 0.85 }]
    }
  }
};

const log = (m) => api?.log?.(m);
const warn = (m) => api?.warn?.(m);

function settings() {
  try {
    const c = api?.config?.();
    return { ...DEFAULTS, ...(c && typeof c === 'object' ? c : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 把插件设置翻译成 core 需要的配置形状。 */
export function coreConfig(s = settings()) {
  return {
    comfyUrl: s.comfyUrl,
    timeoutSeconds: s.timeoutSeconds,
    models: {
      sd15: s.modelSd15,
      sdxl: s.modelSdxl,
      vaeSdxl: s.vaeSdxl,
      upscaler: s.upscaler
    },
    presets: { ...DEFAULT_PRESETS, ...(s.presets || {}) },
    comfyStart: {
      dir: s.comfyDir,
      python: s.comfyPython,
      yaml: s.comfyYaml,
      inputDir: s.comfyInputDir,
      outputDir: s.comfyOutputDir,
      port: Number((String(s.comfyUrl || '').match(/:(\d+)/) || [])[1]) || 8188,
      batPath: path.join(DATA_DIR, 'comfyui-launch.bat')
    },
    qualityPrefix: s.qualityPrefix,
    negative: s.negative,
    autoStopVoice: s.autoStopVoice !== false,
    restartVoiceAfterDraw: s.restartVoiceAfterDraw === true,
    restartVoiceDelayMs: Number(s.restartVoiceDelayMs) || 30000,
    stopComfyAfterDraw: s.stopComfyAfterDraw !== false,
    stopComfyDelayMs: Number(s.stopComfyDelayMs) || 20000,
    tts: {
      port: Number(s.ttsPort) || 9880,
      gptSovitsDir: s.gptSovitsDir,
      pythonExe: s.pythonExe,
      config: s.ttsConfig
    },
    outDir: path.join(DATA_DIR, 'comfy-cache')
  };
}

// ── 中文 → Danbooru 标签（QQ 侧；DSH 侧由模型自己写，不需要这层）──────────

const TAG_RULES = [
  '你是 Stable Diffusion 的提示词工程师。把用户的中文描述翻译成 Danbooru 风格英文标签。',
  '只输出标签本身，用英文逗号分隔；不要中文、不要解释、不要编号、不要引号。',
  '标签数量 8~18 个，按重要性排序：先人物（人数/性别/发色/瞳色/发型），再服装，再动作/表情。',
  '不要重复用户没提到的细节；不要写质量词（masterpiece/best quality 等由系统追加）。',
  '如果用户描述的是角色，把角色名写成 `角色名 (作品名)` 的形式（不确定就按字面描述外观）。',
  '如果描述里含中文背景/场景，翻成英文场景标签（city, night, rain, classroom 等）。',
  '不要写构图/背景类型标签（portrait, upper body, full body, close-up, simple background, ' +
    'white background, detailed background, scenery, wide shot 等）——这些由预设统一控制。'
].join('\n');

const tagCache = new Map();
const hasCJK = (t) => /[\u4e00-\u9fff]/.test(String(t || ''));

export async function translateToTags(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  if (!hasCJK(raw)) return raw;
  if (tagCache.has(raw)) return tagCache.get(raw);
  try {
    const llm = await import('../../src/llm.js');
    const res = await llm.chatCompletion({
      messages: [{ role: 'system', content: TAG_RULES }, { role: 'user', content: raw }],
      temperature: 0.3,
      maxTokens: 260,
      skillContext: { thinkingMode: 'off' }
    });
    const c = res?.message?.content;
    let out = (Array.isArray(c) ? c.map((x) => x?.text ?? '').join('') : String(c ?? ''))
      .replace(/^["'“”「」]+|["'“”「」]+$/g, '')
      .replace(/[；;]/g, ',')
      .replace(/\s*,\s*/g, ', ')
      .trim();
    out = out.split(',').map((x) => x.trim()).filter((x) => x && !hasCJK(x)).join(', ');
    out = stripCompositionTags(out);
    if (!out) return raw;
    tagCache.set(raw, out);
    if (tagCache.size > 300) tagCache.delete(tagCache.keys().next().value);
    log(`tag 翻译：${raw} → ${out}`);
    return out;
  } catch (e) {
    warn(`tag 翻译失败，按原文出图：${e?.message ?? e}`);
    return raw;
  }
}

// ── 指令解析 ────────────────────────────────────────────────────────────────

const PRESET_RE = '(头像|立绘|表情包|场景|鲸鱼娘)';
const HELP_WORDS = /^(帮助|help|说明|用法|\?|？)$/i;

/** 骨骼文件 → 中文名（用于确认话术和图片说明） */
const POSE_LABELS = {
  'pose-stand.png': '站着',
  'pose-wave.png': '挥手',
  'pose-hold.png': '撑伞',
  'pose-sit.png': '坐着',
  'pose-walk.png': '走路',
  'pose-backhands.png': '背手',
  'pose-turn.png': '回眸'
};

export function poseLabel(pose) {
  if (!pose || pose === 'off') return '';
  return POSE_LABELS[pose] || pose.replace('pose-', '').replace('.png', '');
}

export function presetNames(s = DEFAULTS) {
  return Object.keys({ ...DEFAULT_PRESETS, ...(s.presets || {}) });
}

export function helpText(s = DEFAULTS) {
  const cmd = String(s.command || '/画');
  const poses = POSE_CUES.map((c) => poseLabel(c.pose)).filter(Boolean);
  return [
    `【${cmd} 用法】`,
    `${cmd} <描述> [--预设 名字] [--放大 2] [--种子 123] [--姿势 挥手]`,
    `预设：${presetNames(s).join(' / ')}`,
    `姿势（会自动识别）：${poses.join(' / ')}`,
    `例子：`,
    `  ${cmd} 鲸鱼娘在海边挥手`,
    `  ${cmd} 鲸鱼娘 穿泳装 在海边 --放大 2`,
    `  ${cmd} 鲸鱼娘 坐着看落日 --种子 1234`,
    `  ${cmd} 笑得开心 --预设 表情包`,
    `  ${cmd} 鲸鱼娘 --无骨骼（自由构图，不用骨骼约束）`,
    `说明：群里要 @我 才行；每人每天 ${Number(s.dailyCap) || 10} 张，冷却 ${Number(s.cooldownSeconds) || 60} 秒。`
  ].join('\n');
}

/** 从文本里抓 `--键 值` 形式的参数 */
function takeFlag(rest, keys) {
  const re = new RegExp(`(?:--|—)\\s*(?:${keys.join('|')})\\s*(?:[:=：]\\s*)?([^\\s-][^\\-]*?)?\\s*$`, 'i');
  const m = rest.match(re);
  if (!m) return null;
  return { value: (m[1] || '').trim(), stripped: rest.slice(0, m.index).trim() };
}

/**
 * 自然语言触发：「画一张鲸鱼娘在海边」「帮我画个…」「来张图…」
 * 只有消息**开头**就是画图意图才命中，避免把"这个画风不错"当成指令。
 */
const IMPLICIT_RE = /^(?:帮我|给我|请|麻烦|你|能不能|可以)?\s*(?:画|绘制|画张|画图|来一?张图?|来图|出图)[\s:：,，]*(?:一|1)?\s*(?:张|幅|个)?\s*(.+)$/;

export function parseImplicit(text) {
  const raw = String(text || '').replace(/^(\s*@\S+\s*)+/, '').trim();
  const m = raw.match(IMPLICIT_RE);
  if (!m) return null;
  const prompt = String(m[1] || '').replace(/^(图|画面)[\s]*/, '').replace(/[。！!？?，,、\s]+$/, '').trim();
  if (prompt.length < 2) return null;
  if (/^(图|画|个画|一张|张图|个图)$/.test(prompt)) return null;
  return { prompt, implicit: true };
}

/**
 * `/画 <描述> [--预设 名字] [--放大 2] [--种子 123] [--姿势 wave] [--无骨骼]`
 * 也支持老写法：`/画 立绘 描述`、`/画 描述 --立绘`
 * @returns {null | {prompt, preset, upscale, seed, pose, controlnet, help}}
 */
export function parseCommand(text, s = DEFAULTS) {
  const raw = String(text || '').replace(/^(\s*@\S+\s*)+/, '').trim();
  const cmd = String(s.command || '/画');
  if (!raw.startsWith(cmd)) return null;
  let rest = raw.slice(cmd.length).trim();

  if (HELP_WORDS.test(rest)) return { help: true, prompt: '', preset: '', upscale: 0, seed: 0, pose: '' };

  let preset = '';
  let upscale = 0;
  let seed = 0;
  let pose = '';
  let controlnet = null;

  // --无骨骼 / --不放大
  if (/(?:--|—)\s*(?:无骨骼|关骨骼|no-?controlnet)/i.test(rest)) {
    controlnet = false;
    rest = rest.replace(/(?:--|—)\s*(?:无骨骼|关骨骼|no-?controlnet)\s*/i, ' ').trim();
  }
  if (/(?:--|—)\s*(?:不放大|原尺寸|no-?upscale)/i.test(rest)) {
    upscale = 1;
    rest = rest.replace(/(?:--|—)\s*(?:不放大|原尺寸|no-?upscale)\s*/i, ' ').trim();
  }

  // --放大 2 / --up 2
  {
    const m = rest.match(/(?:--|—)\s*(?:放大|upscale|up)\s*([0-9]+(?:\.[0-9]+)?)?/i);
    if (m) {
      upscale = Number(m[1]) || 2;
      rest = rest.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // --种子 123 / --seed 123
  {
    const m = rest.match(/(?:--|—)\s*(?:种子|seed)\s*([0-9]{1,12})/i);
    if (m) {
      seed = Number(m[1]) || 0;
      rest = rest.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // --姿势 wave（也认中文：挥手/坐着…）
  {
    const m = rest.match(/(?:--|—)\s*(?:姿势|pose)\s*([^-\s]+)/i);
    if (m) {
      const v = m[1].trim();
      const hit = POSE_CUES.find((c) =>
        c.pose.toLowerCase().includes(v.toLowerCase()) || c.words.some((w) => w.includes(v))
      );
      pose = hit ? hit.pose : (v.startsWith('pose-') ? v : `pose-${v}.png`);
      rest = rest.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // --预设 名字（默认用 pickPreset 自动猜）
  {
    const m = rest.match(new RegExp(`(?:--|—)\\s*(?:预设|preset)\\s*${PRESET_RE}`, 'i'));
    if (m) {
      preset = m[1];
      rest = rest.replace(m[0], ' ').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // 老写法：尾部 `--立绘` / 头部 `立绘 描述`
  if (!preset) {
    const mTail = rest.match(new RegExp(`(?:--|—)\\s*${PRESET_RE}\\s*$`));
    if (mTail) {
      preset = mTail[1];
      rest = rest.slice(0, mTail.index).trim();
    }
  }
  if (!preset) {
    const mHead = rest.match(new RegExp(`^${PRESET_RE}[\\s:：,，]`));
    if (mHead) {
      preset = mHead[1];
      rest = rest.slice(mHead[0].length).trim();
    }
  }

  return {
    prompt: rest,
    preset,
    upscale,
    seed,
    pose,
    controlnet,
    help: false
  };
}

// ── 限流 ────────────────────────────────────────────────────────────────────

function statePath() {
  return path.join(DATA_DIR, 'comfy-draw-state.json');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeState(st) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(st, null, 1), 'utf8');
  } catch (e) {
    warn(`写状态失败：${e?.message ?? e}`);
  }
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rateOk(s, chatKey) {
  const st = readState();
  const day = todayKey();
  if (st.day !== day) { st.day = day; st.daily = {}; }
  st.daily = st.daily || {};
  st.lastAt = st.lastAt || {};
  const cap = Number(s.dailyCap) || 10;
  if (Number(st.daily[chatKey] || 0) >= cap) {
    return { ok: false, why: `今天这里画够了（上限 ${cap} 张），明天再来吧` };
  }
  const cd = Math.max(0, Number(s.cooldownSeconds) || 0) * 1000;
  const last = Number(st.lastAt[chatKey] || 0);
  if (cd && Date.now() - last < cd) {
    return { ok: false, why: `别急，${Math.ceil((cd - (Date.now() - last)) / 1000)} 秒后再画` };
  }
  return { ok: true };
}


// 画完把 ComfyUI 关掉：常态不占显存/内存。20 秒宽限里又来一张就不关了。
let comfyStopTimer = null;

function scheduleComfyStop(s, chatKey) {
  if (s.stopComfyAfterDraw === false) return;
  if (comfyStopTimer) clearTimeout(comfyStopTimer);
  const delay = Math.max(5000, Number(s.stopComfyDelayMs) || 20000);
  comfyStopTimer = setTimeout(() => {
    comfyStopTimer = null;
    if (drawingNow(chatKey)) return;          // 还在画，别关
    try {
      const port = Number((String(s.comfyUrl || '').match(/:(\d+)/) || [])[1]) || 8188;
      const killed = stopComfy(port);
      if (killed.length) log(`已关闭 ComfyUI（pid ${killed.join(',')}），显存已释放`);
    } catch (e) {
      warn(`关闭 ComfyUI 失败：${e?.message ?? e}`);
    }
  }, delay);
  if (comfyStopTimer.unref) comfyStopTimer.unref();
}

function cancelComfyStop() {
  if (comfyStopTimer) { clearTimeout(comfyStopTimer); comfyStopTimer = null; }
}

// 画图那一条消息：插件已经自己回了「好，画…」，这轮不再让模型另说一句
// （否则会出现"我哪来的笔""现成的鲸鱼娘"这种自相矛盾的话）。
const suppressUntil = new Map();   // chatKey → 截止时间戳

function markSuppress(chatKey) {
  suppressUntil.set(String(chatKey), Date.now() + 25_000);
}

function suppressActive(chatKey) {
  const key = String(chatKey);
  const until = Number(suppressUntil.get(key) || 0);
  if (!until) return false;
  if (Date.now() > until) { suppressUntil.delete(key); return false; }
  return true;
}

// 防重：钩子已经开画时，模型再调工具就不重复画
const inflight = new Map();

function drawingNow(chatKey) {
  const t0 = Number(inflight.get(chatKey) || 0);
  return Boolean(t0) && Date.now() - t0 < 150000;
}

function markUsed(chatKey) {
  const st = readState();
  const day = todayKey();
  if (st.day !== day) { st.day = day; st.daily = {}; }
  st.daily = st.daily || {};
  st.daily[chatKey] = Number(st.daily[chatKey] || 0) + 1;
  st.lastAt = st.lastAt || {};
  st.lastAt[chatKey] = Date.now();
  writeState(st);
}

// ── 出图（翻译 + core）──────────────────────────────────────────────────────

export async function draw(opts = {}) {
  const s = settings();
  const desc = String(opts.prompt || '').trim();
  if (!desc) throw new Error('没有描述，画什么？');
  const cfg = coreConfig(s);
  const up = await ensureComfy(cfg);
  if (!up.ok) throw new Error(up.why || 'ComfyUI 没起来');
  if (up.started) log('ComfyUI 刚被拉起，等待就绪…');
  const tags = await translateToTags(desc);
  const upscale = Number(opts.upscale) || Number(s.defaultUpscale) || 1;
  const r = await coreDraw(coreConfig(s), {
    prompt: desc,
    tags,
    preset: opts.preset,
    seed: opts.seed,
    pose: opts.pose,
    upscale,
    controlnet: opts.controlnet
  });
  return { ...r, upscale };
}

/** 生成一句人话确认：「好，画（鲸鱼娘，挥手）…约 60~90 秒」 */
export function ackText(cmd, s = DEFAULTS) {
  const picked = pickPreset(cmd.prompt, cmd.preset, { ...DEFAULT_PRESETS, ...(s.presets || {}) });
  const pose = cmd.pose || matchPose(cmd.prompt);
  const poseName = poseLabel(pose);
  const extra = [picked.name, poseName].filter(Boolean).join('，');
  return `好，画${extra ? `（${extra}）` : ''}…大约 60~90 秒`;
}

// ── 生命周期 ────────────────────────────────────────────────────────────────

export function setup(a) {
  api = a;
  if (typeof api?.registerTool !== 'function') return;
  api.registerTool({
    id: 'comfy_draw',
    name: '画图',
    description:
      '用本地 ComfyUI 画一张图并发到当前会话。对方明确让你画图/出图/来一张/画个谁时调用。' +
      'prompt 可以直接写中文（会自动翻成模型标签），写具体些：人物/服装/动作/场景/光线。' +
      'preset 决定尺寸风格：鲸鱼娘（默认角色，896x1152 竖版）/ 头像（方形特写）/ 立绘（竖版全身）/' +
      '表情包（512 小图，最快）/ 场景（横版风景）。姿势会从 prompt 自动识别（挥手/撑伞/坐着/走路/背手/回眸）。' +
      '画一张约 60~90 秒，别连续调很多次。',
    category: 'media',
    icon: '🎨',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '想画什么，中文即可，写具体（人物/服装/动作/场景/光线）' },
        preset: { type: 'string', enum: ['鲸鱼娘', '头像', '立绘', '表情包', '场景'], description: '预设，默认鲸鱼娘' },
        upscale: { type: 'number', description: '放大倍数：1=不额外放大（默认），2=四倍模型放大后缩到 2 倍' },
        seed: { type: 'number', description: '固定种子可复现，不传则随机' },
        pose: { type: 'string', description: '骨骼姿势：stand/wave/hold/sit/walk/backhands/turn，不传则自动识别' }
      },
      required: ['prompt']
    },
    async execute(ctx = {}, args = {}) {
      try {
        const s = settings();
        if (s.enabled === false) return { content: '画笔插件已关闭。', isError: true };
        const chatKey = String(ctx.chatKey || '');
        const gate = rateOk(s, chatKey);
        if (!gate.ok) return { content: gate.why, isError: true };
        if (!String(args?.prompt || '').trim()) return { content: '没说要画什么，加一句描述。', isError: true };
        if (drawingNow(chatKey)) return { content: '上一张还在画，等它出来再说。' };
        markUsed(chatKey);
        cancelComfyStop();
        inflight.set(chatKey, Date.now());
        const r = await draw({
          prompt: args.prompt,
          preset: args.preset,
          upscale: args.upscale,
          seed: args.seed,
          pose: args.pose
        });
        await obSendImage(getConfig, chatKey, r.file);
        inflight.delete(chatKey);
        scheduleComfyStop(s, chatKey);
        return {
          content: `画好了并发出去：${r.preset}，${r.width}x${r.height}，seed ${r.seed}，用时 ${(r.ms / 1000).toFixed(1)} 秒。` +
            `用的标签：${r.tags}`
        };
      } catch (e) {
        try { inflight.delete(chatKey); } catch { /* ignore */ }
        return { content: `画图失败：${String(e?.message ?? e).slice(0, 140)}`, isError: true };
      }
    }
  });
}

export function activate() {
  const s = settings();
  log(`画笔就位：ComfyUI ${s.comfyUrl}｜SD1.5=${s.modelSd15}｜SDXL=${s.modelSdxl}｜放大=${s.upscaler}`);
  log(`预设：${presetNames(s).join(' / ')}｜指令 ${s.command} <描述> [--预设] [--放大 2] [--种子 123]`);
  log(`限流：每天 ${s.dailyCap} 张 / 冷却 ${s.cooldownSeconds} 秒 / 群里需 @`);
  if (s.autoStopVoice !== false) log('画图时会自动暂停 TTS 腾显存，画完自动拉起');
}

export function available() { return settings().enabled !== false; }

// ── 钩子 ────────────────────────────────────────────────────────────────────

export const hooks = {
  async 'before-context'(ctx = {}) {
    try {
      const s = settings();
      if (s.enabled === false) return;
      const chatKey = String(ctx.chatKey || '');
      if (!chatKey) return;
      const isGroup = chatKey.startsWith('group:');
      if (isGroup && s.allowGroups === false) return;
      const entries = Array.isArray(ctx.triggerEntries) ? ctx.triggerEntries : [];

      for (const e of entries) {
        if (isGroup && e?.atMe !== true) continue;
        let cmd = parseCommand(e?.text, s);
        // 没打 /画 但一开口就是"画一张…" → 也当指令（私聊尤其需要）
        if (!cmd && s.allowNatural !== false) {
          const imp = parseImplicit(e?.text);
          if (imp) cmd = { prompt: imp.prompt, preset: '', upscale: 0, seed: 0, pose: '', controlnet: null, help: false };
        }
        if (!cmd) continue;

        const sendText = (text) => obSendText(getConfig, chatKey, text).catch((e) => warn(`发文字失败：${e?.message ?? e}`));

        if (cmd.help) {
          await sendText(helpText(s));
          return;
        }

        const gate = rateOk(s, chatKey);
        if (!gate.ok) {
          await sendText(gate.why);
          return;
        }
        if (!cmd.prompt) {
          await sendText(`画什么？说具体点，比如「${s.command} 鲸鱼娘在海边挥手」。\n发「${s.command} 帮助」看全部用法。`);
          return;
        }
        if (drawingNow(chatKey)) {
          await sendText('上一张还在画，等它出来再说~');
          return;
        }
        markUsed(chatKey);
        inflight.set(chatKey, Date.now());
        cancelComfyStop();
        markSuppress(chatKey);
        await sendText(ackText(cmd, s));

        (async () => {
          try {
            const r = await draw({
              prompt: cmd.prompt,
              preset: cmd.preset,
              upscale: cmd.upscale,
              seed: cmd.seed,
              pose: cmd.pose,
              controlnet: cmd.controlnet
            });
            const bits = [r.preset, `${r.width}x${r.height}`];
            if (r.upscale > 1) bits.push(`放大${r.upscale}x`);
            if (r.pose && r.pose !== 'off') bits.push(poseLabel(r.pose));
            await obSendImage(getConfig, chatKey, r.file);
            log(`已发送画作 → ${chatKey}（${r.preset}, seed ${r.seed}, ${(r.ms / 1000).toFixed(1)}s）`);
            inflight.delete(chatKey);
            scheduleComfyStop(s, chatKey);
            inflight.delete(chatKey);
          } catch (err) {
            inflight.delete(chatKey);
            warn(`画图失败：${err?.message ?? err}`);
            const msg = /timeout|超时/i.test(String(err?.message))
              ? '画得有点久，超时了。再试一次，或者换个简单点的描述。'
              : `画失败了：${String(err?.message ?? err).slice(0, 120)}`;
            await obSendText(getConfig, chatKey, msg).catch(() => {});
          }
        })();
        return;
      }
    } catch (e) {
      warn(`before-context 失败：${e?.message ?? e}`);
    }
  },

  /** 画图那一轮：告诉模型别解释"不会画"，图会自己发出来 */
  async 'before-llm-messages'(ctx = {}) {
    try {
      if (!suppressActive(ctx.chatKey)) return;
      if (!Array.isArray(ctx.messages)) return;
      ctx.messages.push({
        role: 'system',
        content: '【画图】这条请求已经在后台出图了，图片由插件直接发出，'
          + '大约 45~60 秒后到达。这一轮不需要你说话，也不要解释自己不会画、没有笔之类的。'
      });
    } catch { /* 忽略 */ }
  },

  /** 画图那一轮：她要是想说话就拦住（图已经由插件发了） */
  async 'before-tool'(ctx = {}) {
    try {
      const chatKey = String(ctx.chatKey || '');
      if (!chatKey || !suppressActive(chatKey)) return;
      const name = String(ctx.toolName || '');
      if (/^send_(message|to|sticker|poke)$/.test(name)) {
        suppressUntil.delete(chatKey);
        return { block: true, reason: '画图已经在后台进行，图片马上由插件发出，这一轮不用你另外说话。' };
      }
    } catch { /* 忽略 */ }
  }
};

export const internals = {
  settings, translateToTags, parseCommand, parseImplicit, draw, coreConfig, ackText, helpText, presetNames,
  pickPreset, stripCompositionTags, comfyStatus, comfyModels, coreInternals
};
