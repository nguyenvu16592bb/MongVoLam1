/* ============================================================================
   Map Editor — 05-environment.js (nhóm B)
   ED.Environment — ngày/đêm (giờ 0-24 -> vị trí mặt trời/mặt trăng,
   directional light + màu trời + hemisphere), fog, weather mưa/tuyết
   (particle Points rơi), wind (viewport animation loop đọc
   ED.Environment.wind; cây/đèn đung đưa theo ED.Environment.sway()),
   preset thành cổ / rừng trúc / núi tuyết / chùa / võ đài.
   Lưu tất cả vào project.env; đổi là markDirty + pushHistory GỘP
   (chỉ push khi thả slider/change, không push mỗi tick input).
   Logic thuần (computeSun, preset, sway) test được bằng vm, không cần THREE.
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level.
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Environment = (function () {
  'use strict';

  /* State nội bộ; đồng bộ 2 chiều với project.env qua syncFrom/ToProject. */
  var _env = { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co', skyColor: '#87b5d6' };
  var _scene = null, _sun = null, _moon = null, _hemi = null;
  var _weather = null; // {type, points, velocities:Float32Array, count}
  var _weatherTick = 0;

  var PRESETS = {
    'thanh-co': { name: 'Thành cổ', timeOfDay: 10, fog: 0.008, weather: 'none', wind: 0.3, skyColor: '#87b5d6',
      assets: [{ type: 'house', dx: -6, dz: 0 }, { type: 'house', dx: 6, dz: 0 }, { type: 'gate', dx: 0, dz: -8 }, { type: 'lantern', dx: -3, dz: 4 }, { type: 'lantern', dx: 3, dz: 4 }] },
    'rung-truc': { name: 'Rừng trúc', timeOfDay: 9, fog: 0.02, weather: 'none', wind: 0.8, skyColor: '#9db98a',
      assets: [{ type: 'bamboo', dx: -6, dz: -4 }, { type: 'bamboo', dx: -4, dz: 2 }, { type: 'bamboo', dx: 5, dz: -3 }, { type: 'bamboo', dx: 6, dz: 4 }, { type: 'rock', dx: 0, dz: 6 }, { type: 'grass', dx: -2, dz: 5 }] },
    'nui-tuyet': { name: 'Núi tuyết', timeOfDay: 11, fog: 0.015, weather: 'snow', wind: 0.6, skyColor: '#cfdce8',
      assets: [{ type: 'rock', dx: -5, dz: -3 }, { type: 'rock', dx: 4, dz: -5 }, { type: 'rock', dx: 6, dz: 3 }, { type: 'tree', dx: -2, dz: 4 }] },
    'chua': { name: 'Chùa', timeOfDay: 17, fog: 0.012, weather: 'none', wind: 0.2, skyColor: '#e8b07a',
      assets: [{ type: 'temple', dx: 0, dz: -6 }, { type: 'lantern', dx: -4, dz: 0 }, { type: 'lantern', dx: 4, dz: 0 }, { type: 'flower', dx: -2, dz: 4 }, { type: 'flower', dx: 2, dz: 4 }] },
    'vo-dai': { name: 'Võ đài', timeOfDay: 13, fog: 0.005, weather: 'none', wind: 0.4, skyColor: '#8ec3e8',
      assets: [{ type: 'tower', dx: 0, dz: -8 }, { type: 'table', dx: -4, dz: 2 }, { type: 'chair', dx: -4, dz: 4 }, { type: 'lantern', dx: 5, dz: 2 }, { type: 'lantern', dx: 5, dz: -2 }] }
  };
  var WEATHER_COUNTS = { rain: 800, snow: 500 };

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

  /* ---- State + đồng bộ project.env ---- */
  function getEnv() { return { timeOfDay: _env.timeOfDay, fog: _env.fog, weather: _env.weather, wind: _env.wind, preset: _env.preset, skyColor: _env.skyColor }; }
  function getWind() { return _env.wind; }
  function setEnv(partial, opts) {
    opts = opts || {};
    if (!partial) return getEnv();
    if (partial.timeOfDay != null) _env.timeOfDay = clamp(Number(partial.timeOfDay) || 0, 0, 24);
    if (partial.fog != null) _env.fog = clamp(Number(partial.fog) || 0, 0, 0.08);
    if (partial.weather) _env.weather = (partial.weather === 'rain' || partial.weather === 'snow') ? partial.weather : 'none';
    if (partial.wind != null) _env.wind = clamp(Number(partial.wind) || 0, 0, 1);
    if (partial.preset) _env.preset = partial.preset;
    if (partial.skyColor) _env.skyColor = partial.skyColor;
    if (opts.commit !== false) { syncToProject(); applyToScene(); }
    if (opts.dirty !== false && ED.Core && typeof ED.Core.markDirty === 'function') ED.Core.markDirty();
    if (opts.history && ED.Core && typeof ED.Core.pushHistory === 'function') ED.Core.pushHistory(opts.history);
    return getEnv();
  }
  function syncFromProject() {
    var p = ED.Core && typeof ED.Core.getProject === 'function' ? ED.Core.getProject() : null;
    if (!p) p = ED.Core && ED.Core.project;
    if (!p || !p.env) return false;
    setEnv(p.env, { commit: false, dirty: false });
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
    return { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co', skyColor: '#87b5d6' };
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
    scene.background = new THREE.Color(sky);
    if (_env.fog > 0) {
      scene.fog = new THREE.Fog(new THREE.Color(sky), 30, 30 + Math.max(10, 1 / Math.max(_env.fog, 0.001) * 0.9));
    } else {
      scene.fog = null;
    }
    setWeather(_env.weather);
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

  /* ---- Weather: Points rơi. tick(dt) do viewport render loop gọi. ---- */
  function setWeather(w) {
    _env.weather = (w === 'rain' || w === 'snow') ? w : 'none';
    if (typeof THREE === 'undefined') return false;
    var scene = _scene || findScene();
    if (!scene) return false;
    if (_weather && _weather.points) {
      if (scene.remove) scene.remove(_weather.points);
      if (_weather.points.geometry) _weather.points.geometry.dispose();
      _weather = null;
    }
    if (_env.weather === 'none') return true;
    var count = WEATHER_COUNTS[_env.weather];
    var pos = new Float32Array(count * 3);
    var vel = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 48;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * 48;
      vel[i] = _env.weather === 'rain' ? 14 + Math.random() * 8 : 1.5 + Math.random() * 2;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var m = new THREE.PointsMaterial({
      color: _env.weather === 'rain' ? 0x9fc4e8 : 0xffffff,
      size: _env.weather === 'rain' ? 0.12 : 0.35,
      transparent: true, opacity: 0.8, sizeAttenuation: true
    });
    var points = new THREE.Points(geo, m);
    points.frustumCulled = false;
    scene.add(points);
    _weather = { type: _env.weather, points: points, velocities: vel, count: count };
    return true;
  }
  function tick(dt) {
    if (!_weather || !_weather.points) return;
    dt = Math.min(Number(dt) || 0, 0.1);
    var attr = _weather.points.geometry.attributes.position;
    var arr = attr.array;
    var windX = _env.wind * 1.5;
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
    _env.timeOfDay = p.timeOfDay; _env.fog = p.fog; _env.weather = p.weather;
    _env.wind = p.wind; _env.preset = name; _env.skyColor = p.skyColor;
    syncToProject(); applyToScene();
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
    var opts = listPresets().map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === _env.preset ? ' selected' : '') + '>' + p.name + '</option>';
    }).join('');
    panel.innerHTML =
      '<div class="ed-panel-title">🌤 Môi trường</div>' +
      '<div class="ed-row"><label>Preset</label><select id="ed-env-preset">' + opts + '</select></div>' +
      '<div class="ed-row"><label>Giờ <span id="ed-env-time-v">' + _env.timeOfDay + 'h</span></label>' +
      '<input id="ed-env-time" type="range" min="0" max="24" step="0.5" value="' + _env.timeOfDay + '"></div>' +
      '<div class="ed-row"><label>Sương mù <span id="ed-env-fog-v">' + _env.fog.toFixed(3) + '</span></label>' +
      '<input id="ed-env-fog" type="range" min="0" max="0.08" step="0.002" value="' + _env.fog + '"></div>' +
      '<div class="ed-row"><label>Gió <span id="ed-env-wind-v">' + _env.wind.toFixed(2) + '</span></label>' +
      '<input id="ed-env-wind" type="range" min="0" max="1" step="0.05" value="' + _env.wind + '"></div>' +
      '<div class="ed-row"><label>Thời tiết</label><select id="ed-env-weather">' +
      '<option value="none"' + (_env.weather === 'none' ? ' selected' : '') + '>Không</option>' +
      '<option value="rain"' + (_env.weather === 'rain' ? ' selected' : '') + '>🌧 Mưa</option>' +
      '<option value="snow"' + (_env.weather === 'snow' ? ' selected' : '') + '>❄ Tuyết</option>' +
      '</select></div>' +
      '<div class="ed-hint">Kéo giờ để xem ngày/đêm; đèn lồng sáng dần khi trời tối.</div>';
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
  }

  return {
    PRESETS: PRESETS, WEATHER_COUNTS: WEATHER_COUNTS,
    computeSun: computeSun, sway: sway, lerpColor: lerpColor,
    getEnv: getEnv, getWind: getWind, setEnv: setEnv,
    syncFromProject: syncFromProject, syncToProject: syncToProject, defaultEnv: defaultEnv,
    applyToScene: applyToScene, updateLanterns: updateLanterns, findScene: findScene,
    setWeather: setWeather, getWeather: getWeather, tick: tick,
    applyPreset: applyPreset, listPresets: listPresets, init: init
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
