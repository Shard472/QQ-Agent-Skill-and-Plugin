// 房间里的东西：位置、朝向、和 world.json 的对应关系
import * as THREE from 'three';
import * as F from './furniture.js';
import { rbox, mat, P, g } from './util.js';

/** 一片窗帘：用一叠窄布条叠出褶皱，不是一块板 */
function curtain(side) {
  const root = g();
  const clothA = mat(0xf4ead9, { rough: 1.0 });
  const clothB = mat(0xe9dbc6, { rough: 1.0 });
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const w = 0.05 + Math.sin(t * Math.PI) * 0.022;
    const h = 1.9 - Math.sin(t * Math.PI) * 0.05;
    const zoff = Math.sin(t * Math.PI * 2.6) * 0.032;
    const seg = P(root, rbox(w, h, 0.085, 0.018), i % 2 ? clothA : clothB,
      side * i * 0.052, -h / 2 + 0.02, zoff);
    seg.rotation.z = side * (0.014 + i * 0.005);
    seg.rotation.y = Math.sin(t * 4) * 0.05;
  }
  return root;
}

export function buildScene(room, world, HALF) {
  const items = new Map((((world || {}).items) || []).map((i) => [i.uid, i]));
  const has = (uid) => items.has(uid);
  const notes = (((world || {}).notes) || []).filter((n) => (n.spotId || 'desk') === 'desk');
  // 数据里的「痕迹」：真发生过的事，房间里就该留下东西
  const traceSet = new Set((((world || {}).traces) || []).map((t) => t.id));
  const hasTrace = (id) => traceSet.has(id);

  const out = { items, notes, pickables: [] };
  const put = (obj, x, y, z, ry = 0, name = '') => {
    obj.position.set(x, y, z);
    if (ry) obj.rotation.y = ry;
    obj.userData.name = name;
    room.add(obj);
    return obj;
  };
  // 可以被鼠标指到 / 点开的东西
  const pick = (obj, name, line) => {
    obj.userData.name = name;
    obj.userData.line = line || '';
    out.pickables.push(obj);
    return obj;
  };

  /* ── 大件 ────────────────────────────────────────────── */

  // 床：靠后墙左侧，床头贴墙
  out.bed = pick(put(F.bed(has('it_plush')), -1.5, 0, -2.3, 0), '她的床',
    '被子是粉的。鲸鱼抱枕不抱着睡不着，抱久了又嫌它占地方。');

  // 生日留下的两个气球，一个已经瘪了
  if (hasTrace('tr_bday')) {
    out.balloons = pick(put(F.balloons(), -1.88, 1.5, -3.42, 0.16), '两个气球',
      '生日那天飘在这儿的。现在瘪了一个，我没舍得摘。');
  }

  // 书桌：靠左墙，桌面长边顺着墙（便签单独做，才能点开）
  out.desk = put(F.desk(0), -3.9, 0, 0.3, Math.PI / 2, '书桌');
  out.lamp = out.desk.userData.lamp;
  pick(out.desk, '书桌', '摊着的是昨天没查完的东西。笔没盖上，明天接着查。');

  // 桌上的便签：张数跟着数据走，点开能看见写的是什么
  {
    const ng = new THREE.Group();
    const n = Math.max(1, Math.min(4, notes.length || 1));
    for (let i = 0; i < n; i++) {
      const note = P(ng, rbox(0.19, 0.008, 0.14, 0.005), mat(0xf8ecbc, { rough: 0.95 }),
        i * 0.026, i * 0.009, i * 0.032);
      note.rotation.y = -0.32 + i * 0.14;
    }
    ng.position.set(-3.84, 1.39, 0.02);
    ng.rotation.y = 0.52;
    room.add(ng);
    const first = notes[0] || {};
    const txt = String(first.text || first.content || first.note || '').trim();
    out.notesMesh = pick(ng, '桌上的便签', txt ? txt.slice(0, 90) : '这张还没写。');
  }

  // 桌上的书堆和小摆件
  put(F.bookStack(), -3.8, 1.385, -0.52, 0.42);
  put(F.deskTrinket(), -4.06, 1.385, 1.16, 0.3);

  // 摊开的笔记本和几支笔（桌面靠前那一半空着）
  put(F.openNotebook(), -3.76, 1.39, 0.42, Math.PI / 2 + 0.1);
  put(F.pencils(), -3.72, 1.39, 0.96, 0);

  // 桌上留着的纸垫和小碟——数据里记着"昨天在这儿吃的"，这里就真的有
  if (hasTrace('tr_paper')) {
    out.foodPaper = pick(put(F.foodPaper(), -3.62, 1.39, -0.76, 0.34), '桌上的纸垫',
      '昨天在这儿吃的。纸垫没扔，说等下收，就一直搁到现在。');
  }

  // 椅子：被拉开一点，斜着
  out.chair = pick(put(F.chair(), -3.02, 0, 0.62, Math.PI / 2 + 0.26), '椅子',
    '外套先搭这儿。等下还要穿。');

  // 双屉柜：后墙右段
  out.cabinet = pick(put(F.cabinet(), 3.0, 0, -4.02, 0), '柜子',
    '上面那个抽屉，不能给别人看。');

  // 小书架：后墙最左边
  out.shelf = pick(put(F.shelf(), -3.42, 0, -3.82, 0), '书架',
    '书是按颜色排的，不是按高矮。这样好看。');

  /* ── 柜顶 / 窗台 / 墙上 ──────────────────────────────── */

  if (has('it_comic')) put(F.comics(), 2.66, 1.56, -4.05, 0.18);
  if (has('it_frame')) put(F.photoFrame(), 3.36, 1.56, -4.08, -0.42);
  if (has('it_plant')) out.plant = pick(put(F.plant(), 1.2, 1.22, -4.28, 0), '窗台上的绿萝',
    '三天没浇水了……明天一定记得。');
  if (has('it_fish')) put(F.fishArt(), -1.5, 2.34, -4.37, 0);
  // 钟挂在书架右边的墙上（再高就出画面了）
  put(F.clock(), -2.86, 2.52, -4.37, 0);
  put(F.wallPhotos(), 0, 0, -4.37, 0);

  // 串灯：挂在左墙上，晚上才亮
  out.strings = put(F.stringLights(), -4.4, 0, -1.4, Math.PI / 2);

  // 左墙上书桌上方的软木板，钉着她收着的纸片
  out.pinBoard = pick(put(F.pinBoard(), -4.38, 2.0, 0.42, Math.PI / 2), '软木板',
    '钉着的都是不能弄丢的：课表、一张票根、还有我自己画的那条鲸鱼。');

  // 柜顶小闹钟
  put(F.deskAlarm(), 2.3, 1.53, -4.12, 0.5);

  // 书架顶上的一小盆
  const sp = put(F.plant(), -3.42, 1.48, -3.82, 0.7);
  sp.scale.setScalar(0.55);

  // 窗台上的小瓶子
  put(F.bottle(), 1.72, 1.31, -4.26, 0);

  // 右前角：懒人豆袋 + 落地灯（把右边那块空地填上）
  out.beanbag = pick(put(F.beanbag(), 3.15, 0, 1.34, -0.45), '懒人豆袋',
    '坐下去就起不来了。');
  out.floorLamp = put(F.floorLamp(), 3.72, 0, -0.62, 0);
  out.floorLampLight = out.floorLamp.userData.lamp;

  /* ── 地上的小东西 ────────────────────────────────────── */

  if (has('it_bag')) out.bag = pick(put(F.bag(), 3.46, 0, 0.52, -0.32), '书包',
    '明天要交的作业在夹层里，别忘。');

  // 地板上的一只毛绒兔子
  out.rabbit = pick(put(F.plushRabbit(), 0.05, 0, 2.55, 0.6), '毛绒兔子',
    '不知道什么时候多出来的。耳朵掉过一次，我自己缝的，缝歪了。');

  // 桌底下的收纳篮
  put(F.basket(), -3.62, 0, 1.45, 0.3);

  // 门后挂着的帽子
  put(F.hookHat(), -4.36, 2.32, 2.05, Math.PI / 2);

  // 猫：坐在地毯上（会自己挪地方，位置见 catalog 末尾的 CAT_SPOTS）
  out.cat = pick(put(F.cat(), 1.75, 0, 1.3, -0.55), '她的猫',
    '它叫布丁，昨天从纸箱里抱回来的橘猫。喊它名字耳朵会动一下，但不一定过来。');

  /* ── 窗帘 ────────────────────────────────────────────── */
  const cl = put(curtain(-1), 2.52, 2.06, -4.36, 0);
  const cr = put(curtain(1), -0.12, 2.06, -4.36, 0);
  out.curtains = [cl, cr];
  const rod = P(room, new THREE.CylinderGeometry(0.022, 0.022, 2.66, 10),
    mat(0xbfa98a, { rough: 0.5 }), 1.2, 4.02, -4.33);
  rod.rotation.z = Math.PI / 2;

  return out;
}
