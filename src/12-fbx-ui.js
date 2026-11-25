/* ============================== FBX UI (BƯỚC 2) ==============================
   UI cho 2 phạm vi .fbx của game (nền tảng ở src/11-fbx.js — chỉ dùng đúng
   API FBXSupport, không tự chế API khác):
   - HeroFBX: gắn model .fbx của người chơi vào đúng root nhân vật
     (PlayerController.entity.mesh) để vị trí/xoay theo PlayerController;
     chibi cũ chỉ ẨN (không xóa), hiện lại khi về mặc định. Có animation thì
     phát clip đầu tiên lặp lại bằng THREE.AnimationMixer (update trong
     World.update, ngay sau CharacterManager.update); không có animation thì
     chỉ nhún theo chibi (nhún do CharacterManager.update đặt trên root).
     Trong trận giữ nguyên chibi — không chạm src/03-battle.js.
   - FbxProps: đạo cụ/NPC .fbx trong thành (tối đa 5): đặt tại chỗ người
     chơi đang đứng (kiểm Engine.isWalkable), xoay/scale/xóa, bảng tên cho
     NPC, nạp lại khi vào thế giới (lỗi từng cái thì bỏ qua + toast 1 lần).
   - FbxUI: file picker + modal Thợ Dựng Cảnh + nút nhập hero trong Hồ sơ
     và Cài đặt. Mọi lỗi tiếng Việt, try/catch, không crash game khi file
     lỗi hay IndexedDB lỗi. */

const HeroFBX = {
  group: null,    /* group FBX đang gắn trên root nhân vật (null = đang dùng chibi) */
  mixer: null,    /* THREE.AnimationMixer, null khi model không có animation */
  _hidden: [],    /* các con chibi đang ẩn (hiện lại khi gỡ model) */
  _busy: false,   /* đang đọc + parse file hero (khóa nút nhập) */

  /* Ẩn chibi cũ rồi gắn model FBX vào root nhân vật. Decal bóng/hào quang
     (con có y < 0.2, sát đất) được giữ nguyên để model FBX có bóng dưới chân.
     Trả true nếu gắn được, false khi chưa vào thế giới / model rỗng. */
  apply(parsed) {
    try {
      const ent = (typeof PlayerController !== 'undefined') ? PlayerController.entity : null;
      if (!ent || !ent.mesh || !parsed || !parsed.group) return false;
      this.restore(true); /* gỡ model cũ (nếu có), hiện lại chibi trước */
      const root = ent.mesh;
      this._hidden = [];
      root.children.slice().forEach(c => {
        if (!c || c === parsed.group) return;
        const y = (c.position && typeof c.position.y === 'number') ? c.position.y : 0;
        if (y < 0.2) return; /* decal bóng/hào quang: giữ nguyên */
        c.visible = false;
        this._hidden.push(c);
      });
      parsed.group.position.set(0, 0, 0);
      parsed.group.rotation.set(0, 0, 0);
      root.add(parsed.group);
      this.group = parsed.group;
      this.mixer = null;
      const clips = parsed.animations || [];
      if (clips.length && typeof THREE !== 'undefined' && THREE.AnimationMixer) {
        try {
          const mixer = new THREE.AnimationMixer(parsed.group);
          mixer.clipAction(clips[0]).play();
          this.mixer = mixer;
        } catch (e) { this.mixer = null; }
      }
      return true;
    } catch (e) { return false; }
  },

  /* Gỡ model FBX, hiện lại chibi. Luôn an toàn (không throw). */
  restore() {
    try {
      const ent = (typeof PlayerController !== 'undefined') ? PlayerController.entity : null;
      if (this.group && ent && ent.mesh) {
        try { ent.mesh.remove(this.group); } catch (e) {}
      }
      this.group = null;
      this.mixer = null;
      this._hidden.forEach(c => { try { c.visible = true; } catch (e) {} });
      this._hidden = [];
    } catch (e) {}
    return true;
  },

  /* Cập nhật AnimationMixer (gọi trong World.update, sau CharacterManager.update). */
  update(dt) {
    if (this.mixer && dt > 0) {
      try { this.mixer.update(dt); } catch (e) { this.mixer = null; }
    }
  },

  /* Nạp lại model hero đã lưu khi mở game: chưa lưu thì thôi; lỗi thì toast
     + giữ chibi, KHÔNG xóa flag/file của người chơi. */
  restoreFromSave() {
    if (typeof FBXSupport === 'undefined' || !FBXSupport.loadHeroModel) return;
    let p = null;
    try { p = FBXSupport.loadHeroModel(); } catch (e) { p = Promise.reject(e); }
    if (!p || typeof p.then !== 'function') return;
    p.then(parsed => {
      if (parsed) this.apply(parsed);
    }).catch(e => {
      if (typeof UI !== 'undefined') UI.toast('Không nạp được mô hình .fbx nhân vật: ' + (e && e.message ? e.message : 'lỗi không rõ') + ' — vẫn dùng chibi mặc định, thử nhập lại file nhé!', 'red');
    });
  },

  /* Về chibi mặc định: xóa file hero khỏi IndexedDB + flag rồi hiện chibi. */
  clear() {
    if (typeof FBXSupport === 'undefined' || !FBXSupport.clearHero) return Promise.resolve();
    return FBXSupport.clearHero().then(() => {
      this.restore();
      if (typeof UI !== 'undefined') UI.toast('Đã về chibi mặc định!', 'gold');
    }).catch(e => {
      if (typeof UI !== 'undefined') UI.toast((e && e.message) ? e.message : 'Không xóa được mô hình .fbx.', 'red');
      throw e;
    });
  }
};

/* ============================== ĐẠO CỤ / NPC .FBX TRONG THÀNH ============================== */
const FbxProps = {
  MAX_SCALE: 3,
  MIN_SCALE: 0.5,
  ROT_STEP: Math.PI / 4, /* xoay 45° mỗi lần bấm */
  _live: {}, /* id -> { prop, wrap, el } */

  /* Scale người chơi chỉnh, kẹp 0.5–3, làm tròn 2 chữ số (tránh 1.2000000001). */
  clampScale(v) {
    const n = Number(v);
    if (!isFinite(n)) return 1;
    return Math.round(Math.min(this.MAX_SCALE, Math.max(this.MIN_SCALE, n)) * 100) / 100;
  },

  /* Bọc group đã parse vào 1 wrapper: wrapper giữ x/z/rotY/scale của registry,
     group con giữ nguyên tỉ lệ chuẩn hóa (cao 1.8) của parseArrayBuffer. */
  _makeWrap(prop, parsed) {
    const wrap = new THREE.Group();
    wrap.position.set(prop.x || 0, 0, prop.z || 0);
    wrap.rotation.y = prop.rotY || 0;
    wrap.scale.setScalar(this.clampScale(prop.scale || 1));
    wrap.add(parsed.group);
    return wrap;
  },

  /* Bảng tên cho prop NPC (như nameplate NPC thường). */
  _makeNameplate(prop) {
    let host = null;
    try { host = document.getElementById('nameplates'); } catch (e) { host = null; }
    if (!host || !document.createElement) return null;
    const el = document.createElement('div');
    el.className = 'nameplate npc';
    el.innerHTML = '<span>' + esc(prop.npcName || prop.name || 'Mô hình FBX') + '</span>';
    host.appendChild(el);
    return el;
  },

  /* Nạp + đặt 1 prop trong registry lên scene (lỗi thì throw để nơi gọi xử lý). */
  spawn(prop) {
    if (!prop || !prop.id || typeof FBXSupport === 'undefined') return Promise.reject(new Error('Thiếu thông tin mô hình.'));
    if (this._live[prop.id]) this.removeFromScene(prop.id);
    return FBXSupport.loadPropModel(prop).then(parsed => {
      if (!parsed || !parsed.group) throw new Error('Không đọc được file .fbx của "' + (prop.name || prop.id) + '".');
      const wrap = this._makeWrap(prop, parsed);
      if (typeof Engine !== 'undefined' && Engine.scene) Engine.scene.add(wrap);
      const el = (prop.type === 'npc') ? this._makeNameplate(prop) : null;
      this._live[prop.id] = { prop, wrap, el };
      return this._live[prop.id];
    });
  },

  /* Gỡ khỏi scene + bảng tên (không đụng registry/IndexedDB). */
  removeFromScene(id) {
    const live = this._live[id];
    if (!live) return;
    try { if (typeof Engine !== 'undefined' && Engine.scene && live.wrap) Engine.scene.remove(live.wrap); } catch (e) {}
    try { if (live.el && live.el.remove) live.el.remove(); } catch (e) {}
    delete this._live[id];
  },

  /* Xóa hẳn 1 prop: gỡ khỏi scene + xóa file/registry (FBXSupport.removeProp). */
  remove(id) {
    this.removeFromScene(id);
    if (typeof FBXSupport === 'undefined' || !FBXSupport.removeProp) return Promise.resolve();
    return FBXSupport.removeProp(id).catch(e => {
      if (typeof UI !== 'undefined') UI.toast((e && e.message) ? e.message : 'Không xóa được mô hình.', 'red');
      throw e;
    });
  },

  /* Xoay prop +45° (ghi registry + lưu save ngay). */
  rotate(id) {
    const live = this._live[id];
    const prop = live ? live.prop
      : (typeof FBXSupport !== 'undefined' ? FBXSupport.listProps().find(p => p && p.id === id) : null);
    if (!prop) return false;
    prop.rotY = ((Number(prop.rotY) || 0) + this.ROT_STEP) % (Math.PI * 2);
    if (live && live.wrap) live.wrap.rotation.y = prop.rotY;
    SaveManager.save();
    return true;
  },

  /* To/nhỏ prop: dir > 0 nhân 1.2, dir < 0 chia 1.2, kẹp 0.5–3.
     Trả { scale, atLimit } (atLimit true khi đã chạm giới hạn). */
  scaleBy(id, dir) {
    const live = this._live[id];
    const prop = live ? live.prop
      : (typeof FBXSupport !== 'undefined' ? FBXSupport.listProps().find(p => p && p.id === id) : null);
    if (!prop) return null;
    const next = this.clampScale((Number(prop.scale) || 1) * (dir > 0 ? 1.2 : 1 / 1.2));
    const atLimit = (dir > 0 && next >= this.MAX_SCALE) || (dir < 0 && next <= this.MIN_SCALE);
    prop.scale = next;
    if (live && live.wrap) live.wrap.scale.setScalar(next);
    SaveManager.save();
    return { scale: next, atLimit };
  },

  /* Nạp tất cả prop đã đặt khi vào thế giới: lỗi từng cái thì bỏ qua,
     cuối cùng toast 1 lần (không chặn game, không xóa gì của người chơi). */
  restoreAll() {
    if (typeof FBXSupport === 'undefined' || !FBXSupport.listProps) return;
    const props = FBXSupport.listProps();
    if (!props.length) return;
    let failed = 0;
    const jobs = props.map(prop => this.spawn(prop).catch(() => { failed++; return null; }));
    Promise.all(jobs).then(() => {
      if (failed > 0 && typeof UI !== 'undefined') UI.toast('Không nạp được ' + failed + '/' + props.length + ' mô hình .fbx đã đặt (file có thể đã bị xóa khỏi máy) — các mô hình còn lại vẫn hiện, xóa cái lỗi trong mục Thợ Dựng Cảnh rồi đặt lại nhé!', 'red');
    });
  },

  /* Cập nhật bảng tên của prop NPC (chiếu 3D -> màn hình, như NpcAI.updatePet).
     Gọi trong World.update, sau CharacterManager.update. */
  update() {
    if (typeof Engine === 'undefined' || !Engine.camera || typeof window === 'undefined' || !window.innerWidth) return;
    if (typeof THREE === 'undefined' || !THREE.Vector3) return;
    const w = window.innerWidth, h = window.innerHeight;
    const v = new THREE.Vector3();
    Object.keys(this._live).forEach(id => {
      const live = this._live[id];
      if (!live.el || !live.wrap) return;
      v.set(live.wrap.position.x, live.wrap.position.y + 1.95, live.wrap.position.z);
      v.project(Engine.camera);
      const sx = (v.x * .5 + .5) * w, sy = (-v.y * .5 + .5) * h;
      if (v.z < 1 && sx > -90 && sx < w + 90 && sy > -60 && sy < h + 60) {
        live.el.style.display = 'flex';
        live.el.style.left = sx + 'px';
        live.el.style.top = sy + 'px';
      } else {
        live.el.style.display = 'none';
      }
    });
  }
};

/* ============================== FILE PICKER + MODAL THỢ DỰNG CẢNH ============================== */
const FbxUI = {
  _input: null,        /* <input type=file> ẩn, tái dùng cho mọi lần chọn */
  _busy: false,        /* đang đọc + parse file hero (khóa nút nhập) */
  _pendingFile: null,  /* File .fbx đang chờ chọn loại/đặt (phạm vi 2) */
  _placeType: 'decor', /* 'decor' | 'npc' */
  _placeName: '',      /* tên mặc định cho NPC = tên file bỏ đuôi .fbx */

  /* Mở file picker .fbx (chạy trên Android); onFile nhận File đã chọn.
     Bấm hủy thì không làm gì. */
  pickFile(onFile) {
    try {
      if (!this._input) {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.fbx';
        inp.style.display = 'none';
        document.body.appendChild(inp);
        this._input = inp;
      }
      const inp = this._input;
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        inp.value = '';
        if (f && typeof onFile === 'function') onFile(f);
      };
      inp.click();
    } catch (e) {
      if (typeof UI !== 'undefined') UI.toast('Không mở được trình chọn file trên thiết bị này.', 'red');
    }
  },

  /* Đọc File thành ArrayBuffer (arrayBuffer() có trên Chrome Android mới,
     FileReader là đường lui cho máy cũ). */
  _readBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('Không đọc được file .fbx từ máy.'));
      r.onload = () => resolve(r.result);
      try { r.readAsArrayBuffer(file); } catch (e) { reject(new Error('Không đọc được file .fbx từ máy.')); }
    });
  },

  /* Trạng thái loading cho nút nhập hero (Hồ sơ + Cài đặt): disable + chữ
     "⏳ Đang đọc file…" (khôi phục nhãn cũ khi xong). */
  setHeroBusy(busy) {
    this._busy = busy;
    try {
      const pickBtns = document.querySelectorAll ? document.querySelectorAll('[data-act="fbx-hero-pick"]') : [];
      pickBtns.forEach(b => {
        b.disabled = busy;
        if (busy) { b.dataset._label = b.textContent; b.textContent = '⏳ Đang đọc file…'; }
        else if (b.dataset._label) b.textContent = b.dataset._label;
      });
      const clearBtn = document.getElementById('ii-fbx-clear');
      if (clearBtn) clearBtn.disabled = busy;
    } catch (e) {}
  },

  /* Luồng nhập hero: validate -> đọc + parse TRƯỚC (lỗi thì dừng, không lưu
     gì) -> lưu file -> gắn vào nhân vật. */
  importHeroFile(file) {
    if (this._busy) { UI.toast('Đang đọc file .fbx, đợi một lát nhé!', 'gold'); return; }
    const v = FBXSupport.validateFile(file);
    if (!v.ok) { UI.toast(v.reason, 'red'); return; }
    this.setHeroBusy(true);
    const done = () => {
      this.setHeroBusy(false);
      if (typeof Info !== 'undefined' && Info.syncFbxHero) Info.syncFbxHero();
      this.refreshSettingsModal();
    };
    this._readBuffer(file).then(buf => {
      const parsed = FBXSupport.parseArrayBuffer(buf);
      return FBXSupport.saveHeroFile(file).then(() => parsed);
    }).then(parsed => {
      const applied = HeroFBX.apply(parsed);
      UI.toast(applied
        ? 'Đã đổi nhân vật thành mô hình "' + file.name + '"! (chỉ trong thế giới — trong trận vẫn dùng chibi)'
        : 'Đã lưu mô hình "' + file.name + '" — mô hình sẽ hiện khi vào thế giới!', 'green');
      done();
    }).catch(e => {
      UI.toast((e && e.message) ? e.message : 'Không nhập được file .fbx.', 'red');
      done();
    });
  },

  /* Mở lại modal Cài đặt để cập nhật tên file hero (chỉ khi đang mở). */
  refreshSettingsModal() {
    try {
      const t = document.getElementById('modal-title');
      const m = document.getElementById('modal');
      if (m && m.classList.contains('on') && t && t.textContent === 'Cài đặt hệ thống') UI.openModal('settings');
    } catch (e) {}
  },

  /* Mở modal Thợ Dựng Cảnh (đóng hộp thoại NPC trước để modal không bị che). */
  openBuilder() {
    try { const d = document.getElementById('dialogue'); if (d) d.classList.remove('on'); } catch (e) {}
    if (typeof UI !== 'undefined') UI.openModal('fbx-builder');
  },

  /* Bắt đầu đặt mô hình: đủ 5 thì chặn ngay; chưa đủ thì mở file picker. */
  startPlace() {
    const count = FBXSupport.listProps().length;
    if (count >= FBXSupport.MAX_PROPS) {
      UI.toast('Đã đủ tối đa ' + FBXSupport.MAX_PROPS + ' mô hình .fbx, xóa bớt một cái rồi thử lại!', 'red');
      return;
    }
    this.pickFile(file => {
      const v = FBXSupport.validateFile(file);
      if (!v.ok) { UI.toast(v.reason, 'red'); return; }
      this._pendingFile = file;
      this._placeType = 'decor';
      this._placeName = file.name.replace(/\.fbx$/i, '');
      UI.openModal('fbx-place-form', { fileName: file.name, fileSize: file.size, placeType: this._placeType, placeName: this._placeName });
    });
  },

  /* Đổi loại đặt trong form (đổi nút sáng + ẩn/hiện ô nhập tên NPC).
     Không render lại modal để khỏi mất tên đang gõ. */
  setPlaceType(type) {
    if (type !== 'decor' && type !== 'npc') return;
    this._placeType = type;
    try {
      const row = document.getElementById('fbx-npc-name-row');
      if (row) row.classList.toggle('hidden', type !== 'npc');
      const btns = document.querySelectorAll ? document.querySelectorAll('[data-act="fbx-place-type"]') : [];
      btns.forEach(b => b.classList.toggle('on', b.dataset.type === type));
    } catch (e) {}
  },

  /* Đặt mô hình tại chỗ nhân vật đang đứng: PHẢI đi được (isWalkable),
     không đi được thì toast lỗi và không lưu gì. */
  confirmPlace() {
    const file = this._pendingFile;
    if (!file) { UI.toast('Chưa chọn file .fbx nào.', 'red'); return; }
    const ent = (typeof PlayerController !== 'undefined') ? PlayerController.entity : null;
    if (!ent || !ent.mesh) { UI.toast('Chưa vào thế giới, không đặt được mô hình.', 'red'); return; }
    const x = ent.mesh.position.x, z = ent.mesh.position.z;
    if (typeof Engine === 'undefined' || !Engine.isWalkable || !Engine.isWalkable(x, z)) {
      UI.toast('Chỗ này không đặt được, hãy đứng chỗ khác!', 'red');
      return;
    }
    let npcName = '';
    if (this._placeType === 'npc') {
      try {
        const inp = document.getElementById('fbx-npc-name');
        npcName = inp && inp.value ? inp.value.trim() : '';
      } catch (e) {}
      if (!npcName) npcName = this._placeName || file.name.replace(/\.fbx$/i, '');
    }
    const type = this._placeType;
    const pending = file;
    this._pendingFile = null;
    FBXSupport.savePropFile(pending, { type, npcName, x, z, rotY: 0, scale: 1 }).then(prop => {
      return FbxProps.spawn(prop).then(() => prop);
    }).then(prop => {
      UI.toast(type === 'npc'
        ? 'Đã dựng NPC "' + (prop.npcName || prop.name) + '" trong thành!'
        : 'Đã đặt mô hình "' + prop.name + '" trong thành!', 'green');
      this.openBuilder();
    }).catch(e => {
      UI.toast((e && e.message) ? e.message : 'Không đặt được mô hình .fbx.', 'red');
    });
  }
};
