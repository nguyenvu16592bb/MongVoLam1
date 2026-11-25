/* ============================================================================
   PHẦN 2b — NÂNG CẤP MỸ THUẬT 3 ĐẤU TRƯỜNG (ghi đè builder gốc)
   ========================================================================== */

const ArenaTex = {
  _cache: {},
  _get(key, make) {
    if (!this._cache[key]) this._cache[key] = make.call(this);
    return this._cache[key];
  },
  noise(base, spots, size) {
    size = size || 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.fillStyle = base;
    x.fillRect(0, 0, size, size);
    for (let i = 0; i < 1500; i++) {
      x.fillStyle = spots[i % spots.length];
      x.globalAlpha = rnd(.06, .26);
      x.beginPath();
      x.arc(rnd(0, size), rnd(0, size), rnd(2, 15), 0, 6.283);
      x.fill();
    }
    x.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  },
  ground() { return this._get('ground', () => { const t = this.noise('#3b5631', ['#4b6b3c', '#2c4224', '#556f43', '#243a1e']); t.repeat.set(9, 9); return t; }); },
  stone() { return this._get('stone', () => { const t = this.noise('#8d968c', ['#7d867c', '#9aa39a', '#6d766c', '#a7afa5'], 256); t.repeat.set(4, 4); return t; }); },
  plaza() { return this._get('plaza', () => { const t = this.noise('#b7c2b2', ['#a9b4a5', '#c6d0c0', '#9aa596', '#d2dccd'], 256); t.repeat.set(6, 6); return t; }); },
  water() { return this._get('water', () => { const t = this.noise('#2f7d78', ['#3f9d95', '#256b67', '#59b6ac', '#1d5a56']); t.repeat.set(6, 6); return t; }); },
  leaf() { return this._get('leaf', () => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 7; i++) {
      x.save();
      x.translate(64, 64);
      x.rotate(rnd(0, 6.28));
      x.fillStyle = i % 2 ? '#3f7a30' : '#4f9440';
      x.beginPath();
      x.ellipse(0, rnd(-26, 26), rnd(8, 13), rnd(24, 40), 0, 0, 6.283);
      x.fill();
      x.restore();
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  })
  }
};

function lanternPost(g, x, z, scale) {
  scale = scale || 1;
  const wood = new THREE.MeshStandardMaterial({ color: '#3f2a16', roughness: .85 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(.18 * scale, 3.2 * scale, .18 * scale), wood);
  post.position.set(x, 1.6 * scale, z);
  post.castShadow = true;
  g.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(.95 * scale, .13 * scale, .13 * scale), wood);
  arm.position.set(x + .38 * scale, 3.05 * scale, z);
  g.add(arm);
  const mat = new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#dc2626', emissiveIntensity: .7, roughness: .5 });
  const lan = new THREE.Mesh(new THREE.CylinderGeometry(.22 * scale, .22 * scale, .5 * scale, 10), mat);
  lan.position.set(x + .72 * scale, 2.65 * scale, z);
  g.add(lan);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.27 * scale, .27 * scale, .06 * scale, 10),
    new THREE.MeshStandardMaterial({ color: '#d4a359', metalness: .5, roughness: .4 }));
  cap.position.set(x + .72 * scale, 2.92 * scale, z);
  g.add(cap);
  return mat;
}

function stoneLantern(g, x, z) {
  const mat = new THREE.MeshStandardMaterial({ map: ArenaTex.stone(), color: '#a9b1a7', roughness: .85 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.34, .46, .3, 8), mat);
  base.position.set(x, .15, z); g.add(base);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.13, .16, 1.3, 8), mat);
  pole.position.set(x, .95, z); g.add(pole);
  const box = new THREE.Mesh(new THREE.BoxGeometry(.62, .52, .62), mat);
  box.position.set(x, 1.86, z); box.castShadow = true; g.add(box);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(.34, .26, .34),
    new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ff9f1a', emissiveIntensity: 1.1 }));
  glow.position.set(x, 1.86, z); g.add(glow);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(.52, .28, 4), mat);
  roof.position.set(x, 2.24, z); roof.rotation.y = Math.PI / 4; g.add(roof);
}

function bambooStalk(g, x, z, h, leafMat) {
  const stem = new THREE.MeshStandardMaterial({ color: 0x557f2e, roughness: .5 });
  const n = Math.max(3, Math.floor(h / 1.7));
  for (let s = 0; s < n; s++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(.13, .16, 1.7, 7), stem);
    seg.position.set(x, s * 1.7 + .85, z);
    seg.castShadow = true;
    g.add(seg);
  }
  for (let k = 0; k < 3; k++) {
    const lf = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.2), leafMat);
    lf.position.set(x + rnd(-.6, .6), h + rnd(-1.2, .6), z + rnd(-.6, .6));
    lf.rotation.y = rnd(0, 6.28);
    lf.rotation.z = rnd(-.25, .25);
    g.add(lf);
  }
}

Object.assign(Battle, {
  buildBamboo() {
    const g = this.arenaGroup, scene = this.scene;
    scene.background = new THREE.Color(0x14251a);
    scene.fog = new THREE.FogExp2(0x1b3122, .013);
    this.lanterns = [];
    this.fireflies = null;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96),
      new THREE.MeshStandardMaterial({ map: ArenaTex.ground(), roughness: .96 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);

    const stoneMat = new THREE.MeshStandardMaterial({ map: ArenaTex.stone(), roughness: .84, color: '#c0c7bd' });
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(11.6, 12.1, .42, 56), stoneMat);
    dais.position.y = .21;
    dais.receiveShadow = true;
    g.add(dais);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(11.72, .1, 8, 64),
      new THREE.MeshStandardMaterial({ color: '#d9b45e', metalness: .55, roughness: .38 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = .44;
    g.add(rim);

    const darkStone = new THREE.MeshStandardMaterial({ map: ArenaTex.stone(), color: '#8b938a', roughness: .9 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(1.15, .07, 4.3), darkStone);
      slab.position.set(Math.cos(a) * 7.2, .44, Math.sin(a) * 7.2);
      slab.rotation.y = -a;
      slab.receiveShadow = true;
      g.add(slab);
    }

    // Cổng torii phía bắc
    const red = new THREE.MeshStandardMaterial({ color: '#a3201a', roughness: .62 });
    [-4.7, 4.7].forEach(x => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.35, .42, 6.6, 10), red);
      p.position.set(x, 3.3, -10.6); p.castShadow = true; g.add(p);
      const b = new THREE.Mesh(new THREE.BoxGeometry(.95, .42, .95), darkStone);
      b.position.set(x, .21, -10.6); g.add(b);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(11.8, .6, .82), red);
    beam.position.set(0, 6.2, -10.6); beam.castShadow = true; g.add(beam);
    const beam2 = new THREE.Mesh(new THREE.BoxGeometry(9.2, .38, .62), red);
    beam2.position.set(0, 4.95, -10.6); g.add(beam2);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(12.6, .34, 1.25),
      new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: .7 }));
    cap.position.set(0, 6.62, -10.6); g.add(cap);
    this.lanterns.push(lanternPost(g, -7.4, -11.3, .9), lanternPost(g, 7.4, -11.3, .9));

    // Đèn đá & đèn lồng quanh sân
    [[-9.6, -4], [9.6, -4], [-9.6, 4.6], [9.6, 4.6]].forEach(p => stoneLantern(g, p[0], p[1]));
    this.lanterns.push(lanternPost(g, -12.4, .4, 1), lanternPost(g, 12.4, .4, 1));

    // Rừng trúc
    const leafMat = new THREE.MeshBasicMaterial({ map: ArenaTex.leaf(), transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: .95 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 12.2 + Math.random() * 7.5;
      const bx = Math.cos(a) * dist, bz = Math.sin(a) * dist;
      if (bz > 9 && Math.abs(bx) < 8) continue;
      bambooStalk(g, bx, bz, 8 + Math.random() * 6, leafMat);
    }

    // Đom đóm
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(120 * 3);
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 10;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = .5 + Math.random() * 5;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fireflies = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xb6ff8a, size: .11, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    g.add(this.fireflies);
  },

  buildBuddha() {
    const g = this.arenaGroup, scene = this.scene;
    scene.background = new THREE.Color(0x4a6264);
    scene.fog = new THREE.FogExp2(0x7c9696, .011);
    this.lanterns = [];
    this.fireflies = null;

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96),
      new THREE.MeshStandardMaterial({ map: ArenaTex.ground(), color: '#7f9679', roughness: .95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.06;
    ground.receiveShadow = true;
    g.add(ground);

    const stoneMat = new THREE.MeshStandardMaterial({ map: ArenaTex.plaza(), roughness: .82, color: '#c2bcab' });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(27, .6, 23), stoneMat);
    floor.position.y = -.3;
    floor.receiveShadow = true;
    g.add(floor);

    const darkStone = new THREE.MeshStandardMaterial({ map: ArenaTex.stone(), color: '#9aa198', roughness: .86 });
    [-13.6, 13.6].forEach(x => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.8, 1.3, 23), darkStone);
      rail.position.set(x, .65, 0); rail.castShadow = true; g.add(rail);
      for (let z = -10; z <= 10; z += 4) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.7, 1.1), darkStone);
        post.position.set(x, .85, z); g.add(post);
      }
    });

    // Tượng Đại Phật
    const buddhaMat = new THREE.MeshStandardMaterial({ map: ArenaTex.stone(), color: '#b7b9a9', roughness: .9 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.4, 1.4, 24), darkStone);
    base.position.set(0, .7, -10.4); base.castShadow = true; g.add(base);
    const body = new THREE.Mesh(new THREE.SphereGeometry(3.6, 20, 16), buddhaMat);
    body.scale.set(1.35, .55, .8); body.position.set(0, 2.1, -10.6); body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(2.35, 22, 18), buddhaMat);
    head.scale.set(.94, 1.12, .9); head.position.set(0, 5.1, -10.6); head.castShadow = true; g.add(head);
    const ush = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), buddhaMat);
    ush.position.set(0, 7.35, -10.6); g.add(ush);

    // Khuôn mặt Đại Phật
    const faceMat = new THREE.MeshStandardMaterial({ color: '#4c4f45', roughness: .95 });
    [-1, 1].forEach(s => {
      const brow = new THREE.Mesh(new THREE.BoxGeometry(1.0, .13, .16), faceMat);
      brow.position.set(s * .92, 5.72, -8.36); brow.rotation.z = s * .16; g.add(brow);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(.86, .1, .12), faceMat);
      eye.position.set(s * .92, 5.42, -8.34); g.add(eye);
    });
    const nose = new THREE.Mesh(new THREE.BoxGeometry(.22, .62, .18), faceMat);
    nose.position.set(0, 5.02, -8.32); g.add(nose);
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(.34, .07, 6, 14, Math.PI), faceMat);
    mouth.position.set(0, 4.66, -8.3); mouth.rotation.z = Math.PI; g.add(mouth);
    const urna = new THREE.Mesh(new THREE.SphereGeometry(.11, 8, 8), new THREE.MeshStandardMaterial({ color: '#e8c97a', emissive: '#8a6a1a', emissiveIntensity: .5 }));
    urna.position.set(0, 5.94, -8.36); g.add(urna);
    [-1, 1].forEach(s => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(.42, 10, 10), buddhaMat);
      ear.scale.set(.5, 1.5, .6); ear.position.set(s * 2.28, 4.95, -10.5); g.add(ear);
    });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(3.1, .12, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: .55 }));
    halo.position.set(0, 5.6, -12.4); g.add(halo);

    // Cây anh đào
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x452719, roughness: .9 });
    const bloom = new THREE.MeshStandardMaterial({ color: 0xf9a8d4, emissive: 0x831843, emissiveIntensity: .28, roughness: .8 });
    [[-12, -7.5], [12, -7.5], [-14, 2], [14, 2]].forEach(p => {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(.42, .75, 5.4, 8), trunkMat);
      tr.position.set(p[0], 2.7, p[1]); tr.castShadow = true; g.add(tr);
      const br = new THREE.Mesh(new THREE.CylinderGeometry(.16, .3, 3, 6), trunkMat);
      br.position.set(p[0] + .9, 4.6, p[1] + .4); br.rotation.z = .7; g.add(br);
      for (let b = 0; b < 4; b++) {
        const cr = new THREE.Mesh(new THREE.DodecahedronGeometry(1.45, 1), bloom);
        cr.position.set(p[0] + rnd(-2.2, 2.2), 5.4 + rnd(-.6, 1.1), p[1] + rnd(-2.2, 2.2));
        cr.castShadow = true; g.add(cr);
      }
    });

    [[-10.5, -5], [10.5, -5], [-10.5, 5], [10.5, 5]].forEach(p => stoneLantern(g, p[0], p[1]));
    this.lanterns.push(lanternPost(g, -13.4, -2, .95), lanternPost(g, 13.4, -2, .95));

    // Cánh hoa anh đào bay
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(90 * 3);
    for (let i = 0; i < 90; i++) {
      pos[i * 3] = rnd(-16, 16);
      pos[i * 3 + 1] = rnd(.4, 10);
      pos[i * 3 + 2] = rnd(-16, 16);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fireflies = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffc2dd, size: .14, transparent: true, opacity: .9, depthWrite: false
    }));
    g.add(this.fireflies);
  },

  buildCity() {
    const g = this.arenaGroup, scene = this.scene;
    scene.background = new THREE.Color(0x2f6462);
    scene.fog = new THREE.FogExp2(0x4b7f7d, .0105);
    this.lanterns = [];
    this.fireflies = null;

    const water = new THREE.Mesh(new THREE.PlaneGeometry(96, 96),
      new THREE.MeshStandardMaterial({ map: ArenaTex.water(), color: '#48a6a3', roughness: .22, metalness: .35 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -.55;
    g.add(water);

    const stoneMat = new THREE.MeshStandardMaterial({ map: ArenaTex.plaza(), roughness: .8, color: '#bdb8a8' });
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(27, .8, 23), stoneMat);
    plaza.position.y = -.1;
    plaza.receiveShadow = true;
    g.add(plaza);

    const darkStone = new THREE.MeshStandardMaterial({ map: ArenaTex.stone(), color: '#aab2aa', roughness: .86 });
    [-13.8, 13.8].forEach(x => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(.55, 1.1, 23), darkStone);
      rail.position.set(x, .55, 0); g.add(rail);
    });

    // Cầu đá phía nam
    const bridge = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5, .45, 7), darkStone);
    deck.position.y = .1; deck.receiveShadow = true; bridge.add(deck);
    [-2.35, 2.35].forEach(x => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(.28, .95, 7.4), darkStone);
      r.position.set(x, .6, 0); bridge.add(r);
    });
    bridge.position.set(0, 0, 10.8);
    g.add(bridge);

    // Lầu các phía bắc
    const redWood = new THREE.MeshStandardMaterial({ color: '#8f2922', roughness: .66 });
    const plaster = new THREE.MeshStandardMaterial({ color: '#e5e0d0', roughness: .88 });
    const roofMat = new THREE.MeshStandardMaterial({ map: TextureGen.roof(), roughness: .72 });
    const pbase = new THREE.Mesh(new THREE.BoxGeometry(15, .5, 5.4), darkStone);
    pbase.position.set(0, .25, -10.6); g.add(pbase);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(13, 3.6, 4.6), plaster);
    wall.position.set(0, 2.1, -10.8); wall.castShadow = true; g.add(wall);
    for (let x = -6; x <= 6; x += 3) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(.24, .26, 3.8, 10), redWood);
      c.position.set(x, 2, -8.3); c.castShadow = true; g.add(c);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9.6, 2.2, 4), roofMat);
    roof.rotation.y = Math.PI / 4; roof.scale.set(1.15, 1, .62);
    roof.position.set(0, 4.9, -10.8); roof.castShadow = true; g.add(roof);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(15.2, .2, 6), new THREE.MeshStandardMaterial({ color: '#d49b3b', metalness: .5, roughness: .4 }));
    trim.position.set(0, 3.95, -10.8); g.add(trim);

    // Quán trà bạt xanh
    const tentPole = new THREE.MeshStandardMaterial({ color: '#4a2e1b', roughness: .85 });
    [[-8.6, -3], [-4.8, -3], [-8.6, 1], [-4.8, 1]].forEach(p => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, 3.2, 8), tentPole);
      pole.position.set(p[0], 1.6, p[1]); g.add(pole);
    });
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(3.7, 1.3, 4),
      new THREE.MeshStandardMaterial({ color: '#2e5575', roughness: .86 }));
    canopy.rotation.y = Math.PI / 4; canopy.scale.set(1.15, 1, .95);
    canopy.position.set(-6.7, 3.55, -1); canopy.castShadow = true; g.add(canopy);

    // Hồ sen quanh sân
    const padMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4b, roughness: .8 });
    const lotusMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xbe185d, emissiveIntensity: .3 });
    for (let i = 0; i < 26; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const lx = side * (14 + Math.random() * 6);
      const lz = (Math.random() - .5) * 24;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(.7, .7, .06, 12), padMat);
      pad.position.set(lx, -.5, lz); g.add(pad);
      if (i % 3 === 0) {
        const fl = new THREE.Mesh(new THREE.ConeGeometry(.32, .38, 6), lotusMat);
        fl.position.set(lx, -.34, lz); g.add(fl);
      }
    }

    [[-11.5, 5], [11.5, 5], [-11.5, -6], [11.5, -6]].forEach(p => stoneLantern(g, p[0], p[1]));
    this.lanterns.push(lanternPost(g, -7.6, 6.4, 1), lanternPost(g, 7.6, 6.4, 1));
  }
});

/* ============================================================================
   ARENA10-BEGIN — Battle Map 4..10: 7 builder 3D mới (tuyết, sa mạc, núi lửa,
   đầm lầy, vân cung, hang quỷ, hồ sen). Tái dùng helper chung + ArenaTex,
   không copy-paste builder cũ. Map 1..3 dùng lại buildBamboo/buildBuddha/buildCity.
   ========================================================================== */

/* Texture riêng cho 7 map mới (dùng chung ArenaTex.noise). */
Object.assign(ArenaTex, {
  snow() { return this._get('snow', () => { const t = this.noise('#e8f1f8', ['#ffffff', '#d3e5f2', '#c2d8ea', '#f4f8fc'], 256); t.repeat.set(8, 8); return t; }); },
  sand() { return this._get('sand', () => { const t = this.noise('#d9b06a', ['#c89a52', '#e8c887', '#b98a44', '#f0d194'], 256); t.repeat.set(8, 8); return t; }); },
  lavaRock() { return this._get('lavaRock', () => { const t = this.noise('#2b2320', ['#3d2f28', '#1c1714', '#4a2c1e', '#5c1f12'], 256); t.repeat.set(8, 8); return t; }); },
  swamp() { return this._get('swamp', () => { const t = this.noise('#3d4a26', ['#2f3d1e', '#4c5a30', '#556b35', '#26331a'], 256); t.repeat.set(8, 8); return t; }); },
  cloud() { return this._get('cloud', () => { const t = this.noise('#dfeefc', ['#ffffff', '#cfe4f8', '#eef6ff', '#bcd8f2'], 256); t.repeat.set(8, 8); return t; }); },
  caveRock() { return this._get('caveRock', () => { const t = this.noise('#241f2e', ['#322a40', '#1a1522', '#3d3350', '#120e1a'], 256); t.repeat.set(8, 8); return t; }); },
  lake() { return this._get('lake', () => { const t = this.noise('#1d6f8e', ['#2a8ab0', '#16607e', '#4db2d4', '#0f4f6b']); t.repeat.set(6, 6); return t; }); }
});

/* Helper chung cho các builder mới (tránh lặp code nền/đài/đá/phân tán). */
function arenaBase(g, scene, bg, fogColor, fogDensity) {
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.FogExp2(fogColor, fogDensity);
  this.lanterns = [];
  this.fireflies = null;
}
function flatGround(g, material, size) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size || 96, size || 96),
    material);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);
  return ground;
}
function daisDisc(g, r, mat, y) {
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(r, r + .5, .42, 48), mat);
  dais.position.y = y == null ? .21 : y;
  dais.receiveShadow = true;
  g.add(dais);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r + .12, .1, 8, 64),
    new THREE.MeshStandardMaterial({ color: '#d9b45e', metalness: .55, roughness: .38 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = (y == null ? .21 : y) + .23;
  g.add(rim);
  return dais;
}
function scatterRocks(g, n, rMin, rMax, mat, sMin, sMax) {
  for (let i = 0; i < n; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.7 + Math.random() * .8, 0), mat);
    const a = Math.random() * Math.PI * 2;
    const r = rMin + Math.random() * (rMax - rMin);
    rock.position.set(Math.cos(a) * r, .35, Math.sin(a) * r);
    rock.scale.set(1.3, .7, 1.1);
    rock.rotation.y = Math.random() * Math.PI;
    rock.castShadow = true;
    g.add(rock);
  }
}
function driftParticles(g, n, color, size, spread, yMin, yMax, opacity) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * spread;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = yMin + Math.random() * (yMax - yMin);
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color, size, transparent: true, opacity: opacity == null ? .85 : opacity,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  g.add(pts);
  return pts;
}
function glowCrystal(g, x, z, color, h, r) {
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(r || .7, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .9, roughness: .3 }));
  m.position.set(x, (h || 1.4) / 2, z);
  m.scale.y = (h || 1.4) / (r || .7) / 1.4 + .8;
  m.castShadow = true;
  g.add(m);
  return m;
}
function coneTree(g, x, z, h, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .85 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.18, .28, 1.2, 7),
    new THREE.MeshStandardMaterial({ color: '#3f2a16', roughness: .9 }));
  trunk.position.set(x, .6, z);
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6 - i * .42, 2.2, 8), mat);
    cone.position.set(x, 1.4 + i * 1.5, z);
    cone.castShadow = true;
    g.add(cone);
  }
}

Object.assign(Battle, {
  /* Battle Map 4 — Tuyết Sơn Băng Phong */
  buildSnow() {
    const g = this.arenaGroup, scene = this.scene;
    arenaBase.call(this, g, scene, 0x9db8c9, 0xbdd2e2, .011);
    flatGround(g, new THREE.MeshStandardMaterial({ map: ArenaTex.snow(), roughness: .9 }));
    const iceMat = new THREE.MeshStandardMaterial({ map: ArenaTex.snow(), color: '#cfe8f5', roughness: .35, metalness: .15 });
    daisDisc(g, 11.6, iceMat);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8fa3b5, roughness: .9 });
    scatterRocks(g, 12, 12, 20, rockMat);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, dist = 13 + Math.random() * 7;
      coneTree(g, Math.cos(a) * dist, Math.sin(a) * dist, 5, 0x1d4d33);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      glowCrystal(g, Math.cos(a) * 15, Math.sin(a) * 15, 0x7dd3fc, 1.6 + Math.random(), .6);
    }
    const mtn = new THREE.Mesh(new THREE.ConeGeometry(9, 12, 4),
      new THREE.MeshStandardMaterial({ map: ArenaTex.snow(), color: '#dbe9f5', roughness: .85 }));
    mtn.position.set(0, 5, -24); mtn.rotation.y = Math.PI / 4; g.add(mtn);
    this.fireflies = driftParticles(g, 110, 0xffffff, .13, 14, .5, 8, .8);
    this.lanterns.push(lanternPost(g, -12.4, .4, 1), lanternPost(g, 12.4, .4, 1));
  },

  /* Battle Map 5 — Sa Mạc Hoàng Kim */
  buildDesert() {
    const g = this.arenaGroup, scene = this.scene;
    arenaBase.call(this, g, scene, 0xc98f4e, 0xd9b06a, .01);
    flatGround(g, new THREE.MeshStandardMaterial({ map: ArenaTex.sand(), roughness: .98 }));
    const stoneMat = new THREE.MeshStandardMaterial({ map: ArenaTex.stone(), color: '#c9a86a', roughness: .85 });
    daisDisc(g, 11.6, stoneMat);
    const duneMat = new THREE.MeshStandardMaterial({ map: ArenaTex.sand(), color: '#e0bd7e', roughness: 1 });
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, dist = 14 + Math.random() * 8;
      const dune = new THREE.Mesh(new THREE.SphereGeometry(4 + Math.random() * 3, 12, 8), duneMat);
      dune.scale.set(1.4, .32, 1);
      dune.position.set(Math.cos(a) * dist, -.2, Math.sin(a) * dist);
      g.add(dune);
    }
    const pyramid = new THREE.Mesh(new THREE.ConeGeometry(10, 9, 4),
      new THREE.MeshStandardMaterial({ map: ArenaTex.sand(), color: '#d4a95e', roughness: .9 }));
    pyramid.position.set(0, 4.2, -24); pyramid.rotation.y = Math.PI / 4; pyramid.castShadow = true; g.add(pyramid);
    const oasis = new THREE.Mesh(new THREE.PlaneGeometry(10, 7),
      new THREE.MeshStandardMaterial({ map: ArenaTex.water(), color: '#48a6a3', roughness: .2, metalness: .3 }));
    oasis.rotation.x = -Math.PI / 2; oasis.position.set(14, .05, 8); g.add(oasis);
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: .8 });
    [[-14, 6], [13, -9], [-10, -12]].forEach(p => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(.5, .6, 3.4, 8), cactusMat);
      c.position.set(p[0], 1.7, p[1]); c.castShadow = true; g.add(c);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, 1.4, 8), cactusMat);
      arm.position.set(p[0] + .7, 2.2, p[1]); arm.rotation.z = Math.PI / 2; g.add(arm);
    });
    scatterRocks(g, 8, 13, 20, stoneMat);
    this.fireflies = driftParticles(g, 70, 0xf0c98a, .16, 14, .5, 6, .6);
  },

  /* Battle Map 6 — Núi Lửa Thiên Hỏa */
  buildVolcano() {
    const g = this.arenaGroup, scene = this.scene;
    arenaBase.call(this, g, scene, 0x2a1210, 0x3d1a12, .012);
    flatGround(g, new THREE.MeshStandardMaterial({ map: ArenaTex.lavaRock(), roughness: .95 }));
    const obsMat = new THREE.MeshStandardMaterial({ map: ArenaTex.lavaRock(), color: '#4a3430', roughness: .85 });
    daisDisc(g, 11.6, obsMat);
    const volcano = new THREE.Mesh(new THREE.ConeGeometry(12, 13, 8),
      new THREE.MeshStandardMaterial({ map: ArenaTex.lavaRock(), color: '#3a2a24', roughness: .95 }));
    volcano.position.set(0, 6, -24); volcano.castShadow = true; g.add(volcano);
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 2.6, 1, 12),
      new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0xff4400, emissiveIntensity: 1.6 }));
    crater.position.set(0, 12.4, -24); g.add(crater);
    const lavaMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff3300, emissiveIntensity: 1.4, roughness: .4 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + .4;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6 + Math.random(), 14), lavaMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(Math.cos(a) * 15, .06, Math.sin(a) * 15);
      g.add(pool);
    }
    scatterRocks(g, 10, 13, 20, obsMat);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      glowCrystal(g, Math.cos(a) * 14, Math.sin(a) * 14, 0xff7a1a, 1.4, .55);
    }
    this.fireflies = driftParticles(g, 100, 0xffa040, .15, 14, .5, 9, .9);
    this.lanterns.push(lanternPost(g, -12.4, .4, 1), lanternPost(g, 12.4, .4, 1));
  },

  /* Battle Map 7 — Đầm Lầy U Ám */
  buildSwamp() {
    const g = this.arenaGroup, scene = this.scene;
    arenaBase.call(this, g, scene, 0x1c2a16, 0x2c3d22, .016);
    flatGround(g, new THREE.MeshStandardMaterial({ map: ArenaTex.swamp(), roughness: .95 }));
    const stoneMat = new THREE.MeshStandardMaterial({ map: ArenaTex.stone(), color: '#7d8478', roughness: .9 });
    daisDisc(g, 11.6, stoneMat);
    const murkMat = new THREE.MeshStandardMaterial({ map: ArenaTex.water(), color: '#4a6b2a', roughness: .35, metalness: .2 });
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, dist = 13 + Math.random() * 7;
      const pond = new THREE.Mesh(new THREE.CircleGeometry(2 + Math.random() * 1.6, 14), murkMat);
      pond.rotation.x = -Math.PI / 2;
      pond.position.set(Math.cos(a) * dist, .05, Math.sin(a) * dist);
      g.add(pond);
    }
    const deadMat = new THREE.MeshStandardMaterial({ color: 0x3f342a, roughness: .95 });
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, dist = 13 + Math.random() * 7;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.22, .42, 5 + Math.random() * 2, 7), deadMat);
      trunk.position.set(x, 2.5, z); trunk.rotation.z = rnd(-.15, .15); trunk.castShadow = true; g.add(trunk);
      const br = new THREE.Mesh(new THREE.CylinderGeometry(.08, .14, 2.2, 6), deadMat);
      br.position.set(x + .8, 4.6, z); br.rotation.z = .8; g.add(br);
    }
    const shroomMat = new THREE.MeshStandardMaterial({ color: 0xa3e635, emissive: 0x65a30d, emissiveIntensity: .9 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, dist = 8 + Math.random() * 10;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(.32 + Math.random() * .25, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), shroomMat);
      cap.position.set(Math.cos(a) * dist, .1, Math.sin(a) * dist);
      g.add(cap);
    }
    scatterRocks(g, 8, 13, 20, stoneMat);
    this.fireflies = driftParticles(g, 120, 0xb6ff8a, .12, 12, .4, 5, .85);
  },

  /* Battle Map 8 — Vân Cung Thiên Đình */
  buildSky() {
    const g = this.arenaGroup, scene = this.scene;
    arenaBase.call(this, g, scene, 0x7fb4dd, 0xa8cdea, .008);
    flatGround(g, new THREE.MeshStandardMaterial({ map: ArenaTex.cloud(), roughness: .9 }));
    const goldMat = new THREE.MeshStandardMaterial({ color: '#d4a359', metalness: .6, roughness: .35 });
    const marbleMat = new THREE.MeshStandardMaterial({ map: ArenaTex.plaza(), color: '#e8e2d2', roughness: .7 });
    daisDisc(g, 11.6, marbleMat);
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#f5efe0', roughness: .6 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(.45, .55, 7, 10), pillarMat);
      p.position.set(Math.cos(a) * 15, 3.5, Math.sin(a) * 15);
      p.castShadow = true; g.add(p);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.4, .4, 1.4), goldMat);
      cap.position.set(Math.cos(a) * 15, 7.2, Math.sin(a) * 15); g.add(cap);
    }
    const roofMat = new THREE.MeshStandardMaterial({ map: TextureGen.roof(), roughness: .72 });
    const palace = new THREE.Mesh(new THREE.BoxGeometry(13, 3.6, 4.6),
      new THREE.MeshStandardMaterial({ color: '#e5e0d0', roughness: .85 }));
    palace.position.set(0, 2.1, -13); palace.castShadow = true; g.add(palace);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9.6, 2.4, 4), roofMat);
    roof.rotation.y = Math.PI / 4; roof.scale.set(1.15, 1, .62);
    roof.position.set(0, 5.1, -13); roof.castShadow = true; g.add(roof);
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: .92 });
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, dist = 16 + Math.random() * 8;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 1.6, 10, 8), cloudMat);
      puff.scale.y = .45;
      puff.position.set(Math.cos(a) * dist, .8 + Math.random() * 1.2, Math.sin(a) * dist);
      g.add(puff);
    }
    this.fireflies = driftParticles(g, 80, 0xfff2b0, .14, 14, 1, 9, .8);
    this.lanterns.push(lanternPost(g, -12.4, .4, 1), lanternPost(g, 12.4, .4, 1));
  },

  /* Battle Map 9 — Hang Quỷ Âm Phủ */
  buildCave() {
    const g = this.arenaGroup, scene = this.scene;
    arenaBase.call(this, g, scene, 0x120e1a, 0x241a30, .014);
    flatGround(g, new THREE.MeshStandardMaterial({ map: ArenaTex.caveRock(), roughness: .95 }));
    const stoneMat = new THREE.MeshStandardMaterial({ map: ArenaTex.caveRock(), color: '#4a3f5e', roughness: .9 });
    daisDisc(g, 11.6, stoneMat);
    const stalMat = new THREE.MeshStandardMaterial({ map: ArenaTex.caveRock(), color: '#5b4a72', roughness: .9 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, dist = 12 + Math.random() * 8;
      const stal = new THREE.Mesh(new THREE.ConeGeometry(.6 + Math.random() * .5, 3 + Math.random() * 3, 7), stalMat);
      stal.position.set(Math.cos(a) * dist, 7.5, Math.sin(a) * dist);
      stal.rotation.x = Math.PI;
      g.add(stal);
    }
    const crystalColors = [0xa855f7, 0x22d3ee, 0x4ade80];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rnd(-.2, .2);
      glowCrystal(g, Math.cos(a) * 14, Math.sin(a) * 14, crystalColors[i % 3], 1.8 + Math.random() * 1.4, .6);
    }
    const skullMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: .8 });
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, dist = 13 + Math.random() * 5;
      const skull = new THREE.Mesh(new THREE.SphereGeometry(.55, 10, 8), skullMat);
      skull.scale.set(1, .85, 1.1);
      skull.position.set(Math.cos(a) * dist, .45, Math.sin(a) * dist);
      g.add(skull);
    }
    scatterRocks(g, 8, 13, 20, stoneMat);
    this.fireflies = driftParticles(g, 90, 0xc084fc, .14, 12, .5, 7, .85);
    [[-9.6, -4], [9.6, -4], [-9.6, 4.6], [9.6, 4.6]].forEach(p => stoneLantern(g, p[0], p[1]));
  },

  /* Battle Map 10 — Hồ Sen Biển Đông */
  buildLake() {
    const g = this.arenaGroup, scene = this.scene;
    arenaBase.call(this, g, scene, 0x1d5a74, 0x2f7d9e, .01);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(96, 96),
      new THREE.MeshStandardMaterial({ map: ArenaTex.lake(), color: '#3aa3c2', roughness: .18, metalness: .4 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -.55;
    g.add(water);
    const stoneMat = new THREE.MeshStandardMaterial({ map: ArenaTex.plaza(), roughness: .8, color: '#bdb8a8' });
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(27, .8, 23), stoneMat);
    plaza.position.y = -.1;
    plaza.receiveShadow = true;
    g.add(plaza);
    daisDisc(g, 8, new THREE.MeshStandardMaterial({ map: ArenaTex.stone(), color: '#aab2aa', roughness: .85 }), .45);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x3f8f4b, roughness: .8 });
    const lotusMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xbe185d, emissiveIntensity: .35 });
    for (let i = 0; i < 34; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const lx = side * (14 + Math.random() * 8);
      const lz = (Math.random() - .5) * 26;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(.7, .7, .06, 12), padMat);
      pad.position.set(lx, -.5, lz); g.add(pad);
      if (i % 3 === 0) {
        const fl = new THREE.Mesh(new THREE.ConeGeometry(.32, .38, 6), lotusMat);
        fl.position.set(lx, -.34, lz); g.add(fl);
      }
    }
    const reedMat = new THREE.MeshStandardMaterial({ color: 0x4d7c2b, roughness: .8 });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2, dist = 14 + Math.random() * 5;
      const reed = new THREE.Mesh(new THREE.CylinderGeometry(.06, .09, 2.4 + Math.random(), 5), reedMat);
      reed.position.set(Math.cos(a) * dist, .7, Math.sin(a) * dist);
      reed.rotation.z = rnd(-.2, .2);
      g.add(reed);
    }
    const roofMat = new THREE.MeshStandardMaterial({ map: TextureGen.roof(), roughness: .72 });
    const pav = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 5),
      new THREE.MeshStandardMaterial({ color: '#e5e0d0', roughness: .85 }));
    pav.position.set(0, 1.6, -13); pav.castShadow = true; g.add(pav);
    const proof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.8, 4), roofMat);
    proof.rotation.y = Math.PI / 4;
    proof.position.set(0, 3.8, -13); proof.castShadow = true; g.add(proof);
    [[-11.5, 5], [11.5, 5], [-11.5, -6], [11.5, -6]].forEach(p => stoneLantern(g, p[0], p[1]));
    this.lanterns.push(lanternPost(g, -7.6, 6.4, 1), lanternPost(g, 7.6, 6.4, 1));
    this.fireflies = driftParticles(g, 70, 0x9fe8ff, .13, 14, .5, 7, .8);
  }
});
/* ARENA10-END */
