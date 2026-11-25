/* Kiểm thử FBX UI (BƯỚC 2) — không cần trình duyệt.
   Nạp src/01-data.js + src/02-world.js + src/02b-env.js + src/11-fbx.js +
   src/12-fbx-ui.js vào vm với stub THREE (mẫu tools/test-world.cjs), dựng
   world thật (Engine.createWorld + initPopulation, collider thật), rồi kiểm:
   - NPC Thợ Dựng Cảnh: có trong entities, đứng chỗ đi được thật, cách NPC
     gần nhất >= 2.5 ô, cách người chơi >= 2 ô; cây thoại scenebuilder có
     action 'fbx-builder'; action đó mở modal 'fbx-builder'.
   - HeroFBX.apply/restore: gắn model FBX vào đúng root nhân vật, chibi cũ
     chỉ ẩn (không xóa, trừ decal bóng sát đất), gỡ ra thì hiện lại chibi;
     có animation thì mixer chạy clip đầu (update(dt) tăng thời gian).
   - HeroFBX.restoreFromSave: chưa lưu thì im lặng; flag có mà file mất
     (không có IndexedDB) thì toast lỗi tiếng Việt, không xóa flag.
   - FbxProps: spawn NPC (bảng tên được tạo), rotate +45°, scale ×1.2/÷1.2
     kẹp 0.5–3, remove gỡ khỏi scene + registry.
   - FbxUI: đủ 5 prop thì chặn đặt; confirmPlace ở chỗ không đi được thì
     toast "Chỗ này không đặt được..." và không lưu gì; parse lỗi thì không
     lưu file hero.
   - Kiểm tra tĩnh: modal 'fbx-builder'/'fbx-place-form' + nút hero trong
     05-ui.js/04-info.js, '12-fbx-ui.js' trong build.mjs.
   Giới hạn: parse .fbx thật (FBXLoader/Box3), IndexedDB thật, file picker
   và render trên trình duyệt/điện thoại KHÔNG kiểm được ở đây.
   Chạy: node tools/test-fbx-ui.cjs */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}

/* ---- stub THREE (mẫu tools/test-world.cjs) + AnimationMixer giả ---- */
function mkRot() { return { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }; }
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  lerp(o, t) { this.x += (o.x - this.x) * t; this.y += (o.y - this.y) * t; this.z += (o.z - this.z) * t; return this; }
}
class V2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class Node {
  constructor() { this.position = new V3(); this.rotation = mkRot(); this.scale = new V3(1, 1, 1); this.children = []; }
  add(c) { this.children.push(c); return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
}
class Group extends Node {}
class Scene extends Node { constructor() { super(); this.background = null; this.fog = null; } }
class Mesh extends Node {
  constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; }
  clone() {
    const c = new Mesh(this.geometry, this.material);
    c.position = this.position.clone(); c.rotation = { ...this.rotation }; c.scale = this.scale.clone();
    c.castShadow = this.castShadow; c.receiveShadow = this.receiveShadow;
    return c;
  }
}
class InstancedMesh extends Mesh {
  constructor(geo, mat, count) { super(geo, mat); this.count = count; this.instanceMatrix = { needsUpdate: false }; }
  setMatrixAt() {}
}
class Points extends Node { constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; this.visible = true; } }
class BufferGeometry {
  constructor() { this.attributes = {}; }
  setAttribute(n, a) { this.attributes[n] = a; }
  setDrawRange() {}
}
class BufferAttribute { constructor(arr, size) { this.array = arr; this.itemSize = size; } }
const geo = t => class { constructor(...a) { this.type = t; this.args = a; } };
class Mat { constructor(p = {}) { Object.assign(this, p); } }
class CanvasTexture { constructor(c) { this.canvas = c; this.wrapS = null; this.wrapT = null; this.repeat = { set() {} }; } }
class Color { constructor(c) { this.c = c; } set(v) { this.c = v; return this; } }
class FogExp2 { constructor(c, d) { this.color = new Color(c); this.density = d; } }
class OrthoCam extends Node {
  constructor(l, r, t, b, n, f) { super(); this.left = l; this.right = r; this.top = t; this.bottom = b; this.near = n; this.far = f; }
  lookAt() {} updateProjectionMatrix() {}
}
class Light extends Node {
  constructor(c, i) { super(); this.color = new Color(c); this.intensity = i; this.shadow = { mapSize: {}, camera: {} }; }
}
class HemiLight extends Light {}
class DirLight extends Light {}
class PointLight extends Light { constructor(c, i, d) { super(c, i); this.distance = d; } }
class Raycaster { constructor() { this.ray = { intersectPlane: () => null }; } setFromCamera() {} }
class PlaneObj { constructor(v, c) { this.normal = v; this.constant = c; } }
class Object3D extends Node { updateMatrix() {} }
class AnimationMixer {
  constructor(g) { this.group = g; this.updated = 0; this.played = []; }
  clipAction(clip) { const self = this; return { play() { self.played.push(clip); return this; } }; }
  update(dt) { this.updated += dt; }
}
const THREE = {
  Vector3: V3, Vector2: V2, Group, Scene, Mesh, InstancedMesh, Points,
  BufferGeometry, BufferAttribute, Object3D, AnimationMixer,
  BoxGeometry: geo('Box'), PlaneGeometry: geo('Plane'), CylinderGeometry: geo('Cylinder'),
  ConeGeometry: geo('Cone'), SphereGeometry: geo('Sphere'), RingGeometry: geo('Ring'),
  CircleGeometry: geo('Circle'), DodecahedronGeometry: geo('Dodecahedron'),
  TorusGeometry: geo('Torus'),
  MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, PointsMaterial: Mat,
  CanvasTexture, Color, FogExp2, OrthographicCamera: OrthoCam,
  HemisphereLight: HemiLight, DirectionalLight: DirLight, PointLight,
  Raycaster, Plane: PlaneObj
};

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
function mkEl() {
  return {
    textContent: '', innerHTML: '', style: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {},
    getContext: () => ({
      fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {},
      moveTo() {}, lineTo() {}, stroke() {}, measureText: () => ({ width: 100 }),
      createLinearGradient: () => ({ addColorStop() {} })
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
  };
}
const els = {};
let nameplateAppends = 0;
const nameplatesEl = mkEl();
nameplatesEl.appendChild = () => { nameplateAppends++; };
const document = {
  querySelector: s => (s === '#three-canvas' ? null : (els[s] || (els[s] = mkEl()))),
  querySelectorAll: () => [],
  getElementById: id => {
    if (id === 'nameplates') return nameplatesEl;
    if (!els[id]) els[id] = mkEl();
    return els[id];
  },
  createElement: () => mkEl(),
  body: { appendChild() {} }
};
const toasts = [];
const openedModals = [];
const sandbox = {
  console, Math, JSON, setTimeout: fn => { fn(); return 0; },
  THREE, localStorage, document, performance: { now: () => 0 },
  window: {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, addEventListener() {},
    matchMedia: () => ({ matches: true })
  },
  navigator: { hardwareConcurrency: 8 },
  Game: { mode: 'world' },
  UI: { toast: m => toasts.push(String(m)), syncWorld() {}, openModal() {}, showScreen() {} },
  Sfx: { click() {}, coin() {}, ensure() {}, heal() {}, level() {}, win() {}, lose() {}, skill() {}, hit() {}, crit() {} }
};
vm.createContext(sandbox);
const src = read('src/01-data.js') + '\n' + read('src/02-world.js') + '\n' + read('src/02b-env.js') +
  '\n' + read('src/11-fbx.js') + '\n' + read('src/12-fbx-ui.js') +
  '\n;globalThis.__T = { Env, State, Engine, SaveManager, PlayerController, CharacterManager, World, UI, FBXSupport, HeroFBX, FbxProps, FbxUI, DIALOGUE_TREES, SCENE_BUILDER_NPC_DEF, NPC_NEW_DEFS, CHESS_NPC_DEF };';
vm.runInContext(src, sandbox);
const T = sandbox.__T;
const { Env, State, Engine, SaveManager, PlayerController, CharacterManager, World, UI, FBXSupport, HeroFBX, FbxProps, FbxUI, DIALOGUE_TREES, SCENE_BUILDER_NPC_DEF } = T;
/* UI thật trong 01-data.js che stub sandbox: ghi đè để harness bắt được. */
UI.toast = m => { toasts.push(String(m)); };
UI.syncWorld = () => {};
UI.openModal = (kind, data) => { openedModals.push(kind); };
UI.showScreen = () => {};

/* ---- dựng world thật (collider thật từ buildTown + Env.buildExpansion) ---- */
Engine.createWorld();
CharacterManager.initPopulation();
const player = PlayerController.entity;

async function main() {
  /* ---------- NPC Thợ Dựng Cảnh ---------- */
  const sb = CharacterManager.entities.find(e => e.id === 'scenebuilder');
  check('NPC Tho Dung Canh co trong world', !!sb && sb.isNpc);
  check('NPC Tho Dung Canh dung cho da dinh (-6.5, 3)', sb && sb.mesh.position.x === -6.5 && sb.mesh.position.z === 3);
  check('cho NPC dung di duoc that (isWalkable + collider that)', sb && Engine.isWalkable(-6.5, 3));
  let minNpc = Infinity, minPlayer = Infinity;
  CharacterManager.entities.forEach(e => {
    if (!e || e.id === 'scenebuilder' || !e.mesh) return;
    const d = Math.hypot(e.mesh.position.x + 6.5, e.mesh.position.z - 3);
    if (e.isNpc && d < minNpc) minNpc = d;
  });
  check('cach NPC gan nhat >= 2.5 o', minNpc >= 2.5, 'min=' + minNpc.toFixed(2));
  if (player) minPlayer = Math.hypot(player.mesh.position.x + 6.5, player.mesh.position.z - 3);
  check('cach nguoi choi >= 2 o', minPlayer >= 2, 'd=' + minPlayer.toFixed(2));
  check('def NPC khong nam trong NPC_NEW_DEFS (khong pha dem 5 NPC)', !T.NPC_NEW_DEFS.some(d => d.id === 'scenebuilder'));
  check('cay thoai scenebuilder co action fbx-builder',
    !!(DIALOGUE_TREES.scenebuilder && DIALOGUE_TREES.scenebuilder.start &&
      DIALOGUE_TREES.scenebuilder.start.options.some(o => o.action === 'fbx-builder')));
  openedModals.length = 0;
  World._runDialogueAction('fbx-builder', sb);
  check('action fbx-builder mo modal fbx-builder', openedModals.indexOf('fbx-builder') >= 0, openedModals.join(','));

  /* ---------- HeroFBX: gắn / gỡ model ---------- */
  const root = player.mesh;
  const chibiCount = root.children.length;
  const parsed0 = { group: new THREE.Group(), animations: [] };
  check('apply model khong animation -> true', HeroFBX.apply(parsed0) === true);
  check('model FBX la con cua root nhan vat', root.children.indexOf(parsed0.group) >= 0);
  check('chibi cu chi AN (khong xoa): so con tang 1', root.children.length === chibiCount + 1, 'truoc=' + chibiCount + ' sau=' + root.children.length);
  check('chibi an dung 7 phan (body/belt/tay/dau/toc/bui), decal bong giu nguyen',
    HeroFBX._hidden.length === 7 && HeroFBX._hidden.every(c => c.visible === false) &&
    root.children.some(c => c.visible !== false && c.position.y < 0.2),
    'hidden=' + HeroFBX._hidden.length);
  check('khong animation -> khong mixer', HeroFBX.mixer === null);
  const clip = { name: 'walk' };
  const parsed1 = { group: new THREE.Group(), animations: [clip] };
  check('apply model co animation -> true', HeroFBX.apply(parsed1) === true);
  check('mixer phat clip dau tien', HeroFBX.mixer && HeroFBX.mixer.played.length === 1 && HeroFBX.mixer.played[0] === clip);
  HeroFBX.update(0.016);
  check('mixer.update(dt) chay trong game loop', HeroFBX.mixer && Math.abs(HeroFBX.mixer.updated - 0.016) < 1e-9, 'updated=' + (HeroFBX.mixer && HeroFBX.mixer.updated));
  check('apply model moi go model cu (chi 1 group FBX tren root)',
    root.children.filter(c => c === parsed0.group).length === 0 && root.children.filter(c => c === parsed1.group).length === 1);
  HeroFBX.restore();
  check('restore: go model, hien lai chibi', root.children.indexOf(parsed1.group) < 0 &&
    HeroFBX._hidden.length === 0 && root.children.every(c => c.visible !== false) && HeroFBX.mixer === null);
  check('restore goi 2 lan van an toan', HeroFBX.restore() === true);

  /* ---------- restoreFromSave: chưa lưu / file mất ---------- */
  toasts.length = 0;
  HeroFBX.restoreFromSave();
  await Promise.resolve();
  check('chua luu hero -> restoreFromSave im lang, khong toast', toasts.length === 0 && HeroFBX.group === null, toasts.join(' | '));
  State.flags.fbx.hero = { key: 'hero', name: 'mat-file.fbx', size: 1234, addedAt: 1 };
  toasts.length = 0;
  HeroFBX.restoreFromSave();
  await new Promise(r => setImmediate(r));
  check('flag co ma file mat (khong IndexedDB) -> toast loi tieng Viet, giu chibi, KHONG xoa flag',
    toasts.some(t => /Không nạp được mô hình .fbx nhân vật/.test(t)) && HeroFBX.group === null &&
    State.flags.fbx.hero && State.flags.fbx.hero.name === 'mat-file.fbx', toasts.join(' | '));
  State.flags.fbx.hero = null;

  /* ---------- FbxProps: spawn / xoay / scale / xoa ---------- */
  const origLoad = FBXSupport.loadPropModel;
  FBXSupport.loadPropModel = () => Promise.resolve({ group: new THREE.Group(), animations: [] });
  const beforeAppends = nameplateAppends;
  const prop = { id: 't1', key: 'prop:t1', name: 'test.fbx', type: 'npc', npcName: 'NPC Test', x: -6, z: 2, rotY: 0, scale: 1 };
  State.flags.fbx.props.push(prop);
  await FbxProps.spawn(prop);
  check('spawn NPC prop: co trong _live, dung x/z', !!(FbxProps._live.t1 && FbxProps._live.t1.wrap.position.x === -6 && FbxProps._live.t1.wrap.position.z === 2));
  check('spawn NPC prop: co bang ten (append vao #nameplates)', nameplateAppends > beforeAppends, 'appends=' + nameplateAppends);
  check('spawn decor: khong bang ten', await (async () => {
    const d = { id: 't2', key: 'prop:t2', name: 'decor.fbx', type: 'decor', npcName: '', x: -5, z: 2, rotY: 0, scale: 1 };
    State.flags.fbx.props.push(d);
    await FbxProps.spawn(d);
    return FbxProps._live.t2 && FbxProps._live.t2.el === null;
  })());
  check('rotate +45 do, ghi registry + wrap', FbxProps.rotate('t1') === true &&
    Math.abs(prop.rotY - Math.PI / 4) < 1e-9 && Math.abs(FbxProps._live.t1.wrap.rotation.y - Math.PI / 4) < 1e-9);
  let r = FbxProps.scaleBy('t1', 1);
  check('scale To x1.2', r && Math.abs(r.scale - 1.2) < 1e-9 && Math.abs(FbxProps._live.t1.wrap.scale.x - 1.2) < 1e-9, JSON.stringify(r));
  r = FbxProps.scaleBy('t1', -1);
  check('scale Nho /1.2 ve 1.0', r && Math.abs(r.scale - 1.0) < 1e-9, JSON.stringify(r));
  for (let i = 0; i < 10; i++) FbxProps.scaleBy('t1', 1);
  check('scale kep tran 3x', prop.scale === 3, 'scale=' + prop.scale);
  for (let i = 0; i < 20; i++) FbxProps.scaleBy('t1', -1);
  check('scale kep san 0.5x', prop.scale === 0.5, 'scale=' + prop.scale);
  check('clampScale(99)=3, clampScale(0)=0.5, clampScale(NaN)=1',
    FbxProps.clampScale(99) === 3 && FbxProps.clampScale(0) === 0.5 && FbxProps.clampScale(NaN) === 1);
  await FbxProps.remove('t1');
  check('remove: go khoi scene + registry', !FbxProps._live.t1 && !State.flags.fbx.props.some(p => p.id === 't1'));
  await FbxProps.remove('t2');
  FBXSupport.loadPropModel = origLoad;

  /* ---------- FbxUI: gioi han 5 + cho khong dat duoc + parse loi ---------- */
  State.flags.fbx.props.length = 0;
  for (let i = 0; i < 5; i++) State.flags.fbx.props.push({ id: 'f' + i, key: 'prop:f' + i, name: 'f' + i + '.fbx', type: 'decor', x: 0, z: 0, rotY: 0, scale: 1 });
  toasts.length = 0;
  FbxUI.startPlace();
  check('du 5 prop -> chan dat, toast tieng Viet', toasts.some(t => /Đã đủ tối đa 5 mô hình/.test(t)), toasts.join(' | '));
  State.flags.fbx.props.length = 0;
  /* confirmPlace: dung cho khong di duoc (long ho sen) -> khong luu gi */
  let saved = 0;
  const origSaveProp = FBXSupport.savePropFile;
  FBXSupport.savePropFile = () => { saved++; return Promise.resolve({ id: 'x' }); };
  player.mesh.position.x = 0; player.mesh.position.z = 8; /* long ho sen: z>6.5, x<3.2 */
  check('vi tri test (0,8) that su khong di duoc', Engine.isWalkable(0, 8) === false);
  FbxUI._pendingFile = { name: 'x.fbx', size: 1000 };
  FbxUI._placeType = 'decor';
  toasts.length = 0;
  FbxUI.confirmPlace();
  check('cho khong dat duoc -> toast "Chỗ này không đặt được, hãy đứng chỗ khác" + khong luu',
    toasts.some(t => /Chỗ này không đặt được, hãy đứng chỗ khác/.test(t)) && saved === 0, toasts.join(' | '));
  player.mesh.position.x = -0.2; player.mesh.position.z = 0.4;
  FbxUI._pendingFile = { name: 'x.fbx', size: 1000 };
  toasts.length = 0;
  await FbxUI.confirmPlace();
  await new Promise(r => setImmediate(r));
  check('cho di duoc -> goi savePropFile', saved === 1, 'saved=' + saved);
  FBXSupport.savePropFile = origSaveProp;
  /* importHeroFile: parse loi (khong co FBXLoader trong stub) -> khong luu file */
  let heroSaved = 0;
  const origSaveHero = FBXSupport.saveHeroFile;
  FBXSupport.saveHeroFile = () => { heroSaved++; return Promise.resolve({}); };
  toasts.length = 0;
  FbxUI.importHeroFile({ name: 'hero.fbx', size: 1000, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  check('parse loi -> toast loi, KHONG luu file hero', heroSaved === 0 && toasts.length > 0, 'saved=' + heroSaved + ' toast=' + toasts.join(' | '));
  FBXSupport.saveHeroFile = origSaveHero;

  /* ---------- kiểm tra tĩnh: modal + nút + build ---------- */
  const ui05 = read('src/05-ui.js');
  const info04 = read('src/04-info.js');
  const buildMjs = read('tools/build.mjs');
  const fbxUi12 = read('src/12-fbx-ui.js');
  check('05-ui.js co modal fbx-builder', ui05.includes("kind === 'fbx-builder'"));
  check('05-ui.js co modal fbx-place-form', ui05.includes("kind === 'fbx-place-form'"));
  check('05-ui.js co nut hero trong Cai dat + action fbx-hero-pick/clear',
    ui05.includes('fbx-hero-pick') && ui05.includes('fbx-hero-clear') && ui05.includes("case 'fbx-hero-pick'"));
  check('05-ui.js boot goi restoreFromSave + restoreAll', ui05.includes('HeroFBX.restoreFromSave()') && ui05.includes('FbxProps.restoreAll()'));
  check('05-ui.js World.update goi HeroFBX.update (trong 02-world.js)', read('src/02-world.js').includes('HeroFBX.update(dt)'));
  check('04-info.js co nut nhap hero + nut ve chibi + syncFbxHero',
    info04.includes('fbx-hero-pick') && info04.includes('Về chibi mặc định') && info04.includes('syncFbxHero()'));
  check('build.mjs ghep 12-fbx-ui.js', buildMjs.includes("'12-fbx-ui.js'"));
  check('12-fbx-ui.js khong chua </script', !fbxUi12.includes('</script'));
  check('UI ghi gioi han "trong tran van dung chibi"', info04.includes('trong trận vẫn dùng chibi') && ui05.includes('trong trận vẫn dùng chibi'));

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
