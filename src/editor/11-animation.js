/* ============================== 11-animation.js ==============================
   ED.Animation — Animation Editor cho Map Editor (đợt 2).
   - Timeline: tạo/sửa animation tự tạo (keyframe pos/rot) cho object trong
     scene hoặc xương nhân vật preview; lưu vào project.animations[]
     (project cũ không có field này vẫn mở được — tự mặc định [] khi đọc).
   - Phát clip tự tạo bằng THREE.AnimationMixer THẬT (NumberKeyframeTrack,
     tên node = targetId để mixer tìm đúng object/bone), xem trước được ngay
     trong preview nhân vật (mixer của ED.Character) hoặc trên object trong
     scene (mixer riêng trên ED.Viewport.meshes[targetId]).
   - State machine: Idle/Walk/Run/Attack/Skill/Cast/Hit/Death + transition
     theo điều kiện (moving/attacking/idle/hp<=0/key), lưu trong
     project.stateMachines[charId]; nút "Mô phỏng" thử chuyển state.
   - Blending: chuyển clip dùng crossFadeTo với thời gian fade chỉnh được.
   - Root motion: toggle; khi bật, group nhân vật di chuyển theo delta X/Z
     của xương Hips (track pos.x/pos.z) theo từng frame.
   - ĐỢT 3: kéo keyframe trực tiếp trên lane (chuột + chạm, snap 0.05s,
     kẹp [0, duration], kéo qua key khác thì dừng lại ngay trước nó);
     copy/paste keyframe (chọn 1 hoặc nhiều key cùng track bằng
     Shift-click, Ctrl+C / Ctrl+V hoặc nút Copy/Paste trên timeline);
     track scale (scale.x/y/z) cho object — keyframe scale thêm/xoá/kéo/
     copy-paste như pos/rot, clip tự tạo phát scale bằng
     NumberKeyframeTrack thật, project JSON lưu cùng định dạng tracks[]
     (project cũ không có track scale vẫn mở được).
   QUY TẮC DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo trong init(). Logic thuần expose để test bằng vm + stub
   THREE. Chỉ sửa file này. Không sửa file nhóm khác. GIỚI HẠN: chưa render
   thử trên trình duyệt/điện thoại thật; root motion chỉ có tác dụng khi
   clip có track vị trí của xương Hips; clip tự tạo chỉ đổi pos/rot/scale
   (không morph, không IK). */

var ED = (typeof ED !== 'undefined' && ED) ? ED : {};

/* ---------------- Hằng số ---------------- */

var ED_ANIM_STATES = ['Idle', 'Walk', 'Run', 'Attack', 'Skill', 'Cast', 'Hit', 'Death'];
var ED_ANIM_STATE_LABELS = {
  Idle: 'Đứng yên', Walk: 'Đi bộ', Run: 'Chạy', Attack: 'Tấn công',
  Skill: 'Kỹ năng', Cast: 'Niệm chú', Hit: 'Trúng đòn', Death: 'Chết'
};
var ED_ANIM_CONDITIONS = ['moving', 'attacking', 'idle', 'hp<=0', 'key'];
var ED_ANIM_CONDITION_LABELS = {
  moving: 'Đang di chuyển', attacking: 'Đang tấn công', idle: 'Đứng yên',
  'hp<=0': 'Hết HP (hp<=0)', key: 'Bấm phím'
};

/* Lưới thời gian khi kéo keyframe (giây). */
var ED_ANIM_DRAG_SNAP = 0.05;

/* Làm tròn thời gian về lưới snap (mặc định 0.05s). */
function edAnimSnapTime(t, step) {
  var s = isFinite(Number(step)) && Number(step) > 0 ? Number(step) : ED_ANIM_DRAG_SNAP;
  var n = Number(t);
  if (!isFinite(n)) return 0;
  return Number((Math.round(n / s) * s).toFixed(2));
}

function edAnimClampFade(v) {
  var n = Number(v);
  if (!isFinite(n)) return 0.3;
  return Math.min(2, Math.max(0, n));
}

function edAnimClampSpeed(v) {
  var n = Number(v);
  if (!isFinite(n)) return 1;
  return Math.min(2, Math.max(0.25, n));
}

function edAnimClampTime(t, duration) {
  var n = Number(t);
  if (!isFinite(n)) return 0;
  var d = Number(duration);
  if (!isFinite(d) || d < 0) d = 0;
  return Math.min(d, Math.max(0, n));
}

function edAnimNewAnimation(id, name, targetType, targetId) {
  return {
    id: id, name: name || 'Animation mới',
    targetType: (targetType === 'bone') ? 'bone' : 'object',
    targetId: targetId || '',
    duration: 2,
    tracks: [] /* [{prop:'pos.x'|'rot.y'|..., keys:[{t, v}]}] */
  };
}

function edAnimNextId(project) {
  var anims = (project && Array.isArray(project.animations)) ? project.animations : [];
  var n = anims.length + 1;
  var used = {};
  anims.forEach(function (a) { if (a && a.id) used[a.id] = true; });
  while (used['anim' + n]) n++;
  return 'anim' + n;
}

/* Project cũ không có field animations/stateMachines vẫn mở được:
   tự tạo mặc định khi đọc (không đụng project mới của 00-core.js). */
function edAnimEnsureAnimations(project) {
  if (!project || typeof project !== 'object') return [];
  if (!Array.isArray(project.animations)) project.animations = [];
  return project.animations;
}

function edAnimEnsureStateMachines(project) {
  if (!project || typeof project !== 'object') return {};
  if (!project.stateMachines || typeof project.stateMachines !== 'object' ||
      Array.isArray(project.stateMachines)) project.stateMachines = {};
  return project.stateMachines;
}

function edAnimGetAnimation(project, id) {
  var anims = edAnimEnsureAnimations(project);
  for (var i = 0; i < anims.length; i++) {
    if (anims[i] && anims[i].id === id) return anims[i];
  }
  return null;
}

/* Prop chỉnh được theo target: object đủ pos+rot+scale (scale thêm đợt 3),
   xương chỉ rot (xương Mixamo thường chỉ xoay; pos của xương chỉ dùng cho
   Hips khi bật root motion — vẫn cho key bằng tay qua track pos nếu có). */
function edAnimTrackProps(targetType) {
  if (targetType === 'bone') return ['rot.x', 'rot.y', 'rot.z'];
  return ['pos.x', 'pos.y', 'pos.z', 'rot.x', 'rot.y', 'rot.z',
    'scale.x', 'scale.y', 'scale.z'];
}

function edAnimPropLabel(prop) {
  var map = {
    'pos.x': 'Vị trí X', 'pos.y': 'Vị trí Y', 'pos.z': 'Vị trí Z',
    'rot.x': 'Xoay X', 'rot.y': 'Xoay Y', 'rot.z': 'Xoay Z',
    'scale.x': 'Tỉ lệ X', 'scale.y': 'Tỉ lệ Y', 'scale.z': 'Tỉ lệ Z'
  };
  return map[prop] || prop;
}

/* Tên property THREE tương ứng: 'pos.x' -> 'position[x]',
   'scale.y' -> 'scale[y]'. */
function edAnimPropBinding(prop) {
  var map = {
    'pos.x': 'position[x]', 'pos.y': 'position[y]', 'pos.z': 'position[z]',
    'rot.x': 'rotation[x]', 'rot.y': 'rotation[y]', 'rot.z': 'rotation[z]',
    'scale.x': 'scale[x]', 'scale.y': 'scale[y]', 'scale.z': 'scale[z]'
  };
  return map[prop] || null;
}

function edAnimFindTrack(anim, prop) {
  if (!anim || !Array.isArray(anim.tracks)) return null;
  for (var i = 0; i < anim.tracks.length; i++) {
    if (anim.tracks[i] && anim.tracks[i].prop === prop) return anim.tracks[i];
  }
  return null;
}

function edAnimGetOrCreateTrack(anim, prop) {
  var tr = edAnimFindTrack(anim, prop);
  if (tr) return tr;
  tr = { prop: prop, keys: [] };
  anim.tracks.push(tr);
  return tr;
}

/* Thêm keyframe tại thời gian t (giây), giá trị v. Chèn đúng thứ tự thời
   gian; trùng thời gian (sai số 1e-6) thì ghi đè giá trị cũ. Tự kéo dài
   duration nếu key nằm ngoài. Trả key vừa thêm hoặc null nếu prop sai. */
function edAnimAddKey(anim, prop, t, v) {
  if (!anim || !Array.isArray(anim.tracks)) return null;
  if (!edAnimPropBinding(prop)) return null;
  var tt = Number(t);
  var vv = Number(v);
  if (!isFinite(tt) || !isFinite(vv)) return null;
  if (tt < 0) tt = 0;
  var tr = edAnimGetOrCreateTrack(anim, prop);
  for (var i = 0; i < tr.keys.length; i++) {
    if (Math.abs(tr.keys[i].t - tt) < 1e-6) {
      tr.keys[i].v = vv;
      if (tt > anim.duration) anim.duration = tt;
      return tr.keys[i];
    }
    if (tr.keys[i].t > tt) {
      var key = { t: tt, v: vv };
      tr.keys.splice(i, 0, key);
      if (tt > anim.duration) anim.duration = tt;
      return key;
    }
  }
  var last = { t: tt, v: vv };
  tr.keys.push(last);
  if (tt > anim.duration) anim.duration = tt;
  return last;
}

/* Xoá keyframe tại thời gian t (sai số 1e-6). Trả true nếu xoá được. */
function edAnimRemoveKey(anim, prop, t) {
  var tr = edAnimFindTrack(anim, prop);
  if (!tr) return false;
  var tt = Number(t);
  for (var i = 0; i < tr.keys.length; i++) {
    if (Math.abs(tr.keys[i].t - tt) < 1e-6) {
      tr.keys.splice(i, 1);
      return true;
    }
  }
  return false;
}

/* ---------------- Đợt 3: kéo / copy-paste keyframe (thuần) ---------------- */

/* Kéo 1 keyframe trên cùng track sang thời gian mới.
   - Snap về lưới 0.05s, kẹp trong [0, duration] (không kéo dài duration).
   - KHÔNG cho 2 key cùng track trùng thời gian: kéo qua key kề thì DỪNG
     LẠI NGAY TRƯỚC NÓ (cách đúng 1 ô lưới 0.05s); nếu giữa 2 key kề
     không còn chỗ trống trên lưới (vd key cách nhau đúng 0.05s) thì key
     đứng yên và trả ok:false kèm reason.
   Trả {ok, key, t, moved, reason?}; key là object key đã (không) di chuyển.
   Không đổi giá trị v, không đổi thứ tự các key khác (chỉ sort lại). */
function edAnimMoveKeyframe(anim, prop, oldT, newT) {
  if (!anim || !Array.isArray(anim.tracks)) {
    return { ok: false, key: null, t: Number(oldT) || 0, reason: 'Animation không hợp lệ.' };
  }
  var tr = edAnimFindTrack(anim, prop);
  if (!tr) {
    return { ok: false, key: null, t: Number(oldT) || 0, reason: 'Không tìm thấy track ' + prop + '.' };
  }
  var idx = -1;
  for (var i = 0; i < tr.keys.length; i++) {
    if (Math.abs(tr.keys[i].t - Number(oldT)) < 1e-6) { idx = i; break; }
  }
  if (idx < 0) {
    return { ok: false, key: null, t: Number(oldT) || 0, reason: 'Không tìm thấy keyframe tại ' + Number(oldT).toFixed(2) + 's.' };
  }
  var key = tr.keys[idx];
  var dur = isFinite(Number(anim.duration)) ? Number(anim.duration) : 0;
  var snapped = edAnimSnapTime(newT, ED_ANIM_DRAG_SNAP);
  snapped = Math.min(dur, Math.max(0, snapped));
  if (Math.abs(snapped - key.t) < 1e-6) {
    return { ok: true, key: key, t: key.t, moved: false };
  }
  var prev = (idx > 0) ? tr.keys[idx - 1] : null;
  var next = (idx < tr.keys.length - 1) ? tr.keys[idx + 1] : null;
  if (next && snapped >= next.t - 1e-6) {
    /* Kéo sang phải qua key kề: dừng ngay trước nó (cách 1 ô lưới). */
    snapped = edAnimSnapTime(next.t - ED_ANIM_DRAG_SNAP, ED_ANIM_DRAG_SNAP);
    if (snapped >= next.t - 1e-6) snapped = Number((next.t - ED_ANIM_DRAG_SNAP).toFixed(2));
    if (snapped <= key.t + 1e-6 || (prev && snapped <= prev.t + 1e-6)) {
      return { ok: false, key: key, t: key.t,
        reason: 'Không còn chỗ trống giữa 2 keyframe kề nhau (lưới 0.05s) — key đứng yên.' };
    }
  } else if (prev && snapped <= prev.t + 1e-6) {
    /* Kéo sang trái qua key kề: dừng ngay sau nó (cách 1 ô lưới). */
    snapped = edAnimSnapTime(prev.t + ED_ANIM_DRAG_SNAP, ED_ANIM_DRAG_SNAP);
    if (snapped <= prev.t + 1e-6) snapped = Number((prev.t + ED_ANIM_DRAG_SNAP).toFixed(2));
    if (snapped >= key.t - 1e-6 || (next && snapped >= next.t - 1e-6)) {
      return { ok: false, key: key, t: key.t,
        reason: 'Không còn chỗ trống giữa 2 keyframe kề nhau (lưới 0.05s) — key đứng yên.' };
    }
  }
  snapped = Math.min(dur, Math.max(0, snapped));
  key.t = snapped;
  tr.keys.sort(function (a, b) { return a.t - b.t; });
  return { ok: true, key: key, t: snapped, moved: true };
}

/* Copy 1 hoặc nhiều keyframe đã chọn (selection: [{prop, t}, ...]).
   Trả clipboard thuần {keys:[{prop, t, v}], baseT, count, sourceAnimId}
   hoặc null nếu không chọn được key nào. baseT = thời gian sớm nhất
   trong số key đã copy — paste giữ nguyên khoảng cách giữa các key. */
function edAnimCopyKeys(anim, selection) {
  if (!anim || !Array.isArray(selection) || !selection.length) return null;
  var keys = [];
  selection.forEach(function (sel) {
    if (!sel || typeof sel.prop !== 'string') return;
    var tr = edAnimFindTrack(anim, sel.prop);
    if (!tr) return;
    for (var i = 0; i < tr.keys.length; i++) {
      if (Math.abs(tr.keys[i].t - Number(sel.t)) < 1e-6) {
        keys.push({ prop: sel.prop, t: tr.keys[i].t, v: tr.keys[i].v });
        break;
      }
    }
  });
  if (!keys.length) return null;
  var baseT = keys[0].t;
  keys.forEach(function (k) { if (k.t < baseT) baseT = k.t; });
  return { keys: keys, baseT: baseT, count: keys.length, sourceAnimId: anim.id || null };
}

/* Paste clipboard (từ edAnimCopyKeys) vào animation tại playhead:
   key đầu tiên (sớm nhất) đặt đúng tại playhead, các key sau giữ nguyên
   khoảng cách so với key đầu; giá trị v giữ nguyên; trùng thời gian với
   key cũ trên cùng track thì ghi đè key cũ (đếm vào overwritten).
   Key paste vượt quá duration thì tự kéo dài duration (như addKey).
   Trả {ok, added:[key...], overwritten, reason?}. */
function edAnimPasteKeys(anim, clipboard, playheadT) {
  if (!anim || !Array.isArray(anim.tracks)) {
    return { ok: false, added: [], overwritten: 0, reason: 'Animation không hợp lệ.' };
  }
  if (!clipboard || !Array.isArray(clipboard.keys) || !clipboard.keys.length) {
    return { ok: false, added: [], overwritten: 0, reason: 'Chưa copy keyframe nào.' };
  }
  var base = isFinite(Number(clipboard.baseT)) ? Number(clipboard.baseT) : clipboard.keys[0].t;
  var t0 = edAnimClampTime(playheadT, anim.duration);
  var added = [], overwritten = 0;
  clipboard.keys.forEach(function (k) {
    if (!k || !edAnimPropBinding(k.prop)) return;
    var tt = t0 + (Number(k.t) - base);
    if (tt < 0) tt = 0;
    var tr = edAnimFindTrack(anim, k.prop);
    if (tr) {
      for (var i = 0; i < tr.keys.length; i++) {
        if (Math.abs(tr.keys[i].t - tt) < 1e-6) { overwritten++; break; }
      }
    }
    var nk = edAnimAddKey(anim, k.prop, tt, k.v);
    if (nk) added.push(nk);
  });
  return { ok: added.length > 0, added: added, overwritten: overwritten };
}

/* Nội suy tuyến tính giá trị của 1 track tại thời gian t. Ngoài khoảng
   key thì giữ giá trị đầu/cuối. Trả null nếu track không có key nào. */
function edAnimSampleTrack(track, t) {
  if (!track || !Array.isArray(track.keys) || !track.keys.length) return null;
  var keys = track.keys;
  var tt = Number(t);
  if (!isFinite(tt)) tt = 0;
  if (tt <= keys[0].t) return keys[0].v;
  var last = keys[keys.length - 1];
  if (tt >= last.t) return last.v;
  for (var i = 0; i < keys.length - 1; i++) {
    var a = keys[i], b = keys[i + 1];
    if (tt >= a.t && tt <= b.t) {
      if (b.t === a.t) return b.v;
      var f = (tt - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * f;
    }
  }
  return last.v;
}

function edAnimSampleAnim(anim, prop, t) {
  return edAnimSampleTrack(edAnimFindTrack(anim, prop), t);
}

function edAnimSetDuration(anim, d) {
  if (!anim) return 0;
  var n = Number(d);
  if (!isFinite(n)) n = 2;
  n = Math.min(60, Math.max(0.5, n));
  anim.duration = n;
  return n;
}

/* Dữ liệu track thuần để build clip (không cần THREE): mỗi track là 1
   NumberKeyframeTrack — tên node = targetId để mixer tìm đúng
   object/bone, property dạng 'position[x]' / 'rotation[y]'. */
function edAnimBuildClipData(anim) {
  var out = { name: '', duration: 0, tracks: [] };
  if (!anim || typeof anim !== 'object') return out;
  out.name = (typeof anim.name === 'string' && anim.name) ? anim.name : 'Anim';
  out.duration = isFinite(Number(anim.duration)) ? Math.max(0.1, Number(anim.duration)) : 0.1;
  var tracks = Array.isArray(anim.tracks) ? anim.tracks : [];
  tracks.forEach(function (tr) {
    if (!tr || !edAnimPropBinding(tr.prop)) return;
    var keys = (Array.isArray(tr.keys) ? tr.keys.slice() : [])
      .filter(function (k) { return k && isFinite(Number(k.t)) && isFinite(Number(k.v)); })
      .sort(function (a, b) { return a.t - b.t; });
    if (!keys.length) return;
    var times = [], values = [];
    keys.forEach(function (k) { times.push(Number(k.t)); values.push(Number(k.v)); });
    out.tracks.push({
      node: String(anim.targetId || ''),
      property: edAnimPropBinding(tr.prop),
      times: times, values: values
    });
  });
  return out;
}

/* Build THREE.AnimationClip THẬT từ animation tự tạo. Cần THREE đã load;
   chưa load thì trả null (không throw). */
function edAnimCreateClip(anim) {
  if (typeof THREE === 'undefined' || !THREE.AnimationClip || !THREE.NumberKeyframeTrack) return null;
  var data = edAnimBuildClipData(anim);
  if (!data.tracks.length) return null;
  var tracks = [];
  for (var i = 0; i < data.tracks.length; i++) {
    var tr = data.tracks[i];
    var times = (typeof Float32Array !== 'undefined') ? new Float32Array(tr.times) : tr.times;
    var values = (typeof Float32Array !== 'undefined') ? new Float32Array(tr.values) : tr.values;
    try {
      tracks.push(new THREE.NumberKeyframeTrack(tr.node + '.' + tr.property, times, values));
    } catch (e) { return null; }
  }
  try {
    return new THREE.AnimationClip(data.name, data.duration, tracks);
  } catch (e) { return null; }
}

/* Delta X/Z của xương Hips giữa 2 thời điểm (để root motion). Clip không
   có track pos.x/pos.z của Hips thì delta = 0 (không có tác dụng). */
function edAnimHipsDelta(anim, t0, t1) {
  var dx = 0, dz = 0;
  if (!anim || anim.targetType !== 'bone') return { dx: 0, dz: 0 };
  var x0 = edAnimSampleAnim(anim, 'pos.x', t0);
  var x1 = edAnimSampleAnim(anim, 'pos.x', t1);
  var z0 = edAnimSampleAnim(anim, 'pos.z', t0);
  var z1 = edAnimSampleAnim(anim, 'pos.z', t1);
  if (x0 !== null && x1 !== null) dx = x1 - x0;
  if (z0 !== null && z1 !== null) dz = z1 - z0;
  return { dx: dx, dz: dz };
}

function edAnimValidateAnim(anim) {
  if (!anim || typeof anim !== 'object') return { ok: false, reason: 'Animation không hợp lệ.' };
  if (!anim.id || typeof anim.id !== 'string') return { ok: false, reason: 'Animation thiếu id.' };
  if (anim.targetType !== 'object' && anim.targetType !== 'bone') return { ok: false, reason: 'targetType phải là "object" hoặc "bone".' };
  if (!anim.targetId || typeof anim.targetId !== 'string') return { ok: false, reason: 'Animation chưa có target (object/xương).' };
  if (!Array.isArray(anim.tracks)) return { ok: false, reason: 'Animation thiếu danh sách track.' };
  return { ok: true };
}

/* ---------------- State machine (thuần) ---------------- */

function edAnimDefaultTransitions() {
  return [
    { from: 'Idle', to: 'Walk', condition: 'moving' },
    { from: 'Walk', to: 'Idle', condition: 'idle' },
    { from: 'Walk', to: 'Run', condition: 'moving' },
    { from: 'Run', to: 'Walk', condition: 'idle' },
    { from: 'Idle', to: 'Attack', condition: 'attacking' },
    { from: 'Attack', to: 'Idle', condition: 'idle' },
    { from: 'Idle', to: 'Death', condition: 'hp<=0' },
    { from: 'Walk', to: 'Death', condition: 'hp<=0' },
    { from: 'Attack', to: 'Death', condition: 'hp<=0' }
  ];
}

function edAnimNewStateMachine(charId) {
  return {
    charId: charId, current: 'Idle',
    states: ED_ANIM_STATES.slice(),
    transitions: edAnimDefaultTransitions(),
    clips: {} /* state -> clipRef: tên clip Mixamo, hoặc 'anim:<animId>' */
  };
}

/* Lấy (hoặc tạo mới với mặc định) state machine của 1 character. */
function edAnimGetMachine(project, charId) {
  var map = edAnimEnsureStateMachines(project);
  if (!charId) return null;
  if (!map[charId] || typeof map[charId] !== 'object') map[charId] = edAnimNewStateMachine(charId);
  var m = map[charId];
  if (!Array.isArray(m.states) || !m.states.length) m.states = ED_ANIM_STATES.slice();
  if (!Array.isArray(m.transitions)) m.transitions = edAnimDefaultTransitions();
  if (!m.clips || typeof m.clips !== 'object') m.clips = {};
  if (m.states.indexOf(m.current) < 0) m.current = m.states[0];
  return m;
}

function edAnimAddState(machine, name) {
  if (!machine || !Array.isArray(machine.states)) return false;
  var n = String(name || '').replace(/^\s+|\s+$/g, '');
  if (!n || n.length > 24) return false;
  if (machine.states.indexOf(n) >= 0) return false;
  if (machine.states.length >= 16) return false;
  machine.states.push(n);
  return true;
}

function edAnimRemoveState(machine, name) {
  if (!machine || !Array.isArray(machine.states)) return false;
  var idx = machine.states.indexOf(name);
  if (idx < 0) return false;
  machine.states.splice(idx, 1);
  machine.transitions = machine.transitions.filter(function (tr) {
    return tr.from !== name && tr.to !== name;
  });
  if (machine.clips) delete machine.clips[name];
  if (machine.current === name) machine.current = machine.states[0] || 'Idle';
  return true;
}

function edAnimAddTransition(machine, from, to, condition) {
  if (!machine || !Array.isArray(machine.states) || !Array.isArray(machine.transitions)) {
    return { ok: false, reason: 'State machine không hợp lệ.' };
  }
  if (machine.states.indexOf(from) < 0 || machine.states.indexOf(to) < 0) {
    return { ok: false, reason: 'State không có trong danh sách.' };
  }
  if (from === to) return { ok: false, reason: 'Transition phải chuyển sang state khác.' };
  if (ED_ANIM_CONDITIONS.indexOf(condition) < 0) {
    return { ok: false, reason: 'Điều kiện không hợp lệ.' };
  }
  for (var i = 0; i < machine.transitions.length; i++) {
    var tr = machine.transitions[i];
    if (tr.from === from && tr.to === to && tr.condition === condition) {
      return { ok: false, reason: 'Transition này đã có rồi.' };
    }
  }
  machine.transitions.push({ from: from, to: to, condition: condition });
  return { ok: true };
}

function edAnimRemoveTransition(machine, index) {
  if (!machine || !Array.isArray(machine.transitions)) return false;
  if (index < 0 || index >= machine.transitions.length) return false;
  machine.transitions.splice(index, 1);
  return true;
}

/* Đánh giá transition: trả state đích đầu tiên khớp điều kiện, hoặc null.
   ctx: {moving, attacking, idle, hp, dead, key} — chỉ cần đúng field của
   điều kiện đang xét. */
function edAnimEvalTransition(machine, currentState, ctx) {
  if (!machine || !Array.isArray(machine.transitions)) return null;
  ctx = ctx || {};
  for (var i = 0; i < machine.transitions.length; i++) {
    var tr = machine.transitions[i];
    if (!tr || tr.from !== currentState) continue;
    var hit = false;
    if (tr.condition === 'moving') hit = !!ctx.moving;
    else if (tr.condition === 'attacking') hit = !!ctx.attacking;
    else if (tr.condition === 'idle') hit = !!ctx.idle;
    else if (tr.condition === 'hp<=0') {
      hit = (typeof ctx.hp === 'number') ? (ctx.hp <= 0) : !!ctx.dead;
    }
    else if (tr.condition === 'key') hit = !!ctx.key;
    if (hit) return tr.to;
  }
  return null;
}

function edAnimSetStateClip(machine, state, clipRef) {
  if (!machine || !Array.isArray(machine.states)) return false;
  if (machine.states.indexOf(state) < 0) return false;
  if (!machine.clips || typeof machine.clips !== 'object') machine.clips = {};
  var ref = String(clipRef || '');
  if (!ref) delete machine.clips[state];
  else machine.clips[state] = ref;
  return true;
}

function edAnimResolveStateClip(machine, state) {
  if (!machine || !machine.clips) return null;
  var ref = machine.clips[state];
  return (typeof ref === 'string' && ref) ? ref : null;
}

/* ---------------- Module ED.Animation ---------------- */

ED.Animation = {
  /* Logic thuần — test được bằng vm + stub THREE. */
  STATES: ED_ANIM_STATES,
  STATE_LABELS: ED_ANIM_STATE_LABELS,
  CONDITIONS: ED_ANIM_CONDITIONS,
  CONDITION_LABELS: ED_ANIM_CONDITION_LABELS,
  clampFade: edAnimClampFade,
  clampSpeed: edAnimClampSpeed,
  clampTime: edAnimClampTime,
  newAnimation: edAnimNewAnimation,
  nextId: edAnimNextId,
  ensureAnimations: edAnimEnsureAnimations,
  ensureStateMachines: edAnimEnsureStateMachines,
  getAnimation: edAnimGetAnimation,
  trackProps: edAnimTrackProps,
  propLabel: edAnimPropLabel,
  propBinding: edAnimPropBinding,
  findTrack: edAnimFindTrack,
  addKey: edAnimAddKey,
  removeKey: edAnimRemoveKey,
  snapTime: edAnimSnapTime,
  dragSnap: ED_ANIM_DRAG_SNAP,
  moveKeyframe: edAnimMoveKeyframe,
  copyKeys: edAnimCopyKeys,
  pasteKeys: edAnimPasteKeys,
  sampleTrack: edAnimSampleTrack,
  sampleAnim: edAnimSampleAnim,
  setDuration: edAnimSetDuration,
  buildClipData: edAnimBuildClipData,
  createClip: edAnimCreateClip,
  hipsDelta: edAnimHipsDelta,
  validateAnim: edAnimValidateAnim,
  newStateMachine: edAnimNewStateMachine,
  getMachine: edAnimGetMachine,
  addState: edAnimAddState,
  removeState: edAnimRemoveState,
  addTransition: edAnimAddTransition,
  removeTransition: edAnimRemoveTransition,
  evalTransition: edAnimEvalTransition,
  setStateClip: edAnimSetStateClip,
  resolveStateClip: edAnimResolveStateClip,

  _localProject: null,
  _panel: null,
  _bodyEl: null,
  _animSelectEl: null,
  _animNameEl: null,
  _targetLabelEl: null,
  _timeLabelEl: null,
  _rulerEl: null,
  _playheadEl: null,
  _tracksEl: null,
  _keyInfoEl: null,
  _clipInfoEl: null,
  _smCharSelectEl: null,
  _smBodyEl: null,
  _playBtn: null,
  _loopBtn: null,
  _fadeLabelEl: null,
  _state: {
    animId: null, time: 0, playing: false, loop: true,
    speed: 1, fadeSec: 0.3, rootMotion: false,
    sceneMixer: null, sceneAction: null, sceneTargetId: null,
    sceneRootName: null, previewOwned: false,
    rootBase: null, rootLastT: null,
    raf: 0, lastTs: 0, scrubbing: false, wasPlaying: false,
    selectedKey: null, /* {prop, t} — key chọn gần nhất (tương thích đợt 2) */
    selectedKeys: [], /* [{prop, t}, ...] — nhiều key chọn bằng Shift-click (đợt 3) */
    clipboard: null, /* {keys:[{prop,t,v}], baseT, count, sourceAnimId} (đợt 3) */
    drag: null, /* {prop, oldT, t, moved, startX, lane, dot} khi đang kéo key (đợt 3) */
    suppressClick: false, /* true khi vừa kéo xong: click sau drag không chọn lại */
    smCharId: null, collapsed: false
  },

  project: function () {
    if (ED.Core && typeof ED.Core.getProject === 'function') {
      var p = null;
      try { p = ED.Core.getProject(); } catch (e) { p = null; }
      if (p && typeof p === 'object') return p;
    }
    if (ED.Core && ED.Core.project && typeof ED.Core.project === 'object') return ED.Core.project;
    if (ED.Character && typeof ED.Character.project === 'function') {
      try { return ED.Character.project(); } catch (e) {}
    }
    if (!this._localProject) {
      this._localProject = { version: 1, name: 'Project mới', terrain: {}, env: {},
        objects: [], npcs: [], quests: [], characters: [], animations: [], stateMachines: {} };
    }
    return this._localProject;
  },

  commit: function (label) {
    try {
      if (ED.Core) {
        if (typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(label || 'Animation');
        if (typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
      }
    } catch (e) {}
  },

  log: function (msg) {
    try { if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log(msg); } catch (e) {}
  },

  toast: function (msg) {
    try { if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg); } catch (e) {}
  },

  listAnimations: function () {
    return edAnimEnsureAnimations(this.project()).slice();
  },

  currentAnim: function () {
    return this._state.animId ? edAnimGetAnimation(this.project(), this._state.animId) : null;
  },

  /* Target hiện tại: ưu tiên animation đang chọn, nếu chưa có thì lấy
     object đang chọn trong scene, nếu không thì xương đang chọn trong
     preview nhân vật. Trả {targetType, targetId, label} hoặc null. */
  detectTarget: function () {
    var anim = this.currentAnim();
    if (anim && anim.targetId) {
      return { targetType: anim.targetType, targetId: anim.targetId,
        label: (anim.targetType === 'bone' ? 'Xương: ' : 'Object: ') + anim.targetId };
    }
    var obj = null;
    try {
      if (ED.Core && typeof ED.Core.selectedObject === 'function') obj = ED.Core.selectedObject();
    } catch (e) { obj = null; }
    if (obj && obj.id) {
      return { targetType: 'object', targetId: obj.id, label: 'Object: ' + (obj.name || obj.id) + ' (' + obj.id + ')' };
    }
    var bone = null;
    try {
      if (ED.Character && typeof ED.Character.getSelectedBone === 'function') bone = ED.Character.getSelectedBone();
    } catch (e) { bone = null; }
    if (bone) return { targetType: 'bone', targetId: bone, label: 'Xương: ' + bone };
    return null;
  },

  /* ---------------- Panel (DOM — chỉ trong init) ---------------- */
  init: function () {
    if (typeof document === 'undefined') return false;
    var host = document.getElementById('tab-timeline');
    if (!host) {
      var bottom = document.getElementById('panel-bottom') || document.body;
      host = document.createElement('div');
      host.id = 'ed-anim-fallback';
      host.className = 'ed-anim-fallback';
      bottom.appendChild(host);
    } else {
      var note = host.querySelector ? host.querySelector('.empty-note') : null;
      if (note && note.remove) note.remove();
    }
    this._panel = host;
    var self = this;
    var S = this._state;

    /* CSS riêng đợt 3 (inject bằng JS — không sửa editor.css): kéo key
       không cuộn trang trên điện thoại, chấm đang kéo nổi bật. */
    if (!document.getElementById('ed-anim-timeline3-style')) {
      var st = document.createElement('style');
      st.id = 'ed-anim-timeline3-style';
      st.textContent = '.ed-anim-lane{touch-action:none}.ed-anim-key{touch-action:none;cursor:grab}' +
        '.ed-anim-key.dragging{cursor:grabbing}.ed-anim-key.dragging .ed-anim-key-dot{background:#f97316;outline:2px solid #fff;transform:scale(1.3)}' +
        '.ed-anim-clipinfo{font-size:12px;color:#a7f3d0;white-space:nowrap}';
      (document.head || host).appendChild(st);
    }
    /* Ctrl+C / Ctrl+V copy-paste keyframe (chỉ khi không đang gõ trong
       input/select/textarea, và đang có animation được chọn). */
    document.addEventListener('keydown', function (e) {
      if (!e || !(e.ctrlKey || e.metaKey)) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!self.currentAnim()) return;
      var k = String(e.key || '').toLowerCase();
      if (k === 'c') { if (self.copySelectedKeys()) { try { e.preventDefault(); } catch (err) {} } }
      else if (k === 'v') { if (self.pasteAtPlayhead()) { try { e.preventDefault(); } catch (err) {} } }
    });

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

    /* Header + thu gọn. */
    var head = el('div', 'ed-anim-head');
    head.appendChild(el('span', 'ed-anim-title', '🎬 Timeline — Animation'));
    var collapseBtn = btn('▾ Thu gọn', function () {
      S.collapsed = !S.collapsed;
      self._bodyEl.style.display = S.collapsed ? 'none' : '';
      collapseBtn.textContent = S.collapsed ? '▸ Mở rộng' : '▾ Thu gọn';
    });
    head.appendChild(collapseBtn);
    host.appendChild(head);

    var body = el('div', 'ed-anim-body');
    host.appendChild(body);
    this._bodyEl = body;

    /* --- Hàng target + chọn/tạo animation --- */
    var targetRow = el('div', 'ed-row ed-anim-row');
    var targetLabel = el('span', 'ed-anim-target', 'Chưa chọn target.');
    targetRow.appendChild(targetLabel);
    this._targetLabelEl = targetLabel;
    targetRow.appendChild(btn('🎯 Lấy target đang chọn', function () { self.refreshTargetLabel(); self.toast('Target: ' + (self.detectTarget() ? self.detectTarget().label : 'chưa chọn object/xương nào')); }));
    body.appendChild(targetRow);

    var animRow = el('div', 'ed-row ed-anim-row');
    var animSel = el('select', 'ed-anim-select');
    animSel.style.minHeight = '40px';
    animSel.style.flex = '1';
    animSel.addEventListener('change', function () {
      self.stop();
      S.animId = animSel.value || null;
      S.time = 0;
      S.selectedKey = null;
      S.selectedKeys = [];
      self.refreshTargetLabel();
      self.renderTracks();
    });
    animRow.appendChild(animSel);
    this._animSelectEl = animSel;
    var nameInp = el('input');
    nameInp.type = 'text';
    nameInp.placeholder = 'Tên animation mới…';
    nameInp.style.minHeight = '40px';
    nameInp.style.flex = '1';
    animRow.appendChild(nameInp);
    this._animNameEl = nameInp;
    animRow.appendChild(btn('＋ Animation mới', function () { self.createAnimation(); }));
    animRow.appendChild(btn('🗑 Xoá', function () { self.deleteAnimation(); }));
    body.appendChild(animRow);

    /* --- Transport: play/pause/stop/loop/speed/fade/thời gian --- */
    var trRow = el('div', 'ed-row ed-anim-row');
    var toStartBtn = btn('⏮', function () { self.scrubTo(0); });
    var playBtn = btn('▶ Phát', function () {
      if (S.playing) self.pause(); else self.play();
    });
    this._playBtn = playBtn;
    var stopBtn = btn('⏹ Dừng', function () { self.stop(); });
    var loopBtn = btn('🔁 Lặp: Bật', function () {
      S.loop = !S.loop;
      loopBtn.textContent = S.loop ? '🔁 Lặp: Bật' : '🔁 Lặp: Tắt';
      if (S.sceneAction) { try { S.sceneAction.setLoop(S.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); } catch (e) {} }
      try { if (ED.Character && typeof ED.Character.setLoop === 'function') ED.Character.setLoop(S.loop); } catch (e) {}
    });
    this._loopBtn = loopBtn;
    trRow.appendChild(toStartBtn);
    trRow.appendChild(playBtn);
    trRow.appendChild(stopBtn);
    trRow.appendChild(loopBtn);
    var speedSel = el('select', 'ed-anim-speed');
    speedSel.style.minHeight = '40px';
    ['0.25', '0.5', '1', '1.5', '2'].forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v + 'x';
      if (v === '1') o.selected = true;
      speedSel.appendChild(o);
    });
    speedSel.addEventListener('change', function () {
      S.speed = edAnimClampSpeed(speedSel.value);
      if (S.sceneMixer) { try { S.sceneMixer.timeScale = S.speed; } catch (e) {} }
      try { if (ED.Character && typeof ED.Character.setSpeed === 'function') ED.Character.setSpeed(S.speed); } catch (e) {}
    });
    trRow.appendChild(speedSel);
    body.appendChild(trRow);

    var fadeRow = el('div', 'ed-row ed-anim-row');
    fadeRow.appendChild(el('label', '', 'Fade chuyển clip:'));
    var fade = el('input');
    fade.type = 'range'; fade.min = '0'; fade.max = '2'; fade.step = '0.1'; fade.value = '0.3';
    fade.style.flex = '1';
    var fadeLabel = el('span', 'ed-anim-fade-label', '0.3s');
    this._fadeLabelEl = fadeLabel;
    fade.addEventListener('input', function () {
      S.fadeSec = edAnimClampFade(fade.value);
      fadeLabel.textContent = S.fadeSec.toFixed(1) + 's';
    });
    fadeRow.appendChild(fade);
    fadeRow.appendChild(fadeLabel);
    var timeLabel = el('span', 'ed-anim-time', '0.0s / 0.0s');
    this._timeLabelEl = timeLabel;
    fadeRow.appendChild(timeLabel);
    body.appendChild(fadeRow);

    /* --- Thước playhead (kéo để scrub) --- */
    var ruler = el('div', 'ed-anim-ruler');
    ruler.title = 'Kéo để tua (scrub) tới thời gian muốn xem';
    var playhead = el('div', 'ed-anim-playhead');
    ruler.appendChild(playhead);
    this._rulerEl = ruler;
    this._playheadEl = playhead;
    ruler.addEventListener('pointerdown', function (e) {
      try { ruler.setPointerCapture(e.pointerId); } catch (err) {}
      S.scrubbing = true;
      S.wasPlaying = S.playing;
      if (S.playing) self.pause();
      self._scrubFromEvent(e);
    });
    ruler.addEventListener('pointermove', function (e) {
      if (S.scrubbing) self._scrubFromEvent(e);
    });
    function endScrub() {
      if (!S.scrubbing) return;
      S.scrubbing = false;
      if (S.wasPlaying) self.resume();
    }
    ruler.addEventListener('pointerup', endScrub);
    ruler.addEventListener('pointercancel', endScrub);
    body.appendChild(ruler);

    /* --- Tracks + keyframe --- */
    var tracksTitle = el('div', 'ed-anim-section-title', 'Track keyframe — bấm “+ Key” để thêm keyframe tại thời gian hiện tại (lấy giá trị hiện tại của object/xương); bấm-giữ 1 chấm rồi kéo ngang để đổi thời gian (lưới 0.05s); Shift-click để chọn nhiều key trên cùng track rồi Copy/Paste.');
    body.appendChild(tracksTitle);
    var tracks = el('div', 'ed-anim-tracks');
    body.appendChild(tracks);
    this._tracksEl = tracks;
    var keyRow = el('div', 'ed-row ed-anim-row');
    var keyInfo = el('span', 'ed-anim-keyinfo', 'Chưa chọn keyframe nào.');
    keyRow.appendChild(keyInfo);
    this._keyInfoEl = keyInfo;
    keyRow.appendChild(btn('📋 Copy', function () { self.copySelectedKeys(); }));
    keyRow.appendChild(btn('📥 Paste tại playhead', function () { self.pasteAtPlayhead(); }));
    var clipInfo = el('span', 'ed-anim-clipinfo', '');
    keyRow.appendChild(clipInfo);
    this._clipInfoEl = clipInfo;
    keyRow.appendChild(btn('🗑 Xoá keyframe đã chọn', function () { self.deleteSelectedKey(); }));
    body.appendChild(keyRow);

    /* --- Thời lượng + root motion --- */
    var durRow = el('div', 'ed-row ed-anim-row');
    durRow.appendChild(el('label', '', 'Thời lượng (giây):'));
    var durInp = el('input');
    durInp.type = 'number'; durInp.min = '0.5'; durInp.max = '60'; durInp.step = '0.5'; durInp.value = '2';
    durInp.style.minHeight = '40px';
    durInp.style.width = '90px';
    durInp.addEventListener('change', function () {
      var anim = self.currentAnim();
      if (!anim) return;
      var d = edAnimSetDuration(anim, durInp.value);
      durInp.value = String(d);
      self.commit('Đổi thời lượng animation');
      self.renderTracks();
    });
    durRow.appendChild(durInp);
    this._durInpEl = durInp;
    durRow.appendChild(btn('↺ Về vị trí gốc', function () { self.resetRootPosition(); }));
    body.appendChild(durRow);

    var rmRow = el('div', 'ed-row ed-anim-row');
    var rmCb = el('input');
    rmCb.type = 'checkbox';
    rmCb.addEventListener('change', function () {
      S.rootMotion = !!rmCb.checked;
      if (!S.rootMotion) {
        var pv = null;
        try { if (ED.Character && typeof ED.Character.getPreview === 'function') pv = ED.Character.getPreview(); } catch (e) {}
        if (pv) pv.onTick = null;
      }
      self.toast(S.rootMotion ? 'Root motion: BẬT — nhân vật di chuyển theo xương Hips khi phát clip.' : 'Root motion: TẮT — nhân vật đứng yên tại chỗ.');
    });
    rmRow.appendChild(rmCb);
    rmRow.appendChild(el('label', '', 'Root motion (di chuyển theo xương Hips)'));
    body.appendChild(rmRow);
    body.appendChild(el('div', 'ed-anim-hint',
      'Giới hạn: root motion chỉ có tác dụng khi clip có track vị trí của xương Hips (pos.x/pos.z). Clip không có track Hips thì nhân vật đứng yên.'));

    /* --- State machine --- */
    body.appendChild(el('div', 'ed-anim-section-title', '🤖 State Machine (theo nhân vật)'));
    var smRow = el('div', 'ed-row ed-anim-row');
    var smSel = el('select', 'ed-anim-sm-char');
    smSel.style.minHeight = '40px';
    smSel.style.flex = '1';
    smSel.addEventListener('change', function () {
      S.smCharId = smSel.value || null;
      self.renderStateMachine();
    });
    smRow.appendChild(smSel);
    this._smCharSelectEl = smSel;
    body.appendChild(smRow);
    var smBody = el('div', 'ed-anim-sm');
    body.appendChild(smBody);
    this._smBodyEl = smBody;

    /* Project load về sau: chọn lại animation nếu id cũ không còn. */
    try {
      if (ED.Core && typeof ED.Core.onChange === 'function') {
        ED.Core.onChange(function () {
          if (self._state.animId && !edAnimGetAnimation(self.project(), self._state.animId)) {
            self._state.animId = null;
          }
          self.refreshAnimSelect();
          self.renderTracks();
          self.refreshSmCharSelect();
          self.renderStateMachine();
        });
      }
    } catch (e) {}

    this.refreshAnimSelect();
    this.refreshTargetLabel();
    this.renderTracks();
    this.refreshSmCharSelect();
    this.renderStateMachine();

    /* Vòng lặp cập nhật playhead + thời gian hiển thị. */
    if (typeof requestAnimationFrame !== 'undefined') {
      var tick = function (ts) {
        if (!self._panel) return;
        self._raf = requestAnimationFrame(tick);
        self._tick(ts);
      };
      this._raf = requestAnimationFrame(tick);
    }
    return true;
  },

  /* ---------------- Render UI ---------------- */

  refreshAnimSelect: function () {
    var sel = this._animSelectEl;
    if (!sel || typeof document === 'undefined') return;
    var cur = this._state.animId;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    var anims = this.listAnimations();
    if (!anims.length) {
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = '— Chưa có animation nào —';
      sel.appendChild(o0);
    }
    anims.forEach(function (a) {
      var o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.name + ' (' + (a.targetType === 'bone' ? 'xương ' : 'object ') + a.targetId + ' · ' + Number(a.duration).toFixed(1) + 's)';
      sel.appendChild(o);
    });
    sel.value = cur || '';
  },

  refreshTargetLabel: function () {
    if (this._targetLabelEl) {
      var t = this.detectTarget();
      this._targetLabelEl.textContent = t ? ('Target: ' + t.label) : 'Chưa chọn target — click 1 object trong scene hoặc 1 xương trong Character Editor.';
    }
    var anim = this.currentAnim();
    if (this._durInpEl) this._durInpEl.value = String(anim ? anim.duration : 2);
  },

  renderTracks: function () {
    var tracksEl = this._tracksEl;
    if (!tracksEl || typeof document === 'undefined') return;
    while (tracksEl.firstChild) tracksEl.removeChild(tracksEl.firstChild);
    var anim = this.currentAnim();
    if (!anim) {
      tracksEl.textContent = 'Chưa chọn animation nào — bấm “＋ Animation mới” để tạo (cần chọn object/xương trước).';
      this._renderKeyInfo();
      return;
    }
    var self = this;
    var S = this._state;
    var props = edAnimTrackProps(anim.targetType);
    props.forEach(function (prop) {
      var row = document.createElement('div');
      row.className = 'ed-anim-track';
      var lab = document.createElement('span');
      lab.className = 'ed-anim-track-label';
      lab.textContent = edAnimPropLabel(prop);
      row.appendChild(lab);
      var lane = document.createElement('div');
      lane.className = 'ed-anim-lane';
      var tr = edAnimFindTrack(anim, prop);
      var keys = tr ? tr.keys : [];
      keys.forEach(function (k) {
        var dot = document.createElement('button');
        var isSel = false;
        (S.selectedKeys || []).forEach(function (sk) {
          if (sk.prop === prop && Math.abs(sk.t - k.t) < 1e-6) isSel = true;
        });
        if (!isSel && S.selectedKey && S.selectedKey.prop === prop &&
          Math.abs(S.selectedKey.t - k.t) < 1e-6) isSel = true;
        dot.className = 'ed-anim-key' + (isSel ? ' selected' : '');
        dot.style.left = (anim.duration > 0 ? (k.t / anim.duration * 100) : 0) + '%';
        dot.title = edAnimPropLabel(prop) + ' @ ' + k.t.toFixed(2) + 's = ' + Number(k.v).toFixed(2) +
          ' — bấm-giữ rồi kéo ngang để đổi thời gian';
        var inner = document.createElement('span');
        inner.className = 'ed-anim-key-dot';
        dot.appendChild(inner);
        /* Kéo keyframe trực tiếp (chuột + chạm, pointer events). */
        dot.addEventListener('pointerdown', function (ev) {
          self._keyDragStart(ev, prop, k.t, lane, dot);
        });
        dot.addEventListener('click', function (ev) {
          if (S.suppressClick) { S.suppressClick = false; return; }
          /* Shift-click: thêm/bỏ key khỏi vùng chọn nhiều key (đợt 3);
             click thường: chỉ chọn key này. */
          if (ev && ev.shiftKey) self._toggleKeySelection(prop, k.t);
          else self._selectKeys([{ prop: prop, t: k.t }]);
          self._renderKeyInfo();
          self.renderTracks();
        });
        lane.appendChild(dot);
      });
      row.appendChild(lane);
      var val = document.createElement('span');
      val.className = 'ed-anim-track-val';
      var sv = edAnimSampleAnim(anim, prop, S.time);
      val.textContent = (sv === null || sv === undefined) ? '—' : Number(sv).toFixed(2);
      row.appendChild(val);
      var addBtn = document.createElement('button');
      addBtn.className = 'ed-btn';
      addBtn.style.minHeight = '40px';
      addBtn.textContent = '+ Key';
      addBtn.addEventListener('click', function () { self.addKeyNow(prop); });
      row.appendChild(addBtn);
      tracksEl.appendChild(row);
    });
    this._renderKeyInfo();
  },

  _renderKeyInfo: function () {
    if (this._keyInfoEl) {
      var S = this._state;
      var anim = this.currentAnim();
      var sel = (S.selectedKeys && S.selectedKeys.length) ? S.selectedKeys
        : (S.selectedKey ? [S.selectedKey] : []);
      if (!anim || !sel.length) {
        this._keyInfoEl.textContent = 'Chưa chọn keyframe nào — bấm 1 chấm trên track để chọn, Shift-click để chọn thêm key trên cùng track.';
      } else if (sel.length > 1) {
        this._keyInfoEl.textContent = 'Đã chọn ' + sel.length + ' keyframe — bấm Copy để copy, Xoá để xoá tất cả.';
      } else {
        var tr = edAnimFindTrack(anim, sel[0].prop);
        var v = null;
        if (tr) {
          for (var i = 0; i < tr.keys.length; i++) {
            if (Math.abs(tr.keys[i].t - sel[0].t) < 1e-6) { v = tr.keys[i].v; break; }
          }
        }
        this._keyInfoEl.textContent = (v === null)
          ? 'Keyframe đã chọn không còn nữa.'
          : ('Keyframe: ' + edAnimPropLabel(sel[0].prop) + ' @ ' + Number(sel[0].t).toFixed(2) + 's = ' + Number(v).toFixed(2));
      }
    }
    if (this._clipInfoEl) {
      var cb = this._state.clipboard;
      this._clipInfoEl.textContent = (cb && cb.count)
        ? ('Đã copy: ' + cb.count + ' keyframe — bấm Paste để dán tại playhead.')
        : '';
    }
  },

  /* Chọn đúng danh sách key (đồng bộ cả selectedKey đợt 2). */
  _selectKeys: function (list) {
    var S = this._state;
    S.selectedKeys = (list || []).slice();
    S.selectedKey = S.selectedKeys.length ? S.selectedKeys[S.selectedKeys.length - 1] : null;
  },

  /* Shift-click: thêm key vào vùng chọn nếu chưa có, bỏ ra nếu đã có. */
  _toggleKeySelection: function (prop, t) {
    var S = this._state;
    var list = (S.selectedKeys || []).slice();
    var found = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].prop === prop && Math.abs(list[i].t - t) < 1e-6) { found = i; break; }
    }
    if (found >= 0) list.splice(found, 1);
    else list.push({ prop: prop, t: t });
    this._selectKeys(list);
  },

  /* ---------------- Đợt 3: kéo keyframe trên lane ---------------- */

  _keyDragStart: function (e, prop, t, lane, dot) {
    var S = this._state;
    if (!e || (typeof e.button === 'number' && e.button !== 0)) return;
    if (S.drag) return; /* đang kéo 1 key khác */
    var anim = this.currentAnim();
    if (!anim) return;
    S.drag = { prop: prop, oldT: t, t: t, moved: false,
      startX: (typeof e.clientX === 'number') ? e.clientX : 0, lane: lane, dot: dot };
    try { if (dot.setPointerCapture) dot.setPointerCapture(e.pointerId); } catch (err) {}
    try { if (e.preventDefault) e.preventDefault(); } catch (err2) {}
    var self = this;
    function onMove(ev) { self._keyDragMove(ev); }
    function onUp(ev) {
      try { dot.removeEventListener('pointermove', onMove); } catch (err) {}
      try { dot.removeEventListener('pointerup', onUp); } catch (err2) {}
      try { dot.removeEventListener('pointercancel', onUp); } catch (err3) {}
      self._keyDragEnd(ev);
    }
    dot.addEventListener('pointermove', onMove);
    dot.addEventListener('pointerup', onUp);
    dot.addEventListener('pointercancel', onUp);
  },

  _keyDragMove: function (e) {
    var S = this._state;
    var drag = S.drag;
    if (!drag || !e) return;
    var anim = this.currentAnim();
    if (!anim || !drag.lane) return;
    var x = (typeof e.clientX === 'number') ? e.clientX : drag.startX;
    if (!drag.moved && Math.abs(x - drag.startX) < 4) return; /* chưa đủ xa: vẫn là click */
    drag.moved = true;
    var rect = null;
    try { rect = drag.lane.getBoundingClientRect(); } catch (err) { return; }
    if (!rect || !rect.width || !anim.duration) return;
    var rawT = (x - rect.left) / rect.width * Number(anim.duration);
    var r = edAnimMoveKeyframe(anim, drag.prop, drag.t, rawT);
    if (r.ok && r.moved) {
      drag.t = r.t;
      S.time = r.t;
      this._selectKeys([{ prop: drag.prop, t: r.t }]);
      if (drag.dot) {
        drag.dot.className = drag.dot.className.replace(/\s*dragging/g, '') + ' dragging selected';
        drag.dot.style.left = (r.t / Number(anim.duration) * 100) + '%';
        drag.dot.title = edAnimPropLabel(drag.prop) + ' @ ' + r.t.toFixed(2) + 's';
      }
      this._renderKeyInfo();
    } else if (!r.ok && r.reason) {
      /* Kéo vào vùng không còn chỗ: giữ nguyên vị trí, báo 1 lần. */
      if (!drag.warned) { drag.warned = true; this.toast(r.reason); }
    }
  },

  _keyDragEnd: function (e) {
    var S = this._state;
    var drag = S.drag;
    S.drag = null;
    if (!drag) return;
    if (!drag.moved) return; /* click thường — click handler lo phần chọn */
    S.suppressClick = true; /* click bắn sau pointerup không được chọn lại */
    var anim = this.currentAnim();
    if (anim && drag.t !== drag.oldT) {
      this.commit('Kéo keyframe ' + drag.prop + ' ' + Number(drag.oldT).toFixed(2) + 's → ' + Number(drag.t).toFixed(2) + 's');
      this._selectKeys([{ prop: drag.prop, t: drag.t }]);
      /* Phát lại preview đúng vị trí mới của key vừa kéo. */
      this.scrubTo(drag.t);
    }
    this.renderTracks();
  },

  /* ---------------- Đợt 3: copy/paste keyframe ---------------- */

  clipboard: function () {
    return this._state.clipboard;
  },

  copySelectedKeys: function () {
    var anim = this.currentAnim();
    if (!anim) { this.toast('Chưa chọn animation nào.'); return false; }
    var S = this._state;
    var sel = (S.selectedKeys && S.selectedKeys.length) ? S.selectedKeys
      : (S.selectedKey ? [S.selectedKey] : []);
    if (!sel.length) { this.toast('Chưa chọn keyframe nào — bấm 1 chấm trên track để chọn (Shift-click để chọn nhiều key).'); return false; }
    var cb = edAnimCopyKeys(anim, sel);
    if (!cb) { this.toast('Không copy được keyframe đã chọn.'); return false; }
    S.clipboard = cb;
    this._renderKeyInfo();
    this.toast('Đã copy ' + cb.count + ' keyframe — di chuyển playhead rồi bấm Paste (hoặc Ctrl+V).');
    return true;
  },

  pasteAtPlayhead: function () {
    var anim = this.currentAnim();
    if (!anim) { this.toast('Chưa chọn animation nào.'); return false; }
    var S = this._state;
    if (!S.clipboard || !S.clipboard.count) { this.toast('Chưa copy keyframe nào — chọn key rồi bấm Copy (hoặc Ctrl+C) trước.'); return false; }
    var r = edAnimPasteKeys(anim, S.clipboard, S.time);
    if (!r.ok) { this.toast(r.reason || 'Không paste được keyframe.'); return false; }
    this.commit('Paste ' + r.added.length + ' keyframe tại ' + Number(S.time).toFixed(2) + 's');
    /* addKey chỉ trả {t, v} (không có prop): lấy lại prop từ clipboard
       theo đúng thứ tự (paste duyệt clipboard.keys theo thứ tự). */
    var sel = [];
    for (var i = 0; i < r.added.length && i < S.clipboard.keys.length; i++) {
      sel.push({ prop: S.clipboard.keys[i].prop, t: r.added[i].t });
    }
    this._selectKeys(sel);
    this.refreshTargetLabel();
    this.renderTracks();
    this.toast('Đã paste ' + r.added.length + ' keyframe tại ' + Number(S.time).toFixed(2) + 's' +
      (r.overwritten ? (' (ghi đè ' + r.overwritten + ' keyframe cũ tại cùng thời gian)') : '') + '.');
    return true;
  },

  refreshSmCharSelect: function () {
    var sel = this._smCharSelectEl;
    if (!sel || typeof document === 'undefined') return;
    var chars = (this.project().characters || []);
    var cur = this._state.smCharId;
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    if (!chars.length) {
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = '— Chưa có nhân vật nào —';
      sel.appendChild(o0);
    }
    chars.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name + ' (Lv' + c.level + ')';
      sel.appendChild(o);
    });
    sel.value = cur || '';
  },

  _clipOptions: function (sel, currentRef) {
    /* Option cho select gán clip của state: '' + clip Mixamo trong preview
       + animation tự tạo ('anim:<id>'). */
    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Chưa gán clip —';
    sel.appendChild(opt0);
    var pv = null;
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') pv = ED.Character.getPreview();
    } catch (e) {}
    var clips = (pv && pv.clips) ? pv.clips : [];
    clips.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.name;
      o.textContent = '🎬 ' + c.name + ' (' + Number(c.duration).toFixed(1) + 's)';
      sel.appendChild(o);
    });
    this.listAnimations().forEach(function (a) {
      var o2 = document.createElement('option');
      o2.value = 'anim:' + a.id;
      o2.textContent = '✏️ ' + a.name + ' (tự tạo)';
      sel.appendChild(o2);
    });
    sel.value = currentRef || '';
  },

  renderStateMachine: function () {
    var body = this._smBodyEl;
    if (!body || typeof document === 'undefined') return;
    while (body.firstChild) body.removeChild(body.firstChild);
    var project = this.project();
    var chars = project.characters || [];
    if (!chars.length) {
      body.textContent = 'Chưa có nhân vật nào — nhập file .fbx trong tab Character Editor trước.';
      return;
    }
    var S = this._state;
    if (!S.smCharId) S.smCharId = chars[0].id;
    var hasChar = false;
    for (var ci = 0; ci < chars.length; ci++) if (chars[ci].id === S.smCharId) { hasChar = true; break; }
    if (!hasChar) S.smCharId = chars[0].id;
    var machine = edAnimGetMachine(project, S.smCharId);
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

    body.appendChild(el('div', 'ed-anim-sm-current',
      'State hiện tại: ' + machine.current + ' (' + (ED_ANIM_STATE_LABELS[machine.current] || machine.current) + ')'));

    var grid = el('div', 'ed-anim-sm-states');
    machine.states.forEach(function (st) {
      var b = btn(ED_ANIM_STATE_LABELS[st] || st, function () { self.setCurrentState(S.smCharId, st); });
      if (st === machine.current) b.className += ' active';
      grid.appendChild(b);
    });
    body.appendChild(grid);

    body.appendChild(el('div', 'ed-anim-section-title', 'Clip cho mỗi state (bấm state ở trên để chuyển + phát clip):'));
    machine.states.forEach(function (st) {
      var row = el('div', 'ed-row ed-anim-row');
      row.appendChild(el('span', 'ed-anim-sm-state-label', (ED_ANIM_STATE_LABELS[st] || st) + ':'));
      var sel = el('select', '');
      sel.style.minHeight = '40px';
      sel.style.flex = '1';
      self._clipOptions(sel, (machine.clips && machine.clips[st]) || '');
      sel.addEventListener('change', function () {
        edAnimSetStateClip(machine, st, sel.value);
        self.commit('Gán clip cho state ' + st);
        self.toast('State "' + st + '" → clip: ' + (sel.value || 'chưa gán') + '.');
      });
      row.appendChild(sel);
      body.appendChild(row);
    });

    body.appendChild(el('div', 'ed-anim-section-title', 'Transition (từ → tới, khi điều kiện đúng):'));
    if (!machine.transitions.length) body.appendChild(el('div', '', 'Chưa có transition nào.'));
    machine.transitions.forEach(function (tr, idx) {
      var tRow = el('div', 'ed-row ed-anim-row');
      tRow.appendChild(el('span', 'ed-anim-sm-trans',
        tr.from + ' → ' + tr.to + ' (khi ' + (ED_ANIM_CONDITION_LABELS[tr.condition] || tr.condition) + ')'));
      tRow.appendChild(btn('✕', function () {
        edAnimRemoveTransition(machine, idx);
        self.commit('Xoá transition');
        self.renderStateMachine();
      }));
      body.appendChild(tRow);
    });

    var addRow = el('div', 'ed-row ed-anim-row');
    function stateSelect() {
      var s = el('select', '');
      s.style.minHeight = '40px';
      machine.states.forEach(function (st) {
        var o = document.createElement('option');
        o.value = st;
        o.textContent = ED_ANIM_STATE_LABELS[st] || st;
        s.appendChild(o);
      });
      return s;
    }
    var fromSel = stateSelect();
    var toSel = stateSelect();
    if (machine.states.length > 1) toSel.value = machine.states[1];
    var condSel = el('select', '');
    condSel.style.minHeight = '40px';
    ED_ANIM_CONDITIONS.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c;
      o.textContent = ED_ANIM_CONDITION_LABELS[c];
      condSel.appendChild(o);
    });
    addRow.appendChild(fromSel);
    addRow.appendChild(el('span', '', '→'));
    addRow.appendChild(toSel);
    addRow.appendChild(condSel);
    addRow.appendChild(btn('＋ Thêm', function () {
      var r = edAnimAddTransition(machine, fromSel.value, toSel.value, condSel.value);
      if (!r.ok) { self.toast(r.reason); return; }
      self.commit('Thêm transition');
      self.renderStateMachine();
    }));
    body.appendChild(addRow);

    body.appendChild(el('div', 'ed-anim-section-title', 'Mô phỏng (thử chuyển state theo điều kiện giả lập):'));
    var simRow = el('div', 'ed-row ed-anim-row');
    simRow.appendChild(btn('🚶 Đang di chuyển', function () { self.applyTransition(S.smCharId, { moving: true }); }));
    simRow.appendChild(btn('⚔️ Đang tấn công', function () { self.applyTransition(S.smCharId, { attacking: true }); }));
    simRow.appendChild(btn('🧍 Đứng yên', function () { self.applyTransition(S.smCharId, { idle: true }); }));
    simRow.appendChild(btn('💀 Hết HP', function () { self.applyTransition(S.smCharId, { hp: 0 }); }));
    simRow.appendChild(btn('⌨️ Bấm phím', function () { self.applyTransition(S.smCharId, { key: true }); }));
    body.appendChild(simRow);
  },

  /* ---------------- CRUD animation / keyframe ---------------- */

  createAnimation: function () {
    var target = this.detectTarget();
    if (!target) {
      this.toast('Chọn 1 object trong scene (click object) hoặc 1 xương trong Character Editor trước.');
      return null;
    }
    var project = this.project();
    var anims = edAnimEnsureAnimations(project);
    var name = '';
    if (this._animNameEl) name = String(this._animNameEl.value || '').replace(/^\s+|\s+$/g, '');
    if (!name) name = 'Animation ' + (anims.length + 1);
    var id = edAnimNextId(project);
    var anim = edAnimNewAnimation(id, name.slice(0, 32), target.targetType, target.targetId);
    anims.push(anim);
    this.commit('Tạo animation ' + name);
    this._state.animId = id;
    this._state.time = 0;
    this._state.selectedKey = null;
    this._state.selectedKeys = [];
    if (this._animNameEl) this._animNameEl.value = '';
    this.refreshAnimSelect();
    this.refreshTargetLabel();
    this.renderTracks();
    this.toast('Đã tạo animation "' + name + '" cho ' + target.label + ' — bấm “+ Key” trên track để thêm keyframe.');
    return anim;
  },

  deleteAnimation: function () {
    var anim = this.currentAnim();
    if (!anim) { this.toast('Chưa chọn animation nào để xoá.'); return false; }
    var anims = edAnimEnsureAnimations(this.project());
    for (var i = 0; i < anims.length; i++) {
      if (anims[i] && anims[i].id === anim.id) { anims.splice(i, 1); break; }
    }
    this.stop();
    this.commit('Xoá animation ' + anim.name);
    this._state.animId = anims.length ? anims[0].id : null;
    this._state.time = 0;
    this._state.selectedKey = null;
    this._state.selectedKeys = [];
    this.refreshAnimSelect();
    this.refreshTargetLabel();
    this.renderTracks();
    this.toast('Đã xoá animation "' + anim.name + '".');
    return true;
  },

  _currentValue: function (prop) {
    var anim = this.currentAnim();
    if (!anim) return null;
    var parts = String(prop || '').split('.');
    if (parts.length !== 2) return null;
    var kind = parts[0]; /* 'pos' | 'rot' | 'scale' */
    var axis = parts[1];
    var idx = { x: 0, y: 1, z: 2 }[axis];
    if (idx === undefined) return null;
    if (anim.targetType === 'bone') {
      /* Xương chỉ có pos/rot (không có scale trong preview). */
      if (kind === 'scale') return null;
      var bt = null;
      try {
        if (ED.Character && typeof ED.Character.getBoneTransform === 'function') {
          bt = ED.Character.getBoneTransform(anim.targetId);
        }
      } catch (e) { bt = null; }
      if (!bt) return null;
      var arr = (kind === 'pos') ? bt.pos : bt.rot;
      return (arr && isFinite(Number(arr[idx]))) ? Number(arr[idx]) : null;
    }
    var mesh = null;
    try {
      if (ED.Viewport && ED.Viewport.meshes) mesh = ED.Viewport.meshes[anim.targetId];
    } catch (e) { mesh = null; }
    if (mesh) {
      var v = (kind === 'pos') ? mesh.position : (kind === 'rot') ? mesh.rotation : mesh.scale;
      return (v && isFinite(Number(v[axis]))) ? Number(v[axis]) : null;
    }
    var obj = null;
    try {
      if (ED.Core && typeof ED.Core.getObject === 'function') obj = ED.Core.getObject(anim.targetId);
    } catch (e) { obj = null; }
    if (obj) {
      var a2 = (kind === 'pos') ? obj.pos : (kind === 'rot') ? obj.rot : obj.scale;
      return (a2 && isFinite(Number(a2[idx]))) ? Number(a2[idx]) : null;
    }
    return null;
  },

  /* Bấm "+ Key" trên 1 track: lấy giá trị hiện tại của object/xương tại
     thời gian playhead rồi thêm keyframe (hàm thuần là addKey ở trên). */
  addKeyNow: function (prop) {
    var anim = this.currentAnim();
    if (!anim) { this.toast('Chưa chọn animation nào.'); return false; }
    var value = this._currentValue(prop);
    if (value === null || value === undefined) {
      this.toast('Không đọc được giá trị hiện tại của ' + anim.targetId + ' — kiểm tra object/xương còn trong scene/preview không.');
      return false;
    }
    var key = edAnimAddKey(anim, prop, this._state.time, value);
    if (!key) { this.toast('Không thêm được keyframe (prop không hợp lệ).'); return false; }
    this._selectKeys([{ prop: prop, t: key.t }]);
    this.commit('Thêm keyframe ' + prop + ' @ ' + key.t.toFixed(2) + 's');
    this.refreshTargetLabel();
    this.renderTracks();
    return true;
  },

  deleteSelectedKey: function () {
    var S = this._state;
    var anim = this.currentAnim();
    var sel = (S.selectedKeys && S.selectedKeys.length) ? S.selectedKeys
      : (S.selectedKey ? [S.selectedKey] : []);
    if (!anim || !sel.length) { this.toast('Chưa chọn keyframe nào để xoá.'); return false; }
    var removed = 0;
    sel.forEach(function (sk) {
      if (edAnimRemoveKey(anim, sk.prop, sk.t)) removed++;
    });
    if (!removed) { this.toast('Không tìm thấy keyframe đó.'); return false; }
    this._selectKeys([]);
    this.commit('Xoá ' + removed + ' keyframe');
    this.renderTracks();
    return true;
  },

  /* ---------------- Phát clip (mixer thật) ---------------- */

  _currentTime: function () {
    var S = this._state;
    if (S.sceneAction && isFinite(Number(S.sceneAction.time))) return Number(S.sceneAction.time);
    var pv = null;
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') pv = ED.Character.getPreview();
    } catch (e) {}
    if (pv && pv.action && isFinite(Number(pv.action.time))) return Number(pv.action.time);
    if (pv && pv.mixer && isFinite(Number(pv.mixer.time))) return Number(pv.mixer.time);
    return S.time || 0;
  },

  _displayDuration: function () {
    var anim = this.currentAnim();
    if (anim && isFinite(Number(anim.duration))) return Number(anim.duration);
    var pv = null;
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') pv = ED.Character.getPreview();
    } catch (e) {}
    if (pv && pv.action && typeof pv.action.getClip === 'function') {
      try {
        var c = pv.action.getClip();
        if (c && isFinite(Number(c.duration))) return Number(c.duration);
      } catch (e) {}
    }
    return 0;
  },

  _updateTimeDisplay: function () {
    var dur = this._displayDuration();
    var t = this._currentTime();
    if (dur > 0) t = Math.min(dur, Math.max(0, t));
    this._state.time = t;
    if (this._timeLabelEl) {
      this._timeLabelEl.textContent = t.toFixed(1) + 's / ' + dur.toFixed(1) + 's';
    }
    if (this._playheadEl) {
      this._playheadEl.style.left = (dur > 0 ? (t / dur * 100) : 0) + '%';
    }
  },

  _updatePlayBtn: function () {
    if (this._playBtn) this._playBtn.textContent = this._state.playing ? '⏸ Tạm dừng' : '▶ Phát';
  },

  _tick: function (ts) {
    var S = this._state;
    var dt = 0.016;
    if (S.lastTs) dt = Math.min(0.1, (ts - S.lastTs) / 1000 || 0.016);
    S.lastTs = ts;
    /* Preview do tick của ED.Character lái mixer; module này chỉ lái
       mixer riêng của object trong scene. */
    if (S.playing && S.sceneMixer) {
      try { S.sceneMixer.update(dt); } catch (e) { S.sceneMixer = null; }
    }
    this._updateTimeDisplay();
    var anim = this.currentAnim();
    if (S.playing && !S.loop && anim) {
      if (this._currentTime() >= Number(anim.duration) - 0.05) this.stop();
    }
  },

  play: function () {
    var anim = this.currentAnim();
    if (!anim) {
      this.toast('Chưa chọn animation nào — bấm “＋ Animation mới” trước.');
      return false;
    }
    var v = edAnimValidateAnim(anim);
    if (!v.ok) { this.toast(v.reason); return false; }
    if (anim.targetType === 'bone') return this._playPreview(anim);
    return this._playScene(anim);
  },

  _playPreview: function (anim) {
    var S = this._state;
    var pv = null;
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') pv = ED.Character.getPreview();
    } catch (e) { pv = null; }
    if (!pv || !pv.group) {
      this.toast('Chưa có nhân vật trong preview — sang tab Character Editor, nhập file .fbx rồi chọn nhân vật trước.');
      return false;
    }
    if (typeof THREE === 'undefined' || !THREE.AnimationMixer) {
      this.toast('Chưa tải được THREE, thử tải lại trang.');
      return false;
    }
    if (!pv.mixer) {
      /* File FBX không có clip Mixamo thì preview chưa tạo mixer — tạo
         mixer cho clip tự tạo (không đụng clip gốc). */
      try { pv.mixer = new THREE.AnimationMixer(pv.group); } catch (e) { pv.mixer = null; }
      if (!pv.mixer) { this.toast('Không tạo được mixer cho preview.'); return false; }
    }
    var clip = edAnimCreateClip(anim);
    if (!clip) {
      this.toast('Animation chưa có keyframe nào — bấm “+ Key” trên track để thêm.');
      return false;
    }
    this._stopPlayback();
    var ok = false;
    try {
      ok = ED.Character.playCustomClip(clip, { fadeSec: S.fadeSec, speed: S.speed, loop: S.loop });
    } catch (e) { ok = false; }
    if (!ok) { this.toast('Không phát được clip trong preview.'); return false; }
    S.playing = true;
    S.previewOwned = true;
    S.time = 0;
    if (S.rootMotion && anim.targetId.indexOf('Hips') >= 0) {
      S.rootBase = { x: pv.group.position.x, z: pv.group.position.z };
      S.rootLastT = (pv.action && isFinite(Number(pv.action.time))) ? Number(pv.action.time) : 0;
      var self = this;
      pv.onTick = function () { self._rootMotionTick(); };
    } else if (pv) {
      pv.onTick = null;
    }
    this._updatePlayBtn();
    return true;
  },

  _playScene: function (anim) {
    var S = this._state;
    if (typeof THREE === 'undefined' || !THREE.AnimationMixer) {
      this.toast('Chưa tải được THREE, thử tải lại trang.');
      return false;
    }
    var mesh = null;
    try {
      if (ED.Viewport && ED.Viewport.meshes) mesh = ED.Viewport.meshes[anim.targetId];
    } catch (e) { mesh = null; }
    if (!mesh) {
      this.toast('Object "' + anim.targetId + '" chưa có trong scene (có thể đã bị xoá).');
      return false;
    }
    var clip = edAnimCreateClip(anim);
    if (!clip) {
      this.toast('Animation chưa có keyframe nào — bấm “+ Key” trên track để thêm.');
      return false;
    }
    /* Cùng object + đang phát: dùng lại mixer để crossfade được. */
    if (S.sceneMixer && S.sceneTargetId === anim.targetId && S.sceneAction) {
      try {
        var prev = S.sceneAction;
        var next = S.sceneMixer.clipAction(clip);
        next.setLoop(S.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        next.reset();
        S.sceneMixer.timeScale = S.speed;
        if (S.fadeSec > 0) { next.play(); prev.crossFadeTo(next, S.fadeSec); }
        else { prev.stop(); next.play(); }
        S.sceneAction = next;
        S.playing = true;
        S.previewOwned = false;
        S.time = 0;
        this._updatePlayBtn();
        return true;
      } catch (e) { /* rơi xuống tạo mixer mới bên dưới */ }
    }
    this._stopPlayback();
    S.sceneRootName = mesh.name;
    mesh.name = anim.targetId; /* tên node = targetId để mixer tìm đúng object */
    var mixer = null;
    try { mixer = new THREE.AnimationMixer(mesh); } catch (e) { mixer = null; }
    if (!mixer) {
      try { mesh.name = S.sceneRootName; } catch (e2) {}
      this.toast('Không tạo được mixer cho object.');
      return false;
    }
    var action = null;
    try {
      action = mixer.clipAction(clip);
      action.setLoop(S.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      mixer.timeScale = S.speed;
      action.play();
    } catch (e) {
      try { mesh.name = S.sceneRootName; } catch (e2) {}
      this.toast('Không phát được clip trên object (' + (e && e.message ? e.message : 'lỗi mixer') + ').');
      return false;
    }
    S.sceneMixer = mixer;
    S.sceneAction = action;
    S.sceneTargetId = anim.targetId;
    S.playing = true;
    S.previewOwned = false;
    S.time = 0;
    this._updatePlayBtn();
    return true;
  },

  pause: function () {
    var S = this._state;
    S.playing = false;
    try { if (ED.Character && typeof ED.Character.pauseClip === 'function') ED.Character.pauseClip(); } catch (e) {}
    if (S.sceneAction) { try { S.sceneAction.paused = true; } catch (e) {} }
    this._updatePlayBtn();
  },

  resume: function () {
    var S = this._state;
    var pv = null;
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') pv = ED.Character.getPreview();
    } catch (e) {}
    if (!S.sceneAction && !(pv && pv.action)) return false;
    S.playing = true;
    try { if (ED.Character && typeof ED.Character.resumeClip === 'function') ED.Character.resumeClip(); } catch (e) {}
    if (S.sceneAction) { try { S.sceneAction.paused = false; } catch (e) {} }
    this._updatePlayBtn();
    return true;
  },

  _stopPlayback: function () {
    var S = this._state;
    S.playing = false;
    if (S.sceneMixer) {
      try { S.sceneMixer.stopAllAction(); } catch (e) {}
      var mesh = null;
      try {
        if (ED.Viewport && ED.Viewport.meshes) mesh = ED.Viewport.meshes[S.sceneTargetId];
      } catch (e) { mesh = null; }
      if (mesh) {
        if (S.sceneRootName !== null && S.sceneRootName !== undefined) {
          try { mesh.name = S.sceneRootName; } catch (e) {}
        }
        /* Trả object về đúng tư thế trong project (clip chỉ đổi mesh). */
        try {
          if (ED.Core && typeof ED.Core.getObject === 'function' &&
              ED.Viewport && typeof ED.Viewport.syncObject === 'function') {
            var obj = ED.Core.getObject(S.sceneTargetId);
            if (obj) ED.Viewport.syncObject(obj);
          }
        } catch (e) {}
      }
      S.sceneMixer = null;
      S.sceneAction = null;
      S.sceneTargetId = null;
      S.sceneRootName = null;
    }
    try {
      if (ED.Character && typeof ED.Character.stopClip === 'function') ED.Character.stopClip();
      if (ED.Character && typeof ED.Character.getPreview === 'function') {
        var pv = ED.Character.getPreview();
        if (pv) pv.onTick = null;
      }
    } catch (e) {}
    this._restoreRootPosition();
    S.previewOwned = false;
    this._updatePlayBtn();
  },

  stop: function () {
    this._stopPlayback();
    this._state.time = 0;
    this._updateTimeDisplay();
    this.renderTracks();
  },

  /* ---------------- Scrub ---------------- */

  _scrubFromEvent: function (e) {
    var anim = this.currentAnim();
    if (!anim || !this._rulerEl) return;
    var rect = null;
    try { rect = this._rulerEl.getBoundingClientRect(); } catch (err) { return; }
    if (!rect || !rect.width) return;
    var x = 0;
    if (e.touches && e.touches[0]) x = e.touches[0].clientX;
    else if (typeof e.clientX === 'number') x = e.clientX;
    var t = (x - rect.left) / rect.width * Number(anim.duration);
    this.scrubTo(t);
  },

  scrubTo: function (t) {
    var S = this._state;
    var anim = this.currentAnim();
    if (!anim) return false;
    t = edAnimClampTime(t, anim.duration);
    S.time = t;
    var pv = null;
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') pv = ED.Character.getPreview();
    } catch (e) {}
    if (pv && pv.mixer) {
      try {
        pv.mixer.time = t;
        pv.mixer.update(0);
      } catch (e) {}
      S.rootLastT = t; /* tua thì đặt lại mốc root motion, không nhảy vị trí */
    }
    if (S.sceneMixer) {
      try {
        S.sceneMixer.time = t;
        S.sceneMixer.update(0);
      } catch (e) {}
    }
    this._updateTimeDisplay();
    this.renderTracks();
    return true;
  },

  /* ---------------- Root motion ---------------- */

  /* Chạy sau mỗi mixer.update của preview (qua pv.onTick của 07).
     Di chuyển group theo delta X/Z của xương Hips, xoay theo góc preview. */
  _rootMotionTick: function () {
    var S = this._state;
    if (!S.rootMotion) return;
    var pv = null;
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') pv = ED.Character.getPreview();
    } catch (e) {}
    if (!pv || !pv.group || !pv.mixer) return;
    var anim = this.currentAnim();
    if (!anim || anim.targetType !== 'bone' || anim.targetId.indexOf('Hips') < 0) return;
    var t = (pv.action && isFinite(Number(pv.action.time))) ? Number(pv.action.time) : Number(pv.mixer.time);
    if (!isFinite(t)) return;
    if (S.rootLastT === null || S.rootLastT === undefined) { S.rootLastT = t; return; }
    if (t < S.rootLastT) { S.rootLastT = t; return; } /* clip lặp lại: đặt lại mốc */
    var d = edAnimHipsDelta(anim, S.rootLastT, t);
    var a = pv.angle || 0;
    var c = Math.cos(a), s = Math.sin(a);
    pv.group.position.x += d.dx * c + d.dz * s;
    pv.group.position.z += -d.dx * s + d.dz * c;
    S.rootLastT = t;
  },

  _restoreRootPosition: function () {
    var S = this._state;
    if (!S.rootBase) return;
    var pv = null;
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') pv = ED.Character.getPreview();
    } catch (e) {}
    if (pv && pv.group) {
      pv.group.position.x = S.rootBase.x;
      pv.group.position.z = S.rootBase.z;
    }
  },

  resetRootPosition: function () {
    this._restoreRootPosition();
    this.toast('Đã đưa nhân vật về vị trí lúc bắt đầu phát clip.');
  },

  /* ---------------- State machine (runtime) ---------------- */

  getCurrentState: function (charId) {
    var m = edAnimGetMachine(this.project(), charId);
    return m ? m.current : null;
  },

  setCurrentState: function (charId, state) {
    var m = edAnimGetMachine(this.project(), charId);
    if (!m || m.states.indexOf(state) < 0) return false;
    m.current = state;
    this.commit('Đổi state ' + state);
    this.playStateClip(charId, state);
    this.renderStateMachine();
    return true;
  },

  /* Phát clip đã gán cho state trong preview. Clip Mixamo: phát bằng tên;
     clip tự tạo: 'anim:<id>' -> phát qua _playPreview. */
  playStateClip: function (charId, state) {
    var m = edAnimGetMachine(this.project(), charId);
    if (!m) return false;
    var ref = edAnimResolveStateClip(m, state);
    if (!ref) {
      this.toast('State "' + state + '" chưa gán clip nào — chọn clip trong danh sách bên dưới.');
      return false;
    }
    if (ref.indexOf('anim:') === 0) {
      var anim = edAnimGetAnimation(this.project(), ref.slice(5));
      if (!anim) { this.toast('Animation đã gán cho state "' + state + '" không còn nữa.'); return false; }
      this._state.animId = anim.id;
      this.refreshAnimSelect();
      this.renderTracks();
      return this.play();
    }
    var ok = false;
    try {
      if (ED.Character && typeof ED.Character.playClip === 'function') {
        ok = ED.Character.playClip(ref, { fadeSec: this._state.fadeSec });
      }
    } catch (e) { ok = false; }
    if (ok) {
      this._state.playing = true;
      this._state.previewOwned = false;
      this._updatePlayBtn();
    } else {
      this.toast('Không phát được clip "' + ref + '" — mở nhân vật trong Character Editor trước.');
    }
    return ok;
  },

  /* Đánh giá + áp dụng transition theo điều kiện giả lập (dùng cho nút
     "Mô phỏng" và cho Play Mode gọi mỗi frame). Trả {from, to} hoặc null. */
  applyTransition: function (charId, ctx) {
    var m = edAnimGetMachine(this.project(), charId);
    if (!m) return null;
    var from = m.current;
    var to = edAnimEvalTransition(m, from, ctx || {});
    if (!to) {
      this.toast('Không có transition nào khớp điều kiện từ state "' + from + '".');
      return null;
    }
    m.current = to;
    this.commit('Chuyển state ' + from + ' → ' + to);
    this.playStateClip(charId, to);
    this.renderStateMachine();
    this.toast(from + ' → ' + to + ' (' + (ED_ANIM_STATE_LABELS[to] || to) + ')');
    return { from: from, to: to };
  },

  getStateClip: function (charId, state) {
    var m = edAnimGetMachine(this.project(), charId);
    return m ? edAnimResolveStateClip(m, state) : null;
  },

  /* ---------------- API public cho Play Mode (09-play.js) ----------------
     - playAnimOnObject(animId, objectId): phát animation tự tạo trên object
       trong scene (vd hero). Trả true/false.
     - playAnimInPreview(animId): phát animation tự tạo (xương) trong preview.
     - applyTransition(charId, ctx): chuyển state theo điều kiện thật
       (ctx {moving, attacking, idle, hp, key}) + phát clip tương ứng.
     - getCurrentState(charId) / getStateClip(charId, state).
     - stopAll(): dừng mọi phát clip của module. */

  playAnimOnObject: function (animId, objectId) {
    var anim = edAnimGetAnimation(this.project(), animId);
    if (!anim || anim.targetType !== 'object' || anim.targetId !== objectId) return false;
    this._state.animId = animId;
    this.refreshAnimSelect();
    this.renderTracks();
    return this._playScene(anim);
  },

  playAnimInPreview: function (animId) {
    var anim = edAnimGetAnimation(this.project(), animId);
    if (!anim || anim.targetType !== 'bone') return false;
    this._state.animId = animId;
    this.refreshAnimSelect();
    this.renderTracks();
    return this._playPreview(anim);
  },

  stopAll: function () {
    this.stop();
  }
};
