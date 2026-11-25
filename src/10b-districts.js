/* ============================================================================
   MỘNG VÕ LÂM 3D — 11 KHU VỰC MỚI (NHÓM A: dữ liệu)
   src/10b-districts.js — định nghĩa DISTRICTS (12 khu, id 1..12) + hàm khóa
   dùng chung canEnterDistrict(def, save).
   - File thuần dữ liệu/logic, không chạm DOM/THREE: require() được trong Node
     để kiểm thử (xem tools/test-districts.cjs của nhóm B).
   - id 1 = Biện Kinh Thành (khu trung tâm, nằm trong mongvolam.html, file null).
   - Các khu 2..12 có `file` là tên file trong map/ (nhóm B build ra từ
     src/district.template.html + src/10-district.js).
   - Khóa: Nghĩa Trang chỉ vào ban đêm (giờ game 18h–6h); Hang Động cần thắng
     boss Miếu Cổ (flags.district.boss_mieu_co) VÀ có vật phẩm Lệnh Bài.
   - Vật phẩm Lệnh Bài: không có catalogue vật phẩm tập trung trong
     src/01-data.js (túi đồ game lưu theo tên; catalogue của chợ nằm ở
     src/07-shop.js), nên item được định nghĩa tại đây (DISTRICT_ITEM_LENH_BAI)
     và thêm vào túi đồ bằng helper của District (src/10-district.js).
   ========================================================================== */
'use strict';

/* DISTRICT-BEGIN */
const DISTRICT_SAVE_KEY = 'mongvolam_soha_v1';

/* Vật phẩm tín vật mở Hang Động + qua cổng Nam Môn ban đêm. Túi đồ game lưu
   theo tên (xem addItem trong src/01-data.js) nên id 'lenh_bai' đi kèm tên
   đầy đủ 'Lệnh Bài Biện Kinh'; hàm hasDistrictItem() chấp nhận cả hai. */
const DISTRICT_ITEM_LENH_BAI = {
  id: 'lenh_bai', name: 'Lệnh Bài Biện Kinh', icon: '🎫', type: 'Tín vật',
  desc: 'Lệnh bài do Miếu Cổ ban — qua được cổng Nam Môn ban đêm, mở được Hang Động Bí Mật.'
};

/* Flag mặc định của 11 khu vực (lưu trong flags.district của save v2).
   src/01-data.js dùng chung hàm này (defaultDistrictFlags) để save cũ
   load được qua deep-merge; trang khu dùng bản này khi save chưa có. */
function defaultDistrictFlags() {
  return {
    /* Boss Miếu Cổ / Hang Động (1 lần/ngày game — *_day = ngày game đã thắng). */
    boss_mieu_co: false, boss_mieu_co_day: 0,
    boss_hang_dong: false, boss_hang_dong_day: 0,
    /* Nam Môn: giấy thông hành qua cổng ban đêm (lính gác cấp khi có Lệnh Bài). */
    nam_mon_pass: false,
    /* Ngõ Hẹp: quest ẩn 3 bước (0 chưa nhận → 1 đã nhận → 2 đã tìm được
       Mảnh Giấy Rách → 3 đã giao cho Lão Ăn Mày, xong). */
    ngo_step: 0, ngo_done: false,
    /* Phố Tây: luyện skill 1 lần/ngày game; vo_diem = điểm tỷ võ tích lũy. */
    vo_luyen_day: 0, vo_diem: 0,
    /* Ruộng Lúa: stage 0 chưa gieo → 1 đã gieo (chín vào ruong_ready_day). */
    ruong_stage: 0, ruong_ready_day: 0,
    /* Thác Nước: vật phẩm đã nhặt {thac1: true, ...}; thac_done = đã đổi thưởng. */
    thac_collected: {}, thac_done: false,
    /* Nghĩa Trang: thắp hương / đánh đuổi ma 1 lần/ngày game. */
    nghia_huong_day: 0, nghia_duoi_day: 0,
    /* Bến Sông: du thuyền 1 lần/ngày game. */
    boat_day: 0,
    /* Bắc Uyển: đếm cá/sen riêng của khu (chỉ để hiển thị thành tích). */
    bacuyen_fish: 0, bacuyen_lotus: 0
  };
}

/* Đảm bảo save có đủ flags.district (save cũ thiếu → thêm mặc định, không
   đổi field cũ). Trả về flags.district đã chuẩn hóa. */
function ensureDistrictFlags(save) {
  if (!save || typeof save !== 'object') return defaultDistrictFlags();
  save.flags = save.flags || {};
  const d0 = defaultDistrictFlags();
  const d = save.flags.district;
  if (!d || typeof d !== 'object') { save.flags.district = d0; return d0; }
  Object.keys(d0).forEach(k => {
    if (d[k] === undefined || d[k] === null) d[k] = d0[k];
  });
  if (!d.thac_collected || typeof d.thac_collected !== 'object') d.thac_collected = {};
  ['boss_mieu_co_day', 'boss_hang_dong_day', 'ngo_step', 'vo_luyen_day', 'vo_diem',
   'ruong_stage', 'ruong_ready_day', 'nghia_huong_day', 'nghia_duoi_day', 'boat_day',
   'bacuyen_fish', 'bacuyen_lotus'].forEach(k => {
    d[k] = Math.max(0, Math.round(Number(d[k]) || 0));
  });
  d.boss_mieu_co = !!d.boss_mieu_co;
  d.boss_hang_dong = !!d.boss_hang_dong;
  d.nam_mon_pass = !!d.nam_mon_pass;
  d.ngo_done = !!d.ngo_done;
  d.thac_done = !!d.thac_done;
  return d;
}

/* Giờ game có phải ban đêm không (18h–6h, giống ca 'home' của NPC
   trong src/01-data.js scheduleShiftForHour). */
function isNightHour(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  return h >= 18 || h < 6;
}

/* Túi đồ có vật phẩm không — chấp nhận id ('lenh_bai') hoặc tên đầy đủ. */
function hasDistrictItem(save, idOrName) {
  if (!save || !Array.isArray(save.inventory)) return false;
  return save.inventory.some(it => it && (it.id === idOrName || it.name === idOrName ||
    (idOrName === 'lenh_bai' && it.name === DISTRICT_ITEM_LENH_BAI.name)));
}

/* Giờ game hiện tại của save (mặc định 8h sáng nếu save chưa có đồng hồ). */
function districtHour(save) {
  if (save && save.worldClock && typeof save.worldClock.hour === 'number') return save.worldClock.hour;
  return 8;
}
function districtDay(save) {
  if (save && save.worldClock && typeof save.worldClock.day === 'number') return Math.max(1, Math.round(save.worldClock.day));
  return 1;
}

/* Hàm khóa dùng chung — dùng được cả trong trang khu (tự kiểm tra khi mở)
   và trong panel bản đồ ở game chính (nhóm B). Trả về {ok:true} hoặc
   {ok:false, reason:'...tiếng Việt...'} (reason ghi rõ điều kiện còn thiếu). */
function canEnterDistrict(def, save) {
  if (!def) return { ok: false, reason: 'Không tìm thấy khu vực này.' };
  if (def.id === 1) return { ok: true };
  const lock = def.lock;
  if (!lock) return { ok: true };
  if (lock.type === 'night') {
    if (isNightHour(districtHour(save))) return { ok: true };
    const h = Math.floor(districtHour(save));
    return {
      ok: false,
      reason: 'Nghĩa Trang U Ám chỉ mở ban đêm (18h–6h giờ game). Hiện tại là ' + h + 'h ban ngày — hãy quay lại khi trời tối.'
    };
  }
  if (lock.type === 'quest') {
    const d = ensureDistrictFlags(save);
    const needFlag = lock.needFlag || 'boss_mieu_co';
    const needItem = lock.needItem || 'lenh_bai';
    if (!d[needFlag]) {
      return {
        ok: false,
        reason: 'Hang Động Bí Mật đang bị phong ấn. Cần đánh bại Boss ẩn ở Miếu Cổ Di Tích trước — thắng rồi sẽ nhận được Lệnh Bài Biện Kinh để mở hang.'
      };
    }
    if (!hasDistrictItem(save, needItem)) {
      return {
        ok: false,
        reason: 'Thiếu Lệnh Bài Biện Kinh. Boss Miếu Cổ đã bị đánh bại nhưng Lệnh Bài không còn trong túi — hãy quay lại Miếu Cổ nhận lại Lệnh Bài.'
      };
    }
    return { ok: true };
  }
  return { ok: true };
}

/* Tên mùa theo ngày game (30 ngày/mùa, giống Env.seasonForDay). */
function districtSeasonName(day) {
  const names = ['Mùa Xuân', 'Mùa Hạ', 'Mùa Thu', 'Mùa Đông'];
  return names[Math.floor((((Math.max(1, day) - 1) % 120) / 30))];
}

/* ============================== 12 KHU VỰC ==============================
   Shape mỗi entry (nhóm B tích hợp theo đúng shape này, không đổi tên):
   {id, file, name, desc, theme:{sky, ground, fog}, bounds:{minX,maxX,minZ,maxZ},
    props:[{kind,x,z,...}], npcs:[{id,name,role,x,z,robe,dialogue}],
    activities:[{id,name,desc}], boss?, lock?}
   - props.kind: engine ở src/10-district.js vẽ theo kind (stall, sign, house,
     tree, lantern, arena, stone, wall, tower, gate, pond, pavilion, bridge,
     boat, dock, field, buffalo, grave, firefly, waterfall, crystal, cave,
     altar, statue, temple, chest, rock, flower, cart, barrel, ghost...).
     solid:true = có collider (không đi xuyên được).
   - npcs[].dialogue: chuỗi (hiện 1 đoạn) hoặc mảng chuỗi (nhiều đoạn, engine
     hiện lần lượt — dùng cho quest nhiều bước ở Ngõ Hẹp).
   - activities[].id: engine dispatch theo id (xem District.runActivity). */
const DISTRICTS = [
  {
    id: 1, file: null, name: 'Biện Kinh Thành', desc: 'Khu trung tâm — quảng trường, hồ sen, chợ và lôi đài. Mọi con đường đều dẫn về đây.',
    theme: { sky: '#7ec8ee', ground: '#8a9a7b', fog: '#9fd0dd' },
    bounds: { minX: -45, maxX: 48, minZ: -40, maxZ: 44 },
    props: [], npcs: [], activities: []
  },
  {
    id: 2, file: 'pho-dong.html', name: 'Phố Đông Thương Mại', desc: 'Dãy sạp san sát, biển hiệu phát sáng. Ban ngày buôn bán tấp nập, ban đêm chợ đêm mở hàng giảm giá.',
    theme: { sky: '#f7c873', ground: '#a08b62', fog: '#e8c98a' },
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    props: [
      { kind: 'stall', x: -9, z: -5, label: 'Sạp Đan Dược', color: '#b91c1c', solid: true },
      { kind: 'stall', x: -3, z: -6, label: 'Sạp Binh Khí', color: '#1d4ed8', solid: true },
      { kind: 'stall', x: 3, z: -6, label: 'Sạp Tơ Lụa', color: '#7e22ce', solid: true },
      { kind: 'stall', x: 9, z: -5, label: 'Sạp Lương Thảo', color: '#15803d', solid: true },
      { kind: 'sign', x: -9, z: -3.4, label: 'Đan Dược', color: '#f59e0b' },
      { kind: 'sign', x: -3, z: -4.4, label: 'Binh Khí', color: '#38bdf8' },
      { kind: 'sign', x: 3, z: -4.4, label: 'Tơ Lụa', color: '#e879f9' },
      { kind: 'sign', x: 9, z: -3.4, label: 'Lương Thảo', color: '#4ade80' },
      { kind: 'lantern', x: -6, z: 0 }, { kind: 'lantern', x: 0, z: 0 }, { kind: 'lantern', x: 6, z: 0 },
      { kind: 'house', x: -12, z: 6, color: '#78350f', solid: true },
      { kind: 'house', x: 12, z: 6, color: '#92400e', solid: true },
      { kind: 'cart', x: -6, z: 4, solid: true }, { kind: 'barrel', x: 6, z: 4 },
      { kind: 'tree', x: -12, z: -8, solid: true }, { kind: 'tree', x: 12, z: -8, solid: true }
    ],
    npcs: [
      { id: 'pd-merchant', name: 'Thương Nhân Phố Đông', role: 'merchant', x: -6, z: -2, robe: '#b45309', dialogue: 'Phố Đông là nơi buôn bán sầm uất nhất Biện Kinh! Ban ngày sạp nào cũng đông khách, còn ban đêm chợ đêm mở ra — hàng giảm giá, đồ lạ nhiều lắm. Thiếu hiệp muốn sang Chợ Biện Kinh thì ta dẫn đường cho.' },
      { id: 'pd-keeper', name: 'Chủ Sạp Đan Dược', role: 'shop', x: -9, z: -3, robe: '#b91c1c', dialogue: 'Đan dược nhà ta toàn hàng thật! Ban đêm ghé lại, ta bớt cho thiếu hiệp 30% — chợ đêm Phố Đông mà, ai cũng được giảm.' },
      { id: 'pd-kid', name: 'Tiểu Đồng Rao Hàng', role: 'town', x: 0, z: 4, robe: '#15803d', dialogue: 'Rao đây rao đây! Đan dược giảm giá, binh khí giảm giá — chỉ có ở chợ đêm Phố Đông thôi!' }
    ],
    activities: [
      { id: 'shop-link', name: '🛒 Sang Chợ Biện Kinh', desc: 'Mở Shop.html — mua bán chung một túi đồ với game chính.' },
      { id: 'cho-dem', name: '🌙 Chợ Đêm Phố Đông', desc: 'Chỉ mở ban đêm (18h–6h giờ game): hàng giảm giá 30%, có món chỉ bán đêm.' }
    ]
  },
  {
    id: 3, file: 'pho-tay.html', name: 'Phố Tây Võ Quán', desc: 'Lôi đài, bia đá, sân tập. Võ sư ở đây nhận tỷ võ đấu tập tính điểm và truyền thụ võ công.',
    theme: { sky: '#a8c8d8', ground: '#9c8a6a', fog: '#b8c8c8' },
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    props: [
      { kind: 'arena', x: 0, z: -3, label: 'Lôi Đài Phố Tây', solid: true },
      { kind: 'stone', x: -8, z: -6, label: 'Bia Đá Võ Đạo', solid: true },
      { kind: 'stone', x: 8, z: -6, label: 'Bia Đá Anh Hùng', solid: true },
      { kind: 'house', x: -11, z: 6, color: '#7f1d1d', solid: true },
      { kind: 'house', x: 11, z: 6, color: '#1e3a8a', solid: true },
      { kind: 'tree', x: -12, z: -2, solid: true }, { kind: 'tree', x: 12, z: -2, solid: true },
      { kind: 'lantern', x: -4, z: 2 }, { kind: 'lantern', x: 4, z: 2 },
      { kind: 'rock', x: -5, z: 6 }, { kind: 'rock', x: 5, z: 6 }
    ],
    npcs: [
      { id: 'pt-master', name: 'Võ Sư Thiết Quyền', role: 'master', x: 0, z: 0.5, robe: '#b91c1c', dialogue: 'Lôi đài Phố Tây có quy củ: tỷ võ đấu tập tính điểm, thắng 2 trong 3 hiệp thì được thưởng kinh nghiệm. Muốn mạnh hơn thì bỏ bạc ra luyện skill với ta — mỗi ngày game luyện được một lần thôi, tham thì hỏng!' },
      { id: 'pt-student', name: 'Đệ Tử Luyện Võ', role: 'town', x: -4, z: 2, robe: '#1d4ed8', dialogue: 'Sư phụ dạy: đứng tấn phải vững, xuất quyền phải nhanh. Thiếu hiệp tỷ võ với ta thử không? Thắng ta được điểm tỷ võ đấy!' },
      { id: 'pt-elder', name: 'Lão Võ Sư', role: 'town', x: 8, z: 0, robe: '#78350f', dialogue: 'Bia đá kia khắc tên bao cao thủ từng thắng trên lôi đài này. Tên của thiếu hiệp rồi cũng sẽ được khắc lên đó thôi — nếu đủ bản lĩnh.' }
    ],
    activities: [
      { id: 'ty-vo', name: '⚔️ Tỷ Võ Đấu Tập', desc: 'Mini-game bấm đúng nhịp 3 hiệp với Đệ Tử Luyện Võ — thắng nhận EXP, tích điểm tỷ võ.' },
      { id: 'luyen-skill', name: '🥋 Luyện Skill Với Võ Sư', desc: 'Tốn 2.000 bạc, +12 Công kích và +100 EXP. Giới hạn 1 lần/ngày game.' }
    ]
  },
  {
    id: 4, file: 'nam-mon.html', name: 'Nam Môn Cổng Thành', desc: 'Tường thành cao, tháp canh, lính gác. Cổng mở ban ngày, đóng ban đêm — muốn qua đêm cần Lệnh Bài hoặc giấy thông hành.',
    theme: { sky: '#8ec4e0', ground: '#8f8a7a', fog: '#a5ccd8' },
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    props: [
      { kind: 'wall', x: 0, z: -8, label: 'Tường Thành Nam Môn', solid: true },
      { kind: 'gate', x: 0, z: -7.4, label: 'Cổng Nam Môn' },
      { kind: 'tower', x: -8, z: -7, label: 'Tháp Canh Tây', solid: true },
      { kind: 'tower', x: 8, z: -7, label: 'Tháp Canh Đông', solid: true },
      { kind: 'house', x: -11, z: 6, color: '#57534e', solid: true },
      { kind: 'house', x: 11, z: 6, color: '#57534e', solid: true },
      { kind: 'lantern', x: -4, z: -4 }, { kind: 'lantern', x: 4, z: -4 },
      { kind: 'tree', x: -12, z: 0, solid: true }, { kind: 'tree', x: 12, z: 0, solid: true },
      { kind: 'rock', x: -6, z: 4 }, { kind: 'rock', x: 6, z: 4 }
    ],
    npcs: [
      { id: 'nm-guard', name: 'Lính Gác Nam Môn', role: 'guard', x: -2, z: -5, robe: '#334155', dialogue: 'Đứng lại! Cổng Nam Môn ban ngày mở cho bá tánh qua lại, ban đêm đóng để phòng giặc. Muốn qua ban đêm thì đưa Lệnh Bài Biện Kinh ra đây — có lệnh bài, ta cấp giấy thông hành cho thiếu hiệp.' },
      { id: 'nm-captain', name: 'Đội Trưởng Thủ Thành', role: 'guard', x: 2, z: -5, robe: '#1e293b', dialogue: 'Ta giữ cổng này mười năm rồi, chưa để lọt một tên gian tế nào. Thiếu hiệp muốn giúp tuần tra thì cứ nói — tuần tra xong có thưởng bạc và kinh nghiệm.' },
      { id: 'nm-traveller', name: 'Khách Thương Qua Đường', role: 'town', x: -5, z: 3, robe: '#92400e', dialogue: 'Đi từ sáng tới giờ mới tới được Nam Môn. Nghe nói ngoài thành có ruộng lúa đẹp lắm, lại có thác nước nữa — thiếu hiệp rảnh thì ghé xem.' }
    ],
    activities: [
      { id: 'xin-qua-cong', name: '🎫 Xin Giấy Thông Hành', desc: 'Ban đêm: xuất trình Lệnh Bài Biện Kinh với lính gác để được cấp giấy thông hành qua cổng.' },
      { id: 'tuan-tra', name: '🛡️ Giúp Tuần Tra', desc: 'Tuần tra cùng lính gác một vòng thành — thưởng bạc và EXP, 1 lần/ngày game.' }
    ]
  },
  {
    id: 5, file: 'bac-uyen.html', name: 'Bắc Uyển Vườn Hoàng Gia', desc: 'Hồ sen mở rộng, đình nghỉ, cầu cong. Cá sen riêng của vườn, câu cá và hái sen đều có thưởng.',
    theme: { sky: '#9fd0dd', ground: '#7ba05b', fog: '#a8d8b8' },
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    props: [
      { kind: 'pond', x: 0, z: 4, label: 'Hồ Sen Bắc Uyển' },
      { kind: 'bridge', x: 0, z: 1.5, label: 'Cầu Cong', solid: true },
      { kind: 'pavilion', x: -9, z: -5, label: 'Đình Nghỉ Ngắm Sen', solid: true },
      { kind: 'tree', x: -12, z: 4, solid: true }, { kind: 'tree', x: 12, z: 4, solid: true },
      { kind: 'tree', x: -9, z: 7, solid: true }, { kind: 'tree', x: 9, z: 7, solid: true },
      { kind: 'flower', x: -5, z: -7 }, { kind: 'flower', x: 5, z: -7 }, { kind: 'flower', x: 0, z: -8 },
      { kind: 'rock', x: -4, z: 6 }, { kind: 'rock', x: 4, z: 6 },
      { kind: 'lantern', x: -9, z: -3 }, { kind: 'lantern', x: 9, z: -3 }
    ],
    npcs: [
      { id: 'bu-gardener', name: 'Người Làm Vườn', role: 'town', x: -6, z: -2, robe: '#15803d', dialogue: 'Hồ sen Bắc Uyển là hồ sen đẹp nhất Biện Kinh — sen ở đây thơm hơn sen hồ thành nhiều! Thiếu hiệp câu cá thì ra bờ hồ, hái sen thì nhẹ tay thôi, đừng làm gãy cành.' },
      { id: 'bu-lady', name: 'Tiểu Thư Ngắm Sen', role: 'town', x: -9, z: -3, robe: '#db2777', dialogue: 'Mỗi chiều ta ra đình này ngắm sen. Nghe nói trong hồ có Cá Chép Vàng Hồ Sen hiếm lắm, ai câu được thì may cả năm!' }
    ],
    activities: [
      { id: 'cau-ca', name: '🎣 Câu Cá Hồ Sen', desc: 'Thanh timing như ở hồ sen Biện Kinh (tốn 1 Mồi Câu) — cá riêng của Bắc Uyển.' },
      { id: 'hai-sen', name: '🌸 Hái Sen Bắc Uyển', desc: 'QTE bấm đúng lúc kim vào vùng sáng — hái được Hạt Sen hoặc Lá Sen.' }
    ]
  },
  {
    id: 6, file: 'ngo-hep.html', name: 'Ngõ Hẹp Khu Ổ Chuột', desc: 'Ngõ tối, đèn dầu lập lòe, NPC bí ẩn. Có quest ẩn 3 bước và chợ đen chỉ mở ban đêm.',
    theme: { sky: '#3a3348', ground: '#5a5148', fog: '#4a4458' },
    bounds: { minX: -12, maxX: 12, minZ: -9, maxZ: 9 },
    props: [
      { kind: 'house', x: -9, z: -6, color: '#44403c', solid: true },
      { kind: 'house', x: 9, z: -6, color: '#44403c', solid: true },
      { kind: 'house', x: -9, z: 6, color: '#57534e', solid: true },
      { kind: 'house', x: 9, z: 6, color: '#57534e', solid: true },
      { kind: 'lantern', x: -4, z: -3 }, { kind: 'lantern', x: 4, z: -3 },
      { kind: 'lantern', x: -4, z: 3 }, { kind: 'lantern', x: 4, z: 3 },
      { kind: 'barrel', x: -6, z: 0 }, { kind: 'barrel', x: 6, z: 0 },
      { kind: 'cart', x: 0, z: -6, solid: true },
      { kind: 'chest', x: 0, z: 7, label: 'Rương Cũ Trong Ngõ' }
    ],
    npcs: [
      { id: 'nh-mystery', name: 'Người Bí Ẩn', role: 'quest', x: -3, z: 0, robe: '#1e1b4b', dialogue: [
        'Suỵt… lại gần đây. Ta có việc nhờ thiếu hiệp, làm xong có thưởng lớn — nhưng đừng để ai biết. Thiếu hiệp có dám nhận không?',
        'Tốt! Ta đánh rơi một Mảnh Giấy Rách đâu đó trong ngõ này. Tìm giúp ta — nó nằm quanh mấy cái thùng gỗ, rương cũ ấy. Tìm được thì quay lại đây.',
        'Tìm được rồi à? Tốt lắm! Nhưng mảnh giấy này phải đưa cho Lão Ăn Mày ở cuối ngõ — ông ấy mới đọc được chữ trên đó. Đi đi, đừng để ai thấy!',
        'Lão Ăn Mày đã đọc xong rồi sao? Vậy là xong việc. Cảm ơn thiếu hiệp — đây là phần thưởng, và nhớ: chuyện này chưa từng xảy ra.'
      ] },
      { id: 'nh-beggar', name: 'Lão Ăn Mày', role: 'quest', x: 6, z: 5, robe: '#78350f', dialogue: 'Hừm… mảnh giấy này viết bằng mực tàng hình, chỉ người từng luyện Quỳ Hoa mới đọc được. Để lão xem… À, ra là vậy! Đưa lại cho Người Bí Ẩn, bảo rằng “trăng lên thì chợ mở” — ông ấy sẽ hiểu.' },
      { id: 'nh-trader', name: 'Thương Nhân Chợ Đen', role: 'blackmarket', x: 3, z: -3, robe: '#0f172a', dialogue: 'Chợ đen chỉ mở ban đêm thôi, thiếu hiệp ạ. Ban ngày ta chỉ là người bán đèn dầu… Ban đêm quay lại, đồ hiếm giá cao — nhưng đáng từng đồng bạc.' }
    ],
    activities: [
      { id: 'quest-an', name: '🕵️ Quest Ẩn: Mảnh Giấy Rách', desc: 'Chuỗi 3 bước với Người Bí Ẩn và Lão Ăn Mày — tìm mảnh giấy, đưa đi giải mã, nhận thưởng.' },
      { id: 'cho-den', name: '🌑 Chợ Đen Ngõ Hẹp', desc: 'Chỉ mở ban đêm (18h–6h giờ game): bán đồ hiếm giá cao — Đá Cường Hóa, Tụ Khí Đan, Huyền Thiết Tinh.' }
    ]
  },
  {
    id: 7, file: 'mieu-co.html', name: 'Miếu Cổ Di Tích', desc: 'Miếu đổ, tượng Phật rêu phong. Đọc lore nối chuyện Lão Kể Chuyện, và đánh bại Boss ẩn để nhận Lệnh Bài.',
    theme: { sky: '#b8a888', ground: '#7a6f5a', fog: '#a89878' },
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    props: [
      { kind: 'temple', x: 0, z: -6, label: 'Miếu Cổ', solid: true },
      { kind: 'statue', x: 0, z: -3.5, label: 'Tượng Phật Cổ', solid: true },
      { kind: 'altar', x: 0, z: -1.5, label: 'Bàn Thờ Cũ', solid: true },
      { kind: 'stone', x: -8, z: -2, label: 'Bia Đá Rêu Phong', solid: true },
      { kind: 'stone', x: 8, z: -2, label: 'Bia Đá Rêu Phong', solid: true },
      { kind: 'tree', x: -11, z: 4, solid: true }, { kind: 'tree', x: 11, z: 4, solid: true },
      { kind: 'rock', x: -5, z: 5 }, { kind: 'rock', x: 5, z: 5 },
      { kind: 'lantern', x: -3, z: -1 }, { kind: 'lantern', x: 3, z: -1 },
      { kind: 'flower', x: -8, z: 6 }, { kind: 'flower', x: 8, z: 6 }
    ],
    npcs: [
      { id: 'mc-monk', name: 'Lão Tăng Trông Miếu', role: 'lore', x: -4, z: -2, robe: '#a16207', dialogue: 'Miếu này có từ trước cả khi Biện Kinh lập thành. Lão Kể Chuyện ở quảng trường hay kể chuyện hồ sen, chuyện Long Vương — nhưng ít ai biết, giao long trấn hồ năm xưa chính là từ miếu này mà ra. Đọc bia đá đi, rồi thiếu hiệp sẽ hiểu.' },
      { id: 'mc-guardian', name: 'Hộ Pháp Đá', role: 'boss', x: 4, z: -2, robe: '#57534e', dialogue: 'Kẻ nào dám bước vào miếu cổ… Tượng Phật đã chọn ta làm người giữ cửa. Muốn lấy Lệnh Bài thì đánh bại ta trước đã — nhưng nhớ, mỗi ngày game chỉ được thách đấu một lần!' }
    ],
    activities: [
      { id: 'doc-lore', name: '📖 Đọc Truyền Thuyết Miếu Cổ', desc: 'Lore nối tiếp 5 câu chuyện của Lão Kể Chuyện ở Biện Kinh + bí mật của miếu.' },
      { id: 'boss-an', name: '👹 Boss Ẩn: Hộ Pháp Đá', desc: 'Thắng nhận Lệnh Bài Biện Kinh + thưởng lớn. Chỉ thách đấu 1 lần/ngày game.' }
    ],
    boss: { name: 'Hộ Pháp Đá Miếu Cổ', hp: 12000, reward: { silver: 8000, gold: 15, exp: 600, item: 'lenh_bai' }, oncePerDay: true }
  },
  {
    id: 8, file: 'ben-song.html', name: 'Bến Sông Cảng', desc: 'Thuyền, cầu tàu, cá chép. Câu cá bên bến, hoặc du thuyền ngắm cảnh tốn ít bạc.',
    theme: { sky: '#7ec8ee', ground: '#8a9a7b', fog: '#9fd0dd' },
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    props: [
      { kind: 'pond', x: 0, z: 6, label: 'Mặt Sông Bến Cảng' },
      { kind: 'dock', x: -2, z: 3, label: 'Cầu Tàu', solid: true },
      { kind: 'boat', x: -6, z: 6, label: 'Thuyền Du Ngoạn' },
      { kind: 'boat', x: 5, z: 7, label: 'Thuyền Chài' },
      { kind: 'house', x: -11, z: -6, color: '#92400e', solid: true },
      { kind: 'house', x: 11, z: -6, color: '#78350f', solid: true },
      { kind: 'tree', x: -12, z: 2, solid: true }, { kind: 'tree', x: 12, z: 2, solid: true },
      { kind: 'lantern', x: -2, z: 0 }, { kind: 'lantern', x: 2, z: 0 },
      { kind: 'barrel', x: -8, z: 0 }, { kind: 'cart', x: 8, z: 0, solid: true }
    ],
    npcs: [
      { id: 'bs-fisher', name: 'Lão Ngư Dân', role: 'town', x: -5, z: 2, robe: '#0f766e', dialogue: 'Sông này nhiều cá chép lắm, nhất là Cá Chép Vàng Sông — câu được một con là đủ tiền ăn cả tháng! Thiếu hiệp có Mồi Câu thì cứ ra cầu tàu mà thả cần.' },
      { id: 'bs-boatman', name: 'Người Lái Đò', role: 'boat', x: -2, z: 1, robe: '#1d4ed8', dialogue: 'Du thuyền ngắm cảnh không, thiếu hiệp? Chỉ 300 bạc một chuyến, ngắm hoàng hôn trên sông, gió mát lồng lộng — đi xong còn được thưởng cá tươi mang về!' }
    ],
    activities: [
      { id: 'cau-ca', name: '🎣 Câu Cá Bến Sông', desc: 'Thanh timing (tốn 1 Mồi Câu) — cá riêng của Bến Sông, có Cá Chép Vàng Sông hiếm.' },
      { id: 'du-thuyen', name: '⛵ Du Thuyền Ngắm Cảnh', desc: 'Tốn 300 bạc, ngắm cảnh sông nước + thưởng nhỏ. 1 lần/ngày game.' }
    ]
  },
  {
    id: 9, file: 'ruong-lua.html', name: 'Ruộng Lúa Ven Thành', desc: 'Ruộng bậc thang, nông dân, trâu. Gieo hạt rồi quay lại ngày game sau để gặt, thưởng lúa và bạc.',
    theme: { sky: '#a8d8a8', ground: '#8a9a4b', fog: '#b8d8a8' },
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    props: [
      { kind: 'field', x: -7, z: -3, label: 'Ruộng Bậc Thang' },
      { kind: 'field', x: 7, z: -3, label: 'Ruộng Bậc Thang' },
      { kind: 'field', x: -7, z: 5, label: 'Ruộng Lúa Chín' },
      { kind: 'field', x: 7, z: 5, label: 'Ruộng Lúa Chín' },
      { kind: 'buffalo', x: 0, z: 0, label: 'Trâu Cày', solid: true },
      { kind: 'house', x: -12, z: -8, color: '#78350f', solid: true },
      { kind: 'tree', x: 12, z: -8, solid: true },
      { kind: 'tree', x: -12, z: 8, solid: true },
      { kind: 'well', x: 12, z: 6, solid: true },
      { kind: 'rock', x: 0, z: -8 }
    ],
    npcs: [
      { id: 'rl-farmer', name: 'Lão Nông Dân', role: 'farmer', x: -3, z: -1, robe: '#92400e', dialogue: 'Ruộng nhà lão quanh năm được mùa nhờ nước hồ sen. Thiếu hiệp muốn thử làm nông không? Gieo hạt hôm nay, ngày game mai quay lại gặt — lúa chín vàng, thưởng bạc hậu lắm!' },
      { id: 'rl-wife', name: 'Bà Nông Dân', role: 'town', x: 3, z: 1, robe: '#be185d', dialogue: 'Trâu nhà ta hiền lắm, thiếu hiệp cứ vuốt ve nó. Ai giúp lão nhà ta gieo gặt thì nhà ta mời cơm nắm muối vừng, ngon hết sảy!' },
      { id: 'rl-kid', name: 'Đứa Trẻ Chăn Trâu', role: 'town', x: 0, z: 4, robe: '#15803d', dialogue: 'Trâu tên là Vàng, nó thích ăn cỏ non nhất. Thiếu hiệp gieo lúa xong nhớ cho Vàng ăn cỏ nhé — không, đùa đấy, Vàng tự ăn được rồi!' }
    ],
    activities: [
      { id: 'gieo-gat', name: '🌾 Gieo / Gặt Lúa', desc: 'Gieo hạt tốn 200 bạc. Lúa chín vào ngày game hôm sau — quay lại gặt nhận Lúa Vàng + bạc + EXP.' }
    ]
  },
  {
    id: 10, file: 'nghia-trang.html', name: 'Nghĩa Trang U Ám', desc: 'Bia mộ, sương mù, đom đóm. Chỉ mở ban đêm — ma quái xuất hiện, đánh đuổi hoặc thắp hương nhận thưởng.',
    theme: { sky: '#1a1a2e', ground: '#3a3a4a', fog: '#2a2a3a' },
    bounds: { minX: -13, maxX: 13, minZ: -9, maxZ: 9 },
    props: [
      { kind: 'grave', x: -8, z: -5, label: 'Mộ Cổ', solid: true },
      { kind: 'grave', x: -3, z: -6, label: 'Mộ Cổ', solid: true },
      { kind: 'grave', x: 3, z: -6, label: 'Mộ Cổ', solid: true },
      { kind: 'grave', x: 8, z: -5, label: 'Mộ Cổ', solid: true },
      { kind: 'grave', x: -8, z: 3, label: 'Mộ Mới', solid: true },
      { kind: 'grave', x: 8, z: 3, label: 'Mộ Mới', solid: true },
      { kind: 'grave', x: 0, z: -7, label: 'Mộ Vô Danh', solid: true },
      { kind: 'firefly', x: 0, z: 0 },
      { kind: 'tree', x: -11, z: 0, solid: true }, { kind: 'tree', x: 11, z: 0, solid: true },
      { kind: 'lantern', x: -5, z: 0 }, { kind: 'lantern', x: 5, z: 0 },
      { kind: 'rock', x: 0, z: 6 }
    ],
    npcs: [
      { id: 'nt-keeper', name: 'Người Trông Mộ', role: 'town', x: -1, z: 2, robe: '#44403c', dialogue: 'Nghĩa trang này ban ngày vắng hoe, ban đêm mới “đông vui”. Ma quái hay hiện ra trêu người — thiếu hiệp gan thì đánh đuổi chúng đi, hoặc thắp nén hương cho người đã khuất, ắt có lộc.' },
      { id: 'nt-ghost', name: 'Hồn Ma Lang Thang', role: 'ghost', x: 4, z: -2, robe: '#a5b4fc', dialogue: 'Ta… ta chỉ muốn có người thắp cho nén hương… Hoặc ai gan thì đuổi ta đi cũng được, ta không giận đâu…' }
    ],
    activities: [
      { id: 'thap-huong', name: '🕯️ Thắp Hương', desc: 'Ban đêm: tốn 300 bạc mua hương, thắp cho người đã khuất — nhận lộc + EXP. 1 lần/ngày game.' },
      { id: 'danh-duoi-ma', name: '👻 Đánh Đuổi Ma Quái', desc: 'Ban đêm: 3 hồn ma hiện ra, bấm trúng để đánh đuổi — đủ 3 con nhận thưởng. 1 lần/ngày game.' }
    ],
    lock: { type: 'night' }
  },
  {
    id: 11, file: 'thac-nuoc.html', name: 'Thác Nước Ngoại Ô', desc: 'Thác, đá, cầu treo. Nhặt đủ bộ 5 vật phẩm thác nước trong khu rồi đổi thưởng lớn.',
    theme: { sky: '#7ec8ee', ground: '#6a8a6a', fog: '#9fd0dd' },
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    props: [
      { kind: 'waterfall', x: 0, z: -7, label: 'Thác Nước' },
      { kind: 'pond', x: 0, z: -3, label: 'Hồ Nước Thác' },
      { kind: 'bridge', x: 0, z: 1, label: 'Cầu Treo', solid: true },
      { kind: 'rock', x: -6, z: -5 }, { kind: 'rock', x: 6, z: -5 },
      { kind: 'rock', x: -9, z: 2 }, { kind: 'rock', x: 9, z: 2 },
      { kind: 'tree', x: -12, z: -6, solid: true }, { kind: 'tree', x: 12, z: -6, solid: true },
      { kind: 'tree', x: -12, z: 6, solid: true }, { kind: 'tree', x: 12, z: 6, solid: true },
      { kind: 'thac-item', x: -8, z: -2, itemId: 'thac1', label: 'Đá Thác Cổ' },
      { kind: 'thac-item', x: 8, z: -2, itemId: 'thac2', label: 'Lá Thác Vàng' },
      { kind: 'thac-item', x: -5, z: 6, itemId: 'thac3', label: 'Ngọc Thác Xanh' },
      { kind: 'thac-item', x: 5, z: 6, itemId: 'thac4', label: 'Hoa Thác Trắng' },
      { kind: 'thac-item', x: 0, z: 8, itemId: 'thac5', label: 'Trân Châu Thác' }
    ],
    npcs: [
      { id: 'tn-hermit', name: 'Ẩn Sĩ Thác Nước', role: 'town', x: -3, z: 0, robe: '#0f766e', dialogue: 'Thác này có 5 báu vật: Đá Thác Cổ, Lá Thác Vàng, Ngọc Thác Xanh, Hoa Thác Trắng và Trân Châu Thác. Nhặt đủ 5 món đem về đây, lão đổi cho thiếu hiệp một phần thưởng xứng đáng!' },
      { id: 'tn-kid', name: 'Đứa Trẻ Bắt Cá', role: 'town', x: 3, z: -1, robe: '#1d4ed8', dialogue: 'Dưới chân thác có nhiều cá lắm! Nhưng báu vật thác nước thì khó tìm hơn — thiếu hiệp chịu khó đi quanh thác mà nhặt.' }
    ],
    activities: [
      { id: 'nhat-do', name: '💎 Nhặt Vật Phẩm Thác', desc: 'Đi tới gần 5 vật phẩm phát sáng trong khu rồi nhặt — tiến độ hiện ở bảng hoạt động.' },
      { id: 'doi-thuong', name: '🎁 Đổi Thưởng Bộ Sưu Tập', desc: 'Đủ bộ 5 vật phẩm thác nước thì đổi thưởng lớn: bạc + KNB + EXP (1 lần).' }
    ]
  },
  {
    id: 12, file: 'hang-dong.html', name: 'Hang Động Bí Mật', desc: 'Hang tối, tinh thể phát sáng, hồ ngầm. Boss cuối mạnh nhất game hiện tại trấn giữ trong này.',
    theme: { sky: '#0f0f1e', ground: '#2e2a33', fog: '#1e1a2e' },
    bounds: { minX: -13, maxX: 13, minZ: -9, maxZ: 9 },
    props: [
      { kind: 'cave', x: 0, z: -7, label: 'Cửa Hang Sâu', solid: true },
      { kind: 'crystal', x: -7, z: -4, label: 'Tinh Thể Tím' },
      { kind: 'crystal', x: 7, z: -4, label: 'Tinh Thể Xanh' },
      { kind: 'crystal', x: -9, z: 3, label: 'Tinh Thể Đỏ' },
      { kind: 'crystal', x: 9, z: 3, label: 'Tinh Thể Vàng' },
      { kind: 'pond', x: 0, z: 4, label: 'Hồ Ngầm' },
      { kind: 'rock', x: -4, z: -2 }, { kind: 'rock', x: 4, z: -2 },
      { kind: 'rock', x: -6, z: 6 }, { kind: 'rock', x: 6, z: 6 },
      { kind: 'chest', x: 0, z: 7, label: 'Rương Kho Báu Hang Động' },
      { kind: 'lantern', x: -3, z: 0 }, { kind: 'lantern', x: 3, z: 0 }
    ],
    npcs: [
      { id: 'hd-demon', name: 'Ma Quân Hang Động', role: 'boss', x: 0, z: -4, robe: '#7e22ce', dialogue: 'Ha ha ha! Lệnh Bài thì có ích gì — muốn kho báu trong hang thì bước qua xác ta đã! Mỗi ngày game chỉ được thách đấu một lần, thua thì về luyện thêm đi!' },
      { id: 'hd-explorer', name: 'Nhà Thám Hiểm', role: 'town', x: -6, z: 2, robe: '#92400e', dialogue: 'Ta vào hang này ba lần, cả ba lần đều chạy thục mạng ra ngoài! Ma Quân trong hang là kẻ mạnh nhất vùng này — thiếu hiệp chuẩn bị kỹ rồi hãy thách đấu.' }
    ],
    activities: [
      { id: 'boss-cuoi', name: '👹 Boss Cuối: Ma Quân Hang Động', desc: 'Boss mạnh nhất game hiện tại. Thắng nhận thưởng rất lớn. Chỉ thách đấu 1 lần/ngày game.' }
    ],
    boss: { name: 'Ma Quân Hang Động', hp: 30000, reward: { silver: 20000, gold: 40, exp: 1500, item: null }, oncePerDay: true },
    lock: { type: 'quest', needFlag: 'boss_mieu_co', needItem: 'lenh_bai' }
  }
];

function districtById(id) {
  return DISTRICTS.find(d => d.id === Number(id)) || null;
}
function districtByFile(file) {
  return DISTRICTS.find(d => d.file === file) || null;
}

/* Lore Miếu Cổ — nối tiếp 5 đoạn của Lão Kể Chuyện ở Biện Kinh (NPC_LORE
   trong src/01-data.js: giao long trấn hồ, Trúc Ma Lão Tổ, Đài Phật Anh Đào,
   Thần Điêu Đại Hiệp, Long Vương Biển Đông) + bí mật riêng của miếu. */
const DISTRICT_MIEU_LORE = [
  'Ngày xưa, Biện Kinh chỉ là một bến đò nhỏ bên hồ sen. Một đêm trăng, có con giao long từ Biển Đông bơi ngược dòng về đây, thấy sen nở thơm ngát bèn ở lại trấn giữ mặt hồ — từ đó hồ sen Biện Kinh quanh năm không bao giờ cạn.',
  'Trúc Ma Lão Tổ vốn là một tiều phu đốn trúc ở Rừng Trúc U Minh. Ông nhặt được một cuốn tàn kinh dưới gốc trúc cổ, luyện ba mươi năm không ra khỏi rừng, đến khi xuất quan thì lá trúc trong tay đã hóa thành phi đao.',
  'Đài Phật Anh Đào được dựng để trấn yểm Hộ Pháp Hắc Bạch — hai anh em sinh đôi, một người theo Phật, một người theo Ma. Họ giao hẹn: ai thua luận kiếm dưới tượng Phật thì phải canh giữ đài này trọn đời.',
  'Thần Điêu Đại Hiệp Dương Quá từng ghé Biện Kinh một lần duy nhất, để lại một thanh Huyền Thiết Trọng Kiếm gãy chuôi ở lò rèn nhà họ Thiết. Thợ rèn đời nào cũng kể: ai rèn lại được thanh kiếm ấy sẽ là thiên hạ đệ nhất.',
  'Long Vương Biển Đông mỗi năm lại nổi giận một lần, dâng sóng tràn vào Hồ Sen. Các đời minh chủ võ lâm bèn lập ra Lôi Đài Tỷ Võ — kẻ nào thắng được Long Vương sẽ được Long Châu, hiệu lệnh cả giang hồ.',
  'Còn Miếu Cổ này — lão tăng trông miếu kể — chính là nơi giao long trấn hồ từng hóa thân thành người để nghe kinh. Tượng Phật trong miếu được tạc từ đá của Rừng Trúc U Minh, nên Hộ Pháp Đá canh giữ nơi đây cũng mang sức mạnh của trúc và của long. Ai thắng được Hộ Pháp Đá, sẽ được Lệnh Bài Biện Kinh — vật mở đường vào Hang Động Bí Mật, nơi Ma Quân trấn giữ kho báu lớn nhất vùng.'
];

/* Export cho Node (nhóm B test bằng tools/test-districts.cjs); trong trình
   duyệt các const trên đã nằm ở global lexical scope, vẫn gắn thêm lên window
   để District và panel bản đồ dùng chắc chắn. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DISTRICTS, DISTRICT_SAVE_KEY, DISTRICT_ITEM_LENH_BAI,
    defaultDistrictFlags, ensureDistrictFlags, isNightHour, hasDistrictItem,
    districtHour, districtDay, districtSeasonName,
    canEnterDistrict, districtById, districtByFile, DISTRICT_MIEU_LORE
  };
}
if (typeof window !== 'undefined') {
  window.DISTRICTS = DISTRICTS;
  window.canEnterDistrict = canEnterDistrict;
  window.defaultDistrictFlags = defaultDistrictFlags;
  window.ensureDistrictFlags = ensureDistrictFlags;
  window.isNightHour = isNightHour;
  window.hasDistrictItem = hasDistrictItem;
  window.districtById = districtById;
  window.districtByFile = districtByFile;
  window.DISTRICT_ITEM_LENH_BAI = DISTRICT_ITEM_LENH_BAI;
  window.DISTRICT_MIEU_LORE = DISTRICT_MIEU_LORE;
  window.DISTRICT_SAVE_KEY = DISTRICT_SAVE_KEY;
}
/* DISTRICT-END */
