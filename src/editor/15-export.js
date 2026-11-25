/* ============================================================================
   Map Editor — 15-export.js (đợt 2 + đợt 3 + đợt 4)
   ED.Export — xuất scene thành file .GLB thật (THREE.GLTFExporter r128,
   vendored lib/GLTFExporter.js) + nhạc nền ambient (mp3/wav/ogg ≤ 10 MB,
   lưu IndexedDB store 'assets', key 'audio:ambient', phát bằng
   HTMLAudioElement loop).
   ED.Audio — SFX tổng hợp bằng WebAudio thật (oscillator/noise, không cần
   file âm thanh ngoài) + hook tự động vào sự kiện Play (bọc ED.Play).
   Đợt 3 (chỉ sửa file này):
   (a) Chụp ảnh PNG đúng khung viewport (render 1 frame đồng bộ rồi
       toDataURL ngay trong cùng task — renderer KHÔNG preserveDrawingBuffer).
   (b) Export .gltf JSON + file .bin riêng (GLTFExporter binary:false;
       buffer data URI tách ra thành .bin, JSON trỏ đúng tên .bin).
   (c) SFX WebAudio: skill/hit/hurt/die/pickup; tham số tổng hợp là hàm
       thuần (edAudioSynthParams) để test bằng vm.
   (d) Playlist nhạc nền nhiều track (thêm/xoá, next/prev, tự chuyển bài),
       âm lượng + mute lưu localStorage key 'mongvolam_editor_audio_v1'.
       Track nhạc cũ 'audio:ambient' được migrate thành track đầu playlist.
   Đợt 4 (chỉ sửa file này + vendor lib/jszip.min.js):
   (e) Xuất project .ZIP thật bằng JSZip (lib/jszip.min.js vendored, UMD):
       project.json + mapeditor.html + toàn bộ src/editor/*.js + editor.css
       + editor.template.html + DESIGN.md + lib/*.js + README.md, lấy qua
       fetch cùng origin; file nào fetch lỗi thì bỏ qua + ghi THIEU_FILE.txt
       trong ZIP. Hàm thuần buildZipFileList/collectZipEntries để test bằng vm.
       KHÔNG có nút Publish.
   (f) SFX theo vị trí 3D: playPositionalSfx(name, sourcePos, cameraState)
       — gain theo khoảng cách (pannerGainFor) + pan trái/phải theo hướng
       (panFor) qua StereoPannerNode (fallback PannerNode, rồi phát thường);
       hook Play đợt 3 nay phát SFX tại vị trí quái/hero thay vì phát đều.
   (g) Nhạc theo ngữ cảnh: 2 chế độ explore/combat — vào combat (quái gần
       hoặc hero vừa đánh/trúng đòn) thì chuyển sang track combat, hết combat
       5 giây thì về track explore, fade âm lượng 1.5 giây (không cắt đột
       ngột). Playlist + volume/mute đợt 3 giữ nguyên (cùng key localStorage,
       thêm 3 field: contextMusic, exploreTrackId, combatTrackId).
       API cho coordinator nối vào 09-play.js: ED.Export.setCombatMode(bool),
       ED.Export.playPositionalSfx(name, sourcePos, cameraState).
   Quy tắc DESIGN.md: KHÔNG truy cập document/window/THREE ở top-level;
   mọi khởi tạo trong init(). Logic thuần viết thành hàm edExport* / edAudio*
   để test Node bằng vm.
   KHÔNG sửa 02-ui.js / 09-play.js / 99-boot.js / build-editor.mjs: panel
   của module tự tạo (gắn vào #panel-right nếu có, fallback append body);
   Play Mode chỉ gọi API ED.Export.playAmbient()/stopAmbient() khi tích hợp.
   Giới hạn export: chỉ mesh + transform + material cơ bản (MeshStandard/
   Lambert màu, roughness, metalness, opacity; texture kèm theo khả năng
   của exporter). Không export: gizmo, lưới GridHelper, trục AxesHelper,
   đèn của editor, Points/Lines (FX hạt), animation, camera.
   Giới hạn đợt 3: ảnh PNG là đúng khung viewport đang thấy (kể cả
   lưới/gizmo nếu đang hiện); SFX hook vào Play bằng cách bọc hàm ED.Play
   (không sửa 09-play.js).
   Giới hạn đợt 4: nút Xuất project .ZIP chỉ hiện khi bản build đã inline
   lib/jszip.min.js (coordinator thêm placeholder __JSZIP__ vào
   editor.template.html + build-editor.mjs); chưa inline thì chỉ hiện hint
   cảnh báo, KHÔNG vẽ nút giả. ZIP lấy file qua fetch cùng origin nên chỉ
   chạy khi mở editor qua HTTP (GitHub Pages / server), không chạy file://.
   Nhạc combat cần ít nhất 2 track trong playlist mới đổi bài được (1 bài
   thì vẫn phát bài đó, chỉ đổi chế độ hiển thị); track combat/explore do
   người dùng chọn trong panel, chưa chọn thì combat dùng bài kế tiếp.
   ========================================================================== */
var ED = (typeof ED !== 'undefined') ? ED : {};

ED.Export = (function () {
  'use strict';

  var DB_NAME = 'mongvolam_editor_v1';
  var STORE = 'assets';
  var AUDIO_ID = 'ambient';
  var AUDIO_KEY = 'audio:' + AUDIO_ID;
  var MAX_AUDIO_BYTES = 10 * 1024 * 1024;
  var AUDIO_EXTS = ['mp3', 'wav', 'ogg'];
  /* Đợt 3: settings audio (âm lượng/mute/playlist) lưu localStorage. */
  var AUDIO_SETTINGS_KEY = 'mongvolam_editor_audio_v1';
  var TRACK_KEY_PREFIX = 'audio:track:';
  var SFX_KINDS = ['skill', 'hit', 'hurt', 'die', 'pickup'];

  var _panel = null;
  var _audioEl = null;      // HTMLAudioElement, tạo lười trong hàm
  var _audioUrl = null;     // blob URL hiện tại (revoke khi đổi/xoá)
  var _audioKey = null;     // 'audio:ambient' khi đã có nhạc, null nếu chưa
  var _audioName = '';
  var _volume = 0.5;
  var _exporting = false;
  /* Đợt 3: playlist + SFX + hook Play. */
  var _tracks = [];         // [{id, key, name, ext, size}] — meta, data ở IDB
  var _trackIndex = 0;
  var _audioTrackId = null; // id track đang nạp source vào _audioEl
  var _muted = false;
  var _trackCounter = 0;
  var _audioCtx = null;     // AudioContext cho SFX (tạo lười)
  var _sfxGain = null;      // GainNode master của SFX
  var _noiseBuf = null;     // buffer noise trắng 1s, tạo lười
  var _playHooked = false;
  var _playOriginals = {};  // tên hàm ED.Play gốc đã bọc
  /* Đợt 4: xuất project ZIP + nhạc theo ngữ cảnh + SFX vị trí 3D. */
  var _zipExporting = false;
  var _musicMode = 'explore';   // 'explore' | 'combat'
  var _contextMusic = true;     // toggle nhạc theo ngữ cảnh (mặc định bật)
  var _exploreTrackId = null;   // id track nhạc khám phá (null = chưa chọn)
  var _combatTrackId = null;    // id track nhạc chiến đấu (null = chưa chọn)
  var _exploreTrackIndex = 0;   // index track đang phát lúc vào combat (để quay về)
  var _lastCombatAt = 0;        // ms (Date.now) lần cuối có hoạt động combat
  var _fadeTimer = null;        // id setInterval của lần fade đang chạy
  var COMBAT_GRACE_MS = 5000;   // hết combat: chờ 5s không đánh/trúng đòn mới về explore
  var FADE_MS = 1500;           // fade chuyển bài: 1.5 giây
  var FADE_STEP_MS = 50;        // bước fade: mỗi 50ms
  var SFX_MAX_DISTANCE = 30;    // SFX xa hơn 30 ô thì gain = 0 (không phát)

  /* Đợt 4 — danh sách file CỐ ĐỊNH gom vào project ZIP (đường dẫn tương
     đối từ gốc repo, fetch cùng origin). Ngoài project.json (tạo từ
     project hiện tại) thì ZIP gồm: file build hiện tại + toàn bộ
     src/editor/*.js (19 module theo ORDERED trong tools/build-editor.mjs)
     + editor.css + editor.template.html + DESIGN.md + lib/*.js
     (three, fflate, loaders, exporter, reflector, jszip) + README.md. */
  var ZIP_FETCH_FILES = [
    'mapeditor.html',
    'src/editor/00-core.js', 'src/editor/01-viewport.js', 'src/editor/02-ui.js',
    'src/editor/03-assets.js', 'src/editor/14-building.js', 'src/editor/04-terrain.js',
    'src/editor/05-environment.js', 'src/editor/06-fx.js', 'src/editor/07-character.js',
    'src/editor/11-animation.js', 'src/editor/08-npc-ai.js', 'src/editor/16-nodes.js',
    'src/editor/17-physics.js', 'src/editor/09-play.js', 'src/editor/10-game-link.js',
    'src/editor/12-nav.js', 'src/editor/13-material.js', 'src/editor/15-export.js',
    'src/editor/99-boot.js',
    'src/editor/editor.css', 'src/editor/editor.template.html', 'src/editor/DESIGN.md',
    'lib/three.min.js', 'lib/fflate.min.js', 'lib/FBXLoader.js', 'lib/GLTFLoader.js',
    'lib/OBJLoader.js', 'lib/GLTFExporter.js', 'lib/Reflector.js', 'lib/jszip.min.js',
    'README.md'
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ---- Logic thuần: validate GLB. ----
     buf: ArrayBuffer | Uint8Array | Buffer | Array<number>.
     GLB: 12 byte header — magic 'glTF' (0x46546C67, little-endian),
     version == 2, length == độ dài file thật. */
  function edExportValidateGLB(buf) {
    var bytes = null;
    try {
      if (!buf) bytes = null;
      else if (typeof Uint8Array !== 'undefined' && buf instanceof Uint8Array) bytes = buf;
      else if (buf instanceof ArrayBuffer) bytes = new Uint8Array(buf);
      else if (Array.isArray(buf)) bytes = Uint8Array.from(buf);
      else if (buf && typeof buf.byteLength === 'number' && buf.buffer instanceof ArrayBuffer) {
        bytes = new Uint8Array(buf.buffer, buf.byteOffset || 0, buf.byteLength);
      }
    } catch (e) { bytes = null; }
    if (!bytes || bytes.length < 12) {
      return { ok: false, version: 0, length: 0, reason: 'File quá ngắn (< 12 byte), không phải GLB.' };
    }
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var magic = dv.getUint32(0, true);
    if (magic !== 0x46546C67) {
      return { ok: false, version: 0, length: 0, reason: '4 byte đầu không phải "glTF".' };
    }
    var version = dv.getUint32(4, true);
    if (version !== 2) {
      return { ok: false, version: version, length: 0, reason: 'GLB version ' + version + ', cần version 2.' };
    }
    var length = dv.getUint32(8, true);
    if (length !== bytes.length) {
      return { ok: false, version: 2, length: length, reason: 'Độ dài trong header (' + length + ') khác độ dài file thật (' + bytes.length + ').' };
    }
    return { ok: true, version: 2, length: length, reason: '' };
  }

  /* Tên file .glb từ tên project: bỏ ký tự cấm trên Windows, fallback
     'map-editor'. Thuần. */
  function edExportFileName(projectName) {
    var n = String(projectName || '').trim().replace(/\.glb$/i, '');
    n = n.replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
    if (!n) n = 'map-editor';
    return n + '.glb';
  }

  /* Đợt 3 — tên gốc đã sanitize (bỏ đuôi file đã biết), dùng chung cho
     .gltf/.bin/.png và id track. Thuần. */
  function edExportBaseName(projectName) {
    var n = String(projectName || '').trim().replace(/\.(glb|gltf|bin|png|mp3|wav|ogg)$/i, '');
    n = n.replace(/[\/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
    if (!n) n = 'map-editor';
    return n;
  }
  function edExportBuildGltfName(projectName) { return edExportBaseName(projectName) + '.gltf'; }
  function edExportBuildGltfBinName(projectName) { return edExportBaseName(projectName) + '.bin'; }
  function edExportBuildPngName(projectName) { return edExportBaseName(projectName) + '.png'; }

  /* Đợt 3 — data URL có phải PNG thật không (PNG base64 luôn bắt đầu
     bằng 'iVBOR' = 8 byte signature PNG). Thuần. */
  function edExportIsPngDataUrl(s) {
    return typeof s === 'string' && s.indexOf('data:image/png;base64,iVBOR') === 0;
  }

  /* Đợt 3 — validate glTF JSON (object hoặc chuỗi JSON).
     binName: tên file .bin mà buffers[0].uri phải trỏ đúng.
     Trả {ok, version, bufferUri, reason}. glTF không có buffers (không
     có accessor nào) vẫn hợp lệ — khi đó không cần file .bin. */
  function edExportValidateGltf(json, binName) {
    var obj = null;
    try {
      obj = (typeof json === 'string') ? JSON.parse(json) : json;
    } catch (e) {
      return { ok: false, version: '', bufferUri: '', reason: 'JSON glTF parse lỗi.' };
    }
    if (!obj || typeof obj !== 'object') {
      return { ok: false, version: '', bufferUri: '', reason: 'Nội dung glTF không phải object.' };
    }
    if (!obj.asset || typeof obj.asset.version !== 'string' || !obj.asset.version) {
      return { ok: false, version: '', bufferUri: '', reason: 'Thiếu asset.version trong glTF.' };
    }
    if (!obj.buffers || !obj.buffers.length) {
      return { ok: true, version: obj.asset.version, bufferUri: '', reason: '' };
    }
    var b0 = obj.buffers[0];
    if (!b0 || typeof b0.uri !== 'string') {
      return { ok: false, version: obj.asset.version, bufferUri: '', reason: 'Thiếu buffers[0].uri trong glTF.' };
    }
    if (b0.uri !== binName) {
      return { ok: false, version: obj.asset.version, bufferUri: b0.uri, reason: 'buffers[0].uri ("' + b0.uri + '") không trỏ đúng file .bin ("' + binName + '").' };
    }
    if (typeof b0.byteLength !== 'number' || b0.byteLength < 0) {
      return { ok: false, version: obj.asset.version, bufferUri: b0.uri, reason: 'buffers[0].byteLength không hợp lệ.' };
    }
    return { ok: true, version: obj.asset.version, bufferUri: b0.uri, reason: '' };
  }

  /* Đợt 3 — tạo text JSON glTF với buffers[0].uri = binName (gọi SAU khi
     đã tách buffer data URI ra file .bin riêng). Nhận object hoặc chuỗi
     JSON; trả chuỗi JSON hoặc null khi parse lỗi. Thuần. */
  function edExportGltfJsonText(json, binName) {
    var obj = null;
    try {
      obj = (typeof json === 'string') ? JSON.parse(json) : json;
    } catch (e) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    if (obj.buffers && obj.buffers.length && obj.buffers[0] && typeof obj.buffers[0] === 'object') {
      obj.buffers[0].uri = binName;
    }
    try { return JSON.stringify(obj); } catch (e) { return null; }
  }

  /* Đợt 3 — giải mã data URI base64 thành {mime, bytes:Uint8Array}.
     Dùng atob khi có (trình duyệt), fallback Buffer (Node test).
     Không phải data URI base64 -> null. Thuần (trừ atob/Buffer có sẵn). */
  function edExportDataUriToBytes(dataUri) {
    if (typeof dataUri !== 'string' || dataUri.indexOf('data:') !== 0) return null;
    var comma = dataUri.indexOf(',');
    if (comma < 0) return null;
    var header = dataUri.slice(5, comma);
    if (header.indexOf(';base64') < 0) return null;
    var mime = header.split(';')[0] || 'application/octet-stream';
    var body = dataUri.slice(comma + 1);
    var binStr = null;
    try {
      if (typeof atob === 'function') binStr = atob(body);
      else if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        binStr = Buffer.from(body, 'base64').toString('binary');
      }
    } catch (e) { return null; }
    if (typeof binStr !== 'string') return null;
    var bytes = new Uint8Array(binStr.length);
    for (var i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i) & 0xff;
    return { mime: mime, bytes: bytes };
  }

  /* Validate file audio (chỉ xem {name, size}, không cần File thật). */
  function edExportValidateAudioFile(file) {
    if (!file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name) {
      return { ok: false, ext: '', reason: 'Chưa chọn file nào.' };
    }
    var ext = file.name.split('.').pop().toLowerCase();
    if (AUDIO_EXTS.indexOf(ext) < 0) {
      return { ok: false, ext: ext, reason: 'File "' + file.name + '" không phải .mp3 / .wav / .ogg.' };
    }
    var size = Number(file.size);
    if (!size || size < 1) return { ok: false, ext: ext, reason: 'File rỗng, không đọc được.' };
    if (size > MAX_AUDIO_BYTES) {
      return { ok: false, ext: ext, reason: 'File quá lớn (' + (size / 1048576).toFixed(1) + ' MB, tối đa 10 MB).' };
    }
    return { ok: true, ext: ext, reason: '' };
  }

  function edExportAudioKey(id) {
    id = String(id || '').trim();
    if (!id) return '';
    return 'audio:' + id;
  }
  function edExportParseAudioKey(key) {
    if (typeof key !== 'string') return null;
    if (key.indexOf('audio:') !== 0) return null;
    var id = key.slice('audio:'.length);
    return id ? id : null;
  }

  /* Đợt 3 — key IDB của 1 track playlist + parse ngược + tạo id track.
     id track cũ 'ambient' dùng đúng key legacy AUDIO_KEY ('audio:ambient'). */
  function edExportTrackKey(id) {
    id = String(id || '').trim();
    if (!id) return '';
    if (id === AUDIO_ID) return AUDIO_KEY;
    return TRACK_KEY_PREFIX + id;
  }
  function edExportParseTrackKey(key) {
    if (typeof key !== 'string') return null;
    if (key === AUDIO_KEY) return AUDIO_ID;
    if (key.indexOf(TRACK_KEY_PREFIX) !== 0) return null;
    var id = key.slice(TRACK_KEY_PREFIX.length);
    return id ? id : null;
  }
  function edExportMakeTrackId(name, n) {
    var b = edExportBaseName(name).replace(/[^A-Za-z0-9À-ỹ_\- ]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!b) b = 'track';
    var stamp = (n === undefined || n === null || n === '') ? '' : '-' + String(n);
    return b + stamp;
  }

  /* ---- Đợt 3 — SFX: tham số tổng hợp thuần (test được bằng vm). ----
     Mỗi loại: {kind, duration (giây, = node dài nhất), nodes:[...]}.
     node osc: {type:'osc', wave, freq, freqEnd (quét tần số, optional),
       dur, gain, delay}. node noise: {type:'noise', dur, gain, delay,
       filterFreq, filterFreqEnd} (bandpass quét theo thời gian).
     - skill: whoosh (noise quét 900->3200 Hz) + chuông sine 660->1320 Hz.
     - hit (chém): noise quét cao->thấp 2500->700 Hz + square 220->90 Hz.
     - hurt (trúng đòn, thud): sine trầm 160->55 Hz + noise trầm ngắn.
     - die (chết, xuống tông): sawtooth 300->48 Hz + sine 150->40 Hz, 0.8s.
     - pickup (ting 2 nốt): sine 880 Hz rồi 1318 Hz. */
  function edAudioSynthParams(kind) {
    switch (String(kind || '')) {
      case 'skill':
        return { kind: 'skill', duration: 0.45, nodes: [
          { type: 'noise', dur: 0.35, gain: 0.35, delay: 0, filterFreq: 900, filterFreqEnd: 3200 },
          { type: 'osc', wave: 'sine', freq: 660, freqEnd: 1320, dur: 0.4, gain: 0.3, delay: 0.05 }
        ] };
      case 'hit':
        return { kind: 'hit', duration: 0.22, nodes: [
          { type: 'noise', dur: 0.16, gain: 0.5, delay: 0, filterFreq: 2500, filterFreqEnd: 700 },
          { type: 'osc', wave: 'square', freq: 220, freqEnd: 90, dur: 0.15, gain: 0.25, delay: 0 }
        ] };
      case 'hurt':
        return { kind: 'hurt', duration: 0.28, nodes: [
          { type: 'osc', wave: 'sine', freq: 160, freqEnd: 55, dur: 0.25, gain: 0.6, delay: 0 },
          { type: 'noise', dur: 0.1, gain: 0.3, delay: 0, filterFreq: 400, filterFreqEnd: 150 }
        ] };
      case 'die':
        return { kind: 'die', duration: 0.85, nodes: [
          { type: 'osc', wave: 'sawtooth', freq: 300, freqEnd: 48, dur: 0.8, gain: 0.45, delay: 0 },
          { type: 'osc', wave: 'sine', freq: 150, freqEnd: 40, dur: 0.8, gain: 0.3, delay: 0.05 }
        ] };
      case 'pickup':
        return { kind: 'pickup', duration: 0.25, nodes: [
          { type: 'osc', wave: 'sine', freq: 880, dur: 0.08, gain: 0.4, delay: 0 },
          { type: 'osc', wave: 'sine', freq: 1318, dur: 0.14, gain: 0.4, delay: 0.09 }
        ] };
      default:
        return null;
    }
  }

  /* Đợt 3 — chỉ số playlist thuần (vòng lại). len <= 0 -> -1. */
  function edAudioPlaylistNextIndex(idx, len) {
    len = Number(len) || 0;
    if (len <= 0) return -1;
    var i = Number(idx);
    if (!isFinite(i) || i < 0) return 0;
    return (Math.floor(i) + 1) % len;
  }
  function edAudioPlaylistPrevIndex(idx, len) {
    len = Number(len) || 0;
    if (len <= 0) return -1;
    var i = Number(idx);
    if (!isFinite(i) || i < 0) return len - 1;
    return (Math.floor(i) - 1 + len) % len;
  }

  /* Đợt 3 — settings audio thuần: {volume 0..1, muted bool,
     currentIndex int >= 0, tracks:[{id, key?, name, ext?, size?}]}.
     Parse lỗi/thiếu field -> mặc định an toàn, không throw.
     Đợt 4 — thêm 3 field nhạc theo ngữ cảnh (settings cũ không có thì
     mặc định: contextMusic true, exploreTrackId/combatTrackId null). */
  function edAudioSettingsParse(text) {
    var d = { volume: 0.5, muted: false, currentIndex: 0, tracks: [],
      contextMusic: true, exploreTrackId: null, combatTrackId: null };
    var obj = null;
    try { obj = (typeof text === 'string' && text) ? JSON.parse(text) : null; } catch (e) { obj = null; }
    if (!obj || typeof obj !== 'object') return d;
    var v = Number(obj.volume);
    if (isFinite(v)) d.volume = clamp(v, 0, 1);
    d.muted = !!obj.muted;
    var ci = Number(obj.currentIndex);
    if (isFinite(ci) && ci >= 0) d.currentIndex = Math.floor(ci);
    if (Array.isArray(obj.tracks)) {
      obj.tracks.forEach(function (t) {
        if (!t || typeof t.id !== 'string' || !t.id) return;
        if (typeof t.name !== 'string' || !t.name) return;
        d.tracks.push({
          id: t.id,
          key: (typeof t.key === 'string' && t.key) ? t.key : edExportTrackKey(t.id),
          name: t.name,
          ext: (typeof t.ext === 'string') ? t.ext : '',
          size: (isFinite(Number(t.size)) && Number(t.size) > 0) ? Number(t.size) : 0
        });
      });
    }
    if (d.currentIndex >= d.tracks.length) d.currentIndex = 0;
    /* Đợt 4: chỉ nhận false rõ ràng mới tắt nhạc theo ngữ cảnh; id track
       chỉ nhận chuỗi không rỗng, còn lại null (chưa chọn). */
    d.contextMusic = obj.contextMusic !== false;
    d.exploreTrackId = (typeof obj.exploreTrackId === 'string' && obj.exploreTrackId) ? obj.exploreTrackId : null;
    d.combatTrackId = (typeof obj.combatTrackId === 'string' && obj.combatTrackId) ? obj.combatTrackId : null;
    return d;
  }
  function edAudioSettingsStringify(settings) {
    var s = edAudioSettingsParse(
      (settings && typeof settings === 'object') ? JSON.stringify(settings) : ''
    );
    try { return JSON.stringify(s); } catch (e) { return '{"volume":0.5,"muted":false,"currentIndex":0,"tracks":[]}'; }
  }

  /* ---- Đợt 4 — hàm thuần: xuất project ZIP. ---- */
  /* Tên file .zip từ tên project. Thuần. */
  function edExportBuildZipName(projectName) {
    return edExportBaseName(projectName) + '.zip';
  }
  /* Danh sách entry của project ZIP từ projectJson (chuỗi serialize của
     ED.Core.serialize(), hoặc object project — stringify 2-space).
     Trả [{path, kind:'json', content} | {path, kind:'fetch', url}]:
     entry đầu là project.json, còn lại là ZIP_FETCH_FILES (cố định).
     Thuần — fetcher thật nằm ở collectZipEntries. */
  function edExportBuildZipFileList(projectJson) {
    var text = '';
    if (typeof projectJson === 'string') text = projectJson;
    else if (projectJson && typeof projectJson === 'object') {
      try { text = JSON.stringify(projectJson, null, 2); } catch (e) { text = ''; }
    }
    var list = [{ path: 'project.json', kind: 'json', content: text }];
    ZIP_FETCH_FILES.forEach(function (p) {
      list.push({ path: p, kind: 'fetch', url: p });
    });
    return list;
  }
  /* Gom nội dung các entry trong fileList bằng fetcher giả/thật.
     fetcher(url) -> Promise<string|Uint8Array|ArrayBuffer|null> (null =
     fetch lỗi / HTTP không ok). Entry kind 'json' lấy thẳng content.
     Trả Promise<{entries:[{path, data}], missing:[path...]}> — file fetch
     lỗi chỉ ghi vào missing, KHÔNG throw, để ZIP vẫn xuất phần còn lại. */
  function collectZipEntries(fileList, fetcher) {
    var list = Array.isArray(fileList) ? fileList : [];
    var entries = [];
    var missing = [];
    var chain = Promise.resolve();
    list.forEach(function (e) {
      chain = chain.then(function () {
        if (!e || typeof e.path !== 'string' || !e.path) return;
        if (e.kind === 'json') {
          entries.push({ path: e.path, data: (typeof e.content === 'string') ? e.content : '' });
          return;
        }
        var url = (typeof e.url === 'string' && e.url) ? e.url : e.path;
        var p = null;
        try {
          p = (typeof fetcher === 'function') ? fetcher(url) : null;
        } catch (err) { p = null; }
        return Promise.resolve(p).then(function (data) {
          if (data === null || data === undefined || data === false) { missing.push(e.path); return; }
          entries.push({ path: e.path, data: data });
        }).catch(function () { missing.push(e.path); });
      });
    });
    return chain.then(function () { return { entries: entries, missing: missing }; });
  }

  /* ---- Đợt 4 — hàm thuần: SFX theo vị trí 3D. ---- */
  /* Chuẩn hoá vị trí thành [x, y, z] (số). Nhận [x,y,z], [x,z] (y=0),
     {x,y,z} hoặc {x,z}. Không đọc được -> null. Thuần. */
  function edAudioPosToVec(p) {
    if (!p) return null;
    if (Array.isArray(p)) {
      if (p.length >= 3) {
        return [(Number(p[0]) || 0), (Number(p[1]) || 0), (Number(p[2]) || 0)];
      }
      if (p.length === 2) {
        return [(Number(p[0]) || 0), 0, (Number(p[1]) || 0)];
      }
      return null;
    }
    if (typeof p === 'object') {
      if (typeof p.x === 'number' || typeof p.z === 'number') {
        return [(Number(p.x) || 0), (Number(p.y) || 0), (Number(p.z) || 0)];
      }
    }
    return null;
  }
  /* Gain theo khoảng cách: 0 -> 1, >= maxDistance -> 0, giữa thì giảm
     tuyến tính 1 - d/max. distance không hợp lệ -> 1 (phát bình thường);
     maxDistance không hợp lệ -> 0. Thuần. */
  function edAudioPannerGainFor(distance, maxDistance) {
    var d = Number(distance);
    if (!isFinite(d) || d <= 0) return 1;
    var max = Number(maxDistance);
    if (!isFinite(max) || max <= 0) return 0;
    if (d >= max) return 0;
    return clamp(1 - d / max, 0, 1);
  }
  /* Pan trái/phải (-1..1) của nguồn so với camera: hướng từ camera tới
     nguồn chiếu lên vector phải của camera (right = forward x up).
     Nguồn bên phải -> +, bên trái -> -, trước/sau/chính giữa -> 0.
     Thiếu vị trí/hướng (hoặc trùng vị trí) -> 0. Thuần. */
  function edAudioPanFor(sourcePos, cameraPos, cameraForward) {
    var s = edAudioPosToVec(sourcePos);
    var c = edAudioPosToVec(cameraPos);
    var f = edAudioPosToVec(cameraForward);
    if (!s || !c || !f) return 0;
    var dx = s[0] - c[0], dy = s[1] - c[1], dz = s[2] - c[2];
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.0001) return 0;
    dx /= len; dy /= len; dz /= len;
    var fl = Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]);
    if (fl < 0.0001) return 0;
    var fx = f[0] / fl, fz = f[2] / fl;
    /* right = cross(forward, up=(0,1,0)) = (-fz, 0, fx). */
    var rx = -fz, rz = fx;
    var rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 0.0001) return 0;
    rx /= rl; rz /= rl;
    return clamp(dx * rx + dz * rz, -1, 1);
  }

  /* ---- Đợt 4 — hàm thuần: nhạc theo ngữ cảnh (explore/combat). ---- */
  /* Máy trạng thái nhạc: mode hiện tại + inCombat + thời gian.
     - inCombat true -> combat ngay, lastHitMs = nowMs.
     - inCombat false + force -> về explore ngay.
     - inCombat false, đang combat, quá COMBAT_GRACE_MS (5s) kể từ
       lastHitMs -> về explore; trong 5s thì vẫn combat.
     Trả {mode, lastHitMs}. Thuần. */
  function edAudioCombatNext(mode, inCombat, nowMs, lastHitMs, force) {
    var m = (mode === 'combat') ? 'combat' : 'explore';
    var now = Number(nowMs);
    if (!isFinite(now) || now < 0) now = 0;
    var last = Number(lastHitMs);
    if (!isFinite(last) || last < 0) last = 0;
    if (inCombat) return { mode: 'combat', lastHitMs: now };
    if (force) return { mode: 'explore', lastHitMs: last };
    if (m === 'combat' && (now - last) > COMBAT_GRACE_MS) {
      return { mode: 'explore', lastHitMs: last };
    }
    return { mode: m, lastHitMs: last };
  }
  /* Kế hoạch fade tuyến tính: mảng steps+1 giá trị từ `from` tới `to`
     (đã kẹp 0..1). Dùng để test ramp; _fadeAudioTo chạy đúng plan này
     bằng setInterval. Thuần. */
  function edAudioFadePlan(from, to, steps) {
    var n = Math.max(1, Math.floor(Number(steps) || 0));
    var a = clamp(Number(from) || 0, 0, 1);
    var b = clamp(Number(to) || 0, 0, 1);
    var out = [];
    for (var i = 0; i <= n; i++) out.push(a + (b - a) * i / n);
    return out;
  }

  function toast(msg) {
    if (ED.UI && typeof ED.UI.toast === 'function') { try { ED.UI.toast(msg); } catch (e) {} }
  }
  function log(msg) {
    if (ED.UI && typeof ED.UI.log === 'function') { try { ED.UI.log(msg); } catch (e) {} }
  }
  function projectName() {
    var p = ED.Core && typeof ED.Core.getProject === 'function' ? ED.Core.getProject() : null;
    return (p && p.name) ? p.name : 'map-editor';
  }

  /* ---- IndexedDB store 'assets' (cùng pattern 03-assets.js). ---- */
  function openDb() {
    return new Promise(function (resolve, reject) {
      var idb = null;
      try { idb = (typeof window !== 'undefined' && window.indexedDB) ? window.indexedDB : null; } catch (e) { idb = null; }
      if (!idb) { reject(new Error('Trình duyệt này không dùng được IndexedDB.')); return; }
      var req;
      try { req = idb.open(DB_NAME, 1); } catch (e) { reject(new Error('Không mở được IndexedDB.')); return; }
      req.onupgradeneeded = function () {
        try {
          var db = req.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'name' });
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        } catch (e) {}
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(new Error('Không mở được IndexedDB.')); };
      req.onblocked = function () { reject(new Error('IndexedDB đang bị chặn, đóng tab khác rồi thử lại.')); };
    });
  }
  function idbPut(rec) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx, done = false;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không lưu được nhạc nền.')); return; }
        tx.oncomplete = function () { try { db.close(); } catch (e) {} if (!done) { done = true; resolve(rec); } };
        tx.onerror = function () { try { db.close(); } catch (e) {} if (!done) { done = true; reject(new Error('Không lưu được nhạc nền vào máy.')); } };
        try { tx.objectStore(STORE).put(rec); } catch (e) { try { db.close(); } catch (e2) {} if (!done) { done = true; reject(new Error('Không lưu được nhạc nền.')); } }
      });
    });
  }
  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readonly'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được nhạc nền đã lưu.')); return; }
        var req;
        try { req = tx.objectStore(STORE).get(key); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không đọc được nhạc nền đã lưu.')); return; }
        req.onsuccess = function () { try { db.close(); } catch (e) {} resolve(req.result || null); };
        req.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không đọc được nhạc nền đã lưu.')); };
      });
    });
  }
  function idbDel(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try { tx = db.transaction(STORE, 'readwrite'); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xoá được nhạc nền.')); return; }
        tx.oncomplete = function () { try { db.close(); } catch (e) {} resolve(); };
        tx.onerror = function () { try { db.close(); } catch (e) {} reject(new Error('Không xoá được nhạc nền.')); };
        try { tx.objectStore(STORE).delete(key); } catch (e) { try { db.close(); } catch (e2) {} reject(new Error('Không xoá được nhạc nền.')); }
      });
    });
  }

  /* ---- Đợt 3 — settings audio (localStorage). ---- */
  function _readSettingsText() {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(AUDIO_SETTINGS_KEY);
    } catch (e) { return null; }
  }
  function _loadSettings() {
    var s = edAudioSettingsParse(_readSettingsText());
    _volume = s.volume;
    _muted = s.muted;
    _tracks = s.tracks;
    _trackIndex = s.currentIndex;
    _contextMusic = s.contextMusic;
    _exploreTrackId = s.exploreTrackId;
    _combatTrackId = s.combatTrackId;
    if (_audioEl) {
      try { _audioEl.volume = _volume; _audioEl.muted = _muted; } catch (e) {}
    }
    _applySfxGain();
    return s;
  }
  function _saveSettings() {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(AUDIO_SETTINGS_KEY, edAudioSettingsStringify({
        volume: _volume, muted: _muted, currentIndex: _trackIndex, tracks: _tracks,
        contextMusic: _contextMusic, exploreTrackId: _exploreTrackId, combatTrackId: _combatTrackId
      }));
      return true;
    } catch (e) { return false; }
  }
  function getAudioSettings() {
    var s = edAudioSettingsParse(_readSettingsText());
    s.volume = _volume;
    s.muted = _muted;
    s.currentIndex = _trackIndex;
    s.tracks = _tracks.map(function (t) {
      return { id: t.id, key: t.key, name: t.name, ext: t.ext, size: t.size };
    });
    s.contextMusic = _contextMusic;
    s.exploreTrackId = _exploreTrackId;
    s.combatTrackId = _combatTrackId;
    return s;
  }

  /* ---- Export .GLB thật. ---- */
  function isGLBReady() {
    try {
      return (typeof THREE !== 'undefined') && !!THREE.GLTFExporter &&
        typeof THREE.GLTFExporter === 'function';
    } catch (e) { return false; }
  }

  /* Dựng scene tạm chỉ gồm terrain + các object trong Viewport.meshes
     (clone, giữ nguyên transform). Không lấy toàn bộ scene của editor
     (gizmo, grid, axes, đèn editor sẽ lọt vào file nếu lấy cả scene).
     Nhóm con đã nằm trong group cha thì bỏ qua (đi kèm bản clone của cha).
     Points/Lines/Sprite (FX hạt) bị loại — GLTFExporter r128 không xuất
     được loại này, giữ lại sẽ làm export lỗi hoặc ra file thiếu. */
  function buildExportScene() {
    if (typeof THREE === 'undefined' || !ED.Viewport) return null;
    var scene = new THREE.Scene();
    scene.name = projectName();
    var meshes = ED.Viewport.meshes || {};
    var ids = Object.keys(meshes);
    var added = 0;
    ids.forEach(function (id) {
      var g = meshes[id];
      if (!g) return;
      if (g.visible === false) return;
      /* Con của 1 group khác trong meshes: đã đi kèm khi clone cha. */
      if (g.parent && g.parent !== ED.Viewport.scene &&
          g.parent.userData && g.parent.userData.objectId &&
          meshes[g.parent.userData.objectId]) return;
      var c = null;
      try { c = g.clone(true); } catch (e) { return; }
      if (!c) return;
      var obj = ED.Core && typeof ED.Core.getObject === 'function' ? ED.Core.getObject(id) : null;
      if (obj && obj.name) c.name = obj.name;
      else if (!c.name) c.name = id;
      /* Loại Points/Lines/Sprite trong bản clone (thu thập trước rồi xoá). */
      var drop = [];
      c.traverse(function (n) {
        if (n.isPoints || n.isLine || n.isSprite) drop.push(n);
      });
      drop.forEach(function (n) { if (n.parent) n.parent.remove(n); });
      scene.add(c);
      added++;
    });
    /* Terrain: đợt 4 mặt đất là 16 chunk mesh (ED.Terrain.getChunkMeshes) —
       lấy đủ cả 16 chunk; fallback: getMesh() (chunk đầu, API cũ) rồi
       quét mesh userData.isTerrain trong scene. Terrain luôn export kể
       cả khi meshes rỗng. */
    var terrains = [];
    try {
      if (ED.Terrain && typeof ED.Terrain.getChunkMeshes === 'function') {
        terrains = ED.Terrain.getChunkMeshes() || [];
      }
    } catch (e) { terrains = []; }
    if (!terrains.length) {
      var terrain = null;
      try {
        if (ED.Terrain && typeof ED.Terrain.getMesh === 'function') terrain = ED.Terrain.getMesh();
      } catch (e) { terrain = null; }
      if (!terrain && ED.Viewport.scene) {
        var kids = ED.Viewport.scene.children || [];
        for (var i = 0; i < kids.length; i++) {
          if (kids[i] && kids[i].userData && kids[i].userData.isTerrain) { terrain = kids[i]; break; }
        }
      }
      if (terrain) terrains = [terrain];
    }
    terrains.forEach(function (terr, ti) {
      var tc = null;
      try { tc = terr.clone(true); } catch (e) { tc = null; }
      if (tc) { tc.name = terrains.length > 1 ? ('Terrain-chunk-' + ti) : 'Terrain'; scene.add(tc); added++; }
    });
    if (!added) return null;
    return scene;
  }

  function downloadBlob(buf, filename, mime) {
    var blob = new Blob([buf], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e) {}
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 1000);
  }

  function downloadArrayBuffer(buf, filename) {
    downloadBlob(buf, filename, 'model/gltf-binary');
  }

  function downloadText(text, filename, mime) {
    downloadBlob([text], filename, mime || 'text/plain');
  }

  /* Tải data URL (vd ảnh PNG đã chụp) về file. */
  function downloadDataUrl(dataUrl, filename) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e) {}
    }, 1000);
  }

  /* Export GLB, trả Promise<boolean>. Chỉ tải file khi header GLB
     validate OK (magic 'glTF', version 2, length khớp). */
  function exportGLB() {
    if (_exporting) return Promise.resolve(false);
    if (typeof document === 'undefined') return Promise.reject(new Error('Export .GLB cần chạy trong trình duyệt.'));
    if (!isGLBReady()) {
      var msg = 'Chưa tải được GLTFExporter (lib/GLTFExporter.js chưa có trong bản build) — không xuất được .GLB.';
      toast(msg); log(msg);
      return Promise.resolve(false);
    }
    var scene = null;
    try { scene = buildExportScene(); } catch (e) {
      toast('Không dựng được scene để xuất: ' + (e && e.message ? e.message : ''));
      return Promise.resolve(false);
    }
    if (!scene) {
      toast('Scene trống (chưa có object nào và chưa có terrain) — không có gì để xuất.');
      return Promise.resolve(false);
    }
    _exporting = true;
    _setStatus('Đang xuất .GLB…');
    return new Promise(function (resolve) {
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        _exporting = false;
        resolve(ok);
      }
      try {
        new THREE.GLTFExporter().parse(scene, function (result) {
          try {
            var buf = (result instanceof ArrayBuffer) ? result : null;
            if (!buf) { _setStatus('Export thất bại: exporter không trả về ArrayBuffer.'); toast('Export .GLB thất bại.'); finish(false); return; }
            var v = edExportValidateGLB(new Uint8Array(buf));
            if (!v.ok) {
              _setStatus('File GLB không hợp lệ: ' + v.reason);
              toast('Export .GLB thất bại: ' + v.reason);
              log('Export .GLB: validate fail — ' + v.reason);
              finish(false);
              return;
            }
            var name = edExportFileName(projectName());
            downloadArrayBuffer(buf, name);
            _setStatus('Đã xuất ' + name + ' (' + (buf.byteLength / 1024).toFixed(0) + ' KB, GLB v2).');
            toast('Đã xuất ' + name);
            log('Đã xuất .GLB: ' + name + ' (' + buf.byteLength + ' byte).');
            finish(true);
          } catch (e) {
            _setStatus('Export thất bại: ' + (e && e.message ? e.message : ''));
            toast('Export .GLB thất bại.');
            finish(false);
          }
        }, { binary: true });
      } catch (e) {
        _exporting = false;
        _setStatus('Export thất bại: ' + (e && e.message ? e.message : ''));
        toast('Export .GLB thất bại: ' + (e && e.message ? e.message : ''));
        finish(false);
      }
    });
  }

  /* ---- Đợt 3 — Export .gltf JSON + file .bin riêng. ----
     GLTFExporter r128 với binary:false trả về object JSON, trong đó
     buffers[0].uri là data URI base64 của buffer nhị phân. Tách data URI
     đó ra thành file .bin riêng, đổi uri trong JSON thành tên file .bin,
     rồi validate (parse được + asset + buffers trỏ đúng .bin) TRƯỚC khi
     tải 2 file về. Trả Promise<boolean>. */
  function exportGLTF() {
    if (_exporting) return Promise.resolve(false);
    if (typeof document === 'undefined') return Promise.reject(new Error('Export .gltf cần chạy trong trình duyệt.'));
    if (!isGLBReady()) {
      var msg = 'Chưa tải được GLTFExporter (lib/GLTFExporter.js chưa có trong bản build) — không xuất được .gltf.';
      toast(msg); log(msg);
      return Promise.resolve(false);
    }
    var scene = null;
    try { scene = buildExportScene(); } catch (e) {
      toast('Không dựng được scene để xuất: ' + (e && e.message ? e.message : ''));
      return Promise.resolve(false);
    }
    if (!scene) {
      toast('Scene trống (chưa có object nào và chưa có terrain) — không có gì để xuất.');
      return Promise.resolve(false);
    }
    _exporting = true;
    _setStatus('Đang xuất .gltf…');
    return new Promise(function (resolve) {
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        _exporting = false;
        resolve(ok);
      }
      try {
        new THREE.GLTFExporter().parse(scene, function (result) {
          try {
            var json = result;
            if (typeof json === 'string') {
              try { json = JSON.parse(json); } catch (e) { json = null; }
            }
            if (!json || typeof json !== 'object') {
              _setStatus('Export thất bại: exporter không trả về JSON glTF.');
              toast('Export .gltf thất bại.');
              finish(false);
              return;
            }
            var gltfName = edExportBuildGltfName(projectName());
            var binName = edExportBuildGltfBinName(projectName());
            var binBuf = null;
            /* Tách buffer data URI ra file .bin riêng. */
            if (json.buffers && json.buffers.length && json.buffers[0] &&
                typeof json.buffers[0].uri === 'string' &&
                json.buffers[0].uri.indexOf('data:') === 0) {
              var dec = edExportDataUriToBytes(json.buffers[0].uri);
              if (dec && dec.bytes) {
                binBuf = dec.bytes.buffer.slice(dec.bytes.byteOffset, dec.bytes.byteOffset + dec.bytes.byteLength);
              }
              json.buffers[0].uri = binName;
            }
            var text = edExportGltfJsonText(json, binName);
            if (!text) {
              _setStatus('Export thất bại: không tạo được JSON glTF.');
              toast('Export .gltf thất bại.');
              finish(false);
              return;
            }
            var v = edExportValidateGltf(text, binName);
            if (!v.ok) {
              _setStatus('File .gltf không hợp lệ: ' + v.reason);
              toast('Export .gltf thất bại: ' + v.reason);
              log('Export .gltf: validate fail — ' + v.reason);
              finish(false);
              return;
            }
            if (json.buffers && json.buffers.length && !binBuf) {
              _setStatus('Export thất bại: không tách được dữ liệu .bin từ exporter.');
              toast('Export .gltf thất bại: thiếu dữ liệu .bin.');
              finish(false);
              return;
            }
            downloadText(text, gltfName, 'model/gltf+json');
            if (binBuf) downloadBlob(binBuf, binName, 'application/octet-stream');
            _setStatus('Đã xuất ' + gltfName + (binBuf ? ' + ' + binName + ' (' + (binBuf.byteLength / 1024).toFixed(0) + ' KB).' : '.'));
            toast('Đã xuất ' + gltfName + (binBuf ? ' + ' + binName : ''));
            log('Đã xuất .gltf: ' + gltfName + (binBuf ? ' + ' + binName + ' (' + binBuf.byteLength + ' byte).' : '.'));
            finish(true);
          } catch (e) {
            _setStatus('Export thất bại: ' + (e && e.message ? e.message : ''));
            toast('Export .gltf thất bại.');
            finish(false);
          }
        }, { binary: false });
      } catch (e) {
        _exporting = false;
        _setStatus('Export thất bại: ' + (e && e.message ? e.message : ''));
        toast('Export .gltf thất bại: ' + (e && e.message ? e.message : ''));
        finish(false);
      }
    });
  }

  /* ---- Đợt 3 — Chụp ảnh PNG đúng khung viewport hiện tại. ----
     Renderer của editor KHÔNG bật preserveDrawingBuffer (01-viewport.js:
     new THREE.WebGLRenderer({antialias:true})), nên buffer vẽ bị xoá sau
     mỗi lần trình duyệt composite. Cách đúng: render 1 frame đồng bộ rồi
     gọi toDataURL NGAY trong cùng task (trước khi trả quyền cho trình
     duyệt). Ảnh là đúng khung viewport đang thấy, kể cả lưới/gizmo nếu
     đang hiện. Trả Promise<boolean>. */
  function captureViewportPNG() {
    if (typeof document === 'undefined') return Promise.reject(new Error('Chụp ảnh cần chạy trong trình duyệt.'));
    var renderer = null, scene = null, camera = null;
    try {
      if (ED.Viewport) {
        if (typeof ED.Viewport.getRenderer === 'function') renderer = ED.Viewport.getRenderer();
        else renderer = ED.Viewport.renderer || null;
        if (typeof ED.Viewport.getScene === 'function') scene = ED.Viewport.getScene();
        else scene = ED.Viewport.scene || null;
        if (typeof ED.Viewport.getCamera === 'function') camera = ED.Viewport.getCamera();
        else camera = ED.Viewport.camera || null;
      }
    } catch (e) { renderer = null; scene = null; camera = null; }
    if (!renderer || !renderer.domElement || !scene || !camera) {
      toast('Chưa có viewport để chụp — mở Map Editor rồi thử lại.');
      return Promise.resolve(false);
    }
    var dataUrl = '';
    try {
      renderer.render(scene, camera);
      dataUrl = renderer.domElement.toDataURL('image/png');
    } catch (e) {
      toast('Chụp ảnh thất bại: ' + (e && e.message ? e.message : ''));
      return Promise.resolve(false);
    }
    if (!edExportIsPngDataUrl(dataUrl)) {
      _setStatus('Chụp ảnh thất bại: không lấy được dữ liệu PNG từ viewport.');
      toast('Chụp ảnh thất bại: không lấy được dữ liệu PNG từ viewport.');
      return Promise.resolve(false);
    }
    var name = edExportBuildPngName(projectName());
    try { downloadDataUrl(dataUrl, name); } catch (e) {
      toast('Chụp ảnh thất bại: ' + (e && e.message ? e.message : ''));
      return Promise.resolve(false);
    }
    _setStatus('Đã chụp ' + name + ' (' + Math.round(dataUrl.length / 1024) + ' KB).');
    toast('Đã chụp ảnh ' + name);
    log('Đã chụp ảnh PNG viewport: ' + name + '.');
    return Promise.resolve(true);
  }

  /* ---- Đợt 4 — Xuất project .ZIP thật bằng JSZip. ----
     JSZip lấy từ global (lib/jszip.min.js UMD, coordinator inline vào
     build qua placeholder __JSZIP__); chưa có thì isZipReady() false và
     panel chỉ hiện hint, KHÔNG vẽ nút giả. ZIP gồm project.json (project
     hiện tại serialize) + các file trong ZIP_FETCH_FILES lấy qua fetch
     cùng origin. File fetch lỗi -> bỏ qua + ghi THIEU_FILE.txt trong ZIP,
     vẫn xuất các file còn lại. Trả Promise<boolean>. */
  function isZipReady() {
    try {
      if (typeof JSZip !== 'undefined' && typeof JSZip === 'function') return true;
      if (typeof window !== 'undefined' && window && typeof window.JSZip === 'function') return true;
    } catch (e) {}
    return false;
  }
  function _zipCtor() {
    try {
      if (typeof JSZip !== 'undefined' && typeof JSZip === 'function') return JSZip;
      if (typeof window !== 'undefined' && window && typeof window.JSZip === 'function') return window.JSZip;
    } catch (e) {}
    return null;
  }
  function _fetchText(url) {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    try {
      return fetch(url).then(function (r) {
        if (!r || !r.ok) return null;
        return r.text();
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function exportProjectZip() {
    if (_zipExporting) return Promise.resolve(false);
    if (typeof document === 'undefined') return Promise.reject(new Error('Xuất project .ZIP cần chạy trong trình duyệt.'));
    var ZipCtor = _zipCtor();
    if (!ZipCtor) {
      var msg = 'Chưa tải được JSZip (lib/jszip.min.js chưa có trong bản build) — không xuất được project .ZIP.';
      toast(msg); log(msg);
      return Promise.resolve(false);
    }
    var projectJson = '';
    try {
      projectJson = (ED.Core && typeof ED.Core.serialize === 'function') ? ED.Core.serialize() : '';
    } catch (e) { projectJson = ''; }
    if (!projectJson) {
      toast('Chưa lấy được project để xuất ZIP — thử lưu project rồi xuất lại.');
      return Promise.resolve(false);
    }
    _zipExporting = true;
    _setStatus('Đang gom file project vào ZIP…');
    var list = edExportBuildZipFileList(projectJson);
    return collectZipEntries(list, _fetchText).then(function (res) {
      var zip = null;
      try {
        zip = new ZipCtor();
        res.entries.forEach(function (en) { zip.file(en.path, en.data); });
        if (res.missing.length) {
          zip.file('THIEU_FILE.txt',
            'Các file sau không tải được từ server nên đã bỏ qua khỏi ZIP ' +
            '(project vẫn xuất đủ phần còn lại):\n' +
            res.missing.map(function (p) { return '- ' + p; }).join('\n') + '\n');
        }
      } catch (e) {
        _zipExporting = false;
        _setStatus('Xuất ZIP thất bại: ' + (e && e.message ? e.message : ''));
        toast('Xuất project .ZIP thất bại.');
        return false;
      }
      return zip.generateAsync({ type: 'blob' }).then(function (blob) {
        _zipExporting = false;
        var name = edExportBuildZipName(projectName());
        try { downloadBlob(blob, name, 'application/zip'); } catch (e) {
          _setStatus('Xuất ZIP thất bại: không tải được file.');
          toast('Xuất project .ZIP thất bại.');
          return false;
        }
        var note = res.missing.length
          ? ' (thiếu ' + res.missing.length + ' file, xem THIEU_FILE.txt trong ZIP)'
          : '';
        _setStatus('Đã xuất ' + name + ' (' + res.entries.length + ' file' + note + ').');
        toast('Đã xuất ' + name + note);
        log('Đã xuất project .ZIP: ' + name + ' (' + res.entries.length + ' file' +
          (res.missing.length ? ', thiếu: ' + res.missing.join(', ') : '') + ').');
        return true;
      }).catch(function (e) {
        _zipExporting = false;
        _setStatus('Xuất ZIP thất bại: ' + (e && e.message ? e.message : ''));
        toast('Xuất project .ZIP thất bại.');
        return false;
      });
    }).catch(function (e) {
      _zipExporting = false;
      _setStatus('Xuất ZIP thất bại: ' + (e && e.message ? e.message : ''));
      toast('Xuất project .ZIP thất bại.');
      return false;
    });
  }

  /* ---- Nhạc nền ambient + playlist (đợt 2 + đợt 3). ---- */
  function _ensureAudioEl() {
    if (_audioEl) return _audioEl;
    if (typeof Audio === 'undefined') return null;
    _audioEl = new Audio();
    _audioEl.preload = 'auto';
    try { _audioEl.volume = _volume; } catch (e) {}
    try { _audioEl.muted = _muted; } catch (e) {}
    _applyLoop();
    /* Đợt 3: hết bài tự chuyển bài sau (chỉ khi playlist có > 1 bài;
       1 bài thì loop lại — xem _applyLoop). */
    try {
      if (typeof _audioEl.addEventListener === 'function') {
        _audioEl.addEventListener('ended', function () {
          try { if (_tracks.length > 1) nextTrack(); } catch (e) {}
        });
      }
    } catch (e) {}
    return _audioEl;
  }
  function _applyLoop() {
    if (!_audioEl) return;
    try { _audioEl.loop = _tracks.length <= 1; } catch (e) {}
  }
  function _setAudioSource(arrayBuffer, mime) {
    if (typeof URL === 'undefined' || typeof Blob === 'undefined') return false;
    if (_audioUrl) { try { URL.revokeObjectURL(_audioUrl); } catch (e) {} _audioUrl = null; }
    var blob = new Blob([arrayBuffer], { type: mime || 'audio/mpeg' });
    _audioUrl = URL.createObjectURL(blob);
    var el = _ensureAudioEl();
    if (!el) return false;
    el.src = _audioUrl;
    return true;
  }
  function _refreshAudioUI() {
    if (!_panel || typeof document === 'undefined') return;
    var nameEl = _panel.querySelector('#ed-ambient-name');
    if (nameEl) {
      if (_tracks.length) {
        var cur = _tracks[_trackIndex];
        nameEl.textContent = '🎵 ' + (cur ? cur.name : '') + ' (' + (_trackIndex + 1) + '/' + _tracks.length + ')';
      } else {
        nameEl.textContent = _audioKey ? ('🎵 ' + (_audioName || 'nhạc nền')) : 'Chưa có nhạc nền.';
      }
    }
    var playBtn = _panel.querySelector('#ed-ambient-play');
    if (playBtn) playBtn.disabled = !_tracks.length && !_audioKey;
    var stopBtn = _panel.querySelector('#ed-ambient-stop');
    if (stopBtn) stopBtn.disabled = !_tracks.length && !_audioKey;
    var delBtn = _panel.querySelector('#ed-ambient-del');
    if (delBtn) delBtn.disabled = !_tracks.length && !_audioKey;
    var muteBtn = _panel.querySelector('#ed-audio-mute');
    if (muteBtn) muteBtn.textContent = _muted ? '🔇 Đang tắt tiếng' : '🔊 Bật tiếng';
    _refreshPlaylistUI();
    _refreshMusicModeUI();
  }
  function _refreshPlaylistUI() {
    if (!_panel || typeof document === 'undefined') return;
    var box = _panel.querySelector('#ed-playlist');
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!_tracks.length) {
      var em = document.createElement('div');
      em.className = 'ed-hint';
      em.textContent = 'Playlist trống — bấm "➕ Thêm nhạc" để thêm bài.';
      box.appendChild(em);
      return;
    }
    _tracks.forEach(function (tr, i) {
      var row = document.createElement('div');
      row.className = 'ed-pl-track' + (i === _trackIndex ? ' on' : '');
      var label = document.createElement('span');
      label.textContent = (i + 1) + '. ' + tr.name;
      label.addEventListener('click', function () { playTrack(i); });
      row.appendChild(label);
      var del = document.createElement('button');
      del.textContent = '✕';
      del.title = 'Xoá bài này';
      del.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        removeTrack(tr.id);
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  function _setStatus(msg) {
    if (!_panel || typeof document === 'undefined') return;
    var el = _panel.querySelector('#ed-export-status');
    if (el) el.textContent = msg;
  }

  /* Nạp source của track thứ idx vào thẻ audio (chưa phát). */
  function _loadTrackSource(idx) {
    if (!_tracks.length) return Promise.resolve(false);
    var len = _tracks.length;
    var i = ((Number(idx) || 0) % len + len) % len;
    var tr = _tracks[i];
    var key = tr.key || edExportTrackKey(tr.id);
    return idbGet(key).then(function (rec) {
      if (!rec || !rec.data) return false;
      _audioTrackId = tr.id;
      _setAudioSource(rec.data, rec.mime);
      _applyLoop();
      return true;
    }).catch(function () { return false; });
  }
  function _playEl() {
    var el = _audioEl;
    if (!el || !_audioUrl) return Promise.resolve(false);
    try {
      var p = el.play();
      if (p && typeof p.then === 'function') {
        return p.then(function () { return true; }).catch(function () { return false; });
      }
      return Promise.resolve(true);
    } catch (e) { return Promise.resolve(false); }
  }
  function _playCurrent() {
    var el = _ensureAudioEl();
    if (!el) return Promise.resolve(false);
    if (!_tracks.length) return Promise.resolve(false);
    var tr = _tracks[_trackIndex];
    if (tr && _audioTrackId === tr.id && _audioUrl) return _playEl();
    return playTrack(_trackIndex);
  }

  /* Đợt 3 — thêm 1 file nhạc vào playlist (lưu IDB, meta lưu
     localStorage). Bài mới thêm trở thành bài đang chọn. */
  function addTrack(file) {
    var v = edExportValidateAudioFile(file);
    if (!v.ok) { toast(v.reason); return Promise.reject(new Error(v.reason)); }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Không đọc được file từ máy.')); };
      reader.onload = function () {
        var id = edExportMakeTrackId(file.name, Date.now());
        var n = 1;
        while (_tracks.some(function (t) { return t.id === id; })) {
          id = edExportMakeTrackId(file.name, Date.now()) + '-' + (n++);
        }
        var key = edExportTrackKey(id);
        var rec = {
          key: key, name: file.name, size: file.size, ext: v.ext,
          mime: file.type || '', addedAt: Date.now(), data: reader.result
        };
        idbPut(rec).then(function () {
          var meta = { id: id, key: key, name: file.name, ext: v.ext, size: file.size };
          _tracks.push(meta);
          _trackIndex = _tracks.length - 1;
          _audioKey = key;
          _audioName = file.name;
          _saveSettings();
          _refreshAudioUI();
          toast('Đã thêm vào playlist: ' + file.name);
          log('Đã thêm track playlist: ' + file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB).');
          resolve(meta);
        }).catch(reject);
      };
      try { reader.readAsArrayBuffer(file); } catch (e) { reject(new Error('Không đọc được file từ máy.')); }
    });
  }
  function removeTrack(id) {
    var idx = -1;
    for (var i = 0; i < _tracks.length; i++) {
      if (_tracks[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return Promise.resolve(false);
    var tr = _tracks[idx];
    var wasCurrent = idx === _trackIndex;
    if (wasCurrent) stopAmbient();
    var key = tr.key || edExportTrackKey(tr.id);
    return idbDel(key).then(function () {
      _tracks.splice(idx, 1);
      if (_trackIndex >= _tracks.length) _trackIndex = Math.max(0, _tracks.length - 1);
      if (wasCurrent) {
        _audioTrackId = null;
        if (_audioUrl) { try { URL.revokeObjectURL(_audioUrl); } catch (e) {} _audioUrl = null; }
        if (_audioEl) { try { _audioEl.removeAttribute('src'); _audioEl.load(); } catch (e) {} }
      }
      if (tr.key === AUDIO_KEY || tr.id === AUDIO_ID) { _audioKey = null; _audioName = ''; }
      _saveSettings();
      _refreshAudioUI();
      toast('Đã xoá khỏi playlist: ' + tr.name);
      return true;
    });
  }
  function playTrack(index) {
    var el = _ensureAudioEl();
    if (!el) return Promise.resolve(false);
    if (!_tracks.length) {
      return loadAmbient().then(function (ok) { return ok ? playTrack(index) : false; });
    }
    var len = _tracks.length;
    var idx = ((Number(index) || 0) % len + len) % len;
    _trackIndex = idx;
    _saveSettings();
    _refreshAudioUI();
    return _loadTrackSource(idx).then(function (ok) {
      if (!ok) return false;
      return _playEl();
    });
  }
  function nextTrack() {
    if (!_tracks.length) return Promise.resolve(false);
    return playTrack(edAudioPlaylistNextIndex(_trackIndex, _tracks.length));
  }
  function prevTrack() {
    if (!_tracks.length) return Promise.resolve(false);
    return playTrack(edAudioPlaylistPrevIndex(_trackIndex, _tracks.length));
  }
  function getPlaylist() {
    return _tracks.map(function (t) {
      return { id: t.id, key: t.key, name: t.name, ext: t.ext, size: t.size };
    });
  }
  function getCurrentTrack() {
    var tr = _tracks[_trackIndex];
    return tr ? { id: tr.id, key: tr.key, name: tr.name, ext: tr.ext, size: tr.size } : null;
  }

  /* Import file audio -> thêm vào playlist (bài mới thành bài đang chọn,
     nạp source nhưng KHÔNG tự phát). Giữ API cũ của đợt 2. */
  function importAmbient(file) {
    return addTrack(file).then(function (meta) {
      return _loadTrackSource(_tracks.length - 1).then(function () {
        return { key: meta.key, name: meta.name, size: meta.size, ext: meta.ext };
      });
    });
  }
  /* Xoá bài đang chọn khỏi playlist (giữ API cũ của đợt 2: không còn
     track nào thì fallback xoá key legacy 'audio:ambient'). */
  function removeAmbient() {
    if (_tracks.length) {
      var cur = _tracks[_trackIndex];
      if (cur) return removeTrack(cur.id);
    }
    stopAmbient();
    return idbDel(AUDIO_KEY).then(function () {
      _audioKey = null;
      _audioName = '';
      if (_audioUrl) { try { URL.revokeObjectURL(_audioUrl); } catch (e) {} _audioUrl = null; }
      if (_audioEl) { try { _audioEl.removeAttribute('src'); _audioEl.load(); } catch (e) {} }
      _refreshAudioUI();
      toast('Đã xoá nhạc nền.');
    });
  }
  /* Tải nhạc đã lưu (nếu có) vào thẻ audio, chưa phát. Dùng ở init()
     và khi Play.start muốn phát mà init chưa kịp khôi phục.
     Đợt 3: đọc playlist từ settings; nếu chưa có playlist mà còn track
     legacy 'audio:ambient' thì migrate nó thành track đầu playlist. */
  function loadAmbient() {
    _loadSettings();
    if (_tracks.length) {
      if (_trackIndex >= _tracks.length) _trackIndex = 0;
      return _loadTrackSource(_trackIndex).then(function (ok) {
        _refreshAudioUI();
        return ok;
      }).catch(function () { return false; });
    }
    return idbGet(AUDIO_KEY).then(function (rec) {
      if (!rec || !rec.data) return false;
      var meta = { id: AUDIO_ID, key: AUDIO_KEY, name: rec.name || 'nhạc nền', ext: rec.ext || '', size: rec.size || 0 };
      _tracks = [meta];
      _trackIndex = 0;
      _audioKey = AUDIO_KEY;
      _audioName = meta.name;
      _saveSettings();
      _audioTrackId = AUDIO_ID;
      _setAudioSource(rec.data, rec.mime);
      _applyLoop();
      _refreshAudioUI();
      return true;
    }).catch(function () { return false; });
  }
  /* API cho Play Mode (09-play.js gọi khi tích hợp — xem báo cáo đợt 2):
     phát nhạc nền đã lưu (bài đang chọn trong playlist). Trả Promise<boolean>. */
  function playAmbient() {
    var el = _ensureAudioEl();
    if (!el) return Promise.resolve(false);
    if (_tracks.length) return _playCurrent();
    return loadAmbient().then(function (ok) { return ok ? _playCurrent() : false; });
  }
  function stopAmbient() {
    _cancelFade();
    if (!_audioEl) return false;
    try { _audioEl.pause(); _audioEl.currentTime = 0; } catch (e) {}
    return true;
  }
  function setAmbientVolume(v) {
    _volume = clamp(Number(v) || 0, 0, 1);
    _cancelFade();
    if (_audioEl) { try { _audioEl.volume = _volume; } catch (e) {} }
    _applySfxGain();
    _saveSettings();
    return _volume;
  }
  function getAmbientVolume() { return _volume; }
  function getAmbientKey() { return _audioKey; }
  function getAmbientName() { return _audioName; }
  function isAmbientPlaying() {
    try { return !!(_audioEl && !_audioEl.paused && !_audioEl.ended); } catch (e) { return false; }
  }
  /* Đợt 3 — mute toàn bộ (nhạc nền + SFX), lưu qua phiên. */
  function setMuted(m) {
    _muted = !!m;
    _cancelFade();
    if (_audioEl) { try { _audioEl.muted = _muted; } catch (e) {} }
    _applySfxGain();
    _saveSettings();
    _refreshAudioUI();
    return _muted;
  }
  function isMuted() { return _muted; }
  function toggleMute() { return setMuted(!_muted); }

  /* ---- Đợt 3 — SFX tổng hợp bằng WebAudio thật. ---- */
  function _audioCtxCtor() {
    try {
      if (typeof window !== 'undefined' && window) {
        return window.AudioContext || window.webkitAudioContext || null;
      }
    } catch (e) {}
    try {
      if (typeof AudioContext !== 'undefined') return AudioContext;
    } catch (e) {}
    return null;
  }
  function _ensureAudioCtx() {
    if (_audioCtx) return _audioCtx;
    var Ctor = _audioCtxCtor();
    if (!Ctor) return null;
    try {
      _audioCtx = new Ctor();
      _sfxGain = _audioCtx.createGain();
      _sfxGain.gain.value = _muted ? 0 : _volume;
      _sfxGain.connect(_audioCtx.destination);
    } catch (e) { _audioCtx = null; _sfxGain = null; return null; }
    return _audioCtx;
  }
  function _applySfxGain() {
    if (!_sfxGain) return;
    try { _sfxGain.gain.value = _muted ? 0 : _volume; } catch (e) {}
  }
  function _getNoiseBuffer(ctx) {
    if (_noiseBuf) return _noiseBuf;
    try {
      var len = (ctx && ctx.sampleRate) || 44100;
      var buf = ctx.createBuffer(1, len, len);
      var ch = buf.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      _noiseBuf = buf;
    } catch (e) { _noiseBuf = null; }
    return _noiseBuf;
  }
  /* Quét 1 AudioParam từ v0 tới v1 trong dur giây (exponential khi được,
     fallback linear/value). Không throw. */
  function _paramRamp(param, v0, v1, t0, dur) {
    try {
      if (param && typeof param.setValueAtTime === 'function') {
        param.setValueAtTime(v0, t0);
        if (v1 !== null && v1 !== undefined) {
          if (typeof param.exponentialRampToValueAtTime === 'function') {
            param.exponentialRampToValueAtTime(Math.max(0.0001, v1), t0 + dur);
          } else if (typeof param.linearRampToValueAtTime === 'function') {
            param.linearRampToValueAtTime(v1, t0 + dur);
          }
        }
      } else if (param) { param.value = v0; }
    } catch (e) {}
  }
  /* Lên lịch 1 node SFX tại thời điểm t0 (giây, theo ctx.currentTime).
     Trả true nếu lên lịch được. Đợt 4: destNode (optional) — đích nối
     gain node tới (mặc định master SFX _sfxGain); dùng cho SFX vị trí 3D
     (node -> gain khoảng cách -> panner -> master). */
  function _scheduleSfxNode(ctx, node, t0, destNode) {
    var dur = (Number(node.dur) > 0) ? Number(node.dur) : 0.2;
    var g = ctx.createGain();
    try {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, Number(node.gain) || 0.3), t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    } catch (e) {
      try { g.gain.value = Number(node.gain) || 0.3; } catch (e2) {}
    }
    try { g.connect(destNode || _sfxGain || ctx.destination); } catch (e) {}
    if (node.type === 'noise') {
      var buf = _getNoiseBuffer(ctx);
      if (!buf) return false;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      if (node.filterFreq) {
        var flt = ctx.createBiquadFilter();
        flt.type = 'bandpass';
        try { flt.Q.value = 1; } catch (e) {}
        _paramRamp(flt.frequency, node.filterFreq, node.filterFreqEnd || null, t0, dur);
        src.connect(flt);
        flt.connect(g);
      } else {
        src.connect(g);
      }
      src.start(t0);
      try { src.stop(t0 + dur + 0.05); } catch (e) {}
    } else {
      var osc = ctx.createOscillator();
      osc.type = node.wave || 'sine';
      _paramRamp(osc.frequency, (Number(node.freq) > 0) ? Number(node.freq) : 440, node.freqEnd || null, t0, dur);
      osc.connect(g);
      osc.start(t0);
      try { osc.stop(t0 + dur + 0.05); } catch (e) {}
    }
    return true;
  }
  /* Phát 1 SFX theo tên: 'skill'|'hit'|'hurt'|'die'|'pickup'.
     Trả true nếu đã lên lịch phát (kể cả khi đang mute — gain = 0),
     false khi không có WebAudio hoặc tên SFX lạ. */
  function audioPlay(kind) {
    var params = edAudioSynthParams(kind);
    if (!params) return false;
    var ctx = _ensureAudioCtx();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
    } catch (e) {}
    try {
      var t0 = (typeof ctx.currentTime === 'number') ? ctx.currentTime : 0;
      var ok = false;
      for (var i = 0; i < params.nodes.length; i++) {
        var n = params.nodes[i];
        var at = t0 + (Number(n.delay) || 0);
        if (_scheduleSfxNode(ctx, n, at)) ok = true;
      }
      return ok;
    } catch (e) { return false; }
  }

  /* ---- Đợt 4 — SFX theo vị trí 3D + nhạc theo ngữ cảnh. ---- */
  function _nowMs() {
    try { return Date.now(); } catch (e) { return 0; }
  }
  /* Trạng thái camera từ ED.Viewport.camera (THREE): {pos:[x,y,z],
     forward:[x,y,z]|null}. Hướng lấy bằng getWorldDirection khi có
     THREE.Vector3, fallback từ rotation.y (chỉ yaw). Không có camera
     -> null (khi đó SFX phát đều, gain 1, pan 0). Không throw. */
  function _cameraStateFromViewport() {
    try {
      if (typeof ED === 'undefined' || !ED.Viewport || !ED.Viewport.camera) return null;
      var cam = ED.Viewport.camera;
      if (!cam.position) return null;
      var pos = [(Number(cam.position.x) || 0), (Number(cam.position.y) || 0), (Number(cam.position.z) || 0)];
      var fwd = null;
      try {
        if (typeof cam.getWorldDirection === 'function' &&
            typeof THREE !== 'undefined' && THREE.Vector3) {
          var v = cam.getWorldDirection(new THREE.Vector3());
          fwd = [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
        }
      } catch (e) { fwd = null; }
      if (!fwd && cam.rotation && typeof cam.rotation.y === 'number') {
        var ry = cam.rotation.y;
        fwd = [-Math.sin(ry), 0, -Math.cos(ry)];
      }
      return { pos: pos, forward: fwd };
    } catch (e) { return null; }
  }
  /* Vị trí hero trong Play Mode ([x, y, z], y = _heroY nếu có) để phát
     SFX trúng đòn/nhặt đồ tại chỗ hero đứng. Không có Play -> null. */
  function _playHeroPos() {
    try {
      if (typeof ED !== 'undefined' && ED.Play && ED.Play._heroPos) {
        var hp = ED.Play._heroPos;
        return [(Number(hp[0]) || 0), (Number(ED.Play._heroY) || 0), (Number(hp[1]) || 0)];
      }
    } catch (e) {}
    return null;
  }
  /* Phát 1 SFX tại vị trí 3D sourcePos ([x,y,z] | [x,z] | {x,y,z}).
     cameraState {pos, forward} (optional) — bỏ qua thì tự lấy từ
     ED.Viewport.camera; không có camera thì phát đều như audioPlay().
     Gain theo khoảng cách (pannerGainFor, max SFX_MAX_DISTANCE = 30 ô):
     quá xa (gain <= 0.01) thì bỏ qua, trả false. Pan trái/phải theo
     hướng từ camera tới nguồn (panFor). Chuỗi node:
     SFX -> gain khoảng cách -> StereoPannerNode (fallback PannerNode 3D,
     rồi phát thường) -> master SFX. Trả true nếu đã lên lịch phát. */
  function playPositionalSfx(name, sourcePos, cameraState) {
    var params = edAudioSynthParams(name);
    if (!params) return false;
    var src = edAudioPosToVec(sourcePos);
    var cam = cameraState || _cameraStateFromViewport();
    var camPos = cam ? edAudioPosToVec(cam.pos) : null;
    var gain = 1, pan = 0;
    if (src && camPos) {
      var dx = src[0] - camPos[0], dy = src[1] - camPos[1], dz = src[2] - camPos[2];
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      gain = edAudioPannerGainFor(dist, SFX_MAX_DISTANCE);
      if (gain <= 0.01) return false;
      pan = (cam && cam.forward) ? edAudioPanFor(src, camPos, cam.forward) : 0;
    }
    var ctx = _ensureAudioCtx();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
    } catch (e) {}
    try {
      var t0 = (typeof ctx.currentTime === 'number') ? ctx.currentTime : 0;
      var dest = _sfxGain || ctx.destination;
      try {
        var gNode = ctx.createGain();
        gNode.gain.value = gain;
        if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
          var panNode = ctx.createStereoPanner();
          try { panNode.pan.value = pan; } catch (e2) {}
          gNode.connect(panNode);
          panNode.connect(dest);
        } else if (pan !== 0 && typeof ctx.createPanner === 'function' && src && camPos) {
          /* Fallback PannerNode 3D: vị trí nguồn tương đối camera.
             refDistance = max để PannerNode không giảm gain thêm lần nữa
             (gain khoảng cách đã tính ở gNode). */
          var pn = ctx.createPanner();
          try {
            pn.panningModel = 'equalpower';
            pn.distanceModel = 'linear';
            pn.maxDistance = SFX_MAX_DISTANCE;
            pn.refDistance = SFX_MAX_DISTANCE;
            if (pn.positionX) {
              pn.positionX.value = src[0] - camPos[0];
              pn.positionY.value = 0;
              pn.positionZ.value = src[2] - camPos[2];
            } else if (typeof pn.setPosition === 'function') {
              pn.setPosition(src[0] - camPos[0], 0, src[2] - camPos[2]);
            }
          } catch (e2) {}
          gNode.connect(pn);
          pn.connect(dest);
        } else {
          gNode.connect(dest);
        }
        dest = gNode;
      } catch (e) { dest = _sfxGain || ctx.destination; }
      var ok = false;
      for (var i = 0; i < params.nodes.length; i++) {
        var n = params.nodes[i];
        if (_scheduleSfxNode(ctx, n, t0 + (Number(n.delay) || 0), dest)) ok = true;
      }
      return ok;
    } catch (e) { return false; }
  }

  /* ---- Đợt 4 — nhạc theo ngữ cảnh (explore / combat). ---- */
  function _effectiveVolume() { return _muted ? 0 : _volume; }
  function _currentElVolume() {
    try {
      if (_audioEl && typeof _audioEl.volume === 'number') return _audioEl.volume;
    } catch (e) {}
    return _effectiveVolume();
  }
  function _cancelFade() {
    if (_fadeTimer !== null) {
      try { clearInterval(_fadeTimer); } catch (e) {}
      _fadeTimer = null;
    }
  }
  /* Fade âm lượng thẻ audio từ mức hiện tại tới target trong FADE_MS
     (1.5s), theo đúng plan của edAudioFadePlan. Xong thì gọi done().
     Không có thẻ audio thì gọi done() ngay. Hủy fade cũ trước khi chạy. */
  function _fadeAudioTo(target, done) {
    var el = _audioEl;
    _cancelFade();
    if (!el) {
      if (typeof done === 'function') { try { done(); } catch (e) {} }
      return;
    }
    var plan = edAudioFadePlan(_currentElVolume(), target, Math.max(1, Math.round(FADE_MS / FADE_STEP_MS)));
    var i = 0;
    _fadeTimer = setInterval(function () {
      i++;
      if (i >= plan.length) {
        _cancelFade();
        try { el.volume = plan[plan.length - 1]; } catch (e) {}
        if (typeof done === 'function') { try { done(); } catch (e) {} }
        return;
      }
      try { el.volume = plan[i]; } catch (e) {}
    }, FADE_STEP_MS);
  }
  /* Index track combat: id đã chọn trong panel, chưa chọn thì bài kế tiếp
     trong playlist (vòng lại). Không có track -> -1. */
  function _combatTrackIndex() {
    if (!_tracks.length) return -1;
    for (var i = 0; i < _tracks.length; i++) {
      if (_tracks[i].id === _combatTrackId) return i;
    }
    return edAudioPlaylistNextIndex(_trackIndex, _tracks.length);
  }
  /* Index track explore để quay về: id đã chọn trong panel, chưa chọn
     thì track đang phát lúc vào combat, fallback track 0. */
  function _exploreTrackIndexForReturn() {
    if (!_tracks.length) return -1;
    for (var i = 0; i < _tracks.length; i++) {
      if (_tracks[i].id === _exploreTrackId) return i;
    }
    if (_exploreTrackIndex >= 0 && _exploreTrackIndex < _tracks.length) return _exploreTrackIndex;
    return 0;
  }
  /* Đổi bài theo chế độ nhạc hiện tại (chỉ gọi khi chế độ vừa đổi).
     Đang phát: fade-out 1.5s -> đổi track -> fade-in về âm lượng hiệu
     dụng. Đang dừng: chỉ đổi _trackIndex (phát sau sẽ dùng bài đó).
     1 track hoặc trùng bài hiện tại thì không làm gì. */
  function _applyMusicMode() {
    if (!_tracks.length) return;
    var targetIdx = -1;
    if (_musicMode === 'combat') {
      _exploreTrackIndex = _trackIndex;
      targetIdx = _combatTrackIndex();
    } else {
      targetIdx = _exploreTrackIndexForReturn();
    }
    if (targetIdx < 0 || targetIdx >= _tracks.length || targetIdx === _trackIndex) return;
    if (!_audioEl) { _trackIndex = targetIdx; _saveSettings(); _refreshAudioUI(); return; }
    var paused = true;
    try { paused = !!_audioEl.paused; } catch (e) { paused = true; }
    if (paused) { _trackIndex = targetIdx; _saveSettings(); _refreshAudioUI(); return; }
    _fadeAudioTo(0, function () {
      playTrack(targetIdx).then(function () {
        _fadeAudioTo(_effectiveVolume(), null);
      });
    });
  }
  /* Ghi nhận 1 hoạt động combat (hero đánh/trúng đòn): cập nhật mốc
     thời gian + vào combat ngay nếu đang explore. Hook Play đợt 3 gọi
     hàm này; Play Mode cũng gọi qua setCombatMode(true) (xem wiring). */
  function _noteCombatActivity() {
    try { setCombatMode(true); } catch (e) {}
  }
  /* API cho coordinator nối vào Play Mode (09-play.js):
     setCombatMode(true) khi có quái trong tầm tấn công hoặc hero vừa
     đánh/trúng đòn; setCombatMode(false) mỗi frame khi không còn combat
     (tự về explore sau 5s yên lặng, xem edAudioCombatNext).
     force=true: về explore ngay (dùng khi thoát Play Mode).
     Trả chế độ nhạc hiện tại ('explore' | 'combat'). Không throw. */
  function setCombatMode(inCombat, force) {
    var next = null;
    try {
      next = edAudioCombatNext(_musicMode, !!inCombat, _nowMs(), _lastCombatAt, !!force);
    } catch (e) {
      next = { mode: _musicMode, lastHitMs: _lastCombatAt };
    }
    var changed = next.mode !== _musicMode;
    _lastCombatAt = next.lastHitMs;
    _musicMode = next.mode;
    _refreshMusicModeUI();
    if (changed && _contextMusic) _applyMusicMode();
    return _musicMode;
  }
  function getMusicMode() { return _musicMode; }
  function isContextMusic() { return _contextMusic; }
  /* Bật/tắt nhạc theo ngữ cảnh (mặc định bật, lưu localStorage).
     Tắt khi đang combat thì về explore ngay (đổi bài có fade). */
  function setContextMusic(on) {
    _contextMusic = !!on;
    _saveSettings();
    if (!_contextMusic && _musicMode === 'combat') {
      _musicMode = 'explore';
      _applyMusicMode();
    }
    _refreshMusicModeUI();
    return _contextMusic;
  }
  function toggleContextMusic() { return setContextMusic(!_contextMusic); }
  /* Hiển thị chế độ nhạc + toggle + 2 select chọn track (panel Export).
     Gọi sau mỗi lần đổi chế độ / playlist / settings. Không có panel
     thì không làm gì. */
  function _refreshMusicModeUI() {
    if (!_panel || typeof document === 'undefined') return;
    var modeEl = _panel.querySelector('#ed-music-mode');
    if (modeEl) {
      modeEl.textContent = 'Chế độ nhạc: ' + (_musicMode === 'combat' ? '⚔️ Chiến đấu' : '🌿 Khám phá') +
        (_contextMusic ? '' : ' (nhạc theo ngữ cảnh đã tắt)');
    }
    var ctxBtn = _panel.querySelector('#ed-music-ctx');
    if (ctxBtn) ctxBtn.textContent = '🎼 Nhạc theo ngữ cảnh: ' + (_contextMusic ? 'Bật' : 'Tắt');
    var exSel = _panel.querySelector('#ed-music-explore');
    var cbSel = _panel.querySelector('#ed-music-combat');
    if (exSel || cbSel) {
      var opts = [{ id: '', name: '(tự động)' }].concat(_tracks.map(function (t) {
        return { id: t.id, name: t.name };
      }));
      [[exSel, _exploreTrackId], [cbSel, _combatTrackId]].forEach(function (pair) {
        var sel = pair[0], cur = pair[1];
        if (!sel) return;
        while (sel.firstChild) sel.removeChild(sel.firstChild);
        opts.forEach(function (o) {
          var op = document.createElement('option');
          op.value = o.id;
          op.textContent = o.name;
          if (o.id === cur) op.selected = true;
          sel.appendChild(op);
        });
      });
    }
  }

  /* ---- Đợt 3 — hook SFX vào sự kiện Play (KHÔNG sửa 09-play.js). ----
     Cách làm: bọc (wrap) các hàm đã có trên object ED.Play — gọi hàm gốc
     y nguyên (this/arguments giữ nguyên, giá trị trả về giữ nguyên), rồi
     phát SFX theo kết quả. Mỗi hàm chỉ bọc 1 lần (cờ _edAudioHooked);
     unhookPlayEvents() khôi phục hàm gốc.
     - Play.attack() trả true (đánh trúng) -> 'hit' tại vị trí quái gần
       nhất (chụp TRƯỚC khi gọi gốc, vì gốc có thể giết/xoá quái) + ghi
       nhận combat (vào chế độ nhạc chiến đấu).
     - Play.castSkill() trả true (thi triển được) -> 'skill' tại vị trí
       hero + ghi nhận combat.
     - Play._killMonster(target) chạy xong -> 'die' tại vị trí quái chết.
     - Play._updateMonsterAttacks(): so HP hero trước/sau 1 frame — HP
       giảm mà còn sống -> 'hurt' tại vị trí hero + ghi nhận combat;
       HP về đầy + vị trí đổi về spawn (hồi sinh) -> 'die' (hero chết).
       Trong hàm này HP chỉ giảm do quái đánh hoặc hồi sinh, nên không
       nhầm với hồi máu.
     - Play._updateDrops(): số vật rơi giảm (hero đi qua nhặt) -> 'pickup'
       tại vị trí hero.
     Nếu ED.Play chưa có (load file lẻ) thì trả {ok:false} — SFX vẫn phát
     được bằng nút test trong panel Audio + API ED.Audio.play().
     Đợt 4: SFX hook nay phát qua playPositionalSfx (gain/pan theo vị trí
     thật so với camera); không có camera/vị trí thì phát đều như cũ. */
  function hookPlayEvents() {
    var hooked = [];
    try {
      if (typeof ED === 'undefined' || !ED.Play) {
        return { ok: false, hooked: hooked, reason: 'Chưa có ED.Play.' };
      }
      var P = ED.Play;
      /* Bọc 1 hàm đơn giản: gọi gốc rồi chạy after(result). Đã bọc rồi
         thì chỉ ghi nhận (idempotent — gọi hook lần 2 không bọc đôi). */
      function wrapSimple(name, after) {
        if (typeof P[name] !== 'function') return;
        if (P[name]._edAudioHooked) { hooked.push(name); return; }
        var orig = P[name];
        var w = function () {
          var r = orig.apply(this, arguments);
          try { after.call(this, r); } catch (e) {}
          return r;
        };
        w._edAudioHooked = true;
        _playOriginals[name] = orig;
        P[name] = w;
        hooked.push(name);
      }
      /* Đợt 4: attack/castSkill/_killMonster bọc riêng để chụp vị trí
         (quái/hero) TRƯỚC khi gọi gốc + phát SFX vị trí 3D + ghi nhận
         combat. Đã bọc rồi thì chỉ ghi nhận (idempotent). */
      if (typeof P.attack === 'function') {
        if (P.attack._edAudioHooked) { hooked.push('attack'); }
        else {
          var origAtk = P.attack;
          var wAtk = function () {
            var tgtPos = null;
            try {
              var m = (typeof P._nearestMonster === 'function') ? P._nearestMonster() : null;
              if (m && m.pos) tgtPos = [Number(m.pos[0]) || 0, Number(m.pos[1]) || 0, Number(m.pos[2]) || 0];
            } catch (e) {}
            var r = origAtk.apply(this, arguments);
            try {
              if (r === true) {
                _noteCombatActivity();
                if (tgtPos) playPositionalSfx('hit', tgtPos);
                else audioPlay('hit');
              }
            } catch (e) {}
            return r;
          };
          wAtk._edAudioHooked = true;
          _playOriginals.attack = origAtk;
          P.attack = wAtk;
          hooked.push('attack');
        }
      }
      if (typeof P.castSkill === 'function') {
        if (P.castSkill._edAudioHooked) { hooked.push('castSkill'); }
        else {
          var origSkill = P.castSkill;
          var wSkill = function () {
            var r = origSkill.apply(this, arguments);
            try {
              if (r === true) {
                _noteCombatActivity();
                playPositionalSfx('skill', _playHeroPos());
              }
            } catch (e) {}
            return r;
          };
          wSkill._edAudioHooked = true;
          _playOriginals.castSkill = origSkill;
          P.castSkill = wSkill;
          hooked.push('castSkill');
        }
      }
      if (typeof P._killMonster === 'function') {
        if (P._killMonster._edAudioHooked) { hooked.push('_killMonster'); }
        else {
          var origKill = P._killMonster;
          var wKill = function () {
            var tgt = (arguments && arguments.length) ? arguments[0] : null;
            var r = origKill.apply(this, arguments);
            try {
              var mp = (tgt && tgt.pos) ? [Number(tgt.pos[0]) || 0, Number(tgt.pos[1]) || 0, Number(tgt.pos[2]) || 0] : null;
              if (mp) playPositionalSfx('die', mp);
              else audioPlay('die');
            } catch (e) {}
            return r;
          };
          wKill._edAudioHooked = true;
          _playOriginals._killMonster = origKill;
          P._killMonster = wKill;
          hooked.push('_killMonster');
        }
      }
      if (typeof P._updateMonsterAttacks === 'function') {
        if (P._updateMonsterAttacks._edAudioHooked) {
          hooked.push('_updateMonsterAttacks');
        } else {
          var origMA = P._updateMonsterAttacks;
          var wMA = function () {
            var before = Number(P._heroHp) || 0;
            var max = Number(P._heroMaxHp) || 0;
            var beforePos = (P._heroPos && P._heroPos.slice) ? P._heroPos.slice() : null;
            var r = origMA.apply(this, arguments);
            try {
              var after = Number(P._heroHp) || 0;
              var afterPos = (P._heroPos && P._heroPos.slice) ? P._heroPos.slice() : null;
              var posChanged = !!(beforePos && afterPos &&
                (beforePos[0] !== afterPos[0] || beforePos[1] !== afterPos[1]));
              if (before > 0 && after === max && max > 0 && (before < max || posChanged)) {
                playPositionalSfx('die', _playHeroPos());
              } else if (after < before && after > 0) {
                _noteCombatActivity();
                playPositionalSfx('hurt', _playHeroPos());
              }
            } catch (e) {}
            return r;
          };
          wMA._edAudioHooked = true;
          _playOriginals._updateMonsterAttacks = origMA;
          P._updateMonsterAttacks = wMA;
          hooked.push('_updateMonsterAttacks');
        }
      }
      if (typeof P._updateDrops === 'function') {
        if (P._updateDrops._edAudioHooked) {
          hooked.push('_updateDrops');
        } else {
          var origDrops = P._updateDrops;
          var wDrops = function () {
            var before = (P._drops && P._drops.length) || 0;
            var r = origDrops.apply(this, arguments);
            try {
              var after = (P._drops && P._drops.length) || 0;
              if (after < before) playPositionalSfx('pickup', _playHeroPos());
            } catch (e) {}
            return r;
          };
          wDrops._edAudioHooked = true;
          _playOriginals._updateDrops = origDrops;
          P._updateDrops = wDrops;
          hooked.push('_updateDrops');
        }
      }
    } catch (e) {
      return { ok: false, hooked: hooked, reason: (e && e.message) ? e.message : 'hook lỗi.' };
    }
    _playHooked = hooked.length > 0 || _playHooked;
    return { ok: hooked.length > 0, hooked: hooked, reason: hooked.length ? '' : 'Không bọc được hàm Play nào.' };
  }
  function unhookPlayEvents() {
    try {
      if (typeof ED === 'undefined' || !ED.Play) return false;
      var P = ED.Play;
      var names = Object.keys(_playOriginals);
      if (!names.length) return false;
      names.forEach(function (name) {
        try { P[name] = _playOriginals[name]; } catch (e) {}
      });
      _playOriginals = {};
      _playHooked = false;
      return true;
    } catch (e) { return false; }
  }

  /* Namespace SFX — gán trong cùng IIFE để dùng chung closure. */
  ED.Audio = {
    synthParams: edAudioSynthParams,
    play: audioPlay,
    /* Đợt 4 — SFX vị trí 3D + nhạc theo ngữ cảnh. */
    playPositional: playPositionalSfx,
    setCombatMode: setCombatMode,
    getMusicMode: getMusicMode,
    setContextMusic: setContextMusic,
    isContextMusic: isContextMusic,
    toggleContextMusic: toggleContextMusic,
    kinds: SFX_KINDS.slice(),
    setMuted: setMuted,
    isMuted: isMuted,
    toggleMute: toggleMute,
    setVolume: setAmbientVolume,
    getVolume: getAmbientVolume,
    hookPlayEvents: hookPlayEvents,
    unhookPlayEvents: unhookPlayEvents,
    isHooked: function () { return _playHooked; }
  };

  /* ---- UI: panel riêng của module. Gắn vào #panel-right (cột Inspector,
     cuộn được, không phá layout) nếu có; chưa có thì fallback append body
     (cùng pattern 04-terrain.js / 05-environment.js). ---- */
  function init() {
    _loadSettings();
    /* Khôi phục nhạc đã lưu (không tự phát — trình duyệt chặn autoplay). */
    loadAmbient().catch(function () {});
    if (typeof document === 'undefined') return;
    /* CSS riêng của module (đợt 3) — inject bằng JS vì không được sửa
       editor.css. Chỉ inject 1 lần. */
    try {
      if (!document.getElementById('ed-export-style') && document.head) {
        var style = document.createElement('style');
        style.id = 'ed-export-style';
        style.textContent =
          '.ed-export-panel button{min-height:40px}' +
          '.ed-export-panel .ed-row{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}' +
          '.ed-export-panel .ed-row button{flex:1 1 auto}' +
          '.ed-export-panel .ed-pl-track{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border:1px solid #3a3f47;border-radius:6px;margin:4px 0;cursor:pointer;background:#23272e;color:#e5e7eb}' +
          '.ed-export-panel .ed-pl-track.on{border-color:#f5b942;background:#2c2f22}' +
          '.ed-export-panel .ed-pl-track span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
          '.ed-export-panel .ed-pl-track button{flex:0 0 auto;min-height:32px;min-width:32px;padding:0 8px}' +
          '.ed-export-panel select{min-height:40px;max-width:100%;background:#23272e;color:#e5e7eb;border:1px solid #3a3f47;border-radius:6px;padding:6px}' +
          '.ed-export-panel label{display:flex;flex-direction:column;gap:4px;flex:1 1 100%;font-size:13px;color:#cbd5e1}';
        document.head.appendChild(style);
      }
    } catch (e) {}
    var panel = document.getElementById('export-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'export-panel';
      panel.className = 'ed-export-panel';
      var right = document.getElementById('panel-right');
      if (right) right.appendChild(panel);
      else document.body.appendChild(panel);
    }
    _panel = panel;
    var glbReady = isGLBReady();
    var zipReady = isZipReady();
    var h = '<div class="ed-panel-title">📦 Xuất / Âm thanh</div>' +
      (glbReady
        ? '<div class="ed-row"><button id="ed-export-glb">⬇️ Xuất .GLB</button></div>' +
          '<div class="ed-hint">Xuất toàn bộ map (terrain + object) ra file .GLB (tên = tên project). Chỉ mesh + transform + material cơ bản; không gồm gizmo, lưới, FX hạt, animation.</div>'
        : '<div class="ed-hint">⚠️ Chưa tải được GLTFExporter (lib/GLTFExporter.js chưa có trong bản build) — nút Xuất .GLB sẽ hiện sau khi build lại.</div>') +
      '<div class="ed-row"><button id="ed-export-png">📷 Chụp ảnh PNG</button>' +
      '<button id="ed-export-gltf">⬇️ Xuất .gltf</button></div>' +
      '<div class="ed-hint">Chụp đúng khung viewport đang thấy (kể cả lưới/gizmo nếu đang hiện). Xuất .gltf tải 2 file: .gltf (JSON) + .bin.</div>' +
      (zipReady
        ? '<div class="ed-row"><button id="ed-export-zip">⬇️ Xuất project .ZIP</button></div>' +
          '<div class="ed-hint">Xuất toàn bộ project thành 1 file .ZIP: project.json + mapeditor.html + toàn bộ src/editor + lib + README.md. File nào không tải được sẽ bỏ qua và ghi vào THIEU_FILE.txt trong ZIP. Chỉ chạy khi mở editor qua HTTP (GitHub Pages / server), không chạy file://.</div>'
        : '<div class="ed-hint">⚠️ Chưa có JSZip trong bản build (lib/jszip.min.js) — nút Xuất project .ZIP sẽ hiện sau khi build lại.</div>') +
      '<div class="ed-row"><span id="ed-export-status" class="ed-hint">Chưa xuất.</span></div>' +
      '<div class="ed-panel-title">🎵 Nhạc nền</div>' +
      '<div class="ed-row"><span id="ed-ambient-name" class="ed-hint">Chưa có nhạc nền.</span></div>' +
      '<div class="ed-row"><button id="ed-ambient-import">🎵 Chọn nhạc nền (mp3/wav/ogg ≤ 10 MB)</button></div>' +
      '<div class="ed-row"><button id="ed-ambient-play">▶️ Phát</button>' +
      '<button id="ed-ambient-stop">⏹️ Dừng</button>' +
      '<button id="ed-ambient-del">🗑️ Xoá nhạc</button></div>' +
      '<div class="ed-row"><label>Âm lượng <span id="ed-ambient-vol-v">0.50</span></label>' +
      '<input id="ed-ambient-vol" type="range" min="0" max="1" step="0.05" value="0.5"></div>' +
      '<div class="ed-hint">Nhạc lưu trên máy (IndexedDB), mở lại editor vẫn còn. Phát loop trong lúc chỉnh map; khi vào Play Mode nhạc tự phát nếu đã bật wiring (xem báo cáo đợt 2).</div>' +
      '<div class="ed-panel-title">🎵 Playlist nhạc nền</div>' +
      '<div class="ed-row"><button id="ed-pl-prev">⏮ Bài trước</button>' +
      '<button id="ed-pl-next">Bài sau ⏭</button></div>' +
      '<div class="ed-row"><button id="ed-pl-add">➕ Thêm nhạc vào playlist</button>' +
      '<button id="ed-pl-del">🗑️ Xoá bài đang phát</button></div>' +
      '<div id="ed-playlist"></div>' +
      '<div class="ed-hint">Hết bài tự chuyển bài sau. Chỉ 1 bài thì lặp lại. Bấm tên bài để phát bài đó.</div>' +
      '<div class="ed-panel-title">🔊 Hiệu ứng âm thanh (SFX)</div>' +
      '<div class="ed-row"><button data-sfx="skill">✨ Skill</button>' +
      '<button data-sfx="hit">⚔️ Chém</button>' +
      '<button data-sfx="hurt">💢 Trúng đòn</button></div>' +
      '<div class="ed-row"><button data-sfx="die">💀 Chết</button>' +
      '<button data-sfx="pickup">📦 Nhặt đồ</button>' +
      '<button id="ed-audio-mute">🔊 Bật tiếng</button></div>' +
      '<div class="ed-hint">SFX tổng hợp bằng WebAudio, không cần file âm thanh. Khi vào Play Mode, SFX tự phát theo sự kiện (đánh/skill/trúng đòn/chết/nhặt) — bấm nút trên để thử nghe.</div>' +
      '<div class="ed-panel-title">🎼 Nhạc theo ngữ cảnh</div>' +
      '<div class="ed-row"><span id="ed-music-mode" class="ed-hint">Chế độ nhạc: 🌿 Khám phá</span></div>' +
      '<div class="ed-row"><button id="ed-music-ctx">🎼 Nhạc theo ngữ cảnh: Bật</button></div>' +
      '<div class="ed-row"><label>Nhạc khám phá<select id="ed-music-explore"></select></label></div>' +
      '<div class="ed-row"><label>Nhạc chiến đấu<select id="ed-music-combat"></select></label></div>' +
      '<div class="ed-hint">Vào combat (có quái gần hoặc vừa đánh/trúng đòn) thì chuyển sang track chiến đấu, hết combat 5 giây thì về track khám phá, chuyển mượt (fade 1.5 giây). Chưa chọn track thì combat dùng bài kế tiếp trong playlist; playlist chỉ 1 bài thì vẫn phát bài đó.</div>';
    panel.innerHTML = h;
    if (glbReady) {
      var glbBtn = panel.querySelector('#ed-export-glb');
      if (glbBtn) glbBtn.addEventListener('click', function () { exportGLB(); });
    }
    var pngBtn = panel.querySelector('#ed-export-png');
    if (pngBtn) pngBtn.addEventListener('click', function () { captureViewportPNG(); });
    var gltfBtn = panel.querySelector('#ed-export-gltf');
    if (gltfBtn) gltfBtn.addEventListener('click', function () { exportGLTF(); });
    /* Đợt 4 — xuất project ZIP (chỉ khi JSZip đã có trong build). */
    var zipBtn = panel.querySelector('#ed-export-zip');
    if (zipBtn) zipBtn.addEventListener('click', function () {
      zipBtn.disabled = true;
      exportProjectZip().then(function (ok) {
        zipBtn.disabled = false;
        if (!ok) toast('Chưa xuất được project .ZIP — xem trạng thái phía trên.');
      }).catch(function () { zipBtn.disabled = false; });
    });
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg';
    picker.style.display = 'none';
    panel.appendChild(picker);
    panel.querySelector('#ed-ambient-import').addEventListener('click', function () { picker.click(); });
    picker.addEventListener('change', function () {
      var f = picker.files && picker.files[0];
      picker.value = '';
      if (!f) return;
      importAmbient(f).catch(function (e) {
        toast(e && e.message ? e.message : 'Import nhạc thất bại.');
      });
    });
    panel.querySelector('#ed-ambient-play').addEventListener('click', function () {
      playAmbient().then(function (ok) {
        if (!ok) toast('Chưa phát được nhạc — thử chọn lại file nhạc.');
        else toast('Đang phát nhạc nền.');
      });
    });
    panel.querySelector('#ed-ambient-stop').addEventListener('click', function () {
      stopAmbient();
      toast('Đã dừng nhạc nền.');
    });
    panel.querySelector('#ed-ambient-del').addEventListener('click', function () {
      removeAmbient().catch(function (e) {
        toast(e && e.message ? e.message : 'Xoá nhạc thất bại.');
      });
    });
    var vol = panel.querySelector('#ed-ambient-vol');
    var volLab = panel.querySelector('#ed-ambient-vol-v');
    if (vol) {
      vol.value = String(_volume);
      vol.addEventListener('input', function () {
        var v = setAmbientVolume(Number(vol.value));
        if (volLab) volLab.textContent = v.toFixed(2);
      });
    }
    if (volLab) volLab.textContent = _volume.toFixed(2);
    /* Đợt 3 — playlist: thêm nhiều file cùng lúc. */
    var plPicker = document.createElement('input');
    plPicker.type = 'file';
    plPicker.accept = '.mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg';
    plPicker.multiple = true;
    plPicker.style.display = 'none';
    panel.appendChild(plPicker);
    var plAdd = panel.querySelector('#ed-pl-add');
    if (plAdd) plAdd.addEventListener('click', function () { plPicker.click(); });
    plPicker.addEventListener('change', function () {
      var files = plPicker.files ? Array.prototype.slice.call(plPicker.files) : [];
      plPicker.value = '';
      if (!files.length) return;
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain.then(function () {
          return addTrack(f).catch(function (e) {
            toast(e && e.message ? e.message : 'Thêm nhạc thất bại.');
          });
        });
      });
      chain.then(function () { _refreshAudioUI(); });
    });
    var plPrev = panel.querySelector('#ed-pl-prev');
    if (plPrev) plPrev.addEventListener('click', function () {
      nextTrackPrev(true);
    });
    var plNext = panel.querySelector('#ed-pl-next');
    if (plNext) plNext.addEventListener('click', function () { nextTrack(); });
    var plDel = panel.querySelector('#ed-pl-del');
    if (plDel) plDel.addEventListener('click', function () {
      var cur = getCurrentTrack();
      if (!cur) { toast('Playlist đang trống.'); return; }
      removeTrack(cur.id).catch(function (e) {
        toast(e && e.message ? e.message : 'Xoá bài thất bại.');
      });
    });
    /* Đợt 3 — nút thử SFX + mute toàn bộ. */
    var sfxBtns = panel.querySelectorAll('[data-sfx]');
    for (var si = 0; si < sfxBtns.length; si++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var kind = btn.getAttribute('data-sfx');
          if (!audioPlay(kind)) {
            toast('Chưa phát được âm thanh — bấm lại sau khi đã chạm vào trang (trình duyệt chặn autoplay).');
          }
        });
      })(sfxBtns[si]);
    }
    var muteBtn = panel.querySelector('#ed-audio-mute');
    if (muteBtn) muteBtn.addEventListener('click', function () {
      var m = toggleMute();
      toast(m ? '🔇 Đã tắt tiếng (nhạc + SFX).' : '🔊 Đã bật tiếng.');
    });
    /* Đợt 4 — nhạc theo ngữ cảnh: toggle + chọn track explore/combat. */
    var ctxBtn = panel.querySelector('#ed-music-ctx');
    if (ctxBtn) ctxBtn.addEventListener('click', function () {
      var on = toggleContextMusic();
      toast(on ? '🎼 Đã bật nhạc theo ngữ cảnh (khám phá / chiến đấu).' : '🎼 Đã tắt nhạc theo ngữ cảnh — chỉ phát playlist thường.');
    });
    var exSel = panel.querySelector('#ed-music-explore');
    if (exSel) exSel.addEventListener('change', function () {
      _exploreTrackId = exSel.value || null;
      _saveSettings();
      toast(_exploreTrackId ? '🎵 Đã chọn track nhạc khám phá.' : '🎵 Nhạc khám phá: tự động (bài đang phát lúc vào combat).');
    });
    var cbSel = panel.querySelector('#ed-music-combat');
    if (cbSel) cbSel.addEventListener('change', function () {
      _combatTrackId = cbSel.value || null;
      _saveSettings();
      toast(_combatTrackId ? '🎵 Đã chọn track nhạc chiến đấu.' : '🎵 Nhạc chiến đấu: tự động (bài kế tiếp trong playlist).');
    });
    _refreshAudioUI();
    _refreshMusicModeUI();
    /* Đợt 3 — hook SFX vào sự kiện Play (bọc ED.Play, không sửa 09-play.js).
       Không có ED.Play thì SFX vẫn dùng được bằng nút test + API. */
    try {
      var hook = hookPlayEvents();
      if (hook.ok) log('SFX đã hook vào Play Mode: ' + hook.hooked.join(', ') + '.');
      else log('SFX chưa hook vào Play Mode (' + (hook.reason || 'không rõ') + ') — vẫn thử được bằng nút SFX.');
    } catch (e) {}
  }

  /* Helper nhỏ cho nút "Bài trước" (tránh nhầm với nextTrack). */
  function nextTrackPrev(isPrev) {
    if (isPrev) return prevTrack();
    return nextTrack();
  }

  return {
    AUDIO_KEY: AUDIO_KEY, MAX_AUDIO_BYTES: MAX_AUDIO_BYTES,
    AUDIO_SETTINGS_KEY: AUDIO_SETTINGS_KEY,
    edExportValidateGLB: edExportValidateGLB,
    edExportFileName: edExportFileName,
    edExportValidateAudioFile: edExportValidateAudioFile,
    edExportAudioKey: edExportAudioKey,
    edExportParseAudioKey: edExportParseAudioKey,
    /* Đợt 3 — hàm thuần mới. */
    edExportBaseName: edExportBaseName,
    edExportBuildGltfName: edExportBuildGltfName,
    edExportBuildGltfBinName: edExportBuildGltfBinName,
    edExportBuildPngName: edExportBuildPngName,
    edExportIsPngDataUrl: edExportIsPngDataUrl,
    edExportValidateGltf: edExportValidateGltf,
    edExportGltfJsonText: edExportGltfJsonText,
    edExportDataUriToBytes: edExportDataUriToBytes,
    edExportTrackKey: edExportTrackKey,
    edExportParseTrackKey: edExportParseTrackKey,
    edExportMakeTrackId: edExportMakeTrackId,
    edAudioSynthParams: edAudioSynthParams,
    edAudioPlaylistNextIndex: edAudioPlaylistNextIndex,
    edAudioPlaylistPrevIndex: edAudioPlaylistPrevIndex,
    edAudioSettingsParse: edAudioSettingsParse,
    edAudioSettingsStringify: edAudioSettingsStringify,
    /* Đợt 4 — hàm thuần mới: ZIP + SFX 3D + nhạc ngữ cảnh. */
    edExportBuildZipName: edExportBuildZipName,
    edExportBuildZipFileList: edExportBuildZipFileList,
    collectZipEntries: collectZipEntries,
    edAudioPosToVec: edAudioPosToVec,
    edAudioPannerGainFor: edAudioPannerGainFor,
    edAudioPanFor: edAudioPanFor,
    edAudioCombatNext: edAudioCombatNext,
    edAudioFadePlan: edAudioFadePlan,
    buildZipName: edExportBuildZipName,
    buildZipFileList: edExportBuildZipFileList,
    zipFetchFiles: ZIP_FETCH_FILES.slice(),
    pannerGainFor: edAudioPannerGainFor,
    panFor: edAudioPanFor,
    posToVec: edAudioPosToVec,
    combatNext: edAudioCombatNext,
    fadePlan: edAudioFadePlan,
    COMBAT_GRACE_MS: COMBAT_GRACE_MS,
    FADE_MS: FADE_MS,
    SFX_MAX_DISTANCE: SFX_MAX_DISTANCE,
    buildGltfName: edExportBuildGltfName,
    buildGltfBinName: edExportBuildGltfBinName,
    buildPngName: edExportBuildPngName,
    validateGltf: edExportValidateGltf,
    gltfJsonText: edExportGltfJsonText,
    dataUriToBytes: edExportDataUriToBytes,
    isPngDataUrl: edExportIsPngDataUrl,
    isGLBReady: isGLBReady, buildExportScene: buildExportScene,
    exportGLB: exportGLB,
    exportGLTF: exportGLTF,
    captureViewportPNG: captureViewportPNG,
    importAmbient: importAmbient, removeAmbient: removeAmbient,
    loadAmbient: loadAmbient, playAmbient: playAmbient,
    stopAmbient: stopAmbient, setAmbientVolume: setAmbientVolume,
    getAmbientVolume: getAmbientVolume, getAmbientKey: getAmbientKey,
    getAmbientName: getAmbientName, isAmbientPlaying: isAmbientPlaying,
    /* Đợt 3 — playlist + mute + settings. */
    addTrack: addTrack, removeTrack: removeTrack,
    playTrack: playTrack, nextTrack: nextTrack, prevTrack: prevTrack,
    getPlaylist: getPlaylist, getCurrentTrack: getCurrentTrack,
    setMuted: setMuted, isMuted: isMuted, toggleMute: toggleMute,
    getAudioSettings: getAudioSettings,
    hookPlayEvents: hookPlayEvents, unhookPlayEvents: unhookPlayEvents,
    /* Đợt 4 — project ZIP + SFX 3D + nhạc theo ngữ cảnh. */
    isZipReady: isZipReady, exportProjectZip: exportProjectZip,
    playPositionalSfx: playPositionalSfx,
    getCameraState: _cameraStateFromViewport,
    setCombatMode: setCombatMode, getMusicMode: getMusicMode,
    setContextMusic: setContextMusic, isContextMusic: isContextMusic,
    toggleContextMusic: toggleContextMusic,
    init: init
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ED;
