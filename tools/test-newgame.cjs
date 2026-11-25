/* Test cho src/08-newgame.js — chay bang Node, khong can trinh duyet.
   node tools/test-newgame.cjs   (exit 1 neu co FAIL) */
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const ng = require('../src/08-newgame.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}
/* localStorage gia cho test */
function fakeStorage() {
  var store = {};
  return {
    getItem: function (k) { return (k in store) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    _store: store
  };
}

(function main() {
  // 0. File khong chua chuoi pha the script; template co placeholder dung 1 lan
  var jsSrc = fs.readFileSync(path.join(SRC, '08-newgame.js'), 'utf8');
  check('08-newgame.js khong chua </script', jsSrc.indexOf('</script') < 0);
  check('08-newgame.js co marker NEWGAME-BEGIN/END',
    jsSrc.indexOf('/* NEWGAME-BEGIN */') >= 0 && jsSrc.indexOf('/* NEWGAME-END */') >= 0);
  var tpl = fs.readFileSync(path.join(SRC, 'newgame.template.html'), 'utf8');
  check('template co placeholder __NEWGAME__ dung 1 lan',
    (tpl.match(/__NEWGAME__/g) || []).length === 1);
  check('template co du 7 man hinh (loading/main-menu/create/settings/guide/gallery/bye)',
    ['id="loading"', 'id="main-menu"', 'id="create"', 'id="settings"', 'id="guide"', 'id="gallery"', 'id="bye"']
      .every(function (s) { return tpl.indexOf(s) >= 0; }));
  // Mo phong build (nhu build.mjs, dung () => de tranh loi $): khong con placeholder
  var built = tpl.replaceAll('__NEWGAME__', function () { return jsSrc; });
  check('build mo phong: khong con __NEWGAME__', built.indexOf('__NEWGAME__') < 0);
  check('build mo phong: co marker NEWGAME-BEGIN', built.indexOf('/* NEWGAME-BEGIN */') >= 0);

  // 1. Ten rong bi tu choi
  var r = ng.ngCreateSave({ name: '   ', gender: 'Nam', color: 'do', hair: 'bui-cao', sectId: 'thieulam', heroId: 'det' });
  check('ten rong bi tu choi', !r.ok && r.save === null, JSON.stringify(r));
  // 2. Ten >12 ky tu bi tu choi
  r = ng.ngCreateSave({ name: 'ABCDEFGHIJKLM', gender: 'Nam', color: 'do', hair: 'bui-cao', sectId: 'thieulam', heroId: 'det' });
  check('ten 13 ky tu bi tu choi', !r.ok && r.save === null, JSON.stringify(r));
  // 2b. Ten 12 ky tu duoc chap nhan; ten co khoang trang duoc trim ('Vo Danh Kiem' = 12 ky tu)
  r = ng.ngCreateSave({ name: '  Vo Danh Kiem  ', gender: 'Nam', color: 'do', hair: 'bui-cao', sectId: 'thieulam', heroId: 'det' });
  check('ten 12 ky tu (trim) duoc chap nhan, luu dung ten', r.ok && r.save.player.name === 'Vo Danh Kiem',
    r.ok ? r.save.player.name : JSON.stringify(r));

  // 3. Phai cong dung chi so (xem truoc)
  var st = ng.ngPreviewStats('hoason');
  check('Hoa Son: Cong 68+16=84, toc do 7.5+1=8.5', st.atk === 84 && st.speed === 8.5, JSON.stringify(st));
  st = ng.ngPreviewStats('thieulam');
  check('Thieu Lam: HP 500+150=650, Thu 42+12=54', st.hp === 650 && st.def === 54, JSON.stringify(st));
  st = ng.ngPreviewStats('vodang');
  check('Vo Dang: HP 580, Noi luc 280, Cong 76, Thu 48', st.hp === 580 && st.mp === 280 && st.atk === 76 && st.def === 48, JSON.stringify(st));
  st = ng.ngPreviewStats('minhgiao');
  check('Minh Giao: Cong 88, HP 540, Noi luc 240', st.atk === 88 && st.hp === 540 && st.mp === 240, JSON.stringify(st));
  check('du 6 mon phai', ng.NEWGAME_SECTS.length === 6, ng.NEWGAME_SECTS.map(function (s) { return s.name; }).join(','));
  check('12 ten goi y, 8 mau ao, 5 kieu toc',
    ng.NEWGAME_NAME_SUGGESTIONS.length === 12 && ng.NEWGAME_ROBE_COLORS.length === 8 && ng.NEWGAME_HAIRSTYLES.length === 5);

  // 4. De tu khoi dau thanh leader + save dung schema v2
  r = ng.ngCreateSave({ name: 'Phong Vo Ky', gender: 'Nữ', color: 'tim', hair: 'xoa-dai', sectId: 'ngami', heroId: 'bo' });
  check('tao save ok voi de tu bo', r.ok, JSON.stringify(r));
  var s = r.save;
  check('leader = index cua Bo Kinh Van (5)', s.leader === 5 && s.heroes[5].id === 'bo', 'leader=' + s.leader);
  check('player: ten/phai/vu khi/look/sectDesc dung',
    s.player.name === 'Phong Vo Ky' && s.player.faction === 'Nga Mi' &&
    s.player.weapon === 'Nga Mi Song Kiếm' && s.player.look.gender === 'Nữ' &&
    s.player.look.color === 'tim' && s.player.look.hair === 'xoa-dai' &&
    s.player.sectDesc.indexOf('Nga Mi') >= 0,
    JSON.stringify(s.player.look) + ' ' + s.player.faction);
  check('Nga Mi: HP 580, Noi luc 260, Thu 48', s.player.maxHp === 580 && s.player.hp === 580 && s.player.maxMp === 260 && s.player.def === 48,
    'hp=' + s.player.maxHp + ' mp=' + s.player.maxMp + ' def=' + s.player.def);
  check('save v2 day du field', s.v === 2 && Array.isArray(s.heroes) && Array.isArray(s.quests) &&
    Array.isArray(s.inventory) && Array.isArray(s.customProps) && s.guild && s.stats && s.settings && s.flags,
    Object.keys(s).join(','));
  check('flags.createdVia = newgame', s.flags.createdVia === 'newgame', JSON.stringify(s.flags));
  check('cap 3, exp 0/160, vang 455, bac 40932',
    s.player.level === 3 && s.player.exp === 0 && s.player.maxExp === 160 && s.player.gold === 455 && s.player.silver === 40932);

  // 5. Reset sach: save moi khong con de tu chieu mo cu / tien / stats cu
  var dirty = ng.ngDefaultSave();
  dirty.heroes.push({ id: 'lenhho', level: 130, bonus: { hp: 1, atk: 2, def: 3, qi: 4, crit: 5 } });
  dirty.heroes.push({ id: 'duong', level: 210, bonus: { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 } });
  dirty.player.gold = 99999; dirty.player.silver = 88888;
  dirty.stats = { battles: 50, wins: 40, kills: 300 };
  dirty.quests[0].done = true; dirty.quests[0].progress = 1;
  dirty.flags.recruitFreeDate = '2026-11-25'; dirty.flags.shop = { hourKey: 'x', claimed: { 'goi-tanthu': 'ever' } };
  var fresh = ng.ngCreateSave({ name: 'Vo Danh Kiem', gender: 'Nam', color: 'den', hair: 'toc-ngan', sectId: 'caibang', heroId: 'det', prevSettings: dirty.settings });
  var fs2 = fresh.save;
  check('reset sach: chi 6 de tu goc, khong con lenhho/duong',
    fs2.heroes.length === 6 && !fs2.heroes.some(function (h) { return h.id === 'lenhho' || h.id === 'duong'; }),
    fs2.heroes.map(function (h) { return h.id; }).join(','));
  check('reset sach: stats ve 0', fs2.stats.battles === 0 && fs2.stats.wins === 0 && fs2.stats.kills === 0, JSON.stringify(fs2.stats));
  check('reset sach: tien ve mac dinh 455/40932', fs2.player.gold === 455 && fs2.player.silver === 40932);
  check('reset sach: quest ve mac dinh (5, chua xong)', fs2.quests.length === 5 && fs2.quests.every(function (q) { return !q.done && q.progress === 0; }));
  check('reset sach: flags chi con tutorial/shop/createdVia',
    fs2.flags.createdVia === 'newgame' && fs2.flags.tutorial === false && !fs2.flags.recruitFreeDate &&
    JSON.stringify(fs2.flags.shop) === '{}', JSON.stringify(fs2.flags));
  check('reset sach: bonus de tu ve 0', fs2.heroes.every(function (h) {
    return h.bonus.hp === 0 && h.bonus.atk === 0 && h.bonus.def === 0 && h.bonus.qi === 0 && h.bonus.crit === 0;
  }));

  // 6. Settings giu nguyen khi tao moi (prevSettings) + chuan hoa speed la
  var withSet = ng.ngCreateSave({ name: 'A', gender: 'Nam', color: 'do', hair: 'bui-cao', sectId: 'thieulam', heroId: 'kiem',
    prevSettings: { muted: true, autoBattle: false, autoSkill: false, speed: 3 } });
  check('tao moi giu settings cu (muted/auto/speed 3)',
    withSet.save.settings.muted === true && withSet.save.settings.autoBattle === false && withSet.save.settings.speed === 3,
    JSON.stringify(withSet.save.settings));
  check('speed la (7) ve 1', ng.ngNormalizeSettings({ speed: 7 }).speed === 1);
  check('speed 5 hop le', ng.ngNormalizeSettings({ speed: 5 }).speed === 5);
  check('thieu phai / thieu de tu bi tu choi',
    !ng.ngCreateSave({ name: 'A', sectId: 'khong-co', heroId: 'det' }).ok &&
    !ng.ngCreateSave({ name: 'A', sectId: 'thieulam', heroId: 'lenhho' }).ok, 'lenhho khong phai de tu khoi dau');

  // 7. Tiep tuc khi co / khong co save
  var store = fakeStorage();
  var t = ng.ngContinueTarget(store);
  check('chua co save: tiep tuc bi chan, co thong bao ro',
    !t.ok && t.reason.indexOf('Chưa có dữ liệu') >= 0 && t.reason.indexOf('Chơi Mới') >= 0, JSON.stringify(t));
  check('chua co save: ngHasSave false', ng.ngHasSave(store) === false);
  ng.ngPersistSave(store, ng.ngDefaultSave());
  t = ng.ngContinueTarget(store);
  check('co save: tiep tuc vao mongvolam.html', t.ok && t.href === 'mongvolam.html', JSON.stringify(t));
  check('save round-trip JSON giu du lieu', (function () {
    var loaded = ng.ngLoadSave(store);
    return loaded && loaded.v === 2 && loaded.player.name === 'Song Ma Quyền Phái' && loaded.heroes.length === 6;
  })());

  // 8. Cai dat khi chua co save: tao save mac dinh day du roi ghi settings
  var store2 = fakeStorage();
  var set = ng.ngSaveSettings(store2, { muted: true, speed: 2 });
  var s2 = ng.ngLoadSave(store2);
  check('luu settings khi chua co save: tao save v2 day du',
    !!s2 && s2.v === 2 && s2.player && s2.heroes.length === 6 && s2.settings.muted === true && s2.settings.speed === 2,
    JSON.stringify(set));
  ng.ngSaveSettings(store2, { speed: 5 });
  check('doi speed 2 -> 5, cac field khac giu nguyen',
    ng.ngLoadSave(store2).settings.speed === 5 && ng.ngLoadSave(store2).settings.muted === true);

  // 9. Bo suu tap: 20 de tu, danh dau DA MO / CHUA MO dung
  var gal = ng.ngGallery(s2);
  check('gallery du 20 de tu (6 goc + 14 chieu mo)', gal.length === 20 &&
    gal.filter(function (h) { return h.starter; }).length === 6, 'n=' + gal.length);
  check('gallery: 6 de tu goc DA MO, 14 chieu mo CHUA MO',
    gal.filter(function (h) { return h.owned; }).length === 6 &&
    gal.filter(function (h) { return !h.owned; }).length === 14);
  var s3 = ng.ngDefaultSave();
  s3.heroes.push({ id: 'lenhho', level: 130, bonus: { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 } });
  var gal3 = ng.ngGallery(s3);
  var lh = gal3.filter(function (h) { return h.id === 'lenhho'; })[0];
  check('gallery: lenhho DA MO cap 130 sau khi chieu mo', lh.owned && lh.ownedLevel === 130, JSON.stringify(lh));
  check('gallery: ten/pham/cap goc dung (det Giap 400, trieuman Binh 120)',
    gal3.filter(function (h) { return h.id === 'det'; })[0].type === 'Giáp' &&
    gal3.filter(function (h) { return h.id === 'trieuman'; })[0].level === 120);
  check('ten de tu goc dung that (6 id)', (function () {
    var ids = ng.ngStarterHeroes().map(function (h) { return h.id; }).sort().join(',');
    return ids === 'bo,det,kiem,linh,niep,tieu';
  })());

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
