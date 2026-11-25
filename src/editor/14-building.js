/* ============================================================================
   Map Editor — 14-building.js (đợt 2, MODULAR BUILDING EDITOR)
   ED.Building — nhà lắp ghép từ part primitive (đăng ký ở 03-assets.js):
   gộp nhiều part thành "toà nhà" (parent = 'bldg:<n>', KHÔNG tạo object
   giả trong scene), lưu/đặt lại nguyên toà nhà qua Prefab
   (project.prefabs, pos tương đối so với tâm nhà).
   Snap 0.5: mọi vị trí đặt/dời part snap lưới 0.5 (khớp _snapGrid của
   viewport); mái snap thêm độ cao theo đỉnh tường gần nhất (bán kính 2);
   part đặt lần đầu: y = Terrain.heightAt - 0.05 (trừ mái: y = đỉnh tường
   gần nhất, không có tường thì y = 0).
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo trong init(). Logic thuần (snap, tâm nhà, prefab
   serialize/deserialize) không phụ thuộc DOM/THREE, test được bằng vm.
   Project cũ không có project.buildings/project.prefabs vẫn mở được
   (ensureLists tự mặc định [] khi đọc).
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Building = (function () {
  'use strict';

  var SNAP_STEP = 0.5;
  var ROOF_SEARCH_RADIUS = 2; // "2 ô" = 2 đơn vị (lưới viewport 1 ô = 1 đơn vị)
  var GROUND_SINK = 0.05;
  var WALL_HEIGHT = 2.4; // chiều cao tường chuẩn (builder 'wall': 3 × 2.4 × 0.3)

  var PART_TYPES = ['roof-curved', 'roof-flat', 'roof-tower', 'wall', 'window',
    'door', 'stairs', 'balcony', 'pillar', 'pillar-square'];
  var ROOF_TYPES = ['roof-curved', 'roof-flat', 'roof-tower'];
  /* Màu mặc định cho từng part (viewport tô lại mesh theo obj.color nên
     part phải có màu đúng ngay lúc tạo, thay vì xám #9aa0a6 mặc định). */
  var PART_DEFAULT_COLOR = {
    'roof-curved': '#7f1d1d', 'roof-flat': '#7f1d1d', 'roof-tower': '#7a5238',
    'wall': '#d8d1c2', 'window': '#3b2414', 'door': '#8b2f2f',
    'stairs': '#8b9793', 'balcony': '#3b2414', 'pillar': '#3b2414',
    'pillar-square': '#8b9793'
  };

  function isPartType(t) { return PART_TYPES.indexOf(t) >= 0; }
  function isRoofType(t) { return ROOF_TYPES.indexOf(t) >= 0; }

  /* ---- Logic thuần: snap / mái / tâm nhà / prefab. ---- */
  function edBuildSnap(v, step) {
    step = (typeof step === 'number' && isFinite(step) && step > 0) ? step : SNAP_STEP;
    v = Number(v);
    if (!isFinite(v)) return 0;
    var s = Math.round(v / step) * step;
    return s === 0 ? 0 : s; // tránh -0
  }
  function snapXZ(pos, step) {
    return [edBuildSnap(pos[0], step), pos[1], edBuildSnap(pos[2], step)];
  }
  /* Đỉnh tường = y chân + chiều cao tường × scale.y. */
  function wallTopY(obj) {
    var sy = (obj.scale && isFinite(obj.scale[1])) ? obj.scale[1] : 1;
    return obj.pos[1] + WALL_HEIGHT * sy;
  }
  /* Tường type 'wall' gần nhất trong bán kính radius (mặt phẳng xz):
     trả về đỉnh tường cao nhất trong số đó, hoặc null nếu không có. */
  function nearestWallTop(objects, x, z, radius) {
    if (!objects) return null;
    radius = (typeof radius === 'number' && radius > 0) ? radius : ROOF_SEARCH_RADIUS;
    var best = null;
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (!o || o.type !== 'wall' || !o.pos) continue;
      var d = Math.hypot(o.pos[0] - x, o.pos[2] - z);
      if (d > radius) continue;
      var top = wallTopY(o);
      if (best === null || top > best) best = top;
    }
    return best;
  }
  /* Độ cao đặt mái: đỉnh tường gần nhất (snap 0.5), không có tường thì 0. */
  function roofSnapY(objects, x, z) {
    var top = nearestWallTop(objects, x, z, ROOF_SEARCH_RADIUS);
    return top === null ? 0 : edBuildSnap(top, SNAP_STEP);
  }
  /* y đặt part lần đầu: cao độ đất - 0.05 (chân chìm nhẹ). heightAtFn
     null (không có Terrain) -> 0. Thuần, test được. */
  function groundYFor(x, z, heightAtFn) {
    if (typeof heightAtFn !== 'function') return 0;
    var h = heightAtFn(x, z);
    return isFinite(h) ? h - GROUND_SINK : 0;
  }
  function groundY(x, z) {
    var fn = (ED.Terrain && typeof ED.Terrain.heightAt === 'function')
      ? function (ax, az) { return ED.Terrain.heightAt(ax, az); } : null;
    return groundYFor(x, z, fn);
  }
  function placeYFor(type, objects, x, z) {
    return isRoofType(type) ? roofSnapY(objects, x, z) : groundY(x, z);
  }

  /* project.buildings / project.prefabs: project cũ không có thì []. */
  function ensureLists(project) {
    if (!project) return null;
    if (!Array.isArray(project.buildings)) project.buildings = [];
    if (!Array.isArray(project.prefabs)) project.prefabs = [];
    return project;
  }
  function listBuildings(project) {
    ensureLists(project);
    return project ? project.buildings : [];
  }
  function listPrefabs(project) {
    ensureLists(project);
    return project ? project.prefabs : [];
  }
  function _nextNum(list, prefix) {
    var max = 0;
    for (var i = 0; i < list.length; i++) {
      var m = new RegExp('^' + prefix + ':(\\d+)$').exec(list[i].id || '');
      if (m && +m[1] > max) max = +m[1];
    }
    return max + 1;
  }
  function nextGroupId(project) {
    return 'bldg:' + _nextNum(listBuildings(project), 'bldg');
  }
  function nextPrefabId(project) {
    return 'prefab:' + _nextNum(listPrefabs(project), 'prefab');
  }
  function findBuilding(project, id) {
    var list = listBuildings(project);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function findPrefab(project, id) {
    var list = listPrefabs(project);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* Tâm nhà: trung bình x/z, y = y thấp nhất (đáy nhà) — để khi đặt
     prefab xuống đất, relY >= 0 và đáy nhà chạm đất. */
  function buildingCenter(objects) {
    var sx = 0, sz = 0, minY = null, n = 0;
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (!o || !o.pos) continue;
      sx += o.pos[0]; sz += o.pos[2];
      if (minY === null || o.pos[1] < minY) minY = o.pos[1];
      n++;
    }
    if (!n) return { x: 0, y: 0, z: 0 };
    return { x: sx / n, y: minY, z: sz / n };
  }
  /* Object -> part prefab (pos tương đối so với tâm). Thuần. */
  function partsToPrefabParts(objects, center) {
    center = center || buildingCenter(objects);
    var out = [];
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (!o || !o.pos) continue;
      out.push({
        type: o.type,
        pos: [o.pos[0] - center.x, o.pos[1] - center.y, o.pos[2] - center.z],
        rot: (o.rot || [0, 0, 0]).slice(),
        scale: (o.scale || [1, 1, 1]).slice(),
        color: o.color || PART_DEFAULT_COLOR[o.type] || '#d8d1c2',
        material: o.material ? JSON.parse(JSON.stringify(o.material)) : { roughness: 0.8, metalness: 0, opacity: 1 }
      });
    }
    return out;
  }
  /* Part prefab -> def cho ED.Core.addObject tại (cx, baseY, cz). Thuần. */
  function prefabToDefs(prefab, cx, cz, baseY) {
    var defs = [];
    var parts = (prefab && prefab.parts) || [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p || !p.pos) continue;
      defs.push({
        type: p.type, category: 'Buildings',
        name: (ED.Assets && typeof ED.Assets.defOf === 'function' && ED.Assets.defOf(p.type))
          ? ED.Assets.defOf(p.type).name : p.type,
        pos: [edBuildSnap(cx + p.pos[0], SNAP_STEP), baseY + p.pos[1], edBuildSnap(cz + p.pos[2], SNAP_STEP)],
        rot: (p.rot || [0, 0, 0]).slice(),
        scale: (p.scale || [1, 1, 1]).slice(),
        color: p.color || PART_DEFAULT_COLOR[p.type] || '#d8d1c2',
        material: p.material ? JSON.parse(JSON.stringify(p.material)) : { roughness: 0.8, metalness: 0, opacity: 1 }
      });
    }
    return defs;
  }
  function validName(name, fallback) {
    name = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
    if (!name) return fallback;
    return name.slice(0, 40);
  }

  /* ---- State runtime (chỉ dùng trong init/hàm chạy). ---- */
  var _panel = null, _pickEl = null, _bldgEl = null, _prefabEl = null;
  var _modeBtn = null, _nameInput = null, _renameInput = null;
  var _groupMode = false;
  var _pickSet = []; // id các part đang chọn để gộp
  var _selectedBuildingId = null;
  var _selectedPrefabId = null;
  var _wrapped = false;
  var _lastProject = null;

  function _project() {
    return (ED.Core && typeof ED.Core.getProject === 'function') ? ED.Core.getProject() : null;
  }
  function _toast(msg) {
    if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg);
  }
  function _pushHistory(label) {
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(label);
  }
  function _sync(obj) {
    if (obj && ED.Viewport && typeof ED.Viewport.syncObject === 'function') {
      try { ED.Viewport.syncObject(obj); } catch (e) {}
    }
  }
  function _refreshUI() {
    if (ED.UI) {
      if (typeof ED.UI.refreshHierarchy === 'function') { try { ED.UI.refreshHierarchy(); } catch (e) {} }
      if (typeof ED.UI.refreshInspector === 'function') { try { ED.UI.refreshInspector(); } catch (e) {} }
    }
  }
  function _partObjects() {
    if (!ED.Core || typeof ED.Core.listObjects !== 'function') return [];
    return ED.Core.listObjects().filter(function (o) { return o && isPartType(o.type); });
  }
  function _objects() {
    return (ED.Core && typeof ED.Core.listObjects === 'function') ? ED.Core.listObjects() : [];
  }

  /* Bọc ED.Assets.addObjectAt để kéo-thả / nút ➕ Thêm trong Asset Library
     cũng snap 0.5 + snap-to-ground / snap mái + tô màu mặc định cho part.
     Chỉ bọc 1 lần; type không phải part thì gọi nguyên bản. */
  function wrapAddObjectAt() {
    if (_wrapped) return true;
    if (!ED.Assets || typeof ED.Assets.addObjectAt !== 'function') return false;
    var orig = ED.Assets.addObjectAt;
    ED.Assets.addObjectAt = function (type, x, y, z) {
      if (!isPartType(type)) return orig.call(ED.Assets, type, x, y, z);
      x = edBuildSnap(x, SNAP_STEP);
      z = edBuildSnap(z, SNAP_STEP);
      if (y == null) y = placeYFor(type, _objects(), x, z);
      var obj = orig.call(ED.Assets, type, x, y, z);
      if (obj && (obj.color === '#9aa0a6' || !obj.color)) {
        obj.color = PART_DEFAULT_COLOR[type] || '#d8d1c2';
        _sync(obj);
      }
      return obj;
    };
    _wrapped = true;
    return true;
  }

  /* Đặt 1 part: snap x/z 0.5, y theo mái/đất. Không tọa độ -> trước camera. */
  function placePart(type, x, z) {
    if (!isPartType(type)) return null;
    x = edBuildSnap(x, SNAP_STEP);
    z = edBuildSnap(z, SNAP_STEP);
    var y = placeYFor(type, _objects(), x, z);
    if (ED.Assets && typeof ED.Assets.addObjectAt === 'function') {
      return ED.Assets.addObjectAt(type, x, y, z);
    }
    if (!ED.Core || typeof ED.Core.addObject !== 'function') return null;
    var obj = ED.Core.addObject({
      type: type, category: 'Buildings',
      name: (ED.Assets && typeof ED.Assets.defOf === 'function' && ED.Assets.defOf(type))
        ? ED.Assets.defOf(type).name : type,
      pos: [x, y, z], rot: [0, 0, 0], scale: [1, 1, 1],
      color: PART_DEFAULT_COLOR[type] || '#d8d1c2'
    });
    _sync(obj);
    return obj;
  }
  function placePartAtCamera(type) {
    var p = null;
    if (ED.Assets && typeof ED.Assets.pointInFrontOfCamera === 'function') {
      try { p = ED.Assets.pointInFrontOfCamera(6); } catch (e) { p = null; }
    }
    if (!p && ED.Viewport && typeof ED.Viewport.getCameraFront === 'function') {
      try {
        var f = ED.Viewport.getCameraFront(6);
        if (f) p = { x: f[0], z: f[1] };
      } catch (e) { p = null; }
    }
    if (!p) p = { x: 0, z: 0 };
    return placePart(type, p.x, p.z);
  }

  /* ---- Chọn part để gộp (chế độ gộp nhà). ---- */
  function setGroupMode(on) {
    _groupMode = !!on;
    if (!_groupMode) _pickSet = [];
    if (_modeBtn) {
      _modeBtn.textContent = _groupMode ? '🧲 Chế độ gộp nhà: Bật' : '🧲 Chế độ gộp nhà: Tắt';
      if (_modeBtn.classList) _modeBtn.classList.toggle('active', _groupMode);
    }
    _render();
    return _groupMode;
  }
  function isGroupMode() { return _groupMode; }
  function addPicked(id) {
    var obj = ED.Core && typeof ED.Core.getObject === 'function' ? ED.Core.getObject(id) : null;
    if (!obj || !isPartType(obj.type)) return false;
    if (_pickSet.indexOf(id) < 0) _pickSet.push(id);
    _render();
    return true;
  }
  function removePicked(id) {
    var i = _pickSet.indexOf(id);
    if (i < 0) return false;
    _pickSet.splice(i, 1);
    _render();
    return true;
  }
  function clearPick() { _pickSet = []; _render(); }
  function getPickSet() { return _pickSet.slice(); }

  /* Gộp các part đang chọn thành 1 toà nhà (parent = 'bldg:<n>'). */
  function groupPicked(name) {
    var project = _project();
    if (!project) { _toast('Chưa có project nào.'); return null; }
    var objs = [];
    for (var i = 0; i < _pickSet.length; i++) {
      var o = ED.Core.getObject(_pickSet[i]);
      if (o && isPartType(o.type)) objs.push(o);
    }
    if (!objs.length) { _toast('Chưa chọn part nào — bật chế độ gộp nhà rồi bấm từng part.'); return null; }
    ensureLists(project);
    var n = project.buildings.length + 1;
    var bldgName = validName(name, 'Nhà ' + n);
    var id = nextGroupId(project);
    _pushHistory('Gộp nhà ' + bldgName);
    var ids = [];
    objs.forEach(function (o) {
      o.parent = id;
      ids.push(o.id);
      _sync(o);
    });
    project.buildings.push({ id: id, name: bldgName, parts: ids });
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    _selectedBuildingId = id;
    _pickSet = [];
    _setGroupModeSilent(false);
    _render();
    _refreshUI();
    _toast('Đã gộp ' + ids.length + ' part thành ' + bldgName);
    return { id: id, name: bldgName, parts: ids };
  }
  function _setGroupModeSilent(on) {
    _groupMode = !!on;
    if (_modeBtn) {
      _modeBtn.textContent = _groupMode ? '🧲 Chế độ gộp nhà: Bật' : '🧲 Chế độ gộp nhà: Tắt';
      if (_modeBtn.classList) _modeBtn.classList.toggle('active', _groupMode);
    }
  }
  function ungroupBuilding(id) {
    var project = _project();
    if (!project) return false;
    var b = findBuilding(project, id);
    if (!b) return false;
    _pushHistory('Rã nhà ' + b.name);
    (b.parts || []).forEach(function (pid) {
      var o = ED.Core.getObject(pid);
      if (o && o.parent === id) { o.parent = null; _sync(o); }
    });
    var list = listBuildings(project);
    list.splice(list.indexOf(b), 1);
    if (_selectedBuildingId === id) _selectedBuildingId = null;
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    _render();
    _refreshUI();
    _toast('Đã rã ' + b.name);
    return true;
  }
  function selectBuilding(id) {
    var project = _project();
    var b = project ? findBuilding(project, id) : null;
    if (!b) return false;
    _selectedBuildingId = id;
    if (b.parts && b.parts.length && ED.Core && typeof ED.Core.select === 'function') {
      ED.Core.select(b.parts[0]);
    }
    _render();
    return true;
  }

  /* ---- Prefab. ---- */
  function savePrefabFromBuilding(id, name) {
    var project = _project();
    if (!project) { _toast('Chưa có project nào.'); return null; }
    var b = findBuilding(project, id);
    if (!b) { _toast('Không tìm thấy toà nhà.'); return null; }
    var objs = [];
    (b.parts || []).forEach(function (pid) {
      var o = ED.Core.getObject(pid);
      if (o && isPartType(o.type)) objs.push(o);
    });
    if (!objs.length) { _toast('Toà nhà này không còn part nào.'); return null; }
    ensureLists(project);
    var center = buildingCenter(objs);
    var prefab = {
      id: nextPrefabId(project),
      name: validName(name, b.name),
      parts: partsToPrefabParts(objs, center)
    };
    _pushHistory('Lưu prefab ' + prefab.name);
    project.prefabs.push(prefab);
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    _selectedPrefabId = prefab.id;
    _render();
    _toast('Đã lưu prefab ' + prefab.name + ' (' + prefab.parts.length + ' part)');
    return prefab;
  }
  function placePrefab(id) {
    var project = _project();
    if (!project) { _toast('Chưa có project nào.'); return null; }
    var prefab = findPrefab(project, id);
    if (!prefab || !prefab.parts || !prefab.parts.length) {
      _toast('Prefab này trống, không đặt được.');
      return null;
    }
    var p = null;
    if (ED.Assets && typeof ED.Assets.pointInFrontOfCamera === 'function') {
      try { p = ED.Assets.pointInFrontOfCamera(6); } catch (e) { p = null; }
    }
    if (!p && ED.Viewport && typeof ED.Viewport.getCameraFront === 'function') {
      try {
        var f = ED.Viewport.getCameraFront(6);
        if (f) p = { x: f[0], z: f[1] };
      } catch (e) { p = null; }
    }
    if (!p) p = { x: 0, z: 0 };
    var cx = edBuildSnap(p.x, SNAP_STEP);
    var cz = edBuildSnap(p.z, SNAP_STEP);
    var baseY = groundY(cx, cz);
    ensureLists(project);
    var groupId = nextGroupId(project);
    _pushHistory('Đặt prefab ' + prefab.name);
    var defs = prefabToDefs(prefab, cx, cz, baseY);
    var ids = [];
    defs.forEach(function (def) {
      def.parent = groupId;
      var obj = ED.Core.addObject(def);
      if (obj) { ids.push(obj.id); _sync(obj); }
    });
    project.buildings.push({ id: groupId, name: prefab.name, parts: ids });
    _selectedBuildingId = groupId;
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    _render();
    _refreshUI();
    _toast('Đã đặt ' + prefab.name + ' (' + ids.length + ' part)');
    return { id: groupId, name: prefab.name, parts: ids };
  }
  function renamePrefab(id, name) {
    var project = _project();
    var pf = project ? findPrefab(project, id) : null;
    if (!pf) return false;
    var nm = validName(name, '');
    if (!nm) { _toast('Tên prefab không được để trống.'); return false; }
    _pushHistory('Đổi tên prefab');
    pf.name = nm;
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    _render();
    return true;
  }
  function deletePrefab(id) {
    var project = _project();
    if (!project) return false;
    var pf = findPrefab(project, id);
    if (!pf) return false;
    _pushHistory('Xoá prefab ' + pf.name);
    var list = listPrefabs(project);
    list.splice(list.indexOf(pf), 1);
    if (_selectedPrefabId === id) _selectedPrefabId = null;
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    _render();
    _toast('Đã xoá prefab ' + pf.name);
    return true;
  }
  function selectPrefab(id) {
    _selectedPrefabId = id;
    _render();
    return true;
  }

  /* ---- Nudge part đang chọn theo lưới 0.5 (mái tự snap lại theo tường). ---- */
  function nudgeSelected(dx, dz, dy) {
    var obj = (ED.Core && typeof ED.Core.selectedObject === 'function')
      ? ED.Core.selectedObject() : null;
    if (!obj) { _toast('Chưa chọn object nào.'); return false; }
    if (!isPartType(obj.type)) { _toast('Chọn 1 part nhà trước (tường, mái, cửa…).'); return false; }
    _pushHistory('Dời part ' + obj.name);
    var nx = edBuildSnap(obj.pos[0] + (dx || 0), SNAP_STEP);
    var nz = edBuildSnap(obj.pos[2] + (dz || 0), SNAP_STEP);
    obj.pos[0] = nx;
    obj.pos[2] = nz;
    if (isRoofType(obj.type) && (dx || dz)) {
      obj.pos[1] = roofSnapY(_objects(), nx, nz);
    } else if (dy) {
      obj.pos[1] = edBuildSnap(obj.pos[1] + dy, SNAP_STEP);
    }
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    _sync(obj);
    _refreshUI();
    return true;
  }

  /* ---- Panel UI (tự tạo DOM, không sửa 02-ui.js). ---- */
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _bind(id, fn) {
    var el = _panel ? _panel.querySelector(id) : null;
    if (el) el.addEventListener('click', fn);
    return el;
  }
  function _render() {
    if (!_panel || typeof document === 'undefined') return;
    /* Danh sách part đang chọn để gộp. */
    if (_pickEl) {
      var h = '';
      if (!_pickSet.length) {
        h = '<div class="ed-bldg-empty">Chưa chọn part nào.</div>';
      } else {
        _pickSet.forEach(function (pid) {
          var o = ED.Core.getObject(pid);
          var nm = o ? o.name : pid;
          h += '<div class="ed-bldg-item"><span class="ed-bldg-name">' + _esc(nm) + '</span>' +
            '<button data-unpick="' + _esc(pid) + '" title="Bỏ part này">✕</button></div>';
        });
      }
      _pickEl.innerHTML = h;
      var unpicks = _pickEl.querySelectorAll('[data-unpick]');
      for (var i = 0; i < unpicks.length; i++) {
        (function (btn) {
          btn.addEventListener('click', function () { removePicked(btn.getAttribute('data-unpick')); });
        })(unpicks[i]);
      }
    }
    /* Toà nhà đã gộp. */
    if (_bldgEl) {
      var project = _project();
      var list = project ? listBuildings(project) : [];
      var hb = '';
      if (!list.length) {
        hb = '<div class="ed-bldg-empty">Chưa có nhà nào. Bật chế độ gộp nhà, bấm từng part rồi bấm “Gộp thành nhà”.</div>';
      } else {
        list.forEach(function (b) {
          var n = (b.parts || []).length;
          hb += '<div class="ed-bldg-item' + (_selectedBuildingId === b.id ? ' selected' : '') + '">' +
            '<span class="ed-bldg-name">' + _esc(b.name) + '</span>' +
            '<span class="ed-bldg-count">' + n + ' part</span>' +
            '<button data-bsel="' + _esc(b.id) + '" title="Chọn toà nhà">Chọn</button>' +
            '<button data-bprefab="' + _esc(b.id) + '" title="Lưu thành prefab">💾 Prefab</button>' +
            '<button data-bungroup="' + _esc(b.id) + '" title="Rã nhà">Rã</button></div>';
        });
      }
      _bldgEl.innerHTML = hb;
      var sels = _bldgEl.querySelectorAll('[data-bsel]');
      for (var j = 0; j < sels.length; j++) {
        (function (btn) { btn.addEventListener('click', function () { selectBuilding(btn.getAttribute('data-bsel')); }); })(sels[j]);
      }
      var pfs = _bldgEl.querySelectorAll('[data-bprefab]');
      for (var k = 0; k < pfs.length; k++) {
        (function (btn) { btn.addEventListener('click', function () { savePrefabFromBuilding(btn.getAttribute('data-bprefab')); }); })(pfs[k]);
      }
      var ungs = _bldgEl.querySelectorAll('[data-bungroup]');
      for (var m = 0; m < ungs.length; m++) {
        (function (btn) { btn.addEventListener('click', function () { ungroupBuilding(btn.getAttribute('data-bungroup')); }); })(ungs[m]);
      }
    }
    /* Prefab nhà. */
    if (_prefabEl) {
      var project2 = _project();
      var pfs2 = project2 ? listPrefabs(project2) : [];
      var hp = '';
      if (!pfs2.length) {
        hp = '<div class="ed-bldg-empty">Chưa có prefab nào. Gộp 1 toà nhà rồi bấm “💾 Prefab”.</div>';
      } else {
        pfs2.forEach(function (pf) {
          var n2 = (pf.parts || []).length;
          hp += '<div class="ed-bldg-item' + (_selectedPrefabId === pf.id ? ' selected' : '') + '">' +
            '<span class="ed-bldg-name">' + _esc(pf.name) + '</span>' +
            '<span class="ed-bldg-count">' + n2 + ' part</span>' +
            '<button data-psel="' + _esc(pf.id) + '" title="Chọn prefab">Chọn</button>' +
            '<button data-pplace="' + _esc(pf.id) + '" title="Đặt nguyên toà nhà trước camera">🏠 Đặt xuống</button>' +
            '<button data-pdel="' + _esc(pf.id) + '" title="Xoá prefab">✕</button></div>';
        });
      }
      _prefabEl.innerHTML = hp;
      var ps = _prefabEl.querySelectorAll('[data-psel]');
      for (var a = 0; a < ps.length; a++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            selectPrefab(btn.getAttribute('data-psel'));
            var pf = findPrefab(_project(), btn.getAttribute('data-psel'));
            if (pf && _renameInput) _renameInput.value = pf.name;
          });
        })(ps[a]);
      }
      var pp = _prefabEl.querySelectorAll('[data-pplace]');
      for (var b2 = 0; b2 < pp.length; b2++) {
        (function (btn) { btn.addEventListener('click', function () { placePrefab(btn.getAttribute('data-pplace')); }); })(pp[b2]);
      }
      var pd = _prefabEl.querySelectorAll('[data-pdel]');
      for (var c = 0; c < pd.length; c++) {
        (function (btn) { btn.addEventListener('click', function () { deletePrefab(btn.getAttribute('data-pdel')); }); })(pd[c]);
      }
    }
  }

  function init() {
    wrapAddObjectAt();
    /* Theo dõi project/selection: chế độ gộp nhà thì mỗi lần chọn 1 part
       sẽ thêm part đó vào danh sách gộp; project khác (mở/load) thì vẽ
       lại danh sách nhà + prefab. */
    if (ED.Core && typeof ED.Core.onChange === 'function') {
      ED.Core.onChange(function (project, selectedId) {
        if (project && project !== _lastProject) {
          _lastProject = project;
          _render();
        }
        if (_groupMode && selectedId) {
          var o = ED.Core.getObject(selectedId);
          if (o && isPartType(o.type) && _pickSet.indexOf(selectedId) < 0) {
            _pickSet.push(selectedId);
            _render();
          }
        }
      });
    }
    if (typeof document === 'undefined') return;
    var host = document.getElementById('asset-library');
    _panel = document.createElement('div');
    _panel.id = 'building-panel';
    _panel.innerHTML =
      '<div class="ed-bldg-title">🏠 Nhà lắp ghép</div>' +
      '<div class="ed-bldg-hint">Part nhà ở mục Buildings trong Asset Library (kéo-thả hoặc bấm ➕ Thêm). Gộp nhiều part thành 1 toà nhà rồi lưu làm prefab để đặt lại.</div>' +
      '<button id="ed-bldg-mode">🧲 Chế độ gộp nhà: Tắt</button>' +
      '<div class="ed-bldg-row"><input id="ed-bldg-name" type="text" maxlength="40" placeholder="Tên nhà… (vd Nhà gỗ)">' +
      '<button id="ed-bldg-group">🏠 Gộp thành nhà</button></div>' +
      '<div class="ed-bldg-row"><button id="ed-bldg-add-sel">＋ Thêm part đang chọn</button>' +
      '<button id="ed-bldg-clear-pick">✕ Xoá chọn</button></div>' +
      '<div id="ed-bldg-pick" class="ed-bldg-list"></div>' +
      '<div class="ed-bldg-sub">Di chuyển part đang chọn (0.5)</div>' +
      '<div class="ed-bldg-nudge">' +
      '<button data-nudge="0,-0.5,0" title="Dời ra xa 0.5">▲</button>' +
      '<button data-nudge="-0.5,0,0" title="Dời sang trái 0.5">◀</button>' +
      '<button data-nudge="0.5,0,0" title="Dời sang phải 0.5">▶</button>' +
      '<button data-nudge="0,0.5,0" title="Dời lại gần 0.5">▼</button>' +
      '<button data-nudge="0,0,0.5" title="Nâng lên 0.5">⬆ Cao</button>' +
      '<button data-nudge="0,0,-0.5" title="Hạ xuống 0.5">⬇ Thấp</button>' +
      '</div>' +
      '<div class="ed-bldg-sub">Toà nhà đã gộp</div>' +
      '<div id="ed-bldg-list" class="ed-bldg-list"></div>' +
      '<div class="ed-bldg-sub">Prefab nhà</div>' +
      '<div class="ed-bldg-row"><input id="ed-bldg-rename" type="text" maxlength="40" placeholder="Tên prefab mới…">' +
      '<button id="ed-bldg-rename-btn">✏️ Đổi tên</button></div>' +
      '<div id="ed-bldg-prefabs" class="ed-bldg-list"></div>';
    if (host) {
      var anchor = document.getElementById('asset-list');
      if (anchor && anchor.parentNode === host) host.insertBefore(_panel, anchor.nextSibling);
      else host.appendChild(_panel);
    } else {
      document.body.appendChild(_panel);
    }
    _pickEl = _panel.querySelector('#ed-bldg-pick');
    _bldgEl = _panel.querySelector('#ed-bldg-list');
    _prefabEl = _panel.querySelector('#ed-bldg-prefabs');
    _modeBtn = _panel.querySelector('#ed-bldg-mode');
    _nameInput = _panel.querySelector('#ed-bldg-name');
    _renameInput = _panel.querySelector('#ed-bldg-rename');
    _bind('#ed-bldg-mode', function () { setGroupMode(!_groupMode); });
    _bind('#ed-bldg-group', function () {
      groupPicked(_nameInput ? _nameInput.value : '');
      if (_nameInput) _nameInput.value = '';
    });
    _bind('#ed-bldg-add-sel', function () {
      var sel = (ED.Core && typeof ED.Core.selectedId === 'function') ? ED.Core.selectedId() : null;
      if (!sel) { _toast('Chưa chọn part nào trong viewport.'); return; }
      if (!addPicked(sel)) _toast('Chỉ gộp được part nhà (tường, mái, cửa…).');
    });
    _bind('#ed-bldg-clear-pick', function () { clearPick(); });
    _bind('#ed-bldg-rename-btn', function () {
      if (!_selectedPrefabId) { _toast('Chọn 1 prefab trong danh sách trước.'); return; }
      renamePrefab(_selectedPrefabId, _renameInput ? _renameInput.value : '');
    });
    var nudges = _panel.querySelectorAll('[data-nudge]');
    for (var i = 0; i < nudges.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var parts = btn.getAttribute('data-nudge').split(',');
          nudgeSelected(Number(parts[0]), Number(parts[1]), Number(parts[2]));
        });
      })(nudges[i]);
    }
    _lastProject = _project();
    _render();
  }

  return {
    SNAP_STEP: SNAP_STEP, ROOF_SEARCH_RADIUS: ROOF_SEARCH_RADIUS,
    GROUND_SINK: GROUND_SINK, WALL_HEIGHT: WALL_HEIGHT,
    PART_TYPES: PART_TYPES, ROOF_TYPES: ROOF_TYPES,
    PART_DEFAULT_COLOR: PART_DEFAULT_COLOR,
    isPartType: isPartType, isRoofType: isRoofType,
    edBuildSnap: edBuildSnap, snapXZ: snapXZ,
    wallTopY: wallTopY, nearestWallTop: nearestWallTop, roofSnapY: roofSnapY,
    groundYFor: groundYFor, groundY: groundY, placeYFor: placeYFor,
    ensureLists: ensureLists, listBuildings: listBuildings, listPrefabs: listPrefabs,
    nextGroupId: nextGroupId, nextPrefabId: nextPrefabId,
    findBuilding: findBuilding, findPrefab: findPrefab,
    buildingCenter: buildingCenter,
    partsToPrefabParts: partsToPrefabParts, prefabToDefs: prefabToDefs,
    wrapAddObjectAt: wrapAddObjectAt,
    placePart: placePart, placePartAtCamera: placePartAtCamera,
    setGroupMode: setGroupMode, isGroupMode: isGroupMode,
    addPicked: addPicked, removePicked: removePicked, clearPick: clearPick,
    getPickSet: getPickSet, groupPicked: groupPicked,
    ungroupBuilding: ungroupBuilding, selectBuilding: selectBuilding,
    savePrefabFromBuilding: savePrefabFromBuilding, placePrefab: placePrefab,
    renamePrefab: renamePrefab, deletePrefab: deletePrefab, selectPrefab: selectPrefab,
    nudgeSelected: nudgeSelected, render: _render, init: init
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
