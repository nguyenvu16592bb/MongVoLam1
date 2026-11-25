/* Map Editor — 22-weight.js (đợt 7, nhóm Weight Painting)
   ED.Weight: cọ tô trọng số skinning (skinWeight) trên mesh trong preview
   của ED.Character.
   - Chọn xương (lấy từ preview qua ED.Character.getPreview() + pv.bones,
     có guard — LƯU Ý: 07-character.js KHÔNG có getPreviewBones() /
     getPreviewSkinnedMeshes(), chỉ có getPreview(), nên module này tự
     duyệt pv.group tìm SkinnedMesh; nếu ED.Character bổ sung 2 API đó
     sau này thì _getSkinnedMeshes() sẽ ưu tiên dùng chúng qua guard).
   - Cọ {size (bán kính world, mặc định 0.3), strength 0..1 (mặc định 0.5),
     mode 'add'|'subtract'|'smooth'}; bấm/kéo lên mesh trong preview
     (pointer events trên preview renderer DOM, raycast bằng THREE.Raycaster
     khi có THREE) thì đổi skinWeight các đỉnh gần điểm chạm; sau mỗi
     stroke CHUẨN HOÁ tổng trọng số mỗi đỉnh bị đổi về 1.
   - Snapshot trọng số gốc: KHÔNG sửa được 07-character.js để hook lúc
     import, nên snapshot gốc được chụp lười (lazy) lần đầu module chạm
     tới 1 mesh — tức là trước mọi lần tô đầu tiên, tương đương snapshot
     lúc import vì không module nào khác sửa skinWeight; nút "Reset weight
     về gốc" khôi phục snapshot này.
   - Stack hoàn tác riêng cho weight (undoWeight, tối đa 20 stroke) +
     cuối mỗi stroke gọi ED.Core.pushHistory('Weight paint') qua guard.
   - Xem lại bằng heatmap đợt 3: sau mỗi stroke gọi
     ED.Character.applyBoneWeightHeatmap(xương đang chọn) qua guard (hàm
     này nội bộ dùng computeBoneWeights/weightToColor); nếu API đó vắng
     thì tô lại màu thủ công bằng computeBoneWeights/weightToColor qua
     guard (_recolorHeatmapManual).
   - Model không có skin (mesh-only, không có skinWeights) thì báo rõ
     "không tô được" — không vẽ cọ giả.
   - Bấm/kéo tô sẽ tạm dừng clip đang phát (ED.Character.pauseClip qua
     guard): raycast của THREE r128 không tính biến dạng skinning, tô
     lúc model đang chạy clip sẽ lệch điểm chạm.
   KHÔNG truy cập document/window/THREE ở top-level; mọi khởi tạo trong
   init(). Logic thuần expose để test bằng vm + stub THREE.
   GIỚI HẠN: chưa render thử trên trình duyệt/điện thoại thật; smooth
   toàn mesh (smoothWeights) là O(n^2) nên chỉ dùng cho mesh vừa hoặc
   qua paintWeights (chỉ tính đỉnh trong cọ); trọng số tô KHÔNG lưu vào
   project JSON (skinWeight sống trong geometry, không serialize) nên
   Ctrl+Z của editor (snapshot project) không hoàn tác được weight —
   dùng nút "Hoàn tác weight" của panel này; cọ tô xong cần xuất lại
   model (GLB/FBX) mới giữ được trọng số mới. */
var ED = (typeof ED !== 'undefined' && ED) ? ED : {};

/* ---------------- Logic thuần (không DOM/THREE) ----------------
   Quy ước dữ liệu:
   - weights: mảng theo đỉnh, weights[v] là mảng số theo chỉ số xương
     trong skeleton (dense: weights[v][boneIndex] = trọng số xương đó
     tại đỉnh v). Đỉnh chưa chịu xương nào thì hàng toàn 0.
   - positions: mảng theo đỉnh, positions[v] = [x, y, z] (cùng hệ tọa
     độ với hitPoint — runtime đưa về world trước khi gọi).
   Mọi hàm thuần đều KHÔNG sửa mảng gốc trừ khi ghi rõ (paintWeights /
   normalizeWeights / restoreWeights sửa tại chỗ và trả báo cáo). */

function _edWClamp(v, lo, hi) {
  var n = Number(v);
  if (!isFinite(n)) return lo;
  return n < lo ? lo : (n > hi ? hi : n);
}

function _edWDist3(a, b) {
  var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/* Số xương (độ dài hàng) dùng chung: dài nhất trong weights, tối thiểu
   boneIndex + 1 để hàng nào cũng chứa được xương đang tô. */
function _edWRowLen(weights, boneIndex) {
  var n = (isFinite(Number(boneIndex)) ? Math.floor(Number(boneIndex)) + 1 : 1);
  for (var i = 0; i < weights.length; i++) {
    if (weights[i] && weights[i].length > n) n = weights[i].length;
  }
  return Math.max(n, 1);
}

function _edWEnsureRow(weights, v, len) {
  var row = weights[v];
  if (!row || typeof row.length !== 'number') { row = []; weights[v] = row; }
  while (row.length < len) row.push(0);
  return row;
}

/* Chuẩn hoá 1 hàng về tổng 1 (chia theo tỉ lệ, giữ xương khác đúng tỉ
   lệ tương đối). Hàng tổng <= 0 thì giữ nguyên (không chia được).
   Trả true nếu đã chia, false nếu bỏ qua. */
function _edWNormalizeRow(row) {
  var sum = 0;
  for (var i = 0; i < row.length; i++) {
    var w = Number(row[i]);
    if (!isFinite(w) || w < 0) { row[i] = 0; w = 0; }
    else row[i] = w;
    sum += row[i];
  }
  if (sum <= 1e-9) return false;
  if (Math.abs(sum - 1) < 1e-9) return true;
  for (var j = 0; j < row.length; j++) row[j] = row[j] / sum;
  return true;
}

/* Tô trọng số tại 1 điểm chạm.
   weights, positions: như quy ước trên (cùng số đỉnh). boneIndex: chỉ
   số xương trong skeleton. hitPoint [x,y,z]. radius > 0 (bán kính cọ,
   cùng đơn vị với positions). strength 0..1. mode:
   - 'add': cộng strength × falloff vào xương đang chọn.
   - 'subtract': trừ strength × falloff (kẹp >= 0).
   - 'smooth': làm mịn — đỉnh bị ảnh hưởng nhận trung bình trọng số
     của các đỉnh kề trong bán kính cọ (kể cả chính nó), trộn với hàng
     cũ theo tỉ lệ strength × falloff. Làm mịn TUẦN TỰ tại chỗ (đỉnh
     xử lý sau thấy đỉnh trước đã mịn — kiểu cọ tô thường dùng).
   falloff giảm tuyến tính theo khoảng cách tới điểm chạm (1 tại tâm,
   0 tại mép cọ). Sau khi đổi, CHUẨN HOÁ tổng mỗi đỉnh bị đổi về 1.
   Trả {changed: [chỉ số đỉnh bị đổi], count} — sửa weights tại chỗ. */
function edWeightPaintWeights(weights, boneIndex, positions, hitPoint, radius, strength, mode) {
  var changed = [];
  if (!Array.isArray(weights) || !Array.isArray(positions) || !hitPoint) return { changed: changed, count: 0 };
  var n = Math.min(weights.length, positions.length);
  var r = Number(radius);
  if (!isFinite(r) || r <= 0) return { changed: changed, count: 0 };
  var bi = Math.floor(Number(boneIndex));
  if (!isFinite(bi) || bi < 0) return { changed: changed, count: 0 };
  var s = _edWClamp(strength, 0, 1);
  var m = (mode === 'subtract' || mode === 'smooth') ? mode : 'add';
  var hp = [Number(hitPoint[0]) || 0, Number(hitPoint[1]) || 0, Number(hitPoint[2]) || 0];
  var rowLen = _edWRowLen(weights, bi);
  /* Đỉnh nào trong cọ + falloff của nó (tính trước 1 lượt để smooth
     dùng chung danh sách, tránh tính lại khoảng cách). */
  var affected = [];
  for (var v = 0; v < n; v++) {
    var p = positions[v];
    if (!p || typeof p.length !== 'number' || p.length < 3) continue;
    var d = _edWDist3([Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0], hp);
    if (d <= r) affected.push({ vi: v, falloff: 1 - d / r });
  }
  if (!affected.length) return { changed: changed, count: 0 };
  if (m === 'smooth') {
    /* Trung bình trọng số các đỉnh kề (trong bán kính cọ quanh đỉnh v,
       kể cả chính v) — xấp xỉ kề nhau bằng vị trí gần nhau. Chỉ tính
       cho đỉnh bị ảnh hưởng nên chi phí ~ affected × n. */
    for (var a = 0; a < affected.length; a++) {
      var vi = affected[a].vi;
      var k = s * affected[a].falloff;
      if (k <= 0) continue;
      var pv = positions[vi];
      var pv3 = [Number(pv[0]) || 0, Number(pv[1]) || 0, Number(pv[2]) || 0];
      var acc = new Array(rowLen);
      for (var q = 0; q < rowLen; q++) acc[q] = 0;
      var cnt = 0;
      for (var u = 0; u < n; u++) {
        var pu = positions[u];
        if (!pu || pu.length < 3) continue;
        if (_edWDist3([Number(pu[0]) || 0, Number(pu[1]) || 0, Number(pu[2]) || 0], pv3) > r) continue;
        var ru = weights[u] || [];
        for (var c = 0; c < rowLen; c++) {
          var wu = Number(ru[c]);
          acc[c] += (isFinite(wu) && wu > 0) ? wu : 0;
        }
        cnt++;
      }
      if (!cnt) continue;
      var row = _edWEnsureRow(weights, vi, rowLen);
      for (var c2 = 0; c2 < rowLen; c2++) {
        var avg = acc[c2] / cnt;
        row[c2] = row[c2] * (1 - k) + avg * k;
      }
      _edWNormalizeRow(row);
      changed.push(vi);
    }
    return { changed: changed, count: changed.length };
  }
  for (var b = 0; b < affected.length; b++) {
    var vi2 = affected[b].vi;
    var delta = s * affected[b].falloff;
    if (delta <= 0) continue;
    var row2 = _edWEnsureRow(weights, vi2, rowLen);
    if (m === 'add') row2[bi] = (Number(row2[bi]) || 0) + delta;
    else row2[bi] = Math.max(0, (Number(row2[bi]) || 0) - delta);
    _edWNormalizeRow(row2);
    changed.push(vi2);
  }
  return { changed: changed, count: changed.length };
}

/* Chuẩn hoá tổng trọng số mỗi đỉnh về 1. indices: mảng chỉ số đỉnh
   cần chuẩn hoá; null/undefined thì chuẩn hoá toàn bộ. Hàng tổng <= 0
   thì giữ nguyên. Trả {normalized, skipped}. */
function edWeightNormalizeWeights(weights, indices) {
  var out = { normalized: 0, skipped: 0 };
  if (!Array.isArray(weights)) return out;
  var list = indices;
  if (!Array.isArray(list)) {
    list = [];
    for (var i = 0; i < weights.length; i++) list.push(i);
  }
  for (var j = 0; j < list.length; j++) {
    var v = list[j];
    if (!weights[v] || typeof weights[v].length !== 'number') { out.skipped++; continue; }
    if (_edWNormalizeRow(weights[v])) out.normalized++;
    else out.skipped++;
  }
  return out;
}

/* Làm mịn toàn bộ trọng số: mỗi đỉnh nhận trung bình trọng số của các
   đỉnh trong bán kính radius quanh nó (kể cả chính nó), rồi chuẩn hoá
   về tổng 1. Trả MẢNG MỚI (không sửa weights gốc). O(n^2) — chỉ dùng
   cho mesh vừa / trong test; cọ smooth lúc tô dùng paintWeights để
   chỉ tính đỉnh trong cọ. radius <= 0 thì trả bản sao của weights. */
function edWeightSmoothWeights(weights, positions, radius) {
  var n = Array.isArray(weights) ? weights.length : 0;
  var out = [];
  var r = Number(radius);
  if (!n) return out;
  var rowLen = _edWRowLen(weights, 0);
  for (var v = 0; v < n; v++) {
    var row = [];
    for (var q = 0; q < rowLen; q++) row.push(0);
    out.push(row);
  }
  if (!isFinite(r) || r <= 0) {
    for (var v2 = 0; v2 < n; v2++) {
      var src = weights[v2] || [];
      for (var q2 = 0; q2 < rowLen; q2++) {
        var w = Number(src[q2]);
        out[v2][q2] = (isFinite(w) && w > 0) ? w : 0;
      }
      _edWNormalizeRow(out[v2]);
    }
    return out;
  }
  var m = Array.isArray(positions) ? Math.min(n, positions.length) : 0;
  for (var i = 0; i < n; i++) {
    var pi = (i < m && positions[i]) ? [Number(positions[i][0]) || 0, Number(positions[i][1]) || 0, Number(positions[i][2]) || 0] : null;
    var acc = out[i];
    var cnt = 0;
    for (var u = 0; u < m; u++) {
      var pu = positions[u];
      if (!pu || pu.length < 3) continue;
      if (pi && _edWDist3([Number(pu[0]) || 0, Number(pu[1]) || 0, Number(pu[2]) || 0], pi) > r) continue;
      var ru = weights[u] || [];
      for (var c = 0; c < rowLen; c++) {
        var wu = Number(ru[c]);
        acc[c] += (isFinite(wu) && wu > 0) ? wu : 0;
      }
      cnt++;
    }
    if (cnt) {
      for (var c2 = 0; c2 < rowLen; c2++) acc[c2] = acc[c2] / cnt;
      _edWNormalizeRow(acc);
    }
  }
  return out;
}

/* Snapshot sâu trọng số (để hoàn tác / reset về gốc). */
function edWeightSnapshotWeights(weights) {
  var out = [];
  if (!Array.isArray(weights)) return out;
  for (var i = 0; i < weights.length; i++) {
    var row = weights[i];
    out.push(Array.isArray(row) ? row.slice() : []);
  }
  return out;
}

/* Khôi phục trọng số từ snapshot — ghi đè TẠI CHỖ vào weights (giữ
   nguyên tham chiếu mảng ngoài để code gọi vẫn thấy dữ liệu mới).
   Trả số đỉnh đã khôi phục. */
function edWeightRestoreWeights(weights, snapshot) {
  if (!Array.isArray(weights) || !Array.isArray(snapshot)) return 0;
  var n = snapshot.length;
  weights.length = n;
  for (var i = 0; i < n; i++) {
    weights[i] = Array.isArray(snapshot[i]) ? snapshot[i].slice() : [];
  }
  return n;
}

/* Chuyển skinIndex/skinWeight phẳng (4 slot/đỉnh, đúng layout
   geometry.attributes.skinIndex/skinWeight của three.js) thành weights
   dense theo chỉ số xương skeleton. skinIndex/skinWeight là mảng
   (thường hoặc typed array). vertexCount/boneCount không truyền thì
   tự suy ra (vertexCount = length/4, boneCount = chỉ số xương lớn
   nhất + 1). Trả {weights, vertexCount, boneCount} hoặc null khi
   thiếu dữ liệu skin. */
function edWeightWeightsFromSkin(skinIndex, skinWeight, vertexCount, boneCount) {
  if (!skinIndex || !skinWeight || typeof skinIndex.length !== 'number' || typeof skinWeight.length !== 'number') return null;
  var vc = isFinite(Number(vertexCount)) && Number(vertexCount) > 0
    ? Math.floor(Number(vertexCount))
    : Math.floor(Math.min(skinIndex.length, skinWeight.length) / 4);
  if (vc <= 0) return null;
  var bc = isFinite(Number(boneCount)) && Number(boneCount) > 0 ? Math.floor(Number(boneCount)) : 0;
  if (!bc) {
    var maxIdx = -1;
    for (var v = 0; v < vc; v++) {
      for (var i = 0; i < 4; i++) {
        var idx = Number(skinIndex[v * 4 + i]);
        if (isFinite(idx) && idx > maxIdx) maxIdx = idx;
      }
    }
    bc = maxIdx + 1;
  }
  if (bc <= 0) return null;
  var weights = [];
  for (var v2 = 0; v2 < vc; v2++) {
    var row = [];
    for (var q = 0; q < bc; q++) row.push(0);
    for (var j = 0; j < 4; j++) {
      var bi = Number(skinIndex[v2 * 4 + j]);
      var w = Number(skinWeight[v2 * 4 + j]);
      if (isFinite(bi) && bi >= 0 && bi < bc && isFinite(w) && w > 0) row[bi] += w;
    }
    weights.push(row);
  }
  return { weights: weights, vertexCount: vc, boneCount: bc };
}

/* Ghi weights dense trở lại skinIndex/skinWeight phẳng: mỗi đỉnh giữ
   tối đa 4 xương mạnh nhất (giảm dần theo trọng số, hòa thì xương
   nhỏ trước), slot thừa điền index 0 / weight 0. Ghi TẠI CHỖ vào 2
   mảng đích. Trả {vertices} hoặc null khi mảng đích quá ngắn. */
function edWeightWeightsToSkin(weights, skinIndex, skinWeight) {
  if (!Array.isArray(weights) || !skinIndex || !skinWeight) return null;
  if (skinIndex.length < weights.length * 4 || skinWeight.length < weights.length * 4) return null;
  for (var v = 0; v < weights.length; v++) {
    var row = weights[v] || [];
    var pairs = [];
    for (var b = 0; b < row.length; b++) {
      var w = Number(row[b]);
      if (isFinite(w) && w > 1e-6) pairs.push({ bone: b, w: w });
    }
    pairs.sort(function (a, b2) { return (b2.w - a.w) || (a.bone - b2.bone); });
    for (var i = 0; i < 4; i++) {
      if (i < pairs.length) { skinIndex[v * 4 + i] = pairs[i].bone; skinWeight[v * 4 + i] = pairs[i].w; }
      else { skinIndex[v * 4 + i] = 0; skinWeight[v * 4 + i] = 0; }
    }
  }
  return { vertices: weights.length };
}

/* ---------------- Module ED.Weight ---------------- */

ED.Weight = (function () {
  var _inited = false;
  var _panel = null, _statusEl = null, _boneSel = null;
  var _sizeInput = null, _sizeVal = null, _strInput = null, _strVal = null;
  var _modeBtns = {}, _paintBtn = null, _undoBtn = null, _resetBtn = null;
  var _bone = null, _size = 0.3, _strength = 0.5, _mode = 'add';
  var _paintEnabled = false, _painting = false, _paintMesh = null;
  var _undoStack = []; /* [{mesh, snapshot}] tối đa 20 */
  var _originals = []; /* [{mesh, snapshot}] snapshot gốc (lười, lần chạm đầu) */
  var UNDO_MAX = 20;

  function _toast(msg) {
    try { if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg); } catch (e) {}
  }
  function _log(msg) {
    try { if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log(msg); } catch (e) {}
  }
  function _pushHistory(label) {
    try { if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(label); } catch (e) {}
  }
  function _getPreview() {
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') return ED.Character.getPreview();
    } catch (e) {}
    return null;
  }

  /* SkinnedMesh trong preview: ưu tiên API mới của Character nếu có
     (guard typeof), không thì duyệt pv.group. */
  function _getSkinnedMeshes() {
    var pv = _getPreview();
    if (!pv) return [];
    try {
      if (ED.Character && typeof ED.Character.getPreviewSkinnedMeshes === 'function') {
        var list = ED.Character.getPreviewSkinnedMeshes();
        if (Array.isArray(list)) return list;
      }
    } catch (e) {}
    var out = [];
    if (pv.group && typeof pv.group.traverse === 'function') {
      pv.group.traverse(function (obj) { if (obj && obj.isSkinnedMesh) out.push(obj); });
    }
    return out;
  }

  /* Tên xương trong preview: ưu tiên API mới của Character nếu có,
     không thì pv.bones (collectBones), cuối cùng là skeleton.bones. */
  function _getBoneNames() {
    var pv = _getPreview();
    if (!pv) return [];
    try {
      if (ED.Character && typeof ED.Character.getPreviewBones === 'function') {
        var b = ED.Character.getPreviewBones();
        if (Array.isArray(b)) {
          return b.map(function (x) { return (x && typeof x === 'object') ? x.name : x; })
            .filter(function (n) { return typeof n === 'string' && n; });
        }
      }
    } catch (e) {}
    if (Array.isArray(pv.bones) && pv.bones.length) {
      return pv.bones.map(function (x) { return x && x.name; }).filter(function (n) { return typeof n === 'string' && n; });
    }
    var names = [], seen = {};
    _getSkinnedMeshes().forEach(function (mesh) {
      var skel = mesh && mesh.skeleton;
      if (!skel || !skel.bones) return;
      skel.bones.forEach(function (bone) {
        if (bone && bone.name && !seen[bone.name]) { seen[bone.name] = true; names.push(bone.name); }
      });
    });
    return names;
  }

  function _boneIndexInMesh(mesh, boneName) {
    var skel = mesh && mesh.skeleton;
    if (!skel || !skel.bones || !boneName) return -1;
    for (var i = 0; i < skel.bones.length; i++) {
      if (skel.bones[i] && skel.bones[i].name === boneName) return i;
    }
    return -1;
  }

  function _readMeshWeights(mesh) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes) return null;
    var attrs = mesh.geometry.attributes;
    if (!attrs.skinIndex || !attrs.skinWeight) return null;
    var si = attrs.skinIndex.array || attrs.skinIndex;
    var sw = attrs.skinWeight.array || attrs.skinWeight;
    var vc = 0;
    if (attrs.skinIndex && isFinite(Number(attrs.skinIndex.count))) vc = Number(attrs.skinIndex.count);
    else if (attrs.position && isFinite(Number(attrs.position.count))) vc = Number(attrs.position.count);
    var bc = (mesh.skeleton && mesh.skeleton.bones) ? mesh.skeleton.bones.length : 0;
    return edWeightWeightsFromSkin(si, sw, vc, bc);
  }

  function _writeMeshWeights(mesh, weights) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes) return false;
    var attrs = mesh.geometry.attributes;
    if (!attrs.skinIndex || !attrs.skinWeight) return false;
    var si = attrs.skinIndex.array || attrs.skinIndex;
    var sw = attrs.skinWeight.array || attrs.skinWeight;
    var r = edWeightWeightsToSkin(weights, si, sw);
    if (!r) return false;
    try { if (attrs.skinIndex) attrs.skinIndex.needsUpdate = true; } catch (e) {}
    try { if (attrs.skinWeight) attrs.skinWeight.needsUpdate = true; } catch (e) {}
    try { if (mesh.geometry && mesh.geometry.computeBoundingSphere) mesh.geometry.computeBoundingSphere(); } catch (e) {}
    return true;
  }

  /* Vị trí đỉnh theo WORLD (cùng hệ với hitPoint raycast): local ->
     matrixWorld. Trả null khi không có THREE/mesh. */
  function _worldPositions(mesh) {
    if (typeof THREE === 'undefined' || !mesh || !mesh.geometry || !mesh.geometry.attributes) return null;
    var posAttr = mesh.geometry.attributes.position;
    if (!posAttr) return null;
    var arr = posAttr.array || posAttr;
    if (!arr || typeof arr.length !== 'number') return null;
    try { if (mesh.updateWorldMatrix) mesh.updateWorldMatrix(true, false); } catch (e) {}
    var out = [];
    var count = Math.floor(arr.length / 3);
    for (var i = 0; i < count; i++) {
      var v = new THREE.Vector3(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
      try { if (mesh.localToWorld) mesh.localToWorld(v); } catch (e) {}
      out.push([v.x, v.y, v.z]);
    }
    return out;
  }

  function _findOriginal(mesh) {
    for (var i = 0; i < _originals.length; i++) if (_originals[i].mesh === mesh) return _originals[i];
    return null;
  }

  /* Chụp snapshot gốc của mesh nếu chưa có (lười — lần chạm đầu tiên,
     trước mọi lần tô). Trả true nếu vừa chụp / đã có. */
  function _ensureOriginal(mesh) {
    if (_findOriginal(mesh)) return true;
    var data = _readMeshWeights(mesh);
    if (!data) return false;
    _originals.push({ mesh: mesh, snapshot: edWeightSnapshotWeights(data.weights) });
    return true;
  }

  /* Tô 1 điểm chạm lên mesh: đọc weights -> paintWeights -> ghi lại.
     Trả số đỉnh đã đổi (0 = không đổi / không tô được). */
  function _paintAt(mesh, hitPoint) {
    if (!_bone) return 0;
    var bi = _boneIndexInMesh(mesh, _bone);
    if (bi < 0) return 0;
    var data = _readMeshWeights(mesh);
    if (!data) return 0;
    var positions = _worldPositions(mesh);
    if (!positions || !positions.length) return 0;
    var res = edWeightPaintWeights(data.weights, bi, positions, hitPoint, _size, _strength, _mode);
    if (!res.count) return 0;
    if (!_writeMeshWeights(mesh, data.weights)) return 0;
    return res.count;
  }

  /* Tô lại heatmap đợt 3 cho xương đang chọn (để thấy ngay chỗ vừa tô).
     Ưu tiên ED.Character.applyBoneWeightHeatmap; vắng thì tô thủ công
     bằng computeBoneWeights/weightToColor qua guard. */
  function refreshHeatmap() {
    if (!_bone) return false;
    try {
      if (ED.Character && typeof ED.Character.applyBoneWeightHeatmap === 'function') {
        var r = ED.Character.applyBoneWeightHeatmap(_bone);
        if (r && r.ok) return true;
        /* apply trả ok:false (vd xương không có trong skeleton) thì
           vẫn thử đường thủ công bên dưới. */
      }
    } catch (e) {}
    return _recolorHeatmapManual();
  }

  function _recolorHeatmapManual() {
    if (typeof THREE === 'undefined' || !_bone) return false;
    var compute = null, toColor = null;
    try {
      if (ED.Character && typeof ED.Character.computeBoneWeights === 'function') compute = ED.Character.computeBoneWeights;
      if (ED.Character && typeof ED.Character.weightToColor === 'function') toColor = ED.Character.weightToColor;
    } catch (e) {}
    if (!compute || !toColor) return false;
    var meshes = _getSkinnedMeshes();
    var applied = 0;
    meshes.forEach(function (mesh) {
      var bi = _boneIndexInMesh(mesh, _bone);
      if (bi < 0) return;
      var res = null;
      try { res = compute(mesh.geometry, bi); } catch (e) { res = null; }
      if (!res || !res.weights) return;
      if (!mesh.userData) mesh.userData = {};
      if (!mesh.userData._heatSaved) {
        var mats0 = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.userData._heatSaved = {
          colorAttr: (mesh.geometry.attributes && mesh.geometry.attributes.color) ? mesh.geometry.attributes.color : null,
          vertexColors: mats0.map(function (m) { return !!(m && m.vertexColors); })
        };
      }
      var colors = new Float32Array(res.count * 3);
      for (var v = 0; v < res.count; v++) {
        var c = toColor(res.weights[v]);
        colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2];
      }
      try {
        mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(function (m) { if (m) { m.vertexColors = true; m.needsUpdate = true; } });
        applied++;
      } catch (e) {}
    });
    var pv = _getPreview();
    if (applied && pv) pv.heatmap = { on: true, bone: _bone };
    return applied > 0;
  }

  function _setStatus(msg) {
    if (_statusEl) _statusEl.textContent = msg;
  }

  function _refreshBoneSelect() {
    if (!_boneSel) return;
    var names = _getBoneNames();
    var prev = _boneSel.value || _bone;
    while (_boneSel.firstChild) _boneSel.removeChild(_boneSel.firstChild);
    if (!names.length) {
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = 'Chưa có xương — nhập file .fbx/.glb có xương trước.';
      _boneSel.appendChild(o0);
      _bone = null;
      return;
    }
    names.forEach(function (n) {
      var o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      _boneSel.appendChild(o);
    });
    if (prev && names.indexOf(prev) >= 0) { _boneSel.value = prev; _bone = prev; }
    else { _boneSel.value = names[0]; _bone = names[0]; }
    _updatePaintAvailability();
  }

  /* Model không có skin thì báo rõ "không tô được" + khóa nút cọ. */
  function _updatePaintAvailability() {
    var meshes = _getSkinnedMeshes();
    var pv = _getPreview();
    var msg;
    if (!pv || !pv.group) msg = 'Chưa có model trong preview — nhập file .fbx/.glb trước.';
    else if (!meshes.length) msg = 'Model này không có xương/skin (mesh-only) — không tô được trọng số.';
    else if (!_bone) msg = 'Chọn 1 xương để tô trọng số.';
    else msg = 'Đang tô xương: ' + _bone + ' — ' + meshes.length + ' mesh có skin. Bật cọ rồi bấm/kéo lên model trong khung xem trước.';
    _setStatus(msg);
    if (_paintBtn) _paintBtn.disabled = (!meshes.length || !_bone);
    if (_undoBtn) _undoBtn.disabled = !_undoStack.length;
    if (_resetBtn) _resetBtn.disabled = !_originals.length;
  }

  function _applyModeUI() {
    for (var k in _modeBtns) {
      var b = _modeBtns[k];
      if (!b) continue;
      if (b.classList) b.classList.toggle('active', k === _mode);
    }
  }

  /* Gắn pointer events tô lên canvas preview (gọi khi bật cọ / refresh;
     chỉ gắn 1 lần cho mỗi canvas). */
  function _bindCanvas() {
    var pv = _getPreview();
    if (!pv || !pv.renderer || !pv.renderer.domElement || typeof THREE === 'undefined') return false;
    var cv = pv.renderer.domElement;
    if (cv._edWeightBound) return true;
    cv._edWeightBound = true;
    var raycaster = new THREE.Raycaster();
    var ndc = new THREE.Vector2();
    function hitAt(e) {
      var meshes = _getSkinnedMeshes();
      if (!meshes.length) return null;
      var rect = cv.getBoundingClientRect();
      var cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
      var cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
      ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, pv.camera);
      var hits = null;
      try { hits = raycaster.intersectObjects(meshes, false); } catch (err) { hits = null; }
      if (!hits || !hits.length) return null;
      return { mesh: hits[0].object, point: [hits[0].point.x, hits[0].point.y, hits[0].point.z] };
    }
    cv.addEventListener('pointerdown', function (e) {
      if (!_paintEnabled || _painting) return;
      if (pv.ik && pv.ik.dragging) return; /* đang kéo IK thì không tô */
      var hit = hitAt(e);
      if (!hit) return;
      if (!_ensureOriginal(hit.mesh)) { _toast('Không đọc được skinWeight của mesh này — không tô được.'); return; }
      /* Tạm dừng clip: raycast r128 không tính biến dạng skinning. */
      try { if (ED.Character && typeof ED.Character.pauseClip === 'function') ED.Character.pauseClip(); } catch (err) {}
      var data = _readMeshWeights(hit.mesh);
      if (data) {
        _undoStack.push({ mesh: hit.mesh, snapshot: edWeightSnapshotWeights(data.weights) });
        while (_undoStack.length > UNDO_MAX) _undoStack.shift();
      }
      _painting = true;
      _paintMesh = hit.mesh;
      var n = _paintAt(hit.mesh, hit.point);
      if (pv.drag) pv.drag = null; /* chặn xoay camera của Character trong lúc tô */
      if (n > 0) { refreshHeatmap(); _setStatus('Đã tô ' + n + ' đỉnh (xương ' + _bone + ', cọ ' + _mode + ').'); }
      _updatePaintAvailability();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!_painting || !_paintMesh) return;
      var hit = hitAt(e);
      if (!hit || hit.mesh !== _paintMesh) return;
      var n = _paintAt(hit.mesh, hit.point);
      if (n > 0) refreshHeatmap();
    });
    function endStroke() {
      if (!_painting) return;
      _painting = false;
      _paintMesh = null;
      _pushHistory('Weight paint');
      _updatePaintAvailability();
    }
    cv.addEventListener('pointerup', endStroke);
    cv.addEventListener('pointercancel', endStroke);
    return true;
  }

  function setPaintEnabled(on) {
    _paintEnabled = !!on;
    if (_paintEnabled) {
      var ok = _bindCanvas();
      if (!ok) {
        _paintEnabled = false;
        _toast('Chưa có khung xem trước (preview) để tô — nhập model trước.');
        if (_paintBtn) _paintBtn.textContent = '🖌 Bật cọ tô';
        return false;
      }
      _updatePaintAvailability();
      if (!_getSkinnedMeshes().length) {
        _paintEnabled = false;
        _toast('Model này không có xương/skin (mesh-only) — không tô được.');
        if (_paintBtn) _paintBtn.textContent = '🖌 Bật cọ tô';
        return false;
      }
    }
    if (_paintBtn) {
      _paintBtn.textContent = _paintEnabled ? '🖌 Đang tô — bấm để tắt cọ' : '🖌 Bật cọ tô';
      if (_paintBtn.classList) _paintBtn.classList.toggle('active', _paintEnabled);
    }
    return _paintEnabled;
  }

  /* Hoàn tác stroke weight gần nhất (stack riêng — Ctrl+Z của editor
     không hoàn tác được weight vì skinWeight không nằm trong project). */
  function undoWeight() {
    var entry = _undoStack.pop();
    if (!entry) { _toast('Không còn bước tô nào để hoàn tác.'); return false; }
    var data = _readMeshWeights(entry.mesh);
    if (!data) { _toast('Không đọc được mesh để hoàn tác.'); return false; }
    edWeightRestoreWeights(data.weights, entry.snapshot);
    if (!_writeMeshWeights(entry.mesh, data.weights)) { _toast('Không ghi lại được trọng số khi hoàn tác.'); return false; }
    refreshHeatmap();
    _pushHistory('Hoàn tác weight paint');
    _setStatus('Đã hoàn tác 1 bước tô (xương ' + _bone + ').');
    _updatePaintAvailability();
    return true;
  }

  /* Khôi phục toàn bộ trọng số gốc (snapshot lúc chạm đầu tiên) cho
     mọi mesh đã tô. Đẩy trạng thái hiện tại vào stack hoàn tác trước. */
  function resetWeights() {
    if (!_originals.length) { _toast('Chưa có snapshot gốc — chưa tô mesh nào.'); return false; }
    var n = 0;
    _originals.forEach(function (entry) {
      var data = _readMeshWeights(entry.mesh);
      if (!data) return;
      _undoStack.push({ mesh: entry.mesh, snapshot: edWeightSnapshotWeights(data.weights) });
      while (_undoStack.length > UNDO_MAX) _undoStack.shift();
      edWeightRestoreWeights(data.weights, entry.snapshot);
      if (_writeMeshWeights(entry.mesh, data.weights)) n++;
    });
    refreshHeatmap();
    _pushHistory('Reset weight về gốc');
    _setStatus(n ? ('Đã reset trọng số về gốc (' + n + ' mesh).') : 'Reset thất bại — không ghi lại được trọng số.');
    _toast(n ? 'Đã reset trọng số về gốc.' : 'Reset trọng số thất bại.');
    _updatePaintAvailability();
    return n > 0;
  }

  function refresh() {
    _refreshBoneSelect();
    if (_paintEnabled) _bindCanvas();
    _updatePaintAvailability();
  }

  function init(container) {
    if (_inited || typeof document === 'undefined') return false;
    _inited = true;
    var host = container || null;
    if (!host) {
      host = document.querySelector('[data-ed-panel="character"]')
        || document.getElementById('ed-panel-character')
        || document.getElementById('ed-tab-character')
        || document.getElementById('tab-character')
        || document.getElementById('panel-bottom')
        || document.body;
    }
    var panel = document.createElement('div');
    panel.className = 'ed-weight-panel';
    panel.style.marginTop = '10px';
    panel.style.padding = '10px';
    panel.style.border = '1px solid #4b5563';
    panel.style.borderRadius = '8px';
    host.appendChild(panel);
    _panel = panel;

    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = text;
      return e;
    }
    function bigBtn(text) {
      var b = el('button', 'ed-btn', text);
      b.type = 'button';
      b.style.minHeight = '40px';
      b.style.minWidth = '40px';
      return b;
    }

    panel.appendChild(el('h3', null, '🎨 Tô trọng số (Weight Paint)'));
    _statusEl = el('div', 'ed-char-hint', 'Chưa có model — nhập file .fbx/.glb trước.');
    panel.appendChild(_statusEl);

    var rowBone = el('div', 'ed-row');
    rowBone.appendChild(el('label', null, 'Xương:'));
    _boneSel = el('select');
    _boneSel.style.flex = '1';
    _boneSel.style.minHeight = '40px';
    _boneSel.addEventListener('change', function () {
      _bone = _boneSel.value || null;
      refreshHeatmap();
      _updatePaintAvailability();
    });
    rowBone.appendChild(_boneSel);
    panel.appendChild(rowBone);

    var rowSize = el('div', 'ed-row');
    rowSize.appendChild(el('label', null, 'Cỡ cọ:'));
    _sizeInput = el('input');
    _sizeInput.type = 'range'; _sizeInput.min = '0.05'; _sizeInput.max = '1'; _sizeInput.step = '0.05';
    _sizeInput.value = String(_size);
    _sizeInput.style.flex = '1';
    _sizeVal = el('span', null, _size.toFixed(2));
    _sizeInput.addEventListener('input', function () {
      _size = _edWClamp(Number(_sizeInput.value), 0.05, 1);
      _sizeVal.textContent = _size.toFixed(2);
    });
    rowSize.appendChild(_sizeInput);
    rowSize.appendChild(_sizeVal);
    panel.appendChild(rowSize);

    var rowStr = el('div', 'ed-row');
    rowStr.appendChild(el('label', null, 'Lực tô:'));
    _strInput = el('input');
    _strInput.type = 'range'; _strInput.min = '0'; _strInput.max = '1'; _strInput.step = '0.05';
    _strInput.value = String(_strength);
    _strInput.style.flex = '1';
    _strVal = el('span', null, _strength.toFixed(2));
    _strInput.addEventListener('input', function () {
      _strength = _edWClamp(Number(_strInput.value), 0, 1);
      _strVal.textContent = _strength.toFixed(2);
    });
    rowStr.appendChild(_strInput);
    rowStr.appendChild(_strVal);
    panel.appendChild(rowStr);

    var rowMode = el('div', 'ed-row');
    rowMode.appendChild(el('label', null, 'Chế độ:'));
    var modes = [['add', '➕ Cộng'], ['subtract', '➖ Trừ'], ['smooth', '〰 Làm mịn']];
    modes.forEach(function (m) {
      var b = bigBtn(m[1]);
      b.style.flex = '1';
      b.addEventListener('click', function () {
        _mode = m[0];
        _applyModeUI();
      });
      _modeBtns[m[0]] = b;
      rowMode.appendChild(b);
    });
    panel.appendChild(rowMode);
    _applyModeUI();

    _paintBtn = bigBtn('🖌 Bật cọ tô');
    _paintBtn.style.width = '100%';
    _paintBtn.addEventListener('click', function () { setPaintEnabled(!_paintEnabled); });
    panel.appendChild(_paintBtn);

    var rowAct = el('div', 'ed-row');
    _undoBtn = bigBtn('↩ Hoàn tác weight');
    _undoBtn.style.flex = '1';
    _undoBtn.addEventListener('click', function () { undoWeight(); });
    _resetBtn = bigBtn('↺ Reset weight về gốc');
    _resetBtn.style.flex = '1';
    _resetBtn.addEventListener('click', function () { resetWeights(); });
    rowAct.appendChild(_undoBtn);
    rowAct.appendChild(_resetBtn);
    panel.appendChild(rowAct);

    var refreshBtn = bigBtn('↻ Làm mới danh sách xương');
    refreshBtn.style.width = '100%';
    refreshBtn.addEventListener('click', function () { refresh(); _toast('Đã làm mới danh sách xương.'); });
    panel.appendChild(refreshBtn);

    panel.appendChild(el('div', 'ed-char-hint',
      'Cách dùng: chọn xương → bật cọ → bấm/kéo lên model trong khung xem trước. ' +
      'Cộng tăng ảnh hưởng của xương, Trừ giảm, Làm mịn trung bình với đỉnh kề. ' +
      'Sau mỗi nét tô, tổng trọng số mỗi đỉnh được chuẩn hoá về 1. ' +
      'Bấm "Hoàn tác weight" để lùi 1 nét tô (Ctrl+Z của editor không lùi được weight). ' +
      'Trọng số tô chỉ sống trong phiên preview — xuất lại model mới giữ được.'));
    refresh();
    return true;
  }

  return {
    init: init, refresh: refresh,
    setPaintEnabled: setPaintEnabled, isPaintEnabled: function () { return _paintEnabled; },
    setBone: function (name) { _bone = name || null; if (_boneSel) _boneSel.value = _bone || ''; _updatePaintAvailability(); return _bone; },
    getBone: function () { return _bone; },
    setBrush: function (size, strength) {
      if (isFinite(Number(size))) _size = _edWClamp(Number(size), 0.05, 1);
      if (isFinite(Number(strength))) _strength = _edWClamp(Number(strength), 0, 1);
      if (_sizeInput) _sizeInput.value = String(_size);
      if (_strInput) _strInput.value = String(_strength);
      if (_sizeVal) _sizeVal.textContent = _size.toFixed(2);
      if (_strVal) _strVal.textContent = _strength.toFixed(2);
      return { size: _size, strength: _strength };
    },
    setMode: function (mode) {
      if (mode === 'add' || mode === 'subtract' || mode === 'smooth') _mode = mode;
      _applyModeUI();
      return _mode;
    },
    getMode: function () { return _mode; },
    undoWeight: undoWeight, resetWeights: resetWeights,
    refreshHeatmap: refreshHeatmap,
    getSkinnedMeshes: _getSkinnedMeshes, getBoneNames: _getBoneNames,
    paintAt: _paintAt,
    /* Hàm thuần (harness test bằng vm). */
    paintWeights: edWeightPaintWeights,
    normalizeWeights: edWeightNormalizeWeights,
    smoothWeights: edWeightSmoothWeights,
    snapshotWeights: edWeightSnapshotWeights,
    restoreWeights: edWeightRestoreWeights,
    weightsFromSkin: edWeightWeightsFromSkin,
    weightsToSkin: edWeightWeightsToSkin
  };
})();
