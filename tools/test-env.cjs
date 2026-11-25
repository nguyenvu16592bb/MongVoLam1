/* Kiểm thử môi trường động (Nhiệm vụ 1 + 2) — không cần trình duyệt.
   Nạp src/01-data.js + src/02-world.js + src/02b-env.js vào vm với stub
   THREE/document/localStorage tối thiểu, rồi kiểm tra logic thuần:
   mùa, bầu trời, thời tiết, đồng hồ, isWalkable mở rộng, cổng dịch
   chuyển, save/load (kể cả save cũ không có field mới).
   Chạy: node tools/test-env.cjs */
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

/* ---- stub tối thiểu ---- */
class T { constructor() { this.x = 0; this.y = 0; this.z = 0; } }
const THREE = new Proxy({}, { get: () => T });
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
function mkEl() {
  return {
    textContent: '', innerHTML: '', style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, appendChild() {}, addEventListener() {},
    getContext: () => ({
      fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, arc() {},
      moveTo() {}, lineTo() {}, stroke() {},
      createLinearGradient: () => ({ addColorStop() {} })
    })
  };
}
const els = {};
const document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: id => { if (!els[id]) els[id] = mkEl(); return els[id]; },
  createElement: () => mkEl(),
  body: {}
};
const sandbox = {
  console, Math, JSON, setTimeout: fn => { fn(); return 0; },
  THREE, localStorage, document,
  window: {}, Game: { mode: 'world' }
};
vm.createContext(sandbox);
const src = read('src/01-data.js') + '\n' + read('src/02-world.js') + '\n' + read('src/02b-env.js') +
  '\n;globalThis.__T = { Env, State, Engine, SaveManager, PlayerController };';
vm.runInContext(src, sandbox);
const { Env, State, Engine, SaveManager, PlayerController } = sandbox.__T;

/* ---- 1. Mùa: 30 ngày/mùa, lặp 120 ngày ---- */
check('mua ngay 1 = xuan', Env.seasonForDay(1) === 'xuan', Env.seasonForDay(1));
check('mua ngay 30 = xuan', Env.seasonForDay(30) === 'xuan');
check('mua ngay 31 = ha', Env.seasonForDay(31) === 'ha');
check('mua ngay 60 = ha', Env.seasonForDay(60) === 'ha');
check('mua ngay 61 = thu', Env.seasonForDay(61) === 'thu');
check('mua ngay 90 = thu', Env.seasonForDay(90) === 'thu');
check('mua ngay 91 = dong', Env.seasonForDay(91) === 'dong');
check('mua ngay 120 = dong', Env.seasonForDay(120) === 'dong');
check('mua ngay 121 lap ve xuan', Env.seasonForDay(121) === 'xuan');

/* ---- 2. Bau troi theo gio ---- */
const noon = Env.skyAt(12), night = Env.skyAt(0), dawn = Env.skyAt(6.5);
check('trua sang (darkness ~0, hemi cao)', noon.darkness < 0.05 && noon.hemi > 0.8, JSON.stringify(noon));
check('dem toi (darkness > 0.6, dir thap)', night.darkness > 0.6 && night.dir < 0.2, JSON.stringify(night));
check('binh minh khac trua (mau troi doi)', dawn.sky !== noon.sky, dawn.sky + ' vs ' + noon.sky);
check('hoang hon toi dan (darkness tang 17h -> 20h)', Env.skyAt(17.5).darkness < Env.skyAt(20).darkness);

/* ---- 3. Thoi tiet theo mua (xac dinh voi r cho truoc) ---- */
check('dong r=0 -> tuyet', Env.pickWeather('dong', 0) === 'tuyet');
check('dong r=0.5 -> nang', Env.pickWeather('dong', 0.5) === 'nang');
check('dong khong co mua (r=0.9 -> suong mu)', Env.pickWeather('dong', 0.9) === 'suongmu');
check('ha r=0.5 -> nang gat', Env.pickWeather('ha', 0.5) === 'nanggat');
check('xuan r=0.9 -> suong mu', Env.pickWeather('xuan', 0.9) === 'suongmu');
check('thu khong co tuyet', !Object.keys(Env.WEATHER_WEIGHTS.thu).includes('tuyet') && Env.pickWeather('thu', 0) === 'nang');

/* ---- 4. Dong ho: 75 giay that = 1 gio game ---- */
State.settings.clockSpeed = 1;
State.worldClock.hour = 8; State.worldClock.day = 1; State.worldClock.season = 'xuan';
Env.tickClock(75);
check('75s -> +1 gio game', Math.abs(State.worldClock.hour - 9) < 1e-9, String(State.worldClock.hour));
Env.tickClock(75 * 15);
check('them 15 gio -> sang ngay 2', State.worldClock.day === 2 && Math.abs(State.worldClock.hour) < 1e-9,
  'day=' + State.worldClock.day + ' hour=' + State.worldClock.hour);
State.worldClock.hour = 23; State.worldClock.day = 30; State.worldClock.season = 'xuan';
const changed = Env.tickClock(75 * 2);
check('qua ngay 30 -> ngay 31 doi sang ha', changed === 'ha' && State.worldClock.day === 31,
  'season=' + changed + ' day=' + State.worldClock.day);
State.settings.clockSpeed = 0;
const h0 = State.worldClock.hour;
Env.tickClock(1000);
check('clockSpeed 0 -> dong ho dung', State.worldClock.hour === h0);
State.settings.clockSpeed = 1;

/* ---- 5. Doi thoi tiet ---- */
State.weather.kind = 'nang'; State.weather.remain = 1;
const kind = Env.advanceWeather(2);
check('het timer -> doi thoi tiet + remain 150-300s', kind && State.weather.remain >= 150 && State.weather.remain <= 300,
  kind + ' remain=' + State.weather.remain);
State.weather.remain = 100;
check('chua het timer -> khong doi', Env.advanceWeather(2) === null);

/* ---- 6. isWalkable mo rong (giu luat cau khu cu) ---- */
check('quang truong cu di duoc (0,0)', Engine.isWalkable(0, 0) === true);
check('ho sen cu chan (0,10)', Engine.isWalkable(0, 10) === false);
check('cau ho sen di duoc (5.5,10)', Engine.isWalkable(5.5, 10) === true);
check('cau bo dong di duoc (14,3)', Engine.isWalkable(14, 3) === true);
check('bo dong ngoai cau chan (14,10)', Engine.isWalkable(14, 10) === false);
check('ruong tay di duoc (-30,5)', Engine.isWalkable(-30, 5) === true);
check('khu dan cu bac di duoc (-28,-20)', Engine.isWalkable(-28, -20) === true);
check('khu dan cu dong di duoc (40,10)', Engine.isWalkable(40, 10) === true);
check('ruong nam di duoc (0,35)', Engine.isWalkable(0, 35) === true);
check('ngoai bien x=-46 chan', Engine.isWalkable(-46, 0) === false);
check('ngoai bien x=49 chan', Engine.isWalkable(49, 0) === false);
check('ngoai bien z=-41 chan', Engine.isWalkable(0, -41) === false);
check('ngoai bien z=45 chan', Engine.isWalkable(0, 45) === false);
check('NPC cu van dung duoc (cho -5.2,-3.2)', Engine.isWalkable(-5.2, -3.2) === true);
check('NPC cu van dung duoc (dai -12,-6)', Engine.isWalkable(-12, -6) === true);

/* ---- 7. Cong dich chuyen: di vong 3 cong, dich den di duoc ---- */
Env.GATES.forEach(g => {
  check('dich cua ' + g.id + ' di duoc', Engine.isWalkable(g.dx, g.dz) === true, g.dx + ',' + g.dz);
});
PlayerController.entity = { mesh: { position: { x: -16.2, z: 0 } } };
Engine.camera = { position: { set() {} }, lookAt() {} };
const gateA = Env.gateNear(-16.2, 0, 2.2);
check('gan Cong Son tim dung cong', gateA && gateA.id === 'cong-son');
Env.teleportToGate(gateA);
check('Cong Son -> Gieng Co (6.8,14.5)', PlayerController.entity.mesh.position.x === 6.8 && PlayerController.entity.mesh.position.z === 14.5,
  JSON.stringify(PlayerController.entity.mesh.position));
Env.teleportFromNearest();
check('Gieng Co -> Cong Lang (-28,-18.2)', PlayerController.entity.mesh.position.x === -28 && PlayerController.entity.mesh.position.z === -18.2,
  JSON.stringify(PlayerController.entity.mesh.position));
Env.teleportFromNearest();
check('Cong Lang -> ve Cong Son (-14.2,0)', PlayerController.entity.mesh.position.x === -14.2 && PlayerController.entity.mesh.position.z === 0,
  JSON.stringify(PlayerController.entity.mesh.position));
check('diem dap nam trong ban kinh kich hoat cua cong dich (<=2.2)', Env.GATES.every(g => Math.hypot(g.dx - g.x, g.dz - g.z) <= 2.2),
  JSON.stringify(Env.GATES.map(g => [g.id, Math.hypot(g.dx - g.x, g.dz - g.z)])));
check('xa cong -> gateNear null', Env.gateNear(0, 0, 2.2) === null);

/* ---- 8. Update smoke (khong crash, dong ho chay, HUD cap nhat) ---- */
Env._built = true;
State.worldClock.hour = 10; State.worldClock.day = 5; State.worldClock.season = 'xuan';
State.settings.weatherFx = true; State.weather.kind = 'mua'; State.weather.remain = 999;
let threw = null;
try { Env.update(1, 100); } catch (e) { threw = e; }
check('Env.update(1s) khong crash', threw === null, threw && threw.message);
check('update chay dong ho (+1/75 gio)', Math.abs(State.worldClock.hour - (10 + 1 / 75)) < 1e-9, String(State.worldClock.hour));
check('HUD pill co ngay + mua', /Ngày 5/.test(els['env-pill'].textContent), els['env-pill'].textContent);

/* ---- 9. Save/load ---- */
State.worldClock.hour = 15.5; State.worldClock.day = 42; State.worldClock.season = 'ha';
State.weather.kind = 'tuyet'; State.weather.remain = 200;
State.settings.clockSpeed = 2; State.settings.weatherFx = false;
SaveManager.save();
State.worldClock.hour = 0; State.worldClock.day = 1;
State.weather.kind = 'nang'; State.settings.clockSpeed = 1; State.settings.weatherFx = true;
SaveManager.load();
check('load khoi phuc gio/ngay/mua', State.worldClock.hour === 15.5 && State.worldClock.day === 42 && State.worldClock.season === 'ha',
  JSON.stringify(State.worldClock));
check('load khoi phuc thoi tiet', State.weather.kind === 'tuyet' && State.weather.remain === 200, JSON.stringify(State.weather));
check('load khoi phuc settings moi', State.settings.clockSpeed === 2 && State.settings.weatherFx === false,
  JSON.stringify(State.settings));
/* Save cu (khong co worldClock/weather) -> giu mac dinh, khong crash. */
State.worldClock.hour = 8; State.worldClock.day = 1; State.worldClock.season = 'xuan';
State.weather.kind = 'nang';
const raw = JSON.parse(store.get('mongvolam_soha_v1'));
delete raw.worldClock; delete raw.weather;
store.set('mongvolam_soha_v1', JSON.stringify(raw));
let threw2 = null;
try { SaveManager.load(); } catch (e) { threw2 = e; }
check('save cu khong co field moi van load duoc', threw2 === null && State.worldClock.hour === 8 && State.weather.kind === 'nang',
  threw2 && threw2.message);

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
