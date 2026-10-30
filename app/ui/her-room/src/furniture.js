// 程序化家具：全部用圆角盒、圆柱、球拼出来，没有一张贴图
import * as THREE from 'three';
import { rbox, mat, cyl, sph, M, P, g, seeded, contactShadow } from './util.js';

/* ── 色板（暖米 + 木 + 一点点粉） ───────────────────────── */
const C = {
  wood:     0xdcbf9a,
  woodMid:  0xcbab7f,
  woodDark: 0xb28c60,
  white:    0xfdfaf4,
  whiteWarm: 0xf7efe2,
  cream:    0xeee1cb,
  pink:     0xf5bfcd,
  pinkLight: 0xfad8e2,
  blue:     0x9fc6e8,
  blueLight: 0xc4ddf2,
  leaf:     0x6f9c66,
  leafDark: 0x54804f,
  metal:    0xc2b6a4,
  black:    0x4d4652,
};
export const PALETTE = C;

const wood   = () => mat(C.wood, { rough: 0.66 });
const woodM  = () => mat(C.woodMid, { rough: 0.68 });
const woodD  = () => mat(C.woodDark, { rough: 0.7 });
const cream  = () => mat(C.cream, { rough: 0.85 });
const white  = () => mat(C.white, { rough: 0.9 });
const pink   = () => mat(C.pink, { rough: 0.95 });
const pinkL  = () => mat(C.pinkLight, { rough: 0.95 });
const metal  = () => mat(C.metal, { rough: 0.4, metal: 0.7 });

/* ── 床 ─────────────────────────────────────────────────── */
export function bed(withWhale = true) {
  const root = g();
  const W = 2.2, L = 3.5;
  root.add(contactShadow(W + 0.8, L + 0.8, 0.9));

  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    P(root, cyl(0.052, 0.046, 0.34, 12), woodD(), x * (W / 2 - 0.1), 0.17, z * (L / 2 - 0.1));

  P(root, rbox(W, 0.15, L, 0.03), wood(), 0, 0.42, 0);
  // 床头板 + 三个软包凸起
  P(root, rbox(W, 0.78, 0.13, 0.05), woodM(), 0, 0.85, -L / 2 + 0.07);
  for (let i = 0; i < 3; i++) {
    const cush = P(root, rbox(0.5, 0.46, 0.07, 0.15), mat(0xf6e6e2, { rough: 0.96 }),
      (i - 1) * 0.63, 0.88, -L / 2 + 0.15);
    cush.rotation.x = -0.04;
  }
  P(root, rbox(W - 0.1, 0.3, L - 0.16, 0.07), white(), 0, 0.65, 0.02);

  // 被子：底层铺开 + 上面一层略窄的鼓起 + 两侧垂下来一点
  P(root, rbox(W - 0.02, 0.22, L * 0.58, 0.2), pink(), 0, 0.82, L * 0.2);
  P(root, rbox(W - 0.24, 0.12, L * 0.5, 0.16), pinkL(), 0, 0.94, L * 0.22);
  // 被面里的起伏：几个压扁的包，有光才有"盖着东西"的感觉
  const lumps = [
    [0.44, -0.34, 1.25, 0.72, 0.945],
    [-0.38, 0.12, 1.45, 0.85, 0.955],
    [0.14, 0.52, 1.05, 0.66, 0.94],
    [-0.1, -0.58, 1.2, 0.5, 0.935],
  ];
  for (const [lx, lz, sx, sz, ly] of lumps) {
    const b = P(root, sph(0.3, 18, 12), pinkL(), lx, ly, L * 0.2 + lz);
    b.scale.set(sx, 0.17, sz);
  }
  for (const s of [-1, 1]) {
    const drape = P(root, rbox(0.1, 0.2, L * 0.56, 0.05), pink(), s * (W / 2 - 0.04), 0.72, L * 0.2);
    drape.rotation.z = s * 0.12;
  }
  // 被头翻边
  P(root, rbox(W - 0.04, 0.11, 0.42, 0.06), pinkL(), 0, 0.95, -0.22);
  // 被子上的折痕
  P(root, rbox(W - 0.42, 0.02, 0.05, 0.01), mat(0xe9b4c2, { rough: 0.95 }), 0, 1.0, 0.36);
  P(root, rbox(W - 0.42, 0.02, 0.05, 0.01), mat(0xe9b4c2, { rough: 0.95 }), 0, 1.0, 0.82);

  // 两个枕头
  for (const x of [-0.52, 0.52]) {
    const p = P(root, rbox(0.78, 0.17, 0.42, 0.09), white(), x, 0.87, -L / 2 + 0.46);
    p.rotation.z = x > 0 ? -0.02 : 0.02;
  }

  // 鲸鱼抱枕，放在被子上（她的东西，数据里有才放）
  if (withWhale) {
    const whale = g();
    const bodyMat = mat(C.blue, { rough: 0.94 });
    const bellyMat = mat(C.blueLight, { rough: 0.94 });

    // 身体：一颗扁长的蛋，就是一个抱枕
    const b = P(whale, sph(0.3, 22, 16), bodyMat, 0, 0, 0);
    b.scale.set(1.85, 0.68, 1.02);
    const belly = P(whale, sph(0.26, 18, 12), bellyMat, 0.02, -0.1, 0);
    belly.scale.set(1.6, 0.34, 0.86);

    // 尾：往上翘的两片，从哪个角度都认得出是鲸鱼
    for (const s of [1, -1]) {
      const f = P(whale, new THREE.ConeGeometry(0.17, 0.32, 3), bodyMat, -0.44, 0.13, s * 0.05);
      f.rotation.set(s * 0.25, 0, -0.85);
      f.scale.set(1, 1, 0.3);
    }
    // 背鳍
    const fin = P(whale, new THREE.ConeGeometry(0.095, 0.17, 3), bodyMat, 0.0, 0.16, 0);
    fin.scale.set(1, 1, 0.3);
    // 嘴：一道横线
    const mouth = P(whale, cyl(0.007, 0.007, 0.24, 6), mat(0x6f9bbc, { rough: 0.6 }), 0.4, -0.03, 0);
    mouth.rotation.set(Math.PI / 2, 0, 0);
    // 眼睛 + 喷水孔
    P(whale, sph(0.026, 10, 8), mat(0x3b3a46, { rough: 0.4 }), 0.46, 0.03, 0.17);
    P(whale, sph(0.026, 10, 8), mat(0x3b3a46, { rough: 0.4 }), 0.46, 0.03, -0.17);
    P(whale, sph(0.016, 8, 8), mat(0x8fb8d8, { rough: 0.8 }), 0.1, 0.18, 0);

    whale.position.set(-0.04, 1.1, 0.52);
    whale.rotation.y = -0.3;
    whale.scale.setScalar(1.2);
    root.add(whale);
  }

  return root;
}

/* ── 书桌（含台灯、笔筒、水杯、便签、画纸） ─────────────── */
export function desk(noteCount = 3) {
  const root = g();
  const W = 2.5, D = 0.85, H = 1.34;
  root.add(contactShadow(W + 0.7, D + 0.6, 0.85));

  // 桌面
  P(root, rbox(W, 0.09, D, 0.025), wood(), 0, H, 0);
  // 左侧板
  P(root, rbox(0.07, H - 0.05, D - 0.06, 0.02), woodM(), -W / 2 + 0.08, (H - 0.05) / 2, 0);
  // 右侧三屉柜
  P(root, rbox(0.56, H - 0.08, D - 0.05, 0.025), woodM(), W / 2 - 0.32, (H - 0.08) / 2, 0);
  for (let i = 0; i < 3; i++) {
    const y = 0.26 + i * 0.42;
    P(root, rbox(0.46, 0.34, 0.03, 0.012), cream(), W / 2 - 0.32, y, D / 2 - 0.02);
    P(root, cyl(0.026, 0.026, 0.045, 10), metal(), W / 2 - 0.32, y, D / 2 + 0.012).rotation.x = Math.PI / 2;
  }
  // 后挡板
  P(root, rbox(W, 0.12, 0.05, 0.02), woodM(), 0, H - 0.02, -D / 2 + 0.03);

  // 台灯
  const lamp = g();
  P(lamp, cyl(0.14, 0.16, 0.035, 24), metal(), 0, 0.02, 0);
  P(lamp, cyl(0.018, 0.018, 0.55, 12), metal(), 0, 0.3, 0);
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xf6e6c6, emissive: 0xffcf8a, emissiveIntensity: 0.15,
    roughness: 0.6, side: THREE.DoubleSide,
  });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.235, 0.24, 24, 1, true), shadeMat);
  shade.position.y = 0.66;
  shade.castShadow = true;
  lamp.add(shade);
  // 罩顶
  P(lamp, cyl(0.14, 0.14, 0.02, 24), mat(0xf1dcb8, { rough: 0.6 }), 0, 0.78, 0);
  // 灯泡（会亮）
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff3d4, emissive: 0xffd79a, emissiveIntensity: 1.2, roughness: 0.4 });
  const bulb = P(lamp, sph(0.055, 12, 10), bulbMat, 0, 0.6, 0);
  const light = new THREE.PointLight(0xffca86, 0, 5.2, 2);
  light.position.set(0, 0.56, 0);
  light.castShadow = false;
  lamp.add(light);
  lamp.position.set(-W / 2 + 0.42, H + 0.045, -0.05);
  root.add(lamp);
  root.userData.lamp = { light, shadeMat, bulbMat, shade };

  // 笔筒 + 三支笔
  const pot = g();
  P(pot, cyl(0.1, 0.1, 0.2, 20), cream(), 0, 0.1, 0);
  P(pot, cyl(0.105, 0.105, 0.02, 20), mat(0xf6eddc, { rough: 0.8 }), 0, 0.2, 0);
  const penCols = [0xd9a0aa, 0x9fbcd8, 0xd9c07f];
  penCols.forEach((c, i) => {
    const p = P(pot, cyl(0.011, 0.011, 0.26, 8), mat(c, { rough: 0.6 }), -0.035 + i * 0.035, 0.24, -0.02 + i * 0.02);
    p.rotation.set(0.14 * (i - 1), 0, 0.12 * (i - 1));
  });
  pot.position.set(-W / 2 + 0.92, H + 0.045, -0.14);
  root.add(pot);

  // 水杯（半透明）
  const cup = g();
  const cupMat = new THREE.MeshStandardMaterial({
    color: 0xdfeef7, roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.5,
  });
  P(cup, cyl(0.085, 0.075, 0.19, 20), cupMat, 0, 0.095, 0);
  P(cup, cyl(0.07, 0.07, 0.012, 18), mat(0xcfe6f4, { rough: 0.08, transparent: true, opacity: 0.7 }), 0, 0.15, 0);
  const handle = P(cup, new THREE.TorusGeometry(0.055, 0.013, 8, 16), cupMat, 0.09, 0.11, 0);
  handle.rotation.y = Math.PI / 2;
  cup.position.set(-W / 2 + 1.26, H + 0.045, -0.06);
  root.add(cup);

  // 便签，斜着叠（张数跟着数据走）
  const n = Math.max(0, Math.min(6, noteCount));
  for (let i = 0; i < n; i++) {
    const note = P(root, rbox(0.18, 0.008, 0.13, 0.005), mat(0xf8ecbc, { rough: 0.95 }),
      -W / 2 + 1.54 + i * 0.04, H + 0.052 + i * 0.009, 0.06 + i * 0.035);
    note.rotation.y = -0.3 + i * 0.16;
  }

  // 摊开的画纸 + 笔
  const paper = P(root, rbox(0.5, 0.008, 0.36, 0.005), mat(0xfefcf4, { rough: 0.95 }), -W / 2 + 2.04, H + 0.052, 0.0);
  paper.rotation.y = 0.2;
  // 纸上的一点涂鸦
  for (let i = 0; i < 3; i++) {
    const s = P(root, rbox(0.16 - i * 0.02, 0.002, 0.01, 0.001), mat(0x9ec4e2, { rough: 0.9 }),
      -W / 2 + 2.02 + i * 0.02, H + 0.058, -0.02 + i * 0.05);
    s.rotation.y = 0.2;
  }
  const pen = P(root, cyl(0.011, 0.011, 0.28, 8), mat(0xc98fa0, { rough: 0.5 }), -W / 2 + 1.84, H + 0.065, 0.2);
  pen.rotation.set(0, 0.6, Math.PI / 2);

  return root;
}

/* ── 椅子 ───────────────────────────────────────────────── */
export function chair() {
  const root = g();
  root.add(contactShadow(1.0, 1.0, 0.8));
  P(root, rbox(0.54, 0.08, 0.54, 0.03), wood(), 0, 0.46, 0);
  P(root, rbox(0.5, 0.56, 0.07, 0.03), woodM(), 0, 0.76, -0.24);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    P(root, cyl(0.028, 0.024, 0.44, 10), woodD(), x * 0.21, 0.22, z * 0.21);
  // 搭在椅背上的外套
  const coatMat = mat(0xbcd3e8, { rough: 0.92 });
  const coat = P(root, rbox(0.46, 0.5, 0.16, 0.07), coatMat, 0, 0.9, -0.3);
  coat.rotation.x = 0.12;
  P(root, rbox(0.4, 0.12, 0.2, 0.05), mat(0xcfe0f0, { rough: 0.92 }), 0, 1.12, -0.26);
  return root;
}

/* ── 双屉柜 ─────────────────────────────────────────────── */
export function cabinet() {
  const root = g();
  const W = 1.5, H = 1.42, D = 0.82;
  root.add(contactShadow(W + 0.5, D + 0.5, 0.85));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    P(root, rbox(0.07, 0.12, 0.07, 0.02), woodD(), x * (W / 2 - 0.09), 0.06, z * (D / 2 - 0.09));
  P(root, rbox(W, H, D, 0.04), woodM(), 0, 0.12 + H / 2, 0);
  P(root, rbox(W + 0.08, 0.06, D + 0.08, 0.025), wood(), 0, 0.12 + H + 0.03, 0);
  for (let i = 0; i < 2; i++) {
    const y = 0.12 + H * 0.27 + i * H * 0.44;
    P(root, rbox(W - 0.16, H * 0.38, 0.05, 0.02), cream(), 0, y, D / 2 + 0.005);
    P(root, cyl(0.028, 0.028, 0.1, 10), metal(), 0, y, D / 2 + 0.045).rotation.z = Math.PI / 2;
  }
  return root;
}

/* ── 小书架（带书） ─────────────────────────────────────── */
export function shelf() {
  const root = g();
  const W = 0.6, H = 1.46, D = 1.5;
  root.add(contactShadow(W + 0.45, D + 0.45, 0.8));
  const bookCols = [0xd98b8b, 0x8fb3d4, 0xd9c07f, 0xa8c4a0, 0xc4a8d0, 0xe0b58f, 0x9fb8c9];

  P(root, rbox(W, H, 0.06, 0.02), woodM(), 0, H / 2, -D / 2);
  P(root, rbox(W, 0.08, D, 0.02), wood(), 0, H - 0.04, 0);
  P(root, rbox(W, 0.06, D, 0.02), wood(), 0, 0.03, 0);
  P(root, rbox(0.05, H, D, 0.02), wood(), -W / 2 + 0.03, H / 2, 0);
  P(root, rbox(0.05, H, D, 0.02), wood(), W / 2 - 0.03, H / 2, 0);

  const rnd = seeded(11);
  const levels = [0.08, 0.56, 1.04];
  for (const ly of levels) {
    P(root, rbox(W - 0.06, 0.05, D - 0.04, 0.015), wood(), 0, ly, 0);
    let z = -D / 2 + 0.1;
    while (z < D / 2 - 0.12) {
      const bw = 0.055 + rnd() * 0.05;
      const bh = 0.22 + rnd() * 0.14;
      const col = bookCols[Math.floor(rnd() * bookCols.length)];
      P(root, rbox(W * 0.66, bh, bw, 0.008), mat(col, { rough: 0.9 }), 0.02, ly + 0.03 + bh / 2, z + bw / 2);
      z += bw + 0.014;
    }
  }
  return root;
}

/* ── 猫（坐着，正面朝房间） ─────────────────────────────── */
export function cat() {
  const root = g();
  root.add(contactShadow(0.62, 0.56, 0.7));

  const furA = mat(0xd9a08f, { rough: 0.96 });
  const furB = mat(0xf2ded4, { rough: 0.96 });
  const dark = mat(0x4b3a3a, { rough: 0.35 });

  // 身体：竖着的蛋
  const body = P(root, sph(0.175, 22, 18), furA, 0, 0.2, -0.02);
  body.scale.set(0.92, 1.14, 0.95);
  const chest = P(root, sph(0.13, 16, 12), furB, 0, 0.19, 0.1);
  chest.scale.set(0.86, 1.0, 0.68);

  // 头
  const head = P(root, sph(0.16, 22, 18), furA, 0, 0.46, 0.015);
  head.scale.set(1.02, 0.96, 0.95);
  const face = P(root, sph(0.115, 16, 12), furB, 0, 0.432, 0.098);
  face.scale.set(1.0, 0.88, 0.72);

  // 耳朵：竖着的尖三角
  for (const s of [-1, 1]) {
    const ear = P(root, new THREE.ConeGeometry(0.072, 0.17, 4), furA, s * 0.1, 0.575, 0.0);
    ear.rotation.set(0.04, Math.PI / 4, s * 0.26);
    const inner = P(root, new THREE.ConeGeometry(0.04, 0.1, 4), mat(0xe8b3ab, { rough: 0.9 }), s * 0.1, 0.578, 0.014);
    inner.rotation.set(0.04, Math.PI / 4, s * 0.26);
  }
  // 眼睛
  for (const s of [-1, 1]) {
    const eye = P(root, sph(0.024, 10, 8), dark, s * 0.062, 0.478, 0.142);
    eye.scale.set(1, 1, 0.6);
  }
  // 鼻子
  P(root, sph(0.015, 8, 8), mat(0xd08b86, { rough: 0.5 }), 0, 0.442, 0.163);

  // 前腿 + 爪子
  for (const s of [-1, 1]) {
    P(root, cyl(0.045, 0.052, 0.21, 10), furA, s * 0.075, 0.105, 0.085);
    const paw = P(root, sph(0.05, 12, 10), furB, s * 0.075, 0.028, 0.125);
    paw.scale.set(1, 0.6, 1.2);
  }

  // 尾巴：从身后绕到脚边
  const tail = P(root, new THREE.TorusGeometry(0.19, 0.033, 8, 26, Math.PI * 1.1), furA, -0.03, 0.04, -0.05);
  tail.rotation.set(-Math.PI / 2, 0, 0.35);
  root.userData.tail = tail;

  return root;
}

/* ── 绿萝 ───────────────────────────────────────────────── */
export function plant() {
  const root = g();
  root.add(contactShadow(0.5, 0.5, 0.62, 0.008));
  P(root, cyl(0.15, 0.19, 0.22, 20), mat(0xd9a883, { rough: 0.85 }), 0, 0.11, 0);
  P(root, cyl(0.155, 0.155, 0.02, 20), mat(0x5b4634, { rough: 1 }), 0, 0.21, 0);

  const rnd = seeded(5);
  const leafA = mat(C.leaf, { rough: 0.9 });
  const leafB = mat(C.leafDark, { rough: 0.9 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.6;
    const r = 0.12 + rnd() * 0.12;
    const y = 0.3 + rnd() * 0.26;
    const s = 0.1 + rnd() * 0.07;
    const leaf = P(root, new THREE.IcosahedronGeometry(s, 0), i % 2 ? leafA : leafB,
      Math.cos(a) * r, y, Math.sin(a) * r);
    leaf.rotation.set(rnd() * 2, rnd() * 2, rnd() * 2);
    leaf.scale.set(1, 0.72, 1);
  }
  // 垂下来的一根
  const vine = P(root, cyl(0.008, 0.008, 0.34, 6), leafB, 0.16, 0.14, 0.05);
  vine.rotation.z = 0.4;
  return root;
}

/* ── 书包 ───────────────────────────────────────────────── */
export function bag() {
  const root = g();
  root.add(contactShadow(0.62, 0.5, 0.7));
  const bodyMat = mat(0x9fb8cf, { rough: 0.88 });
  P(root, rbox(0.42, 0.5, 0.26, 0.09), bodyMat, 0, 0.26, 0);
  P(root, rbox(0.44, 0.16, 0.28, 0.07), mat(0xb6cbdd, { rough: 0.88 }), 0, 0.46, 0);
  P(root, rbox(0.3, 0.2, 0.06, 0.04), mat(0x7e9bb8, { rough: 0.85 }), 0, 0.2, 0.15);
  // 背带
  for (const s of [-1, 1]) {
    const st = P(root, new THREE.TorusGeometry(0.14, 0.018, 6, 14, Math.PI), mat(0x7e9bb8, { rough: 0.8 }), s * 0.1, 0.42, -0.12);
    st.rotation.set(0.3, Math.PI / 2, 0);
  }
  return root;
}

/* ── 摊开的笔记本（上面有字） ───────────────────────────── */
export function openNotebook() {
  const root = g();
  const paperMat = mat(0xfdfaf2, { rough: 0.95 });
  const lineMat = mat(0x9fadbd, { rough: 0.9 });
  P(root, rbox(0.32, 0.011, 0.23, 0.004), paperMat, -0.081, 0.006, 0);
  P(root, rbox(0.32, 0.011, 0.23, 0.004), paperMat, 0.081, 0.006, 0);
  P(root, rbox(0.022, 0.015, 0.23, 0.006), mat(0xe9ddc6, { rough: 0.9 }), 0, 0.008, 0);
  for (let i = 0; i < 5; i++) {
    P(root, rbox(0.2, 0.004, 0.007, 0.002), lineMat, -0.09, 0.013, -0.068 + i * 0.033);
  }
  for (let i = 0; i < 4; i++) {
    P(root, rbox(0.17, 0.004, 0.007, 0.002), lineMat, 0.088, 0.013, -0.05 + i * 0.033);
  }
  return root;
}

/* ── 床头的气球（生日留到现在，瘪了一个） ───────────────── */
export function balloons() {
  const root = g();
  const skin = mat(0xf0a6b6, { rough: 0.45 });
  const skin2 = mat(0xd98da0, { rough: 0.6 });
  const str = mat(0xeee6d8, { rough: 0.9 });

  // 还鼓着的那个
  const b1 = P(root, sph(0.125, 18, 14), skin, 0, 0.2, 0);
  b1.scale.set(1, 1.18, 0.92);
  P(root, new THREE.ConeGeometry(0.028, 0.055, 8), skin, 0, 0.065, 0);
  P(root, cyl(0.0035, 0.0035, 0.46, 4), str, 0, -0.19, 0);

  // 瘪了的那个：压扁、塌下去
  const b2 = P(root, sph(0.115, 18, 14), skin2, 0.235, -0.03, 0.05);
  b2.scale.set(1.12, 0.42, 0.76);
  b2.rotation.z = 0.22;
  P(root, cyl(0.0035, 0.0035, 0.5, 4), str, 0.26, -0.28, 0.05).rotation.z = 0.06;

  return root;
}

/* ── 桌上留着的纸垫和小碟（昨天的） ─────────────────────── */
export function foodPaper() {
  const root = g();
  P(root, rbox(0.29, 0.005, 0.23, 0.004), mat(0xfaf6ee, { rough: 0.96 }), 0, 0.004, 0);
  // 油渍
  P(root, cyl(0.05, 0.05, 0.001, 14), mat(0xeee0c8, { rough: 0.9 }), -0.05, 0.008, 0.03);
  // 小醋碟
  P(root, cyl(0.058, 0.048, 0.022, 18), mat(0xe9e3d6, { rough: 0.55 }), 0.045, 0.016, -0.02);
  P(root, cyl(0.04, 0.04, 0.002, 14), mat(0x9c8058, { rough: 0.55 }), 0.045, 0.027, -0.02);
  return root;
}
/* ── 桌上散着的几支笔 ───────────────────────────────────── */
export function pencils() {
  const root = g();
  const cols = [0xd9a05b, 0x7fa87a, 0x8fbde0];
  const lay = [
    [-0.02, 0.02, 0.5],
    [0.05, -0.02, 1.35],
    [-0.06, 0.05, 0.95],
  ];
  lay.forEach(([dx, dz, ry], i) => {
    const p = P(root, cyl(0.011, 0.011, 0.27, 8), mat(cols[i], { rough: 0.72 }), dx, 0.012, dz);
    p.rotation.z = Math.PI / 2;
    p.rotation.y = ry;
    // 削出来的笔尖
    const tip = P(root, new THREE.ConeGeometry(0.011, 0.05, 8), mat(0xf0e2c8, { rough: 0.85 }),
      dx + Math.cos(ry) * 0.15, 0.012, dz - Math.sin(ry) * 0.15);
    tip.rotation.z = Math.PI / 2;
    tip.rotation.y = ry;
  });
  return root;
}

/* ── 墙上的画（歪歪的小鱼） ─────────────────────────────── */
export function fishArt() {
  const root = g();
  const W = 0.72, H = 0.86;
  // 画框（颜色靠近墙，不抢眼）
  P(root, rbox(W + 0.02, H + 0.02, 0.03, 0.01), mat(0xd9cab4, { rough: 0.85 }), 0.008, -0.008, -0.006);
  P(root, rbox(W, H, 0.05, 0.012), mat(0xf4eee2, { rough: 0.8 }), 0, 0, 0);
  P(root, rbox(W - 0.1, H - 0.1, 0.02, 0.006), mat(0xfaf6ec, { rough: 0.9 }), 0, 0, 0.035);

  // 一条蓝色的鱼（画得歪歪的，但认得出）
  const fishMat = mat(0x8fbde2, { rough: 0.85 });
  const body = P(root, sph(0.13, 18, 14), fishMat, 0.02, 0.05, 0.055);
  body.scale.set(1.7, 0.95, 0.28);
  // 尾巴
  const tail = P(root, new THREE.ConeGeometry(0.095, 0.16, 3), fishMat, -0.19, 0.05, 0.055);
  tail.rotation.set(0, 0, Math.PI / 2);
  tail.scale.set(1, 1, 0.3);
  // 眼睛
  P(root, sph(0.018, 8, 8), mat(0x46505e, { rough: 0.4 }), 0.14, 0.075, 0.075);
  // 背鳍
  const fin = P(root, new THREE.ConeGeometry(0.05, 0.09, 3), fishMat, 0.02, 0.15, 0.055);
  fin.scale.set(1, 1, 0.3);
  // 水纹两道
  for (let i = 0; i < 2; i++) {
    const w = P(root, rbox(0.26 - i * 0.07, 0.014, 0.01, 0.004), fishMat, -0.04, -0.17 - i * 0.06, 0.056);
    w.rotation.z = 0.05 - i * 0.03;
  }
  return root;
}

/* ── 桌上小物 ───────────────────────────────────────────── */
export function comics() {
  const root = g();
  const cols = [0xd9d0c4, 0xd98b9a, 0x8fb3d4];
  cols.forEach((c, i) => {
    P(root, rbox(0.34, 0.05, 0.26, 0.008), mat(c, { rough: 0.9 }), i * 0.008, 0.03 + i * 0.05, i * 0.01);
  });
  return root;
}

export function photoFrame() {
  const root = g();
  P(root, rbox(0.3, 0.38, 0.03, 0.01), wood(), 0, 0.19, 0);
  P(root, rbox(0.24, 0.32, 0.012, 0.004), mat(0xfdfaf2, { rough: 0.9 }), 0, 0.19, 0.02);
  const stand = P(root, rbox(0.04, 0.22, 0.02, 0.005), wood(), 0, 0.1, -0.08);
  stand.rotation.x = 0.25;
  return root;
}

/* ── 懒人豆袋 ───────────────────────────────────────────── */
export function beanbag() {
  const root = g();
  root.add(contactShadow(1.0, 0.95, 0.8));
  const m = mat(0xc0aad2, { rough: 0.99 });
  const b = P(root, sph(0.34, 26, 20), m, 0, 0.22, 0);
  b.scale.set(1.08, 0.7, 1.02);
  // 坐出来的那个坑
  const dent = P(root, sph(0.24, 20, 14), mat(0xb09bc4, { rough: 0.99 }), 0, 0.3, 0.05);
  dent.scale.set(1.0, 0.34, 0.82);
  // 缝线
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(0.33, 0.008, 6, 30),
    mat(0xa894bc, { rough: 0.95 })
  );
  seam.rotation.x = Math.PI / 2;
  seam.position.y = 0.16;
  seam.scale.set(1.06, 1.06, 0.7);
  root.add(seam);
  return root;
}

/* ── 落地灯 ─────────────────────────────────────────────── */
export function floorLamp() {
  const root = g();
  root.add(contactShadow(0.62, 0.62, 0.6));
  const metal = mat(0xc0b3a2, { rough: 0.42, metal: 0.6 });
  P(root, cyl(0.19, 0.21, 0.04, 22), metal, 0, 0.02, 0);
  P(root, cyl(0.019, 0.019, 1.18, 10), metal, 0, 0.62, 0);

  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xf7e9cb, emissive: 0xffcf8a, emissiveIntensity: 0.15,
    roughness: 0.6, side: THREE.DoubleSide,
  });
  P(root, new THREE.CylinderGeometry(0.16, 0.25, 0.27, 24, 1, true), shadeMat, 0, 1.32, 0);
  P(root, cyl(0.16, 0.16, 0.02, 24), mat(0xf1dcb8, { rough: 0.6 }), 0, 1.45, 0);

  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d4, emissive: 0xffd79a, emissiveIntensity: 1.1, roughness: 0.4,
  });
  P(root, sph(0.055, 12, 10), bulbMat, 0, 1.26, 0);

  const light = new THREE.PointLight(0xffca86, 0, 4.6, 2);
  light.position.set(0, 1.22, 0);
  root.add(light);

  root.userData.lamp = { light, shadeMat, bulbMat };
  return root;
}

/* ── 左墙上的软木板（钉着几张纸片） ─────────────────────── */
export function pinBoard() {
  const root = g();
  P(root, rbox(0.96, 0.74, 0.05, 0.02), mat(0xd9c2a2, { rough: 0.96 }), 0, 0, 0);
  P(root, rbox(0.88, 0.66, 0.02, 0.008), mat(0xc7ab88, { rough: 1.0 }), 0, 0, 0.032);

  const papers = [
    [-0.2, 0.16, 0.21, 0.17, 0.06, 0xfdfaf0],
    [0.13, 0.2, 0.17, 0.23, -0.09, 0xf8ecbc],
    [0.19, -0.13, 0.25, 0.15, 0.05, 0xdfeaf2],
    [-0.13, -0.17, 0.19, 0.13, -0.05, 0xf2ddd8],
  ];
  for (const [px, py, pw, ph, rz, col] of papers) {
    const p = P(root, rbox(pw, ph, 0.008, 0.004), mat(col, { rough: 0.95 }), px, py, 0.048);
    p.rotation.z = rz;
    P(root, sph(0.013, 8, 8), mat(0xd08b86, { rough: 0.5 }), px, py + ph / 2 - 0.016, 0.058);
  }
  return root;
}

/* ── 挂钟 ───────────────────────────────────────────────── */
export function clock() {
  const root = g();
  // 圆柱默认轴朝上，转 90° 让钟面朝房间
  const face = g();
  face.rotation.x = Math.PI / 2;
  P(face, cyl(0.26, 0.26, 0.06, 32), mat(0xf2e7d4, { rough: 0.7 }), 0, 0, 0);
  P(face, cyl(0.23, 0.23, 0.062, 32), mat(0xfdfaf3, { rough: 0.9 }), 0, 0.004, 0);
  // 刻度和指针
  P(face, rbox(0.014, 0.14, 0.012, 0.004), mat(0x6b6270, { rough: 0.5 }), 0, 0.05, 0.038);
  P(face, rbox(0.1, 0.014, 0.012, 0.004), mat(0x6b6270, { rough: 0.5 }), 0.035, 0, 0.04);
  P(face, sph(0.014, 10, 8), mat(0x8a7f8c, { rough: 0.5 }), 0, 0, 0.042);
  for (let i = 0; i < 12; i += 3) {
    const a = (i / 12) * Math.PI * 2;
    P(face, rbox(0.012, 0.03, 0.01, 0.003), mat(0xb9aeb8, { rough: 0.6 }),
      Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0.036);
  }
  root.add(face);
  return root;
}

/* ── 一串小灯（挂墙上，晚上会亮） ────────────────────────── */
export function stringLights() {
  const root = g();
  const pts = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector3(-2.1 + t * 4.2, 2.86 - Math.sin(t * Math.PI) * 0.26, 0.05));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.009, 5, false),
    mat(0x9b8b79, { rough: 0.7 }));
  root.add(wire);

  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffe9c2, emissive: 0xffbe72, emissiveIntensity: 1.5, roughness: 0.35,
  });
  for (let i = 1; i < N; i++) {
    const p = curve.getPoint(i / N);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), bulbMat);
    b.position.set(p.x, p.y - 0.033, p.z + 0.02);
    root.add(b);
  }
  root.userData.bulbMat = bulbMat;
  return root;
}

/* ── 墙上的小照片框（成组错落挂着） ─────────────────────── */
export function wallPhotos() {
  const root = g();
  const spec = [
    [-0.62, 2.6, 0.34, 0.42, 0.03, 0xd9c3a0, 0xf3e6d4],
    [-0.92, 2.12, 0.24, 0.3, -0.06, 0xe0cdb2, 0xdfeaf2],
    [-0.3, 2.22, 0.2, 0.24, 0.07, 0xd9c3a0, 0xf2ddd8],
  ];
  for (const [x, y, w, h, rz, frameCol, artCol] of spec) {
    const f = g();
    P(f, rbox(w, h, 0.035, 0.008), mat(frameCol, { rough: 0.72 }), 0, 0, 0);
    P(f, rbox(w - 0.07, h - 0.07, 0.012, 0.004), mat(artCol, { rough: 0.9 }), 0, 0, 0.024);
    f.position.set(x, y, 0);
    f.rotation.z = rz;
    root.add(f);
  }
  return root;
}

/* ── 桌上的一摞书 ───────────────────────────────────────── */
export function bookStack() {
  const root = g();
  const cols = [0xd9a0aa, 0xa8c4c9, 0xe6d3a8, 0xc4b0d0];
  let y = 0;
  const rnd = seeded(23);
  cols.forEach((c, i) => {
    const w = 0.26 - i * 0.014, d = 0.19 - i * 0.01, h = 0.045 + rnd() * 0.02;
    const b = P(root, rbox(w, h, d, 0.006), mat(c, { rough: 0.9 }), 0, y + h / 2, 0);
    b.rotation.y = (rnd() - 0.5) * 0.18;
    y += h + 0.004;
  });
  return root;
}

/* ── 桌角的小摆件（一只小鲸鱼石雕之类） ─────────────────── */
export function deskTrinket() {
  const root = g();
  P(root, cyl(0.05, 0.06, 0.05, 14), mat(0xbfa98a, { rough: 0.6 }), 0, 0.025, 0);
  const s = P(root, sph(0.045, 14, 12), mat(0x9fc4dd, { rough: 0.7 }), 0, 0.085, 0);
  s.scale.set(1.5, 0.9, 1.0);
  return root;
}

/* ── 床尾搭着的一条毯子 ─────────────────────────────────── */
export function bedThrow() {
  const root = g();
  P(root, rbox(2.14, 0.05, 0.62, 0.04), mat(0xe2d0b4, { rough: 0.98 }), 0, 0.025, 0);
  P(root, rbox(2.0, 0.03, 0.44, 0.03), mat(0xeddfc6, { rough: 0.98 }), 0, 0.055, 0.03);
  return root;
}

/* ── 地板上的毛绒兔子 ───────────────────────────────────── */
export function plushRabbit() {
  const root = g();
  const fur = mat(0xf0e2e6, { rough: 0.98 });
  const body = P(root, sph(0.11, 16, 12), fur, 0, 0.13, 0);
  body.scale.set(1, 1.15, 0.95);
  const head = P(root, sph(0.09, 16, 12), fur, 0, 0.27, 0.01);
  for (const s of [-1, 1]) {
    const ear = P(root, cyl(0.022, 0.03, 0.16, 8), fur, s * 0.045, 0.4, 0);
    ear.rotation.z = s * 0.16;
  }
  P(root, sph(0.012, 8, 8), mat(0x5a4c50, { rough: 0.4 }), -0.032, 0.285, 0.082);
  P(root, sph(0.012, 8, 8), mat(0x5a4c50, { rough: 0.4 }), 0.032, 0.285, 0.082);
  root.add(contactShadow(0.4, 0.34, 0.6));
  return root;
}

/* ── 柜顶的小闹钟 ───────────────────────────────────────── */
export function deskAlarm() {
  const root = g();
  P(root, cyl(0.07, 0.07, 0.04, 20), mat(0xf2e7d4, { rough: 0.6 }), 0, 0.02, 0).rotation.x = Math.PI / 2;
  P(root, cyl(0.06, 0.06, 0.042, 20), mat(0xfdfaf3, { rough: 0.9 }), 0, 0.02, 0.003).rotation.x = Math.PI / 2;
  P(root, rbox(0.008, 0.04, 0.008, 0.002), mat(0x6b6270), 0, 0.03, 0.026);
  P(root, rbox(0.03, 0.008, 0.008, 0.002), mat(0x6b6270), 0.012, 0.02, 0.026);
  return root;
}

/* ── 桌底下的收纳篮 ─────────────────────────────────────── */
export function basket() {
  const root = g();
  root.add(contactShadow(0.6, 0.5, 0.6));
  P(root, rbox(0.42, 0.26, 0.34, 0.06), mat(0xd8c5a8, { rough: 0.96 }), 0, 0.13, 0);
  P(root, rbox(0.45, 0.05, 0.37, 0.025), mat(0xe4d5bc, { rough: 0.96 }), 0, 0.27, 0);
  P(root, rbox(0.28, 0.1, 0.18, 0.02), mat(0xc98f9c, { rough: 0.9 }), 0.02, 0.22, 0);
  P(root, rbox(0.24, 0.07, 0.16, 0.02), mat(0x9fb8cf, { rough: 0.9 }), -0.03, 0.3, 0.02);
  return root;
}

/* ── 门后挂着的帽子 ─────────────────────────────────────── */
export function hookHat() {
  const root = g();
  P(root, cyl(0.016, 0.016, 0.09, 8), mat(0xbfa98a, { rough: 0.5 }), 0, 0, 0.045).rotation.x = Math.PI / 2;
  P(root, cyl(0.05, 0.028, 0.05, 10), mat(0xbfa98a, { rough: 0.5 }), 0, 0, 0.07).rotation.x = Math.PI / 2;
  const cap = P(root, sph(0.105, 16, 12), mat(0x9fb8cf, { rough: 0.92 }), 0, -0.05, 0.16);
  cap.scale.set(1, 0.82, 0.92);
  P(root, cyl(0.125, 0.125, 0.014, 22), mat(0x8aa8c4, { rough: 0.92 }), 0.02, -0.11, 0.2).rotation.x = 0.18;
  return root;
}

/* ── 窗台上的小玻璃瓶 ───────────────────────────────────── */
export function bottle() {
  const root = g();
  const glass = mat(0xd2e6f2, { rough: 0.12, transparent: true, opacity: 0.55 });
  P(root, cyl(0.048, 0.056, 0.13, 16), glass, 0, 0.065, 0);
  P(root, cyl(0.018, 0.03, 0.055, 12), glass, 0, 0.155, 0);
  P(root, cyl(0.019, 0.019, 0.012, 12), mat(0xa8bfa0, { rough: 0.8 }), 0, 0.188, 0);
  return root;
}
