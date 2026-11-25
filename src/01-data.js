/* ============================================================================
   MỘNG VÕ LÂM 3D — SOHA
   Hợp nhất: map scene (thế giới) · battle map (chiến trường) · table infoscene
   Toàn bộ chạy trong một tệp HTML, không phụ thuộc ảnh/âm thanh ngoài.
   ========================================================================== */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const fmt = n => {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};
const fmtFull = n => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============================== ÂM THANH ============================== */
const Sfx = {
  ctx: null,
  muted: false,
  master: null,
  ensure() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch (e) { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type, vol, slide) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'triangle';
      const t = ctx.currentTime;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.06, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  },
  click() { this.tone(720, 0.055, 'triangle', 0.045); },
  coin() { this.tone(960, 0.07, 'square', 0.035); setTimeout(() => this.tone(1440, 0.1, 'triangle', 0.03), 55); },
  skill() {
    this.tone(220, 0.32, 'sawtooth', 0.05, 880);
    setTimeout(() => this.tone(660, 0.22, 'triangle', 0.04, 1320), 60);
  },
  hit() { this.tone(140, 0.12, 'square', 0.03, 90); },
  crit() { this.tone(1180, 0.12, 'square', 0.04, 620); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'triangle', 0.05), i * 110)); },
  lose() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.34, 'sine', 0.05), i * 140)); },
  level() { [659, 784, 988, 1318].forEach((f, i) => setTimeout(() => this.tone(f, 0.26, 'triangle', 0.045), i * 90)); },
  heal() { this.tone(520, 0.2, 'sine', 0.03, 780); }
};

/* ============================== DỮ LIỆU ============================== */
const HERO_DEFS = [
  {
    id: 'det', name: 'Đế Thích Thiên', title: 'Nhất Phương Xưng Hùng', sect: 'Thiên Môn', type: 'Giáp',
    level: 400, ribbon: '#a855f7', robe: '#991b1b', hair: '#f8fafc', mask: '#4c1d95',
    weapon: 'Thiên Kiếp Đao', hat: 'Thiên Vũ Mão', armor: 'Thiên Kim Hoàng Bào', ring: 'Thiên Vũ Giới Chỉ',
    hp: 3838909184, atk: 87615920, def: 65035392, qi: 70015928, crit: 64655,
    bio: 'Môn chủ Thiên Môn, võ công thâm bất khả trắc, được thiên hạ đồn đại là kẻ từng giết được thần thú.',
    innate: 'Thánh Tâm Tứ Kiếp',
    fates: [
      ['Vang Danh Thiên Hạ', 'ra trận cùng Kiếm Thánh được +32% Khí', true],
      ['Long Nguyên', 'ra trận cùng Nhiếp Phong, Bộ Kinh Vân được +28% Khí', true],
      ['Môn Chủ Thiên Môn', 'trang bị Thiên Kiếp - Thiên Tội được +30% Mệnh', true],
      ['Ẩn Thế Cao Nhân', 'trang bị Thiên Kim Hoàng Bào được +27% Mệnh', true],
      ['Ngông Cuồng', 'trang bị Thiên Vũ Giới Chỉ được +25% Mệnh', true],
      ['Trường Sinh Bất Tử', 'trang bị Thiên Vũ Mão được +25% Mệnh', true]
    ]
  },
  {
    id: 'tieu', name: 'Tùy Tiêu Sầu', title: 'Tiêu Dao Kiếm Tiên', sect: 'Tiêu Dao Phái', type: 'Giáp',
    level: 385, ribbon: '#38bdf8', robe: '#1e293b', hair: '#e2e8f0', mask: null,
    weapon: 'Tiêu Dao Thần Kiếm', hat: 'Tiêu Dao Ngọc Quan', armor: 'Thanh Vân Đạo Bào', ring: 'Túy Tiên Ngọc Bội',
    hp: 2950000000, atk: 74200500, def: 51200400, qi: 68900120, crit: 58900,
    bio: 'Kiếm khách tóc trắng tiêu sái giang hồ, lấy rượu làm bạn, một kiếm chém đứt trường giang.',
    innate: 'Đao Chữ Thần Thông',
    fates: [
      ['Song Kiếm Hợp Bích', 'cùng Đế Thích Thiên xuất trận tăng +35% Công', true],
      ['Túy Ngọa Sa Trường', 'trang bị Hồ Lô Tiên Tửu tăng +25% Bạo Kích', true],
      ['Tiêu Dao Tự Tại', 'trang bị Tiêu Dao Thần Kiếm được +24% Khí', true]
    ]
  },
  {
    id: 'kiem', name: 'Độc Cô Kiếm Thánh', title: 'Kiếm Đạo Chí Tôn', sect: 'Vô Song Thành', type: 'Giáp',
    level: 390, ribbon: '#60a5fa', robe: '#1d4ed8', hair: '#1e1b4b', mask: null,
    weapon: 'Vô Song Thần Kiếm', hat: 'Vô Song Kiếm Quan', armor: 'Vô Song Chiến Bào', ring: 'Kiếm Tâm Ngọc Giới',
    hp: 3120000000, atk: 81500000, def: 49800000, qi: 72100000, crit: 69500,
    bio: 'Người sáng tạo ra Kiếm Nhị Thập Tam huyền thoại, kiếm khí tung hoành khắp võ lâm.',
    innate: 'Mạn Thiên Hoa Vũ',
    fates: [
      ['Vô Song Kiếm Vực', 'tăng 30% sát thương kỹ năng quần thể', true],
      ['Kiếm Tâm Thông Minh', 'trang bị Vô Song Thần Kiếm được +26% Công', true],
      ['Nhất Kiếm Phá Vạn Pháp', 'ra trận cùng Triệu Linh Nhi được +22% Khí', true]
    ]
  },
  {
    id: 'linh', name: 'Triệu Linh Nhi', title: 'Thánh Nữ Nam Chiếu', sect: 'Nga Mi Phái', type: 'Giáp',
    level: 375, ribbon: '#e879f9', robe: '#7e22ce', hair: '#0f172a', mask: null,
    weapon: 'Thiên Xà Trượng', hat: 'Nam Chiếu Ngân Quan', armor: 'Thánh Nữ Vân Y', ring: 'Linh Xà Ngọc Hoàn',
    hp: 2680000000, atk: 68400000, def: 58400000, qi: 79500000, crit: 52100,
    bio: 'Hậu duệ Nữ Oa, tinh thông ngũ hành pháp thuật và hồi phục khí huyết cho đồng đội.',
    innate: 'Ngũ Lôi Chú',
    fates: [
      ['Thiên Địa Linh Khí', 'hồi phục 15% sinh lực toàn đội mỗi hiệp', true],
      ['Nam Chiếu Thánh Nữ', 'trang bị Thiên Xà Trượng được +28% Khí', true]
    ]
  },
  {
    id: 'niep', name: 'Nhiếp Phong', title: 'Phong Trung Chi Thần', sect: 'Thiên Hạ Hội', type: 'Giáp',
    level: 396, ribbon: '#f59e0b', robe: '#312e81', hair: '#1e1b4b', mask: null,
    weapon: 'Tuyết Ẩm Cuồng Đao', hat: 'Phong Thần Cân', armor: 'Hắc Kim Chiến Giáp', ring: 'Cuồng Phong Giới',
    hp: 2850000000, atk: 79800000, def: 53200000, qi: 71600000, crit: 61200,
    bio: 'Phong Trung Chi Thần, sở hữu Tuyết Ẩm Cuồng Đao và khinh công Phong Thần Thối nhanh như chớp.',
    innate: 'Phong Thần Thối',
    fates: [
      ['Long Nguyên', 'ra trận cùng Đế Thích Thiên, Bộ Kinh Vân được +28% Khí', true],
      ['Phong Khởi Vân Dũng', 'trang bị Tuyết Ẩm Cuồng Đao được +27% Công', true]
    ]
  },
  {
    id: 'bo', name: 'Bộ Kinh Vân', title: 'Bất Khốc Tử Thần', sect: 'Thiên Hạ Hội', type: 'Giáp',
    level: 396, ribbon: '#ec4899', robe: '#4c1d95', hair: '#1e293b', mask: null,
    weapon: 'Tuyệt Thế Hảo Kiếm', hat: 'Bất Khốc Diện Cụ', armor: 'Huyền Âm Bào', ring: 'Kinh Vân Ngọc Bội',
    hp: 2760000000, atk: 76800000, def: 54600000, qi: 68400000, crit: 63500,
    bio: 'Bất Khốc Tử Thần, tay cầm Tuyệt Thế Hảo Kiếm, tính tình lạnh lùng nhưng trọng tình trọng nghĩa.',
    innate: 'Bài Vân Chưởng',
    fates: [
      ['Long Nguyên', 'ra trận cùng Đế Thích Thiên, Nhiếp Phong được +28% Khí', true],
      ['Bất Khốc', 'trang bị Bất Khốc Diện Cụ được +25% Thủ', true]
    ]
  }
];

/* Đệ tử chiêu mộ tại Đài Tham Bái (cùng shape field như HERO_DEFS). */
const RECRUIT_DEFS = [
  {
    id: 'lenhho', name: 'Lệnh Hồ Xung', title: 'Thiếu Niên Kiếm Khách', sect: 'Hoa Sơn', type: 'Bính',
    level: 120, ribbon: '#34d399', robe: '#065f46', hair: '#1e293b', mask: null,
    weapon: 'Hoa Sơn Trường Kiếm', hat: 'Hoa Sơn Thanh Quan', armor: 'Hoa Sơn Thanh Bào', ring: 'Tiếu Ngạo Ngọc Bội',
    hp: 950000000, atk: 22000000, def: 18000000, qi: 20000000, crit: 18000,
    bio: 'Đại đệ tử Hoa Sơn phái, kiếm pháp phóng khoáng, tính tình hào sảng, rượu ngon bạn hiền khắp giang hồ.',
    innate: 'Hoa Sơn Kiếm Pháp',
    fates: [
      ['Tiếu Ngạo Giang Hồ', 'ra trận cùng Nhậm Doanh Doanh được +25% Khí', true],
      ['Hoa Sơn Kiếm Tông', 'trang bị Hoa Sơn Trường Kiếm được +24% Công', true]
    ]
  },
  {
    id: 'nghlam', name: 'Nghi Lâm', title: 'Tiểu Sư Muội', sect: 'Hằng Sơn', type: 'Bính',
    level: 120, ribbon: '#6ee7b7', robe: '#0f766e', hair: '#0f172a', mask: null,
    weapon: 'Hằng Sơn Phất Trần', hat: 'Hằng Sơn Ni Cô', armor: 'Hằng Sơn Tăng Bào', ring: 'Thanh Tâm Mộc Ngư',
    hp: 900000000, atk: 20000000, def: 22000000, qi: 26000000, crit: 15000,
    bio: 'Tiểu sư muội Hằng Sơn phái, tâm tính thuần khiết, tinh thông Hằng Sơn tâm pháp, trị thương cứu người.',
    innate: 'Hằng Sơn Tâm Pháp',
    fates: [
      ['Sư Muội Đồng Môn', 'ra trận cùng Lệnh Hồ Xung được +22% Thủ', true],
      ['Hằng Sơn Từ Bi', 'trang bị Thanh Tâm Mộc Ngư được +20% Mệnh', true]
    ]
  },
  {
    id: 'doanh', name: 'Nhậm Doanh Doanh', title: 'Thánh Cô', sect: 'Nhật Nguyệt Thần Giáo', type: 'Ất',
    level: 200, ribbon: '#38bdf8', robe: '#1e3a8a', hair: '#0f172a', mask: null,
    weapon: 'Nhật Nguyệt Thần Cầm', hat: 'Thánh Cô Phượng Quan', armor: 'Thánh Cô Hồng Y', ring: 'Tiếu Ngạo Ngọc Tiêu',
    hp: 1600000000, atk: 40000000, def: 30000000, qi: 45000000, crit: 32000,
    bio: 'Thánh cô Nhật Nguyệt thần giáo, cầm nghệ tuyệt thế, thông minh tuyệt đỉnh, một khúc Tiếu Ngạo Giang Hồ vang danh thiên hạ.',
    innate: 'Tiếu Ngạo Giang Hồ Khúc',
    fates: [
      ['Tiếu Ngạo Giang Hồ', 'ra trận cùng Lệnh Hồ Xung được +28% Khí', true],
      ['Thánh Cô Nhật Nguyệt', 'trang bị Nhật Nguyệt Thần Cầm được +26% Công', true]
    ]
  },
  {
    id: 'duong', name: 'Dương Quá', title: 'Thần Điêu Đại Hiệp', sect: 'Cổ Mộ', type: 'Ất',
    level: 200, ribbon: '#60a5fa', robe: '#312e81', hair: '#1e1b4b', mask: null,
    weapon: 'Huyền Thiết Trọng Kiếm', hat: 'Thần Điêu Vũ Quan', armor: 'Cổ Mộ Huyền Bào', ring: 'Huyền Thiết Giới Chỉ',
    hp: 1750000000, atk: 45000000, def: 32000000, qi: 38000000, crit: 35000,
    bio: 'Thần Điêu Đại Hiệp, tay cầm Huyền Thiết Trọng Kiếm, Ám Nhiên Tiêu Hồn Chưởng vang danh, một đời chỉ yêu một người.',
    innate: 'Ám Nhiên Tiêu Hồn Chưởng',
    fates: [
      ['Thần Điêu Hiệp Lữ', 'ra trận cùng Tiểu Long Nữ được +30% Công', true],
      ['Ám Nhiên Tiêu Hồn', 'trang bị Huyền Thiết Trọng Kiếm được +25% Khí', true]
    ]
  },
  {
    id: 'dongph', name: 'Đông Phương Bất Bại', title: 'Giáo Chủ', sect: 'Nhật Nguyệt Thần Giáo', type: 'Giáp',
    level: 300, ribbon: '#a855f7', robe: '#7e22ce', hair: '#f8fafc', mask: '#4c1d95',
    weapon: 'Quỳ Hoa Tú Hoa Châm', hat: 'Giáo Chủ Kim Quan', armor: 'Quỳ Hoa Bảo Y', ring: 'Nhật Nguyệt Giáo Chủ Lệnh',
    hp: 2400000000, atk: 62000000, def: 45000000, qi: 60000000, crit: 52000,
    bio: 'Giáo chủ Nhật Nguyệt thần giáo, Quỳ Hoa Bảo Điển luyện đến cảnh giới xuất thần nhập hóa, thiên hạ đệ nhất tốc độ.',
    innate: 'Quỳ Hoa Bảo Điển',
    fates: [
      ['Quỳ Hoa Bảo Điển', 'trang bị Quỳ Hoa Tú Hoa Châm được +30% Công', true],
      ['Nhật Nguyệt Độc Tôn', 'ra trận cùng Nhậm Doanh Doanh được +26% Khí', true]
    ]
  },
  {
    id: 'docco', name: 'Độc Cô Cầu Bại', title: 'Kiếm Ma', sect: 'Vô Danh', type: 'Giáp',
    level: 300, ribbon: '#e879f9', robe: '#1d4ed8', hair: '#e2e8f0', mask: null,
    weapon: 'Độc Cô Huyền Kiếm', hat: 'Kiếm Ma Diện Cụ', armor: 'Kiếm Ma Hắc Bào', ring: 'Độc Cô Kiếm Giới',
    hp: 2600000000, atk: 68000000, def: 48000000, qi: 55000000, crit: 58000,
    bio: 'Kiếm Ma một đời cầu bại mà không được, Độc Cô Cửu Kiếm phá hết thiên hạ kiếm pháp, vô kiếm thắng hữu kiếm.',
    innate: 'Độc Cô Cửu Kiếm',
    fates: [
      ['Kiếm Ma Độc Tôn', 'trang bị Độc Cô Huyền Kiếm được +32% Công', true],
      ['Vô Kiếm Thắng Hữu Kiếm', 'ra trận cùng Độc Cô Kiếm Thánh được +28% Khí', true]
    ]
  },
  {
    id: 'longnu', name: 'Tiểu Long Nữ', title: 'Ngọc Nữ', sect: 'Cổ Mộ', type: 'Giáp',
    level: 300, ribbon: '#f472b6', robe: '#7e22ce', hair: '#0f172a', mask: null,
    weapon: 'Ngọc Nữ Tố Tâm Kiếm', hat: 'Ngọc Nữ Bạch Quan', armor: 'Cổ Mộ Bạch Y', ring: 'Ngọc Nữ Tâm Bội',
    hp: 2300000000, atk: 60000000, def: 50000000, qi: 65000000, crit: 48000,
    bio: 'Ngọc Nữ Cổ Mộ phái, dung nhan tuyệt thế, Ngọc Nữ Tâm Kinh luyện đến thuần thục, lạnh lùng mà trọng tình.',
    innate: 'Ngọc Nữ Tâm Kinh',
    fates: [
      ['Ngọc Nữ Tâm Kinh', 'trang bị Ngọc Nữ Tố Tâm Kiếm được +28% Khí', true],
      ['Thần Điêu Hiệp Lữ', 'ra trận cùng Dương Quá được +30% Thủ', true]
    ]
  }
];

const RECRUIT_POOLS = {
  1: { name: 'Tầm Sư Học Đạo', freePerDay: 1, costSilver: 5000, rates: [{ grade: 'Bính', w: 70 }, { grade: 'Ất', w: 30 }] },
  2: { name: 'Danh Môn Cao Đồ', costGold: 100, rates: [{ grade: 'Giáp', w: 25 }, { grade: 'Ất', w: 50 }, { grade: 'Bính', w: 25 }] },
  3: { name: 'Nhất Đại Tông Sư', costGold: 250, rates: [{ grade: 'Giáp', w: 65 }, { grade: 'Ất', w: 35 }] }
};

const SKILLS = [
  { id: 0, name: 'Hỏa Long Phần Thiên', icon: '🐉', cd: 8, mult: 3.4, aoe: true, color: 0xff5500, ring: 0xffaa00, desc: 'Hỏa long gầm thét, thiêu rụi toàn bộ kẻ địch trong phạm vi.' },
  { id: 1, name: 'Tử Lôi Kiếm Khí', icon: '⚡', cd: 6, mult: 2.8, aoe: true, color: 0xc026d3, ring: 0x3b82f6, desc: 'Kiếm khí tím lôi bùng nổ, sát thương diện rộng cực mạnh.' },
  { id: 2, name: 'Hắc Ám Ma Công', icon: '🥷', cd: 10, mult: 2.2, aoe: false, color: 0x6d28d9, ring: 0xa855f7, desc: 'Ma công đoạt mệnh, hút sinh lực và giáng đòn chí mạng vào một mục tiêu.' },
  { id: 3, name: 'Mạn Thiên Hoa Vũ', icon: '❄️', cd: 9, mult: 3.1, aoe: true, color: 0x38bdf8, ring: 0xf472b6, desc: 'Bão kiếm khí băng giá trút xuống chiến trường, đóng băng cả không gian.' }
];

const ARENAS = {
  bamboo: {
    key: 'bamboo', name: 'Rừng Trúc U Minh', short: 'Rừng Trúc', icon: '🌿', mul: 1,
    exp: 150, silver: 2800, gold: 1, tip: 'Sương trúc u minh, ma giáo phục kích trong rừng.',
    badge: 'Rừng Trúc U Minh', boss: 'Ma Giáo Cao Thủ (Lv.70)', recLvl: 'Cấp 65 - 70',
    drops: 'Trúc Diệp Linh Đan, Mảnh Trúc Kiếm', desc: 'Rừng trúc sương mù dày đặc, ma giáo thường phục kích trong bóng trúc.',
    builder: 'bamboo', isBoss: false
  },
  buddha: {
    key: 'buddha', name: 'Đài Phật Anh Đào', short: 'Đài Phật', icon: '🌸', mul: 2.15,
    exp: 340, silver: 7600, gold: 2, tip: 'Luận kiếm dưới tượng Phật, hoa anh đào bay khắp trời.',
    badge: 'Thánh Địa Đài Phật', boss: 'Hộ Pháp Hắc Bạch (Lv.72)', recLvl: 'Cấp 68 - 73',
    drops: 'Anh Đào Linh Hoa, Phật Quang Xá Lợi', desc: 'Đài Phật linh thiêng, hoa anh đào bay khắp trời, nơi luận kiếm của cao thủ.',
    builder: 'buddha', isBoss: false
  },
  city: {
    key: 'city', name: 'Biện Kinh Thành Cổ', short: 'Biện Kinh', icon: '🏯', mul: 3.5,
    exp: 720, silver: 17000, gold: 3, tip: 'Hồ sen Biện Kinh, trận chiến cuối cùng của ma giáo.',
    badge: 'Kinh Đô Võ Lâm', boss: 'Ma Giáo Giáo Chủ (Lv.75)', recLvl: 'Cấp 73 - 76',
    drops: 'Biện Kinh Lệnh Bài, Long Văn Bảo Giáp', desc: 'Kinh đô phồn hoa bên hồ sen, nơi diễn ra trận chiến cuối cùng với ma giáo.',
    builder: 'city', isBoss: false
  },
  'van-mong-dam': {
    key: 'van-mong-dam', name: 'Vân Mộng Đầm', short: 'Vân Mộng', icon: '💧', mul: 1.2,
    exp: 190, silver: 3600, gold: 1, tip: 'Đầm nước tĩnh lặng phản chiếu bóng núi mờ sương.',
    badge: 'Thủy Mặc U Cốc', boss: 'Thủy Nguyệt Tiên Tử (Lv.73)', recLvl: 'Cấp 70 - 75',
    drops: 'Băng Tâm Ngọc Bội, Linh Khí Thủy Nguyên', desc: 'Đầm nước tĩnh lặng, nơi các bậc ẩn sĩ thường ngồi thuyền câu cá ngộ đạo.',
    builder: 'city', isBoss: false
  },
  'kiem-linh-coc': {
    key: 'kiem-linh-coc', name: 'Kiếm Linh Cốc', short: 'Kiếm Linh', icon: '🗡️', mul: 1.6,
    exp: 260, silver: 5400, gold: 1, tip: 'Hàng vạn thanh cổ kiếm cắm trên vách đá rít lên từng hồi.',
    badge: 'Thánh Địa Kiếm Đạo', boss: 'Kiếm Linh Hộ Pháp (Lv.74)', recLvl: 'Cấp 72 - 76',
    drops: 'Huyền Thiết Tinh Khoáng, Kiếm Ý Đan', desc: 'Thung lũng quanh năm mây mù bao phủ, hàng vạn thanh cổ kiếm cắm trên vách đá.',
    builder: 'bamboo', isBoss: false
  },
  'xanh-tu-nam': {
    key: 'xanh-tu-nam', name: 'Xanh Tử Nam', short: 'Xanh Tử', icon: '🌲', mul: 2.0,
    exp: 320, silver: 7000, gold: 2, tip: 'Rừng tùng cổ tự, đạo nhân ngồi thiền dưới gốc tùng nghìn năm.',
    badge: 'Rừng Tùng Cổ Tự', boss: 'Thanh Tùng Đạo Nhân (Lv.75)', recLvl: 'Cấp 74 - 77',
    drops: 'Tùng Hạc Diên Niên Đan, Mảnh Áo Choàng', desc: 'Rừng tùng cổ tự ngàn năm, linh khí hội tụ.',
    builder: 'bamboo', isBoss: false
  },
  'mon-quan': {
    key: 'mon-quan', name: 'Môn Quan', short: 'Môn Quan', icon: '🏰', mul: 2.8,
    exp: 520, silver: 12000, gold: 2, tip: 'Cửa ải yết hầu, trấn quan đại tướng trấn giữ ngày đêm.',
    badge: 'Cửa Ải Yết Hầu', boss: 'Trấn Quan Đại Tướng (Lv.76)', recLvl: 'Cấp 75 - 78',
    drops: 'Lệnh Bài Quân Công, Giáp Trụ Huyền Vũ', desc: 'Cửa ải yết hầu của võ lâm, ai qua được ải này mới xứng danh cao thủ.',
    builder: 'city', isBoss: false
  },
  'thien-hoa-dan-dinh': {
    key: 'thien-hoa-dan-dinh', name: 'Thiên Hỏa Đỉnh', short: 'Thiên Hỏa', icon: '🔥', mul: 3.8,
    exp: 820, silver: 19500, gold: 3, tip: 'Lửa thiêng bùng cháy, Hỏa Kỳ Lân trấn giữ đỉnh cao nhất.',
    badge: 'Trọng Điểm Quyết Chiến', boss: 'Hỏa Kỳ Lân – Viêm Đế (Lv.78)', recLvl: 'Cấp 76+',
    drops: 'Thần Binh Hỏa Lân, Bí Kíp Cửu Dương, 5000 Vàng', desc: 'Đỉnh núi lửa thiêng, nơi quyết chiến cuối cùng với Hỏa Kỳ Lân.',
    builder: 'city', isBoss: true
  }
};

const ENEMY_DEFS = [
  { name: 'Ma Giáo Cao Thủ', boss: true, hp: 1.0, atk: 1.0, robe: 0x111827, hair: 0x94a3b8, scale: 1.22 },
  { name: 'Hộ Pháp Hắc Bạch', boss: false, hp: 0.58, atk: 0.72, robe: 0x312e81, hair: 0xf1f5f9, scale: 1.0 },
  { name: 'Tử Y Sát Thủ', boss: false, hp: 0.52, atk: 0.88, robe: 0x581c87, hair: 0x1e1b4b, scale: 0.98 },
  { name: 'Độc Long Sứ Giả', boss: false, hp: 0.6, atk: 0.78, robe: 0x065f46, hair: 0xd1d5db, scale: 1.02 }
];

const SHOP_ITEMS = [
  { id: 's1', name: 'Bánh Bao Thịt Nóng', icon: '🥟', type: 'Thực phẩm', desc: 'Hồi đầy Sinh Lực cho bản thể', price: 150, cur: 'silver', act: 'heal' },
  { id: 's2', name: 'Tụ Khí Đan Thượng Hạng', icon: '💊', type: 'Đan dược', desc: '+60 Kinh Nghiệm', price: 400, cur: 'silver', act: 'exp' },
  { id: 's3', name: 'Huyết Long Quyền Sáo', icon: '🔥', type: 'Thần binh', desc: '+35 Công Kích vĩnh viễn', price: 50, cur: 'gold', act: 'atk' },
  { id: 's4', name: 'Bạch Hổ Chiến Giáp', icon: '🛡️', type: 'Bảo giáp', desc: '+30 Phòng Thủ vĩnh viễn', price: 45, cur: 'gold', act: 'def' },
  { id: 's5', name: 'Bồi Dưỡng Đan', icon: '🧧', type: 'Bảo vật', desc: 'Tặng 1 lần Bồi Dưỡng đệ tử', price: 2500, cur: 'silver', act: 'cultivate' },
  { id: 's6', name: 'Ngọc Lộ Hoàn', icon: '💧', type: 'Linh dược', desc: '+120 Nội Lực tối đa', price: 900, cur: 'silver', act: 'mp' }
];

const GEAR_META = {
  weapon: { label: 'Vũ khí', tier: 'gold', icon: '⚔️' },
  hat: { label: 'Mũ', tier: 'gold', icon: '👑' },
  armor: { label: 'Chiến bào', tier: 'purple', icon: '👘' },
  ring: { label: 'Trang sức', tier: 'orange', icon: '💍' },
  talent: { label: 'Thiên phú', tier: 'purple', icon: '🌀' },
  mind: { label: 'Tâm pháp', tier: 'gold', icon: '📜' },
  ultimate: { label: 'Tuyệt học', tier: 'orange', icon: '🐲' }
};

/* ============================== TRẠNG THÁI ============================== */
const SAVE_KEY = 'mongvolam_soha_v1';

function defaultQuests() {
  return [
    { id: 'q1', title: 'Chào Hỏi Biện Kinh', desc: 'Đối thoại với Chưởng Quầy Tạp Hóa', target: 1, progress: 0, exp: 60, silver: 1500, done: false },
    { id: 'q2', title: 'Thí Luyện Võ Đạo', desc: 'Chiến thắng một trận tại chiến trường', target: 1, progress: 0, exp: 110, silver: 3000, done: false },
    { id: 'q3', title: 'Thưởng Ngoạn Cầu Đá', desc: 'Bước qua cầu đá bắc ngang hồ sen', target: 1, progress: 0, exp: 45, silver: 1000, done: false },
    { id: 'q4', title: 'Truyền Thừa Võ Học', desc: 'Bồi dưỡng một đệ tử trong hồ sơ', target: 1, progress: 0, exp: 90, silver: 2200, done: false },
    { id: 'q5', title: 'Bách Chiến Bất Bại', desc: 'Thắng 3 trận chiến trường', target: 3, progress: 0, exp: 320, silver: 9000, done: false }
  ];
}

const State = {
  player: {
    name: 'Song Ma Quyền Phái', faction: 'Song Ma Phái',
    level: 3, exp: 64, maxExp: 160,
    hp: 500, maxHp: 500, mp: 200, maxMp: 200,
    atk: 68, def: 42, speed: 7.5,
    gold: 455, silver: 40932,
    capacity: 13, maxCapacity: 30,
    weapon: 'Song Ma Thiết Quyền', armorName: 'Hắc Vân Võ Bào', accessory: 'Ngọc Bội Thanh Long'
  },
  heroes: HERO_DEFS.map(h => ({ id: h.id, level: h.level, bonus: { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 } })),
  leader: 0,
  quests: defaultQuests(),
  guild: { name: 'Thiên Địa Hội [MV]', level: 4, members: 28, contribution: 350 },
  inventory: [
    { id: 'i1', name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', qty: 5 },
    { id: 'i2', name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 3 },
    { id: 'i3', name: 'Huyền Thiết Tinh', icon: '💎', type: 'Nguyên liệu', desc: 'Rèn trang bị', qty: 3 }
  ],
  customProps: [],
  stats: { battles: 0, wins: 0, kills: 0 },
  settings: { muted: false, autoBattle: true, autoSkill: true, speed: 1 },
  flags: { tutorial: false }
};

const SaveManager = {
  save() {
    try {
      const data = {
        player: State.player, heroes: State.heroes, leader: State.leader, quests: State.quests,
        guild: State.guild, inventory: State.inventory, customProps: State.customProps,
        stats: State.stats, settings: State.settings, flags: State.flags, v: 2
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {}
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.player) Object.assign(State.player, d.player);
      if (Array.isArray(d.heroes)) {
        d.heroes.forEach(h => {
          const t = State.heroes.find(x => x.id === h.id);
          if (t) {
            t.level = Math.max(1, Math.round(h.level || t.level));
            if (h.bonus) Object.assign(t.bonus, h.bonus);
          }
        });
        // Đệ tử chiêu mộ (RECRUIT_DEFS) chưa có trong đội hình mặc định: append từ save.
        d.heroes.forEach(h => {
          if (State.heroes.find(x => x.id === h.id)) return;
          const def = heroById(h.id);
          if (!def) return;
          State.heroes.push({
            id: h.id,
            level: Math.max(1, Math.round(h.level || def.level)),
            bonus: Object.assign({ hp: 0, atk: 0, def: 0, qi: 0, crit: 0 }, h.bonus || {})
          });
        });
      }
      if (typeof d.leader === 'number') State.leader = clamp(d.leader, 0, State.heroes.length - 1);
      if (Array.isArray(d.quests)) State.quests = d.quests;
      if (d.guild) Object.assign(State.guild, d.guild);
      if (Array.isArray(d.inventory)) State.inventory = d.inventory;
      if (Array.isArray(d.customProps)) State.customProps = d.customProps;
      if (d.stats) Object.assign(State.stats, d.stats);
      if (d.settings) Object.assign(State.settings, d.settings);
      if (d.flags) Object.assign(State.flags, d.flags);
    } catch (e) { console.warn('[save] load failed', e); }
  },
  reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }
};

const heroById = id => HERO_DEFS.concat(RECRUIT_DEFS).find(h => h.id === id);
const heroState = id => State.heroes.find(h => h.id === id) || State.heroes[0];
const heroStats = id => {
  const d = heroById(id);
  const s = heroState(id);
  const b = s ? s.bonus : { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 };
  return {
    hp: d.hp + b.hp, atk: d.atk + b.atk, def: d.def + b.def, qi: d.qi + b.qi, crit: d.crit + b.crit
  };
};

/* ============================== CHIÊU MỘ ĐỆ TỬ ============================== */
const Recruit = {
  _lastId: null,
  _lastIndex: null,

  freeLeft() {
    const today = new Date().toISOString().slice(0, 10);
    return State.flags.recruitFreeDate === today ? 0 : 1;
  },

  draw(tier) {
    const pool = RECRUIT_POOLS[tier];
    if (!pool) return;
    const p = State.player;
    const today = new Date().toISOString().slice(0, 10);
    const isFree = tier === 1 && this.freeLeft() > 0;

    if (!isFree) {
      if (pool.costGold && p.gold < pool.costGold) {
        UI.toast(`Không đủ Kim Nguyên Bảo! Cần ${pool.costGold} KNB để ${pool.name}.`, 'red');
        return;
      }
      if (pool.costSilver && p.silver < pool.costSilver) {
        UI.toast(`Không đủ bạc! Cần ${fmt(pool.costSilver)} bạc để ${pool.name}.`, 'red');
        return;
      }
    }

    if (isFree) State.flags.recruitFreeDate = today;
    else if (pool.costGold) p.gold -= pool.costGold;
    else if (pool.costSilver) p.silver -= pool.costSilver;

    // Random có trọng số theo tỉ lệ phẩm, rồi random đều trong nhóm phẩm đó.
    const total = pool.rates.reduce((a, r) => a + r.w, 0);
    let roll = Math.random() * total, grade = pool.rates[pool.rates.length - 1].grade;
    for (const r of pool.rates) {
      roll -= r.w;
      if (roll < 0) { grade = r.grade; break; }
    }
    const cands = RECRUIT_DEFS.filter(d => d.type === grade);
    const def = pick(cands);
    if (!def) return;

    const existing = State.heroes.find(h => h.id === def.id);
    if (existing) {
      existing.level += 2;
      existing.bonus.hp += 62500;
      existing.bonus.atk += 225;
      existing.bonus.def += 49000;
      existing.bonus.qi += 55000;
      existing.bonus.crit += 20;
      this._lastId = def.id;
      this._lastIndex = State.heroes.indexOf(existing);
      UI.toast(`Đã có đệ tử này — chuyển thành bồi dưỡng: ${def.name} lên cấp ${existing.level}`, 'gold');
    } else {
      State.heroes.push({ id: def.id, level: def.level, bonus: { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 } });
      this._lastId = def.id;
      this._lastIndex = State.heroes.length - 1;
    }

    SaveManager.save();
    UI.syncWorld();
    if (Info.built) Info.buildSquad();
    if (def.type === 'Giáp') {
      Info.burst();
      Sfx.win();
    } else {
      Sfx.coin();
    }
    UI.openModal('recruit-result', { id: def.id });
  }
};

function gainExp(amount, silent) {
  const p = State.player;
  p.exp += Math.max(0, Math.round(amount));
  let leveled = 0;
  while (p.exp >= p.maxExp) {
    p.exp -= p.maxExp;
    p.level += 1;
    p.maxExp = Math.round(p.maxExp * 1.42);
    p.maxHp += 120; p.hp = p.maxHp;
    p.maxMp += 40; p.mp = p.maxMp;
    p.atk += 15; p.def += 10;
    leveled++;
  }
  if (leveled && !silent) {
    Sfx.level();
    UI.toast(`⚡ Đột phá cảnh giới! Cấp ${p.level}`, 'green');
  }
  UI.syncWorld();
  SaveManager.save();
}

function progressQuest(id, amount) {
  const q = State.quests.find(x => x.id === id);
  if (!q || q.done) return;
  q.progress = Math.min(q.target, q.progress + (amount == null ? 1 : amount));
  if (q.progress >= q.target) {
    q.done = true;
    State.player.silver += q.silver;
    gainExp(q.exp);
    Sfx.win();
    UI.toast(`🎉 Hoàn thành: ${q.title}  +${q.exp} EXP  +${fmt(q.silver)} bạc`, 'green');
  }
  UI.syncWorld();
  SaveManager.save();
}

function addItem(name, icon, type, desc, qty) {
  const found = State.inventory.find(i => i.name === name);
  if (found) found.qty += (qty || 1);
  else State.inventory.push({ id: 'i' + Date.now() + Math.floor(Math.random() * 999), name, icon, type, desc, qty: qty || 1 });
}

function playerDerived() {
  const p = State.player;
  return { hp: p.maxHp, mp: p.maxMp, atk: p.atk, def: p.def };
}

/* ============================== TIỆN ÍCH UI ============================== */
const UI = {
  toast(msg, type) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.innerHTML = msg;
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2500);
  },
  syncWorld() {},
  syncBattle() {}
};
