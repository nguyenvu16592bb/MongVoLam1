/* ============================================================================
   Map Editor — 17-physics.js (đợt 3: VẬT LÝ ĐƠN GIẢN — physics-lite)
   ED.Physics — trọng lực + nhảy, va chạm capsule-vs-box, thùng đẩy được,
   vật rơi. KHÔNG dùng Rapier hay lib vật lý ngoài (nặng, không offline):
   tự viết, nhẹ, chạy được trên điện thoại.

   ĐÂY LÀ VẬT LÝ ĐƠN GIẢN, KHÔNG PHẢI RIGID-BODY ĐẦY ĐỦ: chỉ có trọng lực
   thẳng đứng + va chạm đẩy ra (positional correction), không có xoay,
   không mô-men/quán tính góc, không ma sát tiếp xúc phức tạp, không
   xếp chồng (stacking) hay khớp nối (joint). Đủ cho Play Mode: nhân vật
   nhảy/rơi/chặn tường/trượt tường, thùng trượt khi đẩy, prop rơi xuống
   đất. UI panel Play Mode ghi rõ điều này.

   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level.
   Mọi hàm tính toán là HÀM THUẦN (nhận state đơn giản, trả state mới,
   không sửa input) để test bằng vm không cần THREE/DOM, như các module
   khác (edNav*, edPlay*). Wiring vào Play Mode nằm ở 09-play.js (guard
   typeof ED.Physics — file này CHƯA nối vào build-editor.mjs, coordinator
   nối sau; chưa nối thì Play chạy như cũ, không crash).

   Quy ước hình học (khớp code sẵn có của repo):
   - Nhân vật là capsule: pos.y = BÀN CHÂN (đáy capsule), bán kính
     ED_PHYSICS_RADIUS (0.35, khớp radius chặn cũ trong 09-play.js),
     chiều cao ED_PHYSICS_HEIGHT (1.8, khớp TARGET_HEIGHT của 03-assets).
   - Box chướng ngại: lấy từ object trong scene — nửa-rộng = |scale|/2
     (cùng quy ước edPlayBlockedByObjects trong 09-play.js và ED.Nav),
     đáy = pos[1], nóc = pos[1] + |scale.y|, xoay rot.y thì lấy AABB gần
     đúng (cùng công thức ED.Nav). Không đo mesh thật.
   - Mặt đất: nội suy song tuyến trên project.terrain.heights (khớp
     04-terrain.js: size 96, segments 64) + mặt trên của box (đứng được
     trên nóc nhà/thùng khi nóc không cao hơn chân quá STEP 0.35).
   ========================================================================== */
var ED = (typeof ED !== 'undefined' && ED) ? ED : {};

/* ---------------- Hằng số ---------------- */
var ED_PHYSICS_GRAVITY = 20;        /* gia tốc rơi (đơn vị/s^2) */
var ED_PHYSICS_JUMP_VELOCITY = 8;   /* vận tốc nhảy (đơn vị/s) -> cao ~1.6 */
var ED_PHYSICS_TERMINAL = 40;       /* vận tốc rơi tối đa (chống rơi xuyên) */
var ED_PHYSICS_RADIUS = 0.35;       /* bán kính capsule nhân vật */
var ED_PHYSICS_HEIGHT = 1.8;        /* chiều cao capsule nhân vật */
var ED_PHYSICS_STEP = 0.35;         /* bước lên được (nóc cao hơn chân <= 0.35) */
var ED_PHYSICS_GROUND_SNAP = 0.12;  /* dung sai bám đất khi đi xuống dốc */
var ED_PHYSICS_CRATE_PUSH_SPEED = 3; /* tốc độ thùng trượt khi đang bị đẩy */
var ED_PHYSICS_CRATE_FRICTION = 8;   /* ma sát làm thùng dừng (đơn vị/s^2) */

/* Type object KHÔNG bao giờ là box chặn (khớp edPlayBlockedByObjects):
   npc/monster/character đi xuyên được (chặn bằng tầm đánh), fx/light/
   waypoint/terrain/water không phải vật rắn. */
var ED_PHYSICS_NON_SOLID_TYPES = ['npc', 'waypoint', 'fx', 'light', 'terrain', 'water', 'monster', 'character'];

function edPhysicsClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ---- Chiều cao mặt đất tại (x, z): nội suy song tuyến trên lưới heights
   (khớp 04-terrain.js heightAtArray). heights rỗng/null -> mặt phẳng 0. ---- */
function edPhysicsHeightAt(heights, x, z, size, segments) {
  if (!heights || !heights.length) return 0;
  var s = (Number(size) > 0) ? Number(size) : 96;
  var n = (Number(segments) > 0) ? Math.round(Number(segments)) : 64;
  if (n <= 0) return 0;
  var side = n + 1;
  var cx = edPhysicsClamp(Number(x) || 0, -s / 2, s / 2);
  var cz = edPhysicsClamp(Number(z) || 0, -s / 2, s / 2);
  var gx = (cx + s / 2) / s * n;
  var gz = (cz + s / 2) / s * n;
  var x0 = edPhysicsClamp(Math.floor(gx), 0, n - 1);
  var z0 = edPhysicsClamp(Math.floor(gz), 0, n - 1);
  var fx = gx - x0, fz = gz - z0;
  var h00 = heights[z0 * side + x0] || 0;
  var h10 = heights[z0 * side + x0 + 1] || 0;
  var h01 = heights[(z0 + 1) * side + x0] || 0;
  var h11 = heights[(z0 + 1) * side + x0 + 1] || 0;
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/* ---- Object có đẩy được không (thùng/crate)? ----
   type 'crate' mặc định đẩy được; type 'prop' (hoặc bất kỳ object rắn
   nào khác) thì cần flag extra.pushable === true (bật bằng nút "Thùng
   đẩy được" trong panel Vật lý của Play Mode, hoặc sửa project JSON). ---- */
function edPhysicsIsPushable(o) {
  if (!o) return false;
  if (o.type === 'crate') return true;
  return !!(o.extra && o.extra.pushable === true);
}

/* ---- Object -> box va chạm (AABB, thuần). ----
   Trả {id, type, pushable, cx, cz, bottom, top, hx, hz} hoặc null khi
   object không phải vật rắn (type trong NON_SOLID, visible === false,
   collider trigger, thiếu pos). bottom = pos[1] (đáy object, khớp cách
   builder dựng từ y=0 đi lên), top = pos[1] + |scale.y|. ---- */
function edPhysicsBoxFromObject(o) {
  if (!o || !Array.isArray(o.pos) || o.pos.length < 3) return null;
  if (o.visible === false) return null;
  var t = o.type || '';
  for (var i = 0; i < ED_PHYSICS_NON_SOLID_TYPES.length; i++) {
    if (t === ED_PHYSICS_NON_SOLID_TYPES[i]) return null;
  }
  if (t === 'collider' && o.extra && o.extra.trigger) return null;
  var sc = (Array.isArray(o.scale) && o.scale.length >= 3) ? o.scale : [1, 1, 1];
  var sx = Math.abs(Number(sc[0]) || 1);
  var sy = Math.abs(Number(sc[1]) || 1);
  var sz = Math.abs(Number(sc[2]) || 1);
  /* Box xoay rot.y: AABB gần đúng (cùng công thức ED.Nav). Collider
     shape 'sphere' cũng xấp xỉ bằng box (ghi rõ: physics-lite). */
  var a = (Array.isArray(o.rot) && isFinite(Number(o.rot[1]))) ? Number(o.rot[1]) : 0;
  var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  var bottom = Number(o.pos[1]) || 0;
  return {
    id: o.id || null, type: t, pushable: edPhysicsIsPushable(o),
    cx: Number(o.pos[0]) || 0, cz: Number(o.pos[2]) || 0,
    bottom: bottom, top: bottom + sy,
    hx: (c * sx + s * sz) / 2, hz: (s * sx + c * sz) / 2
  };
}

/* Tất cả box rắn trong scene (bỏ qua null). Thùng đẩy được giữ flag
   pushable để bên gọi phân biệt xử lý. */
function edPhysicsBoxesFromObjects(objects) {
  var out = [];
  if (!Array.isArray(objects)) return out;
  for (var i = 0; i < objects.length; i++) {
    var b = edPhysicsBoxFromObject(objects[i]);
    if (b) out.push(b);
  }
  return out;
}

/* ---- Mặt đất đỡ tại (x, z): max(terrain, nóc box chứa điểm).
   Chỉ tính nóc box khi nóc không cao hơn chân (y) quá STEP — nhân vật
   đang đứng dưới chân tường cao thì nóc tường KHÔNG thành mặt đất.
   y không truyền (Infinity) thì tính mọi nóc. excludeId: bỏ qua box của
   chính vật đang xét (prop tự rơi không được đứng trên nóc của mình). ---- */
function edPhysicsGroundHeightAt(heights, x, z, boxes, y, size, segments, excludeId) {
  var g = edPhysicsHeightAt(heights, x, z, size, segments);
  var feetY = (typeof y === 'number' && isFinite(y)) ? y : Infinity;
  for (var i = 0; i < (boxes || []).length; i++) {
    var b = boxes[i];
    if (!b) continue;
    if (excludeId != null && b.id === excludeId) continue;
    if (b.top > feetY + ED_PHYSICS_STEP) continue;
    if (x < b.cx - b.hx || x > b.cx + b.hx || z < b.cz - b.hz || z > b.cz + b.hz) continue;
    if (b.top > g) g = b.top;
  }
  return g;
}

/* ---- 1 bước trọng lực cho 1 body (nhân vật).
   body: {pos:[x,y,z] (y = bàn chân), vel:[vx,vy,vz], grounded, radius,
     height}. env: {gravity, heights, boxes, size, segments, excludeId}.
   vy -= g*dt (kẹp vận tốc rơi tối đa), y += vy*dt; chạm mặt đất thì
   y = mặt đất, vy = 0, grounded = true (không lún, không nảy).
   Trả body MỚI (không sửa body truyền vào). ---- */
function edPhysicsStepBody(body, dt, env) {
  var b = body || {};
  var e = env || {};
  var dt2 = (Number(dt) > 0) ? Math.min(0.1, Number(dt)) : 0.016;
  var g = (Number(e.gravity) > 0) ? Number(e.gravity) : ED_PHYSICS_GRAVITY;
  var pos = [Number(b.pos && b.pos[0]) || 0, Number(b.pos && b.pos[1]) || 0, Number(b.pos && b.pos[2]) || 0];
  var vel = [Number(b.vel && b.vel[0]) || 0, Number(b.vel && b.vel[1]) || 0, Number(b.vel && b.vel[2]) || 0];
  vel[1] -= g * dt2;
  if (vel[1] < -ED_PHYSICS_TERMINAL) vel[1] = -ED_PHYSICS_TERMINAL;
  pos[1] += vel[1] * dt2;
  var ground = edPhysicsGroundHeightAt(e.heights, pos[0], pos[2], e.boxes, pos[1], e.size, e.segments, e.excludeId);
  var grounded = false;
  /* Dung sai bám đất: đi xuống dốc thoai thoải thì chân vẫn "dính" đất
     thay vì nhấp nháy grounded/rơi liên tục. */
  if (pos[1] <= ground + ED_PHYSICS_GROUND_SNAP && vel[1] <= 0) {
    pos[1] = ground;
    vel[1] = 0;
    grounded = true;
  }
  return {
    pos: pos, vel: vel, grounded: grounded,
    radius: (Number(b.radius) > 0) ? Number(b.radius) : ED_PHYSICS_RADIUS,
    height: (Number(b.height) > 0) ? Number(b.height) : ED_PHYSICS_HEIGHT
  };
}

/* ---- Nhảy: chỉ khi đang chạm đất (grounded). Đang bay thì trả NGUYÊN
   body truyền vào (không nhảy đôi — caller kiểm tra vel/grounded không
   đổi là biết nhảy không thành). Nhảy thành công: vy = jumpVelocity,
   grounded = false. Trả body mới. ---- */
function edPhysicsJump(body, jumpVelocity) {
  var b = body || {};
  if (!b.grounded) return b;
  var jv = (Number(jumpVelocity) > 0) ? Number(jumpVelocity) : ED_PHYSICS_JUMP_VELOCITY;
  var pos = (Array.isArray(b.pos) ? b.pos.slice() : [0, 0, 0]);
  var vel = (Array.isArray(b.vel) ? b.vel.slice() : [0, 0, 0]);
  vel[1] = jv;
  return {
    pos: pos, vel: vel, grounded: false,
    radius: (Number(b.radius) > 0) ? Number(b.radius) : ED_PHYSICS_RADIUS,
    height: (Number(b.height) > 0) ? Number(b.height) : ED_PHYSICS_HEIGHT
  };
}

/* ---- Capsule tại (x, z), chân ở y, có chạm box không?
   Chạm = chồng lấn theo chiều dọc (chân < nóc box VÀ đầu > đáy box)
   VÀ khoảng cách XZ từ tâm tới hình chữ nhật < bán kính. Box thấp hơn
   chân thì đi qua trên được (đứng/đi trên nóc); box cao quá đầu thì
   không chạm. ---- */
function edPhysicsCapsuleHitsBox(x, z, y, radius, height, box) {
  if (!box) return false;
  var feet = (typeof y === 'number' && isFinite(y)) ? y : 0;
  var h = (Number(height) > 0) ? Number(height) : ED_PHYSICS_HEIGHT;
  if (feet >= box.top || feet + h <= box.bottom) return false;
  var r = (Number(radius) > 0) ? Number(radius) : ED_PHYSICS_RADIUS;
  var cx = Math.max(box.cx - box.hx, Math.min(x, box.cx + box.hx));
  var cz = Math.max(box.cz - box.hz, Math.min(z, box.cz + box.hz));
  var dx = x - cx, dz = z - cz;
  return (dx * dx + dz * dz) < r * r;
}

/* ---- Đẩy capsule ra khỏi mọi box đang xuyên (positional correction).
   Mỗi box: đẩy theo hướng từ điểm gần nhất trên hình chữ nhật tới tâm
   (đúng pháp tuyến mặt hộp); tâm nằm TRONG hộp thì đẩy ra theo trục
   xuyên ít nhất. Lặp tối đa 3 lượt cho góc hộp. Trả {x, z, hit} —
   hit là box chạm đầu tiên (hoặc null). Trượt dọc tường là hệ quả tự
   nhiên: push-out chỉ triệt tiêu thành phần pháp tuyến, thành phần
   tiếp tuyến giữ nguyên. ---- */
function edPhysicsResolveCapsule(x, z, y, radius, height, boxes) {
  var r = (Number(radius) > 0) ? Number(radius) : ED_PHYSICS_RADIUS;
  var h = (Number(height) > 0) ? Number(height) : ED_PHYSICS_HEIGHT;
  var px = (typeof x === 'number' && isFinite(x)) ? x : 0;
  var pz = (typeof z === 'number' && isFinite(z)) ? z : 0;
  var hit = null;
  for (var pass = 0; pass < 3; pass++) {
    var any = false;
    for (var i = 0; i < (boxes || []).length; i++) {
      var b = boxes[i];
      if (!b) continue;
      if (!edPhysicsCapsuleHitsBox(px, pz, y, r, h, b)) continue;
      if (!hit) hit = b;
      var cx = Math.max(b.cx - b.hx, Math.min(px, b.cx + b.hx));
      var cz = Math.max(b.cz - b.hz, Math.min(pz, b.cz + b.hz));
      var dx = px - cx, dz = pz - cz;
      var d2 = dx * dx + dz * dz;
      if (d2 > 1e-12) {
        var d = Math.sqrt(d2);
        var push = (r - d) / d;
        px += dx * push;
        pz += dz * push;
      } else {
        var pl = px - (b.cx - b.hx), pr = (b.cx + b.hx) - px;
        var pb = pz - (b.cz - b.hz), pf = (b.cz + b.hz) - pz;
        var m = Math.min(pl, pr, pb, pf);
        if (m === pl) px = b.cx - b.hx - r;
        else if (m === pr) px = b.cx + b.hx + r;
        else if (m === pb) pz = b.cz - b.hz - r;
        else pz = b.cz + b.hz + r;
      }
      any = true;
    }
    if (!any) break;
  }
  return { x: px, z: pz, hit: hit };
}

/* ---- Di chuyển capsule 1 bước (dx, dz) rồi giải va chạm.
   pos: [x,z] hiện tại; y: chân capsule. Trả {pos:[x,z], hit, blocked}
   — blocked = vị trí sau giải khác vị trí muốn tới (đã bị chặn/trượt).
   Đi thẳng vào tường: dừng trước mặt hộp (tâm cách mặt = bán kính).
   Đi chéo vào tường: trượt dọc tường (x bị chặn, z vẫn tiến).
   Chống xuyên tường (tunneling): bước dài được chẻ thành đoạn nhỏ
   (tối đa 0.3/đoạn, ~bán kính capsule) rồi giải va chạm từng đoạn —
   1 bước nhảy xa không "nhảy qua" tường mỏng được. ---- */
function edPhysicsMoveCapsule(pos, dx, dz, y, radius, height, boxes) {
  var x0 = Number(pos && pos[0]) || 0;
  var z0 = Number(pos && pos[1]) || 0;
  var ddx = Number(dx) || 0, ddz = Number(dz) || 0;
  var dist = Math.sqrt(ddx * ddx + ddz * ddz);
  var steps = Math.min(64, Math.max(1, Math.ceil(dist / 0.3)));
  var sx = ddx / steps, sz = ddz / steps;
  var cx = x0, cz = z0;
  var hit = null;
  var blocked = false;
  for (var i = 0; i < steps; i++) {
    var tx = cx + sx, tz = cz + sz;
    var res = edPhysicsResolveCapsule(tx, tz, y, radius, height, boxes);
    if (res.hit && !hit) hit = res.hit;
    if (Math.abs(res.x - tx) > 1e-9 || Math.abs(res.z - tz) > 1e-9) blocked = true;
    cx = res.x;
    cz = res.z;
  }
  return { pos: [cx, cz], hit: hit, blocked: blocked };
}

/* ---- Đẩy 1 thùng/crate 1 bước.
   crate: {pos:[x,y,z], vel:[vx,vz], size:[sx,sz] (rộng/sâu mặt đất)}.
   dir: [dx,dz] hướng đẩy (hero đang đẩy) hoặc null (không ai đẩy).
   boxes: box TĨNH (không gồm thùng khác — không đẩy dây chuyền).
   opts: {pushSpeed, friction}. y của thùng KHÔNG đổi (thùng nằm trên
   mặt đất; rơi thùng xem stepFallingProp).
   - Đang bị đẩy: vel = dir * pushSpeed.
   - Không bị đẩy: ma sát trừ dần tốc độ tới 0 (trượt rồi dừng).
   - Gặp vật cản: đẩy AABB ra theo trục xuyên ít nhất, vel trục đó = 0.
   Trả {crate:{pos, vel, size}, moved, blocked}. ---- */
function edPhysicsPushCrate(crate, dir, dt, boxes, opts) {
  var c = crate || {};
  var o = opts || {};
  var pushSpeed = (Number(o.pushSpeed) > 0) ? Number(o.pushSpeed) : ED_PHYSICS_CRATE_PUSH_SPEED;
  var friction = (Number(o.friction) >= 0) ? Number(o.friction) : ED_PHYSICS_CRATE_FRICTION;
  var dt2 = (Number(dt) > 0) ? Math.min(0.1, Number(dt)) : 0.016;
  var pos = [Number(c.pos && c.pos[0]) || 0, Number(c.pos && c.pos[1]) || 0, Number(c.pos && c.pos[2]) || 0];
  var vel = [Number(c.vel && c.vel[0]) || 0, Number(c.vel && c.vel[1]) || 0];
  var size = (Array.isArray(c.size) && c.size.length >= 2)
    ? [Math.abs(Number(c.size[0]) || 1), Math.abs(Number(c.size[1]) || 1)] : [1, 1];
  var hx = size[0] / 2, hz = size[1] / 2;
  if (Array.isArray(dir) && (dir[0] !== 0 || dir[1] !== 0)) {
    var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
    vel = [dir[0] / len * pushSpeed, dir[1] / len * pushSpeed];
  } else {
    var sp = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1]);
    if (sp > 0) {
      var ns = sp - friction * dt2;
      if (ns <= 0) vel = [0, 0];
      else vel = [vel[0] / sp * ns, vel[1] / sp * ns];
    }
  }
  var nx = pos[0] + vel[0] * dt2;
  var nz = pos[2] + vel[1] * dt2;
  var blocked = false;
  /* Va chạm AABB-vs-AABB, chỉ xét XZ (giả định lite: thùng và box cản
     đều đứng trên mặt đất). */
  for (var i = 0; i < (boxes || []).length; i++) {
    var b = boxes[i];
    if (!b) continue;
    var ox = Math.min(nx + hx, b.cx + b.hx) - Math.max(nx - hx, b.cx - b.hx);
    var oz = Math.min(nz + hz, b.cz + b.hz) - Math.max(nz - hz, b.cz - b.hz);
    if (ox <= 0 || oz <= 0) continue;
    blocked = true;
    if (ox < oz) {
      nx = (nx < b.cx) ? (b.cx - b.hx - hx) : (b.cx + b.hx + hx);
      vel[0] = 0;
    } else {
      nz = (nz < b.cz) ? (b.cz - b.hz - hz) : (b.cz + b.hz + hz);
      vel[1] = 0;
    }
  }
  var moved = Math.abs(nx - pos[0]) > 1e-9 || Math.abs(nz - pos[2]) > 1e-9;
  return { crate: { pos: [nx, pos[1], nz], vel: vel, size: size }, moved: moved, blocked: blocked };
}

/* ---- 1 bước rơi cho 1 prop.
   prop: {pos:[x,y,z], velY}. env như stepBody (gravity, heights, boxes,
   size, segments, excludeId — excludeId = id của chính prop).
   Rơi với gia tốc trọng lực, chạm mặt đất (terrain hoặc nóc box) thì
   y = mặt đất, velY = 0, resting = true (nằm lại, không xuyên đất).
   Prop đã nằm trên đất: resting = true ngay, không nhúc nhích.
   Prop ở DƯỚI mặt đất (địa hình nâng sau khi đặt): đặt lên mặt đất.
   Trả {pos, velY, resting, moved}. ---- */
function edPhysicsStepFallingProp(prop, dt, env) {
  var p = prop || {};
  var e = env || {};
  var dt2 = (Number(dt) > 0) ? Math.min(0.1, Number(dt)) : 0.016;
  var g = (Number(e.gravity) > 0) ? Number(e.gravity) : ED_PHYSICS_GRAVITY;
  var pos = [Number(p.pos && p.pos[0]) || 0, Number(p.pos && p.pos[1]) || 0, Number(p.pos && p.pos[2]) || 0];
  var vy = Number(p.velY) || 0;
  vy -= g * dt2;
  if (vy < -ED_PHYSICS_TERMINAL) vy = -ED_PHYSICS_TERMINAL;
  var y0 = pos[1];
  pos[1] += vy * dt2;
  var ground = edPhysicsGroundHeightAt(e.heights, pos[0], pos[2], e.boxes, pos[1], e.size, e.segments, e.excludeId);
  var resting = false;
  if (pos[1] <= ground) {
    pos[1] = ground;
    vy = 0;
    resting = true;
  }
  return { pos: pos, velY: vy, resting: resting, moved: Math.abs(pos[1] - y0) > 1e-9 };
}

/* ---------------- Module ED.Physics ---------------- */

ED.Physics = {
  /* Hằng số (harness đợt 3 dùng để test đúng số). */
  GRAVITY: ED_PHYSICS_GRAVITY,
  JUMP_VELOCITY: ED_PHYSICS_JUMP_VELOCITY,
  TERMINAL: ED_PHYSICS_TERMINAL,
  CAPSULE_RADIUS: ED_PHYSICS_RADIUS,
  CAPSULE_HEIGHT: ED_PHYSICS_HEIGHT,
  STEP: ED_PHYSICS_STEP,
  GROUND_SNAP: ED_PHYSICS_GROUND_SNAP,
  CRATE_PUSH_SPEED: ED_PHYSICS_CRATE_PUSH_SPEED,
  CRATE_FRICTION: ED_PHYSICS_CRATE_FRICTION,
  NON_SOLID_TYPES: ED_PHYSICS_NON_SOLID_TYPES,
  /* Hàm thuần — test được bằng vm + stub THREE (không cần DOM/THREE). */
  heightAt: edPhysicsHeightAt,
  isPushable: edPhysicsIsPushable,
  boxFromObject: edPhysicsBoxFromObject,
  boxesFromObjects: edPhysicsBoxesFromObjects,
  groundHeightAt: edPhysicsGroundHeightAt,
  stepBody: edPhysicsStepBody,
  jump: edPhysicsJump,
  capsuleHitsBox: edPhysicsCapsuleHitsBox,
  resolveCapsule: edPhysicsResolveCapsule,
  moveCapsule: edPhysicsMoveCapsule,
  pushCrate: edPhysicsPushCrate,
  stepFallingProp: edPhysicsStepFallingProp
};

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
