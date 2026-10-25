// 鲸语（确定性型 / plugins/，纯插件不改核心）
//
// 干两件事：
//   1. `/语音 <内容>`（群里要 @ 她）→ 本地 GPT-SoVITS 合成 → 发成 QQ 语音条
//   2. registerTool('send_voice')  → 她在聊天里自己决定说话（比如有人让她"用语音说"）
//
// 为什么不用核心的 sender：hook 里拿不到 sender 对象，而 /语音 是"确定性指令"，
// 不该指望模型去调工具。所以这里直接走 SnowLuma 的 OneBot HTTP API（和 her-life 同一条路）：
// 令牌从 snowluma/config/onebot_*.json 里发现，探活后使用。
//
// 语音格式：直接给 SnowLuma 一个本地 wav 路径即可 —— 它内部会用 encodeSilk() 转成 silk，
// 这一步实测有效（见 README 的验证记录）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { getConfig, DATA_DIR } from '../../src/config.js';

let api = null;

const DEFAULTS = {
  enabled: true,
  ttsBaseUrl: 'http://127.0.0.1:9880',
  gptSovitsDir: 'D:\\GPT-SoVITS',
  pythonExe: 'D:\\GPT-SoVITS\\python310\\python.exe',
  apiScript: 'api_v2.py',
  autoStart: true,
  command: '/语音',
  // @她 + 这个关键词 + 语言词 + 内容（默认：语音）
  keyword: '语音',
  // 输出语言：zh = 让她说中文，ja = 让她说日文（音色按语言分开挑）
  lang: 'zh',
  defaultVoice: '鲸鱼娘',
  // 每种语言各自的默认音色：{ zh: '艾丽妮-中', ja: '艾丽妮-日' }
  defaultVoices: {},
  voices: [],
  maxSeconds: 20,
  maxChunks: 2,
  cooldownSeconds: 60,
  dailyCap: 20
};

// 每个会话一次处理（sessionId）的临时状态
const pending = new Map();
// 上次发送时间 / 当天计数
const lastSent = new Map();
let dayBucket = { day: '', counts: new Map() };
let serverStarting = null;
let lastSpawnAt = 0;   // 防重复拉起：120 秒内不再 spawn
let serverChild = null;   // 我们拉起的服务进程
let currentConfig = '';   // 当前服务加载的语言配置
// 当前 TTS 服务加载的 SoVITS 权重（用于按语言自动切换模型）
let currentWeights = '';

/** 切换 SoVITS 权重（同一条路径不重复切）。 */
export async function ensureWeights(baseUrl, weightsPath) {
  const want = String(weightsPath || '').trim();
  if (!want) return false;
  if (currentWeights === want) return true;
  const base = String(baseUrl || DEFAULTS.ttsBaseUrl).replace(/\/+$/, '');
  const url = `${base}/set_sovits_weights?weights_path=${encodeURIComponent(want)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`切换音色模型失败：HTTP ${r.status} ${text.slice(0, 120)}`);
  currentWeights = want;
  log(`音色模型已切换：${path.basename(want)}`);
  return true;
}

/**
 * 取音色列表。配置里的 voices 被核心深合并写坏成字符串时（历史上真发生过两次：
 * "[object Object],[object Object]"），退回读 voicesFile 指向的 JSON 文件。
 */
function voicesOf(s) {
  const v = s && s.voices;
  if (Array.isArray(v) && v.length) return v.filter((x) => x && x.name);
  const file = String((s && s.voicesFile) || 'D:\\GPT-SoVITS\\voices.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(j) && j.length) return j.filter((x) => x && x.name);
  } catch { /* 文件不存在或坏了就继续往下 */ }
  if (typeof v === 'string') {
    try {
      const j = JSON.parse(v);
      if (Array.isArray(j) && j.length) return j.filter((x) => x && x.name);
    } catch { /* 不是 JSON 就放弃 */ }
  }
  return [];
}

function settings() {
  try {
    const c = api?.config?.();
    return { ...DEFAULTS, ...(c && typeof c === 'object' ? c : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function log(...a) { api?.log?.(...a); }
function warn(...a) { api?.warn?.(...a); }

// ── 小工具 ──────────────────────────────────────────────────────────────────

function sessionKey(ctx) {
  return String(ctx?.sessionId || ctx?.chatKey || '');
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bumpDay() {
  const d = todayKey();
  if (dayBucket.day !== d) dayBucket = { day: d, counts: new Map() };
  return dayBucket;
}

/** 限流检查：同会话冷却 + 当天上限。 */
export function checkRate(chatKey, s, now = Date.now()) {
  const cool = Math.max(0, Number(s.cooldownSeconds) || 0) * 1000;
  const last = lastSent.get(chatKey) || 0;
  if (cool > 0 && now - last < cool) {
    return { ok: false, reason: `太频繁了，再等 ${Math.ceil((cool - (now - last)) / 1000)} 秒` };
  }
  const bucket = bumpDay();
  const cap = Math.max(1, Number(s.dailyCap) || 20);
  const used = bucket.counts.get(chatKey) || 0;
  if (used >= cap) return { ok: false, reason: `今天这个会话已经发满 ${cap} 条语音了` };
  return { ok: true };
}

function markSent(chatKey, now = Date.now()) {
  lastSent.set(chatKey, now);
  const bucket = bumpDay();
  bucket.counts.set(chatKey, (bucket.counts.get(chatKey) || 0) + 1);
}

/** 中文按字数估算：正常语速约 5.5 字/秒。 */
function charBudget(s) {
  return Math.max(20, Math.round((Number(s.maxSeconds) || 20) * 5.5));
}

/** 按句切分，保证每段不超过预算，最多切 maxChunks 段。 */
export function splitText(text, s) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const budget = charBudget(s);
  const maxChunks = Math.max(1, Number(s.maxChunks) || 2);
  if (raw.length <= budget) return [raw];
  const parts = [];
  let cur = '';
  for (const ch of raw) {
    if (cur.length >= budget) {
      parts.push(cur);
      cur = '';
      if (parts.length >= maxChunks) break;
    }
    cur += ch;
    // 句末标点处优先断开
    if ('。！？!?；;…'.includes(ch) && cur.length >= budget * 0.55) {
      parts.push(cur);
      cur = '';
      if (parts.length >= maxChunks) break;
    }
  }
  if (cur && parts.length < maxChunks) parts.push(cur);
  return parts.slice(0, maxChunks);
}

/** 把 16bit PCM WAV 的峰值拉到目标值（默认 0.89 ≈ -1dBFS）。原地修改 Buffer。 */
export function normalizeWav(buf, target = 0.89) {
  if (buf.length < 44) return false;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return false;
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { bits: buf.readUInt16LE(body + 14) };
    if (id === 'data') data = { start: body, size: Math.min(size, buf.length - body) };
    off = body + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16) return false;
  const samples = Math.floor(data.size / 2);
  if (samples < 100) return false;
  let peak = 0;
  for (let i = 0; i < samples; i += 1) {
    const v = Math.abs(buf.readInt16LE(data.start + i * 2));
    if (v > peak) peak = v;
  }
  if (!peak) return false;
  const gain = (target * 32767) / peak;
  if (gain > 0.98 && gain < 1.02) return true;
  for (let i = 0; i < samples; i += 1) {
    const p = data.start + i * 2;
    const v = Math.round(buf.readInt16LE(p) * gain);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), p);
  }
  return true;
}

/** 读 16bit PCM WAV → { sr, samples:Float32Array }。 */
function readWav(buf) {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let sr = 0;
  let bits = 0;
  let ch = 0;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      ch = buf.readUInt16LE(body + 2);
      sr = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    }
    if (id === 'data') data = { start: body, size: Math.min(size, buf.length - body) };
    off = body + size + (size % 2);
  }
  if (!data || bits !== 16 || !sr || ch < 1) return null;
  const n = Math.floor(data.size / (2 * ch));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    let acc = 0;
    for (let c = 0; c < ch; c += 1) acc += buf.readInt16LE(data.start + (i * ch + c) * 2);
    out[i] = acc / (ch * 32768);
  }
  return { sr, samples: out };
}

/** 线性插值重采样（语音够用）。 */
function resample(samples, from, to) {
  if (from === to) return samples;
  const ratio = to / from;
  const n = Math.max(1, Math.floor(samples.length * ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/** 一个 biquad 高架（RBJ cookbook），提升 3kHz 以上的临场感。 */
function highShelf(samples, sr, freq, gainDb, slope = 0.7) {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = (sinw / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
  const b0 = A * (A + 1 + (A - 1) * cosw + twoSqrtAalpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cosw);
  const b2 = A * (A + 1 + (A - 1) * cosw - twoSqrtAalpha);
  const a0 = A + 1 - (A - 1) * cosw + twoSqrtAalpha;
  const a1 = 2 * (A - 1 - (A + 1) * cosw);
  const a2 = A + 1 - (A - 1) * cosw - twoSqrtAalpha;
  const out = new Float32Array(samples.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    out[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}

/** 软压缩：把弱音提上来，编码后不容易被丢掉。 */
function compress(samples, sr, threshold = 0.18, ratio = 3, makeup = 1.5) {
  const attack = Math.exp(-1 / (0.008 * sr));
  const release = Math.exp(-1 / (0.12 * sr));
  const out = new Float32Array(samples.length);
  let env = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const a = Math.abs(x);
    env = a > env ? attack * env + (1 - attack) * a : release * env + (1 - release) * a;
    let gain = 1;
    if (env > threshold) {
      const over = env - threshold;
      const reduced = over / ratio;
      gain = (threshold + reduced) / env;
    }
    out[i] = Math.max(-1, Math.min(1, x * gain * makeup));
  }
  return out;
}

/**
 * 为 QQ 的 silk 编码做预处理：24kHz + 3kHz 提亮 + 轻压缩 + 峰值归一。
 * QQ 语音是 ~24kbps 的窄带编码，直接送 32kHz 原始 wav 会又闷又糊；
 * 这里先把"编码保不住的高频"换成"编码前就提亮的临场感"，听感会清楚一截。
 */
export function enhanceForSilk(buf, targetSr = 24000) {
  const wav = readWav(buf);
  if (!wav) return null;
  let x = resample(wav.samples, wav.sr, targetSr);
  x = highShelf(x, targetSr, 3000, 4.0, 0.7);
  x = compress(x, targetSr, 0.18, 3, 1.4);
  let peak = 0;
  for (let i = 0; i < x.length; i += 1) peak = Math.max(peak, Math.abs(x[i]));
  const g = peak > 0 ? 0.94 / peak : 1;
  // 组一个标准 44 字节头的单声道 16bit wav
  const dataLen = x.length * 2;
  const out = Buffer.alloc(44 + dataLen);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + dataLen, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);          // PCM
  out.writeUInt16LE(1, 22);          // mono
  out.writeUInt32LE(targetSr, 24);
  out.writeUInt32LE(targetSr * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < x.length; i += 1) {
    const v = Math.max(-1, Math.min(1, x[i] * g));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return out;
}

/** 双二阶低切（去隆隆声/喷麦）。 */
function highPass(samples, sr, freq, q = 0.707) {
  const w0 = (2 * Math.PI * freq) / sr;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = (1 + cosw) / 2;
  const b1 = -(1 + cosw);
  const b2 = (1 + cosw) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw;
  const a2 = 1 - alpha;
  const out = new Float32Array(samples.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    out[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}

/** 低架衰减（削掉 250~350Hz 的"闷"）。 */
function lowShelf(samples, sr, freq, gainDb, slope = 0.8) {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = (sinw / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const twoSqrtAalpha = 2 * Math.sqrt(A) * alpha;
  const b0 = A * ((A + 1) - (A - 1) * cosw + twoSqrtAalpha);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
  const b2 = A * ((A + 1) - (A - 1) * cosw - twoSqrtAalpha);
  const a0 = (A + 1) + (A - 1) * cosw + twoSqrtAalpha;
  const a1 = -2 * ((A - 1) + (A + 1) * cosw);
  const a2 = (A + 1) + (A - 1) * cosw - twoSqrtAalpha;
  const out = new Float32Array(samples.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    out[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}

/**
 * v2：针对"QQ 里听着糊"再优化。
 * 多了 110Hz 低切（去轰隆）、300Hz 低架衰减（去闷）、更亮的 3.2kHz、更轻的压缩（避免糊成一团）。
 */
export function enhanceForSilk2(buf, opt = {}) {
  const wav = readWav(buf);
  if (!wav) return null;
  const sr = 24000;
  let x = resample(wav.samples, wav.sr, sr);
  x = highPass(x, sr, Number(opt.hpHz) || 110, 0.707);
  x = lowShelf(x, sr, Number(opt.mudHz) || 300, Number(opt.mudDb) || -2.5, 0.8);
  x = highShelf(x, sr, Number(opt.presHz) || 3200, Number(opt.presDb) || 6, 0.7);
  x = compress(x, sr, 0.15, Number(opt.ratio) || 2, Number(opt.makeup) || 1.2);
  let peak = 0;
  for (let i = 0; i < x.length; i += 1) peak = Math.max(peak, Math.abs(x[i]));
  const g = peak > 0 ? 0.95 / peak : 1;
  const dataLen = x.length * 2;
  const out = Buffer.alloc(44 + dataLen);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + dataLen, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sr, 24);
  out.writeUInt32LE(sr * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < x.length; i += 1) {
    const v = Math.max(-1, Math.min(1, x[i] * g));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return out;
}

/** 解析语言标记：zh / ja / 中 / 日，其他返回 null。 */
export function parseLang(token) {
  const t = String(token || '').toLowerCase();
  if (t === 'zh' || t === '中' || t === '中文') return 'zh';
  if (t === 'ja' || t === '日' || t === '日文' || t === 'jp') return 'ja';
  return null;
}

/**
 * 认指令，两种格式都支持：
 *   新（主用法）：@她 语音 中文/日语 <内容>
 *   旧（后备）：  /语音 [ja|中文] <内容>
 * 语言词缺省时用设置里的默认语言。
 */
const LANG_WORD_RE = /(日语|日文|日語|中文|汉语|国语)/;
// 像"会不会太吵/好听吗/是不是很怪"这种是聊天，不是指令
const QUESTION_RE = /(会不会|是不是|能不能|可不可以|怎么样|为什么|干嘛|吗|么|呢)/;

/** 从一段话里剥出「语言」和「要说的内容」。 */
function splitLang(text) {
  let lang = null;
  let rest = String(text || '');
  const m = rest.match(/^(?:用|拿)?\s*(日语|日文|日語|中文|汉语|国语)\s*/);
  if (m) {
    lang = /日/.test(m[1]) ? 'ja' : 'zh';
    rest = rest.slice(m[0].length);
  } else {
    const any = rest.match(LANG_WORD_RE);
    if (any) lang = /日/.test(any[1]) ? 'ja' : 'zh';
  }
  return { lang, rest };
}

/** 去掉开头/结尾的标点、引号、语气尾巴；返回真正要说的话。 */
function cleanBody(s) {
  let rest = String(s || '')
    .replace(/^[\s:：,，。.!！?？~～、的]+/, '')
    .trim()
    .replace(/^["'“”「」『』]+|["'“”「」『』]+$/g, '')
    .trim();
  const bare = rest.replace(/[吧呀啊哦嘛呢哈了的啦~～。.!！?？\s]/g, '');
  return bare ? rest : '';
}

/**
 * 自然语言认语音指令（只在被 @ 时调用）。
 *   「用语音说 主人晚安」「说一句给我听 你好呀」「来一句日语」「用日语讲 おやすみ」
 */
export function parseNatural(text) {
  const raw = String(text || '').replace(/^(\s*@\S+\s*)+/, '').trim();
  if (!raw) return null;
  // 疑问句几乎都是聊天
  if (QUESTION_RE.test(raw)) return null;

  const rules = [
    // 用日语讲 / 拿中文念一句
    { re: /^(?:用|拿)?\s*(日语|日文|日語|中文|汉语|国语)\s*(?:来)?\s*(说|讲|念|读|唱)\s*(?:一句|一段|一下|一遍)?/, langFromRule: true },
    // 用语音说 / 拿声音念
    { re: /^(?:请|帮我|麻烦你?|能不能|可以)?\s*(?:用|拿)?\s*(语音|声音|嗓子)\s*(?:来)?\s*(说|讲|念|读|发)?\s*(?:一句|一段|一下|一遍|条)?/ },
    // 说一句给我听 / 念一遍
    { re: /^(?:请|帮我|麻烦你?|能不能|可以)?\s*(说|讲|念|读)\s*(?:一句|一段|一下|一遍)\s*(?:给我听|给我|我听|听听)?/ },
    // 来一句日语 / 发段语音
    { re: /^(?:请|帮我|麻烦你?|能不能|可以)?\s*(?:来|发)\s*(?:一句|一段|一条)?\s*(语音|声音|日语|日文|中文|汉语)/, langFromRule: true }
  ];

  for (const r of rules) {
    const m = raw.match(r.re);
    if (!m) continue;
    let rest = raw.slice(m[0].length);
    let lang = null;
    if (r.langFromRule) {
      const word = m.slice(1).find((x) => x && LANG_WORD_RE.test(x));
      if (word) lang = /日/.test(word) ? 'ja' : 'zh';
    }
    const body = cleanBody(rest);
    // 规则命中但正文为空 → 让她自己说一句
    return { text: body, lang, mode: body ? 'nl' : 'ask' };
  }
  return null;
}

export function parseCommand(entries, s, ctx = {}) {
  const isPrivate = String(ctx.chatKey || '').startsWith('private:');
  const legacy = String(s.command || '/语音');
  const kw = String(s.keyword || '语音');
  for (const e of Array.isArray(entries) ? entries : []) {
    const text = String(e?.text ?? '');
    if (!text) continue;

    // ① @她 + 关键词 + [中文|日语] + 内容（关键词必须在开头，避免"用语音说会不会太吵"误判）
    const stripped = text.replace(/^(\s*@\S+\s*)+/, '').trim();
    if (stripped.startsWith(kw)) {
      const sp = splitLang(stripped.slice(kw.length).trim());
      return { text: cleanBody(sp.rest), lang: sp.lang, senderId: String(e?.senderId ?? ''), raw: text, via: 'at' };
    }

    // ①.5 自然语言：群里必须 @ 她；私聊不要求 @（避免群里误触发）
    if (e?.atMe || isPrivate) {
      const nl = parseNatural(text);
      if (nl) return { text: nl.text, lang: nl.lang, senderId: String(e?.senderId ?? ''), raw: text, via: 'nl', mode: nl.mode };
    }

    // ② 旧格式 /语音 [ja|中文] 内容
    const i = text.indexOf(legacy);
    if (i >= 0) {
      let r = text.slice(i + legacy.length).trim();
      let lang = null;
      const m2 = r.match(/^([a-zA-Z\u4e00-\u9fa5]{1,3})[\s:：]+/);
      if (m2) {
        const maybe = parseLang(m2[1]);
        if (maybe) { lang = maybe; r = r.slice(m2[0].length).trim(); }
      }
      return { text: r, lang, senderId: String(e?.senderId ?? ''), raw: text, via: 'slash' };
    }
  }
  return null;
}

/**
 * 挑选音色。
 * 规则：显式 name 优先 → defaultVoices[lang] → 同 lang 的第一个 → 第一个。
 */
export function resolveVoice(s, name, lang = null) {
  const list = voicesOf(s);
  const outLang = lang || String(s.lang || 'zh');
  const wantLang = parseLang(outLang) || 'zh';

  let hit = null;
  const want = String(name || '').trim();
  if (want) hit = list.find((v) => v.name === want) || null;
  if (!hit) {
    const byLangName = String(s.defaultVoices?.[wantLang] || '').trim();
    if (byLangName) hit = list.find((v) => v.name === byLangName) || null;
  }
  if (!hit) hit = list.find((v) => (parseLang(v.lang) || 'zh') === wantLang) || null;
  if (!hit) hit = list.find((v) => v.name === s.defaultVoice) || list[0] || null;
  if (!hit) return { ok: false, error: '还没配置音色（voices 为空）', lang: wantLang };

  const dir = path.join(String(s.gptSovitsDir || ''), 'ref');
  const file = path.join(dir, String(hit.file || `${hit.name}.wav`));
  if (!fs.existsSync(file)) return { ok: false, error: `参考音频不存在：${file}`, voice: hit, file, lang: wantLang };
  const promptText = String(hit.promptText || '').trim();
  if (!promptText) return { ok: false, error: `音色「${hit.name}」没填 promptText（参考音频的原话）`, voice: hit, file, lang: wantLang };
  return {
    ok: true,
    voice: hit,
    file,
    promptText,
    lang: wantLang,
    promptLang: String(hit.promptLang || hit.lang || wantLang)
  };
}

// ── 自动翻译（说日语时把中文台词翻成日语，反之亦然）────────────────────────

const hasKana = (s) => /[\u3040-\u30ff\u31f0-\u31ff]/.test(String(s || ''));
const hasHan = (s) => /[\u4e00-\u9fff]/.test(String(s || ''));
const transCache = new Map();

/** 用她自己那套模型翻译一句话（失败就原样返回，不打断发语音）。 */
export async function translateText(text, to) {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  const key = `${to}:${raw}`;
  if (transCache.has(key)) return transCache.get(key);
  try {
    const llm = await import('../../src/llm.js');
    const target = to === 'ja' ? '自然口语的日语' : '自然口语的简体中文';
    const res = await llm.chatCompletion({
      messages: [
        {
          role: 'system',
          content: `你是翻译器。把用户给的句子翻译成${target}，只输出译文本身：不要引号、不要解释、不要注释、不要罗马字。保持口语和原有语气（偏软、自然）。`
        },
        { role: 'user', content: raw }
      ],
      temperature: 0.3,
      maxTokens: 300,
      skillContext: { thinkingMode: 'off' }
    });
    const c = res?.message?.content;
    const out = (Array.isArray(c) ? c.map((x) => x?.text ?? '').join('') : String(c ?? ''))
      .trim().replace(/^["'“”「」]+|["'“”「」]+$/g, '');
    if (!out) return raw;
    transCache.set(key, out);
    if (transCache.size > 200) transCache.delete(transCache.keys().next().value);
    return out;
  } catch (e) {
    warn(`翻译失败，按原文发送：${e?.message ?? e}`);
    return raw;
  }
}

/** 目标语言与文本实际语言不一致时自动翻译。 */
async function maybeTranslate(text, lang) {
  const want = lang === 'ja' ? 'ja' : 'zh';
  if (want === 'ja' && !hasKana(text) && hasHan(text)) {
    const ja = await translateText(text, 'ja');
    log(`自动翻译 → 日文：${text} => ${ja}`);
    return ja;
  }
  if (want === 'zh' && hasKana(text)) {
    const zh = await translateText(text, 'zh');
    log(`自动翻译 → 中文：${text} => ${zh}`);
    return zh;
  }
  return text;
}
// ── TTS ─────────────────────────────────────────────────────────────────────

async function probeServer(baseUrl, timeoutMs = 2500) {
  try {
    const r = await fetch(`${baseUrl}/docs`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

function portOf(base) {
  try { return String(new URL(base).port || '9880'); } catch { return '9880'; }
}

/** 干掉占用该端口的 api_v2（只杀命令行里带 api_v2.py 的，别误伤别的程序）。 */
function killServerOnPort(port) {
  try {
    const { execSync } = require('node:child_process');
    const netstat = execSync('netstat -ano -p TCP', { encoding: 'utf8', windowsHide: true });
    const pids = new Set();
    for (const line of netstat.split(/\r?\n/)) {
      if (!line.includes(`:${port} `) || !/LISTENING/i.test(line)) continue;
      const m = line.trim().match(/(\d+)\s*$/);
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) {
      try {
        // wmic 在新版 Windows 已移除，改用 tasklist 判断是不是 python 进程
        const info = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
          { encoding: 'utf8', windowsHide: true });
        if (!/python\.exe/i.test(info)) continue;   // 不是 python，不动
        execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true });
        log(`已停止旧的 TTS 服务（pid ${pid}）`);
      } catch { /* 单个失败不影响 */ }
    }
  } catch { /* netstat 不可用就算了 */ }
}

/** 启动一个 TTS 服务进程（可带 -c 指定语言配置）。 */
async function spawnServer(s, configFile = '') {
  const base = String(s.ttsBaseUrl || DEFAULTS.ttsBaseUrl).replace(/\/+$/, '');
  const dir = path.join(String(s.gptSovitsDir || ''), 'src');
  const py = String(s.pythonExe || 'python');
  const script = String(s.apiScript || 'api_v2.py');
  if (!fs.existsSync(path.join(dir, script))) {
    warn(`自动启动失败：找不到 ${path.join(dir, script)}`);
    return false;
  }
  const args = [script, '-a', '127.0.0.1', '-p', portOf(base)];
  if (configFile) args.push('-c', configFile);
  log(`启动 TTS：${script}${configFile ? ` -c ${path.basename(configFile)}` : ''}（约 12 秒）`);
  const child = spawn(py, args, {
    cwd: dir,
    // CUDAGraph=0：关掉 static cuda graph，它在切模型时会原生崩溃
    env: { ...process.env, CUDAGraph: '0' },
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  serverChild = child;
  for (let i = 0; i < 45; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await probeServer(base)) {
      log('TTS 服务已就绪');
      return true;
    }
  }
  warn('TTS 服务 90 秒内没起来');
  return false;
}

/** 服务没起就后台拉起（只拉一次，避免风暴）。 */
export async function ensureServer(s) {
  const base = String(s.ttsBaseUrl || DEFAULTS.ttsBaseUrl).replace(/\/+$/, '');
  if (await probeServer(base)) return true;
  if (s.autoStart === false) return false;
  if (serverStarting) return serverStarting;
  if (Date.now() - lastSpawnAt < 120000) {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await probeServer(base)) return true;
    }
    return false;
  }
  lastSpawnAt = Date.now();
  serverStarting = (async () => {
    try {
      return await spawnServer(s, '');
    } catch (e) {
      warn(`自动启动异常：${e?.message ?? e}`);
      return false;
    } finally {
      serverStarting = null;
    }
  })();
  return serverStarting;
}

/**
 * 按语言切换模型。这台机器内存只有 15GB，切权重会 CPU OOM，
 * 所以改成"停掉旧进程 + 用对应 yaml 重启"，每次只加载一套模型。
 */
export async function switchModel(s, voice) {
  const cfg = String((voice && voice.config) || '').trim();
  if (!cfg) return false;
  const abs = path.isAbsolute(cfg) ? cfg : path.join(String(s.gptSovitsDir || ''), 'src', cfg);
  if (!fs.existsSync(abs)) {
    warn(`语言配置不存在：${abs}`);
    return false;
  }
  if (currentConfig === abs) return true;
  const base = String(s.ttsBaseUrl || DEFAULTS.ttsBaseUrl).replace(/\/+$/, '');
  if (await probeServer(base)) {
    killServerOnPort(portOf(base));
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      if (!(await probeServer(base))) break;
    }
  }
  serverChild = null;
  currentWeights = '';
  lastSpawnAt = Date.now();
  const ok = await spawnServer(s, abs);
  if (ok) currentConfig = abs;
  return ok;
}

/** 调 GPT-SoVITS 合成一段 wav，返回本地文件路径。 */
export async function synth(text, s, opts = {}) {
  const o = typeof opts === 'string' ? { voice: opts } : (opts || {});
  const v = resolveVoice(s, o.voice, o.lang);
  if (!v.ok) throw new Error(v.error);

  const base = String(s.ttsBaseUrl || DEFAULTS.ttsBaseUrl).replace(/\/+$/, '');
  if (!(await ensureServer(s))) throw new Error('TTS 服务不可用（9880 没起）');

  // 这个音色配了专属语言配置？按语言重启服务（这台机器内存不够热切两套模型）
  if (v.voice.config) {
    const ok = await switchModel(s, v.voice);
    if (!ok) warn('切换语言模型失败，尝试用当前已加载的模型继续');
  } else if (v.voice.weights) {
    await ensureWeights(base, v.voice.weights);
  }

  const body = {
    text,
    text_lang: v.lang || 'zh',
    ref_audio_path: v.file.replace(/\\/g, '/'),
    prompt_text: v.promptText,
    prompt_lang: v.promptLang || v.lang || 'zh',
    top_k: Number(v.voice.topK) || 15,
    top_p: Number(v.voice.topP) || 1,
    temperature: Number(v.voice.temperature) || 0.8,
    text_split_method: String(v.voice.splitMethod || 'cut5'),
    batch_size: 1,
    speed_factor: Number(v.voice.speed) || 1,
    media_type: 'wav',
    streaming_mode: false,
    repetition_penalty: Number(v.voice.repetitionPenalty) || 1.35
  };

  const res = await fetch(`${base}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`TTS 合成失败：HTTP ${res.status} ${detail}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`TTS 返回内容太小（${buf.length} 字节）`);

  // QQ 语音是 ~24kbps silk 窄带编码，直接送 32kHz 原始 wav 会又闷又糊。
  // 这里做编码前增强：降到 24kHz + 3kHz 提亮 + 轻压缩 + 归一化。
  // s.dsp: v1（默认，你现在选的）/ v2（更亮，可能齿音重）/ off（不处理）
  let finalBuf = buf;
  try {
    const mode = String((v.voice && v.voice.dsp) || s.dsp || 'v1');
    if (mode === 'v2') {
      const e = enhanceForSilk2(buf);
      if (e) finalBuf = e;
    } else if (mode !== 'off') {
      const e = enhanceForSilk(buf);
      if (e) finalBuf = e;
    }
  } catch { /* 增强失败就用原始音频 */ }

  const dir = path.join(DATA_DIR, 'voice-cache');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.createHash('sha1').update(`${text}|${v.file}|${Date.now()}`).digest('hex').slice(0, 16)}.wav`;
  const out = path.join(dir, name);
  fs.writeFileSync(out, finalBuf);
  return { ok: true, file: out, bytes: buf.length, voice: v.voice.name, lang: v.lang, promptLang: v.promptLang };
}

// ── 发送（SnowLuma OneBot HTTP） ────────────────────────────────────────────

/** 候选令牌：应用配置优先，其次扫 snowluma/config/onebot_*.json。 */
function onebotTries() {
  const tries = [];
  try {
    const c = getConfig() || {};
    const appCfg = c.snowluma || {};
    const base = String(appCfg.httpUrl || '').replace(/\/+$/, '');
    const token = String(appCfg.httpAccessToken || appCfg.accessToken || '');
    if (base && token) tries.push({ base, token });
  } catch { /* 配置没就绪 */ }

  const appRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const dirs = [path.join(appRoot, 'snowluma', 'config'), path.join(appRoot, '..', 'snowluma', 'config')];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!/^onebot_.*\.json$/i.test(f)) continue;
        try {
          const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          const hs = j?.networks?.httpServers || [];
          const ws = j?.networks?.wsServers || [];
          const port = Number(hs[0]?.port || 3000);
          const tk = String(hs[0]?.accessToken || ws[0]?.accessToken || '');
          if (tk) tries.push({ base: `http://${hs[0]?.host || '127.0.0.1'}:${port}`, token: tk });
        } catch { /* 跳过坏文件 */ }
      }
      if (tries.length) break;
    } catch { /* 目录读不了就算了 */ }
  }
  return tries;
}

async function pickOnebot() {
  const tries = onebotTries();
  if (!tries.length) throw new Error('找不到 OneBot 令牌（snowluma 配置里没有）');
  let lastErr = null;
  for (const t of tries) {
    try {
      const r = await fetch(`${t.base}/get_status`, {
        headers: { authorization: `Bearer ${t.token}` },
        signal: AbortSignal.timeout(6000)
      });
      if (r.ok) return t;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`OneBot 令牌都不可用：${lastErr?.message ?? '未知'}`);
}

export async function sendVoiceFile(chatKey, file) {
  const m = /^(private|group):(\d+)$/.exec(String(chatKey || ''));
  if (!m) throw new Error(`会话键不合法：${chatKey}`);
  const { base, token } = await pickOnebot();
  const action = m[1] === 'private' ? 'send_private_msg' : 'send_group_msg';
  const payload = m[1] === 'private'
    ? { user_id: Number(m[2]), message: [{ type: 'record', data: { file } }] }
    : { group_id: Number(m[2]), message: [{ type: 'record', data: { file } }] };
  const res = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`发送失败：HTTP ${res.status} ${text.slice(0, 160)}`);
  return { ok: true, raw: text };
}

export async function sendText(chatKey, text) {
  const m = /^(private|group):(\d+)$/.exec(String(chatKey || ''));
  if (!m) throw new Error(`会话键不合法：${chatKey}`);
  const { base, token } = await pickOnebot();
  const action = m[1] === 'private' ? 'send_private_msg' : 'send_group_msg';
  const payload = m[1] === 'private'
    ? { user_id: Number(m[2]), message: [{ type: 'text', data: { text } }] }
    : { group_id: Number(m[2]), message: [{ type: 'text', data: { text } }] };
  const res = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`文字兜底发送失败：HTTP ${res.status}`);
  return { ok: true };
}

/** 合成并发送一条语音（可能拆成多条）。失败时按配置退回文字。 */
export async function speakAndSend(chatKey, text, s, store = null, opts = {}) {
  // 语言不匹配时自动翻译（中文台词 + ja → 先翻成日语；日文台词 + zh → 翻成中文）
  const lang = String((opts && opts.lang) || s.lang || 'zh');
  let spoken = String(text || '');
  try {
    spoken = await maybeTranslate(spoken, lang);
  } catch { /* 翻译失败就用原文 */ }
  const chunks = splitText(spoken, s);
  if (!chunks.length) throw new Error('没有可合成的文本');
  const sent = [];
  for (const chunk of chunks) {
    const r = await synth(chunk, s, opts);
    await sendVoiceFile(chatKey, r.file);
    sent.push({ text: chunk, file: r.file, voice: r.voice, lang: r.lang });
    markSent(chatKey);
    try { store?.appendSelf?.(chatKey, { text: `[语音] ${chunk}`, ts: Date.now(), mid: null }); } catch { /* ignore */ }
    await new Promise((res) => setTimeout(res, 600));
  }
  log(`已发语音 ${sent.length} 条 -> ${chatKey}（${sent.map((x) => x.text.length).join('+')} 字，${opts.lang || s.lang || 'zh'}，音色 ${sent[0]?.voice || '?'}）`);
  return { ok: true, sent };
}

// ── 生命周期 ────────────────────────────────────────────────────────────────

export function setup(a) {
  api = a;
  if (typeof api?.registerTool !== 'function') return;
  api.registerTool({
    id: 'send_voice',
    name: '发语音',
    description: '用她自己的声音发一条 QQ 语音条。只在"对方明确要语音"或你觉得这句话用声音说更好时用；日常别滥用。文本会按 20 秒上限自动切分，最多 2 条。',
    category: 'media',
    icon: '🎙️',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要她说出来的话（口语化，别写表情符号和括号动作）' },
        voice: { type: 'string', description: '可选：音色名（默认按语言自动挑）' },
        lang: { type: 'string', description: '可选：zh=说中文 / ja=说日文（默认跟随插件设置）' }
      },
      required: ['text']
    },
    async execute(ctx, args) {
      try {
        const s = settings();
        if (s.enabled === false) return { content: '语音功能已关闭', isError: true };
        const text = String(args?.text ?? '').trim();
        if (!text) return { content: '要说的话是空的', isError: true };
        const gate = checkRate(ctx.chatKey, s);
        if (!gate.ok) return { content: `没发：${gate.reason}`, isError: true };
        const opts = { voice: args?.voice || null, lang: parseLang(args?.lang) || String(s.lang || 'zh') };
        const r = await speakAndSend(ctx.chatKey, text, s, ctx.store || null, opts);
        try { ctx.session?.sent?.push?.({ type: 'voice', text: r.sent.map((x) => x.text).join(' ') }); } catch { /* ignore */ }
        return { content: `已发出语音（${r.sent.length} 条）` };
      } catch (e) {
        return { content: `语音发送失败：${e?.message ?? e}`, isError: true };
      }
    }
  });
}

export function activate() {
  const s = settings();
  const lang = String(s.lang || 'zh');
  const v = resolveVoice(s, null, lang);
  const byLang = voicesOf(s).reduce((acc, x) => {
    const k = parseLang(x?.lang) || 'zh';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  api?.log?.(`鲸语已就位：指令 ${s.command}｜服务 ${s.ttsBaseUrl}｜当前语言 ${lang}`
    + `｜音色 中${byLang.zh || 0}套 / 日${byLang.ja || 0}套`
    + (v.ok ? `｜${lang} 默认音色「${v.voice.name}」已就绪` : `｜⚠️ ${v.error}`));
  // 预热：后台探一下服务，没起就顺手拉起，第一次指令就不用等
  if (s.autoStart !== false) { ensureServer(s).catch(() => {}); }
  // 顺手清掉 7 天前的语音缓存
  try {
    const dir = path.join(DATA_DIR, 'voice-cache');
    if (fs.existsSync(dir)) {
      let n = 0;
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        try {
          if (Date.now() - fs.statSync(p).mtimeMs > 7 * 86400000) { fs.unlinkSync(p); n += 1; }
        } catch { /* ignore */ }
      }
      if (n) api?.log?.(`清掉了 ${n} 个过期语音缓存`);
    }
  } catch { /* ignore */ }
}

export function available() { return settings().enabled !== false; }

// ── 钩子 ────────────────────────────────────────────────────────────────────

export const hooks = {
  /** 认 /语音 指令 → 合成 + 发送（不阻塞本轮会话）。 */
  async 'before-context'(ctx = {}) {
    try {
      const s = settings();
      if (s.enabled === false) return;
      const cmd = parseCommand(ctx.triggerEntries, s, { chatKey: ctx.chatKey });
      if (!cmd) return;
      const key = sessionKey(ctx);
      const lang = cmd.lang || String(s.lang || 'zh');
      if (!cmd.text) {
        pending.set(key, { mode: 'ask', lang });
        return;
      }
      const gate = checkRate(ctx.chatKey, s);
      if (!gate.ok) {
        pending.set(key, { mode: 'blocked', reason: gate.reason });
        return;
      }
      pending.set(key, { mode: 'sent', text: cmd.text, lang });
      // 不 await：合成 3~5 秒，别拖住会话；失败再文字兜底
      speakAndSend(ctx.chatKey, cmd.text, s, ctx.store, { lang }).catch(async (e) => {
        warn(`/语音 失败：${e?.message ?? e}`);
        try { await sendText(ctx.chatKey, `（语音没发出来：${e?.message ?? e}）`); } catch { /* ignore */ }
      });
    } catch (e) {
      warn(`before-context 处理失败：${e?.message ?? e}`);
    }
  },

  /** 给模型一句交代：这轮语音已经发出去了，别再重复说。 */
  async 'before-llm-messages'(ctx = {}) {
    const key = sessionKey(ctx);
    const p = pending.get(key);
    if (!p) return;
    if (p.mode === 'sent') {
      ctx.messages?.push?.({
        role: 'user',
        content: `【系统】你刚用语音说出了：「${p.text}」。这条语音是直接发出的，不走你这一轮的发言。这一轮不要再用文字重复同一句话；只调用 finish 结束即可。`
      });
    } else if (p.mode === 'blocked') {
      ctx.messages?.push?.({
        role: 'user',
        content: `【系统】这次 /语音 没发出去：${p.reason}。如果你要回应，用文字说一句就行。`
      });
    } else if (p.mode === 'ask') {
      ctx.messages?.push?.({
        role: 'user',
        content: '【系统】对方只发了 /语音 没写内容：调用 send_voice 工具，随便说一句你现在想说的话（一句话，口语化）。'
      });
    }
  },

  /** 硬保证：/语音 已发出时，禁止这轮再发文字（避免"语音+文字"双份）。 */
  async 'before-tool'(ctx = {}) {
    const p = pending.get(sessionKey(ctx));
    if (!p) return;
    if (p.mode !== 'sent' && p.mode !== 'blocked') return;
    const name = String(ctx.toolName || '');
    if (name === 'send_message' || name === 'send_to' || name === 'send_sticker') {
      return { block: true, reason: '这一轮已经用语音表达过了，不要再用文字/表情重复。' };
    }
  }
};

/** 给模型的说明：什么时候该用语音说话。 */
export function promptSections() {
  const s = settings();
  if (s.enabled === false) return [];
  return [{
    id: 'voice-usage',
    title: '',
    priority: 60,
    content: [
      '【语音条】你有一个 send_voice 工具，可以把话用"声音"说出来（发成 QQ 语音条）。',
      '- 对方明确要语音时调用它：说"用语音说""说一句给我听""来段语音""用日语讲一句""念给我听"等。',
      '- 对方只发「语音 中文/日语 内容」这类指令时，系统会自动处理，你不需要再发一次。',
      '- 别滥用：普通聊天用文字，只有被要求或这句用声音说更合适时才用。',
      '- 一次别超过 2 条；语音里说的话要口语化，不要表情符号、不要括号动作、不要念标点。',
      '- 中文台词要日文语音时，工具会自动翻译，你不用自己翻。'
    ].join('\n')
  }];
}

/** 自测入口（node 里可直接打）。 */
export const internals = { settings, parseCommand, splitText, resolveVoice, synth, speakAndSend, sendVoiceFile, ensureServer, ensureWeights, switchModel, checkRate, normalizeWav, enhanceForSilk, enhanceForSilk2, pending };
