// Ghép mongvolam.html từ src/ + lib/ (three.js r128, pixi 8.6.6 inline)
// Bản port Node.js của tools/build.ps1 — chạy trên Linux/macOS/Windows:
//   node tools/build.mjs
// Ghi ra mongvolam.html (UTF-8 không BOM) + .zwork/build/game.js (JS nối lại, để kiểm tra).
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const lib = path.join(root, 'lib');

// Đọc UTF-8, bỏ BOM đầu file nếu có (giống Read-Text trong build.ps1).
function readText(p) {
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

const style = readText(path.join(src, 'style.css'));
/* DISTRICT-BEGIN — src/10b-districts.js (nhóm A: DISTRICTS + canEnterDistrict)
   đi cùng game chính để panel Bản Đồ Khu Vực + cổng dịch chuyển dùng được.
   File nhóm A chưa có thì build 4 trang chính vẫn chạy (cảnh báo rõ),
   khối DISTRICT ở cuối file sẽ báo thiếu và dừng trước khi build map/. */
const districtDataFile = '10b-districts.js';
const hasDistrictData = existsSync(path.join(src, districtDataFile));
if (!hasDistrictData) console.warn(`WARN: ${districtDataFile} chua co (nhom A) — mongvolam.html build tam khong co DISTRICTS/canEnterDistrict, chay lai build khi file da co.`);
const parts = ['01-data.js', '02-world.js', '02b-env.js', '03-battle.js', '03b-arenas.js', '04-info.js', '05-ui.js', ...(hasDistrictData ? [districtDataFile] : []), '11-fbx.js', '12-fbx-ui.js', '13-editor-patch.js', '06-boot.js'];
const jsParts = parts.map((f) => readText(path.join(src, f)));
const js = '(function(){\n' + jsParts.join('\n') + '\n})();';

const three = readText(path.join(lib, 'three.min.js'));
const pixi = readText(path.join(lib, 'pixi.min.js'));
/* FBX-BEGIN — chỉ trang mongvolam.html mới inline fflate + FBXLoader
   (Shop/Newgame/Event/map không đổi dung lượng). */
const fflate = readText(path.join(lib, 'fflate.min.js'));
const fbxLoader = readText(path.join(lib, 'FBXLoader.js'));
/* FBX-END */
const tpl = readText(path.join(src, 'index.template.html'));

// Kiểm tra giống bản ps1: lib không được chứa chuỗi '</script' (sẽ phá thẻ <script>).
if (three.includes('</script')) throw new Error('three.min.js chua </script');
if (pixi.includes('</script')) throw new Error('pixi.min.js chua </script');
if (fflate.includes('</script')) throw new Error('fflate.min.js chua </script');
if (fbxLoader.includes('</script')) throw new Error('FBXLoader.js chua </script');

// Thay placeholder theo đúng thứ tự của ps1 (String.Replace thay tất cả lần xuất hiện).
// QUAN TRỌNG: dùng hàm thay thế () => ... để chuỗi chèn được giữ nguyên từng byte.
// String.replaceAll(x, str) sẽ diễn giải các mẫu $ trong str ($$, $&, $', $`) —
// pixi.min.js chứa "$&" và game JS chứa "$$" nên dùng chuỗi thường sẽ làm hỏng file.
const out = tpl
  .replaceAll('__STYLE__', () => style)
  .replaceAll('__THREE__', () => three)
  .replaceAll('__PIXI__', () => pixi)
  .replaceAll('__FFLATE__', () => fflate)
  .replaceAll('__FBXLOADER__', () => fbxLoader)
  .replaceAll('__GAME__', () => js);

const dest = path.join(root, 'mongvolam.html');
writeFileSync(dest, out, 'utf8'); // Node ghi UTF-8 không BOM theo mặc định.

/* ITCH-BEGIN */
// itch.io cần index.html làm entry — bản sao y hệt mongvolam.html vừa build
// (đọc lại file vừa ghi rồi ghi ra, cùng 1 nguồn build, không viết tay 2 bản).
// GIỮ NGUYÊN mongvolam.html. Deterministic: cùng nội dung, không timestamp.
// Lý do cần cả 2 file: các trang game link về file chính bằng
// location.href = 'mongvolam.html' (Shop/Newgame/Event) và '../mongvolam.html'
// (11 trang map/), nên gói itch.io phải chứa cả index.html (entry) VÀ
// mongvolam.html (byte-identical) thì link nội bộ mới chạy.
const indexDest = path.join(root, 'index.html');
writeFileSync(indexDest, readFileSync(dest, 'utf8'), 'utf8');
console.log(`OK -> ${indexDest} (ban sao y het mongvolam.html, ${Math.round(statSync(indexDest).size / 1024)} KB)`);
/* ITCH-END */

const chkDir = path.join(root, '.zwork', 'build');
mkdirSync(chkDir, { recursive: true });
writeFileSync(path.join(chkDir, 'game.js'), js, 'utf8');

const kb = (n) => Math.round(n / 1024);
console.log(`OK -> ${dest} (${kb(statSync(dest).size)} KB, js ${kb(Buffer.byteLength(js, 'utf8'))} KB)`);

/* SHOP-BEGIN */
// Ghép Shop.html từ src/shop.template.html + src/07-shop.js (trang chợ độc lập,
// tự chứa, không CDN). Build lại mongvolam.html không đổi ngoài hook chợ.
const shopTpl = readText(path.join(src, 'shop.template.html'));
const shopJs = readText(path.join(src, '07-shop.js'));
if (shopJs.includes('</script')) throw new Error('07-shop.js chua </script');
const shopOut = shopTpl.replaceAll('__SHOP__', () => shopJs);
const shopDest = path.join(root, 'Shop.html');
writeFileSync(shopDest, shopOut, 'utf8');
console.log(`OK -> ${shopDest} (${kb(statSync(shopDest).size)} KB)`);
/* SHOP-END */

/* NEWGAME-BEGIN */
// Ghép Newgame.html từ src/newgame.template.html + src/08-newgame.js (màn hình chính độc lập).
const ngTpl = readText(path.join(src, 'newgame.template.html'));
const ngJs = readText(path.join(src, '08-newgame.js'));
if (ngJs.includes('</script')) throw new Error('08-newgame.js chua </script');
const ngOut = ngTpl.replaceAll('__NEWGAME__', () => ngJs);
const ngDest = path.join(root, 'Newgame.html');
writeFileSync(ngDest, ngOut, 'utf8');
console.log(`OK -> ${ngDest} (${kb(statSync(ngDest).size)} KB)`);
/* NEWGAME-END */

/* EVENT-BEGIN */
// Ghép Event.html từ src/event.template.html + src/09-event.js (trang sự kiện độc lập).
const evTpl = readText(path.join(src, 'event.template.html'));
const evJs = readText(path.join(src, '09-event.js'));
if (evJs.includes('</script')) throw new Error('09-event.js chua </script');
const evOut = evTpl.replaceAll('__EVENT__', () => evJs);
const evDest = path.join(root, 'Event.html');
writeFileSync(evDest, evOut, 'utf8');
console.log(`OK -> ${evDest} (${kb(statSync(evDest).size)} KB)`);
/* EVENT-END */

/* DISTRICT-BEGIN */
// Ghép 11 trang map/*.html từ src/district.template.html + lib/three.min.js
// + src/10-district.js + src/10b-districts.js (nhóm A). Mỗi trang chèn JSON
// def của 1 khu vào __DEF__ và tên khu vào __TITLE__.
// Build deterministic: thứ tự trang = thứ tự DISTRICTS (id 1..12), không
// timestamp/random, build 2 lần giống hệt. Không sửa tay file đã build.
// Yêu cầu template (hợp đồng nhóm A): chứa __DEF__, __TITLE__, __THREE__
// và 1 placeholder cho mỗi file JS khu vực (__DISTRICT__ hoặc __DISTRICT_JS__
// cho 10-district.js; __DISTRICTS__ hoặc __DISTRICTS_JS__ cho 10b-districts.js).
// Thiếu file nhóm A hoặc thiếu placeholder -> throw kèm tên rõ ràng.
const districtTplPath = path.join(src, 'district.template.html');
const districtJsPath = path.join(src, '10-district.js');
const districtsJsPath = path.join(src, districtDataFile);
const missingDistrictFiles = [districtTplPath, districtJsPath, districtsJsPath]
  .filter(p => !existsSync(p))
  .map(p => path.relative(root, p));
if (missingDistrictFiles.length) {
  throw new Error('Chua build duoc 11 trang map/ — thieu file cua nhom A: ' + missingDistrictFiles.join(', ') + '. Chay lai node tools/build.mjs khi file da co.');
}
const districtTpl = readText(districtTplPath);
const districtJs = readText(districtJsPath);
const districtsJs = readText(districtsJsPath);
if (districtJs.includes('</script')) throw new Error('10-district.js chua </script');
if (districtsJs.includes('</script')) throw new Error('10b-districts.js chua </script');
let districtDefs;
try {
  districtDefs = vm.runInNewContext(districtsJs + '\n;DISTRICTS;', {});
} catch (e) {
  throw new Error('Khong doc duoc DISTRICTS tu src/10b-districts.js: ' + e.message);
}
if (!Array.isArray(districtDefs) || districtDefs.length !== 12) {
  throw new Error('DISTRICTS phai la mang 12 khu (id 1..12), doc duoc: ' + (Array.isArray(districtDefs) ? districtDefs.length : typeof districtDefs));
}
districtDefs.forEach((d, i) => {
  if (!d || d.id !== i + 1) throw new Error(`DISTRICTS[${i}] phai co id=${i + 1}, doc duoc id=${d && d.id}`);
  if (typeof d.name !== 'string' || !d.name) throw new Error(`DISTRICTS id=${d.id} thieu name`);
  if (d.id === 1) {
    if (d.file !== null) throw new Error('DISTRICTS id=1 (Bien Kinh Thanh) phai co file=null');
  } else if (typeof d.file !== 'string' || !/^[a-z0-9-]+\.html$/.test(d.file)) {
    throw new Error(`DISTRICTS id=${d.id} phai co file dang 'ten-khu.html', doc duoc: ${d.file}`);
  }
});
for (const ph of ['__DEF__', '__TITLE__', '__THREE__']) {
  if (!districtTpl.includes(ph)) throw new Error(`src/district.template.html thieu placeholder ${ph} (hop dong nhom A)`);
}
const districtJsPh = ['__DISTRICT_JS__', '__DISTRICT__', '__ENGINE__'].find(ph => districtTpl.includes(ph));
const districtsJsPh = ['__DISTRICTS_JS__', '__DISTRICTS__', '__DATA__'].find(ph => districtTpl.includes(ph));
if (!districtJsPh) throw new Error('src/district.template.html thieu placeholder cho src/10-district.js (dung __DISTRICT__ / __DISTRICT_JS__ / __ENGINE__)');
if (!districtsJsPh) throw new Error('src/district.template.html thieu placeholder cho src/10b-districts.js (dung __DISTRICTS__ / __DISTRICTS_JS__ / __DATA__)');
const mapDir = path.join(root, 'map');
mkdirSync(mapDir, { recursive: true });
let districtCount = 0;
districtDefs.forEach(def => {
  if (!def.file) return; // khu 1 = Biện Kinh Thành, đã ở trong mongvolam.html
  const page = districtTpl
    .replaceAll('__STYLE__', () => style)
    .replaceAll('__THREE__', () => three)
    .replaceAll(districtJsPh, () => districtJs)
    .replaceAll(districtsJsPh, () => districtsJs)
    .replaceAll('__DEF__', () => JSON.stringify(def))
    .replaceAll('__TITLE__', () => def.name);
  if (!page.includes(JSON.stringify(def))) throw new Error(`map/${def.file}: khong chen duoc __DEF__`);
  if (!page.includes('DISTRICTS') || !page.includes('canEnterDistrict')) throw new Error(`map/${def.file}: thieu DISTRICTS/canEnterDistrict sau khi chen JS`);
  const dest = path.join(mapDir, def.file);
  writeFileSync(dest, page, 'utf8');
  districtCount++;
  console.log(`OK -> ${dest} (${kb(statSync(dest).size)} KB)`);
});
console.log(`OK -> ${districtCount} trang map/ (DISTRICTS 12 khu)`);
/* DISTRICT-END */
