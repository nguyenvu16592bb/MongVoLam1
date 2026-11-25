/* ============================================================================
   PHẦN 2 — CHIẾN TRƯỜNG (từ battle map): 3 đấu trường, 4 tuyệt kỹ, tự chiến
   ========================================================================== */

const Battle = {
  scene: null,
  camera: null,
  arena: 'bamboo',
  arenaGroup: null,
  wave: 1,
  maxWaves: 3,
  allies: [],
  enemies: [],
  effects: [],
  active: false,
  paused: false,
  finished: false,
  speed: 1,
  shake: 0,
  camAngle: 0,
  camDist: 26,
  dragging: false,
  prevX: 0,
  pendingWave: 0,
  lastLog: '',

  /* ---------- scene ---------- */
  createScene() {
    this.scene = new THREE.Scene();
    this.lanterns = [];
    this.fireflies = null;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(37, aspect, .1, 240);
    this.updateCamera();

    this.scene.add(new THREE.HemisphereLight(0xdff5e1, 0x263822, .6));

    const dir = new THREE.DirectionalLight(0xfff4d6, .9);
    dir.position.set(14, 26, 16);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 90;
    const d = 24;
    dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
    dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
    this.scene.add(dir);

    const glow = new THREE.PointLight(0xa855f7, .8, 20);
    glow.position.set(0, 2.6, 0);
    this.scene.add(glow);

    this.bindInput();
  },

  updateCamera() {
    if (!this.camera) return;
    const rad = this.camAngle;
    const dist = this.camDist;
    this.camera.position.set(Math.sin(rad) * dist * .45, dist * .72, Math.cos(rad) * dist);
    this.camera.lookAt(0, 1.05, 0);
  },

  bindInput() {
    const canvas = $('#three-canvas');
    canvas.addEventListener('mousedown', e => {
      if (Game.mode !== 'battle') return;
      this.dragging = true;
      this.prevX = e.clientX;
    });
    window.addEventListener('mousemove', e => {
      if (!this.dragging) return;
      const dx = e.clientX - this.prevX;
      this.camAngle = clamp(this.camAngle - dx * .006, -.85, .85);
      this.updateCamera();
      this.prevX = e.clientX;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    canvas.addEventListener('touchstart', e => {
      if (Game.mode !== 'battle' || e.touches.length !== 1) return;
      this.dragging = true;
      this.prevX = e.touches[0].clientX;
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (!this.dragging || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - this.prevX;
      this.camAngle = clamp(this.camAngle - dx * .006, -.85, .85);
      this.updateCamera();
      this.prevX = e.touches[0].clientX;
    }, { passive: true });
    canvas.addEventListener('touchend', () => { this.dragging = false; });
    canvas.addEventListener('wheel', e => {
      if (Game.mode !== 'battle') return;
      e.preventDefault();
      this.camDist = clamp(this.camDist + e.deltaY * .012, 17, 38);
      this.updateCamera();
    }, { passive: false });
  },

  /* ---------- arenas ---------- */
  buildArena(key) {
    const scene = this.scene;
    if (!scene) return;
    if (this.arenaGroup) {
      scene.remove(this.arenaGroup);
      this.arenaGroup.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
    }
    this.arenaGroup = new THREE.Group();
    scene.add(this.arenaGroup);
    /* ARENA10-BEGIN — map id cũ (save v2) sang Battle Map 1..10 + dispatch 7 builder mới */
    key = (typeof resolveArenaKey === 'function') ? resolveArenaKey(key) : key;
    this.arena = key;
    const b = (ARENAS[key] && ARENAS[key].builder) || key;
    if (b === 'buddha') this.buildBuddha();
    else if (b === 'city') this.buildCity();
    else if (b === 'snow') this.buildSnow();
    else if (b === 'desert') this.buildDesert();
    else if (b === 'volcano') this.buildVolcano();
    else if (b === 'swamp') this.buildSwamp();
    else if (b === 'sky') this.buildSky();
    else if (b === 'cave') this.buildCave();
    else if (b === 'lake') this.buildLake();
    else this.buildBamboo();
    /* ARENA10-END */
    ArenaUI.mark(key);
  },

  buildBamboo() {
    const g = this.arenaGroup, scene = this.scene;
    scene.background = new THREE.Color(0x162918);
    scene.fog = new THREE.FogExp2(0x1a301c, .015);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x354a29, roughness: .92 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);

    const stone = new THREE.MeshStandardMaterial({ color: 0x5c6356, roughness: .86 });
    for (let i = 0; i < 16; i++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(2.4 + Math.random() * 1.4, .12, 1.8 + Math.random()), stone);
      const a = (i / 16) * Math.PI * 2;
      const r = 2 + (i % 3) * 3.4;
      slab.position.set(Math.cos(a) * r, .06, Math.sin(a) * r);
      slab.rotation.y = Math.random() * Math.PI;
      slab.receiveShadow = true;
      g.add(slab);
    }

    const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 1.8, 1.2), stone);
    wall.position.set(0, .9, -15); wall.castShadow = true; g.add(wall);
    for (let x = -4; x <= 4; x += 4) {
      const pill = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.7, 1.5), stone);
      pill.position.set(x, 1.35, -15); pill.castShadow = true; g.add(pill);
    }

    const stem = new THREE.MeshStandardMaterial({ color: 0x4d7c2b, roughness: .45 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x2f5e1e, side: THREE.DoubleSide });
    const makeStalk = (x, z, h) => {
      const st = new THREE.Group();
      const n = Math.floor(h / 1.6);
      for (let s = 0; s < n; s++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(.15, .17, 1.5, 7), stem);
        seg.position.y = s * 1.6 + .8; seg.castShadow = true; st.add(seg);
        if (s > 1 && s % 2 === 0) {
          const lf = new THREE.Mesh(new THREE.ConeGeometry(.7, 1.8, 4), leaf);
          lf.position.set((Math.random() - .5) * .7, s * 1.6 + .9, (Math.random() - .5) * .7);
          lf.rotation.z = (Math.random() - .5) * 1.3;
          st.add(lf);
        }
      }
      st.position.set(x, 0, z);
      g.add(st);
    };
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 12.5 + Math.random() * 13;
      const bx = Math.cos(a) * dist, bz = Math.sin(a) * dist;
      if (bz > 12 && Math.abs(bx) < 9) continue;
      makeStalk(bx, bz, 8 + Math.random() * 6);
    }

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a5246, roughness: .95 });
    for (let i = 0; i < 12; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.7 + Math.random() * .8, 0), rockMat);
      const a = (i / 12) * Math.PI * 2;
      rock.position.set(Math.cos(a) * (10 + Math.random() * 3), .35, Math.sin(a) * (10 + Math.random() * 3));
      rock.scale.set(1.3, .7, 1.1); rock.castShadow = true; g.add(rock);
    }
  },

  buildBuddha() {
    const g = this.arenaGroup, scene = this.scene;
    scene.background = new THREE.Color(0x526b6c);
    scene.fog = new THREE.FogExp2(0x7c9696, .012);

    const floor = new THREE.Mesh(new THREE.BoxGeometry(26, .5, 22),
      new THREE.MeshStandardMaterial({ color: 0x8c8d75, roughness: .82 }));
    floor.position.y = -.25; floor.receiveShadow = true; g.add(floor);

    const railMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: .72 });
    [-13, 13].forEach(x => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.8, 1.2, 22), railMat);
      rail.position.set(x, .6, 0); rail.castShadow = true; g.add(rail);
    });

    const stone = new THREE.MeshStandardMaterial({ color: 0x6b7265, roughness: .86 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 16), stone);
    head.scale.set(.9, 1.15, .85); head.position.set(0, 3.2, -13); g.add(head);
    const ush = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 12), new THREE.MeshStandardMaterial({ color: 0x575e52 }));
    ush.position.set(0, 5.8, -13); g.add(ush);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(3.4, 16, 12), stone);
    shoulder.scale.set(1.5, .42, .8); shoulder.position.set(0, 1.4, -13.4); g.add(shoulder);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x452719 });
    const bloom = new THREE.MeshStandardMaterial({ color: 0xf9a8d4, emissive: 0x831843, emissiveIntensity: .24 });
    [[-11, -10], [11, -10], [-13, 2], [13, 2]].forEach(p => {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(.4, .7, 5, 8), trunkMat);
      tr.position.set(p[0], 2.5, p[1]); tr.castShadow = true; g.add(tr);
      for (let b = 0; b < 4; b++) {
        const cr = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2, 1), bloom);
        cr.position.set(p[0] + (Math.random() - .5) * 3, 5 + Math.random() * 1.4, p[1] + (Math.random() - .5) * 3);
        cr.castShadow = true; g.add(cr);
      }
    });
  },

  buildCity() {
    const g = this.arenaGroup, scene = this.scene;
    scene.background = new THREE.Color(0x3b6e6c);
    scene.fog = new THREE.FogExp2(0x4b7f7d, .011);

    const water = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x2c8c85, roughness: .2, metalness: .35 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -.4; g.add(water);

    const plaza = new THREE.Mesh(new THREE.BoxGeometry(26, .8, 22),
      new THREE.MeshStandardMaterial({ color: 0xb8c4b4, roughness: .78 }));
    plaza.position.y = 0; plaza.receiveShadow = true; g.add(plaza);

    const padMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4b });
    const lotus = new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xbe185d, emissiveIntensity: .3 });
    for (let i = 0; i < 22; i++) {
      const lx = (Math.random() - .5) * 32;
      const lz = 12.5 + Math.random() * 8;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(.65, .65, .06, 12), padMat);
      pad.position.set(lx, -.35, lz); g.add(pad);
      if (i % 3 === 0) {
        const fl = new THREE.Mesh(new THREE.ConeGeometry(.3, .35, 6), lotus);
        fl.position.set(lx, -.2, lz); g.add(fl);
      }
    }

    const wall = new THREE.Mesh(new THREE.BoxGeometry(16, 4.5, 5),
      new THREE.MeshStandardMaterial({ color: 0xe5e0d0, roughness: .85 }));
    wall.position.set(0, 2.25, -12); wall.castShadow = true; g.add(wall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 2.8, 4),
      new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: .7 }));
    roof.position.set(0, 5.8, -12); roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof);

    const tent = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x2c4c6e, roughness: .85 }));
    tent.position.set(-7, 3.2, -5); tent.rotation.y = Math.PI / 4; tent.castShadow = true; g.add(tent);
    const tpost = new THREE.Mesh(new THREE.CylinderGeometry(.12, .14, 3, 8),
      new THREE.MeshStandardMaterial({ color: '#4a2e1b' }));
    tpost.position.set(-7, 1.5, -5); g.add(tpost);
  },

  /* ---------- units ---------- */
  createUnit(cfg, isAlly) {
    const root = new THREE.Group();
    const scale = cfg.scale || 1;
    root.scale.set(scale, scale, scale);

    const auraColor = isAlly ? 0xc026d3 : 0xef4444;
    const aura = new THREE.Mesh(new THREE.RingGeometry(.65, .95, 24),
      new THREE.MeshBasicMaterial({ color: auraColor, side: THREE.DoubleSide, transparent: true, opacity: .6 }));
    aura.rotation.x = -Math.PI / 2; aura.position.y = .04; root.add(aura);

    const bodyMat = new THREE.MeshStandardMaterial({ color: cfg.robe, roughness: .5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: .6, roughness: .3 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(.32, .52, 1.05, 12), bodyMat);
    torso.position.y = .65; torso.castShadow = true; root.add(torso);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(.38, .39, .16, 12), trimMat);
    belt.position.y = .65; root.add(belt);

    const headGroup = new THREE.Group();
    headGroup.position.y = 1.52;
    const skin = new THREE.MeshStandardMaterial({ color: 0xffdfc4, roughness: .6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(.46, 16, 16), skin);
    head.castShadow = true; headGroup.add(head);

    const hairMat = new THREE.MeshStandardMaterial({ color: cfg.hair, roughness: .4 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.49, 16, 16, 0, Math.PI * 2, 0, Math.PI * .58), hairMat);
    cap.rotation.x = -.25; headGroup.add(cap);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(.22, 12, 12), hairMat);
    knot.position.set(0, .52, -.05); headGroup.add(knot);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(.24, .85, 8), hairMat);
    tail.position.set(0, .1, -.45); tail.rotation.x = -.4; headGroup.add(tail);
    if (cfg.maskColor) {
      const mask = new THREE.Mesh(
        new THREE.CylinderGeometry(.47, .47, .22, 16, 1, true, -Math.PI * .35, Math.PI * .7),
        new THREE.MeshStandardMaterial({ color: cfg.maskColor, side: THREE.DoubleSide })
      );
      mask.position.y = .02; headGroup.add(mask);
    }
    root.add(headGroup);

    const weapon = new THREE.Group();
    weapon.position.set(.55, .85, .25);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: isAlly ? 0x38bdf8 : 0xf43f5e,
      emissive: isAlly ? 0x0284c7 : 0xbe123c, emissiveIntensity: .8
    });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.08, 1.45, .16), bladeMat);
    blade.position.y = .55; blade.rotation.x = .45; weapon.add(blade);
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(.32, .08, .12), trimMat);
    hilt.position.y = -.05; weapon.add(hilt);
    root.add(weapon);

    const label = document.createElement('div');
    label.className = 'unit-label ' + (isAlly ? 'ally' : 'enemy');
    label.innerHTML = `<div class="un">${esc(cfg.name)}${cfg.boss ? ' ★' : ''}</div><div class="ubar"><i></i></div>`;
    $('#labels').appendChild(label);

    const unit = {
      mesh: root, headGroup, weapon, aura, label,
      hpFill: label.querySelector('.ubar i'),
      name: cfg.name, isAlly, boss: !!cfg.boss,
      hp: cfg.hp, maxHp: cfg.hp, atk: cfg.atk, def: cfg.def || 0,
      home: new THREE.Vector3(cfg.x || 0, 0, cfg.z || 0),
      slot: cfg.slot || 0,
      labelH: (cfg.boss ? 2.85 : 2.45) + ((cfg.slot || 0) % 2) * .42,
      attackTimer: Math.random() * .8, phase: Math.random() * 6.28,
      hit: 0, dead: false, baseScale: scale, regen: isAlly ? .009 : 0
    };
    root.position.copy(unit.home);
    return unit;
  },

  clearUnits() {
    [this.allies, this.enemies].forEach(list => {
      list.forEach(u => {
        this.scene.remove(u.mesh);
        u.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        if (u.label && u.label.parentNode) u.label.parentNode.removeChild(u.label);
      });
      list.length = 0;
    });
    $('#labels').innerHTML = '';
  },

  heroOrder() {
    const order = [State.leader];
    for (let i = 0; i < State.heroes.length && order.length < 4; i++) {
      if (!order.includes(i)) order.push(i);
    }
    return order;
  },

  spawnAllies() {
    const pos = [[-5.4, 2.6], [-4.2, 5.0], [-6.4, .6], [-5.0, 6.6]];
    const order = this.heroOrder();
    order.forEach((hi, i) => {
      const h = heroById(State.heroes[hi].id) || HERO_DEFS[0];
      const st = heroStats(h.id);
      const maxHp = Math.round(5600 + h.level * 11);
      const atk = Math.round(520 + h.level * 1.62);
      const u = this.createUnit({
        name: h.name, robe: parseInt(h.robe.replace('#', ''), 16),
        hair: parseInt(h.hair.replace('#', ''), 16),
        maskColor: h.mask ? parseInt(h.mask.replace('#', ''), 16) : null,
        hp: maxHp, atk, def: Math.round(300 + h.level * .9),
        x: pos[i][0], z: pos[i][1], scale: 1, slot: i
      }, true);
      u.heroIndex = hi;
      u.qi = st.qi;
      this.scene.add(u.mesh);
      this.allies.push(u);
    });
  },

  spawnWave(n) {
    this.enemies.forEach(u => {
      this.scene.remove(u.mesh);
      if (u.label.parentNode) u.label.parentNode.removeChild(u.label);
    });
    this.enemies.length = 0;

    const arena = ARENAS[this.arena];
    const waveMul = n === 1 ? 1 : n === 2 ? 1.22 : 1.5;
    const hpMul = (.78 + .42 * arena.mul) * waveMul;
    const atkMul = (.82 + .32 * arena.mul) * (n === 1 ? 1 : n === 2 ? 1.1 : 1.22);
    /* ARENA10-BEGIN — dàn quái riêng từng Battle Map; đợt 3 có Boss riêng của map */
    const roster = (typeof ARENA_ENEMIES !== 'undefined' && ARENA_ENEMIES[this.arena]) || ENEMY_DEFS;
    const bossDef = (typeof ARENA_BOSSES !== 'undefined' && ARENA_BOSSES[this.arena]) || null;
    const rot = k => roster[(k + (n - 1)) % roster.length];
    const defs = n === 3 && bossDef
      ? [bossDef, rot(0), rot(1), rot(2)]
      : n === 2
        ? [rot(1), rot(2), rot(0), rot(1)]
        : [rot(0), rot(1), rot(2), rot(0)];
    /* ARENA10-END */
    const pos = [[4.8, -2.4], [5.6, .2], [4.2, 2.6], [6.6, -4.0]];

    defs.forEach((d, i) => {
      const hp = Math.round(9000 * d.hp * hpMul);
      const u = this.createUnit({
        name: d.name, robe: d.robe, hair: d.hair,
        hp, atk: Math.round(118 * d.atk * atkMul), def: Math.round(120 * arena.mul),
        x: pos[i][0], z: pos[i][1], scale: d.scale, boss: d.boss, slot: i
      }, false);
      this.scene.add(u.mesh);
      this.enemies.push(u);
    });
    this.wave = n;
    this.setLog(`Đợt ${n}/${this.maxWaves} — ${this.enemies.length} cao thủ ma giáo xuất hiện!`);
    UI.syncBattle(true);
  },

  /* ---------- vòng đời ---------- */
  start(arenaKey) {
    if (!this.scene) this.createScene();
    this.arena = arenaKey || this.arena || 'bamboo';
    this.finished = false;
    this.paused = false;
    this.pendingWave = 0;
    this.speed = State.settings.speed || 1;
    this.camAngle = 0;
    this.camDist = window.innerWidth / Math.max(1, window.innerHeight) < 1 ? 33 : 26;
    this.updateCamera();
    this.buildArena(this.arena);
    this.clearUnits();
    this.clearEffects();
    this.spawnAllies();
    this.spawnWave(1);
    /* HERO20-BEGIN — bộ skill của đội trưởng cho trận này: clone từ
       heroSkills(leader) để giữ currentCd/lvl riêng từng trận; hết nội lực
       (mp) thì không tung được chiêu tốn nội lực. Fallback SKILLS chung cũ
       khi nhân vật thiếu skill (heroSkills đã lo). */
    this.mp = 100;
    this.maxMp = 100;
    const leaderId = (State.heroes[State.leader] && State.heroes[State.leader].id) || 'det';
    this.heroSkills = heroSkills(leaderId).map(s => Object.assign({}, s, { currentCd: 0, lvl: 10 }));
    /* HERO20-END */
    SKILLS.forEach(s => { s.currentCd = 0; });

    this.active = true;
    State.stats.battles++;
    Game.mode = 'battle';
    UI.showScreen('battle');
    UI.hideResult();
    UI.syncBattle(true);
    this.setLog(`${ARENAS[this.arena].name} — trận chiến bắt đầu!`);
    Sfx.skill();
    SaveManager.save();
  },

  setLog(text) {
    this.lastLog = text;
    const el = $('#battle-log');
    if (el) el.textContent = text;
  },

  exit() {
    this.active = false;
    this.paused = false;
    this.clearUnits();
    this.clearEffects();
    UI.hideResult();
    World.enter(true);
    UI.toast('Đã trở về Biện Kinh Thành', 'gold');
  },

  restart() { this.start(this.arena); },

  togglePause() {
    if (this.finished) return;
    this.paused = !this.paused;
    UI.toast(this.paused ? 'Tạm dừng trận đấu' : 'Tiếp tục giao chiến!', this.paused ? 'red' : 'gold');
  },

  toggleAuto() {
    State.settings.autoBattle = !State.settings.autoBattle;
    UI.toast('Tự động đánh: ' + (State.settings.autoBattle ? 'BẬT' : 'TẮT'), 'gold');
    UI.syncBattle(true);
  },

  toggleAutoSkill() {
    State.settings.autoSkill = !State.settings.autoSkill;
    UI.toast('Tự tung chiêu: ' + (State.settings.autoSkill ? 'BẬT' : 'TẮT'), 'purple');
    UI.syncBattle(true);
  },

  cycleSpeed() {
    const arr = [1, 2, 3, 5];
    const i = arr.indexOf(this.speed);
    this.speed = arr[(i + 1) % arr.length];
    State.settings.speed = this.speed;
    const el = $('#battle-speed-text');
    if (el) el.textContent = 'X' + this.speed;
    UI.toast('Tốc độ trận đấu: X' + this.speed, 'gold');
    SaveManager.save();
  },

  toScreen(v, yOff) {
    const p = v.clone();
    p.y += (yOff || 0);
    p.project(this.camera);
    return {
      x: (p.x * .5 + .5) * window.innerWidth,
      y: (-p.y * .5 + .5) * window.innerHeight
    };
  },

  /* ---------- chiêu thức ---------- */
  /* HERO20-BEGIN — skill đang dùng trong trận: bộ skill riêng của đội trưởng
     (Battle.heroSkills, build ở start), fallback SKILLS chung cũ. */
  activeSkills() {
    return (Array.isArray(this.heroSkills) && this.heroSkills.length >= 4) ? this.heroSkills : SKILLS;
  },
  /* HERO20-END */

  triggerSkill(i) {
    if (!this.active || this.finished) return;
    /* HERO20-BEGIN — lấy skill theo đội trưởng thay vì SKILLS chung cố định */
    const sk = this.activeSkills()[i];
    if (!sk) return;
    if (sk.currentCd > 0) {
      UI.toast(`${sk.name} đang hồi chiêu (${sk.currentCd.toFixed(1)}s)`, 'red');
      return;
    }
    if (typeof this.mp === 'number' && (sk.cost || 0) > this.mp) {
      UI.toast(`${sk.name} cần ${sk.cost} nội lực (đang có ${Math.floor(this.mp)})`, 'red');
      return;
    }
    /* HERO20-END */
    const allies = this.allies.filter(u => !u.dead);
    const enemies = this.enemies.filter(u => !u.dead);
    if (!allies.length || !enemies.length) return;
    /* HERO20-BEGIN — trừ nội lực sau khi đã chắc chắn có mục tiêu để đánh */
    if (typeof this.mp === 'number') this.mp = Math.max(0, this.mp - (sk.cost || 0));
    /* HERO20-END */

    sk.currentCd = sk.cd;
    const caster = allies[0];
    const target = enemies[0];

    UI.showBanner(sk.name);
    UI.syncBattle(true);
    this.shake = .45;
    Sfx.skill();
    this.spawnVFX(target.mesh.position, sk.color, sk.ring);

    /* HERO20-BEGIN — kind 'heal' hồi máu toàn đội (hồi 10% Mệnh tối đa × mult),
       kind 'dmg' gây sát thương như cũ (aoe = toàn bộ địch, không aoe = 1 mục tiêu) */
    if (sk.kind === 'heal') {
      allies.forEach(a => {
        const heal = a.maxHp * .10 * (sk.mult || 1);
        a.hp = Math.min(a.maxHp, a.hp + heal);
        this.floatText(a.mesh.position, 2.2, '+' + fmt(heal * 40), 'heal');
      });
      this.setLog(`Thi triển [${sk.name}] — hồi phục cho toàn đội!`);
      return;
    }
    const list = sk.aoe ? enemies : [target];
    list.forEach(en => {
      const crit = Math.random() < .62;
      const dmg = caster.atk * sk.mult * rnd(.9, 1.15) * (crit ? 1.45 : 1);
      this.applyDamage(en, dmg, crit);
    });
    this.setLog(`Thi triển [${sk.name}] — ${list.length} mục tiêu trúng đòn!`);
    /* HERO20-END */
  },

  applyDamage(target, dmg, crit) {
    if (target.dead) return;
    target.hp = Math.max(0, target.hp - dmg);
    target.hit = .18;
    const pct = clamp((target.hp / target.maxHp) * 100, 0, 100);
    target.hpFill.style.width = pct + '%';
    this.floatText(target.mesh.position, target.boss ? 2.6 : 2.35, Math.floor(dmg * (crit ? 1245 : 380)), crit ? 'crit' : 'normal');
    crit ? Sfx.crit() : Sfx.hit();

    if (target.hp <= 0) {
      target.dead = true;
      target.mesh.visible = false;
      target.label.style.display = 'none';
      State.stats.kills++;
      if (target.boss) this.shake = .7;
      this.burst(target.mesh.position, target.isAlly ? 0x38bdf8 : 0xf43f5e, 14);
      this.setLog(`Đã hạ gục ${target.name}!`);
      UI.syncBattle(true);
      if (target.isAlly) {
        if (this.allies.every(u => u.dead)) this.defeat();
      } else if (this.enemies.every(u => u.dead)) {
        this.waveClear();
      }
    }
  },

  waveClear() {
    if (this.finished || this.pendingWave) return;
    if (this.wave >= this.maxWaves) { this.victory(); return; }
    this.pendingWave = 1;
    this.setLog(`Đợt ${this.wave} hoàn tất! Chuẩn bị đợt tiếp theo…`);
    setTimeout(() => {
      if (!this.active) return;
      this.pendingWave = 0;
      this.spawnWave(this.wave + 1);
      Sfx.skill();
    }, 1500);
  },

  victory() {
    if (this.finished) return;
    this.finished = true;
    const a = ARENAS[this.arena];
    const exp = Math.round(a.exp * (1 + .18 * (this.wave - 1)));
    const silver = Math.round(a.silver * rnd(.9, 1.15));
    const gold = a.gold + rndInt(0, 2);
    State.stats.wins++;
    State.player.gold += gold;
    State.player.silver += silver;
    /* ARENA10-BEGIN — thắng trận nhận thêm phần thưởng riêng của Boss map này */
    if (a.bossReward) {
      addItem(a.bossReward, a.bossRewardIcon || '🎁', 'Bảo vật', 'Phần thưởng Boss ' + (a.boss || a.name), 1);
      UI.toast(`🏆 Hạ Boss ${a.boss} — nhận ${a.bossReward}!`, 'gold');
    }
    /* ARENA10-END */
    gainExp(exp, true);
    progressQuest('q2', 1);
    progressQuest('q5', 1);
    SaveManager.save();
    Sfx.win();
    UI.showResult(true, { exp, silver, gold, arena: a.name, wave: this.wave });
  },

  defeat() {
    if (this.finished) return;
    this.finished = true;
    const a = ARENAS[this.arena];
    const exp = Math.round(a.exp * .25);
    const silver = Math.round(a.silver * .2);
    State.player.silver += silver;
    gainExp(exp, true);
    SaveManager.save();
    Sfx.lose();
    UI.showResult(false, { exp, silver, gold: 0, arena: a.name, wave: this.wave });
  },

  /* ---------- hiệu ứng ---------- */
  spawnVFX(pos, color, ringColor) {
    const g = new THREE.Group();
    g.position.copy(pos); g.position.y = .2;
    const circle = new THREE.Mesh(new THREE.RingGeometry(1.2, 3.4, 40),
      new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, transparent: true, opacity: .85 }));
    circle.rotation.x = -Math.PI / 2; g.add(circle);

    const vortex = new THREE.Mesh(new THREE.TorusGeometry(2, .13, 10, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9 }));
    vortex.position.y = 1.2; vortex.rotation.x = Math.PI / 3; g.add(vortex);

    const mat = new THREE.MeshBasicMaterial({ color });
    const shards = [];
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(.22, 0), mat);
      const a = (i / 16) * Math.PI * 2;
      const r = .8 + Math.random() * 2.2;
      s.position.set(Math.cos(a) * r, Math.random() * 1.4, Math.sin(a) * r);
      s.userData = { vy: 2.4 + Math.random() * 3, ang: a, rad: r };
      g.add(s); shards.push(s);
    }
    this.scene.add(g);
    this.effects.push({ group: g, circle, vortex, shards, life: 1.15, max: 1.15 });
  },

  burst(pos, color, n) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95 });
    const g = new THREE.Group();
    g.position.copy(pos); g.position.y = 1;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.TetrahedronGeometry(.14, 0), mat);
      m.userData = { v: new THREE.Vector3(rnd(-2, 2), rnd(2, 5), rnd(-2, 2)) };
      g.add(m); parts.push(m);
    }
    this.scene.add(g);
    this.effects.push({ group: g, parts, life: .8, max: .8, simple: true, mat });
  },

  clearEffects() {
    this.effects.forEach(e => {
      this.scene.remove(e.group);
      e.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      if (e.mat) e.mat.dispose();
    });
    this.effects.length = 0;
  },

  floatText(pos, yOff, text, cls) {
    const p = this.toScreen(pos, yOff);
    const el = document.createElement('div');
    el.className = 'dmg ' + (cls || 'normal');
    el.textContent = text;
    el.style.left = (p.x + rnd(-26, 26)) + 'px';
    el.style.top = p.y + 'px';
    $('#app').appendChild(el);
    setTimeout(() => el.remove(), 1180);
  },

  /* ---------- cập nhật ---------- */
  update(dt) {
    if (!this.active || this.finished) {
      this.updateEffects(dt);
      return;
    }
    if (this.paused) { this.updateEffects(dt); return; }
    const sdt = Math.min(.06, dt) * this.speed;
    const allies = this.allies.filter(u => !u.dead);
    const enemies = this.enemies.filter(u => !u.dead);

    // hồi chiêu + auto skill
    /* HERO20-BEGIN — hồi chiêu + hồi nội lực theo bộ skill của đội trưởng */
    if (typeof this.mp === 'number') this.mp = Math.min(this.maxMp || 100, this.mp + sdt * 6);
    this.activeSkills().forEach((sk, i) => {
      if (sk.currentCd > 0) {
        sk.currentCd = Math.max(0, sk.currentCd - sdt);
      } else if (allies.length && enemies.length && State.settings.autoBattle && State.settings.autoSkill && Math.random() < .05) {
        this.triggerSkill(i);
      }
    });
    /* HERO20-END */

    allies.forEach(a => {
      a.phase += sdt * 6;
      a.aura.rotation.z += sdt * 2;
      a.headGroup.position.y = 1.52 + Math.sin(a.phase) * .04;
      if (a.hit > 0) a.hit = Math.max(0, a.hit - sdt);
      const sc = a.baseScale * (1 + a.hit * .9);
      a.mesh.scale.set(sc, sc, sc);
      if (a.regen) a.hp = Math.min(a.maxHp, a.hp + a.maxHp * a.regen * sdt);

      if (State.settings.autoBattle && enemies.length) {
        const t = this.nearest(a, enemies);
        const ang = (a.slot / 4) * Math.PI * 2;
        const dest = new THREE.Vector3(
          t.mesh.position.x + Math.cos(ang) * 2.25, 0,
          t.mesh.position.z + Math.sin(ang) * 2.25
        );
        const dir = new THREE.Vector3().subVectors(dest, a.mesh.position);
        const dist = dir.length();
        const reach = a.mesh.position.distanceTo(t.mesh.position);
        a.mesh.lookAt(t.mesh.position.x, 0, t.mesh.position.z);
        if (reach > 2.7 && dist > .2) {
          dir.normalize();
          a.mesh.position.addScaledVector(dir, Math.min(dist, sdt * 3.9));
        } else {
          a.attackTimer -= sdt;
          a.weapon.rotation.x = Math.sin(a.phase * 2) * .9;
          if (a.attackTimer <= 0) {
            a.attackTimer = 1.05 + Math.random() * .35;
            this.slash(t.mesh.position, 0x38bdf8);
            this.applyDamage(t, a.atk * rnd(.85, 1.2), Math.random() < .32);
            a.hpFill.style.width = clamp(a.hp / a.maxHp * 100, 0, 100) + '%';
          }
        }
      }
      this.placeLabel(a);
    });

    enemies.forEach(e => {
      e.phase += sdt * 5.5;
      e.aura.rotation.z -= sdt * 2.2;
      e.headGroup.position.y = 1.52 + Math.sin(e.phase) * .04;
      if (e.hit > 0) e.hit = Math.max(0, e.hit - sdt);
      const sc = e.baseScale * (1 + e.hit * .9);
      e.mesh.scale.set(sc, sc, sc);

      if (allies.length && !this.finished) {
        const t = this.nearest(e, allies);
        const ang = (e.slot / 4) * Math.PI * 2 + Math.PI / 4;
        const dest = new THREE.Vector3(
          t.mesh.position.x + Math.cos(ang) * 2.3, 0,
          t.mesh.position.z + Math.sin(ang) * 2.3
        );
        const dir = new THREE.Vector3().subVectors(dest, e.mesh.position);
        const dist = dir.length();
        const reach = e.mesh.position.distanceTo(t.mesh.position);
        e.mesh.lookAt(t.mesh.position.x, 0, t.mesh.position.z);
        if (reach > 2.75 && dist > .2) {
          dir.normalize();
          e.mesh.position.addScaledVector(dir, Math.min(dist, sdt * 3.1));
        } else {
          e.attackTimer -= sdt;
          e.weapon.rotation.x = Math.cos(e.phase * 2) * .85;
          if (e.attackTimer <= 0) {
            e.attackTimer = 1.45 + Math.random() * .45;
            this.slash(t.mesh.position, 0xf43f5e);
            const mitig = 600 / (600 + (t.def || 300));
            const dmg = e.atk * rnd(.8, 1.15) * mitig;
            t.hp = Math.max(0, t.hp - dmg);
            t.hit = .16;
            t.hpFill.style.width = clamp(t.hp / t.maxHp * 100, 0, 100) + '%';
            this.floatText(t.mesh.position, 2.1, '-' + fmt(Math.floor(dmg * 55)), 'ally');
            if (t.hp <= 0) {
              t.dead = true;
              t.mesh.visible = false;
              t.label.style.display = 'none';
              this.burst(t.mesh.position, 0x64748b, 10);
              this.setLog(`${t.name} đã gục ngã!`);
              if (this.allies.every(u => u.dead)) this.defeat();
            }
          }
        }
      }
      this.placeLabel(e);
    });

    this.updateEffects(sdt);

    if (this.shake > 0) {
      this.shake -= dt;
      this.camera.position.x += (Math.random() - .5) * .32;
      this.camera.position.y += (Math.random() - .5) * .32;
      if (this.shake <= 0) this.updateCamera();
    }
    UI.syncBattle(false);
  },

  nearest(from, list) {
    let best = list[0], bd = Infinity;
    list.forEach(u => {
      const d = u.mesh.position.distanceToSquared(from.mesh.position);
      if (d < bd) { bd = d; best = u; }
    });
    return best;
  },

  placeLabel(u) {
    const p = this.toScreen(u.mesh.position, u.labelH || 2.5);
    u.label.style.left = p.x + 'px';
    u.label.style.top = p.y + 'px';
  },

  slash(pos, color) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(.2, 1.35, 18),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .92 }));
    ring.position.copy(pos); ring.position.y = 1;
    ring.lookAt(this.camera.position);
    this.scene.add(ring);
    this.effects.push({ group: ring, simple: true, life: .38, max: .38, mat: ring.material });
  },

  updateEffects(dt) {
    const t = performance.now() * .001;
    if (this.fireflies) {
      this.fireflies.rotation.y += dt * .045;
      this.fireflies.material.opacity = .65 + Math.sin(t * 1.6) * .2;
    }
    if (this.lanterns) {
      this.lanterns.forEach((m, i) => {
        if (m && m.emissiveIntensity !== undefined) m.emissiveIntensity = .55 + Math.sin(t * 2.2 + i) * .25;
      });
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      const k = 1 - (e.life / e.max);
      if (e.simple) {
        if (e.parts) {
          e.parts.forEach(p => {
            p.position.addScaledVector(p.userData.v, dt);
            p.userData.v.y -= 6 * dt;
            p.rotation.x += dt * 5; p.rotation.y += dt * 4;
          });
          if (e.mat) e.mat.opacity = Math.max(0, (1 - k) * .95);
        } else {
          e.group.scale.setScalar(1 + k * 1.6);
          e.group.material.opacity = Math.max(0, 1 - k);
        }
      } else {
        e.circle.rotation.z += dt * 4;
        e.circle.scale.setScalar(.82 + k * .55);
        e.circle.material.opacity = Math.max(0, (1 - k) * .85);
        e.vortex.rotation.z -= dt * 7;
        e.vortex.rotation.y += dt * 5;
        e.vortex.material.opacity = Math.max(0, 1 - k);
        e.shards.forEach(s => {
          s.position.y += s.userData.vy * dt;
          s.userData.ang += dt * 4;
          s.position.x = Math.cos(s.userData.ang) * s.userData.rad;
          s.position.z = Math.sin(s.userData.ang) * s.userData.rad;
        });
      }
      if (e.life <= 0) {
        this.scene.remove(e.group);
        e.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        if (e.mat) e.mat.dispose();
        this.effects.splice(i, 1);
      }
    }
  }
};

const ArenaUI = {
  mark(key) {
    $$('.arena-tab').forEach(b => b.classList.toggle('on', b.dataset.arena === key));
    const tag = $('#arena-name');
    if (tag) tag.textContent = ARENAS[key] ? ARENAS[key].name : '';
  }
};
