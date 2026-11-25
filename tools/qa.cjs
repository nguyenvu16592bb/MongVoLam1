// QA Playwright + Chrome tháº­t: tháº¿ giá»›i â†’ há»“ sÆ¡ â†’ chá»£ â†’ 3 Ä‘áº¥u trÆ°á»ng â†’ káº¿t quáº£
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/New folder/Hangrong/gen rig/node_modules/playwright-core');

const URL = 'http://127.0.0.1:8099/mongvolam.html';
const OUT = path.join(__dirname, '..', '.zwork', 'qa');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
  });
  const report = { errors: [], console: [], checks: {} };

  async function run(label, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.setDefaultTimeout(120000);
    page.on('pageerror', e => report.errors.push(label + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') report.console.push(label + ': ' + m.text()); });

    const tap = async (sel, name) => {
      try {
        await page.click(sel, { timeout: 4000 });
      } catch (e) {
        report.console.push(label + ' fallback-click ' + (name || sel) + ': ' + e.message.split('\n')[0]);
        await page.evaluate(s => { const el = document.querySelector(s); if (el) el.click(); }, sel);
      }
      await sleep(260);
    };

    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.MVL && window.MVL.Game.booted, null, { timeout: 40000 });
    await sleep(1700);
    await page.screenshot({ path: path.join(OUT, label + '-world.png'), timeout: 120000 });
    report.checks[label + '-world'] = await page.evaluate(() => ({
      mode: MVL.Game.mode,
      level: document.querySelector('#w-level')?.textContent,
      names: document.querySelectorAll('#nameplates .nameplate').length,
      dupIds: (() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.filter((v, i) => ids.indexOf(v) !== i); })(),
      calls: MVL.Game.renderer.info.render.calls,
      tris: MVL.Game.renderer.info.render.triangles
    }));

    await tap('.side-btn[data-act="open-info"]', 'open-info');
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, label + '-info.png') });
    report.checks[label + '-info'] = await page.evaluate(() => ({
      mode: MVL.Game.mode,
      name: document.querySelector('#ii-rname')?.textContent,
      squad: document.querySelectorAll('#ii-squad .hero-slot').length,
      slots: document.querySelectorAll('.equip').length,
      eq: document.querySelectorAll('#ii-eq .eq').length,
      fates: document.querySelectorAll('#ii-fates li').length,
      canvas: (() => { const c = document.querySelector('#info-canvas'); return c.width + 'x' + c.height; })(),
      infoH: document.querySelector('#info-screen').scrollHeight
    }));

    await tap('#ii-squad .hero-slot[data-i="2"]', 'hero-slot');
    const before = await page.evaluate(() => ({ silver: MVL.State.player.silver, lvl: MVL.State.heroes[2].level }));
    await tap('[data-act="cultivate"]', 'cultivate');
    await sleep(450);
    const after = await page.evaluate(() => ({ silver: MVL.State.player.silver, lvl: MVL.State.heroes[2].level }));
    report.checks[label + '-cultivate'] = { name: await page.textContent('#ii-rname'), before, after };
    await page.screenshot({ path: path.join(OUT, label + '-info2.png') });

    await tap('.info-close', 'close-info');
    await tap('.dock-btn[data-act="open-shop"]', 'open-shop');
    await page.screenshot({ path: path.join(OUT, label + '-shop.png') });
    report.checks[label + '-shop'] = await page.evaluate(() => ({
      open: document.querySelector('#modal').classList.contains('on'),
      items: document.querySelectorAll('.shop-item').length
    }));
    const goldBefore = await page.evaluate(() => MVL.State.player.gold);
    await tap('[data-act="buy"][data-id="s3"]', 'buy');
    report.checks[label + '-buy'] = { goldBefore, goldAfter: await page.evaluate(() => MVL.State.player.gold), atk: await page.evaluate(() => MVL.State.player.atk) };
    await tap('[data-act="close-modal"]', 'close-modal');

    await tap('.dock-btn[data-act="open-battle"]', 'open-battle');
    report.checks[label + '-arenaModal'] = await page.evaluate(() => document.querySelectorAll('[data-act="arena-start"]').length);
    await tap('[data-act="arena-start"][data-arena="buddha"]', 'start-buddha');
    await sleep(1400);
    await page.screenshot({ path: path.join(OUT, label + '-battle.png') });

    try { await page.click('.arena-tab[data-arena="city"]', { timeout: 5000 }); }
    catch (e) { await page.evaluate(() => MVL.Battle.start('city')); }
    await sleep(1100);
    await page.screenshot({ path: path.join(OUT, label + '-battle-city.png') });
    report.checks[label + '-arenaSwitch'] = await page.evaluate(() => MVL.Battle.arena);

    await page.evaluate(() => { MVL.Battle.triggerSkill(0); MVL.Battle.triggerSkill(3); });
    await sleep(700);
    await page.screenshot({ path: path.join(OUT, label + '-battle2.png') });
    report.checks[label + '-battle'] = await page.evaluate(() => ({
      mode: MVL.Game.mode,
      arena: MVL.Battle.arena,
      allies: MVL.Battle.allies.length,
      enemies: MVL.Battle.enemies.length,
      labels: document.querySelectorAll('#labels .unit-label').length,
      hud: document.querySelector('#hud-battle').classList.contains('on'),
      wave: document.querySelector('#wave-tag')?.textContent,
      skills: [...document.querySelectorAll('.skill-slot')].length
    }));

    await page.evaluate(() => { MVL.Battle.speed = 5; MVL.State.settings.autoBattle = true; MVL.State.settings.autoSkill = true; });
    try {
      await page.waitForFunction(() => document.querySelector('#result')?.classList.contains('on'), null, { timeout: 120000 });
      await sleep(700);
    } catch (e) { report.errors.push(label + ': battle not finished'); }
    await page.screenshot({ path: path.join(OUT, label + '-result.png') });
    report.checks[label + '-result'] = await page.evaluate(() => ({
      open: document.querySelector('#result')?.classList.contains('on'),
      title: document.querySelector('.rtitle')?.textContent,
      wave: MVL.Battle.wave,
      finished: MVL.Battle.finished,
      stats: JSON.parse(JSON.stringify(MVL.State.stats))
    }));

    await tap('[data-act="result-world"]', 'result-world');
    await page.screenshot({ path: path.join(OUT, label + '-back.png') });
    report.checks[label + '-back'] = await page.evaluate(() => ({ mode: MVL.Game.mode, hudWorld: document.querySelector('#hud-world').classList.contains('on') }));

    await ctx.close();
  }

  await run('desk', { width: 1120, height: 700 });
  await run('mob', { width: 430, height: 900 });

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ errors: report.errors, console: report.console, checks: report.checks }, null, 2));
})().catch(e => { console.error('QA FAILED', e); process.exit(1); });
