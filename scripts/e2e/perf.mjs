#!/usr/bin/env node
// Frame times on the real GPU: opens a visible Chrome window (1440x900 at 2x, like a MacBook
// screen), logs in and measures the real game (app/boot.ts) with its staff, waiters and other
// players on the floor, in High and then Low graphics.
//
// Usage: node scripts/e2e/perf.mjs [port] [outDir] [checks...] [--bots N] [--crowd] [--uncapped]
//   flow    the menu's pass, the entrance, walking in, the pit and the slots, seated at roulette
//           and a spin (the original run)
//   sweep   every room from its middle turning round (8 ways) and every doorway from both sides
//           looking through: frame rate, p95 frame time, the frame's own CPU time, draw calls,
//           triangles and how many other players are drawn; fails past 250 calls on High
//   mobile  a mid phone (412x915 at 1.5x, touch, the CPU slowed 4x) on Low: the busiest rooms
//   (default: flow sweep mobile)
// --bots N    other players (Node sockets, perf-bots.mjs): walking, sitting on seats, at tables,
//             emoting; spread over the rooms (default 24; 0 for none)
// --crowd     put every bot in the lobby instead (everyone arrives there)
// --uncapped  no vsync or frame-rate cap, so the frame rate shows the headroom past 60/120
// --only high|low  one quality for flow and sweep
// The worker must be the dev stack's (PORT_BASE + 1); bots log in as perfbot00.. with the dev password.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startBots } from './perf-bots.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--bots', '--only'].includes(argv[i - 1]));
const [port = '5173', out = '/tmp/casino-perf', ...wanted] = positional;
const checks = wanted.length ? wanted : ['flow', 'sweep', 'mobile'];
const botCount = Number(opt('bots', 24));
const qualities = opt('only', null) ? [opt('only')] : ['high', 'low'];
const CALL_LIMIT = Number(process.env.CALL_LIMIT ?? 250);
mkdirSync(out, { recursive: true });

const chromeArgs = ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];
if (flag('uncapped')) chromeArgs.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
const browser = await chromium.launch({ headless: false, args: chromeArgs });
const results = [];
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};

function watch(page) {
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  return errors;
}

/** Log in as `name` and walk in through the menu; resolves on the floor with the HUD up. */
async function enter(page, name) {
  await page.goto(`http://localhost:${port}/casino/`);
  await page.waitForSelector('.name-input', { timeout: 120_000 });
  await page.fill('.name-input', name);
  await page.fill('.pass-input', 'casino-dev'); // DEV_PASSWORD in client/src/net/api.ts
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item, .editor-panel', { timeout: 30_000 });
  if (!(await page.$('.menu-item'))) {
    // a new name picks a look first
    await page.waitForTimeout(2500);
    for (let k = 0; k < 10 && !(await page.$('.hud')); k++) {
      const next = await page.$('.editor-panel .ed-buttons .btn.primary');
      if (next) await next.click();
      await page.waitForTimeout(700);
    }
  }
}

// Timing inside the page: every frame's interval (requestAnimationFrame to requestAnimationFrame)
// and the frame's own work (Engine3D.tick: the world, the views, the render and the labels).
const INSTRUMENT = () => {
  const c = window.casino;
  if (c.__perf) return;
  const engine = c.engine;
  const tick = engine.tick.bind(engine);
  const perf = { cpu: [], at: [], on: false };
  engine.tick = (t) => {
    const a = performance.now();
    tick(t);
    if (perf.on) {
      perf.cpu.push(performance.now() - a);
      perf.at.push(a);
    }
  };
  c.__perf = perf;
};

async function sample(page, label, ms = 3000, extra = {}) {
  await page.evaluate(INSTRUMENT);
  const r = await page.evaluate(async (ms) => {
    const { __perf: perf, world, app } = window.casino;
    perf.cpu.length = 0;
    perf.at.length = 0;
    perf.on = true;
    let calls = 0;
    let tris = 0;
    const off = window.casino.engine.onFrame(() => {
      const s = world.stats();
      calls = Math.max(calls, s.calls);
      tris = Math.max(tris, s.triangles);
    });
    await new Promise((res) => setTimeout(res, ms));
    perf.on = false;
    off();
    const gaps = perf.at.slice(1).map((t, i) => t - perf.at[i]).sort((a, b) => a - b);
    const cpu = [...perf.cpu].sort((a, b) => a - b);
    const avg = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
    const remotes = app?.remotes ? [...app.remotes.group.children].filter((o) => o.visible).length : 0;
    const q = (a, k) => a[Math.min(a.length - 1, Math.floor(a.length * k))] ?? 0;
    return {
      fps: 1000 / avg,
      p95: q(gaps, 0.95),
      cpu: cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length),
      cpu95: q(cpu, 0.95),
      frames: gaps.length,
      calls,
      triangles: tris,
      pixelRatio: world.stats().pixelRatio,
      remotes,
      room: world.rooms.current,
    };
  }, ms);
  const row = { label, ...r, ...extra };
  results.push(row);
  if (!extra.pose) await page.screenshot({ path: `${out}/${label.replace(/\W+/g, '-')}.png` });
  console.log(
    `${label.padEnd(30)} ${r.fps.toFixed(1).padStart(6)} fps  p95 ${r.p95.toFixed(1).padStart(5)} ms  cpu ${r.cpu.toFixed(2).padStart(5)} ms (p95 ${r.cpu95.toFixed(1).padStart(4)})  ${String(r.calls).padStart(4)} calls  ${(r.triangles / 1000).toFixed(0).padStart(4)}k tris  ${String(r.remotes).padStart(2)} people  pr ${r.pixelRatio}`,
  );
  return row;
}

/** What the bots need from the plan: the rooms, the floor seats, and the tables and machines. */
async function planFor(page) {
  return page.evaluate(async () => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    const w = window.casino.world;
    const rooms = w.plan.rooms.map((r) => ({ id: r.id, ...r.bounds }));
    const roomOf = (x, z) => rooms.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)?.id ?? null;
    const seats = lifePoints(w.plan)
      .seats.filter((s) => !s.station)
      .map((s) => ({ id: s.id, x: s.x, z: s.z, yaw: s.yaw, room: s.room }));
    const stations = w.stations.map((s) => ({ id: s.id, game: s.game, variant: s.variant, x: s.anchor.position.x, z: s.anchor.position.z, room: roomOf(s.anchor.position.x, s.anchor.position.z) }));
    return { rooms, seats, stations };
  });
}

/** Every room turning round from its middle, and every doorway from both sides. */
async function poses(page) {
  return page.evaluate(() => {
    const p = window.casino.world.plan;
    const out = [];
    for (const r of p.rooms) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        out.push([`${r.id}@${k * 45}`, [r.cx, 1.7, r.cz], [r.cx + Math.sin(a) * 10, 1.1, r.cz - Math.cos(a) * 10]]);
      }
    }
    for (const d of p.doors) {
      if (d.b === 'outside') continue;
      const m = (d.a0 + d.a1) / 2;
      for (const s of [-1, 1]) {
        const [x, z] = d.axis === 'x' ? [m, d.c + s * 2.2] : [d.c + s * 2.2, m];
        const [tx, tz] = d.axis === 'x' ? [m, d.c - s * 8] : [d.c - s * 8, m];
        out.push([`${d.id}${s > 0 ? '+' : '-'}`, [x, 1.7, z], [tx, 1.1, tz]]);
      }
    }
    return out;
  });
}

/** Hold the camera at a pose from here on (the player stands aside, hidden). */
async function holdCamera(page) {
  await page.evaluate(() => {
    const c = window.casino;
    c.world.player.setEnabled(false);
    c.world.player.character.root.visible = false;
    c.__pose = null;
    c.engine.onFrame(() => {
      const p = c.__pose;
      if (!p) return;
      c.engine.camera.position.set(...p[0]);
      c.engine.camera.lookAt(...p[1]);
    });
  });
}

async function sweep(page, quality, list, ms) {
  await holdCamera(page);
  const rows = [];
  for (const [name, pos, at] of list) {
    await page.evaluate(([pos, at]) => (window.casino.__pose = [pos, at]), [pos, at]);
    await page.waitForTimeout(350);
    rows.push(await sample(page, `${quality} ${name}`, ms, { pose: name, quality }));
  }
  return rows;
}

function summarise(rows, tag) {
  const by = (k) => [...rows].sort((a, b) => b[k] - a[k]);
  const fpsLow = [...rows].sort((a, b) => a.fps - b.fps);
  const s = {
    tag,
    poses: rows.length,
    worstCalls: by('calls').slice(0, 5).map((r) => [r.pose, r.calls]),
    slowestFps: fpsLow.slice(0, 5).map((r) => [r.pose, +r.fps.toFixed(1), +r.p95.toFixed(1)]),
    worstCpu: by('cpu95').slice(0, 5).map((r) => [r.pose, +r.cpu.toFixed(2), +r.cpu95.toFixed(1)]),
    meanFps: +(rows.reduce((a, r) => a + r.fps, 0) / rows.length).toFixed(1),
    meanCpu: +(rows.reduce((a, r) => a + r.cpu, 0) / rows.length).toFixed(2),
    maxPeople: Math.max(...rows.map((r) => r.remotes)),
  };
  console.log('SUMMARY', JSON.stringify(s));
  return s;
}

// --- other players ------------------------------------------------------------------------------
let bots = null;
async function ensureBots(page) {
  if (bots || botCount <= 0) return;
  const plan = await planFor(page);
  bots = await startBots({ port: Number(port) + 1, origin: `http://localhost:${port}`, count: botCount, ...plan, only: flag('crowd') ? ['lobby'] : null });
  console.log('bots', JSON.stringify(bots.stats));
  // their looks load, their first positions arrive
  await page.waitForTimeout(4000);
}

const summaries = [];
for (const quality of checks.some((c) => c === 'flow' || c === 'sweep') ? qualities : []) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((q) => localStorage.setItem('casino.quality', q), quality);
  const page = await ctx.newPage();
  const errors = watch(page);
  const t0 = Date.now();
  await enter(page, 'perf_e2e');
  console.log(`${quality}: login screen to menu in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(1500);
  if (checks.includes('flow')) await sample(page, `${quality} menu pass`);
  if (await page.$('.menu-item')) await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await ensureBots(page);

  if (checks.includes('flow')) {
    await sample(page, `${quality} entrance`);
    await page.keyboard.down('KeyW');
    await sample(page, `${quality} walking in`, 3000);
    await page.keyboard.up('KeyW');
    for (const spot of ['pit', 'slots']) {
      await page.evaluate((spot) => {
        const w = window.casino.world;
        if (spot === 'pit') w.teleport((w.plan.pit.x0 + w.plan.pit.x1) / 2, w.plan.pit.z1 + 1.5, Math.PI);
        else {
          const s = w.stations.find((x) => x.id === 'slots-neon-1');
          w.teleport(s.anchor.position.x, s.anchor.position.z + 3, Math.PI);
        }
      }, spot);
      await page.waitForTimeout(1500);
      await sample(page, `${quality} ${spot}`);
    }
    await page.evaluate(() => {
      const w = window.casino.world;
      w.enter(w.stations.find((s) => s.id === 'rl-us'));
    });
    await page.waitForSelector('.lobby-choice', { timeout: 10_000 });
    await page.keyboard.press('s');
    await page.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
    await page.fill('.modal input[type=number]', '1000');
    await page.click('.modal .btn.primary');
    await page.waitForTimeout(2500);
    await sample(page, `${quality} seated roulette`);
    await page.evaluate(() => {
      const s = window.casino.app.table.session;
      s.link.act({ type: 'bet', bets: [{ kind: 'red', amount: 500 }] });
      setTimeout(() => s.link.act({ type: 'spin' }), 300);
    });
    await page.waitForTimeout(600);
    await sample(page, `${quality} roulette spin`, 5000);
    await page.evaluate(() => window.casino.app.escape());
    const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
    if (leave) await leave.click();
    await page.waitForTimeout(2500);
  }

  if (checks.includes('sweep')) {
    const list = await poses(page);
    const rows = await sweep(page, quality, list, 1200);
    const s = summarise(rows, `sweep ${quality}${flag('crowd') ? ' crowd' : ''}`);
    summaries.push(s);
    if (quality === 'high') {
      const over = rows.filter((r) => r.calls > CALL_LIMIT);
      if (over.length) fail(`${quality}: over ${CALL_LIMIT} draw calls at ${over.map((r) => `${r.pose} ${r.calls}`).join(', ')}`);
    }
  }
  if (errors.length) console.log(`${quality} console:`, JSON.stringify([...new Set(errors)].slice(0, 12)));
  await ctx.close();
}

if (checks.includes('mobile')) {
  // a mid phone: portrait, 1.5 device pixels per CSS pixel, touch, and a CPU about a quarter of this one
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = watch(page);
  const cdp = await ctx.newCDPSession(page);
  await enter(page, 'perf_e2e_m');
  if (await page.$('.menu-item')) await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await ensureBots(page);
  const quality = await page.evaluate(() => window.casino.world.quality);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const list = (await poses(page)).filter(([n]) => /^(lobby|pit|slots|bar|online)@(0|90|180|270)$/.test(n) || /^(lobby-pit|pit-slots|slots-online)/.test(n));
  const rows = await sweep(page, `mobile-${quality}`, list, 2000);
  summaries.push(summarise(rows, `mobile ${quality} (cpu x4)`));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  if (errors.length) console.log('mobile console:', JSON.stringify([...new Set(errors)].slice(0, 12)));
  await ctx.close();
}

if (bots) {
  console.log('bots', JSON.stringify(bots.stats));
  await bots.stop();
}
writeFileSync(`${out}/perf.json`, JSON.stringify({ args: argv, summaries, results }, null, 1));
console.log(`wrote ${out}/perf.json`);
await browser.close();
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
