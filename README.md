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
2. Gặp **Võ Sư Lôi Đài** hoặc bấm **H. Động / Tỷ Võ Đài** → chọn 1 trong 3 chiến trường.
3. Thắng 3 đợt → nhận EXP, bạc, KNB; nhiệm vụ q2/q5 tiến độ; HUD cấp độ cập nhật.
4. Mở **Hồ sơ** (`C`) → bồi dưỡng đệ tử (q4), đổi đội trưởng, xem duyên phận.
5. Bước qua **cầu đá hồ sen** → hoàn thành q3.
6. Mọi tiến trình lưu vào `localStorage` của trình duyệt; **Cài đặt → Đặt lại** để chơi từ đầu.

## Chọn chiến trường (8 map) & Chiêu mộ đệ tử

- **Chọn map:** gặp **Võ Sư Lôi Đài**, bấm **H. Động / Tỷ Võ Đài** hoặc phím `B` → lưới 8 map (Rừng Trúc, Đài Phật, Biện Kinh + Vân Mộng Đầm, Kiếm Linh Cốc, Xanh Tử Nam, Môn Quan, Thiên Hỏa Đỉnh). Chạm một map để xem huy hiệu, boss trấn giữ, cấp đề nghị (chỉ hiển thị, không khóa map), vật phẩm rơi và thưởng EXP/bạc/KNB, rồi bấm **⚔️ Xuất Chiến**. Độ khó tính theo hệ số quái: ≤1.5 Dễ, ≤2.5 Trung, còn lại Khó. Map mới dùng lại 3 cảnh 3D có sẵn (trúc / Phật / thành); Thiên Hỏa Đỉnh là map boss cuối. Đổi arena giữa trận vẫn dùng 3 tab cũ trong HUD chiến trường.
- **Chiêu mộ:** gặp **Tiên Cô Tham Bái** ở Đài Tham Bái (phía tây quảng trường, cạnh bệ đá + 2 đèn lồng) hoặc bấm nút **⛩️** ở cột dọc bên phải màn hình thế giới. 3 gói: **Tầm Sư Học Đạo** (miễn phí 1 lượt/ngày, sau đó 5.000 bạc/lần; Bính 70% / Ất 30%), **Danh Môn Cao Đồ** (100 KNB; Giáp 25% / Ất 50% / Bính 25%), **Nhất Đại Tông Sư** (250 KNB; Giáp 65% / Ất 35%). 7 đệ tử mới: Lệnh Hồ Xung, Nghi Lâm (Bính), Nhậm Doanh Doanh, Dương Quá (Ất), Đông Phương Bất Bại, Độc Cô Cầu Bại, Tiểu Long Nữ (Giáp). Trúng đệ tử đã có sẽ chuyển thành bồi dưỡng (+2 cấp). **Lưu ý:** đệ tử mới chỉ ra trận khi làm đội trưởng — mở Hồ sơ (`C`), chọn đệ tử, bấm **Xuất Chiến**. Tiến trình chiêu mộ lưu cùng save game (phiên bản save v2, vẫn đọc được save cũ v1).

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
