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
  },
  /* HERO20-BEGIN — 7 đệ tử chiêu mộ mới (tổng 6 gốc + 14 chiêu mộ = 20).
     Chỉ thêm defs mới vào RECRUIT_DEFS: 13 nhân vật cũ không đổi id/chỉ số.
     Phân phẩm theo cân bằng hiện có (Bính Lv.120, Ất Lv.200, Giáp Lv.300);
     tỉ lệ các gói gacha (RECRUIT_POOLS) giữ nguyên, tổng mỗi gói vẫn = 100. */
  {
    id: 'quoctinh', name: 'Quách Tĩnh', title: 'Bắc Hiệp', sect: 'Cái Bang', type: 'Giáp',
    level: 300, ribbon: '#f59e0b', robe: '#78350f', hair: '#1e1b4b', mask: null,
    weapon: 'Hàng Long Thần Chưởng', hat: 'Bắc Hiệp Kim Quan', armor: 'Cái Bang Hào Kiệt Bào', ring: 'Cửu Âm Chân Kinh',
    hp: 2550000000, atk: 66000000, def: 47000000, qi: 58000000, crit: 55000,
    bio: 'Bắc Hiệp Quách Tĩnh, tính tình trung hậu, Hàng Long Thập Bát Chưởng luyện đến lô hỏa thuần thanh, trấn giữ Tương Dương.',
    innate: 'Hàng Long Thập Bát Chưởng',
    fates: [
      ['Bắc Hiệp Nam Đế', 'ra trận cùng Hoàng Dung được +30% Công', true],
      ['Hàng Long Thập Bát', 'trang bị Hàng Long Thần Chưởng được +28% Khí', true]
    ]
  },
  {
    id: 'hoangdung', name: 'Hoàng Dung', title: 'Đào Hoa Đảo Chủ', sect: 'Đào Hoa Đảo', type: 'Ất',
    level: 200, ribbon: '#f472b6', robe: '#be185d', hair: '#0f172a', mask: null,
    weapon: 'Đả Cẩu Bổng', hat: 'Đào Hoa Ngọc Quan', armor: 'Đào Hoa Hồng Y', ring: 'Đào Hoa Ngọc Bội',
    hp: 1650000000, atk: 42000000, def: 31000000, qi: 48000000, crit: 33000,
    bio: 'Đảo chủ Đào Hoa đảo, thông minh tuyệt đỉnh, Đả Cẩu Bổng Pháp xuất thần nhập hóa, tinh thông kỳ môn độn giáp.',
    innate: 'Đả Cẩu Bổng Pháp',
    fates: [
      ['Thần Điêu Hiệp Lữ', 'ra trận cùng Quách Tĩnh được +28% Khí', true],
      ['Đào Hoa Lạc Anh', 'trang bị Đả Cẩu Bổng được +26% Công', true]
    ]
  },
  {
    id: 'hongthat', name: 'Hồng Thất Công', title: 'Cửu Chỉ Thần Cái', sect: 'Cái Bang', type: 'Giáp',
    level: 300, ribbon: '#fbbf24', robe: '#92400e', hair: '#e2e8f0', mask: null,
    weapon: 'Đả Cẩu Bổng', hat: 'Thần Cái Kim Quan', armor: 'Cái Bang Thần Bào', ring: 'Cửu Chỉ Ngọc Giới',
    hp: 2450000000, atk: 64000000, def: 46000000, qi: 62000000, crit: 54000,
    bio: 'Bang chủ Cái Bang đời thứ mười tám, Cửu Chỉ Thần Cái, Hàng Long Thập Bát Chưởng và Đả Cẩu Bổng Pháp đều đạt đỉnh cao.',
    innate: 'Hàng Long Thập Bát Chưởng',
    fates: [
      ['Bắc Cái Tây Độc', 'ra trận cùng Quách Tĩnh được +28% Công', true],
      ['Cửu Chỉ Thần Cái', 'trang bị Đả Cẩu Bổng được +30% Khí', true]
    ]
  },
  {
    id: 'chuba', name: 'Chu Bá Thông', title: 'Lão Ngoan Đồng', sect: 'Toàn Chân', type: 'Giáp',
    level: 300, ribbon: '#34d399', robe: '#065f46', hair: '#f8fafc', mask: null,
    weapon: 'Không Minh Thần Quyền', hat: 'Toàn Chân Đạo Quan', armor: 'Lão Ngoan Đồng Bào', ring: 'Song Thủ Ngọc Giới',
    hp: 2350000000, atk: 61000000, def: 52000000, qi: 60000000, crit: 50000,
    bio: 'Lão Ngoan Đồng Toàn Chân giáo, tính tình như trẻ thơ, Song Thủ Hỗ Bác và Không Minh Quyền thiên hạ vô song.',
    innate: 'Song Thủ Hỗ Bác',
    fates: [
      ['Lão Ngoan Đồng', 'ra trận cùng Vương Trùng Dương được +28% Khí', true],
      ['Không Minh Quyền', 'trang bị Không Minh Thần Quyền được +26% Công', true]
    ]
  },
  {
    id: 'vuongtrung', name: 'Vương Trùng Dương', title: 'Trung Thần Thông', sect: 'Toàn Chân', type: 'Giáp',
    level: 300, ribbon: '#38bdf8', robe: '#1e3a8a', hair: '#e2e8f0', mask: null,
    weapon: 'Toàn Chân Thần Kiếm', hat: 'Trung Thần Thông Quan', armor: 'Toàn Chân Tử Bào', ring: 'Tiên Thiên Ngọc Bội',
    hp: 2500000000, atk: 65000000, def: 49000000, qi: 66000000, crit: 56000,
    bio: 'Trung Thần Thông, tổ sư Toàn Chân giáo, Tiên Thiên Công và Nhất Dương Chỉ đều luyện đến cảnh giới tối cao, Hoa Sơn luận kiếm đệ nhất.',
    innate: 'Tiên Thiên Công',
    fates: [
      ['Hoa Sơn Luận Kiếm', 'ra trận cùng Chu Bá Thông được +30% Khí', true],
      ['Trung Thần Thông', 'trang bị Toàn Chân Thần Kiếm được +28% Công', true]
    ]
  },
  {
    id: 'lamtrieu', name: 'Lâm Triều Anh', title: 'Cổ Mộ Tổ Sư', sect: 'Cổ Mộ', type: 'Ất',
    level: 200, ribbon: '#e879f9', robe: '#581c87', hair: '#0f172a', mask: null,
    weapon: 'Ngọc Nữ Tố Tâm Kiếm', hat: 'Cổ Mộ Ngọc Quan', armor: 'Cổ Mộ Tử Y', ring: 'Ngọc Nữ Tâm Bội',
    hp: 1700000000, atk: 43000000, def: 33000000, qi: 46000000, crit: 34000,
    bio: 'Tổ sư Cổ Mộ phái, sáng tạo Ngọc Nữ Tâm Kinh, kiếm pháp khắc chế Toàn Chân, một đời tình duyên với Vương Trùng Dương.',
    innate: 'Ngọc Nữ Tâm Kinh',
    fates: [
      ['Cổ Mộ Tình Duyên', 'ra trận cùng Vương Trùng Dương được +28% Khí', true],
      ['Ngọc Nữ Tổ Sư', 'trang bị Ngọc Nữ Tố Tâm Kiếm được +26% Công', true]
    ]
  },
  {
    id: 'trieuman', name: 'Triệu Mẫn', title: 'Thiệu Mẫn Quận Chúa', sect: 'Mông Cổ', type: 'Bính',
    level: 120, ribbon: '#fb7185', robe: '#881337', hair: '#0f172a', mask: null,
    weapon: 'Ỷ Thiên Trường Kiếm', hat: 'Quận Chúa Phượng Quan', armor: 'Mông Cổ Hồng Bào', ring: 'Càn Khôn Ngọc Giới',
    hp: 920000000, atk: 21000000, def: 19000000, qi: 24000000, crit: 16500,
    bio: 'Quận chúa Mông Cổ, thông minh cơ trí, võ công học khắp thiên hạ, Càn Khôn Đại Na Di luyện đến tầng thứ bảy.',
    innate: 'Càn Khôn Đại Na Di',
    fates: [
      ['Ỷ Thiên Đồ Long', 'ra trận cùng Dương Quá được +24% Công', true],
      ['Thiệu Mẫn Quận Chúa', 'trang bị Ỷ Thiên Trường Kiếm được +22% Khí', true]
    ]
  }
  /* HERO20-END */
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

/* HERO20-BEGIN — Bộ skill riêng từng nhân vật: 20 nhân vật × 4 skill
   (3 skill thường + 1 tuyệt kỹ ult ở vị trí thứ 4, dùng cho nút skill 1–4).
   Field mỗi skill: name, icon, desc, mult (hệ số sát thương theo công lực;
   với kind 'heal' là hệ số hồi máu = 10% Mệnh tối đa × mult), cd (giây hồi
   chiêu), cost (nội lực/nộ tốn khi tung chiêu, thang 0–100), aoe, color,
   ring (màu hiệu ứng), ult (true chỉ ở tuyệt kỹ), kind ('dmg' | 'heal').
   Tuyệt kỹ: mult 3.0–3.6, cd 11–13, cost 40–50. Skill thường: mult 1.7–2.6,
   cd 6–9, cost 12–20. Không đụng SKILLS chung cũ (giữ làm fallback). */
const HERO20_SKILLS = {
  det: [
    { name: 'Thiên Kiếp Đao Pháp', icon: '🔪', desc: 'Đao khí thiên kiếp chém thẳng một mục tiêu.', mult: 2.0, cd: 6, cost: 15, aoe: false, color: 0xff5500, ring: 0xffaa00, ult: false, kind: 'dmg' },
    { name: 'Thánh Tâm Kiếm Khí', icon: '⚔️', desc: 'Kiếm khí thánh tâm xuyên thấu hàng trước.', mult: 2.3, cd: 7, cost: 18, aoe: false, color: 0xa855f7, ring: 0x4c1d95, ult: false, kind: 'dmg' },
    { name: 'Tứ Kiếp Luân Hồi', icon: '🌀', desc: 'Bốn kiếp luân hồi giáng xuống toàn bộ kẻ địch.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0x7c3aed, ring: 0xc084fc, ult: false, kind: 'dmg' },
    { name: 'Thánh Tâm Tứ Kiếp', icon: '👑', desc: 'Tuyệt kỹ môn chủ Thiên Môn: bốn kiếp cùng giáng, hủy thiên diệt địa.', mult: 3.6, cd: 13, cost: 50, aoe: true, color: 0x991b1b, ring: 0xf59e0b, ult: true, kind: 'dmg' }
  ],
  tieu: [
    { name: 'Tiêu Dao Kiếm Khí', icon: '🗡️', desc: 'Kiếm khí tiêu dao, nhanh như chớp giật.', mult: 2.0, cd: 6, cost: 15, aoe: false, color: 0x38bdf8, ring: 0x7dd3fc, ult: false, kind: 'dmg' },
    { name: 'Túy Tiên Quyền', icon: '🍶', desc: 'Quyền pháp say rượu, hư hư thực thực khó lường.', mult: 2.2, cd: 7, cost: 18, aoe: false, color: 0xf59e0b, ring: 0xfde68a, ult: false, kind: 'dmg' },
    { name: 'Đao Chữ Thần Thông', icon: '📜', desc: 'Chữ thần thông hóa đao, chém diện rộng.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0x0ea5e9, ring: 0x38bdf8, ult: false, kind: 'dmg' },
    { name: 'Tiêu Dao Thần Kiếm', icon: '🌊', desc: 'Tuyệt kỹ Tiêu Dao: một kiếm chém đứt trường giang.', mult: 3.4, cd: 12, cost: 45, aoe: true, color: 0x0284c7, ring: 0x7dd3fc, ult: true, kind: 'dmg' }
  ],
  kiem: [
    { name: 'Vô Song Kiếm Khí', icon: '🗡️', desc: 'Kiếm khí Vô Song thành, sắc bén vô bì.', mult: 2.1, cd: 6, cost: 15, aoe: false, color: 0x60a5fa, ring: 0x93c5fd, ult: false, kind: 'dmg' },
    { name: 'Kiếm Nhị Thập Nhị', icon: '⚡', desc: 'Hai mươi hai thức kiếm liên hoàn đoạt mệnh.', mult: 2.4, cd: 7, cost: 18, aoe: false, color: 0x3b82f6, ring: 0xbfdbfe, ult: false, kind: 'dmg' },
    { name: 'Kiếm Khí Tung Hoành', icon: '🌪️', desc: 'Kiếm khí tung hoành khắp chiến trường.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0x2563eb, ring: 0x60a5fa, ult: false, kind: 'dmg' },
    { name: 'Kiếm Nhị Thập Tam', icon: '🐉', desc: 'Tuyệt kỹ truyền thuyết: kiếm ý diệt thần, vạn vật tĩnh lặng.', mult: 3.5, cd: 13, cost: 48, aoe: true, color: 0x1d4ed8, ring: 0xfacc15, ult: true, kind: 'dmg' }
  ],
  linh: [
    { name: 'Thiên Xà Tiên Pháp', icon: '🐍', desc: 'Tiên pháp thiên xà quấn chặt một mục tiêu.', mult: 1.9, cd: 6, cost: 14, aoe: false, color: 0xe879f9, ring: 0xf0abfc, ult: false, kind: 'dmg' },
    { name: 'Ngũ Hành Pháp Ấn', icon: '☯️', desc: 'Pháp ấn ngũ hành giáng xuống toàn bộ kẻ địch.', mult: 2.2, cd: 7, cost: 18, aoe: true, color: 0xa855f7, ring: 0xd8b4fe, ult: false, kind: 'dmg' },
    { name: 'Nữ Oa Hồi Xuân', icon: '💗', desc: 'Hồi xuân thuật: hồi phục sinh lực cho toàn đội.', mult: 1.2, cd: 9, cost: 20, aoe: false, color: 0x34d399, ring: 0x6ee7b7, ult: false, kind: 'heal' },
    { name: 'Ngũ Lôi Chú', icon: '⚡', desc: 'Tuyệt kỹ Nữ Oa: ngũ lôi cùng giáng, thiên địa biến sắc.', mult: 3.3, cd: 12, cost: 45, aoe: true, color: 0x7e22ce, ring: 0xfacc15, ult: true, kind: 'dmg' }
  ],
  niep: [
    { name: 'Phong Thần Thối', icon: '💨', desc: 'Cước pháp nhanh như gió lốc, đá bay kẻ địch.', mult: 2.0, cd: 6, cost: 15, aoe: false, color: 0xf59e0b, ring: 0xfde68a, ult: false, kind: 'dmg' },
    { name: 'Tuyết Ẩm Đao Pháp', icon: '❄️', desc: 'Đao pháp Tuyết Ẩm, lạnh thấu xương.', mult: 2.3, cd: 7, cost: 18, aoe: false, color: 0x38bdf8, ring: 0xbae6fd, ult: false, kind: 'dmg' },
    { name: 'Cuồng Phong Loạn Vũ', icon: '🌪️', desc: 'Cuồng phong loạn vũ quét sạch chiến trường.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0x0ea5e9, ring: 0x7dd3fc, ult: false, kind: 'dmg' },
    { name: 'Phong Thần Nộ', icon: '🌩️', desc: 'Tuyệt kỹ Phong Thần: cơn giận của gió, vạn vật tan tác.', mult: 3.4, cd: 12, cost: 45, aoe: true, color: 0x1e40af, ring: 0x93c5fd, ult: true, kind: 'dmg' }
  ],
  bo: [
    { name: 'Bài Vân Chưởng', icon: '🌊', desc: 'Chưởng pháp mây bay, nhu mà thắng cương.', mult: 2.0, cd: 6, cost: 15, aoe: false, color: 0xec4899, ring: 0xf9a8d4, ult: false, kind: 'dmg' },
    { name: 'Tuyệt Thế Kiếm Pháp', icon: '🗡️', desc: 'Kiếm pháp Tuyệt Thế Hảo Kiếm, một kiếm đoạt mệnh.', mult: 2.3, cd: 7, cost: 18, aoe: false, color: 0x8b5cf6, ring: 0xc4b5fd, ult: false, kind: 'dmg' },
    { name: 'Kinh Vân Phá', icon: '⛈️', desc: 'Kinh vân phá không, sấm sét giáng diện rộng.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0x6d28d9, ring: 0xa78bfa, ult: false, kind: 'dmg' },
    { name: 'Vân Hải Vô Nhai', icon: '🐉', desc: 'Tuyệt kỹ Bất Khốc Tử Thần: biển mây vô biên nhấn chìm kẻ địch.', mult: 3.4, cd: 12, cost: 45, aoe: true, color: 0x4c1d95, ring: 0xec4899, ult: true, kind: 'dmg' }
  ],
  lenhho: [
    { name: 'Hoa Sơn Kiếm Pháp', icon: '🗡️', desc: 'Kiếm pháp Hoa Sơn, hiểm mà chính, nhanh mà chuẩn.', mult: 1.8, cd: 6, cost: 12, aoe: false, color: 0x34d399, ring: 0x6ee7b7, ult: false, kind: 'dmg' },
    { name: 'Độc Cô Cửu Kiếm', icon: '⚔️', desc: 'Chín thức phá kiếm, phá hết thiên hạ kiếm pháp.', mult: 2.1, cd: 7, cost: 16, aoe: false, color: 0x10b981, ring: 0x6ee7b7, ult: false, kind: 'dmg' },
    { name: 'Hấp Tinh Đại Pháp', icon: '🌀', desc: 'Hấp tinh đoạt khí, hút nội lực kẻ địch diện rộng.', mult: 2.3, cd: 8, cost: 18, aoe: true, color: 0x059669, ring: 0x34d399, ult: false, kind: 'dmg' },
    { name: 'Tiếu Ngạo Giang Hồ', icon: '🍶', desc: 'Tuyệt kỹ Tiếu Ngạo: một khúc cầm, kiếm khí vang khắp giang hồ.', mult: 3.0, cd: 11, cost: 40, aoe: true, color: 0x065f46, ring: 0x34d399, ult: true, kind: 'dmg' }
  ],
  nghlam: [
    { name: 'Hằng Sơn Kiếm Pháp', icon: '🗡️', desc: 'Kiếm pháp Hằng Sơn, thanh tịnh mà sắc bén.', mult: 1.7, cd: 6, cost: 12, aoe: false, color: 0x6ee7b7, ring: 0xa7f3d0, ult: false, kind: 'dmg' },
    { name: 'Thanh Tâm Chú', icon: '💗', desc: 'Thanh tâm chú: hồi phục sinh lực cho toàn đội.', mult: 1.2, cd: 9, cost: 18, aoe: false, color: 0x34d399, ring: 0x6ee7b7, ult: false, kind: 'heal' },
    { name: 'Phất Trần Vô Ảnh', icon: '🌿', desc: 'Phất trần vô ảnh, quét bay kẻ địch hàng trước.', mult: 2.0, cd: 7, cost: 15, aoe: false, color: 0x0d9488, ring: 0x5eead4, ult: false, kind: 'dmg' },
    { name: 'Hằng Sơn Tâm Pháp', icon: '☸️', desc: 'Tuyệt kỹ Hằng Sơn: tâm pháp viên mãn, Phật quang phổ chiếu.', mult: 3.0, cd: 11, cost: 40, aoe: true, color: 0x0f766e, ring: 0x99f6e4, ult: true, kind: 'dmg' }
  ],
  doanh: [
    { name: 'Nhật Nguyệt Thần Cầm', icon: '🎵', desc: 'Tiếng cầm nhật nguyệt, âm ba đoạt mệnh.', mult: 2.0, cd: 6, cost: 15, aoe: false, color: 0x38bdf8, ring: 0x7dd3fc, ult: false, kind: 'dmg' },
    { name: 'Tiếu Ngạo Khúc', icon: '🎶', desc: 'Khúc Tiếu Ngạo vang lên, kiếm khí theo nhạc diện rộng.', mult: 2.2, cd: 7, cost: 17, aoe: true, color: 0x60a5fa, ring: 0xbfdbfe, ult: false, kind: 'dmg' },
    { name: 'Thánh Cô Mê Hồn', icon: '🌸', desc: 'Mê hồn thuật thánh cô, hoa rơi đoạt mệnh một mục tiêu.', mult: 2.4, cd: 8, cost: 19, aoe: false, color: 0x818cf8, ring: 0xc7d2fe, ult: false, kind: 'dmg' },
    { name: 'Nhật Nguyệt Đồng Huy', icon: '☀️', desc: 'Tuyệt kỹ Thánh Cô: nhật nguyệt cùng tỏa sáng, thiêu rụi kẻ địch.', mult: 3.2, cd: 12, cost: 42, aoe: true, color: 0x1e3a8a, ring: 0xfacc15, ult: true, kind: 'dmg' }
  ],
  duong: [
    { name: 'Huyền Thiết Kiếm Pháp', icon: '🗡️', desc: 'Trọng kiếm vô phong, đại xảo bất công.', mult: 2.1, cd: 6, cost: 16, aoe: false, color: 0x60a5fa, ring: 0x93c5fd, ult: false, kind: 'dmg' },
    { name: 'Ám Nhiên Chưởng', icon: '🌑', desc: 'Chưởng pháp ám nhiên, sầu bi hóa sát khí.', mult: 2.3, cd: 7, cost: 18, aoe: false, color: 0x6366f1, ring: 0xa5b4fc, ult: false, kind: 'dmg' },
    { name: 'Thần Điêu Phi Vũ', icon: '🦅', desc: 'Thần điêu tung cánh, vuốt sắc quét diện rộng.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0x4f46e5, ring: 0x818cf8, ult: false, kind: 'dmg' },
    { name: 'Ám Nhiên Tiêu Hồn Chưởng', icon: '💔', desc: 'Tuyệt kỹ Thần Điêu Đại Hiệp: tiêu hồn đoạt phách, thiên hạ vô địch.', mult: 3.3, cd: 12, cost: 45, aoe: true, color: 0x312e81, ring: 0xc7d2fe, ult: true, kind: 'dmg' }
  ],
  dongph: [
    { name: 'Quỳ Hoa Phi Châm', icon: '💉', desc: 'Phi châm Quỳ Hoa, nhanh đến mắt thường không theo kịp.', mult: 2.2, cd: 6, cost: 16, aoe: false, color: 0xa855f7, ring: 0xd8b4fe, ult: false, kind: 'dmg' },
    { name: 'Tú Hoa Thần Tốc', icon: '🌸', desc: 'Thân pháp tú hoa, châm đi tới đâu hoa nở tới đó.', mult: 2.4, cd: 7, cost: 18, aoe: false, color: 0xc026d3, ring: 0xf0abfc, ult: false, kind: 'dmg' },
    { name: 'Nhật Nguyệt Ma Công', icon: '🌙', desc: 'Ma công nhật nguyệt, hắc khí cuồn cuộn diện rộng.', mult: 2.6, cd: 8, cost: 20, aoe: true, color: 0x7e22ce, ring: 0xe879f9, ult: false, kind: 'dmg' },
    { name: 'Quỳ Hoa Bảo Điển', icon: '👑', desc: 'Tuyệt kỹ giáo chủ: Quỳ Hoa xuất thế, thiên hạ đệ nhất tốc độ.', mult: 3.5, cd: 13, cost: 48, aoe: true, color: 0x86198f, ring: 0xf0abfc, ult: true, kind: 'dmg' }
  ],
  docco: [
    { name: 'Độc Cô Kiếm Ý', icon: '🗡️', desc: 'Kiếm ý Độc Cô, vô chiêu thắng hữu chiêu.', mult: 2.2, cd: 6, cost: 16, aoe: false, color: 0xe879f9, ring: 0xf5d0fe, ult: false, kind: 'dmg' },
    { name: 'Phá Kiếm Thức', icon: '⚔️', desc: 'Phá kiếm thức: phá mọi kiếm pháp thiên hạ.', mult: 2.4, cd: 7, cost: 18, aoe: false, color: 0xd946ef, ring: 0xf0abfc, ult: false, kind: 'dmg' },
    { name: 'Phá Khí Thức', icon: '💨', desc: 'Phá khí thức: phá nội công, kiếm khí quét diện rộng.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0xc026d3, ring: 0xe879f9, ult: false, kind: 'dmg' },
    { name: 'Độc Cô Cửu Kiếm', icon: '🐉', desc: 'Tuyệt kỹ Kiếm Ma: chín thức hợp nhất, cầu bại mà không được.', mult: 3.6, cd: 13, cost: 48, aoe: true, color: 0x701a75, ring: 0xf0abfc, ult: true, kind: 'dmg' }
  ],
  longnu: [
    { name: 'Ngọc Nữ Kiếm Pháp', icon: '🗡️', desc: 'Kiếm pháp Ngọc Nữ, thanh thoát như tiên nữ giáng trần.', mult: 2.1, cd: 6, cost: 15, aoe: false, color: 0xf472b6, ring: 0xfbcfe8, ult: false, kind: 'dmg' },
    { name: 'Tố Tâm Kiếm Ý', icon: '💗', desc: 'Tố tâm kiếm ý, song kiếm hợp bích đoạt mệnh.', mult: 2.3, cd: 7, cost: 18, aoe: false, color: 0xec4899, ring: 0xf9a8d4, ult: false, kind: 'dmg' },
    { name: 'Cổ Mộ Khinh Công', icon: '🦋', desc: 'Khinh công Cổ Mộ, thân pháp phiêu dật diện rộng.', mult: 2.4, cd: 8, cost: 19, aoe: true, color: 0xdb2777, ring: 0xf472b6, ult: false, kind: 'dmg' },
    { name: 'Ngọc Nữ Tâm Kinh', icon: '🌙', desc: 'Tuyệt kỹ Ngọc Nữ: tâm kinh viên mãn, nguyệt quang trút xuống.', mult: 3.4, cd: 12, cost: 45, aoe: true, color: 0x9d174d, ring: 0xfbcfe8, ult: true, kind: 'dmg' }
  ],
  quoctinh: [
    { name: 'Hàng Long Chưởng', icon: '🐉', desc: 'Chưởng pháp Hàng Long, cương mãnh vô song.', mult: 2.3, cd: 7, cost: 18, aoe: false, color: 0xf59e0b, ring: 0xfde68a, ult: false, kind: 'dmg' },
    { name: 'Song Thủ Hỗ Bác', icon: '✋', desc: 'Hai tay đánh hai chiêu khác nhau cùng lúc.', mult: 2.1, cd: 6, cost: 16, aoe: false, color: 0xd97706, ring: 0xfcd34d, ult: false, kind: 'dmg' },
    { name: 'Cửu Âm Chân Kinh', icon: '📜', desc: 'Chân kinh Cửu Âm, âm khí cuồn cuộn diện rộng.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0x92400e, ring: 0xf59e0b, ult: false, kind: 'dmg' },
    { name: 'Hàng Long Thập Bát Chưởng', icon: '🔥', desc: 'Tuyệt kỹ Bắc Hiệp: mười tám chưởng long ngâm, thiên hạ đệ nhất cương mãnh.', mult: 3.6, cd: 13, cost: 48, aoe: true, color: 0x78350f, ring: 0xfbbf24, ult: true, kind: 'dmg' }
  ],
  hoangdung: [
    { name: 'Đả Cẩu Bổng Pháp', icon: '🎋', desc: 'Bổng pháp Đả Cẩu, biến hóa khôn lường.', mult: 2.0, cd: 6, cost: 15, aoe: false, color: 0xf472b6, ring: 0xfbcfe8, ult: false, kind: 'dmg' },
    { name: 'Lạc Anh Thần Kiếm', icon: '🌸', desc: 'Thần kiếm lạc anh, hoa đào bay theo kiếm.', mult: 2.2, cd: 7, cost: 17, aoe: false, color: 0xec4899, ring: 0xf9a8d4, ult: false, kind: 'dmg' },
    { name: 'Bích Hải Triều Sinh', icon: '🌊', desc: 'Triều sinh khúc: sóng biển dâng trào diện rộng.', mult: 2.4, cd: 8, cost: 19, aoe: true, color: 0x0ea5e9, ring: 0x7dd3fc, ult: false, kind: 'dmg' },
    { name: 'Lạc Anh Thần Kiếm Chưởng', icon: '🌺', desc: 'Tuyệt kỹ Đào Hoa đảo chủ: hoa đào rụng, kiếm chưởng hợp nhất.', mult: 3.2, cd: 12, cost: 42, aoe: true, color: 0xbe185d, ring: 0xf9a8d4, ult: true, kind: 'dmg' }
  ],
  hongthat: [
    { name: 'Hàng Long Chưởng Pháp', icon: '🐉', desc: 'Chưởng pháp Hàng Long của bang chủ Cái Bang.', mult: 2.3, cd: 7, cost: 18, aoe: false, color: 0xfbbf24, ring: 0xfde68a, ult: false, kind: 'dmg' },
    { name: 'Đả Cẩu Bổng Pháp', icon: '🎋', desc: 'Bổng pháp trấn bang, cẩu tặc nghe danh khiếp vía.', mult: 2.2, cd: 6, cost: 17, aoe: false, color: 0xf59e0b, ring: 0xfcd34d, ult: false, kind: 'dmg' },
    { name: 'Tiêu Dao Du', icon: '🍶', desc: 'Tiêu dao du: thân pháp phóng khoáng quét diện rộng.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0xd97706, ring: 0xfbbf24, ult: false, kind: 'dmg' },
    { name: 'Thần Long Bãi Vĩ', icon: '🔥', desc: 'Tuyệt kỹ Cửu Chỉ Thần Cái: thần long vẫy đuôi, quét sạch chiến trường.', mult: 3.5, cd: 13, cost: 48, aoe: true, color: 0x92400e, ring: 0xf59e0b, ult: true, kind: 'dmg' }
  ],
  chuba: [
    { name: 'Không Minh Quyền', icon: '🥊', desc: 'Quyền pháp Không Minh, hư không mà đầy uy lực.', mult: 2.2, cd: 6, cost: 17, aoe: false, color: 0x34d399, ring: 0x6ee7b7, ult: false, kind: 'dmg' },
    { name: 'Song Thủ Hỗ Bác', icon: '✋', desc: 'Hai tay hai chiêu, tả hữu cùng đánh.', mult: 2.4, cd: 7, cost: 18, aoe: false, color: 0x10b981, ring: 0x6ee7b7, ult: false, kind: 'dmg' },
    { name: 'Lão Ngoan Đồng', icon: '🎭', desc: 'Chiêu thức trẻ thơ mà quỷ dị, quét diện rộng.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0x059669, ring: 0x34d399, ult: false, kind: 'dmg' },
    { name: 'Cửu Âm Chân Kinh', icon: '📜', desc: 'Tuyệt kỹ Lão Ngoan Đồng: Cửu Âm viên mãn, âm dương hợp nhất.', mult: 3.5, cd: 13, cost: 48, aoe: true, color: 0x065f46, ring: 0x6ee7b7, ult: true, kind: 'dmg' }
  ],
  vuongtrung: [
    { name: 'Toàn Chân Kiếm Pháp', icon: '🗡️', desc: 'Kiếm pháp Toàn Chân, chính tông Huyền Môn.', mult: 2.3, cd: 7, cost: 18, aoe: false, color: 0x38bdf8, ring: 0x7dd3fc, ult: false, kind: 'dmg' },
    { name: 'Tiên Thiên Công', icon: '☯️', desc: 'Tiên thiên chân khí, nội lực thâm hậu đoạt mệnh.', mult: 2.4, cd: 7, cost: 19, aoe: false, color: 0x0ea5e9, ring: 0x38bdf8, ult: false, kind: 'dmg' },
    { name: 'Nhất Dương Chỉ', icon: '☀️', desc: 'Nhất dương chỉ lực, dương khí thuần khiết diện rộng.', mult: 2.5, cd: 8, cost: 20, aoe: true, color: 0x0284c7, ring: 0x7dd3fc, ult: false, kind: 'dmg' },
    { name: 'Tiên Thiên Cương Khí', icon: '🐉', desc: 'Tuyệt kỹ Trung Thần Thông: cương khí tiên thiên bao phủ thiên địa.', mult: 3.6, cd: 13, cost: 48, aoe: true, color: 0x1e3a8a, ring: 0x38bdf8, ult: true, kind: 'dmg' }
  ],
  lamtrieu: [
    { name: 'Ngọc Nữ Kiếm Pháp', icon: '🗡️', desc: 'Kiếm pháp Ngọc Nữ, khắc chế Toàn Chân kiếm pháp.', mult: 2.1, cd: 6, cost: 16, aoe: false, color: 0xe879f9, ring: 0xf5d0fe, ult: false, kind: 'dmg' },
    { name: 'Cổ Mộ U Công', icon: '🌑', desc: 'U công Cổ Mộ, âm hàn thấu xương một mục tiêu.', mult: 2.3, cd: 7, cost: 18, aoe: false, color: 0xa855f7, ring: 0xd8b4fe, ult: false, kind: 'dmg' },
    { name: 'Ngọc Nữ Hồi Xuân', icon: '💗', desc: 'Hồi xuân thuật Cổ Mộ: hồi phục sinh lực cho toàn đội.', mult: 1.2, cd: 9, cost: 18, aoe: false, color: 0x34d399, ring: 0x6ee7b7, ult: false, kind: 'heal' },
    { name: 'Ngọc Nữ Song Kiếm Hợp Bích', icon: '⚔️', desc: 'Tuyệt kỹ Cổ Mộ tổ sư: song kiếm hợp bích, nguyệt quang trút xuống.', mult: 3.3, cd: 12, cost: 45, aoe: true, color: 0x581c87, ring: 0xe879f9, ult: true, kind: 'dmg' }
  ],
  trieuman: [
    { name: 'Ỷ Thiên Kiếm Pháp', icon: '🗡️', desc: 'Kiếm pháp Ỷ Thiên, sắc bén vô song.', mult: 1.9, cd: 6, cost: 14, aoe: false, color: 0xfb7185, ring: 0xfecdd3, ult: false, kind: 'dmg' },
    { name: 'Mông Cổ Loan Đao', icon: '🔪', desc: 'Loan đao thảo nguyên, chém nhanh như gió.', mult: 2.0, cd: 7, cost: 15, aoe: false, color: 0xf43f5e, ring: 0xfda4af, ult: false, kind: 'dmg' },
    { name: 'Thập Hương Nhuyễn Cân Tán', icon: '🌫️', desc: 'Độc vụ thập hương, làm mềm gân cốt kẻ địch diện rộng.', mult: 2.2, cd: 8, cost: 18, aoe: true, color: 0x9f1239, ring: 0xfb7185, ult: false, kind: 'dmg' },
    { name: 'Càn Khôn Đại Na Di', icon: '🌀', desc: 'Tuyệt kỹ quận chúa: Càn Khôn đảo chuyển, dời núi lấp biển.', mult: 3.0, cd: 11, cost: 40, aoe: true, color: 0x881337, ring: 0xfda4af, ult: true, kind: 'dmg' }
  ]
};

/* Trả về bộ 4 skill của nhân vật (3 thường + 1 tuyệt kỹ). Ưu tiên def.skills
   nếu def có, rồi HERO20_SKILLS, cuối cùng fallback 4 tuyệt kỹ chung SKILLS
   (đổi shape cho đồng nhất) — nhân vật nào thiếu skill cũng không crash. */
function heroSkills(id) {
  const def = heroById(id);
  if (def && Array.isArray(def.skills) && def.skills.length >= 4) return def.skills;
  const set = HERO20_SKILLS[id];
  if (Array.isArray(set) && set.length >= 4) return set;
  return SKILLS.map((s, i) => ({
    name: s.name, icon: s.icon, desc: s.desc, mult: s.mult, cd: s.cd,
    cost: i === 3 ? 30 : 15, aoe: !!s.aoe, color: s.color, ring: s.ring,
    ult: i === 0, kind: i === 3 ? 'heal' : 'dmg'
  }));
}
function heroUltimate(id) {
  const ss = heroSkills(id);
  return ss.find(s => s.ult) || ss[0];
}
/* HERO20-END */

/* ARENA10-BEGIN — Battle Map 1..10 (thay 8 map cũ; 8 id cũ giữ lại làm alias legacy) */
const ARENAS = {
  bm1: {
    key: 'bm1', num: 1, name: 'Battle Map 1 — Rừng Trúc U Minh', short: 'Rừng Trúc', icon: '🌿', mul: 1.0,
    exp: 150, silver: 2800, gold: 1, tip: 'Sương trúc u minh, ma giáo phục kích trong rừng.',
    badge: 'Rừng Trúc U Minh', boss: 'Trúc Ma Lão Tổ (Lv.70)', bossSkill: 'Trúc Diệp Phi Đao — lá trúc hóa đao, chém diện rộng',
    bossReward: 'Trúc Diệp Linh Đan', bossRewardIcon: '🎋', recLvl: 'Cấp 65 - 70',
    drops: 'Trúc Diệp Linh Đan, Mảnh Trúc Kiếm', desc: 'Rừng trúc sương mù dày đặc, ma giáo thường phục kích trong bóng trúc.',
    enemies: ['Trúc Yêu', 'Ma Giáo Đồ', 'Sơn Tặc Trúc Lâm'],
    builder: 'bamboo', isBoss: false
  },
  bm2: {
    key: 'bm2', num: 2, name: 'Battle Map 2 — Đài Phật Anh Đào', short: 'Đài Phật', icon: '🌸', mul: 1.4,
    exp: 210, silver: 3920, gold: 1, tip: 'Luận kiếm dưới tượng Phật, hoa anh đào bay khắp trời.',
    badge: 'Thánh Địa Đài Phật', boss: 'Hộ Pháp Hắc Bạch (Lv.72)', bossSkill: 'Hắc Bạch Song Sát — song chưởng âm dương đoạt mệnh',
    bossReward: 'Anh Đào Linh Hoa', bossRewardIcon: '🌸', recLvl: 'Cấp 68 - 73',
    drops: 'Anh Đào Linh Hoa, Phật Quang Xá Lợi', desc: 'Đài Phật linh thiêng, hoa anh đào bay khắp trời, nơi luận kiếm của cao thủ.',
    enemies: ['Anh Đào Yêu', 'Hộ Pháp Áo Trắng', 'Tăng Nhân Sa Ngã'],
    builder: 'buddha', isBoss: false
  },
  bm3: {
    key: 'bm3', num: 3, name: 'Battle Map 3 — Biện Kinh Thành Cổ', short: 'Biện Kinh', icon: '🏯', mul: 1.9,
    exp: 285, silver: 5320, gold: 2, tip: 'Hồ sen Biện Kinh, trận chiến cuối cùng của ma giáo.',
    badge: 'Kinh Đô Võ Lâm', boss: 'Ma Giáo Giáo Chủ (Lv.75)', bossSkill: 'Huyết Ma Đại Pháp — hút sinh lực toàn đội',
    bossReward: 'Biện Kinh Lệnh Bài', bossRewardIcon: '🏯', recLvl: 'Cấp 73 - 76',
    drops: 'Biện Kinh Lệnh Bài, Long Văn Bảo Giáp', desc: 'Kinh đô phồn hoa bên hồ sen, nơi diễn ra trận chiến cuối cùng với ma giáo.',
    enemies: ['Ma Giáo Cao Thủ', 'Tử Y Sát Thủ', 'Độc Long Sứ Giả'],
    builder: 'city', isBoss: false
  },
  bm4: {
    key: 'bm4', num: 4, name: 'Battle Map 4 — Tuyết Sơn Băng Phong', short: 'Tuyết Sơn', icon: '❄️', mul: 2.4,
    exp: 360, silver: 6720, gold: 2, tip: 'Bão tuyết gào thét, băng phong vạn lý đóng băng cả kiếm khí.',
    badge: 'Đỉnh Tuyết Ngàn Năm', boss: 'Băng Tuyết Nữ Vương (Lv.78)', bossSkill: 'Băng Phong Vạn Lý — đóng băng toàn đội 1 hiệp',
    bossReward: 'Băng Tâm Ngọc Bội', bossRewardIcon: '❄️', recLvl: 'Cấp 76 - 79',
    drops: 'Băng Tâm Ngọc Bội, Tuyết Liên Thiên Sơn', desc: 'Đỉnh tuyết ngàn năm không tan, gió lạnh cắt da, chỉ cao thủ nội công thâm hậu mới trụ được.',
    enemies: ['Tuyết Yêu', 'Băng Lang', 'Tuyết Sơn Cự Nhân'],
    builder: 'snow', isBoss: false
  },
  bm5: {
    key: 'bm5', num: 5, name: 'Battle Map 5 — Sa Mạc Hoàng Kim', short: 'Sa Mạc', icon: '🏜️', mul: 2.9,
    exp: 435, silver: 8120, gold: 3, tip: 'Cát vàng cuồn cuộn, kim tự tháp cổ chôn vùi kho báu.',
    badge: 'Hoàng Kim Đại Mạc', boss: 'Sa Mạc Hoàng Đế (Lv.81)', bossSkill: 'Cát Bão Hoàng Kim — bão cát mù trời, sát thương diện rộng',
    bossReward: 'Hoàng Kim Sa Lậu', bossRewardIcon: '⏳', recLvl: 'Cấp 79 - 82',
    drops: 'Hoàng Kim Sa Lậu, Kim Tự Tháp Cổ Ngọc', desc: 'Đại mạc cát vàng mênh mông, ốc đảo là nơi duy nhất có nước — và có phục kích.',
    enemies: ['Sa Tặc', 'Cát Yêu', 'Bọ Cạp Khổng Lồ'],
    builder: 'desert', isBoss: false
  },
  bm6: {
    key: 'bm6', num: 6, name: 'Battle Map 6 — Núi Lửa Thiên Hỏa', short: 'Thiên Hỏa', icon: '🌋', mul: 3.4,
    exp: 510, silver: 9520, gold: 3, tip: 'Lửa thiêng bùng cháy, Hỏa Kỳ Lân trấn giữ đỉnh cao nhất.',
    badge: 'Trọng Điểm Quyết Chiến', boss: 'Hỏa Kỳ Lân – Viêm Đế (Lv.84)', bossSkill: 'Thiên Hỏa Phần Thiên — lửa trời thiêu rụi chiến trường',
    bossReward: 'Thần Binh Hỏa Lân', bossRewardIcon: '🔥', recLvl: 'Cấp 82 - 85',
    drops: 'Thần Binh Hỏa Lân, Bí Kíp Cửu Dương', desc: 'Đỉnh núi lửa thiêng, dung nham cuộn trào, nơi quyết chiến với Hỏa Kỳ Lân.',
    enemies: ['Hỏa Ma', 'Dung Nham Quái', 'Hỏa Diệm Sứ Giả'],
    builder: 'volcano', isBoss: false
  },
  bm7: {
    key: 'bm7', num: 7, name: 'Battle Map 7 — Đầm Lầy U Ám', short: 'Đầm Lầy', icon: '🐸', mul: 3.9,
    exp: 585, silver: 10920, gold: 4, tip: 'Độc vụ mê hồn, bước sai một bước là chìm trong bùn độc.',
    badge: 'U Ám Chiểu Trạch', boss: 'Đầm Lầy Ma Quân (Lv.87)', bossSkill: 'Độc Vụ Mê Hồn — độc vụ lan khắp trận, rút sinh lực mỗi hiệp',
    bossReward: 'Độc Long Châu', bossRewardIcon: '☠️', recLvl: 'Cấp 85 - 88',
    drops: 'Độc Long Châu, U Minh Độc Thảo', desc: 'Đầm lầy u ám quanh năm sương độc, cây khô trơ cành, nấm phát quang lập lòe trong đêm.',
    enemies: ['Đầm Lầy Thủy Quái', 'Độc Oa', 'Cây Khô Ma'],
    builder: 'swamp', isBoss: false
  },
  bm8: {
    key: 'bm8', num: 8, name: 'Battle Map 8 — Vân Cung Thiên Đình', short: 'Vân Cung', icon: '☁️', mul: 4.4,
    exp: 660, silver: 12320, gold: 4, tip: 'Cung điện trên mây, thiên lôi giáng xuống kẻ dám khiêu chiến.',
    badge: 'Thiên Đình Vân Cung', boss: 'Thiên Đình Chiến Thần (Lv.90)', bossSkill: 'Thiên Lôi Vạn Quân — vạn đạo thiên lôi giáng xuống',
    bossReward: 'Thiên Lôi Lệnh', bossRewardIcon: '⚡', recLvl: 'Cấp 88 - 91',
    drops: 'Thiên Lôi Lệnh, Vân Cung Tiên Y', desc: 'Cung điện vàng son lơ lửng giữa tầng mây, nơi thiên binh thiên tướng trấn giữ cổng trời.',
    enemies: ['Thiên Binh', 'Vân Hạc Tiên', 'Kim Giáp Thần Tướng'],
    builder: 'sky', isBoss: false
  },
  bm9: {
    key: 'bm9', num: 9, name: 'Battle Map 9 — Hang Quỷ Âm Phủ', short: 'Hang Quỷ', icon: '👹', mul: 4.9,
    exp: 735, silver: 13720, gold: 5, tip: 'Âm khí ngút trời, quỷ trảo từ bóng tối vươn ra không báo trước.',
    badge: 'Âm Phủ Quỷ Quật', boss: 'Quỷ Vương Diêm La (Lv.93)', bossSkill: 'Âm Phủ Quỷ Trảo — quỷ trảo hút hồn, giảm mạnh phòng thủ',
    bossReward: 'Diêm La Lệnh Bài', bossRewardIcon: '👹', recLvl: 'Cấp 91 - 94',
    drops: 'Diêm La Lệnh Bài, Âm Hồn Châu', desc: 'Hang quỷ sâu hun hút, thạch nhũ sắc nhọn, tinh thể âm hồn phát sáng tím biếc trong bóng tối.',
    enemies: ['Tiểu Quỷ', 'Âm Hồn', 'Quỷ Diện Tướng'],
    builder: 'cave', isBoss: false
  },
  bm10: {
    key: 'bm10', num: 10, name: 'Battle Map 10 — Hồ Sen Biển Đông', short: 'Hồ Sen', icon: '🌊', mul: 5.5,
    exp: 825, silver: 15400, gold: 6, tip: 'Sóng biển cuộn trào, Long Vương nổi giận — trận chiến cuối cùng.',
    badge: 'Biển Đông Long Cung', boss: 'Long Vương Biển Đông (Lv.96)', bossSkill: 'Hải Triều Long Ngâm — sóng thần long ngâm cuốn phăng tất cả',
    bossReward: 'Long Châu Biển Đông', bossRewardIcon: '🐉', recLvl: 'Cấp 94+',
    drops: 'Long Châu Biển Đông, 5000 Vàng, Bí Kíp Long Ngâm', desc: 'Hồ sen mênh mông nối ra biển Đông, Long Vương trấn giữ long châu — ai thắng được mới xứng danh thiên hạ đệ nhất.',
    enemies: ['Thủy Quái', 'Giao Long Con', 'Biển Đông Thủy Binh'],
    builder: 'lake', isBoss: true
  },
  /* Id map cũ (save v2 trước đây) — giữ lại để save cũ vẫn mở được trận,
     resolveArenaKey() map chúng sang Battle Map mới tương ứng. Không hiện ở modal. */
  bamboo: { key: 'bamboo', name: 'Rừng Trúc U Minh', short: 'Rừng Trúc', icon: '🌿', mul: 1, exp: 150, silver: 2800, gold: 1, builder: 'bamboo', legacy: true, aliasOf: 'bm1', boss: 'Trúc Ma Lão Tổ (Lv.70)', recLvl: 'Cấp 65 - 70', drops: 'Trúc Diệp Linh Đan', desc: 'Map cũ — đã gộp vào Battle Map 1.', badge: 'Rừng Trúc U Minh', tip: '', isBoss: false },
  buddha: { key: 'buddha', name: 'Đài Phật Anh Đào', short: 'Đài Phật', icon: '🌸', mul: 2.15, exp: 340, silver: 7600, gold: 2, builder: 'buddha', legacy: true, aliasOf: 'bm2', boss: 'Hộ Pháp Hắc Bạch (Lv.72)', recLvl: 'Cấp 68 - 73', drops: 'Anh Đào Linh Hoa', desc: 'Map cũ — đã gộp vào Battle Map 2.', badge: 'Thánh Địa Đài Phật', tip: '', isBoss: false },
  city: { key: 'city', name: 'Biện Kinh Thành Cổ', short: 'Biện Kinh', icon: '🏯', mul: 3.5, exp: 720, silver: 17000, gold: 3, builder: 'city', legacy: true, aliasOf: 'bm3', boss: 'Ma Giáo Giáo Chủ (Lv.75)', recLvl: 'Cấp 73 - 76', drops: 'Biện Kinh Lệnh Bài', desc: 'Map cũ — đã gộp vào Battle Map 3.', badge: 'Kinh Đô Võ Lâm', tip: '', isBoss: false },
  'van-mong-dam': { key: 'van-mong-dam', name: 'Vân Mộng Đầm', short: 'Vân Mộng', icon: '💧', mul: 1.2, exp: 190, silver: 3600, gold: 1, builder: 'city', legacy: true, aliasOf: 'bm10', boss: 'Thủy Nguyệt Tiên Tử (Lv.73)', recLvl: 'Cấp 70 - 75', drops: 'Băng Tâm Ngọc Bội', desc: 'Map cũ — đã gộp vào Battle Map 10.', badge: 'Thủy Mặc U Cốc', tip: '', isBoss: false },
  'kiem-linh-coc': { key: 'kiem-linh-coc', name: 'Kiếm Linh Cốc', short: 'Kiếm Linh', icon: '🗡️', mul: 1.6, exp: 260, silver: 5400, gold: 1, builder: 'bamboo', legacy: true, aliasOf: 'bm3', boss: 'Kiếm Linh Hộ Pháp (Lv.74)', recLvl: 'Cấp 72 - 76', drops: 'Kiếm Ý Đan', desc: 'Map cũ — đã gộp vào Battle Map 3.', badge: 'Thánh Địa Kiếm Đạo', tip: '', isBoss: false },
  'xanh-tu-nam': { key: 'xanh-tu-nam', name: 'Xanh Tử Nam', short: 'Xanh Tử', icon: '🌲', mul: 2.0, exp: 320, silver: 7000, gold: 2, builder: 'bamboo', legacy: true, aliasOf: 'bm1', boss: 'Thanh Tùng Đạo Nhân (Lv.75)', recLvl: 'Cấp 74 - 77', drops: 'Tùng Hạc Diên Niên Đan', desc: 'Map cũ — đã gộp vào Battle Map 1.', badge: 'Rừng Tùng Cổ Tự', tip: '', isBoss: false },
  'mon-quan': { key: 'mon-quan', name: 'Môn Quan', short: 'Môn Quan', icon: '🏰', mul: 2.8, exp: 520, silver: 12000, gold: 2, builder: 'city', legacy: true, aliasOf: 'bm3', boss: 'Trấn Quan Đại Tướng (Lv.76)', recLvl: 'Cấp 75 - 78', drops: 'Lệnh Bài Quân Công', desc: 'Map cũ — đã gộp vào Battle Map 3.', badge: 'Cửa Ải Yết Hầu', tip: '', isBoss: false },
  'thien-hoa-dan-dinh': { key: 'thien-hoa-dan-dinh', name: 'Thiên Hỏa Đỉnh', short: 'Thiên Hỏa', icon: '🔥', mul: 3.8, exp: 820, silver: 19500, gold: 3, builder: 'city', legacy: true, aliasOf: 'bm6', boss: 'Hỏa Kỳ Lân – Viêm Đế (Lv.78)', recLvl: 'Cấp 76+', drops: 'Thần Binh Hỏa Lân', desc: 'Map cũ — đã gộp vào Battle Map 6.', badge: 'Trọng Điểm Quyết Chiến', tip: '', isBoss: true }
};

/* Map id arena (kể cả id cũ trong save) sang key Battle Map 1..10 hiện hành. */
function resolveArenaKey(k) {
  const a = ARENAS[k];
  if (!a) return 'bm1';
  return a.aliasOf || k;
}

/* Dàn quái thường theo từng Battle Map (dùng trong spawnWave, đợt 1–2). */
const ARENA_ENEMIES = {
  bm1: [
    { name: 'Trúc Yêu', hp: 0.52, atk: 0.8, robe: 0x2f6b2a, hair: 0x1e3a1a, scale: 0.98 },
    { name: 'Ma Giáo Đồ', hp: 0.55, atk: 0.85, robe: 0x111827, hair: 0x94a3b8, scale: 1.0 },
    { name: 'Sơn Tặc Trúc Lâm', hp: 0.6, atk: 0.9, robe: 0x78350f, hair: 0x1e1b4b, scale: 1.02 }
  ],
  bm2: [
    { name: 'Anh Đào Yêu', hp: 0.55, atk: 0.85, robe: 0xbe185d, hair: 0xf9a8d4, scale: 0.98 },
    { name: 'Hộ Pháp Áo Trắng', hp: 0.58, atk: 0.72, robe: 0x312e81, hair: 0xf1f5f9, scale: 1.0 },
    { name: 'Tăng Nhân Sa Ngã', hp: 0.62, atk: 0.88, robe: 0x92400e, hair: 0x1e1b4b, scale: 1.02 }
  ],
  bm3: [
    { name: 'Ma Giáo Cao Thủ', hp: 0.58, atk: 0.9, robe: 0x111827, hair: 0x94a3b8, scale: 1.0 },
    { name: 'Tử Y Sát Thủ', hp: 0.52, atk: 0.88, robe: 0x581c87, hair: 0x1e1b4b, scale: 0.98 },
    { name: 'Độc Long Sứ Giả', hp: 0.6, atk: 0.78, robe: 0x065f46, hair: 0xd1d5db, scale: 1.02 }
  ],
  bm4: [
    { name: 'Tuyết Yêu', hp: 0.6, atk: 0.9, robe: 0xe0f2fe, hair: 0xbae6fd, scale: 0.98 },
    { name: 'Băng Lang', hp: 0.62, atk: 0.95, robe: 0x64748b, hair: 0xf1f5f9, scale: 1.05 },
    { name: 'Tuyết Sơn Cự Nhân', hp: 0.75, atk: 0.85, robe: 0x334155, hair: 0xe2e8f0, scale: 1.15 }
  ],
  bm5: [
    { name: 'Sa Tặc', hp: 0.62, atk: 0.92, robe: 0x92400e, hair: 0x451a03, scale: 1.0 },
    { name: 'Cát Yêu', hp: 0.6, atk: 0.9, robe: 0xd97706, hair: 0xfde68a, scale: 0.98 },
    { name: 'Bọ Cạp Khổng Lồ', hp: 0.7, atk: 0.95, robe: 0x78350f, hair: 0x1c1917, scale: 1.1 }
  ],
  bm6: [
    { name: 'Hỏa Ma', hp: 0.65, atk: 0.95, robe: 0x991b1b, hair: 0xf97316, scale: 1.0 },
    { name: 'Dung Nham Quái', hp: 0.72, atk: 0.9, robe: 0x7f1d1d, hair: 0xfb923c, scale: 1.08 },
    { name: 'Hỏa Diệm Sứ Giả', hp: 0.62, atk: 1.0, robe: 0xea580c, hair: 0xfef3c7, scale: 1.0 }
  ],
  bm7: [
    { name: 'Đầm Lầy Thủy Quái', hp: 0.68, atk: 0.92, robe: 0x14532d, hair: 0x4d7c0f, scale: 1.05 },
    { name: 'Độc Oa', hp: 0.6, atk: 0.95, robe: 0x3f6212, hair: 0xa3e635, scale: 0.95 },
    { name: 'Cây Khô Ma', hp: 0.78, atk: 0.85, robe: 0x44403c, hair: 0x292524, scale: 1.12 }
  ],
  bm8: [
    { name: 'Thiên Binh', hp: 0.68, atk: 0.95, robe: 0xca8a04, hair: 0x1e1b4b, scale: 1.0 },
    { name: 'Vân Hạc Tiên', hp: 0.62, atk: 0.9, robe: 0xf8fafc, hair: 0xe2e8f0, scale: 0.98 },
    { name: 'Kim Giáp Thần Tướng', hp: 0.8, atk: 0.95, robe: 0xa16207, hair: 0xfef08a, scale: 1.12 }
  ],
  bm9: [
    { name: 'Tiểu Quỷ', hp: 0.65, atk: 0.95, robe: 0x4c1d95, hair: 0x111827, scale: 0.95 },
    { name: 'Âm Hồn', hp: 0.62, atk: 1.0, robe: 0x1e1b4b, hair: 0xddd6fe, scale: 1.0 },
    { name: 'Quỷ Diện Tướng', hp: 0.82, atk: 0.95, robe: 0x7e22ce, hair: 0x0f172a, scale: 1.12 }
  ],
  bm10: [
    { name: 'Thủy Quái', hp: 0.7, atk: 0.95, robe: 0x155e75, hair: 0x164e63, scale: 1.05 },
    { name: 'Giao Long Con', hp: 0.75, atk: 1.0, robe: 0x0e7490, hair: 0x67e8f9, scale: 1.1 },
    { name: 'Biển Đông Thủy Binh', hp: 0.68, atk: 0.92, robe: 0x1d4ed8, hair: 0xbfdbfe, scale: 1.0 }
  ]
};

/* Boss riêng từng Battle Map — xuất hiện ở đợt 3 (kỹ năng ghi trong arena.bossSkill). */
const ARENA_BOSSES = {
  bm1: { name: 'Trúc Ma Lão Tổ', boss: true, hp: 2.0, atk: 1.4, robe: 0x14532d, hair: 0xd9f99d, scale: 1.3 },
  bm2: { name: 'Hộ Pháp Hắc Bạch', boss: true, hp: 2.1, atk: 1.45, robe: 0x312e81, hair: 0xf1f5f9, scale: 1.3 },
  bm3: { name: 'Ma Giáo Giáo Chủ', boss: true, hp: 2.2, atk: 1.5, robe: 0x7f1d1d, hair: 0x111827, scale: 1.35 },
  bm4: { name: 'Băng Tuyết Nữ Vương', boss: true, hp: 2.3, atk: 1.55, robe: 0xe0f2fe, hair: 0xf0f9ff, scale: 1.32 },
  bm5: { name: 'Sa Mạc Hoàng Đế', boss: true, hp: 2.4, atk: 1.6, robe: 0xb45309, hair: 0xfde68a, scale: 1.35 },
  bm6: { name: 'Hỏa Kỳ Lân – Viêm Đế', boss: true, hp: 2.5, atk: 1.65, robe: 0x991b1b, hair: 0xfdba74, scale: 1.38 },
  bm7: { name: 'Đầm Lầy Ma Quân', boss: true, hp: 2.6, atk: 1.7, robe: 0x14532d, hair: 0x365314, scale: 1.35 },
  bm8: { name: 'Thiên Đình Chiến Thần', boss: true, hp: 2.7, atk: 1.75, robe: 0xca8a04, hair: 0xfef9c3, scale: 1.38 },
  bm9: { name: 'Quỷ Vương Diêm La', boss: true, hp: 2.8, atk: 1.8, robe: 0x4c1d95, hair: 0x0f172a, scale: 1.4 },
  bm10: { name: 'Long Vương Biển Đông', boss: true, hp: 3.0, atk: 1.9, robe: 0x0e7490, hair: 0x22d3ee, scale: 1.45 }
};
/* ARENA10-END */

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
    weapon: 'Song Ma Thiết Quyền', armorName: 'Hắc Vân Võ Bào', accessory: 'Ngọc Bội Thanh Long',
    look: { gender: 'Nam', color: 'do', hair: 'bui-cao' }, sectDesc: ''
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
  flags: { tutorial: false, createdVia: '', event: { checkin: { lastDate: '', streak: 0, claimed: {} }, daily: {}, weekly: {}, seasonal: {}, boss: {}, arena: {}, redeem: {} } }
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
      if (d.flags) {
        Object.assign(State.flags, d.flags);
        // flags.event: hợp nhất từng nhánh để save cũ (không có event) không mất nhánh mặc định.
        if (d.flags.event && typeof d.flags.event === 'object') {
          const ev0 = { checkin: { lastDate: '', streak: 0, claimed: {} }, daily: {}, weekly: {}, seasonal: {}, boss: {}, arena: {}, redeem: {} };
          State.flags.event = Object.assign(ev0, d.flags.event);
          if (!State.flags.event.checkin || typeof State.flags.event.checkin !== 'object') State.flags.event.checkin = ev0.checkin;
          if (!State.flags.event.checkin.claimed || typeof State.flags.event.checkin.claimed !== 'object') State.flags.event.checkin.claimed = {};
        }
      }
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
