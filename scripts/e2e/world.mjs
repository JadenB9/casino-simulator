#!/usr/bin/env node
// Headless look at the casino floor: loads the dev floor at several fixed views and qualities,
// screenshots each, and logs draw calls, triangles and frame time. No server needed (Vite only).
// Usage: node scripts/e2e/world.mjs [port] [out dir] [views...]
//   views: entrance overview slots pit cashier bar poker lounge table lineup walk (default: a set)
// Add GPU=1 to render on the machine's GPU (Metal via ANGLE) instead of SwiftShader, for real
// frame times.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5400', out = '/tmp/world', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const gpu = process.env.GPU === '1';
const args = gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args });
const shots = wanted.length
  ? wanted.map((w) => (w.includes(':') ? w.split(':') : [w, 'high']))
  : [['entrance', 'high'], ['overview', 'high'], ['slots', 'high'], ['pit', 'high'], ['cashier', 'high'], ['bar', 'high'], ['poker', 'high'], ['overview', 'low'], ['pit', 'low']];
const report = [];
for (const [view, quality] of shots) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const extra = view === 'lineup' ? '&lineup=1' : view === 'walk' ? '' : `&view=${view}`;
  await page.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=${quality}&stats=1${extra}`);
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 90000 });
  if (view === 'walk') {
    // walk north up the main aisle for a moment, then turn toward the pit
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');
  }
  await page.waitForTimeout(view === 'table' ? 2500 : 1500);
  // average a few seconds of frames
  const stats = await page.evaluate(async () => {
    const c = window.casino;
    const t0 = performance.now();
    let frames = 0;
    await new Promise((r) => {
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else r();
      };
      requestAnimationFrame(tick);
    });
    const s = c.world.stats();
    return { ...s, frameMs: +((performance.now() - t0) / frames).toFixed(2), prompt: document.querySelector('.world-prompt:not([hidden])')?.textContent ?? null };
  });
  const file = `${out}/world-${view}-${quality}.png`;
  await page.screenshot({ path: file });
  report.push({ view, quality, file, ...stats, errors: errors.slice(0, 5) });
  console.log(JSON.stringify(report.at(-1)));
  await page.close();
}
await browser.close();
