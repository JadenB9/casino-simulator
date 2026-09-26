#!/usr/bin/env node
// Screenshots of the ground floor's street, loop road and buildings from where people walk and
// drive (dev floor, no server), and each view's draw calls. For looking, not for passing.
// Usage: node scripts/e2e/street-look.mjs [port] [outDir] [quality]   GPU=1 draws on the GPU.
//   GAME=1 logs in (streetlook_e2e_1, dev password; needs the local worker too) and rides down, so
//   the jail, the garage and the stores are there; otherwise the dev floor (Vite only).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6350', out = '/tmp/street-look', quality = 'high'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const gpu = process.env.GPU === '1';
const browser = await chromium.launch(gpu ? { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
if (process.env.GAME === '1') {
  await p.goto(`http://localhost:${port}/casino/`, { timeout: 300_000 });
  await p.waitForSelector('.name-input', { timeout: 300_000 });
  await p.fill('.name-input', 'streetlook_e2e_1');
  if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
  await p.click('.enter-btn');
  await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 30000 });
  if (await p.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) {
      await p.click('.editor-panel .ed-buttons .btn.primary');
      await p.waitForTimeout(500);
    }
  } else await p.click('.menu-item >> nth=0');
  await p.waitForSelector('.hud', { timeout: 30000 });
  await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20000 });
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.casino.app.settings?.set?.({ quality: undefined }));
  const car = await p.evaluate(() => {
    const L = window.casino.world.city.casinoBank;
    return { ...L.centre(0), yaw: L.yaw };
  });
  await p.evaluate(([x, z, y]) => window.casino.world.teleport(x, z, y), [car.x, car.z, car.yaw]);
  await p.waitForTimeout(600);
  await p.evaluate(() => window.casino.app.link.send({ t: 'lift', to: 'ground' }));
  await p.waitForFunction(() => window.casino.world.zone === 'ground' && !window.casino.world.city.riding, null, { timeout: 30000 });
} else {
  await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=${quality}`, { timeout: 300_000 });
  await p.waitForFunction(() => window.casino?.world, null, { timeout: 300_000 });
  await p.evaluate(async () => {
    const { world } = window.casino;
    world.teleport(152, 0, Math.PI / 2);
    await world.city.prepare('ground');
  });
}
const frames = (n) => p.evaluate(async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
await frames(40);
const VIEWS = (process.env.VIEWS ? JSON.parse(process.env.VIEWS) : [
  ['street-north', [151.5, 1.7, -6], [158, 2, -60]],
  ['street-south', [151.5, 1.7, 6], [158, 2, 60]],
  ['crosswalk', [152, 1.7, 0], [175, 3, 0]],
  ['across', [164.5, 1.7, -12], [185, 4, -30]],
  ['corner', [150, 1.7, -50], [175, 2, -72]],
  ['north-road', [180, 1.7, -64], [215, 3, -70]],
  ['east-road', [203, 1.7, -40], [208, 3, 20]],
  ['stores', [175, 1.7, -76], [175, 5, -95]],
  ['overview', [140, 40, -10], [185, 0, 0]],
  ['driver', [157, 1.3, 40], [157, 1.3, -20]],
]);
for (const [name, pos, at] of VIEWS) {
  await p.evaluate(([pos, at]) => {
    const { world, engine } = window.casino;
    window.__cam?.();
    world.player.setEnabled(false);
    window.__cam = engine.onFrame(() => { engine.camera.position.set(...pos); engine.camera.lookAt(...at); });
  }, [pos, at]);
  await frames(20);
  const calls = await p.evaluate(() => window.casino.world.stats().calls);
  await p.screenshot({ path: `${out}/${quality}-${name}.png` });
  console.log(name, 'calls', calls);
  if (process.env.BREAKDOWN === '1') {
    // what's drawing: meshes in the view (visible all the way up, inside the frustum), by the nearest named ancestor
    const rows = await p.evaluate(() => {
      const { engine } = window.casino;
      const cam = engine.camera;
      const THREE_ = Object.getPrototypeOf(cam.projectionMatrix).constructor; // Matrix4
      const m = new THREE_().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const e = m.elements;
      const planes = [[e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]], [e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]], [e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]], [e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]], [e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]], [e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]]].map(([a, b, c, d]) => { const l = Math.hypot(a, b, c); return [a / l, b / l, c / l, d / l]; });
      const shown = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
      const counts = {};
      engine.scene.traverse((o) => {
        if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !shown(o)) return;
        if (o.frustumCulled !== false && o.geometry) {
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          const bs = o.geometry.boundingSphere;
          const c = bs.center.clone().applyMatrix4(o.matrixWorld);
          const r = bs.radius * o.matrixWorld.getMaxScaleOnAxis();
          if (planes.some(([a, b, cc, d]) => a * c.x + b * c.y + cc * c.z + d < -r)) return;
        }
        let key = o.name || '?';
        for (let x = o.parent; x && x.parent; x = x.parent) if (x.name) { key = `${x.name}/${key}`; break; }
        const n = Array.isArray(o.material) ? Math.max(1, o.geometry.groups.length) : 1;
        counts[key] = (counts[key] ?? 0) + n;
      });
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30);
    });
    for (const [k, n] of rows) console.log(`   ${String(n).padStart(4)}  ${k}`);
  }
}
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
