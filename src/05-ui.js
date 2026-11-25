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
        <button class="mini-btn" data-act="open-battle">⚔️ Tỷ Võ Đài</button>
        <button class="mini-btn" data-act="open-skills">🐉 Tuyệt học</button>
      </div>

      <div class="quest-track" data-act="open-quests" title="Mở nhiệm vụ">
        <b><span>📜 Hành Tẩu Giang Hồ</span><span class="muted">[xem]</span></b>
        <div class="qt-desc" id="w-quest-desc">• Chưa có nhiệm vụ</div>
        <div class="qt-bar"><i id="w-quest-fill" style="width:0%"></i></div>
      </div>

      <div class="side-dock">
        <button class="side-btn" data-act="open-info" title="Hồ sơ nhân vật (C)">🥋</button>
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
  },

  syncBattle(force) {
    if (!Battle.active || !Battle.allies.length) return;
    const leader = Battle.allies[0];
    if (!leader) return;
    const hero = HERO_DEFS[leader.heroIndex || 0];
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

    const ready = SKILLS.reduce((a, s) => a + (s.currentCd <= 0 ? 1 : 0), 0) / SKILLS.length;
    const mpPct = Math.round(35 + ready * 65);
    const mb = $('#b-mp'); if (mb) mb.style.width = mpPct + '%';
    set('b-mptext', mpPct + '%');

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

    SKILLS.forEach((s, i) => {
      const el = document.getElementById('cd-' + i);
      if (!el) return;
      if (s.currentCd > 0) { el.classList.remove('hidden'); el.textContent = Math.ceil(s.currentCd); }
      else el.classList.add('hidden');
      const lv = el.parentElement.querySelector('.lv');
      if (lv) lv.textContent = 'Lv.' + (s.lvl || 10);
    });
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
    const cfg = this.modalHTML(kind, data || {});
    if (!cfg) return;
    $('#modal-icon').textContent = cfg.icon;
    $('#modal-title').textContent = cfg.title;
    $('#modal-body').innerHTML = cfg.body;
    m.classList.add('on');
    m.setAttribute('aria-hidden', 'false');
    Sfx.click();
  },

  closeModal() {
    const m = $('#modal');
    if (!m) return;
    m.classList.remove('on');
    m.setAttribute('aria-hidden', 'true');
  },

  modalHTML(kind, d) {
    const p = State.player;
    if (kind === 'tip') {
      const [title, body] = String(d.tip || 'Thông tin|').split('|');
      return { icon: '📖', title: title, body: `<p style="line-height:1.7">${esc(body)}</p>` };
    }
    if (kind === 'gear') {
      const h = HERO_DEFS[Info.index];
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
      const h = HERO_DEFS[Info.index];
      const body = `<p class="muted">Đã kích hoạt ${h.fates.filter(f => f[2]).length}/${h.fates.length} duyên phận của ${esc(h.name)}.</p>` +
        h.fates.map(f => `<div class="mrow"><div><div class="mt">${f[2] ? '🔆' : '🔅'} ${esc(f[0])} ${f[2] ? '<span class="tag green">Đã kích hoạt</span>' : '<span class="tag red">Chưa</span>'}</div><div class="ms">${esc(f[1])}</div></div></div>`).join('');
      return { icon: '🔆', title: 'Duyên phận · ' + h.name, body };
    }
    if (kind === 'arena') {
      const body = Object.keys(ARENAS).map(k => {
        const a = ARENAS[k];
        return `<div class="mrow">
          <div><div class="mt">${a.icon} ${a.name} <span class="tag ${k === 'city' ? 'red' : k === 'buddha' ? 'blue' : 'green'}">${k === 'city' ? 'Khó' : k === 'buddha' ? 'Trung' : 'Dễ'}</span></div>
          <div class="ms">${a.tip}<br>Thưởng: +${fmt(a.exp)} EXP · +${fmt(a.silver)} bạc · ${a.gold} KNB</div></div>
          <button class="btn" data-act="arena-start" data-arena="${k}">Khiêu chiến</button>
        </div>`;
      }).join('');
      return { icon: '⚔️', title: 'Chọn chiến trường', body: `<p class="muted" style="margin-bottom:8px">Ba chiến trường, ba độ khó. Đánh bại 3 đợt ma giáo để nhận thưởng lớn.</p>${body}` };
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
      const cells = State.inventory.map((it, i) => `
        <div class="bag-cell" data-act="use-item" data-i="${i}" title="${esc(it.desc)}">
          <div class="bi">${it.icon || '📦'}</div>
          <div class="bn">${esc(it.name)}</div>
          <div class="bq">x${it.qty}</div>
        </div>`).join('');
      const body = `<p class="muted tiny" style="margin-bottom:6px">Túi đồ ${p.capacity}/${p.maxCapacity} · chạm vật phẩm để dùng</p>
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
      const body = `
        <div class="mrow"><span>Âm thanh & hiệu ứng</span><button class="btn sm" data-act="toggle-mute">${Sfx.muted ? 'Đang tắt' : 'Đang bật'}</button></div>
        <div class="mrow"><span>Tự động đánh</span><button class="btn sm" data-act="toggle-auto">${State.settings.autoBattle ? 'BẬT' : 'TẮT'}</button></div>
        <div class="mrow"><span>Tự tung chiêu</span><button class="btn sm" data-act="toggle-auto-skill">${State.settings.autoSkill ? 'BẬT' : 'TẮT'}</button></div>
        <div class="mrow"><span>Lưu tiến trình</span><button class="btn sm" data-act="save-now">Lưu ngay</button></div>
        <div class="mrow"><span>Khôi phục dữ liệu ban đầu</span><button class="btn sm red" data-act="reset-ask">Đặt lại</button></div>
        <p class="muted tiny">Mộng Võ Lâm 3D · Soha · Three.js + PixiJS · lưu cục bộ trong trình duyệt.</p>`;
      return { icon: '⚙️', title: 'Cài đặt hệ thống', body };
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
        case 'arena-start': this.closeModal(); Battle.start(el.dataset.arena); break;
        case 'arena': if (Battle.active) Battle.start(el.dataset.arena); break;
        case 'open-shop': this.openModal('shop'); break;
        case 'open-bag': this.openModal('bag'); break;
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
        case 'merchant-shop': $('#dialogue').classList.remove('on'); this.openModal('shop'); break;
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
