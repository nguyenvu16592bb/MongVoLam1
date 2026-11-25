// Ráp gói itch.io cho game Mộng Võ Lâm 3D — chạy SAU tools/build.mjs:
//   node tools/build.mjs && node tools/build-itch.mjs
// Đọc các trang ĐÃ BUILD ở repo root (không build lại, không sửa src/),
// ráp thư mục dist-itch/ rồi nén thành dist-itch/mongvolam1-itch.zip.
// Gói gồm: index.html + mongvolam.html (byte-identical, BẮT BUỘC cả 2 vì các
// trang game link về 'mongvolam.html' / '../mongvolam.html') + Shop.html +
// Newgame.html + Event.html + map/*.html (11 file) + README-ITCH.md.
// KHÔNG chứa src/, lib/ (các trang đã tự chứa three/pixi/JS inline) và
// KHÔNG chứa mapeditor.html (editor không phải game).
// KHÔNG commit file ZIP vào repo — chỉ build ra local ở dist-itch/.
// Nén bằng JSZip vendored (lib/jszip.min.js, UMD) qua Node; nếu require
// không dùng được thì fallback lệnh `zip` hệ thống (child_process execSync).
// ZIP deterministic: mọi entry dùng cùng 1 ngày cố định (2000-01-01) nên
// nén 2 lần từ cùng nội dung cho ra cùng bytes (trừ khi JSZip đổi version).
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-itch');
const zipName = 'mongvolam1-itch.zip';
const zipPath = path.join(outDir, zipName);
const ZIP_DATE = new Date('2000-01-01T00:00:00Z'); // ngày cố định cho mọi entry -> ZIP deterministic

const ROOT_FILES = ['index.html', 'mongvolam.html', 'Shop.html', 'Newgame.html', 'Event.html'];

export const README_ITCH_MD = `# Mộng Võ Lâm 3D — gói itch.io

Game HTML chơi ngay trên trình duyệt (Three.js r128 + PixiJS đã nhúng sẵn trong file, không cần mạng).

## Cách đăng lên itch.io (người đăng làm tay, chưa tự động)

1. Vào https://itch.io/dashboard -> **Create new project**.
2. **Kind of project**: chọn **HTML** (không phải Downloadable).
3. **Uploads**: tải file \`mongvolam1-itch.zip\` lên (file ZIP này, đừng giải nén).
4. Tick **"This file will be played in the browser"** (chạy ngay trong trình duyệt itch.io).
5. **Embed options**: Viewport dimensions gợi ý **960 × 540**, bật **Mobile friendly** (game chơi được bằng cảm ứng trên điện thoại).
6. Save & view page -> bấm Play là chơi (mở bằng \`index.html\`).

## File trong gói

- \`index.html\` — entry cho itch.io, nội dung giống hệt \`mongvolam.html\`.
- \`mongvolam.html\` — game chính (BẮT BUỘC giữ lại vì các trang khác link về file này: Shop/Newgame/Event dùng \`location.href = 'mongvolam.html'\`, 11 trang map/ dùng \`'../mongvolam.html'\`).
- \`Shop.html\`, \`Newgame.html\`, \`Event.html\` — chợ, màn hình chính, sự kiện.
- \`map/*.html\` (11 file) — 11 khu vực: Phố Đông, Phố Tây, Nam Môn, Bắc Uyển, Ngõ Hẹp, Miếu Cổ, Bến Sông, Ruộng Lúa, Nghĩa Trang, Thác Nước, Hang Động.
- Gói KHÔNG chứa \`src/\`, \`lib/\` (các trang đã tự chứa) và KHÔNG chứa \`mapeditor.html\` (editor không phải game).

## Build lại gói

\`\`\`
node tools/build.mjs && node tools/build-itch.mjs
\`\`\`

File ZIP sinh ra ở \`dist-itch/mongvolam1-itch.zip\`, không commit vào repo.
`;

// Danh sách file kỳ vọng trong gói (đường dẫn tương đối trong ZIP, dùng '/').
function expectedPackageFiles() {
  const mapDir = path.join(root, 'map');
  if (!existsSync(mapDir)) throw new Error('Thieu thu muc map/ — chay node tools/build.mjs truoc.');
  const mapFiles = readdirSync(mapDir).filter((f) => f.endsWith('.html')).sort();
  if (mapFiles.length < 11) throw new Error(`Thieu trang map/ — chi co ${mapFiles.length} file .html, can 11 file. Chay node tools/build.mjs truoc.`);
  return [...ROOT_FILES, ...mapFiles.map((f) => 'map/' + f), 'README-ITCH.md'];
}

// Kiểm tra đủ file trước khi nén; thiếu file nào thì throw tên rõ ràng.
function checkInputs(files) {
  const missing = [];
  for (const f of files) {
    if (f === 'README-ITCH.md') continue; // nội dung này script tự sinh
    if (!existsSync(path.join(root, f))) missing.push(f);
  }
  if (missing.length) {
    throw new Error('Thieu file de dong goi itch.io (chay node tools/build.mjs truoc): ' + missing.join(', '));
  }
  const indexBuf = readFileSync(path.join(root, 'index.html'));
  const gameBuf = readFileSync(path.join(root, 'mongvolam.html'));
  if (!indexBuf.equals(gameBuf)) {
    throw new Error('index.html khong giong het mongvolam.html — chay lai node tools/build.mjs truoc khi dong goi.');
  }
}

function zipWithJsZip(files) {
  const require = createRequire(import.meta.url);
  const JSZip = require(path.join(root, 'lib', 'jszip.min.js'));
  if (typeof JSZip !== 'function') throw new Error('lib/jszip.min.js require duoc nhung khong tra ve ham JSZip');
  const zip = new JSZip();
  for (const f of files) {
    const data = f === 'README-ITCH.md'
      ? README_ITCH_MD
      : readFileSync(path.join(root, f));
    zip.file(f, data, { date: ZIP_DATE });
  }
  // JSZip tự tạo entry thư mục cha ('map/') với ngày GIỜ HIỆN TẠI khi thêm
  // 'map/xxx.html' — ép lại ngày cố định cho MỌI entry (kể cả thư mục) thì
  // nén 2 lần từ cùng nội dung mới cho ra cùng bytes.
  for (const entry of Object.values(zip.files)) entry.date = ZIP_DATE;
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function zipWithSystemZip(files) {
  // Fallback: lệnh `zip` hệ thống. Chạy trong dist-itch/ để đường dẫn trong
  // ZIP là tương đối (index.html, map/xxx.html...), không kèm dist-itch/.
  mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const dest = path.join(outDir, f);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (f === 'README-ITCH.md') writeFileSync(dest, README_ITCH_MD, 'utf8');
    else writeFileSync(dest, readFileSync(path.join(root, f)));
  }
  // -X: không ghi attribute thừa; -q: im lặng; -r: đệ quy (cho map/).
  // -D: không ghi entry thư mục. Ghi đè ZIP cũ nếu có (-o không dùng để giữ ngày entry).
  execSync(`zip -X -q -r -D ${zipName} ${files.map((f) => `'${f}'`).join(' ')}`, { cwd: outDir, stdio: 'pipe' });
  return readFileSync(zipPath);
}

async function main() {
  const files = expectedPackageFiles();
  checkInputs(files);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(outDir, 'map'), { recursive: true });
  // Ghi README-ITCH.md vào dist-itch/ (1 phần của gói, kể cả khi nén bằng zip hệ thống).
  writeFileSync(path.join(outDir, 'README-ITCH.md'), README_ITCH_MD, 'utf8');

  let method = '';
  let zipBuf;
  try {
    zipBuf = await zipWithJsZip(files);
    method = 'JSZip Node (lib/jszip.min.js)';
  } catch (e) {
    console.warn(`WARN: khong dung duoc JSZip qua Node (${e && e.message}) — fallback lenh zip he thong.`);
    try {
      zipBuf = zipWithSystemZip(files);
      method = 'lenh zip he thong (zip -r)';
    } catch (e2) {
      throw new Error('Khong nen duoc ZIP: JSZip loi (' + (e && e.message) + ') + lenh zip loi (' + (e2 && e2.message) + ')');
    }
  }
  // Khi nén bằng JSZip thì dist-itch/ chưa có các file game — ghi ZIP ra là đủ;
  // vẫn giữ lại bản sao các file trong dist-itch/ để test-itch.cjs đọc trực tiếp.
  if (method.startsWith('JSZip')) {
    for (const f of files) {
      const dest = path.join(outDir, f);
      mkdirSync(path.dirname(dest), { recursive: true });
      if (f === 'README-ITCH.md') continue; // đã ghi ở trên
      writeFileSync(dest, readFileSync(path.join(root, f)));
    }
  }
  writeFileSync(zipPath, zipBuf);
  const kb = (n) => Math.round(n / 1024);
  console.log(`OK -> ${zipPath} (${kb(statSync(zipPath).size)} KB, ${files.length} file, nen bang ${method})`);
  for (const f of files) {
    const size = f === 'README-ITCH.md'
      ? Buffer.byteLength(README_ITCH_MD, 'utf8')
      : statSync(path.join(root, f)).size;
    console.log(`  - ${f} (${kb(size)} KB)`);
  }
}

await main();
