/* 她的内心世界 · 控制台页面脚本（由插件 her-inner 注入）
 *
 * 这个文件被复制到 <app>/ui/her-inner/ui.js，由 ui/index.html 末尾的
 * <script defer src="/her-inner/ui.js"> 加载。
 *
 * 它只做一件事：定时拉 /her-inner/state.json（插件写好的快照）并渲染成两个栏：
 *   左栏 = 她的内心世界（心情 / 此刻在琢磨 / 心事时间线 / 欲望 / 身体 / 情绪与关系 / 好感度）
 *   右栏 = 她做的事情（今天的作息 / 今天说过的话 / 主动开口记录 / 往日留档 / 近期事件）
 *
 * 约定（别破坏）：
 *   · 只用 document.createElement + textContent 填数据 —— 不拼 HTML 字符串，天然免注入
 *   · 只在页签处于激活状态时才拉数据（省 IO），另外点页签/点刷新按钮立刻拉一次
 *   · 快照缺失（还没生成 / 插件关了）时给一句人话提示，不要白屏
 */
(function () {
  'use strict';

  var SNAPSHOT_URL = '/her-inner/state.json';
  var POLL_MS = 20000;          // 兜底轮询（快照里也会带 refreshSeconds）
  var state = { data: null, at: 0, error: '', timer: null, busy: false };

  /* ── 页面自带样式（运行时注入，不动 style.css）── */
  var STYLE_ID = 'her-inner-style';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      /* 左栏滚动区：与 #session-items 同款（撑满剩余高度、自己滚） */
      '#her-inner-side{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;',
      'overscroll-behavior:contain;scrollbar-gutter:stable;transform:translateZ(0);padding:12px 14px 24px}',
      '#her-inner-main{max-width:1100px}',
      '.hi-head,.hi-topbar{margin:0 0 10px;font-size:12px;color:var(--tx3)}',
      '.hi-line{line-height:1.75;white-space:pre-wrap;word-break:break-word}',
      '.hi-empty{line-height:1.7;font-size:13px}',
      '.hi-note{font-size:12px;margin-top:6px;line-height:1.6}',
      '.hi-kv{display:flex;gap:8px;line-height:1.9;font-size:13px}',
      '.hi-k{flex:0 0 104px;color:var(--tx3)}',
      '.hi-v{flex:1;min-width:0;word-break:break-word}',
      '.hi-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.hi-bar{position:relative;height:8px;border-radius:6px;background:var(--ac-soft);margin:10px 0 6px;overflow:hidden}',
      '.hi-bar-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--ac),var(--ac-line));transition:width .3s ease}',
      '.hi-bar-fill.warm{background:linear-gradient(90deg,var(--warn),var(--warn-line))}',
      '.hi-bar-fill.hot{background:linear-gradient(90deg,var(--err),var(--err-line))}',
      '.hi-bar-txt{position:absolute;right:0;top:-17px;font-size:11px;color:var(--tx3)}',
      '.hi-tl{display:flex;gap:10px;padding:6px 0;border-bottom:1px dashed var(--bd)}',
      '.hi-tl:last-child{border-bottom:none}',
      '.hi-tl-time{flex:0 0 52px;font-variant-numeric:tabular-nums;color:var(--tx3);font-size:12px;padding-top:2px}',
      '.hi-tl-body{flex:1;min-width:0}',
      '.hi-tl-text{line-height:1.65;word-break:break-word}',
      '.hi-tl-tail{font-size:12px;margin-top:2px;line-height:1.6}',
      '.hi-mood{line-height:1.75;margin-bottom:6px}',
      '.hi-sub{margin-top:10px;border-top:1px dashed var(--bd);padding-top:8px}',
      '.hi-sub-title{font-size:12px;margin-bottom:2px}',
      '.hi-emoji{font-style:normal}',
      /* ── 可点击放大的文本 + 详情弹层（长文本不再挤成一坨）── */
      '.hi-zoom{cursor:zoom-in;border-radius:6px;transition:background .15s ease}',
      '.hi-zoom:hover{background:var(--ac-soft)}',
      '.hi-items{margin-top:8px;display:flex;flex-direction:column;gap:6px}',
      '.hi-item{position:relative;display:block;padding:8px 10px 8px 12px;border-radius:8px;',
      'background:var(--ac-soft);border-left:3px solid var(--ac-line);line-height:1.7;',
      'word-break:break-word;cursor:zoom-in;transition:filter .15s ease}',
      '.hi-item:hover{filter:brightness(1.1)}',
      '.hi-item.clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.hi-item-tail{margin-top:2px;font-size:11px;color:var(--tx3)}',
      '.hi-modal{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;',
      'background:rgba(0,0,0,.55);padding:5vh 5vw;backdrop-filter:blur(2px)}',
      '.hi-modal-panel{display:flex;flex-direction:column;max-width:min(880px,92vw);max-height:86vh;',
      'background:var(--bg2,#1b1d23);border:1px solid var(--bd);border-radius:14px;',
      'box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden}',
      '.hi-modal-bar{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--bd)}',
      '.hi-modal-title{flex:1;min-width:0;font-size:13px;color:var(--tx3)}',
      '.hi-modal-close{cursor:pointer;border:none;background:transparent;color:var(--tx3);font-size:16px;',
      'line-height:1;padding:4px 8px;border-radius:6px}',
      '.hi-modal-close:hover{background:var(--ac-soft);color:var(--tx)}',
      '.hi-modal-body{padding:16px 18px 20px;overflow:auto;font-size:15px;line-height:1.95;',
      'white-space:pre-wrap;word-break:break-word;color:var(--tx)}'
    ].join('');
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ── 小工具 ── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function card(icon, title, extra) {
    var d = el('details', 'collapsible');
    d.open = true;
    var s = el('summary');
    s.appendChild(el('span', 'tool-ico', icon));
    s.appendChild(el('span', 'tool-name-flow', title));
    if (extra) s.appendChild(el('span', 'tool-label', extra));
    d.appendChild(s);
    var body = el('div', 'coll-body');
    d.appendChild(body);
    return { root: d, body: body };
  }
  function line(text, cls) { return el('div', cls || 'hi-line', text); }
  function keyval(k, v) {
    var row = el('div', 'hi-kv');
    row.appendChild(el('span', 'hi-k', k));
    row.appendChild(el('span', 'hi-v', v));
    return row;
  }
  function empty(text) { return el('div', 'muted hi-empty', text); }
  function badge(text, kind) { return el('span', 'badge ' + (kind || 'ok'), text); }

  /* ── 详情弹层：长文本点一下放大看（字号更大、可滚动、ESC 关闭）── */
  function closeModal() {
    var ov = document.getElementById('hi-modal');
    if (ov) ov.style.display = 'none';
  }
  function openModal(title, text) {
    var ov = document.getElementById('hi-modal');
    if (!ov) {
      ov = el('div', 'hi-modal');
      ov.id = 'hi-modal';
      var panel = el('div', 'hi-modal-panel');
      var bar = el('div', 'hi-modal-bar');
      var t = el('div', 'hi-modal-title');
      t.id = 'hi-modal-title';
      var x = el('button', 'hi-modal-close', '✕');
      x.type = 'button';
      x.title = '关闭（Esc）';
      bar.appendChild(t); bar.appendChild(x);
      var body = el('div', 'hi-modal-body');
      body.id = 'hi-modal-body';
      panel.appendChild(bar); panel.appendChild(body);
      ov.appendChild(panel);
      ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
      x.addEventListener('click', closeModal);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) closeModal();
      });
      document.body.appendChild(ov);
    }
    var tt = document.getElementById('hi-modal-title');
    var bb = document.getElementById('hi-modal-body');
    if (tt) tt.textContent = title || '';
    if (bb) bb.textContent = text || '';
    ov.style.display = 'flex';
  }

  /** 给一个节点绑上"点击放大"。标题会显示在弹层顶部。 */
  function zoomable(node, title, text) {
    var body = text === undefined || text === null ? node.textContent : text;
    node.classList.add('hi-zoom');
    node.title = '点击放大查看';
    node.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      openModal(title, body);
    });
    return node;
  }

  /**
   * 长文本条目列表（替代原来塞进 <span class="badge"> 的做法）。
   * badge 是给短标签用的行内元素，多行长句塞进去会互相重叠。
   * 每条独立成块、超过 clamp 行就截断，点开看全文。
   */
  function itemList(title, items, opts) {
    var list = el('div', 'hi-items');
    var limit = (opts && opts.clamp) || 2;
    (items || []).forEach(function (raw, i) {
      var text = String(raw === undefined || raw === null ? '' : raw);
      if (!text) return;
      var node = el('div', 'hi-item clamp', text);
      node.style.webkitLineClamp = String(limit);
      node.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openModal(title + '（第 ' + (i + 1) + ' 条 / 共 ' + items.length + ' 条）', text);
      });
      node.title = '点击放大查看全文';
      list.appendChild(node);
    });
    return list;
  }

  function bar(value, max, kind) {
    var wrap = el('div', 'hi-bar');
    var fill = el('div', 'hi-bar-fill ' + (kind || ''));
    var pct = Math.max(0, Math.min(100, Math.round((Number(value) || 0) / (max || 100) * 100)));
    fill.style.width = pct + '%';
    wrap.appendChild(fill);
    wrap.appendChild(el('span', 'hi-bar-txt', pct + '%'));
    return wrap;
  }

  function timeLine(when, text, tail) {
    var row = el('div', 'hi-tl');
    row.appendChild(el('span', 'hi-tl-time', when || '--:--'));
    var mid = el('div', 'hi-tl-body');
    var txt = el('div', 'hi-tl-text', text || '（无内容）');
    if (text) zoomable(txt, (when ? when + ' · ' : '') + '心事', String(text));
    mid.appendChild(txt);
    if (tail) mid.appendChild(el('div', 'hi-tl-tail muted', tail));
    row.appendChild(mid);
    return row;
  }

  /* ── 渲染：左栏 = 她的内心世界 ── */
  function renderInner(box, d) {
    box.textContent = '';
    var inner = d.inner || {};

    var head = el('div', 'hi-head muted');
    head.textContent = '数据更新：' + (d.generatedAtText || '—')
      + (d.owner && d.owner.chatKey ? '　·　' + d.owner.chatKey + (d.owner.name ? '（' + d.owner.name + '）' : '') : '');
    box.appendChild(head);

    // 今天的心情
    var c1 = card('🌤️', '今天的心情底色');
    if (inner.mood) c1.body.appendChild(zoomable(line(inner.mood), '今天的心情底色', String(inner.mood)));
    else c1.body.appendChild(empty('还没生成今天的生活 —— 她开始琢磨事情时会自动生成（见「她的生活」插件）。'));
    if (inner.ongoing && inner.ongoing.length) {
      var sub = el('div', 'hi-sub');
      sub.appendChild(el('div', 'hi-sub-title muted', '在延续（' + inner.ongoing.length + ' 条 · 点开看全文）'));
      sub.appendChild(itemList('在延续', inner.ongoing, { clamp: 2 }));
      c1.body.appendChild(sub);
    }
    box.appendChild(c1.root);

    // 此刻在琢磨
    var c2 = card('💭', '此刻在琢磨的事');
    if (inner.thinkNow) c2.body.appendChild(zoomable(line('「' + inner.thinkNow + '」'), '此刻在琢磨的事', String(inner.thinkNow)));
    else c2.body.appendChild(empty('还没记下她的心事（她每次决定要不要开口时会顺手记一句，只存档、不发送）。'));
    box.appendChild(c2.root);

    // 心事时间线
    var c3 = card('🕯️', '心事时间线', (inner.thoughts || []).length ? (inner.thoughts.length + ' 条') : '');
    if ((inner.thoughts || []).length) {
      inner.thoughts.forEach(function (t) {
        c3.body.appendChild(timeLine(t.atText ? t.atText.slice(11) : (t.atText || ''), t.text, t.ago));
      });
    } else c3.body.appendChild(empty('还没有记录。'));
    box.appendChild(c3.root);

    // 欲望值
    if (inner.desire) {
      var dz = inner.desire;
      var c4 = card('🔥', '欲望值', dz.value + '/100');
      c4.body.appendChild(keyval('当前档位', '「' + dz.label + '」' + (dz.climax ? '（顶点，约剩 ' + dz.climaxRemainMin + ' 分钟）' : '')));
      c4.body.appendChild(bar(dz.value, 100, 'warm'));
      if (dz.craving > 0) {
        c4.body.appendChild(keyval('渴望层数', dz.craving + '/' + dz.cravingMax + ' 层'
          + '（自己解决过 ' + dz.masturbateCount + ' 次）'));
        c4.body.appendChild(bar(dz.craving, dz.cravingMax, 'hot'));
      }
      if (dz.full) c4.body.appendChild(keyval('满值状态', '满足之前不会降（已 ' + dz.hoursSinceSatisfy + ' 小时没被满足）'));
      if (dz.needMasturbate) c4.body.appendChild(keyval('这会儿', '满着又没人陪，她会走神想他、可能自己解决'));
      if (dz.lastSatisfyAgo) c4.body.appendChild(keyval('上次被满足', dz.lastSatisfyAgo));
      if (dz.refractory) c4.body.appendChild(keyval('不应期', '约剩 ' + dz.refractoryRemainMin + ' 分钟'));
      if (dz.baseline) c4.body.appendChild(keyval('长期基线', '+' + dz.baseline));
      if (dz.updatedAgo) c4.body.appendChild(keyval('最近变动', dz.updatedAgo));
      box.appendChild(c4.root);
    }

    // 身体与亲密
    if (inner.body) {
      var b = inner.body;
      var c5 = card('🌡️', '身体与亲密', '敏感度 ' + b.sensitivity + '/10');
      c5.body.appendChild(keyval('敏感度', b.sensitivity + '/10「' + b.band + '」'));
      c5.body.appendChild(keyval('当前反应强度', b.heat + '/100'));
      c5.body.appendChild(bar(b.heat, 100, b.heat >= 60 ? 'hot' : 'warm'));
      if (b.lastNote) c5.body.appendChild(keyval('最近一次身体反应', b.lastNote + (b.lastAgo ? '（' + b.lastAgo + '）' : '')));
      if ((b.reacts || []).length) {
        var list = el('div', 'hi-sub');
        list.appendChild(el('div', 'muted hi-sub-title', '最近几次记录'));
        b.reacts.forEach(function (r) {
          list.appendChild(timeLine(r.atText ? r.atText.slice(11) : '', r.note || '（没记原因）',
            (r.delta > 0 ? '+' : '') + r.delta + '　' + (r.ago || '')));
        });
        c5.body.appendChild(list);
      }
      box.appendChild(c5.root);
    }

    // 对你的情绪与关系
    if (inner.favor) {
      var f = inner.favor;
      var c6 = card('💗', '对你的情绪与关系');
      c6.body.appendChild(keyval('当下情绪', '「' + f.moodName + '」（' + (f.moodScore > 0 ? '+' : '') + f.moodScore + '/100）'));
      c6.body.appendChild(keyval('关系深度', '「' + f.bondName + '」' + (f.bond ? '（bond ' + f.bond + '）' : '') + (f.isOwnerTop ? '　· 主人恒定最高档' : '')));
      if (f.updatedAgo) c6.body.appendChild(keyval('最近变化', f.updatedAgo));
      c6.body.appendChild(el('div', 'muted hi-note', '来源：bond「关系与好感」插件'));
      box.appendChild(c6.root);
    }

    // 好感度
    if (inner.affinity) {
      var a = inner.affinity;
      var c7 = card('⭐', '好感度', a.score + ' 分');
      c7.body.appendChild(keyval('等级', 'Lv.' + a.level + '「' + a.title + '」'));
      c7.body.appendChild(el('div', 'muted hi-note', '来源：bond「关系与好感」插件'));
      box.appendChild(c7.root);
    }

    // 与你有关的时间感
    if (inner.friend && (inner.friend.lastIncomingAgo || inner.friend.lastSeenUserAgo)) {
      var c8 = card('🫧', '他的近况');
      if (inner.friend.lastIncomingText) c8.body.appendChild(keyval('他最后说的话', '「' + inner.friend.lastIncomingText + '」'));
      if (inner.friend.lastIncomingAgo) c8.body.appendChild(keyval('那是', inner.friend.lastIncomingAgo));
      if (inner.friend.lastSeenUserAgo) c8.body.appendChild(keyval('他上次找她', inner.friend.lastSeenUserAgo));
      box.appendChild(c8.root);
    }
  }

  /* ── 渲染：右栏 = 她做的事情 ── */
  function renderDoing(box, d) {
    box.textContent = '';
    var doing = d.doing || {};

    var head = el('div', 'hi-head muted');
    head.textContent = '她做的事情　·　' + (d.todayText || '');
    box.appendChild(head);

    // 今天的作息时间轴
    var c1 = card('📅', '今天的安排', doing.planReady ? ((doing.plan && doing.plan.events ? doing.plan.events.length : 0) + ' 件事') : '还没生成');
    if (doing.planReady && doing.plan) {
      if (doing.plan.mood) c1.body.appendChild(el('div', 'hi-mood', doing.plan.mood));
      var evs = doing.plan.events || [];
      if (!evs.length) c1.body.appendChild(empty('今天的生活里还没有具体安排。'));
      evs.forEach(function (e) {
        var tail = e.detail || '';
        if (e.whenText) tail = (tail ? tail + '　·　' : '') + e.whenText;
        c1.body.appendChild(timeLine(e.time, e.what, tail));
      });
    } else {
      c1.body.appendChild(empty('还没生成今天的生活。她开始琢磨事情（你很久没找她，或你说了「我去上班/吃饭/洗澡/睡了」之后）时会自动生成一套当天作息。'));
    }
    box.appendChild(c1.root);

    // 她主动开口的记录
    var pro = doing.proactive || [];
    var c2 = card('📣', '她主动开口的记录', pro.length ? (pro.length + ' 条') : '');
    if (pro.length) {
      pro.forEach(function (p) {
        var row = el('div', 'hi-tl');
        row.appendChild(el('span', 'hi-tl-time', p.atText ? p.atText.slice(11) : (p.ago || '')));
        var mid = el('div', 'hi-tl-body');
        var title = el('div', 'hi-tl-text');
        title.appendChild(badge(p.source || '主动', 'ok'));
        title.appendChild(el('span', '', '　' + (p.text || '（没记内容）')));
        mid.appendChild(title);
        if (p.extra || p.ago) mid.appendChild(el('div', 'hi-tl-tail muted', [p.extra, p.ago].filter(Boolean).join('　·　')));
        row.appendChild(mid);
        c2.body.appendChild(row);
      });
    } else c2.body.appendChild(empty('还没有她主动开口的记录。'));
    box.appendChild(c2.root);

    // 今天说过的话（真凭实据）
    var said = doing.saidToday || [];
    var c3 = card('💬', '今天说过的话', said.length ? (said.length + ' 条') : '');
    if (said.length) {
      said.forEach(function (m) { c3.body.appendChild(timeLine(m.atText, m.text)); });
    } else c3.body.appendChild(empty('今天她还没说过话。'));
    box.appendChild(c3.root);

    // 往日生活留档
    var logs = doing.lifeLog || [];
    var c4 = card('🗂️', '往日生活留档', logs.length ? (logs.length + ' 天') : '');
    if (logs.length) {
      logs.forEach(function (x) { c4.body.appendChild(timeLine(x.dayKey, x.summary)); });
    } else c4.body.appendChild(empty('还没有留档（每天结束时会把当天生活压成一行）。'));
    box.appendChild(c4.root);

    // 近期事件（记忆块）
    var ev = doing.recentEvents || [];
    var c5 = card('🧠', '近期事件（记忆块）', ev.length ? (ev.length + ' 段') : '');
    if (ev.length) {
      ev.forEach(function (x) { c5.body.appendChild(timeLine(x.hourKey || '', x.summary, x.timeOfDay)); });
    } else c5.body.appendChild(empty('还没有记忆块。'));
    box.appendChild(c5.root);

    // 数据来源 / 缺失
    var c6 = card('🗒️', '数据来源');
    c6.body.appendChild(line('已读到：' + ((d.sources || []).length ? d.sources.join(' · ') : '（无）')));
    if ((d.missing || []).length) c6.body.appendChild(line('暂时没有：' + d.missing.join(' · '), 'muted hi-note'));
    c6.body.appendChild(el('div', 'muted hi-note', '这个页面只读；数据来自各插件自己的存档，缺哪项就少显示哪项。'));
    box.appendChild(c6.root);
  }

  function render() {
    var side = $('her-inner-side');
    var main = $('her-inner-main');
    if (!side || !main) return;

    if (state.error) {
      side.textContent = '';
      main.textContent = '';
      side.appendChild(empty(state.error));
      main.appendChild(empty('页面脚本已就位，但还读不到快照：' + state.error));
      return;
    }
    var d = state.data;
    if (!d) {
      side.textContent = '';
      main.textContent = '';
      side.appendChild(empty('正在读取…'));
      main.appendChild(empty('正在读取她今天做的事…'));
      return;
    }
    renderInner(side, d);
    renderDoing(main, d);
  }

  function setBar(text) {
    var btn = $('her-inner-refresh');
    if (btn) btn.textContent = text;
  }

  function load(force) {
    if (state.busy) return;
    state.busy = true;
    setBar('刷新中…');
    fetch(SNAPSHOT_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + (r.status === 404 ? '（快照还没生成，稍等几秒或检查插件是否启用）' : ''));
        return r.json();
      })
      .then(function (j) {
        state.data = j;
        state.error = '';
        state.at = Date.now();
        render();
        var secs = Math.max(10, Math.round(Number(j && j.refreshSeconds) || 20));
        POLL_MS = secs * 1000;
        setBar('刷新');
      })
      .catch(function (e) {
        state.error = String((e && e.message) || e);
        render();
        setBar('重试');
      })
      .finally(function () { state.busy = false; });
  }

  function isActive() {
    var view = $('view-her-inner');
    return !!(view && view.classList.contains('active'));
  }

  function startPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () { if (isActive()) load(); },
      Math.max(10000, POLL_MS));
  }

  function init() {
    var view = $('view-her-inner');
    if (!view) return;                       // 页面没被注入（index.html 打了补丁才会走到这）
    injectStyles();

    // 顶部工具条：标题 + 刷新按钮 + 更新时间
    var head = view.querySelector('.list-pane .list-head');
    if (head && !$('her-inner-refresh')) {
      var btn = el('button', 'list-head-btn', '刷新');
      btn.id = 'her-inner-refresh';
      btn.title = '立即重新读取快照';
      btn.addEventListener('click', function (e) { e.stopPropagation(); load(true); });
      head.appendChild(btn);
    }
    var mainHead = view.querySelector('.detail-pane');
    if (mainHead && !$('her-inner-updated')) {
      var bar = el('div', 'hi-topbar muted');
      bar.id = 'her-inner-updated';
      bar.textContent = '她的内心世界 · 只读页面';
      mainHead.insertBefore(bar, mainHead.firstChild);
    }

    // 点自己的页签立刻拉一次（switchTab 只负责显示，加载由这里做）
    var tab = document.querySelector('.tab[data-tab="her-inner"]');
    if (tab) tab.addEventListener('click', function () { load(true); });

    var up = $('her-inner-updated');
    function stampUpdate() {
      if (!up || !state.at) return;
      var d = new Date(state.at);
      var p = function (n) { return String(n).padStart(2, '0'); };
      up.textContent = '她的内心世界 · 只读页面 · 本页数据 ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' 更新';
    }
    setInterval(stampUpdate, 5000);

    render();
    if (isActive()) load(true);
    else load(true);                          // 先拿一份，切过去就能直接看
    startPolling();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
