/* Kiểm thử Map Editor ĐỢT 5 (mapeditor.html) + Itch.io — logic thuần, không cần trình duyệt.
   - (A) Terrain (04-terrain.js): LOD 3 mức/chunk + hysteresis + mép chunk snap,
     erosion dòng chảy tích lũy (flow map D8 + rãnh dọc dốc, deterministic).
   - (B) Environment (05-environment.js): area light normalize, fog layer bay theo gió.
   - (C) Building (14-building.js): param cửa sổ/cầu thang/ban công/cột/mái tileRows.
   - (D) Character + AI (07-character.js, 08-npc-ai.js): morph normalize/collect,
     utility scoring + pickBehavior.
   - (E) Physics + Audio (17-physics.js, 15-export.js): crate xoay/quán tính +
     chồng/rơi, nhạc theo preset.
   - (F) Itch (18-itch.js + build-itch.mjs): tên file ZIP, file list, ZIP đọc lại.
   - (G) Tích hợp: build-editor nối 18-itch + RectAreaLight, wiring Play (crateStep,
     LITE_LABEL, utility flee), LOD vào render loop + perf HUD, preset music,
     mongvolam.html không đổi, index.html byte-identical với mongvolam.html.
   Module/API nào không tồn tại thật trong code thì SKIP ghi rõ lý do, KHÔNG bịa pass.
   Chạy: node tools/build.mjs && node tools/build-editor.mjs && node tools/build-itch.mjs
         && node tools/test-mapeditor5.cjs
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
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

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
function gitBlobHash(buf) {
  const head = Buffer.from('blob ' + buf.length + '\0', 'utf8');
  return crypto.createHash('sha1').update(Buffer.concat([head, buf])).digest('hex');
}

console.log('--- (A) Terrain LOD + erosion dòng chảy ---');
(function () {
  const ctx = loadVm('src/editor/04-terrain.js');
  const T = ctx.ED.Terrain;
  if (!T || typeof T.edTerrainLodLevel !== 'function') { skip('A1 LOD level', 'ED.Terrain.edTerrainLodLevel không tồn tại'); return; }
  check('A1 LOD level theo khoảng cách (10->0, 40->1, 80->2)',
    T.edTerrainLodLevel(10) === 0 && T.edTerrainLodLevel(40) === 1 && T.edTerrainLodLevel(80) === 2);
  check('A2 LOD level ngưỡng tùy chỉnh [20,50] (10->0, 30->1, 60->2)',
    T.edTerrainLodLevel(10, [20, 50]) === 0 && T.edTerrainLodLevel(30, [20, 50]) === 1 && T.edTerrainLodLevel(60, [20, 50]) === 2);
  check('A3 hysteresis thô dần: 40 từ mức 0 -> 1 (vượt 35*1.1), 36 từ 0 -> 0',
    T.edTerrainLodNextLevel(40, 0) === 1 && T.edTerrainLodNextLevel(36, 0) === 0);
  check('A4 hysteresis mịn dần: 30 từ mức 1 -> 0 (dưới 35*0.9), 34 từ 1 -> 1',
    T.edTerrainLodNextLevel(30, 1) === 0 && T.edTerrainLodNextLevel(34, 1) === 1);
  check('A5 hysteresis mức xa: 80 từ 1 -> 2 (vượt 70*1.1), 60 từ 2 -> 1 (dưới 70*0.9)',
    T.edTerrainLodNextLevel(80, 1) === 2 && T.edTerrainLodNextLevel(60, 2) === 1);
  check('A6 hysteresis: vượt ngưỡng đích thì nhảy thẳng (80 từ 0 -> 2, 20 từ 2 -> 0); vùng giữa chỉ 1 mức (60 từ 0 -> 1, 50 từ 2 -> 1)',
    T.edTerrainLodNextLevel(80, 0) === 2 && T.edTerrainLodNextLevel(20, 2) === 0 &&
    T.edTerrainLodNextLevel(60, 0) === 1 && T.edTerrainLodNextLevel(50, 2) === 1);
  // Lưới LOD: heights 65x65, giá trị = ix (ramp theo x) + iz*iz (phi tuyến theo z).
  const SIDE = 65, N = SIDE * SIDE;
  const heights = new Array(N), paints = new Array(N);
  for (let i = 0; i < N; i++) { const ix = i % SIDE, iz = Math.floor(i / SIDE); heights[i] = ix + iz * iz; paints[i] = 0; }
  const g0 = T.edTerrainLodGrid(heights, paints, 0, 0, 0, {});
  const g1 = T.edTerrainLodGrid(heights, paints, 0, 0, 1, {});
  const g2 = T.edTerrainLodGrid(heights, paints, 0, 0, 2, {});
  check('A7 lưới LOD vertsPerSide 17/9/5 theo mức 0/1/2',
    g0.vertsPerSide === 17 && g1.vertsPerSide === 9 && g2.vertsPerSide === 5);
  check('A8 góc chunk trùng nhau ở mọi mức (góc (0,0) = 64^2)',
    g0.heights[0] === 4096 && g1.heights[0] === 4096 && g2.heights[0] === 4096);
  // Snap mép phải: hàng 1 (izH=63, gx=16) raw = 16 + 63^2 = 3985;
  // nội suy từ hàng 0,2 = (16+64^2 + 16+62^2)/2 = 3986.
  const g0snap = T.edTerrainLodGrid(heights, paints, 0, 0, 0, { right: 1 });
  const g0raw = T.edTerrainLodGrid(heights, paints, 0, 0, 0, { right: 0 });
  const vps = g0.vertsPerSide;
  check('A9 mép chunk snap: kề thô hơn thì đỉnh mép = nội suy (3986), kề cùng mức thì giữ gốc (3985)',
    g0snap.heights[1 * vps + (vps - 1)] === 3986 && g0raw.heights[1 * vps + (vps - 1)] === 3985);
  // updateLod/getLodInfo bằng vm (không cần scene — rebuildChunkMesh trả null sớm).
  if (typeof T.setHeights === 'function') T.setHeights(new Array(N).fill(0));
  if (typeof T.setPaints === 'function') T.setPaints(new Array(N).fill(0));
  T.updateLod({ x: 0, y: 10, z: 0 });
  const infoNear = T.getLodInfo();
  check('A10 updateLod camera gần: tổng 16 chunk, có chunk mức 0',
    infoNear && infoNear.total === 16 && (infoNear.levels[0] + infoNear.levels[1] + infoNear.levels[2]) === 16 && infoNear.levels[0] > 0);
  T.updateLod({ x: 500, y: 10, z: 500 });
  T.updateLod({ x: 500, y: 10, z: 500 }); // hysteresis chỉ nhảy 1 mức/lần -> gọi 2 lần mới lên mức 2
  const infoFar = T.getLodInfo();
  check('A11 updateLod camera xa: toàn bộ 16 chunk mức 2',
    infoFar && infoFar.levels[2] === 16 && infoFar.levels[0] === 0 && infoFar.levels[1] === 0);
  // Flow map: dốc +x trên lưới size 2 (3x3), mỗi hàng chảy về cột cuối.
  const hs = [2, 1, 0, 2, 1, 0, 2, 1, 0];
  const fm1 = T.edTerrainFlowMap(hs, 2);
  const fm2 = T.edTerrainFlowMap(hs, 2);
  check('A12 flow map dốc +x: ô cuối mỗi hàng tích đủ 3 đơn vị',
    fm1.flow[2] === 3 && fm1.flow[5] === 3 && fm1.flow[8] === 3);
  check('A13 flow map deterministic (chạy 2 lần giống hệt)',
    deepEq(fm1, fm2));
  check('A14 flow map ô đầu dốc chỉ có nước của mình (flow=1)',
    fm1.flow[0] === 1 && fm1.flow[3] === 1 && fm1.flow[6] === 1);
  // Erosion dòng chảy: dốc dài 5x5, mỗi hàng [4,3,2,1,-1] (ix=4 là trũng -> lắng đọng).
  // Ô ix=3 (flow 4) xói nhiều hơn ô ix=0 (flow 1) vì cùng độ dốc nhưng w lớn hơn.
  const hs2 = [];
  for (let i = 0; i < 25; i++) { const ix = i % 5; hs2[i] = ix < 4 ? 4 - ix : -1; }
  const before = hs2.slice();
  const er = T.edTerrainErodeFlow(hs2, 4, { strength: 1 });
  check('A15 erosion dòng chảy: ô flow lớn (ix=3) giảm nhiều hơn ô flow nhỏ (ix=0)',
    (before[3] - er[3]) > (before[0] - er[0]) && er[3] < before[3]);
  check('A16 erosion không sửa mảng gốc',
    deepEq(hs2, before));
  const flat = new Array(9).fill(5);
  const erFlat = T.edTerrainErodeFlow(flat, 2, { strength: 1 });
  check('A17 đất phẳng hoàn toàn không đổi sau erosion',
    deepEq(erFlat, flat));
  const er1 = T.edTerrainErodeFlow(hs, 2, { strength: 1 });
  const er2 = T.edTerrainErodeFlow(hs, 2, { strength: 1 });
  check('A18 erosion deterministic',
    deepEq(er1, er2));
})();

console.log('--- (B) Environment: area light + fog layers ---');
(function () {
  const ctx = loadVm('src/editor/05-environment.js');
  const E = ctx.ED.Environment;
  if (!E || typeof E.edEnvAreaLightNormalize !== 'function') { skip('B1 area light', 'ED.Environment.edEnvAreaLightNormalize không tồn tại'); return; }
  const n1 = E.edEnvAreaLightNormalize({ intensity: 9 });
  const n2 = E.edEnvAreaLightNormalize({ intensity: -3 });
  const n3 = E.edEnvAreaLightNormalize({ width: 20, height: 0.2 });
  const n4 = E.edEnvAreaLightNormalize({ preset: 'la' });
  check('B1 area light normalize kẹp cường độ 0–5 (9->5, -3->0)',
    n1.intensity === 5 && n2.intensity === 0);
  check('B2 area light normalize kẹp rộng/cao 1–10 (20->10, 0.2->1)',
    n3.width === 10 && n3.height === 1);
  check('B3 area light preset lạ -> \'window\'',
    n4.preset === 'window');
  check('B4 defaultAreaLight mặc định tắt',
    E.defaultAreaLight && E.defaultAreaLight().enabled === false);
  if (typeof E.edEnvFogLayerPositions !== 'function') { skip('B5 fog layers', 'edEnvFogLayerPositions không tồn tại'); return; }
  const p0 = E.edEnvFogLayerPositions(3, 1, 0, [1, 0]);
  const p2 = E.edEnvFogLayerPositions(3, 1, 2, [1, 0]);
  check('B5 fog layer đúng số lớp (3) và y trong [height, height+0.8]',
    p0.length === 3 && p0.every(function (p) { return p.y >= 1 && p.y <= 1.8; }));
  check('B6 fog layer bay theo gió: gió [1,0] sau 2s thì x tăng đúng 2',
    p0.length === 3 && p2.length === 3 && p2.every(function (p, i) {
      var dx = p.x - p0[i].x;
      // cuộn biên ±48: cho phép wrap (dx âm lớn khi cuộn qua biên).
      return approx(dx, 2, 1e-6) || dx < -90;
    }));
  const pA = E.edEnvFogLayerPositions(4, 2, 5, [0.6, 0.8]);
  const pB = E.edEnvFogLayerPositions(4, 2, 5, [0.6, 0.8]);
  check('B7 fog layer deterministic (gọi 2 lần giống hệt)',
    deepEq(pA, pB));
  check('B8 fog layer count 0 -> mảng rỗng, count > 12 kẹp 12',
    E.edEnvFogLayerPositions(0, 1, 0, [1, 0]).length === 0 &&
    E.edEnvFogLayerPositions(20, 1, 0, [1, 0]).length === 12);
  check('B9 defaultFogLayers mặc định tắt',
    E.defaultFogLayers && E.defaultFogLayers().enabled === false);
})();

console.log('--- (C) Building: param cửa sổ/cầu thang/ban công/cột/mái ---');
(function () {
  const ctx = loadVm('src/editor/14-building.js');
  const B = ctx.ED.Building;
  if (!B || typeof B.defaultParams !== 'function') { skip('C1 building', 'ED.Building.defaultParams không tồn tại'); return; }
  const w = B.defaultParams('window');
  const s = B.defaultParams('stairs');
  const b = B.defaultParams('balcony');
  const c = B.defaultParams('pillar');
  const r = B.defaultParams('roof-curved');
  check('C1 defaultParams đủ field mới (window/stairs/balcony/pillar/roof tileRows)',
    w && w.width === 1.0 && w.height === 1.2 && w.panes === 4 &&
    s && s.steps === 6 && s.stepHeight === 0.15 && s.width === 1.2 &&
    b && b.width === 2.4 && b.depth === 1.2 && b.railing === true &&
    c && c.height === 2.4 && c.radius === 0.12 && c.shape === 'round' &&
    r && r.tileRows === 4);
  check('C2 windowPaneGrid: 4->2x2, 6->3x2, 5->5x1, 1->1x1',
    deepEq(B.windowPaneGrid(4), { cols: 2, rows: 2 }) &&
    deepEq(B.windowPaneGrid(6), { cols: 3, rows: 2 }) &&
    deepEq(B.windowPaneGrid(5), { cols: 5, rows: 1 }) &&
    deepEq(B.windowPaneGrid(1), { cols: 1, rows: 1 }));
  check('C3 windowPaneGrid kẹp 0->1, 9->6',
    deepEq(B.windowPaneGrid(0), { cols: 1, rows: 1 }) &&
    deepEq(B.windowPaneGrid(9), { cols: 3, rows: 2 }));
  const sd = B.stairsDims({ steps: 6, stepHeight: 0.15, width: 1.2 });
  check('C4 stairsDims tổng cao = steps x stepHeight (6 x 0.15 = 0.9)',
    sd && approx(sd.totalH, 0.9) && sd.steps === 6);
  const bd = B.balconyDims({ width: 2.4, depth: 1.2, railing: true });
  check('C5 balconyDims rộng 2.4 -> 5 trụ lan can',
    bd && bd.posts === 5 && bd.railing === true);
  const cd = B.columnDims({ height: 2.4, radius: 0.12, shape: 'round' });
  check('C6 columnDims thân cao = tổng - 0.27 (2.4 -> 2.13)',
    cd && approx(cd.shaftH, 2.13) && cd.shape === 'round');
  check('C7 roofTileRowsGeom: 4 hàng -> 3 gờ, 1 hàng -> 0 gờ, 12 hàng -> 11 gờ',
    B.roofTileRowsGeom(4, 4, 3, 2, 0).length === 3 &&
    B.roofTileRowsGeom(1, 4, 3, 2, 0).length === 0 &&
    B.roofTileRowsGeom(12, 4, 3, 2, 0).length === 11);
  if (typeof B.getParams === 'function') {
    const gp = B.getParams({ type: 'window', extra: { buildingParams: { panes: 9, width: 5 } } });
    check('C8 getParams kẹp miền (panes 9->6, width 5->2)',
      gp && gp.panes === 6 && gp.width === 2);
    const gp2 = B.getParams({ type: 'stairs', extra: { buildingParams: { steps: 1, stepHeight: 0.05 } } });
    check('C9 getParams cầu thang kẹp (steps 1->2, stepHeight 0.05->0.1)',
      gp2 && gp2.steps === 2 && approx(gp2.stepHeight, 0.1));
    const gp3 = B.getParams({ type: 'pillar', extra: {} });
    check('C10 part cũ không param -> mặc định cũ (cột cao 2.4, r 0.12)',
      gp3 && gp3.height === 2.4 && gp3.radius === 0.12);
  } else skip('C8-C10 getParams', 'ED.Building.getParams không tồn tại');
})();

console.log('--- (D) Character morph + Utility AI ---');
(function () {
  const ctxC = loadVm('src/editor/07-character.js');
  const C = ctxC.ED.Character;
  if (!C || typeof C.morphNormalize !== 'function') { skip('D1 morph', 'ED.Character.morphNormalize không tồn tại'); }
  else {
    const dict = { Smile: 0, Blink: 1, Frown: 2 };
    const m = C.morphNormalize({ Smile: 1.5, Blink: -0.3, Frown: '0.7', La: 0.5, Na: NaN }, dict);
    check('D1 morphNormalize kẹp 0–1 + lọc tên lạ (1.5->1, -0.3->0, \'0.7\'->0.7)',
      m.Smile === 1 && m.Blink === 0 && approx(m.Frown, 0.7) && !('La' in m) && !('Na' in m));
    var fakeGroup = { children: [
      { isMesh: true, name: 'm1', morphTargetDictionary: { Smile: 0, Blink: 1 }, morphTargetInfluences: [0, 0] },
      { isMesh: true, name: 'm2', morphTargetDictionary: { Smile: 0, Frown: 1 }, morphTargetInfluences: [0, 0] },
      { name: 'bone' }
    ] };
    // traverse giả kiểu THREE.Group: gọi fn cho group rồi từng con.
    fakeGroup.traverse = function (fn) {
      fn(fakeGroup);
      for (var i = 0; i < fakeGroup.children.length; i++) fn(fakeGroup.children[i]);
    };
    const names = C.morphTargetNames(fakeGroup);
    check('D2 morphTargetNames gộp đủ 3 tên duy nhất từ 2 mesh (Smile/Blink/Frown)',
      Array.isArray(names) && names.length === 3 && names.indexOf('Smile') >= 0 && names.indexOf('Blink') >= 0 && names.indexOf('Frown') >= 0);
    const collected = C.collectMorphTargets(fakeGroup);
    check('D3 collectMorphTargets bỏ mesh không có morph (2 mesh -> có target)',
      Array.isArray(collected) && collected.length >= 3);
    if (typeof C.validateGlbFile === 'function') {
      check('D4 validateGlbFile: đúng .glb 1KB pass; sai đuôi/rỗng/>20MB fail',
        C.validateGlbFile({ name: 'a.glb', size: 1024 }).ok === true &&
        C.validateGlbFile({ name: 'a.fbx', size: 1024 }).ok === false &&
        C.validateGlbFile({ name: 'a.glb', size: 0 }).ok === false &&
        C.validateGlbFile({ name: 'a.glb', size: 21 * 1024 * 1024 }).ok === false);
    } else skip('D4 validateGlbFile', 'ED.Character.validateGlbFile không tồn tại');
    if (typeof C.applyMorphValuesToMesh === 'function') {
      const mesh = { morphTargetDictionary: { Smile: 0, Blink: 1 }, morphTargetInfluences: [0, 0] };
      C.applyMorphValuesToMesh(mesh, { Smile: 0.8, Blink: 2, La: 1 });
      check('D5 applyMorphValuesToMesh ghi đúng influence + kẹp + bỏ tên lạ',
        approx(mesh.morphTargetInfluences[0], 0.8) && mesh.morphTargetInfluences[1] === 1);
    } else skip('D5 applyMorphValuesToMesh', 'ED.Character.applyMorphValuesToMesh không tồn tại');
  }
  const ctxA = loadVm('src/editor/08-npc-ai.js');
  const A = ctxA.ED.NpcAi;
  if (!A || typeof A.utilityScores !== 'function') { skip('D6 utility', 'ED.NpcAi.utilityScores không tồn tại'); return; }
  check('D6 utility HP 20% + địch 2 ô -> flee',
    A.utilityScores({ enemyDist: 2, hpPct: 20, alliesNear: 0, hasMemory: false }).best === 'flee');
  check('D7 utility HP 90% + địch 2 ô -> attack',
    A.utilityScores({ enemyDist: 2, hpPct: 90, alliesNear: 0, hasMemory: false }).best === 'attack');
  check('D8 utility HP 90% + địch 8 ô -> chase',
    A.utilityScores({ enemyDist: 8, hpPct: 90, alliesNear: 0, hasMemory: false }).best === 'chase');
  check('D9 utility không địch + có memory -> search',
    A.utilityScores({ enemyDist: Infinity, hpPct: 90, alliesNear: 0, hasMemory: true }).best === 'search');
  check('D10 utility không địch + không memory -> patrol',
    A.utilityScores({ enemyDist: Infinity, hpPct: 90, alliesNear: 0, hasMemory: false }).best === 'patrol');
  check('D11 utility enemyDist null coi như mất dấu (không phải cự ly 0)',
    A.utilityScores({ enemyDist: null, hpPct: 90, alliesNear: 0, hasMemory: false }).best === 'patrol');
  const w0 = A.utilityScores({ enemyDist: 2, hpPct: 20, alliesNear: 0, hasMemory: false, weights: { flee: 0 } });
  check('D12 utility đổi weights đổi kết quả (flee=0 thì HP 20% không còn flee)',
    w0.best !== 'flee');
  const ally = A.utilityScores({ enemyDist: 2, hpPct: 20, alliesNear: 3, hasMemory: false });
  const noAlly = A.utilityScores({ enemyDist: 2, hpPct: 20, alliesNear: 0, hasMemory: false });
  check('D13 utility đồng minh làm tăng điểm attack/chase, giảm điểm flee',
    ally.scores.attack > noAlly.scores.attack && ally.scores.flee < noAlly.scores.flee);
  if (typeof A.pickBehavior === 'function') {
    const best = A.pickBehavior({ id: 't1', hpPct: 20 }, { enemyDist: 2, hpPct: 20, alliesNear: 0, hasMemory: false });
    check('D14 pickBehavior trả flee + lưu debug điểm lần chọn',
      best === 'flee' && A._utilityDebug && A._utilityDebug.t1 && A._utilityDebug.t1.best === 'flee');
  } else skip('D14 pickBehavior', 'ED.NpcAi.pickBehavior không tồn tại');
})();

console.log('--- (E) Physics crate xoay + nhạc theo preset ---');
(function () {
  const ctx = loadVm('src/editor/17-physics.js');
  const P = ctx.ED.Physics;
  if (!P || typeof P.crateStep !== 'function') { skip('E1 crateStep', 'ED.Physics.crateStep không tồn tại'); return; }
  check('E1 LITE_LABEL ghi rõ physics-lite',
    typeof P.LITE_LABEL === 'string' && P.LITE_LABEL.indexOf('physics-lite') >= 0);
  const base = { pos: [0, 0, 0], vel: [0, 0], rotY: 0, angVel: 0, velY: 0, size: [1, 1], height: 1 };
  const off = P.crateStep(Object.assign({}, base), 0.016, [], [], { dir: [1, 0], pushPoint: [0, 0.4] });
  check('E2 đẩy lệch tâm (pushPoint [0,0.4], hướng +x): angVel != 0, rotY đổi, vẫn trượt +x',
    off.crate.angVel !== 0 && off.crate.rotY !== 0 && off.crate.pos[0] > 0);
  const off2 = P.crateStep(Object.assign({}, base), 0.016, [], [], { dir: [1, 0], pushPoint: [0, -0.4] });
  check('E3 đẩy lệch phía đối diện đổi dấu angVel',
    (off.crate.angVel > 0 && off2.crate.angVel < 0) || (off.crate.angVel < 0 && off2.crate.angVel > 0));
  const cen = P.crateStep(Object.assign({}, base), 0.016, [], [], { dir: [1, 0], pushPoint: [0, 0] });
  check('E4 đẩy qua tâm: angVel = 0, rotY = 0',
    cen.crate.angVel === 0 && cen.crate.rotY === 0);
  let st = { pos: [0, 0, 0], vel: [0, 0], rotY: 0, angVel: 2, velY: 0, size: [1, 1], height: 1 };
  for (let i = 0; i < 60; i++) st = P.crateStep(st, 0.016, [], [], {}).crate;
  check('E5 ma sát góc: angVel=2 về 0 sau 60 bước, rotY dừng tăng',
    st.angVel === 0 && st.rotY > 0);
  check('E6 pushCrate cũ tương thích (đẩy +x vẫn vel=[3,0], y không đổi)',
    (function () {
      const r = P.pushCrate({ pos: [0, 0, 0], vel: [0, 0], size: [1, 1] }, [1, 0], 0.016, [], {});
      return r.crate.vel[0] === 3 && r.crate.vel[1] === 0 && r.crate.pos[1] === 0;
    })());
  const bottom = { id: 'a', pos: [0, 0, 0], size: [1, 1], height: 1 };
  const top = { pos: [0, 1, 0], vel: [0, 0], rotY: 0, angVel: 0, velY: 0, size: [1, 1], height: 1 };
  const stacked = P.crateStep(Object.assign({}, top), 0.016, [], [bottom], {});
  check('E7 chồng thùng: thùng trên y=1 đứng yên, resting, supportedBy=a',
    stacked.resting === true && stacked.crate.pos[1] === 1 && stacked.supportedBy === 'a');
  let fall = { pos: [0, 1, 0], vel: [0, 0], rotY: 0, angVel: 0, velY: 0, size: [1, 1], height: 1 };
  for (let i = 0; i < 120; i++) fall = P.crateStep(fall, 0.016, [], [], {}).crate;
  check('E8 thùng dưới bị đẩy đi -> thùng trên rơi đáp đất y=0',
    fall.pos[1] === 0);
  const ctxE = loadVm('src/editor/15-export.js');
  const X = ctxE.ED.Export;
  if (!X || typeof X.edAudioTrackForPreset !== 'function') { skip('E9 nhạc preset', 'ED.Export.edAudioTrackForPreset không tồn tại'); return; }
  check('E9 track theo preset: đã gán trả đúng, chưa gán trả fallback, cả hai trống trả null',
    X.edAudioTrackForPreset('thanh-co', { 'thanh-co': 't1' }, 'fb') === 't1' &&
    X.edAudioTrackForPreset('rung-truc', { 'thanh-co': 't1' }, 'fb') === 'fb' &&
    X.edAudioTrackForPreset('chua', {}, null) === null);
  const m0 = { 'thanh-co': 't1' };
  const m1 = X.edAudioSetPresetTrack(m0, 'chua', 't2');
  check('E10 setPresetTrack trả map mới, không sửa map gốc; trackId rỗng thì xoá gán',
    m1['chua'] === 't2' && !('chua' in m0) &&
    !('thanh-co' in X.edAudioSetPresetTrack({ 'thanh-co': 't1' }, 'thanh-co', '')));
})();

console.log('--- (F) Itch: editor module + ZIP gói game ---');
(function () {
  const ctx = loadVm('src/editor/18-itch.js');
  const I = ctx.ED.Itch;
  if (!I || typeof I.zipFileName !== 'function') { skip('F1 itch module', 'ED.Itch.zipFileName không tồn tại'); return; }
  check('F1 zipFileName chuẩn hoá tên project (Biện Kinh Thành -> mapeditor-bien-kinh-thanh-itch.zip)',
    I.zipFileName('Biện Kinh Thành') === 'mapeditor-bien-kinh-thanh-itch.zip');
  const list = [
    { path: 'mapeditor.html', kind: 'fetch', url: 'mapeditor.html' },
    { path: 'project.json', kind: 'json', content: '{}' }
  ];
  const out = I.buildItchFileList(list, 'Test');
  check('F2 buildItchFileList map mapeditor.html -> index.html (giữ url fetch gốc) + thêm README',
    out.some(function (e) { return e.path === 'index.html' && e.url === 'mapeditor.html'; }) &&
    out.some(function (e) { return e.path === 'README-ITCH-EDITOR.md'; }));
  check('F3 buildItchFileList không sửa list gốc',
    list.length === 2 && list[0].path === 'mapeditor.html');
  if (exists('dist-itch/mongvolam1-itch.zip')) {
    const zipBuf = fs.readFileSync(path.join(root, 'dist-itch/mongvolam1-itch.zip'));
    JSZip.loadAsync(zipBuf).then(function (zip) {
      const names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
      check('F4 ZIP itch đọc lại đủ 17 file (index + mongvolam + Shop + Newgame + Event + 11 map + README)',
        names.length === 17 && names.indexOf('index.html') >= 0 && names.indexOf('mongvolam.html') >= 0 &&
        names.indexOf('Shop.html') >= 0 && names.filter(function (n) { return n.indexOf('map/') === 0; }).length === 11);
      return Promise.all([
        zip.file('index.html').async('nodebuffer'),
        zip.file('mongvolam.html').async('nodebuffer')
      ]);
    }).then(function (bufs) {
      check('F5 index.html trong ZIP byte-identical với mongvolam.html trong ZIP',
        bufs[0].equals(bufs[1]));
      finish();
    }).catch(function (e) {
      check('F4/F5 đọc ZIP itch', false, String(e && e.message || e));
      finish();
    });
  } else {
    skip('F4/F5 ZIP itch', 'dist-itch/mongvolam1-itch.zip chưa build (chạy node tools/build-itch.mjs trước)');
    finish();
  }
  function finish() {
    console.log('--- (G) Tích hợp build + wiring ---');
    (function () {
      const be = read('tools/build-editor.mjs');
      check('G1 build-editor.mjs nối 18-itch.js vào ORDERED',
        be.indexOf("'18-itch.js'") >= 0);
      check('G2 build-editor.mjs có placeholder __RECTAREALIGHT__ + lib RectAreaLightUniformsLib',
        be.indexOf('__RECTAREALIGHT__') >= 0 && be.indexOf('RectAreaLightUniformsLib') >= 0);
      const tpl = read('src/editor/editor.template.html');
      check('G3 editor.template.html có khối __RECTAREALIGHT__',
        tpl.indexOf('__RECTAREALIGHT__') >= 0);
      const me = read('mapeditor.html');
      check('G4 mapeditor.html chứa RectAreaLightUniformsLib (đã inline, không còn placeholder)',
        me.indexOf('RectAreaLightUniformsLib') >= 0 && me.indexOf('__RECTAREALIGHT__') < 0);
      check('G5 mapeditor.html chứa module Itch (ED.Itch) + nút xuất gói itch.io',
        me.indexOf('ED.Itch') >= 0 && me.indexOf('Xuất gói itch.io') >= 0);
      check('G6 mapeditor.html chứa code đợt 5 (crateStep, LOD, fog layers)',
        me.indexOf('crateStep') >= 0 && me.indexOf('updateLod') >= 0 && me.indexOf('fogLayers') >= 0);
      const boot = read('src/editor/99-boot.js');
      check('G7 99-boot.js gọi _callInit(\'Itch\')',
        boot.indexOf("_callInit('Itch')") >= 0);
      const vp = read('src/editor/01-viewport.js');
      check('G8 01-viewport.js gọi ED.Terrain.updateLod trong render loop + LOD vào perf',
        vp.indexOf('updateLod') >= 0 && vp.indexOf('lod:') >= 0);
      const ui = read('src/editor/02-ui.js');
      check('G9 02-ui.js setPerf hiển thị LOD',
        ui.indexOf('LOD') >= 0);
      const env = read('src/editor/05-environment.js');
      check('G10 05-environment.js applyPreset gọi ED.Export.applyPresetMusic (guard typeof)',
        env.indexOf('applyPresetMusic') >= 0);
      const play = read('src/editor/09-play.js');
      check('G11 09-play.js nối crateStep + _crateSupportList + LITE_LABEL',
        play.indexOf('crateStep') >= 0 && play.indexOf('_crateSupportList') >= 0 && play.indexOf('LITE_LABEL') >= 0);
      check('G12 09-play.js nối utility flee (pickBehavior) trong _updateAggressiveNpc',
        play.indexOf('pickBehavior') >= 0 && play.indexOf("'flee'") >= 0);
      const gameHash = gitBlobHash(fs.readFileSync(path.join(root, 'mongvolam.html')));
      check('G13 mongvolam.html không đổi (hash 8792425d, đợt 5 không chạm game)',
        gameHash === '8792425df06eca92538eba790eaf4dec798a0c8c');
      const idx = fs.readFileSync(path.join(root, 'index.html'));
      const mg = fs.readFileSync(path.join(root, 'mongvolam.html'));
      check('G14 index.html byte-identical với mongvolam.html',
        idx.equals(mg));
      const lib = read('lib/RectAreaLightUniformsLib.js');
      check('G15 lib/RectAreaLightUniformsLib.js là bản r128 (THREE.RectAreaLightUniformsLib, không có </script)',
        lib.indexOf('RectAreaLightUniformsLib') >= 0 && lib.indexOf('</script') < 0);
    })();
    console.log('----------------------------------------');
    console.log(pass + ' PASS, ' + skipped + ' SKIP, ' + fail + ' FAIL');
    if (fail > 0) { console.log('FAILED: ' + failedNames.join(', ')); process.exit(1); }
  }
})();
