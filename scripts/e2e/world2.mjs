#!/usr/bin/env node
// Headless checks for the v2 floor: the layout with the new stations and six slot islands, fixed
// views with draw calls, a pointer-lock walk (mouse look while walking), drag-to-look, the
// camera's recentring rules, and emotes over characters. Vite only, no server.
// Usage: node scripts/e2e/world2.mjs [port] [out dir] [checks...]
//   checks: layout views lock drag emote (default: all)
// Runs Chrome's new headless mode (channel 'chromium'): the headless shell refuses Pointer Lock.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5400', out = '/tmp/world2', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const all = ['layout', 'views', 'lock', 'drag', 'emote'];
const checks = wanted.length ? wanted : all;
const SIX = 'sevens,neon,wild,diamonds,cherries,goldrush';
const base = `http://localhost:${port}/casino/src/world/dev-floor.html`;
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  // the full browser asks for /favicon.ico, which the dev floor doesn't have
  page.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(`${m.text()} ${m.location()?.url ?? ''}`.trim()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300000 });
  return { page, errors };
}

/** Draw calls averaged over a couple of seconds of frames. */
async function stats(page) {
  return page.evaluate(async () => {
    const c = window.casino;
    const t0 = performance.now();
    let frames = 0;
    let calls = 0;
    await new Promise((r) => {
      const tick = () => {
        frames++;
        calls = Math.max(calls, c.world.stats().calls);
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
        else r();
      };
      requestAnimationFrame(tick);
    });
    const s = c.world.stats();
    return { calls: s.calls, maxCalls: calls, triangles: s.triangles, frameMs: +((performance.now() - t0) / frames).toFixed(1) };
  });
}

/** The camera's heading (0 looks north, -z; positive turns east) and pitch. */
const camYaw = (page) =>
  page.evaluate(() => {
    const d = new window.casino.THREE.Vector3();
    window.casino.engine.camera.getWorldDirection(d);
    return { yaw: +Math.atan2(d.x, -d.z).toFixed(3), pitch: +Math.asin(d.y).toFixed(3) };
  });

const where = (page) => page.evaluate(() => ({ x: +window.casino.world.player.position.x.toFixed(2), z: +window.casino.world.player.position.z.toFixed(2) }));

// --- the floor plan's own checks ------------------------------------------------------------------
if (checks.includes('layout')) {
  const { page } = await open('quality=low&view=overview');
  const result = await page.evaluate(async (six) => {
    const L = await import('/casino/src/world/layout.ts');
    const G = await import('/casino/src/games/index.ts');
    // typical real models: tables with their chairs, cabinets, the Big Six with its layout table
    const real = {
      blackjack: { width: 2.5, depth: 2.0 }, baccarat: { width: 2.8, depth: 2.1 }, threecard: { width: 2.5, depth: 2.0 },
      roulette: { width: 3.1, depth: 2.2 }, craps: { width: 4.3, depth: 2.4 }, holdem: { width: 3.7, depth: 2.5 },
      slots: { width: 0.8, depth: 0.9 }, videopoker: { width: 0.7, depth: 0.8 }, highcard: { width: 1.6, depth: 1.6 },
      war: { width: 2.5, depth: 2.0 }, sicbo: { width: 2.6, depth: 2.1 }, bigsix: { width: 2.6, depth: 1.8 },
    };
    const today = (g) => G.GAMES[g].footprint;
    const variants = six.split(',');
    const plan = L.planFloor(today, variants);
    const ids = (game) => plan.stations.filter((s) => s.game === game).map((s) => s.id);
    return {
      today: L.checkLayout(L.planFloor(today)),
      todaySix: L.checkLayout(plan),
      real: L.checkLayout(L.planFloor((g) => real[g])),
      realSix: L.checkLayout(L.planFloor((g) => real[g], variants)),
      banks: plan.banks.map((b) => `${b.variant}@${b.x.toFixed(1)},${b.z.toFixed(1)}`),
      stations: { war: ids('war'), sicbo: ids('sicbo'), bigsix: ids('bigsix'), slots: ids('slots').length },
    };
  }, SIX);
  console.log(JSON.stringify({ check: 'layout', ...result }));
  for (const k of ['today', 'todaySix', 'real', 'realSix']) if (result[k].length) fail(`layout ${k}: ${result[k].join('; ')}`);
  if (result.banks.length !== 6) fail(`expected 6 slot islands, got ${result.banks.length}`);
  await page.close();
}

// --- fixed views with six islands -----------------------------------------------------------------
if (checks.includes('views')) {
  for (const [view, quality] of [['overview', 'high'], ['slots', 'high'], ['bigsix', 'high'], ['entrance', 'high'], ['pit', 'high'], ['slots', 'low']]) {
    const { page, errors } = await open(`quality=${quality}&stats=1&slots=${SIX}${view === 'entrance' ? '' : `&view=${view}`}`);
    await page.waitForTimeout(1500);
    const s = await stats(page);
    const file = `${out}/world2-${view}-${quality}.png`;
    await page.screenshot({ path: file });
    console.log(JSON.stringify({ check: 'view', view, quality, file, ...s, errors: errors.slice(0, 3) }));
    if (s.maxCalls > 250) fail(`${view}/${quality}: ${s.maxCalls} draw calls`);
    if (errors.length) fail(`${view}/${quality}: ${errors[0]}`);
    await page.close();
  }
}

// --- pointer lock: a click captures the mouse, moving it turns the camera while walking -----------
if (checks.includes('lock')) {
  const { page, errors } = await open('quality=low');
  await page.waitForTimeout(800);
  const start = await camYaw(page);
  await page.mouse.move(640, 420);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const captured = await page.evaluate(() => ({ lock: document.pointerLockElement?.id ?? null, world: window.casino.world.mouseCaptured }));
  if (!captured.world) fail('a click did not capture the mouse');
  // walk north and steer right with the mouse, a little at a time
  await page.keyboard.down('KeyW');
  let x = 640;
  for (let i = 0; i < 24; i++) {
    x += 12;
    await page.mouse.move(x, 420);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(300);
  const turned = await camYaw(page);
  const mid = await where(page);
  await page.screenshot({ path: `${out}/world2-lock-walk.png` });
  // keep walking without touching the mouse: a captured camera must not swing back
  await page.waitForTimeout(3500);
  const held = await camYaw(page);
  const end = await where(page);
  await page.keyboard.up('KeyW');
  // pitch: move the mouse down, the camera looks down (clamped)
  for (let i = 0; i < 10; i++) await page.mouse.move(x, 420 + (i + 1) * 40);
  await page.waitForTimeout(200);
  const pitched = await camYaw(page);
  await page.screenshot({ path: `${out}/world2-lock-look-down.png` });
  // walking goes where the camera faces
  const dir = await page.evaluate(() => {
    const d = new window.casino.THREE.Vector3();
    window.casino.engine.camera.getWorldDirection(d);
    return { x: d.x, z: d.z };
  });
  const before = await where(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  const after = await where(page);
  const mx = after.x - before.x;
  const mz = after.z - before.z;
  const along = (mx * dir.x + mz * dir.z) / (Math.hypot(mx, mz) * Math.hypot(dir.x, dir.z) || 1);
  // Esc lets the mouse go
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const released = await page.evaluate(() => window.casino.world.mouseCaptured);
  // a sheet holding the keyboard: no capture on click
  const refused = await page.evaluate(async () => {
    const k = await import('/casino/src/ui/keyboard.ts');
    const panel = document.createElement('div');
    document.body.append(panel);
    window.__release = k.holdKeyboard(panel, () => {});
    return k.overlayCount();
  });
  await page.waitForTimeout(1300); // Chrome won't re-lock straight after an Esc
  await page.mouse.click(640, 420);
  await page.waitForTimeout(300);
  const behindSheet = await page.evaluate(() => window.casino.world.mouseCaptured);
  await page.evaluate(() => window.__release());
  const result = { start, captured, turned, held, pitched, mid, end, along: +along.toFixed(3), released, overlays: refused, behindSheet, errors: errors.slice(0, 3) };
  console.log(JSON.stringify({ check: 'lock', ...result }));
  if (Math.abs(turned.yaw - start.yaw) < 0.4) fail('mouse movement while walking did not turn the camera');
  if (Math.abs(held.yaw - turned.yaw) > 0.05) fail(`captured camera swung back while walking (${turned.yaw} -> ${held.yaw})`);
  if (!(pitched.pitch < turned.pitch - 0.1)) fail('moving the mouse down did not look down');
  if (along < 0.95) fail(`W walked ${along} off the camera's facing`);
  if (released) fail('Esc did not release the mouse');
  if (behindSheet) fail('captured the mouse while a sheet held the keyboard');
  await page.close();
}

// --- drag-to-look without capture, and the recentre after a few seconds of no mouse ---------------
if (checks.includes('drag')) {
  const { page } = await open('quality=low');
  await page.evaluate(() => {
    window.__sim = 0;
    window.casino.engine.onFrame((dt) => (window.__sim += dt));
  });
  const sim = (t) => page.waitForFunction((t) => window.__sim >= t, t, { timeout: 240000, polling: 50 });
  await page.waitForTimeout(800);
  const start = await camYaw(page);
  await page.mouse.move(640, 420);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(640 + i * 12, 420);
  await page.mouse.up();
  const t0 = await page.evaluate(() => window.__sim);
  const dragged = await camYaw(page);
  const captured = await page.evaluate(() => window.casino.world.mouseCaptured);
  // walk sideways (D): the walker turns away from the camera; for the first seconds after the
  // drag the camera stays where the mouse left it, then it swings round behind the walker
  await page.keyboard.down('KeyD');
  await sim(t0 + 2.2);
  const early = await camYaw(page);
  await sim(t0 + 7);
  const late = await camYaw(page);
  await page.keyboard.up('KeyD');
  const drift = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  console.log(JSON.stringify({ check: 'drag', start, dragged, captured, early, late }));
  if (drift(dragged.yaw, start.yaw) < 0.3) fail('drag did not turn the camera');
  if (captured) fail('a drag captured the mouse');
  if (drift(early.yaw, dragged.yaw) > 0.05) fail(`camera recentred within seconds of a drag (${dragged.yaw} -> ${early.yaw})`);
  if (drift(late.yaw, dragged.yaw) < 0.3) fail(`camera never swung back behind the walker (${dragged.yaw} -> ${late.yaw})`);
  await page.close();
}

// --- emotes over your own character and a stand-in remote one -------------------------------------
if (checks.includes('emote')) {
  const { page, errors } = await open('quality=high');
  // the frame clock (dt is capped per frame, so on a slow renderer it runs behind the wall clock)
  await page.evaluate(() => {
    window.__sim = 0;
    window.casino.engine.onFrame((dt) => (window.__sim += dt));
  });
  const sim = (t) => page.waitForFunction((t) => window.__sim >= t, t, { timeout: 240000, polling: 100 });
  const bubbles = () => page.evaluate(() => [...document.querySelectorAll('.emote-bubble')].filter((e) => e.isConnected && e.getClientRects().length).length);
  const shown = await page.evaluate(async () => {
    const { world, engine } = window.casino;
    // a second character a couple of metres ahead, facing us
    const p = world.player.position;
    const look = { v: 1, body: 'f', outfit: 'dress', skin: 4, hair: '#2b1a10', top: '#1d5a8a', bottom: '#22252c', shoes: '#111111' };
    await world.characterFactory.load(look).catch(() => {});
    const other = world.characterFactory.create(look, 'Mara');
    other.root.position.set(p.x + 1.1, 0, p.z - 2.4);
    other.root.rotation.y = 0;
    engine.scene.add(other.root);
    engine.onFrame((dt) => other.update(dt));
    world.useRemotes({ character: (id) => (id === 7 ? other : undefined) });
    const unknown = world.showEmote(99, 'wave');
    const t = window.__sim;
    return { me: world.showEmote('me', 'wave'), other: world.showEmote(7, 'cheer'), unknown, t };
  });
  await sim(shown.t + 0.75);
  await page.waitForTimeout(400); // the bubble's pop-in runs on the wall clock
  const first = await bubbles();
  await page.screenshot({ path: `${out}/world2-emote.png` });
  const t2 = await page.evaluate(() => {
    window.casino.world.showEmote('me', 'thumbs');
    window.casino.world.showEmote(7, 'shrug');
    return window.__sim;
  });
  await sim(t2 + 0.8);
  await page.waitForTimeout(400);
  const second = await bubbles();
  await page.screenshot({ path: `${out}/world2-emote-2.png` });
  await sim(t2 + 3.0);
  const gone = await bubbles();
  console.log(JSON.stringify({ check: 'emote', shown, first, second, goneAfter: gone, errors: errors.slice(0, 3) }));
  if (!shown.me || !shown.other || shown.unknown) fail(`showEmote answered ${JSON.stringify(shown)}`);
  if (first !== 2 || second !== 2) fail(`expected two emote bubbles each time, saw ${first} and ${second}`);
  if (gone !== 0) fail(`${gone} emote bubbles still up after they should have gone`);
  if (errors.length) fail(`emote: ${errors[0]}`);
  await page.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
