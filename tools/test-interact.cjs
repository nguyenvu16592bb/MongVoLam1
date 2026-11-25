/* Kiểm thử Tương tác mở rộng + mini-game (Nhiệm vụ 4) — không cần trình duyệt.
   Nạp src/01-data.js + src/02-world.js vào vm với stub THREE/document/
   localStorage tối thiểu (theo tools/test-npc.cjs), rồi kiểm tra logic thuần:
   rương (bảng loot + hồi chiêu 1 ngày game), đồ rơi (nhặt vào túi, biến mất,
   tối đa 5), câu cá (vùng trúng/độ hiếm/hết mồi), hái sen (QTE), cờ Caro
   (AI chặn + thắng 5 quân + thưởng 1 lần/ngày), mồi câu mỗi ngày, emote,
   save/load (kể cả save cũ không có flags.interact), chợ (Mồi Câu + giá bán
   cá/sen/bướm), Newgame (5 Mồi Câu khởi đầu).
   Chạy: node tools/test-interact.cjs (sau node tools/build.mjs). */
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

/* ---- stub tối thiểu (theo tools/test-npc.cjs) ---- */
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
const toasts = [];
const locationStub = { href: '' };
const sandbox = {
  console, Math, JSON, performance,
  setTimeout: fn => { fn(); return 0; },
  clearInterval: () => {},
  setInterval: () => 0,
  THREE, localStorage, document, location: locationStub,
  window: { innerWidth: 800, innerHeight: 600 },
  Game: { mode: 'world' },
  Info: { open() {} }
};
vm.createContext(sandbox);
const src = read('src/01-data.js') + '\n' + read('src/02-world.js') +
  '\n;globalThis.__T = { State, Engine, SaveManager, CharacterManager, World, NpcAI, NpcService, UI, Interact, Gomoku, Emote, InteractWorld, CHEST_DEFS, FISH_SPOT, LOTUS_SPOT, CHESS_BOARD, CHESS_NPC_DEF, BUTTERFLY_ANCHORS, rollGroundLoot, rollChestLoot, applyLoot, defaultInteractState };';
vm.runInContext(src, sandbox);
const T_ = sandbox.__T;
const { State, Engine, SaveManager, CharacterManager, World, NpcAI, NpcService, UI, Interact, Gomoku, Emote, InteractWorld, CHEST_DEFS, FISH_SPOT, LOTUS_SPOT, CHESS_BOARD, CHESS_NPC_DEF, BUTTERFLY_ANCHORS, rollGroundLoot, rollChestLoot, applyLoot, defaultInteractState } = T_;
UI.toast = (msg, type) => { toasts.push(String(msg)); };
UI.openModal = (kind, data) => { openedModals.push(kind); };
UI.syncWorld = () => {};
/* PlayerController.entity giả để InteractWorld.act('butterfly') đo khoảng cách. */
sandbox.__T.PlayerController = null;
const PlayerController = { entity: null, moveTo() {}, stop() {} };
vm.runInContext('globalThis.__PC = { PlayerController };', sandbox);

/* Collider thật trong game (lầu/sạp/đài/bảng/cây/nhà/bù nhìn) — điểm tương tác
   phải đứng ngoài mọi hình này (theo tools/test-npc.cjs). */
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

/* Harness không chạy buildTown/buildExpansion nên Engine.colliders đang rỗng —
   nạp collider thật vào Engine để Interact.spawnDrop() (dùng isWalkable)
   loại đúng các điểm trong nhà/cây/sạp như game thật, tránh flaky ngẫu nhiên. */
RECTS.forEach(r => Engine.addCollider(r[0], r[1], r[2], r[3]));

/* Đặt lại state tương tác về mặc định trước mỗi nhóm test. */
function resetInteract() {
  State.flags.interact = defaultInteractState();
  State.worldClock.day = 1;
  State.worldClock.hour = 8;
}

/* ---- 1. Định nghĩa điểm tương tác: đủ số lượng, id duy nhất, vị trí đi được ---- */
check('du 5 ruong co dinh, id duy nhat', CHEST_DEFS.length === 5 &&
  new Set(CHEST_DEFS.map(c => c.id)).size === 5, CHEST_DEFS.map(c => c.id).join(','));
CHEST_DEFS.forEach(c => {
  check(`ruong ${c.id} (${c.x},${c.z}) di duoc + ngoai collider`, walkableReal(c.x, c.z),
    'walkable=' + Engine.isWalkable(c.x, c.z) + ' rect=' + outsideRects(c.x, c.z));
});
check('diem cau ca di duoc (tren cau da ho sen)', walkableReal(FISH_SPOT.x, FISH_SPOT.z), JSON.stringify(FISH_SPOT));
check('diem hai sen di duoc (tren cau da ho sen)', walkableReal(LOTUS_SPOT.x, LOTUS_SPOT.z), JSON.stringify(LOTUS_SPOT));
check('ban co + Lao Ky Thanh di duoc, gan lau gac', walkableReal(CHESS_BOARD.x, CHESS_BOARD.z) &&
  walkableReal(CHESS_NPC_DEF.x, CHESS_NPC_DEF.z), JSON.stringify(CHESS_BOARD) + ' npc=' + JSON.stringify(CHESS_NPC_DEF));
check('Lao Ky Thanh la NPC role chess, co thoai', CHESS_NPC_DEF.isNpc === true && CHESS_NPC_DEF.role === 'chess' &&
  typeof CHESS_NPC_DEF.dialogue === 'string' && CHESS_NPC_DEF.dialogue.length > 10);
check('du 5 buom', BUTTERFLY_ANCHORS.length === 5, BUTTERFLY_ANCHORS.map(a => a.x + ',' + a.z).join(' | '));

/* ---- 2. Rương: bảng loot đúng + hồi chiêu 1 ngày game ---- */
check('loot ruong r=0.1 -> bac 500-2000', (() => { const l = rollChestLoot(0.1, 0.5); return l.kind === 'silver' && l.amount >= 500 && l.amount <= 2000; })(),
  JSON.stringify(rollChestLoot(0.1, 0.5)));
check('loot ruong r=0.6 -> dan duoc x2', (() => { const l = rollChestLoot(0.6, 0.2); return l.kind === 'item' && l.qty === 2 && /Đan|Dược/.test(l.type); })(),
  JSON.stringify(rollChestLoot(0.6, 0.2)));
check('loot ruong r=0.75 -> vat lieu (tinh hoac moi cau)', (() => { const l = rollChestLoot(0.75, 0.2); return l.kind === 'item' && (l.name === 'Huyền Thiết Tinh' || l.name === 'Mồi Câu'); })(),
  JSON.stringify(rollChestLoot(0.75, 0.2)));
check('loot ruong r=0.9 -> Hat Sen x3', (() => { const l = rollChestLoot(0.9, 0.5); return l.kind === 'item' && l.name === 'Hạt Sen' && l.qty === 3; })(),
  JSON.stringify(rollChestLoot(0.9, 0.5)));
check('loot ruong r=0.97 -> hiem: 8-15 KNB', (() => { const l = rollChestLoot(0.97, 0.5, 0.5); return l.kind === 'gold' && l.rare === true && l.amount >= 8 && l.amount <= 15; })(),
  JSON.stringify(rollChestLoot(0.97, 0.5, 0.5)));
resetInteract();
State.player.silver = 1000;
const chestRes = Interact.chestOpen('chest-lau', 0.1, 0.5);
check('mo ruong lan 1 duoc: +bac, danh dau ngay mo', chestRes.ok === true && State.player.silver === 1000 + chestRes.loot.amount &&
  State.flags.interact.chests['chest-lau'] === 1, JSON.stringify(chestRes) + ' silver=' + State.player.silver);
check('mo lai ruong cung ngay bi chan (hoi chieu)', Interact.chestOpen('chest-lau', 0.1, 0.5).ok === false &&
  Interact.chestOpen('chest-lau', 0.1, 0.5).reason === 'cooldown');
check('ruong khac van mo duoc cung ngay', Interact.chestOpen('chest-ho', 0.1, 0.5).ok === true);
State.worldClock.day = 2;
check('sang ngay game sau mo lai duoc', Interact.chestOpen('chest-lau', 0.1, 0.5).ok === true);
check('mo ruong khong ton tai -> that bai', Interact.chestOpen('ruong-ao', 0.1, 0.5).ok === false);
check('chestStatus bao dung ngay da mo', Interact.chestStatus('chest-lau').openedToday === true &&
  Interact.chestStatus('chest-dong').openedToday === false);

/* ---- 3. Đồ rơi: bảng loot, tối đa 5, nhặt vào túi rồi biến mất ---- */
check('loot roi r=0.0 -> bac 200-800', (() => { const l = rollGroundLoot(0.0, 0.5); return l.kind === 'silver' && l.amount >= 200 && l.amount <= 800; })(),
  JSON.stringify(rollGroundLoot(0.0, 0.5)));
check('loot roi r=0.5 -> Kim Sang Duoc hoac Tu Khi Dan', (() => { const l = rollGroundLoot(0.5, 0.5); return l.kind === 'item' && (l.name === 'Kim Sáng Dược' || l.name === 'Tụ Khí Đan'); })(),
  JSON.stringify(rollGroundLoot(0.5, 0.5)));
check('loot roi r=0.95 -> La Sen x2', (() => { const l = rollGroundLoot(0.95, 0.5); return l.kind === 'item' && l.name === 'Lá Sen' && l.qty === 2; })(),
  JSON.stringify(rollGroundLoot(0.95, 0.5)));
resetInteract();
const drops = [];
for (let i = 0; i < 5; i++) drops.push(Interact.spawnDrop());
check('sinh duoc 5 do roi, vi tri di duoc', drops.every(d => d && walkableReal(d.x, d.z)),
  drops.map(d => d && (d.x + ',' + d.z)).join(' | '));
check('qua 5 do roi thi khong sinh them', Interact.spawnDrop() === null);
const firstDrop = drops[0];
const silverBefore = State.player.silver;
const invBefore = State.inventory.length;
const pickRes = Interact.pickupDrop(firstDrop.id);
check('nhat do roi: vao tui/vi + bien mat khoi danh sach', pickRes.ok === true &&
  State.flags.interact.drops.length === 4 && !State.flags.interact.drops.find(d => d.id === firstDrop.id),
  JSON.stringify(pickRes) + ' drops=' + State.flags.interact.drops.length);
check('nhat lai do da nhat -> that bai', Interact.pickupDrop(firstDrop.id).ok === false);
check('nhat do roi khong ton tai -> that bai', Interact.pickupDrop('drop-ao').ok === false);
check('sinh lai duoc sau khi nhat (con 4 < 5)', Interact.spawnDrop() !== null && State.flags.interact.drops.length === 5);

/* ---- 4. Câu cá: đúng vùng = trúng + đúng độ hiếm, sai = trượt, hết mồi bị chặn ---- */
resetInteract();
State.inventory = [{ id: 'i4', name: 'Mồi Câu', icon: '🪱', type: 'Vật phẩm', desc: 'Mồi câu', qty: 2 }];
check('con 2 moi cau', Interact.baitCount() === 2);
check('tha cau tru 1 moi', Interact.fishCast() === true && Interact.baitCount() === 1);
check('tha cau lan 2 het moi', Interact.fishCast() === true && Interact.baitCount() === 0);
check('het moi thi khong tha cau duoc', Interact.fishCast() === false);
check('cau vung vang giua pos=50 -> Ca Chep Vang su thi', (() => { const r = Interact.fishResolve(50); return r.hit && r.rarity === 'epic' && r.fish.name === 'Cá Chép Vàng'; })(),
  JSON.stringify(Interact.fishResolve(50)));
check('cau bien vung vang pos=47/53 van su thi', Interact.fishResolve(47).rarity === 'epic' && Interact.fishResolve(53).rarity === 'epic');
check('cau vung xanh pos=40, r=0.5 -> Ca Chep Thuong', (() => { const r = Interact.fishResolve(40, 0.5); return r.hit && r.rarity === 'common' && r.fish.name === 'Cá Chép Thường'; })());
check('cau vung xanh pos=40, r=0.1 -> Ca Chep Hiem (30%)', (() => { const r = Interact.fishResolve(40, 0.1); return r.hit && r.rarity === 'rare' && r.fish.name === 'Cá Chép Hiếm'; })());
check('cau bien vung xanh pos=35/65 van trung', Interact.fishResolve(35).hit === true && Interact.fishResolve(65).hit === true);
check('cau ngoai vung pos=20/80 -> truot', Interact.fishResolve(20).hit === false && Interact.fishResolve(80).hit === false);
check('cau pos=34 (sat bien duoi) -> truot', Interact.fishResolve(34).hit === false);
const fishBefore = State.flags.interact.fishCaught;
const fishName = Interact.applyFish(Interact.fishResolve(50));
check('cau duoc ca vang vao tui + dem fishCaught', fishName === 'Cá Chép Vàng' &&
  State.inventory.some(i => i.name === 'Cá Chép Vàng' && i.qty === 1) && State.flags.interact.fishCaught === fishBefore + 1,
  fishName + ' fishCaught=' + State.flags.interact.fishCaught);
check('truot thi khong them ca vao tui', Interact.applyFish(Interact.fishResolve(20)) === '');

/* ---- 5. Hái sen: đúng lúc = được, sai = không (không phạt) ---- */
check('hai sen pos=50, r=0.5 -> Hat Sen x2', (() => { const r = Interact.lotusResolve(50, 0.5); return r.hit && r.item.name === 'Hạt Sen' && r.item.qty === 2; })(),
  JSON.stringify(Interact.lotusResolve(50, 0.5)));
check('hai sen pos=50, r=0.9 -> La Sen x2', (() => { const r = Interact.lotusResolve(50, 0.9); return r.hit && r.item.name === 'Lá Sen' && r.item.qty === 2; })());
check('hai sen bien vung sang pos=40/60 van duoc', Interact.lotusResolve(40).hit === true && Interact.lotusResolve(60).hit === true);
check('hai sen pos=20/80 -> khong duoc gi', Interact.lotusResolve(20).hit === false && Interact.lotusResolve(80).hit === false);
check('hai sen pos=39 (sat bien) -> khong duoc', Interact.lotusResolve(39).hit === false);
const lotusBefore = State.flags.interact.lotusPicked;
const lotusName = Interact.applyLotus(Interact.lotusResolve(50, 0.5));
check('hai duoc sen vao tui + dem lotusPicked', lotusName === 'Hạt Sen ×2' &&
  State.inventory.some(i => i.name === 'Hạt Sen') && State.flags.interact.lotusPicked === lotusBefore + 1, lotusName);

/* ---- 6. Mồi câu mỗi ngày game ---- */
resetInteract();
State.inventory = [];
check('ngay 1 chua nhan -> tang 5 Moi Cau', Interact.maybeGrantDailyBait() === true &&
  Interact.baitCount() === 5 && State.flags.interact.baitDay === 1, 'bait=' + Interact.baitCount());
check('cung ngay khong tang them', Interact.maybeGrantDailyBait() === false && Interact.baitCount() === 5);
State.worldClock.day = 2;
check('sang ngay 2 tang them 5 moi', Interact.maybeGrantDailyBait() === true && Interact.baitCount() === 10);

/* ---- 7. Cờ Caro: thắng 5 quân, AI chặn nước thắng + tự tìm nước thắng ---- */
const b0 = Gomoku.newBoard();
check('ban co moi 9x9 toan o trong', b0.length === 9 && b0.every(r => r.length === 9 && r.every(v => v === 0)));
function boardWith(moves) {
  const b = Gomoku.newBoard();
  moves.forEach(m => { b[m[1]][m[0]] = m[2]; });
  return b;
}
check('thang 5 ngang duoc tinh', Gomoku.checkWin(boardWith([[0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1], [4, 0, 1]]), 4, 0, 1) === true);
check('thang 5 doc duoc tinh', Gomoku.checkWin(boardWith([[2, 0, 1], [2, 1, 1], [2, 2, 1], [2, 3, 1], [2, 4, 1]]), 2, 4, 1) === true);
check('thang 5 cheo duoc tinh', Gomoku.checkWin(boardWith([[0, 0, 1], [1, 1, 1], [2, 2, 1], [3, 3, 1], [4, 4, 1]]), 4, 4, 1) === true);
check('thang 5 cheo nguoc duoc tinh', Gomoku.checkWin(boardWith([[4, 0, 1], [3, 1, 1], [2, 2, 1], [1, 3, 1], [0, 4, 1]]), 0, 4, 1) === true);
check('chi 4 quan thi chua thang', Gomoku.checkWin(boardWith([[0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1]]), 3, 0, 1) === false);
check('5 quan bi chan giua thi khong thang', Gomoku.checkWin(boardWith([[0, 0, 1], [1, 0, 1], [2, 0, 2], [3, 0, 1], [4, 0, 1], [5, 0, 1]]), 5, 0, 1) === false);
const blockBoard = boardWith([[0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1]]);
const blockMove = Gomoku.aiMove(blockBoard);
check('AI chan nuoc thang cua nguoi choi (4 quan ngang)', blockMove && blockMove.x === 4 && blockMove.y === 0,
  JSON.stringify(blockMove));
const winBoard = boardWith([[0, 1, 2], [1, 1, 2], [2, 1, 2], [3, 1, 2]]);
const winMove = Gomoku.aiMove(winBoard);
check('AI tu tim nuoc thang cua minh (4 quan ngang)', winMove && winMove.x === 4 && winMove.y === 1,
  JSON.stringify(winMove));
const emptyMove = Gomoku.aiMove(Gomoku.newBoard(), () => 0.5);
check('AI di duoc tren ban trong', emptyMove && Gomoku.inBounds(emptyMove.x, emptyMove.y), JSON.stringify(emptyMove));
const fullBoard = Gomoku.newBoard();
for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) fullBoard[y][x] = (x + y) % 2 + 1;
check('ban day thi AI khong di duoc + isFull dung', Gomoku.aiMove(fullBoard) === null && Gomoku.isFull(fullBoard) === true);
check('ban chua day thi isFull sai', Gomoku.isFull(Gomoku.newBoard()) === false);

/* ---- 8. Thưởng thắng cờ: 1 lần/ngày game (+1.000 bạc +100 EXP) ---- */
resetInteract();
State.player.silver = 5000;
State.player.exp = 0; State.player.level = 3; State.player.maxExp = 160;
const rw1 = Interact.claimChessReward();
check('thang co lan 1 trong ngay: +1000 bac + thuong, ghi ngay', rw1.rewarded === true &&
  State.player.silver === 6000 && State.flags.interact.chessWinDay === 1 && State.flags.interact.chessWins === 1,
  JSON.stringify(rw1) + ' silver=' + State.player.silver);
check('thang co lan 2 cung ngay: khong thuong them', Interact.claimChessReward().rewarded === false &&
  State.player.silver === 6000);
State.worldClock.day = 2;
check('sang ngay sau thang lai duoc thuong', Interact.claimChessReward().rewarded === true &&
  State.player.silver === 7000 && State.flags.interact.chessWins === 2);

/* ---- 9. Emote: ghi lại + không crash khi không có camera/DOM thật ---- */
Emote.last = null;
check('emote vui nguoi choi ghi lai duoc', Emote.player('😊') === true && Emote.last && Emote.last.who === 'player' && Emote.last.emoji === '😊',
  JSON.stringify(Emote.last));
check('emote buon NPC ghi lai duoc', Emote.npc('smith', '😢') === true && Emote.last.who === 'smith' && Emote.last.emoji === '😢');
check('emote gian ghi lai duoc', Emote.show('healer', '😠') === true && Emote.last.emoji === '😠');

/* ---- 10. InteractWorld.nearest + act (không cần THREE thật) ---- */
resetInteract();
State.inventory = [{ id: 'i4', name: 'Mồi Câu', icon: '🪱', type: 'Vật phẩm', desc: 'Mồi câu', qty: 3 }];
InteractWorld.butterflies = [];
check('nearest gan ruong Lau -> chest', (() => { const t = InteractWorld.nearest(-11, -3, 2.0); return t && t.kind === 'chest' && t.id === 'chest-lau'; })(),
  JSON.stringify(InteractWorld.nearest(-11, -3, 2.0)));
check('nearest gan diem cau -> fishing', (() => { const t = InteractWorld.nearest(7, 9, 2.0); return t && t.kind === 'fishing'; })());
check('nearest gan diem sen -> lotus', (() => { const t = InteractWorld.nearest(4, 9, 2.0); return t && t.kind === 'lotus'; })());
check('nearest gan ban co -> chess', (() => { const t = InteractWorld.nearest(9, -1.6, 2.0); return t && t.kind === 'chess'; })());
check('nearest cho xa moi vat -> null', InteractWorld.nearest(0, -30, 2.0) === null);
openedModals.length = 0; toasts.length = 0;
InteractWorld.act({ kind: 'fishing', id: 'fish', x: 7, z: 9 });
check('act cau ca: ton 1 moi + mo modal fishing', openedModals.includes('fishing') && Interact.baitCount() === 2,
  openedModals.join(',') + ' bait=' + Interact.baitCount());
State.inventory = [];
openedModals.length = 0; toasts.length = 0;
InteractWorld.act({ kind: 'fishing', id: 'fish', x: 7, z: 9 });
check('act cau ca het moi: bi chan, khong mo modal', !openedModals.includes('fishing') && toasts.some(t => /Hết Mồi Câu/.test(t)),
  openedModals.join(',') + ' | ' + toasts.join(' | '));
openedModals.length = 0;
InteractWorld.act({ kind: 'lotus', id: 'lotus', x: 4, z: 9 });
check('act hai sen mo modal lotus', openedModals.includes('lotus'), openedModals.join(','));
openedModals.length = 0;
InteractWorld.act({ kind: 'chess', id: 'chess', x: 9, z: -1.6 });
check('act ban co mo modal chess', openedModals.includes('chess'), openedModals.join(','));
resetInteract();
State.player.silver = 1000;
toasts.length = 0;
InteractWorld.act({ kind: 'chest', id: 'chest-dong', x: 14, z: 3 });
check('act mo ruong: toast loot + danh dau da mo', State.flags.interact.chests['chest-dong'] === 1 &&
  toasts.some(t => /Mở rương/.test(t)), toasts.join(' | '));
toasts.length = 0;
InteractWorld.act({ kind: 'chest', id: 'chest-dong', x: 14, z: 3 });
check('act mo lai ruong cung ngay: toast hoi chieu ngay mai', toasts.some(t => /ngày 2/.test(t)), toasts.join(' | '));
resetInteract();
const d1 = Interact.spawnDrop();
check('act nhat do roi: bien mat + toast', d1 && (() => {
  toasts.length = 0;
  InteractWorld.act({ kind: 'drop', id: d1.id, x: d1.x, z: d1.z });
  return !State.flags.interact.drops.find(x => x.id === d1.id) && toasts.some(t => /Nhặt được/.test(t));
})(), toasts.join(' | '));

/* ---- 11. Save/load: flags.interact bền vững + save cũ không có interact vẫn load được ---- */
resetInteract();
State.flags.interact = { chests: { 'chest-lau': 3 }, drops: [{ id: 'drop-x', x: 1, z: 2, loot: { kind: 'silver', amount: 100 } }], baitDay: 5, chessWinDay: 5, chessWins: 2, fishCaught: 7, lotusPicked: 4, butterflies: 3 };
State.worldClock.day = 5;
SaveManager.save();
State.flags.interact = defaultInteractState();
State.worldClock.day = 1;
SaveManager.load();
check('load khoi phuc flags.interact', State.flags.interact.chests['chest-lau'] === 3 &&
  State.flags.interact.drops.length === 1 && State.flags.interact.drops[0].id === 'drop-x' &&
  State.flags.interact.baitDay === 5 && State.flags.interact.chessWinDay === 5 &&
  State.flags.interact.chessWins === 2 && State.flags.interact.fishCaught === 7 &&
  State.flags.interact.lotusPicked === 4 && State.flags.interact.butterflies === 3,
  JSON.stringify(State.flags.interact));
const raw = JSON.parse(store.get('mongvolam_soha_v1'));
delete raw.flags.interact;
store.set('mongvolam_soha_v1', JSON.stringify(raw));
State.flags.interact = defaultInteractState();
let threw = null;
try { SaveManager.load(); } catch (e) { threw = e; }
check('save cu khong co flags.interact van load duoc, giu mac dinh', threw === null &&
  State.flags.interact.baitDay === 0 && Object.keys(State.flags.interact.chests).length === 0 &&
  State.flags.interact.drops.length === 0, threw && threw.message);
const raw2 = JSON.parse(store.get('mongvolam_soha_v1'));
raw2.flags.interact = { chests: {}, drops: [{ id: 'xau', x: 'khong-phai-so', z: 1, loot: null }, { id: 'tot', x: 1, z: 1, loot: { kind: 'silver', amount: 50 } }, { id: 'd1', x: 1, z: 1, loot: { kind: 'silver', amount: 1 } }, { id: 'd2', x: 1, z: 1, loot: { kind: 'silver', amount: 1 } }, { id: 'd3', x: 1, z: 1, loot: { kind: 'silver', amount: 1 } }, { id: 'd4', x: 1, z: 1, loot: { kind: 'silver', amount: 1 } }, { id: 'd5', x: 1, z: 1, loot: { kind: 'silver', amount: 1 } }], baitDay: -3, chessWinDay: 0, chessWins: 0, fishCaught: 0, lotusPicked: 0, butterflies: 0 };
store.set('mongvolam_soha_v1', JSON.stringify(raw2));
SaveManager.load();
check('load loc drops hong + gioi han 5 + baitDay am ve 0', State.flags.interact.drops.length === 5 &&
  State.flags.interact.drops.every(d => d.loot) && State.flags.interact.baitDay === 0,
  'drops=' + State.flags.interact.drops.length + ' baitDay=' + State.flags.interact.baitDay);

/* ---- 12. Chợ + Newgame: Mồi Câu mua được, cá/sen/bướm bán được ---- */
const shop = require('../src/07-shop.js');
const ng = require('../src/08-newgame.js');
const s = shop.shopDefaultSave();
const buyBait = shop.shopBuy(s, 'tc09', 1, {});
check('mua Moi Cau o cho: -50 bac, vao tui', buyBait.ok && s.player.silver === 40932 - 50 &&
  s.inventory.some(i => i.name === 'Mồi Câu' && i.qty >= 1), JSON.stringify(buyBait) + ' silver=' + s.player.silver);
check('ban lai Moi Cau = 50% (25 bac)', (() => {
  const idx = s.inventory.findIndex(i => i.name === 'Mồi Câu');
  const q = shop.shopSellQuote(s, idx);
  return q && q.value === 25;
})());
check('gia ban Ca Chep Vang fallback 2000 bac', (() => {
  const s2 = shop.shopDefaultSave();
  s2.inventory.push({ id: 'x', name: 'Cá Chép Vàng', icon: '🐡', type: 'Thực phẩm', desc: '', qty: 1 });
  const q = shop.shopSellQuote(s2, s2.inventory.length - 1);
  return q && q.value === 2000;
})());
check('gia ban Ca Chep Hiem 500 / Thuong 150 / Hat Sen 120 / La Sen 60 / Canh Buom 300', (() => {
  const s2 = shop.shopDefaultSave();
  const prices = { 'Cá Chép Hiếm': 500, 'Cá Chép Thường': 150, 'Hạt Sen': 120, 'Lá Sen': 60, 'Cánh Bướm': 300 };
  return Object.keys(prices).every(name => {
    s2.inventory.push({ id: 'x-' + name, name, icon: '❓', type: 'Linh tinh', desc: '', qty: 1 });
    const q = shop.shopSellQuote(s2, s2.inventory.length - 1);
    return q && q.value === prices[name];
  });
})());
const ngSave = ng.ngCreateSave ? ng.ngCreateSave({ name: 'Test', gender: 'Nam', color: 'do', hair: 'bui-cao', sectId: 'thieulam', heroId: 'det' }) : null;
const ngInv = ngSave && (ngSave.save ? ngSave.save.inventory : ngSave.inventory);
check('save moi Newgame co 5 Moi Cau khoi dau', Array.isArray(ngInv) &&
  ngInv.some(i => i.name === 'Mồi Câu' && i.qty === 5), JSON.stringify(ngInv));

/* ---- 13. Build + nối UI: file build chứa code mới, 05-ui có modal + dispatch ---- */
const built = read('mongvolam.html');
check('mongvolam.html build chua CHEST_DEFS + Gomoku + MiniGames', built.includes('CHEST_DEFS') && built.includes('Gomoku') && built.includes('MiniGames'), 'build chua?');
check('mongvolam.html build chua Lao Ky Thanh + cau ca + hai sen', built.includes('Lão Kỳ Thánh') && built.includes('Câu cá hồ sen') && built.includes('Hái sen hồ sen'), 'build chua?');
const ui05 = read('src/05-ui.js');
check("05-ui co modal fishing/lotus/chess", ui05.includes("kind === 'fishing'") && ui05.includes("kind === 'lotus'") && ui05.includes("kind === 'chess'"), 'thieu modal');
check("05-ui co dispatch interact-near/open-chess/fish-pull/lotus-pick/chess-cell",
  ui05.includes("case 'interact-near'") && ui05.includes("case 'open-chess'") && ui05.includes("case 'fish-pull'") &&
  ui05.includes("case 'lotus-pick'") && ui05.includes("case 'chess-cell'"), 'thieu dispatch');
check('05-ui co nut interact-btn tren HUD', ui05.includes('interact-btn'), 'thieu nut');
const w02 = read('src/02-world.js');
check('02-world moc InteractWorld vao bindEvents + World.update + createWorld',
  w02.includes('InteractWorld.nearest') && w02.includes('InteractWorld.update') && w02.includes('InteractWorld.build()'), 'thieu moc');
check('02-world co nut Dau co cho Lao Ky Thanh', w02.includes("data-act=\"open-chess\""), 'thieu nut co');
check('khong co chuoi dong script trong src da sua',
  !read('src/01-data.js').includes('</script') && !read('src/02-world.js').includes('</script') &&
  !read('src/05-ui.js').includes('</script') && !read('src/07-shop.js').includes('</script') &&
  !read('src/08-newgame.js').includes('</script') && !read('src/style.css').includes('</script'));

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
