/* ============================================================================
   PHẦN 3 — HỒ SƠ NHÂN VẬT (từ table infoscene): bàn thờ 3D + duyên phận
   ========================================================================== */

function heroAvatarSVG(h, uid) {
  const id = 'av' + (uid || Math.random().toString(36).slice(2, 7));
  const mask = h.mask
    ? `<path d="M30 44 Q50 52 70 44 L68 56 Q50 60 32 56 Z" fill="${h.mask}"/>`
    : `<path d="M40 47 Q43 44 46 47" stroke="#3b230a" stroke-width="2" fill="none"/><path d="M54 47 Q57 44 60 47" stroke="#3b230a" stroke-width="2" fill="none"/>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <defs><radialGradient id="${id}" cx="50%" cy="32%" r="70%">
      <stop offset="0%" stop-color="${h.ribbon}"/><stop offset="100%" stop-color="#140c07"/>
    </radialGradient></defs>
    <rect width="100" height="100" fill="url(#${id})"/>
    <path d="M18 96 Q50 66 82 96 Z" fill="${h.robe}" stroke="#f0b429" stroke-width="2"/>
    <circle cx="50" cy="46" r="27" fill="${h.hair}"/>
    <circle cx="50" cy="50" r="21" fill="#fde0b6"/>
    ${mask}
    <circle cx="42" cy="50" r="3.1" fill="${h.mask ? '#fde047' : '#14202a'}"/>
    <circle cx="58" cy="50" r="3.1" fill="${h.mask ? '#fde047' : '#14202a'}"/>
    <path d="M46 61 Q50 64 54 61" stroke="#9a4b2a" stroke-width="1.8" fill="none"/>
    <path d="M50 24 L58 32 L50 40 L42 32 Z" fill="#f0b429" opacity=".85"/>
  </svg>`;
}

const GEAR_LV = { talent: 10, mind: 9, ultimate: 2, weapon: 950, hat: 1, armor: 301, ring: 250 };

const Info = {
  built: false,
  openFlag: false,
  index: 0,
  prevMode: 'world',
  renderer: null,
  scene: null,
  camera: null,
  chibi: null,
  sword: null,
  qiRing: null,
  robeMat: null,
  hairMat: null,
  maskMesh: null,
  bladeMat: null,
  sparks: [],
  targetRot: .18,
  dragging: false,
  prevX: 0,
  clock: null,

  /* ---------- DOM ---------- */
  build() {
    if (this.built) return;
    this.built = true;
    const host = $('#info-screen');
    host.innerHTML = `
      <div class="info-left">
        <div class="info-marquee">
          <span>⚠️ Chơi quá 180 phút mỗi ngày có hại cho sức khỏe</span>
          <span class="muted">|</span>
          <span>Máy chủ: <b>S1 — Thiên Môn Thần Thú</b></span>
        </div>

        <div class="info-header">
          <div class="info-ava">
            ${heroAvatarSVG(HERO_DEFS[1], 'hd')}
            <div class="lvb">${State.player.level}</div>
          </div>
          <div class="info-id">
            <div class="row1"><b>${esc(State.player.name)}</b><span class="vip">VIP 14</span></div>
            <div class="bar hp"><i id="ii-hpfill" style="width:78%"></i><span id="ii-hptext">500/500</span></div>
            <div class="bar exp"><i id="ii-exp" style="width:40%"></i></div>
          </div>
          <div class="info-stam" title="Thể lực"><span class="si">🏃</span><span id="ii-stam">120/120</span></div>
          <div class="info-res">
            <div class="r g">🪙 <span id="ii-gold">455</span></div>
            <div class="r s">⚪ <span id="ii-silver">40.932</span></div>
          </div>
        </div>

        <div class="info-squad" id="ii-squad"></div>

        <div class="info-stage" id="ii-stage">
          <div class="aura-ring"></div>
          <canvas id="info-canvas"></canvas>
          <div class="stage-title" id="ii-title"></div>
          <div class="slots left" id="ii-slot-l"></div>
          <div class="slots right" id="ii-slot-r"></div>
          <div class="stage-foot">
            <div class="sn" id="ii-hname">Đế Thích Thiên</div>
            <div class="sh"><b id="ii-lvl">400</b><span id="ii-hp">0 / 0</span></div>
          </div>
        </div>

        <div class="info-stats">
          <div class="st-head"><div>Tư chất</div><div>Thực lực</div><div>Thần thông</div></div>
          <div class="st-grid">
            <div class="st-col" id="ii-sc1"></div>
            <div class="st-col b" id="ii-sc2"></div>
            <div class="st-col b" id="ii-sc3"></div>
            <div class="st-btns">
              <div class="two">
                <button data-act="info-tip" data-tip="Nguyên Khí Đan Điền|Tụ hội chân khí trời đất, tăng 15% tốc độ hồi nội lực khi giao chiến.">Khí</button>
                <button data-act="info-tip" data-tip="Bảo Khí Trấn Phái|Pháp bảo hộ thân giúp giảm 20% sát thương chí mạng từ kẻ địch.">Bảo</button>
              </div>
              <button class="help" data-act="info-tip" data-tip="Hướng Dẫn|Kéo chuột vào nhân vật 3D để xoay 360°. Bấm các ô trang bị để xem chi tiết, bấm Bồi Dưỡng để tăng chỉ số.">?</button>
            </div>
          </div>
        </div>

        <div class="info-nav">
          <button data-act="info-tip" data-tip="Đội Hình Xuất Chiến|Trận pháp Ngũ Hành Bát Quái cấp 12, tăng 18% toàn bộ chỉ số đội hình.">👥 Đội hình</button>
          <button data-act="info-tip" data-tip="Chiến Thuật Môn Phái|Ưu tiên đánh hàng sau, tăng 20% sát thương kỹ năng quần thể.">♟️ Chiến thuật</button>
          <button data-act="info-tip" data-tip="Sư Môn Thiên Môn|Chức vị: Chưởng Môn Nhân. Uy danh giang hồ: Độc Cô Cầu Bại.">⛩️ Sư Môn</button>
          <button data-act="info-bag">🎒 Túi đồ</button>
        </div>
      </div>

      <div class="info-right">
        <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
        <button class="info-close" data-act="close-info" aria-label="Đóng hồ sơ">✕</button>
        <div class="info-orn">☁️ ☸ ☁️</div>

        <div class="info-hero">
          <div class="frame">
            <div class="in" id="ii-ava"></div>
            <div class="lvb" id="ii-avalv">400</div>
            <div class="stars"><span class="js-stars">★★★</span></div>
          </div>
          <div class="info-nums" id="ii-nums"></div>
        </div>

        <div class="info-name"><span class="badge" id="ii-type">Giáp</span><h1 id="ii-rname">Đế Thích Thiên</h1></div>

        <div class="bio-box">
          <p id="ii-bio"></p>
          <div class="talent" data-act="info-tip" data-tip="" id="ii-talent-box">
            <span>Thiên Phú</span>
            <div class="ti">🌀</div>
          </div>
        </div>

        <div class="eq-list" id="ii-eq"></div>
        <div class="skill-mini" id="ii-skillmini"></div>

        <div class="fate-head">
          <h2>Duyên phận</h2>
          <button data-act="fate-detail">Chi tiết</button>
        </div>
        <ul class="fate-list" id="ii-fates"></ul>

        <div class="info-logo">
          <div class="l1">MỘNG <b>3D</b> VÕ LÂM</div>
          <div class="l2">CỬU NGŨ CHÍ TÔN</div>
        </div>

        <div class="info-actions">
          <button class="btn-gold" data-act="cultivate">Bồi Dưỡng</button>
          <button class="btn-ghost2" data-act="deploy">Xuất Chiến</button>
        </div>
      </div>`;

    this.buildSquad();
    this.buildGear();
    this.bind3DInput();
  },

  buildSquad() {
    const box = $('#ii-squad');
    box.innerHTML = State.heroes.map((hs, i) => {
      const h = HERO_DEFS[i];
      return `<div class="hero-slot ${i === this.index ? 'active' : ''}" data-act="info-select" data-i="${i}" title="${esc(h.name)} · ${esc(h.title)}">
        ${heroAvatarSVG(h, 'sq' + i)}
        <span class="hl">${h.level}</span>
        <span class="stars">★★★</span>
      </div>`;
    }).join('') + `<div class="squad-form" data-act="info-tip" data-tip="Trận Hình Ngũ Hành|Đang kích hoạt đội hình 5 Đại Tông Sư. Lực chiến tổng: 310.420.890."><span class="si">⚔</span>TRẬN<br>HÌNH</div>`;
  },

  buildGear() {
    const left = [['talent', '🌀'], ['mind', '📜'], ['ultimate', '🐲']];
    const right = [['weapon', '⚔️'], ['hat', '👑'], ['armor', '👘'], ['ring', '💍']];
    const html = list => list.map(([slot, icon]) => {
      const meta = GEAR_META[slot];
      return `<div class="equip ${meta.tier}" data-act="info-gear" data-slot="${slot}" title="${meta.label}">
        <span class="lv">${GEAR_LV[slot]}</span>${icon}
        <div class="st">${'★'.repeat(slot === 'weapon' || slot === 'armor' || slot === 'hat' || slot === 'ring' ? 5 : 3)}</div>
      </div>`;
    }).join('');
    $('#ii-slot-l').innerHTML = html(left);
    $('#ii-slot-r').innerHTML = html(right);
  },

  /* ---------- mở/đóng ---------- */
  open(idx) {
    this.build();
    this.prevMode = (Game.mode === 'battle' && Battle.active) ? 'battle' : 'world';
    Game.mode = 'info';
    this.openFlag = true;
    $('#info-screen').classList.add('on');
    $('#info-screen').setAttribute('aria-hidden', 'false');
    $('#dialogue').classList.remove('on');
    UI.showScreen('info');
    this.select(typeof idx === 'number' ? idx : State.leader, true);
    requestAnimationFrame(() => {
      this.resize();
      this.applyHeroColors(HERO_DEFS[this.index]);
      this.targetRot = .18;
      this.clock = new THREE.Clock();
      this.animate();
    });
  },

  close() {
    this.openFlag = false;
    $('#info-screen').classList.remove('on');
    $('#info-screen').setAttribute('aria-hidden', 'true');
    const back = (this.prevMode === 'battle' && Battle.active) ? 'battle' : 'world';
    Game.mode = back;
    UI.showScreen(back);
    if (back === 'battle') UI.syncBattle(true);
    else UI.syncWorld();
  },

  select(i, keepCam) {
    this.index = clamp(i, 0, HERO_DEFS.length - 1);
    const h = HERO_DEFS[this.index];
    const st = heroStats(h.id);
    State.leader = this.index;
    if (!keepCam) this.targetRot = .18;

    $$('#ii-squad .hero-slot').forEach((el, k) => el.classList.toggle('active', k === this.index));
    $('#ii-title').textContent = h.title;
    $('#ii-hname').textContent = h.name;
    $('#ii-lvl').textContent = h.level;
    $('#ii-hp').textContent = fmt(st.hp) + ' / ' + fmt(st.hp);
    $('#ii-ava').innerHTML = heroAvatarSVG(h, 'big');
    $('#ii-avalv').textContent = h.level;
    $('#ii-rname').textContent = h.name;
    $('#ii-type').textContent = h.type;
    $('#ii-bio').textContent = h.bio;
    $('#ii-talent-box').setAttribute('data-tip', 'Thiên Phú: ' + h.innate + '|Tuyệt học thiên phú của ' + h.name + ', tự động kích hoạt khi giao chiến.');
    $('#ii-nums').innerHTML = [
      ['Mệnh', 'm', st.hp], ['Thủ', 't', st.def], ['Công', 'c', st.atk], ['Khí', 'q', st.qi]
    ].map(x => `<div class="n"><span class="k ${x[1]}">${x[0]}</span><span class="v">${fmt(x[2])}</span></div>`).join('');

    $('#ii-sc1').innerHTML = [
      ['Mệnh', 'm', st.hp], ['Công', 'c', st.atk], ['Thủ', 't', st.def], ['Khí', 'q', st.qi]
    ].map(x => `<div class="st-row"><span class="k ${x[1]}">${x[0]}</span><span class="v">${fmt(x[2])}</span></div>`).join('');
    $('#ii-sc2').innerHTML = [
      ['❤', st.hp], ['⚔', st.atk], ['🛡', st.def], ['☯', st.qi]
    ].map(x => `<div class="st-row"><span>${x[0]}</span><span class="v">${fmt(x[1])}</span></div>`).join('');
    $('#ii-sc3').innerHTML = [
      ['✦', st.crit], ['⚡', '0.10'], ['📜', '3.86'], ['☸', fmt(st.qi * .1)]
    ].map(x => `<div class="st-row"><span>${x[0]}</span><span class="v">${x[1]}</span></div>`).join('');

    const fates = h.fates || [];
    $('#ii-fates').innerHTML = fates.map(f => `<li><b>${esc(f[0])}:</b> ${esc(f[1])}</li>`).join('')
      || '<li class="muted">Chưa kích hoạt duyên phận nào.</li>';

    const eq = $('#ii-eq');
    if (eq) {
      eq.innerHTML = [
        ['⚔️', h.weapon, GEAR_LV.weapon],
        ['👑', h.hat, GEAR_LV.hat],
        ['👘', h.armor, GEAR_LV.armor],
        ['💍', h.ring, GEAR_LV.ring]
      ].map(x => `<div class="eq"><span class="ei">${x[0]}</span><span>${esc(x[1])} <b>+${x[2]}</b></span></div>`).join('');
    }

    const mini = $('#ii-skillmini');
    if (mini) {
      mini.innerHTML = [
        ['👊', 'Song Ma Quyền', 10, 82],
        ['🔥', 'Liệt Hỏa Chưởng', 9, 64],
        ['🌪️', 'Vô Ảnh Cước', 9, 48]
      ].map(x => `<div class="sm"><span class="i">${x[0]}</span><span>${x[1]}</span><span style="color:#8c1616">Lv.${x[2]}</span><span class="bar"><i style="width:${x[3]}%"></i></span></div>`).join('');
    }

    $('#ii-gold').textContent = fmtFull(State.player.gold);
    $('#ii-silver').textContent = fmtFull(State.player.silver);
    const fillHp = $('#ii-hpfill');
    if (fillHp) fillHp.style.width = clamp(State.player.hp / State.player.maxHp * 100, 0, 100) + '%';
    $('#ii-hptext').textContent = Math.round(State.player.hp) + '/' + State.player.maxHp;
    const fillExp = $('#ii-exp');
    if (fillExp) fillExp.style.width = clamp(State.player.exp / State.player.maxExp * 100, 0, 100) + '%';
    $('#ii-stam').textContent = State.player.capacity + '/' + State.player.maxCapacity;

    this.applyHeroColors(h);
    SaveManager.save();
  },

  /* ---------- 3D ---------- */
  build3D() {
    if (this.renderer) return;
    const canvas = $('#info-canvas');
    if (!canvas) return;
    const stage = $('#ii-stage');
    const w = Math.max(200, stage.clientWidth), h = Math.max(160, stage.clientHeight);

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, w / h, .1, 100);
    this.camera.position.set(0, 1.4, 6.1);
    this.camera.lookAt(0, 1.02, 0);

    this.scene.add(new THREE.AmbientLight(0xfff0d4, 1.05));
    const key = new THREE.DirectionalLight(0xffdf85, 1.7);
    key.position.set(3, 5, 4); this.scene.add(key);
    const rim = new THREE.PointLight(0xa855f7, 2.1, 12);
    rim.position.set(-2.5, 2.5, -2); this.scene.add(rim);
    const sword = new THREE.PointLight(0xff6b00, 2.2, 7);
    sword.position.set(-1.2, 2, 1.5); this.scene.add(sword);

    const g = new THREE.Group();
    this.scene.add(g);
    this.chibi = g;

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xfde0b6, roughness: .4 });
    this.robeMat = new THREE.MeshStandardMaterial({ color: 0x9e1b1b, roughness: .5, metalness: .15 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xf5b935, roughness: .25, metalness: .85 });
    this.hairMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: .35 });
    const maskMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: .2, metalness: .9 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: .7 });

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, .14, 32),
      new THREE.MeshStandardMaterial({ color: 0x4c1d95, emissive: 0x6b21a8, emissiveIntensity: .55, metalness: .7, roughness: .2 }));
    pedestal.position.y = .05; g.add(pedestal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.18, .04, 12, 48), goldMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = .12; g.add(ring);

    const legGeo = new THREE.CylinderGeometry(.16, .18, .55, 16);
    const l1 = new THREE.Mesh(legGeo, pantsMat); l1.position.set(-.26, .42, .05); l1.rotation.z = .12; g.add(l1);
    const l2 = new THREE.Mesh(legGeo, pantsMat); l2.position.set(.28, .42, -.05); l2.rotation.z = -.15; g.add(l2);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(.36, .52, .85, 20), this.robeMat);
    torso.position.y = 1.02; torso.castShadow = true; g.add(torso);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(.41, .07, 12, 24), goldMat);
    belt.rotation.x = Math.PI / 2; belt.position.y = .85; g.add(belt);

    const shoulder = new THREE.SphereGeometry(.24, 16, 16);
    const s1 = new THREE.Mesh(shoulder, goldMat); s1.position.set(-.46, 1.32, 0); g.add(s1);
    const s2 = new THREE.Mesh(shoulder, goldMat); s2.position.set(.46, 1.32, 0); g.add(s2);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.92, .05);
    g.add(headGroup);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.56, 32, 32), skinMat);
    headGroup.add(head);

    this.maskMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(.57, .57, .22, 32, 1, true, -Math.PI * .35, Math.PI * .7), maskMat);
    this.maskMesh.position.y = .04; headGroup.add(this.maskMesh);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const eyeGeo = new THREE.SphereGeometry(.06, 12, 12);
    const e1 = new THREE.Mesh(eyeGeo, eyeMat); e1.position.set(-.2, .05, .53); headGroup.add(e1);
    const e2 = new THREE.Mesh(eyeGeo, eyeMat); e2.position.set(.2, .05, .53); headGroup.add(e2);

    const hairBack = new THREE.Mesh(new THREE.SphereGeometry(.61, 24, 24, 0, Math.PI * 2, 0, Math.PI * .65), this.hairMat);
    hairBack.rotation.x = -.35; hairBack.position.set(0, .08, -.08); headGroup.add(hairBack);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(.24, 16, 16), this.hairMat);
    bun.position.set(0, .68, -.1); headGroup.add(bun);
    const crown = new THREE.Mesh(new THREE.TorusGeometry(.2, .04, 10, 20), goldMat);
    crown.rotation.x = Math.PI / 2; crown.position.set(0, .56, -.08); headGroup.add(crown);

    const sw = new THREE.Group();
    sw.position.set(-1.24, 1.15, .18);
    sw.rotation.set(.1, .12, .14);
    g.add(sw);
    this.sword = sw;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, .5, 12), goldMat);
    sw.add(hilt);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(.46, .14, .18), goldMat);
    guard.position.y = .28; sw.add(guard);
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x1e3a8a, emissiveIntensity: .4, metalness: .9, roughness: .15 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.2, 1.9, .06), this.bladeMat);
    blade.position.y = 1.26; sw.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(.185, .42, 4), this.bladeMat);
    tip.rotation.y = Math.PI / 4; tip.position.y = 2.4; sw.add(tip);

    this.qiRing = new THREE.Mesh(new THREE.TorusGeometry(1.35, .025, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: .62 }));
    this.qiRing.position.y = 1.25;
    this.qiRing.rotation.set(1.2, .3, 0);
    g.add(this.qiRing);
  },

  resize() {
    if (!this.renderer) this.build3D();
    if (!this.renderer) return;
    const stage = $('#ii-stage');
    if (!stage) return;
    const w = Math.max(160, stage.clientWidth), h = Math.max(140, stage.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  },

  bind3DInput() {
    const canvas = $('#info-canvas');
    if (!canvas) return;
    canvas.addEventListener('mousedown', e => {
      if (Game.mode !== 'info') return;
      this.dragging = true; this.prevX = e.clientX;
    });
    window.addEventListener('mousemove', e => {
      if (!this.dragging) return;
      this.targetRot += (e.clientX - this.prevX) * .015;
      this.prevX = e.clientX;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    canvas.addEventListener('touchstart', e => {
      if (Game.mode !== 'info') return;
      this.dragging = true; this.prevX = e.touches[0].clientX;
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (!this.dragging) return;
      this.targetRot += (e.touches[0].clientX - this.prevX) * .015;
      this.prevX = e.touches[0].clientX;
    }, { passive: true });
    canvas.addEventListener('touchend', () => { this.dragging = false; });
    window.addEventListener('resize', () => { if (this.openFlag) this.resize(); });
  },

  applyHeroColors(h) {
    if (!this.robeMat) return;
    this.robeMat.color.set(h.robe);
    this.hairMat.color.set(h.hair);
    this.maskMesh.visible = !!h.mask;
    if (h.mask) this.maskMesh.material.color.set(h.mask);
    if (this.bladeMat) {
      this.bladeMat.color.set(h.ribbon);
      this.bladeMat.emissive.set(h.ribbon);
      this.bladeMat.emissiveIntensity = .38;
    }
  },

  animate() {
    if (!this.openFlag) return;
    requestAnimationFrame(() => this.animate());
    if (Game.mode !== 'info') return;
    const t = this.clock ? this.clock.getElapsedTime() : 0;
    if (this.chibi) {
      this.chibi.position.y = Math.sin(t * 2.8) * .055;
      this.chibi.rotation.y += (this.targetRot - this.chibi.rotation.y) * .1;
    }
    if (this.sword) this.sword.rotation.z = .42 + Math.sin(t * 3.5) * .05;
    if (this.qiRing) this.qiRing.rotation.z = t * 1.8;
    this.updateSparks();
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  },

  burst() {
    if (!this.scene) return;
    const geo = new THREE.TetrahedronGeometry(.075, 0);
    for (let i = 0; i < 46; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xfff3a1 : i % 3 === 1 ? 0xffb020 : 0xd946ef });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(rnd(-.4, .4), rnd(.6, 1.6), rnd(-.4, .4));
      this.scene.add(m);
      this.sparks.push({ m, vx: rnd(-1.6, 1.6), vy: rnd(1.8, 4.2), vz: rnd(-1.6, 1.6), life: 1.2 });
    }
  },

  updateSparks() {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= .02;
      s.m.position.x += s.vx * .02;
      s.m.position.y += s.vy * .02;
      s.m.position.z += s.vz * .02;
      s.vy -= .08;
      s.m.rotation.x += .1; s.m.rotation.y += .08;
      s.m.material.opacity = Math.max(0, s.life);
      s.m.material.transparent = true;
      if (s.life <= 0) {
        this.scene.remove(s.m);
        s.m.geometry.dispose();
        s.m.material.dispose();
        this.sparks.splice(i, 1);
      }
    }
  },

  cultivate() {
    const h = HERO_DEFS[this.index];
    const hs = State.heroes[this.index];
    const cost = 12000;
    if (State.player.silver < cost) {
      UI.toast('Không đủ bạc để bồi dưỡng (cần ' + fmt(cost) + ')', 'red');
      return;
    }
    State.player.silver -= cost;
    hs.level += 1;
    hs.bonus.hp += 125000;
    hs.bonus.atk += 450;
    hs.bonus.def += 98000;
    hs.bonus.qi += 110000;
    hs.bonus.crit += 40;
    this.burst();
    Sfx.level();
    UI.toast(`Bồi dưỡng thành công! ${h.name} đạt cấp ${hs.level}`, 'green');
    progressQuest('q4', 1);
    this.select(this.index, true);
    SaveManager.save();
  },

  deploy() {
    State.leader = this.index;
    SaveManager.save();
    const arena = (Battle.active && Battle.arena) || 'bamboo';
    this.close();
    setTimeout(() => Battle.start(arena), 120);
  }
};
