/* Kiểm thử 11 khu vực mới (Nhóm C) — chạy bằng Node, không cần trình duyệt.
   node tools/test-districts.cjs   (exit 1 nếu có FAIL)
   - Dữ liệu: require src/10b-districts.js (DISTRICTS 12 khu, canEnterDistrict).
   - Save cũ: nạp src/01-data.js vào vm (stub như tools/test-npc.cjs),
     SaveManager.load() với save không có flags.district.
   - Thưởng + link về thành: nạp src/10b-districts.js + src/10-district.js
     vào vm (stub THREE/document/localStorage), gọi thẳng District.winBoss /
     District.goHome / District.actShopLink với context giả (không boot 3D).
   - Trang build: đọc map/*.html trên đĩa, kiểm tra link ../ + def + placeholder. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../src/10b-districts.js');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}

/* ================= 1. DISTRICTS: đủ 12 khu, đủ field ================= */
check('12 khu (id 1..12)', D.DISTRICTS.length === 12 &&
  D.DISTRICTS.every((d, i) => d.id === i + 1), JSON.stringify(D.DISTRICTS.map(d => d.id)));
check('id 1 = Bien Kinh Thanh, file null', D.DISTRICTS[0].id === 1 &&
  D.DISTRICTS[0].file === null && D.DISTRICTS[0].name === 'Biện Kinh Thành');
const EXPECT_FILES = ['pho-dong.html', 'pho-tay.html', 'nam-mon.html', 'bac-uyen.html',
  'ngo-hep.html', 'mieu-co.html', 'ben-song.html', 'ruong-lua.html',
  'nghia-trang.html', 'thac-nuoc.html', 'hang-dong.html'];
check('file khu 2..12 dung thu tu', JSON.stringify(D.DISTRICTS.slice(1).map(d => d.file)) === JSON.stringify(EXPECT_FILES),
  JSON.stringify(D.DISTRICTS.slice(1).map(d => d.file)));
check('save key chung mongvolam_soha_v1', D.DISTRICT_SAVE_KEY === 'mongvolam_soha_v1');
check('item lenh_bai id + ten', D.DISTRICT_ITEM_LENH_BAI.id === 'lenh_bai' &&
  D.DISTRICT_ITEM_LENH_BAI.name === 'Lệnh Bài Biện Kinh');
D.DISTRICTS.forEach(d => {
  check(`khu ${d.id} (${d.name}) du field ten/desc/theme/bounds`,
    !!(d.name && d.desc && d.theme && d.theme.sky && d.theme.ground && d.theme.fog && d.bounds &&
      typeof d.bounds.minX === 'number' && typeof d.bounds.maxX === 'number' &&
      typeof d.bounds.minZ === 'number' && typeof d.bounds.maxZ === 'number'));
  check(d.id === 1
    ? `khu ${d.id} la khu trung tam: NPC/hoat dong rong theo thiet ke (song trong mongvolam.html)`
    : `khu ${d.id} co >=1 NPC va >=1 hoat dong`,
    d.id === 1
      ? (Array.isArray(d.npcs) && d.npcs.length === 0 && Array.isArray(d.activities) && d.activities.length === 0)
      : (Array.isArray(d.npcs) && d.npcs.length >= 1 && Array.isArray(d.activities) && d.activities.length >= 1));
  const actIds = new Set();
  d.activities.forEach(a => {
    check(`khu ${d.id} hoat dong ${a.id} du ten/desc + id duy nhat`,
      !!(a.id && a.name && a.desc) && !actIds.has(a.id));
    actIds.add(a.id);
  });
  d.npcs.forEach(n => {
    check(`khu ${d.id} NPC ${n.id} du field + trong bounds`,
      !!(n.id && n.name && n.role && typeof n.x === 'number' && typeof n.z === 'number' && n.dialogue) &&
      n.x >= d.bounds.minX && n.x <= d.bounds.maxX && n.z >= d.bounds.minZ && n.z <= d.bounds.maxZ,
      JSON.stringify(n));
  });
  (d.props || []).forEach(p => {
    check(`khu ${d.id} prop ${p.kind} (${p.x},${p.z}) trong bounds +-1`,
      p.x >= d.bounds.minX - 1 && p.x <= d.bounds.maxX + 1 &&
      p.z >= d.bounds.minZ - 1 && p.z <= d.bounds.maxZ + 1, JSON.stringify(p));
  });
});
check('chi 2 khu co khoa: nghia-trang (night) + hang-dong (quest)',
  D.DISTRICTS.filter(d => d.lock).map(d => d.id).join(',') === '10,12',
  JSON.stringify(D.DISTRICTS.filter(d => d.lock).map(d => [d.id, d.lock.type])));

/* ================= 2. Boss + thuong ================= */
const mieu = D.DISTRICTS[6], hang = D.DISTRICTS[11];
check('boss mieu-co: Ho Phap Da, hp 12000, oncePerDay',
  mieu.boss && mieu.boss.name === 'Hộ Pháp Đá Miếu Cổ' && mieu.boss.hp === 12000 && mieu.boss.oncePerDay === true,
  JSON.stringify(mieu.boss));
check('boss mieu-co thuong 8000 bac + 15 KNB + 600 EXP + lenh_bai',
  mieu.boss.reward.silver === 8000 && mieu.boss.reward.gold === 15 &&
  mieu.boss.reward.exp === 600 && mieu.boss.reward.item === 'lenh_bai', JSON.stringify(mieu.boss.reward));
check('boss hang-dong manh nhat: hp 30000 > mieu-co, thuong 20000 bac + 40 KNB + 1500 EXP',
  hang.boss && hang.boss.hp === 30000 && hang.boss.hp > mieu.boss.hp &&
  hang.boss.reward.silver === 20000 && hang.boss.reward.gold === 40 && hang.boss.reward.exp === 1500,
  JSON.stringify(hang.boss));
check('chi 2 khu co boss: mieu-co + hang-dong',
  D.DISTRICTS.filter(d => d.boss).map(d => d.id).join(',') === '7,12');

/* ================= 3. Khoa: canEnterDistrict ================= */
function saveAt(hour, inv, distFlags) {
  return {
    worldClock: { hour, day: 3 }, inventory: inv || [],
    flags: { district: distFlags || D.defaultDistrictFlags() }
  };
}
const nghia = D.DISTRICTS[9];
check('nghia-trang 10h ban ngay bi chan', D.canEnterDistrict(nghia, saveAt(10)).ok === false);
check('nghia-trang 12h ban ngay bi chan', D.canEnterDistrict(nghia, saveAt(12)).ok === false);
check('nghia-trang 6h (ranh gioi ngay) bi chan', D.canEnterDistrict(nghia, saveAt(6)).ok === false);
check('nghia-trang 22h ban dem mo', D.canEnterDistrict(nghia, saveAt(22)).ok === true);
check('nghia-trang 5h sang van dem -> mo', D.canEnterDistrict(nghia, saveAt(5)).ok === true);
check('nghia-trang 18h (ranh gioi dem) mo', D.canEnterDistrict(nghia, saveAt(18)).ok === true);
check('nghia-trang save khong co flags.district: ban ngay chan, ban dem mo',
  D.canEnterDistrict(nghia, { worldClock: { hour: 10, day: 1 }, inventory: [], flags: {} }).ok === false &&
  D.canEnterDistrict(nghia, { worldClock: { hour: 22, day: 1 }, inventory: [], flags: {} }).ok === true);
let r = D.canEnterDistrict(hang, saveAt(10));
check('hang-dong chua thang boss mieu -> chan, reason co Mieu Co',
  r.ok === false && /Miếu Cổ/.test(r.reason), JSON.stringify(r));
r = D.canEnterDistrict(hang, saveAt(10, [], Object.assign(D.defaultDistrictFlags(), { boss_mieu_co: true })));
check('hang-dong thang boss nhung thieu lenh bai -> chan, reason co Lenh Bai',
  r.ok === false && /Lệnh Bài/.test(r.reason), JSON.stringify(r));
r = D.canEnterDistrict(hang, saveAt(10,
  [{ id: 'lenh_bai', name: 'Lệnh Bài Biện Kinh', qty: 1 }],
  Object.assign(D.defaultDistrictFlags(), { boss_mieu_co: true })));
check('hang-dong du flag + lenh_bai (theo id) -> vao', r.ok === true, JSON.stringify(r));
r = D.canEnterDistrict(hang, saveAt(10,
  [{ name: 'Lệnh Bài Biện Kinh', qty: 1 }],
  Object.assign(D.defaultDistrictFlags(), { boss_mieu_co: true })));
check('hang-dong lenh_bai nhan dang theo ten (khong id) -> vao', r.ok === true, JSON.stringify(r));
check('khu 1 luon vao duoc', D.canEnterDistrict(D.DISTRICTS[0], saveAt(10)).ok === true);
check('khu khong khoa (pho-dong) vao duoc', D.canEnterDistrict(D.DISTRICTS[1], saveAt(10)).ok === true);
check('khu khong khoa (thac-nuoc) vao duoc', D.canEnterDistrict(D.DISTRICTS[10], saveAt(10)).ok === true);
check('def null bi chan', D.canEnterDistrict(null, saveAt(10)).ok === false);

/* ================= 4. ensureDistrictFlags: save cu ================= */
const dfOld = D.ensureDistrictFlags({ flags: {} });
check('save cu (khong district) duoc them flag mac dinh',
  dfOld.boss_mieu_co === false && dfOld.ngo_step === 0 &&
  typeof dfOld.thac_collected === 'object' && dfOld.vo_diem === 0, JSON.stringify(dfOld));
const dfPart = D.ensureDistrictFlags({ flags: { district: { boss_mieu_co: true, vo_diem: 5 } } });
check('merge giu flag cu, them flag moi',
  dfPart.boss_mieu_co === true && dfPart.vo_diem === 5 && dfPart.ngo_step === 0 && dfPart.boss_hang_dong === false,
  JSON.stringify(dfPart));

/* ================= 5. SaveManager.load() — save cu (vm, src/01-data.js) ================= */
(function testOldSave() {
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
      textContent: '', innerHTML: '', style: {}, children: [],
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {},
      getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, createLinearGradient: () => ({ addColorStop() {} }) })
    };
  }
  const document = {
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => mkEl(), createElement: () => mkEl(),
    addEventListener() {}, body: mkEl()
  };
  const sandbox = {
    console, Math, JSON, performance,
    setTimeout: (fn) => { fn(); return 0; },
    setInterval: () => 0, requestAnimationFrame: () => 0,
    THREE, localStorage, document, location: { href: '' },
    window: { addEventListener() {} }, navigator: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(read('src/01-data.js') + '\n;globalThis.__T = { State, SaveManager, defaultDistrictFlags };', sandbox);
  const T_ = sandbox.__T;
  // Save cu v1: co flags nhung KHONG co flags.district
  const oldSave = {
    player: { name: 'Cu Nhan', level: 3, gold: 455, silver: 40932 },
    heroes: [], leader: 0, inventory: [], quests: [], guild: {},
    stats: {}, settings: {}, flags: { tutorial: true },
    worldClock: { hour: 10, day: 5 }, weather: {}, v: 1
  };
  localStorage.setItem('mongvolam_soha_v1', JSON.stringify(oldSave));
  T_.SaveManager.load();
  check('save cu (khong flags.district) load duoc, khong crash',
    T_.State.player.name === 'Cu Nhan' && T_.State.worldClock.day === 5);
  check('save cu load xong co du flags.district mac dinh',
    T_.State.flags.district && T_.State.flags.district.boss_mieu_co === false &&
    T_.State.flags.district.ngo_step === 0 && typeof T_.State.flags.district.thac_collected === 'object',
    JSON.stringify(T_.State.flags.district));
  check('save cu khong mat flags cu (tutorial)', T_.State.flags.tutorial === true);
  // Save cu co district rieng le: giu lai + them mac dinh
  const oldSave2 = JSON.parse(JSON.stringify(oldSave));
  oldSave2.flags = { district: { boss_mieu_co: true, vo_diem: 7 } };
  localStorage.setItem('mongvolam_soha_v1', JSON.stringify(oldSave2));
  T_.SaveManager.load();
  check('save cu co district le: giu boss_mieu_co + vo_diem, them mac dinh',
    T_.State.flags.district.boss_mieu_co === true && T_.State.flags.district.vo_diem === 7 &&
    T_.State.flags.district.ngo_step === 0, JSON.stringify(T_.State.flags.district));
  // Round-trip: save() ghi lai dung district
  T_.SaveManager.save();
  const back = JSON.parse(localStorage.getItem('mongvolam_soha_v1'));
  check('SaveManager.save() ghi lai flags.district day du',
    back.flags && back.flags.district && back.flags.district.boss_mieu_co === true &&
    back.flags.district.vo_diem === 7 && back.v === 2, JSON.stringify(back.flags && back.flags.district));
})();

/* ================= 6. Engine (vm): thuong boss + link ve thanh ================= */
(function testEngine() {
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
      textContent: '', innerHTML: '', style: {}, children: [],
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {},
      getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, stroke() {}, createLinearGradient: () => ({ addColorStop() {} }) })
    };
  }
  const document = {
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => mkEl(), createElement: () => mkEl(),
    addEventListener() {}, body: mkEl()
  };
  const locStub = { href: '' };
  const sandbox = {
    console, Math, JSON, performance,
    setTimeout: (fn) => { fn(); return 0; },
    setInterval: () => 0, requestAnimationFrame: () => 0,
    THREE, localStorage, document, location: locStub,
    window: { addEventListener() {}, location: locStub }, navigator: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(read('src/10b-districts.js') + '\n' + read('src/10-district.js') +
    '\n;globalThis.__D = window.District;', sandbox);
  const District = sandbox.__D;
  check('engine nap duoc: window.District + boot la function',
    !!District && typeof District.boot === 'function' && typeof District.winBoss === 'function' &&
    typeof District.goHome === 'function' && typeof District.actShopLink === 'function');
  check('engine dung save key mongvolam_soha_v1 (helpers ton tai)',
    !!sandbox.window.__districtHelpers && typeof sandbox.window.__districtHelpers.addItemFn === 'function');

  function fakeSave() {
    return {
      player: { name: 'Test', level: 3, exp: 0, maxExp: 160, hp: 500, maxHp: 500, mp: 200, maxMp: 200, atk: 68, def: 42, gold: 455, silver: 40932 },
      inventory: [], heroes: [], leader: 0, settings: {},
      worldClock: { hour: 10, day: 3, season: 'xuan' }, weather: { kind: 'nang', remain: 180 },
      flags: { district: D.defaultDistrictFlags() }
    };
  }
  // Link ve thanh: goHome + actShopLink (khong boot 3D)
  let ctx = { save: fakeSave(), openModal() {}, updateHUD() {} };
  District.goHome.call(ctx);
  check("goHome -> '../mongvolam.html' (trang khu nam trong map/)",
    locStub.href === '../mongvolam.html', 'href=' + locStub.href);
  locStub.href = '';
  District.actShopLink.call(ctx);
  check("actShopLink (Sang Cho) -> '../Shop.html'",
    locStub.href === '../Shop.html', 'href=' + locStub.href);
  check('src/10-district.js khong con link tran mongvolam.html/Shop.html',
    !/location\.href = 'mongvolam\.html'/.test(read('src/10-district.js')) &&
    !/location\.href = 'Shop\.html'/.test(read('src/10-district.js')) &&
    read('src/10-district.js').includes("location.href = '../mongvolam.html'") &&
    read('src/10-district.js').includes("location.href = '../Shop.html'"));

  // Thuong boss Mieu Co: chay dung ham winBoss that cua engine
  const s = fakeSave();
  const before = JSON.stringify(s);
  ctx = { save: s, _boss: {}, openModal() {}, updateHUD() {} };
  District.winBoss.call(ctx, { def: D.DISTRICTS[6].boss, flagKey: 'boss_mieu_co' });
  check('thang boss mieu-co: flag boss_mieu_co = true + ghi ngay game',
    s.flags.district.boss_mieu_co === true && s.flags.district.boss_mieu_co_day === 3,
    JSON.stringify(s.flags.district));
  check('thang boss mieu-co: +8000 bac +15 KNB',
    s.player.silver === 40932 + 8000 && s.player.gold === 455 + 15,
    'silver=' + s.player.silver + ' gold=' + s.player.gold);
  check('thang boss mieu-co: +600 EXP (len cap theo cong thuc game)',
    s.player.exp === 213 && s.player.level === 5,
    'exp=' + s.player.exp + ' level=' + s.player.level + ' maxExp=' + s.player.maxExp);
  const lb = s.inventory.find(i => i.name === 'Lệnh Bài Biện Kinh');
  check('thang boss mieu-co: Lenh Bai vao tui, id lenh_bai',
    !!lb && lb.id === 'lenh_bai' && lb.qty === 1, JSON.stringify(lb));
  check('thang boss mieu-co: hoi day HP', s.player.hp === s.player.maxHp);
  check('thang boss mieu-co: save thay doi + da persist xuong localStorage',
    JSON.stringify(s) !== before && !!localStorage.getItem('mongvolam_soha_v1'));
  const persisted = JSON.parse(localStorage.getItem('mongvolam_soha_v1'));
  check('persist: silver/flag/lenh_bai trong save da luu khop save trong bo nho',
    persisted.player.silver === s.player.silver &&
    persisted.flags.district.boss_mieu_co === true &&
    persisted.inventory.some(i => i.id === 'lenh_bai'),
    'persisted silver=' + (persisted.player && persisted.player.silver));
  // Mo hang-dong sau khi co lenh bai
  check('sau khi thang mieu-co: canEnterDistrict(hang-dong) mo',
    D.canEnterDistrict(D.DISTRICTS[11], s).ok === true);
  // Thuong boss Hang Dong
  const s2 = fakeSave();
  s2.flags.district.boss_mieu_co = true;
  s2.inventory.push({ id: 'lenh_bai', name: 'Lệnh Bài Biện Kinh', qty: 1 });
  ctx = { save: s2, _boss: {}, openModal() {}, updateHUD() {} };
  District.winBoss.call(ctx, { def: D.DISTRICTS[11].boss, flagKey: 'boss_hang_dong' });
  check('thang boss hang-dong: +20000 bac +40 KNB +1500 EXP, khong them item',
    s2.player.silver === 40932 + 20000 && s2.player.gold === 455 + 40 &&
    s2.flags.district.boss_hang_dong === true &&
    s2.inventory.filter(i => i.name === 'Lệnh Bài Biện Kinh').length === 1,
    'silver=' + s2.player.silver + ' gold=' + s2.player.gold);
})();

/* ================= 7. Trang build map/*.html ================= */
(function testBuiltPages() {
  EXPECT_FILES.forEach((file, i) => {
    const def = D.DISTRICTS[i + 1];
    const p = path.join(root, 'map', file);
    check(`map/${file} ton tai`, fs.existsSync(p));
    if (!fs.existsSync(p)) return;
    const html = read('map/' + file);
    check(`map/${file} chen dung def (District.boot id=${def.id})`,
      html.includes('District.boot({"id":' + def.id + ','));
    check(`map/${file} title + ten khu`, html.includes('<title>' + def.name + ' — Mộng Võ Lâm 3D</title>'));
    check(`map/${file} link ve thanh ../mongvolam.html`,
      html.includes("location.href = '../mongvolam.html'"));
    check(`map/${file} link sang cho ../Shop.html`,
      html.includes("location.href = '../Shop.html'"));
    check(`map/${file} khong con link tran (sai thu muc)`,
      !/location\.href = 'mongvolam\.html'/.test(html) && !/location\.href = 'Shop\.html'/.test(html));
    /* __THREE__ xuat hien hop le trong three.min.js (window.__THREE__ —
       co che canh bao nap 2 lan Three.js), nen loai truoc khi kiem tra. */
    const noThreeLib = html.split('window.__THREE__').join('');
    check(`map/${file} khong con placeholder chua thay`,
      !html.includes('__DEF__') && !html.includes('__TITLE__') && !noThreeLib.includes('__THREE__') &&
      !html.includes('__DATA__') && !html.includes('__ENGINE__') && !html.includes('__DISTRICT'));
    check(`map/${file} dung save key mongvolam_soha_v1`,
      html.includes('mongvolam_soha_v1'));
    check(`map/${file} co DISTRICTS + canEnterDistrict`,
      html.includes('DISTRICTS') && html.includes('canEnterDistrict'));
  });
  const main = read('mongvolam.html');
  check('mongvolam.html co DISTRICTS + canEnterDistrict (panel + cong dung duoc)',
    main.includes('DISTRICTS') && main.includes('canEnterDistrict'));
  check('mongvolam.html co panel Ban Do Khu Vuc (open-districts)',
    main.includes('open-districts') && main.includes('district-enter'));
})();

/* ================= 8. Panel + cong dich chuyen (tinh, src) ================= */
(function testPanelGates() {
  const ui = read('src/05-ui.js');
  check('05-ui.js: nut mo panel Ban Do Khu Vuc (open-districts)',
    ui.includes("data-act=\"open-districts\"") || ui.includes("'open-districts'"));
  check("05-ui.js: bam khu mo thi luu roi sang 'map/' + file",
    ui.includes("location.href = 'map/' + def.file"));
  check('05-ui.js: khu khoa trong panel bi chan (toast 🔒), khong chuyen trang',
    ui.includes('district-enter') && ui.includes('canEnterDistrict'));
  const world = read('src/02-world.js');
  check('02-world.js: 3 cong dich chuyen -> 3 khu',
    world.includes("'cong-son'") && world.includes("'pho-dong.html'") &&
    world.includes("'gieng-co'") && world.includes("'ben-song.html'") &&
    world.includes("'cong-lang'") && world.includes("'ruong-lua.html'"));
  check("02-world.js: vao khu tu cong dung 'map/' + file",
    world.includes("location.href = 'map/' + file"));
  check('02-world.js: cong kiem tra khoa truoc khi vao (checkDistrict)',
    world.includes('checkDistrict'));
  check('3 file khu cua cong ton tai trong DISTRICTS',
    ['pho-dong.html', 'ben-song.html', 'ruong-lua.html'].every(f => D.DISTRICTS.some(d => d.file === f)));
})();

console.log('\n' + (fail === 0 ? 'ALL PASS: ' : 'FAILURES: ') + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
