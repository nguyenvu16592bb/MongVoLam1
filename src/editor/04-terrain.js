/* ============================================================================
   Map Editor — 04-terrain.js (nhóm B)
   ED.Terrain — heightmap 96×96, segments 64. heights/paints lưu trong
   project.terrain (schema v1). Brush Raise/Lower/Smooth/Flatten + paint
   5 chất liệu. applyBrush/paintAt/heightAt là hàm THUẦN (đổi mảng, không
   cần DOM/THREE) để test Node bằng vm + stub THREE. rebuildMesh() cập
   nhật geometry + vertex colors khi có viewport. Terrain là object type
   'terrain' duy nhất, không xoá được (nhóm A chặn ở removeObject; ở đây
   rebuildMesh() luôn dựng lại mesh terrain từ project).
   Đợt 4: texture đất procedural theo lưới paint (paintGridToTexturePlan
   thuần + vẽ canvas 512 trong browser), import heightmap .raw/.r16
   16-bit LE (parseRawHeightmap thuần), chia mặt đất thành chunk 4×4
   (16 mesh riêng, getChunkInfo), xói mòn thủy lực giọt nước
   (erodeStep thuần + erodeDropletsAsync chạy từng đợt, có Hủy).
   Đợt 5: LOD 3 mức cho từng chunk (edTerrainLodLevel thuần +
   updateLod/getLodInfo, mép chunk snap để không hở khe, hysteresis
   ±10%, chỉ rebuild chunk đổi mức + chunk kề), xói mòn dòng chảy tích
   lũy (edTerrainFlowMap D8 + edTerrainErodeFlow thuần, deterministic,
   chạy từng lượt không khoá UI, có Hủy). Mức LOD chỉ sống trong phiên,
   không lưu vào project JSON.
   Đợt 6: map 96/128/192 (SEGMENTS giữ 64, mảng heights/paints vẫn
   65×65=4225, chỉ đổi tỉ lệ ô = size/64), regions + preset theo vùng
   (badge tên vùng + tự đổi preset), spline đường/sông/hàng rào
   (splineFlatten/roadCells thuần, buildSplineGroup, tick() cho sông
   chảy), cọ rải scatter (scatterPositions deterministic, 1 InstancedMesh
   mỗi object). UI đợt 6 tự tạo trong init, không sửa 02-ui.js.
   Project JSON v1 mở rộng (project cũ vẫn mở được): terrain.size
   96|128|192, terrain.regions [{id,name,x0,z0,x1,z1,preset}];
   objects[] thêm type 'spline' (extra {splineKind, points, width,
   riverSnapped?}) và type 'scatter' (extra {kind, count, seed, radius,
   center}).
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level.
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Terrain = (function () {
  'use strict';

  var SIZE = 96;
  var SEGMENTS = 64;
  var VERTS_PER_SIDE = SEGMENTS + 1; // 65
  var COUNT = VERTS_PER_SIDE * VERTS_PER_SIDE; // 4225

  /* Màu vertex theo chất liệu paint (khớp game: cỏ #4c8c3b, đất nâu, đá
     #8b9793, cát vàng, nước #3a8b8c). */
  var PAINT_COLORS = [
    [0.30, 0.55, 0.23], // 0 cỏ xanh
    [0.54, 0.42, 0.27], // 1 đất nâu
    [0.55, 0.59, 0.58], // 2 đá xám
    [0.85, 0.76, 0.48], // 3 cát vàng
    [0.23, 0.55, 0.55]  // 4 nước xanh
  ];
  var PAINT_NAMES = ['Cỏ', 'Đất', 'Đá', 'Cát', 'Nước'];

  /* State nội bộ (đồng bộ 2 chiều với ED.Core project qua syncFromProject/
     syncToProject). vm-test dùng trực tiếp state này, không cần ED.Core. */
  var _heights = null;
  var _paints = null;
  var _mesh = null;      // THREE.Mesh terrain trong viewport
  var _preview = null;   // vòng tròn wireframe xem trước brush
  var _brush = { mode: 'raise', size: 6, strength: 0.5, falloff: 0.7, paint: 0 };

  function makeHeights() {
    var a = new Array(COUNT);
    for (var i = 0; i < COUNT; i++) a[i] = 0;
    return a;
  }
  function makePaints() {
    var a = new Array(COUNT);
    for (var i = 0; i < COUNT; i++) a[i] = 0;
    return a;
  }
  function reset() {
    _heights = makeHeights();
    _paints = makePaints();
    return { heights: _heights, paints: _paints };
  }
  reset();

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function smoothstep(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }
  /* Chỉ số đỉnh (ix, iz) -> index mảng. ix/iz: 0..64. */
  function idx(ix, iz) { return iz * VERTS_PER_SIDE + ix; }
  /* Toạ độ thế giới -> toạ độ lưới (số thực). x/z trong [-48, 48]. */
  function worldToGrid(x, z) {
    return { gx: (x + SIZE / 2) / SIZE * SEGMENTS, gz: (z + SIZE / 2) / SIZE * SEGMENTS };
  }
  function gridToWorld(gx, gz) {
    return { x: gx / SEGMENTS * SIZE - SIZE / 2, z: gz / SEGMENTS * SIZE - SIZE / 2 };
  }

  /* ---- Đợt 6: kích thước map 96/128/192. ----
     SEGMENTS giữ nguyên 64 nên mảng heights/paints vẫn 65×65=4225;
     chỉ đổi tỉ lệ ô = SIZE/64 (1.5 / 2 / 3 đơn vị/đỉnh). Mọi chỗ
     trong file đã dùng biến SIZE (worldToGrid/gridToWorld/chunk/LOD/
     erosion) nên đổi SIZE là đủ — đã rà soát, không còn hằng 96 cứng
     nào cho kích thước map (96 còn lại chỉ là giá trị mặc định và
     lựa chọn lưới file .raw, không phải kích thước map). */
  var MAP_SIZES = [96, 128, 192];
  function validMapSize(n) {
    n = Math.round(Number(n) || 0);
    for (var i = 0; i < MAP_SIZES.length; i++) if (MAP_SIZES[i] === n) return n;
    return 0;
  }
  function getSize() { return SIZE; }
  /* Đổi kích thước map: pushHistory TRƯỚC khi đổi (snapshot trước thay
     đổi, đúng pattern erode()/importHeightmap), rồi đồng bộ project,
     dựng lại mesh + báo viewport. Giá trị lạ hoặc bằng hiện tại -> giữ
     nguyên, không push history. Trả về SIZE hiện tại. */
  function setSize(n) {
    var v = validMapSize(n);
    if (!v || v === SIZE) return SIZE;
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: đổi kích thước map ' + v);
    SIZE = v;
    syncToProject();
    markDirtyPush();
    rebuildMesh();
    refreshViewportTerrain();
    updateMapSizeLine();
    return SIZE;
  }

  /* ---- Logic thuần: brush trên mảng heights. ----
     mode: 'raise' | 'lower' | 'smooth' | 'flatten'.
     falloff 0 = mép cứng, 1 = smoothstep đầy đủ; mặc định 0.7.
     Trả về số đỉnh đã đổi (để test + undo biết có thay đổi không). */
  function brushHeights(heights, cx, cz, mode, brushSize, strength, falloff) {
    if (!heights || !heights.length) return 0;
    brushSize = Math.max(0.5, Number(brushSize) || 6);
    strength = clamp(Number(strength) || 0, 0, 5);
    falloff = clamp((falloff == null ? 0.7 : Number(falloff)), 0, 1);
    var step = SIZE / SEGMENTS; // 1.5 đơn vị/đỉnh
    var radius = (brushSize / 2) / step; // bán kính theo đỉnh
    var c = worldToGrid(cx, cz);
    var minX = Math.max(0, Math.floor(c.gx - radius)), maxX = Math.min(SEGMENTS, Math.ceil(c.gx + radius));
    var minZ = Math.max(0, Math.floor(c.gz - radius)), maxZ = Math.min(SEGMENTS, Math.ceil(c.gz + radius));
    /* Flatten lấy chiều cao mục tiêu tại tâm TRƯỚC khi sửa. */
    var target = 0;
    if (mode === 'flatten') {
      var tx = clamp(Math.round(c.gx), 0, SEGMENTS), tz = clamp(Math.round(c.gz), 0, SEGMENTS);
      target = heights[idx(tx, tz)];
    }
    /* Smooth cần bản sao heights gốc để trung bình không bị nhiễm. */
    var src = (mode === 'smooth') ? heights.slice() : heights;
    var changed = 0;
    for (var iz = minZ; iz <= maxZ; iz++) {
      for (var ix = minX; ix <= maxX; ix++) {
        var d = Math.sqrt((ix - c.gx) * (ix - c.gx) + (iz - c.gz) * (iz - c.gz));
        if (d > radius) continue;
        var t = d / radius;
        var f = (1 - falloff) * 1 + falloff * (1 - smoothstep(t)); // 1 ở tâm -> 0 ở mép
        var i = idx(ix, iz);
        var old = heights[i], nv = old;
        if (mode === 'raise') nv = old + strength * f;
        else if (mode === 'lower') nv = old - strength * f;
        else if (mode === 'flatten') nv = old + (target - old) * strength * f;
        else if (mode === 'smooth') {
          var sum = 0, n = 0;
          for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
            var jx = ix + dx, jz = iz + dz;
            if (jx < 0 || jx > SEGMENTS || jz < 0 || jz > SEGMENTS) continue;
            sum += src[idx(jx, jz)]; n++;
          }
          var avg = n ? sum / n : old;
          nv = old + (avg - old) * strength * f;
        } else continue;
        if (nv !== old) { heights[i] = nv; changed++; }
      }
    }
    return changed;
  }

  /* Paint thuần: đổi paints trong bán kính thành mat (0..4). */
  function paintHeights(paints, cx, cz, mat, brushSize) {
    if (!paints || !paints.length) return 0;
    mat = clamp(Math.round(Number(mat) || 0), 0, 4);
    brushSize = Math.max(0.5, Number(brushSize) || 6);
    var step = SIZE / SEGMENTS;
    var radius = (brushSize / 2) / step;
    var c = worldToGrid(cx, cz);
    var minX = Math.max(0, Math.floor(c.gx - radius)), maxX = Math.min(SEGMENTS, Math.ceil(c.gx + radius));
    var minZ = Math.max(0, Math.floor(c.gz - radius)), maxZ = Math.min(SEGMENTS, Math.ceil(c.gz + radius));
    var changed = 0;
    for (var iz = minZ; iz <= maxZ; iz++) {
      for (var ix = minX; ix <= maxX; ix++) {
        var d = Math.sqrt((ix - c.gx) * (ix - c.gx) + (iz - c.gz) * (iz - c.gz));
        if (d > radius) continue;
        var i = idx(ix, iz);
        if (paints[i] !== mat) { paints[i] = mat; changed++; }
      }
    }
    return changed;
  }

  /* Chiều cao tại (x, z): nội suy song tuyến trên lưới. Thuần. */
  function heightAtArray(heights, x, z) {
    if (!heights || !heights.length) return 0;
    var c = worldToGrid(clamp(x, -SIZE / 2, SIZE / 2), clamp(z, -SIZE / 2, SIZE / 2));
    var x0 = clamp(Math.floor(c.gx), 0, SEGMENTS - 1), z0 = clamp(Math.floor(c.gz), 0, SEGMENTS - 1);
    var fx = c.gx - x0, fz = c.gz - z0;
    var h00 = heights[idx(x0, z0)], h10 = heights[idx(x0 + 1, z0)];
    var h01 = heights[idx(x0, z0 + 1)], h11 = heights[idx(x0 + 1, z0 + 1)];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /* ---- Logic thuần đợt 4: texture đất, heightmap .raw, chunk, xói mòn giọt. ----
     Mọi hàm ở đây đều thuần (không DOM/THREE) để test Node bằng vm. */

  /* RNG có seed cố định (mulberry32) để build texture + erosion deterministic. */
  function mulberry32(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Layout chunk 4×4: mỗi chunk 16×16 segment = 17×17 đỉnh (biên trùng nhau
     giữa các chunk kề, chuẩn cho frustum culling từng chunk). */
  var CHUNK_COUNT = 4;
  var CHUNK_SEGMENTS = SEGMENTS / CHUNK_COUNT; // 16
  var CHUNK_VERTS = CHUNK_SEGMENTS + 1;        // 17
  var CHUNK_TOTAL = CHUNK_COUNT * CHUNK_COUNT; // 16
  var TEXTURE_SIZE = 512;  // texture đất lớn vẽ theo lưới paint
  var SNOW_PATTERN = 5;    // pattern tuyết (ô cao >= SNOW_LINE, trừ nước)
  var SNOW_LINE = 6;
  /* Pattern texture đất: 0 cỏ, 1 đất, 2 đá, 3 cát, 4 nước, 5 tuyết. */
  var PATTERN_NAMES = ['Cỏ', 'Đất', 'Đá', 'Cát', 'Nước', 'Tuyết'];
  var PATTERN_BASE = ['#4c8c3b', '#8a6a42', '#8b9793', '#d8c27a', '#3a8b8c', '#e8eef2'];

  function chunkLayout() {
    var list = [];
    for (var cz = 0; cz < CHUNK_COUNT; cz++) {
      for (var cx = 0; cx < CHUNK_COUNT; cx++) {
        list.push({
          cx: cx, cz: cz,
          x0: cx * CHUNK_SEGMENTS, z0: cz * CHUNK_SEGMENTS, // đỉnh lưới (hàng mặt phẳng)
          verts: CHUNK_VERTS * CHUNK_VERTS,
          centerX: (cx * CHUNK_SEGMENTS + CHUNK_SEGMENTS / 2) / SEGMENTS * SIZE - SIZE / 2,
          centerZ: (cz * CHUNK_SEGMENTS + CHUNK_SEGMENTS / 2) / SEGMENTS * SIZE - SIZE / 2
        });
      }
    }
    return { count: CHUNK_COUNT, total: CHUNK_TOTAL, segments: CHUNK_SEGMENTS, vertsPerSide: CHUNK_VERTS, chunks: list };
  }

  /* chunkCells(heights, paints, cx, cz): 289 heights + 289 paints của chunk
     (cx, cz), thứ tự hàng mặt phẳng (iz cục bộ 0..16, ix cục bộ 0..16) —
     cùng phép lật z như rebuildMesh cũ: đỉnh mặt phẳng (gx, gz) lấy
     heights[idx(gx, SEGMENTS - gz)]. Trả về {heights, paints} mới. */
  function chunkCells(heights, paints, cx, cz) {
    var h = new Array(CHUNK_VERTS * CHUNK_VERTS);
    var p = new Array(CHUNK_VERTS * CHUNK_VERTS);
    for (var i = 0; i < h.length; i++) { h[i] = 0; p[i] = 0; }
    cx = clamp(Math.round(Number(cx) || 0), 0, CHUNK_COUNT - 1);
    cz = clamp(Math.round(Number(cz) || 0), 0, CHUNK_COUNT - 1);
    if (!heights || heights.length !== COUNT) return { heights: h, paints: p };
    for (var iz = 0; iz < CHUNK_VERTS; iz++) {
      var gz = cz * CHUNK_SEGMENTS + iz;
      var izH = SEGMENTS - gz;
      for (var ix = 0; ix < CHUNK_VERTS; ix++) {
        var gx = cx * CHUNK_SEGMENTS + ix;
        var k = iz * CHUNK_VERTS + ix;
        h[k] = heights[idx(gx, izH)];
        if (paints && paints.length === COUNT) p[k] = paints[idx(gx, izH)];
      }
    }
    return { heights: h, paints: p };
  }

  /* ---- Logic thuần đợt 5: LOD chunk. ----
     Mỗi chunk có 3 mức: 0 = đủ lưới (16 segment), 1 = một nửa
     (8 segment, giữ mỗi đỉnh chẵn), 2 = ~1/4 (4 segment, giữ đỉnh góc
     + vài đỉnh giữa). Mọi mức đều giữ đỉnh góc chunk (0 và 16) nên
     lưới con luôn khớp lưới cha tại góc; đỉnh biên của chunk mịn hơn
     mà nằm giữa 2 đỉnh của chunk kề thô hơn thì được snap về nội suy
     tuyến tính theo 2 đỉnh thô đó, nên 2 mép trùng khít, không hở khe. */

  /* Số segment mỗi cạnh chunk theo mức LOD (0/1/2). */
  var LOD_SEGMENTS = [16, 8, 4];
  var LOD_STEPS = [1, 2, 4]; // bước lấy mẫu đỉnh theo mức
  var LOD_DEFAULT_NEAR = 35; // gần hơn: mức 0
  var LOD_DEFAULT_FAR = 70;  // xa hơn: mức 2
  function lodLevelClamped(level) {
    level = Math.round(Number(level) || 0);
    return level < 0 ? 0 : (level > 2 ? 2 : level);
  }
  /* Chuẩn hoá ngưỡng: nhận {near, far} | {mid, far} | [near, far] | null.
     Luôn trả {near, far} với far > near. */
  function normalizeLodThresholds(thresholds) {
    var near = LOD_DEFAULT_NEAR, far = LOD_DEFAULT_FAR;
    if (thresholds) {
      if (typeof thresholds.length === 'number' && thresholds.length >= 2) {
        near = Number(thresholds[0]); far = Number(thresholds[1]);
      } else {
        if (thresholds.near != null) near = Number(thresholds.near);
        else if (thresholds.mid != null) near = Number(thresholds.mid);
        if (thresholds.far != null) far = Number(thresholds.far);
      }
    }
    if (!isFinite(near) || near < 0) near = LOD_DEFAULT_NEAR;
    if (!isFinite(far) || far <= near) far = near + 5;
    return { near: near, far: far };
  }
  /* edTerrainLodLevel(dist, thresholds): mức LOD theo khoảng cách, KHÔNG
     hysteresis (dùng để test bảng mức). dist < near -> 0, < far -> 1,
     còn lại -> 2. thresholds mặc định {near:35, far:70}. */
  function edTerrainLodLevel(dist, thresholds) {
    var t = normalizeLodThresholds(thresholds);
    dist = Number(dist) || 0;
    if (dist < 0) dist = 0;
    if (dist < t.near) return 0;
    if (dist < t.far) return 1;
    return 2;
  }
  /* edTerrainLodNextLevel(dist, currentLevel, thresholds): mức tiếp theo
     CÓ hysteresis ±10% — đổi mức chỉ khi vượt ngưỡng:
     - thô dần (0->1, 1->2): cần dist > ngưỡng * 1.1;
     - mịn dần (1->0, 2->1): cần dist < ngưỡng * 0.9;
     - nhảy 2 mức 1 lần thì đi từng mức (0->2 thành 1 nếu chưa vượt
       ngưỡng far * 1.1; 2->0 thành 1 nếu chưa xuống dưới near * 0.9). */
  function edTerrainLodNextLevel(dist, currentLevel, thresholds) {
    var t = normalizeLodThresholds(thresholds);
    var cur = lodLevelClamped(currentLevel);
    var target = edTerrainLodLevel(dist, t);
    if (target === cur) return cur;
    if (target > cur) {
      var bUp = (target === 2) ? t.far : t.near;
      if (dist > bUp * 1.1) return target;
      if (cur === 0 && target === 2 && dist > t.near * 1.1) return 1;
      return cur;
    }
    var bDown = (target === 0) ? t.near : t.far;
    if (dist < bDown * 0.9) return target;
    if (cur === 2 && target === 0 && dist < t.far * 0.9) return 1;
    return cur;
  }

  /* edTerrainLodGrid(heights, paints, cx, cz, level, neighborLevels):
     lưới đỉnh của 1 chunk ở 1 mức LOD, thứ tự hàng mặt phẳng như
     chunkCells (iz cục bộ 0..segs, ix cục bộ 0..segs; đỉnh (ix, iz)
     lấy heights[idx(gx, SEGMENTS-gz)]).
     neighborLevels: {left, right, top, bottom} = mức LOD của chunk kề
     (null = không có chunk kề / cùng mức). Chunk kề thô hơn thì đỉnh
     biên nằm giữa 2 đỉnh thô được snap về nội suy tuyến tính.
     Trả về {segments, vertsPerSide, step, level, heights, paints}.
     heights/paints sai độ dài -> lưới 0 (như chunkCells). */
  function edTerrainLodGrid(heights, paints, cx, cz, level, neighborLevels) {
    level = lodLevelClamped(level);
    var step = LOD_STEPS[level];
    var segs = LOD_SEGMENTS[level];
    var vps = segs + 1;
    var h = new Array(vps * vps), p = new Array(vps * vps);
    for (var i = 0; i < h.length; i++) { h[i] = 0; p[i] = 0; }
    cx = clamp(Math.round(Number(cx) || 0), 0, CHUNK_COUNT - 1);
    cz = clamp(Math.round(Number(cz) || 0), 0, CHUNK_COUNT - 1);
    var okH = heights && heights.length === COUNT;
    var okP = paints && paints.length === COUNT;
    for (var iz = 0; iz < vps; iz++) {
      var gz = cz * CHUNK_SEGMENTS + iz * step;
      var izH = SEGMENTS - gz;
      for (var ix = 0; ix < vps; ix++) {
        var gx = cx * CHUNK_SEGMENTS + ix * step;
        var k = iz * vps + ix;
        if (okH) h[k] = heights[idx(gx, izH)];
        if (okP) p[k] = paints[idx(gx, izH)];
      }
    }
    neighborLevels = neighborLevels || {};
    function nStepOf(key) {
      var v = neighborLevels[key];
      if (v == null) return step;
      return LOD_STEPS[lodLevelClamped(v)];
    }
    /* Snap 1 mép: s chạy theo đơn vị segment gốc (0..16); đỉnh tại s
       mà s % nStep !== 0 thì nội suy giữa 2 đỉnh thô s0, s1 gần nhất.
       s0/s1 là bội của nStep nên không bao giờ tự bị snap -> đọc h
       gốc tại đó là an toàn. */
    function snapEdge(edge, nStep) {
      if (nStep <= step) return;
      for (var s = step; s < CHUNK_SEGMENTS; s += step) {
        if (s % nStep === 0) continue;
        var s0 = Math.floor(s / nStep) * nStep, s1 = s0 + nStep;
        var f = (s - s0) / nStep;
        var u0 = s0 / step, u1 = s1 / step, u = s / step;
        var k0, k1, k;
        if (edge === 'left') { k0 = u0 * vps; k1 = u1 * vps; k = u * vps; }
        else if (edge === 'right') { k0 = u0 * vps + (vps - 1); k1 = u1 * vps + (vps - 1); k = u * vps + (vps - 1); }
        else if (edge === 'top') { k0 = u0; k1 = u1; k = u; }
        else { k0 = (vps - 1) * vps + u0; k1 = (vps - 1) * vps + u1; k = (vps - 1) * vps + u; }
        h[k] = h[k0] + (h[k1] - h[k0]) * f;
      }
    }
    snapEdge('left', nStepOf('left'));
    snapEdge('right', nStepOf('right'));
    snapEdge('top', nStepOf('top'));
    snapEdge('bottom', nStepOf('bottom'));
    return { segments: segs, vertsPerSide: vps, step: step, level: level, heights: h, paints: p };
  }

  /* paintGridToTexturePlan(paints, size, heights?, opts?): mô tả từng ô của
     texture đất lớn để vẽ canvas mà không cần canvas (test được).
     - size: số ô mỗi cạnh (mặc định SEGMENTS = 64); paints dài (size+1)^2.
     - Ô (x, z) tính theo hàng mặt phẳng/canvas: chất liệu lấy từ đỉnh
       (x, size - z) của paints — cùng phép lật z như rebuildMesh, để
       texture khớp đúng vertex color tại cùng 1 đỉnh.
     - heights (tùy chọn, cùng độ dài paints): ô cao >= snowLine (mặc định
       6, opts.snowLine) và không phải nước thì dùng pattern tuyết (5).
     Trả về {textureSize, cells, cellPx, cellsList:[{x, z, mat, pattern}],
     counts:[số ô mỗi pattern 0..5], error|null}. */
  function paintGridToTexturePlan(paints, size, heights, opts) {
    size = Math.max(1, Math.round(Number(size) || SEGMENTS));
    opts = opts || {};
    var texSize = Math.max(64, Math.round(Number(opts.textureSize) || TEXTURE_SIZE));
    var snowLine = (opts.snowLine == null ? SNOW_LINE : Number(opts.snowLine));
    var plan = { textureSize: texSize, cells: size, cellPx: texSize / size, cellsList: [], counts: [0, 0, 0, 0, 0, 0], error: null };
    if (!paints || paints.length !== (size + 1) * (size + 1)) {
      plan.error = 'paints phải dài ' + ((size + 1) * (size + 1)) + ' (lưới ' + size + '×' + size + ').';
      return plan;
    }
    var stride = size + 1;
    for (var cz = 0; cz < size; cz++) {
      for (var cx = 0; cx < size; cx++) {
        var mat = clamp(Math.round(Number(paints[(size - cz) * stride + cx]) || 0), 0, 4);
        var pattern = mat;
        if (heights && heights.length === paints.length && mat !== 4 &&
            Number(heights[(size - cz) * stride + cx]) >= snowLine) pattern = SNOW_PATTERN;
        plan.cellsList.push({ x: cx, z: cz, mat: mat, pattern: pattern });
        plan.counts[pattern]++;
      }
    }
    return plan;
  }

  /* detectRawGridSize(byteLength): suy lưới N từ kích thước file .raw/.r16
     (bytes/2 phải bằng N×N). Ưu tiên 64/96/128, sau đó mọi số chính phương
     >= 2. Trả về N hoặc null khi không khớp. */
  function detectRawGridSize(byteLength) {
    byteLength = Math.round(Number(byteLength) || 0);
    if (byteLength <= 0 || byteLength % 2 !== 0) return null;
    var n = byteLength / 2;
    var cands = [64, 96, 128];
    for (var i = 0; i < cands.length; i++) if (cands[i] * cands[i] === n) return cands[i];
    var s = Math.sqrt(n);
    if (s === Math.floor(s) && s >= 2) return s;
    return null;
  }

  /* parseRawHeightmap(bytes, gridSize, maxHeight): đọc heightmap .raw/.r16
     (16-bit little-endian, 0..65535) rồi resample về (SEGMENTS+1)^2 đỉnh.
     - bytes: Uint8Array / ArrayBuffer / mảng byte thường.
     - gridSize null/0 = tự suy từ kích thước file (detectRawGridSize).
     - maxHeight: chiều cao ứng với giá trị 65535 (clamp 1..20, mặc định 8).
     Trả về {ok:true, gridSize, heights, min, max, maxHeight} hoặc
     {ok:false, error} với thông báo rõ ràng, không throw, không crash. */
  function parseRawHeightmap(bytes, gridSize, maxHeight) {
    maxHeight = clamp(Number(maxHeight) || 8, 1, 20);
    var arr = null;
    if (bytes && typeof bytes.length === 'number') arr = bytes;
    else if (bytes && typeof bytes.byteLength === 'number') {
      /* ArrayBuffer (kể cả khác realm — instanceof có thể sai trong vm test). */
      try { arr = new Uint8Array(bytes); } catch (e) { arr = null; }
    }
    if (!arr || !arr.length) return { ok: false, error: 'File rỗng, không đọc được dữ liệu.' };
    var n = (gridSize == null || gridSize === 0) ? detectRawGridSize(arr.length) : Math.round(Number(gridSize) || 0);
    if (!n || n < 2) return { ok: false, error: 'Không suy ra được kích thước lưới từ file (' + arr.length + ' byte). File .raw/.r16 phải có đúng N×N×2 byte với N = 64, 96 hoặc 128.' };
    var expected = n * n * 2;
    if (arr.length !== expected) return { ok: false, error: 'File có ' + arr.length + ' byte (' + (arr.length / 2) + ' giá trị 16-bit), nhưng lưới ' + n + '×' + n + ' cần ' + expected + ' byte. Chọn đúng kích thước lưới hoặc dùng file khác.' };
    var min = 65535, max = 0;
    for (var k = 0; k < n * n; k++) {
      var v0 = (arr[k * 2] | (arr[k * 2 + 1] << 8)) >>> 0;
      if (v0 < min) min = v0;
      if (v0 > max) max = v0;
    }
    var heights = new Array(COUNT);
    for (var iz = 0; iz < VERTS_PER_SIDE; iz++) {
      var py = Math.round(iz / SEGMENTS * (n - 1));
      for (var ix = 0; ix < VERTS_PER_SIDE; ix++) {
        var px = Math.round(ix / SEGMENTS * (n - 1));
        var kk = py * n + px;
        var v = (arr[kk * 2] | (arr[kk * 2 + 1] << 8)) >>> 0;
        heights[iz * VERTS_PER_SIDE + ix] = (v / 65535) * maxHeight;
      }
    }
    return { ok: true, gridSize: n, heights: heights, min: min, max: max, maxHeight: maxHeight };
  }

  /* erodeStep(heights, segments, opts): 1 đợt xói mòn thủy lực giọt nước
     (thuần, trả về mảng heights MỚI, không sửa mảng gốc).
     Mỗi giọt: xuất phát ngẫu nhiên (seed cố định, mặc định 1337), chảy
     theo độ dốc (gradient + quán tính), xói đất ở chỗ dốc (chuyển thành
     trầm tích mang theo) và lắng đọng ở chỗ bằng/dốc lên hoặc khi quá tải.
     opts: {droplets (mặc định 1000), strength 0..5 (mặc định 1),
     seed (mặc định 1337), lifetime (mặc định 30 bước/giọt)}.
     heights sai độ dài -> trả về mảng 0 đúng độ dài (như edTerrainErode). */
  function erodeStep(heights, segments, opts) {
    segments = Math.max(1, Math.round(Number(segments) || SEGMENTS));
    opts = opts || {};
    var side = segments + 1;
    var n = side * side;
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = 0;
    if (!heights || heights.length !== n) return out;
    for (var j = 0; j < n; j++) out[j] = heights[j];
    var droplets = (opts.droplets == null ? 1000 : clamp(Math.round(Number(opts.droplets) || 0), 0, 100000));
    var strength = (opts.strength == null ? 1 : clamp(Number(opts.strength) || 0, 0, 5));
    var lifetime = clamp(Math.round(Number(opts.lifetime) || 30), 1, 200);
    var seed = (opts.seed == null ? 1337 : (Number(opts.seed) || 0));
    var inertia = 0.05, capacityFactor = 4, depositSpeed = 0.3, erodeSpeed = 0.3, evaporate = 0.01, gravity = 1;
    if (droplets === 0 || strength === 0) return out;
    var rand = mulberry32(seed);
    /* Chiều cao nội suy song tuyến tại (x, z) thực, clamp biên. */
    function hAt(x, z) {
      if (x < 0) x = 0; if (x > segments) x = segments;
      if (z < 0) z = 0; if (z > segments) z = segments;
      var x0 = Math.floor(x), z0 = Math.floor(z);
      if (x0 >= segments) x0 = segments - 1;
      if (z0 >= segments) z0 = segments - 1;
      var fx = x - x0, fz = z - z0;
      var h00 = out[z0 * side + x0], h10 = out[z0 * side + x0 + 1];
      var h01 = out[(z0 + 1) * side + x0], h11 = out[(z0 + 1) * side + x0 + 1];
      return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
    }
    /* Cộng amount vào 4 đỉnh quanh (x, z) theo trọng số song tuyến. */
    function addAt(x, z, amount) {
      var x0 = Math.floor(x), z0 = Math.floor(z);
      if (x0 < 0) x0 = 0; if (z0 < 0) z0 = 0;
      if (x0 >= segments) x0 = segments - 1;
      if (z0 >= segments) z0 = segments - 1;
      var fx = x - x0, fz = z - z0;
      out[z0 * side + x0] += amount * (1 - fx) * (1 - fz);
      out[z0 * side + x0 + 1] += amount * fx * (1 - fz);
      out[(z0 + 1) * side + x0] += amount * (1 - fx) * fz;
      out[(z0 + 1) * side + x0 + 1] += amount * fx * fz;
    }
    for (var d = 0; d < droplets; d++) {
      var px = rand() * segments, pz = rand() * segments;
      var dx = 0, dz = 0, water = 1, sediment = 0, speed = 1;
      for (var step = 0; step < lifetime; step++) {
        var h0 = hAt(px, pz);
        var gx = hAt(px + 1, pz) - hAt(px - 1, pz);
        var gz = hAt(px, pz + 1) - hAt(px, pz - 1);
        dx = dx * inertia - gx * (1 - inertia);
        dz = dz * inertia - gz * (1 - inertia);
        var len = Math.sqrt(dx * dx + dz * dz);
        if (len < 1e-4) {
          dx = rand() - 0.5; dz = rand() - 0.5;
          len = Math.sqrt(dx * dx + dz * dz);
          if (len < 1e-4) break;
        }
        dx /= len; dz /= len;
        var nx = px + dx, nz = pz + dz;
        if (nx < 0 || nx > segments || nz < 0 || nz > segments) break;
        var h1 = hAt(nx, nz);
        var dh = h1 - h0;
        var capacity = Math.max(-dh, 0.01) * speed * water * capacityFactor;
        if (dh > 0) {
          var depUp = Math.min(dh, sediment) * strength;
          if (depUp > 0) { addAt(px, pz, depUp); sediment -= depUp; }
        } else if (sediment > capacity) {
          var dep = (sediment - capacity) * depositSpeed * strength;
          if (dep > 0) { addAt(px, pz, dep); sediment -= dep; }
        } else {
          var ero = Math.min((capacity - sediment) * erodeSpeed, -dh) * strength;
          if (ero > 0) { addAt(px, pz, -ero); sediment += ero; }
        }
        speed = Math.sqrt(Math.max(0, speed * speed + (-dh) * gravity));
        water *= (1 - evaporate);
        px = nx; pz = nz;
      }
    }
    return out;
  }

  /* ---- Logic thuần đợt 5: bản đồ dòng chảy + xói mòn theo dòng chảy. ----
     Không random, deterministic hoàn toàn (hòa hướng dốc phá theo thứ
     tự hướng D8 cố định + sắp xếp cao->thấp phá theo index). */

  /* 8 hướng kề D8: [dx, dz], thứ tự cố định. dir[i] = chỉ số hướng
     chảy của ô i (dốc nhất xuống) hoặc -1 nếu ô trũng/phẳng. */
  var FLOW_DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  /* edTerrainFlowMap(heights, size): bản đồ dòng chảy tích lũy (D8).
     - size: số segment mỗi cạnh (mặc định SEGMENTS); heights dài
       (size+1)^2, sai độ dài -> flow toàn 1, dir toàn -1.
     - Mỗi ô bắt đầu với 1 đơn vị nước của chính nó; xử lý ô cao
       trước, đổ toàn bộ flow của ô đó xuống ô đích (hướng dốc nhất).
     Trả về {flow: [tổng nước chảy qua mỗi ô, tính cả nước của ô đó],
     dir: [hướng chảy 0..7 hoặc -1]}. */
  function edTerrainFlowMap(heights, size) {
    size = Math.max(1, Math.round(Number(size) || SEGMENTS));
    var side = size + 1, n = side * side;
    var flow = new Array(n), dir = new Array(n);
    for (var i = 0; i < n; i++) { flow[i] = 1; dir[i] = -1; }
    if (!heights || heights.length !== n) return { flow: flow, dir: dir };
    for (var iz = 0; iz < side; iz++) {
      for (var ix = 0; ix < side; ix++) {
        var i0 = iz * side + ix, h0 = heights[i0], best = -1, bestSlope = 0;
        for (var d = 0; d < 8; d++) {
          var nx = ix + FLOW_DIRS[d][0], nz = iz + FLOW_DIRS[d][1];
          if (nx < 0 || nx > size || nz < 0 || nz > size) continue;
          var dh = h0 - heights[nz * side + nx];
          if (dh <= 0) continue;
          var dist = (FLOW_DIRS[d][0] !== 0 && FLOW_DIRS[d][1] !== 0) ? Math.SQRT2 : 1;
          var slope = dh / dist;
          if (slope > bestSlope) { bestSlope = slope; best = d; }
        }
        dir[i0] = best;
      }
    }
    var order = new Array(n);
    for (var k = 0; k < n; k++) order[k] = k;
    order.sort(function (a, b) { return (heights[b] - heights[a]) || (a - b); });
    for (var o = 0; o < n; o++) {
      var cell = order[o], dd = dir[cell];
      if (dd < 0) continue;
      var cx2 = cell % side, cz2 = Math.floor(cell / side);
      var tx = cx2 + FLOW_DIRS[dd][0], tz = cz2 + FLOW_DIRS[dd][1];
      flow[tz * side + tx] += flow[cell];
    }
    return { flow: flow, dir: dir };
  }

  /* edTerrainErodeFlow(heights, size, opts): 1 lượt xói mòn theo bản đồ
     dòng chảy, trả về mảng heights MỚI (không sửa mảng gốc).
     - Ô có dòng chảy lớn (w ~ 1, w = log(1+flow)/log(1+maxFlow)) và
       dốc thì xói mạnh -> tạo rãnh dọc dốc; ô flow nhỏ xói ít.
     - Ô trũng/phẳng (dir = -1, không có hướng chảy) thì lắng đọng,
       mạnh hơn khi dòng chảy tới lớn.
     - Đất phẳng hoàn toàn (maxFlow = 1, không có dòng chảy) thì không
       đổi gì.
     opts: {strength 0..5 (mặc định 1), erodeRate 0..1 (mặc định 0.1),
     depositRate 0..1 (mặc định 0.05)}. heights sai độ dài -> mảng 0. */
  function edTerrainErodeFlow(heights, size, opts) {
    size = Math.max(1, Math.round(Number(size) || SEGMENTS));
    var side = size + 1, n = side * side;
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = 0;
    if (!heights || heights.length !== n) return out;
    for (var j = 0; j < n; j++) out[j] = heights[j];
    opts = opts || {};
    var strength = (opts.strength == null ? 1 : clamp(Number(opts.strength) || 0, 0, 5));
    var erodeRate = (opts.erodeRate == null ? 0.1 : clamp(Number(opts.erodeRate) || 0, 0, 1));
    var depositRate = (opts.depositRate == null ? 0.05 : clamp(Number(opts.depositRate) || 0, 0, 1));
    if (strength === 0) return out;
    var fm = edTerrainFlowMap(heights, size);
    var maxFlow = 1;
    for (var k = 0; k < n; k++) if (fm.flow[k] > maxFlow) maxFlow = fm.flow[k];
    if (maxFlow <= 1) return out; // phẳng: không có dòng chảy
    var logMax = Math.log(1 + maxFlow);
    for (var iz = 0; iz < side; iz++) {
      for (var ix = 0; ix < side; ix++) {
        var i0 = iz * side + ix;
        var w = Math.log(1 + fm.flow[i0]) / logMax; // 0..1
        var d = fm.dir[i0];
        if (d === -1) {
          out[i0] += strength * depositRate * (0.5 + 0.5 * w);
        } else {
          var nx = ix + FLOW_DIRS[d][0], nz = iz + FLOW_DIRS[d][1];
          var descent = heights[i0] - heights[nz * side + nx]; // >= 0
          var slopeF = clamp(descent / 1, 0, 1);
          out[i0] -= strength * erodeRate * w * (0.25 + 0.75 * slopeF);
        }
      }
    }
    return out;
  }

  /* ---- Logic thuần đợt 6: regions / spline / scatter. ----
     Mọi hàm ở đây đều thuần (không DOM/THREE) để test Node bằng vm. */

  /* 5 preset môi trường có sẵn (khớp 05-environment.js PRESETS). */
  var REGION_PRESETS = ['thanh-co', 'rung-truc', 'nui-tuyet', 'chua', 'vo-dai'];
  var PRESET_NAMES = { 'thanh-co': 'Thành cổ', 'rung-truc': 'Rừng trúc', 'nui-tuyet': 'Núi tuyết', 'chua': 'Chùa', 'vo-dai': 'Võ đài' };
  var SPLINE_KINDS = ['road', 'river', 'fence'];
  var SPLINE_NAMES = { road: 'Đường đi', river: 'Sông', fence: 'Hàng rào' };
  var SCATTER_KINDS = ['tree', 'rock', 'grass'];
  var SCATTER_NAMES = { tree: 'Cây', rock: 'Đá', grass: 'Cỏ' };

  /* regionAt(regions, x, z): vùng chứa điểm (x, z), hoặc null.
     Ô nào trùng nhiều vùng thì lấy vùng thêm SAU CÙNG (duyệt hết,
     vùng sau ghi đè vùng trước). Bounds không cần xếp sẵn (tự min/max). */
  function regionAt(regions, x, z) {
    if (!regions || !regions.length) return null;
    x = Number(x); z = Number(z);
    if (!isFinite(x) || !isFinite(z)) return null;
    var found = null;
    for (var i = 0; i < regions.length; i++) {
      var r = regions[i];
      if (!r) continue;
      var x0 = Number(r.x0), x1 = Number(r.x1), z0 = Number(r.z0), z1 = Number(r.z1);
      if (!isFinite(x0) || !isFinite(x1) || !isFinite(z0) || !isFinite(z1)) continue;
      var loX = Math.min(x0, x1), hiX = Math.max(x0, x1);
      var loZ = Math.min(z0, z1), hiZ = Math.max(z0, z1);
      if (x >= loX && x <= hiX && z >= loZ && z <= hiZ) found = r;
    }
    return found;
  }

  /* Đổi lưới <-> thế giới với size/segments tường minh (bản thuần của
     worldToGrid/gridToWorld, để hàm thuần đợt 6 không phụ thuộc SIZE
     nội bộ — test được với mọi size). */
  function worldToGridSize(x, z, segments, size) {
    return { gx: (x + size / 2) / size * segments, gz: (z + size / 2) / size * segments };
  }
  function gridToWorldSize(gx, gz, segments, size) {
    return { x: gx / segments * size - size / 2, z: gz / segments * size - size / 2 };
  }
  /* Nội suy song tuyến trên mảng heights với size/segments tường minh
     (bản thuần của heightAtArray). heights sai độ dài -> 0. */
  function bilinearHeightSize(heights, segments, size, x, z) {
    var side = segments + 1;
    if (!heights || heights.length !== side * side) return 0;
    var g = worldToGridSize(clamp(x, -size / 2, size / 2), clamp(z, -size / 2, size / 2), segments, size);
    var x0 = clamp(Math.floor(g.gx), 0, segments - 1), z0 = clamp(Math.floor(g.gz), 0, segments - 1);
    var fx = g.gx - x0, fz = g.gz - z0;
    var h00 = heights[z0 * side + x0], h10 = heights[z0 * side + x0 + 1];
    var h01 = heights[(z0 + 1) * side + x0], h11 = heights[(z0 + 1) * side + x0 + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /* splineNearestPoint(points, x, z): điểm gần nhất trên đường gấp khúc
     points [[x,z],...] tới (x, z). Trả {dist, px, pz} hoặc null khi
     points < 2 điểm. Thuần. */
  function splineNearestPoint(points, x, z) {
    if (!points || points.length < 2) return null;
    var best = null, bestD2 = Infinity;
    for (var i = 0; i < points.length - 1; i++) {
      var ax = Number(points[i][0]) || 0, az = Number(points[i][1]) || 0;
      var bx = Number(points[i + 1][0]) || 0, bz = Number(points[i + 1][1]) || 0;
      var abx = bx - ax, abz = bz - az;
      var len2 = abx * abx + abz * abz;
      var t = 0;
      if (len2 > 0) t = clamp(((x - ax) * abx + (z - az) * abz) / len2, 0, 1);
      var px = ax + abx * t, pz = az + abz * t;
      var dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = { dist: Math.sqrt(d2), px: px, pz: pz }; }
    }
    return best;
  }

  /* splineFlatten(heights, size, points, width): làm phẳng địa hình dọc
     spline — trả về mảng heights MỚI, KHÔNG sửa mảng gốc.
     - size: kích thước map theo đơn vị thế giới (96/128/192); số
       segment suy từ độ dài heights ((side-1), thường 64).
     - Mỗi đỉnh lưới gần spline (trong width/2 + vùng chuyển tiếp) được
       nội suy chiều cao về cao độ tại điểm spline gần nhất (lấy bằng
       nội suy song tuyến trên heights gốc): trong width/2 thì phẳng
       hẳn (f=1), ngoài đó f giảm mượt (smoothstep) về 0 ở
       width/2 + max(1, width/2).
     - points < 2 hoặc heights sai độ dài -> trả bản sao heights. */
  function splineFlatten(heights, size, points, width) {
    size = (size == null ? SIZE : Number(size));
    if (!isFinite(size) || size <= 0) size = SIZE;
    if (!heights || !heights.length) return [];
    var side = Math.round(Math.sqrt(heights.length));
    if (side * side !== heights.length || side < 2) return heights.slice();
    var segments = side - 1;
    var out = heights.slice();
    if (!points || points.length < 2) return out;
    width = clamp(Number(width) || 2, 0.5, 20);
    var half = width / 2, fall = Math.max(1, half);
    for (var iz = 0; iz < side; iz++) {
      for (var ix = 0; ix < side; ix++) {
        var w = gridToWorldSize(ix, iz, segments, size);
        var near = splineNearestPoint(points, w.x, w.z);
        if (!near || near.dist > half + fall) continue;
        var target = bilinearHeightSize(heights, segments, size, near.px, near.pz);
        var f = (near.dist <= half) ? 1 : 1 - smoothstep((near.dist - half) / fall);
        var k = iz * side + ix;
        out[k] = out[k] + (target - out[k]) * f;
      }
    }
    return out;
  }

  /* roadCells(points, width, size): các ô lưới [gx, gz] dọc spline
     (lưới SEGMENTS×SEGMENTS, gx/gz 0..64) — để tô paint đường + để
     harness test. Ô được tính khi tâm ô nằm trong width/2 của 1 điểm
     mẫu trên spline (mẫu dày cell/2 nên dải phủ kín, không thủng lỗ).
     Trả danh sách không trùng, theo thứ tự dọc spline. */
  function roadCells(points, width, size) {
    var out = [], seen = {};
    if (!points || points.length < 2) return out;
    size = (size == null ? SIZE : Number(size));
    if (!isFinite(size) || size <= 0) size = SIZE;
    width = clamp(Number(width) || 2, 0.5, 20);
    var half = width / 2;
    var cell = size / SEGMENTS; // đơn vị thế giới / ô lưới
    var stepLen = cell / 2;
    function mark(x, z) {
      var g = worldToGridSize(x, z, SEGMENTS, size);
      var cgx = Math.round(g.gx), cgz = Math.round(g.gz);
      var r = Math.ceil(half / cell) + 1;
      for (var dz = -r; dz <= r; dz++) {
        for (var dx = -r; dx <= r; dx++) {
          var gx = cgx + dx, gz = cgz + dz;
          if (gx < 0 || gx > SEGMENTS || gz < 0 || gz > SEGMENTS) continue;
          var w = gridToWorldSize(gx, gz, SEGMENTS, size);
          var ddx = w.x - x, ddz = w.z - z;
          if (Math.sqrt(ddx * ddx + ddz * ddz) <= half + 0.001) {
            var key = gx + ',' + gz;
            if (!seen[key]) { seen[key] = true; out.push([gx, gz]); }
          }
        }
      }
    }
    for (var i = 0; i < points.length - 1; i++) {
      var ax = Number(points[i][0]) || 0, az = Number(points[i][1]) || 0;
      var bx = Number(points[i + 1][0]) || 0, bz = Number(points[i + 1][1]) || 0;
      var len = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
      var n = Math.max(1, Math.ceil(len / stepLen));
      for (var k = 0; k <= n; k++) mark(ax + (bx - ax) * k / n, az + (bz - az) * k / n);
    }
    return out;
  }

  /* extendRiverToWater(paints, points, size): sông tự nối tới ô nước.
     Xét 2 đầu mút: đầu nào có ô paint nước (4) gần nhất trong 3 ô
     lưới thì nối dài tới tâm ô nước đó (chèn vào đầu/cuối). Không sửa
     points gốc. Trả {points, snapped, ends:['start'|'end'...]}. */
  function extendRiverToWater(paints, points, size) {
    var empty = { points: points ? points.slice() : [], snapped: false, ends: [] };
    if (!paints || !points || points.length < 2) return empty;
    size = (size == null ? SIZE : Number(size));
    if (!isFinite(size) || size <= 0) size = SIZE;
    function nearestWater(x, z, maxCells) {
      var g = worldToGridSize(x, z, SEGMENTS, size);
      var cgx = Math.round(g.gx), cgz = Math.round(g.gz);
      var best = null, bestD2 = Infinity;
      for (var dz = -maxCells; dz <= maxCells; dz++) {
        for (var dx = -maxCells; dx <= maxCells; dx++) {
          var gx = cgx + dx, gz = cgz + dz;
          if (gx < 0 || gx > SEGMENTS || gz < 0 || gz > SEGMENTS) continue;
          if (paints[gz * (SEGMENTS + 1) + gx] !== 4) continue;
          var d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = { gx: gx, gz: gz }; }
        }
      }
      if (!best) return null;
      var w = gridToWorldSize(best.gx, best.gz, SEGMENTS, size);
      return [w.x, w.z];
    }
    var pts = points.map(function (p) { return [Number(p[0]) || 0, Number(p[1]) || 0]; });
    var snapped = false, ends = [];
    var s0 = nearestWater(pts[0][0], pts[0][1], 3);
    if (s0) { pts.unshift(s0); snapped = true; ends.push('start'); }
    var s1 = nearestWater(pts[pts.length - 1][0], pts[pts.length - 1][1], 3);
    if (s1) { pts.push(s1); snapped = true; ends.push('end'); }
    return { points: pts, snapped: snapped, ends: ends };
  }

  /* resamplePolyline(points, maxStep): chèn điểm dọc đường gấp khúc sao
     cho mỗi đoạn <= maxStep (mặc định 1.5) — để ribbon/cọc bám sát địa
     hình. Thuần, không sửa points gốc. */
  function resamplePolyline(points, maxStep) {
    var out = [];
    if (!points || !points.length) return out;
    maxStep = Math.max(0.5, Number(maxStep) || 1.5);
    out.push([Number(points[0][0]) || 0, Number(points[0][1]) || 0]);
    for (var i = 0; i < points.length - 1; i++) {
      var ax = Number(points[i][0]) || 0, az = Number(points[i][1]) || 0;
      var bx = Number(points[i + 1][0]) || 0, bz = Number(points[i + 1][1]) || 0;
      var dx = bx - ax, dz = bz - az;
      var len = Math.sqrt(dx * dx + dz * dz);
      var n = Math.max(1, Math.ceil(len / maxStep));
      for (var k = 1; k <= n; k++) out.push([ax + dx * k / n, az + dz * k / n]);
    }
    return out;
  }

  /* scatterPositions(seed, count, cx, cz, radius): vị trí rải deterministic
     (mulberry32 đã có trong file; cùng seed+tham số -> y hệt vị trí).
     Phân bố đều trong đĩa (r = radius*sqrt(rand)). */
  function scatterPositions(seed, count, cx, cz, radius) {
    count = clamp(Math.round(Number(count) || 0), 0, 1000);
    radius = Math.max(0, Number(radius) || 0);
    cx = Number(cx) || 0; cz = Number(cz) || 0;
    var rng = mulberry32(seed);
    var out = [];
    for (var i = 0; i < count; i++) {
      var a = rng() * Math.PI * 2;
      var r = radius * Math.sqrt(rng());
      out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    return out;
  }

  /* scatterStrokeCount(density, radius): số object 1 nhát cọ rải.
     density (slider 1–50) hiểu là số cây/10 m²: count =
     round(density × π r² / 10), kẹp 1..200/nhát. Thuần. */
  function scatterStrokeCount(density, radius) {
    density = clamp(Number(density) || 1, 1, 50);
    radius = Math.max(0.5, Number(radius) || 4);
    return clamp(Math.round(density * Math.PI * radius * radius / 10), 1, 200);
  }

  /* ---- Logic thuần đợt 2: heightmap import + erosion. ----
     edTerrainHeightsFromPixels(pixels, w, h, segments, maxHeight):
     pixels là mảng grayscale 0–255 (độ dài w*h) hoặc RGBA (độ dài
     w*h*4, lấy kênh R). Map từng pixel vào lưới (segments+1)^2 đỉnh
     bằng nội suy gần nhất; độ cao = (v/255) * maxHeight.
     Hàng ảnh 0 (trên cùng) -> iz = 0 (z = -SIZE/2, phía Bắc map).
     Trả về mảng heights mới, không sửa pixels. */
  function edTerrainHeightsFromPixels(pixels, w, h, segments, maxHeight) {
    segments = Math.max(1, Math.round(Number(segments) || SEGMENTS));
    maxHeight = Math.max(0, Number(maxHeight) || 0);
    var n = (segments + 1) * (segments + 1);
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = 0;
    w = Math.round(Number(w) || 0);
    h = Math.round(Number(h) || 0);
    if (!pixels || !pixels.length || w < 1 || h < 1 || maxHeight === 0) return out;
    var isRGBA = pixels.length >= w * h * 4;
    var side = segments + 1;
    for (var iz = 0; iz < side; iz++) {
      var py = Math.round(iz / segments * (h - 1));
      if (py < 0) py = 0; if (py > h - 1) py = h - 1;
      for (var ix = 0; ix < side; ix++) {
        var px = Math.round(ix / segments * (w - 1));
        if (px < 0) px = 0; if (px > w - 1) px = w - 1;
        var v = isRGBA ? pixels[(py * w + px) * 4] : pixels[py * w + px];
        v = clamp(Number(v) || 0, 0, 255);
        out[iz * side + ix] = (v / 255) * maxHeight;
      }
    }
    return out;
  }

  /* edTerrainErode(heights, segments, iterations, talus, rate): xói mòn
     đơn giản. Mỗi lượt xét mỗi cặp đỉnh kề nhau 1 lần (phải + dưới, để
     không chuyển 2 lần/cặp): nếu chênh lệch > talus thì chuyển
     rate * (chênh lệch - talus) từ đỉnh cao sang đỉnh thấp.
     Mặc định talus 0.6, rate 0.25, iterations 5. Tính trên bản sao của
     lượt đó (không nhiễm chéo trong cùng 1 lượt). Trả về mảng mới. */
  function edTerrainErode(heights, segments, iterations, talus, rate) {
    segments = Math.max(1, Math.round(Number(segments) || SEGMENTS));
    iterations = clamp(Math.round(Number(iterations) || 0), 0, 100);
    talus = Math.max(0, (talus == null ? 0.6 : Number(talus)) || 0);
    rate = clamp((rate == null ? 0.25 : Number(rate)) || 0, 0, 1);
    var side = segments + 1;
    var cur = (heights && heights.length === side * side) ? heights.slice() : null;
    if (!cur) {
      cur = new Array(side * side);
      for (var k = 0; k < cur.length; k++) cur[k] = 0;
      return cur;
    }
    for (var it = 0; it < iterations; it++) {
      var src = cur.slice();
      var dst = cur.slice();
      for (var iz = 0; iz < side; iz++) {
        for (var ix = 0; ix < side; ix++) {
          var a = src[iz * side + ix];
          /* Cặp phải (ix+1) và cặp dưới (iz+1): mỗi cặp xét đúng 1 lần. */
          if (ix < segments) {
            var bR = src[iz * side + ix + 1];
            var dR = a - bR;
            if (Math.abs(dR) > talus) {
              var moveR = (Math.abs(dR) - talus) * rate;
              if (dR > 0) { dst[iz * side + ix] -= moveR; dst[iz * side + ix + 1] += moveR; }
              else { dst[iz * side + ix] += moveR; dst[iz * side + ix + 1] -= moveR; }
            }
          }
          if (iz < segments) {
            var bD = src[(iz + 1) * side + ix];
            var dD = a - bD;
            if (Math.abs(dD) > talus) {
              var moveD = (Math.abs(dD) - talus) * rate;
              if (dD > 0) { dst[iz * side + ix] -= moveD; dst[(iz + 1) * side + ix] += moveD; }
              else { dst[iz * side + ix] += moveD; dst[(iz + 1) * side + ix] -= moveD; }
            }
          }
        }
      }
      cur = dst;
    }
    return cur;
  }

  /* ---- API theo DESIGN.md: thao tác trên state + đồng bộ project. ---- */
  function getHeights() { return _heights; }
  function getPaints() { return _paints; }
  function setHeights(a) { if (a && a.length === COUNT) _heights = a; }
  function setPaints(a) { if (a && a.length === COUNT) _paints = a; }
  function heightAt(x, z) { return heightAtArray(_heights, x, z); }

  /* Báo viewport vẽ lại mesh terrain của nó (nhóm A giữ syncTerrain —
     mesh terrain thật do viewport dựng từ project.terrain). */
  function refreshViewportTerrain() {
    if (ED.Viewport && typeof ED.Viewport.syncTerrain === 'function') {
      try { ED.Viewport.syncTerrain(); } catch (e) {}
    }
  }
  function applyBrush(cx, cz, mode, size, strength, falloff) {
    var n = brushHeights(_heights, cx, cz, mode, size, strength, falloff);
    if (n > 0) { _groundTextureDirty = true; syncToProject(); markDirtyPush(); endStroke('Terrain: ' + mode); rebuildMesh(); refreshViewportTerrain(); }
    return n;
  }
  function paintAt(cx, cz, mat, size) {
    var n = paintHeights(_paints, cx, cz, mat, size);
    if (n > 0) { _groundTextureDirty = true; syncToProject(); markDirtyPush(); endStroke('Terrain: tô ' + PAINT_NAMES[mat]); rebuildMesh(); refreshViewportTerrain(); }
    return n;
  }
  /* markDirty + pushHistory gộp: applyBrush/paintAt là dạng "1 lần" (click)
     nên push luôn 1 history. Trong lúc kéo chuột, viewport gọi
     applyBrushLive()/paintLive() (không push) rồi endStroke() khi thả. */
  function markDirtyPush() {
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
  }
  /* Dùng trong lúc kéo brush: đổi heights + vẽ lại, KHÔNG push history. */
  function applyBrushLive(cx, cz, mode, size, strength, falloff) {
    var n = brushHeights(_heights, cx, cz, mode, size, strength, falloff);
    if (n > 0) { syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain(); }
    return n;
  }
  function paintLive(cx, cz, mat, size) {
    var n = paintHeights(_paints, cx, cz, mat, size);
    if (n > 0) { _groundTextureDirty = true; syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain(); }
    return n;
  }
  /* Kết thúc 1 stroke kéo: push 1 history duy nhất cho cả stroke. */
  function endStroke(label) {
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(label || 'Terrain');
  }

  /* ---- Đợt 2: heightmap import + erosion trên state. ----
     pushHistory TRƯỚC khi đổi (snapshot trước thay đổi, đúng pattern nút
     'San phẳng toàn map' trong file này). */
  var _maxHeight = 8;        // độ cao tối đa khi nhập heightmap (slider 1–20)
  var _erodeIterations = 5;  // số lượt xói mòn (slider 1–20)

  /* ---- Đợt 4: state texture/chunk/.raw/xói mòn giọt. ---- */
  var _chunks = [];               // [{cx, cz, mesh}] — 16 chunk mesh riêng
  var _useGroundTexture = false;  // bật: dùng texture đất; tắt: vertex color
  var _groundTexture = null;      // THREE.CanvasTexture (cache)
  var _groundTextureDirty = true; // true khi paints/heights đổi
  var _groundPatterns = null;     // [canvas 128×128 x6] cache, chỉ browser
  var _rawGridSize = 0;           // 0 = tự động theo file; 64/96/128
  var _hydro = { droplets: 2000, strength: 1 }; // slider xói mòn thủy lực
  var _erodeJob = null;           // job xói mòn bất đồng bộ đang chạy
  /* ---- Đợt 5: state LOD + xói mòn dòng chảy (chỉ sống trong phiên,
     KHÔNG lưu vào project JSON). ---- */
  var _lodLevels = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 16 chunk, index cz*4+cx
  var _lodThresholds = { near: LOD_DEFAULT_NEAR, far: LOD_DEFAULT_FAR };
  var _flowJob = null;            // job xói mòn dòng chảy đang chạy
  var _flowSettings = { passes: 5, strength: 1 }; // slider xói mòn dòng chảy
  /* ---- Đợt 6: state regions / spline / scatter. regions lưu trong
     project.terrain.regions; còn lại chỉ sống trong phiên. ---- */
  var _regions = [];              // [{id,name,x0,z0,x1,z1,preset}]
  var _regionCounter = 0;
  var _autoSwitchRegion = false;  // tự đổi preset khi camera vào vùng
  var _lastAutoRegionId = null;
  var _riverMeshes = [];          // [{id, mesh, flowOffset}] cho tick()
  var _groundMode = null;         // {kind:'region'|'spline'|'scatter'} | null
  var _regionPick = { step: 0, corner1: null, corner2: null };
  var _splineDraft = null;        // {kind, points:[[x,z]..], width}
  var _splineSettings = { kind: 'road', width: 2 };
  var _scatterSettings = { kind: 'tree', radius: 4, density: 10, seed: 1 };
  var _lastSplineClick = 0;
  var _badge = null;              // badge tên vùng góc viewport
  var _badgeTimer = null;
  var _keyBound = false;
  function getHeightmapMax() { return _maxHeight; }
  function setHeightmapMax(v) { v = Number(v); _maxHeight = clamp(isFinite(v) ? v : 8, 1, 20); return _maxHeight; }
  function getErodeIterations() { return _erodeIterations; }
  function setErodeIterations(v) { v = Math.round(Number(v)); _erodeIterations = clamp(isFinite(v) ? v : 5, 1, 20); return _erodeIterations; }
  /* pixels/w/h như edTerrainHeightsFromPixels; maxHeight lấy slider nếu
     không truyền. Trả về true khi đã áp dụng. */
  function importHeightmap(pixels, w, h, maxHeight) {
    var mh = (maxHeight == null ? _maxHeight : clamp(Number(maxHeight) || 8, 1, 20));
    var nh = edTerrainHeightsFromPixels(pixels, w, h, SEGMENTS, mh);
    if (!nh || nh.length !== COUNT) return false;
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: nhập heightmap');
    _heights = nh;
    _groundTextureDirty = true;
    syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain();
    return true;
  }
  /* Xói mòn N lượt trên heights hiện tại. Trả về true khi đã áp dụng. */
  function erode(iterations) {
    var n = (iterations == null ? _erodeIterations : clamp(Math.round(Number(iterations) || 5), 1, 20));
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: xói mòn x' + n);
    _heights = edTerrainErode(_heights, SEGMENTS, n, 0.6, 0.25);
    _groundTextureDirty = true;
    syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain();
    return true;
  }

  /* ---- Đợt 4: import .raw/.r16 + xói mòn giọt nước trên state. ---- */
  function getRawGridSize() { return _rawGridSize; }
  function setRawGridSize(v) {
    v = Math.round(Number(v) || 0);
    _rawGridSize = (v === 64 || v === 96 || v === 128) ? v : 0;
    return _rawGridSize;
  }
  function getHydroSettings() { return { droplets: _hydro.droplets, strength: _hydro.strength }; }
  function setHydroSettings(partial) {
    if (!partial) return getHydroSettings();
    if (partial.droplets != null) _hydro.droplets = clamp(Math.round(Number(partial.droplets) || 2000), 500, 10000);
    if (partial.strength != null) _hydro.strength = clamp(Number(partial.strength) || 1, 0.1, 2);
    return getHydroSettings();
  }
  /* bytes: Uint8Array/ArrayBuffer/mảng byte; gridSize null = lấy _rawGridSize
     (0 = tự suy). Trả về kết quả của parseRawHeightmap ({ok, error?}).
     Lỗi file chỉ trả về, không throw, không đổi địa hình. */
  function importRawHeightmap(bytes, gridSize, maxHeight) {
    var mh = (maxHeight == null ? _maxHeight : clamp(Number(maxHeight) || 8, 1, 20));
    var gs = (gridSize == null ? _rawGridSize : gridSize);
    var res = parseRawHeightmap(bytes, gs, mh);
    if (!res.ok) return res;
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: nhập heightmap .raw ' + res.gridSize + '×' + res.gridSize);
    _heights = res.heights;
    _groundTextureDirty = true;
    syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain();
    return res;
  }
  /* Xói mòn thủy lực bất đồng bộ: chạy từng đợt 500 giọt bằng setTimeout
     (không khoá UI), onProgress(done, total), onDone({cancelled, done}).
     pushHistory chụp TRƯỚC khi chạy; địa hình chỉ áp dụng 1 lần khi xong
     (hủy giữa chừng thì địa hình giữ nguyên). Trả về job {cancelled, timer, total}. */
  function erodeDropletsAsync(totalDroplets, strength, onProgress, onDone) {
    var total = clamp(Math.round(Number(totalDroplets) || 2000), 500, 10000);
    var str = clamp(Number(strength) || 1, 0.1, 2);
    cancelErodeDroplets();
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: xói mòn thủy lực');
    var base = _heights.slice();
    var done = 0;
    var job = { cancelled: false, timer: null, total: total };
    var BATCH = 500;
    function tick() {
      if (job.cancelled) {
        if (typeof onDone === 'function') { try { onDone({ cancelled: true, done: done }); } catch (e) {} }
        return;
      }
      var n = Math.min(BATCH, total - done);
      base = erodeStep(base, SEGMENTS, { droplets: n, strength: str, seed: 1337 + done });
      done += n;
      if (typeof onProgress === 'function') { try { onProgress(done, total); } catch (e) {} }
      if (done < total) {
        job.timer = setTimeout(tick, 0);
      } else {
        _heights = base;
        _groundTextureDirty = true;
        syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain();
        _erodeJob = null;
        if (typeof onDone === 'function') { try { onDone({ cancelled: false, done: done }); } catch (e) {} }
      }
    }
    _erodeJob = job;
    job.timer = setTimeout(tick, 0);
    return job;
  }
  /* Hủy job xói mòn đang chạy (địa hình giữ nguyên vì chưa áp dụng). */
  function cancelErodeDroplets() {
    if (!_erodeJob) return false;
    _erodeJob.cancelled = true;
    if (_erodeJob.timer) { try { clearTimeout(_erodeJob.timer); } catch (e) {} }
    _erodeJob = null;
    return true;
  }
  function isEroding() { return !!_erodeJob; }

  /* ---- Đợt 5: xói mòn dòng chảy trên state (bất đồng bộ, từng lượt). ---- */
  function getFlowSettings() { return { passes: _flowSettings.passes, strength: _flowSettings.strength }; }
  function setFlowSettings(partial) {
    if (!partial) return getFlowSettings();
    if (partial.passes != null) _flowSettings.passes = clamp(Math.round(Number(partial.passes) || 5), 1, 20);
    if (partial.strength != null) _flowSettings.strength = clamp(Number(partial.strength) || 1, 0.1, 2);
    return getFlowSettings();
  }
  /* Xói mòn dòng chảy bất đồng bộ: chạy từng lượt 1 bằng setTimeout
     (không khoá UI), onProgress(done, total), onDone({cancelled, done}).
     pushHistory chụp TRƯỚC khi chạy; địa hình chỉ áp dụng 1 lần khi
     xong (hủy giữa chừng thì địa hình giữ nguyên). Trả về job
     {cancelled, timer, total}. */
  function erodeFlowAsync(passes, strength, onProgress, onDone) {
    var total = clamp(Math.round(Number(passes) || 5), 1, 20);
    var str = clamp(Number(strength) || 1, 0.1, 2);
    cancelErodeFlow();
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: xói mòn dòng chảy');
    var base = _heights.slice();
    var done = 0;
    var job = { cancelled: false, timer: null, total: total, done: 0 };
    function callDone(res) {
      if (job._doneCalled) return;
      job._doneCalled = true;
      if (typeof onDone === 'function') { try { onDone(res); } catch (e) {} }
    }
    job._callDone = callDone;
    function tick() {
      if (job.cancelled) { callDone({ cancelled: true, done: job.done }); return; }
      base = edTerrainErodeFlow(base, SEGMENTS, { strength: str });
      done++;
      job.done = done;
      if (typeof onProgress === 'function') { try { onProgress(done, total); } catch (e) {} }
      if (job.cancelled) return; // cancelErodeFlow đã gọi onDone
      if (done < total) {
        job.timer = setTimeout(tick, 0);
      } else {
        _heights = base;
        _groundTextureDirty = true;
        syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain();
        _flowJob = null;
        callDone({ cancelled: false, done: done });
      }
    }
    _flowJob = job;
    job.timer = setTimeout(tick, 0);
    return job;
  }
  /* Hủy job xói mòn dòng chảy đang chạy (địa hình giữ nguyên). onDone
     của job vẫn được gọi 1 lần với {cancelled: true} để UI cập nhật. */
  function cancelErodeFlow() {
    if (!_flowJob) return false;
    var job = _flowJob;
    job.cancelled = true;
    if (job.timer) { try { clearTimeout(job.timer); } catch (e) {} }
    _flowJob = null;
    if (typeof job._callDone === 'function') { try { job._callDone({ cancelled: true, done: job.done || 0 }); } catch (e) {} }
    return true;
  }
  function isErodingFlow() { return !!_flowJob; }

  /* ---- Đợt 6: Regions (lưu trong project.terrain.regions). ---- */
  function _resyncRegionCounter() {
    var max = 0;
    for (var i = 0; i < _regions.length; i++) {
      var m = /^region-(\d+)$/.exec(_regions[i].id || '');
      if (m && +m[1] > max) max = +m[1];
    }
    if (max > _regionCounter) _regionCounter = max;
  }
  /* Chuẩn hoá 1 region: kẹp vào map, xếp min/max, preset lạ -> 'thanh-co',
     tên rỗng -> 'Vùng'. 2 góc trùng nhau (diện tích 0) -> null. */
  function normalizeRegion(r) {
    if (!r || typeof r !== 'object') return null;
    var x0 = Number(r.x0), z0 = Number(r.z0), x1 = Number(r.x1), z1 = Number(r.z1);
    if (!isFinite(x0) || !isFinite(z0) || !isFinite(x1) || !isFinite(z1)) return null;
    var half = SIZE / 2;
    x0 = clamp(x0, -half, half); x1 = clamp(x1, -half, half);
    z0 = clamp(z0, -half, half); z1 = clamp(z1, -half, half);
    if (x0 === x1 || z0 === z1) return null;
    var preset = (REGION_PRESETS.indexOf(r.preset) >= 0) ? r.preset : 'thanh-co';
    var name = String(r.name == null ? '' : r.name).trim() || 'Vùng';
    return { id: (typeof r.id === 'string' && r.id) ? r.id : null, name: name,
      x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), preset: preset };
  }
  function getRegions() {
    var out = [];
    for (var i = 0; i < _regions.length; i++) {
      var r = _regions[i];
      out.push({ id: r.id, name: r.name, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, preset: r.preset });
    }
    return out;
  }
  function getRegion(id) {
    for (var i = 0; i < _regions.length; i++) {
      if (_regions[i].id === id) {
        var r = _regions[i];
        return { id: r.id, name: r.name, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, preset: r.preset };
      }
    }
    return null;
  }
  function addRegion(name, x0, z0, x1, z1, preset) {
    var r = normalizeRegion({ id: null, name: name, x0: x0, z0: z0, x1: x1, z1: z1, preset: preset });
    if (!r) return null;
    r.id = 'region-' + (++_regionCounter);
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: thêm vùng ' + r.name);
    _regions.push(r);
    syncToProject(); markDirtyPush();
    renderRegionList();
    return { id: r.id, name: r.name, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, preset: r.preset };
  }
  function removeRegion(id) {
    var ix = -1;
    for (var i = 0; i < _regions.length; i++) if (_regions[i].id === id) { ix = i; break; }
    if (ix < 0) return false;
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: xoá vùng ' + _regions[ix].name);
    _regions.splice(ix, 1);
    syncToProject(); markDirtyPush();
    renderRegionList();
    return true;
  }
  /* Áp preset của 1 vùng qua ED.Environment.setEnv (guard typeof, không
     crash khi Environment chưa load). Trả false khi không áp được. */
  function applyRegionPreset(regionOrId) {
    var r = (typeof regionOrId === 'string') ? getRegion(regionOrId) : regionOrId;
    if (!r || !r.preset) return false;
    if (ED.Environment && typeof ED.Environment.setEnv === 'function') {
      try { ED.Environment.setEnv({ preset: r.preset }); return true; } catch (e) { return false; }
    }
    return false;
  }
  function setAutoSwitchRegion(v) { _autoSwitchRegion = !!v; return _autoSwitchRegion; }
  function getAutoSwitchRegion() { return _autoSwitchRegion; }

  /* ---- Đợt 6: Spline (Core object type 'spline'). ---- */
  /* Tạo object spline qua ED.Core.addObject (pushHistory trước để undo
     khôi phục cả object lẫn địa hình). kind 'road' thì làm phẳng địa
     hình dọc spline + tô paint đất (1) rồi rebuildMesh. kind 'river'
     thì đầu mút gần ô nước (<=3 ô) tự nối dài tới ô nước đó
     (ghi extra.riverSnapped để UI báo). Trả obj hoặc null. */
  function addSpline(kind, points, opts) {
    opts = opts || {};
    if (SPLINE_KINDS.indexOf(kind) < 0) return null;
    if (!points || points.length < 2) return null;
    var pts = points.map(function (p) { return [Number(p[0]) || 0, Number(p[1]) || 0]; });
    var width = clamp(Number(opts.width) || (kind === 'river' ? 4 : 2), 0.5, 20);
    var snapped = false;
    if (kind === 'river') {
      var ext = extendRiverToWater(_paints, pts, SIZE);
      pts = ext.points;
      snapped = ext.snapped;
    }
    if (!ED.Core || typeof ED.Core.addObject !== 'function') return null;
    if (typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: thêm ' + (SPLINE_NAMES[kind] || kind));
    var cx = 0, cz = 0;
    for (var i = 0; i < pts.length; i++) { cx += pts[i][0]; cz += pts[i][1]; }
    cx /= pts.length; cz /= pts.length;
    var extra = { splineKind: kind, points: pts, width: width };
    if (kind === 'river') extra.riverSnapped = snapped;
    var obj = ED.Core.addObject({
      type: 'spline', category: 'Environment',
      name: opts.name || ((SPLINE_NAMES[kind] || kind) + ' ' + pts.length + ' điểm'),
      pos: [cx, heightAt(cx, cz), cz], rot: [0, 0, 0], scale: [1, 1, 1], extra: extra
    });
    if (kind === 'road') {
      _heights = splineFlatten(_heights, SIZE, pts, width);
      var cells = roadCells(pts, width, SIZE);
      for (var c = 0; c < cells.length; c++) _paints[idx(cells[c][0], cells[c][1])] = 1; // 1 = đất
      _groundTextureDirty = true;
    }
    syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain();
    if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') {
      try { ED.Viewport.syncObject(obj); } catch (e) { /* viewport chưa biết vẽ spline: nhóm viewport nối buildSplineGroup */ }
    }
    return obj;
  }
  /* Dải ribbon ôm địa hình: mỗi điểm mẫu có 2 đỉnh trái/phải (vuông góc
     hướng spline, rộng width), y = heightAt + 0.06 (đường) / 0.12 (sông).
     UV u = quãng đường/4 để texture sông lặp theo chiều dài. */
  function buildRibbonGeometry(pts, width, yLift) {
    var n = pts.length;
    var posArr = new Float32Array(n * 2 * 3);
    var uvArr = new Float32Array(n * 2 * 2);
    var dist = 0;
    for (var i = 0; i < n; i++) {
      var x = pts[i][0], z = pts[i][1];
      var px, pz;
      if (i === 0) { px = pts[1][0] - x; pz = pts[1][1] - z; }
      else if (i === n - 1) { px = x - pts[i - 1][0]; pz = z - pts[i - 1][1]; }
      else { px = pts[i + 1][0] - pts[i - 1][0]; pz = pts[i + 1][1] - pts[i - 1][1]; }
      var l = Math.sqrt(px * px + pz * pz) || 1; px /= l; pz /= l;
      var ox = -pz * width / 2, oz = px * width / 2;
      var y = heightAt(x, z) + yLift;
      if (i > 0) dist += Math.sqrt((x - pts[i - 1][0]) * (x - pts[i - 1][0]) + (z - pts[i - 1][1]) * (z - pts[i - 1][1]));
      posArr[i * 6] = x + ox; posArr[i * 6 + 1] = y; posArr[i * 6 + 2] = z + oz;
      posArr[i * 6 + 3] = x - ox; posArr[i * 6 + 4] = y; posArr[i * 6 + 5] = z - oz;
      uvArr[i * 4] = dist / 4; uvArr[i * 4 + 1] = 0; uvArr[i * 4 + 2] = dist / 4; uvArr[i * 4 + 3] = 1;
    }
    var idxArr = [];
    for (var j = 0; j < n - 1; j++) {
      var a = j * 2, b = j * 2 + 1, cc = j * 2 + 2, d = j * 2 + 3;
      idxArr.push(a, b, cc, b, d, cc);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    geo.setIndex(idxArr);
    geo.computeVertexNormals();
    return geo;
  }
  /* Texture sông: sọc ngang trắng mờ trên nền nước (chỉ browser, có
     canvas). Không có document/THREE.CanvasTexture -> null (sông vẫn
     vẽ bằng màu + opacity, tick vẫn cập nhật flowOffset số). */
  function makeRiverTexture() {
    if (typeof document === 'undefined' || typeof THREE === 'undefined' || !THREE.CanvasTexture) return null;
    try {
      var cv = document.createElement('canvas');
      cv.width = 64; cv.height = 64;
      var ctx = cv.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#3a8b8c'; ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
      for (var y = 8; y < 64; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(64, y); ctx.stroke(); }
      var tex = new THREE.CanvasTexture(cv);
      tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
      return tex;
    } catch (e) { return null; }
  }
  function _registerRiverMesh(id, mesh) {
    for (var i = 0; i < _riverMeshes.length; i++) {
      if (_riverMeshes[i].id === id) { _riverMeshes[i].mesh = mesh; _riverMeshes[i].flowOffset = 0; return; }
    }
    _riverMeshes.push({ id: id, mesh: mesh, flowOffset: 0 });
  }
  /* buildSplineGroup(obj) -> THREE.Group (viewport gọi qua guard typeof).
     'road': ribbon đất ôm địa hình. 'river': ribbon nước (transparent,
     opacity 0.8) + userData.flowOffset để tick() làm chảy. 'fence': cọc
     + thanh ngang mỗi ~2 đơn vị (cọc dùng InstancedMesh khi có).
     Không có THREE -> null an toàn; obj lạ -> null. */
  function buildSplineGroup(obj) {
    if (typeof THREE === 'undefined') return null;
    if (!obj || !obj.extra) return null;
    var kind = obj.extra.splineKind;
    var points = obj.extra.points;
    var width = clamp(Number(obj.extra.width) || 2, 0.5, 20);
    if (!points || points.length < 2) return null;
    if (kind !== 'road' && kind !== 'river' && kind !== 'fence') return null;
    var group = new THREE.Group();
    group.userData.objectId = obj.id;
    group.userData.splineKind = kind;
    if (kind === 'road' || kind === 'river') {
      var pts = resamplePolyline(points, 1.5);
      var geo = buildRibbonGeometry(pts, width, kind === 'river' ? 0.12 : 0.06);
      if (!geo) return group;
      var mat;
      if (kind === 'river') {
        mat = new THREE.MeshStandardMaterial({ color: 0x3a8b8c, transparent: true, opacity: 0.8, roughness: 0.3, metalness: 0.1 });
        var tex = makeRiverTexture();
        if (tex) mat.map = tex;
      } else {
        mat = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1, metalness: 0 });
      }
      var mesh = new THREE.Mesh(geo, mat);
      mesh.userData.objectId = obj.id;
      mesh.userData.splineKind = kind;
      if (kind === 'river') {
        mesh.userData.flowOffset = 0;
        group.userData.flowOffset = 0;
        _registerRiverMesh(obj.id, mesh);
      } else {
        mesh.receiveShadow = true;
      }
      group.add(mesh);
      return group;
    }
    /* fence: cọc mỗi ~2 đơn vị + 1 thanh ngang giữa 2 cọc kề. */
    var fpts = resamplePolyline(points, 2);
    var postGeo = new THREE.BoxGeometry(0.15, 1.2, 0.15);
    var postMat = new THREE.MeshStandardMaterial({ color: 0x7a5238, roughness: 0.9 });
    var railMat = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.9 });
    if (typeof THREE.InstancedMesh === 'function' && fpts.length > 1) {
      var im = new THREE.InstancedMesh(postGeo, postMat, fpts.length);
      for (var i = 0; i < fpts.length; i++) {
        var m4 = new THREE.Matrix4();
        m4.makeTranslation(fpts[i][0], heightAt(fpts[i][0], fpts[i][1]) + 0.6, fpts[i][1]);
        im.setMatrixAt(i, m4);
      }
      if (im.instanceMatrix) im.instanceMatrix.needsUpdate = true;
      group.add(im);
    } else {
      for (var j = 0; j < fpts.length; j++) {
        var pm = new THREE.Mesh(postGeo, postMat);
        pm.position.set(fpts[j][0], heightAt(fpts[j][0], fpts[j][1]) + 0.6, fpts[j][1]);
        group.add(pm);
      }
    }
    for (var k = 0; k < fpts.length - 1; k++) {
      var ax = fpts[k][0], az = fpts[k][1], bx = fpts[k + 1][0], bz = fpts[k + 1][1];
      var dx = bx - ax, dz = bz - az;
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;
      var rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), railMat);
      var mx = (ax + bx) / 2, mz = (az + bz) / 2;
      rail.position.set(mx, heightAt(mx, mz) + 0.9, mz);
      rail.rotation.y = -Math.atan2(dz, dx);
      group.add(rail);
    }
    return group;
  }
  /* tick(dt): sông chảy — tăng flowOffset cho các river mesh đã build
     (đổi offset texture khi có map). Viewport gọi qua render loop
     (nhóm khác nối). Trả số river mesh đang theo dõi. */
  function tick(dt) {
    dt = clamp(Number(dt) || 0, 0, 1);
    for (var i = _riverMeshes.length - 1; i >= 0; i--) {
      var e = _riverMeshes[i];
      if (!e || !e.mesh) { _riverMeshes.splice(i, 1); continue; }
      e.flowOffset = (e.flowOffset || 0) + dt * 0.05;
      e.mesh.userData.flowOffset = e.flowOffset;
      try {
        var m = e.mesh.material;
        if (m && m.map) m.map.offset.x = e.flowOffset % 1;
      } catch (err) { /* mesh lạ, bỏ qua */ }
    }
    return _riverMeshes.length;
  }

  /* ---- Đợt 6: Scatter (Core object type 'scatter'). ---- */
  /* 1 nhát cọ = 1 object scatter mới (hiện trong Hierarchy như object
     thường, xoá được). count = scatterStrokeCount(mật độ, bán kính). */
  function addScatter(kind, cx, cz, opts) {
    opts = opts || {};
    if (SCATTER_KINDS.indexOf(kind) < 0) return null;
    cx = Number(cx) || 0; cz = Number(cz) || 0;
    var radius = clamp(Number(opts.radius) || 4, 1, 10);
    var density = clamp(Math.round(Number(opts.density)) || 10, 1, 50);
    var seed = (opts.seed == null ? 1 : (Math.floor(Number(opts.seed)) >>> 0));
    var count = (opts.count != null) ? clamp(Math.round(Number(opts.count)) || 1, 1, 200) : scatterStrokeCount(density, radius);
    if (!ED.Core || typeof ED.Core.addObject !== 'function') return null;
    if (typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: rải ' + SCATTER_NAMES[kind] + ' ×' + count);
    var obj = ED.Core.addObject({
      type: 'scatter', category: 'Environment', name: SCATTER_NAMES[kind] + ' ×' + count,
      pos: [cx, heightAt(cx, cz), cz], rot: [0, 0, 0], scale: [1, 1, 1],
      extra: { kind: kind, count: count, seed: seed, radius: radius, center: [cx, cz] }
    });
    if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') {
      try { ED.Viewport.syncObject(obj); } catch (e) { /* viewport chưa biết vẽ scatter: nhóm viewport nối buildScatterGroup */ }
    }
    return obj;
  }
  /* buildScatterGroup(obj) -> THREE.Group chứa 1 InstancedMesh cho kind
     đó (geometry/material lấy từ ED.Assets.buildMesh(kind); nếu Assets
     chưa load thì trả Group rỗng + log, không crash). Không có THREE
     -> null an toàn. Vị trí + xoay + tỉ lệ deterministic theo seed. */
  function buildScatterGroup(obj) {
    if (typeof THREE === 'undefined') return null;
    var g = new THREE.Group();
    g.userData.objectId = obj && obj.id;
    if (!obj || !obj.extra) return g;
    var kind = obj.extra.kind;
    var count = clamp(Math.round(Number(obj.extra.count)) || 0, 0, 1000);
    var seed = (obj.extra.seed == null ? 1 : (Math.floor(Number(obj.extra.seed)) >>> 0));
    var radius = Math.max(0, Number(obj.extra.radius) || 0);
    var center = obj.extra.center || [0, 0];
    var positions = scatterPositions(seed, count, Number(center[0]) || 0, Number(center[1]) || 0, radius);
    g.userData.scatterKind = kind;
    g.userData.count = positions.length;
    if (!positions.length) return g;
    var base = null;
    if (ED.Assets && typeof ED.Assets.buildMesh === 'function') {
      try { base = ED.Assets.buildMesh(kind, {}); } catch (e) { base = null; }
    }
    if (!base) {
      try { if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log('Scatter: chưa có Assets.buildMesh cho "' + kind + '" (Assets chưa load?) — trả Group rỗng.'); } catch (e) {}
      return g;
    }
    var geo = null, mat = null;
    try {
      base.traverse(function (c) {
        if (!geo && c.isMesh && c.geometry) { geo = c.geometry; mat = c.material; }
      });
    } catch (e) { /* base lạ, giữ Group rỗng */ }
    if (!geo) return g;
    var rng = mulberry32((seed + 7) >>> 0);
    if (typeof THREE.InstancedMesh === 'function') {
      var im = new THREE.InstancedMesh(geo, mat, positions.length);
      for (var i = 0; i < positions.length; i++) {
        var px = positions[i][0], pz = positions[i][1];
        var py = heightAt(px, pz);
        var s = 0.7 + rng() * 0.6;
        var rot = rng() * Math.PI * 2;
        var m4 = new THREE.Matrix4();
        if (typeof m4.makeRotationY === 'function') m4.makeRotationY(rot);
        if (typeof m4.scale === 'function' && typeof THREE.Vector3 === 'function') {
          try { m4.scale(new THREE.Vector3(s, s * (0.8 + rng() * 0.4), s)); } catch (e2) { /* stub thiếu Vector3: giữ tỉ lệ 1 */ }
        }
        if (typeof m4.setPosition === 'function') m4.setPosition(px, py, pz);
        im.setMatrixAt(i, m4);
      }
      if (im.instanceMatrix) im.instanceMatrix.needsUpdate = true;
      g.add(im);
    } else {
      for (var j = 0; j < positions.length; j++) {
        var single = new THREE.Mesh(geo, mat);
        single.position.set(positions[j][0], heightAt(positions[j][0], positions[j][1]), positions[j][1]);
        g.add(single);
      }
    }
    return g;
  }
  function getSplineDraft() {
    if (!_splineDraft) return null;
    return { kind: _splineDraft.kind, width: _splineDraft.width, points: _splineDraft.points.map(function (p) { return [p[0], p[1]]; }) };
  }
  function getScatterSettings() {
    return { kind: _scatterSettings.kind, radius: _scatterSettings.radius, density: _scatterSettings.density, seed: _scatterSettings.seed };
  }

  /* ---- Đợt 6: click xuống đất (1 handler chung, dispatch theo chế độ).
     Viewport chỉ có 1 slot setGroundClickHandler (NPC cũng dùng) nên
     Terrain đăng ký lại mỗi khi bật chế độ cần click, và trả null khi
     tắt chế độ — chế độ nào bật sau sẽ thắng slot này. ---- */
  function setGroundMode(mode) {
    _groundMode = mode || null;
    if (_groundMode) _installGroundHandler();
    else _clearGroundHandler();
    return _groundMode;
  }
  function getGroundMode() { return _groundMode ? _groundMode.kind : null; }
  function _installGroundHandler() {
    try {
      if (ED.Viewport && typeof ED.Viewport.setGroundClickHandler === 'function') {
        ED.Viewport.setGroundClickHandler(function (x, z) { onGroundClick(x, z); });
      }
    } catch (e) { /* Viewport chưa có API: chế độ click không chạy */ }
  }
  function _clearGroundHandler() {
    try {
      if (ED.Viewport && typeof ED.Viewport.setGroundClickHandler === 'function') {
        ED.Viewport.setGroundClickHandler(null);
      }
    } catch (e) {}
  }
  function onGroundClick(x, z) {
    if (!_groundMode) return;
    if (_groundMode.kind === 'region') {
      if (!_regionPick) return;
      if (_regionPick.step === 1) {
        _regionPick.corner1 = { x: x, z: z };
        _regionPick.step = 2;
        toast('Đã chọn góc 1 (' + x.toFixed(1) + ', ' + z.toFixed(1) + '). Bấm "Chọn góc 2" rồi bấm xuống đất.');
      } else if (_regionPick.step === 2) {
        _regionPick.corner2 = { x: x, z: z };
        _regionPick.step = 0;
        toast('Đã chọn góc 2. Bấm "Thêm vùng" để tạo vùng.');
        setGroundMode(null);
      }
      updateRegionStatus();
      return;
    }
    if (_groundMode.kind === 'spline') {
      if (!_splineDraft) return;
      /* Bấm đúp (2 lần chạm < 350ms) = kết thúc vẽ, không thêm điểm. */
      var now = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
      if (_splineDraft.points.length >= 2 && now - _lastSplineClick < 350) { finishSpline(); return; }
      _lastSplineClick = now;
      _splineDraft.points.push([x, z]);
      updateSplineStatus();
      return;
    }
    if (_groundMode.kind === 'scatter') {
      var o = addScatter(_scatterSettings.kind, x, z, _scatterSettings);
      if (o) toast('Đã rải ' + o.extra.count + ' ' + (SCATTER_NAMES[_scatterSettings.kind] || _scatterSettings.kind) + '.');
      return;
    }
  }
  function toast(msg) {
    try { if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg); } catch (e) {}
  }
  function startRegionPick(step) {
    step = (step === 2) ? 2 : 1;
    if (step === 2 && (!_regionPick || !_regionPick.corner1)) {
      toast('Chọn góc 1 trước.');
      return false;
    }
    _regionPick.step = step;
    setGroundMode({ kind: 'region' });
    updateRegionStatus();
    return true;
  }
  function updateRegionStatus() {
    if (typeof document === 'undefined' || !_panel) return;
    var el = _panel.querySelector ? _panel.querySelector('#ed-region-status') : null;
    if (!el) return;
    if (_regionPick.step === 1) el.textContent = 'Đang chọn góc 1: bấm xuống đất.';
    else if (_regionPick.step === 2) {
      var c = _regionPick.corner1 || { x: 0, z: 0 };
      el.textContent = 'Góc 1: (' + c.x.toFixed(1) + ', ' + c.z.toFixed(1) + '). Đang chọn góc 2: bấm xuống đất.';
    } else if (_regionPick.corner1 && _regionPick.corner2) el.textContent = 'Đã chọn 2 góc. Bấm "Thêm vùng" để tạo vùng.';
    else el.textContent = 'Chưa chọn góc nào.';
  }
  function startSplineDraw(kind) {
    if (SPLINE_KINDS.indexOf(kind) < 0) return false;
    _splineDraft = { kind: kind, points: [], width: _splineSettings.width };
    _lastSplineClick = 0;
    setGroundMode({ kind: 'spline' });
    updateSplineStatus();
    return true;
  }
  function finishSpline() {
    if (!_splineDraft) return null;
    var d = _splineDraft;
    _splineDraft = null;
    setGroundMode(null);
    updateSplineStatus();
    if (d.points.length < 2) { toast('Spline cần ít nhất 2 điểm.'); return null; }
    var obj = addSpline(d.kind, d.points, { width: d.width });
    if (obj) {
      var msg = 'Đã thêm ' + (SPLINE_NAMES[d.kind] || d.kind) + ' (' + d.points.length + ' điểm).';
      if (d.kind === 'river' && obj.extra && obj.extra.riverSnapped) msg += ' Đã nối tới ô nước.';
      toast(msg);
    }
    return obj;
  }
  function cancelSpline() {
    if (!_splineDraft && (!_groundMode || _groundMode.kind !== 'spline')) return false;
    _splineDraft = null;
    setGroundMode(null);
    updateSplineStatus();
    return true;
  }
  function cancelGroundMode() {
    var had = !!_groundMode;
    _groundMode = null;
    _splineDraft = null;
    if (_regionPick) _regionPick.step = 0;
    _clearGroundHandler();
    updateSplineStatus(); updateRegionStatus(); updateScatterStatus();
    return had;
  }
  function updateSplineStatus() {
    if (typeof document === 'undefined' || !_panel) return;
    var el = _panel.querySelector ? _panel.querySelector('#ed-spline-status') : null;
    if (el) {
      el.textContent = _splineDraft
        ? 'Đang vẽ ' + (SPLINE_NAMES[_splineDraft.kind] || _splineDraft.kind) + ': ' + _splineDraft.points.length + ' điểm — bấm xuống đất thêm điểm, bấm đúp/Enter để xong, Esc để huỷ.'
        : 'Chưa vẽ spline.';
    }
    var btns = _panel.querySelectorAll ? _panel.querySelectorAll('[data-spline-kind]') : [];
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].classList) btns[i].classList.toggle('ed-active', !!_splineDraft && btns[i].getAttribute('data-spline-kind') === _splineDraft.kind);
    }
  }
  function updateScatterStatus() {
    if (typeof document === 'undefined' || !_panel) return;
    var el = _panel.querySelector ? _panel.querySelector('#ed-scatter-status') : null;
    var btn = _panel.querySelector ? _panel.querySelector('#ed-scatter-mode') : null;
    var on = !!(_groundMode && _groundMode.kind === 'scatter');
    if (el) {
      el.textContent = on
        ? 'Cọ rải ĐANG BẬT (' + (SCATTER_NAMES[_scatterSettings.kind] || '') + ' · r=' + _scatterSettings.radius + ' · mật độ ' + _scatterSettings.density + '): chạm xuống đất để rải 1 nhát (tối đa 200/nhát). Bấm lại nút để tắt.'
        : 'Cọ rải đang tắt. Bật cọ rồi chạm xuống đất để rải 1 nhát (tối đa 200/nhát).';
    }
    if (btn) {
      btn.textContent = on ? '🌿 Tắt cọ rải' : '🌿 Bật cọ rải';
      if (btn.classList) btn.classList.toggle('ed-active', on);
    }
  }
  function updateMapSizeLine() {
    if (typeof document === 'undefined' || !_panel) return;
    var el = _panel.querySelector ? _panel.querySelector('#ed-map-size-v') : null;
    if (el) el.textContent = String(SIZE);
    var btns = _panel.querySelectorAll ? _panel.querySelectorAll('[data-map-size]') : [];
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].classList) btns[i].classList.toggle('ed-active', Number(btns[i].getAttribute('data-map-size')) === SIZE);
    }
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function renderRegionList() {
    if (typeof document === 'undefined' || !_panel) return;
    var el = _panel.querySelector ? _panel.querySelector('#ed-region-list') : null;
    if (!el) return;
    if (!_regions.length) { el.innerHTML = '<div class="ed-hint">Chưa có vùng nào.</div>'; return; }
    var html = '';
    for (var i = 0; i < _regions.length; i++) {
      var r = _regions[i];
      html += '<div class="ed-region-row"><span class="ed-region-name">' + escapeHtml(r.name) + ' · ' + (PRESET_NAMES[r.preset] || r.preset) + '</span>' +
        '<button type="button" data-region-apply="' + r.id + '">Áp preset</button>' +
        '<button type="button" data-region-del="' + r.id + '" title="Xoá vùng">✕</button></div>';
    }
    el.innerHTML = html;
    var ap = el.querySelectorAll('[data-region-apply]');
    for (var a = 0; a < ap.length; a++) ap[a].addEventListener('click', function () {
      var id = this.getAttribute('data-region-apply');
      if (applyRegionPreset(id)) toast('Đã áp preset vùng.');
      else toast('Chưa áp được preset (Environment chưa load?).');
    });
    var del = el.querySelectorAll('[data-region-del]');
    for (var d = 0; d < del.length; d++) del[d].addEventListener('click', function () {
      var id2 = this.getAttribute('data-region-del');
      if (removeRegion(id2)) { renderRegionList(); toast('Đã xoá vùng.'); }
    });
  }

  /* ---- Đợt 6: badge tên vùng + tự đổi preset theo camera. ---- */
  function ensureRegionBadge() {
    if (typeof document === 'undefined') return null;
    var b = document.getElementById('ed-region-badge');
    if (b) { _badge = b; return b; }
    var host = document.getElementById('viewport-wrap') || document.getElementById('viewport') || document.body;
    if (!host) return null;
    b = document.createElement('div');
    b.id = 'ed-region-badge';
    b.className = 'ed-region-badge';
    b.style.display = 'none';
    host.appendChild(b);
    _badge = b;
    return b;
  }
  /* Cập nhật mỗi 300ms từ vị trí camera: chỉ hiện khi camera đang trong
     1 vùng. Tự đổi preset chỉ gọi 1 lần khi VÀO vùng khác (không gọi
     lặp mỗi 300ms). */
  function refreshRegionBadge() {
    if (!_badge) return;
    var cam = null;
    try { if (ED.Viewport && typeof ED.Viewport.getCamera === 'function') cam = ED.Viewport.getCamera(); } catch (e) {}
    if (!cam || !cam.position || typeof cam.position.x !== 'number') {
      _badge.style.display = 'none';
      _lastAutoRegionId = null;
      return;
    }
    var r = regionAt(_regions, cam.position.x, cam.position.z);
    if (!r) {
      _badge.style.display = 'none';
      _lastAutoRegionId = null;
      return;
    }
    _badge.textContent = '📍 ' + r.name + ' · ' + (PRESET_NAMES[r.preset] || r.preset);
    _badge.style.display = 'block';
    if (_autoSwitchRegion && _lastAutoRegionId !== r.id) {
      _lastAutoRegionId = r.id;
      applyRegionPreset(r);
    }
  }

  function setUseGroundTexture(v) {
    _useGroundTexture = !!v;
    _groundTextureDirty = true;
    rebuildMesh();
    return _useGroundTexture;
  }
  function getUseGroundTexture() { return _useGroundTexture; }

  function syncFromProject() {
    var p = ED.Core && typeof ED.Core.getProject === 'function' ? ED.Core.getProject() : null;
    if (!p) p = ED.Core && ED.Core.project;
    if (!p || !p.terrain) return false;
    if (Array.isArray(p.terrain.heights) && p.terrain.heights.length === COUNT) _heights = p.terrain.heights.slice();
    if (Array.isArray(p.terrain.paints) && p.terrain.paints.length === COUNT) _paints = p.terrain.paints.slice();
    /* Đợt 6: kích thước map + regions (project cũ không có -> mặc định
       96 / không có vùng). */
    var vs = validMapSize(p.terrain.size);
    if (vs) SIZE = vs;
    _regions = [];
    if (Array.isArray(p.terrain.regions)) {
      for (var i = 0; i < p.terrain.regions.length; i++) {
        var nr = normalizeRegion(p.terrain.regions[i]);
        if (nr) {
          if (!nr.id) nr.id = 'region-' + (++_regionCounter);
          _regions.push(nr);
        }
      }
      _resyncRegionCounter();
    }
    renderRegionList();
    updateMapSizeLine();
    return true;
  }
  function syncToProject() {
    var p = ED.Core && typeof ED.Core.getProject === 'function' ? ED.Core.getProject() : null;
    if (!p) p = ED.Core && ED.Core.project;
    if (!p) return false;
    if (!p.terrain) p.terrain = { size: SIZE, segments: SEGMENTS, heights: _heights, paints: _paints, regions: [] };
    p.terrain.size = SIZE; p.terrain.segments = SEGMENTS;
    p.terrain.heights = _heights; p.terrain.paints = _paints;
    p.terrain.regions = getRegions(); // đợt 6
    return true;
  }
  function defaultTerrain() {
    return { size: SIZE, segments: SEGMENTS, heights: makeHeights(), paints: makePaints(), regions: [] };
  }

  /* ---- Mesh chunk 4×4 (đợt 4): 16 mesh riêng để frustum culling từng
     chunk. Mỗi chunk là PlaneGeometry 24×24, 16×16 segment, đặt tại tâm
     vùng của nó; y = heights, vertex color = paint (fallback khi tắt
     texture), UV toàn cục gx/64, 1-gz/64 để texture đất 512 khớp lưới
     paint. _mesh giữ mesh chunk đầu tiên để API cũ (getMesh) vẫn chạy. ---- */
  function disposeChunks() {
    var scene = ED.Viewport && ED.Viewport.scene;
    for (var i = 0; i < _chunks.length; i++) {
      var m = _chunks[i].mesh;
      if (!m) continue;
      try { if (scene && scene.remove) scene.remove(m); } catch (e) {}
      try { if (m.geometry && m.geometry.dispose) m.geometry.dispose(); } catch (e) {}
      try { if (m.material && m.material.dispose) m.material.dispose(); } catch (e) {}
    }
    _chunks = [];
    _mesh = null;
  }
  /* Mức LOD của chunk kề (null = không có chunk kề ở mép map). */
  function neighborLodLevels(cx, cz) {
    function lv(x, z) {
      if (x < 0 || x >= CHUNK_COUNT || z < 0 || z >= CHUNK_COUNT) return null;
      return _lodLevels[z * CHUNK_COUNT + x];
    }
    return { left: lv(cx - 1, cz), right: lv(cx + 1, cz), top: lv(cx, cz - 1), bottom: lv(cx, cz + 1) };
  }
  /* Dựng 1 mesh chunk ở 1 mức LOD (lưới lấy từ edTerrainLodGrid, đã
     snap mép theo chunk kề). Không thêm vào scene, không chạm _chunks. */
  function buildChunkMesh(cx, cz, level) {
    var grid = edTerrainLodGrid(_heights, _paints, cx, cz, level, neighborLodLevels(cx, cz));
    var vps = grid.vertsPerSide;
    var geo = new THREE.PlaneGeometry(SIZE / CHUNK_COUNT, SIZE / CHUNK_COUNT, grid.segments, grid.segments);
    var tex = _useGroundTexture ? getGroundTexture() : null;
    var mat = new THREE.MeshStandardMaterial({ vertexColors: !tex, roughness: 0.9 });
    if (tex) mat.map = tex;
    var mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(
      (cx * CHUNK_SEGMENTS + CHUNK_SEGMENTS / 2) / SEGMENTS * SIZE - SIZE / 2, 0,
      (cz * CHUNK_SEGMENTS + CHUNK_SEGMENTS / 2) / SEGMENTS * SIZE - SIZE / 2);
    mesh.receiveShadow = true;
    mesh.userData.isTerrain = true;
    mesh.userData.chunkX = cx;
    mesh.userData.chunkZ = cz;
    mesh.userData.lodLevel = grid.level;
    var pos = geo.attributes.position;
    var uv = geo.attributes.uv;
    var colors = new Float32Array(pos.count * 3);
    for (var v = 0; v < pos.count; v++) {
      var ix = v % vps;
      var iz = Math.floor(v / vps);
      var gx = cx * CHUNK_SEGMENTS + ix * grid.step;
      var gz = cz * CHUNK_SEGMENTS + iz * grid.step;
      pos.setZ(v, grid.heights[iz * vps + ix]);
      var c = PAINT_COLORS[grid.paints[iz * vps + ix] || 0];
      colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2];
      if (uv && uv.setXY) uv.setXY(v, gx / SEGMENTS, 1 - gz / SEGMENTS);
    }
    pos.needsUpdate = true;
    if (uv) uv.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return mesh;
  }
  /* Dựng lại riêng 1 chunk đã có trong _chunks (đổi mức LOD hoặc đổi
     mép snap). Trả về mesh mới, null khi chưa có viewport/mesh. */
  function rebuildChunkMesh(cx, cz) {
    if (typeof THREE === 'undefined') return null;
    var scene = ED.Viewport && ED.Viewport.scene;
    if (!scene) return null;
    for (var i = 0; i < _chunks.length; i++) {
      if (_chunks[i].cx === cx && _chunks[i].cz === cz) {
        var old = _chunks[i].mesh;
        if (old) {
          try { scene.remove(old); } catch (e) {}
          try { if (old.geometry && old.geometry.dispose) old.geometry.dispose(); } catch (e) {}
          try { if (old.material && old.material.dispose) old.material.dispose(); } catch (e) {}
        }
        var mesh = buildChunkMesh(cx, cz, _lodLevels[cz * CHUNK_COUNT + cx]);
        scene.add(mesh);
        _chunks[i].mesh = mesh;
        if (i === 0) _mesh = mesh;
        return mesh;
      }
    }
    return null;
  }
  function rebuildMesh() {
    if (typeof THREE === 'undefined') return null;
    var scene = ED.Viewport && ED.Viewport.scene;
    if (!scene) return null;
    disposeChunks();
    for (var cz = 0; cz < CHUNK_COUNT; cz++) {
      for (var cx = 0; cx < CHUNK_COUNT; cx++) {
        var mesh = buildChunkMesh(cx, cz, _lodLevels[cz * CHUNK_COUNT + cx]);
        scene.add(mesh);
        _chunks.push({ cx: cx, cz: cz, mesh: mesh });
      }
    }
    _mesh = _chunks.length ? _chunks[0].mesh : null;
    updateChunkInfoLine();
    updateLodInfoLine();
    return _mesh;
  }
  function getMesh() { return _mesh; }
  function getChunkMeshes() {
    var out = [];
    for (var i = 0; i < _chunks.length; i++) if (_chunks[i].mesh) out.push(_chunks[i].mesh);
    return out;
  }
  /* getChunkInfo(): {chunks:16, visible, totalVerts} cho panel perf
     (coordinator nối vào ED.UI.setPerf). Chưa build mesh thì trả về
     số liệu lý thuyết (16 chunk, 4624 đỉnh gồm biên trùng). */
  function getChunkInfo() {
    var totalVerts = CHUNK_TOTAL * CHUNK_VERTS * CHUNK_VERTS; // 4624
    if (!_chunks.length) return { chunks: CHUNK_TOTAL, visible: CHUNK_TOTAL, totalVerts: totalVerts };
    var vis = 0, tv = 0;
    for (var i = 0; i < _chunks.length; i++) {
      var m = _chunks[i].mesh;
      if (!m) continue;
      if (m.visible !== false) vis++;
      if (m.geometry && m.geometry.attributes && m.geometry.attributes.position) tv += m.geometry.attributes.position.count;
    }
    return { chunks: _chunks.length, visible: vis, totalVerts: tv || totalVerts };
  }
  function updateChunkInfoLine() {
    if (typeof document === 'undefined' || !_panel) return;
    var el = _panel.querySelector ? _panel.querySelector('#ed-chunk-info') : null;
    if (!el) return;
    var info = getChunkInfo();
    el.textContent = 'Chunk: ' + info.chunks + ' · hiện: ' + info.visible + ' · đỉnh: ' + info.totalVerts;
  }

  /* ---- Đợt 5: LOD runtime. ----
     updateLod(cameraPos): tính mức LOD mới cho 16 chunk theo khoảng
     cách từ camera tới tâm chunk (tâm lấy cao độ thực tế), có
     hysteresis ±10% qua edTerrainLodNextLevel. Chỉ rebuild chunk đổi
     mức + chunk kề của nó (mép snap của chunk kề phụ thuộc mức mới).
     Không có viewport/mesh thì vẫn cập nhật mức + trả changed (để
     test Node + để coordinator đọc getLodInfo). Gọi mỗi frame hoặc
     mỗi 0.25s từ vòng lặp chính. Trả về {changed: [index chunk đổi
     mức], levels: [16 mức hiện tại]}. */
  function getLodLevels() { return _lodLevels.slice(); }
  function getLodThresholds() { return { near: _lodThresholds.near, far: _lodThresholds.far }; }
  function setLodThresholds(partial) {
    if (!partial) return getLodThresholds();
    if (partial.near != null) _lodThresholds.near = clamp(Number(partial.near) || LOD_DEFAULT_NEAR, 5, 200);
    else if (partial.mid != null) _lodThresholds.near = clamp(Number(partial.mid) || LOD_DEFAULT_NEAR, 5, 200);
    if (partial.far != null) _lodThresholds.far = clamp(Number(partial.far) || LOD_DEFAULT_FAR, 5, 300);
    if (_lodThresholds.far <= _lodThresholds.near) _lodThresholds.far = _lodThresholds.near + 5;
    return getLodThresholds();
  }
  /* getLodInfo(): {levels: [số chunk mức 0, mức 1, mức 2], total: 16}
     cho coordinator hiện trong panel perf. Mức LOD không lưu project. */
  function getLodInfo() {
    var counts = [0, 0, 0];
    for (var i = 0; i < _lodLevels.length; i++) counts[lodLevelClamped(_lodLevels[i])]++;
    return { levels: counts, total: CHUNK_TOTAL };
  }
  function updateLod(cameraPos) {
    if (!cameraPos) return { changed: [], levels: getLodLevels() };
    var px = Number(cameraPos.x) || 0, py = Number(cameraPos.y) || 0, pz = Number(cameraPos.z) || 0;
    var newLevels = new Array(CHUNK_TOTAL);
    for (var cz = 0; cz < CHUNK_COUNT; cz++) {
      for (var cx = 0; cx < CHUNK_COUNT; cx++) {
        var centerX = (cx * CHUNK_SEGMENTS + CHUNK_SEGMENTS / 2) / SEGMENTS * SIZE - SIZE / 2;
        var centerZ = (cz * CHUNK_SEGMENTS + CHUNK_SEGMENTS / 2) / SEGMENTS * SIZE - SIZE / 2;
        var cy = heightAtArray(_heights, centerX, centerZ);
        var dx = px - centerX, dy = py - cy, dz = pz - centerZ;
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        newLevels[cz * CHUNK_COUNT + cx] = edTerrainLodNextLevel(dist, _lodLevels[cz * CHUNK_COUNT + cx], _lodThresholds);
      }
    }
    var changed = [];
    for (var i = 0; i < CHUNK_TOTAL; i++) if (newLevels[i] !== _lodLevels[i]) changed.push(i);
    if (!changed.length) return { changed: [], levels: getLodLevels() };
    _lodLevels = newLevels;
    var toRebuild = {}, n;
    for (n = 0; n < changed.length; n++) {
      var ci = changed[n];
      var ccx = ci % CHUNK_COUNT, ccz = Math.floor(ci / CHUNK_COUNT);
      toRebuild[ci] = true;
      if (ccx > 0) toRebuild[ci - 1] = true;
      if (ccx < CHUNK_COUNT - 1) toRebuild[ci + 1] = true;
      if (ccz > 0) toRebuild[ci - CHUNK_COUNT] = true;
      if (ccz < CHUNK_COUNT - 1) toRebuild[ci + CHUNK_COUNT] = true;
    }
    for (var key in toRebuild) {
      var idx2 = Number(key);
      rebuildChunkMesh(idx2 % CHUNK_COUNT, Math.floor(idx2 / CHUNK_COUNT));
    }
    updateChunkInfoLine();
    updateLodInfoLine();
    return { changed: changed, levels: getLodLevels() };
  }
  function updateLodInfoLine() {
    if (typeof document === 'undefined' || !_panel) return;
    var el = _panel.querySelector ? _panel.querySelector('#ed-lod-info') : null;
    if (!el) return;
    var info = getLodInfo();
    el.textContent = 'LOD: ' + info.levels[0] + '×mức 0 · ' + info.levels[1] + '×mức 1 · ' + info.levels[2] + '×mức 2';
  }

  /* ---- Texture đất procedural (chỉ chạy trong browser, có canvas). ----
     6 pattern 128×128 (cỏ/đất/đá/cát/nước/tuyết): nền + nhiễu đốm +
     vân riêng từng loại, RNG seed cố định nên build deterministic.
     Texture lớn 512×512 vẽ theo paintGridToTexturePlan: mỗi ô paint
     8×8px lấy 1 lát 8×8 ngẫu nhiên (seed 4242) từ pattern tương ứng. */
  function getGroundTexture() {
    if (typeof document === 'undefined' || typeof THREE === 'undefined' || !THREE.CanvasTexture) return null;
    if (_groundTexture && !_groundTextureDirty) return _groundTexture;
    var cv = buildGroundTextureCanvas();
    if (!cv) return null;
    if (_groundTexture && _groundTexture.dispose) { try { _groundTexture.dispose(); } catch (e) {} }
    _groundTexture = new THREE.CanvasTexture(cv);
    _groundTextureDirty = false;
    return _groundTexture;
  }
  function buildGroundTextureCanvas() {
    if (typeof document === 'undefined') return null;
    if (!_groundPatterns) _groundPatterns = buildGroundPatterns();
    var cv = document.createElement('canvas');
    cv.width = TEXTURE_SIZE; cv.height = TEXTURE_SIZE;
    var ctx = cv.getContext('2d');
    if (!ctx) return null;
    var plan = paintGridToTexturePlan(_paints, SEGMENTS, _heights, { textureSize: TEXTURE_SIZE });
    var cellPx = plan.cellPx;
    var rng = mulberry32(4242);
    for (var i = 0; i < plan.cellsList.length; i++) {
      var cell = plan.cellsList[i];
      var pat = _groundPatterns[cell.pattern] || _groundPatterns[0];
      var ox = Math.floor(rng() * (128 - cellPx));
      var oy = Math.floor(rng() * (128 - cellPx));
      ctx.drawImage(pat, ox, oy, cellPx, cellPx, cell.x * cellPx, cell.z * cellPx, cellPx, cellPx);
    }
    return cv;
  }
  function buildGroundPatterns() {
    var out = [];
    for (var m = 0; m < PATTERN_NAMES.length; m++) out.push(makeGroundPattern(m));
    return out;
  }
  function makeGroundPattern(mat) {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var ctx = cv.getContext('2d');
    if (!ctx) return cv;
    var base = PATTERN_BASE[mat] || '#888888';
    var rng = mulberry32(1000 + mat * 131);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);
    function shade(hex, f) {
      var n = parseInt(hex.slice(1), 16);
      var r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
      var g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
      var b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }
    /* Nhiễu đốm chung cho mọi loại đất. */
    for (var i = 0; i < 1800; i++) {
      ctx.fillStyle = rng() < 0.5 ? shade(base, 0.75) : shade(base, 1.25);
      ctx.globalAlpha = 0.12 + rng() * 0.25;
      var s = 1 + Math.floor(rng() * 2);
      ctx.fillRect(Math.floor(rng() * 128), Math.floor(rng() * 128), s, s);
    }
    ctx.globalAlpha = 1;
    var k, x, y;
    if (mat === 0) { // cỏ: sợi cỏ
      for (k = 0; k < 260; k++) {
        ctx.strokeStyle = rng() < 0.5 ? shade(base, 0.7) : shade(base, 1.35);
        ctx.globalAlpha = 0.35 + rng() * 0.4;
        x = rng() * 128; y = rng() * 128;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 3, y - 3 - rng() * 4); ctx.stroke();
      }
    } else if (mat === 1) { // đất: cục đất
      for (k = 0; k < 45; k++) {
        ctx.fillStyle = shade(base, 0.65 + rng() * 0.4);
        ctx.globalAlpha = 0.4 + rng() * 0.4;
        ctx.beginPath(); ctx.arc(rng() * 128, rng() * 128, 2 + rng() * 4, 0, Math.PI * 2); ctx.fill();
      }
    } else if (mat === 2) { // đá: vết nứt
      for (k = 0; k < 12; k++) {
        ctx.strokeStyle = shade(base, 0.6);
        ctx.globalAlpha = 0.5 + rng() * 0.3;
        x = rng() * 128; y = rng() * 128;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (var s2 = 0; s2 < 5; s2++) { x += (rng() - 0.5) * 24; y += (rng() - 0.5) * 24; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    } else if (mat === 3) { // cát: hạt mịn
      for (k = 0; k < 1200; k++) {
        ctx.fillStyle = rng() < 0.5 ? shade(base, 0.8) : shade(base, 1.15);
        ctx.globalAlpha = 0.2 + rng() * 0.3;
        ctx.fillRect(Math.floor(rng() * 128), Math.floor(rng() * 128), 1, 1);
      }
    } else if (mat === 4) { // nước: gợn sóng ngang
      for (k = 0; k < 26; k++) {
        ctx.strokeStyle = shade(base, 1.3);
        ctx.globalAlpha = 0.25 + rng() * 0.35;
        y = rng() * 128;
        ctx.beginPath(); ctx.moveTo(0, y);
        for (var x3 = 0; x3 <= 128; x3 += 16) ctx.lineTo(x3, y + Math.sin(x3 / 16 + k) * 2);
        ctx.stroke();
      }
    } else { // tuyết: lấp lánh
      for (k = 0; k < 300; k++) {
        ctx.fillStyle = rng() < 0.7 ? '#ffffff' : '#cfe0ee';
        ctx.globalAlpha = 0.4 + rng() * 0.5;
        ctx.fillRect(Math.floor(rng() * 128), Math.floor(rng() * 128), 1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
      }
    }
    ctx.globalAlpha = 1;
    return cv;
  }

  /* ---- Brush preview: vòng tròn wireframe theo size tại điểm chuột. ---- */
  function showBrushPreview(x, z, size) {
    if (typeof THREE === 'undefined') return null;
    var scene = ED.Viewport && ED.Viewport.scene;
    if (!scene) return null;
    size = size || _brush.size;
    if (!_preview) {
      var pts = [];
      var SEG = 40;
      for (var i = 0; i <= SEG; i++) {
        var a = i / SEG * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
      }
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      _preview = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfacc15 }));
      scene.add(_preview);
    }
    _preview.visible = true;
    _preview.scale.set(size / 2, 1, size / 2);
    _preview.position.set(x, heightAt(x, z) + 0.15, z);
    return _preview;
  }
  function hideBrushPreview() { if (_preview) _preview.visible = false; }

  /* ---- UI: chọn brush/mode, slider size/strength, chọn chất liệu paint.
     Gắn vào #terrain-panel do nhóm A tạo; chưa có thì tự tạo fallback.
     Slider chỉ markDirty khi kéo; pushHistory 1 lần khi thả (change). ---- */
  var _panel = null;
  function setBrush(partial) {
    if (!partial) return _brush;
    if (partial.mode) _brush.mode = partial.mode;
    if (partial.size != null) _brush.size = clamp(Number(partial.size) || 6, 1, 30);
    if (partial.strength != null) _brush.strength = clamp(Number(partial.strength) || 0.5, 0, 2);
    if (partial.falloff != null) _brush.falloff = clamp(Number(partial.falloff) || 0, 0, 1);
    if (partial.paint != null) _brush.paint = clamp(Math.round(Number(partial.paint) || 0), 0, 4);
    return _brush;
  }
  function getBrush() { return { mode: _brush.mode, size: _brush.size, strength: _brush.strength, falloff: _brush.falloff, paint: _brush.paint }; }

  function init() {
    syncFromProject();
    rebuildMesh();
    if (typeof document === 'undefined') return;
    var panel = document.getElementById('terrain-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'terrain-panel';
      panel.className = 'ed-terrain-panel-fallback';
      document.body.appendChild(panel);
    }
    _panel = panel;
    var h = '<div class="ed-panel-title">⛰ Địa hình</div>' +
      '<div class="ed-row"><label>Brush</label><select id="ed-brush-mode">' +
      '<option value="raise">Nâng (Raise)</option><option value="lower">Hạ (Lower)</option>' +
      '<option value="smooth">Mịn (Smooth)</option><option value="flatten">San phẳng (Flatten)</option>' +
      '</select></div>' +
      '<div class="ed-row"><label>Kích thước <span id="ed-brush-size-v">6</span></label>' +
      '<input id="ed-brush-size" type="range" min="1" max="30" step="1" value="6"></div>' +
      '<div class="ed-row"><label>Lực <span id="ed-brush-str-v">0.5</span></label>' +
      '<input id="ed-brush-strength" type="range" min="0.05" max="2" step="0.05" value="0.5"></div>' +
      '<div class="ed-row"><label>Mềm mép <span id="ed-brush-fall-v">0.7</span></label>' +
      '<input id="ed-brush-falloff" type="range" min="0" max="1" step="0.05" value="0.7"></div>' +
      '<div class="ed-row"><label>Chất liệu</label><select id="ed-paint-mat">' +
      PAINT_NAMES.map(function (n, i) { return '<option value="' + i + '">' + n + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="ed-row"><button id="ed-paint-apply">🖌 Tô chất liệu tại tâm</button>' +
      '<button id="ed-terrain-flat">San phẳng toàn map</button></div>' +
      '<div class="ed-panel-title">🖼 Heightmap</div>' +
      '<div class="ed-row"><label>Cao tối đa <span id="ed-hm-max-v">8</span></label>' +
      '<input id="ed-hm-max" type="range" min="1" max="20" step="1" value="8"></div>' +
      '<div class="ed-row"><button id="ed-heightmap-import">🖼 Nhập Heightmap (ảnh xám)</button></div>' +
      '<div class="ed-panel-title">🌊 Xói mòn</div>' +
      '<div class="ed-row"><label>Số lượt <span id="ed-erode-n-v">5</span></label>' +
      '<input id="ed-erode-n" type="range" min="1" max="20" step="1" value="5"></div>' +
      '<div class="ed-row"><button id="ed-erode">🌊 Xói mòn</button></div>' +
      '<div class="ed-panel-title">🗺 Texture đất + Chunk</div>' +
      '<div class="ed-row ed-check-row"><label><input id="ed-terrain-tex" type="checkbox"> Dùng texture đất</label></div>' +
      '<div class="ed-row"><span id="ed-chunk-info" class="ed-hint">Chunk: 16 · hiện: 16 · đỉnh: 4624</span></div>' +
      '<div class="ed-panel-title">📥 Heightmap .raw/.r16</div>' +
      '<div class="ed-row"><label>Lưới</label><select id="ed-raw-grid">' +
      '<option value="0">Tự động (theo file)</option><option value="64">64×64</option>' +
      '<option value="96">96×96</option><option value="128">128×128</option></select></div>' +
      '<div class="ed-row"><button id="ed-raw-import">📥 Nhập heightmap .raw/.r16</button></div>' +
      '<div class="ed-row"><span class="ed-hint">File nhị phân 16-bit little-endian, N×N×2 byte; cao tối đa lấy theo slider Heightmap ở trên.</span></div>' +
      '<div class="ed-panel-title">🌊 Xói mòn thủy lực</div>' +
      '<div class="ed-row"><label>Số giọt <span id="ed-hydro-drops-v">2000</span></label>' +
      '<input id="ed-hydro-drops" type="range" min="500" max="10000" step="500" value="2000"></div>' +
      '<div class="ed-row"><label>Cường độ <span id="ed-hydro-str-v">1.0</span></label>' +
      '<input id="ed-hydro-str" type="range" min="0.1" max="2" step="0.1" value="1"></div>' +
      '<div class="ed-row"><button id="ed-hydro-erode">🌊 Xói mòn thủy lực</button>' +
      '<button id="ed-hydro-cancel">Hủy</button></div>' +
      '<div class="ed-progress"><div id="ed-hydro-fill" class="ed-progress-fill"></div></div>' +
      '<div class="ed-row"><span id="ed-hydro-status" class="ed-hint">Chưa chạy.</span></div>' +
      '<div class="ed-panel-title">🌊 Xói mòn dòng chảy (đợt 5)</div>' +
      '<div class="ed-row"><label>Số lượt <span id="ed-flow-passes-v">5</span></label>' +
      '<input id="ed-flow-passes" type="range" min="1" max="20" step="1" value="5"></div>' +
      '<div class="ed-row"><label>Cường độ <span id="ed-flow-str-v">1.0</span></label>' +
      '<input id="ed-flow-str" type="range" min="0.1" max="2" step="0.1" value="1"></div>' +
      '<div class="ed-row"><button id="ed-flow-erode">🌊 Xói mòn dòng chảy</button>' +
      '<button id="ed-flow-cancel">Hủy</button></div>' +
      '<div class="ed-progress"><div id="ed-flow-fill" class="ed-progress-fill"></div></div>' +
      '<div class="ed-row"><span id="ed-flow-status" class="ed-hint">Chưa chạy.</span></div>' +
      '<div class="ed-row"><span id="ed-lod-info" class="ed-hint">LOD: 16×mức 0 · 0×mức 1 · 0×mức 2</span></div>' +
      '<div class="ed-panel-title">🗺 Kích thước map (đợt 6)</div>' +
      '<div class="ed-row"><span class="ed-hint">Hiện tại: <b id="ed-map-size-v">96</b> · lưới vẫn 65×65 đỉnh, chỉ đổi tỉ lệ ô (1.5 / 2 / 3).</span></div>' +
      '<div class="ed-row"><button type="button" data-map-size="96">96</button><button type="button" data-map-size="128">128</button><button type="button" data-map-size="192">192</button></div>' +
      '<div class="ed-panel-title">🗺 Vùng (Regions)</div>' +
      '<div class="ed-row"><input id="ed-region-name" type="text" value="Vùng 1" maxlength="30" placeholder="Tên vùng"></div>' +
      '<div class="ed-row"><label>Preset</label><select id="ed-region-preset">' +
      '<option value="thanh-co">Thành cổ</option><option value="rung-truc">Rừng trúc</option>' +
      '<option value="nui-tuyet">Núi tuyết</option><option value="chua">Chùa</option><option value="vo-dai">Võ đài</option>' +
      '</select></div>' +
      '<div class="ed-row"><button type="button" id="ed-region-pick1">📍 Chọn góc 1</button><button type="button" id="ed-region-pick2">📍 Chọn góc 2</button></div>' +
      '<div class="ed-row"><span id="ed-region-status" class="ed-hint">Chưa chọn góc nào.</span></div>' +
      '<div class="ed-row"><button type="button" id="ed-region-add">➕ Thêm vùng</button></div>' +
      '<div id="ed-region-list"></div>' +
      '<div class="ed-row ed-check-row"><label><input id="ed-region-autoswitch" type="checkbox"> Tự đổi preset khi vào vùng</label></div>' +
      '<div class="ed-panel-title">〰️ Spline: đường / sông / hàng rào</div>' +
      '<div class="ed-row"><button type="button" data-spline-kind="road">🛤 Đường đi</button><button type="button" data-spline-kind="river">🌊 Sông</button><button type="button" data-spline-kind="fence">🪵 Hàng rào</button></div>' +
      '<div class="ed-row"><label>Rộng <span id="ed-spline-width-v">2</span></label>' +
      '<input id="ed-spline-width" type="range" min="0.5" max="10" step="0.5" value="2"></div>' +
      '<div class="ed-row"><span id="ed-spline-status" class="ed-hint">Chưa vẽ spline.</span></div>' +
      '<div class="ed-row"><button type="button" id="ed-spline-finish">✓ Xong (Enter)</button><button type="button" id="ed-spline-cancel">✕ Huỷ (Esc)</button></div>' +
      '<div class="ed-row"><span class="ed-hint">Bấm nút loại spline rồi bấm nhiều điểm xuống đất. Bấm đúp / Enter để kết thúc, Esc để huỷ. Đường đi: làm phẳng + tô đất dọc spline. Sông: đầu mút gần ô nước (≤3 ô) sẽ tự nối tới ô nước đó.</span></div>' +
      '<div class="ed-panel-title">🌿 Cọ rải (Scatter)</div>' +
      '<div class="ed-row"><label>Loại</label><select id="ed-scatter-kind"><option value="tree">Cây</option><option value="rock">Đá</option><option value="grass">Cỏ</option></select></div>' +
      '<div class="ed-row"><label>Bán kính <span id="ed-scatter-radius-v">4</span></label>' +
      '<input id="ed-scatter-radius" type="range" min="1" max="10" step="0.5" value="4"></div>' +
      '<div class="ed-row"><label>Mật độ <span id="ed-scatter-density-v">10</span></label>' +
      '<input id="ed-scatter-density" type="range" min="1" max="50" step="1" value="10"></div>' +
      '<div class="ed-row"><label>Seed</label><input id="ed-scatter-seed" type="number" value="1"><button type="button" id="ed-scatter-newseed">🎲 Đổi seed</button></div>' +
      '<div class="ed-row"><button type="button" id="ed-scatter-mode">🌿 Bật cọ rải</button><button type="button" id="ed-scatter-center">🎯 Rải tại giữa màn hình</button></div>' +
      '<div class="ed-row"><span id="ed-scatter-status" class="ed-hint">Cọ rải đang tắt. Bật cọ rồi chạm xuống đất để rải 1 nhát (tối đa 200/nhát).</span></div>' +
      '<div class="ed-hint">Kéo chuột trên viewport ở chế độ Địa hình để nâng/hạ đất; giữ để tô. Heightmap: ảnh xám, trắng = cao nhất, đen = thấp nhất; ảnh lớn tự thu nhỏ về 512px.</div>';
    panel.innerHTML = h;
    var mode = panel.querySelector('#ed-brush-mode');
    mode.addEventListener('change', function () { setBrush({ mode: mode.value }); });
    function bindSlider(id, labelId, key, fmt) {
      var el = panel.querySelector(id), lab = panel.querySelector(labelId);
      el.addEventListener('input', function () {
        var o = {}; o[key] = Number(el.value); setBrush(o);
        lab.textContent = fmt(Number(el.value));
      });
      el.addEventListener('change', function () { endStroke('Terrain: ' + key); });
    }
    bindSlider('#ed-brush-size', '#ed-brush-size-v', 'size', function (v) { return String(v); });
    bindSlider('#ed-brush-strength', '#ed-brush-str-v', 'strength', function (v) { return v.toFixed(2); });
    bindSlider('#ed-brush-falloff', '#ed-brush-fall-v', 'falloff', function (v) { return v.toFixed(2); });
    var pm = panel.querySelector('#ed-paint-mat');
    pm.addEventListener('change', function () { setBrush({ paint: Number(pm.value) }); });
    panel.querySelector('#ed-paint-apply').addEventListener('click', function () {
      var cam = ED.Viewport && ED.Viewport.camera;
      var p = cam ? { x: cam.position.x, z: cam.position.z } : { x: 0, z: 0 };
      paintAt(p.x, p.z, _brush.paint, _brush.size);
      if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast('Đã tô ' + PAINT_NAMES[_brush.paint]);
    });
    panel.querySelector('#ed-terrain-flat').addEventListener('click', function () {
      if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: san phẳng');
      _heights = makeHeights();
      syncToProject(); markDirtyPush(); rebuildMesh();
    });

    /* ---- Đợt 2: heightmap import + erosion. ---- */
    var hmMax = panel.querySelector('#ed-hm-max');
    var hmMaxLab = panel.querySelector('#ed-hm-max-v');
    hmMax.addEventListener('input', function () {
      setHeightmapMax(Number(hmMax.value));
      hmMaxLab.textContent = String(_maxHeight);
    });
    var erodeN = panel.querySelector('#ed-erode-n');
    var erodeNLab = panel.querySelector('#ed-erode-n-v');
    erodeN.addEventListener('input', function () {
      setErodeIterations(Number(erodeN.value));
      erodeNLab.textContent = String(_erodeIterations);
    });
    panel.querySelector('#ed-erode').addEventListener('click', function () {
      erode(_erodeIterations);
      if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast('Đã xói mòn ' + _erodeIterations + ' lượt.');
    });
    /* File picker ảnh xám: đọc qua Image + canvas (thu nhỏ về tối đa
       512px cạnh dài để getImageData nhẹ trên điện thoại), lấy kênh R. */
    var hmPicker = document.createElement('input');
    hmPicker.type = 'file';
    hmPicker.accept = 'image/*';
    hmPicker.style.display = 'none';
    panel.appendChild(hmPicker);
    panel.querySelector('#ed-heightmap-import').addEventListener('click', function () { hmPicker.click(); });
    hmPicker.addEventListener('change', function () {
      var f = hmPicker.files && hmPicker.files[0];
      hmPicker.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type || '')) {
        if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast('Chọn 1 file ảnh (png/jpg).');
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast('Không đọc được file ảnh.');
      };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () {
          if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast('Ảnh này không đọc được, thử file png/jpg khác.');
        };
        img.onload = function () {
          try {
            var scale = Math.min(1, 512 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
            var cw = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
            var ch = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
            var cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            var ctx = cv.getContext('2d');
            if (!ctx) throw new Error('canvas');
            ctx.drawImage(img, 0, 0, cw, ch);
            var data = ctx.getImageData(0, 0, cw, ch).data;
            var ok = importHeightmap(data, cw, ch, _maxHeight);
            if (ED.UI && typeof ED.UI.toast === 'function') {
              ED.UI.toast(ok ? 'Đã nhập heightmap (' + cw + '×' + ch + ', cao tối đa ' + _maxHeight + ').' : 'Nhập heightmap thất bại.');
            }
          } catch (e) {
            if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast('Nhập heightmap thất bại.');
          }
        };
        img.src = reader.result;
      };
      try { reader.readAsDataURL(f); } catch (e) {
        if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast('Không đọc được file ảnh.');
      }
    });

    /* ---- Đợt 4: texture đất, .raw/.r16, xói mòn thủy lực, chunk info. ---- */
    function toast(msg) { if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg); }
    var texToggle = panel.querySelector('#ed-terrain-tex');
    texToggle.checked = _useGroundTexture;
    texToggle.addEventListener('change', function () {
      setUseGroundTexture(texToggle.checked);
      toast(texToggle.checked ? 'Đã bật texture đất.' : 'Đã tắt texture đất (màu đỉnh).');
    });
    updateChunkInfoLine();
    updateLodInfoLine();
    var rawGrid = panel.querySelector('#ed-raw-grid');
    rawGrid.value = String(_rawGridSize);
    rawGrid.addEventListener('change', function () { setRawGridSize(Number(rawGrid.value)); });
    var rawPicker = document.createElement('input');
    rawPicker.type = 'file';
    rawPicker.accept = '.raw,.r16';
    rawPicker.style.display = 'none';
    panel.appendChild(rawPicker);
    panel.querySelector('#ed-raw-import').addEventListener('click', function () { rawPicker.click(); });
    rawPicker.addEventListener('change', function () {
      var f = rawPicker.files && rawPicker.files[0];
      rawPicker.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onerror = function () { toast('Không đọc được file .raw/.r16.'); };
      reader.onload = function () {
        var res;
        try {
          res = importRawHeightmap(new Uint8Array(reader.result), _rawGridSize || null, _maxHeight);
        } catch (e) {
          res = { ok: false, error: 'File lỗi: ' + (e && e.message ? e.message : e) };
        }
        toast(res.ok
          ? 'Đã nhập heightmap .raw ' + res.gridSize + '×' + res.gridSize + ' (cao tối đa ' + _maxHeight + ').'
          : (res.error || 'Nhập heightmap .raw thất bại.'));
      };
      try { reader.readAsArrayBuffer(f); } catch (e) { toast('Không đọc được file .raw/.r16.'); }
    });
    var hydroDrops = panel.querySelector('#ed-hydro-drops');
    var hydroDropsLab = panel.querySelector('#ed-hydro-drops-v');
    var hydroStr = panel.querySelector('#ed-hydro-str');
    var hydroStrLab = panel.querySelector('#ed-hydro-str-v');
    var hydroBtn = panel.querySelector('#ed-hydro-erode');
    var hydroCancel = panel.querySelector('#ed-hydro-cancel');
    var hydroFill = panel.querySelector('#ed-hydro-fill');
    var hydroStatus = panel.querySelector('#ed-hydro-status');
    hydroDrops.addEventListener('input', function () {
      setHydroSettings({ droplets: Number(hydroDrops.value) });
      hydroDropsLab.textContent = String(_hydro.droplets);
    });
    hydroStr.addEventListener('input', function () {
      setHydroSettings({ strength: Number(hydroStr.value) });
      hydroStrLab.textContent = Number(_hydro.strength).toFixed(1);
    });
    hydroCancel.disabled = true;
    hydroBtn.addEventListener('click', function () {
      if (isEroding()) return;
      hydroBtn.disabled = true;
      hydroCancel.disabled = false;
      hydroFill.style.width = '0%';
      hydroStatus.textContent = 'Đang xói mòn: 0/' + _hydro.droplets + ' giọt…';
      erodeDropletsAsync(_hydro.droplets, _hydro.strength, function (done, total) {
        var pct = Math.round(done / total * 100);
        hydroFill.style.width = pct + '%';
        hydroStatus.textContent = 'Đang xói mòn: ' + done + '/' + total + ' giọt (' + pct + '%)…';
      }, function (res) {
        hydroBtn.disabled = false;
        hydroCancel.disabled = true;
        if (res.cancelled) {
          hydroStatus.textContent = 'Đã hủy sau ' + res.done + ' giọt (địa hình giữ nguyên).';
          toast('Đã hủy xói mòn.');
        } else {
          hydroFill.style.width = '100%';
          hydroStatus.textContent = 'Xong: ' + res.done + ' giọt.';
          toast('Đã xói mòn thủy lực (' + res.done + ' giọt).');
        }
      });
    });
    hydroCancel.addEventListener('click', function () {
      if (cancelErodeDroplets()) {
        hydroBtn.disabled = false;
        hydroCancel.disabled = true;
        hydroStatus.textContent = 'Đã hủy (địa hình giữ nguyên).';
      }
    });

    /* ---- Đợt 5: xói mòn dòng chảy (từng lượt, có Hủy) + dòng LOD. ---- */
    var flowPasses = panel.querySelector('#ed-flow-passes');
    var flowPassesLab = panel.querySelector('#ed-flow-passes-v');
    var flowStr = panel.querySelector('#ed-flow-str');
    var flowStrLab = panel.querySelector('#ed-flow-str-v');
    var flowBtn = panel.querySelector('#ed-flow-erode');
    var flowCancel = panel.querySelector('#ed-flow-cancel');
    var flowFill = panel.querySelector('#ed-flow-fill');
    var flowStatus = panel.querySelector('#ed-flow-status');
    flowPasses.addEventListener('input', function () {
      setFlowSettings({ passes: Number(flowPasses.value) });
      flowPassesLab.textContent = String(_flowSettings.passes);
    });
    flowStr.addEventListener('input', function () {
      setFlowSettings({ strength: Number(flowStr.value) });
      flowStrLab.textContent = Number(_flowSettings.strength).toFixed(1);
    });
    flowCancel.disabled = true;
    flowBtn.addEventListener('click', function () {
      if (isErodingFlow()) return;
      flowBtn.disabled = true;
      flowCancel.disabled = false;
      flowFill.style.width = '0%';
      flowStatus.textContent = 'Đang xói mòn dòng chảy: 0/' + _flowSettings.passes + ' lượt…';
      erodeFlowAsync(_flowSettings.passes, _flowSettings.strength, function (done, total) {
        var pct = Math.round(done / total * 100);
        flowFill.style.width = pct + '%';
        flowStatus.textContent = 'Đang xói mòn dòng chảy: ' + done + '/' + total + ' lượt (' + pct + '%)…';
      }, function (res) {
        flowBtn.disabled = false;
        flowCancel.disabled = true;
        if (res.cancelled) {
          flowStatus.textContent = 'Đã hủy sau ' + res.done + ' lượt (địa hình giữ nguyên).';
          toast('Đã hủy xói mòn dòng chảy.');
        } else {
          flowFill.style.width = '100%';
          var fm = edTerrainFlowMap(_heights, SEGMENTS);
          var mf = 0;
          for (var i = 0; i < fm.flow.length; i++) if (fm.flow[i] > mf) mf = fm.flow[i];
          flowStatus.textContent = 'Xong: ' + res.done + ' lượt · dòng chảy lớn nhất: ' + mf + '.';
          toast('Đã xói mòn dòng chảy (' + res.done + ' lượt).');
        }
      });
    });
    flowCancel.addEventListener('click', function () {
      if (cancelErodeFlow()) {
        flowBtn.disabled = false;
        flowCancel.disabled = true;
        flowStatus.textContent = 'Đã hủy (địa hình giữ nguyên).';
      }
    });

    /* ---- Đợt 6: kích thước map / regions / spline / scatter. ---- */
    var sizeBtns = panel.querySelectorAll('[data-map-size]');
    for (var sb = 0; sb < sizeBtns.length; sb++) {
      sizeBtns[sb].addEventListener('click', function () {
        var before = getSize();
        setSize(Number(this.getAttribute('data-map-size')));
        if (getSize() !== before) toast('Đã đổi kích thước map thành ' + getSize() + ' (lưới vẫn 65×65 đỉnh).');
        updateMapSizeLine();
      });
    }
    updateMapSizeLine();
    var regionName = panel.querySelector('#ed-region-name');
    var regionPreset = panel.querySelector('#ed-region-preset');
    var regionAuto = panel.querySelector('#ed-region-autoswitch');
    regionAuto.checked = _autoSwitchRegion;
    regionAuto.addEventListener('change', function () {
      setAutoSwitchRegion(regionAuto.checked);
      toast(regionAuto.checked ? 'Đã bật tự đổi preset khi vào vùng.' : 'Đã tắt tự đổi preset khi vào vùng.');
    });
    panel.querySelector('#ed-region-pick1').addEventListener('click', function () { startRegionPick(1); });
    panel.querySelector('#ed-region-pick2').addEventListener('click', function () { startRegionPick(2); });
    panel.querySelector('#ed-region-add').addEventListener('click', function () {
      if (!_regionPick || !_regionPick.corner1 || !_regionPick.corner2) { toast('Chọn góc 1 rồi góc 2 trước (bấm xuống đất).'); return; }
      var r = addRegion(regionName.value, _regionPick.corner1.x, _regionPick.corner1.z, _regionPick.corner2.x, _regionPick.corner2.z, regionPreset.value);
      if (!r) { toast('Không thêm được vùng (2 góc trùng nhau?).'); return; }
      _regionPick = { step: 0, corner1: null, corner2: null };
      setGroundMode(null);
      updateRegionStatus();
      renderRegionList();
      regionName.value = 'Vùng ' + (_regions.length + 1);
      toast('Đã thêm vùng ' + r.name + '.');
    });
    renderRegionList();
    updateRegionStatus();
    var splineWidth = panel.querySelector('#ed-spline-width');
    var splineWidthLab = panel.querySelector('#ed-spline-width-v');
    splineWidth.addEventListener('input', function () {
      _splineSettings.width = clamp(Number(splineWidth.value) || 2, 0.5, 10);
      splineWidthLab.textContent = String(_splineSettings.width);
      if (_splineDraft) _splineDraft.width = _splineSettings.width;
    });
    var splineBtns = panel.querySelectorAll('[data-spline-kind]');
    for (var sp = 0; sp < splineBtns.length; sp++) {
      splineBtns[sp].addEventListener('click', function () {
        startSplineDraw(this.getAttribute('data-spline-kind'));
      });
    }
    panel.querySelector('#ed-spline-finish').addEventListener('click', function () { finishSpline(); });
    panel.querySelector('#ed-spline-cancel').addEventListener('click', function () { cancelSpline(); });
    updateSplineStatus();
    var scatterKind = panel.querySelector('#ed-scatter-kind');
    var scatterRadius = panel.querySelector('#ed-scatter-radius');
    var scatterRadiusLab = panel.querySelector('#ed-scatter-radius-v');
    var scatterDensity = panel.querySelector('#ed-scatter-density');
    var scatterDensityLab = panel.querySelector('#ed-scatter-density-v');
    var scatterSeed = panel.querySelector('#ed-scatter-seed');
    scatterKind.value = _scatterSettings.kind;
    scatterKind.addEventListener('change', function () { _scatterSettings.kind = scatterKind.value; });
    scatterRadius.addEventListener('input', function () {
      _scatterSettings.radius = clamp(Number(scatterRadius.value) || 4, 1, 10);
      scatterRadiusLab.textContent = String(_scatterSettings.radius);
    });
    scatterDensity.addEventListener('input', function () {
      _scatterSettings.density = clamp(Math.round(Number(scatterDensity.value)) || 10, 1, 50);
      scatterDensityLab.textContent = String(_scatterSettings.density);
    });
    scatterSeed.addEventListener('change', function () {
      var s = Math.floor(Number(scatterSeed.value));
      _scatterSettings.seed = isFinite(s) ? (s >>> 0) : 1;
    });
    panel.querySelector('#ed-scatter-newseed').addEventListener('click', function () {
      _scatterSettings.seed = Math.floor(Math.random() * 1000000000) >>> 0;
      scatterSeed.value = String(_scatterSettings.seed);
    });
    panel.querySelector('#ed-scatter-mode').addEventListener('click', function () {
      if (_groundMode && _groundMode.kind === 'scatter') { setGroundMode(null); updateScatterStatus(); }
      else { setGroundMode({ kind: 'scatter' }); updateScatterStatus(); toast('Cọ rải BẬT: chạm xuống đất để rải 1 nhát.'); }
    });
    panel.querySelector('#ed-scatter-center').addEventListener('click', function () {
      var c = null;
      try { if (ED.Viewport && typeof ED.Viewport.getCameraFront === 'function') c = ED.Viewport.getCameraFront(8); } catch (e) {}
      if (!c) {
        try {
          var cam = ED.Viewport && typeof ED.Viewport.getCamera === 'function' ? ED.Viewport.getCamera() : null;
          if (cam && cam.position) c = [cam.position.x, cam.position.z];
        } catch (e2) {}
      }
      if (!c) c = [0, 0];
      var so = addScatter(_scatterSettings.kind, c[0], c[1], _scatterSettings);
      if (so) toast('Đã rải ' + so.extra.count + ' ' + (SCATTER_NAMES[_scatterSettings.kind] || '') + ' tại giữa màn hình.');
    });
    updateScatterStatus();
    /* Badge tên vùng + phím tắt spline (Enter xong, Esc huỷ). */
    ensureRegionBadge();
    if (typeof setInterval !== 'undefined' && !_badgeTimer) {
      _badgeTimer = setInterval(refreshRegionBadge, 300);
    }
    if (typeof window !== 'undefined' && window.addEventListener && !_keyBound) {
      _keyBound = true;
      window.addEventListener('keydown', function (e) {
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
        if (e.key === 'Enter' && _splineDraft) { e.preventDefault(); finishSpline(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelGroundMode(); }
      });
    }
  }

  return {
    get SIZE() { return SIZE; }, // đợt 6: live (đọc sau setSize vẫn đúng)
    set SIZE(v) { setSize(v); },
    SEGMENTS: SEGMENTS, COUNT: COUNT, PAINT_NAMES: PAINT_NAMES,
    PAINT_COLORS: PAINT_COLORS,
    CHUNK_COUNT: CHUNK_COUNT, CHUNK_SEGMENTS: CHUNK_SEGMENTS, CHUNK_VERTS: CHUNK_VERTS,
    CHUNK_TOTAL: CHUNK_TOTAL, TEXTURE_SIZE: TEXTURE_SIZE, SNOW_LINE: SNOW_LINE,
    SNOW_PATTERN: SNOW_PATTERN, PATTERN_NAMES: PATTERN_NAMES, PATTERN_BASE: PATTERN_BASE,
    mulberry32: mulberry32,
    reset: reset, makeHeights: makeHeights, makePaints: makePaints,
    brushHeights: brushHeights, paintHeights: paintHeights,
    heightAtArray: heightAtArray, heightAt: heightAt, worldToGrid: worldToGrid,
    edTerrainHeightsFromPixels: edTerrainHeightsFromPixels,
    edTerrainErode: edTerrainErode,
    paintGridToTexturePlan: paintGridToTexturePlan,
    parseRawHeightmap: parseRawHeightmap, detectRawGridSize: detectRawGridSize,
    importRawHeightmap: importRawHeightmap,
    chunkLayout: chunkLayout, chunkCells: chunkCells,
    getChunkInfo: getChunkInfo, getChunkMeshes: getChunkMeshes,
    LOD_SEGMENTS: LOD_SEGMENTS, LOD_STEPS: LOD_STEPS,
    edTerrainLodLevel: edTerrainLodLevel, edTerrainLodNextLevel: edTerrainLodNextLevel,
    edTerrainLodGrid: edTerrainLodGrid,
    updateLod: updateLod, getLodInfo: getLodInfo, getLodLevels: getLodLevels,
    getLodThresholds: getLodThresholds, setLodThresholds: setLodThresholds,
    rebuildChunkMesh: rebuildChunkMesh,
    setUseGroundTexture: setUseGroundTexture, getUseGroundTexture: getUseGroundTexture,
    getGroundTexture: getGroundTexture, buildGroundTextureCanvas: buildGroundTextureCanvas,
    getRawGridSize: getRawGridSize, setRawGridSize: setRawGridSize,
    getHydroSettings: getHydroSettings, setHydroSettings: setHydroSettings,
    erodeStep: erodeStep, erodeDropletsAsync: erodeDropletsAsync,
    cancelErodeDroplets: cancelErodeDroplets, isEroding: isEroding,
    FLOW_DIRS: FLOW_DIRS, edTerrainFlowMap: edTerrainFlowMap,
    edTerrainErodeFlow: edTerrainErodeFlow,
    getFlowSettings: getFlowSettings, setFlowSettings: setFlowSettings,
    erodeFlowAsync: erodeFlowAsync, cancelErodeFlow: cancelErodeFlow,
    isErodingFlow: isErodingFlow,
    importHeightmap: importHeightmap, erode: erode,
    getHeightmapMax: getHeightmapMax, setHeightmapMax: setHeightmapMax,
    getErodeIterations: getErodeIterations, setErodeIterations: setErodeIterations,
    getHeights: getHeights, getPaints: getPaints, setHeights: setHeights, setPaints: setPaints,
    applyBrush: applyBrush, paintAt: paintAt, applyBrushLive: applyBrushLive,
    paintLive: paintLive, endStroke: endStroke,
    syncFromProject: syncFromProject, syncToProject: syncToProject,
    defaultTerrain: defaultTerrain, rebuildMesh: rebuildMesh, getMesh: getMesh,
    showBrushPreview: showBrushPreview, hideBrushPreview: hideBrushPreview,
    setBrush: setBrush, getBrush: getBrush,
    /* Đợt 6: map lớn / regions / spline / scatter. */
    MAP_SIZES: MAP_SIZES, getSize: getSize, setSize: setSize,
    REGION_PRESETS: REGION_PRESETS, PRESET_NAMES: PRESET_NAMES,
    regionAt: regionAt, getRegions: getRegions, getRegion: getRegion,
    addRegion: addRegion, removeRegion: removeRegion,
    applyRegionPreset: applyRegionPreset,
    setAutoSwitchRegion: setAutoSwitchRegion, getAutoSwitchRegion: getAutoSwitchRegion,
    refreshRegionBadge: refreshRegionBadge,
    SPLINE_KINDS: SPLINE_KINDS, SPLINE_NAMES: SPLINE_NAMES,
    splineNearestPoint: splineNearestPoint, splineFlatten: splineFlatten,
    roadCells: roadCells, extendRiverToWater: extendRiverToWater,
    resamplePolyline: resamplePolyline,
    addSpline: addSpline, buildSplineGroup: buildSplineGroup, tick: tick,
    getSplineDraft: getSplineDraft,
    startSplineDraw: startSplineDraw, finishSpline: finishSpline, cancelSpline: cancelSpline,
    SCATTER_KINDS: SCATTER_KINDS, SCATTER_NAMES: SCATTER_NAMES,
    scatterPositions: scatterPositions, scatterStrokeCount: scatterStrokeCount,
    addScatter: addScatter, buildScatterGroup: buildScatterGroup,
    getScatterSettings: getScatterSettings,
    setGroundMode: setGroundMode, getGroundMode: getGroundMode,
    startRegionPick: startRegionPick, cancelGroundMode: cancelGroundMode,
    init: init
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
