#!/usr/bin/env node
// The casino's elevator the way a person uses it, on a production build: logged in, walk from where
// everyone arrives to the lobby's doors with the keyboard (S: the doors are behind you), the doors
// open, keep walking into the car, E opens the panel, G rides down; the valet lobby is drawn, walk
// out into it with W and back into the car, E, R up to the roof; E, C back to the casino and walk
// out into the lobby. No teleports: the walker only ever moves by keys, so a doorway that stays
// solid fails here (city6.mjs puts the walker in the car directly).
//   prod  (default) builds the client with a same-origin API, serves it with `vite preview` (the
//         site's CSP) on <port> and the worker with `wrangler dev` on <port>+1, runs, and stops both
//   dev   against a running dev stack (PORT_BASE=<port> npm run dev)
//   live  against https://j4den.com (LIVE_NAME, LIVE_PASS: an account there)
// Usage: node scripts/e2e/lift61.mjs [port] [outDir] [prod|dev|live]
// GPU by default (GPU=0 for swiftshader). Fixed name lift61_e2e_a with the dev password.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const [port = '6480', out = '/tmp/lift61', target = 'prod'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const bin = (n) => `node_modules/.bin/${n}`;
const base = target === 'live' ? 'https://j4den.com' : `http://localhost:${port}`;
const name = target === 'live' ? process.env.LIVE_NAME : 'lift61_e2e_a';
const pass = target === 'live' ? process.env.LIVE_PASS : 'casino-dev';
if (!name || !pass) throw new Error('live needs LIVE_NAME and LIVE_PASS');

let failed = 0;
const ok = (cond, what) => {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};

// --- the production stack ------------------------------------------------------------------------

const procs = [];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('exit', stop);
async function up(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} never came up`);
}
if (target === 'prod') {
  const env = { ...process.env, VITE_PORT: port, WORKER_PORT: String(Number(port) + 1), CASINO_API_ORIGIN: '', CI: '1' };
  execFileSync(bin('vite'), ['build', '--config', 'client/vite.config.ts', '--logLevel', 'warn'], { stdio: 'inherit', env });
  execFileSync(bin('wrangler'), ['d1', 'migrations', 'apply', 'DB', '--local', '-c', 'server/wrangler.toml'], { stdio: 'pipe', env });
  procs.push(spawn(bin('wrangler'), ['dev', '-c', 'server/wrangler.toml', '--port', env.WORKER_PORT, '--inspector-port', '0'], { stdio: 'ignore', env }));
  procs.push(spawn(bin('vite'), ['preview', '--config', 'client/vite.config.ts'], { stdio: 'ignore', env }));
  await up(`http://localhost:${env.WORKER_PORT}/casino/api/me`);
  await up(`${base}/casino/`);
}
if (target !== 'live') execFileSync(bin('wrangler'), ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', 'DELETE FROM casino_rate'], { stdio: 'pipe', env: { ...process.env, CI: '1' } });

// --- the player ----------------------------------------------------------------------------------

const browser = await chromium.launch(process.env.GPU === '0' ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  localStorage.setItem('casino.quality', 'high');
  localStorage.setItem('casino.camera.view', 'third');
});
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource|Content Security Policy/.test(m.text()) && errors.push(m.text()));
p.on('console', (m) => /entrance doors/.test(m.text()) && errors.push(m.text()));
p.on('pageerror', (e) => errors.push(String(e)));
/** Stop here: what follows needs this step. */
async function finish() {
  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 4).join(' | ')}` : ''}`);
  await browser.close();
  stop();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
}
const shot = (n) => p.screenshot({ path: `${out}/lift61-${target}-${n}.png` });

const where = () =>
  p.evaluate(() => {
    const w = window.casino.world;
    const c = w.city;
    const b = c.bank;
    return { x: w.player.position.x, z: w.player.position.z, zone: w.zone, inCar: b.carAt(w.player.position.x, w.player.position.z) >= 0, open: b.isOpen(0), riding: c.riding, last: c.lastRide, calls: w.stats().calls, prompt: document.querySelector('.world-prompt:not([hidden])')?.textContent?.trim() ?? '' };
  });
const fmt = (w) => `(${w.x.toFixed(2)}, ${w.z.toFixed(2)}) ${w.zone}`;

/** Hold a key until `done(where)` or `ms` pass; where the walker ended up. */
async function walk(key, done, ms = 8000) {
  await p.keyboard.down(key);
  const t = Date.now();
  let w = await where();
  while (!done(w) && Date.now() - t < ms) {
    await p.waitForTimeout(80);
    w = await where();
  }
  await p.keyboard.up(key);
  await p.waitForTimeout(250);
  return where();
}

/** E in the car, the panel, a floor's key; waits for the doors to open on it. */
async function ride(key, zone) {
  await p.keyboard.press('KeyE');
  const panel = await p.waitForSelector('.lift-panel', { timeout: 4000 }).catch(() => null);
  ok(!!panel, `E in the car opens the panel`);
  if (!panel) return where();
  await shot(`panel-${zone}`);
  await p.evaluate(() => (window.casino.world.city.lastRide = null));
  await p.keyboard.press(key);
  await p.waitForFunction(() => window.casino.world.city.riding, null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(1200);
  await shot(`riding-to-${zone}`);
  await p.waitForFunction(() => !window.casino.world.city.riding, null, { timeout: 30_000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const w = await where();
  ok(w.zone === zone && w.last?.ok === true, `${key} rides to the ${zone} ${fmt(w)}${w.last?.msg ? `: ${w.last.msg}` : ''}`);
  return w;
}

/** What of a zone is standing and drawn. */
const drawn = (zone) =>
  p.evaluate((zone) => {
    const w = window.casino.world;
    const z = w.city['zones'].get(zone);
    let meshes = 0;
    z?.group.traverseVisible((o) => o.isMesh && meshes++);
    return { built: !!z, visible: !!z?.group.visible, meshes, calls: w.stats().calls };
  }, zone);

await p.goto(`${base}/casino/`, { timeout: 180_000 });
await p.waitForSelector('.name-input, .menu-item', { timeout: 300_000 });
if (await p.$('.name-input')) {
  await p.fill('.name-input', name);
  if (await p.$('.pass-input')) await p.fill('.pass-input', pass);
  await p.click('.enter-btn');
}
await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
if (await p.$('.editor-panel.guided')) {
  await p.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) {
    await p.click('.editor-panel .ed-buttons .btn.primary');
    await p.waitForTimeout(500);
  }
} else await p.click('.menu-item >> nth=0');
await p.waitForSelector('.hud', { timeout: 60_000 });
await p.waitForFunction(() => window.casino?.app?.link?.you, null, { timeout: 30_000 });
await p.waitForTimeout(2500);
for (let i = 0; i < 3 && (await p.$('.sheet-scrim, .modal')); i++) {
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
}
// a player who went somewhere else last time comes back to the casino first
if ((await where()).zone !== 'casino') console.log(`note: started in the ${(await where()).zone}`);

const door = await p.evaluate(() => {
  const L = window.casino.world.city.casinoBank;
  return { ...L.doorway(), car: L.centre(), leaves: L['leaves'].length };
});
ok(door.leaves === 2, `the doors' two leaves loaded from the packed model (${door.leaves})`);
let w = await where();
console.log(`spawn ${fmt(w)}`);
await shot('spawn');

// the doors are behind you: S walks back to them, they open, and on into the car
w = await walk('KeyS', (w) => w.z > door.z - 1.0, 6000);
ok(w.open || /Call the elevator/.test(w.prompt), `at the doors they open ${fmt(w)} "${w.prompt}"`);
await p.waitForTimeout(1200);
await shot('doors-open');
w = await walk('KeyS', (w) => w.z > door.car.z - 0.1, 6000);
ok(w.inCar, `walked through the doorway into the car ${fmt(w)}`);
await shot('in-car');
if (!w.inCar) await finish();
ok(/Choose a floor/.test(w.prompt), `in the car: "${w.prompt}"`);

// down
w = await ride('KeyG', 'ground');
if (w.zone !== 'ground') await finish();
let d = await drawn('ground');
ok(d.built && d.visible && d.meshes > 20 && d.calls > 15, `the ground floor is drawn: ${d.meshes} meshes, ${d.calls} calls`);
await shot('ground-arrived');
w = await walk('KeyW', (w) => !w.inCar && w.x > 108.5, 6000);
ok(w.zone === 'ground' && w.x > 107.5, `walked out into the valet lobby ${fmt(w)}`);
w = await walk('KeyW', (w) => w.x > 118, 6000);
await shot('ground-lobby');
d = await drawn('ground');
ok(w.zone === 'ground' && d.calls > 15, `the valet lobby from inside: ${d.calls} calls`);
// back into the car
w = await walk('KeyS', (w) => w.inCar && w.x < 104.2, 12_000);
ok(w.inCar, `walked back into a car ${fmt(w)}`);
if (!w.inCar) await finish();
w = await ride('KeyR', 'roof');
if (w.zone !== 'roof') await finish();
d = await drawn('roof');
ok(d.built && d.visible && d.meshes > 20 && d.calls > 15, `the roof is drawn: ${d.meshes} meshes, ${d.calls} calls`);
await shot('roof-arrived');
w = await walk('KeyW', (w) => w.x < -118, 5000);
await shot('roof-terrace');
w = await walk('KeyS', (w) => w.inCar, 10_000);
ok(w.inCar, `back into the roof's car ${fmt(w)}`);
if (!w.inCar) await finish();

// and home
w = await ride('KeyC', 'casino');
ok(!(await drawn('ground')).visible && !(await drawn('roof')).visible, 'back in the casino, the other zones are hidden');
w = await walk('KeyW', (w) => w.z < door.z - 1.5, 6000);
ok(w.zone === 'casino' && w.z < door.z - 1.0, `walked out of the car into the lobby ${fmt(w)}`);
await shot('casino-back');

await finish();
