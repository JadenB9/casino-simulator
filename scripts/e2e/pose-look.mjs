#!/usr/bin/env node
// v7.4: your own character caught mid-move from the side, for looking: the jump at its top, a
// crouch standing and walking, the Twerk and Throw It Back (dev floor, Vite only).
// Usage: node scripts/e2e/pose-look.mjs [port] [outDir]    GPU=1 draws on the GPU.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6350', out = '/tmp/pose-look'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const gpu = process.env.GPU === '1';
const browser = await chromium.launch(gpu ? { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=high`, { timeout: 300_000 });
await p.waitForFunction(() => window.casino?.world?.player?.character, null, { timeout: 300_000 });
const frames = (n) => p.evaluate(async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
await p.evaluate(() => {
  const { world, engine } = window.casino;
  world.teleport(0, 10, 0);
  world.player.setEnabled(false);
  window.__cam = engine.onFrame(() => {
    const c = world.player.character.root.position;
    engine.camera.position.set(c.x + 3.2, 1.2, c.z + 0.6);
    engine.camera.lookAt(c.x, 0.85, c.z);
  });
});
await frames(60);
const shot = (name) => p.screenshot({ path: `${out}/${name}.png` });
const gesture = (e) => p.evaluate((e) => window.casino.world.player.character.gesture(e), e);
const wait = (ms) => p.waitForTimeout(ms);
await gesture('jump');
await wait(390);
await shot('jump-top');
await wait(800);
await p.evaluate(() => window.casino.world.player.character.crouch(true));
await wait(800);
await shot('crouch');
await p.evaluate(() => window.casino.world.player.character.setMotion(0.45));
await wait(700);
await shot('crouch-walk');
await p.evaluate(() => { const ch = window.casino.world.player.character; ch.setMotion(0); ch.crouch(false); });
await wait(800);
for (const e of ['twerk', 'throwback']) {
  await gesture(e);
  await wait(1200);
  await shot(`${e}-a`);
  await wait(130);
  await shot(`${e}-b`);
  await wait(2800);
}
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
