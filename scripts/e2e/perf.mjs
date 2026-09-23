#!/usr/bin/env node
// Frame times on the real GPU: opens a visible Chrome window (1440x900 at 2x, like a MacBook
// screen), walks the floor and sits at a table in High and then Low graphics, and prints the
// average frame rate and the 95th-percentile frame time for each view.
// Usage: node scripts/e2e/perf.mjs [port] [outDir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', out = '/tmp/casino-perf'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const results = [];

async function sample(page, label, ms = 4000) {
  const r = await page.evaluate(async (ms) => {
    const times = [];
    let last = performance.now();
    const off = window.casino.engine.onFrame(() => {
      const t = performance.now();
      times.push(t - last);
      last = t;
    });
    await new Promise((res) => setTimeout(res, ms));
    off();
    times.shift();
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const stats = window.casino.world.stats();
    return { fps: 1000 / avg, p95: times[Math.floor(times.length * 0.95)], frames: times.length, calls: stats.calls, triangles: stats.triangles, pixelRatio: stats.pixelRatio };
  }, ms);
  results.push({ label, ...r });
  console.log(`${label.padEnd(26)} ${r.fps.toFixed(1).padStart(5)} fps   p95 ${r.p95.toFixed(1).padStart(5)} ms   ${String(r.calls).padStart(4)} calls   ${(r.triangles / 1000).toFixed(0)}k tris   pr ${r.pixelRatio}`);
  await page.screenshot({ path: `${out}/${label.replace(/\W+/g, '-')}.png` });
}

for (const quality of ['high', 'low']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((q) => localStorage.setItem('casino.quality', q), quality);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/casino/`);
  await page.waitForSelector('.name-input', { timeout: 120_000 });
  await page.fill('.name-input', 'perf_e2e');
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item', { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await sample(page, `${quality} menu pass`);
  await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await sample(page, `${quality} entrance`);
  await page.keyboard.down('KeyW');
  await sample(page, `${quality} walking in`, 3000);
  await page.keyboard.up('KeyW');
  for (const spot of ['pit', 'slots']) {
    await page.evaluate((spot) => {
      const w = window.casino.world;
      if (spot === 'pit') w.teleport((w.plan.pit.x0 + w.plan.pit.x1) / 2, w.plan.pit.z1 + 1.5, Math.PI);
      else {
        const s = w.stations.find((x) => x.id === 'slots-neon-1');
        w.teleport(s.anchor.position.x, s.anchor.position.z + 3, Math.PI);
      }
    }, spot);
    await page.waitForTimeout(1500);
    await sample(page, `${quality} ${spot}`);
  }
  await page.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === 'rl-us'));
  });
  await page.waitForSelector('.lobby-choice', { timeout: 10_000 });
  await page.keyboard.press('s');
  await page.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
  await page.fill('.modal input[type=number]', '1000');
  await page.click('.modal .btn.primary');
  await page.waitForTimeout(2500);
  await sample(page, `${quality} seated roulette`);
  await page.evaluate(() => {
    const s = window.casino.app.table.session;
    s.link.act({ type: 'bet', bets: [{ kind: 'red', amount: 500 }] });
    setTimeout(() => s.link.act({ type: 'spin' }), 300);
  });
  await page.waitForTimeout(600);
  await sample(page, `${quality} roulette spin`, 5000);
  await page.evaluate(() => window.casino.app.escape());
  const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
  if (leave) await leave.click();
  await page.waitForTimeout(1500);
  await ctx.close();
}

console.log(JSON.stringify(results));
await browser.close();
