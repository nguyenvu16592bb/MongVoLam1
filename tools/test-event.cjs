/* Test cho src/09-event.js — chay bang Node, khong can trinh duyet.
   TZ=Asia/Ho_Chi_Minh node tools/test-event.cjs   (exit 1 neu co FAIL) */
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const ev = require('../src/09-event.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}
function fresh() { return ev.eventDefaultSave(); }
/* Thu 4 2026-11-25 10:00 gio dia phuong (VM chay TZ=Asia/Ho_Chi_Minh khi test). */
function ms(y, mo, d, h, mi) { return new Date(y, mo - 1, d, h || 0, mi || 0, 0).getTime(); }

(function main() {
  // 0. Ngay dia phuong khac UTC: 2026-11-25T18:00Z = 26/11 01:00 +07
  var k = ev.eventLocalDayKey(Date.parse('2026-11-25T18:00:00Z'));
  check('ngay dia phuong +07: 18:00Z 25/11 -> 26/11', k === '2026-11-26', 'got ' + k);
  check('ngay UTC cua shop van la 25/11 (doi chieu)', new Date(Date.parse('2026-11-25T18:00:00Z')).toISOString().slice(0, 10) === '2026-11-25');

  // 1. Diem danh: nhan 1 lan/ngay, lan 2 bi tu choi, cong dung tien
  var s = fresh();
  var t1 = ms(2026, 11, 25, 10, 0);
  var r = ev.eventClaimCheckin(s, t1);
  check('diem danh ngay 1 ok', r.ok && r.day === 1 && r.streak === 1, JSON.stringify(r));
  check('diem danh ngay 1 cong dung 2000 bac', s.player.silver === 40932 + 2000, 'silver=' + s.player.silver);
  check('diem danh ghi claimed theo ngay dia phuong', s.flags.event.checkin.claimed['2026-11-25'] === 1);
  var before = JSON.stringify(s);
  r = ev.eventClaimCheckin(s, t1);
  check('diem danh lan 2 cung ngay bi tu choi, save khong doi', !r.ok && JSON.stringify(s) === before, JSON.stringify(r));

  // 2. Chuoi 7 ngay: ngay lien tiep tang streak, ngay 7 thuong lon, nghi 1 ngay reset ve 1
  // (thang 11 chi co 30 ngay — vong lap 25..30 la 6 ngay, ngay 7 la 01/12)
  s = fresh();
  var streaks = [];
  for (var d = 25; d <= 30; d++) {
    r = ev.eventClaimCheckin(s, ms(2026, 11, d, 10, 0));
    streaks.push(r.ok ? r.day : -1);
  }
  r = ev.eventClaimCheckin(s, ms(2026, 12, 1, 10, 0));
  streaks.push(r.ok ? r.day : -1);
  check('chuoi 7 ngay: ngay 1..7 dung thu tu', JSON.stringify(streaks) === '[1,2,3,4,5,6,7]', JSON.stringify(streaks));
  check('ngay 7 thuong: +300 EXP va Tu Khi Dan x5 vao tui', s.inventory.some(function (i) { return i.name === 'Tụ Khí Đan' && i.qty === 3 + 5; }), JSON.stringify(s.inventory));
  r = ev.eventClaimCheckin(s, ms(2026, 12, 3, 10, 0)); // nghi 02/12
  check('nghi 1 ngay thi chuoi reset ve ngay 1', r.ok && r.day === 1 && r.streak === 1, JSON.stringify(r));
  // ngay 8 lien tiep (qua 7) quay vong ve ngay 1
  s = fresh();
  for (var d2 = 25; d2 <= 30; d2++) ev.eventClaimCheckin(s, ms(2026, 11, d2, 10, 0));
  ev.eventClaimCheckin(s, ms(2026, 12, 1, 10, 0));
  r = ev.eventClaimCheckin(s, ms(2026, 12, 2, 10, 0));
  check('ngay thu 8 lien tiep quay vong ve ngay 1', r.ok && r.day === 1 && r.streak === 8, JSON.stringify(r));

  // 3. EXP theo dung cong thuc game (gainExp): len cap thi maxExp *= 1.42, +120 maxHp...
  s = fresh();
  s.player.exp = 150; s.player.maxExp = 160; // con 10 EXP nua len cap
  var lv = ev.eventGainExp(s, 150);
  check('gainExp len cap: level 3->4 (con du EXP tinh tiep)', lv >= 1 && s.player.level === 4, 'level=' + s.player.level + ' exp=' + s.player.exp);
  check('gainExp len cap: maxExp=round(160*1.42)=227', s.player.maxExp === 227, 'maxExp=' + s.player.maxExp);
  check('gainExp len cap: maxHp +120, atk +15, def +10', s.player.maxHp === 620 && s.player.atk === 83 && s.player.def === 52,
    'maxHp=' + s.player.maxHp + ' atk=' + s.player.atk + ' def=' + s.player.def);

  // 4. Nhiem vu ngay doc stats THAT (baseline chup luc mo trang)
  s = fresh();
  var t = ms(2026, 11, 25, 10, 0);
  ev.eventEnsureDailyDay(s, t); // baseline: wins=0, battles=0
  s.stats.wins = 1; s.stats.battles = 1;
  var q1 = ev.EVENT_DAILY_QUESTS[0]; // thang 1 tran
  var pr = ev.eventDailyProgress(s, q1, t);
  check('nhiem vu ngay doc wins that: 1/1', pr.done && pr.progress === 1, JSON.stringify(pr));
  r = ev.eventClaimDaily(s, 'd-win1', t);
  check('nhan thuong thang 1 tran cong dung tien', r.ok && s.player.silver === 40932 + 1500, 'silver=' + s.player.silver + ' ' + JSON.stringify(r));
  r = ev.eventClaimDaily(s, 'd-win1', t);
  check('nhan trung nhiem vu ngay bi tu choi', !r.ok, JSON.stringify(r));
  var q3 = ev.EVENT_DAILY_QUESTS[2]; // danh 3 tran
  pr = ev.eventDailyProgress(s, q3, t);
  check('danh 3 tran moi danh 1 -> chua xong (1/3)', !pr.done && pr.progress === 1, JSON.stringify(pr));
  r = ev.eventClaimDaily(s, 'd-battle3', t);
  check('chua xong ma doi nhan bi tu choi', !r.ok, JSON.stringify(r));
  // baseline khong tinh thang truoc khi mo trang: thang truoc baseline phai = 0 tien trinh
  s = fresh(); s.stats.wins = 5;
  ev.eventEnsureDailyDay(s, t); // baseline wins=5
  pr = ev.eventDailyProgress(s, ev.EVENT_DAILY_QUESTS[0], t);
  check('thang truoc khi mo trang khong tinh (baseline=5, progress 0)', pr.progress === 0 && !pr.done, JSON.stringify(pr));
  // manual: mua o cho
  s = fresh();
  r = ev.eventClaimDaily(s, 'd-shop', t);
  check('nhiem vu manual chua bam "Da lam xong" thi khong cho nhan', !r.ok, JSON.stringify(r));
  r = ev.eventDailyMarkManual(s, 'd-shop', t);
  check('bam "Da lam xong" ok', r.ok, JSON.stringify(r));
  r = ev.eventClaimDaily(s, 'd-shop', t);
  check('sau khi tu xac nhan thi nhan duoc', r.ok && s.player.silver === 40932 + 2000, JSON.stringify(r));
  // dang nhap luon xong
  s = fresh();
  pr = ev.eventDailyProgress(s, ev.EVENT_DAILY_QUESTS[8], t);
  check('nhiem vu dang nhap luon hoan thanh', pr.done, JSON.stringify(pr));

  // 5. Su kien tuan het han bi tu choi; dang dien ra thi nhan duoc, nhan lan 2 bi tu choi
  s = fresh();
  // Thu 4 25/11 10h: Luyen Cong Gap Doi (T2-4, 18-22h) chua mo
  var wst = ev.eventWeeklyStatus(ev.EVENT_WEEKLY[0], ms(2026, 11, 25, 10, 0));
  check('Luyen Cong T2-4 luc 10h: upcoming', wst.status === 'upcoming', JSON.stringify(wst));
  r = ev.eventClaimWeekly(s, 'w-luyencong', ms(2026, 11, 25, 10, 0));
  check('su kien tuan chua mo bi tu choi', !r.ok, JSON.stringify(r));
  wst = ev.eventWeeklyStatus(ev.EVENT_WEEKLY[0], ms(2026, 11, 25, 23, 0));
  check('Luyen Cong T2-4 luc 23h: ended', wst.status === 'ended', JSON.stringify(wst));
  r = ev.eventClaimWeekly(s, 'w-luyencong', ms(2026, 11, 25, 23, 0));
  check('su kien tuan het han bi tu choi', !r.ok, JSON.stringify(r));
  r = ev.eventClaimWeekly(s, 'w-luyencong', ms(2026, 11, 25, 19, 0));
  check('Luyen Cong 19h dang dien ra nhan duoc +300 EXP (len cap 4, du 204 EXP)', r.ok && r.leveled === 1 && s.player.level === 4 && s.player.exp === 204, 'exp=' + s.player.exp + ' level=' + s.player.level + ' ' + JSON.stringify(r));
  before = JSON.stringify(s);
  r = ev.eventClaimWeekly(s, 'w-luyencong', ms(2026, 11, 25, 19, 30, 0));
  check('nhan trung su kien tuan cung ngay bi tu choi', !r.ok && JSON.stringify(s) === before, JSON.stringify(r));
  // Luyen Cong Buoi Toi hang ngay 19-21h: dem nguoc dung
  var wst2 = ev.eventWeeklyStatus(ev.EVENT_WEEKLY[2], ms(2026, 11, 25, 18, 0));
  check('Luyen Cong Buoi Toi 18h: upcoming, bat dau sau 1g', wst2.status === 'upcoming' && (wst2.startMs - ms(2026, 11, 25, 18, 0)) === 3600000, JSON.stringify(wst2));

  // 6. Le hoi: Tet dang dien ra nhan duoc; Trung Thu ngoai mua bi tu choi
  s = fresh();
  r = ev.eventClaimSeasonal(s, 's-tet', ms(2026, 2, 5, 10, 0));
  check('Tet 05/02 dang dien ra nhan duoc +88 KNB', r.ok && s.player.gold === 455 + 88, 'gold=' + s.player.gold + ' ' + JSON.stringify(r));
  r = ev.eventClaimSeasonal(s, 's-tet', ms(2026, 2, 6, 10, 0));
  check('Tet nhan lan 2 cung nam bi tu choi', !r.ok, JSON.stringify(r));
  r = ev.eventClaimSeasonal(s, 's-trungthu', ms(2026, 2, 5, 10, 0));
  check('Trung Thu thang 2 (ngoai mua) bi tu choi', !r.ok, JSON.stringify(r));
  var sst = ev.eventSeasonalStatus(ev.EVENT_SEASONAL[3], ms(2026, 9, 15, 10, 0));
  check('Trung Thu 15/09 dang dien ra', sst.status === 'live', JSON.stringify(sst));

  // 7. Boss The Gioi 12h + 20h; Bang Chien 19h-20h Thu 7
  s = fresh();
  r = ev.eventClaimBoss(s, ms(2026, 11, 25, 10, 0));
  check('Boss 10h chua mo bi tu choi', !r.ok, JSON.stringify(r));
  r = ev.eventClaimBoss(s, ms(2026, 11, 25, 12, 10, 0));
  check('Boss 12h10 dang mo nhan duoc +40 KNB', r.ok && s.player.gold === 455 + 40, JSON.stringify(r));
  r = ev.eventClaimBoss(s, ms(2026, 11, 25, 20, 10, 0));
  check('Boss khung 20h cung ngay da nhan roi -> tu choi (1 lan/ngay)', !r.ok, JSON.stringify(r));
  var bst = ev.eventBossStatus(ms(2026, 11, 25, 12, 45, 0));
  check('Boss 12h45 (qua 30 phut) da dong', bst.status === 'closed', JSON.stringify(bst));
  // Thu 7 28/11/2026: 19h30 Bang Chien dang mo
  s = fresh();
  r = ev.eventClaimGuildWar(s, ms(2026, 11, 28, 19, 30, 0));
  check('Bang Chien T7 19h30 nhan duoc +60 KNB', r.ok && s.player.gold === 455 + 60, JSON.stringify(r));
  r = ev.eventClaimGuildWar(s, ms(2026, 11, 28, 19, 45, 0));
  check('Bang Chien nhan lan 2 cung tuan bi tu choi', !r.ok, JSON.stringify(r));
  r = ev.eventClaimGuildWar(s, ms(2026, 11, 25, 19, 30, 0)); // Thu 4
  check('Bang Chien Thu 4 bi tu choi', !r.ok, JSON.stringify(r));

  // 8. Dau truong: hang tinh tu wins that; thuong theo hang 1 lan/tuan
  s = fresh(); s.stats.wins = 50;
  var rk = ev.eventArenaRank(s);
  check('wins=50 -> hang 5/9 (4 doi tren)', rk.rank === 5 && rk.total === 9, JSON.stringify(rk));
  s.stats.wins = 200;
  rk = ev.eventArenaRank(s);
  check('wins=200 -> hang 1/9', rk.rank === 1, JSON.stringify(rk));
  s = fresh(); s.stats.wins = 50;
  r = ev.eventClaimArena(s, ms(2026, 11, 25, 10, 0));
  check('hang 5 nhan thuong tuan +60 KNB', r.ok && r.rank === 5 && s.player.gold === 455 + 60, JSON.stringify(r));
  r = ev.eventClaimArena(s, ms(2026, 11, 27, 10, 0));
  check('nhan thuong dau truong lan 2 cung tuan bi tu choi', !r.ok, JSON.stringify(r));
  r = ev.eventClaimArena(s, ms(2026, 11, 30, 10, 0)); // Thu 2 tuan sau
  check('tuan moi (T2 30/11) nhan lai duoc', r.ok, JSON.stringify(r));

  // 9. Doi qua: du tien thi doi, thieu tien bi tu choi, tru dung tien
  s = fresh();
  r = ev.eventRedeem(s, 'r1', ms(2026, 11, 25, 10, 0));
  check('doi r1 tru dung 5000 bac, nhan Tu Khi Dan x3', r.ok && s.player.silver === 40932 - 5000 &&
    s.inventory.some(function (i) { return i.name === 'Tụ Khí Đan' && i.qty === 3 + 3; }), JSON.stringify(r) + ' silver=' + s.player.silver);
  s.player.gold = 10;
  before = JSON.stringify(s);
  r = ev.eventRedeem(s, 'r2', ms(2026, 11, 25, 10, 0)); // can 50 KNB
  check('doi r2 thieu KNB bi tu choi, save khong doi', !r.ok && JSON.stringify(s) === before, JSON.stringify(r));
  s.player.silver = 100;
  r = ev.eventRedeem(s, 'r5', ms(2026, 11, 25, 10, 0)); // can 100000 bac
  check('doi r5 thieu bac bi tu choi', !r.ok, JSON.stringify(r));

  // 10. Save cu (khong co flags.event) van chay: ensure tao du 7 nhanh, khong mat flags cu
  s = fresh(); delete s.flags.event; s.flags.shop = { hourKey: 'x' };
  var es = ev.eventEnsureEventState(s);
  check('save cu: ensure tao du 7 nhanh flags.event', !!es.checkin && !!es.daily && !!es.weekly && !!es.seasonal && !!es.boss && !!es.arena && !!es.redeem, JSON.stringify(Object.keys(es)));
  check('save cu: flags.shop cu khong bi mat', s.flags.shop.hourKey === 'x');
  r = ev.eventClaimCheckin(s, ms(2026, 11, 25, 10, 0));
  check('save cu diem danh duoc ngay', r.ok, JSON.stringify(r));

  // 11. Khong chua '</script' (de build khong vo the script)
  var src = fs.readFileSync(path.join(SRC, '09-event.js'), 'utf8');
  check("09-event.js khong chua '</script'", src.indexOf('</script') < 0);
  var tpl = fs.readFileSync(path.join(SRC, 'event.template.html'), 'utf8');
  check('template co placeholder __EVENT__', tpl.indexOf('__EVENT__') >= 0);
  check('template co #toast va nut Ve Thanh', tpl.indexOf('id="toast"') >= 0 && tpl.indexOf('Về Thành') >= 0);

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
