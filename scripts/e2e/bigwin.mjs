#!/usr/bin/env node
// The big-win flow in the game proper, end to end through the worker. The page gets the floor-life
// wiring the way app/boot.ts will (mountFloorLife, then connect to the floor link). A winner plays
// solo blackjack at $5,000 a hand until one pays $5,000 or more; a watcher out on the floor must
// then get the toast (after the winner has seen the hand), the sign over the pit must tell it, the
// day's meter must count it, and the winner gets no toast for their own win. Also: the Settings
// sheet with the new Floor block.
// Usage: node scripts/e2e/bigwin.mjs [port] [outDir]   (PORT_BASE=<port> npm run dev first)
// Fixed names (the new-account limit): feat_bigwinner, feat_floorwatch. The floor announces one
// win a minute per player, so a second run within a minute waits for the next one.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5980', out = '/tmp/bigwin'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const BASE = `http://localhost:${port}`;
const WINNER = 'feat_bigwinner';
const WATCHER = 'feat_floorwatch';
const errors = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
// GPU=1: visible windows on the real GPU (faster, and the screenshots are what a player sees)
const browser = process.env.GPU === '1'
  ? await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required'] })
  : await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

async function player(name, quality) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((q) => localStorage.setItem('casino.quality', q), quality);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`${BASE}/casino/`);
  await page.waitForSelector('.name-input, .menu-item', { timeout: 240_000 });
  if (await page.$('.name-input')) {
    await page.fill('.name-input', name);
    await page.click('.enter-btn');
  }
  await page.waitForSelector('.menu-item', { timeout: 30_000 });
  await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 30_000 });
  // the wiring from the report: mount once the world exists, connect to the floor link
  await page.evaluate(async () => {
    const { mountFloorLife } = await import('/casino/src/ui/feed/index.ts');
    const c = window.casino;
    const life = mountFloorLife({ engine: c.engine, world: c.world, sfx: c.app.sfx });
    life.connect(c.app.link, { onFloor: () => c.app.hud !== null && c.app.table === null && c.world.seated === null });
    c.life = life;
  });
  return page;
}

const watcher = await player(WATCHER, 'high');
const winner = await player(WINNER, 'low');
log('both on the floor');

// The watcher stands in the cross aisle, looking up at the sign over the pit.
await watcher.evaluate(async () => {
  const c = window.casino;
  const { marqueePlacement } = await import('/casino/src/world/marquee.ts');
  const m = marqueePlacement(c.world.plan);
  const cross = c.world.plan.aisles[0];
  c.world.player.teleport(m.x + 1.5, (cross.z0 + cross.z1) / 2, Math.PI);
  c.engine.onFrame(() => {
    c.engine.camera.position.set(m.x + 2.2, 1.75, c.world.plan.staff.z1 + 3.4);
    c.engine.camera.lookAt(m.x, 3.1, m.z);
  });
});

// The winner sits at blackjack alone and plays $5,000 hands, standing, until one pays.
await winner.evaluate(() => {
  const w = window.casino.world;
  w.enter(w.stations.find((s) => s.id === 'bj-1'));
});
await winner.waitForSelector('.lobby-choice', { timeout: 20_000 });
await winner.keyboard.press('s');
await winner.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
await winner.fill('.modal input[type=number]', '20000');
await winner.click('.modal .btn.primary');
await winner.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
log('winner seated at bj-1');

async function hand() {
  return winner.evaluate(async () => {
    const s = window.casino.app.table.session;
    const act = (a) => s.link.act(a);
    const seat = () => s.snapshot?.you?.seat;
    return new Promise((resolve) => {
      let bet = 0;
      let paid = 0;
      const orig = s.onMessage.bind(s);
      const timer = setTimeout(() => done(null), 60_000);
      const done = (r) => {
        clearTimeout(timer);
        s.onMessage = orig;
        resolve(r);
      };
      s.onMessage = (m) => {
        orig(m);
        if (m.t === 'seat') s.__stack = m.stack;
        if (m.t !== 'ev') return;
        for (const e of m.events) {
          if (e.type === 'turn' && e.seat === seat()) act({ type: 'stand' });
          if (e.type === 'insurance') act({ type: 'insurance', take: false });
          if (e.type === 'result' && e.seat === seat()) {
            bet += e.bet;
            paid += e.payout;
          }
          if (e.type === 'done') done({ bet, paid, net: paid - bet, at: Date.now() });
        }
      };
      setTimeout(() => act({ type: 'bet', amount: 500_000 }), 300);
      setTimeout(() => act({ type: 'deal' }), 900);
    });
  });
}

let won = null;
for (let i = 0; i < 14 && !won; i++) {
  const r = await hand();
  log(`hand ${i + 1}: ${r ? `net $${r.net / 100}` : 'no result'}`);
  if (r && r.net >= 500_000) won = r;
  const stack = await winner.evaluate(() => window.casino.app.table?.session.__stack ?? 2_000_000);
  if (!won && stack < 500_000) {
    errors.push('the winner ran out of chips before a hand paid $5,000');
    break;
  }
  await winner.waitForTimeout(1500);
}

if (won) {
  log(`a hand paid $${won.net / 100}`);
  // Toasts wait for the winner to have seen the hand (blackjack: about three seconds).
  const toast = await watcher.waitForSelector('.bigwin-toast', { timeout: 20_000 }).catch(() => null);
  const seenAt = Date.now();
  if (!toast) {
    errors.push('the watcher got no toast (a run within a minute of the last one is held back by the floor: run again)');
  } else {
    const text = (await toast.textContent()) ?? '';
    log(`watcher's toast after ${((seenAt - won.at) / 1000).toFixed(1)} s: ${text}`);
    if (!text.toLowerCase().includes(WINNER)) errors.push(`toast without the winner's name: ${text}`);
    if (!/\$5,000|\$7,500/.test(text)) errors.push(`toast without the amount: ${text}`);
    if (!/Blackjack/.test(text)) errors.push(`toast without the game: ${text}`);
    await watcher.waitForFunction(() => getComputedStyle(document.querySelector('.bigwin-toast')).opacity === '1', null, { timeout: 30_000 }).catch(() => {});
    await watcher.screenshot({ path: `${out}/bigwin-watcher-toast.png` });
    await watcher.waitForTimeout(2200);
    await watcher.screenshot({ path: `${out}/bigwin-watcher-amount.png` });
    await watcher.waitForTimeout(3000);
    await watcher.screenshot({ path: `${out}/bigwin-watcher-line.png` });
    const meter = await watcher.evaluate(() => ({ total: window.casino.life.tally.target ?? null }));
    log(`watcher's meter: ${JSON.stringify(meter)}`);
  }
  const own = await winner.$('.bigwin-toast');
  if (own) errors.push('the winner got a toast for their own win');
  await winner.screenshot({ path: `${out}/bigwin-winner.png` });
}

// Settings: the new Floor block with the toast switch.
await watcher.evaluate(async () => {
  const { openSettings } = await import('/casino/src/ui/menu/index.ts');
  const c = window.casino;
  openSettings({ root: document.getElementById('ui'), sfx: c.app.sfx });
});
await watcher.waitForSelector('.settings-sheet', { timeout: 10_000 });
await watcher.waitForTimeout(500);
await watcher.screenshot({ path: `${out}/bigwin-settings.png` });

// leave the table so the chips go home
await winner.evaluate(() => window.casino.app.escape());
const leave = await winner.waitForSelector('.modal .btn.primary', { timeout: 5000 }).catch(() => null);
if (leave) await leave.click();
await winner.waitForTimeout(3000);

await browser.close();
for (const e of errors) console.log(`FAIL ${e}`);
console.log(errors.length ? `${errors.length} failed` : 'all checks passed');
process.exit(errors.length ? 1 : 0);
