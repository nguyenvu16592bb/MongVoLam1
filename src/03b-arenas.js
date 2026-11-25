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
