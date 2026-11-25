/* Map Editor — 00-core.js (worker A)
   ED.Core: state, project JSON v1, undo/redo, selection, persistence.
   Logic thuần: KHÔNG truy cập document/window/THREE ở top-level để test Node được.
   Mọi truy cập IndexedDB/localStorage đều nằm trong hàm và có guard typeof. */
var ED = ED || {};

ED.Core = (function () {
  var DB_NAME = 'mongvolam_editor_v1';
  var DB_STORE = 'projects';
  var PREFS_KEY = 'mongvolam_editor_prefs_v1';
  var MAX_HISTORY = 50;

  var _idCounter = 0;
  var _project = null;
  var _selectedId = null;
  var _selectedIds = []; // đợt 6: multi-select (tương thích: _selectedId = phần tử đầu)
  var _undoStack = []; // snapshot JSON string, snapshot TRƯỚC thay đổi
  var _redoStack = [];
  var _dirty = false;

  function _nextId() {
    _idCounter += 1;
    return 'obj-' + _idCounter;
  }

  // Quét id hiện có để counter không trùng sau khi load project.
  function _resyncCounter() {
    var max = 0;
    var objs = _project ? _project.objects : [];
    for (var i = 0; i < objs.length; i++) {
      var m = /^obj-(\d+)$/.exec(objs[i].id || '');
      if (m && +m[1] > max) max = +m[1];
    }
    if (max > _idCounter) _idCounter = max;
  }

  function _emptyTerrain(size, segments) {
    var n = (segments + 1) * (segments + 1);
    var heights = new Array(n);
    var paints = new Array(n);
    for (var i = 0; i < n; i++) { heights[i] = 0; paints[i] = 0; }
    return { size: size, segments: segments, heights: heights, paints: paints };
  }

  function newProject(name) {
    _project = {
      version: 1,
      name: name || 'Project mới',
      terrain: _emptyTerrain(96, 64),
      env: { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co' },
      objects: [],
      npcs: [],
      quests: [],
      characters: []
    };
    _selectedId = null;
    _selectedIds = [];
    _undoStack = [];
    _redoStack = [];
    _dirty = false;
    _notify();
    return _project;
  }

  function getProject() { return _project; }

  function serialize() {
    return JSON.stringify(_project);
  }

  // Load từ object đã parse (JSON.parse ở ngoài). Trả về true/false.
  function load(jsonObj) {
    if (!jsonObj || typeof jsonObj !== 'object') return false;
    if (jsonObj.version !== 1) return false;
    if (!Array.isArray(jsonObj.objects)) return false;
    _project = jsonObj;
    if (!_project.terrain) _project.terrain = _emptyTerrain(96, 64);
    if (!_project.env) _project.env = { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co' };
    if (!Array.isArray(_project.npcs)) _project.npcs = [];
    if (!Array.isArray(_project.quests)) _project.quests = [];
    if (!Array.isArray(_project.characters)) _project.characters = [];
    _selectedId = null;
    _selectedIds = [];
    _undoStack = [];
    _redoStack = [];
    _dirty = false;
    _resyncCounter();
    _notify();
    return true;
  }

  function _ensureProject() {
    if (!_project) newProject('Project mới');
    return _project;
  }

  // def: {type, category, name, pos, rot, scale, color, material, parent, extra, ...}
  function addObject(def) {
    def = def || {};
    _ensureProject();
    var obj = {
      id: def.id || _nextId(),
      type: def.type || 'prop',
      category: def.category || categoryForType(def.type || 'prop'),
      name: def.name || (def.type || 'prop'),
      pos: (def.pos || [0, 0, 0]).slice(),
      rot: (def.rot || [0, 0, 0]).slice(),
      scale: (def.scale || [1, 1, 1]).slice(),
      color: def.color || '#9aa0a6',
      material: def.material || { roughness: 0.8, metalness: 0.0, opacity: 1 },
      locked: !!def.locked,
      visible: def.visible !== false,
      parent: def.parent || null,
      extra: def.extra || {}
    };
    _project.objects.push(obj);
    _resyncCounter();
    markDirty();
    _notify();
    return obj;
  }

  function removeObject(id) {
    if (!_project) return false;
    var idx = -1;
    for (var i = 0; i < _project.objects.length; i++) {
      if (_project.objects[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return false;
    _project.objects.splice(idx, 1);
    // Con của object bị xoá thì đưa về root (không xoá theo).
    for (var j = 0; j < _project.objects.length; j++) {
      if (_project.objects[j].parent === id) _project.objects[j].parent = null;
    }
    var si = _selectedIds.indexOf(id);
    if (si >= 0) _selectedIds.splice(si, 1);
    if (_selectedId === id) _selectedId = _selectedIds.length ? _selectedIds[0] : null;
    markDirty();
    _notify();
    return true;
  }

  function getObject(id) {
    if (!_project) return null;
    for (var i = 0; i < _project.objects.length; i++) {
      if (_project.objects[i].id === id) return _project.objects[i];
    }
    return null;
  }

  function listObjects() {
    return _project ? _project.objects.slice() : [];
  }

  function select(id) {
    if (id !== null && id !== undefined && !getObject(id)) return false;
    _selectedId = id || null;
    _selectedIds = _selectedId ? [_selectedId] : [];
    _notify();
    return true;
  }

  function selectedId() { return _selectedId; }

  function selectedObject() {
    return _selectedId ? getObject(_selectedId) : null;
  }

  /* ---- Đợt 6: multi-select. selectedId() = phần tử đầu của selection
     (tương thích cũ). Mọi hàm đổi selection đều gọi _notify() như select. ---- */
  function selectMany(ids) {
    var out = [];
    ids = ids || [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (id != null && getObject(id) && out.indexOf(id) < 0) out.push(id);
    }
    _selectedIds = out;
    _selectedId = out.length ? out[0] : null;
    _notify();
    return _selectedIds.slice();
  }
  function addToSelection(id) {
    if (id == null || !getObject(id)) return false;
    if (_selectedIds.indexOf(id) < 0) _selectedIds.push(id);
    if (!_selectedId) _selectedId = id;
    _notify();
    return true;
  }
  function removeFromSelection(id) {
    var i = _selectedIds.indexOf(id);
    if (i < 0) return false;
    _selectedIds.splice(i, 1);
    if (_selectedId === id) _selectedId = _selectedIds.length ? _selectedIds[0] : null;
    _notify();
    return true;
  }
  function clearSelection() {
    _selectedIds = [];
    _selectedId = null;
    _notify();
  }
  function getSelectedIds() { return _selectedIds.slice(); }
  function getSelectedObjects() {
    var out = [];
    for (var i = 0; i < _selectedIds.length; i++) {
      var o = getObject(_selectedIds[i]);
      if (o) out.push(o);
    }
    return out;
  }

  // Nhóm hiển thị trong hierarchy theo type (khi object chưa có category riêng).
  function categoryForType(type) {
    switch (type) {
      case 'terrain': return 'Terrain';
      case 'house': case 'temple': case 'bridge': return 'Buildings';
      case 'npc': case 'monster': case 'character': return 'Characters';
      case 'waypoint': return 'Waypoints';
      case 'collider': return 'Colliders';
      case 'fx': return 'Effects';
      case 'light': return 'Effects';
      case 'camera': return 'Cameras';
      default: return 'Decorations';
    }
  }

  // NPC trong scene có 1 object type 'npc' + 1 entry trong npcs[] (cùng id).
  // Đồng bộ vị trí object từ entry npc (gọi sau khi sửa npc).
  function syncNpcObject(npc) {
    if (!npc || !npc.id) return null;
    var obj = getObject(npc.id);
    var pos = npc.pos || [0, 0];
    if (!obj) {
      obj = addObject({
        id: npc.id, type: 'npc', name: npc.name || 'NPC',
        pos: [pos[0], 0, pos[1]], extra: { npc: true }
      });
    } else {
      obj.pos[0] = pos[0];
      obj.pos[2] = pos[1];
      obj.name = npc.name || obj.name;
      markDirty();
      _notify();
    }
    return obj;
  }

  // --- Undo / redo: snapshot toàn bộ project JSON trước mỗi thay đổi ---
  function pushHistory(label) {
    if (!_project) return;
    _undoStack.push(serialize());
    if (_undoStack.length > MAX_HISTORY) _undoStack.shift();
    _redoStack = [];
    markDirty();
  }

  function undo() {
    if (!_undoStack.length || !_project) return false;
    _redoStack.push(serialize());
    var prev = _undoStack.pop();
    var parsed = null;
    try { parsed = JSON.parse(prev); } catch (e) { return false; }
    var sel = _selectedId;
    _project = parsed;
    _selectedId = getObject(sel) ? sel : null;
    _selectedIds = getObject(sel) ? [sel] : []; // đợt 6: khôi phục multi-select
    _resyncCounter();
    _dirty = true;
    _notify();
    return true;
  }

  function redo() {
    if (!_redoStack.length || !_project) return false;
    _undoStack.push(serialize());
    var next = _redoStack.pop();
    var parsed = null;
    try { parsed = JSON.parse(next); } catch (e) { return false; }
    var sel = _selectedId;
    _project = parsed;
    _selectedId = getObject(sel) ? sel : null;
    _selectedIds = getObject(sel) ? [sel] : []; // đợt 6: khôi phục multi-select
    _resyncCounter();
    _dirty = true;
    _notify();
    return true;
  }

  function canUndo() { return _undoStack.length > 0; }
  function canRedo() { return _redoStack.length > 0; }

  function markDirty() { _dirty = true; }
  function isDirty() { return _dirty; }
  function clearDirty() { _dirty = false; }

  // --- Persistence: IndexedDB (async, guard khi chạy Node test) ---
  function _openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB khong co (moi truong Node test)'));
        return;
      }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: 'name' });
        }
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'key' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Mo IndexedDB that bai')); };
    });
  }

  function saveProject(name) {
    _ensureProject();
    var nm = name || _project.name || 'Project mới';
    _project.name = nm;
    var payload = { name: nm, json: serialize(), updatedAt: 0 };
    // updatedAt = 0 ở core để logic thuần không phụ thuộc thời gian;
    // boot/UI có thể ghi đè bằng Date.now() khi lưu thật trên trình duyệt.
    try {
      if (typeof Date !== 'undefined' && typeof window !== 'undefined') {
        payload.updatedAt = Date.now();
      }
    } catch (e) { /* giữ 0 */ }
    return _openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        var st = tx.objectStore(DB_STORE);
        var req = st.put(payload);
        req.onsuccess = function () { _dirty = false; _notify(); resolve(nm); };
        req.onerror = function () { reject(req.error || new Error('Luu project that bai')); };
      });
    });
  }

  function loadProject(name) {
    return _openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).get(name);
        req.onsuccess = function () {
          if (!req.result) { reject(new Error('Khong tim thay project: ' + name)); return; }
          var parsed = null;
          try { parsed = JSON.parse(req.result.json); } catch (e) {
            reject(new Error('Project bi hong (JSON loi)')); return;
          }
          if (!load(parsed)) { reject(new Error('Project sai schema v1')); return; }
          resolve(_project);
        };
        req.onerror = function () { reject(req.error || new Error('Doc project that bai')); };
      });
    });
  }

  function listProjects() {
    return _openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).getAll();
        req.onsuccess = function () {
          var rows = req.result || [];
          rows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
          resolve(rows.map(function (r) { return { name: r.name, updatedAt: r.updatedAt || 0 }; }));
        };
        req.onerror = function () { reject(req.error || new Error('Liet ke project that bai')); };
      });
    });
  }

  // --- Prefs: localStorage (guard khi chạy Node test) ---
  function loadPrefs() {
    try {
      if (typeof localStorage === 'undefined') return {};
      var raw = localStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function savePrefs(prefs) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs || {}));
      return true;
    } catch (e) { return false; }
  }

  // --- Hook thông báo thay đổi (UI/Viewport đăng ký trong init) ---
  var _listeners = [];
  function onChange(fn) {
    if (typeof fn === 'function') _listeners.push(fn);
  }
  function _notify() {
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](_project, _selectedId); } catch (e) { /* không để UI lỗi làm chết core */ }
    }
  }

  return {
    DB_NAME: DB_NAME, PREFS_KEY: PREFS_KEY, MAX_HISTORY: MAX_HISTORY,
    newProject: newProject, getProject: getProject,
    serialize: serialize, load: load,
    addObject: addObject, removeObject: removeObject,
    getObject: getObject, listObjects: listObjects,
    select: select, selectedId: selectedId, selectedObject: selectedObject,
    selectMany: selectMany, addToSelection: addToSelection,
    removeFromSelection: removeFromSelection, clearSelection: clearSelection,
    getSelectedIds: getSelectedIds, getSelectedObjects: getSelectedObjects,
    categoryForType: categoryForType, syncNpcObject: syncNpcObject,
    pushHistory: pushHistory, undo: undo, redo: redo,
    canUndo: canUndo, canRedo: canRedo,
    markDirty: markDirty, isDirty: isDirty, clearDirty: clearDirty,
    saveProject: saveProject, loadProject: loadProject, listProjects: listProjects,
    loadPrefs: loadPrefs, savePrefs: savePrefs,
    onChange: onChange
  };
})();
