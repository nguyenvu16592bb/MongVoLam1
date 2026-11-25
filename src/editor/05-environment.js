/* ============================================================================
   Map Editor — 05-environment.js (nhóm B)
   ED.Environment — ngày/đêm (giờ 0-24 -> vị trí mặt trời/mặt trăng,
   directional light + màu trời + hemisphere), fog, weather mưa/tuyết
   (particle Points rơi), wind (viewport animation loop đọc
   ED.Environment.wind; cây/đèn đung đưa theo ED.Environment.sway()),
   preset thành cổ / rừng trúc / núi tuyết / chùa / võ đài.
   Đợt 3 — shadow thật (renderer.shadowMap PCFSoft + directional light
   castShadow/mapSize/bias + flag cast/receive theo type), fog nâng cấp
   (màu fog chỉnh được + fog theo chiều cao camera), mặt nước phản chiếu
   thật (THREE.Reflector r128 — viewport thay mặt phẳng bằng Reflector;
   module này chỉ giữ setting nước trong project.env).
   Đợt 5 — đèn diện tích gần đúng (THREE.RectAreaLight + lib
   RectAreaLightUniformsLib r128 vendored, preset "ánh sáng cửa sổ mềm";
   chỉ tác dụng lên vật liệu Standard/Physical của three.js r128) và
   lớp sương bay gần đúng (N mặt phẳng trong suốt với texture mây vẽ
   bằng canvas, trôi theo gió ở tầm thấp — GHI RÕ không phải volumetric
   fog thật). Cả hai lưu vào project.env.areaLight / project.env.fogLayers
   (mặc định tắt, project cũ không có field vẫn mở được).
   Đợt 6 — skybox procedural (vòm trời gradient theo giờ + mặt trời/mặt
   trăng + sao đêm + mây bay theo gió, toggle "Bật skybox") và thời tiết
   mới 'thunder' (mưa to + chớp sáng + SFX sấm qua ED.Export.playThunder)
   và 'sandstorm' (hạt cát vàng + fog vàng, dọn sạch khi đổi weather).
   Lưu vào project.env.skybox / project.env.thunderRate / env.weather
   (project cũ không có field vẫn mở được, weather cũ vẫn đọc được).
   Lưu tất cả vào project.env; đổi là markDirty + pushHistory GỘP
   (chỉ push khi thả slider/change, không push mỗi tick input).
   Logic thuần (computeSun, preset, sway, shadow/fog/water normalize)
   test được bằng vm, không cần THREE.
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level.
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Environment = (function () {
  'use strict';

  /* State nội bộ; đồng bộ 2 chiều với project.env qua syncFrom/ToProject.
     Đợt 3: shadow {enabled, mapSize, bias}, water {reflect, color, opacity},
     fogColor '' = theo màu trời, fogHeight 0..1 = độ mạnh của fog theo cao. */
  var _env = defaultEnv();
  var _scene = null, _sun = null, _moon = null, _hemi = null;
  var _weather = null; // {type, points, velocities:Float32Array, count}
  var _weatherTick = 0;
  var _fogLastY = null, _fogTick = 0; // throttle cập nhật fog theo chiều cao camera
  /* Đợt 5 — đèn diện tích + lớp sương bay. */
  var _areaLight = null; // THREE.RectAreaLight, tạo 1 lần khi bật
  var _rectAreaLibInit = false; // RectAreaLightUniformsLib.init() chỉ gọi 1 lần
  var _fogGroup = null; // THREE.Group chứa các mặt phẳng sương bay
  var _fogTexture = null; // CanvasTexture mây mờ, tạo 1 lần
  var _fogTime = 0; // thời gian tích luỹ cho lớp sương trôi theo gió
  /* Đợt 6 — skybox procedural + chớp sấm. */
  var _skyGroup = null; // THREE.Group: vòm trời + mặt trời/mặt trăng + sao + mây
  var _skyDome = null, _skySun = null, _skyMoon = null, _skyStars = null;
  var _skyClouds = []; // mesh mây, vị trí cập nhật trong tick()
  var _cloudTime = 0; // thời gian tích luỹ cho mây bay theo gió
  var _flashEl = null; // div overlay trắng mờ toàn viewport, chớp sấm
  var _thunder = null; // {rng, nextIn, flashLeft, flashLight, baseIntensity}
  var _sandFogSaved = false; // true khi fog đang bị sandstorm ghi đè

  var PRESETS = {
    'thanh-co': { name: 'Thành cổ', timeOfDay: 10, fog: 0.008, weather: 'none', wind: 0.3, skyColor: '#87b5d6',
      assets: [{ type: 'house', dx: -6, dz: 0 }, { type: 'house', dx: 6, dz: 0 }, { type: 'gate', dx: 0, dz: -8 }, { type: 'lantern', dx: -3, dz: 4 }, { type: 'lantern', dx: 3, dz: 4 }] },
    'rung-truc': { name: 'Rừng trúc', timeOfDay: 9, fog: 0.02, weather: 'none', wind: 0.8, skyColor: '#9db98a',
      fogColor: '#a8bf9a', fogHeight: 0.7,
      assets: [{ type: 'bamboo', dx: -6, dz: -4 }, { type: 'bamboo', dx: -4, dz: 2 }, { type: 'bamboo', dx: 5, dz: -3 }, { type: 'bamboo', dx: 6, dz: 4 }, { type: 'rock', dx: 0, dz: 6 }, { type: 'grass', dx: -2, dz: 5 }] },
    'nui-tuyet': { name: 'Núi tuyết', timeOfDay: 11, fog: 0.015, weather: 'snow', wind: 0.6, skyColor: '#cfdce8',
      fogColor: '#dfe9f2', fogHeight: 0.8,
      assets: [{ type: 'rock', dx: -5, dz: -3 }, { type: 'rock', dx: 4, dz: -5 }, { type: 'rock', dx: 6, dz: 3 }, { type: 'tree', dx: -2, dz: 4 }] },
    'chua': { name: 'Chùa', timeOfDay: 17, fog: 0.012, weather: 'none', wind: 0.2, skyColor: '#e8b07a',
      assets: [{ type: 'temple', dx: 0, dz: -6 }, { type: 'lantern', dx: -4, dz: 0 }, { type: 'lantern', dx: 4, dz: 0 }, { type: 'flower', dx: -2, dz: 4 }, { type: 'flower', dx: 2, dz: 4 }] },
    'vo-dai': { name: 'Võ đài', timeOfDay: 13, fog: 0.005, weather: 'none', wind: 0.4, skyColor: '#8ec3e8',
      assets: [{ type: 'tower', dx: 0, dz: -8 }, { type: 'table', dx: -4, dz: 2 }, { type: 'chair', dx: -4, dz: 4 }, { type: 'lantern', dx: 5, dz: 2 }, { type: 'lantern', dx: 5, dz: -2 }] }
  };
  var WEATHER_COUNTS = { rain: 800, snow: 500, thunder: 2000, sandstorm: 600 };
  /* Đợt 6 — weather hợp lệ (mở rộng từ 'rain'|'snow'|'none'). */
  var WEATHER_TYPES = ['none', 'rain', 'snow', 'thunder', 'sandstorm'];
  /* Weather lạ -> 'none' (project cũ chỉ có none/rain/snow vẫn đọc được). Thuần. */
  function normalizeWeather(w) {
    return WEATHER_TYPES.indexOf(w) >= 0 ? w : 'none';
  }

  /* ---- Toán thuần: lerp màu hex, vị trí mặt trời. ---- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function hexToRgb(h) {
    h = String(h || '#000000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return [0, 0, 0];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function rgbToHex(rgb) {
    function c(v) { var s = Math.round(clamp(v, 0, 1) * 255).toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + c(rgb[0]) + c(rgb[1]) + c(rgb[2]);
  }
  function lerpColor(a, b, t) {
    var ca = hexToRgb(a), cb = hexToRgb(b);
    return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
  }
  /* computeSun(hour) -> thuần: hướng mặt trời/mặt trăng + màu + cường độ.
     6h mọc, 12h đỉnh, 18h lặn. Đêm: mặt trăng mờ, trời tối. */
  function computeSun(hour) {
    hour = ((Number(hour) || 0) % 24 + 24) % 24;
    var dayT = (hour - 6) / 12; // 0 lúc 6h, 1 lúc 18h
    var isDay = hour >= 6 && hour < 18;
    var ang = dayT * Math.PI; // 0..PI ban ngày
    var elev = Math.sin(ang); // 0 chân trời -> 1 đỉnh
    var sunDir = [Math.cos(ang) * 0.7, Math.max(0.05, elev), 0.5];
    var warmth = clamp(1 - elev * 1.6, 0, 1); // thấp -> vàng cam hoàng hôn
    var sunColor = isDay ? lerpColor('#ffd9a0', '#fff3d6', clamp(elev * 1.4, 0, 1)) : '#b9c8e8';
    var sunIntensity = isDay ? 0.35 + elev * 0.85 : 0.12;
    var skyColor, hemiIntensity;
    if (isDay) {
      skyColor = lerpColor('#e8a06a', '#87b5d6', clamp(elev * 1.5, 0, 1));
      hemiIntensity = 0.45 + elev * 0.35;
    } else {
      var nightT = hour < 6 ? (6 - hour) / 6 : (hour - 18) / 6; // 0 lúc 18h/6h -> 1 nửa đêm
      skyColor = lerpColor('#1d2b4a', '#0a1128', clamp(nightT, 0, 1));
      hemiIntensity = 0.18;
    }
    return { isDay: isDay, hour: hour, sunDir: sunDir, sunColor: sunColor,
      sunIntensity: +sunIntensity.toFixed(3), skyColor: skyColor,
      hemiIntensity: +hemiIntensity.toFixed(3), warmth: +warmth.toFixed(3) };
  }
  /* Góc đung đưa theo gió: viewport gọi mỗi frame cho cây/đèn (userData.sway).
     Thuần, test được. amp cơ bản 0.02 rad * (0.2 + wind). */
  function sway(time, phase, amp) {
    amp = (amp == null ? 0.02 : amp) * (0.2 + getEnv().wind);
    return Math.sin(time * 1.8 + (phase || 0)) * amp;
  }

  /* ---- Đợt 3 — logic thuần: shadow / fog nâng cấp / nước. ---- */
  function _merge(a, b) {
    var out = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    if (b) for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k];
    return out;
  }
  /* Shadow mặc định cho project cũ (chưa có field shadow): bật, 1024, bias 0. */
  function defaultShadow() { return { enabled: true, mapSize: 1024, bias: 0 }; }
  /* Chuẩn hoá setting shadow: mapSize chỉ 512/1024/2048 (lạ -> 1024),
     bias kẹp -0.005..0.005. Thuần. */
  function normalizeShadow(input) {
    var d = defaultShadow();
    if (!input || typeof input !== 'object') return d;
    var out = { enabled: d.enabled, mapSize: d.mapSize, bias: d.bias };
    if (input.enabled != null) out.enabled = !!input.enabled;
    if (input.mapSize != null) {
      var s = Number(input.mapSize);
      out.mapSize = (s === 512 || s === 2048) ? s : 1024;
    }
    if (input.bias != null) {
      var b = Number(input.bias);
      out.bias = isFinite(b) ? clamp(b, -0.005, 0.005) : 0;
    }
    return out;
  }
  /* Mô tả những gì applyShadows() sẽ áp lên renderer + directional light.
     Thuần — test assert trên object này thay vì cần WebGL thật. */
  function computeShadowSettings(shadow) {
    var s = normalizeShadow(shadow);
    return { enabled: s.enabled, mapSize: s.mapSize, bias: s.bias,
      shadowMapType: 'PCFSoftShadowMap',
      shadowCamera: { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 } };
  }
  /* Quy tắc cast/receive theo type (đợt 3). Mesh nào 03-assets đã gán
     cast/receive = true thì applyShadowFlags GIỮ nguyên (chỉ bật thêm,
     không tắt) — xem applyShadowFlags. */
  var SHADOW_FLAGS = {
    terrain: { cast: false, receive: true },
    house: { cast: true, receive: true }, temple: { cast: true, receive: true },
    tower: { cast: true, receive: true }, gate: { cast: true, receive: true },
    bridge: { cast: true, receive: true },
    tree: { cast: true, receive: true }, bamboo: { cast: true, receive: true },
    rock: { cast: true, receive: true }, lantern: { cast: true, receive: true },
    table: { cast: true, receive: true }, chair: { cast: true, receive: true },
    prop: { cast: true, receive: true },
    character: { cast: true, receive: false }, npc: { cast: true, receive: false },
    monster: { cast: true, receive: false }, imported: { cast: true, receive: false },
    water: { cast: false, receive: false }, waterfall: { cast: false, receive: false },
    grass: { cast: false, receive: false },
    flower: { cast: false, receive: false }, fx: { cast: false, receive: false },
    light: { cast: false, receive: false }, collider: { cast: false, receive: false },
    waypoint: { cast: false, receive: false }, group: { cast: false, receive: false }
  };
  function computeShadowFlags(type) {
    var f = SHADOW_FLAGS[type];
    return f ? { cast: f.cast, receive: f.receive } : { cast: true, receive: false };
  }
  /* Nước mặc định: phản chiếu bật, màu xanh hồ, độ trong 0.85. */
  function defaultWater() { return { reflect: true, color: '#4da39e', opacity: 0.85 }; }
  /* Chuẩn hoá setting nước: opacity kẹp 0.1..1. Thuần. */
  function normalizeWater(input) {
    var d = defaultWater();
    if (!input || typeof input !== 'object') return d;
    var out = { reflect: d.reflect, color: d.color, opacity: d.opacity };
    if (input.reflect != null) out.reflect = !!input.reflect;
    if (input.color) out.color = String(input.color);
    if (input.opacity != null) {
      var o = Number(input.opacity);
      out.opacity = isFinite(o) ? clamp(o, 0.1, 1) : d.opacity;
    }
    return out;
  }
  /* Màu fog thực dùng: fogColor rỗng = theo màu trời. Thuần. */
  function resolveFogColor(fogColor, skyColor) {
    return (fogColor && String(fogColor).trim() !== '') ? String(fogColor) : (skyColor || '#87b5d6');
  }
  /* Fog nâng cấp (thuần): mật độ -> near/far như cũ; chiều cao camera càng
     cao thì fog càng loãng — far dài thêm (tối đa +120%) và màu fog trộn dần
     về màu trời. camY: độ cao camera (m); heightStrength 0..1 (0 = tắt
     hiệu ứng chiều cao). Không phải volumetric fog thật: chỉ là 1 lớp
     THREE.Fog tuyến tính, đổi màu + tầm xa theo độ cao camera. */
  function computeFog(density, fogColor, skyColor, camY, heightStrength) {
    density = clamp(Number(density) || 0, 0, 0.08);
    if (density <= 0) return { enabled: false, color: null, near: 0, far: 0, heightFactor: 0 };
    var baseFar = 30 + Math.max(10, 1 / Math.max(density, 0.001) * 0.9);
    var h = clamp((Number(camY) || 0) / 40, 0, 1) * clamp(Number(heightStrength) || 0, 0, 1);
    var resolved = resolveFogColor(fogColor, skyColor);
    var color = lerpColor(resolved, skyColor || '#87b5d6', h * 0.5);
    return { enabled: true, color: color, near: 30,
      far: +(baseFar * (1 + h * 1.2)).toFixed(1), heightFactor: +h.toFixed(3) };
  }

  /* ---- Đợt 5 — logic thuần: đèn diện tích + lớp sương bay. ---- */
  /* Preset đèn diện tích duy nhất đợt 5: "ánh sáng cửa sổ mềm" — rect light
     đặt nghiêng một bên, cao ~7m, chiếu xiên xuống tâm cảnh như nắng qua
     cửa sổ, màu ấm, cường độ vừa. position/target theo toạ độ world. */
  var AREA_LIGHT_PRESETS = {
    window: { name: 'Ánh sáng cửa sổ mềm', color: '#ffd9a0', intensity: 2,
      width: 4, height: 3, position: [14, 7, 8], target: [0, 1, 0] }
  };
  /* Đèn diện tích mặc định: TẮT (project cũ không có field areaLight sẽ
     nhận mặc định này qua defaultEnv, không đổi cảnh cũ). */
  function defaultAreaLight() {
    return { enabled: false, color: '#ffd9a0', intensity: 2, width: 4, height: 3, preset: 'window' };
  }
  /* Chuẩn hoá param đèn diện tích (thuần, test được bằng vm):
     intensity kẹp 0..5, width/height kẹp 1..10, preset lạ -> 'window'. */
  function edEnvAreaLightNormalize(input) {
    var d = defaultAreaLight();
    if (!input || typeof input !== 'object') return d;
    var out = { enabled: d.enabled, color: d.color, intensity: d.intensity,
      width: d.width, height: d.height, preset: d.preset };
    if (input.enabled != null) out.enabled = !!input.enabled;
    if (input.color) out.color = String(input.color);
    if (input.intensity != null) {
      var it = Number(input.intensity);
      out.intensity = isFinite(it) ? clamp(it, 0, 5) : d.intensity;
    }
    if (input.width != null) {
      var w = Number(input.width);
      out.width = isFinite(w) ? clamp(w, 1, 10) : d.width;
    }
    if (input.height != null) {
      var h = Number(input.height);
      out.height = isFinite(h) ? clamp(h, 1, 10) : d.height;
    }
    if (input.preset) out.preset = AREA_LIGHT_PRESETS[input.preset] ? input.preset : 'window';
    return out;
  }
  /* Vị trí + hướng đặt đèn theo preset (thuần). Trả bản sao để caller
     sửa không làm bẩn preset gốc. */
  function computeAreaLightPose(preset) {
    var p = AREA_LIGHT_PRESETS[preset] || AREA_LIGHT_PRESETS.window;
    return { preset: preset && AREA_LIGHT_PRESETS[preset] ? preset : 'window',
      name: p.name, color: p.color, intensity: p.intensity, width: p.width, height: p.height,
      position: p.position.slice(), target: p.target.slice() };
  }
  /* Lớp sương bay mặc định: TẮT (project cũ không có field fogLayers sẽ
     nhận mặc định này, không đổi cảnh cũ). */
  function defaultFogLayers() { return { enabled: false, count: 6, height: 1.2, opacity: 0.35 }; }
  /* Chuẩn hoá setting lớp sương: count nguyên 0..12, height 0..5, opacity 0..1. Thuần. */
  function normalizeFogLayers(input) {
    var d = defaultFogLayers();
    if (!input || typeof input !== 'object') return d;
    var out = { enabled: d.enabled, count: d.count, height: d.height, opacity: d.opacity };
    if (input.enabled != null) out.enabled = !!input.enabled;
    if (input.count != null) {
      var c = Number(input.count);
      out.count = isFinite(c) ? Math.floor(clamp(c, 0, 12)) : d.count;
    }
    if (input.height != null) {
      var h = Number(input.height);
      out.height = isFinite(h) ? clamp(h, 0, 5) : d.height;
    }
    if (input.opacity != null) {
      var o = Number(input.opacity);
      out.opacity = isFinite(o) ? clamp(o, 0, 1) : d.opacity;
    }
    return out;
  }
  /* Hash giả-ngẫu nhiên xác định theo (index, salt): vị trí gốc của mỗi lớp
     sương cố định theo index, không dùng Math.random (build cấm random,
     test lặp lại được). Trả [0,1). */
  function _hash01(i, salt) {
    var s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  /* Cuộn 1 toạ độ vào [-48, 48] (khổ cảnh 96m): lớp sương trôi ra khỏi biên
     sẽ xuất hiện lại ở biên đối diện, bay mãi không hết. */
  function _wrap48(v) {
    var r = (v + 48) % 96;
    if (r < 0) r += 96;
    return r - 48;
  }
  /* Chuẩn hoá hướng gió thành vector vận tốc trôi [vx, vz] (m/s):
     mảng [x, z] hoặc {x, z} = vận tốc trực tiếp; số = góc radian (hướng
     đơn vị, tốc độ 1 m/s); thiếu/không hợp lệ = gió +x 1 m/s. */
  function _windVec(windDir) {
    if (Array.isArray(windDir) && windDir.length >= 2) {
      return [Number(windDir[0]) || 0, Number(windDir[1]) || 0];
    }
    if (windDir && typeof windDir === 'object') {
      return [Number(windDir.x) || 0, Number(windDir.z) || 0];
    }
    var a = Number(windDir);
    if (isFinite(a)) return [Math.cos(a), Math.sin(a)];
    return [1, 0];
  }
  /* Vị trí các lớp sương tại thời điểm t (thuần, test được bằng vm):
     vị trí gốc xác định theo index + trôi theo vector gió * t (cuộn biên),
     y = height + 0..0.8 (lệch nhẹ theo lớp để không phẳng đơ). Trả đúng
     `count` phần tử {x, y, z}; count 0 -> []. */
  function edEnvFogLayerPositions(count, height, t, windDir) {
    count = Math.floor(clamp(Number(count) || 0, 0, 12));
    height = clamp(Number(height) || 0, 0, 5);
    t = Number(t) || 0;
    var w = _windVec(windDir);
    var out = [];
    for (var i = 0; i < count; i++) {
      var bx = (_hash01(i, 1) * 2 - 1) * 44;
      var bz = (_hash01(i, 2) * 2 - 1) * 44;
      out.push({
        x: +_wrap48(bx + w[0] * t).toFixed(3),
        y: +(height + _hash01(i, 3) * 0.8).toFixed(3),
        z: +_wrap48(bz + w[1] * t).toFixed(3)
      });
    }
    return out;
  }

  /* ---- Đợt 6 — logic thuần: skybox + mây bay + lịch chớp sấm. ---- */
  /* PRNG xác định mulberry32: cùng seed -> cùng dãy số [0,1). Thuần. */
  function edEnvMulberry32(seed) {
    var a = (Number(seed) || 0) >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /* Màu vòm trời theo giờ (thuần, test được bằng vm): nội suy tuyến tính
     giữa các mốc giờ. 0h đêm tối sao nhiều, 6h bình minh cam, 12h trưa
     xanh sáng, 18h hoàng hôn cam đỏ, 24h = 0h. Trả top/bottom [r,g,b]
     0..1, sunColor hex, starOpacity 0..1, cloudColor hex. */
  var SKY_KEYS = [
    { h: 0,  top: [0.02, 0.03, 0.10], bottom: [0.05, 0.08, 0.18], sun: '#b9c8e8', stars: 1.0, cloud: '#2a3450' },
    { h: 5,  top: [0.03, 0.05, 0.14], bottom: [0.10, 0.13, 0.26], sun: '#b9c8e8', stars: 0.9, cloud: '#3a4460' },
    { h: 6,  top: [0.25, 0.32, 0.55], bottom: [0.98, 0.55, 0.30], sun: '#ffb066', stars: 0.15, cloud: '#e8a06a' },
    { h: 8,  top: [0.35, 0.58, 0.85], bottom: [0.75, 0.82, 0.90], sun: '#ffd9a0', stars: 0, cloud: '#ffffff' },
    { h: 12, top: [0.20, 0.50, 0.90], bottom: [0.65, 0.82, 0.95], sun: '#fff3d6', stars: 0, cloud: '#ffffff' },
    { h: 17, top: [0.30, 0.55, 0.85], bottom: [0.85, 0.85, 0.80], sun: '#ffe0a0', stars: 0, cloud: '#ffffff' },
    { h: 18, top: [0.30, 0.30, 0.55], bottom: [1.00, 0.50, 0.25], sun: '#ff9a4d', stars: 0.15, cloud: '#f2a56b' },
    { h: 20, top: [0.05, 0.07, 0.20], bottom: [0.12, 0.15, 0.32], sun: '#b9c8e8', stars: 0.9, cloud: '#3a4460' },
    { h: 24, top: [0.02, 0.03, 0.10], bottom: [0.05, 0.08, 0.18], sun: '#b9c8e8', stars: 1.0, cloud: '#2a3450' }
  ];
  function skyColorsForHour(hour) {
    hour = ((Number(hour) || 0) % 24 + 24) % 24;
    var a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
    for (var i = 0; i < SKY_KEYS.length - 1; i++) {
      if (hour >= SKY_KEYS[i].h && hour <= SKY_KEYS[i + 1].h) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
    }
    var span = (b.h - a.h) || 1;
    var t = clamp((hour - a.h) / span, 0, 1);
    function mix3(u, v) {
      return [+((u[0] + (v[0] - u[0]) * t).toFixed(3)),
        +((u[1] + (v[1] - u[1]) * t).toFixed(3)),
        +((u[2] + (v[2] - u[2]) * t).toFixed(3))];
    }
    return {
      top: mix3(a.top, b.top),
      bottom: mix3(a.bottom, b.bottom),
      sunColor: t < 0.5 ? a.sun : b.sun,
      starOpacity: +((a.stars + (b.stars - a.stars) * t).toFixed(3)),
      cloudColor: t < 0.5 ? a.cloud : b.cloud
    };
  }
  /* Vị trí các đám mây tại thời điểm t (thuần, test được bằng vm):
     cùng pattern với edEnvFogLayerPositions đợt 5 — vị trí gốc xác định
     theo index + trôi theo vector gió * t (cuộn biên ±48), y cao 20..28m
     (trên đầu cảnh, khác lớp sương bay tầm thấp). Trả đúng `count`
     phần tử {x, y, z}; count 0 -> []. */
  function edEnvCloudPositions(count, t, windDir) {
    count = Math.floor(clamp(Number(count) || 0, 0, 12));
    t = Number(t) || 0;
    var w = _windVec(windDir);
    var out = [];
    for (var i = 0; i < count; i++) {
      var bx = (_hash01(i, 11) * 2 - 1) * 44;
      var bz = (_hash01(i, 12) * 2 - 1) * 44;
      out.push({
        x: +_wrap48(bx + w[0] * t).toFixed(3),
        y: +(20 + _hash01(i, 13) * 8).toFixed(3),
        z: +_wrap48(bz + w[1] * t).toFixed(3)
      });
    }
    return out;
  }
  /* Lịch chớp sấm xác định (thuần, test được bằng vm): cùng seed ->
     cùng danh sách thời điểm (giây). Chớp đầu sau 2–6s, các chớp sau
     cách nhau 4–12s (chia cho rate: rate càng cao chớp càng dày).
     durationSec <= 0 -> []. */
  function thunderFlashSchedule(seed, durationSec, rate) {
    var rng = edEnvMulberry32(seed);
    rate = clamp(Number(rate) || 1, 0.5, 2);
    var dur = Math.max(0, Number(durationSec) || 0);
    var out = [];
    var t = 2 + rng() * 4;
    while (t <= dur) {
      out.push(+t.toFixed(3));
      t += (4 + rng() * 8) / rate;
    }
    return out;
  }

  /* ---- State + đồng bộ project.env ---- */
  function getEnv() {
    return { timeOfDay: _env.timeOfDay, fog: _env.fog, weather: _env.weather, wind: _env.wind,
      preset: _env.preset, skyColor: _env.skyColor, fogColor: _env.fogColor, fogHeight: _env.fogHeight,
      shadow: { enabled: _env.shadow.enabled, mapSize: _env.shadow.mapSize, bias: _env.shadow.bias },
      water: { reflect: _env.water.reflect, color: _env.water.color, opacity: _env.water.opacity },
      areaLight: { enabled: _env.areaLight.enabled, color: _env.areaLight.color,
        intensity: _env.areaLight.intensity, width: _env.areaLight.width,
        height: _env.areaLight.height, preset: _env.areaLight.preset },
      fogLayers: { enabled: _env.fogLayers.enabled, count: _env.fogLayers.count,
        height: _env.fogLayers.height, opacity: _env.fogLayers.opacity },
      skybox: _env.skybox, thunderRate: _env.thunderRate };
  }
  function getWind() { return _env.wind; }
  function getShadow() { return { enabled: _env.shadow.enabled, mapSize: _env.shadow.mapSize, bias: _env.shadow.bias }; }
  function getWater() { return { reflect: _env.water.reflect, color: _env.water.color, opacity: _env.water.opacity }; }
  function getAreaLight() {
    return { enabled: _env.areaLight.enabled, color: _env.areaLight.color,
      intensity: _env.areaLight.intensity, width: _env.areaLight.width,
      height: _env.areaLight.height, preset: _env.areaLight.preset };
  }
  function getFogLayers() {
    return { enabled: _env.fogLayers.enabled, count: _env.fogLayers.count,
      height: _env.fogLayers.height, opacity: _env.fogLayers.opacity };
  }
  function setEnv(partial, opts) {
    opts = opts || {};
    if (!partial) return getEnv();
    if (partial.timeOfDay != null) _env.timeOfDay = clamp(Number(partial.timeOfDay) || 0, 0, 24);
    if (partial.fog != null) _env.fog = clamp(Number(partial.fog) || 0, 0, 0.08);
    if (partial.weather) _env.weather = normalizeWeather(partial.weather);
    if (partial.skybox != null) _env.skybox = !!partial.skybox;
    if (partial.thunderRate != null) _env.thunderRate = clamp(Number(partial.thunderRate) || 1, 0.5, 2);
    if (partial.wind != null) _env.wind = clamp(Number(partial.wind) || 0, 0, 1);
    if (partial.preset) _env.preset = partial.preset;
    if (partial.skyColor) _env.skyColor = partial.skyColor;
    if (partial.fogColor != null) _env.fogColor = String(partial.fogColor);
    if (partial.fogHeight != null) _env.fogHeight = clamp(Number(partial.fogHeight) || 0, 0, 1);
    if (partial.shadow) _env.shadow = normalizeShadow(_merge(_env.shadow, partial.shadow));
    if (partial.water) _env.water = normalizeWater(_merge(_env.water, partial.water));
    if (partial.areaLight) _env.areaLight = edEnvAreaLightNormalize(_merge(_env.areaLight, partial.areaLight));
    if (partial.fogLayers) _env.fogLayers = normalizeFogLayers(_merge(_env.fogLayers, partial.fogLayers));
    if (opts.commit !== false) { syncToProject(); applyToScene(); }
    if (opts.dirty !== false && ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    if (opts.history && ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(opts.history);
    return getEnv();
  }
  function syncFromProject() {
    var p = ED.Core && typeof ED.Core.getProject === 'function' ? ED.Core.getProject() : null;
    if (!p) p = ED.Core && ED.Core.project;
    if (!p || !p.env) return false;
    /* Reset về mặc định trước rồi mới áp env của project — project cũ
       thiếu field shadow/water/fogColor/fogHeight sẽ nhận mặc định đợt 3
       thay vì dính setting của project mở trước đó. */
    _env = defaultEnv();
    setEnv(p.env, { commit: false, dirty: false });
    if (ED.Viewport && typeof ED.Viewport.refreshWater === 'function') {
      try { ED.Viewport.refreshWater(); } catch (e) {}
    }
    return true;
  }
  function syncToProject() {
    var p = ED.Core && typeof ED.Core.getProject === 'function' ? ED.Core.getProject() : null;
    if (!p) p = ED.Core && ED.Core.project;
    if (!p) return false;
    p.env = getEnv();
    return true;
  }
  function defaultEnv() {
    return { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co', skyColor: '#87b5d6',
      fogColor: '', fogHeight: 0.5, shadow: defaultShadow(), water: defaultWater(),
      areaLight: defaultAreaLight(), fogLayers: defaultFogLayers(),
      skybox: true, thunderRate: 1 };
  }

  /* ---- Áp dụng env lên scene thật (cần THREE + viewport). ----
     Viewport chưa expose ED.Viewport.scene nên tìm scene qua meshes:
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
  function applyToScene() {
    if (typeof THREE === 'undefined') return false;
    var scene = findScene();
    if (!scene) return false;
    _scene = scene;
    var sun = computeSun(_env.timeOfDay);
    if (!_sun) {
      _sun = new THREE.DirectionalLight(0xffffff, 1);
      _sun.position.set(30, 40, 20); _sun.castShadow = true;
      scene.add(_sun);
      _moon = new THREE.DirectionalLight(0xb9c8e8, 0.12);
      _moon.position.set(-20, 30, -10);
      scene.add(_moon);
      _hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.6);
      scene.add(_hemi);
    }
    _sun.position.set(sun.sunDir[0] * 60, Math.max(4, sun.sunDir[1] * 60), sun.sunDir[2] * 60);
    _sun.color.set(sun.sunColor);
    _sun.intensity = sun.sunIntensity;
    _sun.visible = sun.isDay;
    _moon.visible = !sun.isDay;
    _moon.intensity = sun.isDay ? 0 : 0.18;
    _hemi.intensity = sun.hemiIntensity;
    var sky = _env.skyColor || sun.skyColor;
    /* Đợt 6 — skybox bật thì vòm trời che hết nền (background = null),
       tắt thì về màu nền renderer cũ như trước. */
    updateSky(sun, sky);
    var camY = 10;
    try {
      var _cam = ED.Viewport && typeof ED.Viewport.getCamera === 'function' ? ED.Viewport.getCamera() : null;
      if (_cam && _cam.position) camY = _cam.position.y;
    } catch (e) {}
    var f = computeFog(_env.fog, _env.fogColor, sky, camY, _env.fogHeight);
    if (f.enabled) {
      scene.fog = new THREE.Fog(new THREE.Color(f.color), f.near, f.far);
    } else {
      scene.fog = null;
    }
    _fogLastY = camY;
    applyShadows();
    applyAreaLight();
    applyFogLayers();
    setWeather(_env.weather);
    return true;
  }
  /* ---- Đợt 5 — đèn diện tích + lớp sương bay (áp lên scene thật). ---- */
  /* Lib RectAreaLight đã nối vào build chưa? Chưa nối thì panel khoá nút
     bật (không vẽ nút giả chạy không thật); đèn vẫn tạo được bằng
     THREE.RectAreaLight nhưng thiếu LTC texture nên không sáng. */
  function hasRectAreaLib() {
    return (typeof THREE !== 'undefined' && !!THREE.RectAreaLight &&
      !!THREE.RectAreaLightUniformsLib);
  }
  /* Gọi RectAreaLightUniformsLib.init() 1 lần (dự phòng khi Viewport.init
     chưa gọi — boot chạy Viewport trước Environment nên thường Viewport
     đã init rồi; gọi lại lần 2 chỉ thay texture LTC, không crash). */
  function ensureRectAreaLib() {
    if (_rectAreaLibInit) return true;
    if (typeof THREE === 'undefined' || !THREE.RectAreaLightUniformsLib ||
        typeof THREE.RectAreaLightUniformsLib.init !== 'function') return false;
    try {
      THREE.RectAreaLightUniformsLib.init();
      _rectAreaLibInit = true;
      return true;
    } catch (e) { return false; }
  }
  /* Tạo 1 lần + cập nhật đèn diện tích theo _env.areaLight (preset window:
     đặt nghiêng như nắng qua cửa sổ, lookAt về tâm cảnh). Tắt = ẩn đèn
     (giữ object để bật lại không tạo mới). Trả false khi chưa có scene
     hoặc THREE.RectAreaLight không có trong bản build. */
  function applyAreaLight() {
    if (typeof THREE === 'undefined') return false;
    var scene = _scene || findScene();
    if (!scene) return false;
    var a = _env.areaLight;
    if (!_areaLight) {
      if (!a.enabled || !THREE.RectAreaLight) return false;
      ensureRectAreaLib();
      _areaLight = new THREE.RectAreaLight(0xffffff, 1, 1, 1);
      scene.add(_areaLight);
    }
    var pose = computeAreaLightPose(a.preset);
    _areaLight.visible = !!a.enabled;
    _areaLight.color.set(a.color);
    _areaLight.intensity = a.intensity;
    _areaLight.width = a.width;
    _areaLight.height = a.height;
    _areaLight.position.set(pose.position[0], pose.position[1], pose.position[2]);
    _areaLight.lookAt(pose.target[0], pose.target[1], pose.target[2]);
    return true;
  }
  /* Vận tốc trôi của lớp sương theo gió của env (m/s): hướng +x chủ đạo,
     tốc độ tăng theo env.wind (0.5..3 m/s), lệch nhẹ +z cho đỡ thẳng đơ. */
  function _fogWindVec() {
    var speed = 0.5 + _env.wind * 2.5;
    return [speed, speed * 0.15];
  }
  /* Texture mây mờ vẽ bằng canvas (vài đốm radial-gradient trắng, viền
     mờ dần về 0): dùng chung cho mọi lớp sương, tạo 1 lần. Trả null khi
     không có document/THREE (test vm) — khi đó applyFogLayers bỏ qua. */
  function buildFogTexture() {
    if (typeof document === 'undefined' || typeof THREE === 'undefined') return null;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    var ctx = cv.getContext('2d');
    if (!ctx) return null;
    var blobs = [[64, 64, 58], [128, 56, 66], [192, 68, 54], [96, 84, 44], [160, 88, 46], [128, 40, 40]];
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var g = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 128);
    }
    return new THREE.CanvasTexture(cv);
  }
  /* Dựng lại nhóm lớp sương theo _env.fogLayers: N mặt phẳng nằm ngang
     (rotation.x = -PI/2), texture mây, opacity thấp, depthWrite tắt để
     các lớp chồng nhau không xén nhau. Tắt hoặc count 0 = gỡ nhóm. */
  function applyFogLayers() {
    if (typeof THREE === 'undefined') return false;
    var scene = _scene || findScene();
    if (!scene) return false;
    var f = _env.fogLayers;
    if (_fogGroup) {
      scene.remove(_fogGroup);
      _fogGroup.traverse(function (c) {
        if (c && c.isMesh) {
          if (c.geometry) c.geometry.dispose();
          if (c.material) c.material.dispose();
        }
      });
      _fogGroup = null;
    }
    if (!f.enabled || f.count <= 0) return true;
    if (!_fogTexture) _fogTexture = buildFogTexture();
    if (!_fogTexture) return false;
    _fogGroup = new THREE.Group();
    _fogGroup.name = 'ed-fog-layers';
    var pos = edEnvFogLayerPositions(f.count, f.height, _fogTime, _fogWindVec());
    for (var i = 0; i < pos.length; i++) {
      var w = 18 + _hash01(i, 4) * 14, d = 10 + _hash01(i, 5) * 8;
      var geo = new THREE.PlaneGeometry(w, d);
      var mat = new THREE.MeshBasicMaterial({ map: _fogTexture, transparent: true,
        opacity: f.opacity, depthWrite: false, side: THREE.DoubleSide, fog: false });
      var m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = _hash01(i, 6) * Math.PI;
      m.position.set(pos[i].x, pos[i].y, pos[i].z);
      m.renderOrder = 5;
      _fogGroup.add(m);
    }
    scene.add(_fogGroup);
    return true;
  }
  /* Bật/tắt flag cast/receive cho 1 group theo type của object.
     CHỈ BẬT THÊM, không tắt flag mesh đã có (03-assets đã gán castShadow
     cho nhiều mesh — giữ nguyên). Viewport.syncObject gọi hàm này mỗi khi
     sync 1 object mới. Bỏ qua mesh Reflector nước (shader không nhận bóng). */
  function applyShadowFlags(group, obj) {
    if (!group || typeof group.traverse !== 'function') return false;
    var flags = computeShadowFlags(obj && obj.type);
    group.traverse(function (c) {
      if (!c || !c.isMesh) return;
      if (c.userData && c.userData.isWaterReflector) return;
      if (flags.cast) c.castShadow = true;
      if (flags.receive) c.receiveShadow = true;
    });
    return true;
  }
  /* Áp shadow thật lên renderer + đèn mặt trời/mặt trăng + toàn scene.
     Đổi mapSize phải dispose shadow map cũ để three.js tạo lại đúng cỡ. */
  function applyShadows() {
    if (typeof THREE === 'undefined') return false;
    var s = computeShadowSettings(_env.shadow);
    var renderer = null;
    try {
      renderer = ED.Viewport && ED.Viewport.renderer;
      if (!renderer && ED.Viewport && typeof ED.Viewport.getRenderer === 'function') renderer = ED.Viewport.getRenderer();
    } catch (e) {}
    if (renderer && renderer.shadowMap) {
      if (renderer.shadowMap.enabled !== s.enabled) {
        renderer.shadowMap.enabled = s.enabled;
        /* r128: đổi shadowMap.enabled cần biên dịch lại material. */
        if (_scene) {
          _scene.traverse(function (o) {
            if (o && o.isMesh && o.material) {
              var ms = Array.isArray(o.material) ? o.material : [o.material];
              ms.forEach(function (m) { m.needsUpdate = true; });
            }
          });
        }
      }
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.needsUpdate = true;
    }
    [_sun, _moon].forEach(function (light) {
      if (!light || !light.shadow) return;
      light.castShadow = s.enabled;
      if (light.shadow.mapSize.x !== s.mapSize || light.shadow.mapSize.y !== s.mapSize) {
        light.shadow.mapSize.set(s.mapSize, s.mapSize);
        if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
      }
      light.shadow.bias = s.bias;
      var cam = light.shadow.camera;
      if (cam) {
        cam.left = s.shadowCamera.left; cam.right = s.shadowCamera.right;
        cam.top = s.shadowCamera.top; cam.bottom = s.shadowCamera.bottom;
        cam.near = s.shadowCamera.near; cam.far = s.shadowCamera.far;
        if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
      }
    });
    /* Flag cho mọi mesh trong scene (tìm objectId bằng cách đi lên parent). */
    if (_scene) {
      _scene.traverse(function (o) {
        if (!o || !o.isMesh) return;
        if (o.userData && o.userData.isWaterReflector) return;
        var p = o, id = null;
        while (p) {
          if (p.userData && p.userData.objectId) { id = p.userData.objectId; break; }
          p = p.parent;
        }
        if (!id) {
          /* Terrain: mesh gốc scene, objectId null, PlaneGeometry. */
          if (o.parent && o.parent.isScene && o.geometry && o.geometry.type === 'PlaneGeometry' && s.enabled) {
            o.receiveShadow = true;
          }
          return;
        }
        var obj = null;
        try { obj = ED.Core && typeof ED.Core.getObject === 'function' ? ED.Core.getObject(id) : null; } catch (e) {}
        if (!obj) return;
        var fl = computeShadowFlags(obj.type);
        if (fl.cast) o.castShadow = true;
        if (fl.receive) o.receiveShadow = true;
      });
    }
    return true;
  }
  /* Fog theo chiều cao camera: gọi định kỳ từ tick() (mỗi ~0.3s, chỉ tính
     lại khi độ cao camera đổi > 0.5m). Force = true để tính ngay. */
  function updateHeightFog(force) {
    if (typeof THREE === 'undefined' || !_scene || _env.fog <= 0) return false;
    var cam = null;
    try { cam = ED.Viewport && typeof ED.Viewport.getCamera === 'function' ? ED.Viewport.getCamera() : null; } catch (e) {}
    var camY = (cam && cam.position) ? cam.position.y : 10;
    if (!force && _fogLastY != null && Math.abs(camY - _fogLastY) < 0.5) return false;
    _fogLastY = camY;
    var sky = _env.skyColor || computeSun(_env.timeOfDay).skyColor;
    var f = computeFog(_env.fog, _env.fogColor, sky, camY, _env.fogHeight);
    if (!f.enabled) return false;
    if (!_scene.fog) {
      _scene.fog = new THREE.Fog(new THREE.Color(f.color), f.near, f.far);
    } else {
      _scene.fog.color.set(f.color);
      _scene.fog.near = f.near;
      _scene.fog.far = f.far;
    }
    return true;
  }
  /* Đèn lồng sáng dần ban đêm: viewport gọi mỗi frame hoặc sau khi đổi giờ. */
  function updateLanterns(nightFactor) {
    if (typeof THREE === 'undefined') return;
    var meshes = ED.Viewport && ED.Viewport.meshes;
    if (!meshes) return;
    var ids = Object.keys(meshes);
    for (var i = 0; i < ids.length; i++) {
      var g = meshes[ids[i]];
      if (!g || !g.userData || !g.userData.lanternMat) continue;
      var nf = (nightFactor == null) ? (computeSun(_env.timeOfDay).isDay ? 0 : 1) : nightFactor;
      g.userData.lanternMat.emissiveIntensity = 0.25 + nf * 0.75;
      g.traverse(function (o) {
        if (o && o.isPointLight) o.intensity = 0.15 + nf * 0.7;
      });
    }
  }

  /* ---- Đợt 6 — skybox procedural + chớp sấm + fog bão cát. ---- */
  /* Vận tốc mây bay theo gió (m/s): hướng +x chủ đạo, tốc độ tăng theo
     env.wind (1..5 m/s), lệch nhẹ +z. */
  function _cloudWindVec() {
    var speed = 1 + _env.wind * 4;
    return [speed, speed * 0.12];
  }
  /* Tạo 1 lần + cập nhật vòm trời theo giờ (gọi từ applyToScene):
     - vòm: SphereGeometry r=220 BackSide, ShaderMaterial gradient theo y
       (tự viết, KHÔNG texture ngoài), màu từ skyColorsForHour;
     - mặt trời (tròn, ban ngày) + mặt trăng (tròn, ban đêm) đặt theo
       computeSun(hour) / computeSun(hour+12), luôn quay mặt về tâm cảnh;
     - sao đêm: THREE.Points ~300 điểm trên vòm, opacity = starOpacity;
     - mây: 10 mặt phẳng texture mây (tái dùng buildFogTexture), vị trí
       theo edEnvCloudPositions, tick() cập nhật sau.
     Skybox tắt: ẩn cả nhóm + trả scene.background về màu trời cũ.
     Sandstorm: đáy trời trộn dần về vàng cát. Trả false khi chưa có
     scene/THREE. */
  function updateSky(sun, sky) {
    if (typeof THREE === 'undefined') return false;
    var scene = _scene || findScene();
    if (!scene) return false;
    sun = sun || computeSun(_env.timeOfDay);
    sky = sky || _env.skyColor || sun.skyColor;
    if (!_env.skybox) {
      if (_skyGroup) _skyGroup.visible = false;
      scene.background = new THREE.Color(sky);
      return true;
    }
    var cols = skyColorsForHour(_env.timeOfDay);
    var top = cols.top.slice(), bottom = cols.bottom.slice();
    if (_env.weather === 'sandstorm') {
      /* Đáy trời hơi vàng cát: trộn 45% về #d8c27a. */
      var sand = [0.847, 0.761, 0.478];
      for (var si = 0; si < 3; si++) bottom[si] = +(bottom[si] + (sand[si] - bottom[si]) * 0.45).toFixed(3);
    }
    scene.background = null;
    if (!_skyGroup) {
      _skyGroup = new THREE.Group();
      _skyGroup.name = 'ed-skybox';
      var domeGeo = new THREE.SphereGeometry(220, 20, 14);
      var domeMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          topColor: { value: new THREE.Color(top[0], top[1], top[2]) },
          bottomColor: { value: new THREE.Color(bottom[0], bottom[1], bottom[2]) }
        },
        vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vPos; void main() { float h = normalize(vPos).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(0.0, 0.6, h)), 1.0); }'
      });
      _skyDome = new THREE.Mesh(domeGeo, domeMat);
      _skyDome.frustumCulled = false;
      _skyGroup.add(_skyDome);
      _skySun = new THREE.Mesh(new THREE.CircleGeometry(7, 24),
        new THREE.MeshBasicMaterial({ color: 0xfff3d6, fog: false, transparent: true, opacity: 0.95 }));
      _skyGroup.add(_skySun);
      _skyMoon = new THREE.Mesh(new THREE.CircleGeometry(5, 24),
        new THREE.MeshBasicMaterial({ color: 0xe8eefc, fog: false, transparent: true, opacity: 0.95 }));
      _skyGroup.add(_skyMoon);
      var starCount = 300, starPos = new Float32Array(starCount * 3);
      for (var i = 0; i < starCount; i++) {
        var th = _hash01(i, 21) * Math.PI * 2;
        var ph = Math.acos(1 - _hash01(i, 22) * 0.95); // thiên đỉnh -> gần chân trời
        var r = 200;
        starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        starPos[i * 3 + 1] = r * Math.cos(ph) + 5;
        starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      }
      var starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
      _skyStars = new THREE.Points(starGeo, new THREE.PointsMaterial({
        color: 0xffffff, size: 1.6, sizeAttenuation: false,
        transparent: true, opacity: 0, depthWrite: false, fog: false
      }));
      _skyStars.frustumCulled = false;
      _skyGroup.add(_skyStars);
      var cloudTex = buildFogTexture();
      var cpos = edEnvCloudPositions(10, _cloudTime, _cloudWindVec());
      _skyClouds = [];
      for (var ci = 0; ci < cpos.length; ci++) {
        var cw = 14 + _hash01(ci, 23) * 10, ch = 6 + _hash01(ci, 24) * 4;
        var cgeo = new THREE.PlaneGeometry(cw, ch);
        var cmat = new THREE.MeshBasicMaterial({ map: cloudTex || null, transparent: true,
          opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, fog: false });
        var cm = new THREE.Mesh(cgeo, cmat);
        cm.position.set(cpos[ci].x, cpos[ci].y, cpos[ci].z);
        cm.renderOrder = 4;
        _skyGroup.add(cm);
        _skyClouds.push(cm);
      }
      scene.add(_skyGroup);
    }
    _skyGroup.visible = true;
    if (_skyDome && _skyDome.material && _skyDome.material.uniforms) {
      _skyDome.material.uniforms.topColor.value.setRGB(top[0], top[1], top[2]);
      _skyDome.material.uniforms.bottomColor.value.setRGB(bottom[0], bottom[1], bottom[2]);
    }
    var sd = sun.sunDir;
    _skySun.position.set(sd[0] * 190, Math.max(6, sd[1] * 190), sd[2] * 190);
    _skySun.lookAt(0, 0, 0);
    _skySun.material.color.set(cols.sunColor);
    _skySun.visible = sun.isDay;
    var moonSun = computeSun((_env.timeOfDay + 12) % 24);
    var md = moonSun.sunDir;
    _skyMoon.position.set(md[0] * 190, Math.max(6, md[1] * 190), md[2] * 190);
    _skyMoon.lookAt(0, 0, 0);
    _skyMoon.visible = !sun.isDay;
    if (_skyStars) _skyStars.material.opacity = cols.starOpacity;
    var cloudCols = hexToRgb(cols.cloudColor);
    for (var k = 0; k < _skyClouds.length; k++) {
      _skyClouds[k].material.color.setRGB(cloudCols[0], cloudCols[1], cloudCols[2]);
    }
    return true;
  }
  /* Trả fog về đúng setting env (dùng khi rời sandstorm): fog về màu +
     tầm xa theo computeFog, fog = 0 thì gỡ fog. */
  function _restoreFog(scene) {
    if (!scene) return;
    _sandFogSaved = false;
    if (_env.fog <= 0) { scene.fog = null; return; }
    var sky = _env.skyColor || computeSun(_env.timeOfDay).skyColor;
    var f = computeFog(_env.fog, _env.fogColor, sky, (_fogLastY == null ? 10 : _fogLastY), _env.fogHeight);
    if (!f.enabled) { scene.fog = null; return; }
    scene.fog = new THREE.Fog(new THREE.Color(f.color), f.near, f.far);
  }
  /* Fog bão cát: mật độ gấp 2 (tối thiểu 0.02 để có hiệu ứng ngay cả khi
     env.fog = 0), màu vàng cát #d8c27a. */
  function _applySandFog(scene) {
    if (!scene) return;
    var dens = Math.max(_env.fog * 2, 0.02);
    var f = computeFog(dens, '#d8c27a', '#d8c27a', 10, 0);
    if (!f.enabled) return;
    scene.fog = new THREE.Fog(new THREE.Color(0xd8c27a), f.near, f.far);
    _sandFogSaved = true;
  }
  /* Dọn trạng thái sấm: tắt overlay chớp, trả cường độ đèn về gốc. */
  function _clearThunder() {
    if (_thunder && _thunder.flashLight && _thunder.baseIntensity != null) {
      try { _thunder.flashLight.intensity = _thunder.baseIntensity; } catch (e) {}
    }
    _thunder = null;
    if (_flashEl) { try { _flashEl.style.opacity = '0'; } catch (e) {} }
  }
  /* Một lần chớp: overlay trắng mờ 0.55 rồi mờ dần trong 300ms (tick lo),
     đèn đang sáng (mặt trời ban ngày / mặt trăng ban đêm) tăng vọt rồi
     trở lại, SFX sấm qua ED.Export.playThunder (guard typeof). */
  function _doFlash() {
    if (!_thunder) return;
    var light = (_sun && _sun.visible) ? _sun : _moon;
    _thunder.flashLight = light || null;
    _thunder.baseIntensity = light ? light.intensity : null;
    _thunder.flashLeft = 0.3;
    if (_flashEl) { try { _flashEl.style.opacity = '0.55'; } catch (e) {} }
    try {
      if (typeof ED !== 'undefined' && ED.Export && typeof ED.Export.playThunder === 'function') {
        ED.Export.playThunder();
      }
    } catch (e) {}
  }

  /* ---- Weather: Points rơi. tick(dt) do viewport render loop gọi. ---- */
  /* Đợt 6 — weather mở rộng: 'thunder' = mưa to gấp 2.5 lần rain thường
     (2000 hạt, dùng lại hệ hạt mưa) + chớp sấm theo lịch RNG có seed;
     'sandstorm' = hạt cát vàng 600 bay ngang theo gió + xoáy nhẹ, fog
     vàng dày gấp 2. Đổi weather khác: gỡ hạt cũ + trả fog về setting
     env (không rò rỉ state). Weather lạ -> 'none'. */
  function setWeather(w) {
    _env.weather = normalizeWeather(w);
    _clearThunder();
    if (typeof THREE === 'undefined') return false;
    var scene = _scene || findScene();
    if (!scene) return false;
    var wasSand = _weather && _weather.type === 'sandstorm';
    if (_weather && _weather.points) {
      if (scene.remove) scene.remove(_weather.points);
      if (_weather.points.geometry) _weather.points.geometry.dispose();
      if (_weather.points.material) _weather.points.material.dispose();
      _weather = null;
    }
    if (wasSand) _restoreFog(scene);
    if (_env.weather === 'none') return true;
    var count = WEATHER_COUNTS[_env.weather];
    var pos = new Float32Array(count * 3);
    var vel = new Float32Array(count);
    var isRain = (_env.weather === 'rain' || _env.weather === 'thunder');
    var isSand = (_env.weather === 'sandstorm');
    for (var i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 48;
      pos[i * 3 + 1] = isSand ? 0.5 + Math.random() * 12 : Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * 48;
      if (isRain) vel[i] = 14 + Math.random() * 8;
      else if (isSand) vel[i] = 2 + Math.random() * 4; // tốc độ bay ngang
      else vel[i] = 1.5 + Math.random() * 2; // tuyết rơi chậm
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var m = new THREE.PointsMaterial({
      color: isRain ? 0x9fc4e8 : (isSand ? 0xd8c27a : 0xffffff),
      size: isRain ? 0.12 : (isSand ? 0.5 : 0.35),
      transparent: true, opacity: isSand ? 0.85 : 0.8, sizeAttenuation: true
    });
    var points = new THREE.Points(geo, m);
    points.frustumCulled = false;
    scene.add(points);
    _weather = { type: _env.weather, points: points, velocities: vel, count: count };
    if (_env.weather === 'thunder') {
      var seed = 1;
      try { seed = (Date.now() % 2147483647) || 1; } catch (e) {}
      _thunder = { rng: edEnvMulberry32(seed), nextIn: 2 + edEnvMulberry32(seed)() * 4,
        flashLeft: 0, flashLight: null, baseIntensity: null };
    }
    if (isSand) _applySandFog(scene);
    return true;
  }
  function tick(dt) {
    /* Fog theo chiều cao camera: kiểm tra định kỳ, không tính mỗi frame.
       Đợt 6: bão cát đang ghi đè fog thì bỏ qua (không trả fog về cũ). */
    _fogTick += Math.min(Number(dt) || 0, 0.1);
    if (_fogTick >= 0.3) { _fogTick = 0; if (_env.weather !== 'sandstorm') { try { updateHeightFog(); } catch (e) {} } }
    /* Đợt 6 — mây bay theo gió (chỉ đổi vị trí mesh theo hàm thuần
       edEnvCloudPositions, không dựng lại mesh mỗi frame) + chớp sấm. */
    _cloudTime += Math.min(Number(dt) || 0, 0.1);
    if (_skyGroup && _skyGroup.visible && _skyClouds.length) {
      var cp = edEnvCloudPositions(_skyClouds.length, _cloudTime, _cloudWindVec());
      for (var ci = 0; ci < _skyClouds.length && ci < cp.length; ci++) {
        _skyClouds[ci].position.set(cp[ci].x, cp[ci].y, cp[ci].z);
      }
    }
    if (_thunder && _env.weather === 'thunder') {
      var tdt = Math.min(Number(dt) || 0, 0.1);
      _thunder.nextIn -= tdt;
      if (_thunder.nextIn <= 0) {
        _doFlash();
        _thunder.nextIn = (4 + _thunder.rng() * 8) / Math.max(0.5, _env.thunderRate || 1);
      }
      if (_thunder.flashLeft > 0) {
        _thunder.flashLeft -= tdt;
        var fk = Math.max(0, _thunder.flashLeft / 0.3);
        if (_flashEl) { try { _flashEl.style.opacity = String((0.55 * fk).toFixed(3)); } catch (e) {} }
        if (_thunder.flashLight) {
          try { _thunder.flashLight.intensity = (_thunder.baseIntensity || 1) * (1 + 2.5 * fk); } catch (e) {}
        }
        if (_thunder.flashLeft <= 0) {
          if (_flashEl) { try { _flashEl.style.opacity = '0'; } catch (e) {} }
          if (_thunder.flashLight && _thunder.baseIntensity != null) {
            try { _thunder.flashLight.intensity = _thunder.baseIntensity; } catch (e) {}
          }
          _thunder.flashLight = null;
        }
      }
    }
    /* Đợt 5 — lớp sương bay trôi theo gió: chỉ đổi vị trí các plane theo
       hàm thuần edEnvFogLayerPositions, không dựng lại mesh mỗi frame. */
    _fogTime += Math.min(Number(dt) || 0, 0.1);
    if (_fogGroup && _env.fogLayers.enabled) {
      var fp = edEnvFogLayerPositions(_env.fogLayers.count, _env.fogLayers.height, _fogTime, _fogWindVec());
      for (var i = 0; i < _fogGroup.children.length && i < fp.length; i++) {
        _fogGroup.children[i].position.set(fp[i].x, fp[i].y, fp[i].z);
      }
    }
    if (!_weather || !_weather.points) return;
    dt = Math.min(Number(dt) || 0, 0.1);
    var attr = _weather.points.geometry.attributes.position;
    var arr = attr.array;
    var windX = _env.wind * 1.5;
    /* Đợt 6 — bão cát: hạt bay ngang theo gió + xoáy nhẹ, không rơi. */
    if (_weather.type === 'sandstorm') {
      var sandSpeed = 2 + _env.wind * 5;
      for (var si = 0; si < _weather.count; si++) {
        arr[si * 3] += (_weather.velocities[si] + sandSpeed) * dt;
        arr[si * 3 + 1] += Math.sin(_weatherTick * 2 + si) * 0.6 * dt;
        arr[si * 3 + 2] += Math.cos(_weatherTick * 1.7 + si) * 0.4 * dt;
        if (arr[si * 3] > 48) {
          arr[si * 3] = -48;
          arr[si * 3 + 1] = 0.5 + Math.random() * 12;
          arr[si * 3 + 2] = (Math.random() * 2 - 1) * 48;
        }
        if (arr[si * 3 + 1] < 0.3) arr[si * 3 + 1] = 0.3;
        if (arr[si * 3 + 1] > 14) arr[si * 3 + 1] = 14;
      }
      _weatherTick += dt;
      attr.needsUpdate = true;
      return;
    }
    for (var i = 0; i < _weather.count; i++) {
      arr[i * 3 + 1] -= _weather.velocities[i] * dt;
      arr[i * 3] += windX * dt * (_weather.type === 'snow' ? 1 : 0.3);
      if (_weather.type === 'snow') arr[i * 3] += Math.sin(_weatherTick + i) * 0.01;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 28 + Math.random() * 2;
        arr[i * 3] = (Math.random() * 2 - 1) * 48;
        arr[i * 3 + 2] = (Math.random() * 2 - 1) * 48;
      }
      if (arr[i * 3] > 48) arr[i * 3] = -48;
      if (arr[i * 3] < -48) arr[i * 3] = 48;
    }
    _weatherTick += dt;
    attr.needsUpdate = true;
  }
  function getWeather() { return _env.weather; }

  /* ---- Preset: set env + (nếu scene trống) thêm vài asset tương ứng. ---- */
  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return null;
    var before = getEnv();
    _env.timeOfDay = p.timeOfDay; _env.fog = p.fog; _env.weather = normalizeWeather(p.weather);
    _env.wind = p.wind; _env.preset = name; _env.skyColor = p.skyColor;
    _env.skybox = true; _env.thunderRate = 1;
    _env.fogColor = p.fogColor || '';
    _env.fogHeight = (p.fogHeight != null) ? p.fogHeight : 0.5;
    _env.shadow = defaultShadow();
    _env.water = defaultWater();
    _env.areaLight = defaultAreaLight();
    _env.fogLayers = defaultFogLayers();
    syncToProject(); applyToScene();
    /* Đợt 5 — đổi preset thì đổi nhạc theo khu vực (guard typeof; nút
       "Phát nhạc khu vực hiện tại" trong panel Export vẫn dùng được tay). */
    try {
      if (typeof ED !== 'undefined' && ED.Export && typeof ED.Export.applyPresetMusic === 'function') {
        ED.Export.applyPresetMusic(name);
      }
    } catch (e) {}
    if (ED.Viewport && typeof ED.Viewport.refreshWater === 'function') {
      try { ED.Viewport.refreshWater(); } catch (e) {}
    }
    if (ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Preset: ' + p.name);
    /* Chỉ thêm asset khi scene trống (chưa có object nào ngoài terrain). */
    var list = (ED.Core && typeof ED.Core.listObjects === 'function') ? ED.Core.listObjects() : null;
    var empty = !list || list.filter(function (o) { return o && o.type !== 'terrain'; }).length === 0;
    var added = 0;
    if (empty && ED.Assets && typeof ED.Assets.addObjectAt === 'function') {
      p.assets.forEach(function (a) {
        try { ED.Assets.addObjectAt(a.type, a.dx, null, a.dz); added++; } catch (e) {}
      });
    }
    return { preset: name, env: getEnv(), assetsAdded: added, wasEmpty: empty, before: before };
  }
  function listPresets() {
    return Object.keys(PRESETS).map(function (k) { return { id: k, name: PRESETS[k].name }; });
  }

  /* ---- UI: slider giờ/fog/wind, chọn weather + preset.
     Gắn vào #env-panel do nhóm A tạo; chưa có thì tự tạo fallback.
     input -> áp dụng live + markDirty; change -> pushHistory 1 lần. ---- */
  var _panel = null;
  function init() {
    syncFromProject();
    applyToScene();
    if (typeof document === 'undefined') return;
    var panel = document.getElementById('env-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'env-panel';
      panel.className = 'ed-env-panel-fallback';
      document.body.appendChild(panel);
    }
    _panel = panel;
    /* Đợt 6 — overlay chớp sấm: div trắng mờ toàn viewport, opacity do
       tick() điều khiển (mờ dần trong 300ms sau mỗi lần chớp). Tạo 1 lần. */
    if (!_flashEl) {
      var _vpHost = document.getElementById('viewport') || document.getElementById('editor-viewport') ||
        (ED.Viewport && ED.Viewport.renderer && ED.Viewport.renderer.domElement && ED.Viewport.renderer.domElement.parentNode) ||
        document.body;
      _flashEl = document.createElement('div');
      _flashEl.id = 'ed-env-flash';
      _flashEl.style.position = 'absolute';
      _flashEl.style.top = '0'; _flashEl.style.left = '0';
      _flashEl.style.right = '0'; _flashEl.style.bottom = '0';
      _flashEl.style.background = '#ffffff';
      _flashEl.style.opacity = '0';
      _flashEl.style.pointerEvents = 'none';
      _flashEl.style.zIndex = '30';
      try { _vpHost.appendChild(_flashEl); } catch (e) { _flashEl = null; }
    }
    var opts = listPresets().map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === _env.preset ? ' selected' : '') + '>' + p.name + '</option>';
    }).join('');
    var hasReflector = (typeof THREE !== 'undefined' && !!THREE.Reflector);
    var hasRectArea = hasRectAreaLib(); // đợt 5: lib RectAreaLightUniformsLib đã nối chưa
    var fogColorShown = resolveFogColor(_env.fogColor, _env.skyColor);
    var shadowSizeOpts = [512, 1024, 2048].map(function (s) {
      return '<option value="' + s + '"' + (s === _env.shadow.mapSize ? ' selected' : '') + '>' + s + ' px</option>';
    }).join('');
    panel.innerHTML =
      '<div class="ed-panel-title">🌤 Môi trường</div>' +
      '<div class="ed-row"><label>Preset</label><select id="ed-env-preset">' + opts + '</select></div>' +
      '<div class="ed-row"><label>Giờ <span id="ed-env-time-v">' + _env.timeOfDay + 'h</span></label>' +
      '<input id="ed-env-time" type="range" min="0" max="24" step="0.5" value="' + _env.timeOfDay + '" style="min-height:40px"></div>' +
      '<div class="ed-row"><label>Sương mù <span id="ed-env-fog-v">' + _env.fog.toFixed(3) + '</span></label>' +
      '<input id="ed-env-fog" type="range" min="0" max="0.08" step="0.002" value="' + _env.fog + '" style="min-height:40px"></div>' +
      '<div class="ed-row"><label>Gió <span id="ed-env-wind-v">' + _env.wind.toFixed(2) + '</span></label>' +
      '<input id="ed-env-wind" type="range" min="0" max="1" step="0.05" value="' + _env.wind + '" style="min-height:40px"></div>' +
      '<div class="ed-row"><label>Thời tiết</label><select id="ed-env-weather">' +
      '<option value="none"' + (_env.weather === 'none' ? ' selected' : '') + '>Không</option>' +
      '<option value="rain"' + (_env.weather === 'rain' ? ' selected' : '') + '>🌧 Mưa</option>' +
      '<option value="snow"' + (_env.weather === 'snow' ? ' selected' : '') + '>❄ Tuyết</option>' +
      '<option value="thunder"' + (_env.weather === 'thunder' ? ' selected' : '') + '>⛈ Bão sấm sét</option>' +
      '<option value="sandstorm"' + (_env.weather === 'sandstorm' ? ' selected' : '') + '>🌪 Bão cát</option>' +
      '</select></div>' +
      '<div class="ed-row"><label>Tần suất sấm <span id="ed-env-thunder-v">' + _env.thunderRate.toFixed(1) + '×</span></label>' +
      '<input id="ed-env-thunder-rate" type="range" min="0.5" max="2" step="0.1" value="' + _env.thunderRate + '" style="min-height:40px"></div>' +
      '<div class="ed-hint">Bão sấm sét: mưa to + chớp sáng (mỗi 4–12s, chia cho tần suất sấm) + tiếng sấm. Bão cát: hạt cát vàng bay ngang, sương mù vàng dày gấp 2.</div>' +
      '<div class="ed-row"><label>Bật skybox</label>' +
      '<input id="ed-env-skybox-on" type="checkbox"' + (_env.skybox ? ' checked' : '') + ' style="min-height:40px;min-width:40px"></div>' +
      '<div class="ed-hint">Skybox: vòm trời gradient theo giờ + mặt trời/mặt trăng + sao đêm + mây bay theo gió. Tắt thì về màu nền cũ.</div>' +
      '<div class="ed-panel-title">🌑 Bóng đổ</div>' +
      '<div class="ed-row"><label>Bật bóng đổ</label>' +
      '<input id="ed-env-shadow-on" type="checkbox"' + (_env.shadow.enabled ? ' checked' : '') + ' style="min-height:40px;min-width:40px"></div>' +
      '<div class="ed-row"><label>Độ nét bóng</label><select id="ed-env-shadow-size">' + shadowSizeOpts + '</select></div>' +
      '<div class="ed-row"><label>Độ lệch bóng <span id="ed-env-shadow-bias-v">' + _env.shadow.bias.toFixed(4) + '</span></label>' +
      '<input id="ed-env-shadow-bias" type="range" min="-0.005" max="0.005" step="0.0005" value="' + _env.shadow.bias + '" style="min-height:40px"></div>' +
      '<div class="ed-panel-title">🌫 Sương mù nâng cao</div>' +
      '<div class="ed-row"><label>Màu sương mù</label>' +
      '<input id="ed-env-fog-color" type="color" value="' + fogColorShown + '" style="min-height:40px;min-width:44px">' +
      '<button id="ed-env-fog-color-auto" type="button">Theo trời</button></div>' +
      '<div class="ed-row"><label>Sương theo cao <span id="ed-env-fog-h-v">' + Math.round(_env.fogHeight * 100) + '%</span></label>' +
      '<input id="ed-env-fog-h" type="range" min="0" max="1" step="0.05" value="' + _env.fogHeight + '" style="min-height:40px"></div>' +
      '<div class="ed-panel-title">💧 Mặt nước</div>' +
      '<div class="ed-row"><label>Phản chiếu thật</label>' +
      '<input id="ed-env-water-reflect" type="checkbox"' + (_env.water.reflect ? ' checked' : '') + (hasReflector ? '' : ' disabled') + ' style="min-height:40px;min-width:40px"></div>' +
      '<div class="ed-row"><label>Màu nước</label>' +
      '<input id="ed-env-water-color" type="color" value="' + _env.water.color + '" style="min-height:40px;min-width:44px"></div>' +
      '<div class="ed-row"><label>Độ trong <span id="ed-env-water-opacity-v">' + _env.water.opacity.toFixed(2) + '</span></label>' +
      '<input id="ed-env-water-opacity" type="range" min="0.1" max="1" step="0.05" value="' + _env.water.opacity + '" style="min-height:40px"></div>' +
      (hasReflector
        ? '<div class="ed-hint">Phản chiếu dùng THREE.Reflector (render lại cảnh 1 lần mỗi mặt nước). Điện thoại yếu thì tắt nếu thấy giật.</div>'
        : '<div class="ed-hint">Chưa có Reflector trong bản build này nên mặt nước đang là mặt phẳng thường — bật phản chiếu sẽ có hiệu lực sau khi build nối lib/Reflector.js.</div>') +
      '<div class="ed-panel-title">💡 Đèn diện tích (Rect Area)</div>' +
      '<div class="ed-row"><label>Preset</label><span>Ánh sáng cửa sổ mềm — đèn nghiêng như nắng qua cửa sổ, màu ấm</span></div>' +
      '<div class="ed-row"><label>Bật đèn diện tích</label>' +
      '<input id="ed-env-area-on" type="checkbox"' + (_env.areaLight.enabled ? ' checked' : '') + (hasRectArea ? '' : ' disabled') + ' style="min-height:40px;min-width:40px"></div>' +
      '<div class="ed-row"><label>Màu đèn</label>' +
      '<input id="ed-env-area-color" type="color" value="' + _env.areaLight.color + '"' + (hasRectArea ? '' : ' disabled') + ' style="min-height:40px;min-width:44px"></div>' +
      '<div class="ed-row"><label>Cường độ <span id="ed-env-area-intensity-v">' + _env.areaLight.intensity.toFixed(1) + '</span></label>' +
      '<input id="ed-env-area-intensity" type="range" min="0" max="5" step="0.1" value="' + _env.areaLight.intensity + '"' + (hasRectArea ? '' : ' disabled') + ' style="min-height:40px"></div>' +
      '<div class="ed-row"><label>Rộng <span id="ed-env-area-w-v">' + _env.areaLight.width.toFixed(1) + 'm</span></label>' +
      '<input id="ed-env-area-w" type="range" min="1" max="10" step="0.5" value="' + _env.areaLight.width + '"' + (hasRectArea ? '' : ' disabled') + ' style="min-height:40px"></div>' +
      '<div class="ed-row"><label>Cao <span id="ed-env-area-h-v">' + _env.areaLight.height.toFixed(1) + 'm</span></label>' +
      '<input id="ed-env-area-h" type="range" min="1" max="10" step="0.5" value="' + _env.areaLight.height + '"' + (hasRectArea ? '' : ' disabled') + ' style="min-height:40px"></div>' +
      (hasRectArea
        ? '<div class="ed-hint">RectAreaLight r128 chỉ tác dụng lên vật liệu Standard/Physical — mesh Lambert trong editor sẽ không thấy đổi. Đèn đặt nghiêng một bên, chiếu xiên xuống tâm cảnh.</div>'
        : '<div class="ed-hint">Chưa có RectAreaLightUniformsLib trong bản build này — cần nối lib/RectAreaLightUniformsLib.js vào build (coordinator) thì đèn mới sáng. Các nút trên đang khoá, không phải nút giả.</div>') +
      '<div class="ed-panel-title">🌫 Lớp sương bay (gần đúng)</div>' +
      '<div class="ed-hint">⚠️ Đây là sương mù GẦN ĐÚNG bằng các mặt phẳng trong suốt trôi theo gió ở tầm thấp — KHÔNG phải volumetric fog thật (không có tán xạ ánh sáng trong thể tích).</div>' +
      '<div class="ed-row"><label>Bật lớp sương bay</label>' +
      '<input id="ed-env-foglayers-on" type="checkbox"' + (_env.fogLayers.enabled ? ' checked' : '') + ' style="min-height:40px;min-width:40px"></div>' +
      '<div class="ed-row"><label>Mật độ <span id="ed-env-foglayers-count-v">' + _env.fogLayers.count + ' lớp</span></label>' +
      '<input id="ed-env-foglayers-count" type="range" min="0" max="12" step="1" value="' + _env.fogLayers.count + '" style="min-height:40px"></div>' +
      '<div class="ed-row"><label>Độ cao <span id="ed-env-foglayers-height-v">' + _env.fogLayers.height.toFixed(1) + 'm</span></label>' +
      '<input id="ed-env-foglayers-height" type="range" min="0" max="5" step="0.1" value="' + _env.fogLayers.height + '" style="min-height:40px"></div>' +
      '<div class="ed-row"><label>Độ mờ <span id="ed-env-foglayers-opacity-v">' + _env.fogLayers.opacity.toFixed(2) + '</span></label>' +
      '<input id="ed-env-foglayers-opacity" type="range" min="0.05" max="0.8" step="0.05" value="' + _env.fogLayers.opacity + '" style="min-height:40px"></div>' +
      '<div class="ed-hint">Kéo giờ để xem ngày/đêm; đèn lồng sáng dần khi trời tối. Sương mù loãng dần khi camera lên cao (theo thanh "Sương theo cao").</div>';
    var preset = panel.querySelector('#ed-env-preset');
    preset.addEventListener('change', function () { applyPreset(preset.value); });
    function bindSlider(id, labelId, key, fmt, histLabel) {
      var el = panel.querySelector(id), lab = panel.querySelector(labelId);
      el.addEventListener('input', function () {
        var o = {}; o[key] = Number(el.value);
        setEnv(o, { history: null });
        lab.textContent = fmt(Number(el.value));
      });
      el.addEventListener('change', function () {
        if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(histLabel);
      });
    }
    bindSlider('#ed-env-time', '#ed-env-time-v', 'timeOfDay', function (v) { return v + 'h'; }, 'Môi trường: đổi giờ');
    bindSlider('#ed-env-fog', '#ed-env-fog-v', 'fog', function (v) { return v.toFixed(3); }, 'Môi trường: đổi sương mù');
    bindSlider('#ed-env-wind', '#ed-env-wind-v', 'wind', function (v) { return v.toFixed(2); }, 'Môi trường: đổi gió');
    var w = panel.querySelector('#ed-env-weather');
    w.addEventListener('change', function () {
      setEnv({ weather: w.value }, { history: 'Môi trường: thời tiết ' + w.value });
    });
    /* Đợt 6 — tần suất sấm + toggle skybox. */
    bindSlider('#ed-env-thunder-rate', '#ed-env-thunder-v', 'thunderRate', function (v) { return v.toFixed(1) + '×'; }, 'Môi trường: tần suất sấm');
    var skyboxOn = panel.querySelector('#ed-env-skybox-on');
    if (skyboxOn) skyboxOn.addEventListener('change', function () {
      setEnv({ skybox: skyboxOn.checked },
        { history: 'Môi trường: skybox ' + (skyboxOn.checked ? 'bật' : 'tắt') });
    });
    /* ---- Đợt 3: bóng đổ / fog nâng cao / mặt nước ---- */
    function refreshWater() {
      if (ED.Viewport && typeof ED.Viewport.refreshWater === 'function') {
        try { ED.Viewport.refreshWater(); } catch (e) {}
      }
    }
    function liveWaterMaterial() {
      if (ED.Viewport && typeof ED.Viewport.updateWaterMaterial === 'function') {
        try { ED.Viewport.updateWaterMaterial(); } catch (e) {}
      }
    }
    var shadowOn = panel.querySelector('#ed-env-shadow-on');
    shadowOn.addEventListener('change', function () {
      setEnv({ shadow: { enabled: shadowOn.checked } },
        { history: 'Môi trường: bóng đổ ' + (shadowOn.checked ? 'bật' : 'tắt') });
    });
    var shadowSize = panel.querySelector('#ed-env-shadow-size');
    shadowSize.addEventListener('change', function () {
      setEnv({ shadow: { mapSize: Number(shadowSize.value) } },
        { history: 'Môi trường: độ nét bóng ' + shadowSize.value });
    });
    /* bindSlider chỉ set được key phẳng trong setEnv — 2 slider đợt 3 dùng
       field lồng (shadow.bias, water.opacity) nên tự bind tay, cùng quy ước
       input = áp live + đổi nhãn, change = pushHistory 1 lần. */
    function bindNestedSlider(elId, labId, fmt, apply, histLabel) {
      var el = panel.querySelector(elId), lab = panel.querySelector(labId);
      el.addEventListener('input', function () {
        apply(Number(el.value));
        lab.textContent = fmt(Number(el.value));
      });
      el.addEventListener('change', function () {
        if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(histLabel);
      });
    }
    bindNestedSlider('#ed-env-shadow-bias', '#ed-env-shadow-bias-v', function (v) { return v.toFixed(4); },
      function (v) { setEnv({ shadow: { bias: v } }, { history: null }); }, 'Môi trường: độ lệch bóng');
    bindNestedSlider('#ed-env-water-opacity', '#ed-env-water-opacity-v', function (v) { return v.toFixed(2); },
      function (v) { setEnv({ water: { opacity: v } }, { history: null }); liveWaterMaterial(); }, 'Môi trường: độ trong nước');
    var fogColor = panel.querySelector('#ed-env-fog-color');
    fogColor.addEventListener('input', function () {
      setEnv({ fogColor: fogColor.value }, { history: null });
    });
    fogColor.addEventListener('change', function () {
      if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Môi trường: màu sương mù');
    });
    var fogColorAuto = panel.querySelector('#ed-env-fog-color-auto');
    fogColorAuto.addEventListener('click', function () {
      setEnv({ fogColor: '' }, { history: 'Môi trường: sương mù theo màu trời' });
      fogColor.value = resolveFogColor('', _env.skyColor);
    });
    bindSlider('#ed-env-fog-h', '#ed-env-fog-h-v', 'fogHeight', function (v) { return Math.round(v * 100) + '%'; }, 'Môi trường: sương mù theo cao');
    var waterReflect = panel.querySelector('#ed-env-water-reflect');
    waterReflect.addEventListener('change', function () {
      setEnv({ water: { reflect: waterReflect.checked } },
        { history: 'Môi trường: phản chiếu nước ' + (waterReflect.checked ? 'bật' : 'tắt') });
      refreshWater();
    });
    var waterColor = panel.querySelector('#ed-env-water-color');
    waterColor.addEventListener('input', function () {
      setEnv({ water: { color: waterColor.value } }, { history: null });
      liveWaterMaterial();
    });
    waterColor.addEventListener('change', function () {
      if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Môi trường: màu nước');
    });
    /* ---- Đợt 5: đèn diện tích / lớp sương bay ----
       Slider lồng (areaLight.*, fogLayers.*) dùng bindNestedSlider như
       đợt 3; checkbox dùng change + pushHistory 1 lần. Khi lib RectArea
       chưa nối, các input đèn đã disabled ở HTML nên querySelector vẫn
       có phần tử nhưng không tương tác được — vẫn bind cho đủ, không lỗi. */
    var areaOn = panel.querySelector('#ed-env-area-on');
    if (areaOn) areaOn.addEventListener('change', function () {
      setEnv({ areaLight: { enabled: areaOn.checked } },
        { history: 'Môi trường: đèn diện tích ' + (areaOn.checked ? 'bật' : 'tắt') });
    });
    var areaColor = panel.querySelector('#ed-env-area-color');
    if (areaColor) {
      areaColor.addEventListener('input', function () {
        setEnv({ areaLight: { color: areaColor.value } }, { history: null });
      });
      areaColor.addEventListener('change', function () {
        if (ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory('Môi trường: màu đèn diện tích');
      });
    }
    bindNestedSlider('#ed-env-area-intensity', '#ed-env-area-intensity-v', function (v) { return v.toFixed(1); },
      function (v) { setEnv({ areaLight: { intensity: v } }, { history: null }); }, 'Môi trường: cường độ đèn diện tích');
    bindNestedSlider('#ed-env-area-w', '#ed-env-area-w-v', function (v) { return v.toFixed(1) + 'm'; },
      function (v) { setEnv({ areaLight: { width: v } }, { history: null }); }, 'Môi trường: rộng đèn diện tích');
    bindNestedSlider('#ed-env-area-h', '#ed-env-area-h-v', function (v) { return v.toFixed(1) + 'm'; },
      function (v) { setEnv({ areaLight: { height: v } }, { history: null }); }, 'Môi trường: cao đèn diện tích');
    var fogLayersOn = panel.querySelector('#ed-env-foglayers-on');
    if (fogLayersOn) fogLayersOn.addEventListener('change', function () {
      setEnv({ fogLayers: { enabled: fogLayersOn.checked } },
        { history: 'Môi trường: lớp sương bay ' + (fogLayersOn.checked ? 'bật' : 'tắt') });
    });
    bindNestedSlider('#ed-env-foglayers-count', '#ed-env-foglayers-count-v', function (v) { return v + ' lớp'; },
      function (v) { setEnv({ fogLayers: { count: v } }, { history: null }); }, 'Môi trường: mật độ sương bay');
    bindNestedSlider('#ed-env-foglayers-height', '#ed-env-foglayers-height-v', function (v) { return v.toFixed(1) + 'm'; },
      function (v) { setEnv({ fogLayers: { height: v } }, { history: null }); }, 'Môi trường: độ cao sương bay');
    bindNestedSlider('#ed-env-foglayers-opacity', '#ed-env-foglayers-opacity-v', function (v) { return v.toFixed(2); },
      function (v) { setEnv({ fogLayers: { opacity: v } }, { history: null }); }, 'Môi trường: độ mờ sương bay');
  }

  return {
    PRESETS: PRESETS, WEATHER_COUNTS: WEATHER_COUNTS,
    computeSun: computeSun, sway: sway, lerpColor: lerpColor,
    getEnv: getEnv, getWind: getWind, setEnv: setEnv,
    syncFromProject: syncFromProject, syncToProject: syncToProject, defaultEnv: defaultEnv,
    applyToScene: applyToScene, updateLanterns: updateLanterns, findScene: findScene,
    setWeather: setWeather, getWeather: getWeather, tick: tick,
    applyPreset: applyPreset, listPresets: listPresets, init: init,
    /* Đợt 3 — hàm thuần + áp scene, harness đợt 3 test được qua ED.Environment. */
    defaultShadow: defaultShadow, normalizeShadow: normalizeShadow,
    computeShadowSettings: computeShadowSettings, computeShadowFlags: computeShadowFlags,
    getShadow: getShadow, applyShadowFlags: applyShadowFlags, applyShadows: applyShadows,
    defaultWater: defaultWater, normalizeWater: normalizeWater, getWater: getWater,
    resolveFogColor: resolveFogColor, computeFog: computeFog, updateHeightFog: updateHeightFog,
    /* Đợt 5 — đèn diện tích + lớp sương bay (hàm thuần test được bằng vm). */
    AREA_LIGHT_PRESETS: AREA_LIGHT_PRESETS,
    defaultAreaLight: defaultAreaLight, edEnvAreaLightNormalize: edEnvAreaLightNormalize,
    normalizeAreaLight: edEnvAreaLightNormalize, computeAreaLightPose: computeAreaLightPose,
    getAreaLight: getAreaLight, hasRectAreaLib: hasRectAreaLib,
    ensureRectAreaLib: ensureRectAreaLib, applyAreaLight: applyAreaLight,
    defaultFogLayers: defaultFogLayers, normalizeFogLayers: normalizeFogLayers,
    edEnvFogLayerPositions: edEnvFogLayerPositions, getFogLayers: getFogLayers,
    applyFogLayers: applyFogLayers, buildFogTexture: buildFogTexture,
    /* Đợt 6 — skybox + thời tiết mới (hàm thuần test được bằng vm). */
    WEATHER_TYPES: WEATHER_TYPES, normalizeWeather: normalizeWeather,
    skyColorsForHour: skyColorsForHour, edEnvCloudPositions: edEnvCloudPositions,
    edEnvMulberry32: edEnvMulberry32, thunderFlashSchedule: thunderFlashSchedule,
    updateSky: updateSky, getSkybox: function () { return _env.skybox; },
    getThunderRate: function () { return _env.thunderRate; }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
