#!/usr/bin/env node
// Phones and tablets, driven by touch in device emulation: log in and open the floor with taps,
// walk with the on-screen stick (real touch events, and two thumbs at once: stick and look), check
// the page never scrolls or zooms, walk up to blackjack, roulette and a slot machine, sit down with
// the action button, buy in, play a round by tapping chips, felt spots and buttons, and leave with
// the Leave button. Screenshots of every step go to outDir (CSS pixels).
// Usage: node scripts/e2e/mobile.mjs [port] [outDir] [devices...]   (PORT_BASE=<port> npm run dev first)
//   devices: iphone (390x844) iphone-land (844x390) pixel (Pixel 7) ipad (iPad gen 7) safari (390x664)
//   GAMES=blackjack,roulette,slots limits the tables; SHOTS_ONLY=1 skips the rounds.
// One fixed player per device, so reruns log back in (the API allows only a few new accounts an hour).

import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', out = '/tmp/casino-mobile', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? `http://localhost:${port}`;
const GAMES = (process.env.GAMES ?? 'blackjack,roulette,slots').split(',');
const STATIONS = { blackjack: 'bj-1', roulette: 'rl-us', slots: 'slots-sevens-1' };

const strip = ({ defaultBrowserType, ...d }) => d;
const DEVICES = {
  iphone: { ...strip(devices['iPhone 13']), viewport: { width: 390, height: 844 } },
  'iphone-land': { ...strip(devices['iPhone 13 landscape']), viewport: { width: 844, height: 390 } },
  pixel: strip(devices['Pixel 7']),
  ipad: strip(devices['iPad (gen 7)']),
  safari: strip(devices['iPhone 13']),
};
const NAMES = { iphone: 'mob_iphone', 'iphone-land': 'mob_iphland', pixel: 'mob_pixel', ipad: 'mob_ipad', safari: 'mob_safari' };
const list = wanted.length ? wanted : ['iphone', 'iphone-land', 'pixel', 'ipad'];

// The site's back chip (j4den.com's back.css), injected so the shots show what shares the corner.
const BACK_CSS = `.j4-back{position:fixed;bottom:14px;left:14px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px 0 9px;border-radius:15px;border:1px solid rgba(140,150,160,.34);background:rgba(18,20,22,.82);color:#e6e3db;font:11.5px ui-monospace,monospace;letter-spacing:.7px;text-transform:uppercase;text-decoration:none;opacity:.62}
.j4-back svg{width:13px;height:13px}
@media (max-width:640px){.j4-back{gap:0;padding:0;width:30px;justify-content:center}.j4-back span{display:none}}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const failures = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const key of list) {
  const ctx = await browser.newContext({ ...DEVICES[key] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const fail = (what) => {
    failures.push(`${key}: ${what}`);
    log(`FAIL ${key}: ${what}`);
  };
  let n = 0;
  const shot = (name) => page.screenshot({ path: `${out}/${key}-${String(++n).padStart(2, '0')}-${name}.png`, scale: 'css' });

  // --- touch helpers ------------------------------------------------------------------------------
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  /** Hold fingers down and slide each from its start to its end over `ms`, then keep them there `hold` ms. */
  async function drag(paths, ms = 600, hold = 0, during) {
    await touch('touchStart', paths.map((p) => p[0]));
    const steps = Math.max(2, Math.round(ms / 32));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      await touch('touchMove', paths.map(([a, b]) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]));
      await sleep(ms / steps);
    }
    const t0 = Date.now();
    while (Date.now() - t0 < hold) {
      // a held finger still reports now and then, like a real one
      await touch('touchMove', paths.map((p) => p[1]));
      if (during && (await during())) break;
      await sleep(80);
    }
    await touch('touchEnd', []);
  }
  const box = async (sel) => (await page.locator(sel).first().boundingBox()) ?? null;
  const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2];
  const tap = (sel) => page.locator(sel).first().tap({ timeout: 10_000 });
  const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);
  const where = () => page.evaluate(() => ({ x: window.casino.world.player.position.x, z: window.casino.world.player.position.z }));
  const camYaw = () =>
    page.evaluate(() => {
      const c = window.casino.engine.camera;
      const e = c.matrixWorld.elements;
      return Math.atan2(-e[8], -e[10]);
    });

  /** Stand the player `back` metres out from a station's player side, facing it. */
  const approach = (id, back) =>
    page.evaluate(
      ([id, back]) => {
        const w = window.casino.world;
        const s = w.stations.find((x) => x.id === id);
        const a = s.anchor;
        const V = a.position.constructor;
        const p = a.localToWorld(new V(0, 0, s.footprint.depth / 2 + back));
        const q = a.getWorldPosition(new V());
        w.teleport(p.x, p.z, Math.atan2(q.x - p.x, q.z - p.z));
      },
      [id, back],
    );

  /** A table-local point (metres, on the felt) on screen. */
  const onScreen = (lx, lz) =>
    page.evaluate(
      ([lx, lz]) => {
        const s = window.casino.app.table.session.stage;
        const V = s.root.position.constructor;
        const y = s.felts[0]?.mesh.position.y ?? 0.8;
        const v = s.root.localToWorld(new V(lx, y, lz)).project(s.engine.camera);
        return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
      },
      [lx, lz],
    );
  const tableView = () => page.evaluate(() => window.casino.app.table?.session.view?.v ?? null);

  // --- the steps ----------------------------------------------------------------------------------
  async function login() {
    await page.goto(`${base}/casino/`);
    await page.addStyleTag({ content: BACK_CSS });
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.className = 'j4-back';
      a.href = '#';
      const ns = 'http://www.w3.org/2000/svg';
      const s = document.createElementNS(ns, 'svg');
      s.setAttribute('viewBox', '0 0 16 16');
      s.setAttribute('fill', 'none');
      s.setAttribute('stroke', 'currentColor');
      s.setAttribute('stroke-width', '1.8');
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', 'M9.8 3.2 5 8l4.8 4.8');
      s.append(p);
      const t = document.createElement('span');
      t.textContent = 'j4den';
      a.append(s, t);
      document.body.prepend(a);
    });
    await page.waitForSelector('.name-input, .menu-item', { timeout: 240_000 });
    await sleep(700);
    await shot('login');
    if (await visible('.continue-btn')) {
      await tap('.continue-btn');
    } else if (await visible('.name-input')) {
      await tap('.name-input');
      await page.fill('.name-input', NAMES[key]);
      await tap('.enter-btn');
    }
    await page.waitForSelector('.menu-item', { timeout: 30_000 });
    await sleep(900);
    await shot('menu');
    await tap('.menu-item >> nth=0');
    await page.waitForSelector('.hud', { timeout: 30_000 });
    await page.waitForFunction(() => document.documentElement.classList.contains('touch-ui') && !document.querySelector('.touch-layer')?.hidden, null, { timeout: 10_000 }).catch(() => fail('touch controls did not come up on the floor'));
    await sleep(1200);
    const gfx = await page.evaluate(() => ({ q: window.casino.engine.quality, pr: window.casino.engine.renderer.getPixelRatio(), dpr: devicePixelRatio, fov: window.casino.engine.camera.fov }));
    log(`${key}: quality ${gfx.q}, pixel ratio ${gfx.pr} (device ${gfx.dpr}), fov ${gfx.fov.toFixed(1)}`);
    if (gfx.q !== 'low') fail(`quality ${gfx.q} on a phone`);
    if (gfx.pr > 1.5) fail(`pixel ratio ${gfx.pr}`);
    await shot('floor');
  }

  async function floorChecks() {
    // Walk with the stick: a thumb on the resting ring, pushed up (forward) for a second and a half.
    await approach(STATIONS.blackjack, 6);
    await sleep(600);
    const ring = await box('.touch-stick');
    const [sx, sy] = centre(ring);
    const p0 = await where();
    await drag([[[sx, sy], [sx + 2, sy - 44]]], 250, 1400, async () => {
      if (!(await page.evaluate(() => document.querySelector('.touch-stick')?.classList.contains('held')))) return false;
      await shot('walking');
      return true;
    });
    await drag([[[sx, sy], [sx + 2, sy - 44]]], 250, 900);
    const p1 = await where();
    const walked = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    log(`${key}: the stick walked ${walked.toFixed(2)} m`);
    if (walked < 1.5) fail(`the stick walked only ${walked.toFixed(2)} m`);

    // Two thumbs: the stick and a look drag on the right at the same time.
    const y0 = await camYaw();
    const q0 = await where();
    const W = page.viewportSize().width;
    const H = page.viewportSize().height;
    await drag([[[sx, sy], [sx - 30, sy - 30]], [[W * 0.78, H * 0.45], [W * 0.78 - 90, H * 0.45]]], 500, 500);
    const y1 = await camYaw();
    const q1 = await where();
    const turned = Math.abs(Math.atan2(Math.sin(y1 - y0), Math.cos(y1 - y0)));
    log(`${key}: two thumbs: turned ${((turned * 180) / Math.PI).toFixed(0)} deg, moved ${Math.hypot(q1.x - q0.x, q1.z - q0.z).toFixed(2)} m`);
    if (turned < 0.15) fail('a look drag beside the stick did not turn the camera');
    if (Math.hypot(q1.x - q0.x, q1.z - q0.z) < 0.3) fail('the stick did not walk while the other thumb looked around');

    // No scroll, no zoom: a pinch, a swipe on the HUD and a swipe on the floor view.
    await cdp.send('Input.synthesizePinchGesture', { x: W / 2, y: H / 2, scaleFactor: 2.2, gestureSourceType: 'touch' }).catch(() => {});
    const hud = await box('.hud-bar');
    if (hud) await drag([[centre(hud), [centre(hud)[0], centre(hud)[1] + 220]]], 300);
    await drag([[[W * 0.7, H * 0.3], [W * 0.7, H * 0.9]]], 300);
    const page0 = await page.evaluate(() => ({ scale: visualViewport?.scale ?? 1, top: document.scrollingElement.scrollTop, y: scrollY, x: scrollX }));
    if (page0.scale !== 1 || page0.top !== 0 || page0.y !== 0 || page0.x !== 0) fail(`the page moved: ${JSON.stringify(page0)}`);
  }

  /** Walk up to a station with the stick until the action button shows, and press it. */
  async function sit(game) {
    await approach(STATIONS[game], 2.6);
    await sleep(500);
    const ring = await box('.touch-stick');
    const [sx, sy] = centre(ring);
    await drag([[[sx, sy], [sx, sy - 40]]], 200, 5000, () => visible('.touch-act'));
    if (!(await page.locator('.touch-act').isVisible())) {
      fail(`${game}: no action button after walking up`);
      await approach(STATIONS[game], 0.6);
      await page.waitForSelector('.touch-act', { timeout: 5000 });
    }
    await sleep(300);
    await shot(`${game}-reach`);
    await tap('.touch-act');
    if (game !== 'slots') {
      await page.waitForSelector('.lobby-choice', { timeout: 15_000 });
      await sleep(1100);
      await shot(`${game}-lobby`);
      await tap('.lobby-choice >> nth=0');
    }
    const ask = await page.waitForSelector('.modal input[type=number]', { timeout: 20_000 }).catch(() => null);
    if (ask) {
      await sleep(400);
      await shot(`${game}-buyin`);
      await tap('.modal .row .btn >> nth=1');
      await tap('.modal .btn.primary');
    }
    await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });
    await sleep(1600);
    await shot(`${game}-seated`);
    if (await visible('.touch-note')) {
      log(`${key}: ${game}: the turn-sideways note is up`);
      await tap('.touch-note');
    }
  }

  async function playBlackjack() {
    const seat = await page.evaluate(() => window.casino.app.table.session.view.seat);
    const [ax, az] = await page.evaluate((seat) => window.casino.app.table.session.stage.felts[0].anchorOf(`spot:${seat}`), seat);
    await tap('.bj-tray .chip-btn:not([hidden]) >> nth=1');
    const [x, y] = await onScreen(ax, az);
    await page.touchscreen.tap(x, y);
    await page.waitForFunction((seat) => (window.casino.app.table.session.view.v?.bets?.[seat] ?? 0) > 0, seat, { timeout: 5000 }).catch(() => fail('blackjack: tapping the betting circle placed no bet'));
    await sleep(400);
    await shot('blackjack-bet');
    await tap('.bj-tray .btn.primary');
    // stand on whatever comes (or it settles at once on a blackjack)
    const t0 = Date.now();
    let stood = false;
    while (Date.now() - t0 < 30_000) {
      const phase = (await tableView())?.phase;
      if (!stood && (await visible('.bj-actions'))) {
        await sleep(300);
        await shot('blackjack-decide');
        await tap('.bj-actions .btn.primary');
        stood = true;
      }
      if (phase === 'results' || phase === 'idle') break;
      if (await visible('.bj-insure')) await tap('.bj-insure .btn.ghost');
      await sleep(400);
    }
    await sleep(1800);
    await shot('blackjack-result');
  }

  async function playRoulette() {
    const variant = await page.evaluate(() => window.casino.app.table.station.variant);
    const [ax, az] = await page.evaluate(async (v) => (await import('/casino/src/games/roulette/layout.ts')).anchorOf(v, 'red'), variant);
    await tap('.tray .chip-btn >> nth=1');
    const [x, y] = await onScreen(ax, az);
    await page.touchscreen.tap(x, y);
    await sleep(500);
    await shot('roulette-bet');
    await tap('.tray .btn.primary');
    await page.waitForFunction(() => (window.casino.app.table.session.view.v?.history?.length ?? 0) > 0 || document.querySelector('.rl-result:not([hidden])'), null, { timeout: 45_000 }).catch(() => fail('roulette: no result'));
    await sleep(2500);
    await shot('roulette-result');
  }

  async function playSlots() {
    await tap('.slots-deck .btn.primary');
    await sleep(5000);
    await shot('slots-spin');
  }

  async function leave(game) {
    await tap('.touch-leave');
    const confirm = await page.waitForSelector('.modal .btn.primary', { timeout: 4000 }).catch(() => null);
    if (confirm) {
      await shot(`${game}-leave`);
      await tap('.modal .btn.primary');
    }
    await page.waitForFunction(() => !window.casino.app.table && !document.querySelector('.touch-layer')?.hidden, null, { timeout: 20_000 }).catch(() => fail(`${game}: not back on the floor after Leave`));
    await sleep(800);
  }

  try {
    await login();
    await floorChecks();
    for (const game of GAMES) {
      try {
        await sit(game);
        if (!process.env.SHOTS_ONLY) {
          if (game === 'blackjack') await playBlackjack();
          if (game === 'roulette') await playRoulette();
          if (game === 'slots') await playSlots();
        }
        await leave(game);
      } catch (err) {
        fail(`${game}: ${String(err).split('\n').slice(0, 8).join(' / ')}`);
        await shot(`${game}-fail`).catch(() => {});
        await page.evaluate(() => window.casino.app.escape()).catch(() => {});
        await sleep(600);
        if (await visible('.modal .btn.primary')) await tap('.modal .btn.primary').catch(() => {});
        await sleep(2000);
      }
    }
  } catch (err) {
    fail(String(err).split('\n')[0]);
    await shot('fail').catch(() => {});
  }
  if (errors.length) fail(`page errors: ${errors.slice(0, 5).join(' | ')}`);
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} failure(s):\n${failures.join('\n')}` : '\nall mobile checks passed');
process.exit(failures.length ? 1 : 0);
