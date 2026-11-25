/* ============================================================================
   Map Editor — 12-nav.js (đợt 2, mục 4: Navigation / Pathfinding A*)
   ED.Nav — lưới chặn + A* 8 hướng + làm mượt đường + API runtime cho
   Play Mode (patrol/chase) + overlay debug tô màu ô đi được/chặn.

   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level.
   Mọi khởi tạo trong init() (init chỉ tạo nút debug + đăng ký listener,
   KHÔNG build grid ngay). Logic thuần (edNavBuildBlocked, edNavFindPath,
   edNavSmoothPath, edNavStepAlong) không phụ thuộc DOM/THREE, test được
   bằng vm như các module khác. Giao diện tiếng Việt.
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

/* ---------------- Hằng số (khớp 04-terrain.js) ---------------- */
var ED_NAV_SIZE = 96;        /* chiều rộng map theo trục X/Z (đơn vị thế giới) */
var ED_NAV_SEGMENTS = 64;    /* số ô mỗi chiều -> lưới (SEGMENTS+1)^2 = 65x65 */
var ED_NAV_MAX_SLOPE = 1.2;  /* chênh cao giữa 2 ô kề > 1.2 thì cấm đi qua cạnh */
var ED_NAV_SLOPE_PENALTY = 2; /* phạt dốc: cộng chênh cao * 2 vào chi phí bước */
var ED_NAV_DIAG = 1.4142135623730951; /* sqrt(2): chi phí đi chéo */
var ED_NAV_SNAP_RADIUS = 3;  /* bán kính (ô) tìm ô đi được gần nhất cho start/goal */

/* Type object chặn đường theo footprint (mục 1c). */
var ED_NAV_BLOCKING_TYPES = ['house', 'temple', 'gate', 'tower', 'pillar', 'wall', 'door'];

/* ---------------- Logic thuần (không DOM/THREE) ---------------- */

function edNavClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* Chỉ số ô (ix, iz) -> index mảng. ix/iz: 0..segments. */
function edNavIdx(ix, iz, segments) { return iz * (segments + 1) + ix; }

/* Toạ độ thế giới -> toạ độ lưới (số thực). x/z trong [-size/2, size/2]. */
function edNavWorldToGrid(x, z, segments, size) {
  segments = (segments == null) ? ED_NAV_SEGMENTS : segments;
  size = (size == null) ? ED_NAV_SIZE : size;
  return { gx: (x + size / 2) / size * segments, gz: (z + size / 2) / size * segments };
}
function edNavGridToWorld(gx, gz, segments, size) {
  segments = (segments == null) ? ED_NAV_SEGMENTS : segments;
  size = (size == null) ? ED_NAV_SIZE : size;
  return { x: gx / segments * size - size / 2, z: gz / segments * size - size / 2 };
}

/* ---- (1) Lưới chặn — thuần. ----
   edNavBuildBlocked(heights, paints, objects, segments, size)
   -> mảng boolean dài (segments+1)^2, true = ô bị chặn.
   (a) paint == 4 (nước) chặn. (b) collider type 'collider': shape 'box'
   chặn các ô trong hình chữ nhật pos±scale/2 xoay rot.y (tính gần đúng
   bằng bounding box song song với trục); shape 'sphere' chặn các ô trong
   bán kính scale.x/2; trigger thì KHÔNG chặn. (c) nhà/cổng/tháp/cột...
   chặn các ô quanh vị trí theo footprint, bán kính ≈ max(scale.x,
   scale.z) * 0.9, tối thiểu 1 ô. (d) Dốc quá cao KHÔNG ghi vào mảng
   blocked — A* cấm đi qua cạnh đó lúc tìm đường (xem edNavFindPath).
   heights/paints/objects có thể null/undefined -> coi như trống.
   Object visible === false thì không chặn (đang ẩn khỏi scene). */
function edNavBuildBlocked(heights, paints, objects, segments, size) {
  segments = (segments == null) ? ED_NAV_SEGMENTS : segments;
  size = (size == null) ? ED_NAV_SIZE : size;
  var side = segments + 1;
  var count = side * side;
  var step = size / segments; /* độ rộng 1 ô theo đơn vị thế giới (1.5) */
  var blocked = new Array(count);
  var i;
  for (i = 0; i < count; i++) blocked[i] = false;

  /* (a) Nước: paint == 4. */
  if (paints) {
    for (i = 0; i < count && i < paints.length; i++) {
      if (paints[i] === 4) blocked[i] = true;
    }
  }

  if (!objects || !objects.length) return blocked;

  function markCircle(cx, cz, r) {
    if (!(r > 0)) return;
    var g0 = edNavWorldToGrid(cx - r, cz - r, segments, size);
    var g1 = edNavWorldToGrid(cx + r, cz + r, segments, size);
    var x0 = edNavClamp(Math.floor(g0.gx), 0, segments);
    var x1 = edNavClamp(Math.ceil(g1.gx), 0, segments);
    var z0 = edNavClamp(Math.floor(g0.gz), 0, segments);
    var z1 = edNavClamp(Math.ceil(g1.gz), 0, segments);
    for (var iz = z0; iz <= z1; iz++) {
      for (var ix = x0; ix <= x1; ix++) {
        var w = edNavGridToWorld(ix, iz, segments, size);
        var dx = w.x - cx, dz = w.z - cz;
        if (dx * dx + dz * dz <= r * r) blocked[edNavIdx(ix, iz, segments)] = true;
      }
    }
  }
  function markRect(cx, cz, hx, hz) {
    if (!(hx > 0) || !(hz > 0)) return;
    var g0 = edNavWorldToGrid(cx - hx, cz - hz, segments, size);
    var g1 = edNavWorldToGrid(cx + hx, cz + hz, segments, size);
    var x0 = edNavClamp(Math.floor(g0.gx), 0, segments);
    var x1 = edNavClamp(Math.ceil(g1.gx), 0, segments);
    var z0 = edNavClamp(Math.floor(g0.gz), 0, segments);
    var z1 = edNavClamp(Math.ceil(g1.gz), 0, segments);
    for (var iz = z0; iz <= z1; iz++) {
      for (var ix = x0; ix <= x1; ix++) {
        var w = edNavGridToWorld(ix, iz, segments, size);
        if (w.x >= cx - hx && w.x <= cx + hx && w.z >= cz - hz && w.z <= cz + hz) {
          blocked[edNavIdx(ix, iz, segments)] = true;
        }
      }
    }
  }

  for (var k = 0; k < objects.length; k++) {
    var o = objects[k];
    if (!o || o.visible === false) continue;
    var pos = o.pos || [0, 0, 0];
    var scale = o.scale || [1, 1, 1];
    var rot = o.rot || [0, 0, 0];
    var sx = (typeof scale[0] === 'number' && isFinite(scale[0])) ? Math.abs(scale[0]) : 1;
    var sz = (typeof scale[2] === 'number' && isFinite(scale[2])) ? Math.abs(scale[2]) : 1;
    var cx = Number(pos[0]) || 0;
    var cz = Number(pos[2]) || 0;

    /* (b) Collider. */
    if (o.type === 'collider') {
      var extra = o.extra || {};
      if (extra.trigger) continue; /* trigger không chặn */
      var shape = extra.shape || 'box';
      if (shape === 'sphere') {
        markCircle(cx, cz, sx / 2);
      } else {
        /* Box xoay rot.y: AABB gần đúng.
           hx = (|cos|*sx + |sin|*sz)/2, hz = (|sin|*sx + |cos|*sz)/2. */
        var a = (typeof rot[1] === 'number' && isFinite(rot[1])) ? rot[1] : 0;
        var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
        markRect(cx, cz, (c * sx + s * sz) / 2, (s * sx + c * sz) / 2);
      }
      continue;
    }

    /* (c) Nhà/cổng/tháp/cột...: footprint tròn, bán kính tối thiểu 1 ô. */
    var isBuilding = false;
    for (var t = 0; t < ED_NAV_BLOCKING_TYPES.length; t++) {
      if (o.type === ED_NAV_BLOCKING_TYPES[t]) { isBuilding = true; break; }
    }
    if (isBuilding) {
      var r = Math.max(sx, sz) * 0.9;
      if (r < step) r = step; /* tối thiểu 1 ô */
      markCircle(cx, cz, r);
    }
  }
  return blocked;
}

/* Ô đi được gần nhất với (gx, gz) trong bán kính radius (tìm theo vòng
   vuông mở rộng dần). Trả [gx, gz] hoặc null. Thuần. */
function edNavNearestWalkable(blocked, segments, gx, gz, radius) {
  segments = (segments == null) ? ED_NAV_SEGMENTS : segments;
  radius = (radius == null) ? ED_NAV_SNAP_RADIUS : radius;
  if (!blocked) return null;
  gx = edNavClamp(Math.round(gx), 0, segments);
  gz = edNavClamp(Math.round(gz), 0, segments);
  if (!blocked[edNavIdx(gx, gz, segments)]) return [gx, gz];
  for (var r = 1; r <= radius; r++) {
    for (var dz = -r; dz <= r; dz++) {
      for (var dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        var x = gx + dx, z = gz + dz;
        if (x < 0 || x > segments || z < 0 || z > segments) continue;
        if (!blocked[edNavIdx(x, z, segments)]) return [x, z];
      }
    }
  }
  return null;
}

/* ---- (2) A* thuần. ----
   edNavFindPath(blocked, heights, segments, startGx, startGz, goalGx, goalGz)
   -> mảng [[gx,gz], ...] từ start tới goal, hoặc null nếu không tới được.
   - Di chuyển 8 hướng; cấm cắt góc: đi chéo chỉ khi cả 2 ô kề trực giao
     đều đi được (không chặn).
   - Chi phí: 1 (thẳng), ~1.414 (chéo), + phạt dốc |chênh cao| * 2.
   - Dốc: |chênh cao| giữa 2 ô kề > 1.2 thì cấm đi qua cạnh đó.
   - Heuristic octile (phù hợp di chuyển 8 hướng, admissible).
   - Start/goal rơi vào ô chặn: tự snap tới ô đi được gần nhất trong
     bán kính 3 ô; không có thì trả null. heights null -> coi mặt phẳng. */
function edNavFindPath(blocked, heights, segments, startGx, startGz, goalGx, goalGz) {
  segments = (segments == null) ? ED_NAV_SEGMENTS : segments;
  var side = segments + 1;
  var count = side * side;
  if (!blocked || blocked.length !== count) return null;

  var start = edNavNearestWalkable(blocked, segments, startGx, startGz, ED_NAV_SNAP_RADIUS);
  var goal = edNavNearestWalkable(blocked, segments, goalGx, goalGz, ED_NAV_SNAP_RADIUS);
  if (!start || !goal) return null;
  var sx = start[0], sz = start[1], gx = goal[0], gz = goal[1];
  if (sx === gx && sz === gz) return [[sx, sz]];

  function hAt(ix, iz) {
    if (!heights) return 0;
    var v = heights[edNavIdx(ix, iz, segments)];
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }
  /* Heuristic octile: max(d) + (sqrt2-1)*min(d). */
  function heuristic(ix, iz) {
    var dx = Math.abs(ix - gx), dz = Math.abs(iz - gz);
    var mn = dx < dz ? dx : dz, mx = dx < dz ? dz : dx;
    return mx + (ED_NAV_DIAG - 1) * mn;
  }

  var gScore = new Array(count);
  var fScore = new Array(count);
  var cameFrom = new Array(count);
  var closed = new Array(count);
  var i;
  for (i = 0; i < count; i++) { gScore[i] = Infinity; fScore[i] = Infinity; cameFrom[i] = -1; closed[i] = false; }

  /* Min-heap nhị phân theo fScore (lưu index ô). */
  var heap = [];
  function heapPush(idx) {
    heap.push(idx);
    var c = heap.length - 1;
    while (c > 0) {
      var p = (c - 1) >> 1;
      if (fScore[heap[p]] <= fScore[heap[c]]) break;
      var tmp = heap[p]; heap[p] = heap[c]; heap[c] = tmp;
      c = p;
    }
  }
  function heapPop() {
    var top = heap[0];
    var last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      var p = 0;
      for (;;) {
        var l = p * 2 + 1, r = l + 1, m = p;
        if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
        if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
        if (m === p) break;
        var t2 = heap[p]; heap[p] = heap[m]; heap[m] = t2;
        p = m;
      }
    }
    return top;
  }

  var startIdx = edNavIdx(sx, sz, segments);
  var goalIdx = edNavIdx(gx, gz, segments);
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(sx, sz);
  heapPush(startIdx);

  var DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, ED_NAV_DIAG], [1, -1, ED_NAV_DIAG],
    [-1, 1, ED_NAV_DIAG], [-1, -1, ED_NAV_DIAG]
  ];
  var guard = 0, guardMax = count * 4;
  while (heap.length) {
    if (++guard > guardMax) return null; /* không bao giờ nên xảy ra */
    var cur = heapPop();
    if (closed[cur]) continue;
    closed[cur] = true;
    if (cur === goalIdx) {
      var path = [];
      var n = cur;
      while (n !== -1) {
        path.push([n % side, Math.floor(n / side)]);
        n = cameFrom[n];
      }
      path.reverse();
      return path;
    }
    var cx = cur % side, cz = Math.floor(cur / side);
    var hCur = hAt(cx, cz);
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dz = DIRS[d][1], base = DIRS[d][2];
      var nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nx > segments || nz < 0 || nz > segments) continue;
      var nIdx = edNavIdx(nx, nz, segments);
      if (closed[nIdx] || blocked[nIdx]) continue;
      /* Cấm cắt góc: đi chéo chỉ khi cả 2 ô kề trực giao đều đi được. */
      if (dx !== 0 && dz !== 0) {
        if (blocked[edNavIdx(cx + dx, cz, segments)]) continue;
        if (blocked[edNavIdx(cx, cz + dz, segments)]) continue;
      }
      /* Dốc: cấm cạnh có chênh cao > 1.2. */
      var dh = hAt(nx, nz) - hCur;
      var adh = dh < 0 ? -dh : dh;
      if (adh > ED_NAV_MAX_SLOPE) continue;
      var ng = gScore[cur] + base + adh * ED_NAV_SLOPE_PENALTY;
      if (ng < gScore[nIdx]) {
        cameFrom[nIdx] = cur;
        gScore[nIdx] = ng;
        fScore[nIdx] = ng + heuristic(nx, nz);
        heapPush(nIdx);
      }
    }
  }
  return null; /* hết open mà chưa tới goal: không tới được */
}

/* ---- Làm mượt đường (thuần): bỏ các điểm thẳng hàng, chỉ giữ điểm
   đổi hướng (giữ điểm đầu + điểm cuối). path: [[gx,gz],...] hoặc null. ---- */
function edNavSmoothPath(path) {
  if (!path || path.length <= 2) return path ? path.slice() : path;
  function sgn(v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); }
  var out = [path[0]];
  for (var i = 1; i < path.length - 1; i++) {
    var d1x = sgn(path[i][0] - path[i - 1][0]);
    var d1z = sgn(path[i][1] - path[i - 1][1]);
    var d2x = sgn(path[i + 1][0] - path[i][0]);
    var d2z = sgn(path[i + 1][1] - path[i][1]);
    if (d1x !== d2x || d1z !== d2z) out.push(path[i]);
  }
  out.push(path[path.length - 1]);
  return out;
}

/* ---- Đi dọc đường (thuần, cùng kiểu dùng với edNpcStepToward):
   edNavStepAlong(path, pos, speed, dt) — path là [[x,z],...] theo toạ độ
   thế giới, pos là [x,z] hiện tại, speed đơn vị/giây, dt giây.
   Trả {pos:[x,z], arrived:boolean, path:[[x,z],...]} — path trả về là
   phần đường CÒN LẠI (đã bỏ các waypoint đi qua), để Play Mode giữ lại
   làm path cho frame sau (gọi lại stepAlong(pathConLai, posMoi,...)).
   Tới cuối đường -> arrived=true, path=[]. ---- */
function edNavStepAlong(path, pos, speed, dt) {
  var cur = [Number(pos && pos[0]) || 0, Number(pos && pos[1]) || 0];
  var rest = (path || []).slice();
  var step = (Number(speed) || 0) * (Number(dt) || 0);
  if (step < 0) step = 0;
  while (rest.length && step > 0) {
    var t = rest[0];
    var dx = t[0] - cur[0], dz = t[1] - cur[1];
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= 0.001) { rest.shift(); continue; }
    if (step >= dist) {
      cur = [t[0], t[1]];
      rest.shift();
      step -= dist;
    } else {
      var k = step / dist;
      cur = [cur[0] + dx * k, cur[1] + dz * k];
      step = 0;
    }
  }
  /* Dọn các waypoint đã đứng đúng lên (pos trùng waypoint khi step = 0). */
  while (rest.length) {
    var dx2 = rest[0][0] - cur[0], dz2 = rest[0][1] - cur[1];
    if (Math.sqrt(dx2 * dx2 + dz2 * dz2) <= 0.001) rest.shift();
    else break;
  }
  return { pos: cur, arrived: rest.length === 0, path: rest };
}

/* ---------------- Module ED.Nav (runtime) ---------------- */

ED.Nav = (function () {
  'use strict';

  var _cache = { blocked: null, heights: null, segments: ED_NAV_SEGMENTS, size: ED_NAV_SIZE, hash: null, blockedCount: 0 };
  var _version = 0;      /* tăng khi ED.Core báo đổi (onChange) hoặc rebuild() */
  var _debug = false;
  var _overlay = null;   /* THREE.Mesh mặt lưới debug */
  var _btn = null;

  /* Hash đơn giản để biết grid có cũ không (KHÔNG phải hash mật mã):
     lengths + tổng mẫu heights/paints (mỗi 16 ô) + tổng mẫu vị trí/
     scale/rot của objects + version. Đủ bắt: brush đổi cao độ, tô paint,
     thêm/xoá/dời/xoay/scale object, undo/redo/load project (qua onChange
     hoặc qua thay đổi mảng). findPath/isBlocked gọi _ensureGrid() nên
     grid luôn mới nhất mà không cần build lại mỗi lần gọi. */
  function _computeHash(heights, paints, objects) {
    var hSum = 0, pSum = 0, oSum = 0;
    var i;
    if (heights) for (i = 0; i < heights.length; i += 16) hSum += Math.round((Number(heights[i]) || 0) * 1000);
    if (paints) for (i = 0; i < paints.length; i += 16) pSum += (Number(paints[i]) || 0);
    if (objects) {
      for (i = 0; i < objects.length; i++) {
        var o = objects[i];
        if (!o) continue;
        var p = o.pos || [0, 0, 0], s = o.scale || [1, 1, 1], r = o.rot || [0, 0, 0];
        oSum += Math.round(((Number(p[0]) || 0) + (Number(p[2]) || 0) +
          (Number(s[0]) || 0) + (Number(s[2]) || 0) + (Number(r[1]) || 0)) * 100);
        oSum += (o.type || '').length * 7 + ((o.extra && o.extra.trigger) ? 1 : 0);
      }
    }
    return [heights ? heights.length : 0, paints ? paints.length : 0,
      objects ? objects.length : 0, hSum, pSum, oSum, _version].join('|');
  }

  /* Đọc terrain hiện tại: ưu tiên ED.Terrain (đồng bộ 2 chiều với project),
     fallback project.terrain của ED.Core. */
  function _readTerrain() {
    var heights = null, paints = null;
    var segments = ED_NAV_SEGMENTS, size = ED_NAV_SIZE;
    if (ED.Terrain) {
      if (typeof ED.Terrain.getHeights === 'function') { try { heights = ED.Terrain.getHeights(); } catch (e) {} }
      if (typeof ED.Terrain.getPaints === 'function') { try { paints = ED.Terrain.getPaints(); } catch (e) {} }
      if (typeof ED.Terrain.SEGMENTS === 'number') segments = ED.Terrain.SEGMENTS;
      /* Đợt 6 — map 96/128/192: ưu tiên ED.Terrain.getSize() (live),
         fallback ED.Terrain.SIZE rồi 96 (ED_NAV_SIZE). */
      if (typeof ED.Terrain.getSize === 'function') {
        try {
          var s = ED.Terrain.getSize();
          if (typeof s === 'number' && isFinite(s) && s > 0) size = s;
        } catch (e) { /* giữ size cũ */ }
      } else if (typeof ED.Terrain.SIZE === 'number') size = ED.Terrain.SIZE;
    }
    if ((!heights || !paints) && ED.Core && typeof ED.Core.getProject === 'function') {
      var p = null;
      try { p = ED.Core.getProject(); } catch (e) { p = null; }
      if (p && p.terrain) {
        if (!heights) heights = p.terrain.heights;
        if (!paints) paints = p.terrain.paints;
        if (typeof p.terrain.segments === 'number') segments = p.terrain.segments;
        if (typeof p.terrain.size === 'number') size = p.terrain.size;
      }
    }
    return { heights: heights, paints: paints, segments: segments, size: size };
  }
  function _readObjects() {
    if (ED.Core && typeof ED.Core.listObjects === 'function') {
      try { return ED.Core.listObjects(); } catch (e) { return []; }
    }
    return [];
  }

  /* Build (lại) lưới chặn từ project hiện tại; dùng cache theo hash.
     force=true: bỏ cache, build lại chắc chắn. Trả info grid. */
  function buildGrid(force) {
    var t = _readTerrain();
    var objects = _readObjects();
    var hash = _computeHash(t.heights, t.paints, objects);
    if (!force && _cache.blocked && _cache.hash === hash &&
        _cache.segments === t.segments && _cache.size === t.size) {
      return getGridInfo();
    }
    var blocked = edNavBuildBlocked(t.heights, t.paints, objects, t.segments, t.size);
    var n = 0;
    for (var i = 0; i < blocked.length; i++) if (blocked[i]) n++;
    _cache = { blocked: blocked, heights: t.heights, segments: t.segments, size: t.size, hash: hash, blockedCount: n };
    if (_debug) _refreshOverlay();
    return getGridInfo();
  }
  /* Ép build lại lưới (gọi tay sau khi sửa terrain/object mà hash không
     bắt được, hoặc trước khi test Play Mode). */
  function rebuild() { _version++; return buildGrid(true); }
  function _ensureGrid() {
    if (!_cache.blocked) return buildGrid(false);
    return buildGrid(false); /* buildGrid tự so hash, chỉ build khi đổi */
  }
  function getGridInfo() {
    return {
      built: !!_cache.blocked,
      segments: _cache.segments, size: _cache.size,
      cells: _cache.blocked ? _cache.blocked.length : 0,
      blockedCount: _cache.blockedCount, hash: _cache.hash
    };
  }

  function _worldToGrid(x, z) {
    if (ED.Terrain && typeof ED.Terrain.worldToGrid === 'function') {
      try { return ED.Terrain.worldToGrid(x, z); } catch (e) {}
    }
    return edNavWorldToGrid(x, z, _cache.segments, _cache.size);
  }
  function _gridToWorld(gx, gz) {
    if (ED.Terrain && typeof ED.Terrain.gridToWorld === 'function') {
      try { return ED.Terrain.gridToWorld(gx, gz); } catch (e) {}
    }
    return edNavGridToWorld(gx, gz, _cache.segments, _cache.size);
  }

  /* Tìm đường theo toạ độ thế giới. Trả [[x,z],...] đã làm mượt, hoặc
     null nếu không tới được. */
  function findPath(x0, z0, x1, z1) {
    _ensureGrid();
    var s = _worldToGrid(Number(x0) || 0, Number(z0) || 0);
    var g = _worldToGrid(Number(x1) || 0, Number(z1) || 0);
    var gridPath = edNavFindPath(_cache.blocked, _cache.heights, _cache.segments,
      Math.round(s.gx), Math.round(s.gz), Math.round(g.gx), Math.round(g.gz));
    if (!gridPath) return null;
    var smooth = edNavSmoothPath(gridPath);
    var out = [];
    for (var i = 0; i < smooth.length; i++) {
      var w = _gridToWorld(smooth[i][0], smooth[i][1]);
      out.push([w.x, w.z]);
    }
    return out;
  }

  /* Ô chứa (x, z) có bị chặn không? Ngoài biên map -> chặn. */
  function isBlocked(x, z) {
    _ensureGrid();
    var g = _worldToGrid(Number(x) || 0, Number(z) || 0);
    var gx = Math.round(g.gx), gz = Math.round(g.gz);
    if (gx < 0 || gx > _cache.segments || gz < 0 || gz > _cache.segments) return true;
    return !!_cache.blocked[edNavIdx(gx, gz, _cache.segments)];
  }

  /* Đi dọc đường 1 bước (dùng cho patrol/chase của Play Mode).
     Xem edNavStepAlong: nhớ giữ lại result.path cho frame sau. */
  function stepAlong(path, pos, speed, dt) {
    return edNavStepAlong(path, pos, speed, dt);
  }

  /* ---- Overlay debug: 1 mặt lưới PlaneGeometry chia ô, tô màu theo
     ô đi được (xanh lá mờ) / ô chặn (đỏ mờ), y = cao độ terrain + 0.05.
     Tạo lại mỗi khi grid đổi trong lúc debug đang bật. ---- */
  function _getScene() {
    try {
      if (ED.Viewport && typeof ED.Viewport.getScene === 'function') return ED.Viewport.getScene();
      if (ED.Viewport && ED.Viewport.scene) return ED.Viewport.scene;
    } catch (e) {}
    return null;
  }
  function _buildOverlay() {
    if (typeof THREE === 'undefined') return null;
    var scene = _getScene();
    if (!scene || !_cache.blocked || !_cache.heights) return null;
    _removeOverlay();
    var segments = _cache.segments, size = _cache.size, side = segments + 1;
    try {
      var geo = new THREE.PlaneGeometry(size, size, segments, segments);
      var posAttr = geo.attributes.position;
      var colors = new Float32Array(posAttr.count * 3);
      var heights = _cache.heights, blocked = _cache.blocked;
      /* PlaneGeometry: đỉnh v = iz*65+ix, iz=0 ở z=+48; heights lưu theo
         (ix, izH) với z = -48 + izH*1.5 -> izH = 64 - iz (như 04-terrain). */
      for (var v = 0; v < posAttr.count; v++) {
        var ix = v % side;
        var iz = Math.floor(v / side);
        var izH = segments - iz;
        var h = heights[edNavIdx(ix, izH, segments)];
        if (typeof h !== 'number' || !isFinite(h)) h = 0;
        posAttr.setZ(v, h + 0.05);
        var isB = !!blocked[edNavIdx(ix, izH, segments)];
        colors[v * 3] = isB ? 1 : 0.2;
        colors[v * 3 + 1] = isB ? 0.15 : 0.9;
        colors[v * 3 + 2] = isB ? 0.15 : 0.3;
      }
      posAttr.needsUpdate = true;
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      var mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide, depthWrite: false
      });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.isNavOverlay = true;
      mesh.renderOrder = 5;
      scene.add(mesh);
      _overlay = mesh;
      return mesh;
    } catch (e) { return null; }
  }
  function _removeOverlay() {
    if (!_overlay) return;
    try {
      var scene = _getScene();
      if (scene) scene.remove(_overlay);
      if (_overlay.geometry && _overlay.geometry.dispose) _overlay.geometry.dispose();
      if (_overlay.material && _overlay.material.dispose) _overlay.material.dispose();
    } catch (e) {}
    _overlay = null;
  }
  function _refreshOverlay() {
    if (!_debug) return;
    _buildOverlay();
    if (_overlay) _overlay.visible = true;
  }
  function _updateBtn() {
    if (!_btn) return;
    _btn.textContent = _debug ? '🧭 Lưới đi: BẬT' : '🧭 Lưới đi: TẮT';
    _btn.classList.toggle('ed-nav-debug-on', _debug);
  }

  /* Bật/tắt overlay debug. Bật -> build grid (nếu chưa có) + vẽ lưới;
     tắt -> ẩn lưới (giữ mesh để bật lại nhanh). Trả trạng thái mới. */
  function setDebug(on) {
    _debug = !!on;
    if (_debug) {
      _ensureGrid();
      if (!_overlay) _buildOverlay();
      else _overlay.visible = true;
      try { if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log('Nav: overlay lưới đi BẬT (' + _cache.blockedCount + ' ô chặn / ' + (_cache.blocked ? _cache.blocked.length : 0) + ' ô).'); } catch (e) {}
    } else {
      if (_overlay) _overlay.visible = false;
    }
    _updateBtn();
    return _debug;
  }
  function isDebug() { return _debug; }

  /* init() chỉ tạo nút debug + đăng ký listener báo đổi project.
     KHÔNG build grid ngay (grid build lười ở lần findPath/isBlocked đầu). */
  function init() {
    try {
      if (ED.Core && typeof ED.Core.onChange === 'function') {
        ED.Core.onChange(function () { _version++; });
      }
    } catch (e) {}
    if (typeof document === 'undefined') return false;
    var host = document.getElementById('viewport-wrap') ||
      document.getElementById('viewport') || document.body;
    if (!host) return false;
    if (document.getElementById('ed-nav-debug-btn')) {
      _btn = document.getElementById('ed-nav-debug-btn');
    } else {
      var b = document.createElement('button');
      b.id = 'ed-nav-debug-btn';
      b.type = 'button';
      b.className = 'ed-nav-debug-btn';
      b.textContent = '🧭 Lưới đi: TẮT';
      b.title = 'Bật/tắt lưới tìm đường (xanh = đi được, đỏ = chặn)';
      b.addEventListener('click', function () { setDebug(!_debug); });
      host.appendChild(b);
      _btn = b;
    }
    _updateBtn();
    return true;
  }

  return {
    SIZE: ED_NAV_SIZE, SEGMENTS: ED_NAV_SEGMENTS,
    MAX_SLOPE: ED_NAV_MAX_SLOPE, SLOPE_PENALTY: ED_NAV_SLOPE_PENALTY,
    SNAP_RADIUS: ED_NAV_SNAP_RADIUS, BLOCKING_TYPES: ED_NAV_BLOCKING_TYPES,
    /* Hàm thuần — nhóm D test bằng vm + stub THREE. */
    buildBlocked: edNavBuildBlocked,
    findPathGrid: edNavFindPath,
    nearestWalkable: edNavNearestWalkable,
    smoothPath: edNavSmoothPath,
    stepAlongPath: edNavStepAlong,
    worldToGrid: edNavWorldToGrid, gridToWorld: edNavGridToWorld,
    /* API runtime. */
    buildGrid: buildGrid, rebuild: rebuild, getGridInfo: getGridInfo,
    findPath: findPath, isBlocked: isBlocked, stepAlong: stepAlong,
    setDebug: setDebug, isDebug: isDebug,
    init: init
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
