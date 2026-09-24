#!/usr/bin/env node
// A long session, several times over, watching for leaks and console noise: every room of the
// building walked and looked round, a table of every kind and the online desks sat at and left,
// every sheet in the HUD opened and closed, a seat on the floor sat on. After each round (and a
// garbage collection) it counts what the renderer holds (geometries, textures, shader programs),
// the live three.js objects, the JS heap, DOM nodes and event listeners; a count that climbs round
// after round is a leak. Every console error and warning of the whole session is listed at the end.
//
// Usage: node scripts/e2e/session.mjs [port] [--rounds 3] [--quality high|low] [--strict-audio]
//   --strict-audio  Chrome's own autoplay rule (audio only after a gesture), as real visitors have it
// Logs in as perf_session with the dev password.

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const port = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) ?? '5173';
const rounds = Number(opt('rounds', 3));
const quality = opt('quality', 'high');
const args = ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
if (argv.includes('--strict-audio')) args.push('--autoplay-policy=user-gesture-required');
const browser = await chromium.launch({ headless: false, args, ignoreDefaultArgs: argv.includes('--strict-audio') ? ['--autoplay-policy=no-user-gesture-required'] : [] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript((q) => localStorage.setItem('casino.quality', q), quality);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const noise = [];
const note = (what) => noise.push(what);
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !m.location()?.url?.endsWith('/favicon.ico') && note(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => !r.url().endsWith('/favicon.ico') && note(`request failed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && note(`${r.status()} ${r.url()}`));
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
// Waits and checks go through locators, and every waitForFunction returns a plain boolean: an
// element handle (waitForSelector, page.$) or a waitForFunction's handle to what its test returned
// (a table view, say) pins that object, and all it reaches, for as long as the session lives, which
// would count the harness as the leak.
const seen = (sel, timeout) => page.locator(sel).first().waitFor({ state: 'attached', timeout }).then(() => true, () => false);
const has = async (sel) => (await page.locator(sel).count()) > 0;
const frames = (n = 3) => page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// --- in, onto the floor ---------------------------------------------------------------------------
await page.goto(`http://localhost:${port}/casino/`);
await seen('.name-input', 180_000);
await page.fill('.name-input', 'perf_session');
await page.fill('.pass-input', 'casino-dev');
await page.click('.enter-btn');
await seen('.menu-item, .editor-panel', 60_000);
if (!(await has('.menu-item'))) {
  await page.waitForTimeout(2500);
  for (let k = 0; k < 10 && !(await has('.hud')); k++) {
    if (await has('.editor-panel .ed-buttons .btn.primary')) await page.locator('.editor-panel .ed-buttons .btn.primary').first().click();
    await page.waitForTimeout(700);
  }
} else await page.locator('.menu-item').first().click();
await seen('.hud', 60_000);
await page.waitForTimeout(2000);

// --- counting what's alive ------------------------------------------------------------------------
// The prototypes to count instances of, found from live objects (the app's own three.js module).
await page.evaluate(() => {
  const { engine, world } = window.casino;
  const up = (o, name) => {
    for (let p = Object.getPrototypeOf(o); p; p = Object.getPrototypeOf(p)) if (p.constructor?.name === name || Object.prototype.hasOwnProperty.call(p, `is${name}`)) return p;
    return null;
  };
  let tex = null;
  engine.scene.traverse((o) => {
    const m = o.material;
    if (!tex && m && !Array.isArray(m) && m.map) tex = m.map;
  });
  window.__protos = {
    Object3D: up(engine.scene, 'Object3D'),
    BufferGeometry: up(world.characterFactory.blobGeometry, 'BufferGeometry'),
    Material: up(world.characterFactory.blob, 'Material'),
    Texture: tex ? up(tex, 'Texture') : null,
  };
});

async function census(label) {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  await cdp.send('HeapProfiler.collectGarbage');
  const live = {};
  for (const name of ['Object3D', 'BufferGeometry', 'Material', 'Texture']) {
    const proto = await cdp.send('Runtime.evaluate', { expression: `window.__protos.${name}` });
    if (!proto.result.objectId) continue;
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
    const n = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
    live[name] = n.result.value;
    await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
  }
  const r = await page.evaluate(() => {
    const { engine } = window.casino;
    const info = engine.renderer.info;
    return { geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0, labels: document.getElementById('labels').childElementCount, ui: document.getElementById('ui').querySelectorAll('*').length };
  });
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const row = { label, ...r, live, heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners };
  console.log(JSON.stringify(row));
  return row;
}
await cdp.send('Performance.enable');

// --- one round ----------------------------------------------------------------------------------------
const stations = await page.evaluate(() => {
  const seen = new Set();
  const out = [];
  for (const s of window.casino.world.stations) {
    const key = s.zone === 'online' ? s.game : s.game === 'slots' ? `slots:${s.variant}` : s.game;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s.id);
  }
  return out;
});

async function walkRooms() {
  const rooms = await page.evaluate(() => window.casino.world.plan.rooms.map((r) => [r.id, r.cx, r.cz]));
  for (const [, x, z] of rooms) {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      await page.evaluate(([x, z, yaw]) => window.casino.world.teleport(x, z, yaw), [x, z, yaw]);
      await frames(8);
    }
  }
}

async function sitAndStand(id) {
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.teleport(0, 12.8, Math.PI);
    w.enter(w.stations.find((s) => s.id === id));
  }, id);
  await page.waitForFunction(() => !!(document.querySelector('.lobby-choice, .modal input[type=number]') || window.casino.app.table?.session.view), null, { timeout: 20_000 }).catch(() => {});
  const how = (await has('.lobby-choice')) ? 'lobby' : (await has('.modal input[type=number]')) ? 'buyin' : 'seated';
  if (how === 'lobby') await page.keyboard.press('s');
  if (how === 'lobby' || how === 'buyin') {
    if (await seen('.modal input[type=number]', 15_000)) {
      await page.fill('.modal input[type=number]', '1000');
      await page.click('.modal .btn.primary');
    }
  }
  const seated = await page.waitForFunction(() => !!window.casino.app.table?.session.view, null, { timeout: 30_000 }).then(() => true, () => false);
  if (!seated) fail(`${id}: never seated (${how})`);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.casino.app.escape());
  if (await seen('.modal .btn.primary', 3000)) await page.click('.modal .btn.primary');
  const stood = await page.waitForFunction(() => !window.casino.app.table && !window.casino.world.seated, null, { timeout: 30_000 }).then(() => true, () => false);
  if (!stood) fail(`${id}: could not stand up`);
  await page.waitForTimeout(800);
}

async function sheets() {
  const labels = await page.$$eval('.hud-right .hud-btn', (bs) => bs.map((b) => b.getAttribute('aria-label') ?? b.title));
  for (const label of labels) {
    if (/^(Mute|Unmute|Menu)/.test(label)) continue;
    await page.click(`.hud-right .hud-btn[aria-label="${label}"]`).catch(() => fail(`no button ${label}`));
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    // a sheet that Esc didn't close: its own close button
    if (await has('.sheet .close, .modal .close, .sheet-close, [aria-label="Close"]')) {
      await page.locator('.sheet .close, .modal .close, .sheet-close, [aria-label="Close"]').first().click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  // the profile (the name in the HUD), the map (N), the shortcuts (?), the emote wheel (G), chat (T)
  await page.click('.hud .hud-who').catch(() => {});
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  for (const key of ['KeyN', 'Shift+Slash', 'KeyG', 'KeyT']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/session-after-sheets.png` });
  const open = await page.$$eval('#ui .sheet, #ui .modal', (els) => els.filter((e) => e.getClientRects().length > 0).length);
  if (open) fail(`sheets: ${open} sheet(s) or dialog(s) still open`);
}

async function floorSeat() {
  const ok = await page.evaluate(async () => {
    const w = window.casino.world;
    const { lifePoints } = await import(`${location.pathname}src/world/life-points.ts`);
    const seat = lifePoints(w.plan).seats.find((s) => s.id === 'lounge.sofa.1a.2');
    if (!seat) return false;
    w.teleport(seat.x + Math.sin(seat.yaw) * 0.75, seat.z + Math.cos(seat.yaw) * 0.75, seat.yaw + Math.PI);
    await new Promise((r) => setTimeout(r, 400));
    const spot = w.life.seating.spots(w.player.position).find((x) => x.key === `sit:${seat.id}`);
    spot?.use();
    return !!spot;
  });
  await page.waitForTimeout(1500);
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  if (!ok) fail('no floor seat to sit on');
}

// --per: in round 2, a count after every step, to find which one leaks
const per = argv.includes('--per');
const rows = [await census('start')];
for (let round = 1; round <= rounds; round++) {
  const step = async (label, fn) => {
    await fn();
    if (per && round === 2) await census(`  ${label}`);
  };
  await step('rooms', walkRooms);
  for (const id of stations) await step(id, () => sitAndStand(id));
  await step('sheets', sheets);
  await step('floor seat', floorSeat);
  await page.evaluate(() => window.casino.world.teleport(0, 12.8, Math.PI));
  await page.waitForTimeout(1500);
  rows.push(await census(`round ${round}`));
}

// Growth from round 1 to the last: the first round loads what a session needs once.
const first = rows[1];
const last = rows.at(-1);
const grew = [];
for (const k of ['geometries', 'textures', 'programs', 'labels', 'nodes', 'listeners']) if (last[k] > first[k]) grew.push(`${k} ${first[k]} -> ${last[k]}`);
for (const k of Object.keys(last.live)) if (last.live[k] > first.live[k]) grew.push(`live ${k} ${first.live[k]} -> ${last.live[k]}`);
if (last.heapMB > first.heapMB * 1.1 + 5) grew.push(`heap ${first.heapMB} -> ${last.heapMB} MB`);
console.log('stations', stations.join(' '));
console.log('growth after round 1:', grew.length ? grew.join(', ') : 'none');
const uniq = [...new Set(noise)];
console.log(`console: ${uniq.length} distinct errors/warnings`);
for (const n of uniq.slice(0, 40)) console.log('  ', n.slice(0, 300));
await browser.close();
process.exit(failed || uniq.length ? 1 : 0);
