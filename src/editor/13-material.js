/* ============================================================================
   Map Editor — 13-material.js (đợt 2, mục 2)
   ED.Material — Vật liệu & Texture cho object đang chọn:
   import ảnh thật (albedo/normal/roughness) lưu IndexedDB, tiling/offset,
   emissive, 6 preset 1 chạm, xem trước UV.
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo trong init(). Logic thuần (preset, validate, normalize,
   clamp, applyPresetToObject, setTextureSlot) không phụ thuộc DOM/THREE
   để test bằng vm. Texture lưu cùng DB/store với 03-assets.js:
   IndexedDB 'mongvolam_editor_v1', store 'assets' (keyPath 'key'),
   record {key, name, size, ext, kind:'texture', type, addedAt, data}.
   Key texture: 'tex:<id>'. Gán vào obj.material:
   {map, normalMap, roughnessMap, repeat:[rx,ry], offset:[ox,oy],
    emissive, emissiveIntensity} (giữ nguyên roughness/metalness/opacity).
   LƯU Ý: ED.Viewport.syncObject() rebuild mesh qua buildMesh (chỉ dùng
   color/material cơ bản) nên texture gán trực tiếp lên mesh có thể mất
   khi sync lại — cần hook ED.Material.applyToMesh(obj, group) trong
   syncObject (xem báo cáo bàn giao). Tới lúc đó, init() + onChange +
   restoreAllTextures() dưới đây là cầu nối tạm: texture được nạp lại
   từ IDB và áp lại lên mesh sau khi viewport sync xong.
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Material = (function () {
  'use strict';

  var DB_NAME = 'mongvolam_editor_v1';
  var STORE = 'assets';
  var MAX_BYTES = 5 * 1024 * 1024; // 5 MB / ảnh
  var SLOTS = ['map', 'normalMap', 'roughnessMap'];
  var SLOT_LABELS = { map: 'Albedo (màu)', normalMap: 'Normal', roughnessMap: 'Nhám' };

  var _cache = {}; // key -> {texture, canvas, image, width, height, promise, _queued}
  var _meta = {}; // key -> {name, size}
  var _uvCanvases = []; // canvas preview đã đăng ký (vẽ lại khi texture nạp xong)
  var _idSeq = 0;

  /* ---- Hàm thuần: preset / validate / normalize / clamp ---- */

  var PRESETS = {
    'go':   { color: '#8a6a42', roughness: 0.85, metalness: 0,    emissive: '#000000', emissiveIntensity: 0,    opacity: 1 },
    'da':   { color: '#8b9793', roughness: 0.95, metalness: 0.05, emissive: '#000000', emissiveIntensity: 0,    opacity: 1 },
    'vang': { color: '#d8a53c', roughness: 0.30, metalness: 0.85, emissive: '#1a0d00', emissiveIntensity: 0.2,  opacity: 1 },
    'ngoc': { color: '#3aa88f', roughness: 0.25, metalness: 0.10, emissive: '#0d5c46', emissiveIntensity: 0.35, opacity: 1 },
    'vai':  { color: '#a63a3a', roughness: 1.00, metalness: 0,    emissive: '#000000', emissiveIntensity: 0,    opacity: 1 },
    'ngoi': { color: '#7f1d1d', roughness: 0.70, metalness: 0.05, emissive: '#000000', emissiveIntensity: 0,    opacity: 1 }
  };
  var PRESET_LABELS = {
    'go': 'Gỗ', 'da': 'Đá', 'vang': 'Vàng',
    'ngoc': 'Ngọc', 'vai': 'Vải', 'ngoi': 'Mái ngói'
  };

  // Trả về BẢN SAO preset (đổi object trả về không làm bẩn bảng gốc).
  function edMatPreset(name) {
    var p = PRESETS[name];
    if (!p) return null;
    return {
      color: p.color, roughness: p.roughness, metalness: p.metalness,
      emissive: p.emissive, emissiveIntensity: p.emissiveIntensity, opacity: p.opacity
    };
  }
  function listPresets() {
    return Object.keys(PRESETS).map(function (k) {
      return { name: k, label: PRESET_LABELS[k] };
    });
  }

  function _num(v, fallback) {
    var n = Number(v);
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
  }
  function _clamp(v, min, max, fallback) {
    var n = _num(v, fallback);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }
  function clampRepeat(v) { return _clamp(v, 0.1, 10, 1); }
  function clampOffset(v) { return _clamp(v, 0, 1, 0); }

  var IMAGE_EXTS = { png: 1, jpg: 1, jpeg: 1, webp: 1, gif: 1, bmp: 1 };
  // Thuần: chỉ kiểm tra tên/loại/kích thước, không đọc file.
  function validateTextureFile(file) {
    if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name) {
      return { ok: false, reason: 'Chưa chọn file ảnh nào.' };
    }
    var type = file.type || '';
    var ext = file.name.split('.').pop().toLowerCase();
    if (type.indexOf('image/') !== 0 && !IMAGE_EXTS[ext]) {
      return { ok: false, reason: 'File "' + file.name + '" không phải ảnh (chỉ nhận PNG, JPG, WebP, GIF, BMP).' };
    }
    var size = Number(file.size);
    if (!size || size < 1) return { ok: false, reason: 'File ảnh rỗng, không đọc được.' };
    if (size > MAX_BYTES) {
      return { ok: false, reason: 'Ảnh quá lớn (' + (size / 1048576).toFixed(1) + ' MB, tối đa 5 MB).' };
    }
    var outExt = IMAGE_EXTS[ext] ? ext : (type.split('/')[1] || 'png');
    return { ok: true, ext: outExt };
  }

  function textureKey(id) { return 'tex:' + String(id || ''); }
  function _newTextureId() {
    _idSeq += 1;
    return Date.now().toString(36) + '-' + _idSeq.toString(36);
  }

  // Chuẩn hoá obj.material: điền mặc định, kẹp giá trị, giữ nguyên các
  // khe texture đã gán. Luôn trả về object MỚI (không sửa object cũ).
  function normalizeMaterial(m) {
    m = m || {};
    var out = {
      roughness: 0.8, metalness: 0, opacity: 1,
      emissive: '#000000', emissiveIntensity: 0,
      repeat: [1, 1], offset: [0, 0]
    };
    if (typeof m.roughness === 'number') out.roughness = _clamp(m.roughness, 0, 1, 0.8);
    if (typeof m.metalness === 'number') out.metalness = _clamp(m.metalness, 0, 1, 0);
    if (typeof m.opacity === 'number') out.opacity = _clamp(m.opacity, 0, 1, 1);
    if (typeof m.emissive === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.emissive)) out.emissive = m.emissive;
    if (typeof m.emissiveIntensity === 'number') out.emissiveIntensity = _clamp(m.emissiveIntensity, 0, 3, 0);
    if (typeof m.map === 'string' && m.map) out.map = m.map;
    if (typeof m.normalMap === 'string' && m.normalMap) out.normalMap = m.normalMap;
    if (typeof m.roughnessMap === 'string' && m.roughnessMap) out.roughnessMap = m.roughnessMap;
    if (Array.isArray(m.repeat)) {
      out.repeat = [clampRepeat(m.repeat[0]), clampRepeat(m.repeat[1])];
    }
    if (Array.isArray(m.offset)) {
      out.offset = [clampOffset(m.offset[0]), clampOffset(m.offset[1])];
    }
    return out;
  }

  // Thuần: gán/gỡ 1 khe texture trên obj (không chạm DOM/THREE/Core).
  function setTextureSlot(obj, slot, key) {
    if (!obj || typeof obj !== 'object') return false;
    if (SLOTS.indexOf(slot) < 0) return false;
    obj.material = normalizeMaterial(obj.material);
    if (key) obj.material[slot] = key;
    else delete obj.material[slot];
    return true;
  }

  // Thuần: áp preset lên obj (đổi color + roughness/metalness/emissive/
  // opacity; GIỮ NGUYÊN texture + repeat/offset đã gán).
  function applyPresetToObject(obj, name) {
    if (!obj || typeof obj !== 'object') return false;
    var p = edMatPreset(name);
    if (!p) return false;
    obj.color = p.color;
    var m = normalizeMaterial(obj.material);
    m.roughness = p.roughness;
    m.metalness = p.metalness;
    m.emissive = p.emissive;
    m.emissiveIntensity = p.emissiveIntensity;
    m.opacity = p.opacity;
    obj.material = m;
    return true;
  }

  // Thuần: đổi tiling/offset trên obj (kẹp giá trị).
  function setTiling(obj, rx, ry, ox, oy) {
    if (!obj || typeof obj !== 'object') return false;
    obj.material = normalizeMaterial(obj.material);
    if (typeof rx === 'number') obj.material.repeat[0] = clampRepeat(rx);
    if (typeof ry === 'number') obj.material.repeat[1] = clampRepeat(ry);
    if (typeof ox === 'number') obj.material.offset[0] = clampOffset(ox);
    if (typeof oy === 'number') obj.material.offset[1] = clampOffset(oy);
    return true;
  }

  /* ---- IndexedDB: cùng DB/store với 03-assets.js ---- */

  function openDb() {
    return new Promise(function (resolve, reject) {
      var idb = null;
      try { idb = (typeof window !== 'undefined' && window.indexedDB) ? window.indexedDB : null; } catch (e) { idb = null; }
      if (!idb) { reject(new Error('Trình duyệt này không dùng được IndexedDB.')); return; }
      var req;
      try { req = idb.open(DB_NAME, 1); } catch (e) { reject(new Error('Không mở được IndexedDB: ' + (e && e.message ? e.message : ''))); return; }
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
        var tx;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không lưu được ảnh.')); return; }
        var done = false;
        tx.oncomplete = function () { try { db.close(); } catch (e) {} if (!done) { done = true; resolve(rec); } };
        tx.onerror = function () { try { db.close(); } catch (e) {} if (!done) { done = true; reject(new Error('Không lưu được ảnh vào máy.')); } };
        try { tx.objectStore(STORE).put(rec); } catch (e) { try { db.close(); } catch (e2) {} if (!done) { done = true; reject(new Error('Không lưu được ảnh.')); } }
      });
    });
  }
  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readonly'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được ảnh đã lưu.')); return; }
        var req;
        try { req = tx.objectStore(STORE).get(key); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được ảnh đã lưu.')); return; }
        req.onsuccess = function () { try { db.close(); } catch (e) {} resolve(req.result || null); };
        req.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không đọc được ảnh đã lưu.')); };
      });
    });
  }
  function idbDel(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xoá được ảnh.')); return; }
        tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(); };
        tx.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không xoá được ảnh.')); };
        try { tx.objectStore(STORE).delete(key); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xoá được ảnh.')); }
      });
    });
  }

  // Lưu bytes ảnh vào store 'assets', key 'tex:<id>'. Trả {key, name, size, ext}.
  function saveTexture(file) {
    var v = validateTextureFile(file);
    if (!v.ok) return Promise.reject(new Error(v.reason));
    return new Promise(function (resolve, reject) {
      if (typeof FileReader === 'undefined') { reject(new Error('Trình duyệt này không đọc được file ảnh.')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Không đọc được file ảnh từ máy.')); };
      reader.onload = function () {
        var key = textureKey(_newTextureId());
        var rec = {
          key: key, name: file.name, size: file.size, ext: v.ext,
          kind: 'texture', type: file.type || '', addedAt: Date.now(), data: reader.result
        };
        idbPut(rec).then(function () {
          _meta[key] = { name: rec.name, size: rec.size };
          resolve({ key: key, name: rec.name, size: rec.size, ext: v.ext });
        }).catch(reject);
      };
      try { reader.readAsArrayBuffer(file); } catch (e) { reject(new Error('Không đọc được file ảnh từ máy.')); }
    });
  }

  // Tên file hiển thị cho 1 key (đồng bộ; null nếu chưa nạp record).
  function textureName(key) {
    return (_meta[key] && _meta[key].name) || null;
  }

  /* ---- Nạp ảnh -> THREE.Texture (cache theo key) ---- */

  function decodeImage(ab) {
    return new Promise(function (resolve, reject) {
      if (typeof document === 'undefined' || typeof Image === 'undefined') {
        reject(new Error('Trình duyệt này không đọc được ảnh.')); return;
      }
      var url = null;
      try {
        var blob = new Blob([ab]);
        url = URL.createObjectURL(blob);
      } catch (e) { reject(new Error('Không đọc được dữ liệu ảnh.')); return; }
      var img = new Image();
      img.onload = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        var cw = img.naturalWidth || img.width || 0;
        var ch = img.naturalHeight || img.height || 0;
        if (!cw || !ch) { reject(new Error('Ảnh không có kích thước, thử file ảnh khác.')); return; }
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        var ctx = c.getContext('2d');
        if (!ctx) { reject(new Error('Không vẽ được ảnh lên canvas.')); return; }
        try { ctx.drawImage(img, 0, 0); } catch (e) { reject(new Error('Không vẽ được ảnh này.')); return; }
        resolve({ image: img, canvas: c, width: cw, height: ch });
      };
      img.onerror = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        reject(new Error('Không đọc được ảnh này (file ảnh có thể đã hỏng).'));
      };
      img.src = url;
    });
  }

  function loadTexture(key) {
    if (!key || typeof key !== 'string') return Promise.reject(new Error('Thiếu key texture.'));
    var entry = _cache[key] = _cache[key] || {};
    if (entry.texture) return Promise.resolve(entry.texture);
    if (entry.promise) return entry.promise;
    entry.promise = idbGet(key).then(function (rec) {
      if (!rec || !rec.data) throw new Error('Không tìm thấy texture đã lưu, thử import lại.');
      _meta[key] = { name: rec.name, size: rec.size };
      return decodeImage(rec.data);
    }).then(function (dec) {
      if (typeof THREE === 'undefined' || !THREE.CanvasTexture) {
        throw new Error('Chưa tải được three.js.');
      }
      var tex = new THREE.CanvasTexture(dec.canvas);
      if (THREE.RepeatWrapping !== undefined) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
      }
      tex.needsUpdate = true;
      entry.texture = tex;
      entry.canvas = dec.canvas;
      entry.image = dec.image;
      entry.width = dec.width;
      entry.height = dec.height;
      delete entry.promise;
      return tex;
    }).catch(function (err) {
      delete entry.promise;
      throw err;
    });
    return entry.promise;
  }

  /* ---- Áp vật liệu lên mesh đang hiển thị ---- */

  function _applyTex(mat, slot, tex, m) {
    if (slot === 'map') {
      mat.map = tex;
      if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
    } else if (slot === 'normalMap') {
      if (!('normalMap' in mat)) return false;
      mat.normalMap = tex;
      if (THREE.LinearEncoding !== undefined) tex.encoding = THREE.LinearEncoding;
    } else if (slot === 'roughnessMap') {
      if (!('roughnessMap' in mat)) return false;
      mat.roughnessMap = tex;
      if (THREE.LinearEncoding !== undefined) tex.encoding = THREE.LinearEncoding;
    } else {
      return false;
    }
    if (THREE.RepeatWrapping !== undefined) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
    if (m.repeat) tex.repeat.set(m.repeat[0], m.repeat[1]);
    if (m.offset) tex.offset.set(m.offset[0], m.offset[1]);
    tex.needsUpdate = true;
    return true;
  }

  function _ensureTextureLoaded(key, obj) {
    var entry = _cache[key];
    if (entry && entry.texture) return;
    if (entry && entry._queued) return;
    if (entry) entry._queued = true;
    loadTexture(key).then(function () {
      if (entry) delete entry._queued;
      applyLive(obj);
      _redrawUvPreviews();
    }).catch(function (err) {
      if (entry) delete entry._queued;
      if (ED.UI && typeof ED.UI.log === 'function') {
        ED.UI.log('Texture lỗi: ' + (err && err.message ? err.message : err));
      }
    });
  }

  function _applyToMaterial(mat, m, obj) {
    var changed = false;
    for (var i = 0; i < SLOTS.length; i++) {
      var slot = SLOTS[i];
      var key = m[slot];
      if (key) {
        var entry = _cache[key];
        if (entry && entry.texture) {
          if (_applyTex(mat, slot, entry.texture, m)) changed = true;
        } else {
          // Chưa có texture trong cache: gỡ map cũ rồi nạp ngầm từ IDB.
          if (slot === 'map' && mat.map) { mat.map = null; changed = true; }
          else if (slot === 'normalMap' && ('normalMap' in mat) && mat.normalMap) { mat.normalMap = null; changed = true; }
          else if (slot === 'roughnessMap' && ('roughnessMap' in mat) && mat.roughnessMap) { mat.roughnessMap = null; changed = true; }
          _ensureTextureLoaded(key, obj);
        }
      } else {
        if (slot === 'map' && mat.map) { mat.map = null; changed = true; }
        else if (slot === 'normalMap' && ('normalMap' in mat) && mat.normalMap) { mat.normalMap = null; changed = true; }
        else if (slot === 'roughnessMap' && ('roughnessMap' in mat) && mat.roughnessMap) { mat.roughnessMap = null; changed = true; }
      }
    }
    if (mat.emissive && mat.emissive.set && typeof m.emissive === 'string') {
      try { mat.emissive.set(m.emissive); } catch (e) {}
    }
    if (('emissiveIntensity' in mat) && typeof m.emissiveIntensity === 'number') {
      mat.emissiveIntensity = m.emissiveIntensity;
    }
    if (changed) mat.needsUpdate = true;
  }

  // Áp obj.material (texture + tiling + emissive) lên toàn bộ Mesh trong
  // group. Trả về số Mesh đã chạm (0 nếu chưa có THREE/group).
  // Đây là hàm hook syncObject cần gọi sau buildMesh.
  function applyToMesh(obj, group) {
    if (!obj || !group) return 0;
    if (typeof THREE === 'undefined') return 0;
    var m = normalizeMaterial(obj.material);
    obj.material = m;
    var count = 0;
    group.traverse(function (c) {
      if (!c.isMesh) return;
      var mats = Array.isArray(c.material) ? c.material : [c.material];
      for (var i = 0; i < mats.length; i++) {
        if (!mats[i]) continue;
        count++;
        _applyToMaterial(mats[i], m, obj);
      }
    });
    return count;
  }

  // Áp lên mesh của obj trong viewport (nếu đã có). Không làm gì nếu chưa sync.
  function applyLive(obj) {
    if (!obj) return 0;
    var g = null;
    try { g = (ED.Viewport && ED.Viewport.meshes) ? ED.Viewport.meshes[obj.id] : null; } catch (e) { g = null; }
    if (!g) return 0;
    return applyToMesh(obj, g);
  }

  /* ---- API cho UI: gán/gỡ texture, preset, emissive (có lưu project) ---- */

  function _isKeyUsed(key, exceptId) {
    if (!ED.Core || typeof ED.Core.listObjects !== 'function') return false;
    var objs = ED.Core.listObjects();
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (exceptId && o.id === exceptId) continue;
      var mm = o.material || {};
      if (mm.map === key || mm.normalMap === key || mm.roughnessMap === key) return true;
    }
    return false;
  }

  function _removeTextureRecord(key) {
    delete _cache[key];
    delete _meta[key];
    try {
      var p = idbDel(key);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {}
  }

  // Import ảnh -> lưu IDB -> gán vào khe slot của obj -> áp lên mesh -> lưu.
  // Decode trước khi đổi obj.material để ảnh hỏng không làm bẩn project.
  function assignTexture(obj, slot, file) {
    if (!obj || typeof obj !== 'object') return Promise.reject(new Error('Chưa chọn object.'));
    if (SLOTS.indexOf(slot) < 0) return Promise.reject(new Error('Khe texture không hợp lệ.'));
    var v = validateTextureFile(file);
    if (!v.ok) return Promise.reject(new Error(v.reason));
    var oldKey = obj.material ? obj.material[slot] : null;
    return saveTexture(file).then(function (saved) {
      return loadTexture(saved.key).then(function () { return saved; }, function (err) {
        _removeTextureRecord(saved.key);
        throw err;
      });
    }).then(function (saved) {
      if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('gan texture');
      setTextureSlot(obj, slot, saved.key);
      if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
      applyLive(obj);
      _redrawUvPreviews();
      if (oldKey && oldKey !== saved.key && !_isKeyUsed(oldKey, obj.id)) {
        _removeTextureRecord(oldKey);
      }
      return saved;
    });
  }

  function clearTexture(obj, slot) {
    if (!obj || !obj.material || !obj.material[slot]) return false;
    if (SLOTS.indexOf(slot) < 0) return false;
    var oldKey = obj.material[slot];
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('go texture');
    delete obj.material[slot];
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    applyLive(obj);
    _redrawUvPreviews();
    if (oldKey && !_isKeyUsed(oldKey, obj.id)) _removeTextureRecord(oldKey);
    return true;
  }

  // 1 chạm: preset -> obj.material + obj.color + mesh + lưu project.
  function applyPreset(obj, name) {
    if (!obj) return false;
    if (!edMatPreset(name)) return false;
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('preset vat lieu');
    applyPresetToObject(obj, name);
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    applyLive(obj);
    return true;
  }

  function setEmissive(obj, color, intensity) {
    if (!obj) return false;
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('vat lieu emissive');
    obj.material = normalizeMaterial(obj.material);
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) obj.material.emissive = color;
    if (typeof intensity === 'number' && isFinite(intensity)) {
      obj.material.emissiveIntensity = _clamp(intensity, 0, 3, 0);
    }
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    applyLive(obj);
    return true;
  }

  /* ---- Nạp lại texture khi mở lại project ---- */

  function restoreObjectTextures(obj) {
    if (!obj || !obj.material) return Promise.resolve(false);
    var keys = [];
    SLOTS.forEach(function (s) {
      if (typeof obj.material[s] === 'string' && obj.material[s]) keys.push(obj.material[s]);
    });
    if (!keys.length) return Promise.resolve(false);
    var loads = keys.map(function (k) {
      return loadTexture(k).then(function () { return true; }, function () { return false; });
    });
    return Promise.all(loads).then(function () {
      applyLive(obj);
      _redrawUvPreviews();
      return true;
    });
  }

  function restoreAllTextures() {
    if (!ED.Core || typeof ED.Core.listObjects !== 'function') return Promise.resolve(0);
    var objs = ED.Core.listObjects();
    return Promise.all(objs.map(function (o) { return restoreObjectTextures(o); })).then(function () {
      _redrawUvPreviews();
      return objs.length;
    });
  }

  /* ---- Xem trước UV ---- */

  function drawUvPreview(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { return false; }
    if (!ctx) return false;
    var w = canvas.width || 220;
    var h = canvas.height || 220;
    var obj = null;
    try { obj = (ED.Core && typeof ED.Core.selectedObject === 'function') ? ED.Core.selectedObject() : null; } catch (e) { obj = null; }
    var img = null;
    var key = obj && obj.material ? obj.material.map : null;
    if (key && _cache[key] && _cache[key].canvas) img = _cache[key].canvas;
    ctx.save();
    ctx.fillStyle = '#202329';
    ctx.fillRect(0, 0, w, h);
    if (img) {
      try { ctx.drawImage(img, 0, 0, w, h); } catch (e) { img = null; }
    }
    // Lưới UV 4x4.
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    var i;
    for (i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(w * i / 4, 0); ctx.lineTo(w * i / 4, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke();
    }
    ctx.strokeStyle = '#ffd76b';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    if (!img) {
      ctx.fillStyle = '#9aa0a6';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Chưa có texture', w / 2, h / 2);
    } else if (obj && obj.material && obj.material.repeat) {
      var r = obj.material.repeat;
      if (r[0] !== 1 || r[1] !== 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(4, h - 22, 116, 18);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('Lặp ' + r[0] + ' × ' + r[1], 8, h - 13);
      }
    }
    ctx.restore();
    var found = false;
    for (var k = 0; k < _uvCanvases.length; k++) {
      if (_uvCanvases[k] === canvas) { found = true; break; }
    }
    if (!found) {
      _uvCanvases.push(canvas);
      if (_uvCanvases.length > 8) _uvCanvases.shift();
    }
    return true;
  }

  function _redrawUvPreviews() {
    _uvCanvases = _uvCanvases.filter(function (c) {
      try { return c.isConnected !== false; } catch (e) { return true; }
    });
    _uvCanvases.forEach(function (c) { drawUvPreview(c); });
  }

  /* ---- init ---- */

  function init() {
    // Nạp texture từ IDB (bất đồng bộ nên mesh sync sau trong boot vẫn kịp
    // nhận qua .then -> applyLive; cộng thêm 1 lần hẹn sau tick boot).
    restoreAllTextures();
    if (typeof setTimeout !== 'undefined') {
      setTimeout(function () { restoreAllTextures(); }, 0);
    }
    // Chọn object khác / đổi tên / undo... -> áp lại texture đã cache lên mesh.
    if (ED.Core && typeof ED.Core.onChange === 'function') {
      ED.Core.onChange(function (proj, selId) {
        if (!selId) return;
        var o = null, g = null;
        try {
          o = ED.Core.getObject(selId);
          g = (ED.Viewport && ED.Viewport.meshes) ? ED.Viewport.meshes[selId] : null;
        } catch (e) { /* bỏ qua */ }
        if (o && g) applyToMesh(o, g);
      });
    }
    return true;
  }

  return {
    init: init,
    DB_NAME: DB_NAME, STORE: STORE, MAX_BYTES: MAX_BYTES,
    SLOTS: SLOTS, SLOT_LABELS: SLOT_LABELS,
    edMatPreset: edMatPreset, listPresets: listPresets,
    validateTextureFile: validateTextureFile, normalizeMaterial: normalizeMaterial,
    clampRepeat: clampRepeat, clampOffset: clampOffset,
    setTextureSlot: setTextureSlot, applyPresetToObject: applyPresetToObject,
    setTiling: setTiling, textureKey: textureKey,
    saveTexture: saveTexture, loadTexture: loadTexture, textureName: textureName,
    assignTexture: assignTexture, clearTexture: clearTexture,
    applyPreset: applyPreset, setEmissive: setEmissive,
    applyToMesh: applyToMesh, applyLive: applyLive,
    restoreObjectTextures: restoreObjectTextures, restoreAllTextures: restoreAllTextures,
    drawUvPreview: drawUvPreview
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
