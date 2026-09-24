#!/usr/bin/env node
// A dropped connection keeps the seat: sit at a solo table with a bet on the layout, break the
// table socket the way a network drop would (no close handshake from the client's side), and
// check the client reconnects on its own to the same seat, stack and bet.
// Usage: node scripts/e2e/reconnect.mjs [port]   (PORT_BASE=<port> npm run dev first)

import { chromium } from 'playwright';

const [port = '5173'] = process.argv.slice(2);
const errors = [];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/casino/`);
await page.waitForSelector('.name-input, .menu-item', { timeout: 180_000 });
if (await page.$('.name-input')) {
  await page.fill('.name-input', 'drop_e2e');
  await page.fill('.pass-input', 'casino-dev'); // DEV_PASSWORD in client/src/net/api.ts
  await page.click('.enter-btn');
}
await page.waitForSelector('.menu-item', { timeout: 20_000 });
await page.click('.menu-item >> nth=0');
await page.waitForSelector('.hud', { timeout: 20_000 });
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
// A bet on the layout, not yet spun.
await page.evaluate(() => window.casino.app.table.session.link.act({ type: 'bet', bets: [{ kind: 'even', amount: 2500 }] }));
await page.waitForTimeout(1500);
const before = await page.evaluate(() => {
  const s = window.casino.app.table.session;
  const snaps = [];
  const orig = s.onMessage.bind(s);
  s.onMessage = (m) => {
    if (m.t === 'table') snaps.push({ you: m.you, bets: m.view?.seats?.[m.you.seat]?.bets ?? m.view?.bets ?? null });
    orig(m);
  };
  window.__snaps = snaps;
  // What the network drop looks like to the page: the socket dies without a clean close.
  s.socket.ws.close(4999, 'simulated drop');
  return true;
});
await page.waitForFunction(() => (window.__snaps?.length ?? 0) > 0, null, { timeout: 30_000 });
const snap = await page.evaluate(() => window.__snaps[0]);
console.log(JSON.stringify({ reconnected: snap.you, bets: snap.bets }));
if (snap.you.status !== 'seated' || snap.you.stack !== 47_500) errors.push(`seat not restored: ${JSON.stringify(snap.you)}`);
// Leave cleanly so the next run starts fresh.
await page.evaluate(() => window.casino.app.escape());
const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
if (leave) await leave.click();
await page.waitForTimeout(2500);
console.log(JSON.stringify({ before, errors }));
await browser.close();
process.exit(errors.length ? 1 : 0);
