/* ============================================================================
   PHẦN 4 — GIAO DIỆN HỢP NHẤT, ĐIỀU KHIỂN, KHỞI CHẠY
   ========================================================================== */

const Game = {
  mode: 'world',
  renderer: null,
  last: 0,
  fpsAcc: 0,
  fpsFrames: 0,
  booted: false,

  createRenderer() {
    const canvas = $('#three-canvas');
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    Engine.renderer = r;
    return r;
  },

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.renderer) this.renderer.setSize(w, h, false);
    Engine.resize();
    if (Battle.camera) {
      Battle.camera.aspect = w / h;
      Battle.camera.updateProjectionMatrix();
    }
    if (Info.openFlag) Info.resize();
  },

  loop(now) {
    requestAnimationFrame(t => Game.loop(t));
    if (!this.last) this.last = now;
    const dt = Math.min(.05, (now - this.last) / 1000);
    this.last = now;
    const time = now * .001;

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= .5) {
      const fps = Math.round(this.fpsFrames / this.fpsAcc);
      const el = $('#fps');
      if (el) el.textContent = fps + ' fps';
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    if (this.mode === 'world') World.update(dt, time);
    else if (this.mode === 'battle') Battle.update(dt);

    if (this.mode !== 'info') {
      if (this.mode === 'battle' && Battle.scene) this.renderer.render(Battle.scene, Battle.camera);
      else this.renderer.render(Engine.scene, Engine.camera);
    }
  },

  async boot() {
    const bar = $('#load-bar'), tip = $('#load-tip');
    const step = (p, text) => new Promise(res => {
      if (bar) bar.style.width = p + '%';
      if (tip) tip.textContent = text;
      setTimeout(res, 190);
    });

    SaveManager.load();
    Sfx.muted = !!State.settings.muted;

    await step(12, 'Khởi tạo Soha Engine…');
    UI.buildWorldHUD();
    UI.buildBattleHUD();
    UI.bindGlobal();

    try {
      this.createRenderer();
    } catch (e) {
      if (tip) tip.innerHTML = 'Trình duyệt không hỗ trợ WebGL. Hãy mở bằng Chrome/Edge mới nhất.';
      console.error(e);
      return;
    }

    await step(32, 'Dựng Biện Kinh Thành…');
    Engine.createWorld();

    await step(54, 'Triệu hồi giang hồ nhân sĩ…');
    CharacterManager.initPopulation();
    PlayerController.initInput();

    await step(74, 'Nạp bí kíp võ học & chiến trường…');
    SKILLS.forEach(s => { s.lvl = s.lvl || 10; s.currentCd = 0; });
    UI.syncWorld();

    await step(88, 'Kết nối hồ sơ nhân vật…');
    Info.build();
    PixiFX.init();

    await step(100, 'Hoàn tất — chào mừng đại hiệp!');
    World.enter(true);
    UI.showScreen('world');
    this.booted = true;
    this.last = performance.now();
    requestAnimationFrame(t => this.loop(t));

    setTimeout(() => {
      const el = $('#loading');
      if (el) { el.classList.add('done'); setTimeout(() => el.remove(), 700); }
      UI.toast('Chào mừng đại hiệp đến Biện Kinh Thành!', 'green');
      setTimeout(() => UI.toast('Nhấn <b>C</b> mở hồ sơ · <b>B</b> vào chiến trường · <b>WASD</b> di chuyển', 'gold'), 1400);
    }, 420);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => SaveManager.save());
  }
};

/* ============================== MINI-GAME TẠI CHỖ ==============================
   INTERACT-BEGIN — Nhiệm vụ 4: câu cá (thanh timing), hái sen (QTE),
   cờ Caro 9×9 với Lão Kỳ Thánh. Logic thắng/thua/thưởng nằm ở Interact/
   Gomoku (src/01-data.js); đây chỉ là điều khiển modal + thanh chạy.
   Timer dừng khi đóng modal (UI.closeModal gọi stopTimers). */
const MiniGames = {
  fish: { timer: null, pos: 0, dir: 1 },
  lotus: { timer: null, pos: 0, dir: 1 },
  chess: { board: null, over: false, status: '' },

  stopTimers() {
    if (this.fish.timer) { clearInterval(this.fish.timer); this.fish.timer = null; }
    if (this.lotus.timer) { clearInterval(this.lotus.timer); this.lotus.timer = null; }
  },

  _startBar(which, speed, markerId) {
    this.stopTimers();
    const st = this[which];
    st.pos = 0; st.dir = 1;
    st.timer = setInterval(() => {
      st.pos += st.dir * speed;
      if (st.pos >= 100) { st.pos = 100; st.dir = -1; }
      if (st.pos <= 0) { st.pos = 0; st.dir = 1; }
      const m = document.getElementById(markerId);
      if (m) m.style.left = st.pos + '%';
    }, 30);
  },

  startFishing() { this._startBar('fish', 2.4, 'fish-marker'); },
  startLotus() { this._startBar('lotus', 3.0, 'lotus-marker'); },

  fishPull() {
    const res = Interact.fishResolve(this.fish.pos);
    this.stopTimers();
    if (!res.hit) {
      if (typeof Emote !== 'undefined') Emote.player('😢');
      UI.openModal('fish-result', { hit: false });
      return;
    }
    const name = Interact.applyFish(res);
    if (typeof Emote !== 'undefined') Emote.player('😊');
    Sfx.win();
    UI.openModal('fish-result', { hit: true, rarity: res.rarity, name });
  },

  lotusPick() {
    const res = Interact.lotusResolve(this.lotus.pos);
    this.stopTimers();
    if (!res.hit) {
      UI.openModal('lotus-result', { hit: false });
      return;
    }
    const name = Interact.applyLotus(res);
    if (typeof Emote !== 'undefined') Emote.player('😊');
    Sfx.win();
    UI.openModal('lotus-result', { hit: true, name });
  },

  newChess() {
    this.chess.board = Gomoku.newBoard();
    this.chess.over = false;
    this.chess.status = 'Lượt của thiếu hiệp — xếp 5 quân một hàng (ngang/dọc/chéo) để thắng!';
  },

  chessBoardHTML() {
    const b = this.chess.board || Gomoku.newBoard();
    let html = '';
    for (let y = 0; y < Gomoku.SIZE; y++) {
      for (let x = 0; x < Gomoku.SIZE; x++) {
        const v = b[y][x];
        html += '<button class="chess-cell' + (v === 1 ? ' p' : v === 2 ? ' ai' : '') +
          '" data-act="chess-cell" data-x="' + x + '" data-y="' + y + '">' +
          (v === 1 ? '●' : v === 2 ? '○' : '') + '</button>';
      }
    }
    return html;
  },

  renderChess() {
    const boardEl = document.getElementById('chess-board');
    if (boardEl) boardEl.innerHTML = this.chessBoardHTML();
    const stEl = document.getElementById('chess-status');
    if (stEl) stEl.textContent = this.chess.status;
  },

  chessMove(x, y) {
    const c = this.chess;
    if (c.over || !c.board || !Gomoku.inBounds(x, y) || c.board[y][x]) return;
    c.board[y][x] = Gomoku.P;
    if (Gomoku.checkWin(c.board, x, y, Gomoku.P)) {
      c.over = true;
      const rw = Interact.claimChessReward();
      c.status = rw.rewarded
        ? '🎉 Thắng Lão Kỳ Thánh! +1.000 bạc +100 EXP (thưởng thắng cờ hôm nay).'
        : '🎉 Thắng Lão Kỳ Thánh! (thưởng hôm nay đã nhận rồi — ván này chơi vui thôi nhé!)';
      if (typeof Emote !== 'undefined') Emote.player('😊');
      Sfx.win();
      this.renderChess();
      return;
    }
    if (Gomoku.isFull(c.board)) {
      c.over = true;
      c.status = '🤝 Hòa! Bàn cờ đã đầy — đấu lại ván mới nhé!';
      this.renderChess();
      return;
    }
    const mv = Gomoku.aiMove(c.board);
    if (mv) {
      c.board[mv.y][mv.x] = Gomoku.AI;
      if (Gomoku.checkWin(c.board, mv.x, mv.y, Gomoku.AI)) {
        c.over = true;
        c.status = '😢 Lão Kỳ Thánh thắng ván này — không mất gì, đấu lại nhé!';
        if (typeof Emote !== 'undefined') Emote.player('😢');
        Sfx.lose();
        this.renderChess();
        return;
      }
      if (Gomoku.isFull(c.board)) {
        c.over = true;
        c.status = '🤝 Hòa! Bàn cờ đã đầy — đấu lại ván mới nhé!';
      }
    }
    this.renderChess();
  },

  chessResign() {
    const c = this.chess;
    if (c.over) return;
    c.over = true;
    c.status = '🏳️ Thiếu hiệp đã đầu hàng — Lão Kỳ Thánh thắng ván này (không mất gì).';
    if (typeof Emote !== 'undefined') Emote.player('😢');
    this.renderChess();
  }
};

/* ============================== HUD ============================== */
Object.assign(UI, {
  buildWorldHUD() {
    const hud = $('#hud-world');
    hud.innerHTML = `
      <div class="hud-top">
        <div class="hud-left">
          <div class="crest" data-act="open-info" title="Hồ sơ nhân vật (C)">
            <span class="lbl">Cấp</span><b id="w-level">3</b>
          </div>
          <div class="idblock">
            <div class="nameplate-top"><span id="w-name">Song Ma Quyền Phái</span></div>
            <div class="expbar"><i id="w-expfill"></i><span id="w-exptext">64/160</span></div>
            <div class="minibars">
              <div class="mini hp"><i id="w-hpfill"></i><span id="w-hptext"></span></div>
              <div class="mini mp"><i id="w-mpfill"></i><span id="w-mptext"></span></div>
            </div>
          </div>
        </div>
        <div class="hud-right">
          <div class="pill" data-act="open-bag">🎒 <b id="w-cap">13/30</b></div>
          <div class="hud-res">
            <div class="pill gold" data-act="open-shop">🪙 <b id="w-gold">455</b></div>
            <div class="pill silver" data-act="open-shop">⚪ <b id="w-silver">40.932</b></div>
          </div>
        </div>
      </div>

      <div class="world-tools">
        <span class="fps" id="fps">60 fps</span>
        <span class="env-pill" id="env-pill" title="Giờ game · thời tiết · mùa">☀️ Nắng · ☀️ 08:00 · Ngày 1 · Mùa Xuân</span>
        <button class="mini-btn" data-act="open-battle">⚔️ Tỷ Võ Đài</button>
        <button class="mini-btn" data-act="open-skills">🐉 Tuyệt học</button>
      </div>

      <button class="teleport-btn hidden" id="teleport-btn" data-act="teleport">🚪 Dịch chuyển</button>
      <button class="interact-btn hidden" id="interact-btn" data-act="interact-near">✨ Tương tác</button>

      <div class="quest-track" data-act="open-quests" title="Mở nhiệm vụ">
        <b><span>📜 Hành Tẩu Giang Hồ</span><span class="muted">[xem]</span></b>
        <div class="qt-desc" id="w-quest-desc">• Chưa có nhiệm vụ</div>
        <div class="qt-bar"><i id="w-quest-fill" style="width:0%"></i></div>
      </div>

      <div class="side-dock">
        <button class="side-btn" data-act="open-info" title="Hồ sơ nhân vật (C)">🥋</button>
        <button class="side-btn" data-act="open-recruit" title="Tham Bái Chiêu Mộ">⛩️</button>
        <button class="side-btn" data-act="open-event" title="Sự Kiện">📅</button>
        <button class="side-btn" data-act="open-districts" title="Bản Đồ Khu Vực">🗺️</button>
        <button class="side-btn" data-act="open-skills" title="Tàng Kinh Các">🐉</button>
        <button class="side-btn" data-act="open-mail" title="Thư tín">✉️<i class="dot"></i></button>
        <button class="side-btn" data-act="open-chat" title="Kênh thế giới">💬</button>
        <button class="side-btn" data-act="open-settings" title="Cài đặt">⚙️</button>
      </div>

      <div class="dock">
        <button class="dock-btn" data-act="open-quests"><div class="ic gold">📜</div><span class="lbl">H. Tẩu</span></button>
        <button class="dock-btn" data-act="open-info"><div class="ic red">🥋</div><span class="lbl">M. Phái</span></button>
        <button class="dock-btn" data-act="open-battle"><div class="ic purple">⚔️</div><span class="lbl">H. Động</span></button>
        <button class="dock-btn" data-act="open-events"><div class="ic amber">🎉</div><span class="lbl">S. Kiện</span></button>
        <button class="dock-btn" data-act="open-shop"><div class="ic red">🏮</div><span class="lbl">Chợ</span></button>
        <button class="dock-btn" data-act="open-guild"><div class="ic blue">🚩</div><span class="lbl">B. Hội</span></button>
      </div>

      <div class="hint">WASD / chạm đất để di chuyển<br>C hồ sơ · B chiến trường · Q nhiệm vụ</div>`;
  },

  buildBattleHUD() {
    const hud = $('#hud-battle');
    hud.innerHTML = `
      <div class="bt-top">
        <div class="bt-left">
          <div class="bt-idrow">
            <div class="crest" data-act="open-info" title="Hồ sơ đội hình">
              <span class="lbl">Cấp</span><b id="b-level">400</b>
            </div>
            <div class="stat-card">
              <div class="stat-line">
                <span class="nm" id="b-name">Đế Thích Thiên</span>
                <span class="v">⚔ <span id="b-atk">0</span></span>
                <span class="v blue">💨 <span id="b-spd">0.10</span></span>
              </div>
              <div class="stat-line">
                <div class="hpbar"><i id="b-hp"></i><span id="b-hptext"></span></div>
                <span class="v">🛡 <span id="b-def">0</span></span>
              </div>
              <div class="stat-line">
                <div class="mpbar"><i id="b-mp"></i><span id="b-mptext"></span></div>
                <span class="v purple">✦ <span id="b-crit">0</span></span>
              </div>
            </div>
          </div>
          <div class="bt-tools">
            <button class="round" data-act="battle-exit" title="Rời chiến trường">✕</button>
            <span class="stars">★★☆</span>
            <span class="res-inline"><span class="g">🪙 <b id="b-gold">455</b></span><span class="s">⚪ <b id="b-silver">40.932</b></span></span>
          </div>
        </div>
      </div>

      <div class="arena-tabs">
          <button class="arena-tab on" data-act="arena" data-arena="bamboo">🌿 Rừng Trúc</button>
          <button class="arena-tab" data-act="arena" data-arena="buddha">🌸 Đài Phật</button>
          <button class="arena-tab" data-act="arena" data-arena="city">🏯 Biện Kinh</button>
          <span class="wave-tag" id="wave-tag">Đợt 1/3</span>
        </div>

        <div class="bt-skills">
          <div class="skill-row">
            ${SKILLS.map((s, i) => `
              <div class="skill-slot" data-act="skill" data-i="${i}" title="${esc(s.name)} — phím ${i + 1}">
                <div class="fill s${i}">${s.icon}</div>
                <div class="cd hidden" id="cd-${i}">0</div>
                <span class="key">${i + 1}</span>
                <span class="lv">Lv.${s.lvl}</span>
              </div>`).join('')}
          </div>
          <div class="bt-vert">
            <button class="round" data-act="toggle-auto" title="Tự động đánh">🤖<span class="auto-badge" id="auto-badge">AUTO</span></button>
            <button class="round" data-act="toggle-auto-skill" title="Tự tung chiêu">✨</button>
            <button class="round" data-act="pause" title="Tạm dừng">⏸</button>
          </div>
        </div>
      </div>

      <div class="bt-bottom">
        <div class="qi">
          <div class="qi-top"><span class="t">KHÍ THẾ</span><span class="v" id="qi-l-val">4322</span></div>
          <div class="nm" id="qi-l-name">Song Ma Quyền Phái</div>
          <div class="qi-bar"><i class="green" id="qi-l-bar" style="width:100%"></i></div>
        </div>

        <div class="bt-dock">
          <button class="dock-btn" data-act="open-arena-modal"><div class="ic gold">🗺️</div><span class="lbl">H. Tẩu</span></button>
          <button class="dock-btn" data-act="open-info"><div class="ic red">🥋</div><span class="lbl">M. Phái</span></button>
          <button class="dock-btn" data-act="open-info"><div class="ic purple">👥</div><span class="lbl">Đội Hình</span></button>
          <button class="dock-btn" data-act="open-skills"><div class="ic amber">🔥</div><span class="lbl">Tuyệt Kỹ</span></button>
          <button class="dock-btn" data-act="open-bag"><div class="ic green">🎒</div><span class="lbl">Hành Trang</span></button>
          <button class="dock-btn" data-act="battle-restart"><div class="ic red">🐲</div><span class="lbl">Khiêu Chiến</span></button>
        </div>

        <div class="qi">
          <div class="qi-top"><span class="t">KHÍ THẾ</span><span class="v" id="qi-r-val">0</span></div>
          <div class="nm" id="qi-r-name">Ma Giáo Cao Thủ</div>
          <div class="qi-bar"><i class="red" id="qi-r-bar" style="width:100%"></i></div>
        </div>

        <div class="orb" data-act="battle-speed" title="Tốc độ trận đấu">
          <b id="battle-speed-text">X1</b><span>Tốc độ</span>
        </div>
      </div>

      <div class="battle-log" id="battle-log">Sẵn sàng xuất chiến…</div>
      <div class="banner" id="banner"></div>`;
  },

  showScreen(mode) {
    const w = $('#hud-world'), b = $('#hud-battle');
    if (w) w.classList.toggle('on', mode === 'world');
    if (b) b.classList.toggle('on', mode === 'battle');
    const np = $('#nameplates'), lb = $('#labels'), px = $('#pixi-layer');
    if (np) np.style.display = mode === 'world' ? 'block' : 'none';
    if (lb) lb.style.display = mode === 'battle' ? 'block' : 'none';
    if (px) px.style.display = mode === 'world' ? 'block' : 'none';
    if (mode !== 'world') $('#dialogue').classList.remove('on');
  },

  syncWorld() {
    const p = State.player;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('w-level', p.level);
    set('w-name', p.name);
    set('w-expfill', '');
    const ef = $('#w-expfill'); if (ef) ef.style.width = clamp(p.exp / p.maxExp * 100, 0, 100) + '%';
    set('w-exptext', p.exp + '/' + p.maxExp);
    const hf = $('#w-hpfill'); if (hf) hf.style.width = clamp(p.hp / p.maxHp * 100, 0, 100) + '%';
    set('w-hptext', Math.round(p.hp) + '/' + p.maxHp);
    const mf = $('#w-mpfill'); if (mf) mf.style.width = clamp(p.mp / p.maxMp * 100, 0, 100) + '%';
    set('w-mptext', p.mp + '/' + p.maxMp);
    set('w-cap', p.capacity + '/' + p.maxCapacity);
    set('w-gold', fmtFull(p.gold));
    set('w-silver', fmtFull(p.silver));

    const q = State.quests.find(x => !x.done);
    const qd = $('#w-quest-desc'), qf = $('#w-quest-fill');
    if (qd) qd.textContent = q ? `• ${q.desc} (${q.progress}/${q.target})` : '• Đã hoàn thành mọi nhiệm vụ hiện tại!';
    if (qf) qf.style.width = q ? clamp(q.progress / q.target * 100, 0, 100) + '%' : '100%';
    /* ENV-BEGIN — cập nhật pill giờ game / thời tiết / mùa trên HUD. */
    if (typeof Env !== 'undefined' && Env.syncHUD) Env.syncHUD();
  },

  syncBattle(force) {
    if (!Battle.active || !Battle.allies.length) return;
    const leader = Battle.allies[0];
    if (!leader) return;
    const hero = heroById(State.heroes[leader.heroIndex || 0].id) || HERO_DEFS[0];
    const st = heroStats(hero.id);
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el && (force || el.textContent !== String(v))) el.textContent = v;
    };
    set('b-level', hero.level);
    set('b-name', hero.name);
    set('b-atk', fmt(st.atk));
    set('b-def', fmt(st.def));
    set('b-spd', '0.10');
    set('b-crit', fmt(st.crit));
    const hpPct = clamp(leader.hp / leader.maxHp * 100, 0, 100);
    const hb = $('#b-hp'); if (hb) hb.style.width = hpPct + '%';
    set('b-hptext', fmt(leader.hp) + ' / ' + fmt(leader.maxHp));

    /* HERO20-BEGIN — thanh nội lực lấy từ Battle.mp (hồi dần trong trận);
       chưa vào trận thì giữ cách tính cũ theo số skill sẵn sàng */
    const mpPct = (typeof Battle !== 'undefined' && typeof Battle.mp === 'number' && Battle.active)
      ? Math.round(clamp(Battle.mp / (Battle.maxMp || 100) * 100, 0, 100))
      : Math.round(35 + (SKILLS.reduce((a, s) => a + (s.currentCd <= 0 ? 1 : 0), 0) / SKILLS.length) * 65);
    const mb = $('#b-mp'); if (mb) mb.style.width = mpPct + '%';
    set('b-mptext', mpPct + '%');
    /* HERO20-END */

    set('b-gold', fmtFull(State.player.gold));
    set('b-silver', fmtFull(State.player.silver));
    set('wave-tag', `Đợt ${Battle.wave}/${Battle.maxWaves}`);

    const aliveAllies = Battle.allies.filter(u => !u.dead);
    const aliveEnemies = Battle.enemies.filter(u => !u.dead);
    const aHp = aliveAllies.reduce((a, u) => a + u.hp, 0);
    const aMax = Battle.allies.reduce((a, u) => a + u.maxHp, 0) || 1;
    const eHp = aliveEnemies.reduce((a, u) => a + u.hp, 0);
    const eMax = Battle.enemies.reduce((a, u) => a + u.maxHp, 0) || 1;
    const lb = $('#qi-l-bar'); if (lb) lb.style.width = clamp(aHp / aMax * 100, 0, 100) + '%';
    const rb = $('#qi-r-bar'); if (rb) rb.style.width = clamp(eHp / eMax * 100, 0, 100) + '%';
    set('qi-l-val', Math.round(aHp / aMax * 100) + '%');
    set('qi-r-val', aliveEnemies.length + ' địch');
    set('qi-l-name', hero.name);
    set('qi-r-name', (aliveEnemies[0] && aliveEnemies[0].name) || 'Toàn diệt');

    /* HERO20-BEGIN — nút skill 1–4 hiển thị theo bộ skill của đội trưởng
       (tên/icon/hồi chiêu/cấp); chưa vào trận thì fallback SKILLS chung cũ */
    const bSkills = (typeof Battle !== 'undefined' && Battle.activeSkills) ? Battle.activeSkills() : SKILLS;
    bSkills.forEach((s, i) => {
      const el = document.getElementById('cd-' + i);
      if (!el) return;
      const slot = el.parentElement;
      if (slot) {
        const fill = slot.querySelector('.fill');
        if (fill && fill.textContent !== s.icon) fill.textContent = s.icon;
        const tip = `${s.name}${s.ult ? ' ★ TUYỆT KỸ' : ''} — ${s.desc} (Hồi ${s.cd}s · Tốn ${s.cost} nội lực · phím ${i + 1})`;
        if (slot.getAttribute('title') !== tip) slot.setAttribute('title', tip);
      }
      if (s.currentCd > 0) { el.classList.remove('hidden'); el.textContent = Math.ceil(s.currentCd); }
      else el.classList.add('hidden');
      const lv = el.parentElement.querySelector('.lv');
      if (lv) lv.textContent = 'Lv.' + (s.lvl || 10);
    });
    /* HERO20-END */
    const ab = $('#auto-badge');
    if (ab) ab.textContent = State.settings.autoBattle ? 'AUTO' : 'TAY';
    const sp = $('#battle-speed-text');
    if (sp) sp.textContent = 'X' + Battle.speed;
  },

  showBanner(name) {
    const el = $('#banner');
    if (!el) return;
    el.textContent = name;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  },

  showResult(win, data) {
    const box = $('#result');
    if (!box) return;
    box.className = 'result on' + (win ? '' : ' lose');
    box.innerHTML = `
      <div class="rcard">
        <div class="rtitle">${win ? 'ĐẠI THẮNG' : 'BẠI TRẬN'}</div>
        <div class="rsub">${esc(data.arena)} · Đợt ${data.wave}/${Battle.maxWaves} · ${win ? 'Giang hồ lại vang danh' : 'Thua keo này, bày keo khác'}</div>
        <div class="rrows">
          <div class="rrow"><span>Kinh nghiệm</span><span>+${fmt(data.exp)}</span></div>
          <div class="rrow"><span>Ngân lượng</span><span>+${fmt(data.silver)} bạc</span></div>
          ${data.gold ? `<div class="rrow"><span>Kim nguyên bảo</span><span>+${data.gold}</span></div>` : ''}
          <div class="rrow"><span>Tổng sát địch</span><span>${State.stats.kills}</span></div>
        </div>
        <div class="racts">
          ${win ? '<button class="btn" data-act="battle-again">⚔️ Đánh tiếp</button>' : '<button class="btn red" data-act="battle-again">💪 Phục thù</button>'}
          <button class="btn dark" data-act="result-world">🏯 Về Biện Kinh</button>
          <button class="btn ghost" data-act="open-info">📜 Xem hồ sơ</button>
        </div>
      </div>`;
    box.classList.add('on');
    this.syncWorld();
  },

  hideResult() {
    const box = $('#result');
    if (box) { box.classList.remove('on'); box.innerHTML = ''; }
  },

  /* ---------- modal ---------- */
  openModal(kind, data) {
    const m = $('#modal');
    if (!m) return;
    /* INTERACT-BEGIN — mở ván cờ mới mỗi lần mở modal cờ. */
    if (kind === 'chess' && typeof MiniGames !== 'undefined') MiniGames.newChess();
    const cfg = this.modalHTML(kind, data || {});
    if (!cfg) return;
    $('#modal-icon').textContent = cfg.icon;
    $('#modal-title').textContent = cfg.title;
    $('#modal-body').innerHTML = cfg.body;
    m.classList.add('on');
    m.setAttribute('aria-hidden', 'false');
    /* INTERACT-BEGIN — mở modal câu cá/hái sen thì chạy thanh timing. */
    if (kind === 'fishing' && typeof MiniGames !== 'undefined') MiniGames.startFishing();
    if (kind === 'lotus' && typeof MiniGames !== 'undefined') MiniGames.startLotus();
    Sfx.click();
  },

  closeModal() {
    const m = $('#modal');
    if (!m) return;
    /* INTERACT-BEGIN — đóng modal thì dừng thanh timing câu cá/hái sen. */
    if (typeof MiniGames !== 'undefined') MiniGames.stopTimers();
    m.classList.remove('on');
    m.setAttribute('aria-hidden', 'true');
  },

  mapDetailHTML(a) {
    /* ARENA10-BEGIN — chi tiết map: dàn quái, kỹ năng Boss, phần thưởng Boss */
    const foes = (a.enemies && a.enemies.length) ? `<div class="ms">👹 Quái trấn giữ: ${esc(a.enemies.join(' · '))}</div>` : '';
    const skill = a.bossSkill ? `<div class="ms">⚡ Kỹ năng Boss: <b style="color:#ffb4b4">${esc(a.bossSkill)}</b></div>` : '';
    const reward = a.bossReward ? `<div class="ms">🏆 Thưởng Boss: <b style="color:#ffd97a">${esc(a.bossRewardIcon || '')} ${esc(a.bossReward)}</b></div>` : '';
    /* ARENA10-END */
    return `<div class="mt"><span class="tag">${esc(a.badge)}</span>${a.isBoss ? '<span class="tag red">🔥 BOSS CUỐI</span>' : ''}</div>
      <div class="ms" style="margin-top:4px">👹 Trấn giữ: <b style="color:#ffe3ac">${esc(a.boss)}</b></div>
      ${foes}${skill}${reward}
      <div class="ms">🎖️ Cấp đề nghị: ${esc(a.recLvl)} <span class="muted">(chỉ hiển thị, không khóa map)</span></div>
      <div class="ms">🎁 Vật phẩm rơi: ${esc(a.drops)}</div>
      <p style="margin-top:4px">${esc(a.desc)}</p>`;
  },

  modalHTML(kind, d) {
    const p = State.player;
    if (kind === 'tip') {
      const [title, body] = String(d.tip || 'Thông tin|').split('|');
      return { icon: '📖', title: title, body: `<p style="line-height:1.7">${esc(body)}</p>` };
    }
    if (kind === 'lore') {
      /* NPC-BEGIN — modal đọc cốt truyện do Lão Kể Chuyện mở (5 đoạn ngắn). */
      const paras = (typeof NPC_LORE !== 'undefined' && NPC_LORE.length)
        ? NPC_LORE
        : ['Lão kể chuyện đang nghỉ ngơi, thiếu hiệp ghé lại sau nhé!'];
      const body = paras.map(p => `<p style="line-height:1.7;margin-bottom:10px">${esc(p)}</p>`).join('') +
        `<div style="display:flex;gap:8px;margin-top:12px"><button class="btn dark btn-lg" data-act="close-modal">Đa tạ lão trượng</button></div>`;
      return { icon: '📖', title: 'Truyền thuyết Biện Kinh', body };
    }
    if (kind === 'gear') {
      const h = heroById(State.heroes[Info.index].id) || HERO_DEFS[0];
      const meta = GEAR_META[d.slot] || GEAR_META.weapon;
      const name = h[d.slot] || meta.label;
      const lv = GEAR_LV[d.slot] || 1;
      const tier = meta.tier === 'gold' ? 'Hoàng kim' : meta.tier === 'purple' ? 'Tím' : 'Cam';
      const body = `
        <div class="mrow">
          <div><div class="mt">${meta.icon} ${esc(name)} <span class="tag">+${lv}</span><span class="tag ${meta.tier === 'gold' ? '' : 'blue'}">${tier}</span></div>
          <div class="ms">Trang bị của ${esc(h.name)} · ${esc(meta.label)}</div></div>
          <div class="mi">${meta.icon}</div>
        </div>
        <p class="muted">Kích hoạt duyên phận tương ứng, gia tăng đáng kể thực lực khi xuất chiến. Trang bị cấp càng cao, chỉ số cộng thêm càng lớn.</p>`;
      return { icon: meta.icon, title: meta.label + ' · ' + name, body };
    }
    if (kind === 'fate') {
      const h = heroById(State.heroes[Info.index].id) || HERO_DEFS[0];
      const body = `<p class="muted">Đã kích hoạt ${h.fates.filter(f => f[2]).length}/${h.fates.length} duyên phận của ${esc(h.name)}.</p>` +
        h.fates.map(f => `<div class="mrow"><div><div class="mt">${f[2] ? '🔆' : '🔅'} ${esc(f[0])} ${f[2] ? '<span class="tag green">Đã kích hoạt</span>' : '<span class="tag red">Chưa</span>'}</div><div class="ms">${esc(f[1])}</div></div></div>`).join('');
      return { icon: '🔆', title: 'Duyên phận · ' + h.name, body };
    }
    if (kind === 'arena') {
      const diff = a => a.mul <= 1.5 ? ['Dễ', 'green'] : a.mul <= 2.5 ? ['Trung', 'blue'] : ['Khó', 'red'];
      /* ARENA10-BEGIN — modal chỉ liệt kê 10 Battle Map (ẩn 8 id legacy), xếp theo số map */
      let sel = (UI._selectedArena && ARENAS[UI._selectedArena]) ? UI._selectedArena
        : (ARENAS[Battle.arena] ? Battle.arena : 'bm1');
      if (typeof resolveArenaKey === 'function') sel = resolveArenaKey(sel);
      UI._selectedArena = sel;
      const keys = Object.keys(ARENAS).filter(k => !ARENAS[k].legacy)
        .sort((x, y) => (ARENAS[x].num || 0) - (ARENAS[y].num || 0));
      const cards = keys.map(k => {
        const a = ARENAS[k];
        const [label, cls] = diff(a);
        return `<div class="map-card ${k === sel ? 'on' : ''} ${a.isBoss ? 'boss' : ''}" data-act="map-select" data-arena="${k}" role="button" tabindex="0">
          <div class="mt"><span style="font-size:18px">${a.icon}</span> ${esc(a.name)} <span class="tag ${cls}">${label}</span></div>
          <div class="ms">${esc(a.tip)}</div>
          <div class="ms">👹 ${esc((a.enemies || []).join(' · '))} — Boss: <b style="color:#ffe3ac">${esc(a.boss)}</b></div>
          <div class="ms" style="color:#ffd97a">+${fmt(a.exp)} EXP · +${fmt(a.silver)} bạc · ${a.gold} KNB</div>
        </div>`;
      }).join('');
      const body = `<p class="muted" style="margin-bottom:8px">Mười Battle Map, độ khó tăng dần từ Map 1 đến Map 10. Chạm vào một map để xem chi tiết quái, Boss và kỹ năng Boss, rồi Xuất Chiến để đánh 3 đợt nhận thưởng lớn.</p>
        <div class="map-grid">${cards}</div>
        <div class="map-detail" id="map-detail">${this.mapDetailHTML(ARENAS[sel])}</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn red btn-lg" id="map-start-btn" data-act="arena-start" data-arena="${sel}">⚔️ Xuất Chiến</button>
          <button class="btn dark btn-lg" data-act="close-modal">← Quay lại</button>
        </div>`;
      /* ARENA10-END */
      return { icon: '⚔️', title: 'Chọn chiến trường', body };
    }
    if (kind === 'recruit') {
      const orb = t => t === 'Giáp' ? 'orb-giap' : t === 'Ất' ? 'orb-at' : 'orb-binh';
      const price = t => {
        const pool = RECRUIT_POOLS[t];
        if (t === 1) return Recruit.freeLeft() > 0
          ? `<span style="color:#4ade80">Miễn phí hôm nay (${Recruit.freeLeft()}/1 lượt)</span>`
          : `5.000 bạc / lần`;
        return `${pool.costGold} KNB / lần`;
      };
      const rates = t => RECRUIT_POOLS[t].rates.map(r => `${r.grade} ${r.w}%`).join(' · ');
      const body = `<div class="mrow"><span>Ngân quỹ hiện có</span><b>🪙 ${fmtFull(p.gold)} · ⚪ ${fmtFull(p.silver)}</b></div>
        <p class="muted" style="margin-bottom:8px">Đài Tham Bái linh ứng — đệ tử hữu duyên sẽ tự tìm đến. Trúng đệ tử đã có sẽ chuyển thành bồi dưỡng (+2 cấp). Đệ tử mới ra trận khi làm đội trưởng (mở Hồ sơ → chọn → Xuất Chiến).</p>
        <div class="recruit-grid">${[1, 2, 3].map(t => {
          const pool = RECRUIT_POOLS[t];
          return `<div class="recruit-card">
            <div class="mt" style="font-weight:800;color:#ffe3ac">${pool.name}</div>
            <div class="ms" style="margin:4px 0">Tỉ lệ: ${rates(t)}</div>
            <div class="ms" style="margin-bottom:8px">${price(t)}</div>
            <div style="display:flex;gap:4px;justify-content:center;margin-bottom:8px">
              ${pool.rates.map(r => `<span class="tag ${orb(r.grade)}">${r.grade}</span>`).join('')}
            </div>
            <button class="btn btn-lg" data-act="recruit-draw" data-tier="${t}">🙏 Tham Bái</button>
          </div>`;
        }).join('')}</div>`;
      return { icon: '⛩️', title: 'Tham Bái Chiêu Mộ', body };
    }
    if (kind === 'recruit-result') {
      const h = heroById(d.id) || HERO_DEFS[0];
      const st = heroStats(h.id);
      const orbCls = h.type === 'Giáp' ? 'orb-giap' : h.type === 'Ất' ? 'orb-at' : 'orb-binh';
      const body = `<div style="text-align:center">
          <div style="width:96px;height:96px;margin:0 auto;border-radius:12px;overflow:hidden;border:2px solid #f0c860">${heroAvatarSVG(h, 'rec')}</div>
          <h3 style="margin-top:8px;color:#ffd76b;font-size:20px">${esc(h.name)}</h3>
          <div><span class="tag ${orbCls}">${h.type}</span> <span class="tag">${esc(h.title)}</span> <span class="tag">Lv.${(State.heroes.find(x => x.id === h.id) || { level: h.level }).level}</span></div>
          <div class="ms" style="margin-top:6px">${esc(h.sect)} · Thiên phú: <b style="color:#ffe3ac">${esc(h.innate)}</b></div>
          <div class="mrow" style="margin-top:10px;justify-content:space-around;text-align:center">
            <div><div class="tiny muted">Mệnh</div><b>${fmt(st.hp)}</b></div>
            <div><div class="tiny muted">Công</div><b>${fmt(st.atk)}</b></div>
            <div><div class="tiny muted">Thủ</div><b>${fmt(st.def)}</b></div>
            <div><div class="tiny muted">Khí</div><b>${fmt(st.qi)}</b></div>
          </div>
          <p class="muted" style="margin-top:8px">Đã vào đội hình — mở Hồ sơ, chọn làm đội trưởng để xuất chiến.</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:12px">
            <button class="btn btn-lg" data-act="recruit-confirm">📜 Mở hồ sơ</button>
            <button class="btn dark btn-lg" data-act="close-modal">Để sau</button>
          </div>
        </div>`;
      return { icon: '🙏', title: 'Chiêu mộ thành công!', body };
    }
    if (kind === 'shop') {
      const body = `<div class="mrow"><span>Ngân quỹ hiện có</span><b>🪙 ${fmtFull(p.gold)} · ⚪ ${fmtFull(p.silver)}</b></div>
        <div class="shop-grid">${SHOP_ITEMS.map(it => `
          <div class="shop-item">
            <div class="icon">${it.icon}</div>
            <div class="info"><b>${it.name}</b><span>${it.desc}</span>
              <div class="tiny" style="color:#ffd97a;margin-top:2px">${it.price} ${it.cur === 'gold' ? 'KNB' : 'bạc'}</div>
            </div>
            <button class="btn sm" data-act="buy" data-id="${it.id}">Mua</button>
          </div>`).join('')}</div>`;
      return { icon: '🏮', title: 'Chợ Biện Kinh', body };
    }
    if (kind === 'quests') {
      const body = State.quests.map(q => `
        <div class="mrow">
          <div style="flex:1">
            <div class="mt">${q.done ? '✅' : '📜'} ${esc(q.title)} ${q.done ? '<span class="tag green">Hoàn thành</span>' : ''}</div>
            <div class="ms">${esc(q.desc)} — ${q.progress}/${q.target}<br>Thưởng: ${q.exp} EXP · ${fmt(q.silver)} bạc</div>
            <div class="qt-bar" style="height:4px;margin-top:5px;background:#1b140d;border-radius:99px;overflow:hidden"><i style="display:block;height:100%;width:${clamp(q.progress / q.target * 100, 0, 100)}%;background:linear-gradient(90deg,#f59e0b,#fde68a)"></i></div>
          </div>
          ${q.done ? '' : `<button class="btn sm" data-act="guide" data-id="${q.id}">Tự tới</button>`}
        </div>`).join('');
      return { icon: '📜', title: 'Hành Tẩu Giang Hồ', body };
    }
    if (kind === 'skills') {
      const body = SKILLS.map((s, i) => `
        <div class="mrow">
          <div><div class="mt">${s.icon} ${s.name} <span class="tag">Lv.${s.lvl}</span>${s.aoe ? '<span class="tag blue">Diện rộng</span>' : '<span class="tag red">Đơn mục tiêu</span>'}</div>
          <div class="ms">${s.desc}<br>Sát thương ${Math.round(s.mult * 100)}% công lực · Hồi chiêu ${s.cd}s · Phím ${i + 1}</div></div>
          <button class="btn sm" data-act="learn" data-i="${i}">Lĩnh ngộ<br><span style="font-weight:700">${fmt(4000 + s.lvl * 600)} bạc</span></button>
        </div>`).join('');
      return { icon: '🐉', title: 'Tàng Kinh Các — Tuyệt học', body };
    }
    if (kind === 'bag') {
      /* FOLLOW-BEGIN — item thú cưng có nút "Cho đi theo"/"Thôi đi theo"
         (bấm được bằng cảm ứng; nút nằm trong ô đồ, data-act riêng nên
         không kích hoạt use-item của ô). */
      const cells = State.inventory.map((it, i) => {
        const pet = (typeof FollowPets !== 'undefined') ? FollowPets.defForItem(it) : null;
        const isActive = pet && State.activePet === pet.id;
        const petBtn = pet
          ? `<button class="btn sm pet-follow-btn${isActive ? ' on' : ''}" data-act="pet-follow" data-pet="${pet.id}">${isActive ? '✖ Thôi đi theo' : '🐾 Cho đi theo'}</button>`
          : '';
        return `
        <div class="bag-cell${pet ? ' pet-cell' : ''}" data-act="use-item" data-i="${i}" title="${esc(it.desc)}">
          <div class="bi">${it.icon || '📦'}</div>
          <div class="bn">${esc(it.name)}</div>
          <div class="bq">x${it.qty}</div>
          ${isActive ? '<div class="pet-tag">🐾 Đang theo</div>' : ''}${petBtn}
        </div>`;
      }).join('');
      const body = `<p class="muted tiny" style="margin-bottom:6px">Túi đồ ${p.capacity}/${p.maxCapacity} · chạm vật phẩm để dùng · thú cưng bấm <b>🐾 Cho đi theo</b> để đi sau nhân vật</p>
        <div class="bag-grid">${cells || '<span class="muted">Túi đồ trống.</span>'}</div>`;
      return { icon: '🎒', title: 'Hành trang', body };
    }
    if (kind === 'guild') {
      const g = State.guild;
      const body = `
        <div class="mrow"><div><div class="mt">🚩 ${esc(g.name)}</div><div class="ms">Cấp bang ${g.level} · Thành viên ${g.members}/50 · Cống hiến ${g.contribution}</div></div>
        <button class="btn" data-act="donate">Cống hiến 200 bạc</button></div>
        <p class="muted">Thành viên nổi bật: Thiên Địa Đảo, Hùng Luckyet, Thích Sakugiao, Hoa Lan Đạt.</p>`;
      return { icon: '🚩', title: 'Bang hội', body };
    }
    if (kind === 'events') {
      const body = `
        <div class="mgrid">
          <div class="mrow" style="flex-direction:column;align-items:flex-start;gap:8px">
            <div class="mt">⚔️ Lôi Đài Tỷ Võ</div>
            <div class="ms">Khiêu chiến ma giáo, nhận EXP và bạc.</div>
            <button class="btn" data-act="open-arena-modal">Vào chiến trường</button>
          </div>
          <div class="mrow" style="flex-direction:column;align-items:flex-start;gap:8px">
            <div class="mt">🎁 Điểm danh tân thủ</div>
            <div class="ms">Mỗi ngày nhận 50 KNB và 2.000 bạc.</div>
            <button class="btn green" data-act="daily">Nhận phúc lợi</button>
          </div>
        </div>`;
      return { icon: '🎉', title: 'Hoạt động & Sự kiện', body };
    }
    if (kind === 'mail') {
      const body = `
        <div class="mrow"><div><div class="mt">✉️ Thư chào mừng từ Minh Chủ</div>
        <div class="ms">Chúc thiếu hiệp Song Ma Quyền Phái sớm ngày nhất thống giang hồ!</div></div>
        <button class="btn" data-act="claim-mail">Nhận quà</button></div>`;
      return { icon: '✉️', title: 'Hộp thư giang hồ', body };
    }
    if (kind === 'chat') {
      const body = `
        <div class="chatbox" id="chat-log">
          <div><b>[Thế giới] Thiên Địa Đảo:</b> Anh em tập trung ở quảng trường Biện Kinh chuẩn bị đi phụ bản!</div>
          <div><span class="guild">[Bang hội] Hùng Luckyet:</span> Quầy tạp hóa bạt xanh mới về nhiều đan dược xịn.</div>
          <div class="sys">[Hệ thống] Chào mừng đại hiệp ${esc(p.name)} gia nhập võ lâm!</div>
        </div>
        <form class="inputrow" id="chat-form">
          <input id="chat-input" maxlength="120" placeholder="Nhập lời nhắn gửi quần hùng…">
          <button class="btn" type="submit">Gửi</button>
        </form>`;
      return { icon: '💬', title: 'Kênh trò chuyện', body };
    }
    if (kind === 'settings') {
      /* ENV-BEGIN — tốc độ đồng hồ (0 tắt / 1 thường / 2 nhanh) + tắt/bật hiệu
         ứng thời tiết. Nhãn tốc độ trận đấu vẫn lấy từ settings.speed cũ. */
      const clockLabel = State.settings.clockSpeed === 0 ? 'Tắt' : State.settings.clockSpeed === 2 ? 'Nhanh ×2' : 'Bình thường (1 giờ ≈ 75 giây)';
      const body = `
        <div class="mrow"><span>Âm thanh & hiệu ứng</span><button class="btn sm" data-act="toggle-mute">${Sfx.muted ? 'Đang tắt' : 'Đang bật'}</button></div>
        <div class="mrow"><span>Đồng hồ giờ game</span><button class="btn sm" data-act="cycle-clock">${clockLabel}</button></div>
        <div class="mrow"><span>Hiệu ứng thời tiết (mưa/tuyết/sương)</span><button class="btn sm" data-act="toggle-weatherfx">${State.settings.weatherFx === false ? 'TẮT' : 'BẬT'}</button></div>
        <div class="mrow"><span>Tự động đánh</span><button class="btn sm" data-act="toggle-auto">${State.settings.autoBattle ? 'BẬT' : 'TẮT'}</button></div>
        <div class="mrow"><span>Tự tung chiêu</span><button class="btn sm" data-act="toggle-auto-skill">${State.settings.autoSkill ? 'BẬT' : 'TẮT'}</button></div>
        <div class="mrow"><span>Lưu tiến trình</span><button class="btn sm" data-act="save-now">Lưu ngay</button></div>
        <div class="mrow"><span>Về màn hình chính</span><button class="btn sm" data-act="open-newgame">Mở Newgame</button></div>
        <div class="mrow"><span>Khôi phục dữ liệu ban đầu</span><button class="btn sm red" data-act="reset-ask">Đặt lại</button></div>
        <p class="muted tiny">Mộng Võ Lâm 3D · Soha · Three.js + PixiJS · lưu cục bộ trong trình duyệt.</p>`;
      return { icon: '⚙️', title: 'Cài đặt hệ thống', body };
    }
    /* INTERACT-BEGIN — 3 mini-game tại chỗ + màn hình kết quả câu cá/hái sen. */
    if (kind === 'fishing') {
      const body = `<p class="muted">Thanh chạy qua lại — bấm <b>Kéo cần</b> đúng lúc kim vào vùng xanh thì câu được cá; vùng vàng giữa là <b style="color:#ffd76b">Cá Chép Vàng sử thi</b>! Trượt thì mất mồi. Mồi Câu còn: <b style="color:#ffe3ac">${Interact.baitCount()}</b> (mua ở chợ 50 bạc, hoặc nhận 5 mồi mỗi ngày game).</p>
        <div class="fish-bar"><div class="fish-zone-green"></div><div class="fish-zone-gold"></div><div class="fish-marker" id="fish-marker"></div></div>
        <div class="ms" style="margin-top:6px">🟩 Vùng xanh = trúng (30% Cá Chép Hiếm) · 🟨 Vùng vàng giữa = Cá Chép Vàng</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn red btn-lg" data-act="fish-pull">🎣 Kéo cần</button>
          <button class="btn dark btn-lg" data-act="close-modal">Thôi, để sau</button>
        </div>`;
      return { icon: '🎣', title: 'Câu cá hồ sen', body };
    }
    if (kind === 'fish-result') {
      const body = d.hit
        ? `<div style="text-align:center"><div style="font-size:44px">${d.rarity === 'epic' ? '🐡' : d.rarity === 'rare' ? '🐠' : '🐟'}</div>
          <h3 style="margin-top:6px;color:#ffd76b">Câu được ${esc(d.name)}!</h3>
          <p class="muted">${d.rarity === 'epic' ? 'Cá Chép Vàng sử thi — hiếm lắm đó, bán được 2.000 bạc!' : d.rarity === 'rare' ? 'Cá Chép Hiếm, vảy óng ánh — bán được 500 bạc!' : 'Cá chép thường, bán được 150 bạc.'} Đã vào túi đồ.</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-lg" data-act="fish-again">🎣 Câu tiếp (tốn 1 mồi)</button>
            <button class="btn dark btn-lg" data-act="close-modal">Để sau</button>
          </div></div>`
        : `<div style="text-align:center"><div style="font-size:44px">💨</div>
          <h3 style="margin-top:6px;color:#ffd76b">Trượt rồi!</h3>
          <p class="muted">Cá cắn câu rồi tuột mất — tốn 1 Mồi Câu. Canh đúng vùng xanh rồi hãy kéo nhé!</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-lg" data-act="fish-again">🎣 Câu tiếp (tốn 1 mồi)</button>
            <button class="btn dark btn-lg" data-act="close-modal">Để sau</button>
          </div></div>`;
      return { icon: '🎣', title: d.hit ? 'Câu được cá!' : 'Trượt mất rồi', body };
    }
    if (kind === 'lotus') {
      const body = `<p class="muted">Kim chạy qua lại — bấm <b>Hái ngay</b> đúng lúc kim vào vùng sáng thì hái được <b style="color:#ffe3ac">Hạt Sen / Lá Sen</b>. Hái trượt thì không được gì, cũng không mất gì.</p>
        <div class="fish-bar"><div class="fish-zone-green"></div><div class="fish-marker" id="lotus-marker"></div></div>
        <div class="ms" style="margin-top:6px">🟩 Vùng sáng giữa = hái được (70% Hạt Sen ×2, 30% Lá Sen ×2)</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-lg" data-act="lotus-pick">🌸 Hái ngay</button>
          <button class="btn dark btn-lg" data-act="close-modal">Thôi, để sau</button>
        </div>`;
      return { icon: '🌸', title: 'Hái sen hồ sen', body };
    }
    if (kind === 'lotus-result') {
      const body = d.hit
        ? `<div style="text-align:center"><div style="font-size:44px">🌸</div>
          <h3 style="margin-top:6px;color:#ffd76b">Hái được ${esc(d.name)}!</h3>
          <p class="muted">Sen hồ Biện Kinh thơm ngát — đã vào túi đồ, bán ở chợ cũng được bạc.</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-lg" data-act="lotus-again">🌸 Hái tiếp</button>
            <button class="btn dark btn-lg" data-act="close-modal">Để sau</button>
          </div></div>`
        : `<div style="text-align:center"><div style="font-size:44px">🍃</div>
          <h3 style="margin-top:6px;color:#ffd76b">Hái trượt rồi!</h3>
          <p class="muted">Tay chạm hụt, sen vẫn còn đó — không mất gì, thử lại nhé!</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-lg" data-act="lotus-again">🌸 Hái lại</button>
            <button class="btn dark btn-lg" data-act="close-modal">Để sau</button>
          </div></div>`;
      return { icon: '🌸', title: d.hit ? 'Hái được sen!' : 'Hái trượt rồi', body };
    }
    if (kind === 'chess') {
      const rewardedToday = State.flags.interact.chessWinDay === State.worldClock.day;
      const body = `<p class="muted">Đấu <b>Cờ Caro 9×9</b> với <b style="color:#ffe3ac">Lão Kỳ Thánh</b> — thiếu hiệp cầm quân đen ●, đi trước. Xếp 5 quân một hàng (ngang/dọc/chéo) là thắng. Thắng được <b style="color:#ffd76b">+1.000 bạc +100 EXP</b>, 1 lần/ngày game${rewardedToday ? ' (hôm nay đã nhận thưởng rồi — ván này chỉ chơi vui)' : ''}. Thua/hòa không mất gì.</p>
        <div class="ms" id="chess-status" style="margin:8px 0;color:#ffe3ac">${esc(MiniGames.chess.status || '')}</div>
        <div class="chess-board" id="chess-board">${MiniGames.chessBoardHTML()}</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-lg" data-act="chess-again">🔄 Ván mới</button>
          <button class="btn dark btn-lg" data-act="chess-resign">🏳️ Đầu hàng</button>
          <button class="btn dark btn-lg" data-act="close-modal">Đóng</button>
        </div>`;
      return { icon: '♟️', title: 'Đấu Cờ Caro · Lão Kỳ Thánh', body };
    }
    /* DISTRICT-BEGIN — panel liệt kê 12 khu vực (dữ liệu src/10b-districts.js):
       khu 1 = nơi đang đứng, khu khóa hiện 🔒 + điều kiện mở (reason của
       canEnterDistrict), khu mở bấm được để tới (lưu game rồi chuyển trang). */
    if (kind === 'districts') {
      if (typeof DISTRICTS === 'undefined') {
        return { icon: '🗺️', title: 'Bản Đồ Khu Vực', body: '<p class="muted">Chưa tải được dữ liệu khu vực — hãy tải lại trang.</p>' };
      }
      const rows = DISTRICTS.map(def => {
        if (def.id === 1 || !def.file) {
          return `<div class="district-card here"><div class="mt">🏯 ${esc(def.name)} <span class="tag green">📍 Bạn đang ở đây</span></div><div class="ms">Biện Kinh Thành — trung tâm giang hồ, nơi thiếu hiệp đang đứng.</div></div>`;
        }
        const chk = (typeof canEnterDistrict === 'function') ? canEnterDistrict(def, State) : { ok: true };
        if (!chk || !chk.ok) {
          return `<div class="district-card locked"><div class="mt">🔒 ${esc(def.name)}</div><div class="ms">🔒 ${esc((chk && chk.reason) || 'Khu vực đang khóa.')}</div></div>`;
        }
        return `<div class="district-card" data-act="district-enter" data-id="${def.id}" role="button" tabindex="0"><div class="mt">🗺️ ${esc(def.name)}</div><div class="ms">Chạm để tới ${esc(def.name)} — game sẽ lưu rồi chuyển trang.</div></div>`;
      }).join('');
      const body = `<p class="muted" style="margin-bottom:8px">12 khu vực quanh Biện Kinh — khu mở thì chạm để tới, khu khóa hiện rõ điều kiện mở.</p>
        <div class="district-grid">${rows}</div>
        <div style="display:flex;gap:8px;margin-top:12px"><button class="btn dark btn-lg" data-act="close-modal">← Quay lại</button></div>`;
      return { icon: '🗺️', title: 'Bản Đồ Khu Vực', body };
    }
    /* DISTRICT-BEGIN — lựa chọn khi chạm cổng dịch chuyển: đi vòng như cũ
       hoặc vào thẳng khu vực mà cổng đó dẫn tới (khóa thì chỉ hiện lý do). */
    if (kind === 'gate-choice') {
      const body = `<p class="muted">Đang đứng tại <b style="color:#ffe3ac">${esc(d.gateName || 'Cổng dịch chuyển')}</b>.</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
          <button class="btn btn-lg" data-act="gate-cycle">🚪 Dịch chuyển vòng${d.nextName ? ' → ' + esc(d.nextName) : ''}</button>
          ${d.distFile ? `<button class="btn btn-lg" data-act="gate-district" data-file="${esc(d.distFile)}">🗺️ Vào ${esc(d.distName || 'khu vực')}</button>` : ''}
          <button class="btn dark btn-lg" data-act="close-modal">← Quay lại</button>
        </div>
        ${d.locked ? `<p class="muted" style="margin-top:8px">🔒 ${esc(d.lockReason || 'Khu vực đang khóa.')}</p>` : ''}`;
      return { icon: '🚪', title: d.gateName || 'Cổng dịch chuyển', body };
    }
    if (kind === 'exit-battle') {
      return {
        icon: '⚠️', title: 'Rời chiến trường?',
        body: `<p>Rời trận sẽ không nhận thưởng của trận đang đánh. Đại hiệp chắc chắn?</p>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn red" data-act="battle-exit-yes">Rời trận</button>
            <button class="btn dark" data-act="close-modal">Ở lại</button>
          </div>`
      };
    }
    if (kind === 'reset') {
      return {
        icon: '⚠️', title: 'Đặt lại toàn bộ?',
        body: `<p>Toàn bộ cấp độ, bạc, đệ tử và nhiệm vụ sẽ trở về ban đầu.</p>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn red" data-act="reset-yes">Xóa và tải lại</button>
            <button class="btn dark" data-act="close-modal">Hủy</button>
          </div>`
      };
    }
    if (kind === 'help') {
      return {
        icon: '❓', title: 'Hướng dẫn',
        body: `<p><b>Thế giới:</b> WASD hoặc chạm đất để di chuyển. Chạm NPC để đối thoại. Phím <b>C</b> mở hồ sơ, <b>B</b> chọn chiến trường, <b>Q</b> nhiệm vụ.</p>
        <p style="margin-top:6px"><b>Chiến trường:</b> phím <b>1–4</b> tung tuyệt kỹ, kéo chuột để xoay camera, lăn chuột để thu phóng. Nút X đổi tốc độ trận đấu.</p>
        <p style="margin-top:6px"><b>Hồ sơ:</b> chọn đệ tử trong dãy chân dung, kéo mô hình 3D để xoay, bấm Bồi Dưỡng để tăng chỉ số, Xuất Chiến để dẫn đội vào trận.</p>`
      };
    }
    return null;
  },

  /* ---------- hành động ---------- */
  buy(id) {
    const it = SHOP_ITEMS.find(x => x.id === id);
    if (!it) return;
    const p = State.player;
    if (it.cur === 'gold' && p.gold < it.price) return this.toast('Không đủ Kim Nguyên Bảo!', 'red');
    if (it.cur === 'silver' && p.silver < it.price) return this.toast('Không đủ bạc!', 'red');
    if (it.cur === 'gold') p.gold -= it.price;
    else p.silver -= it.price;

    if (it.act === 'heal') { p.hp = p.maxHp; this.toast('Đã hồi đầy Sinh Lực!', 'green'); }
    else if (it.act === 'exp') { gainExp(60); this.toast('+60 Kinh Nghiệm!', 'green'); }
    else if (it.act === 'atk') { p.atk += 35; this.toast('Công kích +35 vĩnh viễn!', 'green'); }
    else if (it.act === 'def') { p.def += 30; this.toast('Phòng thủ +30 vĩnh viễn!', 'green'); }
    else if (it.act === 'mp') { p.maxMp += 120; p.mp = p.maxMp; this.toast('Nội lực tối đa +120!', 'green'); }
    else if (it.act === 'cultivate') {
      const hs = State.heroes[State.leader];
      hs.level += 1;
      hs.bonus.hp += 125000; hs.bonus.atk += 450; hs.bonus.def += 98000; hs.bonus.qi += 110000;
      this.toast('Bồi dưỡng đệ tử thành công!', 'green');
      progressQuest('q4', 1);
    }
    Sfx.coin();
    SaveManager.save();
    this.syncWorld();
    this.openModal('shop');
  },

  useItem(i) {
    const it = State.inventory[i];
    if (!it) return;
    if (it.name.indexOf('Kim Sáng') >= 0) {
      State.player.hp = Math.min(State.player.maxHp, State.player.hp + 200);
      it.qty--; this.toast('Hồi 200 Sinh Lực', 'green'); Sfx.heal();
    } else if (it.name.indexOf('Tụ Khí') >= 0) {
      gainExp(30); it.qty--; this.toast('+30 Kinh Nghiệm', 'green');
    } else {
      this.toast('Vật phẩm dùng để chế tạo, chưa thể dùng trực tiếp.', 'gold');
      return;
    }
    if (it.qty <= 0) State.inventory.splice(i, 1);
    SaveManager.save();
    this.openModal('bag');
    this.syncWorld();
  },

  learnSkill(i) {
    const s = SKILLS[i];
    const cost = 4000 + s.lvl * 600;
    if (State.player.silver < cost) return this.toast('Không đủ bạc để lĩnh ngộ!', 'red');
    State.player.silver -= cost;
    s.lvl += 1;
    s.mult = +(s.mult + .12).toFixed(2);
    s.cd = Math.max(3, +(s.cd - .1).toFixed(1));
    Sfx.level();
    this.toast(`Lĩnh ngộ ${s.name} lên Lv.${s.lvl}!`, 'green');
    SaveManager.save();
    this.openModal('skills');
    this.syncWorld();
    this.syncBattle(true);
  },

  guide(id) {
    this.closeModal();
    if (id === 'q1') {
      const npc = CharacterManager.entities.find(e => e.id === 'merchant');
      if (!npc) return;
      const s = Engine.walkableNear(npc.mesh.position.x, npc.mesh.position.z, 1.6);
      PlayerController.moveTo(s.x, s.z, () => World.talkTo(npc));
      this.toast('Đang tự động tới Chưởng Quầy Tạp Hóa…', 'gold');
    } else if (id === 'q3') {
      PlayerController.moveTo(5.5, 8.6);
      this.toast('Đang tiến về Cầu Đá Hồ Sen…', 'gold');
    } else if (id === 'q2' || id === 'q5') {
      this.openModal('arena');
    } else if (id === 'q4') {
      Info.open(State.leader);
    }
  },

  daily() {
    const today = new Date().toISOString().slice(0, 10);
    if (State.flags.daily === today) return this.toast('Hôm nay đã điểm danh rồi!', 'red');
    State.flags.daily = today;
    State.player.gold += 50;
    State.player.silver += 2000;
    Sfx.coin();
    this.toast('🎁 Nhận 50 KNB & 2.000 bạc!', 'green');
    SaveManager.save();
    this.syncWorld();
  },

  claimMail() {
    if (State.flags.mail) return this.toast('Thư này đã nhận quà rồi.', 'red');
    State.flags.mail = true;
    State.player.gold += 20;
    State.player.silver += 1500;
    addItem('Ngọc Lộ Hoàn', '💧', 'Linh dược', 'Hồi 120 Nội lực', 2);
    Sfx.coin();
    this.toast('Nhận 20 KNB, 1.500 bạc và 2 Ngọc Lộ Hoàn!', 'green');
    SaveManager.save();
    this.syncWorld();
    this.openModal('mail');
  },

  donate() {
    if (State.player.silver < 200) return this.toast('Không đủ 200 bạc!', 'red');
    State.player.silver -= 200;
    State.guild.contribution += 50;
    this.toast('Cống hiến +50 điểm!', 'green');
    SaveManager.save();
    this.openModal('guild');
    this.syncWorld();
  },

  /* ---------- sự kiện toàn cục ---------- */
  bindGlobal() {
    document.addEventListener('click', e => {
      const el = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!el) {
        if (e.target && e.target.id === 'modal') this.closeModal();
        return;
      }
      const act = el.dataset.act;
      Sfx.ensure();
      switch (act) {
        case 'open-info': this.hideResult(); this.closeModal(); Info.open(State.leader); break;
        case 'close-info': Info.close(); break;
        case 'info-select': Info.select(+el.dataset.i); break;
        case 'info-gear': this.openModal('gear', { slot: el.dataset.slot }); break;
        case 'info-tip': this.openModal('tip', { tip: el.dataset.tip || 'Thông tin|' }); break;
        case 'info-bag': this.openModal('bag'); break;
        case 'fate-detail': this.openModal('fate'); break;
        case 'cultivate': Info.cultivate(); break;
        case 'deploy': Info.deploy(); break;
        case 'open-battle': case 'open-arena-modal': this.openModal('arena'); break;
        case 'map-select': {
          const key = el.dataset.arena;
          if (!ARENAS[key]) break;
          UI._selectedArena = key;
          $$('.map-card').forEach(c => c.classList.toggle('on', c.dataset.arena === key));
          const det = $('#map-detail');
          if (det) det.innerHTML = this.mapDetailHTML(ARENAS[key]);
          const startBtn = $('#map-start-btn');
          if (startBtn) startBtn.dataset.arena = key;
          break;
        }
        case 'open-recruit': this.openModal('recruit'); break;
        case 'recruit-draw': Recruit.draw(+el.dataset.tier); break;
        case 'recruit-confirm': {
          this.closeModal();
          const idx = (Recruit._lastIndex != null) ? Recruit._lastIndex : State.leader;
          Info.open(idx);
          break;
        }
        case 'arena-start': this.closeModal(); Battle.start(el.dataset.arena); break;
        case 'arena': if (Battle.active) Battle.start(el.dataset.arena); break;
        /* SHOP-BEGIN */
        case 'open-shop': SaveManager.save(); location.href = 'Shop.html'; break;
        /* SHOP-END */
        /* NEWGAME-BEGIN */
        case 'open-newgame': SaveManager.save(); location.href = 'Newgame.html'; break;
        /* NEWGAME-END */
        /* EVENT-BEGIN */
        case 'open-event': SaveManager.save(); location.href = 'Event.html'; break;
        /* EVENT-END */
        /* DISTRICT-BEGIN — mở panel 12 khu vực; bấm khu mở thì lưu rồi sang map/<file>.html. */
        case 'open-districts': this.openModal('districts'); break;
        case 'district-enter': {
          const def = (typeof DISTRICTS !== 'undefined') ? DISTRICTS.find(x => x.id === +el.dataset.id) : null;
          if (!def || !def.file) break;
          const chk = (typeof canEnterDistrict === 'function') ? canEnterDistrict(def, State) : { ok: true };
          if (!chk || !chk.ok) { this.toast('🔒 ' + ((chk && chk.reason) || 'Khu vực đang khóa!'), 'red'); break; }
          SaveManager.save(); location.href = 'map/' + def.file; break;
        }
        case 'gate-cycle':
          if (typeof DistrictGates !== 'undefined') DistrictGates.cycleFromChoice();
          break;
        case 'gate-district':
          if (typeof DistrictGates !== 'undefined') DistrictGates.enterDistrict(el.dataset.file);
          break;
        /* DISTRICT-END */
        case 'open-bag': this.openModal('bag'); break;
        /* FOLLOW-BEGIN — chọn/bỏ thú cưng đi theo trong túi đồ; mở lại
           túi để cập nhật nút + nhãn "Đang theo" ngay. */
        case 'pet-follow': {
          const def = (typeof FollowPets !== 'undefined') ? FollowPets.defForId(el.dataset.pet) : null;
          if (def) {
            const wasActive = State.activePet === def.id;
            if (FollowPets.toggle(def.id)) {
              this.toast(wasActive ? '🐾 ' + def.name + ' đã thôi đi theo!' : '🐾 ' + def.name + ' sẽ đi theo thiếu hiệp!', 'green');
            } else {
              this.toast('Không tìm thấy ' + def.name + ' trong túi đồ!', 'red');
            }
          }
          this.openModal('bag');
          break;
        }
        case 'open-quests': this.openModal('quests'); break;
        case 'open-skills': this.openModal('skills'); break;
        case 'open-guild': this.openModal('guild'); break;
        case 'open-events': this.openModal('events'); break;
        case 'open-mail': this.openModal('mail'); break;
        case 'open-chat': this.openModal('chat'); break;
        case 'open-settings': this.openModal('settings'); break;
        case 'close-modal': this.closeModal(); break;
        case 'buy': this.buy(el.dataset.id); break;
        case 'use-item': this.useItem(+el.dataset.i); break;
        case 'learn': this.learnSkill(+el.dataset.i); break;
        case 'guide': this.guide(el.dataset.id); break;
        case 'donate': this.donate(); break;
        case 'daily': this.daily(); break;
        case 'claim-mail': this.claimMail(); break;
        case 'toggle-mute':
          Sfx.muted = !Sfx.muted; State.settings.muted = Sfx.muted; SaveManager.save();
          this.toast(Sfx.muted ? 'Đã tắt âm thanh' : 'Đã bật âm thanh', 'gold');
          this.openModal('settings'); break;
        /* ENV-BEGIN — tốc độ đồng hồ 1 → 2 → 0 → 1; bật/tắt hiệu ứng thời tiết;
           nút Dịch chuyển khi đứng gần cổng/giếng. */
        case 'cycle-clock':
          State.settings.clockSpeed = State.settings.clockSpeed === 1 ? 2 : (State.settings.clockSpeed === 2 ? 0 : 1);
          SaveManager.save();
          this.toast(State.settings.clockSpeed === 0 ? 'Đã dừng đồng hồ giờ game' : 'Đồng hồ giờ game: ' + (State.settings.clockSpeed === 2 ? 'nhanh ×2' : 'bình thường'), 'gold');
          this.openModal('settings'); break;
        case 'toggle-weatherfx':
          State.settings.weatherFx = State.settings.weatherFx === false;
          SaveManager.save();
          this.toast(State.settings.weatherFx ? 'Đã bật hiệu ứng thời tiết' : 'Đã tắt hiệu ứng thời tiết', 'gold');
          this.openModal('settings'); break;
        /* DISTRICT-BEGIN — nút 🚪 Dịch chuyển khi đứng gần cổng: mở lựa chọn
           cổng (đi vòng như cũ / vào khu vực) thay vì dịch chuyển ngay. */
        case 'teleport':
          if (typeof DistrictGates !== 'undefined') DistrictGates.openChoiceFromNearest();
          else if (typeof Env !== 'undefined') Env.teleportFromNearest();
          break;
        /* DISTRICT-END */
        /* INTERACT-BEGIN — nút hành động khi đứng gần vật tương tác; mở ván cờ
           từ hộp thoại Lão Kỳ Thánh; các nút mini-game câu cá/hái sen/cờ caro. */
        case 'interact-near':
          if (typeof InteractWorld !== 'undefined') InteractWorld.doInteractNear();
          break;
        case 'open-chess': $('#dialogue').classList.remove('on'); this.openModal('chess'); break;
        case 'fish-pull': MiniGames.fishPull(); break;
        case 'fish-again':
          if (Interact.fishCast()) this.openModal('fishing');
          else { this.toast('🪱 Hết Mồi Câu rồi! Mua ở chợ (50 bạc) hoặc chờ tặng 5 mồi mỗi ngày game.', 'red'); this.closeModal(); }
          break;
        case 'lotus-pick': MiniGames.lotusPick(); break;
        case 'lotus-again': this.openModal('lotus'); break;
        case 'chess-cell': MiniGames.chessMove(+el.dataset.x, +el.dataset.y); break;
        case 'chess-again': MiniGames.newChess(); MiniGames.renderChess(); break;
        case 'chess-resign': MiniGames.chessResign(); break;
        case 'toggle-auto': Battle.toggleAuto(); break;
        case 'toggle-auto-skill': Battle.toggleAutoSkill(); break;
        case 'skill': Battle.triggerSkill(+el.dataset.i); break;
        case 'pause': Battle.togglePause(); break;
        case 'battle-speed': Battle.cycleSpeed(); break;
        case 'battle-exit': this.openModal('exit-battle'); break;
        case 'battle-exit-yes': this.closeModal(); Battle.exit(); break;
        case 'battle-restart': Battle.restart(); break;
        case 'battle-again': this.hideResult(); Battle.restart(); break;
        case 'result-world': this.hideResult(); Battle.exit(); break;
        /* SHOP-BEGIN */
        case 'merchant-shop': $('#dialogue').classList.remove('on'); SaveManager.save(); location.href = 'Shop.html'; break;
        /* SHOP-END */
        /* NPC-BEGIN — lựa chọn trong cây thoại NPC (World.chooseDialogueOption). */
        case 'dlg-option': World.chooseDialogueOption(el.dataset.npc, el.dataset.node, +el.dataset.i); break;
        case 'close-dialogue': $('#dialogue').classList.remove('on'); break;
        case 'save-now': SaveManager.save(); this.toast('Đã lưu tiến trình!', 'green'); break;
        case 'reset-ask': this.openModal('reset'); break;
        case 'reset-yes': SaveManager.reset(); location.reload(); break;
        case 'help': this.openModal('help'); break;
        default: break;
      }
    });

    document.addEventListener('submit', e => {
      if (e.target && e.target.id === 'chat-form') {
        e.preventDefault();
        const input = $('#chat-input');
        const log = $('#chat-log');
        if (!input || !input.value.trim() || !log) return;
        const line = document.createElement('div');
        line.className = 'me';
        line.innerHTML = `<b>[Bạn] ${esc(State.player.name)}:</b> ${esc(input.value.trim())}`;
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
        input.value = '';
        Sfx.click();
      }
    });

    document.addEventListener('keydown', e => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      const modalOpen = $('#modal').classList.contains('on');
      const resultOpen = $('#result').classList.contains('on');
      if (e.key === 'Escape') {
        e.preventDefault();
        if (resultOpen) { this.hideResult(); Battle.exit(); return; }
        if (modalOpen) return this.closeModal();
        if ($('#dialogue').classList.contains('on')) return $('#dialogue').classList.remove('on');
        if (Game.mode === 'info') return Info.close();
        if (Game.mode === 'battle') return this.openModal('exit-battle');
        return this.openModal('settings');
      }
      if (k === 'c') {
        if (modalOpen) return;
        this.hideResult();
        if (Game.mode === 'info') Info.close();
        else if (Game.mode === 'world' || Game.mode === 'battle') Info.open(State.leader);
      } else if (k === 'b') {
        if (modalOpen) return;
        if (Game.mode === 'world') this.openModal('arena');
      } else if (k === 'q') {
        if (!modalOpen && Game.mode === 'world') this.openModal('quests');
      } else if (k === 'h') {
        if (!modalOpen) this.openModal('help');
      } else if (Game.mode === 'battle' && /^[1-4]$/.test(e.key) && !modalOpen) {
        Battle.triggerSkill(parseInt(e.key, 10) - 1);
      }
    });

    $('#modal').addEventListener('click', e => {
      if (e.target && e.target.id === 'modal') this.closeModal();
    });
  }
});
