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
   GIỚI HẠN: chưa render thử trên trình duyệt/điện thoại thật.
   ĐỢT 3 (skeleton nâng cao, chỉ sửa file này):
   (a) IK 2 xương thật — edCharSolveTwoBoneIK (thuần) + applyIk: kéo quả
       cầu cam trong preview để kéo tay/chân, có bật/tắt IK từng chi.
   (b) Bone weight heatmap — đọc skinIndex/skinWeight thật của SkinnedMesh,
       tô màu theo trọng số xương đang chọn (đỏ mạnh, xanh yếu, xám = 0).
   (c) Constraint xoay — giới hạn min/max từng trục (độ) theo khớp người,
       lưu vào characters[].boneConstraints (project cũ không có -> mặc
       định, vẫn mở được); kẹp khi xoay tay/IK, tính theo delta so với tư
       thế gốc lúc load model (không kẹp tuyệt đối để khỏi bẻ tư thế nghỉ).
   GIỚI HẠN ĐỢT 3: IK/heatmap/constraint mới chỉ test bằng vm (logic thuần)
   + đọc code THREE r128, CHƯA render thử trên trình duyệt/điện thoại thật;
   IK chỉ xoay 2 xương của chi đang chọn, không giải toàn thân (full-body);
   heatmap cần mesh có skinning (SkinnedMesh), mesh-only không xương thì
   không tô được; constraint không chặn clip animation đang phát.
   ĐỢT 4 (skeleton nâng cấp, chỉ sửa file này):
   (a) Panel số liệu bone weight — computeBoneWeightStats (thuần): top 10
       vertex, min/max/trung bình, số đỉnh > 0.5 / > 0; model không skin
       thì báo rõ "Model này không có xương/skin", không hiện số 0 gây
       hiểu lầm.
   (b) Retarget clip Mixamo theo tên xương — retargetClip (thuần): map
       track theo tên xương (cả dạng 'mixamorig:X.prop' lẫn
       '.bones[mixamorig:X].prop'), bỏ track xương thiếu, liệt kê xương
       thiếu; KHÔNG tạo xương mới, chỉ Mixamo→Mixamo cùng tên xương.
   GIỚI HẠN ĐỢT 4: retarget chỉ map theo tên (không khớp tư thế, không
   khác hệ xương); clip retarget phát bằng mixer thường nên constraint
   đợt 3 không chặn; số liệu bone weight lấy từ mesh đầu tiên có xương đó.
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
    hp: 100, atk: 10, def: 5, speed: 5, fbxKey: null, color: '#334155',
    boneConstraints: {} /* đợt 3: { boneName: {min:[x,y,z], max:[x,y,z]} (độ, delta so với tư thế gốc) } */
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

/* ---------------- Skeleton nâng cao — đợt 3 (logic thuần) ----------------
   (a) IK 2 xương, (b) bone weight, (c) constraint xoay. Tất cả hàm ở đây
   KHÔNG dùng DOM/THREE — test được bằng vm. Góc: IK trả radian;
   constraint dùng ĐỘ (dễ nhập trong panel), đổi qua lại bằng
   edCharDegToRad / edCharRadToDeg. */

function edCharDegToRad(d) { return Number(d) * Math.PI / 180; }
function edCharRadToDeg(r) { return Number(r) * 180 / Math.PI; }

function _edV3(x, y, z) { return [Number(x) || 0, Number(y) || 0, Number(z) || 0]; }
function _edV3Sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function _edV3Add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function _edV3Scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function _edV3Len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function _edV3Dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function _edV3Cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function _edV3Norm(a) { var l = _edV3Len(a); return l > 1e-9 ? _edV3Scale(a, 1 / l) : [0, 0, 0]; }
function _edClamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ---- (a) IK 2 xương (định lý cos) ----
   rootPos: vị trí gốc khớp [x,y,z]; len1/len2: độ dài 2 đoạn xương;
   targetPos: vị trí đích; poleDir (tùy chọn): hướng khuỷu/gối bẻ về
   (mặc định [0,0,1]).
   Trả null nếu độ dài xương không hợp lệ; ngược lại trả:
   { reachable, clamped (target ngoài tầm với), distance,
     rootAngle (rad, góc tại gốc giữa hướng tới target và hướng tới
       khớp giữa; 0 = duỗi thẳng),
     elbowAngle (rad, góc TRONG tại khớp giữa; PI = duỗi thẳng, 0 = gập hẳn),
     bendAngle (rad, = PI - elbowAngle),
     midPos (vị trí khớp giữa sau IK), endPos (vị trí đầu cuối sau IK) }.
   Target trong tầm: endPos == target (sai số làm tròn). Target ngoài tầm:
   chuỗi duỗi thẳng theo hướng target, endPos = root + dir*(len1+len2). */
function edCharSolveTwoBoneIK(rootPos, len1, len2, targetPos, poleDir) {
  if (!rootPos || !targetPos) return null;
  var R = _edV3(rootPos[0], rootPos[1], rootPos[2]);
  var T = _edV3(targetPos[0], targetPos[1], targetPos[2]);
  var L1 = Number(len1), L2 = Number(len2);
  if (!isFinite(L1) || !isFinite(L2) || L1 <= 0 || L2 <= 0) return null;
  var pole = (poleDir && isFinite(Number(poleDir[0])) && isFinite(Number(poleDir[1])) && isFinite(Number(poleDir[2])))
    ? _edV3(poleDir[0], poleDir[1], poleDir[2]) : [0, 0, 1];
  if (_edV3Len(pole) < 1e-9) pole = [0, 0, 1];
  pole = _edV3Norm(pole);
  var toT = _edV3Sub(T, R);
  var d = _edV3Len(toT);
  var reachable = d <= L1 + L2 + 1e-9;
  var dEff = reachable ? d : L1 + L2;
  var dir = d > 1e-9 ? _edV3Scale(toT, 1 / d) : pole; /* target trùng gốc: hướng = pole */
  /* Hướng vuông góc với dir, gần pole nhất (mặt phẳng uốn của IK). */
  var perp = _edV3Sub(pole, _edV3Scale(dir, _edV3Dot(pole, dir)));
  if (_edV3Len(perp) < 1e-6) {
    /* Pole song song với hướng target: lấy 1 trục vuông góc bất kỳ. */
    var ax = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    perp = _edV3Sub(ax, _edV3Scale(dir, _edV3Dot(ax, dir)));
  }
  perp = _edV3Norm(perp);
  var endPos, midPos, elbowAngle, rootAngle;
  if (d < 1e-9) {
    /* Target trùng gốc: gập hẳn (đầu cuối về gốc), khớp giữa bẻ theo perp. */
    endPos = R.slice();
    midPos = _edV3Add(R, _edV3Scale(perp, L1));
    elbowAngle = 0;
    rootAngle = Math.PI / 2;
  } else {
    var a1 = _edClamp((L1 * L1 + dEff * dEff - L2 * L2) / (2 * dEff), -L1, L1);
    var h = Math.sqrt(Math.max(0, L1 * L1 - a1 * a1));
    midPos = _edV3Add(_edV3Add(R, _edV3Scale(dir, a1)), _edV3Scale(perp, h));
    endPos = reachable ? T.slice() : _edV3Add(R, _edV3Scale(dir, L1 + L2));
    var cosE = _edClamp((L1 * L1 + L2 * L2 - dEff * dEff) / (2 * L1 * L2), -1, 1);
    elbowAngle = Math.acos(cosE);
    var toMid = _edV3Sub(midPos, R);
    rootAngle = Math.acos(_edClamp(_edV3Dot(_edV3Norm(toMid), dir), -1, 1));
  }
  return {
    reachable: reachable, clamped: !reachable, distance: d,
    rootAngle: rootAngle, elbowAngle: elbowAngle, bendAngle: Math.PI - elbowAngle,
    midPos: midPos, endPos: endPos
  };
}

/* ---- Định nghĩa 4 chi IK (tên xương Mixamo, pole theo hệ cục bộ nhân vật:
   nhân vật nhìn về +Z: khuỷu tay bẻ về sau (-Z), đầu gối bẻ về trước (+Z)). ---- */
var ED_CHAR_IK_LIMBS = [
  { key: 'leftArm', label: 'Tay trái', root: 'LeftArm', mid: 'LeftForeArm', end: 'LeftHand', pole: [0, 0, -1] },
  { key: 'rightArm', label: 'Tay phải', root: 'RightArm', mid: 'RightForeArm', end: 'RightHand', pole: [0, 0, -1] },
  { key: 'leftLeg', label: 'Chân trái', root: 'LeftUpLeg', mid: 'LeftLeg', end: 'LeftFoot', pole: [0, 0, 1] },
  { key: 'rightLeg', label: 'Chân phải', root: 'RightUpLeg', mid: 'RightLeg', end: 'RightFoot', pole: [0, 0, 1] }
];

function _edStripBonePrefix(name) { return String(name || '').replace(/^mixamorig:/i, ''); }

function edCharIkLimbDefs() {
  return ED_CHAR_IK_LIMBS.map(function (d) {
    return { key: d.key, label: d.label, root: d.root, mid: d.mid, end: d.end, pole: d.pole.slice() };
  });
}

/* Tìm 3 xương của 1 chi từ danh sách bones (kiểu collectBones hoặc object
   xương thật): khớp theo tên đã bỏ prefix 'mixamorig:'.
   Trả {key, label, root, mid, end, pole} (root/mid/end là phần tử gốc
   trong danh sách) hoặc null nếu thiếu xương. */
function edCharFindIkChain(bones, limbKey) {
  var def = null;
  for (var i = 0; i < ED_CHAR_IK_LIMBS.length; i++) {
    if (ED_CHAR_IK_LIMBS[i].key === limbKey) { def = ED_CHAR_IK_LIMBS[i]; break; }
  }
  if (!def || !bones) return null;
  var list = Array.isArray(bones) ? bones : [];
  function find(want) {
    for (var j = 0; j < list.length; j++) {
      if (list[j] && _edStripBonePrefix(list[j].name) === want) return list[j];
    }
    return null;
  }
  var root = find(def.root), mid = find(def.mid), end = find(def.end);
  if (!root || !mid || !end) return null;
  return { key: def.key, label: def.label, root: root, mid: mid, end: end, pole: def.pole.slice() };
}

/* ---- (b) Bone weight ----
   skinIndex/skinWeight: mảng 4 phần tử của 1 đỉnh (theo thứ tự
   geometry.attributes.skinIndex/skinWeight). Trả tổng trọng số của
   xương boneIndex tại đỉnh đó, kẹp 0..1. */
function edCharBoneWeightForVertex(skinIndex, skinWeight, boneIndex) {
  if (!skinIndex || !skinWeight) return 0;
  var bi = Number(boneIndex);
  var w = 0;
  for (var i = 0; i < 4; i++) {
    var idx = skinIndex[i];
    var wt = Number(skinWeight[i]);
    if ((idx === bi || Number(idx) === bi) && isFinite(wt) && wt > 0) w += wt;
  }
  return _edClamp(w, 0, 1);
}

/* Màu heatmap theo trọng số w (0..1): 0 = xám (không ảnh hưởng),
   còn lại nội suy xanh (yếu) -> tím -> đỏ (mạnh). Trả [r, g, b] 0..1. */
function edCharWeightToColor(w) {
  var n = Number(w);
  if (!isFinite(n) || n <= 0) return [0.5, 0.5, 0.5];
  n = _edClamp(n, 0, 1);
  return [n, 0, 1 - n];
}

function _edSkinAttrArray(attr) {
  if (!attr) return null;
  if (attr.array) return attr.array;
  if (typeof attr.length === 'number') return attr; /* mảng thường */
  return null;
}

/* Lấy trọng số của 1 xương cho TOÀN BỘ đỉnh của geometry (SkinnedMesh):
   đọc attributes.skinIndex + skinWeight thật. Trả
   {count, weights:[w0..]} hoặc null nếu geometry không có skinning.
   count ưu tiên skinIndex.count, rồi position.count. */
function edCharComputeBoneWeights(geometry, boneIndex) {
  if (!geometry || !geometry.attributes) return null;
  var si = _edSkinAttrArray(geometry.attributes.skinIndex);
  var sw = _edSkinAttrArray(geometry.attributes.skinWeight);
  if (!si || !sw) return null;
  var attrs = geometry.attributes;
  var count = 0;
  if (attrs.skinIndex && isFinite(Number(attrs.skinIndex.count))) count = Number(attrs.skinIndex.count);
  else if (attrs.position && isFinite(Number(attrs.position.count))) count = Number(attrs.position.count);
  else count = Math.floor(Math.min(si.length, sw.length) / 4);
  if (count <= 0) return null;
  var weights = [];
  for (var v = 0; v < count; v++) {
    var base = v * 4;
    weights.push(edCharBoneWeightForVertex(
      [si[base], si[base + 1], si[base + 2], si[base + 3]],
      [sw[base], sw[base + 1], sw[base + 2], sw[base + 3]],
      boneIndex));
  }
  return { count: count, weights: weights };
}

/* ---- Đợt 4 (a) Panel số liệu bone weight ----
   Thống kê trọng số của 1 xương trên toàn bộ đỉnh của geometry.
   Trả null khi geometry KHÔNG có skinning (không có skinIndex/
   skinWeight) — để panel báo rõ "Model này không có xương/skin"
   thay vì hiện số 0 gây hiểu lầm. Ngược lại trả:
   {count, top:[{vi, w}] (tối đa 10 đỉnh w > 0, giảm dần theo w,
     hòa thì vi nhỏ trước), min, max, avg,
    countOver05 (w > 0.5), countOver0 (w > 0)}.
   min/max/avg tính trên TẤT CẢ đỉnh (kể cả w = 0). */
function edCharComputeBoneWeightStats(geometry, boneIndex) {
  var res = edCharComputeBoneWeights(geometry, boneIndex);
  if (!res || !res.weights || !res.weights.length) return null;
  var w = res.weights;
  var n = w.length;
  var min = Infinity, max = -Infinity, sum = 0, c05 = 0, c0 = 0;
  var top = [];
  for (var i = 0; i < n; i++) {
    var v = w[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    if (v > 0.5) c05++;
    if (v > 0) { c0++; top.push({ vi: i, w: v }); }
  }
  top.sort(function (a, b) { return (b.w - a.w) || (a.vi - b.vi); });
  if (top.length > 10) top.length = 10;
  return { count: n, top: top, min: min, max: max, avg: sum / n, countOver05: c05, countOver0: c0 };
}

/* ---- (c) Constraint xoay (đơn vị ĐỘ) ----
   Giới hạn là DELTA xoay thêm so với tư thế gốc lúc load model
   (xem edCharClampRotationDeg): khớp người mặc định theo tên xương. */
function edCharNormalizeBoneConstraint(c) {
  var d = { min: [-180, -180, -180], max: [180, 180, 180] };
  if (!c || typeof c !== 'object') return d;
  for (var i = 0; i < 3; i++) {
    var lo = Number(c.min && c.min[i]), hi = Number(c.max && c.max[i]);
    if (!isFinite(lo)) lo = -180;
    if (!isFinite(hi)) hi = 180;
    lo = _edClamp(lo, -180, 180);
    hi = _edClamp(hi, -180, 180);
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    d.min[i] = lo;
    d.max[i] = hi;
  }
  return d;
}

function edCharDefaultBoneConstraint(boneName) {
  var n = _edStripBonePrefix(boneName);
  function C(mx, my, mz, Mx, My, Mz) { return { min: [mx, my, mz], max: [Mx, My, Mz] }; }
  if (/^hips$/i.test(n)) return C(-30, -45, -30, 30, 45, 30);
  if (/spine/i.test(n)) return C(-25, -30, -25, 25, 30, 25);
  if (/chest/i.test(n)) return C(-20, -25, -20, 20, 25, 20);
  if (/neck/i.test(n)) return C(-30, -40, -30, 30, 40, 30);
  if (/head/i.test(n)) return C(-45, -60, -45, 45, 60, 45);
  if (/shoulder/i.test(n)) return C(-90, -90, -90, 90, 90, 90);
  if (/forearm/i.test(n)) return C(-10, -30, -30, 140, 30, 30); /* khuỷu: gập chủ yếu 1 trục */
  if (/arm/i.test(n)) return C(-90, -90, -90, 90, 90, 90);
  if (/hand/i.test(n)) return C(-60, -60, -60, 60, 60, 60);
  if (/finger|thumb/i.test(n)) return C(-90, -20, -20, 10, 20, 20);
  if (/upleg|upperleg|thigh/i.test(n)) return C(-100, -60, -60, 30, 60, 60);
  if (/leg/i.test(n)) return C(-140, -20, -20, 10, 20, 20); /* gối: gập về sau */
  if (/foot|toe/i.test(n)) return C(-50, -30, -30, 50, 30, 30);
  return C(-180, -180, -180, 180, 180, 180);
}

/* Kẹp góc xoay [x, y, z] (độ) vào constraint.
   - Không có restDeg: kẹp TUYỆT ĐỐI vào [min, max].
   - Có restDeg (tư thế gốc, độ): kẹp DELTA (rot - rest) vào [min, max],
     trả về rest + delta đã kẹp. (Không wrap delta về [-180, 180]: delta
     190° phải kẹp về max, không được nhảy thành -170°.) */
function edCharClampRotationDeg(rotDeg, constraint, restDeg) {
  var c = edCharNormalizeBoneConstraint(constraint);
  var out = [0, 0, 0];
  for (var i = 0; i < 3; i++) {
    var r = Number(rotDeg && rotDeg[i]);
    if (!isFinite(r)) r = 0;
    if (restDeg && isFinite(Number(restDeg[i]))) {
      var rest = Number(restDeg[i]);
      var delta = _edClamp(r - rest, c.min[i], c.max[i]);
      out[i] = rest + delta;
    } else {
      out[i] = _edClamp(r, c.min[i], c.max[i]);
    }
  }
  return out;
}

/* Đọc constraint của 1 xương từ dữ liệu nhân vật (characters[]):
   project cũ không có boneConstraints -> mặc định theo khớp. */
function edCharGetBoneConstraint(charData, boneName) {
  if (charData && charData.boneConstraints && charData.boneConstraints[boneName]) {
    return edCharNormalizeBoneConstraint(charData.boneConstraints[boneName]);
  }
  return edCharDefaultBoneConstraint(boneName);
}

/* Ghi constraint vào dữ liệu nhân vật (tạo boneConstraints nếu chưa có).
   Trả bản đã chuẩn hoá đã lưu, hoặc null nếu không có charData. */
function edCharSetBoneConstraint(charData, boneName, constraint) {
  if (!charData || typeof charData !== 'object' || !boneName) return null;
  var c = edCharNormalizeBoneConstraint(constraint);
  if (!charData.boneConstraints || typeof charData.boneConstraints !== 'object') charData.boneConstraints = {};
  charData.boneConstraints[boneName] = { min: c.min.slice(), max: c.max.slice() };
  return charData.boneConstraints[boneName];
}

/* ---------------- Retarget clip Mixamo — đợt 4 (logic thuần) ----------------
   Chỉ map theo TÊN XƯƠNG, Mixamo→Mixamo cùng tên xương. KHÔNG tạo xương
   mới, KHÔNG retarget khác hệ xương (tên khác nhau = xương thiếu, track
   bị bỏ). Track giữ nguyên tên khi khớp đúng tên; khớp lệch prefix
   (vd track 'LeftArm.quaternion' mà rig đích là 'mixamorig:LeftArm')
   thì đổi tên track sang tên chuẩn của rig đích để mixer bắt được. */

/* Tách tên xương khỏi tên track three.js:
   '.bones[mixamorig:LeftArm].quaternion' -> 'mixamorig:LeftArm'
   'mixamorig:LeftArm.quaternion'         -> 'mixamorig:LeftArm'
   '.position' / 'position' (không có tên node) -> null. */
function edCharTrackBoneName(trackName) {
  if (typeof trackName !== 'string' || !trackName) return null;
  var m = trackName.match(/\.bones\[([^\]]+)\]/);
  if (m && m[1]) return m[1];
  var dot = trackName.indexOf('.');
  if (dot > 0) return trackName.slice(0, dot);
  return null;
}

function _edNameLookup(names) {
  var exact = {}, stripped = {};
  (names || []).forEach(function (n) {
    var s = String(n);
    if (!exact[s]) exact[s] = s;
    var st = _edStripBonePrefix(s);
    if (!stripped[st]) stripped[st] = s; /* gặp trước thắng */
  });
  return { exact: exact, stripped: stripped };
}

function _edLookupBone(lk, bone) {
  if (!lk || bone === null || bone === undefined) return null;
  var b = String(bone);
  if (lk.exact[b]) return lk.exact[b];
  return lk.stripped[_edStripBonePrefix(b)] || null;
}

/* Đổi phần tên xương trong tên track sang tên mới (giữ nguyên hậu tố
   '.quaternion'/'.position'/...). Track không khớp dạng nào thì giữ nguyên. */
function _edRenameTrackBone(trackName, oldBone, newBone) {
  var oldB = String(oldBone), newB = String(newBone);
  var marker = '.bones[' + oldB + ']';
  var at = trackName.indexOf(marker);
  if (at >= 0) return trackName.slice(0, at) + '.bones[' + newB + ']' + trackName.slice(at + marker.length);
  if (trackName.indexOf(oldB + '.') === 0) return newB + trackName.slice(oldB.length);
  return trackName;
}

/* Retarget 1 clip (dạng object thuần {name, duration, tracks:[{name,
   times, values}]}) sang rig đích:
   - sourceBoneNames: tên xương rig nguồn (để biết track nào là track
     xương nguồn; không truyền / rỗng thì mọi track có tên xương đều
     được coi là track xương nguồn và chỉ kiểm tra với rig đích).
   - targetBoneNames: tên xương rig đích (pv.bones).
   Trả {clip: {name, duration, tracks} (mới, không sửa clip gốc),
         missing: [tên xương nguồn bị thiếu trong rig đích (mỗi tên 1 lần,
           theo thứ tự xuất hiện đầu tiên)],
         mapped: số track có trong clip mới} — luôn có
   clip.tracks.length === mapped. Track hỏng (không có name) bị bỏ qua,
   không đếm. Track không thuộc xương (vd '.position' của node gốc,
   hoặc node không có trong rig nguồn) được giữ nguyên. */
function edCharRetargetClip(clip, sourceBoneNames, targetBoneNames) {
  var name = (clip && typeof clip.name === 'string' && clip.name) ? clip.name : 'Clip';
  var duration = (clip && isFinite(Number(clip.duration))) ? Number(clip.duration) : 0;
  var tracks = (clip && Array.isArray(clip.tracks)) ? clip.tracks : [];
  var targetLk = _edNameLookup(targetBoneNames);
  var sourceKnown = Array.isArray(sourceBoneNames) && sourceBoneNames.length > 0;
  var sourceLk = sourceKnown ? _edNameLookup(sourceBoneNames) : null;
  var out = [], missing = [], missingSeen = {};
  var mapped = 0;
  function keep(t, newName) {
    out.push({
      name: (newName !== undefined) ? newName : t.name,
      times: Array.prototype.slice.call(t.times || []),
      values: Array.prototype.slice.call(t.values || [])
    });
    mapped++;
  }
  tracks.forEach(function (t) {
    if (!t || typeof t.name !== 'string' || !t.name) return; /* track hỏng: bỏ */
    var bone = edCharTrackBoneName(t.name);
    if (bone === null) { keep(t); return; } /* track không thuộc xương: giữ */
    if (sourceKnown && !_edLookupBone(sourceLk, bone)) { keep(t); return; } /* node ngoài rig nguồn: giữ */
    var targetName = _edLookupBone(targetLk, bone);
    if (targetName) {
      keep(t, (targetName === bone) ? t.name : _edRenameTrackBone(t.name, bone, targetName));
    } else {
      var canon = _edLookupBone(sourceLk, bone) || bone;
      if (!missingSeen[canon]) { missingSeen[canon] = true; missing.push(canon); }
    }
  });
  return { clip: { name: name, duration: duration, tracks: out }, missing: missing, mapped: mapped };
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
  /* Đợt 3 — skeleton nâng cao (hàm thuần, test được bằng vm). */
  degToRad: edCharDegToRad,
  radToDeg: edCharRadToDeg,
  solveTwoBoneIK: edCharSolveTwoBoneIK,
  ikLimbDefs: edCharIkLimbDefs,
  findIkChainInList: edCharFindIkChain,
  boneWeightForVertex: edCharBoneWeightForVertex,
  weightToColor: edCharWeightToColor,
  computeBoneWeights: edCharComputeBoneWeights,
  /* Đợt 4 — skeleton nâng cấp (hàm thuần, test được bằng vm). */
  computeBoneWeightStats: edCharComputeBoneWeightStats,
  trackBoneName: edCharTrackBoneName,
  retargetClip: edCharRetargetClip,
  defaultBoneConstraint: edCharDefaultBoneConstraint,
  normalizeBoneConstraint: edCharNormalizeBoneConstraint,
  clampRotationDeg: edCharClampRotationDeg,
  getBoneConstraint: edCharGetBoneConstraint,
  setBoneConstraint: edCharSetBoneConstraint,
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
      self._bankRetargetClips(id, file.name, parsed.animations); /* đợt 4: giữ clip làm nguồn retarget */
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
    /* Đợt 3 — quả cầu target IK (cam): kéo nó để kéo tay/chân theo. */
    var ikTarget = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a })
    );
    ikTarget.visible = false;
    scene.add(ikTarget);
    var self = this;
    var pv = {
      renderer: renderer, scene: scene, camera: camera, group: null,
      mixer: null, action: null, clips: [], bones: [], angle: 0, marker: marker,
      loop: true, speed: 1, playing: false, drag: null,
      /* Đợt 3: IK + heatmap. */
      ik: {
        enabled: { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true },
        activeLimb: 'leftArm', targetPos: null, dragging: false, targetMesh: ikTarget
      },
      heatmap: { on: false, bone: null }
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
    /* Kéo: bấm trúng quả cầu IK (cam) thì kéo tay/chân theo (raycast lên
       mặt phẳng vuông góc camera qua target); bấm chỗ khác thì xoay
       camera 360° như cũ. */
    var raycaster = new THREE.Raycaster();
    var ndc = new THREE.Vector2();
    var dragPlane = new THREE.Plane();
    function pointerNdc(e) {
      var r = cv.getBoundingClientRect();
      var p = posOf(e);
      return { x: ((p.x - r.left) / r.width) * 2 - 1, y: -((p.y - r.top) / r.height) * 2 + 1 };
    }
    cv.addEventListener('pointerdown', function (e) {
      var n = pointerNdc(e);
      ndc.set(n.x, n.y);
      raycaster.setFromCamera(ndc, camera);
      var hit = null;
      if (pv.ik.targetMesh && pv.ik.targetMesh.visible) {
        try { hit = raycaster.intersectObject(pv.ik.targetMesh, false); } catch (err) { hit = null; }
      }
      if (hit && hit.length) {
        if (!self.isIkEnabled(pv.ik.activeLimb)) {
          self.toast('IK cho chi này đang tắt — bật lên rồi kéo lại.');
          return;
        }
        pv.ik.dragging = true;
        pv.playing = false; /* kéo IK thì dừng clip, không thì mixer ghi đè */
        var nrm = new THREE.Vector3();
        camera.getWorldDirection(nrm);
        dragPlane.setFromNormalAndCoplanarPoint(nrm, pv.ik.targetMesh.position);
        try { cv.setPointerCapture(e.pointerId); } catch (err) {}
        return;
      }
      pv.drag = { x: posOf(e).x, angle: pv.angle };
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    });
    cv.addEventListener('pointermove', function (e) {
      if (pv.ik.dragging) {
        var n2 = pointerNdc(e);
        ndc.set(n2.x, n2.y);
        raycaster.setFromCamera(ndc, camera);
        var pt = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(dragPlane, pt)) {
          self.applyIk(pv.ik.activeLimb, [pt.x, pt.y, pt.z]);
        }
        return;
      }
      if (!pv.drag) return;
      pv.angle = pv.drag.angle + (posOf(e).x - pv.drag.x) * 0.01;
      if (pv.group) pv.group.rotation.y = pv.angle;
    });
    function endDrag() { pv.drag = null; pv.ik.dragging = false; }
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
    /* Đợt 3: reset trạng thái IK/heatmap của model cũ. */
    pv.heatmap = { on: false, bone: null };
    if (pv.ik) {
      pv.ik.targetPos = null;
      pv.ik.dragging = false;
      if (pv.ik.targetMesh) pv.ik.targetMesh.visible = false;
    }
    if (group) {
      group.rotation.y = pv.angle;
      pv.scene.add(group);
      /* Đợt 3: lưu tư thế gốc của từng xương (quaternion + euler độ) để
         reset pose và kẹp constraint theo delta so với tư thế gốc. */
      group.traverse(function (obj) {
        if (obj && obj.isBone) {
          try {
            obj.userData._edOrigQuat = obj.quaternion.clone();
            obj.userData._edRestEuler = [edCharRadToDeg(obj.rotation.x), edCharRadToDeg(obj.rotation.y), edCharRadToDeg(obj.rotation.z)];
          } catch (e) {}
        }
      });
      if (pv.clips.length && typeof THREE.AnimationMixer === 'function') {
        try {
          pv.mixer = new THREE.AnimationMixer(group);
        } catch (e) { pv.mixer = null; }
      }
    }
    this.renderBoneTree();
    this.renderClipList();
    this.renderBoneInfo(null);
    this.renderBoneWeightStats(null); /* đợt 4: reset panel số liệu */
    this._selectedClipName = null;
    this._refreshIkPanel();
    this._refreshHeatmapPanel();
    this._refreshConstraintPanel();
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
    pv.heatmap = { on: false, bone: null };
    if (pv.ik) {
      pv.ik.targetPos = null;
      pv.ik.dragging = false;
      if (pv.ik.targetMesh) pv.ik.targetMesh.visible = false;
    }
    this.renderBoneTree();
    this.renderClipList();
    this.renderBoneInfo(null);
    this.renderBoneWeightStats(null); /* đợt 4: reset panel số liệu */
    this._selectedClipName = null;
    this._refreshIkPanel();
    this._refreshHeatmapPanel();
    this._refreshConstraintPanel();
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
    /* Đợt 3: đổi xương chọn -> cập nhật panel constraint; heatmap đang bật
       thì tô lại theo xương mới. Đợt 4: cập nhật panel số liệu bone weight. */
    this._refreshConstraintPanel();
    this.renderBoneWeightStats(found.name);
    if (pv.heatmap && pv.heatmap.on) this.applyBoneWeightHeatmap(found.name);
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

  /* ---------------- Skeleton nâng cao — đợt 3 (runtime, cần THREE/DOM) ---------------- */

  /* Tìm 3 xương THREE.Bone của 1 chi trong preview (key: leftArm/rightArm/
     leftLeg/rightLeg). Trả null nếu thiếu xương hoặc chưa có model. */
  findIkChain: function (limbKey) {
    var pv = this._preview;
    if (!pv || !pv.group) return null;
    var bones = [];
    pv.group.traverse(function (obj) { if (obj && obj.isBone) bones.push(obj); });
    return edCharFindIkChain(bones, limbKey);
  },

  isIkEnabled: function (limbKey) {
    var pv = this._preview;
    return !!(pv && pv.ik && pv.ik.enabled && pv.ik.enabled[limbKey]);
  },

  setIkEnabled: function (limbKey, enabled) {
    var pv = this._preview;
    if (!pv || !pv.ik) return false;
    pv.ik.enabled[limbKey] = !!enabled;
    this._refreshIkPanel();
    return pv.ik.enabled[limbKey];
  },

  /* Chọn chi IK đang kéo: hiện quả cầu cam tại đầu cuối của chi đó. */
  setActiveIkLimb: function (limbKey) {
    var pv = this._preview;
    if (!pv || !pv.group || !pv.ik) return false;
    var chain = this.findIkChain(limbKey);
    if (!chain) { this.toast('Không tìm thấy đủ 3 xương cho chi này trong model.'); return false; }
    pv.ik.activeLimb = limbKey;
    var wp = new THREE.Vector3();
    try { chain.end.getWorldPosition(wp); } catch (e) {}
    pv.ik.targetPos = [wp.x, wp.y, wp.z];
    if (pv.ik.targetMesh) { pv.ik.targetMesh.position.copy(wp); pv.ik.targetMesh.visible = true; }
    this._refreshIkPanel();
    return true;
  },

  /* Kẹp góc xoay cục bộ của 1 xương vào constraint (delta so với tư thế
     gốc đã lưu lúc load model). Dùng sau IK và khi xoay tay. */
  _clampBoneRotation: function (bone) {
    if (!bone || !bone.rotation) return;
    var c = this.getBoneConstraintFor(bone.name);
    var rest = (bone.userData && bone.userData._edRestEuler) ? bone.userData._edRestEuler : null;
    var deg = [edCharRadToDeg(bone.rotation.x), edCharRadToDeg(bone.rotation.y), edCharRadToDeg(bone.rotation.z)];
    var cl = edCharClampRotationDeg(deg, c, rest);
    bone.rotation.set(edCharDegToRad(cl[0]), edCharDegToRad(cl[1]), edCharDegToRad(cl[2]));
  },

  /* Áp IK 2 xương cho 1 chi: giải thuần -> xoay root rồi mid trong world
     (delta quaternion theo hướng tới con) -> kẹp constraint từng xương.
     targetPos [x,y,z] world. Trả kết quả solve (xem edCharSolveTwoBoneIK)
     hoặc null (không có xương / IK tắt / độ dài xương ~0). */
  applyIk: function (limbKey, targetPos, opts) {
    var pv = this._preview;
    if (!pv || !pv.group || typeof THREE === 'undefined') return null;
    var chain = this.findIkChain(limbKey);
    if (!chain) return null;
    if (pv.ik && pv.ik.enabled && pv.ik.enabled[limbKey] === false) return null;
    try { pv.group.updateMatrixWorld(true); } catch (e) {}
    function wp(bone) {
      var v = new THREE.Vector3();
      try { bone.getWorldPosition(v); } catch (e) {}
      return v;
    }
    var rootPos = wp(chain.root), midPos0 = wp(chain.mid), endPos0 = wp(chain.end);
    var L1 = rootPos.distanceTo(midPos0), L2 = midPos0.distanceTo(endPos0);
    if (L1 < 1e-4 || L2 < 1e-4) return null;
    /* Pole (hướng khuỷu/gối) theo hệ cục bộ nhân vật -> world. */
    var poleLocal = new THREE.Vector3(chain.pole[0], chain.pole[1], chain.pole[2]);
    var gq = new THREE.Quaternion();
    try { pv.group.getWorldQuaternion(gq); } catch (e) {}
    var poleWorld = poleLocal.clone().applyQuaternion(gq);
    var target = Array.isArray(targetPos) ? targetPos : [endPos0.x, endPos0.y, endPos0.z];
    var sol = edCharSolveTwoBoneIK([rootPos.x, rootPos.y, rootPos.z], L1, L2, target, [poleWorld.x, poleWorld.y, poleWorld.z]);
    if (!sol) return null;
    /* Xoay 1 xương trong world sao cho hướng tới con của nó trùng
       hướng đích: deltaQ = quat(cur -> des), áp vào world quat của xương. */
    function rotateBoneToDir(bone, childBone, desiredDir) {
      var bp = wp(bone), cp = wp(childBone);
      var cur = cp.sub(bp);
      if (cur.lengthSq() < 1e-12) return false;
      cur.normalize();
      var des = desiredDir.clone().normalize();
      if (des.lengthSq() < 1e-12) return false;
      var dq = new THREE.Quaternion().setFromUnitVectors(cur, des);
      var qw = new THREE.Quaternion();
      try { bone.getWorldQuaternion(qw); } catch (e) { return false; }
      var pq = new THREE.Quaternion();
      if (bone.parent) { try { bone.parent.getWorldQuaternion(pq); } catch (e) {} }
      bone.quaternion.copy(pq.clone().invert().multiply(dq).multiply(qw));
      try { pv.group.updateMatrixWorld(true); } catch (e) {}
      return true;
    }
    var midTarget = new THREE.Vector3(sol.midPos[0], sol.midPos[1], sol.midPos[2]);
    var endTarget = new THREE.Vector3(sol.endPos[0], sol.endPos[1], sol.endPos[2]);
    rotateBoneToDir(chain.root, chain.mid, midTarget.clone().sub(rootPos));
    var midNow = wp(chain.mid);
    rotateBoneToDir(chain.mid, chain.end, endTarget.clone().sub(midNow));
    this._clampBoneRotation(chain.root);
    this._clampBoneRotation(chain.mid);
    try { pv.group.updateMatrixWorld(true); } catch (e) {}
    if (pv.ik) {
      pv.ik.activeLimb = limbKey;
      pv.ik.targetPos = sol.endPos.slice();
      if (pv.ik.targetMesh) { pv.ik.targetMesh.position.copy(endTarget); pv.ik.targetMesh.visible = true; }
    }
    if (opts && opts.refreshPanel !== false) this._refreshIkPanel();
    return sol;
  },

  /* Trả mọi xương về tư thế gốc lúc load model + ẩn quả cầu IK. */
  resetIkPose: function () {
    var pv = this._preview;
    if (!pv || !pv.group) return false;
    var n = 0;
    pv.group.traverse(function (obj) {
      if (obj && obj.isBone && obj.userData && obj.userData._edOrigQuat) {
        try { obj.quaternion.copy(obj.userData._edOrigQuat); n++; } catch (e) {}
      }
    });
    try { pv.group.updateMatrixWorld(true); } catch (e) {}
    if (pv.ik) {
      pv.ik.targetPos = null;
      if (pv.ik.targetMesh) pv.ik.targetMesh.visible = false;
    }
    return n > 0;
  },

  /* Trả 1 xương về tư thế gốc. */
  resetBoneRotation: function (boneName) {
    var pv = this._preview;
    if (!pv || !pv.group || !boneName) return false;
    var found = null;
    pv.group.traverse(function (obj) {
      if (!found && obj && obj.isBone && obj.name === boneName) found = obj;
    });
    if (!found || !found.userData || !found.userData._edOrigQuat) return false;
    try { found.quaternion.copy(found.userData._edOrigQuat); } catch (e) { return false; }
    try { pv.group.updateMatrixWorld(true); } catch (e) {}
    this._refreshConstraintPanel();
    return true;
  },

  /* Xoay 1 xương bằng tay (độ, [x,y,z]): dừng clip (không thì mixer ghi
     đè ngay frame sau), kẹp theo constraint của xương, cập nhật marker +
     panel. Trả góc đã kẹp (độ) hoặc null. */
  rotateBoneManual: function (boneName, rotDeg) {
    var pv = this._preview;
    if (!pv || !pv.group || !boneName) return null;
    var found = null;
    pv.group.traverse(function (obj) {
      if (!found && obj && obj.isBone && obj.name === boneName) found = obj;
    });
    if (!found) return null;
    pv.playing = false;
    var c = this.getBoneConstraintFor(boneName);
    var rest = (found.userData && found.userData._edRestEuler) ? found.userData._edRestEuler : null;
    var cl = edCharClampRotationDeg(rotDeg, c, rest);
    found.rotation.set(edCharDegToRad(cl[0]), edCharDegToRad(cl[1]), edCharDegToRad(cl[2]));
    try { pv.group.updateMatrixWorld(true); } catch (e) {}
    var wp = new THREE.Vector3();
    try { found.getWorldPosition(wp); } catch (e) {}
    pv.marker.position.copy(wp);
    pv.marker.visible = true;
    this.renderBoneInfo({
      name: found.name,
      pos: [Number(wp.x.toFixed(2)), Number(wp.y.toFixed(2)), Number(wp.z.toFixed(2))]
    });
    this._refreshConstraintPanel();
    return cl;
  },

  /* Constraint của 1 xương cho nhân vật đang chọn (đã có -> dùng, chưa
     có / project cũ -> mặc định theo khớp). */
  getBoneConstraintFor: function (boneName) {
    var project = this.project();
    var ch = null;
    for (var i = 0; i < project.characters.length; i++) {
      if (project.characters[i] && project.characters[i].id === this._selectedId) { ch = project.characters[i]; break; }
    }
    return edCharGetBoneConstraint(ch, boneName);
  },

  /* Lưu constraint của 1 xương vào nhân vật đang chọn (project).
     Chưa chọn nhân vật thì chỉ trả bản chuẩn hoá, không lưu được. */
  setBoneConstraintFor: function (boneName, constraint) {
    var project = this.project();
    var ch = null;
    for (var i = 0; i < project.characters.length; i++) {
      if (project.characters[i] && project.characters[i].id === this._selectedId) { ch = project.characters[i]; break; }
    }
    if (!ch) return edCharNormalizeBoneConstraint(constraint);
    var stored = edCharSetBoneConstraint(ch, boneName, constraint);
    this.commit('Đặt giới hạn xoay xương');
    return stored;
  },

  /* (b) Tô heatmap bone weight cho xương boneName lên mọi SkinnedMesh
     trong preview: đọc skinIndex/skinWeight thật, ghi vertex color.
     Trả {ok, meshes, verts, bone} hoặc {ok:false, reason}. */
  applyBoneWeightHeatmap: function (boneName) {
    var pv = this._preview;
    if (!pv || !pv.group || typeof THREE === 'undefined') {
      return { ok: false, reason: 'Chưa có model trong preview.' };
    }
    var meshes = [];
    pv.group.traverse(function (obj) { if (obj && obj.isSkinnedMesh) meshes.push(obj); });
    if (!meshes.length) {
      return { ok: false, reason: 'Model này không có SkinnedMesh (không có skinning để tô heatmap).' };
    }
    var applied = 0, total = 0;
    for (var mi = 0; mi < meshes.length; mi++) {
      var mesh = meshes[mi];
      var skel = mesh.skeleton;
      if (!skel || !skel.bones) continue;
      var idx = -1;
      for (var bi = 0; bi < skel.bones.length; bi++) {
        if (skel.bones[bi] && skel.bones[bi].name === boneName) { idx = bi; break; }
      }
      if (idx < 0) continue;
      var res = edCharComputeBoneWeights(mesh.geometry, idx);
      if (!res) continue;
      if (!mesh.userData._heatSaved) {
        var mats0 = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.userData._heatSaved = {
          colorAttr: (mesh.geometry.attributes && mesh.geometry.attributes.color) ? mesh.geometry.attributes.color : null,
          vertexColors: mats0.map(function (m) { return !!(m && m.vertexColors); })
        };
      }
      var colors = new Float32Array(res.count * 3);
      for (var v = 0; v < res.count; v++) {
        var c = edCharWeightToColor(res.weights[v]);
        colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2];
      }
      try {
        mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(function (m) { if (m) { m.vertexColors = true; m.needsUpdate = true; } });
        applied++;
        total += res.count;
      } catch (e) {}
    }
    if (!applied) {
      return { ok: false, reason: 'Không tìm thấy xương "' + boneName + '" trong skeleton của mesh.' };
    }
    pv.heatmap = { on: true, bone: boneName };
    return { ok: true, meshes: applied, verts: total, bone: boneName };
  },

  /* Gỡ heatmap: trả lại vertex color + vertexColors gốc của material. */
  clearBoneWeightHeatmap: function () {
    var pv = this._preview;
    if (!pv || !pv.group) return false;
    var cleared = false;
    pv.group.traverse(function (obj) {
      if (!obj || !obj.isSkinnedMesh || !obj.userData || !obj.userData._heatSaved) return;
      var saved = obj.userData._heatSaved;
      try {
        if (saved.colorAttr) obj.geometry.setAttribute('color', saved.colorAttr);
        else if (obj.geometry.deleteAttribute) obj.geometry.deleteAttribute('color');
        else if (obj.geometry.attributes) delete obj.geometry.attributes.color;
        var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(function (m, i) {
          if (m) { m.vertexColors = saved.vertexColors ? !!saved.vertexColors[i] : false; m.needsUpdate = true; }
        });
        cleared = true;
      } catch (e) {}
      obj.userData._heatSaved = null;
    });
    pv.heatmap = { on: false, bone: null };
    return cleared;
  },

  /* Bật/tắt heatmap cho xương đang chọn. Trả {ok, ...} như apply/clear. */
  toggleHeatmap: function (on) {
    var pv = this._preview;
    if (on === false || (on === undefined && pv && pv.heatmap && pv.heatmap.on)) {
      this.clearBoneWeightHeatmap();
      this._refreshHeatmapPanel();
      return { ok: true, on: false };
    }
    var bone = this.getSelectedBone();
    if (!bone) return { ok: false, reason: 'Chọn 1 xương trong cây xương trước rồi bật heatmap.' };
    var r = this.applyBoneWeightHeatmap(bone);
    this._refreshHeatmapPanel();
    return r;
  },

  /* ---------------- Đợt 4 (a) Số liệu bone weight (runtime) ---------------- */

  /* Số liệu bone weight cho xương boneName trên model đang preview.
     Trả {hasSkin, stats, ...}:
     - hasSkin false: không có SkinnedMesh nào (model mesh-only / không
       skinning) — panel báo rõ, không hiện số 0.
     - stats null + hasSkin true: có skinning nhưng không tìm thấy xương
       này trong skeleton (xem reason).
     - stats: kết quả edCharComputeBoneWeightStats của mesh ĐẦU TIÊN có
       xương này (model Mixamo thường chỉ có 1 SkinnedMesh). */
  getBoneWeightStats: function (boneName) {
    var pv = this._preview;
    if (!pv || !pv.group) return { hasSkin: false, stats: null, reason: 'Chưa có model trong preview.' };
    var meshes = [];
    pv.group.traverse(function (obj) { if (obj && obj.isSkinnedMesh) meshes.push(obj); });
    if (!meshes.length) return { hasSkin: false, stats: null, reason: 'Model này không có xương/skin' };
    for (var i = 0; i < meshes.length; i++) {
      var mesh = meshes[i];
      var skel = mesh.skeleton;
      if (!skel || !skel.bones) continue;
      var idx = -1;
      for (var bi = 0; bi < skel.bones.length; bi++) {
        if (skel.bones[bi] && skel.bones[bi].name === boneName) { idx = bi; break; }
      }
      if (idx < 0) continue;
      var stats = edCharComputeBoneWeightStats(mesh.geometry, idx);
      if (!stats) continue;
      return {
        hasSkin: true, stats: stats, bone: boneName, boneIndex: idx,
        meshIndex: i, meshCount: meshes.length,
        meshName: (mesh.name || ('mesh ' + (i + 1)))
      };
    }
    return { hasSkin: true, stats: null, reason: 'Không tìm thấy xương "' + boneName + '" trong skeleton của mesh.' };
  },

  /* Vẽ panel số liệu bone weight (ngay dưới cây xương). boneName null:
     hiện hướng dẫn, hoặc báo "không có xương/skin" khi model mesh-only. */
  renderBoneWeightStats: function (boneName) {
    var body = this._bwStatsBodyEl;
    if (!body || typeof document === 'undefined') return;
    while (body.firstChild) body.removeChild(body.firstChild);
    function line(text) {
      var d = document.createElement('div');
      d.textContent = text;
      body.appendChild(d);
      return d;
    }
    function fmt(w) { return (Math.round(Number(w) * 1000) / 1000).toFixed(3); }
    if (!boneName) {
      var pv0 = this._preview;
      if (!pv0 || !pv0.group) { line('Chưa có model — nhập file .fbx trước.'); return; }
      var hasSkin = false;
      pv0.group.traverse(function (obj) { if (obj && obj.isSkinnedMesh) hasSkin = true; });
      if (!hasSkin) line('Model này không có xương/skin — không có số liệu bone weight.');
      else line('Chọn 1 xương trong cây xương để xem số liệu bone weight.');
      return;
    }
    var r = this.getBoneWeightStats(boneName);
    if (!r.hasSkin) { line('Model này không có xương/skin — không có số liệu bone weight.'); return; }
    if (!r.stats) { line(r.reason || 'Không tính được số liệu bone weight.'); return; }
    var s = r.stats;
    line('Xương: ' + boneName + (r.meshCount > 1 ? (' — mesh: ' + r.meshName + ' (' + (r.meshIndex + 1) + '/' + r.meshCount + ', đang xem mesh đầu tiên có xương này)') : ''));
    line('Đỉnh chịu ảnh hưởng (trọng số > 0): ' + s.countOver0 + ' / ' + s.count + ' đỉnh');
    line('Đỉnh trọng số > 0.5: ' + s.countOver05 + ' đỉnh');
    line('Trọng số — nhỏ nhất: ' + fmt(s.min) + ' · lớn nhất: ' + fmt(s.max) + ' · trung bình: ' + fmt(s.avg));
    if (!s.countOver0) {
      line('Xương này không ảnh hưởng đỉnh nào (mọi trọng số đều = 0).');
      return;
    }
    line('Top ' + s.top.length + ' đỉnh ảnh hưởng mạnh nhất:');
    var topWrap = document.createElement('div');
    topWrap.className = 'ed-char-bw-top';
    s.top.forEach(function (t, i) {
      var d = document.createElement('div');
      d.textContent = (i + 1) + '. Đỉnh #' + t.vi + ' — trọng số ' + fmt(t.w);
      topWrap.appendChild(d);
    });
    body.appendChild(topWrap);
  },

  /* ---------------- Đợt 4 (b) Retarget clip Mixamo (runtime) ----------------
     Nguồn clip: kho clip của các file FBX đã nhập trong phiên này
     (_retargetClipBank) + clip của model đang xem. Đích: rig của model
     đang preview (pv.bones). Chỉ Mixamo→Mixamo cùng tên xương. */

  /* Ghi clip thô (THREE.AnimationClip) của file vừa nhập vào kho nguồn. */
  _bankRetargetClips: function (charId, fileName, animations) {
    if (!Array.isArray(animations) || !animations.length) return;
    if (!this._retargetClipBank) this._retargetClipBank = [];
    var self = this;
    animations.forEach(function (c) {
      if (!c || typeof c.name !== 'string') return;
      var key = String(charId) + '|' + c.name;
      var exists = false;
      self._retargetClipBank.forEach(function (e) { if (e.key === key) { e.clip = c; e.label = c.name + ' — ' + fileName; exists = true; } });
      if (!exists) self._retargetClipBank.push({ key: key, label: c.name + ' — ' + fileName, clip: c });
    });
    while (this._retargetClipBank.length > 30) this._retargetClipBank.shift();
  },

  /* Danh sách nguồn clip cho ô chọn retarget: clip model đang xem trước,
     rồi clip trong kho (trừ clip đang xem để khỏi trùng). */
  _retargetSourceList: function () {
    var list = [];
    var seenClips = [];
    var pv = this._preview;
    function push(clip, label) {
      if (!clip || typeof clip.name !== 'string') return;
      if (seenClips.indexOf(clip) >= 0) return;
      seenClips.push(clip);
      list.push({ label: label, clip: clip });
    }
    if (pv && pv.group && pv.group.animations) {
      pv.group.animations.forEach(function (c) { push(c, c.name + ' — model đang xem'); });
    }
    (this._retargetClipBank || []).forEach(function (e) { push(e.clip, e.label); });
    return list;
  },

  /* Vẽ lại ô chọn clip nguồn (gọi từ renderClipList + sau khi nhập FBX). */
  _refreshRetargetSelect: function () {
    var sel = this._retargetSelectEl;
    if (!sel || typeof document === 'undefined') return;
    var prevVal = sel.value;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    var list = this._retargetSourceList();
    this._retargetSources = list;
    if (!list.length) {
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = 'Chưa có clip nào — nhập file .fbx có animation trước.';
      sel.appendChild(o0);
      return;
    }
    list.forEach(function (src, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = src.label;
      sel.appendChild(o);
    });
    /* Ưu tiên clip đang chọn trong danh sách clip (nếu có trong nguồn). */
    var want = -1;
    if (this._selectedClipName) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].clip && list[i].clip.name === this._selectedClipName && /đang xem/.test(list[i].label)) { want = i; break; }
      }
    }
    if (want >= 0) sel.value = String(want);
    else if (prevVal !== '' && prevVal !== null && isFinite(Number(prevVal)) && Number(prevVal) < list.length) sel.value = prevVal;
    else sel.value = '0';
  },

  _getRetargetSourceClip: function () {
    var list = this._retargetSources || [];
    var sel = this._retargetSelectEl;
    if (!sel || sel.value === '' || sel.value === null) return list.length ? list[0].clip : null;
    var idx = Number(sel.value);
    if (!isFinite(idx) || idx < 0 || idx >= list.length) return null;
    return list[idx].clip;
  },

  /* Retarget 1 THREE.AnimationClip nguồn sang rig đang preview rồi phát
     ngay bằng playCustomClip. Trả {ok, mapped, total, missing, ...} hoặc
     {ok:false, reason, missing}. Kết quả hiện ở panel + console editor. */
  retargetClipToPreview: function (sourceClip) {
    var pv = this._preview;
    if (!pv || !pv.group) return { ok: false, reason: 'Chưa có model trong preview — nhập file .fbx trước.' };
    if (!sourceClip || !Array.isArray(sourceClip.tracks)) return { ok: false, reason: 'Clip nguồn không hợp lệ.' };
    if (typeof THREE === 'undefined' || !THREE.AnimationClip) return { ok: false, reason: 'Chưa tải được thư viện animation, thử tải lại trang.' };
    var targetBones = (pv.bones || []).map(function (b) { return b.name; });
    if (!targetBones.length) return { ok: false, reason: 'Model đang xem không có xương — không retarget được.' };
    var sourceBones = [];
    var seenBone = {};
    sourceClip.tracks.forEach(function (t) {
      var b = t && edCharTrackBoneName(t.name);
      if (b && !seenBone[b]) { seenBone[b] = true; sourceBones.push(b); }
    });
    var plain = {
      name: sourceClip.name,
      duration: Number(sourceClip.duration) || 0,
      tracks: sourceClip.tracks.map(function (t) {
        return {
          name: t.name,
          times: Array.prototype.slice.call(t.times || []),
          values: Array.prototype.slice.call(t.values || [])
        };
      })
    };
    var total = plain.tracks.length;
    var res = edCharRetargetClip(plain, sourceBones, targetBones);
    if (!res.mapped) {
      return { ok: false, reason: 'Không map được track nào — rig đích thiếu tất cả xương trong clip.', missing: res.missing, mapped: 0, total: total };
    }
    var threeTracks = [];
    for (var i = 0; i < res.clip.tracks.length; i++) {
      var pt = res.clip.tracks[i];
      var prop = pt.name.slice(pt.name.lastIndexOf('.') + 1);
      try {
        if (prop === 'quaternion' && THREE.QuaternionKeyframeTrack) threeTracks.push(new THREE.QuaternionKeyframeTrack(pt.name, pt.times, pt.values));
        else if ((prop === 'position' || prop === 'scale') && THREE.VectorKeyframeTrack) threeTracks.push(new THREE.VectorKeyframeTrack(pt.name, pt.times, pt.values));
        else if (THREE.NumberKeyframeTrack) threeTracks.push(new THREE.NumberKeyframeTrack(pt.name, pt.times, pt.values));
      } catch (e) {}
    }
    if (!threeTracks.length) return { ok: false, reason: 'Không dựng lại được track animation cho rig đích.', missing: res.missing, mapped: 0, total: total };
    /* Model đích có xương nhưng không có clip gốc -> chưa có mixer: tạo mới. */
    if (!pv.mixer && pv.group && typeof THREE.AnimationMixer === 'function') {
      try { pv.mixer = new THREE.AnimationMixer(pv.group); } catch (e) { pv.mixer = null; }
    }
    var dur = res.clip.duration > 0 ? res.clip.duration : -1; /* -1: THREE tự tính từ track */
    var newClip;
    try { newClip = new THREE.AnimationClip(res.clip.name, dur, threeTracks); }
    catch (e) { return { ok: false, reason: 'Không tạo được clip retarget (' + (e && e.message ? e.message : 'lỗi không rõ') + ').', missing: res.missing, mapped: res.mapped, total: total }; }
    this.playCustomClip(newClip, { fadeSec: 0.3 });
    return { ok: true, mapped: res.mapped, total: total, missing: res.missing, clipName: res.clip.name };
  },

  /* Báo cáo kết quả retarget: panel + console editor (+ console trình duyệt
     khi thiếu xương để dễ thấy khi debug). */
  _reportRetargetResult: function (r) {
    var msg;
    if (!r.ok) {
      msg = 'Retarget thất bại: ' + (r.reason || 'không rõ lý do.');
      if (r.missing && r.missing.length) msg += ' Xương thiếu: ' + r.missing.join(', ') + '.';
    } else {
      msg = 'Retarget xong: map được ' + r.mapped + '/' + r.total + ' track.';
      msg += r.missing.length
        ? (' Thiếu xương (track của các xương này đã bỏ): ' + r.missing.join(', ') + '.')
        : ' Đủ xương, không thiếu xương nào.';
    }
    if (this._retargetStatusEl) this._retargetStatusEl.textContent = msg;
    this.log(msg);
    try {
      if (typeof console !== 'undefined' && r.missing && r.missing.length && console.warn) {
        console.warn('[Character Retarget] Xương thiếu trong rig đích:', r.missing);
      }
    } catch (e) {}
    return msg;
  },

  /* --- Cập nhật panel đợt 3 (guard khi panel chưa build) --- */
  _refreshIkPanel: function () {
    var pv = this._preview;
    var key = (pv && pv.ik) ? pv.ik.activeLimb : 'leftArm';
    var defs = edCharIkLimbDefs();
    var label = key;
    defs.forEach(function (d) { if (d.key === key) label = d.label; });
    if (this._ikLimbBtns) {
      for (var k in this._ikLimbBtns) {
        var b = this._ikLimbBtns[k];
        if (!b) continue;
        if (b.classList) b.classList.toggle('active', k === key);
        b.style.opacity = (pv && pv.ik && pv.ik.enabled[k] === false) ? '0.55' : '1';
      }
    }
    if (this._ikToggleBtn) {
      this._ikToggleBtn.textContent = 'IK ' + label + ': ' + (this.isIkEnabled(key) ? 'Bật' : 'Tắt');
    }
    if (this._ikStatusEl) {
      if (!pv || !pv.group) this._ikStatusEl.textContent = 'Chưa có model — nhập file .fbx có xương trước.';
      else if (pv.ik && pv.ik.targetPos) {
        var t = pv.ik.targetPos;
        this._ikStatusEl.textContent = 'Chi đang kéo: ' + label + ' — đích (' + t[0].toFixed(2) + ', ' + t[1].toFixed(2) + ', ' + t[2].toFixed(2) + ')';
      } else this._ikStatusEl.textContent = 'Chi đang kéo: ' + label + ' — bấm chi rồi kéo quả cầu cam trong khung xem trước.';
    }
  },

  _refreshHeatmapPanel: function () {
    var pv = this._preview;
    var on = !!(pv && pv.heatmap && pv.heatmap.on);
    if (this._hmBtn) this._hmBtn.textContent = on ? 'Tắt heatmap' : 'Bật heatmap';
    if (this._hmStatusEl) {
      this._hmStatusEl.textContent = on
        ? ('Đang tô heatmap xương: ' + (pv.heatmap.bone || '') + ' (đỏ = mạnh, xanh = yếu, xám = 0).')
        : 'Heatmap đang tắt — chọn 1 xương rồi bấm Bật heatmap.';
    }
  },

  _refreshConstraintPanel: function () {
    var bone = this.getSelectedBone();
    if (this._csBoneEl) {
      this._csBoneEl.textContent = bone
        ? ('Xương đang chọn: ' + bone + ' — giới hạn là độ xoay THÊM so với tư thế gốc.')
        : 'Chưa chọn xương nào — bấm 1 xương trong cây xương.';
    }
    if (!bone) return;
    var c = this.getBoneConstraintFor(bone);
    var self = this;
    ['x', 'y', 'z'].forEach(function (ax, i) {
      if (self._csMinMax && self._csMinMax[ax]) {
        self._csMinMax[ax].minEl.value = c.min[i];
        self._csMinMax[ax].maxEl.value = c.max[i];
      }
    });
    var t = this.getBoneTransform(bone);
    if (t && this._csSliders) {
      ['x', 'y', 'z'].forEach(function (ax, i) {
        var deg = Math.round(edCharRadToDeg(t.rot[i]));
        var shown = Math.max(-180, Math.min(180, deg));
        if (self._csSliders[ax]) self._csSliders[ax].value = shown;
        if (self._csSliderVals[ax]) self._csSliderVals[ax].textContent = deg + '°';
      });
    }
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
    this._retargetClipBank = []; /* đợt 4: clip nguồn đã nhập trong phiên */
    this._retargetSources = [];
    this._selectedClipName = null;
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
    /* ---- Đợt 4 (b) Retarget clip Mixamo (trong khu vực clip list) ---- */
    var rtWrap = el('div', 'ed-char-retarget');
    rtWrap.appendChild(el('div', '', '🔁 Retarget clip Mixamo'));
    rtWrap.appendChild(el('div', 'ed-char-hint', 'Map clip theo tên xương (mixamorig:...) sang rig của model đang xem. Không tạo xương mới, chỉ Mixamo → Mixamo cùng tên xương.'));
    var rtSel = el('select', 'ed-char-retarget-select');
    rtSel.style.minHeight = '40px';
    rtSel.style.width = '100%';
    rtWrap.appendChild(rtSel);
    this._retargetSelectEl = rtSel;
    var rtBtn = btn('🔁 Retarget clip sang rig này', function () {
      var src = self._getRetargetSourceClip();
      if (!src) { self.toast('Chọn 1 clip nguồn trước.'); return; }
      var r = self.retargetClipToPreview(src);
      self._reportRetargetResult(r);
      if (r.ok) self.toast('Retarget xong: map được ' + r.mapped + '/' + r.total + ' track' + (r.missing.length ? (' — thiếu ' + r.missing.length + ' xương.') : '.'));
      else self.toast(r.reason || 'Không retarget được clip này.');
    });
    rtWrap.appendChild(rtBtn);
    var rtStatus = el('div', 'ed-char-hint', 'Chưa retarget clip nào.');
    rtWrap.appendChild(rtStatus);
    this._retargetStatusEl = rtStatus;
    animWrap.appendChild(rtWrap);
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
    /* ---- Đợt 4 (a) Panel số liệu bone weight (ngay dưới cây xương) ---- */
    var bwWrap = el('div', 'ed-char-bw-stats');
    bwWrap.appendChild(el('div', '', '📊 Số liệu Bone Weight'));
    var bwBody = el('div', 'ed-char-bw-body', 'Chưa có model — nhập file .fbx trước.');
    bwBody.style.maxHeight = '180px';
    bwBody.style.overflowY = 'auto';
    bwWrap.appendChild(bwBody);
    this._bwStatsBodyEl = bwBody;
    skWrap.appendChild(bwWrap);
    host.appendChild(skWrap);

    /* ---- Đợt 3 — Skeleton nâng cao: IK / Heatmap / Constraint ---- */
    /* (a) IK 2 xương. */
    var ikWrap = el('div', 'ed-char-sk3');
    ikWrap.appendChild(el('div', '', '🦾 IK 2 xương (kéo tay/chân)'));
    ikWrap.appendChild(el('div', 'ed-char-hint', 'Chọn 1 chi, rồi kéo quả cầu CAM trong khung xem trước. Kéo chỗ khác vẫn xoay camera như cũ.'));
    var ikLimbRow = el('div', 'ed-row');
    this._ikLimbBtns = {};
    [{ k: 'leftArm', label: 'Tay trái' }, { k: 'rightArm', label: 'Tay phải' },
     { k: 'leftLeg', label: 'Chân trái' }, { k: 'rightLeg', label: 'Chân phải' }].forEach(function (d) {
      var b = btn(d.label, function () { self.setActiveIkLimb(d.k); });
      self._ikLimbBtns[d.k] = b;
      ikLimbRow.appendChild(b);
    });
    ikWrap.appendChild(ikLimbRow);
    var ikCtlRow = el('div', 'ed-row');
    var ikToggle = btn('IK Tay trái: Bật', function () {
      var pv = self._preview;
      var key = (pv && pv.ik) ? pv.ik.activeLimb : 'leftArm';
      var now = self.setIkEnabled(key, !self.isIkEnabled(key));
      self.toast(now ? 'Đã bật IK cho chi đang chọn.' : 'Đã tắt IK cho chi đang chọn — kéo cầu sẽ không xoay xương.');
    });
    this._ikToggleBtn = ikToggle;
    ikCtlRow.appendChild(ikToggle);
    ikCtlRow.appendChild(btn('↺ Đặt lại tư thế', function () {
      if (self.resetIkPose()) self.toast('Đã trả xương về tư thế gốc.');
      else self.toast('Chưa có model để đặt lại.');
    }));
    ikWrap.appendChild(ikCtlRow);
    var ikStatus = el('div', 'ed-char-hint', 'Chưa có model — nhập file .fbx có xương trước.');
    ikWrap.appendChild(ikStatus);
    this._ikStatusEl = ikStatus;
    host.appendChild(ikWrap);

    /* (b) Bone weight heatmap. */
    var hmWrap = el('div', 'ed-char-sk3');
    hmWrap.appendChild(el('div', '', '🎨 Bone Weight (heatmap)'));
    var hmRow = el('div', 'ed-row');
    var hmBtn = btn('Bật heatmap', function () {
      var r = self.toggleHeatmap();
      if (!r.ok) self.toast(r.reason || 'Không tô được heatmap.');
      else if (r.on === false) self.toast('Đã tắt heatmap, trả lại màu gốc.');
      else self.toast('Heatmap xương ' + r.bone + ': ' + r.verts + ' đỉnh trên ' + r.meshes + ' mesh.');
    });
    this._hmBtn = hmBtn;
    hmRow.appendChild(hmBtn);
    hmWrap.appendChild(hmRow);
    var hmStatus = el('div', 'ed-char-hint', 'Heatmap đang tắt — chọn 1 xương rồi bấm Bật heatmap.');
    hmWrap.appendChild(hmStatus);
    this._hmStatusEl = hmStatus;
    var legendBar = el('div', '');
    legendBar.style.height = '12px';
    legendBar.style.borderRadius = '3px';
    legendBar.style.background = 'linear-gradient(90deg, #0000ff, #8000ff, #ff0000)';
    legendBar.style.margin = '6px 0 2px 0';
    hmWrap.appendChild(legendBar);
    hmWrap.appendChild(el('div', 'ed-char-hint', 'Chú thích: xám = trọng số 0 (xương không ảnh hưởng đỉnh đó) · xanh = yếu · tím = vừa · đỏ = mạnh (gần 1).'));
    host.appendChild(hmWrap);

    /* (c) Constraint xoay + xoay xương bằng tay. */
    var csWrap = el('div', 'ed-char-sk3');
    csWrap.appendChild(el('div', '', '🔒 Giới hạn xoay xương'));
    var csBone = el('div', 'ed-char-hint', 'Chưa chọn xương nào — bấm 1 xương trong cây xương.');
    csWrap.appendChild(csBone);
    this._csBoneEl = csBone;
    this._csSliders = {};
    this._csSliderVals = {};
    ['x', 'y', 'z'].forEach(function (axis, i) {
      var row = el('div', 'ed-row');
      row.appendChild(el('label', '', 'Xoay ' + axis.toUpperCase()));
      var s = el('input');
      s.type = 'range'; s.min = '-180'; s.max = '180'; s.step = '1'; s.value = '0';
      s.style.flex = '1';
      var val = el('span', '', '0°');
      s.addEventListener('input', function () {
        var bone = self.getSelectedBone();
        if (!bone) return;
        var cur = self.getBoneTransform(bone);
        var rot = cur ? [edCharRadToDeg(cur.rot[0]), edCharRadToDeg(cur.rot[1]), edCharRadToDeg(cur.rot[2])] : [0, 0, 0];
        rot[i] = Number(s.value);
        var cl = self.rotateBoneManual(bone, rot);
        if (cl) val.textContent = Math.round(cl[i]) + '°';
      });
      row.appendChild(s);
      row.appendChild(val);
      self._csSliders[axis] = s;
      self._csSliderVals[axis] = val;
      csWrap.appendChild(row);
    });
    csWrap.appendChild(el('div', 'ed-char-hint', 'Giới hạn dưới là độ xoay THÊM so với tư thế gốc (kẹp cả khi xoay tay và khi kéo IK).'));
    this._csMinMax = {};
    ['x', 'y', 'z'].forEach(function (axis, i) {
      var row = el('div', 'ed-row');
      row.appendChild(el('label', '', 'Giới hạn ' + axis.toUpperCase() + ' (độ)'));
      var minInp = el('input');
      minInp.type = 'number'; minInp.min = '-180'; minInp.max = '180'; minInp.step = '5';
      minInp.style.minHeight = '40px'; minInp.style.width = '70px';
      var maxInp = el('input');
      maxInp.type = 'number'; maxInp.min = '-180'; maxInp.max = '180'; maxInp.step = '5';
      maxInp.style.minHeight = '40px'; maxInp.style.width = '70px';
      row.appendChild(minInp);
      row.appendChild(el('span', '', '→'));
      row.appendChild(maxInp);
      self._csMinMax[axis] = { minEl: minInp, maxEl: maxInp };
      csWrap.appendChild(row);
    });
    var csBtnRow = el('div', 'ed-row');
    csBtnRow.appendChild(btn('💾 Lưu giới hạn', function () {
      var bone = self.getSelectedBone();
      if (!bone) { self.toast('Chọn xương trước.'); return; }
      var c = { min: [], max: [] };
      ['x', 'y', 'z'].forEach(function (ax, i) {
        c.min[i] = Number(self._csMinMax[ax].minEl.value);
        c.max[i] = Number(self._csMinMax[ax].maxEl.value);
      });
      self.setBoneConstraintFor(bone, c);
      self._refreshConstraintPanel();
      self.toast('Đã lưu giới hạn xoay cho ' + bone + ' (lưu vào nhân vật).');
    }));
    csBtnRow.appendChild(btn('↺ Về mặc định', function () {
      var bone = self.getSelectedBone();
      if (!bone) { self.toast('Chọn xương trước.'); return; }
      self.setBoneConstraintFor(bone, edCharDefaultBoneConstraint(bone));
      self._refreshConstraintPanel();
      self.toast('Đã đặt lại giới hạn mặc định cho ' + bone + '.');
    }));
    csBtnRow.appendChild(btn('↺ Tư thế gốc', function () {
      var bone = self.getSelectedBone();
      if (!bone) { self.toast('Chọn xương trước.'); return; }
      if (self.resetBoneRotation(bone)) self.toast('Đã trả ' + bone + ' về tư thế gốc.');
      else self.toast('Không trả được tư thế gốc của xương này.');
    }));
    csWrap.appendChild(csBtnRow);
    host.appendChild(csWrap);

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
      if (self._selectedClipName === c.name) b.classList.add('active');
      b.addEventListener('click', function () {
        self._selectedClipName = c.name; /* đợt 4: clip đang chọn = nguồn retarget mặc định */
        var sibs = list.childNodes;
        for (var k = 0; k < sibs.length; k++) {
          if (sibs[k].classList) sibs[k].classList.toggle('active', sibs[k] === b);
        }
        self.playClip(c.name);
        self._refreshRetargetSelect();
      });
      list.appendChild(b);
    });
    this._refreshRetargetSelect(); /* đợt 4: ô chọn clip nguồn */
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
