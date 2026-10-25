// OneBot 发送通道（comfy-draw 专用）
//
// 为什么需要它：before-context 钩子的 ctx 里**没有 sender**（钩子只能加工上下文），
// 所以插件想主动发消息只能自己走协议端。这里复用她的 snowluma 配置发现 HTTP 端点 +
// access token，再 POST send_private_msg / send_group_msg。
//
// 图片优先传本地路径（file://）让协议端自己读盘，body 只有约 100 字节；
// 失败再回退 base64 —— 与核心 sender.sendImage 的策略一致。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let cache = null;

function onebotTries(getConfig) {
  const tries = [];
  try {
    const c = getConfig?.() || {};
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

async function pickOnebot(getConfig) {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const tries = onebotTries(getConfig);
  if (!tries.length) throw new Error('找不到 OneBot 令牌（snowluma 配置里没有）');
  let lastErr = null;
  for (const t of tries) {
    try {
      const r = await fetch(`${t.base}/get_status`, {
        headers: { authorization: `Bearer ${t.token}` },
        signal: AbortSignal.timeout(6000)
      });
      if (r.ok) {
        cache = { value: t, at: Date.now() };
        return t;
      }
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`OneBot 令牌都不可用：${lastErr?.message ?? '未知'}`);
}

async function sendSegments(getConfig, chatKey, segments) {
  const m = /^(private|group):(\d+)$/.exec(String(chatKey || ''));
  if (!m) throw new Error(`会话键不合法：${chatKey}`);
  const { base, token } = await pickOnebot(getConfig);
  const action = m[1] === 'private' ? 'send_private_msg' : 'send_group_msg';
  const payload = m[1] === 'private'
    ? { user_id: Number(m[2]), message: segments }
    : { group_id: Number(m[2]), message: segments };
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

export function sendText(getConfig, chatKey, text) {
  return sendSegments(getConfig, chatKey, [{ type: 'text', data: { text: String(text ?? '') } }]);
}

export async function sendImage(getConfig, chatKey, file) {
  const abs = path.resolve(String(file || ''));
  if (!fs.existsSync(abs)) throw new Error(`图片不存在：${abs}`);
  try {
    return await sendSegments(getConfig, chatKey, [
      { type: 'image', data: { file: pathToFileURL(abs).href } }
    ]);
  } catch (e) {
    // 回退 base64（协议端不同机 / 路径不可读）
    const b64 = fs.readFileSync(abs).toString('base64');
    return sendSegments(getConfig, chatKey, [
      { type: 'image', data: { file: `base64://${b64}` } }
    ]);
  }
}

export function resetOnebotCache() { cache = null; }
