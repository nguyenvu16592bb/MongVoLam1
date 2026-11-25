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
  _boundKeyDown: null,
  _boundKeyUp: null,
  _boundPointer: null,

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
    this._initQuests();
    this._refreshQuestBox();
    /* Khởi tạo trạng thái NPC (pos hiện tại + waypoint 0). */
    var self = this;
    (project.npcs || []).forEach(function (npc) {
      if (!npc || !npc.id) return;
      self._npcState[npc.id] = {
        wpIndex: 0, target: null,
        pos: (Array.isArray(npc.pos)) ? [Number(npc.pos[0]) || 0, Number(npc.pos[1]) || 0] : [0, 0]
      };
    });
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
    this.log('▶ Play Mode: điều khiển "' + (hero.name || 'Hero') + '" bằng WASD hoặc click xuống đất. Space / nút ⚔️ để đánh quái gần. Skill: bấm 4 nút dưới màn hình hoặc phím 1-4.');
    this.toast('▶ Play Mode — WASD di chuyển, Space để đánh, nút skill / phím 1-4 để dùng kỹ năng.');
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
      pos = this._tryMove(pos);
      this._heroPos = pos;
      this._applyHeroPos();
    }
    /* NPC AI (chỉ trong Play Mode). */
    this._updateNpcs(dt);
    /* Đợt 2: quái đánh lại + nhặt vật rơi + HUD (HP/vàng/skill/quest). */
    this._updateMonsterAttacks();
    this._updateDrops();
    /* Camera follow + kiểm tra NPC gần / quái gần. */
    this._followCamera();
    this._checkInteract();
    this._checkMonsterNear();
    this._refreshHud(false);
  },

  /* Thử đi tới pos mới: chặn bởi collider box / ô nước; trượt theo từng
     trục nếu đi chéo bị chặn (đi được theo x thì đi x, không thì thử z). */
  _tryMove: function (target) {
    var project = this.project();
    var cur = [this._heroPos[0], this._heroPos[1]];
    var half = (project.terrain && Number(project.terrain.size) > 0) ? Number(project.terrain.size) / 2 : 48;
    var t = edPlayClampToBounds(target, half);
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
        o.pos = [this._heroPos[0], (o.pos && typeof o.pos[1] === 'number') ? o.pos[1] : 0, this._heroPos[1]];
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
      var r;
      if (npc.ai === 'attack' && ED.NpcAi && typeof ED.NpcAi.attackStep === 'function') {
        /* Đợt 2: quái attack đuổi theo đường Nav nếu có (guard typeof
           trong _navFindPath/_navStepAlong), không có Nav thì đuổi thẳng. */
        if (!st.nav) st.nav = {};
        var self2 = self;
        var findPathFn = function (from, to) { return self2._navFindPath(from, to); };
        var stepAlongFn = function (path, p, speed, dt2, idx) { return self2._navStepAlong(path, p, speed, dt2, idx); };
        var ar = ED.NpcAi.attackStep(npc, st.pos, self._heroPos, dt, st.nav, findPathFn, stepAlongFn, self._playTime * 1000);
        st.nav = ar.state;
        r = { pos: ar.pos, wpIndex: st.wpIndex, target: st.target };
      } else {
        r = edPlayUpdateNpc(npc, self._heroPos, st.pos, dt, st.wpIndex, st.target);
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
    });
  },

  /* ---- Đợt 2: Nav (guard typeof — ED.Nav CHƯA có trong repo) ---- */

  /* Đường đi từ Nav nếu có: ED.Nav.findPath(from [x,z], to [x,z]) ->
     [[x,z],...] | null. Không có ED.Nav (hiện tại) thì trả null và quái
     đuổi thẳng — KHÔNG throw, KHÔNG cần Nav để chơi được. */
  _navFindPath: function (from, to) {
    try {
      if (typeof ED === 'undefined' || !ED.Nav || typeof ED.Nav.findPath !== 'function') return null;
      var p = ED.Nav.findPath(from, to);
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
    var key = hpTxt + '|' + goldTxt + '|' + skillTxt;
    if (!force && key === this._lastHud) return;
    this._lastHud = key;
    if (this._hpText) this._hpText.textContent = hpTxt;
    if (this._hpFill) {
      var pct = this._heroMaxHp > 0 ? Math.max(0, Math.min(100, this._heroHp / this._heroMaxHp * 100)) : 0;
      this._hpFill.style.width = pct + '%';
      this._hpFill.style.background = pct > 50 ? '#4ade80' : (pct > 25 ? '#facc15' : '#ef4444');
    }
    if (this._goldText) this._goldText.textContent = goldTxt;
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
        self.attack();
        return;
      }
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
     không có thì Raycaster với terrain mesh (nếu lấy được), không có nữa
     thì trả null (chỉ WASD vẫn chạy). */
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
    return true;
  }
};
