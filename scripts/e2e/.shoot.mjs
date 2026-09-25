// scratch: node scripts/e2e/.shoot.mjs port out quality name:room:px,py,pz:ax,ay,az ...
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [port, out, quality, ...views] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => (m.type() === 'error' || m.text().startsWith('floor plan')) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=${quality}`, { timeout: 300000 });
await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600000 });
for (const v of views) {
  const [name, room, p, a] = v.split(':');
  const pos = p.split(',').map(Number);
  const at = a.split(',').map(Number);
  await page.evaluate(([room, pos, at]) => {
    const { world, engine } = window.casino;
    const r = world.plan.rooms.find((q) => q.id === room);
    const P = [r.cx + pos[0], pos[1], r.cz + pos[2]];
    const A = [r.cx + at[0], at[1], r.cz + at[2]];
    world.player.setEnabled(false);
    world.player.character.root.visible = false;
    window.__cam?.();
    window.__cam = engine.onFrame(() => {
      engine.camera.fov = 60;
      engine.camera.updateProjectionMatrix();
      engine.camera.position.set(...P);
      engine.camera.lookAt(...A);
    });
  }, [room, pos, at]);
  await page.waitForTimeout(1800);
  const calls = await page.evaluate(() => window.casino.world.stats().calls);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, 'calls', calls);
}
console.log(errors.slice(0, 20).join('\n'));
await browser.close();
