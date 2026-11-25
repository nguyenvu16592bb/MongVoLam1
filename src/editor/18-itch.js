/* ============================================================================
   Map Editor — 18-itch.js (đợt 5)
   ED.Itch — nút "Xuat goi itch.io" trong editor: đóng gói PROJECT HIỆN TẠI
   của editor thành 1 file .ZIP itch-ready (index.html làm entry) bằng JSZip
   đã vendor (lib/jszip.min.js, UMD, coordinator inline vào bản build).
   KHÁC BIỆT QUAN TRỌNG (ghi rõ trong UI + README trong ZIP):
   - Nút này đóng gói PROJECT HIỆN TẠI của editor (project.json + bản thân
     mapeditor.html đổi tên thành index.html + toàn bộ src/editor/*.js +
     lib/*.js, lấy lại từ ED.Export.buildZipFileList đợt 4) — tức là đăng
     CHÍNH CÁI EDITOR này lên itch.io để người khác mở editor trên trình duyệt.
   - Gói GAME Mộng Võ Lâm (index.html + mongvolam.html + Shop/Newgame/Event +
     map/*.html) thì KHÔNG phải nút này làm — nó do tools/build-itch.mjs ráp
     từ các trang game đã build (node tools/build.mjs && node tools/build-itch.mjs).
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo trong init(). Logic thuần (tên file, danh sách entry, nội
   dung README) viết thành hàm thuần để tools/test-itch.cjs load bằng vm.
   KHÔNG sửa 02-ui.js / 99-boot.js / build-editor.mjs: panel của module tự
   tạo (gắn vào #panel-right nếu có, fallback append body); coordinator nối
   file này vào ORDERED của tools/build-editor.mjs + _callInit('Itch') trong
   99-boot.js thì nút mới hiện trong mapeditor.html (file này đứng một mình
   chưa tự hiện).
   Giới hạn: ZIP lấy file qua fetch cùng origin nên chỉ chạy khi mở editor
   qua HTTP (GitHub Pages / server), không chạy file://. File fetch lỗi ghi
   THIEU_FILE.txt trong ZIP, không throw. Chưa upload thử lên itch.io thật.
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Itch = (function () {
  /* Hint 1–2 dòng hiện ngay dưới nút (cùng nội dung với README-ITCH.md). */
  var HINT = 'Đăng lên itch.io: Create new project → Kind of project = HTML → ' +
    'upload file ZIP này → tick "This file will be played in the browser" ' +
    '(viewport 960×540, Mobile friendly ON).';
  var DIFFERENCE = 'Gói này là PROJECT HIỆN TẠI của editor (mở editor trên itch.io), ' +
    'KHÔNG phải gói game Mộng Võ Lâm — gói game do tools/build-itch.mjs ráp.';

  /* Tên file ZIP từ tên project. Thuần. */
  function itchZipFileName(projectName) {
    var base = (typeof projectName === 'string' ? projectName : '') || 'project';
    base = base.toLowerCase();
    // Bỏ dấu tiếng Việt (NFD tách dấu tổ hợp rồi lược; đ/Đ không tách được nên đổi tay).
    if (typeof base.normalize === 'function') base = base.normalize('NFD').replace(/[̀-ͯ]/g, '');
    base = base.replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!base) base = 'project';
    if (base.length > 40) base = base.slice(0, 40).replace(/-+$/, '');
    return 'mapeditor-' + base + '-itch.zip';
  }

  /* Nội dung README-ITCH-EDITOR.md trong ZIP. Thuần. */
  function itchReadmeText(projectName) {
    var name = (typeof projectName === 'string' && projectName) ? projectName : 'project';
    return '# Map Editor — goi itch.io (project: ' + name + ')\n' +
      '\n' +
      'ZIP nay dong goi PROJECT HIEN TAI cua Map Editor de mo editor tren trinh duyet.\n' +
      '\n' +
      '## ' + DIFFERENCE + '\n' +
      '\n' +
      '## Cach dang len itch.io\n' +
      '\n' +
      '1. Vao https://itch.io/dashboard -> **Create new project**.\n' +
      '2. **Kind of project**: chon **HTML** (khong phai Downloadable).\n' +
      '3. **Uploads**: tai file ZIP nay len (dung giai nen).\n' +
      '4. Tick **"This file will be played in the browser"**.\n' +
      '5. **Embed options**: Viewport goi y **960 x 540**, bat **Mobile friendly**.\n' +
      '6. Save & view page -> bam Play la mo editor (entry `index.html`).\n' +
      '\n' +
      '## File trong goi\n' +
      '\n' +
      '- `index.html` — entry cho itch.io (chinh la mapeditor.html doi ten).\n' +
      '- `project.json` — project hien tai cua editor.\n' +
      '- `src/editor/*.js` + `editor.css` + `editor.template.html` + `DESIGN.md`.\n' +
      '- `lib/*.js` — three.min.js, fflate, FBX/GLTF/OBJ loader, GLTFExporter,\n' +
      '  Reflector, jszip.min.js.\n' +
      '- `README.md` — README cua repo game.\n' +
      '- `THIEU_FILE.txt` — chi co khi co file fetch loi (xem ten file trong do).\n' +
      '\n' +
      '## Gioi han\n' +
      '\n' +
      'ZIP lay file qua fetch cung origin nen chi xuat duoc khi mo editor qua HTTP\n' +
      '(GitHub Pages / server), khong chay file://. Editor can mang lan dau de tai\n' +
      'itch.io, sau do chay offline trong iframe itch.io.\n';
  }

  /* Danh sách entry itch-ready từ danh sách export của ED.Export
     (ED.Export.buildZipFileList, đợt 4). Thuần, không sửa list gốc.
     - Entry 'mapeditor.html' -> path 'index.html' (entry itch.io), url fetch
       vẫn là 'mapeditor.html' (file build thật cùng origin).
     - Thêm 'README-ITCH-EDITOR.md' (kind 'json', content là text thuần).
     - Không có 'mapeditor.html' trong list thì giữ nguyên list + README
       (UI sẽ báo thiếu entry, không vẽ nút giả). */
  function buildItchFileList(exportList, projectName) {
    var list = Array.isArray(exportList) ? exportList : [];
    var out = list.map(function (e) {
      if (!e || typeof e.path !== 'string') return e;
      if (e.path === 'mapeditor.html') {
        return { path: 'index.html', kind: e.kind || 'fetch', url: 'mapeditor.html' };
      }
      return { path: e.path, kind: e.kind, url: e.url, content: e.content };
    });
    out.push({ path: 'README-ITCH-EDITOR.md', kind: 'json', content: itchReadmeText(projectName) });
    return out;
  }

  /* JSZip global (UMD đã inline vào bản build) — guard typeof như 15-export.js. */
  function _getJSZip() {
    if (typeof JSZip !== 'undefined' && typeof JSZip === 'function') return JSZip;
    if (typeof window !== 'undefined' && window && typeof window.JSZip === 'function') return window.JSZip;
    return null;
  }
  function _hasJSZip() { return !!_getJSZip(); }

  function _log(msg) {
    if (ED.UI && typeof ED.UI.log === 'function') ED.UI.log(msg);
  }
  function _toast(msg) {
    if (ED.UI && typeof ED.UI.toast === 'function') ED.UI.toast(msg);
  }
  function _projectName() {
    try {
      if (ED.Core && typeof ED.Core.getProject === 'function') {
        var p = ED.Core.getProject();
        if (p && typeof p.name === 'string' && p.name) return p.name;
      }
    } catch (e) { /* giữ tên mặc định */ }
    return 'project';
  }
  function _downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }

  /* Xuất gói itch.io của project hiện tại. Async — trả
     Promise<{fileName, count, missing}>; thiếu JSZip/ED.Export thì reject
     kèm lý do rõ ràng (UI đã chặn trước nên đường này chỉ là phòng thủ). */
  function exportItchZip() {
    var JSZipCtor = _getJSZip();
    if (!JSZipCtor) return Promise.reject(new Error('Chua co JSZip trong ban build (lib/jszip.min.js) — build lai mapeditor.html.'));
    if (!ED.Export || typeof ED.Export.buildZipFileList !== 'function' ||
        typeof ED.Export.collectZipEntries !== 'function') {
      return Promise.reject(new Error('Thieu ED.Export.buildZipFileList/collectZipEntries (15-export.js) — khong dong goi duoc.'));
    }
    var projectJson = null;
    try {
      projectJson = (ED.Core && typeof ED.Core.serialize === 'function') ? ED.Core.serialize() : null;
    } catch (e) { projectJson = null; }
    if (!projectJson) return Promise.reject(new Error('Khong doc duoc project hien tai (ED.Core.serialize).'));
    var name = _projectName();
    var list = buildItchFileList(ED.Export.buildZipFileList(projectJson), name);
    var hasIndex = list.some(function (e) { return e && e.path === 'index.html'; });
    if (!hasIndex) return Promise.reject(new Error('Danh sach export thieu mapeditor.html — khong co file lam index.html.'));
    var fetcher = function (url) {
      return fetch(url).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
    };
    return ED.Export.collectZipEntries(list, fetcher).then(function (res) {
      var zip = new JSZipCtor();
      res.entries.forEach(function (e) { zip.file(e.path, e.data); });
      if (res.missing.length) zip.file('THIEU_FILE.txt', res.missing.join('\n'));
      return zip.generateAsync({ type: 'blob' }).then(function (blob) {
        var fileName = itchZipFileName(name);
        _downloadBlob(blob, fileName);
        _log('Da xuat goi itch.io: ' + fileName + ' (' + res.entries.length + ' file' +
          (res.missing.length ? ', thieu ' + res.missing.length + ' file: ' + res.missing.join(', ') : '') + ')');
        return { fileName: fileName, count: res.entries.length, missing: res.missing };
      });
    });
  }

  /* Tạo UI: section trong #panel-right (fallback body). Chỉ vẽ nút khi đủ
     JSZip + ED.Export (thiếu thì chỉ hiện hint cảnh báo, KHÔNG vẽ nút giả).
     Chạy trong init(), không chạm document ở top-level. Trả true/false. */
  function init() {
    if (typeof document === 'undefined') return false;
    var host = document.getElementById ? document.getElementById('panel-right') : null;
    if (!host) host = document.body;
    if (!host) return false;
    var section = document.createElement('div');
    section.className = 'ed-itch';
    section.innerHTML =
      '<h3>Itch.io</h3>' +
      '<p class="ed-hint">' + DIFFERENCE + '</p>' +
      '<p class="ed-hint">' + HINT + '</p>';
    var ok = _hasJSZip() && ED.Export &&
      typeof ED.Export.buildZipFileList === 'function' &&
      typeof ED.Export.collectZipEntries === 'function';
    if (!ok) {
      var warn = document.createElement('p');
      warn.className = 'ed-hint';
      warn.textContent = _hasJSZip()
        ? 'Thiếu ED.Export (15-export.js) — chưa xuất được gói itch.io.'
        : 'Chưa có JSZip trong bản build (lib/jszip.min.js) — nút Xuất gói itch.io sẽ hiện sau khi build lại.';
      section.appendChild(warn);
      host.appendChild(section);
      return true;
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '⬇️ Xuất gói itch.io';
    btn.addEventListener('click', function () {
      btn.disabled = true;
      exportItchZip().then(function (r) {
        _toast('Đã xuất ' + r.fileName + ' (' + r.count + ' file)' +
          (r.missing.length ? ' — thiếu ' + r.missing.length + ' file, xem THIEU_FILE.txt trong ZIP.' : ''));
      }).catch(function (e) {
        _toast('Không xuất được gói itch.io: ' + (e && e.message ? e.message : e));
        _log('Lỗi xuất gói itch.io: ' + (e && e.message ? e.message : e));
      }).then(function () { btn.disabled = false; });
    });
    section.appendChild(btn);
    host.appendChild(section);
    return true;
  }

  return {
    HINT: HINT,
    DIFFERENCE: DIFFERENCE,
    zipFileName: itchZipFileName,
    readmeText: itchReadmeText,
    buildItchFileList: buildItchFileList,
    hasJSZip: _hasJSZip,
    exportItchZip: exportItchZip,
    init: init
  };
})();
