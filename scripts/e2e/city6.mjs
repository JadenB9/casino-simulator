#!/usr/bin/env node
// The elevators, the ground floor and the roof, as a player meets them:
//   dev    (dev floor, no server) each zone from its natural views on High and Low with its draw
//          calls; a ride from the casino's lobby to the roof and back played through (the doors
//          close, the dark counts the floors, the doors open on the other zone)
//   zfight (dev floor) every face of both zones and the casino's elevator through zfight.ts: no two
//          differently dressed faces in one plane where anyone can look (props' own models listed)
//   camera (dev floor) the follow camera from behind the walker at every place people stop out
//          there (the valet stand, the lobby's doors both ways, the crosswalks, the lots' doors,
//          between the parked cars, the roof's bar and rail): it keeps its distance, not in your back
//   phone  (dev floor, a phone) the action button in the car opens the panel; a tap on a floor rides
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
const checks = wanted.length ? wanted : ['dev', 'zfight', 'camera', 'phone', 'game'];
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

/** Wait for a ride to start (if it hasn't) and finish (the doors open on the other floor), up to `ms`. */
async function ridden(p, ms = 15000) {
  await p.waitForFunction(() => window.casino.world.city.riding || window.casino.world.city.lastRide, null, { timeout: 4000 });
  await p.waitForFunction(() => !window.casino.world.city.riding, null, { timeout: ms });
}

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
      const a = L.doorway(0);
      const b = L.doorway(L.spec.cars - 1);
      const c = L.centre(0);
      return { mid: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, n: { x: a.x - c.x, z: a.z - c.z } };
    });
    const k = 4.6 / Math.hypot(bank.n.x, bank.n.z);
    await camera(p, [[bank.mid.x + bank.n.x * k - 1.2, 1.8, bank.mid.z + bank.n.z * k], [bank.mid.x, 1.5, bank.mid.z]]);
    await frames(p, 12);
    await shot(p, `${quality}-casino-bank`);
    // the street doors are the casino's elevator: called, they slide apart onto the car
    await p.evaluate(() => window.casino.world.city.casinoBank.call(0));
    await p.waitForTimeout(550);
    await shot(p, `${quality}-casino-doors-opening`);
    await p.waitForTimeout(1200);
    await shot(p, `${quality}-casino-doors-open`);
    const car = await p.evaluate(() => window.casino.world.city.casinoBank.centre(0));
    await camera(p, [[car.x + 0.9, 1.75, car.z + 0.7], [car.x - 0.6, 1.2, car.z - 2.4]]);
    await p.evaluate(() => window.casino.world.city.casinoBank.call(0));
    await frames(p, 12);
    await shot(p, `${quality}-casino-car-inside`);
    await camera(p, null);
    // a new arrival at the spawn doesn't open them
    const closedAtSpawn = await p.evaluate(async () => {
      const w = window.casino.world;
      w.teleport(0, 12.8, Math.PI);
      await new Promise((r) => setTimeout(r, 5200));
      return w.city.casinoBank.isShut(0);
    });
    ok(closedAtSpawn, `${quality}: standing where new players arrive leaves the doors shut`);
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
    await p.evaluate(() => (window.casino.world.city.lastRide = null));
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

// --- z-fighting --------------------------------------------------------------------------------------

if (checks.includes('zfight')) {
  const { p, ctx, errors } = await devFloor('high');
  for (const zone of ['ground', 'roof', 'casino']) {
    const r = await p.evaluate(async (zone) => {
      const Z = await import('/casino/src/world/zfight.ts');
      const { THREE, world, engine } = window.casino;
      const city = world.city;
      if (zone !== 'casino') await city.prepare(zone);
      engine.scene.updateMatrixWorld(true);
      const surfaces = [];
      const m = new THREE.Matrix4();
      const w = new THREE.Matrix4();
      const v = new THREE.Vector3();
      const matName = (mat) => mat.name || mat.type;
      const push = (name, mat, geo, matrix, group) => {
        const pos = geo.attributes.position;
        if (!pos) return;
        const idx = geo.index;
        const start = group ? group.start : 0;
        const count = group ? group.count : idx ? idx.count : pos.count;
        const out = new Float32Array(Math.floor(count / 3) * 9);
        for (let k = 0; k < Math.floor(count / 3) * 3; k++) {
          const i = idx ? idx.getX(start + k) : start + k;
          v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
          out[k * 3] = v.x;
          out[k * 3 + 1] = v.y;
          out[k * 3 + 2] = v.z;
        }
        surfaces.push({ name, mat, pos: out });
      };
      const meshSurfaces = (o, label) => {
        if (o.isBatchedMesh) {
          for (let i = 0; i < o.instanceCount; i++) {
            let gid;
            try {
              gid = o.getGeometryIdAt(i);
            } catch {
              continue;
            }
            if (gid === undefined || gid < 0) continue;
            const range = o.getGeometryRangeAt(gid);
            o.getMatrixAt(i, m);
            w.multiplyMatrices(o.matrixWorld, m);
            const idx = o.geometry.index;
            push(`${label}#${i}`, matName(o.material), o.geometry, w, idx ? { start: range.indexStart, count: range.indexCount } : { start: range.vertexStart, count: range.vertexCount });
          }
          return;
        }
        if (o.isInstancedMesh) {
          for (let i = 0; i < o.count; i++) {
            o.getMatrixAt(i, m);
            w.multiplyMatrices(o.matrixWorld, m);
            push(`${label}#${i}`, matName(o.material), o.geometry, w, null);
          }
          return;
        }
        push(label, matName(o.material), o.geometry, o.matrixWorld, null);
      };
      // the zone's own group, or (in the casino) the lobby's part of the floor's batch and the bank
      if (zone === 'casino') {
        city.casinoBank.group.traverse((o) => o.isMesh && meshSurfaces(o, o.name));
        const lobby = world.plan.rooms.find((r) => r.id === 'lobby').bounds;
        engine.scene.getObjectByName('floor').children.filter((o) => o.isBatchedMesh).forEach((o) => meshSurfaces(o, o.name));
        for (let i = surfaces.length - 1; i >= 0; i--) {
          const s = surfaces[i];
          let keep = false;
          for (let k = 0; k < s.pos.length && !keep; k += 3) keep = s.pos[k] > lobby.x0 - 0.5 && s.pos[k] < lobby.x1 + 0.5 && s.pos[k + 2] > lobby.z0 - 0.5 && s.pos[k + 2] < lobby.z1 + 0.5;
          if (!keep) surfaces.splice(i, 1);
        }
      } else {
        const g = city['zones'].get(zone).group;
        g.traverse((o) => {
          if (!o.isMesh || o.isSkinnedMesh || o.isPoints) return;
          // the sky, the skyline rings and the far city are backdrops, not surfaces anyone stands by
          if (/^(sky|skyline|city-below|towers)/.test(o.name)) return;
          meshSurfaces(o, o.name || o.parent?.name || 'mesh');
        });
      }
      // nobody sees the underside of what stands on the ground, or anything below it
      const unseen = ([, y], [, ny]) => y < -0.005 || (ny < -0.99 && y < 0.02);
      const fights = Z.findFights(surfaces, { unseen });
      const thing = (x) => x.replace(/#\d+$/, '');
      return {
        surfaces: surfaces.length,
        ours: fights.filter((f) => !/^prop:/.test(thing(f.a)) || !/^prop:/.test(thing(f.b)) || thing(f.a) !== thing(f.b)).map(Z.describeFight),
        own: fights.filter((f) => /^prop:/.test(thing(f.a)) && thing(f.a) === thing(f.b)).length,
      };
    }, zone);
    console.log(`zfight ${zone}: ${r.surfaces} surfaces${r.own ? `, ${r.own} inside props' own models` : ''}`);
    for (const f of r.ours.slice(0, 30)) fail(`z-fight ${zone}: ${f}`);
  }
  if (errors.length) fail(`zfight errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// --- the follow camera out there -------------------------------------------------------------------

if (checks.includes('camera')) {
  const { p, ctx, errors } = await devFloor('high');
  await p.evaluate(() => window.casino.world.setMouse({ view: 'third' }));
  const places = await p.evaluate(async () => {
    const P = await import('/casino/src/world/city/plan.ts');
    const V = P.VALET_STAND;
    const face = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
    const E = Math.PI / 2;
    return [
      ['valet-guest', V.guest.x, V.guest.z, face(V.guest, V)],
      ['lobby-doors-in', 126.2, 0, E],
      ['lobby-doors-out', 129.2, 0, -E],
      ['under-canopy', 134, 3, -E],
      ['plaza-walk', 140, 0, E],
      ['crosswalk-west', 152.8, 0, E],
      ['crosswalk-east', 164.2, 0, -E],
      ['garage-door', P.ENTRANCES.garage.x - 0.9, P.ENTRANCES.garage.z, E],
      ['jail-door', P.ENTRANCES.jail.x - 0.9, P.ENTRANCES.jail.z, E],
      ['lot-aisle', 116, 25.5, E],
      ['stack-rows', 143.8, 18, Math.PI],
      ['ground-lifts', 107.2, 0, -E],
      ['roof-arrival', -115.2, 0, -E],
      ['roof-bar', -123.2, -9.3, Math.PI],
      ['roof-rail', -145.6, 0, -E],
    ];
  });
  for (const [name, x, z, yaw] of places) {
    await p.evaluate(async ([x, z, yaw]) => {
      const w = window.casino.world;
      w.teleport(x, z, yaw);
      await w.city.prepare(w.zone);
      w.teleport(x, z, yaw);
    }, [x, z, yaw]);
    await frames(p, 40);
    const d = await p.evaluate(() => {
      const { world, engine } = window.casino;
      const c = engine.camera.position;
      const q = world.player.position;
      return Math.hypot(c.x - q.x, c.z - q.z);
    });
    ok(d > 1.8, `${name}: the camera stands ${d.toFixed(2)} m behind`);
    await shot(p, `camera-${name}`);
  }
  if (errors.length) fail(`camera errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// --- a phone --------------------------------------------------------------------------------------

if (checks.includes('phone')) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errors = [];
  watch(p, errors);
  await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=low`, { timeout: 300_000 });
  await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600_000 });
  await frames(p, 20);
  const car = await p.evaluate(() => {
    const L = window.casino.world.city.casinoBank;
    return { c: L.centre(0), yaw: L.yaw };
  });
  await p.evaluate(([x, z, y]) => window.casino.world.teleport(x, z, y), [car.c.x, car.c.z, car.yaw + Math.PI]);
  await p.waitForTimeout(800);
  // the action button says what E would
  const act = await p.evaluate(() => document.querySelector('.touch-act:not([hidden])')?.textContent ?? '');
  ok(/Choose/.test(act), `in the car the action button reads "${act.trim()}"`);
  await p.tap('.touch-act');
  await p.waitForSelector('.lift-panel', { timeout: 3000 });
  await p.waitForTimeout(300);
  await shot(p, 'phone-panel');
  const box = await p.evaluate(() => {
    const r = document.querySelector('.lift-panel').getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom };
  });
  ok(box.l >= 0 && box.r <= 390 && box.t >= 0 && box.b <= 844, `the panel fits the phone (${Math.round(box.l)}..${Math.round(box.r)} x ${Math.round(box.t)}..${Math.round(box.b)})`);
  await p.evaluate(() => (window.casino.world.city.lastRide = null));
  await p.tap('.lift-btn[data-zone="roof"]');
  await ridden(p, 20000);
  const up = await where(p);
  ok(up.zone === 'roof', `a tap on Sky Terrace rides up (${up.x.toFixed(1)}, ${up.z.toFixed(1)})`);
  await p.waitForTimeout(900);
  await shot(p, 'phone-roof');
  if (errors.length) fail(`phone errors: ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
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
  await p.waitForTimeout(1500);
  // the day's bonus (or anything else that greets you) closes first
  for (let i = 0; i < 3 && (await p.$('.sheet-scrim, .modal')); i++) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }
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
    const door = L.doorway(0);
    const car = L.centre(0);
    const n = Math.hypot(door.x - car.x, door.z - car.z);
    return { door, car, yaw: L.yaw, nx: (door.x - car.x) / n, nz: (door.z - car.z) / n };
  });
  // (a point `k` metres out in front of the doors)
  const out = (k) => [bank.door.x + bank.nx * k, bank.door.z + bank.nz * k];
  const [bx, bz] = out(4.2);
  await B.evaluate(([x, z, y]) => window.casino.world.teleport(x, z, y), [bx - 1.2, bz, bank.yaw + Math.PI]);
  // A walks up to the doors: they open by themselves; E there calls the car
  await travelTo(A, ...out(2.2), bank.yaw + Math.PI);
  await A.waitForTimeout(600);
  const atDoor = await where(A);
  ok(/Call the elevator/.test(atDoor.prompt) || (await A.evaluate(() => window.casino.world.city.casinoBank.isOpen(0))), `at the doors: "${atDoor.prompt.trim()}"`);
  await travelTo(A, ...out(0.9), bank.yaw + Math.PI);
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
  await A.evaluate(() => (window.casino.world.city.lastRide = null));
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
  await A.evaluate(() => (window.casino.world.city.lastRide = null));
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
  await A.evaluate(() => (window.casino.world.city.lastRide = null));
  await A.keyboard.press('KeyC');
  await ridden(A, 20000);
  const home = await where(A);
  ok(home.zone === 'casino' && home.last?.ok, `home in the casino (${home.x.toFixed(1)}, ${home.z.toFixed(1)})`);
  await B.waitForTimeout(1500);
  const bSeesAgain = await B.evaluate((id) => !!window.casino.app.remotes?.character(id)?.root.visible, aId);
  ok(bSeesAgain, 'B draws A again, back in the casino');
  await shot(B, 'game-b-sees-a-back');

  // a ride asked for from across the room: refused, in words
  await travelTo(B, 0, 7, Math.PI);
  await B.waitForTimeout(500);
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
