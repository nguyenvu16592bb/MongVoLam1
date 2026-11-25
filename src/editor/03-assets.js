/* ============================================================================
   Map Editor — 03-assets.js (nhóm B)
   ED.Assets — thư viện asset dựng bằng primitive three.js (khớp phong cách
   game: mái ngói đỏ Cone 4 mặt, tường #d8d1c2, gỗ #3b2414, vàng #d8a53c,
   đá #8b9793, đèn lồng đỏ #ef4444 — xem src/02-world.js), kéo-thả vào
   viewport, nút "Thêm" cho điện thoại, import .fbx/.glb/.obj.
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo trong init()/hàm gọi lúc chạy. Logic thuần (catalog,
   validate) test được bằng vm + stub THREE.
   Import model theo đúng cách src/11-fbx.js: validate đuôi + <=20MB,
   parse rồi chuẩn hoá cao 1.8, căn giữa x/z, đáy y = 0; bytes lưu vào
   IndexedDB 'mongvolam_editor_v1' store 'assets' (keyPath 'key').
   ĐỢT 7: thư viện vũ khí/phụ kiện (BUILDERS 'weapon-sword', 'weapon-blade',
   'weapon-staff', 'weapon-bow', 'weapon-shield', 'weapon-hat',
   'weapon-cape' — gốc group = điểm gắn lên xương, kích thước theo
   nhân vật cao ~1.8) + importWeapon(file) import .fbx/.glb làm vũ khí
   (validate đuôi + <=20MB, scale cạnh dài nhất -> 1.0, tâm về gốc).
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Assets = (function () {
  'use strict';

  var DB_NAME = 'mongvolam_editor_v1';
  var STORE = 'assets';
  var MAX_BYTES = 20 * 1024 * 1024;
  var TARGET_HEIGHT = 1.8;

  /* ---- Catalog: type -> {name, category, desc}. Category theo schema v1. --- */
  var CATALOG = [
    { type: 'house', name: 'Nhà cổ mái ngói', category: 'Buildings', desc: 'Nhà 1 tầng, mái ngói đỏ' },
    { type: 'temple', name: 'Chùa 2 tầng', category: 'Buildings', desc: 'Chùa nhiều tầng mái' },
    { type: 'bridge', name: 'Cầu đá', category: 'Buildings', desc: 'Cầu vòm cong qua hồ' },
    { type: 'gate', name: 'Cổng môn phái', category: 'Buildings', desc: 'Cổng gỗ + mái ngói, biển vàng' },
    { type: 'tower', name: 'Tháp', category: 'Buildings', desc: 'Tháp 3 tầng mái chồng' },
    { type: 'stall', name: 'Sạp hàng', category: 'Buildings', desc: 'Sạp chợ có mái che + giỏ hàng' },
    /* ---- Bộ phận nhà lắp ghép (đợt 2, 14-building.js): mỗi part là 1
       asset riêng, đặt bằng kéo-thả / nút Thêm như asset thường. ---- */
    { type: 'roof-curved', name: 'Mái ngói cong', category: 'Buildings', desc: 'Mái 2 mặt cong + diềm vểnh, đặt lên đỉnh tường' },
    { type: 'roof-flat', name: 'Mái bằng', category: 'Buildings', desc: 'Mái phẳng + gờ chắn, 3.6 × 2.6' },
    { type: 'roof-tower', name: 'Mái tháp', category: 'Buildings', desc: 'Mái tháp 3 tầng thu nhỏ' },
    { type: 'wall', name: 'Tường nhà', category: 'Buildings', desc: 'Tường mỏng 3 × 2.4 × 0.3, ghép thành nhà' },
    { type: 'window', name: 'Cửa sổ', category: 'Buildings', desc: 'Khung gỗ + ô sáng 1 × 1.2' },
    { type: 'door', name: 'Cửa chính', category: 'Buildings', desc: 'Khung + cánh cửa 1.2 × 2.2' },
    { type: 'stairs', name: 'Cầu thang', category: 'Buildings', desc: '6 bậc đá, cao 0.9' },
    { type: 'balcony', name: 'Ban công', category: 'Buildings', desc: 'Sàn gỗ 2.4 × 1.2 + lan can' },
    { type: 'pillar', name: 'Cột tròn', category: 'Buildings', desc: 'Cột gỗ tròn, cao 2.4' },
    { type: 'pillar-square', name: 'Cột vuông', category: 'Buildings', desc: 'Cột đá vuông 0.3 × 2.4' },
    { type: 'peach-tree', name: 'Cây đào', category: 'Environment', desc: 'Thân nâu, tán hồng' },
    { type: 'tree', name: 'Cây xanh', category: 'Environment', desc: 'Tán dodecahedron xanh' },
    { type: 'bamboo', name: 'Cây trúc', category: 'Environment', desc: 'Thân xanh nhiều đốt + lá' },
    { type: 'rock', name: 'Đá', category: 'Environment', desc: 'Khối đá xám' },
    { type: 'water', name: 'Hồ nước', category: 'Environment', desc: 'Mặt phẳng nước xanh trong' },
    /* Đợt 6 — thác nước: mặt nước đứng + bọt trắng ở chân (FX 'foam'
       gắn sẵn thành con của group, xem BUILDERS['waterfall']). */
    { type: 'waterfall', name: 'Thác nước', category: 'Environment', desc: 'Mặt nước đứng + bọt trắng ở chân thác' },
    { type: 'grass', name: 'Bụi cỏ', category: 'Environment', desc: 'Cụm cỏ 5 lá' },
    { type: 'flower', name: 'Hoa sen', category: 'Environment', desc: 'Lá sen + hoa hồng' },
    { type: 'lantern', name: 'Lồng đèn', category: 'Props', desc: 'Cột gỗ + đèn lồng đỏ' },
    { type: 'table', name: 'Bàn gỗ', category: 'Props', desc: 'Bàn + khăn đỏ' },
    { type: 'chair', name: 'Ghế gỗ', category: 'Props', desc: 'Ghế đẩu gỗ' },
    { type: 'chibi', name: 'Chibi (tạm)', category: 'Characters', desc: 'Người chibi placeholder — model thật do nhóm C import FBX' },
    { type: 'fx-marker', name: 'Điểm đặt FX', category: 'Effects', desc: 'Icon cầu nhỏ, đặt FX tại đây' }
  ];

  var CATEGORIES = ['Environment', 'Buildings', 'Props', 'Characters', 'Effects'];

  function catalog() { return CATALOG.slice(); }
  function categories() { return CATEGORIES.slice(); }
  function defOf(type) {
    for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].type === type) return CATALOG[i];
    return null;
  }
  /* Lọc catalog theo tên (không phân biệt hoa/thường, khớp cả không dấu
     đơn giản: so cả chuỗi gốc và chuỗi đã bỏ dấu). Thuần, test được. */
  function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }
  function filterCatalog(q) {
    q = stripAccents(String(q || '').trim().toLowerCase());
    if (!q) return catalog();
    return CATALOG.filter(function (d) {
      return stripAccents(d.name.toLowerCase()).indexOf(q) >= 0 ||
        stripAccents(d.type.toLowerCase()).indexOf(q) >= 0 ||
        stripAccents(d.desc.toLowerCase()).indexOf(q) >= 0;
    });
  }

  /* ---- Helpers dựng mesh (chỉ gọi lúc chạy, khi THREE đã có). ---- */
  function mat(color, o) {
    o = o || {};
    var m = new THREE.MeshStandardMaterial({
      color: color, roughness: (o.roughness == null ? 0.8 : o.roughness),
      metalness: (o.metalness == null ? 0 : o.metalness),
      emissive: o.emissive || 0x000000,
      emissiveIntensity: (o.emissiveIntensity == null ? 0 : o.emissiveIntensity),
      transparent: !!o.transparent, opacity: (o.opacity == null ? 1 : o.opacity)
    });
    m.userData.baseColor = String(color);
    return m;
  }
  function box(w, h, d, m, x, y, z) {
    var ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    ms.position.set(x || 0, y || 0, z || 0); ms.castShadow = true; ms.receiveShadow = true;
    return ms;
  }
  function cyl(rt, rb, h, m, x, y, z, seg) {
    var ms = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 10), m);
    ms.position.set(x || 0, y || 0, z || 0); ms.castShadow = true; ms.receiveShadow = true;
    return ms;
  }
  function cone(r, h, m, x, y, z, seg) {
    var ms = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 4), m);
    ms.position.set(x || 0, y || 0, z || 0); ms.castShadow = true; ms.receiveShadow = true;
    return ms;
  }
  function sph(r, m, x, y, z, ws, hs) {
    var ms = new THREE.Mesh(new THREE.SphereGeometry(r, ws || 12, hs || 10), m);
    ms.position.set(x || 0, y || 0, z || 0); ms.castShadow = true; ms.receiveShadow = true;
    return ms;
  }
  /* Mái ngói 4 mặt kiểu game: Cone 4 cạnh xoay 45°, dẹt theo z. */
  function roof(w, d, h, m, x, y, z) {
    var r = cone(Math.max(w, d) * 0.72, h, m, x, y, z, 4);
    r.rotation.y = Math.PI / 4;
    r.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    return r;
  }
  function pillar(m, x, z, h, y) {
    return cyl(0.11, 0.13, h || 2.4, m, x, (y || 0) + (h || 2.4) / 2, z, 8);
  }

  var PALETTE = {
    wall: '#d8d1c2', roofRed: '#7f1d1d', roofTile: '#7a5238', wood: '#3b2414',
    redWood: '#8b2f2f', gold: '#d8a53c', stone: '#8b9793', stoneLight: '#a1aca7',
    lantern: '#ef4444', trunk: '#4a2f1d', leaf: '#4c8c3b', peach: '#f472b6',
    bamboo: '#3f7d33', water: '#4da39e', grass: '#5da244', skin: '#f2c89b'
  };

  var BUILDERS = {
    'house': function (o) {
      var g = new THREE.Group();
      var wall = mat(o.color || PALETTE.wall), roofM = mat(PALETTE.roofRed, { roughness: 0.7 });
      var wood = mat(PALETTE.wood), gold = mat(PALETTE.gold, { metalness: 0.55, roughness: 0.35 });
      g.add(box(3.4, 0.3, 2.6, mat(PALETTE.stone), 0, 0.15, 0));           // bệ đá
      g.add(box(3.0, 2.2, 2.2, wall, 0, 1.4, 0));                          // thân nhà
      g.add(roof(3.9, 3.0, 1.0, roofM, 0, 2.95, 0));                       // mái ngói
      g.add(box(4.0, 0.12, 3.1, gold, 0, 2.5, 0));                         // diềm vàng
      g.add(box(0.9, 1.6, 0.12, wood, 0, 1.1, 1.12));                      // cửa
      g.add(box(0.7, 0.7, 0.1, mat('#ffe9a8', { emissive: '#ffdf9a', emissiveIntensity: 0.4 }), -0.95, 1.6, 1.12)); // cửa sổ
      g.add(box(0.7, 0.7, 0.1, mat('#ffe9a8', { emissive: '#ffdf9a', emissiveIntensity: 0.4 }), 0.95, 1.6, 1.12));
      [-1.35, 1.35].forEach(function (x) { g.add(pillar(wood, x, 1.05, 2.2, 0.3)); });
      return g;
    },
    'temple': function (o) {
      var g = new THREE.Group();
      var wall = mat(o.color || PALETTE.wall), roofM = mat(PALETTE.roofRed, { roughness: 0.7 });
      var wood = mat(PALETTE.redWood), gold = mat(PALETTE.gold, { metalness: 0.55, roughness: 0.35 });
      g.add(box(5.0, 0.4, 4.0, mat(PALETTE.stone), 0, 0.2, 0));
      g.add(box(4.2, 2.4, 3.2, wall, 0, 1.6, 0));
      g.add(roof(5.4, 4.4, 1.2, roofM, 0, 3.35, 0));
      g.add(box(5.5, 0.14, 4.5, gold, 0, 2.85, 0));
      [-1.9, -0.65, 0.65, 1.9].forEach(function (x) { g.add(pillar(wood, x, 1.55, 2.4, 0.4)); });
      g.add(box(3.0, 1.8, 2.4, mat(PALETTE.redWood), 0, 4.85, 0));         // tầng 2
      g.add(roof(4.0, 3.2, 1.0, roofM, 0, 6.2, 0));
      g.add(box(4.1, 0.12, 3.3, gold, 0, 5.8, 0));
      g.add(box(1.0, 1.8, 0.12, wood, 0, 1.3, 1.62));                      // cửa chính
      g.add(box(0.5, 0.5, 0.14, mat('#ffdf9a', { emissive: '#ffdf9a', emissiveIntensity: 0.6 }), 0, 5.0, 1.22));
      return g;
    },
    'bridge': function (o) {
      var g = new THREE.Group();
      var stone = mat(o.color || PALETTE.stone, { roughness: 0.82 });
      var rail = mat(PALETTE.stoneLight, { roughness: 0.78 });
      var n = 7; // vòm cong: 7 hộp xếp bậc thang theo cos
      for (var i = 0; i < n; i++) {
        var t = i / (n - 1) - 0.5;                       // -0.5..0.5
        var y = 0.3 + Math.cos(t * Math.PI) * 0.55;      // giữa cao, 2 đầu thấp
        var seg = box(1.1, 0.32, 2.2, stone, t * 5.4, y, 0);
        seg.rotation.z = -t * 0.55;
        g.add(seg);
      }
      [-1.25, 1.25].forEach(function (z) {
        var r = box(6.6, 0.18, 0.18, rail, 0, 1.25, z);
        r.rotation.z = 0; g.add(r);
        for (var k = -3; k <= 3; k++) {
          var t2 = k / 3 * 0.5;
          var y2 = 0.3 + Math.cos(t2 * Math.PI) * 0.55 + 0.55;
          g.add(box(0.16, 0.8, 0.16, rail, k * 0.95, y2, z));
        }
      });
      g.add(box(0.8, 0.3, 2.2, stone, -3.0, 0.15, 0));   // 2 đầu cầu
      g.add(box(0.8, 0.3, 2.2, stone, 3.0, 0.15, 0));
      return g;
    },
    'gate': function (o) {
      var g = new THREE.Group();
      var wood = mat(PALETTE.wood), roofM = mat(PALETTE.roofRed, { roughness: 0.7 });
      var gold = mat(PALETTE.gold, { metalness: 0.55, roughness: 0.35 });
      [-1.5, 1.5].forEach(function (x) { g.add(pillar(wood, x, 0, 3.4, 0)); });
      g.add(box(3.6, 0.5, 0.3, wood, 0, 3.3, 0));                            // xà ngang
      g.add(roof(4.4, 1.6, 0.8, roofM, 0, 3.95, 0));
      g.add(box(2.2, 0.8, 0.1, mat('#2a1a0c'), 0, 2.7, 0));                  // biển
      g.add(box(2.3, 0.1, 0.12, gold, 0, 3.12, 0));
      g.add(box(2.3, 0.1, 0.12, gold, 0, 2.28, 0));
      return g;
    },
    'tower': function (o) {
      var g = new THREE.Group();
      var wall = mat(o.color || PALETTE.wall), roofM = mat(PALETTE.roofTile, { roughness: 0.7 });
      var w = 3.2, y = 0;
      g.add(box(3.8, 0.4, 3.8, mat(PALETTE.stone), 0, 0.2, 0));
      for (var f = 0; f < 3; f++) {
        g.add(box(w, 1.7, w, wall, 0, y + 0.4 + 0.85, 0));
        g.add(roof(w + 1.2, w + 1.2, 0.8, roofM, 0, y + 0.4 + 1.7 + 0.4, 0));
        y += 2.5; w *= 0.78;
      }
      g.add(sph(0.28, mat(PALETTE.gold, { metalness: 0.6, roughness: 0.3 }), 0, y + 0.6, 0));
      return g;
    },
    'stall': function (o) {
      var g = new THREE.Group();
      var wood = mat(PALETTE.wood);
      [[-1.5, -1.0], [1.5, -1.0], [-1.5, 1.0], [1.5, 1.0]].forEach(function (p) {
        g.add(pillar(wood, p[0], p[1], 2.4, 0));
      });
      var canopy = cone(2.6, 1.0, mat('#3b6b8f', { roughness: 0.88 }), 0, 2.9, 0, 4);
      canopy.rotation.y = Math.PI / 4; canopy.scale.set(1.3, 1, 1.05); g.add(canopy);
      g.add(box(3.0, 0.7, 1.0, wood, 0, 0.55, 0.6));                          // quầy
      ['#eab308', '#f97316', '#84cc16', '#ef4444'].forEach(function (col, i) {
        g.add(cyl(0.28, 0.22, 0.2, mat(col), -1.1 + i * 0.75, 1.0, 0.6, 10));
      });
      var jar = sph(0.3, mat('#6b4226', { roughness: 0.5 }), -1.9, 0.35, -0.8);
      jar.scale.set(1, 1.25, 1); g.add(jar);
      return g;
    },
    /* ---- Bộ phận nhà lắp ghép (đợt 2): primitive khớp phong cách game.
       Gốc nhóm (y = 0) là mặt đất / chân part; tường cao 2.4 làm chuẩn
       để ED.Building snap mái theo đỉnh tường. ---- */
    'roof-curved': function (o) {
      var g = new THREE.Group();
      var roofM = mat(o.color || PALETTE.roofRed, { roughness: 0.7 });
      var wood = mat(PALETTE.wood);
      var gold = mat(PALETTE.gold, { metalness: 0.55, roughness: 0.35 });
      g.add(roof(3.6, 2.6, 1.0, roofM, 0, 0.5, 0));                       // mái chính
      g.add(box(3.7, 0.12, 0.18, gold, 0, 1.02, 0));                      // sống mái
      var e1 = box(3.9, 0.1, 0.28, wood, 0, 0.14, 1.32);                  // diềm trước vểnh
      e1.rotation.x = 0.18; g.add(e1);
      var e2 = box(3.9, 0.1, 0.28, wood, 0, 0.14, -1.32);                 // diềm sau vểnh
      e2.rotation.x = -0.18; g.add(e2);
      [[-1.85, 1.32], [1.85, 1.32], [-1.85, -1.32], [1.85, -1.32]].forEach(function (p) {
        var horn = cone(0.13, 0.5, roofM, p[0], 0.3, p[1], 4);
        horn.rotation.x = p[1] > 0 ? 0.45 : -0.45; g.add(horn);            // đầu hồi vểnh
      });
      return g;
    },
    'roof-flat': function (o) {
      var g = new THREE.Group();
      var slab = mat(o.color || PALETTE.roofRed, { roughness: 0.75 });
      var stone = mat(PALETTE.stoneLight, { roughness: 0.8 });
      g.add(box(3.6, 0.18, 2.6, slab, 0, 0.09, 0));                       // tấm mái
      g.add(box(3.6, 0.22, 0.12, stone, 0, 0.29, 1.24));                  // gờ chắn
      g.add(box(3.6, 0.22, 0.12, stone, 0, 0.29, -1.24));
      g.add(box(0.12, 0.22, 2.6, stone, 1.74, 0.29, 0));
      g.add(box(0.12, 0.22, 2.6, stone, -1.74, 0.29, 0));
      return g;
    },
    'roof-tower': function (o) {
      var g = new THREE.Group();
      var roofM = mat(o.color || PALETTE.roofTile, { roughness: 0.7 });
      var wall = mat(PALETTE.wall);
      var gold = mat(PALETTE.gold, { metalness: 0.6, roughness: 0.3 });
      var w = 3.2, y = 0;
      for (var f = 0; f < 3; f++) {
        g.add(box(w * 0.8, 0.5, w * 0.8, wall, 0, y + 0.25, 0));          // thân tầng
        g.add(roof(w, w, 0.7, roofM, 0, y + 0.85, 0));                    // mái tầng
        y += 1.2; w *= 0.78;
      }
      g.add(sph(0.22, gold, 0, y + 0.25, 0));                             // đỉnh vàng
      return g;
    },
    'wall': function (o) {
      var g = new THREE.Group();
      var wallM = mat(o.color || PALETTE.wall);
      g.add(box(3.0, 2.4, 0.3, wallM, 0, 1.2, 0));                        // thân tường
      g.add(box(3.06, 0.25, 0.36, mat(PALETTE.stone), 0, 0.125, 0));      // chân tường
      g.add(box(3.06, 0.12, 0.36, mat(PALETTE.wood), 0, 2.34, 0));        // gờ trên
      return g;
    },
    'window': function (o) {
      var g = new THREE.Group();
      var wood = mat(PALETTE.wood);
      var glow = mat('#ffe9a8', { emissive: '#ffdf9a', emissiveIntensity: 0.4 });
      g.add(box(0.84, 1.04, 0.06, glow, 0, 0.6, 0));                      // ô sáng
      g.add(box(0.08, 1.2, 0.14, wood, -0.46, 0.6, 0));                   // khung 2 bên
      g.add(box(0.08, 1.2, 0.14, wood, 0.46, 0.6, 0));
      g.add(box(1.0, 0.08, 0.14, wood, 0, 1.16, 0));                      // khung trên/dưới
      g.add(box(1.0, 0.08, 0.14, wood, 0, 0.04, 0));
      g.add(box(0.06, 1.04, 0.08, wood, 0, 0.6, 0.02));                  // song dọc/ngang
      g.add(box(0.84, 0.06, 0.08, wood, 0, 0.6, 0.02));
      return g;
    },
    'door': function (o) {
      var g = new THREE.Group();
      var wood = mat(PALETTE.wood);
      var leaf = mat(o.color || PALETTE.redWood, { roughness: 0.75 });
      g.add(box(0.12, 2.2, 0.16, wood, -0.54, 1.1, 0));                   // khung
      g.add(box(0.12, 2.2, 0.16, wood, 0.54, 1.1, 0));
      g.add(box(1.2, 0.12, 0.16, wood, 0, 2.14, 0));
      g.add(box(0.96, 2.0, 0.08, leaf, 0, 1.0, 0));                       // cánh cửa
      g.add(box(0.96, 0.1, 0.1, mat(PALETTE.gold, { metalness: 0.55, roughness: 0.35 }), 0, 1.55, 0.05));
      g.add(sph(0.05, mat(PALETTE.gold, { metalness: 0.6, roughness: 0.3 }), 0.32, 1.0, 0.08, 8, 8));
      g.add(box(1.3, 0.12, 0.4, mat(PALETTE.stone), 0, 0.06, 0.18));      // bậc thềm
      return g;
    },
    'stairs': function (o) {
      var g = new THREE.Group();
      var stone = mat(o.color || PALETTE.stone, { roughness: 0.85 });
      for (var i = 0; i < 6; i++) {
        g.add(box(1.2, 0.15, 0.34, stone, 0, 0.075 + i * 0.15, 0.85 - i * 0.34));
      }
      return g;
    },
    'balcony': function (o) {
      var g = new THREE.Group();
      var wood = mat(o.color || PALETTE.wood);
      var rail = mat(PALETTE.wood);
      g.add(box(2.4, 0.12, 1.2, wood, 0, 0.06, 0));                       // sàn
      [-0.55, 0.55].forEach(function (z) {
        g.add(box(2.4, 0.08, 0.08, rail, 0, 1.08, z));                    // tay vịn
        [-1.1, -0.55, 0, 0.55, 1.1].forEach(function (x) {
          g.add(box(0.07, 0.96, 0.07, rail, x, 0.6, z));                  // song lan can
        });
      });
      g.add(box(0.08, 0.08, 1.2, rail, -1.1, 1.08, 0));                   // tay vịn 2 bên
      g.add(box(0.08, 0.08, 1.2, rail, 1.1, 1.08, 0));
      return g;
    },
    'pillar': function (o) {
      var g = new THREE.Group();
      var m = mat(o.color || PALETTE.wood);
      g.add(box(0.45, 0.15, 0.45, mat(PALETTE.stone), 0, 0.075, 0));      // đế
      g.add(pillar(m, 0, 0, 2.1, 0.15));                                  // thân tròn (dùng lại helper pillar)
      g.add(box(0.42, 0.12, 0.42, m, 0, 2.31, 0));                        // đầu cột
      return g;
    },
    'pillar-square': function (o) {
      var g = new THREE.Group();
      var m = mat(o.color || PALETTE.stone, { roughness: 0.85 });
      g.add(box(0.45, 0.15, 0.45, mat(PALETTE.stoneLight), 0, 0.075, 0)); // đế
      g.add(box(0.3, 2.1, 0.3, m, 0, 1.2, 0));                           // thân vuông
      g.add(box(0.42, 0.12, 0.42, m, 0, 2.31, 0));                        // đầu cột
      return g;
    },
    'peach-tree': function (o) {
      var g = new THREE.Group();
      g.add(cyl(0.2, 0.32, 2.0, mat(PALETTE.trunk), 0, 1.0, 0, 8));
      var fol = mat(o.color || PALETTE.peach, { roughness: 0.8 });
      [[0, 2.6, 0, 1.3], [-0.8, 2.2, 0.4, 0.9], [0.8, 2.3, -0.4, 0.95], [0.2, 3.1, 0.3, 0.8]].forEach(function (p) {
        var c = new THREE.Mesh(new THREE.DodecahedronGeometry(p[3], 1), fol);
        c.position.set(p[0], p[1], p[2]); c.castShadow = true; g.add(c);
      });
      g.userData.sway = true;
      return g;
    },
    'tree': function (o) {
      var g = new THREE.Group();
      g.add(cyl(0.28, 0.42, 2.5, mat(PALETTE.trunk), 0, 1.25, 0, 8));
      var fol = mat(o.color || PALETTE.leaf, { roughness: 0.8 });
      [[0, 3.1, 0, 1.7], [-0.9, 2.6, 0.6, 1.2], [0.9, 2.7, -0.5, 1.25]].forEach(function (p) {
        var c = new THREE.Mesh(new THREE.DodecahedronGeometry(p[3], 1), fol);
        c.position.set(p[0], p[1], p[2]); c.castShadow = true; g.add(c);
      });
      g.userData.sway = true;
      return g;
    },
    'bamboo': function (o) {
      var g = new THREE.Group();
      var bm = mat(o.color || PALETTE.bamboo, { roughness: 0.6 });
      for (var i = 0; i < 3; i++) {
        var x = -0.5 + i * 0.5, h = 3.2 + (i % 2) * 0.7;
        var lean = (i - 1) * 0.06;
        var seg = 5;
        for (var s = 0; s < seg; s++) {
          var stalk = cyl(0.09, 0.1, h / seg, bm, x + lean * s, (h / seg) * (s + 0.5), 0.15 * (i - 1), 8);
          g.add(stalk);
          g.add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 10), mat('#2c5a24')));
          g.children[g.children.length - 1].position.set(x + lean * s, (h / seg) * (s + 1), 0.15 * (i - 1));
          g.children[g.children.length - 1].rotation.x = Math.PI / 2;
        }
        var leaf = cone(0.5, 1.0, mat('#5da244', { roughness: 0.8 }), x + lean * seg, h + 0.4, 0.15 * (i - 1), 6);
        leaf.rotation.z = lean * 2; g.add(leaf);
      }
      g.userData.sway = true;
      return g;
    },
    'rock': function (o) {
      var g = new THREE.Group();
      var m = mat(o.color || '#7d8380', { roughness: 0.95 });
      var r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), m);
      r.position.y = 0.55; r.castShadow = true; r.receiveShadow = true; g.add(r);
      var r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), m);
      r2.position.set(0.8, 0.3, 0.3); r2.castShadow = true; g.add(r2);
      return g;
    },
    'water': function (o) {
      var g = new THREE.Group();
      var m = mat(o.color || PALETTE.water, { roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85 });
      var p = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), m);
      p.rotation.x = -Math.PI / 2; p.position.y = -0.55; p.receiveShadow = true; g.add(p);
      var rim = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.12, 8, 24), mat(PALETTE.stone));
      rim.rotation.x = Math.PI / 2; rim.position.y = -0.5; g.add(rim);
      return g;
    },
    /* Đợt 6 — thác nước: mặt nước đứng (plane dọc, xanh trong,
       transparent 0.75, cao theo scale.y) + vách đá 2 bên + bọt trắng
       ở chân thác. Bọt là FX 'foam' của 06-fx.js, gắn thành CON của
       group thác (đi cùng thác khi di chuyển/xoá, không phải object
       riêng) — khớp cách 'lantern' gắn PointLight con trong group.
       buildMesh đăng ký foam vào ED.Fx.tick qua key id + ':foam'
       (tick bỏ qua group không còn parent nên không rò rỉ instance);
       chưa có ED.Fx (vm test chỉ load 03) thì vẫn trả group thác. */
    'waterfall': function (o) {
      var g = new THREE.Group();
      var waterM = mat(o.color || '#7fd4d8', { roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.75 });
      var fall = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.2), waterM);
      fall.position.set(0, 1.6, 0); fall.receiveShadow = false; g.add(fall);
      var crest = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5), waterM);
      crest.rotation.x = -Math.PI / 2; crest.position.set(0, 3.25, -0.1); g.add(crest);
      var stone = mat(PALETTE.stone, { roughness: 0.95 });
      g.add(box(0.5, 3.4, 0.8, stone, -1.35, 1.7, -0.1));                    // vách đá 2 bên
      g.add(box(0.5, 3.4, 0.8, stone, 1.35, 1.7, -0.1));
      g.add(box(3.2, 0.5, 0.9, stone, 0, 3.45, -0.1));                       // đỉnh thác
      var pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2),
        mat(PALETTE.water, { roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.8 }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(0, -0.5, 0.9); g.add(pool);
      g.userData.foam = true;
      if (ED.Fx && typeof ED.Fx.buildFx === 'function') {
        try {
          var foam = ED.Fx.buildFx('foam', { count: 40, speed: 1, color: '#ffffff' });
          foam.position.set(0, 0, 0.9);
          g.add(foam);
          g.userData.foamGroup = foam;
          if (o && o.id && typeof ED.Fx.register === 'function') {
            ED.Fx.register(o.id + ':foam', foam);
          }
        } catch (e) {}
      }
      return g;
    },
    'grass': function (o) {
      var g = new THREE.Group();
      var m = mat(o.color || PALETTE.grass, { roughness: 0.9 });
      for (var i = 0; i < 5; i++) {
        var b = cone(0.14, 0.7 + (i % 3) * 0.15, m, -0.3 + i * 0.15, 0.35, (i % 2 ? 0.12 : -0.1), 5);
        b.rotation.z = (i - 2) * 0.12; g.add(b);
      }
      return g;
    },
    'flower': function (o) {
      var g = new THREE.Group();
      var pad = mat('#3b8c47', { roughness: 0.7 });
      [[0, 0, 0.6], [0.6, 0.3, 0.45], [-0.5, 0.4, 0.5]].forEach(function (p, i) {
        var c = cyl(p[2], p[2], 0.05, pad, p[0], -0.52 + i * 0.025, p[1], 12);
        g.add(c);
      });
      var f = cone(0.26, 0.35, mat(PALETTE.peach, { emissive: '#be185d', emissiveIntensity: 0.25 }), 0.1, -0.35, 0.1, 8);
      f.rotation.x = Math.PI; g.add(f);
      return g;
    },
    'lantern': function (o) {
      var g = new THREE.Group();
      var wood = mat(PALETTE.wood);
      g.add(box(0.18, 3.1, 0.18, wood, 0, 1.55, 0));
      g.add(box(0.9, 0.12, 0.12, wood, 0.35, 2.95, 0));
      var lm = mat(o.color || PALETTE.lantern, { emissive: '#dc2626', emissiveIntensity: 0.65 });
      var lan = cyl(0.26, 0.26, 0.55, lm, 0.7, 2.55, 0, 10);
      g.add(lan);
      g.add(cyl(0.08, 0.08, 0.15, mat(PALETTE.gold, { metalness: 0.5, roughness: 0.4 }), 0.7, 2.9, 0, 8));
      var tassel = cyl(0.03, 0.03, 0.4, mat(PALETTE.gold), 0.7, 2.1, 0, 6);
      g.add(tassel);
      var light = new THREE.PointLight('#ff6b35', 0.55, 7);
      light.position.set(0.7, 2.5, 0); g.add(light);
      g.userData.sway = true;
      g.userData.lanternMat = lm;
      return g;
    },
    'table': function (o) {
      var g = new THREE.Group();
      var wood = mat(PALETTE.wood);
      g.add(box(1.8, 0.12, 1.0, wood, 0, 0.78, 0));
      [[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]].forEach(function (p) {
        g.add(box(0.12, 0.78, 0.12, wood, p[0], 0.39, p[1]));
      });
      g.add(box(1.84, 0.06, 1.04, mat('#7f1d1d', { roughness: 0.85 }), 0, 0.86, 0)); // khăn đỏ
      return g;
    },
    'chair': function (o) {
      var g = new THREE.Group();
      var wood = mat(PALETTE.wood);
      g.add(box(0.55, 0.1, 0.55, wood, 0, 0.45, 0));
      [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].forEach(function (p) {
        g.add(box(0.08, 0.45, 0.08, wood, p[0], 0.22, p[1]));
      });
      g.add(box(0.55, 0.6, 0.08, wood, 0, 0.8, -0.24)); // tựa lưng
      return g;
    },
    'chibi': function (o) {
      var g = new THREE.Group();
      var robe = mat(o.color || '#3b2f2f', { roughness: 0.75 });
      var body = cyl(0.32, 0.42, 0.95, robe, 0, 0.75, 0, 10); g.add(body);
      var belt = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 8, 14), mat('#38bdf8'));
      belt.rotation.x = Math.PI / 2; belt.position.y = 0.95; g.add(belt);
      var head = sph(0.3, mat(PALETTE.skin, { roughness: 0.6 }), 0, 1.55, 0, 14, 12); g.add(head);
      var hair = sph(0.31, mat('#1e1b18', { roughness: 0.7 }), 0, 1.62, -0.04, 14, 10);
      hair.scale.set(1, 0.75, 1); g.add(hair);
      var bun = sph(0.11, mat('#1e1b18'), 0, 1.88, 0, 8, 8); g.add(bun);
      [-0.09, 0.09].forEach(function (x) {
        g.add(sph(0.035, mat('#1e1b18'), x, 1.58, 0.28, 6, 6));
      });
      return g;
    },
    'fx-marker': function (o) {
      var g = new THREE.Group();
      var m = mat(o.color || '#38bdf8', { emissive: '#0ea5e9', emissiveIntensity: 0.8, transparent: true, opacity: 0.9 });
      g.add(sph(0.35, m, 0, 0.6, 0, 12, 10));
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 20), mat('#facc15', { emissive: '#facc15', emissiveIntensity: 0.4 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; g.add(ring);
      return g;
    },
    /* ---- Vũ khí / phụ kiện (đợt 7): primitive để ED.Character gắn
       vào xương (gọi ED.Assets.buildMesh(type)). Gốc group = điểm gắn:
       kiếm/đao/trượng/cung: giữa chuôi (tay cầm); khiên: tay cầm sau
       khiên; nón: đáy nón (đặt lên đầu); áo choàng: gáy/cổ (mép trên).
       Kích thước theo nhân vật cao ~1.8 (ghi rõ từng món bên dưới).
       KHÔNG đưa vào CATALOG (không phải asset đặt xuống đất trong
       scene) — chỉ gọi qua buildMesh khi gắn lên nhân vật. ---- */
    /* Kiếm: dài tổng ~1,04 (lưỡi 0,72 + chuôi 0,18 + đốc). Gốc = giữa chuôi. */
    'weapon-sword': function (o) {
      var g = new THREE.Group();
      var steel = mat(o.color || '#cfd6dd', { metalness: 0.85, roughness: 0.25 });
      var wood = mat(PALETTE.wood);
      var gold = mat(PALETTE.gold, { metalness: 0.55, roughness: 0.35 });
      g.add(cyl(0.025, 0.028, 0.18, wood, 0, 0, 0, 8));                 // chuôi (gốc)
      g.add(sph(0.032, gold, 0, -0.11, 0, 8, 8));                       // đốc kiếm
      g.add(box(0.17, 0.03, 0.045, gold, 0, 0.105, 0));                 // guard ngang
      g.add(box(0.055, 0.72, 0.014, steel, 0, 0.48, 0));                // lưỡi
      var tip = cone(0.028, 0.09, steel, 0, 0.885, 0, 4);
      tip.rotation.y = Math.PI / 4; g.add(tip);                          // mũi nhọn
      return g;
    },
    /* Đao: dài tổng ~1,08; lưỡi cong gần đúng bằng 2 đoạn hộp xoay lệch
       nhau (đoạn dưới -0,10 rad, đoạn trên +0,16 rad). Gốc = giữa chuôi. */
    'weapon-blade': function (o) {
      var g = new THREE.Group();
      var steel = mat(o.color || '#cfd6dd', { metalness: 0.85, roughness: 0.25 });
      var wood = mat(PALETTE.wood);
      var gold = mat(PALETTE.gold, { metalness: 0.55, roughness: 0.35 });
      g.add(cyl(0.026, 0.03, 0.2, wood, 0, 0, 0, 8));                   // chuôi (gốc)
      g.add(sph(0.03, gold, 0, -0.12, 0, 8, 8));                        // đốc đao
      g.add(box(0.14, 0.025, 0.04, gold, 0, 0.11, 0));                  // guard
      var low = box(0.075, 0.42, 0.016, steel, 0, 0.33, 0);             // lưỡi dưới
      low.rotation.z = -0.10; g.add(low);
      var up = box(0.065, 0.36, 0.016, steel, 0.045, 0.68, 0);          // lưỡi trên
      up.rotation.z = 0.16; g.add(up);
      var tip = cone(0.03, 0.08, steel, 0.09, 0.89, 0, 4);              // mũi
      tip.rotation.y = Math.PI / 4; tip.rotation.z = 0.16; g.add(tip);
      return g;
    },
    /* Trượng: dài tổng ~2,0 (thân 1,8 + đầu ngọc); gốc = giữa thân
       (tay cầm ngang tầm tay khi đứng). Đầu ngọc phát sáng nhẹ. */
    'weapon-staff': function (o) {
      var g = new THREE.Group();
      var wood = mat(PALETTE.wood);
      var gold = mat(PALETTE.gold, { metalness: 0.55, roughness: 0.35 });
      g.add(cyl(0.028, 0.032, 1.8, wood, 0, 0, 0, 8));                  // thân (gốc ở giữa)
      g.add(sph(0.04, gold, 0, -0.92, 0, 8, 8));                        // đế dưới
      [-0.82, 0.82].forEach(function (y) {                               // vòng đai 2 đầu
        var r = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), gold);
        r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r);
      });
      g.add(cyl(0.04, 0.04, 0.06, gold, 0, 0.92, 0, 8));                // cổ đầu trượng
      var halo = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 20), gold);
      halo.position.y = 0.99; g.add(halo);                               // vòng vàng đầu trượng
      g.add(sph(0.075, mat(o.color || '#38bdf8', { emissive: '#0ea5e9', emissiveIntensity: 0.7 }), 0, 1.0, 0, 12, 10)); // ngọc
      return g;
    },
    /* Cung: cao ~1,27, cánh cung là nửa Torus (bụng cung +X 0,6), dây
       thẳng theo Y qua 2 đầu. Gốc = giữa dây (tay cầm). */
    'weapon-bow': function (o) {
      var g = new THREE.Group();
      var wood = mat(o.color || PALETTE.wood);
      var gold = mat(PALETTE.gold, { metalness: 0.55, roughness: 0.35 });
      var limb = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 8, 24, Math.PI), wood);
      limb.rotation.z = -Math.PI / 2; /* 2 đầu lên/xuống, bụng cung +X */
      limb.castShadow = true; g.add(limb);
      g.add(cyl(0.006, 0.006, 1.2, mat('#e5e0d0', { roughness: 0.9 }), 0, 0, 0, 6)); // dây
      g.add(box(0.07, 0.16, 0.05, mat('#3b2414'), 0, 0, 0));             // tay cầm (gốc)
      g.add(sph(0.035, gold, 0, 0.6, 0, 8, 8));                         // đầu cung
      g.add(sph(0.035, gold, 0, -0.6, 0, 8, 8));
      return g;
    },
    /* Khiên tròn: đường kính 0,7, mặt thép + viền vàng + núm giữa.
       Gốc = tay cầm sau lưng khiên (mặt khiên hướng +Z). */
    'weapon-shield': function (o) {
      var g = new THREE.Group();
      var steel = mat(o.color || PALETTE.stone, { metalness: 0.4, roughness: 0.5 });
      var gold = mat(PALETTE.gold, { metalness: 0.6, roughness: 0.3 });
      var face = cyl(0.35, 0.35, 0.04, steel, 0, 0, 0, 20);
      face.rotation.x = Math.PI / 2; g.add(face);                        // mặt khiên (đĩa XY)
      var rim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.022, 8, 28), gold);
      rim.castShadow = true; g.add(rim);                                // viền
      var boss = sph(0.09, gold, 0, 0, 0.05, 12, 10);                  // núm giữa
      boss.scale.set(1, 1, 0.55); g.add(boss);
      [[0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]].forEach(function (p) {
        g.add(sph(0.02, gold, p[0], p[1], 0.03, 6, 6));                 // đinh tán
      });
      g.add(box(0.05, 0.22, 0.05, mat(PALETTE.wood), 0, 0, -0.06));      // tay cầm (gốc)
      return g;
    },
    /* Nón lá: đường kính 0,7, cao ~0,15, chóp nón dẹt + vành.
       Gốc = tâm đáy nón (đặt lên đỉnh đầu). */
    'weapon-hat': function (o) {
      var g = new THREE.Group();
      var straw = mat(o.color || '#d9c27a', { roughness: 0.9 });
      g.add(cone(0.35, 0.12, straw, 0, 0.06, 0, 16));                   // chóp nón (đáy y=0)
      var rim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.015, 6, 24), mat('#b89b55', { roughness: 0.9 }));
      rim.rotation.x = Math.PI / 2; rim.position.y = 0.01; g.add(rim);   // vành
      g.add(sph(0.03, mat('#8a6d2f', { roughness: 0.8 }), 0, 0.13, 0, 8, 8)); // núm đỉnh
      return g;
    },
    /* Áo choàng: tấm cong sau lưng, dài ~1,2 (từ cổ xuống), rộng 0,68
       trên / 1,0 dưới (loé ra). Gốc = gáy/cổ (mép trên). Giả định nhân
       vật quay mặt +Z (chuẩn Mixamo) nên mặt sau là -Z. */
    'weapon-cape': function (o) {
      var g = new THREE.Group();
      var cloth = new THREE.MeshStandardMaterial({
        color: 0x7f1d1d, roughness: 0.9, metalness: 0, side: THREE.DoubleSide
      });
      cloth.userData = { baseColor: '#7f1d1d' };
      var shell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.5, 1.2, 12, 1, true, Math.PI - 1.0, 2.0), cloth);
      shell.position.y = -0.6; /* mép trên ở y=0 (cổ), rủ xuống -1,2 */
      shell.castShadow = true; g.add(shell);
      g.add(sph(0.035, mat(PALETTE.gold, { metalness: 0.6, roughness: 0.3 }), 0, -0.03, 0.32, 8, 8)); // khuy cổ
      return g;
    }
  };

  /* buildMesh(type, opts) -> THREE.Group. opts: {color} hoặc cả object
     project (viewport truyền obj — lấy obj.color / obj.extra). Type lạ ->
     trả null để tầng gọi báo lỗi rõ ràng (không vẽ asset giả).
     Màu nhấn (mái ngói, vàng, đèn, hoa...) được giữ nguyên khi viewport
     áp obj.color lên toàn mesh (userData.keepColor) — chỉ thân/tường
     chính đổi theo obj.color. */
  var ACCENT_COLORS = { '#7f1d1d': 1, '#7a5238': 1, '#d8a53c': 1, '#ef4444': 1,
    '#f472b6': 1, '#4da39e': 1, '#3b6b8f': 1, '#ffdf9a': 1, '#ffe9a8': 1 };
  function buildMesh(type, opts) {
    opts = opts || {};
    if (type === 'fx') {
      /* FX đi qua ED.Fx (Points thật + đăng ký tick); 06-fx.js load sau
         file này nhưng buildMesh chỉ gọi lúc chạy nên ED.Fx đã có. */
      if (ED.Fx && typeof ED.Fx.buildFxForObject === 'function') {
        try { return ED.Fx.buildFxForObject(opts); } catch (e) { return null; }
      }
      return null;
    }
    var b = BUILDERS[type];
    if (!b) return null;
    var g = b(opts);
    g.userData.assetType = type;
    g.userData.assetName = (defOf(type) || {}).name || type;
    g.traverse(function (c) {
      if (!c.isMesh || !c.material) return;
      var m = c.material;
      var base = (m.userData && m.userData.baseColor) || '';
      if (ACCENT_COLORS[base] || m.emissiveIntensity > 0 || m.metalness >= 0.5) {
        c.userData.keepColor = true;
      }
    });
    return g;
  }

  /* ---- Thêm object vào project (qua ED.Core nếu có, fallback: chỉ log). ---- */
  function addObjectAt(type, x, y, z) {
    var def = defOf(type);
    if (!def) return null;
    var yy = (typeof y === 'number') ? y : 0;
    if (ED.Terrain && typeof ED.Terrain.heightAt === 'function' && (y == null)) {
      try { yy = ED.Terrain.heightAt(x, z); } catch (e) { yy = 0; }
    }
    var obj = { type: type, category: def.category, name: def.name,
      pos: [x, yy, z], rot: [0, 0, 0], scale: [1, 1, 1] };
    if (type === 'fx-marker') { obj.type = 'fx'; obj.extra = { fxType: 'fire', count: 60, speed: 1, color: '#ff8c1a' }; }
    if (type === 'waterfall') { obj.extra = { foam: true }; }
    if (ED.Core && typeof ED.Core.addObject === 'function') {
      obj = ED.Core.addObject(obj) || obj;
    } else if (ED.Core && typeof ED.Core.markDirty === 'function') {
      ED.Core.markDirty();
    }
    if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') {
      try { ED.Viewport.syncObject(obj); } catch (e) {}
    }
    if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast('Đã thêm ' + def.name);
    return obj;
  }

  /* Vị trí trước camera (cho nút Thêm trên điện thoại): cách camera 6 đơn
     vị theo hướng nhìn, chiếu xuống mặt đất. */
  function pointInFrontOfCamera(dist) {
    dist = dist || 6;
    var cam = ED.Viewport && ED.Viewport.camera;
    if (!cam || !cam.position) return { x: 0, z: -dist };
    var dir = { x: 0, z: -1 };
    if (typeof THREE !== 'undefined' && cam.getWorldDirection) {
      var v = new THREE.Vector3();
      cam.getWorldDirection(v);
      dir = { x: v.x, z: v.z };
      var len = Math.hypot(dir.x, dir.z) || 1;
      dir.x /= len; dir.z /= len;
    }
    return { x: cam.position.x + dir.x * dist, z: cam.position.z + dir.z * dist };
  }
  function addAtCamera(type) {
    var p = pointInFrontOfCamera(6);
    return addObjectAt(type, p.x, null, p.z);
  }

  /* Điểm trên mặt đất từ sự kiện chuột/chạm (raycast xuống mặt phẳng y=0). */
  function groundPoint(clientX, clientY) {
    var vp = ED.Viewport || {};
    if (typeof vp.screenToGround === 'function') {
      try { return vp.screenToGround(clientX, clientY); } catch (e) {}
    }
    if (typeof THREE === 'undefined' || !vp.camera || !vp.renderer) return null;
    var el = vp.renderer.domElement;
    var r = el.getBoundingClientRect();
    var nx = ((clientX - r.left) / r.width) * 2 - 1;
    var ny = -((clientY - r.top) / r.height) * 2 + 1;
    var rc = new THREE.Raycaster();
    rc.setFromCamera({ x: nx, y: ny }, vp.camera);
    var t = -rc.ray.origin.y / rc.ray.direction.y;
    if (!isFinite(t) || t < 0) return null;
    return { x: rc.ray.origin.x + rc.ray.direction.x * t, z: rc.ray.origin.z + rc.ray.direction.z * t };
  }
  function onDropAt(clientX, clientY, type) {
    var p = groundPoint(clientX, clientY);
    if (!p) {
      /* Viewport chưa expose camera/renderer (nhóm A) nên chưa raycast
         chính xác được: fallback thêm trước camera thay vì mất asset. */
      return addAtCamera(type);
    }
    return addObjectAt(type, p.x, null, p.z);
  }

  /* ---- Asset Library UI (gắn vào #asset-list do nhóm A tạo; chưa có thì
     tự tạo fallback). Gọi trong init(). ---- */
  var _listEl = null, _searchEl = null, _importEl = null, _query = '';
  function renderList() {
    if (!_listEl) return;
    var items = filterCatalog(_query);
    var html = '';
    var lastCat = '';
    items.forEach(function (d) {
      if (d.category !== lastCat) { html += '<div class="ed-asset-cat">' + d.category + '</div>'; lastCat = d.category; }
      html += '<div class="ed-asset-item" draggable="true" data-type="' + d.type + '">' +
        '<span class="ed-asset-name">' + d.name + '</span>' +
        '<span class="ed-asset-desc">' + d.desc + '</span>' +
        '<button class="ed-asset-add" data-add="' + d.type + '" title="Thêm trước camera">➕ Thêm</button>' +
        '</div>';
    });
    if (!items.length) html = '<div class="ed-asset-empty">Không tìm thấy asset nào.</div>';
    _listEl.innerHTML = html;
    var nodes = _listEl.querySelectorAll('.ed-asset-item');
    for (var i = 0; i < nodes.length; i++) {
      (function (node) {
        node.addEventListener('dragstart', function (ev) {
          try { ev.dataTransfer.setData('text/ed-asset', node.getAttribute('data-type')); ev.dataTransfer.effectAllowed = 'copy'; } catch (e) {}
        });
      })(nodes[i]);
    }
    var btns = _listEl.querySelectorAll('[data-add]');
    for (var j = 0; j < btns.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          addAtCamera(btn.getAttribute('data-add'));
        });
      })(btns[j]);
    }
    renderImportedList();
  }
  function renderImportedList() {
    if (!_listEl) return;
    var old = _listEl.querySelector('.ed-imported-list');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    listImported().then(function (recs) {
      if (!_listEl) return;
      var div = document.createElement('div');
      div.className = 'ed-imported-list';
      var h = '<div class="ed-asset-cat">Đã import (' + recs.length + ')</div>';
      recs.forEach(function (r) {
        h += '<div class="ed-asset-item"><span class="ed-asset-name">' + r.name + '</span>' +
          '<span class="ed-asset-desc">' + r.ext.toUpperCase() + ' · ' + (r.size / 1024).toFixed(0) + ' KB</span>' +
          '<button class="ed-asset-add" data-imp-add="' + r.key + '">➕ Thêm</button>' +
          '<button class="ed-asset-add" data-imp-del="' + r.key + '" title="Xoá file đã import">✕</button></div>';
      });
      if (!recs.length) h += '<div class="ed-asset-empty">Chưa có model import.</div>';
      div.innerHTML = h;
      _listEl.appendChild(div);
      var adds = div.querySelectorAll('[data-imp-add]');
      for (var i = 0; i < adds.length; i++) {
        (function (btn) {
          btn.addEventListener('click', function () { addImportedAtCamera(btn.getAttribute('data-imp-add')); });
        })(adds[i]);
      }
      var dels = div.querySelectorAll('[data-imp-del]');
      for (var j = 0; j < dels.length; j++) {
        (function (btn) {
          btn.addEventListener('click', function () {
            removeImported(btn.getAttribute('data-imp-del')).then(renderList);
          });
        })(dels[j]);
      }
    }).catch(function () {});
  }

  function attachDrop(viewportEl) {
    if (!viewportEl || !viewportEl.addEventListener) return false;
    viewportEl.addEventListener('dragover', function (ev) { ev.preventDefault(); try { ev.dataTransfer.dropEffect = 'copy'; } catch (e) {} });
    viewportEl.addEventListener('drop', function (ev) {
      ev.preventDefault();
      var type = '';
      try { type = ev.dataTransfer.getData('text/ed-asset') || ''; } catch (e) {}
      if (type) onDropAt(ev.clientX, ev.clientY, type);
    });
    return true;
  }

  /* ---- Import model: validate / IDB / parse / normalize. ---- */
  function validateImportFile(file) {
    if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name) {
      return { ok: false, reason: 'Chưa chọn file nào.' };
    }
    if (!/\.(fbx|glb|obj)$/i.test(file.name)) {
      return { ok: false, reason: 'File "' + file.name + '" không phải .fbx / .glb / .obj.' };
    }
    var size = Number(file.size);
    if (!size || size < 1) return { ok: false, reason: 'File rỗng, không đọc được.' };
    if (size > MAX_BYTES) return { ok: false, reason: 'File quá lớn (' + (size / 1048576).toFixed(1) + ' MB, tối đa 20 MB).' };
    return { ok: true, ext: file.name.split('.').pop().toLowerCase() };
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var idb = null;
      try { idb = (typeof window !== 'undefined' && window.indexedDB) ? window.indexedDB : null; } catch (e) { idb = null; }
      if (!idb) { reject(new Error('Trình duyệt này không dùng được IndexedDB.')); return; }
      var req;
      try { req = idb.open(DB_NAME, 1); } catch (e) { reject(new Error('Không mở được IndexedDB: ' + (e && e.message ? e.message : ''))); return; }
      req.onupgradeneeded = function () {
        try {
          var db = req.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'name' });
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        } catch (e) {}
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(new Error('Không mở được IndexedDB.')); };
      req.onblocked = function () { reject(new Error('IndexedDB đang bị chặn, đóng tab khác rồi thử lại.')); };
    });
  }
  function idbPut(rec) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không lưu được model.')); return; }
        var done = false;
        tx.oncomplete = function () { try { db.close(); } catch (e) {} if (!done) { done = true; resolve(rec); } };
        tx.onerror = function () { try { db.close(); } catch (e) {} if (!done) { done = true; reject(new Error('Không lưu được model vào máy.')); } };
        try { tx.objectStore(STORE).put(rec); } catch (e) { try { db.close(); } catch (e2) {} if (!done) { done = true; reject(new Error('Không lưu được model.')); } }
      });
    });
  }
  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readonly'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được model đã lưu.')); return; }
        var req;
        try { req = tx.objectStore(STORE).get(key); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được model đã lưu.')); return; }
        req.onsuccess = function () { try { db.close(); } catch (e) {} resolve(req.result || null); };
        req.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không đọc được model đã lưu.')); };
      });
    });
  }
  function idbDel(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xoá được model.')); return; }
        tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(); };
        tx.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không xoá được model.')); };
        try { tx.objectStore(STORE).delete(key); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xoá được model.')); }
      });
    });
  }
  function idbListMeta() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readonly'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được danh sách model.')); return; }
        var req;
        try { req = tx.objectStore(STORE).getAll(); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được danh sách model.')); return; }
        req.onsuccess = function () {
          try { db.close(); } catch (e) {}
          resolve((req.result || []).map(function (r) {
            return { key: r.key, name: r.name, size: r.size, ext: r.ext, addedAt: r.addedAt };
          }));
        };
        req.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không đọc được danh sách model.')); };
      });
    });
  }

  /* Chuẩn hoá như src/11-fbx.js: cao 1.8, căn giữa x/z, đáy y = 0. */
  function normalizeGroup(group) {
    var box3 = new THREE.Box3().setFromObject(group);
    var size = new THREE.Vector3(); box3.getSize(size);
    var center = new THREE.Vector3(); box3.getCenter(center);
    if (!isFinite(size.y) || size.y <= 0) throw new Error('Model không có hình dạng nào để hiển thị.');
    var s = TARGET_HEIGHT / size.y;
    group.scale.setScalar(s);
    group.position.x -= center.x * s;
    group.position.z -= center.z * s;
    group.position.y -= box3.min.y * s;
    group.updateMatrixWorld(true);
    return group;
  }

  /* Parse ArrayBuffer theo đuôi. FBX: parse đồng bộ. GLB: GLTFLoader.parse
     (callback). OBJ: decode text rồi OBJLoader.parse. Lỗi -> Error tiếng Việt.
     opts.normalize === false thì KHÔNG chuẩn hoá cao 1.8 (dùng cho
     importWeapon — vũ khí không scale theo chiều cao nhân vật). */
  function parseArrayBuffer(ab, ext, opts) {
    var buf = null;
    if (ab && typeof ab === 'object') {
      if (typeof ab.byteLength === 'number' && typeof ab.slice === 'function' && !ab.buffer) buf = ab;
      else if (ab.buffer && typeof ab.byteLength === 'number' && typeof ab.byteOffset === 'number' && typeof ab.buffer.slice === 'function') {
        buf = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
      }
    }
    if (!buf) throw new Error('Dữ liệu model không hợp lệ.');
    if (typeof THREE === 'undefined') throw new Error('Chưa tải được three.js.');
    var norm = (opts && opts.normalize === false) ? function (g) { return g; } : normalizeGroup;
    if (ext === 'fbx') {
      if (!THREE.FBXLoader) throw new Error('Chưa tải được bộ đọc .fbx, thử tải lại trang.');
      var group;
      try { group = new THREE.FBXLoader().parse(buf, ''); } catch (e) {
        throw new Error('Không đọc được file .fbx này (' + (e && e.message ? e.message : 'định dạng không hỗ trợ') + ').');
      }
      if (!group) throw new Error('Không đọc được file .fbx này (file rỗng).');
      return { group: norm(group), animations: group.animations || [] };
    }
    if (ext === 'glb') {
      if (!THREE.GLTFLoader) throw new Error('Chưa tải được bộ đọc .glb, thử tải lại trang.');
      return new Promise(function (resolve, reject) {
        try {
          new THREE.GLTFLoader().parse(buf, '', function (gltf) {
            try { resolve({ group: norm(gltf.scene), animations: gltf.animations || [] }); }
            catch (e) { reject(new Error('Không chuẩn hoá được model .glb: ' + (e && e.message ? e.message : ''))); }
          }, function (e) { reject(new Error('Không đọc được file .glb này (' + (e && e.message ? e.message : 'định dạng không hỗ trợ') + ').')); });
        } catch (e) { reject(new Error('Không đọc được file .glb này (' + (e && e.message ? e.message : '') + ').')); }
      });
    }
    if (ext === 'obj') {
      if (!THREE.OBJLoader) throw new Error('Chưa tải được bộ đọc .obj, thử tải lại trang.');
      var text;
      try { text = new TextDecoder().decode(buf); } catch (e) { throw new Error('Không đọc được file .obj này.'); }
      var obj;
      try { obj = new THREE.OBJLoader().parse(text); } catch (e) {
        throw new Error('Không đọc được file .obj này (' + (e && e.message ? e.message : 'định dạng không hỗ trợ') + ').');
      }
      if (!obj) throw new Error('Không đọc được file .obj này (file rỗng).');
      return { group: norm(obj), animations: [] };
    }
    throw new Error('Định dạng chưa hỗ trợ: .' + ext);
  }

  /* ---- Import vũ khí (đợt 7): model .fbx/.glb làm vũ khí gắn xương.
     Chỉ validate + parse, KHÔNG vẽ nút import giả — ED.Character gọi
     hàm này khi người dùng chọn file vũ khí. Model import không scale
     theo cao 1.8 như nhân vật mà theo normalizeWeaponGroup (cạnh dài
     nhất -> 1.0, tâm bounding box về gốc) để vừa tay nhân vật ~1.8.
     Trả Promise<{ok:true, group, name} | {ok:false, reason}> (không
     reject — tầng gọi chỉ cần đọc ok/reason để báo tiếng Việt). ---- */
  function validateWeaponFile(file) {
    if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name) {
      return { ok: false, reason: 'Chưa chọn file nào.' };
    }
    if (!/\.(fbx|glb)$/i.test(file.name)) {
      return { ok: false, reason: 'File "' + file.name + '" không phải .fbx / .glb (vũ khí chỉ nhận 2 định dạng này).' };
    }
    var size = Number(file.size);
    if (!size || size < 1) return { ok: false, reason: 'File rỗng, không đọc được.' };
    if (size > MAX_BYTES) return { ok: false, reason: 'File vũ khí quá lớn (' + (size / 1048576).toFixed(1) + ' MB, tối đa 20 MB).' };
    return { ok: true, ext: file.name.split('.').pop().toLowerCase() };
  }

  /* Scale vũ khí import: cạnh dài nhất của bounding box -> 1.0 (vừa
     tay nhân vật cao ~1.8), tâm box về gốc (điểm gắn ở giữa vũ khí;
     ED.Character có thể dịch thêm để khớp tay cầm). Trả group đã scale. */
  function normalizeWeaponGroup(group) {
    if (typeof THREE === 'undefined' || !THREE.Box3 || !THREE.Vector3) {
      throw new Error('Chưa tải được three.js.');
    }
    var box3 = new THREE.Box3().setFromObject(group);
    var size = new THREE.Vector3(); box3.getSize(size);
    var center = new THREE.Vector3(); box3.getCenter(center);
    var longest = Math.max(size.x, size.y, size.z);
    if (!isFinite(longest) || longest <= 0) throw new Error('Model vũ khí không có hình dạng nào để hiển thị.');
    var s = 1.0 / longest;
    group.scale.setScalar(s);
    group.position.x -= center.x * s;
    group.position.y -= center.y * s;
    group.position.z -= center.z * s;
    group.updateMatrixWorld(true);
    return group;
  }

  function importWeapon(file) {
    var v = validateWeaponFile(file);
    if (!v.ok) return Promise.resolve({ ok: false, reason: v.reason });
    if (typeof FileReader === 'undefined') {
      return Promise.resolve({ ok: false, reason: 'Trình duyệt này không đọc được file (thiếu FileReader).' });
    }
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onerror = function () { resolve({ ok: false, reason: 'Không đọc được file từ máy.' }); };
      reader.onload = function () {
        var parsed;
        try {
          parsed = parseArrayBuffer(reader.result, v.ext, { normalize: false });
        } catch (e) {
          resolve({ ok: false, reason: e && e.message ? e.message : 'Không đọc được file vũ khí này.' });
          return;
        }
        Promise.resolve(parsed).then(function (r) {
          var group = null;
          try { group = normalizeWeaponGroup(r.group); } catch (e) {
            resolve({ ok: false, reason: e && e.message ? e.message : 'Không chuẩn hoá được model vũ khí.' });
            return;
          }
          if (!group) { resolve({ ok: false, reason: 'Không đọc được file vũ khí này (file rỗng).' }); return; }
          resolve({ ok: true, group: group, name: file.name.replace(/\.(fbx|glb)$/i, '') });
        }).catch(function (e) {
          resolve({ ok: false, reason: e && e.message ? e.message : 'Không đọc được file vũ khí này.' });
        });
      };
      try { reader.readAsArrayBuffer(file); } catch (e) {
        resolve({ ok: false, reason: 'Không đọc được file từ máy.' });
      }
    });
  }

  function importFile(file) {
    var v = validateImportFile(file);
    if (!v.ok) return Promise.reject(new Error(v.reason));
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Không đọc được file từ máy.')); };
      reader.onload = function () {
        var key = 'imp:' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
        var rec = { key: key, name: file.name, size: file.size, ext: v.ext, addedAt: Date.now(), data: reader.result };
        idbPut(rec).then(function () {
          renderList();
          if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast('Đã import ' + file.name);
          resolve({ key: key, name: rec.name, size: rec.size, ext: v.ext });
        }).catch(reject);
      };
      try { reader.readAsArrayBuffer(file); } catch (e) { reject(new Error('Không đọc được file từ máy.')); }
    });
  }
  function listImported() {
    if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve([]);
    return idbListMeta().catch(function () { return []; });
  }
  function removeImported(key) {
    return idbDel(key).then(function () { renderList(); });
  }
  function loadImportedModel(key) {
    return idbGet(key).then(function (rec) {
      if (!rec || !rec.data) throw new Error('Không tìm thấy model đã lưu, thử import lại.');
      var r = parseArrayBuffer(rec.data, rec.ext);
      return (r && typeof r.then === 'function') ? r : Promise.resolve(r);
    });
  }
  /* Thêm model đã import vào scene tại vị trí trước camera. */
  function addImportedAtCamera(key) {
    return loadImportedModel(key).then(function (parsed) {
      var p = pointInFrontOfCamera(6);
      var obj = { type: 'imported', category: 'Props', name: 'Model import', pos: [p.x, 0, p.z], rot: [0, 0, 0], scale: [1, 1, 1], extra: { importKey: key } };
      if (ED.Core && typeof ED.Core.addObject === 'function') obj = ED.Core.addObject(obj) || obj;
      if (ED.Viewport && ED.Viewport.meshes) ED.Viewport.meshes[obj.id || key] = parsed.group;
      if (ED.Viewport && typeof ED.Viewport.syncObject === 'function') {
        try { ED.Viewport.syncObject(obj); } catch (e) {}
      }
      return obj;
    });
  }
  /* Viewport gọi khi syncObject gặp type 'imported': trả mesh đã parse. */
  function buildImportedMesh(obj, done) {
    if (!obj || !obj.extra || !obj.extra.importKey) { done(null); return; }
    loadImportedModel(obj.extra.importKey).then(function (parsed) { done(parsed.group); }).catch(function () { done(null); });
  }

  function init() {
    if (typeof document === 'undefined') return;
    var container = document.getElementById('asset-list');
    if (!container) {
      container = document.createElement('div');
      container.id = 'asset-list';
      container.className = 'ed-asset-list-fallback';
      document.body.appendChild(container);
    }
    _listEl = container;
    var search = document.getElementById('asset-search');
    if (!search) {
      search = document.createElement('input');
      search.id = 'asset-search';
      search.type = 'search';
      search.placeholder = 'Tìm asset… (nhà, cây, đèn…)';
      if (container.parentNode) container.parentNode.insertBefore(search, container);
      else document.body.appendChild(search);
    }
    _searchEl = search;
    search.addEventListener('input', function () { _query = search.value || ''; renderList(); });
    var impBtn = document.getElementById('asset-import-btn');
    if (!impBtn) {
      impBtn = document.createElement('button');
      impBtn.id = 'asset-import-btn';
      impBtn.textContent = '📥 Import .fbx / .glb / .obj';
      if (container.parentNode) container.parentNode.insertBefore(impBtn, container);
    }
    var picker = document.getElementById('asset-import-picker');
    if (!picker) {
      picker = document.createElement('input');
      picker.id = 'asset-import-picker';
      picker.type = 'file';
      picker.accept = '.fbx,.glb,.obj';
      picker.style.display = 'none';
      document.body.appendChild(picker);
    }
    _importEl = picker;
    impBtn.addEventListener('click', function () { picker.click(); });
    picker.addEventListener('change', function () {
      var f = picker.files && picker.files[0];
      picker.value = '';
      if (!f) return;
      importFile(f).catch(function (e) {
        if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(e && e.message ? e.message : 'Import thất bại.');
      });
    });
    var vp = document.getElementById('viewport') || document.getElementById('editor-viewport') ||
      (ED.Viewport && ED.Viewport.renderer && ED.Viewport.renderer.domElement);
    if (vp) attachDrop(vp);
    renderList();
  }

  return {
    catalog: catalog, categories: categories, defOf: defOf, filterCatalog: filterCatalog,
    buildMesh: buildMesh, addObjectAt: addObjectAt, addAtCamera: addAtCamera,
    pointInFrontOfCamera: pointInFrontOfCamera, groundPoint: groundPoint,
    onDropAt: onDropAt, attachDrop: attachDrop, renderList: renderList,
    validateImportFile: validateImportFile, importFile: importFile,
    listImported: listImported, removeImported: removeImported,
    loadImportedModel: loadImportedModel, addImportedAtCamera: addImportedAtCamera,
    buildImportedMesh: buildImportedMesh, parseArrayBuffer: parseArrayBuffer,
    normalizeGroup: normalizeGroup, DB_NAME: DB_NAME, STORE: STORE, MAX_BYTES: MAX_BYTES,
    /* Đợt 7 — thư viện vũ khí: buildMesh('weapon-*') + import .fbx/.glb làm vũ khí. */
    importWeapon: importWeapon, validateWeaponFile: validateWeaponFile,
    normalizeWeaponGroup: normalizeWeaponGroup,
    init: init
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
