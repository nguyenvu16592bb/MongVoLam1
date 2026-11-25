/* Map Editor — 02-ui.js (worker A)
   ED.UI: toolbar, hierarchy, inspector, console, toast, perf HUD, panel toggle.
   Mọi nút đều chạy thật. KHÔNG truy cập document/window ở top-level. */
var ED = ED || {};

ED.UI = (function () {
  var _els = {};
  var _searchText = '';
  var _bottomTab = 'console';
  var _logCount = 0;

  var CATEGORY_ORDER = ['Environment', 'Terrain', 'Buildings', 'Decorations',
    'Characters', 'Waypoints', 'Colliders', 'Effects', 'Cameras'];

  function $(id) { return document.getElementById(id); }

  function init() {
    _els = {
      hierarchyTree: $('hierarchy-tree'),
      hierarchySearch: $('hierarchy-search'),
      inspectorBody: $('inspector-body'),
      consoleLog: $('console-log'),
      toasts: $('toasts'),
      perfHud: $('perf-hud'),
      assetLibrary: $('asset-library'),
      fileImport: $('file-import'),
      panelLeft: $('panel-left'),
      panelRight: $('panel-right'),
      panelBottom: $('panel-bottom')
    };
    _bindToolbar();
    _bindPanels();
    if (_els.hierarchySearch) {
      _els.hierarchySearch.addEventListener('input', function () {
        _searchText = _els.hierarchySearch.value.trim().toLowerCase();
        refreshHierarchy();
      });
    }
    if (_els.fileImport) {
      _els.fileImport.addEventListener('change', _onImportFile);
    }
    // Asset Library: nhóm B chưa có — chỉ hiện trạng thái thật, không vẽ nút giả.
    if (_els.assetLibrary) {
      _els.assetLibrary.innerHTML =
        '<div class="empty-note">Asset Library chưa có.<br>Nhóm B đang làm (03-assets.js).</div>';
    }
    log('Map Editor đã sẵn sàng.');
    refreshHierarchy();
    refreshInspector();
    return true;
  }

  // ---------- Toolbar ----------
  function _bindToolbar() {
    var buttons = document.querySelectorAll('[data-act]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) {
        _handleAct(e.currentTarget.getAttribute('data-act'));
      });
    }
  }

  function _handleAct(act) {
    switch (act) {
      case 'new': _actNew(); break;
      case 'open': _actOpen(); break;
      case 'save': _actSave(); break;
      case 'save-as': _actSaveAs(); break;
      case 'export': _actExport(); break;
      case 'import': if (_els.fileImport) _els.fileImport.click(); break;
      case 'undo': if (ED.Core && ED.Core.undo()) { _afterUndoRedo(); } break;
      case 'redo': if (ED.Core && ED.Core.redo()) { _afterUndoRedo(); } break;
      case 'duplicate': _actDuplicate(); break;
      case 'group': _actGroup(); break;
      case 'delete': _actDelete(); break;
      case 'play': _actPlay('play'); break;
      case 'pause': _actPlay('pause'); break;
      case 'stop': _actPlay('stop'); break;
      case 'focus': if (ED.Viewport) ED.Viewport.focus(); break;
      case 'gizmo-move': if (ED.Viewport) ED.Viewport.setGizmoMode('move'); _markGizmoButtons(); break;
      case 'gizmo-rotate': if (ED.Viewport) ED.Viewport.setGizmoMode('rotate'); _markGizmoButtons(); break;
      case 'gizmo-scale': if (ED.Viewport) ED.Viewport.setGizmoMode('scale'); _markGizmoButtons(); break;
      case 'toggle-left': _togglePanel('panel-left', 'left'); break;
      case 'toggle-right': _togglePanel('panel-right', 'right'); break;
      case 'toggle-bottom': _togglePanel('panel-bottom', 'bottom'); break;
      default:
        if (act && act.indexOf('camera-') === 0) {
          var preset = act.slice('camera-'.length);
          if (ED.Viewport) ED.Viewport.setCameraPreset(preset);
          _markCameraButtons(preset);
        }
        break;
    }
  }

  function _afterUndoRedo() {
    if (ED.Viewport) ED.Viewport.resyncAll();
    refreshHierarchy();
    refreshInspector();
  }

  function _actNew() {
    var name = window.prompt('Tên project mới:', 'Project mới');
    if (name === null) return;
    if (ED.Core) ED.Core.newProject(name || 'Project mới');
    if (ED.Viewport) ED.Viewport.resyncAll();
    refreshHierarchy();
    refreshInspector();
    log('Đã tạo project mới: ' + (name || 'Project mới'));
    toast('Đã tạo project mới');
  }

  function _actOpen() {
    if (!ED.Core) return;
    ED.Core.listProjects().then(function (rows) {
      if (!rows.length) { toast('Chưa có project nào đã lưu'); return; }
      var list = rows.map(function (r, i) { return (i + 1) + '. ' + r.name; }).join('\n');
      var pick = window.prompt('Project đã lưu:\n' + list + '\n\nNhập tên project để mở:', rows[0].name);
      if (!pick) return;
      return ED.Core.loadProject(pick);
    }).then(function (proj) {
      if (!proj) return;
      if (ED.Viewport) ED.Viewport.resyncAll();
      refreshHierarchy();
      refreshInspector();
      log('Đã mở project: ' + proj.name);
      toast('Đã mở: ' + proj.name);
    }).catch(function (err) {
      log('Mở project lỗi: ' + (err && err.message ? err.message : err));
      toast('Mở project lỗi');
    });
  }

  function _actSave() {
    if (!ED.Core) return;
    ED.Core.saveProject().then(function (name) {
      log('Đã lưu project: ' + name);
      toast('Đã lưu: ' + name);
    }).catch(function (err) {
      log('Lưu project lỗi: ' + (err && err.message ? err.message : err));
      toast('Lưu project lỗi');
    });
  }

  function _actSaveAs() {
    if (!ED.Core) return;
    var proj = ED.Core.getProject();
    var name = window.prompt('Lưu thành tên mới:', proj ? proj.name : 'Project mới');
    if (!name) return;
    ED.Core.saveProject(name).then(function (nm) {
      log('Đã lưu project: ' + nm);
      toast('Đã lưu: ' + nm);
    }).catch(function (err) {
      log('Lưu project lỗi: ' + (err && err.message ? err.message : err));
      toast('Lưu project lỗi');
    });
  }

  function _actExport() {
    if (!ED.Core) return;
    var json = ED.Core.serialize();
    var proj = ED.Core.getProject();
    var name = (proj && proj.name ? proj.name : 'project').replace(/[^\w\-]+/g, '_');
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    log('Đã export JSON: ' + name + '.json');
    toast('Đã export JSON');
  }

  function _onImportFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file || !ED.Core) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!ED.Core.load(parsed)) { toast('File không phải project v1'); return; }
        if (ED.Viewport) ED.Viewport.resyncAll();
        refreshHierarchy();
        refreshInspector();
        log('Đã import project: ' + (parsed.name || file.name));
        toast('Đã import: ' + file.name);
      } catch (err) {
        log('Import lỗi: ' + err.message);
        toast('File JSON lỗi');
      }
    };
    reader.readAsText(file);
  }

  function _actDelete() {
    if (!ED.Core) return;
    var obj = ED.Core.selectedObject();
    if (!obj) { toast('Chưa chọn object'); return; }
    if (obj.locked) { toast('Object đã khoá'); return; }
    ED.Core.pushHistory('xoa');
    var id = obj.id;
    ED.Core.removeObject(id);
    if (ED.Viewport) ED.Viewport.removeMesh(id);
    ED.Core.select(null);
    refreshHierarchy();
    refreshInspector();
    log('Đã xoá: ' + obj.name);
  }

  function _actDuplicate() {
    if (!ED.Core || !ED.Viewport) return;
    var src = ED.Core.selectedObject();
    if (!src) { toast('Chưa chọn object'); return; }
    ED.Core.pushHistory('nhan ban');
    var copy = JSON.parse(JSON.stringify(src));
    delete copy.id;
    copy.name = src.name + ' copy';
    copy.pos = [src.pos[0] + 1, src.pos[1], src.pos[2] + 1];
    var obj = ED.Core.addObject(copy);
    ED.Viewport.syncObject(obj);
    ED.Core.select(obj.id);
    refreshHierarchy();
    refreshInspector();
  }

  function _actGroup() {
    if (!ED.Core || !ED.Viewport) return;
    var child = ED.Core.selectedObject();
    if (!child) { toast('Chưa chọn object'); return; }
    ED.Core.pushHistory('nhom');
    var group = ED.Core.addObject({
      type: 'group', category: 'Decorations', name: 'Group',
      pos: child.pos.slice(), color: '#ffd76b'
    });
    child.parent = group.id;
    ED.Core.markDirty();
    ED.Viewport.syncObject(group);
    ED.Viewport.syncObject(child);
    ED.Core.select(group.id);
    refreshHierarchy();
    refreshInspector();
  }

  function _actPlay(mode) {
    if (ED.Play && typeof ED.Play[mode] === 'function') {
      ED.Play[mode]();
      return;
    }
    toast('Play Mode chưa có (nhóm C đang làm)');
    log('Play Mode chưa có — ED.Play chưa được load.');
  }

  function _markGizmoButtons() {
    if (!ED.Viewport) return;
    var mode = ED.Viewport.getGizmoMode();
    var map = { move: 'gizmo-move', rotate: 'gizmo-rotate', scale: 'gizmo-scale' };
    for (var k in map) {
      var btn = document.querySelector('[data-act="' + map[k] + '"]');
      if (btn) btn.classList.toggle('active', k === mode);
    }
  }

  function _markCameraButtons(preset) {
    var btns = document.querySelectorAll('[data-act^="camera-"]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-act') === 'camera-' + preset);
    }
  }

  // ---------- Panel toggle ----------
  function _bindPanels() {
    var tabs = document.querySelectorAll('[data-bottom-tab]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (e) {
        _setBottomTab(e.currentTarget.getAttribute('data-bottom-tab'));
      });
    }
    _setBottomTab('console');
  }

  function _setBottomTab(tab) {
    _bottomTab = tab;
    var tabs = document.querySelectorAll('[data-bottom-tab]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-bottom-tab') === tab);
    }
    var panes = { character: $('tab-character'), timeline: $('tab-timeline'), console: $('tab-console') };
    for (var k in panes) {
      if (panes[k]) panes[k].classList.toggle('hidden', k !== tab);
    }
  }

  function _togglePanel(id, side) {
    var el = $(id);
    if (!el) return;
    el.classList.toggle('collapsed');
    try {
      var prefs = ED.Core ? ED.Core.loadPrefs() : {};
      prefs.panels = prefs.panels || {};
      prefs.panels[side] = el.classList.contains('collapsed');
      if (ED.Core) ED.Core.savePrefs(prefs);
    } catch (e) { /* prefs không bắt buộc */ }
  }

  function restorePanelStates() {
    try {
      var prefs = ED.Core ? ED.Core.loadPrefs() : {};
      var panels = prefs.panels || {};
      if (panels.left && _els.panelLeft) _els.panelLeft.classList.add('collapsed');
      if (panels.right && _els.panelRight) _els.panelRight.classList.add('collapsed');
      if (panels.bottom && _els.panelBottom) _els.panelBottom.classList.add('collapsed');
    } catch (e) { /* bỏ qua */ }
  }

  // ---------- Hierarchy ----------
  function refreshHierarchy() {
    if (!_els.hierarchyTree || !ED.Core) return;
    var objs = ED.Core.listObjects();
    var sel = ED.Core.selectedId();
    var tree = _els.hierarchyTree;
    tree.innerHTML = '';
    if (!objs.length) {
      tree.innerHTML = '<div class="empty-note">Chưa có object nào.</div>';
      return;
    }
    // Nhóm theo category, giữ thứ tự CATEGORY_ORDER.
    var groups = {};
    objs.forEach(function (o) {
      var c = o.category || ED.Core.categoryForType(o.type);
      if (!groups[c]) groups[c] = [];
      groups[c].push(o);
    });
    CATEGORY_ORDER.forEach(function (cat) {
      var list = groups[cat];
      if (!list) return;
      var filtered = list.filter(function (o) {
        return !_searchText || o.name.toLowerCase().indexOf(_searchText) >= 0;
      });
      if (!filtered.length) return;
      var gEl = document.createElement('div');
      gEl.className = 'h-group';
      gEl.setAttribute('data-drop-group', cat);
      var head = document.createElement('div');
      head.className = 'h-group-head';
      head.textContent = '▾ ' + cat + ' (' + filtered.length + ')';
      gEl.appendChild(head);
      filtered.forEach(function (o) {
        gEl.appendChild(_rowFor(o, sel));
      });
      tree.appendChild(gEl);
    });
    // Con có parent thì thụt vào (hiển thị đơn giản: thêm class).
    _bindHierarchyDnD();
  }

  function _rowFor(o, sel) {
    var row = document.createElement('div');
    row.className = 'h-row' + (o.id === sel ? ' selected' : '') + (o.parent ? ' child' : '');
    row.setAttribute('data-id', o.id);
    row.draggable = true;

    var label = document.createElement('span');
    label.className = 'h-label';
    label.textContent = (o.parent ? '↳ ' : '') + o.name + ' · ' + o.type;
    label.title = o.id;
    label.addEventListener('click', function () {
      if (ED.Core) ED.Core.select(o.id);
      if (ED.Viewport) ED.Viewport.resyncAll();
      refreshHierarchy();
      refreshInspector();
    });
    label.addEventListener('dblclick', function () {
      var nm = window.prompt('Đổi tên object:', o.name);
      if (nm === null || !nm.trim()) return;
      if (ED.Core) ED.Core.pushHistory('doi ten');
      o.name = nm.trim();
      if (ED.Core) ED.Core.markDirty();
      refreshHierarchy();
      refreshInspector();
    });
    row.appendChild(label);

    var eye = document.createElement('button');
    eye.className = 'h-btn';
    eye.textContent = o.visible === false ? '🙈' : '👁';
    eye.title = o.visible === false ? 'Hiện' : 'Ẩn';
    eye.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (ED.Core) ED.Core.pushHistory('an/hien');
      o.visible = o.visible === false;
      if (ED.Core) ED.Core.markDirty();
      if (ED.Viewport) ED.Viewport.syncObject(o);
      refreshHierarchy();
    });
    row.appendChild(eye);

    var lock = document.createElement('button');
    lock.className = 'h-btn';
    lock.textContent = o.locked ? '🔒' : '🔓';
    lock.title = o.locked ? 'Mở khoá' : 'Khoá';
    lock.addEventListener('click', function (ev) {
      ev.stopPropagation();
      o.locked = !o.locked;
      if (ED.Core) ED.Core.markDirty();
      refreshHierarchy();
    });
    row.appendChild(lock);

    var del = document.createElement('button');
    del.className = 'h-btn';
    del.textContent = '✕';
    del.title = 'Xoá';
    del.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (o.locked) { toast('Object đã khoá'); return; }
      if (ED.Core) ED.Core.pushHistory('xoa');
      var id = o.id;
      if (ED.Core) ED.Core.removeObject(id);
      if (ED.Viewport) ED.Viewport.removeMesh(id);
      refreshHierarchy();
      refreshInspector();
    });
    row.appendChild(del);
    return row;
  }

  function _bindHierarchyDnD() {
    if (!_els.hierarchyTree) return;
    var rows = _els.hierarchyTree.querySelectorAll('.h-row');
    rows.forEach(function (row) {
      row.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', row.getAttribute('data-id'));
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', function () {
        row.classList.remove('drop-target');
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('drop-target');
        _dropOn(row.getAttribute('data-id'), e);
      });
    });
  }

  function _dropOn(targetId, e) {
    var dragId = e.dataTransfer.getData('text/plain');
    if (!dragId || dragId === targetId || !ED.Core) return;
    var dragObj = ED.Core.getObject(dragId);
    var targetObj = ED.Core.getObject(targetId);
    if (!dragObj || !targetObj) return;
    // Không cho parent là chính nó hoặc con của nó (tránh vòng lặp).
    var p = targetObj.parent;
    var loop = false;
    while (p) {
      if (p === dragId) { loop = true; break; }
      var po = ED.Core.getObject(p);
      p = po ? po.parent : null;
    }
    if (loop) { toast('Không thể đặt parent là con của chính nó'); return; }
    ED.Core.pushHistory('doi parent');
    dragObj.parent = targetId;
    ED.Core.markDirty();
    if (ED.Viewport) { ED.Viewport.syncObject(dragObj); ED.Viewport.syncObject(targetObj); }
    refreshHierarchy();
    log('Đã đặt ' + dragObj.name + ' vào ' + targetObj.name);
  }

  // ---------- Inspector ----------
  function refreshInspector() {
    if (!_els.inspectorBody || !ED.Core) return;
    var body = _els.inspectorBody;
    body.innerHTML = '';
    var obj = ED.Core.selectedObject();
    if (!obj) {
      body.innerHTML = '<div class="empty-note">Chưa chọn object nào.<br>Click vào object trong viewport hoặc cây Hierarchy.</div>';
      return;
    }
    var title = document.createElement('div');
    title.className = 'insp-title';
    title.textContent = obj.name + '  ·  ' + obj.type + '  ·  ' + obj.id;
    body.appendChild(title);

    body.appendChild(_section('Transform', _transformFields(obj)));
    body.appendChild(_section('Material', _materialFields(obj)));
    body.appendChild(_section('Vật liệu & Texture', _materialTextureFields(obj)));
    if (obj.type === 'light' || (obj.extra && obj.extra.light)) {
      body.appendChild(_section('Light', _lightFields(obj)));
    }
    if (obj.type === 'collider' || (obj.extra && obj.extra.collider)) {
      body.appendChild(_section('Collider', _colliderFields(obj)));
    }
    if (obj.type === 'fx' || (obj.extra && obj.extra.fx)) {
      body.appendChild(_section('FX', _fxFields(obj)));
    }
    if (obj.type === 'npc' || obj.type === 'character' || obj.type === 'monster') {
      var note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'Field sâu (dialogue, AI, animation) do nhóm C điền thêm (07-character.js / 08-npc-ai.js).';
      body.appendChild(_section('Character / NPC', note));
    }
  }

  function _section(title, contentEl) {
    var s = document.createElement('div');
    s.className = 'insp-section';
    var h = document.createElement('div');
    h.className = 'insp-section-head';
    h.textContent = title;
    s.appendChild(h);
    s.appendChild(contentEl);
    return s;
  }

  function _vec3Row(label, arr, onChange) {
    var wrap = document.createElement('div');
    wrap.className = 'field-row';
    var lab = document.createElement('span');
    lab.className = 'field-label';
    lab.textContent = label;
    wrap.appendChild(lab);
    ['X', 'Y', 'Z'].forEach(function (axis, i) {
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.step = '0.5';
      inp.value = Math.round(arr[i] * 100) / 100;
      inp.setAttribute('aria-label', label + ' ' + axis);
      inp.addEventListener('change', function () {
        var v = parseFloat(inp.value);
        if (isNaN(v)) { inp.value = arr[i]; return; }
        onChange(i, v);
      });
      wrap.appendChild(inp);
    });
    return wrap;
  }

  function _transformFields(obj) {
    var wrap = document.createElement('div');
    var commit = function () {
      if (ED.Viewport) ED.Viewport.syncObject(obj);
      refreshHierarchy();
    };
    wrap.appendChild(_vec3Row('Vị trí', obj.pos, function (i, v) {
      if (ED.Core) ED.Core.pushHistory('transform');
      obj.pos[i] = v;
      if (ED.Core) ED.Core.markDirty();
      commit();
    }));
    wrap.appendChild(_vec3Row('Xoay (rad)', obj.rot, function (i, v) {
      if (ED.Core) ED.Core.pushHistory('transform');
      obj.rot[i] = v;
      if (ED.Core) ED.Core.markDirty();
      commit();
    }));
    wrap.appendChild(_vec3Row('Tỉ lệ', obj.scale, function (i, v) {
      if (ED.Core) ED.Core.pushHistory('transform');
      obj.scale[i] = v;
      if (ED.Core) ED.Core.markDirty();
      commit();
    }));
    return wrap;
  }

  function _materialFields(obj) {
    var wrap = document.createElement('div');
    obj.material = obj.material || { roughness: 0.8, metalness: 0, opacity: 1 };
    var colorRow = document.createElement('div');
    colorRow.className = 'field-row';
    var lab = document.createElement('span');
    lab.className = 'field-label';
    lab.textContent = 'Màu';
    colorRow.appendChild(lab);
    var color = document.createElement('input');
    color.type = 'color';
    color.value = obj.color || '#9aa0a6';
    color.addEventListener('change', function () {
      if (ED.Core) ED.Core.pushHistory('material');
      obj.color = color.value;
      if (ED.Core) ED.Core.markDirty();
      if (ED.Viewport) ED.Viewport.syncObject(obj);
    });
    colorRow.appendChild(color);
    wrap.appendChild(colorRow);
    var sliders = [
      ['Nhám', 'roughness', 0, 1, 0.05],
      ['Kim loại', 'metalness', 0, 1, 0.05],
      ['Độ mờ', 'opacity', 0, 1, 0.05]
    ];
    sliders.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'field-row';
      var l = document.createElement('span');
      l.className = 'field-label';
      l.textContent = s[0];
      row.appendChild(l);
      var inp = document.createElement('input');
      inp.type = 'range';
      inp.min = s[2]; inp.max = s[3]; inp.step = s[4];
      inp.value = obj.material[s[1]];
      inp.addEventListener('change', function () {
        if (ED.Core) ED.Core.pushHistory('material');
        obj.material[s[1]] = parseFloat(inp.value);
        if (ED.Core) ED.Core.markDirty();
        if (ED.Viewport) ED.Viewport.syncObject(obj);
      });
      row.appendChild(inp);
      var val = document.createElement('span');
      val.className = 'field-val';
      val.textContent = obj.material[s[1]];
      inp.addEventListener('input', function () { val.textContent = inp.value; });
      row.appendChild(val);
      wrap.appendChild(row);
    });
    return wrap;
  }

  // Slider vật liệu: kéo thì áp ngay (chưa ghi lịch sử), nhả tay mới
  // pushHistory 1 lần để undo trả về đúng trạng thái trước khi kéo.
  function _matSliderRow(label, min, max, step, value, onInput, historyLabel) {
    var row = document.createElement('div');
    row.className = 'field-row';
    var l = document.createElement('span');
    l.className = 'field-label';
    l.textContent = label;
    row.appendChild(l);
    var inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min; inp.max = max; inp.step = step;
    inp.value = value;
    var val = document.createElement('span');
    val.className = 'field-val';
    val.textContent = value;
    var pushed = false;
    inp.addEventListener('input', function () {
      if (!pushed) {
        if (ED.Core) ED.Core.pushHistory(historyLabel || 'material');
        pushed = true;
      }
      val.textContent = inp.value;
      onInput(parseFloat(inp.value));
    });
    inp.addEventListener('change', function () {
      pushed = false;
      if (ED.Core) ED.Core.markDirty();
    });
    row.appendChild(inp);
    row.appendChild(val);
    return row;
  }

  // Section "Vật liệu & Texture" (ED.Material, 13-material.js):
  // xem trước 3D (hộp/cầu xoay, fallback UV 2D), 5 khe texture
  // (đợt 4 thêm AO + emissive), tiling/offset, emissive, preset 1 chạm.
  function _materialTextureFields(obj) {
    var wrap = document.createElement('div');
    obj.material = obj.material || { roughness: 0.8, metalness: 0, opacity: 1 };
    var M = ED.Material;
    if (!M) {
      var note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'Module Vật liệu & Texture chưa load (13-material.js).';
      wrap.appendChild(note);
      return wrap;
    }
    var mat = M.normalizeMaterial ? M.normalizeMaterial(obj.material) : obj.material;
    obj.material = mat;

    // Xem trước 3D (đợt 4): mini renderer riêng vẽ material hiện tại
    // lên hộp/cầu xoay chậm, có nút xoay/dừng + đổi hình. WebGL lỗi
    // (createPreview3D trả null) -> fallback canvas UV 2D cũ.
    var uv = document.createElement('canvas');
    uv.className = 'ed-mat-uv';
    uv.width = 220; uv.height = 220;
    uv.setAttribute('aria-label', 'Xem trước UV');
    var pvWrap = document.createElement('div');
    pvWrap.className = 'ed-mat-preview3d';
    var pvCanvas = document.createElement('canvas');
    pvCanvas.className = 'ed-mat-preview3d-canvas';
    pvCanvas.width = 220; pvCanvas.height = 160;
    pvCanvas.setAttribute('aria-label', 'Xem trước vật liệu 3D');
    pvWrap.appendChild(pvCanvas);
    var pvRow = document.createElement('div');
    pvRow.className = 'ed-mat-preview3d-row';
    var pvSpin = document.createElement('button');
    pvSpin.className = 'ed-mat-preview3d-btn';
    pvSpin.textContent = 'Dừng xoay';
    var pvShape = document.createElement('button');
    pvShape.className = 'ed-mat-preview3d-btn';
    pvShape.textContent = 'Hình: Hộp';
    pvRow.appendChild(pvSpin);
    pvRow.appendChild(pvShape);
    pvWrap.appendChild(pvRow);
    wrap.appendChild(pvWrap);
    var pv = null;
    try { pv = (M.createPreview3D) ? M.createPreview3D(pvCanvas, function () { return obj; }) : null; } catch (e) { pv = null; }
    if (pv) {
      pvSpin.addEventListener('click', function () {
        var next = !pv.isSpinning;
        pv.setSpinning(next);
        pvSpin.textContent = next ? 'Dừng xoay' : 'Xoay';
      });
      pvShape.addEventListener('click', function () {
        var next = (M.nextPreviewShape) ? M.nextPreviewShape(pv.shape) : (pv.shape === 'sphere' ? 'box' : 'sphere');
        pv.setShape(next);
        pvShape.textContent = 'Hình: ' + ((M.previewShapeLabel) ? M.previewShapeLabel(next) : next);
      });
    } else {
      // Fallback: không có WebGL -> xem trước UV 2D như đợt 2.
      pvWrap.style.display = 'none';
      wrap.appendChild(uv);
      M.drawUvPreview(uv);
    }

    // 1 input file ẩn dùng chung cho cả 3 khe texture.
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.style.display = 'none';
    wrap.appendChild(picker);
    var curSlot = null;
    picker.addEventListener('change', function () {
      var f = picker.files && picker.files[0];
      picker.value = '';
      if (!f || !curSlot) return;
      M.assignTexture(obj, curSlot, f).then(function () {
        refreshInspector();
        toast('Đã gán texture: ' + f.name);
      }).catch(function (err) {
        toast(err && err.message ? err.message : 'Import texture lỗi');
        log('Texture lỗi: ' + (err && err.message ? err.message : err));
      });
    });

    // 5 khe texture (đợt 4 thêm AO + emissive), lấy từ M.SLOTS để khỏi
    // lệch với 13-material.js; module cũ chưa có thì về 3 khe đợt 2.
    var slots = (M.SLOTS || ['map', 'normalMap', 'roughnessMap']).map(function (slot) {
      return [slot, (M.SLOT_LABELS && M.SLOT_LABELS[slot]) || slot];
    });
    slots.forEach(function (s) {
      var slot = s[0];
      var row = document.createElement('div');
      row.className = 'field-row';
      var l = document.createElement('span');
      l.className = 'field-label';
      l.textContent = s[1];
      row.appendChild(l);
      var key = obj.material[slot];
      var name = document.createElement('span');
      name.className = 'ed-mat-slot-name';
      // Đợt 4: tên file + kích thước ('ao.png · 123 KB'); chưa nạp record
      // thì chỉ tên, chưa gán thì 'Chưa có'.
      var meta = (M.textureMeta) ? M.textureMeta(key) : null;
      var metaName = (meta && meta.name) ? meta.name : (key ? (M.textureName(key) || 'Đã gán texture') : 'Chưa có');
      var metaSize = (meta && typeof meta.size === 'number' && M.formatTextureSize) ? M.formatTextureSize(meta.size) : '';
      name.textContent = key ? (metaSize ? metaName + ' · ' + metaSize : metaName) : 'Chưa có';
      name.title = key ? (metaName + (metaSize ? ' (' + metaSize + ')' : '')) : '';
      row.appendChild(name);
      var pick = document.createElement('button');
      pick.className = 'ed-mat-slot-btn';
      pick.textContent = key ? 'Đổi ảnh' : 'Chọn ảnh';
      pick.addEventListener('click', function () { curSlot = slot; picker.click(); });
      row.appendChild(pick);
      if (key) {
        var del = document.createElement('button');
        del.className = 'ed-mat-slot-btn';
        del.textContent = '✕';
        del.title = 'Gỡ texture';
        del.addEventListener('click', function () {
          M.clearTexture(obj, slot);
          refreshInspector();
        });
        row.appendChild(del);
      }
      wrap.appendChild(row);
    });

    // Tiling / Offset.
    var sub = document.createElement('div');
    sub.className = 'ed-mat-sub';
    sub.textContent = 'Lặp & dịch texture';
    wrap.appendChild(sub);
    var tiling = [
      ['Lặp X', 'rx', 0.1, 10, 0.1, mat.repeat[0]],
      ['Lặp Y', 'ry', 0.1, 10, 0.1, mat.repeat[1]],
      ['Dịch X', 'ox', 0, 1, 0.01, mat.offset[0]],
      ['Dịch Y', 'oy', 0, 1, 0.01, mat.offset[1]]
    ];
    tiling.forEach(function (t) {
      wrap.appendChild(_matSliderRow(t[0], t[2], t[3], t[4], t[5], function (v) {
        if (t[1] === 'rx') mat.repeat[0] = v;
        else if (t[1] === 'ry') mat.repeat[1] = v;
        else if (t[1] === 'ox') mat.offset[0] = v;
        else mat.offset[1] = v;
        M.applyLive(obj);
      }, 'vat lieu tiling'));
    });

    // Emissive.
    var sub2 = document.createElement('div');
    sub2.className = 'ed-mat-sub';
    sub2.textContent = 'Phát sáng (emissive)';
    wrap.appendChild(sub2);
    var eRow = document.createElement('div');
    eRow.className = 'field-row';
    var el = document.createElement('span');
    el.className = 'field-label';
    el.textContent = 'Màu';
    eRow.appendChild(el);
    var eColor = document.createElement('input');
    eColor.type = 'color';
    eColor.value = mat.emissive || '#000000';
    eColor.addEventListener('change', function () {
      M.setEmissive(obj, eColor.value, mat.emissiveIntensity);
    });
    eRow.appendChild(eColor);
    wrap.appendChild(eRow);
    wrap.appendChild(_matSliderRow('Cường độ', 0, 3, 0.05, mat.emissiveIntensity || 0, function (v) {
      mat.emissiveIntensity = v;
      M.applyLive(obj);
    }, 'vat lieu emissive'));

    // Preset 1 chạm.
    var sub3 = document.createElement('div');
    sub3.className = 'ed-mat-sub';
    sub3.textContent = 'Preset 1 chạm';
    wrap.appendChild(sub3);
    var grid = document.createElement('div');
    grid.className = 'ed-mat-presets';
    M.listPresets().forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'ed-mat-preset';
      b.textContent = p.label;
      b.addEventListener('click', function () {
        if (M.applyPreset(obj, p.name)) {
          refreshInspector();
          toast('Đã áp preset ' + p.label);
        }
      });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function _lightFields(obj) {
    var wrap = document.createElement('div');
    obj.extra = obj.extra || {};
    obj.extra.light = obj.extra.light || { intensity: 1, lightColor: '#ffd76b' };
    var ex = obj.extra.light;
    var row = document.createElement('div');
    row.className = 'field-row';
    var l = document.createElement('span');
    l.className = 'field-label';
    l.textContent = 'Màu đèn';
    row.appendChild(l);
    var color = document.createElement('input');
    color.type = 'color';
    color.value = ex.lightColor;
    color.addEventListener('change', function () {
      if (ED.Core) ED.Core.pushHistory('light');
      ex.lightColor = color.value;
      if (ED.Core) ED.Core.markDirty();
      if (ED.Viewport) ED.Viewport.syncObject(obj);
    });
    row.appendChild(color);
    wrap.appendChild(row);
    var iRow = document.createElement('div');
    iRow.className = 'field-row';
    var l2 = document.createElement('span');
    l2.className = 'field-label';
    l2.textContent = 'Cường độ';
    iRow.appendChild(l2);
    var inp = document.createElement('input');
    inp.type = 'range';
    inp.min = 0; inp.max = 5; inp.step = 0.1;
    inp.value = ex.intensity;
    inp.addEventListener('change', function () {
      if (ED.Core) ED.Core.pushHistory('light');
      ex.intensity = parseFloat(inp.value);
      if (ED.Core) ED.Core.markDirty();
      if (ED.Viewport) ED.Viewport.syncObject(obj);
    });
    iRow.appendChild(inp);
    wrap.appendChild(iRow);
    return wrap;
  }

  function _colliderFields(obj) {
    var wrap = document.createElement('div');
    obj.extra = obj.extra || {};
    obj.extra.collider = obj.extra.collider || { shape: 'box', trigger: false };
    var ex = obj.extra.collider;
    var row = document.createElement('div');
    row.className = 'field-row';
    var l = document.createElement('span');
    l.className = 'field-label';
    l.textContent = 'Hình dạng';
    row.appendChild(l);
    var sel = document.createElement('select');
    ['box', 'sphere'].forEach(function (s) {
      var o = document.createElement('option');
      o.value = s; o.textContent = s;
      if (ex.shape === s) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      if (ED.Core) ED.Core.pushHistory('collider');
      ex.shape = sel.value;
      if (ED.Core) ED.Core.markDirty();
      if (ED.Viewport) ED.Viewport.syncObject(obj);
    });
    row.appendChild(sel);
    wrap.appendChild(row);
    var tRow = document.createElement('div');
    tRow.className = 'field-row';
    var l2 = document.createElement('span');
    l2.className = 'field-label';
    l2.textContent = 'Trigger';
    tRow.appendChild(l2);
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!ex.trigger;
    chk.addEventListener('change', function () {
      if (ED.Core) ED.Core.pushHistory('collider');
      ex.trigger = chk.checked;
      if (ED.Core) ED.Core.markDirty();
    });
    tRow.appendChild(chk);
    wrap.appendChild(tRow);
    return wrap;
  }

  function _fxFields(obj) {
    var wrap = document.createElement('div');
    var note = document.createElement('div');
    note.className = 'empty-note';
    note.textContent = 'FX chi tiết do nhóm B làm (06-fx.js). Khung extra.fx đã có sẵn trong project.';
    wrap.appendChild(note);
    return wrap;
  }

  // ---------- Console / toast / perf ----------
  function log(msg) {
    if (!_els.consoleLog) return;
    var now = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var time = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    var line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = '[' + time + '] ' + msg;
    _els.consoleLog.appendChild(line);
    _logCount++;
    while (_els.consoleLog.children.length > 200) {
      _els.consoleLog.removeChild(_els.consoleLog.firstChild);
    }
    _els.consoleLog.scrollTop = _els.consoleLog.scrollHeight;
  }

  function toast(msg) {
    if (!_els.toasts) return;
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    _els.toasts.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 3000);
  }

  function setPerf(p) {
    if (!_els.perfHud) return;
    _els.perfHud.textContent =
      'FPS ' + p.fps + ' · Draw ' + p.calls + ' · Tri ' + p.tris +
      ' · Vert ' + p.verts + (p.mem ? ' · ' + p.mem + ' MB' : '') +
      (p.chunks ? ' · Chunk ' + p.chunks : '');
  }

  return {
    init: init,
    log: log, toast: toast,
    refreshHierarchy: refreshHierarchy, refreshInspector: refreshInspector,
    setPerf: setPerf, restorePanelStates: restorePanelStates
  };
})();
