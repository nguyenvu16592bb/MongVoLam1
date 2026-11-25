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
    return true;
  }
  function syncToProject() {
    var p = ED.Core && typeof ED.Core.getProject === 'function' ? ED.Core.getProject() : null;
    if (!p) p = ED.Core && ED.Core.project;
    if (!p) return false;
    if (!p.terrain) p.terrain = { size: SIZE, segments: SEGMENTS, heights: _heights, paints: _paints };
    p.terrain.size = SIZE; p.terrain.segments = SEGMENTS;
    p.terrain.heights = _heights; p.terrain.paints = _paints;
    return true;
  }
  function defaultTerrain() {
    return { size: SIZE, segments: SEGMENTS, heights: makeHeights(), paints: makePaints() };
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
  function rebuildMesh() {
    if (typeof THREE === 'undefined') return null;
    var scene = ED.Viewport && ED.Viewport.scene;
    if (!scene) return null;
    disposeChunks();
    var tex = _useGroundTexture ? getGroundTexture() : null;
    for (var cz = 0; cz < CHUNK_COUNT; cz++) {
      for (var cx = 0; cx < CHUNK_COUNT; cx++) {
        var cell = chunkCells(_heights, _paints, cx, cz);
        var geo = new THREE.PlaneGeometry(SIZE / CHUNK_COUNT, SIZE / CHUNK_COUNT, CHUNK_SEGMENTS, CHUNK_SEGMENTS);
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
        var pos = geo.attributes.position;
        var uv = geo.attributes.uv;
        var colors = new Float32Array(pos.count * 3);
        for (var v = 0; v < pos.count; v++) {
          var ix = v % CHUNK_VERTS;
          var iz = Math.floor(v / CHUNK_VERTS);
          var gx = cx * CHUNK_SEGMENTS + ix;
          var gz = cz * CHUNK_SEGMENTS + iz;
          pos.setZ(v, cell.heights[iz * CHUNK_VERTS + ix]);
          var c = PAINT_COLORS[cell.paints[iz * CHUNK_VERTS + ix] || 0];
          colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2];
          if (uv && uv.setXY) uv.setXY(v, gx / SEGMENTS, 1 - gz / SEGMENTS);
        }
        pos.needsUpdate = true;
        if (uv) uv.needsUpdate = true;
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
        scene.add(mesh);
        _chunks.push({ cx: cx, cz: cz, mesh: mesh });
      }
    }
    _mesh = _chunks.length ? _chunks[0].mesh : null;
    updateChunkInfoLine();
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
  }

  return {
    SIZE: SIZE, SEGMENTS: SEGMENTS, COUNT: COUNT, PAINT_NAMES: PAINT_NAMES,
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
    setUseGroundTexture: setUseGroundTexture, getUseGroundTexture: getUseGroundTexture,
    getGroundTexture: getGroundTexture, buildGroundTextureCanvas: buildGroundTextureCanvas,
    getRawGridSize: getRawGridSize, setRawGridSize: setRawGridSize,
    getHydroSettings: getHydroSettings, setHydroSettings: setHydroSettings,
    erodeStep: erodeStep, erodeDropletsAsync: erodeDropletsAsync,
    cancelErodeDroplets: cancelErodeDroplets, isEroding: isEroding,
    importHeightmap: importHeightmap, erode: erode,
    getHeightmapMax: getHeightmapMax, setHeightmapMax: setHeightmapMax,
    getErodeIterations: getErodeIterations, setErodeIterations: setErodeIterations,
    getHeights: getHeights, getPaints: getPaints, setHeights: setHeights, setPaints: setPaints,
    applyBrush: applyBrush, paintAt: paintAt, applyBrushLive: applyBrushLive,
    paintLive: paintLive, endStroke: endStroke,
    syncFromProject: syncFromProject, syncToProject: syncToProject,
    defaultTerrain: defaultTerrain, rebuildMesh: rebuildMesh, getMesh: getMesh,
    showBrushPreview: showBrushPreview, hideBrushPreview: hideBrushPreview,
    setBrush: setBrush, getBrush: getBrush, init: init
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
