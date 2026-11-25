/* ============================================================================
   Map Editor — 15-export.js (đợt 2)
   ED.Export — xuất scene thành file .GLB thật (THREE.GLTFExporter r128,
   vendored lib/GLTFExporter.js) + nhạc nền ambient (mp3/wav/ogg ≤ 10 MB,
   lưu IndexedDB store 'assets', key 'audio:ambient', phát bằng
   HTMLAudioElement loop).
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo trong init(). Logic thuần (validate GLB, tên file, validate
   audio, key audio) viết thành hàm edExport* để test Node bằng vm.
   KHÔNG sửa 02-ui.js / 09-play.js / 99-boot.js / build-editor.mjs: panel
   của module tự tạo (gắn vào #panel-right nếu có, fallback append body);
   Play Mode chỉ gọi API ED.Export.playAmbient()/stopAmbient() khi tích hợp
   (xem báo cáo đợt 2 — đoạn wiring cho 09-play.js).
   Giới hạn export: chỉ mesh + transform + material cơ bản (MeshStandard/
   Lambert màu, roughness, metalness, opacity; texture kèm theo khả năng
   của exporter). Không export: gizmo, lưới GridHelper, trục AxesHelper,
   đèn của editor, Points/Lines (FX hạt), animation, camera.
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Export = (function () {
  'use strict';

  var DB_NAME = 'mongvolam_editor_v1';
  var STORE = 'assets';
  var AUDIO_ID = 'ambient';
  var AUDIO_KEY = 'audio:' + AUDIO_ID;
  var MAX_AUDIO_BYTES = 10 * 1024 * 1024;
  var AUDIO_EXTS = ['mp3', 'wav', 'ogg'];

  var _panel = null;
  var _audioEl = null;      // HTMLAudioElement, tạo lười trong hàm
  var _audioUrl = null;     // blob URL hiện tại (revoke khi đổi/xoá)
  var _audioKey = null;     // 'audio:ambient' khi đã có nhạc, null nếu chưa
  var _audioName = '';
  var _volume = 0.5;
  var _exporting = false;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---- Logic thuần: validate GLB. ----
     buf: ArrayBuffer | Uint8Array | Buffer | Array<number>.
     GLB: 12 byte header — magic 'glTF' (0x46546C67, little-endian),
     version == 2, length == độ dài file thật. */
  function edExportValidateGLB(buf) {
    var bytes = null;
    try {
      if (!buf) bytes = null;
      else if (typeof Uint8Array !== 'undefined' && buf instanceof Uint8Array) bytes = buf;
      else if (buf instanceof ArrayBuffer) bytes = new Uint8Array(buf);
      else if (Array.isArray(buf)) bytes = Uint8Array.from(buf);
      else if (buf && typeof buf.byteLength === 'number' && buf.buffer instanceof ArrayBuffer) {
        bytes = new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength);
      }
    } catch (e) { bytes = null; }
    if (!bytes || bytes.length < 12) {
      return { ok: false, version: 0, length: 0, reason: 'File quá ngắn (< 12 byte), không phải GLB.' };
    }
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var magic = dv.getUint32(0, true);
    if (magic !== 0x46546C67) {
      return { ok: false, version: 0, length: 0, reason: '4 byte đầu không phải "glTF".' };
    }
    var version = dv.getUint32(4, true);
    if (version !== 2) {
      return { ok: false, version: version, length: 0, reason: 'GLB version ' + version + ', cần version 2.' };
    }
    var length = dv.getUint32(8, true);
    if (length !== bytes.length) {
      return { ok: false, version: 2, length: length, reason: 'Độ dài trong header (' + length + ') khác độ dài file thật (' + bytes.length + ').' };
    }
    return { ok: true, version: 2, length: length, reason: '' };
  }

  /* Tên file .glb từ tên project: bỏ ký tự cấm trên Windows, fallback
     'map-editor'. Thuần. */
  function edExportFileName(projectName) {
    var n = String(projectName || '').trim().replace(/\.glb$/i, '');
    n = n.replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
    if (!n) n = 'map-editor';
    return n + '.glb';
  }

  /* Validate file audio (chỉ xem {name, size}, không cần File thật). */
  function edExportValidateAudioFile(file) {
    if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name) {
      return { ok: false, ext: '', reason: 'Chưa chọn file nào.' };
    }
    var ext = file.name.split('.').pop().toLowerCase();
    if (AUDIO_EXTS.indexOf(ext) < 0) {
      return { ok: false, ext: ext, reason: 'File "' + file.name + '" không phải .mp3 / .wav / .ogg.' };
    }
    var size = Number(file.size);
    if (!size || size < 1) return { ok: false, ext: ext, reason: 'File rỗng, không đọc được.' };
    if (size > MAX_AUDIO_BYTES) {
      return { ok: false, ext: ext, reason: 'File quá lớn (' + (size / 1048576).toFixed(1) + ' MB, tối đa 10 MB).' };
    }
    return { ok: true, ext: ext, reason: '' };
  }

  function edExportAudioKey(id) {
    id = String(id || '').trim();
    if (!id) return '';
    return 'audio:' + id;
  }
  function edExportParseAudioKey(key) {
    if (typeof key !== 'string') return null;
    if (key.indexOf('audio:') !== 0) return null;
    var id = key.slice('audio:'.length);
    return id ? id : null;
  }

  function toast(msg) {
    if (ED.UI && typeof ED.UI.toast === 'function') { try { ED.UI.toast(msg); } catch (e) {} }
  }
  function log(msg) {
    if (ED.UI && typeof ED.UI.log === 'function') { try { ED.UI.log(msg); } catch (e) {} }
  }
  function projectName() {
    var p = ED.Core && typeof ED.Core.getProject === 'function' ? ED.Core.getProject() : null;
    return (p && p.name) ? p.name : 'map-editor';
  }

  /* ---- IndexedDB store 'assets' (cùng pattern 03-assets.js). ---- */
  function openDb() {
    return new Promise(function (resolve, reject) {
      var idb = null;
      try { idb = (typeof window !== 'undefined' && window.indexedDB) ? window.indexedDB : null; } catch (e) { idb = null; }
      if (!idb) { reject(new Error('Trình duyệt này không dùng được IndexedDB.')); return; }
      var req;
      try { req = idb.open(DB_NAME, 1); } catch (e) { reject(new Error('Không mở được IndexedDB.')); return; }
      req.onupgradeneeded = function () {
        try {
          var db = req.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'name' });
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        } catch (e) {}
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(new Error('Không mở được IndexedDB.')); };
      req.onblocked = function () { reject(new Error('IndexedDB đang bị chặn, đóng tab khác rồi thử lại.')); };
    });
  }
  function idbPut(rec) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, done = false;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không lưu được nhạc nền.')); return; }
        tx.oncomplete = function () { try { db.close(); } catch (e) {} if (!done) { done = true; resolve(rec); } };
        tx.onerror = function () { try { db.close(); } catch (e) {} if (!done) { done = true; reject(new Error('Không lưu được nhạc nền vào máy.')); } };
        try { tx.objectStore(STORE).put(rec); } catch (e) { try { db.close(); } catch (e2) {} if (!done) { done = true; reject(new Error('Không lưu được nhạc nền.')); } }
      });
    });
  }
  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readonly'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được nhạc nền đã lưu.')); return; }
        var req;
        try { req = tx.objectStore(STORE).get(key); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được nhạc nền đã lưu.')); return; }
        req.onsuccess = function () { try { db.close(); } catch (e) {} resolve(req.result || null); };
        req.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không đọc được nhạc nền đã lưu.')); };
      });
    });
  }
  function idbDel(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xoá được nhạc nền.')); return; }
        tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(); };
        tx.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không xoá được nhạc nền.')); };
        try { tx.objectStore(STORE).delete(key); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xoá được nhạc nền.')); }
      });
    });
  }

  /* ---- Export .GLB thật. ---- */
  function isGLBReady() {
    try {
      return (typeof THREE !== 'undefined') && !!THREE.GLTFExporter &&
        typeof THREE.GLTFExporter === 'function';
    } catch (e) { return false; }
  }

  /* Dựng scene tạm chỉ gồm terrain + các object trong Viewport.meshes
     (clone, giữ nguyên transform). Không lấy toàn bộ scene của editor
     (gizmo, grid, axes, đèn editor sẽ lọt vào file nếu lấy cả scene).
     Nhóm con đã nằm trong group cha thì bỏ qua (đi kèm bản clone của cha).
     Points/Lines/Sprite (FX hạt) bị loại — GLTFExporter r128 không xuất
     được loại này, giữ lại sẽ làm export lỗi hoặc ra file thiếu. */
  function buildExportScene() {
    if (typeof THREE === 'undefined' || !ED.Viewport) return null;
    var scene = new THREE.Scene();
    scene.name = projectName();
    var meshes = ED.Viewport.meshes || {};
    var ids = Object.keys(meshes);
    var added = 0;
    ids.forEach(function (id) {
      var g = meshes[id];
      if (!g) return;
      if (g.visible === false) return;
      /* Con của 1 group khác trong meshes: đã đi kèm khi clone cha. */
      if (g.parent && g.parent !== ED.Viewport.scene &&
          g.parent.userData && g.parent.userData.objectId &&
          meshes[g.parent.userData.objectId]) return;
      var c = null;
      try { c = g.clone(true); } catch (e) { return; }
      if (!c) return;
      var obj = ED.Core && typeof ED.Core.getObject === 'function' ? ED.Core.getObject(id) : null;
      if (obj && obj.name) c.name = obj.name;
      else if (!c.name) c.name = id;
      /* Loại Points/Lines/Sprite trong bản clone (thu thập trước rồi xoá). */
      var drop = [];
      c.traverse(function (n) {
        if (n.isPoints || n.isLine || n.isSprite) drop.push(n);
      });
      drop.forEach(function (n) { if (n.parent) n.parent.remove(n); });
      scene.add(c);
      added++;
    });
    /* Terrain: ED.Terrain.getMesh() là mesh đất hiện tại (brush/heightmap/
       erosion đều rebuild nó); fallback: tìm mesh userData.isTerrain
       trong scene của viewport. Terrain luôn export kể cả khi meshes rỗng. */
    var terrain = null;
    try {
      if (ED.Terrain && typeof ED.Terrain.getMesh === 'function') terrain = ED.Terrain.getMesh();
    } catch (e) { terrain = null; }
    if (!terrain && ED.Viewport.scene) {
      var kids = ED.Viewport.scene.children || [];
      for (var i = 0; i < kids.length; i++) {
        if (kids[i] && kids[i].userData && kids[i].userData.isTerrain) { terrain = kids[i]; break; }
      }
    }
    if (terrain) {
      var tc = null;
      try { tc = terrain.clone(true); } catch (e) { tc = null; }
      if (tc) { tc.name = 'Terrain'; scene.add(tc); added++; }
    }
    if (!added) return null;
    return scene;
  }

  function downloadArrayBuffer(buf, filename) {
    var blob = new Blob([buf], { type: 'model/gltf-binary' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e) {}
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 1000);
  }

  /* Export GLB, trả Promise<boolean>. Chỉ tải file khi header GLB
     validate OK (magic 'glTF', version 2, length khớp). */
  function exportGLB() {
    if (_exporting) return Promise.resolve(false);
    if (typeof document === 'undefined') return Promise.reject(new Error('Export .GLB cần chạy trong trình duyệt.'));
    if (!isGLBReady()) {
      var msg = 'Chưa tải được GLTFExporter (lib/GLTFExporter.js chưa có trong bản build) — không xuất được .GLB.';
      toast(msg); log(msg);
      return Promise.resolve(false);
    }
    var scene = null;
    try { scene = buildExportScene(); } catch (e) {
      toast('Không dựng được scene để xuất: ' + (e && e.message ? e.message : ''));
      return Promise.resolve(false);
    }
    if (!scene) {
      toast('Scene trống (chưa có object nào và chưa có terrain) — không có gì để xuất.');
      return Promise.resolve(false);
    }
    _exporting = true;
    _setStatus('Đang xuất .GLB…');
    return new Promise(function (resolve) {
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        _exporting = false;
        resolve(ok);
      }
      try {
        new THREE.GLTFExporter().parse(scene, function (result) {
          try {
            var buf = (result instanceof ArrayBuffer) ? result : null;
            if (!buf) { _setStatus('Export thất bại: exporter không trả về ArrayBuffer.'); toast('Export .GLB thất bại.'); finish(false); return; }
            var v = edExportValidateGLB(new Uint8Array(buf));
            if (!v.ok) {
              _setStatus('File GLB không hợp lệ: ' + v.reason);
              toast('Export .GLB thất bại: ' + v.reason);
              log('Export .GLB: validate fail — ' + v.reason);
              finish(false);
              return;
            }
            var name = edExportFileName(projectName());
            downloadArrayBuffer(buf, name);
            _setStatus('Đã xuất ' + name + ' (' + (buf.byteLength / 1024).toFixed(0) + ' KB, GLB v2).');
            toast('Đã xuất ' + name);
            log('Đã xuất .GLB: ' + name + ' (' + buf.byteLength + ' byte).');
            finish(true);
          } catch (e) {
            _setStatus('Export thất bại: ' + (e && e.message ? e.message : ''));
            toast('Export .GLB thất bại.');
            finish(false);
          }
        }, { binary: true });
      } catch (e) {
        _exporting = false;
        _setStatus('Export thất bại: ' + (e && e.message ? e.message : ''));
        toast('Export .GLB thất bại: ' + (e && e.message ? e.message : ''));
        finish(false);
      }
    });
  }

  /* ---- Nhạc nền ambient. ---- */
  function _ensureAudioEl() {
    if (_audioEl) return _audioEl;
    if (typeof Audio === 'undefined') return null;
    _audioEl = new Audio();
    _audioEl.loop = true;
    _audioEl.volume = _volume;
    _audioEl.preload = 'auto';
    return _audioEl;
  }
  function _setAudioSource(arrayBuffer, mime) {
    if (typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
    if (_audioUrl) { try { URL.revokeObjectURL(_audioUrl); } catch (e) {} _audioUrl = null; }
    var blob = new Blob([arrayBuffer], { type: mime || 'audio/mpeg' });
    _audioUrl = URL.createObjectURL(blob);
    var el = _ensureAudioEl();
    if (!el) return false;
    el.src = _audioUrl;
    return true;
  }
  function _refreshAudioUI() {
    if (!_panel || typeof document === 'undefined') return;
    var nameEl = _panel.querySelector('#ed-ambient-name');
    if (nameEl) nameEl.textContent = _audioKey ? ('🎵 ' + (_audioName || 'nhạc nền')) : 'Chưa có nhạc nền.';
    var playBtn = _panel.querySelector('#ed-ambient-play');
    if (playBtn) playBtn.disabled = !_audioKey;
    var stopBtn = _panel.querySelector('#ed-ambient-stop');
    if (stopBtn) stopBtn.disabled = !_audioKey;
    var delBtn = _panel.querySelector('#ed-ambient-del');
    if (delBtn) delBtn.disabled = !_audioKey;
  }
  function _setStatus(msg) {
    if (!_panel || typeof document === 'undefined') return;
    var el = _panel.querySelector('#ed-export-status');
    if (el) el.textContent = msg;
  }

  /* Import file audio -> IDB key 'audio:ambient' (ghi đè bản cũ). */
  function importAmbient(file) {
    var v = edExportValidateAudioFile(file);
    if (!v.ok) { toast(v.reason); return Promise.reject(new Error(v.reason)); }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Không đọc được file từ máy.')); };
      reader.onload = function () {
        var rec = {
          key: AUDIO_KEY, name: file.name, size: file.size, ext: v.ext,
          mime: file.type || '', addedAt: Date.now(), data: reader.result
        };
        idbPut(rec).then(function () {
          _audioKey = AUDIO_KEY;
          _audioName = file.name;
          _setAudioSource(reader.result, rec.mime);
          _refreshAudioUI();
          toast('Đã lưu nhạc nền: ' + file.name);
          log('Đã import nhạc nền ambient: ' + file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB).');
          resolve({ key: AUDIO_KEY, name: rec.name, size: rec.size, ext: v.ext });
        }).catch(reject);
      };
      try { reader.readAsArrayBuffer(file); } catch (e) { reject(new Error('Không đọc được file từ máy.')); }
    });
  }
  function removeAmbient() {
    stopAmbient();
    return idbDel(AUDIO_KEY).then(function () {
      _audioKey = null;
      _audioName = '';
      if (_audioUrl) { try { URL.revokeObjectURL(_audioUrl); } catch (e) {} _audioUrl = null; }
      if (_audioEl) { try { _audioEl.removeAttribute('src'); _audioEl.load(); } catch (e) {} }
      _refreshAudioUI();
      toast('Đã xoá nhạc nền.');
    });
  }
  /* Tải nhạc đã lưu (nếu có) vào thẻ audio, chưa phát. Dùng ở init()
     và khi Play.start muốn phát mà init chưa kịp khôi phục. */
  function loadAmbient() {
    if (_audioKey && _audioUrl) return Promise.resolve(true);
    return idbGet(AUDIO_KEY).then(function (rec) {
      if (!rec || !rec.data) return false;
      _audioKey = AUDIO_KEY;
      _audioName = rec.name || '';
      _setAudioSource(rec.data, rec.mime);
      _refreshAudioUI();
      return true;
    }).catch(function () { return false; });
  }
  /* API cho Play Mode (09-play.js gọi khi tích hợp — xem báo cáo đợt 2):
     phát nhạc nền đã lưu, loop. Trả Promise<boolean>. */
  function playAmbient() {
    var el = _ensureAudioEl();
    if (!el) return Promise.resolve(false);
    function _play() {
      if (!_audioUrl) return Promise.resolve(false);
      try {
        var p = el.play();
        if (p && typeof p.then === 'function') {
          return p.then(function () { return true; }).catch(function () { return false; });
        }
        return Promise.resolve(true);
      } catch (e) { return Promise.resolve(false); }
    }
    if (_audioUrl) return _play();
    return loadAmbient().then(function (ok) { return ok ? _play() : false; });
  }
  function stopAmbient() {
    if (!_audioEl) return false;
    try { _audioEl.pause(); _audioEl.currentTime = 0; } catch (e) {}
    return true;
  }
  function setAmbientVolume(v) {
    _volume = clamp(Number(v) || 0, 0, 1);
    if (_audioEl) { try { _audioEl.volume = _volume; } catch (e) {} }
    return _volume;
  }
  function getAmbientVolume() { return _volume; }
  function getAmbientKey() { return _audioKey; }
  function getAmbientName() { return _audioName; }
  function isAmbientPlaying() {
    try { return !!(_audioEl && !_audioEl.paused && !_audioEl.ended); } catch (e) { return false; }
  }

  /* ---- UI: panel riêng của module. Gắn vào #panel-right (cột Inspector,
     cuộn được, không phá layout) nếu có; chưa có thì fallback append body
     (cùng pattern 04-terrain.js / 05-environment.js). ---- */
  function init() {
    /* Khôi phục nhạc đã lưu (không tự phát — trình duyệt chặn autoplay). */
    loadAmbient().catch(function () {});
    if (typeof document === 'undefined') return;
    var panel = document.getElementById('export-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'export-panel';
      panel.className = 'ed-export-panel';
      var right = document.getElementById('panel-right');
      if (right) right.appendChild(panel);
      else document.body.appendChild(panel);
    }
    _panel = panel;
    var glbReady = isGLBReady();
    var h = '<div class="ed-panel-title">📦 Xuất / Âm thanh</div>' +
      (glbReady
        ? '<div class="ed-row"><button id="ed-export-glb">⬇️ Xuất .GLB</button></div>' +
          '<div class="ed-hint">Xuất toàn bộ map (terrain + object) ra file .GLB (tên = tên project). Chỉ mesh + transform + material cơ bản; không gồm gizmo, lưới, FX hạt, animation.</div>'
        : '<div class="ed-hint">⚠️ Chưa tải được GLTFExporter (lib/GLTFExporter.js chưa có trong bản build) — nút Xuất .GLB sẽ hiện sau khi build lại.</div>') +
      '<div class="ed-row"><span id="ed-export-status" class="ed-hint">Chưa xuất.</span></div>' +
      '<div class="ed-panel-title">🎵 Nhạc nền</div>' +
      '<div class="ed-row"><span id="ed-ambient-name" class="ed-hint">Chưa có nhạc nền.</span></div>' +
      '<div class="ed-row"><button id="ed-ambient-import">🎵 Chọn nhạc nền (mp3/wav/ogg ≤ 10 MB)</button></div>' +
      '<div class="ed-row"><button id="ed-ambient-play">▶️ Phát</button>' +
      '<button id="ed-ambient-stop">⏹️ Dừng</button>' +
      '<button id="ed-ambient-del">🗑️ Xoá nhạc</button></div>' +
      '<div class="ed-row"><label>Âm lượng <span id="ed-ambient-vol-v">0.50</span></label>' +
      '<input id="ed-ambient-vol" type="range" min="0" max="1" step="0.05" value="0.5"></div>' +
      '<div class="ed-hint">Nhạc lưu trên máy (IndexedDB), mở lại editor vẫn còn. Phát loop trong lúc chỉnh map; khi vào Play Mode nhạc tự phát nếu đã bật wiring (xem báo cáo đợt 2).</div>';
    panel.innerHTML = h;
    if (glbReady) {
      var glbBtn = panel.querySelector('#ed-export-glb');
      if (glbBtn) glbBtn.addEventListener('click', function () { exportGLB(); });
    }
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg';
    picker.style.display = 'none';
    panel.appendChild(picker);
    panel.querySelector('#ed-ambient-import').addEventListener('click', function () { picker.click(); });
    picker.addEventListener('change', function () {
      var f = picker.files && picker.files[0];
      picker.value = '';
      if (!f) return;
      importAmbient(f).catch(function (e) {
        toast(e && e.message ? e.message : 'Import nhạc thất bại.');
      });
    });
    panel.querySelector('#ed-ambient-play').addEventListener('click', function () {
      playAmbient().then(function (ok) {
        if (!ok) toast('Chưa phát được nhạc — thử chọn lại file nhạc.');
        else toast('Đang phát nhạc nền (loop).');
      });
    });
    panel.querySelector('#ed-ambient-stop').addEventListener('click', function () {
      stopAmbient();
      toast('Đã dừng nhạc nền.');
    });
    panel.querySelector('#ed-ambient-del').addEventListener('click', function () {
      removeAmbient().catch(function (e) {
        toast(e && e.message ? e.message : 'Xoá nhạc thất bại.');
      });
    });
    var vol = panel.querySelector('#ed-ambient-vol');
    var volLab = panel.querySelector('#ed-ambient-vol-v');
    vol.addEventListener('input', function () {
      var v = setAmbientVolume(Number(vol.value));
      volLab.textContent = v.toFixed(2);
    });
    _refreshAudioUI();
  }

  return {
    AUDIO_KEY: AUDIO_KEY, MAX_AUDIO_BYTES: MAX_AUDIO_BYTES,
    edExportValidateGLB: edExportValidateGLB,
    edExportFileName: edExportFileName,
    edExportValidateAudioFile: edExportValidateAudioFile,
    edExportAudioKey: edExportAudioKey,
    edExportParseAudioKey: edExportParseAudioKey,
    isGLBReady: isGLBReady, buildExportScene: buildExportScene,
    exportGLB: exportGLB,
    importAmbient: importAmbient, removeAmbient: removeAmbient,
    loadAmbient: loadAmbient, playAmbient: playAmbient,
    stopAmbient: stopAmbient, setAmbientVolume: setAmbientVolume,
    getAmbientVolume: getAmbientVolume, getAmbientKey: getAmbientKey,
    getAmbientName: getAmbientName, isAmbientPlaying: isAmbientPlaying,
    init: init
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
