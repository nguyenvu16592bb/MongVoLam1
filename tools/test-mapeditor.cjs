/* Kiểm thử Map Editor (mapeditor.html) — patch game + GameLink + FBX thật.
   - (1) project JSON round-trip + (2) undo/redo: ED.Core (00-core.js).
   - (3) thêm/dời/xoá NPC: hàm thuần ED.NpcAi (08-npc-ai.js) + Core.
   - (7) terrain brush: hàm thuần ED.Terrain.brushHeights (04-terrain.js).
   - (4) validate FBX: HÀM THẬT ED.Character.validateFbxFile (07-character.js)
     + FBXSupport.validateFile (src/11-fbx.js — cùng hàm game dùng).
   - (5) parse THẬT fixture .fbx (THREE r128 + FBXLoader r128 + fflate thật).
   - (6) áp patch lên state game giả (src/13-editor-patch.js, hàm thuần).
   - GameLink (src/editor/10-game-link.js): parse world thật + diff + build HTML.
   Module nhóm khác nào chưa có thì SKIP ghi rõ lý do, KHÔNG bịa pass.
   Chạy: node tools/test-mapeditor.cjs
   In "N PASS, M SKIP, 0 FAIL" hoặc liệt kê fail; exit 1 nếu có fail. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f));

let pass = 0, fail = 0, skipped = 0;
const failedNames = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; failedNames.push(name); console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}
function skip(name, reason) {
  skipped++;
  console.log('SKIP ' + name + ' :: ' + reason);
}

/* Load 1 file JS vào vm context mới, trả context (không throw ra ngoài). */
function loadVm(file, extra) {
  const ctx = Object.assign({ console }, extra || {});
  ctx.window = ctx.window || {};
  ctx.ED = ctx.ED || {};
  vm.createContext(ctx);
  vm.runInContext(read(file), ctx, { filename: file });
  return ctx;
}

console.log('--- A. EditorPatch (src/13-editor-patch.js) ---');
let EP = null;
try {
  const ctx = loadVm('src/13-editor-patch.js', {});
  EP = ctx.EditorPatch || ctx.window.EditorPatch;
  check('13-editor-patch.js load duoc bang vm (khong can DOM/THREE)', !!EP);
} catch (e) {
  check('13-editor-patch.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (EP) {
  check('PATCH_KEY dung (mongvolam_editor_patch_v1)', EP.PATCH_KEY === 'mongvolam_editor_patch_v1');
  check('install() khong CharacterManager -> false, khong throw', EP.install() === false);
  check('info() tra duoc trang thai (applied=false khi chua co patch)', EP.info() && EP.info().applied === false);

  const p1 = EP.parsePatch('{"version":1,"npcsMoved":[{"id":"merchant","x":-4,"z":1}],"npcsAdded":[],"propsAdded":[]}');
  check('parsePatch JSON dung -> ok + giu npcsMoved', p1.ok && p1.patch && p1.patch.npcsMoved.length === 1 && p1.patch.npcsMoved[0].id === 'merchant');
  const p2 = EP.parsePatch('{json sai');
  check('parsePatch JSON sai -> ok=false, khong throw', p2.ok === false && p2.patch === null);
  check('parsePatch rong -> ok=false (khong-co-patch)', EP.parsePatch('').ok === false);
  check('parsePatch null -> ok=false', EP.parsePatch(null).ok === false);
  const p3 = EP.validatePatch({ version: 1, npcsMoved: [{ id: 'a', x: 1 }, { id: 'b', x: 1, z: 2 }], npcsAdded: [], propsAdded: [{ type: 'xe-tang', x: 0, z: 0 }, { type: 'tree', x: 3, z: 4 }] });
  check('validatePatch loai muc sai (thieu z / type la) + giu muc dung',
    p3.ok && p3.patch.npcsMoved.length === 1 && p3.patch.npcsMoved[0].id === 'b' && p3.patch.propsAdded.length === 1);
  const p4 = EP.validatePatch({ version: 1, npcsMoved: [], npcsAdded: [], propsAdded: [{ type: 'rock', x: 0, z: 0, scale: 99 }] });
  check('validatePatch kep scale prop ve <=3', p4.patch.propsAdded[0].scale === 3);

  function fakeState() {
    return {
      npcs: [
        { id: 'merchant', name: 'Chưởng Quầy', x: -5.2, z: -0.4, anchor: { x: -5.2, z: -0.4 } },
        { id: 'master', name: 'Võ Sư', x: 3.4, z: -3.8 }
      ],
      props: []
    };
  }
  const st1 = fakeState();
  const r1 = EP.applyToState(st1, { version: 1, npcsMoved: [{ id: 'merchant', x: -4, z: 1 }], npcsAdded: [], propsAdded: [] });
  check('applyToState: doi NPC ton tai doi x/z', st1.npcs[0].x === -4 && st1.npcs[0].z === 1 && r1.moved.indexOf('merchant') >= 0);
  check('applyToState: doi NPC cap nhat ca anchor', st1.npcs[0].anchor.x === -4 && st1.npcs[0].anchor.z === 1);
  const st2 = fakeState();
  const r2 = EP.applyToState(st2, { version: 1, npcsMoved: [{ id: 'khong-co', x: 0, z: 0 }], npcsAdded: [], propsAdded: [] });
  check('applyToState: id khong ton tai bi bo qua, khong crash, NPC cu nguyen ven',
    r2.skipped.join(' ').indexOf('khong-co') >= 0 && st2.npcs[0].x === -5.2 && st2.npcs.length === 2);
  const st3 = fakeState();
  const r3 = EP.applyToState(st3, {
    version: 1, npcsMoved: [],
    npcsAdded: [{ id: 'npc-moi', name: 'NPC Mới', x: 1, z: 2 }],
    propsAdded: [{ type: 'tree', x: 5, z: 6, rotY: 1, scale: 2 }]
  });
  check('applyToState: them NPC moi (co dialogue mac dinh)',
    st3.npcs.length === 3 && st3.npcs[2].id === 'npc-moi' && typeof st3.npcs[2].dialogue === 'string' && r3.addedNpcs.indexOf('npc-moi') >= 0);
  check('applyToState: them prop (giu rotY/scale)', st3.props.length === 1 && st3.props[0].type === 'tree' && st3.props[0].rotY === 1 && st3.props[0].scale === 2);
  const st4 = fakeState();
  const r4 = EP.applyToState(st4, { version: 1, npcsMoved: [], npcsAdded: [{ id: 'merchant', name: 'Trùng', x: 0, z: 0 }], propsAdded: [] });
  check('applyToState: them NPC trung id bi bo qua', r4.skipped.join(' ').indexOf('trung-id') >= 0 && st4.npcs.length === 2);
  const st5 = fakeState();
  const r5 = EP.applyToState(st5, { version: 1, npcsMoved: [], npcsAdded: [], propsAdded: [] });
  check('applyToState: patch rong khong doi gi', r5.moved.length === 0 && st5.npcs[0].x === -5.2 && st5.props.length === 0);
  check('applyToState: patch null khong crash', (function () { try { EP.applyToState(fakeState(), null); return true; } catch (e) { return false; } })());
  check('applyToState: state khong co npcs khong crash', (function () { try { EP.applyToState({}, { version: 1 }); return true; } catch (e) { return false; } })());
}

console.log('--- A2. EditorPatch live (boc initPopulation + applyLive that) ---');
try {
  const patchJson = JSON.stringify({
    version: 1,
    npcsMoved: [{ id: 'merchant', x: -4, z: 1 }],
    npcsAdded: [{ id: 'npc-moi', name: 'NPC Mới', x: 1, z: 2 }],
    propsAdded: [{ type: 'tree', x: 5, z: 6 }, { type: 'rock', x: 7, z: 8 }]
  });
  const lsStore = new Map([['mongvolam_editor_patch_v1', patchJson]]);
  const builtTrees = [];
  const addedMeshes = [];
  function mkMesh() {
    return {
      position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      castShadow: false
    };
  }
  const liveCtx = {
    console,
    window: {},
    localStorage: {
      getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => lsStore.set(k, String(v)),
      removeItem: k => lsStore.delete(k)
    },
    NPC_SCHEDULES: { merchant: { market: { x: -5.2, z: -0.4 }, tea: { x: -7, z: 0 } } },
    Engine: {
      buildTree(x, z) { builtTrees.push([x, z]); },
      scene: { add(m) { addedMeshes.push(m); } }
    },
    THREE: {
      MeshStandardMaterial: function () { return {}; },
      DodecahedronGeometry: function () { return {}; },
      Mesh: function (geo, mat) { const m = mkMesh(); m.geometry = geo; m.material = mat; return m; }
    }
  };
  liveCtx.CharacterManager = {
    entities: [],
    create(opt) {
      const ent = Object.assign({}, opt, { mesh: mkMesh() });
      ent.mesh.position.set(opt.x || 0, 0, opt.z || 0);
      this.entities.push(ent);
      return ent;
    },
    initPopulation() {
      this.entities.length = 0;
      this.create({ id: 'player', name: 'Người chơi', x: -0.2, z: 0.4, isPlayer: true });
      this.create({ id: 'merchant', name: 'Chưởng Quầy', x: -5.2, z: -0.4, isNpc: true, _anchor: { x: -5.2, z: -0.4 } });
      /* _anchor gan sau create (giong NpcAI._assign). */
      this.entities[1]._anchor = { x: -5.2, z: -0.4 };
    }
  };
  vm.createContext(liveCtx);
  vm.runInContext(read('src/13-editor-patch.js'), liveCtx, { filename: 'src/13-editor-patch.js' });
  const liveEP = liveCtx.window.EditorPatch;
  check('live: install() boc duoc initPopulation that', liveEP && liveEP.install() === true && liveEP.info().wrapped === true);
  liveCtx.CharacterManager.initPopulation(); /* ham goc chay + patch ap ngay sau */
  const ents = liveCtx.CharacterManager.entities;
  const merch = ents.filter(e => e.id === 'merchant')[0];
  check('live: initPopulation xong NPC doi dung vi tri patch', !!merch && merch.mesh.position.x === -4 && merch.mesh.position.z === 1);
  check('live: NPC co lich trinh duoc doi ca theo delta (market -5.2 -> -4)',
    Math.abs(liveCtx.NPC_SCHEDULES.merchant.market.x - (-4)) < 0.001 && Math.abs(liveCtx.NPC_SCHEDULES.merchant.tea.x - (-5.8)) < 0.001);
  check('live: NPC moi duoc tao bang CharacterManager.create',
    ents.filter(e => e.id === 'npc-moi').length === 1 && ents.filter(e => e.id === 'npc-moi')[0].isNpc === true);
  check('live: prop tree dung Engine.buildTree co san', builtTrees.length === 1 && builtTrees[0][0] === 5 && builtTrees[0][1] === 6);
  check('live: prop rock dung primitive khi khong co builder', addedMeshes.length === 1);
  const info = liveCtx.window.__mvlEditorPatchInfo();
  check('live: __mvlEditorPatchInfo() bao applied + source localStorage + moved/added',
    typeof liveCtx.window.__mvlEditorPatchInfo === 'function' && info.applied === true && info.source === 'localStorage' &&
    info.moved.indexOf('merchant') >= 0 && info.addedNpcs.indexOf('npc-moi') >= 0 && info.addedProps.length === 2,
    JSON.stringify(info));
  /* Patch id khong ton tai: khong crash, game van chay. */
  lsStore.set('mongvolam_editor_patch_v1', JSON.stringify({ version: 1, npcsMoved: [{ id: 'khong-co', x: 0, z: 0 }], npcsAdded: [], propsAdded: [] }));
  let noCrash = true;
  try { liveCtx.CharacterManager.initPopulation(); } catch (e) { noCrash = false; }
  const info2 = liveCtx.window.__mvlEditorPatchInfo();
  check('live: patch id la -> initPopulation van chay, applied=false, skipped ghi ro',
    noCrash && info2.applied === false && info2.skipped.join(' ').indexOf('khong-co') >= 0);
} catch (e) {
  check('live EditorPatch (boc initPopulation + applyLive)', false, e && e.message);
}

console.log('--- B. GameLink (src/editor/10-game-link.js) ---');
let GL = null;
try {
  const ctx = loadVm('src/editor/10-game-link.js', {});
  GL = (ctx.ED && ctx.ED.GameLink) || ctx.window.GameLink;
  check('10-game-link.js load duoc bang vm (khong can DOM/THREE)', !!GL);
} catch (e) {
  check('10-game-link.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
}
if (GL) {
  check('PATCH_KEY khop game (mongvolam_editor_patch_v1)', GL.PATCH_KEY === 'mongvolam_editor_patch_v1');
  const worldSrc = read('src/02-world.js');
  const w = GL.parseWorldSource(worldSrc);
  const ids = w.npcs.map(n => n.id);
  check('parseWorldSource: thay merchant/master/elder/recruiter/eventer',
    ['merchant', 'master', 'elder', 'recruiter', 'eventer'].every(id => ids.indexOf(id) >= 0), ids.join(','));
  check('parseWorldSource: spawn player (-0.2, 0.4)', !!w.spawn && w.spawn.x === -0.2 && w.spawn.z === 0.4, JSON.stringify(w.spawn));
  check('parseWorldSource: WATER_RECTS du 6 hinh', w.waterRects.length === 6, 'n=' + w.waterRects.length);
  check('parseWorldSource: WATER_RECTS[0] minX=24 (dong-bac)', w.waterRects[0] && w.waterRects[0].minX === 24 && w.waterRects[0].maxZ === -14, JSON.stringify(w.waterRects[0]));
  const defs = GL.parseNpcDefsSource(read('src/01-data.js'));
  const dids = defs.map(n => n.id);
  check('parseNpcDefsSource: thay smith/healer/storyteller/child1/child2/chessmaster/scenebuilder',
    ['smith', 'healer', 'storyteller', 'child1', 'child2', 'chessmaster', 'scenebuilder'].every(id => dids.indexOf(id) >= 0), dids.join(','));
  check('parseNpcDefsSource: smith dung vi tri (-9.8,-4.2)',
    (function () { const s = defs.filter(n => n.id === 'smith')[0]; return s && s.x === -9.8 && s.z === -4.2; })());
  const proj = GL.buildProjectFromWorld(w);
  check('buildProjectFromWorld: project version 1, co terrain + npcs',
    proj.version === 1 && Array.isArray(proj.terrain.heights) && proj.npcs.length === w.npcs.length - 1, 'npcs=' + proj.npcs.length);
  check('buildProjectFromWorld: moi WATER_RECT -> 1 object water',
    proj.objects.filter(o => o.type === 'water').length === w.waterRects.length);
  const sample = GL.sampleProject();
  check('sampleProject: schema v1, heights (32+1)^2 so, co 2 NPC',
    sample.version === 1 && sample.terrain.heights.length === 33 * 33 && sample.npcs.length === 2,
    'heights=' + sample.terrain.heights.length);
  const orig = { npcs: [{ id: 'merchant', x: -5.2, z: -0.4 }, { id: 'master', x: 3.4, z: -3.8 }] };
  const d1 = GL.diffPatch(orig, { npcs: [{ id: 'merchant', pos: [-4, 1] }, { id: 'master', pos: [3.4, -3.8] }], props: [] });
  check('diffPatch: NPC doi vi tri -> npcsMoved, NPC dung yen -> khong moved',
    d1.npcsMoved.length === 1 && d1.npcsMoved[0].id === 'merchant' && d1.npcsMoved[0].x === -4);
  const d2 = GL.diffPatch(orig, { npcs: [{ id: 'merchant', pos: [-5.2, -0.4] }, { id: 'npc-moi', name: 'Mới', pos: [1, 2] }], props: [{ type: 'tree', pos: [5, 0, 6], rot: [0, 1, 0], scale: [2, 2, 2] }] });
  check('diffPatch: NPC moi -> npcsAdded, prop moi -> propsAdded (giu rotY/scale)',
    d2.npcsAdded.length === 1 && d2.npcsAdded[0].id === 'npc-moi' && d2.propsAdded.length === 1 && d2.propsAdded[0].rotY === 1 && d2.propsAdded[0].scale === 2);
  check('diffPatch: doi <0.01 khong tinh la moved',
    GL.diffPatch(orig, { npcs: [{ id: 'merchant', pos: [-5.199, -0.4] }], props: [] }).npcsMoved.length === 0);
  check('diffPatch: prop type la bi loai',
    GL.diffPatch(orig, { npcs: [], props: [{ type: 'xe-tang', pos: [0, 0, 0] }] }).propsAdded.length === 0);
  const fakeParts = [
    { name: '01-data.js', code: '/*DATA*/' },
    { name: '13-editor-patch.js', code: '/*PATCH*/' },
    { name: '06-boot.js', code: '/*BOOT*/' }
  ];
  const fakeInputs = {
    template: '<html><head><style>__STYLE__</style></head><body><script>__THREE__</script><script>__PIXI__</script><script>__FFLATE__</script><script>__FBXLOADER__</script><script>__GAME__</script></body></html>',
    style: '/*CSS*/', three: '/*THREE*/', pixi: '/*PIXI*/', fflate: '/*FFLATE*/', fbxLoader: '/*FBX*/', parts: fakeParts
  };
  const patch = { version: 1, npcsMoved: [{ id: 'merchant', x: -4, z: 1 }], npcsAdded: [], propsAdded: [] };
  const built = GL.buildPatchedHtml(fakeInputs, patch);
  check('buildPatchedHtml: ok + chen EMBEDDED_PATCH dung JSON',
    built.ok && built.html.indexOf('var EMBEDDED_PATCH = {"version":1,"npcsMoved":[{"id":"merchant","x":-4,"z":1}]') >= 0);
  check('buildPatchedHtml: thu tu parts giu nguyen (patch truoc boot)',
    built.ok && built.html.indexOf('/*PATCH*/') < built.html.indexOf('/*BOOT*/'));
  check('buildPatchedHtml: thieu 13-editor-patch.js -> khong ok',
    GL.buildPatchedHtml(Object.assign({}, fakeInputs, { parts: [{ name: '01-data.js', code: '' }, { name: '06-boot.js', code: '' }] }), patch).ok === false);
  check('buildPatchedHtml: 13 sau boot -> khong ok',
    GL.buildPatchedHtml(Object.assign({}, fakeInputs, { parts: [{ name: '06-boot.js', code: '' }, { name: '13-editor-patch.js', code: '' }] }), patch).ok === false);
  check('buildPatchedHtml: template thieu placeholder -> khong ok',
    GL.buildPatchedHtml(Object.assign({}, fakeInputs, { template: '<html></html>' }), patch).ok === false);
  check('helpHtml: co huong dan "Sua -> Xuat patch -> mo lai game la thay"',
    GL.helpHtml().indexOf('Xuất patch') >= 0 && GL.helpHtml().indexOf('mở lại game') >= 0);
  const buildMjs = read('tools/build.mjs');
  check("build.mjs ghep '13-editor-patch.js' truoc '06-boot.js'",
    buildMjs.indexOf("'13-editor-patch.js'") >= 0 && buildMjs.indexOf("'13-editor-patch.js'") < buildMjs.indexOf("'06-boot.js'"));
  if (exists('mongvolam.html')) {
    const html = read('mongvolam.html');
    check('mongvolam.html da build chua EditorPatch + __mvlEditorPatchInfo',
      html.indexOf('EditorPatch') >= 0 && html.indexOf('__mvlEditorPatchInfo') >= 0);
    check('mongvolam.html da build chua EMBEDDED_PATCH hook (13-editor-patch.js duoc ghep)',
      html.indexOf('mongvolam_editor_patch_v1') >= 0);
  } else {
    skip('mongvolam.html da build chua EditorPatch', 'chua chay node tools/build.mjs');
  }
}

console.log('--- C. Module editor nhom khac (00-core / 04-terrain / 08-npc-ai / 07-character) ---');
/* (1) project round-trip + (2) undo/redo — ED.Core (00-core.js, nhom A).
   pushHistory() chup snapshot TRUOC thay doi (DESIGN.md) nen test phai goi
   pushHistory truoc addObject, dung nhu UI lam. */
if (!exists('src/editor/00-core.js')) {
  skip('(1) project JSON round-trip (new -> serialize -> load -> serialize giong het)', 'src/editor/00-core.js chua co (nhom A chua giao)');
  skip('(2) undo/redo (them -> undo mat -> redo co lai; undo het stack khong crash)', 'src/editor/00-core.js chua co (nhom A chua giao)');
} else {
  try {
    const ctx = loadVm('src/editor/00-core.js', {});
    const Core = ctx.ED && ctx.ED.Core;
    if (!Core || typeof Core.newProject !== 'function' || typeof Core.serialize !== 'function' || typeof Core.load !== 'function') {
      skip('(1) project JSON round-trip', '00-core.js co nhung thieu API newProject/serialize/load theo DESIGN.md');
      skip('(2) undo/redo', '00-core.js co nhung thieu API undo/redo theo DESIGN.md');
    } else {
      Core.newProject('test');
      const s1 = JSON.stringify(Core.serialize());
      Core.load(JSON.parse(s1));
      check('(1) project JSON round-trip (new -> serialize -> load -> serialize giong het)', JSON.stringify(Core.serialize()) === s1);
      const n0 = Core.listObjects().length;
      Core.pushHistory('them da test');
      const added = Core.addObject({ type: 'rock', name: 'Đá test', pos: [1, 0, 1] });
      const n1 = Core.listObjects().length;
      Core.undo();
      const n2 = Core.listObjects().length;
      Core.redo();
      const n3 = Core.listObjects().length;
      check('(2) undo/redo (them -> undo mat -> redo co lai)', n1 === n0 + 1 && n2 === n0 && n3 === n0 + 1 && !!added && !!added.id, n0 + '->' + n1 + '->' + n2 + '->' + n3);
      let okEmpty = true;
      try { for (let i = 0; i < 60; i++) Core.undo(); } catch (e) { okEmpty = false; }
      check('(2) undo khi het stack khong crash', okEmpty && Core.undo() === false);
    }
  } catch (e) {
    check('(1)/(2) core test', false, e && e.message);
  }
}
/* (3) them/doi/xoa NPC — ham thuan ED.NpcAi (08-npc-ai.js, nhom C) + Core. */
if (!exists('src/editor/08-npc-ai.js')) {
  skip('(3) them/doi/xoa NPC (qua ham thuan cua 08-npc-ai hoac Core)', 'src/editor/08-npc-ai.js chua co (nhom C chua giao)');
} else {
  try {
    const ctx = loadVm('src/editor/00-core.js', {});
    vm.runInContext(read('src/editor/08-npc-ai.js'), ctx, { filename: 'src/editor/08-npc-ai.js' });
    const Core = ctx.ED.Core;
    const NpcAi = ctx.ED.NpcAi;
    if (!NpcAi || typeof NpcAi.newNpc !== 'function' || typeof NpcAi.syncNpcObject !== 'function') {
      skip('(3) them/doi/xoa NPC', '08-npc-ai.js co nhung thieu newNpc/syncNpcObject theo DESIGN.md');
    } else {
      Core.newProject('test-npc');
      const npc = NpcAi.newNpc('npc-test');
      check('(3) newNpc tao NPC mac dinh (id/pos/ai)', npc.id === 'npc-test' && Array.isArray(npc.pos) && npc.pos[0] === 0 && typeof npc.ai === 'string');
      /* Dung CHUNG 1 project: Core.getProject() (NpcAi.project() tra local
         project rieng khi ED.Core.project khong phai object — khong tron 2 project). */
      const project = Core.getProject();
      project.npcs.push(npc);
      const obj = NpcAi.syncNpcObject(project, npc);
      check('(3) them NPC -> syncNpcObject tao object type npc trong project',
        !!obj && obj.type === 'npc' && obj.extra && obj.extra.npcId === 'npc-test' && project.objects.indexOf(obj) >= 0);
      npc.pos = [5, 6];
      const obj2 = NpcAi.syncNpcObject(project, npc);
      check('(3) doi NPC (pos [5,6]) -> object doi theo [5,0,6]', obj2 === obj && obj.pos[0] === 5 && obj.pos[2] === 6);
      NpcAi.addWaypoint(npc, 1, 2);
      check('(3) them waypoint -> patrol [[1,2]]', npc.patrol.length === 1 && npc.patrol[0][0] === 1 && npc.patrol[0][1] === 2);
      NpcAi.moveWaypoint(npc, 0, 3, 4);
      check('(3) doi waypoint -> patrol [[3,4]]', npc.patrol[0][0] === 3 && npc.patrol[0][1] === 4);
      NpcAi.removeWaypoint(npc, 0);
      check('(3) xoa waypoint -> patrol rong', npc.patrol.length === 0);
      const idx = project.npcs.indexOf(npc);
      if (idx >= 0) project.npcs.splice(idx, 1);
      const removed = Core.removeObject(obj.id);
      check('(3) xoa NPC -> het khoi npcs + objects', removed === true && project.npcs.length === 0 && !Core.getObject(obj.id));
    }
  } catch (e) {
    check('(3) them/doi/xoa NPC', false, e && e.message);
  }
}
/* (7) terrain brush — ham thuan ED.Terrain.brushHeights (04-terrain.js, nhom B).
   Flatten lay chieu cao muc tieu TAI TAM brush truoc khi sua: bump giua roi
   flatten tai tam se san phang vung quanh ve dung cao tam. */
if (!exists('src/editor/04-terrain.js')) {
  skip('(7) terrain brush (raise tang, lower giam, flatten ve dung gia tri)', 'src/editor/04-terrain.js chua co (nhom B chua giao)');
} else {
  try {
    const ctx = loadVm('src/editor/04-terrain.js', {});
    const T = ctx.ED && ctx.ED.Terrain;
    if (!T || typeof T.brushHeights !== 'function' || typeof T.makeHeights !== 'function' || typeof T.heightAtArray !== 'function') {
      skip('(7) terrain brush', '04-terrain.js co nhung thieu brushHeights/makeHeights/heightAtArray theo DESIGN.md');
    } else {
      let h = T.makeHeights();
      const nR = T.brushHeights(h, 0, 0, 'raise', 6, 0.5, 0.7);
      check('(7) terrain raise: tam tang len, co dinh doi', nR > 0 && T.heightAtArray(h, 0, 0) > 0, 'changed=' + nR + ' h(0,0)=' + T.heightAtArray(h, 0, 0));
      h = T.makeHeights();
      const nL = T.brushHeights(h, 0, 0, 'lower', 6, 0.5, 0.7);
      check('(7) terrain lower: tam giam xuong, co dinh doi', nL > 0 && T.heightAtArray(h, 0, 0) < 0, 'changed=' + nL + ' h(0,0)=' + T.heightAtArray(h, 0, 0));
      h = T.makeHeights();
      T.brushHeights(h, 0, 0, 'raise', 12, 1, 0.7);
      const centerBefore = T.heightAtArray(h, 0, 0);
      const edgeBefore = T.heightAtArray(h, 3, 0);
      /* falloff 0 = mep cung (f=1 khap vung) nen flatten strength 1 san phang
         hoan toan ve cao tam; falloff 0.7 chi san 1 phan o ria theo cong thuc. */
      T.brushHeights(h, 0, 0, 'flatten', 12, 1, 0);
      const centerAfter = T.heightAtArray(h, 0, 0);
      const edgeAfter = T.heightAtArray(h, 3, 0);
      check('(7) terrain flatten: vung quanh ve dung cao tam (sai so < 0.01)',
        edgeBefore < centerBefore - 0.05 && Math.abs(edgeAfter - centerAfter) < 0.01,
        'truoc: tam=' + centerBefore.toFixed(3) + ' ria=' + edgeBefore.toFixed(3) + ' sau: tam=' + centerAfter.toFixed(3) + ' ria=' + edgeAfter.toFixed(3));
      check('(7) terrain brush ngoai bien khong crash', (function () { try { T.brushHeights(T.makeHeights(), 999, 999, 'raise', 6, 0.5, 0.7); return true; } catch (e) { return false; } })());
    }
  } catch (e) {
    check('(7) terrain brush', false, e && e.message);
  }
}
/* (4) validate FBX qua 07-character.js (nhom C) — ham THAT ED.Character.validateFbxFile. */
if (!exists('src/editor/07-character.js')) {
  skip('(4) validate FBX qua 07-character.js', 'src/editor/07-character.js chua co (nhom C chua giao) — thay bang ham THAT FBXSupport.validateFile o muc D');
} else {
  try {
    const ctx = loadVm('src/editor/07-character.js', {});
    const Ch = ctx.ED && ctx.ED.Character;
    if (!Ch || typeof Ch.validateFbxFile !== 'function') {
      skip('(4) validate FBX qua 07-character.js', '07-character.js co nhung thieu validateFbxFile theo DESIGN.md');
    } else {
      check('(4) validate FBX qua 07-character: .fbx dung co -> ok', Ch.validateFbxFile({ name: 'hero.fbx', size: 1000 }).ok === true);
      check('(4) validate FBX qua 07-character: .FBX hoa -> ok', Ch.validateFbxFile({ name: 'hero.FBX', size: 1000 }).ok === true);
      check('(4) validate FBX qua 07-character: sai duoi .txt -> tu choi', Ch.validateFbxFile({ name: 'hero.txt', size: 1000 }).ok === false);
      check('(4) validate FBX qua 07-character: file rong -> tu choi', Ch.validateFbxFile({ name: 'hero.fbx', size: 0 }).ok === false);
      check('(4) validate FBX qua 07-character: >20MB -> tu choi', Ch.validateFbxFile({ name: 'hero.fbx', size: 21 * 1024 * 1024 }).ok === false);
      check('(4) validate FBX qua 07-character: khong co file -> tu choi', Ch.validateFbxFile(null).ok === false);
    }
  } catch (e) {
    check('(4) validate FBX qua 07-character.js', false, e && e.message);
  }
}

console.log('--- D. Validate FBX that (src/11-fbx.js — FBXSupport.validateFile) ---');
let FBX = null;
try {
  const ctx = loadVm('src/11-fbx.js', { window: {}, State: { flags: { fbx: { hero: null, props: [] } } }, SaveManager: { save() {} } });
  FBX = ctx.window.FBXSupport;
  check('11-fbx.js load duoc bang vm', !!FBX);
} catch (e) {
  check('11-fbx.js load duoc bang vm', false, e && e.message);
}
if (FBX) {
  check('(4) validate .fbx dung co -> ok', FBX.validateFile({ name: 'hero.fbx', size: 1000 }).ok === true);
  check('(4) validate .FBX hoa -> ok', FBX.validateFile({ name: 'hero.FBX', size: 1000 }).ok === true);
  check('(4) validate sai duoi .txt -> tu choi', FBX.validateFile({ name: 'hero.txt', size: 1000 }).ok === false);
  check('(4) validate file rong -> tu choi', FBX.validateFile({ name: 'hero.fbx', size: 0 }).ok === false);
  check('(4) validate >20MB -> tu choi', FBX.validateFile({ name: 'hero.fbx', size: 21 * 1024 * 1024 }).ok === false);
  check('(4) validate khong co file -> tu choi', FBX.validateFile(null).ok === false);
  check('(4) MAX_BYTES dung 20MB', FBX.MAX_BYTES === 20 * 1024 * 1024);
}

console.log('--- E. Parse that fixture .fbx (THREE + FBXLoader + fflate that) ---');
async function partE() {
  const fixture = path.resolve(root, '..', '.test-fbx', 'coco-Mixamo.fbx');
  const fallback = path.resolve(root, '..', '.test-fbx', 'XBot.fbx');
  const useFile = fs.existsSync(fixture) ? fixture : (fs.existsSync(fallback) ? fallback : null);
  if (!useFile) {
    skip('(5) parse that fixture .fbx (co mesh + verts > 0)', 'khong co fixture ~/workspace/.test-fbx/coco-Mixamo.fbx (chi dung fixture lam kiem tra, khong copy vao repo)');
    return;
  }
  const ctx = {
    console,
    window: { URL: { createObjectURL: () => 'blob:fake' } },
    document: {
      createElementNS: () => {
        const img = { addEventListener() {}, removeEventListener() {}, _src: '' };
        Object.defineProperty(img, 'src', { get() { return this._src; }, set(v) { this._src = v; } });
        return img;
      }
    },
    State: { flags: { fbx: { hero: null, props: [] } } },
    SaveManager: { save() {} }
  };
  ctx.self = ctx.window;
  vm.createContext(ctx);
  try {
    vm.runInContext(read('lib/three.min.js'), ctx, { filename: 'three.min.js' });
    vm.runInContext(read('lib/fflate.min.js'), ctx, { filename: 'fflate.min.js' });
    vm.runInContext(read('lib/FBXLoader.js'), ctx, { filename: 'FBXLoader.js' });
    vm.runInContext(read('src/11-fbx.js'), ctx, { filename: '11-fbx.js' });
  } catch (e) {
    check('(5) nap THREE/FBXLoader/fflate that', false, e && e.message);
    return;
  }
  const THREE2 = ctx.THREE;
  const FBX2 = ctx.window.FBXSupport;
  check('(5) THREE.FBXLoader that duoc nap (r128, tu lib/)', typeof THREE2 !== 'undefined' && typeof THREE2.FBXLoader === 'function');
  const buf = fs.readFileSync(useFile);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let parsed = null;
  try { parsed = FBX2.parseArrayBuffer(ab); }
  catch (e) { check('(5) parseArrayBuffer fixture that khong throw', false, e && e.message); return; }
  check('(5) parseArrayBuffer fixture that -> co group', !!parsed && !!parsed.group, path.basename(useFile));
  let meshes = 0, verts = 0;
  if (parsed && parsed.group) {
    parsed.group.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        meshes++;
        verts += o.geometry.attributes.position.count;
      }
    });
  }
  check('(5) group sau parse co mesh', meshes >= 1, 'meshes=' + meshes);
  check('(5) tong verts > 0', verts > 0, 'verts=' + verts);
  const box = new THREE2.Box3().setFromObject(parsed.group);
  const size = new THREE2.Vector3();
  box.getSize(size);
  check('(5) chuan hoa: cao dung 1.8', Math.abs(size.y - 1.8) < 0.001, 'h=' + size.y.toFixed(4));
}

partE().then(function () {
  console.log('----------------------------------------');
  console.log(pass + ' PASS, ' + skipped + ' SKIP, ' + fail + ' FAIL');
  if (failedNames.length) console.log('FAILED: ' + failedNames.join(' | '));
  process.exitCode = fail ? 1 : 0;
}).catch(function (e) {
  console.log('FAIL harness crash :: ' + (e && e.stack));
  process.exitCode = 1;
});
