/* Harness kiểm thử logic thuần của Chợ (src/07-shop.js) — chạy bằng Node, không cần trình duyệt.
   node tools/test-shop.cjs   (exit 1 nếu có FAIL) */
'use strict';
const shop = require('../src/07-shop.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}
function fresh() { return shop.shopDefaultSave(); }

(function main() {
  // 1. Mua trừ tiền đúng (bạc)
  var s = fresh();
  var r = shop.shopBuy(s, 'tb01', 1, {});
  check('mua tb01 tru dung 800 bac', r.ok && s.player.silver === 40932 - 800 && s.player.atk === 68 + 12, JSON.stringify(r) + ' silver=' + s.player.silver + ' atk=' + s.player.atk);
  check('mua tb01 vao tui do', s.inventory.some(function (i) { return i.name === 'Thiết Kiếm Giang Hồ' && i.qty === 1; }));

  // 2. Mua bằng KNB
  s = fresh();
  r = shop.shopBuy(s, 'tb06', 1, {});
  check('mua tb06 tru dung 120 KNB', r.ok && s.player.gold === 455 - 120 && s.player.atk === 68 + 180, 'gold=' + s.player.gold);

  // 3. Thiếu tiền bị từ chối, save không đổi
  s = fresh();
  var before = JSON.stringify(s);
  r = shop.shopBuy(s, 'tb12', 2, {}); // 260 KNB x2 = 520 > 455
  check('thieu KNB bi tu choi', !r.ok && JSON.stringify(s) === before, JSON.stringify(r));
  s.player.silver = 100;
  before = JSON.stringify(s);
  r = shop.shopBuy(s, 'tb01', 1, {});
  check('thieu bac bi tu choi, save khong doi', !r.ok && JSON.stringify(s) === before, JSON.stringify(r));

  // 4. Bán lại 50%
  s = fresh();
  shop.shopBuy(s, 'tb01', 1, {});
  var idx = s.inventory.findIndex(function (i) { return i.name === 'Thiết Kiếm Giang Hồ'; });
  var silverBeforeSell = s.player.silver;
  var sr = shop.shopSell(s, idx);
  check('ban lai 50% (400 bac)', sr.ok && sr.value === 400 && s.player.silver === silverBeforeSell + 400, JSON.stringify(sr) + ' silver=' + s.player.silver);
  check('ban trang bi tru lai chi so cong', s.player.atk === 68, 'atk=' + s.player.atk);
  check('ban het thi het khoi tui', !s.inventory.some(function (i) { return i.name === 'Thiết Kiếm Giang Hồ'; }));

  // 5. Bán đồ ngoài catalogue (fallback) + đồ lạ mặc định 25 bạc
  s = fresh();
  var q = shop.shopSellQuote(s, 0); // Kim Sáng Dược mặc định
  check('gia ban Kim Sang Duoc fallback 75 bac', q && q.value === 75 && q.cur === 'silver', JSON.stringify(q));
  s.inventory.push({ id: 'x', name: 'Đồ Lạ Không Tên', icon: '❓', type: 'Linh tinh', desc: '', qty: 1 });
  q = shop.shopSellQuote(s, s.inventory.length - 1);
  check('gia ban do la mac dinh 25 bac', q && q.value === 25, JSON.stringify(q));

  // 6. Làm mới kho theo mốc giờ: ổn định trong giờ, đổi khi qua giờ
  var st1 = {};
  var a = shop.shopRefreshStock(st1, Date.parse('2026-11-25T10:15:00Z'));
  var feat10 = st1.featured.slice();
  var disc10 = st1.discount;
  var b = shop.shopRefreshStock(st1, Date.parse('2026-11-25T10:45:00Z'));
  check('kho on dinh trong cung gio', a.changed === true && b.changed === false && JSON.stringify(st1.featured) === JSON.stringify(feat10));
  var c = shop.shopRefreshStock(st1, Date.parse('2026-11-25T11:00:00Z'));
  check('kho doi khi qua moc gio', c.changed === true && st1.hourKey === '2026-11-25T11', JSON.stringify(st1));
  check('kho gio gom 6 mon Su Thi/Truyen Thuyet', st1.featured.length === 6 &&
    st1.featured.every(function (id) { var it = shop.shopFindItem(id); return it && (it.rarity === 'Sử Thi' || it.rarity === 'Truyền Thuyết'); }),
    JSON.stringify(st1.featured));
  check('cung gio -> cung kho (xac dinh)', (function () {
    var s2 = {};
    shop.shopRefreshStock(s2, Date.parse('2026-11-25T10:20:00Z'));
    return JSON.stringify(s2.featured) === JSON.stringify(feat10) && s2.discount === disc10;
  })());

  // 7. Giá giảm theo giờ áp dụng khi mua
  s = fresh();
  var stF = {};
  shop.shopRefreshStock(stF, Date.parse('2026-11-25T10:15:00Z'));
  var featId = stF.featured[0];
  var featItem = shop.shopFindItem(featId);
  var expectPrice = Math.max(1, Math.floor(featItem.price * (100 - stF.discount) / 100));
  check('gia giam theo gio dung cong thuc', shop.shopEffectivePrice(featItem, stF) === expectPrice,
    'discount=' + stF.discount + ' price=' + featItem.price + ' eff=' + shop.shopEffectivePrice(featItem, stF));
  s.player.silver = 1000000; s.player.gold = 1000000;
  var silver0 = s.player.silver, gold0 = s.player.gold;
  r = shop.shopBuy(s, featId, 1, stF);
  var spentExpect = featItem.cur === 'gold' ? gold0 - expectPrice : silver0 - expectPrice;
  check('mua mon giam gia tru dung tien', r.ok && r.spent === expectPrice &&
    (featItem.cur === 'gold' ? s.player.gold === spentExpect : s.player.silver === spentExpect),
    JSON.stringify(r));

  // 8. Gói tân thủ: mua 1 lần, lần 2 bị từ chối; đồ + thưởng vào save
  s = fresh();
  var today = '2026-11-25';
  var g = shop.shopClaimBundle(s, 'goi-tanthu', today);
  check('mua goi tan thu ok', g.ok && s.player.silver === 40932 - 1000 + 5000, 'silver=' + s.player.silver);
  check('goi tan thu tang do vao tui', s.inventory.some(function (i) { return i.name === 'Kim Sáng Dược' && i.qty >= 5; }));
  g = shop.shopClaimBundle(s, 'goi-tanthu', today);
  check('goi once mua lan 2 bi tu choi', !g.ok, JSON.stringify(g));

  // 9. Gói ngày: 1 lần/ngày, sang ngày mới mua lại được
  s = fresh();
  g = shop.shopClaimBundle(s, 'goi-ngay', '2026-11-25');
  check('goi ngay lan 1 ok', g.ok, JSON.stringify(g));
  g = shop.shopClaimBundle(s, 'goi-ngay', '2026-11-25');
  check('goi ngay cung ngay lan 2 bi tu choi', !g.ok, JSON.stringify(g));
  g = shop.shopClaimBundle(s, 'goi-ngay', '2026-11-26');
  check('goi ngay sang ngay moi mua lai duoc', g.ok, JSON.stringify(g));

  // 10. Lọc/tìm kiếm
  check('loc tab than-binh = 12 mon', shop.shopFilter({ tab: 'than-binh' }).length === 12);
  check('loc do hiem Truyen Thuyet = 12 mon', shop.shopFilter({ rarity: 'Truyền Thuyết' }).length === 12);
  check('tim "kiem" thay mon co kiem', shop.shopFilter({ query: 'kiếm' }).length >= 5, 'n=' + shop.shopFilter({ query: 'kiếm' }).length);
  check('tong catalogue = 72 mon', shop.SHOP_CATALOG.length === 72, 'n=' + shop.SHOP_CATALOG.length);
  check('tong goi = 4', shop.SHOP_BUNDLES.length === 4);

  // 11. Đan dược EXP lên cấp đúng công thức game (exp 64/160, +100 -> lên cấp, maxExp 227)
  s = fresh();
  s.player.exp = 64; s.player.maxExp = 160; s.player.level = 3;
  r = shop.shopBuy(s, 'dd02', 4, {}); // +120 exp -> 184 >= 160: lên 1 cấp, còn 24 exp
  check('an dan duoc EXP len cap dung', r.ok && s.player.level === 4 && s.player.exp === 24 && s.player.maxExp === 227,
    'lv=' + s.player.level + ' exp=' + s.player.exp + ' maxExp=' + s.player.maxExp);

  // 12. Save round-trip JSON: giữ nguyên player/inventory/flags.shop
  s = fresh();
  shop.shopBuy(s, 'tb01', 1, {});
  shop.shopClaimBundle(s, 'goi-tanthu', '2026-11-25');
  var st = shop.shopEnsureShopState(s);
  shop.shopRefreshStock(st, Date.parse('2026-11-25T10:15:00Z'));
  var parsed = JSON.parse(JSON.stringify(s));
  check('save round-trip giu duoc tien/tui/flags.shop',
    parsed.player.silver === s.player.silver &&
    parsed.inventory.length === s.inventory.length &&
    parsed.flags.shop.hourKey === '2026-11-25T10' &&
    parsed.flags.shop.claimed['goi-tanthu'] === 'ever' &&
    parsed.v === 2, JSON.stringify(parsed.flags));

  // 13. Mua món không tồn tại / bán vị trí sai không crash
  s = fresh();
  check('mua id la bi tu choi', !shop.shopBuy(s, 'khong-co', 1, {}).ok);
  check('ban vi tri sai bi tu choi', !shop.shopSell(s, 999).ok);

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
