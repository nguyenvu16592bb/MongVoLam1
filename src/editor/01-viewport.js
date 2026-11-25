/* Map Editor — 01-viewport.js (worker A)
   ED.Viewport: renderer, camera, gizmo tự vẽ, chọn object, input chuột/chạm/bàn phím.
   KHÔNG dùng OrbitControls (r128 examples không có sẵn dạng global) — tự code orbit/pan/zoom.
   KHÔNG truy cập document/window/THREE ở top-level; mọi khởi tạo trong init().
   Đợt 6 (nhóm Viewport): post-processing (EffectComposer/UnrealBloomPass
   r128 + vignette tự viết), chế độ đi bộ FPS/TPS, bookmark camera,
   đường camera điện ảnh (Catmull-Rom thuần), hook ED.Terrain.tick.
   Đợt 7: followHero(x, z) — camera orbit đi theo hero trong Play Mode
   (chỉ dời _target, giữ nguyên _radius/_theta/_phi nên không phá orbit);
   getCanvas() trả renderer.domElement (null khi chưa init). */
var ED = ED || {};

/* ---------- Hàm thuần đợt 6 (không DOM/THREE, test được bằng vm) ---------- */
function edViewportClamp(v, lo, hi, def) {
  var n = Number(v);
  if (!isFinite(n)) return (typeof def === 'number') ? def : lo;
  return n < lo ? lo : (n > hi ? hi : n);
}
/* Kẹp cài đặt bloom về miền hợp lệ + mặc định (strength 0.6, radius 0.4,
   threshold 0.85, enabled true). Thiếu field thì lấy mặc định, không lỗi. */
function clampBloom(opts) {
  var o = (opts && typeof opts === 'object') ? opts : {};
  return {
    enabled: (typeof o.enabled === 'boolean') ? o.enabled : true,
    strength: edViewportClamp(o.strength, 0, 2, 0.6),
    radius: edViewportClamp(o.radius, 0, 1, 0.4),
    threshold: edViewportClamp(o.threshold, 0, 1, 0.85)
  };
}
/* Kẹp cài đặt vignette (strength 0..1, mặc định 0.5, enabled mặc định tắt). */
function clampVignette(opts) {
  var o = (opts && typeof opts === 'object') ? opts : {};
  return {
    enabled: (typeof o.enabled === 'boolean') ? o.enabled : false,
    strength: edViewportClamp(o.strength, 0, 1, 0.5)
  };
}
/* Chuẩn hoá [x,y,z] thuần: trả mảng 3 số hữu hạn, hoặc null khi thiếu/sai. */
function edViewportVec3(a) {
  if (!Array.isArray(a) || a.length < 3) return null;
  var x = Number(a[0]), y = Number(a[1]), z = Number(a[2]);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
  return [x, y, z];
}
/* Chuẩn hoá danh sách bookmark: lọc entry thiếu id/pos/target, trùng id
   (giữ cái đầu tiên), tên thiếu thì 'Góc'. Trả mảng MỚI, không sửa input. */
function bookmarkNormalize(list) {
  var out = [], seen = {};
  if (!Array.isArray(list)) return out;
  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (!b || typeof b !== 'object') continue;
    var id = (typeof b.id === 'string' && b.id) ? b.id : null;
    if (!id || seen[id]) continue;
    var pos = edViewportVec3(b.pos), tgt = edViewportVec3(b.target);
    if (!pos || !tgt) continue;
    seen[id] = true;
    out.push({
      id: id,
      name: (typeof b.name === 'string' && b.name) ? b.name : 'Góc',
      pos: pos, target: tgt
    });
  }
  return out;
}
/* Nội suy Catmull-Rom thuần cho 1 thành phần (pos hoặc target).
   p0..p3 là 4 điểm kề, u 0..1 trong đoạn p1->p2. */
function edViewportCatmullRom(p0, p1, p2, p3, u) {
  var u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * p1) + (-p0 + p2) * u +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
/* Điểm trên đường camera tại thời gian t (giây).
   keys: [{t, pos:[x,y,z], target:[x,y,z]}] (t tăng dần, không cần sort
   trước — hàm tự sort bản sao). t ngoài khoảng thì kẹp 2 đầu;
   keys < 2 thì trả key duy nhất (hoặc null khi rỗng). Trả
   {pos:[x,y,z], target:[x,y,z]} — KHÔNG dùng THREE. */
function edCameraPathPoint(keys, t) {
  if (!Array.isArray(keys) || !keys.length) return null;
  var ks = keys.slice().sort(function (a, b) {
    return (Number(a && a.t) || 0) - (Number(b && b.t) || 0);
  });
  var first = ks[0], last = ks[ks.length - 1];
  var fp = edViewportVec3(first.pos) || [0, 0, 0];
  var ft = edViewportVec3(first.target) || [0, 0, 0];
  if (ks.length < 2) return { pos: fp, target: ft };
  var lp = edViewportVec3(last.pos) || [0, 0, 0];
  var lt = edViewportVec3(last.target) || [0, 0, 0];
  var tt = Number(t);
  if (!isFinite(tt)) tt = Number(first.t) || 0;
  var t0 = Number(first.t) || 0, t1 = Number(last.t) || 0;
  if (tt <= t0) return { pos: fp, target: ft };
  if (tt >= t1) return { pos: lp, target: lt };
  var i = 0;
  while (i < ks.length - 2 && tt > (Number(ks[i + 1].t) || 0)) i++;
  var a = ks[i], b = ks[i + 1];
  var pa = ks[i - 1] || a, pb = ks[i + 2] || b;
  var seg0 = Number(a.t) || 0, seg1 = Number(b.t) || 0;
  var u = (seg1 > seg0) ? (tt - seg0) / (seg1 - seg0) : 0;
  if (u < 0) u = 0; else if (u > 1) u = 1;
  var p0 = edViewportVec3(pa.pos) || [0, 0, 0];
  var p1 = edViewportVec3(a.pos) || [0, 0, 0];
  var p2 = edViewportVec3(b.pos) || [0, 0, 0];
  var p3 = edViewportVec3(pb.pos) || [0, 0, 0];
  var q0 = edViewportVec3(pa.target) || [0, 0, 0];
  var q1 = edViewportVec3(a.target) || [0, 0, 0];
  var q2 = edViewportVec3(b.target) || [0, 0, 0];
  var q3 = edViewportVec3(pb.target) || [0, 0, 0];
  var pos = [], tgt = [];
  for (var j = 0; j < 3; j++) {
    pos.push(edViewportCatmullRom(p0[j], p1[j], p2[j], p3[j], u));
    tgt.push(edViewportCatmullRom(q0[j], q1[j], q2[j], q3[j], u));
  }
  return { pos: pos, target: tgt };
}

/* ---------- Hàm thuần đợt 6 — nhóm Minimap + Chọn nhiều + Thước đo ---------- */
/* Chuẩn hoá 1 điểm đo: [x,y,z] | [x,z] | {x,y,z} | {x,z} -> [x,y,z]
   (thiếu y thì 0). Trả null khi không đọc được x/z. */
function edViewportPoint3(p) {
  if (Array.isArray(p) && p.length >= 2) {
    var x = Number(p[0]), z = Number(p[1]);
    var y = (p.length >= 3) ? Number(p[2]) : 0;
    if (!isFinite(x) || !isFinite(z) || !isFinite(y)) return null;
    return [x, y, z];
  }
  if (p && typeof p === 'object') {
    var px = Number(p.x), pz = Number(p.z), py = (p.y == null) ? 0 : Number(p.y);
    if (!isFinite(px) || !isFinite(pz) || !isFinite(py)) return null;
    return [px, py, pz];
  }
  return null;
}
/* Độ dài đường đo: points là mảng điểm [x,y,z]/[x,z]/{x,z}.
   Trả {segments:[độ dài từng đoạn], total:tổng} (đơn vị thế giới = mét).
   < 2 điểm hợp lệ thì {segments:[], total:0}. */
function measurePathLength(points) {
  var segs = [], total = 0;
  if (!Array.isArray(points)) return { segments: segs, total: 0 };
  var prev = null;
  for (var i = 0; i < points.length; i++) {
    var p = edViewportPoint3(points[i]);
    if (!p) continue;
    if (prev) {
      var dx = p[0] - prev[0], dy = p[1] - prev[1], dz = p[2] - prev[2];
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      segs.push(d);
      total += d;
    }
    prev = p;
  }
  return { segments: segs, total: total };
}
/* Chuẩn hoá khung chữ nhật chọn vùng về {x0,y0,x1,y1} (x0<=x1, y0<=y1). */
function normalizeBoxRect(x0, y0, x1, y1) {
  return {
    x0: Math.min(Number(x0) || 0, Number(x1) || 0),
    y0: Math.min(Number(y0) || 0, Number(y1) || 0),
    x1: Math.max(Number(x0) || 0, Number(x1) || 0),
    y1: Math.max(Number(y0) || 0, Number(y1) || 0)
  };
}
/* Lọc object nằm trong khung chọn vùng. objects: [{id, pos:[x,y,z],
   visible, locked}]; projectFn(pos [x,y,z]) -> {x,y} (px màn hình) hoặc
   null khi ở sau camera/không chiếu được. rect: {x0,y0,x1,y1} (px).
   Chỉ tính object visible + không locked, có pos. Trả mảng id. */
function boxSelectFilter(objects, projectFn, rect) {
  var out = [];
  if (!Array.isArray(objects) || typeof projectFn !== 'function' || !rect) return out;
  var r = normalizeBoxRect(rect.x0, rect.y0, rect.x1, rect.y1);
  for (var i = 0; i < objects.length; i++) {
    var o = objects[i];
    if (!o || o.visible === false || o.locked) continue;
    var p = edViewportVec3(o.pos);
    if (!p) continue;
    var s = null;
    try { s = projectFn(p); } catch (e) { s = null; }
    if (!s) continue;
    var sx = (typeof s.x === 'number') ? s.x : (Array.isArray(s) ? s[0] : NaN);
    var sy = (typeof s.y === 'number') ? s.y : (Array.isArray(s) ? s[1] : NaN);
    if (!isFinite(sx) || !isFinite(sy)) continue;
    if (sx >= r.x0 && sx <= r.x1 && sy >= r.y0 && sy <= r.y1) out.push(o.id);
  }
  return out;
}
/* Shift-toggle cho chọn vùng: object trong khung mà đã chọn thì bỏ,
   chưa chọn thì thêm; object ngoài khung giữ nguyên. Trả mảng id mới. */
function boxSelectToggle(currentIds, inBoxIds) {
  var out = (Array.isArray(currentIds) ? currentIds.slice() : []);
  var box = (Array.isArray(inBoxIds) ? inBoxIds : []);
  for (var i = 0; i < box.length; i++) {
    var id = box[i];
    var at = out.indexOf(id);
    if (at >= 0) out.splice(at, 1);
    else out.push(id);
  }
  return out;
}
/* Tâm nhóm: trung bình các vị trí [x,y,z]. Trả null khi rỗng. */
function groupCenter(positions) {
  if (!Array.isArray(positions) || !positions.length) return null;
  var sx = 0, sy = 0, sz = 0, n = 0;
  for (var i = 0; i < positions.length; i++) {
    var p = edViewportVec3(positions[i]);
    if (!p) continue;
    sx += p[0]; sy += p[1]; sz += p[2]; n++;
  }
  if (!n) return null;
  return [sx / n, sy / n, sz / n];
}
/* Nhóm Move: cộng cùng delta cho mọi vị trí. Trả mảng vị trí mới. */
function groupMovePositions(positions, delta) {
  var out = [];
  var d = edViewportVec3(delta) || [0, 0, 0];
  if (!Array.isArray(positions)) return out;
  for (var i = 0; i < positions.length; i++) {
    var p = edViewportVec3(positions[i]);
    if (!p) continue;
    out.push([p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
  }
  return out;
}
/* Nhóm Rotate (chỉ rot Y): xoay từng vị trí quanh tâm nhóm theo góc
   angleRad (quy ước THREE rotation.y: x' = cx + dx*cos + dz*sin,
   z' = cz - dx*sin + dz*cos). Trả mảng vị trí mới. */
function groupRotateYPositions(positions, center, angleRad) {
  var out = [];
  var c = edViewportVec3(center);
  var a = Number(angleRad);
  if (!c || !isFinite(a) || !Array.isArray(positions)) return out;
  var cos = Math.cos(a), sin = Math.sin(a);
  for (var i = 0; i < positions.length; i++) {
    var p = edViewportVec3(positions[i]);
    if (!p) continue;
    var dx = p[0] - c[0], dz = p[2] - c[2];
    out.push([c[0] + dx * cos + dz * sin, p[1], c[2] - dx * sin + dz * cos]);
  }
  return out;
}
/* Nhóm Scale: scale khoảng cách từ tâm nhóm theo tỉ lệ.
   pos mới = tâm + (pos - tâm) × tỉ lệ. Trả mảng vị trí mới. */
function groupScalePositions(positions, center, ratio) {
  var out = [];
  var c = edViewportVec3(center);
  var r = Number(ratio);
  if (!c || !isFinite(r) || !Array.isArray(positions)) return out;
  for (var i = 0; i < positions.length; i++) {
    var p = edViewportVec3(positions[i]);
    if (!p) continue;
    out.push([
      c[0] + (p[0] - c[0]) * r,
      c[1] + (p[1] - c[1]) * r,
      c[2] + (p[2] - c[2]) * r
    ]);
  }
  return out;
}

ED.Viewport = (function () {
  var _renderer = null, _scene = null, _camera = null, _ortho = null;
  var _container = null, _canvas = null;
  var _mode = 'persp'; // persp | ortho | iso | top | front | side
  var _gizmoMode = 'move'; // move | rotate | scale
  var _playMode = false;

  // Orbit state (quanh _target).
  var _target = null; // THREE.Vector3
  var _radius = 28, _theta = 0.7, _phi = 1.0; // phi: góc từ trục +Y
  var _orthoSize = 30;

  var _meshes = {}; // id -> THREE.Group
  var _terrainMesh = null;
  var _rectAreaLibInit = false; // Đợt 5: RectAreaLightUniformsLib.init() chỉ gọi 1 lần
  var _gizmo = null; // THREE.Group chứa handle
  var _gizmoHandles = []; // mesh có userData.axis
  var _selectionBox = null; // THREE.BoxHelper
  var _selectedId = null;

  var _raf = 0, _frames = 0, _lastPerf = 0, _lastTime = 0, _lastLod = 0, _lodInfo = null;
  var _pointers = {}; // pointerId -> {x, y}
  var _pinchDist = 0;
  var _dragging = null; // {kind:'orbit'|'pan'|'gizmo', ...}
  var _downPos = null, _downTime = 0;
  var _snapGrid = 0.5, _snapFine = 0.1;
  var _groundClickHandler = null; // fn(x, z) — NPC đặt waypoint (08-npc-ai.js đăng ký)

  /* Đợt 6 — nhóm Minimap + Chọn nhiều + Thước đo. */
  var _boxSelect = false; // chế độ chọn vùng đang bật?
  var _boxDiv = null; // div khung chữ nhật kéo chọn
  var _boxStart = null; // {x, y} px (tọa độ client) lúc bắt đầu kéo khung
  var _boxShift = false; // Shift có giữ lúc bắt đầu kéo khung không
  var _selectToolbar = null, _boxBtn = null, _rulerBtn = null, _rulerClearBtn = null;
  var _selBadge = null; // badge "Đã chọn N vật"
  var _groupDrag = null; // snapshot kéo gizmo khi chọn >1 object
  var _ruler = { active: false, points: [], line: null, badge: null }; // thước đo

  /* Đợt 6 — post-processing (EffectComposer/UnrealBloomPass r128 + vignette). */
  var _composer = null, _renderPass = null, _bloomPass = null, _vignettePass = null;
  var _bloom = { enabled: true, strength: 0.6, radius: 0.4, threshold: 0.85 };
  var _vignette = { enabled: false, strength: 0.5 };
  var _lowPower = false; // checkbox "Tắt khi máy yếu": ép tắt bloom
  var _fxPanel = null; // panel Hiệu ứng + Camera (tự tạo trong init)
  /* Shader vignette tự viết: làm tối 4 góc theo khoảng cách tới tâm. */
  var _vignetteShader = {
    uniforms: {
      tDiffuse: { value: null },
      strength: { value: 0.5 }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform float strength; varying vec2 vUv; ' +
      'void main() { vec4 c = texture2D( tDiffuse, vUv ); ' +
      'float d = distance( vUv, vec2( 0.5, 0.5 ) ); ' +
      'float v = smoothstep( 0.85, 0.35, d ); ' +
      'gl_FragColor = vec4( c.rgb * mix( 1.0, v, strength ), c.a ); }'
  };
  /* Đợt 6 — chế độ đi bộ FPS/TPS. pos = bàn chân [x,y,z]; yaw: hướng nhìn
     (forward = [sin yaw, 0, cos yaw]); pitch kẹp ±85°. */
  var _walk = {
    mode: 'off', // off | fps | tps
    yaw: 0, pitch: 0, pos: [0, 0, 0], velY: 0, grounded: true,
    keys: {}, joy: { x: 0, y: 0 }, jumpQueued: false,
    saved: null, body: null // saved: orbit cũ; body: body physics-lite
  };
  var _joyEl = null, _joyKnob = null, _walkBtn = null;
  /* Đợt 6 — nội suy camera mượt tới bookmark (0.6s) + phát đường camera. */
  var _camAnim = null; // {fromPos,fromTarget,toPos,toTarget,start,dur}
  var _pathPlay = null; // {pathId, keys, t, dur, playing}
  var _lastPathId = null;

  function _v3(x, y, z) { return new THREE.Vector3(x, y, z); }

  function init(container) {
    if (!container || typeof THREE === 'undefined') return false;
    _container = container;
    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    _renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    _renderer.setClearColor(0x1a1d21, 1);
    /* Đợt 3 — shadow: kiểu PCFSoft; enabled do ED.Environment.applyShadows()
       bật/tắt theo project.env.shadow (mặc định bật). */
    _renderer.shadowMap.enabled = false;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _canvas = _renderer.domElement;
    _canvas.style.display = 'block';
    _canvas.style.touchAction = 'none';
    container.appendChild(_canvas);

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x1a1d21);
    _scene.fog = new THREE.Fog(0x1a1d21, 60, 140);

    /* Đợt 5 — RectAreaLight: khởi tạo uniforms lib (LTC texture) 1 lần,
       ngay khi viewport init (boot chạy Viewport trước Environment nên
       đèn diện tích có lib sẵn khi Environment.applyToScene chạy).
       Build chưa nối lib/RectAreaLightUniformsLib.js thì
       THREE.RectAreaLightUniformsLib undefined -> bỏ qua êm; panel
       Environment sẽ khoá nút bật đèn cho tới khi build nối lib. */
    try {
      if (!_rectAreaLibInit && THREE.RectAreaLightUniformsLib &&
          typeof THREE.RectAreaLightUniformsLib.init === 'function') {
        THREE.RectAreaLightUniformsLib.init();
        _rectAreaLibInit = true;
      }
    } catch (e) { /* lib lỗi -> đèn diện tích không sáng, các đèn khác vẫn chạy */ }

    var amb = new THREE.AmbientLight(0xffffff, 0.55);
    _scene.add(amb);
    var sun = new THREE.DirectionalLight(0xfff2d0, 0.9);
    sun.position.set(30, 50, 20);
    _scene.add(sun);

    var grid = new THREE.GridHelper(96, 96, 0x4a5568, 0x2d3748);
    grid.position.y = 0.01;
    _scene.add(grid);
    var axes = new THREE.AxesHelper(5);
    _scene.add(axes);

    _target = _v3(0, 0, 0);
    _camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    _ortho = new THREE.OrthographicCamera(-30, 30, 30, -30, 0.1, 500);
    _applyCamera();

    // Gizmo (tự vẽ) + hộp chọn.
    _gizmo = new THREE.Group();
    _gizmo.visible = false;
    _scene.add(_gizmo);
    _rebuildGizmo();
    _selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffd76b);
    _selectionBox.visible = false;
    _scene.add(_selectionBox);

    _bindInput();
    _resize();
    /* Đợt 6 — post-processing + panel Hiệu ứng/Camera + nút đi bộ + joystick.
       Thứ tự: đọc prefs trước (bloom mặc định theo máy yếu), rồi mới tạo
       composer để UnrealBloomPass nhận đúng strength/radius/threshold. */
    _loadFxPrefs();
    _initPostFx();
    _buildViewportPanels();
    _buildWalkButton();
    _buildJoystick();
    /* Đợt 6 — nhóm Minimap + Chọn nhiều + Thước đo: toolbar chọn vùng /
       thước đo, khung kéo chọn, badge số lượng đã chọn, badge thước đo. */
    _buildSelectToolbar();
    _buildBoxRectDiv();
    _buildSelBadge();
    _buildRulerBadge();
    _refreshBmList();
    _refreshPathList();
    _syncFxPanel();
    window.addEventListener('resize', _resize);
    _lastTime = performance.now();
    _lastPerf = _lastTime;
    var loop = function (t) {
      _raf = requestAnimationFrame(loop);
      _frames++;
      var dt = 0;
      if (_lastTime) dt = Math.min(0.1, Math.max(0, (t - _lastTime) / 1000));
      _lastTime = t;
      try { if (ED.Fx && typeof ED.Fx.tick === 'function') ED.Fx.tick(dt); } catch (e) {}
      try { if (ED.Environment && typeof ED.Environment.tick === 'function') ED.Environment.tick(dt); } catch (e) {}
      /* Đợt 6 — hook cho nhóm Terrain: sông chảy (ED.Terrain.tick nếu có).
         Chưa nối thì chạy như cũ, không crash. */
      try { if (ED.Terrain && typeof ED.Terrain.tick === 'function') ED.Terrain.tick(dt); } catch (e) {}
      /* Đợt 5 — cập nhật LOD terrain mỗi 0.25s (guard typeof; chỉ rebuild
         chunk đổi mức, xem 04-terrain.js updateLod). */
      if (t - _lastLod >= 250) {
        _lastLod = t;
        try {
          if (typeof ED !== 'undefined' && ED.Terrain && typeof ED.Terrain.updateLod === 'function' && _camera) {
            ED.Terrain.updateLod(_camera.position);
            if (typeof ED.Terrain.getLodInfo === 'function') _lodInfo = ED.Terrain.getLodInfo();
          }
        } catch (e) {}
      }
      _updateGizmoScale();
      /* Đợt 6 — đi bộ / nội suy bookmark / phát đường camera (trước render). */
      _updateWalk(dt);
      _updateCamAnim(t);
      _updatePathPlay(dt);
      /* Đợt 6 — có hiệu ứng bật thì render qua composer, không thì như cũ. */
      if (_composer && _fxActive()) {
        try { _composer.render(); }
        catch (e) { _renderer.render(_scene, _activeCamera()); }
      } else {
        _renderer.render(_scene, _activeCamera());
      }
      if (t - _lastPerf >= 500) {
        var fps = Math.round(_frames * 1000 / (t - _lastPerf));
        _frames = 0;
        _lastPerf = t;
        if (ED.UI && ED.UI.setPerf) {
          var info = _renderer.info;
          var mem = 0;
          try {
            if (window.performance && window.performance.memory) {
              mem = Math.round(window.performance.memory.usedJSHeapSize / 1048576);
            }
          } catch (e) { /* không có performance.memory */ }
          ED.UI.setPerf({
            fps: fps,
            calls: info.render.calls,
            tris: info.render.triangles,
            verts: info.render.triangles * 3,
            mem: mem,
            /* Đợt 4 — số chunk terrain (hiển thị "Chunk 16/16" trên HUD). */
            chunks: (function () {
              try {
                if (typeof ED !== 'undefined' && ED.Terrain && typeof ED.Terrain.getChunkInfo === 'function') {
                  var ci = ED.Terrain.getChunkInfo();
                  return ci ? (ci.visible + '/' + ci.chunks) : null;
                }
              } catch (e) {}
              return null;
            })(),
            /* Đợt 5 — LOD terrain "L<so chunk muc 0>/<muc 1>/<muc 2>". */
            lod: (_lodInfo && Array.isArray(_lodInfo.levels))
              ? ('L' + _lodInfo.levels[0] + '/' + _lodInfo.levels[1] + '/' + _lodInfo.levels[2]) : null
          });
        }
      }
    };
    _raf = requestAnimationFrame(loop);
    return true;
  }

  function _activeCamera() {
    return _mode === 'ortho' ? _ortho : _camera;
  }

  function _applyCamera() {
    if (!_camera) return;
    /* Đợt 6 — đang đi bộ hoặc đang phát đường camera thì camera do
       _updateWalk/_updatePathPlay điều khiển, không đặt lại theo orbit. */
    if (_walk.mode !== 'off' || _pathPlay) return;
    if (_mode === 'top') { _theta = 0; _phi = 0.001; }
    else if (_mode === 'front') { _theta = 0; _phi = Math.PI / 2; }
    else if (_mode === 'side') { _theta = Math.PI / 2; _phi = Math.PI / 2; }
    else if (_mode === 'iso') { _theta = Math.PI / 4; _phi = Math.acos(1 / Math.sqrt(3)); }
    // persp / ortho giữ nguyên góc hiện tại.
    var sp = Math.sin(_phi), cp = Math.cos(_phi);
    var pos = _v3(
      _target.x + _radius * sp * Math.sin(_theta),
      _target.y + _radius * cp,
      _target.z + _radius * sp * Math.cos(_theta)
    );
    _camera.position.copy(pos);
    _camera.lookAt(_target);
    _camera.updateProjectionMatrix();
    if (_ortho) {
      var w = _container ? _container.clientWidth || 800 : 800;
      var h = _container ? _container.clientHeight || 600 : 600;
      var aspect = w / h;
      _ortho.left = -_orthoSize * aspect;
      _ortho.right = _orthoSize * aspect;
      _ortho.top = _orthoSize;
      _ortho.bottom = -_orthoSize;
      _ortho.position.copy(pos);
      _ortho.lookAt(_target);
      _ortho.updateProjectionMatrix();
    }
  }

  function setCameraPreset(preset) {
    var ok = ['persp', 'ortho', 'iso', 'top', 'front', 'side'].indexOf(preset) >= 0;
    if (!ok) return false;
    /* Đợt 6 — đổi preset thì thoát đi bộ trước để orbit nhận lại camera. */
    if (_walk.mode !== 'off') setWalkMode('off');
    _mode = preset;
    _applyCamera();
    return true;
  }

  function getCameraPreset() { return _mode; }

  function _resize() {
    if (!_renderer || !_container) return;
    var w = _container.clientWidth || 800;
    var h = _container.clientHeight || 600;
    _renderer.setSize(w, h);
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
    /* Đợt 6 — composer + bloom cũng phải đổi kích thước theo viewport. */
    if (_composer) {
      try { _composer.setSize(w, h); } catch (e) { /* composer lỗi -> render thường */ }
    }
    _applyCamera();
  }

  // ---------- Mesh theo object ----------
  function _fallbackMesh(obj) {
    var g = new THREE.Group();
    var geo = new THREE.BoxGeometry(1, 1, 1);
    var mat = new THREE.MeshLambertMaterial({ color: 0x8a8f98 });
    var m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    g.add(m);
    return g;
  }

  function _applyTransform(group, obj) {
    group.position.set(obj.pos[0], obj.pos[1], obj.pos[2]);
    group.rotation.set(obj.rot[0], obj.rot[1], obj.rot[2]);
    group.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
    group.visible = obj.visible !== false;
  }

  /* Đợt 6 — nhóm Minimap: spline/scatter do ED.Terrain build (nhóm
     Terrain đã làm sẵn buildSplineGroup/buildScatterGroup, viewport
     trước đây chưa gọi). Trả THREE.Group khi build được group CÓ con,
     ngược lại null để rơi về buildMesh/fallback như cũ (không crash).
     Group rỗng (không con) cũng coi như build chưa xong -> fallback. */
  function _trySpecialGroup(obj) {
    if (!obj || (obj.type !== 'spline' && obj.type !== 'scatter')) return null;
    try {
      var fn = null;
      if (obj.type === 'spline' && ED.Terrain && typeof ED.Terrain.buildSplineGroup === 'function') {
        fn = ED.Terrain.buildSplineGroup;
      } else if (obj.type === 'scatter' && ED.Terrain && typeof ED.Terrain.buildScatterGroup === 'function') {
        fn = ED.Terrain.buildScatterGroup;
      }
      if (!fn) return null;
      var g = fn(obj);
      if (!g || !g.children || !g.children.length) return null;
      return g;
    } catch (e) { return null; }
  }
  /* Dispose geometry/material của 1 group (dùng chung cho removeMesh
     và khi rebuild spline/scatter). Không đụng tới selection. */
  function _disposeGroup(g) {
    if (!g) return;
    if (g.parent) g.parent.remove(g);
    g.traverse(function (c) {
      if (c.isMesh) {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          var mats = Array.isArray(c.material) ? c.material : [c.material];
          mats.forEach(function (m) { if (m.dispose) m.dispose(); });
        }
      }
    });
  }

  function syncObject(obj) {
    if (!_scene || !obj) return null;
    /* Spline/scatter: build lại mỗi lần sync để đổi points/count/seed
       thì mesh theo kịp (group cũ dispose trước, không để lại mesh thừa). */
    if ((obj.type === 'spline' || obj.type === 'scatter') && _meshes[obj.id]) {
      _disposeGroup(_meshes[obj.id]);
      delete _meshes[obj.id];
    }
    var group = _meshes[obj.id];
    if (!group) {
      group = _trySpecialGroup(obj);
      if (!group) {
        if (ED.Assets && typeof ED.Assets.buildMesh === 'function') {
          try { group = ED.Assets.buildMesh(obj.type, obj); } catch (e) { group = null; }
        }
        if (!group) group = _fallbackMesh(obj);
      }
      group.userData.objectId = obj.id;
      _meshes[obj.id] = group;
      _scene.add(group);
    }
    group.userData.objectId = obj.id; // model import chèn thẳng vào meshes cũng cần id để pick
    // Model import (type 'imported'): thay hộp tạm bằng mesh đã parse khi load xong.
    if (obj.type === 'imported' && ED.Assets && typeof ED.Assets.buildImportedMesh === 'function' && !group.userData.importLoading) {
      group.userData.importLoading = true;
      (function (o) {
        try {
          ED.Assets.buildImportedMesh(o, function (parsed) {
            if (!parsed || !_scene) return;
            if (ED.Core && !ED.Core.getObject(o.id)) return; // đã bị xoá
            var old = _meshes[o.id];
            if (old && old.parent) old.parent.remove(old);
            parsed.userData.objectId = o.id;
            parsed.userData.importLoading = true;
            _meshes[o.id] = parsed;
            _scene.add(parsed);
            _applyTransform(parsed, o);
            // Vật liệu & Texture (13-material.js): model import thay cả group.
            try {
              if (ED.Material && typeof ED.Material.applyToMesh === 'function') {
                ED.Material.applyToMesh(o, parsed);
              }
            } catch (e) { /* giữ material cơ bản */ }
            // Bóng đổ (đợt 3): model import thay cả group nên gán lại flag ở đây.
            try {
              if (ED.Environment && typeof ED.Environment.applyShadowFlags === 'function') {
                ED.Environment.applyShadowFlags(parsed, o);
              }
            } catch (e) { /* giữ mặc định */ }
            if (_selectedId === o.id) _showSelection();
          });
        } catch (e) { /* giữ hộp tạm */ }
      })(obj);
    }
    // Màu + vật liệu theo obj (áp cho mesh fallback và mesh primitive).
    try {
      if (obj.color) {
        group.traverse(function (c) {
          if (c.isMesh && c.material && c.material.color && !c.userData.keepColor) {
            c.material.color.set(obj.color);
          }
          if (c.isMesh && c.material && obj.material) {
            if (typeof obj.material.roughness === 'number') c.material.roughness = obj.material.roughness;
            if (typeof obj.material.metalness === 'number') c.material.metalness = obj.material.metalness;
            if (typeof obj.material.opacity === 'number') {
              c.material.opacity = obj.material.opacity;
              c.material.transparent = obj.material.opacity < 1;
            }
          }
        });
      }
    } catch (e) { /* mesh lạ, bỏ qua */ }
    // Vật liệu & Texture (13-material.js): áp lại texture/emissive đã gán
    // vì buildMesh chỉ tạo material cơ bản.
    try {
      if (ED.Material && typeof ED.Material.applyToMesh === 'function') {
        ED.Material.applyToMesh(obj, group);
      }
    } catch (e) { /* giữ material cơ bản */ }
    // Bóng đổ (05-environment.js, đợt 3): gán cast/receive theo type của
    // object, giữ flag mesh đã có. Gọi sau Material để không bị ghi đè.
    try {
      if (ED.Environment && typeof ED.Environment.applyShadowFlags === 'function') {
        ED.Environment.applyShadowFlags(group, obj);
      }
    } catch (e) { /* giữ mặc định */ }
    // Mặt nước phản chiếu thật (đợt 3): thay mặt phẳng bằng THREE.Reflector
    // nếu lib đã nối vào build và env.water.reflect bật; không có thì giữ
    // mặt phẳng thường của 03-assets.
    if (obj.type === 'water') _swapWaterMesh(group, obj);
    // Parent: gắn vào group cha, vị trí tương đối.
    var parentObj = obj.parent ? (ED.Core && ED.Core.getObject(obj.parent)) : null;
    var parentGroup = parentObj ? _meshes[parentObj.id] : null;
    if (parentGroup && group.parent !== parentGroup) {
      parentGroup.add(group);
    } else if (!parentGroup && group.parent !== _scene) {
      _scene.add(group);
    }
    if (parentObj) {
      group.position.set(obj.pos[0] - parentObj.pos[0], obj.pos[1] - parentObj.pos[1], obj.pos[2] - parentObj.pos[2]);
      group.rotation.set(obj.rot[0], obj.rot[1], obj.rot[2]);
      group.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
    } else {
      _applyTransform(group, obj);
    }
    group.visible = obj.visible !== false;
    if (_selectedId === obj.id) _showSelection();
    return group;
  }

  function removeMesh(id) {
    var g = _meshes[id];
    if (!g) return false;
    _disposeGroup(g);
    delete _meshes[id];
    if (_selectedId === id) { _selectedId = null; _hideSelection(); }
    return true;
  }

  // ---------- Terrain ----------
  var PAINT_COLORS = [0x5a8a3c, 0x8a6a42, 0x7d7d7d, 0xd8c27a, 0x3a6a9a];
  /* Đợt 4 — mặt đất chunk do ED.Terrain quản lý (16 mesh + texture
     procedural, 04-terrain.js): Viewport KHÔNG vẽ thêm mesh đất đơn
     nữa để tránh z-fight/che chunk. syncTerrain() chỉ uỷ quyền cho
     Terrain.rebuildMesh() (nó tự dispose + dựng lại chunk từ project);
     chỉ khi ED.Terrain chưa có (build thiếu module) mới vẽ mesh đơn
     cũ làm fallback. rebuildMesh() không gọi ngược syncTerrain nên
     không đệ quy (refreshViewportTerrain của Terrain mới gọi syncTerrain). */
  function syncTerrain() {
    if (!_scene || !ED.Core) return false;
    var proj = ED.Core.getProject();
    if (!proj || !proj.terrain) return false;
    if (typeof ED !== 'undefined' && ED.Terrain && typeof ED.Terrain.rebuildMesh === 'function') {
      if (_terrainMesh) {
        _scene.remove(_terrainMesh);
        if (_terrainMesh.geometry) _terrainMesh.geometry.dispose();
        _terrainMesh = null;
      }
      try { ED.Terrain.rebuildMesh(); } catch (e) {}
      return true;
    }
    var t = proj.terrain;
    var seg = t.segments, size = t.size;
    if (_terrainMesh) {
      _scene.remove(_terrainMesh);
      if (_terrainMesh.geometry) _terrainMesh.geometry.dispose();
      _terrainMesh = null;
    }
    var geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    var posAttr = geo.attributes.position;
    var colors = new Float32Array(posAttr.count * 3);
    var col = new THREE.Color();
    for (var i = 0; i < posAttr.count; i++) {
      var h = (t.heights && t.heights[i]) || 0;
      posAttr.setY(i, h);
      var p = (t.paints && t.paints[i]) || 0;
      col.setHex(PAINT_COLORS[p] || PAINT_COLORS[0]);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    _terrainMesh = new THREE.Mesh(geo, mat);
    _terrainMesh.userData.objectId = null;
    // Đợt 3 — bóng đổ: terrain nhận bóng khi shadow bật (theo project.env).
    try {
      var _sh = ED.Environment && typeof ED.Environment.getShadow === 'function' ? ED.Environment.getShadow() : null;
      _terrainMesh.receiveShadow = !!(_sh && _sh.enabled);
    } catch (e) { _terrainMesh.receiveShadow = false; }
    _scene.add(_terrainMesh);
    return true;
  }

  /* Đợt 4 — getter terrain mesh thật (09-play.js _raycastGround gọi qua
     guard typeof, trước đây hàm không tồn tại nên click-to-move rơi
     xuống fallback). Thứ tự: (1) ED.Terrain.getMesh() — mesh đất do
     ED.Terrain quản lý (brush/heightmap/rebuild tạo lại ở 04-terrain.js,
     là bản mới nhất); (2) _terrainMesh riêng của Viewport (syncTerrain
     tạo); (3) null nếu cả hai chưa có (chưa sync terrain lần nào). */
  function getTerrainMesh() {
    try {
      if (typeof ED !== 'undefined' && ED.Terrain && typeof ED.Terrain.getMesh === 'function') {
        var m = ED.Terrain.getMesh();
        if (m) return m;
      }
    } catch (e) { /* ED.Terrain chưa load/lỗi -> dùng mesh của Viewport */ }
    return _terrainMesh || null;
  }

  // ---------- Mặt nước phản chiếu thật (đợt 3, THREE.Reflector r128) ----------
  /* Shader nước: bản sao ReflectorShader gốc + uniform opacity để chỉnh
     "độ trong" (shader gốc alpha luôn 1.0, không chỉnh được độ mờ).
     Thuần theo nghĩa không cần scene/renderer — chỉ cần THREE.Reflector.
     Trả null khi không có Reflector hoặc shader gốc lạ (khi đó giữ mặt phẳng). */
  function buildWaterShader(color, opacity) {
    if (typeof THREE === 'undefined' || !THREE.Reflector || !THREE.Reflector.ReflectorShader) return null;
    var base = THREE.Reflector.ReflectorShader;
    var frag = base.fragmentShader || '';
    var op = (typeof opacity === 'number' && isFinite(opacity)) ? opacity : 0.85;
    var shader = {
      uniforms: {
        color: { value: new THREE.Color(color || '#4da39e') },
        tDiffuse: { value: null },
        textureMatrix: { value: new THREE.Matrix4() },
        opacity: { value: op }
      },
      vertexShader: base.vertexShader,
      fragmentShader: frag
    };
    if (frag.indexOf('opacity') < 0) {
      var f2 = frag.replace('uniform vec3 color;', 'uniform vec3 color;\n\t\tuniform float opacity;');
      f2 = f2.replace(/gl_FragColor = vec4\( blendOverlay\( base\.rgb, color \), 1\.0 \);/,
        'gl_FragColor = vec4( blendOverlay( base.rgb, color ), opacity );');
      if (f2 === frag || f2.indexOf('opacity') < 0) return null;
      shader.fragmentShader = f2;
    }
    return shader;
  }
  /* Thay mặt phẳng nước (PlaneGeometry) trong group bằng Reflector.
     Giữ nguyên vị trí/xoay/tỉ lệ của mặt phẳng gốc; mặt phẳng cũ chỉ dispose
     material (geometry tái dùng cho Reflector). Khi KHÔNG phản chiếu (tắt
     trong env, build chưa nối Reflector, hoặc shader gốc lạ): áp màu + độ
     trong của env nước lên mặt phẳng thường để setting nước luôn là chủ
     (syncObject đã set màu theo obj.color trước đó). */
  function _swapWaterMesh(group, obj) {
    if (typeof THREE === 'undefined' || !group || typeof group.traverse !== 'function') return false;
    var water = null;
    try { water = ED.Environment && typeof ED.Environment.getWater === 'function' ? ED.Environment.getWater() : null; } catch (e) {}
    if (!water) return false;
    var plane = null;
    group.traverse(function (c) {
      if (!plane && c.isMesh && c.geometry && c.geometry.type === 'PlaneGeometry') plane = c;
    });
    if (!plane) return false;
    var shader = (water.reflect && THREE.Reflector) ? buildWaterShader(water.color, water.opacity) : null;
    if (!shader) {
      if (plane.material) {
        if (plane.material.color) plane.material.color.set(water.color);
        plane.material.opacity = water.opacity;
        plane.material.transparent = water.opacity < 1;
      }
      return false;
    }
    var reflector = new THREE.Reflector(plane.geometry, {
      clipBias: 0.003, textureWidth: 512, textureHeight: 512, color: water.color, shader: shader
    });
    reflector.position.copy(plane.position);
    reflector.rotation.copy(plane.rotation);
    reflector.scale.copy(plane.scale);
    reflector.userData.isWaterReflector = true;
    reflector.userData.objectId = obj.id;
    reflector.material.transparent = water.opacity < 1;
    group.remove(plane);
    if (plane.material && plane.material.dispose) plane.material.dispose();
    group.add(reflector);
    return true;
  }
  /* Dựng lại toàn bộ mặt nước trong scene (khi bật/tắt phản chiếu hoặc đổi
     project/preset). Dispose render target của Reflector cũ trước khi xoá
     mesh để không rò GPU memory. Trả số mặt nước đã dựng lại. */
  function refreshWater() {
    if (!_scene || !ED.Core || typeof ED.Core.listObjects !== 'function') return 0;
    var count = 0;
    ED.Core.listObjects().forEach(function (o) {
      if (!o || o.type !== 'water' || !_meshes[o.id]) return;
      var g = _meshes[o.id];
      g.traverse(function (c) {
        if (c && c.userData && c.userData.isWaterReflector && typeof c.getRenderTarget === 'function') {
          try { var rt = c.getRenderTarget(); if (rt && rt.dispose) rt.dispose(); } catch (e) {}
        }
      });
      removeMesh(o.id);
      syncObject(o);
      count++;
    });
    return count;
  }
  /* Cập nhật live màu + độ trong của mặt nước mà KHÔNG dựng lại mesh:
     Reflector thì đổi uniform color/opacity, mặt phẳng thường thì đổi
     material.color/opacity trực tiếp. Trả số mesh nước đã cập nhật. */
  function updateWaterMaterial() {
    if (!_scene) return 0;
    var water = null;
    try { water = ED.Environment && typeof ED.Environment.getWater === 'function' ? ED.Environment.getWater() : null; } catch (e) {}
    if (!water) return 0;
    var count = 0;
    Object.keys(_meshes).forEach(function (id) {
      var obj = null;
      try { obj = ED.Core && typeof ED.Core.getObject === 'function' ? ED.Core.getObject(id) : null; } catch (e) {}
      if (!obj || obj.type !== 'water') return;
      _meshes[id].traverse(function (c) {
        if (!c || !c.isMesh) return;
        if (c.userData && c.userData.isWaterReflector) {
          var u = c.material && c.material.uniforms;
          if (u && u.color) u.color.value.set(water.color);
          if (u && u.opacity) u.opacity.value = water.opacity;
          if (c.material) c.material.transparent = water.opacity < 1;
          count++;
        } else if (c.geometry && c.geometry.type === 'PlaneGeometry') {
          if (c.material && c.material.color) c.material.color.set(water.color);
          if (c.material) { c.material.opacity = water.opacity; c.material.transparent = water.opacity < 1; }
          count++;
        }
      });
    });
    return count;
  }

  // ---------- Gizmo tự vẽ ----------
  var AXIS_COLORS = { x: 0xe53e3e, y: 0x38a169, z: 0x3182ce };
  function _makeArrow(axis) {
    var g = new THREE.Group();
    var color = AXIS_COLORS[axis];
    var dir = axis === 'x' ? _v3(1, 0, 0) : axis === 'y' ? _v3(0, 1, 0) : _v3(0, 0, 1);
    var mat = new THREE.MeshBasicMaterial({ color: color });
    var cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 8), mat);
    cyl.position.copy(dir.clone().multiplyScalar(0.5));
    cyl.quaternion.setFromUnitVectors(_v3(0, 1, 0), dir);
    cyl.userData.axis = axis; cyl.userData.gizmoMode = 'move';
    var cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.25, 10), mat);
    cone.position.copy(dir.clone().multiplyScalar(1.1));
    cone.quaternion.setFromUnitVectors(_v3(0, 1, 0), dir);
    cone.userData.axis = axis; cone.userData.gizmoMode = 'move';
    g.add(cyl); g.add(cone);
    return g;
  }
  function _makeRing(axis) {
    var mat = new THREE.MeshBasicMaterial({ color: AXIS_COLORS[axis], side: THREE.DoubleSide });
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 48), mat);
    if (axis === 'x') ring.rotation.y = Math.PI / 2;
    if (axis === 'y') ring.rotation.x = Math.PI / 2;
    ring.userData.axis = axis; ring.userData.gizmoMode = 'rotate';
    return ring;
  }
  function _makeScaleHandle(axis) {
    var mat = new THREE.MeshBasicMaterial({ color: AXIS_COLORS[axis] });
    var box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), mat);
    var dir = axis === 'x' ? _v3(1, 0, 0) : axis === 'y' ? _v3(0, 1, 0) : _v3(0, 0, 1);
    box.position.copy(dir.clone().multiplyScalar(1.1));
    box.userData.axis = axis; box.userData.gizmoMode = 'scale';
    return box;
  }
  function _rebuildGizmo() {
    if (!_gizmo) return;
    while (_gizmo.children.length) {
      var c = _gizmo.children.pop();
      c.traverse(function (n) {
        if (n.isMesh && n.geometry) n.geometry.dispose();
      });
    }
    _gizmoHandles = [];
    var axes = ['x', 'y', 'z'];
    for (var i = 0; i < 3; i++) {
      var h = null;
      if (_gizmoMode === 'move') h = _makeArrow(axes[i]);
      else if (_gizmoMode === 'rotate') h = _makeRing(axes[i]);
      else h = _makeScaleHandle(axes[i]);
      _gizmo.add(h);
      h.traverse(function (n) { if (n.userData && n.userData.axis) _gizmoHandles.push(n); });
    }
    if (_gizmoMode === 'scale') {
      var center = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.18, 0.18),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      center.userData.axis = 'xyz'; center.userData.gizmoMode = 'scale';
      _gizmo.add(center);
      _gizmoHandles.push(center);
    }
  }
  function setGizmoMode(mode) {
    if (['move', 'rotate', 'scale'].indexOf(mode) < 0) return false;
    _gizmoMode = mode;
    _rebuildGizmo();
    return true;
  }
  function getGizmoMode() { return _gizmoMode; }

  function _updateGizmoScale() {
    if (!_gizmo || !_gizmo.visible || !_camera) return;
    var d = _camera.position.distanceTo(_gizmo.position);
    var s = Math.max(0.5, d * 0.06);
    _gizmo.scale.set(s, s, s);
  }

  /* Object đang chọn (nhiều): ưu tiên ED.Core.getSelectedObjects(),
     chưa có thì [_selectedId]. */
  function _selectedObjects() {
    try {
      if (ED.Core && typeof ED.Core.getSelectedObjects === 'function') {
        var list = ED.Core.getSelectedObjects();
        if (list && list.length) return list;
      }
    } catch (e) { /* Core chưa sẵn sàng */ }
    if (_selectedId && ED.Core && ED.Core.getObject) {
      var o = ED.Core.getObject(_selectedId);
      return o ? [o] : [];
    }
    return [];
  }
  function _selectedIds() {
    try {
      if (ED.Core && typeof ED.Core.getSelectedIds === 'function') return ED.Core.getSelectedIds();
    } catch (e) { /* Core chưa sẵn sàng */ }
    return _selectedId ? [_selectedId] : [];
  }

  function _showSelection() {
    var ids = _selectedIds();
    if (ids.length > 1) {
      /* Chọn nhiều: hộp bao quanh hợp của tất cả mesh + gizmo ở tâm nhóm
         (trung bình vị trí). BoxHelper r128: gán trực tiếp .box rồi
         update() không tham số để vẽ lại từ box đã gán. */
      var union = null;
      var positions = [];
      var first = null;
      for (var i = 0; i < ids.length; i++) {
        var g = _meshes[ids[i]];
        if (!g) continue;
        if (!first) first = g;
        try {
          var b = new THREE.Box3().setFromObject(g);
          union = union ? union.union(b) : b;
        } catch (e) { /* mesh lạ, bỏ qua */ }
        try { positions.push(g.getWorldPosition(new THREE.Vector3()).toArray()); } catch (e2) {}
      }
      if (!first) { _hideSelection(); return; }
      if (union) {
        try {
          _selectionBox.box.copy(union);
          _selectionBox.update();
        } catch (e) {
          try { _selectionBox.setFromObject(first); } catch (e2) { /* giữ hộp cũ */ }
        }
        _selectionBox.visible = true;
      } else {
        _selectionBox.setFromObject(first);
        _selectionBox.visible = true;
      }
      var center = groupCenter(positions);
      if (center) _gizmo.position.set(center[0], center[1], center[2]);
      else _gizmo.position.copy(first.getWorldPosition(new THREE.Vector3()));
      _gizmo.visible = !_playMode && _walk.mode === 'off';
      _gizmo.rotation.set(0, 0, 0);
      _refreshSelBadge();
      return;
    }
    var g2 = _selectedId ? _meshes[_selectedId] : null;
    if (!g2) { _hideSelection(); return; }
    _selectionBox.setFromObject(g2);
    _selectionBox.visible = true;
    _gizmo.position.copy(g2.getWorldPosition(new THREE.Vector3()));
    _gizmo.visible = !_playMode && _walk.mode === 'off';
    _gizmo.rotation.set(0, 0, 0);
    _refreshSelBadge();
  }
  function _hideSelection() {
    _selectionBox.visible = false;
    _gizmo.visible = false;
    _refreshSelBadge();
  }

  /* Badge "Đã chọn N vật" (góc trên-giữa viewport): hiện khi có >0
     object được chọn, ẩn khi không chọn gì. */
  function _refreshSelBadge() {
    if (!_selBadge) return;
    var n = _selectedIds().length;
    if (n > 0) {
      _selBadge.style.display = 'block';
      _selBadge.textContent = 'Đã chọn ' + n + ' vật';
    } else {
      _selBadge.style.display = 'none';
    }
  }

  function _setSelected(id) {
    _selectedId = id;
    if (ED.Core) ED.Core.select(id);
    if (id) _showSelection(); else _hideSelection();
    _refreshSelBadge();
    if (ED.UI) { ED.UI.refreshHierarchy(); ED.UI.refreshInspector(); }
  }

  /* Chọn nhiều: gọi ED.Core.selectMany(ids) (giữ _selectedId = phần tử
     đầu để tương thích cũ), cập nhật gizmo/hộp chọn + Inspector +
     Hierarchy + badge. Trả mảng id đã chọn. */
  function _setMultiSelection(ids) {
    ids = Array.isArray(ids) ? ids.slice() : [];
    if (ED.Core && typeof ED.Core.selectMany === 'function') {
      ids = ED.Core.selectMany(ids);
    } else if (ED.Core && typeof ED.Core.select === 'function') {
      ED.Core.select(ids.length ? ids[0] : null);
      ids = ids.length ? [ids[0]] : [];
    }
    _selectedId = ids.length ? ids[0] : null;
    if (ids.length) _showSelection(); else _hideSelection();
    _refreshSelBadge();
    if (ED.UI) { ED.UI.refreshHierarchy(); ED.UI.refreshInspector(); }
    return ids;
  }
  function selectMany(ids) { return _setMultiSelection(ids); }
  function getSelectedIds() { return _selectedIds(); }

  function focus(id) {
    /* Đợt 6 — đang đi bộ thì focus orbit không có ý nghĩa, bỏ qua. */
    if (_walk.mode !== 'off') return;
    var targetId = id || _selectedId;
    var g = targetId ? _meshes[targetId] : null;
    if (g) {
      var p = g.getWorldPosition(new THREE.Vector3());
      _target.copy(p);
      _radius = Math.max(6, _radius * 0.5);
    } else {
      _target.set(0, 0, 0);
      _radius = 28;
    }
    _applyCamera();
  }

  /* Đợt 7 — camera đi theo hero trong Play Mode (ED.Play._followCamera
     gọi mỗi frame). Chỉ dời _target tới vị trí hero rồi áp camera theo
     kiểu orbit hiện tại (_radius/_theta/_phi giữ nguyên nên người dùng
     vẫn xoay/zoom quanh hero được — không phá orbit; focus() thu hẹp
     radius, followHero thì KHÔNG đổi radius). Đang đi bộ FPS/TPS hoặc
     đang phát đường camera thì camera do _updateWalk/_updatePathPlay
     lái nên bỏ qua (trả false). Trả true khi đã dời camera. */
  function followHero(x, z) {
    if (!_camera || !_target) return false;
    if (_walk.mode !== 'off' || _pathPlay) return false;
    var hx = Number(x), hz = Number(z);
    if (!isFinite(hx) || !isFinite(hz)) return false;
    _target.set(hx, _target.y, hz);
    _applyCamera();
    return true;
  }

  function setPlayMode(b) {
    _playMode = !!b;
    if (_gizmo) _gizmo.visible = !_playMode && !!_selectedId;
  }

  // ---------- Raycast / picking ----------
  function _rayFromEvent(e) {
    var rect = _canvas.getBoundingClientRect();
    var nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    var ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    var ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, _activeCamera());
    return ray;
  }
  function _pickObject(e) {
    var ray = _rayFromEvent(e);
    var list = [];
    for (var id in _meshes) list.push(_meshes[id]);
    var hits = ray.intersectObjects(list, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o) {
        if (o.userData && o.userData.objectId) return o.userData.objectId;
        o = o.parent;
      }
    }
    return null;
  }
  function _pickGizmo(e) {
    if (!_gizmo.visible) return null;
    var ray = _rayFromEvent(e);
    var hits = ray.intersectObjects(_gizmoHandles, false);
    return hits.length ? hits[0].object : null;
  }

  function _snap(v, step) {
    return Math.round(v / step) * step;
  }

  // ---------- API cho nhóm B/C: scene/camera/điểm trên mặt đất ----------
  function getScene() { return _scene; }
  function getCamera() { return _activeCamera(); }
  function getRenderer() { return _renderer; }
  /* Đợt 7 — canvas của viewport (renderer.domElement), null khi chưa init. */
  function getCanvas() { return _canvas; }
  /* Đợt 5 — lib RectAreaLight đã init xong chưa (ED.Environment dùng để
     quyết định có khoá nút bật đèn diện tích trong panel hay không). */
  function isRectAreaLibReady() { return _rectAreaLibInit; }
  // Điểm trên mặt đất từ tọa độ màn hình: raycast terrain nếu có, không thì mặt phẳng y=0.
  /* Đợt 4 — target raycast là 16 chunk mesh của ED.Terrain (nếu có),
     không thì mesh đất đơn _terrainMesh (fallback khi Terrain chưa load).
     Không raycast được chunk nào thì rơi xuống mặt phẳng y=0 như cũ. */
  function _groundPoint(clientX, clientY) {
    if (!_canvas || !_scene) return null;
    var ray = _rayFromEvent({ clientX: clientX, clientY: clientY });
    var targets = [];
    try {
      if (typeof ED !== 'undefined' && ED.Terrain && typeof ED.Terrain.getChunkMeshes === 'function') {
        var chunks = ED.Terrain.getChunkMeshes();
        for (var ci = 0; ci < chunks.length; ci++) if (chunks[ci]) targets.push(chunks[ci]);
      }
    } catch (e) { /* Terrain chưa sẵn sàng -> dùng _terrainMesh */ }
    if (!targets.length && _terrainMesh) targets.push(_terrainMesh);
    var hits = ray.intersectObjects(targets, false);
    if (hits.length) return { x: hits[0].point.x, z: hits[0].point.z };
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    var p = new THREE.Vector3();
    var hit = ray.ray.intersectPlane(plane, p);
    return hit ? { x: p.x, z: p.z } : null;
  }
  // Dạng {x, z} — ED.Assets.groundPoint dùng (kéo-thả asset).
  function screenToGround(clientX, clientY) { return _groundPoint(clientX, clientY); }
  // Dạng [x, z] — ED.Play._raycastGround dùng (click-to-move).
  function raycastGround(clientX, clientY) {
    var p = _groundPoint(clientX, clientY);
    return p ? [p.x, p.z] : null;
  }
  // Điểm trước camera trên mặt đất, dạng [x, z] — ED.NpcAi._frontPosition dùng.
  function getCameraFront(dist) {
    var cam = _activeCamera();
    if (!cam) return [0, 0];
    var d = (typeof dist === 'number' && isFinite(dist)) ? dist : 8;
    var dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    if (Math.abs(dir.x) < 0.001 && Math.abs(dir.z) < 0.001) return [_target.x, _target.z];
    return [cam.position.x + dir.x * d, cam.position.z + dir.z * d];
  }
  function setGroundClickHandler(fn) {
    _groundClickHandler = (typeof fn === 'function') ? fn : null;
    return true;
  }

  // ---------- Input ----------
  function _bindInput() {
    _canvas.addEventListener('pointerdown', _onPointerDown);
    _canvas.addEventListener('pointermove', _onPointerMove);
    _canvas.addEventListener('pointerup', _onPointerUp);
    _canvas.addEventListener('pointercancel', _onPointerUp);
    _canvas.addEventListener('wheel', _onWheel, { passive: false });
    _canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', _onKeyDown);
    /* Đợt 6 — đi bộ cần keyup để nhả phím WASD/Shift/Space; blur thì
       nhả hết phím + joystick để không bị "dính" phím khi mất focus. */
    window.addEventListener('keyup', _onKeyUp);
    window.addEventListener('blur', function () {
      _walk.keys = {};
      _walk.joy = { x: 0, y: 0 };
    });
  }

  function _onKeyUp(e) {
    if (!_walk.keys) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'w' || k === 'a' || k === 's' || k === 'd') _walk.keys[k] = false;
    if (e.key === 'Shift') _walk.keys.shift = false;
    if (e.key === ' ') _walk.keys.space = false;
  }

  function _onWheel(e) {
    e.preventDefault();
    /* Đợt 6 — đang đi bộ hoặc đang phát đường camera thì wheel không zoom. */
    if (_pathPlay || _walk.mode !== 'off') return;
    var f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    if (_mode === 'ortho') {
      _orthoSize = Math.max(4, Math.min(120, _orthoSize * f));
    } else {
      _radius = Math.max(3, Math.min(200, _radius * f));
    }
    _applyCamera();
  }

  function _onPointerDown(e) {
    _canvas.setPointerCapture(e.pointerId);
    _pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    _downPos = { x: e.clientX, y: e.clientY };
    _downTime = performance.now();
    var count = Object.keys(_pointers).length;
    if (count === 2) {
      var pts = Object.values(_pointers);
      _pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      _dragging = { kind: 'pinch' };
      return;
    }
    if (count > 2) return;
    /* Đợt 6 — đang phát đường camera thì canvas không nhận input orbit.
       Đang đi bộ: kéo chuột = nhìn; chạm nửa phải màn hình = nhìn,
       nửa trái để cho joystick ảo (div riêng, không tới canvas). */
    if (_pathPlay) return;
    if (_walk.mode !== 'off') {
      if (e.pointerType === 'touch') {
        var rect = _canvas.getBoundingClientRect();
        if (e.clientX - rect.left < rect.width / 2) return;
      }
      _dragging = { kind: 'look', x: e.clientX, y: e.clientY };
      return;
    }
    // Ưu tiên kéo gizmo.
    var handle = _pickGizmo(e);
    if (handle && _selectedId) {
      var obj = ED.Core ? ED.Core.getObject(_selectedId) : null;
      if (obj && !obj.locked) {
        /* Chọn >1 object (và không object nào bị khoá): snapshot cả nhóm
           để _dragGizmo áp cho cả nhóm; pushHistory 1 lần duy nhất. */
        var selObjs = _selectedObjects();
        var anyLocked = false;
        for (var si = 0; si < selObjs.length; si++) {
          if (selObjs[si].locked) { anyLocked = true; break; }
        }
        if (selObjs.length > 1 && !anyLocked) {
          var gCenter = groupCenter(selObjs.map(function (o) { return o.pos.slice(); }));
          if (gCenter) {
            if (ED.Core) ED.Core.pushHistory('gizmo nhom');
            var centerObj = { pos: gCenter.slice() };
            _groupDrag = {
              objs: selObjs, center: gCenter,
              startPos: selObjs.map(function (o) { return o.pos.slice(); }),
              startRot: selObjs.map(function (o) { return o.rot.slice(); }),
              startScale: selObjs.map(function (o) { return o.scale.slice(); }),
              axis: handle.userData.axis, mode: handle.userData.gizmoMode,
              startPoint: _planePoint(e, _dragPlane(centerObj, handle.userData.axis, handle.userData.gizmoMode)),
              startAngle: 0,
              startDist: _screenDistToPoint(e, new THREE.Vector3(gCenter[0], gCenter[1], gCenter[2]))
            };
            if (handle.userData.gizmoMode === 'rotate') {
              _groupDrag.startAngle = _angleOnPlane(e, centerObj, 'y');
            }
            _dragging = { kind: 'gizmo', axis: handle.userData.axis, mode: handle.userData.gizmoMode };
            return;
          }
        }
        _groupDrag = null;
        if (ED.Core) ED.Core.pushHistory('gizmo');
        _dragging = {
          kind: 'gizmo', axis: handle.userData.axis, mode: handle.userData.gizmoMode,
          startPos: obj.pos.slice(), startRot: obj.rot.slice(), startScale: obj.scale.slice(),
          startPoint: _planePoint(e, _dragPlane(obj, handle.userData.axis, handle.userData.gizmoMode)),
          startAngle: 0, startDist: _screenDistToObject(e)
        };
        if (handle.userData.gizmoMode === 'rotate') {
          _dragging.startAngle = _angleOnPlane(e, obj, handle.userData.axis);
        }
        return;
      }
    }
    /* Đợt 6 — chế độ chọn vùng: kéo chuột trái (hoặc 1 ngón) vẽ khung,
       không orbit. */
    if (_boxSelect && e.button === 0) {
      _boxStart = { x: e.clientX, y: e.clientY };
      _boxShift = !!e.shiftKey;
      _dragging = { kind: 'box', x: e.clientX, y: e.clientY };
      _showBoxRect(e.clientX, e.clientY, e.clientX, e.clientY);
      return;
    }
    if (e.button === 2 || e.pointerType === 'touch') {
      _dragging = { kind: 'orbit', x: e.clientX, y: e.clientY };
    } else if (e.button === 1) {
      _dragging = { kind: 'pan', x: e.clientX, y: e.clientY };
    } else {
      _dragging = { kind: 'maybe-click', x: e.clientX, y: e.clientY };
    }
  }

  function _dragPlane(obj, axis, mode) {
    var origin = _v3(obj.pos[0], obj.pos[1], obj.pos[2]);
    var normal;
    if (mode === 'rotate') {
      normal = axis === 'x' ? _v3(1, 0, 0) : axis === 'y' ? _v3(0, 1, 0) : _v3(0, 0, 1);
    } else {
      // Mặt phẳng quay mặt về camera (cho move/scale).
      normal = _camera.position.clone().sub(origin).normalize();
    }
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  }

  function _planePoint(e, plane) {
    var ray = _rayFromEvent(e);
    var p = new THREE.Vector3();
    var hit = ray.ray.intersectPlane(plane, p);
    return hit ? p : null;
  }

  function _angleOnPlane(e, obj, axis) {
    var plane = _dragPlane(obj, axis, 'rotate');
    var p = _planePoint(e, plane);
    if (!p) return 0;
    var c = _v3(obj.pos[0], obj.pos[1], obj.pos[2]);
    var d = p.clone().sub(c);
    if (axis === 'x') return Math.atan2(d.z, d.y);
    if (axis === 'y') return Math.atan2(d.x, d.z);
    return Math.atan2(d.y, d.x);
  }

  function _screenDistToObject(e) {
    if (!_selectedId || !_meshes[_selectedId]) return 1;
    var p = _meshes[_selectedId].getWorldPosition(new THREE.Vector3());
    return _screenDistToPoint(e, p);
  }
  /* Khoảng cách (px) từ điểm chạm tới 1 điểm thế giới chiếu lên màn hình. */
  function _screenDistToPoint(e, worldPos) {
    if (!worldPos || !_canvas) return 1;
    var p = worldPos.clone ? worldPos.clone() : new THREE.Vector3(worldPos[0], worldPos[1], worldPos[2]);
    p.project(_activeCamera());
    var rect = _canvas.getBoundingClientRect();
    var sx = (p.x * 0.5 + 0.5) * rect.width;
    var sy = (-p.y * 0.5 + 0.5) * rect.height;
    return Math.max(10, Math.hypot(e.clientX - rect.left - sx, e.clientY - rect.top - sy));
  }
  /* Chiếu vị trí thế giới [x,y,z] lên màn hình (px, gốc trên-trái canvas).
     Trả null khi điểm ở sau camera (z NDC > 1). */
  function _projectToScreen(pos) {
    if (!_canvas || !_camera) return null;
    var p = new THREE.Vector3(pos[0], pos[1], pos[2]);
    p.project(_activeCamera());
    if (p.z > 1) return null;
    var rect = _canvas.getBoundingClientRect();
    return {
      x: (p.x * 0.5 + 0.5) * rect.width,
      y: (-p.y * 0.5 + 0.5) * rect.height
    };
  }

  function _onPointerMove(e) {
    if (!_pointers[e.pointerId]) return;
    var prev = _pointers[e.pointerId];
    var dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    _pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (!_dragging) return;

    if (_dragging.kind === 'pinch') {
      var pts = Object.values(_pointers);
      if (pts.length === 2) {
        var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (_pinchDist > 0 && d > 0) {
          if (_mode === 'ortho') _orthoSize = Math.max(4, Math.min(120, _orthoSize * (_pinchDist / d)));
          else _radius = Math.max(3, Math.min(200, _radius * (_pinchDist / d)));
          _applyCamera();
        }
        _pinchDist = d;
        // 2 ngón di chuyển cùng chiều = pan.
        _panBy(dx * 0.5, dy * 0.5);
      }
      return;
    }
    /* Đợt 6 — kéo để nhìn trong chế độ đi bộ: yaw theo dx, pitch theo
       dy, pitch kẹp ±85° (1.4835 rad). */
    if (_dragging.kind === 'look') {
      _walk.yaw -= dx * 0.005;
      _walk.pitch = Math.max(-1.4835, Math.min(1.4835, _walk.pitch - dy * 0.005));
      return;
    }
    if (_dragging.kind === 'orbit') {
      if (e.pointerType === 'touch') {
        _theta -= dx * 0.008;
        _phi = Math.max(0.05, Math.min(Math.PI - 0.05, _phi - dy * 0.008));
      } else {
        _theta -= dx * 0.005;
        _phi = Math.max(0.05, Math.min(Math.PI - 0.05, _phi - dy * 0.005));
      }
      _applyCamera();
      return;
    }
    if (_dragging.kind === 'pan') {
      _panBy(dx, dy);
      return;
    }
    if (_dragging.kind === 'gizmo') {
      _dragGizmo(e);
      return;
    }
    if (_dragging.kind === 'box') {
      if (_boxStart) _showBoxRect(_boxStart.x, _boxStart.y, e.clientX, e.clientY);
      return;
    }
    if (_dragging.kind === 'maybe-click') {
      var moved = Math.hypot(e.clientX - _downPos.x, e.clientY - _downPos.y);
      if (moved > 6) _dragging = { kind: 'orbit', x: e.clientX, y: e.clientY };
    }
  }

  function _panBy(dx, dy) {
    var s = _radius * 0.0016;
    var cam = _activeCamera();
    var right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    var up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    _target.addScaledVector(right, -dx * s);
    _target.addScaledVector(up, dy * s);
    _applyCamera();
  }

  function _dragGizmo(e) {
    /* Kéo gizmo khi chọn >1 object: áp cho CẢ nhóm (snapshot trong
       _groupDrag). pushHistory đã ghi 1 lần lúc bắt đầu kéo. */
    if (_groupDrag) {
      _dragGroupGizmo(e);
      return;
    }
    var obj = ED.Core ? ED.Core.getObject(_selectedId) : null;
    if (!obj) return;
    var d = _dragging;
    var snapStep = e.shiftKey ? _snapFine : _snapGrid;
    if (d.mode === 'move') {
      var plane = _dragPlane(obj, d.axis, 'move');
      var p = _planePoint(e, plane);
      if (!p || !d.startPoint) return;
      var delta = p.clone().sub(d.startPoint);
      var np = d.startPos.slice();
      if (d.axis === 'x' || d.axis === 'xyz') np[0] = _snap(d.startPos[0] + delta.x, snapStep);
      if (d.axis === 'y' || d.axis === 'xyz') np[1] = _snap(d.startPos[1] + delta.y, snapStep);
      if (d.axis === 'z' || d.axis === 'xyz') np[2] = _snap(d.startPos[2] + delta.z, snapStep);
      obj.pos = np;
    } else if (d.mode === 'rotate') {
      var a = _angleOnPlane(e, obj, d.axis);
      var deltaA = a - d.startAngle;
      var idx = d.axis === 'x' ? 0 : d.axis === 'y' ? 1 : 2;
      var step = e.shiftKey ? Math.PI / 180 : Math.PI / 12; // 1° / 15°
      var nr = d.startRot.slice();
      nr[idx] = _snap(d.startRot[idx] + deltaA, step);
      obj.rot = nr;
    } else if (d.mode === 'scale') {
      var dist = _screenDistToObject(e);
      var ratio = dist / (d.startDist || 1);
      var ns = d.startScale.slice();
      var f = _snap(ratio, 0.1);
      if (f < 0.05) f = 0.05;
      if (d.axis === 'x' || d.axis === 'xyz') ns[0] = d.startScale[0] * f;
      if (d.axis === 'y' || d.axis === 'xyz') ns[1] = d.startScale[1] * f;
      if (d.axis === 'z' || d.axis === 'xyz') ns[2] = d.startScale[2] * f;
      obj.scale = ns;
    }
    if (ED.Core) ED.Core.markDirty();
    syncObject(obj);
    if (ED.UI) ED.UI.refreshInspector();
  }

  /* Kéo gizmo cho nhóm (>1 object). _groupDrag giữ snapshot lúc bắt
     đầu kéo: center, startPos/startRot/startScale từng object, mặt
     phẳng/góc/khoảng cách bắt đầu.
     - Move: cộng cùng delta cho mọi pos (snap theo lưới như 1 object).
     - Rotate: xoay từng pos quanh tâm nhóm (chỉ rot Y; rot X/Z giữ
       nguyên), rot[1] từng object cộng cùng góc quay.
     - Scale: scale khoảng cách từ tâm theo tỉ lệ + scale từng object
       nhân thêm tỉ lệ. */
  function _dragGroupGizmo(e) {
    var gd = _groupDrag;
    if (!gd || !gd.objs || !gd.objs.length) return;
    var snapStep = e.shiftKey ? _snapFine : _snapGrid;
    var centerObj = { pos: gd.center.slice() };
    if (gd.mode === 'move') {
      var plane = _dragPlane(centerObj, gd.axis, 'move');
      var p = _planePoint(e, plane);
      if (!p || !gd.startPoint) return;
      var delta = p.clone().sub(gd.startPoint);
      var nc = gd.center.slice();
      if (gd.axis === 'x' || gd.axis === 'xyz') nc[0] = _snap(gd.center[0] + delta.x, snapStep);
      if (gd.axis === 'y' || gd.axis === 'xyz') nc[1] = _snap(gd.center[1] + delta.y, snapStep);
      if (gd.axis === 'z' || gd.axis === 'xyz') nc[2] = _snap(gd.center[2] + delta.z, snapStep);
      var applied = [nc[0] - gd.center[0], nc[1] - gd.center[1], nc[2] - gd.center[2]];
      var moved = groupMovePositions(gd.startPos, applied);
      for (var i = 0; i < gd.objs.length; i++) gd.objs[i].pos = moved[i];
    } else if (gd.mode === 'rotate') {
      /* Nhóm chỉ xoay quanh trục Y (giữ nguyên rot X/Z từng object):
         đo góc trên mặt phẳng Y dù handle kéo là vòng nào. */
      var a = _angleOnPlane(e, centerObj, 'y');
      var deltaA = a - gd.startAngle;
      var step = e.shiftKey ? Math.PI / 180 : Math.PI / 12;
      var snapped = _snap(deltaA, step);
      var rotated = groupRotateYPositions(gd.startPos, gd.center, snapped);
      for (var j = 0; j < gd.objs.length; j++) {
        gd.objs[j].pos = rotated[j];
        var nr = gd.startRot[j].slice();
        nr[1] = _snap(gd.startRot[j][1] + snapped, step);
        gd.objs[j].rot = nr;
      }
    } else if (gd.mode === 'scale') {
      var centerV = new THREE.Vector3(gd.center[0], gd.center[1], gd.center[2]);
      var dist = _screenDistToPoint(e, centerV);
      var ratio = dist / (gd.startDist || 1);
      var f = _snap(ratio, 0.1);
      if (f < 0.05) f = 0.05;
      var scaled = groupScalePositions(gd.startPos, gd.center, f);
      for (var k = 0; k < gd.objs.length; k++) {
        gd.objs[k].pos = scaled[k];
        var ns = gd.startScale[k].slice();
        if (gd.axis === 'x' || gd.axis === 'xyz') ns[0] = gd.startScale[k][0] * f;
        if (gd.axis === 'y' || gd.axis === 'xyz') ns[1] = gd.startScale[k][1] * f;
        if (gd.axis === 'z' || gd.axis === 'xyz') ns[2] = gd.startScale[k][2] * f;
        gd.objs[k].scale = ns;
      }
    }
    if (ED.Core) ED.Core.markDirty();
    for (var m = 0; m < gd.objs.length; m++) syncObject(gd.objs[m]);
    _showSelection();
    if (ED.UI) ED.UI.refreshInspector();
  }

  function _onPointerUp(e) {
    delete _pointers[e.pointerId];
    /* Đợt 6 — thả chuột sau khi kéo khung chọn vùng: chọn theo khung. */
    if (_dragging && _dragging.kind === 'box') {
      _finishBoxSelect(e.clientX, e.clientY);
      _dragging = null;
      return;
    }
    if (_dragging && _dragging.kind === 'maybe-click' && _downPos) {
      var moved = Math.hypot(e.clientX - _downPos.x, e.clientY - _downPos.y);
      var quick = performance.now() - _downTime < 500;
      if (moved <= 6 && quick && e.button !== 2) {
        /* Đợt 6 — thước đo bật thì click chỉ thêm điểm đo, không chọn
           object (cũng không gọi handler đặt waypoint). */
        if (_ruler.active) {
          var rp = _groundPoint(e.clientX, e.clientY);
          if (rp) {
            addRulerPoint(rp.x, rp.z);
            if (ED.UI && ED.UI.toast) {
              var m = measurePathLength(_ruler.points);
              ED.UI.toast(_ruler.points.length < 2
                ? 'Đã thêm điểm đo 1 — bấm thêm điểm nữa'
                : 'Tổng quãng đo: ' + m.total.toFixed(1) + 'm');
            }
          }
        } else {
          var id = _pickObject(e);
          _setSelected(id);
          // Click xuống đất: báo cho handler đã đăng ký (NPC đặt waypoint).
          if (_groundClickHandler) {
            try {
              var gp = _groundPoint(e.clientX, e.clientY);
              if (gp) _groundClickHandler(gp.x, gp.z);
            } catch (err) { /* bỏ qua */ }
          }
        }
      }
    }
    if (_dragging && _dragging.kind === 'gizmo') {
      _groupDrag = null;
      if (ED.UI) ED.UI.refreshHierarchy();
    }
    _dragging = null;
  }

  function _onKeyDown(e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
    var ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (ED.Core) { ED.Core.undo(); _resyncAll(); }
      return;
    }
    if (ctrl && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      if (ED.Core) { ED.Core.redo(); _resyncAll(); }
      return;
    }
    if (ctrl && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      _duplicateSelected();
      return;
    }
    if (ctrl && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      _groupSelected();
      return;
    }
    /* Đợt 6 — Esc: thoát đi bộ trước, rồi mới dừng đường camera.
       Phím V (chưa dùng): bật/tắt chế độ đi bộ FPS. */
    if (e.key === 'Escape') {
      /* Đợt 6 — Esc ưu tiên: huỷ khung chọn vùng đang kéo, rồi xoá hết
         điểm thước đo, rồi mới thoát đi bộ / dừng đường camera. */
      if (_dragging && _dragging.kind === 'box') {
        _dragging = null;
        _hideBoxRect();
        return;
      }
      if (_ruler.active && _ruler.points.length) {
        clearRuler();
        if (ED.UI && ED.UI.toast) ED.UI.toast('Đã xoá hết điểm đo');
        return;
      }
      if (_walk.mode !== 'off') { setWalkMode('off'); return; }
      if (_pathPlay) { stopCameraPath(); return; }
    }
    /* Đợt 6 — phím M (chưa dùng ở _onKeyDown): bật/tắt bản đồ nhỏ. */
    if (e.key === 'm' || e.key === 'M') {
      if (ED.Minimap && typeof ED.Minimap.toggle === 'function') ED.Minimap.toggle();
      return;
    }
    if (_walk.mode !== 'off') {
      /* Đi bộ ưu tiên di chuyển: W đã là phím gizmo (move) nhưng gizmo
         tắt trong walk mode nên không xung đột — W/A/S/D đi, Space nhảy. */
      var wk = (e.key || '').toLowerCase();
      if (e.key === ' ') { e.preventDefault(); _walk.jumpQueued = true; return; }
      if (wk === 'w' || wk === 'a' || wk === 's' || wk === 'd') {
        _walk.keys[wk] = true;
        _walk.keys.shift = !!e.shiftKey;
        return;
      }
      if (e.key === 'Shift') { _walk.keys.shift = true; return; }
      if (wk === 'v') { e.preventDefault(); setWalkMode('off'); return; }
      return; // phím gizmo (e/r/f...) không chạy trong walk mode
    }
    if (e.key === 'v' || e.key === 'V') { setWalkMode('fps'); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      /* Đợt 6 — xoá TẤT CẢ object đang chọn (bỏ qua object đã khoá),
         pushHistory 1 lần. Chỉ 1 object thì hành vi như cũ. */
      var delIds = _selectedIds();
      if (delIds.length && ED.Core) {
        var removed = 0;
        ED.Core.pushHistory('xoa');
        delIds.slice().forEach(function (did) {
          var dobj = ED.Core.getObject(did);
          if (!dobj || dobj.locked) return;
          if (ED.Core.removeObject(did)) {
            removeMesh(did);
            removed++;
          }
        });
        _setSelected(null);
        if (removed && ED.UI && ED.UI.toast) ED.UI.toast('Đã xoá ' + removed + ' vật');
      }
      return;
    }
    if (e.key === 'w' || e.key === 'W') setGizmoMode('move');
    else if (e.key === 'e' || e.key === 'E') setGizmoMode('rotate');
    else if (e.key === 'r' || e.key === 'R') setGizmoMode('scale');
    else if (e.key === 'f' || e.key === 'F') focus();
  }

  function _duplicateSelected() {
    if (!_selectedId || !ED.Core) return;
    var src = ED.Core.getObject(_selectedId);
    if (!src) return;
    ED.Core.pushHistory('nhan ban');
    var copy = JSON.parse(JSON.stringify(src));
    delete copy.id;
    copy.name = src.name + ' copy';
    copy.pos = [src.pos[0] + 1, src.pos[1], src.pos[2] + 1];
    var obj = ED.Core.addObject(copy);
    syncObject(obj);
    _setSelected(obj.id);
  }

  function _groupSelected() {
    if (!_selectedId || !ED.Core) return;
    var child = ED.Core.getObject(_selectedId);
    if (!child) return;
    ED.Core.pushHistory('nhom');
    var group = ED.Core.addObject({
      type: 'group', category: 'Decorations', name: 'Group',
      pos: child.pos.slice(), rot: [0, 0, 0], scale: [1, 1, 1], color: '#ffd76b'
    });
    child.parent = group.id;
    ED.Core.markDirty();
    syncObject(group);
    syncObject(child);
    _setSelected(group.id);
    if (ED.UI) ED.UI.refreshHierarchy();
  }

  // Đồng bộ lại toàn bộ mesh sau undo/redo/load.
  function _resyncAll() {
    if (!ED.Core) return;
    var ids = Object.keys(_meshes);
    var current = {};
    ED.Core.listObjects().forEach(function (o) { current[o.id] = true; syncObject(o); });
    ids.forEach(function (id) { if (!current[id]) removeMesh(id); });
    syncTerrain();
    /* Đợt 6 — project vừa load/undo/redo: vẽ lại bookmark + đường camera. */
    _refreshBmList();
    _refreshPathList();
    if (_selectedId) _showSelection(); else _hideSelection();
    if (ED.UI) { ED.UI.refreshHierarchy(); ED.UI.refreshInspector(); }
  }

  function resyncAll() { _resyncAll(); }

  // ================= Đợt 6 — POST-PROCESSING =================
  var PREFS_KEY = 'mongvolam_editor_prefs_v1';
  /* Máy yếu: đọc được navigator.deviceMemory thì <=4GB là yếu; hoặc
     màn hình nhỏ (<=768px) + pixelRatio >= 2.5. Không đọc được thì
     coi là máy thường (bloom mặc định bật nhẹ). */
  function _isWeakDevice() {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.deviceMemory === 'number') {
        if (navigator.deviceMemory <= 4) return true;
      }
      var pr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      var w = (typeof window !== 'undefined' && window.innerWidth) || 0;
      if (w > 0 && w <= 768 && pr >= 2.5) return true;
    } catch (e) { /* không đọc được -> máy thường */ }
    return false;
  }
  /* Đọc cài đặt bloom/vignette từ localStorage (key con bloom:{...}).
     Chưa có thì mặc định bloom BẬT nhẹ, trừ máy yếu thì tắt. */
  function _loadFxPrefs() {
    var saved = null;
    try {
      var raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) { saved = null; }
    var b = (saved && saved.bloom && typeof saved.bloom === 'object') ? saved.bloom : {};
    var hasSaved = (typeof b.enabled === 'boolean');
    _bloom = clampBloom({
      enabled: hasSaved ? b.enabled : !_isWeakDevice(),
      strength: b.strength, radius: b.radius, threshold: b.threshold
    });
    _vignette = clampVignette({ enabled: !!b.vignetteEnabled, strength: b.vignetteStrength });
    _lowPower = !!b.lowPower;
  }
  /* Ghi đè key con bloom, giữ nguyên các key prefs khác (panel, snap...). */
  function _saveFxPrefs() {
    try {
      var saved = {};
      var raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) saved = JSON.parse(raw) || {};
      saved.bloom = {
        enabled: _bloom.enabled, strength: _bloom.strength,
        radius: _bloom.radius, threshold: _bloom.threshold,
        vignetteEnabled: _vignette.enabled, vignetteStrength: _vignette.strength,
        lowPower: _lowPower
      };
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(saved));
    } catch (e) { /* localStorage đầy/bị chặn -> cài đặt chỉ sống trong phiên */ }
  }
  /* Tạo composer khi đủ lib (guard typeof: thiếu file vendor thì chạy
     thường, không bloom, không crash). Thứ tự pass r128:
     RenderPass -> UnrealBloomPass -> ShaderPass vignette -> CopyShader. */
  function _initPostFx() {
    if (typeof THREE === 'undefined' || typeof THREE.EffectComposer !== 'function') {
      _composer = null;
      return false;
    }
    try {
      var w = _container ? (_container.clientWidth || 800) : 800;
      var h = _container ? (_container.clientHeight || 600) : 600;
      _composer = new THREE.EffectComposer(_renderer);
      _renderPass = new THREE.RenderPass(_scene, _camera);
      _composer.addPass(_renderPass);
      _bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(w, h), _bloom.strength, _bloom.radius, _bloom.threshold);
      _composer.addPass(_bloomPass);
      _vignettePass = new THREE.ShaderPass(_vignetteShader);
      _composer.addPass(_vignettePass);
      if (typeof THREE.CopyShader !== 'undefined') {
        _composer.addPass(new THREE.ShaderPass(THREE.CopyShader));
      }
      _applyFxState();
      return true;
    } catch (e) {
      _composer = null; _renderPass = null; _bloomPass = null; _vignettePass = null;
      return false;
    }
  }
  function _fxActive() {
    if (!_composer) return false;
    return (_bloom.enabled && !_lowPower) || _vignette.enabled;
  }
  function _applyFxState() {
    if (_bloomPass) {
      _bloomPass.enabled = _bloom.enabled && !_lowPower;
      _bloomPass.strength = _bloom.strength;
      _bloomPass.radius = _bloom.radius;
      _bloomPass.threshold = _bloom.threshold;
    }
    if (_vignettePass) {
      _vignettePass.enabled = _vignette.enabled;
      if (_vignettePass.uniforms && _vignettePass.uniforms.strength) {
        _vignettePass.uniforms.strength.value = _vignette.strength;
      }
    }
  }
  function setBloom(opts) {
    var o = (opts && typeof opts === 'object') ? opts : {};
    _bloom = clampBloom({
      enabled: (typeof o.enabled === 'boolean') ? o.enabled : _bloom.enabled,
      strength: (o.strength !== undefined) ? o.strength : _bloom.strength,
      radius: (o.radius !== undefined) ? o.radius : _bloom.radius,
      threshold: (o.threshold !== undefined) ? o.threshold : _bloom.threshold
    });
    _applyFxState();
    _saveFxPrefs();
    _syncFxPanel();
    return getBloom();
  }
  function getBloom() {
    return {
      enabled: _bloom.enabled, strength: _bloom.strength,
      radius: _bloom.radius, threshold: _bloom.threshold,
      lowPower: _lowPower, weakDevice: _isWeakDevice(), available: !!_composer
    };
  }
  function setVignette(opts) {
    var o = (opts && typeof opts === 'object') ? opts : {};
    _vignette = clampVignette({
      enabled: (typeof o.enabled === 'boolean') ? o.enabled : _vignette.enabled,
      strength: (o.strength !== undefined) ? o.strength : _vignette.strength
    });
    _applyFxState();
    _saveFxPrefs();
    _syncFxPanel();
    return getVignette();
  }
  function getVignette() {
    return { enabled: _vignette.enabled, strength: _vignette.strength, available: !!_composer };
  }
  /* "Tắt khi máy yếu": ép tắt bloom (vignette không tốn mấy nên giữ). */
  function setLowPower(b) {
    _lowPower = !!b;
    _applyFxState();
    _saveFxPrefs();
    _syncFxPanel();
    return _lowPower;
  }
  function isPostFxReady() { return !!_composer; }

  // ================= Đợt 6 — PANEL HIỆU ỨNG + CAMERA =================
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _el(id) {
    return (typeof document !== 'undefined') ? document.getElementById(id) : null;
  }
  /* 1 panel duy nhất chứa section Hiệu ứng + Đi bộ + Bookmark + Đường
     camera (không sửa 02-ui.js). Nút/slider đều chạy thật. */
  function _buildViewportPanels() {
    if (typeof document === 'undefined' || _fxPanel) return;
    var panel = document.getElementById('viewport-fx-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'viewport-fx-panel';
      panel.className = 'ed-viewport-panel';
      document.body.appendChild(panel);
    }
    _fxPanel = panel;
    panel.innerHTML =
      '<div class="ed-row ed-viewport-panel-head">' +
        '<span class="ed-panel-title" style="flex:1;margin:0;border:0;">✨ Hiệu ứng &amp; 🎥 Camera</span>' +
        '<button type="button" id="ed-vp-collapse" title="Thu gọn / mở rộng">–</button>' +
      '</div>' +
      '<div id="ed-vp-body">' +
      '<div class="ed-panel-title">✨ Hiệu ứng</div>' +
      '<div class="ed-row"><label><input type="checkbox" id="ed-vp-bloom"> Bloom</label>' +
      '<label><input type="checkbox" id="ed-vp-lowpower"> Tắt khi máy yếu</label></div>' +
      '<div class="ed-row"><label>Độ sáng</label>' +
      '<input type="range" id="ed-vp-bloom-strength" min="0" max="2" step="0.05" value="0.6">' +
      '<span id="ed-vp-bloom-strength-v">0.60</span></div>' +
      '<div class="ed-row"><label>Bán kính</label>' +
      '<input type="range" id="ed-vp-bloom-radius" min="0" max="1" step="0.05" value="0.4">' +
      '<span id="ed-vp-bloom-radius-v">0.40</span></div>' +
      '<div class="ed-row"><label>Ngưỡng</label>' +
      '<input type="range" id="ed-vp-bloom-threshold" min="0" max="1" step="0.05" value="0.85">' +
      '<span id="ed-vp-bloom-threshold-v">0.85</span></div>' +
      '<div class="ed-row"><label><input type="checkbox" id="ed-vp-vignette"> Vignette (tối 4 góc)</label>' +
      '<input type="range" id="ed-vp-vig-strength" min="0" max="1" step="0.05" value="0.5">' +
      '<span id="ed-vp-vig-strength-v">0.50</span></div>' +
      '<div class="ed-hint" id="ed-vp-fx-note"></div>' +
      '<div class="ed-panel-title">🚶 Đi bộ</div>' +
      '<div class="ed-row">' +
      '<button type="button" id="ed-vp-walk-fps">Đi bộ (FPS)</button>' +
      '<button type="button" id="ed-vp-walk-tps">Vai (TPS)</button>' +
      '<button type="button" id="ed-vp-walk-off">Tắt</button></div>' +
      '<div class="ed-hint">WASD di chuyển, Shift chạy, Space nhảy, kéo chuột để nhìn. Phím V bật/tắt, Esc thoát.</div>' +
      '<div class="ed-panel-title">🔖 Bookmark camera</div>' +
      '<div class="ed-row"><input type="text" id="ed-vp-bm-name" placeholder="Tên góc..." style="flex:1;min-width:0;">' +
      '<button type="button" id="ed-vp-bm-add">Lưu góc hiện tại</button></div>' +
      '<div id="ed-vp-bm-list"></div>' +
      '<div class="ed-panel-title">🎬 Đường camera</div>' +
      '<div class="ed-row"><input type="text" id="ed-vp-path-name" placeholder="Tên đường..." style="flex:1;min-width:0;">' +
      '<button type="button" id="ed-vp-path-add">Tạo đường</button></div>' +
      '<div id="ed-vp-path-list"></div>' +
      '<div class="ed-row"><button type="button" id="ed-vp-path-play">▶ Phát</button>' +
      '<button type="button" id="ed-vp-path-stop">■ Dừng</button></div>' +
      '<div class="ed-row"><input type="range" id="ed-vp-path-scrub" min="0" max="0" step="0.1" value="0">' +
      '<span id="ed-vp-path-time">0.0s</span></div>' +
      '<div class="ed-hint">Thêm keyframe từ góc camera hiện tại (mỗi key cách key trước 2s), rồi Phát để xem camera bay theo đường cong.</div>' +
      '</div>';
    var on = function (id, ev, fn) {
      var n = _el(id);
      if (n) n.addEventListener(ev, fn);
    };
    on('ed-vp-collapse', 'click', function () {
      var body = _el('ed-vp-body'), btn = _el('ed-vp-collapse');
      if (!body || !btn) return;
      var hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      btn.textContent = hidden ? '–' : '+';
    });
    on('ed-vp-bloom', 'change', function (e) { setBloom({ enabled: e.target.checked }); });
    on('ed-vp-lowpower', 'change', function (e) { setLowPower(e.target.checked); });
    on('ed-vp-bloom-strength', 'input', function (e) { setBloom({ strength: parseFloat(e.target.value) }); });
    on('ed-vp-bloom-radius', 'input', function (e) { setBloom({ radius: parseFloat(e.target.value) }); });
    on('ed-vp-bloom-threshold', 'input', function (e) { setBloom({ threshold: parseFloat(e.target.value) }); });
    on('ed-vp-vignette', 'change', function (e) { setVignette({ enabled: e.target.checked }); });
    on('ed-vp-vig-strength', 'input', function (e) { setVignette({ strength: parseFloat(e.target.value) }); });
    on('ed-vp-walk-fps', 'click', function () { setWalkMode('fps'); });
    on('ed-vp-walk-tps', 'click', function () { setWalkMode('tps'); });
    on('ed-vp-walk-off', 'click', function () { setWalkMode('off'); });
    on('ed-vp-bm-add', 'click', function () {
      var inp = _el('ed-vp-bm-name');
      addBookmark(inp ? inp.value : '');
      if (inp) inp.value = '';
    });
    on('ed-vp-path-add', 'click', function () {
      var inp = _el('ed-vp-path-name');
      addCameraPath(inp ? inp.value : '');
      if (inp) inp.value = '';
    });
    on('ed-vp-path-play', 'click', function () { _togglePathPlay(); });
    on('ed-vp-path-stop', 'click', function () { stopCameraPath(); });
    on('ed-vp-path-scrub', 'input', function (e) {
      if (!_pathPlay) return;
      _pathPlay.playing = false;
      _pathPlay.t = parseFloat(e.target.value) || 0;
      _applyPathPoint();
      _syncPathUI();
    });
  }
  /* Đồng bộ control panel theo state (gọi sau load/set). */
  function _syncFxPanel() {
    if (!_fxPanel) return;
    var setVal = function (id, v) { var n = _el(id); if (n) n.value = v; };
    var setChk = function (id, v) { var n = _el(id); if (n) n.checked = !!v; };
    var setTxt = function (id, v) { var n = _el(id); if (n) n.textContent = v; };
    setChk('ed-vp-bloom', _bloom.enabled);
    setChk('ed-vp-lowpower', _lowPower);
    setVal('ed-vp-bloom-strength', _bloom.strength);
    setVal('ed-vp-bloom-radius', _bloom.radius);
    setVal('ed-vp-bloom-threshold', _bloom.threshold);
    setTxt('ed-vp-bloom-strength-v', _bloom.strength.toFixed(2));
    setTxt('ed-vp-bloom-radius-v', _bloom.radius.toFixed(2));
    setTxt('ed-vp-bloom-threshold-v', _bloom.threshold.toFixed(2));
    setChk('ed-vp-vignette', _vignette.enabled);
    setVal('ed-vp-vig-strength', _vignette.strength);
    setTxt('ed-vp-vig-strength-v', _vignette.strength.toFixed(2));
    var note = _el('ed-vp-fx-note');
    if (note) {
      if (!_composer) note.textContent = 'Chưa nối lib post-processing (EffectComposer): hiệu ứng không khả dụng, viewport chạy thường.';
      else if (_isWeakDevice()) note.textContent = 'Thiết bị yếu (RAM ≤4GB hoặc màn nhỏ + pixelRatio cao): bloom mặc định tắt, vẫn bật tay được.';
      else note.textContent = '';
    }
    _syncWalkPanel();
  }
  function _syncWalkPanel() {
    if (!_fxPanel) return;
    var mark = function (id, on) {
      var n = _el(id);
      if (n) { if (on) n.classList.add('active'); else n.classList.remove('active'); }
    };
    mark('ed-vp-walk-fps', _walk.mode === 'fps');
    mark('ed-vp-walk-tps', _walk.mode === 'tps');
    mark('ed-vp-walk-off', _walk.mode === 'off');
  }

  // ================= Đợt 6 — CHẾ ĐỘ ĐI BỘ FPS/TPS =================
  /* Nút nổi trên viewport (không sửa 02-ui.js): bấm để bật/tắt đi bộ. */
  function _buildWalkButton() {
    if (typeof document === 'undefined' || !_container || _walkBtn) return;
    try {
      if (window.getComputedStyle && window.getComputedStyle(_container).position === 'static') {
        _container.style.position = 'relative';
      }
    } catch (e) { /* kệ, nút vẫn append được */ }
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ed-vp-walk-btn';
    b.textContent = '🚶 Đi bộ';
    b.addEventListener('click', function () {
      setWalkMode(_walk.mode === 'off' ? 'fps' : 'off');
    });
    _container.appendChild(b);
    _walkBtn = b;
  }
  function _updateWalkBtn() {
    if (!_walkBtn) return;
    _walkBtn.textContent = (_walk.mode === 'off') ? '🚶 Đi bộ' : '🚶 Đang đi bộ — bấm để tắt';
    if (_walk.mode === 'off') _walkBtn.classList.remove('active');
    else _walkBtn.classList.add('active');
  }
  /* Joystick ảo góc dưới-trái: chỉ hiện khi đang đi bộ + màn hình cảm ứng. */
  function _buildJoystick() {
    if (typeof document === 'undefined' || !_container || _joyEl) return;
    var joy = document.createElement('div');
    joy.id = 'ed-vp-joystick';
    joy.className = 'ed-vp-joystick';
    var knob = document.createElement('div');
    knob.className = 'ed-vp-joystick-knob';
    joy.appendChild(knob);
    _container.appendChild(joy);
    _joyEl = joy;
    _joyKnob = knob;
    var joyMove = function (e) {
      var r = joy.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var len = Math.sqrt(dx * dx + dy * dy), max = 44;
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      _walk.joy = { x: dx / max, y: dy / max };
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    };
    var joyEnd = function () {
      _walk.joy = { x: 0, y: 0 };
      knob.style.transform = 'translate(0px,0px)';
    };
    joy.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { joy.setPointerCapture(e.pointerId); } catch (err) { /* kệ */ }
      joyMove(e);
    });
    joy.addEventListener('pointermove', function (e) {
      if (_walk.joy.x !== 0 || _walk.joy.y !== 0) joyMove(e);
    });
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);
    _updateJoystickVisibility();
  }
  function _updateJoystickVisibility() {
    if (!_joyEl) return;
    var touch = false;
    try {
      touch = (typeof window !== 'undefined') &&
        (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));
    } catch (e) { touch = false; }
    _joyEl.style.display = (_walk.mode !== 'off' && touch) ? 'block' : 'none';
  }

  // ================= Đợt 6 — CHỌN VÙNG + THƯỚC ĐO =================
  /* Toolbar nổi góc trên-trái viewport: "▣ Chọn vùng" + "📏 Thước đo"
     + "✕ Xoá đo" (nút xoá chỉ hiện khi thước đo có điểm). Nút nào cũng
     chạy thật; không sửa template/02-ui.js. */
  function _buildSelectToolbar() {
    if (typeof document === 'undefined' || !_container || _selectToolbar) return;
    var bar = document.createElement('div');
    bar.className = 'ed-vp-select-toolbar';
    bar.style.position = 'absolute';
    bar.style.top = '8px';
    bar.style.left = '8px';
    bar.style.zIndex = '55';
    bar.style.display = 'flex';
    bar.style.gap = '6px';
    bar.style.flexWrap = 'wrap';
    _container.appendChild(bar);
    _selectToolbar = bar;

    _boxBtn = document.createElement('button');
    _boxBtn.type = 'button';
    _boxBtn.className = 'ed-vp-tool-btn';
    _boxBtn.style.minHeight = '40px';
    _boxBtn.textContent = '▣ Chọn vùng';
    _boxBtn.title = 'Kéo chuột vẽ khung để chọn nhiều vật (giữ Shift để thêm/bớt)';
    _boxBtn.addEventListener('click', function () { setBoxSelect(!_boxSelect); });
    bar.appendChild(_boxBtn);

    _rulerBtn = document.createElement('button');
    _rulerBtn.type = 'button';
    _rulerBtn.className = 'ed-vp-tool-btn';
    _rulerBtn.style.minHeight = '40px';
    _rulerBtn.textContent = '📏 Thước đo';
    _rulerBtn.title = 'Bật rồi bấm xuống đất để thêm điểm đo (Esc xoá hết)';
    _rulerBtn.addEventListener('click', function () { setRuler(!_ruler.active); });
    bar.appendChild(_rulerBtn);

    _rulerClearBtn = document.createElement('button');
    _rulerClearBtn.type = 'button';
    _rulerClearBtn.className = 'ed-vp-tool-btn';
    _rulerClearBtn.style.minHeight = '40px';
    _rulerClearBtn.textContent = '✕ Xoá đo';
    _rulerClearBtn.title = 'Xoá hết điểm đo';
    _rulerClearBtn.style.display = 'none';
    _rulerClearBtn.addEventListener('click', function () { clearRuler(); });
    bar.appendChild(_rulerClearBtn);
    _syncSelectToolbar();
  }
  function _syncSelectToolbar() {
    if (_boxBtn) {
      _boxBtn.classList.toggle('active', _boxSelect);
      _boxBtn.textContent = _boxSelect ? '▣ Đang chọn vùng — bấm để tắt' : '▣ Chọn vùng';
    }
    if (_rulerBtn) {
      _rulerBtn.classList.toggle('active', _ruler.active);
      _rulerBtn.textContent = _ruler.active ? '📏 Đang đo — bấm để tắt' : '📏 Thước đo';
    }
    if (_rulerClearBtn) {
      _rulerClearBtn.style.display = _ruler.points.length ? '' : 'none';
    }
  }
  function setBoxSelect(b) {
    _boxSelect = !!b;
    if (_boxSelect && _ruler.active) setRuler(false); // 2 chế độ không bật cùng lúc
    _syncSelectToolbar();
    return _boxSelect;
  }
  function getBoxSelect() { return _boxSelect; }

  /* Div khung chữ nhật khi kéo chọn vùng (viền vàng, nền mờ). */
  function _buildBoxRectDiv() {
    if (typeof document === 'undefined' || !_container || _boxDiv) return;
    var d = document.createElement('div');
    d.className = 'ed-box-rect';
    d.style.position = 'absolute';
    d.style.display = 'none';
    d.style.border = '2px solid #ffd76b';
    d.style.background = 'rgba(255, 215, 107, 0.12)';
    d.style.zIndex = '54';
    d.style.pointerEvents = 'none';
    _container.appendChild(d);
    _boxDiv = d;
  }
  function _showBoxRect(x0, y0, x1, y1) {
    if (!_boxDiv || !_container) return;
    var r = _container.getBoundingClientRect();
    var a = normalizeBoxRect(x0 - r.left, y0 - r.top, x1 - r.left, y1 - r.top);
    _boxDiv.style.left = a.x0 + 'px';
    _boxDiv.style.top = a.y0 + 'px';
    _boxDiv.style.width = Math.max(0, a.x1 - a.x0) + 'px';
    _boxDiv.style.height = Math.max(0, a.y1 - a.y0) + 'px';
    _boxDiv.style.display = 'block';
  }
  function _hideBoxRect() {
    if (_boxDiv) _boxDiv.style.display = 'none';
    _boxStart = null;
  }
  /* Kết thúc kéo khung: chọn object có vị trí chiếu lên màn hình nằm
     trong khung (chỉ visible + không locked). Không Shift: thay selection;
     có Shift: toggle thêm/bớt từng object. */
  function _finishBoxSelect(x1, y1) {
    if (!_boxStart || !_canvas) { _hideBoxRect(); return []; }
    var rect = _canvas.getBoundingClientRect();
    var r = normalizeBoxRect(
      _boxStart.x - rect.left, _boxStart.y - rect.top,
      x1 - rect.left, y1 - rect.top);
    var objs = [];
    try {
      if (ED.Core && typeof ED.Core.listObjects === 'function') objs = ED.Core.listObjects();
    } catch (e) { objs = []; }
    var inBox = boxSelectFilter(objs, function (pos) { return _projectToScreen(pos); }, r);
    var next = _boxShift ? boxSelectToggle(_selectedIds(), inBox) : inBox;
    _hideBoxRect();
    var chosen = _setMultiSelection(next);
    if (ED.UI && ED.UI.toast) {
      ED.UI.toast(chosen.length ? ('Đã chọn ' + chosen.length + ' vật') : 'Không có vật nào trong khung');
    }
    return chosen;
  }

  /* Badge "Đã chọn N vật" (góc trên-giữa viewport). */
  function _buildSelBadge() {
    if (typeof document === 'undefined' || !_container || _selBadge) return;
    var b = document.createElement('div');
    b.className = 'ed-sel-badge';
    b.style.position = 'absolute';
    b.style.top = '8px';
    b.style.left = '50%';
    b.style.transform = 'translateX(-50%)';
    b.style.zIndex = '55';
    b.style.display = 'none';
    b.style.padding = '8px 12px';
    b.style.minHeight = '40px';
    b.style.boxSizing = 'border-box';
    b.style.background = 'rgba(26, 29, 33, 0.9)';
    b.style.border = '1px solid #ffd76b';
    b.style.borderRadius = '8px';
    b.style.color = '#ffd76b';
    b.style.fontSize = '13px';
    b.style.pointerEvents = 'none';
    _container.appendChild(b);
    _selBadge = b;
  }

  // ---------- Thước đo ----------
  /* Badge thước đo (góc dưới-trái viewport): khoảng cách từng đoạn + tổng. */
  function _buildRulerBadge() {
    if (typeof document === 'undefined' || !_container || _ruler.badge) return;
    var b = document.createElement('div');
    b.className = 'ed-ruler-badge';
    b.style.position = 'absolute';
    b.style.left = '8px';
    b.style.bottom = '8px';
    b.style.zIndex = '55';
    b.style.display = 'none';
    b.style.padding = '8px 12px';
    b.style.minHeight = '40px';
    b.style.boxSizing = 'border-box';
    b.style.background = 'rgba(26, 29, 33, 0.9)';
    b.style.border = '1px solid #ffd76b';
    b.style.borderRadius = '8px';
    b.style.color = '#e5e7eb';
    b.style.fontSize = '13px';
    b.style.pointerEvents = 'none';
    _container.appendChild(b);
    _ruler.badge = b;
  }
  function setRuler(b) {
    _ruler.active = !!b;
    if (_ruler.active && _boxSelect) setBoxSelect(false);
    _updateRulerLine();
    _updateRulerBadge();
    _syncSelectToolbar();
    return _ruler.active;
  }
  function getRuler() { return _ruler.active; }
  function getRulerPoints() {
    return _ruler.points.map(function (p) { return p.slice(); });
  }
  /* Thêm 1 điểm đo (tọa độ thế giới x,z; y lấy theo mặt đất + 0.15).
     Trả số điểm hiện có. */
  function addRulerPoint(x, z) {
    var y = 0.15;
    try {
      if (ED.Terrain && typeof ED.Terrain.heightAt === 'function') {
        var h = ED.Terrain.heightAt(x, z);
        if (isFinite(h)) y = h + 0.15;
      }
    } catch (e) { /* Terrain chưa sẵn sàng */ }
    _ruler.points.push([Number(x) || 0, y, Number(z) || 0]);
    _updateRulerLine();
    _updateRulerBadge();
    _syncSelectToolbar();
    return _ruler.points.length;
  }
  function clearRuler() {
    _ruler.points = [];
    _updateRulerLine();
    _updateRulerBadge();
    _syncSelectToolbar();
    return 0;
  }
  /* Vẽ đường kẻ qua các điểm đo (THREE.Line vàng). Tắt thước đo thì ẩn
     đường (GIỮ LẠI điểm để bật lại còn), bật lại thì hiện lại. */
  function _updateRulerLine() {
    if (!_scene) return;
    if (!_ruler.line) {
      try {
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
        _ruler.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd76b }));
        _ruler.line.frustumCulled = false;
        _scene.add(_ruler.line);
      } catch (e) { _ruler.line = null; return; }
    }
    var show = _ruler.active && _ruler.points.length >= 2;
    _ruler.line.visible = show;
    if (!show) return;
    var arr = new Float32Array(_ruler.points.length * 3);
    for (var i = 0; i < _ruler.points.length; i++) {
      arr[i * 3] = _ruler.points[i][0];
      arr[i * 3 + 1] = _ruler.points[i][1];
      arr[i * 3 + 2] = _ruler.points[i][2];
    }
    _ruler.line.geometry.dispose();
    _ruler.line.geometry = new THREE.BufferGeometry();
    _ruler.line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  }
  function _updateRulerBadge() {
    if (!_ruler.badge) return;
    if (!_ruler.active || _ruler.points.length < 2) {
      _ruler.badge.style.display = 'none';
      return;
    }
    var m = measurePathLength(_ruler.points);
    var parts = [];
    for (var i = 0; i < m.segments.length; i++) {
      parts.push('Đoạn ' + (i + 1) + ': ' + m.segments[i].toFixed(1) + 'm');
    }
    parts.push('Tổng: ' + m.total.toFixed(1) + 'm');
    _ruler.badge.textContent = '📏 ' + parts.join(' · ');
    _ruler.badge.style.display = 'block';
  }
  /* Chiều cao mặt đất tại (x,z) qua ED.Terrain (guard — chưa có thì 0). */
  function _groundHeight(x, z) {
    try {
      if (ED.Terrain && typeof ED.Terrain.heightAt === 'function') {
        var h = ED.Terrain.heightAt(x, z);
        if (isFinite(h)) return h;
      }
    } catch (e) { /* Terrain chưa sẵn sàng */ }
    return 0;
  }
  /* Chất liệu đất tại (x,z) từ project.terrain.paints (0=cỏ 1=đất 2=đá
     3=cát 4=nước). Không đọc được thì -1 (không chặn). */
  function _paintAt(x, z) {
    var paints = null, size = 96, seg = 64;
    try {
      if (ED.Core && typeof ED.Core.getProject === 'function') {
        var p = ED.Core.getProject();
        if (p && p.terrain) {
          paints = p.terrain.paints;
          size = p.terrain.size || 96;
          seg = p.terrain.segments || 64;
        }
      }
      if (!paints && ED.Terrain && typeof ED.Terrain.getPaints === 'function') {
        paints = ED.Terrain.getPaints();
      }
    } catch (e) { /* không đọc được paints */ }
    if (!paints || !paints.length) return -1;
    var n = Math.round(seg);
    if (n <= 0) return -1;
    var side = n + 1;
    var gx = Math.floor((x + size / 2) / size * n);
    var gz = Math.floor((z + size / 2) / size * n);
    if (gx < 0) gx = 0; else if (gx > n) gx = n;
    if (gz < 0) gz = 0; else if (gz > n) gz = n;
    var v = paints[gz * side + gx];
    return (typeof v === 'number') ? v : -1;
  }
  /* Va chạm dự phòng khi chưa có ED.Physics: chặn theo từng trục (để
     trượt dọc tường) qua object có extra.collider; box xoay rot.y thì
     lấy AABB gần đúng (cùng công thức ED.Nav/ED.Physics). */
  function _walkMoveFallback(x, z, dx, dz, feetY) {
    var nx = x + dx, nz = z + dz;
    var blocked = function (px, pz) {
      if (!ED.Core || typeof ED.Core.listObjects !== 'function') return false;
      var objs = ED.Core.listObjects();
      for (var i = 0; i < objs.length; i++) {
        var o = objs[i];
        if (!o || !o.extra || !o.extra.collider) continue;
        if (o.visible === false) continue;
        var sc = (Array.isArray(o.scale) && o.scale.length >= 3) ? o.scale : [1, 1, 1];
        var a = (Array.isArray(o.rot) && isFinite(Number(o.rot[1]))) ? Number(o.rot[1]) : 0;
        var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
        var ex = (c * Math.abs(sc[0]) + s * Math.abs(sc[2])) / 2;
        var ez = (s * Math.abs(sc[0]) + c * Math.abs(sc[2])) / 2;
        var bottom = Number(o.pos[1]) || 0;
        var top = bottom + Math.abs(Number(sc[1]) || 1);
        if (feetY >= top || feetY + 1.8 <= bottom) continue;
        if (Math.abs(px - o.pos[0]) < ex + 0.35 && Math.abs(pz - o.pos[2]) < ez + 0.35) return true;
      }
      return false;
    };
    if (blocked(nx, z)) nx = x;
    if (blocked(nx, nz)) nz = z;
    return [nx, nz];
  }
  /* Trọng lực đơn giản khi chưa có ED.Physics: rơi theo g=20, chạm đất
     (ED.Terrain.heightAt) thì đứng lại. */
  function _walkSimpleGravity(dt) {
    _walk.velY -= 20 * dt;
    if (_walk.velY < -40) _walk.velY = -40;
    _walk.pos[1] += _walk.velY * dt;
    var g = _groundHeight(_walk.pos[0], _walk.pos[2]);
    if (_walk.pos[1] <= g) {
      _walk.pos[1] = g;
      _walk.velY = 0;
      _walk.grounded = true;
    } else {
      _walk.grounded = false;
    }
  }
  function setWalkMode(mode) {
    if (['off', 'fps', 'tps'].indexOf(mode) < 0) return false;
    if (mode === _walk.mode) return true;
    if (mode === 'off') {
      if (_walk.saved && _target) {
        _target.set(_walk.saved.target[0], _walk.saved.target[1], _walk.saved.target[2]);
        _radius = _walk.saved.radius;
        _theta = _walk.saved.theta;
        _phi = _walk.saved.phi;
        _mode = _walk.saved.mode;
        _walk.saved = null;
      }
      _walk.mode = 'off';
      _walk.keys = {};
      _walk.joy = { x: 0, y: 0 };
      _walk.body = null;
      _walk.jumpQueued = false;
      if (_gizmo) _gizmo.visible = !!_selectedId && !_playMode;
      _applyCamera();
      _updateJoystickVisibility();
      _updateWalkBtn();
      _syncWalkPanel();
      return true;
    }
    /* Vào đi bộ: dừng đường camera đang phát, lưu orbit cũ để trả lại. */
    stopCameraPath();
    _camAnim = null;
    if (_camera && _target) {
      _walk.saved = {
        target: [_target.x, _target.y, _target.z],
        radius: _radius, theta: _theta, phi: _phi, mode: _mode
      };
      var dir = new THREE.Vector3();
      _camera.getWorldDirection(dir);
      _walk.yaw = Math.atan2(dir.x, dir.z);
      _walk.pitch = Math.max(-1.4835, Math.min(1.4835, Math.asin(
        Math.max(-1, Math.min(1, dir.y)))));
      _walk.pos = [_target.x, _groundHeight(_target.x, _target.z), _target.z];
    } else {
      _walk.saved = { target: [0, 0, 0], radius: 28, theta: 0.7, phi: 1.0, mode: 'persp' };
      _walk.yaw = 0;
      _walk.pitch = 0;
      _walk.pos = [0, 0, 0];
    }
    _walk.velY = 0;
    _walk.grounded = true;
    _walk.keys = {};
    _walk.joy = { x: 0, y: 0 };
    _walk.body = null;
    _walk.jumpQueued = false;
    _walk.mode = mode;
    if (_gizmo) _gizmo.visible = false;
    if (_selectionBox) _selectionBox.visible = false;
    _updateJoystickVisibility();
    _updateWalkBtn();
    _syncWalkPanel();
    return true;
  }
  function getWalkMode() { return _walk.mode; }
  /* 1 frame đi bộ: di chuyển + va chạm + nhảy/trọng lực + đặt camera. */
  function _updateWalk(dt) {
    if (_walk.mode === 'off' || !_camera || !(dt > 0)) return;
    var speed = _walk.keys.shift ? 9 : 5; // Shift chạy 9, đi thường 5
    var f = ((_walk.keys.w ? 1 : 0) - (_walk.keys.s ? 1 : 0)) - _walk.joy.y;
    var r = ((_walk.keys.d ? 1 : 0) - (_walk.keys.a ? 1 : 0)) + _walk.joy.x;
    var len = Math.sqrt(f * f + r * r);
    if (len > 1) { f /= len; r /= len; }
    var sy = Math.sin(_walk.yaw), cy = Math.cos(_walk.yaw);
    /* forward = [sin yaw, 0, cos yaw]; right = [-cos yaw, 0, sin yaw]. */
    var dx = (sy * f - cy * r) * speed * dt;
    var dz = (cy * f + sy * r) * speed * dt;
    var feetY = _walk.pos[1];
    var nx = _walk.pos[0], nz = _walk.pos[2];
    if (dx !== 0 || dz !== 0) {
      var moved = false;
      if (ED.Physics && typeof ED.Physics.moveCapsule === 'function' && ED.Core &&
          typeof ED.Core.listObjects === 'function') {
        try {
          var boxes = ED.Physics.boxesFromObjects(ED.Core.listObjects());
          var res = ED.Physics.moveCapsule([nx, nz], dx, dz, feetY, 0.35, 1.8, boxes);
          nx = res.pos[0];
          nz = res.pos[1];
          moved = true;
        } catch (e) { moved = false; }
      }
      if (!moved) {
        var fb = _walkMoveFallback(nx, nz, dx, dz, feetY);
        nx = fb[0];
        nz = fb[1];
      }
      /* Không đi xuống nước (paint = 4 tại vị trí mới thì giữ chỗ cũ). */
      if (_paintAt(nx, nz) === 4) { nx = _walk.pos[0]; nz = _walk.pos[2]; }
      _walk.pos[0] = nx;
      _walk.pos[2] = nz;
    }
    /* Nhảy: Space đã queue ở _onKeyDown. */
    if (_walk.jumpQueued) {
      _walk.jumpQueued = false;
      if (_walk.grounded) {
        if (ED.Physics && typeof ED.Physics.jump === 'function' && _walk.body) {
          _walk.body = ED.Physics.jump(_walk.body);
          _walk.grounded = false;
        } else {
          _walk.velY = 8;
          _walk.grounded = false;
        }
      }
    }
    /* Trọng lực: ưu tiên ED.Physics.stepBody, chưa có thì rơi tự tính. */
    if (ED.Physics && typeof ED.Physics.stepBody === 'function' && ED.Core &&
        typeof ED.Core.listObjects === 'function') {
      try {
        if (!_walk.body) {
          _walk.body = { pos: _walk.pos.slice(), vel: [0, 0, 0], grounded: true, radius: 0.35, height: 1.8 };
        }
        _walk.body.pos[0] = _walk.pos[0];
        _walk.body.pos[2] = _walk.pos[2];
        if (_walk.body.vel[1] === 0 && _walk.velY !== 0) _walk.body.vel[1] = _walk.velY;
        var proj = ED.Core.getProject();
        var terr = (proj && proj.terrain) ? proj.terrain : null;
        _walk.body = ED.Physics.stepBody(_walk.body, dt, {
          heights: terr ? terr.heights : null,
          boxes: ED.Physics.boxesFromObjects(ED.Core.listObjects()),
          size: terr ? terr.size : 96,
          segments: terr ? terr.segments : 64
        });
        _walk.pos[1] = _walk.body.pos[1];
        _walk.velY = _walk.body.vel[1];
        _walk.grounded = _walk.body.grounded;
      } catch (e) { _walkSimpleGravity(dt); }
    } else {
      _walkSimpleGravity(dt);
    }
    /* Đặt camera: FPS = mắt nhân vật cao 1.7; TPS = sau lưng 4, cao 2,
       không để camera chui xuống đất (kẹp trên mặt đất + 0.3). */
    var cp = Math.cos(_walk.pitch), sp = Math.sin(_walk.pitch);
    var fx = Math.sin(_walk.yaw) * cp, fy = sp, fz = Math.cos(_walk.yaw) * cp;
    var eyeY = _walk.pos[1] + 1.7;
    if (_walk.mode === 'fps') {
      _camera.position.set(_walk.pos[0], eyeY, _walk.pos[2]);
      _camera.lookAt(_walk.pos[0] + fx, eyeY + fy, _walk.pos[2] + fz);
    } else {
      var bx = _walk.pos[0] - Math.sin(_walk.yaw) * 4;
      var bz = _walk.pos[2] - Math.cos(_walk.yaw) * 4;
      var by = _walk.pos[1] + 2;
      var g = _groundHeight(bx, bz);
      if (by < g + 0.3) by = g + 0.3;
      _camera.position.set(bx, by, bz);
      _camera.lookAt(_walk.pos[0], _walk.pos[1] + 1.5, _walk.pos[2]);
    }
    _camera.updateProjectionMatrix();
  }

  // ================= Đợt 6 — CAMERA VIEW / BOOKMARK =================
  /* Đặt orbit (target/radius/theta/phi) từ pos + target. */
  function _setOrbitFromView(pos, target) {
    if (!pos || !target || !_target) return false;
    var p = edViewportVec3(pos), t = edViewportVec3(target);
    if (!p || !t) return false;
    _target.set(t[0], t[1], t[2]);
    var dx = p[0] - t[0], dy = p[1] - t[1], dz = p[2] - t[2];
    _radius = Math.max(3, Math.sqrt(dx * dx + dy * dy + dz * dz));
    _theta = Math.atan2(dx, dz);
    _phi = Math.max(0.05, Math.min(Math.PI - 0.05,
      Math.acos(Math.max(-1, Math.min(1, dy / _radius)))));
    return true;
  }
  function getCameraView() {
    if (!_camera) return null;
    var pos = [_camera.position.x, _camera.position.y, _camera.position.z];
    var tgt;
    if (_walk.mode !== 'off') {
      var cp = Math.cos(_walk.pitch), sp = Math.sin(_walk.pitch);
      tgt = [
        _walk.pos[0] + Math.sin(_walk.yaw) * cp * 5,
        _walk.pos[1] + 1.7 + sp * 5,
        _walk.pos[2] + Math.cos(_walk.yaw) * cp * 5
      ];
    } else if (_pathPlay) {
      var d = new THREE.Vector3();
      _camera.getWorldDirection(d);
      tgt = [pos[0] + d.x * 10, pos[1] + d.y * 10, pos[2] + d.z * 10];
    } else if (_target) {
      tgt = [_target.x, _target.y, _target.z];
    } else {
      tgt = [0, 0, 0];
    }
    return { pos: pos, target: tgt };
  }
  function setCameraView(pos, target) {
    if (_walk.mode !== 'off') setWalkMode('off');
    if (!_setOrbitFromView(pos, target)) return false;
    _applyCamera();
    return true;
  }
  /* Đưa target camera tới (x, 0, z), giữ nguyên radius (minimap dùng). */
  function jumpTo(x, z) {
    if (typeof x !== 'number' || typeof z !== 'number' || !isFinite(x) || !isFinite(z)) return false;
    if (!_target) return false;
    _target.set(x, 0, z);
    _applyCamera();
    return true;
  }
  /* project.cameras = {bookmarks:[], paths:[]} — project cũ không có thì
     tự tạo mặc định (field mới của project JSON v1, giữ tương thích). */
  function _ensureCameras() {
    if (!ED.Core || typeof ED.Core.getProject !== 'function') return null;
    var proj = ED.Core.getProject();
    if (!proj || typeof proj !== 'object') return null;
    if (!proj.cameras || typeof proj.cameras !== 'object') proj.cameras = { bookmarks: [], paths: [] };
    if (!Array.isArray(proj.cameras.bookmarks)) proj.cameras.bookmarks = [];
    if (!Array.isArray(proj.cameras.paths)) proj.cameras.paths = [];
    return proj.cameras;
  }
  function _nextCamId(prefix, list) {
    var n = (list ? list.length : 0) + 1, id = prefix + n;
    var exists = function (v) {
      return (list || []).some(function (it) { return it && it.id === v; });
    };
    while (exists(id)) { n++; id = prefix + n; }
    return id;
  }
  function getBookmarks() {
    var c = _ensureCameras();
    return c ? bookmarkNormalize(c.bookmarks) : [];
  }
  function addBookmark(name) {
    var c = _ensureCameras();
    if (!c) return null;
    var v = getCameraView();
    if (!v) return null;
    var nm = (typeof name === 'string' && name.trim()) ? name.trim() : ('Góc ' + (c.bookmarks.length + 1));
    var bm = { id: _nextCamId('bm', c.bookmarks), name: nm, pos: v.pos, target: v.target };
    if (ED.Core) ED.Core.pushHistory('them bookmark');
    c.bookmarks.push(bm);
    if (ED.Core) ED.Core.markDirty();
    _refreshBmList();
    return bm;
  }
  function removeBookmark(id) {
    var c = _ensureCameras();
    if (!c) return false;
    var before = c.bookmarks.length;
    c.bookmarks = c.bookmarks.filter(function (b) { return !b || b.id !== id; });
    if (c.bookmarks.length === before) return false;
    if (ED.Core) { ED.Core.pushHistory('xoa bookmark'); ED.Core.markDirty(); }
    _refreshBmList();
    return true;
  }
  /* Đi tới bookmark bằng nội suy mượt 0.6s (không teleport đột ngột). */
  function gotoBookmark(id) {
    var c = _ensureCameras();
    if (!c) return false;
    var bm = null;
    for (var i = 0; i < c.bookmarks.length; i++) {
      if (c.bookmarks[i] && c.bookmarks[i].id === id) { bm = c.bookmarks[i]; break; }
    }
    if (!bm) return false;
    var v = getCameraView();
    if (!v) return false;
    if (_walk.mode !== 'off') setWalkMode('off');
    stopCameraPath();
    _camAnim = {
      fromPos: v.pos.slice(), fromTarget: v.target.slice(),
      toPos: bm.pos.slice(), toTarget: bm.target.slice(),
      start: (typeof performance !== 'undefined') ? performance.now() : 0, dur: 600
    };
    return true;
  }
  function _updateCamAnim(now) {
    if (!_camAnim) return;
    var p = (_camAnim.dur > 0) ? (now - _camAnim.start) / _camAnim.dur : 1;
    if (p >= 1) {
      _setOrbitFromView(_camAnim.toPos, _camAnim.toTarget);
      _camAnim = null;
      _applyCamera();
      return;
    }
    if (p < 0) p = 0;
    var e = p * p * (3 - 2 * p); // smoothstep
    var lerp = function (a, b) { return a + (b - a) * e; };
    _setOrbitFromView(
      [lerp(_camAnim.fromPos[0], _camAnim.toPos[0]), lerp(_camAnim.fromPos[1], _camAnim.toPos[1]), lerp(_camAnim.fromPos[2], _camAnim.toPos[2])],
      [lerp(_camAnim.fromTarget[0], _camAnim.toTarget[0]), lerp(_camAnim.fromTarget[1], _camAnim.toTarget[1]), lerp(_camAnim.fromTarget[2], _camAnim.toTarget[2])]
    );
    _applyCamera();
  }
  function _refreshBmList() {
    var el = _el('ed-vp-bm-list');
    if (!el) return;
    var list = getBookmarks();
    if (!list.length) {
      el.innerHTML = '<div class="ed-hint">Chưa có bookmark nào.</div>';
      return;
    }
    var h = '';
    for (var i = 0; i < list.length; i++) {
      h += '<div class="ed-vp-bm-row"><span class="ed-vp-bm-name">' + _esc(list[i].name) + '</span>' +
        '<button type="button" data-go="' + _esc(list[i].id) + '">Đi tới</button>' +
        '<button type="button" data-del="' + _esc(list[i].id) + '">Xoá</button></div>';
    }
    el.innerHTML = h;
    var gos = el.querySelectorAll('[data-go]');
    for (var g = 0; g < gos.length; g++) {
      gos[g].addEventListener('click', function (e) { gotoBookmark(e.target.getAttribute('data-go')); });
    }
    var dels = el.querySelectorAll('[data-del]');
    for (var d = 0; d < dels.length; d++) {
      dels[d].addEventListener('click', function (e) { removeBookmark(e.target.getAttribute('data-del')); });
    }
  }

  // ================= Đợt 6 — ĐƯỜNG CAMERA ĐIỆN ẢNH =================
  function getCameraPaths() {
    var c = _ensureCameras();
    if (!c) return [];
    return c.paths.map(function (p) {
      return {
        id: p.id, name: p.name,
        keys: (Array.isArray(p.keys) ? p.keys : []).map(function (k) {
          return {
            t: Number(k.t) || 0,
            pos: (k.pos || []).slice(), target: (k.target || []).slice()
          };
        })
      };
    });
  }
  function addCameraPath(name) {
    var c = _ensureCameras();
    if (!c) return null;
    var nm = (typeof name === 'string' && name.trim()) ? name.trim() : ('Đường ' + (c.paths.length + 1));
    var p = { id: _nextCamId('cp', c.paths), name: nm, keys: [] };
    if (ED.Core) ED.Core.pushHistory('them duong camera');
    c.paths.push(p);
    if (ED.Core) ED.Core.markDirty();
    _refreshPathList();
    return p;
  }
  /* Thêm keyframe từ camera hiện tại; t = key cuối + 2s (key đầu t = 0). */
  function addCameraKey(pathId) {
    var c = _ensureCameras();
    if (!c) return null;
    var p = null;
    for (var i = 0; i < c.paths.length; i++) {
      if (c.paths[i] && c.paths[i].id === pathId) { p = c.paths[i]; break; }
    }
    if (!p) return null;
    var v = getCameraView();
    if (!v) return null;
    if (!Array.isArray(p.keys)) p.keys = [];
    var last = p.keys[p.keys.length - 1];
    var t = last ? (Number(last.t) || 0) + 2 : 0;
    var k = { t: t, pos: v.pos, target: v.target };
    if (ED.Core) ED.Core.pushHistory('them keyframe camera');
    p.keys.push(k);
    if (ED.Core) ED.Core.markDirty();
    _refreshPathList();
    return k;
  }
  function removeCameraPath(id) {
    var c = _ensureCameras();
    if (!c) return false;
    if (_pathPlay && _pathPlay.pathId === id) stopCameraPath();
    var before = c.paths.length;
    c.paths = c.paths.filter(function (p) { return !p || p.id !== id; });
    if (c.paths.length === before) return false;
    if (ED.Core) { ED.Core.pushHistory('xoa duong camera'); ED.Core.markDirty(); }
    _refreshPathList();
    return true;
  }
  function playCameraPath(id) {
    var c = _ensureCameras();
    if (!c) return false;
    var p = null;
    for (var i = 0; i < c.paths.length; i++) {
      if (c.paths[i] && c.paths[i].id === id) { p = c.paths[i]; break; }
    }
    if (!p || !Array.isArray(p.keys) || p.keys.length < 2) return false;
    if (_walk.mode !== 'off') setWalkMode('off');
    _camAnim = null;
    var keys = p.keys.slice().sort(function (a, b) { return (Number(a.t) || 0) - (Number(b.t) || 0); });
    var t0 = Number(keys[0].t) || 0;
    var t1 = Number(keys[keys.length - 1].t) || 0;
    _pathPlay = { pathId: id, keys: keys, t: t0, dur: Math.max(0, t1 - t0), playing: true };
    _lastPathId = id;
    if (_gizmo) _gizmo.visible = false;
    _applyPathPoint();
    _syncPathUI();
    return true;
  }
  function stopCameraPath() {
    if (!_pathPlay) return false;
    var v = getCameraView();
    _pathPlay = null;
    if (v) _setOrbitFromView(v.pos, v.target);
    _applyCamera();
    if (_gizmo) _gizmo.visible = !!_selectedId && !_playMode && _walk.mode === 'off';
    _syncPathUI();
    return true;
  }
  function getCameraPathState() {
    if (!_pathPlay) return null;
    return { pathId: _pathPlay.pathId, t: _pathPlay.t, dur: _pathPlay.dur, playing: _pathPlay.playing };
  }
  function _applyPathPoint() {
    if (!_pathPlay || !_camera) return;
    var pt = edCameraPathPoint(_pathPlay.keys, _pathPlay.t);
    if (!pt) return;
    _camera.position.set(pt.pos[0], pt.pos[1], pt.pos[2]);
    _camera.lookAt(pt.target[0], pt.target[1], pt.target[2]);
    _camera.updateProjectionMatrix();
  }
  function _updatePathPlay(dt) {
    if (!_pathPlay) return;
    if (_pathPlay.playing) {
      _pathPlay.t += dt;
      var keys = _pathPlay.keys;
      var lastT = Number(keys[keys.length - 1].t) || 0;
      if (_pathPlay.t >= lastT) {
        /* Hết path: dừng ở key cuối, trả orbit về key cuối. */
        _pathPlay.t = lastT;
        _pathPlay.playing = false;
        _applyPathPoint();
        var last = keys[keys.length - 1];
        _setOrbitFromView(last.pos, last.target);
        _pathPlay = null;
        _applyCamera();
        if (_gizmo) _gizmo.visible = !!_selectedId && !_playMode;
      } else {
        _applyPathPoint();
      }
    }
    _syncPathUI();
  }
  /* Nút Phát: phát/tạm dừng/tiếp tục đường đang chọn (mặc định đường đầu). */
  function _togglePathPlay() {
    if (_pathPlay) {
      if (_pathPlay.playing) { _pathPlay.playing = false; }
      else {
        var keys = _pathPlay.keys;
        var lastT = Number(keys[keys.length - 1].t) || 0;
        if (_pathPlay.t >= lastT) _pathPlay.t = Number(keys[0].t) || 0;
        _pathPlay.playing = true;
      }
      _syncPathUI();
      return;
    }
    var id = _lastPathId;
    if (!id) {
      var paths = getCameraPaths();
      if (paths.length) id = paths[0].id;
    }
    if (id) playCameraPath(id);
  }
  function _syncPathUI() {
    if (!_fxPanel) return;
    var scrub = _el('ed-vp-path-scrub'), time = _el('ed-vp-path-time');
    var playBtn = _el('ed-vp-path-play');
    if (playBtn) playBtn.textContent = (_pathPlay && _pathPlay.playing) ? '⏸ Tạm dừng' : '▶ Phát';
    if (!_pathPlay) {
      if (scrub) { scrub.max = 0; scrub.value = 0; }
      if (time) time.textContent = '0.0s';
      return;
    }
    if (scrub) {
      scrub.max = _pathPlay.dur;
      scrub.value = _pathPlay.t;
    }
    if (time) time.textContent = _pathPlay.t.toFixed(1) + 's / ' + _pathPlay.dur.toFixed(1) + 's';
  }
  function _refreshPathList() {
    var el = _el('ed-vp-path-list');
    if (!el) return;
    var list = getCameraPaths();
    if (!list.length) {
      el.innerHTML = '<div class="ed-hint">Chưa có đường camera nào. Tạo đường rồi bấm "Thêm key" ở từng góc muốn bay qua.</div>';
      return;
    }
    var h = '';
    for (var i = 0; i < list.length; i++) {
      h += '<div class="ed-vp-bm-row"><span class="ed-vp-bm-name">' + _esc(list[i].name) +
        ' (' + list[i].keys.length + ' key)</span>' +
        '<button type="button" data-key="' + _esc(list[i].id) + '">Thêm key</button>' +
        '<button type="button" data-play="' + _esc(list[i].id) + '">Phát</button>' +
        '<button type="button" data-delpath="' + _esc(list[i].id) + '">Xoá</button></div>';
    }
    el.innerHTML = h;
    var keys = el.querySelectorAll('[data-key]');
    for (var a = 0; a < keys.length; a++) {
      keys[a].addEventListener('click', function (e) { addCameraKey(e.target.getAttribute('data-key')); });
    }
    var plays = el.querySelectorAll('[data-play]');
    for (var b = 0; b < plays.length; b++) {
      plays[b].addEventListener('click', function (e) { playCameraPath(e.target.getAttribute('data-play')); });
    }
    var dels = el.querySelectorAll('[data-delpath]');
    for (var c = 0; c < dels.length; c++) {
      dels[c].addEventListener('click', function (e) { removeCameraPath(e.target.getAttribute('data-delpath')); });
    }
  }

  return {
    init: init, meshes: _meshes,
    syncObject: syncObject, removeMesh: removeMesh, syncTerrain: syncTerrain,
    getTerrainMesh: getTerrainMesh,
    setGizmoMode: setGizmoMode, getGizmoMode: getGizmoMode,
    focus: focus, setCameraPreset: setCameraPreset, getCameraPreset: getCameraPreset,
    followHero: followHero, getCanvas: getCanvas,
    setPlayMode: setPlayMode, resyncAll: resyncAll,
    getScene: getScene, getCamera: getCamera, getRenderer: getRenderer,
    screenToGround: screenToGround, raycastGround: raycastGround,
    getCameraFront: getCameraFront, setGroundClickHandler: setGroundClickHandler,
    /* Đợt 3 — mặt nước phản chiếu thật (THREE.Reflector r128). */
    buildWaterShader: buildWaterShader, refreshWater: refreshWater,
    updateWaterMaterial: updateWaterMaterial,
    /* Đợt 5 — RectAreaLightUniformsLib đã init 1 lần ở Viewport.init. */
    isRectAreaLibReady: isRectAreaLibReady,
    /* Đợt 6 — post-processing (bloom/vignette). */
    setBloom: setBloom, getBloom: getBloom,
    setVignette: setVignette, getVignette: getVignette,
    setLowPower: setLowPower, isPostFxReady: isPostFxReady,
    /* Đợt 6 — hàm thuần (harness test bằng vm). */
    clampBloom: clampBloom, clampVignette: clampVignette,
    cameraPathPoint: edCameraPathPoint, bookmarkNormalize: bookmarkNormalize,
    measurePathLength: measurePathLength,
    boxSelectFilter: boxSelectFilter, boxSelectToggle: boxSelectToggle,
    normalizeBoxRect: normalizeBoxRect,
    groupCenter: groupCenter,
    groupMovePositions: groupMovePositions,
    groupRotateYPositions: groupRotateYPositions,
    groupScalePositions: groupScalePositions,
    /* Đợt 6 — chọn vùng + thước đo + chọn nhiều. */
    setBoxSelect: setBoxSelect, getBoxSelect: getBoxSelect,
    setRuler: setRuler, getRuler: getRuler,
    addRulerPoint: addRulerPoint, clearRuler: clearRuler,
    getRulerPoints: getRulerPoints,
    selectMany: selectMany, getSelectedIds: getSelectedIds,
    /* Đợt 6 — chế độ đi bộ FPS/TPS. */
    setWalkMode: setWalkMode, getWalkMode: getWalkMode,
    /* Đợt 6 — bookmark + view camera. */
    getBookmarks: getBookmarks, addBookmark: addBookmark,
    removeBookmark: removeBookmark, gotoBookmark: gotoBookmark,
    getCameraView: getCameraView, setCameraView: setCameraView, jumpTo: jumpTo,
    /* Đợt 6 — đường camera điện ảnh. */
    getCameraPaths: getCameraPaths, addCameraPath: addCameraPath,
    addCameraKey: addCameraKey, removeCameraPath: removeCameraPath,
    playCameraPath: playCameraPath, stopCameraPath: stopCameraPath,
    getCameraPathState: getCameraPathState,
    get scene() { return _scene; },
    get camera() { return _activeCamera(); },
    get renderer() { return _renderer; }
  };
})();
