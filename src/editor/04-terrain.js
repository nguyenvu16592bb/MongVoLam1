/* ============================================================================
   Map Editor — 04-terrain.js (nhóm B)
   ED.Terrain — heightmap 96×96, segments 64. heights/paints lưu trong
   project.terrain (schema v1). Brush Raise/Lower/Smooth/Flatten + paint
   5 chất liệu. applyBrush/paintAt/heightAt là hàm THUẦN (đổi mảng, không
   cần DOM/THREE) để test Node bằng vm + stub THREE. rebuildMesh() cập
   nhật geometry + vertex colors khi có viewport. Terrain là object type
   'terrain' duy nhất, không xoá được (nhóm A chặn ở removeObject; ở đây
   rebuildMesh() luôn dựng lại mesh terrain từ project).
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
    if (n > 0) { syncToProject(); markDirtyPush(); endStroke('Terrain: ' + mode); rebuildMesh(); refreshViewportTerrain(); }
    return n;
  }
  function paintAt(cx, cz, mat, size) {
    var n = paintHeights(_paints, cx, cz, mat, size);
    if (n > 0) { syncToProject(); markDirtyPush(); endStroke('Terrain: tô ' + PAINT_NAMES[mat]); rebuildMesh(); refreshViewportTerrain(); }
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
    if (n > 0) { syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain(); }
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
    syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain();
    return true;
  }
  /* Xói mòn N lượt trên heights hiện tại. Trả về true khi đã áp dụng. */
  function erode(iterations) {
    var n = (iterations == null ? _erodeIterations : clamp(Math.round(Number(iterations) || 5), 1, 20));
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Terrain: xói mòn x' + n);
    _heights = edTerrainErode(_heights, SEGMENTS, n, 0.6, 0.25);
    syncToProject(); markDirtyPush(); rebuildMesh(); refreshViewportTerrain();
    return true;
  }

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

  /* ---- Mesh: PlaneGeometry xoay -90°, y = heights, vertex color = paint. ---- */
  function rebuildMesh() {
    if (typeof THREE === 'undefined') return null;
    var scene = ED.Viewport && ED.Viewport.scene;
    if (!scene) return null;
    var geo;
    if (_mesh) {
      geo = _mesh.geometry;
    } else {
      geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
      var m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
      _mesh = new THREE.Mesh(geo, m);
      _mesh.rotation.x = -Math.PI / 2;
      _mesh.receiveShadow = true;
      _mesh.userData.isTerrain = true;
      scene.add(_mesh);
    }
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    /* PlaneGeometry: đỉnh (ix, iz) với iz=0 ở y=+48 (hàng đầu). Ánh xạ:
       vertex index v = iz*65+ix, world z = 48 - iz*1.5, x = -48 + ix*1.5.
       heights lưu theo (ix, iz) với z = -48 + iz*1.5 -> iz_h = 64 - iz. */
    for (var v = 0; v < pos.count; v++) {
      var ix = v % VERTS_PER_SIDE;
      var iz = Math.floor(v / VERTS_PER_SIDE);
      var izH = SEGMENTS - iz;
      var h = _heights[idx(ix, izH)];
      pos.setZ(v, h);
      var c = PAINT_COLORS[_paints[idx(ix, izH)] || 0];
      colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2];
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return _mesh;
  }
  function getMesh() { return _mesh; }

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
  }

  return {
    SIZE: SIZE, SEGMENTS: SEGMENTS, COUNT: COUNT, PAINT_NAMES: PAINT_NAMES,
    PAINT_COLORS: PAINT_COLORS,
    reset: reset, makeHeights: makeHeights, makePaints: makePaints,
    brushHeights: brushHeights, paintHeights: paintHeights,
    heightAtArray: heightAtArray, heightAt: heightAt, worldToGrid: worldToGrid,
    edTerrainHeightsFromPixels: edTerrainHeightsFromPixels,
    edTerrainErode: edTerrainErode,
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
