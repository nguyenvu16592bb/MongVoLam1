/* Kiểm thử NPC thông minh (Nhiệm vụ 3) — không cần trình duyệt.
   Nạp src/01-data.js + src/02-world.js vào vm với stub THREE/document/
   localStorage tối thiểu, rồi kiểm tra logic thuần: lịch trình theo giờ,
   cây thoại (rẽ nhánh/điều kiện/action), dân thường đi lại, NPC mới +
   dịch vụ rèn/chữa, thú cưng, save/load (kể cả save cũ không có flags.npc).
   Chạy: node tools/test-npc.cjs (sau node tools/build.mjs). */
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

/* ---- stub tối thiểu (theo tools/test-env.cjs) ---- */
class T { constructor() { this.x = 0; this.y = 0; this.z = 0; } }
const THREE = new Proxy({}, { get: () => T });
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
function mkEl() {
  return {
    textContent: '', innerHTML: '', style: {},
    classList: {
      _on: false,
      add(c) { if (c === 'on') this._on = true; },
      remove(c) { if (c === 'on') this._on = false; },
      contains(c) { return c === 'on' ? this._on : false; }
    },
    setAttribute() {}, appendChild() {}, addEventListener() {},
    getContext: () => ({
      fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {},
      moveTo() {}, lineTo() {}, stroke() {},
      createLinearGradient: () => ({ addColorStop() {} })
    })
  };
}
const dlgEl = mkEl();
const els = {};
const document = {
  querySelector: sel => {
    if (sel === '#dialogue') return dlgEl;
    if (sel === '#nameplates') return mkEl();
    return null;
  },
  querySelectorAll: () => [],
  getElementById: id => { if (!els[id]) els[id] = mkEl(); return els[id]; },
  createElement: () => mkEl(),
  body: {}
};
const openedModals = [];
const infoOpened = [];
const toasts = [];
const locationStub = { href: '' };
const sandbox = {
  console, Math, JSON, performance,
  setTimeout: fn => { fn(); return 0; },
  THREE, localStorage, document, location: locationStub,
  window: {}, Game: { mode: 'world' },
  Info: { open(i) { infoOpened.push(i); } }
};
vm.createContext(sandbox);
const src = read('src/01-data.js') + '\n' + read('src/02-world.js') +
  '\n;globalThis.__T = { State, Engine, SaveManager, CharacterManager, World, NpcAI, NpcService, UI, NPC_SCHEDULES, NPC_NEW_DEFS, PET_DEFS, NPC_LORE, DIALOGUE_TREES, scheduleShiftForHour, scheduleSpotFor, dialogueCondMet, dialogueCondText };';
vm.runInContext(src, sandbox);
const T_ = sandbox.__T;
const { State, Engine, SaveManager, CharacterManager, World, NpcAI, NpcService, UI, NPC_SCHEDULES, NPC_NEW_DEFS, PET_DEFS, NPC_LORE, DIALOGUE_TREES, scheduleShiftForHour, scheduleSpotFor, dialogueCondMet, dialogueCondText } = T_;
UI.toast = (msg, type) => { toasts.push(String(msg)); };
UI.openModal = (kind, data) => { openedModals.push(kind); };
UI.syncWorld = () => {};

/* Collider thật trong game (lầu/sạp/đài/bảng/cây/nhà/bù nhìn) — NPC mới và
   điểm lịch trình phải đứng ngoài mọi hình này (harness không buildTown nên
   Engine.colliders đang rỗng, kiểm tra thêm bằng danh sách này). */
const RECTS = [
  [-8.5, 8.2, -14.5, -5.3], [-8.9, -2.3, -5.6, -1.1], [-13.6, -10.4, -8.4, -6.8], [-10.2, -7, 4.3, 4.9]
];
[[-14.5, -8.5], [12.5, -10.5], [-14.8, 3.5], [-38, -4], [-40, 14], [-24, -32], [6, -34], [22, -30], [26, 20], [42, -4], [-12, 38], [16, 36]]
  .forEach(p => RECTS.push([p[0] - .8, p[0] + .8, p[1] - .8, p[1] + .8]));
[[-14, -26], [-2, -30], [12, -24], [28, -6], [38, 14]]
  .forEach(p => RECTS.push([p[0] - 2.2, p[0] + 2.2, p[1] - 1.9, p[1] + 1.9]));
[[-30, 8], [8, 32]].forEach(p => RECTS.push([p[0] - .4, p[0] + .4, p[1] - .4, p[1] + .4]));
const outsideRects = (x, z) => RECTS.every(r => !(x > r[0] && x < r[1] && z > r[2] && z < r[3]));
const walkableReal = (x, z) => Engine.isWalkable(x, z) && outsideRects(x, z);

/* ---- 1. Lịch trình: ca theo giờ ---- */
check('ca 8h = market (cho)', scheduleShiftForHour(8).shift === 'market');
check('ca 12h = tea (quan tra)', scheduleShiftForHour(12).shift === 'tea');
check('ca 16h = plaza (quang truong)', scheduleShiftForHour(16).shift === 'plaza');
check('ca 20h = home (ve nha)', scheduleShiftForHour(20).shift === 'home');
check('ca 2h = home (dem)', scheduleShiftForHour(2).shift === 'home');
check('ca 5h59 = home, 6h = market', scheduleShiftForHour(5.9).shift === 'home' && scheduleShiftForHour(6).shift === 'market');
check('ca 11h = tea, 14h = plaza, 18h = home',
  scheduleShiftForHour(11).shift === 'tea' && scheduleShiftForHour(14).shift === 'plaza' && scheduleShiftForHour(18).shift === 'home');
check('NPC khong co lich -> null', scheduleSpotFor('khong-co', 8) === null);
check('du 5 NPC chinh co lich', Object.keys(NPC_SCHEDULES).length === 5 &&
  ['merchant', 'master', 'elder', 'recruiter', 'eventer'].every(id => !!NPC_SCHEDULES[id]));

/* ---- 2. Lịch trình: vị trí đúng khu ở 8h/12h/20h + đi được thật ---- */
const EXPECT_SHIFT = { 8: 'market', 12: 'tea', 20: 'home' };
Object.keys(NPC_SCHEDULES).forEach(id => {
  [8, 12, 20].forEach(h => {
    const s = scheduleSpotFor(id, h);
    check(`lich ${id} ${h}h = ${EXPECT_SHIFT[h]} + di duoc`, s && s.shift === EXPECT_SHIFT[h] && walkableReal(s.x, s.z),
      JSON.stringify(s) + ' walkable=' + (s && Engine.isWalkable(s.x, s.z)) + ' rect=' + (s && outsideRects(s.x, s.z)));
  });
  [8, 12, 16, 20, 2].forEach(h => {
    const s = scheduleSpotFor(id, h);
    check(`lich ${id} ${h}h trong ban do + di duoc`, s && walkableReal(s.x, s.z), JSON.stringify(s));
  });
});

/* ---- 3. NPC di chuyển theo ca (đi bộ tới điểm mới, không nhảy) ---- */
function fakeEnt(id, x, z, isNpc) {
  return { id, name: id, isNpc: !!isNpc, mesh: { position: { x, z }, rotation: { y: 0 } } };
}
const merchEnt = fakeEnt('merchant', -5.2, -0.4, true);
merchEnt._shift = 'market';
State.worldClock.hour = 12;
NpcAI.updateEntity(merchEnt, 0.1, 12);
check('doi ca 8h->12h dat dich den quan tra', merchEnt._walk && Math.abs(merchEnt._walk.x - (-7)) < 1e-9 && merchEnt._walk.z === 0,
  JSON.stringify(merchEnt._walk));
let steps = 0;
while (merchEnt._walk && steps < 500) { NpcAI.updateEntity(merchEnt, 0.1, 12); steps++; }
check('NPC di bo toi quan tra (khong dich chuyen)', !merchEnt._walk &&
  Math.hypot(merchEnt.mesh.position.x - (-7), merchEnt.mesh.position.z - 0) < 0.2,
  'steps=' + steps + ' pos=' + JSON.stringify(merchEnt.mesh.position));
check('NPC di bo cham (can >10 buoc 0.1s cho ~2 don vi)', steps > 10, 'steps=' + steps);

/* ---- 4. Cây thoại: cấu trúc (mỗi NPC >=3 node, nhánh tồn tại, action hợp lệ) ---- */
const ACTIONS = ['shop', 'battle', 'info', 'recruit', 'event', 'forge', 'heal', 'lore', 'train'];
let totalNodes = 0;
Object.keys(DIALOGUE_TREES).forEach(id => {
  const tree = DIALOGUE_TREES[id];
  const nodes = Object.keys(tree);
  totalNodes += nodes.length;
  check(`cay thoai ${id} >=3 node`, nodes.length >= 3, nodes.length + ' node: ' + nodes.join(','));
  nodes.forEach(n => {
    const node = tree[n];
    check(`node ${id}/${n} co text + >=1 lua chon`, typeof node.text === 'string' && node.text.length > 5 && Array.isArray(node.options) && node.options.length >= 1);
    node.options.forEach((o, i) => {
      check(`lua chon ${id}/${n}[${i}] next ton tai / action hop le`,
        (o.next === null || o.next === undefined || !!tree[o.next]) && (!o.action || ACTIONS.includes(o.action)),
        JSON.stringify(o));
      if (o.cond) check(`cond ${id}/${n}[${i}] danh gia duoc boolean`, typeof dialogueCondMet(o.cond) === 'boolean');
    });
  });
});
check('tong so node cay thoai >=24 (8 NPC x >=3)', totalNodes >= 24, 'tong=' + totalNodes);
check('du 8 cay thoai (5 cu + 3 moi)', Object.keys(DIALOGUE_TREES).length === 8, Object.keys(DIALOGUE_TREES).join(','));

/* ---- 5. Cây thoại: render + rẽ nhánh đặt flag ---- */
CharacterManager.entities.push(
  fakeEnt('merchant', -5.2, -0.4, true),
  fakeEnt('master', 3.4, -3.8, true),
  fakeEnt('elder', -9.6, 1.4, true),
  fakeEnt('recruiter', -12, -6, true),
  fakeEnt('eventer', 8.2, -0.6, true),
  fakeEnt('smith', -9.8, -4.2, true),
  fakeEnt('healer', 6.5, -1, true),
  fakeEnt('storyteller', -1.5, 4, true)
);
CharacterManager.entities.forEach(e => { e.name = e.id; e.portrait = '🧙'; e.role = e.id; e.dialogue = '...'; });
const merchNpc = CharacterManager.entities.find(e => e.id === 'merchant');
World.talkTo(merchNpc);
check('talkTo merchant render cay thoai (co lua chon Xem hang)', /Xem hàng trong sạp/.test(dlgEl.innerHTML) && dlgEl.classList.contains('on'), dlgEl.innerHTML.slice(0, 120));
const newsIdx = DIALOGUE_TREES.merchant.start.options.findIndex(o => o.next === 'news');
State.flags.npc.met = {};
World.chooseDialogueOption('merchant', 'start', newsIdx);
check('re nhanh news dat flag metMerchant', State.flags.npc.metMerchant === true, JSON.stringify(State.flags.npc));
check('re nhanh news render dung node news', /Boss Thế Giới Kim Thiềm Vương/.test(dlgEl.innerHTML), dlgEl.innerHTML.slice(0, 120));

/* ---- 6. Cây thoại: nhánh có điều kiện bị chặn khi thiếu bạc/cấp/vật phẩm ---- */
State.inventory = [];
State.player.silver = 100;
State.player.level = 3;
check('thieu bac -> cond silver 1000 false', dialogueCondMet({ silver: 1000 }) === false);
check('condText silver ghi ro yeu cau', /1\.000 bạc/.test(dialogueCondText({ silver: 1000 })), dialogueCondText({ silver: 1000 }));
check('thieu cap -> cond level 5 false', dialogueCondMet({ level: 5 }) === false);
check('thieu vat pham -> cond hasItem false', dialogueCondMet({ hasItem: 'Huyền Thiết Tinh' }) === false);
check('condText vat pham ghi ro ten', /Huyền Thiết Tinh/.test(dialogueCondText({ hasItem: 'Huyền Thiết Tinh' })));
const forgeIdx = DIALOGUE_TREES.smith.start.options.findIndex(o => o.action === 'forge');
const atkBefore = State.player.atk;
const toastBefore = toasts.length;
World.chooseDialogueOption('smith', 'start', forgeIdx);
check('chon ren khi thieu tinh -> bi chan, khong tru atk', State.player.atk === atkBefore && toasts.length > toastBefore && /Chưa đủ|Huyền Thiết Tinh/.test(toasts[toasts.length - 1]),
  toasts[toasts.length - 1]);
State.player.level = 5;
const trainIdx = DIALOGUE_TREES.master.train.options.findIndex(o => o.action === 'train');
State.player.exp = 0;
World.chooseDialogueOption('master', 'train', trainIdx);
check('du cap -> train duoc, +30 EXP + dat flag', State.player.exp === 30 && State.flags.npc.trainedMaster === true,
  'exp=' + State.player.exp + ' flag=' + State.flags.npc.trainedMaster);
World.chooseDialogueOption('master', 'train', trainIdx);
check('train lan 2 bi chan (notFlag)', State.player.exp === 30, 'exp=' + State.player.exp);

/* ---- 7. Cây thoại: action mở đúng modal/trang ---- */
openedModals.length = 0; infoOpened.length = 0;
const battleIdx = DIALOGUE_TREES.master.start.options.findIndex(o => o.action === 'battle');
World.chooseDialogueOption('master', 'start', battleIdx);
check('action battle mo modal arena', openedModals.includes('arena'), openedModals.join(','));
const infoIdx = DIALOGUE_TREES.elder.start.options.findIndex(o => o.action === 'info');
World.chooseDialogueOption('elder', 'start', infoIdx);
check('action info mo ho so (Info.open)', infoOpened.length === 1, infoOpened.join(','));
const recruitIdx = DIALOGUE_TREES.recruiter.start.options.findIndex(o => o.action === 'recruit');
World.chooseDialogueOption('recruiter', 'start', recruitIdx);
check('action recruit mo modal recruit', openedModals.includes('recruit'), openedModals.join(','));
locationStub.href = '';
const eventIdx = DIALOGUE_TREES.eventer.start.options.findIndex(o => o.action === 'event');
World.chooseDialogueOption('eventer', 'start', eventIdx);
check('action event sang Event.html', locationStub.href === 'Event.html', locationStub.href);
locationStub.href = '';
const shopIdx = DIALOGUE_TREES.merchant.start.options.findIndex(o => o.action === 'shop');
World.chooseDialogueOption('merchant', 'start', shopIdx);
check('action shop sang Shop.html', locationStub.href === 'Shop.html', locationStub.href);
openedModals.length = 0;
const loreIdx = DIALOGUE_TREES.storyteller.start.options.findIndex(o => o.action === 'lore');
const loreBefore = State.flags.npc.loreRead || 0;
World.chooseDialogueOption('storyteller', 'start', loreIdx);
check('action lore mo modal lore + dem loreRead', openedModals.includes('lore') && State.flags.npc.loreRead === loreBefore + 1,
  openedModals.join(',') + ' loreRead=' + State.flags.npc.loreRead);
check('lore co 5 doan', NPC_LORE.length === 5 && NPC_LORE.every(p => p.length > 40), 'doan=' + NPC_LORE.length);

/* ---- 8. Dân thường: waypoint đi được + trẻ con chạy nhanh hơn ---- */
let badWander = 0;
for (let i = 0; i < 50; i++) {
  const pt = NpcAI.pickWanderPoint({ x: -4.2, z: 6.0 }, 6);
  if (!pt || !walkableReal(pt.x, pt.z) || Math.hypot(pt.x + 4.2, pt.z - 6.0) > 6.01) badWander++;
}
check('waypoint dan thuong luon di duoc + trong ban kinh 6', badWander === 0, 'bad=' + badWander);
function walkDist(ent, seconds) {
  const sx = ent.mesh.position.x, sz = ent.mesh.position.z;
  for (let i = 0; i < seconds * 10; i++) NpcAI.updateEntity(ent, 0.1, 8);
  return Math.hypot(ent.mesh.position.x - sx, ent.mesh.position.z - sz);
}
const townEnt = fakeEnt('town1', 0, 0, false);
townEnt._anchor = { x: 0, z: 0 }; townEnt._wander = { target: { x: 5, z: 0 }, rest: 0 };
const kidEnt = fakeEnt('child1', 0, 0, false);
kidEnt._anchor = { x: 0, z: 0 }; kidEnt._wander = { target: { x: 5, z: 0 }, rest: 0 };
const dTown = walkDist(townEnt, 1), dKid = walkDist(kidEnt, 1);
check('dan thuong di cham (~0.9/s)', dTown > 0.5 && dTown < 1.3, 'd=' + dTown.toFixed(2));
check('tre con chay nhanh gap ~3 lan dan thuong', dKid > 2.0 && dKid > dTown * 2, 'dKid=' + dKid.toFixed(2) + ' dTown=' + dTown.toFixed(2));
const restEnt = fakeEnt('town2', -4.2, 6.0, false);
restEnt._anchor = { x: -4.2, z: 6.0 }; restEnt._wander = { target: null, rest: 0.2 };
NpcAI.updateEntity(restEnt, 0.3, 8);
check('dan thuong het nghi thi chon dich moi di duoc', !!restEnt._wander.target && walkableReal(restEnt._wander.target.x, restEnt._wander.target.z),
  JSON.stringify(restEnt._wander.target));

/* ---- 9. NPC mới: đủ field, vị trí đi được, có cây thoại/dịch vụ ---- */
check('du 5 NPC moi (3 dich vu + 2 tre con)', NPC_NEW_DEFS.length === 5, NPC_NEW_DEFS.map(d => d.id).join(','));
check('id NPC moi duy nhat', new Set(NPC_NEW_DEFS.map(d => d.id)).size === 5);
NPC_NEW_DEFS.forEach(d => {
  check(`NPC moi ${d.id} du field + vi tri di duoc`, !!d.name && typeof d.x === 'number' && typeof d.z === 'number' && walkableReal(d.x, d.z),
    d.id + ' (' + d.x + ',' + d.z + ')');
});
['smith', 'healer', 'storyteller'].forEach(id => {
  const d = NPC_NEW_DEFS.find(x => x.id === id);
  check(`NPC moi ${id} co role + la NPC tuong tac + co cay thoai`, d.isNpc === true && !!d.role && !!DIALOGUE_TREES[id], d.role);
});
check('tre con scale 0.7', NPC_NEW_DEFS.filter(d => d.id.indexOf('child') === 0).every(d => d.scale === 0.7));
check('du 2 thu cung (cho + meo), vi tri di duoc', PET_DEFS.length === 2 &&
  PET_DEFS.map(p => p.kind).sort().join(',') === 'cat,dog' &&
  PET_DEFS.every(p => walkableReal(p.x, p.z)), JSON.stringify(PET_DEFS));
NpcAI.pets = PET_DEFS.map(p => ({ def: p, mesh: { position: { x: p.x, z: p.z } } }));
check('petNear tim dung cho gan nhat', NpcAI.petNear(-3, 3, 1.9) && NpcAI.petNear(-3, 3, 1.9).def.kind === 'dog');
check('petNear xa -> null', NpcAI.petNear(0, 0, 1.9) === null);
toasts.length = 0;
NpcAI.petEmote(NpcAI.pets[0]);
check('cham cho hien emote vui', toasts.length === 1 && /Gâu|sủa/.test(toasts[0]), toasts[0]);
toasts.length = 0;
NpcAI.petEmote(NpcAI.pets[1]);
check('cham meo hien emote vui', toasts.length === 1 && /Meo|meo/.test(toasts[0]), toasts[0]);

/* ---- 10. Dịch vụ thợ rèn / thầy thuốc tính đúng tiền/vật phẩm ---- */
State.inventory = [{ id: 'i3', name: 'Huyền Thiết Tinh', icon: '💎', type: 'Nguyên liệu', desc: 'Rèn trang bị', qty: 2 }];
State.flags.npc.forgeCount = 0;
State.player.atk = 68;
check('ren lan 1: +5 cong, tru 1 tinh', NpcService.forge() === true && State.player.atk === 73 &&
  State.inventory.find(i => i.name === 'Huyền Thiết Tinh').qty === 1 && State.flags.npc.forgeCount === 1,
  'atk=' + State.player.atk + ' qty=' + JSON.stringify(State.inventory));
State.inventory.find(i => i.name === 'Huyền Thiết Tinh').qty = 10;
for (let i = 0; i < 4; i++) NpcService.forge();
check('ren du 5 lan: +25 cong tong, forgeCount=5', State.player.atk === 93 && State.flags.npc.forgeCount === 5,
  'atk=' + State.player.atk + ' count=' + State.flags.npc.forgeCount);
check('ren lan 6 bi chan (toi da 5)', NpcService.forge() === false && State.player.atk === 93);
State.inventory = [];
State.flags.npc.forgeCount = 0;
check('ren khi het tinh bi tu choi', NpcService.forge() === false && State.player.atk === 93);
State.player.hp = 100; State.player.maxHp = 500; State.player.silver = 400;
check('chua thuong thieu bac (400 < 500) bi tu choi', NpcService.heal() === false && State.player.hp === 100 && State.player.silver === 400);
State.player.silver = 1000;
check('chua thuong du bac: -500 bac, HP day', NpcService.heal() === true && State.player.hp === 500 && State.player.silver === 500 && State.flags.npc.healCount === 1,
  'hp=' + State.player.hp + ' silver=' + State.player.silver);
check('chua thuong khi HP day: khong tru tien', NpcService.heal() === false && State.player.silver === 500);

/* ---- 11. Save/load: flags.npc bền vững + save cũ không có npc vẫn load được ---- */
State.flags.npc = { met: { metMerchant: true }, forgeCount: 3, healCount: 2, loreRead: 5 };
State.player.atk = 83;
SaveManager.save();
State.flags.npc = { met: {}, forgeCount: 0, healCount: 0, loreRead: 0 };
State.player.atk = 68;
SaveManager.load();
check('load khoi phuc flags.npc', State.flags.npc.forgeCount === 3 && State.flags.npc.healCount === 2 &&
  State.flags.npc.loreRead === 5 && State.flags.npc.met.metMerchant === true, JSON.stringify(State.flags.npc));
const raw = JSON.parse(store.get('mongvolam_soha_v1'));
delete raw.flags.npc;
store.set('mongvolam_soha_v1', JSON.stringify(raw));
State.flags.npc = { met: {}, forgeCount: 0, healCount: 0, loreRead: 0 };
let threw = null;
try { SaveManager.load(); } catch (e) { threw = e; }
check('save cu khong co flags.npc van load duoc, giu mac dinh', threw === null && State.flags.npc.forgeCount === 0 && State.flags.npc.healCount === 0,
  threw && threw.message);

/* ---- 12. Build + nối UI: file build chứa code NPC, 05-ui có lore + dlg-option ---- */
const built = read('mongvolam.html');
check('mongvolam.html build chua DIALOGUE_TREES + NpcAI', built.includes('DIALOGUE_TREES') && built.includes('NpcAI'), 'build chua?');
check('mongvolam.html build chua NPC moi + lore', built.includes('Thợ Rèn Thiết Ngưu') && built.includes('Truyền thuyết Biện Kinh'), 'build chua?');
const ui05 = read('src/05-ui.js');
check('05-ui co dispatch dlg-option', ui05.includes("case 'dlg-option'"), 'thieu dispatch');
check('05-ui co modal lore', ui05.includes("kind === 'lore'") && ui05.includes('NPC_LORE'), 'thieu modal lore');
check('khong co chuoi dong script trong src da sua', !read('src/01-data.js').includes('</script') && !read('src/02-world.js').includes('</script') && !read('src/05-ui.js').includes('</script'));

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
