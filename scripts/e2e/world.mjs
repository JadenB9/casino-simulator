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
if (shots.some(([v]) => v === 'layout')) {
  // the floor plan's own checks, for today's footprints and for typical real ones (tables with
  // their chairs, slot and video poker cabinets), so the layout survives the merge
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=low&view=overview`);
  const result = await page.evaluate(async () => {
    const L = await import('/casino/src/world/layout.ts');
    const G = await import('/casino/src/games/index.ts');
    const real = {
      blackjack: { width: 2.5, depth: 2.0 }, baccarat: { width: 2.8, depth: 2.1 }, threecard: { width: 2.5, depth: 2.0 },
      roulette: { width: 3.1, depth: 2.2 }, craps: { width: 4.3, depth: 2.4 }, holdem: { width: 3.0, depth: 2.3 },
      slots: { width: 0.8, depth: 0.9 }, videopoker: { width: 0.7, depth: 0.8 }, highcard: { width: 1.6, depth: 1.6 },
    };
    const today = L.checkLayout(L.planFloor((g) => G.GAMES[g].footprint));
    const merged = L.checkLayout(L.planFloor((g) => real[g]));
    return { today, merged };
  });
  console.log(JSON.stringify({ view: 'layout', ...result }));
  await page.close();
}
for (const [view, quality] of shots.filter(([v]) => v !== 'layout')) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const extra = view === 'lineup' ? '&lineup=1' : ['walk', 'play', 'cashierwalk'].includes(view) ? '' : `&view=${view}`;
  await page.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=${quality}&stats=1${extra}`);
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 90000 });
  if (view === 'walk') {
    // walk north up the main aisle for a moment
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(2500);
    await page.keyboard.up('KeyW');
  }
  if (view === 'play' || view === 'cashierwalk') {
    // stand in front of a station (or the cashier), read the prompt, press E, then Esc
    const check = await page.evaluate((v) => {
      const w = window.casino.world;
      if (v === 'cashierwalk') {
        const c = w.cashier.position;
        w.teleport(c.x, c.z + 0.4, Math.PI);
      } else {
        const s = w.stations.find((x) => x.id === 'bj-1');
        const a = s.anchor.position;
        const d = s.footprint.depth / 2 + 0.9;
        w.teleport(a.x + Math.sin(s.yaw) * d, a.z + Math.cos(s.yaw) * d, s.yaw + Math.PI);
      }
      return { at: [w.player.position.x.toFixed(2), w.player.position.z.toFixed(2)] };
    }, view);
    await page.waitForTimeout(600);
    const prompt = await page.evaluate(() => document.querySelector('.world-prompt:not([hidden])')?.textContent ?? null);
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(1600);
    const seated = await page.evaluate(() => ({ focus: window.casino.world.focus?.id ?? null, cam: window.casino.engine.camera.position.toArray().map((n) => +n.toFixed(2)) }));
    await page.screenshot({ path: `${out}/world-${view}-seated-${quality}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    const back = await page.evaluate(() => ({ cam: window.casino.engine.camera.position.toArray().map((n) => +n.toFixed(2)) }));
    console.log(JSON.stringify({ view, check, prompt, seated, back }));
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
