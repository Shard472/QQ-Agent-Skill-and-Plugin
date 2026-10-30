// 小工具：几何体、材质、网格
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** 圆角盒：程序化家具里最重要的一个东西，硬边一圆角就柔和了 */
export function rbox(w, h, d, r = 0.04, seg = 3) {
  const rad = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return new RoundedBoxGeometry(w, h, d, seg, rad);
}

/** 材质：默认粗糙（哑光），需要发光就传 emissive */
export function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.82,
    metalness: o.metal ?? 0.0,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emI ?? 0,
    flatShading: o.flat ?? false,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    map: o.map ?? null,
  });
}

export const cyl = (rt, rb, h, seg = 24) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const sph = (r, w = 18, h = 14) => new THREE.SphereGeometry(r, w, h);

/** 造一个 mesh，默认开阴影 */
export function M(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 把 mesh 挂到 group 上（父级也可能需要位置） */
export function P(parent, geo, material, x = 0, y = 0, z = 0) {
  const m = M(geo, material, x, y, z);
  parent.add(m);
  return m;
}

export const g = () => new THREE.Group();

/* ── 接触阴影：一片柔和的暗，贴在家具脚底下 ─────────────────
   切角房间里的方向光，影子永远落在墙那边（观众看不到）。
   所以每个物件自己带一片"脚底暗"，这才有落地的重量感。 */
let _shadowTex = null;
function shadowTexture() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(64, 64, 0, 64, 64, 62);
  grd.addColorStop(0, 'rgba(72,54,38,0.62)');
  grd.addColorStop(0.42, 'rgba(72,54,38,0.30)');
  grd.addColorStop(0.78, 'rgba(72,54,38,0.08)');
  grd.addColorStop(1, 'rgba(72,54,38,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 128, 128);
  _shadowTex = new THREE.CanvasTexture(c);
  _shadowTex.colorSpace = THREE.SRGBColorSpace;
  return _shadowTex;
}

export function contactShadow(w, d, op = 1, y = 0.013) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(), transparent: true, opacity: op,
      depthWrite: false, toneMapped: false,
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.renderOrder = 1;
  return m;
}

/** 固定种子的伪随机，保证每次打开书脊颜色一样 */
export function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
