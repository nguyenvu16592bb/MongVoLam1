/* Kiểm thử đo FPS + tự động giảm chất lượng (QUALITY-BEGIN) — không cần trình duyệt.
   Nạp src/01-data.js + src/02-world.js + src/02b-env.js + src/05-ui.js vào vm
   với stub THREE/document tối thiểu, rồi kiểm tra:
   - Quality.deviceCap / pixelRatioFor theo máy (điện thoại/máy bàn, các nấc).
   - Quality.sample: FPS < 28 trong 2 giây (4 mẫu) mới xuống nấc; FPS > 50
     trong 3 giây (6 mẫu) mới lên nấc; mẫu trung gian reset streak; tắt
     "Tự động" thì về ngay nấc 0.
   - applyLevel đổi đúng renderer pixelRatio + Env._particlesOff / Env._calm.
   - Game.loop ghi pill FPS "N fps · M draw" khi showFps bật.
   - Save cũ (không có showFps/autoQuality) vẫn giữ mặc định, không phá save.
   Chạy: node tools/test-quality.cjs */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + extra : '')); }
}

/* ---- stub tối thiểu (như tools/test-env.cjs) ---- */
class T { constructor() { this.x = 0; this.y = 0; this.z = 0; } }
const THREE = new Proxy({}, { get: () => T });
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
function mkEl() {
  const cls = new Set();
  return {
    textContent: '', innerHTML: '', style: {}, children: [],
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c),
      toggle: (c, force) => { if (force === undefined) { if (cls.has(c)) cls.delete(c); else cls.add(c); } else if (force) cls.add(c); else cls.delete(c); },
      contains: c => cls.has(c)
    },
    setAttribute() {}, appendChild(c) { this.children.push(c); }, addEventListener() {},
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    remove() {}, get firstChild() { return this.children[0]; },
    getContext: () => ({
      fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {},
      moveTo() {}, lineTo() {}, stroke() {}, measureText: () => ({ width: 100 }),
      createLinearGradient: () => ({ addColorStop() {} })
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 })
  };
}
const els = {};
const document = {
  querySelector: s => { if (!els[s]) els[s] = mkEl(); return els[s]; },
  querySelectorAll: () => [],
  getElementById: id => { if (!els[id]) els[id] = mkEl(); return els[id]; },
  createElement: () => mkEl(),
  body: {}
};
const win = {
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
  matchMedia: () => ({ matches: true }), /* điện thoại: cảm ứng */
  addEventListener() {}
};
const sandbox = {
  console, Math, JSON, setTimeout: () => 0, /* toast hẹn giờ: bỏ qua */
  THREE, localStorage, document, performance: { now: () => 0 },
  window: win, navigator: { hardwareConcurrency: 8 },
  requestAnimationFrame: () => {}
};
vm.createContext(sandbox);
const src = read('src/01-data.js') + '\n' + read('src/02-world.js') + '\n' + read('src/02b-env.js') + '\n' + read('src/05-ui.js') +
  '\n;globalThis.__T = { Env, State, Engine, SaveManager, Quality, Game, UI, SAVE_KEY };';
vm.runInContext(src, sandbox);
const { Env, State, SaveManager, Quality, Game, SAVE_KEY } = sandbox.__T;

/* ---- renderer giả ---- */
const fakeRenderer = {
  pr: null,
  setPixelRatio(v) { this.pr = v; },
  setSize() {},
  render() {},
  info: { render: { calls: 516 } }
};
Game.renderer = fakeRenderer;
State.settings.showFps = false;
State.settings.autoQuality = true;
Quality.level = 0; Quality._lowStreak = 0; Quality._highStreak = 0;

/* ---- 1. Cap pixelRatio theo máy ---- */
Quality.baseCap = Quality.deviceCap();
check('dien thoai cap pixelRatio = 1.25', Quality.baseCap === 1.25, String(Quality.baseCap));
check('nac 0 giu cap 1.25', Quality.pixelRatioFor(0) === 1.25, String(Quality.pixelRatioFor(0)));
check('nac 1 giam con 1.0 (1.25 x 0.8)', Quality.pixelRatioFor(1) === 1, String(Quality.pixelRatioFor(1)));
check('nac 3 khong xuong duoi 1.0', Quality.pixelRatioFor(3) === 1, String(Quality.pixelRatioFor(3)));
win.matchMedia = () => ({ matches: false });
win.devicePixelRatio = 2; win.innerWidth = 1920; win.innerHeight = 1080;
Quality.baseCap = Quality.deviceCap();
check('may ban cap pixelRatio = 1.75', Quality.baseCap === 1.75, String(Quality.baseCap));
check('may ban nac 1 = 1.4', Math.abs(Quality.pixelRatioFor(1) - 1.4) < 1e-9, String(Quality.pixelRatioFor(1)));
check('may ban nac 3 = 1.225', Math.abs(Quality.pixelRatioFor(3) - 1.225) < 1e-9, String(Quality.pixelRatioFor(3)));
win.matchMedia = () => ({ matches: true });
win.devicePixelRatio = 3; win.innerWidth = 390; win.innerHeight = 844;
Quality.baseCap = Quality.deviceCap();

/* ---- 2. Đổi nấc khi FPS thấp kéo dài ---- */
const feed = (fps, n) => { for (let i = 0; i < n; i++) Quality.sample(fps); };
Quality.applyLevel(0, true);
feed(20, 3);
check('FPS thap 3 mau (1.5s) chua xuong nac', Quality.level === 0, 'level=' + Quality.level);
feed(20, 1);
check('FPS thap 4 mau (2s) xuong nac 1', Quality.level === 1, 'level=' + Quality.level);
check('nac 1: pixelRatio renderer = 1.0', fakeRenderer.pr === 1, 'pr=' + fakeRenderer.pr);
check('nac 1: hat van bat', Env._particlesOff === false, String(Env._particlesOff));
check('nac 1: gio/nuoc van chay', Env._calm === false, String(Env._calm));
feed(20, 4);
check('FPS thap tiep xuong nac 2', Quality.level === 2, 'level=' + Quality.level);
check('nac 2: tat hat mua/tuyet', Env._particlesOff === true, String(Env._particlesOff));
check('nac 2: gio/nuoc van chay', Env._calm === false, String(Env._calm));
feed(20, 4);
check('FPS thap tiep xuong nac 3', Quality.level === 3, 'level=' + Quality.level);
check('nac 3: tinh gio/nuoc', Env._calm === true, String(Env._calm));
feed(20, 10);
check('FPS thap mai van dung o nac 3 (khong vuot)', Quality.level === 3, 'level=' + Quality.level);

/* ---- 3. Mẫu trung gian reset streak; hồi phục cần đủ 6 mẫu cao ---- */
feed(60, 5);
check('FPS cao 5 mau (2.5s) chua len nac', Quality.level === 3, 'level=' + Quality.level);
feed(40, 1); /* mẫu trung gian: reset cả 2 streak */
feed(60, 5);
check('mau 40 xen giua reset streak: van chua len nac', Quality.level === 3, 'level=' + Quality.level);
feed(60, 1);
check('FPS cao du 6 mau (3s) len nac 2', Quality.level === 2, 'level=' + Quality.level);
check('len nac 2: gio/nuoc chay lai', Env._calm === false, String(Env._calm));
check('len nac 2: hat van tat', Env._particlesOff === true, String(Env._particlesOff));

/* ---- 4. Tắt "Tự động" thì về ngay nấc 0 ---- */
State.settings.autoQuality = false;
Quality.sample(20);
check('tat tu dong: ve ngay nac 0', Quality.level === 0, 'level=' + Quality.level);
check('tat tu dong: hat bat lai', Env._particlesOff === false, String(Env._particlesOff));
check('tat tu dong: pixelRatio ve cap', fakeRenderer.pr === Quality.baseCap, 'pr=' + fakeRenderer.pr);
State.settings.autoQuality = true;

/* ---- 5. Pill FPS: ẩn mặc định, hiện khi bật + ghi draw call ---- */
Quality.applyFpsVisibility();
check('mac dinh an pill FPS', els['#fps'].classList.contains('hidden'), 'hidden=' + els['#fps'].classList.contains('hidden'));
State.settings.showFps = true;
Quality.applyFpsVisibility();
check('bat showFps: hien pill FPS', !els['#fps'].classList.contains('hidden'));
Game.mode = 'world';
Game.last = 0; Game.fpsAcc = 0; Game.fpsFrames = 0;
let t = 16;
for (let i = 0; i < 12; i++) { t += 100; Game.loop(t); }
check('Game.loop ghi pill FPS kem draw call', /2\d fps · 516 draw/.test(els['#fps'].textContent), els['#fps'].textContent);
State.settings.showFps = false;
Quality.applyFpsVisibility();

/* ---- 6. Save cũ không có 2 setting mới -> giữ mặc định ---- */
localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 2, settings: { muted: true } }));
SaveManager.load();
check('save cu: showFps mac dinh false', State.settings.showFps === false, String(State.settings.showFps));
check('save cu: autoQuality mac dinh true', State.settings.autoQuality === true, String(State.settings.autoQuality));
check('save cu: setting cu (muted) van giu', State.settings.muted === true, String(State.settings.muted));
localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 2, settings: { showFps: true, autoQuality: false } }));
SaveManager.load();
check('save moi: showFps=true duoc giu', State.settings.showFps === true, String(State.settings.showFps));
check('save moi: autoQuality=false duoc giu', State.settings.autoQuality === false, String(State.settings.autoQuality));

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
