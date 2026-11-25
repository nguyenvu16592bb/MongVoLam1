/* Harness kiểm thử logic thuần của Battle Map 1..10 (src/01-data.js) — chạy bằng Node, không cần trình duyệt.
   node tools/test-arenas.cjs   (exit 1 nếu có FAIL) */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}

// Nạp src/01-data.js trong sandbox vm (file là script thường, không phải module;
// top-level không chạm document/window nên chạy được trên Node).
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '01-data.js'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(src + '\n;globalThis.__T = { ARENAS, ENEMY_DEFS, ARENA_ENEMIES, ARENA_BOSSES, resolveArenaKey };', sandbox);
const T = sandbox.__T;
const ARENAS = T.ARENAS;

const NEW_KEYS = ['bm1', 'bm2', 'bm3', 'bm4', 'bm5', 'bm6', 'bm7', 'bm8', 'bm9', 'bm10'];
const OLD_KEYS = ['bamboo', 'buddha', 'city', 'van-mong-dam', 'kiem-linh-coc', 'xanh-tu-nam', 'mon-quan', 'thien-hoa-dan-dinh'];
const BUILDERS = ['bamboo', 'buddha', 'city', 'snow', 'desert', 'volcano', 'swamp', 'sky', 'cave', 'lake'];

(function main() {
  // 1. Đủ đúng 10 map mới, key bm1..bm10, num 1..10 theo thứ tự
  const fresh = NEW_KEYS.filter(k => ARENAS[k] && !ARENAS[k].legacy);
  check('du 10 map moi bm1..bm10', fresh.length === 10, 'n=' + fresh.length);
  check('num 1..10 theo dung thu tu', NEW_KEYS.every((k, i) => ARENAS[k] && ARENAS[k].num === i + 1),
    JSON.stringify(NEW_KEYS.map(k => ARENAS[k] && ARENAS[k].num)));
  check('ten hien thi "Battle Map N"', NEW_KEYS.every((k, i) => ARENAS[k].name.indexOf('Battle Map ' + (i + 1) + ' ') === 0),
    JSON.stringify(NEW_KEYS.map(k => ARENAS[k].name)));

  // 2. Mỗi map đủ field bắt buộc + boss + kỹ năng Boss + thưởng Boss + >=3 quái
  const req = ['key', 'num', 'name', 'short', 'icon', 'mul', 'exp', 'silver', 'gold', 'tip', 'badge', 'boss', 'bossSkill', 'bossReward', 'recLvl', 'drops', 'desc', 'builder', 'enemies'];
  NEW_KEYS.forEach(k => {
    const a = ARENAS[k];
    check('map ' + k + ' du field', req.every(f => a[f] !== undefined && a[f] !== '' && a[f] !== null),
      'thieu: ' + req.filter(f => a[f] === undefined || a[f] === '' || a[f] === null).join(','));
    check('map ' + k + ' boss co (Lv.)', /\(Lv\.\d+\)/.test(a.boss), a.boss);
    check('map ' + k + ' >=3 quai', Array.isArray(a.enemies) && a.enemies.length >= 3, JSON.stringify(a.enemies));
    check('map ' + k + ' builder hop le', BUILDERS.includes(a.builder), a.builder);
  });
  check('chi bm10 la map boss cuoi', NEW_KEYS.filter(k => ARENAS[k].isBoss).join(',') === 'bm10',
    JSON.stringify(NEW_KEYS.filter(k => ARENAS[k].isBoss)));

  // 3. Độ khó mul tăng dần 1 -> 10, từ 1.0 đến 5.5
  const muls = NEW_KEYS.map(k => ARENAS[k].mul);
  check('mul tang dan 1->10', muls.every((m, i) => i === 0 || m > muls[i - 1]), JSON.stringify(muls));
  check('mul bm1=1.0, bm10=5.5', muls[0] === 1.0 && muls[9] === 5.5, JSON.stringify(muls));

  // 4. Thưởng EXP/bạc/KNB tăng dần theo mul (sai số <=5% so với công thức 150*mul / 2800*mul)
  const exps = NEW_KEYS.map(k => ARENAS[k].exp);
  const silvers = NEW_KEYS.map(k => ARENAS[k].silver);
  const golds = NEW_KEYS.map(k => ARENAS[k].gold);
  check('EXP tang dan', exps.every((v, i) => i === 0 || v > exps[i - 1]), JSON.stringify(exps));
  check('bac tang dan', silvers.every((v, i) => i === 0 || v > silvers[i - 1]), JSON.stringify(silvers));
  check('KNB khong giam', golds.every((v, i) => i === 0 || v >= golds[i - 1]), JSON.stringify(golds));
  check('EXP ~ 150*mul (+-5%)', NEW_KEYS.every(k => Math.abs(ARENAS[k].exp - 150 * ARENAS[k].mul) / (150 * ARENAS[k].mul) <= 0.05),
    JSON.stringify(NEW_KEYS.map(k => ARENAS[k].exp + '/' + Math.round(150 * ARENAS[k].mul))));
  check('bac ~ 2800*mul (+-5%)', NEW_KEYS.every(k => Math.abs(ARENAS[k].silver - 2800 * ARENAS[k].mul) / (2800 * ARENAS[k].mul) <= 0.05),
    JSON.stringify(NEW_KEYS.map(k => ARENAS[k].silver + '/' + Math.round(2800 * ARENAS[k].mul))));
  check('KNB nguyen, >=1', golds.every(g => Number.isInteger(g) && g >= 1), JSON.stringify(golds));
  check('EXP/bac/KNB duong', NEW_KEYS.every(k => ARENAS[k].exp > 0 && ARENAS[k].silver > 0 && ARENAS[k].gold > 0));

  // 5. Boss riêng: tên không trùng, khớp với arena.boss; dàn quái riêng từng map
  const bossNames = NEW_KEYS.map(k => T.ARENA_BOSSES[k] && T.ARENA_BOSSES[k].name);
  check('ARENA_BOSSES du 10 map', bossNames.every(Boolean), JSON.stringify(bossNames));
  check('ten boss khong trung nhau', new Set(bossNames).size === 10, JSON.stringify(bossNames));
  check('boss def khop arena.boss', NEW_KEYS.every(k => ARENAS[k].boss.indexOf(T.ARENA_BOSSES[k].name) === 0),
    JSON.stringify(NEW_KEYS.map(k => ARENAS[k].boss + ' vs ' + T.ARENA_BOSSES[k].name)));
  check('boss hp he so > 1.5, atk > 1.3', NEW_KEYS.every(k => T.ARENA_BOSSES[k].hp > 1.5 && T.ARENA_BOSSES[k].atk > 1.3 && T.ARENA_BOSSES[k].boss === true),
    JSON.stringify(NEW_KEYS.map(k => T.ARENA_BOSSES[k].hp + '/' + T.ARENA_BOSSES[k].atk)));
  check('boss hp tang dan theo map', NEW_KEYS.map(k => T.ARENA_BOSSES[k].hp).every((v, i, a) => i === 0 || v >= a[i - 1]));
  NEW_KEYS.forEach(k => {
    const roster = T.ARENA_ENEMIES[k];
    check('map ' + k + ' roster >=3 quai co hp/atk/robe/hair/scale',
      Array.isArray(roster) && roster.length >= 3 &&
      roster.every(d => d.name && d.hp > 0 && d.atk > 0 && typeof d.robe === 'number' && typeof d.hair === 'number' && d.scale > 0),
      JSON.stringify(roster));
    check('map ' + k + ' ten quai roster khop arena.enemies',
      roster.every(d => ARENAS[k].enemies.includes(d.name)), JSON.stringify(roster.map(d => d.name)));
  });
  check('ENEMY_DEFS cu van con lam fallback (4 mon)', Array.isArray(T.ENEMY_DEFS) && T.ENEMY_DEFS.length === 4);

  // 6. 8 id map cũ vẫn hợp lệ: còn entry, đánh dấu legacy, resolve sang map mới hợp lệ
  OLD_KEYS.forEach(k => {
    check('id cu ' + k + ' con entry + legacy', !!ARENAS[k] && ARENAS[k].legacy === true, JSON.stringify(ARENAS[k] && ARENAS[k].legacy));
    const r = T.resolveArenaKey(k);
    check('id cu ' + k + ' resolve -> ' + r, NEW_KEYS.includes(r), 'resolve=' + r);
  });
  check('resolve id la -> bm1', T.resolveArenaKey('khong-co') === 'bm1', T.resolveArenaKey('khong-co'));
  check('resolve bm5 giu nguyen', T.resolveArenaKey('bm5') === 'bm5');
  check('modal chi hien 10 map (khong legacy)', Object.keys(ARENAS).filter(k => !ARENAS[k].legacy).length === 10,
    'n=' + Object.keys(ARENAS).filter(k => !ARENAS[k].legacy).length);

  // 7. Builder 3D mới tồn tại trong src/03b-arenas.js; dispatch + roster có trong src/03-battle.js
  const arenasSrc = fs.readFileSync(path.join(__dirname, '..', 'src', '03b-arenas.js'), 'utf8');
  ['buildSnow', 'buildDesert', 'buildVolcano', 'buildSwamp', 'buildSky', 'buildCave', 'buildLake'].forEach(fn => {
    check('03b co builder ' + fn, arenasSrc.includes(fn + '()'), fn);
  });
  check('03b co helper chung tai dung', ['arenaBase', 'flatGround', 'daisDisc', 'scatterRocks', 'driftParticles', 'glowCrystal'].every(h => arenasSrc.includes('function ' + h)),
    'thieu helper');
  const battleSrc = fs.readFileSync(path.join(__dirname, '..', 'src', '03-battle.js'), 'utf8');
  check('03-battle dispatch du 7 builder moi', ['snow', 'desert', 'volcano', 'swamp', 'sky', 'cave', 'lake'].every(b => battleSrc.includes("b === '" + b + "'")), 'thieu dispatch');
  check('03-battle spawnWave dung ARENA_ENEMIES/ARENA_BOSSES', battleSrc.includes('ARENA_ENEMIES') && battleSrc.includes('ARENA_BOSSES'));
  check('03-battle buildArena resolve id cu', battleSrc.includes('resolveArenaKey'));
  const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', '05-ui.js'), 'utf8');
  check('05-ui modal loc legacy', uiSrc.includes('!ARENAS[k].legacy'));
  check('05-ui modal hien quai + skill boss', uiSrc.includes('bossSkill') && uiSrc.includes('enemies'));

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
