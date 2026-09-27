#!/usr/bin/env node
// 1.3: holes into nothing. Logs in on the local stack (the ground floor with the jail, the garage
// and the stores), hides the sky dome, makes the empty background magenta, and looks round from
// points on the sidewalks, the plaza, the drive and (LIFT=home:<id> / ZONE) the apartment: any
// magenta at or under the horizon is a gap you'd see space through. Prints each, screenshots them.
// Usage: node scripts/e2e/gaps-look.mjs [port] [outDir]   POINTS='[[x,z],...]' to pick the spots, SAVE=1 keeps every shot
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port = '5600', out = '/tmp/gaps-look'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ viewport: { width: 960, height: 600 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`http://localhost:${port}/casino/`, { timeout: 300_000 });
await p.waitForSelector('.name-input', { timeout: 300_000 });
await p.fill('.name-input', process.env.NAME ?? 'gaps_e2e_1');
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
const [to, apt] = (process.env.LIFT ?? 'ground').split(':');
// (the apartment: TIER=apt-residence|apt-grand|apt-penthouse given in the local database, then in again)
if (to === 'home' && process.env.TIER) {
  const id = await p.evaluate(() => window.casino.app.link.you.id);
  execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', `INSERT OR IGNORE INTO casino_items (account_id, item, price, bought_at, op_id) VALUES (${id}, '${process.env.TIER}', 100, ${Date.now()}, 'gaps-${id}-${process.env.TIER}')`], { stdio: 'pipe', env: { ...process.env, CI: '1' } });
  await p.reload();
  await p.waitForSelector('.menu-item, .hud', { timeout: 60000 });
  if (await p.$('.menu-item')) await p.click('.menu-item >> nth=0');
  await p.waitForSelector('.hud', { timeout: 30000 });
  await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20000 });
  await p.keyboard.press('Escape');
}
await p.evaluate(([to, apt]) => window.casino.app.link.send(apt ? { t: 'lift', to, apt: Number(apt) } : { t: 'lift', to }), [to, apt]);
await p.waitForFunction((to) => window.casino.world.zone === to && !window.casino.world.city.riding, to, { timeout: 30000 });
await p.waitForTimeout(3000);
const frames = (n) => p.evaluate(async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
await p.evaluate(() => {
  const { engine } = window.casino;
  engine.scene.traverse((o) => {
    const m = o.material;
    if (o.isMesh && m && !Array.isArray(m) && (m.name?.startsWith('sky-') || o.name?.startsWith('sky'))) o.visible = false;
    if (o.isPoints) o.visible = false;
  });
  engine.scene.background = null;
  engine.renderer.setClearColor(0xff00ff, 1);
  engine.scene.fog = null;
});
const GROUND = [[128.5, 0], [128.5, -30], [128.5, 30], [151.5, -40], [151.5, 40], [164.5, -12], [164.5, 30], [150, -60], [150, 60], [185, -66], [185, 66], [203, -40], [203, 0], [203, 40], [175, -60], [118, 0], [136, 8]];
const HOME = [[-152, 70], [-140, 78], [-136, 66], [-150, 60], [-126, 70]];
const points = process.env.POINTS ? JSON.parse(process.env.POINTS) : to === 'home' ? HOME : GROUND;
let gaps = 0;
for (const [x, z] of points) {
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * Math.PI * 2;
    await p.evaluate(([x, z, yaw, eye]) => {
      const { world, engine } = window.casino;
      window.__cam?.();
      world.player.setEnabled(false);
      window.__cam = engine.onFrame(() => {
        engine.camera.position.set(x, eye, z);
        engine.camera.lookAt(x + Math.sin(yaw) * 10, eye - 0.3, z + Math.cos(yaw) * 10);
      });
    }, [x, z, yaw, Number(process.env.EYE ?? 1.6)]);
    await frames(6);
    const buf = await p.screenshot();
    // magenta under the middle of the frame (the horizon's a little above it, looking slightly down)
    const n = await p.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, Math.floor(img.height * 0.4), img.width, Math.floor(img.height * 0.6)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) n++;
      return n;
    }, buf.toString('base64'));
    if (process.env.SAVE === '1') await p.screenshot({ path: `${out}/look-${x}_${z}_${k}.png` });
    if (n > 40) {
      gaps++;
      const name = `${out}/gap-${x}_${z}_${k}.png`;
      await p.screenshot({ path: name });
      console.log(`GAP ${n}px at (${x}, ${z}) looking ${Math.round((yaw * 180) / Math.PI)}°  ${name}`);
    }
  }
}
console.log(JSON.stringify({ gaps, errors: errors.slice(0, 5) }));
await browser.close();
