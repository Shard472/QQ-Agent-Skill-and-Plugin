/**
 * 她的房间 · 控制台页签
 * ═══════════════════════════════════════════════════════════════════════════
 * 页签里现在有四块，从上到下：
 *   ① 屋里现在怎么样 —— 不用进 3D 也能看：几点、什么天、她这会儿在干嘛、
 *      桌上贴了什么、抽屉里最新的一条
 *   ② 一张房间预览图，点它（或上面那颗按钮）才真的加载 3D
 *   ③ 场景快捷键：按现在 / 白天 / 黄昏 / 夜里 / 下雨，点了不用重开页面
 *   ④ 「记住：每次进这个页签自动打开」+ 同步 / 浏览器打开 / 关掉房间
 *
 * ⚠️ 为什么不一进去就加载 3D：
 *   房间是 Three.js 的 WebGL 场景，塞在控制台的 iframe 里跑 —— 控制台整个
 *   关了硬件加速（`app.disableHardwareAcceleration()`），只剩 SwiftShader
 *   软件渲染，全画质会把渲染进程拖到没响应（表现是页签全黑、几秒后整个
 *   QQ Agent 重启）。所以：默认只给预览图，点了才建 iframe，而且**一律带
 *   ?low=1**（关阴影、关后期、不按高分屏放大）。要完整光影就点「用默认
 *   浏览器打开」，那边有真 GPU。
 *
 * 房间本体不在这里改 —— 换屋里摆的东西去改 data/her-room/site/world-data.js。
 * ═══════════════════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  var TAB = 'her-room';
  // 入口形式：false = 不在顶部页签栏放按钮，改用页面右下角常驻小图标（默认）
  //          true  = 跟以前一样，在顶部页签栏插一颗「她的房间」
  var SHOW_TAB = true;   // 改成顶部页签（原版是右下角小图标，容易找不到）
  var API = '/api/skills/' + TAB + '/action/';
  var BOOT_URL = '/her-room/boot.json';
  var WORLD_URL = '/her-room/world-data.js';

  var LS_TRY = 'her-room.opening';    // 正在加载房间（房间活下来后会清掉）
  var LS_CRASH = 'her-room.crashed';  // 上次加载房间之后页面没能活下来
  var LS_AUTO = 'her-room.auto';      // 用户勾选了「每次进页签自动打开」

  var state = { boot: null, mounted: false, frame: null, world: null, shown: false };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { /* 隐私模式下 localStorage 不可用，忽略 */ }
    return null;
  }

  function toast(msg, bad) {
    var t = el('div', {
      style: 'position:fixed;right:20px;bottom:20px;z-index:9999;padding:10px 14px;border-radius:8px;font-size:13px;max-width:70vw;'
        + 'background:' + (bad ? '#c0392b' : '#2d8659') + ';color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25)'
    }, [msg]);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, bad ? 4200 : 2200);
  }

  async function call(op, payload) {
    var res = await fetch(API + op, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  /* ── 时间：房间里的 log 存的是 UTC，房间按 +8 换回北京时间 ───────────────── */
  function localHour(d) {
    d = d || new Date();
    var h = d.getUTCHours() + d.getUTCMinutes() / 60 + 8;
    return ((h % 24) + 24) % 24;
  }

  function hhmm(h) {
    var H = Math.floor(h), M = Math.floor((h - H) * 60);
    return (H < 10 ? '0' : '') + H + ':' + (M < 10 ? '0' : '') + M;
  }

  /** 跟房间同一套规则：挑一条离当前钟点最近（1.2 小时内）的 log */
  function pickLog(world, h) {
    var logs = (world && world.log) || [];
    var best = null, bd = 99;
    logs.forEach(function (it) {
      var t = new Date(it.at);
      if (isNaN(t)) return;
      var lh = localHour(t);
      var d = Math.abs(lh - h);
      if (d > 12) d = 24 - d;          // 环形：23 点和 0 点只差 1 小时
      if (d < bd) { bd = d; best = it; }
    });
    return bd <= 1.2 ? best : null;
  }

  function latest(arr) {
    if (!arr || !arr.length) return null;
    var best = arr[0], bt = -Infinity;
    arr.forEach(function (it) {
      var t = Date.parse(it.at || '');
      if (!isNaN(t) && t > bt) { bt = t; best = it; }
    });
    return best;
  }

  /**
   * 读 world-data.js 拿屋里现在的状态。
   * 它是 `window.WORLD = {...}` 的脚本，不是 JSON —— 不塞进真正的 window，
   * 用一个假 window 当参数喂给 new Function，只把 WORLD 取出来，避免副作用。
   */
  async function loadWorld() {
    try {
      var res = await fetch(WORLD_URL + '?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return null;
      var src = await res.text();
      // 别用 new Function 去跑：控制台 CSP 没有 'unsafe-eval'，eval 系一律被拦，
      // 表现就是这里静默返回 null、状态条整块消失。好在这个文件是 JSON.stringify
      // 写出来的纯字面量，切首尾大括号之间那段 JSON.parse 就够，不执行任何代码。
      var a = src.indexOf('{');
      var b = src.lastIndexOf('}');
      if (a < 0 || b <= a) return null;
      var w = JSON.parse(src.slice(a, b + 1));
      return w && typeof w === 'object' ? w : null;
    } catch (e) { return null; }
  }

  /* ── 页签本体 ─────────────────────────────────────────────────────────── */

  /**
   * 宿主的 .view 是 flex 排布（每个页签自己定义栅格），我们这边是一列竖排的段落，
   * 所以要改成块级 + 可滚动。但**千万别写成 inline style 的 display:block** ——
   * inline 会盖掉 `.view{display:none}`，于是不管你切到哪个页签，房间那块都一直
   * 露在下面（症状就是页签里上下叠着两套内容）。这里注入一条更具体的规则，
   * 只在 .active 时显示。
   */
  function ensureStyle() {
    if (document.getElementById('her-room-style')) return;
    var st = el('style', { id: 'her-room-style' }, [
      '#view-' + TAB + '{display:none;padding:14px 16px}',
      '#view-' + TAB + '.active{display:block;overflow-y:auto;overflow-x:hidden}',
      '#her-room-entry{position:fixed;right:16px;bottom:16px;z-index:9999;padding:9px 14px;'
        + 'border-radius:99px;border:0;cursor:pointer;font-size:13px;font-weight:600;'
        + 'color:#3b3444;background:rgba(255,253,248,.92);box-shadow:0 6px 22px rgba(0,0,0,.35)}',
      '#her-room-entry:hover{background:#fff}'
    ]);
    (document.head || document.documentElement).appendChild(st);
  }

  /** 建页签：插在「存档」前面，跟其它面板保持同样的位置习惯。 */
  function ensureTab(label) {
    var nav = document.getElementById('tabs');
    if (!nav) return null;
    var btn = nav.querySelector('[data-tab="' + TAB + '"]');
    if (!btn) {
      btn = el('button', { class: 'tab', 'data-tab': TAB }, [label]);
      var anchor = nav.querySelector('[data-tab="chats"]');
      if (anchor) nav.insertBefore(btn, anchor); else nav.appendChild(btn);
      btn.addEventListener('click', function () { activate(); });
    } else {
      btn.textContent = label;
    }
    return btn;
  }

  /** 右下角常驻小图标入口（SHOW_TAB=false 时用） */
  function installEntry(label) {
    var b = document.getElementById('her-room-entry');
    if (b) return;
    b = el('button', { id: 'her-room-entry', title: label || '她的房间' }, ['🏠 ' + (label || '房间')]);
    (document.body || document.documentElement).appendChild(b);
    b.addEventListener('click', function () { activate(); });
  }

  /** 按开关决定入口放在哪 */
  function mountEntry(label) {
    if (SHOW_TAB) ensureTab(label); else installEntry(label);
  }

  function activate() {
    if (SHOW_TAB) {
      // 在页签栏里：跟宿主其它页签一样高亮对应 tab
      Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) {
        t.classList.toggle('active', t.getAttribute('data-tab') === TAB);
      });
    } else {
      // 不在页签栏：房间没有自己的 tab，所以顶部那一排不高亮任何一项
      Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) {
        t.classList.remove('active');
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.toggle('active', v.id === 'view-' + TAB);
    });
    // 勾了「自动打开」的话，第一次来到这个页签就直接把房间点起来
    if (ls(LS_AUTO) && !ls(LS_CRASH) && !state.frame && !state.shown) {
      setTimeout(function () { openRoom(false); }, 250);
    }
    state.shown = true;
  }

  /** boot.src 里通常已经带上 args 了，别重复拼一遍 */
  function roomUrl(opts) {
    opts = opts || {};
    var src = (state.boot && state.boot.src) || '/her-room/index.html';
    var args = (state.boot && state.boot.args) || '';
    if (args && src.indexOf(args) < 0) {
      src += (src.indexOf('?') >= 0 ? '&' : '?') + String(args).replace(/^\?/, '');
    }
    if (opts.extra) src += (src.indexOf('?') >= 0 ? '&' : '?') + opts.extra;
    if (opts.low) src += (src.indexOf('?') >= 0 ? '&' : '?') + 'low=1';
    return src;
  }

  /** 真的建 iframe（只在用户点过之后才走这里） */
  function openRoom(force, extra) {
  var sec = document.getElementById('view-' + TAB);
  var slot = sec && sec.querySelector('[data-slot="room"]');
  if (!slot) return;

  // 2026-10-26：内嵌 iframe 这条路彻底放弃 ——
  //   ① 宿主 CSP 会拦掉房间 index.html 里的内联 importmap，three 解析失败 → 永远白屏；
  //   ② 控制台是 SwiftShader 软件渲染，WebGL 建场景会把渲染进程拖崩。
  // 房间现在有自己的源（127.0.0.1:8892，不带 CSP），交给真浏览器打开即可。
  openInBrowser(extra || '');
  return;

if (state.frame) { state.frame.parentNode && state.frame.parentNode.removeChild(state.frame); }
    ls(LS_TRY, '1');

    var frame = el('iframe', {
      // Electron 关掉了硬件加速，这里是 SwiftShader 软件渲染：不用低画质
      // 会把这个页面拖到没响应（表现就是黑屏 + 整个控制台跟着卡）。
      src: roomUrl({ low: true, extra: extra || '' }),
      referrerpolicy: 'no-referrer',
      style: 'width:100%;height:min(72vh,700px);min-height:400px;border:0;border-radius:12px;'
        + 'background:#0b1020;display:block'
    });
    frame.addEventListener('load', function () {
      // 加载完再等一会儿：WebGL 崩通常在建场景那一下，不在 onload。
      // 顺便验一下房间到底有没有「点亮」—— 同源 iframe 能读到里头的 #boot，
      // 它没挂 .gone 就说明还卡在启动遮罩上（CSP 拦模块 / WebGL 不可用都这样）。
      setTimeout(function () {
        var stuck = false, why = '';
        try {
          var doc = frame.contentDocument;
          var boot = doc && doc.getElementById('boot');
          var msg = doc && doc.getElementById('bootmsg');
          if (boot && !boot.classList.contains('gone')) {
            stuck = true;
            why = msg ? String(msg.textContent || '').trim() : '';
          }
        } catch (e) { stuck = false; }
        ls(LS_TRY, null);
        if (stuck) {
          toast('房间没能点亮' + (why ? '（' + why + '）' : '') + '，试试「用默认浏览器打开」', true);
        }
      }, 4000);
    });
    state.frame = frame;

    slot.innerHTML = '';
    slot.appendChild(frame);

    // 房间已经占住上面那块了，预览图先收起来 —— 不然用户得往下翻才看见 3D
    var pv = sec.querySelector('[data-slot="preview"]');
    if (pv) pv.style.display = 'none';
    // 滚到房间顶部（窗口矮的时候上面那行「屋里现在」会占掉一截）
    try { slot.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { }

    var bar2 = sec.querySelector('[data-slot="after"]');
    if (bar2) {
      bar2.innerHTML = '';
      bar2.appendChild(el('span', { style: 'font-size:12px;opacity:.7' },
        ['房间已加载（低画质）。要是几秒内页面又崩了，下次会自动改用独立窗口。']));
      bar2.appendChild(mkButton('关掉房间', function () {
        frame.parentNode && frame.parentNode.removeChild(frame);
        state.frame = null;
        bar2.innerHTML = '';
        var pv2 = sec.querySelector('[data-slot="preview"]');
        if (pv2) pv2.style.display = '';
      }, 'margin-left:10px'));
    }
  }

  function mkButton(text, onClick, extraStyle) {
    var b = el('button', { class: 'btn', style: 'padding:6px 12px' + (extraStyle ? ';' + extraStyle : '') }, [text]);
    b.addEventListener('click', onClick);
    return b;
  }

  /* ── ① 屋里现在怎么样 ─────────────────────────────────────────────────── */
  function buildInfoBox() {
    var box = el('div', {
      'data-slot': 'info',
      style: 'padding:12px 14px;margin-bottom:12px;border-radius:12px;font-size:12.5px;line-height:1.9;'
        + 'background:rgba(255,253,248,.06);border:1px solid rgba(255,255,255,.08)'
    }, [el('span', { style: 'opacity:.6' }, ['正在读屋里的情况…'])]);
    refreshInfo(box);
    setInterval(function () { refreshInfo(box); }, 60000);   // 钟点变了跟着刷新
    return box;
  }

  async function refreshInfo(box) {
    if (!box) return;
    // 每次都重读：world-data.js 就十几 KB，这样改完数据「同步」之后状态条马上跟上
    var w = await loadWorld();
    state.world = w;
    if (!w) { box.innerHTML = ''; box.style.display = 'none'; return; }

    var h = localHour();
    var log = pickLog(w, h);
    var note = (w.notes || [])[0];
    var drawer = latest(w.drawer);
    var wx = w.weather || {};
    var st = w.stats || {};

    box.innerHTML = '';
    box.appendChild(el('div', { style: 'display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px' }, [
      el('b', { style: 'font-size:13.5px' }, ['屋里现在 · ' + hhmm(h)]),
      el('span', { style: 'opacity:.65' }, [
        (wx.icon ? wx.icon + ' ' : '') + (wx.label || '') +
        (wx.temp !== undefined ? '  ' + wx.temp + '°' : '')]),
      el('span', { style: 'opacity:.5;font-size:11.5px' }, [
        '第 ' + (st.days || 1) + ' 天 · 记了 ' + (st.events || 0) + ' 件事'])
    ]));

    box.appendChild(el('div', {}, [
      el('span', { style: 'opacity:.6' }, ['这会儿：']),
      log ? String(log.text) : '这会儿屋里没动静（这个时段没记东西）'
    ]));

    if (note) box.appendChild(el('div', {}, [
      el('span', { style: 'opacity:.6' }, ['桌上贴着：']), String(note.text)
    ]));

    if (drawer) box.appendChild(el('div', {}, [
      el('span', { style: 'opacity:.6' }, ['抽屉里最新：']),
      (drawer.name ? drawer.name + ' —— ' : '') + String(drawer.text)
    ]));
  }

  /* ── ② 预览图（点了才加载 3D） ─────────────────────────────────────────── */
  function buildPreview() {
    var h = localHour();
    var night = h < 6.5 || h >= 18.5;
    var img = night ? '预览-夜里.png' : '预览-白天.png';

    var card = el('div', {
      'data-slot': 'preview',
      style: 'position:relative;width:100%;max-width:760px;height:300px;border-radius:14px;overflow:hidden;cursor:pointer;'
        + 'border:1px solid rgba(255,255,255,.10);background:#14111c;margin-bottom:12px'
    });
    var pic = el('img', {
      src: '/her-room/' + encodeURIComponent(img),
      alt: '房间预览',
      style: 'width:100%;height:100%;object-fit:cover;display:block'
    });
    pic.addEventListener('error', function () {
      // 预览图没同步过来就别留个破图，直接给一句人话
      card.innerHTML = '';
      card.appendChild(el('div', {
        style: 'display:grid;place-items:center;height:100%;font-size:12.5px;opacity:.6;text-align:center;padding:20px'
      }, ['预览图还没同步过来 —— 点上面的「同步房间文件」，或者直接点这里打开房间']));
    });
    card.appendChild(pic);
    card.appendChild(el('div', {
      style: 'position:absolute;left:0;right:0;bottom:0;padding:14px;'
        + 'background:linear-gradient(transparent,rgba(10,8,15,.78));color:#f2ecf7;font-size:12.5px'
    }, [night ? '这会儿是夜里，屋里就剩台灯那一块亮着' : '白天，光从窗户那边进来']));
    card.appendChild(el('div', { style: 'position:absolute;inset:0;display:grid;place-items:center' }, [
      el('div', {
        style: 'padding:10px 18px;border-radius:99px;font-size:13px;font-weight:600;'
          + 'background:rgba(255,253,248,.94);color:#3b3444;box-shadow:0 6px 22px rgba(0,0,0,.35)'
      }, ['打开房间（浏览器）'])
    ]));
    card.addEventListener('click', function () { openRoom(false); });
    return card;
  }

  function buildView() {
    ensureStyle();
    var layout = document.getElementById('layout') || document.querySelector('main') || document.body;
    var sec = document.getElementById('view-' + TAB);
    if (sec) return sec;

    var crashed = !!ls(LS_CRASH);

    var btnOpen = mkButton('打开房间', function () { openRoom(false); });
    var btnBrowser = mkButton('用默认浏览器打开', function () { openInBrowser(); });
    var btnNewWin = mkButton('在浏览器里换场景', function () { openInBrowser(''); });
    var btnSync = mkButton('同步房间文件', function () { doSync(btnSync); });

    var slot = el('div', { 'data-slot': 'room' }, []);
    var after = el('div', { 'data-slot': 'after', style: 'margin:10px 0;display:flex;align-items:center;flex-wrap:wrap;gap:8px' }, []);

    // 场景快捷键：改 iframe 的 src 就行，不用重开页面
    var scenes = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px' }, [
      el('span', { style: 'font-size:12px;opacity:.6' }, ['场景：'])
    ]);
    [['按现在', ''], ['白天', 'h=14'], ['黄昏', 'h=19.2'], ['夜里', 'h=1'], ['下雨', 'w=rain']]
      .forEach(function (p) {
        scenes.appendChild(mkButton(p[0], function () {
          // ⚠️ 只有 3D 已经开着才换场景。原先是无条件 openRoom(force=!!state.frame)：
          // 没开过也会硬建 iframe，而控制台是软件渲染，一点「白天」整个页面就崩。
          // 内嵌已弃用：点场景就是用浏览器打开对应时间的房间
          openInBrowser(p[1]);
        }, 'padding:5px 10px;font-size:12px'));
      });

    var cbAuto = el('input', { type: 'checkbox' });
    cbAuto.checked = !!ls(LS_AUTO);
    cbAuto.addEventListener('change', function () {
      ls(LS_AUTO, cbAuto.checked ? '1' : null);
      toast(cbAuto.checked ? '记住了：以后进这个页签自动打开房间' : '关掉了自动打开');
    });

    var bar = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px' },
      [btnOpen, btnBrowser, btnNewWin, btnSync]);

    var children = [
      buildInfoBox(),
      slot,               // 房间 iframe 就挂在预览图的位置上，点开不用往下翻
      buildPreview(),
      scenes,
      bar,
      after,
      el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:12px;opacity:.75;margin-top:10px;cursor:pointer' },
        [cbAuto, '每次进这个页签都自动打开房间（软件渲染，第一次进会卡一两秒）'])
    ];

    if (crashed) {
      children.unshift(el('div', {
        style: 'padding:10px 12px;margin-bottom:10px;border-radius:8px;font-size:12.5px;line-height:1.8;'
          + 'background:rgba(192,57,43,.12);border:1px solid rgba(192,57,43,.35)'
      }, [
        el('div', { style: 'font-weight:600;margin-bottom:4px' }, ['上次打开房间之后，这个页面崩了']),
        el('div', {}, ['已经记住了：以后不再自动在本页加载房间。想看房间就点「用默认浏览器打开」'
          + '（交给真 Chrome/Edge 跑，最稳）；一定要嵌在这里就点「仍在本页打开」。']),
        el('div', { style: 'margin-top:6px' }, [
          mkButton('清除这个记忆', function () {
            ls(LS_CRASH, null);
            toast('已清除，下次可以正常在本页打开');
            setTimeout(function () { location.reload(); }, 700);
          })
        ])
      ]));
    }

    children.push(el('div', {
      style: 'font-size:12px;opacity:.7;line-height:1.7;margin-top:10px'
    }, [
      '屋里摆什么、便签写什么，都在 ',
      el('code', {}, ['data\\her-room\\site\\world-data.js']),
      ' 里 —— 改完点上面的「同步房间文件」（插件会自动盯着这个目录，改了就同步）。地址栏参数也照用：',
      el('code', {}, ['?h=19.4']), ' 锁时刻、', el('code', {}, ['?w=rain']), ' 下雨、',
      el('code', {}, ['?lamp=0']), ' 关台灯、', el('code', {}, ['?say=1']), ' 打开就说一句、',
      el('code', {}, ['?low=1']), ' 低画质。'
    ]));

    // ⚠️ 宿主的 .view.active 是 display:flex（默认 row）—— 主界面那些页签各有自己的
    // 栅格，我们这边是一列竖排的段落。不覆盖的话所有块会被当成 flex item 横着排：
    // 预览图被挤成一条竖缝、按钮一个个摞成一列、说明文字跑到右边。这里显式改回
    // 块级 + 可滚动（.view 自己是 overflow:hidden，长内容得能滚）。
    sec = el('section', {
      id: 'view-' + TAB,
      class: 'view'
    }, children);
    layout.appendChild(sec);

    // 勾选了自动打开，而且这个页签正好是默认显示的那个 → 起来就开
    if (ls(LS_AUTO) && !crashed) setTimeout(function () { openRoom(false); }, 600);
    return sec;
  }

  /* ── 动作 ─────────────────────────────────────────────────────────────── */

  /** 交给系统默认浏览器（真 Chrome/Edge），绕开 Electron 窗口的 WebGL 问题 */
  async function openInBrowser() {
    try {
      await call('openExternal', { url: location.origin + roomUrl() });
      toast('已用默认浏览器打开，去看看那个窗口');
    } catch (e) {
      toast('没打开成：' + (e && e.message ? e.message : e), true);
    }
  }

  async function doSync(btn) {
    if (btn) btn.disabled = true;
    try {
      var r = await call('sync');
      toast('同步完成：' + (r.copied || 0) + '/' + (r.total || 0) + ' 个文件有更新');
      // 不再整页刷新 —— 只刷 iframe 和上面的状态条，人不会从当前页签被弹走
      state.world = null;
      var sec = document.getElementById('view-' + TAB);
      var info = sec && sec.querySelector('[data-slot="info"]');
      if (info) { info.style.display = ''; refreshInfo(info); }
      if (state.frame) openRoom(true);
    } catch (e) {
      toast('同步失败：' + (e && e.message ? e.message : e), true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function boot() {
    try {
      var res = await fetch(BOOT_URL + '?_=' + Date.now(), { cache: 'no-store' });
      if (res.ok) state.boot = await res.json();
    } catch (e) { /* 拿不到就用默认值 */ }
    var label = (state.boot && state.boot.label) || '她的房间';

    // 上次点了「打开房间」但页面没活下来 → 记下来，这次不自动加载
    if (ls(LS_TRY)) { ls(LS_TRY, null); ls(LS_CRASH, '1'); }

    if (state.boot && state.boot.exists === false) {
      // 文件还没放：页签照样建，里面给一句怎么办，别让人对着黑框猜
      var sec = buildView();
      sec.innerHTML = '';
      sec.appendChild(el('div', {
        style: 'padding:24px;font-size:13px;line-height:1.9'
      }, [
        el('div', { style: 'font-size:15px;font-weight:600;margin-bottom:8px' }, ['房间文件还没放进来']),
        el('div', {}, ['把整个房间文件夹放到：']),
        el('code', { style: 'display:inline-block;margin:8px 0' }, ['<数据目录>\\her-room\\site\\']),
        el('div', {}, ['（至少要 index.html + src\\ + vendor\\ + world-data.js），然后点下面的同步。'])
      ]));
      var b2 = el('button', { class: 'btn', style: 'padding:6px 12px;margin-top:12px' }, ['再试一次']);
      b2.addEventListener('click', function () { location.reload(); });
      sec.appendChild(b2);
      mountEntry(label);
      state.mounted = true;
      return;
    }
    buildView();
    mountEntry(label);
    state.mounted = true;
  }

  function start() {
    if (state.mounted) return;
    boot().catch(function (e) { toast('房间页签初始化失败：' + (e && e.message ? e.message : e), true); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
