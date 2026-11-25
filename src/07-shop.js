/* ============================================================================
   SHOP — CHỢ BIỆN KINH (Shop.html)
   Trang chợ độc lập, tự chứa, chia sẻ đúng save localStorage v2 với game
   (SAVE_KEY 'mongvolam_soha_v1', xem src/01-data.js SaveManager).
   - Đọc/ghi NGUYÊN save JSON: chỉ đổi player (vàng/bạc/KNB, chỉ số) +
     inventory (túi đồ) + flags.shop (trạng thái chợ). Mọi field khác giữ nguyên.
   - Trạng thái chợ (kho theo giờ, gói đã nhận) cất trong flags.shop để
     SaveManager.save() của game không làm mất khi game lưu lại.
   - File này vừa chạy trong trình duyệt (Shop.html inline), vừa require()
     được trong Node để kiểm thử logic thuần (xem tools/test-shop.cjs).
   ========================================================================== */
'use strict';

/* SHOP-BEGIN */
const SHOP_SAVE_KEY = 'mongvolam_soha_v1';

const SHOP_TABS = [
  { id: 'than-binh', label: 'Thần Binh', icon: '⚔️' },
  { id: 'phong-cu', label: 'Phòng Cụ', icon: '🛡️' },
  { id: 'dan-duoc', label: 'Đan Dược', icon: '💊' },
  { id: 'da-ngoc', label: 'Đá · Ngọc', icon: '💎' },
  { id: 'bi-kip', label: 'Bí Kíp', icon: '📜' },
  { id: 'thoi-trang', label: 'Thời Trang', icon: '👘' },
  { id: 'thu-cung', label: 'Thú Cưng', icon: '🐾' },
  { id: 'goi', label: 'Gói 🎁', icon: '🎁' },
  { id: 'tui', label: 'Túi Đồ · Bán', icon: '🎒' }
];

const SHOP_RARITIES = ['Thường', 'Hiếm', 'Sử Thi', 'Truyền Thuyết'];
const SHOP_RARITY_CLASS = { 'Thường': 'r-common', 'Hiếm': 'r-rare', 'Sử Thi': 'r-epic', 'Truyền Thuyết': 'r-legend' };

/* Mỗi món: effect.kind —
   'atk'/'def' : +chỉ số vĩnh viễn ngay khi mua + vào túi đồ (bán lại trừ chỉ số).
   'heal'      : hồi Sinh Lực ngay (value số HP, hoặc 'full' = hồi đầy).
   'maxmp'     : +Nội Lực tối đa ngay. 'maxhp': +Sinh Lực tối đa ngay.
   'exp'       : +Kinh Nghiệm ngay (lên cấp theo đúng công thức game).
   'full'      : hồi đầy Sinh Lực + Nội Lực ngay.
   'cultivate' : bồi dưỡng đệ tử đội trưởng +1 cấp ngay.
   'item'      : chỉ vào túi đồ, dùng/xem trong game (Hành Trang). */
const SHOP_CATALOG = [
  /* ---- Thần Binh (12) ---- */
  { id: 'tb01', tab: 'than-binh', name: 'Thiết Kiếm Giang Hồ', icon: '⚔️', rarity: 'Thường', stat: 'Công +12', price: 800, cur: 'silver', desc: 'Kiếm sắt rèn tay, bén vừa đủ hành tẩu giang hồ.', effect: { kind: 'atk', value: 12 } },
  { id: 'tb02', tab: 'than-binh', name: 'Thanh Phong Kiếm', icon: '🗡️', rarity: 'Thường', stat: 'Công +18', price: 1500, cur: 'silver', desc: 'Kiếm nhẹ như gió, ra chiêu nhanh như chớp.', effect: { kind: 'atk', value: 18 } },
  { id: 'tb03', tab: 'than-binh', name: 'Huyết Ẩm Đao', icon: '🔪', rarity: 'Hiếm', stat: 'Công +35', price: 5200, cur: 'silver', desc: 'Đao uống máu, càng đánh càng hung.', effect: { kind: 'atk', value: 35 } },
  { id: 'tb04', tab: 'than-binh', name: 'Tuyết Ẩm Cuồng Đao', icon: '❄️', rarity: 'Hiếm', stat: 'Công +48', price: 9800, cur: 'silver', desc: 'Cuồng đao lạnh như tuyết, chém đâu đóng băng đó.', effect: { kind: 'atk', value: 48 } },
  { id: 'tb05', tab: 'than-binh', name: 'Tuyệt Thế Hảo Kiếm', icon: '🗡️', rarity: 'Sử Thi', stat: 'Công +90', price: 32000, cur: 'silver', desc: 'Hảo kiếm ngàn năm có một, kiếm khí tự sinh.', effect: { kind: 'atk', value: 90 } },
  { id: 'tb06', tab: 'than-binh', name: 'Thiên Kiếp Đao', icon: '⚡', rarity: 'Truyền Thuyết', stat: 'Công +180', price: 120, cur: 'gold', desc: 'Đao mang thiên kiếp, một chém xé trời.', effect: { kind: 'atk', value: 180 } },
  { id: 'tb07', tab: 'than-binh', name: 'Vô Song Thần Kiếm', icon: '🌟', rarity: 'Truyền Thuyết', stat: 'Công +220', price: 180, cur: 'gold', desc: 'Thần kiếm vô song, thiên hạ chỉ một thanh.', effect: { kind: 'atk', value: 220 } },
  { id: 'tb08', tab: 'than-binh', name: 'Huyền Thiết Trọng Kiếm', icon: '🔨', rarity: 'Sử Thi', stat: 'Công +110', price: 45000, cur: 'silver', desc: 'Trọng kiếm huyền thiết, nặng mà uy mãnh.', effect: { kind: 'atk', value: 110 } },
  { id: 'tb09', tab: 'than-binh', name: 'Quỳ Hoa Tú Hoa Châm', icon: '🪡', rarity: 'Hiếm', stat: 'Công +55', price: 12000, cur: 'silver', desc: 'Châm nhỏ mà nhanh hơn mắt thường thấy được.', effect: { kind: 'atk', value: 55 } },
  { id: 'tb10', tab: 'than-binh', name: 'Ngọc Nữ Tố Tâm Kiếm', icon: '💠', rarity: 'Sử Thi', stat: 'Công +95', price: 38000, cur: 'silver', desc: 'Kiếm của Ngọc Nữ Cổ Mộ, lạnh mà tình.', effect: { kind: 'atk', value: 95 } },
  { id: 'tb11', tab: 'than-binh', name: 'Hoa Sơn Trường Kiếm', icon: '🍃', rarity: 'Thường', stat: 'Công +22', price: 2400, cur: 'silver', desc: 'Trường kiếm Hoa Sơn, phóng khoáng tự tại.', effect: { kind: 'atk', value: 22 } },
  { id: 'tb12', tab: 'than-binh', name: 'Độc Cô Huyền Kiếm', icon: '🖤', rarity: 'Truyền Thuyết', stat: 'Công +260', price: 260, cur: 'gold', desc: 'Kiếm của Kiếm Ma, vô kiếm thắng hữu kiếm.', effect: { kind: 'atk', value: 260 } },
  /* ---- Phòng Cụ (12) ---- */
  { id: 'pc01', tab: 'phong-cu', name: 'Hắc Vân Võ Bào', icon: '👘', rarity: 'Thường', stat: 'Thủ +10', price: 700, cur: 'silver', desc: 'Võ bào đen vân mây, nhẹ mà bền.', effect: { kind: 'def', value: 10 } },
  { id: 'pc02', tab: 'phong-cu', name: 'Thanh Vân Đạo Bào', icon: '🥋', rarity: 'Thường', stat: 'Thủ +16', price: 1400, cur: 'silver', desc: 'Đạo bào xanh mây, đạo cốt tiên phong.', effect: { kind: 'def', value: 16 } },
  { id: 'pc03', tab: 'phong-cu', name: 'Bạch Hổ Chiến Giáp', icon: '🛡️', rarity: 'Hiếm', stat: 'Thủ +30', price: 6800, cur: 'silver', desc: 'Chiến giáp Bạch Hổ, cứng như thép.', effect: { kind: 'def', value: 30 } },
  { id: 'pc04', tab: 'phong-cu', name: 'Huyền Âm Bào', icon: '🌙', rarity: 'Hiếm', stat: 'Thủ +42', price: 11000, cur: 'silver', desc: 'Bào huyền âm, hấp thu sát khí.', effect: { kind: 'def', value: 42 } },
  { id: 'pc05', tab: 'phong-cu', name: 'Thiên Kim Hoàng Bào', icon: '👑', rarity: 'Sử Thi', stat: 'Thủ +80', price: 36000, cur: 'silver', desc: 'Hoàng bào thiên kim, chỉ bậc đế vương mới mặc.', effect: { kind: 'def', value: 80 } },
  { id: 'pc06', tab: 'phong-cu', name: 'Long Văn Bảo Giáp', icon: '🐉', rarity: 'Truyền Thuyết', stat: 'Thủ +150', price: 150, cur: 'gold', desc: 'Bảo giáp văn rồng, đao thương bất nhập.', effect: { kind: 'def', value: 150 } },
  { id: 'pc07', tab: 'phong-cu', name: 'Thiên Vũ Mão', icon: '🎩', rarity: 'Sử Thi', stat: 'Thủ +70', price: 30000, cur: 'silver', desc: 'Mão thiên vũ, đội lên khí thế ngút trời.', effect: { kind: 'def', value: 70 } },
  { id: 'pc08', tab: 'phong-cu', name: 'Bất Khốc Diện Cụ', icon: '🎭', rarity: 'Hiếm', stat: 'Thủ +38', price: 9500, cur: 'silver', desc: 'Diện cụ bất khốc, lạnh lùng mà uy nghiêm.', effect: { kind: 'def', value: 38 } },
  { id: 'pc09', tab: 'phong-cu', name: 'Thánh Nữ Vân Y', icon: '👗', rarity: 'Hiếm', stat: 'Thủ +45', price: 12500, cur: 'silver', desc: 'Vân y thánh nữ, mềm như mây mà bền như thép.', effect: { kind: 'def', value: 45 } },
  { id: 'pc10', tab: 'phong-cu', name: 'Quỳ Hoa Bảo Y', icon: '🌸', rarity: 'Sử Thi', stat: 'Thủ +85', price: 40000, cur: 'silver', desc: 'Bảo y quỳ hoa, nhanh nhẹn tuyệt luân.', effect: { kind: 'def', value: 85 } },
  { id: 'pc11', tab: 'phong-cu', name: 'Ngọc Bội Thanh Long', icon: '📿', rarity: 'Thường', stat: 'Thủ +14', price: 1800, cur: 'silver', desc: 'Ngọc bội thanh long, hộ thân trừ tà.', effect: { kind: 'def', value: 14 } },
  { id: 'pc12', tab: 'phong-cu', name: 'Thiên Vũ Giới Chỉ', icon: '💍', rarity: 'Truyền Thuyết', stat: 'Thủ +130', price: 130, cur: 'gold', desc: 'Giới chỉ thiên vũ, linh khí hội tụ.', effect: { kind: 'def', value: 130 } },
  /* ---- Đan Dược (12) — dùng ngay khi mua, không vào túi ---- */
  { id: 'dd01', tab: 'dan-duoc', name: 'Kim Sáng Dược', icon: '🧪', rarity: 'Thường', stat: 'Dùng ngay: Hồi 200 Sinh Lực', price: 150, cur: 'silver', desc: 'Thuốc trị thương thông dụng của giang hồ.', effect: { kind: 'heal', value: 200 } },
  { id: 'dd02', tab: 'dan-duoc', name: 'Tụ Khí Đan', icon: '💊', rarity: 'Thường', stat: 'Dùng ngay: +30 Kinh Nghiệm', price: 300, cur: 'silver', desc: 'Đan tụ khí, tăng tiến tu vi.', effect: { kind: 'exp', value: 30 } },
  { id: 'dd03', tab: 'dan-duoc', name: 'Bánh Bao Thịt Nóng', icon: '🥟', rarity: 'Thường', stat: 'Dùng ngay: Hồi đầy Sinh Lực', price: 150, cur: 'silver', desc: 'Bánh bao nóng hổi, ăn xong khỏe như trâu.', effect: { kind: 'heal', value: 'full' } },
  { id: 'dd04', tab: 'dan-duoc', name: 'Ngọc Lộ Hoàn', icon: '💧', rarity: 'Hiếm', stat: 'Dùng ngay: +120 Nội Lực tối đa', price: 900, cur: 'silver', desc: 'Ngọc lộ thanh khiết, bồi bổ nội lực.', effect: { kind: 'maxmp', value: 120 } },
  { id: 'dd05', tab: 'dan-duoc', name: 'Tụ Khí Đan Thượng Hạng', icon: '💊', rarity: 'Hiếm', stat: 'Dùng ngay: +60 Kinh Nghiệm', price: 1400, cur: 'silver', desc: 'Đan thượng hạng, dược lực gấp đôi.', effect: { kind: 'exp', value: 60 } },
  { id: 'dd06', tab: 'dan-duoc', name: 'Cửu Chuyển Kim Đan', icon: '🔮', rarity: 'Sử Thi', stat: 'Dùng ngay: +300 Kinh Nghiệm', price: 9000, cur: 'silver', desc: 'Kim đan cửu chuyển, luyện chín lần mới thành.', effect: { kind: 'exp', value: 300 } },
  { id: 'dd07', tab: 'dan-duoc', name: 'Huyết Bồ Đề', icon: '🍒', rarity: 'Hiếm', stat: 'Dùng ngay: +300 Sinh Lực tối đa', price: 4200, cur: 'silver', desc: 'Quả bồ đề đỏ như máu, tăng cường khí huyết.', effect: { kind: 'maxhp', value: 300 } },
  { id: 'dd08', tab: 'dan-duoc', name: 'Thập Toàn Đại Bổ Hoàn', icon: '🍲', rarity: 'Sử Thi', stat: 'Dùng ngay: Hồi đầy Sinh Lực + Nội Lực', price: 5200, cur: 'silver', desc: 'Đại bổ hoàn, mười vị quý hiếm hợp thành.', effect: { kind: 'full', value: 0 } },
  { id: 'dd09', tab: 'dan-duoc', name: 'Bồi Dưỡng Đan', icon: '🧧', rarity: 'Hiếm', stat: 'Dùng ngay: Đệ tử đội trưởng +1 cấp', price: 2500, cur: 'silver', desc: 'Đan bồi dưỡng, đệ tử đội trưởng tăng một cấp.', effect: { kind: 'cultivate', value: 1 } },
  { id: 'dd10', tab: 'dan-duoc', name: 'Long Nguyên Đan', icon: '🐲', rarity: 'Truyền Thuyết', stat: 'Dùng ngay: +1000 Kinh Nghiệm', price: 60, cur: 'gold', desc: 'Đan luyện từ long nguyên, tu vi tăng vọt.', effect: { kind: 'exp', value: 1000 } },
  { id: 'dd11', tab: 'dan-duoc', name: 'Thiên Sơn Tuyết Liên', icon: '🌸', rarity: 'Sử Thi', stat: 'Dùng ngay: +800 Sinh Lực tối đa', price: 15000, cur: 'silver', desc: 'Tuyết liên Thiên Sơn, trăm năm mới nở một lần.', effect: { kind: 'maxhp', value: 800 } },
  { id: 'dd12', tab: 'dan-duoc', name: 'Hồi Thiên Đan', icon: '✨', rarity: 'Hiếm', stat: 'Dùng ngay: Hồi đầy Sinh Lực', price: 2200, cur: 'silver', desc: 'Đan hồi thiên, kéo người từ quỷ môn quan về.', effect: { kind: 'heal', value: 'full' } },
  /* ---- Đá Cường Hóa / Ngọc (10) — vào túi đồ ---- */
  { id: 'dn01', tab: 'da-ngoc', name: 'Huyền Thiết Tinh', icon: '💎', rarity: 'Thường', stat: 'Vào túi: Nguyên liệu rèn', price: 500, cur: 'silver', desc: 'Tinh thể huyền thiết, dùng để rèn trang bị.', effect: { kind: 'item', value: 0 } },
  { id: 'dn02', tab: 'da-ngoc', name: 'Đá Cường Hóa Sơ Cấp', icon: '🔶', rarity: 'Thường', stat: 'Vào túi: Cường hóa +1 ~ +3', price: 800, cur: 'silver', desc: 'Đá cường hóa sơ cấp cho trang bị mới.', effect: { kind: 'item', value: 0 } },
  { id: 'dn03', tab: 'da-ngoc', name: 'Đá Cường Hóa Trung Cấp', icon: '🔷', rarity: 'Hiếm', stat: 'Vào túi: Cường hóa +4 ~ +6', price: 2400, cur: 'silver', desc: 'Đá cường hóa trung cấp, ánh xanh lấp lánh.', effect: { kind: 'item', value: 0 } },
  { id: 'dn04', tab: 'da-ngoc', name: 'Đá Cường Hóa Cao Cấp', icon: '🟣', rarity: 'Sử Thi', stat: 'Vào túi: Cường hóa +7 ~ +9', price: 8000, cur: 'silver', desc: 'Đá cường hóa cao cấp, linh khí ngút trời.', effect: { kind: 'item', value: 0 } },
  { id: 'dn05', tab: 'da-ngoc', name: 'Ngọc Bội Linh Thạch', icon: '💠', rarity: 'Hiếm', stat: 'Vào túi: Khảm tăng Khí', price: 3600, cur: 'silver', desc: 'Linh thạch khảm trang bị, tăng khí huyết.', effect: { kind: 'item', value: 0 } },
  { id: 'dn06', tab: 'da-ngoc', name: 'Hỏa Lân Tinh Thạch', icon: '🔥', rarity: 'Sử Thi', stat: 'Vào túi: Rèn thần binh hệ Hỏa', price: 12000, cur: 'silver', desc: 'Tinh thạch lửa kỳ lân, nóng rực tay.', effect: { kind: 'item', value: 0 } },
  { id: 'dn07', tab: 'da-ngoc', name: 'Băng Tâm Ngọc', icon: '❄️', rarity: 'Sử Thi', stat: 'Vào túi: Rèn thần binh hệ Băng', price: 12000, cur: 'silver', desc: 'Ngọc băng tâm, lạnh thấu xương.', effect: { kind: 'item', value: 0 } },
  { id: 'dn08', tab: 'da-ngoc', name: 'Thiên Ngoại Vẫn Thiết', icon: '☄️', rarity: 'Truyền Thuyết', stat: 'Vào túi: Rèn thần binh truyền thuyết', price: 90, cur: 'gold', desc: 'Vẫn thiết ngoài trời, ngàn năm khó gặp.', effect: { kind: 'item', value: 0 } },
  { id: 'dn09', tab: 'da-ngoc', name: 'Linh Thạch Thượng Phẩm', icon: '🔷', rarity: 'Hiếm', stat: 'Vào túi: Nguyên liệu quý', price: 5000, cur: 'silver', desc: 'Linh thạch thượng phẩm, thợ rèn nào cũng muốn.', effect: { kind: 'item', value: 0 } },
  { id: 'dn10', tab: 'da-ngoc', name: 'Kim Cương Toái Phiến', icon: '💎', rarity: 'Truyền Thuyết', stat: 'Vào túi: Cường hóa +10', price: 200, cur: 'gold', desc: 'Mảnh kim cương vỡ, cứng nhất thiên hạ.', effect: { kind: 'item', value: 0 } },
  /* ---- Bí Kíp (10) — vào túi đồ ---- */
  { id: 'bk01', tab: 'bi-kip', name: 'Hoa Sơn Kiếm Pháp', icon: '📜', rarity: 'Thường', stat: 'Vào túi: Bí kíp kiếm pháp', price: 2000, cur: 'silver', desc: 'Kiếm pháp Hoa Sơn, phóng khoáng tự tại.', effect: { kind: 'item', value: 0 } },
  { id: 'bk02', tab: 'bi-kip', name: 'Hằng Sơn Tâm Pháp', icon: '📜', rarity: 'Thường', stat: 'Vào túi: Bí kíp nội công', price: 2000, cur: 'silver', desc: 'Tâm pháp Hằng Sơn, thanh tâm tĩnh khí.', effect: { kind: 'item', value: 0 } },
  { id: 'bk03', tab: 'bi-kip', name: 'Phong Thần Thối', icon: '📖', rarity: 'Hiếm', stat: 'Vào túi: Khinh công tuyệt học', price: 8000, cur: 'silver', desc: 'Thối pháp nhanh như gió, đi không để dấu.', effect: { kind: 'item', value: 0 } },
  { id: 'bk04', tab: 'bi-kip', name: 'Bài Vân Chưởng', icon: '📖', rarity: 'Hiếm', stat: 'Vào túi: Chưởng pháp', price: 8500, cur: 'silver', desc: 'Chưởng pháp như mây bay, mềm mà mạnh.', effect: { kind: 'item', value: 0 } },
  { id: 'bk05', tab: 'bi-kip', name: 'Độc Cô Cửu Kiếm', icon: '📚', rarity: 'Sử Thi', stat: 'Vào túi: Kiếm pháp vô địch', price: 30000, cur: 'silver', desc: 'Cửu kiếm phá hết thiên hạ kiếm pháp.', effect: { kind: 'item', value: 0 } },
  { id: 'bk06', tab: 'bi-kip', name: 'Quỳ Hoa Bảo Điển', icon: '📚', rarity: 'Sử Thi', stat: 'Vào túi: Bảo điển tốc độ', price: 32000, cur: 'silver', desc: 'Bảo điển Quỳ Hoa, nhanh đến xuất thần.', effect: { kind: 'item', value: 0 } },
  { id: 'bk07', tab: 'bi-kip', name: 'Cửu Dương Thần Công', icon: '📚', rarity: 'Truyền Thuyết', stat: 'Vào túi: Nội công chí tôn', price: 150, cur: 'gold', desc: 'Thần công Cửu Dương, nội lực vô biên.', effect: { kind: 'item', value: 0 } },
  { id: 'bk08', tab: 'bi-kip', name: 'Ám Nhiên Tiêu Hồn Chưởng', icon: '📖', rarity: 'Sử Thi', stat: 'Vào túi: Chưởng pháp Cổ Mộ', price: 28000, cur: 'silver', desc: 'Chưởng pháp Ám Nhiên, buồn mà mạnh.', effect: { kind: 'item', value: 0 } },
  { id: 'bk09', tab: 'bi-kip', name: 'Ngọc Nữ Tâm Kinh', icon: '📖', rarity: 'Hiếm', stat: 'Vào túi: Tâm kinh Cổ Mộ', price: 9000, cur: 'silver', desc: 'Tâm kinh Ngọc Nữ, lạnh lùng mà trọng tình.', effect: { kind: 'item', value: 0 } },
  { id: 'bk10', tab: 'bi-kip', name: 'Tiếu Ngạo Giang Hồ Khúc', icon: '🎵', rarity: 'Hiếm', stat: 'Vào túi: Cầm nghệ tuyệt thế', price: 7500, cur: 'silver', desc: 'Một khúc tiếu ngạo, vang danh thiên hạ.', effect: { kind: 'item', value: 0 } },
  /* ---- Thời Trang (8) — vào túi đồ ---- */
  { id: 'tt01', tab: 'thoi-trang', name: 'Thanh Vân Đạo Bào', icon: '👘', rarity: 'Hiếm', stat: 'Vào túi: Ngoại trang', price: 6000, cur: 'silver', desc: 'Đạo bào xanh mây, mặc vào tiên phong đạo cốt.', effect: { kind: 'item', value: 0 } },
  { id: 'tt02', tab: 'thoi-trang', name: 'Thánh Cô Hồng Y', icon: '👗', rarity: 'Sử Thi', stat: 'Vào túi: Ngoại trang', price: 18000, cur: 'silver', desc: 'Hồng y thánh cô, diễm lệ tuyệt luân.', effect: { kind: 'item', value: 0 } },
  { id: 'tt03', tab: 'thoi-trang', name: 'Cổ Mộ Bạch Y', icon: '👘', rarity: 'Sử Thi', stat: 'Vào túi: Ngoại trang', price: 18000, cur: 'silver', desc: 'Bạch y Cổ Mộ, thanh khiết thoát tục.', effect: { kind: 'item', value: 0 } },
  { id: 'tt04', tab: 'thoi-trang', name: 'Tiêu Dao Ngọc Quan', icon: '🎩', rarity: 'Hiếm', stat: 'Vào túi: Ngoại trang', price: 7000, cur: 'silver', desc: 'Ngọc quan tiêu dao, đội lên phong lưu.', effect: { kind: 'item', value: 0 } },
  { id: 'tt05', tab: 'thoi-trang', name: 'Thiên Vũ Mão', icon: '👑', rarity: 'Truyền Thuyết', stat: 'Vào túi: Ngoại trang', price: 80, cur: 'gold', desc: 'Mão thiên vũ lộng lẫy, chỉ bậc chí tôn.', effect: { kind: 'item', value: 0 } },
  { id: 'tt06', tab: 'thoi-trang', name: 'Hắc Kim Chiến Giáp', icon: '🛡️', rarity: 'Sử Thi', stat: 'Vào túi: Ngoại trang', price: 22000, cur: 'silver', desc: 'Chiến giáp hắc kim, oai phong lẫm liệt.', effect: { kind: 'item', value: 0 } },
  { id: 'tt07', tab: 'thoi-trang', name: 'Túy Tiên Hồ Lô', icon: '🍶', rarity: 'Hiếm', stat: 'Vào túi: Phụ kiện', price: 4500, cur: 'silver', desc: 'Hồ lô rượu tiên, đeo bên hông cho oai.', effect: { kind: 'item', value: 0 } },
  { id: 'tt08', tab: 'thoi-trang', name: 'Phượng Hoàng Vũ Y', icon: '🦚', rarity: 'Truyền Thuyết', stat: 'Vào túi: Ngoại trang', price: 120, cur: 'gold', desc: 'Vũ y phượng hoàng, rực rỡ như lửa.', effect: { kind: 'item', value: 0 } },
  /* ---- Thú Cưng & Linh Tinh (8) — vào túi đồ ---- */
  { id: 'tc01', tab: 'thu-cung', name: 'Trứng Hỏa Kỳ Lân', icon: '🥚', rarity: 'Truyền Thuyết', stat: 'Vào túi: Thú cưng', price: 200, cur: 'gold', desc: 'Trứng kỳ lân lửa, nở ra là thần thú.', effect: { kind: 'item', value: 0 } },
  { id: 'tc02', tab: 'thu-cung', name: 'Trứng Thần Điêu', icon: '🥚', rarity: 'Sử Thi', stat: 'Vào túi: Thú cưng', price: 40000, cur: 'silver', desc: 'Trứng thần điêu, bạn đồng hành trung thành.', effect: { kind: 'item', value: 0 } },
  { id: 'tc03', tab: 'thu-cung', name: 'Tiểu Bạch Hồ', icon: '🦊', rarity: 'Hiếm', stat: 'Vào túi: Thú cưng', price: 15000, cur: 'silver', desc: 'Tiểu bạch hồ lanh lợi, thích theo chân chủ.', effect: { kind: 'item', value: 0 } },
  { id: 'tc04', tab: 'thu-cung', name: 'Thức Ăn Linh Thú', icon: '🍖', rarity: 'Thường', stat: 'Vào túi: Cho thú cưng ăn', price: 600, cur: 'silver', desc: 'Thức ăn linh thú, thơm ngon bổ dưỡng.', effect: { kind: 'item', value: 0 } },
  { id: 'tc05', tab: 'thu-cung', name: 'Dây Cương Thần Mã', icon: '🐴', rarity: 'Hiếm', stat: 'Vào túi: Tọa kỵ', price: 9000, cur: 'silver', desc: 'Dây cương thần mã, cưỡi ngựa như bay.', effect: { kind: 'item', value: 0 } },
  { id: 'tc06', tab: 'thu-cung', name: 'Lồng Đèn Lồng', icon: '🏮', rarity: 'Thường', stat: 'Vào túi: Trang trí', price: 800, cur: 'silver', desc: 'Đèn lồng đỏ treo trước cửa cho may mắn.', effect: { kind: 'item', value: 0 } },
  { id: 'tc07', tab: 'thu-cung', name: 'Bản Đồ Kho Báu', icon: '🗺️', rarity: 'Sử Thi', stat: 'Vào túi: Mở kho báu', price: 25000, cur: 'silver', desc: 'Bản đồ kho báu, theo dấu sẽ thấy vàng.', effect: { kind: 'item', value: 0 } },
  { id: 'tc08', tab: 'thu-cung', name: 'Lệnh Bài Biện Kinh', icon: '🎟️', rarity: 'Hiếm', stat: 'Vào túi: Thông hành', price: 3000, cur: 'silver', desc: 'Lệnh bài thông hành khắp Biện Kinh Thành.', effect: { kind: 'item', value: 0 } },
  /* INTERACT-BEGIN — Mồi Câu cho mini-game câu cá hồ sen (mỗi lần câu tốn 1 mồi). */
  { id: 'tc09', tab: 'thu-cung', name: 'Mồi Câu', icon: '🪱', rarity: 'Thường', stat: 'Vào túi: Câu cá hồ sen', price: 50, cur: 'silver', desc: 'Mồi câu cá hồ sen — mỗi lần câu tốn 1 mồi. Nhận 5 mồi miễn phí mỗi ngày game.', effect: { kind: 'item', value: 0 } }
];

/* Gói khuyến mãi: limit 'once' = mỗi người 1 lần, 'daily' = 1 lần/ngày.
   Vật phẩm trong gói vào túi đồ (kể cả đan dược — để dùng trong game qua
   Hành Trang, vì Kim Sáng Dược / Tụ Khí Đan dùng được từ túi đồ). */
const SHOP_BUNDLES = [
  {
    id: 'goi-tanthu', name: 'Gói Tân Thủ', icon: '🎁', price: 1000, cur: 'silver', limit: 'once',
    desc: 'Dành cho thiếu hiệp mới vào giang hồ — chỉ mua 1 lần.',
    bonus: { silver: 5000 },
    items: [
      { name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', qty: 5 },
      { name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 3 },
      { name: 'Đá Cường Hóa Sơ Cấp', icon: '🔶', type: 'Nguyên liệu', desc: 'Cường hóa +1 ~ +3', qty: 2 }
    ]
  },
  {
    id: 'goi-daihiep', name: 'Gói Đại Hiệp', icon: '🎁', price: 99, cur: 'gold', limit: 'once',
    desc: 'Trang bị khởi đầu cho đại hiệp — chỉ mua 1 lần.',
    bonus: { silver: 10000 },
    items: [
      { name: 'Huyền Thiết Tinh', icon: '💎', type: 'Nguyên liệu', desc: 'Rèn trang bị', qty: 5 },
      { name: 'Đá Cường Hóa Trung Cấp', icon: '🔷', type: 'Nguyên liệu', desc: 'Cường hóa +4 ~ +6', qty: 3 },
      { name: 'Hoa Sơn Kiếm Pháp', icon: '📜', type: 'Bí kíp', desc: 'Bí kíp kiếm pháp', qty: 1 }
    ]
  },
  {
    id: 'goi-ngay', name: 'Gói Phúc Lợi Ngày', icon: '🎁', price: 500, cur: 'silver', limit: 'daily',
    desc: 'Mỗi ngày mua 1 lần — quà nhỏ mà vui.',
    bonus: { silver: 2000 },
    items: [
      { name: 'Tụ Khí Đan', icon: '💊', type: 'Đan dược', desc: '+30 Kinh Nghiệm', qty: 1 },
      { name: 'Kim Sáng Dược', icon: '🧪', type: 'Đan dược', desc: 'Hồi 200 Sinh Lực', qty: 2 }
    ]
  },
  {
    id: 'goi-chiton', name: 'Gói Chí Tôn', icon: '🎁', price: 299, cur: 'gold', limit: 'once',
    desc: 'Gói lớn nhất chợ — chỉ mua 1 lần, đồ xịn đầy túi.',
    bonus: { silver: 30000 },
    items: [
      { name: 'Đá Cường Hóa Cao Cấp', icon: '🟣', type: 'Nguyên liệu', desc: 'Cường hóa +7 ~ +9', qty: 2 },
      { name: 'Thiên Ngoại Vẫn Thiết', icon: '☄️', type: 'Nguyên liệu', desc: 'Rèn thần binh truyền thuyết', qty: 1 },
      { name: 'Cửu Chuyển Kim Đan', icon: '🔮', type: 'Đan dược', desc: '+300 Kinh Nghiệm', qty: 1 }
    ]
  }
];

/* Giá bán lại cho vật phẩm KHÔNG có trong catalogue (đồ mặc định của game). */
const SHOP_SELL_FALLBACK = {
  'Kim Sáng Dược': { price: 75, cur: 'silver' },
  'Tụ Khí Đan': { price: 150, cur: 'silver' },
  'Huyền Thiết Tinh': { price: 250, cur: 'silver' },
  /* INTERACT-BEGIN — đồ câu cá/hái sen/bắt bướm bán lại ở chợ. */
  'Cá Chép Thường': { price: 150, cur: 'silver' },
  'Cá Chép Hiếm': { price: 500, cur: 'silver' },
  'Cá Chép Vàng': { price: 2000, cur: 'silver' },
  'Hạt Sen': { price: 120, cur: 'silver' },
  'Lá Sen': { price: 60, cur: 'silver' },
  'Cánh Bướm': { price: 300, cur: 'silver' }
};

/* ============================== LOGIC THUẦN (test được bằng Node) ============================== */

function shopFmt(n) {
  n = Number(n) || 0;
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function shopEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function shopFindItem(id) {
  for (var i = 0; i < SHOP_CATALOG.length; i++) if (SHOP_CATALOG[i].id === id) return SHOP_CATALOG[i];
  return null;
}
function shopTabLabel(tabId) {
  for (var i = 0; i < SHOP_TABS.length; i++) if (SHOP_TABS[i].id === tabId) return SHOP_TABS[i].label;
  return tabId;
}
/* Băm FNV-1a — chọn kho theo giờ một cách xác định (cùng giờ -> cùng kho). */
function shopHash(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function shopHourKey(nowMs) { return new Date(nowMs).toISOString().slice(0, 13); } /* YYYY-MM-DDTHH (UTC) */
function shopDayKey(nowMs) { return new Date(nowMs).toISOString().slice(0, 10); } /* YYYY-MM-DD (UTC) */

/* Làm mới kho theo mốc giờ: 6 món Sử Thi/Truyền Thuyết ngẫu nhiên (theo giờ)
   + giảm giá 10/15/20%. Đổi kho khi qua mốc giờ, ghi timestamp vào save. */
function shopRefreshStock(shopState, nowMs) {
  shopState = shopState || {};
  var hourKey = shopHourKey(nowMs);
  if (shopState.hourKey === hourKey && Array.isArray(shopState.featured) && shopState.featured.length) {
    return { changed: false, state: shopState };
  }
  var pool = SHOP_CATALOG.filter(function (it) { return it.rarity === 'Sử Thi' || it.rarity === 'Truyền Thuyết'; });
  var scored = pool.map(function (it) { return { id: it.id, k: shopHash(hourKey + ':' + it.id) }; });
  scored.sort(function (a, b) { return a.k - b.k; });
  shopState.hourKey = hourKey;
  shopState.dayKey = shopDayKey(nowMs);
  shopState.featured = scored.slice(0, 6).map(function (o) { return o.id; });
  shopState.discount = [10, 15, 20][shopHash(hourKey) % 3];
  shopState.stockAt = nowMs;
  return { changed: true, state: shopState };
}
function shopIsFeatured(itemId, shopState) {
  return !!(shopState && Array.isArray(shopState.featured) && shopState.featured.indexOf(itemId) >= 0);
}
function shopEffectivePrice(item, shopState) {
  if (shopIsFeatured(item.id, shopState) && shopState.discount) {
    return Math.max(1, Math.floor(item.price * (100 - shopState.discount) / 100));
  }
  return item.price;
}
function shopPriceLabel(item, shopState) {
  var unit = shopEffectivePrice(item, shopState);
  var cur = item.cur === 'gold' ? 'KNB' : 'bạc';
  if (unit !== item.price) return shopFmt(unit) + ' ' + cur + ' (gốc ' + shopFmt(item.price) + ')';
  return shopFmt(unit) + ' ' + cur;
}

/* Save mặc định — khớp số mặc định của game (src/01-data.js State.player). */
function shopDefaultSave() {
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
    flags: { tutorial: false, shop: {} },
    v: 2
  };
}
function shopEnsureShopState(save) {
  save.flags = save.flags || {};
  save.flags.shop = save.flags.shop || {};
  return save.flags.shop;
}
/* Đọc save thật từ localStorage (chỉ chạy ở trình duyệt). Trả về object save
   đầy đủ — giữ nguyên mọi field game đã lưu, chỉ chuẩn hóa tiền/túi đồ. */
function shopLoadSave() {
  try {
    if (typeof localStorage === 'undefined') return shopDefaultSave();
    var raw = localStorage.getItem(SHOP_SAVE_KEY);
    if (!raw) return shopDefaultSave();
    var d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !d.player) return shopDefaultSave();
    d.player.gold = Math.max(0, Math.floor(Number(d.player.gold) || 0));
    d.player.silver = Math.max(0, Math.floor(Number(d.player.silver) || 0));
    if (!Array.isArray(d.inventory)) d.inventory = [];
    d.flags = d.flags || {};
    return d;
  } catch (e) { return shopDefaultSave(); }
}
function shopPersist(save) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SHOP_SAVE_KEY, JSON.stringify(save));
  } catch (e) {}
}
function shopAddToBag(save, name, icon, type, desc, qty) {
  save.inventory = save.inventory || [];
  var found = null;
  for (var i = 0; i < save.inventory.length; i++) if (save.inventory[i].name === name) { found = save.inventory[i]; break; }
  if (found) found.qty += (qty || 1);
  else save.inventory.push({ id: 'shop-' + Date.now() + '-' + Math.floor(Math.random() * 9999), name: name, icon: icon, type: type, desc: desc, qty: qty || 1 });
}
/* Tăng EXP theo đúng công thức game (src/01-data.js gainExp). */
function shopGainExp(save, amount) {
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
function shopCultivate(save) {
  var hs = save.heroes && save.heroes[save.leader || 0];
  if (!hs) return false;
  hs.level += 1;
  hs.bonus = hs.bonus || { hp: 0, atk: 0, def: 0, qi: 0, crit: 0 };
  hs.bonus.hp += 125000; hs.bonus.atk += 450; hs.bonus.def += 98000; hs.bonus.qi += 110000;
  return true;
}

/* Mua 1 món (qty cái). Trừ tiền đúng giá (kể cả giá giảm theo giờ), áp dụng
   hiệu ứng ngay, đồ 'item'/trang bị vào túi đồ. Không đủ tiền -> từ chối,
   không đổi gì trong save. */
function shopBuy(save, itemId, qty, shopState) {
  qty = Math.max(1, Math.floor(qty || 1));
  var item = shopFindItem(itemId);
  if (!item) return { ok: false, reason: 'Không có món này trong chợ.' };
  var unit = shopEffectivePrice(item, shopState);
  var total = unit * qty;
  var p = save.player;
  if (item.cur === 'gold' && p.gold < total) return { ok: false, reason: 'Không đủ Kim Nguyên Bảo! Cần ' + shopFmt(total) + ' KNB.' };
  if (item.cur === 'silver' && p.silver < total) return { ok: false, reason: 'Không đủ bạc! Cần ' + shopFmt(total) + ' bạc.' };
  if (item.cur === 'gold') p.gold -= total; else p.silver -= total;
  var eff = item.effect || { kind: 'item', value: 0 };
  var applied = '';
  var leveled = 0;
  if (eff.kind === 'atk') { p.atk += eff.value * qty; applied = 'Công +' + (eff.value * qty) + ' vĩnh viễn'; shopAddToBag(save, item.name, item.icon, shopTabLabel(item.tab), item.stat, qty); }
  else if (eff.kind === 'def') { p.def += eff.value * qty; applied = 'Thủ +' + (eff.value * qty) + ' vĩnh viễn'; shopAddToBag(save, item.name, item.icon, shopTabLabel(item.tab), item.stat, qty); }
  else if (eff.kind === 'heal') {
    if (eff.value === 'full') { p.hp = p.maxHp; applied = 'Hồi đầy Sinh Lực'; }
    else { p.hp = Math.min(p.maxHp, p.hp + eff.value * qty); applied = 'Hồi ' + (eff.value * qty) + ' Sinh Lực'; }
  }
  else if (eff.kind === 'maxmp') { p.maxMp += eff.value * qty; p.mp = p.maxMp; applied = 'Nội Lực tối đa +' + (eff.value * qty); }
  else if (eff.kind === 'maxhp') { p.maxHp += eff.value * qty; p.hp += eff.value * qty; applied = 'Sinh Lực tối đa +' + (eff.value * qty); }
  else if (eff.kind === 'exp') { leveled = shopGainExp(save, eff.value * qty); applied = '+' + (eff.value * qty) + ' Kinh Nghiệm' + (leveled ? ' — lên cấp ' + p.level + '!' : ''); }
  else if (eff.kind === 'full') { p.hp = p.maxHp; p.mp = p.maxMp; applied = 'Hồi đầy Sinh Lực + Nội Lực'; }
  else if (eff.kind === 'cultivate') {
    if (!shopCultivate(save)) {
      if (item.cur === 'gold') p.gold += total; else p.silver += total;
      return { ok: false, reason: 'Chưa có đệ tử đội trưởng để bồi dưỡng.' };
    }
    applied = 'Đệ tử đội trưởng +1 cấp';
  }
  else { shopAddToBag(save, item.name, item.icon, shopTabLabel(item.tab), item.stat, qty); applied = 'Đã vào túi đồ'; }
  return { ok: true, spent: total, cur: item.cur, applied: applied, leveled: leveled, item: item };
}

/* Bán lại 1 cái trong túi đồ = 50% giá mua (giá gốc, không tính giảm giá giờ).
   Trang bị bán lại thì trừ chỉ số đã cộng lúc mua. */
function shopSell(save, invIndex) {
  var inv = save.inventory || [];
  var it = inv[invIndex];
  if (!it) return { ok: false, reason: 'Không có vật phẩm này trong túi.' };
  var cat = null;
  for (var i = 0; i < SHOP_CATALOG.length; i++) if (SHOP_CATALOG[i].name === it.name) { cat = SHOP_CATALOG[i]; break; }
  var value, cur = 'silver';
  if (cat) { value = Math.max(1, Math.floor(cat.price * 0.5)); cur = cat.cur; }
  else if (SHOP_SELL_FALLBACK[it.name]) { value = SHOP_SELL_FALLBACK[it.name].price; cur = SHOP_SELL_FALLBACK[it.name].cur; }
  else { value = 25; }
  var p = save.player;
  if (cat && cat.effect) {
    if (cat.effect.kind === 'atk') p.atk = Math.max(1, p.atk - cat.effect.value);
    else if (cat.effect.kind === 'def') p.def = Math.max(1, p.def - cat.effect.value);
    else if (cat.effect.kind === 'maxmp') { p.maxMp = Math.max(10, p.maxMp - cat.effect.value); p.mp = Math.min(p.mp, p.maxMp); }
    else if (cat.effect.kind === 'maxhp') { p.maxHp = Math.max(10, p.maxHp - cat.effect.value); p.hp = Math.min(p.hp, p.maxHp); }
  }
  it.qty -= 1;
  if (it.qty <= 0) inv.splice(invIndex, 1);
  if (cur === 'gold') p.gold += value; else p.silver += value;
  return { ok: true, value: value, cur: cur, name: it.name };
}

/* Mua gói khuyến mãi: trừ tiền, tặng đồ vào túi + thưởng tiền, ghi đã nhận
   vào flags.shop.claimed (once: 'ever', daily: ngày UTC). */
function shopClaimBundle(save, bundleId, todayStr) {
  var b = null;
  for (var i = 0; i < SHOP_BUNDLES.length; i++) if (SHOP_BUNDLES[i].id === bundleId) { b = SHOP_BUNDLES[i]; break; }
  if (!b) return { ok: false, reason: 'Không có gói này.' };
  var shopState = shopEnsureShopState(save);
  shopState.claimed = shopState.claimed || {};
  var prev = shopState.claimed[bundleId];
  if (b.limit === 'once' && prev) return { ok: false, reason: 'Gói này mỗi người chỉ mua 1 lần.' };
  if (b.limit === 'daily' && prev === todayStr) return { ok: false, reason: 'Hôm nay đã nhận gói này rồi, mai quay lại nhé!' };
  var p = save.player;
  if (b.cur === 'gold' && p.gold < b.price) return { ok: false, reason: 'Không đủ Kim Nguyên Bảo! Cần ' + b.price + ' KNB.' };
  if (b.cur === 'silver' && p.silver < b.price) return { ok: false, reason: 'Không đủ bạc! Cần ' + shopFmt(b.price) + ' bạc.' };
  if (b.cur === 'gold') p.gold -= b.price; else p.silver -= b.price;
  b.items.forEach(function (it) { shopAddToBag(save, it.name, it.icon, it.type, it.desc, it.qty); });
  if (b.bonus) {
    if (b.bonus.gold) p.gold += b.bonus.gold;
    if (b.bonus.silver) p.silver += b.bonus.silver;
  }
  shopState.claimed[bundleId] = (b.limit === 'once') ? 'ever' : todayStr;
  return { ok: true, bundle: b };
}
function shopBundleState(save, bundleId, todayStr) {
  var b = null;
  for (var i = 0; i < SHOP_BUNDLES.length; i++) if (SHOP_BUNDLES[i].id === bundleId) { b = SHOP_BUNDLES[i]; break; }
  if (!b) return 'none';
  var shopState = (save.flags && save.flags.shop) || {};
  var prev = (shopState.claimed || {})[bundleId];
  if (b.limit === 'once' && prev) return 'claimed';
  if (b.limit === 'daily' && prev === todayStr) return 'claimed-today';
  return 'available';
}

/* Tìm kiếm + lọc theo tab / độ hiếm. */
function shopFilter(opts) {
  opts = opts || {};
  var q = (opts.query || '').trim().toLowerCase();
  return SHOP_CATALOG.filter(function (it) {
    if (opts.tab && it.tab !== opts.tab) return false;
    if (opts.rarity && opts.rarity !== 'all' && it.rarity !== opts.rarity) return false;
    if (q && (it.name + ' ' + it.desc + ' ' + it.stat).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}

/* Giá bán lại dự kiến (không đổi save) — để hiển thị trên nút Bán. */
function shopSellQuote(save, invIndex) {
  var inv = save.inventory || [];
  var it = inv[invIndex];
  if (!it) return null;
  var cat = null;
  for (var i = 0; i < SHOP_CATALOG.length; i++) if (SHOP_CATALOG[i].name === it.name) { cat = SHOP_CATALOG[i]; break; }
  if (cat) return { value: Math.max(1, Math.floor(cat.price * 0.5)), cur: cat.cur };
  if (SHOP_SELL_FALLBACK[it.name]) return { value: SHOP_SELL_FALLBACK[it.name].price, cur: SHOP_SELL_FALLBACK[it.name].cur };
  return { value: 25, cur: 'silver' };
}

/* ============================== GIAO DIỆN TRÌNH DUYỆT ============================== */
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  var ShopUI = { save: null, shopState: null, tab: 'than-binh', rarity: 'all', query: '' };

  function shopToast(msg, good) {
    var box = document.getElementById('shop-toast');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'shop-toast-item' + (good === false ? ' bad' : '');
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 2800);
  }

  function shopCurLabel(cur) { return cur === 'gold' ? 'KNB' : 'bạc'; }

  function shopCardHTML(it) {
    var st = ShopUI.shopState;
    var featured = shopIsFeatured(it.id, st);
    var price = shopPriceLabel(it, st);
    var afford = (it.cur === 'gold' ? ShopUI.save.player.gold : ShopUI.save.player.silver) >= shopEffectivePrice(it, st);
    return '<div class="shop-card' + (featured ? ' featured' : '') + '">' +
      '<div class="shop-card-top"><span class="shop-ic">' + it.icon + '</span>' +
      '<span class="shop-rarity ' + (SHOP_RARITY_CLASS[it.rarity] || '') + '">' + shopEsc(it.rarity) + '</span>' +
      (featured ? '<span class="shop-flash">⭐ GIẢM ' + st.discount + '%</span>' : '') + '</div>' +
      '<b class="shop-name">' + shopEsc(it.name) + '</b>' +
      '<div class="shop-stat">' + shopEsc(it.stat) + '</div>' +
      '<div class="shop-desc">' + shopEsc(it.desc) + '</div>' +
      '<div class="shop-buyrow"><span class="shop-price">' + price + '</span>' +
      '<button class="shop-btn" data-act="buy" data-id="' + it.id + '"' + (afford ? '' : ' disabled') + '>Mua</button></div>' +
      '</div>';
  }

  function shopBundleHTML(b) {
    var today = shopDayKey(Date.now());
    var state = shopBundleState(ShopUI.save, b.id, today);
    var afford = (b.cur === 'gold' ? ShopUI.save.player.gold : ShopUI.save.player.silver) >= b.price;
    var btn = state === 'available'
      ? '<button class="shop-btn big" data-act="bundle" data-id="' + b.id + '"' + (afford ? '' : ' disabled') + '>Mua gói — ' + shopFmt(b.price) + ' ' + shopCurLabel(b.cur) + '</button>'
      : '<button class="shop-btn big" disabled>' + (state === 'claimed' ? 'Đã mua (1 lần duy nhất)' : 'Đã nhận hôm nay — mai quay lại') + '</button>';
    var items = b.items.map(function (it) { return '<div class="shop-bundle-item">' + it.icon + ' ' + shopEsc(it.name) + ' ×' + it.qty + '</div>'; }).join('');
    var bonus = [];
    if (b.bonus && b.bonus.gold) bonus.push('+' + shopFmt(b.bonus.gold) + ' KNB');
    if (b.bonus && b.bonus.silver) bonus.push('+' + shopFmt(b.bonus.silver) + ' bạc');
    return '<div class="shop-card bundle">' +
      '<div class="shop-card-top"><span class="shop-ic">' + b.icon + '</span>' +
      '<span class="shop-rarity ' + (b.limit === 'daily' ? 'r-rare' : 'r-legend') + '">' + (b.limit === 'daily' ? 'Mỗi ngày' : 'Một lần') + '</span></div>' +
      '<b class="shop-name">' + shopEsc(b.name) + '</b>' +
      '<div class="shop-desc">' + shopEsc(b.desc) + '</div>' +
      '<div class="shop-bundle-items">' + items + '</div>' +
      (bonus.length ? '<div class="shop-stat">Thưởng thêm: ' + bonus.join(' · ') + '</div>' : '') +
      '<div class="shop-buyrow">' + btn + '</div></div>';
  }

  function shopBagHTML() {
    var inv = ShopUI.save.inventory || [];
    if (!inv.length) return '<p class="shop-empty">Túi đồ trống. Mua đồ ở các gian hàng để mang về game nhé!</p>';
    return inv.map(function (it, i) {
      var q = shopSellQuote(ShopUI.save, i);
      return '<div class="shop-bag-row">' +
        '<span class="shop-ic">' + (it.icon || '📦') + '</span>' +
        '<div class="shop-bag-info"><b>' + shopEsc(it.name) + '</b><span>' + shopEsc(it.desc || '') + ' · ×' + it.qty + '</span></div>' +
        '<button class="shop-btn sell" data-act="sell" data-i="' + i + '">Bán 1<br><span>' + shopFmt(q.value) + ' ' + shopCurLabel(q.cur) + '</span></button>' +
        '</div>';
    }).join('');
  }

  function shopRender() {
    var save = ShopUI.save, p = save.player, st = ShopUI.shopState;
    var w = document.getElementById('shop-wallet');
    if (w) w.innerHTML = '<span>🪙 <b>' + shopFmt(p.gold) + '</b> KNB</span><span>⚪ <b>' + shopFmt(p.silver) + '</b> bạc</span>';
    var pl = document.getElementById('shop-player');
    if (pl) pl.textContent = p.name + ' · Cấp ' + p.level + ' · Công ' + p.atk + ' · Thủ ' + p.def + ' · HP ' + Math.round(p.hp) + '/' + p.maxHp;
    var tabs = document.getElementById('shop-tabs');
    if (tabs) {
      tabs.innerHTML = SHOP_TABS.map(function (t) {
        var count = (t.id === 'goi') ? SHOP_BUNDLES.length : (t.id === 'tui' ? (save.inventory || []).length : SHOP_CATALOG.filter(function (x) { return x.tab === t.id; }).length);
        return '<button class="shop-tab' + (ShopUI.tab === t.id ? ' on' : '') + '" data-act="tab" data-tab="' + t.id + '">' + t.icon + ' ' + t.label + ' <span class="shop-count">' + count + '</span></button>';
      }).join('');
    }
    var feat = document.getElementById('shop-featured');
    if (feat) {
      var items = (st.featured || []).map(function (id) { return shopFindItem(id); }).filter(Boolean);
      var now = Date.now();
      var nextHour = Math.ceil((now + 1) / 3600000) * 3600000;
      var mins = Math.max(0, Math.round((nextHour - now) / 60000));
      feat.innerHTML = '<div class="shop-feat-head">⭐ <b>Hàng hiếm theo giờ — giảm ' + (st.discount || 0) + '%</b><span>Đổi kho sau ~' + mins + ' phút (mốc giờ UTC)</span></div>' +
        '<div class="shop-feat-list">' + items.map(function (it) {
          return '<button class="shop-feat-item" data-act="goto" data-id="' + it.id + '">' + it.icon + ' ' + shopEsc(it.name) + ' <b>' + shopFmt(shopEffectivePrice(it, st)) + ' ' + shopCurLabel(it.cur) + '</b></button>';
        }).join('') + '</div>';
    }
    var grid = document.getElementById('shop-grid');
    if (grid) {
      if (ShopUI.tab === 'goi') {
        grid.innerHTML = '<p class="shop-note">Gói khuyến mãi — mua xong đồ vào túi đồ, về game là thấy ngay.</p>' + SHOP_BUNDLES.map(shopBundleHTML).join('');
      } else if (ShopUI.tab === 'tui') {
        grid.innerHTML = '<p class="shop-note">Túi đồ của bạn (chung với game) — bán lại được 50% giá mua. Trang bị bán lại sẽ trừ chỉ số đã cộng.</p>' + shopBagHTML();
      } else {
        var list = shopFilter({ tab: ShopUI.tab, rarity: ShopUI.rarity, query: ShopUI.query });
        var c = document.getElementById('shop-count');
        if (c) c.textContent = list.length + ' món';
        grid.innerHTML = list.length ? list.map(shopCardHTML).join('') : '<p class="shop-empty">Không tìm thấy món nào. Thử từ khóa hoặc bộ lọc khác nhé!</p>';
      }
    }
  }

  function shopTick() {
    var r = shopRefreshStock(ShopUI.shopState, Date.now());
    if (r.changed) { shopPersist(ShopUI.save); shopToast('🔄 Kho chợ đã làm mới theo giờ!', true); }
    shopRender();
  }

  function shopInit() {
    ShopUI.save = shopLoadSave();
    ShopUI.shopState = shopEnsureShopState(ShopUI.save);
    shopRefreshStock(ShopUI.shopState, Date.now());
    shopPersist(ShopUI.save);
    var search = document.getElementById('shop-search');
    if (search) search.addEventListener('input', function () { ShopUI.query = search.value; shopRender(); });
    var rar = document.getElementById('shop-rarity');
    if (rar) rar.addEventListener('change', function () { ShopUI.rarity = rar.value; shopRender(); });
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el || el.disabled) return;
      var act = el.dataset.act;
      if (act === 'tab') { ShopUI.tab = el.dataset.tab; shopRender(); }
      else if (act === 'goto') {
        var it = shopFindItem(el.dataset.id);
        if (it) { ShopUI.tab = it.tab; ShopUI.query = ''; var s = document.getElementById('shop-search'); if (s) s.value = ''; shopRender(); }
      }
      else if (act === 'buy') {
        var r = shopBuy(ShopUI.save, el.dataset.id, 1, ShopUI.shopState);
        if (!r.ok) { shopToast(r.reason, false); return; }
        shopPersist(ShopUI.save);
        shopToast('✅ Đã mua ' + r.item.name + ' (−' + shopFmt(r.spent) + ' ' + shopCurLabel(r.cur) + ') · ' + r.applied, true);
        shopRender();
      }
      else if (act === 'sell') {
        var s2 = shopSell(ShopUI.save, +el.dataset.i);
        if (!s2.ok) { shopToast(s2.reason, false); return; }
        shopPersist(ShopUI.save);
        shopToast('💰 Đã bán ' + s2.name + ' (+' + shopFmt(s2.value) + ' ' + shopCurLabel(s2.cur) + ')', true);
        shopRender();
      }
      else if (act === 'bundle') {
        var b = shopClaimBundle(ShopUI.save, el.dataset.id, shopDayKey(Date.now()));
        if (!b.ok) { shopToast(b.reason, false); return; }
        shopPersist(ShopUI.save);
        shopToast('🎁 Đã nhận ' + b.bundle.name + '! Đồ đã vào túi đồ.', true);
        shopRender();
      }
      else if (act === 'back') {
        shopPersist(ShopUI.save);
        location.href = 'mongvolam.html';
      }
    });
    setInterval(shopTick, 30000);
    shopRender();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', shopInit);
  else shopInit();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SHOP_SAVE_KEY: SHOP_SAVE_KEY, SHOP_TABS: SHOP_TABS, SHOP_CATALOG: SHOP_CATALOG,
    SHOP_BUNDLES: SHOP_BUNDLES, SHOP_SELL_FALLBACK: SHOP_SELL_FALLBACK,
    shopFmt: shopFmt, shopFindItem: shopFindItem, shopHash: shopHash,
    shopHourKey: shopHourKey, shopDayKey: shopDayKey,
    shopRefreshStock: shopRefreshStock, shopIsFeatured: shopIsFeatured,
    shopEffectivePrice: shopEffectivePrice, shopDefaultSave: shopDefaultSave,
    shopEnsureShopState: shopEnsureShopState, shopBuy: shopBuy, shopSell: shopSell,
    shopSellQuote: shopSellQuote, shopClaimBundle: shopClaimBundle,
    shopBundleState: shopBundleState, shopFilter: shopFilter, shopGainExp: shopGainExp
  };
}
/* SHOP-END */
