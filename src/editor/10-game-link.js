/* ============================== GAME LINK ==============================
   10-game-link.js — ED.GameLink: nối Map Editor với game Mộng Võ Lâm thật.
   (a) LOAD: fetch 'src/02-world.js' (+ 'src/01-data.js' cho NPC defs) từ
       cùng origin (GitHub Pages phục vụ được src/ vì đã commit), trích NPC /
       WATER_RECTS / spawn player bằng regex, dựng thành scene editor.
       Fetch thất bại (file://, CORS, offline) thì báo rõ + cho nút
       "Load project mẫu" (project mẫu có sẵn trong code).
   (b) EXPORT: "Xuất patch cho game" — diff scene hiện tại với world gốc đã
       load -> patch JSON -> localStorage 'mongvolam_editor_patch_v1' + tải
       file patch JSON. "Tải mongvolam.html đã sửa" — fetch toàn bộ src/*.js
       + lib/*.js + template từ cùng origin, build lại HTML trong trình duyệt
       theo đúng mẫu tools/build.mjs (nối parts gồm cả 13-editor-patch.js +
       nhúng patch JSON cuối file dưới dạng var EMBEDDED_PATCH để game dùng
       khi localStorage trống), rồi tải về bằng Blob. Fetch src/ thất bại
       thì báo rõ không làm được, không giả vờ tải.
   - KHÔNG chạm document/window/THREE ở top-level: mọi khởi tạo trong hàm.
     Logic thuần (parse/diff/sample/buildPatchedHtml) không phụ thuộc DOM để
     tools/test-mapeditor.cjs load bằng vm mà test được.
   - Không sửa src/original/, không sửa game. Patch KHÔNG phá save v2
     (game chỉ đọc patch, không ghi thêm field save nào).
   Chạy: node tools/test-mapeditor.cjs */
var ED = (typeof ED !== 'undefined' ? ED : {});

ED.GameLink = (function () {
  var PATCH_KEY = 'mongvolam_editor_patch_v1';
  var PROP_TYPES = ['tree', 'lantern', 'rock', 'stone', 'bush', 'pillar'];
  /* Thứ tự parts đúng tools/build.mjs (13-editor-patch.js trước 06-boot.js). */
  var GAME_PARTS = ['01-data.js', '02-world.js', '02b-env.js', '03-battle.js', '03b-arenas.js',
    '04-info.js', '05-ui.js', '10b-districts.js', '11-fbx.js', '12-fbx-ui.js', '13-editor-patch.js', '06-boot.js'];

  var originalWorld = null; /* {npcs:[{id,name,x,z}], waterRects:[...], spawn:{x,z}|null, source} */
  var lastError = null;

  function log(msg) {
    try { if (typeof console !== 'undefined') console.log('[GameLink] ' + msg); } catch (e) {}
    try { if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log('[GameLink] ' + msg); } catch (e) {}
  }
  function toast(msg) {
    try { if (ED.UI && typeof ED.UI.toast === 'function') { ED.UI.toast(msg); return; } } catch (e) {}
    log('toast: ' + msg);
  }

  function num(s) { var n = parseFloat(s); return isFinite(n) ? n : null; }

  /* ---- (thuần) trích NPC + WATER_RECTS + spawn từ src/02-world.js ---- */
  function parseWorldSource(src) {
    var out = { npcs: [], waterRects: [], spawn: null };
    if (typeof src !== 'string' || !src) return out;
    var m = src.match(/const WATER_RECTS\s*=\s*\[([\s\S]*?)\n\];/);
    if (m) {
      var re = /\{\s*minX:\s*(-?[\d.]+),\s*maxX:\s*(-?[\d.]+),\s*minZ:\s*(-?[\d.]+),\s*maxZ:\s*(-?[\d.]+)\s*\}/g;
      var r;
      while ((r = re.exec(m[1])) !== null) {
        out.waterRects.push({ minX: num(r[1]), maxX: num(r[2]), minZ: num(r[3]), maxZ: num(r[4]) });
      }
    }
    /* this.create({...}) trong initPopulation — def NPC nội tuyến. Town array
       this.create(p) không có object literal nên tự loại. */
    var cre = /this\.create\(\{([\s\S]*?)\}\);/g;
    var c;
    while ((c = cre.exec(src)) !== null) {
      var body = c[1];
      var id = body.match(/id:\s*'([^']+)'/);
      var x = body.match(/x:\s*(-?[\d.]+)/);
      var z = body.match(/z:\s*(-?[\d.]+)/);
      if (!id || x === null || z === null) continue;
      var xv = num(x[1]), zv = num(z[1]);
      if (xv === null || zv === null) continue;
      var nm = body.match(/name:\s*'([^']+)'/);
      var npc = { id: id[1], name: nm ? nm[1] : id[1], x: xv, z: zv };
      if (id[1] === 'player') { out.spawn = { x: xv, z: zv }; npc.isPlayer = true; }
      out.npcs.push(npc);
    }
    return out;
  }

  /* ---- (thuần) trích NPC defs từ src/01-data.js: NPC_NEW_DEFS + 2 def riêng ---- */
  function parseNpcDefsSource(src) {
    var out = [];
    if (typeof src !== 'string' || !src) return out;
    function parseObj(body, fallbackName) {
      var id = body.match(/id:\s*'([^']+)'/);
      var x = body.match(/x:\s*(-?[\d.]+)/);
      var z = body.match(/z:\s*(-?[\d.]+)/);
      if (!id || !x || !z) return null;
      var xv = num(x[1]), zv = num(z[1]);
      if (xv === null || zv === null) return null;
      var nm = body.match(/name:\s*'([^']+)'/);
      var sc = body.match(/scale:\s*([\d.]+)/);
      return { id: id[1], name: nm ? nm[1] : (fallbackName || id[1]), x: xv, z: zv, scale: sc ? num(sc[1]) : undefined };
    }
    var arr = src.match(/const NPC_NEW_DEFS\s*=\s*\[([\s\S]*?)\n\];/);
    if (arr) {
      var objRe = /\{([^{}]*)\}/g, o;
      while ((o = objRe.exec(arr[1])) !== null) {
        var npc = parseObj(o[1]);
        if (npc) out.push(npc);
      }
    }
    ['CHESS_NPC_DEF', 'SCENE_BUILDER_NPC_DEF'].forEach(function (name) {
      var re = new RegExp('const ' + name + ' = \\{([^{}]*)\\}');
      var mm = src.match(re);
      if (mm) { var npc = parseObj(mm[1]); if (npc) out.push(npc); }
    });
    return out;
  }

  /* ---- (thuần) project mẫu khi không fetch được world thật ---- */
  function sampleProject() {
    var size = 96, seg = 32, n = (seg + 1) * (seg + 1);
    var heights = [], paints = [];
    for (var i = 0; i < n; i++) { heights.push(0); paints.push(0); }
    return {
      version: 1, name: 'Project mẫu — Biện Kinh Thành (thu nhỏ)',
      terrain: { size: size, segments: seg, heights: heights, paints: paints },
      env: { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co' },
      objects: [
        { id: 'water-1', type: 'water', category: 'Environment', name: 'Hồ sen', pos: [0, -0.65, 9.5], rot: [0, 0, 0], scale: [14, 1, 10], color: '#48a6a3', material: { roughness: 0.26, metalness: 0.15, opacity: 1 }, locked: false, visible: true, parent: null, extra: {} },
        { id: 'tree-1', type: 'tree', category: 'Environment', name: 'Cây đào', pos: [-14.5, 0, -8.5], rot: [0, 0, 0], scale: [1, 1, 1], color: '#166534', material: { roughness: 0.85, metalness: 0, opacity: 1 }, locked: false, visible: true, parent: null, extra: {} }
      ],
      npcs: [
        { id: 'merchant', name: 'Chưởng Quầy Tạp Hóa', level: 1, faction: '', type: 'npc', dialogue: 'Chào mừng thiếu hiệp!', interactRadius: 2, pos: [-5.2, -0.4], patrol: [], ai: 'idle' },
        { id: 'master', name: 'Võ Sư Lôi Đài', level: 1, faction: '', type: 'npc', dialogue: 'Lôi đài đang mở cửa!', interactRadius: 2, pos: [3.4, -3.8], patrol: [], ai: 'idle' }
      ],
      quests: [], characters: []
    };
  }

  /* ---- (thuần) dựng project v1 từ world thật đã load ---- */
  function buildProjectFromWorld(world) {
    var size = 96, seg = 32, n = (seg + 1) * (seg + 1);
    var heights = [], paints = [];
    for (var i = 0; i < n; i++) { heights.push(0); paints.push(0); }
    var project = {
      version: 1, name: 'Biện Kinh Thành (từ game)',
      terrain: { size: size, segments: seg, heights: heights, paints: paints },
      env: { timeOfDay: 10, fog: 0.01, weather: 'none', wind: 0.5, preset: 'thanh-co' },
      objects: [], npcs: [], quests: [], characters: []
    };
    (world.waterRects || []).forEach(function (r, i) {
      var cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
      project.objects.push({
        id: 'water-' + (i + 1), type: 'water', category: 'Environment', name: 'Hồ nước ' + (i + 1),
        pos: [cx, -0.65, cz], rot: [0, 0, 0], scale: [r.maxX - r.minX, 1, r.maxZ - r.minZ],
        color: '#48a6a3', material: { roughness: 0.26, metalness: 0.15, opacity: 1 },
        locked: false, visible: true, parent: null, extra: { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ }
      });
    });
    (world.npcs || []).forEach(function (npc) {
      if (npc.isPlayer) return;
      project.objects.push({
        id: 'npc-' + npc.id, type: 'npc', category: 'Characters', name: npc.name,
        pos: [npc.x, 0, npc.z], rot: [0, 0, 0], scale: npc.scale ? [npc.scale, npc.scale, npc.scale] : [1, 1, 1],
        color: '#7e22ce', material: { roughness: 0.5, metalness: 0, opacity: 1 },
        locked: false, visible: true, parent: null, extra: { npcId: npc.id }
      });
      project.npcs.push({
        id: npc.id, name: npc.name, level: 1, faction: '', type: 'npc',
        dialogue: '', interactRadius: 2, pos: [npc.x, npc.z], patrol: [], ai: 'idle'
      });
    });
    return project;
  }

  /* ---- (thuần) diff scene hiện tại với world gốc -> patch cho game ---- */
  function diffPatch(original, scene) {
    var patch = { version: 1, npcsMoved: [], npcsAdded: [], propsAdded: [] };
    if (!original || !Array.isArray(original.npcs) || !scene || !Array.isArray(scene.npcs)) return patch;
    var origById = {};
    original.npcs.forEach(function (npc) { origById[npc.id] = npc; });
    scene.npcs.forEach(function (npc) {
      if (!npc || typeof npc.id !== 'string' || !npc.id) return;
      var x = Array.isArray(npc.pos) ? npc.pos[0] : npc.x;
      var z = Array.isArray(npc.pos) ? npc.pos[1] : npc.z;
      if (typeof x !== 'number' || typeof z !== 'number') return;
      var orig = origById[npc.id];
      if (!orig) {
        patch.npcsAdded.push({
          id: npc.id, name: npc.name || npc.id, x: x, z: z,
          robe: npc.robe || '#7e22ce', belt: '#facc15', hair: '#1e1b18',
          dialogue: npc.dialogue || 'Xin chào thiếu hiệp!'
        });
      } else if (Math.abs(orig.x - x) > 0.01 || Math.abs(orig.z - z) > 0.01) {
        patch.npcsMoved.push({ id: npc.id, x: x, z: z });
      }
    });
    (scene.props || []).forEach(function (p) {
      if (!p || PROP_TYPES.indexOf(p.type) < 0) return;
      var x = Array.isArray(p.pos) ? p.pos[0] : p.x;
      var z = Array.isArray(p.pos) ? p.pos[2] : p.z;
      if (typeof x !== 'number' || typeof z !== 'number') return;
      patch.propsAdded.push({
        type: p.type, x: x, z: z,
        rotY: Array.isArray(p.rot) ? (p.rot[1] || 0) : (p.rotY || 0),
        scale: Array.isArray(p.scale) ? (p.scale[0] || 1) : (p.scale || 1)
      });
    });
    return patch;
  }

  /* ---- (thuần) build HTML đã sửa, đúng mẫu tools/build.mjs ----
     inputs: {template, style, three, pixi, fflate, fbxLoader, parts:[{name,code}]}
     Trả {ok, html|null, reason}. EMBEDDED_PATCH chèn CUỐI khối JS (trong
     IIFE) để kịp gán trước khi Game.boot() chạy. */
  function buildPatchedHtml(inputs, patch) {
    if (!inputs || typeof inputs.template !== 'string' || !inputs.template) {
      return { ok: false, html: null, reason: 'thieu template (src/index.template.html)' };
    }
    var need = ['style', 'three', 'pixi', 'fflate', 'fbxLoader'];
    for (var i = 0; i < need.length; i++) {
      if (typeof inputs[need[i]] !== 'string' || !inputs[need[i]]) {
        return { ok: false, html: null, reason: 'thieu ' + need[i] };
      }
    }
    if (!Array.isArray(inputs.parts) || !inputs.parts.length) {
      return { ok: false, html: null, reason: 'thieu parts (src/*.js)' };
    }
    var libs = [inputs.three, inputs.pixi, inputs.fflate, inputs.fbxLoader];
    for (var j = 0; j < libs.length; j++) {
      if (libs[j].indexOf('<\/script') >= 0) return { ok: false, html: null, reason: 'lib chua <\/script (se pha the <script>)' };
    }
    var names = inputs.parts.map(function (p) { return p.name; });
    if (names.indexOf('13-editor-patch.js') < 0) {
      return { ok: false, html: null, reason: 'thieu 13-editor-patch.js trong parts' };
    }
    if (names.indexOf('13-editor-patch.js') > names.indexOf('06-boot.js')) {
      return { ok: false, html: null, reason: '13-editor-patch.js phai dung truoc 06-boot.js' };
    }
    var js = '(function(){\n' + inputs.parts.map(function (p) { return p.code; }).join('\n') +
      '\n;var EMBEDDED_PATCH = ' + JSON.stringify(patch || { version: 1, npcsMoved: [], npcsAdded: [], propsAdded: [] }) + ';\n})();';
    /* Template phải chứa đủ placeholder TRƯỚC khi thay — không thì HTML ra
       thiếu game/CSS mà vẫn tưởng ok. */
    var needPh = ['__STYLE__', '__THREE__', '__PIXI__', '__FFLATE__', '__FBXLOADER__', '__GAME__'];
    for (var k = 0; k < needPh.length; k++) {
      if (inputs.template.indexOf(needPh[k]) < 0) {
        return { ok: false, html: null, reason: 'template thieu placeholder ' + needPh[k] };
      }
    }
    function rep(s, ph, val) { return s.split(ph).join(val); }
    var html = inputs.template;
    html = rep(html, '__STYLE__', inputs.style);
    html = rep(html, '__THREE__', inputs.three);
    html = rep(html, '__PIXI__', inputs.pixi);
    html = rep(html, '__FFLATE__', inputs.fflate);
    html = rep(html, '__FBXLOADER__', inputs.fbxLoader);
    html = rep(html, '__GAME__', js);
    return { ok: true, html: html, reason: null };
  }

  /* ---- (trình duyệt) tải file text, throw lỗi tiếng Việt rõ ràng ---- */
  async function fetchText(url) {
    var res;
    try { res = await fetch(url); }
    catch (e) { throw new Error('Không tải được ' + url + ' (' + (e && e.message) + ') — kiểm tra mạng / mở qua http(s), không dùng file://.'); }
    if (!res.ok) throw new Error('Không tải được ' + url + ' (HTTP ' + res.status + ').');
    return await res.text();
  }

  function downloadFile(name, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  /* Scene hiện tại trong editor (qua ED.Core nếu có). */
  function currentScene() {
    var project = null;
    try {
      if (ED.Core && typeof ED.Core.serialize === 'function') project = ED.Core.serialize();
      else if (ED.Core && ED.Core.state && ED.Core.state.project) project = ED.Core.state.project;
    } catch (e) { project = null; }
    if (!project) return null;
    var props = [];
    (project.objects || []).forEach(function (o) {
      if (o && o.type && PROP_TYPES.indexOf(o.type) >= 0) props.push(o);
    });
    return { npcs: project.npcs || [], props: props };
  }

  function loadProjectIntoEditor(project) {
    try {
      if (ED.Core && typeof ED.Core.load === 'function') { ED.Core.load(project); return true; }
    } catch (e) { log('ED.Core.load loi: ' + (e && e.message)); }
    return false;
  }

  /* (a) LOAD world thật từ game. */
  async function loadWorldFromGame() {
    lastError = null;
    try {
      await fetchText('mongvolam.html'); /* kiểm tra origin phục vụ được game */
      var worldSrc = await fetchText('src/02-world.js');
      var dataSrc = '';
      try { dataSrc = await fetchText('src/01-data.js'); }
      catch (e) { log('không tải được src/01-data.js (chỉ thiếu NPC defs phụ): ' + e.message); }
      var world = parseWorldSource(worldSrc);
      var extra = parseNpcDefsSource(dataSrc);
      extra.forEach(function (npc) {
        var dup = false;
        world.npcs.forEach(function (n) { if (n.id === npc.id) dup = true; });
        if (!dup) world.npcs.push(npc);
      });
      world.source = 'game';
      if (!world.npcs.length) throw new Error('parse src/02-world.js không thấy NPC nào — file game có thể đã đổi cấu trúc.');
      originalWorld = world;
      var project = buildProjectFromWorld(world);
      var loaded = loadProjectIntoEditor(project);
      log('đã load world thật: ' + world.npcs.length + ' NPC, ' + world.waterRects.length + ' hồ nước, spawn (' +
        (world.spawn ? world.spawn.x + ',' + world.spawn.z : '?') + ')' + (loaded ? '' : ' (Core chưa sẵn sàng — project giữ trong GameLink)'));
      toast('Đã load world thật: ' + world.npcs.length + ' NPC, ' + world.waterRects.length + ' hồ nước.');
      return { ok: true, world: world, project: project };
    } catch (e) {
      lastError = e && e.message;
      log('LOAD world thất bại: ' + lastError);
      toast('Không load được world thật: ' + lastError + ' Bấm "Load project mẫu" để sửa thử.');
      return { ok: false, reason: lastError };
    }
  }

  /* Nút "Load project mẫu" khi fetch thất bại. */
  function loadSampleProject() {
    var project = sampleProject();
    originalWorld = {
      source: 'sample',
      npcs: project.npcs.map(function (n) { return { id: n.id, name: n.name, x: n.pos[0], z: n.pos[1] }; }),
      waterRects: [{ minX: -7, maxX: 7, minZ: 4.5, maxZ: 14.5 }],
      spawn: { x: -0.2, z: 0.4 }
    };
    var loaded = loadProjectIntoEditor(project);
    log('đã load project mẫu (2 NPC, 1 hồ sen)' + (loaded ? '' : ' (Core chưa sẵn sàng)'));
    toast('Đã load project mẫu — sửa thử rồi Xuất patch.');
    return { ok: true, world: originalWorld, project: project };
  }

  /* (b) EXPORT patch: diff -> localStorage + tải file patch JSON. */
  function exportPatch() {
    if (!originalWorld) {
      toast('Chưa load world gốc — bấm "Load world từ game" (hoặc "Load project mẫu") trước.');
      return null;
    }
    var scene = currentScene();
    if (!scene) {
      toast('Editor Core chưa sẵn sàng — chưa đọc được scene hiện tại.');
      return null;
    }
    var patch = diffPatch(originalWorld, scene);
    var json = JSON.stringify(patch, null, 2);
    try {
      localStorage.setItem(PATCH_KEY, json);
    } catch (e) {
      toast('Không lưu được patch vào localStorage: ' + (e && e.message));
      return null;
    }
    try { downloadFile('mongvolam-editor-patch.json', json); } catch (e) { log('tải file patch lỗi: ' + (e && e.message)); }
    log('đã xuất patch: dời ' + patch.npcsMoved.length + ' NPC, thêm ' + patch.npcsAdded.length +
      ' NPC, ' + patch.propsAdded.length + ' prop -> localStorage ' + PATCH_KEY);
    toast('Đã xuất patch: dời ' + patch.npcsMoved.length + ' NPC, thêm ' + patch.npcsAdded.length +
      ' NPC, ' + patch.propsAdded.length + ' prop. Mở lại game là thấy!');
    return patch;
  }

  /* (b) Tải mongvolam.html đã sửa (build trong trình duyệt). */
  async function downloadPatchedHtml() {
    lastError = null;
    try {
      var scene = currentScene();
      var patch = null;
      if (originalWorld && scene) patch = diffPatch(originalWorld, scene);
      else {
        try {
          var raw = localStorage.getItem(PATCH_KEY);
          if (raw) patch = JSON.parse(raw);
        } catch (e) { patch = null; }
      }
      if (!patch) patch = { version: 1, npcsMoved: [], npcsAdded: [], propsAdded: [] };
      var template = await fetchText('src/index.template.html');
      var style = await fetchText('src/style.css');
      var three = await fetchText('lib/three.min.js');
      var pixi = await fetchText('lib/pixi.min.js');
      var fflate = await fetchText('lib/fflate.min.js');
      var fbxLoader = await fetchText('lib/FBXLoader.js');
      var parts = [];
      for (var i = 0; i < GAME_PARTS.length; i++) {
        parts.push({ name: GAME_PARTS[i], code: await fetchText('src/' + GAME_PARTS[i]) });
      }
      var built = buildPatchedHtml({ template: template, style: style, three: three, pixi: pixi, fflate: fflate, fbxLoader: fbxLoader, parts: parts }, patch);
      if (!built.ok) throw new Error(built.reason);
      downloadFile('mongvolam.html', built.html);
      log('đã tải mongvolam.html đã sửa (' + Math.round(built.html.length / 1024) + ' KB, patch nhúng: dời ' +
        patch.npcsMoved.length + ' NPC, thêm ' + patch.npcsAdded.length + ' NPC, ' + patch.propsAdded.length + ' prop).');
      toast('Đã tải mongvolam.html đã sửa — thay file cũ trên GitHub rồi mở lại game.');
      return { ok: true, bytes: built.html.length, patch: patch };
    } catch (e) {
      lastError = e && e.message;
      log('Tải mongvolam.html đã sửa thất bại: ' + lastError);
      toast('Không tải được mongvolam.html đã sửa: ' + lastError + ' Cần mở editor qua http(s) cùng thư mục game (GitHub Pages), không dùng file://.');
      return { ok: false, reason: lastError };
    }
  }

  /* Hướng dẫn ngắn gắn vào panel help của editor. */
  function helpHtml() {
    return 'Sửa -> Xuất patch -> mở lại game là thấy. ' +
      '1) Bấm "Load world từ game" (cần mở editor qua GitHub Pages, cùng thư mục game). ' +
      '2) Kéo NPC / thêm prop trong scene. ' +
      '3) Bấm "⬇️ Xuất patch cho game" — patch lưu vào localStorage, mở lại game là thấy ngay. ' +
      'Muốn file HTML mới: bấm "⬇️ Tải mongvolam.html đã sửa" rồi thay file cũ trên GitHub. ' +
      'Không load được world? Bấm "Load project mẫu" để sửa thử (patch mẫu vẫn xuất được).';
  }

  function attachHelp() {
    try {
      if (typeof document === 'undefined') return false;
      var el = document.querySelector('[data-editor-help]') || document.getElementById('editor-help');
      if (!el) return false;
      el.textContent = helpHtml();
      return true;
    } catch (e) { return false; }
  }

  var api = {
    PATCH_KEY: PATCH_KEY, PROP_TYPES: PROP_TYPES.slice(), GAME_PARTS: GAME_PARTS.slice(),
    parseWorldSource: parseWorldSource, parseNpcDefsSource: parseNpcDefsSource,
    sampleProject: sampleProject, buildProjectFromWorld: buildProjectFromWorld,
    diffPatch: diffPatch, buildPatchedHtml: buildPatchedHtml,
    loadWorldFromGame: loadWorldFromGame, loadSampleProject: loadSampleProject,
    exportPatch: exportPatch, downloadPatchedHtml: downloadPatchedHtml,
    helpHtml: helpHtml, attachHelp: attachHelp, currentScene: currentScene,
    getOriginalWorld: function () { return originalWorld; },
    getLastError: function () { return lastError; }
  };
  try { if (typeof window !== 'undefined') window.ED = ED; } catch (e) {}
  return api;
})();

if (typeof module !== 'undefined' && module.exports) { try { module.exports = ED.GameLink; } catch (e) {} }
