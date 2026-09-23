#!/usr/bin/env node
// Headless check of the Big Six table in the dev harness: buy in, put chips on spots by clicking
// the felt, spin, and take screenshots as the wheel races, as the camera closes on the clapper,
// as it stops, with the winners paid and once the table settles. Checks the clapper stopped on
// the stop the server drew. Then a Star hit played through the view for the celebration, and
// (--multi) two players through the real table host.
//
// Usage: node scripts/e2e/bigsix.mjs [port] [outDir] [--quick] [--low] [--tips] [--multi]
// Players have fixed names, so repeated runs don't use up the new-account limit; B6_SOLO,
// B6_A, B6_B and B6_VIEW pick others.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (f) => process.argv.includes(f);
const [port = '5750', outDir = '/tmp/bigsix-shots'] = args;
mkdirSync(outDir, { recursive: true });
const env = process.env;
const NAMES = { solo: env.B6_SOLO ?? 'b6_solo', a: env.B6_A ?? 'b6_alice', b: env.B6_B ?? 'b6_bob', view: env.B6_VIEW ?? 'b6_viewer' };

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
  const path = `${outDir}/bigsix-${name}.png`;
  await page.screenshot({ path });
  console.log('shot', path);
};
const state = () => page.evaluate(() => window.casino.table.view.debug.state());

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
const until = (fn, timeout = 120000) => page.waitForFunction(fn, null, { timeout, polling: 50 });

if (flag('--multi')) {
  await multiplayer();
  await browser.close();
  process.exit(0);
}

await page.goto(`http://localhost:${port}/casino/?dev=table&game=bigsix&name=${NAMES.solo}`);
await sitDown(page, '2000');
await until(() => document.getElementById('boot')?.classList.contains('done'), 90000);
await page.waitForTimeout(1500);
const frame = await page.evaluate(() => ({ ms: window.casino.engine.frameMs(), calls: window.casino.engine.renderer.info.render.calls, tris: window.casino.engine.renderer.info.render.triangles }));
console.log('frame', JSON.stringify(frame));
await shot('0-empty');
if (flag('--quick')) {
  console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 1));
  await browser.close();
  process.exit(0);
}

const at = (key) => page.evaluate((k) => window.casino.table.view.debug.screenOf(k), key);
const click = async (key, chipKey) => {
  if (chipKey) await page.keyboard.press(chipKey);
  const p = await at(key);
  if (!p) throw new Error(`no screen position for ${key}`);
  await page.mouse.move(p.x, p.y + 30);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
};

// $5 chips on the $1 and $2, a $25 and a $1 on the $20, $1 on each picture
const bets = [['one', '2'], ['one', '2'], ['two', '2'], ['twenty', '3'], ['twenty', '1'], ['star', '1'], ['crown', '1'], ['ten', '2']];
for (const [key, chip] of bets) await click(key, chip);
await until(() => Object.keys(window.casino.table.view.debug.state().bets).length >= 6, 15000);
const tp = await at('star');
await page.mouse.move(tp.x, tp.y + 30);
await page.waitForTimeout(400);
await shot('1-bets');
console.log('bets', JSON.stringify((await state()).bets));

await page.mouse.move(700, 880);
await page.keyboard.press('Space');
await until(() => window.casino.table.view.debug.state().spin !== null, 15000);
const sp = (await state()).spin;
console.log('spin', JSON.stringify(sp));
await until(`window.casino.table.view.debug.state().s >= 1.6`);
await shot('2-racing');
await until(`window.casino.table.view.debug.state().s >= ${sp.tRest - 2.2}`);
await shot('3-clapper');
await until(`window.casino.table.view.debug.state().s >= ${sp.tStop - 0.05}`);
await shot('4-stopping');
await until(`window.casino.table.view.debug.state().s >= ${sp.tRest}`);
await page.waitForTimeout(300);
await shot('5-rest');
const rest = await state();
await until(() => !!document.querySelector('.pill') || !window.casino.table.view.debug.state().animating, 60000);
await page.waitForTimeout(500);
await shot('6-paid');
await until(() => !window.casino.table.view.debug.state().animating, 90000);
await page.waitForTimeout(500);
await shot('7-settled');
const after = await state();
const ok = rest.shows === sp.stop && after.history[0] === sp.stop;
console.log(JSON.stringify({ stop: sp.stop, clapperShows: rest.shows, history: after.history, stack: after.stack, phase: after.phase, revolutions: sp.revolutions, ticks: sp.ticks, ok }, null, 1));

// A Star hit played through the view (the server's draw can't be steered), for the celebration.
await page.evaluate(() => {
  const t = window.casino.table;
  const v = t.view;
  const snap = structuredClone(t.snapshot);
  snap.view = { ...snap.view, phase: 'betting', bets: { 0: { one: 1000, star: 500 } }, spin: null, settled: {} };
  v.onTable(snap);
  const now = Date.now();
  const seats = { 0: { wagered: 1500, returned: 20500, bets: [['one', 1000, 0], ['star', 500, 20500]] } };
  const next = { ...snap.view, phase: 'results', bets: {}, spin: { round: 99, stop: 0, symbol: 'star', startAt: now, restAt: now + 10500 }, settled: seats, history: [0, ...snap.view.history] };
  void v.onEvents([{ type: 'spin', round: 99, stop: 0, symbol: 'star', startAt: now, restAt: now + 10500 }, { type: 'settle', round: 99, stop: 0, symbol: 'star', seats }], next);
});
await until(() => window.casino.table.view.debug.state().spin?.stop === 0, 10000);
const sp2 = (await state()).spin;
await until(`window.casino.table.view.debug.state().s >= ${sp2.tRest}`);
await page.waitForTimeout(300);
await shot('8-star-rest');
await until(() => !!document.querySelector('.celebrate'), 30000);
await page.waitForTimeout(700);
await shot('9-star-celebrate');
await until(() => !window.casino.table.view.debug.state().animating, 90000);
console.log(JSON.stringify({ starShows: (await state()).shows, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
if (!ok) process.exit(1);

/**
 * Multiplayer through the real table host: two players in a lobby, the leader starts, both bet,
 * both press Ready, and the spin settles every seat. Raw sockets from inside pages (so the Origin
 * is the dev site's). Then the table view is shown a three-player snapshot for a screenshot of
 * the colour chips, the clock and the players list.
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
  const { tableId } = await page.evaluate(async (t) => (await (await fetch('/casino/api/tables', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ game: 'bigsix', variant: '', visibility: 'public' }) })).json()), tA);
  const open = (p, t) =>
    p.evaluate(([id, tok]) => new Promise((res, rej) => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/casino/ws/table/${id}?v=1&t=${tok}`);
      window.b6 = { ws, msgs: [], aid: 0, send: (m) => ws.send(JSON.stringify(m)), act: (a) => ws.send(JSON.stringify({ t: 'act', aid: `x${window.b6.aid++}`, a })) };
      ws.onmessage = (e) => window.b6.msgs.push(JSON.parse(e.data));
      ws.onopen = () => res(true);
      ws.onerror = () => rej(new Error('socket failed'));
    }), [tableId, t]);
  await open(page, tA);
  await open(pageB, tB);
  const wait = (p, pred, ms = 30000) => p.waitForFunction(pred, null, { timeout: ms, polling: 100 });
  for (const p of [page, pageB]) await p.evaluate(() => window.b6.send({ t: 'buyin', aid: 'b1', amount: 50000 }));
  for (const p of [page, pageB]) await wait(p, () => window.b6.msgs.some((m) => m.t === 'seat' && m.status === 'seated'));
  await page.evaluate(() => window.b6.send({ t: 'start' }));
  for (const p of [page, pageB]) await wait(p, () => window.b6.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'betting')));
  const seatOf = (p) => p.evaluate(() => window.b6.msgs.filter((m) => m.t === 'seat').at(-1).seat);
  const [sa, sb] = [await seatOf(page), await seatOf(pageB)];
  await page.evaluate(() => window.b6.act({ type: 'bet', bets: [{ spot: 'one', amount: 500 }, { spot: 'twenty', amount: 1000 }] }));
  await pageB.evaluate(() => window.b6.act({ type: 'bet', bets: [{ spot: 'two', amount: 2500 }, { spot: 'star', amount: 300 }] }));
  await pageB.evaluate(() => window.b6.act({ type: 'bet', bets: [{ spot: 'joker', amount: 300 }] })); // not a spot: malformed
  await pageB.evaluate(() => window.b6.act({ type: 'bet', bets: [{ spot: 'ten', amount: 60000 }] })); // over the spot limit: refused
  await wait(pageB, () => window.b6.msgs.filter((m) => m.t === 'err').length >= 2);
  const errsB = await pageB.evaluate(() => window.b6.msgs.filter((m) => m.t === 'err').map((m) => m.code));
  const t0 = Date.now();
  for (const p of [page, pageB]) await p.evaluate(() => window.b6.act({ type: 'ready', on: true }));
  for (const p of [page, pageB]) await wait(p, () => window.b6.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'settle')));
  const closedEarlyMs = Date.now() - t0;
  await page.evaluate(() => window.b6.act({ type: 'bet', bets: [{ spot: 'one', amount: 500 }] }));
  await wait(page, () => window.b6.msgs.filter((m) => m.t === 'err').length > 0);
  const report = async (p) =>
    p.evaluate(() => {
      const ev = window.b6.msgs.find((m) => m.t === 'ev' && m.events.some((e) => e.type === 'settle'));
      const settle = ev.events.find((e) => e.type === 'settle');
      const spin = ev.events.find((e) => e.type === 'spin');
      const stacks = window.b6.msgs.filter((m) => m.t === 'seat').map((m) => m.stack);
      const err = window.b6.msgs.filter((m) => m.t === 'err').map((m) => m.code);
      return { stop: settle.stop, symbol: settle.symbol, seats: settle.seats, startToRest: spin.restAt - spin.startAt, stacks, err, view: ev.view.phase };
    });
  const ra = await report(page);
  const rb = await report(pageB);
  const check = (r, seat) => {
    const s = r.seats[seat];
    const final = r.stacks.at(-1);
    return { seat, wagered: s.wagered, returned: s.returned, final, ok: final === 50000 - s.wagered + s.returned };
  };
  console.log(JSON.stringify({ tableId, stop: ra.stop, symbol: ra.symbol, startToRestMs: ra.startToRest, closedEarlyMs, A: check(ra, sa), B: check(rb, sb), refusedB: errsB, lateBetRefused: ra.err }, null, 1));
  const refusedRight = errsB.includes('BAD_REQUEST') && errsB.includes('LIMIT');
  if (!check(ra, sa).ok || !check(rb, sb).ok || !refusedRight || !ra.err.includes('WRONG_PHASE') || closedEarlyMs > 8000) throw new Error('multiplayer check failed');
  for (const p of [page, pageB]) await p.evaluate(() => window.b6.send({ t: 'leave' }));
  await ctxB.close();

  // the view with three players' chips, the clock and the player list
  await page.goto(`${base}/casino/?dev=table&game=bigsix&name=${NAMES.view}`);
  await sitDown(page, '1000');
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
      { ...me, accountId: 9003, name: 'Ade', seat: 5, status: 'seated', stack: 31000 },
    ];
    snap.view = {
      ...snap.view,
      phase: 'betting', round: 7, deadline: now + 12500, ready: [1],
      bets: { 0: { one: 2500, twenty: 500 }, 1: { one: 1000, five: 500, star: 100 }, 2: { two: 1500, crown: 200 }, 5: { one: 5000, ten: 1000 } },
      history: [3, 13, 27, 1, 40, 8, 0, 21],
    };
    t.view.onTable(snap);
  });
  await page.waitForTimeout(900);
  await shot('10-multi');
}
