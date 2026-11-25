/* ============================================================================
   PHẦN 1 — THẾ GIỚI: BIỆN KINH THÀNH (từ map scene)
   ========================================================================== */

const TextureGen = {
  stone() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#9aa8a4'; x.fillRect(0, 0, 512, 512);
    x.strokeStyle = '#6f7c78'; x.lineWidth = 4;
    for (let i = 0; i <= 512; i += 128) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke();
    }
    for (let i = 0; i < 600; i++) {
      x.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(40,50,48,0.07)';
      x.fillRect(Math.random() * 512, Math.random() * 512, 6, 6);
    }
    x.strokeStyle = 'rgba(82,95,92,0.55)'; x.lineWidth = 3;
    x.beginPath(); x.arc(256, 256, 44, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.arc(256, 256, 30, 0, Math.PI * 2); x.stroke();
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6);
    return t;
  },
  roof() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#7a5238'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 256; i += 16) {
      x.fillStyle = '#6a462f'; x.fillRect(i, 0, 6, 256);
      x.fillStyle = '#8a5f42'; x.fillRect(i + 6, 0, 4, 256);
    }
    for (let y = 0; y < 256; y += 32) { x.fillStyle = 'rgba(30,15,5,.3)'; x.fillRect(0, y, 256, 3); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 3);
    return t;
  },
  wall() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#d8d1c2'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      x.fillStyle = i % 2 ? 'rgba(160,150,130,.10)' : 'rgba(255,255,255,.16)';
      x.fillRect(Math.random() * 256, Math.random() * 256, 8, 8);
    }
    for (let i = 0; i < 8; i++) { x.fillStyle = 'rgba(120,110,95,.07)'; x.fillRect(0, i * 32, 256, 2); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 2);
    return t;
  },
  water() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, '#3a8b8c'); g.addColorStop(.5, '#4da39e'); g.addColorStop(1, '#2d7578');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(200,245,240,0.16)'; x.lineWidth = 2;
    for (let i = 0; i < 28; i++) {
      x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 10 + Math.random() * 20, 0, Math.PI * 1.3); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5);
    return t;
  }
};

const Engine = {
  scene: null,
  camera: null,
  renderer: null,
  raycaster: new THREE.Raycaster(),
  mouse: new THREE.Vector2(),
  groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  colliders: [],
  waterMesh: null,
  lanterns: [],
  cameraZoom: 1,
  cameraOffset: new THREE.Vector3(15, 17.5, 15),
  inited: false,

  createWorld() {
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color('#2d4a49');
    scene.fog = new THREE.FogExp2('#2d4a49', 0.0105);

    const aspect = Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight);
    this.cameraZoom = window.innerWidth < window.innerHeight ? .8 : 1;
    const fs = 26 / this.cameraZoom;
    this.camera = new THREE.OrthographicCamera(-fs * aspect / 2, fs * aspect / 2, fs / 2, -fs / 2, 0.1, 160);
    this.camera.position.set(16, 18, 16);
    this.camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight('#fff6e5', '#3b5254', 0.74));

    const dir = new THREE.DirectionalLight('#fff1d6', 0.9);
    dir.position.set(18, 30, 12);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 90;
    const d = 26;
    dir.shadow.camera.left = -d; dir.shadow.camera.right = d;
    dir.shadow.camera.top = d; dir.shadow.camera.bottom = -d;
    dir.shadow.bias = -0.0006;
    scene.add(dir);

    this.buildTown();
    this.bindEvents();
    this.inited = true;
  },

  addCollider(minX, maxX, minZ, maxZ) { this.colliders.push({ minX, maxX, minZ, maxZ }); },

  isWalkable(x, z) {
    if (x < -17 || x > 18 || z < -16 || z > 17) return false;
    if (z > 6.5 && (x < 3.2 || x > 7.8)) return false;
    if (x > 9.5 && (z < 1.5 || z > 5.5)) return false;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return false;
    }
    return true;
  },

  buildTown() {
    const stoneMat = new THREE.MeshStandardMaterial({ map: TextureGen.stone(), roughness: .85, color: '#c2cac5' });
    const trimStoneMat = new THREE.MeshStandardMaterial({ color: '#84918e', roughness: .8 });
    const redWoodMat = new THREE.MeshStandardMaterial({ color: '#8f2922', roughness: .65 });
    const darkWoodMat = new THREE.MeshStandardMaterial({ color: '#4a2e1b', roughness: .75 });
    const roofMat = new THREE.MeshStandardMaterial({ map: TextureGen.roof(), roughness: .7 });
    const goldTrimMat = new THREE.MeshStandardMaterial({ color: '#d49b3b', roughness: .45 });
    const wallPlasterMat = new THREE.MeshStandardMaterial({ map: TextureGen.wall(), color: '#cfc8b8', roughness: .92 });

    // mặt nước
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ map: TextureGen.water(), color: '#48a6a3', roughness: .26, metalness: .15 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.65;
    this.scene.add(water);
    this.waterMesh = water;

    // quảng trường
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(27, .7, 23), stoneMat);
    plaza.position.set(-4, -.35, -5);
    plaza.receiveShadow = true;
    this.scene.add(plaza);

    const north = new THREE.Mesh(new THREE.BoxGeometry(27.4, .85, .6), trimStoneMat);
    north.position.set(-4, -.3, 6.5); north.receiveShadow = true; this.scene.add(north);

    const east = new THREE.Mesh(new THREE.BoxGeometry(.6, .85, 23.4), trimStoneMat);
    east.position.set(9.5, -.3, -5); east.receiveShadow = true; this.scene.add(east);

    const south = new THREE.Mesh(new THREE.BoxGeometry(28, .7, 12), stoneMat);
    south.position.set(6, -.35, 16.5); south.receiveShadow = true; this.scene.add(south);

    const eastBank = new THREE.Mesh(new THREE.BoxGeometry(12, .7, 24), stoneMat);
    eastBank.position.set(19, -.35, -2); eastBank.receiveShadow = true; this.scene.add(eastBank);

    this.buildBridge(5.5, 8.6, true);
    this.buildBridge(11.3, 3.5, false);
    this.buildRailing(-15, 6.4, 14, true);
    this.buildPavilion(redWoodMat, roofMat, goldTrimMat, wallPlasterMat, trimStoneMat);
    this.buildMarket(darkWoodMat, trimStoneMat);

    this.buildLantern(1.8, 1.5);
    this.buildLantern(-10.5, -2.5);
    this.buildLantern(8.5, -6.5);

    // Đài Tham Bái — cạnh Tiên Cô (x -12, z -6): bệ đá + 2 đèn lồng
    const shrineBase = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, .5, 12), trimStoneMat);
    shrineBase.position.set(-12, .25, -7.6); shrineBase.receiveShadow = true; this.scene.add(shrineBase);
    const shrineAltar = new THREE.Mesh(new THREE.BoxGeometry(1.4, .9, .7), redWoodMat);
    shrineAltar.position.set(-12, .95, -7.6); shrineAltar.castShadow = true; this.scene.add(shrineAltar);
    const shrineTrim = new THREE.Mesh(new THREE.BoxGeometry(1.5, .1, .8), goldTrimMat);
    shrineTrim.position.set(-12, 1.45, -7.6); this.scene.add(shrineTrim);
    this.buildLantern(-13.6, -7.6);
    this.buildLantern(-10.4, -7.6);
    this.addCollider(-13.6, -10.4, -8.4, -6.8);

    const lotus = [
      [-11, 9], [-9, 10.5], [-13, 11.2], [-7.5, 8.8], [-10.2, 12.5], [-6, 11.5],
      [11.2, 8.2], [12.5, 9.6], [10.4, 10.2], [13.5, 7.8]
    ];
    lotus.forEach(p => this.buildLotus(p[0], p[1]));

    this.buildTree(-14.5, -8.5);
    this.buildTree(12.5, -10.5);
    this.buildTree(-14.8, 3.5);
    this.buildCrate(-14.2, 5.1);
    this.buildCrate(-13.4, 5.3);

    // bảng hiệu thành
    this.buildCitySign(-8.6, 4.6);

    if (State.customProps && State.customProps.length) {
      State.customProps.forEach(p => this.placeProp(p.type, p.x, p.z, false));
    }
  },

  buildCitySign(x, z) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#3b2414', roughness: .85 });
    const gold = new THREE.MeshStandardMaterial({ color: '#d8a53c', metalness: .55, roughness: .35 });
    [-1.3, 1.3].forEach(px => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.11, .13, 3.2, 8), wood);
      post.position.set(px, 1.6, 0); post.castShadow = true; g.add(post);
    });
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.1, .95, .16), wood);
    board.position.set(0, 2.6, 0); board.castShadow = true; g.add(board);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(3.25, .09, .2), gold);
    trim.position.set(0, 3.08, 0); g.add(trim);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.05, .55, 4), new THREE.MeshStandardMaterial({ color: '#7f1d1d', roughness: .7 }));
    roof.rotation.y = Math.PI / 4; roof.scale.set(1.3, 1, .45); roof.position.set(0, 3.4, 0); g.add(roof);
    // chữ nổi "Biện Kinh" bằng canvas
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2a1a0c'; ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = '#d8a53c'; ctx.lineWidth = 6; ctx.strokeRect(8, 8, 496, 144);
    ctx.fillStyle = '#ffdf9a';
    ctx.font = 'bold 92px "Palatino Linotype", Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('BIỆN KINH', 256, 86);
    const tex = new THREE.CanvasTexture(c);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.85, .89), new THREE.MeshBasicMaterial({ map: tex }));
    plate.position.set(0, 2.6, .09);
    g.add(plate);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.addCollider(x - 1.6, x + 1.6, z - .3, z + .3);
  },

  buildBridge(cx, cz, ns) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: '#8b9793', roughness: .82 });
    const rail = new THREE.MeshStandardMaterial({ color: '#a1aca7', roughness: .78 });
    const w = ns ? 4.4 : 4.2, d = ns ? 4.4 : 4.0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, .45, d), stone);
    deck.position.y = .08; deck.castShadow = true; deck.receiveShadow = true; g.add(deck);
    if (ns) {
      [-w / 2 + .2, w / 2 - .2].forEach(rx => {
        const r = new THREE.Mesh(new THREE.BoxGeometry(.32, .95, d + .4), rail);
        r.position.set(rx, .55, 0); r.castShadow = true; g.add(r);
        [-d / 2, 0, d / 2].forEach(pz => {
          const p = new THREE.Mesh(new THREE.BoxGeometry(.46, 1.25, .46), rail);
          p.position.set(rx, .65, pz); g.add(p);
        });
      });
    } else {
      [-d / 2 + .2, d / 2 - .2].forEach(rz => {
        const r = new THREE.Mesh(new THREE.BoxGeometry(w + .4, .95, .32), rail);
        r.position.set(0, .55, rz); r.castShadow = true; g.add(r);
      });
    }
    g.position.set(cx, 0, cz);
    this.scene.add(g);
  },

  buildRailing(startX, z, len, horizontal) {
    const mat = new THREE.MeshStandardMaterial({ color: '#95a19b', roughness: .78 });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? len : .3, .85, horizontal ? .3 : len), mat);
    rail.position.set(startX + (horizontal ? len / 2 : 0), .42, z);
    rail.castShadow = true; this.scene.add(rail);
    for (let i = 0; i <= len; i += 2.8) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(.45, 1.15, .45), mat);
      p.position.set(startX + i, .55, z); this.scene.add(p);
    }
  },

  buildPavilion(redWoodMat, roofMat, goldTrimMat, wallPlasterMat, stoneMat) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(16, .6, 7.5), stoneMat);
    base.position.set(0, .3, -10.5); base.receiveShadow = true; g.add(base);

    const body1 = new THREE.Mesh(new THREE.BoxGeometry(14.5, 3.6, 6.2), wallPlasterMat);
    body1.position.set(0, 2.4, -10.5); body1.castShadow = true; body1.receiveShadow = true; g.add(body1);

    for (let x = -7; x <= 7; x += 3.5) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(.22, .24, 3.8, 12), redWoodMat);
      c.position.set(x, 2.4, -7.2); c.castShadow = true; g.add(c);
    }

    const roof1 = new THREE.Mesh(new THREE.ConeGeometry(9.4, 2.0, 4), roofMat);
    roof1.rotation.y = Math.PI / 4; roof1.scale.set(1.2, 1, .55); roof1.position.set(0, 5.25, -10.3);
    roof1.castShadow = true; g.add(roof1);

    const trim1 = new THREE.Group();
    [[0, -4.1], [0, 4.1]].forEach(p => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(16.4, .22, .24), goldTrimMat);
      b.position.set(p[0], 4.3, p[1]); trim1.add(b);
    });
    [[-8.2, 0], [8.2, 0]].forEach(p => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(.24, .22, 8.2), goldTrimMat);
      b.position.set(p[0], 4.3, p[1]); trim1.add(b);
    });
    trim1.position.z = -10.3;
    g.add(trim1);

    const balcony = new THREE.Group();
    [[0, -2.6], [0, 2.6]].forEach(p => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(11.2, .24, .22), redWoodMat);
      b.position.set(p[0] - 1.2, 4.5, p[1] - 10.5); balcony.add(b);
    });
    [[-5.6, 0], [5.6, 0]].forEach(p => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(.22, .24, 5.2), redWoodMat);
      b.position.set(p[0] - 1.2, 4.5, p[1] - 10.5); balcony.add(b);
    });
    g.add(balcony);

    const body2 = new THREE.Mesh(new THREE.BoxGeometry(8.8, 2.2, 4), redWoodMat);
    body2.position.set(-1.2, 6.4, -10.5); body2.castShadow = true; g.add(body2);

    const roof2 = new THREE.Mesh(new THREE.ConeGeometry(7.0, 2.0, 4), roofMat);
    roof2.rotation.y = Math.PI / 4; roof2.scale.set(1.25, 1, .6); roof2.position.set(-1.2, 8.4, -10.5);
    roof2.castShadow = true; g.add(roof2);

    const stairs = new THREE.Group();
    for (let s = 0; s < 10; s++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(2.2, .35, .6), redWoodMat);
      st.position.set(0, .4 + s * .38, -6.5 - s * .42); st.castShadow = true; stairs.add(st);
    }
    const rl = new THREE.Mesh(new THREE.BoxGeometry(.18, .9, 5.4), redWoodMat);
    rl.position.set(-1.05, 2.4, -8.4); rl.rotation.x = .72; stairs.add(rl);
    const rr = rl.clone(); rr.position.x = 1.05; stairs.add(rr);
    stairs.position.set(4.5, 0, .2); g.add(stairs);

    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, 6.5, 8), new THREE.MeshStandardMaterial({ color: '#3b2414' }));
    flagPole.position.set(7.6, 3.25, -5.9); g.add(flagPole);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(.08, 2.4, .85), new THREE.MeshStandardMaterial({ color: '#2b4c3f' }));
    banner.position.set(7.6, 4.8, -5.4); g.add(banner);

    this.scene.add(g);
    this.addCollider(-8.5, 8.2, -14.5, -5.3);
  },

  buildMarket(darkWoodMat, stoneMat) {
    const g = new THREE.Group();
    [[-2.3, -1.8], [2.3, -1.8], [-2.3, 1.8], [2.3, 1.8]].forEach(p => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.11, .12, 3.3, 8), darkWoodMat);
      pole.position.set(p[0], 1.65, p[1]); pole.castShadow = true; g.add(pole);
    });
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(3.7, 1.35, 4), new THREE.MeshStandardMaterial({ color: '#3b6b8f', roughness: .88 }));
    canopy.rotation.y = Math.PI / 4; canopy.scale.set(1.15, 1, .95); canopy.position.set(0, 3.65, 0);
    canopy.castShadow = true; g.add(canopy);

    const counter = new THREE.Mesh(new THREE.BoxGeometry(4.4, .95, 1.4), darkWoodMat);
    counter.position.set(0, .48, .9); counter.castShadow = true; counter.receiveShadow = true; g.add(counter);

    ['#eab308', '#f97316', '#84cc16', '#ef4444'].forEach((col, i) => {
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(.42, .32, .25, 12), new THREE.MeshStandardMaterial({ color: col }));
      basket.position.set(-1.4 + i * .9, 1.05, .9); g.add(basket);
    });
    const jarMat = new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: .5 });
    [[-2.7, 1.2], [-2.8, -.6], [2.5, 1.3]].forEach(p => {
      const jar = new THREE.Mesh(new THREE.SphereGeometry(.42, 12, 10), jarMat);
      jar.scale.set(1, 1.25, 1); jar.position.set(p[0], .48, p[1]); jar.castShadow = true; g.add(jar);
    });
    const stove = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.3), stoneMat);
    stove.position.set(-3.6, .55, -1.6); stove.castShadow = true; g.add(stove);

    g.position.set(-5.2, 0, -3.2);
    this.scene.add(g);
    this.addCollider(-8.9, -2.3, -5.6, -1.1);
  },

  buildLantern(x, z) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#4f321c', roughness: .8 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(.18, 3.1, .18), wood);
    post.position.y = 1.55; post.castShadow = true; g.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(.9, .12, .12), wood);
    arm.position.set(.35, 2.95, 0); g.add(arm);
    const mat = new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#dc2626', emissiveIntensity: .65 });
    const lan = new THREE.Mesh(new THREE.CylinderGeometry(.24, .24, .52, 10), mat);
    lan.position.set(.7, 2.55, 0); g.add(lan);
    const light = new THREE.PointLight('#ff6b35', .55, 7);
    light.position.set(.7, 2.5, 0); g.add(light);
    g.position.set(x, 0, z); this.scene.add(g);
    this.lanterns.push(lan);
  },

  buildLotus(x, z) {
    const g = new THREE.Group();
    const padMat = new THREE.MeshStandardMaterial({ color: '#3b8c47', roughness: .7 });
    const flowerMat = new THREE.MeshStandardMaterial({ color: '#f472b6', emissive: '#be185d', emissiveIntensity: .2 });
    [[0, 0, .65], [.7, .4, .5], [-.6, .5, .55]].forEach(p => {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(p[2], p[2], .05, 14), padMat);
      pad.position.set(p[0], -.58, p[1]); g.add(pad);
    });
    const f = new THREE.Mesh(new THREE.ConeGeometry(.28, .35, 8), flowerMat);
    f.rotation.x = Math.PI; f.position.set(.1, -.42, .1); g.add(f);
    g.position.set(x, 0, z); this.scene.add(g);
  },

  buildTree(x, z) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.28, .42, 2.5, 8), new THREE.MeshStandardMaterial({ color: '#4a2f1d' }));
    trunk.position.y = 1.25; trunk.castShadow = true; g.add(trunk);
    const fol = new THREE.MeshStandardMaterial({ color: '#4c8c3b', roughness: .8 });
    [[0, 3.1, 0, 1.7], [-.9, 2.6, .6, 1.2], [.9, 2.7, -.5, 1.25]].forEach(p => {
      const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(p[3], 1), fol);
      crown.position.set(p[0], p[1], p[2]); crown.castShadow = true; g.add(crown);
    });
    g.position.set(x, 0, z); this.scene.add(g);
    this.addCollider(x - .8, x + .8, z - .8, z + .8);
  },

  buildCrate(x, z) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(.85, .85, .85), new THREE.MeshStandardMaterial({ color: '#784b2a', roughness: .8 }));
    c.position.set(x, .42, z); c.castShadow = true; this.scene.add(c);
  },

  placeProp(type, x, z, save) {
    if (type === 'lantern') this.buildLantern(x, z);
    else if (type === 'tree') this.buildTree(x, z);
    else if (type === 'barrel') this.buildCrate(x, z);
    else if (type === 'lotus') this.buildLotus(x, z);
    if (save) {
      State.customProps.push({ type, x: +x.toFixed(2), z: +z.toFixed(2) });
      SaveManager.save();
      UI.toast('Đã đặt vật phẩm lên bản đồ!');
    }
  },

  resize() {
    if (!this.camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    const aspect = w / h;
    const fs = 26 / this.cameraZoom;
    this.camera.left = -fs * aspect / 2;
    this.camera.right = fs * aspect / 2;
    this.camera.top = fs / 2;
    this.camera.bottom = -fs / 2;
    this.camera.updateProjectionMatrix();
    if (PixiFX.app && PixiFX.app.renderer) PixiFX.app.renderer.resize(w, h);
  },

  bindEvents() {
    const canvas = $('#three-canvas');
    if (!canvas) return;

    canvas.addEventListener('wheel', e => {
      if (Game.mode !== 'world') return;
      e.preventDefault();
      this.cameraZoom = clamp(this.cameraZoom - e.deltaY * 0.0008, .72, 1.7);
      this.resize();
    }, { passive: false });

    const hit = (cx, cy) => {
      if (Game.mode !== 'world') return;
      Sfx.ensure();
      const rect = canvas.getBoundingClientRect();
      this.mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.groundPlane, p)) return;

      const npc = CharacterManager.npcNear(p.x, p.z, 1.9);
      if (npc) {
        const spot = this.walkableNear(npc.mesh.position.x, npc.mesh.position.z, 1.5);
        PlayerController.moveTo(spot.x, spot.z, () => World.talkTo(npc));
        PixiFX.ripple(cx - rect.left, cy - rect.top, 0x38bdf8);
        return;
      }
      if (this.isWalkable(p.x, p.z)) {
        PlayerController.moveTo(p.x, p.z);
        PixiFX.ripple(cx - rect.left, cy - rect.top, 0xfacc15);
      } else {
        UI.toast('Vị trí này không thể đi qua!');
      }
    };
    canvas.addEventListener('click', e => hit(e.clientX, e.clientY));
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) hit(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
  },

  walkableNear(x, z, r) {
    if (this.isWalkable(x, z)) return { x, z };
    for (let ring = 1; ring <= 4; ring++) {
      const rad = r * ring / 1.5;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2 + ring * .3;
        const nx = x + Math.cos(ang) * rad;
        const nz = z + Math.sin(ang) * rad;
        if (this.isWalkable(nx, nz)) return { x: nx, z: nz };
      }
    }
    return { x: x + 1.4, z: z + 1.4 };
  }
};

/* ============================== NHÂN VẬT CHIBI ============================== */
const CharacterManager = {
  entities: [],

  create(opt) {
    const g = new THREE.Group();

    if (opt.aura) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(.45, .72, 24),
        new THREE.MeshBasicMaterial({ color: opt.aura, side: THREE.DoubleSide, transparent: true, opacity: .72 })
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = .03; g.add(ring);
    }
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(.48, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .33 })
    );
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .02; g.add(shadow);

    const bodyMat = new THREE.MeshStandardMaterial({ color: opt.robe || '#334155', roughness: .6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.26, .36, .85, 12), bodyMat);
    body.position.y = .55; body.castShadow = true; g.add(body);

    const belt = new THREE.Mesh(new THREE.CylinderGeometry(.31, .32, .16, 12), new THREE.MeshStandardMaterial({ color: opt.belt || '#d97706' }));
    belt.position.y = .52; g.add(belt);

    const armMat = new THREE.MeshStandardMaterial({ color: '#fde68a' });
    const la = new THREE.Mesh(new THREE.SphereGeometry(.14, 8, 8), armMat);
    la.position.set(-.38, .65, 0); g.add(la);
    const ra = la.clone(); ra.position.x = .38; g.add(ra);

    const head = new THREE.Mesh(new THREE.SphereGeometry(.44, 16, 14), new THREE.MeshStandardMaterial({ color: '#ffedd5', roughness: .5 }));
    head.position.y = 1.32; head.castShadow = true; g.add(head);

    const hairMat = new THREE.MeshStandardMaterial({ color: opt.hair || '#cbd5e1', roughness: .5 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(.47, 16, 12, 0, Math.PI * 2, 0, Math.PI * .62), hairMat);
    cap.position.y = 1.36; g.add(cap);

    const bun = new THREE.Mesh(new THREE.SphereGeometry(.2, 10, 10), hairMat);
    bun.position.set(0, 1.65, -.25); g.add(bun);

    if (opt.hat) {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(.75, .35, 16), new THREE.MeshStandardMaterial({ color: '#d4a359' }));
      hat.position.y = 1.75; g.add(hat);
    }
    if (opt.weapon) {
      const spear = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 2.2, 6), new THREE.MeshStandardMaterial({ color: opt.weapon }));
      spear.position.set(.45, 1.1, .1); spear.rotation.z = -.25; g.add(spear);
    }

    g.position.set(opt.x || 0, 0, opt.z || 0);
    Engine.scene.add(g);

    const el = document.createElement('div');
    el.className = 'nameplate ' + (opt.isPlayer ? 'player' : opt.isNpc ? 'npc' : 'town');
    el.innerHTML =
      (opt.quest ? `<span class="qmark">${opt.quest}</span>` : '') +
      (opt.guild ? `<span class="guild">${esc(opt.guild)}</span>` : '') +
      `<span>${esc(opt.name)}</span>`;
    $('#nameplates').appendChild(el);

    const ent = Object.assign({}, opt, { mesh: g, head, body, el, bob: Math.random() * 6.28 });
    this.entities.push(ent);
    return ent;
  },

  initPopulation() {
    this.entities.length = 0;
    $('#nameplates').innerHTML = '';

    const player = this.create({
      id: 'player', name: State.player.name, x: -.2, z: .4,
      robe: '#3b2f2f', belt: '#38bdf8', hair: '#dbeafe', isPlayer: true
    });
    PlayerController.entity = player;

    this.create({
      id: 'merchant', name: 'Chưởng Quầy Tạp Hóa', x: -5.2, z: -3.2,
      robe: '#c084fc', belt: '#facc15', hair: '#1e1b18', isNpc: true, quest: '!',
      role: 'merchant', portrait: '🏮',
      dialogue: 'Chào mừng thiếu hiệp Song Ma Quyền Phái! Quầy tạp hóa Biện Kinh có đủ linh đan, binh khí và lương thảo hành tẩu giang hồ.'
    });

    this.create({
      id: 'master', name: 'Võ Sư Lôi Đài', x: 3.4, z: -3.8,
      robe: '#b91c1c', belt: '#facc15', hair: '#f8fafc', hat: true, isNpc: true, quest: '⚔',
      role: 'arena', portrait: '🥋',
      dialogue: 'Lôi đài Biện Kinh đang mở cửa luận võ! Thiếu hiệp chọn chiến trường nào? Rừng Trúc U Minh, Đài Phật Anh Đào hay Biện Kinh Thành Cổ?'
    });

    this.create({
      id: 'elder', name: 'Trưởng Lão Tàng Kinh Các', x: -9.6, z: 1.4,
      robe: '#0f766e', belt: '#e2b13c', hair: '#e2e8f0', isNpc: true, quest: '📜',
      role: 'elder', portrait: '📜',
      dialogue: 'Tàng Kinh Các lưu giữ hồ sơ của mọi cao thủ trong đội hình. Muốn xem tư chất, duyên phận hay bồi dưỡng đệ tử, cứ mở hồ sơ nhân vật.'
    });

    this.create({
      id: 'recruiter', name: 'Tiên Cô Tham Bái', x: -12, z: -6,
      robe: '#a855f7', belt: '#facc15', hair: '#f8fafc', isNpc: true, quest: '🙏',
      role: 'recruit', portrait: '🙏',
      dialogue: 'Đài Tham Bái linh ứng — đệ tử hữu duyên sẽ tự tìm đến. Thiếu hiệp muốn thử vận không?'
    });

    this.create({
      id: 'eventer', name: 'Sứ Giả Sự Kiện', x: 8.2, z: -0.6,
      robe: '#dc2626', belt: '#facc15', hair: '#1e1b18', isNpc: true, quest: '📅',
      role: 'event', portrait: '📅',
      dialogue: 'Sự kiện giang hồ đang mở! Điểm danh hằng ngày, nhiệm vụ ngày, Boss Thế Giới lúc 12h và 20h, Bang Chiến Thứ 7 — thiếu hiệp ghé trang Sự Kiện nhận quà nhé!'
    });

    const town = [
      { name: 'Thiên Địa Hội [MV]', x: -4.2, z: 6.0, robe: '#166534', hair: '#e2e8f0', hat: true, weapon: '#ef4444', guild: 'Bang Thiên Địa' },
      { name: 'Hùng Luckyet', x: -12.5, z: 4.8, robe: '#15803d', hair: '#cbd5e1', hat: true, weapon: '#ef4444' },
      { name: 'Thiên Địa Đảo', x: -1.6, z: 5.0, robe: '#1e1b4b', hair: '#f8fafc', aura: '#38bdf8' },
      { name: 'Thích Sakugiao', x: 1.4, z: 5.8, robe: '#a21caf', hair: '#1e293b' },
      { name: 'Hoa Lan Đạt', x: -2.6, z: -.6, robe: '#7e22ce', hair: '#0f172a' },
      { name: 'Tham Lang Lam', x: 4.2, z: -2.4, robe: '#111827', hair: '#f1f5f9' },
      { name: 'Thích Tâm', x: 6.4, z: 2.1, robe: '#78350f', hair: '#334155' },
      { name: 'Nữ Hiệp Cầu Đá', x: 5.5, z: 9.2, robe: '#4338ca', hair: '#1e1b4b', aura: '#e879f9', weapon: '#38bdf8' }
    ];
    town.forEach(p => this.create(p));
  },

  npcNear(x, z, r) {
    let best = null, min = r;
    this.entities.forEach(e => {
      if (!e.isNpc) return;
      const d = Math.hypot(e.mesh.position.x - x, e.mesh.position.z - z);
      if (d < min) { min = d; best = e; }
    });
    return best;
  },

  update(dt, time) {
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    this.entities.forEach(e => {
      const moving = e.isPlayer && PlayerController.isMoving;
      const sp = moving ? 14 : 3.2;
      const amp = moving ? .12 : .03;
      e.mesh.position.y = Math.abs(Math.sin(time * sp + e.bob)) * amp;
      if (e.isPlayer) e.mesh.rotation.z = moving ? Math.sin(time * 12) * .03 : 0;

      v.set(e.mesh.position.x, e.mesh.position.y + 1.95, e.mesh.position.z);
      v.project(Engine.camera);
      const sx = (v.x * .5 + .5) * w;
      const sy = (-v.y * .5 + .5) * h;
      if (v.z < 1 && sx > -90 && sx < w + 90 && sy > -60 && sy < h + 60) {
        if (!e.isPlayer && !e.isNpc && PlayerController.entity) {
          const d = Math.hypot(e.mesh.position.x - PlayerController.entity.mesh.position.x,
            e.mesh.position.z - PlayerController.entity.mesh.position.z);
          e.el.style.opacity = d > 8.5 ? '0' : '1';
        }
        e.el.style.display = 'flex';
        e.el.style.left = sx + 'px';
        e.el.style.top = sy + 'px';
      } else {
        e.el.style.display = 'none';
      }
    });
  }
};

/* ============================== ĐIỀU KHIỂN ============================== */
const PlayerController = {
  entity: null,
  target: null,
  onArrive: null,
  isMoving: false,
  keys: {},

  initInput() {
    window.addEventListener('keydown', e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      this.keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
  },

  moveTo(x, z, cb) {
    this.target = new THREE.Vector3(x, 0, z);
    this.onArrive = cb || null;
  },

  stop() { this.target = null; this.onArrive = null; this.isMoving = false; },

  update(dt) {
    if (!this.entity) return;
    const p = this.entity.mesh.position;
    const speed = State.player.speed;
    let mx = 0, mz = 0;
    if (this.keys['w'] || this.keys['arrowup']) { mx -= 1; mz -= 1; }
    if (this.keys['s'] || this.keys['arrowdown']) { mx += 1; mz += 1; }
    if (this.keys['a'] || this.keys['arrowleft']) { mx -= 1; mz += 1; }
    if (this.keys['d'] || this.keys['arrowright']) { mx += 1; mz -= 1; }

    if (mx || mz) {
      this.target = null; this.onArrive = null;
      const len = Math.hypot(mx, mz);
      const nx = p.x + (mx / len) * speed * dt;
      const nz = p.z + (mz / len) * speed * dt;
      if (Engine.isWalkable(nx, nz)) { p.x = nx; p.z = nz; }
      this.entity.mesh.rotation.y = Math.atan2(mx, mz);
      this.isMoving = true;
    } else if (this.target) {
      const dx = this.target.x - p.x, dz = this.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < .22) {
        this.target = null;
        this.isMoving = false;
        const cb = this.onArrive;
        this.onArrive = null;
        if (cb) cb();
      } else {
        const step = Math.min(dist, speed * dt);
        const nx = p.x + (dx / dist) * step;
        const nz = p.z + (dz / dist) * step;
        if (Engine.isWalkable(nx, nz)) {
          p.x = nx; p.z = nz;
          this.entity.mesh.rotation.y = Math.atan2(dx, dz);
          this.isMoving = true;
        } else {
          // trượt theo trục còn lại
          let slid = false;
          if (Engine.isWalkable(nx, p.z)) { p.x = nx; slid = true; }
          if (Engine.isWalkable(p.x, nz)) { p.z = nz; slid = true; }
          if (!slid) { this.target = null; this.isMoving = false; this.onArrive = null; }
          else { this.entity.mesh.rotation.y = Math.atan2(dx, dz); this.isMoving = true; }
        }
      }
    } else {
      this.isMoving = false;
    }

    if (p.z > 7.2 && p.x > 3 && p.x < 8) progressQuest('q3', 1);

    const desired = new THREE.Vector3(p.x + Engine.cameraOffset.x, Engine.cameraOffset.y, p.z + Engine.cameraOffset.z);
    Engine.camera.position.lerp(desired, 0.1);
    Engine.camera.lookAt(p.x, .8, p.z);
  }
};

/* ============================== PIXI FX ============================== */
const PixiFX = {
  app: null,
  petals: [],
  ripples: [],

  async init() {
    try {
      if (typeof PIXI === 'undefined') return;
      const host = $('#pixi-layer');
      if (!host) return;
      const app = new PIXI.Application();
      await app.init({
        width: window.innerWidth, height: window.innerHeight,
        backgroundAlpha: 0, antialias: true
      });
      this.app = app;
      host.appendChild(app.canvas);

      for (let i = 0; i < 22; i++) {
        const g = new PIXI.Graphics();
        g.ellipse(0, 0, 5, 3);
        g.fill({ color: i % 2 === 0 ? 0xffb7c5 : 0xffd1dc, alpha: .72 });
        g.x = Math.random() * app.screen.width;
        g.y = Math.random() * app.screen.height;
        g.vx = -.35 - Math.random() * .55;
        g.vy = .45 + Math.random() * .65;
        g.rs = (Math.random() - .5) * .05;
        app.stage.addChild(g);
        this.petals.push(g);
      }
      app.ticker.add(() => this.tick());
    } catch (e) { console.warn('[pixi] overlay bỏ qua:', e.message); }
  },

  tick() {
    if (!this.app) return;
    if (Game.mode !== 'world') return;
    const W = this.app.screen.width, H = this.app.screen.height;
    this.petals.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rotation += p.rs;
      if (p.x < -10) p.x = W + 10;
      if (p.y > H + 10) { p.y = -10; p.x = Math.random() * W; }
    });
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.radius += 1.6; r.alpha -= .04;
      r.clear();
      r.ellipse(0, 0, r.radius * 1.4, r.radius * .75);
      r.stroke({ width: 2.5, color: r.color, alpha: Math.max(0, r.alpha) });
      if (r.alpha <= 0) { this.app.stage.removeChild(r); r.destroy(); this.ripples.splice(i, 1); }
    }
  },

  ripple(x, y, color) {
    if (!this.app) return;
    const ring = new PIXI.Graphics();
    ring.x = x; ring.y = y; ring.radius = 6; ring.alpha = .95; ring.color = color;
    this.app.stage.addChild(ring);
    this.ripples.push(ring);
  }
};

/* ============================== WORLD ============================== */
const World = {
  enter(silent) {
    Game.mode = 'world';
    UI.showScreen('world');
    if (Engine.camera && PlayerController.entity) {
      const p = PlayerController.entity.mesh.position;
      Engine.camera.position.set(p.x + Engine.cameraOffset.x, Engine.cameraOffset.y, p.z + Engine.cameraOffset.z);
      Engine.camera.lookAt(p.x, .8, p.z);
    }
    UI.syncWorld();
    if (!silent) UI.toast('Biện Kinh Thành · Giang hồ tự tại', 'gold');
  },

  talkTo(npc) {
    Sfx.click();
    const box = $('#dialogue');
    box.innerHTML = `
      <div class="dbox gp">
        <div class="portrait">${npc.portrait || '🧙'}</div>
        <div class="dcontent">
          <h3>${esc(npc.name)} <button data-act="close-dialogue">[Đóng]</button></h3>
          <p>${esc(npc.dialogue)}</p>
          <div class="dacts">
            ${npc.role === 'merchant' ? `<button class="btn" data-act="merchant-shop">🛒 Mở sạp chợ</button>` : ''}
            ${npc.role === 'arena' ? `<button class="btn red" data-act="open-battle">⚔️ Chọn chiến trường</button>` : ''}
            ${npc.role === 'elder' ? `<button class="btn" data-act="open-info">📜 Mở hồ sơ đội hình</button>` : ''}
            ${npc.role === 'recruit' ? `<button class="btn" data-act="open-recruit">🙏 Tham Bái Chiêu Mộ</button>` : ''}
            ${npc.role === 'event' ? `<button class="btn" data-act="open-event">📅 Mở trang Sự Kiện</button>` : ''}
            <button class="btn dark" data-act="close-dialogue">Đa tạ tiền bối</button>
          </div>
        </div>
      </div>`;
    box.classList.add('on');
    if (npc.role === 'merchant') progressQuest('q1', 1);
  },

  update(dt, time) {
    PlayerController.update(dt);
    CharacterManager.update(dt, time);
    if (Engine.waterMesh && Engine.waterMesh.material.map) {
      Engine.waterMesh.material.map.offset.x = time * .025;
      Engine.waterMesh.material.map.offset.y = time * .018;
    }
    Engine.lanterns.forEach((l, i) => { l.rotation.z = Math.sin(time * 2.2 + i) * .08; });
  }
};
