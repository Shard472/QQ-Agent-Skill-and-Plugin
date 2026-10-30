/* 她的世界 · QQ Agent 控制台面板
 * 数据源：/her-world/state.json（her-inner 插件每 45s 原子写入，已聚合 生活/内心/欲望/亲密/好感/主动私信 + 日记）
 * 挂载：ui/index.html 末尾 <script src="/her-board/ui.js"></script>
 * 形态：右下角悬浮球 → 全屏浮层，三页：内心世界 / 她的生活 / 她的日记
 */
(() => {
  'use strict';
  if (window.__HER_BOARD__) return;
  window.__HER_BOARD__ = true;

  const SNAPSHOT = '/her-world/state.json';
  const PANES = [
    { id: 'inner', name: '内心世界', icon: '🫧' },
    { id: 'life', name: '她的生活', icon: '🌤️' },
    { id: 'diary', name: '她的日记', icon: '📖' },
    { id: 'mailbox', name: '信箱', icon: '📮' }
  ];

  let state = null;
  let active = 'inner';
  let timer = 0;
  let loading = false;
  let err = '';
  let folded = new Set();
  let lastHtml = '';

  /* ───────────── 工具 ───────────── */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nz = (v) => String(v ?? '').trim();
  const arr = (v) => (Array.isArray(v) ? v : []);
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== '' && !(Array.isArray(v) && !v.length);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const ago = (t) => {
    if (!t) return '';
    const d = Date.now() - Number(t);
    if (!Number.isFinite(d) || d < 0) return '';
    const m = Math.floor(d / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    return `${Math.floor(h / 24)} 天前`;
  };
  const hhmm = (t) => {
    if (!t) return '';
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date(n);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const empty = (text) => `<div class="hb-empty">${esc(text)}</div>`;
  const btn = (label, cls = '') => `<button type="button" class="hb-mini ${cls}">${esc(label)}</button>`;

  /* ───────────── 样式 ───────────── */
  const CSS = `
  #hb-orb{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:54px;height:54px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;font-size:26px;cursor:pointer;user-select:none;
    background:linear-gradient(145deg,#26303f,#141a23);border:1px solid rgba(124,198,255,.32);
    box-shadow:0 10px 26px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.03) inset;
    transition:transform .18s ease,box-shadow .18s ease;animation:hb-breath 4.5s ease-in-out infinite}
  #hb-orb:hover{transform:translateY(-2px) scale(1.06);box-shadow:0 14px 32px rgba(124,198,255,.28)}
  #hb-orb .hb-dot{position:absolute;top:3px;right:3px;width:11px;height:11px;border-radius:50%;
    background:#ff9ec7;border:2px solid #141a23;display:none}
  #hb-orb.hb-has .hb-dot{display:block}
  @keyframes hb-breath{0%,100%{box-shadow:0 10px 26px rgba(0,0,0,.45)}50%{box-shadow:0 10px 30px rgba(124,198,255,.28)}}

  #hb-mask{position:fixed;inset:0;z-index:2147483001;display:none;align-items:center;justify-content:center;
    padding:24px;background:rgba(5,8,13,.8)}
  #hb-mask.hb-on{display:flex}
  #hb-card{width:min(1080px,100%);height:min(760px,88vh);display:flex;flex-direction:column;overflow:hidden;
    border-radius:20px;background:#111620;border:1px solid #232b38;
    box-shadow:0 30px 80px rgba(0,0,0,.6);color:#e7ebf2;font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
  #hb-card *{box-sizing:border-box}

  .hb-head{display:flex;align-items:center;gap:12px;padding:16px 18px 12px;border-bottom:1px solid #1d2430;
    background:linear-gradient(180deg,rgba(124,198,255,.06),transparent)}
  .hb-title{display:flex;align-items:baseline;gap:10px;font-size:18px;font-weight:600;letter-spacing:.5px}
  .hb-title small{font-size:12px;font-weight:400;color:#8a93a5;letter-spacing:0}
  .hb-grow{flex:1}
  .hb-btn{border:1px solid #2a3442;background:#18202b;color:#c8d2e0;border-radius:9px;padding:5px 11px;
    font-size:12px;cursor:pointer;transition:all .15s}
  .hb-btn:hover{background:#202b39;color:#fff;border-color:#3a4a5f}
  .hb-btn.hb-x{font-size:14px;padding:3px 10px}
  .hb-btn.hb-reload{min-width:82px;text-align:center}
  .hb-btn:disabled{opacity:.7;cursor:default}
  .hb-btn.hb-ok{color:#7ee0a8;border-color:#2f6b4c;background:#16241c}

  .hb-tabs{display:flex;gap:6px;padding:10px 18px 0}
  .hb-tab{border:none;background:transparent;color:#8a93a5;padding:8px 14px;border-radius:10px 10px 0 0;
    font-size:13.5px;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}
  .hb-tab:hover{color:#cfd8e6;background:rgba(255,255,255,.03)}
  .hb-tab.hb-on{color:#7cc6ff;border-bottom-color:#7cc6ff;background:rgba(124,198,255,.07)}

  .hb-body{flex:1;overflow-y:auto;padding:16px 18px 8px;display:flex;flex-direction:column;gap:12px}
  .hb-body::-webkit-scrollbar{width:8px}
  .hb-body::-webkit-scrollbar-thumb{background:#26303d;border-radius:4px}

  .hb-sec{background:#151c26;border:1px solid #202836;border-radius:14px;padding:13px 15px}
  .hb-sec-h{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:#9fb0c6;
    letter-spacing:.6px;margin-bottom:9px}
  .hb-sec-h .hb-ico{font-size:14px;opacity:.9}
  .hb-sec-h .hb-tail{margin-left:auto;font-weight:400;color:#5d6879;letter-spacing:0;font-size:11.5px}

  .hb-quote{font-size:15.5px;line-height:1.8;color:#eef3fa;padding:2px 0 4px;
    border-left:2px solid rgba(124,198,255,.45);padding-left:12px}
  .hb-empty{color:#586374;font-size:13px;padding:4px 0}

  .hb-chips{display:flex;flex-wrap:wrap;gap:7px}
  .hb-chip{font-size:12px;color:#a9bdd6;background:#1b2431;border:1px solid #27313f;border-radius:999px;padding:3px 10px}
  .hb-chip.hb-pink{color:#ffc2da;border-color:#4a2c39;background:#241a20}
  .hb-chip.hb-blue{color:#a9dcff;border-color:#24405a;background:#16222e}

  .hb-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px}
  .hb-kv dt{color:#7c8798;white-space:nowrap}
  .hb-kv dd{margin:0;color:#dbe4f0;word-break:break-word}

  .hb-tl{display:flex;flex-direction:column;gap:0}
  .hb-evt{position:relative;padding:0 0 13px 20px}
  .hb-evt:before{content:"";position:absolute;left:4px;top:6px;width:7px;height:7px;border-radius:50%;
    background:#7cc6ff;box-shadow:0 0 0 3px rgba(124,198,255,.13)}
  .hb-evt:after{content:"";position:absolute;left:7px;top:16px;bottom:0;width:1px;background:#222b38}
  .hb-evt:last-child{padding-bottom:2px}
  .hb-evt:last-child:after{display:none}
  .hb-evt-t{font-size:11.5px;color:#6d7889;margin-bottom:2px}
  .hb-evt-c{font-size:13.5px;color:#dfe7f2}
  .hb-evt-c b{color:#fff;font-weight:600}

  .hb-bar{height:7px;border-radius:999px;background:#1d2532;overflow:hidden;margin:7px 0 5px}
  .hb-bar>i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#7cc6ff,#ff9ec7);transition:width .5s}

  .hb-diary{background:#151c26;border:1px solid #202836;border-radius:14px;padding:14px 16px}
  .hb-diary-h{display:flex;align-items:center;gap:9px;margin-bottom:7px;font-size:12px;color:#7c8798}
  .hb-diary-h .hb-mood{color:#ffc2da;background:#241a20;border:1px solid #4a2c39;padding:1px 8px;border-radius:999px;font-size:11.5px}
  .hb-diary-c{font-size:14.5px;line-height:1.85;color:#e8eef6;white-space:pre-wrap;word-break:break-word}

  .hb-foot{display:flex;align-items:center;gap:12px;padding:9px 18px;border-top:1px solid #1d2430;
    font-size:11.5px;color:#5d6879;background:#0d121a}
  .hb-foot .hb-live{display:inline-flex;align-items:center;gap:5px}
  .hb-foot .hb-live i{width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80}
  .hb-foot .hb-live.hb-err i{background:#f87171;box-shadow:0 0 6px #f87171}
  .hb-foot .hb-src{margin-left:auto;display:flex;gap:5px;flex-wrap:wrap;max-width:55%}
  .hb-foot .hb-s{background:#161d27;border:1px solid #232c3a;border-radius:6px;padding:0 6px;color:#7c8798}

  .hb-sec-h{cursor:pointer}
  .hb-sec-h:hover .hb-fold{color:#9fb0c6}
  .hb-fold{display:inline-block;margin-left:5px;font-size:10px;color:#4d5868;transition:transform .18s ease}
  .hb-sec.hb-folded .hb-fold{transform:rotate(-90deg)}
  .hb-sec.hb-folded>*:not(.hb-sec-h){display:none}

  @media (max-width:760px){
    #hb-mask{padding:0}
    #hb-card{height:100%;width:100%;border-radius:0;border:none}
    #hb-orb{right:14px;bottom:14px}
  }`;

  /* ───────────── DOM ───────────── */
  let elOrb, elMask, elCard, elBody, elFoot, elDay;

  function mount() {
    if (!document.body) return;
    const style = document.createElement('style');
    style.id = 'hb-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    elOrb = document.createElement('div');
    elOrb.id = 'hb-orb';
    elOrb.title = '她的世界（内心世界 / 她的生活 / 她的日记）';
    elOrb.innerHTML = '<span>🐋</span><span class="hb-dot"></span>';
    elOrb.addEventListener('click', () => open());

    elMask = document.createElement('div');
    elMask.id = 'hb-mask';
    elMask.addEventListener('mousedown', (e) => { if (e.target === elMask) close(); });

    elCard = document.createElement('div');
    elCard.id = 'hb-card';
    elCard.innerHTML = `
      <div class="hb-head">
        <div class="hb-title">她 <small class="hb-day"></small></div>
        <div class="hb-grow"></div>
        <button type="button" class="hb-btn hb-reload">刷新</button>
        <button type="button" class="hb-btn hb-x">✕</button>
      </div>
      <div class="hb-tabs">${PANES.map((p) => `<button type="button" class="hb-tab" data-pane="${p.id}">${p.icon} ${p.name}</button>`).join('')}</div>
      <div class="hb-body"></div>
      <div class="hb-foot"></div>`;
    elMask.appendChild(elCard);
    document.body.appendChild(elOrb);
    document.body.appendChild(elMask);

    elBody = elCard.querySelector('.hb-body');
    elFoot = elCard.querySelector('.hb-foot');
    elDay = elCard.querySelector('.hb-day');

    elCard.querySelector('.hb-x').addEventListener('click', close);
    const elReload = elCard.querySelector('.hb-reload');
    elReload.addEventListener('click', async () => {
      if (elReload.disabled) return;
      elReload.disabled = true;
      elReload.classList.remove('hb-ok');
      elReload.textContent = '刷新中…';
      state = null;
      const t0 = performance.now();
      try { await load(true); } catch { /* load 自己兜底 */ }
      // 本地文件是毫秒级返回的，留点存在感，别让按钮闪一下就没影
      const gap = 420 - (performance.now() - t0);
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      if (err) {
        elReload.textContent = '刷新失败';
      } else {
        elReload.textContent = '✓ 已刷新';
        elReload.classList.add('hb-ok');
      }
      setTimeout(() => {
        elReload.textContent = '刷新';
        elReload.disabled = false;
        elReload.classList.remove('hb-ok');
      }, 1100);
    });
    elCard.querySelectorAll('.hb-tab').forEach((b) => {
      b.addEventListener('click', () => { active = b.dataset.pane; lastHtml = ''; render(); });
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  function open() {
    elMask.classList.add('hb-on');
    elOrb.querySelector('.hb-dot').style.display = 'none';
    elOrb.classList.remove('hb-has');
    render();
    load();
    startTimer();
  }

  function close() {
    elMask.classList.remove('hb-on');
    stopTimer();
  }

  function startTimer() {
    stopTimer();
    const sec = Math.min(10, Math.max(5, Number(state?.refreshSeconds) || 5));
    timer = setInterval(() => { if (elMask.classList.contains('hb-on')) load(); }, sec * 1000);
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }

  /* ───────────── 数据 ───────────── */
  async function load(force) {
    if (loading && !force) return;
    loading = true;
    try {
      const r = await fetch(`${SNAPSHOT}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const changed = !state || j.generatedAt !== state.generatedAt;
      state = j;
      err = '';
      if (changed) render();
      else renderFoot();
      if (!elMask.classList.contains('hb-on') && changed && state?.inner?.thinkNow) {
        elOrb.classList.add('hb-has');
        elOrb.querySelector('.hb-dot').style.display = 'block';
      }
    } catch (e) {
      err = String(e?.message || e);
      renderFoot();
      if (!state) { state = null; render(); }
    } finally {
      loading = false;
    }
  }

  /* ───────────── 渲染 ───────────── */
  function render() {
    if (!elBody) return;
    if (!state) {
      elDay.textContent = '';
      elBody.innerHTML = err
        ? `<div class="hb-sec"><div class="hb-empty">读取不到快照：${esc(err)}<br>（「她的世界」插件可能没在运行，或快照还没生成）</div></div>`
        : `<div class="hb-sec"><div class="hb-empty">正在读取她的世界…</div></div>`;
      renderFoot();
      return;
    }
    elDay.textContent = `${state.todayText || ''}${state.generatedAt ? ` · ${hhmm(state.generatedAt).slice(6) || ''}` : ''}`.trim();
    elCard.querySelectorAll('.hb-tab').forEach((b) => b.classList.toggle('hb-on', b.dataset.pane === active));
    const html = active === 'life' ? paneLife(state) : active === 'diary' ? paneDiary(state) : active === 'mailbox' ? paneMailbox(state) : paneInner(state);
    // 内容一个字没变就别重绘：既省掉闪烁，也不会把你正在看的位置顶回去
    // 主人正在「主人写一条」里打字时别重建 DOM：innerHTML 一换，光标和焦点就丢了。
    // 先记下本轮 HTML，等失焦后的下一轮再补绘。
    if (document.activeElement && (document.activeElement.id === 'hb-owner-text' || document.activeElement.id === 'hb-desire-input')) {
      ownerEditing = true;
    } else if (ownerEditing) {
      ownerEditing = false;
      lastHtml = '';
    }
    if (ownerEditing) { lastHtml = html; renderFoot(); return; }
    if (html === lastHtml) { renderFoot(); return; }
    lastHtml = html;
    const keepTop = elBody.scrollTop;
    elBody.innerHTML = html;
    elBody.scrollTop = keepTop;
    bindFolds();
    bindOwner();
    renderFoot();
  }

  function renderFoot() {
    if (!elFoot) return;
    const src = arr(state?.sources);
    const miss = arr(state?.missing);
    const when = state?.generatedAt ? hhmm(state.generatedAt) : '—';
    elFoot.innerHTML = `
      <span class="hb-live ${err ? 'hb-err' : ''}"><i></i>${err ? '离线' : '在线'} · ${esc(when)}</span>
      <span>每 ${Number(state?.refreshSeconds) || 45} 秒自动刷新</span>
      <span class="hb-src">${src.map((s) => `<span class="hb-s">${esc(s)}</span>`).join('')}${miss.length ? `<span class="hb-s" style="opacity:.55">缺 ${miss.length} 项</span>` : ''}</span>`;
  }

  /* 每块右上一个倒三角，点标题收起/展开；刷新后保持收起状态 */
  function bindFolds() {
    elBody.querySelectorAll('.hb-sec').forEach((sec, idx) => {
      const h = sec.querySelector('.hb-sec-h');
      if (!h || h.querySelector('.hb-fold')) return;
      const key = `${active}:${idx}`;
      const b = document.createElement('span');
      b.className = 'hb-fold';
      b.textContent = '▾';
      h.appendChild(b);
      if (folded.has(key)) sec.classList.add('hb-folded');
      h.addEventListener('click', () => {
        const on = sec.classList.toggle('hb-folded');
        if (on) folded.add(key); else folded.delete(key);
      });
    });
  }

  /* 内心世界 */
  function paneInner(s) {
    const i = obj(s.inner) || {};
    const out = [];
    // 词条显示名可以在设置里改（内部字段名不变）
    const L = obj(s.labels) || {};
    const lb = (k, d) => (has(L[k]) ? L[k] : d);

    if (has(i.thinkNow)) {
      out.push(`<div class="hb-sec">
        <div class="hb-sec-h"><span class="hb-ico">💭</span>此刻在想<span class="hb-tail">${esc(i.friend?.name || '')}</span></div>
        <div class="hb-quote">${esc(i.thinkNow)}</div>
      </div>`);
    }

    const chips = [];
    if (has(i.mood)) chips.push(`<span class="hb-chip hb-pink">心情 · ${esc(i.mood)}</span>`);
    arr(i.ongoing).slice(0, 8).forEach((x) => { if (has(x)) chips.push(`<span class="hb-chip">${esc(x)}</span>`); });
    if (chips.length) out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">🌙</span>状态</div><div class="hb-chips">${chips.join('')}</div></div>`);

    const th = arr(i.thoughts).filter((x) => has(x?.text));
    if (th.length) {
      out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">🫧</span>心事时间线<span class="hb-tail">${th.length} 条</span></div>
        <div class="hb-tl">${th.slice(0, 12).map((x) => `<div class="hb-evt"><div class="hb-evt-t">${esc(x.atText || hhmm(x.at))}${x.ago ? ` · ${esc(x.ago)}` : ''}</div><div class="hb-evt-c">${esc(x.text)}</div></div>`).join('')}</div>
      </div>`);
    }

    const d = obj(i.desire);
    if (d) {
      const v = Math.max(0, Math.min(100, Number(d.value) || 0));
      const vTxt = v > 0 && v < 10 ? v.toFixed(2) : String(Math.round(v));  // 个位数给两位小数，才看得见它在爬
      // 魅魔状态（2026-10-19）：欲望值过 60 就进，跟插件注入的阈值一致
      const succubus = v >= 60;
      const frenzyLine = Number(d.frenzyLine) || 100;
      const frenzy = v >= frenzyLine;
      const kv = [];
      if (has(d.label)) kv.push(['档位', d.label]);
      kv.push(['魅魔', succubus ? '已进入 · 主动黏人' : `未进入（≥60 开启，还差 ${Math.ceil(60 - v)}）`]);
      kv.push(['失守', frenzy ? '已彻底失守 · 全开' : `未到达（≥${frenzyLine} 彻底失守）`]);
      if (d.craving) kv.push([lb('craving', '渴望层数'), `${d.craving}${d.cravingMax ? ` / ${d.cravingMax}` : ''}`]);
      if (d.climax) kv.push(['状态', `顶点中${d.climaxRemainMin ? `（还剩 ${d.climaxRemainMin} 分钟）` : ''}`]);
      else if (d.refractory) kv.push(['状态', `不应期${d.refractoryRemainMin ? `（还剩 ${d.refractoryRemainMin} 分钟）` : ''}`]);
      if (has(d.updatedAgo)) kv.push(['更新', d.updatedAgo]);
      const hist = arr(d.history).slice(-10).reverse();
      const histHtml = hist.length ? `<div class="hb-hist" style="margin-top:8px"><div style="font-size:12px;color:#8b93a3;margin-bottom:4px">变动记录</div>${hist.map((h) => {
        const dv = Number(h.delta) || 0;
        const color = dv > 0 ? '#ffa2b4' : (dv < 0 ? '#8fb8ff' : '#8b93a3');
        const sign = dv > 0 ? '+' : '';
        return `<div style="display:flex;gap:8px;font-size:12px;line-height:1.7"><span style="color:#7f8797;min-width:42px">${esc(hhmm(h.at))}</span><span style="color:${color};min-width:52px">${sign}${Math.abs(dv) % 1 ? dv.toFixed(1) : dv.toFixed(0)}</span><span style="color:#c9d1dc;opacity:.85">${esc(h.reason || '')}</span></div>`;
      }).join('')}</div>` : '';
      out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">🔥</span>${lb('desire', '欲望值')}<span class="hb-tail">${vTxt} / 100${frenzy ? ' · 彻底失守' : succubus ? ' · 魅魔' : ''}${d.desireEnabled === false ? ' · 开关关' : ''}</span></div>
        <div class="hb-bar"><i style="width:${Math.max(v, 0.4)}%"></i></div>
        ${kv.length ? `<dl class="hb-kv">${kv.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl>` : ''}
        ${histHtml}
        <div class="hb-tune" style="display:flex;gap:6px;margin-top:8px;align-items:center">
          <input type="number" id="hb-desire-input" min="0" max="100" step="1" value="${Math.round(v)}"
            style="width:76px;border-radius:8px;border:1px solid #27313f;background:#0f1520;color:#e7ebf2;padding:5px 8px;font-size:13px;outline:none" />
          <button type="button" class="hb-btn" id="hb-desire-set" style="font-size:12px;padding:4px 10px">设成这个值</button>
          <span id="hb-desire-msg" style="font-size:12px;color:#7ee0a8"></span>
          <button type="button" class="hb-btn" id="hb-desire-toggle" style="font-size:12px;padding:4px 10px;margin-left:auto">${d.desireEnabled === false ? '打开欲望' : '关掉欲望'}</button>
        </div>
      </div>`);
    }

    const b = obj(i.body);
    if (b) {
      const kv = [];
      if (has(b.sensitivity)) kv.push([lb('sensitivity', '敏感度'), `${b.sensitivity}${b.band ? `（${b.band}）` : ''}`]);
      if (Number.isFinite(Number(b.heat))) {
        const hn = Number(b.heat);
        kv.push([lb('heat', '热度'), `${hn > 0 && hn < 10 ? hn.toFixed(1) : Math.round(hn)} / 100`]);
      }
      out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">🫦</span>身体</div>
        ${kv.length ? `<dl class="hb-kv">${kv.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl>` : empty('还没有身体反应的记录。')}
      </div>`);
    }

    // 情绪得跟身子对得上：欲望都 59 了还挂个"平静"，那是读数不是人
    const dv = Number(obj(i.desire)?.value) || 0;
    const heatN = Number(obj(i.body)?.heat) || 0;
    const moodNow = dv >= 90 ? '失守 · 满脑子都是主人'
      : dv >= 70 ? '难耐 · 想被主人按着'
        : dv >= 45 ? '心不在焉 · 想主人想到走神'
          : dv >= 20 ? '有点发热 · 坐不太住'
            : heatN >= 60 ? '软乎乎的 · 有点黏人'
              : '';

    const fav = obj(i.favor);
    if (fav) {
      const kv = [];
      if (moodNow) {
        kv.push([lb('mood', '情绪'), moodNow]);
        if (has(fav.moodName)) kv.push(['平时', fav.moodName]);
      } else if (has(fav.moodName)) kv.push([lb('mood', '情绪'), fav.moodName]);
      if (Number.isFinite(Number(fav.moodScore))) kv.push([lb('mood', '情绪') + '分', `${Number(fav.moodScore) > 0 ? '+' : ''}${fav.moodScore}`]);
      if (has(fav.bondName)) kv.push([lb('bond', '关系'), fav.bondName]);
      if (Number.isFinite(Number(fav.bond))) kv.push([lb('bond', '关系') + '分', String(fav.bond)]);
      if (fav.isOwnerTop) kv.push(['身份', '主人 · 最高档']);
      if (has(fav.updatedAgo)) kv.push(['更新', fav.updatedAgo]);
      if (kv.length) {
        out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">💗</span>${lb('bond', '关系')}与${lb('mood', '情绪')}</div>
          <dl class="hb-kv">${kv.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${esc(x)}</dd>`).join('')}</dl></div>`);
      }
    }

    return out.join('');
  }

  /* 好感/群友好感这类未知结构：只挑简单字段拍平，避免糊一屏 JSON */
  function kvPush(rows, title, o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return;
    const keys = Object.keys(o).filter((k) => {
      const v = o[k];
      return (typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '' && String(k).length < 14;
    }).slice(0, 6);
    keys.forEach((k) => rows.push([`${title}·${k}`, String(o[k])]));
  }

  /* 她的生活 */
  function paneLife(s) {
    const d = obj(s.doing) || {};
    const out = [];

    const plan = obj(d.plan);
    if (plan) {
      const evs = arr(plan.events).filter((e) => has(e?.what || e?.detail));
      out.push(`<div class="hb-sec">
        <div class="hb-sec-h"><span class="hb-ico">📋</span>今天的安排${has(plan.mood) ? `<span class="hb-tail">心情 · ${esc(plan.mood)}</span>` : ''}</div>
        ${evs.length ? `<div class="hb-tl">${evs.map((e) => `<div class="hb-evt">
            <div class="hb-evt-t">${esc(e.time || '')}${e.whenText ? ` · ${esc(e.whenText)}` : ''}</div>
            <div class="hb-evt-c"><b>${esc(e.what || '')}</b>${e.detail ? `<br>${esc(e.detail)}` : ''}</div></div>`).join('')}</div>`
          : empty('今天没有具体安排。')}
        ${arr(plan.ongoing).length ? `<div class="hb-chips" style="margin-top:10px">${arr(plan.ongoing).map((x) => `<span class="hb-chip">${esc(x)}</span>`).join('')}</div>` : ''}
      </div>`);
    } else {
      out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">📋</span>今天的安排</div>${empty('今天的生活计划还没生成。')}</div>`);
    }

    const said = arr(d.saidToday).filter((x) => has(x?.text));
    out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">💬</span>今天说过的话<span class="hb-tail">${said.length} 句</span></div>
      ${said.length ? `<div class="hb-tl">${said.slice(0, 12).map((x) => `<div class="hb-evt"><div class="hb-evt-t">${esc(x.atText || hhmm(x.at))}${x.kind ? ` · ${esc(x.kind)}` : ''}</div><div class="hb-evt-c">${esc(x.text)}</div></div>`).join('')}</div>`
        : empty('今天还没开口。')}</div>`);

    const pro = arr(d.proactive).filter((x) => has(x?.text));
    if (pro.length) {
      out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">📣</span>主动开口<span class="hb-tail">${pro.length} 条</span></div>
        <div class="hb-tl">${pro.map((x) => `<div class="hb-evt"><div class="hb-evt-t">${esc(x.source || '')}${x.atText ? ` · ${esc(x.atText)}` : ''}${x.ago ? ` · ${esc(x.ago)}` : ''}</div><div class="hb-evt-c">${esc(x.text)}${x.extra ? `<br><span style="color:#6d7889;font-size:12px">${esc(x.extra)}</span>` : ''}</div></div>`).join('')}</div>
      </div>`);
    }

    const log = arr(d.lifeLog).filter((x) => has(x?.summary));
    if (log.length) {
      out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">🌤️</span>生活日志<span class="hb-tail">${log.length} 天</span></div>
        <div class="hb-tl">${log.map((x) => `<div class="hb-evt"><div class="hb-evt-t">${esc(x.dayKey || '')}</div><div class="hb-evt-c">${esc(x.summary)}</div></div>`).join('')}</div>
      </div>`);
    }

    const evs2 = arr(d.recentEvents).filter((x) => has(x?.summary));
    if (evs2.length) {
      out.push(`<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">🧠</span>近期记忆</div>
        <div class="hb-tl">${evs2.map((x) => `<div class="hb-evt"><div class="hb-evt-t">${esc(x.timeOfDay || '')}${x.hourKey ? ` · ${esc(x.hourKey)}` : ''}</div><div class="hb-evt-c">${esc(x.summary)}</div></div>`).join('')}</div>
      </div>`);
    }

    return out.join('');
  }

  /* 主人写一条：面板专用，走 /api/plugin-tool（工具在模型侧已隐藏） */
  let ownerDraft = '';
  let ownerEditing = false;
  let ownerBound = false;
  function bindOwner() {
    if (ownerBound) return;
    ownerBound = true;
    // 事件委托绑在 document 上：面板每 5 秒可能重绘，绑在元素上的监听会跟着元素一起丢
    document.addEventListener('input', (e) => {
      if (e.target && e.target.id === 'hb-owner-text') ownerDraft = e.target.value;
    });
    document.addEventListener('click', async (e) => {
      // 欲望值手动设置（2026-10-20）
      const dbtn = e.target && e.target.closest ? e.target.closest('#hb-desire-set') : null;
      if (dbtn) {
        const inp = document.getElementById('hb-desire-input');
        const msg = document.getElementById('hb-desire-msg');
        const val = Number(inp?.value);
        if (!Number.isFinite(val)) { if (msg) msg.textContent = '填个数字'; return; }
        dbtn.disabled = true;
        if (msg) { msg.style.color = '#9aa4b2'; msg.textContent = '设置中…'; }
        try {
          const r = await fetch('/api/plugin-tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'her-world__owner_set_desire', args: { value: val } })
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
          if (msg) { msg.style.color = '#7ee0a8'; msg.textContent = `已设为 ${Math.round(val)}`; }
        } catch (err) {
          if (msg) { msg.style.color = '#ff8a8a'; msg.textContent = `失败：${err.message}`; }
        } finally {
          dbtn.disabled = false;
        }
        return;
      }
      // 欲望总开关（2026-10-21）
      const tbtn = e.target && e.target.closest ? e.target.closest('#hb-desire-toggle') : null;
      if (tbtn) {
        tbtn.disabled = true;
        try {
          const r = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skills: { 'her-world': { bond: { desireEnabled: tbtn.textContent.includes('打开') } } } })
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          tbtn.textContent = '切换中…';
          location.reload();
        } catch (err) {
          tbtn.disabled = false;
          alert('切换失败：' + err.message);
        }
        return;
      }
      const btn = e.target && e.target.closest ? e.target.closest('#hb-owner-save') : null;
      if (!btn) return;
      const text = String(ownerDraft || '').trim();
      const msg = document.getElementById('hb-owner-msg');
      if (!text) { if (msg) msg.textContent = '先写点内容'; return; }
      btn.disabled = true;
      if (msg) { msg.style.color = '#9aa4b2'; msg.textContent = '写入中…'; }
      try {
        const r = await fetch('/api/plugin-tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'her-world__owner_diary', args: { content: text } })
        });
        const j = await r.json().catch(() => ({}));
        if (!j || !j.ok) throw new Error((j && j.error) || '保存失败');
        ownerDraft = '';
        const ta = document.getElementById('hb-owner-text');
        if (ta) ta.value = '';
        if (msg) { msg.style.color = '#7ee0a8'; msg.textContent = '记下了，她会看到'; }
        await load(true);
      } catch (err) {
        if (msg) { msg.style.color = '#ff9e9e'; msg.textContent = String((err && err.message) || err); }
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* 她的日记 */
  function paneDiary(s) {
    const list = arr(s.diary).filter((x) => has(x?.content));
    const ownerBox = `<div class="hb-sec">
      <div class="hb-sec-h"><span class="hb-ico">🖊️</span>主人写一条<span class="hb-tail">写进她的本子，她会看到</span></div>
      <textarea id="hb-owner-text" rows="3" placeholder="今天想记点什么…" style="width:100%;box-sizing:border-box;resize:vertical;border-radius:10px;border:1px solid #27313f;background:#0f1520;color:#e7ebf2;padding:9px 11px;font:13.5px/1.6 inherit;outline:none">${esc(ownerDraft)}</textarea>
      <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
        <button type="button" class="hb-btn" id="hb-owner-save">记下</button>
        <span id="hb-owner-msg" style="font-size:12px;color:#7ee0a8"></span>
      </div>
    </div>`;
    if (!list.length) {
      return ownerBox + `<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">📖</span>她的日记</div>${empty('日记本还是空的 —— 有些话她还没写下来。')}</div>`;
    }
    return ownerBox + list.map((x) => {
      const tags = [];
      if (has(x.mode)) tags.push(x.mode === 'short' ? '短记' : x.mode);
      if (has(x.source)) tags.push(x.source === 'reply' ? '聊天里写的' : x.source === 'owner' ? '主人写的' : x.source);
      return `<div class="hb-diary">
        <div class="hb-diary-h"><span>${esc(x.time || hhmm(x.at))}</span>${has(x.mood) ? `<span class="hb-mood">${esc(x.mood)}</span>` : ''}${tags.length ? `<span style="opacity:.7">${esc(tags.join(' · '))}</span>` : ''}</div>
        <div class="hb-diary-c">${esc(x.content)}</div>
      </div>`;
    }).join('');
  }

  /* 鱼宝信箱 */
  function paneMailbox(s) {
    const list = arr(s.mailbox);
    if (!list.length) {
      return `<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">📮</span>信箱</div>${empty('信箱还是空的 —— 你们还没写过信。')}</div>`;
    }
    const rows = list.map((m) => {
      if (!m || !has(m.text)) return '';
      const who = m.fromLabel || (m.from === 'owner' ? '主人' : m.from === 'yubao' ? '她' : '另一个鱼宝');
      const dot = m.from === 'owner' && !m.read ? '<span style="color:#ffd479">● 未读</span> ' : '';
      return `<div class="hb-diary">
        <div class="hb-diary-h"><span>${esc(who)} · ${esc(m.time || hhmm(m.at))}</span>${dot}${m.from === 'owner' ? '<span style="opacity:.7">主人写的</span>' : ''}</div>
        <div class="hb-diary-c">${esc(m.text)}</div>
      </div>`;
    }).join('');
    return `<div class="hb-sec"><div class="hb-sec-h"><span class="hb-ico">📮</span>信箱<span class="hb-tail">共 ${list.length} 封</span></div>${rows}</div>`;
  }

  /* ───────────── 启动 ───────────── */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
