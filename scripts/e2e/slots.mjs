#!/usr/bin/env node
// Headless check of the slot machines in the dev harness: for each machine, insert money, spin
// a few times, and screenshot the reels at rest, mid-spin, and the Pays sheet.
// Usage: node scripts/e2e/slots.mjs [port] [outDir] [variants...]

import { chromium } from 'playwright';

const [port = '5480', outDir = '/tmp', ...only] = process.argv.slice(2);
const variants = only.length ? only : ['sevens', 'neon', 'wild'];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = [];

for (const variant of variants) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  // the reels must land exactly on the stops the server sent
  let lastStops = null;
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        if (msg.t === 'ev') for (const e of msg.events) if (e.type === 'reels') lastStops = e.stops;
      } catch {}
    }),
  );
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=slots&variant=${variant}&name=sl_${variant}_${Date.now().toString(36).slice(-5)}`);
  await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
  await page.fill('.modal input[type=number]', '2000');
  await page.click('.modal .btn.primary');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/slots-${variant}-idle.png` });
  const results = [];
  for (let i = 0; i < 4; i++) {
    // wait until the machine is ready for the next spin
    await page.waitForFunction(() => !document.querySelector('.slots-deck .btn.primary')?.disabled, null, { timeout: 60000 });
    await page.keyboard.press('Space');
    if (i === 0) {
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${outDir}/slots-${variant}-spinning.png` });
    }
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => !document.querySelector('.slots-deck .btn.primary')?.disabled, null, { timeout: 90000 });
    const shown = await page.evaluate(() => {
      const offs = [];
      window.casino.engine.scene.traverse((o) => {
        const u = o.material?.uniforms;
        if (o.isMesh && u?.uOffset && o.parent?.userData?.slots) offs.push({ x: o.position.x, v: u.uOffset.value, stops: u.uStops.value });
      });
      return offs.sort((a, b) => a.x - b.x).map((o) => ((Math.round(o.v) % o.stops) + o.stops) % o.stops);
    });
    const row = variant === 'neon' ? 1 : 0;
    const want = lastStops ? lastStops.map((s) => (s + row) % (variant === 'neon' ? 32 : 22)) : null;
    const landed = want && JSON.stringify(shown) === JSON.stringify(want);
    results.push({ result: await page.evaluate(() => document.querySelector('.slots-result')?.textContent ?? '(no win)'), server: lastStops, landed });
    if (i === 1) await page.screenshot({ path: `${outDir}/slots-${variant}-after.png` });
  }
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('i');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/slots-${variant}-pays.png` });
  await page.keyboard.press('i');
  const hud = await page.textContent('.dev-hud').catch(() => '');
  report.push({ variant, hud, results, errors: errors.slice(0, 8) });
  await page.close();
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
