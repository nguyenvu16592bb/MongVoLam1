/* ============================================================================
   EVENT — SỰ KIỆN (Event.html)
   Trang sự kiện độc lập, tự chứa, chia sẻ đúng save localStorage v2 với game
   (SAVE_KEY 'mongvolam_soha_v1', xem src/01-data.js SaveManager).
   - Đọc/ghi NGUYÊN save JSON: chỉ đổi player (vàng/bạc/KNB, EXP/cấp) +
     inventory (túi đồ) + flags.event (trạng thái sự kiện). Mọi field khác giữ nguyên.
   - Trạng thái sự kiện cất trong flags.event để SaveManager.save() của game
     không làm mất khi game lưu lại. Save cũ (chưa có flags.event) vẫn chạy:
     eventEnsureEventState() tự tạo đủ 7 nhánh khi thiếu.
   - MỌI mốc giờ trên trang này tính theo GIỜ ĐỊA PHƯƠNG của máy (ngày địa
     phương = ngày trên đồng hồ máy). Khác với chợ (Shop.html) dùng giờ UTC —
     không đổi chợ. Ngày địa phương: eventLocalDayKey().
   - EXP cộng theo đúng công thức game (src/01-data.js gainExp): lên cấp thì
     maxExp *= 1.42, +120 maxHp, +40 maxMp, +15 atk, +10 def, hồi đầy HP/MP.
   - File này vừa chạy trong trình duyệt (Event.html inline), vừa require()
     được trong Node để kiểm thử logic thuần.
   ========================================================================== */
'use strict';

/* EVENT-BEGIN */
const EVENT_SAVE_KEY = 'mongvolam_soha_v1';

const EVENT_TABS = [
  { id: 'checkin', label: 'Điểm Danh', icon: '📅' },
  { id: 'daily', label: 'Nhiệm Vụ Ngày', icon: '📜' },
  { id: 'weekly', label: 'Sự Kiện Tuần', icon: '🗓️' },
  { id: 'seasonal', label: 'Lễ Hội', icon: '🎊' },
  { id: 'boss', label: 'Boss · Bang Chiến', icon: '👹' },
  { id: 'arena', label: 'Đấu Trường', icon: '🏆' },
  { id: 'redeem', label: 'Đổi Quà', icon: '🎁' }
];

/* ---- Điểm danh 7 ngày: ngày = vị trí trong chuỗi (1..7), quay vòng. ---- */
const EVENT_CHECKIN_REWARDS = [
  { day: 1, label: 'Ngày 1', silver: 2000, text: '+2.000 bạc' },
  { day: 2, label: 'Ngày 2', gold: 20, text: '+20 KNB' },
  { day: 3, label: 'Ngày 3', exp: 150, text: '+150 Kinh Nghiệm' },
  { day: 4, label: 'Ngày 4', items: [{ name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', qty: 3 }], text: 'Kim Sáng Dược ×3' },
  { day: 5, label: 'Ngày 5', silver: 5000, text: '+5.000 bạc' },
  { day: 6, label: 'Ngày 6', gold: 50, text: '+50 KNB' },
  { day: 7, label: 'Ngày 7', exp: 300, items: [{ name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 5 }], text: '+300 Kinh Nghiệm · Tụ Khí Đan ×5' }
];

/* ---- Nhiệm vụ ngày: check() đọc TIẾN TRÌNH THẬT trong save.
   progressKey: 'wins' | 'battles' | 'recruit' | 'level' | 'cultivate' |
   'quests' | 'login' — đo bằng chênh lệch so với baseline chụp lúc mở trang
   lần đầu trong ngày (flags.event.daily[ngày].baseline).
   manual:true = KHÔNG có field thật để đo (chợ không ghi dấu mua hàng vào
   save) -> người chơi bấm "Đã làm xong" để tự xác nhận, UI ghi rõ. ---- */
const EVENT_DAILY_QUESTS = [
  { id: 'd-win1', name: 'Thắng 1 trận', icon: '⚔️', desc: 'Thắng 1 trận ở chiến trường hôm nay.', progressKey: 'wins', target: 1, reward: { silver: 1500, exp: 60 }, rewardText: '+1.500 bạc · +60 EXP' },
  { id: 'd-win3', name: 'Thắng 3 trận', icon: '🏆', desc: 'Thắng 3 trận ở chiến trường hôm nay.', progressKey: 'wins', target: 3, reward: { gold: 15, exp: 150 }, rewardText: '+15 KNB · +150 EXP' },
  { id: 'd-battle3', name: 'Đánh 3 trận', icon: '🗡️', desc: 'Vào chiến trường 3 trận hôm nay (thắng hay thua đều tính).', progressKey: 'battles', target: 3, reward: { silver: 3000 }, rewardText: '+3.000 bạc' },
  { id: 'd-recruit', name: 'Chiêu mộ 1 đệ tử', icon: '⛩️', desc: 'Tham Bái chiêu mộ 1 lần hôm nay (miễn phí hằng ngày cũng tính).', progressKey: 'recruit', target: 1, reward: { gold: 10, items: [{ name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 2 }] }, rewardText: '+10 KNB · Tụ Khí Đan ×2' },
  { id: 'd-shop', name: 'Mua 1 món ở chợ', icon: '🏮', desc: 'Mua bất cứ món nào ở Chợ Biện Kinh hôm nay.', progressKey: 'shop', target: 1, manual: true, reward: { silver: 2000, exp: 50 }, rewardText: '+2.000 bạc · +50 EXP' },
  { id: 'd-level', name: 'Lên 1 cấp', icon: '⬆️', desc: 'Tăng 1 cấp nhân vật hôm nay.', progressKey: 'level', target: 1, reward: { gold: 20, exp: 100 }, rewardText: '+20 KNB · +100 EXP' },
  { id: 'd-cultivate', name: 'Bồi dưỡng 1 đệ tử', icon: '🌱', desc: 'Bồi dưỡng đệ tử đội trưởng +1 cấp (mở Hồ sơ → Bồi Dưỡng).', progressKey: 'cultivate', target: 1, reward: { silver: 2500, items: [{ name: 'Bồi Dưỡng Đan', icon: '🧧', type: 'Đan dược', desc: 'Đệ tử đội trưởng +1 cấp', qty: 1 }] }, rewardText: '+2.500 bạc · Bồi Dưỡng Đan ×1' },
  { id: 'd-quest', name: 'Hoàn thành 1 nhiệm vụ chính', icon: '📜', desc: 'Hoàn thành 1 nhiệm vụ trong Hành Tẩu Giang Hồ hôm nay.', progressKey: 'quests', target: 1, reward: { gold: 15, silver: 2000 }, rewardText: '+15 KNB · +2.000 bạc' },
  { id: 'd-login', name: 'Đăng nhập hôm nay', icon: '🌅', desc: 'Mở game hôm nay là xong — nhiệm vụ này tự hoàn thành.', progressKey: 'login', target: 1, reward: { silver: 1000, exp: 30 }, rewardText: '+1.000 bạc · +30 EXP' }
];

/* ---- Sự kiện tuần: days theo Date.getDay() địa phương (0 = Chủ Nhật).
   Khung giờ là giờ địa phương. ---- */
const EVENT_WEEKLY = [
  { id: 'w-luyencong', name: 'Luyện Công Gấp Đôi', icon: '🔥', desc: 'Thứ 2–4, 18h–22h: luyện công nhận gấp đôi kinh nghiệm sự kiện.', days: [1, 2, 3], startHour: 18, endHour: 22, reward: { exp: 300 }, rewardText: '+300 Kinh Nghiệm' },
  { id: 'w-boss', name: 'Boss Cuối Tuần', icon: '👹', desc: 'Thứ 6–CN, 20h–22h: Boss xuất hiện, đánh là có quà.', days: [5, 6, 0], startHour: 20, endHour: 22, reward: { gold: 30, silver: 5000 }, rewardText: '+30 KNB · +5.000 bạc' },
  { id: 'w-toi', name: 'Luyện Công Buổi Tối', icon: '🌙', desc: 'Hằng ngày, 19h–21h: giờ vàng luyện công mỗi tối.', days: [0, 1, 2, 3, 4, 5, 6], startHour: 19, endHour: 21, reward: { exp: 150, silver: 2000 }, rewardText: '+150 Kinh Nghiệm · +2.000 bạc' },
  { id: 'w-sang', name: 'Săn Boss Buổi Sáng', icon: '🌅', desc: 'Thứ 7–CN, 9h–11h: săn Boss buổi sáng cuối tuần.', days: [6, 0], startHour: 9, endHour: 11, reward: { gold: 20, items: [{ name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', qty: 3 }] }, rewardText: '+20 KNB · Kim Sáng Dược ×3' },
  { id: 'w-chodem', name: 'Chợ Đêm Biện Kinh', icon: '🏮', desc: 'Thứ 5–6, 20h–23h: chợ đêm mở cửa, quà đêm cho người thức khuya.', days: [4, 5], startHour: 20, endHour: 23, reward: { silver: 4000, items: [{ name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 2 }] }, rewardText: '+4.000 bạc · Tụ Khí Đan ×2' },
  { id: 'w-loidai', name: 'Lôi Đài Cuối Tuần', icon: '⚔️', desc: 'Thứ 7, 14h–17h: lôi đài mở, luận võ nhận thưởng.', days: [6], startHour: 14, endHour: 17, reward: { gold: 25, exp: 200 }, rewardText: '+25 KNB · +200 Kinh Nghiệm' }
];

/* ---- Lễ hội theo mùa: ngày cố định hằng năm (ngày/tháng dương lịch).
   Nhận 1 lần / lễ hội / năm. ---- */
const EVENT_SEASONAL = [
  { id: 's-tet', name: 'Tết Nguyên Đán', icon: '🧧', desc: '28/01 – 12/02 hằng năm: lì xì đầu năm, bánh chưng sum vầy.', start: [1, 28], end: [2, 12], reward: { gold: 88, silver: 8888, exp: 500, items: [{ name: 'Bánh Chưng', icon: '🍚', type: 'Lễ hội', desc: 'Bánh chưng ngày Tết, ăn vào ấm lòng', qty: 3 }] }, rewardText: '+88 KNB · +8.888 bạc · +500 EXP · Bánh Chưng ×3' },
  { id: 's-he', name: 'Lễ Hội Mùa Hè', icon: '🌞', desc: '01/06 – 15/06 hằng năm: hè về, giải nhiệt giang hồ.', start: [6, 1], end: [6, 15], reward: { silver: 6000, exp: 300, items: [{ name: 'Kem Hạt Sen', icon: '🍦', type: 'Lễ hội', desc: 'Kem hạt sen mát lạnh ngày hè', qty: 3 }] }, rewardText: '+6.000 bạc · +300 EXP · Kem Hạt Sen ×3' },
  { id: 's-quockhanh', name: 'Quốc Khánh', icon: '🇻🇳', desc: '30/08 – 05/09 hằng năm: mừng Quốc khánh, pháo hoa rực trời.', start: [8, 30], end: [9, 5], reward: { gold: 50, silver: 5000, exp: 300, items: [{ name: 'Pháo Hoa', icon: '🎆', type: 'Lễ hội', desc: 'Pháo hoa mừng lễ lớn', qty: 3 }] }, rewardText: '+50 KNB · +5.000 bạc · +300 EXP · Pháo Hoa ×3' },
  { id: 's-trungthu', name: 'Tết Trung Thu', icon: '🌕', desc: '10/09 – 25/09 hằng năm: trăng rằm, bánh nướng, đèn lồng.', start: [9, 10], end: [9, 25], reward: { gold: 68, silver: 6800, exp: 400, items: [{ name: 'Bánh Trung Thu', icon: '🥮', type: 'Lễ hội', desc: 'Bánh nướng nhân thập cẩm ngày rằm', qty: 5 }] }, rewardText: '+68 KNB · +6.800 bạc · +400 EXP · Bánh Trung Thu ×5' }
];

/* ---- Boss Thế Giới: 12h00 + 20h00 hằng ngày (giờ địa phương), mỗi khung mở 30 phút.
   Thưởng tham gia 1 lần/ngày (dù có 2 khung). ---- */
const EVENT_WORLD_BOSS = {
  name: 'Boss Thế Giới', icon: '👹',
  desc: 'Boss Thế Giới xuất hiện lúc 12h00 và 20h00 hằng ngày (giờ địa phương), mỗi lần mở 30 phút.',
  times: [{ h: 12, m: 0 }, { h: 20, m: 0 }], windowMin: 30,
  reward: { gold: 40, silver: 8000, exp: 400, items: [{ name: 'Long Châu Biển Đông', icon: '🐉', type: 'Bảo vật', desc: 'Long châu trấn giữ Biển Đông', qty: 1 }] },
  rewardText: '+40 KNB · +8.000 bạc · +400 EXP · Long Châu Biển Đông ×1'
};

/* ---- Bang Chiến: 19h–20h Thứ 7 hằng tuần (giờ địa phương). Thưởng 1 lần/tuần.
   Dấu nhận cất trong flags.event.boss với khóa 'gw-YYYY-MM-DD' (ngày Thứ 7 đó). ---- */
const EVENT_GUILD_WAR = {
  name: 'Bang Chiến', icon: '🚩',
  desc: 'Bang Chiến mở 19h–20h Thứ 7 hằng tuần (giờ địa phương). Cả bang cùng ra trận!',
  day: 6, startHour: 19, endHour: 20,
  reward: { gold: 60, silver: 10000, exp: 500 },
  rewardText: '+60 KNB · +10.000 bạc · +500 EXP'
};

/* ---- Đấu Trường Xếp Hạng: BẢNG GIẢ LẬP — đối thủ cố định, hạng của người
   chơi tính từ stats.wins thật. Thưởng theo hạng 1 lần/tuần (tuần tính từ
   Thứ 2, giờ địa phương). ---- */
const EVENT_ARENA_RIVALS = [
  { name: 'Thiên Địa Đảo', wins: 128 },
  { name: 'Hùng Luckyet', wins: 96 },
  { name: 'Độc Cô Cầu Bại', wins: 87 },
  { name: 'Thích Sakugiao', wins: 64 },
  { name: 'Hoa Lan Đạt', wins: 41 },
  { name: 'Nữ Hiệp Cầu Đá', wins: 23 },
  { name: 'Tham Lang Lam', wins: 12 },
  { name: 'Thích Tâm', wins: 5 }
];

/* ---- Đổi quà: trừ tiền thật, nhận đồ/EXP ngay. Đổi được nhiều lần
   (mỗi lần đều trừ tiền); số lần đổi trong ngày ghi trong flags.event.redeem. ---- */
const EVENT_REDEEM_PACKS = [
  { id: 'r1', name: 'Đổi Bạc Lấy Đan', icon: '💊', desc: 'Đổi bạc lấy đan dược tu luyện.', cost: { cur: 'silver', amount: 5000 }, costText: '5.000 bạc', reward: { exp: 100, items: [{ name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 3 }] }, rewardText: 'Tụ Khí Đan ×3 · +100 EXP' },
  { id: 'r2', name: 'Đổi KNB Lấy Thuốc', icon: '🧪', desc: 'Đổi KNB lấy thuốc trị thương.', cost: { cur: 'gold', amount: 50 }, costText: '50 KNB', reward: { exp: 200, items: [{ name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', qty: 5 }] }, rewardText: 'Kim Sáng Dược ×5 · +200 EXP' },
  { id: 'r3', name: 'Đổi Bạc Lấy Đá', icon: '🟣', desc: 'Đổi bạc lấy đá cường hóa cao cấp.', cost: { cur: 'silver', amount: 20000 }, costText: '20.000 bạc', reward: { exp: 300, items: [{ name: 'Đá Cường Hóa Cao Cấp', icon: '🟣', type: 'Nguyên liệu', desc: 'Cường hóa +7 ~ +9', qty: 2 }] }, rewardText: 'Đá Cường Hóa Cao Cấp ×2 · +300 EXP' },
  { id: 'r4', name: 'Đổi KNB Lấy Long Đan', icon: '🐲', desc: 'Đổi KNB lấy Long Nguyên Đan quý hiếm.', cost: { cur: 'gold', amount: 100 }, costText: '100 KNB', reward: { exp: 500, items: [{ name: 'Long Nguyên Đan', icon: '🐲', type: 'Đan dược', desc: '+1000 Kinh Nghiệm', qty: 1 }] }, rewardText: 'Long Nguyên Đan ×1 · +500 EXP' },
  { id: 'r5', name: 'Đổi Bạc Lấy Bí Kíp', icon: '📚', desc: 'Đổi bạc lấy bí kíp Độc Cô Cửu Kiếm.', cost: { cur: 'silver', amount: 100000 }, costText: '100.000 bạc', reward: { exp: 800, items: [{ name: 'Độc Cô Cửu Kiếm', icon: '📚', type: 'Bí kíp', desc: 'Cửu kiếm phá hết thiên hạ kiếm pháp', qty: 1 }] }, rewardText: 'Độc Cô Cửu Kiếm ×1 · +800 EXP' }
];

/* ============================== NGÀY / GIỜ ĐỊA PHƯƠNG ============================== */
/* Mọi ngày/giờ ở đây đều lấy từ đồng hồ máy (giờ địa phương), KHÔNG dùng
   toISOString (UTC) như chợ. */
function eventPad(n) { return (n < 10 ? '0' : '') + n; }
function eventLocalDayKey(nowMs) {
  var d = new Date(nowMs == null ? Date.now() : nowMs);
  return d.getFullYear() + '-' + eventPad(d.getMonth() + 1) + '-' + eventPad(d.getDate());
}
function eventLocalParts(nowMs) {
  var d = new Date(nowMs == null ? Date.now() : nowMs);
  return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate(), dow: d.getDay(), h: d.getHours(), min: d.getMinutes(), s: d.getSeconds() };
}
function eventDayKeyToMs(dayKey) {
  var p = String(dayKey || '').split('-');
  return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1).getTime();
}
function eventAddDaysKey(dayKey, delta) {
  var ms = eventDayKeyToMs(dayKey) + delta * 86400000;
  return eventLocalDayKey(ms);
}
function eventYesterdayKey(todayKey) { return eventAddDaysKey(todayKey, -1); }
function eventWeekdayNameVN(dow) {
  return ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][dow] || '';
}
function eventClockText(nowMs) {
  var p = eventLocalParts(nowMs);
  return eventWeekdayNameVN(p.dow) + ', ' + eventPad(p.day) + '/' + eventPad(p.m) + '/' + p.y +
    ' · ' + eventPad(p.h) + ':' + eventPad(p.min) + ':' + eventPad(p.s);
}
/* Đếm ngược: ms -> "2g 15p" / "45p 20s" / "30s". */
function eventFmtCountdown(ms) {
  ms = Math.max(0, Math.round(ms));
  var s = Math.floor(ms / 1000);
  var d = Math.floor(s / 86400); s -= d * 86400;
  var h = Math.floor(s / 3600); s -= h * 3600;
  var m = Math.floor(s / 60); s -= m * 60;
  if (d > 0) return d + ' ngày ' + h + 'g ' + m + 'p';
  if (h > 0) return h + 'g ' + eventPad(m) + 'p';
  if (m > 0) return m + 'p ' + eventPad(s) + 's';
  return s + 's';
}
/* Khóa tuần: ngày Thứ 2 của tuần chứa nowMs (giờ địa phương). */
function eventWeekKey(nowMs) {
  var p = eventLocalParts(nowMs);
  var dowMon0 = (p.dow + 6) % 7; /* Thứ 2 = 0 */
  var mondayMs = eventDayKeyToMs(eventLocalDayKey(nowMs)) - dowMon0 * 86400000;
  return eventLocalDayKey(mondayMs);
}
/* Ngày Thứ 7 của tuần chứa nowMs (giờ địa phương), dạng YYYY-MM-DD. */
function eventSaturdayKey(nowMs) {
  var p = eventLocalParts(nowMs);
  var toSat = (6 - p.dow + 7) % 7;
  return eventAddDaysKey(eventLocalDayKey(nowMs), toSat);
}

/* ============================== SAVE ============================== */
function eventFmt(n) {
  n = Number(n) || 0;
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function eventEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function eventDefaultEventState() {
  return {
    checkin: { lastDate: '', streak: 0, claimed: {} },
    daily: {}, weekly: {}, seasonal: {}, boss: {}, arena: {}, redeem: {}
  };
}
function eventDefaultSave() {
  function hb() { return { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 }; }
  return {
    player: {
      name: 'Song Ma Quyền Phái', faction: 'Song Ma Phái',
      level: 3, exp: 64, maxExp: 160,
      hp: 500, maxHp: 500, mp: 200, maxMp: 200,
      atk: 68, def: 42, speed: 7.5,
      gold: 455, silver: 40932,
      capacity: 13, maxCapacity: 30,
      weapon: 'Song Ma Thiết Quyền', armorName: 'Hắc Vân Võ Bào', accessory: 'Ngọc Bội Thanh Long'
    },
    heroes: [
      { id: 'det', level: 400, bonus: hb() }, { id: 'tieu', level: 385, bonus: hb() },
      { id: 'kiem', level: 390, bonus: hb() }, { id: 'linh', level: 375, bonus: hb() },
      { id: 'niep', level: 396, bonus: hb() }, { id: 'bo', level: 396, bonus: hb() }
    ],
    leader: 0,
    quests: [], guild: { name: 'Thiên Địa Hội [MV]', level: 4, members: 28, contribution: 350 },
    inventory: [
      { id: 'i1', name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', qty: 5 },
      { id: 'i2', name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 3 },
      { id: 'i3', name: 'Huyền Thiết Tinh', icon: '💎', type: 'Nguyên liệu', desc: 'Rèn trang bị', qty: 3 }
    ],
    customProps: [], stats: { battles: 0, wins: 0, kills: 0 },
    settings: { muted: false, autoBattle: true, autoSkill: true, speed: 1 },
    flags: { tutorial: false, shop: {}, event: eventDefaultEventState() },
    v: 2
  };
}
/* Tạo đủ 7 nhánh flags.event khi thiếu — KHÔNG ghi đè nhánh đã có, nên
   save cũ (chưa có flags.event) vẫn chạy bình thường. */
function eventEnsureEventState(save) {
  save.flags = save.flags || {};
  var ev = save.flags.event;
  if (!ev || typeof ev !== 'object') { save.flags.event = eventDefaultEventState(); return save.flags.event; }
  var def = eventDefaultEventState();
  Object.keys(def).forEach(function (k) {
    if (!ev[k] || typeof ev[k] !== 'object') ev[k] = def[k];
  });
  if (!ev.checkin.claimed || typeof ev.checkin.claimed !== 'object') ev.checkin.claimed = {};
  if (typeof ev.checkin.streak !== 'number') ev.checkin.streak = 0;
  if (typeof ev.checkin.lastDate !== 'string') ev.checkin.lastDate = '';
  return ev;
}
function eventLoadSave() {
  try {
    if (typeof localStorage === 'undefined') return eventDefaultSave();
    var raw = localStorage.getItem(EVENT_SAVE_KEY);
    if (!raw) return eventDefaultSave();
    var d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !d.player) return eventDefaultSave();
    d.player.gold = Math.max(0, Math.floor(Number(d.player.gold) || 0));
    d.player.silver = Math.max(0, Math.floor(Number(d.player.silver) || 0));
    if (!Array.isArray(d.inventory)) d.inventory = [];
    d.flags = d.flags || {};
    eventEnsureEventState(d);
    return d;
  } catch (e) { return eventDefaultSave(); }
}
function eventPersist(save) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(EVENT_SAVE_KEY, JSON.stringify(save));
  } catch (e) {}
}
function eventAddItem(save, name, icon, type, desc, qty) {
  save.inventory = save.inventory || [];
  var found = null;
  for (var i = 0; i < save.inventory.length; i++) if (save.inventory[i].name === name) { found = save.inventory[i]; break; }
  if (found) found.qty += (qty || 1);
  else save.inventory.push({ id: 'event-' + Date.now() + '-' + Math.floor(Math.random() * 9999), name: name, icon: icon, type: type, desc: desc, qty: qty || 1 });
}
/* Tăng EXP theo đúng công thức game (src/01-data.js gainExp) — bản thuần,
   không gọi UI/Sfx để test được bằng Node. */
function eventGainExp(save, amount) {
  var p = save.player;
  p.exp = (Number(p.exp) || 0) + Math.max(0, Math.round(amount));
  var leveled = 0;
  while (p.exp >= p.maxExp) {
    p.exp -= p.maxExp;
    p.level += 1;
    p.maxExp = Math.round(p.maxExp * 1.42);
    p.maxHp += 120; p.hp = p.maxHp;
    p.maxMp += 40; p.mp = p.maxMp;
    p.atk += 15; p.def += 10;
    leveled++;
  }
  return leveled;
}
/* Cộng thưởng vào save: {gold?, silver?, exp?, items?[]}. Trả về số cấp đã lên. */
function eventApplyReward(save, reward) {
  var p = save.player;
  var leveled = 0;
  if (reward.gold) p.gold = Math.max(0, (Number(p.gold) || 0) + Math.floor(reward.gold));
  if (reward.silver) p.silver = Math.max(0, (Number(p.silver) || 0) + Math.floor(reward.silver));
  if (reward.exp) leveled = eventGainExp(save, reward.exp);
  (reward.items || []).forEach(function (it) {
    eventAddItem(save, it.name, it.icon, it.type, it.desc, it.qty || 1);
  });
  return leveled;
}
function eventRewardText(reward) {
  var parts = [];
  if (reward.gold) parts.push('+' + eventFmt(reward.gold) + ' KNB');
  if (reward.silver) parts.push('+' + eventFmt(reward.silver) + ' bạc');
  if (reward.exp) parts.push('+' + eventFmt(reward.exp) + ' EXP');
  (reward.items || []).forEach(function (it) { parts.push(it.name + ' ×' + (it.qty || 1)); });
  return parts.join(' · ') || 'Không có thưởng';
}

/* ============================== ĐIỂM DANH 7 NGÀY ============================== */
function eventCheckinPreview(save, nowMs) {
  var ev = eventEnsureEventState(save);
  var today = eventLocalDayKey(nowMs);
  var st = ev.checkin;
  var claimedToday = !!st.claimed[today];
  var streak = st.streak || 0;
  var nextStreak;
  if (claimedToday) nextStreak = streak;
  else if (st.lastDate === eventYesterdayKey(today)) nextStreak = streak + 1;
  else nextStreak = 1;
  var dayIndex = ((nextStreak - 1) % 7) + 1;
  return { today: today, claimedToday: claimedToday, streak: streak, nextStreak: nextStreak, dayIndex: dayIndex, reward: EVENT_CHECKIN_REWARDS[dayIndex - 1] };
}
function eventClaimCheckin(save, nowMs) {
  var ev = eventEnsureEventState(save);
  var prev = eventCheckinPreview(save, nowMs);
  if (prev.claimedToday) return { ok: false, reason: 'Hôm nay đã điểm danh rồi, mai quay lại nhé!' };
  var reward = prev.reward;
  var leveled = eventApplyReward(save, reward);
  ev.checkin.lastDate = prev.today;
  ev.checkin.streak = prev.nextStreak;
  ev.checkin.claimed[prev.today] = prev.dayIndex;
  return { ok: true, day: prev.dayIndex, streak: prev.nextStreak, reward: reward, rewardText: reward.text, leveled: leveled };
}

/* ============================== NHIỆM VỤ NGÀY ============================== */
function eventDailySnapshot(save) {
  var s = save.stats || { battles: 0, wins: 0, kills: 0 };
  var heroes = Array.isArray(save.heroes) ? save.heroes : [];
  var heroLevels = 0;
  heroes.forEach(function (h) { heroLevels += Number(h.level) || 0; });
  var questsDone = 0;
  (save.quests || []).forEach(function (q) { if (q.done) questsDone++; });
  return {
    wins: Number(s.wins) || 0, battles: Number(s.battles) || 0, kills: Number(s.kills) || 0,
    level: Number(save.player.level) || 0, heroes: heroes.length,
    heroLevels: heroLevels, questsDone: questsDone
  };
}
/* Lấy (hoặc tạo) trạng thái nhiệm vụ ngày hôm nay. Baseline chụp ở lần mở
   trang đầu tiên trong ngày — tiến trình sau đó mới được tính. */
function eventEnsureDailyDay(save, nowMs) {
  var ev = eventEnsureEventState(save);
  var today = eventLocalDayKey(nowMs);
  if (!ev.daily[today] || typeof ev.daily[today] !== 'object') {
    ev.daily[today] = { baseline: eventDailySnapshot(save), claimed: {}, manual: {} };
  }
  var d = ev.daily[today];
  d.baseline = d.baseline || eventDailySnapshot(save);
  d.claimed = d.claimed || {};
  d.manual = d.manual || {};
  return d;
}
function eventFindDailyQuest(id) {
  for (var i = 0; i < EVENT_DAILY_QUESTS.length; i++) if (EVENT_DAILY_QUESTS[i].id === id) return EVENT_DAILY_QUESTS[i];
  return null;
}
/* Tiến trình THẬT của 1 nhiệm vụ ngày (đọc từ save + baseline hôm nay).
   Trả về {progress, target, done}. Nhiệm vụ manual thì progress chỉ tính
   khi người chơi đã bấm "Đã làm xong". */
function eventDailyProgress(save, quest, nowMs) {
  var ev = eventEnsureEventState(save);
  var today = eventLocalDayKey(nowMs);
  var day = eventEnsureDailyDay(save, nowMs);
  var b = day.baseline;
  var s = save.stats || {};
  var progress = 0;
  if (quest.progressKey === 'wins') progress = (Number(s.wins) || 0) - (b.wins || 0);
  else if (quest.progressKey === 'battles') progress = (Number(s.battles) || 0) - (b.battles || 0);
  else if (quest.progressKey === 'recruit') {
    var byDate = (save.flags && save.flags.recruitFreeDate === today) ? 1 : 0;
    var byCount = (Array.isArray(save.heroes) ? save.heroes.length : 0) - (b.heroes || 0);
    progress = Math.max(byDate, byCount);
  }
  else if (quest.progressKey === 'level') progress = (Number(save.player.level) || 0) - (b.level || 0);
  else if (quest.progressKey === 'cultivate') {
    var sum = 0;
    (save.heroes || []).forEach(function (h) { sum += Number(h.level) || 0; });
    progress = sum - (b.heroLevels || 0);
  }
  else if (quest.progressKey === 'quests') {
    var done = 0;
    (save.quests || []).forEach(function (q) { if (q.done) done++; });
    progress = done - (b.questsDone || 0);
  }
  else if (quest.progressKey === 'login') progress = 1;
  else if (quest.progressKey === 'shop') progress = day.manual[quest.id] ? 1 : 0;
  if (progress < 0) progress = 0;
  if (progress > quest.target) progress = quest.target;
  return { progress: progress, target: quest.target, done: progress >= quest.target };
}
function eventDailyMarkManual(save, questId, nowMs) {
  var q = eventFindDailyQuest(questId);
  if (!q) return { ok: false, reason: 'Không có nhiệm vụ này.' };
  if (!q.manual) return { ok: false, reason: 'Nhiệm vụ này đo bằng tiến trình thật, không cần tự xác nhận.' };
  var day = eventEnsureDailyDay(save, nowMs);
  var today = eventLocalDayKey(nowMs);
  if (day.claimed[questId]) return { ok: false, reason: 'Nhiệm vụ này hôm nay đã nhận thưởng rồi.' };
  day.manual[questId] = true;
  return { ok: true };
}
function eventClaimDaily(save, questId, nowMs) {
  var q = eventFindDailyQuest(questId);
  if (!q) return { ok: false, reason: 'Không có nhiệm vụ này.' };
  var day = eventEnsureDailyDay(save, nowMs);
  if (day.claimed[questId]) return { ok: false, reason: 'Nhiệm vụ này hôm nay đã nhận thưởng rồi!' };
  var prog = eventDailyProgress(save, q, nowMs);
  if (q.manual && !day.manual[questId]) return { ok: false, reason: 'Nhiệm vụ này tự xác nhận — hãy bấm "Đã làm xong" trước rồi mới nhận thưởng.' };
  if (!prog.done) return { ok: false, reason: 'Chưa hoàn thành nhiệm vụ (' + prog.progress + '/' + prog.target + ').' };
  var leveled = eventApplyReward(save, q.reward);
  day.claimed[questId] = true;
  return { ok: true, quest: q, rewardText: q.rewardText, leveled: leveled };
}

/* ============================== SỰ KIỆN TUẦN ============================== */
function eventFindWeekly(id) {
  for (var i = 0; i < EVENT_WEEKLY.length; i++) if (EVENT_WEEKLY[i].id === id) return EVENT_WEEKLY[i];
  return null;
}
/* Trạng thái 1 sự kiện tuần tại nowMs (giờ địa phương):
   live = đang diễn ra (kèm endMs), upcoming = sắp diễn ra (kèm nextStartMs),
   ended = khung hôm nay đã kết thúc (kèm nextStartMs của lần mở sau). */
function eventWeeklyStatus(ev, nowMs) {
  var p = eventLocalParts(nowMs);
  var todayStart = new Date(p.y, p.m - 1, p.day, ev.startHour, 0, 0).getTime();
  var todayEnd = new Date(p.y, p.m - 1, p.day, ev.endHour, 0, 0).getTime();
  var hasToday = ev.days.indexOf(p.dow) >= 0;
  if (hasToday && nowMs >= todayStart && nowMs < todayEnd) {
    return { status: 'live', startMs: todayStart, endMs: todayEnd };
  }
  if (hasToday && nowMs < todayStart) {
    return { status: 'upcoming', startMs: todayStart, endMs: todayEnd };
  }
  /* Tìm lần mở tiếp theo trong 7 ngày tới. */
  for (var d = 1; d <= 7; d++) {
    var nd = new Date(p.y, p.m - 1, p.day + d, ev.startHour, 0, 0);
    if (ev.days.indexOf(nd.getDay()) >= 0) {
      var st = nd.getTime();
      return { status: hasToday ? 'ended' : 'upcoming', startMs: st, endMs: new Date(p.y, p.m - 1, p.day + d, ev.endHour, 0, 0).getTime() };
    }
  }
  return { status: 'upcoming', startMs: todayStart, endMs: todayEnd };
}
function eventWeeklyStatusText(st, nowMs) {
  if (st.status === 'live') return { label: 'Đang diễn ra', cls: 'live', countdown: 'Kết thúc sau ' + eventFmtCountdown(st.endMs - nowMs), untilMs: st.endMs };
  if (st.status === 'upcoming') return { label: 'Sắp diễn ra', cls: 'upcoming', countdown: 'Bắt đầu sau ' + eventFmtCountdown(st.startMs - nowMs), untilMs: st.startMs };
  return { label: 'Đã kết thúc', cls: 'ended', countdown: 'Mở lại sau ' + eventFmtCountdown(st.startMs - nowMs), untilMs: st.startMs };
}
function eventClaimWeekly(save, evId, nowMs) {
  var ev = eventFindWeekly(evId);
  if (!ev) return { ok: false, reason: 'Không có sự kiện này.' };
  var st = eventWeeklyStatus(ev, nowMs);
  if (st.status !== 'live') {
    if (st.status === 'upcoming') return { ok: false, reason: 'Sự kiện chưa bắt đầu — bắt đầu sau ' + eventFmtCountdown(st.startMs - nowMs) + '.' };
    return { ok: false, reason: 'Sự kiện hôm nay đã kết thúc, hẹn lần mở sau!' };
  }
  var es = eventEnsureEventState(save);
  var today = eventLocalDayKey(nowMs);
  es.weekly[today] = es.weekly[today] || {};
  if (es.weekly[today][evId]) return { ok: false, reason: 'Hôm nay đã nhận thưởng sự kiện này rồi!' };
  var leveled = eventApplyReward(save, ev.reward);
  es.weekly[today][evId] = true;
  return { ok: true, event: ev, rewardText: ev.rewardText, leveled: leveled };
}

/* ============================== LỄ HỘI / THEO MÙA ============================== */
function eventSeasonalOrdinal(md) { return md[0] * 100 + md[1]; }
function eventSeasonalStatus(f, nowMs) {
  var p = eventLocalParts(nowMs);
  var todayOrd = p.m * 100 + p.day;
  var startOrd = eventSeasonalOrdinal(f.start);
  var endOrd = eventSeasonalOrdinal(f.end);
  if (todayOrd >= startOrd && todayOrd <= endOrd) {
    var endMs = new Date(p.y, f.end[0] - 1, f.end[1], 23, 59, 59).getTime();
    return { status: 'live', daysLeft: Math.max(0, Math.ceil((endMs - nowMs) / 86400000)) };
  }
  if (todayOrd < startOrd) {
    var startMs = new Date(p.y, f.start[0] - 1, f.start[1], 0, 0, 0).getTime();
    return { status: 'upcoming', daysUntil: Math.max(1, Math.ceil((startMs - nowMs) / 86400000)) };
  }
  var nextMs = new Date(p.y + 1, f.start[0] - 1, f.start[1], 0, 0, 0).getTime();
  return { status: 'ended', daysUntil: Math.max(1, Math.ceil((nextMs - nowMs) / 86400000)) };
}
function eventFindSeasonal(id) {
  for (var i = 0; i < EVENT_SEASONAL.length; i++) if (EVENT_SEASONAL[i].id === id) return EVENT_SEASONAL[i];
  return null;
}
function eventClaimSeasonal(save, festId, nowMs) {
  var f = eventFindSeasonal(festId);
  if (!f) return { ok: false, reason: 'Không có lễ hội này.' };
  var st = eventSeasonalStatus(f, nowMs);
  if (st.status !== 'live') {
    if (st.status === 'upcoming') return { ok: false, reason: 'Lễ hội chưa bắt đầu — còn ' + st.daysUntil + ' ngày nữa.' };
    return { ok: false, reason: 'Lễ hội đã kết thúc, hẹn sang năm!' };
  }
  var es = eventEnsureEventState(save);
  var p = eventLocalParts(nowMs);
  var key = p.y + ':' + festId;
  if (es.seasonal[key]) return { ok: false, reason: 'Năm nay đã nhận quà lễ hội này rồi!' };
  var leveled = eventApplyReward(save, f.reward);
  es.seasonal[key] = true;
  return { ok: true, fest: f, rewardText: f.rewardText, leveled: leveled };
}

/* ============================== BOSS THẾ GIỚI + BANG CHIẾN ============================== */
function eventBossStatus(nowMs) {
  var p = eventLocalParts(nowMs);
  var winMs = EVENT_WORLD_BOSS.windowMin * 60000;
  for (var i = 0; i < EVENT_WORLD_BOSS.times.length; i++) {
    var t = EVENT_WORLD_BOSS.times[i];
    var start = new Date(p.y, p.m - 1, p.day, t.h, t.m, 0).getTime();
    if (nowMs >= start && nowMs < start + winMs) return { status: 'live', startMs: start, endMs: start + winMs };
    if (nowMs < start) return { status: 'closed', nextStartMs: start };
  }
  var first = EVENT_WORLD_BOSS.times[0];
  var tomorrow = new Date(p.y, p.m - 1, p.day + 1, first.h, first.m, 0).getTime();
  return { status: 'closed', nextStartMs: tomorrow };
}
function eventClaimBoss(save, nowMs) {
  var st = eventBossStatus(nowMs);
  if (st.status !== 'live') return { ok: false, reason: 'Boss Thế Giới chưa mở — lần mở tiếp theo sau ' + eventFmtCountdown(st.nextStartMs - nowMs) + '.' };
  var es = eventEnsureEventState(save);
  var today = eventLocalDayKey(nowMs);
  if (es.boss[today]) return { ok: false, reason: 'Hôm nay đã nhận thưởng Boss Thế Giới rồi!' };
  var leveled = eventApplyReward(save, EVENT_WORLD_BOSS.reward);
  es.boss[today] = true;
  return { ok: true, rewardText: EVENT_WORLD_BOSS.rewardText, leveled: leveled };
}
function eventGuildWarStatus(nowMs) {
  var satKey = eventSaturdayKey(nowMs);
  var parts = satKey.split('-');
  var start = new Date(+parts[0], (+parts[1]) - 1, +parts[2], EVENT_GUILD_WAR.startHour, 0, 0).getTime();
  var end = new Date(+parts[0], (+parts[1]) - 1, +parts[2], EVENT_GUILD_WAR.endHour, 0, 0).getTime();
  if (nowMs >= start && nowMs < end) return { status: 'live', startMs: start, endMs: end, satKey: satKey };
  if (nowMs < start) return { status: 'upcoming', startMs: start, endMs: end, satKey: satKey };
  /* Đã qua Thứ 7 tuần này -> Thứ 7 tuần sau. */
  var nextKey = eventAddDaysKey(satKey, 7);
  var np = nextKey.split('-');
  var nStart = new Date(+np[0], (+np[1]) - 1, +np[2], EVENT_GUILD_WAR.startHour, 0, 0).getTime();
  var nEnd = new Date(+np[0], (+np[1]) - 1, +np[2], EVENT_GUILD_WAR.endHour, 0, 0).getTime();
  return { status: 'ended', startMs: nStart, endMs: nEnd, satKey: nextKey };
}
function eventClaimGuildWar(save, nowMs) {
  var st = eventGuildWarStatus(nowMs);
  if (st.status !== 'live') {
    if (st.status === 'upcoming') return { ok: false, reason: 'Bang Chiến chưa mở — bắt đầu sau ' + eventFmtCountdown(st.startMs - nowMs) + '.' };
    return { ok: false, reason: 'Bang Chiến tuần này đã kết thúc, hẹn Thứ 7 tuần sau!' };
  }
  var es = eventEnsureEventState(save);
  var key = 'gw-' + st.satKey;
  if (es.boss[key]) return { ok: false, reason: 'Tuần này đã nhận thưởng Bang Chiến rồi!' };
  var leveled = eventApplyReward(save, EVENT_GUILD_WAR.reward);
  es.boss[key] = true;
  return { ok: true, rewardText: EVENT_GUILD_WAR.rewardText, leveled: leveled };
}

/* ============================== ĐẤU TRƯỜNG XẾP HẠNG (GIẢ LẬP) ============================== */
function eventArenaRank(save) {
  var wins = Number((save.stats && save.stats.wins) || 0);
  var rank = 1;
  EVENT_ARENA_RIVALS.forEach(function (r) { if (r.wins > wins) rank++; });
  var board = EVENT_ARENA_RIVALS.map(function (r) { return { name: r.name, wins: r.wins, me: false }; });
  board.push({ name: (save.player && save.player.name) || 'Bạn', wins: wins, me: true });
  board.sort(function (a, b) { return b.wins - a.wins; });
  return { rank: rank, total: EVENT_ARENA_RIVALS.length + 1, wins: wins, board: board };
}
function eventArenaReward(rank) {
  if (rank <= 1) return { gold: 200, silver: 20000, exp: 1000, text: '+200 KNB · +20.000 bạc · +1.000 EXP' };
  if (rank <= 3) return { gold: 120, silver: 12000, exp: 600, text: '+120 KNB · +12.000 bạc · +600 EXP' };
  if (rank <= 5) return { gold: 60, silver: 6000, exp: 300, text: '+60 KNB · +6.000 bạc · +300 EXP' };
  return { gold: 20, silver: 2000, exp: 100, text: '+20 KNB · +2.000 bạc · +100 EXP' };
}
function eventClaimArena(save, nowMs) {
  var es = eventEnsureEventState(save);
  var wk = eventWeekKey(nowMs);
  if (es.arena[wk]) return { ok: false, reason: 'Tuần này đã nhận thưởng xếp hạng rồi — quay lại vào Thứ 2 tuần sau!' };
  var info = eventArenaRank(save);
  var rw = eventArenaReward(info.rank);
  var leveled = eventApplyReward(save, rw);
  es.arena[wk] = { rank: info.rank, wins: info.wins };
  return { ok: true, rank: info.rank, total: info.total, rewardText: rw.text, leveled: leveled };
}

/* ============================== ĐỔI QUÀ ============================== */
function eventFindRedeem(id) {
  for (var i = 0; i < EVENT_REDEEM_PACKS.length; i++) if (EVENT_REDEEM_PACKS[i].id === id) return EVENT_REDEEM_PACKS[i];
  return null;
}
function eventRedeemCount(save, packId, nowMs) {
  var es = eventEnsureEventState(save);
  var today = eventLocalDayKey(nowMs);
  var day = es.redeem[today] || {};
  return Number(day[packId]) || 0;
}
function eventRedeem(save, packId, nowMs) {
  var pk = eventFindRedeem(packId);
  if (!pk) return { ok: false, reason: 'Không có gói đổi quà này.' };
  var p = save.player;
  if (pk.cost.cur === 'gold' && (Number(p.gold) || 0) < pk.cost.amount) return { ok: false, reason: 'Không đủ Kim Nguyên Bảo! Cần ' + pk.cost.amount + ' KNB.' };
  if (pk.cost.cur === 'silver' && (Number(p.silver) || 0) < pk.cost.amount) return { ok: false, reason: 'Không đủ bạc! Cần ' + eventFmt(pk.cost.amount) + ' bạc.' };
  if (pk.cost.cur === 'gold') p.gold -= pk.cost.amount; else p.silver -= pk.cost.amount;
  var leveled = eventApplyReward(save, pk.reward);
  var es = eventEnsureEventState(save);
  var today = eventLocalDayKey(nowMs);
  es.redeem[today] = es.redeem[today] || {};
  es.redeem[today][packId] = (Number(es.redeem[today][packId]) || 0) + 1;
  return { ok: true, pack: pk, rewardText: pk.rewardText, leveled: leveled };
}

/* ============================== GIAO DIỆN TRÌNH DUYỆT ============================== */
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  var EventUI = { save: null, tab: 'checkin' };

  function eventToast(msg, good) {
    var box = document.getElementById('toast');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'ev-toast-item' + (good === false ? ' bad' : '');
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
  }

  function eventStatusBadge(cls, label) {
    return '<span class="ev-badge ' + cls + '">' + eventEsc(label) + '</span>';
  }

  function eventCheckinHTML() {
    var now = Date.now();
    var prev = eventCheckinPreview(EventUI.save, now);
    var cards = EVENT_CHECKIN_REWARDS.map(function (r) {
      var claimedDay = EventUI.save.flags.event.checkin.claimed[prev.today];
      var isToday = r.day === prev.dayIndex;
      var isPast = false;
      /* Ngày đã nhận trong chuỗi hiện tại: so theo streak — ngày < dayIndex
         của chuỗi này đã qua (trừ khi vừa nhận hôm nay thì dayIndex là ngày đã nhận). */
      if (prev.claimedToday) isPast = r.day < prev.dayIndex || r.day === prev.dayIndex;
      else isPast = r.day < prev.dayIndex;
      var cls = isPast ? ' done' : (isToday ? ' today' : ' locked');
      var mark = isPast ? '✅ Đã nhận' : (isToday ? (prev.claimedToday ? '✅ Đã nhận hôm nay' : '👉 Hôm nay') : '🔒 Chưa tới');
      return '<div class="ev-card' + cls + '">' +
        '<div class="ev-card-top"><span class="ev-ic">📅</span></div>' +
        '<b class="ev-name">' + r.label + '</b>' +
        '<div class="ev-desc">' + eventEsc(r.text) + '</div>' +
        '<div class="ev-mark">' + mark + '</div></div>';
    }).join('');
    var btn = prev.claimedToday
      ? '<button class="ev-btn big" disabled>✅ Hôm nay đã điểm danh — mai quay lại</button>'
      : '<button class="ev-btn big" data-act="checkin">📅 Điểm danh ' + prev.reward.label + ' — nhận ' + eventEsc(prev.reward.text) + '</button>';
    return '<p class="ev-note">Chuỗi điểm danh hiện tại: <b>' + prev.streak + ' ngày</b> liên tiếp' +
      (prev.streak > 0 && !prev.claimedToday ? ' · điểm danh hôm nay sẽ thành ngày thứ ' + prev.nextStreak + '.' : '.') +
      '<br>Ngày tính theo <b>ngày địa phương của máy</b> (không phải giờ UTC như chợ). Nghỉ 1 ngày là chuỗi về lại ngày 1.</p>' +
      '<div class="ev-grid">' + cards + '</div>' +
      '<div class="ev-cta">' + btn + '</div>';
  }

  function eventDailyHTML() {
    var now = Date.now();
    var day = eventEnsureDailyDay(EventUI.save, now);
    var rows = EVENT_DAILY_QUESTS.map(function (q) {
      var prog = eventDailyProgress(EventUI.save, q, now);
      var claimed = !!day.claimed[q.id];
      var manualDone = !!day.manual[q.id];
      var pct = Math.round(prog.progress / prog.target * 100);
      var btn;
      if (claimed) btn = '<button class="ev-btn" disabled>✅ Đã nhận</button>';
      else if (q.manual && !manualDone) btn = '<button class="ev-btn" data-act="daily-manual" data-id="' + q.id + '">✋ Đã làm xong</button>';
      else if (prog.done) btn = '<button class="ev-btn" data-act="daily-claim" data-id="' + q.id + '">🎁 Nhận thưởng</button>';
      else btn = '<button class="ev-btn" disabled>' + prog.progress + '/' + prog.target + '</button>';
      var manualNote = q.manual
        ? '<div class="ev-manual">⚠️ Tự xác nhận: chợ chưa ghi dấu mua hàng vào save, nên nhiệm vụ này do bạn tự bấm "Đã làm xong".</div>'
        : '';
      return '<div class="ev-row">' +
        '<span class="ev-ic">' + q.icon + '</span>' +
        '<div class="ev-row-info"><b>' + eventEsc(q.name) + '</b>' +
        '<span>' + eventEsc(q.desc) + '</span>' +
        '<span class="ev-reward">🎁 ' + eventEsc(q.rewardText) + '</span>' +
        '<div class="ev-bar"><i style="width:' + pct + '%"></i></div>' +
        '<span class="ev-prog">' + prog.progress + '/' + prog.target + (prog.done ? ' · Hoàn thành!' : '') + '</span>' +
        manualNote + '</div>' + btn + '</div>';
    }).join('');
    var doneCount = EVENT_DAILY_QUESTS.filter(function (q) { return !!day.claimed[q.id]; }).length;
    return '<p class="ev-note">Đã nhận <b>' + doneCount + '/' + EVENT_DAILY_QUESTS.length + '</b> nhiệm vụ hôm nay · Mỗi nhiệm vụ nhận thưởng 1 lần/ngày.' +
      '<br>Tiến trình thắng/trận/cấp/nhiệm vụ tính từ lúc mở trang Sự Kiện lần đầu trong ngày (baseline chụp lúc đó).</p>' + rows;
  }

  function eventWeeklyHTML() {
    var now = Date.now();
    var today = eventLocalDayKey(now);
    var es = EventUI.save.flags.event;
    var cards = EVENT_WEEKLY.map(function (ev) {
      var st = eventWeeklyStatus(ev, now);
      var t = eventWeeklyStatusText(st, now);
      var claimed = !!((es.weekly[today] || {})[ev.id]);
      var daysText = ev.days.slice().sort(function (a, b) { return a - b; }).map(eventWeekdayNameVN).join(' · ');
      var btn;
      if (claimed) btn = '<button class="ev-btn" disabled>✅ Đã nhận hôm nay</button>';
      else if (st.status === 'live') btn = '<button class="ev-btn" data-act="weekly-claim" data-id="' + ev.id + '">🎁 Nhận thưởng tham gia</button>';
      else if (st.status === 'upcoming') btn = '<button class="ev-btn" disabled>Sắp diễn ra</button>';
      else btn = '<button class="ev-btn" disabled>Đã kết thúc</button>';
      return '<div class="ev-card wide">' +
        '<div class="ev-card-top"><span class="ev-ic">' + ev.icon + '</span>' + eventStatusBadge(t.cls, t.label) + '</div>' +
        '<b class="ev-name">' + eventEsc(ev.name) + '</b>' +
        '<div class="ev-desc">' + eventEsc(ev.desc) + '<br>📆 ' + daysText + ' · ⏰ ' + eventPad(ev.startHour) + 'h00–' + eventPad(ev.endHour) + 'h00 (giờ địa phương)</div>' +
        '<div class="ev-cd" data-cd="' + t.untilMs + '">' + eventEsc(t.countdown) + '</div>' +
        '<div class="ev-reward">🎁 ' + eventEsc(ev.rewardText) + '</div>' +
        '<div class="ev-cta">' + btn + '</div></div>';
    }).join('');
    return '<p class="ev-note">Mọi khung giờ tính theo <b>giờ địa phương của máy</b>. Sự kiện đang diễn ra mới nhận được thưởng, mỗi sự kiện 1 lần/ngày.</p><div class="ev-grid">' + cards + '</div>';
  }

  function eventSeasonalHTML() {
    var now = Date.now();
    var p = eventLocalParts(now);
    var es = EventUI.save.flags.event;
    var cards = EVENT_SEASONAL.map(function (f) {
      var st = eventSeasonalStatus(f, now);
      var key = p.y + ':' + f.id;
      var claimed = !!es.seasonal[key];
      var badge, cd;
      if (st.status === 'live') { badge = eventStatusBadge('live', 'Đang diễn ra'); cd = 'Còn ' + st.daysLeft + ' ngày nữa kết thúc'; }
      else if (st.status === 'upcoming') { badge = eventStatusBadge('upcoming', 'Sắp diễn ra'); cd = 'Bắt đầu sau ' + st.daysUntil + ' ngày'; }
      else { badge = eventStatusBadge('ended', 'Đã kết thúc'); cd = 'Hẹn sang năm (sau ' + st.daysUntil + ' ngày)'; }
      var btn;
      if (claimed) btn = '<button class="ev-btn" disabled>✅ Đã nhận năm nay</button>';
      else if (st.status === 'live') btn = '<button class="ev-btn" data-act="seasonal-claim" data-id="' + f.id + '">🎁 Nhận quà lễ hội</button>';
      else btn = '<button class="ev-btn" disabled>' + (st.status === 'upcoming' ? 'Chưa bắt đầu' : 'Đã kết thúc') + '</button>';
      return '<div class="ev-card wide">' +
        '<div class="ev-card-top"><span class="ev-ic">' + f.icon + '</span>' + badge + '</div>' +
        '<b class="ev-name">' + eventEsc(f.name) + '</b>' +
        '<div class="ev-desc">' + eventEsc(f.desc) + '</div>' +
        '<div class="ev-cd">' + eventEsc(cd) + '</div>' +
        '<div class="ev-reward">🎁 ' + eventEsc(f.rewardText) + '</div>' +
        '<div class="ev-cta">' + btn + '</div></div>';
    }).join('');
    return '<p class="ev-note">Lễ hội theo ngày dương lịch hằng năm, mỗi lễ hội nhận quà 1 lần/năm.</p><div class="ev-grid">' + cards + '</div>';
  }

  function eventBossHTML() {
    var now = Date.now();
    var es = EventUI.save.flags.event;
    var today = eventLocalDayKey(now);
    var bs = eventBossStatus(now);
    var bossBadge = bs.status === 'live'
      ? eventStatusBadge('live', 'Đang mở')
      : eventStatusBadge('ended', 'Đang đóng');
    var bossCd = bs.status === 'live'
      ? '<div class="ev-cd" data-cd="' + bs.endMs + '">Đóng sau ' + eventFmtCountdown(bs.endMs - now) + '</div>'
      : '<div class="ev-cd" data-cd="' + bs.nextStartMs + '">Mở tiếp theo sau ' + eventFmtCountdown(bs.nextStartMs - now) + '</div>';
    var bossBtn = bs.status === 'live'
      ? (es.boss[today]
        ? '<button class="ev-btn" disabled>✅ Đã nhận thưởng hôm nay</button>'
        : '<button class="ev-btn" data-act="boss-claim">⚔️ Tham gia — nhận thưởng</button>')
      : '<button class="ev-btn" disabled>Boss chưa mở</button>';
    var gw = eventGuildWarStatus(now);
    var gwBadge = gw.status === 'live' ? eventStatusBadge('live', 'Đang diễn ra')
      : gw.status === 'upcoming' ? eventStatusBadge('upcoming', 'Sắp diễn ra')
      : eventStatusBadge('ended', 'Đã kết thúc');
    var gwCd = gw.status === 'live'
      ? '<div class="ev-cd" data-cd="' + gw.endMs + '">Kết thúc sau ' + eventFmtCountdown(gw.endMs - now) + '</div>'
      : '<div class="ev-cd" data-cd="' + gw.startMs + '">' + (gw.status === 'upcoming' ? 'Bắt đầu sau ' : 'Mở lại sau ') + eventFmtCountdown(gw.startMs - now) + '</div>';
    var gwBtn = gw.status === 'live'
      ? (es.boss['gw-' + gw.satKey]
        ? '<button class="ev-btn" disabled>✅ Đã nhận thưởng tuần này</button>'
        : '<button class="ev-btn" data-act="gw-claim">🚩 Tham gia Bang Chiến</button>')
      : '<button class="ev-btn" disabled>Bang Chiến chưa mở</button>';
    var gwDate = gw.satKey.split('-');
    return '<p class="ev-note">Lịch cố định theo <b>giờ địa phương</b>. Boss Thế Giới thưởng 1 lần/ngày, Bang Chiến thưởng 1 lần/tuần.</p>' +
      '<div class="ev-grid">' +
      '<div class="ev-card wide"><div class="ev-card-top"><span class="ev-ic">👹</span>' + bossBadge + '</div>' +
      '<b class="ev-name">Boss Thế Giới</b>' +
      '<div class="ev-desc">' + eventEsc(EVENT_WORLD_BOSS.desc) + '</div>' + bossCd +
      '<div class="ev-reward">🎁 ' + eventEsc(EVENT_WORLD_BOSS.rewardText) + '</div>' +
      '<div class="ev-cta">' + bossBtn + '</div></div>' +
      '<div class="ev-card wide"><div class="ev-card-top"><span class="ev-ic">🚩</span>' + gwBadge + '</div>' +
      '<b class="ev-name">Bang Chiến</b>' +
      '<div class="ev-desc">' + eventEsc(EVENT_GUILD_WAR.desc) + '<br>📆 Thứ 7 tuần này: ' + gwDate[2] + '/' + gwDate[1] + '/' + gwDate[0] + ' · ⏰ 19h00–20h00</div>' + gwCd +
      '<div class="ev-reward">🎁 ' + eventEsc(EVENT_GUILD_WAR.rewardText) + '</div>' +
      '<div class="ev-cta">' + gwBtn + '</div></div>' +
      '</div>';
  }

  function eventArenaHTML() {
    var now = Date.now();
    var es = EventUI.save.flags.event;
    var wk = eventWeekKey(now);
    var info = eventArenaRank(EventUI.save);
    var rw = eventArenaReward(info.rank);
    var claimed = !!es.arena[wk];
    var rows = info.board.map(function (r, i) {
      return '<div class="ev-row' + (r.me ? ' me' : '') + '">' +
        '<span class="ev-rank">' + (i + 1) + '</span>' +
        '<div class="ev-row-info"><b>' + eventEsc(r.name) + (r.me ? ' (Bạn)' : '') + '</b>' +
        '<span>' + r.wins + ' trận thắng</span></div>' +
        '<span class="ev-reward">' + (i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : '') + '</span></div>';
    }).join('');
    var btn = claimed
      ? '<button class="ev-btn big" disabled>✅ Đã nhận thưởng tuần này — quay lại vào Thứ 2 tuần sau</button>'
      : '<button class="ev-btn big" data-act="arena-claim">🏆 Nhận thưởng hạng ' + info.rank + '/' + info.total + ' — ' + eventEsc(rw.text) + '</button>';
    return '<p class="ev-note">⚠️ <b>Bảng giả lập:</b> đối thủ là danh sách cố định, hạng của bạn tính từ số trận thắng thật (stats.wins = ' + info.wins + '). Thưởng theo hạng nhận 1 lần/tuần (tuần tính từ Thứ 2).</p>' +
      '<p class="ev-note">Hạng của bạn: <b>#' + info.rank + '/' + info.total + '</b> · Thưởng tuần này: ' + eventEsc(rw.text) + '</p>' +
      rows + '<div class="ev-cta">' + btn + '</div>';
  }

  function eventRedeemHTML() {
    var now = Date.now();
    var p = EventUI.save.player;
    var rows = EVENT_REDEEM_PACKS.map(function (pk) {
      var afford = pk.cost.cur === 'gold' ? p.gold >= pk.cost.amount : p.silver >= pk.cost.amount;
      var count = eventRedeemCount(EventUI.save, pk.id, now);
      return '<div class="ev-row">' +
        '<span class="ev-ic">' + pk.icon + '</span>' +
        '<div class="ev-row-info"><b>' + eventEsc(pk.name) + '</b>' +
        '<span>' + eventEsc(pk.desc) + '</span>' +
        '<span class="ev-reward">🎁 ' + eventEsc(pk.rewardText) + '</span>' +
        '<span class="ev-prog">Đã đổi hôm nay: ' + count + ' lần (đổi được nhiều lần, mỗi lần đều trừ tiền)</span></div>' +
        '<button class="ev-btn" data-act="redeem" data-id="' + pk.id + '"' + (afford ? '' : ' disabled') + '>Đổi<br><span>' + eventEsc(pk.costText) + '</span></button></div>';
    }).join('');
    return '<p class="ev-note">Đổi quà trừ tiền thật trong save — kiểm tra đủ tiền mới cho đổi. Đồ đổi được vào túi đồ ngay.</p>' + rows;
  }

  function eventRender() {
    var save = EventUI.save, p = save.player;
    var w = document.getElementById('event-wallet');
    if (w) w.innerHTML = '<span>🪙 <b>' + eventFmt(p.gold) + '</b> KNB</span><span>⚪ <b>' + eventFmt(p.silver) + '</b> bạc</span>';
    var pl = document.getElementById('event-player');
    if (pl) pl.textContent = p.name + ' · Cấp ' + p.level + ' · EXP ' + p.exp + '/' + p.maxExp + ' · Công ' + p.atk + ' · Thủ ' + p.def;
    var tabs = document.getElementById('event-tabs');
    if (tabs) {
      tabs.innerHTML = EVENT_TABS.map(function (t) {
        return '<button class="ev-tab' + (EventUI.tab === t.id ? ' on' : '') + '" data-act="tab" data-tab="' + t.id + '">' + t.icon + ' ' + t.label + '</button>';
      }).join('');
    }
    var grid = document.getElementById('event-grid');
    if (!grid) return;
    if (EventUI.tab === 'checkin') grid.innerHTML = eventCheckinHTML();
    else if (EventUI.tab === 'daily') grid.innerHTML = eventDailyHTML();
    else if (EventUI.tab === 'weekly') grid.innerHTML = eventWeeklyHTML();
    else if (EventUI.tab === 'seasonal') grid.innerHTML = eventSeasonalHTML();
    else if (EventUI.tab === 'boss') grid.innerHTML = eventBossHTML();
    else if (EventUI.tab === 'arena') grid.innerHTML = eventArenaHTML();
    else if (EventUI.tab === 'redeem') grid.innerHTML = eventRedeemHTML();
  }

  function eventTickClock() {
    var c = document.getElementById('event-clock');
    if (c) c.textContent = '🕒 Giờ địa phương: ' + eventClockText(Date.now());
    var now = Date.now();
    var els = document.querySelectorAll('[data-cd]');
    for (var i = 0; i < els.length; i++) {
      var until = +els[i].getAttribute('data-cd');
      if (!until) continue;
      var txt = els[i].textContent;
      var prefix = txt.split(' sau ')[0];
      els[i].textContent = prefix + ' sau ' + eventFmtCountdown(until - now);
    }
  }

  function eventInit() {
    EventUI.save = eventLoadSave();
    eventEnsureEventState(EventUI.save);
    eventEnsureDailyDay(EventUI.save, Date.now());
    eventPersist(EventUI.save);
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el || el.disabled) return;
      var act = el.dataset.act;
      var r;
      if (act === 'tab') { EventUI.tab = el.dataset.tab; eventRender(); }
      else if (act === 'checkin') {
        r = eventClaimCheckin(EventUI.save, Date.now());
        if (!r.ok) { eventToast(r.reason, false); return; }
        eventPersist(EventUI.save);
        eventToast('✅ Điểm danh ngày ' + r.day + ' (chuỗi ' + r.streak + ' ngày): ' + r.rewardText + (r.leveled ? ' — lên cấp ' + EventUI.save.player.level + '!' : ''), true);
        eventRender();
      }
      else if (act === 'daily-manual') {
        r = eventDailyMarkManual(EventUI.save, el.dataset.id, Date.now());
        if (!r.ok) { eventToast(r.reason, false); return; }
        eventPersist(EventUI.save);
        eventToast('✋ Đã ghi nhận bạn tự xác nhận hoàn thành — giờ có thể nhận thưởng.', true);
        eventRender();
      }
      else if (act === 'daily-claim') {
        r = eventClaimDaily(EventUI.save, el.dataset.id, Date.now());
        if (!r.ok) { eventToast(r.reason, false); return; }
        eventPersist(EventUI.save);
        eventToast('✅ ' + r.quest.name + ': ' + r.rewardText + (r.leveled ? ' — lên cấp ' + EventUI.save.player.level + '!' : ''), true);
        eventRender();
      }
      else if (act === 'weekly-claim') {
        r = eventClaimWeekly(EventUI.save, el.dataset.id, Date.now());
        if (!r.ok) { eventToast(r.reason, false); return; }
        eventPersist(EventUI.save);
        eventToast('✅ ' + r.event.name + ': ' + r.rewardText + (r.leveled ? ' — lên cấp ' + EventUI.save.player.level + '!' : ''), true);
        eventRender();
      }
      else if (act === 'seasonal-claim') {
        r = eventClaimSeasonal(EventUI.save, el.dataset.id, Date.now());
        if (!r.ok) { eventToast(r.reason, false); return; }
        eventPersist(EventUI.save);
        eventToast('✅ ' + r.fest.name + ': ' + r.rewardText + (r.leveled ? ' — lên cấp ' + EventUI.save.player.level + '!' : ''), true);
        eventRender();
      }
      else if (act === 'boss-claim') {
        r = eventClaimBoss(EventUI.save, Date.now());
        if (!r.ok) { eventToast(r.reason, false); return; }
        eventPersist(EventUI.save);
        eventToast('✅ Boss Thế Giới: ' + r.rewardText + (r.leveled ? ' — lên cấp ' + EventUI.save.player.level + '!' : ''), true);
        eventRender();
      }
      else if (act === 'gw-claim') {
        r = eventClaimGuildWar(EventUI.save, Date.now());
        if (!r.ok) { eventToast(r.reason, false); return; }
        eventPersist(EventUI.save);
        eventToast('✅ Bang Chiến: ' + r.rewardText + (r.leveled ? ' — lên cấp ' + EventUI.save.player.level + '!' : ''), true);
        eventRender();
      }
      else if (act === 'arena-claim') {
        r = eventClaimArena(EventUI.save, Date.now());
        if (!r.ok) { eventToast(r.reason, false); return; }
        eventPersist(EventUI.save);
        eventToast('✅ Xếp hạng #' + r.rank + '/' + r.total + ': ' + r.rewardText + (r.leveled ? ' — lên cấp ' + EventUI.save.player.level + '!' : ''), true);
        eventRender();
      }
      else if (act === 'redeem') {
        r = eventRedeem(EventUI.save, el.dataset.id, Date.now());
        if (!r.ok) { eventToast(r.reason, false); return; }
        eventPersist(EventUI.save);
        eventToast('✅ Đã đổi ' + r.pack.name + ': ' + r.rewardText + (r.leveled ? ' — lên cấp ' + EventUI.save.player.level + '!' : ''), true);
        eventRender();
      }
      else if (act === 'back') {
        eventPersist(EventUI.save);
        location.href = 'mongvolam.html';
      }
    });
    setInterval(eventTickClock, 1000);
    setInterval(eventRender, 30000);
    eventTickClock();
    eventRender();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', eventInit);
  else eventInit();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EVENT_SAVE_KEY: EVENT_SAVE_KEY, EVENT_TABS: EVENT_TABS,
    EVENT_CHECKIN_REWARDS: EVENT_CHECKIN_REWARDS,
    EVENT_DAILY_QUESTS: EVENT_DAILY_QUESTS,
    EVENT_WEEKLY: EVENT_WEEKLY, EVENT_SEASONAL: EVENT_SEASONAL,
    EVENT_WORLD_BOSS: EVENT_WORLD_BOSS, EVENT_GUILD_WAR: EVENT_GUILD_WAR,
    EVENT_ARENA_RIVALS: EVENT_ARENA_RIVALS, EVENT_REDEEM_PACKS: EVENT_REDEEM_PACKS,
    eventPad: eventPad, eventLocalDayKey: eventLocalDayKey,
    eventLocalParts: eventLocalParts, eventAddDaysKey: eventAddDaysKey,
    eventYesterdayKey: eventYesterdayKey, eventWeekdayNameVN: eventWeekdayNameVN,
    eventClockText: eventClockText, eventFmtCountdown: eventFmtCountdown,
    eventWeekKey: eventWeekKey, eventSaturdayKey: eventSaturdayKey,
    eventFmt: eventFmt, eventDefaultEventState: eventDefaultEventState,
    eventDefaultSave: eventDefaultSave, eventEnsureEventState: eventEnsureEventState,
    eventLoadSave: eventLoadSave, eventGainExp: eventGainExp,
    eventApplyReward: eventApplyReward, eventRewardText: eventRewardText,
    eventCheckinPreview: eventCheckinPreview, eventClaimCheckin: eventClaimCheckin,
    eventDailySnapshot: eventDailySnapshot, eventEnsureDailyDay: eventEnsureDailyDay,
    eventDailyProgress: eventDailyProgress, eventDailyMarkManual: eventDailyMarkManual,
    eventClaimDaily: eventClaimDaily, eventWeeklyStatus: eventWeeklyStatus,
    eventClaimWeekly: eventClaimWeekly, eventSeasonalStatus: eventSeasonalStatus,
    eventClaimSeasonal: eventClaimSeasonal, eventBossStatus: eventBossStatus,
    eventClaimBoss: eventClaimBoss, eventGuildWarStatus: eventGuildWarStatus,
    eventClaimGuildWar: eventClaimGuildWar, eventArenaRank: eventArenaRank,
    eventArenaReward: eventArenaReward, eventClaimArena: eventClaimArena,
    eventRedeem: eventRedeem, eventRedeemCount: eventRedeemCount
  };
}
/* EVENT-END */
