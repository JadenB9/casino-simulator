#!/usr/bin/env node
// The release's look-around, for a person to read the screenshots:
//   floor  (dev floor, High) the lobby with its fountain, statues and elevator; the pit's ceiling;
//          every north-wing room; the ground floor, the garage and the jail from outside and in;
//          the roof. Draw calls and frame time at each view.
//   game   logged in at 1280x600: a seat at blackjack with the board on screen; then down the
//          elevator to the ground floor with a celebrity forced in: the card says "in the casino".
// Console errors are listed for every page.
// Usage: node scripts/e2e/qa6.mjs [port] [outDir] [checks...]   (default: floor game)
//   GPU=1 draws on the machine's GPU. Fixed name qa6_e2e_tour with the dev password.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6430', out = '/tmp/qa6', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const checks = wanted.length ? wanted : ['floor', 'game'];
const gpu = process.env.GPU === '1';
const browser = await chromium.launch(gpu ? { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const ok = (cond, what) => {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const watch = (p, errors) => {
  p.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('response', (r) => r.status() === 404 && console.log(`404 ${r.url()}`));
};
const frames = (p, n = 8) =>
  p.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);
/** Milliseconds a frame over the next `n` frames. */
const frameMs = (p, n = 60) =>
  p.evaluate(async (n) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    return (performance.now() - t0) / n;
  }, n);
const camera = (p, pose) =>
  p.evaluate((pose) => {
    const { world, engine } = window.casino;
    window.__cam?.();
    window.__cam = null;
    if (!pose) {
      world.player.setEnabled(true);
      return;
    }
    world.player.setEnabled(false);
    window.__cam = engine.onFrame(() => {
      engine.camera.position.set(...pose[0]);
      engine.camera.lookAt(...pose[1]);
    });
  }, pose);

if (checks.includes('floor')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  watch(p, errors);
  await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=high`, { timeout: 300_000 });
  await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600_000 });
  await frames(p, 20);
  const views = await p.evaluate(() => {
    const { world } = window.casino;
    const plan = world.plan;
    const room = (id) => plan.rooms.find((r) => r.id === id);
    const v = [];
    const home = [0, 12.8, Math.PI];
    v.push({ name: 'lobby-fountain', at: home, eye: [0, 1.7, 14.2], look: [0, 1.0, 8] });
    v.push({ name: 'lobby-from-fountain', at: home, eye: [-2.5, 1.7, 7], look: [3.5, 1.5, 13.5] });
    for (const [i, s] of plan.statues.entries()) v.push({ name: `lobby-statue-${i + 1}`, at: home, eye: [s.x + Math.sin(s.yaw) * 3, 1.6, s.z + Math.cos(s.yaw) * 3], look: [s.x, 1.5, s.z] });
    for (const [i, f] of plan.fountains.entries()) v.push({ name: `fountain-${i + 1}-${f.room}`, at: home, eye: [f.x - 3.2, 1.8, f.z + 3.2], look: [f.x, 1.0, f.z] });
    const pit = room('pit');
    const b = pit.bounds;
    v.push({ name: 'pit-ceiling', at: home, eye: [pit.cx, 1.7, b.z1 - 1.5], look: [pit.cx, 4.6, pit.cz - 2] });
    v.push({ name: 'pit-floor', at: home, eye: [b.x0 + 1.5, 2.2, b.z1 - 1.5], look: [pit.cx, 1, pit.cz] });
    for (const r of plan.rooms.filter((q) => q.cz < -30)) {
      const q = r.bounds;
      v.push({ name: `wing-${r.id}`, at: home, eye: [q.x0 + 1.2, 1.8, q.z1 - 1.2], look: [r.cx, 1.2, r.cz] });
      v.push({ name: `wing-${r.id}-back`, at: home, eye: [q.x1 - 1.2, 1.8, q.z0 + 1.2], look: [r.cx, 1.2, r.cz] });
    }
    const ground = [104.05, 0, Math.PI / 2];
    v.push({ name: 'ground-lobby', at: ground, eye: [106, 1.7, 0], look: [126, 1.4, 0] });
    v.push({ name: 'ground-valet', at: ground, eye: [128.5, 2, 7], look: [142, 1, -2] });
    v.push({ name: 'ground-street', at: ground, eye: [150, 2.2, -12], look: [170, 2.5, 0] });
    v.push({ name: 'jail-outside', at: ground, eye: [160, 2, -18], look: [178, 3, -25] });
    v.push({ name: 'jail-inside', at: ground, eye: [169, 1.7, -22], look: [186, 1.2, -26] });
    v.push({ name: 'garage-outside', at: ground, eye: [160, 2, 18], look: [180, 3, 25] });
    v.push({ name: 'garage-inside', at: ground, eye: [169, 1.7, 22], look: [188, 1, 26] });
    const roof = [-112.05, 0.95, -Math.PI / 2];
    v.push({ name: 'roof', at: roof, eye: [-118, 1.7, 0], look: [-150, 1.5, 0] });
    return v;
  });
  let zone = 'casino';
  const rows = [];
  for (const v of views) {
    await p.evaluate(async ([x, z, h]) => {
      const { world } = window.casino;
      const want = x > 50 ? 'ground' : x < -50 ? 'roof' : 'casino';
      if (world.zone !== want) {
        world.teleport(x, z, h);
        await world.city.prepare(want);
      }
    }, v.at);
    await camera(p, [v.eye, v.look]);
    await frames(p, 16);
    const ms = await frameMs(p);
    const s = await p.evaluate(() => ({ zone: window.casino.world.zone, calls: window.casino.world.stats().calls, tris: window.casino.world.stats().triangles }));
    zone = s.zone;
    rows.push(`${v.name.padEnd(28)} ${s.zone.padEnd(7)} ${String(s.calls).padStart(4)} calls ${ms.toFixed(1).padStart(6)} ms/frame`);
    await p.screenshot({ path: `${out}/floor-${v.name}.png` });
  }
  console.log(rows.join('\n'));
  ok(errors.length === 0, `floor: no console errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
  await ctx.close();
}

if (checks.includes('game')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    localStorage.setItem('casino.quality', 'high');
    localStorage.setItem('casino.camera.view', 'third');
  });
  const p = await ctx.newPage();
  const errors = [];
  watch(p, errors);
  await p.goto(`http://localhost:${port}/casino/`, { timeout: 180_000 });
  await p.waitForSelector('.name-input, .menu-item', { timeout: 300_000 });
  if (await p.$('.name-input')) {
    await p.fill('.name-input', 'qa6_e2e_tour');
    await p.fill('.pass-input', 'casino-dev');
    await p.click('.enter-btn');
  }
  await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  if (await p.$('.editor-panel.guided')) {
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${out}/game-look-editor.png` });
    for (let i = 0; i < 3; i++) {
      await p.click('.editor-panel .ed-buttons .btn.primary');
      await p.waitForTimeout(500);
    }
  } else {
    await p.click('.menu-item >> nth=0');
  }
  await p.waitForSelector('.hud', { timeout: 30_000 });
  await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 });
  await p.waitForTimeout(1500);
  for (let i = 0; i < 3 && (await p.$('.sheet-scrim, .modal')); i++) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }
  await p.screenshot({ path: `${out}/game-floor.png` });

  // a seat at blackjack at 1280x600: the whole board on screen
  await p.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === 'bj-1'));
  });
  await p.waitForSelector('.lobby-choice', { timeout: 10_000 });
  await p.keyboard.press('s');
  await p.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
  await p.fill('.modal input[type=number]', '1000');
  await p.click('.modal .btn.primary');
  await p.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });
  await p.waitForTimeout(6000); // past the fly-in
  await p.screenshot({ path: `${out}/game-bj-1280x600.png` });
  const offscreen = await p.evaluate(() =>
    [...document.querySelectorAll('.table-ui button, .bet-controls button, .chip-rail button')]
      .filter((b) => b.offsetParent)
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1).length,
  );
  ok(offscreen === 0, `blackjack at 1280x600: ${offscreen} controls off the edge`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(800);
  if (await p.$('.modal .btn.primary')) await p.click('.modal .btn.primary');
  await p.waitForFunction(() => !window.casino.app.table, null, { timeout: 15_000 }).catch(() => ok(false, 'left the table'));
  await p.waitForTimeout(1000);

  // the fountain is solid: walking straight at it from 3 m out stops at its rim
  const fountains = await p.evaluate(() => window.casino.world.plan.fountains);
  for (const f of fountains) {
    await p.evaluate(([x, z]) => window.casino.world.teleport(x, z + 3, Math.PI), [f.x, f.z]); // heading pi faces -z (as at the doors), at the fountain
    await p.waitForTimeout(600);
    await p.keyboard.down('KeyW');
    await p.waitForTimeout(2500);
    await p.keyboard.up('KeyW');
    const at = await p.evaluate(() => ({ x: window.casino.world.player.position.x, z: window.casino.world.player.position.z }));
    const d = Math.hypot(at.x - f.x, at.z - f.z);
    await p.screenshot({ path: `${out}/game-fountain-${f.room}.png` });
    ok(d > 1.5, `walking into the ${f.room}'s fountain stops at its rim (${d.toFixed(2)} m from its middle)`);
  }

  // down to the ground floor, then a celebrity walks into the casino
  const bank = await p.evaluate(() => {
    const L = window.casino.world.city.casinoBank;
    return { car: L.centre(0), yaw: L.yaw };
  });
  await p.evaluate(([x, z, y]) => window.casino.world.teleport(x, z, y), [bank.car.x, bank.car.z, bank.yaw]);
  await p.waitForTimeout(800);
  await p.keyboard.press('KeyE');
  await p.waitForSelector('.lift-panel', { timeout: 4000 });
  await p.keyboard.press('KeyG');
  await p.waitForFunction(() => window.casino.world.city.riding || window.casino.world.city.lastRide, null, { timeout: 5000 });
  await p.waitForFunction(() => !window.casino.world.city.riding, null, { timeout: 20_000 });
  const zone = await p.evaluate(() => window.casino.world.zone);
  ok(zone === 'ground', `rode down to the ${zone}`);
  await p.waitForTimeout(1200);
  const forced = await p.evaluate(async () => {
    const r = await fetch('/casino/api/dev/celeb', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` }, body: JSON.stringify({ celeb: 'vale' }) });
    return r.status;
  });
  ok(forced === 200, `the dev trigger (${forced})`);
  await p.waitForSelector('.celeb-notice, .celeb-card', { timeout: 10_000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const card = await p.evaluate(() => [...document.querySelectorAll('[class*="celeb"]')].map((e) => e.textContent).join(' | '));
  await p.screenshot({ path: `${out}/game-celeb-from-ground.png` });
  ok(/in the casino/.test(card) && !/\d+ m away/.test(card), `the celebrity card from the ground floor: "${card.slice(0, 160)}"`);
  ok(errors.length === 0, `game: no console errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
