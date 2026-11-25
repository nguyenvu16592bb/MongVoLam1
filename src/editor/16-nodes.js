/* ============================== 16-nodes.js ==============================
   ED.Nodes — Node Editor trực quan cho Map Editor (đợt 3).
   - 1 canvas node editor dùng chung cho 3 loại đồ thị, KHÔNG tạo bản dữ
     liệu song song: mọi thêm/xoá/nối đọc/ghi đúng field project đã có:
       (a) State machine animation -> project.stateMachines[charId]
           (định dạng của 11-animation.js: states[], transitions[]
           {from,to,condition}, clips{}, current). Nối = transition.
       (b) AI behavior -> npcs[].ai (state hiện tại), npcs[].aiStates
           (danh sách node; mặc định 6 mode của 08-npc-ai.js, project cũ
           không có thì tự mặc định), npcs[].aiTransitions[]
           {from,to,condition:{type,radius?}}. Nối = transition AI.
           npc.patrol[] KHÔNG đổi qua editor này (đặt waypoint vẫn ở
           panel NPC); panel AI chỉ hiện số waypoint để tham chiếu.
       (c) Quest chain -> project.quests[], prerequisite là field mới
           quest.prerequisites[] (mảng id quest; project cũ không có
           thì mặc định []). Nối từ quest trước -> quest sau.
   - Vị trí node (x,y) trên canvas CHỈ là trạng thái hiển thị, giữ trong
     bộ nhớ module (_layout), KHÔNG ghi vào project JSON, KHÔNG tạo
     field song song. Mở lại project cũ vẫn thấy đúng dữ liệu đợt 1-2.
   - Logic thuần expose để test bằng vm + stub DOM/THREE (đợt 3).
     Khi ED.Animation / ED.NpcAi đã load thì uỷ quyền cho hàm thuần của
     chúng (1 nguồn sự thật); chưa load thì dùng bản dự phòng cùng
     ngữ nghĩa để module vẫn chạy độc lập trong test.
   QUY TẮC DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo DOM/CSS trong init(). Giao diện tiếng Việt, dark theme,
   nút >=40px, phone-first (pointer events: chạm kéo node, pinch zoom).
   GIỚI HẠN: chưa render thử trên trình duyệt/điện thoại thật; file này
   chưa nối vào build (coordinator nối sau: tools/build-editor.mjs +
   99-boot.js); nối edge bằng cách kéo từ cổng phải sang cổng trái của
   node đích; bấm vào 1 nối sẽ xoá nối đó (đã pushHistory trước nên
   Ctrl+Z khôi phục được). */

var ED = (typeof ED !== 'undefined' && ED) ? ED : {};

/* ---------------- Hằng số ---------------- */

var ED_NODES_MODES = ['anim', 'ai', 'quest'];
var ED_NODES_MODE_LABELS = { anim: 'State Machine', ai: 'AI Behavior', quest: 'Quest Chain' };
var ED_NODES_ANIM_STATES = ['Idle', 'Walk', 'Run', 'Attack', 'Skill', 'Cast', 'Hit', 'Death'];
var ED_NODES_ANIM_STATE_LABELS = {
  Idle: 'Đứng yên', Walk: 'Đi bộ', Run: 'Chạy', Attack: 'Tấn công',
  Skill: 'Kỹ năng', Cast: 'Niệm chú', Hit: 'Trúng đòn', Death: 'Chết'
};
var ED_NODES_ANIM_CONDITIONS = ['moving', 'attacking', 'idle', 'hp<=0', 'key'];
var ED_NODES_ANIM_CONDITION_LABELS = {
  moving: 'Đang di chuyển', attacking: 'Đang tấn công', idle: 'Đứng yên',
  'hp<=0': 'Hết HP (hp<=0)', key: 'Bấm phím'
};
/* AI: 6 mode của 08-npc-ai.js + 'return' (quay về vị trí tuần tra/gốc).
   'return' chỉ sống trong aiStates/aiTransitions, npc.ai vẫn là 1 trong
   6 mode (không đổi format npcs[].ai). */
var ED_NODES_AI_STATES = ['idle', 'patrol', 'wander', 'follow', 'chase', 'attack', 'return'];
var ED_NODES_AI_STATE_LABELS = {
  idle: 'Idle (đứng yên)', patrol: 'Patrol (tuần tra)', wander: 'Wander (lang thang)',
  follow: 'Follow (đi theo)', chase: 'Chase (đuổi theo)', attack: 'Attack (tấn công)',
  return: 'Return (quay về)'
};
var ED_NODES_AI_CONDITIONS = ['detect', 'lost', 'arrive', 'attack', 'idle', 'hpLow'];
var ED_NODES_AI_CONDITION_LABELS = {
  detect: 'Phát hiện địch trong bán kính', lost: 'Mất dấu địch',
  arrive: 'Tới đích / về tới nơi', attack: 'Địch vào tầm đánh',
  idle: 'Đứng yên đủ lâu', hpLow: 'HP thấp'
};
var ED_NODES_NODE_W = 148;
var ED_NODES_NODE_H = 52;

/* ---------------- Hàm thuần phụ trợ ---------------- */

function edNodesTrim(s) {
  return String(s === undefined || s === null ? '' : s).replace(/^\s+|\s+$/g, '');
}

function edNodesClampNum(v, min, max, fallback) {
  var n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* Chuẩn hoá điều kiện AI: nhận string ('detect') hoặc object
   ({type:'detect', radius:5}) -> luôn trả {type, radius} (radius chỉ
   có ý nghĩa với detect/attack, mặc định undefined nếu không truyền). */
function edNodesNormAiCond(c) {
  if (typeof c === 'string') return { type: c };
  if (c && typeof c === 'object' && typeof c.type === 'string') {
    var out = { type: c.type };
    if (isFinite(Number(c.radius))) out.radius = Number(c.radius);
    if (isFinite(Number(c.seconds))) out.seconds = Number(c.seconds);
    if (isFinite(Number(c.pct))) out.pct = Number(c.pct);
    return out;
  }
  return { type: 'detect' };
}

function edNodesAiCondLabel(c) {
  var n = edNodesNormAiCond(c);
  var base = ED_NODES_AI_CONDITION_LABELS[n.type] || n.type;
  if ((n.type === 'detect' || n.type === 'attack') && isFinite(Number(n.radius))) {
    base += ' (' + n.radius + ')';
  }
  if (n.type === 'hpLow' && isFinite(Number(n.pct))) base += ' (HP < ' + n.pct + '%)';
  if (n.type === 'idle' && isFinite(Number(n.seconds))) base += ' (' + n.seconds + 's)';
  return base;
}

function edNodesAnimCondLabel(c) {
  return ED_NODES_ANIM_CONDITION_LABELS[c] || String(c || '');
}

/* ---------------- (a) State machine — uỷ quyền ED.Animation ---------------- */

function edNodesLocalNewMachine(charId) {
  return {
    charId: charId, current: 'Idle',
    states: ED_NODES_ANIM_STATES.slice(),
    transitions: [
      { from: 'Idle', to: 'Walk', condition: 'moving' },
      { from: 'Walk', to: 'Idle', condition: 'idle' },
      { from: 'Walk', to: 'Run', condition: 'moving' },
      { from: 'Run', to: 'Walk', condition: 'idle' },
      { from: 'Idle', to: 'Attack', condition: 'attacking' },
      { from: 'Attack', to: 'Idle', condition: 'idle' },
      { from: 'Idle', to: 'Death', condition: 'hp<=0' },
      { from: 'Walk', to: 'Death', condition: 'hp<=0' },
      { from: 'Attack', to: 'Death', condition: 'hp<=0' }
    ],
    clips: {}
  };
}

/* Lấy (hoặc tạo mới với mặc định) state machine của 1 character trong
   project.stateMachines. Project cũ không có field thì tự tạo {}. */
function edNodesGetMachine(project, charId) {
  if (!project || typeof project !== 'object') return null;
  if (ED.Animation && typeof ED.Animation.getMachine === 'function') {
    return ED.Animation.getMachine(project, charId);
  }
  if (!charId) return null;
  if (!project.stateMachines || typeof project.stateMachines !== 'object' ||
      Array.isArray(project.stateMachines)) project.stateMachines = {};
  if (!project.stateMachines[charId] || typeof project.stateMachines[charId] !== 'object') {
    project.stateMachines[charId] = edNodesLocalNewMachine(charId);
  }
  var m = project.stateMachines[charId];
  if (!Array.isArray(m.states) || !m.states.length) m.states = ED_NODES_ANIM_STATES.slice();
  if (!Array.isArray(m.transitions)) m.transitions = edNodesLocalNewMachine(charId).transitions;
  if (!m.clips || typeof m.clips !== 'object') m.clips = {};
  if (m.states.indexOf(m.current) < 0) m.current = m.states[0];
  return m;
}

function edNodesAddState(project, charId, name) {
  var m = edNodesGetMachine(project, charId);
  if (!m) return false;
  if (ED.Animation && typeof ED.Animation.addState === 'function') {
    return ED.Animation.addState(m, name);
  }
  var n = edNodesTrim(name);
  if (!n || n.length > 24) return false;
  if (m.states.indexOf(n) >= 0) return false;
  if (m.states.length >= 16) return false;
  m.states.push(n);
  return true;
}

function edNodesRemoveState(project, charId, name) {
  var m = edNodesGetMachine(project, charId);
  if (!m) return false;
  if (ED.Animation && typeof ED.Animation.removeState === 'function') {
    return ED.Animation.removeState(m, name);
  }
  var idx = m.states.indexOf(name);
  if (idx < 0) return false;
  m.states.splice(idx, 1);
  m.transitions = m.transitions.filter(function (tr) {
    return tr.from !== name && tr.to !== name;
  });
  if (m.clips) delete m.clips[name];
  if (m.current === name) m.current = m.states[0] || 'Idle';
  return true;
}

function edNodesAddTransition(project, charId, from, to, condition) {
  var m = edNodesGetMachine(project, charId);
  if (!m) return { ok: false, reason: 'Không có state machine.' };
  if (ED.Animation && typeof ED.Animation.addTransition === 'function') {
    return ED.Animation.addTransition(m, from, to, condition);
  }
  if (m.states.indexOf(from) < 0 || m.states.indexOf(to) < 0) {
    return { ok: false, reason: 'State không có trong danh sách.' };
  }
  if (from === to) return { ok: false, reason: 'Transition phải chuyển sang state khác.' };
  if (ED_NODES_ANIM_CONDITIONS.indexOf(condition) < 0) {
    return { ok: false, reason: 'Điều kiện không hợp lệ.' };
  }
  for (var i = 0; i < m.transitions.length; i++) {
    var tr = m.transitions[i];
    if (tr.from === from && tr.to === to && tr.condition === condition) {
      return { ok: false, reason: 'Transition này đã có rồi.' };
    }
  }
  m.transitions.push({ from: from, to: to, condition: condition });
  return { ok: true };
}

/* Xoá transition theo vị trí trong mảng (dạng của 11-animation.js). */
function edNodesRemoveTransition(project, charId, index) {
  var m = edNodesGetMachine(project, charId);
  if (!m) return false;
  if (ED.Animation && typeof ED.Animation.removeTransition === 'function') {
    return ED.Animation.removeTransition(m, index);
  }
  if (index < 0 || index >= m.transitions.length) return false;
  m.transitions.splice(index, 1);
  return true;
}

/* Xoá transition theo đầu-cuối (+ điều kiện nếu truyền): canvas dùng để
   xoá nối khi bấm vào nối. Trả true nếu xoá được ít nhất 1 nối. */
function edNodesRemoveTransitionByEnds(project, charId, from, to, condition) {
  var m = edNodesGetMachine(project, charId);
  if (!m || !Array.isArray(m.transitions)) return false;
  var removed = false;
  for (var i = m.transitions.length - 1; i >= 0; i--) {
    var tr = m.transitions[i];
    if (tr && tr.from === from && tr.to === to &&
        (condition === undefined || condition === null || tr.condition === condition)) {
      m.transitions.splice(i, 1);
      removed = true;
    }
  }
  return removed;
}

function edNodesSetCurrentState(project, charId, state) {
  var m = edNodesGetMachine(project, charId);
  if (!m || m.states.indexOf(state) < 0) return false;
  m.current = state;
  return true;
}

/* Đánh giá transition: trả state đích đầu tiên khớp điều kiện, hoặc null.
   ctx: {moving, attacking, idle, hp, dead, key} (như 11-animation.js). */
function edNodesEvalTransition(project, charId, currentState, ctx) {
  var m = edNodesGetMachine(project, charId);
  if (!m) return null;
  if (ED.Animation && typeof ED.Animation.evalTransition === 'function') {
    return ED.Animation.evalTransition(m, currentState, ctx);
  }
  ctx = ctx || {};
  for (var i = 0; i < m.transitions.length; i++) {
    var tr = m.transitions[i];
    if (!tr || tr.from !== currentState) continue;
    var hit = false;
    if (tr.condition === 'moving') hit = !!ctx.moving;
    else if (tr.condition === 'attacking') hit = !!ctx.attacking;
    else if (tr.condition === 'idle') hit = !!ctx.idle;
    else if (tr.condition === 'hp<=0') hit = (typeof ctx.hp === 'number') ? (ctx.hp <= 0) : !!ctx.dead;
    else if (tr.condition === 'key') hit = !!ctx.key;
    if (hit) return tr.to;
  }
  return null;
}

/* ---------------- (b) AI behavior — npcs[].ai / aiStates / aiTransitions ---------------- */

function edNodesGetNpc(project, npcId) {
  if (!project || !Array.isArray(project.npcs)) return null;
  for (var i = 0; i < project.npcs.length; i++) {
    if (project.npcs[i] && project.npcs[i].id === npcId) return project.npcs[i];
  }
  return null;
}

/* Đảm bảo field AI của NPC: aiStates (mặc định 6 mode), aiTransitions
   (mặc định []). Project/NPC cũ không có thì tự tạo, không đụng ai/patrol. */
function edNodesEnsureAiFields(npc) {
  if (!npc || typeof npc !== 'object') return null;
  if (!Array.isArray(npc.aiStates) || !npc.aiStates.length) {
    npc.aiStates = ['idle', 'patrol', 'wander', 'follow', 'chase', 'attack'];
  }
  if (!Array.isArray(npc.aiTransitions)) npc.aiTransitions = [];
  if (ED_NODES_AI_STATES.indexOf(npc.ai) < 0) npc.ai = 'idle';
  return npc;
}

function edNodesAddAiState(project, npcId, state) {
  var npc = edNodesGetNpc(project, npcId);
  if (!npc) return false;
  edNodesEnsureAiFields(npc);
  var s = edNodesTrim(state);
  if (ED_NODES_AI_STATES.indexOf(s) < 0) return false;
  if (npc.aiStates.indexOf(s) >= 0) return false;
  npc.aiStates.push(s);
  return true;
}

/* Xoá node AI: mất node + mọi transition liên quan. Không xoá được node
   đang là npc.ai (phải đổi ai sang state khác trước) để NPC không rơi
   vào trạng thái không tồn tại. */
function edNodesRemoveAiState(project, npcId, state) {
  var npc = edNodesGetNpc(project, npcId);
  if (!npc) return false;
  edNodesEnsureAiFields(npc);
  if (npc.ai === state) return false;
  var idx = npc.aiStates.indexOf(state);
  if (idx < 0) return false;
  npc.aiStates.splice(idx, 1);
  npc.aiTransitions = npc.aiTransitions.filter(function (tr) {
    return tr.from !== state && tr.to !== state;
  });
  return true;
}

function edNodesAddAiTransition(project, npcId, from, to, condition) {
  var npc = edNodesGetNpc(project, npcId);
  if (!npc) return { ok: false, reason: 'Không tìm thấy NPC.' };
  edNodesEnsureAiFields(npc);
  if (npc.aiStates.indexOf(from) < 0 || npc.aiStates.indexOf(to) < 0) {
    return { ok: false, reason: 'State AI không có trong danh sách.' };
  }
  if (from === to) return { ok: false, reason: 'Transition phải chuyển sang state khác.' };
  var cond = edNodesNormAiCond(condition);
  if (ED_NODES_AI_CONDITIONS.indexOf(cond.type) < 0) {
    return { ok: false, reason: 'Điều kiện AI không hợp lệ.' };
  }
  if ((cond.type === 'detect' || cond.type === 'attack') && !isFinite(Number(cond.radius))) {
    cond.radius = (cond.type === 'attack')
      ? edNodesClampNum(npc.attackRadius, 0.5, 10, 1.5)
      : edNodesClampNum(npc.detectionRadius, 0, 30, 5);
  }
  for (var i = 0; i < npc.aiTransitions.length; i++) {
    var tr = npc.aiTransitions[i];
    var c2 = edNodesNormAiCond(tr.condition);
    if (tr.from === from && tr.to === to && c2.type === cond.type &&
        (c2.radius || null) === (cond.radius || null)) {
      return { ok: false, reason: 'Transition AI này đã có rồi.' };
    }
  }
  npc.aiTransitions.push({ from: from, to: to, condition: cond });
  return { ok: true };
}

function edNodesRemoveAiTransition(project, npcId, index) {
  var npc = edNodesGetNpc(project, npcId);
  if (!npc) return false;
  edNodesEnsureAiFields(npc);
  if (index < 0 || index >= npc.aiTransitions.length) return false;
  npc.aiTransitions.splice(index, 1);
  return true;
}

function edNodesRemoveAiTransitionByEnds(project, npcId, from, to, condType) {
  var npc = edNodesGetNpc(project, npcId);
  if (!npc) return false;
  edNodesEnsureAiFields(npc);
  var removed = false;
  for (var i = npc.aiTransitions.length - 1; i >= 0; i--) {
    var tr = npc.aiTransitions[i];
    if (tr && tr.from === from && tr.to === to &&
        (condType === undefined || condType === null ||
         edNodesNormAiCond(tr.condition).type === condType)) {
      npc.aiTransitions.splice(i, 1);
      removed = true;
    }
  }
  return removed;
}

/* Đặt AI hiện tại của NPC (ghi đúng npcs[].ai). Chỉ nhận 1 trong 6 mode. */
function edNodesSetNpcAi(project, npcId, mode) {
  var npc = edNodesGetNpc(project, npcId);
  if (!npc) return false;
  if (ED_NODES_AI_STATES.indexOf(mode) < 0 || mode === 'return') return false;
  npc.ai = mode;
  return true;
}

/* Đánh giá transition AI: trả state đích đầu tiên khớp, hoặc null.
   ctx: {enemyDist, hasTarget, lost, arrived, idleSec, hpPct, hpLow}.
   - detect: có địch và enemyDist <= radius (mặc định detectionRadius).
   - attack: có địch và enemyDist <= radius (mặc định attackRadius).
   - lost: mất dấu (ctx.lost hoặc !hasTarget).
   - arrive: ctx.arrived. - idle: ctx.idle hoặc idleSec >= seconds.
   - hpLow: hpPct <= pct (mặc định 30) hoặc ctx.hpLow. */
function edNodesEvalAiTransition(project, npcId, currentState, ctx) {
  var npc = edNodesGetNpc(project, npcId);
  if (!npc) return null;
  edNodesEnsureAiFields(npc);
  ctx = ctx || {};
  for (var i = 0; i < npc.aiTransitions.length; i++) {
    var tr = npc.aiTransitions[i];
    if (!tr || tr.from !== currentState) continue;
    var cond = edNodesNormAiCond(tr.condition);
    var hit = false;
    if (cond.type === 'detect') {
      var dr = isFinite(Number(cond.radius)) ? Number(cond.radius)
        : edNodesClampNum(npc.detectionRadius, 0, 30, 5);
      hit = (typeof ctx.enemyDist === 'number') ? (ctx.enemyDist <= dr) : !!ctx.hasTarget;
    } else if (cond.type === 'attack') {
      var ar = isFinite(Number(cond.radius)) ? Number(cond.radius)
        : edNodesClampNum(npc.attackRadius, 0.5, 10, 1.5);
      hit = (typeof ctx.enemyDist === 'number') ? (ctx.enemyDist <= ar) : !!ctx.hasTarget;
    } else if (cond.type === 'lost') {
      hit = !!ctx.lost || (ctx.hasTarget === false);
    } else if (cond.type === 'arrive') {
      hit = !!ctx.arrived;
    } else if (cond.type === 'idle') {
      if (isFinite(Number(cond.seconds))) {
        hit = (typeof ctx.idleSec === 'number') ? (ctx.idleSec >= Number(cond.seconds)) : !!ctx.idle;
      } else {
        hit = !!ctx.idle;
      }
    } else if (cond.type === 'hpLow') {
      var pct = isFinite(Number(cond.pct)) ? Number(cond.pct) : 30;
      hit = (typeof ctx.hpPct === 'number') ? (ctx.hpPct <= pct) : !!ctx.hpLow;
    }
    if (hit) return tr.to;
  }
  return null;
}

/* ---------------- (c) Quest chain — quests[].prerequisites ---------------- */

function edNodesGetQuest(project, questId) {
  if (!project || !Array.isArray(project.quests)) return null;
  for (var i = 0; i < project.quests.length; i++) {
    if (project.quests[i] && project.quests[i].id === questId) return project.quests[i];
  }
  return null;
}

function edNodesEnsureQuestPrereq(quest) {
  if (!quest || typeof quest !== 'object') return [];
  if (!Array.isArray(quest.prerequisites)) quest.prerequisites = [];
  return quest.prerequisites;
}

function edNodesNextQuestId(project) {
  if (ED.NpcAi && typeof ED.NpcAi.nextQuestId === 'function') {
    return ED.NpcAi.nextQuestId(project);
  }
  var quests = (project && Array.isArray(project.quests)) ? project.quests : [];
  var n = quests.length + 1;
  var used = {};
  quests.forEach(function (q) { if (q && q.id) used[q.id] = true; });
  while (used['q' + n]) n++;
  return 'q' + n;
}

/* Thêm quest mới (cùng shape với 08-npc-ai.js: id/name/desc/type/
   target/reward + prerequisites[] rỗng). Trả quest vừa tạo hoặc null. */
function edNodesAddQuest(project, name) {
  if (!project || typeof project !== 'object') return null;
  if (!Array.isArray(project.quests)) project.quests = [];
  var id = edNodesNextQuestId(project);
  var q = null;
  if (ED.NpcAi && typeof ED.NpcAi.newQuest === 'function') {
    q = ED.NpcAi.newQuest(id);
  } else {
    q = { id: id, name: 'Nhiệm vụ mới', desc: '', type: 'Phụ', target: '', reward: { knb: 0, silver: 0, item: '' } };
  }
  var nm = edNodesTrim(name);
  if (nm) q.name = nm.slice(0, 40);
  q.prerequisites = [];
  if (ED.NpcAi && typeof ED.NpcAi.addQuest === 'function') {
    if (!ED.NpcAi.addQuest(project, q)) return null;
  } else {
    project.quests.push(q);
  }
  return q;
}

/* Xoá quest: mất quest + mọi prerequisite trỏ tới nó ở quest khác. */
function edNodesRemoveQuest(project, questId) {
  if (!project || !Array.isArray(project.quests)) return false;
  var found = false;
  for (var i = project.quests.length - 1; i >= 0; i--) {
    if (project.quests[i] && project.quests[i].id === questId) {
      project.quests.splice(i, 1);
      found = true;
    }
  }
  if (!found) return false;
  project.quests.forEach(function (q) {
    if (q && Array.isArray(q.prerequisites)) {
      q.prerequisites = q.prerequisites.filter(function (p) { return p !== questId; });
    }
  });
  return true;
}

/* Quest A có phải (trực tiếp/gián tiếp) là prerequisite của quest B không?
   Đi theo cạnh prerequisite: từ B lần ngược prerequisites. */
function edNodesQuestDependsOn(project, questId, maybePrereqId, seen) {
  if (questId === maybePrereqId) return true;
  seen = seen || {};
  if (seen[questId]) return false;
  seen[questId] = true;
  var q = edNodesGetQuest(project, questId);
  if (!q) return false;
  var pre = edNodesEnsureQuestPrereq(q);
  for (var i = 0; i < pre.length; i++) {
    if (pre[i] === maybePrereqId) return true;
    if (edNodesQuestDependsOn(project, pre[i], maybePrereqId, seen)) return true;
  }
  return false;
}

/* Thêm prerequisite: quest sau (questId) cần quest trước (prereqId) xong
   mới mở. Từ chối: tự trỏ chính mình, trùng, quest không tồn tại, hoặc
   tạo vòng tròn (A cần B mà B đã (gián tiếp) cần A). */
function edNodesAddPrerequisite(project, questId, prereqId) {
  var q = edNodesGetQuest(project, questId);
  var pre = edNodesGetQuest(project, prereqId);
  if (!q || !pre) return { ok: false, reason: 'Không tìm thấy nhiệm vụ.' };
  if (questId === prereqId) return { ok: false, reason: 'Nhiệm vụ không thể là prerequisite của chính nó.' };
  var list = edNodesEnsureQuestPrereq(q);
  if (list.indexOf(prereqId) >= 0) return { ok: false, reason: 'Prerequisite này đã có rồi.' };
  if (edNodesQuestDependsOn(project, prereqId, questId)) {
    return { ok: false, reason: 'Nối này tạo vòng tròn trong chuỗi nhiệm vụ.' };
  }
  list.push(prereqId);
  return { ok: true };
}

function edNodesRemovePrerequisite(project, questId, prereqId) {
  var q = edNodesGetQuest(project, questId);
  if (!q) return false;
  var list = edNodesEnsureQuestPrereq(q);
  var idx = list.indexOf(prereqId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
}

/* Thứ tự làm nhiệm vụ (sắp xếp topo theo prerequisite). Trả
   {order:[questId...], hasCycle:bool}. Có vòng thì order chỉ chứa các
   quest xếp được, hasCycle=true. */
function edNodesQuestOrder(project) {
  var quests = (project && Array.isArray(project.quests)) ? project.quests : [];
  var indeg = {};
  var next = {};
  quests.forEach(function (q) {
    if (!q || !q.id) return;
    indeg[q.id] = 0;
    next[q.id] = [];
  });
  quests.forEach(function (q) {
    if (!q || !q.id) return;
    edNodesEnsureQuestPrereq(q).forEach(function (p) {
      if (indeg[p] !== undefined && indeg[q.id] !== undefined) {
        next[p].push(q.id);
        indeg[q.id]++;
      }
    });
  });
  var queue = [];
  Object.keys(indeg).forEach(function (id) { if (indeg[id] === 0) queue.push(id); });
  var order = [];
  while (queue.length) {
    var id = queue.shift();
    order.push(id);
    next[id].forEach(function (n) {
      indeg[n]--;
      if (indeg[n] === 0) queue.push(n);
    });
  }
  return { order: order, hasCycle: order.length !== Object.keys(indeg).length };
}

/* Quest đã mở chưa: mọi prerequisite đều nằm trong doneIds (mảng id
   hoặc object {id:true}). */
function edNodesEvalQuestAvailable(project, questId, doneIds) {
  var q = edNodesGetQuest(project, questId);
  if (!q) return false;
  var done = {};
  if (Array.isArray(doneIds)) {
    doneIds.forEach(function (id) { done[id] = true; });
  } else if (doneIds && typeof doneIds === 'object') {
    done = doneIds;
  }
  var pre = edNodesEnsureQuestPrereq(q);
  for (var i = 0; i < pre.length; i++) {
    if (!done[pre[i]]) return false;
  }
  return true;
}

/* ---------------- Đồ thị hiển thị (view thuần, không ghi project) ---------------- */

/* Dựng đồ thị để vẽ từ dữ liệu gốc. Trả
   {mode, id, current, nodes:[{id,label}], edges:[{from,to,condition,label}]}.
   nodes/edges chỉ là ảnh chụp để vẽ — sửa chúng không đổi project. */
function edNodesBuildGraph(project, mode, id) {
  var graph = { mode: mode, id: id || null, current: null, nodes: [], edges: [] };
  if (mode === 'anim') {
    var m = edNodesGetMachine(project, id);
    if (!m) return graph;
    graph.current = m.current;
    m.states.forEach(function (st) {
      graph.nodes.push({ id: st, label: (ED_NODES_ANIM_STATE_LABELS[st] || st) });
    });
    m.transitions.forEach(function (tr) {
      graph.edges.push({ from: tr.from, to: tr.to, condition: tr.condition,
        label: edNodesAnimCondLabel(tr.condition) });
    });
  } else if (mode === 'ai') {
    var npc = edNodesGetNpc(project, id);
    if (!npc) return graph;
    edNodesEnsureAiFields(npc);
    graph.current = npc.ai;
    npc.aiStates.forEach(function (st) {
      graph.nodes.push({ id: st, label: (ED_NODES_AI_STATE_LABELS[st] || st) });
    });
    npc.aiTransitions.forEach(function (tr) {
      graph.edges.push({ from: tr.from, to: tr.to, condition: tr.condition,
        label: edNodesAiCondLabel(tr.condition) });
    });
  } else if (mode === 'quest') {
    var quests = (project && Array.isArray(project.quests)) ? project.quests : [];
    quests.forEach(function (q) {
      if (!q || !q.id) return;
      graph.nodes.push({ id: q.id, label: q.name || q.id });
    });
    quests.forEach(function (q) {
      if (!q || !q.id) return;
      edNodesEnsureQuestPrereq(q).forEach(function (p) {
        graph.edges.push({ from: p, to: q.id, condition: null, label: 'cần trước' });
      });
    });
  }
  return graph;
}

/* Xếp vị trí node mặc định (thuần, xác định — không random):
   - quest: theo cột = độ sâu topo (prerequisite ở cột trái), hàng theo
     thứ tự trong order; quest ngoài order (vòng) xếp cột cuối.
   - anim/ai: lưới 2 cột theo thứ tự nodes.
   Trả {nodeId:{x,y}} (đơn vị world, gốc 0,0). */
function edNodesAutoLayout(project, mode, id) {
  var graph = edNodesBuildGraph(project, mode, id);
  var pos = {};
  var COL_W = 220;
  var ROW_H = 96;
  if (mode === 'quest') {
    var order = edNodesQuestOrder(project).order;
    var depth = {};
    var quests = (project && Array.isArray(project.quests)) ? project.quests : [];
    var byId = {};
    quests.forEach(function (q) { if (q && q.id) byId[q.id] = q; });
    var colCount = {};
    function depthOf(qid, seen) {
      if (depth[qid] !== undefined) return depth[qid];
      seen = seen || {};
      if (seen[qid]) return 0;
      seen[qid] = true;
      var q = byId[qid];
      if (!q) return 0;
      var pre = edNodesEnsureQuestPrereq(q);
      var d = 0;
      pre.forEach(function (p) {
        if (byId[p]) d = Math.max(d, depthOf(p, seen) + 1);
      });
      depth[qid] = d;
      return d;
    }
    graph.nodes.forEach(function (n) { depthOf(n.id, {}); });
    graph.nodes.forEach(function (n) {
      var col = depth[n.id] || 0;
      var row = colCount[col] || 0;
      colCount[col] = row + 1;
      pos[n.id] = { x: 20 + col * COL_W, y: 20 + row * ROW_H };
    });
    /* Quest chưa vào order (nằm trong vòng) vẫn đã có vị trí theo depth. */
    return pos;
  }
  graph.nodes.forEach(function (n, i) {
    pos[n.id] = { x: 20 + (i % 2) * COL_W, y: 20 + Math.floor(i / 2) * ROW_H };
  });
  return pos;
}

/* ---------------- Module ED.Nodes ---------------- */

ED.Nodes = {
  /* Hằng + logic thuần — test được bằng vm + stub DOM/THREE. */
  MODES: ED_NODES_MODES,
  MODE_LABELS: ED_NODES_MODE_LABELS,
  ANIM_STATES: ED_NODES_ANIM_STATES,
  ANIM_STATE_LABELS: ED_NODES_ANIM_STATE_LABELS,
  ANIM_CONDITIONS: ED_NODES_ANIM_CONDITIONS,
  ANIM_CONDITION_LABELS: ED_NODES_ANIM_CONDITION_LABELS,
  AI_STATES: ED_NODES_AI_STATES,
  AI_STATE_LABELS: ED_NODES_AI_STATE_LABELS,
  AI_CONDITIONS: ED_NODES_AI_CONDITIONS,
  AI_CONDITION_LABELS: ED_NODES_AI_CONDITION_LABELS,
  NODE_W: ED_NODES_NODE_W,
  NODE_H: ED_NODES_NODE_H,
  trim: edNodesTrim,
  clampNum: edNodesClampNum,
  normAiCond: edNodesNormAiCond,
  aiCondLabel: edNodesAiCondLabel,
  animCondLabel: edNodesAnimCondLabel,
  getMachine: edNodesGetMachine,
  addState: edNodesAddState,
  removeState: edNodesRemoveState,
  addTransition: edNodesAddTransition,
  removeTransition: edNodesRemoveTransition,
  removeTransitionByEnds: edNodesRemoveTransitionByEnds,
  setCurrentState: edNodesSetCurrentState,
  evalTransition: edNodesEvalTransition,
  getNpc: edNodesGetNpc,
  ensureAiFields: edNodesEnsureAiFields,
  addAiState: edNodesAddAiState,
  removeAiState: edNodesRemoveAiState,
  addAiTransition: edNodesAddAiTransition,
  removeAiTransition: edNodesRemoveAiTransition,
  removeAiTransitionByEnds: edNodesRemoveAiTransitionByEnds,
  setNpcAi: edNodesSetNpcAi,
  evalAiTransition: edNodesEvalAiTransition,
  getQuest: edNodesGetQuest,
  ensureQuestPrereq: edNodesEnsureQuestPrereq,
  nextQuestId: edNodesNextQuestId,
  addQuest: edNodesAddQuest,
  removeQuest: edNodesRemoveQuest,
  questDependsOn: edNodesQuestDependsOn,
  addPrerequisite: edNodesAddPrerequisite,
  removePrerequisite: edNodesRemovePrerequisite,
  questOrder: edNodesQuestOrder,
  evalQuestAvailable: edNodesEvalQuestAvailable,
  buildGraph: edNodesBuildGraph,
  autoLayout: edNodesAutoLayout,

  _localProject: null,
  _panel: null,
  _launcherBtn: null,
  _canvas: null,
  _ctx: null,
  _tabRowEl: null,
  _idSelectEl: null,
  _idLabelEl: null,
  _addRowEl: null,
  _inspectorEl: null,
  _zoomLabelEl: null,
  _state: {
    mode: 'anim', id: null, focusQuestId: null,
    graph: { mode: 'anim', id: null, current: null, nodes: [], edges: [] },
    layout: {}, /* graphKey -> {nodeId:{x,y}} */
    selected: null, /* {kind:'node'|'edge', id} | {kind:'edge', from, to, condition} */
    view: { ox: 0, oy: 0, k: 1 },
    drag: null, /* {type:'node'|'pan'|'connect'|'edge', ...} */
    pointers: {}, /* pointerId -> {x,y} (pinch zoom) */
    pinchDist: 0,
    tempEdge: null /* {from, x, y} khi đang kéo nối */
  },

  project: function () {
    if (ED.Core && typeof ED.Core.getProject === 'function') {
      var p = null;
      try { p = ED.Core.getProject(); } catch (e) { p = null; }
      if (p && typeof p === 'object') return p;
    }
    if (ED.Animation && typeof ED.Animation.project === 'function') {
      try { return ED.Animation.project(); } catch (e) {}
    }
    if (ED.NpcAi && typeof ED.NpcAi.project === 'function') {
      try { return ED.NpcAi.project(); } catch (e) {}
    }
    if (!this._localProject) {
      this._localProject = { version: 1, name: 'Project mới', terrain: {}, env: {},
        objects: [], npcs: [], quests: [], characters: [], animations: [], stateMachines: {} };
    }
    return this._localProject;
  },

  commit: function (label) {
    try {
      if (ED.Core) {
        if (typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(label || 'Node Editor');
        if (typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
      }
    } catch (e) {}
    try {
      if (ED.UI) {
        if (typeof ED.UI.refreshHierarchy === 'function') ED.UI.refreshHierarchy();
        if (typeof ED.UI.refreshInspector === 'function') ED.UI.refreshInspector();
      }
    } catch (e) {}
  },

  log: function (msg) {
    try { if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log(msg); } catch (e) {}
  },

  toast: function (msg) {
    try { if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg); } catch (e) {}
  },

  /* Khóa layout theo đồ thị đang mở: 'anim:<charId>' | 'ai:<npcId>' | 'quest'. */
  _graphKey: function () {
    var S = this._state;
    if (S.mode === 'quest') return 'quest';
    return S.mode + ':' + (S.id || '');
  },

  _ensureLayout: function () {
    var S = this._state;
    var key = this._graphKey();
    if (!S.layout[key]) S.layout[key] = edNodesAutoLayout(this.project(), S.mode, S.id);
    var lay = S.layout[key];
    /* Node mới xuất hiện sau (thêm state/quest) mà layout chưa có thì
       xếp vào cuối lưới, giữ nguyên vị trí node cũ. */
    var maxY = 20;
    var count = 0;
    S.graph.nodes.forEach(function (n) {
      if (lay[n.id]) { if (lay[n.id].y > maxY) maxY = lay[n.id].y; count++; }
    });
    S.graph.nodes.forEach(function (n) {
      if (!lay[n.id]) {
        lay[n.id] = { x: 20 + (count % 2) * 220, y: maxY + 96 };
        count++;
        maxY = lay[n.id].y;
      }
    });
    return lay;
  },

  /* Nạp lại đồ thị từ dữ liệu gốc (sau mỗi thay đổi / đổi tab / đổi id). */
  refresh: function () {
    var S = this._state;
    var project = this.project();
    if (S.mode === 'anim') {
      var chars = project.characters || [];
      if (!S.id || !edNodesGetMachine(project, S.id)) S.id = null;
      if (!S.id && chars.length) S.id = chars[0].id;
      if (S.id && !project.stateMachines) edNodesGetMachine(project, S.id);
    } else if (S.mode === 'ai') {
      var npcs = project.npcs || [];
      if (!S.id || !edNodesGetNpc(project, S.id)) S.id = null;
      if (!S.id && npcs.length) S.id = npcs[0].id;
    }
    S.graph = edNodesBuildGraph(project, S.mode, S.id);
    this._ensureLayout();
    this.renderTabs();
    this.renderIdSelect();
    this.renderAddRow();
    this.renderInspector();
    this.renderCanvas();
  },

  /* Mở node editor: mode 'anim'|'ai'|'quest', id = charId / npcId /
     questId (quest: id là quest được focus/chọn, có thể null = xem tất cả).
     Gọi từ Character Editor / NPC panel / Quest panel — các panel đó chỉ
     cần gọi ED.Nodes.open(...) mà không sửa file của module này. */
  open: function (mode, id) {
    if (ED_NODES_MODES.indexOf(mode) < 0) mode = 'anim';
    this._state.mode = mode;
    if (mode === 'quest') {
      this._state.focusQuestId = id || null;
      this._state.selected = id ? { kind: 'node', id: id } : null;
    } else {
      this._state.id = id || null;
      this._state.selected = null;
    }
    if (!this._panel) this.init();
    if (this._panel) {
      this._panel.style.display = '';
      if (this._panel.classList && this._panel.classList.remove) {
        this._panel.classList.remove('hidden');
      }
    }
    this.refresh();
    this._fitCanvas();
    this.renderCanvas();
    return true;
  },

  openAnim: function (charId) { return this.open('anim', charId); },
  openAi: function (npcId) { return this.open('ai', npcId); },
  openQuest: function (questId) { return this.open('quest', questId); },

  close: function () {
    if (this._panel) {
      this._panel.style.display = 'none';
      if (this._panel.classList && this._panel.classList.add) {
        this._panel.classList.add('hidden');
      }
    }
    return true;
  },

  /* ---------------- Panel + canvas (DOM — chỉ trong init) ---------------- */

  init: function () {
    if (typeof document === 'undefined') return false;
    if (this._panel) return true;
    var self = this;
    var S = this._state;

    /* CSS riêng của module (không sửa editor.css). */
    if (!document.getElementById('ed-nodes-style')) {
      var style = document.createElement('style');
      style.id = 'ed-nodes-style';
      style.textContent =
        '.ed-nodes-panel{position:fixed;right:8px;top:8px;z-index:60;width:min(520px,96vw);' +
        'max-height:92vh;display:flex;flex-direction:column;background:#1e2126;color:#e5e7eb;' +
        'border:1px solid #3a3f47;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);' +
        'font-size:14px;overflow:hidden}' +
        '.ed-nodes-head{display:flex;align-items:center;gap:8px;padding:8px 10px;' +
        'background:#26292f;border-bottom:1px solid #3a3f47}' +
        '.ed-nodes-title{flex:1;font-weight:700}' +
        '.ed-nodes-tabs{display:flex;gap:6px;padding:8px 10px 0}' +
        '.ed-nodes-tab{flex:1;min-height:40px;border:1px solid #3a3f47;background:#26292f;' +
        'color:#e5e7eb;border-radius:8px;cursor:pointer}' +
        '.ed-nodes-tab.active{background:#2563eb;border-color:#2563eb;color:#fff}' +
        '.ed-nodes-row{display:flex;gap:6px;align-items:center;padding:8px 10px 0;flex-wrap:wrap}' +
        '.ed-nodes-row select,.ed-nodes-row input{flex:1;min-height:40px;background:#111318;' +
        'color:#e5e7eb;border:1px solid #3a3f47;border-radius:8px;padding:0 8px;min-width:0}' +
        '.ed-nodes-btn{min-height:40px;min-width:40px;padding:0 12px;border:1px solid #3a3f47;' +
        'background:#2b2f36;color:#e5e7eb;border-radius:8px;cursor:pointer}' +
        '.ed-nodes-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}' +
        '.ed-nodes-btn.danger{background:#7f1d1d;border-color:#991b1b;color:#fff}' +
        '.ed-nodes-canvas-wrap{margin:8px 10px 0;border:1px solid #3a3f47;border-radius:8px;' +
        'overflow:hidden;background:#14161a;flex:1;min-height:280px;position:relative}' +
        '.ed-nodes-canvas-wrap canvas{display:block;width:100%;height:100%;touch-action:none}' +
        '.ed-nodes-hint{padding:6px 12px 0;color:#9ca3af;font-size:12px}' +
        '.ed-nodes-inspector{margin:8px 10px 10px;padding:8px;border:1px solid #3a3f47;' +
        'border-radius:8px;background:#26292f;max-height:180px;overflow:auto}' +
        '.ed-nodes-inspector select,.ed-nodes-inspector input{width:100%;min-height:40px;' +
        'background:#111318;color:#e5e7eb;border:1px solid #3a3f47;border-radius:8px;' +
        'padding:0 8px;margin:4px 0}' +
        '.ed-nodes-launcher{position:fixed;right:8px;bottom:8px;z-index:59;min-height:44px;' +
        'padding:0 16px;border-radius:22px;border:1px solid #2563eb;background:#2563eb;' +
        'color:#fff;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4)}';
      var head = document.head || document.getElementsByTagName('head')[0];
      if (head && head.appendChild) head.appendChild(style);
      else if (document.body) document.body.appendChild(style);
    }

    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = text;
      return e;
    }
    function btn(label, fn, cls) {
      var b = el('button', 'ed-nodes-btn' + (cls ? ' ' + cls : ''), label);
      b.addEventListener('click', fn);
      return b;
    }

    /* Nút mở nhanh (launcher) — đặt trong module này, không sửa panel khác. */
    var launcher = btn('🕸 Node Editor', function () {
      if (self._panel && self._panel.style.display === 'none') self.open(S.mode, S.id);
      else self.close();
    }, 'ed-nodes-launcher');
    launcher.className = 'ed-nodes-launcher';
    document.body.appendChild(launcher);
    this._launcherBtn = launcher;

    var panel = el('div', 'ed-nodes-panel');
    panel.style.display = 'none';
    document.body.appendChild(panel);
    this._panel = panel;

    var headRow = el('div', 'ed-nodes-head');
    headRow.appendChild(el('span', 'ed-nodes-title', '🕸 Node Editor'));
    headRow.appendChild(btn('✕ Đóng', function () { self.close(); }));
    panel.appendChild(headRow);

    /* Tabs 3 chế độ. */
    var tabs = el('div', 'ed-nodes-tabs');
    ED_NODES_MODES.forEach(function (m) {
      var t = btn(ED_NODES_MODE_LABELS[m], function () {
        S.mode = m;
        S.selected = null;
        if (m === 'quest') S.focusQuestId = null;
        self.refresh();
      }, 'ed-nodes-tab');
      t.setAttribute('data-mode', m);
      tabs.appendChild(t);
    });
    panel.appendChild(tabs);
    this._tabRowEl = tabs;

    /* Hàng chọn đối tượng (nhân vật / NPC / quest focus). */
    var idRow = el('div', 'ed-nodes-row');
    idRow.appendChild(el('span', '', 'Đối tượng:'));
    var idSel = el('select', '');
    idSel.addEventListener('change', function () {
      if (S.mode === 'quest') {
        S.focusQuestId = idSel.value || null;
        S.selected = S.focusQuestId ? { kind: 'node', id: S.focusQuestId } : null;
      } else {
        S.id = idSel.value || null;
        S.selected = null;
      }
      self.refresh();
    });
    idRow.appendChild(idSel);
    this._idSelectEl = idSel;
    panel.appendChild(idRow);

    /* Hàng thêm node + zoom. */
    var addRow = el('div', 'ed-nodes-row');
    panel.appendChild(addRow);
    this._addRowEl = addRow;

    var zoomRow = el('div', 'ed-nodes-row');
    zoomRow.appendChild(btn('－', function () { self.setZoom(S.view.k / 1.25); }));
    var zoomLabel = el('span', '', '100%');
    zoomRow.appendChild(zoomLabel);
    this._zoomLabelEl = zoomLabel;
    zoomRow.appendChild(btn('＋', function () { self.setZoom(S.view.k * 1.25); }));
    zoomRow.appendChild(btn('⟲ Vừa màn hình', function () { self.resetView(); }));
    panel.appendChild(zoomRow);

    /* Canvas. */
    var wrap = el('div', 'ed-nodes-canvas-wrap');
    var canvas = document.createElement('canvas');
    canvas.className = 'ed-nodes-canvas';
    wrap.appendChild(canvas);
    panel.appendChild(wrap);
    this._canvas = canvas;
    this._bindCanvas(canvas);

    panel.appendChild(el('div', 'ed-nodes-hint',
      'Kéo node để dời · Kéo từ cổng phải (●) sang cổng trái (○) của node khác để nối · ' +
      'Bấm vào 1 nối để xoá nối đó · Kéo nền để di chuyển canvas · Chụm 2 ngón / lăn chuột để zoom.'));

    /* Inspector node/nối đang chọn. */
    var insp = el('div', 'ed-nodes-inspector', 'Chưa chọn node hay nối nào.');
    panel.appendChild(insp);
    this._inspectorEl = insp;

    /* Project load về sau: vẽ lại nếu panel đang mở. */
    try {
      if (ED.Core && typeof ED.Core.onChange === 'function') {
        ED.Core.onChange(function () {
          if (self._panel && self._panel.style.display !== 'none') self.refresh();
        });
      }
    } catch (e) {}

    return true;
  },

  /* ---------------- Render panel ---------------- */

  renderTabs: function () {
    if (!this._tabRowEl || typeof document === 'undefined') return;
    var S = this._state;
    var tabs = this._tabRowEl.querySelectorAll
      ? this._tabRowEl.querySelectorAll('.ed-nodes-tab')
      : this._tabRowEl.children;
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var m = t.getAttribute ? t.getAttribute('data-mode') : null;
      if (t.classList) {
        if (m === S.mode) t.classList.add('active');
        else t.classList.remove('active');
      }
    }
  },

  renderIdSelect: function () {
    var sel = this._idSelectEl;
    if (!sel || typeof document === 'undefined') return;
    var S = this._state;
    var project = this.project();
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    function opt(value, text) {
      var o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      sel.appendChild(o);
    }
    if (S.mode === 'anim') {
      var chars = project.characters || [];
      if (!chars.length) opt('', '— Chưa có nhân vật nào —');
      chars.forEach(function (c) { opt(c.id, c.name + ' (Lv' + c.level + ')'); });
      sel.value = S.id || '';
    } else if (S.mode === 'ai') {
      var npcs = project.npcs || [];
      if (!npcs.length) opt('', '— Chưa có NPC nào —');
      npcs.forEach(function (n) { opt(n.id, n.name + ' · ' + (n.ai || 'idle')); });
      sel.value = S.id || '';
    } else {
      opt('', '— Toàn bộ chuỗi nhiệm vụ —');
      (project.quests || []).forEach(function (q) { opt(q.id, q.id + ' · ' + q.name); });
      sel.value = S.focusQuestId || '';
    }
  },

  renderAddRow: function () {
    var row = this._addRowEl;
    if (!row || typeof document === 'undefined') return;
    var self = this;
    var S = this._state;
    var project = this.project();
    while (row.firstChild) row.removeChild(row.firstChild);
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = text;
      return e;
    }
    function btn(label, fn, cls) {
      var b = el('button', 'ed-nodes-btn' + (cls ? ' ' + cls : ''), label);
      b.addEventListener('click', fn);
      return b;
    }
    if (S.mode === 'anim') {
      var inp = el('input');
      inp.type = 'text';
      inp.placeholder = 'Tên state mới (vd: Dodge)…';
      row.appendChild(inp);
      row.appendChild(btn('＋ Thêm state', function () {
        if (!S.id) { self.toast('Chưa có nhân vật nào để thêm state.'); return; }
        var name = edNodesTrim(inp.value);
        if (!name) { self.toast('Nhập tên state trước.'); return; }
        self.commit('Thêm state ' + name);
        if (!edNodesAddState(project, S.id, name)) {
          self.toast('Không thêm được state (trùng tên hoặc quá dài).');
          return;
        }
        inp.value = '';
        self.refresh();
        self.toast('Đã thêm state "' + name + '". Kéo nối từ state khác sang để tạo transition.');
      }, 'primary'));
    } else if (S.mode === 'ai') {
      var npc = S.id ? edNodesGetNpc(project, S.id) : null;
      var sel = el('select');
      if (npc) edNodesEnsureAiFields(npc);
      var missing = [];
      ED_NODES_AI_STATES.forEach(function (st) {
        if (!npc || npc.aiStates.indexOf(st) < 0) missing.push(st);
      });
      if (!missing.length) {
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = '— Đã đủ 7 state AI —';
        sel.appendChild(o0);
      }
      missing.forEach(function (st) {
        var o = document.createElement('option');
        o.value = st;
        o.textContent = ED_NODES_AI_STATE_LABELS[st];
        sel.appendChild(o);
      });
      row.appendChild(sel);
      row.appendChild(btn('＋ Thêm state AI', function () {
        if (!S.id) { self.toast('Chưa có NPC nào để thêm state AI.'); return; }
        if (!sel.value) { self.toast('Không còn state AI nào để thêm.'); return; }
        self.commit('Thêm state AI ' + sel.value);
        if (!edNodesAddAiState(project, S.id, sel.value)) {
          self.toast('Không thêm được state AI này.');
          return;
        }
        self.refresh();
      }, 'primary'));
    } else {
      var qInp = el('input');
      qInp.type = 'text';
      qInp.placeholder = 'Tên nhiệm vụ mới…';
      row.appendChild(qInp);
      row.appendChild(btn('＋ Thêm nhiệm vụ', function () {
        self.commit('Thêm nhiệm vụ');
        var q = edNodesAddQuest(project, qInp.value);
        if (!q) { self.toast('Không thêm được nhiệm vụ.'); return; }
        qInp.value = '';
        S.focusQuestId = q.id;
        S.selected = { kind: 'node', id: q.id };
        self.refresh();
        self.toast('Đã thêm nhiệm vụ "' + q.name + '" (' + q.id + '). Kéo nối từ nhiệm vụ trước sang để đặt prerequisite.');
      }, 'primary'));
    }
    row.appendChild(btn('🗑 Xoá đã chọn', function () { self.deleteSelected(); }, 'danger'));
  },

  renderInspector: function () {
    var box = this._inspectorEl;
    if (!box || typeof document === 'undefined') return;
    var self = this;
    var S = this._state;
    var project = this.project();
    while (box.firstChild) box.removeChild(box.firstChild);
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = text;
      return e;
    }
    function btn(label, fn, cls) {
      var b = el('button', 'ed-nodes-btn' + (cls ? ' ' + cls : ''), label);
      b.addEventListener('click', fn);
      return b;
    }
    var sel = S.selected;
    if (!sel) {
      box.textContent = 'Chưa chọn node hay nối nào — bấm 1 node để xem/sửa, bấm 1 nối để xoá nối đó.';
      return;
    }
    if (sel.kind === 'node') {
      var node = null;
      S.graph.nodes.forEach(function (n) { if (n.id === sel.id) node = n; });
      if (!node) { box.textContent = 'Node đã chọn không còn nữa.'; return; }
      box.appendChild(el('div', '', 'Node: ' + node.label + ' (' + node.id + ')'));
      if (S.mode === 'anim') {
        var m = edNodesGetMachine(project, S.id);
        var clip = (m && m.clips) ? m.clips[sel.id] : null;
        box.appendChild(el('div', '', 'Clip: ' + (clip || 'chưa gán (gán trong tab Timeline)') +
          (m && m.current === sel.id ? ' · ★ State hiện tại' : '')));
        if (m && m.current !== sel.id) {
          box.appendChild(btn('★ Đặt làm state hiện tại', function () {
            self.commit('Đổi state hiện tại');
            edNodesSetCurrentState(project, S.id, sel.id);
            self.refresh();
          }));
        }
      } else if (S.mode === 'ai') {
        var npc = edNodesGetNpc(project, S.id);
        if (npc) {
          box.appendChild(el('div', '', 'AI hiện tại: ' + (npc.ai || 'idle') +
            ' · Phát hiện: ' + (npc.detectionRadius || 5) +
            ' · Tấn công: ' + (npc.attackRadius || 1.5) +
            ' · Waypoint tuần tra: ' + ((npc.patrol || []).length)));
          if (npc.ai !== sel.id && sel.id !== 'return') {
            box.appendChild(btn('★ Đặt làm AI hiện tại', function () {
              self.commit('Đổi AI NPC');
              edNodesSetNpcAi(project, S.id, sel.id);
              self.refresh();
            }));
          }
        }
      } else {
        var q = edNodesGetQuest(project, sel.id);
        if (q) {
          box.appendChild(el('div', '', 'Loại: ' + (q.type || 'Phụ') + ' · Mục tiêu: ' + (q.target || '—')));
          box.appendChild(el('div', '', 'Prerequisite: ' + (edNodesEnsureQuestPrereq(q).join(', ') || 'không có (nhiệm vụ mở đầu)')));
          var order = edNodesQuestOrder(project);
          box.appendChild(el('div', '', order.hasCycle
            ? '⚠ Chuỗi nhiệm vụ đang có vòng tròn — kiểm tra lại các nối prerequisite.'
            : 'Thứ tự chuỗi: ' + order.order.join(' → ')));
        }
      }
      box.appendChild(btn('🗑 Xoá node này', function () { self.deleteSelected(); }, 'danger'));
      return;
    }
    /* Edge đang chọn: đổi điều kiện / xoá nối. */
    var edge = null;
    S.graph.edges.forEach(function (e2) {
      if (e2.from === sel.from && e2.to === sel.to) {
        if (S.mode === 'anim') { if (e2.condition === sel.condition) edge = e2; }
        else if (S.mode === 'ai') {
          if (edNodesNormAiCond(e2.condition).type === edNodesNormAiCond(sel.condition).type) edge = e2;
        } else { edge = e2; }
      }
    });
    if (!edge) { box.textContent = 'Nối đã chọn không còn nữa.'; return; }
    box.appendChild(el('div', '', 'Nối: ' + edge.from + ' → ' + edge.to));
    if (S.mode === 'anim') {
      box.appendChild(el('div', '', 'Điều kiện hiện tại: ' + edNodesAnimCondLabel(edge.condition)));
      var condSel = el('select');
      ED_NODES_ANIM_CONDITIONS.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c;
        o.textContent = ED_NODES_ANIM_CONDITION_LABELS[c];
        condSel.appendChild(o);
      });
      condSel.value = edge.condition;
      box.appendChild(condSel);
      box.appendChild(btn('Lưu điều kiện', function () {
        self.commit('Đổi điều kiện transition');
        edNodesRemoveTransitionByEnds(project, S.id, edge.from, edge.to, edge.condition);
        var r = edNodesAddTransition(project, S.id, edge.from, edge.to, condSel.value);
        if (!r.ok) {
          edNodesAddTransition(project, S.id, edge.from, edge.to, edge.condition);
          self.toast(r.reason);
          return;
        }
        S.selected = { kind: 'edge', from: edge.from, to: edge.to, condition: condSel.value };
        self.refresh();
      }, 'primary'));
    } else if (S.mode === 'ai') {
      var cond = edNodesNormAiCond(edge.condition);
      box.appendChild(el('div', '', 'Điều kiện hiện tại: ' + edNodesAiCondLabel(edge.condition)));
      var aiSel = el('select');
      ED_NODES_AI_CONDITIONS.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c;
        o.textContent = ED_NODES_AI_CONDITION_LABELS[c];
        aiSel.appendChild(o);
      });
      aiSel.value = cond.type;
      box.appendChild(aiSel);
      var radInp = el('input');
      radInp.type = 'number';
      radInp.min = '0';
      radInp.max = '30';
      radInp.step = '0.5';
      radInp.placeholder = 'Bán kính (chỉ cho Phát hiện / Tầm đánh)';
      if (isFinite(Number(cond.radius))) radInp.value = String(cond.radius);
      box.appendChild(radInp);
      box.appendChild(btn('Lưu điều kiện', function () {
        self.commit('Đổi điều kiện AI');
        var nc = { type: aiSel.value };
        if ((nc.type === 'detect' || nc.type === 'attack') && radInp.value !== '') {
          nc.radius = edNodesClampNum(radInp.value, 0, 30, 5);
        }
        edNodesRemoveAiTransitionByEnds(project, S.id, edge.from, edge.to, cond.type);
        var r = edNodesAddAiTransition(project, S.id, edge.from, edge.to, nc);
        if (!r.ok) {
          edNodesAddAiTransition(project, S.id, edge.from, edge.to, edge.condition);
          self.toast(r.reason);
          return;
        }
        S.selected = { kind: 'edge', from: edge.from, to: edge.to, condition: nc };
        self.refresh();
      }, 'primary'));
    } else {
      box.appendChild(el('div', '', 'Prerequisite: "' + edge.from + '" phải xong trước "' + edge.to + '".'));
    }
    box.appendChild(btn('✕ Xoá nối này', function () { self.deleteSelectedEdge(); }, 'danger'));
  },

  /* Xoá node đang chọn (kèm mọi nối liên quan) — ghi đúng dữ liệu gốc. */
  deleteSelected: function () {
    var S = this._state;
    var sel = S.selected;
    if (!sel) { this.toast('Chưa chọn node hay nối nào để xoá.'); return false; }
    if (sel.kind === 'edge') return this.deleteSelectedEdge();
    var project = this.project();
    this.commit('Xoá node ' + sel.id);
    var ok = false;
    if (S.mode === 'anim') ok = edNodesRemoveState(project, S.id, sel.id);
    else if (S.mode === 'ai') ok = edNodesRemoveAiState(project, S.id, sel.id);
    else ok = edNodesRemoveQuest(project, sel.id);
    if (!ok) {
      this.toast(S.mode === 'ai'
        ? 'Không xoá được node AI này (có thể đang là AI hiện tại của NPC — đổi AI sang state khác trước).'
        : 'Không xoá được node này.');
      return false;
    }
    S.selected = null;
    this.refresh();
    this.toast('Đã xoá node "' + sel.id + '" và các nối liên quan.');
    return true;
  },

  /* Xoá nối đang chọn — ghi đúng dữ liệu gốc. */
  deleteSelectedEdge: function () {
    var S = this._state;
    var sel = S.selected;
    if (!sel || sel.kind !== 'edge') { this.toast('Chưa chọn nối nào để xoá.'); return false; }
    var project = this.project();
    this.commit('Xoá nối ' + sel.from + ' → ' + sel.to);
    var ok = false;
    if (S.mode === 'anim') ok = edNodesRemoveTransitionByEnds(project, S.id, sel.from, sel.to, sel.condition);
    else if (S.mode === 'ai') {
      ok = edNodesRemoveAiTransitionByEnds(project, S.id, sel.from, sel.to,
        sel.condition ? edNodesNormAiCond(sel.condition).type : null);
    } else {
      ok = edNodesRemovePrerequisite(project, sel.to, sel.from);
    }
    if (!ok) { this.toast('Không xoá được nối này.'); return false; }
    S.selected = null;
    this.refresh();
    this.toast('Đã xoá nối ' + sel.from + ' → ' + sel.to + '.');
    return true;
  },

  /* Tạo nối từ kéo cổng: điều kiện mặc định rồi user sửa trong inspector. */
  createEdge: function (from, to) {
    var S = this._state;
    var project = this.project();
    if (from === to) { this.toast('Không nối 1 node với chính nó.'); return false; }
    this.commit('Thêm nối ' + from + ' → ' + to);
    var r = null;
    if (S.mode === 'anim') {
      r = edNodesAddTransition(project, S.id, from, to, 'moving');
      if (!r.ok) { this.toast(r.reason); return false; }
      S.selected = { kind: 'edge', from: from, to: to, condition: 'moving' };
    } else if (S.mode === 'ai') {
      var npc = edNodesGetNpc(project, S.id);
      var cond = { type: 'detect', radius: npc ? edNodesClampNum(npc.detectionRadius, 0, 30, 5) : 5 };
      r = edNodesAddAiTransition(project, S.id, from, to, cond);
      if (!r.ok) { this.toast(r.reason); return false; }
      S.selected = { kind: 'edge', from: from, to: to, condition: cond };
    } else {
      r = edNodesAddPrerequisite(project, to, from);
      if (!r.ok) { this.toast(r.reason); return false; }
      S.selected = { kind: 'edge', from: from, to: to, condition: null };
    }
    this.refresh();
    this.toast('Đã nối ' + from + ' → ' + to + '. ' +
      (S.mode === 'quest' ? '' : 'Đổi điều kiện trong khung bên dưới nếu cần.'));
    return true;
  },

  /* ---------------- Canvas: toạ độ / zoom / vẽ ---------------- */

  setZoom: function (k) {
    var S = this._state;
    S.view.k = edNodesClampNum(k, 0.4, 2.5, 1);
    if (this._zoomLabelEl) this._zoomLabelEl.textContent = Math.round(S.view.k * 100) + '%';
    this.renderCanvas();
  },

  resetView: function () {
    this._state.view = { ox: 0, oy: 0, k: 1 };
    if (this._zoomLabelEl) this._zoomLabelEl.textContent = '100%';
    this.renderCanvas();
  },

  _fitCanvas: function () {
    var c = this._canvas;
    if (!c) return;
    try {
      var w = c.clientWidth || c.parentNode.clientWidth || 480;
      var h = c.clientHeight || 300;
      var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
    } catch (e) {}
  },

  _toScreen: function (x, y) {
    var v = this._state.view;
    return { x: (x + v.ox) * v.k, y: (y + v.oy) * v.k };
  },

  _toWorld: function (x, y) {
    var v = this._state.view;
    return { x: x / v.k - v.ox, y: y / v.k - v.oy };
  },

  _nodeAt: function (wx, wy) {
    var S = this._state;
    var lay = this._ensureLayout();
    for (var i = S.graph.nodes.length - 1; i >= 0; i--) {
      var n = S.graph.nodes[i];
      var p = lay[n.id];
      if (!p) continue;
      if (wx >= p.x && wx <= p.x + ED_NODES_NODE_W &&
          wy >= p.y && wy <= p.y + ED_NODES_NODE_H) {
        return n;
      }
    }
    return null;
  },

  _portAt: function (wx, wy) {
    /* Cổng phải (output, ●) để bắt đầu kéo nối; cổng trái (input, ○) để thả. */
    var S = this._state;
    var lay = this._ensureLayout();
    for (var i = 0; i < S.graph.nodes.length; i++) {
      var n = S.graph.nodes[i];
      var p = lay[n.id];
      if (!p) continue;
      var cx = p.x + ED_NODES_NODE_W;
      var cy = p.y + ED_NODES_NODE_H / 2;
      var dx = wx - cx, dy = wy - cy;
      if (dx * dx + dy * dy <= 16 * 16) return { node: n, side: 'out' };
      var lx = p.x;
      var dx2 = wx - lx, dy2 = wy - cy;
      if (dx2 * dx2 + dy2 * dy2 <= 16 * 16) return { node: n, side: 'in' };
    }
    return null;
  },

  _bezierPoint: function (x0, y0, x1, y1, t) {
    var mx0 = x0 + Math.max(40, Math.abs(x1 - x0) * 0.5);
    var mx1 = x1 - Math.max(40, Math.abs(x1 - x0) * 0.5);
    var u = 1 - t;
    var x = u * u * u * x0 + 3 * u * u * t * mx0 + 3 * u * t * t * mx1 + t * t * t * x1;
    var y = u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t * t * t * y1;
    return { x: x, y: y };
  },

  _edgeAt: function (wx, wy) {
    var S = this._state;
    var lay = this._ensureLayout();
    for (var i = 0; i < S.graph.edges.length; i++) {
      var e = S.graph.edges[i];
      var a = lay[e.from], b = lay[e.to];
      if (!a || !b) continue;
      var x0 = a.x + ED_NODES_NODE_W, y0 = a.y + ED_NODES_NODE_H / 2;
      var x1 = b.x, y1 = b.y + ED_NODES_NODE_H / 2;
      for (var s = 0; s <= 20; s++) {
        var pt = this._bezierPoint(x0, y0, x1, y1, s / 20);
        var dx = wx - pt.x, dy = wy - pt.y;
        if (dx * dx + dy * dy <= 12 * 12) return e;
      }
    }
    return null;
  },

  _roundRect: function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  renderCanvas: function () {
    var c = this._canvas;
    if (!c || typeof document === 'undefined') return;
    if (!this._ctx) {
      try { this._ctx = c.getContext('2d'); } catch (e) { return; }
    }
    var ctx = this._ctx;
    if (!ctx) return;
    var S = this._state;
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    var W = c.width / dpr, H = c.height / dpr;
    try { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e) {}
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#14161a';
    ctx.fillRect(0, 0, W, H);
    var lay = this._ensureLayout();

    function P(x, y) {
      var v = S.view;
      return { x: (x + v.ox) * v.k, y: (y + v.oy) * v.k };
    }

    /* Nối (vẽ trước node). */
    var self = this;
    S.graph.edges.forEach(function (e) {
      var a = lay[e.from], b = lay[e.to];
      if (!a || !b) return;
      var p0 = P(a.x + ED_NODES_NODE_W, a.y + ED_NODES_NODE_H / 2);
      var p1 = P(b.x, b.y + ED_NODES_NODE_H / 2);
      var isSel = S.selected && S.selected.kind === 'edge' &&
        S.selected.from === e.from && S.selected.to === e.to;
      var mx0 = p0.x + Math.max(40 * S.view.k, Math.abs(p1.x - p0.x) * 0.5);
      var mx1 = p1.x - Math.max(40 * S.view.k, Math.abs(p1.x - p0.x) * 0.5);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.bezierCurveTo(mx0, p0.y, mx1, p1.y, p1.x, p1.y);
      ctx.strokeStyle = isSel ? '#f59e0b' : '#60a5fa';
      ctx.lineWidth = isSel ? 3.5 : 2;
      ctx.stroke();
      /* Mũi tên ở đầu nối. */
      var ax = p1.x, ay = p1.y;
      var dir = self._bezierPoint(a.x + ED_NODES_NODE_W, a.y + ED_NODES_NODE_H / 2,
        b.x, b.y + ED_NODES_NODE_H / 2, 0.97);
      var dir2 = self._bezierPoint(a.x + ED_NODES_NODE_W, a.y + ED_NODES_NODE_H / 2,
        b.x, b.y + ED_NODES_NODE_H / 2, 1);
      ang = Math.atan2(dir2.y - dir.y, dir2.x - dir.x);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 10 * Math.cos(ang - 0.4), ay - 10 * Math.sin(ang - 0.4));
      ctx.lineTo(ax - 10 * Math.cos(ang + 0.4), ay - 10 * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fillStyle = isSel ? '#f59e0b' : '#60a5fa';
      ctx.fill();
      /* Nhãn điều kiện giữa nối. */
      if (e.label) {
        var mid = self._bezierPoint(a.x + ED_NODES_NODE_W, a.y + ED_NODES_NODE_H / 2,
          b.x, b.y + ED_NODES_NODE_H / 2, 0.5);
        var mp = P(mid.x, mid.y);
        ctx.font = '11px sans-serif';
        var tw = ctx.measureText ? ctx.measureText(e.label).width : e.label.length * 6;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(mp.x - tw / 2 - 4, mp.y - 9, tw + 8, 16);
        ctx.fillStyle = '#e5e7eb';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, mp.x, mp.y + 3);
        ctx.textAlign = 'left';
      }
    });

    /* Nối tạm khi đang kéo từ cổng. */
    if (S.tempEdge) {
      var t = S.tempEdge;
      var tp0 = P(t.x0, t.y0);
      var tp1 = { x: t.x, y: t.y };
      ctx.beginPath();
      ctx.moveTo(tp0.x, tp0.y);
      ctx.bezierCurveTo(tp0.x + 60, tp0.y, tp1.x - 60, tp1.y, tp1.x, tp1.y);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* Node. */
    S.graph.nodes.forEach(function (n) {
      var p = lay[n.id];
      if (!p) return;
      var sp = P(p.x, p.y);
      var w = ED_NODES_NODE_W * S.view.k, h = ED_NODES_NODE_H * S.view.k;
      var isSel = S.selected && S.selected.kind === 'node' && S.selected.id === n.id;
      var isCur = S.graph.current && S.graph.current === n.id;
      ctx.fillStyle = isCur ? '#1e3a5f' : '#26292f';
      ctx.strokeStyle = isSel ? '#f59e0b' : (isCur ? '#60a5fa' : '#3a3f47');
      ctx.lineWidth = isSel ? 3 : 1.5;
      self._roundRect(ctx, sp.x, sp.y, w, h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e5e7eb';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      var label = n.label.length > 18 ? n.label.slice(0, 17) + '…' : n.label;
      ctx.fillText(label, sp.x + w / 2, sp.y + h / 2 - 2);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.fillText((isCur ? '★ hiện tại · ' : '') + n.id, sp.x + w / 2, sp.y + h / 2 + 14);
      ctx.textAlign = 'left';
      /* Cổng: trái ○ (input), phải ● (output). */
      ctx.beginPath();
      ctx.arc(sp.x, sp.y + h / 2, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#14161a';
      ctx.fill();
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sp.x + w, sp.y + h / 2, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#60a5fa';
      ctx.fill();
    });

    if (!S.graph.nodes.length) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(S.mode === 'quest'
        ? 'Chưa có nhiệm vụ nào — bấm “＋ Thêm nhiệm vụ”.'
        : (S.mode === 'anim'
          ? 'Chưa có nhân vật nào — nhập .fbx trong tab Character Editor trước.'
          : 'Chưa có NPC nào — bấm “➕ Thêm NPC” trong panel NPC / Quest trước.'),
        W / 2, H / 2);
      ctx.textAlign = 'left';
    }
  },

  /* ---------------- Tương tác canvas (pointer: chuột + chạm) ---------------- */

  _bindCanvas: function (canvas) {
    var self = this;
    var S = this._state;
    function posOf(e) {
      var r = { left: 0, top: 0 };
      try { r = canvas.getBoundingClientRect(); } catch (err) {}
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    canvas.addEventListener('pointerdown', function (e) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      var p = posOf(e);
      S.pointers[e.pointerId] = p;
      var ids = Object.keys(S.pointers);
      if (ids.length === 2) {
        var a = S.pointers[ids[0]], b = S.pointers[ids[1]];
        S.pinchDist = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
        S.drag = { type: 'pinch', startK: S.view.k };
        return;
      }
      var w = self._toWorld(p.x, p.y);
      var port = self._portAt(w.x, w.y);
      if (port && port.side === 'out') {
        var lay = self._ensureLayout();
        var np = lay[port.node.id];
        S.drag = { type: 'connect', from: port.node.id, moved: false };
        S.tempEdge = { from: port.node.id,
          x0: np.x + ED_NODES_NODE_W, y0: np.y + ED_NODES_NODE_H / 2, x: p.x, y: p.y };
        return;
      }
      var node = self._nodeAt(w.x, w.y);
      if (node) {
        var lp = self._ensureLayout()[node.id];
        S.drag = { type: 'node', id: node.id, startX: p.x, startY: p.y,
          origX: lp.x, origY: lp.y, moved: false };
        S.selected = { kind: 'node', id: node.id };
        self.renderInspector();
        self.renderCanvas();
        return;
      }
      var edge = self._edgeAt(w.x, w.y);
      if (edge) {
        S.drag = { type: 'edge', edge: edge, startX: p.x, startY: p.y, moved: false };
        S.selected = { kind: 'edge', from: edge.from, to: edge.to, condition: edge.condition };
        self.renderInspector();
        self.renderCanvas();
        return;
      }
      S.drag = { type: 'pan', startX: p.x, startY: p.y,
        origOx: S.view.ox, origOy: S.view.oy, moved: false };
    });
    canvas.addEventListener('pointermove', function (e) {
      var p = posOf(e);
      if (S.pointers[e.pointerId]) S.pointers[e.pointerId] = p;
      var ids = Object.keys(S.pointers);
      if (S.drag && S.drag.type === 'pinch' && ids.length >= 2) {
        var a = S.pointers[ids[0]], b = S.pointers[ids[1]];
        var d = Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
        if (S.pinchDist > 0 && d > 0) self.setZoom(S.drag.startK * (d / S.pinchDist));
        return;
      }
      if (!S.drag) return;
      var dx = p.x - S.drag.startX, dy = p.y - S.drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) S.drag.moved = true;
      if (S.drag.type === 'node') {
        var lay = self._ensureLayout();
        lay[S.drag.id] = {
          x: S.drag.origX + dx / S.view.k,
          y: S.drag.origY + dy / S.view.k
        };
        self.renderCanvas();
      } else if (S.drag.type === 'pan') {
        S.view.ox = S.drag.origOx + dx / S.view.k;
        S.view.oy = S.drag.origOy + dy / S.view.k;
        self.renderCanvas();
      } else if (S.drag.type === 'connect') {
        if (S.tempEdge) { S.tempEdge.x = p.x; S.tempEdge.y = p.y; }
        self.renderCanvas();
      }
    });
    function endPointer(e) {
      var p = posOf(e);
      delete S.pointers[e.pointerId];
      if (S.drag && S.drag.type === 'pinch') {
        S.drag = null;
        S.pinchDist = 0;
        return;
      }
      if (!S.drag) { S.tempEdge = null; return; }
      var d = S.drag;
      S.drag = null;
      if (d.type === 'connect') {
        S.tempEdge = null;
        var w = self._toWorld(p.x, p.y);
        var port = self._portAt(w.x, w.y);
        var target = port ? port.node : self._nodeAt(w.x, w.y);
        if (target && target.id !== d.from) {
          self.createEdge(d.from, target.id);
        } else {
          self.renderCanvas();
        }
        return;
      }
      if (d.type === 'edge' && !d.moved) {
        /* Bấm vào nối -> xoá nối đó (đã pushHistory trong deleteSelectedEdge). */
        S.selected = { kind: 'edge', from: d.edge.from, to: d.edge.to, condition: d.edge.condition };
        self.deleteSelectedEdge();
        return;
      }
      if (d.type === 'node' && !d.moved) {
        S.selected = { kind: 'node', id: d.id };
        self.renderInspector();
        self.renderCanvas();
        return;
      }
      if (d.type === 'pan' && !d.moved) {
        S.selected = null;
        self.renderInspector();
        self.renderCanvas();
        return;
      }
      self.renderCanvas();
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', function (e) {
      delete S.pointers[e.pointerId];
      S.drag = null;
      S.tempEdge = null;
      S.pinchDist = 0;
      self.renderCanvas();
    });
    canvas.addEventListener('wheel', function (e) {
      if (e.preventDefault) e.preventDefault();
      var f = (e.deltaY || 0) > 0 ? 0.9 : 1.1;
      self.setZoom(S.view.k * f);
    }, { passive: false });
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', function () {
        if (self._panel && self._panel.style.display !== 'none') {
          self._fitCanvas();
          self.renderCanvas();
        }
      });
    }
  }
};
