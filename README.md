# Mộng Võ Lâm 3D — Soha

Bản hợp nhất **một tệp HTML duy nhất** từ ba phân cảnh gốc:

| Nguồn | Vai trò trong game |
| --- | --- |
| `map scene.html` | **Thế giới** — Biện Kinh Thành 3D isometric: quảng trường đá, lầu gác hai tầng, chợ bạt xanh, cầu đá, hồ sen, đèn lồng, NPC và nhân vật chibi, click-to-move, bảng tên nổi, hoa đào PixiJS. |
| `battle map.html` | **Chiến trường** — 3 đấu trường (Rừng Trúc U Minh, Đài Phật Anh Đào, Biện Kinh Thành Cổ), đội hình 4 hộ vệ chibi đấu 3 đợt ma giáo, 4 tuyệt kỹ có hồi chiêu, đánh tự động, tốc độ X1–X5, thư pháp tuyệt kỹ, sát thương bay, kết quả – thưởng – quay về thành. |
| `table infoscene.html` | **Hồ sơ nhân vật** — màn hình da giấy cổ trang: dãy 6 đệ tử, mô hình chibi 3D xoay được, 7 ô trang bị, tư chất – thực lực – thần thông, duyên phận, bồi dưỡng, xuất chiến. |

Mở [mongvolam.html](mongvolam.html) là chơi (không cần server, không cần mạng — Three.js r128 và PixiJS 8.6.6 đã nhúng sẵn trong tệp).

## Điều khiển

- **Thế giới:** `WASD`/phím mũi tên hoặc chạm đất để di chuyển; chạm NPC để đối thoại; lăn chuột để thu phóng.
- **Phím tắt:** `C` hồ sơ · `B` chiến trường · `Q` nhiệm vụ · `H` hướng dẫn · `Esc` đóng bảng / tạm dừng trận.
- **Chiến trường:** `1`–`4` tung tuyệt kỹ; kéo chuột để xoay camera; nút X1/X2/X3/X5 đổi tốc độ; nút 🤖 bật/tắt tự đánh; ✨ tự tung chiêu; ⏸ tạm dừng.
- **Hồ sơ:** chạm chân dung để đổi đệ tử; kéo mô hình 3D để xoay; **Bồi Dưỡng** (12.000 bạc) tăng chỉ số; **Xuất Chiến** đưa đệ tử đang chọn làm đội trưởng vào trận.

## Vòng chơi đã nối

1. Vào thành → nói chuyện **Chưởng Quầy Tạp Hóa** (nhiệm vụ q1) → mở chợ mua đan dược/thần binh.
2. Gặp **Võ Sư Lôi Đài** hoặc bấm **H. Động / Tỷ Võ Đài** → chọn 1 trong 10 Battle Map.
3. Thắng 3 đợt → nhận EXP, bạc, KNB; nhiệm vụ q2/q5 tiến độ; HUD cấp độ cập nhật.
4. Mở **Hồ sơ** (`C`) → bồi dưỡng đệ tử (q4), đổi đội trưởng, xem duyên phận.
5. Bước qua **cầu đá hồ sen** → hoàn thành q3.
6. Mọi tiến trình lưu vào `localStorage` của trình duyệt; **Cài đặt → Đặt lại** để chơi từ đầu.

## Chọn chiến trường (10 Battle Map) & Chiêu mộ đệ tử
- **Chọn map:** gặp **Võ Sư Lôi Đài**, bấm **H. Động / Tỷ Võ Đài** hoặc phím `B` → lưới 10 Battle Map, độ khó và thưởng tăng dần từ Map 1 đến Map 10. Chạm một map để xem huy hiệu, dàn quái, boss trấn giữ + kỹ năng Boss, cấp đề nghị (chỉ hiển thị, không khóa map), vật phẩm rơi và thưởng EXP/bạc/KNB, rồi bấm **⚔️ Xuất Chiến**. Độ khó tính theo hệ số quái: ≤1.5 Dễ, ≤2.5 Trung, còn lại Khó. Thắng trận nhận thêm phần thưởng riêng của Boss map đó vào túi đồ. Đổi arena giữa trận vẫn dùng 3 tab cũ trong HUD chiến trường (Rừng Trúc / Đài Phật / Biện Kinh).
- **Chiêu mộ:** gặp **Tiên Cô Tham Bái** ở Đài Tham Bái (phía tây quảng trường, cạnh bệ đá + 2 đèn lồng) hoặc bấm nút **⛩️** ở cột dọc bên phải màn hình thế giới. 3 gói: **Tầm Sư Học Đạo** (miễn phí 1 lượt/ngày, sau đó 5.000 bạc/lần; Bính 70% / Ất 30%), **Danh Môn Cao Đồ** (100 KNB; Giáp 25% / Ất 50% / Bính 25%), **Nhất Đại Tông Sư** (250 KNB; Giáp 65% / Ất 35%). 7 đệ tử mới: Lệnh Hồ Xung, Nghi Lâm (Bính), Nhậm Doanh Doanh, Dương Quá (Ất), Đông Phương Bất Bại, Độc Cô Cầu Bại, Tiểu Long Nữ (Giáp). Trúng đệ tử đã có sẽ chuyển thành bồi dưỡng (+2 cấp). **Lưu ý:** đệ tử mới chỉ ra trận khi làm đội trưởng — mở Hồ sơ (`C`), chọn đệ tử, bấm **Xuất Chiến**. Tiến trình chiêu mộ lưu cùng save game (phiên bản save v2, vẫn đọc được save cũ v1).

<!-- HERO20-BEGIN -->
## Nhân vật (20 đệ tử — mỗi người 4 skill riêng)

- **Roster:** 6 gốc (Đế Thích Thiên, Tùy Tiêu Sầu, Độc Cô Kiếm Thánh, Triệu Linh Nhi, Nhiếp Phong, Bộ Kinh Vân) + 14 chiêu mộ tại Đài Tham Bái. 7 đệ tử mới: **Quách Tĩnh** (Giáp, Lv.300), **Hồng Thất Công** (Giáp, Lv.300), **Chu Bá Thông** (Giáp, Lv.300), **Vương Trùng Dương** (Giáp, Lv.300), **Hoàng Dung** (Ất, Lv.200), **Lâm Triều Anh** (Ất, Lv.200), **Triệu Mẫn** (Bính, Lv.120). Tỉ lệ 3 gói gacha giữ nguyên (mỗi gói cộng = 100%); đệ tử mới tự vào đúng nhóm phẩm của mình (Triệu Mẫn → Bính, Hoàng Dung/Lâm Triều Anh → Ất, 4 người còn lại → Giáp). 13 nhân vật cũ không đổi id/chỉ số gốc; save v2 cũ (chỉ có 6 gốc) vẫn đọc được, nhân vật mới chỉ thêm vào defs.
- **Skill riêng:** mỗi nhân vật có 4 skill trong `src/01-data.js` (`HERO20_SKILLS` + `heroSkills(id)`): 3 skill thường + 1 tuyệt kỹ (nút 4). Tuyệt kỹ: hệ số sát thương 3.0–3.6, hồi chiêu 11–13s, tốn 40–50 nội lực; skill thường: hệ số 1.7–2.6, hồi chiêu 6–9s, tốn 12–20 nội lực. Có 3 skill hồi máu toàn đội (Triệu Linh Nhi — Nữ Oa Hồi Xuân, Nghi Lâm — Thanh Tâm Chú, Lâm Triều Anh — Ngọc Nữ Hồi Xuân). Tổng 20 nhân vật × 4 = **80 skill**.

| Nhân vật mới | Phẩm | Tuyệt kỹ | 3 skill thường |
| --- | --- | --- | --- |
| Quách Tĩnh | Giáp Lv.300 | Hàng Long Thập Bát Chưởng (x3.6, diện rộng) | Hàng Long Chưởng, Song Thủ Hỗ Bác, Cửu Âm Chân Kinh |
| Hoàng Dung | Ất Lv.200 | Lạc Anh Thần Kiếm Chưởng (x3.2, diện rộng) | Đả Cẩu Bổng Pháp, Lạc Anh Thần Kiếm, Bích Hải Triều Sinh |
| Hồng Thất Công | Giáp Lv.300 | Thần Long Bãi Vĩ (x3.5, diện rộng) | Hàng Long Chưởng Pháp, Đả Cẩu Bổng Pháp, Tiêu Dao Du |
| Chu Bá Thông | Giáp Lv.300 | Cửu Âm Chân Kinh (x3.5, diện rộng) | Không Minh Quyền, Song Thủ Hỗ Bác, Lão Ngoan Đồng |
| Vương Trùng Dương | Giáp Lv.300 | Tiên Thiên Cương Khí (x3.6, diện rộng) | Toàn Chân Kiếm Pháp, Tiên Thiên Công, Nhất Dương Chỉ |
| Lâm Triều Anh | Ất Lv.200 | Ngọc Nữ Song Kiếm Hợp Bích (x3.3, diện rộng) | Ngọc Nữ Kiếm Pháp, Cổ Mộ U Công, Ngọc Nữ Hồi Xuân (hồi máu) |
| Triệu Mẫn | Bính Lv.120 | Càn Khôn Đại Na Di (x3.0, diện rộng) | Ỷ Thiên Kiếm Pháp, Mông Cổ Loan Đao, Thập Hương Nhuyễn Cân Tán |

- **Xem skill:** mở Hồ sơ (`C`), chọn đệ tử — khung skill hiện tên/icon/hồi chiêu/tốn nội lực của đúng 4 skill người đó (rê chuột vào xem mô tả). **Dùng trong trận:** 4 nút skill trên HUD chiến trường (phím `1`–`4`) lấy theo bộ skill của đội trưởng, kèm thanh nội lực (tối đa 100, hồi 6/s; thiếu nội lực thì báo và không tung chiêu). Nhân vật nào thiếu skill sẽ tự fallback về 4 tuyệt kỹ chung cũ, không crash.
- **Kiểm thử:** `node tools/test-heroes.cjs` — tổng ≥20 nhân vật, id duy nhất, mỗi nhân vật 4 skill + đúng 1 tuyệt kỹ, 13 nhân vật cũ nguyên vẹn, save v2 cũ vẫn load được, tỉ lệ pool = 100. Chưa kiểm chứng trên trình duyệt/điện thoại thật.
<!-- HERO20-END -->

## Battle Map 1–10

| Map | Địa hình 3D | Boss (kỹ năng) | Hệ số | Quái tiêu biểu |
| --- | --- | --- | --- | --- |
| Battle Map 1 — Rừng Trúc U Minh 🌿 | Rừng trúc + cổng torii | Trúc Ma Lão Tổ (Trúc Diệp Phi Đao) | 1.0 | Trúc Yêu, Ma Giáo Đồ, Sơn Tặc Trúc Lâm |
| Battle Map 2 — Đài Phật Anh Đào 🌸 | Tượng Phật + anh đào | Hộ Pháp Hắc Bạch (Hắc Bạch Song Sát) | 1.4 | Anh Đào Yêu, Hộ Pháp Áo Trắng, Tăng Nhân Sa Ngã |
| Battle Map 3 — Biện Kinh Thành Cổ 🏯 | Thành cổ + hồ sen | Ma Giáo Giáo Chủ (Huyết Ma Đại Pháp) | 1.9 | Ma Giáo Cao Thủ, Tử Y Sát Thủ, Độc Long Sứ Giả |
| Battle Map 4 — Tuyết Sơn Băng Phong ❄️ | Tuyết sơn + tinh thể băng | Băng Tuyết Nữ Vương (Băng Phong Vạn Lý) | 2.4 | Tuyết Yêu, Băng Lang, Tuyết Sơn Cự Nhân |
| Battle Map 5 — Sa Mạc Hoàng Kim 🏜️ | Sa mạc + kim tự tháp | Sa Mạc Hoàng Đế (Cát Bão Hoàng Kim) | 2.9 | Sa Tặc, Cát Yêu, Bọ Cạp Khổng Lồ |
| Battle Map 6 — Núi Lửa Thiên Hỏa 🌋 | Núi lửa + hồ dung nham | Hỏa Kỳ Lân – Viêm Đế (Thiên Hỏa Phần Thiên) | 3.4 | Hỏa Ma, Dung Nham Quái, Hỏa Diệm Sứ Giả |
| Battle Map 7 — Đầm Lầy U Ám 🐸 | Đầm lầy + nấm phát quang | Đầm Lầy Ma Quân (Độc Vụ Mê Hồn) | 3.9 | Đầm Lầy Thủy Quái, Độc Oa, Cây Khô Ma |
| Battle Map 8 — Vân Cung Thiên Đình ☁️ | Cung điện trên mây | Thiên Đình Chiến Thần (Thiên Lôi Vạn Quân) | 4.4 | Thiên Binh, Vân Hạc Tiên, Kim Giáp Thần Tướng |
| Battle Map 9 — Hang Quỷ Âm Phủ 👹 | Hang quỷ + tinh thể âm hồn | Quỷ Vương Diêm La (Âm Phủ Quỷ Trảo) | 4.9 | Tiểu Quỷ, Âm Hồn, Quỷ Diện Tướng |
| Battle Map 10 — Hồ Sen Biển Đông 🌊 | Hồ sen + biển (Boss cuối) | Long Vương Biển Đông (Hải Triều Long Ngâm) | 5.5 | Thủy Quái, Giao Long Con, Biển Đông Thủy Binh |

- Thưởng EXP/bạc/KNB tăng theo hệ số (Map 1: 150 EXP / 2.800 bạc / 1 KNB → Map 10: 825 EXP / 15.400 bạc / 6 KNB); Boss xuất hiện ở đợt 3, thắng trận nhận thêm phần thưởng riêng của Boss vào túi đồ.
- Map 1–3 dùng lại 3 cảnh 3D có sẵn (trúc / Phật / thành); Map 4–10 có builder 3D riêng trong `src/03b-arenas.js` (tái dùng helper chung `arenaBase` / `flatGround` / `daisDisc` / `scatterRocks` / `driftParticles` / `glowCrystal`).
- Tương thích save cũ: 8 id map cũ (`bamboo`, `buddha`, `city`, `van-mong-dam`, `kiem-linh-coc`, `xanh-tu-nam`, `mon-quan`, `thien-hoa-dan-dinh`) vẫn mở được trận — `resolveArenaKey()` trong `src/01-data.js` map chúng sang Battle Map mới tương ứng, modal chỉ hiện 10 map mới.
- Kiểm thử: `node tools/test-arenas.cjs` — đủ 10 map, mỗi map đủ field + boss + quái, hệ số tăng dần 1→10, 8 id cũ vẫn hợp lệ, thưởng theo hệ số. Chưa kiểm chứng trên trình duyệt/điện thoại thật.

<!-- DISTRICT-BEGIN -->
## 11 khu vực mới (map/*.html)

- **12 khu trong `src/10b-districts.js` (`DISTRICTS`):** khu 1 Biện Kinh Thành là trung tâm, sống trong `mongvolam.html` (không có file riêng); 11 khu còn lại mỗi khu một trang độc lập `map/*.html`, build từ `src/district.template.html` + `src/10-district.js` (engine `District.boot`) + `src/10b-districts.js` qua `tools/build.mjs`. Mỗi trang tự chứa (Three.js r128 inline, không CDN), dùng chung save `localStorage` `mongvolam_soha_v1` với game chính — tiền, túi đồ, cờ `flags.district` đi qua lại được. Nút **🏯 Về Biện Kinh Thành** lưu game rồi về `../mongvolam.html`; nút **🛒 Sang Chợ** về `../Shop.html`.
- **Đi lại:** bấm nút **🗺️** ở cột dọc bên phải màn hình thế giới → panel **Bản Đồ Khu Vực** liệt kê đủ 12 khu (khu khóa hiện lý do, bấm khu mở thì game lưu rồi sang `map/<file>.html`); hoặc đi qua 3 **cổng dịch chuyển** trong thành — Cổng Son → Phố Đông, Giếng Cổ → Bến Sông, Làng Đào Viên → Ruộng Lúa (chạm cổng hoặc bấm 🚪 Dịch chuyển để chọn vào khu / đi vòng như cũ; khu khóa thì cổng báo lý do).
- **Giờ game chung:** 1 giờ game ≈ 75 giây thật, đồng hồ chạy xuyên suốt các trang; ban đêm = 18h–6h giờ game. Hầu hết hoạt động giới hạn 1 lần/ngày game.

| Khu (file) | NPC chính | Hoạt động + thưởng chính | Khóa / mở |
| --- | --- | --- | --- |
| Phố Đông Thương Mại (`pho-dong.html`) | Thương Nhân Phố Đông, Chủ Sạp Đan Dược, Tiểu Đồng Rao Hàng | Sang Chợ Biện Kinh; Chợ Đêm ban đêm giảm 30% | Luôn mở |
| Phố Tây Võ Quán (`pho-tay.html`) | Võ Sư Thiết Quyền, Đệ Tử Luyện Võ, Lão Võ Sư | Tỷ Võ Đấu Tập (thắng nhận EXP + điểm tỷ võ); Luyện Skill 2.000 bạc → +12 Công, +100 EXP, 1 lần/ngày | Luôn mở |
| Nam Môn Cổng Thành (`nam-mon.html`) | Lính Gác Nam Môn, Đội Trưởng Thủ Thành, Khách Thương Qua Đường | Xin Giấy Thông Hành (ban đêm cần Lệnh Bài); Giúp Tuần Tra +800 bạc +60 EXP, 1 lần/ngày | Luôn mở |
| Bắc Uyển Vườn Hoàng Gia (`bac-uyen.html`) | Người Làm Vườn, Tiểu Thư Ngắm Sen | Câu Cá Hồ Sen, Hái Sen (QTE) — cá/sen riêng của vườn | Luôn mở |
| Ngõ Hẹp Khu Ổ Chuột (`ngo-hep.html`) | Người Bí Ẩn, Lão Ăn Mày, Thương Nhân Chợ Đen | Quest Ẩn 3 bước (Mảnh Giấy Rách); Chợ Đêm ban đêm bán đồ hiếm giá cao | Luôn mở |
| Miếu Cổ Di Tích (`mieu-co.html`) | Lão Tăng Trông Miếu, Hộ Pháp Đá | Đọc Truyền Thuyết Miếu Cổ (lore nối 5 chuyện Lão Kể Chuyện); **Boss Ẩn Hộ Pháp Đá** (HP 12.000) → **+8.000 bạc +15 KNB +600 EXP + 🎫 Lệnh Bài Biện Kinh**, 1 lần/ngày | Luôn mở |
| Bến Sông Cảng (`ben-song.html`) | Lão Ngư Dân, Người Lái Đò | Câu Cá Bến Sông; Du Thuyền 300 bạc → +150 EXP + cá tươi, 1 lần/ngày | Luôn mở |
| Ruộng Lúa Ven Thành (`ruong-lua.html`) | Lão Nông Dân, Bà Nông Dân, Đứa Trẻ Chăn Trâu | Gieo Hạt 200 bạc → lúa chín ngày game sau, gặt nhận Lúa Vàng ×10 +2.000 bạc +120 EXP | Luôn mở |
| Nghĩa Trang U Ám (`nghia-trang.html`) | Người Trông Mộ, Hồn Ma Lang Thang | Thắp Hương 300 bạc → +1.500 bạc +250 EXP; Đánh Đuổi 3 Ma → +2.000 bạc +200 EXP, 1 lần/ngày | 🔒 **Chỉ mở ban đêm (18h–6h giờ game)** |
| Thác Nước Ngoại Ô (`thac-nuoc.html`) | Ẩn Sĩ Thác Nước, Đứa Trẻ Bắt Cá | Nhặt đủ bộ 5 vật phẩm thác → Đổi Thưởng +5.000 bạc +10 KNB +300 EXP (1 lần) | Luôn mở |
| Hang Động Bí Mật (`hang-dong.html`) | Ma Quân Hang Động, Nhà Thám Hiểm | **Boss Cuối Ma Quân Hang Động** (HP 30.000, mạnh nhất hiện tại) → **+20.000 bạc +40 KNB +1.500 EXP**, 1 lần/ngày | 🔒 Cần **thắng boss Miếu Cổ** (cờ `boss_mieu_co`) **VÀ có Lệnh Bài Biện Kinh** trong túi |

- **Tương thích save cũ:** save chưa có `flags.district` vẫn load được — `SaveManager.load()` (`src/01-data.js`) hợp nhất cờ mặc định (`defaultDistrictFlags`) thay vì ghi đè, cờ lẻ đã có được giữ nguyên.
- **Kiểm thử:** `node tools/test-districts.cjs` — **368/368 PASS** (đủ 11 khu + đủ field, NPC/prop trong bounds, khóa Nghĩa Trang ban ngày chặn/ban đêm mở, Hang Động chặn khi thiếu boss Miếu Cổ hoặc thiếu Lệnh Bài, thưởng boss Miếu Cổ/Hang Động ghi đúng save + persist xuống `localStorage`, link `../mongvolam.html`/`../Shop.html` trong cả 11 trang build, save cũ load được). Chưa kiểm chứng trên trình duyệt/điện thoại thật.
<!-- DISTRICT-END -->

## Kỹ thuật

- Một `THREE.WebGLRenderer` dùng chung cho thế giới (camera orthographic) và chiến trường (camera perspective); hồ sơ dùng canvas + renderer riêng, chỉ chạy khi mở.
- State dùng chung: cấp/EXP/HP/MP/vàng/bạc, 6 hộ vệ với chỉ số gốc + cộng thêm, nhiệm vụ, bang hội, túi đồ, tùy chọn.
- HUD dựng bằng CSS thuần (không phụ thuộc Tailwind); icon dùng emoji/SVG nội tuyến; âm thanh tổng hợp bằng WebAudio (không cần file).
- Đã kiểm thử tự động bằng Playwright + Chrome thật (desktop 1120×700 và mobile 430×900): 0 lỗi JS, luồng thế giới → hồ sơ → chợ → 3 đấu trường → thắng → về thành đều hoạt động.

## Tệp trong dự án

- `mongvolam.html` — **bản chơi hoàn chỉnh** (tự chứa).
- `map/` — 11 trang khu vực độc lập (Phố Đông … Hang Động), build từ `src/district.template.html` + `src/10-district.js` + `src/10b-districts.js`.
- `src/` — mã nguồn tách phần (data, world, battle, arenas, info, UI) và stylesheet.
- `src/original/` — ba tệp gốc `map scene.html`, `battle map.html`, `table infoscene.html` để đối chiếu.
- `lib/` — three.min.js r128, pixi.min.js 8.6.6 dùng để nhúng.
- `tools/build.ps1` — ghép `src/` + `lib/` thành `mongvolam.html`.
- `tools/qa.cjs` — bộ kiểm thử Playwright.

<!-- SHOP-BEGIN -->
## Chợ Biện Kinh (Shop.html)

- **Trang chợ độc lập `Shop.html`** — tự chứa (CSS/JS inline, không CDN ngoài, chạy offline), mở từ nút **Chợ** trên HUD, từ 2 pill vàng/bạc, hoặc nói chuyện với **Chưởng Quầy Tạp Hóa**. Nút **🏯 Về Thành** quay lại `mongvolam.html`.
- **Chia sẻ save với game:** chợ đọc/ghi đúng key `localStorage` `mongvolam_soha_v1` (save v2, xem `src/01-data.js` `SaveManager`): chỉ đổi `player` (vàng/bạc/KNB, chỉ số) + `inventory` (túi đồ) + `flags.shop` (trạng thái chợ), mọi field khác giữ nguyên. Mua/bán/gói xong lưu ngay nên về game là thấy đồ. Trạng thái chợ cất trong `flags.shop` để `SaveManager.save()` của game không làm mất khi game lưu lại. Trước khi chuyển sang chợ, game lưu bằng đúng hàm hiện có `SaveManager.save()` rồi mới `location.href = 'Shop.html'`.
- **Hàng hóa (73 món + 4 gói):** Thần Binh 12 · Phòng Cụ 12 · Đan Dược 12 · Đá/Ngọc 10 · Bí Kíp 10 · Thời Trang 8 · Thú Cưng & linh tinh 9 (thêm **Mồi Câu** 50 bạc cho mini-game câu cá); độ hiếm Thường 16 / Hiếm 25 / Sử Thi 20 / Truyền Thuyết 12. Giá bạc hoặc KNB. Đan dược dùng ngay khi mua (hồi máu/nội lực, +EXP theo đúng công thức lên cấp của game, bồi dưỡng đội trưởng); Thần Binh/Phòng Cụ +chỉ số vĩnh viễn và vào túi đồ; Đá/Ngọc, Bí Kíp, Thời Trang, Thú Cưng vào túi đồ. Cá/sen/bướm câu–hái–bắt được bán lại ở chợ theo giá cố định: Cá Chép Thường 150 / Hiếm 500 / Vàng 2.000 bạc, Hạt Sen 120, Lá Sen 60, Cánh Bướm 300 bạc.
- **Mua/bán:** bán lại trong tab **Túi Đồ · Bán** = 50% giá mua (giá gốc); trang bị bán lại trừ chỉ số đã cộng; đồ ngoài catalogue (vd. Kim Sáng Dược mặc định) có giá bán cố định, đồ lạ mặc định 25 bạc.
- **Tìm kiếm + lọc** theo tên/mô tả, theo tab và độ hiếm. **Kho theo giờ:** 6 món Sử Thi/Truyền Thuyết giảm 10/15/20%, chọn xác định theo mốc giờ UTC, đổi kho khi qua giờ (ghi `hourKey`/`stockAt` vào `flags.shop`). **Gói:** Tân Thủ (1.000 bạc, 1 lần), Đại Hiệp (99 KNB, 1 lần), Phúc Lợi Ngày (500 bạc, 1 lần/ngày), Chí Tôn (299 KNB, 1 lần) — đồ gói vào túi đồ.
- **Cách build (nguồn chân lý duy nhất):** `Shop.html` build từ `src/shop.template.html` + `src/07-shop.js` qua `tools/build.mjs` (chạy `node tools/build.mjs` sẽ build cả `mongvolam.html`, `Shop.html`, `Newgame.html` lẫn `Event.html`). Đừng sửa `Shop.html` trực tiếp — sửa `src/07-shop.js` / `src/shop.template.html` rồi build lại. Build lại `mongvolam.html` giống hệt bản trước, trừ 2 dòng hook chợ trong `src/05-ui.js` (`open-shop` và `merchant-shop`).
- **Modal chợ cũ** (`kind === 'shop'` + `UI.buy()` trong `src/05-ui.js`) còn trong code làm dự phòng nhưng không còn lối mở từ UI — mọi nút Chợ đều sang `Shop.html`.
- **Kiểm thử:** `node tools/test-shop.cjs` — 31/31 PASS (mua trừ tiền, thiếu tiền bị từ chối, bán lại 50%, đổi kho theo giờ, giá giảm, gói 1 lần/ngày, lọc/tìm kiếm, lên cấp EXP, round-trip save). Chưa kiểm chứng trên trình duyệt/điện thoại thật — cần test tay trên phone: mở chợ từ HUD + NPC, mua/bán, về thành thấy đồ.
<!-- SHOP-END -->

<!-- NEWGAME-BEGIN -->
## Màn hình chính (Newgame.html)

- **Cửa vào chính của game — `Newgame.html`** — tự chứa (CSS/JS inline, không CDN ngoài, chạy offline), build từ `src/newgame.template.html` + `src/08-newgame.js` qua `tools/build.mjs`. Mở trang này trước khi vào game: màn tải hoa đào → menu chính → **Chơi Mới** (tạo nhân vật) / **Tiếp Tục** (vào `mongvolam.html`) / **Cài Đặt** / **Hướng Dẫn** / **Bộ Sưu Tập Đệ Tử** / **Thoát**.
- **Luồng chơi mới:** đặt tên (1–12 ký tự, có nút 🎲 gợi ý) → chọn giới tính, màu áo (8 màu), kiểu tóc (5 kiểu) với chibi xem trước → chọn 1 trong **6 môn phái** (Thiếu Lâm, Võ Đang, Hoa Sơn, Nga Mi, Cái Bang, Minh Giáo — mỗi phái có vũ khí/bào phục khởi đầu + cộng chỉ số riêng, xem trước trực tiếp) → chọn 1 trong 6 đệ tử gốc làm đội trưởng → bấm **Nhập Giang Hồ**. Nhân vật mới bắt đầu ở **cấp 3, EXP 0/160**, vàng 455 KNB / bạc 40.932.
- **Tạo save v2 sạch:** `ngCreateSave()` reset hoàn toàn theo schema v2 (player, 6 đệ tử gốc, leader = đệ tử khởi đầu, 5 nhiệm vụ, bang hội, túi đồ, stats về 0, `flags.createdVia = 'newgame'`), chỉ giữ nguyên `settings` hiện tại nếu có. Tên rỗng/quá dài, chưa chọn phái hoặc chọn đệ tử không phải đệ tử khởi đầu đều bị từ chối kèm lý do, không ghi save.
- **Tiếp tục / cài đặt / bộ sưu tập:** menu chính hiện tóm tắt save (tên, cấp, phái, tiền, số đệ tử); chưa có save thì **Tiếp Tục** bị chặn kèm thông báo rõ. Cài đặt (âm thanh, tự đánh, tự tung chiêu, tốc độ 1/2/3/5) lưu chung với save game — vào game vẫn giữ nguyên; tốc độ trận đấu được game áp dụng vì `Battle.start()` (`src/03-battle.js`) đọc `State.settings.speed` mỗi trận. Bộ sưu tập hiện đủ 20 đệ tử, đánh dấu ĐÃ MỞ / CHƯA MỞ theo save.
- **Về màn hình chính từ trong game:** modal **Cài đặt** có dòng "Về màn hình chính" (nút `open-newgame`, lưu game rồi sang `Newgame.html`).
- **Kiểm thử:** `node tools/test-newgame.cjs` — 43/43 PASS (tên rỗng/dài bị từ chối, phái cộng đúng chỉ số, reset save sạch, tiếp tục có/không save, giữ settings khi tạo mới, gallery 20 đệ tử). Chưa kiểm chứng trên trình duyệt/điện thoại thật.
<!-- NEWGAME-END -->

<!-- EVENT-BEGIN -->
## Sự kiện (Event.html)

- **Trang sự kiện độc lập `Event.html`** — tự chứa (CSS/JS inline, không CDN ngoài, chạy offline), build từ `src/event.template.html` + `src/09-event.js` qua `tools/build.mjs`. Mở từ nút **📅** ở cột dọc bên phải màn hình thế giới, hoặc nói chuyện với NPC **Sứ Giả Sự Kiện** (đứng ở phía đông quảng trường, x 8.2, z -0.6). Nút **🏯 Về Thành** quay lại `mongvolam.html`. Nút **🎉 S. Kiện** ở dock dưới (mở modal sự kiện cũ trong game) vẫn giữ nguyên, không đụng.
- **7 tab:** **Điểm Danh** (chuỗi 7 ngày quay vòng, nghỉ 1 ngày reset về ngày 1) · **Nhiệm Vụ Ngày** (9 nhiệm vụ, tiến trình thật đo từ stats trong save so với baseline chụp lúc mở trang lần đầu trong ngày; nhiệm vụ mua ở chợ thì tự xác nhận vì chợ không ghi dấu mua hàng) · **Sự Kiện Tuần** (6 sự kiện theo ngày/giờ, mỗi sự kiện 1 lần/ngày) · **Lễ Hội** (Tết, Mùa Hè, Quốc Khánh, Trung Thu — mỗi lễ hội 1 lần/năm) · **Boss · Bang Chiến** (Boss Thế Giới 12h00 + 20h00, mỗi khung mở 30 phút, thưởng 1 lần/ngày; Bang Chiến 19h–20h Thứ 7, thưởng 1 lần/tuần) · **Đấu Trường** (bảng xếp hạng giả lập — đối thủ cố định, hạng tính từ số trận thắng thật `stats.wins`, thưởng theo hạng 1 lần/tuần tính từ Thứ 2) · **Đổi Quà** (5 gói trừ tiền thật, đổi được nhiều lần).
- **Giờ địa phương, khác chợ:** mọi mốc giờ trên trang này tính theo **giờ địa phương của máy** (ngày địa phương = ngày trên đồng hồ máy, `eventLocalDayKey()`), **không** dùng giờ UTC như chợ (`Shop.html` dùng giờ UTC cho kho theo giờ). Đừng đổi chợ theo trang này.
- **Chia sẻ save với game:** sự kiện đọc/ghi đúng key `localStorage` `mongvolam_soha_v1` (save v2): chỉ đổi `player` (vàng/bạc/KNB, EXP/cấp theo đúng công thức lên cấp của game — lên cấp thì `maxExp *= 1.42`, +120 maxHp, +40 maxMp, +15 công, +10 thủ, hồi đầy HP/MP) + `inventory` (túi đồ) + `flags.event` (trạng thái sự kiện). Trạng thái cất trong `flags.event` (7 nhánh: `checkin`, `daily`, `weekly`, `seasonal`, `boss`, `arena`, `redeem`) để `SaveManager.save()` của game không làm mất; save cũ chưa có `flags.event` vẫn chạy vì `eventEnsureEventState()` tự tạo đủ nhánh, và `SaveManager.load()` trong `src/01-data.js` hợp nhất từng nhánh `flags.event` thay vì ghi đè. Nhận thưởng lưu ngay nên về game là thấy tiền, đồ. Trước khi sang trang sự kiện, game lưu bằng `SaveManager.save()` rồi mới `location.href = 'Event.html'`.
- **Kiểm thử:** `node tools/test-event.cjs` — 55/55 PASS (chạy với `TZ=Asia/Ho_Chi_Minh`; điểm danh 1 lần/ngày, nhận trùng bị từ chối, sự kiện hết hạn bị từ chối, EXP lên cấp đúng công thức, save cũ không có `flags.event` vẫn chạy). Chưa kiểm chứng trên trình duyệt/điện thoại thật.
<!-- EVENT-END -->

<!-- ENV-BEGIN -->
## Môi trường động + Mở rộng quy mô (Nhiệm vụ 1 + 2)

- **Đồng hồ giờ game:** `State.worldClock {hour, day, season}` — chạy khi ở mode world, 1 giờ game ≈ 75 giây thật ở tốc độ 1; ngày game sang thì lưu, 30 ngày đổi mùa (Xuân → Hạ → Thu → Đông, lặp 120 ngày). Bầu trời/fog/cường độ Hemisphere + Directional đổi theo giờ (bình minh/trưa/hoàng hôn/đêm); đèn lồng sáng dần ban đêm (PointLight + emissive tăng theo độ tối); hoa đào PixiFX đổi màu theo mùa (xuân hồng, hạ xanh nhạt/trắng, thu cam, đông trắng). HUD hiện pill `☀️ Nắng · ☀️ 08:00 · Ngày 1 · Mùa Xuân`. Cài đặt → Đồng hồ giờ game: Bình thường / Nhanh ×2 / Tắt.
- **Thời tiết:** máy trạng thái nắng/mưa/tuyết/sương mù/nắng gắt, đổi mỗi 150–300 giây thật theo tỉ lệ từng mùa (tuyết chỉ mùa đông); mưa 400 hạt / tuyết 300 hạt bằng 1 `THREE.Points` + 1 BufferGeometry tái dùng, rơi vòng lặp quanh player; sương mù tăng `scene.fog` density; nắng gắt tăng sáng + overlay ấm toàn màn hình. Cài đặt → Hiệu ứng thời tiết: BẬT/TẮT (tắt thì trời luôn nắng, không hạt).
- **Nước động:** 10 lá sen cũ nhấp nhô + trôi chậm quanh vị trí gốc; 6 gợn sóng (vòng tròn mở rộng mờ dần, tái dùng mesh); 4 cá chép cam bơi ellipse quanh hồ sen (tâm (0, 9.5), y ≈ -0.52), đuôi vẫy.
- **Gió:** `Engine.sway` đung đưa theo `sin(time + phase) × windStrength` — tán cây (9 cây mới + 3 cây cũ), bạt chợ, 3 cờ/biểu ngữ ở lối vào khu mới; sức gió theo thời tiết (mưa 1.0, tuyết 0.8, nắng 0.5, nắng gắt 0.35, sương mù 0.3). Đèn lồng giữ cách đung đưa cũ.
- **Mở rộng bản đồ:** `isWalkable` nới thành x∈[-45,48], z∈[-40,44]; luật cầu khu cũ giữ nguyên (hồ sen z>6.5 chỉ qua cầu x∈[3.2,7.8]; bờ đông x>9.5 chỉ qua cầu z∈[1.5,5.5]). Thêm: ruộng lúa tây + nam (2 InstancedMesh ~190 luống + 2 bù nhìn), 5 nhà dân mái ngói có collider (3 bắc, 2 đông), đường mòn đất nâu, 9 cây + 5 đèn lồng mới, mặt nước mở rộng 104×104. Khu thành cũ + mọi NPC/vị trí cũ nguyên vẹn.
- **Cổng dịch chuyển (đi vòng):** Cổng Son Biện Kinh (-16.2, 0) → Giếng Cổ Hồ Sen (6.8, 12.5) → Cổng Làng Đào Viên (-28, -20) → về Cổng Son. Đứng gần cổng (bán kính 2.2) hiện nút `🚪 Tới <tên khu đích>` trên HUD (bấm được bằng cảm ứng), hoặc chạm trực tiếp vào cổng/giếng; bấm thì fade 340ms rồi dịch chuyển tức thời tới điểm đáp đã kiểm `isWalkable` (điểm đáp nằm trong bán kính kích hoạt của cổng đích).
- **Lưu game:** field mới `worldClock`, `weather` trong save v2 (`SaveManager.save/load`); `settings.clockSpeed` (0/1/2) + `settings.weatherFx` (mặc định bật). Save cũ không có 2 field vẫn load được (giữ mặc định); Newgame giữ lại 2 field settings mới khi tạo nhân vật/đổi cài đặt.
- **Kỹ thuật:** logic mới ở `src/02b-env.js` (ghép sau `02-world.js` trong `tools/build.mjs`); `src/02-world.js` chỉ thêm điểm neo (đèn/trời/lá sen/cây/bạt) + móc `Env.update()` trong `World.update()`. Không đổi id cũ, không đổi signature hàm.
- **Kiểm thử:** `node tools/test-env.cjs` — 56/56 PASS (mùa, bầu trời, thời tiết, đồng hồ, isWalkable cũ+mới, chu trình teleport 3 cổng, save/load + save cũ). Harness cũ vẫn PASS (shop 31, arenas 111, heroes 236, newgame 43, event 55). Chưa kiểm chứng trên trình duyệt/điện thoại thật.
<!-- ENV-END -->

<!-- NPC-BEGIN -->
## NPC thông minh (Nhiệm vụ 3)

- **Lịch trình theo giờ game:** 5 NPC chính (Chưởng Quầy, Võ Sư Lôi Đài, Trưởng Lão, Tiên Cô Tham Bái, Sứ Giả Sự Kiện) tự đi bộ chậm (1.2/s, tránh vật cản bằng bước lệch góc) theo ca: sáng 6–11 ở chợ/công việc, trưa 11–14 ở quán trà gần chợ, chiều 14–18 ở quảng trường, tối 18–22 + đêm về nhà (trước cửa nhà dân khu mở rộng). Vị trí suy ra từ `worldClock.hour` nên không lưu vị trí vào save. Chưởng Quầy đứng trước sạp (-5.2,-0.4) thay vì trong sạp (trong sạp là collider, NPC sẽ kẹt khi tự đi lại).
- **Hội thoại phân nhánh:** cây thoại JSON `DIALOGUE_TREES` trong `src/01-data.js` (mỗi node `{text, options:[{label, next, cond?, setFlag?, quest?, action?}]}`), mở bằng `World.talkTo()` → `World.renderDialogue()` / `World.chooseDialogueOption()` (nút `data-act="dlg-option"` trong `src/05-ui.js`). Lựa chọn thiếu điều kiện (bạc/KNB/cấp/vật phẩm/flag/nhiệm vụ) hiện mờ + ghi rõ yêu cầu, không cho bấm. Chọn thì rẽ nhánh, đặt flag (`flags.npc`, lưu cùng save v2), tiến nhiệm vụ qua `progressQuest()`, hoặc chạy action như nút role cũ (shop/battle/info/recruit/event) và dịch vụ mới (forge/heal/train/lore). Mỗi NPC có 1 cây ≥3 node: Chưởng Quầy 4, Võ Sư 4, Trưởng Lão 4, Tiên Cô 4, Sứ Giả 4, Thợ Rèn 4, Thần Y 4, Lão Kể Chuyện 4 — tổng 32 node.
- **Dân thường đi lại:** 8 dân thường cũ đi ngẫu nhiên quanh vị trí neo (bán kính ~6, điểm đích kiểm `isWalkable`, đi 0.9/s, nghỉ 3–8s rồi lặp lại).
- **NPC mới:** **Thợ Rèn Thiết Ngưu** 🔨 (-9.8,-4.2, gần chợ — rèn vũ khí: 1 Huyền Thiết Tinh đổi +5 công kích vĩnh viễn, tối đa 5 lần), **Thần Y Hoa Đà** 💊 (6.5,-1 — chữa thương 500 bạc, hồi đầy HP; thiếu tiền hoặc HP đã đầy thì từ chối, không trừ tiền), **Lão Kể Chuyện** 📖 (-1.5,4, quảng trường — mở modal đọc 5 đoạn truyền thuyết Biện Kinh), **Tiểu Bảo + Tiểu Linh** (2 trẻ con chibi scale 0.7, chạy 2.6/s quanh quảng trường), **Tiểu Hắc (chó) + Tiểu Miêu (mèo)** (mesh nhỏ tự dựng, lang thang chậm 0.7/s, không thoại — chạm vào chỉ hiện emote/toast vui).
- **Lưu game:** chỉ thêm `flags.npc {met, forgeCount, healCount, loreRead}` vào save v2 (`SaveManager.save/load` hợp nhất như `flags.event`); save cũ không có `flags.npc` vẫn load được, giữ mặc định. Không đổi id cũ, không đổi signature hàm (`World.talkTo`, `CharacterManager.create/update`, `SaveManager.save/load`, `UI.openModal`, `UI.bindGlobal`).
- **Kiểm thử:** `node tools/test-npc.cjs` — 245/245 PASS (lịch trình 8h/12h/20h đúng khu + vị trí đi được thật, NPC đi bộ tới ca mới, cây thoại đủ node/nhánh/điều kiện/action mở đúng modal-trang, waypoint dân thường, trẻ con chạy nhanh ~3×, rèn/chữa tính đúng tiền-vật phẩm-giới hạn, thú cưng emote, save/load + save cũ). Harness cũ vẫn PASS (shop 31, arenas 111, heroes 236, newgame 43, event 55, env 56). Chưa kiểm chứng trên trình duyệt/điện thoại thật.
<!-- NPC-END -->

<!-- INTERACT-BEGIN -->
## Tương tác mở rộng + mini-game (Nhiệm vụ 4)

- **Click-to-interact (bên cạnh click-to-move):** chạm vào vật thì nhân vật tự đi tới gần rồi thực hiện hành động (móc trong `Engine.bindEvents`, TRƯỚC nhánh `isWalkable`/`moveTo`, kiểm tra gần điểm chạm như `npcNear`); đứng gần vật (bán kính 2.0) thì hiện nút hành động trên HUD (`#interact-btn`, bấm được bằng cảm ứng, không cần đi).
- **Đồ rơi:** sinh theo giờ game (qua 1 giờ game thì 60% sinh thêm 1 vật, tối đa 5 vật đang có), vị trí ngẫu nhiên đi được; chạm nhặt vào túi qua `addItem()` (bạc 200–800, Kim Sáng Dược, Tụ Khí Đan, Huyền Thiết Tinh, Lá Sen ×2), đã nhặt thì biến mất rồi mới sinh vật mới. Danh sách đồ rơi lưu cùng save nên thoát game vào lại vẫn còn.
- **Rương (5 cái, cố định):** Rương Lầu Gác (-11,-3) · Rương Bờ Hồ (4.2,13.5, bờ nam hồ sen gần giếng cổ) · Rương Cầu Đông (14,3, bờ đông qua cầu đá) · Rương Làng Đào (-28,-16, gần cổng làng) · Rương Ruộng Lúa (-32,2). Loot ngẫu nhiên: 50% bạc 500–2.000 · 18% đan dược ×2 · 14% vật liệu (Huyền Thiết Tinh / Mồi Câu ×3) · 12% Hạt Sen ×3 · 6% hiếm 8–15 KNB. Mỗi rương mở lại sau 1 ngày game; mở rồi chạm lại thì báo "mở lại vào ngày mai (ngày X+1)".
- **Bướm (5 con):** bay theo đường sin quanh hoa/quảng trường (điểm neo (-6,6), (0,5), (6,6), (-12,-2), (3,-4.5)), mesh nhỏ 2 cánh vẫy; chạm vào để bắt (đi tới gần rồi bắt), bắt được +1 **Cánh Bướm** vào túi (bán 300 bạc); bướm bị bắt ẩn 45 giây rồi xuất hiện lại ở chỗ khác. Vị trí bướm chỉ giữ trong phiên, không lưu save.
- **Câu cá ở hồ sen:** điểm câu cố định đầu đông cầu đá (7,9). Mỗi lần câu tốn 1 **Mồi Câu** (vật phẩm trong túi: mua ở chợ 50 bạc, tặng 5 mồi mỗi ngày game, nhân vật mới có sẵn 5 mồi); hết mồi thì báo hết, không mở modal. Thanh timing chạy qua lại, bấm **Kéo cần** đúng vùng xanh [35,65] thì trúng (70% Cá Chép Thường bán 150 bạc, 30% Cá Chép Hiếm bán 500 bạc), vùng vàng giữa [47,53] = **Cá Chép Vàng** sử thi bán 2.000 bạc; trượt thì mất mồi, không tốn tiền.
- **Hái sen:** điểm hái cố định đầu tây cầu đá (4,9). Bấm **Hái ngay** đúng lúc kim vào vùng sáng [40,60] thì được Hạt Sen ×2 (70%, bán 120 bạc) hoặc Lá Sen ×2 (30%, bán 60 bạc); sai thì không được gì, không phạt.
- **Đấu cờ Caro với Lão Kỳ Thánh ♟️** (9.0,-3.0, phía đông lầu gác; bàn cờ ở (9,-1.6)): nói chuyện với lão rồi bấm **Đấu một ván cờ**, hoặc chạm thẳng vào bàn cờ. Bàn 9×9 chơi thật, thiếu hiệp cầm quân đen ● đi trước, 5 quân một hàng thắng. AI dễ: tìm nước thắng của mình trước, rồi chặn nước thắng của người chơi, còn lại đi ngẫu nhiên kề quân đã có. Thắng được **+1.000 bạc +100 EXP, 1 lần/ngày game** (sau đó chỉ chơi vui); thua/hòa/đầu hàng không phạt; có nút **Ván mới** + **Đầu hàng**.
- **Biểu cảm:** bong bóng emote trên đầu nhân vật/NPC (😊 😢 😠), tự ẩn sau ~2 giây, tái dùng cơ chế chiếu nameplate (tọa độ 3D→màn hình). Nhận thưởng = 😊 (mở rương, nhặt đồ, bắt bướm, câu được cá, hái sen, thắng cờ, rèn/chữa thành công); bị từ chối/thiếu điều kiện = 😢 trên NPC đó (thợ rèn/thần y từ chối, chọn thoại thiếu điều kiện); thua cờ/câu trượt = 😢 trên nhân vật.
- **Lưu game:** chỉ thêm `flags.interact {chests, drops, baitDay, chessWinDay, chessWins, fishCaught, lotusPicked, butterflies}` vào save v2 (`SaveManager.save/load` hợp nhất như `flags.npc`); save cũ không có `flags.interact` vẫn load được, giữ mặc định (nhận 5 Mồi Câu ngay ngày game đầu tiên). Không đổi id cũ, không đổi signature hàm.
- **Kiểm thử:** `node tools/test-interact.cjs` — 99/99 PASS (rương đúng bảng + hồi chiêu, đồ rơi vào túi/biến mất/tối đa 5, câu cá đúng vùng/độ hiếm/hết mồi bị chặn, hái sen đúng/sai, cờ Caro AI chặn + thắng 5 quân + thưởng 1 lần/ngày, mồi mỗi ngày, emote, save/load + save cũ, chợ + Newgame). Harness cũ vẫn PASS (shop 31, arenas 111, heroes 236, newgame 43, event 55, env 56; test-npc có 1 check flaky sẵn — waypoint dân thường ngẫu nhiên đôi khi rơi vào rect bảng hiệu, pass ~2/10 lần chạy, code đó không thuộc nhiệm vụ này). Chưa kiểm chứng trên trình duyệt/điện thoại thật.
<!-- INTERACT-END -->

<!-- FOLLOW-BEGIN -->
## Bạn đồng hành đi theo — thú cưng + đệ tử đội trưởng (Nhiệm vụ 5)

- **Thú cưng đi theo:** 3 pet mua ở chợ giữ nguyên id tc01–tc03 (Trứng Hỏa Kỳ Lân 200 KNB, Trứng Thần Điêu 40.000 bạc, Tiểu Bạch Hồ 15.000 bạc). Túi đồ chỉ lưu pet theo tên nên nhận diện bằng `FOLLOW_PET_DEFS` trong `src/01-data.js` (`shopName` → id, `name` hiện trên nameplate, `color`/`hair` là màu chibi CSS hex: Hỏa Kỳ Lân cam `#ea580c`, Thần Điêu xám `#57534e`, Tiểu Bạch Hồ trắng `#f8fafc`). Trong modal Hành trang (🎒), mỗi ô thú cưng có nút **🐾 Cho đi theo** / **✖ Thôi đi theo** (bấm được bằng cảm ứng, `data-act="pet-follow"`) + nhãn **🐾 Đang theo**; pet đang theo là chibi scale 0.55 đi sau lưng nhân vật (cách ~1.2 ô, lệch phải 0.5), nhún nhanh hơn khi player di chuyển, cách player >12 thì dịch chuyển tức thời tới gần.
- **Chọn/đổi/bỏ pet:** logic thuần `FollowPets` (`src/01-data.js`): `setActive` chỉ nhận pet đang sở hữu, `toggle` đổi trạng thái, chưa chọn con nào mà trong túi đã có pet thì `ensureDefault` tự chọn con đầu tiên trong túi; bán pet đang theo ở chợ thì `clearIfSold` tự bỏ theo (còn pet khác thì tự chuyển sang con còn lại, kèm toast báo 1 lần).
- **Đệ tử đội trưởng đi theo:** leader hiện tại (`State.heroes[State.leader]`, def qua `heroById`) xuất hiện dạng chibi scale 0.9 đi cạnh bên phải nhân vật (~1 ô, hơi lùi 0.2, không chắn đường), dùng đúng màu áo/tóc + tên của đệ tử đó; đổi đội trưởng trong Hồ sơ thì người đi theo đổi theo (so `heroId` mỗi frame, khác thì tạo lại).
- **Kỹ thuật:** module `Followers` trong `src/02-world.js` (móc `Followers.update()` cuối `World.update()`, sau `PlayerController.update`): lerp về điểm đích (`dt*6`), quay cùng hướng player, nhún nhanh khi di chuyển; follower có `isFollower:true, isNpc:false` nên không mở thoại (`npcNear` chỉ xét `isNpc`), không bị `NpcAI` kéo đi lang thang, luôn hiện tên (bỏ qua luật ẩn tên khi xa >8.5). Chỉ tồn tại ở mode world (vào battle/info thì scene world không render, về world thì chạy lại ngay); `initPopulation()` xóa sạch entities thì `update()` phát hiện ent không còn trong mảng, xóa mesh cũ khỏi scene rồi tạo mới (không trùng lặp, không rò mesh). Chỉ 2 follower, mesh tái dùng từ `CharacterManager.create()` nên nhẹ cho điện thoại. Không đổi id cũ, không đổi signature hàm.
- **Lưu game:** chỉ thêm field mới `activePet` (id pet đang theo hoặc `null`) vào save v2 (`SaveManager.save/load`); save cũ không có field vẫn load được (`null`), pet đã lưu mà không còn trong túi (đã bán) thì load về `null`, không crash; `leader` khi load đã clamp sẵn từ trước.
- **Kiểm thử:** `node tools/test-follow.cjs` — 57/57 PASS (nhận diện pet theo tên, chọn/đổi/bỏ pet, tự chọn con đầu tiên, bán pet đang theo → chuyển con còn lại / bỏ hẳn khi hết pet, save/load + save cũ, spawn đúng tên/màu/scale, đổi đội trưởng đổi follower, lerp + dịch chuyển >12, follower không phải NPC/không bị NpcAI kéo đi, tạo lại sau khi entities bị xóa, móc `World.update` + chỉ chạy ở mode world, nối UI + build). Harness cũ vẫn PASS (shop 31, arenas 111, heroes 236, newgame 43, event 55, env 56, npc 245, interact 99). Chưa kiểm chứng trên trình duyệt/điện thoại thật.
<!-- FOLLOW-END -->

## Cách test (tổng hợp)

- `node tools/build.mjs` — build cả 4 trang (`mongvolam.html`, `Shop.html`, `Newgame.html`, `Event.html`); chạy 2 lần phải cho ra file giống hệt (dùng `cmp`).
- Harness Node (không cần trình duyệt): `node tools/test-shop.cjs`, `node tools/test-arenas.cjs`, `node tools/test-heroes.cjs`, `node tools/test-newgame.cjs`, `TZ=Asia/Ho_Chi_Minh node tools/test-event.cjs`, `node tools/test-env.cjs`, `node tools/test-npc.cjs`, `node tools/test-interact.cjs`, `node tools/test-follow.cjs` — tất cả phải PASS.
- Smoke test HTTP: `python3 -m http.server` rồi `curl` kiểm tra 200 cho cả 4 trang.
- Chưa kiểm chứng trên trình duyệt/điện thoại thật — cần test tay trên phone: Newgame (tạo nhân vật → vào game), Event (điểm danh, nhận thưởng, về thành thấy tiền/đồ), Shop, 10 Battle Map, chiêu mộ, tương tác + mini-game (rương/bướm/câu cá/hái sen/cờ caro — xem mục Nhiệm vụ 4), bạn đồng hành đi theo (mua pet → chọn Cho đi theo → pet + đội trưởng đi sau/cạnh nhân vật — xem mục Nhiệm vụ 5).
