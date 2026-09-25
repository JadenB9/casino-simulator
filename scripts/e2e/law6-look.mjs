#!/usr/bin/env node
// A look at the law's pieces from fixed cameras: the jail from the street and inside (the hall,
// the bars, booking, the day room's tables, the cells, the yard), and security and the pit boss
// on the casino floor. One player, logged in as law6_e2e_look.
// Usage: node scripts/e2e/law6-look.mjs [port] [outDir]    (--sw: SwiftShader instead of the GPU)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const [port = '6340', out = '/tmp/law6-look'] = args;
const only = process.env.SHOTS ? process.env.SHOTS.split(',') : null;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  flag('sw') ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--ignore-gpu-blocklist'] },
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`http://localhost:${port}/casino/?quality=${process.env.QUALITY ?? 'high'}`, { timeout: 180000 });
await p.waitForSelector('.name-input', { timeout: 180000 });
await p.fill('.name-input', 'law6_e2e_look');
if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
await p.click('.enter-btn');
await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 30000 });
if (await p.$('.editor-panel.guided')) {
  for (let i = 0; i < 3; i++) {
    await p.click('.editor-panel .ed-buttons .btn.primary');
    await p.waitForTimeout(500);
  }
} else {
  await p.click('.menu-item >> nth=0');
}
await p.waitForSelector('.hud', { timeout: 30000 });
// anything that greets you on arrival (the daily bonus) is put away unclaimed
await p.waitForTimeout(1500);
for (let i = 0; i < 3; i++) {
  const held = await p.evaluate(async () => (await import('/casino/src/ui/keyboard.ts')).overlayCount());
  if (!held) break;
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
}
await p.waitForTimeout(1500);
await p.evaluate(() => {
  const c = window.casino;
  c.shot = null;
  c.engine.onFrame(() => {
    if (!c.shot) return;
    c.engine.camera.position.set(...c.shot.pos);
    c.engine.camera.lookAt(...c.shot.at);
  });
});

const frames = (n = 20) => p.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function shot(name, pos, at, player) {
  if (only && !only.includes(name)) return;
  await p.evaluate(([pos, at, pl]) => {
    const c = window.casino;
    if (pl) c.world.player.teleport(pl[0], pl[1], pl[2]);
    c.shot = { pos, at };
  }, [pos, at, player ?? null]);
  await frames(30);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', `${out}/${name}.png`);
}

// the punch held at its furthest (the fist out, the guard fist up), third person, from the side
// and the front; SHOTS=fist for just these
async function frozenPunch(name, t, pos, at) {
  if (only && !only.includes(name)) return;
  await p.evaluate(([t]) => {
    const c = window.casino;
    const ch = c.world.player.character;
    c.world.player.teleport(0, 7.5, 0);
    c.freeze = () => (ch.act = { e: 'punch', t, fade: 1 });
    ch.gesture('punch');
    c.freeze();
    if (!c.frozeHook) c.frozeHook = c.engine.onFrame(() => c.freeze?.());
  }, [t]);
  await shot(name, pos, at);
}
await frozenPunch('fist-side', 0.26, [0.75, 1.5, 8.15], [0, 1.42, 8.15]);
await frozenPunch('fist-front', 0.26, [0.15, 1.5, 8.85], [0, 1.42, 8.1]);
await frozenPunch('fist-windup', 0.1, [0.7, 1.5, 7.9], [0, 1.45, 7.75]);
await frozenPunch('fist-eyes', 0.26, [0, 1.66, 7.62], [-0.12, 1.42, 8.3]);
await p.evaluate(() => (window.casino.freeze = null));

/** Down in the elevator to the ground floor, walking to a car in the casino's lift bank first. */
async function toGround() {
  const car = await p.evaluate(() => window.casino.world.city.casinoBank.cars[0]);
  const cx = (car.x0 + car.x1) / 2;
  const cz = (car.z0 + car.z1) / 2;
  await walk(cx, cz, 0);
  await p.evaluate(() => window.casino.world.city.go('ground'));
  await p.waitForFunction(() => window.casino.world.zone === 'ground' && !window.casino.world.city.riding, null, { timeout: 30000 });
  await p.waitForTimeout(800);
}
/** Walk (a couple of metres at a time, as fast as the floor allows) to (x, z), then face `yaw`. */
async function walk(x, z, yaw) {
  for (let i = 0; i < 120; i++) {
    const done = await p.evaluate(([x, z, yaw]) => {
      const w = window.casino.world;
      const q = w.player.position;
      const d = Math.hypot(x - q.x, z - q.z);
      const k = Math.min(1, 1.8 / Math.max(d, 1e-6));
      w.player.teleport(q.x + (x - q.x) * k, q.z + (z - q.z) * k, yaw);
      return d <= 1.8;
    }, [x, z, yaw]);
    await p.waitForTimeout(240);
    if (done) break;
  }
}

if (!only || only.some((n) => n.startsWith('jail'))) {
  await toGround();
  // from the sidewalk to the visitors' door, on foot (W held): the lot and the door let you in
  await walk(164.6, -25, Math.PI / 2);
  await p.evaluate(() => window.casino.world.releaseMouse?.());
  await p.keyboard.down('KeyW');
  await p.waitForTimeout(2600);
  await p.keyboard.up('KeyW');
  const at = await p.evaluate(() => ({ x: window.casino.world.player.position.x, z: window.casino.world.player.position.z }));
  console.log(`${at.x > 168 && at.x < 172 ? 'ok  ' : 'FAIL'} walked in off the street to the hall (${at.x.toFixed(1)}, ${at.z.toFixed(1)})`);
}

// the jail: from across the street, the door, the hall through the bars, inside
await shot('jail-street', [158, 3.2, -25], [172, 2.2, -25], [170, -10, 0]);
await shot('jail-corner', [160, 9, -50], [180, 1, -25]);
await shot('jail-hall', [168, 1.7, -25], [180, 1.2, -25], [169.5, -25, Math.PI / 2]);
await shot('jail-dayroom', [174, 2.4, -17], [186, 0.9, -25]);
await shot('jail-tables', [184, 2.6, -18], [184, 0.8, -25]);
await shot('jail-cells', [182, 1.7, -19], [182, 1.2, -11]);
await shot('jail-cell', [178.5, 1.6, -15.4], [179, 0.8, -10]);
await shot('jail-booking', [178, 1.8, -24], [174.5, 1.1, -29]);
await shot('jail-board', [187, 1.7, -22], [189.2, 2.2, -30]);
await shot('jail-yard', [176, 3, -31.5], [186, 1.2, -40]);
await shot('jail-above', [181, 26, -12], [181, 0, -26]);
// the staff on the floor, wherever they are now (from their loops: the local clock is the server's here)
for (const id of ['boss', 'g1', 'g2', 'g3', 'g4']) {
  const [x, z, yaw] = await p.evaluate((id) => {
    const q = window.casino.app.law.staff.poseOf(id, Date.now() + 1500);
    return [q.x, q.z, q.yaw];
  }, id);
  await shot(`staff-${id}`, [x + Math.sin(yaw) * 2.6, 1.7, z + Math.cos(yaw) * 2.6], [x, 1.35, z], [x + Math.sin(yaw) * 3.2, z + Math.cos(yaw) * 3.2, yaw + Math.PI]);
}
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
