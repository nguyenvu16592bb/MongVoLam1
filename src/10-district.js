/* ============================================================================
   MỘNG VÕ LÂM 3D — ENGINE TRANG KHU VỰC (NHÓM A)
   src/10-district.js — export global `District` với `District.boot(def)`.
   Trang khu độc lập (map/*.html, build từ src/district.template.html):
   load save v2 chung (localStorage 'mongvolam_soha_v1'), tự kiểm tra khóa
   bằng canEnterDistrict (src/10b-districts.js), dựng scene three.js r128
   nhẹ cho điện thoại, hero chibi theo save.player (màu áo + tên).
   - Điều khiển: chạm/chạm để đi (click-to-move) + WASD/mũi tên + D-pad cảm ứng.
   - Camera follow, đồng hồ game chạy (1 giờ game ≈ 75 giây thật), HUD tiền/
     giờ game, nút "🏯 Về Biện Kinh Thành" (lưu game rồi về ../mongvolam.html).
   - NPC chibi + thoại, interactable (rương, vật phẩm thác...), hoạt động
     theo từng khu (câu cá/hái sen thanh timing, tỷ võ, boss, chợ đêm...).
   - Không CDN, không chạm battle/shop/newgame/event/world. Tái dùng
     geometry/material qua cache, hạt hiệu ứng vừa phải.
   ========================================================================== */
'use strict';

(function () {
  var SAVE_KEY = (typeof DISTRICT_SAVE_KEY !== 'undefined') ? DISTRICT_SAVE_KEY : 'mongvolam_soha_v1';
  var GAME_HOUR_SECONDS = 75;

  /* 8 màu áo như NEWGAME_ROBE_COLORS (src/08-newgame.js). */
  var ROBE_COLORS = { do: '#b91c1c', lam: '#1d4ed8', luc: '#15803d', vang: '#b45309', tim: '#7e22ce', trang: '#cbd5e1', den: '#1e293b', hong: '#be185d' };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmtFull(n) { return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ============================== SAVE ============================== */
  function defaultSave() {
    return {
      player: { name: 'Song Ma Quyền Phái', faction: 'Song Ma Phái', level: 3, exp: 64, maxExp: 160, hp: 500, maxHp: 500, mp: 200, maxMp: 200, atk: 68, def: 42, speed: 7.5, gold: 455, silver: 40932, look: { gender: 'Nam', color: 'do', hair: 'bui-cao' } },
      heroes: [], leader: 0, inventory: [
        { id: 'i1', name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', qty: 5 },
        { id: 'i2', name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 3 },
        { id: 'i4', name: 'Mồi Câu', icon: '🪱', type: 'Vật phẩm', desc: 'Mồi câu cá hồ sen, mỗi lần câu tốn 1 mồi', qty: 5 }
      ],
      settings: { clockSpeed: 1 },
      worldClock: { hour: 8, day: 1, season: 'xuan' },
      weather: { kind: 'nang', remain: 180 },
      flags: { district: (typeof defaultDistrictFlags === 'function' ? defaultDistrictFlags() : {}) }
    };
  }

  function loadSave() {
    try {
      if (typeof localStorage === 'undefined') return defaultSave();
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      var d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || !d.player) return defaultSave();
      var s = defaultSave();
      s.player = Object.assign(s.player, d.player);
      if (Array.isArray(d.inventory)) s.inventory = d.inventory;
      if (Array.isArray(d.heroes)) s.heroes = d.heroes;
      if (typeof d.leader === 'number') s.leader = d.leader;
      if (d.settings) Object.assign(s.settings, d.settings);
      if (d.worldClock) Object.assign(s.worldClock, d.worldClock);
      if (d.weather) Object.assign(s.weather, d.weather);
      if (d.flags) {
        s.flags = d.flags;
        if (typeof ensureDistrictFlags === 'function') ensureDistrictFlags(s);
        else if (!s.flags.district) s.flags.district = defaultDistrictFlags();
      }
      s._raw = d; /* giữ nguyên mọi field khác của save để ghi lại không mất */
      return s;
    } catch (e) { return defaultSave(); }
  }

  function persist(save) {
    try {
      if (typeof localStorage === 'undefined') return;
      var out;
      if (save._raw) {
        out = save._raw;
        out.player = save.player; out.inventory = save.inventory; out.heroes = save.heroes;
        out.leader = save.leader; out.settings = save.settings;
        out.worldClock = save.worldClock; out.weather = save.weather; out.flags = save.flags;
      } else {
        out = { player: save.player, inventory: save.inventory, heroes: save.heroes, leader: save.leader, settings: save.settings, worldClock: save.worldClock, weather: save.weather, flags: save.flags, v: 2 };
      }
      localStorage.setItem(SAVE_KEY, JSON.stringify(out));
    } catch (e) {}
  }

  function addItem(save, name, icon, type, desc, qty) {
    var found = null;
    for (var i = 0; i < save.inventory.length; i++) if (save.inventory[i].name === name) { found = save.inventory[i]; break; }
    if (found) found.qty += (qty || 1);
    else save.inventory.push({ id: 'di-' + Date.now() + '-' + Math.floor(Math.random() * 9999), name: name, icon: icon, type: type, desc: desc, qty: qty || 1 });
  }
  function addLenhBai(save) {
    var it = (typeof DISTRICT_ITEM_LENH_BAI !== 'undefined') ? DISTRICT_ITEM_LENH_BAI : { id: 'lenh_bai', name: 'Lệnh Bài Biện Kinh', icon: '🎫', type: 'Tín vật', desc: 'Lệnh bài do Miếu Cổ ban.' };
    var found = null;
    for (var i = 0; i < save.inventory.length; i++) if (save.inventory[i].id === 'lenh_bai' || save.inventory[i].name === it.name) { found = save.inventory[i]; break; }
    if (found) { found.id = 'lenh_bai'; found.qty += 1; }
    else save.inventory.push({ id: 'lenh_bai', name: it.name, icon: it.icon, type: it.type, desc: it.desc, qty: 1 });
  }
  function hasItem(save, name) {
    for (var i = 0; i < save.inventory.length; i++) if (save.inventory[i].name === name && save.inventory[i].qty > 0) return save.inventory[i];
    return null;
  }
  function takeItem(save, name, qty) {
    var it = hasItem(save, name);
    if (!it || it.qty < (qty || 1)) return false;
    it.qty -= (qty || 1);
    if (it.qty <= 0) save.inventory.splice(save.inventory.indexOf(it), 1);
    return true;
  }
  function gainExp(save, amount) {
    var p = save.player;
    p.exp = (Number(p.exp) || 0) + Math.max(0, Math.round(amount));
    var leveled = 0;
    while (p.exp >= p.maxExp) {
      p.exp -= p.maxExp; p.level += 1; p.maxExp = Math.round(p.maxExp * 1.42);
      p.maxHp += 120; p.hp = p.maxHp; p.maxMp += 40; p.mp = p.maxMp; p.atk += 15; p.def += 10;
      leveled++;
    }
    return leveled;
  }

  /* ============================== DISTRICT ENGINE ============================== */
  var District = {
    def: null, save: null,
    scene: null, camera: null, renderer: null, clock: null,
    player: null, npcs: [], propMeshes: [], colliders: [],
    keys: {}, target: null, onArrive: null, isMoving: false,
    raycaster: null, groundPlane: null, hemi: null, dirLight: null,
    gateMat: null, fireflies: null, fallPts: null,
    _hudAcc: 0, _raf: 0, _inited: false,

    /* ---- Khởi động trang khu ---- */
    boot: function (def) {
      if (!def) { this.showLock('Không tìm thấy dữ liệu khu vực này.'); return; }
      this.def = def;
      this.save = loadSave();
      var check = (typeof canEnterDistrict === 'function')
        ? canEnterDistrict(def, this.save) : { ok: true };
      if (!check.ok) { this.showLock(check.reason || 'Khu vực này đang bị khóa.'); return; }
      document.title = def.name + ' — Mộng Võ Lâm 3D';
      var t = document.getElementById('d-title');
      if (t) t.textContent = def.name;
      var d = document.getElementById('d-desc');
      if (d) d.textContent = def.desc || '';
      this.buildScene();
      this.buildActivities();
      this.bindInput();
      this._inited = true;
      this.loop();
      this.updateHUD();
      this.toast('👋 Đã tới ' + def.name + '!', 'green');
    },

    showLock: function (reason) {
      var ov = document.getElementById('d-lock');
      if (!ov) return;
      ov.style.display = 'flex';
      var r = document.getElementById('d-lock-reason');
      if (r) r.textContent = reason;
      var cond = document.getElementById('d-lock-cond');
      if (cond) {
        var def = this.def;
        if (def && def.lock && def.lock.type === 'night') cond.textContent = 'Điều kiện mở: ban đêm theo giờ game (18h–6h). Hãy quay lại Biện Kinh Thành chơi tiếp, trời tối rồi quay lại đây.';
        else if (def && def.lock && def.lock.type === 'quest') cond.textContent = 'Điều kiện mở: ① Đánh bại Boss ẩn Hộ Pháp Đá ở Miếu Cổ Di Tích ② Nhận Lệnh Bài Biện Kinh (thưởng boss, 1 lần/ngày game).';
        else cond.textContent = '';
      }
    },

    /* ---- Scene 3D (nhẹ cho điện thoại) ---- */
    _geoCache: {}, _matCache: {},
    geo: function (key, make) {
      if (!this._geoCache[key]) this._geoCache[key] = make();
      return this._geoCache[key];
    },
    mat: function (key, make) {
      if (!this._matCache[key]) this._matCache[key] = make();
      return this._matCache[key];
    },

    buildScene: function () {
      var def = this.def, th = def.theme || {};
      var host = document.getElementById('d-scene');
      var w = window.innerWidth, h = window.innerHeight;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(th.sky || '#7ec8ee');
      this.scene.fog = new THREE.FogExp2(th.fog || '#9fd0dd', 0.012);

      var aspect = w / Math.max(1, h);
      var fs = (w < h ? 30 : 24);
      this.camera = new THREE.OrthographicCamera(-fs * aspect / 2, fs * aspect / 2, fs / 2, -fs / 2, 0.1, 160);
      this.camera.position.set(14, 16, 14);
      this.camera.lookAt(0, 0, 0);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h);
      host.appendChild(this.renderer.domElement);

      this.hemi = new THREE.HemisphereLight('#fff6e5', '#3b5254', 0.8);
      this.scene.add(this.hemi);
      this.dirLight = new THREE.DirectionalLight('#fff1d6', 0.9);
      this.dirLight.position.set(18, 30, 12);
      this.scene.add(this.dirLight);

      /* Mặt đất theo theme khu. */
      var b = def.bounds || { minX: -14, maxX: 14, minZ: -10, maxZ: 10 };
      var gw = b.maxX - b.minX + 8, gd = b.maxZ - b.minZ + 8;
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(gw, gd),
        new THREE.MeshStandardMaterial({ color: th.ground || '#8a9a7b', roughness: 0.95 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set((b.minX + b.maxX) / 2, -0.05, (b.minZ + b.maxZ) / 2);
      this.scene.add(ground);

      this.raycaster = new THREE.Raycaster();
      this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      this.clock = new THREE.Clock();

      (def.props || []).forEach(function (p) { District.buildProp(p); });
      /* Vật phẩm thác đã nhặt ở lần chơi trước thì không vẽ lại. */
      var got = (District.save.flags.district && District.save.flags.district.thac_collected) || {};
      District.propMeshes = District.propMeshes.filter(function (pm) {
        if (pm.mesh.userData.thacItem && got[pm.mesh.userData.thacItem]) {
          District.scene.remove(pm.mesh);
          if (pm.el && pm.el.parentNode) pm.el.parentNode.removeChild(pm.el);
          return false;
        }
        return true;
      });
      (def.npcs || []).forEach(function (n) { District.buildNpc(n); });
      this.buildPlayer();
      this.applyLight();
      this.updateGateVisual();
    },

    isWalkable: function (x, z) {
      var b = (this.def && this.def.bounds) || { minX: -14, maxX: 14, minZ: -10, maxZ: 10 };
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
      for (var i = 0; i < this.colliders.length; i++) {
        var c = this.colliders[i];
        if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return false;
      }
      return true;
    },

    addCollider: function (x, z, r) {
      this.colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
    },

    /* Vẽ 1 prop theo kind — hình khối đơn giản, tái dùng geometry/material. */
    buildProp: function (p) {
      var g = new THREE.Group();
      var std = function (c) { return District.mat('std:' + c, function () { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }); }); };
      var box = function (w, h, d, c, y) {
        var m = new THREE.Mesh(District.geo('box', function () { return new THREE.BoxGeometry(1, 1, 1); }), std(c));
        m.scale.set(w, h, d); m.position.y = y || h / 2; g.add(m); return m;
      };
      var cyl = function (rt, rb, h, c, y, x, z) {
        var m = new THREE.Mesh(District.geo('cyl', function () { return new THREE.CylinderGeometry(1, 1, 1, 10); }), std(c));
        m.scale.set(rt, h, rb); m.position.set(x || 0, y || h / 2, z || 0); g.add(m); return m;
      };
      var cone = function (r, h, c, y) {
        var m = new THREE.Mesh(District.geo('cone', function () { return new THREE.ConeGeometry(1, 1, 8); }), std(c));
        m.scale.set(r, h, r); m.position.y = y || h / 2; g.add(m); return m;
      };
      var solid = !!p.solid;
      switch (p.kind) {
        case 'stall': {
          box(2.6, 0.25, 1.6, '#6b4423', 0.9); box(0.18, 0.9, 0.18, '#4a2e1b', 0.45);
          var roof = new THREE.Mesh(District.geo('roof', function () { return new THREE.ConeGeometry(1, 1, 4); }), std(p.color || '#b91c1c'));
          roof.scale.set(2.2, 0.9, 1.8); roof.position.y = 2.0; roof.rotation.y = Math.PI / 4; g.add(roof);
          box(2.2, 0.5, 1.2, p.color || '#b91c1c', 1.15); solid = true; break;
        }
        case 'sign': {
          cyl(0.09, 0.09, 2.2, '#4a2e1b', 1.1);
          var board = box(2.0, 0.8, 0.12, p.color || '#f59e0b', 2.0);
          board.material = District.mat('glow:' + (p.color || '#f59e0b'), function () {
            return new THREE.MeshStandardMaterial({ color: p.color || '#f59e0b', emissive: p.color || '#f59e0b', emissiveIntensity: 0.55, roughness: 0.5 });
          });
          break;
        }
        case 'house': box(3.2, 2.2, 2.6, '#cfc8b8', 1.1); cone(2.6, 1.4, p.color || '#78350f', 2.9); solid = true; break;
        case 'tree': cyl(0.18, 0.24, 1.6, '#4a2e1b', 0.8); cone(1.5, 2.6, '#15803d', 2.6); solid = true; break;
        case 'lantern': {
          cyl(0.07, 0.07, 1.8, '#1e293b', 0.9);
          var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8),
            District.mat('lamp', function () { return new THREE.MeshStandardMaterial({ color: '#f59e0b', emissive: '#f59e0b', emissiveIntensity: 0.9 }); }));
          lamp.position.y = 1.9; g.add(lamp); break;
        }
        case 'arena': {
          var base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.5, 12), std('#c2cac5')); base.position.y = 0.25; g.add(base);
          var ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.12, 8, 20), std('#b45309')); ring.rotation.x = Math.PI / 2; ring.position.y = 0.55; g.add(ring);
          solid = true; break;
        }
        case 'stone': box(1.0, 2.0, 0.5, '#9ca3af', 1.0); cone(0.7, 0.6, '#6b7280', 2.2); solid = true; break;
        case 'wall': {
          box(10, 4.5, 1.0, '#9c8a6a', 2.25); box(10.4, 0.5, 1.3, '#6b7280', 4.7);
          /* Tường 2 đoạn, chừa khe cổng ở giữa (x -2..2) để đi qua được. */
          this.addCollider(p.x - 3.5, p.z, 1.5); this.addCollider(p.x + 3.5, p.z, 1.5);
          solid = false; break;
        }
        case 'gate': {
          box(0.8, 4.5, 0.8, '#57534e', 2.25);
          var door = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.6, 0.3),
            new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.7, emissive: '#78350f', emissiveIntensity: 0.4 }));
          door.position.y = 1.8; g.add(door);
          this.gateMat = door.material;
          break;
        }
        case 'tower': box(2.4, 5.5, 2.4, '#8a7a5a', 2.75); cone(2.0, 1.6, '#7f1d1d', 6.2); solid = true; break;
        case 'pond': {
          var w = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), new THREE.MeshStandardMaterial({ color: '#48a6a3', roughness: 0.25, metalness: 0.15 }));
          w.rotation.x = -Math.PI / 2; w.position.y = 0.02; g.add(w);
          for (var i = 0; i < 5; i++) {
            var leaf = new THREE.Mesh(new THREE.CircleGeometry(0.5, 8), std('#15803d'));
            leaf.rotation.x = -Math.PI / 2; leaf.position.set(-3 + i * 1.5, 0.05, (i % 2 ? 1.5 : -1.5)); g.add(leaf);
          }
          this.addCollider(p.x, p.z, 4.5); break;
        }
        case 'pavilion': cyl(0.2, 0.2, 2.4, '#7f1d1d', 1.2, -1.2, -1); cyl(0.2, 0.2, 2.4, '#7f1d1d', 1.2, 1.2, -1); cyl(0.2, 0.2, 2.4, '#7f1d1d', 1.2, -1.2, 1); cyl(0.2, 0.2, 2.4, '#7f1d1d', 1.2, 1.2, 1); cone(2.6, 1.2, '#b91c1c', 3.0); solid = true; break;
        case 'bridge': {
          var deck = box(2.2, 0.25, 5, '#8a6a2f', 0.35);
          deck.material = std('#8a6a2f');
          var arc = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.12, 6, 12, Math.PI), std('#78350f'));
          arc.position.y = 0.3; arc.rotation.y = Math.PI / 2; g.add(arc); break;
        }
        case 'boat': {
          var hull = new THREE.Mesh(District.geo('boat', function () { return new THREE.CylinderGeometry(0.9, 0.5, 2.6, 8); }), std('#78350f'));
          hull.rotation.z = Math.PI / 2; hull.rotation.y = Math.PI / 2; hull.scale.set(1, 1, 1); hull.position.y = 0.3; g.add(hull);
          cyl(0.06, 0.06, 1.6, '#4a2e1b', 1.0); break;
        }
        case 'dock': box(4, 0.3, 1.6, '#8a6a2f', 0.2); solid = true; break;
        case 'field': {
          var f = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), new THREE.MeshStandardMaterial({ color: '#b8a832', roughness: 0.9 }));
          f.rotation.x = -Math.PI / 2; f.position.y = 0.03; g.add(f);
          for (var r = 0; r < 4; r++) { var row = box(6.6, 0.08, 0.3, '#15803d', 0.08); row.position.z = -2 + r * 1.3; }
          break;
        }
        case 'buffalo': {
          var body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), std('#3f3f46')); body.scale.set(1.4, 0.9, 0.9); body.position.y = 0.9; g.add(body);
          var head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), std('#27272a')); head.position.set(1.3, 1.1, 0); g.add(head);
          cone(0.25, 0.7, '#d6d3d1', 1.6); solid = true; break;
        }
        case 'grave': box(0.9, 1.4, 0.25, '#6b7280', 0.7); cone(0.6, 0.5, '#4b5563', 1.6); solid = true; break;
        case 'firefly': this.buildFireflies(g); break;
        case 'waterfall': {
          var fall = new THREE.Mesh(new THREE.PlaneGeometry(3, 4), new THREE.MeshStandardMaterial({ color: '#bae6fd', roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 }));
          fall.position.y = 2; g.add(fall);
          box(4, 3.5, 1.2, '#6b7280', 1.75); this.addCollider(p.x, p.z, 2.2);
          var w2 = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), new THREE.MeshStandardMaterial({ color: '#48a6a3', roughness: 0.25 }));
          w2.rotation.x = -Math.PI / 2; w2.position.set(0, 0.02, 2.5); g.add(w2); break;
        }
        case 'crystal': {
          var c = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), District.mat('crys', function () { return new THREE.MeshStandardMaterial({ color: '#a855f7', emissive: '#7e22ce', emissiveIntensity: 0.8, roughness: 0.3 }); }));
          c.position.y = 0.8; g.add(c); break;
        }
        case 'cave': {
          var mouth = new THREE.Mesh(new THREE.CircleGeometry(2.2, 12), new THREE.MeshBasicMaterial({ color: '#000000' }));
          mouth.position.y = 2.0; g.add(mouth);
          box(5.5, 1.0, 1.0, '#44403c', 4.2); box(1.0, 4.5, 1.0, '#44403c', 2.25); solid = true; break;
        }
        case 'altar': box(2.2, 1.0, 1.2, '#9c8a6a', 0.5); box(1.6, 0.5, 0.9, '#b45309', 1.25); solid = true; break;
        case 'statue': cyl(0.5, 0.7, 1.2, '#a8a29e', 0.6); var st = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), std('#a8a29e')); st.position.y = 1.7; g.add(st); cone(0.7, 0.8, '#a8a29e', 2.4); solid = true; break;
        case 'temple': box(5, 3, 3.5, '#a89878', 1.5); cone(3.6, 1.6, '#7f1d1d', 3.8); solid = true; break;
        case 'chest': {
          box(1.2, 0.7, 0.8, '#78350f', 0.35);
          var lid = box(1.2, 0.3, 0.8, '#b45309', 0.85); lid.material = District.mat('chestgold', function () { return new THREE.MeshStandardMaterial({ color: '#b45309', emissive: '#b45309', emissiveIntensity: 0.35 }); });
          break;
        }
        case 'rock': { var rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7), std('#78716c')); rk.position.y = 0.5; g.add(rk); break; }
        case 'flower': {
          for (var f2 = 0; f2 < 4; f2++) {
            var fl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), std(['#ec4899', '#f59e0b', '#a855f7', '#ef4444'][f2]));
            fl.position.set(-0.6 + f2 * 0.4, 0.35, (f2 % 2 ? 0.3 : -0.3)); g.add(fl);
          }
          break;
        }
        case 'cart': box(1.8, 0.3, 1.1, '#78350f', 0.6); cyl(0.4, 0.4, 0.15, '#4a2e1b', 0.4, -0.7, 0); cyl(0.4, 0.4, 0.15, '#4a2e1b', 0.4, 0.7, 0); solid = true; break;
        case 'barrel': cyl(0.45, 0.45, 0.9, '#92400e', 0.45); break;
        case 'well': cyl(0.9, 0.9, 0.8, '#78716c', 0.4); cone(1.3, 0.8, '#7f1d1d', 1.6); solid = true; break;
        case 'thac-item': {
          var gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), District.mat('thacgem', function () { return new THREE.MeshStandardMaterial({ color: '#facc15', emissive: '#f59e0b', emissiveIntensity: 0.9 }); }));
          gem.position.y = 0.9; g.add(gem);
          var ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.7, 20), new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }));
          ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
          g.userData.thacItem = p.itemId; g.userData.label = p.label || 'Vật phẩm thác nước';
          break;
        }
        case 'ghost': break;
        default: box(1, 1, 1, '#888888', 0.5); break;
      }
      g.position.set(p.x || 0, 0, p.z || 0);
      if (solid) this.addCollider(p.x || 0, p.z || 0, p.kind === 'wall' ? 5 : 1.4);
      if (p.label && p.kind !== 'thac-item') {
        var el = document.createElement('div');
        el.className = 'd-label'; el.textContent = p.label;
        document.getElementById('d-labels').appendChild(el);
        this.propMeshes.push({ mesh: g, el: el, prop: p });
      } else if (g.userData.thacItem) {
        var el2 = document.createElement('div');
        el2.className = 'd-label thac'; el2.textContent = '✨ ' + (p.label || 'Vật phẩm');
        document.getElementById('d-labels').appendChild(el2);
        this.propMeshes.push({ mesh: g, el: el2, prop: p });
      }
      this.scene.add(g);
    },

    buildFireflies: function (g) {
      var n = 24, pos = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 20; pos[i * 3 + 1] = 0.5 + Math.random() * 2; pos[i * 3 + 2] = (Math.random() - 0.5) * 14; }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xa7f3d0, size: 0.28, transparent: true, opacity: 0.9 }));
      g.add(pts);
      this.fireflies = pts;
    },

    /* ---- Chibi (theo mẫu CharacterManager.create ở src/02-world.js) ---- */
    makeChibi: function (opt) {
      var g = new THREE.Group();
      if (opt.aura) {
        var ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.72, 24), new THREE.MeshBasicMaterial({ color: opt.aura, side: THREE.DoubleSide, transparent: true, opacity: 0.72 }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
      }
      var shadow = new THREE.Mesh(new THREE.CircleGeometry(0.48, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.33 }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; g.add(shadow);
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 0.85, 12), new THREE.MeshStandardMaterial({ color: opt.robe || '#334155', roughness: 0.6 }));
      body.position.y = 0.55; g.add(body);
      var belt = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.32, 0.16, 12), new THREE.MeshStandardMaterial({ color: opt.belt || '#d97706' }));
      belt.position.y = 0.52; g.add(belt);
      var armMat = new THREE.MeshStandardMaterial({ color: '#fde68a' });
      var la = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), armMat); la.position.set(-0.38, 0.65, 0); g.add(la);
      var ra = la.clone(); ra.position.x = 0.38; g.add(ra);
      var head = new THREE.Mesh(new THREE.SphereGeometry(0.44, 16, 14), new THREE.MeshStandardMaterial({ color: '#ffedd5', roughness: 0.5 }));
      head.position.y = 1.32; g.add(head);
      var hairMat = new THREE.MeshStandardMaterial({ color: opt.hair || '#1e1b4b', roughness: 0.5 });
      var cap = new THREE.Mesh(new THREE.SphereGeometry(0.47, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
      cap.position.y = 1.36; g.add(cap);
      var bun = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), hairMat); bun.position.set(0, 1.65, -0.25); g.add(bun);
      if (opt.hat) { var hat = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.35, 16), new THREE.MeshStandardMaterial({ color: '#d4a359' })); hat.position.y = 1.75; g.add(hat); }
      if (opt.weapon) { var sp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), new THREE.MeshStandardMaterial({ color: opt.weapon })); sp.position.set(0.45, 1.1, 0.1); sp.rotation.z = -0.25; g.add(sp); }
      g.position.set(opt.x || 0, 0, opt.z || 0);
      this.scene.add(g);
      var el = document.createElement('div');
      el.className = 'd-nameplate ' + (opt.isPlayer ? 'player' : 'npc');
      el.textContent = opt.name || '';
      document.getElementById('d-nameplates').appendChild(el);
      return { def: opt, mesh: g, el: el, bob: Math.random() * 6.28 };
    },

    buildPlayer: function () {
      var p = this.save.player;
      var robe = ROBE_COLORS[(p.look && p.look.color) || 'do'] || '#b91c1c';
      /* Điểm spawn an toàn: thử các điểm ứng viên, lấy điểm đầu tiên đi được
         (tránh rơi vào hồ sen / collider của khu). */
      var sx = 0, sz = 8, ok = false;
      var cands = [[0, 8], [0, -8], [-8, 0], [8, 0], [0, 0], [-8, 8], [8, 8], [-8, -8], [8, -8]];
      for (var i = 0; i < cands.length; i++) {
        if (this.isWalkable(cands[i][0], cands[i][1])) { sx = cands[i][0]; sz = cands[i][1]; ok = true; break; }
      }
      if (!ok) { sx = 0; sz = 8; }
      this.player = this.makeChibi({ id: 'player', name: p.name, x: sx, z: sz, robe: robe, belt: '#38bdf8', hair: '#dbeafe', isPlayer: true });
    },

    buildNpc: function (n) {
      var e = this.makeChibi({ id: n.id, name: n.name, x: n.x, z: n.z, robe: n.robe || '#334155', belt: '#facc15', hair: '#1e1b18' });
      e.role = n.role; e.dialogue = n.dialogue;
      this.npcs.push(e);
    },

    /* ---- Ánh sáng theo giờ game (đêm tối hơn) ---- */
    applyLight: function () {
      if (!this.hemi) return;
      var h = ((this.save.worldClock.hour % 24) + 24) % 24;
      var night = (h >= 18 || h < 6);
      var dusk = (h >= 17 && h < 18) || (h >= 6 && h < 7);
      var mul = night ? 0.45 : (dusk ? 0.65 : 1);
      this.hemi.intensity = 0.8 * mul;
      this.dirLight.intensity = 0.9 * mul;
    },

    updateGateVisual: function () {
      if (!this.gateMat || this.def.id !== 4) return;
      var night = (typeof isNightHour === 'function') ? isNightHour(this.save.worldClock.hour) : false;
      var pass = this.save.flags.district && this.save.flags.district.nam_mon_pass;
      var c = !night ? '#15803d' : (pass ? '#b45309' : '#b91c1c');
      this.gateMat.color.set(c);
      this.gateMat.emissive = new THREE.Color(c);
      this.gateMat.emissiveIntensity = 0.5;
    }
  };

  window.District = District;
})();

/* ============================== PHẦN 2: INPUT · LOOP · HUD · MODAL ============================== */
(function () {
  'use strict';
  var GAME_HOUR_SECONDS = 75;
  /* NHOM C FIX (2026-11-25): SAVE_KEY chi dinh nghia trong IIFE Phan 1
     (dong 19) — Phan 2 la IIFE rieng nen persistSave() o dong 942 dung
     SAVE_KEY khong ton tai -> ReferenceError bi try/catch nuot tron ->
     MOI lan luu (thang boss, cau ca, gieo gat, ve thanh...) deu that bai
     am tham, thuong trong khu khong bao gio xuong localStorage. Dinh
     nghia lai o day nhu Phan 1. */
  var SAVE_KEY = (typeof DISTRICT_SAVE_KEY !== 'undefined') ? DISTRICT_SAVE_KEY : 'mongvolam_soha_v1';
  var D = window.District;
  if (!D) return;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmtFull(n) { return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $id(id) { return document.getElementById(id); }

  Object.assign(D, {
    bindInput: function () {
      var self = this;
      window.addEventListener('keydown', function (e) {
        var t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        self.keys[e.key.toLowerCase()] = true;
        if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(e.key.toLowerCase()) >= 0) e.preventDefault();
      });
      window.addEventListener('keyup', function (e) { self.keys[e.key.toLowerCase()] = false; });
      window.addEventListener('blur', function () { self.keys = {}; });
      /* Chạm / click để đi (click-to-move, như Engine.bindEvents ở world). */
      var cv = this.renderer.domElement;
      cv.addEventListener('pointerdown', function (e) {
        if (self.modalOpen) return;
        var r = cv.getBoundingClientRect();
        var mx = ((e.clientX - r.left) / r.width) * 2 - 1;
        var my = -((e.clientY - r.top) / r.height) * 2 + 1;
        self.raycaster.setFromCamera({ x: mx, y: my }, self.camera);
        var p = new THREE.Vector3();
        if (!self.raycaster.ray.intersectPlane(self.groundPlane, p)) return;
        /* Chạm NPC gần điểm chạm thì đi tới rồi nói chuyện. */
        var npc = self.nearestNpc(p.x, p.z, 1.6);
        if (npc) { self.moveTo(npc.mesh.position.x, npc.mesh.position.z + 1.6, function () { self.talkTo(npc); }); return; }
        var thac = self.nearestThac(p.x, p.z, 1.6);
        if (thac) { self.moveTo(thac.mesh.position.x, thac.mesh.position.z + 1.4, function () { self.collectThac(thac); }); return; }
        if (self.isWalkable(p.x, p.z)) { self.target = { x: p.x, z: p.z }; self.onArrive = null; }
      });
      /* D-pad cảm ứng. */
      document.querySelectorAll('[data-dpad]').forEach(function (btn) {
        var k = btn.getAttribute('data-dpad');
        var on = function (e) { e.preventDefault(); self.keys[k] = true; self.target = null; };
        var off = function () { self.keys[k] = false; };
        btn.addEventListener('pointerdown', on);
        btn.addEventListener('pointerup', off);
        btn.addEventListener('pointerleave', off);
        btn.addEventListener('pointercancel', off);
      });
      window.addEventListener('resize', function () {
        if (!self.renderer) return;
        self.renderer.setSize(window.innerWidth, window.innerHeight);
        var aspect = window.innerWidth / Math.max(1, window.innerHeight);
        var fs = (window.innerWidth < window.innerHeight ? 30 : 24);
        self.camera.left = -fs * aspect / 2; self.camera.right = fs * aspect / 2;
        self.camera.top = fs / 2; self.camera.bottom = -fs / 2;
        self.camera.updateProjectionMatrix();
      });
      /* Nút Về Biện Kinh Thành + đóng modal. */
      var back = $id('d-back');
      if (back) back.addEventListener('click', function () { self.goHome(); });
      var back2 = $id('d-lock-back');
      if (back2) back2.addEventListener('click', function () { self.goHome(); });
      document.addEventListener('click', function (e) {
        var b = e.target.closest('[data-dact]');
        if (!b) return;
        var act = b.getAttribute('data-dact');
        if (act === 'close-modal') self.closeModal();
        else if (act === 'interact') self.doInteract();
        else if (act.indexOf('activity:') === 0) self.runActivity(act.slice(9));
        else if (act.indexOf('npc-act:') === 0) self.npcAction(act.slice(8));
        else if (act.indexOf('buy:') === 0) self.buyShopItem(act.slice(4));
        else if (act.indexOf('boss:') === 0) self.bossAction(act.slice(5));
        else if (act === 'timing-stop') self.timingStop();
        else if (act === 'ghost-hit') self.ghostHit(b);
      });
    },

    moveTo: function (x, z, cb) {
      this.target = { x: x, z: z };
      this.onArrive = cb || null;
    },

    nearestNpc: function (x, z, r) {
      var best = null, min = r;
      this.npcs.forEach(function (n) {
        var d = Math.hypot(n.mesh.position.x - x, n.mesh.position.z - z);
        if (d < min) { min = d; best = n; }
      });
      return best;
    },

    nearestThac: function (x, z, r) {
      var best = null, min = r;
      var got = (this.save.flags.district && this.save.flags.district.thac_collected) || {};
      this.propMeshes.forEach(function (pm) {
        if (!pm.mesh.userData.thacItem || got[pm.mesh.userData.thacItem]) return;
        var d = Math.hypot(pm.mesh.position.x - x, pm.mesh.position.z - z);
        if (d < min) { min = d; best = pm; }
      });
      return best;
    },

    nearestChest: function (x, z, r) {
      var best = null, min = r;
      this.propMeshes.forEach(function (pm) {
        if (pm.prop.kind !== 'chest') return;
        var d = Math.hypot(pm.mesh.position.x - x, pm.mesh.position.z - z);
        if (d < min) { min = d; best = pm; }
      });
      return best;
    },

    /* ---- Vòng lặp chính: di chuyển + camera + đồng hồ game ---- */
    loop: function () {
      var self = this;
      var dt = Math.min(this.clock.getDelta(), 0.1);
      var t = this.clock.elapsedTime;
      this.tickClock(dt);
      this.updatePlayer(dt);
      this.updateNameplates();
      if (this.fireflies) {
        this.fireflies.rotation.y = t * 0.05;
        this.fireflies.position.y = Math.sin(t * 0.8) * 0.25;
      }
      /* Vật phẩm thác nước nhấp nhô + xoay. */
      this.propMeshes.forEach(function (pm, i) {
        if (pm.mesh.userData.thacItem) {
          pm.mesh.position.y = Math.sin(t * 2 + i * 1.7) * 0.12;
          pm.mesh.rotation.y += dt * 1.2;
        }
      });
      this._hudAcc += dt;
      if (this._hudAcc > 0.5) { this._hudAcc = 0; this.updateHUD(); this.updateInteractButton(); this.updateGateVisual(); }
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(function () { self.loop(); });
    },

    tickClock: function (dt) {
      var cs = (this.save.settings && this.save.settings.clockSpeed) || 1;
      if (!cs || cs <= 0) return;
      var wc = this.save.worldClock;
      var beforeDay = wc.day, beforeHour = wc.hour;
      wc.hour += dt * cs / GAME_HOUR_SECONDS;
      var dayChanged = false;
      while (wc.hour >= 24) { wc.hour -= 24; wc.day += 1; dayChanged = true; }
      if (dayChanged) {
        persistSave(this);
        this.toast('🌅 Đã sang ngày game ' + wc.day + '!', 'gold');
      }
      /* Đổi sáng/tối khi qua mốc 6h / 18h. */
      if ((beforeHour < 6 && wc.hour >= 6) || (beforeHour < 18 && wc.hour >= 18)) this.applyLight();
    },

    updatePlayer: function (dt) {
      if (!this.player) return;
      var p = this.player.mesh.position;
      var speed = (this.save.player.speed || 7.5);
      var mx = 0, mz = 0;
      if (this.keys['w'] || this.keys['arrowup']) { mx -= 1; mz -= 1; }
      if (this.keys['s'] || this.keys['arrowdown']) { mx += 1; mz += 1; }
      if (this.keys['a'] || this.keys['arrowleft']) { mx -= 1; mz += 1; }
      if (this.keys['d'] || this.keys['arrowright']) { mx += 1; mz -= 1; }
      if (mx || mz) {
        this.target = null; this.onArrive = null;
        var len = Math.hypot(mx, mz);
        var nx = p.x + (mx / len) * speed * dt;
        var nz = p.z + (mz / len) * speed * dt;
        if (this.isWalkable(nx, nz)) { p.x = nx; p.z = nz; }
        this.player.mesh.rotation.y = Math.atan2(mx, mz);
        this.isMoving = true;
      } else if (this.target) {
        var dx = this.target.x - p.x, dz = this.target.z - p.z;
        var dist = Math.hypot(dx, dz);
        if (dist < 0.25) {
          this.target = null; this.isMoving = false;
          var cb = this.onArrive; this.onArrive = null;
          if (cb) cb();
        } else {
          var step = Math.min(dist, speed * dt);
          var nx2 = p.x + (dx / dist) * step;
          var nz2 = p.z + (dz / dist) * step;
          if (this.isWalkable(nx2, nz2)) {
            p.x = nx2; p.z = nz2;
            this.player.mesh.rotation.y = Math.atan2(dx, dz);
            this.isMoving = true;
          } else {
            var slid = false;
            if (this.isWalkable(nx2, p.z)) { p.x = nx2; slid = true; }
            if (this.isWalkable(p.x, nz2)) { p.z = nz2; slid = true; }
            if (!slid) { this.target = null; this.isMoving = false; this.onArrive = null; }
            else { this.player.mesh.rotation.y = Math.atan2(dx, dz); this.isMoving = true; }
          }
        }
      } else { this.isMoving = false; }
      /* Nhún nhảy chibi khi di chuyển (như CharacterManager.update). */
      var time = this.clock.elapsedTime;
      this.player.mesh.position.y = Math.abs(Math.sin(time * (this.isMoving ? 14 : 3.2) + this.player.bob)) * (this.isMoving ? 0.12 : 0.03);
      /* Camera follow. */
      var desired = new THREE.Vector3(p.x + 14, 16, p.z + 14);
      this.camera.position.lerp(desired, 0.12);
      this.camera.lookAt(p.x, 0.8, p.z);
    },

    updateNameplates: function () {
      var w = window.innerWidth, h = window.innerHeight;
      var v = new THREE.Vector3();
      var all = [this.player].concat(this.npcs);
      var self = this;
      all.forEach(function (e) {
        if (!e || !e.el) return;
        v.set(e.mesh.position.x, e.mesh.position.y + 2.0, e.mesh.position.z);
        v.project(self.camera);
        var sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
        if (v.z < 1 && sx > -90 && sx < w + 90 && sy > -60 && sy < h + 60) {
          e.el.style.display = 'flex';
          e.el.style.left = sx + 'px'; e.el.style.top = sy + 'px';
        } else e.el.style.display = 'none';
      });
      this.propMeshes.forEach(function (pm) {
        if (!pm.el) return;
        v.set(pm.mesh.position.x, pm.mesh.position.y + 2.2, pm.mesh.position.z);
        v.project(self.camera);
        var sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
        if (v.z < 1 && sx > -120 && sx < w + 120 && sy > -60 && sy < h + 60) {
          pm.el.style.display = 'block';
          pm.el.style.left = sx + 'px'; pm.el.style.top = sy + 'px';
        } else pm.el.style.display = 'none';
      });
    },

    /* ---- HUD ---- */
    updateHUD: function () {
      var p = this.save.player, wc = this.save.worldClock;
      var hh = Math.floor(wc.hour), mm = Math.floor((wc.hour - hh) * 60);
      var clock = '🕐 ' + hh + 'h' + (mm < 10 ? '0' : '') + mm + ' · Ngày ' + wc.day;
      var season = (typeof districtSeasonName === 'function') ? districtSeasonName(wc.day) : '';
      var el = $id('d-wallet');
      if (el) el.innerHTML = '<span>🪙 <b>' + fmtFull(p.gold) + '</b> KNB</span><span>⚪ <b>' + fmtFull(p.silver) + '</b> bạc</span><span>⚡ Cấp ' + p.level + ' · ' + fmtFull(p.exp) + '/' + fmtFull(p.maxExp) + ' EXP</span>';
      var c2 = $id('d-clock');
      if (c2) c2.textContent = clock + (season ? ' · ' + season : '') + ((typeof isNightHour === 'function' && isNightHour(wc.hour)) ? ' 🌙 Ban đêm' : ' ☀️ Ban ngày');
      var pr = $id('d-progress');
      if (pr && this.def.id === 11) {
        var got = this.save.flags.district.thac_collected || {};
        var n = Object.keys(got).filter(function (k) { return got[k]; }).length;
        pr.textContent = '💎 Bộ sưu tập thác nước: ' + n + '/5' + (this.save.flags.district.thac_done ? ' · ✅ Đã đổi thưởng' : '');
      } else if (pr) pr.textContent = '';
    },

    buildActivities: function () {
      var host = $id('d-activities');
      if (!host) return;
      host.innerHTML = '';
      var self = this;
      (this.def.activities || []).forEach(function (a) {
        var b = document.createElement('button');
        b.className = 'd-act-btn';
        b.setAttribute('data-dact', 'activity:' + a.id);
        b.innerHTML = '<b>' + esc(a.name) + '</b><span>' + esc(a.desc || '') + '</span>';
        host.appendChild(b);
      });
      if (!(this.def.activities || []).length) host.innerHTML = '<div class="d-act-empty">Khu trung tâm — dùng bản đồ trong game chính để đi các khu khác.</div>';
    },

    goHome: function () {
      persistSave(this);
      window.location.href = '../mongvolam.html';
    },

    /* ---- Toast ---- */
    toast: function (msg, kind) {
      var host = $id('d-toasts');
      if (!host) return;
      var el = document.createElement('div');
      el.className = 'd-toast ' + (kind || '');
      el.innerHTML = msg;
      host.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3400);
      while (host.children.length > 3) host.removeChild(host.firstChild);
    },

    /* ---- Modal dùng chung ---- */
    modalOpen: false,
    openModal: function (title, bodyHtml, buttons) {
      var m = $id('d-modal');
      if (!m) return;
      $id('d-modal-title').textContent = title;
      $id('d-modal-body').innerHTML = bodyHtml;
      var foot = $id('d-modal-foot');
      foot.innerHTML = '';
      var self = this;
      (buttons || [{ label: 'Đóng', act: 'close-modal' }]).forEach(function (b) {
        var btn = document.createElement('button');
        btn.className = 'd-btn' + (b.primary ? ' primary' : '');
        btn.textContent = b.label;
        if (b.act) btn.setAttribute('data-dact', b.act);
        if (b.fn) btn.addEventListener('click', function () { b.fn(); });
        foot.appendChild(btn);
      });
      m.style.display = 'flex';
      this.modalOpen = true;
    },
    closeModal: function () {
      var m = $id('d-modal');
      if (m) m.style.display = 'none';
      this.modalOpen = false;
      if (this._timingTimer) { clearInterval(this._timingTimer); this._timingTimer = null; }
      if (this._ghostTimer) { clearInterval(this._ghostTimer); this._ghostTimer = null; }
    },

    /* ---- Nút tương tác theo ngữ cảnh ---- */
    updateInteractButton: function () {
      var btn = $id('d-interact');
      if (!btn || !this.player) return;
      var p = this.player.mesh.position;
      var npc = this.nearestNpc(p.x, p.z, 2.4);
      var thac = this.nearestThac(p.x, p.z, 2.2);
      var chest = this.nearestChest(p.x, p.z, 2.2);
      if (npc) { btn.style.display = 'block'; btn.textContent = '💬 Nói chuyện: ' + npc.def.name; btn._target = { kind: 'npc', ref: npc }; }
      else if (thac) { btn.style.display = 'block'; btn.textContent = '✋ Nhặt ' + (thac.mesh.userData.label || 'vật phẩm'); btn._target = { kind: 'thac', ref: thac }; }
      else if (chest) { btn.style.display = 'block'; btn.textContent = '📦 Mở rương'; btn._target = { kind: 'chest', ref: chest }; }
      else { btn.style.display = 'none'; btn._target = null; }
    },

    doInteract: function () {
      var btn = $id('d-interact');
      if (!btn || !btn._target) return;
      var t = btn._target;
      if (t.kind === 'npc') this.talkTo(t.ref);
      else if (t.kind === 'thac') this.collectThac(t.ref);
      else if (t.kind === 'chest') this.openChest(t.ref);
    },

    openChest: function (pm) {
      var d = this.save.flags.district;
      var key = 'chest_' + this.def.id + '_day';
      var day = this.save.worldClock.day;
      if (d[key] === day) { this.toast('📦 Rương này đã mở hôm nay rồi — quay lại ngày game sau nhé!', 'gold'); return; }
      d[key] = day;
      var silver = 500 + Math.floor(Math.random() * 1001);
      this.save.player.silver += silver;
      persistSave(this); this.updateHUD();
      this.toast('📦 Mở rương được +' + fmtFull(silver) + ' bạc!', 'green');
    },

    collectThac: function (pm) {
      var d = this.save.flags.district;
      d.thac_collected = d.thac_collected || {};
      var id = pm.mesh.userData.thacItem;
      if (!id || d.thac_collected[id]) return;
      d.thac_collected[id] = true;
      persistSave(this); this.updateHUD();
      if (pm.el) pm.el.style.display = 'none';
      this.scene.remove(pm.mesh);
      this.propMeshes.splice(this.propMeshes.indexOf(pm), 1);
      var n = Object.keys(d.thac_collected).filter(function (k) { return d.thac_collected[k]; }).length;
      this.toast('💎 Nhặt được ' + (pm.mesh.userData.label || 'vật phẩm thác nước') + '! (' + n + '/5)', 'green');
      if (n >= 5) this.toast('🎁 Đủ bộ 5 vật phẩm! Tìm Ẩn Sĩ Thác Nước để đổi thưởng.', 'gold');
    },

    /* ---- Thoại NPC ---- */
    talkTo: function (npc) {
      var d = this.save.flags.district;
      var lines = npc.dialogue;
      var text = Array.isArray(lines) ? lines[clamp(d.ngo_step || 0, 0, lines.length - 1)] : (lines || '...');
      /* Lão Ăn Mày ở bước 2: đọc xong mảnh giấy thì chuyển bước 3. */
      var buttons = [{ label: 'Đóng', act: 'close-modal' }];
      var extra = this.npcButtons(npc);
      if (extra.length) buttons = extra.concat(buttons);
      this.openModal('💬 ' + npc.def.name, '<p class="d-talk">' + esc(text) + '</p>' + this.npcHint(npc), buttons);
    },

    npcHint: function (npc) {
      var d = this.save.flags.district;
      if (npc.def.id === 'nh-mystery') {
        if (d.ngo_done) return '<p class="d-note">✅ Quest ẩn đã hoàn thành — cảm ơn thiếu hiệp!</p>';
        return '<p class="d-note">Quest ẩn: bước ' + ((d.ngo_step || 0) + 1) + '/3 — ' + ['nhận nhiệm vụ từ Người Bí Ẩn', 'tìm Mảnh Giấy Rách trong ngõ', 'đưa cho Lão Ăn Mày giải mã', 'quay lại nhận thưởng'][clamp(d.ngo_step || 0, 0, 3)] + '.</p>';
      }
      if (npc.def.id === 'nm-guard') {
        var night = (typeof isNightHour === 'function') ? isNightHour(this.save.worldClock.hour) : false;
        return '<p class="d-note">🚪 Cổng Nam Môn hiện: ' + (!night ? '🟢 ĐANG MỞ (ban ngày)' : (d.nam_mon_pass ? '🟡 ĐÃ CÓ GIẤY THÔNG HÀNH — được qua đêm' : '🔴 ĐÃ ĐÓNG (ban đêm — cần Lệnh Bài)')) + '</p>';
      }
      if (npc.def.id === 'tn-hermit') {
        var got = d.thac_collected || {};
        var n = Object.keys(got).filter(function (k) { return got[k]; }).length;
        return '<p class="d-note">💎 Bộ sưu tập thác nước: ' + n + '/5' + (d.thac_done ? ' · ✅ Đã đổi thưởng' : '') + '</p>';
      }
      if (npc.def.id === 'pt-master') {
        return '<p class="d-note">🥋 Điểm tỷ võ của thiếu hiệp: ' + (d.vo_diem || 0) + ' · Luyện skill hôm nay: ' + (d.vo_luyen_day === this.save.worldClock.day ? 'đã luyện ✅' : 'chưa luyện') + '</p>';
      }
      return '';
    },

    /* Nút hành động riêng theo NPC (gắn vào hộp thoại). */
    npcButtons: function (npc) {
      var id = npc.def.id, out = [];
      if (id === 'pd-merchant' || id === 'pd-keeper') out.push({ label: '🛒 Sang Chợ Biện Kinh', act: 'activity:shop-link', primary: true });
      if (id === 'pt-master') { out.push({ label: '⚔️ Tỷ Võ Đấu Tập', act: 'activity:ty-vo', primary: true }); out.push({ label: '🥋 Luyện Skill (2.000 bạc)', act: 'activity:luyen-skill' }); }
      if (id === 'nm-guard') out.push({ label: '🎫 Xin Giấy Thông Hành', act: 'activity:xin-qua-cong', primary: true });
      if (id === 'nm-captain') out.push({ label: '🛡️ Giúp Tuần Tra', act: 'activity:tuan-tra', primary: true });
      if (id === 'nh-mystery') {
        var s = this.save.flags.district.ngo_step || 0;
        if (!this.save.flags.district.ngo_done) {
          if (s === 0) out.push({ label: '🤫 Nhận nhiệm vụ bí mật', act: 'npc-act:ngo-accept', primary: true });
          else if (s === 1) out.push({ label: '🔍 Tìm Mảnh Giấy Rách quanh ngõ', act: 'npc-act:ngo-find', primary: true });
          else if (s === 3) out.push({ label: '🎁 Nhận thưởng', act: 'npc-act:ngo-reward', primary: true });
        }
      }
      if (id === 'nh-beggar' && (this.save.flags.district.ngo_step || 0) === 2) out.push({ label: '📜 Đưa Mảnh Giấy Rách', act: 'npc-act:ngo-deliver', primary: true });
      if (id === 'nh-trader') out.push({ label: '🌑 Mở Chợ Đen', act: 'activity:cho-den', primary: true });
      if (id === 'mc-monk') out.push({ label: '📖 Đọc Truyền Thuyết', act: 'activity:doc-lore', primary: true });
      if (id === 'mc-guardian') out.push({ label: '👹 Thách Đấu Hộ Pháp Đá', act: 'activity:boss-an', primary: true });
      if (id === 'hd-demon') out.push({ label: '👹 Thách Đấu Ma Quân', act: 'activity:boss-cuoi', primary: true });
      if (id === 'bs-boatman') out.push({ label: '⛵ Du Thuyền (300 bạc)', act: 'activity:du-thuyen', primary: true });
      if (id === 'rl-farmer') out.push({ label: '🌾 Gieo / Gặt Lúa', act: 'activity:gieo-gat', primary: true });
      if (id === 'nt-keeper' || id === 'nt-ghost') { out.push({ label: '🕯️ Thắp Hương', act: 'activity:thap-huong', primary: true }); out.push({ label: '👻 Đánh Đuổi Ma Quái', act: 'activity:danh-duoi-ma' }); }
      if (id === 'tn-hermit') out.push({ label: '🎁 Đổi Thưởng Bộ Sưu Tập', act: 'activity:doi-thuong', primary: true });
      return out;
    },

    /* Hành động từ hộp thoại NPC (quest Ngõ Hẹp). */
    npcAction: function (act) {
      var d = this.save.flags.district, save = this.save;
      if (act === 'ngo-accept') {
        d.ngo_step = 1; persistSave(this); this.closeModal();
        this.toast('🕵️ Đã nhận quest ẩn: tìm Mảnh Giấy Rách trong ngõ!', 'gold');
      } else if (act === 'ngo-find') {
        addItemFn(save, 'Mảnh Giấy Rách', '📜', 'Vật phẩm', 'Mảnh giấy cũ, chữ viết bằng mực tàng hình', 1);
        d.ngo_step = 2; persistSave(this); this.closeModal();
        this.toast('📜 Tìm thấy Mảnh Giấy Rách! Đem cho Lão Ăn Mày ở cuối ngõ.', 'green');
      } else if (act === 'ngo-deliver') {
        if (!takeItemFn(save, 'Mảnh Giấy Rách', 1)) { this.toast('Thiếu hiệp chưa có Mảnh Giấy Rách!', 'red'); return; }
        d.ngo_step = 3; persistSave(this); this.closeModal();
        this.toast('🔍 Lão Ăn Mày đã đọc xong: “trăng lên thì chợ mở”. Quay lại gặp Người Bí Ẩn!', 'green');
      } else if (act === 'ngo-reward') {
        d.ngo_done = true; save.player.silver += 3000;
        gainExpFn(save, 200);
        persistSave(this); this.updateHUD(); this.closeModal();
        this.toast('🎁 Quest ẩn hoàn thành! +3.000 bạc +200 EXP', 'green');
      }
    }
  });

  /* Helper dùng chung cho phần 2/3 (tránh phụ thuộc 01-data.js). */
  function persistSave(D) { if (D.save) { try { var s = D.save; var out; if (s._raw) { out = s._raw; out.player = s.player; out.inventory = s.inventory; out.heroes = s.heroes; out.leader = s.leader; out.settings = s.settings; out.worldClock = s.worldClock; out.weather = s.weather; out.flags = s.flags; } else out = { player: s.player, inventory: s.inventory, heroes: s.heroes, leader: s.leader, settings: s.settings, worldClock: s.worldClock, weather: s.weather, flags: s.flags, v: 2 }; localStorage.setItem(SAVE_KEY, JSON.stringify(out)); } catch (e) {} } }
  function addItemFn(save, name, icon, type, desc, qty) {
    var found = null;
    for (var i = 0; i < save.inventory.length; i++) if (save.inventory[i].name === name) { found = save.inventory[i]; break; }
    if (found) found.qty += (qty || 1);
    else save.inventory.push({ id: 'di-' + Date.now() + '-' + Math.floor(Math.random() * 9999), name: name, icon: icon, type: type, desc: desc, qty: qty || 1 });
  }
  function takeItemFn(save, name, qty) {
    for (var i = 0; i < save.inventory.length; i++) {
      if (save.inventory[i].name === name && save.inventory[i].qty >= (qty || 1)) {
        save.inventory[i].qty -= (qty || 1);
        if (save.inventory[i].qty <= 0) save.inventory.splice(i, 1);
        return true;
      }
    }
    return false;
  }
  function gainExpFn(save, amount) {
    var p = save.player;
    p.exp = (Number(p.exp) || 0) + Math.max(0, Math.round(amount));
    var leveled = 0;
    while (p.exp >= p.maxExp) { p.exp -= p.maxExp; p.level += 1; p.maxExp = Math.round(p.maxExp * 1.42); p.maxHp += 120; p.hp = p.maxHp; p.maxMp += 40; p.mp = p.maxMp; p.atk += 15; p.def += 10; leveled++; }
    return leveled;
  }
  window.__districtHelpers = { persistSave: persistSave, addItemFn: addItemFn, takeItemFn: takeItemFn, gainExpFn: gainExpFn };
})();

/* ============================== PHẦN 3: HOẠT ĐỘNG TỪNG KHU ============================== */
(function () {
  'use strict';
  var D = window.District;
  if (!D) return;
  var H = window.__districtHelpers || {};
  var persistSave = H.persistSave, addItemFn = H.addItemFn, takeItemFn = H.takeItemFn, gainExpFn = H.gainExpFn;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmtFull(n) { return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function isNight(save) { return (typeof isNightHour === 'function') ? isNightHour(save.worldClock.hour) : false; }
  function hasLenhBai(save) { return (typeof hasDistrictItem === 'function') ? hasDistrictItem(save, 'lenh_bai') : false; }

  /* Cá riêng từng khu (bản nhẹ của FISH_DEFS ở src/01-data.js). */
  var FISH_BY_DISTRICT = {
    5: {
      common: { name: 'Cá Chép Sen', icon: '🐟', type: 'Thực phẩm', desc: 'Cá chép hồ sen Bắc Uyển, bán được 150 bạc' },
      rare: { name: 'Cá Chép Sen Vàng', icon: '🐠', type: 'Thực phẩm', desc: 'Cá chép sen vàng hiếm, bán được 500 bạc' },
      epic: { name: 'Cá Chép Vàng Hồ Sen', icon: '🐡', type: 'Thực phẩm', desc: 'Cá chép vàng truyền thuyết của Bắc Uyển, bán được 2.000 bạc' }
    },
    8: {
      common: { name: 'Cá Chép Sông', icon: '🐟', type: 'Thực phẩm', desc: 'Cá chép bến sông, bán được 150 bạc' },
      rare: { name: 'Cá Chép Bạc Sông', icon: '🐠', type: 'Thực phẩm', desc: 'Cá chép bạc hiếm, bán được 500 bạc' },
      epic: { name: 'Cá Chép Vàng Sông', icon: '🐡', type: 'Thực phẩm', desc: 'Cá chép vàng truyền thuyết của bến sông, bán được 2.000 bạc' }
    }
  };

  /* Chợ đêm Phố Đông: giảm 30% so với giá ngày (giá gốc trong ngoặc). */
  var NIGHT_MARKET = [
    { name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', price: 70, was: 100, qty: 1 },
    { name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', price: 105, was: 150, qty: 1 },
    { name: 'Mồi Câu', icon: '🪱', type: 'Vật phẩm', desc: 'Mồi câu cá, mỗi lần câu tốn 1 mồi', price: 175, was: 250, qty: 5 },
    { name: 'Huyền Thiết Tinh', icon: '💎', type: 'Nguyên liệu', desc: 'Rèn trang bị', price: 560, was: 800, qty: 1 },
    { name: 'Lá Sen', icon: '🍃', type: 'Nguyên liệu', desc: 'Lá sen phơi khô, dùng chế đan', price: 252, was: 360, qty: 3 }
  ];
  /* Chợ đen Ngõ Hẹp: đồ hiếm giá cao, chỉ bán ban đêm. */
  var BLACK_MARKET = [
    { name: 'Đá Cường Hóa', icon: '💎', type: 'Nguyên liệu', desc: 'Đá cường hóa trang bị hiếm', price: 8000, qty: 1 },
    { name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', price: 3000, qty: 5 },
    { name: 'Huyền Thiết Tinh', icon: '💎', type: 'Nguyên liệu', desc: 'Rèn trang bị', price: 5000, qty: 3 },
    { name: 'Long Châu Nhỏ', icon: '🐉', type: 'Tín vật', desc: 'Long châu nhỏ, nghe nói là mảnh của Long Châu Biển Đông', price: 15000, qty: 1 }
  ];

  Object.assign(D, {
    /* ---- Điều phối hoạt động theo id (khớp activities[].id ở 10b) ---- */
    runActivity: function (id) {
      var fn = {
        'shop-link': this.actShopLink, 'cho-dem': this.actNightMarket,
        'ty-vo': this.actSparring, 'luyen-skill': this.actTrain,
        'xin-qua-cong': this.actGatePass, 'tuan-tra': this.actPatrol,
        'cau-ca': this.actFishing, 'hai-sen': this.actLotus,
        'quest-an': this.actHiddenQuest, 'cho-den': this.actBlackMarket,
        'doc-lore': this.actLore, 'boss-an': this.actBossMieu,
        'du-thuyen': this.actBoat, 'gieo-gat': this.actFarm,
        'thap-huong': this.actIncense, 'danh-duoi-ma': this.actGhosts,
        'nhat-do': this.actThacGuide, 'doi-thuong': this.actThacReward,
        'boss-cuoi': this.actBossHang
      }[id];
      if (fn) fn.call(this);
      else this.toast('Hoạt động này chưa mở.', 'red');
    },

    /* ---- Phố Đông ---- */
    actShopLink: function () {
      persistSave(this);
      window.location.href = '../Shop.html';
    },
    actNightMarket: function () {
      if (!isNight(this.save)) {
        this.openModal('🌙 Chợ Đêm Phố Đông',
          '<p>Chợ đêm chỉ mở <b>ban đêm (18h–6h giờ game)</b>. Hiện tại là ban ngày — các sạp vẫn bán giá thường, thiếu hiệp quay lại khi trời tối nhé!</p><p class="d-note">Ban đêm ở đây: toàn bộ hàng giảm giá 30%, có món chỉ bán đêm.</p>',
          [{ label: 'Đã rõ', act: 'close-modal', primary: true }]);
        return;
      }
      this.openShopList('🌙 Chợ Đêm Phố Đông — giảm 30%', 'Hàng đêm giảm giá, chỉ bán tới 6h sáng giờ game.', NIGHT_MARKET, 'night');
    },
    openShopList: function (title, note, items, kind) {
      var self = this;
      var html = '<p class="d-note">' + note + '</p><div class="d-shop-list">';
      items.forEach(function (it, i) {
        html += '<div class="d-shop-row"><div class="d-shop-info"><b>' + it.icon + ' ' + it.name + ' ×' + it.qty + '</b><span>' + it.desc + '</span></div>' +
          '<div class="d-shop-buy"><b>⚪ ' + fmtFull(it.price) + ' bạc</b>' + (it.was ? ' <s>' + fmtFull(it.was) + '</s>' : '') +
          '<button class="d-btn" data-dact="buy:' + kind + ':' + i + '">Mua</button></div></div>';
      });
      html += '</div>';
      this._shopItems = items; this._shopKind = kind;
      this.openModal(title, html, [{ label: 'Đóng', act: 'close-modal' }]);
    },
    buyShopItem: function (spec) {
      var parts = spec.split(':');
      var kind = parts[0], idx = Number(parts[1]);
      var items = (kind === 'night') ? NIGHT_MARKET : BLACK_MARKET;
      var it = items[idx];
      if (!it) return;
      var p = this.save.player;
      if (p.silver < it.price) { this.toast('Không đủ bạc! Cần ' + fmtFull(it.price) + ' bạc.', 'red'); return; }
      p.silver -= it.price;
      addItemFn(this.save, it.name, it.icon, it.type, it.desc, it.qty);
      persistSave(this); this.updateHUD();
      this.toast('🛒 Đã mua ' + it.name + ' ×' + it.qty + ' (-' + fmtFull(it.price) + ' bạc)', 'green');
      /* Vẽ lại danh sách để cập nhật tiền (giữ modal mở). */
      if (kind === 'night') this.openShopList('🌙 Chợ Đêm Phố Đông — giảm 30%', 'Hàng đêm giảm giá, chỉ bán tới 6h sáng giờ game.', NIGHT_MARKET, 'night');
      else this.openShopList('🌑 Chợ Đen Ngõ Hẹp', 'Đồ hiếm giá cao — tiền nào của nấy, chỉ bán ban đêm.', BLACK_MARKET, 'black');
    },

    /* ---- Thanh timing dùng chung (câu cá / hái sen / tỷ võ) ---- */
    _timingTimer: null, _timingPos: 0, _timingDir: 1, _timingCb: null,
    openTiming: function (opts) {
      var self = this;
      var zonesHtml = opts.zones.map(function (z) {
        return '<div class="d-zone" style="left:' + z.from + '%;width:' + (z.to - z.from) + '%;background:' + (z.color || '#22c55e') + '"></div>';
      }).join('');
      this.openModal(opts.title,
        '<p>' + opts.hint + '</p>' +
        '<div class="d-bar"><div class="d-bar-track">' + zonesHtml + '<div class="d-marker" id="d-timing-marker"></div></div></div>' +
        '<p class="d-note">' + opts.note + '</p>',
        [{ label: opts.buttonLabel || '⛔ Dừng lại!', act: 'timing-stop', primary: true }, { label: 'Hủy', act: 'close-modal' }]);
      this._timingPos = 0; this._timingDir = 1; this._timingCb = opts.onStop;
      this._timingTimer = setInterval(function () {
        self._timingPos += self._timingDir * 2.4;
        if (self._timingPos >= 100) { self._timingPos = 100; self._timingDir = -1; }
        if (self._timingPos <= 0) { self._timingPos = 0; self._timingDir = 1; }
        var m = document.getElementById('d-timing-marker');
        if (m) m.style.left = self._timingPos + '%';
        else { clearInterval(self._timingTimer); self._timingTimer = null; }
      }, 16);
    },
    timingStop: function () {
      if (this._timingTimer) { clearInterval(this._timingTimer); this._timingTimer = null; }
      var cb = this._timingCb, pos = this._timingPos;
      this._timingCb = null;
      this.closeModal();
      if (cb) cb(pos);
    },

    /* ---- Câu cá / hái sen (bản nhẹ của Interact ở src/01-data.js) ---- */
    actFishing: function () {
      var self = this;
      var bait = null;
      for (var i = 0; i < this.save.inventory.length; i++) if (this.save.inventory[i].name === 'Mồi Câu') bait = this.save.inventory[i];
      if (!bait || bait.qty < 1) {
        this.toast('Hết Mồi Câu rồi! Mua ở Chợ Biện Kinh (Shop.html) hoặc nhận 5 mồi mỗi ngày game ở Biện Kinh Thành.', 'red');
        return;
      }
      var table = FISH_BY_DISTRICT[this.def.id] || FISH_BY_DISTRICT[5];
      this.openTiming({
        title: '🎣 Câu Cá — ' + this.def.name,
        hint: 'Kim đang chạy… bấm <b>Dừng lại</b> đúng lúc vào vùng xanh (giữa là vùng vàng: cá sử thi)! Tốn 1 Mồi Câu.',
        note: 'Vùng vàng giữa [47–53]: Cá Vàng · Vùng xanh [35–65]: trúng (30% cá hiếm). Ngoài vùng: trượt, mất mồi.',
        zones: [{ from: 35, to: 65, color: '#22c55e' }, { from: 47, to: 53, color: '#facc15' }],
        onStop: function (pos) {
          takeItemFn(self.save, 'Mồi Câu', 1);
          var res;
          if (pos >= 47 && pos <= 53) res = { hit: true, rarity: 'epic', fish: table.epic };
          else if (pos >= 35 && pos <= 65) res = Math.random() < 0.3 ? { hit: true, rarity: 'rare', fish: table.rare } : { hit: true, rarity: 'common', fish: table.common };
          else res = { hit: false };
          if (!res.hit) {
            persistSave(self); self.updateHUD();
            self.openModal('🎣 Trượt Rồi!', '<p>Kim dừng ở ' + Math.round(pos) + '% — ngoài vùng cá cắn câu. Mất 1 Mồi Câu, thử lại nhé!</p>',
              [{ label: 'Câu tiếp', act: 'activity:cau-ca', primary: true }, { label: 'Thôi', act: 'close-modal' }]);
            return;
          }
          addItemFn(self.save, res.fish.name, res.fish.icon, res.fish.type, res.fish.desc, 1);
          if (self.def.id === 5) self.save.flags.district.bacuyen_fish += 1;
          persistSave(self); self.updateHUD();
          self.openModal('🎣 Câu Được Cá!', '<p>' + res.fish.icon + ' <b>' + res.fish.name + '</b> (' + (res.rarity === 'epic' ? 'Sử thi ✨' : res.rarity === 'rare' ? 'Hiếm' : 'Thường') + ') đã vào túi đồ!</p><p class="d-note">' + res.fish.desc + '</p>',
            [{ label: 'Câu tiếp', act: 'activity:cau-ca', primary: true }, { label: 'Thôi', act: 'close-modal' }]);
        }
      });
    },
    actLotus: function () {
      var self = this;
      this.openTiming({
        title: '🌸 Hái Sen — ' + this.def.name,
        hint: 'Bấm <b>Hái ngay</b> đúng lúc kim vào vùng sáng giữa thanh!',
        note: 'Vùng sáng [40–60]: trúng — 70% Hạt Sen ×2, 30% Lá Sen ×2. Ngoài vùng: không hái được, không phạt.',
        zones: [{ from: 40, to: 60, color: '#f472b6' }],
        buttonLabel: '🌸 Hái ngay',
        onStop: function (pos) {
          if (pos < 40 || pos > 60) {
            self.openModal('🌸 Hái Trượt', '<p>Kim dừng ở ' + Math.round(pos) + '% — ngoài vùng sáng, sen chưa hái được. Thử lại nhé!</p>',
              [{ label: 'Hái lại', act: 'activity:hai-sen', primary: true }, { label: 'Thôi', act: 'close-modal' }]);
            return;
          }
          var isSeed = Math.random() < 0.7;
          var item = isSeed
            ? { name: 'Hạt Sen', icon: '🫘', type: 'Nguyên liệu', desc: 'Hạt sen thơm bùi, bán được 120 bạc', qty: 2 }
            : { name: 'Lá Sen', icon: '🍃', type: 'Nguyên liệu', desc: 'Lá sen phơi khô, dùng chế đan', qty: 2 };
          addItemFn(self.save, item.name, item.icon, item.type, item.desc, item.qty);
          if (self.def.id === 5) self.save.flags.district.bacuyen_lotus += 1;
          persistSave(self); self.updateHUD();
          self.openModal('🌸 Hái Được Sen!', '<p>' + item.icon + ' <b>' + item.name + ' ×' + item.qty + '</b> đã vào túi đồ!</p>',
            [{ label: 'Hái tiếp', act: 'activity:hai-sen', primary: true }, { label: 'Thôi', act: 'close-modal' }]);
        }
      });
    },

    /* ---- Phố Tây: tỷ võ + luyện skill ---- */
    actSparring: function () {
      var self = this;
      var round = 0, hits = 0;
      var totalRounds = 3;
      var nextRound = function () {
        round++;
        if (round > totalRounds) {
          var exp = 60 + 60 * hits + (hits === 3 ? 100 : 0);
          self.save.flags.district.vo_diem = (self.save.flags.district.vo_diem || 0) + hits;
          var lv = gainExpFn(self.save, exp);
          persistSave(self); self.updateHUD();
          self.openModal('⚔️ Kết Quả Tỷ Võ',
            '<p>Thắng <b>' + hits + '/' + totalRounds + '</b> hiệp trước Đệ Tử Luyện Võ!</p>' +
            '<p class="d-note">Thưởng: +' + exp + ' EXP' + (hits === 3 ? ' (thắng tuyệt đối +100 EXP)' : '') + ' · Điểm tỷ võ: ' + self.save.flags.district.vo_diem + (lv ? ' · ⚡ Đột phá lên cấp ' + self.save.player.level + '!' : '') + '</p>',
            [{ label: 'Đấu lại', act: 'activity:ty-vo', primary: true }, { label: 'Thôi', act: 'close-modal' }]);
          return;
        }
        var center = 30 + Math.random() * 40;
        self.openTiming({
          title: '⚔️ Tỷ Võ — Hiệp ' + round + '/' + totalRounds,
          hint: 'Đệ Tử Luyện Võ xuất chiêu! Bấm <b>Dừng lại</b> khi kim vào vùng xanh để đỡ đòn và phản công.',
          note: 'Vùng xanh rộng 24% — trúng vùng là thắng hiệp.',
          zones: [{ from: Math.max(0, center - 12), to: Math.min(100, center + 12), color: '#38bdf8' }],
          onStop: function (pos) {
            var hit = pos >= center - 12 && pos <= center + 12;
            if (hit) hits++;
            self.openModal(hit ? '💥 Trúng Đòn!' : '💨 Trượt Rồi!',
              '<p>' + (hit ? 'Phản công đẹp mắt! Thắng hiệp ' + round + '.' : 'Kim dừng ở ' + Math.round(pos) + '% — đỡ trượt, thua hiệp ' + round + '.') + '</p>',
              [{ label: round >= totalRounds ? 'Xem kết quả' : 'Hiệp tiếp theo', fn: function () { self.closeModal(); nextRound(); }, primary: true }]);
          }
        });
      };
      nextRound();
    },
    actTrain: function () {
      var d = this.save.flags.district, day = this.save.worldClock.day;
      if (d.vo_luyen_day === day) { this.toast('Hôm nay đã luyện skill rồi — mỗi ngày game chỉ luyện được 1 lần!', 'gold'); return; }
      var self = this;
      this.openModal('🥋 Luyện Skill Với Võ Sư',
        '<p>Võ Sư Thiết Quyền truyền thụ võ công: tốn <b>2.000 bạc</b>, nhận <b>+12 Công kích</b> và <b>+100 EXP</b>.</p><p class="d-note">Giới hạn 1 lần/ngày game. Bạc hiện có: ' + fmtFull(this.save.player.silver) + '</p>',
        [{ label: 'Luyện ngay (-2.000 bạc)', primary: true, fn: function () {
          if (self.save.player.silver < 2000) { self.toast('Không đủ bạc! Cần 2.000 bạc.', 'red'); return; }
          self.save.player.silver -= 2000;
          self.save.player.atk += 12;
          d.vo_luyen_day = day;
          var lv = gainExpFn(self.save, 100);
          persistSave(self); self.updateHUD(); self.closeModal();
          self.toast('🥋 Luyện skill xong! Công kích +12, +100 EXP' + (lv ? ' · ⚡ Lên cấp ' + self.save.player.level + '!' : ''), 'green');
        } }, { label: 'Để sau', act: 'close-modal' }]);
    },

    /* ---- Nam Môn: giấy thông hành + tuần tra ---- */
    actGatePass: function () {
      var d = this.save.flags.district;
      if (!isNight(this.save)) {
        this.openModal('🚪 Cổng Nam Môn Đang Mở',
          '<p>Ban ngày cổng mở cho bá tánh qua lại, thiếu hiệp cứ đi qua. Ban đêm cổng mới đóng — khi đó cần <b>Lệnh Bài Biện Kinh</b> để xin giấy thông hành.</p>',
          [{ label: 'Đã rõ', act: 'close-modal', primary: true }]);
        return;
      }
      if (d.nam_mon_pass) {
        this.toast('🎫 Thiếu hiệp đã có giấy thông hành — cứ qua cổng ban đêm thoải mái!', 'green');
        return;
      }
      if (!hasLenhBai(this.save)) {
        this.openModal('🔴 Cổng Đã Đóng',
          '<p>Ban đêm cổng Nam Môn đóng để phòng giặc. Lính gác yêu cầu <b>Lệnh Bài Biện Kinh</b> mới cấp giấy thông hành.</p><p class="d-note">Lệnh Bài nhận được khi đánh bại Boss ẩn Hộ Pháp Đá ở Miếu Cổ Di Tích.</p>',
          [{ label: 'Đã rõ', act: 'close-modal', primary: true }]);
        return;
      }
      d.nam_mon_pass = true;
      persistSave(this); this.updateGateVisual();
      this.toast('🎫 Lính gác đã cấp giấy thông hành! Giờ thiếu hiệp qua được cổng Nam Môn ban đêm.', 'green');
    },
    actPatrol: function () {
      var d = this.save.flags.district, day = this.save.worldClock.day;
      if (d.patrol_day === day) { this.toast('Hôm nay đã tuần tra rồi — 1 lần/ngày game thôi!', 'gold'); return; }
      d.patrol_day = day;
      this.save.player.silver += 800;
      var lv = gainExpFn(this.save, 60);
      persistSave(this); this.updateHUD();
      this.toast('🛡️ Tuần tra xong! +800 bạc +60 EXP' + (lv ? ' · ⚡ Lên cấp ' + this.save.player.level + '!' : ''), 'green');
    },

    /* ---- Ngõ Hẹp: quest ẩn + chợ đen ---- */
    actHiddenQuest: function () {
      var d = this.save.flags.district;
      if (d.ngo_done) { this.toast('✅ Quest ẩn “Mảnh Giấy Rách” đã hoàn thành rồi!', 'green'); return; }
      var npc = null;
      for (var i = 0; i < this.npcs.length; i++) if (this.npcs[i].def.id === 'nh-mystery') npc = this.npcs[i];
      if (npc) {
        var p = this.player.mesh.position;
        this.moveTo(npc.mesh.position.x, npc.mesh.position.z + 1.6, function () { D.talkTo(npc); });
        this.toast('🕵️ Hãy tới gặp Người Bí Ẩn trong ngõ…', 'gold');
      }
    },
    actBlackMarket: function () {
      if (!isNight(this.save)) {
        this.openModal('🌑 Chợ Đen Chưa Mở',
          '<p>Chợ đen chỉ mở <b>ban đêm (18h–6h giờ game)</b> — “trăng lên thì chợ mở”. Ban ngày Thương Nhân Chợ Đen chỉ bán đèn dầu thôi!</p>',
          [{ label: 'Đã rõ', act: 'close-modal', primary: true }]);
        return;
      }
      this.openShopList('🌑 Chợ Đen Ngõ Hẹp', 'Đồ hiếm giá cao — tiền nào của nấy, chỉ bán ban đêm.', BLACK_MARKET, 'black');
    },

    /* ---- Miếu Cổ: lore + boss ẩn ---- */
    actLore: function () {
      var lore = (typeof DISTRICT_MIEU_LORE !== 'undefined') ? DISTRICT_MIEU_LORE : [];
      var html = lore.map(function (p, i) { return '<p class="d-lore"><b>' + (i + 1) + '.</b> ' + p + '</p>'; }).join('');
      html += '<p class="d-note">📖 Nối tiếp lời kể của Lão Kể Chuyện ở quảng trường Biện Kinh — 5 câu chuyện đầu là chuyện lão hay kể, đoạn cuối là bí mật riêng của Miếu Cổ.</p>';
      if (this.save.flags.npc) { this.save.flags.npc.loreRead = (this.save.flags.npc.loreRead || 0) + 1; persistSave(this); }
      this.openModal('📖 Truyền Thuyết Miếu Cổ', html, [{ label: 'Đóng', act: 'close-modal', primary: true }]);
    },

    /* ---- Boss: đánh theo lượt trong modal ---- */
    _boss: null,
    startBossFight: function (bossDef, flagKey, tryKey) {
      var d = this.save.flags.district, day = this.save.worldClock.day;
      if (d[flagKey + '_day'] === day) { this.toast('Boss này hôm nay đã bị đánh bại rồi — quay lại ngày game sau!', 'gold'); return; }
      if (d[tryKey] === day) { this.toast('Hôm nay đã thách đấu một lần rồi — mỗi ngày game chỉ được thách đấu 1 lần!', 'gold'); return; }
      d[tryKey] = day;
      persistSave(this);
      var p = this.save.player;
      this._boss = {
        def: bossDef, flagKey: flagKey,
        bossMax: bossDef.hp, bossHp: bossDef.hp,
        pMax: Math.max(1, p.maxHp), pHp: Math.max(1, p.hp > 0 ? p.hp : p.maxHp),
        ultUsed: false,
        counterPct: flagKey === 'boss_hang_dong' ? 0.12 : 0.08
      };
      this.renderBoss();
    },
    renderBoss: function () {
      var b = this._boss;
      if (!b) return;
      var self = this;
      var bp = Math.max(0, Math.round(b.bossHp / b.bossMax * 100));
      var pp = Math.max(0, Math.round(b.pHp / b.pMax * 100));
      var html =
        '<p class="d-note">Boss ' + (b.def.oncePerDay ? 'chỉ thách đấu 1 lần/ngày game' : '') + ' · Tấn công gây ~8% HP boss + sức mạnh của thiếu hiệp · Tuyệt kỹ 1 lần/trận gây 25% HP boss · Hồi máu tốn 1 Kim Sáng Dược (+40% HP).</p>' +
        '<div class="d-fight"><div class="d-fighter"><b>👹 ' + b.def.name + '</b><div class="d-hpbar"><i style="width:' + bp + '%;background:#ef4444"></i></div><span>' + fmtFull(Math.max(0, b.bossHp)) + ' / ' + fmtFull(b.bossMax) + ' HP</span></div>' +
        '<div class="d-fighter"><b>⚔️ ' + this.save.player.name + ' (Cấp ' + this.save.player.level + ')</b><div class="d-hpbar"><i style="width:' + pp + '%;background:#22c55e"></i></div><span>' + fmtFull(Math.max(0, b.pHp)) + ' / ' + fmtFull(b.pMax) + ' HP</span></div></div>' +
        '<p id="d-fight-log" class="d-note">Trận đấu bắt đầu! Thiếu hiệp ra chiêu trước.</p>';
      this.openModal('⚔️ ' + b.def.name, html, [
        { label: '⚔️ Tấn công', act: 'boss:attack', primary: true },
        { label: b.ultUsed ? '💥 Tuyệt kỹ (đã dùng)' : '💥 Tuyệt kỹ', act: 'boss:ult' },
        { label: '🧪 Hồi máu', act: 'boss:heal' },
        { label: '🏳️ Rút lui', act: 'boss:flee' }
      ]);
    },
    bossAction: function (act) {
      var b = this._boss;
      if (!b) return;
      var self = this, p = this.save.player;
      var log = function (t) { var el = document.getElementById('d-fight-log'); if (el) el.textContent = t; };
      if (act === 'flee') { this._boss = null; this.closeModal(); this.toast('Đã rút lui khỏi trận đấu.', 'gold'); return; }
      if (act === 'heal') {
        if (!takeItemFn(this.save, 'Kim Sáng Dược', 1)) { this.toast('Không có Kim Sáng Dược trong túi!', 'red'); return; }
        var heal = Math.round(b.pMax * 0.4);
        b.pHp = Math.min(b.pMax, b.pHp + heal);
        log('🧪 Hồi +' + fmtFull(heal) + ' HP!');
      } else if (act === 'ult') {
        if (b.ultUsed) { this.toast('Tuyệt kỹ mỗi trận chỉ dùng được 1 lần!', 'gold'); return; }
        b.ultUsed = true;
        var dmgU = Math.round(b.bossMax * 0.25);
        b.bossHp -= dmgU;
        log('💥 Tuyệt kỹ gây ' + fmtFull(dmgU) + ' sát thương!');
      } else if (act === 'attack') {
        var dmg = Math.round(b.bossMax * 0.08 + p.atk * 2 + p.level * 100);
        b.bossHp -= dmg;
        log('⚔️ Tấn công gây ' + fmtFull(dmg) + ' sát thương!');
      }
      if (b.bossHp <= 0) { this.winBoss(b); return; }
      /* Boss phản công. */
      var counter = Math.round(b.pMax * b.counterPct);
      b.pHp -= counter;
      if (b.pHp <= 0) {
        this._boss = null;
        persistSave(this); this.updateHUD();
        this.openModal('💀 Thua Trận', '<p>' + b.def.name + ' phản công ' + fmtFull(counter) + ' sát thương — thiếu hiệp gục ngã! Về luyện thêm rồi quay lại ngày game sau nhé.</p>',
          [{ label: 'Đã rõ', act: 'close-modal', primary: true }]);
        return;
      }
      this.renderBoss();
      var el = document.getElementById('d-fight-log');
      if (el) el.textContent = (act === 'attack' ? '⚔️ Tấn công gây sát thương! ' : act === 'ult' ? '💥 Tuyệt kỹ! ' : '🧪 Hồi máu! ') + 'Boss phản công ' + fmtFull(counter) + ' sát thương.';
    },
    winBoss: function (b) {
      var d = this.save.flags.district, day = this.save.worldClock.day, rw = b.def.reward || {};
      this._boss = null;
      d[b.flagKey] = true;
      d[b.flagKey + '_day'] = day;
      var parts = [];
      if (rw.silver) { this.save.player.silver += rw.silver; parts.push('+' + fmtFull(rw.silver) + ' bạc'); }
      if (rw.gold) { this.save.player.gold += rw.gold; parts.push('+' + rw.gold + ' KNB'); }
      var lv = 0;
      if (rw.exp) lv = gainExpFn(this.save, rw.exp);
      if (rw.exp) parts.push('+' + rw.exp + ' EXP');
      if (rw.item === 'lenh_bai') {
        addItemFn(this.save, 'Lệnh Bài Biện Kinh', '🎫', 'Tín vật', 'Lệnh bài do Miếu Cổ ban — qua được cổng Nam Môn ban đêm, mở được Hang Động Bí Mật.', 1);
        var it = null;
        for (var i = 0; i < this.save.inventory.length; i++) if (this.save.inventory[i].name === 'Lệnh Bài Biện Kinh') it = this.save.inventory[i];
        if (it) it.id = 'lenh_bai';
        parts.push('🎫 Lệnh Bài Biện Kinh');
      }
      this.save.player.hp = this.save.player.maxHp;
      persistSave(this); this.updateHUD();
      this.openModal('🏆 Chiến Thắng!',
        '<p>Đã đánh bại <b>' + b.def.name + '</b>!</p><p class="d-note">Thưởng: ' + parts.join(' · ') + (lv ? ' · ⚡ Đột phá lên cấp ' + this.save.player.level + '!' : '') + '</p>' +
        (b.flagKey === 'boss_mieu_co' ? '<p>🎫 Với Lệnh Bài Biện Kinh, thiếu hiệp đã mở được <b>Hang Động Bí Mật</b> — và qua được cổng Nam Môn ban đêm!</p>' : '<p>👑 Ma Quân Hang Động đã bị đánh bại — thiếu hiệp chính là người mạnh nhất vùng này!</p>'),
        [{ label: 'Tuyệt vời!', act: 'close-modal', primary: true }]);
    },
    actBossMieu: function () {
      var boss = (this.def && this.def.boss) || { name: 'Hộ Pháp Đá Miếu Cổ', hp: 12000, reward: { silver: 8000, gold: 15, exp: 600, item: 'lenh_bai' }, oncePerDay: true };
      this.startBossFight(boss, 'boss_mieu_co', 'boss_mieu_co_try_day');
    },
    actBossHang: function () {
      var boss = (this.def && this.def.boss) || { name: 'Ma Quân Hang Động', hp: 30000, reward: { silver: 20000, gold: 40, exp: 1500, item: null }, oncePerDay: true };
      this.startBossFight(boss, 'boss_hang_dong', 'boss_hang_dong_try_day');
    },

    /* ---- Bến Sông: du thuyền ---- */
    actBoat: function () {
      var d = this.save.flags.district, day = this.save.worldClock.day;
      if (d.boat_day === day) { this.toast('Hôm nay đã du thuyền rồi — 1 lần/ngày game thôi!', 'gold'); return; }
      var self = this;
      this.openModal('⛵ Du Thuyền Ngắm Cảnh',
        '<p>Người Lái Đò chèo thuyền ra giữa sông: hoàng hôn đỏ rực, gió mát lồng lộng, cá chép nhảy khỏi mặt nước. Tốn <b>300 bạc</b>, nhận <b>+150 EXP</b> và một con cá tươi.</p><p class="d-note">Bạc hiện có: ' + fmtFull(this.save.player.silver) + '</p>',
        [{ label: 'Xuống thuyền (-300 bạc)', primary: true, fn: function () {
          if (self.save.player.silver < 300) { self.toast('Không đủ bạc! Cần 300 bạc.', 'red'); return; }
          self.save.player.silver -= 300;
          d.boat_day = day;
          var fish = Math.random() < 0.3
            ? { name: 'Cá Chép Bạc Sông', icon: '🐠', type: 'Thực phẩm', desc: 'Cá chép bạc hiếm, bán được 500 bạc' }
            : { name: 'Cá Chép Sông', icon: '🐟', type: 'Thực phẩm', desc: 'Cá chép bến sông, bán được 150 bạc' };
          addItemFn(self.save, fish.name, fish.icon, fish.type, fish.desc, 1);
          gainExpFn(self.save, 150);
          persistSave(self); self.updateHUD(); self.closeModal();
          self.toast('⛵ Du thuyền xong! +150 EXP, nhận ' + fish.name + '!', 'green');
        } }, { label: 'Để sau', act: 'close-modal' }]);
    },

    /* ---- Ruộng Lúa: gieo / gặt theo ngày game ---- */
    actFarm: function () {
      var d = this.save.flags.district, day = this.save.worldClock.day, self = this;
      if (d.ruong_stage === 0) {
        this.openModal('🌾 Gieo Hạt',
          '<p>Gieo hạt tốn <b>200 bạc</b> tiền giống. Lúa sẽ chín vào <b>ngày game ' + (day + 1) + '</b> — quay lại gặt nhận <b>Lúa Vàng ×10 + 2.000 bạc + 120 EXP</b>.</p>',
          [{ label: 'Gieo ngay (-200 bạc)', primary: true, fn: function () {
            if (self.save.player.silver < 200) { self.toast('Không đủ bạc! Cần 200 bạc.', 'red'); return; }
            self.save.player.silver -= 200;
            d.ruong_stage = 1; d.ruong_ready_day = day + 1;
            persistSave(self); self.updateHUD(); self.closeModal();
            self.toast('🌾 Đã gieo hạt! Lúa chín vào ngày game ' + d.ruong_ready_day + ' — nhớ quay lại gặt.', 'green');
          } }, { label: 'Để sau', act: 'close-modal' }]);
      } else if (day >= d.ruong_ready_day) {
        d.ruong_stage = 0; d.ruong_ready_day = 0;
        addItemFn(this.save, 'Lúa Vàng', '🌾', 'Nguyên liệu', 'Lúa vàng óng, bán được 200 bạc', 10);
        this.save.player.silver += 2000;
        var lv = gainExpFn(this.save, 120);
        persistSave(this); this.updateHUD();
        this.toast('🌾 Gặt lúa xong! +Lúa Vàng ×10, +2.000 bạc, +120 EXP' + (lv ? ' · ⚡ Lên cấp ' + this.save.player.level + '!' : ''), 'green');
      } else {
        this.toast('🌾 Lúa chưa chín — hạt mới gieo, chín vào ngày game ' + d.ruong_ready_day + ' (hôm nay ngày ' + day + ').', 'gold');
      }
    },

    /* ---- Nghĩa Trang: thắp hương + đánh đuổi ma (ban đêm) ---- */
    actIncense: function () {
      var d = this.save.flags.district, day = this.save.worldClock.day;
      if (d.nghia_huong_day === day) { this.toast('Hôm nay đã thắp hương rồi — 1 lần/ngày game thôi!', 'gold'); return; }
      var self = this;
      this.openModal('🕯️ Thắp Hương',
        '<p>Mua hương tốn <b>300 bạc</b>, thắp cho người đã khuất — nhận lộc <b>+1.500 bạc +250 EXP</b>.</p>',
        [{ label: 'Thắp hương (-300 bạc)', primary: true, fn: function () {
          if (self.save.player.silver < 300) { self.toast('Không đủ bạc! Cần 300 bạc.', 'red'); return; }
          self.save.player.silver -= 300;
          d.nghia_huong_day = day;
          self.save.player.silver += 1500;
          var lv = gainExpFn(self.save, 250);
          persistSave(self); self.updateHUD(); self.closeModal();
          self.toast('🕯️ Hương đã thắp! Nhận lộc +1.500 bạc +250 EXP' + (lv ? ' · ⚡ Lên cấp ' + self.save.player.level + '!' : ''), 'green');
        } }, { label: 'Để sau', act: 'close-modal' }]);
    },
    _ghostLeft: 0,
    actGhosts: function () {
      var d = this.save.flags.district, day = this.save.worldClock.day;
      if (d.nghia_duoi_day === day) { this.toast('Hôm nay đã đánh đuổi ma rồi — 1 lần/ngày game thôi!', 'gold'); return; }
      var self = this;
      this._ghostLeft = 3;
      this.openModal('👻 Đánh Đuổi Ma Quái',
        '<p>3 hồn ma đang bay lượn trong nghĩa trang! <b>Bấm trúng</b> từng con để đánh đuổi — chúng bay nhanh lắm, bấm trượt là chúng đổi chỗ!</p><div class="d-ghost-area" id="d-ghost-area">' +
        '<button class="d-ghost" data-dact="ghost-hit" style="left:10%;top:20%">👻</button>' +
        '<button class="d-ghost" data-dact="ghost-hit" style="left:55%;top:55%">👻</button>' +
        '<button class="d-ghost" data-dact="ghost-hit" style="left:75%;top:15%">👻</button></div>' +
        '<p class="d-note">Còn lại: <b id="d-ghost-left">3</b> hồn ma</p>',
        [{ label: 'Thôi, để ma ở đó', act: 'close-modal' }]);
      this._ghostTimer = setInterval(function () {
        document.querySelectorAll('#d-ghost-area .d-ghost').forEach(function (g) {
          g.style.left = (5 + Math.random() * 80) + '%';
          g.style.top = (5 + Math.random() * 70) + '%';
        });
      }, 1200);
    },
    ghostHit: function (btn) {
      if (btn.parentNode) btn.parentNode.removeChild(btn);
      this._ghostLeft -= 1;
      var left = document.getElementById('d-ghost-left');
      if (left) left.textContent = Math.max(0, this._ghostLeft);
      if (this._ghostLeft <= 0) {
        if (this._ghostTimer) { clearInterval(this._ghostTimer); this._ghostTimer = null; }
        var d = this.save.flags.district;
        d.nghia_duoi_day = this.save.worldClock.day;
        this.save.player.silver += 2000;
        var lv = gainExpFn(this.save, 200);
        persistSave(this); this.updateHUD();
        this.openModal('👻 Đã Đuổi Hết Ma!',
          '<p>3 hồn ma đã bị đánh đuổi khỏi nghĩa trang! Thưởng: <b>+2.000 bạc +200 EXP</b>' + (lv ? ' · ⚡ Lên cấp ' + this.save.player.level + '!' : '') + '</p>',
          [{ label: 'Tuyệt vời!', act: 'close-modal', primary: true }]);
      } else {
        this.toast('💥 Đánh đuổi được 1 hồn ma! Còn ' + this._ghostLeft + ' con.', 'green');
      }
    },

    /* ---- Thác Nước: hướng dẫn + đổi thưởng ---- */
    actThacGuide: function () {
      var d = this.save.flags.district, got = d.thac_collected || {};
      var n = Object.keys(got).filter(function (k) { return got[k]; }).length;
      this.openModal('💎 Nhặt Vật Phẩm Thác',
        '<p>5 vật phẩm phát sáng đang nằm quanh thác: <b>Đá Thác Cổ, Lá Thác Vàng, Ngọc Thác Xanh, Hoa Thác Trắng, Trân Châu Thác</b>.</p><p>Đi tới gần vật phẩm phát sáng (✨) rồi bấm nút <b>✋ Nhặt</b> hiện ra — hoặc chạm vào nó.</p><p class="d-note">Đã nhặt: ' + n + '/5' + (d.thac_done ? ' · ✅ Đã đổi thưởng' : '') + '</p>',
        [{ label: 'Đi nhặt ngay', act: 'close-modal', primary: true }]);
    },
    actThacReward: function () {
      var d = this.save.flags.district, got = d.thac_collected || {};
      var n = Object.keys(got).filter(function (k) { return got[k]; }).length;
      if (d.thac_done) { this.toast('✅ Đã đổi thưởng bộ sưu tập rồi!', 'green'); return; }
      if (n < 5) { this.toast('Chưa đủ bộ! Mới nhặt ' + n + '/5 vật phẩm thác nước.', 'gold'); return; }
      d.thac_done = true;
      this.save.player.silver += 5000;
      this.save.player.gold += 10;
      var lv = gainExpFn(this.save, 300);
      persistSave(this); this.updateHUD();
      this.toast('🎁 Đổi thưởng đủ bộ! +5.000 bạc +10 KNB +300 EXP' + (lv ? ' · ⚡ Lên cấp ' + this.save.player.level + '!' : ''), 'green');
    }
  });
})();
