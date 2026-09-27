#!/usr/bin/env node
// Casino 1.3, through the game proper with real keys and clicks, two players in their own browsers:
//   1. M opens the map and shows the other player on it; M again closes it
//   2. E at the lobby's notice board opens What's New
//   3. an invite joined with Shift+J asks for the buy-in at once
//   4. a roulette spin: the stack the table shows stays as it was until the ball lands
//   5. the pit boss's second catch during a spin: the table plays the spin out and stays up until he's
//      there, then you're taken across the street
// Usage: node scripts/e2e/v13.mjs [port] [outDir]   (PORT_BASE=<port> npm run dev first)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5600', out = '/tmp/casino-v13'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const errors = [];
let failed = 0;
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const check = (ok, what) => {
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('casino.quality', 'low');
    localStorage.setItem('casino.invites.dnd', '0');
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`http://localhost:${port}/casino/`);
  await page.waitForSelector('.name-input', { timeout: 180_000 });
  await page.fill('.name-input', name);
  await page.fill('.pass-input', 'casino-dev');
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 20_000 });
  if (await page.waitForSelector('.daily-sheet', { timeout: 6000 }).catch(() => null)) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet-scrim', { state: 'detached', timeout: 5000 }).catch(() => {});
  }
  // the floor has the keyboard (a click on the canvas would take the mouse)
  await page.evaluate(() => document.activeElement?.blur?.());
  const id = await page.evaluate(() => window.casino.session.profile.id);
  return { page, name, id };
}

const shot = (p, file) => p.page.screenshot({ path: `${out}/${file}.png` });

try {
  // (fresh players each run: the last run's A is in jail)
  const run = Date.now().toString(36).slice(-5);
  const a = await player(`v13${run}a`);
  const b = await player(`v13${run}b`);
  log(`logged in ${a.name} (${a.id}) and ${b.name} (${b.id})`);
  await a.page.waitForFunction((id) => window.casino.app.link?.players.get(id)?.last, b.id, { timeout: 15_000 });

  // --- 1. the map on M, with the other player on it --------------------------------------------
  await a.page.keyboard.press('KeyM');
  await a.page.waitForSelector('.map-sheet', { timeout: 5000 });
  await a.page.waitForFunction(() => Number(document.querySelector('.map-sheet')?.dataset.people ?? 0) >= 1, null, { timeout: 5000 }).catch(() => {});
  const dots = await a.page.$$eval('.map-person text', (els) => els.map((e) => e.textContent));
  check(dots.includes(b.name), `M opens the map with ${b.name} on it (${dots.join(', ')})`);
  await a.page.waitForTimeout(700);
  await shot(a, 'v13-1-map');
  await a.page.keyboard.press('KeyM');
  await a.page.waitForSelector('.map-sheet', { state: 'detached', timeout: 5000 });
  check(true, 'M closes it again');

  // --- 1b. Ctrl runs, a tap of Shift crouches ----------------------------------------------------
  const walk = async (mods) => {
    await a.page.evaluate(() => window.casino.world.teleport(0, 12, Math.PI));
    await a.page.waitForTimeout(400);
    const p0 = await a.page.evaluate(() => ({ ...window.casino.world.player.position }));
    for (const m of mods) await a.page.keyboard.down(m);
    await a.page.keyboard.down('KeyW');
    await a.page.waitForTimeout(1000);
    await a.page.keyboard.up('KeyW');
    for (const m of mods) await a.page.keyboard.up(m);
    const p1 = await a.page.evaluate(() => ({ ...window.casino.world.player.position }));
    return Math.hypot(p1.x - p0.x, p1.z - p0.z);
  };
  const plain = await walk([]);
  const ran = await walk(['ControlLeft']);
  check(ran > plain * 1.4, `Ctrl held runs (${ran.toFixed(2)} m in a second, walking ${plain.toFixed(2)} m)`);
  await a.page.keyboard.press('ShiftLeft');
  await a.page.waitForTimeout(400);
  const crouched = await b.page.evaluate((id) => !!window.casino.app.link.players.get(id)?.info.crouch, a.id);
  check(crouched, 'a tap of Shift crouches (the other player sees it)');
  await a.page.keyboard.press('ShiftLeft');

  // --- 2. the notice board ----------------------------------------------------------------------
  const board = await a.page.evaluate(() => {
    const f = window.casino.world.plan.furniture.find((q) => q.kind === 'bulletin');
    return { x: f.x + Math.sin(f.yaw) * 1.2, z: f.z + Math.cos(f.yaw) * 1.2, yaw: f.yaw + Math.PI };
  });
  await a.page.evaluate((b) => window.casino.world.teleport(b.x, b.z, b.yaw), board);
  await a.page.waitForTimeout(800);
  await a.page.keyboard.press('KeyE');
  await a.page.waitForSelector('.news-sheet', { timeout: 5000 });
  const items = await a.page.$$eval('.news-item .news-title', (els) => els.map((e) => e.textContent));
  check(items.length >= 10 && items.includes('Apartments') && items.includes('Ace Arms') && items.includes('Cars'), `E at the board opens What's New (${items.join(', ')})`);
  await shot(a, 'v13-2-news');
  await a.page.keyboard.press('Escape');
  await a.page.waitForSelector('.news-sheet', { state: 'detached', timeout: 5000 });

  // --- 3. an invite joined with Shift+J asks for the buy-in --------------------------------------
  await a.page.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === 'bj-1'));
  });
  await a.page.waitForSelector('.lobby-choice', { timeout: 10_000 });
  await a.page.keyboard.press('m');
  await a.page.waitForSelector('.lobby-actions .btn', { timeout: 10_000 });
  await a.page.click('.lobby-actions .btn:has-text("Public")');
  await a.page.waitForSelector('.party-invite', { timeout: 15_000 });
  // (the host is asked to sit down as it opens: later)
  const hostAsk = await a.page.waitForSelector('.modal input[type=number]', { timeout: 4000 }).catch(() => null);
  if (hostAsk) await a.page.click('.modal .btn:has-text("Cancel")');
  await a.page.click('.party-invite');
  await a.page.waitForSelector('.inv-picker .inv-row', { timeout: 5000 });
  await a.page.click(`.inv-row:has(.inv-name:text-is("${b.name}"))`);
  await a.page.click('.inv-foot .btn.primary');
  await b.page.waitForSelector('.inv-card', { timeout: 10_000 });
  await b.page.keyboard.press('Shift+J');
  await b.page.waitForFunction(() => window.casino.app.table?.session.target.kind === 'lobby', null, { timeout: 20_000 });
  const ask = await b.page.waitForSelector('.modal input[type=number]', { timeout: 6000 }).catch(() => null);
  check(!!ask, `${b.name} is asked for the buy-in as soon as the invite lands them at the table`);
  await shot(b, 'v13-3-buyin');
  if (ask) {
    await b.page.click('.modal .btn.primary');
    await b.page.waitForFunction(() => window.casino.app.table?.session.snapshot?.you.status === 'seated', null, { timeout: 10_000 }).catch(() => {});
    check(await b.page.evaluate(() => window.casino.app.table?.session.snapshot?.you.status === 'seated'), 'one click on it and they are sitting down');
  }
  for (const p of [a, b]) {
    await p.page.evaluate(() => window.casino.app.escape());
    const sure = await p.page.waitForSelector('.modal .btn.primary', { timeout: 2000 }).catch(() => null);
    if (sure) await sure.click();
    await p.page.waitForFunction(() => !window.casino.app.table && !window.casino.world.seated, null, { timeout: 15_000 });
  }

  // --- 4. roulette: the stack stays until the ball lands -----------------------------------------
  await a.page.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.game === 'roulette'));
  });
  const choice = await a.page.waitForSelector('.lobby-choice', { timeout: 8000 }).catch(() => null);
  if (choice) await a.page.keyboard.press('s');
  // (a run before may have left chips on this solo table: then there's no buy-in to answer)
  await a.page.waitForFunction(() => document.querySelector('.modal input[type=number]') || window.casino.app.table?.session.view?.debug?.state().stack > 0, null, { timeout: 15_000 });
  if (await a.page.$('.modal input[type=number]')) {
    await a.page.fill('.modal input[type=number]', '2000');
    await a.page.click('.modal .btn.primary');
  }
  const view = () => a.page.evaluate(() => window.casino.app.table.session.view.debug.state());
  await a.page.waitForFunction(() => window.casino.app.table?.session.view?.debug?.state().stack > 0, null, { timeout: 15_000 });
  // red and black both: one of them pays (unless a zero), so the stack after the spin is different
  await a.page.evaluate(() => window.casino.app.table.session.link.act({ type: 'bet', bets: [{ kind: 'red', amount: 10_000 }, { kind: 'black', amount: 10_000 }] }));
  await a.page.waitForFunction(() => Object.keys(window.casino.app.table.session.view.debug.state().bets ?? {}).length > 0, null, { timeout: 5000 }).catch(() => {});
  await a.page.waitForTimeout(500);
  const before = (await view()).stack;
  await a.page.keyboard.press('Space');
  await a.page.waitForFunction(() => window.casino.app.table.session.view.debug.state().animating, null, { timeout: 5000 });
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await a.page.waitForTimeout(500);
    const s = await view();
    if (!s.animating) break;
    samples.push(s.stack);
  }
  await a.page.waitForFunction(() => !window.casino.app.table.session.view.debug.state().animating, null, { timeout: 20_000 });
  const after = (await view()).stack;
  check(samples.length >= 5 && samples.every((s) => s === before), `the stack held at ${before} through the spin (${samples.join(', ')})`);
  log(`and moved once the ball had landed (${before} to ${after}; a zero would leave it)`);
  await shot(a, 'v13-4-landed');

  // --- 5. the pit boss's second catch, mid-spin ---------------------------------------------------
  const catchNow = () => a.page.evaluate(async () => {
    const r = await fetch('/casino/api/dev/law/catch', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` } });
    return (await r.json()).result;
  });
  check((await catchNow()) === 'warned', 'the first catch is a warning');
  log('waiting out the quiet after a warning (16 s)');
  await a.page.waitForTimeout(16_000);
  await a.page.evaluate(() => window.casino.app.table.session.link.act({ type: 'bet', bets: [{ kind: 'red', amount: 10_000 }] }));
  await a.page.waitForTimeout(500);
  await a.page.keyboard.press('Space');
  await a.page.waitForFunction(() => window.casino.app.table.session.view.debug.state().animating, null, { timeout: 5000 });
  const t0 = Date.now();
  check((await catchNow()) === 'jailed', 'the second, during the spin, is jail');
  await a.page.waitForTimeout(1000);
  const up = await a.page.evaluate(() => ({ table: !!window.casino.app.table, animating: window.casino.app.table?.session.view.debug.state().animating }));
  check(up.table && up.animating, `a second after, the table is still up and the ball still going (${JSON.stringify(up)})`);
  await shot(a, 'v13-5-still-spinning');
  await a.page.waitForFunction(() => !window.casino.app.table, null, { timeout: 30_000 });
  const gone = Date.now() - t0;
  await a.page.waitForFunction(() => window.casino.law?.jailed ?? document.querySelector('.law-hud:not([hidden])'), null, { timeout: 20_000 }).catch(() => {});
  await a.page.waitForTimeout(2500);
  const inside = await a.page.evaluate(() => window.casino.world.player.position.x > 160);
  check(gone > 2500 && inside, `off the table after ${gone} ms (the ball down, the boss there), and across the street in the jail (${inside})`);
  await shot(a, 'v13-5-jail');
} catch (err) {
  failed++;
  console.error(err);
}
console.log(JSON.stringify({ failed, errors: errors.slice(0, 8) }));
await browser.close();
process.exit(failed ? 1 : 0);
