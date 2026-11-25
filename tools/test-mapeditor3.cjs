/* Kiểm thử Map Editor ĐỢT 3 (mapeditor.html) — logic thuần, không cần trình duyệt.
   - (A) Skeleton (07-character.js): IK 2 xương, bone weight, constraint xoay.
   - (B) Nodes (16-nodes.js): state machine / AI / quest chain trên project giả.
   - (C) Timeline (11-animation.js): snap lưới, kéo keyframe, copy/paste, track scale.
   - (D) Physics (17-physics.js): trọng lực, nhảy, capsule-vs-box, thùng đẩy, prop rơi.
   - (E) Environment (05-environment.js + 01-viewport.js): shadow/water/fog, shader nước.
   - (F) Export + Audio (15-export.js): tên file .gltf/.bin/.png, validate glTF,
     PNG data URL, SFX synthParams, playlist vòng lại, settings localStorage.
   - (G) Tích hợp: build mapeditor.html chứa đủ 2 module mới + THREE.Reflector,
     boot gọi init Nodes, game mongvolam.html không dính code editor.
   Module/API nào không tồn tại thật trong code thì SKIP ghi rõ lý do, KHÔNG bịa pass.
   Chạy: node tools/build-editor.mjs && node tools/test-mapeditor3.cjs
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
function dist3(a, b) {
  return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]));
}

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

/* ================= A. Skeleton — IK / weight / constraint (07-character.js) ================= */
console.log('--- A. Skeleton (07-character.js) ---');
let Ch = null;
try {
  const ctx = loadVm('src/editor/07-character.js', {});
  Ch = ctx.ED.Character;
  check('07-character.js load duoc bang vm (khong can DOM/THREE)', !!Ch);
} catch (e) {
  check('07-character.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (Ch) {
  if (typeof Ch.solveTwoBoneIK !== 'function' || typeof Ch.boneWeightForVertex !== 'function' ||
      typeof Ch.clampRotationDeg !== 'function' || typeof Ch.defaultBoneConstraint !== 'function' ||
      typeof Ch.normalizeBoneConstraint !== 'function') {
    skip('Skeleton dot 3 (solveTwoBoneIK/boneWeightForVertex/clampRotationDeg/constraint)',
      '07-character.js thieu 1 trong cac API dot 3');
  } else {
    const ik1 = Ch.solveTwoBoneIK([0, 0, 0], 1, 1, [1, 1, 0]);
    check('IK trong tam: reachable, endPos cham target (sai so < 0.01), khuyu goc vuong',
      ik1 && ik1.reachable === true && ik1.clamped === false &&
      dist3(ik1.endPos, [1, 1, 0]) < 0.01 && approx(ik1.elbowAngle, Math.PI / 2, 0.01) &&
      approx(dist3(ik1.midPos, [0, 0, 0]), 1, 0.01), JSON.stringify(ik1));
    const ik2 = Ch.solveTwoBoneIK([0, 0, 0], 1, 1, [3, 0, 0]);
    check('IK ngoai tam: clamped, duoi thang, endPos = root + dir*(len1+len2) = [2,0,0], elbow=PI',
      ik2 && ik2.reachable === false && ik2.clamped === true &&
      dist3(ik2.endPos, [2, 0, 0]) < 0.01 && approx(ik2.elbowAngle, Math.PI, 1e-9),
      JSON.stringify(ik2));
    const ik3 = Ch.solveTwoBoneIK([0, 0, 0], 1, 1, [0, 0, 0]);
    check('IK target trung goc: endPos ve goc, elbow=0 (gap han)',
      ik3 && dist3(ik3.endPos, [0, 0, 0]) < 0.01 && ik3.elbowAngle === 0);
    check('IK len <= 0 hoac thieu target -> null',
      Ch.solveTwoBoneIK([0, 0, 0], 0, 1, [1, 0, 0]) === null &&
      Ch.solveTwoBoneIK([0, 0, 0], 1, 1, null) === null);
    check('boneWeightForVertex: xuong 2 tong 0.3+0.2=0.5, xuong 5 = 0.1, xuong 9 = 0',
      Ch.boneWeightForVertex([0, 2, 2, 5], [0.5, 0.3, 0.2, 0.1], 2) === 0.5 &&
      Ch.boneWeightForVertex([0, 2, 2, 5], [0.5, 0.3, 0.2, 0.1], 5) === 0.1 &&
      Ch.boneWeightForVertex([0, 2, 2, 5], [0.5, 0.3, 0.2, 0.1], 9) === 0);
    check('boneWeightForVertex: khong co skin array -> 0, trong so kep toi da 1',
      Ch.boneWeightForVertex(null, null, 0) === 0 &&
      Ch.boneWeightForVertex([1, 1, 1, 1], [0.5, 0.5, 0.5, 0.5], 1) === 1);
    check('defaultBoneConstraint Hips: min [-30,-45,-30], max [30,45,30]',
      (function () {
        const c = Ch.defaultBoneConstraint('mixamorig:Hips');
        return c.min.join(',') === '-30,-45,-30' && c.max.join(',') === '30,45,30';
      })());
    check('defaultBoneConstraint khuu tay (ForeArm): gập 1 truc -10..140',
      (function () {
        const c = Ch.defaultBoneConstraint('mixamorig:LeftForeArm');
        return c.min[0] === -10 && c.max[0] === 140;
      })());
    check('defaultBoneConstraint xuong la -> full +-180',
      (function () {
        const c = Ch.defaultBoneConstraint('mixamorig:KhongCo');
        return c.min.join(',') === '-180,-180,-180' && c.max.join(',') === '180,180,180';
      })());
    check('normalizeBoneConstraint: null -> full +-180; min>max thi doi cho; vuot 180 thi kep',
      (function () {
        const a = Ch.normalizeBoneConstraint(null);
        const b = Ch.normalizeBoneConstraint({ min: [10, 0, 0], max: [5, 0, 0] });
        const c = Ch.normalizeBoneConstraint({ min: [200, 0, 0], max: [300, 0, 0] });
        return a.min[0] === -180 && a.max[0] === 180 &&
          b.min[0] === 5 && b.max[0] === 10 && c.min[0] === 180 && c.max[0] === 180;
      })());
    check('clampRotationDeg tuyet doi: [100,0,-50] vao Hips -> [30,0,-30]',
      (function () {
        const r = Ch.clampRotationDeg([100, 0, -50], Ch.defaultBoneConstraint('mixamorig:Hips'));
        return r.join(',') === '30,0,-30';
      })());
    check('clampRotationDeg theo rest: rot 100, rest 10, max 30 -> rest + 30 = 40',
      (function () {
        const r = Ch.clampRotationDeg([100, 0, 0], Ch.defaultBoneConstraint('mixamorig:Hips'), [10, 0, 0]);
        return r[0] === 40 && r[1] === 0 && r[2] === 0;
      })());
    check('get/setBoneConstraint: project cu khong co boneConstraints van doc duoc mac dinh + ghi duoc',
      (function () {
        const ch = { id: 'c1', name: 'Hero' };
        const d = Ch.getBoneConstraint(ch, 'mixamorig:Hips');
        const s = Ch.setBoneConstraint(ch, 'mixamorig:Hips', { min: [-10, -10, -10], max: [10, 10, 10] });
        const g = Ch.getBoneConstraint(ch, 'mixamorig:Hips');
        return d.max[0] === 30 && s && s.max[0] === 10 && g.max[0] === 10 &&
          ch.boneConstraints && ch.boneConstraints['mixamorig:Hips'].min[0] === -10;
      })());
  }
}

/* ================= B. Nodes (16-nodes.js) ================= */
console.log('--- B. Nodes (16-nodes.js) ---');
let Nd = null;
try {
  /* Load RIÊNG (không có ED.Animation/ED.NpcAi) để test bản dự phòng thuần
     của chính 16-nodes.js; khi có Animation thì module uỷ quyền cho nó. */
  const ctx = loadVm('src/editor/16-nodes.js', {});
  Nd = ctx.ED.Nodes;
  check('16-nodes.js load duoc bang vm (khong can DOM/THREE)', !!Nd);
} catch (e) {
  check('16-nodes.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (Nd) {
  const need = ['addState', 'addTransition', 'removeTransition', 'evalTransition',
    'addAiTransition', 'evalAiTransition', 'addPrerequisite', 'questOrder', 'evalQuestAvailable'];
  const missing = need.filter(f => typeof Nd[f] !== 'function');
  if (missing.length) {
    skip('Nodes dot 3 (state/AI/quest)', '16-nodes.js thieu API: ' + missing.join(', '));
  } else {
    check('ED.Nodes.init ton tai (boot goi duoc)',
      typeof Nd.init === 'function');
    /* (a) State machine trên project giả. */
    const p1 = {};
    const m1 = Nd.getMachine(p1, 'c1');
    check('getMachine: project cu khong co stateMachines van tao duoc (Idle, 8 state, 9 transition)',
      m1 && m1.current === 'Idle' && m1.states.length === 8 && m1.transitions.length === 9 &&
      p1.stateMachines && p1.stateMachines.c1 === m1);
    check('evalTransition Idle + moving -> Walk; Idle + hp 0 -> Death; Idle + {} -> null',
      Nd.evalTransition(p1, 'c1', 'Idle', { moving: true }) === 'Walk' &&
      Nd.evalTransition(p1, 'c1', 'Idle', { hp: 0 }) === 'Death' &&
      Nd.evalTransition(p1, 'c1', 'Idle', {}) === null);
    check('addState them Nhay -> true, trung -> false',
      Nd.addState(p1, 'c1', 'Nhảy') === true && Nd.addState(p1, 'c1', 'Nhảy') === false);
    check('addTransition moi Idle->Skill (key) -> ok, eval dung',
      Nd.addTransition(p1, 'c1', 'Idle', 'Skill', 'key').ok === true &&
      Nd.evalTransition(p1, 'c1', 'Idle', { key: true }) === 'Skill');
    check('addTransition trung -> ok=false; state khong ton tai -> ok=false; tu chuyen -> ok=false',
      Nd.addTransition(p1, 'c1', 'Idle', 'Skill', 'key').ok === false &&
      Nd.addTransition(p1, 'c1', 'Idle', 'Bay', 'key').ok === false &&
      Nd.addTransition(p1, 'c1', 'Idle', 'Idle', 'key').ok === false);
    check('removeTransition (index) xoa dung noi, eval lai -> null',
      (function () {
        const mm = Nd.getMachine(p1, 'c1');
        const idx = mm.transitions.length - 1; /* noi Idle->Skill vua them */
        return Nd.removeTransition(p1, 'c1', idx) === true &&
          Nd.evalTransition(p1, 'c1', 'Idle', { key: true }) === null &&
          Nd.removeTransition(p1, 'c1', 999) === false;
      })());
    /* (b) AI behavior trên NPC giả. */
    const p2 = { npcs: [{ id: 'npc1', name: 'Lính gác', ai: 'idle', detectionRadius: 5, attackRadius: 1.5 }] };
    check('ensureAiFields: NPC cu co du 6 aiStates + aiTransitions rong',
      (function () {
        const npc = Nd.ensureAiFields(p2.npcs[0]);
        return npc.aiStates.length === 6 && Array.isArray(npc.aiTransitions) && npc.aiTransitions.length === 0;
      })());
    check('addAiTransition idle->chase (detect) -> ok; eval dich 3m -> chase, 10m -> null',
      Nd.addAiTransition(p2, 'npc1', 'idle', 'chase', 'detect').ok === true &&
      Nd.evalAiTransition(p2, 'npc1', 'idle', { enemyDist: 3 }) === 'chase' &&
      Nd.evalAiTransition(p2, 'npc1', 'idle', { enemyDist: 10 }) === null);
    check('addAiTransition trung -> ok=false; state la -> ok=false',
      Nd.addAiTransition(p2, 'npc1', 'idle', 'chase', 'detect').ok === false &&
      Nd.addAiTransition(p2, 'npc1', 'idle', 'bay', 'detect').ok === false);
    check('addAiTransition chase->attack (radius 2) -> ok; eval 1.5m -> attack, 3m -> null',
      Nd.addAiTransition(p2, 'npc1', 'chase', 'attack', { type: 'attack', radius: 2 }).ok === true &&
      Nd.evalAiTransition(p2, 'npc1', 'chase', { enemyDist: 1.5 }) === 'attack' &&
      Nd.evalAiTransition(p2, 'npc1', 'chase', { enemyDist: 3 }) === null);
    check('addAiTransition chase->idle (lost) -> ok; eval lost -> idle',
      Nd.addAiTransition(p2, 'npc1', 'chase', 'idle', 'lost').ok === true &&
      Nd.evalAiTransition(p2, 'npc1', 'chase', { lost: true }) === 'idle');
    check('setNpcAi: patrol -> true + doi npc.ai; return -> false (khong phai ai hien tai)',
      Nd.setNpcAi(p2, 'npc1', 'patrol') === true && p2.npcs[0].ai === 'patrol' &&
      Nd.setNpcAi(p2, 'npc1', 'return') === false);
    check('removeAiState: khong xoa duoc node dang la npc.ai; xoa duoc node khac + don transition',
      (function () {
        const before = p2.npcs[0].aiTransitions.length;
        const noDel = Nd.removeAiState(p2, 'npc1', 'patrol') === false;
        const del = Nd.removeAiState(p2, 'npc1', 'wander') === true;
        return noDel && del && p2.npcs[0].aiStates.indexOf('wander') < 0 &&
          p2.npcs[0].aiTransitions.length <= before;
      })());
    /* (c) Quest chain trên project giả. */
    const p3 = { quests: [{ id: 'q1', name: 'Q1' }, { id: 'q2', name: 'Q2' }, { id: 'q3', name: 'Q3' }] };
    check('addPrerequisite q2 can q1, q3 can q2 -> ok',
      Nd.addPrerequisite(p3, 'q2', 'q1').ok === true &&
      Nd.addPrerequisite(p3, 'q3', 'q2').ok === true);
    check('addPrerequisite chan vong tron (q1 can q2) + trung + tu tro + quest la',
      Nd.addPrerequisite(p3, 'q1', 'q2').ok === false &&
      Nd.addPrerequisite(p3, 'q2', 'q1').ok === false &&
      Nd.addPrerequisite(p3, 'q1', 'q1').ok === false &&
      Nd.addPrerequisite(p3, 'q2', 'qX').ok === false);
    check('questOrder topo: [q1,q2,q3], khong vong',
      (function () {
        const o = Nd.questOrder(p3);
        return o.hasCycle === false && o.order.join(',') === 'q1,q2,q3';
      })());
    check('evalQuestAvailable: q2 mo khi xong q1, dong khi chua; q1 luon mo; q3 can ca q1+q2',
      Nd.evalQuestAvailable(p3, 'q2', ['q1']) === true &&
      Nd.evalQuestAvailable(p3, 'q2', []) === false &&
      Nd.evalQuestAvailable(p3, 'q1', []) === true &&
      Nd.evalQuestAvailable(p3, 'q3', ['q1', 'q2']) === true &&
      Nd.evalQuestAvailable(p3, 'q3', ['q1']) === false &&
      Nd.evalQuestAvailable(p3, 'q2', { q1: true }) === true);
    check('questOrder co vong tay (a<->b): hasCycle=true, order thieu quest trong vong',
      (function () {
        const o = Nd.questOrder({ quests: [
          { id: 'a', prerequisites: ['b'] }, { id: 'b', prerequisites: ['a'] },
          { id: 'c', prerequisites: [] }] });
        return o.hasCycle === true && o.order.indexOf('a') < 0 && o.order.indexOf('b') < 0;
      })());
    check('removeQuest xoa quest + don prerequisite tro toi no o quest khac',
      (function () {
        const p = { quests: [
          { id: 'q1', prerequisites: [] },
          { id: 'q2', prerequisites: ['q1'] }] };
        return Nd.removeQuest(p, 'q1') === true && p.quests.length === 1 &&
          p.quests[0].prerequisites.length === 0;
      })());
  }
}

/* ================= C. Timeline — snap / kéo / copy-paste / scale (11-animation.js) ================= */
console.log('--- C. Timeline (11-animation.js) ---');
let A = null;
try {
  const ctx = loadVm('src/editor/11-animation.js', { THREE: THREE_STUB });
  A = ctx.ED.Animation;
  check('11-animation.js load duoc bang vm (THREE stub)', !!A);
} catch (e) {
  check('11-animation.js load duoc bang vm (THREE stub)', false, e && e.message);
}
if (A) {
  const need = ['snapTime', 'moveKeyframe', 'copyKeys', 'pasteKeys'];
  const missing = need.filter(f => typeof A[f] !== 'function');
  if (missing.length) {
    skip('Timeline dot 3 (snap/move/copy/paste)', '11-animation.js thieu API: ' + missing.join(', '));
  } else {
    check('snapTime luoi 0.05: 0.123->0.1, 0.126->0.15, 0.07->0.05, 0.08->0.1; step 0.1: 1.234->1.2; NaN->0',
      A.snapTime(0.123) === 0.1 && A.snapTime(0.126) === 0.15 &&
      A.snapTime(0.07) === 0.05 && A.snapTime(0.08) === 0.1 &&
      A.snapTime(1.234, 0.1) === 1.2 && A.snapTime(NaN) === 0);
    const anim = A.newAnimation('a1', 'Kéo thử', 'object', 'obj-1');
    A.addKey(anim, 'pos.x', 0, 0);
    A.addKey(anim, 'pos.x', 1, 5);
    A.addKey(anim, 'pos.x', 2, 10);
    check('moveKeyframe: keo 1 -> 1.53 snap ve 1.55, giu gia tri v=5',
      (function () {
        const r = A.moveKeyframe(anim, 'pos.x', 1, 1.53);
        return r.ok === true && r.moved === true && r.t === 1.55 &&
          A.findTrack(anim, 'pos.x').keys.filter(k => k.t === 1.55)[0].v === 5;
      })());
    check('moveKeyframe: keo qua duration (5) thi kep ve 2 roi dung truoc key ke (1.95)',
      (function () {
        const r = A.moveKeyframe(anim, 'pos.x', 1.55, 5);
        return r.ok === true && r.t === 1.95 && anim.duration === 2;
      })());
    check('moveKeyframe: keo ve truoc (-1) thi kep ve 0 roi dung sau key ke (0.05)',
      (function () {
        const r = A.moveKeyframe(anim, 'pos.x', 1.95, -1);
        return r.ok === true && r.t === 0.05;
      })());
    check('moveKeyframe: keo 0.05 -> 0.06 (cung o luoi) thi ok, moved=false, t giu 0.05',
      (function () {
        const r = A.moveKeyframe(anim, 'pos.x', 0.05, 0.06);
        return r.ok === true && r.moved === false && r.t === 0.05;
      })());
    check('moveKeyframe: key khong ton tai / track khong ton tai -> ok=false',
      A.moveKeyframe(anim, 'pos.x', 9, 1).ok === false &&
      A.moveKeyframe(anim, 'pos.y', 0, 1).ok === false);
    check('moveKeyframe: sau cac lan keo, key khong trung thoi gian + sap xep tang dan',
      (function () {
        const ts = A.findTrack(anim, 'pos.x').keys.map(k => k.t);
        const uniq = ts.filter((t, i) => ts.indexOf(t) === i);
        return uniq.length === ts.length && ts.join(',') === ts.slice().sort((a, b) => a - b).join(',');
      })());
    const anim2 = A.newAnimation('a2', 'Copy', 'object', 'obj-2');
    A.addKey(anim2, 'pos.x', 0, 0);
    A.addKey(anim2, 'pos.x', 1, 5);
    A.addKey(anim2, 'pos.y', 0, 1);
    A.addKey(anim2, 'pos.y', 1, 2);
    const clip = A.copyKeys(anim2, [{ prop: 'pos.x', t: 0 }, { prop: 'pos.x', t: 1 }, { prop: 'pos.y', t: 1 }]);
    check('copyKeys: du 3 key, baseT = thoi gian som nhat (0), giu dung prop/v',
      clip && clip.count === 3 && clip.baseT === 0 && clip.keys.length === 3 &&
      clip.keys[2].prop === 'pos.y' && clip.keys[2].v === 2);
    check('copyKeys: chon rong / key khong ton tai -> null',
      A.copyKeys(anim2, []) === null &&
      A.copyKeys(anim2, [{ prop: 'pos.x', t: 9 }]) === null);
    const anim3 = A.newAnimation('a3', 'Paste', 'object', 'obj-3');
    const pr1 = A.pasteKeys(anim3, clip, 0.5);
    check('pasteKeys tai playhead 0.5: them 3 key, giu khoang cach (pos.x 0.5/1.5, pos.y 1.5), overwritten=0',
      pr1.ok === true && pr1.added.length === 3 && pr1.overwritten === 0 &&
      (function () {
        const tx = A.findTrack(anim3, 'pos.x');
        const ty = A.findTrack(anim3, 'pos.y');
        return tx.keys.map(k => k.t).join(',') === '0.5,1.5' &&
          tx.keys[0].v === 0 && tx.keys[1].v === 5 &&
          ty.keys.length === 1 && ty.keys[0].t === 1.5 && ty.keys[0].v === 2;
      })());
    const pr2 = A.pasteKeys(anim3, clip, 0.5);
    check('pasteKeys lan 2 cung cho: ghi de dung 3 key cu (overwritten=3), van them 3',
      pr2.ok === true && pr2.added.length === 3 && pr2.overwritten === 3);
    check('pasteKeys clipboard null -> ok=false',
      A.pasteKeys(anim3, null, 0.5).ok === false);
    check('pasteKeys vuot duration thi keo dai duration (paste tai 1.5, key cuoi 2.5)',
      (function () {
        const anim5 = A.newAnimation('a5', 'Paste xa', 'object', 'obj-5');
        const r = A.pasteKeys(anim5, clip, 1.5);
        return r.ok === true && r.added.length === 3 && anim5.duration === 2.5;
      })());
    check('trackProps object co scale.x/y/z; bone khong co scale',
      A.trackProps('object').indexOf('scale.x') >= 0 &&
      A.trackProps('object').indexOf('scale.z') >= 0 &&
      A.trackProps('bone').indexOf('scale.x') < 0);
    const anim4 = A.newAnimation('a4', 'Scale', 'object', 'obj-1');
    A.addKey(anim4, 'scale.x', 0, 1);
    A.addKey(anim4, 'scale.x', 1, 2);
    check('track scale serialize: buildClipData property scale[x], times 0,1, values 1,2',
      (function () {
        const d = A.buildClipData(anim4);
        return d.tracks.length === 1 && d.tracks[0].property === 'scale[x]' &&
          d.tracks[0].times.join(',') === '0,1' && d.tracks[0].values.join(',') === '1,2';
      })());
    check('clip co track scale: createClip (THREE stub) ten track obj-1.scale[x]',
      (function () {
        const c = A.createClip(anim4);
        return c && c.tracks.length === 1 && c.tracks[0].name === 'obj-1.scale[x]';
      })());
    check('track scale round-trip JSON: parse lai van dung property/times/values',
      (function () {
        const back = JSON.parse(JSON.stringify(anim4));
        const d = A.buildClipData(back);
        const c = A.createClip(back);
        return d.tracks.length === 1 && d.tracks[0].property === 'scale[x]' &&
          d.tracks[0].times.join(',') === '0,1' && d.tracks[0].values.join(',') === '1,2' &&
          c && c.tracks[0].name === 'obj-1.scale[x]';
      })());
  }
}

/* ================= D. Physics (17-physics.js) ================= */
console.log('--- D. Physics (17-physics.js) ---');
let Ph = null;
try {
  const ctx = loadVm('src/editor/17-physics.js', {});
  Ph = ctx.ED.Physics;
  check('17-physics.js load duoc bang vm (khong can DOM/THREE)', !!Ph);
} catch (e) {
  check('17-physics.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (Ph) {
  const need = ['stepBody', 'jump', 'moveCapsule', 'pushCrate', 'stepFallingProp'];
  const missing = need.filter(f => typeof Ph[f] !== 'function');
  if (missing.length) {
    skip('Physics dot 3', '17-physics.js thieu API: ' + missing.join(', '));
  } else {
    check('hang so: GRAVITY 20, JUMP_VELOCITY 8, RADIUS 0.35, HEIGHT 1.8',
      Ph.GRAVITY === 20 && Ph.JUMP_VELOCITY === 8 &&
      Ph.CAPSULE_RADIUS === 0.35 && Ph.CAPSULE_HEIGHT === 1.8);
    const flatEnv = { heights: [], boxes: [] };
    check('stepBody 1 buoc dt 0.1: vy -2, y 5 -> 4.8, chua cham dat',
      (function () {
        const r = Ph.stepBody({ pos: [0, 5, 0], vel: [0, 0, 0], grounded: false }, 0.1, flatEnv);
        return r.vel[1] === -2 && r.pos[1] === 4.8 && r.grounded === false;
      })());
    check('stepBody roi 200 buoc: dap dat y=0, vy=0, grounded=true; khong sua body goc',
      (function () {
        const body = { pos: [0, 5, 0], vel: [0, 0, 0], grounded: false };
        let cur = body;
        for (let i = 0; i < 200; i++) cur = Ph.stepBody(cur, 0.05, flatEnv);
        return cur.pos[1] === 0 && cur.vel[1] === 0 && cur.grounded === true && body.pos[1] === 5;
      })());
    check('stepBody roi len noc box: dung tren noc (y = top) thay vi xuyen xuong dat',
      (function () {
        const box = Ph.boxFromObject({ type: 'house', pos: [0, 0, 0], scale: [2, 1, 2], rot: [0, 0, 0] });
        let cur = { pos: [0, 5, 0], vel: [0, 0, 0], grounded: false };
        for (let i = 0; i < 200; i++) cur = Ph.stepBody(cur, 0.05, { heights: [], boxes: [box] });
        return cur.pos[1] === 1 && cur.grounded === true;
      })());
    check('jump khi grounded: vy=8, grounded=false, tra body moi; jump tuy chinh 10 -> vy=10',
      (function () {
        const g = { pos: [0, 0, 0], vel: [0, 0, 0], grounded: true };
        const j = Ph.jump(g);
        const j2 = Ph.jump(g, 10);
        return j.vel[1] === 8 && j.grounded === false && j !== g && j2.vel[1] === 10;
      })());
    check('jump khi dang bay: tra NGUYEN body truyen vao (khong nhay doi)',
      (function () {
        const air = { pos: [0, 2, 0], vel: [0, 1, 0], grounded: false };
        return Ph.jump(air) === air;
      })());
    const wallBox = Ph.boxFromObject({ type: 'house', pos: [2, 0, 0], scale: [2, 2, 2], rot: [0, 0, 0] });
    check('boxFromObject: house (2,0,0) scale 2 -> cx 2, hx 1, bottom 0, top 2; npc/trigger -> null',
      wallBox && wallBox.cx === 2 && wallBox.hx === 1 && wallBox.bottom === 0 && wallBox.top === 2 &&
      Ph.boxFromObject({ type: 'npc', pos: [0, 0, 0] }) === null &&
      Ph.boxFromObject({ type: 'collider', pos: [0, 0, 0], scale: [1, 1, 1], extra: { trigger: true } }) === null);
    check('moveCapsule di thang vao tuong: dung truoc mat hop (x=0.65), blocked=true, co hit',
      (function () {
        const r = Ph.moveCapsule([0, 0], 3, 0, 0, 0.35, 1.8, [wallBox]);
        return approx(r.pos[0], 0.65, 0.01) && r.pos[1] === 0 && r.blocked === true && !!r.hit;
      })());
    check('moveCapsule truot doc tuong: x bi chan (0.65) nhung z van toi du 0.5',
      (function () {
        const r = Ph.moveCapsule([0, 0], 3, 0.5, 0, 0.35, 1.8, [wallBox]);
        return approx(r.pos[0], 0.65, 0.01) && approx(r.pos[1], 0.5, 1e-9) && r.blocked === true;
      })());
    check('moveCapsule cho trong: toi du dich, blocked=false, hit=null',
      (function () {
        const r = Ph.moveCapsule([0, 0], 1, 0, 0, 0.35, 1.8, []);
        return r.pos[0] === 1 && r.pos[1] === 0 && r.blocked === false && r.hit === null;
      })());
    check('moveCapsule chong xuyen tuong: buoc dai 10 van dung truoc mat hop (x=0.65)',
      (function () {
        const r = Ph.moveCapsule([-5, 0], 10, 0, 0, 0.35, 1.8, [wallBox]);
        return approx(r.pos[0], 0.65, 0.01) && r.blocked === true;
      })());
    check('pushCrate dang day: vel = dir * 3, 0.1s di 0.3, moved=true, blocked=false',
      (function () {
        const r = Ph.pushCrate({ pos: [0, 0, 0], vel: [0, 0], size: [1, 1] }, [1, 0], 0.1, []);
        return approx(r.crate.pos[0], 0.3, 1e-9) && r.crate.vel[0] === 3 && r.moved === true && r.blocked === false;
      })());
    check('pushCrate gap tuong: dung sat mat tuong (x=0.5), vel truc day = 0, blocked=true',
      (function () {
        const wall = Ph.boxFromObject({ type: 'house', pos: [1.5, 0, 0], scale: [1, 2, 1], rot: [0, 0, 0] });
        let crate = { pos: [0, 0, 0], vel: [0, 0], size: [1, 1] };
        let last = null;
        for (let i = 0; i < 10; i++) last = Ph.pushCrate(crate, [1, 0], 0.1, [wall]), crate = last.crate;
        return last.crate.pos[0] === 0.5 && last.crate.vel[0] === 0 && last.blocked === true;
      })());
    check('pushCrate ma sat: khong day thi cham dan (3 -> 2.2 sau 0.1s); toc do nho dung han',
      (function () {
        const a = Ph.pushCrate({ pos: [0, 0, 0], vel: [3, 0], size: [1, 1] }, null, 0.1, []);
        const b = Ph.pushCrate({ pos: [0, 0, 0], vel: [0.5, 0], size: [1, 1] }, null, 0.1, []);
        return approx(a.crate.vel[0], 2.2, 1e-9) && a.moved === true &&
          b.crate.vel[0] === 0 && b.crate.vel[1] === 0 && b.moved === false;
      })());
    check('stepFallingProp 1 buoc dt 0.1: vy -2, y 5 -> 4.8, chua resting, moved=true',
      (function () {
        const r = Ph.stepFallingProp({ pos: [0, 5, 0], velY: 0 }, 0.1, flatEnv);
        return r.velY === -2 && r.pos[1] === 4.8 && r.resting === false && r.moved === true;
      })());
    check('stepFallingProp roi 100 buoc: nam tren dat y=0, velY=0, resting=true',
      (function () {
        let cur = { pos: [0, 5, 0], velY: 0 };
        for (let i = 0; i < 100; i++) cur = Ph.stepFallingProp(cur, 0.05, flatEnv);
        return cur.pos[1] === 0 && cur.velY === 0 && cur.resting === true;
      })());
    check('stepFallingProp da nam tren dat: resting=true ngay, khong nhuc nhich; prop duoi dat duoc day len',
      (function () {
        const a = Ph.stepFallingProp({ pos: [0, 0, 0], velY: 0 }, 0.05, flatEnv);
        const b = Ph.stepFallingProp({ pos: [0, -1, 0], velY: 0 }, 0.05, flatEnv);
        return a.resting === true && a.moved === false && b.pos[1] === 0 && b.resting === true;
      })());
  }
}

/* ================= E. Environment (05-environment.js + 01-viewport.js) ================= */
console.log('--- E. Environment (05-environment.js + 01-viewport.js) ---');
let Env = null;
try {
  const ctx = loadVm('src/editor/05-environment.js', {});
  Env = ctx.ED.Environment;
  check('05-environment.js load duoc bang vm (khong can DOM/THREE)', !!Env);
} catch (e) {
  check('05-environment.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (Env) {
  const need = ['normalizeShadow', 'computeShadowSettings', 'computeShadowFlags',
    'normalizeWater', 'computeFog', 'defaultShadow', 'defaultWater'];
  const missing = need.filter(f => typeof Env[f] !== 'function');
  if (missing.length) {
    skip('Environment dot 3', '05-environment.js thieu API: ' + missing.join(', '));
  } else {
    check('normalizeShadow: mapSize la 777 -> 1024; 512/2048 giu; bias kep +-0.005; null -> mac dinh',
      Env.normalizeShadow({ mapSize: 777 }).mapSize === 1024 &&
      Env.normalizeShadow({ mapSize: 2048 }).mapSize === 2048 &&
      Env.normalizeShadow({ mapSize: 512 }).mapSize === 512 &&
      Env.normalizeShadow({ bias: 0.02 }).bias === 0.005 &&
      Env.normalizeShadow({ bias: -0.02 }).bias === -0.005 &&
      (function () { const d = Env.normalizeShadow(null); return d.enabled === true && d.mapSize === 1024 && d.bias === 0; })());
    check('defaultShadow: enabled=true, mapSize=1024, bias=0',
      (function () { const d = Env.defaultShadow(); return d.enabled === true && d.mapSize === 1024 && d.bias === 0; })());
    check('computeShadowSettings: mapSize 777 -> 1024, bias 0.02 -> 0.005, PCFSoft, camera far 160',
      (function () {
        const s = Env.computeShadowSettings({ mapSize: 777, bias: 0.02 });
        return s.mapSize === 1024 && s.bias === 0.005 && s.shadowMapType === 'PCFSoftShadowMap' &&
          s.shadowCamera && s.shadowCamera.far === 160;
      })());
    check('computeShadowFlags: house cast+receive; terrain chi receive; water khong cast/receive; la -> cast',
      (function () {
        const h = Env.computeShadowFlags('house');
        const t = Env.computeShadowFlags('terrain');
        const w = Env.computeShadowFlags('water');
        const x = Env.computeShadowFlags('khong-co');
        return h.cast === true && h.receive === true &&
          t.cast === false && t.receive === true &&
          w.cast === false && w.receive === false &&
          x.cast === true && x.receive === false;
      })());
    check('normalizeWater: opacity 2 -> 1, 0.01 -> 0.1, 0.5 giu; null -> mac dinh (reflect, 0.85)',
      Env.normalizeWater({ opacity: 2 }).opacity === 1 &&
      Env.normalizeWater({ opacity: 0.01 }).opacity === 0.1 &&
      Env.normalizeWater({ opacity: 0.5 }).opacity === 0.5 &&
      (function () { const d = Env.normalizeWater(null); return d.reflect === true && d.opacity === 0.85; })());
    check('defaultWater: reflect=true, opacity=0.85',
      (function () { const d = Env.defaultWater(); return d.reflect === true && d.opacity === 0.85; })());
    check('computeFog density 0 -> tat (enabled=false, far=0)',
      (function () { const f = Env.computeFog(0, '', '#87b5d6', 0, 0.5); return f.enabled === false && f.far === 0; })());
    check('computeFog 0.01, camera thap: enabled, near 30, far 120',
      (function () {
        const f = Env.computeFog(0.01, '', '#87b5d6', 0, 1);
        return f.enabled === true && f.near === 30 && f.far === 120;
      })());
    check('computeFog 0.01, camera cao 40m: far 264 > far luc thap (120)',
      (function () {
        const lo = Env.computeFog(0.01, '', '#87b5d6', 0, 1);
        const hi = Env.computeFog(0.01, '', '#87b5d6', 40, 1);
        return hi.far === 264 && hi.far > lo.far && hi.heightFactor === 1;
      })());
    check('computeFog: fogColor rong -> theo mau troi; fogColor do -> giu do khi camera thap',
      (function () {
        const a = Env.computeFog(0.01, '', '#87b5d6', 0, 0);
        const b = Env.computeFog(0.01, '#ff0000', '#87b5d6', 0, 0);
        return a.color === '#87b5d6' && b.color === '#ff0000';
      })());
    check('defaultEnv: project cu co san shadow/water/fogColor/fogHeight mac dinh',
      (function () {
        const d = Env.defaultEnv();
        return d.fogColor === '' && d.fogHeight === 0.5 &&
          d.shadow && d.shadow.mapSize === 1024 && d.water && d.water.opacity === 0.85;
      })());
    check('syncFromProject: project cu chi co timeOfDay van nhan shadow/water mac dinh dot 3',
      (function () {
        /* Gan ED.Core gia SAU khi load module (ham doc ED.Core luc goi). */
        const ctx = loadVm('src/editor/05-environment.js', {});
        ctx.ED.Core = { getProject: function () { return { env: { timeOfDay: 12 } }; } };
        const E2 = ctx.ED.Environment;
        if (E2.syncFromProject() !== true) return false;
        const env = E2.getEnv();
        return env.timeOfDay === 12 && env.shadow.mapSize === 1024 &&
          env.water.opacity === 0.85 && env.fogColor === '' && env.fogHeight === 0.5;
      })());
  }
}
/* Mặt nước Reflector (01-viewport.js) — cần THREE.Reflector stub. */
try {
  const fragStub = 'uniform vec3 color;\nvoid main(){ gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 ); }';
  const THREE_WATER = {
    Color: function (c) { this.value = c; },
    Matrix4: function () {},
    Reflector: { ReflectorShader: { vertexShader: 'void main(){}', fragmentShader: fragStub } }
  };
  const ctxV = loadVm('src/editor/01-viewport.js', { THREE: THREE_WATER });
  const V = ctxV.ED.Viewport;
  check('01-viewport.js load duoc bang vm + expose buildWaterShader',
    !!V && typeof V.buildWaterShader === 'function');
  if (V && typeof V.buildWaterShader === 'function') {
    check('buildWaterShader: tra shader co uniform opacity 0.5 + color, fragment da chen opacity',
      (function () {
        const s = V.buildWaterShader('#4da39e', 0.5);
        return !!s && s.uniforms && s.uniforms.opacity.value === 0.5 &&
          !!s.uniforms.color && s.fragmentShader.indexOf('opacity') >= 0;
      })());
    check('buildWaterShader: opacity mac dinh 0.85 khi khong truyen',
      (function () {
        const s = V.buildWaterShader(null, null);
        return !!s && s.uniforms.opacity.value === 0.85;
      })());
  }
} catch (e) {
  check('01-viewport.js buildWaterShader (THREE.Reflector stub)', false, e && e.message);
}
try {
  const ctxV2 = loadVm('src/editor/01-viewport.js', { THREE: {} });
  const V2 = ctxV2.ED.Viewport;
  check('buildWaterShader khong co THREE.Reflector -> null (giu mat phang thuong)',
    !!V2 && V2.buildWaterShader('#4da39e', 0.5) === null);
} catch (e) {
  check('buildWaterShader khong co THREE.Reflector -> null', false, e && e.message);
}

/* ================= F. Export + Audio (15-export.js) ================= */
console.log('--- F. Export + Audio (15-export.js) ---');
let Ex = null, Au = null;
try {
  const ctx = loadVm('src/editor/15-export.js', {});
  Ex = ctx.ED.Export;
  Au = ctx.ED.Audio;
  check('15-export.js load duoc bang vm (khong can DOM/THREE)', !!Ex && !!Au);
} catch (e) {
  check('15-export.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (Ex) {
  check('buildGltfName/BinName/PngName: ten thuong + duoi dung; ky tu cam -> -; rong -> map-editor',
    Ex.buildGltfName('Biện Kinh Thành') === 'Biện Kinh Thành.gltf' &&
    Ex.buildGltfBinName('a/b:c') === 'a-b-c.bin' &&
    Ex.buildPngName('') === 'map-editor.png' &&
    Ex.buildGltfName('x.glb') === 'x.gltf' &&
    Ex.buildPngName('ten.png') === 'ten.png');
  check('validateGltf: dung + bin khop -> ok, version 2.0, bufferUri x.bin',
    (function () {
      const r = Ex.validateGltf({ asset: { version: '2.0' }, buffers: [{ uri: 'x.bin', byteLength: 10 }] }, 'x.bin');
      return r.ok === true && r.version === '2.0' && r.bufferUri === 'x.bin';
    })());
  check('validateGltf: uri sai .bin -> khong ok; thieu asset.version -> khong ok; JSON sai -> khong ok',
    Ex.validateGltf({ asset: { version: '2.0' }, buffers: [{ uri: 'y.bin', byteLength: 10 }] }, 'x.bin').ok === false &&
    Ex.validateGltf({ asset: {} }, 'x.bin').ok === false &&
    Ex.validateGltf('{json sai', 'x.bin').ok === false);
  check('validateGltf: khong co buffers van hop le (ok); chuoi JSON dung -> ok',
    Ex.validateGltf({ asset: { version: '2.0' } }, 'x.bin').ok === true &&
    Ex.validateGltf('{"asset":{"version":"2.0"},"buffers":[{"uri":"x.bin","byteLength":4}]}', 'x.bin').ok === true);
  check('isPngDataUrl: prefix data:image/png;base64,iVBOR -> true; jpeg/khac -> false',
    Ex.isPngDataUrl('data:image/png;base64,iVBORw0KGgo=') === true &&
    Ex.isPngDataUrl('data:image/jpeg;base64,/9j/') === false &&
    Ex.isPngDataUrl('data:image/png;base64,xxxx') === false &&
    Ex.isPngDataUrl(null) === false);
  if (Au && typeof Au.synthParams === 'function') {
    check('synthParams du 5 loai, moi loai 2 node, thoi gian khac nhau (skill .45 / hit .22 / hurt .28 / die .85 / pickup .25)',
      (function () {
        const kinds = ['skill', 'hit', 'hurt', 'die', 'pickup'];
        const ds = [];
        for (let i = 0; i < kinds.length; i++) {
          const p = Au.synthParams(kinds[i]);
          if (!p || p.kind !== kinds[i] || !Array.isArray(p.nodes) || p.nodes.length !== 2) return false;
          ds.push(p.duration);
        }
        return ds.join(',') === '0.45,0.22,0.28,0.85,0.25';
      })());
    check('synthParams tan so khac nhau theo loai (skill 660 / hit 220 / hurt 160 / die 300 / pickup 880)',
      Au.synthParams('skill').nodes[1].freq === 660 &&
      Au.synthParams('hit').nodes[1].freq === 220 &&
      Au.synthParams('hurt').nodes[0].freq === 160 &&
      Au.synthParams('die').nodes[0].freq === 300 &&
      Au.synthParams('pickup').nodes[0].freq === 880);
    check('synthParams loai la -> null; ED.Audio.kinds du 5 loai',
      Au.synthParams('khong-co') === null &&
      Array.isArray(Au.kinds) && Au.kinds.length === 5);
  } else {
    skip('synthParams 5 loai SFX', 'ED.Audio.synthParams khong ton tai trong code');
  }
  check('playlist next/prev vong lai: next(2,3)=0, next(0,3)=1, prev(0,3)=2, prev(2,3)=1; len 0 -> -1',
    Ex.edAudioPlaylistNextIndex(2, 3) === 0 &&
    Ex.edAudioPlaylistNextIndex(0, 3) === 1 &&
    Ex.edAudioPlaylistPrevIndex(0, 3) === 2 &&
    Ex.edAudioPlaylistPrevIndex(2, 3) === 1 &&
    Ex.edAudioPlaylistNextIndex(0, 0) === -1 &&
    Ex.edAudioPlaylistPrevIndex(5, 0) === -1 &&
    Ex.edAudioPlaylistNextIndex(-1, 3) === 0 &&
    Ex.edAudioPlaylistPrevIndex(-1, 3) === 2);
  check('settings parse/stringify round-trip: volume 0.8, muted, currentIndex 1, 2 track giu nguyen',
    (function () {
      const s = { volume: 0.8, muted: true, currentIndex: 1,
        tracks: [{ id: 't1', name: 'Nhạc 1', ext: 'mp3', size: 100 }, { id: 't2', name: 'Nhạc 2', ext: 'ogg', size: 200 }] };
      const back = Ex.edAudioSettingsParse(Ex.edAudioSettingsStringify(s));
      return back.volume === 0.8 && back.muted === true && back.currentIndex === 1 &&
        back.tracks.length === 2 && back.tracks[0].id === 't1' && back.tracks[1].id === 't2';
    })());
  check('settings parse: JSON sai -> mac dinh (volume 0.5, tracks rong); volume 1.5 -> kep 1',
    (function () {
      const a = Ex.edAudioSettingsParse('{sai');
      const b = Ex.edAudioSettingsParse('{"volume":1.5}');
      return a.volume === 0.5 && a.muted === false && a.tracks.length === 0 && b.volume === 1;
    })());
  check('AUDIO_SETTINGS_KEY dung (mongvolam_editor_audio_v1)',
    Ex.AUDIO_SETTINGS_KEY === 'mongvolam_editor_audio_v1');
  check('settings localStorage round-trip: setVolume/setMuted ghi -> context moi init() doc lai dung',
    (function () {
      try {
        /* Context 1: ghi settings qua API that. */
        const store1 = new Map();
        const ls1 = {
          getItem: k => (store1.has(k) ? store1.get(k) : null),
          setItem: (k, v) => store1.set(k, String(v)),
          removeItem: k => store1.delete(k)
        };
        const ctx1 = loadVm('src/editor/15-export.js', { localStorage: ls1 });
        ctx1.ED.Audio.setVolume(0.8);
        ctx1.ED.Audio.setMuted(true);
        const stored = ls1.getItem('mongvolam_editor_audio_v1');
        if (!stored) return false;
        const parsed = JSON.parse(stored);
        if (parsed.volume !== 0.8 || parsed.muted !== true) return false;
        /* Context 2 (moi): nap settings tu localStorage qua init(). */
        const store2 = new Map([['mongvolam_editor_audio_v1', stored]]);
        const ls2 = {
          getItem: k => (store2.has(k) ? store2.get(k) : null),
          setItem: (k, v) => store2.set(k, String(v)),
          removeItem: k => store2.delete(k)
        };
        const ctx2 = loadVm('src/editor/15-export.js', { localStorage: ls2 });
        ctx2.ED.Export.init();
        const back = ctx2.ED.Export.getAudioSettings();
        return back.volume === 0.8 && back.muted === true;
      } catch (e) {
        return false;
      }
    })());
}

/* ================= G. Tích hợp build ================= */
console.log('--- G. Tich hop build ---');
check('mapeditor.html ton tai, chua ED.Nodes + ED.Physics (2 module moi dot 3)',
  exists('mapeditor.html') &&
  read('mapeditor.html').indexOf('ED.Nodes') >= 0 &&
  read('mapeditor.html').indexOf('ED.Physics') >= 0);
check('mapeditor.html chua THREE.Reflector (nuoc phan chieu that, lib/Reflector.js duoc inline)',
  exists('mapeditor.html') && read('mapeditor.html').indexOf('THREE.Reflector') >= 0);
check('mapeditor.html khong con placeholder __REFLECTOR__ sot',
  exists('mapeditor.html') && read('mapeditor.html').indexOf('__REFLECTOR__') < 0);
check('lib/Reflector.js ton tai, la ban non-module (THREE.Reflector)',
  exists('lib/Reflector.js') && read('lib/Reflector.js').indexOf('THREE.Reflector') >= 0);
check("tools/build-editor.mjs co du 2 file moi (16-nodes.js, 17-physics.js) + placeholder __REFLECTOR__",
  (function () {
    const s = read('tools/build-editor.mjs');
    return ['16-nodes.js', '17-physics.js', '__REFLECTOR__'].every(x => s.indexOf(x) >= 0) &&
      s.indexOf("'16-nodes.js'") > s.indexOf("'08-npc-ai.js'") &&
      s.indexOf("'17-physics.js'") < s.indexOf("'09-play.js'");
  })());
check('99-boot.js goi init Nodes sau NpcAi (Physics khong co init nen khong goi)',
  (function () {
    const s = read('src/editor/99-boot.js');
    return s.indexOf("_callInit('Nodes')") >= 0 &&
      s.indexOf("_callInit('Nodes')") > s.indexOf("_callInit('NpcAi')") &&
      s.indexOf("_callInit('Physics')") < 0;
  })());
check('editor.template.html co khoi __REFLECTOR__ sau __GLTFEXPORTER__, truoc __EDITOR_JS__',
  (function () {
    const s = read('src/editor/editor.template.html');
    return s.indexOf('__REFLECTOR__') >= 0 &&
      s.indexOf('__REFLECTOR__') > s.indexOf('__GLTFEXPORTER__') &&
      s.indexOf('__REFLECTOR__') < s.indexOf('__EDITOR_JS__');
  })());
check('mongvolam.html khong chua code editor dot 3 (game khong doi)',
  read('mongvolam.html').indexOf('ED.Nodes') < 0 &&
  read('mongvolam.html').indexOf('ED.Physics') < 0);

/* ================= Tổng kết ================= */
console.log('----------------------------------------');
console.log(pass + ' PASS, ' + skipped + ' SKIP, ' + fail + ' FAIL');
if (fail > 0) {
  console.log('FAILED: ' + failedNames.join(' | '));
  process.exit(1);
}
