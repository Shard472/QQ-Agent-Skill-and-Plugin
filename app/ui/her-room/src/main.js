// 她的房间 · 等距 3D
// 全部程序化：几何体 + 材质 + 光，没有模型文件、没有贴图图片
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildRoom } from './room.js';
import { buildScene } from './catalog.js';

const ROOM = 9;
const WALL_H = 3.45;
const HALF = ROOM / 2;

/* ── 渲染器 ─────────────────────────────────────────────── */
// ?low=1 低画质：不开抗锯齿、不按高分屏放大、关阴影、跳过后期。
// 有的机器（尤其是被别的窗口塞进 iframe 里跑）会在建后期/阴影那一下把渲染进程拖崩，
// 这个开关就是给那种情况留的退路。
const LOW = /[?&]low=1(?:&|$)/.test(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW, alpha: true });
renderer.setPixelRatio(LOW ? 1 : Math.min(devicePixelRatio, 2));
renderer.setClearAlpha(0);
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// 背景交给页面上的渐变，房间像是摆在一张桌子上
scene.background = null;

/* ── 相机：正交 + 标准等距角 ───────────────────────────── */
const FRUST = 3.76;
let aspect = innerWidth / innerHeight;
const camera = new THREE.OrthographicCamera(-FRUST * aspect, FRUST * aspect, FRUST, -FRUST, 0.1, 120);
camera.position.set(9.5, 7.8, 9.5);
camera.lookAt(0, 1.5, 0);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minZoom = 0.75;
controls.maxZoom = 2.4;
controls.target.set(0, 1.45, 0);
controls.minAzimuthAngle = Math.PI * 0.17;
controls.maxAzimuthAngle = Math.PI * 0.33;
controls.minPolarAngle = Math.PI * 0.25;
controls.maxPolarAngle = Math.PI * 0.36;
controls.rotateSpeed = 0.55;

/* ── 光 ─────────────────────────────────────────────────── */
const hemi = new THREE.HemisphereLight(0xfff4e8, 0x8a7a66, 0.27);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff4e4, 4.2);
key.position.set(6.5, 10.5, 7.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 42;
const SS = 6.6;
Object.assign(key.shadow.camera, { left: -SS, right: SS, top: SS, bottom: -SS });
key.shadow.camera.updateProjectionMatrix();   // 改完范围必须重算，否则阴影只覆盖中间一小块
key.shadow.bias = -0.00035;
key.shadow.normalBias = 0.014;
key.shadow.radius = 2.2;
scene.add(key);
scene.add(key.target);
key.target.position.set(0, 1, 0);

const fill = new THREE.DirectionalLight(0xb9c9ee, 0.18);
fill.position.set(-7, 5, -5);
scene.add(fill);

/* ── 后期：bloom 让灯泡和窗口自己发晕（低画质时整条跳过）─── */
let composer = null;
if (!LOW) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(innerWidth * 0.5, innerHeight * 0.5), 0.38, 0.9, 0.78));
  composer.addPass(new OutputPass());
}
function draw() {
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

/* ── 房间 + 东西 ────────────────────────────────────────── */
const roomObj = buildRoom(ROOM, WALL_H);
scene.add(roomObj.group);

const WORLD = (window.WORLD && window.WORLD.place) ? window.WORLD : { items: [], notes: [] };
const S = buildScene(roomObj.group, WORLD, HALF);

let dust = null;
dust = makeDust();
scene.add(dust);

/* ── 点窗户换天气 ───────────────────────────────────────── */
if (roomObj.win) {
  const hit = new THREE.Mesh(
    new THREE.PlaneGeometry(2.05, 1.62),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hit.position.set(1.2, 2.05, -4.44);
  hit.userData.name = '窗户';
  hit.userData.action = 'weather';
  hit.userData.noLift = true;
  scene.add(hit);
  S.pickables.push(hit);
}

/* ── 天气粒子：窗外真的在下雨 / 下雪 ────────────────────── */
const weather = { mesh: null, kind: null };

function makeRain() {
  const N = 150;
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(N * 6);
  const spd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = 0.3 + Math.random() * 1.85;
    const y = 1.36 + Math.random() * 1.36;
    const z = -4.7 + Math.random() * 0.05;
    const len = 0.1 + Math.random() * 0.26;
    arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
    arr[i * 6 + 3] = x - 0.012; arr[i * 6 + 4] = y - len; arr[i * 6 + 5] = z;
    spd[i] = 3.2 + Math.random() * 2.8;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0xc4d8e8, transparent: true, opacity: 0.62, depthWrite: false,
  }));
  m.userData.spd = spd;
  m.frustumCulled = false;
  return m;
}

function makeSnow() {
  const N = 220;
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(N * 6);
  const spd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = 0.3 + Math.random() * 1.85;
    const y = 1.36 + Math.random() * 1.36;
    const z = -4.68 + Math.random() * 0.05;
    const r = 0.016 + Math.random() * 0.018;
    arr[i * 6] = x - r; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
    arr[i * 6 + 3] = x + r; arr[i * 6 + 4] = y; arr[i * 6 + 5] = z;
    spd[i] = 0.32 + Math.random() * 0.42;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0xf8fdff, transparent: true, opacity: 0.92, depthWrite: false,
  }));
  m.userData.spd = spd;
  m.frustumCulled = false;
  return m;
}

function setWeather(kind) {
  if (weather.kind === kind) return;
  weather.kind = kind;
  if (weather.mesh) {
    roomObj.outside.remove(weather.mesh);
    weather.mesh.geometry.dispose();
    weather.mesh.material.dispose();
    weather.mesh = null;
  }
  if (kind === 'rain') weather.mesh = makeRain();
  else if (kind === 'snow') weather.mesh = makeSnow();
  if (weather.mesh) roomObj.outside.add(weather.mesh);
}

function stepWeather(dt, t) {
  const m = weather.mesh;
  if (!m) return;
  const attr = m.geometry.attributes.position;
  const a = attr.array;
  const spd = m.userData.spd;
  const N = spd.length;
  if (weather.kind === 'rain') {
    for (let i = 0; i < N; i++) {
      const dy = spd[i] * dt;
      a[i * 6 + 1] -= dy; a[i * 6 + 4] -= dy;
      if (a[i * 6 + 4] < 1.38) { a[i * 6 + 1] += 1.36; a[i * 6 + 4] += 1.36; }
    }
  } else {
    for (let i = 0; i < N; i++) {
      const dy = spd[i] * dt;
      const sway = Math.sin(t * 1.2 + i) * 0.0018;
      a[i * 6 + 1] -= dy; a[i * 6 + 4] -= dy;
      a[i * 6] += sway; a[i * 6 + 3] += sway;
      if (a[i * 6 + 1] < 1.38) { a[i * 6 + 1] += 1.36; a[i * 6 + 4] += 1.36; }
    }
  }
  attr.needsUpdate = true;
}

/* ── 空气里的浮尘 ───────────────────────────────────────── */
function makeDust() {
  const N = 140;
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(N * 3);
  const spd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    arr[i * 3] = -3.6 + Math.random() * 7.4;
    arr[i * 3 + 1] = 0.25 + Math.random() * 2.9;
    arr[i * 3 + 2] = -3.8 + Math.random() * 7.2;
    spd[i] = 0.012 + Math.random() * 0.035;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const m = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xfff0d4, size: 0.022, transparent: true, opacity: 0.4,
    depthWrite: false, sizeAttenuation: true,
  }));
  m.userData.spd = spd;
  m.frustumCulled = false;
  return m;
}

/* ── 时间 / 天气 ────────────────────────────────────────── */
const KT = [
  // h   key色     key强度 hemi  天光     灯强度 背景
  { h: 0,    k: 0x9aabdc, ki: 0.40, he: 0.20, lamp: 1.30, bg: 0x14111c },
  { h: 4.5,  k: 0xa3b0dc, ki: 0.38, he: 0.20, lamp: 1.30, bg: 0x14121c },
  { h: 6,    k: 0xffc7a0, ki: 1.25, he: 0.26, lamp: 0.55, bg: 0x231d26 },
  { h: 8,    k: 0xffeacf, ki: 2.35, he: 0.30, lamp: 0.00, bg: 0x2c2833 },
  { h: 12,   k: 0xfff6ee, ki: 2.65, he: 0.32, lamp: 0.00, bg: 0x302c37 },
  { h: 16,   k: 0xffe9d8, ki: 2.40, he: 0.30, lamp: 0.00, bg: 0x2e2a35 },
  { h: 18,   k: 0xffc9a8, ki: 1.65, he: 0.26, lamp: 0.60, bg: 0x271f28 },
  { h: 19.5, k: 0xf8bd9e, ki: 1.05, he: 0.23, lamp: 1.05, bg: 0x1e1822 },
  { h: 21,   k: 0x9dabdc, ki: 0.48, he: 0.21, lamp: 1.35, bg: 0x17131e },
  { h: 24,   k: 0x9aabdc, ki: 0.40, he: 0.20, lamp: 1.30, bg: 0x14111c },
];
const cA = new THREE.Color(), cB = new THREE.Color(), cOut = new THREE.Color();

function sampleTime(h) {
  let a = KT[0], b = KT[KT.length - 1];
  for (let i = 0; i < KT.length - 1; i++) {
    if (h >= KT[i].h && h <= KT[i + 1].h) { a = KT[i]; b = KT[i + 1]; break; }
  }
  const span = b.h - a.h || 1;
  const t = Math.min(1, Math.max(0, (h - a.h) / span));
  const s = t * t * (3 - 2 * t); // smoothstep，别让颜色在整点跳
  const col = (ca, cb) => {
    cA.setHex(ca); cB.setHex(cb);
    return cOut.copy(cA).lerp(cB, s).clone();
  };
  return {
    keyColor: col(a.k, b.k),
    keyInt: a.ki + (b.ki - a.ki) * s,
    hemiInt: a.he + (b.he - a.he) * s,
    lampInt: a.lamp + (b.lamp - a.lamp) * s,
    bg: col(a.bg, b.bg),
  };
}

function localHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

function weatherOf() {
  if (state.weatherOverride && state.weatherOverride !== 'auto') return state.weatherOverride;
  const w = (window.WORLD && window.WORLD.weather) || {};
  const txt = String(w.label || w.text || '') + String(w.icon || '');
  if (/雨|rain/i.test(txt)) return 'rain';
  if (/雪|snow/i.test(txt)) return 'snow';
  if (/云|阴|cloud|overcast/i.test(txt)) return 'cloudy';
  return 'clear';
}

const state = {
  hourOverride: null,
  weatherOverride: 'auto',
  lampOverride: null,
  soundOn: false,
};

// 地址栏调试：?h=14.5&w=clear&lamp=0
const Q = new URLSearchParams(location.search);
if (Q.get('h') !== null) state.hourOverride = parseFloat(Q.get('h'));
if (Q.get('w')) state.weatherOverride = Q.get('w');
if (Q.get('lamp') === '0') state.lampOverride = false;

let appliedHour = 14;

function nightFactor(h) {
  if (h >= 20 || h <= 5) return 1;
  if (h > 18) return (h - 18) / 2;
  if (h < 6.5) return (6.5 - h) / 1.5;
  return 0;
}

function applyTime() {
  const h = state.hourOverride ?? localHour();
  appliedHour = h;
  const p = sampleTime(h);
  const wk = weatherOf();

  key.color.copy(p.keyColor);
  key.intensity = p.keyInt * (wk === 'rain' ? 0.62 : wk === 'snow' ? 0.8 : wk === 'cloudy' ? 0.84 : 1);
  hemi.intensity = p.hemiInt * (wk === 'rain' ? 1.05 : 1);
  // 傍晚让环境光偏冷：暖光 + 冷影子，才有黄昏的层次，不然整张都是橙的
  const duskness = Math.max(0, 1 - Math.abs(h - 18.4) / 2.2);
  const nightness = Math.max(0, Math.min(1, nightFactor(h)));
  const hemiTint = new THREE.Color(0xffffff).lerp(new THREE.Color(0x7f96cc),
    Math.max(duskness * 0.42, nightness * 0.3));
  hemi.color.copy(p.keyColor).lerp(hemiTint, 0.55);

  // 画面外面那圈背景：跟着时间一起变色
  const bg1 = p.bg.clone().multiplyScalar(1.7);
  const bg2 = p.bg.clone().multiplyScalar(0.95);
  const bg3 = p.bg.clone().multiplyScalar(0.5);
  const rs = document.documentElement.style;
  rs.setProperty('--bg1', '#' + bg1.getHexString());
  rs.setProperty('--bg2', '#' + bg2.getHexString());
  rs.setProperty('--bg3', '#' + bg3.getHexString());

  // 窗外
  if (roomObj.outside) {
    const o = roomObj.outside.userData;
    const night = Math.max(0, Math.min(1, nightFactor(h)));

    // 天：白天/夜里两张贴图，月亮和星星直接画在夜的那张上
    const useNight = night > 0.5;
    if (o.skyMat && o.skyMat.map !== (useNight ? o.skyNight : o.skyDay)) {
      o.skyMat.map = useNight ? o.skyNight : o.skyDay;
      o.skyMat.needsUpdate = true;
    }

    o.cloudMat.opacity = wk === 'cloudy' ? 0.85 : wk === 'rain' ? 0.7 : 0.38 * (1 - night);
    o.cityMat.opacity = (1 - night) * 0.34 + night * 0.9;
    o.cityMat.color.setHex(0x141c30).lerp(new THREE.Color(0x8b9cb8), 1 - night);
    o.lightMat.opacity = night * 0.92;

    const c = new THREE.Color(0xffffff).lerp(new THREE.Color(0x8a94b0), night);
    if (wk === 'rain') c.lerp(new THREE.Color(0x6b7888), 0.62 * (1 - night));
    if (wk === 'snow') c.lerp(new THREE.Color(0xa8b6c6), 0.8 * (1 - night));
    o.skyMat.color.copy(c);

    if (roomObj.win && roomObj.win.userData.glassMat) {
      roomObj.win.userData.glassMat.color.setHex(wk === 'rain' ? 0xa8b6c4 : 0xcfe4f2);
    }
    // 下雨时玻璃上挂水痕
    if (roomObj.win && roomObj.win.userData.waterMat) {
      roomObj.win.userData.waterMat.opacity = wk === 'rain' ? 0.62 : 0;
    }
  }

  // 窗口透进来的那块光：只有白天有，阴雨天弱
  if (roomObj.lightPatch) {
    const dayF = 1 - Math.max(0, Math.min(1, nightFactor(h)));
    const wet = wk === 'rain' ? 0.09 : wk === 'cloudy' ? 0.18 : wk === 'snow' ? 0.22 : 0.31;
    roomObj.lightPatch.material.opacity = dayF * wet;
  }

  // 光柱：晴天的白天才有
  if (roomObj.shaft) {
    const dayF = 1 - Math.max(0, Math.min(1, nightFactor(h)));
    const k = wk === 'clear' ? 1 : wk === 'snow' ? 0.45 : wk === 'cloudy' ? 0.2 : 0.12;
    roomObj.shaft.children.forEach((m) => {
      m.material.opacity = dayF * k * 0.11;
    });
  }

  // 空气里的浮尘：白天看得见
  if (dust) {
    const dayF = 1 - Math.max(0, Math.min(1, nightFactor(h)));
    dust.material.opacity = 0.08 + dayF * 0.38;
  }

  // 台灯
  if (S.lamp) {
    const wantOn = state.lampOverride === null ? true : state.lampOverride;
    const asleep = h >= 22 || h < 6.5;
    const k = wantOn ? (asleep ? p.lampInt * 0.42 : p.lampInt) : 0;
    S.lamp.light.intensity = k * 2.6;
    S.lamp.shadeMat.emissiveIntensity = 0.12 + k * 0.85;
    S.lamp.bulbMat.emissiveIntensity = 0.35 + k * 1.6;
  }

  // 串灯：天黑才亮
  if (S.strings && S.strings.userData.bulbMat) {
    const nf = Math.max(0, Math.min(1, (h >= 18.5 || h <= 6) ? 1 : (h > 17 ? (h - 17) / 1.5 : (h < 7 ? (7 - h) / 1 : 0))));
    S.strings.userData.bulbMat.emissiveIntensity = 0.15 + nf * 1.7;
  }

  // 落地灯：天黑就开
  if (S.floorLampLight) {
    const nf = Math.max(0, Math.min(1, (h >= 18 || h <= 6.5) ? 1 : (h > 16.5 ? (h - 16.5) / 1.5 : (h < 7.5 ? (7.5 - h) / 1 : 0))));
    const k = state.lampOverride === false ? 0 : nf;
    S.floorLampLight.light.intensity = k * 3.2;
    S.floorLampLight.shadeMat.emissiveIntensity = 0.1 + k * 1.0;
    S.floorLampLight.bulbMat.emissiveIntensity = 0.3 + k * 1.7;
  }

  // 天气粒子
  setWeather(wk === 'rain' ? 'rain' : wk === 'snow' ? 'snow' : 'none');

  // HUD
  const pad = (n) => String(Math.floor(n)).padStart(2, '0');
  const mm = Math.floor((h % 1) * 60);
  const w = (window.WORLD && window.WORLD.weather) || {};
  const wlabel = wk === 'rain' ? '下雨' : wk === 'snow' ? '下雪' : wk === 'cloudy' ? '多云' : (w.label || '晴');
  document.getElementById('chipWhen').innerHTML =
    `<b>${pad(h)}:${String(mm).padStart(2, '0')}</b> · ${wlabel}` + (w.temp ? ` · ${w.temp}℃` : '');
  const asleep = h >= 22 || h < 6.5;
  // 底下这句优先用数据里记着的、那个点钟真的发生过的事
  document.getElementById('chipState').textContent =
    logLineAt(h) || (asleep ? '房间暗着，只留小夜灯' : '台灯亮着，人刚出去一会儿');
}

/* 从 world.log 里挑一条"就是这个点钟"的记录。
   时间戳是 UTC，要换成香港时间（+8）。找不到就返回空，用默认文案。 */
function logLineAt(h) {
  const log = (window.WORLD && window.WORLD.log) || [];
  let best = null, bestD = 99;
  for (const e of log) {
    if (!e || !e.text || !e.at) continue;
    const d = new Date(e.at);
    if (Number.isNaN(d.getTime())) continue;
    const hh = ((d.getUTCHours() + 8) % 24 + 24) % 24;
    let diff = Math.abs(hh - h);
    if (diff > 12) diff = 24 - diff;
    if (diff < bestD) { bestD = diff; best = e; }
  }
  return best && bestD <= 1.2 ? best.text : '';
}

/* ── 鼠标指到东西：轻轻抬起来 + 报个名字 ────────────────── */
const tipEl = document.getElementById('tip');
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2(-9, -9);
let hovered = null;
let pointerInside = false;

canvas.addEventListener('pointermove', (e) => {
  ndc.x = (e.clientX / innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  pointerInside = true;
  if (tipEl) { tipEl.style.left = e.clientX + 'px'; tipEl.style.top = e.clientY + 'px'; }
});
canvas.addEventListener('pointerleave', () => { pointerInside = false; });

function updateHover() {
  if (!S.pickables) return;
  if (drag.obj) return;
  if (!pointerInside) {
    if (hovered) { if (!hovered.userData.noLift) hovered.position.y -= 0.055; hovered = null; tipEl.classList.remove('on'); }
    return;
  }
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(S.pickables, true);
  let target = null;
  if (hits.length) {
    let o = hits[0].object;
    while (o && !S.pickables.includes(o)) o = o.parent;
    target = o || null;
  }
  if (target === hovered) return;
  if (hovered && !hovered.userData.noLift) hovered.position.y -= 0.055;
  hovered = target;
  if (hovered) {
    if (!hovered.userData.noLift) hovered.position.y += 0.055;
    tipEl.textContent = hovered.userData.name || '';
    tipEl.classList.add('on');
  } else {
    tipEl.classList.remove('on');
  }
}

/* ── 点一下：它说一句话 ─────────────────────────────────── */
const bubbleEl = document.getElementById('bubble');
const tmpV = new THREE.Vector3();
const tmpBox = new THREE.Box3();
let bubbleOwner = null;
let bubbleT = 0;

/* 很轻的一声「叮」——点击的确认感 */
let blipCtx = null;
function blip() {
  try {
    if (!blipCtx) blipCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = blipCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator();
    const gn = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(760, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1180, ctx.currentTime + 0.05);
    gn.gain.setValueAtTime(0.0001, ctx.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.008);
    gn.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    o.connect(gn); gn.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.18);
  } catch (e) { /* 没声音也不影响用 */ }
}

function say(obj) {
  const line = obj.userData.line;
  if (!line) return;
  bubbleEl.textContent = line;
  bubbleEl.classList.add('on');
  bubbleOwner = obj;
  bubbleT = 5.2;
  blip();
}

canvas.addEventListener('click', () => {
  if (justDragged) { justDragged = false; return; }   // 刚拖完，别把这一下当成点击
  if (!pointerInside) return;
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(S.pickables, true);
  if (!hits.length) return;
  let o = hits[0].object;
  while (o && !S.pickables.includes(o)) o = o.parent;
  if (!o) return;
  // 窗户不是"说话"，是换天气
  if (o.userData.action === 'weather') { cycleWeather(); return; }
  say(o);
});

const WX = ['auto', 'clear', 'cloudy', 'rain', 'snow'];
const WX_NAME = { auto: '跟着外面的天气', clear: '晴', cloudy: '多云', rain: '下雨了', snow: '下雪了' };
function cycleWeather() {
  const i = WX.indexOf(state.weatherOverride);
  state.weatherOverride = WX[(i + 1) % WX.length];
  const sel = document.getElementById('selW');
  if (sel) sel.value = state.weatherOverride;
  applyTime();
  blip();

  // 气泡就挂在窗户上，不拿别的物件当主角
  bubbleEl.textContent = WX_NAME[state.weatherOverride];
  bubbleEl.classList.add('on');
  bubbleOwner = null;
  bubbleT = 1.8;
  const wp = new THREE.Vector3(1.2, 2.05, -4.44).project(camera);
  bubbleEl.style.left = Math.max(140, Math.min(innerWidth - 140, (wp.x * 0.5 + 0.5) * innerWidth)) + 'px';
  bubbleEl.style.top = Math.max(96, (-wp.y * 0.5 + 0.5) * innerHeight - 70) + 'px';
}

function updateBubble(dt) {
  if (bubbleT <= 0) return;
  bubbleT -= dt;
  if (bubbleT <= 0) {
    bubbleEl.classList.remove('on');
    bubbleOwner = null;
    return;
  }
  if (!bubbleOwner) return;   // 位置已经定死的气泡（比如换天气），只负责倒计时
  tmpBox.setFromObject(bubbleOwner);
  tmpV.set(
    (tmpBox.min.x + tmpBox.max.x) / 2,
    tmpBox.max.y + 0.14,
    (tmpBox.min.z + tmpBox.max.z) / 2
  );
  tmpV.project(camera);
  // 别让气泡跑出屏幕
  const bx = Math.max(140, Math.min(innerWidth - 140, (tmpV.x * 0.5 + 0.5) * innerWidth));
  const by = Math.max(96, Math.min(innerHeight - 46, (-tmpV.y * 0.5 + 0.5) * innerHeight));
  bubbleEl.style.left = bx + 'px';
  bubbleEl.style.top = by + 'px';
}

/* ── 猫：过一会儿自己挪个地方 ───────────────────────────── */
// [x, z, 朝向]——都落在地毯上，不会走进家具里
const CAT_SPOTS = [
  [1.75, 1.30, -0.55],
  [2.18, 0.62, -1.15],
  [1.02, 1.58, 0.35],
  [2.30, 1.86, -2.20],
  [1.30, 2.16, -0.15],
  [0.55, 0.95, 0.75],
];
const catMove = { from: null, to: null, t: 1, wait: 14 };

function stepCat(dt) {
  if (!S.cat) return;
  if (catMove.t >= 1) {
    catMove.wait -= dt;
    if (catMove.wait <= 0) {
      const spot = CAT_SPOTS[Math.floor(Math.random() * CAT_SPOTS.length)];
      catMove.from = { x: S.cat.position.x, z: S.cat.position.z, ry: S.cat.rotation.y };
      catMove.to = { x: spot[0], z: spot[1], ry: spot[2] };
      catMove.t = 0;
      catMove.wait = 20 + Math.random() * 22;
    }
    return;
  }
  catMove.t = Math.min(1, catMove.t + dt / 2.2);
  const e = catMove.t * catMove.t * (3 - 2 * catMove.t);
  S.cat.position.x = catMove.from.x + (catMove.to.x - catMove.from.x) * e;
  S.cat.position.z = catMove.from.z + (catMove.to.z - catMove.from.z) * e;
  // 转身走最短的那一边
  let d = catMove.to.ry - catMove.from.ry;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  S.cat.rotation.y = catMove.from.ry + d * e;
}

/* ── 拖动家具：她想摆哪儿就摆哪儿 ──────────────────────── */
// 按住家具拖：位置跟着鼠标在地面上走，松手吸附到 0.25 的格子上，存进 localStorage。
const drag = { obj: null, moved: false, sx: 0, sy: 0, y0: 0 };
let justDragged = false;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();

function posKey() { return 'room3d.pos.v1'; }

// 复原：清掉记住的摆位。地址栏加 ?reset=1 也行
function resetLayout(andReload) {
  try { localStorage.removeItem(posKey()); } catch (e) { /* 忽略 */ }
  if (andReload !== false) location.reload();
}

function savePositions() {
  try {
    const map = {};
    for (const o of S.pickables) {
      if (!o.userData.name || o.userData.noLift) continue;
      if (o.userData.wallMounted) continue;    // 墙上的东西不记位置
      map[o.userData.name] = [
        Math.round(o.position.x * 100) / 100,
        Math.round(o.position.z * 100) / 100,
      ];
    }
    localStorage.setItem(posKey(), JSON.stringify(map));
  } catch (e) { /* 隐私模式下存不了也没关系 */ }
}
function loadPositions() {
  try {
    const raw = localStorage.getItem(posKey());
    if (!raw) return;
    const map = JSON.parse(raw);
    for (const o of S.pickables) {
      if (o.userData.wallMounted) continue;
      const p = map[o.userData.name];
      if (!p) continue;
      o.position.x = p[0];
      o.position.z = p[1];
    }
  } catch (e) { /* 坏数据就忽略 */ }
}
if (Q.get('reset')) resetLayout(false);
loadPositions();

canvas.addEventListener('pointerdown', (e) => {
  if (!pointerInside) return;
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(S.pickables, true);
  if (!hits.length) return;
  let o = hits[0].object;
  while (o && !S.pickables.includes(o)) o = o.parent;
  if (!o || o.userData.action) return;      // 窗户那种功能件不给拖
  if (o.userData.wallMounted || o.position.y > 0.32) return;   // 墙上的、桌上的不给拖，免得拖到半空
  drag.obj = o;
  drag.moved = false;
  drag.sx = e.clientX;
  drag.sy = e.clientY;
  drag.y0 = o.position.y;
  controls.enabled = false;                  // 拖家具的时候别转相机
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag.obj) return;
  if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 5) {
    drag.moved = true;
    drag.obj.position.y = drag.y0 + 0.06;    // 拎起来一点
  }
  if (!drag.moved) return;
  ray.setFromCamera(ndc, camera);
  groundPlane.constant = -drag.obj.position.y;
  if (ray.ray.intersectPlane(groundPlane, hitPoint)) {
    const lim = ROOM / 2 - 0.35;
    drag.obj.position.x = Math.max(-lim, Math.min(lim, hitPoint.x));
    drag.obj.position.z = Math.max(-lim, Math.min(lim, hitPoint.z));
  }
});

canvas.addEventListener('pointerup', () => {
  if (drag.obj) {
    if (drag.moved) {
      // 吸附到 0.25 的格子
      drag.obj.position.x = Math.round(drag.obj.position.x / 0.25) * 0.25;
      drag.obj.position.z = Math.round(drag.obj.position.z / 0.25) * 0.25;
      blip();
      savePositions();
      justDragged = true;
      tipEl.textContent = drag.obj.userData.name + ' · 摆好了';
      tipEl.classList.add('on');
    }
    drag.obj.position.y = drag.y0;
    drag.obj = null;
    controls.enabled = true;
  }
});

/* ── 动画 ───────────────────────────────────────────────── */
const clock = new THREE.Clock();
let catT = 0;

function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  catT += dt;

  if (S.cat) {
    const b = 1 + Math.sin(catT * 1.6) * 0.012;
    S.cat.scale.set(1, b, 1);
    // 尾巴慢慢扫，偶尔快一点
    const tl = S.cat.userData.tail;
    if (tl) {
      const speed = 0.7 + Math.sin(catT * 0.23) * 0.35;
      tl.rotation.z = 0.35 + Math.sin(catT * speed) * 0.14;
    }
  }
  if (S.curtains) {
    S.curtains.forEach((c, i) => {
      c.rotation.z = Math.sin(catT * 0.7 + i * 1.7) * 0.012;
      c.rotation.x = Math.sin(catT * 0.9 + i) * 0.008;
    });
  }
  if (S.lamp && S.lamp.light.intensity > 0.01) {
    S.lamp.light.intensity *= 1 + Math.sin(catT * 2.1) * 0.004;
  }

  controls.update();
  updateHover();
  updateBubble(dt);
  stepCat(dt);
  stepWeather(dt, catT);

  if (dust) {
    const a = dust.geometry.attributes.position.array;
    const sp = dust.userData.spd;
    for (let i = 0; i < sp.length; i++) {
      a[i * 3 + 1] += sp[i] * dt;
      a[i * 3] += Math.sin(catT * 0.5 + i * 1.7) * 0.0005;
      if (a[i * 3 + 1] > 3.2) a[i * 3 + 1] = 0.25;
    }
    dust.geometry.attributes.position.needsUpdate = true;
  }

  draw();
  requestAnimationFrame(tick);
}

/* ── 尺寸 ───────────────────────────────────────────────── */
function resize() {
  aspect = innerWidth / innerHeight;
  camera.left = -FRUST * aspect;
  camera.right = FRUST * aspect;
  camera.top = FRUST;
  camera.bottom = -FRUST;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  if (composer) composer.setSize(innerWidth, innerHeight);
}

/* ── UI ─────────────────────────────────────────────────── */
const rHour = document.getElementById('rHour');
const rHourV = document.getElementById('rHourV');
if (state.hourOverride !== null) {
  rHour.value = state.hourOverride;
  rHourV.textContent = state.hourOverride.toFixed(1);
}
rHour.addEventListener('input', () => {
  state.hourOverride = parseFloat(rHour.value);
  rHourV.textContent = state.hourOverride.toFixed(1);
  applyTime();
});
document.getElementById('selW').addEventListener('change', (e) => {
  state.weatherOverride = e.target.value;
  applyTime();
});
document.getElementById('cbLamp').addEventListener('change', (e) => {
  state.lampOverride = e.target.checked;
  applyTime();
});
document.getElementById('cbOrbit').addEventListener('change', (e) => {
  const on = e.target.checked;
  controls.minAzimuthAngle = on ? -Infinity : Math.PI * 0.17;
  controls.maxAzimuthAngle = on ? Infinity : Math.PI * 0.33;
  controls.minPolarAngle = on ? 0.05 : Math.PI * 0.25;
  controls.maxPolarAngle = on ? Math.PI * 0.49 : Math.PI * 0.36;
});
document.getElementById('btnDbg').addEventListener('click', () => {
  document.getElementById('dbg').classList.toggle('on');
});

/* ── 声音：环境底噪 + 雨 + 键盘（默认关） ────────────────── */
let audio = null;
function buildAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  [98, 147, 196].forEach((f, i) => {
    const o = ctx.createOscillator();
    const gn = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    gn.gain.value = i === 0 ? 0.022 : 0.01;
    o.connect(gn); gn.connect(master); o.start();
  });

  const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.35;

  const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 380;
  const ng = ctx.createGain(); ng.gain.value = 0.02;
  noise.connect(hp); hp.connect(ng); ng.connect(master); noise.start();

  const rain = ctx.createBufferSource(); rain.buffer = buf; rain.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.6;
  const rg = ctx.createGain(); rg.gain.value = 0;
  rain.connect(bp); bp.connect(rg); rg.connect(master); rain.start();

  return {
    on: false,
    set(on) {
      this.on = on;
      master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.3);
      rg.gain.setTargetAtTime(on && weatherOf() === 'rain' ? 0.16 : 0, ctx.currentTime, 0.6);
      if (on) ctx.resume();
    },
    refresh() {
      rg.gain.setTargetAtTime(this.on && weatherOf() === 'rain' ? 0.16 : 0, ctx.currentTime, 0.6);
    },
  };
}
document.getElementById('btnReset').addEventListener('click', () => resetLayout(true));

document.getElementById('btnSound').addEventListener('click', (e) => {
  if (!audio) audio = buildAudio();
  audio.set(!audio.on);
  e.target.textContent = '声音：' + (audio.on ? '开' : '关');
});

/* ── 启动 ───────────────────────────────────────────────── */
resize();
applyTime();
draw();
requestAnimationFrame(tick);
addEventListener('resize', resize);

window.__ROOM_BOOTED__ = true;
setTimeout(() => document.getElementById('boot').classList.add('gone'), 120);

// 标题下面那行：住到第几天，也是数据里的
(() => {
  const st = (window.WORLD && window.WORLD.stats) || {};
  const days = Number(st.days) || 0;
  const sub = document.getElementById('subline');
  if (!sub) return;
  sub.textContent = days > 1
    ? `— 第 ${days} 天 · 等距视角 · 实时渲染 —`
    : '— 等距视角 · 实时渲染 —';
})();

// 调试：?say=1 对猫说一句、?say=notes 点开便签，方便截图看气泡
if (Q.get('wx')) setTimeout(cycleWeather, 400);
if (Q.get('say') === 'notes' && S.notesMesh) setTimeout(() => say(S.notesMesh), 500);
else if (Q.get('say') && S.cat) setTimeout(() => say(S.cat), 500);

// 调试：?dragtest=1 用合成的鼠标事件试一次拖动，结果写在气泡里
if (Q.get('dragtest') && S.rabbit) {
  setTimeout(() => {
    const cv = document.getElementById('c');
    const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, {
      clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true,
    }));
    // 用投影算出兔子在屏幕上的确切位置，别靠猜
    const wp = new THREE.Vector3();
    S.rabbit.getWorldPosition(wp);
    wp.y += 0.12;
    wp.project(camera);
    const SX = (wp.x * 0.5 + 0.5) * innerWidth;
    const SY = (-wp.y * 0.5 + 0.5) * innerHeight;
    ev('pointermove', SX, SY);
    setTimeout(() => {
      const before = [S.rabbit.position.x, S.rabbit.position.z];
      ev('pointerdown', SX, SY);
      ev('pointermove', SX + 40, SY - 10);
      ev('pointermove', SX + 140, SY + 20);
      ev('pointermove', SX + 200, SY + 40);
      ev('pointerup', SX + 200, SY + 40);
      const after = [S.rabbit.position.x, S.rabbit.position.z];
      bubbleEl.textContent = '拖动自测 (' + SX.toFixed(0) + ',' + SY.toFixed(0) + ') · 前 ' + before.map((v) => v.toFixed(2)).join(',') +
        ' → 后 ' + after.map((v) => v.toFixed(2)).join(',');
      bubbleEl.style.left = '50%';
      bubbleEl.style.top = '50%';
      bubbleEl.classList.add('on');
      bubbleOwner = null;
      bubbleT = 30;
    }, 400);
  }, 900);
}

setInterval(() => {
  if (state.hourOverride === null) { applyTime(); if (audio) audio.refresh(); }
}, 30000);
