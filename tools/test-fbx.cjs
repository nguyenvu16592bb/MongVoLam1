/* Kiểm thử FBX (BƯỚC 3) — nền tảng + registry + IndexedDB + parse thật.
   Nạp src/01-data.js + src/02-world.js + src/02b-env.js + src/11-fbx.js +
   src/12-fbx-ui.js vào vm với stub THREE (mẫu tools/test-fbx-ui.cjs) và
   IndexedDB + FileReader GIẢ (ghi đúng key, đọc lại được) để kiểm:
   - validateFile: .fbx/.FBX đúng cỡ thì ok; sai đuôi, rỗng, >20MB, không
     tên đều bị từ chối kèm lý do tiếng Việt.
   - Registry trong save: flags.fbx mặc định {hero:null, props:[]}; save cũ
     không có nhánh fbx vẫn load được; hero lạ về null; props không phải
     mảng về [].
   - IndexedDB: key hero là 'hero', key prop dạng 'prop:<id>'; save/clear/
     remove ghi/xóa đúng key; removeProp id lạ không lỗi.
   - Giới hạn 5: prop thứ 6 throw lỗi tiếng Việt, registry vẫn 5.
   - Gỡ hero về chibi: clearHero xóa flag + key IDB; loadHeroModel sau đó
     trả null; flag có mà file mất trong IDB thì throw tiếng Việt.
   - Đặt model chỉ ở điểm đi được: FbxUI.confirmPlace tại lòng hồ sen (0,8)
     bị từ chối, không lưu gì; điểm đi được thì cho đặt.
   - Parse THẬT (context vm riêng, THREE r128 + FBXLoader r128 + fflate
     0.6.9 thật từ lib/): parseArrayBuffer với fixture
     ~/.test-fbx/coco-Mixamo.fbx -> group 1 mesh, cao 1.8, center x/z = 0,
     minY = 0; parse rác throw lỗi tiếng Việt; loadHeroModel đọc đúng file
     hero trong IDB rồi parse ra model đã chuẩn hóa.
   Giới hạn: IndexedDB thật trên trình duyệt, file picker và render trên
   điện thoại KHÔNG kiểm được ở đây (chỉ kiểm key/logic qua IDB giả).
   Chạy: node tools/test-fbx.cjs */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const SAVE_KEY = 'mongvolam_soha_v1';

let pass = 0, fail = 0, skipped = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}
function skip(name, reason) {
  skipped++;
  console.log('SKIP ' + name + ' :: ' + reason);
}

/* ================= IndexedDB + FileReader GIẢ (dùng chung 2 context) =================
   Ghi đúng key vào Map, đọc lại được; log mọi put/get/del để assert key. */
function makeFakeIdb() {
  const store = new Map();
  const log = { put: [], get: [], del: [] };
  const idb = {
    _store: store, _log: log,
    open() {
      const req = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() {},
        transaction(_name, _mode) {
          let done = false;
          const tx = { oncomplete: null, onerror: null };
          const scheduleComplete = () => {
            if (done) return; done = true;
            setImmediate(() => { if (tx.oncomplete) tx.oncomplete(); });
          };
          tx.objectStore = () => ({
            put(rec) { store.set(rec.key, rec); log.put.push(rec.key); scheduleComplete(); return {}; },
            get(key) {
              log.get.push(key);
              const r = {};
              setImmediate(() => { r.result = store.has(key) ? store.get(key) : undefined; if (r.onsuccess) r.onsuccess(); });
              return r;
            },
            delete(key) { store.delete(key); log.del.push(key); scheduleComplete(); return {}; }
          });
          return tx;
        },
        close() {}
      };
      setImmediate(() => {
        req.result = db;
        if (req.onupgradeneeded) { try { req.onupgradeneeded(); } catch (e) {} }
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    }
  };
  return idb;
}
class FakeFileReader {
  constructor() { this.result = null; this.onload = null; this.onerror = null; }
  readAsArrayBuffer(file) {
    setImmediate(() => {
      if (file && file._buf) { this.result = file._buf; if (this.onload) this.onload(); }
      else if (this.onerror) this.onerror();
    });
  }
}
function fakeFile(name, size, buf) {
  return { name, size, _buf: buf || new ArrayBuffer(Math.max(1, Math.min(size || 1, 1024))) };
}

/* ================= PHẦN A: stub THREE + world thật + IDB giả ================= */
/* ---- stub THREE (mẫu tools/test-fbx-ui.cjs) ---- */
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
const document = {
  querySelector: s => (s === '#three-canvas' ? null : (els[s] || (els[s] = mkEl()))),
  querySelectorAll: () => [],
  getElementById: id => { if (!els[id]) els[id] = mkEl(); return els[id]; },
  createElement: () => mkEl(),
  body: { appendChild() {} }
};
const toasts = [];
const fakeIdbA = makeFakeIdb();
const sandbox = {
  console, Math, JSON, setTimeout: fn => { fn(); return 0; },
  THREE, localStorage, document, FileReader: FakeFileReader,
  performance: { now: () => 0 },
  window: {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 2, addEventListener() {},
    matchMedia: () => ({ matches: true }), indexedDB: fakeIdbA
  },
  navigator: { hardwareConcurrency: 8 },
  Game: { mode: 'world' },
  UI: { toast: m => toasts.push(String(m)), syncWorld() {}, openModal() {}, showScreen() {} },
  Sfx: { click() {}, coin() {}, ensure() {}, heal() {}, level() {}, win() {}, lose() {}, skill() {}, hit() {}, crit() {} }
};
vm.createContext(sandbox);
const srcA = read('src/01-data.js') + '\n' + read('src/02-world.js') + '\n' + read('src/02b-env.js') +
  '\n' + read('src/11-fbx.js') + '\n' + read('src/12-fbx-ui.js') +
  '\n;globalThis.__T = { Env, State, Engine, SaveManager, PlayerController, CharacterManager, World, UI, FBXSupport, HeroFBX, FbxProps, FbxUI };';
vm.runInContext(srcA, sandbox);
const T = sandbox.__T;
const { State, Engine, SaveManager, PlayerController, CharacterManager, FBXSupport, FbxUI } = T;
T.UI.toast = m => { toasts.push(String(m)); };
T.UI.syncWorld = () => {};
T.UI.openModal = () => {};
T.UI.showScreen = () => {};

Engine.createWorld();
CharacterManager.initPopulation();
const player = PlayerController.entity;

/* Đọc save đang lưu trong localStorage giả, sửa rồi ghi lại (để test load). */
function rewriteStoredSave(mut) {
  const d = JSON.parse(store.get(SAVE_KEY));
  mut(d);
  store.set(SAVE_KEY, JSON.stringify(d));
  return d;
}

async function partA() {
  console.log('--- A. validateFile ---');
  check('validate .fbx dung co -> ok', FBXSupport.validateFile({ name: 'hero.fbx', size: 12345 }).ok === true);
  check('validate .FBX hoa -> ok (khong phan biet hoa/thuong)',
    FBXSupport.validateFile({ name: 'hero.FBX', size: 12345 }).ok === true);
  check('validate dung 20MB -> ok',
    FBXSupport.validateFile({ name: 'a.fbx', size: 20 * 1024 * 1024 }).ok === true);
  let v = FBXSupport.validateFile({ name: 'hero.glb', size: 123 });
  check('validate .glb -> tu choi, ly do tieng Viet co ".fbx"', !v.ok && /\.fbx/.test(v.reason), JSON.stringify(v));
  v = FBXSupport.validateFile({ name: 'note.txt', size: 123 });
  check('validate .txt -> tu choi', !v.ok && /không phải định dạng \.fbx/.test(v.reason), JSON.stringify(v));
  v = FBXSupport.validateFile({ name: 'a.fbx', size: 0 });
  check('validate file rong 0 byte -> tu choi "rỗng"', !v.ok && /rỗng/.test(v.reason), JSON.stringify(v));
  v = FBXSupport.validateFile({ name: 'a.fbx', size: 20 * 1024 * 1024 + 1 });
  check('validate >20MB -> tu choi, ly do co "20 MB"', !v.ok && /20 MB/.test(v.reason), JSON.stringify(v));
  v = FBXSupport.validateFile({ size: 1000 });
  check('validate file khong co ten -> tu choi "Chưa chọn file"', !v.ok && /Chưa chọn file/.test(v.reason), JSON.stringify(v));
  v = FBXSupport.validateFile(null);
  check('validate null -> tu choi "Chưa chọn file"', !v.ok && /Chưa chọn file/.test(v.reason), JSON.stringify(v));
  v = FBXSupport.validateFile({ name: 'a.fbx' });
  check('validate thieu size -> tu choi "rỗng"', !v.ok && /rỗng/.test(v.reason), JSON.stringify(v));

  console.log('--- B. Registry trong save ---');
  check('flags.fbx mac dinh {hero:null, props:[]}',
    State.flags.fbx && State.flags.fbx.hero === null && Array.isArray(State.flags.fbx.props) && State.flags.fbx.props.length === 0);
  check('listProps() tra [] mac dinh', Array.isArray(FBXSupport.listProps()) && FBXSupport.listProps().length === 0);
  /* Save cũ không có nhánh fbx: ghi save hiện tại, xóa nhánh fbx khỏi JSON,
     reset State rồi load -> fbx giữ mặc định, các flag khác vẫn load đúng. */
  State.flags.fbx.hero = { key: 'hero', name: 'cu.fbx', size: 1, addedAt: 1 };
  State.flags.fbx.props = [{ id: 'old', key: 'prop:old', name: 'old.fbx' }];
  State.flags.npc.forgeCount = 2;
  SaveManager.save();
  rewriteStoredSave(d => { delete d.flags.fbx; });
  State.flags.fbx = { hero: null, props: [] };
  State.flags.npc.forgeCount = 0;
  SaveManager.load();
  check('save cu khong co fbx -> load duoc, fbx giu mac dinh',
    State.flags.fbx && State.flags.fbx.hero === null && Array.isArray(State.flags.fbx.props) && State.flags.fbx.props.length === 0,
    JSON.stringify(State.flags.fbx));
  check('save cu khong co fbx -> flag khac (npc.forgeCount=2) van load dung',
    State.flags.npc.forgeCount === 2, 'forgeCount=' + State.flags.npc.forgeCount);
  /* Hero lạ / props không phải mảng. */
  SaveManager.save();
  rewriteStoredSave(d => { d.flags.fbx = { hero: 'la', props: 'khong-phai-mang' }; });
  SaveManager.load();
  check('hero la (string) -> ve null', State.flags.fbx.hero === null, JSON.stringify(State.flags.fbx.hero));
  check('props khong phai mang -> ve []', Array.isArray(State.flags.fbx.props) && State.flags.fbx.props.length === 0,
    JSON.stringify(State.flags.fbx.props));
  SaveManager.save();
  rewriteStoredSave(d => { d.flags.fbx = { hero: { key: 'hero', name: 'h.fbx', size: 5, addedAt: 9 }, props: [{ id: 'p1', key: 'prop:p1' }] }; });
  SaveManager.load();
  check('hero hop le trong save -> giu nguyen ten file',
    State.flags.fbx.hero && State.flags.fbx.hero.name === 'h.fbx', JSON.stringify(State.flags.fbx.hero));
  check('props hop le trong save -> giu nguyen 1 entry',
    State.flags.fbx.props.length === 1 && State.flags.fbx.props[0].id === 'p1');
  State.flags.fbx = { hero: null, props: [] };

  console.log('--- C. IndexedDB: key hero / prop, ghi + xoa dung key ---');
  const idb = fakeIdbA;
  idb._log.put.length = 0; idb._log.get.length = 0; idb._log.del.length = 0;
  const heroRec = await FBXSupport.saveHeroFile(fakeFile('hero.fbx', 1000));
  check('saveHeroFile tra {name,size} dung', heroRec && heroRec.name === 'hero.fbx' && heroRec.size === 1000, JSON.stringify(heroRec));
  check("saveHeroFile ghi dung key 'hero' vao IndexedDB", idb._log.put.indexOf('hero') >= 0 && idb._store.has('hero'),
    'put=' + idb._log.put.join(','));
  check('saveHeroFile ghi flag hero key=hero', State.flags.fbx.hero && State.flags.fbx.hero.key === 'hero' && State.flags.fbx.hero.name === 'hero.fbx');
  const heroRec2 = await FBXSupport.saveHeroFile(fakeFile('hero2.fbx', 2000));
  check('saveHeroFile lan 2 ghi de: van 1 record hero, flag doi ten',
    heroRec2.name === 'hero2.fbx' && idb._store.get('hero').name === 'hero2.fbx' && State.flags.fbx.hero.name === 'hero2.fbx');
  const prop = await FBXSupport.savePropFile(fakeFile('cay.fbx', 2000), { type: 'decor', x: 1, z: 2 });
  check("savePropFile key dang 'prop:<id>'", /^prop:[a-z0-9]+$/.test(prop.key) && prop.key === 'prop:' + prop.id, prop.key);
  check('savePropFile ghi dung key prop vao IndexedDB', idb._log.put.indexOf(prop.key) >= 0 && idb._store.has(prop.key));
  check('savePropFile ghi registry dung x/z/type', State.flags.fbx.props.some(p => p.id === prop.id && p.x === 1 && p.z === 2 && p.type === 'decor'));
  const npcProp = await FBXSupport.savePropFile(fakeFile('npc.fbx', 3000), { type: 'npc', npcName: 'Ông Lão', x: -1, z: -2 });
  check("savePropFile type npc giu npcName", npcProp.type === 'npc' && npcProp.npcName === 'Ông Lão');
  let threw = '';
  try { await FBXSupport.savePropFile(fakeFile('x.fbx', 100), { type: 'la' }); } catch (e) { threw = e.message; }
  check('savePropFile type la -> throw tieng Viet (decor/npc)', /decor/.test(threw) && /npc/.test(threw), threw);
  threw = '';
  try { await FBXSupport.savePropFile(fakeFile('x.glb', 100), { type: 'decor' }); } catch (e) { threw = e.message; }
  check('savePropFile file .glb -> throw ly do validate', /\.fbx/.test(threw), threw);
  const delBefore = idb._log.del.length;
  await FBXSupport.removeProp(prop.id);
  check('removeProp xoa dung key prop khoi IndexedDB',
    idb._log.del.indexOf(prop.key) >= 0 && !idb._store.has(prop.key), 'del=' + idb._log.del.join(','));
  check('removeProp go khoi registry', !State.flags.fbx.props.some(p => p.id === prop.id));
  const regBefore = State.flags.fbx.props.length;
  const delCountBefore = idb._log.del.length;
  await FBXSupport.removeProp('khong-co');
  check('removeProp id la khong loi, registry + IDB khong doi',
    State.flags.fbx.props.length === regBefore && idb._log.del.length === delCountBefore);
  await FBXSupport.clearHero();
  check("clearHero xoa flag hero ve null", State.flags.fbx.hero === null);
  check("clearHero xoa dung key 'hero' khoi IndexedDB",
    idb._log.del.indexOf('hero') >= 0 && !idb._store.has('hero'));
  check('loadHeroModel sau khi xoa -> null (khong throw)',
    (await FBXSupport.loadHeroModel()) === null);
  State.flags.fbx.hero = { key: 'hero', name: 'mat-file.fbx', size: 1234, addedAt: 1 };
  threw = '';
  try { await FBXSupport.loadHeroModel(); } catch (e) { threw = e.message; }
  check('flag co ma file mat trong IDB -> throw tieng Viet, KHONG xoa flag',
    /Không tìm thấy file \.fbx nhân vật/.test(threw) && State.flags.fbx.hero && State.flags.fbx.hero.name === 'mat-file.fbx', threw);
  State.flags.fbx.hero = null;
  await FBXSupport.removeProp(npcProp.id);

  console.log('--- D. Gioi han 5 model ---');
  State.flags.fbx.props.length = 0;
  const putBefore = idb._log.put.length;
  for (let i = 0; i < 5; i++) {
    await FBXSupport.savePropFile(fakeFile('p' + i + '.fbx', 1000 + i), { type: 'decor', x: i, z: i });
  }
  check('luu du 5 prop -> registry co 5', State.flags.fbx.props.length === 5, 'n=' + State.flags.fbx.props.length);
  threw = '';
  try { await FBXSupport.savePropFile(fakeFile('p5.fbx', 1000), { type: 'decor', x: 9, z: 9 }); } catch (e) { threw = e.message; }
  check('prop thu 6 -> throw tieng Viet "Đã đủ tối đa 5"', /Đã đủ tối đa 5/.test(threw), threw);
  check('prop thu 6 bi chan -> registry van 5, khong ghi them IDB',
    State.flags.fbx.props.length === 5 && idb._log.put.length === putBefore + 5,
    'registry=' + State.flags.fbx.props.length + ' put=' + idb._log.put.length);
  for (const p of State.flags.fbx.props.slice()) await FBXSupport.removeProp(p.id);
  check('don sach sau test gioi han: registry ve 0', State.flags.fbx.props.length === 0);

  console.log('--- E. Dat model chi o diem di duoc (FbxUI.confirmPlace) ---');
  let saved = 0;
  const origSaveProp = FBXSupport.savePropFile;
  FBXSupport.savePropFile = () => { saved++; return Promise.resolve({ id: 'x', key: 'prop:x' }); };
  player.mesh.position.x = 0; player.mesh.position.z = 8;
  check('vi tri test (0,8) that su khong di duoc (long ho sen)', Engine.isWalkable(0, 8) === false);
  FbxUI._pendingFile = fakeFile('x.fbx', 1000);
  FbxUI._placeType = 'decor';
  toasts.length = 0;
  FbxUI.confirmPlace();
  check('long ho sen -> toast "Chỗ này không đặt được, hãy đứng chỗ khác" + khong luu gi',
    toasts.some(t => /Chỗ này không đặt được, hãy đứng chỗ khác/.test(t)) && saved === 0,
    'toast=' + toasts.join(' | ') + ' saved=' + saved);
  player.mesh.position.x = -0.2; player.mesh.position.z = 0.4;
  check('vi tri test (-0.2,0.4) di duoc that', Engine.isWalkable(-0.2, 0.4) === true);
  FbxUI._pendingFile = fakeFile('x.fbx', 1000);
  FbxUI._placeType = 'decor';
  toasts.length = 0;
  FbxUI.confirmPlace();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  check('diem di duoc -> goi savePropFile (cho dat)', saved === 1, 'saved=' + saved);
  FBXSupport.savePropFile = origSaveProp;

  console.log('--- F. Kiem tra tinh: build ghep FBX + lib co san ---');
  const buildMjs = read('tools/build.mjs');
  check("build.mjs ghep '11-fbx.js'", buildMjs.includes("'11-fbx.js'"));
  check("build.mjs ghep '12-fbx-ui.js'", buildMjs.includes("'12-fbx-ui.js'"));
  check('lib/FBXLoader.js ton tai', fs.existsSync(path.join(root, 'lib', 'FBXLoader.js')));
  check('lib/fflate.min.js ton tai (FBXLoader can giai nen)', fs.existsSync(path.join(root, 'lib', 'fflate.min.js')));
  check('src/11-fbx.js khong chua </script', !read('src/11-fbx.js').includes('</script'));
}

/* ================= PHẦN B: parse THẬT (THREE + FBXLoader + fflate thật) ================= */
async function partB() {
  console.log('--- G. Parse that file .fbx Mixamo ---');
  const fixture = path.resolve(root, '..', '.test-fbx', 'coco-Mixamo.fbx');
  if (!fs.existsSync(fixture)) {
    skip('parse fixture coco-Mixamo.fbx (1 mesh, cao 1.8, center x/z=0, minY=0)', 'khong co fixture ' + fixture + ' (chi dung fixture lam kiem tra, khong copy vao repo)');
    skip('loadHeroModel doc file hero that trong IDB roi parse', 'thieu fixture ' + fixture);
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
    }
  };
  ctx.self = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(read('lib/three.min.js'), ctx, { filename: 'three.min.js' });
  vm.runInContext(read('lib/fflate.min.js'), ctx, { filename: 'fflate.min.js' });
  vm.runInContext(read('lib/FBXLoader.js'), ctx, { filename: 'FBXLoader.js' });
  const fakeIdbB = makeFakeIdb();
  ctx.window.indexedDB = fakeIdbB;
  ctx.State = { flags: { fbx: { hero: null, props: [] } } };
  ctx.SaveManager = { save() {} };
  vm.runInContext(read('src/11-fbx.js'), ctx, { filename: '11-fbx.js' });
  const FBX2 = ctx.window.FBXSupport;
  const THREE2 = ctx.THREE;
  check('THREE.FBXLoader that duoc nap (r128, tu lib/)',
    typeof THREE2 !== 'undefined' && typeof THREE2.FBXLoader === 'function');

  const buf = fs.readFileSync(fixture);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let parsed;
  try {
    parsed = FBX2.parseArrayBuffer(ab);
  } catch (e) {
    check('parseArrayBuffer fixture that khong throw', false, e && e.message);
    return;
  }
  check('parseArrayBuffer fixture that -> co group', !!parsed && !!parsed.group);
  let meshes = 0;
  parsed.group.traverse(o => { if (o.isMesh || o.isSkinnedMesh) meshes++; });
  check('group sau parse co dung 1 mesh', meshes === 1, 'meshes=' + meshes);
  const box = new THREE2.Box3().setFromObject(parsed.group);
  const size = new THREE2.Vector3(); box.getSize(size);
  const center = new THREE2.Vector3(); box.getCenter(center);
  check('chuan hoa: cao dung 1.8', Math.abs(size.y - 1.8) < 0.001, 'h=' + size.y.toFixed(4));
  check('chuan hoa: center x = 0', Math.abs(center.x) < 0.001, 'cx=' + center.x.toFixed(4));
  check('chuan hoa: center z = 0', Math.abs(center.z) < 0.001, 'cz=' + center.z.toFixed(4));
  check('chuan hoa: minY = 0 (day cham dat)', Math.abs(box.min.y) < 0.001, 'minY=' + box.min.y.toFixed(4));
  check('parse tra animations la mang', Array.isArray(parsed.animations), 'anims=' + (parsed.animations && parsed.animations.length));

  let threw = '';
  try { FBX2.parseArrayBuffer(new ArrayBuffer(8)); } catch (e) { threw = e.message; }
  check('parse rac (8 byte) -> throw loi tieng Viet "Không đọc được file .fbx"',
    /Không đọc được file \.fbx/.test(threw), threw);
  threw = '';
  try { FBX2.parseArrayBuffer(null); } catch (e) { threw = e.message; }
  check('parse null -> throw "Dữ liệu file .fbx không hợp lệ."',
    /Dữ liệu file \.fbx không hợp lệ/.test(threw), threw);

  /* loadHeroModel end-to-end: file hero that trong IDB gia -> parse that. */
  fakeIdbB._store.set('hero', { key: 'hero', name: 'coco-Mixamo.fbx', size: buf.length, addedAt: 1, data: ab });
  ctx.State.flags.fbx.hero = { key: 'hero', name: 'coco-Mixamo.fbx', size: buf.length, addedAt: 1 };
  let heroParsed = null;
  try {
    heroParsed = await FBX2.loadHeroModel();
  } catch (e) {
    check('loadHeroModel doc file that trong IDB khong throw', false, e && e.message);
  }
  if (heroParsed) {
    const box2 = new THREE2.Box3().setFromObject(heroParsed.group);
    const size2 = new THREE2.Vector3(); box2.getSize(size2);
    check('loadHeroModel -> model da chuan hoa cao 1.8, minY 0',
      Math.abs(size2.y - 1.8) < 0.001 && Math.abs(box2.min.y) < 0.001,
      'h=' + size2.y.toFixed(4) + ' minY=' + box2.min.y.toFixed(4));
  }
  /* loadPropModel end-to-end voi cung fixture. */
  fakeIdbB._store.set('prop:px', { key: 'prop:px', name: 'coco-Mixamo.fbx', size: buf.length, addedAt: 1, data: ab });
  let propParsed = null;
  try {
    propParsed = await FBX2.loadPropModel({ id: 'px', key: 'prop:px', name: 'coco-Mixamo.fbx' });
  } catch (e) {
    check('loadPropModel doc file that trong IDB khong throw', false, e && e.message);
  }
  if (propParsed) {
    let m = 0;
    propParsed.group.traverse(o => { if (o.isMesh || o.isSkinnedMesh) m++; });
    check('loadPropModel -> parse duoc 1 mesh', m === 1, 'meshes=' + m);
  }
}

async function main() {
  await partA();
  await partB();
  console.log(`\n${pass} PASS, ${fail} FAIL` + (skipped ? `, ${skipped} SKIP` : ''));
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
