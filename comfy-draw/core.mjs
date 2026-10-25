// comfy-core —— QQ Agent 插件（comfy-draw）与 DSH 技能（comfy-draw）共用
//
// 提供：预设表 / 工作流构建（含 LoRA 链与 4x 上采样）/ 标签清洗 /
//      ComfyUI HTTP 调用与取图 / VRAM 互斥 / 极速模式（Lightning 4 步）
//
// 配置形状：
// {
//   comfyUrl, timeoutSeconds,
//   models: { sd15, sdxl, vaeSdxl, upscaler },
//   loras:  { detail:{file,weight}, sticker:{...}, amiya:{...}, lightning:{...} },
//   presets, qualityPrefix, negative,
//   autoStopVoice, tts: { port, gptSovitsDir, pythonExe, config }, outDir
// }

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { execSync, spawn } from 'node:child_process';

export const DEFAULT_PRESETS = {
  '头像': {
    model: 'sdxl', width: 1024, height: 1024, steps: 26, cfg: 5.5, sampler: 'euler_ancestral',
    extraTags: 'portrait, upper body, looking at viewer, simple background, soft lighting',
    loras: [{ name: 'detail', weight: 0.35 }]
  },
  '立绘': {
    model: 'sdxl', width: 832, height: 1216, steps: 28, cfg: 5.5, sampler: 'euler_ancestral',
    extraTags: 'full body, standing, detailed background, cinematic lighting',
    loras: [{ name: 'detail', weight: 0.35 }]
  },
  '表情包': {
    model: 'sd15', width: 512, height: 512, steps: 22, cfg: 7, sampler: 'euler_ancestral',
    extraTags: 'chibi, sticker, simple background, white background',
    loras: [{ name: 'sticker', weight: 0.7 }]
  },
  '鲸鱼娘': {
    model: 'sd15', width: 896, height: 1152, steps: 30, cfg: 6.5, sampler: 'euler_ancestral',
    extraTags: 'standing, legs together, two legs, detailed background, cinematic lighting',
    // 默认女仆装；提示词里提到别的服装时自动让位（见 hasOutfitCue）
    outfit: 'maid, maid headdress, white apron, frilled apron, navy blue dress, thighhighs',
    // 只禁"多余的那条尾巴"，不压 whale 本身（压了会把她的尾巴也弄没）
    negative: 'extra tail, multiple tails, two tails, duplicate tail, floating whale, fish, whale plush, ' +
      'torn skirt, broken clothing, mismatched skirt layers, disconnected fabric, incomplete outfit, floating fabric, ' +
      'extra legs, three legs, fused legs, missing legs, extra limbs, extra feet, malformed legs, bad proportions, ' +
      'two heads, duplicate head, extra head, extra face, multiple faces, two girls, duplicate body, cloned face',
    // 二段放大：896x1152 → 1.35x → 约 1208x1552（实测裙摆最干净的一组）
    hires: { scale: 1.35, denoise: 0.5, stepsRatio: 0.6 },
    freeu: { b1: 1.3, b2: 1.4, s1: 0.9, s2: 0.2 },
    sag: false,   // 关掉：SAG 在 8GB 显存上会 OOM（2026-10-25 实测），要开就传 sag:{scale,blurSigma}
    // 默认用站姿骨骼约束腿数；想换姿势就传 pose: 'xxx.png'，想关就 controlnet: false
    controlnet: { file: 'control_v11p_sd15_openpose.pth', pose: 'pose-stand.png', strength: 0.95 },
    loras: [{ name: 'whalegirl', weight: 0.85 }]
  },
  '场景': {
    model: 'sdxl', width: 1216, height: 832, steps: 28, cfg: 5.5, sampler: 'euler_ancestral',
    extraTags: 'scenery, wide shot, detailed background',
    loras: [{ name: 'detail', weight: 0.35 }]
  }
};

export const DEFAULT_LORAS = {
  detail: { file: 'XDetail_light.safetensors', weight: 0.35 },
  sticker: { file: 'StickersRedmond.safetensors', weight: 0.7 },
  amiya: { file: 'amiya_pro.safetensors', weight: 0.85, trigger: 'amiya(arknights)' },
  lightning: { file: 'sdxl_lightning_4step_lora.safetensors', weight: 1.0 },
  whalegirl: { file: 'whale-girl-sd15-v2.safetensors', weight: 0.85, trigger: 'whale girl' }
};

/**
 * 角色关键词 → LoRA 映射表。
 * 提示词里出现关键词时自动挂对应 LoRA，并把它的触发词补进提示词。
 * 只列**已下载**的 LoRA；再加角色就往这里加一行，或在设置里用 characterLoras 覆盖。
 */
export const DEFAULT_CHARACTER_LORAS = {
  '阿米娅': { lora: 'amiya', weight: 0.85 },
  'amiya': { lora: 'amiya', weight: 0.85 },
  '兔子女孩': { lora: 'amiya', weight: 0.85 },
  // tags = 固定身份词，每次出图自动补进提示词，保证"是她"
  '鲸鱼娘': { lora: 'whalegirl', weight: 0.85, tags: 'whale girl, blue hair, long hair, ahoge, blue eyes, fin ears, whale tail' },
  '鲸娘': { lora: 'whalegirl', weight: 0.85, tags: 'whale girl, blue hair, long hair, ahoge, blue eyes, fin ears, whale tail' },
  '小鲸': { lora: 'whalegirl', weight: 0.85, tags: 'whale girl, blue hair, long hair, ahoge, blue eyes, fin ears, whale tail' },
  'whale girl': { lora: 'whalegirl', weight: 0.85, tags: 'whale girl, blue hair, long hair, ahoge, blue eyes, fin ears, whale tail' },
  'whale-girl': { lora: 'whalegirl', weight: 0.85, tags: 'whale girl, blue hair, long hair, ahoge, blue eyes, fin ears, whale tail' }
};

/** 从文本里找出命中的角色 LoRA（去重，保留较大概率）。 */
export function matchCharacterLoras(text, charTable = DEFAULT_CHARACTER_LORAS) {
  const low = String(text || '').toLowerCase();
  const hits = new Map();
  for (const [kw, ref] of Object.entries(charTable || {})) {
    if (!kw) continue;
    if (!low.includes(String(kw).toLowerCase())) continue;
    const key = ref.lora || ref.file || kw;
    const prev = hits.get(key);
    const weight = Number.isFinite(ref.weight) ? Number(ref.weight) : 0.85;
    if (!prev || weight > prev.weight) {
      hits.set(key, { name: ref.lora || key, weight, trigger: ref.trigger || '', tags: ref.tags || '' });
    }
  }
  return [...hits.values()];
}

/** FreeU_V2 默认参数（SD1.5 通用推荐值）。不想要可在预设里设 freeu: false。 */
export const DEFAULT_FREEU = { b1: 1.3, b2: 1.4, s1: 0.9, s2: 0.2 };

export const DEFAULT_NEGATIVE =
  'lowres, bad anatomy, bad hands, extra fingers, text, watermark, signature, ' +
  'worst quality, low quality, jpeg artifacts, blurry, multiple views';

const COMPOSITION_TAGS = new Set([
  'portrait', 'upper body', 'lower body', 'full body', 'cowboy shot', 'close-up', 'close up',
  'simple background', 'white background', 'black background', 'transparent background',
  'detailed background', 'blurry background', 'scenery', 'wide shot', 'depth of field',
  'from side', 'front view', 'from behind', 'from above', 'from below', 'dutch angle', 'no humans'
]);

/** 去掉构图/背景类标签——这些由预设统一控制。 */
export function stripCompositionTags(tags) {
  return String(tags || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !COMPOSITION_TAGS.has(x.toLowerCase()))
    .join(', ');
}

/** 常见服装关键词：用户提示词命中任何一个，就不再追加预设的默认服装。 */
const OUTFIT_CUES = [
  'maid', '女仆', 'swimsuit', 'bikini', '泳装', '泳衣', 'school uniform', '校服', 'jk', 'sailor', '水手服',
  'kimono', '和服', '浴衣', 'yukata', 'hanfu', '汉服', 'qipao', '旗袍', 'cheongsam',
  'wedding', '婚纱', 'evening gown', '礼服', 'dress', '连衣裙', 'skirt', '裙',
  'suit', '西装', 'military', '军装', 'armor', '盔甲', 'witch', '魔女', 'santa', '圣诞',
  'pajama', '睡衣', 'hoodie', '卫衣', 'coat', '大衣', '风衣', 'jacket', '外套',
  'sportswear', '运动服', 'nurse', '护士', 'office lady', 'ol装', 'gothic', 'lolita', '洛丽塔',
  'sweater', '毛衣', 'shirt', '衬衫', 't-shirt', 't恤'
];

/** 提示词里有没有自己指定服装。 */
export function hasOutfitCue(text) {
  const low = String(text || '').toLowerCase();
  return OUTFIT_CUES.some((w) => low.includes(w));
}

/** 姿势关键词 → 骨骼文件。命中即自动换骨骼（越具体的越靠前）。 */
export const POSE_CUES = [
  { pose: 'pose-sit.png',       words: ['坐着', '坐下', '坐在', '坐姿', 'sitting', 'seated', 'sit '] },
  { pose: 'pose-hold.png',      words: ['撑伞', '举伞', '拿伞', '举着', '举起', 'holding umbrella', 'holding a', 'hold '] },
  { pose: 'pose-wave.png',      words: ['挥手', '招手', '打招呼', '挥手致意', 'waving', 'wave ', 'greeting'] },
  { pose: 'pose-walk.png',      words: ['走路', '行走', '走过去', '溜达', 'walking', 'striding', 'walk '] },
  { pose: 'pose-backhands.png', words: ['背手', '手背在身后', 'hands behind back', 'backhands'] },
  { pose: 'pose-turn.png',      words: ['回眸', '回头', '侧身', 'looking back', 'turn around'] },
  { pose: 'pose-stand.png',     words: ['站着', '站立', '站姿', 'standing', 'stand '] }
];

/** 从提示词里选骨骼文件；没有关键词返回空串。 */
export function matchPose(text) {
  const low = String(text || '').toLowerCase();
  for (const c of POSE_CUES) {
    for (const w of c.words) {
      if (low.includes(w.toLowerCase())) return c.pose;
    }
  }
  return '';
}

const PRESET_HINTS = [
  { name: '鲸鱼娘', words: ['鲸鱼娘', '鲸娘', '小鲸', 'whale girl', 'whalegirl'] },
  { name: '表情包', words: ['表情', '贴纸', '梗图', 'q版', 'chibi', 'sticker'] },
  { name: '头像', words: ['头像', '头图', '自拍', '特写', 'portrait', 'avatar'] },
  { name: '场景', words: ['场景', '背景', '风景', '横图', '壁纸', 'scenery', 'landscape'] },
  { name: '立绘', words: ['立绘', '全身', '站姿', 'full body'] }
];

export function pickPreset(text, wanted, presets) {
  const list = { ...DEFAULT_PRESETS, ...(presets || {}) };
  if (wanted && list[wanted]) return { name: wanted, preset: list[wanted], why: 'explicit' };
  const t = String(text || '').toLowerCase();
  for (const h of PRESET_HINTS) {
    if (!list[h.name]) continue;
    if (h.words.some((w) => t.includes(w.toLowerCase()))) {
      return { name: h.name, preset: list[h.name], why: 'keyword' };
    }
  }
  return { name: '立绘', preset: list['立绘'], why: 'default' };
}

/** 把 {name,weight} 形式的 LoRA 引用解析成真实文件。 */
export function resolveLoras(list, loraTable = DEFAULT_LORAS) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const ref = typeof item === 'string' ? { name: item } : (item || {});
    const key = ref.name || ref.file;
    if (!key) continue;
    const def = loraTable[key] || {};
    const file = ref.file || def.file || key;
    const weight = Number.isFinite(ref.weight) ? Number(ref.weight) : (def.weight ?? 0.8);
    out.push({ file, weight, trigger: ref.trigger || def.trigger || '' });
  }
  return out;
}

/**
 * 文生图工作流。
 * - LoRA 链挂在 checkpoint 之后，模型和 CLIP 一起接下去
 * - upscale > 1：同图内接 4x 模型，再缩到 width*upscale × height*upscale
 * - speed='lightning'：4 步 / cfg 1.6 / dpmpp_sde + sgm_uniform
 */
export function buildTxt2Img({
  ckpt, prompt, negative, width, height, steps, cfg, sampler, seed, vae,
  loras = [], upscale = 1, upscaler = '4x-AnimeSharp.pth', prefix = 'comfy-draw',
  speed = '', hires = null, freeu = null, sag = null, controlnet = null
}) {
  const wf = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } }
  };

  // LoRA 链
  let modelOut = ['1', 0];
  let clipOut = ['1', 1];
  let nodeId = 100;
  for (const l of loras) {
    const id = String(nodeId);
    wf[id] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: l.file,
        strength_model: l.weight,
        strength_clip: l.weight,
        model: modelOut,
        clip: clipOut
      }
    };
    modelOut = [id, 0];
    clipOut = [id, 1];
    nodeId += 1;
  }

  // FreeU_V2：提升纹理/边缘（SD1.5 上很有效，几乎不占显存）
  if (freeu && freeu.enabled !== false) {
    wf[30] = {
      class_type: 'FreeU_V2',
      inputs: {
        model: modelOut,
        b1: Number(freeu.b1 ?? 1.3),
        b2: Number(freeu.b2 ?? 1.4),
        s1: Number(freeu.s1 ?? 0.9),
        s2: Number(freeu.s2 ?? 0.2)
      }
    };
    modelOut = ['30', 0];
  }

  // SelfAttentionGuidance：用注意力自引导修结构（对多腿/多手这类解剖错误有效）
  if (sag && sag.enabled !== false) {
    wf[31] = {
      class_type: 'SelfAttentionGuidance',
      inputs: {
        model: modelOut,
        scale: Number(sag.scale ?? 0.5),
        blur_sigma: Number(sag.blurSigma ?? 2.0)
      }
    };
    modelOut = ['31', 0];
  }

  // ControlNet：用骨骼图约束姿势/腿数（最强解剖控制）
  let posOut = ['2', 0];
  let negOut = ['3', 0];
  if (controlnet && controlnet.pose) {
    wf[40] = { class_type: 'LoadImage', inputs: { image: String(controlnet.pose) } };
    wf[41] = { class_type: 'ControlNetLoader', inputs: { control_net_name: String(controlnet.file || 'control_v11p_sd15_openpose.pth') } };
    wf[42] = {
      class_type: 'ControlNetApplyAdvanced',
      inputs: {
        positive: ['2', 0],
        negative: ['3', 0],
        control_net: ['41', 0],
        image: ['40', 0],
        strength: Number(controlnet.strength ?? 0.8),
        start_percent: Number(controlnet.start ?? 0),
        end_percent: Number(controlnet.end ?? 1),
        vae: ['1', 2]
      }
    };
    posOut = ['42', 0];
    negOut = ['42', 1];
  }

  const isFast = String(speed) === 'lightning';
  wf[2] = { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: clipOut } };
  wf[3] = { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: clipOut } };
  wf[4] = { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } };
  wf[5] = {
    class_type: 'KSampler',
    inputs: {
      seed,
      steps: isFast ? 4 : steps,
      cfg: isFast ? 1.6 : cfg,
      sampler_name: isFast ? 'dpmpp_sde' : sampler,
      scheduler: isFast ? 'sgm_uniform' : 'normal',
      denoise: 1.0,
      model: modelOut,
      positive: posOut,
      negative: negOut,
      latent_image: ['4', 0]
    }
  };
  wf[6] = { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } };
  if (vae) {
    wf[8] = { class_type: 'VAELoader', inputs: { vae_name: vae } };
    wf[6].inputs.vae = ['8', 0];
  }

  let imageOut = ['6', 0];
  if (hires && Number(hires.scale) > 1) {
    const hs = Number(hires.scale);
    wf[20] = {
      class_type: 'LatentUpscale',
      inputs: {
        samples: ['5', 0], upscale_method: 'nearest-exact',
        width: Math.round(width * hs), height: Math.round(height * hs), crop: 'disabled'
      }
    };
    wf[21] = {
      class_type: 'KSampler',
      inputs: {
        seed: (Number(seed) + 1) % 2 ** 31,
        steps: Math.max(8, Math.round(steps * (Number(hires.stepsRatio) || 0.6))),
        cfg: isFast ? 1.6 : cfg,
        sampler_name: isFast ? 'dpmpp_sde' : sampler,
        scheduler: isFast ? 'sgm_uniform' : 'normal',
        denoise: Number(hires.denoise) || 0.45,
        model: modelOut,
        positive: posOut,
        negative: negOut,
        latent_image: ['20', 0]
      }
    };
    wf[6].inputs.samples = ['21', 0];
  }
  if (Number(upscale) > 1) {
    wf[9] = { class_type: 'UpscaleModelLoader', inputs: { model_name: upscaler } };
    wf[10] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['9', 0], image: ['6', 0] } };
    wf[11] = {
      class_type: 'ImageScale',
      inputs: {
        image: ['10', 0], upscale_method: 'lanczos',
        width: Math.round(width * Number(upscale)),
        height: Math.round(height * Number(upscale)),
        crop: 'disabled'
      }
    };
    imageOut = ['11', 0];
  }
  wf[7] = { class_type: 'SaveImage', inputs: { filename_prefix: prefix, images: imageOut } };
  return wf;
}

// ── HTTP ────────────────────────────────────────────────────────────────────

async function req(base, p, opts = {}, timeoutMs = 30000) {
  const res = await fetch(`${base}${p}`, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ComfyUI ${p} HTTP ${res.status} ${detail.slice(0, 180)}`);
  }
  return res;
}

function require_tmpdir() {
  try { return os.tmpdir(); } catch { return process.cwd(); }
}

export async function status(comfyUrl) {
  const base = String(comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
  try {
    const r = await req(base, '/system_stats', {}, 8000);
    const j = await r.json();
    const d = (j.devices || [])[0] || {};
    return {
      ok: true,
      version: j.system?.comfyui_version,
      device: d.name,
      vramTotalMb: Math.round((d.vram_total || 0) / 1048576),
      vramFreeMb: Math.round((d.vram_free || 0) / 1048576)
    };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}


/** 关掉监听该端口的 ComfyUI（只杀命令行里带 main.py 的 python，别误伤别的程序）。 */
export function stopComfy(port = 8188) {
  const killed = [];
  try {
    const out = execSync('netstat -ano -p TCP', { encoding: 'utf8', windowsHide: true });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${Number(port)} `) || !/LISTENING/i.test(line)) continue;
      const m = line.trim().match(/(\d+)\s*$/);
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) {
      try {
        const info = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8', windowsHide: true });
        if (!/python\.exe/i.test(info)) continue;
        execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true });
        killed.push(pid);
      } catch { /* 单个失败不影响 */ }
    }
  } catch { /* netstat 不可用 */ }
  return killed;
}

/**
 * ComfyUI 没起来就顺手拉起来。
 * comfyStart = { dir, python, yaml, inputDir, outputDir, port, reserveVram }
 * 返回 { ok, started, why }
 */
export async function ensureComfy(cfg, { waitMs = 120000, pollMs = 3000 } = {}) {
  const url = cfg?.comfyUrl || 'http://127.0.0.1:8188';
  const now = await status(url);
  if (now.ok) return { ok: true, started: false, status: now };

  const s = cfg?.comfyStart || {};
  if (!s.dir || !s.python) {
    return { ok: false, started: false, why: 'ComfyUI 没在运行，且没有配置自动启动（comfyDir / comfyPython）' };
  }

  const port = Number(s.port) || 8188;
  const args = [
    '-s', 'main.py',
    '--port', String(port),
    '--listen', '127.0.0.1',
    '--reserve-vram', String(s.reserveVram ?? 0.5)
  ];
  if (s.yaml) args.push('--extra-model-paths-config', String(s.yaml));
  if (s.inputDir) args.push('--input-directory', String(s.inputDir));
  if (s.outputDir) args.push('--output-directory', String(s.outputDir));

  // 启动方式：写一个 .bat 再让 cmd 跑它。
  // 直接 spawn('cmd.exe', ['/c', 长命令]) 在路径含空格/括号时经常静默失败（实测过），
  // 落盘成批处理后再执行最稳。
  const logFile = s.logFile || '';
  const batPath = s.batPath || path.join(require_tmpdir(), 'comfy-draw-launch.bat');
  const argLine = args.map((a) => (String(a).includes(' ') ? `"${a}"` : a)).join(' ');
  const lines = [
    '@echo off',
    `cd /d "${s.dir}"`,
    `"${s.python}" ${argLine}${logFile ? ` >> "${logFile}" 2>&1` : ''}`
  ];
  try {
    fs.writeFileSync(batPath, lines.join('\r\n'), 'utf8');
  } catch (e) {
    return { ok: false, started: false, why: `写启动脚本失败：${e?.message ?? e}` };
  }

  const attempts = [
    // 1) 直接跑批处理
    ['cmd.exe', ['/c', batPath]],
    // 2) 用 start 再兜一层（有些环境不允许直接继承控制台）
    ['cmd.exe', ['/c', 'start', '', '/b', batPath]]
  ];
  let spawnErr = '';
  let launched = false;
  for (const [file, argv] of attempts) {
    try {
      const child = spawn(file, argv, { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      launched = true;
      break;
    } catch (e) {
      spawnErr = String(e?.message ?? e);
    }
  }
  if (!launched) {
    return { ok: false, started: false, why: `启动 ComfyUI 失败：${spawnErr || '未知'}` };
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const st = await status(url);
    if (st.ok) return { ok: true, started: true, status: st };
  }
  return { ok: false, started: true, why: `ComfyUI 已尝试启动，但 ${Math.round(waitMs / 1000)} 秒内没就绪` };
}

/** 从 /object_info 读 COMBO 选项（兼容两种 schema）。 */
function comboOf(node, key, o) {
  const v = o?.[node]?.input?.required?.[key];
  if (!Array.isArray(v)) return [];
  if (Array.isArray(v[1]?.options)) return v[1].options;   // 新 schema: ["COMBO", {options:[...]}]
  if (Array.isArray(v[0])) return v[0];                     // 旧 schema: [["a","b"], {...}]
  return [];
}

export async function models(comfyUrl) {
  const base = String(comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
  const r = await req(base, '/object_info', {}, 60000);
  const o = await r.json();
  return {
    checkpoints: comboOf('CheckpointLoaderSimple', 'ckpt_name', o),
    vaes: comboOf('VAELoader', 'vae_name', o),
    upscalers: comboOf('UpscaleModelLoader', 'model_name', o),
    loras: comboOf('LoraLoader', 'lora_name', o)
  };
}

export async function runWorkflow(comfyUrl, wf, { timeoutSeconds = 300, clientId = 'comfy-core' } = {}) {
  const base = String(comfyUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
  const r = await req(base, '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: wf, client_id: clientId })
  });
  const sub = await r.json();
  const pid = sub?.prompt_id;
  if (!pid) throw new Error(`提交失败：${JSON.stringify(sub).slice(0, 200)}`);

  const deadline = Date.now() + Math.max(20, timeoutSeconds) * 1000;
  let hist = null;
  while (Date.now() < deadline) {
    await new Promise((x) => setTimeout(x, 2500));
    const hr = await req(base, `/history/${pid}`, {}, 20000);
    const h = await hr.json();
    if (h && h[pid]) { hist = h[pid]; break; }
  }
  if (!hist) throw new Error(`出图超时（>${timeoutSeconds}s）`);

  const st = hist?.status?.status_str;
  if (st && st !== 'success') throw new Error(`出图失败：${st}`);

  const imgs = [];
  for (const node of Object.values(hist.outputs || {})) {
    for (const im of node.images || []) imgs.push(im);
  }
  if (!imgs.length) throw new Error('没有产出图片');

  const img = imgs[0];
  const q = new URLSearchParams({
    filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output'
  });
  const vr = await req(base, `/view?${q}`, {}, 180000);
  const buf = Buffer.from(await vr.arrayBuffer());
  return { buffer: buf, filename: img.filename, subfolder: img.subfolder || '' };
}

// ── VRAM 互斥 ───────────────────────────────────────────────────────────────

export function ttsAlive(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: Number(port) || 9880 }, () => {
      sock.destroy(); resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(1200, () => { sock.destroy(); resolve(false); });
  });
}

export function killTts(port) {
  const killed = [];
  try {
    const out = execSync('netstat -ano -p TCP', { encoding: 'utf8', windowsHide: true });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${Number(port) || 9880} `) || !/LISTENING/i.test(line)) continue;
      const m = line.trim().match(/(\d+)\s*$/);
      if (m) pids.add(m[1]);
    }
    for (const pid of pids) {
      try {
        const info = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8', windowsHide: true });
        if (!/python\.exe/i.test(info)) continue;
        execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true });
        killed.push(pid);
      } catch { /* 单个失败不影响 */ }
    }
  } catch { /* netstat 不可用 */ }
  return killed;
}

export function restartTts(tts = {}) {
  try {
    const dir = path.join(String(tts.gptSovitsDir || ''), 'src');
    const py = String(tts.pythonExe || 'python');
    const args = ['api_v2.py', '-a', '127.0.0.1', '-p', String(tts.port || 9880)];
    if (tts.config) args.push('-c', String(tts.config));
    if (!fs.existsSync(path.join(dir, 'api_v2.py'))) return { ok: false, why: '找不到 api_v2.py' };
    const child = spawn(py, args, {
      cwd: dir, env: { ...process.env, CUDAGraph: '0' },
      detached: true, stdio: 'ignore', windowsHide: true
    });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, why: String(e?.message ?? e) };
  }
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * @param {object} cfg 见文件头
 * @param {object} opt { prompt, tags, preset, seed, upscale, loras, speed, negative, prefix, outDir }
 */
export async function draw(cfg, opt = {}) {
  const s = cfg || {};
  const modelsCfg = s.models || {};
  const presets = { ...DEFAULT_PRESETS, ...(s.presets || {}) };
  const loraTable = { ...DEFAULT_LORAS, ...(s.loras || {}) };
  const picked = pickPreset(opt.prompt || '', opt.preset, presets);
  const preset = picked.preset;

  // LoRA 来源三处：显式传入 > 预设自带 > 角色关键词匹配（默认合并）
  const charTable = { ...DEFAULT_CHARACTER_LORAS, ...(s.characterLoras || {}) };
  const charHits = opt.noCharacterLoras ? [] : matchCharacterLoras(`${opt.prompt || ''} ${opt.tags || ''}`, charTable);
  const mergedRefs = [
    ...(Array.isArray(opt.loras) ? opt.loras : (preset.loras || [])),
    ...charHits
  ];
  // 同一文件去重（保留先出现的权重）
  const seen = new Set();
  const loraRefs = mergedRefs.filter((r) => {
    const key = typeof r === 'string' ? r : (r?.name || r?.file);
    const file = loraTable[key]?.file || r?.file || key;
    if (!key || seen.has(file)) return false;
    seen.add(file);
    return true;
  });
  const loras = resolveLoras(loraRefs, loraTable);
  const speed = String(opt.speed || preset.speed || '');
  if (speed === 'lightning' && !loras.some((l) => l.file === loraTable.lightning?.file)) {
    loras.push({ file: loraTable.lightning.file, weight: loraTable.lightning.weight ?? 1 });
  }

  // 触发词 + 角色固定身份词
  const triggers = loras.map((l) => l.trigger).filter(Boolean);
  const identityTags = charHits.map((c) => c.tags).filter(Boolean);
  const tagsRaw = String(opt.tags || opt.prompt || '').trim();
  const tags = [tagsRaw, ...identityTags, ...triggers].filter(Boolean).join(', ');
  const quality = String(s.qualityPrefix ?? 'masterpiece, best quality, very aesthetic, absurdres').trim();
  // 服装：用户没说服装 → 用预设默认；说了 → 让位
  const defaultOutfit = (!opt.noDefaultOutfit && preset.outfit && !hasOutfitCue(tagsRaw))
    ? String(preset.outfit).trim()
    : '';
  const extra = [String(preset.extraTags || '').trim(), defaultOutfit].filter(Boolean).join(', ');
  const prompt = [quality, tags, extra].filter(Boolean).join(', ');
  const negative = String(opt.negative || preset.negative || s.negative || DEFAULT_NEGATIVE);

  const isSdxl = String(preset.model || 'sdxl') === 'sdxl';
  const ckpt = isSdxl ? (modelsCfg.sdxl || 'animagine-xl-4.0.safetensors') : (modelsCfg.sd15 || 'kohaku-v2.1.safetensors');
  const vae = isSdxl ? (modelsCfg.vaeSdxl || 'sdxl-vae-fp16-fix.safetensors') : null;
  const seed = Number.isFinite(opt.seed) ? Number(opt.seed) : Math.floor(Math.random() * 2 ** 31);
  const upscale = Math.max(1, Number(opt.upscale) || 1);

  const wf = buildTxt2Img({
    ckpt, prompt, negative,
    width: Number(preset.width) || 832,
    height: Number(preset.height) || 1216,
    steps: Number(preset.steps) || 28,
    cfg: Number(preset.cfg) || 5.5,
    sampler: String(preset.sampler || 'euler_ancestral'),
    seed, vae, loras, upscale, speed,
    hires: opt.hires === false ? null : (opt.hires || preset.hires || null),
    freeu: opt.freeu === false ? null : (opt.freeu || preset.freeu || DEFAULT_FREEU),
    sag: opt.sag === false ? null : (opt.sag || preset.sag || null),
    controlnet: opt.controlnet === false
      ? null
      : (() => {
        const base = preset.controlnet || null;
        const explicit = String(opt.pose || '').trim();
        if (explicit) return { ...(base || {}), pose: explicit };
        if (!base) return null;
        // 没显式指定 → 从提示词里猜姿势，猜不到用预设默认
        const guess = matchPose(`${opt.prompt || ''} ${opt.tags || ''}`);
        return { ...base, pose: guess || base.pose };
      })(),
    upscaler: modelsCfg.upscaler || '4x-AnimeSharp.pth',
    prefix: opt.prefix || 'comfy-draw'
  });

  let voiceWasUp = false;
  if (s.autoStopVoice !== false && s.tts && s.tts.port) {
    voiceWasUp = await ttsAlive(s.tts.port);
    if (voiceWasUp) {
      killTts(s.tts.port);
      await new Promise((x) => setTimeout(x, 3000));
    }
  }

  const t0 = Date.now();
  let out;
  try {
    out = await runWorkflow(s.comfyUrl, wf, { timeoutSeconds: Number(s.timeoutSeconds) || 300 });
  } finally {
    // 画完是否自动拉起 TTS：8GB 卡上 TTS 启动即崩（fbgemm/c10），默认**不重启**，
    // 下次用 /语音 时 voice 插件会自己拉起来。
    if (voiceWasUp && s.restartVoiceAfterDraw === true) {
      const delay = Math.max(5000, Number(s.restartVoiceDelayMs) || 30000);
      setTimeout(() => { try { restartTts(s.tts); } catch { /* 忽略 */ } }, delay);
    }
  }
  const ms = Date.now() - t0;

  const dir = String(opt.outDir || s.outDir || process.cwd());
  fs.mkdirSync(dir, { recursive: true });
  // 文件名里的中文在部分环境下会被沙箱/杀软拦（EPERM），统一转成 ASCII
  const safeName = String(picked.name).replace(/[^\w.-]/g, '') || 'draw';
  const file = path.join(dir, `${Date.now()}-${safeName}-${String(out.filename).replace(/[^\w.-]/g, '_')}`);
  fs.writeFileSync(file, out.buffer);

  return {
    file, bytes: out.buffer.length, ms,
    preset: picked.name, presetWhy: picked.why,
    width: Math.round((Number(preset.width) || 832) * upscale),
    height: Math.round((Number(preset.height) || 1216) * upscale),
    upscale, seed, model: ckpt,
    loras: loras.map((l) => `${l.file}@${l.weight}`),
    characters: charHits.map((c) => c.name),
    speed: speed || 'normal',
    outfit: defaultOutfit || (hasOutfitCue(tagsRaw) ? 'user' : 'none'),
    pose: (opt.controlnet === false) ? 'off' : (opt.pose || matchPose(`${opt.prompt || ''} ${opt.tags || ''}`) || (preset.controlnet ? preset.controlnet.pose : 'off')),
    steps: speed === 'lightning' ? 4 : (Number(preset.steps) || 28),
    tags, prompt
  };
}

export const internals = {
  stripCompositionTags, pickPreset, resolveLoras, buildTxt2Img, hasOutfitCue, OUTFIT_CUES, matchPose, POSE_CUES,
  status, models, runWorkflow, draw, ensureComfy, stopComfy, ttsAlive, killTts, restartTts,
  DEFAULT_PRESETS, DEFAULT_LORAS, DEFAULT_FREEU, DEFAULT_CHARACTER_LORAS, matchCharacterLoras, DEFAULT_NEGATIVE
};
