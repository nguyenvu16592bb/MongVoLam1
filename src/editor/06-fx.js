/* ============================================================================
   Map Editor — 06-fx.js (nhóm B)
   ED.Fx — particle FX thật bằng THREE.Points (+ Line cho sét):
   fire (cam/đỏ bay lên), smoke (xám bay lên chậm), lightning (tia sét
   zigzag nhấp nháy + chớp sáng), aura (vòng điểm xoay quanh chân),
   heal (xanh lá bay lên). Đợt 6 — foam (bọt trắng bay lên rồi rơi,
   gắn sẵn ở chân thác 'waterfall' trong 03-assets.js). Mỗi FX là object type 'fx' với
   extra {fxType, count, speed, color}; inspector đổi count/speed/color
   rồi gọi ED.Fx.updateFx(obj). Viewport render loop gọi ED.Fx.tick(dt).
   Xem trước ngay trong viewport khi đặt (buildFx tạo Points thật).
   Logic thuần (defaults, validate, pseudo-random theo index) test được
   bằng vm + stub THREE. Quy tắc DESIGN.md: KHÔNG truy cập
   document/window/THREE ở top-level.
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Fx = (function () {
  'use strict';

  var TYPES = {
    fire: { name: 'Lửa', color: '#ff8c1a', count: 60, speed: 1, size: 0.28, desc: 'Điểm cam/đỏ bay lên' },
    smoke: { name: 'Khói', color: '#9aa0a6', count: 40, speed: 0.5, size: 0.5, desc: 'Khói xám bay lên chậm' },
    lightning: { name: 'Sét', color: '#bfe3ff', count: 1, speed: 1, size: 0.2, desc: 'Tia sét zigzag + chớp sáng' },
    aura: { name: 'Hào quang', color: '#38bdf8', count: 48, speed: 1, size: 0.22, desc: 'Vòng điểm xoay quanh chân' },
    heal: { name: 'Hồi máu', color: '#4ade80', count: 36, speed: 0.8, size: 0.24, desc: 'Điểm xanh lá bay lên' },
    /* Đợt 6 — bọt nước ở chân thác (03-assets.js 'waterfall' gắn sẵn):
       hạt trắng bay lên rồi rơi theo parabol, mặc định 40 hạt. */
    foam: { name: 'Bọt nước', color: '#ffffff', count: 40, speed: 1, size: 0.3, desc: 'Bọt trắng bay lên rồi rơi' }
  };

  /* Registry các FX đang chạy trong viewport: id -> {group, type, ...}. */
  var _instances = {};
  var _time = 0;

  function listTypes() {
    return Object.keys(TYPES).map(function (k) {
      return { type: k, name: TYPES[k].name, desc: TYPES[k].desc };
    });
  }
  function defaults(fxType) {
    var d = TYPES[fxType] || TYPES.fire;
    return { fxType: fxType in TYPES ? fxType : 'fire', count: d.count, speed: d.speed, color: d.color, size: d.size };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function validateExtra(extra) {
    extra = extra || {};
    var d = defaults(extra.fxType || 'fire');
    return {
      fxType: d.fxType,
      count: clamp(Math.round(Number(extra.count) || d.count), 1, 500),
      speed: clamp(Number(extra.speed) || d.speed, 0.1, 5),
      color: typeof extra.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(extra.color) ? extra.color : d.color
    };
  }
  /* Pseudo-random ổn định theo index (không dùng Math.random trong logic
     khởi tạo hạt — cùng 1 FX luôn cho cùng hình dạng ban đầu). */
  function prand(i, salt) {
    var x = Math.sin(i * 12.9898 + (salt || 0) * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  function hexToRgb(h) {
    h = String(h || '#ffffff').replace('#', '');
    var n = parseInt(h, 16);
    if (!isFinite(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* ---- buildFx(fxType, opts) -> THREE.Group (Points thật). ---- */
  function buildFx(fxType, opts) {
    opts = validateExtra(Object.assign({ fxType: fxType }, opts || {}));
    var g = new THREE.Group();
    g.userData.fx = opts;
    g.userData.assetType = 'fx';
    if (opts.fxType === 'lightning') {
      buildLightning(g, opts);
    } else {
      buildPoints(g, opts);
    }
    return g;
  }

  function buildPoints(g, opts) {
    var count = opts.count;
    var pos = new Float32Array(count * 3);
    var col = new Float32Array(count * 3);
    var base = hexToRgb(opts.color);
    var ages = new Float32Array(count);
    var seeds = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      seeds[i * 3] = prand(i, 1); seeds[i * 3 + 1] = prand(i, 2); seeds[i * 3 + 2] = prand(i, 3);
      ages[i] = prand(i, 4); // lệch pha ban đầu để không bay đồng loạt
      var shade = 0.75 + prand(i, 5) * 0.5;
      col[i * 3] = clamp(base[0] * shade, 0, 1);
      col[i * 3 + 1] = clamp(base[1] * shade, 0, 1);
      col[i * 3 + 2] = clamp(base[2] * shade, 0, 1);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var size = (TYPES[opts.fxType] || TYPES.fire).size;
    var material = new THREE.PointsMaterial({
      size: size, vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false, sizeAttenuation: true
    });
    var points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    g.add(points);
    var st = { group: g, type: opts.fxType, opts: opts, points: points, ages: ages, seeds: seeds };
    g.userData.fxState = st;
    placePoints(st, 0);
    return g;
  }

  /* Vị trí hạt tại thời điểm t (giây) theo loại FX — thuần theo seed/age. */
  function placePoints(st, t) {
    var arr = st.points.geometry.attributes.position.array;
    var n = st.opts.count;
    var speed = st.opts.speed;
    for (var i = 0; i < n; i++) {
      var s0 = st.seeds[i * 3], s1 = st.seeds[i * 3 + 1], s2 = st.seeds[i * 3 + 2];
      var life = 1.6 / Math.max(0.2, speed);
      var age = (st.ages[i] * life + t) % life;
      var k = age / life; // 0..1 vòng đời
      var x, y, z;
      if (st.type === 'fire') {
        x = (s0 - 0.5) * 0.9 * (1 + k * 0.6) + Math.sin(t * 3 + i) * 0.08;
        y = 0.1 + k * 2.2;
        z = (s1 - 0.5) * 0.9 * (1 + k * 0.6) + Math.cos(t * 2.4 + i) * 0.08;
      } else if (st.type === 'smoke') {
        x = (s0 - 0.5) * 0.7 + Math.sin(t * 0.8 + i * 1.7) * 0.3 * k;
        y = 0.1 + k * 2.6;
        z = (s1 - 0.5) * 0.7 + Math.cos(t * 0.7 + i) * 0.3 * k;
      } else if (st.type === 'aura') {
        var a = t * 1.6 * speed + i * (Math.PI * 2 / n);
        var r = 0.85 + 0.12 * Math.sin(t * 2 + i);
        x = Math.cos(a) * r; y = 0.15 + 0.1 * Math.sin(t * 3 + i * 0.9); z = Math.sin(a) * r;
      } else if (st.type === 'foam') {
        /* Đợt 6 — bọt nước: bay lên rồi rơi theo parabol y = 4k(1-k)*1.4,
           x/z xoè dần theo vòng đời, bay lệch theo seed. */
        x = (s0 - 0.5) * 1.1 * (0.5 + k) + Math.sin(t * 2 + i * 1.3) * 0.12 * k;
        y = 0.1 + 4 * k * (1 - k) * 1.4;
        z = (s1 - 0.5) * 1.1 * (0.5 + k) + Math.cos(t * 1.8 + i) * 0.12 * k;
      } else { // heal
        x = (s0 - 0.5) * 1.1 + Math.sin(t * 1.5 + i) * 0.15;
        y = 0.1 + k * 2.0;
        z = (s1 - 0.5) * 1.1 + Math.cos(t * 1.3 + i) * 0.15;
      }
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    st.points.geometry.attributes.position.needsUpdate = true;
  }

  function buildLightning(g, opts) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
    var line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: opts.color, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    g.add(line);
    var flash = new THREE.PointLight(0xbfe3ff, 0, 18);
    flash.position.set(0, 4, 0);
    g.add(flash);
    var st = { group: g, type: 'lightning', opts: opts, line: line, flash: flash,
      nextFlash: 0.3 + prand(7, 9) * 1.5, flashLeft: 0 };
    g.userData.fxState = st;
    regenBolt(st);
    return g;
  }
  /* Vẽ lại tia sét zigzag từ trời (y=6) xuống đất (y=0). */
  function regenBolt(st) {
    var arr = st.line.geometry.attributes.position.array;
    var x = 0, z = 0;
    for (var i = 0; i < 12; i++) {
      var k = i / 11;
      arr[i * 3] = x + (prand(i, 11) - 0.5) * 1.2 * (i === 0 || i === 11 ? 0 : 1);
      arr[i * 3 + 1] = 6 * (1 - k);
      arr[i * 3 + 2] = z + (prand(i, 12) - 0.5) * 1.2 * (i === 0 || i === 11 ? 0 : 1);
    }
    st.line.geometry.attributes.position.needsUpdate = true;
  }

  /* ---- tick(dt): viewport render loop gọi mỗi frame. ---- */
  function tick(dt) {
    dt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    _time += dt;
    var ids = Object.keys(_instances);
    for (var k = 0; k < ids.length; k++) {
      var st = _instances[ids[k]];
      if (!st || !st.group || !st.group.parent) continue;
      if (st.type === 'lightning') {
        st.nextFlash -= dt;
        if (st.nextFlash <= 0) {
          regenBolt(st);
          st.flashLeft = 0.18;
          st.nextFlash = 0.8 + prand(Math.floor(_time * 10), 13) * 2.2;
        }
        if (st.flashLeft > 0) {
          st.flashLeft -= dt;
          st.line.material.opacity = st.flashLeft > 0.09 ? 1 : 0.35;
          st.flash.intensity = 2.2;
        } else {
          st.line.material.opacity = 0;
          st.flash.intensity = 0;
        }
      } else if (st.points) {
        placePoints(st, _time);
      }
    }
  }

  /* ---- Đăng ký / gỡ FX với viewport. ---- */
  /* Tìm scene qua meshes (viewport chưa expose ED.Viewport.scene):
     đi lên parent của 1 mesh bất kỳ — node gốc là Scene. */
  function findScene() {
    if (ED.Viewport && ED.Viewport.scene) return ED.Viewport.scene;
    var meshes = ED.Viewport && ED.Viewport.meshes;
    if (!meshes) return null;
    var ids = Object.keys(meshes);
    for (var i = 0; i < ids.length; i++) {
      var o = meshes[ids[i]];
      var guard = 0;
      while (o && o.parent && guard++ < 20) o = o.parent;
      if (o && o.isScene) return o;
    }
    return null;
  }
  function register(id, group) {
    if (!group || !group.userData || !group.userData.fxState) return false;
    _instances[id] = group.userData.fxState;
    return true;
  }
  function unregister(id) { delete _instances[id]; }
  function listInstances() { return Object.keys(_instances); }

  /* ---- updateFx(obj): inspector đổi extra -> dựng lại Points. ----
     obj: project object {id, extra:{fxType,count,speed,color}}. */
  function updateFx(obj) {
    if (!obj || !obj.id) return null;
    var extra = validateExtra(obj.extra || {});
    obj.extra = extra;
    var meshes = ED.Viewport && ED.Viewport.meshes;
    var old = meshes && meshes[obj.id];
    var g = buildFx(extra.fxType, extra);
    if (old && old.parent) {
      g.position.copy(old.position);
      g.rotation.copy(old.rotation);
      g.scale.copy(old.scale);
      old.parent.add(g);
      old.parent.remove(old);
      if (old.userData && old.userData.fxState) unregister(obj.id);
    } else {
      var sc = findScene();
      if (sc) {
        var p = obj.pos || [0, 0, 0];
        g.position.set(p[0], p[1], p[2]);
        sc.add(g);
      }
    }
    if (meshes) meshes[obj.id] = g;
    register(obj.id, g);
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    return g;
  }

  /* Tạo object FX mới tại (x, z) — viewport/inspector gọi khi đặt FX. */
  function addFx(fxType, x, z) {
    var extra = validateExtra({ fxType: fxType });
    var obj = { type: 'fx', category: 'Effects', name: (TYPES[extra.fxType] || TYPES.fire).name,
      pos: [x, 0, z], rot: [0, 0, 0], scale: [1, 1, 1], extra: extra };
    if (ED.Core && typeof ED.Core.addObject === 'function') obj = ED.Core.addObject(obj) || obj;
    var g = buildFx(extra.fxType, extra);
    g.position.set(obj.pos[0], obj.pos[1], obj.pos[2]);
    var sc = findScene();
    if (sc) sc.add(g);
    if (ED.Viewport && ED.Viewport.meshes) ED.Viewport.meshes[obj.id] = g;
    register(obj.id, g);
    return { obj: obj, group: g };
  }

  /* Viewport gọi khi syncObject gặp type 'fx': trả group đã build + đăng ký. */
  function buildFxForObject(obj) {
    if (!obj) return null;
    var extra = validateExtra(obj.extra || {});
    obj.extra = extra;
    var g = buildFx(extra.fxType, extra);
    var p = obj.pos || [0, 0, 0];
    g.position.set(p[0], p[1], p[2]);
    if (obj.rot) g.rotation.set(obj.rot[0], obj.rot[1], obj.rot[2]);
    if (obj.scale) g.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);
    register(obj.id, g);
    return g;
  }

  function init() {
    if (typeof document === 'undefined') return;
    /* Không có panel riêng: FX chọn trong Asset Library (type fx-marker)
       và chỉnh trong Inspector (nhóm A gọi updateFx). init chỉ đồng bộ
       các FX đã có trong project (trường hợp reload). */
    var list = (ED.Core && typeof ED.Core.listObjects === 'function') ? ED.Core.listObjects() : [];
    list.forEach(function (o) {
      if (o && o.type === 'fx') buildFxForObject(o);
    });
  }

  return {
    TYPES: TYPES, listTypes: listTypes, defaults: defaults, validateExtra: validateExtra,
    prand: prand, buildFx: buildFx, buildFxForObject: buildFxForObject,
    addFx: addFx, updateFx: updateFx, tick: tick, findScene: findScene,
    register: register, unregister: unregister, listInstances: listInstances,
    init: init
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
