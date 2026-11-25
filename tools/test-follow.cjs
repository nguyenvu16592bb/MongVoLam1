/* Kiểm thử bạn đồng hành đi theo (Nhiệm vụ 5) — không cần trình duyệt.
   Nạp src/01-data.js + src/02-world.js vào vm với stub THREE/document/
   localStorage tối thiểu, rồi kiểm tra logic thuần + follower 3D:
   chọn/đổi/bỏ pet (kể cả bán pet đang theo), tự chọn pet đầu tiên,
   đệ tử đội trưởng đi theo + đổi đội trưởng, di chuyển lerp/dịch chuyển,
   follower không phải NPC/không bị NpcAI kéo đi, tạo lại sau khi
   initPopulation xóa entities, save/load (kể cả save cũ không có activePet).
   Chạy: node tools/test-follow.cjs (sau node tools/build.mjs). */
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

/* ---- stub tối thiểu ---- */
function mkVec(x, y, z) {
  const v = {
    x: x || 0, y: y || 0, z: z || 0,
    set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; },
    clone() { return mkVec(this.x, this.y, this.z); },
    project() { return this; },
    lerp(o, t) { this.x += (o.x - this.x) * t; this.y += (o.y - this.y) * t; this.z += (o.z - this.z) * t; return this; }
  };
  return v;
}
function mkObj3() {
  return {
    position: mkVec(), rotation: mkVec(),
    scale: { x: 1, y: 1, z: 1, set(a, b, c) { this.x = a; this.y = b; this.z = c; } },
    children: [],
    add(c) { this.children.push(c); return this; },
    clone() { return mkObj3(); },
    castShadow: false
  };
}
class Vector3 {
  constructor(x, y, z) { return mkVec(x, y, z); }
}
const THREE = new Proxy({}, {
  get: (t, k) => {
    if (k === 'Vector3') return Vector3;
    if (k === 'Raycaster') return class { constructor() { this.ray = { intersectPlane: () => null }; } setFromCamera() {} };
    return function () { return mkObj3(); };
  }
});
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
function mkEl() {
  return {
    textContent: '', innerHTML: '', style: {}, children: [],
    classList: {
      _on: false,
      add(c) { if (c === 'on') this._on = true; },
      remove(c) { if (c === 'on') this._on = false; },
      contains(c) { return c === 'on' ? this._on : false; }
    },
    setAttribute() {},
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    addEventListener() {},
    getContext: () => ({
      fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {},
      moveTo() {}, lineTo() {}, stroke() {},
      createLinearGradient: () => ({ addColorStop() {} })
    })
  };
}
const nameplatesHost = mkEl();
const els = {};
const document = {
  querySelector: sel => {
    if (sel === '#nameplates') return nameplatesHost;
    return null;
  },
  querySelectorAll: () => [],
  getElementById: id => { if (!els[id]) els[id] = mkEl(); return els[id]; },
  createElement: () => mkEl(),
  body: {}
};
const toasts = [];
const sandbox = {
  console, Math, JSON, performance, setTimeout, clearTimeout,
  THREE, localStorage, document, location: { href: '' },
  window: { innerWidth: 800, innerHeight: 600, addEventListener() {} },
  Game: { mode: 'world' },
  UI: {
    toast: (msg) => { toasts.push(String(msg)); },
    syncWorld() {}, openModal() {}, showScreen() {}
  },
  Sfx: { click() {}, coin() {}, ensure() {}, heal() {}, level() {}, win() {}, lose() {}, skill() {}, hit() {}, crit() {} }
};
vm.createContext(sandbox);
const src = read('src/01-data.js') + '\n' + read('src/02-world.js') +
  '\n;globalThis.__T = { State, SaveManager, FollowPets, FOLLOW_PET_DEFS, PET_DEFS, heroById, HERO_DEFS, CharacterManager, Engine, PlayerController, World, Followers, NpcAI, UI };';
vm.runInContext(src, sandbox);
const T_ = sandbox.__T;
const { State, SaveManager, FollowPets, FOLLOW_PET_DEFS, heroById, CharacterManager, Engine, PlayerController, World, Followers, NpcAI, UI } = T_;
/* UI thật định nghĩa trong 01-data.js (che stub sandbox): ghi đè toast/sync
   để harness bắt được thông báo (theo mẫu tools/test-npc.cjs). */
UI.toast = (msg) => { toasts.push(String(msg)); };
UI.syncWorld = () => {};
UI.openModal = () => {};
UI.showScreen = () => {};

/* Scene + camera stub (CharacterManager.create cần Engine.scene.add). */
const sceneStub = {
  children: [],
  add(o) { this.children.push(o); },
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); }
};
Engine.scene = sceneStub;
Engine.camera = { position: mkVec(16, 18, 16), lookAt() {} };

/* Player thật (dùng CharacterManager.create như game). */
const player = CharacterManager.create({
  id: 'player', name: 'Song Ma Quyền Phái', x: 0, z: 0,
  robe: '#3b2f2f', belt: '#38bdf8', hair: '#dbeafe', isPlayer: true
});
PlayerController.entity = player;
player.mesh.rotation.y = 0;

function petItem(name, icon) {
  return { id: 'i' + name.length + Math.floor(Math.random() * 999), name, icon: icon || '🥚', type: 'Thú cưng', desc: 'pet test', qty: 1 };
}
function countFollowers(id) {
  return CharacterManager.entities.filter(e => e.id === id).length;
}

/* ---- 1. FOLLOW_PET_DEFS: đủ 3 pet, id giữ nguyên tc01–tc03 ---- */
check('du 3 pet di theo, id tc01-tc03', FOLLOW_PET_DEFS.length === 3 &&
  FOLLOW_PET_DEFS.map(d => d.id).join(',') === 'tc01,tc02,tc03',
  FOLLOW_PET_DEFS.map(d => d.id).join(','));
check('moi pet du field shopName/name/icon/color/hair (CSS hex)',
  FOLLOW_PET_DEFS.every(d => d.shopName && d.name && d.icon && /^#[0-9a-f]{6}$/i.test(d.color) && /^#[0-9a-f]{6}$/i.test(d.hair)),
  JSON.stringify(FOLLOW_PET_DEFS));
check('ten shop khop Shop tc01-tc03',
  FOLLOW_PET_DEFS[0].shopName === 'Trứng Hỏa Kỳ Lân' && FOLLOW_PET_DEFS[1].shopName === 'Trứng Thần Điêu' &&
  FOLLOW_PET_DEFS[2].shopName === 'Tiểu Bạch Hồ');

/* ---- 2. Nhận diện pet theo tên túi đồ ---- */
check('defForItem nhan dung 3 pet theo ten',
  FollowPets.defForItem({ name: 'Trứng Hỏa Kỳ Lân' }).id === 'tc01' &&
  FollowPets.defForItem({ name: 'Trứng Thần Điêu' }).id === 'tc02' &&
  FollowPets.defForItem({ name: 'Tiểu Bạch Hồ' }).id === 'tc03');
check('defForItem tra null cho do khong phai pet',
  FollowPets.defForItem({ name: 'Kim Sáng Dược' }) === null &&
  FollowPets.defForItem({ name: 'Thức Ăn Linh Thú' }) === null &&
  FollowPets.defForItem({ name: 'Mồi Câu' }) === null &&
  FollowPets.defForItem(null) === null && FollowPets.defForItem({}) === null);
check('defForId tra null cho id la', FollowPets.defForId('tc99') === null && FollowPets.defForId(null) === null);

/* ---- 3. Chọn/đổi/bỏ pet (logic thuần) ---- */
State.inventory = [];
State.activePet = null;
check('chua co pet: owned rong, ensureDefault false',
  FollowPets.ownedPetIds().length === 0 && FollowPets.ensureDefault() === false && State.activePet === null);
State.inventory.push(petItem('Tiểu Bạch Hồ', '🦊'));
check('co 1 pet trong tui -> owned [tc03]',
  JSON.stringify(FollowPets.ownedPetIds()) === JSON.stringify(['tc03']));
check('chua chon con nao -> tu chon con dau tien trong tui',
  FollowPets.ensureDefault() === true && State.activePet === 'tc03');
check('ensureDefault lan 2 khong doi (da co pet dang theo)',
  FollowPets.ensureDefault() === false && State.activePet === 'tc03');
check('setActive pet chua so huu bi tu choi',
  FollowPets.setActive('tc01') === false && State.activePet === 'tc03');
State.inventory.push(petItem('Trứng Hỏa Kỳ Lân', '🥚'));
check('doi pet sang tc01 khi da so huu', FollowPets.setActive('tc01') === true && State.activePet === 'tc01');
check('toggle pet dang theo -> thoi di theo', FollowPets.toggle('tc01') === true && State.activePet === null);
check('toggle pet chua theo -> chon theo', FollowPets.toggle('tc03') === true && State.activePet === 'tc03');
check('toggle pet khong co trong tui bi tu choi',
  FollowPets.toggle('tc02') === false && State.activePet === 'tc03');

/* ---- 4. Bán pet đang theo -> bỏ theo ---- */
State.activePet = 'tc03';
State.inventory = State.inventory.filter(i => i.name !== 'Tiểu Bạch Hồ');
check('ban pet dang theo -> clearIfSold true + activePet null',
  FollowPets.clearIfSold() === true && State.activePet === null);
check('clearIfSold khi khong co pet dang theo -> false', FollowPets.clearIfSold() === false);
check('ban pet khong theo thi khong anh huong pet dang theo',
  (() => {
    State.inventory.push(petItem('Tiểu Bạch Hồ', '🦊'));
    State.activePet = 'tc03';
    State.inventory = State.inventory.filter(i => i.name !== 'Trứng Hỏa Kỳ Lân');
    return FollowPets.clearIfSold() === false && State.activePet === 'tc03';
  })());

/* ---- 5. Save/load: activePet bền vững + save cũ ---- */
State.inventory = [petItem('Trứng Thần Điêu', '🥚')];
State.activePet = 'tc02';
State.leader = 0;
SaveManager.save();
const savedRaw = JSON.parse(store.get('mongvolam_soha_v1'));
check('save() ghi activePet vao save', savedRaw.activePet === 'tc02', 'activePet=' + savedRaw.activePet);
State.inventory = [];
State.activePet = null;
SaveManager.load();
check('load khoi phuc activePet + inventory',
  State.activePet === 'tc02' && State.inventory.some(i => i.name === 'Trứng Thần Điêu'),
  'activePet=' + State.activePet + ' inv=' + JSON.stringify(State.inventory.map(i => i.name)));
const rawOld = JSON.parse(store.get('mongvolam_soha_v1'));
delete rawOld.activePet;
store.set('mongvolam_soha_v1', JSON.stringify(rawOld));
State.activePet = 'tc02';
let threw = null;
try { SaveManager.load(); } catch (e) { threw = e; }
check('save cu khong co activePet van load duoc, activePet null',
  threw === null && State.activePet === null, threw && threw.message);
const rawSold = JSON.parse(store.get('mongvolam_soha_v1'));
rawSold.activePet = 'tc01';
rawSold.inventory = [petItem('Tiểu Bạch Hồ', '🦊')];
store.set('mongvolam_soha_v1', JSON.stringify(rawSold));
SaveManager.load();
check('save luu pet da ban (khong con trong tui) -> load ve null, khong crash',
  State.activePet === null, 'activePet=' + State.activePet);
const rawLeader = JSON.parse(store.get('mongvolam_soha_v1'));
rawLeader.leader = 99;
store.set('mongvolam_soha_v1', JSON.stringify(rawLeader));
SaveManager.load();
check('leader index qua lon khi load duoc clamp ve cuoi doi hinh',
  State.leader === State.heroes.length - 1, 'leader=' + State.leader + ' len=' + State.heroes.length);
State.leader = 0;

/* ---- 6. Follower pet spawn: tự chọn, chibi nhỏ, đúng tên/màu ---- */
State.inventory = [petItem('Tiểu Bạch Hồ', '🦊')];
State.activePet = null;
toasts.length = 0;
Followers.update(0.1, 1);
check('co pet trong tui + chua chon -> tu chon + spawn follower pet',
  State.activePet === 'tc03' && Followers.pet && Followers.pet.petId === 'tc03',
  'activePet=' + State.activePet);
const petEnt = Followers.pet.ent;
check('pet follower la chibi nho scale 0.55, ten + mau dung',
  petEnt.mesh.scale.x === 0.55 && petEnt.name === 'Tiểu Bạch Hồ' && petEnt.robe === '#f8fafc',
  'scale=' + petEnt.mesh.scale.x + ' name=' + petEnt.name + ' robe=' + petEnt.robe);
check('pet follower khong phai NPC (isNpc falsy, isFollower true)',
  !petEnt.isNpc && petEnt.isFollower === true);
check('pet follower co trong CharacterManager.entities, chi 1 con',
  CharacterManager.entities.indexOf(petEnt) >= 0 && countFollowers('follower-pet') === 1);

/* ---- 7. Đệ tử đội trưởng đi theo: đúng người + đúng màu ---- */
check('leader mac dinh (det) spawn follower leader dung ten/mau ao',
  Followers.leader && Followers.leader.heroId === 'det' &&
  Followers.leader.ent.name === 'Đế Thích Thiên' && Followers.leader.ent.robe === '#991b1b',
  JSON.stringify(Followers.leader && { heroId: Followers.leader.heroId, name: Followers.leader.ent.name, robe: Followers.leader.ent.robe }));
check('leader follower khong phai NPC + scale 0.9',
  !Followers.leader.ent.isNpc && Followers.leader.ent.isFollower === true && Followers.leader.ent.mesh.scale.x === 0.9);
State.leader = 1;
Followers.update(0.1, 1.1);
check('doi doi truong trong Ho so -> follower doi theo (tieu)',
  Followers.leader.heroId === 'tieu' && Followers.leader.ent.name === 'Tùy Tiêu Sầu' &&
  Followers.leader.ent.robe === '#1e293b' && Followers.leader.ent.hair === '#e2e8f0',
  JSON.stringify({ heroId: Followers.leader.heroId, name: Followers.leader.ent.name }));
check('doi leader khong tao trung lap (chi 1 follower-leader)',
  countFollowers('follower-leader') === 1);
State.leader = 0;
Followers.update(0.1, 1.2);
check('doi lai leader 0 -> follower tro ve det',
  Followers.leader.heroId === 'det' && Followers.leader.ent.name === 'Đế Thích Thiên');

/* ---- 8. Đổi pet -> đổi con đi theo, không trùng lặp, không rò mesh ---- */
const sceneBefore = sceneStub.children.length;
State.inventory.push(petItem('Trứng Hỏa Kỳ Lân', '🥚'));
FollowPets.setActive('tc01');
Followers.update(0.1, 1.3);
check('doi pet sang tc01 -> follower doi dung ten/mau',
  Followers.pet.petId === 'tc01' && Followers.pet.ent.name === 'Hỏa Kỳ Lân' && Followers.pet.ent.robe === '#ea580c',
  JSON.stringify({ petId: Followers.pet.petId, name: Followers.pet.ent.name }));
check('doi pet khong tao trung lap + khong ro mesh trong scene',
  countFollowers('follower-pet') === 1 && sceneStub.children.length === sceneBefore,
  'petCount=' + countFollowers('follower-pet') + ' scene=' + sceneStub.children.length + ' truoc=' + sceneBefore);

/* ---- 9. Di chuyển: lerp về sau lưng player, xa >12 thì dịch chuyển ---- */
player.mesh.position.set(0, 0, 0);
player.mesh.rotation.y = 0;
const petPos = Followers.pet.ent.mesh.position;
petPos.set(5, 0, 5);
const dBefore = Math.hypot(petPos.x - 0.5, petPos.z - (-1.2));
Followers.update(0.1, 1.4);
const dAfter = Math.hypot(petPos.x - 0.5, petPos.z - (-1.2));
check('pet lerp ve diem sau lung player (0.5,-1.2): khoang cach giam',
  dAfter < dBefore, 'truoc=' + dBefore.toFixed(2) + ' sau=' + dAfter.toFixed(2));
petPos.set(20, 0, 0);
Followers.update(0.1, 1.5);
check('pet cach player >12 -> dich chuyen tuc thoi toi gan player',
  Math.abs(petPos.x - 0.5) < 0.01 && Math.abs(petPos.z - (-1.2)) < 0.01,
  'pos=' + petPos.x.toFixed(2) + ',' + petPos.z.toFixed(2));
/* Đội trưởng đi cạnh bên phải (~1.05, -0.2): chạy nhiều frame cho hội tụ. */
Followers.leader.ent.mesh.position.set(6, 0, 6);
for (let i = 0; i < 30; i++) Followers.update(0.1, 1.6 + i * 0.1);
const lp = Followers.leader.ent.mesh.position;
check('doi truong hoi tu ve ben phai player (~1.05,-0.2)',
  Math.abs(lp.x - 1.05) < 0.15 && Math.abs(lp.z - (-0.2)) < 0.15,
  'pos=' + lp.x.toFixed(2) + ',' + lp.z.toFixed(2));
check('follower quay cung huong player',
  Followers.pet.ent.mesh.rotation.y === player.mesh.rotation.y &&
  Followers.leader.ent.mesh.rotation.y === player.mesh.rotation.y);

/* ---- 10. Bán pet đang theo (trong lúc chơi) -> đổi/bỏ theo + toast ---- */
/* Còn pet khác trong túi: bán con đang theo thì tự chuyển sang con còn lại. */
toasts.length = 0;
State.inventory = State.inventory.filter(i => i.name !== 'Trứng Hỏa Kỳ Lân');
Followers.update(0.1, 5);
check('ban pet dang theo, con pet khac -> tu chuyen sang pet con lai (tc03)',
  State.activePet === 'tc03' && Followers.pet && Followers.pet.petId === 'tc03' && countFollowers('follower-pet') === 1,
  'activePet=' + State.activePet + ' pet=' + (Followers.pet && Followers.pet.petId));
check('ban pet dang theo -> toast bao 1 lan', toasts.some(t => /đã bán/.test(t)), toasts.join(' | '));
/* Bán nốt con cuối cùng: bỏ theo hẳn, không spawn lại. */
State.inventory = [];
Followers.update(0.1, 5.1);
check('ban het pet -> activePet null + follower pet bien mat',
  State.activePet === null && Followers.pet === null && countFollowers('follower-pet') === 0,
  'activePet=' + State.activePet + ' pet=' + Followers.pet);
check('het pet trong tui -> khong spawn pet moi', Followers.pet === null && countFollowers('follower-pet') === 0);

/* ---- 11. Follower không phải NPC, không bị NpcAI kéo đi ---- */
State.inventory = [petItem('Tiểu Bạch Hồ', '🦊')];
Followers.update(0.1, 6);
check('npcNear bo qua follower (khong mo thoai khi cham vao)',
  CharacterManager.npcNear(0, 0, 5) === null);
const fPet = Followers.pet.ent;
const px0 = fPet.mesh.position.x, pz0 = fPet.mesh.position.z;
NpcAI.updateEntity(fPet, 1, 8);
check('NpcAI khong di chuyen follower (khong lang thang)',
  fPet.mesh.position.x === px0 && fPet.mesh.position.z === pz0,
  'truoc=(' + px0 + ',' + pz0 + ') sau=(' + fPet.mesh.position.x + ',' + fPet.mesh.position.z + ')');
/* Nameplate follower luôn hiện (không bị luật ẩn tên khi xa >8.5). */
Followers.update(0.1, 6.1);
CharacterManager.update(0.1, 6.1);
check('nameplate follower khong bi an (opacity khong bi set 0)',
  fPet.el.style.opacity !== '0' && Followers.leader.ent.el.style.opacity !== '0',
  'petOpacity=' + fPet.el.style.opacity);

/* ---- 12. initPopulation xóa entities -> follower tạo lại, không trùng ---- */
const sceneCountBefore = sceneStub.children.length;
CharacterManager.entities.length = 0; /* mô phỏng initPopulation() */
Followers.update(0.1, 7);
check('sau khi entities bi xoa: pet + leader tao lai day du',
  Followers.pet && Followers.pet.petId === 'tc03' && Followers.leader && Followers.leader.heroId === 'det',
  'pet=' + (Followers.pet && Followers.pet.petId) + ' leader=' + (Followers.leader && Followers.leader.heroId));
check('sau khi tao lai: khong trung lap, khong ro mesh cu trong scene',
  countFollowers('follower-pet') === 1 && countFollowers('follower-leader') === 1 &&
  sceneStub.children.length === sceneCountBefore,
  'pet=' + countFollowers('follower-pet') + ' leader=' + countFollowers('follower-leader') +
  ' scene=' + sceneStub.children.length + ' truoc=' + sceneCountBefore);
CharacterManager.entities.push(player); /* player cũng bị xóa khỏi mảng trong mô phỏng */

/* ---- 13. Móc World.update + chỉ chạy ở mode world ---- */
let threwWorld = null;
try { World.update(0.1, 8); } catch (e) { threwWorld = e; }
check('World.update chay khong loi + follower van ton tai',
  threwWorld === null && Followers.pet && Followers.leader, threwWorld && threwWorld.message);
sandbox.Game.mode = 'battle';
const petEntBefore = Followers.pet.ent;
Followers.update(0.1, 9);
check('mode battle -> Followers.update khong doi follower',
  Followers.pet.ent === petEntBefore);
sandbox.Game.mode = 'world';
Followers.update(0.1, 9.1);
check('ve mode world -> follower lai cap nhat binh thuong', Followers.pet && Followers.leader);

/* ---- 14. Nối UI + build: nút pet trong túi đồ, dispatch, build chứa code ---- */
const ui05 = read('src/05-ui.js');
check("05-ui co dispatch pet-follow", ui05.includes("case 'pet-follow'"), 'thieu dispatch');
check('05-ui modal bag co nut Cho di theo / Thoi di theo theo FollowPets',
  ui05.includes('FollowPets.defForItem') && ui05.includes('Cho đi theo') && ui05.includes('Thôi đi theo') &&
  ui05.includes('pet-follow-btn'), 'thieu nut pet trong bag');
check('05-ui modal bag co nhan Dang theo', ui05.includes('Đang theo'));
const w02 = read('src/02-world.js');
check('02-world co moc Followers.update trong World.update',
  w02.includes('Followers.update(dt, time)'), 'thieu moc');
check('02-world follower khong bi NpcAI lang thang (guard isFollower)',
  w02.includes('e.isFollower'), 'thieu guard');
const built = read('mongvolam.html');
check('mongvolam.html build chua FOLLOW_PET_DEFS + Followers',
  built.includes('FOLLOW_PET_DEFS') && built.includes('Followers'), 'build chua?');
check('khong co chuoi dong script trong src da sua',
  !read('src/01-data.js').includes('</script') && !read('src/02-world.js').includes('</script') &&
  !read('src/05-ui.js').includes('</script'));

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
