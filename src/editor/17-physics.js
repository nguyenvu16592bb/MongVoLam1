/* ============================================================================
   Map Editor — 17-physics.js (đợt 3: VẬT LÝ ĐƠN GIẢN — physics-lite)
   ED.Physics — trọng lực + nhảy, va chạm capsule-vs-box, thùng đẩy được,
   vật rơi. KHÔNG dùng Rapier hay lib vật lý ngoài (nặng, không offline):
   tự viết, nhẹ, chạy được trên điện thoại.

   ĐÂY LÀ VẬT LÝ ĐƠN GIẢN, KHÔNG PHẢI RIGID-BODY ĐẦY ĐỦ: chỉ có trọng lực
   thẳng đứng + va chạm đẩy ra (positional correction), không có mô-men/
   quán tính góc đầy đủ, không ma sát tiếp xúc phức tạp, không khớp nối
   (joint). Đợt 5 thêm 2 thứ ở mức lite: (1) thùng có xoay/quán tính góc
   — đẩy lệch tâm thì vừa trượt vừa xoay (rotY + angVel, ma sát góc làm
   angVel giảm dần về 0), va chạm vẫn là AABB KHÔNG xoay theo rotY;
   (2) chồng thùng đơn giản — crate trên đứng yên trên mặt crate dưới
   (resting contact, y = mặt trên crate dưới), crate dưới bị đẩy đi thì
   crate trên rơi (g = 20); KHÔNG có truyền lực ngang giữa 2 thùng
   (crate trên không bị kéo theo khi crate dưới trượt đi) và KHÔNG có
   xếp chồng nhiều tầng ổn định kiểu rigid-body. Đủ cho Play Mode:
   nhân vật nhảy/rơi/chặn tường/trượt tường, thùng trượt/xoay khi đẩy,
   prop rơi xuống đất. UI panel Play Mode PHẢI ghi rõ điều này — chuỗi
   ED.Physics.LITE_LABEL dưới đây chính là label đó (coordinator nối
   vào panel Play, file này không có init/panel riêng nên không tự vẽ).

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
/* Đợt 5 — xoay/quán tính góc của thùng (lite): ma sát góc trừ dần angVel
   (rad/s^2), angVel kẹp tối đa để thùng không quay tít mất kiểm soát. */
var ED_PHYSICS_CRATE_ANGULAR_FRICTION = 3; /* ma sát góc (rad/s^2) */
var ED_PHYSICS_CRATE_MAX_ANG_VEL = 4;      /* |angVel| tối đa (rad/s) */
/* Label physics-lite cho panel Play (coordinator hiển thị nguyên văn):
   vẫn là physics-lite, không phải rigid-body đầy đủ. */
var ED_PHYSICS_LITE_LABEL = 'Vật lý đơn giản (physics-lite), không phải rigid-body đầy đủ: ' +
  'thùng trượt + xoay khi đẩy lệch tâm, chồng thùng chỉ đứng yên trên mặt nhau, ' +
  'không có khớp nối, không truyền lực ngang giữa các thùng.';

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

/* ---- Đợt 5 — chiều cao thùng (dùng cho chồng thùng). ----
   Ưu tiên crate.height (số > 0), rồi size[2] nếu có, cuối cùng mặc
   định bằng cạnh mặt đất size[0] (thùng khối vuông 1x1x1). Thuần. ---- */
function edPhysicsCrateHeight(crate) {
  var c = crate || {};
  if (typeof c.height === 'number' && c.height > 0) return c.height;
  if (Array.isArray(c.size) && c.size.length >= 3 && Number(c.size[2]) > 0) return Number(c.size[2]);
  if (Array.isArray(c.size) && c.size.length >= 1 && Number(c.size[0]) > 0) return Number(c.size[0]);
  return 1;
}

/* ---- Đợt 5 — đọc vị trí điểm đẩy thành độ lệch tâm [rx, rz]. ----
   opts.pushPoint: điểm đẩy trong world ([x,z] hoặc {x,z} — ví dụ vị trí
   tay hero chạm vào thùng); opts.offset: độ lệch tâm trực tiếp [rx,rz].
   Không có cả hai -> null (đẩy qua tâm, không sinh mô-men). Thuần. ---- */
function edPhysicsPushOffset(cratePos, opts) {
  var o = opts || {};
  if (Array.isArray(o.offset) && o.offset.length >= 2) {
    return [Number(o.offset[0]) || 0, Number(o.offset[1]) || 0];
  }
  var pp = o.pushPoint;
  if (Array.isArray(pp) && pp.length >= 2) {
    return [(Number(pp[0]) || 0) - (Number(cratePos[0]) || 0),
            (Number(pp[1]) || 0) - (Number(cratePos[2]) || 0)];
  }
  if (pp && typeof pp === 'object' && (typeof pp.x === 'number' || typeof pp.z === 'number')) {
    return [(Number(pp.x) || 0) - (Number(cratePos[0]) || 0),
            (Number(pp.z) || 0) - (Number(cratePos[2]) || 0)];
  }
  return null;
}

/* ---- Đợt 5 — mô-men quanh trục Y từ lực đẩy + độ lệch tâm (thuần). ----
   dir: [dx,dz] hướng lực (chuẩn hoá trong hàm); offset [rx,rz]: vector
   từ tâm thùng tới điểm đẩy. Trả (r x F)_y = rz*Fx - rx*Fz (lực F lấy
   theo hướng dir, độ lớn 1 — bên gọi nhân với độ lớn lực thật).
   Đẩy qua tâm (offset 0) -> 0, không xoay. Đẩy lệch sang 1 bên -> khác
   0, dấu cho biết chiều xoay (quy ước Y-up). ---- */
function edPhysicsPushTorque(dir, offset) {
  if (!Array.isArray(dir) || !Array.isArray(offset)) return 0;
  var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
  if (!(len > 0)) return 0;
  var fx = dir[0] / len, fz = dir[1] / len;
  var rx = Number(offset[0]) || 0, rz = Number(offset[1]) || 0;
  return rz * fx - rx * fz;
}

/* ---- Đợt 5 — chuẩn hoá crate đầu vào (không sửa object gốc). ----
   Thiếu field thì mặc định: vel [0,0], velY 0, rotY 0, angVel 0,
   size [1,1], height theo edPhysicsCrateHeight. ---- */
function edPhysicsNormalizeCrate(crate) {
  var c = crate || {};
  var pos = [Number(c.pos && c.pos[0]) || 0, Number(c.pos && c.pos[1]) || 0, Number(c.pos && c.pos[2]) || 0];
  var vel = [Number(c.vel && c.vel[0]) || 0, Number(c.vel && c.vel[1]) || 0];
  var size = (Array.isArray(c.size) && c.size.length >= 2)
    ? [Math.abs(Number(c.size[0]) || 1), Math.abs(Number(c.size[1]) || 1)] : [1, 1];
  return {
    pos: pos, vel: vel,
    velY: (typeof c.velY === 'number' && isFinite(c.velY)) ? c.velY : 0,
    rotY: (typeof c.rotY === 'number' && isFinite(c.rotY)) ? c.rotY : 0,
    angVel: (typeof c.angVel === 'number' && isFinite(c.angVel)) ? c.angVel : 0,
    size: size, height: edPhysicsCrateHeight(c)
  };
}

/* ---- Đợt 5 — lõi trượt + xoay của thùng (dùng chung cho pushCrate
   và crateStep, không gồm trọng lực/chồng thùng). ----
   c (đã chuẩn hoá): {pos, vel, velY, rotY, angVel, size, height}.
   dir: hướng đẩy hoặc null. opts: {pushSpeed, friction,
   angularFriction, maxAngVel, pushPoint, offset}.
   - Đang bị đẩy: vel = dir * pushSpeed; mô-men từ độ lệch tâm làm
     angVel += (torque * pushSpeed / I) * dt, với I = (sx^2+sz^2)/12
     (mô-men quán tính khối hộp, khối lượng 1 — lite, chỉ để tỉ lệ
     xoay hợp lý: thùng càng to càng khó xoay).
   - Ma sát góc (luôn áp dụng, cả lúc đang đẩy): |angVel| trừ dần
     angularFriction*dt về 0, rồi kẹp |angVel| <= maxAngVel.
   - rotY += angVel*dt (chuẩn hoá về [-PI, PI]); va chạm AABB-vs-AABB
     như cũ — LITE: va chạm KHÔNG xoay theo rotY (hộp vẫn tính AABB
     theo size gốc), rotY chủ yếu là hiệu ứng xoay/quán tính.
   Trả {crate, moved, blocked} (crate gồm đủ field đã chuẩn hoá). ---- */
function edPhysicsCrateSlideStep(c, dir, dt, boxes, opts) {
  var o = opts || {};
  var pushSpeed = (Number(o.pushSpeed) > 0) ? Number(o.pushSpeed) : ED_PHYSICS_CRATE_PUSH_SPEED;
  var friction = (Number(o.friction) >= 0) ? Number(o.friction) : ED_PHYSICS_CRATE_FRICTION;
  var angFriction = (Number(o.angularFriction) >= 0) ? Number(o.angularFriction) : ED_PHYSICS_CRATE_ANGULAR_FRICTION;
  var maxAngVel = (Number(o.maxAngVel) > 0) ? Number(o.maxAngVel) : ED_PHYSICS_CRATE_MAX_ANG_VEL;
  var dt2 = (Number(dt) > 0) ? Math.min(0.1, Number(dt)) : 0.016;
  var pos = [c.pos[0], c.pos[1], c.pos[2]];
  var vel = [c.vel[0], c.vel[1]];
  var rotY = c.rotY, angVel = c.angVel;
  var hx = c.size[0] / 2, hz = c.size[1] / 2;
  var pushing = Array.isArray(dir) && (dir[0] !== 0 || dir[1] !== 0);
  if (pushing) {
    var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
    var ux = dir[0] / len, uz = dir[1] / len;
    vel = [ux * pushSpeed, uz * pushSpeed];
    var off = edPhysicsPushOffset(pos, o);
    if (off) {
      var torque = edPhysicsPushTorque([ux, uz], off);
      var inertia = (c.size[0] * c.size[0] + c.size[1] * c.size[1]) / 12;
      if (!(inertia > 0.01)) inertia = 0.01;
      angVel += (torque * pushSpeed / inertia) * dt2;
    }
  } else {
    var sp = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1]);
    if (sp > 0) {
      var ns = sp - friction * dt2;
      if (ns <= 0) vel = [0, 0];
      else vel = [vel[0] / sp * ns, vel[1] / sp * ns];
    }
  }
  /* Ma sát góc: trừ dần về 0 (cả lúc đang đẩy lẫn khi đã buông). */
  if (angVel > 0) angVel = Math.max(0, angVel - angFriction * dt2);
  else if (angVel < 0) angVel = Math.min(0, angVel + angFriction * dt2);
  if (angVel > maxAngVel) angVel = maxAngVel;
  else if (angVel < -maxAngVel) angVel = -maxAngVel;
  rotY += angVel * dt2;
  while (rotY > Math.PI) rotY -= 2 * Math.PI;
  while (rotY < -Math.PI) rotY += 2 * Math.PI;
  var nx = pos[0] + vel[0] * dt2;
  var nz = pos[2] + vel[1] * dt2;
  var blocked = false;
  /* Va chạm AABB-vs-AABB, chỉ xét XZ (giả định lite: thùng và box cản
     đều đứng trên mặt đất; rotY KHÔNG làm thay đổi AABB). */
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
  return {
    crate: { pos: [nx, pos[1], nz], vel: vel, velY: c.velY, rotY: rotY, angVel: angVel, size: c.size, height: c.height },
    moved: moved, blocked: blocked
  };
}

/* ---- Đẩy 1 thùng/crate 1 bước (đợt 3, mở rộng đợt 5: thêm xoay).
   crate: {pos:[x,y,z], vel:[vx,vz], size:[sx,sz],
     rotY? (góc quanh Y), angVel? (vận tốc góc), height?}.
   dir: [dx,dz] hướng đẩy (hero đang đẩy) hoặc null (không ai đẩy).
   boxes: box TĨNH (không gồm thùng khác — không đẩy dây chuyền).
   opts: {pushSpeed, friction, angularFriction, maxAngVel,
     pushPoint ([x,z]/{x,z}: điểm đẩy trong world — lệch tâm thì thùng
     vừa trượt vừa xoay), offset ([rx,rz]: độ lệch tâm trực tiếp)}.
   y của thùng KHÔNG đổi (thùng nằm trên mặt đất; rơi/chồng thùng xem
   edPhysicsCrateStep). Chữ ký giữ nguyên đợt 3 — code cũ gọi vẫn chạy,
   chỉ thêm field rotY/angVel/velY/height vào object crate trả về.
   - Đang bị đẩy: vel = dir * pushSpeed; đẩy lệch tâm sinh mô-men
     (xem edPhysicsPushTorque) làm angVel tăng, rotY đổi theo.
   - Không bị đẩy: ma sát tuyến tính trừ dần tốc độ tới 0; ma sát góc
     trừ dần angVel về 0 (thùng dừng xoay hẳn sau khi buông).
   - Gặp vật cản: đẩy AABB ra theo trục xuyên ít nhất, vel trục đó = 0.
   Trả {crate:{pos, vel, velY, rotY, angVel, size, height}, moved, blocked}. ---- */
function edPhysicsPushCrate(crate, dir, dt, boxes, opts) {
  var c = edPhysicsNormalizeCrate(crate);
  return edPhysicsCrateSlideStep(c, dir, dt, boxes, opts);
}

/* ---- Đợt 5 — mặt đỡ dưới 1 thùng: max(đất, mặt trên crate dưới). ----
   crates: các thùng khác (cùng dạng crate, đã có pos/size/height).
   Chỉ tính crate dưới khi XZ chồng lấn VÀ mặt trên của nó không cao hơn
   đáy thùng đang xét quá ED_PHYSICS_GROUND_SNAP (nó là "sàn", không phải
   "tường" bên cạnh). Trả {support, supportedBy} (supportedBy = id của
   crate đỡ, hoặc null khi đỡ bởi mặt đất). Thuần. ---- */
function edPhysicsCrateSupport(crate, crates, groundY) {
  var support = (typeof groundY === 'number' && isFinite(groundY)) ? groundY : 0;
  var supportedBy = null;
  var hx = crate.size[0] / 2, hz = crate.size[1] / 2;
  for (var i = 0; i < (crates || []).length; i++) {
    var o = crates[i];
    if (!o || o === crate) continue;
    if (crate.id != null && o.id != null && o.id === crate.id) continue;
    var oc = edPhysicsNormalizeCrate(o);
    if (Math.abs(oc.pos[0] - crate.pos[0]) >= hx + oc.size[0] / 2) continue;
    if (Math.abs(oc.pos[2] - crate.pos[2]) >= hz + oc.size[1] / 2) continue;
    var top = oc.pos[1] + oc.height;
    if (top > crate.pos[1] + ED_PHYSICS_GROUND_SNAP) continue;
    if (top > support) { support = top; supportedBy = (o.id != null ? o.id : null); }
  }
  return { support: support, supportedBy: supportedBy };
}

/* ---- Đợt 5 — 1 bước cập nhật đầy đủ cho 1 thùng: trượt + xoay +
   chồng + rơi (API thuần để Play Mode gọi mỗi frame, qua guard typeof).
   crate: như edPhysicsPushCrate (thêm velY? khi đang rơi).
   dt: giây. boxes: box tĩnh. crates: các thùng khác (kể cả thùng đang
   đỡ crate này — chồng nhau theo trục Y).
   opts (optional): như edPhysicsPushCrate + {dir (hướng đẩy, nếu có),
     gravity (mặc định 20), groundY (mặt đất, mặc định 0),
     heights/size/segments (địa hình — groundY lấy max với heightAt)}.
   Thứ tự 1 bước: trượt + xoay (như pushCrate, dir lấy từ opts.dir) ->
   tính mặt đỡ tại XZ mới (đất / mặt trên crate dưới) -> trọng lực:
   chưa chạm mặt đỡ thì velY -= g*dt, y += velY*dt; chạm mặt đỡ thì
   y = mặt đỡ, velY = 0, resting = true. Crate dưới bị đẩy đi (không
   còn chồng XZ) -> mặt đỡ tụt về đất -> crate trên rơi (y giảm).
   LITE: chồng thùng chỉ là resting contact theo trục Y — crate trên
   KHÔNG bị kéo theo khi crate dưới trượt ngang, và 2 thùng cạnh nhau
   theo XZ không đẩy nhau (không có va chạm ngang thùng-thùng).
   Trả {crate:{pos, vel, velY, rotY, angVel, size, height},
     moved, blocked, resting, supportedBy}. ---- */
function edPhysicsCrateStep(crate, dt, boxes, crates, opts) {
  var o = opts || {};
  var c = edPhysicsNormalizeCrate(crate);
  var dt2 = (Number(dt) > 0) ? Math.min(0.1, Number(dt)) : 0.016;
  var g = (Number(o.gravity) > 0) ? Number(o.gravity) : ED_PHYSICS_GRAVITY;
  var slide = edPhysicsCrateSlideStep(c, o.dir || null, dt, boxes, o);
  var nc = slide.crate;
  var groundY = (typeof o.groundY === 'number' && isFinite(o.groundY)) ? o.groundY : 0;
  if (o.heights) {
    var gh = edPhysicsHeightAt(o.heights, nc.pos[0], nc.pos[2], o.size, o.segments);
    if (gh > groundY) groundY = gh;
  }
  /* Mặt đỡ tính với crate đã trượt (XZ mới) — crate dưới vừa bị đẩy
     đi thì XZ không còn chồng, mặt đỡ tụt về đất, crate trên rơi. */
  var sup = edPhysicsCrateSupport(
    { pos: nc.pos, size: nc.size, height: nc.height, id: (crate && crate.id != null) ? crate.id : null },
    crates, groundY);
  var vy = nc.velY;
  var y0 = nc.pos[1];
  var resting = false;
  if (nc.pos[1] <= sup.support + 1e-9 && vy <= 0) {
    nc.pos[1] = sup.support;
    vy = 0;
    resting = true;
  } else {
    vy -= g * dt2;
    if (vy < -ED_PHYSICS_TERMINAL) vy = -ED_PHYSICS_TERMINAL;
    nc.pos[1] += vy * dt2;
    if (nc.pos[1] <= sup.support) {
      nc.pos[1] = sup.support;
      vy = 0;
      resting = true;
    }
  }
  nc.velY = vy;
  var moved = slide.moved || Math.abs(nc.pos[1] - y0) > 1e-9;
  return { crate: nc, moved: moved, blocked: slide.blocked, resting: resting, supportedBy: sup.supportedBy };
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
  /* Đợt 5 — xoay/quán tính góc + label physics-lite cho panel Play. */
  CRATE_ANGULAR_FRICTION: ED_PHYSICS_CRATE_ANGULAR_FRICTION,
  CRATE_MAX_ANG_VEL: ED_PHYSICS_CRATE_MAX_ANG_VEL,
  LITE_LABEL: ED_PHYSICS_LITE_LABEL,
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
  stepFallingProp: edPhysicsStepFallingProp,
  /* Đợt 5 — thùng xoay/quán tính + chồng/rơi. */
  crateStep: edPhysicsCrateStep,
  crateHeight: edPhysicsCrateHeight,
  crateSupport: edPhysicsCrateSupport,
  pushTorque: edPhysicsPushTorque,
  pushOffset: edPhysicsPushOffset
};

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
