#!/usr/bin/env node
// 1.3: the street lamps a car knocks over, on the dev floor (Vite only): a car set rolling at a
// lamp on the ground floor's road (city.roadCars, as driving sets it) tips it over, the lamp lies
// dark in the road, and the others still stand. Screenshots before, falling and down.
// Usage: node scripts/e2e/lamps-look.mjs [port] [outDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5600', out = '/tmp/lamps-look'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=high`, { timeout: 300_000 });
await p.waitForFunction(() => window.casino?.world, null, { timeout: 300_000 });
await p.evaluate(async () => {
  const { world } = window.casino;
  world.teleport(152, 0, Math.PI / 2);
  await world.city.prepare('ground');
});
const frames = (n) => p.evaluate(async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
await frames(30);
let failed = 0;
const ok = (c, what) => (c ? console.log(`ok   ${what}`) : (failed++, console.log(`FAIL ${what}`)));
const lamps = () => p.evaluate(() => window.casino.world.city.lamps()?.felled ?? null);
ok((await lamps()) === 0, 'every lamp standing to begin with');
// the lamp at the west sidewalk's z = 0 (streets.ts: WW.x1 - 0.6); a car coming up the road at it
const lamp = await p.evaluate(() => window.casino.world.city.lampNear(150, 0));
ok(!!lamp, `a lamp to hit (${JSON.stringify(lamp)})`);
const cam = ([pos, at]) => p.evaluate(([pos, at]) => {
  const { world, engine } = window.casino;
  window.__cam?.();
  world.player.setEnabled(false);
  window.__cam = engine.onFrame(() => { engine.camera.position.set(...pos); engine.camera.lookAt(...at); });
}, [pos, at]);
await cam([[lamp.x + 9, 2.2, lamp.z + 12], [lamp.x, 3, lamp.z]]);
await frames(10);
await p.screenshot({ path: `${out}/0-standing.png` });
// a car rolling north (-z) along the lamp's line at 12 m/s, from 8 m south of it
await p.evaluate((l) => {
  const { world, engine } = window.casino;
  const car = { x: l.x + 0.8, z: l.z + 8, yaw: Math.PI, v: 12, hl: 2.4, hw: 1.0 };
  // (as the driving's list of cars on the road, whatever else sets it each frame)
  Object.defineProperty(world.city, 'roadCars', { configurable: true, get: () => [car], set() {} });
  window.__car = engine.onFrame((dt) => {
    car.z -= car.v * dt;
  });
}, lamp);
await p.waitForTimeout(700);
await p.screenshot({ path: `${out}/1-falling.png` });
// (and off the road again, before it reaches the next lamp up the street)
await p.evaluate(() => { window.__car?.(); delete window.casino.world.city.roadCars; window.casino.world.city.roadCars = []; });
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/2-down.png` });
ok((await lamps()) === 1, 'the lamp it hit is down, and only that one');
console.log(JSON.stringify({ failed, errors: errors.slice(0, 5) }));
await browser.close();
process.exit(failed ? 1 : 0);
