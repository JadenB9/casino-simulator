#!/usr/bin/env node
// Headless checks for the floor staff (client/src/world/npcs.ts): every table with its dealer from
// where its players stand, the seated views (the dealer must frame the table, not block it), the
// bar and the cashier, a dealer's deal/sweep/pay, and draw calls in the dev views. Vite only.
// Usage: node scripts/e2e/npcs.mjs [port] [out dir] [checks...]
//   checks: tables seated staff gestures sitting calls (default: all)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5940', out = '/tmp/npcs', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const checks = wanted.length ? wanted : ['tables', 'seated', 'staff', 'gestures', 'sitting', 'calls'];
const quality = process.env.QUALITY ?? 'high';
const base = `http://localhost:${port}/casino/src/world/dev-floor.html`;
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  // software rendering on a busy machine: a frame can take seconds
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(`${m.text()} ${m.location()?.url ?? ''}`.trim()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${base}?${query}`, { timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300000 });
  // a camera the script places (the dev floor's own fixed views are replaced)
  await page.evaluate(() => {
    const c = window.casino;
    c.world.player.setEnabled(false);
    c.world.player.character.root.visible = false;
    c.shot = null;
    c.engine.onFrame(() => {
      if (!c.shot) return;
      c.engine.camera.position.set(...c.shot.pos);
      c.engine.camera.lookAt(...c.shot.at);
    });
  });
  return { page, errors };
}

const place = (page, pos, at) => page.evaluate(([p, a]) => (window.casino.shot = { pos: p, at: a }), [pos, at]);
/** Wait, then let a few frames through: a busy machine can take a second over one frame, and the
 * script's camera is placed after the world's update, so the staff see it a frame late. */
async function settle(page, ms = 900) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => new Promise((r) => {
    let n = 0;
    const f = () => (++n >= 3 ? r() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }));
}

/** The staff's posts, and where each table's players stand to look at its dealer. */
const posts = (page) =>
  page.evaluate(() => {
    const w = window.casino.world;
    return w.staff.posts.map((p) => {
      const s = w.stations.find((x) => x.id === p.station);
      return { ...p, sx: s?.anchor.position.x ?? null, sz: s?.anchor.position.z ?? null, syaw: s?.yaw ?? null, depth: s?.footprint.depth ?? null, game: s?.game ?? null };
    });
  });

if (checks.includes('tables')) {
  const { page, errors } = await open(`quality=${quality}&view=overview`);
  for (const p of await posts(page)) {
    if (!p.station) continue;
    // from the players' side, 2.4 m out from the table's centre, eyes at 1.62 m, on the dealer
    const fx = Math.sin(p.syaw);
    const fz = Math.cos(p.syaw);
    const d = p.depth / 2 + 1.9;
    await place(page, [p.sx + fx * d, 1.62, p.sz + fz * d], [p.x, 1.05, p.z]);
    await settle(page);
    await page.screenshot({ path: `${out}/table-${p.station}.png` });
  }
  if (errors.length) fail(`tables: ${errors.join(' | ')}`);
  await page.close();
}

if (checks.includes('seated')) {
  // no fixed view: the dev floor's own camera would pin itself over the fly-in every frame
  const { page, errors } = await open(`quality=${quality}`);
  const seats = { 'bj-1': [0, 3, 6], 'rl-us': [null], 'cr-1': [0, 5], 'bc-1': [0, 6], 'tc-1': [0, 5], 'wr-1': [2], 'sb-1': [null], 'b6-1': [null], 'he-1': [null] };
  for (const [id, list] of Object.entries(seats)) {
    for (const seat of list) {
      await page.evaluate(async ([id, seat]) => {
        const c = window.casino;
        c.shot = null;
        const s = c.world.stations.find((x) => x.id === id);
        const { playPoseWorld } = await import('/casino/src/world/stations.ts');
        c.goal = playPoseWorld(s, seat).position;
        c.world.enter(s, seat);
      }, [id, seat]);
      // the fly-in is 0.9 s of frames, however long those frames take here
      await page.waitForFunction(() => window.casino.engine.camera.position.distanceTo(window.casino.goal) < 0.01, null, { polling: 250 });
      await settle(page, 1200);
      await page.screenshot({ path: `${out}/seated-${id}-${seat ?? 'x'}.png` });
      await page.evaluate(() => window.casino.world.exitTable());
      await page.waitForFunction(() => !window.casino.world.seated && window.casino.world.player.character.root.visible, null, { polling: 250 });
      await settle(page, 300);
    }
  }
  if (errors.length) fail(`seated: ${errors.join(' | ')}`);
  await page.close();
}

if (checks.includes('staff')) {
  const { page, errors } = await open(`quality=${quality}&view=overview`);
  const plan = await page.evaluate(() => {
    const p = window.casino.world.plan;
    return { bar: p.bar, cashier: p.cashier };
  });
  const bz = (plan.bar.stools[0] + plan.bar.stools[plan.bar.stools.length - 1]) / 2;
  await place(page, [plan.bar.front - 2.6, 1.6, bz + 1.2], [plan.bar.front + 1.2, 1.25, bz]);
  await settle(page, 1200);
  await page.screenshot({ path: `${out}/staff-bar.png` });
  await place(page, [plan.cashier.x + 1.2, 1.62, plan.cashier.z + 1.4], [plan.cashier.x + 1.0, 1.35, plan.cashier.counter.z1 - 0.9]);
  await settle(page, 1200);
  await page.screenshot({ path: `${out}/staff-cashier.png` });
  // down the pit's staff area from its east end: the two rows' dealers back to back
  const staff = await page.evaluate(() => window.casino.world.plan.staff);
  const mid = (staff.z0 + staff.z1) / 2;
  await place(page, [staff.x1 + 1.2, 2.2, mid + 0.4], [staff.x1 - 6, 1.0, mid]);
  await settle(page, 1200);
  await page.screenshot({ path: `${out}/staff-pit.png` });
  const looks = await page.evaluate(() => window.casino.world.staff.posts.length);
  console.log(`staff: ${looks} posts`);
  if (errors.length) fail(`staff: ${errors.join(' | ')}`);
  await page.close();
}

if (checks.includes('gestures')) {
  const { page, errors } = await open(`quality=${quality}&view=overview`);
  const p = (await posts(page)).find((x) => x.station === 'bj-1');
  const fx = Math.sin(p.syaw);
  const fz = Math.cos(p.syaw);
  await place(page, [p.sx + fx * 1.5 + 0.9, 1.55, p.sz + fz * 1.5], [p.x, 1.0, p.z]);
  for (const g of ['deal', 'sweep', 'pay']) {
    await page.evaluate((g) => window.casino.world.dealerGesture('bj-1', g), g);
    await settle(page, g === 'sweep' ? 650 : 520);
    await page.screenshot({ path: `${out}/gesture-${g}.png` });
    await settle(page, 1200);
  }
  const none = await page.evaluate(() => window.casino.world.dealerGesture('slots-sevens-1', 'deal'));
  if (none) fail('a slot machine has a dealer');
  if (errors.length) fail(`gestures: ${errors.join(' | ')}`);
  await page.close();
}

if (checks.includes('sitting')) {
  // Two other players at Hold'em, drawn by the real RemotePlayers from a stand-in floor link. The
  // chairs are stand-ins too (tables3 builds the real ones at the same seats), added to the
  // table's model before the seats are measured again, as createWorld measures them.
  const { page, errors } = await open(`quality=${quality}`);
  const info = await page.evaluate(async () => {
    const c = window.casino;
    const THREE = c.THREE;
    const { GAMES } = await import('/casino/src/games/index.ts');
    const { measureSeats } = await import('/casino/src/world/npcs.ts');
    const { seatWorld } = await import('/casino/src/world/stations.ts');
    const { RemotePlayers } = await import('/casino/src/world/remote-players.ts');
    const st = c.world.stations.find((x) => x.id === 'he-1');
    const leather = new THREE.MeshStandardMaterial({ color: 0x3a1c14, roughness: 0.6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.3, metalness: 0.8 });
    for (const seat of GAMES.holdem.seats('')) {
      const chair = new THREE.Group();
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.44), leather);
      cushion.position.y = 0.44;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.07), leather);
      back.position.set(0, 0.7, -0.22);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10), chrome);
      post.position.y = 0.2;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.03, 20), chrome);
      foot.position.y = 0.015;
      chair.add(cushion, back, post, foot);
      chair.position.set(...seat.position);
      chair.rotation.y = seat.yaw;
      st.model.add(chair);
    }
    measureSeats([st], (s) => GAMES[s.game].seats(s.variant));
    const look = (body, outfit, skin, hair, top, bottom) => ({ v: 1, body, outfit, skin, hair, top, bottom, shoes: '#1a1a1a' });
    const players = new Map([
      [101, { info: { id: 101, name: 'Marisol', look: look('f', 'dress', 3, '#2b1a12', '#7a1f3d', '#7a1f3d'), at: { station: 'he-1' } }, track: { at: () => ({ x: 0, z: 0, r: 0, moving: false }) }, last: null }],
      [102, { info: { id: 102, name: 'Dev', look: look('m', 'casual', 1, '#4a3020', '#2f5d7c', '#2a3140'), at: { station: 'he-1' } }, track: { at: () => ({ x: 0, z: 0, r: 0, moving: false }) }, last: null }],
    ]);
    const link = { players, on: () => () => {} };
    for (const p of players.values()) await c.world.characterFactory.load(p.info.look);
    const remotes = new RemotePlayers(link, c.engine.scene, { factory: c.world.characterFactory, seatOf: (id, slot) => seatWorld(c.world.stations.find((x) => x.id === id), slot) });
    c.engine.onFrame((dt) => remotes.update(dt));
    return { tops: st.seatTops, seat0: seatWorld(st, 0), seat1: seatWorld(st, 1) };
  });
  console.log(`sitting: seat tops ${info.tops.map((t) => (t === null ? '-' : t.toFixed(2))).join(' ')}; seat 0 sit ${info.seat0.sit}`);
  if (!info.tops.every((t) => t !== null && Math.abs(t - 0.48) < 0.02)) fail('sitting: chair tops not measured at 0.48 m');
  const st = await page.evaluate(() => {
    const s = window.casino.world.stations.find((x) => x.id === 'he-1');
    return { x: s.anchor.position.x, z: s.anchor.position.z };
  });
  await place(page, [st.x - 2.3, 1.75, st.z + 2.6], [st.x - 0.2, 0.7, st.z + 0.1]);
  await settle(page, 1500);
  await page.screenshot({ path: `${out}/sitting-holdem.png` });
  await place(page, [st.x - 2.6, 1.0, st.z + 0.9], [st.x - 0.9, 0.62, st.z + 0.55]);
  await settle(page, 1200);
  await page.screenshot({ path: `${out}/sitting-holdem-side.png` });
  if (errors.length) fail(`sitting: ${errors.join(' | ')}`);
  await page.close();
}

if (checks.includes('calls')) {
  for (const q of ['high', 'low']) {
    const lines = [];
    for (const view of ['overview', 'slots', 'pit', 'cashier', 'bar', 'poker', 'lounge', 'bigsix']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(300000);
      await page.goto(`${base}?quality=${q}&view=${view}`, { timeout: 180000 });
      await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300000 });
      await page.waitForTimeout(1500);
      const s = await page.evaluate(async () => {
        const c = window.casino;
        let calls = 0;
        const t0 = performance.now();
        await new Promise((r) => {
          const tick = () => {
            calls = Math.max(calls, c.world.stats().calls);
            if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
            else r();
          };
          requestAnimationFrame(tick);
        });
        const shown = c.world.staff.group.children.filter((o) => o.name === 'character' && o.visible).length;
        return { calls, shown };
      });
      lines.push(`${view} ${s.calls} calls (${s.shown} staff drawn)`);
      if (s.calls > 250) fail(`${q} ${view}: ${s.calls} draw calls`);
      await page.close();
    }
    console.log(`${q}: ${lines.join(' · ')}`);
  }
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all npcs checks passed');
process.exit(failed ? 1 : 0);
