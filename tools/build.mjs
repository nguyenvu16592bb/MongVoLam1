// Ghép mongvolam.html từ src/ + lib/ (three.js r128, pixi 8.6.6 inline)
// Bản port Node.js của tools/build.ps1 — chạy trên Linux/macOS/Windows:
//   node tools/build.mjs
// Ghi ra mongvolam.html (UTF-8 không BOM) + .zwork/build/game.js (JS nối lại, để kiểm tra).
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const lib = path.join(root, 'lib');

// Đọc UTF-8, bỏ BOM đầu file nếu có (giống Read-Text trong build.ps1).
function readText(p) {
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

const style = readText(path.join(src, 'style.css'));
const parts = ['01-data.js', '02-world.js', '03-battle.js', '03b-arenas.js', '04-info.js', '05-ui.js', '06-boot.js'];
const jsParts = parts.map((f) => readText(path.join(src, f)));
const js = '(function(){\n' + jsParts.join('\n') + '\n})();';

const three = readText(path.join(lib, 'three.min.js'));
const pixi = readText(path.join(lib, 'pixi.min.js'));
const tpl = readText(path.join(src, 'index.template.html'));

// Kiểm tra giống bản ps1: lib không được chứa chuỗi '</script' (sẽ phá thẻ <script>).
if (three.includes('</script')) throw new Error('three.min.js chua </script');
if (pixi.includes('</script')) throw new Error('pixi.min.js chua </script');

// Thay placeholder theo đúng thứ tự của ps1 (String.Replace thay tất cả lần xuất hiện).
// QUAN TRỌNG: dùng hàm thay thế () => ... để chuỗi chèn được giữ nguyên từng byte.
// String.replaceAll(x, str) sẽ diễn giải các mẫu $ trong str ($$, $&, $', $`) —
// pixi.min.js chứa "$&" và game JS chứa "$$" nên dùng chuỗi thường sẽ làm hỏng file.
const out = tpl
  .replaceAll('__STYLE__', () => style)
  .replaceAll('__THREE__', () => three)
  .replaceAll('__PIXI__', () => pixi)
  .replaceAll('__GAME__', () => js);

const dest = path.join(root, 'mongvolam.html');
writeFileSync(dest, out, 'utf8'); // Node ghi UTF-8 không BOM theo mặc định.

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
