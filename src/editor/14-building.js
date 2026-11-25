/* ============================================================================
   Map Editor — 14-building.js (đợt 2, MODULAR BUILDING EDITOR; đợt 4: CHI
   TIẾT PART — mái/tường/cửa có tham số, builder dựng lại mesh từ tham số)
   ED.Building — nhà lắp ghép từ part primitive (đăng ký ở 03-assets.js):
   gộp nhiều part thành "toà nhà" (parent = 'bldg:<n>', KHÔNG tạo object
   giả trong scene), lưu/đặt lại nguyên toà nhà qua Prefab
   (project.prefabs, pos tương đối so với tâm nhà).
   Snap 0.5: mọi vị trí đặt/dời part snap lưới 0.5 (khớp _snapGrid của
   viewport); mái snap thêm độ cao theo đỉnh tường gần nhất (bán kính 2);
   part đặt lần đầu: y = Terrain.heightAt - 0.05 (trừ mái: y = đỉnh tường
   gần nhất, không có tường thì y = 0).
   Đợt 4 — tham số chi tiết (lưu ở obj.extra.buildingParams, JSON thuần):
   mái {curvature 0-1, slope 0.5-2, tileColor {front,back,left,right}},
   tường {height 1-6, thickness 0.1-1, color}, cửa {height 1-3.5,
   width 0.6-2}. Builder mái/tường/cửa trong file này DỰNG LẠI mesh từ
   tham số (mái = 4 mặt tam giác riêng màu, không chỉ scale mesh cũ);
   init() bọc ED.Assets.buildMesh để Viewport.syncObject() dùng builder
   này cho part nhà, và rebuildPartMesh() đổi con của group tại chỗ
   (giữ nguyên Group trong scene nên không mất chọn/gizmo).
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo trong init(). Logic thuần (snap, tâm nhà, prefab
   serialize/deserialize, tham số, hình học mái/tường/cửa) không phụ thuộc
   DOM/THREE, test được bằng vm.
   Project cũ không có project.buildings/project.prefabs vẫn mở được
   (ensureLists tự mặc định [] khi đọc); part cũ không có buildingParams
   dùng mặc định cũ (mái cong 0.5/dốc 1, tường 2.4×0.3, cửa 1.2×2.2).
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

  /* ---- Đợt 4: tham số chi tiết từng part (thuần, không DOM/THREE). ----
     Lưu ở obj.extra.buildingParams (JSON thuần nên serialize/load project
     và prefab giữ nguyên không cần code riêng). Part cũ không có field
     này -> getParams() trả mặc định cũ (backward compatible). */
  var ROOF_W = 3.6, ROOF_D = 2.6, ROOF_H = 1.0; // chân đế mái cong/bằng (khớp builder gốc 03-assets)
  var TILE_FACES = ['front', 'back', 'left', 'right'];

  function clampNum(v, min, max, def) {
    v = Number(v);
    if (!isFinite(v)) return def;
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }
  function isHexColor(s) {
    return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
  }
  function normColor(s, def) {
    if (isHexColor(s)) return s.toLowerCase();
    if (typeof s === 'string' && /^#[0-9a-fA-F]{3}$/.test(s)) {
      return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return def;
  }
  /* Part nào có tham số chi tiết đợt 4 (mái/tường/cửa). Các part khác
     (cửa sổ, cầu thang, ban công, cột) chưa có — UI ghi rõ, không vẽ
     slider giả. */
  function hasDetailParams(type) {
    return isRoofType(type) || type === 'wall' || type === 'door';
  }
  function defaultParams(type, obj) {
    var base = (obj && obj.color) || PART_DEFAULT_COLOR[type] || '#d8d1c2';
    if (isRoofType(type)) {
      return { curvature: 0.5, slope: 1,
        tileColor: { front: base, back: base, left: base, right: base } };
    }
    if (type === 'wall') return { height: WALL_HEIGHT, thickness: 0.3, color: base };
    if (type === 'door') return { height: 2.2, width: 1.2 };
    return null;
  }
  /* Tham số đã chuẩn hoá (kẹp miền + màu hợp lệ), không sửa obj. Trả
     null khi type không có tham số chi tiết. */
  function getParams(obj) {
    if (!obj || !hasDetailParams(obj.type)) return null;
    var def = defaultParams(obj.type, obj);
    var raw = (obj.extra && obj.extra.buildingParams) || {};
    if (isRoofType(obj.type)) {
      var tc = (raw.tileColor && typeof raw.tileColor === 'object') ? raw.tileColor : {};
      var out = { front: '', back: '', left: '', right: '' };
      for (var i = 0; i < TILE_FACES.length; i++) {
        var f = TILE_FACES[i];
        out[f] = normColor(tc[f], def.tileColor[f]);
      }
      return { curvature: clampNum(raw.curvature, 0, 1, 0.5),
        slope: clampNum(raw.slope, 0.5, 2, 1), tileColor: out };
    }
    if (obj.type === 'wall') {
      return { height: clampNum(raw.height, 1, 6, WALL_HEIGHT),
        thickness: clampNum(raw.thickness, 0.1, 1, 0.3),
        color: normColor(raw.color, def.color) };
    }
    return { height: clampNum(raw.height, 1, 3.5, 2.2),
      width: clampNum(raw.width, 0.6, 2, 1.2) };
  }
  /* Ghi 1 tham số (đã kẹp/chuẩn hoá) vào obj.extra.buildingParams.
     key 'tileColor' nhận object {front?,back?,left?,right?} để đổi từng
     mặt. Đổi màu tường thì đồng bộ obj.color (viewport tô lại mesh theo
     obj.color; màu ngói từng mặt được giữ nhờ keepColor, xem builder).
     Trả tham số đã chuẩn hoá sau khi ghi, hoặc null khi không áp được. */
  function setParam(obj, key, value) {
    if (!obj || !hasDetailParams(obj.type)) return null;
    if (!obj.extra || typeof obj.extra !== 'object') obj.extra = {};
    var cur = getParams(obj);
    if (key === 'tileColor' && value && typeof value === 'object') {
      for (var i = 0; i < TILE_FACES.length; i++) {
        var f = TILE_FACES[i];
        if (value[f] !== undefined) cur.tileColor[f] = normColor(value[f], cur.tileColor[f]);
      }
    } else if (key === 'curvature' && isRoofType(obj.type)) {
      cur.curvature = clampNum(value, 0, 1, cur.curvature);
    } else if (key === 'slope' && isRoofType(obj.type)) {
      cur.slope = clampNum(value, 0.5, 2, cur.slope);
    } else if (obj.type === 'wall' && key === 'height') {
      cur.height = clampNum(value, 1, 6, cur.height);
    } else if (obj.type === 'wall' && key === 'thickness') {
      cur.thickness = clampNum(value, 0.1, 1, cur.thickness);
    } else if (obj.type === 'wall' && key === 'color') {
      cur.color = normColor(value, cur.color);
      obj.color = cur.color;
    } else if (obj.type === 'door' && key === 'height') {
      cur.height = clampNum(value, 1, 3.5, cur.height);
    } else if (obj.type === 'door' && key === 'width') {
      cur.width = clampNum(value, 0.6, 2, cur.width);
    } else {
      return cur; // key lạ/không thuộc type này: không đổi gì
    }
    obj.extra.buildingParams = cur;
    return cur;
  }
  /* Gắn tham số mặc định cho part mới đặt (chưa có thì tạo). */
  function ensureParams(obj) {
    if (!obj || !hasDetailParams(obj.type)) return null;
    if (!obj.extra || typeof obj.extra !== 'object') obj.extra = {};
    if (!obj.extra.buildingParams) obj.extra.buildingParams = defaultParams(obj.type, obj);
    return getParams(obj);
  }

  /* ---- Hình học thuần của mái/tường/cửa (số thuần, test được). ---- */
  /* Cao độ mép mái (góc mái vểnh): cong 0 -> 0.12, cong 1 -> 0.47. */
  function eaveCornerY(curvature) {
    return 0.12 + clampNum(curvature, 0, 1, 0.5) * 0.35;
  }
  /* Mái chóp 4 mặt: đỉnh (0, apexH, 0) + 4 góc đáy ở cao độ cornerY.
     Mỗi mặt là 1 tam giác [đỉnh, góc1, góc2] — builder vẽ mỗi mặt 1 mesh
     riêng để tô màu ngói từng mặt. */
  function roofPyramidFaces(w, d, apexH, cornerY) {
    var hw = w / 2, hd = d / 2;
    var A = [0, apexH, 0];
    var FL = [-hw, cornerY, hd], FR = [hw, cornerY, hd];
    var BR = [hw, cornerY, -hd], BL = [-hw, cornerY, -hd];
    return {
      front: [A, FL, FR], back: [A, BR, BL],
      right: [A, FR, BR], left: [A, BL, FL]
    };
  }
  /* Mái bằng: slope nghiêng tấm mái (rad quanh trục x) + chênh gờ
     trước/sau; curvature nâng gờ chắn cả 4 phía. */
  function roofFlatGeom(params) {
    var parapet = 0.22 + clampNum(params.curvature, 0, 1, 0.5) * 0.25;
    var tilt = (clampNum(params.slope, 0.5, 2, 1) - 1) * 0.22;
    return {
      slabTilt: tilt,
      parapet: parapet,
      frontH: Math.max(0.05, parapet + (params.slope - 1) * 0.25),
      backH: Math.max(0.05, parapet - (params.slope - 1) * 0.25),
      sideH: parapet
    };
  }
  function wallDims(params) {
    return { w: 3, h: params.height, d: params.thickness };
  }
  function doorDims(params) {
    return { w: params.width, h: params.height,
      leafW: params.width - 0.24, leafH: params.height - 0.2 };
  }

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
  /* Đỉnh tường = y chân + chiều cao tường × scale.y. Tường đợt 4 có
     chiều cao riêng trong buildingParams (mặc định 2.4 như cũ). */
  function wallTopY(obj) {
    var sy = (obj.scale && isFinite(obj.scale[1])) ? obj.scale[1] : 1;
    var h = WALL_HEIGHT;
    var p = getParams(obj);
    if (p && typeof p.height === 'number') h = p.height;
    return obj.pos[1] + h * sy;
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
      var part = {
        type: o.type,
        pos: [o.pos[0] - center.x, o.pos[1] - center.y, o.pos[2] - center.z],
        rot: (o.rot || [0, 0, 0]).slice(),
        scale: (o.scale || [1, 1, 1]).slice(),
        color: o.color || PART_DEFAULT_COLOR[o.type] || '#d8d1c2',
        material: o.material ? JSON.parse(JSON.stringify(o.material)) : { roughness: 0.8, metalness: 0, opacity: 1 }
      };
      /* Đợt 4: giữ nguyên tham số chi tiết trong prefab (extra
         buildingParams) để đặt lại dựng đúng hình cũ. Part không có
         tham số thì không thêm field (prefab cũ vẫn đọc được). */
      if (o.extra && o.extra.buildingParams) {
        part.extra = { buildingParams: JSON.parse(JSON.stringify(o.extra.buildingParams)) };
      }
      out.push(part);
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
      var def = {
        type: p.type, category: 'Buildings',
        name: (ED.Assets && typeof ED.Assets.defOf === 'function' && ED.Assets.defOf(p.type))
          ? ED.Assets.defOf(p.type).name : p.type,
        pos: [edBuildSnap(cx + p.pos[0], SNAP_STEP), baseY + p.pos[1], edBuildSnap(cz + p.pos[2], SNAP_STEP)],
        rot: (p.rot || [0, 0, 0]).slice(),
        scale: (p.scale || [1, 1, 1]).slice(),
        color: p.color || PART_DEFAULT_COLOR[p.type] || '#d8d1c2',
        material: p.material ? JSON.parse(JSON.stringify(p.material)) : { roughness: 0.8, metalness: 0, opacity: 1 }
      };
      /* Đợt 4: trả lại tham số chi tiết vào object mới (Core.addObject
         giữ nguyên def.extra) để builder dựng đúng hình đã lưu. */
      if (p.extra) def.extra = JSON.parse(JSON.stringify(p.extra));
      defs.push(def);
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
  var _paramsEl = null; // panel chi tiết part đang chọn (đợt 4)
  var _paramHistArmed = false; // đã pushHistory cho lần kéo slider này chưa
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
      /* Đợt 4: part mới đặt có sẵn tham số mặc định để panel chi tiết
         hiện ngay và prefab sau này giữ đúng hình. */
      if (obj && hasDetailParams(type)) ensureParams(obj);
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
    var def = {
      type: type, category: 'Buildings',
      name: (ED.Assets && typeof ED.Assets.defOf === 'function' && ED.Assets.defOf(type))
        ? ED.Assets.defOf(type).name : type,
      pos: [x, y, z], rot: [0, 0, 0], scale: [1, 1, 1],
      color: PART_DEFAULT_COLOR[type] || '#d8d1c2'
    };
    /* Đợt 4: nhánh fallback (không có ED.Assets) cũng gắn tham số mặc định. */
    if (hasDetailParams(type)) def.extra = { buildingParams: defaultParams(type, def) };
    var obj = ED.Core.addObject(def);
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

  /* ---- Đợt 4: builder dựng lại mesh từ tham số (chỉ gọi lúc chạy,
     khi THREE đã có). KHÔNG sửa 03-assets.js: init() bọc
     ED.Assets.buildMesh để Viewport.syncObject() dùng builder này cho
     part mái/tường/cửa; type khác hoặc lỗi thì rơi về builder gốc.
     Mặt ngói từng mặt + gờ vàng/diềm gỗ đánh dấu keepColor để
     Viewport.syncObject() không tô đè bằng obj.color (nó tô mọi mesh
     không keepColor); thân tường/cánh cửa giữ nguyên cơ chế tô theo
     obj.color như builder gốc (màu tường đồng bộ obj.color ở setParam).
     Kích thước ở mặc định trùng builder gốc 03-assets (tường 3×2.4×0.3,
     cửa 1.2×2.2, mái 3.6×2.6 cao 1.0) nên project cũ mở ra không đổi hình;
     riêng mái cong đổi từ Cone 4 mặt sang 4 tam giác riêng (vẫn chóp 4
     mặt, thêm màu từng mặt + mép vểnh theo curvature). ---- */
  function _bMat(color, o) {
    o = o || {};
    var m = new THREE.MeshStandardMaterial({
      color: color, roughness: (o.roughness == null ? 0.8 : o.roughness),
      metalness: (o.metalness == null ? 0 : o.metalness),
      emissive: o.emissive || 0x000000,
      emissiveIntensity: (o.emissiveIntensity == null ? 0 : o.emissiveIntensity),
      transparent: !!o.transparent, opacity: (o.opacity == null ? 1 : o.opacity)
    });
    if (o.side !== undefined) m.side = o.side;
    m.userData.baseColor = String(color);
    return m;
  }
  function _bBox(w, h, d, m, x, y, z) {
    var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    ms.position.set(x || 0, y || 0, z || 0); ms.castShadow = true; ms.receiveShadow = true;
    return ms;
  }
  function _bCone(r, h, m, x, y, z, seg) {
    var ms = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 4), m);
    ms.position.set(x || 0, y || 0, z || 0); ms.castShadow = true; ms.receiveShadow = true;
    return ms;
  }
  function _bSph(r, m, x, y, z) {
    var ms = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m);
    ms.position.set(x || 0, y || 0, z || 0); ms.castShadow = true; ms.receiveShadow = true;
    return ms;
  }
  function _keep(mesh) { mesh.userData.keepColor = true; return mesh; }
  /* 1 mặt tam giác của mái chóp, màu riêng (giữ màu, không bị tô đè). */
  function _bTriFace(verts, material) {
    var flat = [];
    for (var i = 0; i < 3; i++) { flat.push(verts[i][0], verts[i][1], verts[i][2]); }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    if (typeof geo.computeVertexNormals === 'function') geo.computeVertexNormals();
    var ms = new THREE.Mesh(geo, material);
    ms.castShadow = true; ms.receiveShadow = true;
    return _keep(ms);
  }
  /* 4 mặt tam giác của mái chóp, màu riêng, add thẳng vào group g
     (không lồng group con để rebuild/traverse đếm con trực tiếp được). */
  function _roofFacesGroup(g, w, d, apexH, cornerY, tileColor, y0) {
    var faces = roofPyramidFaces(w, d, apexH, cornerY);
    for (var i = 0; i < TILE_FACES.length; i++) {
      var f = TILE_FACES[i];
      var mesh = _bTriFace(faces[f],
        _bMat(tileColor[f], { roughness: 0.7, side: THREE.DoubleSide }));
      mesh.position.y = y0 || 0;
      g.add(mesh);
    }
    return g;
  }
  function buildRoofMesh(type, obj, params) {
    var g = new THREE.Group();
    var gold = _bMat('#d8a53c', { metalness: 0.55, roughness: 0.35 });
    var wood = _bMat('#3b2414');
    var tc = params.tileColor;
    var cornerY = eaveCornerY(params.curvature);
    if (type === 'roof-flat') {
      var fg = roofFlatGeom(params);
      var slab = _bBox(ROOF_W, 0.18, ROOF_D, _bMat(tc.front, { roughness: 0.75 }), 0, 0.09, 0);
      slab.rotation.x = fg.slabTilt;
      g.add(_keep(slab));
      g.add(_keep(_bBox(ROOF_W, fg.frontH, 0.12, _bMat(tc.front, { roughness: 0.75 }), 0, 0.18 + fg.frontH / 2, 1.24)));
      g.add(_keep(_bBox(ROOF_W, fg.backH, 0.12, _bMat(tc.back, { roughness: 0.75 }), 0, 0.18 + fg.backH / 2, -1.24)));
      g.add(_keep(_bBox(0.12, fg.sideH, ROOF_D, _bMat(tc.left, { roughness: 0.75 }), 1.74, 0.18 + fg.sideH / 2, 0)));
      g.add(_keep(_bBox(0.12, fg.sideH, ROOF_D, _bMat(tc.right, { roughness: 0.75 }), -1.74, 0.18 + fg.sideH / 2, 0)));
      return g;
    }
    if (type === 'roof-tower') {
      var w = 3.2, y = 0;
      for (var f = 0; f < 3; f++) {
        g.add(_bBox(w * 0.8, 0.5, w * 0.8, _bMat('#d8d1c2'), 0, y + 0.25, 0));
        _roofFacesGroup(g, w, w, 0.7 * params.slope, cornerY * 0.7, tc, y + 0.5);
        y += 1.2; w *= 0.78;
      }
      g.add(_keep(_bSph(0.22, gold, 0, y + 0.25, 0)));
      return g;
    }
    /* roof-curved: 4 mặt tam giác + sống mái vàng + diềm gỗ vểnh + sừng. */
    var apexH = ROOF_H * params.slope;
    _roofFacesGroup(g, ROOF_W, ROOF_D, apexH, cornerY, tc, 0);
    g.add(_keep(_bBox(3.7, 0.12, 0.18, gold, 0, apexH + 0.02, 0)));
    var tilt = 0.05 + params.curvature * 0.35;
    var e1 = _bBox(3.9, 0.1, 0.28, wood, 0, cornerY, 1.32);
    e1.rotation.x = tilt; g.add(_keep(e1));
    var e2 = _bBox(3.9, 0.1, 0.28, wood, 0, cornerY, -1.32);
    e2.rotation.x = -tilt; g.add(_keep(e2));
    [[-1.85, 1.32], [1.85, 1.32], [-1.85, -1.32], [1.85, -1.32]].forEach(function (p) {
      var horn = _bCone(0.13, 0.3 + params.curvature * 0.35,
        _bMat(p[1] > 0 ? tc.front : tc.back, { roughness: 0.7 }), p[0], cornerY + 0.16, p[1], 4);
      horn.rotation.x = (p[1] > 0 ? 1 : -1) * (0.15 + params.curvature * 0.4);
      g.add(_keep(horn));
    });
    return g;
  }
  function buildWallMesh(obj, params) {
    var g = new THREE.Group();
    var d = wallDims(params);
    /* Thân tường tô theo params.color (= obj.color, xem setParam);
       chân + gờ để viewport tô theo obj.color như builder gốc. */
    g.add(_bBox(d.w, d.h, d.d, _bMat(params.color), 0, d.h / 2, 0));
    g.add(_bBox(3.06, 0.25, d.d + 0.06, _bMat('#8b9793'), 0, 0.125, 0));
    g.add(_bBox(3.06, 0.12, d.d + 0.06, _bMat('#3b2414'), 0, d.h - 0.06, 0));
    return g;
  }
  function buildDoorMesh(obj, params) {
    var g = new THREE.Group();
    var d = doorDims(params);
    var wood = _bMat('#3b2414');
    var leaf = _bMat(obj.color || PART_DEFAULT_COLOR.door, { roughness: 0.75 });
    var gold = _bMat('#d8a53c', { metalness: 0.55, roughness: 0.35 });
    var postX = d.w / 2 - 0.06;
    g.add(_bBox(0.12, d.h, 0.16, wood, -postX, d.h / 2, 0));
    g.add(_bBox(0.12, d.h, 0.16, wood, postX, d.h / 2, 0));
    g.add(_bBox(d.w, 0.12, 0.16, wood, 0, d.h - 0.06, 0));
    g.add(_bBox(d.leafW, d.leafH, 0.08, leaf, 0, d.leafH / 2, 0));
    g.add(_bBox(d.leafW, 0.1, 0.1, gold, 0, d.leafH * 0.775, 0.05));
    g.add(_bSph(0.05, gold, d.leafW / 2 - 0.16, d.leafH / 2, 0.08));
    g.add(_bBox(d.w + 0.1, 0.12, 0.4, _bMat('#8b9793'), 0, 0.06, 0.18));
    return g;
  }
  /* Dựng Group cho part mái/tường/cửa theo tham số; trả null cho part
     khác (để buildMesh gốc xử lý) hoặc khi chưa có THREE. */
  function buildPartMesh(obj) {
    if (!obj || !hasDetailParams(obj.type)) return null;
    if (typeof THREE === 'undefined') return null;
    var p = getParams(obj);
    if (!p) return null;
    var g;
    if (isRoofType(obj.type)) g = buildRoofMesh(obj.type, obj, p);
    else if (obj.type === 'wall') g = buildWallMesh(obj, p);
    else if (obj.type === 'door') g = buildDoorMesh(obj, p);
    else return null;
    if (g) {
      g.userData.assetType = obj.type;
      g.userData.buildingParamsSig = JSON.stringify(p);
    }
    return g;
  }
  var _buildWrapped = false;
  function wrapBuildMesh() {
    if (_buildWrapped) return true;
    if (!ED.Assets || typeof ED.Assets.buildMesh !== 'function') return false;
    var orig = ED.Assets.buildMesh;
    ED.Assets.buildMesh = function (type, opts) {
      if (isPartType(type) && hasDetailParams(type)) {
        try {
          var g = buildPartMesh(opts || { type: type });
          if (g) return g;
        } catch (e) { /* lỗi builder mới -> rơi về builder gốc */ }
      }
      return orig.call(ED.Assets, type, opts);
    };
    _buildWrapped = true;
    return true;
  }
  function _disposeDeep(node) {
    if (!node) return;
    if (node.isMesh) {
      if (node.geometry && typeof node.geometry.dispose === 'function') {
        try { node.geometry.dispose(); } catch (e) {}
      }
      if (node.material) {
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(function (m) {
          if (m && typeof m.dispose === 'function') { try { m.dispose(); } catch (e) {} }
        });
      }
    }
    ((node.children || []).slice()).forEach(_disposeDeep);
  }
  /* Dựng lại mesh của part theo tham số hiện tại, NGAY trong scene.
     Đổi con của Group cũ tại chỗ (không removeMesh) nên giữ nguyên
     Group trong ED.Viewport.meshes, giữ chọn/gizmo/parent. Chưa có mesh
     thì sync thường (buildMesh đã bọc sẽ dựng theo tham số). */
  function rebuildPartMesh(obj) {
    if (!obj || !hasDetailParams(obj.type)) return false;
    var meshes = (ED.Viewport && ED.Viewport.meshes) || null;
    var group = meshes ? meshes[obj.id] : null;
    if (!group) { _sync(obj); return true; }
    var fresh = null;
    try { fresh = buildPartMesh(obj); } catch (e) { fresh = null; }
    if (!fresh) return false;
    var old = (group.children || []).slice();
    old.forEach(function (c) {
      try { group.remove(c); } catch (e) {}
      _disposeDeep(c);
    });
    (fresh.children || []).slice().forEach(function (c) { group.add(c); });
    group.userData.assetType = obj.type;
    group.userData.buildingParamsSig = fresh.userData.buildingParamsSig;
    _sync(obj);
    return true;
  }
  /* Quét các part đã có mesh: mesh nào lệch tham số hiện tại (vd sau
     Undo/Redo/load — Viewport.resyncAll chỉ sync transform/màu, không
     dựng lại hình) thì dựng lại. Gọi trong onChange của Core. */
  function resyncParamMeshes() {
    if (!ED.Viewport || !ED.Viewport.meshes) return 0;
    var count = 0;
    _partObjects().forEach(function (o) {
      if (!o || !hasDetailParams(o.type)) return;
      var g = ED.Viewport.meshes[o.id];
      if (!g) return;
      var sig = JSON.stringify(getParams(o));
      if (g.userData.buildingParamsSig !== sig) {
        if (rebuildPartMesh(o)) count++;
      }
    });
    return count;
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
    _renderParams();
  }

  /* ---- Đợt 4: panel chỉnh tham số part đang chọn. ----
     Chỉ hiện khi object đang chọn là part nhà; mái/tường/cửa có slider +
     ô màu, part khác chỉ hiện ghi chú (không vẽ slider giả). Kéo slider
     thì rebuild mesh ngay + markDirty; pushHistory 1 lần/lần kéo (lúc
     bắt đầu chạm/phím, trước khi giá trị đổi) để Undo trả về 1 bước.
     Không vẽ lại cả panel trong lúc kéo (chỉ cập nhật số hiển thị) để
     không mất slider đang kéo. */
  function _selectedPart() {
    var o = (ED.Core && typeof ED.Core.selectedObject === 'function')
      ? ED.Core.selectedObject() : null;
    return (o && isPartType(o.type)) ? o : null;
  }
  function _sliderRow(key, label, value, min, max, step, unit) {
    return '<label class="ed-bldg-param"><span class="ed-bldg-param-label">' + label +
      ' <b data-val="' + key + '">' + value + (unit || '') + '</b></span>' +
      '<input type="range" data-param="' + key + '" data-unit="' + (unit || '') +
      '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value +
      '" style="min-height:40px"></label>';
  }
  function _colorRow(key, label, value) {
    return '<label class="ed-bldg-param"><span class="ed-bldg-param-label">' + label + '</span>' +
      '<input type="color" data-param="' + key + '" value="' + value +
      '" style="min-height:40px;min-width:48px"></label>';
  }
  function _renderParams() {
    if (!_paramsEl || typeof document === 'undefined') return;
    var obj = _selectedPart();
    if (!obj) {
      _paramsEl.style.display = 'none';
      _paramsEl.innerHTML = '';
      return;
    }
    _paramsEl.style.display = '';
    if (!hasDetailParams(obj.type)) {
      _paramsEl.innerHTML = '<div class="ed-bldg-empty">Part “' + _esc(obj.name) +
        '” chưa có tham số chỉnh chi tiết (mới có cho mái / tường / cửa).</div>';
      return;
    }
    var p = getParams(obj);
    var h = '';
    if (isRoofType(obj.type)) {
      h += _sliderRow('curvature', 'Độ cong mái', p.curvature, 0, 1, 0.05, '');
      h += _sliderRow('slope', 'Độ dốc mái', p.slope, 0.5, 2, 0.1, '×');
      h += '<div class="ed-bldg-sub2">Màu ngói từng mặt</div>';
      h += _colorRow('tileFront', 'Mặt trước', p.tileColor.front);
      h += _colorRow('tileBack', 'Mặt sau', p.tileColor.back);
      h += _colorRow('tileLeft', 'Mặt trái', p.tileColor.left);
      h += _colorRow('tileRight', 'Mặt phải', p.tileColor.right);
      h += '<div class="ed-bldg-empty">Độ cong càng lớn, mép mái càng vểnh cao. Mái được dựng lại từ tham số (không chỉ co kéo mesh cũ).</div>';
    } else if (obj.type === 'wall') {
      h += _sliderRow('height', 'Cao tường', p.height, 1, 6, 0.1, ' m');
      h += _sliderRow('thickness', 'Dày tường', p.thickness, 0.1, 1, 0.05, ' m');
      h += _colorRow('color', 'Màu tường', p.color);
    } else if (obj.type === 'door') {
      h += _sliderRow('height', 'Cao cửa', p.height, 1, 3.5, 0.1, ' m');
      h += _sliderRow('width', 'Rộng cửa', p.width, 0.6, 2, 0.1, ' m');
    }
    _paramsEl.innerHTML = h;
    _bindParamInputs(obj);
  }
  function _applyParam(obj, key, value) {
    if (key === 'tileFront' || key === 'tileBack' || key === 'tileLeft' || key === 'tileRight') {
      var patch = {};
      patch[key.slice(4).toLowerCase()] = value;
      setParam(obj, 'tileColor', patch);
    } else {
      setParam(obj, key, value);
    }
    rebuildPartMesh(obj);
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
  }
  function _bindParamInputs(obj) {
    if (!_paramsEl) return;
    var inputs = _paramsEl.querySelectorAll('[data-param]');
    for (var i = 0; i < inputs.length; i++) {
      (function (el) {
        var key = el.getAttribute('data-param');
        var isColor = el.type === 'color';
        var arm = function () {
          if (!_paramHistArmed) {
            _pushHistory('Chỉnh chi tiết ' + (obj.name || obj.type));
            _paramHistArmed = true;
          }
        };
        el.addEventListener('pointerdown', arm);
        el.addEventListener('focus', arm);
        el.addEventListener('input', function () {
          arm();
          var v = isColor ? el.value : Number(el.value);
          _applyParam(obj, key, v);
          if (!isColor) {
            var lab = _paramsEl.querySelector('[data-val="' + key + '"]');
            if (lab) lab.textContent = el.value + (el.getAttribute('data-unit') || '');
          }
        });
        el.addEventListener('change', function () { _paramHistArmed = false; });
      })(inputs[i]);
    }
  }

  function init() {
    wrapAddObjectAt();
    wrapBuildMesh();
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
        /* Đợt 4: đổi chọn -> vẽ lại panel chi tiết; Undo/Redo/load đổi
           tham số trong project nhưng mesh cũ còn nguyên -> dựng lại
           mesh lệch tham số (Viewport.resyncAll không dựng lại hình). */
        _renderParams();
        resyncParamMeshes();
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
      '<div class="ed-bldg-sub">Chi tiết part đang chọn</div>' +
      '<div id="ed-bldg-params" class="ed-bldg-params"></div>' +
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
    _paramsEl = _panel.querySelector('#ed-bldg-params');
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
    _renderParams();
  }

  return {
    SNAP_STEP: SNAP_STEP, ROOF_SEARCH_RADIUS: ROOF_SEARCH_RADIUS,
    GROUND_SINK: GROUND_SINK, WALL_HEIGHT: WALL_HEIGHT,
    PART_TYPES: PART_TYPES, ROOF_TYPES: ROOF_TYPES,
    PART_DEFAULT_COLOR: PART_DEFAULT_COLOR,
    ROOF_W: ROOF_W, ROOF_D: ROOF_D, ROOF_H: ROOF_H,
    TILE_FACES: TILE_FACES,
    isPartType: isPartType, isRoofType: isRoofType,
    hasDetailParams: hasDetailParams,
    defaultParams: defaultParams, getParams: getParams,
    setParam: setParam, ensureParams: ensureParams,
    clampNum: clampNum, normColor: normColor,
    eaveCornerY: eaveCornerY, roofPyramidFaces: roofPyramidFaces,
    roofFlatGeom: roofFlatGeom, wallDims: wallDims, doorDims: doorDims,
    buildPartMesh: buildPartMesh, buildRoofMesh: buildRoofMesh,
    buildWallMesh: buildWallMesh, buildDoorMesh: buildDoorMesh,
    wrapBuildMesh: wrapBuildMesh, rebuildPartMesh: rebuildPartMesh,
    resyncParamMeshes: resyncParamMeshes,
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
