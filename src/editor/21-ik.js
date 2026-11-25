/* ============================== 21-ik.js ==============================
   ED.Ik — IK toàn thân bằng CCD (Cyclic Coordinate Descent), Map Editor đợt 7.
   - Bộ giải CCD THUẦN (không DOM/THREE): solveCCD / ccdStep / vec3 / quat /
     forwardKinematics — test được bằng vm như các module khác.
   - GIỮ NGUYÊN IK 2 xương đợt 3 trong 07-character.js (solveTwoBoneIK /
     applyIk): CCD ở đây dùng cho CHUỖI DÀI (tay 3 khớp, chân 3 khớp, cột
     sống 6 khớp, chuỗi tuỳ ý). IK 2 xương vẫn là lựa chọn đúng cho chi
     ngắn (nhanh, có pole vector); CCD không thay thế nó.
   - Tích hợp preview của ED.Character qua guard typeof (getPreview(),
     findIkChainInList(), getBoneConstraint/clampRotationDeg,
     _clampBoneRotation): nếu API nào chưa có thì tính năng preview liên
     quan toast rõ lý do, còn hàm thuần vẫn chạy bình thường.
   - UI tự tạo trong init(), gắn vào panel Character (cùng host mà
     ED.Character.init dùng) — nếu chưa có host thì rơi về #panel-bottom
     rồi document.body. Tiếng Việt, nút >= 40px, phone-first.

   QUY ƯỚC KHÔNG GIAN (ghi rõ — solver làm việc HOÀN TOÀN trong world):
   - chain[i].pos = vị trí WORLD của khớp i (trong preview: vị trí world
     sau updateMatrixWorld, đã gồm cả rotation.y của group).
   - chain[i].rot = góc Euler XYZ (ĐỘ) của khớp i trong WORLD (world
     orientation), KHÔNG phải góc local của THREE.Bone. Lý do: CCD xoay
     trong world; việc đổi world -> local để gán lên bone do
     applyToPreview() làm (localQ = parentWorldQ^-1 * worldQ).
   - Đầu cuối (end-effector) = pos của khớp CUỐI trong chain. CCD xoay
     các khớp 0..n-2 (khớp cuối chỉ đổi hướng, không đổi vị trí đầu cuối).
   - opts.constraints {jointIndex: {min:[x,y,z], max:[x,y,z]}} (độ) là
     kẹp trên Euler WORLD, áp CUỐI sau khi giải xong (giống đợt 3 kẹp
     sau IK) rồi tính lại finalError bằng FK thuần — sai số báo cáo là
     sai số THẬT sau kẹp, không phải sai số trước kẹp.
   - Preview: constraint xoay của đợt 3 (LOCAL, delta so với tư thế gốc)
     KHÔNG đưa vào solver (sai hệ quy chiếu) mà áp sau khi gán quaternion
     lên bone, qua ED.Character._clampBoneRotation() nếu có — đúng pattern
     applyIk đợt 3.

   GIỚI HẠN (nói thật):
   - KHÔNG có pole vector: hướng khuỷu/gối/cột sống sau CCD phụ thuộc tư
     thế ban đầu (CCD xoay theo đường ngắn nhất tới target). Muốn khuỷu
     bẻ về 1 hướng cố định thì dùng IK 2 xương đợt 3 (có pole).
   - CCD xoay khớp tự do 3 trục (không giới hạn 1 trục như khuỷu thật)
     trừ khi truyền opts.constraints; trong preview thì constraint đợt 3
     kẹp lại sau khi gán (có thể làm đầu cuối lệch khỏi target — sai số
     đo lại sau kẹp sẽ hiện trong panel).
   - Cột sống gồm cả Hips: kéo target cột sống có thể xoay cả hông.
   - Pose IK chỉ sống trong preview (không lưu vào project, không áp lên
     object trong scene chính) — giống IK 2 xương đợt 3.
   - Kéo quả cầu target cần preview đã có model; chưa có model thì các
     nút toast rõ, không vẽ quả cầu giả.
   - Chưa render thử trên trình duyệt/điện thoại thật (chỉ test vm).
   QUY TẮC DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo DOM/THREE trong init() / hàm runtime có guard. */

var ED = (typeof ED !== 'undefined' && ED) ? ED : {};

/* ---------------- Logic thuần: vec3 (không THREE) ---------------- */

function edIkV3(x, y, z) { return [Number(x) || 0, Number(y) || 0, Number(z) || 0]; }
function edIkV3Clone(a) { return [a[0], a[1], a[2]]; }
function edIkV3Add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function edIkV3Sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function edIkV3Scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function edIkV3Dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function edIkV3Cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function edIkV3Len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function edIkV3Dist(a, b) { return edIkV3Len(edIkV3Sub(a, b)); }
function edIkV3Norm(a) {
  var l = edIkV3Len(a);
  return l > 1e-9 ? edIkV3Scale(a, 1 / l) : [0, 0, 0];
}

function edIkDegToRad(d) { return Number(d) * Math.PI / 180; }
function edIkRadToDeg(r) { return Number(r) * 180 / Math.PI; }
function _edIkClamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ---------------- Logic thuần: quaternion [x, y, z, w] ----------------
   Dùng để theo dõi hướng WORLD của từng khớp trong lúc CCD xoay. Quy ước
   Euler 'XYZ' giống THREE.Euler mặc định: q = qx * qy * qz. */

function edIkQuatIdentity() { return [0, 0, 0, 1]; }
function edIkQuatNorm(q) {
  var l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (l < 1e-12) return [0, 0, 0, 1];
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
function edIkQuatConjugate(q) { return [-q[0], -q[1], -q[2], q[3]]; }
/* Tích Hamilton a*b (áp b trước, rồi a) — cùng thứ tự với THREE. */
function edIkQuatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
function edIkQuatFromAxisAngle(axis, angleRad) {
  var a = edIkV3Norm(axis);
  var h = Number(angleRad) / 2;
  var s = Math.sin(h);
  return edIkQuatNorm([a[0] * s, a[1] * s, a[2] * s, Math.cos(h)]);
}
/* Xoay vector v bằng quaternion q (đã chuẩn hoá): v' = v + s*t + u×t
   với t = 2*(u×v), u = [x,y,z], s = w. */
function edIkQuatRotateVec(q, v) {
  var u = [q[0], q[1], q[2]];
  var s = q[3];
  var t = edIkV3Scale(edIkV3Cross(u, v), 2);
  var out = edIkV3Add(v, edIkV3Scale(t, s));
  return edIkV3Add(out, edIkV3Cross(u, t));
}
/* Euler XYZ (độ) -> quaternion. q = qx * qy * qz (khớp THREE r128). */
function edIkEulerDegToQuat(eulerDeg) {
  var e = eulerDeg || [0, 0, 0];
  var qx = edIkQuatFromAxisAngle([1, 0, 0], edIkDegToRad(e[0]));
  var qy = edIkQuatFromAxisAngle([0, 1, 0], edIkDegToRad(e[1]));
  var qz = edIkQuatFromAxisAngle([0, 0, 1], edIkDegToRad(e[2]));
  return edIkQuatNorm(edIkQuatMul(edIkQuatMul(qx, qy), qz));
}
/* Quaternion -> Euler XYZ (độ). R = Rx*Ry*Rz nên:
   sy = R[0][2], x = atan2(-R[1][2], R[2][2]), z = atan2(-R[0][1], R[0][0]).
   Gimbal lock (|sy| ~ 1): đặt x = 0, z suy từ R[1][0], R[2][0]. */
function edIkQuatToEulerDeg(q) {
  var nq = edIkQuatNorm(q);
  var x = nq[0], y = nq[1], z = nq[2], w = nq[3];
  var r02 = 2 * (x * z + y * w);
  var r12 = 2 * (y * z - x * w);
  var r22 = 1 - 2 * (x * x + y * y);
  var r01 = 2 * (x * y - z * w);
  var r00 = 1 - 2 * (y * y + z * z);
  var r10 = 2 * (x * y + z * w);
  var r20 = 2 * (x * z - y * w);
  var sy = _edIkClamp(r02, -1, 1);
  var ex, ey, ez;
  if (Math.abs(sy) > 0.999999) {
    /* Gimbal lock: x = 0, còn z (+x) hoặc z (-x) theo dấu sy. */
    ey = (sy > 0 ? Math.PI / 2 : -Math.PI / 2);
    ex = 0;
    ez = (sy > 0) ? Math.atan2(r10, -r20) : Math.atan2(r10, r20);
  } else {
    ex = Math.atan2(-r12, r22);
    ey = Math.asin(sy);
    ez = Math.atan2(-r01, r00);
  }
  return [edIkRadToDeg(ex), edIkRadToDeg(ey), edIkRadToDeg(ez)];
}

/* ---------------- Logic thuần: chuẩn hoá chain / constraint ---------------- */

function _edIkStripPrefix(name) { return String(name || '').replace(/^mixamorig:/i, ''); }

function _edIkNormJoint(j) {
  if (!j || !Array.isArray(j.pos)) return null;
  return {
    pos: edIkV3(j.pos[0], j.pos[1], j.pos[2]),
    rot: Array.isArray(j.rot)
      ? [Number(j.rot[0]) || 0, Number(j.rot[1]) || 0, Number(j.rot[2]) || 0]
      : [0, 0, 0]
  };
}

function _edIkNormChain(chain) {
  if (!Array.isArray(chain)) return null;
  var out = [];
  for (var i = 0; i < chain.length; i++) {
    var j = _edIkNormJoint(chain[i]);
    if (!j) return null;
    out.push(j);
  }
  return out;
}

function _edIkNormTarget(t) {
  if (!t || !isFinite(Number(t[0])) || !isFinite(Number(t[1])) || !isFinite(Number(t[2]))) return null;
  return [Number(t[0]), Number(t[1]), Number(t[2])];
}

/* Chuẩn hoá 1 constraint {min:[x,y,z], max:[x,y,z]} (độ): thiếu -> ±180,
   min > max -> đổi chỗ. Cùng ngữ nghĩa edCharNormalizeBoneConstraint. */
function edIkNormalizeConstraint(c) {
  var d = { min: [-180, -180, -180], max: [180, 180, 180] };
  if (!c || typeof c !== 'object') return d;
  for (var i = 0; i < 3; i++) {
    var lo = Number(c.min && c.min[i]), hi = Number(c.max && c.max[i]);
    if (!isFinite(lo)) lo = -180;
    if (!isFinite(hi)) hi = 180;
    lo = _edIkClamp(lo, -180, 180);
    hi = _edIkClamp(hi, -180, 180);
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    d.min[i] = lo;
    d.max[i] = hi;
  }
  return d;
}

/* ---------------- Logic thuần: CCD ----------------
   ccdStep: 1 vòng lặp CCD — duyệt khớp từ cuối (n-2) về gốc (0). Mỗi khớp
   xoay sao cho vector khớp->đầu cuối gần vector khớp->target nhất:
   trục = norm(cross(cur, des)), góc = acos(clamp(dot(norm(cur),
   norm(des)))). Xoay vị trí các khớp con quanh vị trí khớp đang xét,
   đồng thời xoay hướng world của khớp đó + các khớp con (quaternion).
   Trả chain MỚI (không sửa chain vào). */

function edIkCcdStep(chain, target) {
  var work0 = _edIkNormChain(chain);
  var tgt = _edIkNormTarget(target);
  if (!work0 || !tgt || work0.length < 2) {
    return work0 ? work0.map(function (j) { return { pos: j.pos.slice(), rot: j.rot.slice() }; }) : [];
  }
  var n = work0.length;
  var work = work0.map(function (j) {
    return { pos: j.pos.slice(), q: edIkEulerDegToQuat(j.rot) };
  });
  var endIdx = n - 1;
  for (var j = n - 2; j >= 0; j--) {
    var pj = work[j].pos;
    var cur = edIkV3Sub(work[endIdx].pos, pj);
    var lc = edIkV3Len(cur);
    if (lc < 1e-9) continue; /* khớp trùng đầu cuối: không có hướng để xoay */
    var des = edIkV3Sub(tgt, pj);
    var ld = edIkV3Len(des);
    if (ld < 1e-9) continue; /* target trùng khớp: khớp này không giúp được */
    var curN = edIkV3Scale(cur, 1 / lc);
    var desN = edIkV3Scale(des, 1 / ld);
    var cosA = _edIkClamp(edIkV3Dot(curN, desN), -1, 1);
    var axis = edIkV3Cross(curN, desN);
    var la = edIkV3Len(axis);
    var angle;
    if (la < 1e-9) {
      if (cosA > 0) continue; /* đã thẳng hàng: không cần xoay */
      /* Ngược hướng 180°: tích chéo ~ 0, chọn trục vuông góc bất kỳ. */
      axis = Math.abs(curN[0]) < 0.9 ? edIkV3Cross(curN, [1, 0, 0]) : edIkV3Cross(curN, [0, 1, 0]);
      axis = edIkV3Norm(axis);
      angle = Math.PI;
    } else {
      axis = edIkV3Scale(axis, 1 / la);
      angle = Math.acos(cosA);
    }
    if (!(angle > 1e-9)) continue;
    var dq = edIkQuatFromAxisAngle(axis, angle);
    for (var k = j + 1; k < n; k++) {
      var rel = edIkV3Sub(work[k].pos, pj);
      work[k].pos = edIkV3Add(pj, edIkQuatRotateVec(dq, rel));
    }
    for (var k2 = j; k2 < n; k2++) {
      work[k2].q = edIkQuatNorm(edIkQuatMul(dq, work[k2].q));
    }
  }
  return work.map(function (w) {
    return { pos: w.pos, rot: edIkQuatToEulerDeg(w.q) };
  });
}

/* Forward kinematics thuần: từ chain gốc + góc world mới, tính lại vị trí
   các khớp. Đoạn xương i->i+1 gắn cứng vào khung của khớp i nên hướng của
   nó xoay đúng bằng delta hướng world của khớp i (qMoi * qCu^-1). */
function edIkForwardKinematics(chain, rotations) {
  var base = _edIkNormChain(chain);
  if (!base || !base.length) return [];
  var pos = [base[0].pos.slice()];
  for (var i = 0; i < base.length - 1; i++) {
    var d = edIkV3Sub(base[i + 1].pos, base[i].pos);
    var q0 = edIkEulerDegToQuat(base[i].rot);
    var r1 = (rotations && Array.isArray(rotations[i])) ? rotations[i] : base[i].rot;
    var q1 = edIkEulerDegToQuat([Number(r1[0]) || 0, Number(r1[1]) || 0, Number(r1[2]) || 0]);
    var dq = edIkQuatNorm(edIkQuatMul(q1, edIkQuatConjugate(q0)));
    pos.push(edIkV3Add(pos[i], edIkQuatRotateVec(dq, d)));
  }
  return pos;
}

/* solveCCD(chain, target, opts) — bộ giải CCD đầy đủ.
   opts: {iterations (mặc định 10, kẹp 1..30), tolerance (mặc định 0.01),
          constraints: {jointIndex: {min, max}} (độ, kẹp Euler world)}.
   Trả {reached, iterations, finalError, rotations, endPos, chain}.
   - reached: sai số cuối <= tolerance.
   - iterations: số vòng ccdStep đã chạy (0 nếu đã đạt ngay từ đầu).
   - rotations: góc Euler world (độ) cuối của từng khớp (khớp cuối giữ
     nguyên góc ban đầu — xoay nó không đổi vị trí đầu cuối).
   - finalError: khoảng cách đầu cuối -> target SAU kẹp constraint
     (nếu không kẹp thì bằng sai số sau vòng lặp cuối).
   - chain: chain cuối (pos + rot), pos đã tính lại bằng FK khi có kẹp. */
function edIkSolveCCD(chain, target, opts) {
  opts = opts || {};
  var maxIter = Math.round(Number(opts.iterations));
  if (!isFinite(maxIter)) maxIter = 10;
  maxIter = _edIkClamp(maxIter, 1, 30);
  var tol = Number(opts.tolerance);
  if (!isFinite(tol) || tol < 0) tol = 0.01;
  tol = Math.max(tol, 1e-9);
  var base = _edIkNormChain(chain);
  var tgt = _edIkNormTarget(target);
  if (!base || !base.length) {
    return { reached: false, iterations: 0, finalError: Infinity, rotations: [], endPos: null, chain: [], reason: 'Chuỗi xương rỗng.' };
  }
  if (!tgt) {
    return { reached: false, iterations: 0, finalError: Infinity, rotations: base.map(function (j) { return j.rot.slice(); }), endPos: base[base.length - 1].pos.slice(), chain: base, reason: 'Target không hợp lệ.' };
  }
  var work = base.map(function (j) { return { pos: j.pos.slice(), rot: j.rot.slice() }; });
  var err = edIkV3Dist(work[work.length - 1].pos, tgt);
  var it = 0;
  var reached = err <= tol;
  while (!reached && it < maxIter) {
    work = edIkCcdStep(work, tgt);
    it++;
    err = edIkV3Dist(work[work.length - 1].pos, tgt);
    reached = err <= tol;
  }
  var rotations = work.map(function (j) { return j.rot.slice(); });
  /* Kẹp constraint (Euler world) rồi tính lại vị trí bằng FK để sai số
     báo cáo là sai số thật sau kẹp. */
  var cons = opts.constraints;
  var clamped = false;
  if (cons && typeof cons === 'object') {
    for (var idx in cons) {
      if (!Object.prototype.hasOwnProperty.call(cons, idx)) continue;
      var ji = Number(idx);
      if (!isFinite(ji) || ji < 0 || ji >= rotations.length) continue;
      var c = edIkNormalizeConstraint(cons[idx]);
      for (var a = 0; a < 3; a++) {
        var nc = _edIkClamp(rotations[ji][a], c.min[a], c.max[a]);
        if (nc !== rotations[ji][a]) { rotations[ji][a] = nc; clamped = true; }
      }
    }
  }
  if (clamped) {
    var fk = edIkForwardKinematics(base, rotations);
    work = work.map(function (j, i) { return { pos: fk[i], rot: rotations[i].slice() }; });
    err = edIkV3Dist(fk[fk.length - 1], tgt);
    reached = err <= tol;
  }
  return {
    reached: reached,
    iterations: it,
    finalError: err,
    rotations: rotations,
    endPos: work[work.length - 1].pos.slice(),
    chain: work
  };
}

/* ---------------- Logic thuần: định nghĩa chuỗi xương ----------------
   Tên xương Mixamo (bỏ prefix 'mixamorig:' khi khớp). Tay/chân lấy 3 khớp
   như IK 2 xương đợt 3 (gốc = khớp vai/hông, giữa = khuỷu/gối, cuối =
   cổ tay/cổ chân). Cột sống 6 khớp Hips->Head; rig thiếu khớp giữa
   (vd không có Spine2) thì khớp đó được bỏ qua, chuỗi vẫn chạy. */

var ED_IK_CHAINS = [
  { key: 'leftArm', label: 'Tay trái', names: ['LeftArm', 'LeftForeArm', 'LeftHand'] },
  { key: 'rightArm', label: 'Tay phải', names: ['RightArm', 'RightForeArm', 'RightHand'] },
  { key: 'leftLeg', label: 'Chân trái', names: ['LeftUpLeg', 'LeftLeg', 'LeftFoot'] },
  { key: 'rightLeg', label: 'Chân phải', names: ['RightUpLeg', 'RightLeg', 'RightFoot'] },
  { key: 'spine', label: 'Cột sống', names: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'] },
  { key: 'custom', label: 'Tuỳ ý (chọn gốc + cuối)', names: null }
];

function edIkChainDefs() {
  return ED_IK_CHAINS.map(function (d) {
    return { key: d.key, label: d.label, names: d.names ? d.names.slice() : null };
  });
}

function _edIkFindBoneByName(bones, want) {
  var w = _edIkStripPrefix(want);
  if (!Array.isArray(bones)) return null;
  for (var i = 0; i < bones.length; i++) {
    if (bones[i] && _edIkStripPrefix(bones[i].name) === w) return bones[i];
  }
  return null;
}

/* Map danh sách tên -> xương thật trong mảng bones (khớp tên đã bỏ prefix).
   Trả {bones: [...tìm được...], missing: [tên không tìm được]}. */
function edIkResolveChainBones(bones, names) {
  var found = [], missing = [];
  (names || []).forEach(function (nm) {
    var b = _edIkFindBoneByName(bones, nm);
    if (b) found.push(b); else missing.push(nm);
  });
  return { bones: found, missing: missing };
}

/* Tìm chuỗi preset trong mảng bones (xương THREE thật hoặc descriptor
   collectBones — chỉ cần .name). Khớp giữa thiếu thì bỏ qua; thiếu gốc
   hoặc cuối thì trả null (kèm missing). Chuỗi 'custom' trả null — dùng
   chainFromBones(rootName, endName). */
function edIkFindPresetChain(bones, chainKey) {
  var def = null;
  for (var i = 0; i < ED_IK_CHAINS.length; i++) {
    if (ED_IK_CHAINS[i].key === chainKey) { def = ED_IK_CHAINS[i]; break; }
  }
  if (!def || !def.names) return null;
  var res = edIkResolveChainBones(bones, def.names);
  var root = _edIkFindBoneByName(bones, def.names[0]);
  var end = _edIkFindBoneByName(bones, def.names[def.names.length - 1]);
  if (!root || !end || res.bones.length < 2) {
    return { key: def.key, label: def.label, names: [], bones: [], missing: res.missing, ok: false,
             reason: 'Thiếu xương gốc hoặc xương cuối (' + def.names[0] + ' / ' + def.names[def.names.length - 1] + ').' };
  }
  return {
    key: def.key, label: def.label,
    names: res.bones.map(function (b) { return _edIkStripPrefix(b.name); }),
    bones: res.bones, missing: res.missing, ok: true
  };
}

/* Chuỗi tuỳ ý: gốc + cuối do người dùng chọn, tự lấy chuỗi nối giữa.
   - Cách 1 (xương THREE thật): đi ngược .parent từ cuối lên gốc.
   - Cách 2 (descriptor collectBones): dùng .path 'Hips/Spine/...',
     cắt đoạn từ gốc tới cuối.
   Trả {root, end, names, bones, missing} hoặc null (gốc không phải tổ
   tiên của cuối, hoặc thiếu 1 trong 2 xương). */
function edIkChainFromBones(bones, rootName, endName) {
  if (!Array.isArray(bones) || !bones.length || !rootName || !endName) return null;
  var root = _edIkFindBoneByName(bones, rootName);
  var end = _edIkFindBoneByName(bones, endName);
  if (!root || !end) return null;
  var rn = _edIkStripPrefix(root.name), en = _edIkStripPrefix(end.name);
  if (root === end) {
    return { root: rn, end: en, names: [rn], bones: [root], missing: [] };
  }
  /* Cách 1: đi ngược parent. */
  var up = [end];
  var cur = end;
  var ok = false;
  var guard = 0;
  while (cur && guard++ < 128) {
    if (cur === root) { ok = true; break; }
    cur = cur.parent;
    if (!cur) break;
    if (cur.isBone) up.unshift(cur);
    else break; /* gặp node không phải xương (group gốc) -> dừng */
  }
  if (ok) {
    return {
      root: rn, end: en,
      names: up.map(function (b) { return _edIkStripPrefix(b.name); }),
      bones: up, missing: []
    };
  }
  /* Cách 2: cắt theo path. */
  var endPath = (end && typeof end.path === 'string') ? end.path : null;
  if (endPath) {
    var parts = endPath.split('/');
    var ri = -1, ei = -1;
    for (var i = 0; i < parts.length; i++) {
      if (_edIkStripPrefix(parts[i]) === rn) ri = i;
      if (_edIkStripPrefix(parts[i]) === en) ei = i;
    }
    if (ri >= 0 && ei > ri) {
      var slice = parts.slice(ri, ei + 1);
      var res = edIkResolveChainBones(bones, slice);
      if (res.bones.length >= 2 &&
          _edIkStripPrefix(res.bones[0].name) === rn &&
          _edIkStripPrefix(res.bones[res.bones.length - 1].name) === en) {
        return {
          root: rn, end: en,
          names: res.bones.map(function (b) { return _edIkStripPrefix(b.name); }),
          bones: res.bones, missing: res.missing
        };
      }
    }
  }
  return null;
}

/* ---------------- Module ED.Ik (runtime: DOM/THREE trong hàm, có guard) ---------------- */

ED.Ik = {
  /* Logic thuần — test được bằng vm (không THREE, không DOM). */
  vec3: {
    make: edIkV3, clone: edIkV3Clone, add: edIkV3Add, sub: edIkV3Sub,
    scale: edIkV3Scale, dot: edIkV3Dot, cross: edIkV3Cross,
    len: edIkV3Len, dist: edIkV3Dist, norm: edIkV3Norm
  },
  quat: {
    identity: edIkQuatIdentity, norm: edIkQuatNorm, conjugate: edIkQuatConjugate,
    mul: edIkQuatMul, fromAxisAngle: edIkQuatFromAxisAngle, rotateVec: edIkQuatRotateVec,
    fromEulerDeg: edIkEulerDegToQuat, toEulerDeg: edIkQuatToEulerDeg
  },
  degToRad: edIkDegToRad,
  radToDeg: edIkRadToDeg,
  solveCCD: edIkSolveCCD,
  ccdStep: edIkCcdStep,
  forwardKinematics: edIkForwardKinematics,
  normalizeConstraint: edIkNormalizeConstraint,
  chainDefs: edIkChainDefs,
  resolveChainBones: edIkResolveChainBones,
  findPresetChain: edIkFindPresetChain,
  chainFromBones: edIkChainFromBones,

  _panel: null,
  _inited: false,
  _state: null,       /* {activeChain, enabled:{key:bool}, iterations, tolerance, customRoot, customEnd, customNames, lastResult, lastMeasuredError} */
  _restPose: null,    /* {chainKey: [{name, quat: THREE.Quaternion clone}]} — tư thế gốc lúc bật IK */
  _targetMesh: null,  /* quả cầu target cam trong preview scene */
  _dragging: false,
  _dragPlane: null,
  _dragCanvas: null,
  _dragParent: null,
  _ui: null,          /* ref các control trong panel */

  _defaultState: function () {
    return {
      activeChain: 'leftArm',
      enabled: { leftArm: false, rightArm: false, leftLeg: false, rightLeg: false, spine: false, custom: false },
      iterations: 10, tolerance: 0.01,
      customRoot: '', customEnd: '', customNames: null,
      lastResult: null, lastMeasuredError: null
    };
  },

  toast: function (msg) {
    try { if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg); } catch (e) {}
  },
  log: function (msg) {
    try { if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log(msg); } catch (e) {}
  },

  /* Preview của ED.Character (guard đầy đủ — task ghi getPreviewBones /
     getPreviewGroup có thể chưa có: chỉ dùng getPreview() + đọc
     pv.bones / pv.group từ object trả về). */
  _getPreview: function () {
    try {
      if (ED.Character && typeof ED.Character.getPreview === 'function') {
        return ED.Character.getPreview() || null;
      }
    } catch (e) {}
    return null;
  },

  /* Danh sách xương THREE.Bone trong preview group (để xoay + lấy world
     pos). Ưu tiên ED.Character.findIkChainInList/collectBones khi cần
     tên — ở đây cần object thật nên duyệt traverse trực tiếp. */
  _previewBones: function () {
    var pv = this._getPreview();
    if (!pv || !pv.group || typeof pv.group.traverse !== 'function') return [];
    var out = [];
    pv.group.traverse(function (obj) { if (obj && obj.isBone) out.push(obj); });
    return out;
  },

  _previewBoneNames: function () {
    var pv = this._getPreview();
    var names = [];
    if (pv && Array.isArray(pv.bones)) {
      pv.bones.forEach(function (b) { if (b && b.name) names.push(_edIkStripPrefix(b.name)); });
    }
    if (!names.length) {
      this._previewBones().forEach(function (b) { names.push(_edIkStripPrefix(b.name)); });
    }
    return names;
  },

  /* Lấy chuỗi xương THREE cho 1 key: 4 chi ưu tiên
     ED.Character.findIkChainInList (guard typeof) để khớp đúng định nghĩa
     đợt 3; cột sống + tuỳ ý dùng hàm thuần của module này. */
  _resolveChain: function (chainKey) {
    var bones = this._previewBones();
    if (!bones.length) return null;
    var limbKeys = { leftArm: 1, rightArm: 1, leftLeg: 1, rightLeg: 1 };
    if (limbKeys[chainKey] && ED.Character && typeof ED.Character.findIkChainInList === 'function') {
      try {
        var found = ED.Character.findIkChainInList(bones, chainKey);
        if (found && found.root && found.mid && found.end) {
          var def = null;
          edIkChainDefs().forEach(function (d) { if (d.key === chainKey) def = d; });
          return {
            key: chainKey, label: def ? def.label : chainKey,
            names: [found.root.name, found.mid.name, found.end.name].map(_edIkStripPrefix),
            bones: [found.root, found.mid, found.end], missing: [], ok: true
          };
        }
      } catch (e) {}
    }
    if (chainKey === 'custom') {
      var st = this._state;
      if (!st || !st.customRoot || !st.customEnd) return null;
      var c = edIkChainFromBones(bones, st.customRoot, st.customEnd);
      if (!c || c.bones.length < 2) return null;
      return { key: 'custom', label: 'Tuỳ ý', names: c.names, bones: c.bones, missing: c.missing || [], ok: true };
    }
    var preset = edIkFindPresetChain(bones, chainKey);
    if (!preset || !preset.ok) return preset;
    return preset;
  },

  /* Quả cầu target cam trong preview scene (tạo 1 lần, dùng lại). */
  _ensureTargetMesh: function () {
    var pv = this._getPreview();
    if (!pv || !pv.scene || typeof THREE === 'undefined' || !THREE.Mesh) return null;
    if (this._targetMesh && this._targetMesh.parent === pv.scene) return this._targetMesh;
    try {
      var mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xff7a1a })
      );
      mesh.visible = false;
      pv.scene.add(mesh);
      this._targetMesh = mesh;
      return mesh;
    } catch (e) { return null; }
  },

  /* Lưu tư thế gốc (quaternion từng xương) lúc bật IK — để nút "Đặt lại
     tư thế" trả về đúng tư thế lúc bật, không phải tư thế lúc load file
     (khác với resetIkPose đợt 3). */
  _saveRestPose: function (chainKey, bones) {
    if (!this._restPose) this._restPose = {};
    if (this._restPose[chainKey]) return;
    this._restPose[chainKey] = bones.map(function (b) {
      var q = null;
      try { q = b.quaternion.clone(); } catch (e) { q = null; }
      return { name: b.name, quat: q };
    });
  },

  _hideTwoBoneTarget: function () {
    /* Tránh 2 quả cầu cam cùng lúc: CCD bật thì ẩn quả cầu IK 2 xương
       đợt 3 (nó tự hiện lại khi user bấm chi IK 2 xương). */
    try {
      var pv = this._getPreview();
      if (pv && pv.ik && pv.ik.targetMesh) pv.ik.targetMesh.visible = false;
    } catch (e) {}
  },

  isChainEnabled: function (chainKey) {
    return !!(this._state && this._state.enabled && this._state.enabled[chainKey]);
  },

  _anyEnabled: function () {
    var st = this._state;
    if (!st || !st.enabled) return false;
    for (var k in st.enabled) if (st.enabled[k]) return true;
    return false;
  },

  setActiveChain: function (chainKey) {
    if (!this._state) this._state = this._defaultState();
    var ok = false;
    edIkChainDefs().forEach(function (d) { if (d.key === chainKey) ok = true; });
    if (!ok) return false;
    this._state.activeChain = chainKey;
    this._refreshChainUI();
    this._ensureDragAttached();
    return true;
  },

  /* Bật/tắt 1 chuỗi IK. Bật: lưu tư thế gốc + hiện quả cầu target tại
     đầu cuối của chuỗi; tắt: nếu không còn chuỗi nào bật thì ẩn quả cầu. */
  setChainEnabled: function (chainKey, enabled) {
    if (!this._state) this._state = this._defaultState();
    var on = !!enabled;
    var pv = this._getPreview();
    if (on && (!pv || !pv.group)) {
      this.toast('Chưa có model trong khung xem trước — nhập file .fbx/.glb có xương trước rồi bật IK.');
      return false;
    }
    var chain = on ? this._resolveChain(chainKey) : null;
    if (on && (!chain || !chain.ok)) {
      this.toast('Không tìm đủ xương cho chuỗi này trong model' +
        (chain && chain.reason ? ' (' + chain.reason + ')' : ' — thử chuỗi khác hoặc nhập model Mixamo đầy đủ xương.'));
      return false;
    }
    this._state.enabled[chainKey] = on;
    if (on) {
      this._saveRestPose(chainKey, chain.bones);
      this._hideTwoBoneTarget();
      var mesh = this._ensureTargetMesh();
      if (mesh) {
        try {
          if (typeof THREE !== 'undefined' && pv.group) pv.group.updateMatrixWorld(true);
          var wp = new THREE.Vector3();
          chain.bones[chain.bones.length - 1].getWorldPosition(wp);
          mesh.position.copy(wp);
          mesh.visible = true;
        } catch (e) {}
      }
      this.toast('Đã bật IK toàn thân: ' + chain.label + ' — kéo quả cầu cam trong khung xem trước.');
    } else {
      if (!this._anyEnabled() && this._targetMesh) this._targetMesh.visible = false;
      this.toast('Đã tắt IK cho chuỗi này.');
    }
    this._ensureDragAttached();
    this._refreshChainUI();
    return on;
  },

  /* Giải CCD cho 1 chuỗi rồi xoay các xương trong preview theo kết quả.
     target: [x, y, z] world. opts: {iterations, tolerance, constraints,
     fromDrag} — constraints ở đây là kẹp Euler WORLD (thuần); constraint
     LOCAL đợt 3 được áp thêm sau khi gán (xem header).
     Trả {ok, chainKey, names, result, measuredError} hoặc
     {ok:false, reason}. */
  applyToPreview: function (chainKey, target, opts) {
    opts = opts || {};
    if (typeof THREE === 'undefined' || !THREE.Quaternion || !THREE.Euler) {
      return { ok: false, reason: 'Chưa tải được THREE, thử tải lại trang.' };
    }
    var pv = this._getPreview();
    if (!pv || !pv.group) {
      return { ok: false, reason: 'Chưa có model trong khung xem trước — nhập file .fbx/.glb có xương trước.' };
    }
    if (!this._state) this._state = this._defaultState();
    var chain = this._resolveChain(chainKey);
    if (!chain || !chain.ok) {
      return { ok: false, reason: 'Không tìm đủ xương cho chuỗi này trong model' +
        (chain && chain.reason ? ' (' + chain.reason + ')' : '.') };
    }
    var tgt = _edIkNormTarget(target);
    if (!tgt) return { ok: false, reason: 'Target [x, y, z] không hợp lệ.' };
    try { pv.group.updateMatrixWorld(true); } catch (e) {}
    /* Dừng clip đang phát (không thì mixer ghi đè ngay frame sau) — cùng
       pattern với applyIk đợt 3. */
    pv.playing = false;
    /* Build chain thuần: pos world + Euler world (độ) của từng xương. */
    var pure = chain.bones.map(function (b) {
      var wp = new THREE.Vector3();
      try { b.getWorldPosition(wp); } catch (e) {}
      var wq = new THREE.Quaternion();
      try { b.getWorldQuaternion(wq); } catch (e) {}
      var eu = new THREE.Euler().setFromQuaternion(wq, 'XYZ');
      return {
        pos: [wp.x, wp.y, wp.z],
        rot: [edIkRadToDeg(eu.x), edIkRadToDeg(eu.y), edIkRadToDeg(eu.z)]
      };
    });
    var st = this._state;
    var sol = edIkSolveCCD(pure, tgt, {
      iterations: (opts.iterations != null) ? opts.iterations : st.iterations,
      tolerance: (opts.tolerance != null) ? opts.tolerance : st.tolerance,
      constraints: opts.constraints || null
    });
    this._saveRestPose(chainKey, chain.bones);
    /* Gán kết quả: world Euler -> world quat -> local quat từng xương. */
    for (var i = 0; i < chain.bones.length; i++) {
      var bone = chain.bones[i];
      var r = sol.rotations[i];
      var eq = new THREE.Euler(edIkDegToRad(r[0]), edIkDegToRad(r[1]), edIkDegToRad(r[2]), 'XYZ');
      var wq2 = new THREE.Quaternion().setFromEuler(eq);
      var pq = new THREE.Quaternion();
      if (bone.parent) { try { bone.parent.getWorldQuaternion(pq); } catch (e) {} }
      try { bone.quaternion.copy(pq.clone().invert().multiply(wq2)); } catch (e) {}
      /* Kẹp constraint LOCAL đợt 3 (delta so với tư thế gốc) nếu có. */
      try {
        if (ED.Character && typeof ED.Character._clampBoneRotation === 'function') {
          ED.Character._clampBoneRotation(bone);
        }
      } catch (e2) {}
    }
    try { pv.group.updateMatrixWorld(true); } catch (e) {}
    /* Đo lại sai số THẬT sau kẹp (đầu cuối sau khi gán + kẹp). */
    var measured = null;
    try {
      var endWp = new THREE.Vector3();
      chain.bones[chain.bones.length - 1].getWorldPosition(endWp);
      measured = edIkV3Dist([endWp.x, endWp.y, endWp.z], tgt);
    } catch (e) {}
    var mesh = this._ensureTargetMesh();
    if (mesh) {
      try { mesh.position.set(tgt[0], tgt[1], tgt[2]); mesh.visible = true; } catch (e) {}
    }
    st.lastResult = sol;
    st.lastMeasuredError = measured;
    if (opts.refreshUI !== false) this._refreshChainUI();
    return { ok: true, chainKey: chainKey, names: chain.names, result: sol, measuredError: measured };
  },

  /* Trả mọi xương của các chuỗi đã bật (đã lưu tư thế gốc) về tư thế lúc
     bật IK. Trả true nếu trả được ít nhất 1 xương. */
  resetPose: function () {
    var pv = this._getPreview();
    if (!pv || !pv.group || !this._restPose) return false;
    var n = 0;
    var self = this;
    Object.keys(this._restPose).forEach(function (key) {
      (self._restPose[key] || []).forEach(function (saved) {
        if (!saved || !saved.quat) return;
        var found = null;
        pv.group.traverse(function (obj) {
          if (!found && obj && obj.isBone && obj.name === saved.name) found = obj;
        });
        if (found) {
          try { found.quaternion.copy(saved.quat); n++; } catch (e) {}
        }
      });
    });
    if (!n) return false;
    try { pv.group.updateMatrixWorld(true); } catch (e) {}
    if (this._targetMesh) this._targetMesh.visible = false;
    if (this._state) { this._state.lastResult = null; this._state.lastMeasuredError = null; }
    this._refreshChainUI();
    return true;
  },

  /* ---------------- Kéo target trong preview ----------------
     Nghe pointerdown (capture) trên THẺ CHA của canvas preview — capture ở
     tổ tiên chạy TRƯỚC handler pointerdown của 07-character.js trên chính
     canvas, nên stopPropagation() khi bấm trúng quả cầu sẽ chặn luôn việc
     xoay camera 360° của đợt 3; bấm trượt quả cầu thì để yên cho camera
     xoay như cũ. pointermove/up nghe trên window (07 chỉ xoay khi
     pv.drag đã set — mà pointerdown của nó đã bị chặn nên pv.drag null). */
  _ensureDragAttached: function () {
    if (typeof document === 'undefined' || typeof THREE === 'undefined' || !THREE.Raycaster) return false;
    var pv = this._getPreview();
    if (!pv || !pv.renderer || !pv.renderer.domElement) return false;
    var cv = pv.renderer.domElement;
    var self = this;
    if (!this._dragRaycaster) {
      this._dragRaycaster = new THREE.Raycaster();
      this._dragNdc = new THREE.Vector2();
      this._dragPlane = new THREE.Plane();
      this._onDragDown = function (e) { self._handleDragDown(e); };
      this._onDragMove = function (e) { self._handleDragMove(e); };
      this._onDragUp = function () { self._dragging = false; };
      window.addEventListener('pointermove', this._onDragMove);
      window.addEventListener('pointerup', this._onDragUp);
      window.addEventListener('pointercancel', this._onDragUp);
    }
    if (this._dragParent && this._dragParent !== cv.parentElement) {
      try { this._dragParent.removeEventListener('pointerdown', this._onDragDown, true); } catch (e) {}
      this._dragParent = null;
    }
    if (this._dragParent !== cv.parentElement && cv.parentElement) {
      cv.parentElement.addEventListener('pointerdown', this._onDragDown, true);
      this._dragParent = cv.parentElement;
    }
    this._dragCanvas = cv;
    return true;
  },

  _pointerNdc: function (e) {
    var cv = this._dragCanvas;
    if (!cv) return null;
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var x = (e.clientX != null) ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    var y = (e.clientY != null) ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    return { x: ((x - r.left) / r.width) * 2 - 1, y: -((y - r.top) / r.height) * 2 + 1 };
  },

  _handleDragDown: function (e) {
    if (!this._anyEnabled()) return;
    var pv = this._getPreview();
    if (!pv || !pv.camera || !this._targetMesh || !this._targetMesh.visible) return;
    var n = this._pointerNdc(e);
    if (!n) return;
    this._dragNdc.set(n.x, n.y);
    this._dragRaycaster.setFromCamera(this._dragNdc, pv.camera);
    var hit = null;
    try { hit = this._dragRaycaster.intersectObject(this._targetMesh, false); } catch (err) { hit = null; }
    if (!hit || !hit.length) return; /* bấm trượt: để 07 xoay camera */
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    pv.playing = false;
    this._dragging = true;
    var nrm = new THREE.Vector3();
    try { pv.camera.getWorldDirection(nrm); } catch (err) { nrm.set(0, 0, 1); }
    try { this._dragPlane.setFromNormalAndCoplanarPoint(nrm, this._targetMesh.position); } catch (err) {}
    try {
      if (this._dragCanvas && this._dragCanvas.setPointerCapture) {
        this._dragCanvas.setPointerCapture(e.pointerId);
      }
    } catch (err) {}
  },

  _handleDragMove: function (e) {
    if (!this._dragging) return;
    var pv = this._getPreview();
    if (!pv || !pv.camera) { this._dragging = false; return; }
    var n = this._pointerNdc(e);
    if (!n) return;
    this._dragNdc.set(n.x, n.y);
    this._dragRaycaster.setFromCamera(this._dragNdc, pv.camera);
    var pt = new THREE.Vector3();
    var ok = false;
    try { ok = !!this._dragRaycaster.ray.intersectPlane(this._dragPlane, pt); } catch (err) { ok = false; }
    if (!ok) return;
    var st = this._state;
    var r = this.applyToPreview(st.activeChain, [pt.x, pt.y, pt.z], { fromDrag: true });
    if (!r.ok) {
      this._dragging = false;
      this.toast(r.reason || 'Không kéo được IK.');
      return;
    }
    this._syncTargetInputs([pt.x, pt.y, pt.z]);
  },

  _syncTargetInputs: function (t) {
    var ui = this._ui;
    if (!ui || !ui.tx) return;
    ui.tx.value = Number(t[0]).toFixed(2);
    ui.ty.value = Number(t[1]).toFixed(2);
    ui.tz.value = Number(t[2]).toFixed(2);
  },

  /* ---------------- UI (chỉ trong init) ---------------- */

  _refreshChainUI: function () {
    var ui = this._ui;
    var st = this._state;
    if (!ui || !st) return;
    if (ui.chainSel) ui.chainSel.value = st.activeChain;
    var def = null;
    edIkChainDefs().forEach(function (d) { if (d.key === st.activeChain) def = d; });
    var label = def ? def.label : st.activeChain;
    if (ui.toggleBtn) {
      ui.toggleBtn.textContent = (st.enabled[st.activeChain] ? 'Tắt IK: ' : 'Bật IK: ') + label;
    }
    if (ui.customRow) {
      ui.customRow.style.display = (st.activeChain === 'custom') ? '' : 'none';
    }
    if (ui.customInfo) {
      ui.customInfo.textContent = st.customNames
        ? ('Chuỗi tuỳ ý: ' + st.customNames.join(' → ') + ' (' + st.customNames.length + ' khớp)')
        : 'Chưa lấy chuỗi — chọn xương gốc + xương cuối rồi bấm "Lấy chuỗi".';
    }
    if (ui.statusEl) {
      var pv = this._getPreview();
      var lines = [];
      if (!pv || !pv.group) {
        lines.push('Chưa có model — nhập file .fbx/.glb có xương trước rồi bật IK.');
      } else {
        var on = [];
        for (var k in st.enabled) {
          if (st.enabled[k]) {
            var d2 = null;
            edIkChainDefs().forEach(function (d) { if (d.key === k) d2 = d; });
            on.push(d2 ? d2.label : k);
          }
        }
        lines.push(on.length ? ('Đang bật IK: ' + on.join(', ') + '.') : 'Chưa bật chuỗi IK nào.');
        if (st.lastResult) {
          var r = st.lastResult;
          var errTxt = 'Sai số cuối: ' + Number(r.finalError).toFixed(4) +
            ' (sau ' + r.iterations + ' vòng' + (r.reached ? ', đã tới đích' : ', chưa tới đích') + ')';
          if (st.lastMeasuredError != null && Math.abs(st.lastMeasuredError - r.finalError) > 0.005) {
            errTxt += ' — đo lại sau kẹp: ' + Number(st.lastMeasuredError).toFixed(4);
          }
          lines.push(errTxt);
        }
      }
      ui.statusEl.textContent = lines.join(' ');
    }
  },

  refreshBoneLists: function () {
    var ui = this._ui;
    if (!ui || !ui.rootSel) return false;
    var names = this._previewBoneNames();
    var st = this._state;
    function fill(sel, keep) {
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      var o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = '— Chọn xương —';
      sel.appendChild(o0);
      names.forEach(function (nm) {
        var o = document.createElement('option');
        o.value = nm;
        o.textContent = nm;
        sel.appendChild(o);
      });
      sel.value = (keep && names.indexOf(keep) >= 0) ? keep : '';
    }
    fill(ui.rootSel, st.customRoot);
    fill(ui.endSel, st.customEnd);
    return names.length > 0;
  },

  init: function () {
    if (typeof document === 'undefined') return false;
    if (this._inited && this._panel) return true;
    if (!this._state) this._state = this._defaultState();
    if (!this._restPose) this._restPose = {};
    var host = document.querySelector('[data-ed-panel="character"]')
      || document.getElementById('ed-panel-character')
      || document.getElementById('ed-tab-character')
      || document.getElementById('tab-character')
      || document.getElementById('panel-bottom')
      || document.body;
    if (!host) return false;
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
    function numInput(value, step, min, max) {
      var inp = el('input');
      inp.type = 'number';
      inp.step = step || '1';
      if (min != null) inp.min = String(min);
      if (max != null) inp.max = String(max);
      inp.value = String(value);
      inp.style.minHeight = '40px';
      inp.style.width = '70px';
      return inp;
    }

    var wrap = el('div', 'ed-char-ik-full');
    wrap.appendChild(el('div', '', '🦾 IK toàn thân (CCD)'));
    wrap.appendChild(el('div', 'ed-char-hint',
      'Giải chuỗi xương dài (tay / chân / cột sống) bằng CCD — xoay từng khớp từ cuối về gốc cho tới khi đầu cuối chạm target. ' +
      'IK 2 xương đợt 3 giữ nguyên cho chi ngắn (có pole vector); CCD không có pole nên hướng khuỷu/gối theo tư thế ban đầu. ' +
      'Kéo quả cầu CAM trong khung xem trước để kéo chuỗi đang bật.'));
    var st = this._state;

    /* Chọn chuỗi + bật/tắt + đặt lại tư thế. */
    var row1 = el('div', 'ed-row');
    row1.appendChild(el('label', '', 'Chuỗi:'));
    var chainSel = el('select', 'ed-ik-chain-select');
    chainSel.style.minHeight = '40px';
    chainSel.style.flex = '1';
    edIkChainDefs().forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.key;
      o.textContent = d.label;
      chainSel.appendChild(o);
    });
    chainSel.value = st.activeChain;
    chainSel.addEventListener('change', function () {
      self.setActiveChain(chainSel.value);
      if (chainSel.value === 'custom') self.refreshBoneLists();
    });
    row1.appendChild(chainSel);
    wrap.appendChild(row1);

    var row2 = el('div', 'ed-row');
    var toggleBtn = btn('Bật IK: Tay trái', function () {
      var key = self._state.activeChain;
      var now = self.isChainEnabled(key);
      var ok = self.setChainEnabled(key, !now);
      if (!ok && !now) self.toast('Không bật được IK cho chuỗi này — xem trạng thái bên dưới.');
    });
    row2.appendChild(toggleBtn);
    row2.appendChild(btn('↺ Đặt lại tư thế', function () {
      if (self.resetPose()) self.toast('Đã trả xương về tư thế lúc bật IK.');
      else self.toast('Chưa có tư thế gốc để trả — bật 1 chuỗi IK trước.');
    }));
    wrap.appendChild(row2);

    /* Chuỗi tuỳ ý: chọn gốc + cuối. */
    var customRow = el('div', 'ed-row');
    customRow.style.display = 'none';
    customRow.appendChild(el('label', '', 'Gốc:'));
    var rootSel = el('select', 'ed-ik-custom-root');
    rootSel.style.minHeight = '40px';
    rootSel.style.flex = '1';
    customRow.appendChild(rootSel);
    customRow.appendChild(el('label', '', 'Cuối:'));
    var endSel = el('select', 'ed-ik-custom-end');
    endSel.style.minHeight = '40px';
    endSel.style.flex = '1';
    customRow.appendChild(endSel);
    wrap.appendChild(customRow);
    var customRow2 = el('div', 'ed-row');
    customRow2.style.display = 'none';
    customRow2.appendChild(btn('↻ Nạp danh sách xương', function () {
      if (self.refreshBoneLists()) self.toast('Đã nạp danh sách xương từ model đang xem.');
      else self.toast('Chưa có model — nhập file .fbx/.glb có xương trước.');
    }));
    customRow2.appendChild(btn('⛓ Lấy chuỗi', function () {
      var r = self.refreshBoneLists();
      var root = rootSel.value, end = endSel.value;
      if (!root || !end) { self.toast('Chọn xương gốc và xương cuối trước.'); return; }
      var bones = self._previewBones();
      var c = edIkChainFromBones(bones, root, end);
      if (!c || c.bones.length < 2) {
        self._state.customNames = null;
        self._refreshChainUI();
        self.toast('Không nối được chuỗi: xương gốc phải là tổ tiên của xương cuối (thử đổi gốc/cuối).');
        return;
      }
      self._state.customRoot = root;
      self._state.customEnd = end;
      self._state.customNames = c.names;
      self._refreshChainUI();
      self.toast('Chuỗi tuỳ ý: ' + c.names.join(' → '));
    }));
    wrap.appendChild(customRow2);
    var customInfo = el('div', 'ed-char-hint', 'Chưa lấy chuỗi — chọn xương gốc + xương cuối rồi bấm "Lấy chuỗi".');
    customInfo.style.display = 'none';
    wrap.appendChild(customInfo);
    /* Ẩn/hiện hàng tuỳ ý cùng customRow: gom vào 1 hàm nhỏ qua style. */
    var _origRefresh = this._refreshChainUI.bind(this);
    this._refreshChainUI = function () {
      _origRefresh();
      var show = self._state.activeChain === 'custom';
      if (customRow) customRow.style.display = show ? '' : 'none';
      if (customRow2) customRow2.style.display = show ? '' : 'none';
      if (customInfo) customInfo.style.display = show ? '' : 'none';
    };

    /* Số vòng lặp + dung sai. */
    var row3 = el('div', 'ed-row');
    row3.appendChild(el('label', '', 'Vòng lặp (1–30):'));
    var iterInp = numInput(st.iterations, '1', 1, 30);
    iterInp.addEventListener('change', function () {
      var v = Math.round(Number(iterInp.value));
      if (!isFinite(v)) v = 10;
      st.iterations = _edIkClamp(v, 1, 30);
      iterInp.value = String(st.iterations);
    });
    row3.appendChild(iterInp);
    row3.appendChild(el('label', '', 'Dung sai:'));
    var tolInp = numInput(st.tolerance, '0.005', 0.001, 1);
    tolInp.addEventListener('change', function () {
      var v = Number(tolInp.value);
      if (!isFinite(v) || v <= 0) v = 0.01;
      st.tolerance = Math.min(1, Math.max(0.001, v));
      tolInp.value = String(st.tolerance);
    });
    row3.appendChild(tolInp);
    wrap.appendChild(row3);

    /* Target [x, y, z] + áp dụng. */
    var row4 = el('div', 'ed-row');
    row4.appendChild(el('label', '', 'Đích [x, y, z]:'));
    var tx = numInput(0, '0.1');
    var ty = numInput(1, '0.1');
    var tz = numInput(0, '0.1');
    row4.appendChild(tx); row4.appendChild(ty); row4.appendChild(tz);
    row4.appendChild(btn('🎯 Áp dụng đích', function () {
      var t = [Number(tx.value), Number(ty.value), Number(tz.value)];
      if (!t.every(isFinite)) { self.toast('Nhập đủ 3 số cho đích [x, y, z].'); return; }
      var key = self._state.activeChain;
      if (!self.isChainEnabled(key)) {
        var ok = self.setChainEnabled(key, true);
        if (!ok) return;
      }
      var r = self.applyToPreview(key, t);
      if (!r.ok) self.toast(r.reason || 'Không áp được đích.');
      else self.toast((r.result.reached ? 'Đã tới đích' : 'Chưa tới đích') +
        ' — sai số ' + Number(r.result.finalError).toFixed(4) +
        ' sau ' + r.result.iterations + ' vòng.');
    }));
    wrap.appendChild(row4);

    var statusEl = el('div', 'ed-char-hint', 'Chưa có model — nhập file .fbx/.glb có xương trước rồi bật IK.');
    wrap.appendChild(statusEl);

    host.appendChild(wrap);
    this._panel = wrap;
    this._ui = {
      chainSel: chainSel, toggleBtn: toggleBtn,
      customRow: customRow, rootSel: rootSel, endSel: endSel,
      customInfo: customInfo, iterInp: iterInp, tolInp: tolInp,
      tx: tx, ty: ty, tz: tz, statusEl: statusEl
    };
    this._inited = true;
    this.refreshBoneLists();
    this._refreshChainUI();
    this._ensureDragAttached();
    return true;
  }
};
