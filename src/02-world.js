/* ============================================================================
   PHẦN 1 — THẾ GIỚI: BIỆN KINH THÀNH (từ map scene)
   ========================================================================== */

/* GROUND-BEGIN — Thứ tự lớp nền (mặt trên theo y) chống z-fighting trên GPU
   điện thoại (depth precision thấp — 2 mặt cùng cao độ sẽ nhấp nháy):
   nước -0.65 < đá 0.00 < cỏ 0.04 < đỉnh đường mòn 0.09 < đỉnh cầu đá 0.305.
   Mỗi tầng cách nhau >= 0.02 (mặt đất) để không còn cặp đồng phẳng nào.
   Bóng/hào quang nhân vật là decal nằm TRÊN mặt đất (shadow 0.07, aura 0.12)
   + polygonOffset -2 để luôn thắng depth test kể cả khi đứng trên đường mòn
   (đỉnh 0.09) hay cầu đá (đỉnh 0.305). Vòng điểm câu/sen (0.34) nằm trên mặt
   cầu đá; vòng đồ rơi (0.08) nằm trên cỏ (0.04); mặt bàn cờ (0.87) nằm trên
   mặt bàn (0.84); biển chữ "Biện Kinh" (z 0.14) nằm trước mặt bảng gỗ (z 0.08);
   mặt giếng tối (0.95) nằm trên vành giếng (0.90). Kiểm chứng bằng
   tools/test-ground.cjs (quy tắc 1/2/3 + camera + chất lượng). */
const GROUND_LAYERS = {
  water: -0.65, stone: 0, grass: 0.04, pathTop: 0.09, deckTop: 0.305,
  shadow: 0.07, aura: 0.12, spotRing: 0.34, dropRing: 0.08,
  chessBoard: 0.87, signPlateZ: 0.14, wellDark: 0.95
};

/* WATER-BEGIN — Mặt nước là 1 tấm phẳng 104×104 (y -0.65) phủ toàn bản đồ;
   chỗ nào không có mặt đất (đá/cỏ/đường/cầu) thì nhìn thấy nước. isWalkable
   cũ chỉ chặn hồ trong khu thành cũ (z>6.5 / x>9.5) rồi return sớm cho vùng
   mở rộng nên 5 khoảng nước ngoài khu cũ vẫn đi được — nhân vật đi bộ xuyên
   qua mặt nước ở đó (trên điện thoại đó là cùng 1 mặt hồ sen, không có ranh
   giới nhìn thấy được). 6 hình chữ nhật nước dưới đây suy ra đúng từ các
   mặt đất trong code (buildTown + Env.buildGround): khoảng trống giữa các
   mặt đất, biên dùng bất đẳng thức nghiêm ngặt như _inCollider để mép đất
   (cỏ/đá) vẫn đi được. Cầu đá KHÔNG nằm trong các hình này nên vẫn đi được
   (luật cầu cũ giữ nguyên).
   - R1 đông-bắc: cỏ bắc hết x=24, cỏ đông bắt đầu z=-14.
   - R2 rãnh tây: cỏ bắc hết z=-16, cỏ tây bắt đầu z=-12.
   - R3 tây-nam: cỏ tây hết z=17, cỏ nam bắt đầu x=-20.
   - R4 đông-nam: cỏ đông hết z=26, cỏ nam hết x=20.
   - R5 rãnh bắc-đông: bờ đông bắt đầu z=-14, cỏ bắc hết z=-16, cỏ đông bắt đầu x=20.
   - R6 mép tây hồ sen: quảng trường hết z=6.5, cỏ tây bắt đầu x=-17. */
const WATER_RECTS = [
  { minX: 24, maxX: 48, minZ: -40, maxZ: -14 },
  { minX: -45, maxX: -17, minZ: -16, maxZ: -12 },
  { minX: -45, maxX: -20, minZ: 17, maxZ: 44 },
  { minX: 20, maxX: 48, minZ: 26, maxZ: 44 },
  { minX: 18, maxX: 25, minZ: -16, maxZ: -14 },
  { minX: -17.5, maxX: -17, minZ: 6.5, maxZ: 10.5 }
];

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
  /* ENV-BEGIN — điểm neo cho môi trường động (xem src/02b-env.js):
     hemiLight/dirLight để đổi sáng theo giờ; lanternLights {light, mat} để
     đèn sáng dần ban đêm; lotusGroups {g, bx, bz} để lá sen nhấp nhô;
     sway [{obj, phase, amp, axis, base}] cho tán cây/bạt chợ/cờ đung đưa. */
  hemiLight: null,
  dirLight: null,
  lotusGroups: [],
  lanternLights: [],
  sway: [],
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
    /* GROUND-BEGIN — camera trực giao near 0.5 / far 90 thay cho 0.1 / 160:
       vùng nhìn thấy có depth tối đa ~63 (tính từ mọi góc bản đồ, kể cả khi
       player đứng góc xa nhất) nên far 90 vẫn bao hết, còn khoảng depth
       89.5 thay cho 159.9 giúp depth precision tốt hơn ~1.8× trên điện thoại.
       near 0.5 vẫn an toàn vì vật gần camera nhất (ngọn cây/cột cờ ngay dưới
       camera) cũng cách mặt phẳng camera > 5. */
    this.camera = new THREE.OrthographicCamera(-fs * aspect / 2, fs * aspect / 2, fs / 2, -fs / 2, 0.5, 90);
    this.camera.position.set(16, 18, 16);
    this.camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight('#fff6e5', '#3b5254', 0.74));
    this.hemiLight = scene.children[scene.children.length - 1];

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
    this.dirLight = dir;

    this.buildTown();
    /* ENV-BEGIN — mở rộng bản đồ + dựng cổng dịch chuyển, cá chép, hạt mưa/tuyết. */
    if (typeof Env !== 'undefined') Env.buildExpansion();
    /* DISTRICT-BEGIN — biển chỉ khu vực trên 3 cổng dịch chuyển (xem DistrictGates). */
    if (typeof DistrictGates !== 'undefined') DistrictGates.buildSigns();
    /* INTERACT-BEGIN — rương/bướm/điểm câu/điểm sen/bàn cờ (xem InteractWorld). */
    if (typeof InteractWorld !== 'undefined') InteractWorld.build();
    this.bindEvents();
    this.inited = true;
  },

  addCollider(minX, maxX, minZ, maxZ) { this.colliders.push({ minX, maxX, minZ, maxZ }); },

  /* ENV-BEGIN — Bản đồ mở rộng 2–3×: x∈[-45,48], z∈[-40,44].
     Vùng mở rộng (ngoài hình chữ nhật thành cũ x∈[-17,18], z∈[-16,17]) là
     đất liền mới (ruộng/khu dân cư) nên đi được, chỉ chặn bởi collider —
     TRỪ các khoảng nước hở (WATER_RECTS) vẫn chặn như hồ sen.
     Luật cầu của khu cũ giữ nguyên: hồ sen z>6.5 chỉ qua được cầu x∈[3.2,7.8],
     bờ đông x>9.5 chỉ qua được cầu z∈[1.5,5.5]. */
  _inCollider(x, z) {
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
    }
    return false;
  },

  /* WATER-BEGIN — điểm có nằm trong mặt nước hở (xem WATER_RECTS) không. */
  _inWater(x, z) {
    for (let i = 0; i < WATER_RECTS.length; i++) {
      const r = WATER_RECTS[i];
      if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return true;
    }
    return false;
  },

  isWalkable(x, z) {
    if (x < -45 || x > 48 || z < -40 || z > 44) return false;
    /* WATER-BEGIN — chặn nước TRƯỚC khi return sớm cho vùng mở rộng:
       luật cầu + hồ khu cũ ở dưới chỉ chạy trong khu cũ, còn nước vùng
       mở rộng trước đây lọt qua return sớm nên đi xuyên được. */
    if (this._inWater(x, z)) return false;
    if (x < -17 || x > 18 || z < -16 || z > 17) return !this._inCollider(x, z);
    if (z > 6.5 && (x < 3.2 || x > 7.8)) return false;
    if (x > 9.5 && (z < 1.5 || z > 5.5)) return false;
    return !this._inCollider(x, z);
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

    const east = new THREE.Mesh(new THREE.BoxGeometry(.6, .85, 22.8), trimStoneMat);
    east.position.set(9.5, -.3, -5.3); east.receiveShadow = true; this.scene.add(east); /* GROUND-BEGIN — dài 22.8 (z -16.7..6.1) thay cho 23.4 để không chồng góc với viền bắc (z 6.2..6.8): 2 đỉnh cùng y 0.125 trước đây nhấp nháy ở ô góc 0.6×0.6. */

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
    this.buildCrate(-13.3, 5.3); /* GROUND-BEGIN — x -13.3 thay cho -13.4: 2 thùng 0.85³ trước đây chồng nhau 0.05 ở mép nên đỉnh cùng y 0.845 nhấp nháy theo dải hẹp. */

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
    plate.position.set(0, 2.6, GROUND_LAYERS.signPlateZ); /* GROUND-BEGIN — z 0.14, cách mặt trước bảng gỗ (z 0.08) 0.06 thay cho 0.01 trước đây. */
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
      const b = new THREE.Mesh(new THREE.BoxGeometry(15.92, .22, .24), goldTrimMat); /* GROUND-BEGIN — dài 15.92 thay cho 16.4 để 2 đầu không chồng lên 2 thanh dọc (x ±8.2): 4 ô góc cùng đỉnh y 4.41 trước đây nhấp nháy. */
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
      const b = new THREE.Mesh(new THREE.BoxGeometry(10.98, .24, .22), redWoodMat); /* GROUND-BEGIN — dài 10.98 thay cho 11.2 để 2 đầu chỉ chạm mép 2 thanh dọc (x -6.8/4.4), không chồng đỉnh y 4.62 như trước. */
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
    this.sway.push({ obj: canopy, phase: Math.random() * 6.28, amp: .03, axis: 'z', base: 0 }); /* ENV: bạt chợ rung theo gió (giữ rotation.y gốc) */

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
    this.lanternLights.push({ light, mat }); /* ENV: đèn sáng dần ban đêm */
  },

  buildLotus(x, z) {
    const g = new THREE.Group();
    const padMat = new THREE.MeshStandardMaterial({ color: '#3b8c47', roughness: .7 });
    const flowerMat = new THREE.MeshStandardMaterial({ color: '#f472b6', emissive: '#be185d', emissiveIntensity: .2 });
    /* GROUND-BEGIN — 3 lá sen cùng cụm lệch cao độ 0.025/lá (-0.58/-0.555/-0.53)
       thay cho cùng y -0.58: các lá chồng nhau (tâm cách 0.7–0.8, bán kính
       0.5–0.65) nên mặt trên đồng phẳng trước đây nhấp nháy. */
    [[0, 0, .65, -.58], [.7, .4, .5, -.555], [-.6, .5, .55, -.53]].forEach(p => {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(p[2], p[2], .05, 14), padMat);
      pad.position.set(p[0], p[3], p[1]); g.add(pad);
    });
    const f = new THREE.Mesh(new THREE.ConeGeometry(.28, .35, 8), flowerMat);
    f.rotation.x = Math.PI; f.position.set(.1, -.42, .1); g.add(f);
    g.position.set(x, 0, z); this.scene.add(g);
    this.lotusGroups.push({ g, bx: x, bz: z }); /* ENV: lá sen nhấp nhô + trôi */
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
    this.sway.push({ obj: g, phase: Math.random() * 6.28, amp: .018, axis: 'z', base: 0 }); /* ENV: tán cây đung đưa theo gió */
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
      /* NPC-BEGIN — chạm vào thú cưng thì chỉ hiện emote vui, không di chuyển. */
      if (typeof NpcAI !== 'undefined') {
        const pet = NpcAI.petNear(p.x, p.z, 1.9);
        if (pet) { NpcAI.petEmote(pet); PixiFX.ripple(cx - rect.left, cy - rect.top, 0xf472b6); return; }
      }
      /* INTERACT-BEGIN — chạm vào rương/đồ rơi/bướm/điểm câu/điểm sen/bàn cờ:
         nhân vật tự đi tới gần rồi thực hiện hành động (kiểm tra TRƯỚC nhánh
         isWalkable/moveTo, giống npcNear). */
      if (typeof InteractWorld !== 'undefined') {
        const it = InteractWorld.nearest(p.x, p.z, 2.0);
        if (it) {
          const spot = this.walkableNear(it.x, it.z, 1.5);
          PlayerController.moveTo(spot.x, spot.z, () => InteractWorld.act(it));
          PixiFX.ripple(cx - rect.left, cy - rect.top, 0xfacc15);
          return;
        }
      }
      /* ENV-BEGIN — chạm vào cổng dịch chuyển / giếng cổ thì mở lựa chọn cổng. */
      if (typeof Env !== 'undefined') {
        const gate = Env.gateNear(p.x, p.z, 2.2);
        if (gate) {
          /* DISTRICT-BEGIN — mở modal 2 lựa chọn (đi vòng / vào khu vực)
             thay vì dịch chuyển ngay; vòng teleport 3 cổng không đổi. */
          if (typeof DistrictGates !== 'undefined') DistrictGates.openGateChoice(gate);
          else Env.teleportToGate(gate);
          return;
        }
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
        /* GROUND-BEGIN — decal hào quang: y = GROUND_LAYERS.aura + polygonOffset
           để luôn vẽ trên mặt đất/đường mòn/cầu đá (xem bảng tầng nền đầu file). */
        new THREE.MeshBasicMaterial({ color: opt.aura, side: THREE.DoubleSide, transparent: true, opacity: .72, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = GROUND_LAYERS.aura; g.add(ring);
    }
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(.48, 16),
      /* GROUND-BEGIN — decal bóng: y = GROUND_LAYERS.shadow + polygonOffset
         (trước đây y 0.02, chỉ cách mặt đá 0.02 và chìm dưới mặt cỏ 0.04). */
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .33, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    );
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = GROUND_LAYERS.shadow; g.add(shadow);

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
      id: 'merchant', name: 'Chưởng Quầy Tạp Hóa', x: -5.2, z: -0.4,
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

    /* NPC-BEGIN — NPC mới (thợ rèn/thầy thuốc/người kể chuyện + 2 trẻ con):
       defs ở src/01-data.js (NPC_NEW_DEFS). Trẻ con scale 0.7 sau khi tạo
       (CharacterManager.create không có tham số scale). */
    if (typeof NPC_NEW_DEFS !== 'undefined') {
      NPC_NEW_DEFS.forEach(d => {
        const e = this.create(d);
        if (d.scale) e.mesh.scale.set(d.scale, d.scale, d.scale);
      });
    }
    /* INTERACT-BEGIN — Lão Kỳ Thánh (đấu cờ Caro), def riêng CHESS_NPC_DEF
       (không cho vào NPC_NEW_DEFS để khỏi phá đếm 5 NPC của Nhiệm vụ 3). */
    if (typeof CHESS_NPC_DEF !== 'undefined') this.create(CHESS_NPC_DEF);
    /* FBX-BEGIN — Thợ Dựng Cảnh (đặt mô hình .fbx), def riêng như Lão Kỳ Thánh. */
    if (typeof SCENE_BUILDER_NPC_DEF !== 'undefined') this.create(SCENE_BUILDER_NPC_DEF);
    /* NPC-BEGIN — gắn lịch trình/lưu vị trí neo + dựng thú cưng. */
    if (typeof NpcAI !== 'undefined') NpcAI.init();
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
        /* FOLLOW-BEGIN — follower (pet/đệ tử đi theo) luôn hiện tên, không
           ẩn khi xa như dân thường (dù nó luôn đi sát player). */
        if (!e.isPlayer && !e.isNpc && !e.isFollower && PlayerController.entity) {
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

/* ============================== NPC THÔNG MINH ==============================
   NPC-BEGIN — Lịch trình theo giờ game, dân thường đi lại ngẫu nhiên,
   trẻ con chạy nhảy, thú cưng lang thang. Không đổi signature hàm cũ.
   - NPC chính (5 người, NPC_SCHEDULES): đổi ca thì đi bộ chậm (1.2/s) tới
     điểm của ca mới, tránh vật cản bằng cách thử bước lệch góc khi bị chặn.
   - Dân thường (8 người): chọn điểm đi được trong bán kính ~6 quanh vị trí
     neo, đi tới (0.9/s), đứng nghỉ 3–8s rồi lặp lại.
   - Trẻ con: như dân thường nhưng chạy nhanh hơn (2.6/s), bán kính 4,
     nghỉ 1–2.5s. Thú cưng: mesh nhỏ tự dựng, đi chậm 0.7/s, nghỉ 4–10s. */
/* DISTRICT-BEGIN — hình chữ nhật vật cản tĩnh [minX, maxX, minZ, maxZ] mà
   buildTown() + Env.buildExpansion() đăng ký làm collider (lầu, sạp, đài
   Tham Bái, bảng hiệu thành, cây, nhà dân, biển khu mới). Danh sách này
   phải khớp đúng collider của 2 hàm trên — NpcAI._pointFree dùng nó để
   waypoint dân thường/thú cưng luôn đi được thật, kể cả khi Engine.colliders
   còn rỗng (test không buildTown). */
const WANDER_BLOCK_RECTS = [
  [-8.5, 8.2, -14.5, -5.3], [-8.9, -2.3, -5.6, -1.1], [-13.6, -10.4, -8.4, -6.8], [-10.2, -7, 4.3, 4.9],
  ...[[-14.5, -8.5], [12.5, -10.5], [-14.8, 3.5], [-38, -4], [-40, 14], [-24, -32], [6, -34], [22, -30], [26, 20], [42, -4], [-12, 38], [16, 36]]
    .map(p => [p[0] - .8, p[0] + .8, p[1] - .8, p[1] + .8]),
  ...[[-14, -26], [-2, -30], [12, -24], [28, -6], [38, 14]]
    .map(p => [p[0] - 2.2, p[0] + 2.2, p[1] - 1.9, p[1] + 1.9]),
  ...[[-30, 8], [8, 32]]
    .map(p => [p[0] - .4, p[0] + .4, p[1] - .4, p[1] + .4])
];

const NpcAI = {
  pets: [],

  init() {
    if (!CharacterManager.entities) return;
    CharacterManager.entities.forEach(e => this._assign(e));
    this.buildPets();
  },

  _assign(e) {
    if (e.isPlayer || e.isFollower) return;
    if (e.isNpc && typeof NPC_SCHEDULES !== 'undefined' && NPC_SCHEDULES[e.id]) {
      const spot = scheduleSpotFor(e.id, State.worldClock.hour);
      e._shift = spot ? spot.shift : null;
      e._walk = null;
      return;
    }
    if (!e.isNpc) {
      e._anchor = { x: e.mesh.position.x, z: e.mesh.position.z };
      e._wander = { target: null, rest: rnd(1, 4) };
    }
  },

  _isKid(e) { return e.id && e.id.indexOf('child') === 0; },

  update(dt) {
    if (!CharacterManager.entities || !State.worldClock) return;
    const hour = State.worldClock.hour;
    CharacterManager.entities.forEach(e => this.updateEntity(e, dt, hour));
    this.pets.forEach(p => this.updatePet(p, dt));
  },

  updateEntity(e, dt, hour) {
    if (!e || e.isPlayer || e.isFollower || !e.mesh) return;
    /* NPC chính có lịch trình. */
    if (e.isNpc && typeof NPC_SCHEDULES !== 'undefined' && NPC_SCHEDULES[e.id]) {
      const spot = scheduleSpotFor(e.id, hour);
      if (!spot) return;
      if (e._shift !== spot.shift) {
        e._shift = spot.shift;
        e._walk = { x: spot.x, z: spot.z };
      }
      if (e._walk && this._stepToward(e, e._walk.x, e._walk.z, 1.2, dt)) e._walk = null;
      return;
    }
    /* Dân thường + trẻ con: đi lại ngẫu nhiên quanh vị trí neo. */
    if (!e.isNpc) {
      if (!e._anchor) e._anchor = { x: e.mesh.position.x, z: e.mesh.position.z };
      const w = e._wander || (e._wander = { target: null, rest: 2 });
      const kid = this._isKid(e);
      if (w.target) {
        if (this._stepToward(e, w.target.x, w.target.z, kid ? 2.6 : 0.9, dt)) {
          w.target = null;
          w.rest = kid ? rnd(1, 2.5) : rnd(3, 8);
        }
      } else {
        w.rest -= dt;
        if (w.rest <= 0) {
          w.target = this.pickWanderPoint(e._anchor, kid ? 4 : 6);
          if (!w.target) w.rest = 1;
        }
      }
    }
  },

  /* Chọn điểm đi được trong bán kính r quanh neo (thử tối đa 40 lần).
     DISTRICT-BEGIN — sửa flaky test "waypoint dan thuong luon di duoc":
     chỉ xét điểm đi được THẬT: Engine.isWalkable + tránh cả các hình chữ
     nhật vật cản tĩnh (lầu/sạp/đài/bảng/cây/nhà) mà buildTown() +
     Env.buildExpansion() đăng ký làm collider. Engine.colliders chỉ có
     các hình này SAU khi buildTown chạy; trong test (không buildTown)
     colliders rỗng nên phải tự tránh chúng thì waypoint mới luôn đi được.
     Hết lượt thử mà chưa có điểm thì đứng yên tại neo nếu neo đi được
     (vẫn hợp lệ: trong bán kính, đi được), tránh trả null gây flaky. */
  pickWanderPoint(anchor, radius) {
    if (!anchor || typeof Engine === 'undefined' || !Engine.isWalkable) return null;
    for (let i = 0; i < 40; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 1 + Math.random() * (radius - 1);
      const nx = anchor.x + Math.cos(ang) * dist;
      const nz = anchor.z + Math.sin(ang) * dist;
      if (this._pointFree(nx, nz)) return { x: nx, z: nz };
    }
    if (this._pointFree(anchor.x, anchor.z)) return { x: anchor.x, z: anchor.z };
    return null;
  },

  /* Điểm (x,z) đi được thật: qua được Engine.isWalkable VÀ ngoài mọi hình
     vật cản tĩnh (khớp đúng collider của buildTown + Env.buildExpansion). */
  _pointFree(x, z) {
    if (!Engine.isWalkable(x, z)) return false;
    for (let i = 0; i < WANDER_BLOCK_RECTS.length; i++) {
      const r = WANDER_BLOCK_RECTS[i];
      if (x > r[0] && x < r[1] && z > r[2] && z < r[3]) return false;
    }
    return true;
  },

  /* Bước một bước về phía (tx,tz); nếu bị chặn thì thử lệch góc dần
     (tránh nhà/cây/sạp mà không cần tìm đường). Trả về true khi đã tới. */
  _stepToward(e, tx, tz, speed, dt) {
    const p = e.mesh.position;
    const dx = tx - p.x, dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const step = Math.min(dist, speed * dt);
    const base = Math.atan2(dx, dz);
    const offsets = [0, 0.78, -0.78, 1.57, -1.57, 2.35, -2.35, 3.14];
    for (let i = 0; i < offsets.length; i++) {
      const ang = base + offsets[i];
      const nx = p.x + Math.sin(ang) * step;
      const nz = p.z + Math.cos(ang) * step;
      if (Engine.isWalkable(nx, nz)) {
        p.x = nx; p.z = nz;
        e.mesh.rotation.y = ang;
        return false;
      }
    }
    return false;
  },

  /* ---------- thú cưng ---------- */
  buildPets() {
    this.pets = [];
    if (!Engine.scene || typeof THREE === 'undefined' || typeof PET_DEFS === 'undefined') return;
    PET_DEFS.forEach(def => {
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: .7 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(.32, 10, 8), mat);
      body.scale.set(1, .7, 1.4);
      body.position.y = .3; body.castShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.22, 10, 8), mat);
      head.position.set(0, .48, .42); head.castShadow = true; g.add(head);
      if (def.kind === 'cat') {
        [-0.12, 0.12].forEach(ex => {
          const ear = new THREE.Mesh(new THREE.ConeGeometry(.09, .22, 4), mat);
          ear.position.set(ex, .68, .42); g.add(ear);
        });
      } else {
        [-0.2, 0.2].forEach(ex => {
          const ear = new THREE.Mesh(new THREE.SphereGeometry(.11, 8, 6), mat);
          ear.scale.set(.5, 1, .8); ear.position.set(ex, .5, .42); g.add(ear);
        });
      }
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, .5, 6), mat);
      tail.position.set(0, .42, -.48); tail.rotation.x = -0.9; g.add(tail);
      g.position.set(def.x, 0, def.z);
      Engine.scene.add(g);
      let el = null;
      const host = document.getElementById ? document.getElementById('nameplates') : null;
      if (host && document.createElement) {
        el = document.createElement('div');
        el.className = 'nameplate town';
        el.innerHTML = '<span>' + def.name + '</span>';
        host.appendChild(el);
      }
      this.pets.push({
        def, mesh: g, el, anchor: { x: def.x, z: def.z },
        target: null, rest: rnd(2, 5), bob: Math.random() * 6.28
      });
    });
  },

  updatePet(p, dt) {
    if (!p || !p.mesh) return;
    const pos = p.mesh.position;
    if (p.target) {
      const fake = { mesh: p.mesh };
      if (this._stepToward(fake, p.target.x, p.target.z, 0.7, dt)) {
        p.target = null;
        p.rest = rnd(4, 10);
      }
    } else {
      p.rest -= dt;
      if (p.rest <= 0) {
        p.target = this.pickWanderPoint(p.anchor, 6);
        if (!p.target) p.rest = 1;
      }
    }
    p.mesh.position.y = Math.abs(Math.sin(performance.now() * .001 * 3 + p.bob)) * .04;
    if (p.el && Engine.camera && window.innerWidth) {
      const v = new THREE.Vector3(pos.x, pos.y + .95, pos.z);
      v.project(Engine.camera);
      const w = window.innerWidth, h = window.innerHeight;
      const sx = (v.x * .5 + .5) * w, sy = (-v.y * .5 + .5) * h;
      if (v.z < 1 && sx > -90 && sx < w + 90 && sy > -60 && sy < h + 60) {
        p.el.style.display = 'flex';
        p.el.style.left = sx + 'px';
        p.el.style.top = sy + 'px';
      } else {
        p.el.style.display = 'none';
      }
    }
  },

  petNear(x, z, r) {
    let best = null, min = r;
    this.pets.forEach(p => {
      const d = Math.hypot(p.mesh.position.x - x, p.mesh.position.z - z);
      if (d < min) { min = d; best = p; }
    });
    return best;
  },

  petEmote(pet) {
    if (!pet) return;
    const lines = pet.def.kind === 'dog'
      ? ['🐶 Gâu gâu! Tiểu Hắc vẫy đuôi mừng thiếu hiệp!', '🐶 Tiểu Hắc chạy vòng quanh chân thiếu hiệp, sủa vui vẻ!']
      : ['🐱 Meo~ Tiểu Miêu dụi đầu vào chân thiếu hiệp!', '🐱 Tiểu Miêu cuộn tròn phơi nắng, kêu meo meo khoan khoái!'];
    UI.toast(pick(lines), 'gold');
  }
};

/* ============================== BẠN ĐỒNG HÀNH ĐI THEO ==============================
   FOLLOW-BEGIN — Nhiệm vụ 5: thú cưng + đệ tử đội trưởng đi theo trong
   thế giới. Chỉ 2 follower, mesh tái dùng từ CharacterManager.create()
   (không tạo geometry mới), chỉ tồn tại ở mode world (World.update chỉ
   chạy ở mode world; vào battle/info thì scene world không render, về
   world thì update() chạy lại ngay). Follower có isFollower:true,
   isNpc:false nên không mở thoại (npcNear chỉ xét isNpc), không bị
   NpcAI đi lang thang, luôn hiện tên (CharacterManager.update bỏ qua
   luật ẩn tên khi xa). Đổi pet/đổi đội trưởng thì tạo lại follower ở
   frame sau; initPopulation() xóa sạch entities thì update() phát hiện
   ent không còn trong CharacterManager.entities, xóa mesh cũ rồi tạo mới
   (không trùng lặp, không rò mesh trong scene). */
const Followers = {
  pet: null,    /* { ent, petId } */
  leader: null, /* { ent, heroId } */

  _destroy(slot) {
    const f = this[slot];
    if (!f) return;
    if (f.ent) {
      if (Engine.scene && f.ent.mesh) Engine.scene.remove(f.ent.mesh);
      if (f.ent.el && f.ent.el.remove) f.ent.el.remove();
      const i = CharacterManager.entities.indexOf(f.ent);
      if (i >= 0) CharacterManager.entities.splice(i, 1);
    }
    this[slot] = null;
  },

  _spawnPet(def) {
    const p = PlayerController.entity ? PlayerController.entity.mesh.position : { x: 0, z: 0 };
    const ent = CharacterManager.create({
      id: 'follower-pet', name: def.name, x: p.x, z: p.z + 1.2,
      robe: def.color, belt: '#facc15', hair: def.hair, aura: def.color,
      isFollower: true, petId: def.id
    });
    ent.mesh.scale.set(0.55, 0.55, 0.55);
    this.pet = { ent, petId: def.id };
  },

  _spawnLeader(def) {
    const p = PlayerController.entity ? PlayerController.entity.mesh.position : { x: 0, z: 0 };
    const ent = CharacterManager.create({
      id: 'follower-leader', name: def.name, x: p.x + 1, z: p.z,
      robe: def.robe, belt: '#facc15', hair: def.hair,
      isFollower: true, heroId: def.id
    });
    ent.mesh.scale.set(0.9, 0.9, 0.9);
    this.leader = { ent, heroId: def.id };
  },

  /* Bước về phía (tx,tz): lerp nhanh; cách >12 thì dịch chuyển tức thời
     tới gần player (kẹt/lạc sau dịch chuyển cổng). Nhún nhanh hơn khi
     player đang di chuyển, quay cùng hướng với player.
     WATER-BEGIN — follower KHÔNG được đi vào nước: mỗi bước lerp đều kiểm
     Engine.isWalkable như PlayerController (trượt theo trục còn lại khi bị
     chặn, vd đi dọc mép cầu đá); dịch chuyển tức thời chỉ đáp chỗ đi được,
     nếu đích ở trong nước thì đáp điểm đi được gần nhất (walkableNear),
     hết cách thì đứng yên 1 frame chờ player đi tiếp — không bao giờ đáp
     hay lerp xuyên qua hồ sen. Trước đây _step không kiểm gì nên pet +
     đội trưởng (lệch phải ~1 ô so với player) thường xuyên đi trên mặt
     nước khi player qua cầu đá hẹp. */
  _step(ent, tx, tz, dt, time, moving) {
    const pos = ent.mesh.position;
    const dx = tx - pos.x, dz = tz - pos.z;
    const dist = Math.hypot(dx, dz);
    const walkable = (typeof Engine !== 'undefined' && Engine.isWalkable)
      ? (x, z) => Engine.isWalkable(x, z) : () => true;
    if (dist > 12) {
      if (walkable(tx, tz)) { pos.x = tx; pos.z = tz; }
      else if (typeof Engine !== 'undefined' && Engine.walkableNear) {
        const spot = Engine.walkableNear(tx, tz, 2);
        if (walkable(spot.x, spot.z)) { pos.x = spot.x; pos.z = spot.z; }
        /* walkableNear hết vòng mà vẫn không đi được thì đứng yên chờ player. */
      }
    } else if (dist > 0.05) {
      const k = Math.min(1, dt * 6);
      const nx = pos.x + dx * k, nz = pos.z + dz * k;
      if (walkable(nx, nz)) { pos.x = nx; pos.z = nz; }
      else if (walkable(nx, pos.z)) { pos.x = nx; }
      else if (walkable(pos.x, nz)) { pos.z = nz; }
      /* cả 2 trục đều chặn (vd mép cầu) thì đứng yên 1 frame. */
    }
    if (PlayerController.entity) ent.mesh.rotation.y = PlayerController.entity.mesh.rotation.y;
    const sp = moving ? 10 : 3.2, amp = moving ? 0.09 : 0.03;
    pos.y = Math.abs(Math.sin(time * sp + ent.bob)) * amp;
  },

  update(dt, time) {
    if (typeof Game === 'undefined' || Game.mode !== 'world') return;
    const pc = PlayerController.entity;
    if (!pc || !pc.mesh) return;

    /* --- thú cưng: tự bỏ theo khi đã bán, tự chọn con đầu tiên nếu chưa
       chọn con nào, đổi pet thì tạo lại con mới. --- */
    if (typeof FollowPets !== 'undefined') {
      if (FollowPets.clearIfSold()) UI.toast('🐾 Thú cưng đã bán nên không còn đi theo nữa!', 'gold');
      FollowPets.ensureDefault();
      const def = FollowPets.activeDef();
      if (!def) { if (this.pet) this._destroy('pet'); }
      else if (!this.pet || this.pet.petId !== def.id || CharacterManager.entities.indexOf(this.pet.ent) < 0) {
        this._destroy('pet');
        this._spawnPet(def);
      }
    }

    /* --- đệ tử đội trưởng: đổi đội trưởng trong Hồ sơ thì người đi theo
       đổi theo (so heroId mỗi frame, khác thì tạo lại). --- */
    const hs = State.heroes[State.leader];
    const def = hs ? heroById(hs.id) : null;
    if (!def) { if (this.leader) this._destroy('leader'); }
    else if (!this.leader || this.leader.heroId !== def.id || CharacterManager.entities.indexOf(this.leader.ent) < 0) {
      this._destroy('leader');
      this._spawnLeader(def);
    }

    /* --- vị trí: pet sau lưng player (cách ~1.2 ô, lệch phải 0.5);
       đội trưởng đi cạnh bên phải (~1 ô, hơi lùi 0.2, không chắn đường). --- */
    const p = pc.mesh.position;
    const th = pc.mesh.rotation.y;
    const fx = Math.sin(th), fz = Math.cos(th);
    const px = Math.cos(th), pz = -Math.sin(th);
    const moving = PlayerController.isMoving;
    if (this.pet) this._step(this.pet.ent, p.x - fx * 1.2 + px * 0.5, p.z - fz * 1.2 + pz * 0.5, dt, time, moving);
    if (this.leader) this._step(this.leader.ent, p.x - fx * 0.2 + px * 1.05, p.z - fz * 0.2 + pz * 1.05, dt, time, moving);
  }
};

/* Dịch vụ NPC mới: rèn vũ khí + chữa thương. Dùng State/UI/SaveManager có
   sẵn, không đổi signature hàm nào. */
const NpcService = {
  FORGE_MAX: 5,
  FORGE_ATK: 5,
  HEAL_COST: 500,

  forge() {
    const npc = State.flags.npc || {};
    if ((npc.forgeCount || 0) >= this.FORGE_MAX) {
      UI.toast('Vũ khí đã rèn tối đa 5 lần rồi!', 'gold');
      if (typeof Emote !== 'undefined') Emote.npc('smith', '😢');
      return false;
    }
    const it = State.inventory.find(i => i.name === 'Huyền Thiết Tinh');
    if (!it || it.qty < 1) {
      UI.toast('Cần 1 Huyền Thiết Tinh trong túi — ra chợ mua nhé!', 'red');
      if (typeof Emote !== 'undefined') Emote.npc('smith', '😢');
      return false;
    }
    it.qty -= 1;
    if (it.qty <= 0) State.inventory.splice(State.inventory.indexOf(it), 1);
    State.player.atk += this.FORGE_ATK;
    State.flags.npc.forgeCount = (npc.forgeCount || 0) + 1;
    SaveManager.save();
    UI.syncWorld();
    Sfx.coin();
    UI.toast('🔨 Rèn thành công! Công kích +5 (đã rèn ' + State.flags.npc.forgeCount + '/5)', 'green');
    if (typeof Emote !== 'undefined') Emote.player('😊');
    return true;
  },

  heal() {
    const p = State.player;
    if (p.hp >= p.maxHp) {
      UI.toast('Sinh lực đã đầy, không cần chữa!', 'gold');
      return false;
    }
    if (p.silver < this.HEAL_COST) {
      UI.toast('Chữa thương cần 500 bạc, thiếu hiệp chưa đủ!', 'red');
      if (typeof Emote !== 'undefined') Emote.npc('healer', '😢');
      return false;
    }
    p.silver -= this.HEAL_COST;
    p.hp = p.maxHp;
    State.flags.npc.healCount = (State.flags.npc.healCount || 0) + 1;
    SaveManager.save();
    UI.syncWorld();
    Sfx.heal();
    UI.toast('💊 Đã hồi đầy sinh lực! (-500 bạc)', 'green');
    if (typeof Emote !== 'undefined') Emote.player('😊');
    return true;
  }
};

/* ============================== TƯƠNG TÁC MỞ RỘNG ==============================
   INTERACT-BEGIN — Nhiệm vụ 4: mesh rương/đồ rơi/bướm/điểm câu/điểm sen/bàn cờ,
   click-to-interact (móc trong Engine.bindEvents, TRƯỚC nhánh isWalkable),
   nút hành động trên HUD khi đứng gần, sinh đồ rơi theo giờ game, bướm bay
   theo đường sin + bắt lại sau 45s ở chỗ khác. Logic thuần nằm ở Interact
   (src/01-data.js); đây chỉ là lớp 3D/HUD. Trạng thái chỉ trong phiên
   (bướm đang bay/bị bắt) giữ trong memory, không lưu save. */
const InteractWorld = {
  _built: false,
  _lastHour: null,
  _hudAcc: 0,
  _dropMeshes: {},
  _chestMeshes: {},
  butterflies: [],

  build() {
    if (this._built || !Engine.scene || typeof THREE === 'undefined') return;
    this._built = true;
    CHEST_DEFS.forEach(d => this.buildChest(d));
    this.buildFishingSpot();
    this.buildLotusSpot();
    this.buildChessBoard();
    BUTTERFLY_ANCHORS.forEach((a, i) => this.buildButterfly(a, i));
    this.syncDropMeshes();
    this._lastHour = Math.floor(State.worldClock.hour);
  },

  buildChest(def) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: .8 });
    const gold = new THREE.MeshStandardMaterial({ color: '#d4a359', metalness: .5, roughness: .4 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(.95, .55, .65), wood);
    base.position.y = .28; base.castShadow = true; g.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1, .28, .7), wood);
    lid.position.y = .68; lid.castShadow = true; g.add(lid);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.02, .08, .72), gold);
    trim.position.y = .55; g.add(trim);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(.16, .2, .06), gold);
    lock.position.set(0, .5, .36); g.add(lock);
    g.position.set(def.x, 0, def.z);
    Engine.scene.add(g);
    this._chestMeshes[def.id] = g;
  },

  /* Vòng tròn sáng + cọc nhỏ đánh dấu điểm câu / hái sen trên cầu đá.
     GROUND-BEGIN — vòng ở y = GROUND_LAYERS.spotRing (0.34), trên mặt cầu đá
     (đỉnh 0.305); trước đây y 0.06 nên chìm hẳn trong mặt cầu (vô hình). */
  buildSpotRing(x, z, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.55, .75, 24),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .8 })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, GROUND_LAYERS.spotRing, z);
    Engine.scene.add(ring);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, 1.1, 8),
      new THREE.MeshStandardMaterial({ color: '#4a2e1b', roughness: .8 }));
    post.position.set(x + .6, .55, z); Engine.scene.add(post);
    return ring;
  },

  buildFishingSpot() {
    this.buildSpotRing(FISH_SPOT.x, FISH_SPOT.z, 0x38bdf8);
    const bob = new THREE.Mesh(new THREE.SphereGeometry(.16, 10, 8),
      new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: .4 }));
    bob.position.set(FISH_SPOT.x + .6, 1.2, FISH_SPOT.z);
    Engine.scene.add(bob);
  },

  buildLotusSpot() {
    this.buildSpotRing(LOTUS_SPOT.x, LOTUS_SPOT.z, 0xf472b6);
    const flower = new THREE.Mesh(new THREE.ConeGeometry(.3, .4, 8),
      new THREE.MeshStandardMaterial({ color: '#f472b6', emissive: '#be185d', emissiveIntensity: .3 }));
    flower.rotation.x = Math.PI;
    /* GROUND-BEGIN — hoa sen y 0.52: đáy nón (0.52 - 0.2 = 0.32) vừa trên mặt
       cầu đá (đỉnh 0.305); trước đây y 0.25 nên nửa dưới chìm trong cầu. */
    flower.position.set(LOTUS_SPOT.x - .6, .52, LOTUS_SPOT.z);
    Engine.scene.add(flower);
  },

  buildChessBoard() {
    const g = new THREE.Group();
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.9, .18, 1.9),
      new THREE.MeshStandardMaterial({ color: '#4a2e1b', roughness: .8 }));
    table.position.y = .75; table.castShadow = true; g.add(table);
    [[-.8, -.8], [.8, -.8], [-.8, .8], [.8, .8]].forEach(p => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.14, .75, .14),
        new THREE.MeshStandardMaterial({ color: '#3b2414', roughness: .85 }));
      leg.position.set(p[0], .37, p[1]); g.add(leg);
    });
    /* Mặt bàn cờ 9×9 kẻ ô bằng canvas (không cần ảnh ngoài). */
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const x2 = c.getContext('2d');
    x2.fillStyle = '#e2c99b'; x2.fillRect(0, 0, 256, 256);
    x2.strokeStyle = '#5b2b06'; x2.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const p = 16 + i * 28;
      x2.beginPath(); x2.moveTo(p, 16); x2.lineTo(p, 240); x2.stroke();
      x2.beginPath(); x2.moveTo(16, p); x2.lineTo(240, p); x2.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7),
      new THREE.MeshStandardMaterial({ map: tex, roughness: .85 }));
    /* GROUND-BEGIN — mặt bàn cờ y = GROUND_LAYERS.chessBoard (0.87), cách mặt
       bàn (đỉnh 0.84) 0.03 thay cho 0.01 trước đây. */
    board.rotation.x = -Math.PI / 2; board.position.y = GROUND_LAYERS.chessBoard; g.add(board);
    [[-.5, -.5, 0x111827], [.4, .3, 0xf8fafc], [0, .55, 0x111827]].forEach(s => {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, .07, 16),
        new THREE.MeshStandardMaterial({ color: s[2], roughness: .35 }));
      st.position.set(s[0], .93, s[1]); g.add(st); /* GROUND-BEGIN — quân cờ y 0.93: đáy (0.895) vừa trên mặt bàn cờ 0.87. */
    });
    g.position.set(CHESS_BOARD.x, 0, CHESS_BOARD.z);
    Engine.scene.add(g);
  },

  buildButterfly(anchor, idx) {
    const g = new THREE.Group();
    const colors = [0xf472b6, 0x38bdf8, 0xfacc15, 0xa78bfa, 0x34d399];
    const wingMat = new THREE.MeshBasicMaterial({ color: colors[idx % colors.length], side: THREE.DoubleSide, transparent: true, opacity: .9 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .34, 6),
      new THREE.MeshStandardMaterial({ color: '#1e1b18', roughness: .6 }));
    body.rotation.x = Math.PI / 2; g.add(body);
    const mkWing = side => {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(.34, .26), wingMat);
      w.position.set(side * .19, .04, 0);
      w.rotation.x = -Math.PI / 2;
      g.add(w);
      return w;
    };
    const wingL = mkWing(-1), wingR = mkWing(1);
    g.position.set(anchor.x, 1.6, anchor.z);
    Engine.scene.add(g);
    this.butterflies.push({ anchor: { x: anchor.x, z: anchor.z }, mesh: g, wingL, wingR, phase: Math.random() * 6.28, caughtUntil: 0 });
  },

  /* Đồng bộ mesh đồ rơi với flags.interact.drops (kể cả đồ rơi lưu từ save cũ). */
  syncDropMeshes() {
    if (!Engine.scene || typeof THREE === 'undefined') return;
    const live = {};
    Interact.drops().forEach(d => { live[d.id] = true; });
    Object.keys(this._dropMeshes).forEach(id => {
      if (!live[id]) { Engine.scene.remove(this._dropMeshes[id]); delete this._dropMeshes[id]; }
    });
    Interact.drops().forEach(d => {
      if (this._dropMeshes[d.id]) return;
      const g = new THREE.Group();
      const color = d.loot.kind === 'silver' ? 0xc0c8d0 : d.loot.kind === 'gold' ? 0xffd76b : 0xf59e0b;
      const orb = new THREE.Mesh(new THREE.SphereGeometry(.26, 12, 10),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .55, roughness: .3 }));
      orb.position.y = .5; g.add(orb);
      const ring = new THREE.Mesh(new THREE.RingGeometry(.3, .45, 20),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .75 }));
      /* GROUND-BEGIN — vòng đồ rơi y = GROUND_LAYERS.dropRing (0.08), cách mặt
         cỏ (0.04) 0.04 thay cho 0.01 trước đây. */
      ring.rotation.x = -Math.PI / 2; ring.position.y = GROUND_LAYERS.dropRing; g.add(ring);
      g.position.set(d.x, 0, d.z);
      Engine.scene.add(g);
      this._dropMeshes[d.id] = g;
    });
  },

  /* Vật tương tác gần nhất với điểm chạm (x,z) trong bán kính r. */
  nearest(x, z, r) {
    let best = null, min = r;
    const consider = (kind, id, ix, iz, label) => {
      const d = Math.hypot(ix - x, iz - z);
      if (d < min) { min = d; best = { kind, id, x: ix, z: iz, label }; }
    };
    CHEST_DEFS.forEach(c => {
      const st = Interact.chestStatus(c.id);
      consider('chest', c.id, c.x, c.z, st.openedToday ? '📦 ' + c.name + ' (đã mở)' : '📦 Mở ' + c.name);
    });
    Interact.drops().forEach(d => consider('drop', d.id, d.x, d.z, '✨ Nhặt đồ rơi'));
    this.butterflies.forEach((b, i) => {
      if (!b.mesh || !b.mesh.visible || (b.caughtUntil && performance.now() < b.caughtUntil)) return;
      consider('butterfly', i, b.mesh.position.x, b.mesh.position.z, '🦋 Bắt bướm');
    });
    consider('fishing', 'fish', FISH_SPOT.x, FISH_SPOT.z, '🎣 Câu cá');
    consider('lotus', 'lotus', LOTUS_SPOT.x, LOTUS_SPOT.z, '🌸 Hái sen');
    consider('chess', 'chess', CHESS_BOARD.x, CHESS_BOARD.z, '♟️ Đấu cờ');
    return best;
  },

  /* Thực hiện hành động sau khi nhân vật đã đi tới gần. */
  act(t) {
    if (!t) return;
    if (t.kind === 'chest') {
      const res = Interact.chestOpen(t.id);
      if (!res.ok && res.reason === 'cooldown') {
        UI.toast('📦 Rương đã mở rồi — mở lại vào ngày game mai (ngày ' + (State.worldClock.day + 1) + ')!', 'gold');
        return;
      }
      if (res.ok) {
        Sfx.coin();
        UI.toast('📦 Mở rương: ' + res.text + (res.rare ? ' 🌟 HIẾM!' : ''), res.rare ? 'green' : 'gold');
        if (typeof Emote !== 'undefined') Emote.player('😊');
      }
      return;
    }
    if (t.kind === 'drop') {
      const res = Interact.pickupDrop(t.id);
      if (res.ok) {
        Sfx.coin();
        UI.toast('✨ Nhặt được ' + res.text + '!', 'green');
        if (typeof Emote !== 'undefined') Emote.player('😊');
        this.syncDropMeshes();
      }
      return;
    }
    if (t.kind === 'butterfly') {
      const b = this.butterflies[t.id];
      const p = PlayerController.entity ? PlayerController.entity.mesh.position : null;
      if (!b || !b.mesh || !p || Math.hypot(b.mesh.position.x - p.x, b.mesh.position.z - p.z) > 3.5) {
        UI.toast('🦋 Bướm đã bay đi mất rồi!', 'gold');
        return;
      }
      addItem('Cánh Bướm', '🦋', 'Nguyên liệu', 'Cánh bướm lấp lánh, bán được 300 bạc', 1);
      State.flags.interact.butterflies += 1;
      SaveManager.save();
      UI.syncWorld();
      b.mesh.visible = false;
      b.caughtUntil = performance.now() + 45000;
      const a = BUTTERFLY_ANCHORS[Math.floor(Math.random() * BUTTERFLY_ANCHORS.length)];
      b.anchor = { x: a.x + rnd(-2, 2), z: a.z + rnd(-2, 2) };
      Sfx.coin();
      UI.toast('🦋 Bắt được bướm! +1 Cánh Bướm vào túi.', 'green');
      if (typeof Emote !== 'undefined') Emote.player('😊');
      return;
    }
    if (t.kind === 'fishing') {
      if (!Interact.fishCast()) {
        UI.toast('🪱 Hết Mồi Câu rồi! Mua ở chợ (50 bạc) hoặc chờ tặng 5 mồi mỗi ngày game.', 'red');
        if (typeof Emote !== 'undefined') Emote.player('😢');
        return;
      }
      UI.openModal('fishing');
      return;
    }
    if (t.kind === 'lotus') { UI.openModal('lotus'); return; }
    if (t.kind === 'chess') { UI.openModal('chess'); return; }
  },

  /* Nút hành động trên HUD: bấm là tương tác với vật gần nhất (không cần đi). */
  doInteractNear() {
    const p = PlayerController.entity ? PlayerController.entity.mesh.position : null;
    if (!p) return;
    const t = this.nearest(p.x, p.z, 2.2);
    if (t) this.act(t);
  },

  updateInteractButton() {
    const btn = document.getElementById ? document.getElementById('interact-btn') : null;
    if (!btn) return;
    const p = PlayerController.entity ? PlayerController.entity.mesh.position : null;
    let t = null;
    if (p && Game.mode === 'world') t = this.nearest(p.x, p.z, 2.0);
    if (t) {
      btn.textContent = t.label;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  },

  update(dt, time) {
    if (!this._built) return;
    /* Đồ rơi sinh theo giờ game: qua 1 giờ game thì 60% sinh thêm 1 vật (tối đa 5). */
    const h = Math.floor(State.worldClock.hour);
    if (this._lastHour !== null && h !== this._lastHour) {
      this._lastHour = h;
      if (Math.random() < 0.6 && Interact.spawnDrop()) this.syncDropMeshes();
    } else if (this._lastHour === null) {
      this._lastHour = h;
    }
    /* Tặng 5 Mồi Câu mỗi ngày game (kiểm tra rẻ: chỉ làm khi sang ngày mới). */
    Interact.maybeGrantDailyBait();
    /* Bướm bay theo đường sin quanh điểm neo, cánh vẫy; bị bắt thì ẩn 45s
       rồi xuất hiện lại ở chỗ khác. Đồ rơi nhấp nhô + xoay. */
    const now = performance.now();
    this.butterflies.forEach(b => {
      if (!b.mesh) return;
      if (b.caughtUntil && now < b.caughtUntil) return;
      if (b.caughtUntil && now >= b.caughtUntil) { b.caughtUntil = 0; b.mesh.visible = true; }
      const t = time * 1.1 + b.phase;
      const nx = b.anchor.x + Math.sin(t) * 1.2;
      const nz = b.anchor.z + Math.cos(t * .8) * 1.0;
      const px = b.mesh.position.x, pz = b.mesh.position.z;
      b.mesh.position.set(nx, 1.6 + Math.sin(time * 2 + b.phase) * .35, nz);
      b.mesh.rotation.y = Math.atan2(nx - px, nz - pz);
      const flap = Math.sin(time * 14 + b.phase) * .85;
      b.wingL.rotation.z = flap;
      b.wingR.rotation.z = -flap;
    });
    let i = 0;
    Object.keys(this._dropMeshes).forEach(id => {
      const g = this._dropMeshes[id];
      g.position.y = Math.sin(time * 2 + i * 1.7) * .08;
      g.rotation.y += dt * 1.2;
      i++;
    });
    this._hudAcc += dt;
    if (this._hudAcc > .3) {
      this._hudAcc = 0;
      this.updateInteractButton();
    }
  }
};

/* ============================== CỔNG DỊCH CHUYỂN → KHU VỰC ==============================
   DISTRICT-BEGIN — Mỗi cổng dịch chuyển (định nghĩa ở Env.GATES, src/02b-env.js
   — file này không sửa) dẫn tới 1 khu vực trong map/: Cổng Son → Phố Đông,
   Giếng Cổ → Bến Sông, Làng Đào Viên → Ruộng Lúa. Vòng teleport 3 cổng
   KHÔNG đổi: "Dịch chuyển vòng" vẫn gọi Env.teleportToGate như cũ.
   Biển chỉ khu vực được vẽ thêm (buildSigns) sau khi Env.buildExpansion()
   dựng cổng; chạm cổng / bấm nút 🚪 Dịch chuyển thì mở modal lựa chọn thay
   vì dịch chuyển ngay. */
const DistrictGates = {
  /* gate id -> file khu vực trong map/ (tên khu lấy từ DISTRICTS khi có). */
  GATE_DISTRICTS: {
    'cong-son': { file: 'pho-dong.html', name: 'Phố Đông' },
    'gieng-co': { file: 'ben-song.html', name: 'Bến Sông' },
    'cong-lang': { file: 'ruong-lua.html', name: 'Ruộng Lúa' }
  },
  _gate: null,
  _signsBuilt: false,

  destFor(gate) {
    if (!gate) return null;
    const m = this.GATE_DISTRICTS[gate.id];
    if (!m) return null;
    let name = m.name, file = m.file;
    if (typeof DISTRICTS !== 'undefined') {
      const def = DISTRICTS.find(d => d.file === m.file);
      if (def) { name = def.name; file = def.file; }
    }
    return { name, file };
  },

  districtDef(file) {
    if (typeof DISTRICTS === 'undefined') return null;
    return DISTRICTS.find(d => d.file === file) || null;
  },

  /* Kiểm tra khóa: trả {ok:true} | {ok:false, reason}. Khi chưa có dữ liệu
     khu vực (DISTRICTS/canEnterDistrict) thì coi như mở được — trang đích
     tự kiểm tra lại khi tải. */
  checkDistrict(file) {
    const def = this.districtDef(file);
    if (!def) return { ok: true };
    if (typeof canEnterDistrict === 'function') return canEnterDistrict(def, State) || { ok: true };
    return { ok: true };
  },

  openGateChoice(gate) {
    if (!gate || typeof UI === 'undefined') return;
    this._gate = gate;
    const dest = this.destFor(gate);
    let nextName = '';
    if (typeof Env !== 'undefined' && Env.GATES) {
      const idx = Env.GATES.indexOf(gate);
      if (idx >= 0) nextName = Env.GATES[(idx + 1) % Env.GATES.length].name;
    }
    const chk = dest ? this.checkDistrict(dest.file) : { ok: true };
    UI.openModal('gate-choice', {
      gateName: gate.name,
      nextName,
      distName: dest ? dest.name : '',
      distFile: dest ? dest.file : '',
      locked: !chk.ok,
      lockReason: chk.ok ? '' : (chk.reason || 'Khu vực đang khóa.')
    });
  },

  openChoiceFromNearest() {
    if (typeof Env === 'undefined' || Game.mode !== 'world' || !PlayerController.entity) return;
    const p = PlayerController.entity.mesh.position;
    const gate = Env.gateNear(p.x, p.z, 2.2);
    if (gate) this.openGateChoice(gate);
  },

  /* "Dịch chuyển vòng": đúng hành vi cũ — sang cổng kế tiếp trong vòng. */
  cycleFromChoice() {
    const gate = this._gate;
    this._gate = null;
    if (typeof UI !== 'undefined') UI.closeModal();
    if (gate && typeof Env !== 'undefined') Env.teleportToGate(gate);
  },

  /* "Vào <tên khu>": khóa thì chỉ hiện lý do, không chuyển trang. */
  enterDistrict(file) {
    if (!file) return;
    const chk = this.checkDistrict(file);
    if (!chk.ok) {
      UI.toast('🔒 ' + (chk.reason || 'Khu vực đang khóa!'), 'red');
      return;
    }
    SaveManager.save();
    location.href = 'map/' + file;
  },

  /* Biển chỉ khu vực gắn dưới biển tên cổng: "→ Phố Đông" ... */
  buildSigns() {
    if (this._signsBuilt || !Engine.scene || typeof THREE === 'undefined' || typeof Env === 'undefined' || !Env.GATES) return;
    this._signsBuilt = true;
    Env.GATES.forEach(def => {
      const dest = this.destFor(def);
      if (!dest) return;
      const c = document.createElement('canvas'); c.width = 512; c.height = 96;
      const x = c.getContext('2d');
      x.fillStyle = '#241708'; x.fillRect(0, 0, 512, 96);
      x.strokeStyle = '#d8a53c'; x.lineWidth = 5; x.strokeRect(6, 6, 500, 84);
      x.fillStyle = '#ffd76b'; x.textAlign = 'center'; x.textBaseline = 'middle';
      /* Tên khu đầy đủ dài (VD "Phố Đông Thương Mại"): co cỡ chữ cho vừa biển. */
      let fs = 44;
      const label = '→ ' + dest.name;
      x.font = 'bold ' + fs + 'px "Palatino Linotype", Georgia, serif';
      while (fs > 26 && x.measureText(label).width > 480) {
        fs -= 2;
        x.font = 'bold ' + fs + 'px "Palatino Linotype", Georgia, serif';
      }
      x.fillText(label, 256, 50);
      const tex = new THREE.CanvasTexture(c);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.2, .42), new THREE.MeshBasicMaterial({ map: tex }));
      plate.position.set(def.x, def.kind === 'well' ? 1.45 : 2.35, def.z + .4);
      Engine.scene.add(plate);
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
  },

  /* ENV-BEGIN — đổi màu cánh hoa đào theo mùa (xuân hồng, hạ xanh nhạt/trắng,
     thu cam, đông trắng). Nhận 2 mã màu số (0xRRGGBB), vẽ lại từng cánh. */
  setPetalColors(c1, c2) {
    if (!this.app || !this.petals.length) return;
    this.petals.forEach((p, i) => {
      p.clear();
      p.ellipse(0, 0, 5, 3);
      p.fill({ color: i % 2 === 0 ? c1 : c2, alpha: .72 });
    });
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
    if (npc.role === 'merchant') progressQuest('q1', 1);
    /* NPC-BEGIN — NPC có cây thoại thì mở cây thoại, chưa có thì giữ thoại
       chuỗi cũ + nút role như trước. */
    const tree = (typeof DIALOGUE_TREES !== 'undefined') ? DIALOGUE_TREES[npc.id] : null;
    if (tree && tree.start) {
      this._dlg = { npcId: npc.id, node: 'start' };
      this.renderDialogue(npc, 'start');
      return;
    }
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
            ${npc.role === 'chess' ? `<button class="btn" data-act="open-chess">♟️ Đấu một ván cờ</button>` : ''}
            <button class="btn dark" data-act="close-dialogue">Đa tạ tiền bối</button>
          </div>
        </div>
      </div>`;
    box.classList.add('on');
  },

  /* NPC-BEGIN — render 1 node cây thoại: text + các lựa chọn bấm được.
     Lựa chọn thiếu điều kiện hiện mờ + ghi rõ yêu cầu, không cho bấm. */
  renderDialogue(npc, nodeId) {
    const tree = DIALOGUE_TREES[npc.id];
    const node = (tree && tree[nodeId]) || (tree && tree.start);
    if (!node) return;
    this._dlg = { npcId: npc.id, node: nodeId };
    const box = $('#dialogue');
    const opts = (node.options || []).map((o, i) => {
      const ok = !o.cond || dialogueCondMet(o.cond);
      const req = o.cond ? dialogueCondText(o.cond) : '';
      return `<button class="btn" data-act="dlg-option" data-npc="${esc(npc.id)}" data-node="${esc(nodeId)}" data-i="${i}"${ok ? '' : ' disabled style="opacity:.55"'}>${esc(o.label)}${ok ? '' : ' — ' + esc(req)}</button>`;
    }).join('');
    box.innerHTML = `
      <div class="dbox gp">
        <div class="portrait">${npc.portrait || '🧙'}</div>
        <div class="dcontent">
          <h3>${esc(npc.name)} <button data-act="close-dialogue">[Đóng]</button></h3>
          <p>${esc(node.text)}</p>
          <div class="dacts">
            ${opts}
            <button class="btn dark" data-act="close-dialogue">Đa tạ tiền bối</button>
          </div>
        </div>
      </div>`;
    box.classList.add('on');
  },

  /* NPC-BEGIN — xử lý 1 lựa chọn thoại: chặn khi thiếu điều kiện, đặt flag,
     tiến nhiệm vụ, chạy action (shop/battle/info/recruit/event như nút role
     cũ; forge/heal/train/lore là dịch vụ mới), rồi rẽ nhánh hoặc đóng. */
  chooseDialogueOption(npcId, nodeId, idx) {
    const npc = CharacterManager.entities.find(e => e.id === npcId);
    if (!npc) return;
    const tree = DIALOGUE_TREES[npcId];
    const node = tree && tree[nodeId];
    const opt = node && node.options && node.options[idx];
    if (!opt) return;
    if (opt.cond && !dialogueCondMet(opt.cond)) {
      UI.toast('Chưa đủ điều kiện: ' + dialogueCondText(opt.cond), 'red');
      /* INTERACT-BEGIN — bị từ chối/thiếu điều kiện: NPC hiện emote buồn. */
      if (typeof Emote !== 'undefined') Emote.npc(npcId, '😢');
      return;
    }
    Sfx.click();
    if (opt.setFlag) {
      State.flags.npc[opt.setFlag] = true;
      SaveManager.save();
    }
    if (opt.quest) progressQuest(opt.quest, 1);
    if (opt.action) {
      const res = this._runDialogueAction(opt.action, npc);
      if (res === 'stay') { this.renderDialogue(npc, nodeId); return; }
      if (opt.next) { this.renderDialogue(npc, opt.next); return; }
      return;
    }
    if (opt.next) { this.renderDialogue(npc, opt.next); return; }
    const box = $('#dialogue');
    if (box) box.classList.remove('on');
  },

  /* NPC-BEGIN — action của lựa chọn thoại. Trả 'stay' khi xong vẫn ở lại
     node hiện tại (forge/heal/train có thể làm lại), true khi đã chuyển
     màn hình/modal (shop/event rời trang, battle/info/recruit/lore mở modal). */
  _runDialogueAction(action, npc) {
    switch (action) {
      case 'shop': SaveManager.save(); location.href = 'Shop.html'; return true;
      case 'battle': UI.openModal('arena'); return true;
      case 'info': Info.open(State.leader); return true;
      case 'recruit': UI.openModal('recruit'); return true;
      case 'event': SaveManager.save(); location.href = 'Event.html'; return true;
      case 'lore':
        UI.openModal('lore');
        State.flags.npc.loreRead = (State.flags.npc.loreRead || 0) + 1;
        SaveManager.save();
        return true;
      case 'forge': NpcService.forge(); return 'stay';
      case 'heal': NpcService.heal(); return 'stay';
      case 'train': gainExp(30); UI.toast('Lĩnh ngộ thành công! +30 EXP', 'green'); return 'stay';
      /* FBX-BEGIN — mở modal Thợ Dựng Cảnh (đặt / xem mô hình .fbx). */
      case 'fbx-builder': if (typeof FbxUI !== 'undefined') FbxUI.openBuilder(); return true;
      default: return true;
    }
  },

  update(dt, time) {
    PlayerController.update(dt);
    CharacterManager.update(dt, time);
    /* FBX-BEGIN — AnimationMixer của model FBX hero (nếu có) + bảng tên của
       prop NPC .fbx; chạy ngay sau CharacterManager.update như chibi. */
    if (typeof HeroFBX !== 'undefined') HeroFBX.update(dt);
    if (typeof FbxProps !== 'undefined') FbxProps.update();
    /* NPC-BEGIN — lịch trình NPC, dân thường đi lại, thú cưng lang thang. */
    if (typeof NpcAI !== 'undefined') NpcAI.update(dt);
    /* INTERACT-BEGIN — bướm bay, đồ rơi sinh theo giờ game, nút tương tác gần. */
    if (typeof InteractWorld !== 'undefined') InteractWorld.update(dt, time);
    /* FOLLOW-BEGIN — thú cưng + đệ tử đội trưởng đi theo (sau PlayerController.update). */
    if (typeof Followers !== 'undefined') Followers.update(dt, time);
    if (Engine.waterMesh && Engine.waterMesh.material.map) {
      Engine.waterMesh.material.map.offset.x = time * .025;
      Engine.waterMesh.material.map.offset.y = time * .018;
    }
    Engine.lanterns.forEach((l, i) => { l.rotation.z = Math.sin(time * 2.2 + i) * .08; });
    /* ENV-BEGIN — đồng hồ, thời tiết, nước, gió, cổng dịch chuyển. */
    if (typeof Env !== 'undefined') Env.update(dt, time);
  }
};
