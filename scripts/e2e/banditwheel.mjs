#!/usr/bin/env node
// Headless check of the Bandit Wheel in the dev harness: buy in, look at the station from the floor
// and from a terminal, put chips on numbers through the panel, press Spin now, and take screenshots
// as the wheel races, as the camera closes on the flapper, at rest and paid. Checks the flapper
// stopped on the slot the server drew. Then a Twenty played through the view for the celebration,
// the far copy baked by the floor's own LOD code (--lod), and (--multi) two players through the
// real table host with no Start and no Spin.
//
// Usage: node scripts/e2e/banditwheel.mjs [port] [outDir] [--quick] [--low] [--tips] [--lod] [--multi]
// Players have fixed names so repeated runs don't use up the new-account limit; BW_SOLO, BW_A,
// BW_B and BW_VIEW pick others.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (f) => process.argv.includes(f);
const [port = '6020', outDir = '/tmp/banditwheel-shots'] = args;
mkdirSync(outDir, { recursive: true });
const env = process.env;
const NAMES = { solo: env.BW_SOLO ?? 'bw_solo', a: env.BW_A ?? 'bw_alice', b: env.BW_B ?? 'bw_bob', view: env.BW_VIEW ?? 'bw_viewer' };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(([low, tips]) => {
  if (low) localStorage.setItem('casino.quality', 'low');
  localStorage.setItem('casino.tips', tips ? '1' : '0');
}, [flag('--low'), flag('--tips')]);
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name) => {
  const path = `${outDir}/bw-${name}.png`;
  await page.screenshot({ path });
  console.log('shot', path);
};
const state = () => page.evaluate(() => window.casino.table.view.debug.state());
const until = (fn, timeout = 120000) => page.waitForFunction(fn, null, { timeout, polling: 50 });

/** Buy in, unless this player is still sitting at their solo table from an earlier run. */
async function sitDown(p, dollars) {
  const seated = () => window.casino?.table?.view?.debug?.state().stack > 0;
  await p.waitForFunction(() => !!document.querySelector('.modal input[type=number]') || window.casino?.table?.view?.debug?.state().stack > 0, null, { timeout: 90000, polling: 100 });
  if (!(await p.evaluate(seated))) {
    await p.fill('.modal input[type=number]', dollars);
    await p.click('.modal .btn.primary', { force: true });
    await p.waitForFunction(seated, null, { timeout: 90000, polling: 100 });
  }
}

/** Put the camera somewhere in the station's frame (the dev room's station sits at the origin). */
async function look(pos, at) {
  await page.evaluate(([p, a]) => {
    const c = window.casino.engine.camera;
    c.position.set(...p);
    c.lookAt(...a);
  }, [pos, at]);
  await page.waitForTimeout(400);
}

if (flag('--multi')) {
  await multiplayer();
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

await page.goto(`http://localhost:${port}/casino/?dev=table&game=banditwheel&name=${NAMES.solo}`);
await sitDown(page, '2000');
await until(() => document.getElementById('boot')?.classList.contains('done'), 90000);
// a fresh window, so a spin from an earlier run isn't still turning
await until(() => window.casino.table.view.debug.state().phase === 'betting' && !window.casino.table.view.debug.state().animating, 60000);
await page.waitForTimeout(1200);
const frame = await page.evaluate(() => ({ ms: window.casino.engine.frameMs(), calls: window.casino.engine.renderer.info.render.calls, tris: window.casino.engine.renderer.info.render.triangles }));
console.log('frame', JSON.stringify(frame));
await shot('1-seated');

// the station from the floor, as someone walking up sees it
const home = await page.evaluate(() => ({ p: window.casino.engine.camera.position.toArray(), q: window.casino.engine.camera.quaternion.toArray() }));
await look([3.6, 1.75, 4.6], [0, 1.35, -0.7]);
await shot('0-floor');
await look([-1.2, 2.3, 0.6], [0.1, 2.35, -0.9]);
await shot('0-flapper-close');
if (flag('--lod')) await farCopy();
await page.evaluate(({ p, q }) => {
  window.casino.engine.camera.position.fromArray(p);
  window.casino.engine.camera.quaternion.fromArray(q);
}, home);
await page.waitForTimeout(300);
if (flag('--quick')) {
  console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 1));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

// chips through the panel: $25 on 1, $5 on 3, $5 on 10, $1 on 20, then Max on 5 with a $1 top-up after
const pickChip = async (key) => page.keyboard.press(key);
const slot = async (n) => {
  await page.click(`.bw-slot[data-n="${n}"]`);
  await page.waitForTimeout(120);
};
await pickChip('3');
await slot(1);
await pickChip('2');
await slot(3);
await slot(10);
await pickChip('1');
await slot(20);
await until(() => Object.keys(window.casino.table.view.debug.state().bets).length >= 4, 15000);
await page.hover('.bw-slot[data-n="10"]');
await page.waitForTimeout(300);
await shot('2-bets');
console.log('bets', JSON.stringify((await state()).bets));

await page.mouse.move(700, 450);
await page.keyboard.press('Space');
await until(() => window.casino.table.view.debug.state().spin !== null && window.casino.table.view.debug.state().animating, 15000);
const sp = (await state()).spin;
console.log('spin', JSON.stringify(sp));
await until(`window.casino.table.view.debug.state().s >= 1.3`);
await shot('3-racing');
await until(`window.casino.table.view.debug.state().s >= ${sp.tRest - 1.6}`);
await shot('4-flapper');
await until(`window.casino.table.view.debug.state().s >= ${sp.tRest}`);
await page.waitForTimeout(250);
await shot('5-rest');
const rest = await state();
await until(() => !!document.querySelector('.pill') || !window.casino.table.view.debug.state().animating, 60000);
await page.waitForTimeout(400);
await shot('6-paid');
await until(() => !window.casino.table.view.debug.state().animating, 90000);
await page.waitForTimeout(400);
await shot('7-settled');
const after = await state();
const ok = rest.shows === sp.slot && after.history[0] === sp.slot;
console.log(JSON.stringify({ slot: sp.slot, flapperShows: rest.shows, history: after.history.slice(0, 6), stack: after.stack, phase: after.phase, revolutions: sp.revolutions, ticks: sp.ticks, ok }, null, 1));

// Max: the table's $1,000 or the stack, whichever is less
await until(() => window.casino.table.view.debug.state().phase === 'betting' && !window.casino.table.view.debug.state().animating, 30000);
const before = (await state()).stack;
await page.keyboard.press('m');
await slot(5);
await until(() => (window.casino.table.view.debug.state().bets[5] ?? 0) > 0, 15000);
const maxBet = (await state()).bets[5];
const maxOk = maxBet === Math.min(100000, before);
console.log(JSON.stringify({ stackBefore: before, max: maxBet, maxOk }));
await page.keyboard.press('Backspace');
await until(() => !window.casino.table.view.debug.state().bets[5], 15000);

// A Twenty played through the view (the server's draw can't be steered), for the celebration
await page.evaluate(() => {
  const t = window.casino.table;
  const v = t.view;
  const snap = structuredClone(t.snapshot);
  snap.view = { ...snap.view, phase: 'betting', bets: { 0: { 1: 1000, 20: 500 } }, spin: null, settled: {} };
  v.onTable(snap);
  const now = Date.now();
  const seats = { 0: { wagered: 1500, returned: 10500, bets: [[1, 1000, 0], [20, 500, 10500]] } };
  const next = { ...snap.view, phase: 'results', bets: {}, deadline: now + 12000, spin: { round: 99, slot: 0, number: 20, startAt: now, restAt: now + 7000 }, settled: seats, history: [0, ...snap.view.history] };
  void v.onEvents([{ type: 'spin', round: 99, slot: 0, number: 20, startAt: now, restAt: now + 7000 }, { type: 'settle', round: 99, slot: 0, number: 20, seats }], next);
});
await until(() => window.casino.table.view.debug.state().spin?.slot === 0, 10000);
const sp2 = (await state()).spin;
await until(`window.casino.table.view.debug.state().s >= ${sp2.tRest}`);
await page.waitForTimeout(300);
await shot('8-twenty-rest');
await until(() => !!document.querySelector('.celebrate'), 30000);
await page.waitForTimeout(700);
await shot('9-twenty-celebrate');
await until(() => !window.casino.table.view.debug.state().animating, 90000);
const twentyShows = (await state()).shows;
console.log(JSON.stringify({ twentyShows, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
// Fail on a flapper off the drawn slot (the live spin, or the Twenty at slot 0), a wrong Max, or page errors.
if (!ok || twentyShows !== 0 || !maxOk || errors.length) process.exit(1);

/** The far copy the floor swaps in past 11 m, baked by world/lod.ts from this model. */
async function farCopy() {
  const info = await page.evaluate(async () => {
    const { StationLod } = await import('/casino/src/world/lod.ts');
    const t = window.casino.table;
    const anchor = t.stage.anchor;
    const model = anchor.children.find((c) => c.name !== '' && c.getObjectByName?.('bw-rotor')) ?? anchor.getObjectByName('bw-wheel');
    const engine = window.casino.engine;
    const station = { id: 'bw-1', game: 'banditwheel', variant: '', anchor, model, footprint: { width: 4, depth: 3 }, zone: 'feature', name: 'Bandit Wheel', limits: '', yaw: 0 };
    const lod = new StationLod([station], engine.quality);
    // hide the table view's own additions so only the station shows
    t.stage.root.visible = false;
    engine.camera.position.set(6, 2.2, 14);
    engine.camera.lookAt(0, 1.4, 0);
    lod.update(engine.camera, null);
    window.bwLod = lod;
    await new Promise((r) => setTimeout(r, 500));
    const far = anchor.getObjectByName('far:bw-1');
    let meshes = 0;
    far?.traverse((o) => { if (o.isMesh) meshes++; });
    let near = 0;
    model.traverse((o) => { if (o.isMesh && o.visible) near++; });
    return { farMeshes: meshes, nearMeshes: near, farVisible: far?.visible, modelVisible: model.visible };
  });
  console.log('lod', JSON.stringify(info));
  await page.waitForTimeout(300);
  await shot('0-far-copy');
  await page.evaluate(() => {
    const engine = window.casino.engine;
    engine.camera.position.set(1.2, 1.6, 4.2);
    engine.camera.lookAt(0, 1.3, -0.6);
    window.bwLod.update(engine.camera, null);
    window.casino.table.stage.root.visible = true;
  });
}

/**
 * Multiplayer through the real table host: two players at a public wheel, nobody presses Start,
 * both bet, the clock spins the wheel and settles both seats. Raw sockets from inside pages (so the
 * Origin is the dev site's). Then the table view is shown a four-player snapshot for a screenshot of
 * the terminals' tags, the players list and the clock.
 */
async function multiplayer() {
  const base = `http://localhost:${port}`;
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  for (const p of [page, pageB]) await p.goto(`${base}/casino/`);
  const login = (p, name) => p.evaluate(async (n) => (await (await fetch('/casino/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, password: 'casino-dev' }) })).json()).token, name);
  const tA = await login(page, NAMES.a);
  const tB = await login(pageB, NAMES.b);
  if (!tA || !tB) throw new Error('login failed (new-account limit?)');
  const { tableId } = await page.evaluate(async (t) => (await (await fetch('/casino/api/tables', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ game: 'banditwheel', variant: '', visibility: 'public' }) })).json()), tA);
  const open = (p, t) =>
    p.evaluate(([id, tok]) => new Promise((res, rej) => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/casino/ws/table/${id}?v=1&t=${tok}`);
      window.bw = { ws, msgs: [], aid: 0, send: (m) => ws.send(JSON.stringify(m)), act: (a) => ws.send(JSON.stringify({ t: 'act', aid: `x${window.bw.aid++}`, a })) };
      ws.onmessage = (e) => window.bw.msgs.push(JSON.parse(e.data));
      ws.onopen = () => res(true);
      ws.onerror = () => rej(new Error('socket failed'));
    }), [tableId, t]);
  await open(page, tA);
  await open(pageB, tB);
  const wait = (p, pred, ms = 40000) => p.waitForFunction(pred, null, { timeout: ms, polling: 100 });
  const started = await page.evaluate(() => window.bw.msgs.find((m) => m.t === 'table').meta.started);
  for (const p of [page, pageB]) await p.evaluate(() => window.bw.send({ t: 'buyin', aid: 'b1', amount: 50000 }));
  for (const p of [page, pageB]) await wait(p, () => window.bw.msgs.some((m) => m.t === 'seat' && m.status === 'seated'));
  // no Start: the first seat opens the window
  for (const p of [page, pageB]) await wait(p, () => window.bw.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'betting')));
  const seatOf = (p) => p.evaluate(() => window.bw.msgs.filter((m) => m.t === 'seat').at(-1).seat);
  const [sa, sb] = [await seatOf(page), await seatOf(pageB)];
  await page.evaluate(() => window.bw.act({ type: 'bet', bets: [{ spot: 1, amount: 500 }, { spot: 20, amount: 1000 }] }));
  await pageB.evaluate(() => window.bw.act({ type: 'max', spot: 3 }));
  await pageB.evaluate(() => window.bw.act({ type: 'bet', bets: [{ spot: 2, amount: 300 }] })); // not on the wheel: malformed
  await pageB.evaluate(() => window.bw.act({ type: 'spin' })); // nobody spins a shared wheel
  await wait(pageB, () => window.bw.msgs.filter((m) => m.t === 'err').length >= 2);
  const errsB = await pageB.evaluate(() => window.bw.msgs.filter((m) => m.t === 'err').map((m) => m.code));
  const t0 = Date.now();
  for (const p of [page, pageB]) await wait(p, () => window.bw.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'settle')), 40000);
  const closedAfterMs = Date.now() - t0;
  const report = async (p) =>
    p.evaluate(() => {
      const ev = window.bw.msgs.find((m) => m.t === 'ev' && m.events.some((e) => e.type === 'settle'));
      const settle = ev.events.find((e) => e.type === 'settle');
      const spin = ev.events.find((e) => e.type === 'spin');
      const stacks = window.bw.msgs.filter((m) => m.t === 'seat').map((m) => m.stack);
      return { slot: settle.slot, number: settle.number, seats: settle.seats, startToRest: spin.restAt - spin.startAt, stacks, view: ev.view.phase };
    });
  const ra = await report(page);
  const rb = await report(pageB);
  const check = (r, seat) => {
    const s = r.seats[seat];
    const final = r.stacks.at(-1);
    return { seat, wagered: s.wagered, returned: s.returned, final, ok: final === 50000 - s.wagered + s.returned };
  };
  const A = check(ra, sa);
  const B = check(rb, sb);
  console.log(JSON.stringify({ tableId, startedWithoutLeader: started, slot: ra.slot, number: ra.number, startToRestMs: ra.startToRest, closedAfterMs, A, B, refusedB: errsB }, null, 1));
  const refusedRight = errsB.includes('BAD_REQUEST');
  if (!started || !A.ok || !B.ok || !refusedRight || B.wagered !== 50000) throw new Error('multiplayer check failed');
  for (const p of [page, pageB]) await p.evaluate(() => window.bw.send({ t: 'leave' }));
  await ctxB.close();

  // the view with four players' chips, the tags, the clock and the players list
  await page.goto(`${base}/casino/?dev=table&game=banditwheel&name=${NAMES.view}`);
  await sitDown(page, '1000');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const t = window.casino.table;
    const snap = structuredClone(t.snapshot);
    const now = Date.now();
    snap.meta.mode = 'multi';
    snap.you.seat = 0;
    snap.you.stack = 92500;
    snap.you.status = 'seated';
    const me = snap.members[0];
    snap.members = [
      { ...me, seat: 0, status: 'seated', stack: 92500 },
      { ...me, accountId: 9001, name: 'Marisol', seat: 1, status: 'seated', stack: 184000 },
      { ...me, accountId: 9002, name: 'Theo', seat: 2, status: 'seated', stack: 52500 },
      { ...me, accountId: 9003, name: 'Ade', seat: 3, status: 'seated', stack: 31000, connected: false },
    ];
    snap.view = {
      ...snap.view,
      phase: 'betting', round: 7, deadline: now + 12500, window: 20000,
      bets: { 0: { 1: 2500, 20: 500 }, 1: { 1: 1000, 5: 500, 10: 100 }, 2: { 3: 1500, 20: 200 }, 3: { 1: 5000, 10: 1000 } },
      history: [0, 8, 3, 1, 17, 4, 12, 21, 1, 6],
    };
    t.view.onTable(snap);
  });
  await page.waitForTimeout(900);
  await shot('10-multi');
}
