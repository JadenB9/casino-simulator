#!/usr/bin/env node
// Headless checks for the v5 building (the dev floor, Vite only). Usage:
//   node scripts/e2e/world4.mjs [port] [out dir] [checks...]
//   checks: layout seats reach shots map seated calls (default: all)
// layout: the plan's own check, then the real geometry against it: every table chair, piece of
//   furniture and prop inside its solids, every station inside its footprint.
// seats: a ray straight down at every seat (life points and every table's chairs) finds a top
//   where the plan says (and inside what npcs counts as a seat, 0.3-0.95 m).
// reach: the real collider (walls, doors, furniture, stations, staff posts) on a 0.15 m grid,
//   walked from the spawn: every station's players' side, every seat, teller window, counter, case
//   and mannequin, and every waiter loop's points reached.
// shots: every room from its doorway and from inside. map: the Map (N) with a room picked.
// seated: sitting at an online desk and at the Bandit Wheel. calls: draw calls and frame time
//   over every room turning round and every doorway looking in, on High (and QUALITY=low); fails
//   past CALL_LIMIT (250).
// GPU=1 renders on the machine's GPU (Metal) for real frame times; otherwise SwiftShader.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6060', out = '/tmp/world4', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const all = ['layout', 'seats', 'reach', 'shots', 'map', 'seated', 'calls'];
const checks = wanted.length ? wanted : all;
const gpu = process.env.GPU === '1';
const args = gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chromium', args });
const floorUrl = `http://localhost:${port}/casino/src/world/dev-floor.html`;
const CALL_LIMIT = Number(process.env.CALL_LIMIT ?? 250);
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};

async function openFloor(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${floorUrl}?${query}`, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600000 });
  return { page, errors };
}

/** Hold the camera at a pose (the player stands aside). */
const camera = (page, pos, at) =>
  page.evaluate(
    ([pos, at]) => {
      const { world, engine } = window.casino;
      world.player.setEnabled(false);
      world.player.character.root.visible = false;
      window.__cam?.();
      window.__cam = engine.onFrame(() => {
        engine.camera.position.set(...pos);
        engine.camera.lookAt(...at);
      });
    },
    [pos, at],
  );

/** The most draw calls over a few frames, and the frame time. */
const settle = (page) =>
  page.evaluate(async () => {
    const { world } = window.casino;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < 4; i++) await frame();
    let calls = 0;
    const t = performance.now();
    for (let i = 0; i < 8; i++) {
      await frame();
      calls = Math.max(calls, world.stats().calls);
    }
    return { calls, ms: +((performance.now() - t) / 8).toFixed(1), room: world.rooms.current };
  });

// --- the plan, and the real geometry against it ----------------------------------------------------
if (checks.includes('layout')) {
  const { page, errors } = await openFloor('quality=high&view=overview');
  const r = await page.evaluate(async () => {
    const L = await import('/casino/src/world/layout.ts');
    const { THREE, world, engine } = window.casino;
    const plan = world.plan;
    // every room drawn, so every instance is there to measure
    world.rooms.showAll(true);
    const TOL = 0.03;
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const outside = (s, x, y, z) => {
      let o = Math.max(0, s.y0 - y, y - s.y1);
      if (s.round) o = Math.max(o, Math.hypot(x - s.x, z - s.z) - s.w / 2);
      else {
        const c = Math.cos(s.yaw);
        const sn = Math.sin(s.yaw);
        const lx = (x - s.x) * c - (z - s.z) * sn;
        const lz = (x - s.x) * sn + (z - s.z) * c;
        o = Math.max(o, Math.abs(lx) - s.w / 2, Math.abs(lz) - s.d / 2);
      }
      return o;
    };
    engine.scene.updateMatrixWorld(true);
    // every instance of the procedural furniture and of the props, against the nearest solid of its kind
    const kinds = {
      stool: /^stool-|-hightop-/,
      couch: /-couch-|-sofa-/,
      'lamp-floor': /-lamp-/,
      palm: /^palm-|-banquette-/,
      'plant-a': /^plant-/,
      'plant-b': /^plant-/,
    };
    const problems = [];
    const audit = (label, meshes, pattern, count) => {
      for (let i = 0; i < count; i++) {
        const pts = [];
        for (const mesh of meshes) {
          mesh.getMatrixAt(i, m);
          const pos = mesh.geometry.attributes.position;
          const step = Math.max(1, Math.floor(pos.count / 3000));
          for (let k = 0; k < pos.count; k += step) {
            v.fromBufferAttribute(pos, k).applyMatrix4(m).applyMatrix4(mesh.matrixWorld);
            pts.push([v.x, v.y, v.z]);
          }
        }
        if (!pts.length) continue;
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
        const cz = pts.reduce((a, p) => a + p[2], 0) / pts.length;
        const cands = plan.solids.filter((s) => pattern.test(s.id));
        let best = null;
        for (const s of cands) {
          const d = Math.hypot(s.x - cx, s.z - cz);
          if (!best || d < best.d) best = { s, d };
        }
        if (!best) {
          problems.push(`${label} #${i} has no solid in the plan`);
          continue;
        }
        const group = plan.solids.filter((s) => s.group === best.s.group);
        let worst = 0;
        let at = null;
        for (const [x, y, z] of pts) {
          const e = Math.min(...group.map((s) => outside(s, x, y, z)));
          if (e > worst) {
            worst = e;
            at = [x, y, z];
          }
        }
        if (worst > TOL) problems.push(`${label} #${i} (${best.s.group}) sticks out of its solid by ${worst.toFixed(2)} m at ${at.map((q) => q.toFixed(2)).join(',')}`);
      }
    };
    const props = engine.scene.getObjectByName('props');
    for (const g of props.children) {
      const kind = g.name?.startsWith('prop:') ? g.name.slice(5) : null;
      if (!kind || !kinds[kind]) continue;
      const meshes = g.children.filter((c) => c.isInstancedMesh);
      audit(kind, meshes, kinds[kind], meshes[0]?.count ?? 0);
    }
    // the furniture drawn in code: each kind's meshes share their instances
    const fur = engine.scene.getObjectByName('furniture');
    world.rooms.showAll(true);
    const byKind = {};
    for (const mesh of fur.children) {
      const kind = mesh.name.split(':')[1];
      (byKind[kind] ??= []).push(mesh);
    }
    const furPattern = (kind) => (['chair', 'plush', 'stool', 'velvet-stool'].includes(kind) ? /^chair-/ : kind === 'directory' ? /-directory-/ : new RegExp(`-${kind}-\\d+$`));
    for (const [kind, meshes] of Object.entries(byKind)) audit(`furniture ${kind}`, meshes, furPattern(kind), meshes[0].count);
    // stations: the model inside its footprint (in the station's own frame) and under its height
    const stations = [];
    for (const st of world.stations) {
      const inv = new THREE.Matrix4().copy(st.anchor.matrixWorld).invert();
      let ex = 0;
      let ez = 0;
      let top = 0;
      st.model.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const pos = o.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / 2000));
        const inst = o.isInstancedMesh ? o.count : 1;
        for (let i = 0; i < inst; i++) {
          if (o.isInstancedMesh) o.getMatrixAt(i, m);
          for (let k = 0; k < pos.count; k += step) {
            v.fromBufferAttribute(pos, k);
            if (o.isInstancedMesh) v.applyMatrix4(m);
            v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);
            ex = Math.max(ex, Math.abs(v.x) - st.footprint.width / 2);
            ez = Math.max(ez, Math.abs(v.z) - st.footprint.depth / 2);
            top = Math.max(top, v.y + st.anchor.position.y);
          }
        }
      });
      const h = L.STATION_H[st.zone];
      if (ex > 0.05 || ez > 0.05 || top > h) stations.push(`${st.id}: model past its footprint by ${ex.toFixed(2)} (width) ${ez.toFixed(2)} (depth), top ${top.toFixed(2)} m (allowed ${h})`);
    }
    // the staff on the floor, clear of every solid and station but their own
    const staff = [];
    for (const p of world.staff.posts) {
      for (const sol of plan.solids) {
        if (p.role === 'cashier' && sol.group === 'cashier') continue;
        if (sol.y0 >= 1.9 || (p.station && sol.of === p.station)) continue;
        if (outside({ ...sol, y0: 0, y1: 2 }, p.x, 1, p.z) < 0.24) staff.push(`${p.role}${p.station ? ` of ${p.station}` : ''} stands in ${sol.id}`);
      }
    }
    return { plan: L.checkLayout(plan), furniture: problems, stations, staff, rooms: plan.rooms.length, doors: plan.doors.length, solids: plan.solids.length };
  });
  console.log(JSON.stringify({ check: 'layout', ...r, errors: errors.slice(0, 3) }));
  for (const k of ['plan', 'furniture', 'stations', 'staff']) if (r[k].length) fail(`layout ${k}: ${r[k].slice(0, 8).join('; ')}`);
  if (errors.length) fail(`layout: ${errors[0]}`);
  await page.close();
}

// --- every seat's top, by a ray straight down ----------------------------------------------------------
if (checks.includes('seats')) {
  const { page, errors } = await openFloor('quality=high&view=overview');
  const r = await page.evaluate(async () => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    const { THREE, world, engine } = window.casino;
    world.rooms.showAll(true);
    engine.scene.updateMatrixWorld(true);
    const targets = [engine.scene.getObjectByName('props'), engine.scene.getObjectByName('furniture'), ...world.stations.map((s) => s.model)];
    for (const s of world.stations) s.model.visible = true;
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const topAt = (x, z) => {
      ray.set(new THREE.Vector3(x, 1.3, z), down);
      ray.far = 1.3;
      const hit = ray.intersectObjects(targets, true).find((h) => !h.object.isSkinnedMesh);
      return hit ? hit.point.y : null;
    };
    const pts = lifePoints(world.plan);
    const bad = [];
    for (const s of pts.seats) {
      const y = topAt(s.x, s.z);
      if (y === null || Math.abs(y - s.top) > 0.06) bad.push(`${s.id}: top ${y === null ? 'none' : y.toFixed(3)} (plan ${s.top})`);
    }
    // every table seat the plan gives a chair has one npcs measured
    const tables = [];
    for (const st of world.stations) {
      const want = world.plan.chairs.filter((c) => c.station === st.id);
      want.forEach((c) => {
        const t = st.seatTops?.[c.slot];
        if (t == null || Math.abs(t - c.top) > 0.06) tables.push(`${st.id} seat ${c.slot}: measured ${t ?? 'none'} (plan ${c.top})`);
      });
    }
    return { seats: pts.seats.length, chairs: world.plan.chairs.length, bad, tables };
  });
  console.log(JSON.stringify({ check: 'seats', seats: r.seats, chairs: r.chairs, bad: r.bad.slice(0, 10), tables: r.tables.slice(0, 10), errors: errors.slice(0, 3) }));
  if (r.bad.length) fail(`seats: ${r.bad.length} life-point seats off their furniture: ${r.bad.slice(0, 5).join('; ')}`);
  if (r.tables.length) fail(`seats: ${r.tables.length} table chairs not measured where planned: ${r.tables.slice(0, 5).join('; ')}`);
  await page.close();
}

// --- reachability on the real collider -------------------------------------------------------------------
if (checks.includes('reach')) {
  const { page, errors } = await openFloor('quality=low&view=overview');
  const r = await page.evaluate(async () => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    const { SPAWN } = await import('/casino/src/world/layout.ts');
    const { world } = window.casino;
    const col = world.collider;
    const R = world.plan.room;
    const CELL = 0.15;
    const RAD = 0.3;
    const nx = Math.ceil((R.x1 - R.x0) / CELL);
    const nz = Math.ceil((R.z1 - R.z0) / CELL);
    const free = new Uint8Array(nx * nz);
    const p = { x: 0, z: 0 };
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        p.x = R.x0 + (i + 0.5) * CELL;
        p.z = R.z0 + (j + 0.5) * CELL;
        const x = p.x;
        const z = p.z;
        col.resolve(p, RAD);
        if (Math.hypot(p.x - x, p.z - z) < 0.002) free[j * nx + i] = 1;
      }
    }
    const idx = (x, z) => {
      const i = Math.floor((x - R.x0) / CELL);
      const j = Math.floor((z - R.z0) / CELL);
      return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i;
    };
    const seen = new Uint8Array(nx * nz);
    const start = idx(SPAWN.x, SPAWN.z);
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const k = queue.pop();
      const i = k % nx;
      const j = (k - i) / nx;
      for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < nz - 1 ? k + nx : -1]) {
        if (n >= 0 && !seen[n] && free[n]) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    const near = (x, z, d) => {
      const n = Math.ceil(d / CELL);
      for (let dj = -n; dj <= n; dj++)
        for (let di = -n; di <= n; di++) {
          if (Math.hypot(di, dj) * CELL > d) continue;
          const k = idx(x + di * CELL, z + dj * CELL);
          if (k >= 0 && seen[k]) return true;
        }
      return false;
    };
    // a station is usable from a reached cell within 1.45 m of its footprint on its players' side
    const usable = (s) => {
      const a = s.anchor.position;
      const c = Math.cos(s.yaw);
      const sn = Math.sin(s.yaw);
      const hx = s.footprint.width / 2;
      const hz = s.footprint.depth / 2;
      for (let lx = -hx; lx <= hx; lx += 0.1) {
        for (let lz = hz + 0.3; lz <= hz + 1.45; lz += 0.1) {
          if (near(a.x + lx * c + lz * sn, a.z - lx * sn + lz * c, 0.01)) return true;
        }
      }
      return false;
    };
    const pts = lifePoints(world.plan);
    const stuck = [];
    for (const s of world.stations) if (!usable(s)) stuck.push(s.id);
    for (const s of pts.seats) if (!near(s.x, s.z, 1.0)) stuck.push(s.id);
    for (const w of pts.bank.windows) if (!near(w.customer.x, w.customer.z, 0.3)) stuck.push(`window ${w.customer.x}`);
    if (!near(pts.bar.pickup.x, pts.bar.pickup.z, 0.3)) stuck.push('bar pickup');
    const b = pts.boutique;
    if (b) {
      if (!near(b.customer.x, b.customer.z, 0.3)) stuck.push('boutique counter');
      for (const c of [...b.cases, ...b.mannequins]) if (!near(c.x, c.z, 0.4)) stuck.push(`boutique ${c.x},${c.z}`);
    }
    for (const route of pts.routes ?? []) for (const q of route) if (!near(q.x, q.z, 0.3)) stuck.push(`route ${q.x},${q.z}`);
    const cells = seen.reduce((a, b) => a + b, 0);
    return { reachedM2: +(cells * CELL * CELL).toFixed(0), stations: world.stations.length, seats: pts.seats.length, stuck };
  });
  console.log(JSON.stringify({ check: 'reach', ...r, errors: errors.slice(0, 3) }));
  if (r.stuck.length) fail(`reach: can't get to ${r.stuck.slice(0, 12).join(', ')}`);
  await page.close();
}

// --- every room from its doorway and from inside -----------------------------------------------------
const ROOM_SHOTS = {
  lobby: [[0, 1.7, 5.2], [0, 1.4, -9], [3.2, 1.7, -3.4], [-5, 1.5, 2.5]],
  pit: [[9, 1.9, 1.4], [-4, 0.9, -4.5], [-10, 1.8, -9.6], [8, 1.0, -5]],
  slots: [[8.2, 1.8, 1.6], [-4, 1.0, -4], [-0.4, 1.7, -9.5], [-3, 1.0, 6]],
  bar: [[-7, 1.8, 9.5], [6, 1.2, -1], [-6.5, 1.7, -9.5], [6, 1.1, 4]],
  lounge: [[0, 1.7, -5.2], [0, 0.8, 3], [5.5, 1.5, 4.5], [-3, 0.8, -1]],
  poker: [[-9, 1.8, 5.2], [2, 0.8, -1], [9, 1.8, -4.8], [-4, 0.8, 1.5]],
  salon: [[0, 1.8, 5.4], [0, 1.0, -3], [7, 1.6, 4], [-3, 1.0, -2]],
  online: [[9, 1.7, 5.3], [-2, 1.0, -1], [-9.5, 1.6, -4.8], [3, 1.0, 2]],
  yard: [[1.6, 1.8, -5.2], [0.6, 1.6, 3.8], [-6, 1.6, 5.4], [3, 1.4, -2]],
  bank: [[4.4, 1.7, 0.5], [0, 1.4, -5], [-4, 1.6, 5], [2, 1.3, -4]],
  boutique: [[-4.4, 1.7, 0.5], [3, 1.2, 0.5], [3.4, 1.6, 5.2], [-3, 1.2, -3]],
};
if (checks.includes('shots')) {
  const quality = process.env.QUALITY ?? 'high';
  const only = process.env.ROOMS?.split(',');
  const { page, errors } = await openFloor(`quality=${quality}&stats=1`);
  const centres = await page.evaluate(() => Object.fromEntries(window.casino.world.plan.rooms.map((r) => [r.id, [r.cx, r.cz]])));
  for (const [room, [p1, a1, p2, a2]] of Object.entries(ROOM_SHOTS)) {
    if (only && !only.includes(room)) continue;
    const [cx, cz] = centres[room];
    for (const [tag, pos, at] of [
      ['door', p1, a1],
      ['inside', p2, a2],
    ]) {
      await camera(page, [cx + pos[0], pos[1], cz + pos[2]], [cx + at[0], at[1], cz + at[2]]);
      const s = await settle(page);
      const file = `${out}/world4-${room}-${tag}-${quality}.png`;
      await page.screenshot({ path: file });
      console.log(JSON.stringify({ check: 'shot', room, tag, file, ...s }));
      if (s.calls > CALL_LIMIT) fail(`${room}/${tag}: ${s.calls} draw calls`);
    }
  }
  if (errors.length) fail(`shots: ${errors[0]}`);
  await page.close();
}

// --- the map --------------------------------------------------------------------------------------------
if (checks.includes('map')) {
  const { page, errors } = await openFloor('quality=high');
  await page.evaluate(() => {
    window.casino.world.teleport(0, 1.5, Math.PI);
    document.body.focus();
  });
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyN');
  await page.waitForSelector('.map-sheet', { timeout: 5000 }).catch(() => null);
  const opened = await page.evaluate(() => !!document.querySelector('.map-sheet'));
  // pick the salon on the map
  const picked = await page.evaluate(() => {
    const rect = [...document.querySelectorAll('.map-room')][window.casino.world.plan.rooms.findIndex((r) => r.id === 'salon')];
    rect?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return document.querySelector('.map-name')?.textContent ?? null;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/world4-map.png` });
  const where = await page.evaluate(() => document.querySelector('.map-sheet .sheet-sub')?.textContent ?? '');
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => !document.querySelector('.map-sheet'));
  console.log(JSON.stringify({ check: 'map', opened, picked, where, closed, errors: errors.slice(0, 3) }));
  if (!opened) fail('map: N did not open the map');
  if (picked !== 'High Limit Salon') fail(`map: clicking the salon picked ${picked}`);
  if (!/The Pit/.test(where)) fail(`map: says "${where}" standing in the pit`);
  if (!closed) fail('map: N did not close it');
  // at a table, N is the table's (blackjack's "no insurance"): the map stays shut
  await page.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === 'bj-1'));
  });
  await page.waitForTimeout(1200);
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => !!document.querySelector('.map-sheet'))) fail('map: opened at a table');
  if (errors.length) fail(`map: ${errors[0]}`);
  await page.close();
}

// --- seated at an online desk and at the Bandit Wheel ----------------------------------------------------
if (checks.includes('seated')) {
  for (const [id, seat] of [
    ['pk-1', null],
    ['bw-1', 0],
    ['vip-bj-1', 3],
  ]) {
    const { page, errors } = await openFloor('quality=high&stats=1');
    await page.evaluate(
      ([id, seat]) => {
        const w = window.casino.world;
        const s = w.stations.find((x) => x.id === id);
        const a = s.anchor.position;
        w.teleport(a.x + Math.sin(s.yaw) * 2, a.z + Math.cos(s.yaw) * 2, s.yaw + Math.PI);
        w.enter(s, seat);
      },
      [id, seat],
    );
    await page.waitForTimeout(2200);
    const s = await settle(page);
    const file = `${out}/world4-seated-${id}.png`;
    await page.screenshot({ path: file });
    console.log(JSON.stringify({ check: 'seated', id, file, ...s, errors: errors.slice(0, 3) }));
    if (s.calls > CALL_LIMIT) fail(`seated ${id}: ${s.calls} draw calls`);
    await page.close();
  }
}

// --- draw calls everywhere ---------------------------------------------------------------------------------
if (checks.includes('calls')) {
  for (const quality of process.env.QUALITY ? [process.env.QUALITY] : ['high', 'low']) {
    const { page, errors } = await openFloor(`quality=${quality}`);
    const res = await page.evaluate(async () => {
      const { world, engine } = window.casino;
      world.player.setEnabled(false);
      world.player.character.root.visible = false;
      const p = world.plan;
      const poses = [];
      for (const r of p.rooms) {
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4;
          poses.push([`${r.id}@${k * 45}`, [r.cx, 1.7, r.cz], [r.cx + Math.sin(a) * 10, 1.1, r.cz - Math.cos(a) * 10]]);
        }
      }
      for (const d of p.doors) {
        if (d.b === 'outside') continue;
        const m = (d.a0 + d.a1) / 2;
        for (const s of [-1, 1]) {
          const [x, z] = d.axis === 'x' ? [m, d.c + s * 2.2] : [d.c + s * 2.2, m];
          const [tx, tz] = d.axis === 'x' ? [m, d.c - s * 8] : [d.c - s * 8, m];
          poses.push([`${d.id}${s > 0 ? '+' : '-'}`, [x, 1.7, z], [tx, 1.1, tz]]);
        }
      }
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const out = [];
      let pose = poses[0];
      engine.onFrame(() => {
        engine.camera.position.set(...pose[1]);
        engine.camera.lookAt(...pose[2]);
      });
      for (const q of poses) {
        pose = q;
        for (let i = 0; i < 3; i++) await frame();
        let max = 0;
        const t = performance.now();
        for (let i = 0; i < 6; i++) {
          await frame();
          max = Math.max(max, world.stats().calls);
        }
        out.push([q[0], max, +((performance.now() - t) / 6).toFixed(1)]);
      }
      return out;
    });
    res.sort((a, b) => b[1] - a[1]);
    const slow = [...res].sort((a, b) => b[2] - a[2]);
    console.log(JSON.stringify({ check: 'calls', quality, poses: res.length, worst: res.slice(0, 6), slowest: slow.slice(0, 4), errors: errors.slice(0, 3) }));
    const over = res.filter(([, c]) => c > CALL_LIMIT);
    if (over.length) fail(`calls/${quality} over ${CALL_LIMIT}: ${over.map(([n, c]) => `${n} ${c}`).join(', ')}`);
    await page.close();
  }
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
