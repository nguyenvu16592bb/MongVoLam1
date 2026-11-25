/* ============================== 08-npc-ai.js ==============================
   ED.NpcAi — NPC / Patrol / AI / Quest cho Map Editor (nhóm C).
   - Đặt NPC: nút "➕ Thêm NPC" thêm tại vị trí trước camera (chibi
     placeholder/primitive của nhóm B khi có, không thì object data vẫn
     lưu đúng); tên mặc định "NPC mới".
   - Inspector NPC: tên, level, môn phái (Thiếu Lâm/Võ Đang/Nga Mi/Cái
     Bang/Minh Giáo/Tiêu Dao), loại (Thương nhân/Thợ rèn/Dược sư/Quest
     giver/Sư phụ/Bảo vệ/Dịch chuyển/Boss/Quái), dialogue (mỗi dòng 1 câu),
     bán kính tương tác, animation idle (idle/walk/talk).
   - Patrol: chế độ "Đặt waypoint" — click xuống đất thêm waypoint (object
     type 'waypoint', nối thành đường bằng Line màu vàng theo thứ tự
     patrol[] của NPC đang chọn), nút xoá waypoint, kéo waypoint dời được
     (qua gizmo của nhóm A; đồng bộ lại bằng onWaypointMoved).
   - AI behavior: Idle/Patrol/Wander/Follow/Chase/Attack + bán kính phát
     hiện + bán kính tấn công (lưu npcs[].ai, detectionRadius, attackRadius).
   - Quest editor: danh sách quest trong project.quests, thêm/sửa/xoá:
     ID tự sinh q1,q2..., tên, mô tả, loại (Chính/Tuyến/Phụ/Hằng ngày/Boss/
     Thu thập/Giết quái/Nói chuyện), mục tiêu (text), thưởng (KNB/bạc/vật
     phẩm text).
   - Đồng bộ NPC scene object <-> npcs[] qua ED.NpcAi.syncNpcObject(project,
     npc) — hàm thuần trên project JSON (nhóm A gọi khi cần; bản runtime
     ED.Core.syncNpcObject trỏ cùng hàm này khi ED.Core chưa có sẵn).
   Định dạng NPC theo game: src/02-world.js dòng ~699-747 (id/name/x/z/
   robe/hair/weapon/aura) + src/01-data.js NPC_NEW_DEFS (role/dialogue).
   ĐỢT 2 (Play Mode): edNpcAttackStats/edNpcAttackStep — AI attack/chase
   thuần cho Play Mode (09-play.js gọi): quái ai='attack' đuổi theo hero
   khi vào detectionRadius (đi theo đường findPath nếu caller truyền
   findPathFn/stepAlongFn, không có thì đuổi thẳng), đứng lại đánh khi vào
   attackRadius. Không đụng UI editor của NPC.
   ĐỢT 4 (AI có trí nhớ): edNpcNextAiState — máy trạng thái thuần
   chase/attack -> alert -> search -> patrol/idle: mất dấu địch thì nhớ
   lastSeenPos/lastSeenAt, đi tới chỗ thấy địch lần cuối (A* qua ED.Nav
   nếu có, không có thì đi thẳng), tìm vòng nhỏ quanh đó trong
   searchDuration (mặc định 5s, chỉnh được qua npc.searchDuration),
   thấy lại thì quay về chase, hết giờ thì về home (waypoint đầu/spawn)
   + patrol/idle. 2 state mới 'alert'/'search' (ED_NPC_AI_STATES).
   Nhãn tiếng Việt cho mọi state: ED_NPC_AI_STATE_LABELS (09-play.js vẽ
   lên đầu NPC trong Play Mode bằng THREE.Sprite + canvas).
   QUY TẮC DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   logic thuần expose để nhóm D test bằng vm + stub THREE. */

var ED = (typeof ED !== 'undefined' && ED) ? ED : {};

/* ---------------- Hằng số ---------------- */

var ED_NPC_FACTIONS = ['Thiếu Lâm', 'Võ Đang', 'Nga Mi', 'Cái Bang', 'Minh Giáo', 'Tiêu Dao'];
var ED_NPC_TYPES = ['Thương nhân', 'Thợ rèn', 'Dược sư', 'Quest giver', 'Sư phụ', 'Bảo vệ', 'Dịch chuyển', 'Boss', 'Quái'];
var ED_NPC_AI_MODES = ['idle', 'patrol', 'wander', 'follow', 'chase', 'attack'];
var ED_NPC_AI_LABELS = { idle: 'Idle (đứng yên)', patrol: 'Patrol (tuần tra)', wander: 'Wander (lang thang)', follow: 'Follow (đi theo)', chase: 'Chase (đuổi theo)', attack: 'Attack (tấn công)' };
/* Đợt 4 — danh sách state AI RUNTIME (6 mode gốc + 2 state trí nhớ).
   ED_NPC_AI_MODES giữ nguyên 6 mode chọn được trong Inspector (hành vi
   gốc của NPC); 'alert'/'search' chỉ xuất hiện lúc chạy Play Mode nên
   KHÔNG đưa vào dropdown Inspector. */
var ED_NPC_AI_STATES = ['idle', 'patrol', 'wander', 'follow', 'chase', 'attack', 'alert', 'search'];
var ED_NPC_AI_STATE_LABELS = {
  idle: 'Đứng yên', patrol: 'Tuần tra', wander: 'Lang thang', follow: 'Đi theo',
  chase: 'Đuổi theo', attack: 'Tấn công', alert: 'Cảnh giác', search: 'Tìm kiếm'
};
var ED_NPC_AI_SEARCH_DURATION_DEFAULT = 5; /* giây tìm quanh lastSeenPos, mặc định */
var ED_NPC_AI_SEARCH_RADIUS = 2;           /* bán kính vòng tìm nhỏ quanh lastSeenPos */
var ED_NPC_AI_ALERT_TIMEOUT_DEFAULT = 10;  /* giây: alert quá lâu không tới được lastSeenPos thì bỏ về nhà */
var ED_NPC_IDLE_ANIMS = ['idle', 'walk', 'talk'];
var ED_QUEST_TYPES = ['Chính', 'Tuyến', 'Phụ', 'Hằng ngày', 'Boss', 'Thu thập', 'Giết quái', 'Nói chuyện'];

/* ---------------- Logic thuần (không DOM/THREE) ---------------- */

function edNpcDefaultProject() {
  return {
    version: 1, name: 'Project mới',
    terrain: { size: 96, segments: 64, heights: [], paints: [] },
    env: { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co' },
    objects: [], npcs: [], quests: [], characters: []
  };
}

function edNpcNewNpc(id) {
  return {
    id: id, name: 'NPC mới', level: 1, faction: 'Thiếu Lâm',
    type: 'Quest giver', dialogue: ['Chào thiếu hiệp!'],
    interactRadius: 2, idleAnim: 'idle',
    pos: [0, 0], patrol: [], ai: 'idle',
    detectionRadius: 5, attackRadius: 1.5,
    /* Đợt 4 — trí nhớ AI: thời gian tìm quanh lastSeenPos (giây).
       NPC cũ (project đã lưu) không có field này thì nextAiState mặc
       định 5s. */
    searchDuration: 5,
    robe: '#334155', hair: '#1e1b18', weapon: null, aura: null
  };
}

function edNpcNextId(project) {
  var npcs = (project && Array.isArray(project.npcs)) ? project.npcs : [];
  var n = npcs.length + 1;
  var used = {};
  npcs.forEach(function (p) { if (p && p.id) used[p.id] = true; });
  while (used['npc' + n]) n++;
  return 'npc' + n;
}

function edNpcNewQuest(id) {
  return {
    id: id, name: 'Nhiệm vụ mới', desc: '', type: 'Phụ',
    target: '', reward: { knb: 0, silver: 0, item: '' }
  };
}

function edNpcNextQuestId(project) {
  var quests = (project && Array.isArray(project.quests)) ? project.quests : [];
  var n = quests.length + 1;
  var used = {};
  quests.forEach(function (q) { if (q && q.id) used[q.id] = true; });
  while (used['q' + n]) n++;
  return 'q' + n;
}

/* Dialogue: textarea nhiều dòng <-> mảng câu (mỗi dòng 1 câu, bỏ dòng trống). */
function edNpcParseDialogue(text) {
  if (Array.isArray(text)) return text.filter(function (s) { return typeof s === 'string' && s.trim(); });
  return String(text || '').split(/\r?\n/).map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

function edNpcJoinDialogue(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.join('\n');
}

/* Quest CRUD thuần trên project JSON — trả true/false. */
function edNpcAddQuest(project, quest) {
  if (!project || !Array.isArray(project.quests) || !quest || !quest.id) return false;
  for (var i = 0; i < project.quests.length; i++) {
    if (project.quests[i] && project.quests[i].id === quest.id) return false;
  }
  project.quests.push(quest);
  return true;
}

function edNpcUpdateQuest(project, questId, patch) {
  if (!project || !Array.isArray(project.quests) || !questId || !patch) return false;
  for (var i = 0; i < project.quests.length; i++) {
    var q = project.quests[i];
    if (q && q.id === questId) {
      var keys = Object.keys(patch);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k] === 'reward' && patch.reward && typeof patch.reward === 'object' && q.reward) {
          var rk = Object.keys(patch.reward);
          for (var r = 0; r < rk.length; r++) q.reward[rk[r]] = patch.reward[rk[r]];
        } else {
          q[keys[k]] = patch[keys[k]];
        }
      }
      return true;
    }
  }
  return false;
}

function edNpcRemoveQuest(project, questId) {
  if (!project || !Array.isArray(project.quests) || !questId) return false;
  for (var i = 0; i < project.quests.length; i++) {
    if (project.quests[i] && project.quests[i].id === questId) {
      project.quests.splice(i, 1);
      return true;
    }
  }
  return false;
}

/* Waypoint thuần trên npc.patrol (mảng [x,z]). */
function edNpcAddWaypoint(npc, x, z) {
  if (!npc || !Array.isArray(npc.patrol)) return -1;
  npc.patrol.push([Number(x) || 0, Number(z) || 0]);
  return npc.patrol.length - 1;
}

function edNpcRemoveWaypoint(npc, idx) {
  if (!npc || !Array.isArray(npc.patrol)) return false;
  idx = Number(idx);
  if (!isFinite(idx) || idx < 0 || idx >= npc.patrol.length) return false;
  npc.patrol.splice(idx, 1);
  return true;
}

function edNpcMoveWaypoint(npc, idx, x, z) {
  if (!npc || !Array.isArray(npc.patrol)) return false;
  idx = Number(idx);
  if (!isFinite(idx) || idx < 0 || idx >= npc.patrol.length) return false;
  npc.patrol[idx] = [Number(x) || 0, Number(z) || 0];
  return true;
}

/* Bước di chuyển thuần: từ pos đi về target với tốc độ (đơn vị/giây).
   Trả {pos:[x,z], arrived:true/false}. */
function edNpcStepToward(pos, target, speed, dt) {
  var dx = target[0] - pos[0];
  var dz = target[1] - pos[1];
  var dist = Math.sqrt(dx * dx + dz * dz);
  var step = (Number(speed) || 0) * (Number(dt) || 0);
  if (dist <= 0 || step <= 0) return { pos: [pos[0], pos[1]], arrived: dist <= 0.001 };
  if (step >= dist) return { pos: [target[0], target[1]], arrived: true };
  var k = step / dist;
  return { pos: [pos[0] + dx * k, pos[1] + dz * k], arrived: false };
}

/* Patrol 1 bước: đi về waypoint[wpIndex]; tới nơi thì sang waypoint sau
   (vòng lại đầu khi hết). Trả {pos, wpIndex, arrived}. */
function edNpcPatrolStep(npc, pos, speed, dt, wpIndex) {
  var patrol = (npc && Array.isArray(npc.patrol)) ? npc.patrol : [];
  if (!patrol.length) return { pos: [pos[0], pos[1]], wpIndex: 0, arrived: false };
  var idx = ((Number(wpIndex) || 0) % patrol.length + patrol.length) % patrol.length;
  var r = edNpcStepToward(pos, patrol[idx], speed, dt);
  if (r.arrived) idx = (idx + 1) % patrol.length;
  return { pos: r.pos, wpIndex: idx, arrived: r.arrived };
}

/* Chọn điểm lang thang ngẫu nhiên quanh home trong bán kính radius.
   rand: hàm () -> [0,1) — test truyền hàm cố định để xác định kết quả. */
function edNpcPickWanderTarget(home, radius, rand) {
  var rnd = (typeof rand === 'function') ? rand : Math.random;
  var a = rnd() * Math.PI * 2;
  var r = rnd() * (Number(radius) || 3);
  return [home[0] + Math.cos(a) * r, home[1] + Math.sin(a) * r];
}

/* Chase 1 bước: chỉ đuổi khi hero trong detectionRadius.
   Trả {pos, chasing:true/false}. */
function edNpcChaseStep(pos, heroPos, speed, dt, detectionRadius) {
  var dx = heroPos[0] - pos[0];
  var dz = heroPos[1] - pos[1];
  var dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > (Number(detectionRadius) || 0)) return { pos: [pos[0], pos[1]], chasing: false };
  var r = edNpcStepToward(pos, heroPos, speed, dt);
  return { pos: r.pos, chasing: true };
}

/* ---- Đợt 2: chỉ số tấn công + 1 bước AI attack (thuần) ---- */

/* Chuẩn hoá chỉ số tấn công của NPC (npcs[] KHÔNG có sẵn atk/def nên
   mặc định atk=10, def=0; attackCooldown mặc định 1.2s; detectionRadius
   mặc định 5, attackRadius mặc định 1.5, speed mặc định 2). Đọc cả
   npc.extra.atk/def nếu npc.atk/def thiếu. */
function edNpcAttackStats(npc) {
  var n = npc || {};
  var atk = Number(n.atk);
  if (!isFinite(atk)) {
    atk = (n.extra && isFinite(Number(n.extra.atk))) ? Number(n.extra.atk) : 10;
  }
  var def = Number(n.def);
  if (!isFinite(def)) {
    def = (n.extra && isFinite(Number(n.extra.def))) ? Number(n.extra.def) : 0;
  }
  var det = Number(n.detectionRadius);
  if (!(det > 0)) det = 5;
  var ar = Number(n.attackRadius);
  if (!(ar > 0)) ar = 1.5;
  var cd = Number(n.attackCooldown);
  if (!(cd > 0)) cd = Number(n.cooldown);
  if (!(cd > 0)) cd = 1.2;
  var speed = Number(n.speed);
  if (!(speed > 0)) speed = 2;
  return { atk: atk, def: def, detectionRadius: det, attackRadius: ar, cooldown: cd, speed: speed };
}

/* 1 bước AI attack (thuần, không DOM/THREE):
   npc: entry npcs[] (ai='attack'); pos/heroPos: [x,z]; dt: giây;
   navState: {path, pathIndex, lastPathAt, targetPos} — caller giữ lại
     giữa các frame (09-play.js giữ trong _npcState[npc.id].nav);
   findPathFn(from [x,z], to [x,z]) -> [[x,z],...] | null — caller truyền
     hàm đã guard typeof ED.Nav.findPath (không có Nav thì truyền null);
   stepAlongFn(path, pos, speed, dt, index) -> {pos, index} | [x,z] |
     {x, z} | null — tương tự, không có thì truyền null;
   nowMs: đồng hồ phiên Play (ms, dừng khi pause).
   Trả {pos, state, chasing, attacking}:
   - ngoài detectionRadius: đứng yên, chasing=false.
   - trong attackRadius: đứng lại, attacking=true (đánh thật do Play
     Mode xử lý qua edPlayMonsterAttack, không đánh ở đây).
   - còn lại: đuổi theo — có đường Nav thì đi theo đường (tính lại khi
     hero dời >2 ô hoặc đường cũ >1s), không có Nav thì đuổi thẳng.
   Không có findPathFn/stepAlongFn vẫn chạy đúng bằng đuổi thẳng. */
function edNpcAttackStep(npc, pos, heroPos, dt, navState, findPathFn, stepAlongFn, nowMs) {
  var st = edNpcAttackStats(npc);
  var state = navState || {};
  var dx = heroPos[0] - pos[0];
  var dz = heroPos[1] - pos[1];
  var dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > st.detectionRadius) {
    return { pos: [pos[0], pos[1]], state: state, chasing: false, attacking: false };
  }
  if (dist <= st.attackRadius) {
    return { pos: [pos[0], pos[1]], state: state, chasing: true, attacking: true };
  }
  var path = Array.isArray(state.path) ? state.path : null;
  var heroMoved = state.targetPos
    ? (Math.abs(state.targetPos[0] - heroPos[0]) + Math.abs(state.targetPos[1] - heroPos[1]) > 2)
    : true;
  var stale = (typeof nowMs === 'number' && typeof state.lastPathAt === 'number')
    ? (nowMs - state.lastPathAt > 1000) : false;
  if (typeof findPathFn === 'function' && (!path || !path.length || heroMoved || stale)) {
    try {
      var p = findPathFn([pos[0], pos[1]], [heroPos[0], heroPos[1]]);
      if (Array.isArray(p) && p.length) {
        path = p;
        state.path = p;
        state.pathIndex = 0;
        state.lastPathAt = (typeof nowMs === 'number') ? nowMs : 0;
        state.targetPos = [heroPos[0], heroPos[1]];
      } else {
        state.path = null;
      }
    } catch (e) { state.path = null; }
  }
  if (path && path.length) {
    var idx = Number(state.pathIndex) || 0;
    if (idx < path.length) {
      var wp = path[idx];
      var wpt = [Number(wp[0]) || 0, Number(wp[1]) || 0];
      if (typeof stepAlongFn === 'function') {
        try {
          var r = stepAlongFn(path, [pos[0], pos[1]], st.speed, dt, idx);
          var np = null;
          var ni = idx;
          if (r) {
            if (Array.isArray(r)) np = [Number(r[0]) || 0, Number(r[1]) || 0];
            else if (Array.isArray(r.pos)) np = [Number(r.pos[0]) || 0, Number(r.pos[1]) || 0];
            else if (typeof r.x === 'number') np = [r.x, Number(r.z) || 0];
            if (typeof r.index === 'number') ni = r.index;
          }
          if (np) {
            var ddx = wpt[0] - np[0];
            var ddz = wpt[1] - np[1];
            if (Math.sqrt(ddx * ddx + ddz * ddz) <= 0.3) ni = Math.min(idx + 1, path.length);
            state.pathIndex = ni;
            return { pos: np, state: state, chasing: true, attacking: false };
          }
        } catch (e) { /* stepAlong lỗi -> rơi xuống đuổi theo waypoint thẳng */ }
      }
      var s = edNpcStepToward(pos, wpt, st.speed, dt);
      if (s.arrived) state.pathIndex = idx + 1;
      return { pos: s.pos, state: state, chasing: true, attacking: false };
    }
    state.path = null;
  }
  var c = edNpcStepToward(pos, heroPos, st.speed, dt);
  return { pos: c.pos, state: state, chasing: true, attacking: false };
}

/* ---- Đợt 4: AI có trí nhớ — máy trạng thái thuần (test được bằng vm) ---- */

/* Nhãn tiếng Việt của 1 state AI (hiện trên đầu NPC trong Play Mode). */
function edNpcAiStateLabel(state) {
  return ED_NPC_AI_STATE_LABELS[state] || String(state || 'idle');
}

/* Chuyển trạng thái AI 1 bước (THUẦN, không DOM/THREE, không sửa npc).
   npc: entry npcs[] hoặc object view của Play Mode — chỉ đọc các field:
     ai (hành vi gốc), aiState (state runtime hiện tại, không có thì lấy ai),
     lastSeenPos [x,z]|null (vị trí thấy địch lần cuối),
     homePos [x,z]|null (điểm về khi hết tìm; không có thì waypoint đầu
       patrol[], không có nữa thì null = đứng yên tại chỗ),
     patrol [[x,z],...], attackRadius, detectionRadius (không dùng trực
       tiếp ở đây — caller tính targetVisible từ detectionRadius),
     searchDuration (giây, mặc định 5), alertTimeout (giây, mặc định 10).
   ctx: {distToTarget, targetVisible, timeSinceSeen (giây từ lúc thấy địch
     lần cuối, Infinity nếu chưa từng thấy), searchElapsed (giây đã tìm,
     chỉ tính khi đang ở state 'search'), atLastSeen (đã tới lastSeenPos
     chưa, <=0.5 ô), atHome (đã về home chưa, <=0.5 ô)}.
   Trả {state, moveTo:[x,z]|null, lookAround:bool}:
   - thấy địch: trong attackRadius -> 'attack', còn lại -> 'chase'.
   - mất dấu lúc đang chase/attack: có lastSeenPos -> 'alert' đi tới đó,
     không có -> về home (patrol nếu có waypoint, không thì idle).
   - alert: tới lastSeenPos -> 'search' (lookAround=true); quá
     alertTimeout mà chưa tới được (kẹt đường) -> về home.
   - search: hết searchDuration -> về home (patrol/idle, moveTo=home;
     moveTo=null nếu đã đứng đúng home); chưa hết -> ở lại 'search',
     lookAround=true (caller cho đi vòng nhỏ bán kính ~2 quanh lastSeenPos).
   - patrol/idle/wander/follow: giữ nguyên state, không di chuyển. */
function edNpcNextAiState(npc, ctx) {
  var n = npc || {};
  var c = ctx || {};
  var cur = (typeof n.aiState === 'string' && n.aiState) ? n.aiState : ((typeof n.ai === 'string' && n.ai) ? n.ai : 'idle');
  if (ED_NPC_AI_STATES.indexOf(cur) < 0) cur = 'idle';
  var attackR = Number(n.attackRadius);
  if (!(attackR > 0)) attackR = 1.5;
  var searchDur = Number(n.searchDuration);
  if (!(searchDur > 0)) searchDur = ED_NPC_AI_SEARCH_DURATION_DEFAULT;
  var alertTimeout = Number(n.alertTimeout);
  if (!(alertTimeout > 0)) alertTimeout = ED_NPC_AI_ALERT_TIMEOUT_DEFAULT;
  var lastSeen = (Array.isArray(n.lastSeenPos) && n.lastSeenPos.length >= 2)
    ? [Number(n.lastSeenPos[0]) || 0, Number(n.lastSeenPos[1]) || 0] : null;
  var home = null;
  if (Array.isArray(n.homePos) && n.homePos.length >= 2) {
    home = [Number(n.homePos[0]) || 0, Number(n.homePos[1]) || 0];
  } else if (Array.isArray(n.patrol) && n.patrol.length && Array.isArray(n.patrol[0])) {
    home = [Number(n.patrol[0][0]) || 0, Number(n.patrol[0][1]) || 0];
  }
  var hasPatrol = Array.isArray(n.patrol) && n.patrol.length > 0;
  var base = hasPatrol ? 'patrol' : 'idle';
  function goHome() {
    return { state: base, moveTo: c.atHome ? null : home, lookAround: false };
  }
  /* Thấy địch -> đuổi/đánh (caller cập nhật lastSeenPos/lastSeenAt
     trước khi gọi, nên ở đây chỉ cần chuyển state). */
  if (c.targetVisible) {
    var dist = Number(c.distToTarget);
    if (!isFinite(dist)) dist = Infinity;
    if (dist <= attackR) return { state: 'attack', moveTo: null, lookAround: false };
    return { state: 'chase', moveTo: null, lookAround: false };
  }
  var timeSinceSeen = Number(c.timeSinceSeen);
  if (!isFinite(timeSinceSeen) || timeSinceSeen < 0) timeSinceSeen = Infinity;
  var searchElapsed = Number(c.searchElapsed);
  if (!isFinite(searchElapsed) || searchElapsed < 0) searchElapsed = 0;
  if (cur === 'chase' || cur === 'attack') {
    if (!lastSeen) return goHome();
    return { state: 'alert', moveTo: lastSeen, lookAround: false };
  }
  if (cur === 'alert') {
    if (c.atLastSeen) return { state: 'search', moveTo: null, lookAround: true };
    if (timeSinceSeen > alertTimeout) return goHome();
    if (!lastSeen) return goHome();
    return { state: 'alert', moveTo: lastSeen, lookAround: false };
  }
  if (cur === 'search') {
    if (searchElapsed >= searchDur) return goHome();
    return { state: 'search', moveTo: null, lookAround: true };
  }
  return { state: cur, moveTo: null, lookAround: false };
}

function edNpcClampNum(v, min, max, fallback) {
  var n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* Đồng bộ NPC scene object <-> npcs[] — THUẦN trên project JSON.
   - npcs[] có npc, objects[] chưa có object type 'npc' cùng id -> tạo.
   - Có rồi -> đồng bộ pos (npc.pos thắng) + tên + extra.npcId.
   - Object có mà npcs[] thiếu -> tạo entry NPC từ object (giữ pos).
   Trả object trong objects[] (đã đồng bộ). Nhóm A gọi khi cần; bản
   runtime ED.NpcAi.syncNpcObject(npc) bọc thêm ED.Viewport.syncObject. */
function edNpcSyncNpcObject(project, npc) {
  if (!project || !npc || !npc.id) return null;
  if (!Array.isArray(project.objects)) project.objects = [];
  if (!Array.isArray(project.npcs)) project.npcs = [];
  var entry = null;
  for (var i = 0; i < project.npcs.length; i++) {
    if (project.npcs[i] && project.npcs[i].id === npc.id) { entry = project.npcs[i]; break; }
  }
  if (!entry) { project.npcs.push(npc); entry = npc; }
  var obj = null;
  for (var j = 0; j < project.objects.length; j++) {
    var o = project.objects[j];
    if (o && o.id === npc.id && o.type === 'npc') { obj = o; break; }
  }
  var pos = (Array.isArray(entry.pos) && entry.pos.length >= 2)
    ? [Number(entry.pos[0]) || 0, Number(entry.pos[1]) || 0] : [0, 0];
  if (!obj) {
    obj = {
      id: npc.id, type: 'npc', category: 'Characters', name: entry.name || 'NPC mới',
      pos: [pos[0], 0, pos[1]], rot: [0, 0, 0], scale: [1, 1, 1],
      color: entry.robe || '#334155', extra: { npcId: npc.id, npcType: entry.type || 'Quest giver' }
    };
    project.objects.push(obj);
  } else {
    obj.name = entry.name || obj.name;
    obj.pos = [pos[0], (obj.pos && typeof obj.pos[1] === 'number') ? obj.pos[1] : 0, pos[1]];
    if (!obj.extra) obj.extra = {};
    obj.extra.npcId = npc.id;
    obj.extra.npcType = entry.type || obj.extra.npcType;
    if (entry.robe) obj.color = entry.robe;
  }
  return obj;
}

/* ---------------- Module ED.NpcAi ---------------- */

ED.NpcAi = {
  /* Hằng + logic thuần — nhóm D test được bằng vm + stub THREE. */
  FACTIONS: ED_NPC_FACTIONS,
  NPC_TYPES: ED_NPC_TYPES,
  AI_MODES: ED_NPC_AI_MODES,
  AI_LABELS: ED_NPC_AI_LABELS,
  /* Đợt 4 — state runtime + nhãn tiếng Việt + hàm trí nhớ (test bằng vm). */
  AI_STATES: ED_NPC_AI_STATES,
  AI_STATE_LABELS: ED_NPC_AI_STATE_LABELS,
  SEARCH_DURATION_DEFAULT: ED_NPC_AI_SEARCH_DURATION_DEFAULT,
  SEARCH_RADIUS: ED_NPC_AI_SEARCH_RADIUS,
  ALERT_TIMEOUT_DEFAULT: ED_NPC_AI_ALERT_TIMEOUT_DEFAULT,
  nextAiState: edNpcNextAiState,
  aiStateLabel: edNpcAiStateLabel,
  IDLE_ANIMS: ED_NPC_IDLE_ANIMS,
  QUEST_TYPES: ED_QUEST_TYPES,
  newNpc: edNpcNewNpc,
  nextId: edNpcNextId,
  newQuest: edNpcNewQuest,
  nextQuestId: edNpcNextQuestId,
  parseDialogue: edNpcParseDialogue,
  joinDialogue: edNpcJoinDialogue,
  addQuest: edNpcAddQuest,
  updateQuest: edNpcUpdateQuest,
  removeQuest: edNpcRemoveQuest,
  addWaypoint: edNpcAddWaypoint,
  removeWaypoint: edNpcRemoveWaypoint,
  moveWaypoint: edNpcMoveWaypoint,
  stepToward: edNpcStepToward,
  patrolStep: edNpcPatrolStep,
  pickWanderTarget: edNpcPickWanderTarget,
  chaseStep: edNpcChaseStep,
  attackStep: edNpcAttackStep,
  attackStats: edNpcAttackStats,
  clampNum: edNpcClampNum,
  syncNpcObject: edNpcSyncNpcObject,

  _localProject: null,   /* fallback khi nhóm A (ED.Core) chưa có */
  _panel: null,
  _selectEl: null,
  _formEl: null,
  _questListEl: null,
  _questFormEl: null,
  _wpListEl: null,
  _selectedId: null,
  _selectedQuestId: null,
  _placingWaypoint: false,
  _patrolLines: {},      /* npcId -> THREE.Line trong viewport */
  _wpCounter: 0,

  /* Project đang sửa: ED.Core.getProject() (nhóm A) nếu có, không thì
     project cục bộ. Lưu ý: ED.Core KHÔNG có thuộc tính .project. */
  project: function () {
    if (ED.Core && typeof ED.Core.getProject === 'function') {
      var p = null;
      try { p = ED.Core.getProject(); } catch (e) { p = null; }
      if (p && typeof p === 'object') return p;
    }
    if (ED.Core && ED.Core.project && typeof ED.Core.project === 'object') return ED.Core.project;
    if (!this._localProject) this._localProject = edNpcDefaultProject();
    return this._localProject;
  },

  commit: function (label) {
    try {
      if (ED.Core) {
        if (typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(label || 'NPC');
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

  getNpc: function (id) {
    var project = this.project();
    for (var i = 0; i < project.npcs.length; i++) {
      if (project.npcs[i] && project.npcs[i].id === id) return project.npcs[i];
    }
    return null;
  },

  selectedNpc: function () {
    return this._selectedId ? this.getNpc(this._selectedId) : null;
  },

  /* Vị trí trước camera (đặt NPC mới): thử ED.Viewport, không có thì (0,0). */
  _frontPosition: function () {
    try {
      if (ED.Viewport && typeof ED.Viewport.getCameraFront === 'function') {
        var p = ED.Viewport.getCameraFront(2);
        if (p && isFinite(p[0]) && isFinite(p[1])) return [Number(p[0]), Number(p[1])];
      }
      if (ED.Viewport && ED.Viewport.camera && ED.Viewport.camera.position) {
        var cam = ED.Viewport.camera;
        var dir = { x: 0, z: -1 };
        if (typeof THREE !== 'undefined' && cam.getWorldDirection) {
          var v = new THREE.Vector3();
          cam.getWorldDirection(v);
          dir = { x: v.x, z: v.z };
        }
        return [Number(cam.position.x) + dir.x * 2, Number(cam.position.z) + dir.z * 2];
      }
    } catch (e) {}
    return [0, 0];
  },

  /* Thêm NPC tại vị trí trước camera; mesh chibi placeholder/primitive do
     nhóm B (ED.Viewport.syncObject / ED.Assets.buildMesh) vẽ khi có.
     Đồng bộ qua ED.Core.syncNpcObject (nhóm A) khi có — nó dùng
     ED.Core.addObject nên đúng id counter + markDirty + notify. */
  addNpc: function () {
    var project = this.project();
    var id = edNpcNextId(project);
    var npc = edNpcNewNpc(id);
    var pos = this._frontPosition();
    npc.pos = [Math.round(pos[0] * 10) / 10, Math.round(pos[1] * 10) / 10];
    project.npcs.push(npc);
    var obj = this.syncNpcObjectRuntime(npc);
    if (!obj) {
      obj = edNpcSyncNpcObject(project, npc);
      try {
        if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') ED.Viewport.syncObject(obj);
      } catch (e) {}
    }
    this._selectedId = id;
    this.commit('Thêm NPC');
    this.refreshList();
    this.updatePatrolLine(npc);
    this.toast('Đã thêm "' + npc.name + '" tại (' + npc.pos[0] + ', ' + npc.pos[1] + ').');
    this.log('NPC ' + id + ' thêm tại (' + npc.pos[0] + ', ' + npc.pos[1] + ')');
    return npc;
  },

  removeNpc: function (npcId) {
    var project = this.project();
    var idx = -1;
    for (var i = 0; i < project.npcs.length; i++) {
      if (project.npcs[i] && project.npcs[i].id === npcId) { idx = i; break; }
    }
    if (idx < 0) return false;
    project.npcs.splice(idx, 1);
    /* Xoá cả scene object + waypoint object của NPC này. */
    var keep = [];
    var removeIds = [];
    for (var j = 0; j < project.objects.length; j++) {
      var o = project.objects[j];
      if (!o) continue;
      if (o.id === npcId && o.type === 'npc') { removeIds.push(o.id); continue; }
      if (o.type === 'waypoint' && o.extra && o.extra.npcId === npcId) { removeIds.push(o.id); continue; }
      keep.push(o);
    }
    if (ED.Core && typeof ED.Core.removeObject === 'function') {
      removeIds.forEach(function (rid) { try { ED.Core.removeObject(rid); } catch (e) {} });
    } else {
      project.objects = keep;
    }
    removeIds.forEach(function (rid) {
      try { if (ED.Viewport && typeof ED.Viewport.removeMesh === 'function') ED.Viewport.removeMesh(rid); } catch (e) {}
    });
    this.removePatrolLine(npcId);
    if (this._selectedId === npcId) this._selectedId = null;
    this.commit('Xoá NPC');
    this.refreshList();
    return true;
  },

  /* Bật/tắt chế độ đặt waypoint: khi bật, click xuống đất gọi
     onGroundClick(x, z) để thêm waypoint cho NPC đang chọn. */
  setPlacingWaypoint: function (on) {
    this._placingWaypoint = !!on;
    if (this._placingWaypoint && !this.selectedNpc()) {
      this.toast('Chọn 1 NPC trước rồi mới đặt waypoint.');
      this._placingWaypoint = false;
      return false;
    }
    if (this._placingWaypoint) this.toast('Chế độ đặt waypoint: click xuống đất để thêm điểm tuần tra cho "' + this.selectedNpc().name + '". Bấm lại nút để tắt.');
    this._refreshWpButton();
    return this._placingWaypoint;
  },

  isPlacingWaypoint: function () { return this._placingWaypoint; },

  /* Nhóm A (01-viewport) gọi khi user click xuống đất trong lúc đặt waypoint.
     Cũng là điểm nối nếu viewport có hook setGroundClickHandler. */
  onGroundClick: function (x, z) {
    if (!this._placingWaypoint) return false;
    var npc = this.selectedNpc();
    if (!npc) { this.toast('Chọn 1 NPC trước rồi mới đặt waypoint.'); return false; }
    var idx = edNpcAddWaypoint(npc, Number(x) || 0, Number(z) || 0);
    if (idx < 0) return false;
    var project = this.project();
    var wpId = 'wp-' + npc.id + '-' + idx + '-' + (++this._wpCounter);
    var wpObj = {
      id: wpId, type: 'waypoint', category: 'Characters',
      name: 'Waypoint ' + (idx + 1) + ' (' + npc.name + ')',
      pos: [Number(x) || 0, 0, Number(z) || 0], rot: [0, 0, 0], scale: [1, 1, 1],
      color: '#facc15', extra: { npcId: npc.id, wpIndex: idx }
    };
    /* Ưu tiên ED.Core.addObject (đúng id counter + markDirty + notify). */
    try {
      if (ED.Core && typeof ED.Core.addObject === 'function') wpObj = ED.Core.addObject(wpObj);
      else project.objects.push(wpObj);
    } catch (e) { project.objects.push(wpObj); }
    try {
      if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') ED.Viewport.syncObject(wpObj);
    } catch (e) {}
    this.commit('Thêm waypoint');
    this.updatePatrolLine(npc);
    this.refreshWaypointList();
    this.log('Waypoint ' + (idx + 1) + ' của ' + npc.name + ' tại (' + wpObj.pos[0] + ', ' + wpObj.pos[2] + ')');
    return true;
  },

  /* Xoá waypoint thứ idx của NPC đang chọn (cả data + object trong scene). */
  deleteWaypoint: function (npcId, idx) {
    var npc = this.getNpc(npcId);
    if (!npc) return false;
    if (!edNpcRemoveWaypoint(npc, idx)) return false;
    var project = this.project();
    var keep = [];
    var deletedId = null;
    for (var i = 0; i < project.objects.length; i++) {
      var o = project.objects[i];
      if (!o) continue;
      if (o.type === 'waypoint' && o.extra && o.extra.npcId === npcId) {
        var wi = Number(o.extra.wpIndex);
        if (wi === Number(idx)) { deletedId = o.id; continue; }
        if (wi > Number(idx)) o.extra.wpIndex = wi - 1;
      }
      keep.push(o);
    }
    if (deletedId) {
      if (ED.Core && typeof ED.Core.removeObject === 'function') {
        try { ED.Core.removeObject(deletedId); } catch (e) {}
      } else {
        project.objects = keep;
      }
      try { if (ED.Viewport && typeof ED.Viewport.removeMesh === 'function') ED.Viewport.removeMesh(deletedId); } catch (e) {}
    }
    this.commit('Xoá waypoint');
    this.updatePatrolLine(npc);
    this.refreshWaypointList();
    return true;
  },

  /* Nhóm A gọi khi user kéo waypoint bằng gizmo: đồng bộ patrol[] theo
     vị trí mới của waypoint object. */
  onWaypointMoved: function (wpObjectId, x, z) {
    var project = this.project();
    var wp = null;
    for (var i = 0; i < project.objects.length; i++) {
      if (project.objects[i] && project.objects[i].id === wpObjectId) { wp = project.objects[i]; break; }
    }
    if (!wp || !wp.extra || !wp.extra.npcId) return false;
    var npc = this.getNpc(wp.extra.npcId);
    if (!npc) return false;
    var ok = edNpcMoveWaypoint(npc, wp.extra.wpIndex, x, z);
    if (ok) {
      wp.pos = [Number(x) || 0, 0, Number(z) || 0];
      this.updatePatrolLine(npc);
      this.refreshWaypointList();
      this.commit('Dời waypoint');
    }
    return ok;
  },

  /* Vẽ/cập nhật đường patrol: Line màu vàng nối các waypoint theo thứ tự
     patrol[] của NPC (y = 0.15 để khỏi z-fight với mặt đất). */
  updatePatrolLine: function (npc) {
    if (!npc || typeof THREE === 'undefined') return false;
    var scene = null;
    try {
      if (ED.Viewport && typeof ED.Viewport.getScene === 'function') scene = ED.Viewport.getScene();
      else if (ED.Viewport && ED.Viewport.scene) scene = ED.Viewport.scene;
    } catch (e) { scene = null; }
    if (!scene) return false;
    this.removePatrolLine(npc.id);
    var patrol = Array.isArray(npc.patrol) ? npc.patrol : [];
    if (patrol.length < 2) return false;
    try {
      var pts = patrol.map(function (p) { return new THREE.Vector3(p[0], 0.15, p[1]); });
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      var line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfacc15 }));
      scene.add(line);
      this._patrolLines[npc.id] = line;
      return true;
    } catch (e) { return false; }
  },

  removePatrolLine: function (npcId) {
    var line = this._patrolLines[npcId];
    if (!line) return;
    try {
      var scene = null;
      if (ED.Viewport && typeof ED.Viewport.getScene === 'function') scene = ED.Viewport.getScene();
      else if (ED.Viewport && ED.Viewport.scene) scene = ED.Viewport.scene;
      if (scene) scene.remove(line);
      if (line.geometry && line.geometry.dispose) line.geometry.dispose();
      if (line.material && line.material.dispose) line.material.dispose();
    } catch (e) {}
    delete this._patrolLines[npcId];
  },

  /* Đồng bộ runtime: ưu tiên ED.Core.syncNpcObject (nhóm A — dùng
     ED.Core.addObject, đúng id counter + markDirty + notify), không có
     thì dùng bản thuần edNpcSyncNpcObject; rồi vẽ lại mesh/đường patrol. */
  syncNpcObjectRuntime: function (npc) {
    var project = this.project();
    var obj = null;
    try {
      if (ED.Core && typeof ED.Core.syncNpcObject === 'function') obj = ED.Core.syncNpcObject(npc);
    } catch (e) { obj = null; }
    if (!obj) obj = edNpcSyncNpcObject(project, npc);
    try {
      if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') ED.Viewport.syncObject(obj);
    } catch (e) {}
    this.updatePatrolLine(npc);
    return obj;
  },

  /* ---------------- Panel (DOM — chỉ trong init) ---------------- */
  init: function (container) {
    if (typeof document === 'undefined') return false;
    var host = container || null;
    if (!host) {
      host = document.querySelector('[data-ed-panel="npc-ai"]')
        || document.getElementById('ed-panel-npc-ai')
        || document.getElementById('ed-tab-npc-ai')
        || document.getElementById('tab-npc-ai');
    }
    if (!host) {
      /* Template nhóm A chưa có tab NPC: tự tạo tab "NPC / Quest" trong
         #bottom-tabs + pane #tab-npc-ai trong #panel-bottom (theo đúng
         mẫu tab character/timeline/console của nhóm A). */
      var tabsBar = document.getElementById('bottom-tabs');
      var bottom = document.getElementById('panel-bottom');
      host = document.createElement('div');
      host.id = 'tab-npc-ai';
      host.className = 'bottom-pane ed-panel ed-panel-npc-ai';
      if (bottom) {
        bottom.appendChild(host);
        if (tabsBar) {
          var tabBtn = document.createElement('button');
          tabBtn.className = 'tab';
          tabBtn.setAttribute('data-bottom-tab', 'npc-ai');
          tabBtn.textContent = '🧑‍🤝‍🧑 NPC / Quest';
          tabBtn.addEventListener('click', function () {
            var panes = bottom.querySelectorAll('.bottom-pane');
            for (var i = 0; i < panes.length; i++) panes[i].classList.add('hidden');
            host.classList.remove('hidden');
            var tabs = tabsBar.querySelectorAll('.tab');
            for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('active');
            tabBtn.classList.add('active');
          });
          tabsBar.appendChild(tabBtn);
        }
      } else {
        document.body.appendChild(host);
      }
      var title = document.createElement('h3');
      title.textContent = '🧑‍🤝‍🧑 NPC / AI / Quest';
      host.appendChild(title);
    } else {
      var note2 = host.querySelector ? host.querySelector('.empty-note') : null;
      if (note2 && note2.remove) note2.remove();
    }
    this._panel = host;
    var self = this;
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = text;
      return e;
    }
    function btn(label, fn) {
      var b = el('button', 'ed-btn', label);
      b.style.minHeight = '40px';
      b.addEventListener('click', fn);
      return b;
    }

    host.appendChild(btn('➕ Thêm NPC', function () { self.addNpc(); }));

    var listWrap = el('div', 'ed-npc-list');
    listWrap.appendChild(el('label', '', 'NPC:'));
    var sel = el('select', 'ed-npc-select');
    sel.style.minHeight = '40px';
    sel.style.width = '100%';
    sel.addEventListener('change', function () {
      self._selectedId = sel.value || null;
      self.renderNpcForm();
      self.refreshWaypointList();
      var npc = self.selectedNpc();
      if (npc) self.updatePatrolLine(npc);
    });
    listWrap.appendChild(sel);
    this._selectEl = sel;
    host.appendChild(listWrap);

    var form = el('div', 'ed-npc-form');
    host.appendChild(form);
    this._formEl = form;

    /* Patrol. */
    var wpWrap = el('div', 'ed-npc-patrol');
    wpWrap.appendChild(el('div', '', '📍 Tuần tra (Patrol)'));
    var wpBtn = btn('📍 Đặt waypoint: TẮT', function () { self.setPlacingWaypoint(!self._placingWaypoint); });
    this._wpBtn = wpBtn;
    wpWrap.appendChild(wpBtn);
    var wpList = el('div', 'ed-npc-waypoints');
    wpWrap.appendChild(wpList);
    this._wpListEl = wpList;
    host.appendChild(wpWrap);

    /* Quest. */
    var qWrap = el('div', 'ed-npc-quests');
    qWrap.appendChild(el('div', '', '📜 Nhiệm vụ (Quest)'));
    qWrap.appendChild(btn('➕ Thêm nhiệm vụ', function () {
      var project = self.project();
      var q = edNpcNewQuest(edNpcNextQuestId(project));
      if (edNpcAddQuest(project, q)) {
        self._selectedQuestId = q.id;
        self.commit('Thêm nhiệm vụ');
        self.refreshQuestList();
        self.renderQuestForm();
      }
    }));
    var qList = el('div', 'ed-npc-quest-list');
    qWrap.appendChild(qList);
    this._questListEl = qList;
    var qForm = el('div', 'ed-npc-quest-form');
    qWrap.appendChild(qForm);
    this._questFormEl = qForm;
    host.appendChild(qWrap);

    /* Nối hook click-đất của viewport nếu nhóm A có sẵn hàm đăng ký. */
    try {
      if (ED.Viewport && typeof ED.Viewport.setGroundClickHandler === 'function') {
        ED.Viewport.setGroundClickHandler(function (x, z) { self.onGroundClick(x, z); });
      }
    } catch (e) {}

    this.refreshList();
    this.refreshQuestList();
    this.renderQuestForm();
    return true;
  },

  _refreshWpButton: function () {
    if (this._wpBtn) this._wpBtn.textContent = this._placingWaypoint ? '📍 Đặt waypoint: BẬT (bấm để tắt)' : '📍 Đặt waypoint: TẮT';
  },

  refreshList: function () {
    var sel = this._selectEl;
    if (!sel) return;
    var project = this.project();
    var cur = this._selectedId;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Chọn NPC —';
    sel.appendChild(opt0);
    project.npcs.forEach(function (n) {
      var o = document.createElement('option');
      o.value = n.id;
      o.textContent = n.name + ' (Lv' + n.level + ' · ' + n.type + ' · ' + (ED_NPC_AI_LABELS[n.ai] || n.ai) + ')';
      sel.appendChild(o);
    });
    sel.value = cur || '';
    this.renderNpcForm();
    this.refreshWaypointList();
  },

  renderNpcForm: function () {
    var form = this._formEl;
    if (!form || typeof document === 'undefined') return;
    while (form.firstChild) form.removeChild(form.firstChild);
    var npc = this.selectedNpc();
    if (!npc) {
      form.textContent = 'Chưa chọn NPC — bấm "➕ Thêm NPC" để tạo NPC mới.';
      return;
    }
    var self = this;
    function field(label, value, onInput, type) {
      var wrap = document.createElement('div');
      wrap.className = 'ed-field';
      var lab = document.createElement('label');
      lab.textContent = label;
      wrap.appendChild(lab);
      var inp = document.createElement('input');
      inp.type = type || 'text';
      inp.value = value;
      inp.style.minHeight = '40px';
      inp.style.width = '100%';
      inp.addEventListener('change', function () { onInput(inp.value); });
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return inp;
    }
    function selectField(label, options, value, onChange) {
      var wrap = document.createElement('div');
      wrap.className = 'ed-field';
      var lab = document.createElement('label');
      lab.textContent = label;
      wrap.appendChild(lab);
      var s = document.createElement('select');
      s.style.minHeight = '40px';
      s.style.width = '100%';
      options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = (typeof opt === 'string') ? opt : opt.value;
        o.textContent = (typeof opt === 'string') ? opt : opt.label;
        s.appendChild(o);
      });
      s.value = value;
      s.addEventListener('change', function () { onChange(s.value); });
      wrap.appendChild(s);
      form.appendChild(wrap);
      return s;
    }
    field('Tên', npc.name, function (v) {
      npc.name = String(v || '').slice(0, 24) || npc.name;
      self.syncNpcObjectRuntime(npc);
      self.commit('Đổi tên NPC');
      self.refreshList();
    });
    field('Level', npc.level, function (v) { npc.level = edNpcClampNum(v, 1, 99, 1); self.commit('Đổi level NPC'); }, 'number');
    selectField('Môn phái', ED_NPC_FACTIONS, npc.faction, function (v) { npc.faction = v; self.commit('Đổi môn phái NPC'); });
    selectField('Loại', ED_NPC_TYPES, npc.type, function (v) {
      npc.type = v;
      self.syncNpcObjectRuntime(npc);
      self.commit('Đổi loại NPC');
      self.refreshList();
    });
    /* Dialogue: textarea nhiều dòng, mỗi dòng 1 câu. */
    var dWrap = document.createElement('div');
    dWrap.className = 'ed-field';
    var dLab = document.createElement('label');
    dLab.textContent = 'Thoại (mỗi dòng 1 câu NPC nói)';
    dWrap.appendChild(dLab);
    var dTa = document.createElement('textarea');
    dTa.rows = 3;
    dTa.style.width = '100%';
    dTa.value = edNpcJoinDialogue(npc.dialogue);
    dTa.addEventListener('change', function () {
      npc.dialogue = edNpcParseDialogue(dTa.value);
      if (!npc.dialogue.length) npc.dialogue = ['...'];
      self.commit('Đổi thoại NPC');
    });
    dWrap.appendChild(dTa);
    form.appendChild(dWrap);
    field('Bán kính tương tác', npc.interactRadius, function (v) { npc.interactRadius = edNpcClampNum(v, 0.5, 10, 2); self.commit('Đổi bán kính tương tác'); }, 'number');
    selectField('Animation idle', ED_NPC_IDLE_ANIMS, npc.idleAnim || 'idle', function (v) { npc.idleAnim = v; self.commit('Đổi animation idle'); });
    selectField('AI behavior', ED_NPC_AI_MODES.map(function (m) { return { value: m, label: ED_NPC_AI_LABELS[m] }; }), npc.ai || 'idle', function (v) {
      npc.ai = v;
      self.commit('Đổi AI NPC');
      self.refreshList();
    });
    field('Bán kính phát hiện', npc.detectionRadius, function (v) { npc.detectionRadius = edNpcClampNum(v, 0, 30, 5); self.commit('Đổi bán kính phát hiện'); }, 'number');
    field('Bán kính tấn công', npc.attackRadius, function (v) { npc.attackRadius = edNpcClampNum(v, 0.5, 10, 1.5); self.commit('Đổi bán kính tấn công'); }, 'number');
    /* Vị trí (đồng bộ 2 chiều với scene object). */
    field('Vị trí X', npc.pos[0], function (v) {
      npc.pos[0] = edNpcClampNum(v, -48, 48, 0);
      self.syncNpcObjectRuntime(npc);
      self.commit('Dời NPC');
    }, 'number');
    field('Vị trí Z', npc.pos[1], function (v) {
      npc.pos[1] = edNpcClampNum(v, -48, 48, 0);
      self.syncNpcObjectRuntime(npc);
      self.commit('Dời NPC');
    }, 'number');
    var delBtn = document.createElement('button');
    delBtn.className = 'ed-btn';
    delBtn.style.minHeight = '40px';
    delBtn.textContent = '🗑 Xoá NPC';
    delBtn.addEventListener('click', function () {
      if (self.removeNpc(npc.id)) self.toast('Đã xoá NPC.');
    });
    form.appendChild(delBtn);
  },

  refreshWaypointList: function () {
    var list = this._wpListEl;
    if (!list || typeof document === 'undefined') return;
    while (list.firstChild) list.removeChild(list.firstChild);
    var npc = this.selectedNpc();
    if (!npc) { list.textContent = 'Chọn 1 NPC để xem waypoint.'; return; }
    var patrol = Array.isArray(npc.patrol) ? npc.patrol : [];
    if (!patrol.length) {
      list.textContent = 'Chưa có waypoint — bật "Đặt waypoint" rồi click xuống đất.';
      return;
    }
    var self = this;
    patrol.forEach(function (p, idx) {
      var row = document.createElement('div');
      row.className = 'ed-wp-row';
      var span = document.createElement('span');
      span.textContent = 'Điểm ' + (idx + 1) + ': (' + p[0] + ', ' + p[1] + ')';
      row.appendChild(span);
      var del = document.createElement('button');
      del.className = 'ed-btn';
      del.style.minHeight = '36px';
      del.textContent = '✕ Xoá';
      del.addEventListener('click', function () { self.deleteWaypoint(npc.id, idx); });
      row.appendChild(del);
      list.appendChild(row);
    });
    var hint = document.createElement('div');
    hint.textContent = 'Kéo waypoint trong viewport (gizmo) để dời điểm.';
    list.appendChild(hint);
  },

  refreshQuestList: function () {
    var list = this._questListEl;
    if (!list || typeof document === 'undefined') return;
    while (list.firstChild) list.removeChild(list.firstChild);
    var project = this.project();
    if (!project.quests.length) {
      list.textContent = 'Chưa có nhiệm vụ nào.';
      return;
    }
    var self = this;
    project.quests.forEach(function (q) {
      var b = document.createElement('button');
      b.className = 'ed-btn';
      b.style.minHeight = '40px';
      b.textContent = q.id + ' · ' + q.name + ' (' + q.type + ')';
      b.addEventListener('click', function () {
        self._selectedQuestId = q.id;
        self.renderQuestForm();
      });
      list.appendChild(b);
    });
  },

  renderQuestForm: function () {
    var form = this._questFormEl;
    if (!form || typeof document === 'undefined') return;
    while (form.firstChild) form.removeChild(form.firstChild);
    var project = this.project();
    var q = null;
    for (var i = 0; i < project.quests.length; i++) {
      if (project.quests[i] && project.quests[i].id === this._selectedQuestId) { q = project.quests[i]; break; }
    }
    if (!q) {
      form.textContent = 'Chọn 1 nhiệm vụ để sửa, hoặc bấm "➕ Thêm nhiệm vụ".';
      return;
    }
    var self = this;
    function field(label, value, onInput, type) {
      var wrap = document.createElement('div');
      wrap.className = 'ed-field';
      var lab = document.createElement('label');
      lab.textContent = label;
      wrap.appendChild(lab);
      var inp = document.createElement('input');
      inp.type = type || 'text';
      inp.value = value;
      inp.style.minHeight = '40px';
      inp.style.width = '100%';
      inp.addEventListener('change', function () { onInput(inp.value); });
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return inp;
    }
    var idRow = document.createElement('div');
    idRow.textContent = 'ID: ' + q.id + ' (tự sinh, không sửa được)';
    form.appendChild(idRow);
    field('Tên nhiệm vụ', q.name, function (v) {
      edNpcUpdateQuest(project, q.id, { name: String(v || '').slice(0, 40) || q.name });
      self.commit('Sửa nhiệm vụ');
      self.refreshQuestList();
    });
    var descWrap = document.createElement('div');
    descWrap.className = 'ed-field';
    var descLab = document.createElement('label');
    descLab.textContent = 'Mô tả';
    descWrap.appendChild(descLab);
    var descTa = document.createElement('textarea');
    descTa.rows = 2;
    descTa.style.width = '100%';
    descTa.value = q.desc || '';
    descTa.addEventListener('change', function () {
      edNpcUpdateQuest(project, q.id, { desc: descTa.value });
      self.commit('Sửa nhiệm vụ');
    });
    descWrap.appendChild(descTa);
    form.appendChild(descWrap);
    var tWrap = document.createElement('div');
    tWrap.className = 'ed-field';
    var tLab = document.createElement('label');
    tLab.textContent = 'Loại';
    tWrap.appendChild(tLab);
    var tSel = document.createElement('select');
    tSel.style.minHeight = '40px';
    tSel.style.width = '100%';
    ED_QUEST_TYPES.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t; o.textContent = t;
      tSel.appendChild(o);
    });
    tSel.value = q.type;
    tSel.addEventListener('change', function () {
      edNpcUpdateQuest(project, q.id, { type: tSel.value });
      self.commit('Sửa nhiệm vụ');
      self.refreshQuestList();
    });
    tWrap.appendChild(tSel);
    form.appendChild(tWrap);
    field('Mục tiêu', q.target || '', function (v) {
      edNpcUpdateQuest(project, q.id, { target: v });
      self.commit('Sửa nhiệm vụ');
    });
    if (!q.reward) q.reward = { knb: 0, silver: 0, item: '' };
    field('Thưởng: KNB', q.reward.knb || 0, function (v) {
      edNpcUpdateQuest(project, q.id, { reward: { knb: edNpcClampNum(v, 0, 99999, 0) } });
      self.commit('Sửa nhiệm vụ');
    }, 'number');
    field('Thưởng: Bạc', q.reward.silver || 0, function (v) {
      edNpcUpdateQuest(project, q.id, { reward: { silver: edNpcClampNum(v, 0, 9999999, 0) } });
      self.commit('Sửa nhiệm vụ');
    }, 'number');
    field('Thưởng: Vật phẩm', q.reward.item || '', function (v) {
      edNpcUpdateQuest(project, q.id, { reward: { item: String(v || '').slice(0, 40) } });
      self.commit('Sửa nhiệm vụ');
    });
    var delBtn = document.createElement('button');
    delBtn.className = 'ed-btn';
    delBtn.style.minHeight = '40px';
    delBtn.textContent = '🗑 Xoá nhiệm vụ';
    delBtn.addEventListener('click', function () {
      if (edNpcRemoveQuest(project, q.id)) {
        self._selectedQuestId = null;
        self.commit('Xoá nhiệm vụ');
        self.refreshQuestList();
        self.renderQuestForm();
        self.toast('Đã xoá nhiệm vụ ' + q.id + '.');
      }
    });
    form.appendChild(delBtn);
  }
};

/* ED.Core.syncNpcObject: DESIGN.md ghi nhóm A gọi hàm này — nếu ED.Core
   chưa định nghĩa, trỏ về bản thuần của nhóm C (làm việc trên project JSON
   mà ED.NpcAi đang giữ / ED.Core.project). */
try {
  if (ED.Core && typeof ED.Core.syncNpcObject !== 'function') {
    ED.Core.syncNpcObject = function (npc) {
      var project = (ED.NpcAi && typeof ED.NpcAi.project === 'function') ? ED.NpcAi.project() : null;
      return edNpcSyncNpcObject(project, npc);
    };
  }
} catch (e) {}
