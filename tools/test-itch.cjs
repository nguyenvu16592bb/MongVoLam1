/* Kiểm thử gói itch.io (đợt 5) — logic Node, không cần trình duyệt.
   - (A) Mọi href/location nội bộ trong index.html + Shop.html + Newgame.html
     + Event.html + map/*.html (đọc file đã build ở repo root) phải trỏ tới
     file CÓ trong gói dist-itch (danh sách gói lấy từ chính dist-itch/).
   - (B) KHÔNG có tham chiếu TẢI FILE nào tới src/ hay lib/ trong các trang
     đã build (fetch/import/src=/href=/url()/XHR) — vì gói không chứa chúng.
     (Các dòng chữ nhắc tên file nguồn trong comment/thông báo lỗi thì chỉ
     đếm + báo INFO, không tính là tải file.)
   - (C) Giải nén mongvolam1-itch.zip bằng JSZip (lib/jszip.min.js): đủ file,
     index.html trong ZIP byte-identical với mongvolam.html trong ZIP,
     không có entry src//lib/, không có mapeditor.html.
   - (D) index.html ở repo root byte-identical với mongvolam.html.
   - (E) src/editor/18-itch.js load được bằng vm (không cần DOM/THREE):
     ED.Itch thuần (tên file ZIP, danh sách entry, README) đúng.
   - (F) Tích hợp: build.mjs sinh index.html, build-itch.mjs có JSZip +
     fallback zip hệ thống, README.md có mục Itch.io.
   Chạy: node tools/build.mjs && node tools/build-itch.mjs && node tools/test-itch.cjs
   In "N PASS, M SKIP, 0 FAIL" như các harness cũ; exit 1 nếu có fail. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JSZip = require('../lib/jszip.min.js');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const readBuf = (f) => fs.readFileSync(path.join(root, f));
const exists = (f) => fs.existsSync(path.join(root, f));

let pass = 0, fail = 0, skipped = 0;
const failedNames = [];
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; failedNames.push(name); console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}
function skip(name, reason) {
  skipped++;
  console.log('SKIP ' + name + ' :: ' + reason);
}

/* Danh sách file kỳ vọng trong gói (đường dẫn tương đối trong ZIP). */
function expectedPackageFiles() {
  const mapDir = path.join(root, 'map');
  const mapFiles = fs.readdirSync(mapDir).filter((f) => f.endsWith('.html')).sort();
  return ['index.html', 'mongvolam.html', 'Shop.html', 'Newgame.html', 'Event.html']
    .concat(mapFiles.map((f) => 'map/' + f))
    .concat(['README-ITCH.md']);
}
const EXPECTED = expectedPackageFiles();
const EXPECTED_SET = new Set(EXPECTED);

/* Danh sách file thực tế trong dist-itch/ (đệ quy, trừ file .zip). */
function listDistItch() {
  const out = [];
  (function walk(dir, prefix) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? prefix + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(path.join(dir, ent.name), rel);
      else if (!ent.name.endsWith('.zip')) out.push(rel);
    }
  })(path.join(root, 'dist-itch'), '');
  return out.sort();
}

/* Chuẩn hoá đường dẫn tương đối kiểu 'a/../b' -> 'b', 'a/./b' -> 'a/b'. */
function normalizeRel(p) {
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}
/* Trích mọi link điều hướng khỏi nội dung 1 trang đã build.
   Trả {targets: [chuỗi href/location], prefixes: ['map/', ...]}. */
function extractLinks(html) {
  const targets = [];
  const prefixes = [];
  const res = [
    /location\.href\s*=\s*['"]([^'"]+)['"]/g,
    /location\.(?:assign|replace)\s*\(\s*['"]([^'"]+)['"]/g,
    /window\.open\s*\(\s*['"]([^'"]+)['"]/g,
    /(?:href|src)\s*=\s*['"]([^'"]+)['"]/g
  ];
  for (const re of res) {
    let m;
    while ((m = re.exec(html)) !== null) targets.push(m[1]);
  }
  /* Link động 'map/' + def.file (District.boot / panel Bản Đồ Khu Vực). */
  const pre = /location\.href\s*=\s*['"]map\/['"]\s*\+/g;
  if (pre.test(html)) prefixes.push('map/');
  return { targets, prefixes };
}
function isExternal(t) {
  return /^(https?:|data:|mailto:|javascript:|#|\/\/)/i.test(t) || t === '';
}
function resolveTarget(page, target) {
  const clean = target.split(/[?#]/)[0];
  if (!clean) return null;
  if (clean.startsWith('/')) return normalizeRel(clean.slice(1)); // root-relative
  const base = page.indexOf('/') >= 0 ? page.slice(0, page.lastIndexOf('/') + 1) : '';
  return normalizeRel(base + clean);
}

/* ================= A. Link nội bộ -> file có trong gói ================= */
console.log('--- A. Link noi bo trong cac trang da build ---');
const PAGES = ['index.html', 'Shop.html', 'Newgame.html', 'Event.html']
  .concat(fs.readdirSync(path.join(root, 'map')).filter((f) => f.endsWith('.html')).sort().map((f) => 'map/' + f));
let distFiles = [];
try {
  distFiles = listDistItch();
  check('dist-itch/ ton tai va co du file goi ky vong (' + EXPECTED.length + ' file)',
    EXPECTED.every((f) => distFiles.indexOf(f) >= 0),
    'thieu: ' + EXPECTED.filter((f) => distFiles.indexOf(f) < 0).join(', '));
  const extra = distFiles.filter((f) => !EXPECTED_SET.has(f));
  check('dist-itch/ khong co file thua ngoai danh sach ky vong',
    extra.length === 0, 'thua: ' + extra.join(', '));
} catch (e) {
  check('dist-itch/ ton tai va co du file goi ky vong', false, e && e.message);
}
const packageSet = new Set(distFiles);
check('index.html (entry itch.io) co trong goi', packageSet.has('index.html'));
check('mongvolam.html co trong goi (trang game link ve file nay)', packageSet.has('mongvolam.html'));
let sawMapPrefix = false;
for (const page of PAGES) {
  let html = '';
  try { html = read(page); } catch (e) { check('doc duoc ' + page, false, e && e.message); continue; }
  const { targets, prefixes } = extractLinks(html);
  if (prefixes.indexOf('map/') >= 0) sawMapPrefix = true;
  const seen = new Set();
  for (const t of targets) {
    if (isExternal(t)) continue;
    if (t.endsWith('/')) continue; // tiền tố thư mục kiểu 'map/' + file — kiểm riêng ở dưới, không phải file
    const resolved = resolveTarget(page, t);
    if (!resolved) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    check(page + ' -> ' + resolved + ' (tu ' + JSON.stringify(t) + ') co trong goi',
      packageSet.has(resolved), 'khong co trong dist-itch/');
  }
}
if (sawMapPrefix) {
  const mapInPkg = EXPECTED.filter((f) => f.indexOf('map/') === 0);
  check("link dong 'map/' + def.file: du 11 trang map/*.html trong goi",
    mapInPkg.length === 11 && mapInPkg.every((f) => packageSet.has(f)),
    'map trong goi: ' + mapInPkg.length);
} else {
  check("link dong 'map/' + def.file ton tai trong mongvolam.html", false, 'khong tim thay mau location.href = \'map/\' + ...');
}

/* ================= B. Không tải file từ src/ hay lib/ ================= */
console.log('--- B. Khong co tham chieu TAI FILE nao toi src/ hay lib/ ---');
const LOAD_PATTERNS = [
  [/fetch\s*\(\s*['"][^'"]*(?:src|lib)\//g, 'fetch(...)'],
  [/(?:import\s*\(|from\s+)['"][^'"]*(?:src|lib)\//g, 'import/from'],
  [/(?:src|href)\s*=\s*['"][^'"]*(?:src|lib)\//g, 'src=/href='],
  [/url\(\s*['"]?(?:src|lib)\//g, 'url(...)'],
  [/\.open\s*\([^)]*(?:src|lib)\//g, 'XHR open(...)']
];
let benignMentions = 0;
for (const page of PAGES) {
  const html = read(page);
  benignMentions += (html.match(/(?:src|lib)\//g) || []).length;
  for (const [re, label] of LOAD_PATTERNS) {
    re.lastIndex = 0;
    const hits = html.match(re) || [];
    check(page + ': khong co ' + label + ' toi src/ hay lib/', hits.length === 0,
      hits.length ? hits.slice(0, 3).join(' | ') : undefined);
  }
  check(page + ': khong nhac toi mapeditor.html (khong co trong goi game)',
    html.indexOf('mapeditor.html') < 0);
}
console.log('INFO so lan nhac ten "src/..." / "lib/..." dang chuoi binh thuong (comment/thong bao, khong tai file): ' + benignMentions);

/* ================= C. ZIP that ================= */
console.log('--- C. ZIP that (JSZip that) ---');
(async function () {
  const zipPath = path.join(root, 'dist-itch', 'mongvolam1-itch.zip');
  if (!fs.existsSync(zipPath)) {
    check('dist-itch/mongvolam1-itch.zip ton tai', false, 'chay node tools/build-itch.mjs truoc');
  } else {
    check('dist-itch/mongvolam1-itch.zip ton tai', true);
    try {
      const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
      check('ZIP du ' + EXPECTED.length + ' file, khong thua/khong thieu',
        names.length === EXPECTED.length && EXPECTED.every((f) => names.indexOf(f) >= 0),
        'trong ZIP: ' + names.length + ' file; thieu: ' + EXPECTED.filter((f) => names.indexOf(f) < 0).join(', ') +
        '; thua: ' + names.filter((f) => !EXPECTED_SET.has(f)).join(', '));
      check('ZIP khong co entry src/ hay lib/', names.every((n) => n.indexOf('src/') !== 0 && n.indexOf('lib/') !== 0));
      check('ZIP khong co mapeditor.html', names.indexOf('mapeditor.html') < 0);
      const idxBuf = await zip.file('index.html').async('nodebuffer');
      const gameBuf = await zip.file('mongvolam.html').async('nodebuffer');
      check('index.html trong ZIP byte-identical voi mongvolam.html trong ZIP',
        idxBuf.equals(gameBuf), 'index ' + idxBuf.length + 'B, game ' + gameBuf.length + 'B');
      const readme = await zip.file('README-ITCH.md').async('string');
      check('README-ITCH.md trong ZIP huong dan du buoc itch.io (HTML + tick browser + 960x540 + Mobile friendly)',
        readme.indexOf('HTML') >= 0 && readme.indexOf('This file will be played in the browser') >= 0 &&
        readme.indexOf('960') >= 0 && readme.indexOf('Mobile friendly') >= 0,
        'README-ITCH.md dai ' + readme.length + ' ky tu');
    } catch (e) {
      check('doc duoc ZIP bang JSZip', false, e && e.message);
    }
  }

  /* ================= D. index.html goc == mongvolam.html goc ================= */
  console.log('--- D. index.html o repo root ---');
  try {
    const idxBuf = readBuf('index.html');
    const gameBuf = readBuf('mongvolam.html');
    check('index.html o repo root byte-identical voi mongvolam.html',
      idxBuf.equals(gameBuf), 'index ' + idxBuf.length + 'B, game ' + gameBuf.length + 'B');
  } catch (e) {
    check('index.html o repo root byte-identical voi mongvolam.html', false, e && e.message);
  }

  /* ================= E. 18-itch.js (vm) ================= */
  console.log('--- E. src/editor/18-itch.js (vm, khong can DOM/THREE) ---');
  let It = null;
  try {
    const ctx = { console: console, ED: {}, window: {} };
    vm.createContext(ctx);
    vm.runInContext(read('src/editor/18-itch.js'), ctx, { filename: 'src/editor/18-itch.js' });
    It = ctx.ED.Itch;
    check('18-itch.js load duoc bang vm (khong can DOM/THREE)', !!It);
  } catch (e) {
    check('18-itch.js load duoc bang vm (khong can DOM/THREE)', false, e && e.message);
  }
  if (It) {
    check('init() khi khong co document thi tra false, khong throw',
      (function () { try { return It.init() === false; } catch (e) { return false; } })());
    check('zipFileName: ten ASCII ve dang mapeditor-<ten>-itch.zip; rong ve project',
      It.zipFileName('My Project 2026!') === 'mapeditor-my-project-2026-itch.zip' &&
      It.zipFileName('') === 'mapeditor-project-itch.zip' &&
      It.zipFileName(null) === 'mapeditor-project-itch.zip',
      It.zipFileName('My Project 2026!'));
    check('HINT + DIFFERENCE neu duoc cach upload itch.io va su khac biet voi goi game',
      It.HINT.indexOf('Kind of project') >= 0 && It.HINT.indexOf('This file will be played in the browser') >= 0 &&
      It.DIFFERENCE.indexOf('PROJECT HIỆN TẠI') >= 0 && It.DIFFERENCE.indexOf('tools/build-itch.mjs') >= 0);
    const readmeTxt = It.readmeText('Biện Kinh Thành');
    check('readmeText: co 960 x 540 + Mobile friendly + ten project + su khac biet',
      readmeTxt.indexOf('960') >= 0 && readmeTxt.indexOf('Mobile friendly') >= 0 &&
      readmeTxt.indexOf('Biện Kinh Thành') >= 0 && readmeTxt.indexOf('tools/build-itch.mjs') >= 0);
    if (typeof It.buildItchFileList !== 'function') {
      skip('buildItchFileList', 'ED.Itch.buildItchFileList khong ton tai');
    } else {
      const fake = [
        { path: 'project.json', kind: 'json', content: '{"version":1}' },
        { path: 'mapeditor.html', kind: 'fetch', url: 'mapeditor.html' },
        { path: 'lib/jszip.min.js', kind: 'fetch', url: 'lib/jszip.min.js' }
      ];
      const out = It.buildItchFileList(fake, 'Test');
      const paths = out.map(function (e) { return e.path; });
      const idxEntry = out.filter(function (e) { return e.path === 'index.html'; })[0];
      const readmeEntry = out.filter(function (e) { return e.path === 'README-ITCH-EDITOR.md'; })[0];
      check('buildItchFileList: mapeditor.html -> index.html (url fetch giu nguyen), them README-ITCH-EDITOR.md',
        paths.indexOf('mapeditor.html') < 0 && !!idxEntry && idxEntry.url === 'mapeditor.html' &&
        !!readmeEntry && readmeEntry.kind === 'json' && readmeEntry.content.indexOf('Kind of project') >= 0,
        JSON.stringify(paths));
      check('buildItchFileList: khong trung path, khong sua list goc',
        new Set(paths).size === paths.length && fake.length === 3 && fake[1].path === 'mapeditor.html');
      const outNoEditor = It.buildItchFileList([{ path: 'project.json', kind: 'json', content: '{}' }], 'T');
      check('buildItchFileList: list khong co mapeditor.html thi khong tu tao index.html gia',
        outNoEditor.map(function (e) { return e.path; }).indexOf('index.html') < 0 &&
        outNoEditor.length === 2);
    }
  }

  /* ================= F. Tich hop ================= */
  console.log('--- F. Tich hop ---');
  check('tools/build.mjs: co khoi ITCH tao index.html tu mongvolam.html vua ghi (readFileSync(dest))',
    read('tools/build.mjs').indexOf('index.html') >= 0 &&
    read('tools/build.mjs').indexOf('readFileSync(dest') >= 0 &&
    read('tools/build.mjs').indexOf('ITCH-BEGIN') >= 0);
  const bitch = exists('tools/build-itch.mjs') ? read('tools/build-itch.mjs') : '';
  check('tools/build-itch.mjs: dung JSZip (lib/jszip.min.js) + fallback lenh zip he thong',
    bitch.indexOf('jszip.min.js') >= 0 && bitch.indexOf('zipWithSystemZip') >= 0 &&
    bitch.indexOf('zip -X') >= 0);
  check('tools/build-itch.mjs: sinh README-ITCH.md + kiem tra du file truoc khi nen',
    bitch.indexOf('README-ITCH.md') >= 0 && bitch.indexOf('checkInputs') >= 0);
  check('README.md: co muc Itch.io (index.html entry + cach build goi + ZIP khong commit)',
    read('README.md').indexOf('## Itch.io') >= 0 &&
    read('README.md').indexOf('mongvolam1-itch.zip') >= 0 &&
    read('README.md').indexOf('build-itch.mjs') >= 0);
  const editorBuild = exists('tools/build-editor.mjs') ? read('tools/build-editor.mjs') : '';
  if (editorBuild.indexOf('18-itch.js') >= 0) {
    check('tools/build-editor.mjs: da noi 18-itch.js vao ORDERED (nut hien trong mapeditor.html)', true);
  } else {
    skip('tools/build-editor.mjs noi 18-itch.js', '18-itch.js dung mot minh chua tu hien trong mapeditor.html — can coordinator them vao ORDERED + _callInit(\'Itch\') trong 99-boot.js (ngoai pham vi file cua worker nay)');
  }

  console.log('----------------------------------------');
  console.log(pass + ' PASS, ' + skipped + ' SKIP, ' + fail + ' FAIL');
  if (failedNames.length) console.log('FAILED: ' + failedNames.join(' | '));
  process.exit(fail ? 1 : 0);
})();
