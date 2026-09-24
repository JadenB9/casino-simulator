#!/usr/bin/env node
// Away for a quarter hour (IDLE_MS). The page keeps its own idle clock (client/src/app/idle.ts): a
// "Still there?" a minute before the end, which any input clears; at the end it stands up from any
// table the normal way, closes its sockets and shows "You were away for 15 minutes."; Come back
// reconnects where the player stood.
//
// The quarter hour is shortened to IDLE seconds here, by swapping the app's idle clock for one with
// short times through the page's console handle (window.casino). Playwright's fake clock would keep
// the real times, but it runs the render loop flat out and starves the compositor, so nothing can
// be screenshotted. The real times are tested in client/test/idle.test.ts, the server's own idle
// close in server/test/idle.test.ts.
// Usage: node scripts/e2e/idle.mjs [port] [shots dir]   (PORT_BASE=<port> npm run dev first)

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { Meter, Server } from '../load/net.mjs';

const [port = '5173', out = ''] = process.argv.slice(2);
if (out) mkdirSync(out, { recursive: true });
const errors = [];
const fail = (m) => errors.push(m);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/casino/`);
await page.waitForSelector('.name-input, .menu-item', { timeout: 180_000 });
if (await page.$('.name-input')) {
  await page.fill('.name-input', 'idle_e2e');
  await page.fill('.pass-input', 'casino-dev'); // DEV_PASSWORD in client/src/net/api.ts
  await page.click('.enter-btn');
}
await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
// A first visit picks a look (three steps) and walks in; a later one enters from the menu.
if (await page.$('.editor-panel.guided')) {
  for (let i = 0; i < 3; i++) {
    await page.click('.editor-panel .ed-buttons .btn.primary');
    await page.waitForTimeout(500);
  }
} else {
  await page.click('.menu-item >> nth=0');
}
await page.waitForSelector('.hud', { timeout: 30_000 });
await page.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 });

// The short quarter hour: IDLE ms with nothing, the warning for the last WARN ms.
const IDLE = 20_000;
const WARN = 10_000;
await page.evaluate(
  async ([idleMs, warnMs]) => {
    const { IdleWatch } = await import('/casino/src/app/idle.ts');
    const app = window.casino.app;
    app.idle.stop();
    app.idle = new IdleWatch(app.idle.hooks, { idleMs, warnMs, hereMs: 3_000 });
    app.idle.start();
  },
  [IDLE, WARN],
);
const quiet = (ms) => page.waitForTimeout(ms);

const shot = async (name) => out && (await page.screenshot({ path: `${out}/idle-${name}.png` }));
const where = () =>
  page.evaluate(() => {
    const p = window.casino.world.player.position;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
  });
const gone = (sel) => page.waitForSelector(sel, { state: 'detached', timeout: 5_000 }).then(() => true, () => false);
const shown = (sel) => page.waitForSelector(sel, { timeout: 5_000 }).then(() => true, () => false);
const r = {};

// --- on the floor ---------------------------------------------------------------------------------
// Another player on the floor (a plain socket) watches where we are.
const server = new Server(Number(port) + 1, `http://localhost:${port}`);
const watcher = await server.login('idle_watch', '10.9.8.7', 'casino-dev');
const eye = server.connect('floor', watcher, new Meter());
await eye.next((m) => m.t === 'hello', 15_000);
const myId = await page.evaluate(() => window.casino.app.link.you.id);
const seen = { at: null, left: 0, joined: 0 };
eye.on((m) => {
  if (m.t === 's') for (const [id, x, z] of m.p) if (id === myId) seen.at = { x, z };
  if (m.t === 'leave' && m.id === myId) seen.left++;
  if (m.t === 'join' && m.player.id === myId) seen.joined++;
});
// Stand somewhere of our own (a new connection is put by the door), then touch nothing.
const SPOT = { x: 2.5, z: 8 };
await page.evaluate(({ x, z }) => window.casino.world.player.teleport(x, z, 0), SPOT);
await page.waitForTimeout(1500);
r.stood = await where();
r.seenStanding = seen.at;

await quiet(IDLE - WARN + 1_000);
r.warned = await shown('.idle-warn');
r.warning = r.warned ? (await page.textContent('.idle-warn')).replace(/\s+/g, ' ').trim() : null;
await shot('warning');
// Any input clears it, and the floor stays connected.
await page.mouse.move(700, 420);
await page.mouse.move(740, 430);
r.inputClears = await gone('.idle-warn');
r.stillOnFloor = await page.evaluate(() => window.casino.app.link?.you != null);

// Now a whole quarter hour with nothing: the warning, then away.
await quiet(IDLE - WARN + 1_000);
r.warnedAgain = await shown('.idle-warn');
await quiet(WARN);
r.away = await shown('.away');
r.awayText = r.away ? (await page.textContent('.away')).replace(/\s+/g, ' ').trim() : null;
r.warningGone = await gone('.idle-warn');
r.floorClosed = await page.evaluate(() => window.casino.app.link === null);
// Nothing reconnects by itself while the screen is up; the others saw us go.
await page.waitForTimeout(3_000);
r.stillAway = await page.evaluate(() => window.casino.app.link === null && !!document.querySelector('.away'));
r.seenLeave = seen.left;
seen.at = null;
await shot('away');

// Come back: the floor again, standing where we were.
await page.click('.away-back');
r.backOnFloor = await page.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 }).then(() => true, () => false);
await page.waitForTimeout(1500);
r.back = await where();
r.sameSpot = Math.hypot(r.back.x - r.stood.x, r.back.z - r.stood.z) < 0.05;
// ...and so do the others: back on the floor, and placed where we stood (cm), not by the door.
r.seenBack = { joined: seen.joined, at: seen.at };
r.seenSameSpot = seen.joined >= 1 && seen.at !== null && Math.hypot(seen.at.x - SPOT.x * 100, seen.at.z - SPOT.z * 100) <= 2;
r.chatShown = await page.evaluate(() => !!document.querySelector('section.chat:not([hidden])'));
await shot('back');

// --- at a table -----------------------------------------------------------------------------------
// Sit at a solo roulette table with $500 and a bet on the layout, then go quiet.
await page.evaluate(() => {
  const w = window.casino.world;
  w.enter(w.stations.find((s) => s.id === 'rl-eu'));
});
await page.waitForSelector('.lobby-choice', { timeout: 10_000 });
await page.keyboard.press('s');
await page.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
await page.fill('.modal input[type=number]', '500');
await page.click('.modal .btn.primary');
await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });
await page.evaluate(() => window.casino.app.table.session.link.act({ type: 'bet', bets: [{ kind: 'even', amount: 2500 }] }));
await page.waitForTimeout(1500);
const me = () => page.evaluate(async () => (await import('/casino/src/net/api.ts')).me());
r.inPlaySeated = (await me()).inPlay;

await quiet(IDLE - WARN + 1_000);
r.tableWarned = await shown('.idle-warn');
r.tableWarning = r.tableWarned ? (await page.textContent('.idle-warn')).replace(/\s+/g, ' ').trim() : null;
await shot('table-warning');
await quiet(WARN);
r.tableAway = await shown('.away');
r.tableAwayText = r.tableAway ? (await page.textContent('.away')).replace(/\s+/g, ' ').trim() : null;
r.tableLeft = await page.evaluate(() => window.casino.app.table === null);
// Stood up the normal way: the unspun bet came back and the chips went home.
let inPlay = r.inPlaySeated;
for (let i = 0; i < 40 && inPlay !== 0; i++) {
  await page.waitForTimeout(250);
  inPlay = (await me()).inPlay;
}
r.inPlayAfter = inPlay;
await shot('table-away');
await page.click('.away-back');
r.tableBack = await page.waitForFunction(() => window.casino.app.link?.you && !window.casino.app.table, null, { timeout: 20_000 }).then(() => true, () => false);
await page.waitForTimeout(1000);
await shot('table-back');

if (!r.warned || !/Still there\?/.test(r.warning ?? '')) fail('no "Still there?" before the end');
if (!r.inputClears || !r.stillOnFloor) fail('input did not clear the warning');
if (!r.warnedAgain || !r.away || !/You were away for 15 minutes\./.test(r.awayText ?? '')) fail('no away screen at the end');
if (!r.floorClosed || !r.stillAway) fail('the floor stayed connected (or reconnected) while away');
if (!r.backOnFloor || !r.sameSpot) fail(`Come back did not put us back where we stood: ${JSON.stringify([r.stood, r.back])}`);
if (!r.chatShown) fail('the floor chat stayed hidden after Come back');
if (r.seenLeave < 1 || !r.seenSameSpot) fail(`the others did not see us leave and come back to the same spot: ${JSON.stringify({ left: r.seenLeave, ...r.seenBack })}`);
if (!r.tableWarned || !/leave the table/.test(r.tableWarning ?? '')) fail('no table warning');
if (!r.tableAway || !r.tableLeft || r.inPlayAfter !== 0) fail(`not stood up from the table: ${JSON.stringify({ away: r.tableAway, left: r.tableLeft, inPlay: r.inPlayAfter })}`);
if (!r.tableBack) fail('Come back from the table did not reach the floor');
console.log(JSON.stringify({ ...r, errors }, null, 2));
eye.close();
await browser.close();
process.exit(errors.length ? 1 : 0);
