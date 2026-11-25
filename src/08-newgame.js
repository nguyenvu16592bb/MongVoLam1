/* ============================================================================
   NEWGAME — MÀN HÌNH CHÍNH (Newgame.html)
   Trang mở đầu độc lập, tự chứa, chia sẻ đúng save localStorage v2 với game
   (SAVE_KEY 'mongvolam_soha_v1', xem src/01-data.js SaveManager).
   - Đọc/ghi NGUYÊN save JSON: tạo mới thì reset hoàn toàn theo schema v2
     (player, heroes, leader, quests, guild, inventory, customProps, stats,
     settings, flags, v:2); cài đặt thì chỉ đổi object settings.
   - File này vừa chạy trong trình duyệt (Newgame.html inline), vừa require()
     được trong Node để kiểm thử logic thuần (xem test tạm trong /tmp).
   - Dữ liệu đệ tử (NEWGAME_HEROES) copy đúng id/tên/danh hiệu/môn phái/phẩm/
     cấp từ HERO_DEFS (6) + RECRUIT_DEFS (14) trong src/01-data.js, vì trang
     này chạy độc lập, không nối chung JS của game.
   - Nhân vật mới khởi đầu ở CẤP 3 (giống mặc định State.player: HP 500,
     Nội lực 200, Công 68, Thủ 42, tốc độ 7.5), chỉ khác EXP bắt đầu 0/160
     (State.player mặc định là 64/160) — nhân vật mới chưa đánh trận nào.
   ========================================================================== */
'use strict';

/* NEWGAME-BEGIN */
const NEWGAME_SAVE_KEY = 'mongvolam_soha_v1';

/* Chỉ số gốc của nhân vật mới (khớp State.player mặc định, trừ exp = 0). */
const NEWGAME_BASE_PLAYER = {
  level: 3, exp: 0, maxExp: 160,
  hp: 500, maxHp: 500, mp: 200, maxMp: 200,
  atk: 68, def: 42, speed: 7.5,
  gold: 455, silver: 40932,
  capacity: 13, maxCapacity: 30
};

/* 6 môn phái — mỗi phái: mô tả + vũ khí/bào phục khởi đầu + cộng chỉ số.
   Bonus cộng thẳng vào chỉ số gốc (xem ngPreviewStats). */
const NEWGAME_SECTS = [
  {
    id: 'thieulam', name: 'Thiếu Lâm', icon: '🛕',
    desc: 'Thiếu Lâm tự — Kim Cương Bất Hoại, nội công hùng hậu, phòng thủ vững như núi.',
    weapon: 'Thiếu Lâm Thiết Quyền', armorName: 'Thiếu Lâm Tăng Bào',
    bonus: { hp: 150, mp: 0, atk: 0, def: 12, speed: 0 }
  },
  {
    id: 'vodang', name: 'Võ Đang', icon: '☯️',
    desc: 'Võ Đang sơn — Thái Cực kiếm pháp, nội lực thâm hậu, lấy nhu thắng cương.',
    weapon: 'Võ Đang Trường Kiếm', armorName: 'Võ Đang Đạo Bào',
    bonus: { hp: 80, mp: 80, atk: 8, def: 6, speed: 0 }
  },
  {
    id: 'hoason', name: 'Hoa Sơn', icon: '🗡️',
    desc: 'Hoa Sơn phái — kiếm pháp hiểm mà chính, ra chiêu nhanh như chớp giật.',
    weapon: 'Hoa Sơn Trường Kiếm', armorName: 'Hoa Sơn Thanh Bào',
    bonus: { hp: 0, mp: 0, atk: 16, def: 0, speed: 1.0 }
  },
  {
    id: 'ngami', name: 'Nga Mi', icon: '🌸',
    desc: 'Nga Mi phái — kiếm pháp thanh thoát, nội công miên miên bất tuyệt, cứu người độ thế.',
    weapon: 'Nga Mi Song Kiếm', armorName: 'Nga Mi Tố Y',
    bonus: { hp: 80, mp: 60, atk: 0, def: 6, speed: 0 }
  },
  {
    id: 'caibang', name: 'Cái Bang', icon: '🥢',
    desc: 'Cái Bang — Hàng Long Thập Bát Chưởng, nghĩa khí ngút trời, đánh đâu thắng đó.',
    weapon: 'Đả Cẩu Bổng', armorName: 'Cái Bang Hào Kiệt Bào',
    bonus: { hp: 60, mp: 0, atk: 12, def: 0, speed: 0.5 }
  },
  {
    id: 'minhgiao', name: 'Minh Giáo', icon: '🔥',
    desc: 'Minh Giáo — Thánh Hỏa Lệnh, Càn Khôn Đại Na Di, công lực bá đạo, càng đánh càng mạnh.',
    weapon: 'Minh Giáo Thánh Hỏa Lệnh', armorName: 'Minh Giáo Hồng Bào',
    bonus: { hp: 40, mp: 40, atk: 20, def: 0, speed: 0 }
  }
];

/* 12 tên gợi ý võ hiệp (bấm nút 🎲 để lấy ngẫu nhiên một tên). */
const NEWGAME_NAME_SUGGESTIONS = [
  'Tiêu Dao Sinh', 'Phong Vô Kỵ', 'Kiếm Vô Song', 'Bạch Y Thư Sinh',
  'Huyết Đao Khách', 'Ngọc Diện Công Tử', 'Thanh Vân Đạo Nhân', 'Tuyết Sơn Hiệp Khách',
  'Long Ngâm Kiếm', 'Vô Danh Tiểu Tốt', 'Thần Phong Thiếu Hiệp', 'Lãnh Nguyệt Kiếm Khách'
];

/* 8 màu áo cho ngoại hình chibi. */
const NEWGAME_ROBE_COLORS = [
  { id: 'do', name: 'Đỏ Son', value: '#b91c1c' },
  { id: 'lam', name: 'Xanh Lam', value: '#1d4ed8' },
  { id: 'luc', name: 'Xanh Lá', value: '#15803d' },
  { id: 'vang', name: 'Vàng Kim', value: '#b45309' },
  { id: 'tim', name: 'Tím Huyền', value: '#7e22ce' },
  { id: 'trang', name: 'Trắng Tuyết', value: '#cbd5e1' },
  { id: 'den', name: 'Đen Huyền', value: '#1e293b' },
  { id: 'hong', name: 'Hồng Đào', value: '#be185d' }
];

/* 5 kiểu tóc cho ngoại hình chibi (vẽ bằng CSS trong template). */
const NEWGAME_HAIRSTYLES = [
  { id: 'bui-cao', name: 'Búi cao đạo sĩ', icon: '🎎' },
  { id: 'xoa-dai', name: 'Xõa dài phiêu dật', icon: '💇' },
  { id: 'duoi-ngua', name: 'Buộc đuôi ngựa', icon: '🐴' },
  { id: 'toc-ngan', name: 'Tóc ngắn gọn gàng', icon: '✂️' },
  { id: 'dau-troc', name: 'Đầu trọc Thiếu Lâm', icon: '🛕' }
];

/* Toàn bộ 20 đệ tử — copy đúng id/tên/danh hiệu/môn phái/phẩm/cấp từ
   HERO_DEFS (6 đệ tử gốc) + RECRUIT_DEFS (14 đệ tử chiêu mộ), src/01-data.js.
   6 đệ tử gốc (chọn làm đệ tử khởi đầu): det, tieu, kiem, linh, niep, bo. */
const NEWGAME_HEROES = [
  { id: 'det', name: 'Đế Thích Thiên', title: 'Nhất Phương Xưng Hùng', sect: 'Thiên Môn', type: 'Giáp', level: 400, starter: true },
  { id: 'tieu', name: 'Tùy Tiêu Sầu', title: 'Tiêu Dao Kiếm Tiên', sect: 'Tiêu Dao Phái', type: 'Giáp', level: 385, starter: true },
  { id: 'kiem', name: 'Độc Cô Kiếm Thánh', title: 'Kiếm Đạo Chí Tôn', sect: 'Vô Song Thành', type: 'Giáp', level: 390, starter: true },
  { id: 'linh', name: 'Triệu Linh Nhi', title: 'Thánh Nữ Nam Chiếu', sect: 'Nga Mi Phái', type: 'Giáp', level: 375, starter: true },
  { id: 'niep', name: 'Nhiếp Phong', title: 'Phong Trung Chi Thần', sect: 'Thiên Hạ Hội', type: 'Giáp', level: 396, starter: true },
  { id: 'bo', name: 'Bộ Kinh Vân', title: 'Bất Khốc Tử Thần', sect: 'Thiên Hạ Hội', type: 'Giáp', level: 396, starter: true },
  { id: 'lenhho', name: 'Lệnh Hồ Xung', title: 'Thiếu Niên Kiếm Khách', sect: 'Hoa Sơn', type: 'Bính', level: 120, starter: false },
  { id: 'nghlam', name: 'Nghi Lâm', title: 'Tiểu Sư Muội', sect: 'Hằng Sơn', type: 'Bính', level: 120, starter: false },
  { id: 'doanh', name: 'Nhậm Doanh Doanh', title: 'Thánh Cô', sect: 'Nhật Nguyệt Thần Giáo', type: 'Ất', level: 200, starter: false },
  { id: 'duong', name: 'Dương Quá', title: 'Thần Điêu Đại Hiệp', sect: 'Cổ Mộ', type: 'Ất', level: 200, starter: false },
  { id: 'dongph', name: 'Đông Phương Bất Bại', title: 'Giáo Chủ', sect: 'Nhật Nguyệt Thần Giáo', type: 'Giáp', level: 300, starter: false },
  { id: 'docco', name: 'Độc Cô Cầu Bại', title: 'Kiếm Ma', sect: 'Vô Danh', type: 'Giáp', level: 300, starter: false },
  { id: 'longnu', name: 'Tiểu Long Nữ', title: 'Ngọc Nữ', sect: 'Cổ Mộ', type: 'Giáp', level: 300, starter: false },
  { id: 'quoctinh', name: 'Quách Tĩnh', title: 'Bắc Hiệp', sect: 'Cái Bang', type: 'Giáp', level: 300, starter: false },
  { id: 'hoangdung', name: 'Hoàng Dung', title: 'Đào Hoa Đảo Chủ', sect: 'Đào Hoa Đảo', type: 'Ất', level: 200, starter: false },
  { id: 'hongthat', name: 'Hồng Thất Công', title: 'Cửu Chỉ Thần Cái', sect: 'Cái Bang', type: 'Giáp', level: 300, starter: false },
  { id: 'chuba', name: 'Chu Bá Thông', title: 'Lão Ngoan Đồng', sect: 'Toàn Chân', type: 'Giáp', level: 300, starter: false },
  { id: 'vuongtrung', name: 'Vương Trùng Dương', title: 'Trung Thần Thông', sect: 'Toàn Chân', type: 'Giáp', level: 300, starter: false },
  { id: 'lamtrieu', name: 'Lâm Triều Anh', title: 'Cổ Mộ Tổ Sư', sect: 'Cổ Mộ', type: 'Ất', level: 200, starter: false },
  { id: 'trieuman', name: 'Triệu Mẫn', title: 'Thiệu Mẫn Quận Chúa', sect: 'Mông Cổ', type: 'Bính', level: 120, starter: false }
];

const NEWGAME_SPEEDS = [1, 2, 3, 5];
const NEWGAME_DEFAULT_SETTINGS = { muted: false, autoBattle: true, autoSkill: true, speed: 1 };

/* ============================== LOGIC THUẦN (test được bằng Node) ============================== */

function ngEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function ngFmt(n) {
  n = Number(n) || 0;
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function ngSectById(id) {
  for (var i = 0; i < NEWGAME_SECTS.length; i++) if (NEWGAME_SECTS[i].id === id) return NEWGAME_SECTS[i];
  return null;
}
function ngHeroById(id) {
  for (var i = 0; i < NEWGAME_HEROES.length; i++) if (NEWGAME_HEROES[i].id === id) return NEWGAME_HEROES[i];
  return null;
}
function ngColorById(id) {
  for (var i = 0; i < NEWGAME_ROBE_COLORS.length; i++) if (NEWGAME_ROBE_COLORS[i].id === id) return NEWGAME_ROBE_COLORS[i];
  return NEWGAME_ROBE_COLORS[0];
}
function ngHairById(id) {
  for (var i = 0; i < NEWGAME_HAIRSTYLES.length; i++) if (NEWGAME_HAIRSTYLES[i].id === id) return NEWGAME_HAIRSTYLES[i];
  return NEWGAME_HAIRSTYLES[0];
}
function ngStarterHeroes() {
  return NEWGAME_HEROES.filter(function (h) { return h.starter; });
}

/* Tên nhân vật: trim, rỗng hoặc dài quá 12 ký tự thì từ chối (kèm lý do). */
function ngValidateName(raw) {
  var name = String(raw == null ? '' : raw).trim();
  if (!name) return { ok: false, name: name, reason: 'Hãy nhập tên nhân vật (từ 1 đến 12 ký tự).' };
  if (name.length > 12) return { ok: false, name: name, reason: 'Tên dài quá 12 ký tự — hãy rút ngắn lại nhé.' };
  return { ok: true, name: name, reason: '' };
}
function ngSuggestName() {
  return NEWGAME_NAME_SUGGESTIONS[Math.floor(Math.random() * NEWGAME_NAME_SUGGESTIONS.length)];
}

/* Chỉ số xem trước = chỉ số gốc cấp 3 + cộng dồn của môn phái. */
function ngPreviewStats(sectId) {
  var b = NEWGAME_BASE_PLAYER;
  var sect = ngSectById(sectId);
  var bonus = sect ? sect.bonus : { hp: 0, mp: 0, atk: 0, def: 0, speed: 0 };
  return {
    level: b.level,
    hp: b.maxHp + (bonus.hp || 0),
    mp: b.maxMp + (bonus.mp || 0),
    atk: b.atk + (bonus.atk || 0),
    def: b.def + (bonus.def || 0),
    speed: Math.round((b.speed + (bonus.speed || 0)) * 10) / 10,
    gold: b.gold, silver: b.silver,
    sect: sect
  };
}

/* Save mặc định đầy đủ schema v2 — khớp State mặc định của game
   (src/01-data.js), chỉ khác exp bắt đầu 0/160 (nhân vật mới). */
function ngDefaultSave() {
  function hb() { return { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 }; }
  return {
    player: {
      name: 'Song Ma Quyền Phái', faction: 'Song Ma Phái',
      level: 3, exp: 0, maxExp: 160,
      hp: 500, maxHp: 500, mp: 200, maxMp: 200,
      atk: 68, def: 42, speed: 7.5,
      gold: 455, silver: 40932,
      capacity: 13, maxCapacity: 30,
      weapon: 'Song Ma Thiết Quyền', armorName: 'Hắc Vân Võ Bào', accessory: 'Ngọc Bội Thanh Long',
      look: { gender: 'Nam', color: 'do', hair: 'bui-cao' }, sectDesc: ''
    },
    heroes: ngStarterHeroes().map(function (h) { return { id: h.id, level: h.level, bonus: hb() }; }),
    leader: 0,
    quests: [
      { id: 'q1', title: 'Chào Hỏi Biện Kinh', desc: 'Đối thoại với Chưởng Quầy Tạp Hóa', target: 1, progress: 0, exp: 60, silver: 1500, done: false },
      { id: 'q2', title: 'Thí Luyện Võ Đạo', desc: 'Chiến thắng một trận tại chiến trường', target: 1, progress: 0, exp: 110, silver: 3000, done: false },
      { id: 'q3', title: 'Thưởng Ngoạn Cầu Đá', desc: 'Bước qua cầu đá bắc ngang hồ sen', target: 1, progress: 0, exp: 45, silver: 1000, done: false },
      { id: 'q4', title: 'Truyền Thừa Võ Học', desc: 'Bồi dưỡng một đệ tử trong hồ sơ', target: 1, progress: 0, exp: 90, silver: 2200, done: false },
      { id: 'q5', title: 'Bách Chiến Bất Bại', desc: 'Thắng 3 trận chiến trường', target: 3, progress: 0, exp: 320, silver: 9000, done: false }
    ],
    guild: { name: 'Thiên Địa Hội [MV]', level: 4, members: 28, contribution: 350 },
    inventory: [
      { id: 'i1', name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', qty: 5 },
      { id: 'i2', name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 3 },
      { id: 'i3', name: 'Huyền Thiết Tinh', icon: '💎', type: 'Nguyên liệu', desc: 'Rèn trang bị', qty: 3 }
    ],
    customProps: [], stats: { battles: 0, wins: 0, kills: 0 },
    settings: { muted: false, autoBattle: true, autoSkill: true, speed: 1 },
    flags: { tutorial: false, shop: {}, createdVia: '' },
    v: 2
  };
}

/* Đọc save thật (storage = localStorage ở trình duyệt, hoặc object giả ở test).
   Trả về null nếu chưa có save hợp lệ — KHÔNG tự tạo save mới. */
function ngLoadSave(storage) {
  try {
    if (!storage) return null;
    var raw = storage.getItem(NEWGAME_SAVE_KEY);
    if (!raw) return null;
    var d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !d.player) return null;
    return d;
  } catch (e) { return null; }
}
function ngHasSave(storage) { return !!ngLoadSave(storage); }
function ngPersistSave(storage, save) {
  try {
    if (storage) storage.setItem(NEWGAME_SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (e) { return false; }
}

/* Tạo save mới hoàn toàn từ lựa chọn tạo nhân vật.
   - opts: { name, gender ('Nam'|'Nữ'), color (id màu áo), hair (id kiểu tóc),
             sectId, heroId, prevSettings? }
   - Reset sạch: heroes = 6 đệ tử gốc mặc định, đệ tử khởi đầu làm leader,
     quests/inventory/guild mặc định, stats về 0, flags reset +
     flags.createdVia = 'newgame'. settings giữ nguyên cài đặt hiện tại
     (prevSettings) nếu có, không thì mặc định.
   - Trả về { ok, save, reason } — không ok thì save = null, không ghi gì. */
function ngCreateSave(opts) {
  opts = opts || {};
  var v = ngValidateName(opts.name);
  if (!v.ok) return { ok: false, save: null, reason: v.reason };
  var sect = ngSectById(opts.sectId);
  if (!sect) return { ok: false, save: null, reason: 'Hãy chọn một môn phái.' };
  var hero = ngHeroById(opts.heroId);
  if (!hero || !hero.starter) return { ok: false, save: null, reason: 'Hãy chọn một đệ tử khởi đầu.' };
  var gender = opts.gender === 'Nữ' ? 'Nữ' : 'Nam';
  var color = ngColorById(opts.color);
  var hair = ngHairById(opts.hair);
  var st = ngPreviewStats(sect.id);

  var save = ngDefaultSave();
  var p = save.player;
  p.name = v.name;
  p.faction = sect.name;
  p.level = st.level; p.exp = 0; p.maxExp = NEWGAME_BASE_PLAYER.maxExp;
  p.maxHp = st.hp; p.hp = st.hp;
  p.maxMp = st.mp; p.mp = st.mp;
  p.atk = st.atk; p.def = st.def; p.speed = st.speed;
  p.gold = st.gold; p.silver = st.silver;
  p.weapon = sect.weapon; p.armorName = sect.armorName;
  p.look = { gender: gender, color: color.id, hair: hair.id };
  p.sectDesc = sect.desc;
  save.leader = ngStarterHeroes().findIndex(function (h) { return h.id === hero.id; });
  save.settings = ngNormalizeSettings(opts.prevSettings);
  save.flags = { tutorial: false, shop: {}, createdVia: 'newgame' };
  return { ok: true, save: save, reason: '' };
}

/* Chuẩn hóa object settings: chỉ nhận đúng 4 field, sai kiểu thì về mặc định.
   speed chỉ nhận 1/2/3/5, còn lại về 1. */
function ngNormalizeSettings(s) {
  var d = NEWGAME_DEFAULT_SETTINGS;
  if (!s || typeof s !== 'object') return { muted: d.muted, autoBattle: d.autoBattle, autoSkill: d.autoSkill, speed: d.speed };
  return {
    muted: !!s.muted,
    autoBattle: s.autoBattle !== false,
    autoSkill: s.autoSkill !== false,
    speed: NEWGAME_SPEEDS.indexOf(Number(s.speed)) >= 0 ? Number(s.speed) : 1
  };
}
/* Đổi một cài đặt trên save (giữ nguyên mọi field khác), trả về settings mới. */
function ngApplySettings(save, patch) {
  if (!save) return null;
  save.settings = ngNormalizeSettings(Object.assign({}, save.settings || {}, patch || {}));
  return save.settings;
}
/* Lấy settings hiện tại; chưa có save thì trả về mặc định (không tạo save). */
function ngCurrentSettings(storage) {
  var s = ngLoadSave(storage);
  if (s && s.settings) return ngNormalizeSettings(s.settings);
  return { muted: false, autoBattle: true, autoSkill: true, speed: 1 };
}
/* Lưu cài đặt: có save thì chỉ đổi settings; chưa có save thì tạo save mặc
   định đầy đủ (để game load được) rồi ghi settings vào. */
function ngSaveSettings(storage, patch) {
  var save = ngLoadSave(storage) || ngDefaultSave();
  ngApplySettings(save, patch);
  ngPersistSave(storage, save);
  return save.settings;
}

/* Tiếp tục: có save thì được vào game, chưa có thì báo rõ, không chuyển trang. */
function ngContinueTarget(storage) {
  if (ngHasSave(storage)) return { ok: true, href: 'mongvolam.html', reason: '' };
  return { ok: false, href: '', reason: 'Chưa có dữ liệu — hãy chọn Chơi Mới để bắt đầu hành trình.' };
}

/* Bộ sưu tập: toàn bộ 20 đệ tử, đánh dấu ĐÃ MỞ (có trong save) / CHƯA MỞ. */
function ngGallery(save) {
  var owned = {};
  if (save && Array.isArray(save.heroes)) {
    save.heroes.forEach(function (h) { owned[h.id] = h; });
  }
  return NEWGAME_HEROES.map(function (d) {
    var h = owned[d.id];
    return {
      id: d.id, name: d.name, title: d.title, sect: d.sect, type: d.type,
      level: d.level, starter: d.starter,
      owned: !!h, ownedLevel: h ? h.level : null
    };
  });
}

/* Tóm tắt save để hiện ở menu chính (tên, cấp, môn phái, tiền). */
function ngSaveSummary(save) {
  if (!save || !save.player) return null;
  var p = save.player;
  return {
    name: p.name, level: p.level, faction: p.faction || 'Vô môn phái',
    gold: p.gold || 0, silver: p.silver || 0,
    heroes: Array.isArray(save.heroes) ? save.heroes.length : 0
  };
}

/* ============================== GIAO DIỆN TRÌNH DUYỆT ============================== */
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  var NgUI = {
    save: null,
    draft: { name: '', gender: 'Nam', color: 'do', hair: 'bui-cao', sectId: 'thieulam', heroId: 'det' },
    screen: 'loading'
  };

  function ngToast(msg, bad) {
    var box = document.getElementById('ng-toast');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'ng-toast-item' + (bad ? ' bad' : '');
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3000);
  }

  function ngShow(id) {
    NgUI.screen = id;
    var screens = document.querySelectorAll('.ng-screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.toggle('on', screens[i].id === id);
    window.scrollTo(0, 0);
  }

  function ngChibiHTML() {
    var d = NgUI.draft;
    var color = ngColorById(d.color);
    var face = d.gender === 'Nữ' ? '👩' : '🧑';
    return '<div class="ng-chibi">' +
      '<div class="ng-chibi-hair hair-' + ngEsc(d.hair) + '"></div>' +
      '<div class="ng-chibi-face">' + face + '</div>' +
      '<div class="ng-chibi-robe" style="background:' + color.value + '">' +
      '<span class="ng-chibi-weapon">⚔️</span></div>' +
      '<div class="ng-chibi-label">' + ngEsc(color.name) + ' · ' + ngEsc(ngHairById(d.hair).name) + '</div>' +
      '</div>';
  }

  function ngSectCardHTML(s) {
    var b = s.bonus;
    var parts = [];
    if (b.hp) parts.push('Sinh Lực +' + b.hp);
    if (b.mp) parts.push('Nội Lực +' + b.mp);
    if (b.atk) parts.push('Công +' + b.atk);
    if (b.def) parts.push('Thủ +' + b.def);
    if (b.speed) parts.push('Tốc độ +' + b.speed);
    return '<button class="ng-sect' + (NgUI.draft.sectId === s.id ? ' on' : '') + '" data-act="sect" data-id="' + s.id + '">' +
      '<span class="ng-sect-ic">' + s.icon + '</span>' +
      '<b>' + ngEsc(s.name) + '</b>' +
      '<span class="ng-sect-bonus">' + parts.join(' · ') + '</span>' +
      '<span class="ng-sect-desc">' + ngEsc(s.desc) + '</span></button>';
  }

  function ngHeroCardHTML(h) {
    return '<button class="ng-hero' + (NgUI.draft.heroId === h.id ? ' on' : '') + '" data-act="hero" data-id="' + h.id + '">' +
      '<span class="ng-hero-grade">' + ngEsc(h.type) + '</span>' +
      '<b>' + ngEsc(h.name) + '</b>' +
      '<span>' + ngEsc(h.title) + '</span>' +
      '<span class="muted">' + ngEsc(h.sect) + ' · Cấp ' + h.level + '</span></button>';
  }

  function ngRenderCreate() {
    var d = NgUI.draft;
    var nameInput = document.getElementById('ng-name');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = d.name;
    var chibi = document.getElementById('ng-chibi');
    if (chibi) chibi.innerHTML = ngChibiHTML();
    var colors = document.getElementById('ng-colors');
    if (colors) {
      colors.innerHTML = NEWGAME_ROBE_COLORS.map(function (c) {
        return '<button class="ng-swatch' + (d.color === c.id ? ' on' : '') + '" data-act="color" data-id="' + c.id + '"' +
          ' style="background:' + c.value + '" title="' + ngEsc(c.name) + '" aria-label="' + ngEsc(c.name) + '"></button>';
      }).join('');
    }
    var hairs = document.getElementById('ng-hairs');
    if (hairs) {
      hairs.innerHTML = NEWGAME_HAIRSTYLES.map(function (h) {
        return '<button class="ng-chip' + (d.hair === h.id ? ' on' : '') + '" data-act="hair" data-id="' + h.id + '">' + h.icon + ' ' + ngEsc(h.name) + '</button>';
      }).join('');
    }
    var genders = document.getElementById('ng-genders');
    if (genders) {
      genders.innerHTML =
        '<button class="ng-chip' + (d.gender === 'Nam' ? ' on' : '') + '" data-act="gender" data-id="Nam">🧑 Nam</button>' +
        '<button class="ng-chip' + (d.gender === 'Nữ' ? ' on' : '') + '" data-act="gender" data-id="Nữ">👩 Nữ</button>';
    }
    var sects = document.getElementById('ng-sects');
    if (sects) sects.innerHTML = NEWGAME_SECTS.map(ngSectCardHTML).join('');
    var heroes = document.getElementById('ng-heroes');
    if (heroes) heroes.innerHTML = ngStarterHeroes().map(ngHeroCardHTML).join('');
    var prev = document.getElementById('ng-preview');
    if (prev) {
      var st = ngPreviewStats(d.sectId);
      var hero = ngHeroById(d.heroId);
      prev.innerHTML = '<b>👤 ' + ngEsc(d.name || '(chưa đặt tên)') + ' · ' + ngEsc(st.sect ? st.sect.name : '') + ' · Cấp ' + st.level + '</b>' +
        '<div class="ng-stats">' +
        '<span>❤️ Sinh Lực <b>' + ngFmt(st.hp) + '</b></span>' +
        '<span>🔵 Nội Lực <b>' + ngFmt(st.mp) + '</b></span>' +
        '<span>⚔️ Công <b>' + ngFmt(st.atk) + '</b></span>' +
        '<span>🛡️ Thủ <b>' + ngFmt(st.def) + '</b></span>' +
        '<span>💨 Tốc độ <b>' + st.speed + '</b></span>' +
        '<span>🪙 KNB <b>' + ngFmt(st.gold) + '</b> · bạc <b>' + ngFmt(st.silver) + '</b></span></div>' +
        (hero ? '<div class="ng-prev-hero">🤝 Đệ tử khởi đầu: <b>' + ngEsc(hero.name) + '</b> — ' + ngEsc(hero.title) + ' (làm đội trưởng)</div>' : '');
    }
  }

  function ngRenderMenu() {
    var info = document.getElementById('menu-saveinfo');
    if (!info) return;
    var s = ngSaveSummary(NgUI.save);
    var cont = document.getElementById('menu-continue');
    if (s) {
      info.innerHTML = '💾 Đã có dữ liệu: <b>' + ngEsc(s.name) + '</b> · Cấp ' + s.level + ' · ' + ngEsc(s.faction) +
        ' · 🪙 ' + ngFmt(s.gold) + ' KNB · ⚪ ' + ngFmt(s.silver) + ' bạc · ' + s.heroes + ' đệ tử';
      if (cont) cont.classList.remove('dim');
    } else {
      info.textContent = 'Chưa có dữ liệu — hãy chọn Chơi Mới để bắt đầu hành trình.';
      if (cont) cont.classList.add('dim');
    }
  }

  function ngRenderSettings() {
    var s = ngCurrentSettings(typeof localStorage !== 'undefined' ? localStorage : null);
    function setBtn(id, on, onText, offText) {
      var el = document.getElementById(id);
      if (el) { el.textContent = on ? onText : offText; el.classList.toggle('off', !on); }
    }
    setBtn('set-mute', !s.muted, 'Đang bật', 'Đang tắt');
    setBtn('set-auto', s.autoBattle, 'BẬT', 'TẮT');
    setBtn('set-autoskill', s.autoSkill, 'BẬT', 'TẮT');
    var speeds = document.getElementById('set-speeds');
    if (speeds) {
      speeds.innerHTML = NEWGAME_SPEEDS.map(function (v) {
        return '<button class="ng-chip' + (s.speed === v ? ' on' : '') + '" data-act="speed" data-v="' + v + '">' + v + 'x</button>';
      }).join('');
    }
  }

  function ngRenderGallery() {
    var grid = document.getElementById('gallery-grid');
    if (!grid) return;
    var list = ngGallery(NgUI.save);
    var owned = list.filter(function (h) { return h.owned; }).length;
    var count = document.getElementById('gallery-count');
    if (count) count.textContent = 'Đã mở ' + owned + '/' + list.length + ' đệ tử';
    grid.innerHTML = list.map(function (h) {
      return '<div class="ng-gal' + (h.owned ? ' owned' : '') + '">' +
        '<span class="ng-hero-grade">' + ngEsc(h.type) + '</span>' +
        '<b>' + ngEsc(h.name) + '</b>' +
        '<span>' + ngEsc(h.title) + '</span>' +
        '<span class="muted">' + ngEsc(h.sect) + ' · Cấp gốc ' + h.level + '</span>' +
        (h.owned
          ? '<span class="ng-owned">✅ ĐÃ MỞ · cấp ' + h.ownedLevel + '</span>'
          : '<span class="ng-locked">🔒 CHƯA MỞ — chiêu mộ ở Đài Tham Bái trong game</span>') +
        '</div>';
    }).join('');
  }

  function ngStartLoading() {
    var bar = document.getElementById('load-bar');
    var pct = document.getElementById('load-pct');
    var tip = document.getElementById('load-tip');
    var tips = [
      'Đang rèn thần binh…', 'Đang dựng thành Biện Kinh…',
      'Đang mời đệ tử nhập đội…', 'Đang trải hoa đào khắp giang hồ…'
    ];
    var total = 1500 + Math.random() * 1000; /* 1.5–2.5 giây, mô phỏng tải tài nguyên */
    var t0 = Date.now();
    var timer = setInterval(function () {
      var p = Math.min(100, Math.round((Date.now() - t0) / total * 100));
      if (bar) bar.style.width = p + '%';
      if (pct) pct.textContent = p + '%';
      if (tip) tip.textContent = tips[Math.min(tips.length - 1, Math.floor(p / 100 * tips.length))];
      if (p >= 100) {
        clearInterval(timer);
        ngRenderMenu();
        ngShow('main-menu');
      }
    }, 60);
  }

  function ngInit() {
    NgUI.save = ngLoadSave(typeof localStorage !== 'undefined' ? localStorage : null);
    ngRenderCreate();
    ngRenderSettings();
    ngRenderGallery();
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el || el.disabled) return;
      var act = el.dataset.act;
      var storage = typeof localStorage !== 'undefined' ? localStorage : null;
      if (act === 'go-create') { ngRenderCreate(); ngShow('create'); }
      else if (act === 'go-menu') { NgUI.save = ngLoadSave(storage); ngRenderMenu(); ngShow('main-menu'); }
      else if (act === 'go-settings') { ngRenderSettings(); ngShow('settings'); }
      else if (act === 'go-guide') { ngShow('guide'); }
      else if (act === 'go-gallery') { NgUI.save = ngLoadSave(storage); ngRenderGallery(); ngShow('gallery'); }
      else if (act === 'go-bye') { ngShow('bye'); }
      else if (act === 'continue') {
        var t = ngContinueTarget(storage);
        if (!t.ok) { ngToast(t.reason, true); return; }
        location.href = t.href;
      }
      else if (act === 'suggest-name') {
        NgUI.draft.name = ngSuggestName();
        var inp = document.getElementById('ng-name');
        if (inp) inp.value = NgUI.draft.name;
        ngRenderCreate();
      }
      else if (act === 'gender') { NgUI.draft.gender = el.dataset.id; ngRenderCreate(); }
      else if (act === 'color') { NgUI.draft.color = el.dataset.id; ngRenderCreate(); }
      else if (act === 'hair') { NgUI.draft.hair = el.dataset.id; ngRenderCreate(); }
      else if (act === 'sect') { NgUI.draft.sectId = el.dataset.id; ngRenderCreate(); }
      else if (act === 'hero') { NgUI.draft.heroId = el.dataset.id; ngRenderCreate(); }
      else if (act === 'speed') {
        ngSaveSettings(storage, { speed: Number(el.dataset.v) });
        ngRenderSettings();
      }
      else if (act === 'toggle-mute') {
        var s1 = ngCurrentSettings(storage);
        ngSaveSettings(storage, { muted: !s1.muted });
        ngRenderSettings();
      }
      else if (act === 'toggle-auto') {
        var s2 = ngCurrentSettings(storage);
        ngSaveSettings(storage, { autoBattle: !s2.autoBattle });
        ngRenderSettings();
      }
      else if (act === 'toggle-autoskill') {
        var s3 = ngCurrentSettings(storage);
        ngSaveSettings(storage, { autoSkill: !s3.autoSkill });
        ngRenderSettings();
      }
      else if (act === 'start-game') {
        var inp2 = document.getElementById('ng-name');
        if (inp2) NgUI.draft.name = inp2.value;
        var prev = NgUI.save && NgUI.save.settings ? NgUI.save.settings : null;
        var r = ngCreateSave({
          name: NgUI.draft.name, gender: NgUI.draft.gender,
          color: NgUI.draft.color, hair: NgUI.draft.hair,
          sectId: NgUI.draft.sectId, heroId: NgUI.draft.heroId,
          prevSettings: prev
        });
        if (!r.ok) {
          var err = document.getElementById('ng-name-err');
          if (err) err.textContent = r.reason;
          ngToast(r.reason, true);
          return;
        }
        if (NgUI.save) ngToast('⚠️ Dữ liệu cũ đã được thay bằng hành trình mới.', false);
        ngPersistSave(storage, r.save);
        location.href = 'mongvolam.html';
      }
    });
    var nameInput = document.getElementById('ng-name');
    if (nameInput) nameInput.addEventListener('input', function () {
      NgUI.draft.name = nameInput.value;
      var err = document.getElementById('ng-name-err');
      if (err) err.textContent = '';
      ngRenderCreate();
    });
    ngStartLoading();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ngInit);
  else ngInit();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NEWGAME_SAVE_KEY: NEWGAME_SAVE_KEY,
    NEWGAME_BASE_PLAYER: NEWGAME_BASE_PLAYER,
    NEWGAME_SECTS: NEWGAME_SECTS,
    NEWGAME_NAME_SUGGESTIONS: NEWGAME_NAME_SUGGESTIONS,
    NEWGAME_ROBE_COLORS: NEWGAME_ROBE_COLORS,
    NEWGAME_HAIRSTYLES: NEWGAME_HAIRSTYLES,
    NEWGAME_HEROES: NEWGAME_HEROES,
    NEWGAME_SPEEDS: NEWGAME_SPEEDS,
    NEWGAME_DEFAULT_SETTINGS: NEWGAME_DEFAULT_SETTINGS,
    ngEsc: ngEsc, ngFmt: ngFmt,
    ngSectById: ngSectById, ngHeroById: ngHeroById,
    ngColorById: ngColorById, ngHairById: ngHairById,
    ngStarterHeroes: ngStarterHeroes,
    ngValidateName: ngValidateName, ngSuggestName: ngSuggestName,
    ngPreviewStats: ngPreviewStats, ngDefaultSave: ngDefaultSave,
    ngLoadSave: ngLoadSave, ngHasSave: ngHasSave, ngPersistSave: ngPersistSave,
    ngCreateSave: ngCreateSave, ngNormalizeSettings: ngNormalizeSettings,
    ngApplySettings: ngApplySettings, ngCurrentSettings: ngCurrentSettings,
    ngSaveSettings: ngSaveSettings, ngContinueTarget: ngContinueTarget,
    ngGallery: ngGallery, ngSaveSummary: ngSaveSummary
  };
}
/* NEWGAME-END */
