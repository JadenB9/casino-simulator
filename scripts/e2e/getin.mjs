#!/usr/bin/env node
// Getting into every car there is, on the real stack: the account is given the cars in the local
// database, rides down to the ground floor, walks into the garage to each car's bay, and E there
// has to put it in the driver's seat with the floor's yes (link.you.car) inside a few seconds, with
// no page error, and keep you there (1.2: the same E press used to get you straight back out). Then
// out again. On a failure it prints what went to and came from the floor, and the toasts.
// LIVE=1 runs it on j4den.com with LIVE_NAME / LIVE_PASS and the cars that account already owns. Usage: node scripts/e2e/getin.mjs [port] [outDir]   CARS=a,b only those
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const [port = '5600', out = '/tmp/getin'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const LIVE = process.env.LIVE === '1';
const NAME = LIVE ? process.env.LIVE_NAME : (process.env.NAME ?? 'getin_e2e_1');
const PASS = LIVE ? process.env.LIVE_PASS : 'casino-dev';
const BASE = LIVE ? 'https://j4den.com' : `http://localhost:${port}`;
const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist'] });
let failed = 0;
const ok = (c, what) => (c ? console.log(`ok   ${what}`) : (failed++, console.log(`FAIL ${what}`)));
const sql = (command) => execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } });

async function login(ctx) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  // (live, Cloudflare's own injected inline script is refused by the page's CSP: not the game's)
  p.on('console', (m) => m.type() === 'error' && !/inline script violates/.test(m.text()) && p.errors.push(`console: ${m.text()}`));
  await p.goto(`${BASE}/casino/`);
  await p.waitForSelector('.name-input', { timeout: 300000 });
  await p.fill('.name-input', NAME);
  if (await p.$('.pass-input')) await p.fill('.pass-input', PASS);
  await p.click('.enter-btn');
  await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 30000 });
  if (await p.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) {
      await p.click('.editor-panel .ed-buttons .btn.primary');
      await p.waitForTimeout(500);
    }
  } else await p.click('.menu-item >> nth=0');
  await p.waitForSelector('.hud', { timeout: 30000 });
  await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20000 });
  await p.keyboard.press('Escape').catch(() => {});
  return p;
}

const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
let p = await login(ctx);
const id = await p.evaluate(() => window.casino.app.link.you.id);
// every car in the catalogue (shared/src/items.ts, read as text: the shared folder isn't served)
const CARS = [...readFileSync('shared/src/items.ts', 'utf8').matchAll(/\{ id: '([a-z0-9-]+)', kind: 'car'/g)].map((m) => m[1]);
const owned = LIVE ? await p.evaluate(() => window.casino.session.profile.owned ?? []) : null;
const all = LIVE ? CARS.filter((c) => owned.includes(c)).slice(-1) : process.env.CARS ? process.env.CARS.split(',') : CARS;
ok(Array.isArray(all) && all.length > 0, `the cars to try (${all?.length})`);
if (!LIVE) sql(`INSERT OR IGNORE INTO casino_items (account_id, item, price, bought_at, op_id) VALUES ${all.map((c, i) => `(${id}, '${c}', 100, ${Date.now()}, 'getin-${id}-${i}')`).join(', ')}`);
await p.close();
p = await login(ctx);
// down to the ground floor
const L = await p.evaluate(() => ({ ...window.casino.world.city.casinoBank.centre(0), yaw: window.casino.world.city.casinoBank.yaw }));
await p.evaluate(([x, z, y]) => window.casino.world.teleport(x, z, y), [L.x, L.z, L.yaw]);
await p.waitForTimeout(600);
await p.evaluate(() => window.casino.app.link.send({ t: 'lift', to: 'ground' }));
await p.waitForFunction(() => window.casino.world.zone === 'ground' && !window.casino.world.city.riding, null, { timeout: 30000 });
await p.waitForTimeout(2500);

for (const car of all) {
  // (live: no source modules to ask, so the one car tried is the dearest, which stands on the
  // turntable ahead of the door: cars/layout.ts bays()[0])
  const bay = LIVE ? { x: 180, z: 15.5, owned: true } : await p.evaluate(async (car) => {
    const { collection } = await import('/casino/src/world/cars/layout.ts');
    const c = collection(window.casino.session.profile.owned).find((x) => x.car === car);
    return c ? { x: c.bay.x, z: c.bay.z, owned: c.owned } : null;
  }, car);
  if (!bay) {
    ok(false, `${car}: has a bay in the garage`);
    continue;
  }
  // stand beside the bay, facing it, and read the prompt
  await p.evaluate(([x, z]) => window.casino.world.teleport(x - 2.2, z, Math.PI / 2), [bay.x, bay.z]);
  await p.waitForTimeout(700);
  const prompt = await p.evaluate(() => document.querySelector('.world-prompt:not([hidden])')?.textContent ?? null);
  const before = p.errors.length;
  await p.evaluate(() => {
    window.__log = [];
    const l = window.casino.app.link;
    if (!window.__hooked) {
      window.__hooked = true;
      const send = l.send.bind(l);
      l.send = (m) => { if (m.t === 'drive' || m.t === 'lift') window.__log.push(['out', performance.now() | 0, JSON.stringify(m)]); return send(m); };
      l.subscribe((m) => { if (m.t !== 's' && m.t !== 'here') window.__log.push(['in', performance.now() | 0, JSON.stringify(m).slice(0, 200)]); });
      const seen = new WeakSet();
      new MutationObserver(() => document.querySelectorAll('.toast').forEach((t) => !seen.has(t) && (seen.add(t), window.__log.push(['toast', performance.now() | 0, t.textContent])))).observe(document.body, { childList: true, subtree: true });
    }
  });
  await p.keyboard.press('KeyE');
  const t0 = Date.now();
  const got = await p.waitForFunction((car) => window.casino.app.link.you?.car === car && window.casino.app.v7.driving.driving, car, { timeout: 8000 }).then(() => true, () => false);
  const took = Date.now() - t0;
  const state = await p.evaluate(() => ({ driving: window.casino.app.v7.driving.driving, you: window.casino.app.link.you?.car ?? null, zone: window.casino.world.zone }));
  if (!got) console.log(JSON.stringify(await p.evaluate(() => window.__log), null, 0));
  ok(got, `${car}: E at its bay ("${prompt?.trim()}") puts you in it, the floor agreeing (${took} ms) ${got ? '' : JSON.stringify(state)}`);
  ok(p.errors.length === before, `${car}: no errors getting in ${p.errors.slice(before, before + 3).join(' | ')}`);
  if (got) {
    await p.keyboard.down('KeyW');
    await p.waitForTimeout(700);
    await p.keyboard.up('KeyW');
    await p.screenshot({ path: `${out}/getin-${car}.png` });
    const moved = await p.evaluate(() => window.casino.app.v7.driving.state?.v ?? 0);
    ok(Math.abs(moved) > 0.2, `${car}: it drives (${moved.toFixed(1)} m/s)`);
    // stopped, E gets you out again (the car's own E), and the floor hears it
    await p.keyboard.down('Space');
    await p.waitForFunction(() => Math.abs(window.casino.app.v7.driving.state?.v ?? 0) < 1, null, { timeout: 8000 }).catch(() => {});
    await p.keyboard.up('Space');
    await p.keyboard.press('KeyE');
    const left = await p.waitForFunction(() => !window.casino.app.v7.driving.driving && !window.casino.app.link.you?.car, null, { timeout: 5000 }).then(() => true, () => false);
    ok(left, `${car}: E gets you out once stopped`);
    if (!left) await p.evaluate(() => window.casino.app.v7.driving.getOut());
    await p.waitForTimeout(800);
  } else {
    await p.evaluate(() => window.casino.app.v7.driving.getOut(true));
    await p.waitForTimeout(800);
  }
}
ok(p.errors.length === 0, `no page errors (${p.errors.slice(0, 4).join(' | ')})`);
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
