// 嘘 —— v2.0.0（确定性型 / plugins/，纯 hooks，不改核心代码）
//
// v1 只做了一件事：主人 @ 她发 /静音 30 → 写核心的 commandMute.active，
// 核心把该群响应档位锁成 1 档（只回 @），到期自动失效；/说话 解除。
//
// v2 加了「静音记账」和「分级档位」：
//
//   档位（指令里可选，不写就是 atOnly）：
//     /静音 30                → atOnly：只回 @（核心里就是这么实现的）
//     /静音 完全 30           → silent：连 @ 也不回，插件在 before-tool 里硬拦发送
//     /静音 睡觉 8小时        → sleep ：同 silent，但解除时若有人叫过她会主动问一句
//     /静音 礼貌 30           → polite：被 @ 时只回一句很短的"我先安静会儿"，有冷却
//
//   记账（②）：
//     静音期间这个群来了多少条消息、被 @ 了多少次，写进 data/hush-state.json；
//     /说话 解除时把数字递给她，让她用自己的口气汇报，而不是冷冰冰的报表。
//
// 为什么还能"纯插件"：核心只提供 1 档这一种强度，剩下的由插件自己在钩子里做——
//   before-tool 拦截发送工具 = 嘴巴被捂住；inject 台词 = 让她说人话。

import fs from 'node:fs';
import path from 'node:path';
import { getConfig, updateConfig, DATA_DIR } from '../../src/config.js';

let api = null;

const DEFAULTS = {
  enabled: true,
  ownerQq: '',
  quietCommand: '/静音',
  resumeCommand: '/说话',
  defaultMinutes: 30,
  maxMinutes: 720,
  defaultMode: 'atOnly',
  politeCooldownMin: 10,
  stateFile: ''
};

const MODE_WORDS = [
  { mode: 'silent', words: ['完全', '彻底', '徹底', '彻底静音', '闭嘴', '闭麦'] },
  { mode: 'sleep', words: ['睡觉', '睡着', '睡眠'] },
  { mode: 'polite', words: ['礼貌', '客气', '婉拒'] },
  { mode: 'atOnly', words: ['仅艾特', '只回艾特', '常规'] }
];

const MODE_LABEL = {
  atOnly: '只回艾特',
  silent: '完全不说话',
  sleep: '睡觉（完全不说话）',
  polite: '只回一句礼貌话'
};

/** 本轮要给她塞的话 / 本轮是否要拦发送（按 session 暂存，用完即删）。 */
const pending = new Map();

function settings() {
  try {
    const c = api?.config?.();
    return { ...DEFAULTS, ...(c && typeof c === 'object' ? c : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 主人 QQ：插件配置优先，留空回落到「主人识别」插件。 */
function ownerIds(s) {
  const list = [String(s.ownerQq || '').trim()];
  try {
    const ids = getConfig()?.skills?.['owner-identity']?.ids;
    if (ids) list.push(...String(ids).split(/[,，\s]+/));
  } catch { /* 配置没就绪 */ }
  return [...new Set(list.map((x) => x.trim()).filter((x) => /^\d+$/.test(x)))];
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function statePath(s) {
  const custom = String(s.stateFile || '').trim();
  return custom || path.join(DATA_DIR, 'hush-state.json');
}

function readState(s) {
  try {
    const p = statePath(s);
    if (!fs.existsSync(p)) return { groups: {} };
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { groups: (j && j.groups) || {} };
  } catch {
    return { groups: {} };
  }
}

function writeState(s, st) {
  try {
    const p = statePath(s);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(st, null, 1), 'utf8');
    fs.renameSync(tmp, p);
  } catch (e) {
    api?.warn?.(`写 hush 状态失败：${e?.message ?? e}`);
  }
}

/** 取该群当前生效的静音状态（过期就顺手清掉）。 */
export function muteStateOf(gid, s = DEFAULTS, now = Date.now()) {
  const st = readState(s);
  const g = st.groups[String(gid)];
  if (!g) return null;
  if (Number(g.until) > 0 && Number(g.until) <= now) {
    delete st.groups[String(gid)];
    writeState(s, st);
    return { expired: true, ...g };
  }
  return g;
}

/**
 * 解析时长。支持：30 / 30分 / 90秒 / 2小时 / 半小时；"0" = 不自动解除
 */
export function parseDuration(rest, defaultMinutes = 30, maxMinutes = 720) {
  const raw = String(rest || '').trim();
  const cap = Math.max(1, Number(maxMinutes) || 720) * 60000;

  const zero = raw.match(/^\s*0\s*$/);
  if (zero) return { ms: 0, text: '直到手动解除' };

  if (/半\s*个?\s*小时/.test(raw)) {
    return { ms: Math.min(30 * 60000, cap), text: '半小时' };
  }

  const m = raw.match(/(\d+(?:\.\d+)?)\s*(秒|s|sec|分钟|分|m|min|小时|时|h|hour)?/i);
  if (!m) {
    const ms = Math.min(Math.max(1, Number(defaultMinutes) || 30) * 60000, cap);
    return { ms, text: `${Math.round(ms / 60000)} 分钟` };
  }

  const n = Number(m[1]);
  const unit = String(m[2] || '').toLowerCase();
  let ms;
  if (['秒', 's', 'sec'].includes(unit)) ms = n * 1000;
  else if (['小时', '时', 'h', 'hour'].includes(unit)) ms = n * 3600000;
  else ms = n * 60000;

  ms = Math.min(Math.max(ms, 1000), cap);
  let text;
  if (ms < 60000) text = `${Math.round(ms / 1000)} 秒`;
  else if (ms >= 3600000) text = `${(ms / 3600000).toFixed(ms % 3600000 ? 1 : 0)} 小时`;
  else text = `${Math.round(ms / 60000)} 分钟`;
  return { ms, text };
}

/** 认档位词（"完全 30" → silent + "30"）。 */
export function parseMode(rest, fallback = 'atOnly') {
  const raw = String(rest || '').trim();
  for (const m of MODE_WORDS) {
    for (const w of m.words) {
      if (raw.startsWith(w)) {
        return { mode: m.mode, rest: raw.slice(w.length).trim() };
      }
    }
  }
  return { mode: fallback, rest: raw };
}

/**
 * 从一条消息里认出指令。
 * @returns {null | {kind:'quiet', ms, text, mode} | {kind:'resume'}}
 */
export function parseCommand(text, cfg = DEFAULTS) {
  const raw = String(text || '');
  if (!raw) return null;
  const s = { ...DEFAULTS, ...(cfg || {}) };
  const quiet = String(s.quietCommand || '/静音');
  const resume = String(s.resumeCommand || '/说话');

  const qi = raw.indexOf(quiet);
  const ri = raw.indexOf(resume);
  if (qi < 0 && ri < 0) return null;
  if (ri >= 0 && (qi < 0 || ri < qi)) return { kind: 'resume' };

  const after = raw.slice(qi + quiet.length);
  const pm = parseMode(after, String(s.defaultMode || 'atOnly'));
  const d = parseDuration(pm.rest, s.defaultMinutes, s.maxMinutes);
  return { kind: 'quiet', ms: d.ms, text: d.text, mode: pm.mode };
}

/** 判定一条消息该不该处理（群 + 主人 + 指令）。 */
export function decide(ctx, cfg = DEFAULTS) {
  const s = { ...DEFAULTS, ...(cfg || {}) };
  if (s.enabled === false) return null;
  const chatKey = String(ctx?.chatKey || '');
  if (!chatKey.startsWith('group:')) return null;
  const gid = chatKey.split(':')[1];
  if (!gid) return null;

  const owners = ownerIds(s);
  const entries = Array.isArray(ctx?.triggerEntries) ? ctx.triggerEntries : [];
  for (const e of entries) {
    const sender = String(e?.senderId ?? '').trim();
    if (!owners.includes(sender)) continue;
    const cmd = parseCommand(e?.text, s);
    if (!cmd) continue;
    const now = Date.now();
    if (cmd.kind === 'resume') return { kind: 'resume', gid, chatKey, sender };
    const until = cmd.ms > 0 ? now + cmd.ms : 0;
    return {
      kind: 'quiet', gid, chatKey, sender, mode: cmd.mode,
      ms: cmd.ms, text: cmd.text, until,
      untilText: until ? fmtTime(until) : '手动解除'
    };
  }
  return null;
}

/** 把核心的 1 档锁写进去（到期时间；0 表示一直锁到手动解除）。 */
function applyCoreMute(gid, until) {
  const cm = getConfig()?.commandMute || {};
  if (cm.enabled !== true) return { ok: false, reason: 'commandMute 开关没开' };
  const active = { ...(cm.active || {}) };
  if (until === null) delete active[String(gid)];
  else active[String(gid)] = Number(until) || 0;
  updateConfig({ commandMute: { active: { __replace__: active } } });
  return { ok: true };
}

/** 往本轮请求末尾追加一段。 */
function appendTail(messages, text) {
  if (!Array.isArray(messages) || !text) return false;
  const block = `\n\n${String(text).trim()}`;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content === 'string') { m.content += block; return true; }
    if (Array.isArray(m.content)) { m.content.push({ type: 'text', text: block }); return true; }
  }
  return false;
}

function keyOf(ctx) { return String(ctx?.sessionId || ctx?.chatKey || ''); }

function gidOf(ctx) {
  const k = String(ctx?.chatKey || '');
  return k.startsWith('group:') ? k.slice(6) : '';
}

// ── 生命周期 ────────────────────────────────────────────────────────────────

export function setup(a) { api = a; }

export function activate() {
  const s = settings();
  try {
    if (getConfig()?.commandMute?.enabled !== true) {
      api?.warn?.('⚠️ config.commandMute.enabled 不是 true，静音指令会拒绝执行');
    }
    const st = readState(s);
    const n = Object.keys(st.groups || {}).length;
    if (n) api?.log?.(`嘘—— 当前有 ${n} 个群处于静音状态（状态文件 ${statePath(s)}）`);
  } catch { /* 配置没就绪 */ }
  api?.log?.(`嘘—— v2 就位：${s.quietCommand} [完全|睡觉|礼貌] <时长> / ${s.resumeCommand}`
    + `（只认主人：${ownerIds(s).join(',') || '未配置'}）`);
}

export function available() { return settings().enabled !== false; }

// ── 钩子 ────────────────────────────────────────────────────────────────────

export const hooks = {
  async 'before-context'(ctx = {}) {
    try {
      const s = settings();
      const gid = gidOf(ctx);
      if (!gid) return;

      // ① 指令优先
      const action = decide(ctx, s);
      if (action) {
        const key = keyOf(ctx);
        if (action.kind === 'quiet') {
          const r = applyCoreMute(action.gid, action.until);
          if (!r.ok) {
            pending.set(key, {
              note: `主人想下静音指令，但管理端 commandMute 开关是关的，没生效。用你自己的口气回一句说明（一条，≤20 字）。`
            });
            api?.warn?.(`静音指令未生效：${r.reason}`);
            return;
          }
          const st = readState(s);
          st.groups[String(action.gid)] = {
            until: action.until,
            mode: action.mode,
            startedAt: Date.now(),
            msgs: 0,
            ats: 0,
            politeAt: 0
          };
          writeState(s, st);
          pending.set(key, {
            note: `主人刚下了静音指令：模式「${MODE_LABEL[action.mode] || action.mode}」，持续 ${action.text}（${action.untilText} 解除）。`
              + `用你自己的口气回一句确认（一条，≤15 字），别用「收到指令」这种客服话。`
          });
          api?.log?.(`群 ${action.gid} 静音 ${action.text}（模式 ${action.mode}，${action.untilText}）`);
          return;
        }
        // 解除：算账 + 汇报
        const st = readState(s);
        const g = st.groups[String(action.gid)] || {};
        delete st.groups[String(action.gid)];
        writeState(s, st);
        applyCoreMute(action.gid, null);

        const mins = g.startedAt ? Math.max(1, Math.round((Date.now() - Number(g.startedAt)) / 60000)) : 0;
        const msgs = Number(g.msgs) || 0;
        const ats = Number(g.ats) || 0;
        const extra = msgs
          ? `静音了约 ${mins} 分钟，期间这个群来了 ${msgs} 条消息，其中 ${ats} 次有人叫你。`
          : '静音期间这个群挺安静的，没什么人说话。';
        const sleepAsk = (g.mode === 'sleep' && ats > 0) ? `（你是"睡觉"模式，可以顺口问一句是不是有人找过你）` : '';
        pending.set(keyOf(ctx), {
          note: `主人刚解除了这个群的静音。${extra}${sleepAsk}`
            + `用你自己的口气回一句（一条，≤25 字），可以提这个数字，但别像报表、别列清单。`
        });
        api?.log?.(`群 ${action.gid} 解除静音：${msgs} 条 / ${ats} 次点名 / ${mins} 分钟`);
        return;
      }

      // ② 没指令：如果正静音，记账 + 决定这轮能不能出声
      const st = muteStateOf(gid, s);
      if (!st || st.expired) return;
      const key = keyOf(ctx);
      const entries = Array.isArray(ctx.triggerEntries) ? ctx.triggerEntries : [];
      const ats = entries.filter((e) => e && e.atMe).length;

      // 记账（写回，注意重新读一次避免覆盖指令分支的写入）
      const st2 = readState(s);
      const g = st2.groups[String(gid)];
      if (g) {
        g.msgs = (Number(g.msgs) || 0) + Math.max(1, entries.length);
        g.ats = (Number(g.ats) || 0) + ats;
        writeState(s, st2);
      }

      const mode = String(st.mode || 'atOnly');
      if (mode === 'silent' || mode === 'sleep') {
        pending.set(key, {
          block: true,
          note: '这个群正处于静音期，你这一轮**不要发任何消息**，也别调用任何发送工具。'
            + '只调用 finish 结束即可（别的工具也别调，省点开销）。'
        });
        return;
      }
      if (mode === 'polite') {
        const cool = Math.max(0, Number(s.politeCooldownMin) || 0) * 60000;
        const last = Number(st.politeAt) || 0;
        if (ats > 0 && Date.now() - last >= cool) {
          const st3 = readState(s);
          if (st3.groups[String(gid)]) {
            st3.groups[String(gid)].politeAt = Date.now();
            writeState(s, st3);
          }
          pending.set(key, {
            note: '这个群正在静音期。有人叫了你，你只回一句很短的礼貌话（≤15 字），'
              + '说明你现在不太方便、晚点再聊，别展开话题、别追问。'
          });
        } else {
          pending.set(key, {
            block: true,
            note: '这个群正在静音期，刚才已经礼貌回应过了，这一轮不要说话，只调用 finish。'
          });
        }
        return;
      }
      // atOnly：核心已经把档位锁成"只回艾特"，这里的运行就是被 @ 触发的，正常说话即可
    } catch (e) {
      api?.warn?.(`hush before-context 失败：${e?.message ?? e}`);
    }
  },

  /** 塞台词（用一次就删）。 */
  async 'before-llm-messages'(ctx = {}) {
    const key = keyOf(ctx);
    const p = pending.get(key);
    if (!p) return;
    pending.delete(key);
    appendTail(ctx.messages, `【管理指令】${p.note}`);
    if (p.block) pending.set(`${key}__block`, { block: true });
  },

  /** 静音期硬拦发送工具（silent / sleep / polite 冷却中）。 */
  async 'before-tool'(ctx = {}) {
    const key = `${keyOf(ctx)}__block`;
    const p = pending.get(key) || pending.get(keyOf(ctx));
    if (!p || !p.block) return;
    const name = String(ctx.toolName || '');
    if (name === 'send_message' || name === 'send_to' || name === 'send_sticker' || name === 'send_poke') {
      return { block: true, reason: '这个群正在静音，不要出声。' };
    }
  }
};

/** 自测用：纯函数暴露出来，node 里可以直接打。 */
export const internals = {
  parseDuration, parseCommand, parseMode, decide, ownerIds, settings, pending,
  muteStateOf, readState, writeState, statePath, MODE_LABEL
};
