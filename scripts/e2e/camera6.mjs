#!/usr/bin/env node
// First person, as a player meets it:
//   floor   (dev floor) F swings the camera into the character's eyes (head shrunk away) and back;
//           the look reaches the shoes and the ceiling; W walks where you look and D strafes;
//           walking into a wall or a column never shows through it; sitting on a bench looks from
//           the seat; an emote swings out in front to show it (walking brings the eyes straight
//           back); E at a table flies in from the eyes and Esc flies back to them; F does nothing
//           at a table or with the map open; the choice survives a reload
//   touch   (dev floor, a phone) the look drag and the stick work through the eyes
//   game    logged in: F, walk, sit on a stool with E, stand, sit down at blackjack with E, buy
//           in, leave with Esc back to the eyes, the Settings sheet's Camera row, chat typing an
//           f, and a reload that comes back in first person
//   flows   logged in, in first person throughout: a banker's window and back, the boutique and
//           back, a drink a waiter brings (in the corner of the view looking down), away and
//           Come back, and a new player's dressing room; every frame, your own head is drawn
//           exactly when the camera isn't in it
//   chat    the chat's pin: T and a line sent put an unpinned box away; pinned it stays up (idle)
//           while you walk, look and play, lets clicks through to the floor and the felt, and is
//           up again after a reload; T and Esc type and stop; unpinning puts it away. On a phone,
//           on its side and upright, the idle lines stand clear of the stick and the action
//           button, and a tap on the dock types
// Usage: node scripts/e2e/camera6.mjs [port] [outDir] [checks...]   (default: all)
//   floor and touch need Vite only; game the local worker too (PORT_BASE=<port> npm run dev).
//   GPU=1 draws on the machine's GPU. Fixed names (camera6_e2e_*) with the dev password.

import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port = '6210', out = '/tmp/camera6', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const checks = wanted.length ? wanted : ['floor', 'touch', 'game', 'flows', 'chat'];
const browser = await chromium.launch(process.env.GPU === '1' ? { channel: 'chromium', args: ['--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const ok = (cond, what) => (cond ? console.log(`ok   ${what}`) : fail(what));
const watch = (p, errors) => {
  p.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
};
const shot = (p, name) => p.screenshot({ path: `${out}/camera6-${name}.png` });

/** The camera and the walker as the page sees them (the walker's controller is the seats' player). */
const state = (p) =>
  p.evaluate(() => {
    const w = window.casino.world;
    const pl = w.life.seating.player;
    const cam = window.casino.engine.camera;
    const dir = cam.getWorldDirection(new cam.position.constructor());
    const head = w.player.character.root.getObjectByName('Head');
    return {
      view: pl.view,
      cam: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      dir: { x: dir.x, y: dir.y, z: dir.z },
      eye: { x: pl.eye.x, y: pl.eye.y, z: pl.eye.z },
      at: { x: pl.position.x, z: pl.position.z },
      heading: pl.heading,
      camYaw: pl.camYaw,
      camPitch: pl.camPitch,
      shrunk: head ? head.scale.x < 0.01 : null,
      shown: w.player.character.root.visible,
      seated: w.seated?.id ?? null,
    };
  });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
/** The short way round from a to b. */
const angle = (a, b) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
const setView = (p, view) => p.evaluate((v) => window.casino.world.setMouse({ view: v }), view);

async function devFloor(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const p = await ctx.newPage();
  const errors = [];
  watch(p, errors);
  await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=low`, { timeout: 180_000 });
  await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300_000 });
  await p.waitForTimeout(800);
  return { p, ctx, errors };
}

// --- the dev floor --------------------------------------------------------------------------------

if (checks.includes('floor')) {
  const { p, ctx, errors } = await devFloor();
  await setView(p, 'third');
  await p.waitForTimeout(600);
  const t0 = await state(p);
  ok(t0.view === 'third' && flat(t0.cam, t0.at) > 1.5 && t0.shrunk === false, `third person: the camera stands ${flat(t0.cam, t0.at).toFixed(2)} m behind, the head drawn`);
  await shot(p, 'floor-third');

  // F: into the eyes
  await p.keyboard.press('KeyF');
  await p.waitForTimeout(200);
  const mid = await state(p);
  await shot(p, 'floor-swing');
  await p.waitForTimeout(600);
  const f = await state(p);
  ok(mid.view === 'first' && flat(mid.cam, mid.at) > 0.3 && flat(mid.cam, mid.at) < flat(t0.cam, t0.at), `F swings the camera in (${flat(mid.cam, mid.at).toFixed(2)} m out a fifth of a second in)`);
  ok(f.view === 'first' && dist(f.cam, f.eye) < 0.01, `first person: the camera is at the eyes`);
  ok(f.eye.y > 1.55 && f.eye.y < 1.75 && flat(f.eye, f.at) < 0.22, `the eyes stand ${f.eye.y.toFixed(2)} m up, ${flat(f.eye, f.at).toFixed(2)} m ahead of the walker's middle`);
  ok(f.shrunk === true && f.shown === true, 'your own head (hair, hat) is shrunk away; the body is still there');
  ok((await p.evaluate(() => localStorage.getItem('casino.camera.view'))) === 'first', 'the choice is saved');
  await shot(p, 'floor-first');

  // the look reaches down to the shoes and up to the ceiling
  await p.evaluate(() => window.casino.world.life.seating.player.addLook(0, 3));
  await p.waitForTimeout(250);
  const down = await state(p);
  ok(down.dir.y < -0.9, `looking down: ${Math.round((Math.asin(-down.dir.y) * 180) / Math.PI)} degrees below level`);
  await shot(p, 'floor-down');
  await p.evaluate(() => window.casino.world.life.seating.player.addLook(0, -6));
  await p.waitForTimeout(250);
  const up = await state(p);
  ok(up.dir.y > 0.9, `looking up: ${Math.round((Math.asin(up.dir.y) * 180) / Math.PI)} degrees above level`);
  await shot(p, 'floor-up');
  await p.evaluate(() => {
    const pl = window.casino.world.life.seating.player;
    pl.camPitch = 0.05;
    pl.addLook(0.9, 0);
  });
  await p.waitForTimeout(300);

  // W walks where you look, D steps right of it, and the body faces the look throughout
  const w0 = await state(p);
  await p.keyboard.down('KeyW');
  await p.waitForTimeout(900);
  await p.keyboard.up('KeyW');
  await p.waitForTimeout(200);
  const w1 = await state(p);
  const along = ((w1.at.x - w0.at.x) * w0.dir.x + (w1.at.z - w0.at.z) * w0.dir.z) / Math.max(1e-6, flat(w1.at, w0.at) * Math.hypot(w0.dir.x, w0.dir.z));
  ok(flat(w1.at, w0.at) > 1 && along > 0.97, `W walks ${flat(w1.at, w0.at).toFixed(2)} m the way you look (cos ${along.toFixed(3)})`);
  ok(angle(w1.heading, w1.camYaw + Math.PI) < 0.05, 'the body faces where you look');
  await p.keyboard.down('KeyD');
  await p.waitForTimeout(600);
  await p.keyboard.up('KeyD');
  await p.waitForTimeout(200);
  const d1 = await state(p);
  const right = { x: -w1.dir.z, z: w1.dir.x };
  const side = ((d1.at.x - w1.at.x) * right.x + (d1.at.z - w1.at.z) * right.z) / Math.max(1e-6, flat(d1.at, w1.at) * Math.hypot(right.x, right.z));
  ok(side > 0.95 && angle(d1.heading, d1.camYaw + Math.PI) < 0.05, `D steps right of the look (cos ${side.toFixed(3)}), still facing it`);

  // walls and columns: walk straight into each, the camera stays on this side
  const walls = await p.evaluate(async () => {
    const w = window.casino.world;
    const pl = w.life.seating.player;
    const col = w.collider;
    const V = window.casino.THREE.Vector3;
    const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const out = [];
    // a column: the nearest post to the lobby's spawn; a wall: straight ahead of a lobby bench
    const posts = col.posts.filter((q) => q.walk && q.r > 0.15).sort((a, b) => Math.hypot(a.cx, a.cz - 9) - Math.hypot(b.cx, b.cz - 9));
    const targets = [];
    if (posts[0]) targets.push({ what: 'column', x: posts[0].cx, z: posts[0].cz, r: posts[0].r });
    for (const yaw of [Math.PI / 2, -Math.PI / 2]) {
      const o = { x: 0, y: 1.6, z: 9 };
      const d = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
      const hit = col.raycast(o, d, 40);
      if (hit < 40) targets.push({ what: `wall ${yaw > 0 ? 'east' : 'west'}`, x: o.x + d.x * hit, z: o.z + d.z * hit, r: 0 });
    }
    for (const t of targets) {
      // start 1.5 m off, facing it, and push into it for a second and a half
      const yaw = Math.atan2(t.x - 0, t.z - 9);
      const sx = t.x - Math.sin(yaw) * (1.5 + t.r);
      const sz = t.z - Math.cos(yaw) * (1.5 + t.r);
      w.teleport(sx, sz, yaw);
      pl.camYaw = yaw + Math.PI;
      pl.camPitch = 0.05;
      await frame();
      dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
      await new Promise((res) => setTimeout(res, 1500));
      const cam = window.casino.engine.camera;
      const fwd = cam.getWorldDirection(new V());
      // what's between the camera and the thing, along the look: the camera's own side of it
      const room = col.raycast({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, { x: fwd.x, y: 0, z: fwd.z }, 5);
      const toWalker = Math.hypot(cam.position.x - pl.position.x, cam.position.z - pl.position.z);
      out.push({ what: t.what, room, toWalker, pushed: Math.hypot(pl.position.x - sx, pl.position.z - sz) });
      dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));
      await frame();
    }
    return out;
  });
  for (const r of walls) ok(r.room > 0.08 && r.toWalker < 0.22 && r.pushed > 0.8, `into the ${r.what}: the camera stops ${r.room.toFixed(2)} m short, ${r.toWalker.toFixed(2)} m from the walker's middle`);
  await shot(p, 'floor-wall');

  // a bench: the eyes sink with the body and look out from the seat
  const seat = await p.evaluate(async () => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    return lifePoints(window.casino.world.plan).seats.find((s) => s.id === 'lobby.bench.1.1');
  });
  await p.evaluate((s) => window.casino.world.teleport(s.x + Math.sin(s.yaw) * 0.8, s.z + Math.cos(s.yaw) * 0.8, s.yaw + Math.PI), seat);
  await p.waitForTimeout(400);
  const standing = await state(p);
  await p.evaluate((sid) => {
    const w = window.casino.world;
    w.life.seating.spots(w.player.position).find((x) => x.key === `sit:${sid}`)?.use();
  }, seat.id);
  await p.waitForTimeout(1800);
  const sat = await state(p);
  ok(sat.eye.y < standing.eye.y - 0.3 && flat(sat.cam, seat) < 0.3 && dist(sat.cam, sat.eye) < 0.01, `sitting: the eyes drop from ${standing.eye.y.toFixed(2)} to ${sat.eye.y.toFixed(2)} m, over the seat`);
  ok(angle(sat.heading, seat.yaw) < 0.05, 'the seat, not the look, turns the body');
  await p.evaluate(() => window.casino.world.life.seating.player.addLook(1.1, 0));
  await p.waitForTimeout(300);
  const turned = await state(p);
  ok(angle(turned.heading, seat.yaw) < 0.05, 'looking round on the seat leaves the body sitting straight');
  await shot(p, 'floor-seat');

  // an emote on the seat: out in front to show it, then back to the eyes
  await p.evaluate(() => window.casino.world.showEmote('me', 'wave'));
  await p.waitForTimeout(900);
  const em = await state(p);
  ok(dist(em.cam, em.eye) > 1.2 && em.shrunk === false, `an emote swings the camera ${dist(em.cam, em.eye).toFixed(2)} m out, the head drawn again`);
  await shot(p, 'floor-emote-seated');
  await p.waitForTimeout(3200);
  const back = await state(p);
  ok(dist(back.cam, back.eye) < 0.01 && back.shrunk === true, 'once the bubble is gone the camera is back at the eyes');
  await p.evaluate(() => window.casino.world.life.seating.stand());
  await p.waitForTimeout(700);

  // standing: an emote cut short by walking
  await p.evaluate(() => window.casino.world.showEmote('me', 'cheer'));
  await p.waitForTimeout(800);
  await shot(p, 'floor-emote');
  await p.keyboard.down('KeyS');
  await p.waitForTimeout(550);
  await p.keyboard.up('KeyS');
  const cut = await state(p);
  ok(dist(cut.cam, cut.eye) < 0.05, 'walking during an emote brings the eyes straight back');

  // a punch (world/law/'s 'punch' gesture) keeps the eyes where they are: no swing out
  await p.evaluate(() => window.casino.world.player.character.gesture('punch'));
  await p.waitForTimeout(300);
  const jab = await state(p);
  ok(dist(jab.cam, jab.eye) < 0.02, 'a punch thrown in first person keeps the eyes put');
  await p.waitForTimeout(500);

  // a table: E flies in from the eyes, F there is the game's, Esc flies back to the eyes
  await p.evaluate(() => {
    const w = window.casino.world;
    const s = w.stations.find((x) => x.id === 'bj-1');
    const a = s.anchor.position;
    const d = s.footprint.depth / 2 + 0.7;
    w.teleport(a.x + Math.sin(s.yaw) * d, a.z + Math.cos(s.yaw) * d, s.yaw + Math.PI);
    const pl = w.life.seating.player;
    pl.camYaw = s.yaw;
    pl.camPitch = 0.3;
  });
  await p.waitForTimeout(500);
  const before = await state(p);
  const prompt = await p.evaluate(() => document.querySelector('.world-prompt:not([hidden])')?.textContent ?? '');
  ok(/Blackjack/.test(prompt), `looking at the blackjack table: "${prompt}"`);
  await p.keyboard.press('KeyE');
  await p.waitForTimeout(120);
  const flying = await state(p);
  ok(flying.seated === 'bj-1' && flying.shown === false && dist(flying.cam, before.eye) < 0.8, `E: the fly-in starts from the eyes (${dist(flying.cam, before.eye).toFixed(2)} m on), the body out of the way`);
  await p.waitForTimeout(1200);
  await shot(p, 'floor-table');
  await p.keyboard.press('KeyF');
  await p.waitForTimeout(100);
  ok((await state(p)).view === 'first', 'F at a table leaves the camera alone (it folds at poker)');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  const out1 = await state(p);
  ok(out1.shown === false, 'flying back to the eyes, the body stays out of the way');
  await p.waitForTimeout(900);
  const home = await state(p);
  ok(home.seated === null && dist(home.cam, home.eye) < 0.02 && home.shown && home.shrunk, 'back from the table: at the eyes, the body there, the head shrunk');
  await shot(p, 'floor-back');

  // F with the map open does nothing (the map holds the keyboard)
  await p.keyboard.press('KeyN');
  await p.waitForTimeout(300);
  await p.keyboard.press('KeyF');
  await p.waitForTimeout(100);
  ok((await state(p)).view === 'first', 'F with the map open leaves the camera alone');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // F again: third person, the pitch back in the follow camera's range
  await p.evaluate(() => window.casino.world.life.seating.player.addLook(0, 3));
  await p.keyboard.press('KeyF');
  await p.waitForTimeout(700);
  const t1 = await state(p);
  ok(t1.view === 'third' && t1.camPitch <= 1.1 && flat(t1.cam, t1.at) > 0.4 && t1.shrunk === false, `F again: third person, the head drawn, pitch ${t1.camPitch.toFixed(2)}`);

  // remembered across a reload
  await p.keyboard.press('KeyF');
  await p.waitForTimeout(200);
  await p.reload();
  await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300_000 });
  await p.waitForTimeout(800);
  const again = await state(p);
  ok(again.view === 'first' && dist(again.cam, again.eye) < 0.01, 'after a reload the floor comes back in first person');
  await setView(p, 'third');
  if (errors.length) fail(`dev floor errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// --- a phone ---------------------------------------------------------------------------------------

if (checks.includes('touch')) {
  const { defaultBrowserType, ...phone } = devices['iPhone 13 landscape'];
  const { p, ctx, errors } = await devFloor({ ...phone, viewport: { width: 844, height: 390 } });
  await setView(p, 'first');
  await p.waitForTimeout(700);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const drag = async (from, to, ms = 500, hold = 0) => {
    await touch('touchStart', [from]);
    const steps = Math.max(2, Math.round(ms / 32));
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [[from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]]);
      await p.waitForTimeout(ms / steps);
    }
    const t = Date.now();
    while (Date.now() - t < hold) {
      await touch('touchMove', [to]);
      await p.waitForTimeout(80);
    }
    await touch('touchEnd', []);
  };
  const a = await state(p);
  ok(a.view === 'first' && dist(a.cam, a.eye) < 0.01, 'a phone in first person: the camera at the eyes');
  await drag([640, 200], [520, 260]);
  await p.waitForTimeout(200);
  const b = await state(p);
  ok(angle(a.camYaw, b.camYaw) > 0.2 && b.camPitch > a.camPitch && dist(b.cam, b.eye) < 0.01, `a look drag turns the eyes (${angle(a.camYaw, b.camYaw).toFixed(2)} rad) and tips them down`);
  const stick = await p.evaluate(() => {
    const r = document.querySelector('.touch-stick').getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  await drag(stick, [stick[0], stick[1] - 44], 250, 1200);
  await p.waitForTimeout(200);
  const c = await state(p);
  const along = ((c.at.x - b.at.x) * b.dir.x + (c.at.z - b.at.z) * b.dir.z) / Math.max(1e-6, flat(c.at, b.at) * Math.hypot(b.dir.x, b.dir.z));
  ok(flat(c.at, b.at) > 0.8 && along > 0.95, `the stick walks where the eyes look (${flat(c.at, b.at).toFixed(2)} m, cos ${along.toFixed(3)})`);
  await shot(p, 'touch-first');
  await setView(p, 'third');
  if (errors.length) fail(`phone errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// --- the game ----------------------------------------------------------------------------------------

async function enterAs(name, first = false, device = null) {
  const ctx = await browser.newContext(device ?? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((f) => {
    localStorage.setItem('casino.quality', 'low');
    if (f) localStorage.setItem('casino.camera.view', 'first');
  }, first);
  const p = await ctx.newPage();
  const errors = [];
  watch(p, errors);
  await p.goto(`http://localhost:${port}/casino/`, { timeout: 180_000 });
  await p.waitForSelector('.name-input, .menu-item', { timeout: 300_000 });
  if (await p.$('.name-input')) {
    await p.fill('.name-input', name);
    if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
    await p.click('.enter-btn');
  }
  await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  if (await p.$('.editor-panel.guided')) {
    await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 });
    await p.waitForTimeout(1500);
    for (let i = 0; i < 3; i++) {
      await p.click('.editor-panel .ed-buttons .btn.primary');
      await p.waitForTimeout(500);
    }
  } else {
    await p.click('.menu-item >> nth=0');
  }
  await p.waitForSelector('.hud', { timeout: 30_000 });
  await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 });
  await p.waitForTimeout(1200);
  return { p, ctx, errors };
}

if (checks.includes('game')) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', 'DELETE FROM casino_rate', '-c', 'server/wrangler.toml'], { stdio: 'pipe' });
  const { p, ctx, errors } = await enterAs('camera6_e2e_a');
  await p.evaluate(() => window.casino.world.setMouse({ view: 'third' }));
  await p.evaluate(() => window.casino.world.teleport(0, 9, Math.PI));
  await p.waitForTimeout(500);
  await p.keyboard.press('KeyF');
  await p.waitForTimeout(700);
  const f = await state(p);
  ok(f.view === 'first' && dist(f.cam, f.eye) < 0.01 && f.shrunk, 'in the game, F: first person');
  await p.keyboard.down('KeyW');
  await p.waitForTimeout(700);
  await p.keyboard.up('KeyW');
  const w = await state(p);
  ok(flat(w.at, f.at) > 0.8, `walking in first person (${flat(w.at, f.at).toFixed(2)} m)`);
  await shot(p, 'game-first');

  // chat: an f typed there is a letter
  await p.keyboard.press('KeyT');
  await p.waitForTimeout(300);
  await p.keyboard.type('fff');
  await p.waitForTimeout(150);
  ok((await state(p)).view === 'first', 'an f typed into the chat line leaves the camera alone');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // a bar stool with E, then E again to stand
  const stool = await p.evaluate(async () => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    const w = window.casino.world;
    const busy = new Set();
    for (const [, pl] of window.casino.app.link.players) if (pl.info?.seat) busy.add(pl.info.seat);
    return lifePoints(w.plan).seats.find((s) => s.id.startsWith('bar.stool') && !w.life.seating.book.holder(s.id));
  });
  if (stool) {
    // hop there a walk's worth at a time (the floor checks how fast you go)
    const from = await state(p);
    // from behind it (a stool faces the counter), looking the way it faces
    const tx = stool.x - Math.sin(stool.yaw) * 0.7;
    const tz = stool.z - Math.cos(stool.yaw) * 0.7;
    const n = Math.max(1, Math.ceil(Math.hypot(tx - from.at.x, tz - from.at.z) / 7));
    for (let i = 1; i <= n; i++) {
      await p.evaluate(([x, z, yaw]) => window.casino.world.teleport(x, z, yaw), [from.at.x + ((tx - from.at.x) * i) / n, from.at.z + ((tz - from.at.z) * i) / n, stool.yaw]);
      await p.waitForTimeout(1100);
    }
    await p.evaluate((yaw) => {
      const pl = window.casino.world.life.seating.player;
      pl.camYaw = yaw + Math.PI;
      pl.camPitch = 0.3;
    }, stool.yaw);
    await p.waitForTimeout(400);
    const prompt = await p.evaluate(() => document.querySelector('.world-prompt:not([hidden])')?.textContent ?? '');
    const up = await state(p);
    await p.keyboard.press('KeyE');
    await p.waitForTimeout(1600);
    const s = await state(p);
    const on = await p.evaluate(() => window.casino.world.life.seating.seated?.id ?? null);
    // (a bar stool is high: the eyes come down only a little, if at all, from standing)
    ok(on === stool.id && dist(s.cam, s.eye) < 0.01 && s.eye.y < up.eye.y + 0.01, `E at ${stool.id} ("${prompt}"): sitting, looking from the stool (eyes ${s.eye.y.toFixed(2)} m, ${up.eye.y.toFixed(2)} standing)`);
    await shot(p, 'game-stool');
    await p.keyboard.press('KeyE');
    await p.waitForTimeout(700);
    ok((await p.evaluate(() => window.casino.world.life.seating.seated)) === null, 'E again stands up');
  } else fail('no free bar stool to try');

  // blackjack: E, the lobby's solo table, a buy-in, then Esc back to the eyes
  const bj = await p.evaluate(() => {
    const s = window.casino.world.stations.find((x) => x.id === 'bj-1');
    return { x: s.anchor.position.x, z: s.anchor.position.z, yaw: s.yaw, depth: s.footprint.depth };
  });
  {
    const from = await state(p);
    const d = bj.depth / 2 + 0.7;
    const tx = bj.x + Math.sin(bj.yaw) * d;
    const tz = bj.z + Math.cos(bj.yaw) * d;
    const n = Math.max(1, Math.ceil(Math.hypot(tx - from.at.x, tz - from.at.z) / 7));
    for (let i = 1; i <= n; i++) {
      await p.evaluate(([x, z, yaw]) => window.casino.world.teleport(x, z, yaw), [from.at.x + ((tx - from.at.x) * i) / n, from.at.z + ((tz - from.at.z) * i) / n, bj.yaw + Math.PI]);
      await p.waitForTimeout(1100);
    }
    await p.evaluate((yaw) => {
      const pl = window.casino.world.life.seating.player;
      pl.camYaw = yaw;
      pl.camPitch = 0.3;
    }, bj.yaw);
    await p.waitForTimeout(400);
  }
  const eyes = await state(p);
  await p.keyboard.press('KeyE');
  await p.waitForTimeout(150);
  const fly = await state(p);
  ok(fly.seated === 'bj-1' && dist(fly.cam, eyes.eye) < 0.8, `E at blackjack flies in from the eyes (${dist(fly.cam, eyes.eye).toFixed(2)} m on)`);
  await p.waitForSelector('.lobby-choice', { timeout: 15_000 });
  await p.keyboard.press('s');
  await p.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
  await p.fill('.modal input[type=number]', '500');
  await p.click('.modal .btn.primary');
  await p.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });
  await p.waitForTimeout(1500);
  await shot(p, 'game-table');
  await p.keyboard.press('KeyF');
  await p.waitForTimeout(150);
  ok((await state(p)).view === 'first', 'F at the table leaves the camera alone');
  await p.evaluate(() => window.casino.app.escape());
  const leave = await p.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
  if (leave) await leave.click();
  await p.waitForFunction(() => !window.casino.app.table && window.casino.world.seated === null, null, { timeout: 30_000 });
  await p.waitForTimeout(1200);
  const home = await state(p);
  ok(dist(home.cam, home.eye) < 0.02 && home.shown && home.shrunk, 'left the table: back at the eyes');
  await shot(p, 'game-back');

  // the Settings sheet
  await p.keyboard.press('Escape');
  const opened = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.hud button, .hud .hud-btn')].find((x) => /settings/i.test(x.getAttribute('aria-label') ?? x.title ?? x.textContent ?? ''));
    b?.click();
    return !!b;
  });
  if (!opened) {
    // the menu's Settings (the HUD may keep it behind its menu button)
    await p.evaluate(async () => {
      const { openSettings } = await import('/casino/src/ui/hud/settings.ts');
      openSettings({ root: document.getElementById('ui'), sfx: { muted: false, volume: 1, setMuted() {}, setVolume() {}, play() {} } });
    });
  }
  await p.waitForSelector('.settings-sheet', { timeout: 10_000 });
  const row = await p.evaluate(() => {
    const seg = document.querySelector('.settings-sheet [aria-label="Camera"]');
    return seg ? [...seg.querySelectorAll('[role=radio]')].map((b) => `${b.textContent}:${b.getAttribute('aria-checked')}`) : null;
  });
  ok(row?.join() === 'Third person:false,First person:true', `Settings shows the camera: ${row?.join(' ')}`);
  await p.evaluate(() => document.querySelector('.settings-sheet [aria-label="Camera"]')?.scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(700);
  await shot(p, 'game-settings');
  await p.click('.settings-sheet [aria-label="Camera"] [data-id="third"]');
  await p.waitForTimeout(100);
  ok((await p.evaluate(() => localStorage.getItem('casino.camera.view'))) === 'third', 'choosing Third person in Settings saves it');
  await p.click('.settings-sheet [aria-label="Camera"] [data-id="first"]');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);

  // a reload comes back in first person
  await p.reload();
  await p.waitForSelector('.menu-item', { timeout: 300_000 });
  await p.click('.menu-item >> nth=0');
  await p.waitForSelector('.hud', { timeout: 30_000 });
  await p.waitForTimeout(1500);
  const again = await state(p);
  ok(again.view === 'first' && dist(again.cam, again.eye) < 0.02, 'after a reload the game comes back in first person');
  await p.evaluate(() => window.casino.world.setMouse({ view: 'third' }));
  if (errors.length) fail(`game errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

const sql = (q) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', q, '-c', 'server/wrangler.toml'], { stdio: 'pipe' });

/**
 * Watch every frame for your own head drawn with the camera inside it, or shrunk away with the
 * camera out of it (a banker's window, the fly back); read() says how many of each.
 */
const headWatch = (p) =>
  p.evaluate(() => {
    const c = window.casino;
    const w = c.world;
    const pl = w.life.seating.player;
    const r = { inside: 0, missing: 0, frames: 0 };
    c.headWatch?.off();
    const off = c.engine.onFrame(() => {
      const head = w.player.character.root.getObjectByName('Head');
      if (!head || !w.player.character.root.visible || pl.view !== 'first' || !pl.isEnabled) return;
      r.frames++;
      const d = c.engine.camera.position.distanceTo(pl.eye);
      const shrunk = head.scale.x < 0.01;
      if (d < 0.05 && !shrunk) r.inside++;
      if (d > 0.5 && shrunk) r.missing++;
    });
    c.headWatch = { off, r };
  });
const headRead = (p) => p.evaluate(() => ({ ...window.casino.headWatch.r }));

async function travelTo(p, x, z, yaw) {
  const from = await state(p);
  const n = Math.max(1, Math.ceil(Math.hypot(x - from.at.x, z - from.at.z) / 7));
  for (let i = 1; i <= n; i++) {
    await p.evaluate(([a, b, c]) => window.casino.world.teleport(a, b, c), [from.at.x + ((x - from.at.x) * i) / n, from.at.z + ((z - from.at.z) * i) / n, yaw]);
    await p.waitForTimeout(1100);
  }
}

if (checks.includes('flows')) {
  sql('DELETE FROM casino_rate');
  const { p, ctx, errors } = await enterAs('camera6_e2e_b', true);
  const f0 = await state(p);
  ok(f0.view === 'first' && dist(f0.cam, f0.eye) < 0.02, 'a saved first person: Enter Casino puts you at the eyes');
  await headWatch(p);

  // a banker's window: the camera goes over your shoulder, and flies back into your eyes
  const win = await p.evaluate(() => window.casino.world.life.bankers.tellers[1].customer);
  await travelTo(p, win.x, win.z + 0.5, Math.PI);
  await p.evaluate(() => {
    const w = window.casino.world;
    w.life.seating.player.camYaw = 0;
    w.life.bankers.spots(w.player.position)[0]?.use();
  });
  await p.waitForSelector('.bank-sheet', { timeout: 8000 });
  await p.waitForTimeout(1200);
  await shot(p, 'flows-bank');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await shot(p, 'flows-bank-back');
  await p.waitForTimeout(1200);
  const b1 = await state(p);
  ok(dist(b1.cam, b1.eye) < 0.02 && b1.shown && b1.shrunk, 'back from the bank: at the eyes');

  // the boutique: its showroom borrows the camera, and gives it back to the eyes
  // (at the watches: on the contract base the boutique's list trips over the reward pieces in
  // SHOP_ITEMS, which shopItem() no longer returns; shop6's to fix)
  await p.evaluate(() => window.casino.app.openShop('gold-watch'));
  await p.waitForSelector('.bq-item', { timeout: 15_000 });
  await p.waitForTimeout(1200);
  const shop = await p.evaluate(() => {
    const head = window.casino.world.player.character.root.getObjectByName('Head');
    return { camY: window.casino.engine.camera.position.y, shrunk: head.scale.x < 0.01 };
  });
  ok(shop.camY < -20 && !shop.shrunk, `the boutique's showroom has the camera (y ${shop.camY.toFixed(1)}) and your head is whole`);
  await shot(p, 'flows-boutique');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(900);
  const s1 = await state(p);
  ok(dist(s1.cam, s1.eye) < 0.02 && s1.shrunk, 'out of the boutique: at the eyes');

  // a drink: ordered at the bar menu, a waiter walks it over; looking down, it's in your hand
  await p.evaluate(() => window.casino.app.openBarMenu());
  await p.click('.bar-order[aria-label^="Order Champagne"]');
  await p.waitForFunction(() => document.querySelector('.bar-status')?.textContent?.startsWith('On its way'), null, { timeout: 12_000 });
  await p.keyboard.press('Escape');
  const got = await p.waitForFunction(() => window.casino.session.profile?.look.held?.item === 'champagne', null, { timeout: 150_000 }).then(
    () => true,
    () => false,
  );
  ok(got, 'a waiter brings the drink in first person');
  await p.evaluate(() => (window.casino.world.life.seating.player.camPitch = 0.55));
  await p.waitForTimeout(700);
  await shot(p, 'flows-drink');

  // away and Come back: at the eyes again
  await p.evaluate(async () => {
    const { IdleWatch } = await import('/casino/src/app/idle.ts');
    const app = window.casino.app;
    app.idle.stop();
    app.idle = new IdleWatch(app.idle.hooks, { idleMs: 6_000, warnMs: 3_000, hereMs: 3_000 });
    app.idle.start();
  });
  await p.waitForSelector('.away', { timeout: 30_000 });
  await p.waitForTimeout(1_000);
  await p.click('.away-back');
  await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 });
  await p.evaluate(async () => {
    const { IdleWatch } = await import('/casino/src/app/idle.ts');
    const app = window.casino.app;
    app.idle.stop();
    app.idle = new IdleWatch(app.idle.hooks);
    app.idle.start();
  });
  await p.waitForTimeout(1_500);
  const a1 = await state(p);
  ok(dist(a1.cam, a1.eye) < 0.02 && a1.shrunk, 'away and back: at the eyes');
  const h = await headRead(p);
  ok(h.frames > 100 && h.inside <= 2 && h.missing === 0, `over ${h.frames} frames your head was drawn with the camera in it ${h.inside} times and missing from view ${h.missing} times`);
  if (errors.length) fail(`flows errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();

  // a new player who chose first person: the dressing room is the dressing room, then the eyes
  try {
    sql(`UPDATE casino_accounts SET look = '{}', created_at = ${Date.now()} WHERE name = 'camera6_e2e_new'`);
  } catch {
    /* not made yet: the first run makes it */
  }
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx2.addInitScript(() => {
    localStorage.setItem('casino.quality', 'low');
    localStorage.setItem('casino.camera.view', 'first');
  });
  const q = await ctx2.newPage();
  const errs2 = [];
  watch(q, errs2);
  await q.goto(`http://localhost:${port}/casino/`, { timeout: 180_000 });
  await q.waitForSelector('.name-input, .menu-item', { timeout: 300_000 });
  await q.fill('.name-input', 'camera6_e2e_new');
  if (await q.$('.pass-input')) await q.fill('.pass-input', 'casino-dev');
  await q.click('.enter-btn');
  await q.waitForSelector('.editor-panel.guided', { timeout: 60_000 });
  await q.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 });
  await q.waitForTimeout(1500);
  const dressing = await q.evaluate(() => window.casino.engine.camera.position.y);
  ok(dressing < -20, `Pick your look in first person still frames the dressing room (camera at y ${dressing.toFixed(1)})`);
  await shot(q, 'flows-onboard');
  for (let i = 0; i < 3; i++) {
    await q.click('.editor-panel .ed-buttons .btn.primary');
    await q.waitForTimeout(500);
  }
  await q.waitForSelector('.hud', { timeout: 30_000 });
  await q.waitForTimeout(1500);
  const n1 = await state(q);
  ok(n1.view === 'first' && dist(n1.cam, n1.eye) < 0.02 && n1.shrunk, 'then onto the floor at the eyes');
  await shot(q, 'flows-onboard-floor');
  if (errs2.length) fail(`onboarding errors: ${errs2.slice(0, 3).join(' | ')}`);
  await ctx2.close();
}

/** The chat's corner: what it shows, and what a click in the middle of its log lands on. */
const chatState = (p) =>
  p.evaluate(() => {
    const root = document.querySelector('.chat');
    const box = root.querySelector('.chat-box');
    const log = root.querySelector('.chat-log').getBoundingClientRect();
    const hit = document.elementFromPoint(log.left + log.width / 2, log.top + log.height / 2);
    const pin = root.querySelector('.chat-pin');
    const pr = pin.getBoundingClientRect();
    return {
      open: !box.hidden,
      idle: root.classList.contains('idle'),
      typing: root.classList.contains('typing'),
      pinned: pin.getAttribute('aria-pressed') === 'true',
      saved: localStorage.getItem('casino.chat.open'),
      through: !!hit && !root.contains(hit),
      hitTag: hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : null,
      pinHit: pr.width > 0 && document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2)?.closest('.chat-pin') === pin,
      log: { l: log.left, t: log.top, r: log.right, b: log.bottom },
      lines: [...root.querySelectorAll('#chat-list-floor .chat-line')].map((e) => e.textContent),
    };
  });
const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const rectOf = (p, sel) =>
  p.evaluate((q) => {
    const e = document.querySelector(q);
    if (!e || e.hidden) return null;
    const r = e.getBoundingClientRect();
    return r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
  }, sel);

if (checks.includes('chat')) {
  sql('DELETE FROM casino_rate');
  const { p, ctx, errors } = await enterAs('camera6_e2e_c');
  await p.evaluate(() => {
    localStorage.removeItem('casino.chat.open');
    window.casino.world.setMouse({ view: 'third' });
  });
  // unpinned: T, a line, Enter, and the box goes away again
  await p.keyboard.press('KeyT');
  await p.waitForTimeout(250);
  await p.keyboard.type('unpinned line');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  const c0 = await chatState(p);
  ok(!c0.open && !c0.pinned, 'unpinned, a line sent with Enter puts the box away');

  // pinned: the pin in the head while typing (the line keeps focus), then a line and Enter
  await p.keyboard.press('KeyT');
  await p.waitForTimeout(250);
  await p.click('.chat-pin');
  const typingStill = await p.evaluate(() => document.activeElement?.classList.contains('chat-input'));
  await p.keyboard.type('pinned, and walking');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  const c1 = await chatState(p);
  ok(typingStill && c1.open && c1.idle && c1.pinned && c1.saved === '1', 'pinned while typing: after Enter the chat stays up, idle, and the pin is remembered');
  ok(c1.lines.some((l) => l.includes('pinned, and walking')), 'the line went out and shows in the pinned log');
  ok(c1.through, `a click in the middle of the idle log lands on the game (${c1.hitTag})`);
  ok(c1.pinHit, 'the pin itself still takes its click');
  const keysFree = await p.evaluate(async () => (await import('/casino/src/ui/keyboard.ts')).overlayCount());
  const w0 = await state(p);
  await p.keyboard.down('KeyW');
  await p.waitForTimeout(800);
  await p.keyboard.up('KeyW');
  const w1 = await state(p);
  ok(keysFree === 0 && flat(w1.at, w0.at) > 0.8, `with the chat pinned, W walks (${flat(w1.at, w0.at).toFixed(2)} m) and nothing holds the keyboard`);
  await shot(p, 'chat-pinned-walk');
  // first person too, with the log up
  await p.keyboard.press('KeyF');
  await p.waitForTimeout(700);
  await shot(p, 'chat-pinned-first');
  await p.keyboard.press('KeyF');

  // T types into the pinned box again, Esc stops typing and leaves it up
  await p.keyboard.press('KeyT');
  await p.waitForTimeout(250);
  const t1 = await chatState(p);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const t2 = await chatState(p);
  ok(t1.typing && !t1.idle && t2.open && t2.idle && !t2.typing, 'T types into the pinned chat (whole again), Esc hands the keys back and leaves it up');

  // at a table: still up, and the felt under the log still takes clicks
  await p.evaluate(() => {
    const w = window.casino.world;
    const s = w.stations.find((x) => x.id === 'bj-1');
    const a = s.anchor.position;
    const d = s.footprint.depth / 2 + 0.7;
    return [a.x + Math.sin(s.yaw) * d, a.z + Math.cos(s.yaw) * d, s.yaw + Math.PI];
  }).then(([x, z, yaw]) => travelTo(p, x, z, yaw));
  await p.evaluate(() => window.casino.world.enter(window.casino.world.stations.find((s) => s.id === 'bj-1')));
  await p.waitForSelector('.lobby-choice', { timeout: 15_000 });
  await p.keyboard.press('s');
  await p.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
  await p.fill('.modal input[type=number]', '500');
  await p.click('.modal .btn.primary');
  await p.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });
  await p.waitForTimeout(1800);
  const c2 = await chatState(p);
  ok(c2.open && c2.idle && c2.through, `seated at blackjack the pinned chat is up and clicks go through it (${c2.hitTag})`);
  await shot(p, 'chat-pinned-table');
  await p.evaluate(() => window.casino.app.escape());
  const leave = await p.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
  if (leave) await leave.click();
  await p.waitForFunction(() => !window.casino.app.table && window.casino.world.seated === null, null, { timeout: 30_000 });
  await p.waitForTimeout(800);

  // a reload: up again, pinned
  await p.reload();
  await p.waitForSelector('.menu-item', { timeout: 300_000 });
  await p.click('.menu-item >> nth=0');
  await p.waitForSelector('.hud', { timeout: 30_000 });
  await p.waitForTimeout(1500);
  const c3 = await chatState(p);
  ok(c3.open && c3.idle && c3.pinned, 'after a reload the chat is pinned up again');
  // unpinned from its head (Esc first: entering took the mouse, and a held mouse clicks nothing)
  if (await p.evaluate(() => document.pointerLockElement !== null)) await p.keyboard.press('Escape');
  await p.click('.chat-pin');
  await p.waitForTimeout(300);
  const c4 = await chatState(p);
  ok(!c4.open && !c4.pinned && c4.saved === null, 'unpinned, it goes away and forgets');
  if (errors.length) fail(`chat errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();

  // phones, pinned from the start
  for (const [key, dev, vp] of [
    ['land', devices['iPhone 13 landscape'], { width: 844, height: 390 }],
    ['up', devices['iPhone 13'], { width: 390, height: 844 }],
  ]) {
    const { defaultBrowserType, ...d } = dev;
    const ph = await enterAs(`camera6_e2e_${key}`, false, { ...d, viewport: vp });
    await ph.p.evaluate(() => localStorage.setItem('casino.chat.open', '1'));
    await ph.p.reload();
    await ph.p.waitForSelector('.menu-item', { timeout: 300_000 });
    await ph.p.tap('.menu-item >> nth=0');
    await ph.p.waitForSelector('.hud', { timeout: 30_000 });
    await ph.p.waitForFunction(() => document.documentElement.classList.contains('touch-ui') && !document.querySelector('.touch-layer')?.hidden, null, { timeout: 10_000 });
    await ph.p.waitForTimeout(1200);
    // the stick's ring, and the action button (in reach of blackjack)
    const s = await ph.p.evaluate(() => {
      const w = window.casino.world;
      const st = w.stations.find((x) => x.id === 'bj-1');
      const a = st.anchor.position;
      const d = st.footprint.depth / 2 + 0.7;
      return [a.x + Math.sin(st.yaw) * d, a.z + Math.cos(st.yaw) * d, st.yaw + Math.PI];
    });
    await travelTo(ph.p, ...s);
    await ph.p.waitForTimeout(600);
    const c = await chatState(ph.p);
    const stick = await rectOf(ph.p, '.touch-stick');
    const act = await rectOf(ph.p, '.touch-act');
    const cap = await rectOf(ph.p, '.touch-caption');
    const dock = await rectOf(ph.p, '.chat-dock');
    ok(c.open && c.idle && c.through && !!dock, `${key}: pinned, the newest lines are up over the floor, touched through, the dock under them`);
    ok(!overlap(c.log, stick) && !overlap(c.log, act) && !overlap(c.log, cap), `${key}: the lines keep clear of the stick, the action button and its caption`);
    await ph.p.screenshot({ path: `${out}/camera6-chat-phone-${key}.png` });
    await ph.p.tap('.chat-dock');
    await ph.p.waitForTimeout(500);
    const typing = await chatState(ph.p);
    ok(typing.typing && !typing.idle, `${key}: a tap on the dock types, in the whole box`);
    await ph.p.screenshot({ path: `${out}/camera6-chat-phone-${key}-typing.png` });
    if (ph.errors.length) fail(`${key} phone errors: ${ph.errors.slice(0, 3).join(' | ')}`);
    await ph.ctx.close();
  }
}

await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
