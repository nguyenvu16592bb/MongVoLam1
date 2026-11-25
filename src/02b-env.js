/* ============================================================================
   PHẦN 1B — MÔI TRƯỜNG ĐỘNG + MỞ RỘNG QUY MÔ (Mộng Võ Lâm 3D)
   - Đồng hồ giờ game (chạy khi ở mode world, 1 giờ game ≈ 75 giây thật ở
     tốc độ 1) + 4 mùa (30 ngày/mùa) + bầu trời/fog/đèn đổi theo giờ.
   - Thời tiết (nắng/mưa/tuyết/sương mù/nắng gắt) theo mùa + ngẫu nhiên.
   - Nước động: lá sen nhấp nhô/trôi, gợn sóng, cá chép bơi trong hồ sen.
   - Gió: tán cây, bạt chợ, cờ đung đưa theo sức gió (mưa mạnh hơn nắng).
   - Mở rộng bản đồ 2–3× (x∈[-45,48], z∈[-40,44]): ruộng lúa, nhà dân,
     đường mòn, cây, đèn — giữ nguyên khu thành cũ + mọi NPC/vị trí cũ.
   - Cổng dịch chuyển: Cổng Son ↔ Giếng Cổ Hồ Sen ↔ Cổng Làng Đào Viên.
   Mọi state mới lưu cùng save v2 (xem src/01-data.js: State.worldClock,
   State.weather, State.settings.clockSpeed/weatherFx). Không đổi signature
   hàm cũ (World.update, Engine.isWalkable, CharacterManager.create,
   SaveManager.save/load, Game.loop).
   ========================================================================== */

/* Lerp 2 màu hex '#rrggbb' (thuần, không cần THREE — để test được bằng Node). */
function hexLerp(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * t));
  const g = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * t));
  const bl = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * t));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}

const Env = {
  GAME_HOUR_SECONDS: 75, /* 1 giờ game ≈ 75 giây thật ở clockSpeed 1 */
  MAX_PARTICLES: 400, /* mưa 400 hạt, tuyết 300 hạt — 1 BufferGeometry tái dùng */
  DAYS_PER_SEASON: 30,

  SEASONS: [
    { id: 'xuan', name: 'Mùa Xuân', petals: [0xffb7c5, 0xffd1dc] },
    { id: 'ha', name: 'Mùa Hạ', petals: [0xbfe3a8, 0xffffff] },
    { id: 'thu', name: 'Mùa Thu', petals: [0xf59e0b, 0xfb923c] },
    { id: 'dong', name: 'Mùa Đông', petals: [0xffffff, 0xe0f2fe] }
  ],

  WEATHER: {
    nang: { icon: '☀️', name: 'Nắng', wind: .5, fog: .0095, hemiMul: 1, dirMul: 1, glare: 0 },
    nanggat: { icon: '🔥', name: 'Nắng gắt', wind: .35, fog: .008, hemiMul: 1.15, dirMul: 1.3, glare: .3 },
    mua: { icon: '🌧️', name: 'Mưa', wind: 1, fog: .016, hemiMul: .75, dirMul: .55, glare: 0 },
    tuyet: { icon: '❄️', name: 'Tuyết rơi', wind: .8, fog: .02, hemiMul: .8, dirMul: .6, glare: 0 },
    suongmu: { icon: '🌫️', name: 'Sương mù', wind: .3, fog: .032, hemiMul: .7, dirMul: .4, glare: 0 }
  },

  /* Tỉ lệ thời tiết theo mùa (mỗi mùa cộng = 100%). Tuyết chỉ xuất hiện mùa đông. */
  WEATHER_WEIGHTS: {
    xuan: [['nang', .45], ['mua', .3], ['suongmu', .25]],
    ha: [['nang', .35], ['nanggat', .25], ['mua', .3], ['suongmu', .1]],
    thu: [['nang', .5], ['mua', .2], ['suongmu', .3]],
    dong: [['tuyet', .45], ['nang', .3], ['suongmu', .25]]
  },

  /* [giờ, màu trời, màu sương, mật độ sương, hemi, dir, màu nắng] */
  SKY_STOPS: [
    [0, '#0b1626', '#0b1626', .014, .25, .12, '#9db8ff'],
    [5, '#0e1a2e', '#101c30', .013, .3, .15, '#a8c0ff'],
    [6.5, '#e8a56b', '#d99a6a', .011, .55, .5, '#ffb36b'],
    [8, '#9fc8e8', '#a8c8d8', .010, .7, .8, '#fff1d6'],
    [12, '#7ec8ee', '#9fd0dd', .009, .85, 1, '#fff6e0'],
    [16, '#8ec4e0', '#a5ccd8', .0095, .75, .9, '#ffeec4'],
    [17.5, '#f0905a', '#d98a5f', .011, .55, .55, '#ff9a4d'],
    [19, '#5a3a5e', '#4a3348', .012, .4, .3, '#b070ff'],
    [20, '#0b1626', '#0b1626', .014, .25, .12, '#9db8ff'],
    [24, '#0b1626', '#0b1626', .014, .25, .12, '#9db8ff']
  ],

  /* 3 cổng dịch chuyển, đi vòng: Cổng Son → Giếng Cổ → Cổng Làng → Cổng Son.
     dx/dz là điểm đáp (đã kiểm là đi được bằng Engine.isWalkable). */
  GATES: [
    { id: 'cong-son', name: 'Cổng Son Biện Kinh', x: -16.2, z: 0, dx: -14.2, dz: 0, kind: 'gate' },
    { id: 'gieng-co', name: 'Giếng Cổ Hồ Sen', x: 6.8, z: 12.5, dx: 6.8, dz: 14.5, kind: 'well' },
    { id: 'cong-lang', name: 'Cổng Làng Đào Viên', x: -28, z: -20, dx: -28, dz: -18.2, kind: 'gate' }
  ],

  _built: false,
  _wind: .5,
  _hudAcc: 0,
  _petalsApplied: false,
  _points: null,
  _pPos: null,
  _pVel: null,
  _pDrift: null,
  _ripples: null,
  _koi: null,
  _glare: null,

  /* ============================== MÙA ============================== */
  seasonForDay(day) {
    const idx = Math.floor((((Math.max(1, day) - 1) % 120) / this.DAYS_PER_SEASON));
    return this.SEASONS[idx].id;
  },
  seasonById(id) {
    return this.SEASONS.find(s => s.id === id) || this.SEASONS[0];
  },

  /* ============================== ĐỒNG HỒ ============================== */
  tickClock(dt) {
    const cs = State.settings.clockSpeed;
    if (!cs || cs <= 0) return null;
    const wc = State.worldClock;
    wc.hour += dt * cs / this.GAME_HOUR_SECONDS;
    let dayChanged = false, seasonChanged = false;
    while (wc.hour >= 24) {
      wc.hour -= 24;
      wc.day += 1;
      dayChanged = true;
      const s = this.seasonForDay(wc.day);
      if (s !== wc.season) { wc.season = s; seasonChanged = true; }
    }
    if (seasonChanged) {
      const info = this.seasonById(wc.season);
      PixiFX.setPetalColors(info.petals[0], info.petals[1]);
      UI.toast('🍂 Đã sang ' + info.name + ' — ngày ' + wc.day + '!', 'gold');
    }
    if (dayChanged) SaveManager.save();
    return seasonChanged ? wc.season : null;
  },

  /* ============================== BẦU TRỜI ============================== */
  skyAt(hour) {
    const stops = this.SKY_STOPS;
    const h = ((hour % 24) + 24) % 24;
    let i = 0;
    while (i < stops.length - 2 && h >= stops[i + 1][0]) i++;
    const a = stops[i], b = stops[i + 1];
    const t = clamp((h - a[0]) / (b[0] - a[0] || 1), 0, 1);
    const hemi = lerp(a[4], b[4], t), dir = lerp(a[5], b[5], t);
    return {
      sky: hexLerp(a[1], b[1], t),
      fog: hexLerp(a[2], b[2], t),
      fogDensity: lerp(a[3], b[3], t),
      hemi, dir,
      dirColor: hexLerp(a[6], b[6], t),
      darkness: clamp(1 - (hemi + dir) / 1.7, 0, 1)
    };
  },

  applySky(preset, wdef) {
    const scene = Engine.scene;
    if (!scene) return;
    if (scene.background && scene.background.set) scene.background.set(preset.sky);
    if (scene.fog) {
      if (scene.fog.color && scene.fog.color.set) scene.fog.color.set(preset.fog);
      scene.fog.density = Math.max(preset.fogDensity, wdef.fog);
    }
    if (Engine.hemiLight) Engine.hemiLight.intensity = preset.hemi * wdef.hemiMul;
    if (Engine.dirLight) {
      Engine.dirLight.intensity = preset.dir * wdef.dirMul;
      if (Engine.dirLight.color && Engine.dirLight.color.set) Engine.dirLight.color.set(preset.dirColor);
    }
    /* Đèn lồng sáng dần ban đêm. */
    const d = preset.darkness;
    Engine.lanternLights.forEach(L => {
      L.light.intensity = .55 + d * 1.1;
      if (L.mat) L.mat.emissiveIntensity = .65 + d * .9;
    });
  },

  /* ============================== THỜI TIẾT ============================== */
  pickWeather(season, r) {
    const table = this.WEATHER_WEIGHTS[season] || this.WEATHER_WEIGHTS.xuan;
    let roll = (r == null ? Math.random() : r);
    for (let i = 0; i < table.length; i++) {
      roll -= table[i][1];
      if (roll < 0) return table[i][0];
    }
    return table[table.length - 1][0];
  },

  advanceWeather(dt) {
    const w = State.weather;
    w.remain -= dt;
    if (w.remain > 0) return null;
    const kind = this.pickWeather(State.worldClock.season);
    w.kind = kind;
    w.remain = 150 + Math.random() * 150; /* 150–300 giây thật (2,5–5 phút) */
    const def = this.WEATHER[kind];
    if (State.settings.weatherFx && Game.mode === 'world') {
      UI.toast(def.icon + ' Trời chuyển ' + def.name.toLowerCase() + '!', 'blue');
    }
    SaveManager.save();
    return kind;
  },

  /* ============================== MƯA / TUYẾT ============================== */
  initParticles() {
    const geo = new THREE.BufferGeometry();
    this._pPos = new Float32Array(this.MAX_PARTICLES * 3);
    this._pVel = new Float32Array(this.MAX_PARTICLES);
    this._pDrift = new Float32Array(this.MAX_PARTICLES);
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this._pPos[i * 3] = rnd(-15, 15);
      this._pPos[i * 3 + 1] = rnd(0, 14);
      this._pPos[i * 3 + 2] = rnd(-15, 15);
      this._pVel[i] = Math.random();
      this._pDrift[i] = rnd(-.6, .6);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this._pPos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9fc8e8, size: .3, transparent: true, opacity: .85, sizeAttenuation: true, depthWrite: false });
    this._points = new THREE.Points(geo, mat);
    this._points.visible = false;
    this._points.frustumCulled = false;
    Engine.scene.add(this._points);
  },

  updateParticles(dt, kind) {
    const pts = this._points;
    if (!pts) return;
    const active = State.settings.weatherFx && (kind === 'mua' || kind === 'tuyet');
    pts.visible = !!active;
    if (!active) return;
    const count = kind === 'mua' ? 400 : 300;
    pts.geometry.setDrawRange(0, count);
    pts.material.color.set(kind === 'mua' ? 0x9fc8e8 : 0xffffff);
    pts.material.size = kind === 'mua' ? .3 : .42;
    const p = PlayerController.entity ? PlayerController.entity.mesh.position : { x: 0, z: 0 };
    for (let i = 0; i < count; i++) {
      const fall = kind === 'mua' ? 7 + this._pVel[i] * 4 : 1.2 + this._pVel[i] * 1.6;
      this._pPos[i * 3 + 1] -= fall * dt;
      this._pPos[i * 3] += (this._pDrift[i] + this._wind * .8) * dt * (kind === 'mua' ? 1 : .6);
      if (this._pPos[i * 3 + 1] < -.5) {
        this._pPos[i * 3] = p.x + rnd(-15, 15);
        this._pPos[i * 3 + 1] = 9 + Math.random() * 5;
        this._pPos[i * 3 + 2] = p.z + rnd(-15, 15);
      }
    }
    pts.geometry.attributes.position.needsUpdate = true;
  },

  /* ============================== NƯỚC ĐỘNG ============================== */
  buildRipples() {
    this._ripples = [];
    const geo = new THREE.RingGeometry(.45, .58, 24);
    const spots = [[-11, 9.5], [-8, 11], [11, 9], [12.5, 10.5], [-12.5, 11], [0, 11.5]];
    spots.forEach(s => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#cfeef2', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(s[0], -.6, s[1]);
      Engine.scene.add(m);
      this._ripples.push(m);
    });
  },

  updateRipples(time) {
    if (!this._ripples) return;
    this._ripples.forEach((m, i) => {
      const age = (time * .22 + i * .167) % 1;
      const s = .6 + age * 3;
      m.scale.set(s, s, 1);
      m.material.opacity = (1 - age) * .3;
    });
  },

  updateLotus(time) {
    Engine.lotusGroups.forEach((L, i) => {
      L.g.position.y = Math.sin(time * 1.1 + i * .9) * .05;
      L.g.position.x = L.bx + Math.sin(time * .23 + i * 1.3) * .25;
      L.g.position.z = L.bz + Math.cos(time * .19 + i) * .2;
    });
  },

  buildKoi() {
    this._koi = [];
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: .5 });
    const bodyGeo = new THREE.SphereGeometry(.22, 10, 8);
    const tailGeo = new THREE.ConeGeometry(.16, .42, 4);
    const tailMat = new THREE.MeshStandardMaterial({ color: '#fb923c', roughness: .5 });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.scale.set(.7, .55, 1.7);
      g.add(body);
      const tail = new THREE.Mesh(tailGeo, tailMat);
      tail.rotation.x = -Math.PI / 2; /* chóp nón hướng ra sau (-z) */
      tail.position.set(0, 0, -.48);
      tail.scale.set(.35, 1, 1);
      g.add(tail);
      g.position.set(0, -.52, 9.5);
      Engine.scene.add(g);
      this._koi.push({ g, tail, phase: i * 1.57 });
    }
  },

  updateKoi(time) {
    if (!this._koi) return;
    this._koi.forEach((k, i) => {
      const a = time * .22 + k.phase;
      const x = Math.cos(a) * 10, z = 9.5 + Math.sin(a) * 2.2;
      const dx = -Math.sin(a) * 10, dz = Math.cos(a) * 2.2;
      k.g.position.set(x, -.52 + Math.sin(time * 1.3 + i * 2) * .03, z);
      k.g.rotation.y = Math.atan2(dx, dz);
      k.tail.rotation.y = Math.sin(time * 6 + i * 2) * .5;
    });
  },

  /* ============================== GIÓ ============================== */
  updateSway(time) {
    Engine.sway.forEach(s => {
      s.obj.rotation[s.axis] = (s.base || 0) + Math.sin(time * 1.6 + s.phase) * s.amp * this._wind;
    });
  },

  /* ============================== MỞ RỘNG BẢN ĐỒ ============================== */
  buildGround() {
    const grass = new THREE.MeshStandardMaterial({ color: '#5d8a4a', roughness: .95 });
    const grass2 = new THREE.MeshStandardMaterial({ color: '#6f9a52', roughness: .95 });
    const dirt = new THREE.MeshStandardMaterial({ color: '#8a6b45', roughness: .95 });
    const add = (mat, w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, .7, d), mat);
      m.position.set(x, -.35, z);
      m.receiveShadow = true;
      Engine.scene.add(m);
    };
    add(grass, 28, 34, -31, 5); /* ruộng lúa phía tây */
    add(grass2, 69, 24, -10.5, -28); /* khu dân cư phía bắc */
    add(grass, 30, 40, 33, 6); /* khu dân cư phía đông */
    add(grass2, 40, 27, 0, 30.5); /* ruộng phía nam */
    /* Đường mòn đất nâu nối thành cũ với các khu mới. */
    const path = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, .06, d), dirt);
      m.position.set(x, .03, z);
      m.receiveShadow = true;
      Engine.scene.add(m);
    };
    path(28, 2.6, -31, 5);
    path(2.6, 24, 0, -28);
    path(30, 2.6, 33, 6);
    path(2.6, 27, 5.5, 30.5);
    /* Mặt nước mở rộng cho khớp bản đồ mới (mặt hồ cũ 80×80 → 104×104). */
    if (Engine.waterMesh) Engine.waterMesh.scale.set(1.3, 1.3, 1);
  },

  buildFields() {
    /* Luống lúa: 2 InstancedMesh tái dùng 1 geometry (xanh 150 + vàng 40). */
    const geo = new THREE.ConeGeometry(.3, .75, 5);
    const green = new THREE.MeshStandardMaterial({ color: '#4c8c3b', roughness: .8 });
    const gold = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: .8 });
    const greenSpots = [], goldSpots = [];
    for (let x = -44; x <= -20; x += 3) for (let z = -8; z <= 18; z += 3) greenSpots.push([x + rnd(-.5, .5), z + rnd(-.5, .5)]);
    for (let x = -18; x <= 18; x += 3) for (let z = 24; z <= 31; z += 3) greenSpots.push([x + rnd(-.5, .5), z + rnd(-.5, .5)]);
    for (let x = -18; x <= 18; x += 3) for (let z = 34; z <= 40; z += 3) goldSpots.push([x + rnd(-.5, .5), z + rnd(-.5, .5)]);
    const dummy = new THREE.Object3D();
    const fill = (spots, mat) => {
      const inst = new THREE.InstancedMesh(geo, mat, spots.length);
      spots.forEach((s, i) => {
        dummy.position.set(s[0], .38, s[1]);
        dummy.rotation.set(0, Math.random() * 6.28, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      Engine.scene.add(inst);
    };
    fill(greenSpots, green);
    fill(goldSpots, gold);
    /* Bù nhìn 2 cái: tây (-30, 8), nam (8, 32). */
    [[-30, 8], [8, 32]].forEach(p => this.buildScarecrow(p[0], p[1]));
  },

  buildScarecrow(x, z) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#4a2f1d', roughness: .85 });
    const straw = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: .9 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.09, .11, 2.4, 8), wood);
    pole.position.y = 1.2; g.add(pole);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.4, .12, .12), wood);
    cross.position.y = 1.8; g.add(cross);
    const body = new THREE.Mesh(new THREE.BoxGeometry(.7, .9, .3), straw);
    body.position.y = 1.35; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.28, 10, 8), straw);
    head.position.y = 2.1; g.add(head);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(.45, .35, 10), new THREE.MeshStandardMaterial({ color: '#7f1d1d', roughness: .8 }));
    hat.position.y = 2.45; g.add(hat);
    g.position.set(x, 0, z);
    Engine.scene.add(g);
    Engine.addCollider(x - .4, x + .4, z - .4, z + .4);
  },

  buildHouse(x, z, rot) {
    const g = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ map: TextureGen.wall(), color: '#cfc8b8', roughness: .92 });
    const roof = new THREE.MeshStandardMaterial({ map: TextureGen.roof(), roughness: .7 });
    const wood = new THREE.MeshStandardMaterial({ color: '#4a2e1b', roughness: .8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.6, 3.6), wall);
    body.position.y = 1.3; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.7, 4), roof);
    rf.rotation.y = Math.PI / 4; rf.scale.set(1.25, 1, 1); rf.position.y = 3.45; rf.castShadow = true; g.add(rf);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1, 1.9, .14), wood);
    door.position.set(0, .95, 1.85); g.add(door);
    [-1.4, 1.4].forEach(wx => {
      const win = new THREE.Mesh(new THREE.BoxGeometry(.8, .8, .1), new THREE.MeshStandardMaterial({ color: '#2b3a4a', roughness: .3 }));
      win.position.set(wx, 1.5, 1.82); g.add(win);
    });
    g.position.set(x, 0, z);
    g.rotation.y = rot || 0;
    Engine.scene.add(g);
    Engine.addCollider(x - 2.2, x + 2.2, z - 1.9, z + 1.9);
  },

  buildBanner(x, z, color) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.09, .11, 3.6, 8), new THREE.MeshStandardMaterial({ color: '#3b2414' }));
    pole.position.y = 1.8; g.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .85), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: .85 }));
    cloth.position.set(.7, 3, 0);
    g.add(cloth);
    g.position.set(x, 0, z);
    Engine.scene.add(g);
    Engine.sway.push({ obj: cloth, phase: Math.random() * 6.28, amp: .07, axis: 'z', base: 0 });
  },

  buildHouses() {
    /* 5 nhà dân mái ngói: 3 phía bắc, 2 phía đông. */
    this.buildHouse(-14, -26, .2);
    this.buildHouse(-2, -30, -.15);
    this.buildHouse(12, -24, .1);
    this.buildHouse(28, -6, .3);
    this.buildHouse(38, 14, -.2);
    /* Cờ/biểu ngữ ở lối vào các khu mới (đung đưa theo gió). */
    this.buildBanner(-17, -16, '#b91c1c');
    this.buildBanner(18, -12, '#166534');
    this.buildBanner(3, 17.5, '#b91c1c');
    /* Cây + đèn lồng thêm ở khu mới (tái dùng builder cũ, có collider). */
    [[-38, -4], [-40, 14], [-24, -32], [6, -34], [22, -30], [26, 20], [42, -4], [-12, 38], [16, 36]].forEach(p => Engine.buildTree(p[0], p[1]));
    [[-20, -16], [-38, 5], [24, -12], [20, 22], [-6, 40]].forEach(p => Engine.buildLantern(p[0], p[1]));
  },

  /* ============================== CỔNG DỊCH CHUYỂN ============================== */
  buildGateSign(g, name, y) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#2a1a0c'; x.fillRect(0, 0, 512, 96);
    x.strokeStyle = '#d8a53c'; x.lineWidth = 5; x.strokeRect(6, 6, 500, 84);
    x.fillStyle = '#ffdf9a'; x.font = 'bold 44px "Palatino Linotype", Georgia, serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(name, 256, 50);
    const tex = new THREE.CanvasTexture(c);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, .5), new THREE.MeshBasicMaterial({ map: tex }));
    plate.position.set(0, y, .35);
    g.add(plate);
  },

  buildGate(def) {
    const g = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: '#8f2922', roughness: .65 });
    const gold = new THREE.MeshStandardMaterial({ color: '#d49b3b', roughness: .45 });
    const roofM = new THREE.MeshStandardMaterial({ color: '#7f1d1d', roughness: .7 });
    if (def.kind === 'well') {
      const stone = new THREE.MeshStandardMaterial({ color: '#84918e', roughness: .8 });
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, .9, 12), stone);
      rim.position.y = .45; rim.castShadow = true; g.add(rim);
      const dark = new THREE.Mesh(new THREE.CircleGeometry(.85, 12), new THREE.MeshBasicMaterial({ color: '#0a0f14' }));
      dark.rotation.x = -Math.PI / 2; dark.position.y = .92; g.add(dark);
      [-.9, .9].forEach(px => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(.16, 2.4, .16), red);
        post.position.set(px, 1.2, 0); g.add(post);
      });
      const rf = new THREE.Mesh(new THREE.ConeGeometry(1.5, .8, 4), roofM);
      rf.rotation.y = Math.PI / 4; rf.position.y = 2.7; g.add(rf);
      this.buildGateSign(g, def.name, 2);
    } else {
      [-1.4, 1.4].forEach(px => {
        const pil = new THREE.Mesh(new THREE.BoxGeometry(.5, 3.4, .5), red);
        pil.position.set(px, 1.7, 0); pil.castShadow = true; g.add(pil);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(.62, .18, .62), gold);
        cap.position.set(px, 3.5, 0); g.add(cap);
      });
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.6, .5, .6), red);
      lintel.position.y = 3.1; lintel.castShadow = true; g.add(lintel);
      const rf = new THREE.Mesh(new THREE.ConeGeometry(2.3, .8, 4), roofM);
      rf.rotation.y = Math.PI / 4; rf.scale.set(1.35, 1, .5); rf.position.y = 3.75; g.add(rf);
      this.buildGateSign(g, def.name, 3.1);
    }
    g.position.set(def.x, 0, def.z);
    Engine.scene.add(g);
  },

  buildGates() {
    this.GATES.forEach(def => this.buildGate(def));
  },

  gateNear(x, z, r) {
    let best = null, min = r;
    this.GATES.forEach(g => {
      const d = Math.hypot(g.x - x, g.z - z);
      if (d < min) { min = d; best = g; }
    });
    return best;
  },

  teleportToGate(gate) {
    if (!gate || Game.mode !== 'world' || !PlayerController.entity) return;
    const idx = this.GATES.indexOf(gate);
    if (idx < 0) return;
    const next = this.GATES[(idx + 1) % this.GATES.length];
    const fade = document.getElementById('fade');
    PlayerController.stop();
    Sfx.click();
    if (fade) fade.classList.add('on');
    setTimeout(() => {
      /* Kiểm tra đích đi được trước khi đặt player; nếu kẹt thì tìm chỗ gần đó. */
      const spot = Engine.isWalkable(next.dx, next.dz)
        ? { x: next.dx, z: next.dz }
        : Engine.walkableNear(next.dx, next.dz, 2);
      const p = PlayerController.entity.mesh.position;
      p.x = spot.x; p.z = spot.z;
      Engine.camera.position.set(p.x + Engine.cameraOffset.x, Engine.cameraOffset.y, p.z + Engine.cameraOffset.z);
      Engine.camera.lookAt(p.x, .8, p.z);
      if (fade) fade.classList.remove('on');
      UI.toast('🚪 Đã dịch chuyển tới ' + next.name + '!', 'gold');
      SaveManager.save();
    }, 340);
  },

  teleportFromNearest() {
    if (Game.mode !== 'world' || !PlayerController.entity) return;
    const p = PlayerController.entity.mesh.position;
    const gate = this.gateNear(p.x, p.z, 2.2);
    if (gate) this.teleportToGate(gate);
  },

  /* ============================== HUD ============================== */
  syncHUD() {
    const el = document.getElementById('env-pill');
    if (!el) return;
    const wc = State.worldClock;
    const wdef = this.WEATHER[State.weather.kind] || this.WEATHER.nang;
    const season = this.seasonById(wc.season);
    const hh = Math.floor(wc.hour), mm = Math.floor((wc.hour - hh) * 60);
    const tIcon = (wc.hour < 5 || wc.hour >= 19) ? '🌙' : wc.hour < 7 ? '🌅' : wc.hour < 17 ? '☀️' : '🌇';
    const txt = wdef.icon + ' ' + wdef.name + ' · ' + tIcon + ' ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') +
      ' · Ngày ' + wc.day + ' · ' + season.name;
    if (el.textContent !== txt) el.textContent = txt;
  },

  updateGateButton() {
    const btn = document.getElementById('teleport-btn');
    if (!btn) return;
    const p = PlayerController.entity ? PlayerController.entity.mesh.position : null;
    let near = null;
    if (p && Game.mode === 'world') near = this.gateNear(p.x, p.z, 2.2);
    if (near) {
      const next = this.GATES[(this.GATES.indexOf(near) + 1) % this.GATES.length];
      btn.textContent = '🚪 Tới ' + next.name;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  },

  /* ============================== KHỞI TẠO / VÒNG LẶP ============================== */
  buildGlare() {
    const host = document.getElementById('app');
    if (!host) return;
    const d = document.createElement('div');
    d.id = 'sun-glare';
    d.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;opacity:0;transition:opacity .8s ease;background:radial-gradient(circle at 50% 18%,rgba(255,214,120,.55),rgba(255,180,80,.18) 55%,rgba(255,180,80,0) 78%)';
    host.appendChild(d);
    this._glare = d;
  },

  buildExpansion() {
    if (this._built) return;
    this._built = true;
    /* Save cũ có thể thiếu/khác mùa — tính lại từ ngày game. */
    State.worldClock.season = this.seasonForDay(State.worldClock.day);
    this.buildGround();
    this.buildFields();
    this.buildHouses();
    this.buildGates();
    this.buildKoi();
    this.buildRipples();
    this.initParticles();
    this.buildGlare();
    this.syncHUD();
  },

  update(dt, time) {
    if (!this._built) return;
    /* Hoa đào đổi màu theo mùa — áp dụng sau khi PixiFX.init() xong. */
    if (!this._petalsApplied) {
      this._petalsApplied = true;
      const info = this.seasonById(State.worldClock.season);
      PixiFX.setPetalColors(info.petals[0], info.petals[1]);
    }
    this.tickClock(dt);
    this.advanceWeather(dt);
    const preset = this.skyAt(State.worldClock.hour);
    /* Tắt hiệu ứng thời tiết → trời luôn nắng (không mưa/tuyết/sương/nắng gắt). */
    const wdef = this.WEATHER[State.settings.weatherFx === false ? 'nang' : State.weather.kind] || this.WEATHER.nang;
    this._wind = wdef.wind;
    this.applySky(preset, wdef);
    this.updateLotus(time);
    this.updateRipples(time);
    this.updateKoi(time);
    this.updateSway(time);
    this.updateParticles(dt, State.weather.kind);
    if (this._glare) this._glare.style.opacity = String(wdef.glare || 0);
    this._hudAcc += dt;
    if (this._hudAcc > .5) {
      this._hudAcc = 0;
      this.syncHUD();
      this.updateGateButton();
    }
  }
};
