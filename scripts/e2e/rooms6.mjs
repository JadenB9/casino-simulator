#!/usr/bin/env node
// Headless walk-through of the north wing (the dev floor, Vite only). Usage:
//   node scripts/e2e/rooms6.mjs [port] [out dir] [checks...]
//   checks: walk prompts seats sit shots calls (default: all)
// walk: from the spawn, the player walks (W held, the camera turned along an A* path over the
//   plan's walkable floor) through the pit and the rooms below into the Pachinko Parlour, the Jade
//   Room and the Bingo Hall, and across the wing through its side doors; every leg must arrive in
//   the real collider, and the rooms passed through are logged.
// prompts: walks up to every new station from its players' side and checks "Press E" names it
//   (each pachinko machine in its row, both card games, the bingo hall from the back and both
//   sides, the four new online desks), and to the wing's benches and armchairs ("Sit").
// seats: a ray down at every new table's chairs and stools finds a seat top (npcs' 0.3-0.95 m),
//   and every dealer post (the card tables' dealers, the bingo caller on the stage) stands clear.
// sit: E at a pachinko machine, a Let It Ride table and the bingo hall; the camera flies to the
//   game's play pose (sit-*.png).
// shots: each new room from its doors and from inside, the lounge's new desks (rooms6-*.png).
// calls: draw calls turning round in each new room and looking in through each new door, High and
//   Low; fails past CALL_LIMIT (250).
// GPU=1 renders on the machine's GPU (Metal); otherwise SwiftShader.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6330', out = '/tmp/rooms6', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const all = ['walk', 'prompts', 'seats', 'sit', 'shots', 'calls'];
const checks = wanted.length ? wanted : all;
const gpu = process.env.GPU === '1';
const args = gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chromium', args });
const floorUrl = `http://localhost:${port}/casino/src/world/dev-floor.html`;
const CALL_LIMIT = Number(process.env.CALL_LIMIT ?? 250);
const WING = ['parlour', 'cardroom', 'bingo'];
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};

async function openFloor(query, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${floorUrl}?${query}`, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600000 });
  return { page, errors };
}

/** Hold the camera at a pose in a room's own metres (the player stands aside). */
async function camera(page, room, pos, at, fov = 60) {
  await page.evaluate(
    ([room, pos, at, fov]) => {
      const { world, engine } = window.casino;
      const r = world.plan.rooms.find((q) => q.id === room);
      const P = [r.cx + pos[0], pos[1], r.cz + pos[2]];
      const A = [r.cx + at[0], at[1], r.cz + at[2]];
      world.player.setEnabled(false);
      world.player.character.root.visible = false;
      window.__cam?.();
      window.__cam = engine.onFrame(() => {
        engine.camera.fov = fov;
        engine.camera.updateProjectionMatrix();
        engine.camera.position.set(...P);
        engine.camera.lookAt(...A);
      });
    },
    [room, pos, at, fov],
  );
  await page.waitForTimeout(1200);
}

// --- walk: the real player, the real collider, through every door of the wing ----------------------
if (checks.includes('walk')) {
  const { page, errors } = await openFloor('quality=low');
  // waypoints (room, local x, z): up through the online lounge into the parlour, across the wing,
  // back down through the poker room; then up through the salon into the Jade Room
  const legs = [
    ['online', 0, 3.5],
    ['parlour', 0, 3.6],
    ['parlour', -6.5, 1.0],
    ['parlour', 9.0, 0],
    ['cardroom', 0, 0.2],
    ['bingo', -8.0, 0.2],
    ['bingo', 0, 3.4],
    ['poker', 0, -3.6],
    ['salon', 7.5, 1.4],
    ['cardroom', 7.3, 3.2],
  ];
  const r = await page.evaluate(async (legs) => {
    const { walkGrid } = await import('/casino/src/world/reach.ts');
    const { NavGrid, NAV_CELL } = await import('/casino/src/world/life/nav.ts');
    const { world } = window.casino;
    const plan = world.plan;
    const player = world.life.seating.player;
    const grid = NavGrid.fromWalk(walkGrid(plan, { radius: 0.36, cell: NAV_CELL }));
    const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, key: 'w', bubbles: true }));
    const out = { legs: [], rooms: [] };
    const room = () => plan.rooms.find((q) => { const b = q.bounds; const p = player.position; return p.x >= b.x0 && p.x < b.x1 && p.z >= b.z0 && p.z < b.z1; })?.id ?? '?';
    world.player.setEnabled(true);
    for (const [id, lx, lz] of legs) {
      const r = plan.rooms.find((q) => q.id === id);
      const to = { x: r.cx + lx, z: r.cz + lz };
      const from = { x: player.position.x, z: player.position.z };
      const path = grid.path(from, to);
      if (!path) {
        out.legs.push({ to: `${id} ${lx},${lz}`, ok: false, why: 'no path' });
        continue;
      }
      const t0 = performance.now();
      let ok = true;
      key('keydown', 'KeyW');
      for (const p of path) {
        let best = Infinity;
        let stuck = 0;
        while (Math.hypot(p.x - player.position.x, p.z - player.position.z) > 0.35) {
          player.camYaw = Math.atan2(p.x - player.position.x, p.z - player.position.z) + Math.PI;
          await frame();
          const d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
          if (d < best - 0.01) {
            best = d;
            stuck = 0;
          } else if (++stuck > 90) {
            ok = false;
            break;
          }
          const here = room();
          if (out.rooms[out.rooms.length - 1] !== here) out.rooms.push(here);
        }
        if (!ok) break;
      }
      key('keyup', 'KeyW');
      await frame();
      const d = Math.hypot(to.x - player.position.x, to.z - player.position.z);
      out.legs.push({ to: `${id} ${lx},${lz}`, ok: ok && d < 0.6, at: [+player.position.x.toFixed(2), +player.position.z.toFixed(2)], s: +((performance.now() - t0) / 1000).toFixed(1) });
    }
    return out;
  }, legs);
  for (const l of r.legs) if (!l.ok) fail(`walk to ${l.to}: ${l.why ?? `stopped at ${l.at}`}`);
  for (const w of WING) if (!r.rooms.includes(w)) fail(`walk never entered ${w}`);
  if (errors.length) fail(`walk errors: ${errors.slice(0, 3).join(' | ')}`);
  console.log(JSON.stringify({ check: 'walk', legs: r.legs.length, arrived: r.legs.filter((l) => l.ok).length, rooms: r.rooms }));
  await page.close();
}

// --- prompts: every new station, and somewhere to sit, from where a player would stand -------------
if (checks.includes('prompts')) {
  const { page } = await openFloor('quality=low');
  const r = await page.evaluate(async (WING) => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    const { world } = window.casino;
    const plan = world.plan;
    const pts = lifePoints(plan);
    const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const prompt = () => {
      const e = document.querySelector('.world-prompt');
      return e && !e.hidden ? e.textContent : '';
    };
    const player = world.life.seating.player;
    world.player.setEnabled(true);
    const out = [];
    const want = async (what, re, x, z, face) => {
      world.teleport(x, z, face);
      player.camYaw = face + Math.PI;
      await frame();
      await frame();
      const got = prompt();
      out.push({ what, ok: re.test(got), got });
    };
    const fresh = ['pachinko', 'letitride', 'paigow', 'coinflip', 'wheel', 'cases', 'diamonds'];
    for (const s of world.stations.filter((q) => fresh.includes(q.game))) {
      // on the players' side, a step back from the front edge, facing it
      const d = s.footprint.depth / 2 + (s.game === 'pachinko' ? 0.62 : 0.8);
      await want(s.id, new RegExp(s.name), s.anchor.position.x + Math.sin(s.yaw) * d, s.anchor.position.z + Math.cos(s.yaw) * d, s.yaw + Math.PI);
    }
    // the bingo hall: from behind its back row, and from either side of its tables
    const bg = world.stations.find((q) => q.game === 'bingo');
    if (bg) {
      const a = bg.anchor.position;
      const { width: w, depth: dp } = bg.footprint;
      await want('bingo from the back', /Bingo/, a.x, a.z + dp / 2 + 0.8, Math.PI);
      await want('bingo from the back, off to one side', /Bingo/, a.x + 1.6, a.z + dp / 2 + 0.9, Math.PI);
      await want('bingo from the west', /Bingo/, a.x - w / 2 - 0.8, a.z + 1.5, Math.PI / 2);
      await want('bingo from the east', /Bingo/, a.x + w / 2 + 0.8, a.z + 1.5, -Math.PI / 2);
    }
    // the wing's places to sit
    for (const s of pts.seats.filter((q) => WING.includes(q.room) && !q.station)) {
      await want(`seat ${s.id}`, /Sit/, s.x + Math.sin(s.yaw) * 0.9, s.z + Math.cos(s.yaw) * 0.9, s.yaw + Math.PI);
    }
    return out;
  }, WING);
  for (const x of r) if (!x.ok) fail(`prompt at ${x.what}: "${x.got}"`);
  console.log(`prompts: ${r.filter((x) => x.ok).length}/${r.length} spots offer the right thing`);
  await page.close();
}

// --- seats: chairs and stools where the games' seats are, dealers clear -----------------------------
if (checks.includes('seats')) {
  const { page } = await openFloor('quality=low');
  const r = await page.evaluate((WING) => {
    const { world } = window.casino;
    const bad = [];
    let n = 0;
    for (const s of world.stations.filter((q) => WING.includes(q.room))) {
      for (const [i, top] of (s.seatTops ?? []).entries()) {
        n++;
        if (top === null) bad.push(`${s.id} seat ${i + 1}: no seat under it`);
      }
    }
    const posts = world.staff.posts.filter((p) => p.station && WING.includes(p.room));
    const hard = world.plan.solids.filter((q) => !q.of);
    for (const p of posts) {
      for (const q of hard) {
        const inside = q.round ? Math.hypot(p.x - q.x, p.z - q.z) < q.w / 2 : Math.abs(p.x - q.x) < q.w / 2 && Math.abs(p.z - q.z) < q.d / 2 && q.yaw === 0;
        if (inside && q.y0 < 1.6 && q.y1 > (p.y ?? 0) + 0.2) bad.push(`${p.station}'s ${p.role} stands in ${q.id}`);
      }
    }
    const caller = posts.find((p) => world.stations.find((q) => q.id === p.station)?.game === 'bingo');
    return { seats: n, bad, posts: posts.length, caller: caller ? { y: caller.y ?? 0 } : null };
  }, WING);
  for (const b of r.bad) fail(`seats: ${b}`);
  if (!r.caller || r.caller.y < 0.2) fail('seats: the bingo caller is not up on the stage');
  console.log(JSON.stringify({ check: 'seats', ...r }));
  await page.close();
}

// --- sit: E at a machine, a card table and the hall -------------------------------------------------
if (checks.includes('sit')) {
  const { page, errors } = await openFloor(`quality=${gpu ? 'high' : 'low'}`);
  for (const id of ['pa-1', 'lr-1', 'pg-1', 'bg-1', 'cf-1']) {
    const r = await page.evaluate(async (id) => {
      const { world, engine } = window.casino;
      const s = world.stations.find((q) => q.id === id);
      if (!s) return { id, missing: true };
      world.enter(s, 0);
      await new Promise((res) => setTimeout(res, 1600));
      const p = engine.camera.position;
      return { id, seated: world.seated?.id ?? null, cam: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], room: world.rooms.current };
    }, id);
    await page.screenshot({ path: `${out}/sit-${id}.png` });
    if (r.missing) fail(`sit: no station ${id}`);
    else if (r.seated !== id) fail(`sit: E at ${id} didn't sit`);
    console.log(JSON.stringify({ check: 'sit', ...r }));
    await page.evaluate(() => window.casino.world.exitTable());
    await page.waitForTimeout(1200);
  }
  if (errors.length) fail(`sit errors: ${errors.slice(0, 3).join(' | ')}`);
  await page.close();
}

// --- shots: each new room, from its doors and inside -------------------------------------------------
if (checks.includes('shots')) {
  const { page } = await openFloor(`quality=${gpu ? 'high' : 'low'}`);
  const views = [
    ['parlour-door', 'parlour', [0, 1.7, 5.4], [0, 1.3, -3]],
    ['parlour-aisle', 'parlour', [0, 1.65, 2.2], [0, 1.4, -5.8]],
    ['parlour-island', 'parlour', [0.9, 1.6, -0.5], [4.0, 1.25, -0.5]],
    ['parlour-prizes', 'parlour', [-6, 1.6, 1.5], [-10, 1.2, -1.5]],
    ['parlour-rest', 'parlour', [4.5, 1.7, 2.5], [9.5, 1.1, -2.5]],
    ['cardroom-door', 'cardroom', [7.3, 1.8, 5.3], [-1, 1.0, -2]],
    ['cardroom-gate', 'cardroom', [0, 1.6, 2.0], [0, 1.7, -5.8]],
    ['cardroom-west', 'cardroom', [-2, 1.7, -0.2], [-8.8, 1.4, -3.5]],
    ['bingo-door', 'bingo', [0, 1.9, 5.3], [0, 1.4, -3]],
    ['bingo-snack', 'bingo', [-4, 1.8, 3], [9, 1.2, -1]],
    ['bingo-boards', 'bingo', [4, 1.8, 2], [-11, 1.8, -3]],
    ['online-new-desks', 'online', [9, 1.7, 5.3], [3, 1.0, -1]],
  ];
  for (const [name, room, pos, at] of views) {
    await camera(page, room, pos, at);
    await page.screenshot({ path: `${out}/rooms6-${name}.png` });
  }
  console.log(JSON.stringify({ check: 'shots', count: views.length, dir: out }));
  await page.close();
}

// --- calls: turning round in each new room, looking in through each new door -------------------------
if (checks.includes('calls')) {
  for (const quality of ['high', 'low']) {
    const { page } = await openFloor(`quality=${quality}`);
    const r = await page.evaluate(async (WING) => {
      const { world, engine } = window.casino;
      const plan = world.plan;
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      world.player.setEnabled(false);
      world.player.character.root.visible = false;
      let pose = null;
      const stop = engine.onFrame(() => {
        if (!pose) return;
        engine.camera.position.set(...pose.p);
        engine.camera.lookAt(...pose.t);
      });
      const out = [];
      const measure = async (name, p, t) => {
        pose = { p, t };
        for (let i = 0; i < 12; i++) await frame();
        out.push([name, world.stats().calls]);
      };
      for (const id of WING) {
        const r = plan.rooms.find((q) => q.id === id);
        for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
          const a = (deg * Math.PI) / 180;
          await measure(`${id}@${deg}`, [r.cx, 1.7, r.cz + 2], [r.cx + Math.sin(a) * 5, 1.4, r.cz + 2 + Math.cos(a) * 5]);
        }
      }
      for (const d of plan.doors.filter((q) => WING.includes(q.a) || WING.includes(q.b))) {
        const m = (d.a0 + d.a1) / 2;
        for (const s of [-1, 1]) {
          const [x, z] = d.axis === 'x' ? [m, d.c + s * 3] : [d.c + s * 3, m];
          const [tx, tz] = d.axis === 'x' ? [m, d.c - s * 6] : [d.c - s * 6, m];
          await measure(`${d.id}${s > 0 ? '+' : '-'}`, [x, 1.7, z], [tx, 1.3, tz]);
        }
      }
      stop();
      return out.sort((a, b) => b[1] - a[1]);
    }, WING);
    const over = r.filter(([, c]) => c > CALL_LIMIT);
    for (const [name, c] of over) fail(`calls ${quality} ${name}: ${c} > ${CALL_LIMIT}`);
    console.log(JSON.stringify({ check: 'calls', quality, poses: r.length, worst: r.slice(0, 6) }));
    await page.close();
  }
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
