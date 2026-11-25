// Ghép mapeditor.html từ src/editor/*.js + src/editor/editor.css
// + lib/three.min.js + lib/fflate.min.js + lib/FBXLoader.js
// (làm theo mẫu tools/build.mjs: inline lib, placeholder __...__,
// kiểm tra '</script', deterministic không timestamp).
//   node tools/build-editor.mjs
// Ghi ra mapeditor.html (UTF-8 không BOM) + .zwork/build/editor.js (JS nối lại).
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editorDir = path.join(root, 'src', 'editor');
const lib = path.join(root, 'lib');

// Đọc UTF-8, bỏ BOM đầu file nếu có (giống tools/build.mjs).
function readText(p) {
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

// Thứ tự script theo DESIGN.md (worker A: 00, 01, 02, 99 bắt buộc;
// 03..10 của nhóm B/C/D: có thì nối, chưa có thì cảnh báo và bỏ qua).
const ORDERED = [
  '00-core.js', '01-viewport.js', '02-ui.js',
  '03-assets.js', '14-building.js', '04-terrain.js', '05-environment.js', '06-fx.js',
  '07-character.js', '11-animation.js', '08-npc-ai.js', '16-nodes.js', '17-physics.js', '09-play.js', '10-game-link.js',
  '12-nav.js', '13-material.js', '15-export.js',
  '99-boot.js'
];
const REQUIRED = ['00-core.js', '01-viewport.js', '02-ui.js', '99-boot.js'];

const missingRequired = REQUIRED.filter((f) => !existsSync(path.join(editorDir, f)));
if (missingRequired.length) {
  throw new Error('Chua build duoc mapeditor.html — thieu file bat buoc: ' + missingRequired.join(', '));
}

const parts = [];
for (const f of ORDERED) {
  const p = path.join(editorDir, f);
  if (existsSync(p)) parts.push(f);
  else console.warn(`WARN: src/editor/${f} chua co — build tam khong co module nay, chay lai build khi file da co.`);
}

const jsParts = parts.map((f) => readText(path.join(editorDir, f)));

const style = readText(path.join(editorDir, 'editor.css'));
const three = readText(path.join(lib, 'three.min.js'));
const fflate = readText(path.join(lib, 'fflate.min.js'));
const fbxLoader = readText(path.join(lib, 'FBXLoader.js'));
// GLTF/OBJ loader (nhóm B vendor từ three@0.128.0): có thì inline, chưa có thì
// placeholder thay bằng chuỗi rỗng + cảnh báo (nút import GLB/OBJ khi đó không vẽ).
const gltfPath = path.join(lib, 'GLTFLoader.js');
const objPath = path.join(lib, 'OBJLoader.js');
const gltfLoader = existsSync(gltfPath) ? readText(gltfPath) : '';
const objLoader = existsSync(objPath) ? readText(objPath) : '';
if (!gltfLoader) console.warn('WARN: lib/GLTFLoader.js chua co — import GLB tam tat.');
if (!objLoader) console.warn('WARN: lib/OBJLoader.js chua co — import OBJ tam tat.');
// GLTFExporter (đợt 2): vendor từ three@0.128.0 examples/js/exporters.
const gltfExporterPath = path.join(lib, 'GLTFExporter.js');
const gltfExporter = existsSync(gltfExporterPath) ? readText(gltfExporterPath) : '';
if (!gltfExporter) console.warn('WARN: lib/GLTFExporter.js chua co — nut Xuat .GLB tam an.');
// Reflector (đợt 3): vendor từ three@0.128.0 examples/js/objects — mặt nước
// phản chiếu thật trong 01-viewport.js. Chưa có thì placeholder rỗng +
// cảnh báo (nước khi đó vẽ mặt phẳng thường, không phản chiếu).
const reflectorPath = path.join(lib, 'Reflector.js');
const reflector = existsSync(reflectorPath) ? readText(reflectorPath) : '';
if (!reflector) console.warn('WARN: lib/Reflector.js chua co — nuoc phan chieu tam tat.');
// JSZip (đợt 4): vendor jszip@3.10.1 UMD — export project .ZIP trong 15-export.js.
// Chưa có thì placeholder rỗng + cảnh báo (nút ZIP khi đó chỉ hiện hint).
const jszipPath = path.join(lib, 'jszip.min.js');
const jszip = existsSync(jszipPath) ? readText(jszipPath) : '';
if (!jszip) console.warn('WARN: lib/jszip.min.js chua co — nut Xuat project .ZIP tam an.');
const tpl = readText(path.join(editorDir, 'editor.template.html'));

// Kiểm tra giống tools/build.mjs: lib/CSS không được chứa '</script'.
// Riêng editor JS: nếu 1 module (của nhóm khác) chứa chuỗi '</script' trong
// string literal (vd 10-game-link.js dòng 220), build KHÔNG sửa file đó mà
// escape thành '<\/script' lúc nối — cùng giá trị trong string literal JS,
// nhưng không phá thẻ <script> của HTML. Cảnh báo rõ để nhóm đó sửa gốc.
const libChecks = [
  ['three.min.js', three],
  ['fflate.min.js', fflate],
  ['FBXLoader.js', fbxLoader],
  ['editor.css', style]
];
if (gltfLoader) libChecks.push(['GLTFLoader.js', gltfLoader]);
if (objLoader) libChecks.push(['OBJLoader.js', objLoader]);
if (gltfExporter) libChecks.push(['GLTFExporter.js', gltfExporter]);
if (reflector) libChecks.push(['Reflector.js', reflector]);
if (jszip) libChecks.push(['jszip.min.js', jszip]);
for (const [name, text] of libChecks) {
  if (text.includes('</script')) throw new Error(name + ' chua </script');
}
let js = '(function(){\n' + jsParts.join('\n') + '\n})();';
for (const f of parts) {
  const text = readText(path.join(editorDir, f));
  if (text.includes('</script')) {
    console.warn(`WARN: src/editor/${f} chua '</script' — build escape thanh '<\\/script' (khong sua file goc, nhom so huu sua lai).`);
  }
}
js = js.replaceAll('</script', () => '<\\/script');

for (const ph of ['__EDITOR_STYLE__', '__THREE__', '__FFLATE__', '__FBXLOADER__', '__GLTFLOADER__', '__OBJLOADER__', '__GLTFEXPORTER__', '__REFLECTOR__', '__JSZIP__', '__EDITOR_JS__']) {
  if (!tpl.includes(ph)) throw new Error('src/editor/editor.template.html thieu placeholder ' + ph);
}

// QUAN TRỌNG: dùng hàm thay thế () => ... để chuỗi chèn được giữ nguyên từng byte
// (lib chứa "$&", JS chứa "$$" — String.replaceAll(x, str) sẽ diễn giải mẫu $).
const out = tpl
  .replaceAll('__EDITOR_STYLE__', () => style)
  .replaceAll('__THREE__', () => three)
  .replaceAll('__FFLATE__', () => fflate)
  .replaceAll('__FBXLOADER__', () => fbxLoader)
  .replaceAll('__GLTFLOADER__', () => gltfLoader)
  .replaceAll('__OBJLOADER__', () => objLoader)
  .replaceAll('__GLTFEXPORTER__', () => gltfExporter)
  .replaceAll('__REFLECTOR__', () => reflector)
  .replaceAll('__JSZIP__', () => jszip)
  .replaceAll('__EDITOR_JS__', () => js);

const dest = path.join(root, 'mapeditor.html');
writeFileSync(dest, out, 'utf8'); // Node ghi UTF-8 không BOM theo mặc định.

const chkDir = path.join(root, '.zwork', 'build');
mkdirSync(chkDir, { recursive: true });
writeFileSync(path.join(chkDir, 'editor.js'), js, 'utf8');

const kb = (n) => Math.round(n / 1024);
console.log(`OK -> ${dest} (${kb(statSync(dest).size)} KB, editor js ${kb(Buffer.byteLength(js, 'utf8'))} KB, ${parts.length} module: ${parts.join(', ')})`);
