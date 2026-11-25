/* ============================== 07-character.js ==============================
   ED.Character — Character Editor cho Map Editor (nhóm C).
   - Import .fbx (Mixamo) qua file picker: validate đuôi .fbx, 1..20MB, rỗng
     báo lỗi tiếng Việt; parse bằng THREE.FBXLoader (đã inline cùng fflate);
     chuẩn hoá về cao 1.8, đáy y=0, căn giữa x/z — ĐÚNG pattern
     src/11-fbx.js (FBXSupport.parseArrayBuffer).
   - Lưu bytes gốc vào IndexedDB 'mongvolam_editor_v1', store 'assets'
     (keyPath 'key'), key 'char-<id>'; ghi fbxKey vào project.characters[].
     (DB RIÊNG với game 'mongvolam_fbx_v1' — không đụng save của game.)
   - Preview: renderer thứ 2 trong panel (360x260), nút Front/Back/Left/
     Right + kéo xoay 360° (chuột/chạm), lưới nền.
   - Skeleton: duyệt traverse tìm obj.isBone, cây xương nhóm theo bộ phận
     (mixamorig: Hips/Spine/...), click xương -> highlight + tên/vị trí.
     File mesh-only (không xương) báo rõ "File này không có xương".
   - Animation: liệt kê clip (tên + thời lượng), Play/Pause/Stop, Loop,
     slider tốc độ 0.25-2x, phát bằng THREE.AnimationMixer; không có clip
     thì báo rõ.
   - Thay model, đổi màu vật liệu (material.color + lưu characters[].color).
   - Thêm nhân vật vào scene chính: object type 'character', extra {charId}
     liên kết project.characters[]; có FBX thì viewport dùng model đó,
     không thì chibi placeholder của nhóm B (ED.Assets.buildMesh).
   - API mở cho ED.Animation (11-animation.js): getPreview(),
     getSelectedBone(), getBoneTransform(name), playCustomClip(clip, opts),
     playClip(name, {fadeSec}); preview tick gọi pv.onTick(dt) sau mỗi
     mixer.update (để root motion) — xem cuối file.
   GIỚI HẠN: chưa render thử trên trình duyệt/điện thoại thật; animation
   Mixamo retarget KHÔNG làm — chỉ phát clip gốc của file.
   QUY TẮC DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo DOM/THREE trong init(). Logic thuần expose để nhóm D test
   bằng vm + stub THREE. Không sửa file nhóm khác. */

var ED = (typeof ED !== 'undefined' && ED) ? ED : {};

/* ---------------- Logic thuần (không DOM/THREE) ---------------- */

function edCharDefaultProject() {
  return {
    version: 1, name: 'Project mới',
    terrain: { size: 96, segments: 64, heights: [], paints: [] },
    env: { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co' },
    objects: [], npcs: [], quests: [], characters: []
  };
}

function edCharValidateFbxFile(file) {
  if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name) {
    return { ok: false, reason: 'Chưa chọn file nào.' };
  }
  if (!/\.fbx$/i.test(file.name)) {
    return { ok: false, reason: 'File "' + file.name + '" không phải định dạng .fbx.' };
  }
  var size = Number(file.size);
  if (!size || size < 1) {
    return { ok: false, reason: 'File .fbx rỗng, không đọc được.' };
  }
  if (size > 20 * 1024 * 1024) {
    return { ok: false, reason: 'File .fbx quá lớn (' + (size / 1048576).toFixed(1) + ' MB, tối đa 20 MB).' };
  }
  return { ok: true };
}

/* Chuẩn hoá về cao 1.8 (theo bounding box): scale + offset để đáy y=0,
   căn giữa x/z. Thuần — runtime dùng THREE.Box3 để lấy box rồi gọi hàm này. */
function edCharNormalizeTransform(box) {
  var sizeY = box.maxY - box.minY;
  if (!isFinite(sizeY) || sizeY <= 0) return null;
  var s = 1.8 / sizeY;
  var cx = (box.minX + box.maxX) / 2;
  var cz = (box.minZ + box.maxZ) / 2;
  return { scale: s, offsetX: -cx * s, offsetY: -box.minY * s, offsetZ: -cz * s };
}

/* Duyệt cây object (thật hoặc giả) tìm xương: obj.isBone === true.
   Trả [{name, pos:[x,y,z], depth, path}] — path dạng 'Hips/Spine/Chest'. */
function edCharCollectBones(root) {
  var out = [];
  if (!root || typeof root.traverse !== 'function') return out;
  root.traverse(function (obj) {
    if (!obj || !obj.isBone) return;
    var p = (obj.position && typeof obj.position.x === 'number')
      ? [obj.position.x, obj.position.y, obj.position.z] : [0, 0, 0];
    var depth = 0;
    var path = obj.name || 'Bone';
    var cur = obj.parent;
    var parts = [obj.name || 'Bone'];
    while (cur && cur !== root && depth < 64) {
      depth++;
      if (cur.isBone) parts.unshift(cur.name || 'Bone');
      cur = cur.parent;
    }
    path = parts.join('/');
    out.push({ name: obj.name || 'Bone', pos: p, depth: depth, path: path });
  });
  return out;
}

/* Liệt kê clip animation: [{name, duration}] — thuần. */
function edCharCollectClips(animations) {
  var list = Array.isArray(animations) ? animations : [];
  return list.map(function (a, i) {
    return {
      name: (a && typeof a.name === 'string' && a.name) ? a.name : ('Clip ' + (i + 1)),
      duration: (a && isFinite(Number(a.duration))) ? Number(a.duration) : 0
    };
  });
}

/* Nhóm xương theo bộ phận (tên mixamorig:). Trả {part: [bone,...]}. */
function edCharGroupBonesByPart(bones) {
  var groups = {};
  var order = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'Shoulder', 'Arm', 'Hand', 'UpperLeg', 'Leg', 'Foot', 'Finger', 'Khác'];
  order.forEach(function (k) { groups[k] = []; });
  (bones || []).forEach(function (b) {
    var n = String(b.name || '').replace(/^mixamorig:/i, '');
    var part = 'Khác';
    if (/^hips$/i.test(n)) part = 'Hips';
    else if (/spine/i.test(n)) part = 'Spine';
    else if (/chest/i.test(n)) part = 'Chest';
    else if (/neck/i.test(n)) part = 'Neck';
    else if (/head/i.test(n)) part = 'Head';
    else if (/shoulder/i.test(n)) part = 'Shoulder';
    else if (/finger|thumb/i.test(n)) part = 'Finger';
    else if (/hand/i.test(n)) part = 'Hand';
    else if (/upleg|upperleg|thigh/i.test(n)) part = 'UpperLeg'; /* LeftUpLeg */
    else if (/leg|calf|shin/i.test(n)) part = 'Leg';
    else if (/foot|toe/i.test(n)) part = 'Foot';
    else if (/arm/i.test(n)) part = 'Arm'; /* LeftArm / LeftForeArm (sau Hand/Finger để khỏi nhầm) */
    groups[part].push(b);
  });
  return groups;
}

function edCharNewCharacter(id, name) {
  return {
    id: id, name: name || 'Nhân vật mới', level: 1, faction: 'Thiếu Lâm',
    hp: 100, atk: 10, def: 5, speed: 5, fbxKey: null, color: '#334155'
  };
}

function edCharNextId(project) {
  var chars = (project && Array.isArray(project.characters)) ? project.characters : [];
  var n = chars.length + 1;
  var used = {};
  chars.forEach(function (c) { if (c && c.id) used[c.id] = true; });
  while (used['char' + n]) n++;
  return 'char' + n;
}

function edCharClampAnimSpeed(v) {
  var n = Number(v);
  if (!isFinite(n)) return 1;
  return Math.min(2, Math.max(0.25, n));
}

function edCharClampStat(v, min, max, fallback) {
  var n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ---------------- IndexedDB riêng của editor ----------------
   DB 'mongvolam_editor_v1', store 'assets' (keyPath 'key'):
   {key, name, size, data:ArrayBuffer}. Mở trong hàm (không top-level). */
var ED_CHAR_DB = 'mongvolam_editor_v1';
var ED_CHAR_STORE = 'assets';

function edCharOpenDb() {
  return new Promise(function (resolve, reject) {
    var idb = null;
    try { idb = (typeof window !== 'undefined' && window.indexedDB) ? window.indexedDB : null; }
    catch (e) { idb = null; }
    if (!idb) { reject(new Error('Trình duyệt này không lưu được file .fbx (không dùng được IndexedDB).')); return; }
    var req;
    try { req = idb.open(ED_CHAR_DB, 1); } catch (e) {
      reject(new Error('Không mở được bộ nhớ editor (IndexedDB).')); return;
    }
    req.onupgradeneeded = function () {
      try {
        var db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'name' });
        if (!db.objectStoreNames.contains(ED_CHAR_STORE)) db.createObjectStore(ED_CHAR_STORE, { keyPath: 'key' });
      } catch (e) {}
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(new Error('Không mở được bộ nhớ editor (IndexedDB).')); };
    req.onblocked = function () { reject(new Error('Bộ nhớ editor đang bị chặn, thử đóng tab khác rồi thử lại.')); };
  });
}

function edCharIdbPut(key, name, size, data) {
  return edCharOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx;
      try { tx = db.transaction(ED_CHAR_STORE, 'readwrite'); }
      catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không lưu được file .fbx (IndexedDB).')); return; }
      var rec = { key: key, name: name, size: size, addedAt: Date.now(), data: data };
      var done = false;
      tx.oncomplete = function () { try { db.close(); } catch (e) {} if (!done) { done = true; resolve(rec); } };
      tx.onerror = function () { try { db.close(); } catch (e) {} if (!done) { done = true; reject(new Error('Không lưu được file .fbx vào máy.')); } };
      try { tx.objectStore(ED_CHAR_STORE).put(rec); }
      catch (e) { try { db.close(); } catch (e2) {} if (!done) { done = true; reject(new Error('Không lưu được file .fbx vào máy.')); } }
    });
  });
}

function edCharIdbGet(key) {
  return edCharOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx;
      try { tx = db.transaction(ED_CHAR_STORE, 'readonly'); }
      catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được file .fbx đã lưu (IndexedDB).')); return; }
      var req;
      try { req = tx.objectStore(ED_CHAR_STORE).get(key); }
      catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được file .fbx đã lưu.')); return; }
      req.onsuccess = function () { try { db.close(); } catch (e) {} resolve(req.result || null); };
      req.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không đọc được file .fbx đã lưu.')); };
    });
  });
}

function edCharIdbDel(key) {
  return edCharOpenDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx;
      try { tx = db.transaction(ED_CHAR_STORE, 'readwrite'); }
      catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xóa được file .fbx đã lưu.')); return; }
      tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(); };
      tx.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không xóa được file .fbx đã lưu.')); };
      try { tx.objectStore(ED_CHAR_STORE).delete(key); }
      catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xóa được file .fbx đã lưu.')); }
    });
  });
}

/* ---------------- Module ED.Character ---------------- */

ED.Character = {
  /* Logic thuần — nhóm D test được bằng vm + stub THREE. */
  validateFbxFile: edCharValidateFbxFile,
  normalizeTransform: edCharNormalizeTransform,
  collectBones: edCharCollectBones,
  collectClips: edCharCollectClips,
  groupBonesByPart: edCharGroupBonesByPart,
  newCharacter: edCharNewCharacter,
  nextId: edCharNextId,
  clampAnimSpeed: edCharClampAnimSpeed,
  clampStat: edCharClampStat,
  DB_NAME: ED_CHAR_DB,
  STORE_NAME: ED_CHAR_STORE,

  _localProject: null,   /* fallback khi nhóm A (ED.Core) chưa có */
  _panel: null,
  _input: null,
  _busy: false,
  _selectedId: null,
  _preview: null,        /* {renderer, scene, camera, group, mixer, action, clips, bones, angle, marker} */
  _raf: 0,
  _lastClock: 0,

  /* Project đang sửa: ED.Core.getProject() (nhóm A) nếu có, không thì
     project cục bộ. Lưu ý: ED.Core KHÔNG có thuộc tính .project. */
  project: function () {
    if (ED.Core && typeof ED.Core.getProject === 'function') {
      var p = null;
      try { p = ED.Core.getProject(); } catch (e) { p = null; }
      if (p && typeof p === 'object') return p;
    }
    if (ED.Core && ED.Core.project && typeof ED.Core.project === 'object') return ED.Core.project;
    if (!this._localProject) this._localProject = edCharDefaultProject();
    return this._localProject;
  },

  commit: function (label) {
    try {
      if (ED.Core) {
        if (typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(label || 'Character');
        if (typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
      }
    } catch (e) {}
    try {
      if (ED.UI) {
        if (typeof ED.UI.refreshHierarchy === 'function') ED.UI.refreshHierarchy();
        if (typeof ED.UI.refreshInspector === 'function') ED.UI.refreshInspector();
      }
    } catch (e) {}
  },

  log: function (msg) {
    try { if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log(msg); } catch (e) {}
  },

  toast: function (msg) {
    try { if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg); } catch (e) {}
  },

  /* Đọc File thành ArrayBuffer (arrayBuffer() có trên Chrome Android mới,
     FileReader là đường lui cho máy cũ) — theo src/12-fbx-ui.js. */
  _readBuffer: function (file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = function () { reject(new Error('Không đọc được file .fbx từ máy.')); };
      r.onload = function () { resolve(r.result); };
      try { r.readAsArrayBuffer(file); } catch (e) { reject(new Error('Không đọc được file .fbx từ máy.')); }
    });
  },

  /* Parse ArrayBuffer bằng FBXLoader r128 rồi chuẩn hoá cao 1.8, đáy y=0,
     căn giữa x/z — ĐÚNG src/11-fbx.js (FBXSupport.parseArrayBuffer). */
  parseArrayBuffer: function (ab) {
    var buf = null;
    if (ab && typeof ab === 'object') {
      if (typeof ab.byteLength === 'number' && typeof ab.slice === 'function' && !ab.buffer) buf = ab;
      else if (ab.buffer && typeof ab.byteLength === 'number' && typeof ab.byteOffset === 'number' && typeof ab.buffer.slice === 'function') {
        buf = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
      }
    }
    if (!buf) throw new Error('Dữ liệu file .fbx không hợp lệ.');
    if (typeof THREE === 'undefined' || !THREE.FBXLoader) {
      throw new Error('Chưa tải được bộ đọc .fbx, thử tải lại trang.');
    }
    var group;
    try { group = new THREE.FBXLoader().parse(buf, ''); }
    catch (e) { throw new Error('Không đọc được file .fbx này (' + (e && e.message ? e.message : 'định dạng không hỗ trợ') + ').'); }
    if (!group) throw new Error('Không đọc được file .fbx này (file rỗng).');
    var box = new THREE.Box3().setFromObject(group);
    var size = new THREE.Vector3();
    box.getSize(size);
    if (!isFinite(size.y) || size.y <= 0) throw new Error('File .fbx không có hình dạng nào để hiển thị.');
    var t = edCharNormalizeTransform({ minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z, maxZ: box.max.z });
    if (!t) throw new Error('File .fbx không có hình dạng nào để hiển thị.');
    group.scale.setScalar(t.scale);
    group.position.x += t.offsetX;
    group.position.y += t.offsetY;
    group.position.z += t.offsetZ;
    group.updateMatrixWorld(true);
    return { group: group, animations: group.animations || [] };
  },

  /* Import .fbx (DESIGN API): validate -> đọc + parse TRƯỚC (lỗi thì dừng,
     không lưu gì) -> lưu bytes vào IDB editor key 'char-<id>' -> upsert
     project.characters[] -> hiện preview. opts.charId: thay model của
     nhân vật có sẵn. Trả Promise<{id, clips, bones, hasBones}>. */
  importFbx: function (file, opts) {
    var self = this;
    opts = opts || {};
    var v = edCharValidateFbxFile(file);
    if (!v.ok) return Promise.reject(new Error(v.reason));
    if (this._busy) return Promise.reject(new Error('Đang đọc file .fbx, đợi một lát nhé!'));
    this._busy = true;
    this._setLoading(true, file.name);
    var project = this.project();
    var id = (opts.charId && typeof opts.charId === 'string') ? opts.charId : edCharNextId(project);
    var key = 'char-' + id;
    return this._readBuffer(file).then(function (buf) {
      var parsed = self.parseArrayBuffer(buf);
      return edCharIdbPut(key, file.name, file.size, buf).then(function () { return parsed; });
    }).then(function (parsed) {
      var clips = edCharCollectClips(parsed.animations);
      var bones = edCharCollectBones(parsed.group);
      var chars = project.characters;
      var ch = null;
      for (var i = 0; i < chars.length; i++) if (chars[i] && chars[i].id === id) { ch = chars[i]; break; }
      if (!ch) {
        ch = edCharNewCharacter(id, file.name.replace(/\.fbx$/i, ''));
        chars.push(ch);
      }
      ch.fbxKey = key;
      ch.name = ch.name || file.name.replace(/\.fbx$/i, '');
      self._selectedId = id;
      self._busy = false;
      self._setLoading(false);
      self.showPreview(parsed.group, clips, bones);
      self.commit('Import FBX ' + file.name);
      self.refreshList();
      self.toast('Đã nhập "' + file.name + '" — ' + clips.length + ' clip, ' + bones.length + ' xương.');
      return { id: id, clips: clips, bones: bones, hasBones: bones.length > 0 };
    }).catch(function (e) {
      self._busy = false;
      self._setLoading(false);
      throw e;
    });
  },

  /* Nạp lại model FBX đã lưu của 1 character (theo fbxKey) vào preview. */
  loadStoredModel: function (charId) {
    var self = this;
    var project = this.project();
    var ch = null;
    for (var i = 0; i < project.characters.length; i++) {
      if (project.characters[i] && project.characters[i].id === charId) { ch = project.characters[i]; break; }
    }
    if (!ch || !ch.fbxKey) return Promise.resolve(null);
    return edCharIdbGet(ch.fbxKey).then(function (rec) {
      if (!rec || !rec.data) throw new Error('Không tìm thấy file .fbx đã lưu của "' + (ch.name || charId) + '", thử nhập lại file nhé!');
      var parsed = self.parseArrayBuffer(rec.data);
      self._selectedId = charId;
      self.showPreview(parsed.group, edCharCollectClips(parsed.animations), edCharCollectBones(parsed.group));
      return { id: charId, clips: edCharCollectClips(parsed.animations), bones: edCharCollectBones(parsed.group) };
    });
  },

  /* Xoá character khỏi project + xoá file FBX trong IDB. */
  removeCharacter: function (charId) {
    var self = this;
    var project = this.project();
    var idx = -1, ch = null;
    for (var i = 0; i < project.characters.length; i++) {
      if (project.characters[i] && project.characters[i].id === charId) { idx = i; ch = project.characters[i]; break; }
    }
    if (idx < 0) return Promise.resolve(false);
    project.characters.splice(idx, 1);
    if (this._selectedId === charId) { this._selectedId = null; this.clearPreview(); }
    this.commit('Xoá nhân vật');
    this.refreshList();
    if (ch && ch.fbxKey) return edCharIdbDel(ch.fbxKey).catch(function () {}).then(function () { return true; });
    return Promise.resolve(true);
  },

  /* Thêm nhân vật vào scene chính: object type 'character', extra {charId}.
     Có FBX thì viewport dùng model đó, không thì chibi placeholder nhóm B. */
  addCharacterToScene: function (charId) {
    var project = this.project();
    var ch = null;
    for (var i = 0; i < project.characters.length; i++) {
      if (project.characters[i] && project.characters[i].id === charId) { ch = project.characters[i]; break; }
    }
    if (!ch) { this.toast('Chưa chọn nhân vật nào.'); return null; }
    var def = {
      type: 'character', category: 'Characters', name: ch.name,
      pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1],
      color: ch.color || '#334155', extra: { charId: ch.id, fbxKey: ch.fbxKey || null }
    };
    var obj = null;
    try {
      if (ED.Core && typeof ED.Core.addObject === 'function') obj = ED.Core.addObject(def);
    } catch (e) { obj = null; }
    if (!obj) {
      def.id = 'obj-' + Date.now().toString(36);
      project.objects.push(def);
      obj = def;
      this.commit('Thêm nhân vật vào scene');
      try { if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') ED.Viewport.syncObject(obj); } catch (e) {}
    }
    this.toast('Đã thêm "' + ch.name + '" vào scene (type character).');
    return obj;
  },

  /* ---------------- Preview (renderer thứ 2, 360x260) ---------------- */
  initPreview: function (hostEl) {
    if (typeof THREE === 'undefined' || !hostEl || this._preview) return false;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (e) { return false; }
    renderer.setSize(360, 260);
    renderer.setPixelRatio(Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5));
    hostEl.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d24);
    var camera = new THREE.PerspectiveCamera(45, 360 / 260, 0.1, 100);
    camera.position.set(0, 1.2, 3.2);
    camera.lookAt(0, 0.9, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    var dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(2, 4, 3);
    scene.add(dir);
    var grid = new THREE.GridHelper(4, 8, 0xfacc15, 0x444a55);
    grid.position.y = 0.001;
    scene.add(grid);
    var marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    );
    marker.visible = false;
    scene.add(marker);
    var self = this;
    var pv = {
      renderer: renderer, scene: scene, camera: camera, group: null,
      mixer: null, action: null, clips: [], bones: [], angle: 0, marker: marker,
      loop: true, speed: 1, playing: false, drag: null
    };
    this._preview = pv;
    var cv = renderer.domElement;
    cv.style.touchAction = 'none';
    cv.style.display = 'block';
    cv.style.maxWidth = '100%';
    function posOf(e) {
      if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    }
    cv.addEventListener('pointerdown', function (e) {
      pv.drag = { x: posOf(e).x, angle: pv.angle };
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    });
    cv.addEventListener('pointermove', function (e) {
      if (!pv.drag) return;
      pv.angle = pv.drag.angle + (posOf(e).x - pv.drag.x) * 0.01;
      if (pv.group) pv.group.rotation.y = pv.angle;
    });
    function endDrag() { pv.drag = null; }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    if (typeof requestAnimationFrame !== 'undefined') {
      var tick = function (t) {
        if (!self._preview) return;
        self._raf = requestAnimationFrame(tick);
        var dt = 0.016;
        if (self._lastClock) dt = Math.min(0.1, (t - self._lastClock) / 1000 || 0.016);
        self._lastClock = t;
        if (pv.mixer && pv.playing) {
          try {
            pv.mixer.update(dt);
            /* Hook cho module Animation (11-animation.js): root motion...
               chạy sau mixer.update, mỗi frame phát clip trong preview. */
            if (typeof pv.onTick === 'function') { try { pv.onTick(dt); } catch (e2) {} }
          } catch (e) { pv.mixer = null; }
        }
        try { renderer.render(scene, camera); } catch (e) {}
      };
      this._raf = requestAnimationFrame(tick);
    }
    return true;
  },

  /* Đặt góc camera preview: front/back/left/right. */
  setPreviewView: function (view) {
    var pv = this._preview;
    if (!pv) return;
    var d = 3.2, h = 1.2;
    if (view === 'back') pv.camera.position.set(0, h, -d);
    else if (view === 'left') pv.camera.position.set(-d, h, 0);
    else if (view === 'right') pv.camera.position.set(d, h, 0);
    else pv.camera.position.set(0, h, d);
    pv.camera.lookAt(0, 0.9, 0);
  },

  showPreview: function (group, clips, bones) {
    var pv = this._preview;
    if (!pv) return false;
    if (pv.group) { try { pv.scene.remove(pv.group); } catch (e) {} }
    if (pv.mixer) { try { pv.mixer.stopAllAction(); } catch (e) {} pv.mixer = null; pv.action = null; }
    pv.group = group || null;
    pv.clips = clips || [];
    pv.bones = bones || [];
    pv.playing = false;
    pv.selectedBone = null;
    pv.onTick = null;
    pv.customClip = null;
    pv.marker.visible = false;
    if (group) {
      group.rotation.y = pv.angle;
      pv.scene.add(group);
      if (pv.clips.length && typeof THREE.AnimationMixer === 'function') {
        try {
          pv.mixer = new THREE.AnimationMixer(group);
        } catch (e) { pv.mixer = null; }
      }
    }
    this.renderBoneTree();
    this.renderClipList();
    this.renderBoneInfo(null);
    return true;
  },

  clearPreview: function () {
    var pv = this._preview;
    if (!pv) return;
    if (pv.group) { try { pv.scene.remove(pv.group); } catch (e) {} }
    pv.group = null; pv.mixer = null; pv.action = null;
    pv.clips = []; pv.bones = []; pv.playing = false;
    pv.selectedBone = null;
    pv.onTick = null;
    pv.customClip = null;
    pv.marker.visible = false;
    this.renderBoneTree();
    this.renderClipList();
    this.renderBoneInfo(null);
  },

  /* Phát clip theo tên (mặc định clip đầu). opts.fadeSec > 0 thì chuyển
     clip bằng crossfade (mixer.crossFadeTo) thay vì cắt đột ngột. */
  playClip: function (clipName, opts) {
    var pv = this._preview;
    if (!pv || !pv.mixer || !pv.clips.length) return false;
    var clip = null;
    var group = pv.group;
    var anims = (group && group.animations) ? group.animations : [];
    for (var i = 0; i < anims.length; i++) {
      if (anims[i] && anims[i].name === clipName) { clip = anims[i]; break; }
    }
    if (!clip) clip = anims[0];
    if (!clip) return false;
    var fade = 0;
    if (opts && isFinite(Number(opts.fadeSec))) fade = Math.min(2, Math.max(0, Number(opts.fadeSec)));
    try {
      var prev = pv.action;
      var next = pv.mixer.clipAction(clip);
      next.setLoop(pv.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.reset();
      pv.mixer.timeScale = pv.speed;
      if (prev && prev !== next && fade > 0) {
        next.play();
        prev.crossFadeTo(next, fade);
      } else {
        if (prev) prev.stop();
        next.play();
      }
      pv.action = next;
      pv.customClip = null;
      pv.playing = true;
      return true;
    } catch (e) { return false; }
  },

  /* Phát 1 THREE.AnimationClip tự tạo (do ED.Animation build từ
     project.animations) trong preview. opts: {fadeSec, speed, loop}.
     Dùng chung mixer của preview nên nút Play/Pause/Stop gốc vẫn chạy.
     Trả true/false. */
  playCustomClip: function (clip, opts) {
    var pv = this._preview;
    if (!pv || !pv.mixer || !pv.group || !clip) return false;
    var fade = 0;
    if (opts && isFinite(Number(opts.fadeSec))) fade = Math.min(2, Math.max(0, Number(opts.fadeSec)));
    var speed = pv.speed;
    if (opts && isFinite(Number(opts.speed))) speed = edCharClampAnimSpeed(opts.speed);
    var loop = pv.loop;
    if (opts && typeof opts.loop === 'boolean') loop = opts.loop;
    try {
      var prev = pv.action;
      var next = pv.mixer.clipAction(clip);
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.reset();
      pv.mixer.timeScale = speed;
      if (prev && prev !== next && fade > 0) {
        next.play();
        prev.crossFadeTo(next, fade);
      } else {
        if (prev) prev.stop();
        next.play();
      }
      pv.action = next;
      pv.customClip = clip;
      pv.playing = true;
      return true;
    } catch (e) { return false; }
  },

  /* API cho module Animation (11-animation.js): đọc trạng thái preview
     mà không chạm trực tiếp _preview. */
  getPreview: function () { return this._preview; },

  getSelectedBone: function () {
    var pv = this._preview;
    return (pv && pv.selectedBone) ? pv.selectedBone : null;
  },

  /* Vị trí/xoay CỤC BỘ hiện tại của 1 xương (radian cho rot) — để
     Animation Editor lấy giá trị làm keyframe. Trả null nếu không thấy. */
  getBoneTransform: function (boneName) {
    var pv = this._preview;
    if (!pv || !pv.group || !boneName) return null;
    var found = null;
    pv.group.traverse(function (obj) {
      if (!found && obj && obj.isBone && obj.name === boneName) found = obj;
    });
    if (!found) return null;
    return {
      name: found.name,
      pos: [found.position.x, found.position.y, found.position.z],
      rot: [found.rotation.x, found.rotation.y, found.rotation.z]
    };
  },

  pauseClip: function () { var pv = this._preview; if (pv) pv.playing = false; },
  resumeClip: function () { var pv = this._preview; if (pv && pv.action) pv.playing = true; },

  stopClip: function () {
    var pv = this._preview;
    if (!pv) return;
    pv.playing = false;
    try { if (pv.action) pv.action.stop(); } catch (e) {}
    pv.action = null;
  },

  setLoop: function (loop) {
    var pv = this._preview;
    if (!pv) return;
    pv.loop = !!loop;
    if (pv.action) {
      try { pv.action.setLoop(pv.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); } catch (e) {}
    }
  },

  setSpeed: function (v) {
    var pv = this._preview;
    var s = edCharClampAnimSpeed(v);
    if (!pv) return s;
    pv.speed = s;
    if (pv.mixer) { try { pv.mixer.timeScale = s; } catch (e) {} }
    return s;
  },

  /* Chọn xương: highlight bằng marker vàng tại vị trí thế giới của xương
     + hiện tên/vị trí trong inspector. */
  selectBone: function (boneName) {
    var pv = this._preview;
    if (!pv || !pv.group) return null;
    var found = null;
    pv.group.traverse(function (obj) {
      if (!found && obj && obj.isBone && obj.name === boneName) found = obj;
    });
    if (!found) return null;
    pv.selectedBone = found.name;
    var wp = new THREE.Vector3();
    try { found.getWorldPosition(wp); } catch (e) { wp.set(0, 0, 0); }
    pv.marker.position.copy(wp);
    pv.marker.visible = true;
    var info = {
      name: found.name,
      pos: [Number(wp.x.toFixed(2)), Number(wp.y.toFixed(2)), Number(wp.z.toFixed(2))]
    };
    this.renderBoneInfo(info);
    return info;
  },

  /* Đổi màu vật liệu của model đang preview + lưu vào characters[].color. */
  setPreviewColor: function (hex) {
    var pv = this._preview;
    if (!pv || !pv.group) return false;
    var ok = false;
    pv.group.traverse(function (obj) {
      if (!obj || !obj.isMesh || !obj.material) return;
      var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(function (m) {
        if (m && m.color && typeof m.color.set === 'function') {
          try { m.color.set(hex); ok = true; } catch (e) {}
        }
      });
    });
    if (ok && this._selectedId) {
      var project = this.project();
      for (var i = 0; i < project.characters.length; i++) {
        if (project.characters[i] && project.characters[i].id === this._selectedId) {
          project.characters[i].color = hex;
          break;
        }
      }
      this.commit('Đổi màu nhân vật');
    }
    return ok;
  },

  /* ---------------- Panel (DOM — chỉ trong init) ---------------- */
  init: function (container) {
    if (typeof document === 'undefined') return false;
    var host = container || null;
    if (!host) {
      host = document.querySelector('[data-ed-panel="character"]')
        || document.getElementById('ed-panel-character')
        || document.getElementById('ed-tab-character')
        || document.getElementById('tab-character'); /* tab thật nhóm A: #tab-character trong #panel-bottom */
    }
    if (!host) {
      /* Fallback khi nhóm A chưa tạo tab: tự tạo pane trong #panel-bottom. */
      var bottom = document.getElementById('panel-bottom') || document.body;
      host = document.createElement('div');
      host.id = 'ed-panel-character-fallback';
      host.className = 'ed-panel ed-panel-character bottom-pane';
      var title = document.createElement('h3');
      title.textContent = '🧍 Nhân vật (Character)';
      host.appendChild(title);
      bottom.appendChild(host);
    } else {
      /* Xoá dòng placeholder ".empty-note" của nhóm A trong tab thật. */
      var note = host.querySelector ? host.querySelector('.empty-note') : null;
      if (note && note.remove) note.remove();
    }
    this._panel = host;
    var self = this;
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = text;
      return e;
    }
    function btn(label, fn) {
      var b = el('button', 'ed-btn', label);
      b.style.minHeight = '40px';
      b.addEventListener('click', fn);
      return b;
    }

    var status = el('div', 'ed-char-status', 'Chưa nhập file .fbx nào.');
    host.appendChild(status);
    this._statusEl = status;

    var row1 = el('div', 'ed-row');
    var pickBtn = btn('📁 Nhập file .fbx', function () { self._openPicker(null); });
    var replaceBtn = btn('🔄 Thay model', function () {
      if (!self._selectedId) { self.toast('Chọn nhân vật trước rồi mới thay model.'); return; }
      self._openPicker(self._selectedId);
    });
    var addBtn = btn('➕ Thêm vào scene', function () {
      if (!self._selectedId) { self.toast('Chọn nhân vật trước.'); return; }
      self.addCharacterToScene(self._selectedId);
    });
    row1.appendChild(pickBtn); row1.appendChild(replaceBtn); row1.appendChild(addBtn);
    host.appendChild(row1);

    var listWrap = el('div', 'ed-char-list');
    listWrap.appendChild(el('label', '', 'Nhân vật:'));
    var sel = el('select', 'ed-char-select');
    sel.style.minHeight = '40px';
    sel.style.width = '100%';
    sel.addEventListener('change', function () {
      self._selectedId = sel.value || null;
      self.renderCharForm();
      if (self._selectedId) self.loadStoredModel(self._selectedId).catch(function (e) { self.toast(e.message); });
    });
    listWrap.appendChild(sel);
    this._selectEl = sel;
    host.appendChild(listWrap);

    /* Form sửa nhân vật đang chọn. */
    var form = el('div', 'ed-char-form');
    host.appendChild(form);
    this._formEl = form;

    /* Preview. */
    var pvWrap = el('div', 'ed-char-preview');
    pvWrap.appendChild(el('div', 'ed-char-preview-title', 'Xem trước (kéo để xoay 360°)'));
    var pvHost = el('div', 'ed-char-preview-host');
    pvWrap.appendChild(pvHost);
    var viewRow = el('div', 'ed-row');
    ['front', 'back', 'left', 'right'].forEach(function (v) {
      var label = { front: 'Trước', back: 'Sau', left: 'Trái', right: 'Phải' }[v];
      viewRow.appendChild(btn(label, function () { self.setPreviewView(v); }));
    });
    pvWrap.appendChild(viewRow);
    host.appendChild(pvWrap);
    this.initPreview(pvHost);

    /* Animation. */
    var animWrap = el('div', 'ed-char-anim');
    animWrap.appendChild(el('div', '', '🎬 Animation'));
    var clipList = el('div', 'ed-char-clips');
    animWrap.appendChild(clipList);
    this._clipListEl = clipList;
    var animRow = el('div', 'ed-row');
    animRow.appendChild(btn('▶ Phát', function () { self.resumeClip(); if (!self._preview || !self._preview.action) self.playClip(); }));
    animRow.appendChild(btn('⏸ Tạm dừng', function () { self.pauseClip(); }));
    animRow.appendChild(btn('⏹ Dừng', function () { self.stopClip(); }));
    animWrap.appendChild(animRow);
    var loopRow = el('div', 'ed-row');
    var loopCb = el('input');
    loopCb.type = 'checkbox'; loopCb.checked = true;
    loopCb.addEventListener('change', function () { self.setLoop(loopCb.checked); });
    loopRow.appendChild(loopCb);
    loopRow.appendChild(el('label', '', 'Lặp lại (Loop)'));
    var speed = el('input');
    speed.type = 'range'; speed.min = '0.25'; speed.max = '2'; speed.step = '0.25'; speed.value = '1';
    speed.style.flex = '1';
    var speedLabel = el('span', '', 'Tốc độ 1x');
    speed.addEventListener('input', function () {
      var s = self.setSpeed(speed.value);
      speedLabel.textContent = 'Tốc độ ' + s + 'x';
    });
    loopRow.appendChild(speed);
    loopRow.appendChild(speedLabel);
    animWrap.appendChild(loopRow);
    host.appendChild(animWrap);

    /* Skeleton. */
    var skWrap = el('div', 'ed-char-skeleton');
    skWrap.appendChild(el('div', '', '🦴 Xương (Skeleton)'));
    var boneInfo = el('div', 'ed-char-bone-info', 'Chưa chọn xương nào.');
    skWrap.appendChild(boneInfo);
    this._boneInfoEl = boneInfo;
    var boneTree = el('div', 'ed-char-bone-tree');
    skWrap.appendChild(boneTree);
    this._boneTreeEl = boneTree;
    host.appendChild(skWrap);

    /* File picker ẩn. */
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.fbx';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    this._input = inp;

    this.refreshList();
    this.renderBoneTree();
    this.renderClipList();
    return true;
  },

  _openPicker: function (charId) {
    var self = this;
    if (!this._input) return;
    this._input.onchange = function () {
      var f = self._input.files && self._input.files[0];
      self._input.value = '';
      if (!f) return;
      self.importFbx(f, { charId: charId }).catch(function (e) {
        self.toast(e && e.message ? e.message : 'Không nhập được file .fbx.');
        if (self._statusEl) self._statusEl.textContent = 'Lỗi: ' + (e && e.message ? e.message : 'không nhập được file.');
      });
    };
    try { this._input.click(); } catch (e) { this.toast('Không mở được trình chọn file trên thiết bị này.'); }
  },

  _setLoading: function (busy, fileName) {
    if (!this._statusEl) return;
    this._statusEl.textContent = busy
      ? ('⏳ Đang đọc file "' + (fileName || '') + '"… (file lớn có thể mất vài giây)')
      : 'Sẵn sàng.';
  },

  refreshList: function () {
    var sel = this._selectEl;
    if (!sel) return;
    var project = this.project();
    var cur = this._selectedId;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Chọn nhân vật —';
    sel.appendChild(opt0);
    project.characters.forEach(function (ch) {
      var o = document.createElement('option');
      o.value = ch.id;
      o.textContent = ch.name + ' (Lv' + ch.level + ' · ' + ch.faction + ')' + (ch.fbxKey ? ' · FBX' : ' · chibi');
      sel.appendChild(o);
    });
    sel.value = cur || '';
    this.renderCharForm();
  },

  renderCharForm: function () {
    var form = this._formEl;
    if (!form || typeof document === 'undefined') return;
    while (form.firstChild) form.removeChild(form.firstChild);
    var project = this.project();
    var ch = null;
    for (var i = 0; i < project.characters.length; i++) {
      if (project.characters[i] && project.characters[i].id === this._selectedId) { ch = project.characters[i]; break; }
    }
    if (!ch) {
      form.textContent = 'Chưa chọn nhân vật — nhập file .fbx để tạo nhân vật mới.';
      return;
    }
    var self = this;
    function field(label, value, onInput, type) {
      var wrap = document.createElement('div');
      wrap.className = 'ed-field';
      var lab = document.createElement('label');
      lab.textContent = label;
      wrap.appendChild(lab);
      var inp = document.createElement('input');
      inp.type = type || 'text';
      inp.value = value;
      inp.style.minHeight = '40px';
      inp.style.width = '100%';
      inp.addEventListener('change', function () { onInput(inp.value); });
      wrap.appendChild(inp);
      form.appendChild(wrap);
      return inp;
    }
    field('Tên', ch.name, function (v) { ch.name = String(v || '').slice(0, 24) || ch.name; self.commit('Đổi tên nhân vật'); self.refreshList(); });
    var factions = ['Thiếu Lâm', 'Võ Đang', 'Nga Mi', 'Cái Bang', 'Minh Giáo', 'Tiêu Dao'];
    var fWrap = document.createElement('div');
    fWrap.className = 'ed-field';
    var fLab = document.createElement('label');
    fLab.textContent = 'Môn phái';
    fWrap.appendChild(fLab);
    var fSel = document.createElement('select');
    fSel.style.minHeight = '40px';
    fSel.style.width = '100%';
    factions.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f; o.textContent = f;
      fSel.appendChild(o);
    });
    fSel.value = ch.faction;
    fSel.addEventListener('change', function () { ch.faction = fSel.value; self.commit('Đổi môn phái'); });
    fWrap.appendChild(fSel);
    form.appendChild(fWrap);
    field('Level', ch.level, function (v) { ch.level = edCharClampStat(v, 1, 99, 1); self.commit('Đổi level'); }, 'number');
    field('HP', ch.hp, function (v) { ch.hp = edCharClampStat(v, 1, 99999, 100); self.commit('Đổi HP'); }, 'number');
    field('ATK', ch.atk, function (v) { ch.atk = edCharClampStat(v, 0, 9999, 10); self.commit('Đổi ATK'); }, 'number');
    field('DEF', ch.def, function (v) { ch.def = edCharClampStat(v, 0, 9999, 5); self.commit('Đổi DEF'); }, 'number');
    field('Tốc độ', ch.speed, function (v) { ch.speed = edCharClampStat(v, 1, 20, 5); self.commit('Đổi tốc độ'); }, 'number');
    var cWrap = document.createElement('div');
    cWrap.className = 'ed-field';
    var cLab = document.createElement('label');
    cLab.textContent = 'Màu vật liệu';
    cWrap.appendChild(cLab);
    var cInp = document.createElement('input');
    cInp.type = 'color';
    cInp.value = ch.color || '#334155';
    cInp.style.minHeight = '40px';
    cInp.addEventListener('change', function () { self.setPreviewColor(cInp.value); });
    cWrap.appendChild(cInp);
    form.appendChild(cWrap);
    var delBtn = document.createElement('button');
    delBtn.className = 'ed-btn';
    delBtn.style.minHeight = '40px';
    delBtn.textContent = '🗑 Xoá nhân vật';
    delBtn.addEventListener('click', function () {
      self.removeCharacter(ch.id).then(function () { self.toast('Đã xoá nhân vật.'); });
    });
    form.appendChild(delBtn);
  },

  renderClipList: function () {
    var list = this._clipListEl;
    if (!list || typeof document === 'undefined') return;
    while (list.firstChild) list.removeChild(list.firstChild);
    var pv = this._preview;
    var clips = (pv && pv.clips) ? pv.clips : [];
    if (!clips.length) {
      list.textContent = 'Không có animation nào trong file này.';
      return;
    }
    var self = this;
    clips.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'ed-btn';
      b.style.minHeight = '40px';
      b.textContent = '▶ ' + c.name + ' (' + Number(c.duration).toFixed(1) + 's)';
      b.addEventListener('click', function () { self.playClip(c.name); });
      list.appendChild(b);
    });
  },

  renderBoneTree: function () {
    var tree = this._boneTreeEl;
    if (!tree || typeof document === 'undefined') return;
    while (tree.firstChild) tree.removeChild(tree.firstChild);
    var pv = this._preview;
    var bones = (pv && pv.bones) ? pv.bones : [];
    if (!bones.length) {
      tree.textContent = 'File này không có xương (mesh-only) — chỉ xem được hình dạng, không xem được skeleton/animation xương.';
      return;
    }
    var groups = edCharGroupBonesByPart(bones);
    var self = this;
    Object.keys(groups).forEach(function (part) {
      var arr = groups[part];
      if (!arr.length) return;
      var head = document.createElement('div');
      head.className = 'ed-bone-part';
      head.textContent = part + ' (' + arr.length + ')';
      tree.appendChild(head);
      arr.forEach(function (b) {
        var btn = document.createElement('button');
        btn.className = 'ed-btn ed-bone-btn';
        btn.style.minHeight = '36px';
        btn.textContent = b.name;
        btn.title = b.path;
        btn.addEventListener('click', function () { self.selectBone(b.name); });
        tree.appendChild(btn);
      });
    });
  },

  renderBoneInfo: function (info) {
    if (!this._boneInfoEl) return;
    if (!info) { this._boneInfoEl.textContent = 'Chưa chọn xương nào — bấm 1 xương trong cây để xem tên/vị trí.'; return; }
    this._boneInfoEl.textContent = 'Xương: ' + info.name + ' — vị trí (' + info.pos[0] + ', ' + info.pos[1] + ', ' + info.pos[2] + ')';
  }
};
