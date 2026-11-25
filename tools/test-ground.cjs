/* Kiểm thử nền đất chống nhấp nháy (z-fighting) + chất lượng/FPS — không cần trình duyệt.
   Nạp src/01-data.js + src/02-world.js + src/02b-env.js vào vm với stub THREE
   ghi lại mọi Mesh, dựng world thật (Engine.createWorld + initPopulation),
   rồi kiểm tra các mặt phẳng nằm ngang chồng lấn:
   - Quy tắc 1: hai mặt hướng lên trên (đỉnh box / mặt phẳng ngang / đỉnh trụ)
     có footprint chồng nhau phải cách nhau >= 0.021 theo y (trừ decal có
     polygonOffset thì >= 0.005 — decal được đẩy depth về phía camera).
   - Quy tắc 2: decal phẳng (vòng tròn/điểm câu...) không được chìm bên trong
     một box (y nằm giữa đáy và đỉnh box) khi không có polygonOffset.
   - Quy tắc 3: biển phẳng đứng (plate chữ) không được nằm trong / sát < 0.03
     mặt trước-sau của box mà nó gắn lên.
   - Camera trực giao: near/far phải bao hết vùng nhìn thấy (depth ~0..63) mà
     khoảng far-near càng hẹp càng tốt cho depth precision trên GPU điện thoại.
   - Env.qualityForDevice / particleCountFor: cap pixelRatio + số hạt theo máy.
   Chạy: node tools/test-ground.cjs */
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

/* ---- stub THREE ghi lại mesh ---- */
function mkRot() { return { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }; }
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
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
let meshCount = 0, lightCount = 0;
class Mesh extends Node {
  constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; meshCount++; allMeshes.push(this); }
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
  constructor(c, i) { super(); this.color = new Color(c); this.intensity = i; this.shadow = { mapSize: {}, camera: {} }; lightCount++; }
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
const sandbox = {
  console, Math, JSON, setTimeout: fn => { fn(); return 0; },
  THREE, localStorage, document, performance: { now: () => 0 },
  window: { innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, addEventListener() {} },
  Game: { mode: 'world' }
};
vm.createContext(sandbox);
const src = read('src/01-data.js') + '\n' + read('src/02-world.js') + '\n' + read('src/02b-env.js') +
  '\n;globalThis.__T = { Env, State, Engine, SaveManager, PlayerController, CharacterManager, InteractWorld, GROUND_LAYERS: (typeof GROUND_LAYERS !== "undefined" ? GROUND_LAYERS : null) };';
vm.runInContext(src, sandbox);
const T = sandbox.__T;
const { Env, State, Engine } = T;

/* ---- dựng world thật ---- */
Engine.createWorld();
T.CharacterManager.initPopulation();
/* Đồ rơi: sinh vài cái để vòng tròn nhặt cũng được kiểm tra. */
for (let i = 0; i < 3; i++) { try { if (typeof Interact !== 'undefined') Interact.spawnDrop(); } catch (e) {} }
try { T.InteractWorld.syncDropMeshes(); } catch (e) {}

/* ---- duyệt scene, gom mặt phẳng ngang + box ---- */
const HALF_PI = Math.PI / 2;
const flats = [];   /* {y, x, z, hw, hd, poly, label} mặt hướng lên */
const boxes = [];   /* {x0,x1,z0,z1,y0,y1, label} */
const vplates = []; /* {x, z, y0, y1, hw, label} biển đứng */
function labelOf(m) {
  const g = m.geometry || {};
  return (g.type || '?') + '(' + (g.args || []).map(a => (typeof a === 'number' ? +a.toFixed(2) : a)).join(',') + ')';
}
function walk(node, ox, oz) {
  const x = ox + (node.position ? node.position.x : 0);
  const z = oz + (node.position ? node.position.z : 0);
  const y = node.position ? node.position.y : 0;
  if (node instanceof Mesh) {
    const g = node.geometry || {};
    const poly = !!(node.material && node.material.polygonOffset);
    const rx = node.rotation ? node.rotation.x : 0;
    const rz = node.rotation ? node.rotation.z : 0;
    /* Mặt nghiêng (vd tay vịn cầu thang xoay 0.72 rad) không song song với mặt
       ngang nên không thể đồng phẳng gây nhấp nháy — bỏ qua khỏi quy tắc 1. */
    const tilted = Math.abs(rx % (Math.PI / 2)) > 0.01 || Math.abs(rz % (Math.PI / 2)) > 0.01;
    if (g.type === 'Box') {
      const [w, h, d] = g.args;
      boxes.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: y - h / 2, y1: y + h / 2, label: labelOf(node) + ' @(' + x.toFixed(1) + ',' + y.toFixed(2) + ',' + z.toFixed(1) + ')' });
      flats.push({ kind: 'boxtop', tilted, y: y + h / 2, x, z, hw: w / 2, hd: d / 2, poly, label: 'top ' + labelOf(node) + ' @(' + x.toFixed(1) + ',' + y.toFixed(2) + ',' + z.toFixed(1) + ')' });
    } else if (g.type === 'Cylinder') {
      const [r, , h] = g.args;
      flats.push({ kind: 'cyltop', tilted, y: y + h / 2, x, z, hw: r, hd: r, poly, label: 'cyl-top ' + labelOf(node) + ' @(' + x.toFixed(1) + ',' + y.toFixed(2) + ',' + z.toFixed(1) + ')' });
    } else if ((g.type === 'Plane' || g.type === 'Ring' || g.type === 'Circle') && Math.abs(Math.abs(rx) - HALF_PI) < 0.01) {
      const hw = g.type === 'Plane' ? g.args[0] / 2 : g.args[g.type === 'Ring' ? 1 : 0];
      const hd = g.type === 'Plane' ? g.args[1] / 2 : hw;
      flats.push({ kind: 'flat', tilted, y, x, z, hw, hd, poly, label: labelOf(node) + ' @(' + x.toFixed(1) + ',' + y.toFixed(2) + ',' + z.toFixed(1) + ')' });
    } else if (g.type === 'Plane') {
      vplates.push({ x, z, y0: y - g.args[1] / 2, y1: y + g.args[1] / 2, hw: g.args[0] / 2, label: labelOf(node) + ' @(' + x.toFixed(1) + ',' + y.toFixed(2) + ',' + z.toFixed(1) + ')' });
    }
  }
  (node.children || []).forEach(c => walk(c, x, z));
}
walk(Engine.scene, 0, 0);

const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const MIN_GAP = 0.021, MIN_GAP_POLY = 0.005;

/* ---- Quy tắc 1: mặt hướng lên chồng nhau phải cách nhau ---- */
const bad1 = [];
for (let i = 0; i < flats.length; i++) for (let j = i + 1; j < flats.length; j++) {
  const a = flats[i], b = flats[j];
  if (a.tilted || b.tilted) continue; /* mat nghieng khong song song -> khong z-fight */
  if (overlap(a.x - a.hw, a.x + a.hw, b.x - b.hw, b.x + b.hw) <= 0.05) continue;
  if (overlap(a.z - a.hd, a.z + a.hd, b.z - b.hd, b.z + b.hd) <= 0.05) continue;
  const need = (a.poly || b.poly) ? MIN_GAP_POLY : MIN_GAP;
  if (Math.abs(a.y - b.y) < need) bad1.push(a.label + ' y=' + a.y.toFixed(3) + ' <-> ' + b.label + ' y=' + b.y.toFixed(3) + ' (gap ' + Math.abs(a.y - b.y).toFixed(3) + ' < ' + need + ')');
}
check('mat ngang chong nhau cach nhau >= ' + MIN_GAP + ' (tru decal polygonOffset)', bad1.length === 0, bad1.slice(0, 6).join(' | '));

/* ---- Quy tắc 2: decal phẳng không chìm trong box ----
   Chỉ tính khi footprint decal gần như nằm trọn trong 1 box (vòng điểm câu
   nằm trọn trên mặt cầu nhưng chìm dưới đỉnh cầu = vô hình). Decal lớn
   (bóng nhân vật) chỉ chạm mép cột/chân bàn thì là che khuất đúng, bỏ qua. */
const bad2 = [];
flats.forEach(f => {
  if (f.kind !== 'flat' || f.poly || f.y < -0.1) return;
  const area = 4 * f.hw * f.hd;
  boxes.forEach(b => {
    const ox = overlap(f.x - f.hw, f.x + f.hw, b.x0, b.x1);
    const oz = overlap(f.z - f.hd, f.z + f.hd, b.z0, b.z1);
    if (ox <= 0.05 || oz <= 0.05) return;
    if ((ox * oz) / area < 0.9) return; /* chỉ chạm mép -> che khuất đúng */
    if (f.y > b.y0 + 0.005 && f.y < b.y1 - 0.005) bad2.push(f.label + ' y=' + f.y.toFixed(3) + ' chim trong ' + b.label + ' y=[' + b.y0.toFixed(2) + ',' + b.y1.toFixed(2) + ']');
  });
});
check('decal phang khong chim trong box (vong diem cau/sen, vong do roi...)', bad2.length === 0, bad2.slice(0, 6).join(' | '));

/* ---- Quy tắc 3: biển đứng cách mặt box >= 0.03 ---- */
const bad3 = [];
vplates.forEach(p => {
  boxes.forEach(b => {
    if (overlap(p.x - p.hw, p.x + p.hw, b.x0, b.x1) <= 0.02) return;
    if (overlap(p.y0, p.y1, b.y0, b.y1) <= 0.02) return;
    const zMin = (b.x0 + b.x1) / 2 - ((b.x1 - b.x0) / 2); // (giữ chỗ, tính z box bên dưới)
    void zMin;
    const bz0 = b.z0, bz1 = b.z1;
    if (p.z > bz0 + 0.005 && p.z < bz1 - 0.005) bad3.push(p.label + ' z=' + p.z.toFixed(3) + ' nam TRONG ' + b.label + ' z=[' + bz0.toFixed(2) + ',' + bz1.toFixed(2) + ']');
    else {
      const d = Math.min(Math.abs(p.z - bz0), Math.abs(p.z - bz1));
      if (d < 0.03) bad3.push(p.label + ' z=' + p.z.toFixed(3) + ' cach mat box ' + b.label + ' co ' + d.toFixed(3) + ' < 0.03');
    }
  });
});
check('bien dung cach mat box >= 0.03', bad3.length === 0, bad3.slice(0, 6).join(' | '));

/* ---- Bảng tầng nền (để đọc nhanh) ---- */
if (T.GROUND_LAYERS) {
  const L = T.GROUND_LAYERS;
  check('tang nen: co cach da >= 0.03', (L.grass - L.stone) >= 0.03, 'grass=' + L.grass + ' stone=' + L.stone);
  check('tang nen: duong mon cao hon co >= 0.03', (L.pathTop - L.grass) >= 0.03, 'pathTop=' + L.pathTop + ' grass=' + L.grass);
  check('tang nen: nuoc thap hon da >= 0.5', (L.stone - L.water) >= 0.5, 'stone=' + L.stone + ' water=' + L.water);
  check('tang nen: vong diem cau/sen cao hon mat cau >= 0.02', (L.spotRing - L.deckTop) >= 0.02, 'spotRing=' + L.spotRing + ' deckTop=' + L.deckTop);
}

/* ---- Camera trực giao ---- */
const cam = Engine.camera;
check('camera near 0.4..1 (khong qua nho)', cam.near >= 0.4 && cam.near <= 1, 'near=' + cam.near);
check('camera far 80..100 (du bao vung nhin, khong thua)', cam.far >= 80 && cam.far <= 100, 'far=' + cam.far);
check('camera khoang depth far-near <= 100', (cam.far - cam.near) <= 100, 'range=' + (cam.far - cam.near));

/* ---- Chất lượng theo máy + số hạt ---- */
if (typeof Env.qualityForDevice === 'function') {
  const phone = Env.qualityForDevice({ w: 390, h: 844, dpr: 3, coarse: true, cores: 8 });
  const desk = Env.qualityForDevice({ w: 1920, h: 1080, dpr: 2, coarse: false, cores: 8 });
  const weak = Env.qualityForDevice({ w: 360, h: 800, dpr: 2.5, coarse: true, cores: 4 });
  check('dien thoai cap pixelRatio <= 1.25', phone.pixelRatioCap <= 1.25, JSON.stringify(phone));
  check('may ban pixelRatio cap 1.75', desk.pixelRatioCap === 1.75, JSON.stringify(desk));
  check('may yeu giam hat con 1/2', weak.particleBudget === 0.5, JSON.stringify(weak));
  check('may khoe giu du hat', desk.particleBudget === 1, JSON.stringify(desk));
}
if (typeof Env.particleCountFor === 'function') {
  Env._particleBudget = 1; Env._particlesOff = false;
  check('hat mua day du = 400', Env.particleCountFor('mua') === 400, String(Env.particleCountFor('mua')));
  check('hat tuyet day du = 300', Env.particleCountFor('tuyet') === 300, String(Env.particleCountFor('tuyet')));
  Env._particleBudget = 0.5;
  check('hat mua may yeu = 200', Env.particleCountFor('mua') === 200, String(Env.particleCountFor('mua')));
  Env._particlesOff = true;
  check('tat hat (nac tu dong giam) = 0', Env.particleCountFor('mua') === 0, String(Env.particleCountFor('mua')));
  Env._particleBudget = 1; Env._particlesOff = false;
}

/* ---- Số liệu scene (để đối chiếu FPS) ---- */
let casters = 0, instanced = 0;
allMeshes.forEach(m => { if (m.castShadow) casters++; if (m instanceof InstancedMesh) instanced++; });
console.log('INFO scene: meshes=' + meshCount + ' (InstancedMesh=' + instanced + '), pointLights=' + lightCount + ', castShadow=' + casters);
console.log('INFO flats=' + flats.length + ' boxes=' + boxes.length + ' vplates=' + vplates.length);

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
