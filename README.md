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

## Kỹ thuật

- Một `THREE.WebGLRenderer` dùng chung cho thế giới (camera orthographic) và chiến trường (camera perspective); hồ sơ dùng canvas + renderer riêng, chỉ chạy khi mở.
- State dùng chung: cấp/EXP/HP/MP/vàng/bạc, 6 hộ vệ với chỉ số gốc + cộng thêm, nhiệm vụ, bang hội, túi đồ, tùy chọn.
- HUD dựng bằng CSS thuần (không phụ thuộc Tailwind); icon dùng emoji/SVG nội tuyến; âm thanh tổng hợp bằng WebAudio (không cần file).
- Đã kiểm thử tự động bằng Playwright + Chrome thật (desktop 1120×700 và mobile 430×900): 0 lỗi JS, luồng thế giới → hồ sơ → chợ → 3 đấu trường → thắng → về thành đều hoạt động.

## Tệp trong dự án

- `mongvolam.html` — **bản chơi hoàn chỉnh** (tự chứa).
- `src/` — mã nguồn tách phần (data, world, battle, arenas, info, UI) và stylesheet.
- `src/original/` — ba tệp gốc `map scene.html`, `battle map.html`, `table infoscene.html` để đối chiếu.
- `lib/` — three.min.js r128, pixi.min.js 8.6.6 dùng để nhúng.
- `tools/build.ps1` — ghép `src/` + `lib/` thành `mongvolam.html`.
- `tools/qa.cjs` — bộ kiểm thử Playwright.

<!-- SHOP-BEGIN -->
## Chợ Biện Kinh (Shop.html)

- **Trang chợ độc lập `Shop.html`** — tự chứa (CSS/JS inline, không CDN ngoài, chạy offline), mở từ nút **Chợ** trên HUD, từ 2 pill vàng/bạc, hoặc nói chuyện với **Chưởng Quầy Tạp Hóa**. Nút **🏯 Về Thành** quay lại `mongvolam.html`.
- **Chia sẻ save với game:** chợ đọc/ghi đúng key `localStorage` `mongvolam_soha_v1` (save v2, xem `src/01-data.js` `SaveManager`): chỉ đổi `player` (vàng/bạc/KNB, chỉ số) + `inventory` (túi đồ) + `flags.shop` (trạng thái chợ), mọi field khác giữ nguyên. Mua/bán/gói xong lưu ngay nên về game là thấy đồ. Trạng thái chợ cất trong `flags.shop` để `SaveManager.save()` của game không làm mất khi game lưu lại. Trước khi chuyển sang chợ, game lưu bằng đúng hàm hiện có `SaveManager.save()` rồi mới `location.href = 'Shop.html'`.
- **Hàng hóa (72 món + 4 gói):** Thần Binh 12 · Phòng Cụ 12 · Đan Dược 12 · Đá/Ngọc 10 · Bí Kíp 10 · Thời Trang 8 · Thú Cưng & linh tinh 8; độ hiếm Thường 15 / Hiếm 25 / Sử Thi 20 / Truyền Thuyết 12. Giá bạc hoặc KNB. Đan dược dùng ngay khi mua (hồi máu/nội lực, +EXP theo đúng công thức lên cấp của game, bồi dưỡng đội trưởng); Thần Binh/Phòng Cụ +chỉ số vĩnh viễn và vào túi đồ; Đá/Ngọc, Bí Kíp, Thời Trang, Thú Cưng vào túi đồ.
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

## Cách test (tổng hợp)

- `node tools/build.mjs` — build cả 4 trang (`mongvolam.html`, `Shop.html`, `Newgame.html`, `Event.html`); chạy 2 lần phải cho ra file giống hệt (dùng `cmp`).
- Harness Node (không cần trình duyệt): `node tools/test-shop.cjs`, `node tools/test-arenas.cjs`, `node tools/test-heroes.cjs`, `node tools/test-newgame.cjs`, `TZ=Asia/Ho_Chi_Minh node tools/test-event.cjs` — tất cả phải PASS.
- Smoke test HTTP: `python3 -m http.server` rồi `curl` kiểm tra 200 cho cả 4 trang.
- Chưa kiểm chứng trên trình duyệt/điện thoại thật — cần test tay trên phone: Newgame (tạo nhân vật → vào game), Event (điểm danh, nhận thưởng, về thành thấy tiền/đồ), Shop, 10 Battle Map, chiêu mộ.
