// 房间外壳：地板、两面墙（后墙真的开了一个窗洞）、窗、门、地毯、窗外的世界
import * as THREE from 'three';
import { rbox, mat, cyl, M, P, g, seeded } from './util.js';

const WIN = { x: 1.2, y: 2.05, w: 1.9, h: 1.5 };  // 窗洞（相对后墙）

/* ── 程序化纹理 ─────────────────────────────────────────── */

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#ccb99a';
  x.fillRect(0, 0, 1024, 1024);
  const rnd = seeded(19);
  const ph = 200;                       // 一块板的高度（板长按这个算）
  for (let y = 0; y < 1024; y += ph) {
    const t = rnd();
    x.fillStyle = `rgba(126,96,60,${0.10 + t * 0.14})`;
    x.fillRect(0, y, 1024, ph);
    for (let k = 0; k < 54; k++) {
      const gy = y + rnd() * ph;
      x.strokeStyle = `rgba(108,78,46,${0.07 + rnd() * 0.14})`;
      x.lineWidth = 0.7 + rnd() * 1.6;
      x.beginPath();
      x.moveTo(0, gy);
      for (let px = 0; px <= 1024; px += 64) x.lineTo(px, gy + Math.sin(px * 0.011 + y * 0.07) * 2.2);
      x.stroke();
    }
    // 板缝
    x.strokeStyle = 'rgba(84,56,32,.46)';
    x.lineWidth = 3;
    x.beginPath(); x.moveTo(0, y); x.lineTo(1024, y); x.stroke();
    // 板头的接缝
    const off = ((y / ph) % 2 ? 320 : 700) + Math.round(rnd() * 60);
    x.strokeStyle = 'rgba(84,56,32,.32)';
    x.lineWidth = 2.4;
    x.beginPath(); x.moveTo(off, y); x.lineTo(off, y + ph); x.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, 1.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function wallpaperTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#f7f1e8';
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 512; i += 34) {
    x.fillStyle = 'rgba(255,255,255,.30)';
    x.fillRect(i, 0, 15, 512);
    x.fillStyle = 'rgba(202,184,162,.13)';
    x.fillRect(i + 15, 0, 2, 512);
  }
  const img = x.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 7;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function skyTexture(night) {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 268;
  const x = c.getContext('2d');

  const grd = x.createLinearGradient(0, 0, 0, 268);
  if (night) {
    grd.addColorStop(0, '#0d1730');
    grd.addColorStop(0.5, '#1b2947');
    grd.addColorStop(1, '#2f3b58');
  } else {
    grd.addColorStop(0, '#4a7bb5');
    grd.addColorStop(0.55, '#8fb6d8');
    grd.addColorStop(1, '#d5e4ee');
  }
  x.fillStyle = grd;
  x.fillRect(0, 0, 320, 268);

  if (night) {
    // 星星
    const rnd = seeded(31);
    for (let i = 0; i < 40; i++) {
      const s = 0.8 + rnd() * 1.6;
      x.fillStyle = `rgba(238,242,255,${0.4 + rnd() * 0.55})`;
      x.beginPath();
      x.arc(rnd() * 320, rnd() * 200, s, 0, Math.PI * 2);
      x.fill();
    }
    // 月亮：实心 + 一圈柔光
    const mx = 236, my = 74, mr = 26;
    const halo = x.createRadialGradient(mx, my, mr * 0.7, mx, my, mr * 2.6);
    halo.addColorStop(0, 'rgba(255,248,214,.55)');
    halo.addColorStop(1, 'rgba(255,248,214,0)');
    x.fillStyle = halo;
    x.beginPath(); x.arc(mx, my, mr * 2.6, 0, Math.PI * 2); x.fill();

    x.fillStyle = '#fdf8e0';
    x.beginPath(); x.arc(mx, my, mr, 0, Math.PI * 2); x.fill();
    // 一点点环形山
    x.fillStyle = 'rgba(226,218,186,.7)';
    x.beginPath(); x.arc(mx - 8, my - 6, 5, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(mx + 7, my + 8, 3.4, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(mx + 2, my - 12, 2.6, 0, Math.PI * 2); x.fill();
  } else {
    // 白天几片淡云
    x.fillStyle = 'rgba(255,255,255,.55)';
    for (const [cx, cy, r] of [[70, 66, 26], [96, 58, 18], [46, 62, 16], [250, 190, 20], [268, 196, 14]]) {
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function rugTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#f5eee5';
  x.fillRect(0, 0, 256, 256);

  // 编织的横竖纹
  for (let i = 0; i < 256; i += 8) {
    x.fillStyle = i % 16 ? 'rgba(200,184,164,.34)' : 'rgba(212,197,178,.24)';
    x.fillRect(0, i, 256, 4);
    x.fillStyle = 'rgba(206,190,170,.16)';
    x.fillRect(i, 0, 3, 256);
  }
  // 菱形花纹
  x.strokeStyle = 'rgba(198,168,146,.30)';
  x.lineWidth = 3;
  for (let r = 0; r < 2; r++) {
    for (let q = 0; q < 2; q++) {
      const cx = 64 + q * 128, cy = 64 + r * 128, s = 40;
      x.beginPath();
      x.moveTo(cx, cy - s); x.lineTo(cx + s, cy); x.lineTo(cx, cy + s); x.lineTo(cx - s, cy);
      x.closePath();
      x.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1.6);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ── 窗：框 + 玻璃 + 十字梃 ─────────────────────────────── */

function buildWindow(W, H) {
  const win = g();
  const frameMat = mat(0xfaf4e8, { rough: 0.62 });
  const fw = 0.1, bar = 0.055;

  // 玻璃：淡淡的，能看见外面的雨和月亮
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xcfe4f2, roughness: 0.08, metalness: 0.0,
    transparent: true, opacity: 0.14,
  });
  const glass = P(win, new THREE.PlaneGeometry(W, H), glassMat, 0, 0, 0.03);

  // 框
  P(win, rbox(W + fw * 2, fw, 0.16), frameMat, 0, H / 2 + 0.01, 0.04);
  P(win, rbox(W + fw * 2, fw, 0.16), frameMat, 0, -H / 2 - 0.01, 0.04);
  P(win, rbox(fw, H + fw * 2, 0.16), frameMat, -W / 2 - 0.01, 0, 0.04);
  P(win, rbox(fw, H + fw * 2, 0.16), frameMat, W / 2 + 0.01, 0, 0.04);
  P(win, rbox(bar, H, 0.11), frameMat, 0, 0, 0.045);
  P(win, rbox(W, bar, 0.11), frameMat, 0, 0.06, 0.045);

  // 窗台
  P(win, rbox(W + 0.36, 0.09, 0.32, 0.03), mat(0xf8f1e4, { rough: 0.7 }), 0, -H / 2 - 0.09, 0.15);

  // 玻璃上的水痕：数据里记着"窗外湿了，玻璃上有一道道水痕"，下雨天就显出来
  const wc = document.createElement('canvas');
  wc.width = 128; wc.height = 256;
  const wx2 = wc.getContext('2d');
  const wrnd = seeded(77);
  for (let i = 0; i < 30; i++) {
    const wx = wrnd() * 128;
    const wy = wrnd() * 110;
    const wh = 24 + wrnd() * 120;
    const g3 = wx2.createLinearGradient(0, wy, 0, wy + wh);
    g3.addColorStop(0, 'rgba(255,255,255,0)');
    g3.addColorStop(0.45, `rgba(255,255,255,${0.3 + wrnd() * 0.35})`);
    g3.addColorStop(1, 'rgba(255,255,255,0)');
    wx2.fillStyle = g3;
    wx2.fillRect(wx, wy, 1 + wrnd() * 2, wh);
    // 偶尔挂一颗水珠
    if (wrnd() > 0.7) {
      wx2.fillStyle = 'rgba(255,255,255,.5)';
      wx2.beginPath();
      wx2.arc(wx + 0.5, wy + wh, 1.4 + wrnd(), 0, Math.PI * 2);
      wx2.fill();
    }
  }
  const waterTex = new THREE.CanvasTexture(wc);
  waterTex.colorSpace = THREE.SRGBColorSpace;
  const waterMat = new THREE.MeshBasicMaterial({
    map: waterTex, transparent: true, opacity: 0, depthWrite: false,
    toneMapped: false,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, H - 0.02), waterMat);
  water.position.set(0, 0, 0.038);
  win.add(water);

  win.userData = { glass, glassMat, waterMat };
  return win;
}

/* ── 从窗口照进来的那块光 ─────────────────────────────────
   一张贴在身上的图：四个柔边的亮格子，用加法混合叠在地板上。
   有它没它，房间是"亮的"还是"有太阳的"的区别。 */
function windowLightPatch() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 320);
  const pad = 12, cols = 2, rows = 2;
  const gw = (256 - pad * 2) / cols, gh = (320 - pad * 2) / rows;
  x.filter = 'blur(10px)';
  x.fillStyle = 'rgba(255,255,255,1)';
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      x.fillRect(pad + i * gw + 6, pad + j * gh + 6, gw - 12, gh - 12);
    }
  }
  x.filter = 'none';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.95, 2.45),
    new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, color: 0xffedcc,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = 0.4;
  m.position.set(0.34, 0.028, -2.15);
  m.renderOrder = 2;
  return m;
}

/* ── 从窗口斜射进来的那条光柱 ───────────────────────────── */
function lightShaft() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 160;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, 'rgba(255,242,210,.85)');
  grd.addColorStop(0.45, 'rgba(255,238,200,.42)');
  grd.addColorStop(1, 'rgba(255,236,198,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 64, 160);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const g2 = g();
  // 三片错开的薄光，比一片像"柱"
  for (const [dx, dz, w, ry] of [[0, 0, 1.6, 0], [-0.1, 0.09, 1.35, 0.06], [0.09, -0.07, 1.2, -0.05]]) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, 2.4),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      })
    );
    m.position.set(dx, 0, dz);
    m.rotation.set(-0.78, ry, 0);
    m.renderOrder = 3;
    g2.add(m);
  }
  g2.position.set(1.2, 1.38, -2.6);
  return g2;
}

/* ── 窗外：天空、月亮、星、云、城市 ───────────────────────
   整个"外面"只有 2.7 x 2.3，贴在窗洞后 0.55 处。
   再大就会从墙顶露出来——切角房间没有屋顶。 */
function buildOutside() {
  const out = g();
  // 等距视角下，比窗洞远 0.33 的东西在屏幕上会"向上偏"，所以整块往下放一点
  const Z = -4.72;
  const CX = 1.2, CY = 1.74;

  const skyDay = skyTexture(false);
  const skyNight = skyTexture(true);
  const skyMat = new THREE.MeshBasicMaterial({ map: skyDay });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), skyMat);
  sky.position.set(CX, CY, Z);
  out.add(sky);

  // 星星和月亮已经画在夜空贴图里了，这里只留会动的东西

  // 云：几朵，每朵由几个圆叠出来，不像贴纸
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const clouds = g();
  const puffs = [
    [-0.62, 0.66, 0.15], [-0.5, 0.7, 0.11], [-0.74, 0.69, 0.09], [-0.56, 0.62, 0.1],
    [0.18, 0.3, 0.12], [0.29, 0.34, 0.09], [0.07, 0.33, 0.08],
  ];
  for (const [dx, dy, r] of puffs) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(r, 18), cloudMat);
    b.position.set(CX + dx, CY + dy, Z + 0.01);
    clouds.add(b);
  }
  out.add(clouds);

  // 远处城市剪影 + 灯点
  const cityMat = new THREE.MeshBasicMaterial({ color: 0x2b3552, transparent: true, opacity: 0 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd98c, transparent: true, opacity: 0 });
  const city = g();
  const rnd2 = seeded(9);
  for (let i = 0; i < 11; i++) {
    const bw = 0.12 + rnd2() * 0.14;
    const bh = 0.18 + rnd2() * 0.34;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), cityMat);
    b.position.set(CX - 1.15 + i * 0.23, CY - 1.05 + bh / 2, Z + 0.03);
    city.add(b);
  }
  for (let i = 0; i < 14; i++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.017), lightMat);
    l.position.set(CX - 1.0 + rnd2() * 2.1, CY - 0.98 + rnd2() * 0.3, Z + 0.04);
    city.add(l);
  }
  out.add(city);

  out.userData = { skyMat, skyDay, skyNight, cloudMat, cityMat, lightMat };
  return out;
}

/* ── 门 ─────────────────────────────────────────────────── */

function buildDoor(W, H) {
  const d = g();
  const leafMat = mat(0xeee2cd, { rough: 0.72 });
  const frameMat = mat(0xdfd2ba, { rough: 0.8 });

  P(d, rbox(W + 0.16, H + 0.12, 0.1, 0.02), frameMat, 0, (H + 0.12) / 2, 0.02);
  P(d, rbox(W, H, 0.07, 0.02), leafMat, 0, H / 2, 0.07);
  P(d, rbox(W * 0.72, H * 0.32, 0.02, 0.01), mat(0xe6d8c0, { rough: 0.8 }), 0, H * 0.72, 0.115);
  P(d, rbox(W * 0.72, H * 0.4, 0.02, 0.01), mat(0xe6d8c0, { rough: 0.8 }), 0, H * 0.34, 0.115);
  P(d, new THREE.SphereGeometry(0.045, 14, 10), mat(0xc9a878, { rough: 0.35, metal: 0.55 }), -W / 2 + 0.16, H * 0.48, 0.13);
  return d;
}

/* ── 房间 ───────────────────────────────────────────────── */

export function buildRoom(ROOM, WALL_H) {
  const group = g();
  const HALF = ROOM / 2;
  const T = 0.22;

  // 底座
  const base = P(group, rbox(ROOM + 0.34, 0.42, ROOM + 0.34, 0.05), mat(0xbfa483, { rough: 0.85 }), 0, -0.23, 0);
  base.receiveShadow = true;

  // 地板
  const floorMat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.02, map: plankTexture() });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM, ROOM), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const wallBoxMat = mat(0xe4d8c6, { rough: 0.95 });
  const paper = new THREE.MeshStandardMaterial({ roughness: 0.94, map: wallpaperTexture() });

  // 一段墙（box + 内侧贴纸）
  function wallPart(parent, cx, cy, w, h, t) {
    const b = P(parent, new THREE.BoxGeometry(w, h, t), wallBoxMat, cx, cy, 0);
    b.receiveShadow = true;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), paper);
    face.position.set(cx, cy, t / 2 + 0.002);
    face.receiveShadow = true;
    parent.add(face);
  }

  // 后墙：中间挖一个窗洞
  const back = g();
  const hx1 = WIN.x - WIN.w / 2, hx2 = WIN.x + WIN.w / 2;
  const hy1 = WIN.y - WIN.h / 2, hy2 = WIN.y + WIN.h / 2;
  wallPart(back, 0, hy1 / 2, ROOM, hy1, T);                                  // 洞下面
  wallPart(back, 0, (hy2 + WALL_H) / 2, ROOM, WALL_H - hy2, T);              // 洞上面
  const lw = hx1 + HALF, rw = HALF - hx2;
  wallPart(back, -HALF + lw / 2, (hy1 + hy2) / 2, lw, WIN.h, T);             // 洞左边
  wallPart(back, hx2 + rw / 2, (hy1 + hy2) / 2, rw, WIN.h, T);               // 洞右边
  back.position.set(0, 0, -HALF - T / 2 + 0.01);
  group.add(back);

  // 左墙：实心
  const left = g();
  wallPart(left, 0, WALL_H / 2, ROOM, WALL_H, T);
  left.position.set(-HALF - T / 2 + 0.01, 0, 0);
  left.rotation.y = Math.PI / 2;
  group.add(left);

  // 墙顶的一条边：墙才有厚度，不像纸片立着
  const capMat = mat(0xe0d2bb, { rough: 0.9 });
  P(group, rbox(ROOM + T, 0.055, T + 0.03, 0.015), capMat, 0, WALL_H + 0.027, -HALF - T / 2 + 0.01);
  P(group, rbox(T + 0.03, 0.055, ROOM + T, 0.015), capMat, -HALF - T / 2 + 0.01, WALL_H + 0.027, 0);

  // 踢脚线：墙根一条窄的边，房间才"收口"
  const skirtMat = mat(0xdccfb6, { rough: 0.8 });
  const skirtH = 0.15;
  const skirtBack = P(group, rbox(ROOM - 0.02, skirtH, 0.055, 0.012), skirtMat, 0, skirtH / 2, -HALF + 0.03);
  const skirtLeft = P(group, rbox(0.055, skirtH, ROOM - 0.02, 0.012), skirtMat, -HALF + 0.03, skirtH / 2, 0);
  skirtBack.castShadow = skirtLeft.castShadow = false;
  skirtBack.receiveShadow = skirtLeft.receiveShadow = true;

  // 窗（装在洞上）
  const win = buildWindow(WIN.w, WIN.h);
  win.position.set(WIN.x, WIN.y, -HALF + 0.02);
  group.add(win);

  // 门
  const door = buildDoor(0.92, 2.0);
  door.position.set(-HALF + 0.02, 0, 2.1);
  door.rotation.y = Math.PI / 2;
  group.add(door);

  // 地毯：织出来的，带花纹
  const rugOuter = P(group, rbox(3.75, 0.035, 2.75, 0.2), mat(0xe4dbcd, { rough: 0.98 }), 0.4, 0.018, 1.05);
  const rugTex = rugTexture();
  const rugInner = P(group, rbox(3.2, 0.04, 2.2, 0.18),
    new THREE.MeshStandardMaterial({ roughness: 0.97, map: rugTex }), 0.4, 0.024, 1.05);
  rugOuter.receiveShadow = true;
  rugInner.receiveShadow = true;

  // 窗外
  const outside = buildOutside();
  group.add(outside);

  // 窗口透进来的那块光
  const lightPatch = windowLightPatch();
  group.add(lightPatch);

  // 光柱
  const shaft = lightShaft();
  group.add(shaft);

  return { group, win, door, floor, outside, lightPatch, shaft, half: HALF, winRect: WIN };
}
