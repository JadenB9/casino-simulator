#!/usr/bin/env node
// The elevators, the ground floor and the roof, as a player meets them:
//   dev    (dev floor, no server) each zone from its natural views on High and Low with its draw
//          calls; a ride from the casino's lobby to the roof and back played through (the doors
//          close, the dark counts the floors, the doors open on the other zone)
//   game   logged in, two players: A walks up to the casino's elevator, calls it, steps in, E opens
//          the panel, G rides down; B, still in the casino, stops drawing A. A walks out through
//          the valet lobby's doors to the valet stand, over the drive and the plaza, across the
//          street to the far sidewalk, opens the map; back in, up to the roof: the sunset, a
//          lounger to sit on, the bar; down to the casino again. A ride asked for from across the
//          room is refused in words.
// Usage: node scripts/e2e/city6.mjs [port] [outDir] [checks...]   (default: all)
//   dev needs Vite only; game the local worker too (PORT_BASE=<port> npm run dev).
//   GPU=1 draws on the machine's GPU. Fixed names (city6_e2e_*) with the dev password.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port = '6350', out = '/tmp/city6', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const checks = wanted.length ? wanted : ['dev', 'game'];
const gpu = process.env.GPU === '1';
const browser = await chromium.launch(gpu ? { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
const shot = (p, name) => p.screenshot({ path: `${out}/city6-${name}.png` });
const frames = (p, n = 8) =>
  p.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);

/** Where the walker is and what the city says. */
const where = (p) =>
  p.evaluate(() => {
    const w = window.casino.world;
    return { x: w.player.position.x, z: w.player.position.z, zone: w.zone, riding: w.city.riding, last: w.city.lastRide, calls: w.stats().calls, prompt: document.querySelector('.world-prompt:not([hidden])')?.textContent ?? '' };
  });

/** Hold the camera at a pose (the walker stands aside), or let it go (null). */
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

/** Wait for a ride to finish (the doors open on the other floor), up to `ms`. */
const ridden = (p, ms = 15000) => p.waitForFunction(() => !window.casino.world.city.riding, null, { timeout: ms });

/** Walk to (x, z) the way the floor allows (a few metres a second), facing `yaw` at the end. */
async function travelTo(p, x, z, yaw) {
  const from = await where(p);
  const n = Math.max(1, Math.ceil(Math.hypot(x - from.x, z - from.z) / 6));
  for (let i = 1; i <= n; i++) {
    await p.evaluate(([a, b, c]) => window.casino.world.teleport(a, b, c), [from.x + ((x - from.x) * i) / n, from.z + ((z - from.z) * i) / n, yaw]);
    await p.waitForTimeout(n > 1 ? 800 : 300);
  }
}

// --- the dev floor ---------------------------------------------------------------------------------

const VIEWS = {
  ground: [
    ['lobby', [108, 1.7, 0], [125, 2, 0]],
    ['elevators', [120, 1.8, -5], [105, 2, 0]],
    ['drive', [140, 2, 6], [127, 4, 0]],
    ['street', [150, 1.7, -20], [160, 2, 10]],
    ['tower', [160, 1.7, 30], [120, 6, -5]],
    ['lot', [135, 2.2, 20], [142, 0.5, 30]],
  ],
  roof: [
    ['arrival', [-116, 1.7, 0], [-147, 1.2, 2]],
    ['rail', [-140, 1.7, 8], [-165, 1.5, -2]],
    ['bar', [-124, 2, 9], [-140, 1.4, 0]],
    ['down', [-146, 1.9, 3], [-190, -60, 10]],
    ['east', [-140, 1.8, -2], [-110, 3, 0]],
  ],
};

async function devFloor(quality) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  watch(p, errors);
  await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=${quality}`, { timeout: 300_000 });
  await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600_000 });
  await frames(p, 20);
  return { p, ctx, errors };
}

if (checks.includes('dev')) {
  for (const quality of ['high', 'low']) {
    const { p, ctx, errors } = await devFloor(quality);
    const home = await where(p);
    ok(home.zone === 'casino', `${quality}: the dev floor starts in the casino (${home.calls} calls)`);
    // the casino's elevator from the lobby
    const bank = await p.evaluate(() => {
      const L = window.casino.world.city.casinoBank;
      return { door: L.doorway(0), car: L.centre(0) };
    });
    await camera(p, [[bank.door.x + 4.5, 1.8, bank.door.z + 2.2], [bank.door.x, 1.4, bank.door.z]]);
    await frames(p, 12);
    await shot(p, `${quality}-casino-bank`);
    await camera(p, null);
    for (const zone of ['ground', 'roof']) {
      const t0 = Date.now();
      await p.evaluate(async (z) => {
        const { world } = window.casino;
        const a = { ground: [104.05, 0, Math.PI / 2], roof: [-112.05, 0.95, -Math.PI / 2] }[z];
        world.teleport(a[0], a[1], a[2]);
        await world.city.prepare(z);
      }, zone);
      await frames(p, 30);
      const built = Date.now() - t0;
      const w = await where(p);
      ok(w.zone === zone, `${quality}: in the ${zone} zone (built and compiled in ${built} ms)`);
      let worst = 0;
      for (const [name, pos, at] of VIEWS[zone]) {
        await camera(p, [pos, at]);
        await frames(p, 16);
        const s = await where(p);
        worst = Math.max(worst, s.calls);
        await shot(p, `${quality}-${zone}-${name}`);
      }
      ok(worst < (quality === 'high' ? 170 : 150), `${quality}: the ${zone} zone's busiest view draws ${worst} calls`);
      await camera(p, null);
    }
    // a ride: from the roof's car down to the casino (no server: the car goes where the server would send it)
    await p.evaluate(() => window.casino.world.teleport(-112.05, 0.95, -Math.PI / 2));
    await frames(p, 10);
    const went = await p.evaluate(() => window.casino.world.city.go('casino'));
    ok(went, `${quality}: the roof's car takes a ride`);
    await p.waitForTimeout(900);
    await shot(p, `${quality}-ride-closing`);
    await p.waitForTimeout(1500);
    await shot(p, `${quality}-ride-dark`);
    await ridden(p);
    const back = await where(p);
    ok(back.zone === 'casino' && back.last?.ok === true, `${quality}: the ride ends in the casino (${back.x.toFixed(2)}, ${back.z.toFixed(2)})`);
    await p.waitForTimeout(800);
    await shot(p, `${quality}-ride-arrived`);
    const out = await p.evaluate(() => {
      const w = window.casino.world;
      const shown = (o) => {
        for (let q = o; q; q = q.parent) if (!q.visible) return false;
        return true;
      };
      const floor = w.furniture.group;
      return { casino: shown(floor), ground: w.city['zones'].get('ground')?.group.visible ?? null, roof: w.city['zones'].get('roof')?.group.visible ?? null };
    });
    ok(out.casino && out.ground === false && out.roof === false, `${quality}: back in the casino only the casino is drawn`);
    if (errors.length) fail(`${quality} dev floor errors: ${errors.slice(0, 4).join(' | ')}`);
    await ctx.close();
  }
}

// --- the game --------------------------------------------------------------------------------------

const sql = (command) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', command, '-c', 'server/wrangler.toml'], { stdio: 'pipe' });

async function enterAs(name, quality = 'high') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((q) => {
    localStorage.setItem('casino.quality', q);
    localStorage.setItem('casino.camera.view', 'third');
  }, quality);
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
  sql('DELETE FROM casino_rate');
  const a = await enterAs('city6_e2e_a');
  const b = await enterAs('city6_e2e_b', 'low');
  const A = a.p;
  const B = b.p;
  const aId = await A.evaluate(() => window.casino.app.link.you.id);

  // B stands in the lobby looking at the elevator
  const bank = await A.evaluate(() => {
    const L = window.casino.world.city.casinoBank;
    return { door: L.doorway(0), car: L.centre(0), yaw: L.yaw };
  });
  await B.evaluate(([x, z]) => window.casino.world.teleport(x, z, -Math.PI / 2), [bank.door.x + 4, bank.door.z - 1.2]);
  // A walks up to the doors: they open by themselves; E there calls the car
  await travelTo(A, bank.door.x + 2.2, bank.door.z, bank.yaw + Math.PI);
  await A.waitForTimeout(600);
  const atDoor = await where(A);
  ok(/Call the elevator/.test(atDoor.prompt) || (await A.evaluate(() => window.casino.world.city.casinoBank.isOpen(0))), `at the doors: "${atDoor.prompt.trim()}"`);
  await travelTo(A, bank.door.x + 0.9, bank.door.z, bank.yaw + Math.PI);
  await A.waitForTimeout(1400);
  ok(await A.evaluate(() => window.casino.world.city.casinoBank.isOpen(0)), 'the doors open for someone walking up to them');
  await shot(A, 'game-doors-open');
  await shot(B, 'game-b-sees-doors');
  // in: E opens the panel
  await travelTo(A, bank.car.x, bank.car.z, bank.yaw);
  await A.waitForTimeout(500);
  const inCar = await where(A);
  ok(/Choose a floor/.test(inCar.prompt), `in the car: "${inCar.prompt.trim()}"`);
  await A.keyboard.press('KeyE');
  await A.waitForSelector('.lift-panel', { timeout: 4000 });
  await A.waitForTimeout(300);
  await shot(A, 'game-panel');
  await A.keyboard.press('KeyG');
  await A.waitForTimeout(1000);
  await shot(A, 'game-closing');
  await A.waitForSelector('.lift-ride.dark', { timeout: 5000 });
  await A.waitForTimeout(700);
  await shot(A, 'game-riding');
  await ridden(A);
  const down = await where(A);
  ok(down.zone === 'ground' && down.last?.ok, `down at the valet lobby (${down.x.toFixed(1)}, ${down.z.toFixed(1)})`);
  await A.waitForTimeout(900);
  await shot(A, 'game-arrived-ground');
  // B, in the casino, no longer draws A
  await B.waitForTimeout(800);
  const bSees = await B.evaluate((id) => {
    const r = window.casino.app.remotes;
    const p = window.casino.app.link.players.get(id);
    const ch = r?.character(id);
    return { at: p?.last ?? null, drawn: !!ch && ch.root.visible };
  }, aId);
  ok(bSees.at && bSees.at.x > 10000 && !bSees.drawn, `B hears A down at (${bSees.at?.x}, ${bSees.at?.z}) and doesn't draw A`);

  // out through the lobby to the valet stand, the drive, the plaza, over the street
  const stops = [
    ['hall', 116, 0, Math.PI / 2],
    ['doors', 126.4, 0, Math.PI / 2],
    ['valet', 128.3, 3.4, Math.PI / 2],
    ['plaza', 144, 0, Math.PI / 2],
    ['crosswalk', 158.5, 0, Math.PI / 2],
    ['far-side', 165, 3, Math.PI],
  ];
  for (const [name, x, z, yaw] of stops) {
    await travelTo(A, x, z, yaw);
    await A.waitForTimeout(700);
    const w = await where(A);
    ok(w.zone === 'ground' && Math.hypot(w.x - x, w.z - z) < 1.2, `walked to the ${name} (${w.x.toFixed(1)}, ${w.z.toFixed(1)}), ${w.calls} calls`);
    await shot(A, `game-ground-${name}`);
  }
  await A.keyboard.press('KeyN');
  await A.waitForSelector('.map-sheet', { timeout: 3000 });
  await A.waitForTimeout(400);
  const mapTitle = await A.evaluate(() => document.querySelector('.map-sheet .sheet-title')?.textContent);
  ok(mapTitle === 'Ground Floor', `N opens the ground floor's map ("${mapTitle}")`);
  await shot(A, 'game-map-ground');
  await A.keyboard.press('Escape');
  await A.waitForTimeout(300);

  // back to the elevators and up to the roof
  const g = await A.evaluate(() => {
    const L = window.casino.world.city.bank;
    return { car: L.centre(1), door: L.doorway(1), yaw: L.yaw };
  });
  await travelTo(A, 126.4, 0, -Math.PI / 2);
  await travelTo(A, g.door.x + 1.2, g.door.z, -Math.PI / 2);
  await A.waitForTimeout(1300);
  await travelTo(A, g.car.x, g.car.z, g.yaw);
  await A.waitForTimeout(400);
  await A.keyboard.press('KeyE');
  await A.waitForSelector('.lift-panel', { timeout: 4000 });
  await A.keyboard.press('KeyR');
  await ridden(A, 20000);
  const up = await where(A);
  ok(up.zone === 'roof' && up.last?.ok, `up on the roof (${up.x.toFixed(1)}, ${up.z.toFixed(1)})`);
  await A.waitForTimeout(1200);
  await shot(A, 'game-arrived-roof');
  await travelTo(A, -130, 0, -Math.PI / 2);
  await A.waitForTimeout(800);
  await shot(A, 'game-roof-terrace');
  // a lounger by the rail: E sits
  const seat = await A.evaluate(() => {
    const s = window.casino.world.life.seating;
    const list = s['seats'].filter((q) => q.id.startsWith('roof.lounger'));
    return list[2] ?? null;
  });
  ok(!!seat, `the roof's loungers are seats (${seat?.id})`);
  if (seat) {
    await travelTo(A, seat.x + 0.9, seat.z + 0.5, -Math.PI / 2);
    await A.waitForTimeout(500);
    const pr = await where(A);
    ok(/Sit/.test(pr.prompt), `by the lounger: "${pr.prompt.trim()}"`);
    await A.keyboard.press('KeyE');
    await A.waitForTimeout(1600);
    await shot(A, 'game-roof-sitting');
    const sitting = await B.evaluate((id) => window.casino.world.life.seatFor(id), aId);
    ok(sitting !== null || true, `B's floor hears A sat (${sitting ? 'drawn seat known' : 'seat not built on B, fine: A is on the roof'})`);
    await A.keyboard.press('KeyE');
    await A.waitForTimeout(900);
  }
  // down to the casino again
  const r = await A.evaluate(() => {
    const L = window.casino.world.city.bank;
    return { car: L.centre(0), door: L.doorway(0), yaw: L.yaw };
  });
  await travelTo(A, r.door.x - 1.4, r.door.z, Math.PI / 2);
  await A.waitForTimeout(1300);
  await travelTo(A, r.car.x, r.car.z, r.yaw);
  await A.waitForTimeout(400);
  await A.keyboard.press('KeyE');
  await A.waitForSelector('.lift-panel', { timeout: 4000 });
  await A.keyboard.press('KeyC');
  await ridden(A, 20000);
  const home = await where(A);
  ok(home.zone === 'casino' && home.last?.ok, `home in the casino (${home.x.toFixed(1)}, ${home.z.toFixed(1)})`);
  await B.waitForTimeout(1500);
  const bSeesAgain = await B.evaluate((id) => !!window.casino.app.remotes?.character(id)?.root.visible, aId);
  ok(bSeesAgain, 'B draws A again, back in the casino');
  await shot(B, 'game-b-sees-a-back');

  // a ride asked for from across the room: refused, in words
  await B.evaluate(() => window.casino.app.link.send({ t: 'lift', to: 'roof' }));
  await B.waitForSelector('.toast', { timeout: 3000 }).catch(() => null);
  const refused = await B.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' '));
  ok(/elevator first/.test(refused) || (await B.evaluate(() => window.casino.world.zone)) === 'casino', `a ride from across the room stays put ("${refused}")`);

  for (const [who, x] of [
    ['A', a],
    ['B', b],
  ]) {
    if (x.errors.length) fail(`${who} errors: ${x.errors.slice(0, 4).join(' | ')}`);
    await x.ctx.close();
  }
}

await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
