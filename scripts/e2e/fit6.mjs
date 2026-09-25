#!/usr/bin/env node
// Every board stays in view: sit at every table, machine, wheel and computer solo, then resize the
// window through laptop windows that aren't full screen, very wide and tall narrow ones (and the
// phone layouts in device emulation), and at each size project the board's key points with the
// real camera and check every one is on screen and clear of the controls over it (the HUD, the
// chip tray, the action bar, the party panel, the tips line, the chat). Screenshots of each go to
// outDir; DEBUG=1 draws the key points and the controls' boxes on them.
// Usage: node scripts/e2e/fit6.mjs [port] [outDir] [games...]   (PORT_BASE=<port> npm run dev first)
//   VIEWPORTS=1280x720,1024x640 limits the window sizes; PHONES=0 skips the device runs, DESK=0 the
//   desktop one, SHOTS=0 the rounds played for the wheel and dice shots;
//   FIT=off opens the game with fitting switched off (?fit=off), to see what it was before;
//   GPU=1 draws on the machine's GPU (much faster than SwiftShader).
// Games built but not yet placed on the floor (Coinflip, Wheel, Cases, Diamonds) are checked on the
// dev table page (?dev=table&game=...), with the same measures. Stubs still being built elsewhere
// are skipped: letitride, paigow, bingo, pachinko (HARNESS=a,b adds any game to the dev-page run).

import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6280', out = '/tmp/casino-fit6', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? `http://localhost:${port}`;
const GPU = process.env.GPU === '1';
const DEBUG = process.env.DEBUG === '1';
const OFF = process.env.FIT === 'off';

// One station per game and board (slot cabinets come in two poses; roulette in two wheels).
const STATIONS = {
  blackjack: 'bj-1', roulette: 'rl-us', 'roulette-eu': 'rl-eu', craps: 'cr-1', baccarat: 'bc-1', threecard: 'tc-1', war: 'wr-1',
  bigsix: 'b6-1', sicbo: 'sb-1', holdem: 'he-1', slots: 'slots-sevens-1', 'slots-neon': 'slots-neon-1', 'slots-wild': 'slots-wild-1',
  'slots-diamonds': 'slots-diamonds-1', 'slots-cherries': 'slots-cherries-1', 'slots-goldrush': 'slots-goldrush-1', videopoker: 'vp-1',
  banditwheel: 'bw-1', plinko: 'pk-1', tower: 'tw-1', mines: 'mn-1', dice: 'dc-1', limbo: 'lb-1', keno: 'kn-1', hilo: 'hl-1', crash: 'cs-1',
  'vip-blackjack': 'vip-bj-1', 'vip-baccarat': 'vip-bc-1', 'vip-roulette': 'vip-rl-1',
};
const STUBS = ['letitride', 'paigow', 'bingo', 'pachinko'];
const HARNESS = (process.env.HARNESS ?? 'coinflip,wheel,cases,diamonds').split(',').filter(Boolean);
const VIEWPORTS = (process.env.VIEWPORTS ?? '1920x1080,1440x900,1366x768,1280x720,1280x600,1024x640,2560x1080,900x1000')
  .split(',')
  .map((s) => s.split('x').map(Number));
const strip = ({ defaultBrowserType, ...d }) => d;
const PHONES = process.env.PHONES === '0' ? [] : [
  ['iphone', { ...strip(devices['iPhone 13']), viewport: { width: 390, height: 844 } }, ['blackjack', 'roulette', 'slots', 'plinko', 'craps']],
  ['iphone-land', { ...strip(devices['iPhone 13 landscape']), viewport: { width: 844, height: 390 } }, ['blackjack', 'roulette', 'slots', 'plinko', 'craps']],
  ['ipad', strip(devices['iPad (gen 7)']), ['blackjack', 'roulette', 'baccarat', 'mines']],
];
const games = (only.length ? only : Object.keys(STATIONS)).filter((g) => !STUBS.includes(g) && STATIONS[g]);

const failures = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const browser = await chromium.launch(GPU ? { channel: 'chromium', args: ['--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function onFloor(page, name) {
  if (!page.url().includes('/casino/')) await page.goto(`${base}/casino/${OFF ? '?fit=off' : ''}`);
  await page.waitForSelector('.front:not(.closing) .name-input, .menu-item, .editor-panel.guided, .hud', { timeout: 300_000 });
  if (await page.$('.front:not(.closing) .name-input')) {
    await page.fill('.name-input', name);
    await page.fill('.pass-input', 'casino-dev');
    await page.click('.enter-btn');
    await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  }
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else if (!(await page.$('.hud'))) await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 120_000 });
}

async function sit(page, station) {
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, station);
  await page.waitForSelector('.lobby-choice, .modal input[type=number]', { timeout: 30_000 });
  if (await page.$('.lobby-choice')) await page.keyboard.press('s');
  await page.waitForSelector('.modal input[type=number]', { timeout: 30_000 });
  // $1,000, or the table's minimum buy-in where that's more (the salon's high limits)
  const min = Number((await page.getAttribute('.modal input[type=number]', 'min')) ?? 0);
  await page.fill('.modal input[type=number]', String(Math.max(1000, min)));
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true && !document.querySelector('.modal'), null, { timeout: 30_000 });
}

async function stand(page) {
  await page.evaluate(() => window.casino.app.escape());
  const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
  if (leave) await leave.click();
  await page.waitForFunction(() => !window.casino.app.table, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);
}

/**
 * The board's key points where the real camera draws them (CSS px), and the controls on screen,
 * measured here on their own terms: every visible element over the scene in #ui (through the
 * see-through wrappers), less prompts, toasts and the online site drawn on the monitor.
 */
const measure = (page) =>
  page.evaluate(() => {
    const W = innerWidth;
    const H = innerHeight;
    // the game proper's table, or the dev table page's
    const s = window.casino.app ? window.casino.app.table?.session : window.casino.table;
    const stage = s?.stage;
    if (!stage) return null;
    const cam = stage.engine.camera;
    cam.updateMatrixWorld();
    const pts = stage.fit.keyPoints().map((p) => {
      const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
      const behind = v.z > -0.01;
      v.applyMatrix4(cam.projectionMatrix);
      return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, behind };
    });
    const ui = [];
    const skip = ['modal', 'scrim', 'toasts', 'toast', 'world-prompt', 'os-screen', 'celebrate'];
    const visit = (e, d) => {
      if (e.hidden || skip.some((c) => e.classList.contains(c)) || e.dataset.fit === 'ignore') return;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
      if (e.classList.contains('pass') || e.dataset.fit === 'pass') {
        if (d < 3) for (const c of e.children) visit(c, d + 1);
        return;
      }
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.right <= 0 || r.bottom <= 0 || r.left >= W || r.top >= H || r.width * r.height > 0.45 * W * H) return;
      ui.push({ cls: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    };
    for (const c of document.getElementById('ui').children) visit(c, 0);
    const back = document.querySelector('.j4-back');
    if (back) visit(back, 0);
    return { W, H, pts, ui, fit: stage.fit.debug() };
  });

/** Draw the key points and the controls' boxes over the page (DEBUG=1), for the screenshots. */
const overlay = (page, m) =>
  page.evaluate((m) => {
    document.querySelectorAll('.fit6-dbg').forEach((e) => e.remove());
    if (!m) return;
    const box = (r, color) => {
      const d = document.createElement('div');
      d.className = 'fit6-dbg';
      Object.assign(d.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px`, outline: `2px solid ${color}`, zIndex: 99999, pointerEvents: 'none' });
      document.body.append(d);
    };
    for (const r of m.ui) box(r, 'rgba(255,60,60,.9)');
    if (m.fit.safe) box(m.fit.safe, 'rgba(60,200,255,.9)');
    for (const p of m.pts) box({ left: p.x - 3, top: p.y - 3, right: p.x + 3, bottom: p.y + 3 }, p.behind ? 'magenta' : 'yellow');
  }, m);

/** Which key points are off the screen or under a control (1 px of slack for rounding). */
function check(m) {
  const bad = [];
  for (const p of m.pts) {
    if (p.behind) {
      bad.push('a point behind the camera');
      continue;
    }
    if (p.x < -1 || p.y < -1 || p.x > m.W + 1 || p.y > m.H + 1) bad.push(`(${p.x.toFixed(0)},${p.y.toFixed(0)}) off screen`);
    else {
      const under = m.ui.find((r) => p.x > r.left + 1 && p.x < r.right - 1 && p.y > r.top + 1 && p.y < r.bottom - 1);
      if (under) bad.push(`(${p.x.toFixed(0)},${p.y.toFixed(0)}) under ${under.cls}`);
    }
  }
  return [...new Set(bad)];
}

async function sweep(page, tag, game, sizes) {
  for (const [w, h] of sizes) {
    if (w) await page.setViewportSize({ width: w, height: h });
    // the lens snaps on a resize; the controls are measured four times a second and settle
    await page.waitForTimeout(1300);
    const m = await measure(page);
    const size = `${m.W}x${m.H}`;
    if (!m.pts.length) failures.push(`${tag} ${game} ${size}: no board`);
    const bad = check(m);
    const zoom = m.fit.lens.zoom.toFixed(2);
    if (bad.length) failures.push(`${tag} ${game} ${size} (zoom ${zoom}): ${bad.length} points: ${bad.slice(0, 3).join('; ')}`);
    // the controls themselves stay on the screen too (a tray wider than a narrow window)
    for (const r of m.ui.filter((r) => r.left < -1 || r.right > m.W + 1 || r.bottom > m.H + 1)) failures.push(`${tag} ${game} ${size}: ${r.cls} runs off the edge (${r.left.toFixed(0)}..${r.right.toFixed(0)})`);
    log(`${tag} ${game} ${size}: ${m.pts.length} points, zoom ${zoom}, slide ${m.fit.lens.dx.toFixed(0)},${m.fit.lens.dy.toFixed(0)}${bad.length ? `, ${bad.length} OUT` : ', all in view'}`);
    if (DEBUG) await overlay(page, m);
    await page.screenshot({ path: `${out}/${tag}-${game}-${size}.png`, scale: 'css' });
    if (DEBUG) await overlay(page, null);
  }
}

// The views that swing the camera to another shot (the wheel, the dice) say what it must show:
// play a round, wait for the camera to settle on the shot, and check that too.
const SHOT_ROUNDS = {
  roulette: [{ type: 'bet', bets: [{ kind: 'red', amount: 500 }] }, { type: 'spin' }],
  bigsix: [{ type: 'bet', bets: [{ spot: 'one', amount: 500 }] }, { type: 'spin' }],
  sicbo: [{ type: 'bet', bets: [{ spot: 'small', amount: 500 }] }, { type: 'roll' }],
  banditwheel: [{ type: 'bet', bets: [{ spot: 1, amount: 500 }] }, { type: 'spin' }],
};
const SHOT_SIZES = (process.env.SHOT_VIEWPORTS ?? '1024x640,900x1000').split(',').map((s) => s.split('x').map(Number));

async function shots(page, tag, game) {
  for (const [w, h] of SHOT_SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(800);
    await page.evaluate((acts) => acts.forEach((a, i) => setTimeout(() => window.casino.app.table.session.link.act(a), 300 + i * 600)), SHOT_ROUNDS[game]);
    // on the shot, and the camera still for a moment
    let prev = null;
    let still = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 40_000 && still < 3) {
      const s = await page.evaluate(() => {
        const st = window.casino.app.table.session.stage;
        return { shot: st.fit.debug().shot, p: st.engine.camera.position.toArray() };
      });
      still = s.shot && prev && Math.hypot(...s.p.map((v, i) => v - prev[i])) < 1e-3 ? still + 1 : 0;
      prev = s.p;
      await page.waitForTimeout(120);
    }
    if (still < 3) {
      failures.push(`${tag} ${game} ${w}x${h}: never settled on a shot`);
      continue;
    }
    const m = await measure(page);
    const bad = check(m);
    if (bad.length) failures.push(`${tag} ${game} shot ${w}x${h} (zoom ${m.fit.lens.zoom.toFixed(2)}): ${bad.length} points: ${bad.slice(0, 3).join('; ')}`);
    log(`${tag} ${game} shot ${w}x${h}: ${m.pts.length} points, zoom ${m.fit.lens.zoom.toFixed(2)}${bad.length ? `, ${bad.length} OUT` : ', all in view'}`);
    if (DEBUG) await overlay(page, m);
    await page.screenshot({ path: `${out}/${tag}-${game}-shot-${w}x${h}.png`, scale: 'css' });
    if (DEBUG) await overlay(page, null);
    // the round plays out and the camera comes home before the next
    await page.waitForFunction(() => !window.casino.app.table.session.stage.fit.debug().shot, null, { timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(6000);
  }
}

async function run(tag, contextOpts, list, sizes) {
  const ctx = await browser.newContext(contextOpts);
  await ctx.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource|WebSocket/.test(m.text()) && errors.push(m.text()));
  await onFloor(page, process.env.NAME ?? 'fit6_e2e_1');
  for (const game of list) {
    try {
      // the dev server reloads the page when a source file changes: back onto the floor first
      if (!(await page.evaluate(() => !!window.casino?.world && !!document.querySelector('.hud')).catch(() => false))) await onFloor(page, process.env.NAME ?? 'fit6_e2e_1');
      await sit(page, STATIONS[game]);
      await page.waitForTimeout(2000);
      await sweep(page, tag, game, sizes);
      if (tag === 'desk' && SHOT_ROUNDS[game] && process.env.SHOTS !== '0') await shots(page, tag, game);
      if (sizes.length > 1) await page.setViewportSize({ width: sizes[0][0], height: sizes[0][1] });
      await stand(page);
    } catch (err) {
      failures.push(`${tag} ${game}: ${String(err?.message ?? err).split('\n')[0]}`);
      await page.keyboard.press('Escape').catch(() => {});
      await stand(page).catch(() => {});
    }
  }
  for (const e of errors.slice(0, 5)) failures.push(`${tag} page: ${e}`);
  await ctx.close();
}

if (process.env.DESK !== '0') await run('desk', { viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] } }, games, VIEWPORTS);
// the dev table page: log in as the page does, buy in, then the same sweep
const harness = HARNESS.filter((g) => !only.length || only.includes(g));
if (harness.length && process.env.DESK !== '0') {
  const ctx = await browser.newContext({ viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] } });
  await ctx.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  for (const game of harness) {
    try {
      await page.goto(`${base}/casino/?dev=table&game=${game}&name=fit6_e2e_dev${OFF ? '&fit=off' : ''}`);
      await page.waitForSelector('.modal input[type=number]', { timeout: 120_000 });
      await page.fill('.modal input[type=number]', '1000');
      await page.click('.modal .btn.primary');
      await page.waitForFunction(() => window.casino?.table?.snapshot?.you?.status !== 'watching' && !document.querySelector('.modal'), null, { timeout: 30_000 });
      await page.waitForTimeout(2000);
      await sweep(page, 'dev', game, VIEWPORTS);
      await page.setViewportSize({ width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] });
    } catch (err) {
      failures.push(`dev ${game}: ${String(err?.message ?? err).split('\n')[0]}`);
    }
  }
  await ctx.close();
}

for (const [tag, opts, list] of PHONES) {
  const mine = only.length ? list.filter((g) => only.includes(g)) : list;
  if (mine.length) await run(tag, opts, mine, [[0, 0]]);
}

console.log(JSON.stringify({ failures }, null, 1));
await browser.close();
process.exit(failures.length ? 1 : 0);
