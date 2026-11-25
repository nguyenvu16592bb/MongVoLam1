/* Kiểm thử Map Editor ĐỢT 2 (mapeditor.html) — logic thuần, không cần trình duyệt.
   - (A) Animation: keyframe, clip tự tạo (THREE stub), state machine, crossfade, root motion.
   - (B) Nav A*: lưới chặn, tìm đường tránh nước/dốc/collider, làm mượt, đi dọc đường.
   - (C) Material: preset, validate ảnh, tiling, giữ texture khi áp preset.
   - (D) Building: snap, snap mái, prefab lưu/tải lại (round-trip).
   - (E) Play: quái đánh lại, skill cooldown, quest đếm + hoàn thành, thưởng.
   - (F) Export/Terrain: validate GLB, tên file, heightmap, erosion, audio validate.
   - (G) Tích hợp: build mapeditor.html chứa đủ 5 module mới + GLTFExporter,
     hook material trong viewport, wiring nhạc Play, boot gọi đủ init.
   Module nào chưa có thì SKIP ghi rõ lý do, KHÔNG bịa pass.
   Chạy: node tools/test-mapeditor2.cjs
   In "N PASS, M SKIP, 0 FAIL" hoặc liệt kê fail; exit 1 nếu có fail. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
function loadVm(file, extra) {
  const ctx = Object.assign({ console }, extra || {});
  ctx.window = ctx.window || {};
  ctx.ED = ctx.ED || {};
  vm.createContext(ctx);
  vm.runInContext(read(file), ctx, { filename: file });
  return ctx;
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

/* ---------- THREE stub: chỉ đủ cho AnimationClip/KeyframeTrack ---------- */
function FakeTrack(name, times, values) {
  this.name = name; this.times = times; this.values = values;
}
function FakeClip(name, duration, tracks) {
  this.name = name; this.duration = duration; this.tracks = tracks;
}
const THREE_STUB = {
  NumberKeyframeTrack: FakeTrack,
  VectorKeyframeTrack: FakeTrack,
  AnimationClip: FakeClip
};

/* ================= A. Animation (11-animation.js) ================= */
console.log('--- A. Animation (11-animation.js) ---');
let A = null;
try {
  const ctx = loadVm('src/editor/11-animation.js', { THREE: THREE_STUB });
  A = ctx.ED.Animation;
  check('11-animation.js load duoc bang vm (khong can DOM)', !!A);
} catch (e) {
  check('11-animation.js load duoc bang vm (khong can DOM)', false, e && e.message);
}
if (A) {
  check('clampFade: -1->0, 3->2, 0.5 giu, NaN->0.3',
    A.clampFade(-1) === 0 && A.clampFade(3) === 2 && A.clampFade(0.5) === 0.5 && A.clampFade(NaN) === 0.3);
  check('clampSpeed: 0.1->0.25, 5->2', A.clampSpeed(0.1) === 0.25 && A.clampSpeed(5) === 2);
  const anim = A.newAnimation('anim-1', 'Chạy thử', 'object', 'obj-3');
  check('newAnimation: du field, tracks rong, duration > 0',
    anim && anim.id === 'anim-1' && anim.targetType === 'object' && anim.targetId === 'obj-3' &&
    Array.isArray(anim.tracks) && anim.tracks.length === 0 && anim.duration > 0);
  A.addKey(anim, 'pos.x', 2, 10);
  A.addKey(anim, 'pos.x', 0, 0);
  A.addKey(anim, 'pos.x', 1, 5);
  const tr = A.findTrack(anim, 'pos.x');
  check('addKey chen dung thu tu thoi gian [0,1,2]',
    tr && tr.keys.map(k => k.t).join(',') === '0,1,2');
  A.addKey(anim, 'pos.x', 1, 7);
  check('addKey trung thoi gian thi ghi de (1 -> 7, van 3 key)',
    tr.keys.length === 3 && tr.keys[1].v === 7);
  check('addKey keo dai duration khi key nam ngoai',
    anim.duration >= 2);
  check('sampleTrack noi suy tuyen tinh (0->0, 1->7, tai 0.5 -> 3.5)',
    A.sampleTrack(tr, 0.5) === 3.5);
  check('sampleTrack ngoai khoang giu gia tri dau/cuoi',
    A.sampleTrack(tr, -1) === 0 && A.sampleTrack(tr, 99) === 10);
  check('sampleTrack track rong -> null',
    A.sampleTrack({ prop: 'pos.x', keys: [] }, 1) === null);
  check('removeKey dung -> true, sai -> false',
    A.removeKey(anim, 'pos.x', 1) === true && A.removeKey(anim, 'pos.x', 1) === false &&
    tr.keys.length === 2);
  A.addKey(anim, 'pos.x', 1, 5);
  const data = A.buildClipData(anim);
  check('buildClipData: node=targetId, property=position[x], times/values dung',
    data.tracks.length === 1 && data.tracks[0].node === 'obj-3' &&
    data.tracks[0].property === 'position[x]' &&
    data.tracks[0].times.join(',') === '0,1,2' && data.tracks[0].values.join(',') === '0,5,10');
  const clip = A.createClip(anim);
  check('createClip (THREE stub): clip dung ten, 1 track, ten track day du',
    clip && clip.name === 'Chạy thử' && clip.tracks.length === 1 &&
    clip.tracks[0].name === 'obj-3.position[x]');
  check('createClip prop sai -> track do bi loai',
    A.buildClipData({ name: 'X', duration: 2, targetId: 'o', tracks: [{ prop: 'foo.x', keys: [{ t: 0, v: 1 }] }] }).tracks.length === 0);
  check('setDuration kep 0.5-60 (100->60, 0.1->0.5)',
    A.setDuration(anim, 100) === 60 && A.setDuration(anim, 0.1) === 0.5);
  check('validateAnim dung -> ok, {} -> khong ok',
    A.validateAnim(anim).ok === true && A.validateAnim({}).ok === false);

  const m = A.newStateMachine('char-1');
  check('newStateMachine: current Idle, 9 transition mac dinh',
    m.current === 'Idle' && m.transitions.length === 9);
  check('evalTransition Idle + moving -> Walk',
    A.evalTransition(m, 'Idle', { moving: true }) === 'Walk');
  check('evalTransition Idle + hp 0 -> Death',
    A.evalTransition(m, 'Idle', { hp: 0 }) === 'Death');
  check('evalTransition Idle + khong dieu kien -> null',
    A.evalTransition(m, 'Idle', {}) === null);
  check('evalTransition Walk + idle -> Idle',
    A.evalTransition(m, 'Walk', { idle: true }) === 'Idle');
  check('evalTransition Walk + moving -> Run (khong phai Walk)',
    A.evalTransition(m, 'Walk', { moving: true }) === 'Run');
  check('addTransition trung -> ok=false',
    A.addTransition(m, 'Idle', 'Walk', 'moving').ok === false);
  check('addTransition state khong ton tai -> ok=false',
    A.addTransition(m, 'Idle', 'Bay', 'moving').ok === false);
  check('addTransition moi (Idle->Skill, key) -> ok, eval dung',
    A.addTransition(m, 'Idle', 'Skill', 'key').ok === true &&
    A.evalTransition(m, 'Idle', { key: true }) === 'Skill');
  check('setStateClip/resolveStateClip luu + doc duoc clip cua state',
    A.setStateClip(m, 'Walk', 'anim:anim-1') === true &&
    A.resolveStateClip(m, 'Walk') === 'anim:anim-1' &&
    A.resolveStateClip(m, 'Idle') === null);
  check('addState/removeState them + xoa + don transition lien quan',
    A.addState(m, 'Nhảy') === true && A.addState(m, 'Nhảy') === false &&
    A.removeState(m, 'Nhảy') === true && m.states.indexOf('Nhảy') < 0);

  const boneAnim = A.newAnimation('anim-2', 'Hips', 'bone', 'mixamorig:Hips');
  A.addKey(boneAnim, 'pos.x', 0, 0);
  A.addKey(boneAnim, 'pos.x', 1, 2);
  A.addKey(boneAnim, 'pos.z', 0, 1);
  A.addKey(boneAnim, 'pos.z', 1, 4);
  const hd = A.hipsDelta(boneAnim, 0, 1);
  check('hipsDelta bone: dx=2, dz=3',
    hd && hd.dx === 2 && hd.dz === 3);
  check('hipsDelta object (khong phai bone) -> 0,0',
    A.hipsDelta(anim, 0, 1).dx === 0 && A.hipsDelta(anim, 0, 1).dz === 0);
  check('ensureAnimations: project cu khong co field van mo duoc',
    (function () {
      const p = { version: 1, objects: [] };
      const arr = A.ensureAnimations(p);
      return Array.isArray(arr) && Array.isArray(p.animations);
    })());
}
try {
  const ctx2 = loadVm('src/editor/11-animation.js', {});
  const A2 = ctx2.ED.Animation;
  check('createClip khong co THREE -> null, khong throw',
    A2.createClip({ name: 'X', duration: 2, targetId: 'o', tracks: [{ prop: 'pos.x', keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }] }) === null);
} catch (e) {
  check('createClip khong co THREE -> null, khong throw', false, e && e.message);
}

/* ================= B. Nav A* (12-nav.js) ================= */
console.log('--- B. Nav A* (12-nav.js) ---');
let N = null;
try {
  const ctx = loadVm('src/editor/12-nav.js', {});
  N = ctx.ED.Nav;
  check('12-nav.js load duoc bang vm (khong can DOM/THREE)', !!N);
} catch (e) {
  check('12-nav.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (N) {
  const SEG = 64, SIZE = 96, SIDE = SEG + 1, COUNT = SIDE * SIDE;
  const flatH = new Array(COUNT).fill(0);
  const flatP = new Array(COUNT).fill(0);
  const idx = (gx, gz) => gz * SIDE + gx;
  const blocked0 = N.buildBlocked(flatH, flatP, [], SEG, SIZE);
  check('buildBlocked map phang: 4225 o, khong o nao chan',
    blocked0.length === COUNT && blocked0.every(b => b === false));
  const paintsW = flatP.slice();
  paintsW[idx(32, 32)] = 4;
  const blockedW = N.buildBlocked(flatH, paintsW, [], SEG, SIZE);
  check('buildBlocked: o nuoc (paint 4) bi chan, o ben canh khong',
    blockedW[idx(32, 32)] === true && blockedW[idx(33, 32)] === false);
  const blockedH = N.buildBlocked(flatH, flatP, [{ type: 'house', pos: [0, 0, 0], scale: [2, 2, 2], rot: [0, 0, 0] }], SEG, SIZE);
  check('buildBlocked: nha o (0,0) chan o giua, goc map thoang',
    blockedH[idx(32, 32)] === true && blockedH[idx(0, 0)] === false);
  const blockedC = N.buildBlocked(flatH, flatP, [{ type: 'collider', pos: [0, 0, 0], scale: [3, 1, 3], rot: [0, 0, 0], extra: { shape: 'box' } }], SEG, SIZE);
  check('buildBlocked: collider box chan tam',
    blockedC[idx(32, 32)] === true);
  const blockedT = N.buildBlocked(flatH, flatP, [{ type: 'collider', pos: [0, 0, 0], scale: [3, 1, 3], rot: [0, 0, 0], extra: { shape: 'box', trigger: true } }], SEG, SIZE);
  check('buildBlocked: collider trigger KHONG chan',
    blockedT[idx(32, 32)] === false);
  const blockedS = N.buildBlocked(flatH, flatP, [{ type: 'collider', pos: [0, 0, 0], scale: [4, 1, 4], rot: [0, 0, 0], extra: { shape: 'sphere' } }], SEG, SIZE);
  check('buildBlocked: collider sphere chan tam',
    blockedS[idx(32, 32)] === true);
  const p1 = N.findPathGrid(blocked0, flatH, SEG, 5, 5, 59, 59);
  check('findPathGrid map phang: co duong, dau/cuoi dung, moi o deu di duoc',
    Array.isArray(p1) && p1.length > 0 && p1[0][0] === 5 && p1[0][1] === 5 &&
    p1[p1.length - 1][0] === 59 && p1[p1.length - 1][1] === 59 &&
    p1.every(c => blocked0[idx(c[0], c[1])] === false));
  const paintsWall = flatP.slice();
  for (let gz = 0; gz <= SEG; gz++) paintsWall[idx(32, gz)] = 4;
  const blockedWall = N.buildBlocked(flatH, paintsWall, [], SEG, SIZE);
  check('findPathGrid: buc tuong nuoc chan ngang map -> null',
    N.findPathGrid(blockedWall, flatH, SEG, 5, 32, 59, 32) === null);
  const heightsRidge = flatH.slice();
  for (let gz = 0; gz <= SEG; gz++) heightsRidge[idx(32, gz)] = 5;
  check('findPathGrid: song doc cao 5 (chenh > 1.2) chan ngang map -> null',
    N.findPathGrid(blocked0, heightsRidge, SEG, 5, 32, 59, 32) === null);
  const sm = N.smoothPath([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]);
  check('smoothPath bo diem thang hang: 5 -> 3 diem',
    sm.length === 3 && sm[0][0] === 0 && sm[1][0] === 2 && sm[2][1] === 2);
  const s1 = N.stepAlong([[0, 0], [3, 0], [6, 0]], [0, 0], 3, 1);
  check('stepAlong buoc 1: toi (3,0), chua toi dich',
    s1 && s1.pos[0] === 3 && s1.pos[1] === 0 && s1.arrived === false);
  const s2 = N.stepAlong(s1.path, s1.pos, 3, 1);
  check('stepAlong buoc 2: toi (6,0), arrived=true',
    s2 && s2.pos[0] === 6 && s2.arrived === true);
  check('nearestWalkable: o bi chan tim duoc o thoang gan nhat',
    (function () {
      const b = N.buildBlocked(flatH, paintsW, [], SEG, SIZE);
      const w = N.nearestWalkable(b, SEG, 32, 32, 3);
      return Array.isArray(w) && b[idx(w[0], w[1])] === false;
    })());
  check('worldToGrid/gridToWorld doi nhau (0,0) <-> (32,32)',
    (function () {
      const g = N.worldToGrid(0, 0, SEG, SIZE);
      const w = N.gridToWorld(32, 32, SEG, SIZE);
      return Math.round(g.gx) === 32 && Math.round(g.gz) === 32 && w.x === 0 && w.z === 0;
    })());
}

/* ================= C. Material (13-material.js) ================= */
console.log('--- C. Material (13-material.js) ---');
let M = null;
try {
  const ctx = loadVm('src/editor/13-material.js', {});
  M = ctx.ED.Material;
  check('13-material.js load duoc bang vm (khong can DOM/THREE)', !!M);
} catch (e) {
  check('13-material.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (M) {
  check('preset go: mau #8a6a42, nham 0.85, kim loai 0',
    (function () { const p = M.edMatPreset('go'); return p && p.color === '#8a6a42' && p.roughness === 0.85 && p.metalness === 0; })());
  check('preset vang: kim loai 0.85, emissiveIntensity 0.2',
    (function () { const p = M.edMatPreset('vang'); return p && p.metalness === 0.85 && p.emissiveIntensity === 0.2; })());
  check('preset ngoc: nham 0.25, emissiveIntensity 0.35',
    (function () { const p = M.edMatPreset('ngoc'); return p && p.roughness === 0.25 && p.emissiveIntensity === 0.35; })());
  check('preset da/vai/ngoi dung gia tri, ten la -> null',
    M.edMatPreset('da').color === '#8b9793' && M.edMatPreset('vai').roughness === 1 &&
    M.edMatPreset('ngoi').color === '#7f1d1d' && M.edMatPreset('khong-co') === null);
  check('preset tra ban sao (doi ban tra khong ban bang goc)',
    (function () {
      const a = M.edMatPreset('go'); a.color = '#000000';
      return M.edMatPreset('go').color === '#8a6a42';
    })());
  check('validateTextureFile: png 100B ok, txt khong ok, 6MB khong ok, rong khong ok',
    M.validateTextureFile({ name: 'a.png', type: 'image/png', size: 100 }).ok === true &&
    M.validateTextureFile({ name: 'a.txt', type: 'text/plain', size: 100 }).ok === false &&
    M.validateTextureFile({ name: 'a.png', type: 'image/png', size: 6 * 1024 * 1024 }).ok === false &&
    M.validateTextureFile({ name: 'a.png', type: 'image/png', size: 0 }).ok === false);
  check('clampRepeat: 0->0.1, 99->10, 2 giu; clampOffset: -1->0, 2->1',
    M.clampRepeat(0) === 0.1 && M.clampRepeat(99) === 10 && M.clampRepeat(2) === 2 &&
    M.clampOffset(-1) === 0 && M.clampOffset(2) === 1);
  check('normalizeMaterial(null): mac dinh nham 0.8, kim loai 0, repeat 1x1',
    (function () {
      const m = M.normalizeMaterial(null);
      return m.roughness === 0.8 && m.metalness === 0 && m.opacity === 1 &&
        m.repeat[0] === 1 && m.repeat[1] === 1 && m.offset[0] === 0;
    })());
  check('applyPresetToObject: doi mau + nham, GIU texture/repeat/offset cu',
    (function () {
      const obj = { color: '#000000', material: { map: 'tex:1', repeat: [2, 2], offset: [0.5, 0], roughness: 0.5 } };
      const ok = M.applyPresetToObject(obj, 'da');
      return ok === true && obj.color === '#8b9793' && obj.material.roughness === 0.95 &&
        obj.material.map === 'tex:1' && obj.material.repeat[0] === 2 && obj.material.offset[0] === 0.5;
    })());
  check('applyPresetToObject ten la -> false, khong doi obj',
    (function () {
      const obj = { color: '#111111', material: { roughness: 0.5 } };
      return M.applyPresetToObject(obj, 'khong-co') === false && obj.color === '#111111';
    })());
  check('setTextureSlot + setTiling: gan khe map, kep repeat/offset',
    (function () {
      const obj = { material: {} };
      M.setTextureSlot(obj, 'map', 'tex:9');
      M.setTiling(obj, 20, 0, 2, -1);
      return obj.material.map === 'tex:9' && obj.material.repeat[0] === 10 &&
        obj.material.repeat[1] === 0.1 && obj.material.offset[0] === 1 && obj.material.offset[1] === 0;
    })());
  check('textureKey: tex:<id> dung dinh dang',
    M.textureKey('abc') === 'tex:abc');
}

/* ================= D. Building (14-building.js) ================= */
console.log('--- D. Building (14-building.js) ---');
let B = null;
try {
  const ctx = loadVm('src/editor/14-building.js', {});
  B = ctx.ED.Building;
  check('14-building.js load duoc bang vm (khong can DOM/THREE)', !!B);
} catch (e) {
  check('14-building.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (B) {
  check('edBuildSnap: 1.26->1.5, 1.24->1.0, -0.1->0 (khong -0)',
    B.edBuildSnap(1.26) === 1.5 && B.edBuildSnap(1.24) === 1.0 && B.edBuildSnap(-0.1) === 0);
  check('isPartType/isRoofType: wall la part, house khong; roof-curved la mai, wall khong',
    B.isPartType('wall') === true && B.isPartType('house') === false &&
    B.isRoofType('roof-curved') === true && B.isRoofType('wall') === false);
  check('wallTopY: y chan 1 + cao 2.4 x scale.y 2 = 5.8',
    B.wallTopY({ pos: [0, 1, 0], scale: [1, 2, 1] }) === 5.8);
  check('roofSnapY: co tuong gan -> 2.5 (dinh 2.4 snap 0.5), khong tuong -> 0',
    B.roofSnapY([{ type: 'wall', pos: [0, 0, 0], scale: [1, 1, 1] }], 0, 0) === 2.5 &&
    B.roofSnapY([], 0, 0) === 0);
  check('groundYFor: cao do dat 3 -> 2.95 (chim 0.05), khong co ham -> 0',
    B.groundYFor(0, 0, function () { return 3; }) === 2.95 && B.groundYFor(0, 0, null) === 0);
  check('buildingCenter: trung binh x/z, y = thap nhat',
    (function () {
      const c = B.buildingCenter([{ pos: [0, 0, 0] }, { pos: [3, 2, 0] }]);
      return c.x === 1.5 && c.y === 0 && c.z === 0;
    })());
  check('prefab round-trip: luu tuong doi -> dat lai dung vi tri cu',
    (function () {
      const objs = [
        { type: 'wall', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: '#d8d1c2' },
        { type: 'wall', pos: [3, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: '#d8d1c2' }
      ];
      const center = B.buildingCenter(objs);
      const parts = B.partsToPrefabParts(objs, center);
      if (parts[0].pos[0] !== -1.5 || parts[1].pos[0] !== 1.5) return false;
      const defs = B.prefabToDefs({ parts: parts }, 10, 20, 0);
      return defs.length === 2 && defs[0].pos[0] === 8.5 && defs[1].pos[0] === 11.5 &&
        defs[0].pos[2] === 20 && defs[0].type === 'wall';
    })());
  check('ensureLists: project cu khong co buildings/prefabs van mo duoc',
    (function () {
      const p = {};
      B.ensureLists(p);
      return Array.isArray(p.buildings) && Array.isArray(p.prefabs);
    })());
  check('PART_TYPES co du 10 part (mai cong/thang/thap, tuong, cua so, cua, cau thang, ban cong, cot)',
    Array.isArray(B.PART_TYPES) && B.PART_TYPES.indexOf('roof-curved') >= 0 &&
    B.PART_TYPES.indexOf('roof-tower') >= 0 && B.PART_TYPES.indexOf('wall') >= 0 &&
    B.PART_TYPES.indexOf('door') >= 0 && B.PART_TYPES.indexOf('stairs') >= 0 &&
    B.PART_TYPES.indexOf('balcony') >= 0 && B.PART_TYPES.length >= 10);
}

/* ================= E. Play (09-play.js) ================= */
console.log('--- E. Play (09-play.js) ---');
let P = null;
try {
  const ctx = loadVm('src/editor/09-play.js', {});
  P = ctx.ED.Play;
  check('09-play.js load duoc bang vm (khong can DOM/THREE)', !!P);
} catch (e) {
  check('09-play.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (P) {
  check('damageCalc: 10-3=7, 2-5 kep toi thieu 1',
    P.damageCalc(10, 3) === 7 && P.damageCalc(2, 5) === 1);
  check('applyDamage: 10-3=7 song, 2-5 chet',
    (function () {
      const a = P.applyDamage(10, 3);
      const b = P.applyDamage(2, 5);
      return a.hp === 7 && a.dead === false && b.hp === 0 && b.dead === true;
    })());
  check('monsterAttack lan dau: atk 12 - def 2 = 10 dmg, HP 100->90',
    (function () {
      const r = P.monsterAttack({ atk: 12, def: 2 }, 100, 0, null, 1.2);
      return r.attacked === true && r.damage === 10 && r.heroHp === 90 && r.lastAttackAt === 0;
    })());
  check('monsterAttack trong cooldown (500ms < 1.2s) thi khong danh',
    (function () {
      const r = P.monsterAttack({ atk: 12, def: 2 }, 90, 500, 0, 1.2);
      return r.attacked === false && r.heroHp === 90 && r.damage === 0;
    })());
  check('monsterAttack het cooldown (1300ms) thi danh lai, HP 90->80',
    (function () {
      const r = P.monsterAttack({ atk: 12, def: 2 }, 90, 1300, 0, 1.2);
      return r.attacked === true && r.heroHp === 80;
    })());
  check('monsterAttack mac dinh atk 10, damage toi thieu 1',
    (function () {
      const r = P.monsterAttack({}, 50, 0, null, 1.2);
      return r.damage === 10 && r.heroHp === 40;
    })());
  check('skillReady: chua dung -> san sang; moi dung 1s (cd 3s) -> remain 2; du 3s -> san sang',
    (function () {
      const a = P.skillReady(null, 3, 1000);
      const b = P.skillReady(0, 3, 1000);
      const c = P.skillReady(0, 3, 3000);
      return a.ready === true && a.remain === 0 && b.ready === false && b.remain === 2 &&
        c.ready === true;
    })());
  check('normalizeSkills: khong co skill -> 4 mac dinh dung ten/thu tu',
    (function () {
      const s = P.normalizeSkills(null);
      return s.length === 4 && s[0].name === 'Kiếm Khí' && s[1].name === 'Hỏa Cầu' &&
        s[2].name === 'Hồi Máu' && s[3].name === 'Sét Đánh';
    })());
  check('normalizeSkills: skill la chuan hoa (cd 0->3, fx la->fire, damage am->0)',
    (function () {
      const s = P.normalizeSkills([{ name: 'X', cooldown: 0, fxType: 'bogus', damage: -5 }]);
      return s[0].cooldown === 3 && s[0].fxType === 'fire' && s[0].damage === 0;
    })());
  check('skillApply hoi mau: HP 50->80 (heal 30), applied=true, co FX heal',
    (function () {
      const sk = P.normalizeSkills([{ name: 'Hồi Máu', cooldown: 8, fxType: 'heal', damage: 0, range: 0, heal: 30 }])[0];
      const r = P.skillApply(sk, [0, 0], 50, 100, []);
      return r.applied === true && r.heroHp === 80 && r.fx && r.fx.fxType === 'heal';
    })());
  check('skillApply hoi mau khong vuot max HP (90+30 kep 100)',
    (function () {
      const sk = P.normalizeSkills([{ name: 'Hồi Máu', cooldown: 8, fxType: 'heal', damage: 0, range: 0, heal: 30 }])[0];
      return P.skillApply(sk, [0, 0], 90, 100, []).heroHp === 100;
    })());
  check('skillApply sat thuong: danh quai gan nhat trong tam, HP 50->25',
    (function () {
      const sk = P.normalizeSkills(null)[0];
      const r = P.skillApply(sk, [0, 0], 100, 100, [{ id: 'm1', pos: [3, 0], hp: 50 }]);
      return r.applied === true && r.hits.length === 1 && r.hits[0].hp === 25 && r.hits[0].dead === false;
    })());
  check('skillApply khong co quai trong tam -> applied=false',
    (function () {
      const sk = P.normalizeSkills(null)[0];
      const r = P.skillApply(sk, [0, 0], 100, 100, [{ id: 'm1', pos: [20, 0], hp: 50 }]);
      return r.applied === false && r.hits.length === 0;
    })());
  check('goldDrop: level 1 -> 15 vang, level 5 -> 35 vang',
    P.goldDrop({ level: 1 }) === 15 && P.goldDrop({ level: 5 }) === 35);
  check('monsterMatches: "quai" khop "Quai rung", "boss" khong khop',
    P.monsterMatches('quái', { name: 'Quái rừng' }) === true &&
    P.monsterMatches('boss', { name: 'Quái rừng' }) === false &&
    P.monsterMatches('', { name: 'Quái rừng' }) === true);
  check('parseQuestTarget dang object: kill count 3',
    (function () {
      const t = P.parseQuestTarget({ type: 'kill', count: 3 }, null);
      return t && t.type === 'kill' && t.count === 3;
    })());
  check('parseQuestTarget dang chuoi cu: "Giết 5 Quái" -> kill count 5',
    (function () {
      const t = P.parseQuestTarget('Giết 5 Quái', null);
      return t && t.type === 'kill' && t.count === 5;
    })());
  check('normalizeQuest khong co target dem duoc -> null',
    P.normalizeQuest({ id: 'q0', target: '', type: 'Chính' }) === null);
  check('questReward: co gold 50 thi 50, khong co thi mac dinh 100 vang',
    P.questReward({ reward: { gold: 50 } }).gold === 50 &&
    P.questReward({}).gold === 100);
  check('questProgress: giet dung loai dem 1/2 roi 2/2 hoan thanh',
    (function () {
      const tgt = { type: 'kill', count: 2, monsterType: null, npcId: null, item: null };
      const s0 = { progress: 0, completed: false };
      const r1 = P.questProgress(s0, tgt, { kind: 'kill' });
      const r2 = P.questProgress(r1, tgt, { kind: 'kill' });
      const r3 = P.questProgress(r2, tgt, { kind: 'kill' });
      return r1.progress === 1 && r1.completed === false &&
        r2.progress === 2 && r2.completed === true && r2.justCompleted === true &&
        r3.progress === 2 && r3.justCompleted === false;
    })());
  check('questProgress: sai loai su kien (talk cho quest kill) thi khong dem',
    (function () {
      const tgt = { type: 'kill', count: 2, monsterType: null, npcId: null, item: null };
      const r = P.questProgress({ progress: 0, completed: false }, tgt, { kind: 'talk' });
      return r.progress === 0 && r.completed === false;
    })());
  check('questLabel: "Ten quest: 2/5" va "Ten: ✓ Xong"',
    (function () {
      const q = P.normalizeQuest({ id: 'q1', name: 'Giết quái', target: { type: 'kill', count: 5 } });
      return P.questLabel(q, 2, false) === 'Giết quái: 2/5' &&
        P.questLabel(q, 5, true) === 'Giết quái: ✓ Xong';
    })());
}

/* ================= F. Export / Terrain (15-export.js + 04-terrain.js) ================= */
console.log('--- F. Export / Terrain (15-export.js + 04-terrain.js) ---');
let E = null;
try {
  const ctx = loadVm('src/editor/15-export.js', {});
  E = ctx.ED.Export;
  check('15-export.js load duoc bang vm (khong can DOM/THREE)', !!E);
} catch (e) {
  check('15-export.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
/* makeGLB tra ve Array thuong (khong phai Buffer): ham trong vm dung
   Uint8Array cua realm vm, Buffer cua Node bi instanceof sai realm.
   actualLength: do dai that cua mang; length: gia tri ghi trong header. */
function makeGLB(version, length, magic, actualLength) {
  const total = Math.max(12, actualLength || length || 12);
  const arr = new Array(total).fill(0);
  const mg = (magic || 'glTF').split('').map(c => c.charCodeAt(0));
  for (let i = 0; i < 4; i++) arr[i] = mg[i];
  const v = version == null ? 2 : version;
  arr[4] = v & 0xff; arr[5] = (v >> 8) & 0xff; arr[6] = (v >> 16) & 0xff; arr[7] = (v >> 24) & 0xff;
  const ln = length == null ? total : length;
  arr[8] = ln & 0xff; arr[9] = (ln >> 8) & 0xff; arr[10] = (ln >> 16) & 0xff; arr[11] = (ln >> 24) & 0xff;
  return arr;
}
if (E) {
  check('validateGLB: header dung (magic glTF, version 2, length khop) -> ok',
    (function () {
      const r = E.edExportValidateGLB(makeGLB(2, 20));
      return r.ok === true && r.version === 2 && r.length === 20;
    })());
  check('validateGLB: sai magic -> khong ok',
    E.edExportValidateGLB(makeGLB(2, 20, 'xxxx')).ok === false);
  check('validateGLB: version 1 -> khong ok, bao dung version 1',
    (function () {
      const r = E.edExportValidateGLB(makeGLB(1, 20));
      return r.ok === false && r.version === 1;
    })());
  check('validateGLB: file qua ngan (<12 byte) -> khong ok',
    E.edExportValidateGLB([0x67, 0x6c, 0x54, 0x46, 2]).ok === false);
  check('validateGLB: length header (99) khac do dai that (20) -> khong ok',
    E.edExportValidateGLB(makeGLB(2, 99, 'glTF', 20)).ok === false);
  check('fileName: ten thuong + .glb, ky tu cam doi thanh -, rong -> map-editor.glb',
    E.edExportFileName('Biện Kinh Thành') === 'Biện Kinh Thành.glb' &&
    E.edExportFileName('a/b:c') === 'a-b-c.glb' &&
    E.edExportFileName('') === 'map-editor.glb');
  check('validateAudioFile: mp3 ok, txt khong ok, 11MB khong ok',
    E.edExportValidateAudioFile({ name: 'nhac.mp3', size: 1000 }).ok === true &&
    E.edExportValidateAudioFile({ name: 'nhac.txt', size: 1000 }).ok === false &&
    E.edExportValidateAudioFile({ name: 'nhac.mp3', size: 11 * 1024 * 1024 }).ok === false);
  check('getAmbientKey: chua co nhac -> null; key slot AUDIO_KEY = audio:ambient',
    E.getAmbientKey() === null && E.AUDIO_KEY === 'audio:ambient' &&
    E.edExportAudioKey('ambient') === 'audio:ambient');
  check('isGLBReady: khong co THREE.GLTFExporter trong vm -> false',
    E.isGLBReady() === false);
}
let T = null;
try {
  const ctx = loadVm('src/editor/04-terrain.js', {});
  T = ctx.ED.Terrain;
  check('04-terrain.js load duoc bang vm (khong can DOM/THREE)', !!T);
} catch (e) {
  check('04-terrain.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (T) {
  check('heightsFromPixels: anh xam 2x2 -> 4 goc dung (0 / 8 / 8 / 0, maxHeight 8)',
    (function () {
      const h = T.edTerrainHeightsFromPixels([0, 255, 255, 0], 2, 2, 2, 8);
      return h.length === 9 && h[0] === 0 && h[2] === 8 && h[6] === 8 && h[8] === 0;
    })());
  check('heightsFromPixels: RGBA lay kenh R',
    (function () {
      const px = [255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255];
      const h = T.edTerrainHeightsFromPixels(px, 2, 2, 2, 4);
      return h[0] === 4 && h[2] === 0;
    })());
  check('heightsFromPixels: input rong -> toan 0, khong throw',
    (function () {
      const h = T.edTerrainHeightsFromPixels([], 0, 0, 2, 8);
      return h.length === 9 && h.every(v => v === 0);
    })());
  check('erode: mat phang khong doi',
    (function () {
      const h = new Array(9).fill(1);
      const out = T.edTerrainErode(h, 2, 5, 0.6, 0.25);
      return out.every(v => v === 1);
    })());
  check('erode: dinh nhon 5 ha xuong, hang xom tang, tong bao toan (=5)',
    (function () {
      const h = [0, 0, 0, 0, 5, 0, 0, 0, 0];
      const out = T.edTerrainErode(h, 2, 1, 0.6, 0.25);
      const sum = out.reduce((a, b) => a + b, 0);
      return approx(out[4], 0.6, 1e-9) && approx(sum, 5, 1e-9) && out[1] > 0 && out[3] > 0;
    })());
  check('erode: 0 luot thi khong doi',
    (function () {
      const h = [0, 0, 0, 0, 5, 0, 0, 0, 0];
      const out = T.edTerrainErode(h, 2, 0, 0.6, 0.25);
      return out[4] === 5;
    })());
  check('setHeightmapMax/setErodeIterations kep dung (0->1, 25->20, 99->20)',
    T.setHeightmapMax(0) === 1 && T.setHeightmapMax(25) === 20 &&
    T.setHeightmapMax(8) === 8 && T.setErodeIterations(0) === 1 &&
    T.setErodeIterations(99) === 20);
}

/* ================= G. Tích hợp build ================= */
console.log('--- G. Tich hop build ---');
check('mapeditor.html ton tai, chua 5 module moi (Animation/Nav/Material/Building/Export)',
  exists('mapeditor.html') &&
  read('mapeditor.html').indexOf('ED.Animation') >= 0 &&
  read('mapeditor.html').indexOf('ED.Nav') >= 0 &&
  read('mapeditor.html').indexOf('ED.Material') >= 0 &&
  read('mapeditor.html').indexOf('ED.Building') >= 0 &&
  read('mapeditor.html').indexOf('ED.Export') >= 0);
check('mapeditor.html chua THREE.GLTFExporter (export GLB that)',
  read('mapeditor.html').indexOf('THREE.GLTFExporter') >= 0);
check('mapeditor.html khong con placeholder template cua EDITOR sot',
  (function () {
    const html = read('mapeditor.html');
    /* Luu y: __THREE__/__FFLATE__/__FBXLOADER__/__STYLE__/__PIXI__/__GAME__
       van xuat hien hop le trong 10-game-link.js (mang needPh + ham rep
       cua bo build HTML game trong trinh duyet) va __THREE_DEVTOOLS__ cua
       three.min.js — chi kiem placeholder cua template editor. */
    return ['__GLTFEXPORTER__', '__EDITOR_JS__', '__EDITOR_STYLE__', '__GLTFLOADER__', '__OBJLOADER__']
      .every(ph => html.indexOf(ph) < 0);
  })());
check('lib/GLTFExporter.js ton tai, la ban non-module (THREE.GLTFExporter)',
  exists('lib/GLTFExporter.js') && read('lib/GLTFExporter.js').indexOf('THREE.GLTFExporter') >= 0);
check('01-viewport.js co hook ED.Material.applyToMesh (syncObject + import)',
  (function () {
    const n = (read('src/editor/01-viewport.js').match(/ED\.Material\.applyToMesh/g) || []).length;
    return n >= 2;
  })());
check('09-play.js co wiring nhac ambient (playAmbient khi start, stopAmbient khi stop)',
  read('src/editor/09-play.js').indexOf('ED.Export.playAmbient') >= 0 &&
  read('src/editor/09-play.js').indexOf('ED.Export.stopAmbient') >= 0);
check('99-boot.js goi init du 5 module moi',
  (function () {
    const s = read('src/editor/99-boot.js');
    return ['Animation', 'Building', 'Nav', 'Material', 'Export']
      .every(m => s.indexOf("_callInit('" + m + "')") >= 0);
  })());
check('tools/build-editor.mjs co du 5 file moi + placeholder __GLTFEXPORTER__',
  (function () {
    const s = read('tools/build-editor.mjs');
    return ['11-animation.js', '12-nav.js', '13-material.js', '14-building.js', '15-export.js', '__GLTFEXPORTER__']
      .every(x => s.indexOf(x) >= 0);
  })());
check('mongvolam.html khong chua code dot 2 (game khong doi)',
  read('mongvolam.html').indexOf('ED.Animation') < 0 &&
  read('mongvolam.html').indexOf('ED.Nav') < 0);

/* ================= Tổng kết ================= */
console.log('----------------------------------------');
console.log(pass + ' PASS, ' + skipped + ' SKIP, ' + fail + ' FAIL');
if (fail > 0) {
  console.log('FAILED: ' + failedNames.join(' | '));
  process.exit(1);
}
