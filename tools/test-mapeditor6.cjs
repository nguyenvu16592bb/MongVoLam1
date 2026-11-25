/* Kiểm thử Map Editor ĐỢT 6 (viewport + map) — logic thuần, không cần trình duyệt.
   - (A) Terrain + Core (04-terrain.js, 00-core.js, 12-nav.js): map size
     96/128/192, regions, spline road/river/fence, scatter, multi-select.
   - (B) Viewport thuần (01-viewport.js): bloom/vignette clamp, camera path
     Catmull-Rom, bookmark normalize, ruler, box select, group transform.
   - (C) Environment thuần (05-environment.js): sky theo giờ, mây bay,
     lịch chớp sấm, normalize weather.
   - (D) Fx + Assets + Export (06-fx.js, 03-assets.js, 15-export.js):
     foam, waterfall, playThunder.
   - (E) Minimap thuần (19-minimap.js): màu ô, click->world, chấm, heading.
   - (F) Tích hợp: build-editor nối 19-minimap + 6 placeholder post-proc,
     template, boot, CSS, mapeditor.html chứa marker + không còn placeholder,
     game không đổi (mongvolam.html hash 8792425d, index.html byte-identical).
   Module/API nào không tồn tại thật trong code thì SKIP ghi rõ lý do, KHÔNG bịa pass.
   Chạy: node tools/build.mjs && node tools/build-editor.mjs
         && node tools/test-mapeditor6.cjs
   In "N PASS, M SKIP, 0 FAIL" hoặc liệt kê fail; exit 1 nếu có fail. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f));

let pass = 0, fail = 0, skipped = 0;
const failedNames = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; failedNames.push(name); console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}
function skip(name, reason) {
  skipped++;
  console.log('SKIP ' + name + ' :: ' + reason);
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function gitBlobHash(buf) {
  const head = Buffer.from('blob ' + buf.length + '\0', 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([head, buf])).digest('hex');
}

/* ---------- THREE stub đủ cho buildMesh/buildFx/buildSplineGroup ---------- */
class V3 {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.isVector3 = true; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  toArray() { return [this.x, this.y, this.z]; }
}
class V2 { constructor(x, y) { this.x = x || 0; this.y = y || 0; } set(x, y) { this.x = x; this.y = y; return this; } }
class Color { constructor(c) { this.c = c; this.r = 0; this.g = 0; this.b = 0; } setHex() { return this; } set() { return this; } clone() { return new Color(this.c); } }
class BufGeo {
  constructor() { this.attributes = {}; this.index = null; }
  setAttribute(n, a) { this.attributes[n] = a; return this; }
  getAttribute(n) { return this.attributes[n]; }
  setIndex(i) { this.index = i; return this; }
  computeVertexNormals() { return this; }
  dispose() {}
}
class F32Attr { constructor(arr, n) { this.array = arr; this.itemSize = n; this.count = arr.length / n; } }
class Mat4 {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  makeTranslation() { return this; } makeRotationY() { return this; } makeScale() { return this; }
  scale() { return this; } setPosition() { return this; }
  multiply() { return this; } clone() { return new Mat4(); }
}
class Quat { constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; } setFromAxisAngle() { return this; } }
class Group {
  constructor() { this.children = []; this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0 }; this.scale = new V3(1, 1, 1); this.userData = {}; this.visible = true; }
  add(c) { this.children.push(c); return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return this; }
  traverse(fn) { fn(this); const ch = this.children.slice(); for (const c of ch) { if (c && typeof c.traverse === 'function') c.traverse(fn); else fn(c); } }
}
class Mesh extends Group { constructor(g, m) { super(); this.isMesh = true; this.geometry = g; this.material = m; this.castShadow = false; this.receiveShadow = false; } }
class Points extends Group { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
class Line extends Group { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
class Material { constructor(o) { this.userData = {}; if (o) Object.assign(this, o); this.needsUpdate = false; } dispose() {} }
class MeshBasicMaterial extends Material {}
class MeshStandardMaterial extends Material {}
class PointsMaterial extends Material {}
class LineBasicMaterial extends Material {}
class ShaderMaterial extends Material {}
class PlaneGeometry extends BufGeo {}
class BoxGeometry extends BufGeo {}
class SphereGeometry extends BufGeo {}
class CircleGeometry extends BufGeo {}
class CylinderGeometry extends BufGeo {}
class ConeGeometry extends BufGeo {}
class DodecahedronGeometry extends BufGeo {}
class IcosahedronGeometry extends BufGeo {}
class OctahedronGeometry extends BufGeo {}
class TetrahedronGeometry extends BufGeo {}
class TorusGeometry extends BufGeo {}
class RingGeometry extends BufGeo {}
class CanvasTexture { constructor(c) { this.image = c; this.needsUpdate = false; } }
class Texture { constructor() { this.needsUpdate = false; } }
class InstancedMesh extends Mesh {
  constructor(g, m, n) { super(g, m); this.count = n; this.isInstancedMesh = true; this.instanceMatrix = { needsUpdate: false }; }
  setMatrixAt() {}
}
class Raycaster { constructor() { this.ray = { origin: new V3(), direction: new V3() }; } setFromCamera() {} intersectObject() { return []; } intersectObjects() { return []; } }
class PerspectiveCamera extends Group { constructor() { super(); this.isPerspectiveCamera = true; this.aspect = 1; this.fov = 50; this.near = 0.1; this.far = 500; } updateProjectionMatrix() {} lookAt() {} }
class OrthographicCamera extends Group { constructor() { super(); this.isOrthographicCamera = true; } updateProjectionMatrix() {} lookAt() {} }
class Scene extends Group { constructor() { super(); this.background = null; this.fog = null; } }
class WebGLRenderer {
  constructor() { this.domElement = { style: {}, addEventListener() {}, getContext() { return null; } }; this.shadowMap = {}; }
  setSize() {} setPixelRatio() {} render() {} dispose() {}
}
class DirectionalLight extends Group {
  constructor(c, i) { super(); this.color = new Color(c); this.intensity = i || 1; this.target = new Group(); this.shadow = { mapSize: { set() {} }, camera: {}, bias: 0 }; }
}
class AmbientLight extends Group { constructor(c, i) { super(); this.color = new Color(c); this.intensity = i || 1; } }
class HemisphereLight extends Group { constructor(a, b, i) { super(); this.intensity = i || 1; } }
class PointLight extends Group { constructor(c, i, d) { super(); this.color = new Color(c); this.intensity = i || 1; this.distance = d || 0; } }
class Fog { constructor(c, n, f) { this.color = new Color(c); this.near = n; this.far = f; } }
class CatmullRomCurve3 {
  constructor(pts) { this.points = pts || []; }
  getPoint() { return new V3(); }
}
function threeStub() {
  return {
    Vector3: V3, Vector2: V2, Color, BufferGeometry: BufGeo,
    BufferAttribute: F32Attr,
    Float32BufferAttribute: F32Attr, Matrix4: Mat4, Quaternion: Quat,
    Group, Mesh, Points, Line, Material, MeshBasicMaterial,
    MeshStandardMaterial, PointsMaterial, LineBasicMaterial, ShaderMaterial,
    PlaneGeometry, BoxGeometry, SphereGeometry, CircleGeometry,
    CylinderGeometry, ConeGeometry, CanvasTexture, Texture, InstancedMesh,
    DodecahedronGeometry, IcosahedronGeometry, OctahedronGeometry,
    TetrahedronGeometry, TorusGeometry, RingGeometry,
    Raycaster, PerspectiveCamera, OrthographicCamera, Scene, WebGLRenderer,
    DirectionalLight, AmbientLight, HemisphereLight, PointLight, Fog,
    CatmullRomCurve3,
    DoubleSide: 2, BackSide: 1, FrontSide: 0, AdditiveBlending: 2,
    NormalBlending: 1, RepeatWrapping: 1000, ClampToEdgeWrapping: 1001,
    LinearFilter: 1006, NearestFilter: 1003, RGBAFormat: 1023,
    UnsignedByteType: 1009, FloatType: 1015, DynamicDrawUsage: 35048,
    StaticDrawUsage: 35044, PCFSoftShadowMap: 2, sRGBEncoding: 3001,
    MathUtils: {
      clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
      lerp: (a, b, t) => a + (b - a) * t,
      degToRad: d => d * Math.PI / 180,
      randFloat: (lo, hi) => lo + Math.random() * (hi - lo)
    }
  };
}
function canvas2dStub() {
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return canvasEl;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 0 });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      return () => {};
    },
    set() { return true; }
  });
  const canvasEl = {
    width: 0, height: 0, style: {}, getContext: () => ctx,
    addEventListener() {}, toDataURL: () => 'data:image/png;base64,iVBOR'
  };
  return canvasEl;
}
function makeLocalStorage() {
  const d = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
    setItem(k, v) { d[k] = String(v); },
    removeItem(k) { delete d[k]; },
    _dump() { return d; }
  };
}
function loadVm(file, extra) {
  const ls = makeLocalStorage();
  const ctx = Object.assign({
    console,
    ED: {},
    THREE: threeStub(),
    localStorage: ls,
    navigator: {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    document: {
      createElement: (tag) => tag === 'canvas' ? canvas2dStub() : { style: {}, addEventListener() {}, appendChild() {}, setAttribute() {}, getContext: () => null, classList: { add() {}, remove() {}, toggle() {} }, dataset: {} },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { appendChild() {}, style: {}, addEventListener() {} },
      addEventListener() {},
      documentElement: { style: {} }
    }
  }, extra || {});
  ctx.window = ctx.window || {};
  ctx.window.localStorage = ls;
  ctx.window.navigator = ctx.navigator;
  ctx.window.document = ctx.document;
  ctx.window.addEventListener = () => {};
  ctx.window.requestAnimationFrame = ctx.requestAnimationFrame;
  ctx.window.devicePixelRatio = 1;
  vm.createContext(ctx);
  vm.runInContext(read(file), ctx, { filename: file });
  return ctx;
}

/* ========== (A) Terrain + Core + Nav ========== */
(function sectionTerrainCore() {
  let ctx;
  try {
    ctx = loadVm('src/editor/00-core.js');
    vm.runInContext(read('src/editor/12-nav.js'), ctx, { filename: 'src/editor/12-nav.js' });
    vm.runInContext(read('src/editor/04-terrain.js'), ctx, { filename: 'src/editor/04-terrain.js' });
    vm.runInContext(read('src/editor/03-assets.js'), ctx, { filename: 'src/editor/03-assets.js' });
  } catch (e) {
    skip('A0 load Core/Nav/Terrain/Assets trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const T = ctx.ED.Terrain;
  const Core = ctx.ED.Core;
  const Nav = ctx.ED.Nav;
  if (!T || !Core) { skip('A0 ED.Terrain/ED.Core', 'không tồn tại sau load'); return; }

  // ---- map size ----
  if (typeof T.getSize === 'function') {
    check('A1 getSize mặc định 96', T.getSize() === 96, 'getSize=' + T.getSize());
  } else skip('A1 getSize mặc định 96', 'ED.Terrain.getSize không tồn tại');
  if (typeof T.worldToGrid === 'function') {
    const a = T.worldToGrid(0, 0);
    const lo = T.worldToGrid(-48, -48);
    const hi = T.worldToGrid(48, 48);
    let bOk = false, bLoOk = false;
    if (typeof T.setSize === 'function') {
      T.setSize(192);
      const b = T.worldToGrid(48, 48);
      const bLo = T.worldToGrid(-96, -96);
      bOk = b && approx(b.gx, 48) && approx(b.gz, 48);
      bLoOk = bLo && approx(bLo.gx, 0) && approx(bLo.gz, 0);
      T.setSize(96);
    }
    check('A2 worldToGrid theo SIZE live: (0,0)/96->[32,32], (-48,-48)->[0,0], (48,48)->[64,64], (48,48)/192->[48,48], (-96,-96)/192->[0,0]',
      a && approx(a.gx, 32) && approx(a.gz, 32) &&
      lo && approx(lo.gx, 0) && approx(lo.gz, 0) &&
      hi && approx(hi.gx, 64) && approx(hi.gz, 64) && bOk && bLoOk,
      'a=' + JSON.stringify(a) + ' bOk=' + bOk + ' bLoOk=' + bLoOk);
  } else skip('A2 worldToGrid', 'worldToGrid không tồn tại');
  if (typeof T.getHeights === 'function' && typeof T.setHeights === 'function') {
    const h = T.getHeights();
    check('A3 heights giữ 65x65=4225 ô dù map đổi size', h.length === 4225, 'len=' + h.length);
  } else skip('A3 heights 4225 ô', 'getHeights/setHeights không tồn tại');
  if (typeof T.setSize === 'function') {
    let kept = true;
    try {
      T.setSize(100); // kích thước không hợp lệ -> giữ nguyên
      kept = T.getSize() === 96;
    } catch (e) { kept = false; }
    check('A4 setSize(100) giữ 96 hiện tại', kept, 'getSize=' + T.getSize());
    T.setSize(128);
    check('A5 setSize(128) đổi size + SEGMENTS giữ 64', T.getSize() === 128 && T.getHeights().length === 4225, 'size=' + T.getSize());
    if (Nav && typeof Nav.getGridInfo === 'function') {
      let sizeAfterRebuild = null;
      try {
        if (typeof Nav.buildGrid === 'function') Nav.buildGrid(true);
        sizeAfterRebuild = Nav.getGridInfo().size;
      } catch (e) { sizeAfterRebuild = 'throw: ' + e.message; }
      check('A6 Nav.getGridInfo().size theo map size sau buildGrid (128)',
        sizeAfterRebuild === 128, 'size=' + sizeAfterRebuild);
    } else skip('A6 Nav.getGridInfo().size', 'ED.Nav.getGridInfo không tồn tại');
    T.setSize(96);
  } else skip('A4-A6 setSize/Nav size', 'ED.Terrain.setSize không tồn tại');

  // ---- regions (pure regionAt) ----
  if (typeof T.regionAt === 'function') {
    const regions = [
      { id: 'r1', name: 'Biện Kinh Thành', x0: -48, z0: -48, x1: 0, z1: 0, preset: 'dusk' },
      { id: 'r2', name: 'Rừng Trúc', x0: 0, z0: 0, x1: 48, z1: 48, preset: 'night' }
    ];
    const a = T.regionAt(regions, -10, -10);
    const b = T.regionAt(regions, 10, 10);
    const none = T.regionAt(regions, -10, 10);
    check('A7 regionAt trả đúng vùng theo tọa độ', a && a.id === 'r1' && b && b.id === 'r2' && none === null,
      'a=' + JSON.stringify(a) + ' b=' + JSON.stringify(b) + ' none=' + JSON.stringify(none));
    check('A8 regionAt vùng CUỐI cùng thắng khi chồng lấn', (() => {
      const r = T.regionAt([
        { id: 'x', name: 'X', x0: -10, z0: -10, x1: 10, z1: 10, preset: 'day' },
        { id: 'y', name: 'Y', x0: -10, z0: -10, x1: 10, z1: 10, preset: 'night' }
      ], 0, 0);
      return r && r.id === 'y';
    })());
  } else skip('A7-A8 regionAt', 'ED.Terrain.regionAt không tồn tại');
  if (typeof T.addRegion === 'function' && typeof T.getRegions === 'function') {
    try {
      Core.newProject('t6-regions');
      const r = T.addRegion('Núi Tuyết', -48, -48, 0, 0, 'snow');
      const list = T.getRegions();
      const hit = T.regionAt(list, -10, -10);
      check('A9 addRegion/getRegions + regionAt: vùng "Núi Tuyết" lưu được và tra đúng theo tọa độ',
        !!r && Array.isArray(list) && list.length >= 1 && hit && hit.name === 'Núi Tuyết',
        'regions=' + JSON.stringify(list));
      if (typeof T.removeRegion === 'function' && r && r.id) T.removeRegion(r.id);
    } catch (e) { check('A9 addRegion/getRegions', false, 'throw: ' + e.message); }
  } else skip('A9 addRegion/getRegions', 'addRegion/getRegions không tồn tại');
  if (typeof Core.newProject === 'function' && typeof T.syncFromProject === 'function') {
    Core.newProject('t6');
    Core.getProject().terrain.size = 192;
    T.syncFromProject();
    check('A10 syncFromProject đọc terrain.size=192', T.getSize() === 192, 'getSize=' + T.getSize());
    T.setSize(96);
  } else skip('A10 syncFromProject size', 'newProject/syncFromProject không tồn tại');

  // ---- spline pure ----
  if (typeof T.splineFlatten === 'function') {
    // heights toàn 0, trừ 3 gai: (31,33)=(-1.5,1.5) cách spline 1.5 (trong nửa
    // rộng 2 -> phẳng hẳn về cao độ spline = 0); (31,34)=(-1.5,3) cách 3
    // (vùng chuyển tiếp f=0.5 -> 5); (31,40)=(-1.5,12) cách 12 -> giữ 7.
    // splineFlatten trả MẢNG MỚI, không sửa mảng gốc.
    const heights = new Float32Array(65 * 65).fill(0);
    heights[33 * 65 + 31] = 10;
    heights[34 * 65 + 31] = 10;
    heights[40 * 65 + 31] = 7;
    const out = T.splineFlatten(heights, 96, [[-10, 0], [10, 0]], 4);
    check('B1 splineFlatten: gai trong nửa rộng -> 0, vùng chuyển tiếp -> 5, xa -> giữ nguyên, mảng gốc không đổi',
      approx(out[33 * 65 + 31], 0, 0.01) && approx(out[34 * 65 + 31], 5, 0.01) && approx(out[40 * 65 + 31], 7, 0.01) && heights[33 * 65 + 31] === 10,
      'h(33,31)=' + out[33 * 65 + 31] + ' h(34,31)=' + out[34 * 65 + 31] + ' h(40,31)=' + out[40 * 65 + 31]);
    check('B2 splineFlatten points < 2 -> trả bản sao heights',
      (() => { const c = T.splineFlatten(heights, 96, [[0, 0]], 4); return c.length === heights.length && c[33 * 65 + 31] === 10 && c !== heights; })());
  } else skip('B1-B2 splineFlatten', 'splineFlatten không tồn tại');
  if (typeof T.roadCells === 'function') {
    const cells = T.roadCells([[-10, 0], [10, 0]], 4, 96);
    const allPairs = Array.isArray(cells) && cells.every(c => Array.isArray(c) && c.length === 2 && c[0] >= 0 && c[0] <= 64 && c[1] >= 0 && c[1] <= 64);
    const hasCenter = cells.some(c => c[0] === 32 && c[1] === 32);
    check('B3 roadCells trả cặp [gx,gz] trong 0..64, đủ dài, chứa ô giữa (32,32)',
      allPairs && cells.length >= 10 && hasCenter, 'n=' + (cells ? cells.length : 'null'));
  } else skip('B3 roadCells', 'roadCells không tồn tại');
  if (typeof T.extendRiverToWater === 'function') {
    const paints = new Uint8Array(65 * 65).fill(0);
    paints[32 * 65 + 40] = 4; // ô nước ở (12,0)
    const res = T.extendRiverToWater(paints, [[0, 0], [8, 0]], 96);
    const last = res && res.points && res.points[res.points.length - 1];
    check('B4 sông nối hồ: snapped=true, ends chứa "end", điểm cuối (12,0)',
      res && res.snapped === true && res.ends.indexOf('end') >= 0 && last && approx(last[0], 12, 0.01) && approx(last[1], 0, 0.01),
      'res=' + JSON.stringify(res && { snapped: res.snapped, ends: res.ends, last: last }));
    const noWater = T.extendRiverToWater(new Uint8Array(65 * 65).fill(0), [[0, 0], [8, 0]], 96);
    check('B5 sông không nối khi không có hồ gần: snapped=false, giữ 2 điểm',
      noWater && noWater.snapped === false && noWater.points.length === 2, 'snapped=' + (noWater && noWater.snapped));
  } else skip('B4-B5 extendRiverToWater', 'extendRiverToWater không tồn tại');
  if (typeof T.splineNearestPoint === 'function') {
    const p = T.splineNearestPoint([[0, 0], [10, 0]], 5, 3);
    check('B6 splineNearestPoint(5,3) -> {px:5, pz:0, dist:3}',
      p && approx(p.px, 5, 0.01) && approx(p.pz, 0, 0.01) && approx(p.dist, 3, 0.01), 'p=' + JSON.stringify(p));
  } else skip('B6 splineNearestPoint', 'splineNearestPoint không tồn tại');
  if (typeof T.resamplePolyline === 'function') {
    const r = T.resamplePolyline([[0, 0], [10, 0]], 2);
    check('B7 resamplePolyline bước 2 -> 6 điểm', r && r.length === 6 && approx(r[5][0], 10, 0.01), 'n=' + (r ? r.length : 'null'));
  } else skip('B7 resamplePolyline', 'resamplePolyline không tồn tại');

  // ---- scatter pure ----
  if (typeof T.scatterPositions === 'function') {
    const a = T.scatterPositions(7, 10, 0, 0, 5);
    const b = T.scatterPositions(7, 10, 0, 0, 5);
    const c = T.scatterPositions(8, 10, 0, 0, 5);
    const inside = a && a.every(p => Math.hypot(p[0], p[1]) <= 5.0001);
    check('B8 scatterPositions: 10 điểm trong bán kính 5 + seed lặp giống hệt + seed khác khác nhau',
      a && a.length === 10 && inside && deepEq(a, b) && !deepEq(a, c),
      'n=' + (a ? a.length : 'null') + ' inside=' + inside);
  } else skip('B8 scatterPositions', 'scatterPositions không tồn tại');
  if (typeof T.scatterStrokeCount === 'function') {
    check('B9 scatterStrokeCount(10,4)=50, (50,10)=200 (capped)',
      T.scatterStrokeCount(10, 4) === 50 && T.scatterStrokeCount(50, 10) === 200,
      '10,4=' + T.scatterStrokeCount(10, 4) + ' 50,10=' + T.scatterStrokeCount(50, 10));
  } else skip('B9 scatterStrokeCount', 'scatterStrokeCount không tồn tại');

  // ---- addSpline end-to-end (Core + Terrain) ----
  if (typeof Core.newProject === 'function' && typeof T.addSpline === 'function' && typeof T.setHeights === 'function') {
    try {
    Core.newProject('t6-spline');
    const ramp = new Float32Array(65 * 65);
    for (let iz = 0; iz < 65; iz++) for (let ix = 0; ix < 65; ix++) ramp[iz * 65 + ix] = iz;
    T.setHeights(ramp);
    const obj = T.addSpline('road', [[-20, 0], [20, 0]], { width: 4 });
    const list = (typeof Core.listObjects === 'function') ? Core.listObjects() : [];
    const found = list.find(o => o && o.type === 'spline' && o.extra && o.extra.splineKind === 'road');
    const hAfter = T.getHeights();
    check('B10 addSpline road: tạo Core object spline + làm phẳng ô (32,31)->32 + tô paint đường=1',
      !!obj && !!found && approx(hAfter[32 * 65 + 31], 32, 0.01) && T.getPaints()[32 * 65 + 32] === 1,
      'found=' + !!found + ' h(32,31)=' + hAfter[32 * 65 + 31] + ' paint(32,32)=' + T.getPaints()[32 * 65 + 32]);
    // river snap e2e
    const paints2 = new Uint8Array(65 * 65).fill(0);
    paints2[32 * 65 + 40] = 4;
    T.setPaints(paints2);
    const rObj = T.addSpline('river', [[0, 0], [8, 0]], { width: 4 });
    const rPts = rObj && rObj.extra && rObj.extra.points;
    check('B11 addSpline river: tự nối hồ, điểm cuối (12,0)',
      !!rPts && rPts.length >= 3 && approx(rPts[rPts.length - 1][0], 12, 0.01) && approx(rPts[rPts.length - 1][1], 0, 0.01),
      'pts=' + JSON.stringify(rPts));
    } catch (e) {
      check('B10-B11 addSpline e2e', false, 'throw: ' + e.message);
    }
  } else skip('B10-B11 addSpline e2e', 'newProject/addSpline/setHeights không đủ');

  // ---- buildSplineGroup / buildScatterGroup (THREE stub) ----
  if (typeof T.buildSplineGroup === 'function') {
    try {
      const gRoad = T.buildSplineGroup({ type: 'spline', extra: { splineKind: 'road', points: [[-20, 0], [20, 0]], width: 4 } });
      const roadKids = gRoad && gRoad.children ? gRoad.children.length : 0;
      check('B12 buildSplineGroup road trả Group có con', !!gRoad && roadKids > 0, 'children=' + roadKids);
    } catch (e) { check('B12 buildSplineGroup road trả Group có con', false, 'throw: ' + e.message); }
    try {
      const gRiver = T.buildSplineGroup({ type: 'spline', extra: { splineKind: 'river', points: [[0, 0], [10, 0]], width: 4 } });
      let transparent = false;
      if (gRiver) gRiver.traverse(o => { if (o && o.material && o.material.transparent && approx(o.material.opacity, 0.8, 0.01)) transparent = true; });
      check('B13 buildSplineGroup river: mặt nước transparent opacity 0.8', !!gRiver && transparent, 'transparent=' + transparent);
    } catch (e) { check('B13 buildSplineGroup river', false, 'throw: ' + e.message); }
    try {
      const gFence = T.buildSplineGroup({ type: 'spline', extra: { splineKind: 'fence', points: [[0, 0], [20, 0]], width: 2 } });
      let instanced = false;
      if (gFence) gFence.traverse(o => { if (o && o.isInstancedMesh) instanced = true; });
      check('B14 buildSplineGroup fence dùng InstancedMesh', !!gFence && instanced, 'instanced=' + instanced);
    } catch (e) { check('B14 buildSplineGroup fence', false, 'throw: ' + e.message); }
  } else skip('B12-B14 buildSplineGroup', 'buildSplineGroup không tồn tại');
  if (typeof T.buildScatterGroup === 'function') {
    try {
      const g = T.buildScatterGroup({ type: 'scatter', extra: { kind: 'tree', count: 12, seed: 5, radius: 6, center: [0, 0] } });
      let instancedCount = -1;
      if (g) g.traverse(o => { if (o && o.isInstancedMesh) instancedCount = o.count; });
      check('B15 buildScatterGroup: 1 InstancedMesh count=12', !!g && instancedCount === 12, 'count=' + instancedCount);
    } catch (e) { check('B15 buildScatterGroup', false, 'throw: ' + e.message); }
  } else skip('B15 buildScatterGroup', 'buildScatterGroup không tồn tại');
  if (typeof T.tick === 'function') {
    try { T.tick(0.016); check('B16 Terrain.tick(dt) chạy không lỗi', true); }
    catch (e) { check('B16 Terrain.tick(dt) chạy không lỗi', false, 'throw: ' + e.message); }
  } else skip('B16 Terrain.tick', 'ED.Terrain.tick không tồn tại');

  // ---- Core multi-select ----
  if (typeof Core.newProject === 'function' && typeof Core.addObject === 'function') {
    Core.newProject('t6-select');
    const o1 = Core.addObject({ type: 'tree', name: 'A', pos: [0, 0, 0] });
    const o2 = Core.addObject({ type: 'rock', name: 'B', pos: [1, 0, 0] });
    const o3 = Core.addObject({ type: 'tree', name: 'C', pos: [2, 0, 0] });
    const ids = [o1 && o1.id, o2 && o2.id, o3 && o3.id];
    if (typeof Core.selectMany === 'function' && typeof Core.getSelectedIds === 'function') {
      Core.selectMany([ids[0], ids[1], 'nope']);
      check('C1 selectMany lọc id lạ, giữ 2 id đúng', deepEq(Core.getSelectedIds(), [ids[0], ids[1]]), JSON.stringify(Core.getSelectedIds()));
      if (typeof Core.addToSelection === 'function') {
        Core.addToSelection(ids[2]);
        check('C2 addToSelection thêm id thứ 3', Core.getSelectedIds().length === 3, JSON.stringify(Core.getSelectedIds()));
      } else skip('C2 addToSelection', 'addToSelection không tồn tại');
      if (typeof Core.removeFromSelection === 'function') {
        Core.removeFromSelection(ids[1]);
        check('C3 removeFromSelection bỏ id giữa', deepEq(Core.getSelectedIds(), [ids[0], ids[2]]), JSON.stringify(Core.getSelectedIds()));
      } else skip('C3 removeFromSelection', 'removeFromSelection không tồn tại');
      if (typeof Core.clearSelection === 'function') {
        Core.clearSelection();
        check('C4 clearSelection rỗng', Core.getSelectedIds().length === 0, JSON.stringify(Core.getSelectedIds()));
      } else skip('C4 clearSelection', 'clearSelection không tồn tại');
      if (typeof Core.select === 'function' && typeof Core.selectedId === 'function') {
        Core.selectMany([ids[1], ids[2]]);
        Core.select(ids[0]);
        check('C5 select(id) tương thích: selectedId = phần tử đầu', Core.selectedId() === ids[0] && deepEq(Core.getSelectedIds(), [ids[0]]),
          'selectedId=' + Core.selectedId());
      } else skip('C5 select/selectedId tương thích', 'select/selectedId không tồn tại');
    } else skip('C1-C5 multi-select Core', 'selectMany/getSelectedIds không tồn tại');
  } else skip('C1-C5 multi-select Core', 'newProject/addObject không tồn tại');
})();

/* ========== (D) Viewport thuần: bloom/vignette/camera path/bookmark/ruler/box/group ========== */
(function sectionViewport() {
  let ctx;
  try {
    ctx = loadVm('src/editor/01-viewport.js');
  } catch (e) {
    skip('D0 load 01-viewport.js trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const V = ctx.ED.Viewport || {};
  const g = (name) => (typeof ctx[name] === 'function') ? ctx[name] : V[name];

  // bloom / vignette clamp
  const clampBloom = g('clampBloom');
  if (clampBloom) {
    const d = clampBloom({});
    check('D1 clampBloom({}) mặc định bật, strength 0.6, radius 0.4, threshold 0.85',
      d.enabled === true && approx(d.strength, 0.6) && approx(d.radius, 0.4) && approx(d.threshold, 0.85),
      JSON.stringify(d));
    const c = clampBloom({ enabled: true, strength: 5, radius: -1, threshold: 2 });
    check('D2 clampBloom kẹp miền strength<=2, radius>=0, threshold<=1',
      approx(c.strength, 2) && approx(c.radius, 0) && approx(c.threshold, 1), JSON.stringify(c));
  } else skip('D1-D2 clampBloom', 'clampBloom không tồn tại');
  const clampVignette = g('clampVignette');
  if (clampVignette) {
    const d = clampVignette({});
    const c = clampVignette({ enabled: true, strength: 2 });
    check('D3 clampVignette mặc định tắt/0.5, kẹp strength<=1',
      d.enabled === false && approx(d.strength, 0.5) && approx(c.strength, 1), JSON.stringify(d) + ' / ' + JSON.stringify(c));
  } else skip('D3 clampVignette', 'clampVignette không tồn tại');

  // camera path Catmull-Rom
  const pathPoint = g('edCameraPathPoint');
  if (pathPoint) {
    const keys = [
      { t: 0, pos: [0, 0, 0], target: [0, 0, -1] },
      { t: 2, pos: [10, 0, 0], target: [10, 0, -1] }
    ];
    const mid = pathPoint(keys, 1);
    check('D4 edCameraPathPoint 2 key tại t=1: x~5, y~0',
      mid && approx(mid.pos[0], 5, 0.05) && approx(mid.pos[1], 0, 0.01), 'mid=' + JSON.stringify(mid && mid.pos));
    const before = pathPoint(keys, -5);
    const after = pathPoint(keys, 99);
    check('D5 edCameraPathPoint ngoài miền kẹp về key đầu/cuối',
      before && deepEq(before.pos, [0, 0, 0]) && after && deepEq(after.pos, [10, 0, 0]),
      'before=' + JSON.stringify(before && before.pos) + ' after=' + JSON.stringify(after && after.pos));
    check('D6 edCameraPathPoint 1 key trả chính key đó; [] trả null',
      deepEq(pathPoint([{ t: 0, pos: [3, 2, 1], target: [0, 0, 0] }], 5).pos, [3, 2, 1]) && pathPoint([], 1) === null);
    const rev = pathPoint([
      { t: 2, pos: [10, 0, 0], target: [10, 0, -1] },
      { t: 0, pos: [0, 0, 0], target: [0, 0, -1] }
    ], 1);
    check('D7 edCameraPathPoint keys chưa sort vẫn đúng (t=1 -> x~5)',
      rev && approx(rev.pos[0], 5, 0.05), 'rev=' + JSON.stringify(rev && rev.pos));
  } else skip('D4-D7 edCameraPathPoint', 'edCameraPathPoint không tồn tại');

  // bookmark normalize
  const bookmarkNormalize = g('bookmarkNormalize');
  if (bookmarkNormalize) {
    const in7 = [
      { id: 'a', name: 'A', pos: [0, 0, 0], target: [0, 0, -1] },
      { id: 'a', name: 'B', pos: [1, 1, 1], target: [1, 1, 1] },
      { id: 'b', pos: [2, 2, 2], target: [2, 2, 2] },
      { id: 'c', name: 'C' },
      { pos: [0, 0, 0], target: [0, 0, 0] },
      null,
      'x'
    ];
    const out = bookmarkNormalize(in7);
    check('D8 bookmarkNormalize 7 entry -> 2: trùng id giữ cái đầu, thiếu tên -> "Góc"',
      Array.isArray(out) && out.length === 2 && out[0].name === 'A' && out[1].id === 'b' && out[1].name === 'Góc',
      'out=' + JSON.stringify(out));
  } else skip('D8 bookmarkNormalize', 'bookmarkNormalize không tồn tại');

  // ruler / box select / group transforms (pure, top-level hoặc ED.Viewport)
  const measure = g('measurePathLength');
  if (measure) {
    const m1 = measure([[0, 0], [3, 4]]);
    const m2 = measure([[0, 0], [3, 4], [3, 8]]);
    const m0 = measure([]);
    const m1p = measure([[1, 2]]);
    check('E1 measurePathLength (3,4)=5; 3 điểm cộng dồn=9; rỗng/1 điểm=0',
      m1 && approx(m1.total, 5) && deepEq(m1.segments, [5]) &&
      m2 && approx(m2.total, 9) && m0 && approx(m0.total, 0) && m1p && approx(m1p.total, 0),
      'm1=' + JSON.stringify(m1) + ' m2=' + JSON.stringify(m2));
  } else skip('E1 measurePathLength', 'measurePathLength không tồn tại');
  const normRect = g('normalizeBoxRect');
  if (normRect) {
    check('E2 normalizeBoxRect(10,20,5,8) -> {5,8,10,20}',
      deepEq(normRect(10, 20, 5, 8), { x0: 5, y0: 8, x1: 10, y1: 20 }), JSON.stringify(normRect(10, 20, 5, 8)));
  } else skip('E2 normalizeBoxRect', 'normalizeBoxRect không tồn tại');
  const boxFilter = g('boxSelectFilter');
  if (boxFilter) {
    const objs = [
      { id: 'a', pos: [10, 0, 10] },
      { id: 'b', pos: [30, 0, 10] },
      { id: 'c', pos: [10, 0, 10], locked: true },
      { id: 'd', pos: [10, 0, 10], visible: false },
      { id: 'e' },
      { id: 'f', pos: [10, 0, 10] }
    ];
    const proj = (v) => {
      if (!v) return null;
      const x = (typeof v.x === 'number') ? v.x : v[0];
      const y = (typeof v.z === 'number') ? v.z : v[2];
      if (x === 30) return { x: 30, y: 10 };
      if (x === 10 && y === 10) return null; // f: projectFn trả null
      return { x, y };
    };
    // f phải project được nên dùng projectFn riêng cho f: gán lại
    const proj2 = (v) => {
      if (!v) return null;
      const x = (typeof v.x === 'number') ? v.x : v[0];
      const y = (typeof v.z === 'number') ? v.z : v[2];
      return { x, y };
    };
    const got = boxFilter(objs.slice(0, 5), proj2, { x0: 0, y0: 0, x1: 20, y1: 20 });
    const gotNull = boxFilter([objs[5]], proj, { x0: 0, y0: 0, x1: 20, y1: 20 });
    check('E3 boxSelectFilter: trong khung + bỏ khóa/ẩn/không pos; projectFn null -> loại',
      deepEq(got, ['a']) && deepEq(gotNull, []), 'got=' + JSON.stringify(got) + ' gotNull=' + JSON.stringify(gotNull));
  } else skip('E3 boxSelectFilter', 'boxSelectFilter không tồn tại');
  const boxToggle = g('boxSelectToggle');
  if (boxToggle) {
    check('E4 boxSelectToggle(["a","b"],["b","c"]) -> ["a","c"]',
      deepEq(boxToggle(['a', 'b'], ['b', 'c']), ['a', 'c']), JSON.stringify(boxToggle(['a', 'b'], ['b', 'c'])));
  } else skip('E4 boxSelectToggle', 'boxSelectToggle không tồn tại');
  const gCenter = g('groupCenter');
  if (gCenter) {
    const c = gCenter([[0, 0, 0], [2, 0, 0]]);
    check('E5 groupCenter([[0,0,0],[2,0,0]]) -> [1,0,0]',
      c && approx(c[0], 1) && approx(c[1], 0) && approx(c[2], 0), 'c=' + JSON.stringify(c));
  } else skip('E5 groupCenter', 'groupCenter không tồn tại');
  const gMove = g('groupMovePositions');
  if (gMove) {
    check('E6 groupMovePositions +[5,0,-1] đúng',
      deepEq(gMove([[0, 0, 0], [1, 2, 3]], [5, 0, -1]), [[5, 0, -1], [6, 2, 2]]),
      JSON.stringify(gMove([[0, 0, 0], [1, 2, 3]], [5, 0, -1])));
  } else skip('E6 groupMovePositions', 'groupMovePositions không tồn tại');
  const gRot = g('groupRotateYPositions');
  if (gRot) {
    const r = gRot([[1, 0, 0]], [0, 0, 0], Math.PI / 2);
    check('E7 groupRotateYPositions 90°: (1,0,0)->(0,0,-1)',
      r && approx(r[0][0], 0, 1e-9) && approx(r[0][2], -1, 1e-9), 'r=' + JSON.stringify(r));
  } else skip('E7 groupRotateYPositions', 'groupRotateYPositions không tồn tại');
  const gScale = g('groupScalePositions');
  if (gScale) {
    const s = gScale([[2, 0, 0]], [0, 0, 0], 2);
    check('E8 groupScalePositions x2: (2,0,0)->(4,0,0)',
      s && approx(s[0][0], 4, 1e-9), 's=' + JSON.stringify(s));
  } else skip('E8 groupScalePositions', 'groupScalePositions không tồn tại');
  if (typeof V.setBoxSelect === 'function' && typeof V.getBoxSelect === 'function' && typeof V.setRuler === 'function') {
    V.setBoxSelect(true);
    const on = V.getBoxSelect() === true;
    V.setBoxSelect(false);
    check('E9 Viewport setBoxSelect/getBoxSelect bật/tắt', on && V.getBoxSelect() === false);
  } else skip('E9 setBoxSelect/getBoxSelect', 'setBoxSelect/getBoxSelect không tồn tại');
  if (typeof V.addRulerPoint === 'function' && typeof V.getRulerPoints === 'function' && typeof V.clearRuler === 'function') {
    V.clearRuler();
    V.addRulerPoint(0, 0);
    V.addRulerPoint(3, 4);
    const pts = V.getRulerPoints();
    check('E10 Viewport ruler add/get 2 điểm [x,y,z] (y=0.15 khi chưa có Terrain)',
      pts && pts.length === 2 && approx(pts[0][0], 0) && approx(pts[0][2], 0) && approx(pts[1][0], 3) && approx(pts[1][2], 4),
      'pts=' + JSON.stringify(pts));
    V.clearRuler();
  } else skip('E10 Viewport ruler API', 'addRulerPoint/getRulerPoints/clearRuler không tồn tại');
})();

/* ========== (E) Environment thuần: sky, mây, chớp, weather ========== */
(function sectionEnvironment() {
  let ctx;
  try {
    ctx = loadVm('src/editor/05-environment.js');
  } catch (e) {
    skip('F0 load 05-environment.js trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const Env = ctx.ED.Environment || {};
  const g = (name) => (typeof ctx[name] === 'function') ? ctx[name] : Env[name];

  const skyColors = g('skyColorsForHour');
  if (skyColors) {
    const h0 = skyColors(0), h12 = skyColors(12), h24 = skyColors(24), h6 = skyColors(6);
    const sum = (c) => c.top[0] + c.top[1] + c.top[2];
    check('F1 skyColorsForHour(0) == skyColorsForHour(24) (chu kỳ 24h)',
      deepEq(h0, h24), 'h0=' + JSON.stringify(h0) + ' h24=' + JSON.stringify(h24));
    check('F2 sky: trưa sáng hơn nửa đêm (tổng top 12h > 0h)',
      h0 && h12 && sum(h12) > sum(h0), 'sum12=' + sum(h12) + ' sum0=' + sum(h0));
    check('F3 sky: sao ban đêm > 0.8, trưa = 0',
      h0 && h0.starOpacity > 0.8 && h12 && h12.starOpacity === 0,
      'star0=' + (h0 && h0.starOpacity) + ' star12=' + (h12 && h12.starOpacity));
    check('F4 sky: bình minh (6h) bottom đỏ > xanh',
      h6 && h6.bottom[0] > h6.bottom[2], 'bottom6=' + JSON.stringify(h6 && h6.bottom));
    check('F5 sky: trưa top xanh > đỏ',
      h12 && h12.top[2] > h12.top[0], 'top12=' + JSON.stringify(h12 && h12.top));
  } else skip('F1-F5 skyColorsForHour', 'skyColorsForHour không tồn tại');
  const sun = g('computeSun');
  if (sun) {
    const s12 = sun(12);
    const s0 = sun(0);
    check('F6 computeSun(12): sunDir là vector 3 số, isDay=true',
      s12 && Array.isArray(s12.sunDir) && s12.sunDir.length === 3 && s12.sunDir.every(v => typeof v === 'number') && s12.isDay === true,
      'sun12=' + JSON.stringify(s12));
    check('F7 computeSun(12) mặt trời cao hơn computeSun(0): sunDir[1] lớn hơn, isDay đổi, sunIntensity lớn hơn',
      s12 && s0 && s12.sunDir[1] > s0.sunDir[1] && s0.isDay === false && s12.sunIntensity > s0.sunIntensity,
      'y12=' + s12.sunDir[1] + ' y0=' + s0.sunDir[1] + ' i12=' + s12.sunIntensity + ' i0=' + s0.sunIntensity);
  } else skip('F6-F7 computeSun', 'computeSun không tồn tại');
  const clouds = g('edEnvCloudPositions');
  if (clouds) {
    const c0 = clouds(0, 0, [1, 0]);
    const c4 = clouds(4, 0, [1, 0]);
    const c4b = clouds(4, 2, [1, 0]);
    const yOk = c4.every(c => c.y >= 20 && c.y <= 28);
    let dxOk = true;
    for (let i = 0; i < 4; i++) {
      let dx = c4b[i].x - c4[i].x;
      if (dx < -48) dx += 96;
      if (dx > 48) dx -= 96;
      if (!approx(dx, 2, 0.01)) dxOk = false;
    }
    check('F8 edEnvCloudPositions: 0 mây -> []; 4 mây y trong [20,28]; sau 2s bay +2m theo gió [1,0] (xử lý cuộn biên)',
      deepEq(c0, []) && c4.length === 4 && yOk && dxOk, 'yOk=' + yOk + ' dxOk=' + dxOk);
  } else skip('F8 edEnvCloudPositions', 'edEnvCloudPositions không tồn tại');
  const rng = g('edEnvMulberry32');
  if (rng) {
    const a = rng(42), b = rng(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    check('F9 edEnvMulberry32 cùng seed -> dãy giống hệt, giá trị trong [0,1)',
      deepEq(seqA, seqB) && seqA.every(v => v >= 0 && v < 1), 'seq=' + JSON.stringify(seqA));
  } else skip('F9 edEnvMulberry32', 'edEnvMulberry32 không tồn tại');
  const flash = g('thunderFlashSchedule');
  if (flash) {
    const s1 = flash(123, 60), s2 = flash(123, 60);
    const firstOk = s1.length > 0 && s1[0] >= 2 && s1[0] <= 6;
    let gapsOk = true;
    for (let i = 1; i < s1.length; i++) { const gap = s1[i] - s1[i - 1]; if (gap < 4 - 1e-9 || gap > 12 + 1e-9) gapsOk = false; }
    const sRate2 = flash(123, 120, 2);
    const sRate1 = flash(123, 120, 1);
    check('F10 thunderFlashSchedule: cùng seed giống hệt; chớp đầu 2-6s; khoảng 4-12s; rate 2 nhiều hơn rate 1',
      deepEq(s1, s2) && firstOk && gapsOk && sRate2.length > sRate1.length,
      'n60=' + s1.length + ' first=' + (s1[0]) + ' gapsOk=' + gapsOk + ' n120 r1=' + sRate1.length + ' r2=' + sRate2.length);
    check('F11 thunderFlashSchedule(0,0) -> []', deepEq(flash(7, 0), []));
  } else skip('F10-F11 thunderFlashSchedule', 'thunderFlashSchedule không tồn tại');
  const normW = g('normalizeWeather');
  if (normW) {
    check('F12 normalizeWeather giữ thunder/sandstorm/rain; rác -> none',
      normW('thunder') === 'thunder' && normW('sandstorm') === 'sandstorm' && normW('rain') === 'rain' && normW('bogus') === 'none' && normW(null) === 'none',
      'bogus=' + normW('bogus'));
  } else skip('F12 normalizeWeather', 'normalizeWeather không tồn tại');
  const counts = Env.WEATHER_COUNTS || ctx.WEATHER_COUNTS;
  if (counts) {
    check('F13 WEATHER_COUNTS thunder 2000 > rain 800 > snow 500; sandstorm 600',
      counts.thunder === 2000 && counts.rain === 800 && counts.snow === 500 && counts.sandstorm === 600,
      JSON.stringify(counts));
  } else skip('F13 WEATHER_COUNTS', 'WEATHER_COUNTS không tồn tại');
  if (typeof Env.getEnv === 'function') {
    const env = Env.getEnv();
    check('F14 getEnv mặc định skybox=true, thunderRate=1',
      env && env.skybox === true && env.thunderRate === 1, 'env=' + JSON.stringify(env));
  } else skip('F14 getEnv mặc định', 'ED.Environment.getEnv không tồn tại');
})();

/* ========== (F) Fx foam + Assets waterfall + Export playThunder ========== */
(function sectionFxAssetsExport() {
  // Fx
  try {
    const ctxFx = loadVm('src/editor/06-fx.js');
    const Fx = ctxFx.ED.Fx || {};
    const types = Fx.TYPES || ctxFx.TYPES;
    if (types && types.foam) {
      check('G1 Fx TYPES.foam count=40', types.foam.count === 40, JSON.stringify(types.foam));
    } else skip('G1 Fx TYPES.foam', 'TYPES.foam không tồn tại');
    const val = (typeof Fx.validateExtra === 'function') ? Fx.validateExtra({ fxType: 'foam' }) : ctxFx.validateExtra && ctxFx.validateExtra({ fxType: 'foam' });
    if (val) {
      check('G2 Fx.validateExtra({fxType:"foam"}) -> fxType foam, count=40',
        val.fxType === 'foam' && val.count === 40, JSON.stringify(val));
    } else skip('G2 Fx.validateExtra foam', 'validateExtra không tồn tại');
    if (typeof Fx.buildFx === 'function') {
      try {
        const fx = Fx.buildFx('foam', { x: 0, y: 0, z: 0 });
        const n = fx && fx.userData && fx.userData.fx && fx.userData.fx.count;
        let hasPoints = false;
        if (fx) fx.traverse(o => { if (o instanceof ctxFx.THREE.Points) hasPoints = true; });
        check('G3 Fx.buildFx("foam") trả group Points, userData.fx.count=40',
          !!fx && n === 40 && hasPoints, 'count=' + n + ' hasPoints=' + hasPoints);
      } catch (e) { check('G3 Fx.buildFx("foam")', false, 'throw: ' + e.message); }
    } else skip('G3 Fx.buildFx foam', 'buildFx không tồn tại');
  } catch (e) {
    skip('G1-G3 Fx foam', 'load 06-fx.js lỗi: ' + e.message);
  }
  // Assets waterfall
  try {
    const ctxA = loadVm('src/editor/06-fx.js');
    vm.runInContext(read('src/editor/03-assets.js'), ctxA, { filename: 'src/editor/03-assets.js' });
    const A = ctxA.ED.Assets || {};
    const def = (typeof A.defOf === 'function') ? A.defOf('waterfall') : null;
    check('G4 Assets defOf("waterfall") tồn tại', !!def, 'def=' + JSON.stringify(def));
    if (typeof A.buildMesh === 'function') {
      try {
        const mesh0 = A.buildMesh('waterfall', {});
        check('G5 Assets waterfall build có userData.foam=true (bọt gắn con của group thác)',
          !!mesh0 && mesh0.userData.foam === true, 'foam=' + (mesh0 && mesh0.userData.foam));
      } catch (e) { check('G5 Assets waterfall userData.foam', false, 'throw: ' + e.message); }
    } else skip('G5 Assets waterfall userData.foam', 'buildMesh không tồn tại');
    if (typeof A.buildMesh === 'function') {
      try {
        const mesh = A.buildMesh('waterfall', {});
        let hasWater = false;
        if (mesh) mesh.traverse(o => {
          if (o && o.geometry) hasWater = true;
        });
        check('G6 Assets.buildMesh("waterfall", {}) trả group có geometry (mặt nước đứng + hồ + vách đá)',
          !!mesh && hasWater, 'hasGeo=' + hasWater);
      } catch (e) { check('G6 Assets.buildMesh("waterfall")', false, 'throw: ' + e.message); }
    } else skip('G6 Assets.buildMesh waterfall', 'buildMesh không tồn tại');
  } catch (e) {
    skip('G4-G6 Assets waterfall', 'load 03-assets.js lỗi: ' + e.message);
  }
  // Export playThunder
  try {
    const ctxE = loadVm('src/editor/15-export.js');
    const Ex = ctxE.ED.Export || {};
    const Au = ctxE.ED.Audio || {};
    check('G7 ED.Export.playThunder là function', typeof Ex.playThunder === 'function', 'type=' + typeof Ex.playThunder);
    check('G8 ED.Audio.playThunder là function', typeof Au.playThunder === 'function', 'type=' + typeof Au.playThunder);
    if (typeof Ex.playThunder === 'function') {
      try {
        const r = Ex.playThunder();
        check('G9 ED.Export.playThunder() chạy không lỗi, trả boolean', typeof r === 'boolean', 'r=' + r);
      } catch (e) { check('G9 ED.Export.playThunder() chạy không lỗi', false, 'throw: ' + e.message); }
    } else skip('G9 Export.playThunder()', 'playThunder không tồn tại');
  } catch (e) {
    skip('G7-G9 Export playThunder', 'load 15-export.js lỗi: ' + e.message);
  }
})();

/* ========== (G) Minimap thuần ========== */
(function sectionMinimap() {
  let ctx;
  try {
    ctx = loadVm('src/editor/19-minimap.js');
  } catch (e) {
    skip('H0 load 19-minimap.js trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const M = ctx.ED.Minimap || {};
  const g = (name) => (typeof ctx[name] === 'function') ? ctx[name] : M[name];

  const colorFor = g('minimapColorFor');
  if (colorFor) {
    check('H1 minimapColorFor: cỏ h=0 #2f6b2f, h=3 #4f8d3f, nước #2f6fb2, tuyết h>=6 #f2f5f7',
      colorFor(0, 0) === '#2f6b2f' && colorFor(3, 0) === '#4f8d3f' && colorFor(0, 4) === '#2f6fb2' && colorFor(6, 0) === '#f2f5f7',
      'h0=' + colorFor(0, 0) + ' h3=' + colorFor(3, 0) + ' water=' + colorFor(0, 4) + ' snow=' + colorFor(6, 0));
    check('H2 minimapColorFor: đất #8a6a42, đá #7d7d7d, cát #d8c27a',
      colorFor(0, 1) === '#8a6a42' && colorFor(0, 2) === '#7d7d7d' && colorFor(0, 3) === '#d8c27a',
      'dirt=' + colorFor(0, 1) + ' rock=' + colorFor(0, 2) + ' sand=' + colorFor(0, 3));
  } else skip('H1-H2 minimapColorFor', 'minimapColorFor không tồn tại');
  const clickToWorld = g('minimapClickToWorld');
  const worldToPx = g('minimapWorldToPx');
  if (clickToWorld) {
    check('H3 minimapClickToWorld: tâm=(0,0), góc trên-trái=(-48,-48), góc dưới-phải=(48,48), ngoài -> kẹp',
      deepEq(clickToWorld(100, 100, 200, 96), { x: 0, z: 0 }) &&
      deepEq(clickToWorld(0, 0, 200, 96), { x: -48, z: -48 }) &&
      deepEq(clickToWorld(200, 200, 200, 96), { x: 48, z: 48 }) &&
      deepEq(clickToWorld(999, -50, 200, 96), { x: 48, z: -48 }),
      'center=' + JSON.stringify(clickToWorld(100, 100, 200, 96)));
    if (worldToPx) {
      const rt = clickToWorld(worldToPx(10, -20, 200, 96).x, worldToPx(10, -20, 200, 96).y, 200, 96);
      check('H4 minimap click/world round-trip (10,-20) sai số <0.5m',
        approx(rt.x, 10, 0.5) && approx(rt.z, -20, 0.5), 'rt=' + JSON.stringify(rt));
    } else skip('H4 minimap round-trip', 'minimapWorldToPx không tồn tại');
  } else skip('H3-H4 minimapClickToWorld', 'minimapClickToWorld không tồn tại');
  const dotColor = g('minimapDotColor');
  if (dotColor) {
    check('H5 minimapDotColor: nhà #facc15, NPC #3b82f6, quái #ef4444, nhân vật #22c55e, đèn #fb923c, cây #166534, không rõ -> null',
      dotColor({ type: 'house' }) === '#facc15' &&
      dotColor({ type: 'npc' }) === '#3b82f6' &&
      dotColor({ type: 'monster' }) === '#ef4444' &&
      dotColor({ type: 'character' }) === '#22c55e' &&
      dotColor({ type: 'lantern' }) === '#fb923c' &&
      dotColor({ type: 'tree' }) === '#166534' &&
      dotColor({ type: 'weird-xyz' }) === null &&
      dotColor(null) === null,
      'house=' + dotColor({ type: 'house' }) + ' npc=' + dotColor({ type: 'npc' }));
  } else skip('H5 minimapDotColor', 'minimapDotColor không tồn tại');
  const heading = g('minimapCameraHeading');
  if (heading) {
    const h0 = heading([0, 0, 0], [0, 0, -10]);
    const h90 = heading([0, 0, 0], [10, 0, 0]);
    check('H6 minimapCameraHeading: nhìn -z -> 0; nhìn +x -> +90°',
      approx(h0, 0, 1e-9) && approx(h90, Math.PI / 2, 1e-9), 'h0=' + h0 + ' h90=' + h90);
  } else skip('H6 minimapCameraHeading', 'minimapCameraHeading không tồn tại');
  const normSize = g('minimapNormalizeSize');
  if (normSize) {
    check('H7 minimapNormalizeSize chỉ 140/200/280, khác -> 200',
      normSize(140) === 140 && normSize(280) === 280 && normSize(999) === 200 && normSize(0) === 200,
      '999=' + normSize(999));
  } else skip('H7 minimapNormalizeSize', 'minimapNormalizeSize không tồn tại');
})();

/* ========== (I) Tích hợp build + game không đổi ========== */
(function sectionIntegration() {
  const build = exists('tools/build-editor.mjs') ? read('tools/build-editor.mjs') : '';
  check('I1 build-editor.mjs nối 19-minimap.js vào ORDERED', build.includes("'19-minimap.js'") || build.includes('"19-minimap.js"'), '');
  const placeholders = ['__COPYSHADER__', '__LUMINOSITYHIGHPASS__', '__EFFECTCOMPOSER__', '__RENDERPASS__', '__SHADERPASS__', '__UNREALBLOOMPASS__'];
  const missingPH = placeholders.filter(p => !build.includes(p));
  check('I2 build-editor.mjs có đủ 6 placeholder post-proc', missingPH.length === 0, 'thiếu: ' + missingPH.join(','));
  const template = exists('src/editor/editor.template.html') ? read('src/editor/editor.template.html') : '';
  const missingTpl = placeholders.filter(p => !template.includes(p));
  check('I3 editor.template.html có đủ 6 placeholder post-proc', missingTpl.length === 0, 'thiếu: ' + missingTpl.join(','));
  const boot = exists('src/editor/99-boot.js') ? read('src/editor/99-boot.js') : '';
  check('I4 99-boot.js gọi _callInit(\'Minimap\')', boot.includes("_callInit('Minimap')") || boot.includes('_callInit("Minimap")'), '');
  const css = exists('src/editor/editor.css') ? read('src/editor/editor.css') : '';
  const cssNeed = ['.ed-minimap-canvas', '#ed-env-flash', '.ed-region-badge', '#viewport-fx-panel'];
  const missingCss = cssNeed.filter(s => !css.includes(s));
  check('I5 editor.css có CSS minimap + flash + region badge + fx panel', missingCss.length === 0, 'thiếu: ' + missingCss.join(','));
  for (const lib of ['lib/CopyShader.js', 'lib/LuminosityHighPassShader.js', 'lib/EffectComposer.js', 'lib/RenderPass.js', 'lib/ShaderPass.js', 'lib/UnrealBloomPass.js']) {
    check('I6 lib vendor tồn tại: ' + lib, exists(lib));
  }
  const html = exists('mapeditor.html') ? read('mapeditor.html') : '';
  const markers = ['ED.Minimap', 'UnrealBloomPass', 'thunderFlashSchedule', 'skyColorsForHour', 'minimapColorFor', 'EffectComposer', 'buildSplineGroup', 'playThunder', 'edCameraPathPoint', 'boxSelectFilter'];
  const missingMarkers = markers.filter(m => !html.includes(m));
  check('I7 mapeditor.html chứa đủ marker đợt 6', html.length > 0 && missingMarkers.length === 0, 'thiếu: ' + missingMarkers.join(',') + ' (len=' + html.length + ')');
  const leftover = placeholders.filter(p => html.includes(p));
  check('I8 mapeditor.html không còn placeholder post-proc', leftover.length === 0, 'còn: ' + leftover.join(','));
  const design = exists('src/editor/DESIGN.md') ? read('src/editor/DESIGN.md') : '';
  check('I9 DESIGN.md có mục Đợt 6', design.includes('Đợt 6'), '');
  const game = exists('mongvolam.html') ? fs.readFileSync(path.join(root, 'mongvolam.html')) : null;
  const index = exists('index.html') ? fs.readFileSync(path.join(root, 'index.html')) : null;
  check('I10 mongvolam.html giữ hash 8792425d (game không đổi đợt 6)',
    game && gitBlobHash(game) === '8792425df06eca92538eba790eaf4dec798a0c8c',
    game ? 'hash=' + gitBlobHash(game) : 'file thiếu');
  check('I11 index.html byte-identical mongvolam.html',
    game && index && Buffer.compare(game, index) === 0, 'index len=' + (index ? index.length : 'thiếu'));
})();

console.log('\n=== test-mapeditor6: ' + pass + ' PASS, ' + skipped + ' SKIP, ' + fail + ' FAIL ===');
if (fail) { console.log('FAILED: ' + failedNames.join(' | ')); process.exit(1); }
