#!/usr/bin/env node
// Headless check of the roulette table in the dev harness: buy in, put chips on a straight, a
// split, a corner, a street, a six line, the top line (or first four) and a few outside bets by
// clicking where they sit on the felt, spin, and take screenshots while the ball is on the track,
// while it bounces in the rotor, at the call, with the winners paid, and once the table settles.
// Waits follow the table's own spin clock, so a slow software renderer only makes it take longer.
//
// Usage: node scripts/e2e/roulette.mjs [port] [outDir] [variant] [--quick] [--low]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const quick = process.argv.includes('--quick');
const low = process.argv.includes('--low');
const [port = '5450', outDir = '/tmp/roulette-shots', variant = 'american'] = args;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
if (low) await page.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name) => {
  const path = `${outDir}/${variant}-${name}.png`;
  await page.screenshot({ path });
  console.log('shot', path);
};
const state = () => page.evaluate(() => window.casino.table.view.debug.state());
/** Wait until the view's spin clock passes t seconds (or the predicate on the state holds). */
const until = (fnSrc, timeout = 120000) => page.waitForFunction(fnSrc, null, { timeout, polling: 50 });

if (process.argv.includes('--multi')) {
  await multiplayer();
  await browser.close();
  process.exit(0);
}

await page.goto(`http://localhost:${port}/casino/?dev=table&game=roulette&variant=${variant}&name=rl_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
await page.fill('.modal input[type=number]', '2000');
await page.click('.modal .btn.primary');
await until(() => window.casino?.table?.view?.debug?.state().stack > 0, 20000);
await page.waitForTimeout(800);
const frame = await page.evaluate(() => ({ ms: window.casino.engine.frameMs(), calls: window.casino.engine.renderer.info.render.calls, tris: window.casino.engine.renderer.info.render.triangles }));
console.log('frame', JSON.stringify(frame));
await shot('0-empty');
if (quick) {
  console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 1));
  await browser.close();
  process.exit(0);
}

const at = (key) => page.evaluate((k) => window.casino.table.view.debug.screenOf(k), key);
const click = async (key, chipKey) => {
  if (chipKey) await page.keyboard.press(chipKey);
  const p = await at(key);
  if (!p) throw new Error(`no screen position for ${key}`);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
};

const zeroCombo = variant === 'american' ? 'topline:0-1-2-3-37' : 'firstfour:0-1-2-3';
const bets = [
  ['straight:17', '2'],
  ['straight:17', '2'],
  ['split:17-20', '1'],
  ['corner:25-26-28-29', '2'],
  ['street:13-14-15', '1'],
  ['sixline:31-32-33-34-35-36', '2'],
  [zeroCombo, '1'],
  ['split:0-2', '1'],
  ['red', '3'],
  ['dozen2', '2'],
  ['column3', '2'],
  ['odd', '2'],
];
for (const [key, chip] of bets) await click(key, chip);
await until(() => Object.keys(window.casino.table.view.debug.state().bets).length >= 11, 15000);
// hover a split to show the tooltip and the numbers it covers
const sp = await at('split:17-18');
await page.mouse.move(sp.x, sp.y);
await page.waitForTimeout(400);
await shot('1-bets');
const before = await state();
console.log('bets', JSON.stringify(before.bets));

await page.mouse.move(700, 870);
await page.keyboard.press('Space');
await until(() => window.casino.table.view.debug.state().flight !== null, 15000);
const f = (await state()).flight;
console.log('flight', JSON.stringify(f));
await until(`window.casino.table.view.debug.state().s >= ${f.tDrop - 1.2}`);
await shot('2-track');
await until(`window.casino.table.view.debug.state().s >= ${f.tEnter + 0.45}`);
await shot('3-bounce');
await until(`window.casino.table.view.debug.state().s >= ${f.tRest + 0.6}`);
await shot('4-rest');
await until(() => !!document.querySelector('.pill') || !window.casino.table.view.debug.state().animating, 60000);
await page.waitForTimeout(400);
await shot('5-paid');
await until(() => !window.casino.table.view.debug.state().animating, 90000);
await page.waitForTimeout(500);
await shot('6-settled');
const after = await state();
console.log(JSON.stringify({ history: after.history, stack: after.stack, phase: after.phase, errors: errors.slice(0, 10) }, null, 1));
await browser.close();

/**
 * Multiplayer through the real table host: two players in a lobby, the leader starts, both bet,
 * both press Ready, and the spin settles every seat. Raw sockets from inside pages (so the Origin
 * is the dev site's). Then the table view is shown a two-player snapshot for a screenshot of the
 * colour chips, the clock and the players list.
 */
async function multiplayer() {
  const base = `http://localhost:${port}`;
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  for (const p of [page, pageB]) await p.goto(`${base}/casino/`);
  const login = (p, name) => p.evaluate(async (n) => (await (await fetch('/casino/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n }) })).json()).token, name);
  const tA = await login(page, `rlA_${Date.now().toString(36).slice(-5)}`);
  const tB = await login(pageB, `rlB_${Date.now().toString(36).slice(-5)}`);
  const { tableId } = await page.evaluate(async ([t, v]) => (await (await fetch('/casino/api/tables', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ game: 'roulette', variant: v, visibility: 'public' }) })).json()), [tA, variant]);
  const open = (p, t) =>
    p.evaluate(([id, tok]) => new Promise((res, rej) => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/casino/ws/table/${id}?v=1&t=${tok}`);
      window.rl = { ws, msgs: [], aid: 0, send: (m) => ws.send(JSON.stringify(m)), act: (a) => ws.send(JSON.stringify({ t: 'act', aid: `x${window.rl.aid++}`, a })) };
      ws.onmessage = (e) => window.rl.msgs.push(JSON.parse(e.data));
      ws.onopen = () => res(true);
      ws.onerror = () => rej(new Error('socket failed'));
    }), [tableId, t]);
  await open(page, tA);
  await open(pageB, tB);
  const wait = (p, pred, ms = 30000) => p.waitForFunction(pred, null, { timeout: ms, polling: 100 });
  for (const p of [page, pageB]) await p.evaluate(() => window.rl.send({ t: 'buyin', aid: 'b1', amount: 50000 }));
  for (const p of [page, pageB]) await wait(p, () => window.rl.msgs.some((m) => m.t === 'seat' && m.status === 'seated'));
  await page.evaluate(() => window.rl.send({ t: 'start' }));
  for (const p of [page, pageB]) await wait(p, () => window.rl.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'betting')));
  const seatOf = (p) => p.evaluate(() => window.rl.msgs.filter((m) => m.t === 'seat').at(-1).seat);
  const [sa, sb] = [await seatOf(page), await seatOf(pageB)];
  await page.evaluate(() => window.rl.act({ type: 'bet', bets: [{ kind: 'straight', numbers: [17], amount: 500 }, { kind: 'red', amount: 1000 }] }));
  await pageB.evaluate(() => window.rl.act({ type: 'bet', bets: [{ kind: 'column2', amount: 2500 }, { kind: 'split', numbers: [0, 2], amount: 300 }] }));
  await pageB.evaluate(() => window.rl.act({ type: 'bet', bets: [{ kind: 'split', numbers: [1, 5], amount: 300 }] })); // illegal: refused
  await wait(pageB, () => window.rl.msgs.some((m) => m.t === 'err'));
  const errB = await pageB.evaluate(() => window.rl.msgs.find((m) => m.t === 'err'));
  for (const p of [page, pageB]) await p.evaluate(() => window.rl.act({ type: 'ready', on: true }));
  for (const p of [page, pageB]) await wait(p, () => window.rl.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'settle')));
  const late = await page.evaluate(() => {
    window.rl.act({ type: 'bet', bets: [{ kind: 'red', amount: 500 }] });
    return true;
  });
  await wait(page, () => window.rl.msgs.filter((m) => m.t === 'err').length > 0);
  const report = async (p) =>
    p.evaluate(() => {
      const ev = window.rl.msgs.find((m) => m.t === 'ev' && m.events.some((e) => e.type === 'settle'));
      const settle = ev.events.find((e) => e.type === 'settle');
      const spin = ev.events.find((e) => e.type === 'spin');
      const stacks = window.rl.msgs.filter((m) => m.t === 'seat').map((m) => m.stack);
      const err = window.rl.msgs.filter((m) => m.t === 'err').map((m) => m.code);
      return { pocket: settle.pocket, seats: settle.seats, launchToRest: spin.restAt - spin.launchAt, stacks, err, view: ev.view.phase };
    });
  const ra = await report(page);
  const rb = await report(pageB);
  const check = (r, seat) => {
    const s = r.seats[seat];
    const final = r.stacks.at(-1);
    return { seat, wagered: s.wagered, returned: s.returned, final, ok: final === 50000 - s.wagered + s.returned };
  };
  console.log(JSON.stringify({ tableId, pocket: ra.pocket, launchToRestMs: ra.launchToRest, A: check(ra, sa), B: check(rb, sb), illegalSplitRefused: errB.code, lateBetRefused: ra.err, late }, null, 1));
  if (!check(ra, sa).ok || !check(rb, sb).ok || errB.code !== 'BAD_REQUEST' || !ra.err.includes('WRONG_PHASE')) throw new Error('multiplayer check failed');
  for (const p of [page, pageB]) await p.evaluate(() => window.rl.send({ t: 'leave' }));
  await ctxB.close();

  // the view with two players' chips, the clock and the player list
  await page.goto(`${base}/casino/?dev=table&game=roulette&variant=${variant}&name=rlM_${Date.now().toString(36).slice(-5)}`);
  await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
  await page.fill('.modal input[type=number]', '1000');
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino?.table?.view?.debug?.state().stack > 0, null, { timeout: 20000 });
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
    ];
    snap.view = {
      ...snap.view,
      phase: 'betting', round: 7, deadline: now + 12500, launchAt: now + 9500, ready: [1],
      bets: { 0: { 'straight:17': 2500, red: 5000 }, 1: { 'straight:17': 1000, 'corner:25-26-28-29': 500, dozen3: 2500 }, 2: { 'split:0-3': 500, odd: 1000, 'sixline:13-14-15-16-17-18': 1000 } },
      history: [23, 4, 0, 17, 30, 9, 0, 12],
    };
    t.view.onTable(snap);
  });
  await page.waitForTimeout(900);
  await shot('7-multi');
}
