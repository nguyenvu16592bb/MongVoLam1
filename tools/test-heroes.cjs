/* Harness kiểm thử logic thuần của Nhân vật 20 (src/01-data.js + nối skill
   battle/hồ sơ) — chạy bằng Node, không cần trình duyệt.
   node tools/test-heroes.cjs   (exit 1 nếu có FAIL) */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}

// Fake localStorage cho SaveManager.load() (mô phỏng save v2 cũ).
function fakeStorage(initial) {
  const store = initial ? { mongvolam_soha_v1: initial } : {};
  return {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    _store: store
  };
}

// Nạp src/01-data.js trong sandbox vm (top-level không chạm document/window).
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '01-data.js'), 'utf8');
const sandbox = { console, localStorage: fakeStorage() };
vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__T = { HERO_DEFS, RECRUIT_DEFS, RECRUIT_POOLS, SKILLS, HERO20_SKILLS, heroById, heroSkills, heroUltimate, State, SaveManager };', sandbox);
const T = sandbox.__T;
const ALL = T.HERO_DEFS.concat(T.RECRUIT_DEFS);

// 13 nhân vật cũ — snapshot id + chỉ số gốc (không được đổi).
const OLD13 = [
  { id: 'det', hp: 3838909184, atk: 87615920, def: 65035392, qi: 70015928, crit: 64655, level: 400, type: 'Giáp' },
  { id: 'tieu', hp: 2950000000, atk: 74200500, def: 51200400, qi: 68900120, crit: 58900, level: 385, type: 'Giáp' },
  { id: 'kiem', hp: 3120000000, atk: 81500000, def: 49800000, qi: 72100000, crit: 69500, level: 390, type: 'Giáp' },
  { id: 'linh', hp: 2680000000, atk: 68400000, def: 58400000, qi: 79500000, crit: 52100, level: 375, type: 'Giáp' },
  { id: 'niep', hp: 2850000000, atk: 79800000, def: 53200000, qi: 71600000, crit: 61200, level: 396, type: 'Giáp' },
  { id: 'bo', hp: 2760000000, atk: 76800000, def: 54600000, qi: 68400000, crit: 63500, level: 396, type: 'Giáp' },
  { id: 'lenhho', hp: 950000000, atk: 22000000, def: 18000000, qi: 20000000, crit: 18000, level: 120, type: 'Bính' },
  { id: 'nghlam', hp: 900000000, atk: 20000000, def: 22000000, qi: 26000000, crit: 15000, level: 120, type: 'Bính' },
  { id: 'doanh', hp: 1600000000, atk: 40000000, def: 30000000, qi: 45000000, crit: 32000, level: 200, type: 'Ất' },
  { id: 'duong', hp: 1750000000, atk: 45000000, def: 32000000, qi: 38000000, crit: 35000, level: 200, type: 'Ất' },
  { id: 'dongph', hp: 2400000000, atk: 62000000, def: 45000000, qi: 60000000, crit: 52000, level: 300, type: 'Giáp' },
  { id: 'docco', hp: 2600000000, atk: 68000000, def: 48000000, qi: 55000000, crit: 58000, level: 300, type: 'Giáp' },
  { id: 'longnu', hp: 2300000000, atk: 60000000, def: 50000000, qi: 65000000, crit: 48000, level: 300, type: 'Giáp' }
];
const NEW7 = ['quoctinh', 'hoangdung', 'hongthat', 'chuba', 'vuongtrung', 'lamtrieu', 'trieuman'];

(function main() {
  // 1. Tổng roster >= 20, id duy nhất, 6 gốc + 14 chiêu mộ
  check('tong roster >= 20', ALL.length >= 20, 'n=' + ALL.length);
  check('6 goc + 14 chieu mo', T.HERO_DEFS.length === 6 && T.RECRUIT_DEFS.length === 14,
    'goc=' + T.HERO_DEFS.length + ' chieu-mo=' + T.RECRUIT_DEFS.length);
  check('id duy nhat', new Set(ALL.map(h => h.id)).size === ALL.length,
    'trung: ' + ALL.map(h => h.id).filter((id, i, a) => a.indexOf(id) !== i).join(','));
  check('7 nhan vat moi trong RECRUIT_DEFS', NEW7.every(id => T.RECRUIT_DEFS.some(h => h.id === id)),
    'thieu: ' + NEW7.filter(id => !T.RECRUIT_DEFS.some(h => h.id === id)).join(','));
  check('nhan vat moi khong trung 13 cu', NEW7.every(id => !OLD13.some(o => o.id === id)));

  // 2. 13 nhân vật cũ nguyên vẹn id + chỉ số gốc + cấp bậc
  OLD13.forEach(o => {
    const h = T.heroById(o.id);
    const ok = h && h.hp === o.hp && h.atk === o.atk && h.def === o.def && h.qi === o.qi &&
      h.crit === o.crit && h.level === o.level && h.type === o.type;
    check('nhan vat cu nguyen ven ' + o.id, !!ok, JSON.stringify(h && { hp: h.hp, atk: h.atk, def: h.def, qi: h.qi, crit: h.crit, level: h.level, type: h.type }));
  });

  // 3. Mỗi nhân vật có đủ field def cơ bản + phẩm/cấp hợp lệ
  ALL.forEach(h => {
    check('def ' + h.id + ' du field + pham hop le',
      h.name && h.title && h.sect && ['Giáp', 'Ất', 'Bính'].includes(h.type) &&
      h.level > 0 && h.hp > 0 && h.atk > 0 && h.def > 0 && h.qi > 0 && h.crit > 0 &&
      h.bio && h.innate && Array.isArray(h.fates) && h.fates.length >= 1,
      JSON.stringify({ name: h.name, type: h.type, level: h.level }));
  });

  // 4. Mỗi nhân vật: đúng 4 skill, đúng 1 tuyệt kỹ, skill đủ field hợp lệ
  let totalSkills = 0;
  ALL.forEach(h => {
    const ss = T.heroSkills(h.id);
    totalSkills += ss.length;
    check('skill ' + h.id + ' dung 4 skill', Array.isArray(ss) && ss.length === 4, 'n=' + (ss && ss.length));
    const ults = ss.filter(s => s.ult);
    check('skill ' + h.id + ' dung 1 tuyet ky', ults.length === 1, 'ult=' + ults.map(s => s.name).join(','));
    const ult = ults[0];
    check('skill ' + h.id + ' tuyet ky manh nhat (mult 3.0-3.6, cd 11-13, cost 40-50)',
      !!ult && ult.mult >= 3.0 && ult.mult <= 3.6 && ult.cd >= 11 && ult.cd <= 13 && ult.cost >= 40 && ult.cost <= 50 &&
      ult.mult >= Math.max.apply(null, ss.filter(s => !s.ult).map(s => s.mult)),
      JSON.stringify(ult));
    ss.forEach((s, k) => {
      const ok = s && typeof s.name === 'string' && s.name.length > 0 &&
        typeof s.desc === 'string' && s.desc.length > 0 &&
        typeof s.icon === 'string' && s.icon.length > 0 &&
        typeof s.mult === 'number' && s.mult > 0 && s.mult <= 4 &&
        typeof s.cd === 'number' && s.cd >= 3 && s.cd <= 15 &&
        typeof s.cost === 'number' && s.cost >= 0 && s.cost <= 60 &&
        typeof s.aoe === 'boolean' && typeof s.color === 'number' && typeof s.ring === 'number' &&
        typeof s.ult === 'boolean' && (s.kind === 'dmg' || s.kind === 'heal');
      check('skill ' + h.id + '[' + k + '] ' + (s && s.name) + ' du field hop le', !!ok, JSON.stringify(s));
    });
    const ult2 = T.heroUltimate(h.id);
    check('heroUltimate ' + h.id + ' tra ve tuyet ky', !!ult2 && ult2.ult === true, JSON.stringify(ult2 && ult2.name));
  });
  check('tong 80 skill (20 x 4)', totalSkills === 80, 'n=' + totalSkills);
  check('ten skill khong trung trong cung nhan vat', ALL.every(h => {
    const names = T.heroSkills(h.id).map(s => s.name);
    return new Set(names).size === names.length;
  }));
  check('co it nhat 3 skill hoi mau trong roster', ALL.filter(h => T.heroSkills(h.id).some(s => s.kind === 'heal')).length >= 3,
    'healers=' + ALL.filter(h => T.heroSkills(h.id).some(s => s.kind === 'heal')).map(h => h.id).join(','));

  // 5. Cân bằng chỉ số nhân vật mới theo cấp bậc hiện có (Bính 120 / Ất 200 / Giáp 300)
  NEW7.forEach(id => {
    const h = T.heroById(id);
    const band = h.type === 'Bính' ? { lv: 120, hp: [8e8, 1e9], atk: [1.8e7, 2.4e7] }
      : h.type === 'Ất' ? { lv: 200, hp: [1.5e9, 1.9e9], atk: [3.8e7, 4.8e7] }
      : { lv: 300, hp: [2.2e9, 2.7e9], atk: [5.8e7, 7e7] };
    check('can bang ' + id + ' (' + h.type + ' Lv.' + h.level + ')',
      h.level === band.lv && h.hp >= band.hp[0] && h.hp <= band.hp[1] && h.atk >= band.atk[0] && h.atk <= band.atk[1],
      JSON.stringify({ lv: h.level, hp: h.hp, atk: h.atk }));
  });

  // 6. Tỉ lệ pool chiêu mộ vẫn cộng = 100 mỗi gói; phẩm mới đều có gói chứa
  [1, 2, 3].forEach(t => {
    const sum = T.RECRUIT_POOLS[t].rates.reduce((a, r) => a + r.w, 0);
    check('pool ' + t + ' ti le = 100', sum === 100, 'sum=' + sum);
  });
  ['Bính', 'Ất', 'Giáp'].forEach(g => {
    const inPool = [1, 2, 3].some(t => T.RECRUIT_POOLS[t].rates.some(r => r.grade === g));
    const heroes = ALL.filter(h => h.type === g);
    check('pham ' + g + ' co trong pool + co ' + heroes.length + ' nhan vat', inPool && heroes.length > 0);
  });
  check('pool 1 chi co Binh/At (khong doi)', JSON.stringify(T.RECRUIT_POOLS[1].rates) === JSON.stringify([{ grade: 'Bính', w: 70 }, { grade: 'Ất', w: 30 }]));
  check('pool 3 chi co Giap/At (khong doi)', JSON.stringify(T.RECRUIT_POOLS[3].rates) === JSON.stringify([{ grade: 'Giáp', w: 65 }, { grade: 'Ất', w: 35 }]));

  // 7. Fallback: id lạ vẫn trả 4 skill + 1 tuyệt kỹ, không crash
  let fb;
  try { fb = T.heroSkills('khong-co-id'); } catch (e) { fb = null; }
  check('fallback id la tra 4 skill', Array.isArray(fb) && fb.length === 4, JSON.stringify(fb && fb.length));
  check('fallback id la co 1 tuyet ky', !!fb && fb.filter(s => s.ult).length === 1);
  check('fallback dung ten 4 tuyet ky chung cu', !!fb && fb.every((s, i) => s.name === T.SKILLS[i].name),
    JSON.stringify(fb && fb.map(s => s.name)));

  // 8. Save v2 cũ (chỉ 6 gốc, không có nhân vật mới) vẫn load được
  const oldSave = JSON.stringify({
    v: 2, player: { level: 3, gold: 455, silver: 40932 }, leader: 0,
    heroes: OLD13.slice(0, 6).map(o => ({ id: o.id, level: o.level, bonus: { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 } })),
    quests: [], guild: {}, inventory: [], customProps: [], stats: {}, settings: {}, flags: {}
  });
  sandbox.localStorage = fakeStorage(oldSave);
  let loadErr = null;
  try { T.SaveManager.load(); } catch (e) { loadErr = e; }
  check('save v2 cu (6 goc) load khong loi', !loadErr, loadErr && String(loadErr));
  check('save v2 cu: doi hinh van 6 goc', T.State.heroes.length === 6, 'n=' + T.State.heroes.length);
  check('save v2 cu: khong tu them nhan vat moi vao doi hinh', !T.State.heroes.some(h => NEW7.includes(h.id)),
    JSON.stringify(T.State.heroes.map(h => h.id)));
  check('save v2 cu: def nhan vat moi van ton tai de chieu mo sau', NEW7.every(id => !!T.heroById(id)));
  check('save v2 cu: leader van 0', T.State.leader === 0, 'leader=' + T.State.leader);

  // 9. Save có đệ tử chiêu mộ cũ (lenhho) vẫn append đúng, không nhân đôi
  const oldSave2 = JSON.stringify({
    v: 2, player: { level: 3 }, leader: 6,
    heroes: OLD13.slice(0, 6).concat([{ id: 'lenhho', level: 125, bonus: { hp: 1000, atk: 10, def: 10, qi: 10, crit: 1 } }])
      .map(o => ({ id: o.id, level: o.level, bonus: o.bonus || { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 } })),
    quests: [], guild: {}, inventory: [], customProps: [], stats: {}, settings: {}, flags: {}
  });
  sandbox.localStorage = fakeStorage(oldSave2);
  // Reset State.heroes về mặc định 6 gốc trước khi load save thứ 2 (vm dùng chung State).
  T.State.heroes.length = 0;
  T.HERO_DEFS.forEach(h => T.State.heroes.push({ id: h.id, level: h.level, bonus: { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 } }));
  loadErr = null;
  try { T.SaveManager.load(); } catch (e) { loadErr = e; }
  check('save co lenhho load khong loi', !loadErr, loadErr && String(loadErr));
  const lh = T.State.heroes.find(h => h.id === 'lenhho');
  check('save co lenhho: append 1 lan, giu cap 125 + bonus', !!lh && lh.level === 125 && lh.bonus.hp === 1000 &&
    T.State.heroes.filter(h => h.id === 'lenhho').length === 1,
    JSON.stringify(lh));

  // 10. Nối battle / hồ sơ / UI: marker HERO20 + dùng heroSkills/activeSkills, fallback còn đó
  const battleSrc = fs.readFileSync(path.join(__dirname, '..', 'src', '03-battle.js'), 'utf8');
  const infoSrc = fs.readFileSync(path.join(__dirname, '..', 'src', '04-info.js'), 'utf8');
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', '05-ui.js'), 'utf8');
  const dataSrc = fs.readFileSync(path.join(__dirname, '..', 'src', '01-data.js'), 'utf8');
  check('01-data co marker HERO20-BEGIN/END', dataSrc.includes('/* HERO20-BEGIN') && dataSrc.includes('/* HERO20-END'));
  check('03-battle dung heroSkills + activeSkills', battleSrc.includes('heroSkills(') && battleSrc.includes('activeSkills()'));
  check('03-battle triggerSkill co check noi luc (cost/mp)', battleSrc.includes('sk.cost') && battleSrc.includes('this.mp'));
  check('03-battle xu ly skill heal theo kind', battleSrc.includes("sk.kind === 'heal'"));
  check('03-battle fallback SKILLS con do', battleSrc.includes('SKILLS') && battleSrc.includes(': SKILLS'));
  check('04-info hien skill theo heroSkills(h.id)', infoSrc.includes('heroSkills(h.id)'));
  check('04-info khong con 3 skill cung Song Ma Quyen', !infoSrc.includes('Song Ma Quyền') || infoSrc.includes('heroSkills(h.id)'));
  check('05-ui syncBattle dung activeSkills + nhan nut skill', uiSrc.includes('activeSkills()') && uiSrc.includes('bSkills'));
  check('05-ui + 03-battle con marker SHOP/ARENA10', uiSrc.includes('SHOP-BEGIN') && uiSrc.includes('ARENA10-BEGIN') &&
    battleSrc.includes('ARENA10-BEGIN') && battleSrc.includes('ARENA10-END'));
  check('file cam sua khong co marker HERO20',
    ['02-world.js', '03b-arenas.js', '07-shop.js'].every(f =>
      !fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').includes('HERO20')));

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
