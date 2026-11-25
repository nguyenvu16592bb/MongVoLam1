/* ============================== FBX (BƯỚC 1: NỀN TẢNG) ==============================
   FBXSupport — nạp file .fbx do người chơi tải lên (nhân vật hero + tối đa
   5 đạo cụ/NPC), lưu bytes gốc vào IndexedDB, parse bằng THREE.FBXLoader
   (three.js r128, cần fflate trước nó) rồi chuẩn hóa kích thước về chiều
   cao 1.8 (đơn vị thế giới), căn giữa x/z, đáy y = 0.
   Chỉ là nền tảng: KHÔNG có UI ở đây, các bước sau gọi đúng API này.
   Mọi lỗi đều throw Error message tiếng Việt; tầng gọi bọc try/catch. */

const FBX_DB_NAME = 'mongvolam_fbx_v1';
const FBX_STORE_NAME = 'files';

/* Đảm bảo nhánh flags.fbx luôn tồn tại (save cũ chưa có -> mặc định). */
function fbxFlags() {
  if (!State.flags || typeof State.flags !== 'object') State.flags = {};
  if (!State.flags.fbx || typeof State.flags.fbx !== 'object') State.flags.fbx = { hero: null, props: [] };
  if (!Array.isArray(State.flags.fbx.props)) State.flags.fbx.props = [];
  return State.flags.fbx;
}

/* Mở (hoặc tạo) IndexedDB mongvolam_fbx_v1 / store files (keyPath 'key'). */
function fbxOpenDb() {
  return new Promise((resolve, reject) => {
    let idb = null;
    try {
      idb = (typeof window !== 'undefined' && window.indexedDB) ? window.indexedDB : null;
    } catch (e) { idb = null; }
    if (!idb) {
      reject(new Error('Trình duyệt này không lưu được file .fbx (không dùng được IndexedDB, có thể đang ở chế độ riêng tư).'));
      return;
    }
    let req;
    try {
      req = idb.open(FBX_DB_NAME, 1);
    } catch (e) {
      reject(new Error('Không mở được bộ nhớ lưu file .fbx (IndexedDB): ' + (e && e.message ? e.message : 'lỗi không rõ') + '.'));
      return;
    }
    req.onupgradeneeded = function () {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(FBX_STORE_NAME)) db.createObjectStore(FBX_STORE_NAME, { keyPath: 'key' });
      } catch (e) {}
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(new Error('Không mở được bộ nhớ lưu file .fbx (IndexedDB).')); };
    req.onblocked = function () { reject(new Error('Bộ nhớ lưu file .fbx đang bị chặn, thử đóng tab game khác rồi thử lại.')); };
  });
}

/* Ghi file vào IndexedDB: record {key, name, size, addedAt, data(ArrayBuffer)}. */
function idbPut(key, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error('Không đọc được file .fbx từ máy.')); };
    reader.onload = function () {
      fbxOpenDb().then(function (db) {
        let tx;
        try {
          tx = db.transaction(FBX_STORE_NAME, 'readwrite');
        } catch (e) {
          try { db.close(); } catch (e2) {}
          reject(new Error('Không lưu được file .fbx (IndexedDB).'));
          return;
        }
        const rec = { key: key, name: file.name, size: file.size, addedAt: Date.now(), data: reader.result };
        let done = false;
        tx.oncomplete = function () { try { db.close(); } catch (e) {} if (!done) { done = true; resolve(rec); } };
        tx.onerror = function () { try { db.close(); } catch (e) {} if (!done) { done = true; reject(new Error('Không lưu được file .fbx vào máy.')); } };
        try {
          tx.objectStore(FBX_STORE_NAME).put(rec);
        } catch (e) {
          try { db.close(); } catch (e2) {}
          if (!done) { done = true; reject(new Error('Không lưu được file .fbx vào máy.')); }
        }
      }).catch(reject);
    };
    try {
      reader.readAsArrayBuffer(file);
    } catch (e) {
      reject(new Error('Không đọc được file .fbx từ máy.'));
    }
  });
}

/* Đọc record theo key; chưa có -> null. */
function idbGet(key) {
  return fbxOpenDb().then(function (db) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(FBX_STORE_NAME, 'readonly');
      } catch (e) {
        try { db.close(); } catch (e2) {}
        reject(new Error('Không đọc được file .fbx đã lưu (IndexedDB).'));
        return;
      }
      let req;
      try {
        req = tx.objectStore(FBX_STORE_NAME).get(key);
      } catch (e) {
        try { db.close(); } catch (e2) {}
        reject(new Error('Không đọc được file .fbx đã lưu (IndexedDB).'));
        return;
      }
      req.onsuccess = function () { try { db.close(); } catch (e) {} resolve(req.result || null); };
      req.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không đọc được file .fbx đã lưu.')); };
    });
  });
}

/* Xóa record theo key; key chưa có cũng không lỗi. */
function idbDel(key) {
  return fbxOpenDb().then(function (db) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(FBX_STORE_NAME, 'readwrite');
      } catch (e) {
        try { db.close(); } catch (e2) {}
        reject(new Error('Không xóa được file .fbx đã lưu (IndexedDB).'));
        return;
      }
      tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(); };
      tx.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không xóa được file .fbx đã lưu.')); };
      try {
        tx.objectStore(FBX_STORE_NAME).delete(key);
      } catch (e) {
        try { db.close(); } catch (e2) {}
        reject(new Error('Không xóa được file .fbx đã lưu.'));
      }
    });
  });
}

const FBXSupport = {
  MAX_BYTES: 20 * 1024 * 1024,
  MAX_PROPS: 5,

  /* Kiểm tra file trước khi lưu: đuôi .fbx (không phân biệt hoa/thường),
     dung lượng 1..MAX_BYTES. Không throw — trả {ok, reason}. */
  validateFile: function (file) {
    if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name) {
      return { ok: false, reason: 'Chưa chọn file nào.' };
    }
    if (!/\.fbx$/i.test(file.name)) {
      return { ok: false, reason: 'File "' + file.name + '" không phải định dạng .fbx.' };
    }
    const size = Number(file.size);
    if (!size || size < 1) {
      return { ok: false, reason: 'File .fbx rỗng, không đọc được.' };
    }
    if (size > FBXSupport.MAX_BYTES) {
      return { ok: false, reason: 'File .fbx quá lớn (' + (size / 1048576).toFixed(1) + ' MB, tối đa 20 MB).' };
    }
    return { ok: true };
  },

  /* Parse ArrayBuffer thành {group, animations}; chuẩn hóa: chiều cao = 1.8,
     căn giữa x/z về 0, đáy y = 0. Parse lỗi -> throw Error tiếng Việt. */
  parseArrayBuffer: function (ab) {
    /* Nhận ArrayBuffer (mọi realm — kiểm tra theo hình dạng, không dùng
       instanceof vì buffer từ IndexedDB/worker có thể khác realm) hoặc
       TypedArray/DataView (cắt đúng đoạn buffer của nó). */
    let buf = null;
    if (ab && typeof ab === 'object') {
      if (typeof ab.byteLength === 'number' && typeof ab.slice === 'function' && !ab.buffer) {
        buf = ab; /* ArrayBuffer */
      } else if (ab.buffer && typeof ab.byteLength === 'number' && typeof ab.byteOffset === 'number' && typeof ab.buffer.slice === 'function') {
        buf = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
      }
    }
    if (!buf) {
      throw new Error('Dữ liệu file .fbx không hợp lệ.');
    }
    if (typeof THREE === 'undefined' || !THREE.FBXLoader) {
      throw new Error('Chưa tải được bộ đọc .fbx, thử tải lại trang.');
    }
    let group;
    try {
      group = new THREE.FBXLoader().parse(buf, '');
    } catch (e) {
      throw new Error('Không đọc được file .fbx này (' + (e && e.message ? e.message : 'định dạng không hỗ trợ') + ').');
    }
    if (!group) throw new Error('Không đọc được file .fbx này (file rỗng).');
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    if (!isFinite(size.y) || size.y <= 0) {
      throw new Error('File .fbx không có hình dạng nào để hiển thị.');
    }
    const s = 1.8 / size.y;
    group.scale.setScalar(s);
    group.position.x -= center.x * s;
    group.position.z -= center.z * s;
    group.position.y -= box.min.y * s;
    group.updateMatrixWorld(true);
    return { group: group, animations: group.animations || [] };
  },

  /* Lưu file .fbx làm nhân vật hero (ghi đè file cũ nếu có). */
  saveHeroFile: function (file) {
    const v = FBXSupport.validateFile(file);
    if (!v.ok) return Promise.reject(new Error(v.reason));
    return idbPut('hero', file).then(function (rec) {
      fbxFlags().hero = { key: 'hero', name: rec.name, size: rec.size, addedAt: rec.addedAt };
      SaveManager.save();
      return { name: rec.name, size: rec.size };
    });
  },

  /* Tải model hero đã lưu; chưa lưu -> null; mất file trong IDB -> throw
     (KHÔNG tự xóa flag — để bước UI báo cho người chơi tải lại). */
  loadHeroModel: function () {
    if (!fbxFlags().hero) return Promise.resolve(null);
    return idbGet('hero').then(function (rec) {
      if (!rec || !rec.data) {
        throw new Error('Không tìm thấy file .fbx nhân vật đã lưu, thử tải file lên lại.');
      }
      return FBXSupport.parseArrayBuffer(rec.data);
    });
  },

  /* Xóa file hero khỏi IndexedDB + xóa flag + lưu save. */
  clearHero: function () {
    return idbDel('hero').then(function () {
      fbxFlags().hero = null;
      SaveManager.save();
    });
  },

  /* Lưu file .fbx làm đạo cụ/NPC: type 'decor' | 'npc'. Tối đa MAX_PROPS cái.
     Không kiểm tra isWalkable ở đây (bước UI làm). */
  savePropFile: function (file, opts) {
    const v = FBXSupport.validateFile(file);
    if (!v.ok) return Promise.reject(new Error(v.reason));
    opts = opts || {};
    if (opts.type !== 'decor' && opts.type !== 'npc') {
      return Promise.reject(new Error('Loại đạo cụ phải là "decor" (trang trí) hoặc "npc".'));
    }
    const f = fbxFlags();
    if (f.props.length >= FBXSupport.MAX_PROPS) {
      return Promise.reject(new Error('Đã đủ tối đa ' + FBXSupport.MAX_PROPS + ' đạo cụ/NPC .fbx, xóa bớt một cái rồi thử lại.'));
    }
    const id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const key = 'prop:' + id;
    return idbPut(key, file).then(function (rec) {
      const prop = {
        id: id, key: key, name: rec.name, size: rec.size,
        type: opts.type, npcName: typeof opts.npcName === 'string' ? opts.npcName : '',
        x: Number(opts.x) || 0, z: Number(opts.z) || 0,
        rotY: Number(opts.rotY) || 0, scale: Number(opts.scale) || 1
      };
      f.props.push(prop);
      SaveManager.save();
      return prop;
    });
  },

  /* Tải model của một prop trong registry; mất file trong IDB -> throw. */
  loadPropModel: function (prop) {
    if (!prop || !prop.key) return Promise.resolve(null);
    return idbGet(prop.key).then(function (rec) {
      if (!rec || !rec.data) {
        throw new Error('Không tìm thấy file .fbx của "' + (prop.name || prop.id || 'đạo cụ') + '" đã lưu, thử tải file lên lại.');
      }
      return FBXSupport.parseArrayBuffer(rec.data);
    });
  },

  /* Xóa một prop: xóa IDB + gỡ khỏi registry + lưu save.
     Id không tồn tại thì không lỗi. */
  removeProp: function (id) {
    const f = fbxFlags();
    const idx = f.props.findIndex(function (p) { return p && p.id === id; });
    if (idx < 0) return Promise.resolve();
    const prop = f.props[idx];
    return idbDel(prop.key).catch(function () {}).then(function () {
      const i2 = f.props.findIndex(function (p) { return p && p.id === id; });
      if (i2 >= 0) f.props.splice(i2, 1);
      SaveManager.save();
    });
  },

  /* Danh sách prop đã đăng ký (mảng, không null). */
  listProps: function () {
    return fbxFlags().props;
  }
};

if (typeof window !== 'undefined') window.FBXSupport = FBXSupport;
