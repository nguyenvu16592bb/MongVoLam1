/* ============================== 09-play.js ==============================
   ED.Play — Play Mode cho Map Editor (nhóm C).
   - Nút Play (toolbar nhóm A gọi ED.Play.start()) chuyển sang Play Mode:
     gizmo + panel edit ẩn. YÊU CẦU NHÓM A: CSS ẩn panel khi body có class
     'playing' (vd: body.playing .ed-panel, body.playing #ed-toolbar
     { display:none }). Nếu nhóm A chưa làm, start()/stop() tự ẩn/hiện
     bằng style.display (fallback, đã lưu display cũ để khôi phục).
   - Camera follow nhân vật; điều khiển nhân vật (object type 'character'
     đầu tiên, không có thì tạo hero chibi tạm tại spawn 0,0):
     WASD di chuyển (tốc độ theo characters[].speed), click chuột xuống
     đất để di chuyển tới điểm (raycast terrain qua ED.Viewport nếu có).
   - Va chạm đơn giản: không đi qua object có collider box (kiểm tra
     khoảng cách đơn giản theo nửa kích thước object + 0.35) + không đi
     vào ô nước (terrain.paints == 4 hoặc y thấp).
   - Chạm NPC trong bán kính tương tác -> hộp thoại dialogue (1 câu, nút
     Đóng + nút Tiếp theo câu sau).
   - Quái (object type 'monster' hoặc npc type Boss/Quái) trong tầm 2 ô:
     nút "⚔️ Đánh" hoặc tự đánh khi bấm Space — trừ HP đơn giản theo
     atk/def, quái chết thì biến mất + log + (quest giết quái chỉ tăng
     tiến độ bằng log, KHÔNG làm hệ thống quest chạy đầy đủ).
   - Pause (dừng di chuyển/AI, giữ scene), Stop (quay lại Editor Mode,
     KHÔI PHỤC đúng scene trước khi Play — snapshot project JSON lúc
     start, không mất dữ liệu).
   - NPC patrol trong Play Mode: ai=patrol đi theo waypoint (tốc độ
     chậm), ai=wander đi ngẫu nhiên quanh điểm spawn, ai=chase đuổi hero
     khi vào detectionRadius (chỉ trong Play Mode).
   ĐỢT 2 (Play Mode hoàn thiện):
   - Quái ai='attack' (object type 'monster' hoặc npc type Boss/Quái)
     đuổi hero khi vào detectionRadius (có ED.Nav thì đi theo đường
     ED.Nav.findPath/stepAlong — guard typeof, không có Nav vẫn đuổi
     thẳng), vào attackRadius thì đánh lại: damage = max(1, atk - def),
     cooldown riêng mỗi quái 1.2s; hero hết HP thì hồi sinh ở spawn
     (-0.2, 0.4) với đầy HP. Quái chết rơi vật phẩm (đi qua là nhặt).
   - 4 nút skill (Kiếm Khí / Hỏa Cầu / Hồi Máu / Sét Đánh mặc định;
     dùng characters[].skills nếu có), cooldown riêng, FX tương ứng.
   - Quest chạy thật trong phiên Play: kill/talk/collect đếm tiến độ
     thật, đủ count thì thưởng vàng/bạc, tiến độ CHỈ sống trong phiên
     Play (Stop là mất, không sửa project gốc).
   ĐỢT 4 (AI có trí nhớ + sửa bug cũ): NPC ai='chase'/'attack' nhớ
   lastSeenPos/lastSeenAt — mất dấu thì alert (đi tới chỗ thấy địch lần
   cuối, A* qua ED.Nav nếu có, không có thì đi thẳng) -> search (đi vòng
   nhỏ bán kính ~2 quanh đó, mặc định 5s, chỉnh qua npc.searchDuration)
   -> về home (waypoint đầu/spawn) + patrol/idle; thấy lại thì về chase.
   Mọi chuyển state qua ED.NpcAi.nextAiState (thuần). Trạng thái AI hiện
   trên đầu NPC trong Play Mode bằng THREE.Sprite + canvas texture
   (nhãn tiếng Việt, chỉ vẽ lại khi state đổi, thoát Play thì ẩn).
   SỬA BUG: ED.Viewport.getTerrainMesh() đã có thật (01-viewport.js đợt
   4, delegate ED.Terrain.getMesh() -> mesh Viewport -> null) nên
   _raycastGround dùng được; _navFindPath sửa luôn bug truyền mảng
   [x,z] vào ED.Nav.findPath(x0,z0,x1,z1) (Number([x,z]) = NaN nên đường
   A* của quái attack trước đây luôn tính sai).
   ĐỢT 3 (physics-lite, ED.Physics 17-physics.js — VẬT LÝ ĐƠN GIẢN, KHÔNG
   phải rigid-body đầy đủ): trọng lực + nhảy (Space / nút ⬆ Nhảy, chỉ
   khi chạm đất, không nhảy đôi), chặn tường capsule-vs-box + trượt dọc
   tường, thùng (type crate hoặc extra.pushable) đẩy được, prop trên cao
   rơi xuống đất. Bật/tắt trong panel Vật lý (mặc định bật). Khi module
   17-physics.js chưa nối vào build (coordinator nối sau) thì chơi như
   cũ, không crash. Space khi vật lý bật = nhảy (đánh chuyển sang phím
   X / nút ⚔️); vật lý tắt thì Space = đánh như cũ.
   QUY TẮC DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   logic thuần expose để nhóm D test bằng vm + stub THREE.
   GIỚI HẠN: chưa render thử trên trình duyệt/điện thoại thật; click-to-
   move cần ED.Viewport.raycastGround (nhóm A) hoặc terrain mesh — không
   có thì chỉ WASD vẫn chạy; ED.Nav / ED.Animation CHƯA có trong repo
   nên quái đi thẳng + chỉ chớp màu khi đánh/bị đánh, chưa có animation
   tấn công riêng; tiến độ quest/vàng chỉ trong phiên Play. */

var ED = (typeof ED !== 'undefined' && ED) ? ED : {};

/* ---------------- Logic thuần (không DOM/THREE) ---------------- */

/* Bước di chuyển thuần: từ pos đi về target với tốc độ (đơn vị/giây). */
function edPlayStepToward(pos, target, speed, dt) {
  var dx = target[0] - pos[0];
  var dz = target[1] - pos[1];
  var dist = Math.sqrt(dx * dx + dz * dz);
  var step = (Number(speed) || 0) * (Number(dt) || 0);
  if (dist <= 0 || step <= 0) return { pos: [pos[0], pos[1]], arrived: dist <= 0.001 };
  if (step >= dist) return { pos: [target[0], target[1]], arrived: true };
  var k = step / dist;
  return { pos: [pos[0] + dx * k, pos[1] + dz * k], arrived: false };
}

/* Di chuyển hero theo hướng dir [dx,dz] (đã chuẩn hoá hoặc chưa) 1 frame. */
function edPlayMoveHero(pos, dir, speed, dt) {
  var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
  if (len <= 0 || !(Number(speed) > 0) || !(Number(dt) > 0)) return [pos[0], pos[1]];
  var s = (Number(speed) * Number(dt)) / len;
  return [pos[0] + dir[0] * s, pos[1] + dir[1] * s];
}

/* Sát thương đơn giản: max(1, atk - def). */
function edPlayDamageCalc(atk, def) {
  return Math.max(1, (Number(atk) || 0) - (Number(def) || 0));
}

function edPlayApplyDamage(hp, dmg) {
  var next = (Number(hp) || 0) - (Number(dmg) || 0);
  if (next < 0) next = 0;
  return { hp: next, dead: next <= 0 };
}

function edPlayInRange(a, b, radius) {
  var dx = a[0] - b[0];
  var dz = a[1] - b[1];
  return Math.sqrt(dx * dx + dz * dz) <= (Number(radius) || 0);
}

function edPlayDialogueNext(lines, idx) {
  var arr = Array.isArray(lines) ? lines : [];
  if (!arr.length) return { line: null, next: -1, done: true };
  var i = Number(idx) || 0;
  if (i < 0) i = 0;
  if (i >= arr.length) return { line: null, next: -1, done: true };
  return { line: arr[i], next: (i + 1 < arr.length) ? i + 1 : -1, done: i + 1 >= arr.length };
}

/* Ô nước? paints: mảng terrain.paints, size: terrain.size, segments:
   số ô mỗi cạnh. Toạ độ thế giới x/z -> chỉ số lưới. Ngoài biên -> false. */
function edPlayIsWaterCell(paints, size, segments, x, z) {
  if (!Array.isArray(paints) || !paints.length) return false;
  var s = Number(size) || 96;
  var n = Number(segments) || 64;
  if (n <= 0) return false;
  var cell = s / n;
  var gx = Math.round((x + s / 2) / cell);
  var gz = Math.round((z + s / 2) / cell);
  if (gx < 0 || gz < 0 || gx > n || gz > n) return false;
  return paints[gz * (n + 1) + gx] === 4;
}

/* Chắn bởi object có collider box? Kiểm tra khoảng cách đơn giản:
   |dx| < nửa-rộng-x + radius && |dz| < nửa-sâu-z + radius.
   Bỏ qua: chính hero, npc, waypoint, fx, light, terrain, water, monster
   (quái chặn bằng tầm đánh, không chặn di chuyển). scale mặc định [1,1,1].
   Trả object chắn đầu tiên hoặc null. */
function edPlayBlockedByObjects(pos, objects, radius, selfId) {
  if (!Array.isArray(objects)) return null;
  var r = (Number(radius) || 0.35);
  for (var i = 0; i < objects.length; i++) {
    var o = objects[i];
    if (!o || !o.pos || o.id === selfId) continue;
    if (o.type === 'npc' || o.type === 'waypoint' || o.type === 'fx' ||
        o.type === 'light' || o.type === 'terrain' || o.type === 'water' ||
        o.type === 'monster' || o.type === 'character') continue;
    if (o.visible === false) continue;
    var sc = (Array.isArray(o.scale) && o.scale.length >= 3) ? o.scale : [1, 1, 1];
    var hx = Math.abs(Number(sc[0]) || 1) * 0.5 + r;
    var hz = Math.abs(Number(sc[2]) || 1) * 0.5 + r;
    var dx = Math.abs((Number(o.pos[0]) || 0) - pos[0]);
    var dz = Math.abs((Number(o.pos[2]) || 0) - pos[1]); /* pos là [x,z] nên z = pos[1] */
    if (dx < hx && dz < hz) return o;
  }
  return null;
}

function edPlayClampToBounds(pos, halfSize) {
  var h = Number(halfSize) || 48;
  return [
    Math.min(h, Math.max(-h, pos[0])),
    Math.min(h, Math.max(-h, pos[1]))
  ];
}

/* NPC 1 bước trong Play Mode theo ai (thuần, rand truyền vào để test):
   patrol: đi theo waypoint (tốc độ chậm = speed*0.5), wander: đi về
   target rồi chọn điểm mới quanh home, chase: đuổi hero khi vào
   detectionRadius, attack/follow: như chase (follow không cần vào tầm).
   Trả {pos, wpIndex, target, state}. */
function edPlayUpdateNpc(npc, heroPos, pos, dt, wpIndex, target, rand) {
  var ai = (npc && npc.ai) || 'idle';
  var speed = (npc && Number(npc.speed) > 0) ? Number(npc.speed) : 2;
  var home = (npc && Array.isArray(npc.pos)) ? [npc.pos[0], npc.pos[1]] : [pos[0], pos[1]];
  if (ai === 'patrol') {
    var patrol = (npc && Array.isArray(npc.patrol)) ? npc.patrol : [];
    if (!patrol.length) return { pos: [pos[0], pos[1]], wpIndex: 0, target: target, state: 'idle' };
    var idx = ((Number(wpIndex) || 0) % patrol.length + patrol.length) % patrol.length;
    var r = edPlayStepToward(pos, patrol[idx], speed * 0.5, dt);
    if (r.arrived) idx = (idx + 1) % patrol.length;
    return { pos: r.pos, wpIndex: idx, target: target, state: 'patrol' };
  }
  if (ai === 'wander') {
    var tgt = target;
    if (!tgt) {
      var rnd = (typeof rand === 'function') ? rand : Math.random;
      var a = rnd() * Math.PI * 2;
      var rr = rnd() * 3;
      tgt = [home[0] + Math.cos(a) * rr, home[1] + Math.sin(a) * rr];
    }
    var w = edPlayStepToward(pos, tgt, speed * 0.5, dt);
    if (w.arrived) tgt = null;
    return { pos: w.pos, wpIndex: wpIndex || 0, target: tgt, state: 'wander' };
  }
  if (ai === 'chase' || ai === 'attack' || ai === 'follow') {
    var det = (npc && Number(npc.detectionRadius) > 0) ? Number(npc.detectionRadius) : 5;
    var dx = heroPos[0] - pos[0];
    var dz = heroPos[1] - pos[1];
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (ai === 'follow' || dist <= det) {
      var c = edPlayStepToward(pos, heroPos, speed, dt);
      return { pos: c.pos, wpIndex: wpIndex || 0, target: target, state: ai };
    }
    return { pos: [pos[0], pos[1]], wpIndex: wpIndex || 0, target: target, state: 'idle' };
  }
  return { pos: [pos[0], pos[1]], wpIndex: wpIndex || 0, target: target, state: 'idle' };
}

/* Snapshot project JSON lúc start; restore = JSON.parse (bản sao sâu). */
function edPlaySnapshotProject(project) {
  return JSON.stringify(project || {});
}

function edPlayRestoreProject(json) {
  try { return JSON.parse(json || '{}'); } catch (e) { return null; }
}

/* ---- Đợt 2: hằng số phiên Play ---- */

/* Điểm hồi sinh hero — theo game (10-game-link.js: parseWorldSource và
   sampleProject đều cho spawn player (-0.2, 0.4)). */
var ED_PLAY_SPAWN = [-0.2, 0.4];

/* 4 skill mặc định của nhân vật chơi (project.characters[] HIỆN KHÔNG có
   skills — xem edPlayNormalizeSkills: nếu character có skills thì dùng
   của nó). cooldown: giây; damage: HP trừ quái; range: ô; heal: HP hồi. */
var ED_PLAY_DEFAULT_SKILLS = [
  { name: 'Kiếm Khí', cooldown: 3, fxType: 'fire', damage: 25, range: 6 },
  { name: 'Hỏa Cầu', cooldown: 5, fxType: 'fire', damage: 40, range: 8 },
  { name: 'Hồi Máu', cooldown: 8, fxType: 'heal', damage: 0, range: 0, heal: 30 },
  { name: 'Sét Đánh', cooldown: 6, fxType: 'lightning', damage: 35, range: 7 }
];
var ED_PLAY_SKILL_FX = { fire: true, smoke: true, lightning: true, aura: true, heal: true };

/* Quái đánh hero 1 đòn (thuần, test được bằng vm).
   npc: {atk, def} — atk: sát thương của quái (mặc định 10); def: giáp
     của NGƯỜI BỊ ĐÁNH (hero) do caller truyền vào (mặc định 0) — tức
     damage = max(1, atk_quái - def_hero).
   heroHp: HP hero hiện tại; now/lastAttackAt: ms trên đồng hồ phiên
     Play (dừng khi pause); cooldown: giây (mặc định 1.2).
   lastAttackAt = null nghĩa là chưa đánh lần nào -> được đánh ngay.
   Trả {heroHp, attacked, lastAttackAt, damage}. */
function edPlayMonsterAttack(npc, heroHp, now, lastAttackAt, cooldown) {
  var cd = (Number(cooldown) > 0) ? Number(cooldown) : 1.2;
  var last = (lastAttackAt === null || lastAttackAt === undefined) ? null : Number(lastAttackAt);
  var t = Number(now) || 0;
  if (last !== null && isFinite(last) && t - last < cd * 1000) {
    return { heroHp: Number(heroHp) || 0, attacked: false, lastAttackAt: last, damage: 0 };
  }
  var atk = (npc && isFinite(Number(npc.atk))) ? Number(npc.atk) : 10;
  var def = (npc && isFinite(Number(npc.def))) ? Number(npc.def) : 0;
  var dmg = Math.max(1, atk - def);
  var hp = Math.max(0, (Number(heroHp) || 0) - dmg);
  return { heroHp: hp, attacked: true, lastAttackAt: t, damage: dmg };
}

/* Skill còn cooldown không (thuần). lastUsedAt: ms (null = chưa dùng bao
   giờ); cooldown: giây; now: ms. Trả {ready, remain} — remain: giây còn
   lại, làm tròn 0.1, 0 khi đã sẵn sàng. */
function edPlaySkillReady(lastUsedAt, cooldown, now) {
  var cd = (Number(cooldown) > 0) ? Number(cooldown) : 0;
  if (lastUsedAt === null || lastUsedAt === undefined) return { ready: true, remain: 0 };
  var elapsed = ((Number(now) || 0) - Number(lastUsedAt)) / 1000;
  var remain = cd - elapsed;
  if (remain <= 0) return { ready: true, remain: 0 };
  return { ready: false, remain: Math.round(remain * 10) / 10 };
}

/* Chuẩn hoá danh sách skill của nhân vật chơi: dùng characters[].skills
   nếu có, không có thì dùng 4 skill mặc định. Mỗi skill: {name,
   cooldown (giây), fxType, damage, range, heal}. */
function edPlayNormalizeSkills(charSkills) {
  var src = (Array.isArray(charSkills) && charSkills.length) ? charSkills : ED_PLAY_DEFAULT_SKILLS;
  return src.map(function (s) {
    var d = (s && typeof s === 'object') ? s : {};
    var fx = (typeof d.fxType === 'string' && ED_PLAY_SKILL_FX[d.fxType]) ? d.fxType : 'fire';
    var damage = Number(d.damage);
    if (!isFinite(damage) || damage < 0) damage = 0;
    var heal = Number(d.heal);
    if (!isFinite(heal) || heal < 0) heal = (fx === 'heal') ? 30 : 0;
    var cd = Number(d.cooldown);
    if (!(cd > 0)) cd = 3;
    var range = Number(d.range);
    if (!(range >= 0)) range = 6;
    return {
      name: (typeof d.name === 'string' && d.name) ? d.name : 'Kỹ năng',
      cooldown: cd, fxType: fx, damage: damage, range: range, heal: heal
    };
  });
}

/* Thi triển 1 skill (thuần, test được bằng vm).
   skill: skill đã chuẩn hoá; heroPos [x,z]; heroHp/heroMaxHp;
   monsters: [{id, pos:[x,z], hp}].
   - Hồi máu (fxType 'heal' hoặc damage<=0 mà heal>0): hồi HP hero
     (tối đa heroMaxHp), FX heal tại hero.
   - Sát thương: đánh quái GẦN NHẤT trong range; không có quái trong
     tầm -> applied=false (caller KHÔNG tính cooldown, KHÔNG tạo FX).
   Trả {heroHp, healed, hits:[{id, damage, hp, dead}], fx:{fxType,x,z}
   | null, targetId, applied}. */
function edPlaySkillApply(skill, heroPos, heroHp, heroMaxHp, monsters) {
  var sk = skill || {};
  var fxType = sk.fxType || 'fire';
  var isHeal = fxType === 'heal' || ((Number(sk.damage) || 0) <= 0 && (Number(sk.heal) || 0) > 0);
  var hp = Number(heroHp) || 0;
  if (isHeal) {
    var heal = (Number(sk.heal) > 0) ? Number(sk.heal) : 30;
    var maxHp = (Number(heroMaxHp) > 0) ? Number(heroMaxHp) : 100;
    var next = Math.min(maxHp, hp + heal);
    return {
      heroHp: next, healed: next - hp, hits: [],
      fx: { fxType: 'heal', x: heroPos[0], z: heroPos[1] },
      targetId: null, applied: true
    };
  }
  var range = (Number(sk.range) > 0) ? Number(sk.range) : 6;
  var best = null, bestD = Infinity;
  (monsters || []).forEach(function (m) {
    if (!m || !Array.isArray(m.pos)) return;
    var d = Math.sqrt(Math.pow(m.pos[0] - heroPos[0], 2) + Math.pow(m.pos[1] - heroPos[1], 2));
    if (d <= range && d < bestD) { best = m; bestD = d; }
  });
  if (!best) {
    return { heroHp: hp, healed: 0, hits: [], fx: null, targetId: null, applied: false };
  }
  var dmg = Math.max(1, Number(sk.damage) || 0);
  var mhp = Math.max(0, (Number(best.hp) || 0) - dmg);
  return {
    heroHp: hp, healed: 0,
    hits: [{ id: best.id, damage: dmg, hp: mhp, dead: mhp <= 0 }],
    fx: { fxType: fxType, x: best.pos[0], z: best.pos[1] },
    targetId: best.id, applied: true
  };
}

/* Vàng quái rơi khi chết: 10 + 5/level (xác định, không random). */
function edPlayGoldDrop(npc) {
  var lv = (npc && Number(npc.level) > 0) ? Number(npc.level) : 1;
  return 10 + lv * 5;
}

/* Quái có khớp loại mục tiêu quest không (thuần). monsterType rỗng/null
   nghĩa là mọi quái đều tính. So khớp không phân biệt hoa/thường, khớp
   bằng hoặc chứa (vd 'Quái' khớp 'Quái rừng', 'boss' khớp 'Boss'). */
function edPlayMonsterMatches(monsterType, info) {
  if (!monsterType) return true;
  var want = String(monsterType).toLowerCase().trim();
  if (!want) return true;
  var cands = [];
  if (info) {
    ['monsterType', 'name', 'type', 'npcType'].forEach(function (k) {
      if (info[k]) cands.push(String(info[k]).toLowerCase());
    });
  }
  for (var i = 0; i < cands.length; i++) {
    if (cands[i] === want || cands[i].indexOf(want) >= 0 || want.indexOf(cands[i]) >= 0) return true;
  }
  return false;
}

/* ---- Quest: chuẩn hoá target/reward (hỗ trợ CẢ 2 dạng) ----
   Dạng MỚI (đợt 2): q.target = {type:'kill'|'talk'|'collect', count:N,
     monsterType?/npcId?/item?} (chấp nhận bí danh: monster/name,
     npc/name, itemName).
   Dạng CŨ (08-npc-ai.js edNpcNewQuest): q.target = STRING ('', 'Giết 5
     Quái', 'Nói chuyện với ...', 'Thu thập 3 ...') và q.type =
     'Giết quái'/'Boss'/'Nói chuyện'/'Thu thập' (không có count thì
     count=1). q.target rỗng + q.type chung ('Chính'/'Phụ'...) -> null
     (quest không có mục tiêu đếm được trong Play, không hiện tiến độ).
   Trả {id, name, desc, target:{type,count,monsterType,npcId,item},
   raw:q} hoặc null. */
function edPlayParseQuestTarget(target, qtype) {
  function normType(t) {
    var s = String(t || '').toLowerCase().trim();
    if (s === 'kill' || s === 'giết quái' || s === 'boss' || s.indexOf('giết') === 0) return 'kill';
    if (s === 'talk' || s === 'nói chuyện' || s.indexOf('nói chuyện') === 0 || s.indexOf('gặp') === 0) return 'talk';
    if (s === 'collect' || s === 'thu thập' || s.indexOf('thu thập') === 0) return 'collect';
    return null;
  }
  function countOf(v, fallback) {
    var n = Number(v);
    return (isFinite(n) && n > 0) ? Math.floor(n) : fallback;
  }
  if (target && typeof target === 'object') {
    var ty = normType(target.type);
    if (!ty) return null;
    return {
      type: ty,
      count: countOf(target.count, 1),
      monsterType: target.monsterType || target.monster || target.name || null,
      npcId: target.npcId || target.npc || target.name || null,
      item: target.item || target.itemName || target.name || null
    };
  }
  if (typeof target === 'string' && target.trim()) {
    var s = target.trim();
    var m;
    m = /^giết\s+(\d+)\s*(.*)$/i.exec(s);
    if (m) return { type: 'kill', count: countOf(m[1], 1), monsterType: (m[2] || '').trim() || null, npcId: null, item: null };
    m = /^giết\s+(.+)$/i.exec(s);
    if (m) return { type: 'kill', count: 1, monsterType: m[1].trim() || null, npcId: null, item: null };
    m = /^nói chuyện(?:\s+với)?\s*(.*)$/i.exec(s);
    if (m) return { type: 'talk', count: 1, monsterType: null, npcId: (m[1] || '').trim() || null, item: null };
    m = /^gặp\s+(.+)$/i.exec(s);
    if (m) return { type: 'talk', count: 1, monsterType: null, npcId: m[1].trim() || null, item: null };
    m = /^thu thập\s+(\d+)\s*(.*)$/i.exec(s);
    if (m) return { type: 'collect', count: countOf(m[1], 1), monsterType: null, npcId: null, item: (m[2] || '').trim() || null };
    m = /^thu thập\s+(.+)$/i.exec(s);
    if (m) return { type: 'collect', count: 1, monsterType: null, npcId: null, item: m[1].trim() || null };
  }
  var ft = normType(qtype);
  if (ft) return { type: ft, count: 1, monsterType: null, npcId: null, item: null };
  return null;
}

function edPlayNormalizeQuest(q) {
  if (!q || !q.id) return null;
  var target = edPlayParseQuestTarget(q.target, q.type);
  if (!target) return null;
  return { id: q.id, name: q.name || q.id, desc: q.desc || '', target: target, raw: q };
}

/* Thưởng quest (thuần). Dạng cũ: reward {knb, silver, item} — KNB tính
   là vàng; dạng mới: {gold, silver, item}; số thẳng = vàng. Không có
   thưởng (vàng=bạc=0) thì mặc định 100 vàng. */
function edPlayQuestReward(q) {
  var r = (q && q.reward) || {};
  if (typeof r === 'number') return { gold: r, silver: 0, item: '' };
  var gold = Number(r.gold);
  if (!isFinite(gold) || gold < 0) gold = 0;
  if (!gold) {
    var knb = Number(r.knb);
    if (isFinite(knb) && knb > 0) gold = knb;
  }
  var silver = Number(r.silver);
  if (!isFinite(silver) || silver < 0) silver = 0;
  if (gold <= 0 && silver <= 0) gold = 100;
  return { gold: gold, silver: silver, item: (typeof r.item === 'string') ? r.item : '' };
}

/* Cộng tiến độ quest 1 sự kiện (thuần, không sửa state gốc — trả state
   mới). state: {progress, completed}; target: target đã chuẩn hoá;
   ev: {kind:'kill', name?, type?, npcType?, monsterType?} |
       {kind:'talk', npcId?, npcName?} | {kind:'collect', item?}.
   Trả {progress, completed, justCompleted}. */
function edPlayQuestProgress(state, target, ev) {
  var st = state || { progress: 0, completed: false };
  if (st.completed || !target || !ev) {
    return { progress: st.progress || 0, completed: !!st.completed, justCompleted: false };
  }
  var ok = false;
  if (ev.kind === 'kill' && target.type === 'kill') {
    ok = edPlayMonsterMatches(target.monsterType, ev);
  } else if (ev.kind === 'talk' && target.type === 'talk') {
    ok = !target.npcId || target.npcId === ev.npcId || target.npcId === ev.npcName;
  } else if (ev.kind === 'collect' && target.type === 'collect') {
    ok = !target.item || target.item === ev.item;
  }
  if (!ok) return { progress: st.progress || 0, completed: false, justCompleted: false };
  var count = (Number(target.count) > 0) ? Number(target.count) : 1;
  var p = (st.progress || 0) + 1;
  var done = p >= count;
  return { progress: done ? count : p, completed: done, justCompleted: done };
}

/* Dòng tiến độ hiển thị trong thanh Play: "Tên quest: 2/5" / "Tên: ✓ Xong". */
function edPlayQuestLabel(normQuest, progress, completed) {
  if (!normQuest) return '';
  if (completed) return (normQuest.name || normQuest.id) + ': ✓ Xong';
  return (normQuest.name || normQuest.id) + ': ' + (Number(progress) || 0) + '/' + (Number(normQuest.target.count) || 1);
}

/* ---------------- Module ED.Play ---------------- */

ED.Play = {
  /* Logic thuần — nhóm D test được bằng vm + stub THREE. */
  stepToward: edPlayStepToward,
  moveHero: edPlayMoveHero,
  damageCalc: edPlayDamageCalc,
  applyDamage: edPlayApplyDamage,
  inRange: edPlayInRange,
  dialogueNext: edPlayDialogueNext,
  isWaterCell: edPlayIsWaterCell,
  blockedByObjects: edPlayBlockedByObjects,
  clampToBounds: edPlayClampToBounds,
  updateNpc: edPlayUpdateNpc,
  snapshotProject: edPlaySnapshotProject,
  restoreProject: edPlayRestoreProject,
  /* Đợt 2 — nhóm D test được bằng vm + stub THREE. */
  monsterAttack: edPlayMonsterAttack,
  skillReady: edPlaySkillReady,
  normalizeSkills: edPlayNormalizeSkills,
  skillApply: edPlaySkillApply,
  goldDrop: edPlayGoldDrop,
  monsterMatches: edPlayMonsterMatches,
  parseQuestTarget: edPlayParseQuestTarget,
  normalizeQuest: edPlayNormalizeQuest,
  questReward: edPlayQuestReward,
  questProgress: edPlayQuestProgress,
  questLabel: edPlayQuestLabel,
  DEFAULT_SKILLS: ED_PLAY_DEFAULT_SKILLS,
  SPAWN: ED_PLAY_SPAWN,

  _playing: false,
  _paused: false,
  _snapshot: null,
  _heroId: null,         /* object id của nhân vật đang điều khiển */
  _tempHeroId: null,     /* id hero chibi tạm (tạo khi scene chưa có character) */
  _heroPos: [0, 0],      /* [x,z] hiện tại của hero */
  _moveTarget: null,     /* [x,z] click-to-move, null = không */
  _keys: {},             /* phím đang giữ: KeyW/A/S/D, Space */
  _raf: 0,
  _lastT: 0,
  _npcState: {},         /* npcId -> {wpIndex, target, pos} */
  _dialogue: null,       /* {npcId, lines, idx} */
  _talkedTo: {},         /* npcId -> true: đã nói chuyện, chỉ nói lại khi hero rời khỏi tầm rồi quay lại */
  _hiddenPanels: [],     /* [{el, display}] — fallback ẩn panel khi nhóm A chưa có CSS .playing */
  _bar: null,            /* thanh Play (Pause/Stop/Đánh) */
  _dlgBox: null,         /* hộp thoại NPC */
  _attackBtn: null,
  /* Đợt 2: trạng thái phiên Play (Stop là mất hết, không sửa project). */
  _heroHp: 0,            /* HP hero hiện tại */
  _heroMaxHp: 100,       /* HP tối đa (characters[].hp, mặc định 100) */
  _heroDef: 0,           /* giáp hero (characters[].def, mặc định 0) */
  _heroAtk: 10,          /* atk hero (characters[].atk, mặc định 10) */
  _skills: [],           /* 4 skill đã chuẩn hoá của nhân vật chơi */
  _skillLastUsed: [],    /* ms (đồng hồ phiên Play) mỗi skill dùng lần cuối */
  _skillBtns: [],        /* 4 nút skill */
  _skillBar: null,       /* thanh skill */
  _questBox: null,       /* hộp tiến độ quest */
  _questsNorm: [],       /* quest đã chuẩn hoá (chỉ quest đếm được) */
  _questState: {},       /* questId -> {progress, completed} (phiên Play) */
  _gold: 0,              /* vàng kiếm được trong phiên Play */
  _silver: 0,            /* bạc kiếm được trong phiên Play */
  _drops: [],            /* vật rơi trên đất: {id, x, z, item} */
  _dropCounter: 0,
  _dropMeshes: {},       /* dropId -> mesh tạm (best-effort, có thể không có) */
  _fxCounter: 0,
  _playTime: 0,          /* giây đã chơi (dừng khi pause) — đồng hồ cooldown */
  _hpText: null,
  _hpFill: null,
  _goldText: null,
  _lastHud: null,
  /* Đợt 3 — physics-lite (ED.Physics, 17-physics.js). Trạng thái phiên
     Play, Stop là mất (snapshot khôi phục vị trí object). */
  _physicsOn: true,      /* nút bật/tắt trong panel Vật lý (mặc định bật) */
  _heroVy: 0,            /* vận tốc dọc hero (đơn vị/giây) */
  _heroY: 0,             /* y bàn chân hero (đáy capsule) */
  _heroGrounded: true,   /* hero có đang chạm đất / mặt đỡ không */
  _crateVel: {},         /* crateId -> {vel:[vx,vz]} (chỉ trong phiên Play) */
  _fallingProps: [],     /* [{id, velY, resting}] prop đang rơi (phiên Play) */
  _physPanel: null,      /* panel Vật lý (góc phải trên, chỉ trong Play) */
  _physToggleBtn: null,
  _physStatus: null,     /* dòng trạng thái grounded/đang rơi */
  _jumpBtn: null,        /* nút ⬆ Nhảy trên thanh Play (điện thoại) */
  _boundKeyDown: null,
  _boundKeyUp: null,
  _boundPointer: null,
  /* Đợt 4 — nhãn trạng thái AI trên đầu NPC (THREE.Sprite + canvas,
     chỉ trong Play Mode; thoát Play thì _hideAiLabels dọn hết). */
  _aiLabels: {},         /* npcId -> {sprite, canvas, ctx2d, texture, state} */

  /* Project đang sửa: ED.Core.getProject() (nhóm A) nếu có. Lưu ý:
     ED.Core KHÔNG có thuộc tính .project. */
  project: function () {
    if (ED.Core && typeof ED.Core.getProject === 'function') {
      var p = null;
      try { p = ED.Core.getProject(); } catch (e) { p = null; }
      if (p && typeof p === 'object') return p;
    }
    if (ED.Core && ED.Core.project && typeof ED.Core.project === 'object') return ED.Core.project;
    if (ED.NpcAi && typeof ED.NpcAi.project === 'function') return ED.NpcAi.project();
    if (ED.Character && typeof ED.Character.project === 'function') return ED.Character.project();
    return { version: 1, name: 'Project mới', terrain: { size: 96, segments: 64, heights: [], paints: [] }, env: {}, objects: [], npcs: [], quests: [], characters: [] };
  },

  log: function (msg) {
    try { if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log(msg); } catch (e) {}
  },

  toast: function (msg) {
    try { if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg); } catch (e) {}
  },

  isPlaying: function () { return this._playing; },
  isPaused: function () { return this._paused; },

  /* Tìm object type 'character' đầu tiên; không có thì tạo hero chibi tạm
     tại spawn (0,0) — xoá khi Stop. */
  _ensureHero: function () {
    var project = this.project();
    var hero = null;
    for (var i = 0; i < project.objects.length; i++) {
      var o = project.objects[i];
      if (o && o.type === 'character') { hero = o; break; }
    }
    if (!hero) {
      hero = {
        id: 'hero-temp-play', type: 'character', category: 'Characters',
        name: 'Hero (tạm)', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
        color: '#3b2f2f', extra: { tempHero: true }
      };
      var added = null;
      try {
        if (ED.Core && typeof ED.Core.addObject === 'function') added = ED.Core.addObject(hero);
      } catch (e) { added = null; }
      if (!added) {
        project.objects.push(hero);
        try { if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') ED.Viewport.syncObject(hero); } catch (e) {}
      } else {
        hero = added;
      }
      this._tempHeroId = hero.id;
    }
    this._heroId = hero.id;
    this._heroPos = [Number(hero.pos[0]) || 0, Number(hero.pos[2]) || 0];
    return hero;
  },

  /* Chỉ số nhân vật chơi: characters[] liên kết qua hero.extra.charId,
     không có thì lấy characters[0], không có nữa thì mặc định
     (HP 100, atk 10, def 0, speed 5, 4 skill mặc định). */
  _heroStats: function () {
    var project = this.project();
    var hero = null;
    for (var i = 0; i < project.objects.length; i++) {
      if (project.objects[i] && project.objects[i].id === this._heroId) { hero = project.objects[i]; break; }
    }
    var ch = null;
    if (hero && hero.extra && hero.extra.charId) {
      for (var j = 0; j < project.characters.length; j++) {
        if (project.characters[j] && project.characters[j].id === hero.extra.charId) { ch = project.characters[j]; break; }
      }
    }
    if (!ch && project.characters.length) ch = project.characters[0];
    return {
      maxHp: (ch && Number(ch.hp) > 0) ? Number(ch.hp) : 100,
      atk: (ch && Number(ch.atk) > 0) ? Number(ch.atk) : 10,
      def: (ch && Number(ch.def) > 0) ? Number(ch.def) : 0,
      speed: (ch && Number(ch.speed) > 0) ? Number(ch.speed) : 5,
      skills: edPlayNormalizeSkills(ch ? ch.skills : null)
    };
  },

  /* Tốc độ hero: characters[].speed của char liên kết (extra.charId),
     không có thì 5. */
  _heroSpeed: function () {
    return this._heroStats().speed;
  },

  /* Bắt đầu Play Mode — toolbar nhóm A gọi ED.Play.start(). */
  start: function () {
    if (this._playing) return false;
    var project = this.project();
    this._snapshot = edPlaySnapshotProject(project);
    this._playing = true;
    this._paused = false;
    this._moveTarget = null;
    this._keys = {};
    this._dialogue = null;
    this._talkedTo = {};
    this._npcState = {};
    var hero = this._ensureHero();
    /* Đợt 2: khởi tạo trạng thái phiên Play (HP/skill/vàng/quest). */
    var hs = this._heroStats();
    this._heroMaxHp = hs.maxHp;
    this._heroHp = hs.maxHp;
    this._heroDef = hs.def;
    this._heroAtk = hs.atk;
    this._skills = hs.skills;
    this._skillLastUsed = [];
    this._gold = 0;
    this._silver = 0;
    this._playTime = 0;
    this._drops = [];
    this._dropCounter = 0;
    this._fxCounter = 0;
    this._dropMeshes = {};
    this._lastHud = null;
    /* Đợt 3: khởi tạo physics-lite — hero y = mặt đất tại spawn (đứng
       trên terrain hoặc nóc box), prop trên cao chuẩn bị rơi. Không có
       ED.Physics (chưa nối build) thì _heroY giữ đúng pos[1] cũ. */
    this._heroVy = 0;
    this._heroGrounded = true;
    this._heroY = this._physOn()
      ? this._groundHeightAt(this._heroPos[0], this._heroPos[1], (hero.pos && Number(hero.pos[1])) || 0)
      : ((hero.pos && Number(hero.pos[1])) || 0);
    this._crateVel = {};
    this._initFallingProps();
    this._initQuests();
    this._refreshQuestBox();
    /* Khởi tạo trạng thái NPC (pos hiện tại + waypoint 0 + trí nhớ AI
       đợt 4: homePos = waypoint đầu nếu có, không thì vị trí spawn). */
    var self = this;
    (project.npcs || []).forEach(function (npc) {
      if (!npc || !npc.id) return;
      self._npcState[npc.id] = {
        wpIndex: 0, target: null,
        pos: (Array.isArray(npc.pos)) ? [Number(npc.pos[0]) || 0, Number(npc.pos[1]) || 0] : [0, 0],
        aiState: npc.ai || 'idle',
        homePos: (Array.isArray(npc.patrol) && npc.patrol.length)
          ? [Number(npc.patrol[0][0]) || 0, Number(npc.patrol[0][1]) || 0]
          : ((Array.isArray(npc.pos)) ? [Number(npc.pos[0]) || 0, Number(npc.pos[1]) || 0] : [0, 0]),
        lastSeenPos: null, lastSeenAt: null,
        searchStartedAt: null, searchTarget: null,
        returningHome: false, returnTarget: null,
        nav: null, alertNav: null
      };
    });
    this._hideAiLabels(); /* nhãn AI cũ của phiên trước (nếu còn) */
    /* Ẩn gizmo + panel edit: class 'playing' (nhóm A xử lý CSS) + fallback
       ẩn bằng style.display (khôi phục ở stop). */
    try {
      if (typeof document !== 'undefined' && document.body) document.body.classList.add('playing');
    } catch (e) {}
    this._hideEditPanels();
    try {
      if (ED.Viewport && typeof ED.Viewport.setPlayMode === 'function') ED.Viewport.setPlayMode(true);
    } catch (e) {}
    /* setPlayMode(true) của nhóm A đã ẩn gizmo; không gọi setGizmoMode
       với mode không hợp lệ. */
    this._showBar(true);
    this._bindInput();
    /* Đợt 2 — nhạc nền ambient (ED.Export, 15-export.js): phát khi vào Play. */
    try { if (ED.Export && typeof ED.Export.playAmbient === 'function') ED.Export.playAmbient(); } catch (e) {}
    this._lastT = 0;
    /* Đợt 3: vật lý bật thì Space = nhảy, X = đánh; tắt thì Space = đánh như cũ. */
    if (this._physOn()) {
      this.log('▶ Play Mode (vật lý đơn giản: trọng lực + nhảy, chặn tường, đẩy thùng): điều khiển "' + (hero.name || 'Hero') + '" bằng WASD hoặc click xuống đất. Space / nút ⬆ Nhảy để nhảy, X / nút ⚔️ để đánh quái gần. Skill: bấm 4 nút dưới màn hình hoặc phím 1-4.');
      this.toast('▶ Play Mode — WASD di chuyển, Space để nhảy, X để đánh, nút skill / phím 1-4.');
    } else {
      this.log('▶ Play Mode: điều khiển "' + (hero.name || 'Hero') + '" bằng WASD hoặc click xuống đất. Space / nút ⚔️ để đánh quái gần. Skill: bấm 4 nút dưới màn hình hoặc phím 1-4.');
      this.toast('▶ Play Mode — WASD di chuyển, Space để đánh, nút skill / phím 1-4 để dùng kỹ năng.');
    }
    var self2 = this;
    if (typeof requestAnimationFrame !== 'undefined') {
      var tick = function (t) {
        if (!self2._playing) return;
        self2._raf = requestAnimationFrame(tick);
        var dt = 0.016;
        if (self2._lastT) dt = Math.min(0.1, (t - self2._lastT) / 1000 || 0.016);
        self2._lastT = t;
        self2.update(dt);
      };
      this._raf = requestAnimationFrame(tick);
    }
    return true;
  },

  pause: function () {
    if (!this._playing) return false;
    this._paused = true;
    this._showBar(true);
    this.toast('⏸ Tạm dừng — di chuyển và AI đã dừng, scene vẫn giữ nguyên.');
    this.log('⏸ Play tạm dừng.');
    return true;
  },

  resume: function () {
    if (!this._playing) return false;
    this._paused = false;
    this._showBar(true);
    this.toast('▶ Tiếp tục chơi.');
    return true;
  },

  /* Dừng Play Mode: KHÔI PHỤC đúng scene trước khi Play (snapshot JSON),
     xoá hero tạm, hiện lại panel, tắt class 'playing'. */
  stop: function () {
    if (!this._playing) return false;
    this._playing = false;
    this._paused = false;
    if (typeof cancelAnimationFrame !== 'undefined' && this._raf) {
      try { cancelAnimationFrame(this._raf); } catch (e) {}
    }
    this._raf = 0;
    this._unbindInput();
    this._hideDialogue();
    this._showBar(false);
    /* Đợt 2 — dừng nhạc nền khi thoát Play Mode. */
    try { if (ED.Export && typeof ED.Export.stopAmbient === 'function') ED.Export.stopAmbient(); } catch (e) {}
    /* Đợt 4 — nhạc theo ngữ cảnh: thoát Play thì về explore ngay. */
    try { if (ED.Export && typeof ED.Export.setCombatMode === 'function') ED.Export.setCombatMode(false, true); } catch (e) {}
    /* Khôi phục project từ snapshot (ED.Core.load thay toàn bộ project,
       đúng API nhóm A; load() cũng chuẩn hoá lại các mảng thiếu). */
    var restored = edPlayRestoreProject(this._snapshot);
    if (restored) {
      try {
        if (ED.Core && typeof ED.Core.load === 'function') {
          ED.Core.load(restored);
        }
      } catch (e) {}
      /* Fallback: project cục bộ của nhóm C cũng khôi phục theo snapshot. */
      try {
        if (ED.NpcAi) ED.NpcAi._localProject = JSON.parse(this._snapshot);
        if (ED.Character) ED.Character._localProject = JSON.parse(this._snapshot);
      } catch (e) {}
      /* Đồng bộ lại toàn bộ mesh sau khi khôi phục. */
      try {
        if (ED.Viewport && typeof ED.Viewport.resyncAll === 'function') {
          ED.Viewport.resyncAll();
        } else if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') {
          for (var i = 0; i < restored.objects.length; i++) ED.Viewport.syncObject(restored.objects[i]);
        }
      } catch (e) {}
    }
    /* Đợt 4: ẩn nhãn trạng thái AI trên đầu NPC (chỉ hiện trong Play). */
    this._hideAiLabels();
    /* Đợt 2: dọn vật rơi còn trên đất + xoá trạng thái phiên Play
       (vàng/bạc/quest/skill/HP chỉ sống trong phiên, Stop là mất). */
    this._clearDrops();
    this._drops = [];
    this._dropMeshes = {};
    this._questsNorm = [];
    this._questState = {};
    this._skills = [];
    this._skillLastUsed = [];
    this._gold = 0;
    this._silver = 0;
    this._heroHp = 0;
    this._playTime = 0;
    this._lastHud = null;
    /* Đợt 3: dọn trạng thái physics phiên Play (vị trí object đã được
       snapshot khôi phục ở trên). */
    this._crateVel = {};
    this._fallingProps = [];
    this._heroVy = 0;
    this._heroGrounded = true;
    this._snapshot = null;
    this._heroId = null;
    this._tempHeroId = null;
    this._moveTarget = null;
    this._npcState = {};
    this._talkedTo = {};
    try {
      if (typeof document !== 'undefined' && document.body) document.body.classList.remove('playing');
    } catch (e) {}
    this._showEditPanels();
    try {
      if (ED.Viewport && typeof ED.Viewport.setPlayMode === 'function') ED.Viewport.setPlayMode(false);
    } catch (e) {}
    this.log('⏹ Đã về Editor Mode — scene khôi phục như trước khi Play.');
    this.toast('⏹ Đã về Editor Mode, scene khôi phục nguyên vẹn.');
    return true;
  },

  /* 1 frame Play Mode: hero + NPC AI + camera follow + kiểm tra tương tác. */
  update: function (dt) {
    if (!this._playing || this._paused) return;
    dt = (Number(dt) > 0) ? Math.min(0.1, Number(dt)) : 0.016;
    this._playTime = (this._playTime || 0) + dt; /* đồng hồ cooldown (dừng khi pause) */
    var project = this.project();
    var speed = this._heroSpeed();
    var pos = [this._heroPos[0], this._heroPos[1]];
    var moved = false;
    /* WASD (camera-relative đơn giản: W = -z, S = +z, A = -x, D = +x). */
    var dir = [0, 0];
    if (this._keys.KeyW || this._keys.ArrowUp) dir[1] -= 1;
    if (this._keys.KeyS || this._keys.ArrowDown) dir[1] += 1;
    if (this._keys.KeyA || this._keys.ArrowLeft) dir[0] -= 1;
    if (this._keys.KeyD || this._keys.ArrowRight) dir[0] += 1;
    if (dir[0] !== 0 || dir[1] !== 0) {
      this._moveTarget = null;
      pos = edPlayMoveHero(pos, dir, speed, dt);
      moved = true;
    } else if (this._moveTarget) {
      var r = edPlayStepToward(pos, this._moveTarget, speed, dt);
      pos = r.pos;
      moved = true;
      if (r.arrived) this._moveTarget = null;
    }
    if (moved) {
      pos = this._tryMove(pos, dt);
      this._heroPos = pos;
      this._applyHeroPos();
    }
    /* Đợt 3: trọng lực + nhảy + thùng trượt + vật rơi — chạy cả khi hero
       đứng yên (rơi/nhảy không cần di chuyển ngang). */
    this._updatePhysicsVertical(dt);
    /* NPC AI (chỉ trong Play Mode). */
    this._updateNpcs(dt);
    /* Đợt 2: quái đánh lại + nhặt vật rơi + HUD (HP/vàng/skill/quest). */
    this._updateMonsterAttacks();
    /* Đợt 4 — nhạc theo ngữ cảnh: có quái trong tầm tấn công thì vào combat. */
    try {
      if (ED.Export && typeof ED.Export.setCombatMode === 'function') {
        ED.Export.setCombatMode(!!this._nearestMonster(6));
      }
    } catch (e) {}
    this._updateDrops();
    /* Camera follow + kiểm tra NPC gần / quái gần. */
    this._followCamera();
    this._checkInteract();
    this._checkMonsterNear();
    this._refreshHud(false);
  },

  /* Thử đi tới pos mới.
     Đợt 3: vật lý bật + ED.Physics đã nối -> capsule-vs-box (trượt dọc
     tường là hệ quả tự nhiên của push-out theo pháp tuyến) + đẩy thùng
     trước rồi mới giải va chạm hero; vẫn chặn ô nước như cũ. Không có
     ED.Physics (hoặc vật lý tắt) thì giữ đúng đường cũ: chặn bởi
     collider box / ô nước, trượt theo từng trục khi đi chéo bị chặn. */
  _tryMove: function (target, dt) {
    var project = this.project();
    var cur = [this._heroPos[0], this._heroPos[1]];
    var half = (project.terrain && Number(project.terrain.size) > 0) ? Number(project.terrain.size) / 2 : 48;
    var t = edPlayClampToBounds(target, half);
    if (this._physOn()) {
      var P = ED.Physics;
      var terrain = project.terrain || {};
      var r = P.CAPSULE_RADIUS, h = P.CAPSULE_HEIGHT;
      var y = this._heroY;
      var dx = t[0] - cur[0], dz = t[1] - cur[1];
      var boxes = this._physBoxes();
      /* Đẩy thùng: hero đi vào thùng (type crate hoặc extra.pushable)
         thì thùng trượt theo hướng đẩy; thùng kẹt thì hero bị chặn ở
         mặt thùng (thùng vẫn nằm trong boxes khi giải va chạm hero). */
      if ((dx !== 0 || dz !== 0) && (Number(dt) > 0)) {
        var len = Math.sqrt(dx * dx + dz * dz);
        var dir = [dx / len, dz / len];
        var statics = [];
        for (var si = 0; si < boxes.length; si++) if (!boxes[si].pushable) statics.push(boxes[si]);
        for (var bi = 0; bi < boxes.length; bi++) {
          var cb = boxes[bi];
          if (!cb.pushable) continue;
          if (!P.capsuleHitsBox(t[0], t[1], y, r, h, cb)) continue;
          var obj = null;
          for (var k = 0; k < project.objects.length; k++) {
            if (project.objects[k] && project.objects[k].id === cb.id) { obj = project.objects[k]; break; }
          }
          if (!obj) continue;
          var crate = {
            pos: [Number(obj.pos[0]) || 0, Number(obj.pos[1]) || 0, Number(obj.pos[2]) || 0],
            vel: [0, 0], size: [cb.hx * 2, cb.hz * 2]
          };
          var st = this._crateVel[cb.id];
          if (st) crate.vel = [st.vel[0], st.vel[1]];
          var pr = P.pushCrate(crate, dir, dt, statics, {});
          this._crateVel[cb.id] = { vel: pr.crate.vel };
          if (pr.moved) {
            obj.pos = [pr.crate.pos[0], pr.crate.pos[1], pr.crate.pos[2]];
            this._syncObjPos(obj);
          }
          if (pr.crate.vel[0] === 0 && pr.crate.vel[1] === 0) delete this._crateVel[cb.id];
        }
        boxes = this._physBoxes(); /* vị trí thùng mới nhất */
      }
      var mv = P.moveCapsule(cur, dx, dz, y, r, h, boxes);
      var res = mv.pos;
      if (edPlayIsWaterCell(terrain.paints, terrain.size, terrain.segments, res[0], res[1])) {
        var mx = P.moveCapsule(cur, dx, 0, y, r, h, boxes).pos;
        if (!edPlayIsWaterCell(terrain.paints, terrain.size, terrain.segments, mx[0], mx[1])) return edPlayClampToBounds(mx, half);
        var mz = P.moveCapsule(cur, 0, dz, y, r, h, boxes).pos;
        if (!edPlayIsWaterCell(terrain.paints, terrain.size, terrain.segments, mz[0], mz[1])) return edPlayClampToBounds(mz, half);
        return cur;
      }
      return edPlayClampToBounds(res, half);
    }
    if (this._isBlocked(t)) {
      var tx = [t[0], cur[1]];
      var tz = [cur[0], t[1]];
      if (!this._isBlocked(tx)) return edPlayClampToBounds(tx, half);
      if (!this._isBlocked(tz)) return edPlayClampToBounds(tz, half);
      return cur;
    }
    return t;
  },

  _isBlocked: function (pos) {
    var project = this.project();
    if (edPlayBlockedByObjects(pos, project.objects, 0.35, this._heroId)) return true;
    var terrain = project.terrain || {};
    if (edPlayIsWaterCell(terrain.paints, terrain.size, terrain.segments, pos[0], pos[1])) return true;
    return false;
  },

  _applyHeroPos: function () {
    var project = this.project();
    for (var i = 0; i < project.objects.length; i++) {
      var o = project.objects[i];
      if (o && o.id === this._heroId) {
        /* Đợt 3: y = _heroY (bàn chân capsule, do trọng lực tính). Vật lý
           tắt thì _heroY giữ đúng pos[1] lúc vào Play nên không đổi gì. */
        o.pos = [this._heroPos[0], this._heroY, this._heroPos[1]];
        try {
          if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') ED.Viewport.syncObject(o);
          else if (ED.Viewport && ED.Viewport.meshes && ED.Viewport.meshes[o.id]) {
            ED.Viewport.meshes[o.id].position.set(o.pos[0], o.pos[1], o.pos[2]);
          }
        } catch (e) {}
        return;
      }
    }
  },

  _updateNpcs: function (dt) {
    var project = this.project();
    var self = this;
    (project.npcs || []).forEach(function (npc) {
      if (!npc || !npc.id) return;
      var st = self._npcState[npc.id];
      if (!st) {
        st = { wpIndex: 0, target: null, pos: [Number(npc.pos[0]) || 0, Number(npc.pos[1]) || 0] };
        self._npcState[npc.id] = st;
      }
      /* Đợt 4 — homePos + aiState mặc định cho NPC thêm giữa phiên Play
         (start() đã khởi tạo cho NPC có sẵn lúc vào Play). */
      if (!st.homePos) {
        st.homePos = (Array.isArray(npc.patrol) && npc.patrol.length)
          ? [Number(npc.patrol[0][0]) || 0, Number(npc.patrol[0][1]) || 0]
          : [Number(npc.pos[0]) || 0, Number(npc.pos[1]) || 0];
      }
      if (!st.aiState) st.aiState = npc.ai || 'idle';
      var r;
      var useMemory = (npc.ai === 'attack' || npc.ai === 'chase') &&
        ED.NpcAi && typeof ED.NpcAi.nextAiState === 'function';
      if (useMemory) {
        /* Đợt 4: NPC đuổi/đánh có trí nhớ (alert/search/về nhà). */
        r = self._updateAggressiveNpc(npc, st, dt);
      } else if (npc.ai === 'attack' && ED.NpcAi && typeof ED.NpcAi.attackStep === 'function') {
        /* Fallback khi ED.NpcAi.nextAiState chưa có (bản build cũ):
           giữ đúng đường đợt 2 — quái attack đuổi theo đường Nav nếu có
           (guard typeof trong _navFindPath/_navStepAlong), không có Nav
           thì đuổi thẳng. */
        if (!st.nav) st.nav = {};
        var self2 = self;
        var findPathFn = function (from, to) { return self2._navFindPath(from, to); };
        var stepAlongFn = function (path, p, speed, dt2, idx) { return self2._navStepAlong(path, p, speed, dt2, idx); };
        var ar = ED.NpcAi.attackStep(npc, st.pos, self._heroPos, dt, st.nav, findPathFn, stepAlongFn, self._playTime * 1000);
        st.nav = ar.state;
        st.aiState = ar.attacking ? 'attack' : (ar.chasing ? 'chase' : 'idle');
        r = { pos: ar.pos, wpIndex: st.wpIndex, target: st.target, state: st.aiState };
      } else {
        r = edPlayUpdateNpc(npc, self._heroPos, st.pos, dt, st.wpIndex, st.target);
        st.aiState = r.state;
      }
      st.pos = r.pos;
      st.wpIndex = r.wpIndex;
      st.target = r.target;
      /* Ghi lại pos để Play Mode sau vẫn thấy NPC ở chỗ mới (snapshot lúc
         stop sẽ khôi phục lại — không mất dữ liệu gốc). */
      npc.pos = [r.pos[0], r.pos[1]];
      var obj = null;
      for (var i = 0; i < project.objects.length; i++) {
        /* Đợt 2: quái attack có object type 'monster' (không chỉ 'npc'). */
        if (project.objects[i] && project.objects[i].id === npc.id &&
            (project.objects[i].type === 'npc' || project.objects[i].type === 'monster')) { obj = project.objects[i]; break; }
      }
      if (obj) {
        obj.pos = [r.pos[0], (obj.pos && typeof obj.pos[1] === 'number') ? obj.pos[1] : 0, r.pos[1]];
        try {
          if (ED.Viewport && ED.Viewport.meshes && ED.Viewport.meshes[obj.id]) {
            ED.Viewport.meshes[obj.id].position.set(obj.pos[0], obj.pos[1], obj.pos[2]);
          } else if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') {
            ED.Viewport.syncObject(obj);
          }
        } catch (e) {}
      }
      /* Đợt 4: nhãn trạng thái AI trên đầu NPC (chỉ trong Play Mode). */
      self._updateAiLabel(npc, st);
    });
  },

  /* ---- Đợt 4: NPC chase/attack có trí nhớ (ED.NpcAi.nextAiState) ----
     Thấy hero trong detectionRadius thì đuổi/đánh như đợt 2; mất dấu thì
     alert (đi tới lastSeenPos) -> search (đi vòng nhỏ quanh đó, tối đa
     npc.searchDuration, mặc định 5s) -> về home + patrol/idle. Thấy lại
     bất cứ lúc nào thì quay về chase/attack. Trả {pos, wpIndex, target,
     state} như edPlayUpdateNpc để _updateNpcs dùng chung phần sau. */
  _updateAggressiveNpc: function (npc, st, dt) {
    var nowMs = this._playTime * 1000;
    var stats = (ED.NpcAi && typeof ED.NpcAi.attackStats === 'function')
      ? ED.NpcAi.attackStats(npc)
      : { atk: 10, def: 0, detectionRadius: 5, attackRadius: 1.5, cooldown: 1.2, speed: 2 };
    var speed = stats.speed;
    var dx = this._heroPos[0] - st.pos[0];
    var dz = this._heroPos[1] - st.pos[1];
    var dist = Math.sqrt(dx * dx + dz * dz);
    var visible = dist <= stats.detectionRadius;
    if (visible) {
      st.lastSeenPos = [this._heroPos[0], this._heroPos[1]];
      st.lastSeenAt = nowMs;
    }
    var lastSeen = st.lastSeenPos || null;
    var dLast = lastSeen
      ? Math.sqrt(Math.pow(st.pos[0] - lastSeen[0], 2) + Math.pow(st.pos[1] - lastSeen[1], 2)) : Infinity;
    var dHome = Math.sqrt(Math.pow(st.pos[0] - st.homePos[0], 2) + Math.pow(st.pos[1] - st.homePos[1], 2));
    var ctx = {
      distToTarget: dist, targetVisible: visible,
      timeSinceSeen: (typeof st.lastSeenAt === 'number') ? (nowMs - st.lastSeenAt) / 1000 : Infinity,
      searchElapsed: (st.aiState === 'search' && typeof st.searchStartedAt === 'number')
        ? (nowMs - st.searchStartedAt) / 1000 : 0,
      atLastSeen: dLast <= 0.5,
      atHome: dHome <= 0.5
    };
    var view = {
      ai: npc.ai, aiState: st.aiState || npc.ai,
      lastSeenPos: lastSeen, homePos: st.homePos, patrol: npc.patrol,
      attackRadius: stats.attackRadius, detectionRadius: stats.detectionRadius,
      searchDuration: npc.searchDuration, alertTimeout: npc.alertTimeout
    };
    var res = ED.NpcAi.nextAiState(view, ctx);
    var prev = st.aiState || npc.ai;
    st.aiState = res.state;
    if (res.state === 'search' && prev !== 'search') {
      st.searchStartedAt = nowMs;
      st.searchTarget = null;
    }
    if (res.state === 'chase' || res.state === 'attack') {
      st.returningHome = false;
      st.returnTarget = null;
      st.searchTarget = null;
      if (npc.ai === 'attack') {
        if (!st.nav) st.nav = {};
        var self2 = this;
        var findPathFn = function (from, to) { return self2._navFindPath(from, to); };
        var stepAlongFn = function (path, p, speed2, dt2, idx) { return self2._navStepAlong(path, p, speed2, dt2, idx); };
        var ar = ED.NpcAi.attackStep(npc, st.pos, this._heroPos, dt, st.nav, findPathFn, stepAlongFn, nowMs);
        st.nav = ar.state;
        return { pos: ar.pos, wpIndex: st.wpIndex, target: st.target, state: res.state };
      }
      var c = edPlayUpdateNpc(npc, this._heroPos, st.pos, dt, st.wpIndex, st.target);
      return { pos: c.pos, wpIndex: c.wpIndex, target: c.target, state: res.state };
    }
    if (res.state === 'alert') {
      st.returningHome = false;
      st.returnTarget = null;
      var p = this._aiWalkTo(st, res.moveTo, speed, dt, nowMs);
      this._faceMesh(npc.id, st.pos, res.moveTo);
      return { pos: p, wpIndex: st.wpIndex, target: st.target, state: 'alert' };
    }
    if (res.state === 'search') {
      var sp = this._aiSearchStep(npc, st, dt);
      return { pos: sp, wpIndex: st.wpIndex, target: st.target, state: 'search' };
    }
    /* patrol/idle: hết giờ tìm -> về home trước rồi mới tuần tra/đứng yên. */
    if (res.moveTo) {
      st.returningHome = true;
      st.returnTarget = [Number(res.moveTo[0]) || 0, Number(res.moveTo[1]) || 0];
    }
    if (st.returningHome && st.returnTarget) {
      var hp = this._aiWalkTo(st, st.returnTarget, speed, dt, nowMs);
      this._faceMesh(npc.id, st.pos, st.returnTarget);
      var dh = Math.sqrt(Math.pow(hp[0] - st.returnTarget[0], 2) + Math.pow(hp[1] - st.returnTarget[1], 2));
      if (dh <= 0.5) {
        st.returningHome = false;
        st.returnTarget = null;
        st.wpIndex = 0; /* về waypoint đầu rồi mới tuần tra tiếp */
      }
      return { pos: hp, wpIndex: st.wpIndex, target: st.target, state: res.state };
    }
    if (res.state === 'patrol') {
      /* NPC chase/attack có waypoint: tuần tra lại bằng đúng logic patrol
         (đi chậm speed*0.5, vòng qua các waypoint). */
      var pr = edPlayUpdateNpc(
        { ai: 'patrol', patrol: npc.patrol, speed: speed },
        this._heroPos, st.pos, dt, st.wpIndex, st.target);
      return { pos: pr.pos, wpIndex: pr.wpIndex, target: pr.target, state: 'patrol' };
    }
    return { pos: [st.pos[0], st.pos[1]], wpIndex: st.wpIndex, target: st.target, state: 'idle' };
  },

  /* Đi tới target: ưu tiên đường A* qua ED.Nav (đúng chữ ký
     findPath(x0,z0,x1,z1) / stepAlong(path,pos,speed,dt) -> {pos, path});
     không có Nav hoặc tìm đường lỗi thì đi thẳng. Tính lại đường khi
     đích đổi >0.5 ô hoặc đường cũ >1s. Đường alert/search giữ riêng ở
     st.alertNav (không đụng st.nav của attackStep). */
  _aiWalkTo: function (st, target, speed, dt, nowMs) {
    if (!target) return [st.pos[0], st.pos[1]];
    var tx = Number(target[0]) || 0, tz = Number(target[1]) || 0;
    try {
      if (typeof ED !== 'undefined' && ED.Nav &&
          typeof ED.Nav.findPath === 'function' && typeof ED.Nav.stepAlong === 'function') {
        var nav = st.alertNav || null;
        var need = !nav || !Array.isArray(nav.path) || !nav.path.length ||
          !nav.target || Math.abs(nav.target[0] - tx) + Math.abs(nav.target[1] - tz) > 0.5 ||
          (typeof nowMs === 'number' && typeof nav.lastPathAt === 'number' && nowMs - nav.lastPathAt > 1000);
        if (need) {
          var p = ED.Nav.findPath(st.pos[0], st.pos[1], tx, tz);
          if (Array.isArray(p) && p.length) nav = { path: p, target: [tx, tz], lastPathAt: nowMs };
          else nav = null;
        }
        if (nav && Array.isArray(nav.path) && nav.path.length) {
          var r = ED.Nav.stepAlong(nav.path, st.pos, speed, dt);
          if (r && Array.isArray(r.pos)) {
            nav.path = Array.isArray(r.path) ? r.path : [];
            st.alertNav = nav;
            return [Number(r.pos[0]) || 0, Number(r.pos[1]) || 0];
          }
          nav = null;
        }
        st.alertNav = nav;
      }
    } catch (e) { st.alertNav = null; }
    var s = edPlayStepToward(st.pos, [tx, tz], speed, dt);
    return s.pos;
  },

  /* 1 bước tìm kiếm quanh lastSeenPos: đi vòng nhỏ trong bán kính ~2
     (điểm mới chọn bằng ED.NpcAi.pickWanderTarget, tốc độ chậm
     speed*0.5), tới điểm thì chọn điểm khác; đồng thời xoay mesh về
     hướng đang đi (quay các hướng lúc tìm). */
  _aiSearchStep: function (npc, st, dt) {
    var center = st.lastSeenPos || st.pos;
    var speed = 2;
    try {
      if (ED.NpcAi && typeof ED.NpcAi.attackStats === 'function') speed = ED.NpcAi.attackStats(npc).speed;
    } catch (e) {}
    var radius = 2;
    try {
      if (ED.NpcAi && typeof ED.NpcAi.SEARCH_RADIUS === 'number') radius = ED.NpcAi.SEARCH_RADIUS;
    } catch (e) {}
    if (!st.searchTarget) {
      st.searchTarget = (ED.NpcAi && typeof ED.NpcAi.pickWanderTarget === 'function')
        ? ED.NpcAi.pickWanderTarget(center, radius)
        : [center[0], center[1]];
    }
    var s = edPlayStepToward(st.pos, st.searchTarget, speed * 0.5, dt);
    if (s.arrived) st.searchTarget = null;
    this._faceMesh(npc.id, st.pos, st.searchTarget || center);
    return s.pos;
  },

  /* Xoay mesh NPC về hướng đi (yaw = atan2(dx, dz)); mesh chưa có hoặc
     đang đứng yên thì giữ nguyên. Không crash khi không có Viewport. */
  _faceMesh: function (id, fromPos, toPos) {
    try {
      if (!toPos || !ED.Viewport || !ED.Viewport.meshes || !ED.Viewport.meshes[id]) return;
      var dx = (Number(toPos[0]) || 0) - fromPos[0];
      var dz = (Number(toPos[1]) || 0) - fromPos[1];
      if (Math.sqrt(dx * dx + dz * dz) < 0.05) return;
      ED.Viewport.meshes[id].rotation.y = Math.atan2(dx, dz);
    } catch (e) {}
  },

  /* ---- Đợt 4: nhãn trạng thái AI trên đầu NPC (chỉ trong Play Mode) ----
     Dùng THREE.Sprite + canvas texture (repo chưa có bảng tên/label nào
     sẵn). Tạo 1 sprite/NPC, treo cao 2.2 trên đầu mesh, chỉ vẽ lại
     canvas khi state đổi (text tiếng Việt từ ED.NpcAi.aiStateLabel).
     Thoát Play thì _hideAiLabels() gỡ hết sprite + dispose texture. */
  _updateAiLabel: function (npc, st) {
    if (typeof document === 'undefined' || typeof THREE === 'undefined') return;
    try {
      var scene = null;
      if (ED.Viewport && typeof ED.Viewport.getScene === 'function') scene = ED.Viewport.getScene();
      else if (ED.Viewport && ED.Viewport.scene) scene = ED.Viewport.scene;
      if (!scene) return;
      var label = (ED.NpcAi && typeof ED.NpcAi.aiStateLabel === 'function')
        ? ED.NpcAi.aiStateLabel(st.aiState || npc.ai || 'idle')
        : String(st.aiState || npc.ai || 'idle');
      var rec = this._aiLabels[npc.id];
      if (!rec) {
        var canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        var ctx2d = canvas.getContext('2d');
        if (!ctx2d) return;
        var texture = new THREE.CanvasTexture(canvas);
        var mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        var sprite = new THREE.Sprite(mat);
        sprite.scale.set(2.4, 0.6, 1);
        sprite.renderOrder = 999;
        sprite.userData.isAiLabel = true;
        scene.add(sprite);
        rec = { sprite: sprite, canvas: canvas, ctx2d: ctx2d, texture: texture, state: null };
        this._aiLabels[npc.id] = rec;
      }
      var mesh = (ED.Viewport && ED.Viewport.meshes && ED.Viewport.meshes[npc.id]) || null;
      var mx = st.pos[0], my = 0, mz = st.pos[1];
      if (mesh && mesh.position) { mx = mesh.position.x; my = mesh.position.y; mz = mesh.position.z; }
      rec.sprite.position.set(mx, my + 2.2, mz);
      if (rec.state !== label) {
        rec.state = label;
        var c = rec.ctx2d;
        c.clearRect(0, 0, 256, 64);
        c.fillStyle = 'rgba(15, 23, 42, 0.82)';
        c.fillRect(8, 8, 240, 48);
        c.fillStyle = '#ffffff';
        c.font = 'bold 28px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(label, 128, 34);
        rec.texture.needsUpdate = true;
      }
    } catch (e) {}
  },

  _hideAiLabels: function () {
    var self = this;
    Object.keys(this._aiLabels || {}).forEach(function (id) {
      var rec = self._aiLabels[id];
      if (!rec) return;
      try {
        if (rec.sprite && rec.sprite.parent) rec.sprite.parent.remove(rec.sprite);
        if (rec.sprite && rec.sprite.material) {
          if (rec.sprite.material.map && rec.sprite.material.map.dispose) rec.sprite.material.map.dispose();
          if (rec.sprite.material.dispose) rec.sprite.material.dispose();
        }
      } catch (e) {}
    });
    this._aiLabels = {};
  },

  /* ---- Đợt 2: Nav (guard typeof — ED.Nav CHƯA có trong repo) ---- */

  /* Đường đi từ Nav nếu có: ED.Nav.findPath(x0, z0, x1, z1) -> [[x,z],...]
     | null. Không có ED.Nav (hiện tại) thì trả null và quái đuổi thẳng —
     KHÔNG throw, KHÔNG cần Nav để chơi được.
     Đợt 4 — SỬA BUG: ED.Nav.findPath nhận 4 SỐ, không phải 2 mảng [x,z].
     Bản cũ truyền thẳng (from, to) -> Number([x,z]) = NaN nên _worldToGrid
     luôn nhận (0,0), đường A* của quái attack tính sai từ đầu. */
  _navFindPath: function (from, to) {
    try {
      if (typeof ED === 'undefined' || !ED.Nav || typeof ED.Nav.findPath !== 'function') return null;
      var p = ED.Nav.findPath(
        Number(from && from[0]) || 0, Number(from && from[1]) || 0,
        Number(to && to[0]) || 0, Number(to && to[1]) || 0);
      if (!Array.isArray(p)) return null;
      return p;
    } catch (e) { return null; }
  },

  /* 1 bước đi theo đường Nav nếu có: ED.Nav.stepAlong(path, pos, speed,
     dt, index) -> {pos, index} | [x,z] | null. Không có thì trả null
     (edNpcAttackStep tự đuổi theo waypoint thẳng). */
  _navStepAlong: function (path, pos, speed, dt, idx) {
    try {
      if (typeof ED === 'undefined' || !ED.Nav || typeof ED.Nav.stepAlong !== 'function') return null;
      return ED.Nav.stepAlong(path, pos, speed, dt, idx);
    } catch (e) { return null; }
  },

  /* Quái ai='attack' (object type 'monster' hoặc npc type Boss/Quái) đã
     vào attackRadius thì đánh hero: damage = max(1, atk_quái - def_hero),
     cooldown riêng mỗi quái (mặc định 1.2s, theo đồng hồ phiên Play nên
     pause là dừng). Hero hết HP thì hồi sinh ở spawn. */
  _updateMonsterAttacks: function () {
    var project = this.project();
    var nowMs = this._playTime * 1000;
    var self = this;
    (project.npcs || []).forEach(function (npc) {
      if (!npc || !npc.id || npc.ai !== 'attack') return;
      var obj = null;
      for (var i = 0; i < project.objects.length; i++) {
        if (project.objects[i] && project.objects[i].id === npc.id) { obj = project.objects[i]; break; }
      }
      var isMonster = !obj || obj.type === 'monster' || npc.type === 'Boss' || npc.type === 'Quái';
      if (!isMonster) return;
      var st = self._npcState[npc.id];
      var np = st ? st.pos : (Array.isArray(npc.pos) ? [Number(npc.pos[0]) || 0, Number(npc.pos[1]) || 0] : [0, 0]);
      var stats = (ED.NpcAi && typeof ED.NpcAi.attackStats === 'function')
        ? ED.NpcAi.attackStats(npc)
        : { atk: (Number(npc.atk) > 0 ? Number(npc.atk) : 10), def: 0, attackRadius: (Number(npc.attackRadius) > 0 ? Number(npc.attackRadius) : 1.5), cooldown: 1.2 };
      var ar = (Number(stats.attackRadius) > 0) ? Number(stats.attackRadius) : 1.5;
      if (!edPlayInRange(self._heroPos, np, ar)) return;
      if (!st) {
        st = { wpIndex: 0, target: null, pos: np, lastAttackAt: null };
        self._npcState[npc.id] = st;
      }
      /* def truyền vào là giáp HERO (damage = atk_quái - def_hero). */
      var r = edPlayMonsterAttack(
        { atk: stats.atk, def: self._heroDef }, self._heroHp, nowMs,
        (st.lastAttackAt === undefined ? null : st.lastAttackAt), stats.cooldown);
      if (!r.attacked) return;
      st.lastAttackAt = r.lastAttackAt;
      self._heroHp = r.heroHp;
      self._flashMesh(self._heroId, 0xff2222);
      self.log('💢 "' + (npc.name || npc.id) + '" đánh bạn -' + r.damage + ' HP (còn ' + r.heroHp + '/' + self._heroMaxHp + ').');
      if (r.heroHp <= 0) {
        self._respawnHero();
      } else if (r.heroHp <= 30) {
        self.toast('💢 "' + (npc.name || 'Quái') + '" đánh bạn -' + r.damage + ' HP! Còn ' + r.heroHp + '/' + self._heroMaxHp + '.');
      }
    });
  },

  /* Hero chết: hồi sinh ở điểm spawn (-0.2, 0.4) với đầy HP. */
  _respawnHero: function () {
    this._heroHp = this._heroMaxHp;
    this._heroPos = [ED_PLAY_SPAWN[0], ED_PLAY_SPAWN[1]];
    this._moveTarget = null;
    /* Đợt 3: hồi sinh thì vận tốc dọc về 0, đứng trên mặt đất tại spawn. */
    this._heroVy = 0;
    this._heroGrounded = true;
    if (this._physOn()) this._heroY = this._groundHeightAt(ED_PLAY_SPAWN[0], ED_PLAY_SPAWN[1], 0);
    this._applyHeroPos();
    this.toast('💫 Bạn đã hồi sinh tại điểm spawn với đầy HP.');
    this.log('💫 Hero hồi sinh tại spawn (' + ED_PLAY_SPAWN[0] + ', ' + ED_PLAY_SPAWN[1] + '), HP đầy.');
  },

  /* Chớp màu mesh 150ms (đỏ khi hero bị đánh, vàng khi quái bị đánh).
     Chưa có animation tấn công riêng (ED.Animation chưa có) nên chỉ chớp
     màu — mesh/material không có emissive thì bỏ qua, không crash. */
  _flashMesh: function (id, hex) {
    try {
      if (!ED.Viewport || !ED.Viewport.meshes || !ED.Viewport.meshes[id]) return;
      var mesh = ED.Viewport.meshes[id];
      var mats = [];
      mesh.traverse(function (o) {
        if (o.material && o.material.emissive && o.material.emissive.setHex) {
          mats.push(o.material);
          o.material.emissive.setHex(hex || 0xffcc00);
        }
      });
      if (!mats.length) return;
      setTimeout(function () {
        for (var i = 0; i < mats.length; i++) {
          try { mats[i].emissive.setHex(0x000000); } catch (e) {}
        }
      }, 150);
    } catch (e) {}
  },

  /* Tạo FX tại (x, z): ưu tiên ED.Fx.buildFx + scene thật (không thêm
     object vào project), không có thì fallback ED.Fx.addFx(fxType, x, z).
     FX tự gỡ sau 2.5s. Không có ED.Fx thì bỏ qua. */
  _spawnFx: function (fxType, x, z) {
    try {
      if (ED.Fx && typeof ED.Fx.buildFx === 'function' && typeof ED.Fx.findScene === 'function') {
        var scene = ED.Fx.findScene();
        if (scene) {
          var g = ED.Fx.buildFx(fxType, {});
          g.position.set(x, 0, z);
          scene.add(g);
          var id = 'play-fx-' + (++this._fxCounter);
          if (typeof ED.Fx.register === 'function') ED.Fx.register(id, g);
          setTimeout(function () {
            try {
              if (g.parent) g.parent.remove(g);
              if (ED.Fx && typeof ED.Fx.unregister === 'function') ED.Fx.unregister(id);
            } catch (e) {}
          }, 2500);
          return true;
        }
      }
      if (ED.Fx && typeof ED.Fx.addFx === 'function') {
        ED.Fx.addFx(fxType, x, z);
        return true;
      }
    } catch (e) {}
    return false;
  },

  /* ---- Đợt 2: Skill ---- */

  _isMonsterObject: function (o, project) {
    if (!o || !o.pos) return false;
    if (o.type === 'monster') return true;
    if (o.type === 'npc') {
      for (var i = 0; i < (project.npcs || []).length; i++) {
        var npc = project.npcs[i];
        if (npc && npc.id === o.id && (npc.type === 'Boss' || npc.type === 'Quái')) return true;
      }
    }
    return false;
  },

  _findMonsterObject: function (id) {
    var project = this.project();
    for (var i = 0; i < project.objects.length; i++) {
      if (project.objects[i] && project.objects[i].id === id) return project.objects[i];
    }
    return null;
  },

  /* Danh sách quái cho skill: [{id, pos:[x,z], hp}]. */
  _skillMonsters: function () {
    var project = this.project();
    var list = [];
    var self = this;
    (project.objects || []).forEach(function (o) {
      if (!self._isMonsterObject(o, project)) return;
      var hp = 30;
      if (o.extra && Number(o.extra.hp) > 0) hp = Number(o.extra.hp);
      else {
        for (var i = 0; i < (project.npcs || []).length; i++) {
          var npc = project.npcs[i];
          if (npc && npc.id === o.id && Number(npc.hp) > 0) { hp = Number(npc.hp); break; }
        }
      }
      list.push({ id: o.id, pos: [Number(o.pos[0]) || 0, Number(o.pos[2]) || 0], hp: hp });
    });
    return list;
  },

  /* Thi triển skill thứ idx (nút skill hoặc phím 1-4). Đang cooldown thì
     toast thời gian còn lại, không thi triển, không tạo FX. Không có
     quái trong tầm thì toast, KHÔNG tính cooldown. */
  castSkill: function (idx) {
    if (!this._playing || this._paused) return false;
    var skills = this._skills || [];
    var skill = skills[idx];
    if (!skill) return false;
    var nowMs = this._playTime * 1000;
    var last = (this._skillLastUsed && this._skillLastUsed[idx] != null) ? this._skillLastUsed[idx] : null;
    var r = edPlaySkillReady(last, skill.cooldown, nowMs);
    if (!r.ready) {
      this.toast('⏳ "' + skill.name + '" còn ' + r.remain + 's hồi chiêu.');
      return false;
    }
    var res = edPlaySkillApply(skill, [this._heroPos[0], this._heroPos[1]], this._heroHp, this._heroMaxHp, this._skillMonsters());
    if (!res.applied) {
      this.toast('Không có quái nào trong tầm ' + (skill.range || 6) + ' ô để dùng "' + skill.name + '".');
      return false;
    }
    this._skillLastUsed[idx] = nowMs;
    if (res.fx) this._spawnFx(res.fx.fxType, res.fx.x, res.fx.z);
    if (res.healed > 0) {
      this._heroHp = res.heroHp;
      this.toast('💚 "' + skill.name + '" hồi +' + res.healed + ' HP (' + res.heroHp + '/' + this._heroMaxHp + ').');
      this.log('💚 Skill "' + skill.name + '" hồi +' + res.healed + ' HP.');
    }
    var self = this;
    res.hits.forEach(function (h) {
      var target = self._findMonsterObject(h.id);
      if (!target) return;
      if (!target.extra) target.extra = {};
      target.extra.hp = h.hp;
      self._flashMesh(target.id, 0xffcc00);
      self.log('✨ "' + skill.name + '" đánh "' + (target.name || target.id) + '" -' + h.damage + ' HP (còn ' + h.hp + ').');
      if (h.dead) self._killMonster(target);
      else self.toast('✨ ' + skill.name + ' -' + h.damage + ' HP (còn ' + h.hp + ').');
    });
    this._refreshHud(true);
    return true;
  },

  /* Trừ HP quái (dùng chung cho đánh thường + skill): chết thì gọi
     _killMonster. Trả {hp, dead}. */
  _damageMonster: function (target, dmg) {
    var hp = (target.extra && Number(target.extra.hp) > 0) ? Number(target.extra.hp) : 30;
    var r = edPlayApplyDamage(hp, dmg);
    if (!target.extra) target.extra = {};
    target.extra.hp = r.hp;
    this._flashMesh(target.id, 0xffcc00);
    if (r.dead) {
      this._killMonster(target);
      return { hp: 0, dead: true };
    }
    return { hp: r.hp, dead: false };
  },

  /* ---- Đợt 2: Quest (chỉ trong phiên Play) ---- */

  _initQuests: function () {
    var project = this.project();
    this._questsNorm = [];
    this._questState = {};
    var self = this;
    (project.quests || []).forEach(function (q) {
      if (!q || !q.id) return;
      var nq = edPlayNormalizeQuest(q);
      if (!nq) return;
      self._questsNorm.push(nq);
      self._questState[nq.id] = { progress: 0, completed: false };
    });
  },

  /* 1 sự kiện trong Play: kill/talk/collect -> cộng tiến độ quest, đủ
     count thì hoàn thành + thưởng vàng/bạc (cộng vào bộ đếm phiên Play).
     Không sửa project gốc. */
  _onQuestEvent: function (ev) {
    if (!ev || !(this._questsNorm || []).length) return;
    var self = this;
    var changed = false;
    this._questsNorm.forEach(function (nq) {
      var st = self._questState[nq.id];
      if (!st || st.completed) return;
      var r = edPlayQuestProgress(st, nq.target, ev);
      if (r.progress !== st.progress || r.completed) {
        st.progress = r.progress;
        st.completed = r.completed;
        changed = true;
        if (r.justCompleted) {
          var rw = edPlayQuestReward(nq.raw);
          self._gold += rw.gold;
          self._silver += rw.silver;
          var msg = '🎉 Hoàn thành nhiệm vụ "' + nq.name + '"! +' + rw.gold + ' vàng' +
            (rw.silver ? ' +' + rw.silver + ' bạc' : '') + (rw.item ? ' + ' + rw.item : '') + '.';
          self.toast(msg);
          self.log(msg);
        }
      }
    });
    if (changed) {
      this._refreshQuestBox();
      this._refreshHud(true);
    }
  },

  /* Tên vật phẩm mà quest collect đang cần (vật rơi từ quái sẽ mang tên
     này để nhặt đúng quest); không có quest collect thì null. */
  _collectItemName: function () {
    var self = this;
    var name = null;
    (this._questsNorm || []).forEach(function (nq) {
      if (name) return;
      var st = self._questState[nq.id];
      if (!st || st.completed) return;
      if (nq.target.type === 'collect') name = nq.target.item || 'Linh thạch';
    });
    return name;
  },

  /* ---- Đợt 2: Vật rơi ---- */

  /* Quái chết rơi 1 vật phẩm tại chỗ (tên theo quest collect, không có
     thì 'Linh thạch'). Vật rơi chỉ sống trong phiên Play (state + mesh
     tạm, KHÔNG thêm object vào project nên không chặn đường hero).
     Toast ghi rõ toạ độ để người chơi tìm được khi không thấy mesh. */
  _spawnDrop: function (x, z, item) {
    var id = 'drop-' + (++this._dropCounter);
    var drop = { id: id, x: Number(x) || 0, z: Number(z) || 0, item: item || 'Linh thạch' };
    this._drops.push(drop);
    try {
      if (typeof THREE !== 'undefined' && ED.Fx && typeof ED.Fx.findScene === 'function') {
        var scene = ED.Fx.findScene();
        if (scene) {
          var mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.4, 0.4),
            new THREE.MeshBasicMaterial({ color: 0xfacc15 })
          );
          mesh.position.set(drop.x, 0.3, drop.z);
          scene.add(mesh);
          this._dropMeshes[id] = mesh;
        }
      }
    } catch (e) {}
    this.log('📦 Rơi "' + drop.item + '" tại (' + drop.x.toFixed(1) + ', ' + drop.z.toFixed(1) + ') — đi qua để nhặt.');
    return drop;
  },

  _removeDropMesh: function (id) {
    var mesh = this._dropMeshes[id];
    if (!mesh) return;
    try {
      if (mesh.parent) mesh.parent.remove(mesh);
      if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose();
      if (mesh.material && mesh.material.dispose) mesh.material.dispose();
    } catch (e) {}
    delete this._dropMeshes[id];
  },

  _clearDrops: function () {
    var self = this;
    Object.keys(this._dropMeshes || {}).forEach(function (id) { self._removeDropMesh(id); });
    this._dropMeshes = {};
  },

  /* Hero đi qua vật rơi (<=1.2 ô) thì nhặt: +1 collect cho quest khớp. */
  _updateDrops: function () {
    if (!(this._drops || []).length) return;
    for (var i = this._drops.length - 1; i >= 0; i--) {
      var d = this._drops[i];
      if (!edPlayInRange(this._heroPos, [d.x, d.z], 1.2)) continue;
      this._drops.splice(i, 1);
      this._removeDropMesh(d.id);
      this._onQuestEvent({ kind: 'collect', item: d.item });
      this.toast('📦 Nhặt được "' + d.item + '".');
      this.log('📦 Nhặt "' + d.item + '" tại (' + d.x.toFixed(1) + ', ' + d.z.toFixed(1) + ').');
    }
  },

  /* ---- Đợt 2: HUD (HP/vàng/skill/quest) ---- */

  _refreshHud: function (force) {
    var hpTxt = '❤️ ' + this._heroHp + '/' + this._heroMaxHp;
    var goldTxt = '🪙 ' + (this._gold || 0) + ' vàng' + ((this._silver || 0) ? ' · ' + this._silver + ' bạc' : '');
    var nowMs = this._playTime * 1000;
    var skillTxt = '';
    var self = this;
    (this._skills || []).forEach(function (sk, i) {
      var last = (self._skillLastUsed && self._skillLastUsed[i] != null) ? self._skillLastUsed[i] : null;
      var r = edPlaySkillReady(last, sk.cooldown, nowMs);
      skillTxt += r.ready ? 'R' : ('C' + Math.ceil(r.remain));
    });
    var key = hpTxt + '|' + goldTxt + '|' + skillTxt + '|' + this._physStatusText();
    if (!force && key === this._lastHud) return;
    this._lastHud = key;
    if (this._hpText) this._hpText.textContent = hpTxt;
    if (this._hpFill) {
      var pct = this._heroMaxHp > 0 ? Math.max(0, Math.min(100, this._heroHp / this._heroMaxHp * 100)) : 0;
      this._hpFill.style.width = pct + '%';
      this._hpFill.style.background = pct > 50 ? '#4ade80' : (pct > 25 ? '#facc15' : '#ef4444');
    }
    if (this._goldText) this._goldText.textContent = goldTxt;
    /* Đợt 3: trạng thái vật lý (chạm đất / đang rơi / tắt). */
    if (this._physStatus) this._physStatus.textContent = this._physStatusText();
    this._refreshSkillButtons();
  },

  _refreshSkillButtons: function () {
    var nowMs = this._playTime * 1000;
    var self = this;
    (this._skillBtns || []).forEach(function (b, i) {
      var sk = (self._skills || [])[i];
      if (!sk) { b.style.display = 'none'; return; }
      b.style.display = '';
      var last = (self._skillLastUsed && self._skillLastUsed[i] != null) ? self._skillLastUsed[i] : null;
      var r = edPlaySkillReady(last, sk.cooldown, nowMs);
      b.textContent = sk.name + (r.ready ? '' : ' (' + Math.ceil(r.remain) + 's)');
      b.style.opacity = r.ready ? '1' : '0.55';
    });
  },

  _refreshQuestBox: function () {
    var box = this._questBox;
    if (!box || typeof document === 'undefined') return;
    while (box.firstChild) box.removeChild(box.firstChild);
    var title = document.createElement('div');
    title.className = 'ed-play-quest-title';
    title.textContent = '📜 Nhiệm vụ (chỉ trong phiên Play)';
    box.appendChild(title);
    var self = this;
    (this._questsNorm || []).forEach(function (nq) {
      var st = self._questState[nq.id] || { progress: 0, completed: false };
      var line = document.createElement('div');
      line.className = 'ed-play-quest-line';
      line.textContent = edPlayQuestLabel(nq, st.progress, st.completed);
      box.appendChild(line);
    });
    if (!(this._questsNorm || []).length) {
      var none = document.createElement('div');
      none.className = 'ed-play-quest-line';
      none.textContent = 'Chưa có nhiệm vụ nào.';
      box.appendChild(none);
    }
    var note = document.createElement('div');
    note.className = 'ed-play-quest-note';
    note.textContent = 'Dừng Play là mất tiến độ.';
    box.appendChild(note);
  },

  _followCamera: function () {
    try {
      if (ED.Viewport && typeof ED.Viewport.followHero === 'function') {
        ED.Viewport.followHero(this._heroPos[0], this._heroPos[1]);
        return;
      }
      /* Nhóm A: focus(id) dời camera target tới object + áp camera — gọi
         mỗi frame chính là camera follow nhân vật. */
      if (ED.Viewport && typeof ED.Viewport.focus === 'function' && this._heroId) {
        ED.Viewport.focus(this._heroId);
        return;
      }
      if (ED.Viewport && ED.Viewport.camera && typeof THREE !== 'undefined') {
        var cam = ED.Viewport.camera;
        var tx = this._heroPos[0], tz = this._heroPos[1];
        cam.position.set(tx + 4, 6, tz + 6);
        if (cam.lookAt) cam.lookAt(tx, 0, tz);
      }
    } catch (e) {}
  },

  /* NPC trong bán kính tương tác -> hiện hộp thoại (1 câu đầu).
     NPC vừa nói chuyện xong thì không mở lại ngay — chỉ mở lại khi hero
     đã rời khỏi tầm rồi quay lại (tránh hộp thoại bật liên tục). */
  _checkInteract: function () {
    if (this._dialogue) return;
    var project = this.project();
    for (var i = 0; i < (project.npcs || []).length; i++) {
      var npc = project.npcs[i];
      if (!npc || !npc.id) continue;
      var st = this._npcState[npc.id];
      var np = st ? st.pos : npc.pos;
      var radius = (Number(npc.interactRadius) > 0) ? Number(npc.interactRadius) : 2;
      var near = edPlayInRange(this._heroPos, [Number(np[0]) || 0, Number(np[1]) || 0], radius);
      if (!near) { delete this._talkedTo[npc.id]; continue; }
      if (this._talkedTo[npc.id]) continue;
      this._showDialogue(npc);
      return;
    }
  },

  _showDialogue: function (npc) {
    var lines = Array.isArray(npc.dialogue) && npc.dialogue.length ? npc.dialogue : ['...'];
    this._dialogue = { npcId: npc.id, name: npc.name || 'NPC', lines: lines, idx: 0 };
    /* Đợt 2: nói chuyện NPC -> tính tiến độ quest talk. */
    this._onQuestEvent({ kind: 'talk', npcId: npc.id, npcName: npc.name || '' });
    this._renderDialogue();
  },

  _renderDialogue: function () {
    var box = this._dlgBox;
    if (!box || typeof document === 'undefined') return;
    var d = this._dialogue;
    if (!d) { box.style.display = 'none'; return; }
    var step = edPlayDialogueNext(d.lines, d.idx);
    var self = this;
    while (box.firstChild) box.removeChild(box.firstChild);
    var nameEl = document.createElement('div');
    nameEl.className = 'ed-play-dlg-name';
    nameEl.textContent = d.name;
    box.appendChild(nameEl);
    var lineEl = document.createElement('div');
    lineEl.className = 'ed-play-dlg-line';
    lineEl.textContent = step.line || '...';
    box.appendChild(lineEl);
    var row = document.createElement('div');
    row.className = 'ed-row';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'ed-btn';
    closeBtn.style.minHeight = '40px';
    closeBtn.textContent = 'Đóng';
    closeBtn.addEventListener('click', function () { self._hideDialogue(); });
    row.appendChild(closeBtn);
    if (step.next >= 0) {
      var nextBtn = document.createElement('button');
      nextBtn.className = 'ed-btn';
      nextBtn.style.minHeight = '40px';
      nextBtn.textContent = 'Tiếp theo ▸';
      nextBtn.addEventListener('click', function () {
        self._dialogue.idx = step.next;
        self._renderDialogue();
      });
      row.appendChild(nextBtn);
    }
    box.appendChild(row);
    box.style.display = 'block';
  },

  _hideDialogue: function () {
    if (this._dialogue && this._dialogue.npcId) this._talkedTo[this._dialogue.npcId] = true;
    this._dialogue = null;
    if (this._dlgBox) this._dlgBox.style.display = 'none';
  },

  /* Quái trong tầm maxDist ô (mặc định 2) -> quái gần nhất. */
  _nearestMonster: function (maxDist) {
    var maxD = (Number(maxDist) > 0) ? Number(maxDist) : 2;
    var project = this.project();
    var best = null, bestD = maxD;
    var self = this;
    (project.objects || []).forEach(function (o) {
      if (!self._isMonsterObject(o, project)) return;
      var d = Math.sqrt(Math.pow((Number(o.pos[0]) || 0) - self._heroPos[0], 2) + Math.pow((Number(o.pos[2]) || 0) - self._heroPos[1], 2));
      if (d <= maxD && d <= bestD) { best = o; bestD = d; }
    });
    return best;
  },

  _checkMonsterNear: function () {
    if (!this._attackBtn) return;
    this._attackBtn.style.display = this._nearestMonster() ? 'inline-block' : 'none';
  },

  /* Đánh quái gần nhất: trừ HP theo atk/def; chết thì biến mất + rơi
     vàng/vật phẩm + tính quest (xem _killMonster). */
  attack: function () {
    if (!this._playing || this._paused) return false;
    var target = this._nearestMonster();
    if (!target) { this.toast('Không có quái nào trong tầm 2 ô.'); return false; }
    var project = this.project();
    var atk = this._heroAtk || 10;
    var hero = null;
    for (var i = 0; i < project.objects.length; i++) {
      if (project.objects[i] && project.objects[i].id === this._heroId) { hero = project.objects[i]; break; }
    }
    if (hero && hero.extra && hero.extra.charId) {
      for (var j = 0; j < project.characters.length; j++) {
        var c = project.characters[j];
        if (c && c.id === hero.extra.charId) { atk = Number(c.atk) || 10; break; }
      }
    }
    var def = (target.extra && Number(target.extra.def) > 0) ? Number(target.extra.def) : 0;
    var dmg = edPlayDamageCalc(atk, def);
    var r = this._damageMonster(target, dmg);
    if (r.dead) return true;
    this.log('⚔️ Đánh "' + (target.name || target.id) + '" -' + dmg + ' HP (còn ' + r.hp + ').');
    this.toast('⚔️ Đánh ' + (target.name || 'quái') + ' -' + dmg + ' HP (còn ' + r.hp + ').');
    return true;
  },

  _killMonster: function (target) {
    var project = this.project();
    /* Thông tin quái (cho quest + vàng rơi) — lấy TRƯỚC khi xoá. */
    var npcEntry = null;
    for (var k = 0; k < (project.npcs || []).length; k++) {
      if (project.npcs[k] && project.npcs[k].id === target.id) { npcEntry = project.npcs[k]; break; }
    }
    var level = 1;
    if (npcEntry && Number(npcEntry.level) > 0) level = Number(npcEntry.level);
    else if (target.extra && Number(target.extra.level) > 0) level = Number(target.extra.level);
    var info = {
      name: target.name || target.id,
      type: (npcEntry && npcEntry.type) || '',
      npcType: (npcEntry && npcEntry.type) || '',
      monsterType: (target.extra && target.extra.monsterType) || (npcEntry && npcEntry.monsterType) || ''
    };
    var mx = (target.pos && Number(target.pos[0])) || 0;
    var mz = (target.pos && Number(target.pos[2])) || 0;
    var removed = false;
    try {
      if (ED.Core && typeof ED.Core.removeObject === 'function') removed = ED.Core.removeObject(target.id);
    } catch (e) { removed = false; }
    if (!removed) {
      var idx = -1;
      for (var i = 0; i < project.objects.length; i++) {
        if (project.objects[i] && project.objects[i].id === target.id) { idx = i; break; }
      }
      if (idx >= 0) project.objects.splice(idx, 1);
    }
    try {
      if (ED.Viewport && typeof ED.Viewport.removeMesh === 'function') ED.Viewport.removeMesh(target.id);
    } catch (e) {}
    /* Đợt 2: xoá cả entry NPC + trạng thái AI — quái chết không được
       đuổi/đánh tiếp (snapshot lúc Stop vẫn khôi phục lại đầy đủ). */
    if (npcEntry) {
      var ni = project.npcs.indexOf(npcEntry);
      if (ni >= 0) project.npcs.splice(ni, 1);
    }
    delete this._npcState[target.id];
    /* Đợt 2: rơi vàng ngay (cộng vào bộ đếm phiên Play) + rơi 1 vật phẩm
       trên đất (đi qua là nhặt, tính quest collect). */
    var gold = edPlayGoldDrop({ level: level });
    this._gold += gold;
    var dropItem = this._collectItemName() || 'Linh thạch';
    this._spawnDrop(mx, mz, dropItem);
    this.log('💀 "' + (target.name || target.id) + '" đã chết và biến mất.');
    this.toast('💀 Đã hạ "' + (target.name || 'quái') + '"! +' + gold + ' vàng. Rơi "' + dropItem + '" — đi qua để nhặt.');
    /* Đợt 2: quest giết quái đếm tiến độ THẬT (chỉ quái đúng loại). */
    this._onQuestEvent({ kind: 'kill', name: info.name, type: info.type, npcType: info.npcType, monsterType: info.monsterType });
    this._refreshHud(true);
    this._checkMonsterNear();
  },

  /* ---------------- Ẩn/hiện panel edit ---------------- */
  _hideEditPanels: function () {
    if (typeof document === 'undefined') return;
    this._hiddenPanels = [];
    var self = this;
    var sels = ['#ed-panels', '.ed-panel', '#ed-toolbar', '#ed-hierarchy', '#ed-inspector'];
    sels.forEach(function (s) {
      var nodes = null;
      try { nodes = document.querySelectorAll(s); } catch (e) { nodes = null; }
      if (!nodes) return;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n && n.style && n.style.display !== 'none') {
          self._hiddenPanels.push({ el: n, display: n.style.display || '' });
          n.style.display = 'none';
        }
      }
    });
  },

  _showEditPanels: function () {
    this._hiddenPanels.forEach(function (rec) {
      try { rec.el.style.display = rec.display; } catch (e) {}
    });
    this._hiddenPanels = [];
  },

  _showBar: function (show) {
    if (!this._bar) return;
    this._bar.style.display = show ? 'flex' : 'none';
    /* Đợt 2: thanh skill + hộp quest hiện/ẩn cùng thanh Play. */
    if (this._skillBar) this._skillBar.style.display = show ? 'flex' : 'none';
    if (this._questBox) this._questBox.style.display = show ? 'block' : 'none';
    /* Đợt 3: panel Vật lý + nút Nhảy hiện/ẩn cùng thanh Play. */
    if (this._physPanel) this._physPanel.style.display = show ? 'block' : 'none';
    if (show) this._refreshPhysPanel();
    if (show && this._pauseBtn) this._pauseBtn.textContent = this._paused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
    if (show) {
      this._checkMonsterNear();
      this._refreshHud(true);
    }
  },

  /* ---------------- Input (chỉ trong start/stop) ---------------- */
  _bindInput: function () {
    var self = this;
    if (typeof document === 'undefined' && typeof window === 'undefined') return;
    this._boundKeyDown = function (e) {
      if (!self._playing) return;
      if (e.code === 'Space') {
        e.preventDefault();
        /* Đợt 3: vật lý bật thì Space = nhảy (chỉ khi chạm đất, không
           nhảy đôi); vật lý tắt thì Space = đánh như cũ. Đánh bằng
           phím X / nút ⚔️ khi vật lý bật. */
        if (self._physOn()) self._tryJump();
        else self.attack();
        return;
      }
      if (e.code === 'KeyX') { self.attack(); return; }
      /* Đợt 2: phím 1-4 thi triển skill (bản desktop; điện thoại bấm nút). */
      if (e.code === 'Digit1' || e.code === 'Numpad1') { self.castSkill(0); return; }
      if (e.code === 'Digit2' || e.code === 'Numpad2') { self.castSkill(1); return; }
      if (e.code === 'Digit3' || e.code === 'Numpad3') { self.castSkill(2); return; }
      if (e.code === 'Digit4' || e.code === 'Numpad4') { self.castSkill(3); return; }
      self._keys[e.code] = true;
      if (e.code === 'Escape') self.pause();
    };
    this._boundKeyUp = function (e) { self._keys[e.code] = false; };
    this._boundPointer = function (e) {
      if (!self._playing || self._paused) return;
      if (e.target && e.target.closest && (e.target.closest('.ed-play-bar') || e.target.closest('.ed-play-dialogue') || e.target.closest('button'))) return;
      var p = self._raycastGround(e);
      if (p) self._moveTarget = [p[0], p[1]];
    };
    try {
      if (typeof document !== 'undefined') {
        document.addEventListener('keydown', this._boundKeyDown);
        document.addEventListener('keyup', this._boundKeyUp);
      }
      var cv = null;
      if (ED.Viewport && typeof ED.Viewport.getCanvas === 'function') cv = ED.Viewport.getCanvas();
      else if (ED.Viewport && ED.Viewport.renderer && ED.Viewport.renderer.domElement) cv = ED.Viewport.renderer.domElement;
      else if (typeof document !== 'undefined') cv = document.querySelector('#ed-viewport canvas') || document.querySelector('canvas');
      if (cv && cv.addEventListener) cv.addEventListener('pointerdown', this._boundPointer);
      this._playCanvas = cv;
    } catch (e) {}
  },

  _unbindInput: function () {
    try {
      if (typeof document !== 'undefined') {
        if (this._boundKeyDown) document.removeEventListener('keydown', this._boundKeyDown);
        if (this._boundKeyUp) document.removeEventListener('keyup', this._boundKeyUp);
      }
      if (this._playCanvas && this._boundPointer && this._playCanvas.removeEventListener) {
        this._playCanvas.removeEventListener('pointerdown', this._boundPointer);
      }
    } catch (e) {}
    this._boundKeyDown = null;
    this._boundKeyUp = null;
    this._boundPointer = null;
    this._playCanvas = null;
    this._keys = {};
  },

  /* Click xuống đất -> [x,z]: ưu tiên ED.Viewport.raycastGround (nhóm A),
     không có thì Raycaster với terrain mesh — đợt 4 ED.Viewport đã có
     getter getTerrainMesh() thật (delegate ED.Terrain.getMesh(), guard
     typeof giữ nguyên) nên nhánh này chạy được, không có nữa thì trả
     null (chỉ WASD vẫn chạy). */
  _raycastGround: function (e) {
    try {
      if (ED.Viewport && typeof ED.Viewport.raycastGround === 'function') {
        var p = ED.Viewport.raycastGround(e.clientX, e.clientY);
        if (p && isFinite(p[0]) && isFinite(p[1])) return [Number(p[0]), Number(p[1])];
        return null;
      }
      if (typeof THREE === 'undefined' || !ED.Viewport || !ED.Viewport.camera) return null;
      var mesh = null;
      if (typeof ED.Viewport.getTerrainMesh === 'function') mesh = ED.Viewport.getTerrainMesh();
      else if (ED.Viewport.terrainMesh) mesh = ED.Viewport.terrainMesh;
      if (!mesh) return null;
      var rect = { left: 0, top: 0, width: 1, height: 1 };
      var cv = this._playCanvas;
      if (cv && cv.getBoundingClientRect) rect = cv.getBoundingClientRect();
      var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      var ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      var rc = new THREE.Raycaster();
      rc.setFromCamera({ x: nx, y: ny }, ED.Viewport.camera);
      var hits = rc.intersectObject(mesh, true);
      if (hits && hits.length) return [hits[0].point.x, hits[0].point.z];
      return null;
    } catch (err) { return null; }
  },

  /* ---------------- Đợt 3: physics-lite (ED.Physics, 17-physics.js) ----
     Mọi tính toán nằm trong ED.Physics (hàm thuần, test bằng vm); ở đây
     chỉ là wiring: đọc state Play, gọi hàm thuần, ghi kết quả về object
     project + đồng bộ mesh. Tất cả đều guard typeof ED.Physics — file
     17-physics.js chưa nối vào build thì chơi như cũ, không crash. */

  /* Module vật lý đã nối vào build chưa? */
  _physAvailable: function () {
    try {
      return (typeof ED !== 'undefined' && ED.Physics && typeof ED.Physics.moveCapsule === 'function');
    } catch (e) { return false; }
  },

  /* Vật lý đang bật VÀ dùng được? */
  _physOn: function () {
    return !!this._physicsOn && this._physAvailable();
  },

  /* Box rắn hiện tại trong scene (tĩnh + thùng đẩy được). */
  _physBoxes: function () {
    try {
      if (this._physAvailable()) return ED.Physics.boxesFromObjects(this.project().objects);
    } catch (e) {}
    return [];
  },

  /* Mặt đất đỡ tại (x, z) với chân ở y: terrain + nóc box (đứng được
     trên nóc). Không có ED.Physics thì dùng ED.Terrain.heightAt. */
  _groundHeightAt: function (x, z, y, excludeId) {
    var project = this.project();
    var t = project.terrain || {};
    try {
      if (this._physAvailable()) {
        return ED.Physics.groundHeightAt(t.heights, x, z, this._physBoxes(),
          (typeof y === 'number' ? y : 0), t.size, t.segments, excludeId);
      }
      if (ED.Terrain && typeof ED.Terrain.heightAt === 'function') return ED.Terrain.heightAt(x, z);
    } catch (e) {}
    return 0;
  },

  /* Dòng trạng thái vật lý cho panel + HUD: rẻ (chỉ đổi khi grounded
     đổi), không tính toán nặng. */
  _physStatusText: function () {
    if (!this._physAvailable()) return '⚪ Vật lý: chưa nối build';
    if (!this._physicsOn) return '⚪ Vật lý: TẮT';
    return this._heroGrounded ? '🟢 Chạm đất' : '🪂 Đang rơi';
  },

  /* Cập nhật nhãn nút bật/tắt + trạng thái + nút Nhảy (gọi khi vào/ra
     Play và khi bấm nút bật/tắt). Guard document để vm-test không cần DOM. */
  _refreshPhysPanel: function () {
    if (typeof document === 'undefined') return;
    if (this._physToggleBtn) {
      this._physToggleBtn.textContent = 'Vật lý: ' + ((this._physicsOn && this._physAvailable()) ? 'BẬT' : 'TẮT');
    }
    if (this._physStatus) this._physStatus.textContent = this._physStatusText();
    if (this._jumpBtn) this._jumpBtn.style.display = this._physOn() ? '' : 'none';
  },

  /* Bật/tắt vật lý trong Play. Chưa có ED.Physics thì báo rõ là chưa
     nối build và giữ tắt (không crash, không bật giả). Tắt giữa chừng:
     vận tốc dọc về 0, hero đứng yên tại y hiện tại. */
  setPhysics: function (on) {
    var want = !!on;
    if (want && !this._physAvailable()) {
      this._physicsOn = false;
      this.toast('Module vật lý (17-physics.js) chưa nối vào bản build — coordinator sẽ nối sau, hiện chơi như cũ.');
      this.log('Physics-lite: ED.Physics chưa có (17-physics.js chưa nối build) nên không bật được.');
      this._refreshPhysPanel();
      return false;
    }
    this._physicsOn = want;
    if (!want) this._heroVy = 0;
    this.log('Physics-lite: ' + (want ? 'BẬT (trọng lực + nhảy + chặn tường + đẩy thùng + vật rơi).' : 'TẮT (chơi như cũ, Space lại là đánh).'));
    this.toast(want ? '⚙️ Vật lý đơn giản: BẬT.' : '⚙️ Vật lý đơn giản: TẮT.');
    this._refreshPhysPanel();
    return true;
  },

  /* Nhảy 1 lần (Space / nút ⬆ Nhảy). Chỉ khi đang chơi, không pause,
     vật lý bật, và đang chạm đất — đang bay thì không nhảy đôi. */
  _tryJump: function () {
    if (!this._playing || this._paused || !this._physOn()) return false;
    var body = {
      pos: [this._heroPos[0], this._heroY, this._heroPos[1]],
      vel: [0, this._heroVy, 0], grounded: this._heroGrounded,
      radius: ED.Physics.CAPSULE_RADIUS, height: ED.Physics.CAPSULE_HEIGHT
    };
    var res = ED.Physics.jump(body);
    if (res.vel[1] === this._heroVy && res.grounded === this._heroGrounded) return false;
    this._heroVy = res.vel[1];
    this._heroGrounded = res.grounded;
    return true;
  },

  /* Prop đặt trên cao (y > mặt đất) khi vào Play thì rơi; prop nằm dưới
     mặt đất (địa hình nâng sau khi đặt) thì đặt lên mặt đất ngay. Chỉ
     xét type 'prop'/'crate', không xét nhà/NPC/quái (đứng yên theo
     thiết kế). Chạy 1 lần lúc start(). */
  _initFallingProps: function () {
    this._fallingProps = [];
    if (!this._physOn()) return;
    var project = this.project();
    var self = this;
    (project.objects || []).forEach(function (o) {
      if (!o || !o.pos) return;
      if (o.type !== 'prop' && o.type !== 'crate') return;
      if (o.id === self._heroId) return;
      var x = Number(o.pos[0]) || 0, y = Number(o.pos[1]) || 0, z = Number(o.pos[2]) || 0;
      var g = self._groundHeightAt(x, z, y, o.id);
      if (y > g + 0.05) {
        self._fallingProps.push({ id: o.id, velY: 0, resting: false });
      } else if (y < g - 0.05) {
        o.pos = [x, g, z];
        self._syncObjPos(o);
      }
    });
  },

  /* 1 frame vật lý dọc (gọi trong update, cả khi hero đứng yên):
     hero chịu trọng lực (rơi/chạm đất/đứng trên nóc box), thùng đang
     trượt thì ma sát làm chậm dần rồi dừng, prop trên cao rơi xuống
     đất. Vị trí đổi thật trong project object + mesh (snapshot lúc
     Stop khôi phục lại). */
  _updatePhysicsVertical: function (dt) {
    if (!this._physOn()) return;
    var project = this.project();
    var t = project.terrain || {};
    var boxes = this._physBoxes();
    var env = { gravity: ED.Physics.GRAVITY, heights: t.heights, boxes: boxes, size: t.size, segments: t.segments };
    /* Hero: trọng lực + chạm đất (terrain hoặc nóc box). */
    var body = {
      pos: [this._heroPos[0], this._heroY, this._heroPos[1]],
      vel: [0, this._heroVy, 0], grounded: this._heroGrounded,
      radius: ED.Physics.CAPSULE_RADIUS, height: ED.Physics.CAPSULE_HEIGHT
    };
    var res = ED.Physics.stepBody(body, dt, env);
    var yChanged = Math.abs(res.pos[1] - this._heroY) > 1e-9;
    this._heroY = res.pos[1];
    this._heroVy = res.vel[1];
    this._heroGrounded = res.grounded;
    if (yChanged) this._applyHeroPos();
    /* Thùng đang trượt (hết lực đẩy): ma sát làm chậm dần rồi dừng. */
    var self = this;
    var statics = [];
    for (var i = 0; i < boxes.length; i++) if (!boxes[i].pushable) statics.push(boxes[i]);
    Object.keys(this._crateVel || {}).forEach(function (id) {
      var st = self._crateVel[id];
      if (!st) return;
      var obj = null;
      for (var k = 0; k < project.objects.length; k++) {
        if (project.objects[k] && project.objects[k].id === id) { obj = project.objects[k]; break; }
      }
      if (!obj) { delete self._crateVel[id]; return; }
      var crate = {
        pos: [Number(obj.pos[0]) || 0, Number(obj.pos[1]) || 0, Number(obj.pos[2]) || 0],
        vel: [st.vel[0], st.vel[1]],
        size: (Array.isArray(obj.scale) ? [obj.scale[0], obj.scale[2]] : [1, 1])
      };
      var r = ED.Physics.pushCrate(crate, null, dt, statics, {});
      st.vel = r.crate.vel;
      if (r.moved) {
        obj.pos = [r.crate.pos[0], r.crate.pos[1], r.crate.pos[2]];
        self._syncObjPos(obj);
      }
      if (r.crate.vel[0] === 0 && r.crate.vel[1] === 0) delete self._crateVel[id];
    });
    /* Vật rơi: prop trên cao rơi xuống đất, chạm đất thì nằm lại. */
    (this._fallingProps || []).forEach(function (fp) {
      if (!fp || fp.resting) return;
      var obj = null;
      for (var k = 0; k < project.objects.length; k++) {
        if (project.objects[k] && project.objects[k].id === fp.id) { obj = project.objects[k]; break; }
      }
      if (!obj) { fp.resting = true; return; }
      var pr = ED.Physics.stepFallingProp(
        { pos: [Number(obj.pos[0]) || 0, Number(obj.pos[1]) || 0, Number(obj.pos[2]) || 0], velY: fp.velY },
        dt, { gravity: env.gravity, heights: env.heights, boxes: env.boxes, size: env.size, segments: env.segments, excludeId: fp.id });
      fp.velY = pr.velY;
      fp.resting = pr.resting;
      if (pr.moved) {
        obj.pos = [pr.pos[0], pr.pos[1], pr.pos[2]];
        self._syncObjPos(obj);
      }
    });
  },

  /* Đồng bộ vị trí 1 object ra mesh (dùng cho thùng/prop bị vật lý dời):
     ưu tiên ED.Viewport.syncObject, không có thì set trực tiếp meshes. */
  _syncObjPos: function (obj) {
    try {
      if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') { ED.Viewport.syncObject(obj); return; }
      if (ED.Viewport && ED.Viewport.meshes && ED.Viewport.meshes[obj.id]) {
        ED.Viewport.meshes[obj.id].position.set(obj.pos[0], obj.pos[1], obj.pos[2]);
      }
    } catch (e) {}
  },

  /* Bật/tắt flag đẩy được cho object đang chọn (nút trong panel Vật lý).
     Chỉ trong phiên Play; Stop khôi phục lại nhờ snapshot (không sửa
     project gốc vĩnh viễn). Object đang chọn lấy từ ED.Core.selectedId. */
  _markPushableSelected: function () {
    if (typeof document === 'undefined') return;
    var id = null;
    try {
      if (ED.Core && ED.Core.selectedId) id = ED.Core.selectedId;
      else if (ED.Core && typeof ED.Core.getSelectedId === 'function') id = ED.Core.getSelectedId();
    } catch (e) {}
    if (!id) {
      this.toast('Chưa chọn object nào — chọn 1 prop/thùng trong Editor trước khi bấm Play.');
      return;
    }
    var project = this.project();
    var obj = null;
    for (var i = 0; i < project.objects.length; i++) {
      if (project.objects[i] && project.objects[i].id === id) { obj = project.objects[i]; break; }
    }
    if (!obj) { this.toast('Không tìm thấy object đang chọn.'); return; }
    if (obj.type === 'character' || obj.type === 'npc' || obj.type === 'monster' ||
        obj.type === 'terrain' || obj.type === 'water' || obj.type === 'fx' ||
        obj.type === 'light' || obj.type === 'waypoint' || obj.type === 'collider') {
      this.toast('Object "' + (obj.name || obj.type) + '" không làm thùng đẩy được.');
      return;
    }
    if (!obj.extra) obj.extra = {};
    obj.extra.pushable = !obj.extra.pushable;
    this.toast(obj.extra.pushable
      ? ('📦 "' + (obj.name || obj.type) + '" giờ đẩy được — đi vào là thùng trượt theo.')
      : ('📦 "' + (obj.name || obj.type) + '" không còn đẩy được.'));
    this.log('Physics-lite: ' + (obj.name || obj.id) + ' pushable=' + !!obj.extra.pushable + ' (chỉ trong phiên Play, Stop là khôi phục).');
  },

  /* Panel Vật lý trong Play Mode (tạo 1 lần trong init, hiện/ẩn cùng
     thanh Play qua _showBar). Tự tạo DOM riêng — KHÔNG sửa 02-ui.js,
     editor.css hay template. */
  _initPhysPanel: function () {
    if (typeof document === 'undefined') return;
    var self = this;
    var p = document.createElement('div');
    p.className = 'ed-play-physics';
    p.style.display = 'none';
    p.style.position = 'fixed';
    p.style.top = '12px';
    p.style.right = '12px';
    p.style.zIndex = '9999';
    p.style.maxWidth = '46vw';
    var title = document.createElement('div');
    title.className = 'ed-play-quest-title';
    title.textContent = '⚙️ Vật lý đơn giản';
    p.appendChild(title);
    var note = document.createElement('div');
    note.className = 'ed-play-quest-line';
    note.textContent = 'Physics-lite — KHÔNG phải rigid-body đầy đủ: chỉ trọng lực + nhảy, chặn tường (capsule-vs-box), đẩy thùng, vật rơi. Không xoay, không mô-men.';
    p.appendChild(note);
    var toggle = document.createElement('button');
    toggle.className = 'ed-btn';
    toggle.style.minHeight = '44px';
    toggle.textContent = 'Vật lý: BẬT';
    toggle.addEventListener('click', function () { self.setPhysics(!self._physicsOn); });
    p.appendChild(toggle);
    this._physToggleBtn = toggle;
    var status = document.createElement('div');
    status.className = 'ed-play-quest-line';
    status.textContent = '🟢 Chạm đất';
    p.appendChild(status);
    this._physStatus = status;
    var markBtn = document.createElement('button');
    markBtn.className = 'ed-btn';
    markBtn.style.minHeight = '44px';
    markBtn.textContent = '📦 Thùng đẩy được: bật/tắt cho object đang chọn';
    markBtn.addEventListener('click', function () { self._markPushableSelected(); });
    p.appendChild(markBtn);
    var hint = document.createElement('div');
    hint.className = 'ed-play-quest-note';
    hint.textContent = 'Nhảy: phím Space / nút ⬆ Nhảy (chỉ khi chạm đất).';
    p.appendChild(hint);
    document.body.appendChild(p);
    this._physPanel = p;
  },

  /* Thanh Play + hộp thoại NPC: tạo 1 lần trong init (DOM). */
  init: function () {
    if (typeof document === 'undefined') return false;
    var self = this;
    var bar = document.createElement('div');
    bar.className = 'ed-play-bar';
    bar.style.display = 'none';
    bar.style.position = 'fixed';
    bar.style.left = '50%';
    bar.style.bottom = '12px';
    bar.style.transform = 'translateX(-50%)';
    bar.style.zIndex = '9999';
    bar.style.gap = '8px';
    function barBtn(label, fn) {
      var b = document.createElement('button');
      b.className = 'ed-btn';
      b.style.minHeight = '44px';
      b.textContent = label;
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    }
    this._pauseBtn = barBtn('⏸ Tạm dừng', function () {
      if (self._paused) self.resume(); else self.pause();
    });
    barBtn('⏹ Dừng (về Editor)', function () { self.stop(); });
    this._attackBtn = barBtn('⚔️ Đánh', function () { self.attack(); });
    this._attackBtn.style.display = 'none';
    /* Đợt 3: nút Nhảy cho điện thoại (Space trên bàn phím). Ẩn/hiện theo
       _refreshPhysPanel (chỉ hiện khi vật lý bật). */
    this._jumpBtn = barBtn('⬆ Nhảy', function () { self._tryJump(); });
    /* Đợt 2: thanh HP + vàng trong thanh Play (cập nhật ở _refreshHud). */
    var hpWrap = document.createElement('div');
    hpWrap.className = 'ed-play-hp-wrap';
    hpWrap.style.width = '110px';
    hpWrap.style.height = '14px';
    hpWrap.style.alignSelf = 'center';
    var hpFill = document.createElement('div');
    hpFill.className = 'ed-play-hp-fill';
    hpFill.style.height = '100%';
    hpFill.style.width = '100%';
    hpFill.style.background = '#4ade80';
    hpWrap.appendChild(hpFill);
    bar.appendChild(hpWrap);
    this._hpFill = hpFill;
    var hpText = document.createElement('span');
    hpText.className = 'ed-play-hp-text';
    hpText.style.alignSelf = 'center';
    hpText.style.whiteSpace = 'nowrap';
    hpText.textContent = '❤️ 100/100';
    bar.appendChild(hpText);
    this._hpText = hpText;
    var goldText = document.createElement('span');
    goldText.className = 'ed-play-gold';
    goldText.style.alignSelf = 'center';
    goldText.style.whiteSpace = 'nowrap';
    goldText.textContent = '🪙 0 vàng';
    bar.appendChild(goldText);
    this._goldText = goldText;
    document.body.appendChild(bar);
    this._bar = bar;

    /* Đợt 2: thanh 4 nút skill (tạo 1 lần, hiện cùng thanh Play).
       Nhãn + đếm ngược cooldown cập nhật ở _refreshSkillButtons. */
    var skillBar = document.createElement('div');
    skillBar.className = 'ed-play-skills';
    skillBar.style.display = 'none';
    skillBar.style.position = 'fixed';
    skillBar.style.left = '50%';
    skillBar.style.bottom = '64px';
    skillBar.style.transform = 'translateX(-50%)';
    skillBar.style.zIndex = '9999';
    skillBar.style.gap = '8px';
    this._skillBtns = [];
    for (var si = 0; si < 4; si++) {
      (function (idx) {
        var sb = document.createElement('button');
        sb.className = 'ed-btn ed-play-skill-btn';
        sb.style.minHeight = '48px';
        sb.style.minWidth = '64px';
        sb.textContent = (ED_PLAY_DEFAULT_SKILLS[idx] || {}).name || ('Skill ' + (idx + 1));
        sb.addEventListener('click', function () { self.castSkill(idx); });
        skillBar.appendChild(sb);
        self._skillBtns.push(sb);
      })(si);
    }
    document.body.appendChild(skillBar);
    this._skillBar = skillBar;

    /* Đợt 2: hộp tiến độ quest (góc trái trên, chỉ trong phiên Play). */
    var qBox = document.createElement('div');
    qBox.className = 'ed-play-quests';
    qBox.style.display = 'none';
    qBox.style.position = 'fixed';
    qBox.style.top = '12px';
    qBox.style.left = '12px';
    qBox.style.zIndex = '9999';
    qBox.style.maxWidth = '46vw';
    document.body.appendChild(qBox);
    this._questBox = qBox;

    var dlg = document.createElement('div');
    dlg.className = 'ed-play-dialogue';
    dlg.style.display = 'none';
    dlg.style.position = 'fixed';
    dlg.style.left = '50%';
    dlg.style.bottom = '150px';
    dlg.style.transform = 'translateX(-50%)';
    dlg.style.zIndex = '9999';
    dlg.style.maxWidth = '92vw';
    document.body.appendChild(dlg);
    this._dlgBox = dlg;

    /* Đợt 3: panel Vật lý (góc phải trên, hiện cùng thanh Play). */
    this._initPhysPanel();
    this._refreshPhysPanel();
    return true;
  }
};
