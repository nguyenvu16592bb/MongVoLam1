/* Map Editor — 19-minimap.js (đợt 6, nhóm Minimap + Chọn nhiều + Thước đo)
   ED.Minimap: bản đồ nhỏ 2D góc dưới-phải viewport, vẽ từ trên xuống
   (địa hình theo cao + chất liệu, chấm object, hướng camera, marker hero
   Play), bấm để nhảy camera, bật/tắt (phím M) + đổi kích thước.
   KHÔNG truy cập document/window/THREE ở top-level; mọi khởi tạo trong init().
   Logic thuần (màu ô, click->world, màu chấm, góc camera) viết thành hàm
   thuần để test bằng vm. */
var ED = ED || {};

/* ---------- Hàm thuần (không DOM/THREE, test được bằng vm) ---------- */
function _minimapClamp(v, lo, hi) {
  var n = Number(v);
  if (!isFinite(n)) return lo;
  return n < lo ? lo : (n > hi ? hi : n);
}
function _minimapHex(r, g, b) {
  function h(n) {
    var s = Math.round(_minimapClamp(n, 0, 255)).toString(16);
    return s.length < 2 ? '0' + s : s;
  }
  return '#' + h(r) + h(g) + h(b);
}
function _minimapLerp(a, b, t) { return a + (b - a) * _minimapClamp(t, 0, 1); }
/* Màu 1 ô lưới theo chiều cao + chất liệu (paint: 0=cỏ 1=đất 2=đá 3=cát
   4=nước). Nước luôn xanh dương; cao >= 6 thì tuyết trắng (trừ nước);
   cỏ đổi đậm->nhạt theo cao 0..6. */
function minimapColorFor(height, paint) {
  var h = Number(height);
  if (!isFinite(h)) h = 0;
  var p = Number(paint);
  if (p === 4) return '#2f6fb2'; // nước
  if (h >= 6) return '#f2f5f7'; // tuyết
  if (p === 1) return '#8a6a42'; // đất nâu
  if (p === 2) return '#7d7d7d'; // đá xám
  if (p === 3) return '#d8c27a'; // cát vàng
  // cỏ: thấp #2f6b2f -> cao #6fae4e (nội suy theo cao 0..6).
  var t = _minimapClamp(h, 0, 6) / 6;
  return _minimapHex(
    _minimapLerp(47, 111, t), _minimapLerp(107, 174, t), _minimapLerp(47, 78, t));
}
/* Đổi tọa độ click trên canvas (px, py tính từ góc trên-trái canvas)
   thành tọa độ thế giới {x, z}. sizePx: cạnh canvas (px), mapSize: cạnh
   map thế giới (96/128/192). Góc trên-trái canvas = (-mapSize/2, -mapSize/2),
   trung tâm = (0, 0). Kẹp vào biên map. */
function minimapClickToWorld(px, py, sizePx, mapSize) {
  var s = Number(sizePx), m = Number(mapSize);
  if (!isFinite(s) || s <= 0 || !isFinite(m) || m <= 0) return { x: 0, z: 0 };
  var x = ((Number(px) || 0) / s - 0.5) * m;
  var z = ((Number(py) || 0) / s - 0.5) * m;
  var half = m / 2;
  if (x < -half) x = -half; else if (x > half) x = half;
  if (z < -half) z = -half; else if (z > half) z = half;
  return { x: x, z: z };
}
/* Chiều ngược lại: tọa độ thế giới -> px trên canvas (để vẽ chấm/tam giác). */
function minimapWorldToPx(x, z, sizePx, mapSize) {
  var s = Number(sizePx), m = Number(mapSize);
  if (!isFinite(s) || s <= 0 || !isFinite(m) || m <= 0) return { x: 0, y: 0 };
  var half = m / 2;
  return {
    x: ((Number(x) || 0) + half) / m * s,
    y: ((Number(z) || 0) + half) / m * s
  };
}
/* Màu chấm object trên minimap theo type. Trả null khi không vẽ chấm
   (nước đã vẽ nền; terrain/collider/waypoint/spline/scatter không chấm). */
function minimapDotColor(obj) {
  if (!obj || typeof obj.type !== 'string') return null;
  switch (obj.type) {
    case 'house': case 'temple': case 'bridge': case 'group': return '#facc15'; // nhà vàng
    case 'npc': return '#3b82f6'; // NPC xanh dương
    case 'monster': return '#ef4444'; // quái đỏ
    case 'character': return '#22c55e'; // nhân vật/đệ tử xanh lá
    case 'lantern': case 'light': return '#fb923c'; // đèn lồng cam
    case 'tree': return '#166534'; // cây xanh lá đậm
    case 'rock': return '#9ca3af';
    case 'prop': return '#e5e7eb';
    default: return null;
  }
}
/* Góc quay để vẽ tam giác camera trên canvas: hướng nhìn (pos->target)
   đổi thành góc canvas (0 = chỉ lên trên = hướng -z thế giới, xoay theo
   chiều kim đồng hồ). Trả radian, dùng với ctx.rotate(góc). */
function minimapCameraHeading(pos, target) {
  if (!pos || !target) return 0;
  var dx = (Number(target[0]) || 0) - (Number(pos[0]) || 0);
  var dz = (Number(target[2]) || 0) - (Number(pos[2]) || 0);
  if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) return 0;
  return Math.atan2(dx, -dz);
}
/* Chuẩn hoá kích thước minimap: chỉ nhận 140/200/280, khác thì về 200. */
function minimapNormalizeSize(size) {
  var n = Number(size);
  if (n === 140 || n === 200 || n === 280) return n;
  return 200;
}

ED.Minimap = (function () {
  var PREFS_KEY = 'mongvolam_editor_prefs_v1';
  var SIZES = [140, 200, 280];
  var SIZE_LABELS = { 140: 'Nhỏ 140', 200: 'Vừa 200', 280: 'Lớn 280' };

  var _wrap = null, _canvas = null, _ctx = null;
  var _toggleBtn = null, _sizeBtn = null;
  var _visible = true, _size = 200;
  var _timer = 0, _inited = false;

  function _loadPrefs() {
    var saved = null;
    try {
      if (ED.Core && typeof ED.Core.loadPrefs === 'function') saved = ED.Core.loadPrefs();
      else if (typeof localStorage !== 'undefined') {
        var raw = localStorage.getItem(PREFS_KEY);
        if (raw) saved = JSON.parse(raw);
      }
    } catch (e) { saved = null; }
    var m = (saved && saved.minimap && typeof saved.minimap === 'object') ? saved.minimap : {};
    _visible = (typeof m.visible === 'boolean') ? m.visible : true;
    _size = minimapNormalizeSize(m.size);
  }
  function _savePrefs() {
    try {
      var saved = {};
      if (ED.Core && typeof ED.Core.loadPrefs === 'function') saved = ED.Core.loadPrefs() || {};
      else if (typeof localStorage !== 'undefined') {
        var raw = localStorage.getItem(PREFS_KEY);
        if (raw) saved = JSON.parse(raw) || {};
      }
      saved.minimap = { visible: _visible, size: _size };
      if (ED.Core && typeof ED.Core.savePrefs === 'function') ED.Core.savePrefs(saved);
      else if (typeof localStorage !== 'undefined') localStorage.setItem(PREFS_KEY, JSON.stringify(saved));
    } catch (e) { /* prefs chỉ sống trong phiên */ }
  }

  function init() {
    if (_inited || typeof document === 'undefined') return false;
    _inited = true;
    _loadPrefs();
    // Gắn vào #viewport-wrap (đã position:relative trong CSS); không có
    // thì gắn vào body góc phải (position:fixed) để vẫn dùng được.
    var host = document.getElementById('viewport-wrap') ||
      document.getElementById('viewport') || document.body;
    var fixed = (host === document.body);

    _wrap = document.createElement('div');
    _wrap.className = 'ed-minimap-wrap';
    _wrap.style.position = fixed ? 'fixed' : 'absolute';
    _wrap.style.right = '8px';
    _wrap.style.bottom = '8px';
    _wrap.style.zIndex = '60';
    _wrap.style.display = 'flex';
    _wrap.style.flexDirection = 'column';
    _wrap.style.alignItems = 'flex-end';
    _wrap.style.gap = '6px';
    host.appendChild(_wrap);

    _canvas = document.createElement('canvas');
    _canvas.className = 'ed-minimap-canvas';
    _canvas.width = _size;
    _canvas.height = _size;
    _canvas.style.width = _size + 'px';
    _canvas.style.height = _size + 'px';
    _canvas.style.display = 'block';
    _canvas.style.border = '1px solid #4b5563';
    _canvas.style.borderRadius = '8px';
    _canvas.style.background = '#1a1d21';
    _canvas.style.cursor = 'pointer';
    _canvas.title = 'Bấm để nhảy camera tới vị trí đó';
    _canvas.setAttribute('aria-label', 'Bản đồ nhỏ — bấm để nhảy camera');
    _canvas.addEventListener('click', _onClick);
    _wrap.appendChild(_canvas);
    try { _ctx = _canvas.getContext('2d'); } catch (e) { _ctx = null; }

    var row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    _wrap.appendChild(row);

    _sizeBtn = document.createElement('button');
    _sizeBtn.type = 'button';
    _sizeBtn.className = 'ed-minimap-btn';
    _sizeBtn.style.minHeight = '40px';
    _sizeBtn.style.minWidth = '40px';
    _sizeBtn.addEventListener('click', function () { cycleSize(); });
    row.appendChild(_sizeBtn);

    _toggleBtn = document.createElement('button');
    _toggleBtn.type = 'button';
    _toggleBtn.className = 'ed-minimap-btn';
    _toggleBtn.style.minHeight = '40px';
    _toggleBtn.addEventListener('click', function () { toggle(); });
    row.appendChild(_toggleBtn);

    // Vẽ lại khi project/selection đổi (qua ED.Core.onChange nếu có),
    // cộng interval 500ms để theo kịp camera di chuyển.
    try {
      if (ED.Core && typeof ED.Core.onChange === 'function') ED.Core.onChange(function () { draw(); });
    } catch (e) { /* không có listener -> chỉ interval */ }
    if (typeof window !== 'undefined' && typeof window.setInterval === 'function') {
      _timer = window.setInterval(function () { if (_visible) draw(); }, 500);
    }
    _applyState();
    draw();
    return true;
  }

  function _applyState() {
    if (!_wrap) return;
    if (_canvas) {
      _canvas.style.display = _visible ? 'block' : 'none';
      _canvas.width = _size;
      _canvas.height = _size;
      _canvas.style.width = _size + 'px';
      _canvas.style.height = _size + 'px';
    }
    if (_sizeBtn) {
      _sizeBtn.textContent = '↔ ' + (SIZE_LABELS[_size] || _size);
      _sizeBtn.style.display = _visible ? '' : 'none';
      _sizeBtn.title = 'Đổi kích thước bản đồ nhỏ';
    }
    if (_toggleBtn) {
      _toggleBtn.textContent = _visible ? '🗺 Ẩn bản đồ nhỏ' : '🗺 Bản đồ nhỏ';
      _toggleBtn.classList.toggle('active', _visible);
      _toggleBtn.title = 'Bật/tắt bản đồ nhỏ (phím M)';
    }
  }

  function toggle() {
    _visible = !_visible;
    _savePrefs();
    _applyState();
    if (_visible) draw();
    return _visible;
  }
  function setVisible(b) {
    _visible = !!b;
    _savePrefs();
    _applyState();
    if (_visible) draw();
    return _visible;
  }
  function isVisible() { return _visible; }
  function setSize(size) {
    _size = minimapNormalizeSize(size);
    _savePrefs();
    _applyState();
    draw();
    return _size;
  }
  function getSize() { return _size; }
  function cycleSize() {
    var i = SIZES.indexOf(_size);
    return setSize(SIZES[(i + 1) % SIZES.length]);
  }

  function _onClick(e) {
    if (!_canvas) return;
    var rect = _canvas.getBoundingClientRect();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var mapSize = _mapSize();
    var w = minimapClickToWorld(px, py, rect.width || _size, mapSize);
    if (ED.Viewport && typeof ED.Viewport.jumpTo === 'function') {
      ED.Viewport.jumpTo(w.x, w.z);
    }
  }

  /* Cạnh map thế giới: ưu tiên ED.Terrain.getSize(), rồi project.terrain.size. */
  function _mapSize() {
    try {
      if (ED.Terrain && typeof ED.Terrain.getSize === 'function') {
        var s = ED.Terrain.getSize();
        if (isFinite(s) && s > 0) return s;
      }
    } catch (e) { /* Terrain chưa sẵn sàng */ }
    try {
      if (ED.Core && typeof ED.Core.getProject === 'function') {
        var p = ED.Core.getProject();
        if (p && p.terrain && isFinite(p.terrain.size) && p.terrain.size > 0) return p.terrain.size;
      }
    } catch (e) { /* Core chưa sẵn sàng */ }
    return 96;
  }

  /* Vị trí hero trong Play: ED.Play.getHeroPos() nếu có ([x,z] hoặc
     {x,z}); nếu không thì đọc _heroPos nội bộ khi đang chơi. Không có
     thì null — không crash, không vẽ marker. */
  function _heroPos() {
    try {
      if (typeof ED === 'undefined' || !ED.Play) return null;
      if (typeof ED.Play.getHeroPos === 'function') {
        var hp = ED.Play.getHeroPos();
        if (Array.isArray(hp) && hp.length >= 2) return [Number(hp[0]) || 0, Number(hp[1]) || 0];
        if (hp && typeof hp === 'object' && isFinite(hp.x) && isFinite(hp.z)) return [hp.x, hp.z];
        return null;
      }
      if (typeof ED.Play.isPlaying === 'function' && ED.Play.isPlaying() &&
          Array.isArray(ED.Play._heroPos) && ED.Play._heroPos.length >= 2) {
        return [Number(ED.Play._heroPos[0]) || 0, Number(ED.Play._heroPos[1]) || 0];
      }
    } catch (e) { /* Play chưa sẵn sàng */ }
    return null;
  }

  function draw() {
    if (!_ctx || !_canvas || !_visible) return false;
    var sizePx = _size;
    var mapSize = _mapSize();
    var ctx = _ctx;
    ctx.clearRect(0, 0, sizePx, sizePx);

    // Nền: từng ô lưới theo cao + chất liệu.
    var heights = null, paints = null, segments = 64;
    try {
      if (ED.Terrain && typeof ED.Terrain.getHeights === 'function') heights = ED.Terrain.getHeights();
      if (ED.Terrain && typeof ED.Terrain.getPaints === 'function') paints = ED.Terrain.getPaints();
    } catch (e) { /* Terrain chưa sẵn sàng */ }
    if ((!heights || !paints) && ED.Core && typeof ED.Core.getProject === 'function') {
      try {
        var p = ED.Core.getProject();
        if (p && p.terrain) {
          if (!heights) heights = p.terrain.heights;
          if (!paints) paints = p.terrain.paints;
          if (isFinite(p.terrain.segments)) segments = p.terrain.segments;
        }
      } catch (e) { /* Core chưa sẵn sàng */ }
    }
    var n = Math.round(segments);
    if (!(n > 0)) n = 64;
    var side = n + 1;
    var cell = sizePx / side;
    for (var gz = 0; gz < side; gz++) {
      for (var gx = 0; gx < side; gx++) {
        var idx = gz * side + gx;
        var h = (heights && isFinite(heights[idx])) ? heights[idx] : 0;
        var pt = (paints && typeof paints[idx] === 'number') ? paints[idx] : 0;
        ctx.fillStyle = minimapColorFor(h, pt);
        ctx.fillRect(gx * cell, gz * cell, cell + 0.5, cell + 0.5);
      }
    }

    // Chấm object (chỉ visible).
    try {
      if (ED.Core && typeof ED.Core.listObjects === 'function') {
        var objs = ED.Core.listObjects();
        var dot = Math.max(3, Math.round(sizePx / 64));
        for (var i = 0; i < objs.length; i++) {
          var o = objs[i];
          if (!o || o.visible === false || !Array.isArray(o.pos) || o.pos.length < 3) continue;
          var c = minimapDotColor(o);
          if (!c) continue;
          var q = minimapWorldToPx(o.pos[0], o.pos[2], sizePx, mapSize);
          ctx.fillStyle = c;
          ctx.fillRect(q.x - dot / 2, q.y - dot / 2, dot, dot);
        }
      }
    } catch (e) { /* Core chưa sẵn sàng */ }

    // Marker hero Play (hồng, viền trắng) — chỉ khi đang chơi và có vị trí.
    var hero = _heroPos();
    if (hero) {
      var hp2 = minimapWorldToPx(hero[0], hero[1], sizePx, mapSize);
      ctx.beginPath();
      ctx.arc(hp2.x, hp2.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ec4899';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    // Vị trí + hướng camera: tam giác trắng.
    try {
      if (ED.Viewport && typeof ED.Viewport.getCameraView === 'function') {
        var v = ED.Viewport.getCameraView();
        if (v && Array.isArray(v.pos) && Array.isArray(v.target)) {
          var cp = minimapWorldToPx(v.pos[0], v.pos[2], sizePx, mapSize);
          var ang = minimapCameraHeading(v.pos, v.target);
          ctx.save();
          ctx.translate(cp.x, cp.y);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(0, -7);
          ctx.lineTo(5, 6);
          ctx.lineTo(-5, 6);
          ctx.closePath();
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#111827';
          ctx.stroke();
          ctx.restore();
        }
      }
    } catch (e) { /* Viewport chưa sẵn sàng */ }

    // Viền ngoài.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, sizePx - 1, sizePx - 1);
    return true;
  }

  return {
    init: init, draw: draw, redraw: draw,
    toggle: toggle, setVisible: setVisible, isVisible: isVisible,
    setSize: setSize, getSize: getSize, cycleSize: cycleSize,
    /* Hàm thuần (harness test bằng vm). */
    minimapColorFor: minimapColorFor,
    minimapClickToWorld: minimapClickToWorld,
    minimapWorldToPx: minimapWorldToPx,
    minimapDotColor: minimapDotColor,
    minimapCameraHeading: minimapCameraHeading,
    minimapNormalizeSize: minimapNormalizeSize
  };
})();
