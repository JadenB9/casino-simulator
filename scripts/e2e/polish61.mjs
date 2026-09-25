#!/usr/bin/env node
// A visual tour of the whole building for the v6.1 polish pass (the dev floor, Vite only). Usage:
//   GPU=1 node scripts/e2e/polish61.mjs [port] [out dir] [high|low|both] [only...]
// Every room from two corners (<quality>-<room>-a/b.png), the doorway views the dev floor knows,
// the ground floor's lots (the valet lobby, the valet, the street, the garage, the jail) and the
// roof, each with the frame's draw calls; `only` limits it to shots whose name has one of the words.
// Draw calls on High over CALL_LIMIT (250) fail.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6490', out = '/tmp/polish61', which = 'high', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const gpu = process.env.GPU === '1';
const args = gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chromium', args });
const CALL_LIMIT = Number(process.env.CALL_LIMIT ?? 250);
let failed = 0;

async function tour(quality) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=${quality}`, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600000 });
  // the loading screen's fade
  await page.waitForTimeout(700);
  const poses = await page.evaluate(() => {
    const { world } = window.casino;
    const out = [];
    for (const r of world.plan.rooms) {
      const b = r.bounds;
      const w = b.x1 - b.x0;
      const d = b.z1 - b.z0;
      const h = Math.min(1.8, 1.2 + Math.min(w, d) * 0.04);
      // from inside two opposite corners, looking across the room
      out.push({ name: `${r.id}-a`, tp: [r.cx, r.cz], pos: [b.x0 + w * 0.12, h, b.z0 + d * 0.12], at: [r.cx + w * 0.15, 1.0, r.cz + d * 0.15] });
      out.push({ name: `${r.id}-b`, tp: [r.cx, r.cz], pos: [b.x1 - w * 0.12, h, b.z1 - d * 0.12], at: [r.cx - w * 0.15, 1.0, r.cz - d * 0.15] });
    }
    // each room from its main doorway, looking in (dev-floor.ts's views)
    const views = {
      lobby: [[0, 1.7, 5.2], [0, 1.4, -9]],
      pit: [[9, 1.9, 1.4], [-4, 0.9, -4.5]],
      slots: [[8.2, 1.8, 1.6], [-4, 1.0, -4]],
      bar: [[-7, 1.8, 9.5], [6, 1.2, -1]],
      lounge: [[0, 1.7, -5.2], [0, 0.8, 3]],
      poker: [[-9, 1.8, 5.2], [2, 0.8, -1]],
      salon: [[0, 1.8, 5.4], [0, 1.0, -3]],
      online: [[9, 1.7, 5.3], [-2, 1.0, -1]],
      yard: [[1.6, 1.8, -5.2], [0.6, 1.6, 3.8]],
      bank: [[4.4, 1.7, 0.5], [0, 1.4, -5]],
      boutique: [[-4.4, 1.7, 0.5], [3, 1.2, 0.5]],
      parlour: [[0, 1.7, 5.3], [0, 1.3, -3]],
      cardroom: [[7.3, 1.8, 5.3], [-1, 1.0, -2]],
      bingo: [[0, 1.9, 5.3], [0, 1.4, -3]],
    };
    for (const [id, [p, a]] of Object.entries(views)) {
      const r = world.plan.rooms.find((q) => q.id === id);
      if (r) out.push({ name: `${id}-door`, tp: [r.cx, r.cz], pos: [r.cx + p[0], p[1], r.cz + p[2]], at: [r.cx + a[0], a[1], r.cz + a[2]] });
    }
    // the ground floor's lots and the roof (zones.ts, metres): the player stands there so the zone is built
    const lots = {
      'ground-lobby': [[114, 0], [104, 1.7, 8], [120, 1.2, -4]],
      'ground-valet': [[139, 0], [131, 1.8, -12], [146, 0.8, 6]],
      'ground-street': [[158, 0], [152, 2.2, -20], [162, 1, 10]],
      'ground-garage': [[182, 25], [170, 1.8, 12], [192, 0.8, 38]],
      'ground-jail': [[181, -25], [170, 1.8, -10], [190, 1.0, -40]],
      'roof-a': [[-135, 0], [-150, 1.8, -10], [-120, 1.2, 12]],
      'roof-b': [[-135, 0], [-120, 1.8, 12], [-155, 3, -6]],
    };
    for (const [name, [tp, pos, at]] of Object.entries(lots)) out.push({ name, tp, pos, at });
    return out;
  });
  const shots = [];
  for (const p of poses) {
    if (only.length && !only.some((w) => p.name.includes(w))) continue;
    const s = await page.evaluate(async (p) => {
      const { world, engine } = window.casino;
      world.teleport(p.tp[0], p.tp[1], 0);
      world.player.setEnabled(false);
      world.player.character.root.visible = false;
      window.__cam?.();
      window.__cam = engine.onFrame(() => {
        engine.camera.fov = 60;
        engine.camera.updateProjectionMatrix();
        engine.camera.position.set(...p.pos);
        engine.camera.lookAt(...p.at);
      });
      for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
      return world.stats();
    }, p);
    const file = `${quality}-${p.name}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    shots.push(`${p.name} ${s.calls}`);
    if (quality === 'high' && s.calls > CALL_LIMIT) {
      failed++;
      console.log(`FAIL ${quality} ${p.name}: ${s.calls} draw calls`);
    }
  }
  console.log(`${quality}: ${shots.join(' | ')}`);
  if (errors.length) {
    failed++;
    console.log(`FAIL ${quality} page errors: ${errors.slice(0, 3).join(' | ')}`);
  }
  await page.close();
}

for (const q of which === 'both' ? ['high', 'low'] : [which]) await tour(q);
await browser.close();
console.log(failed ? `${failed} failed` : 'ok');
process.exit(failed ? 1 : 0);
