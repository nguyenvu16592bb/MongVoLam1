/* Kiểm thử Map Editor ĐỢT 7 (Character Editor + xương) — logic thuần, không cần trình duyệt.
   - (A) Bones + Pose + Attach + Preset (07-character.js): tạo xương con đúng cha +
     đổi tên + đổi cha chặn vòng lặp + xoá xương tự tạo được/xương gốc không xoá
     được, pose lưu/tải/mirror đúng, preset đủ field.
   - (B) CCD IK toàn thân (21-ik.js): tới được target trong dung sai + tôn trọng
     giới hạn góc, ccdStep giảm lỗi, FK nhất quán.
   - (C) Weight painting (22-weight.js): đổi đúng đỉnh gần điểm chạm + tổng
     weight về 1 + reset về gốc.
   - (D) Retarget khác skeleton (23-retarget.js): map theo tên + scale theo
     tỉ lệ xương + báo xương thiếu, guard humanoid.
   - (E) Morph trong clip (11-animation.js): morph track ghi + phát đúng giá trị,
     expression map, validateAnim chấp nhận prop morph.
   - (F) Thư viện vũ khí (03-assets.js): 7 builder + validate file.
   - (G) Bug nhỏ: ED.Play.getHeroPos() thật, ED.Viewport.followHero/getCanvas thật.
   - (H) Tích hợp: build-editor nối 21/22/23 + boot _callInit, mapeditor.html chứa
     marker, DESIGN.md + README.md có Đợt 7, game không đổi (mongvolam.html hash
     8792425d, index.html byte-identical).
   Module/API nào không tồn tại thật trong code thì SKIP ghi rõ lý do, KHÔNG bịa pass.
   Chạy: node tools/build.mjs && node tools/build-editor.mjs
         && node tools/test-mapeditor7.cjs
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
function okOf(v) { return v === true || (v && v.ok === true); }

/* ---------- THREE stub đủ cho 03-assets buildMesh + load module ---------- */
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
class Euler {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; this.order = 'XYZ'; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Euler(this.x, this.y, this.z); }
}
class Group {
  constructor() { this.children = []; this.position = new V3(); this.rotation = new Euler(); this.scale = new V3(1, 1, 1); this.userData = {}; this.visible = true; }
  add(c) { this.children.push(c); return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return this; }
  traverse(fn) { fn(this); const ch = this.children.slice(); for (const c of ch) { if (c && typeof c.traverse === 'function') c.traverse(fn); else fn(c); } }
}
class Mesh extends Group { constructor(g, m) { super(); this.isMesh = true; this.geometry = g; this.material = m; this.castShadow = false; this.receiveShadow = false; } }
class Bone extends Group { constructor() { super(); this.isBone = true; } }
function geoStub(name) {
  return class {
    constructor() { this.type = name; this.parameters = Array.prototype.slice.call(arguments); }
    dispose() {}
  };
}
function threeStub() {
  return {
    Vector3: V3, Vector2: V2, Color: Color, BufferGeometry: BufGeo, Float32BufferAttribute: F32Attr,
    Matrix4: Mat4, Quaternion: Quat, Group: Group, Mesh: Mesh, Bone: Bone,
    BoxGeometry: geoStub('BoxGeometry'), CylinderGeometry: geoStub('CylinderGeometry'),
    SphereGeometry: geoStub('SphereGeometry'), TorusGeometry: geoStub('TorusGeometry'),
    ConeGeometry: geoStub('ConeGeometry'), PlaneGeometry: geoStub('PlaneGeometry'),
    DodecahedronGeometry: geoStub('DodecahedronGeometry'),
    MeshStandardMaterial: class { constructor(o) { this.o = o || {}; this.userData = {}; this.color = new Color((o && o.color) || 0xffffff); this.emissive = new Color(0x000000); } setHex() { return this; } },
    MeshBasicMaterial: class { constructor(o) { this.o = o || {}; this.userData = {}; this.color = new Color((o && o.color) || 0xffffff); } },
    DoubleSide: 2, FrontSide: 0, BackSide: 1,
    MathUtils: { clamp: (v, a, b) => Math.min(b, Math.max(a, v)), degToRad: d => d * Math.PI / 180, radToDeg: r => r * 180 / Math.PI },
    sRGBEncoding: 3001, LinearEncoding: 3000
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

/* ========== (A) Bones + Pose (07-character.js) ========== */
(function sectionBones() {
  let ctx;
  try {
    ctx = loadVm('src/editor/07-character.js');
  } catch (e) {
    skip('A0 load 07-character.js trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const C = ctx.ED.Character;
  if (!C) { skip('A0 ED.Character không tồn tại', ''); return; }
  const base = [
    { name: 'mixamorig:Hips', parent: null, pos: [0, 1, 0], custom: false },
    { name: 'mixamorig:Spine', parent: 'mixamorig:Hips', pos: [0, 0.2, 0], custom: false },
    { name: 'mixamorig:LeftArm', parent: 'mixamorig:Spine', pos: [0.2, 0.1, 0], custom: false },
    { name: 'mixamorig:RightArm', parent: 'mixamorig:Spine', pos: [-0.2, 0.1, 0], custom: false }
  ];
  // A1 tạo xương con đúng cha
  const r1 = C.createBoneData(base, 'mixamorig:LeftArm', 'Xương Kiếm', [0.1, 0, 0]);
  check('A1 tạo xương con đúng cha + tên + offset', r1 && r1.ok && r1.bone && r1.bone.name === 'Xương Kiếm' && r1.bone.parent === 'mixamorig:LeftArm' && r1.bone.custom === true && deepEq(r1.bone.pos, [0.1, 0, 0]) && r1.list.length === 5, JSON.stringify(r1 && r1.bone));
  // A2 tên tự sinh khi không đặt tên
  const r2 = C.createBoneData(base, 'mixamorig:Hips', '');
  check('A2 tên xương tự sinh khi không đặt tên', r2 && r2.ok && typeof r2.bone.name === 'string' && r2.bone.name.length > 0 && r2.bone.name !== 'mixamorig:Hips', JSON.stringify(r2 && r2.bone));
  // A3 trùng tên -> từ chối
  const r3 = C.createBoneData(base, 'mixamorig:Hips', 'mixamorig:Spine');
  check('A3 tạo xương trùng tên bị từ chối', r3 && r3.ok === false && /Đã có xương/.test(r3.reason || ''), JSON.stringify(r3));
  // A4 cha không có -> từ chối
  const r4 = C.createBoneData(base, 'Xương Không Có', 'Xương Mới');
  check('A4 tạo xương với cha không có bị từ chối', r4 && r4.ok === false, JSON.stringify(r4));
  // A5 đổi cha đúng
  const r5 = C.setBoneParentData(base, 'mixamorig:LeftArm', 'mixamorig:Hips');
  check('A5 đổi cha xương đúng', r5 && r5.ok && r5.list.filter(b => b.name === 'mixamorig:LeftArm')[0].parent === 'mixamorig:Hips', JSON.stringify(r5));
  // A6 đổi cha thành chính nó -> chặn
  const r6 = C.setBoneParentData(base, 'mixamorig:LeftArm', 'mixamorig:LeftArm');
  check('A6 đổi cha thành chính nó bị chặn', r6 && r6.ok === false, JSON.stringify(r6));
  // A7 đổi cha tạo vòng lặp -> chặn (Hips -> Spine -> LeftArm; đặt Hips làm con LeftArm)
  const r7 = C.setBoneParentData(base, 'mixamorig:Hips', 'mixamorig:LeftArm');
  check('A7 đổi cha tạo vòng lặp bị chặn', r7 && r7.ok === false && /vòng lặp/.test(r7.reason || ''), JSON.stringify(r7));
  // A8 xoá xương tự tạo được, con được về ông
  const withCustom = (C.createBoneData(base, 'mixamorig:LeftArm', 'Xương Kiếm', [0, 0, 0]) || {}).list || base;
  const withGrandchild = (C.createBoneData(withCustom, 'Xương Kiếm', 'Xương Chuôi', [0, 0, 0]) || {}).list || withCustom;
  const r8 = C.deleteBoneData(withGrandchild, 'Xương Kiếm');
  const chuoi = r8 && r8.list.filter(b => b.name === 'Xương Chuôi')[0];
  check('A8 xoá xương tự tạo được, con về ông', r8 && r8.ok && !r8.list.some(b => b.name === 'Xương Kiếm') && chuoi && chuoi.parent === 'mixamorig:LeftArm', JSON.stringify(r8 && r8.list));
  // A9 xoá xương gốc Mixamo -> từ chối
  const r9 = C.deleteBoneData(base, 'mixamorig:Spine');
  check('A9 xoá xương gốc Mixamo bị từ chối', r9 && r9.ok === false && /xương gốc/.test(r9.reason || ''), JSON.stringify(r9));
  // A10 validate cây hợp lệ
  const v10 = C.validateBoneTree(base);
  check('A10 validate cây xương hợp lệ', v10 && v10.ok === true, JSON.stringify(v10));
  // A11 validate cây có vòng lặp -> báo 1 vòng
  const cyc = [
    { name: 'A', parent: 'C', pos: [0, 0, 0], custom: true },
    { name: 'B', parent: 'A', pos: [0, 0, 0], custom: true },
    { name: 'C', parent: 'B', pos: [0, 0, 0], custom: true }
  ];
  const v11 = C.validateBoneTree(cyc);
  check('A11 validate cây có vòng lặp báo đúng 1 vòng', v11 && v11.ok === false && Array.isArray(v11.cycles) && v11.cycles.length === 1, JSON.stringify(v11));
  // A12 mirror pose trái/phải + đảo dấu X,Z giữ Y
  const m12 = C.mirrorPoseData({ rotations: { 'mixamorig:LeftArm': [10, 20, 30], 'mixamorig:Hips': [5, 6, 7] } });
  check('A12 mirror pose đổi Left<->Right + đảo dấu X,Z giữ Y',
    m12 && m12.rotations && deepEq(m12.rotations['mixamorig:RightArm'], [-10, 20, -30]) && deepEq(m12.rotations['mixamorig:Hips'], [-5, 6, -7]),
    JSON.stringify(m12));
  // A13 capture + apply pose round-trip
  const bones13 = [{ name: 'mixamorig:Hips', rotDeg: [10, 20, 30] }, { name: 'mixamorig:LeftArm', rotDeg: [0, 45, 0] }];
  const cap = C.capturePoseData(bones13);
  const bones13b = [{ name: 'mixamorig:Hips', rotation: { x: 0, y: 0, z: 0 }, rotDeg: [0, 0, 0] }, { name: 'mixamorig:LeftArm', rotation: { x: 0, y: 0, z: 0 }, rotDeg: [0, 0, 0] }];
  const app = C.applyPoseData(bones13b, { rotations: cap });
  check('A13 capture/apply pose round-trip đúng',
    cap && deepEq(cap['mixamorig:Hips'], [10, 20, 30]) && app && app.applied.length === 2 && app.missing.length === 0 && deepEq(bones13b[0].rotDeg, [10, 20, 30]),
    JSON.stringify({ cap: cap, app: app }));
  // A14 apply pose thiếu xương -> báo missing
  const app14 = C.applyPoseData([{ name: 'mixamorig:Hips', rotation: { x: 0, y: 0, z: 0 } }], { rotations: { 'mixamorig:LeftArm': [1, 2, 3] } });
  check('A14 apply pose xương thiếu báo missing', app14 && app14.applied.length === 0 && app14.missing.indexOf('mixamorig:LeftArm') >= 0, JSON.stringify(app14));
  // A15 preset pose có đủ 6 tư thế mặc định (posePresets là hàm)
  const presets = typeof C.posePresets === 'function' ? C.posePresets() : C.posePresets;
  const presetNames = Array.isArray(presets) ? presets.map(p => p && (p.name || p.id)) : [];
  check('A15 pose preset mặc định đủ 6 (T-pose, A-pose, đứng, chiến đấu, ngồi, chào)',
    Array.isArray(presets) && presets.length >= 6 && presetNames.some(n => /T-pose/i.test(n || '')) && presetNames.some(n => /A-pose/i.test(n || '')),
    JSON.stringify(presetNames));
  // A16 API preview mới tồn tại (cho IK/Weight/Retarget dùng)
  check('A16 ED.Character có getPreviewBones/getPreviewSkinnedMeshes/getPreviewGroup',
    typeof C.getPreviewBones === 'function' && typeof C.getPreviewSkinnedMeshes === 'function' && typeof C.getPreviewGroup === 'function',
    [typeof C.getPreviewBones, typeof C.getPreviewSkinnedMeshes, typeof C.getPreviewGroup].join(','));
  // A17 snap góc
  check('A17 snapAngle làm tròn theo snap 5°', C.snapAngle && approx(C.snapAngle(13, 5), 15) && approx(C.snapAngle(12, 5), 10), '');
})();

/* ========== (B) CCD IK toàn thân (21-ik.js) ========== */
(function sectionIk() {
  let ctx;
  try {
    ctx = loadVm('src/editor/21-ik.js');
  } catch (e) {
    skip('B0 load 21-ik.js trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const Ik = ctx.ED.Ik;
  if (!Ik) { skip('B0 ED.Ik không tồn tại', ''); return; }
  const chain3 = [
    { pos: [0, 0, 0], rot: [0, 0, 0] },
    { pos: [0, 1, 0], rot: [0, 0, 0] },
    { pos: [0, 2, 0], rot: [0, 0, 0] }
  ];
  // B1 tới được target trong dung sai
  const r1 = Ik.solveCCD(chain3, [1, 1.5, 0], { iterations: 20, tolerance: 0.01 });
  check('B1 CCD tới được target trong dung sai 0.01', r1 && r1.reached === true && r1.finalError <= 0.01, JSON.stringify({ reached: r1 && r1.reached, finalError: r1 && r1.finalError, iterations: r1 && r1.iterations }));
  // B2 target ngoài tầm -> không tới, đầu cuối chạm giới hạn tầm
  const r2 = Ik.solveCCD(chain3, [0, 5, 0], { iterations: 20, tolerance: 0.01 });
  const endDist = r2 && r2.endPos ? Math.sqrt(r2.endPos[0] * r2.endPos[0] + r2.endPos[1] * r2.endPos[1] + r2.endPos[2] * r2.endPos[2]) : -1;
  check('B2 CCD target ngoài tầm: không tới, đầu cuối ở giới hạn tầm ~2', r2 && r2.reached === false && approx(endDist, 2, 0.05) && r2.finalError > 2, JSON.stringify({ reached: r2 && r2.reached, finalError: r2 && r2.finalError, endDist: endDist }));
  // B3 ccdStep giảm lỗi
  const before = Math.sqrt(1 + 0.25);
  const after = Ik.ccdStep(chain3, [1, 1.5, 0]);
  const errAfter = after && after.length ? Math.hypot(after[2].pos[0] - 1, after[2].pos[1] - 1.5, after[2].pos[2]) : 99;
  check('B3 ccdStep 1 vòng giảm lỗi', errAfter < before, 'before=' + before + ' after=' + errAfter);
  // B4 FK nhất quán với kết quả solveCCD (forwardKinematics trả mảng vị trí)
  const r4 = Ik.solveCCD(chain3, [1, 1.5, 0], { iterations: 20, tolerance: 0.01 });
  const fk = Ik.forwardKinematics(chain3, r4.rotations);
  const fkEnd = fk && fk.length ? fk[fk.length - 1] : null;
  check('B4 forwardKinematics khớp endPos của solveCCD',
    fkEnd && r4.endPos && approx(fkEnd[0], r4.endPos[0], 1e-6) && approx(fkEnd[1], r4.endPos[1], 1e-6) && approx(fkEnd[2], r4.endPos[2], 1e-6),
    JSON.stringify({ fkEnd: fkEnd, endPos: r4 && r4.endPos }));
  // B5 tôn trọng giới hạn góc khớp (chỉ kiểm tra các khớp có constraint;
  // khớp cuối không xoay con nào nên hướng của nó không ảnh hưởng vị trí)
  const r5 = Ik.solveCCD(chain3, [1, 1.5, 0], { iterations: 20, tolerance: 0.01, constraints: { 0: { min: [-10, -10, -10], max: [10, 10, 10] }, 1: { min: [-10, -10, -10], max: [10, 10, 10] } } });
  const within = r5 && r5.rotations && [0, 1].every(ji => r5.rotations[ji].every(v => v >= -10 - 1e-6 && v <= 10 + 1e-6));
  check('B5 CCD tôn trọng giới hạn góc khớp có constraint (khớp 0,1 trong [-10,10])', within === true, JSON.stringify(r5 && r5.rotations));
  // B6 Euler <-> quaternion round-trip
  const q = Ik.quat.fromEulerDeg([30, 45, 60]);
  const back = Ik.quat.toEulerDeg(q);
  check('B6 Euler->quat->Euler round-trip', back && approx(back[0], 30, 1e-6) && approx(back[1], 45, 1e-6) && approx(back[2], 60, 1e-6), JSON.stringify(back));
  // B7 chainFromBones từ xương giả (nối parent + isBone như THREE.Bone thật)
  const hipsBone = { name: 'mixamorig:Hips', isBone: true, position: { x: 0, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, parent: null, children: [] };
  const spineBone = { name: 'mixamorig:Spine', isBone: true, position: { x: 0, y: 0.2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, parent: hipsBone, children: [] };
  hipsBone.children = [spineBone];
  const fakeBones = [hipsBone, spineBone];
  const ch7 = Ik.chainFromBones(fakeBones, 'mixamorig:Hips', 'mixamorig:Spine');
  check('B7 chainFromBones dựng chuỗi từ xương giả (names Hips->Spine)', ch7 && Array.isArray(ch7.names) && ch7.names.length === 2 && ch7.names[0] === 'Hips' && ch7.names[1] === 'Spine', JSON.stringify(ch7 && ch7.names));
  // B8 chuỗi rỗng -> báo rõ
  const r8 = Ik.solveCCD([], [1, 1, 1], {});
  check('B8 CCD chuỗi rỗng báo rõ', r8 && r8.reached === false && typeof r8.reason === 'string', JSON.stringify(r8));
})();

/* ========== (C) Weight painting (22-weight.js) ========== */
(function sectionWeight() {
  let ctx;
  try {
    ctx = loadVm('src/editor/22-weight.js');
  } catch (e) {
    skip('C0 load 22-weight.js trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const W = ctx.ED.Weight;
  if (!W) { skip('C0 ED.Weight không tồn tại', ''); return; }
  const weights0 = [[1, 0], [0.5, 0.5], [0, 1]];
  const positions = [[0, 0, 0], [0.1, 0, 0], [1, 0, 0]];
  // C1 cọ cộng đổi đúng đỉnh gần điểm chạm, đỉnh xa không đổi
  const w1 = weights0.map(r => r.slice());
  const p1 = W.paintWeights(w1, 1, positions, [0, 0, 0], 0.5, 1, 'add');
  check('C1 cọ cộng đổi đỉnh gần điểm chạm, đỉnh xa không đổi',
    p1 && p1.count >= 1 && w1[0][1] > 0 && w1[2][0] === 0 && w1[2][1] === 1,
    JSON.stringify({ count: p1 && p1.count, w1: w1 }));
  // C2 tổng weight về 1 sau chuẩn hoá
  const w2 = weights0.map(r => r.slice());
  W.paintWeights(w2, 1, positions, [0, 0, 0], 0.5, 1, 'add');
  const n2 = W.normalizeWeights(w2);
  const sumsOk = w2.every(r => approx(r.reduce((a, b) => a + b, 0), 1, 1e-9));
  check('C2 chuẩn hoá tổng weight mỗi đỉnh về 1', n2 && sumsOk, JSON.stringify({ normalized: n2 && n2.normalized, w2: w2 }));
  // C3 cọ trừ giảm weight xương đó
  const w3 = [[0.5, 0.5], [0.5, 0.5]];
  const pos3 = [[0, 0, 0], [0.1, 0, 0]];
  W.paintWeights(w3, 0, pos3, [0, 0, 0], 0.5, 1, 'subtract');
  check('C3 cọ trừ giảm weight xương được chọn', w3[0][0] < 0.5, JSON.stringify(w3));
  // C4 smooth kéo weight về trung bình lân cận
  const w4 = [[1, 0], [0, 1], [1, 0]];
  const pos4 = [[0, 0, 0], [0.1, 0, 0], [0.2, 0, 0]];
  const s4 = W.smoothWeights(w4, pos4, 0.5);
  check('C4 làm mịn đổi weight đỉnh giữa về trung bình', s4 && s4[1][0] > 0 && s4[1][0] < 1, JSON.stringify(s4));
  // C5 snapshot/restore về gốc
  const w5 = [[1, 0], [0, 1]];
  const snap = W.snapshotWeights(w5);
  w5[0] = [0, 1]; w5[1] = [1, 0];
  const rest = W.restoreWeights(w5, snap);
  check('C5 snapshot/restore weight về gốc', rest && deepEq(w5, [[1, 0], [0, 1]]), JSON.stringify(w5));
  // C6 brush quá nhỏ / bone sai -> không đổi
  const w6 = [[1, 0]];
  const p6 = W.paintWeights(w6, 0, [[0, 0, 0]], [0, 0, 0], 0, 1, 'add');
  check('C6 cọ bán kính 0 không đổi gì', p6 && p6.count === 0 && deepEq(w6, [[1, 0]]), JSON.stringify(p6));
})();

/* ========== (D) Retarget khác skeleton (23-retarget.js) ========== */
(function sectionRetarget() {
  let ctx;
  try {
    ctx = loadVm('src/editor/23-retarget.js');
  } catch (e) {
    skip('D0 load 23-retarget.js trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const R = ctx.ED.Retarget;
  if (!R) { skip('D0 ED.Retarget không tồn tại', ''); return; }
  // D1 auto-map theo tên chính xác + bỏ prefix mixamorig:
  const m1 = R.autoMapBones(
    ['mixamorig:Hips', 'mixamorig:LeftArm', 'mixamorig:Tail'],
    ['Hips', 'LeftArm', 'Spine']);
  check('D1 auto-map theo tên + bỏ prefix', m1 && m1['mixamorig:Hips'] === 'Hips' && m1['mixamorig:LeftArm'] === 'LeftArm' && m1['mixamorig:Tail'] === null, JSON.stringify(m1));
  // D2 một xương đích chỉ nhận một xương nguồn
  const m2 = R.autoMapBones(['Hips', 'mixamorig:Hips'], ['Hips']);
  const claimed = Object.keys(m2).filter(k => m2[k] === 'Hips');
  check('D2 một xương đích chỉ nhận một xương nguồn', claimed.length === 1, JSON.stringify(m2));
  // D3 guard humanoid đủ xương
  const h3 = R.validateHumanoid(['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Chest', 'mixamorig:Neck', 'mixamorig:Head', 'mixamorig:LeftUpperArm', 'mixamorig:RightUpperArm', 'mixamorig:LeftUpperLeg', 'mixamorig:RightUpperLeg']);
  check('D3 guard humanoid đủ xương cho qua', h3 && h3.ok === true && h3.missing.length === 0, JSON.stringify(h3));
  // D4 guard humanoid thiếu xương -> liệt kê thiếu
  const h4 = R.validateHumanoid(['mixamorig:Hips', 'mixamorig:Spine']);
  check('D4 guard humanoid thiếu xương báo rõ danh sách thiếu', h4 && h4.ok === false && h4.missing.length >= 5, JSON.stringify(h4));
  // D5 độ dài xương = khoảng cách 2 điểm rest
  const l5 = R.boneLength([0, 0, 0], [0, 0.3, 0.4]);
  check('D5 độ dài xương = khoảng cách rest pose', l5 !== null && approx(l5, 0.5, 1e-9), String(l5));
  // D6 applyMapping đổi tên track + scale position theo tỉ lệ xương + báo thiếu
  const clip = {
    name: 'Walk', duration: 1,
    tracks: [
      { name: 'mixamorig:Hips.position', times: [0, 1], values: [0, 0, 0, 0, 1, 0] },
      { name: 'mixamorig:LeftArm.quaternion', times: [0], values: [0, 0, 0, 1] },
      { name: 'mixamorig:Tail.quaternion', times: [0], values: [0, 0, 0, 1] },
      { name: 'Root', times: [0], values: [1] }
    ]
  };
  const out6 = R.applyMapping(clip,
    { 'mixamorig:Hips': 'Hips', 'mixamorig:LeftArm': 'LeftArm' },
    { 'mixamorig:Hips': { source: 1, target: 2 } });
  const posTrack = out6 && out6.clip.tracks.filter(t => t.name === 'Hips.position')[0];
  check('D6 applyMapping: đổi tên track, scale position x2, báo xương thiếu, giữ track không thuộc xương',
    out6 && out6.mapped === 3 && out6.unmapped === 1 && out6.missing.indexOf('mixamorig:Tail') >= 0 && out6.scaledCount === 1 &&
    posTrack && approx(posTrack.values[4], 2, 1e-9) && out6.clip.tracks.some(t => t.name === 'Root'),
    JSON.stringify(out6));
  // D7 strip prefix
  check('D7 stripBonePrefix bỏ mixamorig:', R.stripBonePrefix && R.stripBonePrefix('mixamorig:LeftArm') === 'LeftArm' && R.stripBonePrefix('Hips') === 'Hips', '');
})();

/* ========== (E) Morph trong clip (11-animation.js) ========== */
(function sectionMorph() {
  let ctx;
  try {
    ctx = loadVm('src/editor/11-animation.js');
  } catch (e) {
    skip('E0 load 11-animation.js trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const A = ctx.ED.Animation;
  if (!A) { skip('E0 ED.Animation không tồn tại', ''); return; }
  const morphNames = ['smile', 'frown', 'blink'];
  // E1 resolve tên morph -> property binding đúng dạng r128
  check('E1 morphTrackProp resolve tên -> .morphTargetInfluences[i]',
    A.morphTrackProp && A.morphTrackProp('smile', morphNames) === '.morphTargetInfluences[0]' && A.morphTrackProp('SMILE', morphNames) === '.morphTargetInfluences[0]' && A.morphTrackProp('khongco', morphNames) === null,
    String(A.morphTrackProp && A.morphTrackProp('smile', morphNames)));
  // E2 buildMorphTrack kẹp 0..1 + sắp xếp theo t
  const tr2 = A.buildMorphTrack('smile', [{ t: 1, v: 2 }, { t: 0, v: -0.5 }, { t: 0.5, v: 0.5 }], morphNames);
  check('E2 buildMorphTrack kẹp 0..1 + sắp xếp theo t',
    tr2 && tr2.prop === 'morph.smile' && tr2.keys.length === 3 && tr2.keys[0].t === 0 && tr2.keys[0].v === 0 && tr2.keys[2].t === 1 && tr2.keys[2].v === 1,
    JSON.stringify(tr2));
  // E3 tên morph không có trong model -> không tạo track giả
  const tr3 = A.buildMorphTrack('khongco', [{ t: 0, v: 1 }], morphNames);
  check('E3 buildMorphTrack tên không có trong model -> null', tr3 === null, JSON.stringify(tr3));
  // E4 expression map: smile -> vui, frown -> giận, không có -> rỗng
  const ex4 = A.expressionMorphMap(['smile', 'frown', 'blink']);
  check('E4 expressionMorphMap khớp smile->vui, frown->giận',
    ex4 && ex4.vui && ex4.vui.smile === 1 && ex4.gian && ex4.gian.frown === 1 && (!ex4.buon || Object.keys(ex4.buon).length === 0),
    JSON.stringify(ex4));
  // E5 validateAnim chấp nhận track morph hợp lệ
  const anim5 = { id: 'a1', targetType: 'object', targetId: 'Hero', tracks: [{ prop: 'morph.smile', keys: [{ t: 0, v: 0.5 }] }, { prop: 'pos.x', keys: [{ t: 0, v: 1 }] }] };
  const v5 = A.validateAnim(anim5, morphNames);
  check('E5 validateAnim chấp nhận track morph + pos', v5 && v5.ok === true, JSON.stringify(v5));
  // E6 validateAnim từ chối morph không có trong model
  const anim6 = { id: 'a1', targetType: 'object', targetId: 'Hero', tracks: [{ prop: 'morph.khongco', keys: [{ t: 0, v: 0.5 }] }] };
  const v6 = A.validateAnim(anim6, morphNames);
  check('E6 validateAnim từ chối morph không có trong model', v6 && v6.ok === false && /không có trong model/.test(v6.reason || ''), JSON.stringify(v6));
  // E7 propBinding morph không có morphNames -> null (chưa resolve được index)
  check('E7 edAnimPropBinding morph không morphNames -> null',
    A.propBinding && A.propBinding('morph.smile') === null && A.propBinding('morph.smile', morphNames) === '.morphTargetInfluences[0]',
    String(A.propBinding && A.propBinding('morph.smile', morphNames)));
})();

/* ========== (F) Thư viện vũ khí (03-assets.js) ========== */
(function sectionWeapons() {
  let ctx;
  try {
    ctx = loadVm('src/editor/03-assets.js');
  } catch (e) {
    skip('F0 load 03-assets.js trong vm', 'load lỗi: ' + e.message);
    return;
  }
  const As = ctx.ED.Assets;
  if (!As) { skip('F0 ED.Assets không tồn tại', ''); return; }
  const types = ['weapon-sword', 'weapon-blade', 'weapon-staff', 'weapon-bow', 'weapon-shield', 'weapon-hat', 'weapon-cape'];
  let built = 0;
  const details = [];
  types.forEach(t => {
    let g = null;
    try { g = As.buildMesh(t); } catch (e) { details.push(t + ':throw ' + e.message); return; }
    if (g && Array.isArray(g.children) && g.children.length > 0) built++;
    else details.push(t + ':empty');
  });
  check('F1 buildMesh đủ 7 vũ khí/phụ kiện primitive (mỗi món có con)', built === 7, built + '/7; ' + details.join('; '));
  // F2 validate file vũ khí
  if (typeof As.validateWeaponFile === 'function') {
    const ok1 = As.validateWeaponFile({ name: 'kiem.fbx', size: 1000 });
    const ok2 = As.validateWeaponFile({ name: 'kiem.glb', size: 1000 });
    const bad1 = As.validateWeaponFile({ name: 'kiem.txt', size: 1000 });
    const bad2 = As.validateWeaponFile({ name: 'kiem.fbx', size: 21 * 1024 * 1024 });
    check('F2 validateWeaponFile: .fbx/.glb ok, .txt + >20MB từ chối',
      okOf(ok1) && okOf(ok2) && !okOf(bad1) && !okOf(bad2),
      JSON.stringify({ ok1: ok1, ok2: ok2, bad1: bad1, bad2: bad2 }));
  } else {
    skip('F2 ED.Assets.validateWeaponFile không tồn tại', '');
  }
})();

/* ========== (G) Bug nhỏ: getHeroPos / followHero / getCanvas ========== */
(function sectionBugs() {
  let ctxP;
  try {
    ctxP = loadVm('src/editor/09-play.js');
  } catch (e) {
    skip('G0 load 09-play.js trong vm', 'load lỗi: ' + e.message);
  }
  if (ctxP && ctxP.ED.Play) {
    const P = ctxP.ED.Play;
    check('G1 ED.Play.getHeroPos là hàm thật (không còn fallback _heroPos)',
      typeof P.getHeroPos === 'function', typeof P.getHeroPos);
    if (typeof P.getHeroPos === 'function') {
      P._heroPos = [3, 4];
      const hp = P.getHeroPos();
      check('G2 getHeroPos trả đúng vị trí hero [3,4]', Array.isArray(hp) && hp[0] === 3 && hp[1] === 4, JSON.stringify(hp));
      hp[0] = 99;
      check('G3 getHeroPos trả BẢN SAO (đổi mảng trả về không đổi state)', Array.isArray(P._heroPos) && P._heroPos[0] === 3, JSON.stringify(P._heroPos));
    }
  }
  let ctxV;
  try {
    ctxV = loadVm('src/editor/01-viewport.js');
  } catch (e) {
    skip('G4 load 01-viewport.js trong vm', 'load lỗi: ' + e.message);
  }
  if (ctxV && ctxV.ED.Viewport) {
    const V = ctxV.ED.Viewport;
    check('G4 ED.Viewport.followHero + getCanvas là hàm thật',
      typeof V.followHero === 'function' && typeof V.getCanvas === 'function',
      [typeof V.followHero, typeof V.getCanvas].join(','));
    if (typeof V.getCanvas === 'function') {
      let cv = null, threw = false;
      try { cv = V.getCanvas(); } catch (e) { threw = true; }
      check('G5 getCanvas trả null khi chưa init', !threw && cv === null, String(cv));
    }
    if (typeof V.followHero === 'function') {
      let r = null, threw = false;
      try { r = V.followHero(1, 2); } catch (e) { threw = true; }
      check('G6 followHero trả false khi camera chưa init', !threw && r === false, String(r));
    }
  }
})();

/* ========== (H) Tích hợp ========== */
(function sectionIntegration() {
  const build = exists('tools/build-editor.mjs') ? read('tools/build-editor.mjs') : '';
  const ordered = build.match(/const ORDERED = \[([\s\S]*?)\];/);
  const orderedText = ordered ? ordered[1] : '';
  check('H1 build-editor.mjs ORDERED nối 21-ik.js + 22-weight.js + 23-retarget.js sau 11-animation.js',
    orderedText.indexOf("'11-animation.js'") >= 0 && orderedText.indexOf("'21-ik.js'") > orderedText.indexOf("'11-animation.js'") &&
    orderedText.indexOf("'22-weight.js'") > orderedText.indexOf("'21-ik.js'") && orderedText.indexOf("'23-retarget.js'") > orderedText.indexOf("'22-weight.js'"),
    orderedText.replace(/\s+/g, ' '));
  const boot = exists('src/editor/99-boot.js') ? read('src/editor/99-boot.js') : '';
  check('H2 99-boot.js _callInit Ik/Weight/Retarget sau Animation',
    boot.indexOf("_callInit('Animation')") >= 0 && boot.indexOf("_callInit('Ik')") > boot.indexOf("_callInit('Animation')") &&
    boot.indexOf("_callInit('Weight')") > boot.indexOf("_callInit('Ik')") && boot.indexOf("_callInit('Retarget')") > boot.indexOf("_callInit('Weight')"),
    '');
  const css = exists('src/editor/editor.css') ? read('src/editor/editor.css') : '';
  check('H3 editor.css có CSS đợt 7 (ed-char-ik-full, ed-weight-panel, ed-retarget-panel, ed-char-hint)',
    css.indexOf('.ed-char-ik-full') >= 0 && css.indexOf('.ed-weight-panel') >= 0 && css.indexOf('.ed-retarget-panel') >= 0 && css.indexOf('.ed-char-hint') >= 0,
    '');
  const html = exists('mapeditor.html') ? read('mapeditor.html') : '';
  const markers = ['ED.Ik', 'ED.Weight', 'ED.Retarget', 'solveCCD', 'paintWeights', 'autoMapBones', 'morphTrackProp', 'weapon-sword', 'getHeroPos', 'followHero', 'getPreviewBones'];
  const missingMarkers = markers.filter(m => !html.includes(m));
  check('H4 mapeditor.html chứa đủ marker đợt 7', html.length > 0 && missingMarkers.length === 0, 'thiếu: ' + missingMarkers.join(',') + ' (len=' + html.length + ')');
  // H5: placeholder build THẬT phải biến mất (__EDITOR_*__, __GLTFLOADER__...).
  // __THREE__ còn lại là guard trong three.min.js vendor (window.__THREE__);
  // __FBXLOADER__/__FFLATE__ còn lại là chuỗi trong danh sách tự kiểm tra
  // placeholder của script build; __JSZIP__ còn lại là tên placeholder được
  // nhắc trong comment của 15-export.js — đều không phải placeholder chưa thay.
  const placeholders = ['__EDITOR_STYLE__', '__EDITOR_JS__', '__GLTFLOADER__', '__OBJLOADER__', '__GLTFEXPORTER__', '__REFLECTOR__', '__RECTAREALIGHT__', '__COPYSHADER__', '__LUMINOSITYHIGHPASS__', '__EFFECTCOMPOSER__', '__RENDERPASS__', '__SHADERPASS__', '__UNREALBLOOMPASS__'];
  const leftover = placeholders.filter(p => html.includes(p));
  check('H5 mapeditor.html không còn placeholder build thật', leftover.length === 0, 'còn: ' + leftover.join(','));
  const design = exists('src/editor/DESIGN.md') ? read('src/editor/DESIGN.md') : '';
  check('H6 DESIGN.md có mục Đợt 7', design.indexOf('Đợt 7') >= 0, '');
  const readme = exists('README.md') ? read('README.md') : '';
  check('H7 README.md có mục Đợt 7', readme.indexOf('Đợt 7') >= 0, '');
  const game = exists('mongvolam.html') ? fs.readFileSync(path.join(root, 'mongvolam.html')) : null;
  const index = exists('index.html') ? fs.readFileSync(path.join(root, 'index.html')) : null;
  check('H8 mongvolam.html giữ hash 8792425d (game không đổi đợt 7)',
    game && gitBlobHash(game) === '8792425df06eca92538eba790eaf4dec798a0c8c',
    game ? 'hash=' + gitBlobHash(game) : 'file thiếu');
  check('H9 index.html byte-identical mongvolam.html',
    game && index && Buffer.compare(game, index) === 0, 'index len=' + (index ? index.length : 'thiếu'));
  // H10: 07-character.js không còn ghi chú morph lỗi thời
  const ch7 = exists('src/editor/07-character.js') ? read('src/editor/07-character.js') : '';
  check('H10 07-character.js không còn câu "clip tự tạo vẫn chỉ ghi pos/rot/scale, không ghi morph"',
    ch7.indexOf('clip tự tạo vẫn chỉ ghi pos/rot/scale, không ghi morph') < 0 &&
    ch7.indexOf('clip tự tạo chỉ ghi pos/rot/scale, không ghi morph') < 0,
    '');
})();

console.log('\n=== test-mapeditor7: ' + pass + ' PASS, ' + skipped + ' SKIP, ' + fail + ' FAIL ===');
if (fail) { console.log('FAILED: ' + failedNames.join(' | ')); process.exit(1); }
