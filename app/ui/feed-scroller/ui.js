/* 刷视频 / 上网 · 控制台页面脚本（由插件 feed-scroller 注入）
 *
 * 这个文件被复制到 <app>/ui/feed-scroller/ui.js，由 ui/index.html 末尾的
 *   <script defer src="/feed-scroller/ui.js"></script>
 * 加载，渲染 id="view-feed-scroller" 那一段。
 *
 * 它做三件事：
 *   ① 定时拉 /feed-scroller/state.json（插件写好的快照）→ 渲染状态、记录、表单当前值
 *   ② 改设置 → POST /api/skills/feed-scroller（宿主**唯一**认的 Skill 写入路径，
 *      只接受 manifest 声明过的键；Cookie 那类字段空着/是掩码就等于"不修改"）
 *   ③ 点按钮要立刻干活 → 把命令写进 settings.cmd（插件 5 秒内取走执行并清空），
 *      结果由插件写回快照显示 —— 宿主没给插件自己的路由，这是唯一能"点一下就跑"的路
 *
 * 页面只读快照：任何 cookie 值都不会进浏览器（快照里只有站点名和条数）。
 */
(function () {
  'use strict';

  var ID = 'feed-scroller';
  var SNAP_URL = '/' + ID + '/state.json';
  var API = '/api/skills/' + ID;
  var STYLE_ID = ID + '-style';
  var POLL_MS = 20000;

  var snap = null;
  var busy = false;
  var pollTimer = null;

  /* ── 小工具 ───────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function cmdId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function fmtTok(n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
    return String(n);
  }
  function toast(msg, ok) {
    var host = $('fs-toast');
    if (!host) return;
    host.textContent = msg;
    host.className = 'fs-toast on' + (ok === false ? ' bad' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { host.className = 'fs-toast'; }, 4200);
  }

  function api(body) {
    return fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  /** 点按钮 → 写命令进设置，插件取走执行。 */
  function sendCmd(action, extra) {
    var cmd = { id: cmdId(), action: action, at: Date.now() };
    if (extra) for (var k in extra) if (extra[k]) cmd[k] = extra[k];
    return api({ settings: { cmd: cmd } }).then(function (r) {
      if (r && r.ok === false) { toast('命令没写进去：' + (r.error || '未知原因'), false); return false; }
      toast('已下单：' + action + '（几秒内执行，结果会显示在左上角）');
      return true;
    });
  }

  /* ── 样式（运行时注入，不动 style.css）────────────────────── */
  function injectStyle() {
    if ($(STYLE_ID)) return;
    var css = [
      /* 宿主主题变量映射：插件假定 --bd/--bg1/--bg2/--tx1/--tx2/--tx3，宿主用 --line-str/--card/--card-hi/--fg/--fg-dim/--fg-mute */
      '#view-feed-scroller{--bd:var(--line-str, rgba(255,255,255,.15));--bg1:var(--card,#24252b);--bg2:var(--card-hi,#2a2c33);--tx1:var(--fg,#e9eaec);--tx2:var(--fg-dim,#9aa0aa);--tx3:var(--fg-mute,#6f757f);color:var(--fg,#e9eaec)}',
      '#' + ID + '-side{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:12px 14px 24px}',
      '#' + ID + '-main{max-width:900px;padding:14px 18px 40px}',
      '.fs-card{border:1px solid var(--bd);border-radius:10px;margin:0 0 14px;background:var(--bg1,#fff)}',
      '.fs-card>summary{cursor:pointer;padding:10px 14px;font-weight:600;font-size:14px;list-style:none;display:flex;align-items:center;gap:8px}',
      '.fs-card>summary::-webkit-details-marker{display:none}',
      '.fs-card>summary:before{content:"▸";color:var(--tx3);font-size:12px;transition:transform .15s}',
      '.fs-card[open]>summary:before{transform:rotate(90deg)}',
      '.fs-card-body{padding:2px 14px 14px;border-top:1px solid var(--bd)}',
      '.fs-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px dashed var(--bd)}',
      '.fs-row:last-child{border-bottom:none}',
      '.fs-label{flex:0 0 210px;font-size:13px;color:var(--tx1)}',
      '.fs-label small{display:block;color:var(--tx3);font-size:11.5px;line-height:1.45;margin-top:3px;font-weight:400}',
      '.fs-input{flex:1 1 auto;min-width:0}',
      '.fs-input input[type=text],.fs-input input[type=number],.fs-input textarea{width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--bd);border-radius:6px;background:var(--bg2,transparent);color:var(--tx1);font:inherit;font-size:13px}',
      '.fs-input textarea{min-height:74px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}',
      '.fs-input input[type=checkbox]{width:16px;height:16px;margin-top:2px}',
      '.fs-hint{font-size:11.5px;color:var(--tx3);margin-top:4px}',
      '.fs-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
      '.fs-btn{cursor:pointer;border:1px solid var(--bd);background:var(--bg2,transparent);color:var(--tx1);border-radius:7px;padding:6px 12px;font-size:13px;font-family:inherit}',
      '.fs-btn:hover{border-color:var(--tx3)}',
      '.fs-btn.primary{background:#2f6fed;border-color:#2f6fed;color:#fff}',
      '.fs-btn.warn{color:#c0392b;border-color:#c0392b}',
      '.fs-btn[disabled]{opacity:.5;cursor:default}',
      '.fs-kv{display:flex;gap:8px;font-size:12.5px;padding:3px 0}',
      '.fs-kv b{flex:0 0 96px;color:var(--tx3);font-weight:400}',
      '.fs-kv span{flex:1 1 auto;word-break:break-all}',
      '.fs-list{max-height:340px;overflow:auto;border:1px solid var(--bd);border-radius:8px}',
      '.fs-item{padding:8px 10px;border-bottom:1px solid var(--bd);font-size:12.5px}',
      '.fs-item:last-child{border-bottom:none}',
      '.fs-item .t{color:var(--tx1);font-weight:600}',
      '.fs-item .m{color:var(--tx3);margin-top:2px;line-height:1.5}',
      '.fs-item .s{color:var(--tx2);margin-top:2px;line-height:1.5}',
      '.fs-tag{display:inline-block;font-size:11px;border:1px solid var(--bd);border-radius:999px;padding:0 7px;margin-right:6px;color:var(--tx3)}',
      '.fs-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(20px);background:#222;color:#fff;padding:9px 16px;border-radius:9px;font-size:13px;opacity:0;pointer-events:none;transition:.2s;z-index:99;max-width:70vw}',
      '.fs-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}',
      '.fs-toast.bad{background:#8e2b22}',
      '.fs-side-title{font-size:12px;color:var(--tx3);margin:12px 0 6px;letter-spacing:.04em}',
      '.fs-pill{display:inline-block;font-size:11.5px;border-radius:999px;padding:1px 9px;border:1px solid var(--bd);color:var(--tx2);margin:0 6px 4px 0}',
      '.fs-pill.on{border-color:#2f6fed;color:#2f6fed}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ── 渲染：左侧状态栏 ─────────────────────────────────── */
  function renderSide() {
    var side = $(ID + '-side');
    if (!side) return;
    clear(side);
    if (!snap || snap.ok !== true) {
      side.appendChild(el('div', 'empty-hint', '还没读到数据：' + ((snap && snap.error) || '插件可能没在跑')));
      return;
    }
    var st = snap.status || {};

    side.appendChild(el('div', 'fs-side-title', '此刻状态'));
    var box = el('div');
    [
      ['今天看了', st.watchedToday + ' / ' + st.watchCap + ' 条'],
      ['今天上网', st.surfedToday + ' 次' + (st.surfCap ? ' / ' + st.surfCap : '')],
      ['今天说过', st.spokenToday + ' 条' + (st.speakCap ? ' / ' + st.speakCap : '')],
      ['上次活动', st.lastCycleText],
      ['上次结果', st.lastResult],
      ['下次大概', st.nextText],
      ['静默时段', st.quiet + (st.quietActive ? '（现在就在其中）' : '')],
      ['说给谁', st.target],
      ['攒着想说的', st.pendingText || '（没有）'],
      ['账号', (snap.accounts && snap.accounts.sites.length) ? snap.accounts.sites.map(function (x) { return x.host; }).join('、') : '（没配）'],
      ['浏览器', snap.browser && snap.browser.available ? ('就绪 · ' + snap.browser.partition) : '不可用（退化为朴素抓取）'],
      ['页签', (snap.ui && snap.ui.tab) ? '已就位' : (snap.ui && snap.ui.reason) || '未就位'],
      ['上一轮消耗', (snap.lastCycleTokens != null) ? (fmtTok(snap.lastCycleTokens) + ' token') : '…'],
      ['数据时间', snap.updatedText]
    ].forEach(function (kv) {
      var row = el('div', 'fs-kv');
      row.appendChild(el('b', null, kv[0]));
      row.appendChild(el('span', null, kv[1] === undefined || kv[1] === null ? '' : String(kv[1])));
      box.appendChild(row);
    });
    side.appendChild(box);

    if (snap.cmd) {
      side.appendChild(el('div', 'fs-side-title', '上一次按钮的结果'));
      var c = el('div', 'fs-kv');
      c.appendChild(el('b', null, snap.cmd.action));
      c.appendChild(el('span', null, (snap.cmd.ok ? '✅ ' : '❌ ') + snap.cmd.detail));
      side.appendChild(c);
    }

    side.appendChild(el('div', 'fs-side-title', '最近刷到 / 逛到的'));
    var list = el('div', 'fs-list');
    var recent = snap.recent || [];
    if (!recent.length) list.appendChild(el('div', 'empty-hint', '还没有记录'));
    recent.forEach(function (it) {
      var node = el('div', 'fs-item');
      var head = el('div');
      head.appendChild(el('span', 'fs-tag', it.sourceText));
      if (it.url) {
        var a = el('a', 't', it.title);
        a.href = it.url;
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.style.color = 'inherit';
        a.style.textDecoration = 'underline';
        head.appendChild(a);
      } else {
        head.appendChild(el('span', 't', it.title));
      }
      if (it.share) head.appendChild(el('span', 'fs-tag', '值得他看'));
      node.appendChild(head);
      if (it.saw) node.appendChild(el('div', 's', '看到：' + it.saw));
      if (it.say) node.appendChild(el('div', 'm', '想说：' + it.say));
      if (it.extra) node.appendChild(el('div', 'm', '细节：' + it.extra));
      node.appendChild(el('div', 'm', it.ago + (it.via ? ' · ' + it.via : '')));
      if (it.url) {
        var bSend = el('button', 'fs-btn', '把这条链接发给我');
        bSend.style.marginTop = '6px';
        bSend.addEventListener('click', (function (it2) {
          return function () { sendCmd('send_link', { id: it2.id }); };
        })(it));
        node.appendChild(bSend);
      }
      node.title = it.url || '';
      list.appendChild(node);
    });
    side.appendChild(list);
  }

  /* ── 渲染：右侧设置 ───────────────────────────────────── */
  function field(label, desc, control) {
    var row = el('div', 'fs-row');
    var lab = el('div', 'fs-label');
    lab.appendChild(document.createTextNode(label));
    if (desc) lab.appendChild(el('small', null, desc));
    row.appendChild(lab);
    var wrap = el('div', 'fs-input');
    wrap.appendChild(control);
    row.appendChild(wrap);
    return row;
  }

  function textInput(key, value, hint) {
    var i = el('input');
    i.type = 'text';
    i.dataset.key = key;
    i.value = value === undefined || value === null ? '' : String(value);
    if (hint) i.placeholder = hint;
    return i;
  }
  function numInput(key, value, step, min, max) {
    var i = el('input');
    i.type = 'number';
    i.dataset.key = key;
    i.dataset.kind = 'number';
    i.value = value === undefined || value === null ? '' : String(value);
    if (step) i.step = String(step);
    if (min !== undefined) i.min = String(min);
    if (max !== undefined) i.max = String(max);
    return i;
  }
  function boolInput(key, value) {
    var i = el('input');
    i.type = 'checkbox';
    i.dataset.key = key;
    i.dataset.kind = 'boolean';
    i.checked = value === true;
    return i;
  }
  function longInput(key, value, hint) {
    var t = el('textarea');
    t.dataset.key = key;
    t.value = value === undefined || value === null ? '' : String(value);
    if (hint) t.placeholder = hint;
    return t;
  }

  function card(title, open) {
    var d = document.createElement('details');
    d.className = 'fs-card';
    if (open) d.open = true;
    var sum = document.createElement('summary');
    sum.textContent = title;
    d.appendChild(sum);
    var body = el('div', 'fs-card-body');
    d.appendChild(body);
    return { node: d, body: body };
  }

  function saveBar(extra) {
    var bar = el('div', 'fs-btns');
    var b = el('button', 'fs-btn primary', '保存这一块');
    b.addEventListener('click', function () { save(extra); });
    bar.appendChild(b);
    return bar;
  }

  /** 收集当前页面上的所有输入（跨卡片），按类型转换后提交。 */
  function collect() {
    var settings = {};
    var inputs = document.querySelectorAll('#' + ID + '-main [data-key]');
    Array.prototype.forEach.call(inputs, function (i) {
      var k = i.dataset.key;
      if (!k) return;
      if (i.dataset.kind === 'boolean') { settings[k] = i.checked; return; }
      if (i.dataset.kind === 'number') {
        var n = Number(i.value);
        if (i.value === '' || !isFinite(n)) return;          // 空着 = 不动它
        settings[k] = n;
        return;
      }
      var v = i.value;
      if (k === 'accountCookies') { if (String(v).trim() === '') return; settings[k] = v; return; }
      settings[k] = v;
    });
    return settings;
  }

  function save(extra) {
    if (busy) return;
    busy = true;
    var body = { settings: collect() };
    if (extra) for (var k in extra) body[k] = extra[k];
    api(body).then(function (r) {
      busy = false;
      if (r && r.ok) { toast('已保存（马上生效，不用重启）'); load(true); }
      else toast('保存失败：' + ((r && r.error) || '未知原因'), false);
    }).catch(function (e) {
      busy = false;
      toast('保存失败：' + (e && e.message ? e.message : e), false);
    });
  }

  function renderMain() {
    var main = $(ID + '-main');
    if (!main) return;
    clear(main);
    if (!snap || snap.ok !== true) {
      var hint = el('div', 'empty-hint', '读不到这一页的数据：' + ((snap && snap.error) || '插件可能没在跑'));
      main.appendChild(hint);
      return;
    }
    var S = snap.settings || {};
    var st = snap.status || {};

    // ── 标题 + 总开关 ─────────────────────────────────
    var head = el('div');
    head.style.marginBottom = '12px';
    var h = el('div');
    h.style.display = 'flex';
    h.style.alignItems = 'center';
    h.style.gap = '10px';
    var ttl = el('div', null, '刷视频 / 上网 · 她自己的内容流和浏览器');
    ttl.style.fontWeight = '600';
    ttl.style.fontSize = '15px';
    h.appendChild(ttl);
    var pill = el('span', 'fs-pill' + (snap.enabled ? ' on' : ''), snap.enabled ? '已启用' : '已停用');
    h.appendChild(pill);
    var pill2 = el('span', 'fs-pill' + (snap.browser && snap.browser.available ? ' on' : ''), snap.browser && snap.browser.available ? '内部浏览器就绪' : '内部浏览器不可用');
    h.appendChild(pill2);
    head.appendChild(h);
    head.appendChild(el('div', 'fs-hint', '改完点「保存」即可生效（热重载，不用重启应用）。这一页的数据来自插件快照，'
      + '账号的 Cookie 值不会出现在这里。'));
    main.appendChild(head);

    var c0 = card('总开关与手动操作', true);
    var row0 = el('div', 'fs-row');
    var lab0 = el('div', 'fs-label');
    lab0.appendChild(document.createTextNode('启用「刷视频 / 上网」'));
    lab0.appendChild(el('small', null, '关掉后定时器不启动、工具下线、一句话都不会主动发。'));
    row0.appendChild(lab0);
    var wrap0 = el('div', 'fs-input');
    var en = boolInput('__enabled', snap.enabled);
    wrap0.appendChild(en);
    row0.appendChild(wrap0);
    c0.body.appendChild(row0);
    var bar0 = el('div', 'fs-btns');
    var bSave0 = el('button', 'fs-btn primary', '保存总开关');
    bSave0.addEventListener('click', function () { save({ enabled: en.checked }); });
    bar0.appendChild(bSave0);

    var bScroll = el('button', 'fs-btn', '立刻刷一轮');
    bScroll.addEventListener('click', function () { sendCmd('scroll'); });
    bar0.appendChild(bScroll);
    var bSurf = el('button', 'fs-btn', '上网逛逛');
    bSurf.addEventListener('click', function () { sendCmd('surf'); });
    bar0.appendChild(bSurf);
    var bSpeak = el('button', 'fs-btn', '现在就挑一句发出去');
    bSpeak.addEventListener('click', function () { sendCmd('speak'); });
    bar0.appendChild(bSpeak);
    var bLink = el('button', 'fs-btn primary', '把最后刷到的那条链接发给我');
    bLink.addEventListener('click', function () { sendCmd('send_link', { index: 1 }); });
    bar0.appendChild(bLink);
    var bRefresh = el('button', 'fs-btn', '刷新这一页');
    bRefresh.addEventListener('click', function () { load(true); });
    bar0.appendChild(bRefresh);
    c0.body.appendChild(bar0);

    var urlRow = el('div', 'fs-row');
    var urlLab = el('div', 'fs-label');
    urlLab.appendChild(document.createTextNode('让她看某个网址'));
    urlLab.appendChild(el('small', null, '用她的内部浏览器真打开（带她的登录态），读正文 + 截图，然后说出看到什么。'));
    urlRow.appendChild(urlLab);
    var urlWrap = el('div', 'fs-input');
    var urlIn = el('input');
    urlIn.type = 'text';
    urlIn.placeholder = 'https://…';
    urlWrap.appendChild(urlIn);
    var urlBtns = el('div', 'fs-btns');
    var bBrowse = el('button', 'fs-btn primary', '打开看看');
    bBrowse.addEventListener('click', function () {
      var u = urlIn.value.trim();
      if (!u) { toast('先填个网址', false); return; }
      sendCmd('browse', { url: u });
    });
    urlBtns.appendChild(bBrowse);
    var bTest = el('button', 'fs-btn', '只测浏览器（不让她说话）');
    bTest.addEventListener('click', function () {
      sendCmd('test_browser', { url: urlIn.value.trim() || 'https://example.com/' });
    });
    urlBtns.appendChild(bTest);
    var bPlay = el('button', 'fs-btn', '真播一会儿（会进 B站 观看历史）');
    bPlay.addEventListener('click', function () {
      var u = urlIn.value.trim();
      if (!u) { toast('先填个视频页网址（比如 https://www.bilibili.com/video/BV…）', false); return; }
      sendCmd('play_video', { url: u });
    });
    urlBtns.appendChild(bPlay);
    var bHist = el('button', 'fs-btn', '查 B站 观看历史（核实她真看了没）');
    bHist.addEventListener('click', function () { sendCmd('bili_history'); });
    urlBtns.appendChild(bHist);
    urlWrap.appendChild(urlBtns);
    urlWrap.appendChild(el('div', 'fs-hint',
      '「真播一会儿」会打开视频页、把播放器播起来十几秒，然后关窗补报进度 —— 这样 B站 的观看历史里才会有这条。'
      + '只「打开看看」不算看过：抽帧那条路是接口 + CDN 直下，浏览器没打开过视频页，不会留下播放痕迹。'));
    urlRow.appendChild(urlWrap);
    c0.body.appendChild(urlRow);
    main.appendChild(c0.node);

    // ── 👤 主人账号（第一张卡：QQ 号 + B站 UID）─────────────────
    var cWho = card('👤 主人账号（识别我 / 要 @ 的人）', true);
    var w0 = (snap.status && snap.status.owner) || {};
    var wBox = el('div', 'fs-kv');
    wBox.appendChild(el('b', null, '现在认成谁'));
    wBox.appendChild(el('span', null,
      'QQ ' + (w0.qq || '（还没识别到）')
      + '｜来源：' + (w0.source || '未知')
      + '｜自动识别到：' + ((w0.detected && w0.detected.length) ? w0.detected.join('、') : '无')));
    cWho.body.appendChild(wBox);
    var bBox = el('div', 'fs-kv');
    bBox.appendChild(el('b', null, 'B站 @ 的对象'));
    bBox.appendChild(el('span', null,
      'UID ' + (snap.status.biliAtUid || '（没填）')
      + ' → 昵称：' + (snap.status.biliAtNick || '（还没认出来，点下面按钮认一次）')
      + '｜她自己这个号的昵称：' + (snap.status.biliNick || '（未登录或没认出来）')));
    cWho.body.appendChild(bBox);
    cWho.body.appendChild(field('🆕 主人 QQ 号（识别 / 指定主人 ID）',
      '留空 = 自动从其它插件配置里识别（上面那行就是识别结果）。填了就以此为准：私聊目标、@ 的对象都用它。'
      + '**@ 错人比不 @ 更糟**，填之前先对照上面那行。',
      textInput('ownerQQ', S.ownerQQ, '留空 = 自动识别')));
    cWho.body.appendChild(field('🆕 我的 B站 UID（评论区要 @ 的人）',
      '填你的 B站 纯数字 UID（例如 477537983）。B站 的 @ 只认**昵称**，所以插件拿 UID 去查昵称，'
      + '评论里写成 `@昵称`。查出来会显示在上面那行；查不出来时可以手填昵称兜底（在下面的评论卡里）。',
      textInput('biliAtUid', S.biliAtUid, '例：477537983')));
    var whoBtns = el('div', 'fs-btns');
    var bAtN = el('button', 'fs-btn', '认一次 B站 昵称');
    bAtN.addEventListener('click', function () { sendCmd('bili_at_probe', {}); });
    whoBtns.appendChild(bAtN);
    var bMine = el('button', 'fs-btn', '认一下她这个号的昵称');
    bMine.addEventListener('click', function () { sendCmd('bili_whoami', {}); });
    whoBtns.appendChild(bMine);
    var bOwner = el('button', 'fs-btn', '重新识别主人 QQ');
    bOwner.addEventListener('click', function () { sendCmd('refresh', {}); });
    whoBtns.appendChild(bOwner);
    cWho.body.appendChild(whoBtns);
    cWho.body.appendChild(field('@ 的时候把昵称绑到 UID（强烈建议开）',
      '开（默认）：发评论时把「昵称 → UID」映射（B站 的 at_name_to_mid）一起交给 B站，@ 一定点到你那个 UID，'
      + '不靠服务端猜名字。关掉就只写 @昵称 纯文本 —— 名字差一个字、或者有人跟你同名，@ 就白发了。',
      boolInput('biliAtBindUid', S.biliAtBindUid)));
    cWho.body.appendChild(saveBar());
    main.appendChild(cWho.node);

    // ── 她的账号 ─────────────────────────────────────
    var c1 = card('她的账号（登录态给内部浏览器用）', true);
    var sites = (snap.accounts && snap.accounts.sites) || [];
    if (sites.length) {
      var tbl = el('div', 'fs-list');
      sites.forEach(function (s) {
        var node = el('div', 'fs-item');
        var head2 = el('div');
        head2.appendChild(el('span', 'fs-tag', s.source));
        head2.appendChild(el('span', 't', s.name + '（' + s.host + '）'));
        node.appendChild(head2);
        node.appendChild(el('div', 'm', s.cookiePairs ? ('账号簿里 ' + s.cookiePairs + ' 条 cookie · ' + s.updatedText + ' 更新')
          : ('登录态在浏览器里 · ' + s.updatedText + ' 更新')));
        var btns = el('div', 'fs-btns');
        var b1 = el('button', 'fs-btn', '重新登录');
        b1.addEventListener('click', function () { sendCmd('open_account', { host: s.host }); });
        btns.appendChild(b1);
        var b2 = el('button', 'fs-btn', '清掉这个站的 cookie');
        b2.addEventListener('click', function () { sendCmd('clear_cookies', { host: s.host }); });
        btns.appendChild(b2);
        var b3 = el('button', 'fs-btn warn', '从账号簿删掉');
        b3.addEventListener('click', function () { sendCmd('forget_account', { host: s.host }); });
        btns.appendChild(b3);
        node.appendChild(btns);
        tbl.appendChild(node);
      });
      c1.body.appendChild(tbl);
    } else {
      c1.body.appendChild(el('div', 'fs-hint', '账号簿还是空的。两种加法，选一个：'));
    }

    var pasteRow = el('div', 'fs-row');
    var pasteLab = el('div', 'fs-label');
    pasteLab.appendChild(document.createTextNode('粘贴 Cookie 存进她的账号簿'));
    pasteLab.appendChild(el('small', null,
      '每一行一个站：`域名 名称 Cookie`；也可以贴 JSON 数组。'
      + '保存后不回显（页面只显示条数），也不是明文给谁看 —— 只写进本机。'
      + (snap.accounts && snap.accounts.hasPaste ? '\n（已经存过一份粘贴的账号；这里留空就等于不改它）' : '')));
    pasteRow.appendChild(pasteLab);
    var pasteWrap = el('div', 'fs-input');
    var ta = longInput('accountCookies', '', 'bilibili.com B站 SESSDATA=xxx; bili_jct=yyy\nzhihu.com 知乎 z_c0=xxx');
    pasteWrap.appendChild(ta);
    pasteWrap.appendChild(el('div', 'fs-hint', '提示：B站 / 知乎这类站的 Cookie 可以在浏览器里按 F12 → Application → Cookies 复制；'
      + '或者更省事 —— 直接用下面的「打开登录窗口」亲手登一次，登录态会自动留在她的浏览器里。'));
    pasteRow.appendChild(pasteWrap);
    c1.body.appendChild(pasteRow);

    var loginRow = el('div', 'fs-row');
    var loginLab = el('div', 'fs-label');
    loginLab.appendChild(document.createTextNode('打开登录窗口（推荐）'));
    loginLab.appendChild(el('small', null, '弹一个能操作的窗口，你亲手扫码/输密码登录一次；关掉窗口，登录态就留在她的浏览器分区里了（跨重启保留）。'));
    loginRow.appendChild(loginLab);
    var loginWrap = el('div', 'fs-input');
    var loginIn = el('input');
    loginIn.type = 'text';
    loginIn.value = 'https://www.bilibili.com/';
    loginWrap.appendChild(loginIn);
    var loginBtns = el('div', 'fs-btns');
    var bLogin = el('button', 'fs-btn primary', '打开登录窗口');
    bLogin.addEventListener('click', function () { sendCmd('open_login', { url: loginIn.value.trim() }); });
    loginBtns.appendChild(bLogin);
    var bClearAll = el('button', 'fs-btn warn', '清空她的浏览器全部登录态');
    bClearAll.addEventListener('click', function () { sendCmd('clear_cookies', { host: '' }); });
    loginBtns.appendChild(bClearAll);
    loginWrap.appendChild(loginBtns);
    loginRow.appendChild(loginWrap);
    c1.body.appendChild(loginRow);
    c1.body.appendChild(saveBar());
    main.appendChild(c1.node);

    // ── 内部浏览器 ────────────────────────────────────
    var c2 = card('内部浏览器', true);
    c2.body.appendChild(field('用内部浏览器打开网页', '关掉就只用朴素抓取（很多现代网页读不到内容，也带不了登录态）。',
      boolInput('browserEnabled', S.browserEnabled)));
    c2.body.appendChild(field('上网时把窗口显示出来', '默认后台静默不抢焦点。打开后你能看见她那个窗口在翻页。',
      boolInput('browserVisible', S.browserVisible)));
    c2.body.appendChild(field('网页也截图给她看', '比纯文字准得多；代价是每页多一张图的 token。',
      boolInput('browserShot', S.browserShot)));
    c2.body.appendChild(field('浏览器 UA', '一般不用改。留空 = 默认 Chrome。',
      textInput('browserUa', S.browserUa, '留空 = 默认')));
    c2.body.appendChild(field('打开网页超时（秒）', '卡住的站在这个时间后放弃，不拖住整轮。',
      numInput('browserTimeoutSec', S.browserTimeoutSec, 5, 5, 120)));
    c2.body.appendChild(field('每页最多读多少字', '正文按这个上限截断。',
      numInput('browserMaxChars', S.browserMaxChars, 500, 500, 20000)));
    c2.body.appendChild(saveBar());
    main.appendChild(c2.node);

    // ── 上网 ─────────────────────────────────────────
    var c3 = card('上网', true);
    c3.body.appendChild(field('允许她自己上网', '开着的时候，有些轮次她会不刷视频、改成上网逛一圈。',
      boolInput('surfEnabled', S.surfEnabled)));
    c3.body.appendChild(field('一轮改成上网的概率', '默认 0.35。调大 = 更常上网，调 0 = 只在有人叫她时上网。',
      numInput('surfChance', S.surfChance, 0.05, 0, 1)));
    c3.body.appendChild(field('每天最多上网几次', '硬上限，到量就只刷内容不联网。',
      numInput('dailySurfCap', S.dailySurfCap, 1, 0, 200)));
    c3.body.appendChild(field('她爱去的地方（一行一个）', '留空用内置清单：百度热搜 / B站排行榜 / 贴吧热议 / 腾讯新闻（这几个实测这台机器打得开）。',
      longInput('surfSites', S.surfSites, 'https://top.baidu.com/board?tab=realtime\nhttps://www.bilibili.com/ranking')));
    c3.body.appendChild(saveBar());
    main.appendChild(c3.node);

    // ── 刷内容 ───────────────────────────────────────
    var c4 = card('刷视频 / 刷帖子');
    c4.body.appendChild(field('刷哪些源', 'bilibili / hot（网上热帖）/ qzone（好友空间动态）',
      textInput('sources', S.sources)));
    c4.body.appendChild(field('每轮最少 / 最多看几条', '在两者之间随机。', (function () {
      var d = el('div');
      d.style.display = 'flex';
      d.style.gap = '8px';
      d.appendChild(numInput('watchMin', S.watchMin, 1, 1, 8));
      d.appendChild(numInput('watchMax', S.watchMax, 1, 1, 12));
      return d;
    })()));
    c4.body.appendChild(field('隔多久一轮（分钟，区间随机）', '写法 50-140。',
      textInput('intervalRange', S.intervalRange)));
    c4.body.appendChild(field('静默时段', 'HH:MM-HH:MM，这段时间不刷不上网也不发。留空 = 不限制。',
      textInput('quietRange', S.quietRange)));
    c4.body.appendChild(field('每天最多看几条', '硬上限。',
      numInput('dailyWatchCap', S.dailyWatchCap, 1, 1, 300)));
    c4.body.appendChild(field('真看画面（下载 + 抽帧）', '关掉只看封面和标题简介，更省钱。',
      boolInput('tryFrames', S.tryFrames)));
    c4.body.appendChild(field('每条视频抽几帧', '每帧都算图片 token。',
      numInput('maxFrames', S.maxFrames, 1, 1, 8)));
    c4.body.appendChild(field('为抽帧最多下载多少 MB', '超过就不下，退回看封面。',
      numInput('frameMaxMB', S.frameMaxMB, 1, 1, 60)));
    c4.body.appendChild(field('B站视频在浏览器里真播几秒（0 = 不播）',
      '默认 20。设成 15~30 后，刷到的 B站 视频会先用她的浏览器打开视频页真播这么多秒，再去抽帧 —— '
      + '这样你 B站 账号的观看历史里就能看到她看过的视频（不设就只抽帧，B站 历史里不会有任何记录）。',
      numInput('biliPlaySeconds', S.biliPlaySeconds, 1, 0, 120)));
    c4.body.appendChild(field('B站热门翻几页', '默认 3 页（每页 20 条 = 60 条候选）。'
      + '只翻第一页的话，一天刷十几条之后这个源当天就没新内容了，后面每轮只剩热帖。',
      numInput('biliPages', S.biliPages, 1, 1, 5)));
    c4.body.appendChild(field('全新内容刷完后，多久能重刷旧的（小时）',
      '默认 8。热门列表刷完之后，只有超过这个小时数的旧内容才会被重新拿出来刷（B站 历史才会继续动）。',
      numInput('reseenHours', S.reseenHours, 1, 1, 168)));
    c4.body.appendChild(saveBar());
    main.appendChild(c4.node);

    // ── 主动说话 ─────────────────────────────────────
    var c5 = card('主动说话（会真的发消息）');
    c5.body.appendChild(field('刷完可以主动说出来', '关掉就只刷不说（内容仍会进上下文）。',
      boolInput('speakEnabled', S.speakEnabled)));
    c5.body.appendChild(field('开口的概率', '默认 0.4。',
      numInput('speakChance', S.speakChance, 0.05, 0, 1)));
    c5.body.appendChild(field('说给谁（留空 = 主人私聊）', 'private:123456 或 group:987654。',
      textInput('speakTargets', S.speakTargets, '留空 = 主人私聊')));
    c5.body.appendChild(field('一次发几条', '多条之间随机停 1.2~4.6 秒，像在打字。',
      textInput('speakMessages', S.speakMessages)));
    c5.body.appendChild(field('一条最多多少字', '别变成小作文。',
      numInput('speakMaxChars', S.speakMaxChars, 5, 10, 300)));
    c5.body.appendChild(field('🆕 刷到有意思的就把链接也发给她',
      '开（默认）：她自己判断"这条值得你也看看"（十条里大概三条）时，会**单独补一条消息发链接**给你，'
      + '不用你自己复制。链接会去尾巴（spm_id_from / vd_source 之类）。',
      boolInput('sendLinks', S.sendLinks)));
    c5.body.appendChild(field('🆕 她觉得值得 → 真发链接的概率',
      '默认 0.8。留 0.2 的念想，不然每次都甩链接太机械。',
      numInput('linkChanceShare', S.linkChanceShare, 0.05, 0, 1)));
    c5.body.appendChild(field('🆕 她觉得一般 → 顺手也发链接的概率',
      '默认 0.15。设 0 = 只有她判定"值得"时才发链接。',
      numInput('linkChance', S.linkChance, 0.05, 0, 1)));
    c5.body.appendChild(field('🆕 发链接时偶尔带一句引子',
      '开：约 35% 的链接前面带一句「你看看这个」这类话；关：只发光链接。',
      boolInput('linkLeadIn', S.linkLeadIn)));
    c5.body.appendChild(field('每天最多说几次', '硬上限。',
      numInput('dailySpeakCap', S.dailySpeakCap, 1, 0, 50)));
    c5.body.appendChild(field('两次之间至少隔多久（分钟）',
      '防止连着几条全是「我刚刷到一个」。',
      numInput('speakCooldownMin', S.speakCooldownMin, 5, 0, 1440)));
    c5.body.appendChild(field('对方刚说过话多久内不主动（分钟）', '正在聊天时不另起话头。（你手动点按钮时这条让路）',
      numInput('replyGuardMinutes', S.replyGuardMinutes, 5, 0, 240)));

    /* ── 🆕 有趣的视频 → 评论区总结 + @我（她真正要的那条路）────── */
var cAct = card('🆕 有意思的视频：只做一件事（不要一次发好几条）', true);
    cAct.body.appendChild(field('一条有意思的视频只做一件事',
      '开（默认）：同一条视频只挑**一件**做 —— ①把链接发给你 ②去视频评论区发总结+@我。'
      + '关掉 = 旧行为（能发的都发，你会一次收到好几条）。手动点按钮不受限制。',
      boolInput('shareOneAction', S.shareOneAction)));
    cAct.body.appendChild(field('只做哪一件（随机 / 链接 / 评论区）',
      '现在只有两件事：①把链接发给你 ②去视频评论区发总结 + @我（QQ 里发总结那条路已按你的要求删除）。'
      + '填「随机」就在这两件里随机挑；也可以钉死成「链接」或「评论区」只做那一件。',
      textInput('shareActionPref', S.shareActionPref, '随机 / 链接 / 评论区')));
    cAct.body.appendChild(field('表情包总开关', '关掉就完全不发表情。',
      boolInput('emojiEnabled', S.emojiEnabled)));
    cAct.body.appendChild(field('@ 的时候配个表情包',
      '开（默认）：QQ 里 @你 时后面跟一个表情；B站 评论 @你 时末尾带一个官方表情（渲染出来是表情图）。',
      boolInput('emojiWithAt', S.emojiWithAt)));
    cAct.body.appendChild(field('QQ 表情包图片（可留空）',
      '填图片路径或 http 地址就走 image 段发真表情包；**留空就用 QQ 自带表情**（下面那串 id 里随机挑一个）。',
      textInput('emojiImage', S.emojiImage, '留空 = 用 QQ 自带表情')));
    cAct.body.appendChild(field('QQ 自带表情 id', '逗号分隔，默认 178,182,21,76,14。',
      textInput('emojiFaces', S.emojiFaces, '178,182,21,76,14')));
    cAct.body.appendChild(field('B站 评论里带表情（默认关）',
      '默认关：实测带 [打call]/[给心心] 这类 token 的评论更容易被 B站 压审核（state=17，只有她自己看得见、@ 也不通知），'
      + '不带表情的短句直接公开（state=0）。想试可以打开。',
      boolInput('emojiBiliUse', S.emojiBiliUse)));
    cAct.body.appendChild(field('B站 评论用的表情 token',
      '逗号分隔的 B站 官方表情名，默认 [doge],[笑],[打call]… 评论里写 token，B站 会渲成表情图。',
      textInput('emojiBili', S.emojiBili, '[doge],[笑]')));
    cAct.body.appendChild(saveBar());
    main.appendChild(cAct.node);

    var c7 = card('🆕 她觉得有趣的视频 → 去视频评论区发总结并 @我');
    c7.body.appendChild(el('div', 'fs-note',
      '这条是**在 B站 视频的评论区**留言（不是 QQ 里）。用的是你的登录态，'
      + '所以评论区显示的是**你的名字**，@ 也是 @ 你自己的 B站 昵称（自 @，主要是留个记号）。'));
    c7.body.appendChild(field('🆕 她觉得有趣的视频 → 评论区发总结并 @我',
      '开（默认）：她判定某条 B站 视频"值得你也看看"时，去这条视频的评论区发一条：@昵称 + 她真看到的 + 她的感觉。'
      + '发完会**回读评论区确认**那条在不在（日志里写「回读看到了/没看到」）。',
      boolInput('biliComment', S.biliComment)));
    c7.body.appendChild(field('🆕 评论里 @ 我', '开：评论开头加「@昵称 」。B站 的 @ 认昵称，不认 QQ 号。',
      boolInput('biliCommentMention', S.biliCommentMention)));
    c7.body.appendChild(field('🆕 只在她感兴趣的视频下评论',
      '开（默认）：只有她判定这条有意思、并说出了理由，才去评论区。关掉 = 刷到 B站 视频就可能评论（容易变刷屏）。',
      boolInput('biliCommentOnlyInteresting', S.biliCommentOnlyInteresting)));
    c7.body.appendChild(field('两条评论之间至少隔多少分钟',
      '默认 45。连着发的评论会被 B站 全部压审核（state=17：只有她自己看得见、@ 的通知也不发）。'
      + '想更稳就调到 90~180，一天 1~2 条。',
      numInput('commentMinGapMinutes', S.commentMinGapMinutes, 5, 0, 1440)));
    c7.body.appendChild(field('🆕 短评最多多少字（不含 @）',
      '默认 24。实测 20 字左右的一句人话直接公开（state=0）；40 字带细节/日期的会被压审核（state=17，你自己也看不见）。',
      numInput('biliCommentShortChars', S.biliCommentShortChars, 1, 8, 60)));
    c7.body.appendChild(field('🆕 短评模式（更容易过审）',
      '开 = 只写一句像人随手留的话；关 = 写「看完了：<详细画面> 我觉得<感想>」的长总结。'
      + '**实测**：长文 + 一堆标点引号的评论，加上 @，B站 会先压审核 —— 审核期间只有她自己看得见，'
      + '@ 的通知也不会发（公开列表里翻不到，state=17）。短评更容易直接公开。',
      textInput('biliCommentShort', S.biliCommentShort === false ? 'false' : 'true', 'true / false')));
    var pendBox = el('div', 'fs-kv');
    pendBox.appendChild(el('b', null, '发出去的评论过审情况'));
    var pend = snap.status.pendingComments || [];
    pendBox.appendChild(el('span', null, pend.length
      ? pend.map(function (p) { return p.bvid + '（state=' + p.state + '）'; }).join('、')
      : '（没有在盯的）'));
    c7.body.appendChild(pendBox);
    var bar7c = el('div', 'fs-btns');
    var bSt = el('button', 'fs-btn', '看我发出去的评论过审了吗');
    bSt.addEventListener('click', function () { sendCmd('comment_states', {}); });
    bar7c.appendChild(bSt);
    c7.body.appendChild(bar7c);
    c7.body.appendChild(field('🆕 @ 谁（B站 昵称）',
      '填你 B站 账号的昵称（评论里会写 @昵称）。留空 = 不 @。**B站 的 @ 认昵称不认 UID**，'
      + '所以优先填下面那个 UID，让插件自己去查昵称。',
      textInput('biliCommentAt', S.biliCommentAt, '留空 = 用下面的 UID 查')));
    
    var atBox = el('div', 'fs-kv');
    atBox.appendChild(el('b', null, '现在 @ 谁'));
    atBox.appendChild(el('span', null,
      'UID ' + (snap.status.biliAtUid || '（没填）')
      + ' → 认到昵称：' + (snap.status.biliAtNick || '（还没认出来，点下面的按钮认一次）')
      + '｜她自己这个账号的昵称：' + (snap.status.biliNick || '（未登录或没认出来）')));
    c7.body.appendChild(atBox);
    var bar7b = el('div', 'fs-btns');
    var bAt = el('button', 'fs-btn', '认一次 @ 对象的昵称');
    bAt.addEventListener('click', function () { sendCmd('bili_at_probe', {}); });
    bar7b.appendChild(bAt);
    var bWho = el('button', 'fs-btn', '认一下我自己的 B站 昵称');
    bWho.addEventListener('click', function () { sendCmd('bili_whoami', {}); });
    bar7b.appendChild(bWho);
    c7.body.appendChild(bar7b);
    c7.body.appendChild(field('🆕 评论最多多少字', '默认 220。',
      numInput('biliCommentChars', S.biliCommentChars, 10, 20, 1000)));
    c7.body.appendChild(field('🆕 她觉得有趣 → 真去评论的概率', '默认 0.6（评论比发消息显眼，默认更克制）。',
      numInput('biliCommentChance', S.biliCommentChance, 0.05, 0, 1)));
    c7.body.appendChild(field('🆕 每天最多评论几条', '默认 3，硬上限（手动点按钮不受限制）。',
      numInput('dailyCommentCap', S.dailyCommentCap, 1, 0, 50)));
    c7.body.appendChild(field('🆕 评论模板（可留空）',
      '留空 = 自动写成「@昵称 看完了：<她看到的> 我觉得<她的感觉>」。占位符：{at} {title} {saw} {why} {url}',
      textInput('biliCommentText', S.biliCommentText, '留空 = 自动生成')));
    var bar7 = el('div', 'fs-btns');
    var bCmt = el('button', 'fs-btn primary', '去最新那条视频的评论区发总结 + @我');
    bCmt.addEventListener('click', function () { sendCmd('comment_video', { index: 1 }); });
    bar7.appendChild(bCmt);
    var bCmtOpen = el('button', 'fs-btn', '打开 B站 看看评论区');
    bCmtOpen.addEventListener('click', function () { sendCmd('bili_history', {}); });
    bar7.appendChild(bCmtOpen);
    c7.body.appendChild(bar7);
    var cmtState = el('div', 'fs-kv');
    cmtState.appendChild(el('b', null, '评论区状态'));
    cmtState.appendChild(el('span', null,
      '已登录态评论过 ' + (snap.status.commentedCount || 0) + ' 条视频｜今天 ' + (snap.status.commentedToday || 0)
      + '/' + (snap.status.commentCap || 0) + ' 条'
      + (snap.status.lastCommentText ? '｜上次 ' + snap.status.lastCommentText : '')));
    c7.body.appendChild(cmtState);

    // 评论区这张卡挂上去。c6（QQ 里发总结 + @你）已按你的要求整块删除，
    // 所以这里只剩 c7 —— 而且必须在 c7 构造完之后才 append（早用会是 undefined）。
    main.appendChild(c7.node);
    c5.body.appendChild(field('把刚刷到的写进上下文', '关掉后只有工具能查。',
      boolInput('injectRecent', S.injectRecent)));
    c5.body.appendChild(field('上下文里带几条 / 只看最近几小时', '', (function () {
      var d = el('div');
      d.style.display = 'flex';
      d.style.gap = '8px';
      d.appendChild(numInput('injectMaxItems', S.injectMaxItems, 1, 1, 8));
      d.appendChild(numInput('injectMaxHours', S.injectMaxHours, 1, 1, 72));
      return d;
    })()));
    c5.body.appendChild(saveBar());
    main.appendChild(c5.node);

    // ── 维护 ─────────────────────────────────────────
    var cMaint = card('维护');
    cMaint.body.appendChild(field('自动维护控制台页签', '关掉后不再写 ui/ 任何文件（页签要自己删）。',
      boolInput('uiExtension', S.uiExtension)));
    cMaint.body.appendChild(field('这一页多久刷新一次（秒）', '',
      numInput('refreshSeconds', S.refreshSeconds, 5, 5, 600)));
    cMaint.body.appendChild(field('观看/上网记录留几天', '用于去重和"最近看到什么"。',
      numInput('keepDays', S.keepDays, 1, 1, 60)));
    var kb = el('div', 'fs-btns');
    var bClear = el('button', 'fs-btn warn', '清空观看/上网记录');
    bClear.addEventListener('click', function () { sendCmd('clear_history'); });
    kb.appendChild(bClear);
    var bReload = el('button', 'fs-btn', '重扫插件（热重载）');
    bReload.addEventListener('click', function () {
      fetch('/api/skills/reload', { method: 'POST' }).then(function () { toast('已触发重扫'); load(true); });
    });
    kb.appendChild(bReload);
    cMaint.body.appendChild(kb);
    cMaint.body.appendChild(el('div', 'fs-hint',
      '存档：' + (st.store || '') + '\n账号簿：' + (st.accountsFile || '') + '\n'
      + '页面脚本：ui/' + ID + '/ui.js；数据：ui/' + ID + '/state.json；注入前备份：ui/index.html.' + ID + '.bak'));
    cMaint.body.appendChild(saveBar());
    main.appendChild(cMaint.node);

    var toastNode = el('div', 'fs-toast');
    toastNode.id = 'fs-toast';
    main.appendChild(toastNode);
  }

  /* ── 重绘节流：数据没变不重建；正在输入时不打断；重建后恢复滚动 ── */
  var lastSnapKey = '';
  var changed = false;
  var pendingRender = false;
  var CMP_KEYS = ['ok', 'error', 'enabled', 'status', 'settings', 'accounts', 'browser', 'recent', 'ui', 'cmd'];
  function snapshotKey(j) {
    try {
      var c = {};
      CMP_KEYS.forEach(function (k) { if (j && Object.prototype.hasOwnProperty.call(j, k)) c[k] = j[k]; });
      return JSON.stringify(c);
    } catch (e) { return ''; }
  }
  function isEditing() {
    var ae = document.activeElement;
    return !!(ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
  }
  function saveScrolls() {
    var o = { side: 0, main: 0, lists: [] };
    var s = $(ID + '-side'); if (s) o.side = s.scrollTop;
    var m = $(ID + '-main'); if (m) o.main = m.scrollTop;
    var lists = document.querySelectorAll('#' + ID + '-side .fs-list, #' + ID + '-main .fs-list');
    for (var i = 0; i < lists.length; i++) o.lists.push(lists[i].scrollTop);
    return o;
  }
  function restoreScrolls(o) {
    if (!o) return;
    var s = $(ID + '-side'); if (s) s.scrollTop = o.side || 0;
    var m = $(ID + '-main'); if (m) m.scrollTop = o.main || 0;
    var lists = document.querySelectorAll('#' + ID + '-side .fs-list, #' + ID + '-main .fs-list');
    for (var i = 0; i < lists.length && i < (o.lists || []).length; i++) lists[i].scrollTop = o.lists[i];
  }
  function repaintIfNeeded() {
    if (!changed) return;
    if (isEditing()) { pendingRender = true; return; }
    changed = false;
    pendingRender = false;
    var sc = saveScrolls();
    renderSide();
    renderMain();
    restoreScrolls(sc);
  }

  /* ── 数据加载 ─────────────────────────────────────── */
  function load(force) {
    return fetch(SNAP_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { var ck = snapshotKey(j); changed = ck !== lastSnapKey; lastSnapKey = ck; snap = j; })
      .catch(function (e) { snap = { ok: false, error: (e && e.message) || String(e) }; changed = true; })
      .then(function () {
        repaintIfNeeded();
        if (force && snap && snap.ok) toast('已刷新');
        schedulePoll();
      });
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    var sec = (snap && snap.settings && Number(snap.settings.refreshSeconds)) || 20;
    pollTimer = setTimeout(function () { load(false); }, Math.max(5, sec) * 1000);
  }

  var listenerBound = false;
  function start() {
    var view = $(ID + '-view') || $('view-' + ID);
    if (!view) return;                       // 页面没被注入（index.html 没打上补丁）
    injectStyle();
    load(true);
    // 切到这个页签时立刻刷新一次（别的页签挂着时不浪费请求）
    if (!listenerBound) {
      var tab = document.querySelector('.tab[data-tab="' + ID + '"]');
      if (tab) {
        listenerBound = true;
        tab.addEventListener('click', function () { load(false); });
      }
      document.addEventListener('focusout', function () {
        setTimeout(function () {
          if (pendingRender && !isEditing()) { changed = true; repaintIfNeeded(); }
        }, 80);
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  // 宿主是 SPA：页签切来切去都是同一个 DOM，脚本只跑一次；这里再兜一次"页面被重建"
  setInterval(function () { if (!$(ID + '-side')) start(); }, 4000);
})();
