/* Kiểm thử Map Editor ĐỢT 4 (mapeditor.html) — logic thuần, không cần trình duyệt.
   - (A) Terrain (04-terrain.js): texture plan theo lưới paint, parse .raw/.r16,
     chunk 4x4, xói mòn thủy lực giọt nước.
   - (B) Material (13-material.js): AO map + emissive map, validate, normalize,
     preview 3D fallback null khi không có WebGL.
   - (C) Building (14-building.js): tham số mái/tường/cửa, kẹp miền, prefab.
   - (D) Skeleton (07-character.js): số liệu bone weight, retarget clip Mixamo.
   - (E) AI (08-npc-ai.js): trí nhớ — alert/search, về home, nhãn TV.
   - (F) Export ZIP + Audio 3D (15-export.js): buildZipFileList, collectZipEntries
     + ZIP thật đọc lại bằng JSZip, pannerGainFor/panFor, combatNext, fadePlan.
   - (G) Tích hợp: getTerrainMesh thật (01-viewport.js), wiring setCombatMode
     trong 09-play.js, build chứa JSZip + code đợt 4, game mongvolam.html không đổi.
   Module/API nào không tồn tại thật trong code thì SKIP ghi rõ lý do, KHÔNG bịa pass.
   Chạy: node tools/build-editor.mjs && node tools/test-mapeditor4.cjs
   In "N PASS, M SKIP, 0 FAIL" hoặc liệt kê fail; exit 1 nếu có fail. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const JSZip = require('../lib/jszip.min.js');

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

/* THREE stub: dummy constructor cho mọi thuộc tính (chỉ để load module, không render). */
function threeStub() {
  function Dummy() { return {}; }
  Dummy.prototype = {};
  return new Proxy({}, {
    get: function (t, k) {
      if (k === 'Color') return function () { this.setHex = function () {}; this.set = function () {}; this.r = 0; this.g = 0; this.b = 0; };
      return Dummy;
    }
  });
}
function loadVm(file, extra) {
  const ctx = Object.assign({ console }, extra || {});
  ctx.window = ctx.window || {};
  ctx.ED = ctx.ED || {};
  ctx.THREE = ctx.THREE || threeStub();
  vm.createContext(ctx);
  vm.runInContext(read(file), ctx, { filename: file });
  return ctx;
}
function loadVmWithJsZip(file, extra) {
  const ctx = loadVm(file, extra);
  vm.runInContext(read('lib/jszip.min.js'), ctx, { filename: 'lib/jszip.min.js' });
  /* JSZip UMD gắn vào window khi window tồn tại trong context — chuẩn hoá về ctx.JSZip. */
  if (!ctx.JSZip && ctx.window && ctx.window.JSZip) ctx.JSZip = ctx.window.JSZip;
  return ctx;
}

/* ================= A. Terrain (04-terrain.js) ================= */
console.log('--- A. Terrain (04-terrain.js) ---');
let T = null;
try {
  const ctx = loadVm('src/editor/04-terrain.js', {});
  T = ctx.ED.Terrain;
  check('04-terrain.js load duoc bang vm (khong can DOM/THREE)', !!T);
} catch (e) {
  check('04-terrain.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (T) {
  /* A1. paintGridToTexturePlan */
  if (typeof T.paintGridToTexturePlan !== 'function') {
    skip('paintGridToTexturePlan', 'ED.Terrain.paintGridToTexturePlan khong ton tai');
  } else {
    const paints4 = new Array(25).fill(0);
    paints4[20] = 1; /* ô (0,0) lấy đỉnh (0, 4) -> paints[20] */
    paints4[21] = 4; /* ô (1,0): nước */
    const plan = T.paintGridToTexturePlan(paints4, 4);
    check('texture plan: 16 o, o (0,0) mat dat (1), o (1,0) mat nuoc (4)',
      plan && !plan.error && plan.cellsList.length === 16 &&
      plan.cellsList[0].x === 0 && plan.cellsList[0].z === 0 && plan.cellsList[0].mat === 1 &&
      plan.cellsList[1].mat === 4 && plan.counts[1] === 1 && plan.counts[4] === 1,
      JSON.stringify(plan && plan.cellsList.slice(0, 2)));
    const heights4 = new Array(25).fill(0);
    heights4[20] = 8; /* cao >= 6, khong phai nuoc -> tuyet */
    heights4[21] = 9; /* nuoc cao van giu pattern nuoc */
    const planSnow = T.paintGridToTexturePlan(paints4, 4, heights4);
    check('texture plan: o cao >= 6 thanh tuyet (pattern 5), o nuoc cao van la nuoc',
      planSnow && planSnow.cellsList[0].pattern === 5 && planSnow.cellsList[1].pattern === 4 &&
      planSnow.counts[5] === 1, JSON.stringify(planSnow && planSnow.cellsList.slice(0, 2)));
    const planErr = T.paintGridToTexturePlan(new Array(10).fill(0), 4);
    check('texture plan: paints sai do dai thi error ro rang', planErr && !!planErr.error);
  }
  /* A2. .raw/.r16 */
  if (typeof T.detectRawGridSize !== 'function' || typeof T.parseRawHeightmap !== 'function') {
    skip('.raw/.r16 (detectRawGridSize/parseRawHeightmap)', 'thieu API');
  } else {
    check('detectRawGridSize: 8192 byte -> 64, 18432 -> 96, 32768 -> 128, le -> null',
      T.detectRawGridSize(8192) === 64 && T.detectRawGridSize(18432) === 96 &&
      T.detectRawGridSize(32768) === 128 && T.detectRawGridSize(100) === null &&
      T.detectRawGridSize(2 * 4 * 4) === 4);
    const raw = new Uint8Array(32);
    for (let k = 0; k < 16; k++) {
      const v = k * 4000;
      raw[k * 2] = v & 0xff; raw[k * 2 + 1] = (v >> 8) & 0xff;
    }
    const parsed = T.parseRawHeightmap(raw, 4, 10);
    check('parseRawHeightmap 4x4: ok, gridSize 4, min 0, max 60000, goc (0,0)=0, goc (3,3)~9.16',
      parsed && parsed.ok === true && parsed.gridSize === 4 && parsed.min === 0 && parsed.max === 60000 &&
      parsed.heights && parsed.heights.length === 65 * 65 && approx(parsed.heights[0], 0, 1e-6) &&
      approx(parsed.heights[64 * 65 + 64], 60000 / 65535 * 10, 0.01),
      JSON.stringify(parsed && { ok: parsed.ok, min: parsed.min, max: parsed.max, h00: parsed.heights && parsed.heights[0], hEnd: parsed.heights && parsed.heights[64 * 65 + 64] }));
    const parsedAuto = T.parseRawHeightmap(raw, null, 8);
    check('parseRawHeightmap: tu suy luoi 4 khi gridSize null', parsedAuto && parsedAuto.ok && parsedAuto.gridSize === 4);
    const parsedBad = T.parseRawHeightmap(new Uint8Array(10), null, 8);
    check('parseRawHeightmap: file sai kich thuoc thi ok=false + error ro', parsedBad && parsedBad.ok === false && !!parsedBad.error);
    const parsedEmpty = T.parseRawHeightmap(new Uint8Array(0), null, 8);
    check('parseRawHeightmap: file rong thi ok=false', parsedEmpty && parsedEmpty.ok === false);
  }
  /* A3. chunk */
  if (typeof T.chunkLayout !== 'function' || typeof T.chunkCells !== 'function' || typeof T.getChunkInfo !== 'function') {
    skip('chunk 4x4 (chunkLayout/chunkCells/getChunkInfo)', 'thieu API');
  } else {
    const layout = T.chunkLayout();
    check('chunkLayout: 4x4 = 16 chunk, moi chunk 17x17 dinh, segments 16',
      layout && layout.count === 4 && layout.total === 16 && layout.segments === 16 &&
      layout.vertsPerSide === 17 && layout.chunks.length === 16 &&
      layout.chunks[0].x0 === 0 && layout.chunks[0].z0 === 0 &&
      layout.chunks[15].x0 === 48 && layout.chunks[15].z0 === 48,
      JSON.stringify(layout && { total: layout.total, chunks: layout.chunks.length }));
    const H = new Array(65 * 65), P = new Array(65 * 65);
    for (let i = 0; i < H.length; i++) { H[i] = i; P[i] = i % 5; }
    const cell00 = T.chunkCells(H, P, 0, 0);
    /* chunk (0,0): dinh cuc bo (ix,iz) lay heights[idx(gx, 64-gz)] voi gx=ix, gz=iz. */
    check('chunkCells (0,0): 289 dinh, dung vung heights/paints (lat z)',
      cell00 && cell00.heights.length === 289 && cell00.paints.length === 289 &&
      cell00.heights[0] === H[64 * 65 + 0] && cell00.heights[16] === H[64 * 65 + 16] &&
      cell00.heights[17] === H[63 * 65 + 0] && cell00.paints[0] === P[64 * 65 + 0],
      JSON.stringify(cell00 && { h0: cell00.heights[0], h16: cell00.heights[16], h17: cell00.heights[17] }));
    const info = T.getChunkInfo();
    check('getChunkInfo khi chua build mesh: 16 chunk, 4624 dinh',
      info && info.chunks === 16 && info.totalVerts === 4624, JSON.stringify(info));
  }
  /* A4. erosion */
  if (typeof T.erodeStep !== 'function') {
    skip('erodeStep', 'ED.Terrain.erodeStep khong ton tai');
  } else {
    const seg = 16, side = seg + 1;
    const cone = new Array(side * side);
    for (let iz = 0; iz < side; iz++) for (let ix = 0; ix < side; ix++) {
      const d = Math.sqrt((ix - 8) * (ix - 8) + (iz - 8) * (iz - 8));
      cone[iz * side + ix] = Math.max(0, 10 - d * 1.2);
    }
    const before = cone.slice();
    const after = T.erodeStep(cone, seg, { droplets: 2000, strength: 1, seed: 1337 });
    const after2 = T.erodeStep(cone, seg, { droplets: 2000, strength: 1, seed: 1337 });
    let changed = 0, up = 0;
    for (let i = 0; i < after.length; i++) {
      if (Math.abs(after[i] - before[i]) > 1e-9) changed++;
      if (after[i] > before[i] + 1e-9) up++;
    }
    check('erodeStep: dinh non giam, co o tang len (lang dong), khong sua mang goc, deterministic cung seed',
      after.length === before.length && after[8 * side + 8] < before[8 * side + 8] &&
      changed > 0 && up > 0 && JSON.stringify(after) === JSON.stringify(after2) &&
      before[8 * side + 8] === 10, 'peak ' + before[8 * side + 8] + ' -> ' + after[8 * side + 8] + ', changed=' + changed + ', up=' + up);
    const flat = T.erodeStep(new Array(side * side).fill(0), seg, { droplets: 1000, seed: 1 });
    check('erodeStep: dat phang giu nguyen gan nhu 0', flat.every(function (v) { return Math.abs(v) < 1e-9; }));
    const zero = T.erodeStep(cone, seg, { droplets: 0 });
    check('erodeStep: droplets 0 thi tra ve ban sao y nguyen', JSON.stringify(zero) === JSON.stringify(cone));
  }
}

/* ================= B. Material (13-material.js) ================= */
console.log('--- B. Material (13-material.js) ---');
let M = null;
try {
  const ctx = loadVm('src/editor/13-material.js', {});
  M = ctx.ED.Material;
  check('13-material.js load duoc bang vm (khong can DOM/THREE)', !!M);
} catch (e) {
  check('13-material.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (M) {
  check('SLOTS co 5 khe: map/normalMap/roughnessMap/aoMap/emissiveMap',
    Array.isArray(M.SLOTS) && M.SLOTS.length === 5 && M.SLOTS.indexOf('aoMap') >= 0 && M.SLOTS.indexOf('emissiveMap') >= 0,
    JSON.stringify(M.SLOTS));
  if (typeof M.validateTextureFile !== 'function' || typeof M.normalizeMaterial !== 'function') {
    skip('validateTextureFile/normalizeMaterial', 'thieu API');
  } else {
    check('validateTextureFile: anh png 1MB ok; 6MB qua co; .txt sai loai; rong loi',
      M.validateTextureFile({ name: 'a.png', type: 'image/png', size: 1048576 }).ok === true &&
      M.validateTextureFile({ name: 'a.png', type: 'image/png', size: 6 * 1048576 }).ok === false &&
      M.validateTextureFile({ name: 'a.txt', type: 'text/plain', size: 100 }).ok === false &&
      M.validateTextureFile({ name: 'a.png', type: 'image/png', size: 0 }).ok === false &&
      M.validateTextureFile(null).ok === false);
    const nm = M.normalizeMaterial({ color: '#ff0000', aoMap: 'tex:ao1', emissiveMap: 'tex:em1', roughness: 0.5 });
    check('normalizeMaterial: giu aoMap/emissiveMap khi la key hop le',
      nm && nm.aoMap === 'tex:ao1' && nm.emissiveMap === 'tex:em1' && nm.roughness === 0.5, JSON.stringify(nm));
    const nmOld = M.normalizeMaterial({ color: '#00ff00', roughness: 0.3 });
    check('normalizeMaterial: project cu khong co AO/emissive thi mac dinh khong co map',
      nmOld && !('aoMap' in nmOld) && !('emissiveMap' in nmOld), JSON.stringify(nmOld));
    const nmBad = M.normalizeMaterial({ aoMap: '', emissiveMap: 123 });
    check('normalizeMaterial: aoMap rong / emissiveMap khong phai chuoi thi bo',
      nmBad && !('aoMap' in nmBad) && !('emissiveMap' in nmBad));
  }
  if (typeof M.createPreview3D !== 'function') {
    skip('createPreview3D', 'ED.Material.createPreview3D khong ton tai');
  } else {
    let pv = null;
    try { pv = M.createPreview3D({ getContext: function () { return null; } }, function () { return null; }); } catch (e) { pv = 'THREW:' + (e && e.message); }
    check('createPreview3D: khong co WebGLRenderer that thi tra null (fallback 2D), khong throw',
      pv === null, typeof pv === 'string' ? pv : 'tra ve ' + typeof pv);
  }
}

/* ================= C. Building (14-building.js) ================= */
console.log('--- C. Building (14-building.js) ---');
let B = null;
try {
  const ctx = loadVm('src/editor/14-building.js', {});
  B = ctx.ED.Building;
  check('14-building.js load duoc bang vm (khong can DOM/THREE)', !!B);
} catch (e) {
  check('14-building.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (B) {
  if (typeof B.defaultParams !== 'function' || typeof B.getParams !== 'function' ||
      typeof B.setParam !== 'function' || typeof B.eaveCornerY !== 'function') {
    skip('defaultParams/getParams/setParam/eaveCornerY', 'thieu API');
  } else {
    const roofDef = B.defaultParams('roof-curved', { color: '#a00000' });
    check('defaultParams mai: curvature 0.5, slope 1, 4 mat ngoi cung mau obj.color',
      roofDef && roofDef.curvature === 0.5 && roofDef.slope === 1 &&
      roofDef.tileColor.front === '#a00000' && roofDef.tileColor.back === '#a00000' &&
      roofDef.tileColor.left === '#a00000' && roofDef.tileColor.right === '#a00000',
      JSON.stringify(roofDef));
    const wallDef = B.defaultParams('wall', { color: '#cccccc' });
    check('defaultParams tuong: height 2.4, thickness 0.3, color theo obj',
      wallDef && wallDef.height === 2.4 && wallDef.thickness === 0.3 && wallDef.color === '#cccccc');
    const doorDef = B.defaultParams('door', {});
    check('defaultParams cua: height 2.2, width 1.2',
      doorDef && doorDef.height === 2.2 && doorDef.width === 1.2);
    check('defaultParams part khong co tham so (tree) tra null',
      B.defaultParams('tree', {}) === null);
    const o1 = { type: 'roof-curved', color: '#a00000', extra: {} };
    B.setParam(o1, 'curvature', 2);
    B.setParam(o1, 'slope', 0.1);
    const p1 = B.getParams(o1);
    check('setParam kep mien: curvature 2 -> 1, slope 0.1 -> 0.5',
      p1 && p1.curvature === 1 && p1.slope === 0.5, JSON.stringify(p1));
    const o2 = { type: 'wall', color: '#ffffff', extra: {} };
    B.setParam(o2, 'height', 9);
    B.setParam(o2, 'thickness', 0.01);
    const p2 = B.getParams(o2);
    check('setParam tuong: height 9 -> 6, thickness 0.01 -> 0.1',
      p2 && p2.height === 6 && p2.thickness === 0.1, JSON.stringify(p2));
    check('eaveCornerY: curvature 0 ~ 0.12, curvature 1 ~ 0.47 (cong nhieu v enh cao hon)',
      approx(B.eaveCornerY(0), 0.12, 0.02) && approx(B.eaveCornerY(1), 0.47, 0.02) &&
      B.eaveCornerY(1) > B.eaveCornerY(0), 'y0=' + B.eaveCornerY(0) + ' y1=' + B.eaveCornerY(1));
    const o3 = { type: 'roof-flat', color: '#123456', extra: { buildingParams: { curvature: 0.8, slope: 1.5, tileColor: { front: '#ff0000' } } } };
    const p3 = B.getParams(o3);
    check('getParams: param cu luu trong extra.buildingParams doc lai dung, mat thieu lay mac dinh',
      p3 && p3.curvature === 0.8 && p3.slope === 1.5 && p3.tileColor.front === '#ff0000' &&
      p3.tileColor.back === '#123456', JSON.stringify(p3));
    const roundTrip = JSON.parse(JSON.stringify(o3));
    check('buildingParams la JSON thuan: serialize/load round-trip giu nguyen',
      B.getParams(roundTrip).curvature === 0.8 && B.getParams(roundTrip).tileColor.front === '#ff0000');
  }
}

/* ================= D. Skeleton (07-character.js) ================= */
console.log('--- D. Skeleton (07-character.js) ---');
let Ch = null;
try {
  const ctx = loadVm('src/editor/07-character.js', {});
  Ch = ctx.ED.Character;
  check('07-character.js load duoc bang vm (khong can DOM/THREE)', !!Ch);
} catch (e) {
  check('07-character.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (Ch) {
  if (typeof Ch.computeBoneWeightStats !== 'function') {
    skip('computeBoneWeightStats', 'ED.Character.computeBoneWeightStats khong ton tai');
  } else {
    /* 6 dinh, xuong 2: [0.8, 0.6, 0, 1.0, 0, 0.4] (dinh 5 cong don 0.3+0.1). */
    const skinIndex = new Float32Array([0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0]);
    const skinWeight = new Float32Array([0.2, 0.8, 0, 0, 0.6, 0.4, 0, 0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.1, 0, 0]);
    /* Dinh 5: skinIndex [2,2,0,0], weights [0.3,0.1,0,0] -> xuong 2 cong don 0.4. */
    const geo = { attributes: { skinIndex: { array: skinIndex, itemSize: 4 }, skinWeight: { array: skinWeight, itemSize: 4 } } };
    const st = Ch.computeBoneWeightStats(geo, 2);
    check('computeBoneWeightStats: min 0, max 1, avg 2.8/6, >0.5 la 3, >0 la 4, top dung thu tu',
      st && approx(st.min, 0, 1e-6) && approx(st.max, 1, 1e-6) && approx(st.avg, 2.8 / 6, 1e-6) &&
      st.countOver05 === 3 && st.countOver0 === 4 && st.count === 6 &&
      st.top.length === 4 && st.top[0].vi === 3 && approx(st.top[0].w, 1, 1e-6) &&
      st.top[1].vi === 0 && approx(st.top[1].w, 0.8, 1e-6) && st.top[3].vi === 5 && approx(st.top[3].w, 0.4, 1e-6),
      JSON.stringify(st));
    check('computeBoneWeightStats: geometry khong co skin tra null',
      Ch.computeBoneWeightStats({ attributes: { position: { array: new Float32Array(9), itemSize: 3 } } }, 0) === null &&
      Ch.computeBoneWeightStats(null, 0) === null);
    const stNone = Ch.computeBoneWeightStats(geo, 1);
    check('computeBoneWeightStats: xuong khong anh huong dinh nao thi stats toan 0, top rong',
      stNone && stNone.max === 0 && stNone.countOver0 === 0 && stNone.top.length === 0);
  }
  if (typeof Ch.retargetClip !== 'function' || typeof Ch.trackBoneName !== 'function') {
    skip('retargetClip/trackBoneName', 'thieu API');
  } else {
    check('trackBoneName: 2 dang ten track, .position -> null',
      Ch.trackBoneName('mixamorig:LeftArm.quaternion') === 'mixamorig:LeftArm' &&
      Ch.trackBoneName('.bones[mixamorig:LeftArm].quaternion') === 'mixamorig:LeftArm' &&
      Ch.trackBoneName('.position') === null && Ch.trackBoneName('') === null);
    const clip = {
      name: 'run', duration: 2.5,
      tracks: [
        { name: 'mixamorig:LeftArm.quaternion', times: [0, 1], values: [0, 0, 0, 1, 0, 0, 0, 1] },
        { name: '.bones[mixamorig:Hips].position', times: [0, 1], values: [0, 0, 0, 0, 1, 0] },
        { name: 'mixamorig:LeftToe.quaternion', times: [0, 1], values: [0, 0, 0, 1, 0, 0, 0, 1] },
        { name: 'mixamorig:LeftArm.quaternion', times: [0, 2], values: [0, 0, 0, 1, 0, 0, 0, 1] }
      ]
    };
    const src = ['mixamorig:Hips', 'mixamorig:LeftArm', 'mixamorig:LeftToe'];
    const tgt = ['mixamorig:Hips', 'mixamorig:LeftArm'];
    const rt = Ch.retargetClip(clip, src, tgt);
    check('retargetClip: map dung theo ten, bo track xuong thieu, missing dung 1 lan, tracks.length = mapped',
      rt && rt.mapped === 3 && rt.clip.tracks.length === 3 && rt.clip.duration === 2.5 &&
      rt.missing.length === 1 && rt.missing[0] === 'mixamorig:LeftToe',
      JSON.stringify(rt && { mapped: rt.mapped, missing: rt.missing, n: rt.clip.tracks.length }));
    check('retargetClip: khong sua clip goc (tracks goc van 4)',
      clip.tracks.length === 4 && clip.tracks[0].times.length === 2);
    const rtEmpty = Ch.retargetClip({ name: 'x', duration: 1, tracks: [] }, src, tgt);
    check('retargetClip: clip rong -> mapped 0, missing rong',
      rtEmpty && rtEmpty.mapped === 0 && rtEmpty.missing.length === 0 && rtEmpty.clip.tracks.length === 0);
  }
}

/* ================= E. AI (08-npc-ai.js) ================= */
console.log('--- E. AI (08-npc-ai.js) ---');
let Npc = null;
try {
  const ctx = loadVm('src/editor/08-npc-ai.js', {});
  Npc = ctx.ED.NpcAi;
  check('08-npc-ai.js load duoc bang vm (khong can DOM/THREE)', !!Npc);
} catch (e) {
  check('08-npc-ai.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (Npc) {
  check('AI_STATES du 8 state: idle/patrol/wander/follow/chase/attack/alert/search',
    Array.isArray(Npc.AI_STATES) && Npc.AI_STATES.length === 8 &&
    Npc.AI_STATES.indexOf('alert') >= 0 && Npc.AI_STATES.indexOf('search') >= 0,
    JSON.stringify(Npc.AI_STATES));
  if (typeof Npc.nextAiState !== 'function' || typeof Npc.aiStateLabel !== 'function') {
    skip('nextAiState/aiStateLabel', 'thieu API');
  } else {
    const base = { ai: 'chase', attackRadius: 1.5, lastSeenPos: [5, 5], patrol: [[0, 0]], searchDuration: 5 };
    check('nextAiState: thay dich trong tam danh -> attack, xa hon -> chase',
      Npc.nextAiState(Object.assign({}, base), { targetVisible: true, distToTarget: 1 }).state === 'attack' &&
      Npc.nextAiState(Object.assign({}, base), { targetVisible: true, distToTarget: 5 }).state === 'chase');
    const lost = Npc.nextAiState(Object.assign({}, base), { targetVisible: false, timeSinceSeen: 1 });
    check('nextAiState: mat dau -> alert, moveTo = lastSeenPos',
      lost.state === 'alert' && lost.moveTo && lost.moveTo[0] === 5 && lost.moveTo[1] === 5, JSON.stringify(lost));
    const atSpot = Npc.nextAiState(Object.assign({}, base, { aiState: 'alert' }), { targetVisible: false, timeSinceSeen: 2, atLastSeen: true });
    check('nextAiState: alert toi noi -> search + lookAround',
      atSpot.state === 'search' && atSpot.lookAround === true, JSON.stringify(atSpot));
    const done = Npc.nextAiState(Object.assign({}, base, { aiState: 'search' }), { targetVisible: false, searchElapsed: 6 });
    check('nextAiState: search het 5s -> ve home (patrol, moveTo = patrol[0])',
      done.state === 'patrol' && done.moveTo && done.moveTo[0] === 0 && done.moveTo[1] === 0, JSON.stringify(done));
    const seen = Npc.nextAiState(Object.assign({}, base, { aiState: 'search' }), { targetVisible: true, distToTarget: 3, searchElapsed: 2 });
    check('nextAiState: thay lai dich trong luc search -> chase',
      seen.state === 'chase');
    const noMem = Npc.nextAiState({ ai: 'chase', attackRadius: 1.5, patrol: [[0, 0]] }, { targetVisible: false, timeSinceSeen: 1 });
    check('nextAiState: mat dau nhung khong co lastSeenPos -> ve home luon',
      noMem.state === 'patrol' && noMem.moveTo && noMem.moveTo[0] === 0);
    const stuck = Npc.nextAiState(Object.assign({}, base, { aiState: 'alert', alertTimeout: 10 }), { targetVisible: false, timeSinceSeen: 11, atLastSeen: false });
    check('nextAiState: alert qua 10s chua toi noi (ket) -> ve home',
      stuck.state === 'patrol', JSON.stringify(stuck));
    const atHome = Npc.nextAiState(Object.assign({}, base, { aiState: 'search' }), { targetVisible: false, searchElapsed: 9, atHome: true });
    check('nextAiState: search het gio + da dung o home -> moveTo null',
      atHome.state === 'patrol' && atHome.moveTo === null, JSON.stringify(atHome));
    check('aiStateLabel: alert -> Canh giac, search -> Tim kiem, chase -> Duoi theo',
      Npc.aiStateLabel('alert') === 'Cảnh giác' && Npc.aiStateLabel('search') === 'Tìm kiếm' &&
      Npc.aiStateLabel('chase') === 'Đuổi theo');
  }
}

/* ================= F. Export ZIP + Audio 3D (15-export.js) ================= */
console.log('--- F. Export ZIP + Audio 3D (15-export.js) ---');
let Ex = null;
try {
  const ctx = loadVmWithJsZip('src/editor/15-export.js', {});
  Ex = ctx.ED.Export;
  check('15-export.js load duoc bang vm (khong can DOM/THREE)', !!Ex);
  check('JSZip 3.10.1 load duoc trong vm', !!ctx.JSZip && ctx.JSZip.version === '3.10.1');
} catch (e) {
  check('15-export.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (Ex) {
  if (typeof Ex.buildZipFileList !== 'function' || typeof Ex.collectZipEntries !== 'function') {
    skip('buildZipFileList/collectZipEntries', 'thieu API');
  } else {
    const list = Ex.buildZipFileList({ version: 1, name: 'Test' });
    const paths = list.map(function (e) { return e.path; });
    const dupes = paths.filter(function (p, i) { return paths.indexOf(p) !== i; });
    check('buildZipFileList: entry dau la project.json, 33 entry, khong trung, co mapeditor.html + README.md',
      list.length === 33 && list[0].path === 'project.json' && list[0].kind === 'json' &&
      dupes.length === 0 && paths.indexOf('mapeditor.html') >= 0 && paths.indexOf('README.md') >= 0 &&
      paths.indexOf('src/editor/04-terrain.js') >= 0 && paths.indexOf('lib/jszip.min.js') >= 0,
      'n=' + list.length + ' dupes=' + JSON.stringify(dupes));
    check('buildZipFileList: projectJson object duoc stringify vao content',
      list[0].content && list[0].content.indexOf('"name": "Test"') >= 0);
  }
  if (typeof Ex.pannerGainFor !== 'function' || typeof Ex.panFor !== 'function') {
    skip('pannerGainFor/panFor', 'thieu API');
  } else {
    check('pannerGainFor: gan = 1, 15/30 = 0.5, >= 30 = 0',
      Ex.pannerGainFor(0, 30) === 1 && approx(Ex.pannerGainFor(15, 30), 0.5) &&
      Ex.pannerGainFor(30, 30) === 0 && Ex.pannerGainFor(100, 30) === 0);
    check('panFor: phai +1, trai -1, truoc/sau 0, cheo ~0.707',
      approx(Ex.panFor([1, 0, 0], [0, 0, 0], [0, 0, -1]), 1) &&
      approx(Ex.panFor([-1, 0, 0], [0, 0, 0], [0, 0, -1]), -1) &&
      approx(Ex.panFor([0, 0, -5], [0, 0, 0], [0, 0, -1]), 0) &&
      approx(Ex.panFor([0, 0, 5], [0, 0, 0], [0, 0, -1]), 0) &&
      approx(Ex.panFor([1, 0, -1], [0, 0, 0], [0, 0, -1]), 0.707, 0.01) &&
      Ex.panFor([0, 0, 0], [0, 0, 0], [0, 0, -1]) === 0);
  }
  if (typeof Ex.combatNext !== 'function' || typeof Ex.fadePlan !== 'function') {
    skip('combatNext/fadePlan', 'thieu API');
  } else {
    check('combatNext: explore + inCombat -> combat ngay; yen 4s van combat; yen 5.001s -> explore; force -> explore ngay',
      Ex.combatNext('explore', true, 1000, 0).mode === 'combat' &&
      Ex.combatNext('combat', false, 5000, 1000).mode === 'combat' &&
      Ex.combatNext('combat', false, 6001, 1000).mode === 'explore' &&
      Ex.combatNext('combat', false, 2000, 1000, true).mode === 'explore' &&
      Ex.combatNext('explore', true, 1000, 0).lastHitMs === 1000);
    const fp = Ex.fadePlan(0.2, 0.8, 30);
    let mono = true;
    for (let i = 1; i < fp.length; i++) if (fp[i] < fp[i - 1] - 1e-9) mono = false;
    check('fadePlan: 31 diem, don dieu, dau/cuoi chinh xac',
      fp.length === 31 && approx(fp[0], 0.2) && approx(fp[30], 0.8) && mono);
  }
  check('khong co API Publish nao trong ED.Export',
    typeof Ex.publish !== 'function' && typeof Ex.publishProject !== 'function');
}

/* ================= G. Tich hop ================= */
console.log('--- G. Tich hop ---');
try {
  const ctx = loadVm('src/editor/01-viewport.js', {});
  const Vp = ctx.ED.Viewport;
  check('01-viewport.js load duoc bang vm, getTerrainMesh ton tai',
    !!Vp && typeof Vp.getTerrainMesh === 'function');
  if (Vp && typeof Vp.getTerrainMesh === 'function') {
    let r = null;
    try { r = Vp.getTerrainMesh(); } catch (e) { r = 'THREW'; }
    check('getTerrainMesh(): chua co scene/terrain thi tra null, khong throw', r === null);
    ctx.ED.Terrain = { getMesh: function () { return { fakeMesh: true }; } };
    let r2 = null;
    try { r2 = Vp.getTerrainMesh(); } catch (e) { r2 = null; }
    check('getTerrainMesh(): delegate ED.Terrain.getMesh() khi co', r2 && r2.fakeMesh === true);
  }
} catch (e) {
  check('01-viewport.js load duoc bang vm', false, e && e.message);
}
(function () {
  const playSrc = read('src/editor/09-play.js');
  check('09-play.js: wiring setCombatMode trong update() (sau _updateMonsterAttacks)',
    playSrc.indexOf('ED.Export.setCombatMode') >= 0 && playSrc.indexOf('_updateMonsterAttacks()') >= 0);
  const stopIdx = playSrc.indexOf('stopAmbient()');
  const combatIdx = playSrc.indexOf('setCombatMode(false, true)');
  check('09-play.js: stop() ve explore ngay (setCombatMode(false, true))',
    stopIdx >= 0 && combatIdx >= 0);
  check('tools/build-editor.mjs: co placeholder __JSZIP__ + doc lib/jszip.min.js',
    read('tools/build-editor.mjs').indexOf('__JSZIP__') >= 0 &&
    read('tools/build-editor.mjs').indexOf('jszip.min.js') >= 0);
  check('editor.template.html: co khoi <script>__JSZIP__</script>',
    read('src/editor/editor.template.html').indexOf('__JSZIP__') >= 0);
  check('lib/jszip.min.js: ton tai, khong chua </script',
    exists('lib/jszip.min.js') && read('lib/jszip.min.js').indexOf('</script') < 0);
  const built = exists('mapeditor.html') ? read('mapeditor.html') : '';
  check('mapeditor.html build ra: chua JSZip + getChunkMeshes + buildZipFileList + setCombatMode',
    built.indexOf('JSZip') >= 0 && built.indexOf('getChunkMeshes') >= 0 &&
    built.indexOf('buildZipFileList') >= 0 && built.indexOf('setCombatMode') >= 0);
  check('mapeditor.html: khoi <script>__JSZIP__</script> cua template da duoc thay (chi con 2 lan nhac trong comment cua 15-export.js)',
    built.indexOf('__JSZIP__\n</script>') < 0 && (built.split('__JSZIP__').length - 1) === 2);
  /* Hash kieu git blob ("blob <size>\\0" + noi dung), giong `git hash-object`. */
  const gameBuf = fs.readFileSync(path.join(root, 'mongvolam.html'));
  const gameHash = crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + gameBuf.length + '\0'), gameBuf])).digest('hex');
  check('mongvolam.html khong doi trong dot 4 (hash 8792425d)',
    gameHash === '8792425df06eca92538eba790eaf4dec798a0c8c', 'hash=' + gameHash);
  const origNames = fs.readdirSync(path.join(root, 'src', 'original')).sort();
  check('src/original/ khong bi sua (dung 5 file goc)',
    JSON.stringify(origNames) === JSON.stringify(['Add char.html', 'battle map.html', 'map scene.html', 'select map.html', 'table infoscene.html']),
    JSON.stringify(origNames));
})();

/* ================= H. ZIP that (async) ================= */
(async function () {
  console.log('--- H. ZIP that (async, JSZip that) ---');
  if (!Ex || typeof Ex.collectZipEntries !== 'function' || typeof Ex.buildZipFileList !== 'function') {
    skip('ZIP that', 'thieu API collectZipEntries/buildZipFileList');
  } else {
    const list = Ex.buildZipFileList({ version: 1, name: 'ZipTest' });
    const fetcher = function (url) {
      if (url.indexOf('missing') >= 0) return Promise.resolve(null);
      return Promise.resolve('NOI-DUNG:' + url);
    };
    /* Gia 2 file loi bang cach doi url cua 2 entry fetch. */
    const list2 = list.map(function (e, i) {
      if (i === 2 || i === 5) return { path: e.path, kind: 'fetch', url: 'missing/' + e.path };
      return e;
    });
    try {
      const res = await Ex.collectZipEntries(list2, fetcher);
      check('collectZipEntries: file loi vao missing (2 file), con lai du entry',
        res.missing.length === 2 && res.entries.length === list2.length - 2 &&
        res.entries[0].path === 'project.json' && res.entries[0].data.indexOf('ZipTest') >= 0,
        'missing=' + JSON.stringify(res.missing) + ' entries=' + res.entries.length);
      const zip = new JSZip();
      res.entries.forEach(function (e) { zip.file(e.path, e.data); });
      zip.file('THIEU_FILE.txt', res.missing.join('\n'));
      const buf = await zip.generateAsync({ type: 'nodebuffer' });
      const zip2 = await JSZip.loadAsync(buf);
      /* JSZip.loadAsync tra ca entry thu muc (src/, src/editor/, lib/) — chi dem file. */
      const names = Object.keys(zip2.files).filter(function (n) { return !zip2.files[n].dir; });
      check('ZIP that: doc lai du file (entries + THIEU_FILE.txt), project.json dung noi dung',
        names.length === res.entries.length + 1 && names.indexOf('project.json') >= 0 &&
        names.indexOf('THIEU_FILE.txt') >= 0 &&
        (await zip2.file('project.json').async('string')).indexOf('ZipTest') >= 0);
    } catch (e) {
      check('collectZipEntries + ZIP that', false, e && e.message);
    }
  }

  console.log('----------------------------------------');
  console.log(pass + ' PASS, ' + skipped + ' SKIP, ' + fail + ' FAIL');
  if (failedNames.length) console.log('FAILED: ' + failedNames.join(' | '));
  process.exit(fail ? 1 : 0);
})();
