#!/usr/bin/env node
// 1.3: every sign over a doorway, from where you'd read it (dev floor, Vite only): a screenshot
// each, and a check that none sits up behind the ceiling or across another sign. For looking.
// Usage: node scripts/e2e/signs-look.mjs [port] [outDir]   ONLY=bingo only doors into that room
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5600', out = '/tmp/signs-look'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=high`, { timeout: 300_000 });
await p.waitForFunction(() => window.casino?.world, null, { timeout: 300_000 });
const frames = (n) => p.evaluate(async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
await frames(30);
const signs = await p.evaluate(() => window.casino.world.signs?.() ?? null);
if (!signs) throw new Error('world.signs() is missing');
console.log('signs', signs.length);
let bad = 0;
for (const [i, s] of signs.entries()) {
  if (process.env.ONLY && !s.text.toLowerCase().includes(process.env.ONLY)) continue;
  const [x, y, z] = s.at;
  const nx = Math.sin(s.ry);
  const nz = Math.cos(s.ry);
  if (s.overlaps?.length) {
    bad++;
    console.log(`OVERLAP ${s.text} with ${s.overlaps.join(', ')}`);
  }
  if (s.hidden) {
    bad++;
    console.log(`HIDDEN ${s.text} at ${x.toFixed(1)},${y.toFixed(2)},${z.toFixed(1)}: ${s.hidden}`);
  }
  if (process.env.SHOTS === '0') continue;
  await p.evaluate(([pos, at]) => {
    const { world, engine } = window.casino;
    window.__cam?.();
    world.player.setEnabled(false);
    window.__cam = engine.onFrame(() => {
      engine.camera.position.set(...pos);
      engine.camera.lookAt(...at);
    });
  }, [[x + nx * 4, 1.6, z + nz * 4], [x, y, z]]);
  await frames(12);
  await p.screenshot({ path: `${out}/${String(i).padStart(2, '0')}-${s.text.replace(/[^A-Za-z]+/g, '_')}.png` });
}
console.log(JSON.stringify({ bad, errors: errors.slice(0, 5) }));
await browser.close();
