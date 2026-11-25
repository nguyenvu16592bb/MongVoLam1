/* Kiểm thử collider nước + follower/NPC không đi vào nước (WATER-BEGIN) — không cần trình duyệt.
   Nạp src/01-data.js + src/02-world.js + src/02b-env.js vào vm với stub THREE
   ghi lại mesh (mẫu tools/test-ground.cjs), dựng world thật (Engine.createWorld
   + initPopulation, collider thật), rồi kiểm tra:
   - WATER_RECTS: đủ 6 hình nước, trong bounds bản đồ, không phủ cầu đá,
     không phủ điểm đáp cổng / lịch trình NPC / rương / điểm câu-sen.
   - isWalkable: false khắp lòng hồ sen (dải z 6.5..10.5 + khe đông) và khắp
     6 khoảng nước vùng mở rộng; true trên 2 dải cầu đá + đất liền + mép đất.
   - Luật cũ giữ nguyên: hồ khu cũ vẫn chặn, cầu vẫn đi được, q3 vẫn xong
     khi bước qua cầu (mô phỏng PlayerController.update từng bước).
   - Click-to-move vào hồ / đi xuyên vùng nước mở rộng: nhân vật dừng ở mép
     nước, không bao giờ đứng trên nước.
   - Follower (pet + đội trưởng): đi theo player qua cầu (kể cả mép đông cầu
     hẹp, đích lệch ra ngoài nước) + dịch chuyển tức thời khi xa >12 mà đích
     ở trong nước — mọi vị trí đều đi được.
   - NPC lang thang: waypoint quanh neo gần hồ (Nữ Hiệp Cầu Đá, thú cưng,
     trẻ con) luôn đi được; đi bộ qua cầu + về nhà khu mở rộng không vào nước.
   - Bắc Uyển (vm riêng, src/10-district.js + src/10b-districts.js): hồ đã có
     collider nước (case 'pond' đăng ký addCollider) nên không đi xuyên được.
   Chạy: node tools/test-world.cjs (sau node tools/build.mjs để kiểm tra build). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}

/* ---- stub THREE (mẫu tools/test-ground.cjs) + V3.lerp cho camera follow ---- */
function mkRot() { return { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }; }
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  lerp(o, t) { this.x += (o.x - this.x) * t; this.y += (o.y - this.y) * t; this.z += (o.z - this.z) * t; return this; }
}
class V2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class Node {
  constructor() { this.position = new V3(); this.rotation = mkRot(); this.scale = new V3(1, 1, 1); this.children = []; }
  add(c) { this.children.push(c); return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
}
class Group extends Node {}
class Scene extends Node { constructor() { super(); this.background = null; this.fog = null; } }
const allMeshes = [];
class Mesh extends Node {
  constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; allMeshes.push(this); }
  clone() {
    const c = new Mesh(this.geometry, this.material);
    c.position = this.position.clone(); c.rotation = { ...this.rotation }; c.scale = this.scale.clone();
    c.castShadow = this.castShadow; c.receiveShadow = this.receiveShadow;
    return c;
  }
}
class InstancedMesh extends Mesh {
  constructor(geo, mat, count) { super(geo, mat); this.count = count; this.instanceMatrix = { needsUpdate: false }; }
  setMatrixAt() {}
}
class Points extends Node { constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; this.visible = true; } }
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(n, a) { this.attributes[n] = a; }
  setDrawRange() {}
}
class BufferAttribute { constructor(arr, size) { this.array = arr; this.itemSize = size; } }
const geo = t => class { constructor(...a) { this.type = t; this.args = a; } };
class Mat { constructor(p = {}) { Object.assign(this, p); } }
class CanvasTexture { constructor(c) { this.canvas = c; this.wrapS = null; this.wrapT = null; this.repeat = { set() {} }; } }
class Color { constructor(c) { this.c = c; } set(v) { this.c = v; return this; } }
class FogExp2 { constructor(c, d) { this.color = new Color(c); this.density = d; } }
class OrthoCam extends Node {
  constructor(l, r, t, b, n, f) { super(); this.left = l; this.right = r; this.top = t; this.bottom = b; this.near = n; this.far = f; }
  lookAt() {} updateProjectionMatrix() {}
}
class Light extends Node {
  constructor(c, i) { super(); this.color = new Color(c); this.intensity = i; this.shadow = { mapSize: {}, camera: {} }; }
}
class HemiLight extends Light {}
class DirLight extends Light {}
class PointLight extends Light { constructor(c, i, d) { super(c, i); this.distance = d; } }
class Raycaster { constructor() { this.ray = { intersectPlane: () => null }; } setFromCamera() {} }
class PlaneObj { constructor(v, c) { this.normal = v; this.constant = c; } }
class Object3D extends Node { updateMatrix() {} }
const THREE = {
  Vector3: V3, Vector2: V2, Group, Scene, Mesh, InstancedMesh, Points,
  BufferGeometry, BufferAttribute, Object3D,
  BoxGeometry: geo('Box'), PlaneGeometry: geo('Plane'), CylinderGeometry: geo('Cylinder'),
  ConeGeometry: geo('Cone'), SphereGeometry: geo('Sphere'), RingGeometry: geo('Ring'),
  CircleGeometry: geo('Circle'), DodecahedronGeometry: geo('Dodecahedron'),
  TorusGeometry: geo('Torus'),
  MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, PointsMaterial: Mat,
  CanvasTexture, Color, FogExp2, OrthographicCamera: OrthoCam,
  HemisphereLight: HemiLight, DirectionalLight: DirLight, PointLight,
  Raycaster, Plane: PlaneObj
};

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
function mkEl() {
  return {
    textContent: '', innerHTML: '', style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {},
    getContext: () => ({
      fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {},
      moveTo() {}, lineTo() {}, stroke() {}, measureText: () => ({ width: 100 }),
      createLinearGradient: () => ({ addColorStop() {} })
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
  };
}
const els = {};
const document = {
  querySelector: s => (s === '#three-canvas' ? null : (els[s] || (els[s] = mkEl()))),
  querySelectorAll: () => [],
  getElementById: id => { if (!els[id]) els[id] = mkEl(); return els[id]; },
  createElement: () => mkEl(),
  body: {}
};
const toasts = [];
const sandbox = {
  console, Math, JSON, setTimeout: fn => { fn(); return 0; },
  THREE, localStorage, document, performance: { now: () => 0 },
  window: {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, addEventListener() {},
    matchMedia: () => ({ matches: true })
  },
  navigator: { hardwareConcurrency: 8 },
  Game: { mode: 'world' },
  UI: { toast: m => toasts.push(String(m)), syncWorld() {}, openModal() {}, showScreen() {} },
  Sfx: { click() {}, coin() {}, ensure() {}, heal() {}, level() {}, win() {}, lose() {}, skill() {}, hit() {}, crit() {} }
};
vm.createContext(sandbox);
const src = read('src/01-data.js') + '\n' + read('src/02-world.js') + '\n' + read('src/02b-env.js') +
  '\n;globalThis.__T = { Env, State, Engine, SaveManager, PlayerController, CharacterManager, Followers, NpcAI, InteractWorld, Sfx, UI, WATER_RECTS, GROUND_LAYERS, FISH_SPOT, LOTUS_SPOT, CHEST_DEFS, NPC_SCHEDULES, PET_DEFS, NPC_NEW_DEFS, BUTTERFLY_ANCHORS };';
vm.runInContext(src, sandbox);
const T = sandbox.__T;
const { Env, State, Engine, PlayerController, CharacterManager, Followers, NpcAI } = T;
/* UI/Sfx thật trong 01-data.js che stub sandbox: ghi đè để harness bắt được. */
T.UI.toast = m => { toasts.push(String(m)); };
T.UI.syncWorld = () => {};
T.UI.openModal = () => {};
T.UI.showScreen = () => {};
T.Sfx.win = () => {};
T.Sfx.click = () => {};
T.Sfx.coin = () => {};

/* ---- dựng world thật (collider thật từ buildTown + Env.buildExpansion) ---- */
Engine.createWorld();
CharacterManager.initPopulation();
const player = PlayerController.entity;
const q3 = () => State.quests.find(q => q.id === 'q3');

/* Lưới điểm: trả về các điểm vi phạm (isWalkable !== expect). */
function gridBad(x0, x1, z0, z1, step, expect, label) {
  const bad = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    for (let z = z0; z <= z1 + 1e-9; z += step) {
      const got = Engine.isWalkable(+x.toFixed(2), +z.toFixed(2));
      if (got !== expect) bad.push('(' + (+x.toFixed(2)) + ',' + (+z.toFixed(2)) + ')=' + got);
    }
  }
  return bad;
}
const rectsOverlap = (a, b) =>
  Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0 &&
  Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 0;

/* ================= A. Bảng nước WATER_RECTS ================= */
check('WATER_RECTS du 6 hinh nuoc', Array.isArray(T.WATER_RECTS) && T.WATER_RECTS.length === 6,
  JSON.stringify(T.WATER_RECTS));
check('moi hinh nuoc nam trong bounds ban do x[-45,48] z[-40,44]',
  T.WATER_RECTS.every(r => r.minX >= -45 && r.maxX <= 48 && r.minZ >= -40 && r.maxZ <= 44 && r.minX < r.maxX && r.minZ < r.maxZ),
  JSON.stringify(T.WATER_RECTS));
/* Cầu đá: cầu NS x[3.3,7.7] z[6.4,10.8] (deck 4.4x4.4 tai (5.5,8.6));
   cầu EW x[9.2,13.4] z[1.5,5.5] (deck 4.2x4.0 tai (11.3,3.5)). */
const BRIDGES = [
  { minX: 3.3, maxX: 7.7, minZ: 6.4, maxZ: 10.8 },
  { minX: 9.2, maxX: 13.4, minZ: 1.5, maxZ: 5.5 }
];
check('khong hinh nuoc nao phu cau da',
  T.WATER_RECTS.every(r => !BRIDGES.some(b => rectsOverlap(r, b))),
  JSON.stringify(T.WATER_RECTS.filter(r => BRIDGES.some(b => rectsOverlap(r, b)))));
check('diem dap 3 cong dich chuyen khong nam trong nuoc',
  Env.GATES.every(g => !Engine._inWater(g.dx, g.dz) && !Engine._inWater(g.x, g.z)),
  JSON.stringify(Env.GATES.map(g => [g.id, g.dx, g.dz, Engine._inWater(g.dx, g.dz)])));
check('diem lich trinh 5 NPC chinh (20 diem) khong nam trong nuoc',
  Object.values(T.NPC_SCHEDULES).every(s => Object.values(s).every(p => !Engine._inWater(p.x, p.z))),
  JSON.stringify(Object.entries(T.NPC_SCHEDULES).map(([id, s]) => [id, Object.values(s).filter(p => Engine._inWater(p.x, p.z))])));
check('NPC moi + thu cung lang thang (neo) khong nam trong nuoc',
  T.NPC_NEW_DEFS.every(d => !Engine._inWater(d.x, d.z)) && T.PET_DEFS.every(d => !Engine._inWater(d.x, d.z)),
  JSON.stringify([...T.NPC_NEW_DEFS, ...T.PET_DEFS].filter(d => Engine._inWater(d.x, d.z))));
check('5 ruong + diem cau/sen + ban co khong nam trong nuoc',
  T.CHEST_DEFS.every(c => !Engine._inWater(c.x, c.z)) &&
  !Engine._inWater(T.FISH_SPOT.x, T.FISH_SPOT.z) && !Engine._inWater(T.LOTUS_SPOT.x, T.LOTUS_SPOT.z),
  JSON.stringify([...T.CHEST_DEFS.filter(c => Engine._inWater(c.x, c.z)), T.FISH_SPOT, T.LOTUS_SPOT]));
check('diem cau (7,9) + diem sen (4,9) nam tren cau da, di duoc',
  Engine.isWalkable(7, 9) && Engine.isWalkable(4, 9), 'fish=' + Engine.isWalkable(7, 9) + ' lotus=' + Engine.isWalkable(4, 9));

/* ================= B. isWalkable: nước chặn, cầu + đất đi được ================= */
/* Hồ sen chính: dải z 6.5..10.5 (trừ dải cầu x 3.2..7.8), lưới dày 0.5. */
let bad = [];
for (let x = -17; x <= 9; x += 0.5) for (let z = 7; z <= 10; z += 0.5) {
  const onBridge = x >= 3.2 && x <= 7.8;
  if (Engine.isWalkable(x, z) === onBridge) continue;
  bad.push('(' + x + ',' + z + ')=' + Engine.isWalkable(x, z));
}
check('long ho sen z 7..10: chan het, tru dai cau x 3.2..7.8', bad.length === 0, bad.slice(0, 8).join(' | '));
/* Khe đông x 9.5..13 (trừ cầu EW z 1.5..5.5). */
bad = [];
for (let x = 10; x <= 12.5; x += 0.5) for (let z = -14; z <= 10; z += 1) {
  const onBridge = z >= 1.5 && z <= 5.5;
  if (Engine.isWalkable(x, z) === onBridge) continue;
  bad.push('(' + x + ',' + z + ')=' + Engine.isWalkable(x, z));
}
check('khe dong x 10..12.5: chan het, tru cau EW z 1.5..5.5', bad.length === 0, bad.slice(0, 8).join(' | '));
/* 6 khoảng nước vùng mở rộng: lưới trong lòng hình (cách biên 0.5) phải chặn hết. */
const WATER_NAMES = ['dong-bac', 'ranh tay', 'tay-nam', 'dong-nam', 'ranh bac-dong', 'mep tay ho sen'];
T.WATER_RECTS.forEach((r, i) => {
  const b = gridBad(r.minX + 0.5, r.maxX - 0.5, r.minZ + 0.5, r.maxZ - 0.5, 2, false);
  check('nuoc mo rong ' + WATER_NAMES[i] + ' [' + r.minX + ',' + r.maxX + ']x[' + r.minZ + ',' + r.maxZ + '] chan het', b.length === 0, b.slice(0, 6).join(' | '));
});
/* Mép đất quanh các hình nước vẫn đi được (không chặn lố sang cỏ/đá). */
[
  ['dong-bac: co dong (30,-13)', 30, -13, true], ['dong-bac: co bac (20,-20)', 20, -20, true],
  ['ranh tay: co tay (-30,-11)', -30, -11, true], ['ranh tay: co bac (-30,-17)', -30, -17, true],
  ['tay-nam: co nam (-19,30)', -19, 30, true], ['tay-nam: co tay (-30,16)', -30, 16, true],
  ['dong-nam: co dong (30,25)', 30, 25, true], ['dong-nam: co nam (19,30)', 19, 30, true],
  ['ranh bac-dong: co dong (20,-13)', 20, -13, true], ['ranh bac-dong: co bac (20,-17)', 20, -17, true]
].forEach(([name, x, z, expect]) => {
  check(name + ' di duoc', Engine.isWalkable(x, z) === expect, '(' + x + ',' + z + ')=' + Engine.isWalkable(x, z));
});
/* Cầu đá đi được dọc suốt cầu (lưới 0.5). */
bad = gridBad(3.5, 7.5, 6.5, 10.5, 0.5, true);
check('cau da NS (5.5,8.6) di duoc doc cau', bad.length === 0, bad.slice(0, 6).join(' | '));
bad = gridBad(9.5, 13, 2, 5, 0.5, true);
check('cau da EW (11.3,3.5) di duoc doc cau', bad.length === 0, bad.slice(0, 6).join(' | '));
/* Đất liền + luật cũ giữ nguyên. */
[
  ['quang truong (-4,0)', -4, 0, true], ['nam cau (5.5,14)', 5.5, 14, true],
  ['co nam (0,30)', 0, 30, true], ['co tay (-30,0)', -30, 0, true],
  ['co bac (0,-25)', 0, -25, true], ['co dong (30,0)', 30, 0, true],
  ['bo dong (14,3)', 14, 3, true], ['bo dong tren cau (14,8) chan (luat cu)', 14, 8, false],
  ['ho sen (-10,12) chan (luat cu)', -10, 12, false], ['ngoai bien (-46,0)', -46, 0, false],
  ['ngoai bien (0,45)', 0, 45, false]
].forEach(([name, x, z, expect]) => {
  check(name, Engine.isWalkable(x, z) === expect, '(' + x + ',' + z + ')=' + Engine.isWalkable(x, z));
});

/* ================= C. Mô phỏng di chuyển thật (PlayerController.update) ================= */
/* Chạy player từng bước dt=1/60; trả về {arrived, everWater, frames, end}. */
function walkPlayer(fromX, fromZ, toX, toZ, maxFrames) {
  player.mesh.position.set(fromX, 0, fromZ);
  player.mesh.rotation.y = 0;
  PlayerController.stop();
  PlayerController.moveTo(toX, toZ);
  let everWater = false, frames = 0, arrived = false;
  for (let i = 0; i < (maxFrames || 3000); i++) {
    frames++;
    PlayerController.update(1 / 60);
    const p = player.mesh.position;
    if (!Engine.isWalkable(p.x, p.z)) { everWater = true; break; }
    if (!PlayerController.target) { arrived = Math.hypot(p.x - toX, p.z - toZ) < 0.5; break; }
  }
  const p = player.mesh.position;
  return { arrived, everWater, frames, endX: +p.x.toFixed(2), endZ: +p.z.toFixed(2) };
}
let r = walkPlayer(-4, 5, 5.5, 14);
check('di qua cau NS toi bo nam: toi noi + khong dung tren nuoc',
  r.arrived && !r.everWater, JSON.stringify(r));
check('q3 xong khi buoc qua cau (z>7.2, x 3..8)', q3().done === true && q3().progress >= 1,
  JSON.stringify(q3()));
r = walkPlayer(-4, 5, 0, 9); /* đích trong lòng hồ: phải dừng ở mép, không vào nước */
check('click-to-move vao long ho: dung o mep, khong vao nuoc',
  !r.everWater && !r.arrived && Math.abs(r.endZ) <= 6.6 + 0.3, JSON.stringify(r));
r = walkPlayer(0, 30, -30, 30); /* đi ngang vùng nước tây-nam: phải dừng ở mép x=-20 */
check('di ngang nuoc tay-nam: dung o mep x=-20, khong vao nuoc',
  !r.everWater && r.endX >= -20.6, JSON.stringify(r));
r = walkPlayer(30, 0, 30, -30); /* đi dọc vùng nước đông-bắc: phải dừng ở mép z=-14 */
check('di doc nuoc dong-bac: dung o mep z=-14, khong vao nuoc',
  !r.everWater && r.endZ >= -14.6, JSON.stringify(r));

/* ================= D. Follower: pet + đội trưởng không vào nước ================= */
State.inventory = [{ id: 'i-pet', name: 'Tiểu Bạch Hồ', icon: '🦊', type: 'Thú cưng', desc: 'pet test', qty: 1 }];
State.activePet = null;
Followers.update(0.1, 1);
check('setup: pet + leader follower da spawn',
  !!(Followers.pet && Followers.leader), 'pet=' + !!(Followers.pet) + ' leader=' + !!(Followers.leader));

/* Đi theo player qua cầu, ghi lại mọi vị trí follower từng frame. */
function walkWithFollowers(fromX, fromZ, toX, toZ) {
  player.mesh.position.set(fromX, 0, fromZ);
  player.mesh.rotation.y = 0;
  PlayerController.stop();
  PlayerController.moveTo(toX, toZ);
  let badPet = null, badLeader = null, frames = 0, arrived = false;
  for (let i = 0; i < 3000; i++) {
    frames++;
    PlayerController.update(1 / 60);
    Followers.update(1 / 60, 10 + i / 60);
    const pp = Followers.pet.ent.mesh.position, lp = Followers.leader.ent.mesh.position;
    if (!badPet && !Engine.isWalkable(pp.x, pp.z)) badPet = '(' + pp.x.toFixed(2) + ',' + pp.z.toFixed(2) + ')';
    if (!badLeader && !Engine.isWalkable(lp.x, lp.z)) badLeader = '(' + lp.x.toFixed(2) + ',' + lp.z.toFixed(2) + ')';
    if (badPet && badLeader) break;
    if (!PlayerController.target) { arrived = true; break; }
  }
  return { badPet, badLeader, frames, arrived };
}
r = walkWithFollowers(5.5, 5, 5.5, 12);
check('follower theo player qua cau NS: pet + leader khong dung tren nuoc',
  !r.badPet && !r.badLeader, JSON.stringify(r));
r = walkWithFollowers(7.0, 5, 7.0, 12); /* mép đông cầu: đích leader lệch ra ngoài nước */
check('follower theo player doc mep dong cau: leader khong lech xuong nuoc',
  !r.badPet && !r.badLeader, JSON.stringify(r));
/* Dịch chuyển tức thời khi xa >12: đích đi được thì đáp đúng; đích trong
   nước thì đáp điểm đi được gần nhất, không đáp xuống nước. */
player.mesh.position.set(5.5, 0, 8.6);
player.mesh.rotation.y = 0;
Followers.pet.ent.mesh.position.set(30, 0, 30);
Followers.update(0.1, 20);
let pp = Followers.pet.ent.mesh.position;
check('pet xa >12, dich gan player tren cau -> dap dung cho di duoc',
  Math.abs(pp.x - 6.0) < 0.01 && Math.abs(pp.z - 7.4) < 0.01 && Engine.isWalkable(pp.x, pp.z),
  'pos=(' + pp.x.toFixed(2) + ',' + pp.z.toFixed(2) + ')');
player.mesh.position.set(7.5, 0, 8.6); /* mép đông cầu, quay mặt về nam: đích pet (8.0,7.4) ở trong nước */
player.mesh.rotation.y = 0;
Followers.pet.ent.mesh.position.set(30, 0, 30);
Followers.update(0.1, 21);
pp = Followers.pet.ent.mesh.position;
check('pet xa >12, dich o trong nuoc -> khong dap xuong nuoc',
  Engine.isWalkable(pp.x, pp.z) && !(Math.abs(pp.x - 8.0) < 0.01 && Math.abs(pp.z - 7.4) < 0.01),
  'pos=(' + pp.x.toFixed(2) + ',' + pp.z.toFixed(2) + ')');

/* ================= E. NPC lang thang + đi bộ theo lịch ================= */
check('waypoint dan thuong quanh neo Nu Hiep Cau Da (5.5,9.2) r=6 luon di duoc',
  (() => {
    for (let i = 0; i < 200; i++) {
      const p = NpcAI.pickWanderPoint({ x: 5.5, z: 9.2 }, 6);
      if (!p || !Engine.isWalkable(p.x, p.z)) return false;
    }
    return true;
  })());
check('waypoint thu cung quanh neo (-3,3)/(4,4) r=6 luon di duoc',
  (() => {
    for (let i = 0; i < 200; i++) {
      const a = i % 2 === 0 ? { x: -3, z: 3 } : { x: 4, z: 4 };
      const p = NpcAI.pickWanderPoint(a, 6);
      if (!p || !Engine.isWalkable(p.x, p.z)) return false;
    }
    return true;
  })());
check('waypoint tre con quanh neo (-2,2)/(2,3) r=4 luon di duoc',
  (() => {
    for (let i = 0; i < 100; i++) {
      const a = i % 2 === 0 ? { x: -2, z: 2 } : { x: 2, z: 3 };
      const p = NpcAI.pickWanderPoint(a, 4);
      if (!p || !Engine.isWalkable(p.x, p.z)) return false;
    }
    return true;
  })());
/* Đi bộ thật bằng NpcAI._stepToward (có tránh vật cản bằng bước lệch góc). */
function walkNpc(fromX, fromZ, toX, toZ, speed, maxSteps) {
  const e = { mesh: { position: new V3(fromX, 0, fromZ), rotation: { y: 0 } } };
  let everWater = false, arrived = false, steps = 0;
  for (let i = 0; i < (maxSteps || 3000); i++) {
    steps++;
    if (NpcAI._stepToward(e, toX, toZ, speed, 0.1)) { arrived = true; break; }
    if (!Engine.isWalkable(e.mesh.position.x, e.mesh.position.z)) { everWater = true; break; }
  }
  return { arrived, everWater, steps, endX: +e.mesh.position.x.toFixed(2), endZ: +e.mesh.position.z.toFixed(2) };
}
r = walkNpc(5.5, 9.2, 5.5, 14, 0.9);
check('NPC tu cau da di ve bo nam: toi noi + khong vao nuoc', r.arrived && !r.everWater, JSON.stringify(r));
r = walkNpc(-4, 5, 5.5, 14, 0.9);
check('NPC tu quang truong qua cau toi bo nam: toi noi + khong vao nuoc', r.arrived && !r.everWater, JSON.stringify(r));
r = walkNpc(-12, -6, 38, 17, 1.2, 6000); /* Tiên Cô: chợ -> nhà (38,17), qua cầu đông */
check('NPC lich trinh ve nha khu mo rong (38,17): khong vao nuoc', !r.everWater, JSON.stringify(r));

/* ================= F. Bắc Uyển: hồ đã có collider nước ================= */
(function testBacUyen() {
  const D10 = require('../src/10b-districts.js');
  const bac = D10.DISTRICTS.find(d => d.file === 'bac-uyen.html');
  const src10 = read('src/10-district.js');
  check('bac-uyen co prop ho sen tai (0,4)', !!bac && bac.props.some(p => p.kind === 'pond' && p.x === 0 && p.z === 4),
    JSON.stringify(bac && bac.props.filter(p => p.kind === 'pond')));
  check("engine khu vuc: case 'pond' dang ky collider nuoc",
    src10.includes("case 'pond'") && src10.includes('this.addCollider(p.x, p.z, 4.5)'));
  check('bac-uyen co cau cong (0,1.5) solid (trang tri, khong di qua ho)',
    !!bac && bac.props.some(p => p.kind === 'bridge' && p.x === 0 && p.z === 1.5 && p.solid === true),
    JSON.stringify(bac && bac.props.filter(p => p.kind === 'bridge')));

  /* vm riêng cho District (mẫu tools/test-districts.cjs §6): đăng ký đúng
     collider mà buildProp đăng ký (hồ ±4.5; cầu solid ±1.4) rồi kiểm isWalkable. */
  class T2 { constructor() { this.x = 0; this.y = 0; this.z = 0; } }
  const THREE2 = new Proxy({}, { get: () => T2 });
  const store2 = new Map();
  const ls2 = {
    getItem: k => (store2.has(k) ? store2.get(k) : null),
    setItem: (k, v) => store2.set(k, String(v)), removeItem: k => store2.delete(k)
  };
  function mkEl2() {
    return {
      textContent: '', innerHTML: '', style: {}, children: [],
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {},
      getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, createLinearGradient: () => ({ addColorStop() {} }) })
    };
  }
  const doc2 = {
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => mkEl2(), createElement: () => mkEl2(),
    addEventListener() {}, body: mkEl2()
  };
  const loc2 = { href: '' };
  const sb2 = {
    console, Math, JSON, performance,
    setTimeout: fn => { fn(); return 0; }, setInterval: () => 0, requestAnimationFrame: () => 0,
    THREE: THREE2, localStorage: ls2, document: doc2, location: loc2,
    window: { addEventListener() {}, location: loc2 }, navigator: {}
  };
  vm.createContext(sb2);
  vm.runInContext(read('src/10b-districts.js') + '\n' + read('src/10-district.js') +
    '\n;globalThis.__D = window.District;', sb2);
  const District = sb2.__D;
  District.def = bac;
  District.colliders = [];
  District.addCollider(0, 4, 4.5); /* case 'pond': hồ sen 9x6 tại (0,4) */
  District.addCollider(0, 1.5, 1.4); /* bridge solid: cầu cong (0,1.5) */
  let b = [];
  /* Lòng hồ (cách mép 0.5 — collider dùng bất đẳng thức nghiêm ngặt như mọi
     collider khác của engine nên đúng đường biên là mép đất, vẫn đi được). */
  for (let x = -4; x <= 4; x += 0.5) for (let z = 1.5; z <= 6.5; z += 0.5) {
    if (District.isWalkable(x, z)) b.push('(' + x + ',' + z + ')');
  }
  check('bac-uyen: long ho sen (x -4..4, z 1.5..6.5) khong di duoc', b.length === 0, b.slice(0, 8).join(' | '));
  check('bac-uyen: mat cau cong (0,1.5) khong di duoc (cau solid)',
    !District.isWalkable(0, 1.5) && !District.isWalkable(0, 0.5) && !District.isWalkable(0, 2.5));
  check('bac-uyen: quanh ho van di duoc (bo ho + vuon)',
    District.isWalkable(-6, 4) && District.isWalkable(6, 4) && District.isWalkable(0, -2) &&
    District.isWalkable(0, 9) && District.isWalkable(-6, -2));
  check('bac-uyen: diem spawn (0,8) o trong ho -> buildPlayer phai chon diem khac',
    !District.isWalkable(0, 8) && District.isWalkable(0, -8));
  /* Mô phỏng đúng luật District.updatePlayer (bước + trượt trục): đi từ
     bờ tây (-6,4) sang bờ đông (6,4) phải dừng ở mép hồ, không vào nước. */
  const pos = { x: -6, z: 4 };
  let everWater = false, stopped = false, still = 0;
  for (let i = 0; i < 600; i++) {
    const dx = 6 - pos.x, dz = 4 - pos.z, dist = Math.hypot(dx, dz);
    if (dist < 0.25) break;
    const step = Math.min(dist, 7.5 / 60);
    const nx = pos.x + (dx / dist) * step, nz = pos.z + (dz / dist) * step;
    const ox = pos.x, oz = pos.z;
    if (District.isWalkable(nx, nz)) { pos.x = nx; pos.z = nz; }
    else {
      let slid = false;
      if (District.isWalkable(nx, pos.z)) { pos.x = nx; slid = true; }
      if (District.isWalkable(pos.x, nz)) { pos.z = nz; slid = true; }
      if (!slid) { stopped = true; break; }
    }
    if (!District.isWalkable(pos.x, pos.z)) { everWater = true; break; }
    /* Trượt trục về đúng chỗ cũ (nz == z) thì coi như đứng yên: engine cũ
       vẫn giữ target, nhân vật không nhúc nhích — phát hiện bằng 5 frame
       liên tiếp không đổi vị trí (cùng quirk với PlayerController world). */
    if (Math.abs(pos.x - ox) < 1e-9 && Math.abs(pos.z - oz) < 1e-9) { if (++still >= 5) { stopped = true; break; } }
    else still = 0;
  }
  check('bac-uyen: di thang qua ho thi dung o mep, khong vao nuoc',
    !everWater && stopped && pos.x < 4.5, JSON.stringify(pos) + ' stopped=' + stopped);
})();

/* ================= G. Build đã chứa code mới ================= */
const builtMain = read('mongvolam.html');
check('mongvolam.html build chua WATER_RECTS + _inWater',
  builtMain.includes('WATER_RECTS') && builtMain.includes('_inWater'));
check('mongvolam.html build chua follower kiem nuoc (walkableNear khi dich chuyen)',
  builtMain.includes('walkableNear(tx, tz, 2)'));
const builtBac = read('map/bac-uyen.html');
check("map/bac-uyen.html build chua collider ho (case 'pond')",
  builtBac.includes("case 'pond'") && builtBac.includes('this.addCollider(p.x, p.z, 4.5)'));
check('khong co chuoi dong script trong src da sua',
  !read('src/02-world.js').includes('</script'));

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
