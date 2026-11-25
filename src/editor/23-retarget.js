/* Map Editor — 23-retarget.js (đợt 7, nhóm Retarget khác skeleton)
   ED.Retarget: áp clip animation của rig nguồn sang rig đích KHÁC TỈ LỆ
   (khác tên xương / khác kích thước), mở rộng retargetClip cùng tên
   xương của đợt 4 (07-character.js) — module này KHÔNG sửa 07 mà tự
   implement lại phần map tên + đổi tên track (cùng ngữ nghĩa) rồi thêm
   scale theo dài xương + guard humanoid.
   - Bảng map xương nguồn -> đích: tự map theo tên trước (khớp tên giống
     hệt, rồi khớp sau khi bỏ tiền tố 'mixamorig:'), người dùng sửa tay
     từng dòng trong bảng (dropdown chọn xương đích hoặc "— bỏ qua —").
   - Scale theo tỉ lệ dài xương nguồn/đích: dài xương = khoảng cách từ
     xương tới xương con đầu tiên ở tư thế gốc (xương không có con thì
     tỉ lệ 1). Hệ số scale áp cho track '.position' = dài xương ĐÍCH /
     dài xương NGUỒN (rig đích nhỏ hơn thì chuyển động thu nhỏ theo);
     track '.quaternion' không scale (xoay không phụ thuộc kích thước).
     Dài xương đo từ vị trí cục bộ của xương con đầu tiên (|child.position|)
     nên không phụ thuộc tư thế đang phát.
   - Guard humanoid: rig đích phải đủ Hips, Spine, Chest, Neck, Head,
     2 tay, 2 chân (khớp theo tên chứa từ khoá) — không đủ thì từ chối
     + báo rõ xương nào thiếu.
   - CHỈ làm rig humanoid có xương tương đương. KHÔNG retarget quái
     4 chân sang người (ghi rõ trong UI + báo cáo).
   - Trả {clip mới, missing:[tên xương nguồn không map được], unmapped,
     scaledCount, mapped, total}.
   KHÔNG truy cập document/window/THREE ở top-level; mọi khởi tạo trong
   init(). Logic thuần expose để test bằng vm + stub THREE.
   GIỚI HẠN: chưa render thử trên trình duyệt/điện thoại thật; dài xương
   nguồn chỉ đo được khi model nguồn đang mở trong preview (nút "Lấy dài
   xương nguồn từ model đang xem") — không có thì tỉ lệ mặc định 1 (không
   scale vị trí, chỉ map tên); không khớp tư thế nghỉ khác nhau (vd rig
   nguồn A-pose, rig đích T-pose) và không xử lý xương đích thừa/thiếu
   ngoài bảng map; clip retarget phát bằng mixer thường nên constraint
   đợt 3 không chặn (giống đợt 4). */
var ED = (typeof ED !== 'undefined' && ED) ? ED : {};

/* ---------------- Logic thuần (không DOM/THREE) ---------------- */

function _edRStripPrefix(name) {
  return String(name || '').replace(/^mixamorig:/i, '');
}

function edRetargetStripPrefix(name) { return _edRStripPrefix(name); }

/* Tách tên xương khỏi tên track three.js — cùng ngữ nghĩa với
   edCharTrackBoneName (07-character.js):
   '.bones[mixamorig:LeftArm].quaternion' -> 'mixamorig:LeftArm'
   'mixamorig:LeftArm.quaternion'         -> 'mixamorig:LeftArm'
   '.position' / 'position' (không có tên node) -> null. */
function edRetargetTrackBoneName(trackName) {
  if (typeof trackName !== 'string' || !trackName) return null;
  var m = trackName.match(/\.bones\[([^\]]+)\]/);
  if (m && m[1]) return m[1];
  var dot = trackName.indexOf('.');
  if (dot > 0) return trackName.slice(0, dot);
  return null;
}

/* Đổi phần tên xương trong tên track sang tên mới (giữ nguyên hậu tố
   '.quaternion'/'.position'/...). Track không khớp dạng nào giữ nguyên. */
function edRetargetRenameTrackBone(trackName, oldBone, newBone) {
  var oldB = String(oldBone), newB = String(newBone);
  var marker = '.bones[' + oldB + ']';
  var at = trackName.indexOf(marker);
  if (at >= 0) return trackName.slice(0, at) + '.bones[' + newB + ']' + trackName.slice(at + marker.length);
  if (trackName.indexOf(oldB + '.') === 0) return newB + trackName.slice(oldB.length);
  return trackName;
}

/* Hậu tố prop của track: 'quaternion' | 'position' | 'scale' | ... */
function _edRTrackProp(trackName) {
  var at = String(trackName).lastIndexOf('.');
  return at >= 0 ? trackName.slice(at + 1) : '';
}

/* Tự map xương nguồn -> đích:
   1) khớp tên giống hệt; 2) khớp sau khi bỏ tiền tố 'mixamorig:'.
   Mỗi xương đích chỉ nhận 1 xương nguồn (gặp trước thắng) để 2 track
   nguồn không đè lên cùng 1 track đích. Xương không khớp được -> null.
   Trả object {tênNguồn: tênĐích | null} (giữ thứ tự sourceNames). */
function edRetargetAutoMapBones(sourceNames, targetNames) {
  var mapping = {};
  var src = Array.isArray(sourceNames) ? sourceNames : [];
  var tgt = Array.isArray(targetNames) ? targetNames : [];
  var exact = {}, stripped = {};
  tgt.forEach(function (n) {
    var s = String(n);
    if (exact[s] === undefined) exact[s] = s;
    var st = _edRStripPrefix(s);
    if (stripped[st] === undefined) stripped[st] = s;
  });
  var claimed = {};
  src.forEach(function (n) {
    var s = String(n);
    var hit = exact[s] || stripped[_edRStripPrefix(s)] || null;
    if (hit && claimed[hit]) hit = null; /* đích đã có chủ */
    mapping[s] = hit;
    if (hit) claimed[hit] = true;
  });
  return mapping;
}

/* Dài 1 xương = khoảng cách từ xương tới xương con đầu tiên ở tư thế
   gốc. boneRestPos / childRestPos là [x,y,z] trong CÙNG hệ tọa độ
   (vd vị trí world lúc rest, hoặc [0,0,0] + vị trí cục bộ của con).
   Trả số >= 0, hoặc null khi đầu vào không hợp lệ. */
function edRetargetBoneLength(boneRestPos, childRestPos) {
  if (!boneRestPos || !childRestPos) return null;
  var ax = Number(boneRestPos[0]), ay = Number(boneRestPos[1]), az = Number(boneRestPos[2]);
  var bx = Number(childRestPos[0]), by = Number(childRestPos[1]), bz = Number(childRestPos[2]);
  if (!isFinite(ax) || !isFinite(ay) || !isFinite(az) || !isFinite(bx) || !isFinite(by) || !isFinite(bz)) return null;
  var dx = bx - ax, dy = by - ay, dz = bz - az;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/* Dài xương cho cả rig từ vị trí rest + cây con:
   positions {tênXương: [x,y,z]} (vị trí rest, cùng hệ tọa độ),
   children {tênXương: [tênCon...]} (chỉ tính xương con đầu tiên).
   Xương không có con (hoặc con thiếu vị trí) -> null (tỉ lệ 1 khi dùng).
   Trả {tênXương: dài | null}. */
function edRetargetRestLengths(positions, children) {
  var out = {};
  if (!positions || typeof positions !== 'object') return out;
  Object.keys(positions).forEach(function (name) {
    var kids = (children && Array.isArray(children[name])) ? children[name] : [];
    var len = null;
    for (var i = 0; i < kids.length; i++) {
      if (positions[kids[i]]) { len = edRetargetBoneLength(positions[name], positions[kids[i]]); break; }
    }
    out[name] = len;
  });
  return out;
}

/* Hệ số scale vị trí cho 1 xương: dài xương ĐÍCH / dài xương NGUỒN.
   boneLengths {tênXương: {source, target} | số-tỉ-lệ | {ratio}}.
   - Dạng số: dùng trực tiếp làm hệ số (đã là đích/nguồn).
   - Dạng {source, target}: hệ số = target/source; thiếu 1 bên hoặc
     <= 0 thì hệ số 1 (không scale).
   Trả số > 0 (mặc định 1). */
function edRetargetScaleFactor(boneLengths, boneName) {
  if (!boneLengths || !boneName) return 1;
  var e = boneLengths[boneName];
  if (e === undefined || e === null) return 1;
  if (typeof e === 'number') {
    var r = Number(e);
    return (isFinite(r) && r > 0) ? r : 1;
  }
  if (typeof e === 'object') {
    if (isFinite(Number(e.ratio)) && Number(e.ratio) > 0) return Number(e.ratio);
    var s = Number(e.source), t = Number(e.target);
    if (isFinite(s) && s > 0 && isFinite(t) && t > 0) return t / s;
  }
  return 1;
}

/* ---- Guard humanoid ----
   Rig đích phải đủ: Hips, Spine, Chest, Neck, Head, tay trái, tay
   phải, chân trái, chân phải. Khớp theo tên chứa từ khoá (sau khi bỏ
   prefix 'mixamorig:', không phân biệt hoa/thường):
   - 'hips' / 'spine' / 'chest' / 'neck' / 'head' (chứa từ đó),
   - tay trái: chứa 'left' + 'arm' (LeftArm, LeftForeArm đều tính),
   - tay phải: chứa 'right' + 'arm',
   - chân trái: chứa 'left' + 'leg' (LeftUpLeg chứa 'leg'),
   - chân phải: chứa 'right' + 'leg'.
   Trả {ok, missing:[nhãn tiếng Việt của xương thiếu]}. */
var ED_RETARGET_HUMANOID_REQUIRED = [
  { key: 'hips', label: 'Hips', test: function (n) { return n.indexOf('hips') >= 0; } },
  { key: 'spine', label: 'Spine', test: function (n) { return n.indexOf('spine') >= 0; } },
  { key: 'chest', label: 'Chest', test: function (n) { return n.indexOf('chest') >= 0; } },
  { key: 'neck', label: 'Neck', test: function (n) { return n.indexOf('neck') >= 0; } },
  { key: 'head', label: 'Head', test: function (n) { return n.indexOf('head') >= 0; } },
  { key: 'leftArm', label: 'Tay trái', test: function (n) { return n.indexOf('left') >= 0 && n.indexOf('arm') >= 0; } },
  { key: 'rightArm', label: 'Tay phải', test: function (n) { return n.indexOf('right') >= 0 && n.indexOf('arm') >= 0; } },
  { key: 'leftLeg', label: 'Chân trái', test: function (n) { return n.indexOf('left') >= 0 && n.indexOf('leg') >= 0; } },
  { key: 'rightLeg', label: 'Chân phải', test: function (n) { return n.indexOf('right') >= 0 && n.indexOf('leg') >= 0; } }
];

function edRetargetValidateHumanoid(boneNames) {
  var names = (Array.isArray(boneNames) ? boneNames : []).map(function (n) {
    return _edRStripPrefix(n).toLowerCase();
  });
  var missing = [];
  ED_RETARGET_HUMANOID_REQUIRED.forEach(function (req) {
    var found = false;
    for (var i = 0; i < names.length; i++) {
      if (req.test(names[i])) { found = true; break; }
    }
    if (!found) missing.push(req.label);
  });
  return { ok: missing.length === 0, missing: missing };
}

/* Áp 1 clip (dạng thuần {name, duration, tracks:[{name, times,
   values}]}) sang rig đích theo bảng map:
   - mapping {tênXươngNguồn: tênXươngĐích | null}: null/thiếu key =
     bỏ track, ghi vào missing.
   - Track không thuộc xương (vd '.position' của node gốc) giữ nguyên,
     không scale.
   - Track xương đã map: đổi tên sang xương đích; track '.position'
     scale values (bộ 3 xyz) theo hệ số dài xương đích/nguồn
     (edRetargetScaleFactor); '.quaternion'/'.scale' giữ nguyên.
   - Track hỏng (không có name) bị bỏ, không đếm vào missing.
   Trả {clip: {name, duration, tracks} (mới, không sửa clip gốc),
         missing: [tên xương nguồn không map được (mỗi tên 1 lần, theo
           thứ tự xuất hiện đầu tiên)],
         unmapped: số track đã bỏ, mapped: số track trong clip mới,
         total: số track gốc, scaledCount: số track '.position' đã
         scale (hệ số != 1)}.
   boneLengths: xem edRetargetScaleFactor (không truyền -> hệ số 1). */
function edRetargetApplyMapping(clip, mapping, boneLengths) {
  var name = (clip && typeof clip.name === 'string' && clip.name) ? clip.name : 'Clip';
  var duration = (clip && isFinite(Number(clip.duration))) ? Number(clip.duration) : 0;
  var tracks = (clip && Array.isArray(clip.tracks)) ? clip.tracks : [];
  var map = (mapping && typeof mapping === 'object') ? mapping : {};
  var out = [], missing = [], missingSeen = {};
  var unmapped = 0, scaledCount = 0;
  tracks.forEach(function (t) {
    if (!t || typeof t.name !== 'string' || !t.name) { unmapped++; return; } /* track hỏng: bỏ */
    var bone = edRetargetTrackBoneName(t.name);
    if (bone === null) { /* track không thuộc xương: giữ nguyên */
      out.push({ name: t.name, times: Array.prototype.slice.call(t.times || []), values: Array.prototype.slice.call(t.values || []) });
      return;
    }
    var target = map[bone];
    if (target === undefined || target === null) {
      /* Thử khớp lại theo tên đã bỏ prefix (bảng map có thể ghi tên
         dạng khác với track, vd track 'mixamorig:LeftArm' mà map ghi
         'LeftArm'). */
      var stripped = _edRStripPrefix(bone);
      if (map[stripped] !== undefined && map[stripped] !== null) target = map[stripped];
      else {
        var keys = Object.keys(map);
        for (var k = 0; k < keys.length; k++) {
          if (_edRStripPrefix(keys[k]) === stripped && map[keys[k]]) { target = map[keys[k]]; break; }
        }
      }
    }
    if (!target) {
      if (!missingSeen[bone]) { missingSeen[bone] = true; missing.push(bone); }
      unmapped++;
      return;
    }
    var newName = (target === bone) ? t.name : edRetargetRenameTrackBone(t.name, bone, target);
    var values = Array.prototype.slice.call(t.values || []);
    if (_edRTrackProp(newName) === 'position') {
      var f = edRetargetScaleFactor(boneLengths, bone);
      if (f !== 1) {
        for (var i = 0; i < values.length; i++) {
          var v = Number(values[i]);
          values[i] = isFinite(v) ? v * f : v;
        }
        scaledCount++;
      }
    }
    out.push({ name: newName, times: Array.prototype.slice.call(t.times || []), values: values });
  });
  return {
    clip: { name: name, duration: duration, tracks: out },
    missing: missing, unmapped: unmapped,
    mapped: out.length, total: tracks.length, scaledCount: scaledCount
  };
}

/* ---------------- Module ED.Retarget ---------------- */

ED.Retarget = (function () {
  var _inited = false;
  var _panel = null, _statusEl = null, _resultEl = null;
  var _srcSel = null, _mapBody = null;
  var _sources = []; /* [{label, clip}] */
  var _sourceBones = []; /* tên xương nguồn trong clip đang chọn */
  var _mapping = {}; /* {tênNguồn: tênĐích | null} — người dùng sửa tay */
  var _targetLengths = null; /* {tênXươngĐích: dài} đo từ rig đích */
  var _sourceLengths = null; /* {tênXươngNguồn: dài} đo từ rig nguồn */
  var _lastClip = null; /* THREE.AnimationClip đã retarget (phát thử) */
  var _lastResult = null;

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

  /* Tên xương rig đích = model đang preview: ưu tiên API mới của
     Character nếu có, không thì pv.bones, cuối cùng skeleton.bones. */
  function _targetBoneNames() {
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
    if (pv.group && typeof pv.group.traverse === 'function') {
      pv.group.traverse(function (obj) {
        if (obj && obj.isSkinnedMesh && obj.skeleton && obj.skeleton.bones) {
          obj.skeleton.bones.forEach(function (bone) {
            if (bone && bone.name && !seen[bone.name]) { seen[bone.name] = true; names.push(bone.name); }
          });
        }
      });
    }
    return names;
  }

  /* Danh sách clip nguồn: clip của model đang xem + kho clip các file
     đã nhập trong phiên (_retargetClipBank của Character, qua guard).
     Trùng clip (cùng object) thì chỉ giữ 1. */
  function _sourceClipList() {
    var list = [];
    var seen = [];
    function push(clip, label) {
      if (!clip || typeof clip.name !== 'string') return;
      if (seen.indexOf(clip) >= 0) return;
      seen.push(clip);
      list.push({ label: label, clip: clip });
    }
    var pv = _getPreview();
    if (pv && pv.group && pv.group.animations) {
      pv.group.animations.forEach(function (c) { push(c, c.name + ' — model đang xem'); });
    }
    try {
      var bank = (ED.Character && Array.isArray(ED.Character._retargetClipBank)) ? ED.Character._retargetClipBank : [];
      bank.forEach(function (e) { if (e) push(e.clip, e.label || (e.clip && e.clip.name)); });
    } catch (e) {}
    return list;
  }

  function _sourceBonesOfClip(clip) {
    var out = [], seen = {};
    if (!clip || !Array.isArray(clip.tracks)) return out;
    clip.tracks.forEach(function (t) {
      var b = t && edRetargetTrackBoneName(t.name);
      if (b && !seen[b]) { seen[b] = true; out.push(b); }
    });
    return out;
  }

  function _getSourceClip() {
    if (!_sources.length) return null;
    if (!_srcSel || _srcSel.value === '' || _srcSel.value === null) return _sources[0].clip;
    var idx = Number(_srcSel.value);
    if (!isFinite(idx) || idx < 0 || idx >= _sources.length) return null;
    return _sources[idx].clip;
  }

  /* Đo dài xương của rig đang preview: dài xương = |vị trí cục bộ của
     xương con đầu tiên| — không phụ thuộc tư thế đang phát (clip chỉ
     đổi quaternion, không đổi position cục bộ của xương con, trừ Hips).
     Trả {tênXương: dài} (xương không con -> không có key). */
  function _measureLengthsFromPreview() {
    var pv = _getPreview();
    if (!pv || !pv.group) return null;
    var bones = [];
    pv.group.traverse(function (obj) { if (obj && obj.isBone) bones.push(obj); });
    if (!bones.length) return null;
    var byName = {};
    bones.forEach(function (b) { if (b && b.name) byName[b.name] = b; });
    var out = {};
    bones.forEach(function (b) {
      if (!b || !b.name) return;
      var kids = (b.children || []).filter(function (c) { return c && c.isBone; });
      if (!kids.length) return;
      var cp = kids[0].position;
      if (!cp) return;
      var len = edRetargetBoneLength([0, 0, 0], [Number(cp.x) || 0, Number(cp.y) || 0, Number(cp.z) || 0]);
      if (len !== null && len > 0) out[b.name] = len;
    });
    return out;
  }

  function _refreshSourceSelect() {
    if (!_srcSel) return;
    _sources = _sourceClipList();
    var prev = _srcSel.value;
    while (_srcSel.firstChild) _srcSel.removeChild(_srcSel.firstChild);
    if (!_sources.length) {
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = 'Chưa có clip nào — nhập file .fbx/.glb có animation trước.';
      _srcSel.appendChild(o0);
      _sourceBones = [];
      _mapping = {};
      _renderMapTable();
      return;
    }
    _sources.forEach(function (src, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = src.label;
      _srcSel.appendChild(o);
    });
    if (prev !== '' && prev !== null && isFinite(Number(prev)) && Number(prev) < _sources.length) _srcSel.value = prev;
    else _srcSel.value = '0';
    _onSourceChanged();
  }

  function _onSourceChanged() {
    var clip = _getSourceClip();
    _sourceBones = _sourceBonesOfClip(clip);
    var targets = _targetBoneNames();
    _mapping = edRetargetAutoMapBones(_sourceBones, targets);
    _renderMapTable();
    _updateStatus();
  }

  /* Bảng map: 1 dòng / xương nguồn — dropdown chọn xương đích hoặc
     "— bỏ qua —". Sửa tay cập nhật _mapping ngay. */
  function _renderMapTable() {
    if (!_mapBody) return;
    while (_mapBody.firstChild) _mapBody.removeChild(_mapBody.firstChild);
    var targets = _targetBoneNames();
    if (!_sourceBones.length) {
      var d = document.createElement('div');
      d.textContent = 'Chưa có clip nguồn — chọn clip ở trên.';
      _mapBody.appendChild(d);
      return;
    }
    _sourceBones.forEach(function (src) {
      var row = document.createElement('div');
      row.className = 'ed-row';
      var lab = document.createElement('label');
      lab.textContent = src;
      lab.style.minWidth = '120px';
      row.appendChild(lab);
      var sel = document.createElement('select');
      sel.style.flex = '1';
      sel.style.minHeight = '40px';
      var oSkip = document.createElement('option');
      oSkip.value = '';
      oSkip.textContent = '— bỏ qua —';
      sel.appendChild(oSkip);
      targets.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t;
        o.textContent = t;
        sel.appendChild(o);
      });
      sel.value = _mapping[src] || '';
      sel.addEventListener('change', function () {
        _mapping[src] = sel.value || null;
        _updateStatus();
      });
      row.appendChild(sel);
      _mapBody.appendChild(row);
    });
  }

  function _updateStatus() {
    if (!_statusEl) return;
    var pv = _getPreview();
    var targets = _targetBoneNames();
    var v = edRetargetValidateHumanoid(targets);
    var parts = [];
    if (!pv || !pv.group) parts.push('Chưa có model đích trong preview — nhập file .fbx/.glb trước.');
    else {
      parts.push('Rig đích: ' + targets.length + ' xương — ' +
        (v.ok ? 'đủ xương humanoid.' : 'THIẾU xương humanoid: ' + v.missing.join(', ') + ' — chưa retarget được.'));
    }
    if (_sourceBones.length) {
      var mappedN = 0;
      _sourceBones.forEach(function (s) { if (_mapping[s]) mappedN++; });
      parts.push('Clip nguồn: ' + _sourceBones.length + ' xương, đã map ' + mappedN + ', bỏ qua ' + (_sourceBones.length - mappedN) + '.');
    }
    parts.push(_targetLengths ? 'Đã đo dài xương rig đích.' : 'Chưa đo dài xương rig đích (bấm nút đo để scale đúng tỉ lệ).');
    parts.push(_sourceLengths ? 'Đã có dài xương nguồn.' : 'Chưa có dài xương nguồn — tỉ lệ scale mặc định 1 (chỉ map tên, không scale vị trí).');
    _statusEl.textContent = parts.join(' ');
  }

  function _reportResult(r) {
    var msg;
    if (!r.ok) {
      msg = 'Retarget thất bại: ' + (r.reason || 'không rõ lý do.');
      if (r.missing && r.missing.length) msg += ' Xương thiếu: ' + r.missing.join(', ') + '.';
    } else {
      msg = 'Retarget xong: map được ' + r.mapped + '/' + r.total + ' track' +
        (r.scaledCount ? (', đã scale vị trí ' + r.scaledCount + ' track theo tỉ lệ dài xương.') : ', không scale track nào (tỉ lệ 1).');
      msg += r.missing.length
        ? (' Xương nguồn không map được (track đã bỏ): ' + r.missing.join(', ') + '.')
        : ' Đủ xương, không thiếu xương nào.';
    }
    if (_resultEl) _resultEl.textContent = msg;
    _log(msg);
    try {
      if (typeof console !== 'undefined' && r.missing && r.missing.length && console.warn) {
        console.warn('[Retarget] Xương nguồn không map được:', r.missing);
      }
    } catch (e) {}
    return msg;
  }

  /* Xây THREE.AnimationClip từ clip thuần (cùng pattern đợt 4:
     QuaternionKeyframeTrack / VectorKeyframeTrack / NumberKeyframeTrack).
     Trả clip THREE hoặc null. */
  function _buildThreeClip(plain) {
    if (typeof THREE === 'undefined' || !THREE.AnimationClip || !plain || !Array.isArray(plain.tracks)) return null;
    var threeTracks = [];
    for (var i = 0; i < plain.tracks.length; i++) {
      var pt = plain.tracks[i];
      var prop = pt.name.slice(pt.name.lastIndexOf('.') + 1);
      try {
        if (prop === 'quaternion' && THREE.QuaternionKeyframeTrack) threeTracks.push(new THREE.QuaternionKeyframeTrack(pt.name, pt.times, pt.values));
        else if ((prop === 'position' || prop === 'scale') && THREE.VectorKeyframeTrack) threeTracks.push(new THREE.VectorKeyframeTrack(pt.name, pt.times, pt.values));
        else if (THREE.NumberKeyframeTrack) threeTracks.push(new THREE.NumberKeyframeTrack(pt.name, pt.times, pt.values));
      } catch (e) {}
    }
    if (!threeTracks.length) return null;
    var dur = (plain.duration > 0) ? plain.duration : -1; /* -1: THREE tự tính từ track */
    try { return new THREE.AnimationClip(plain.name, dur, threeTracks); }
    catch (e) { return null; }
  }

  /* Áp dụng retarget: guard humanoid -> applyMapping -> dựng clip
     THREE -> phát ngay qua ED.Character.playCustomClip (guard).
     Trả {ok, mapped, total, missing, unmapped, scaledCount} hoặc
     {ok:false, reason, ...}. */
  function applyRetarget() {
    var pv = _getPreview();
    if (!pv || !pv.group) return _reportResult({ ok: false, reason: 'Chưa có model đích trong preview — nhập file .fbx/.glb trước.' }), { ok: false, reason: 'Chưa có model đích trong preview.' };
    var clip = _getSourceClip();
    if (!clip || !Array.isArray(clip.tracks)) return { ok: false, reason: 'Clip nguồn không hợp lệ.' };
    var targets = _targetBoneNames();
    if (!targets.length) return { ok: false, reason: 'Model đích không có xương — không retarget được.' };
    var v = edRetargetValidateHumanoid(targets);
    if (!v.ok) {
      return _reportResult({ ok: false, reason: 'Rig đích thiếu xương humanoid bắt buộc: ' + v.missing.join(', ') + '. Chỉ retarget rig humanoid đủ xương.' }),
        { ok: false, reason: 'Rig đích thiếu xương humanoid: ' + v.missing.join(', '), missing: v.missing };
    }
    var sourceBones = _sourceBonesOfClip(clip);
    var plain = {
      name: clip.name,
      duration: Number(clip.duration) || 0,
      tracks: clip.tracks.map(function (t) {
        return {
          name: t.name,
          times: Array.prototype.slice.call(t.times || []),
          values: Array.prototype.slice.call(t.values || [])
        };
      })
    };
    /* Bảng tỉ lệ dài xương: {tênXươngNguồn: {source, target}} — khớp
       theo tên (bỏ prefix khi cần); thiếu 1 bên thì hệ số 1. */
    var boneLengths = {};
    sourceBones.forEach(function (src) {
      var dst = _mapping[src];
      if (!dst) return;
      var sLen = null, tLen = null;
      if (_sourceLengths) {
        sLen = _sourceLengths[src];
        if (sLen === undefined) sLen = _sourceLengths[_edRStripPrefix(src)];
      }
      if (_targetLengths) {
        tLen = _targetLengths[dst];
        if (tLen === undefined) tLen = _targetLengths[_edRStripPrefix(dst)];
      }
      if (sLen !== null && sLen !== undefined && tLen !== null && tLen !== undefined) {
        boneLengths[src] = { source: sLen, target: tLen };
      }
    });
    var res = edRetargetApplyMapping(plain, _mapping, boneLengths);
    if (!res.mapped) {
      return _reportResult({ ok: false, reason: 'Không map được track nào — rig đích thiếu tất cả xương trong clip.', missing: res.missing, mapped: 0, total: res.total }),
        { ok: false, reason: 'Không map được track nào.', missing: res.missing, mapped: 0, total: res.total, unmapped: res.unmapped, scaledCount: 0 };
    }
    var threeClip = _buildThreeClip(res.clip);
    if (!threeClip) {
      return _reportResult({ ok: false, reason: 'Không dựng lại được track animation cho rig đích.', missing: res.missing, mapped: res.mapped, total: res.total }),
        { ok: false, reason: 'Không dựng được clip THREE.', missing: res.missing, mapped: res.mapped, total: res.total, unmapped: res.unmapped, scaledCount: res.scaledCount };
    }
    /* Model đích không có clip gốc -> chưa có mixer: tạo mới (như đợt 4). */
    if (!pv.mixer && pv.group && typeof THREE !== 'undefined' && typeof THREE.AnimationMixer === 'function') {
      try { pv.mixer = new THREE.AnimationMixer(pv.group); } catch (e) { pv.mixer = null; }
    }
    _lastClip = threeClip;
    _lastResult = { ok: true, mapped: res.mapped, total: res.total, missing: res.missing, unmapped: res.unmapped, scaledCount: res.scaledCount, clipName: res.clip.name };
    var played = false;
    try {
      if (ED.Character && typeof ED.Character.playCustomClip === 'function') played = ED.Character.playCustomClip(threeClip, { fadeSec: 0.3 });
    } catch (e) { played = false; }
    if (!played) {
      try {
        if (pv.mixer && typeof pv.mixer.clipAction === 'function') {
          var action = pv.mixer.clipAction(threeClip);
          action.reset();
          action.play();
          pv.action = action;
          pv.playing = true;
          played = true;
        }
      } catch (e) { played = false; }
    }
    _pushHistory('Retarget clip ' + (clip.name || ''));
    _reportResult(_lastResult);
    if (!played) _toast('Đã retarget nhưng không phát được clip trong preview — bấm "Phát thử clip đã retarget".');
    return _lastResult;
  }

  /* Phát thử clip đã retarget lần nữa (qua preview mixer nếu có). */
  function playRetargeted() {
    if (!_lastClip) { _toast('Chưa có clip retarget nào — bấm "Áp dụng retarget" trước.'); return false; }
    var pv = _getPreview();
    if (!pv || !pv.group) { _toast('Chưa có model đích trong preview.'); return false; }
    try {
      if (ED.Character && typeof ED.Character.playCustomClip === 'function') {
        if (ED.Character.playCustomClip(_lastClip, { fadeSec: 0.3 })) return true;
      }
    } catch (e) {}
    try {
      if (!pv.mixer && typeof THREE !== 'undefined' && typeof THREE.AnimationMixer === 'function') pv.mixer = new THREE.AnimationMixer(pv.group);
      if (pv.mixer && typeof pv.mixer.clipAction === 'function') {
        var action = pv.mixer.clipAction(_lastClip);
        action.reset();
        action.play();
        pv.action = action;
        pv.playing = true;
        return true;
      }
    } catch (e) {}
    _toast('Không phát được clip đã retarget trong preview.');
    return false;
  }

  function refresh() {
    _refreshSourceSelect();
    _updateStatus();
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
    panel.className = 'ed-retarget-panel';
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

    panel.appendChild(el('h3', null, '🔁 Retarget khác skeleton'));
    panel.appendChild(el('div', 'ed-char-hint',
      'Chỉ retarget rig HUMANOID có xương tương đương (người sang người, khác tỉ lệ). ' +
      'KHÔNG retarget quái 4 chân sang người. Rig đích phải đủ Hips, Spine, Chest, Neck, Head, 2 tay, 2 chân.'));
    _statusEl = el('div', 'ed-char-hint', 'Chưa có model đích — nhập file .fbx/.glb trước.');
    panel.appendChild(_statusEl);

    var rowSrc = el('div', 'ed-row');
    rowSrc.appendChild(el('label', null, 'Clip nguồn:'));
    _srcSel = el('select');
    _srcSel.style.flex = '1';
    _srcSel.style.minHeight = '40px';
    _srcSel.addEventListener('change', function () { _onSourceChanged(); });
    rowSrc.appendChild(_srcSel);
    panel.appendChild(rowSrc);

    var rowLen = el('div', 'ed-row');
    var measureTargetBtn = bigBtn('📏 Đo dài xương rig đích');
    measureTargetBtn.style.flex = '1';
    measureTargetBtn.addEventListener('click', function () {
      _targetLengths = _measureLengthsFromPreview();
      if (!_targetLengths) { _toast('Không đo được dài xương — rig đích không có xương.'); return; }
      _toast('Đã đo dài xương rig đích (' + Object.keys(_targetLengths).length + ' xương có con).');
      _updateStatus();
    });
    var measureSourceBtn = bigBtn('📏 Lấy dài xương nguồn từ model đang xem');
    measureSourceBtn.style.flex = '1';
    measureSourceBtn.addEventListener('click', function () {
      _sourceLengths = _measureLengthsFromPreview();
      if (!_sourceLengths) { _toast('Không đo được dài xương — model đang xem không có xương.'); return; }
      _toast('Đã lấy dài xương nguồn từ model đang xem (' + Object.keys(_sourceLengths).length + ' xương có con). Dùng khi clip nguồn chính là của model này.');
      _updateStatus();
    });
    rowLen.appendChild(measureTargetBtn);
    rowLen.appendChild(measureSourceBtn);
    panel.appendChild(rowLen);

    panel.appendChild(el('div', 'ed-char-hint', 'Bảng map xương nguồn → đích (tự map theo tên, sửa tay từng dòng):'));
    _mapBody = el('div');
    panel.appendChild(_mapBody);

    var rowAct = el('div', 'ed-row');
    var autoBtn = bigBtn('🔁 Tự map lại theo tên');
    autoBtn.style.flex = '1';
    autoBtn.addEventListener('click', function () {
      _mapping = edRetargetAutoMapBones(_sourceBones, _targetBoneNames());
      _renderMapTable();
      _updateStatus();
      _toast('Đã tự map lại theo tên.');
    });
    var applyBtn = bigBtn('✅ Áp dụng retarget');
    applyBtn.style.flex = '1';
    applyBtn.addEventListener('click', function () { applyRetarget(); });
    rowAct.appendChild(autoBtn);
    rowAct.appendChild(applyBtn);
    panel.appendChild(rowAct);

    var playBtn = bigBtn('▶ Phát thử clip đã retarget');
    playBtn.style.width = '100%';
    playBtn.addEventListener('click', function () { playRetargeted(); });
    panel.appendChild(playBtn);

    var refreshBtn = bigBtn('↻ Làm mới danh sách clip');
    refreshBtn.style.width = '100%';
    refreshBtn.addEventListener('click', function () { refresh(); _toast('Đã làm mới danh sách clip.'); });
    panel.appendChild(refreshBtn);

    _resultEl = el('div', 'ed-char-hint', 'Chưa retarget clip nào.');
    panel.appendChild(_resultEl);
    panel.appendChild(el('div', 'ed-char-hint',
      'Cách dùng: nhập model đích vào preview → chọn clip nguồn (của rig khác) → sửa bảng map nếu cần → ' +
      'bấm "Đo dài xương rig đích" và (nếu có) "Lấy dài xương nguồn từ model đang xem" để scale đúng tỉ lệ → ' +
      '"Áp dụng retarget" để phát thử ngay. Track ".position" được scale theo tỉ lệ dài xương đích/nguồn, ' +
      'track xoay giữ nguyên. Xương nguồn không map được sẽ bị bỏ và liệt kê ở kết quả.'));
    refresh();
    return true;
  }

  return {
    init: init, refresh: refresh,
    applyRetarget: applyRetarget, playRetargeted: playRetargeted,
    getMapping: function () { return _mapping; },
    setMapping: function (m) { _mapping = (m && typeof m === 'object') ? m : {}; _renderMapTable(); _updateStatus(); return _mapping; },
    getLastResult: function () { return _lastResult; },
    getSourceBones: function () { return _sourceBones.slice(); },
    getTargetBoneNames: _targetBoneNames,
    measureLengthsFromPreview: _measureLengthsFromPreview,
    /* Hàm thuần (harness test bằng vm). */
    autoMapBones: edRetargetAutoMapBones,
    applyMapping: edRetargetApplyMapping,
    boneLength: edRetargetBoneLength,
    restLengths: edRetargetRestLengths,
    scaleFactor: edRetargetScaleFactor,
    validateHumanoid: edRetargetValidateHumanoid,
    stripBonePrefix: edRetargetStripPrefix,
    trackBoneName: edRetargetTrackBoneName,
    renameTrackBone: edRetargetRenameTrackBone
  };
})();
