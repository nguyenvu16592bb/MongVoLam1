/* ============================== EDITOR PATCH ==============================
   13-editor-patch.js — áp patch của Map Editor lên game đang chạy.
   Patch: localStorage 'mongvolam_editor_patch_v1'
     {version:1, npcsMoved:[{id,x,z}], npcsAdded:[{...npc}], propsAdded:[{type,x,z,rotY,scale}]}
   hoặc EMBEDDED_PATCH (var, do editor chèn cuối file khi xuất
   "mongvolam.html đã sửa" — xem src/editor/10-game-link.js).
   - Mặc định không có patch thì game không đổi gì.
   - Hook ít xâm lấn nhất: bọc CharacterManager.initPopulation() — hàm này
     spawn toàn bộ NPC xong mới trả về, nên patch áp dụng ngay sau đó, và
     tự áp lại mỗi lần initPopulation() chạy lại (nó xóa sạch entities).
   - Mọi lỗi (JSON sai, id không tồn tại, số không hợp lệ) đều try/catch
     từng mục + console.warn, KHÔNG crash game, KHÔNG chạm save v2.
   - Không thêm UI game. Chỉ logic patch + window.__mvlEditorPatchInfo().
   - Logic thuần (parse/validate/applyToState) không phụ thuộc DOM/THREE
     để tools/test-mapeditor.cjs load bằng vm mà test được.
   Chạy: node tools/test-mapeditor.cjs */

var EditorPatch = (function () {
  var PATCH_KEY = 'mongvolam_editor_patch_v1';
  /* Prop nào editor được phép thêm + cách dựng trong game. 'tree'/'lantern'
     dùng đúng hàm có sẵn của Engine (02-world.js); còn lại dựng primitive
     đơn giản (hộp/đá) để không phụ thuộc builder chưa có. */
  var PROP_TYPES = ['tree', 'lantern', 'rock', 'stone', 'bush', 'pillar'];

  var _last = { applied: false, source: null, moved: [], addedNpcs: [], addedProps: [], skipped: [], errors: [] };

  function isNum(n) { return typeof n === 'number' && isFinite(n); }

  /* Đọc patch từ chuỗi JSON (localStorage hoặc EMBEDDED_PATCH đã stringify).
     Trả {ok, patch|null, reason}. Không throw. */
  function parsePatch(raw) {
    if (raw === null || raw === undefined || raw === '') return { ok: false, patch: null, reason: 'khong-co-patch' };
    var obj = null;
    try { obj = (typeof raw === 'string') ? JSON.parse(raw) : raw; }
    catch (e) { return { ok: false, patch: null, reason: 'json-sai: ' + (e && e.message) }; }
    return validatePatch(obj);
  }

  /* Chuẩn hóa patch lạ về dạng an toàn; mục sai thì bỏ qua + ghi reason.
     Không throw với mọi đầu vào. */
  function validatePatch(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, patch: null, reason: 'patch-khong-phai-object' };
    }
    if (obj.version !== 1 && obj.version !== undefined) errors.push('version-la: ' + obj.version);
    var out = { version: 1, npcsMoved: [], npcsAdded: [], propsAdded: [] };
    var list = Array.isArray(obj.npcsMoved) ? obj.npcsMoved : [];
    list.forEach(function (m, i) {
      if (!m || typeof m.id !== 'string' || !m.id || !isNum(m.x) || !isNum(m.z)) {
        errors.push('npcsMoved[' + i + '] sai (can id/x/z so)'); return;
      }
      out.npcsMoved.push({ id: m.id, x: m.x, z: m.z });
    });
    list = Array.isArray(obj.npcsAdded) ? obj.npcsAdded : [];
    list.forEach(function (n, i) {
      if (!n || typeof n.id !== 'string' || !n.id || typeof n.name !== 'string' || !n.name || !isNum(n.x) || !isNum(n.z)) {
        errors.push('npcsAdded[' + i + '] sai (can id/name/x/z so)'); return;
      }
      out.npcsAdded.push({
        id: n.id, name: String(n.name).slice(0, 24), x: n.x, z: n.z,
        robe: typeof n.robe === 'string' ? n.robe : '#7e22ce',
        belt: typeof n.belt === 'string' ? n.belt : '#facc15',
        hair: typeof n.hair === 'string' ? n.hair : '#1e1b18',
        dialogue: typeof n.dialogue === 'string' ? n.dialogue : 'Xin chào thiếu hiệp!',
        role: typeof n.role === 'string' ? n.role : undefined,
        scale: isNum(n.scale) ? Math.min(2, Math.max(0.5, n.scale)) : undefined
      });
    });
    list = Array.isArray(obj.propsAdded) ? obj.propsAdded : [];
    list.forEach(function (p, i) {
      if (!p || typeof p.type !== 'string' || PROP_TYPES.indexOf(p.type) < 0 || !isNum(p.x) || !isNum(p.z)) {
        errors.push('propsAdded[' + i + '] sai (type phai la ' + PROP_TYPES.join('/') + ', can x/z so)'); return;
      }
      out.propsAdded.push({
        type: p.type, x: p.x, z: p.z,
        rotY: isNum(p.rotY) ? p.rotY : 0,
        scale: isNum(p.scale) ? Math.min(3, Math.max(0.5, p.scale)) : 1
      });
    });
    return { ok: true, patch: out, reason: errors.length ? errors.join('; ') : null };
  }

  /* Logic thuần: áp patch lên state game giả {npcs:[{id,x,z,anchor?}], props:[]}.
     Dời NPC có id (cập nhật cả anchor nếu có), id lạ thì bỏ qua (skipped),
     thêm NPC/prop mới. Không throw. Trả báo cáo {moved, addedNpcs, addedProps, skipped}. */
  function applyToState(state, patch) {
    var report = { moved: [], addedNpcs: [], addedProps: [], skipped: [] };
    if (!state || !Array.isArray(state.npcs)) return report;
    if (!Array.isArray(state.props)) state.props = [];
    var parsed = validatePatch(patch);
    if (!parsed.ok || !parsed.patch) { report.skipped.push('patch-khong-hop-le'); return report; }
    var p = parsed.patch;
    p.npcsMoved.forEach(function (m) {
      var found = null;
      for (var i = 0; i < state.npcs.length; i++) if (state.npcs[i].id === m.id) { found = state.npcs[i]; break; }
      if (!found) { report.skipped.push('npc-khong-ton-tai: ' + m.id); return; }
      found.x = m.x; found.z = m.z;
      if (found.anchor) { found.anchor.x = m.x; found.anchor.z = m.z; }
      report.moved.push(m.id);
    });
    p.npcsAdded.forEach(function (n) {
      var dup = false;
      for (var i = 0; i < state.npcs.length; i++) if (state.npcs[i].id === n.id) { dup = true; break; }
      if (dup) { report.skipped.push('npc-trung-id: ' + n.id); return; }
      state.npcs.push({ id: n.id, name: n.name, x: n.x, z: n.z, robe: n.robe, belt: n.belt, hair: n.hair, dialogue: n.dialogue, anchor: { x: n.x, z: n.z } });
      report.addedNpcs.push(n.id);
    });
    p.propsAdded.forEach(function (pr) {
      state.props.push({ type: pr.type, x: pr.x, z: pr.z, rotY: pr.rotY, scale: pr.scale });
      report.addedProps.push(pr.type + '@' + pr.x + ',' + pr.z);
    });
    return report;
  }

  /* ---- Phần chạy trong trình duyệt (guarded, không chạm DOM/THREE ở top-level) ---- */

  function readStoredPatch() {
    try {
      if (typeof localStorage !== 'undefined') {
        var raw = localStorage.getItem(PATCH_KEY);
        if (raw) return { source: 'localStorage', parsed: parsePatch(raw) };
      }
    } catch (e) { return { source: 'localStorage', parsed: { ok: false, patch: null, reason: 'doc-localStorage-loi: ' + (e && e.message) } }; }
    try {
      if (typeof EMBEDDED_PATCH !== 'undefined' && EMBEDDED_PATCH) {
        return { source: 'embedded', parsed: parsePatch(EMBEDDED_PATCH) };
      }
    } catch (e) { /* EMBEDDED_PATCH chưa khai báo trong scope -> coi như không có */ }
    return { source: null, parsed: { ok: false, patch: null, reason: 'khong-co-patch' } };
  }

  /* NPC có lịch trình (NPC_SCHEDULES) sẽ bị NpcAI kéo về điểm ca làm việc
     ở ca tiếp theo nếu chỉ dời mesh — nên dời toàn bộ điểm ca theo cùng
     delta (dx,dz) để NPC giữ vị trí mới suốt ngày mà vẫn đi ca như cũ. */
  function shiftSchedule(id, dx, dz) {
    try {
      if (typeof NPC_SCHEDULES === 'undefined' || !NPC_SCHEDULES[id]) return false;
      var s = NPC_SCHEDULES[id];
      Object.keys(s).forEach(function (k) { if (s[k]) { s[k].x += dx; s[k].z += dz; } });
      return true;
    } catch (e) { return false; }
  }

  function moveLiveNpc(ent, x, z) {
    var oldX = ent.mesh.position.x, oldZ = ent.mesh.position.z;
    ent.mesh.position.x = x;
    ent.mesh.position.z = z;
    /* Dân thường đi lại quanh anchor -> dời anchor theo để không quay về chỗ cũ. */
    if (ent._anchor) { ent._anchor.x = x; ent._anchor.z = z; }
    if (ent._wander) ent._wander.target = null;
    if (ent._walk) ent._walk = null;
    shiftSchedule(ent.id, x - oldX, z - oldZ);
  }

  function addLiveNpc(def) {
    if (typeof CharacterManager === 'undefined' || typeof CharacterManager.create !== 'function') return null;
    var opt = {
      id: def.id, name: def.name, x: def.x, z: def.z,
      robe: def.robe, belt: def.belt, hair: def.hair,
      isNpc: true, dialogue: def.dialogue || 'Xin chào thiếu hiệp!'
    };
    if (def.role) opt.role = def.role;
    var ent = CharacterManager.create(opt);
    if (ent && def.scale && ent.mesh) ent.mesh.scale.set(def.scale, def.scale, def.scale);
    return ent;
  }

  /* Dựng prop: ưu tiên hàm có sẵn của Engine (cây/đèn giống hệt game),
     còn lại dựng primitive đơn giản (đá/bụi/cột). Lỗi từng cái không chặn cái khác. */
  function addLiveProp(pr) {
    var mesh = null;
    try {
      if (typeof Engine !== 'undefined') {
        if (pr.type === 'tree' && typeof Engine.buildTree === 'function') { Engine.buildTree(pr.x, pr.z); return 'tree'; }
        if (pr.type === 'lantern' && typeof Engine.buildLantern === 'function') { Engine.buildLantern(pr.x, pr.z); return 'lantern'; }
      }
    } catch (e) { console.warn('[EditorPatch] build prop ' + pr.type + ' loi: ' + (e && e.message)); }
    try {
      if (typeof THREE === 'undefined' || typeof Engine === 'undefined' || !Engine.scene) return null;
      var mat = new THREE.MeshStandardMaterial({ color: pr.type === 'rock' || pr.type === 'stone' ? '#84918e' : pr.type === 'pillar' ? '#8f2922' : '#166534', roughness: .85 });
      var geo;
      if (pr.type === 'rock' || pr.type === 'stone') geo = new THREE.DodecahedronGeometry(0.9 * pr.scale, 0);
      else if (pr.type === 'pillar') geo = new THREE.CylinderGeometry(0.4 * pr.scale, 0.5 * pr.scale, 2.4 * pr.scale, 8);
      else geo = new THREE.SphereGeometry(0.9 * pr.scale, 10, 8); /* bush */
      mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pr.x, (pr.type === 'pillar' ? 1.2 : 0.5) * pr.scale, pr.z);
      mesh.rotation.y = pr.rotY || 0;
      mesh.castShadow = true;
      Engine.scene.add(mesh);
      return pr.type;
    } catch (e) {
      console.warn('[EditorPatch] prop primitive ' + pr.type + ' loi: ' + (e && e.message));
      return null;
    }
  }

  /* Áp patch lên world thật (đã spawn xong). Trả báo cáo, không throw. */
  function applyLive() {
    var report = { applied: false, source: null, moved: [], addedNpcs: [], addedProps: [], skipped: [], errors: [] };
    var stored = readStoredPatch();
    if (!stored.parsed.ok || !stored.parsed.patch) {
      if (stored.parsed.reason && stored.parsed.reason !== 'khong-co-patch') {
        report.errors.push(stored.parsed.reason);
        console.warn('[EditorPatch] bo qua patch: ' + stored.parsed.reason);
      }
      _last = report;
      return report;
    }
    var p = stored.parsed.patch;
    if (stored.parsed.reason) report.errors.push(stored.parsed.reason);
    report.source = stored.source;
    var entities = (typeof CharacterManager !== 'undefined' && Array.isArray(CharacterManager.entities))
      ? CharacterManager.entities : [];
    p.npcsMoved.forEach(function (m) {
      try {
        var ent = null;
        for (var i = 0; i < entities.length; i++) if (entities[i].id === m.id) { ent = entities[i]; break; }
        if (!ent || !ent.mesh) { report.skipped.push('npc-khong-ton-tai: ' + m.id); return; }
        if (ent.isPlayer) { report.skipped.push('khong-doi-duoc-player: ' + m.id); return; }
        moveLiveNpc(ent, m.x, m.z);
        report.moved.push(m.id);
      } catch (e) { report.skipped.push(m.id + ': ' + (e && e.message)); }
    });
    p.npcsAdded.forEach(function (n) {
      try {
        var dup = false;
        for (var i = 0; i < entities.length; i++) if (entities[i].id === n.id) { dup = true; break; }
        if (dup) { report.skipped.push('npc-trung-id: ' + n.id); return; }
        var created = addLiveNpc(n);
        if (created) report.addedNpcs.push(n.id);
        else report.skipped.push('khong-tao-duoc-npc: ' + n.id);
      } catch (e) { report.skipped.push(n.id + ': ' + (e && e.message)); }
    });
    p.propsAdded.forEach(function (pr) {
      try {
        var made = addLiveProp(pr);
        if (made) report.addedProps.push(made + '@' + pr.x + ',' + pr.z);
        else report.skipped.push('khong-tao-duoc-prop: ' + pr.type);
      } catch (e) { report.skipped.push(pr.type + ': ' + (e && e.message)); }
    });
    report.applied = (report.moved.length + report.addedNpcs.length + report.addedProps.length) > 0;
    if (report.applied) {
      console.log('[EditorPatch] da ap dung patch (' + report.source + '): doi ' + report.moved.length +
        ' NPC, them ' + report.addedNpcs.length + ' NPC, ' + report.addedProps.length + ' prop.' +
        (report.skipped.length ? ' Bo qua: ' + report.skipped.join('; ') : ''));
    } else if (report.skipped.length) {
      console.warn('[EditorPatch] patch khong ap duoc muc nao. Bo qua: ' + report.skipped.join('; '));
    }
    _last = report;
    return report;
  }

  /* Bọc initPopulation: gọi hàm gốc xong mới áp patch. Chỉ bọc 1 lần. */
  var _wrapped = false;
  function install() {
    if (_wrapped) return true;
    try {
      if (typeof CharacterManager === 'undefined' || typeof CharacterManager.initPopulation !== 'function') return false;
      var orig = CharacterManager.initPopulation;
      CharacterManager.initPopulation = function () {
        var r = orig.apply(this, arguments);
        try { applyLive(); } catch (e) { console.warn('[EditorPatch] applyLive loi: ' + (e && e.message)); }
        return r;
      };
      _wrapped = true;
      return true;
    } catch (e) {
      console.warn('[EditorPatch] install loi: ' + (e && e.message));
      return false;
    }
  }

  function info() {
    return {
      applied: _last.applied, source: _last.source,
      moved: _last.moved.slice(), addedNpcs: _last.addedNpcs.slice(),
      addedProps: _last.addedProps.slice(), skipped: _last.skipped.slice(),
      errors: _last.errors.slice(), key: PATCH_KEY, wrapped: _wrapped
    };
  }

  /* Chạy ngay khi file load (CharacterManager đã có vì parts nạp 02-world.js
     trước file này); nếu chưa có (test vm) thì install() trả false, không lỗi. */
  install();

  var api = {
    PATCH_KEY: PATCH_KEY, PROP_TYPES: PROP_TYPES.slice(),
    parsePatch: parsePatch, validatePatch: validatePatch, applyToState: applyToState,
    applyLive: applyLive, install: install, info: info
  };
  try {
    if (typeof window !== 'undefined') {
      window.EditorPatch = api;
      window.__mvlEditorPatchInfo = info;
    }
  } catch (e) { /* vm không có window: bỏ qua, api vẫn trả qua return */ }
  return api;
})();

if (typeof module !== 'undefined' && module.exports) { try { module.exports = EditorPatch; } catch (e) {} }
