/* Map Editor — 01-viewport.js (worker A)
   ED.Viewport: renderer, camera, gizmo tự vẽ, chọn object, input chuột/chạm/bàn phím.
   KHÔNG dùng OrbitControls (r128 examples không có sẵn dạng global) — tự code orbit/pan/zoom.
   KHÔNG truy cập document/window/THREE ở top-level; mọi khởi tạo trong init(). */
var ED = ED || {};

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
      _renderer.render(_scene, _activeCamera());
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

  function syncObject(obj) {
    if (!_scene || !obj) return null;
    var group = _meshes[obj.id];
    if (!group) {
      if (ED.Assets && typeof ED.Assets.buildMesh === 'function') {
        try { group = ED.Assets.buildMesh(obj.type, obj); } catch (e) { group = null; }
      }
      if (!group) group = _fallbackMesh(obj);
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

  function _showSelection() {
    var g = _selectedId ? _meshes[_selectedId] : null;
    if (!g) { _hideSelection(); return; }
    _selectionBox.setFromObject(g);
    _selectionBox.visible = true;
    _gizmo.position.copy(g.getWorldPosition(new THREE.Vector3()));
    _gizmo.visible = !_playMode;
    _gizmo.rotation.set(0, 0, 0);
  }
  function _hideSelection() {
    _selectionBox.visible = false;
    _gizmo.visible = false;
  }

  function _setSelected(id) {
    _selectedId = id;
    if (ED.Core) ED.Core.select(id);
    if (id) _showSelection(); else _hideSelection();
    if (ED.UI) { ED.UI.refreshHierarchy(); ED.UI.refreshInspector(); }
  }

  function focus(id) {
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
  }

  function _onWheel(e) {
    e.preventDefault();
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
    // Ưu tiên kéo gizmo.
    var handle = _pickGizmo(e);
    if (handle && _selectedId) {
      var obj = ED.Core ? ED.Core.getObject(_selectedId) : null;
      if (obj && !obj.locked) {
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
    p.project(_activeCamera());
    var rect = _canvas.getBoundingClientRect();
    var sx = (p.x * 0.5 + 0.5) * rect.width;
    var sy = (-p.y * 0.5 + 0.5) * rect.height;
    return Math.max(10, Math.hypot(e.clientX - rect.left - sx, e.clientY - rect.top - sy));
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

  function _onPointerUp(e) {
    delete _pointers[e.pointerId];
    if (_dragging && _dragging.kind === 'maybe-click' && _downPos) {
      var moved = Math.hypot(e.clientX - _downPos.x, e.clientY - _downPos.y);
      var quick = performance.now() - _downTime < 500;
      if (moved <= 6 && quick && e.button !== 2) {
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
    if (_dragging && _dragging.kind === 'gizmo') {
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
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (_selectedId && ED.Core) {
        var obj = ED.Core.getObject(_selectedId);
        if (obj && !obj.locked) {
          ED.Core.pushHistory('xoa');
          ED.Core.removeObject(_selectedId);
          removeMesh(_selectedId);
          _setSelected(null);
        }
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
    if (_selectedId) _showSelection(); else _hideSelection();
    if (ED.UI) { ED.UI.refreshHierarchy(); ED.UI.refreshInspector(); }
  }

  function resyncAll() { _resyncAll(); }

  return {
    init: init, meshes: _meshes,
    syncObject: syncObject, removeMesh: removeMesh, syncTerrain: syncTerrain,
    getTerrainMesh: getTerrainMesh,
    setGizmoMode: setGizmoMode, getGizmoMode: getGizmoMode,
    focus: focus, setCameraPreset: setCameraPreset, getCameraPreset: getCameraPreset,
    setPlayMode: setPlayMode, resyncAll: resyncAll,
    getScene: getScene, getCamera: getCamera, getRenderer: getRenderer,
    screenToGround: screenToGround, raycastGround: raycastGround,
    getCameraFront: getCameraFront, setGroundClickHandler: setGroundClickHandler,
    /* Đợt 3 — mặt nước phản chiếu thật (THREE.Reflector r128). */
    buildWaterShader: buildWaterShader, refreshWater: refreshWater,
    updateWaterMaterial: updateWaterMaterial,
    /* Đợt 5 — RectAreaLightUniformsLib đã init 1 lần ở Viewport.init. */
    isRectAreaLibReady: isRectAreaLibReady,
    get scene() { return _scene; },
    get camera() { return _activeCamera(); },
    get renderer() { return _renderer; }
  };
})();
