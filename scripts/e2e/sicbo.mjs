#!/usr/bin/env node
// Headless check of the Sic Bo table in the dev harness: buy in, put chips on Small, a total, a
// two-dice combination, a single number, a double, a specific triple and Any triple by clicking
// where they sit on the felt, shake, and take screenshots while the dome shakes, with the dice at
// rest, with the winning boxes lit and the winners paid, and once the table settles. Then a staged
// round of triple sixes for the celebration, and (with --multi) two players through the real
// server. Tips are switched on so the advice line and the lit best bets show.
//
// Usage: node scripts/e2e/sicbo.mjs [port] [outDir] [--quick] [--low] [--multi]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const quick = process.argv.includes('--quick');
const low = process.argv.includes('--low');
const [port = '5760', outDir = '/tmp/sicbo-shots'] = args;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript((lowQ) => {
  localStorage.setItem('casino.tips', '1');
  if (lowQ) localStorage.setItem('casino.quality', 'low');
}, low);
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name) => {
  const path = `${outDir}/sicbo-${name}.png`;
  await page.screenshot({ path });
  console.log('shot', path);
};
const state = () => page.evaluate(() => window.casino.table.view.debug.state());
const until = (fn, timeout = 120000) => page.waitForFunction(fn, null, { timeout, polling: 50 });

if (process.argv.includes('--multi')) {
  await multiplayer();
  await browser.close();
  process.exit(0);
}

/** Open the dev table as a fixed player (new accounts are rate limited) and buy in if not seated. */
async function sitDown(name, amount) {
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=sicbo&name=${name}`);
  await page.waitForFunction(() => document.querySelector('.modal input[type=number]') || window.casino?.table?.view?.debug?.state().stack > 0, null, { timeout: 30000 });
  if (await page.$('.modal input[type=number]')) {
    await page.fill('.modal input[type=number]', String(amount));
    await page.click('.modal .btn.primary');
  }
  await until(() => window.casino?.table?.view?.debug?.state().stack > 0, 20000);
}

await sitDown('sicbo_check', 2000);
await page.waitForTimeout(800);
const frame = await page.evaluate(() => ({ ms: window.casino.engine.frameMs(), calls: window.casino.engine.renderer.info.render.calls, tris: window.casino.engine.renderer.info.render.triangles }));
console.log('frame', JSON.stringify(frame));
await shot('0-empty');
if (quick) {
  console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 1));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

const at = (key) => page.evaluate((k) => window.casino.table.view.debug.screenOf(k), key);
const click = async (key, chipKey) => {
  if (chipKey) await page.keyboard.press(chipKey);
  const p = await at(key);
  if (!p) throw new Error(`no screen position for ${key}`);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
};

// $1 = key 1, $5 = key 2, $25 = key 3, $100 = key 4
const bets = [
  ['small', '4'],
  ['small', '3'],
  ['total:10', '2'],
  ['combo:2-5', '2'],
  ['single:4', '3'],
  ['double:3', '2'],
  ['triple:6', '1'],
  ['anytriple', '2'],
  ['total:14', '1'],
];
for (const [key, chip] of bets) await click(key, chip);
await until(() => Object.keys(window.casino.table.view.debug.state().bets).length >= 8, 15000);
// hover a combination to show the tooltip
const hp = await at('combo:1-3');
await page.mouse.move(hp.x, hp.y - 12);
await page.waitForTimeout(400);
await shot('1-bets');
console.log('bets', JSON.stringify((await state()).bets));
const tipLine = await page.evaluate(() => document.querySelector('.tip-line')?.textContent ?? null);
console.log('tip', tipLine);

await page.mouse.move(700, 880);
await page.keyboard.press('Space');
// the software renderer runs slower than real time (frames are capped at 0.1 s), so every wait
// follows the view's own state instead of the clock
await until(() => window.casino.table.view.debug.state().rolling, 15000);
await until(() => window.casino.table.view.debug.state().shake > 0.55);
await shot('2-shaking');
await until(() => !window.casino.table.view.debug.state().rolling);
await shot('3-rest');
await until(() => window.casino.table.view.debug.state().lit > 0);
await until(() => !!document.querySelector('.pill') || !window.casino.table.view.debug.state().animating);
await page.waitForTimeout(500);
await shot('4-paid');
await until(() => !window.casino.table.view.debug.state().animating);
await page.waitForTimeout(400);
await shot('5-settled');
const after = await state();
console.log(JSON.stringify({ history: after.history, stack: after.stack, phase: after.phase, lit: after.lit }, null, 1));

// A staged round of triple sixes: this player on the triple and Any triple (and Big, which loses).
await page.evaluate(() => {
  const t = window.casino.table;
  const snap = structuredClone(t.snapshot);
  const round = 41;
  snap.view = { ...snap.view, phase: 'betting', round, deadline: null, bets: { 0: { 'triple:6': 2000, anytriple: 1000, big: 5000 } }, ready: [], settled: {} };
  snap.you.seat = 0;
  snap.you.status = 'seated';
  t.view.onTable(snap);
  const now = Date.now();
  const dice = [6, 6, 6];
  const seats = { 0: { wagered: 8000, returned: 2000 * 181 + 1000 * 31, bets: [['triple:6', 2000, 362000], ['anytriple', 1000, 31000], ['big', 5000, 0]] } };
  const next = { ...snap.view, phase: 'results', bets: {}, roll: { round, dice, shakeAt: now, restAt: now + 4000 }, settled: seats, history: [dice, ...snap.view.history].slice(0, 20) };
  void t.view.onEvents([{ type: 'roll', round, dice, shakeAt: now, restAt: now + 4000 }, { type: 'settle', round, dice, seats }], next);
});
await until(() => !!document.querySelector('.celebrate'));
await page.waitForTimeout(700);
await shot('6-triple');
await until(() => !window.casino.table.view.debug.state().animating);
console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);

/**
 * Multiplayer through the real table host: two players in a lobby, the leader starts, both bet,
 * both press Ready, and the roll settles every seat. Raw sockets from inside pages (so the Origin
 * is the dev site's). Then the table view is shown a three-player snapshot for a screenshot of the
 * colour chips, the clock and the players list.
 */
async function multiplayer() {
  const base = `http://localhost:${port}`;
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  for (const p of [page, pageB]) await p.goto(`${base}/casino/`);
  const login = (p, name) => p.evaluate(async (n) => (await (await fetch('/casino/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, password: 'casino-dev' }) })).json()).token, name);
  const tA = await login(page, 'sicbo_alice');
  const tB = await login(pageB, 'sicbo_bob');
  const { tableId } = await page.evaluate(async (t) => (await (await fetch('/casino/api/tables', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ game: 'sicbo', visibility: 'public' }) })).json()), tA);
  const open = (p, t) =>
    p.evaluate(([id, tok]) => new Promise((res, rej) => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/casino/ws/table/${id}?v=1&t=${tok}`);
      window.sb = { ws, msgs: [], aid: 0, send: (m) => ws.send(JSON.stringify(m)), act: (a) => ws.send(JSON.stringify({ t: 'act', aid: `x${window.sb.aid++}`, a })) };
      ws.onmessage = (e) => window.sb.msgs.push(JSON.parse(e.data));
      ws.onopen = () => res(true);
      ws.onerror = () => rej(new Error('socket failed'));
    }), [tableId, t]);
  await open(page, tA);
  await open(pageB, tB);
  const wait = (p, pred, ms = 30000) => p.waitForFunction(pred, null, { timeout: ms, polling: 100 });
  for (const p of [page, pageB]) await p.evaluate(() => window.sb.send({ t: 'buyin', aid: 'b1', amount: 50000 }));
  for (const p of [page, pageB]) await wait(p, () => window.sb.msgs.some((m) => m.t === 'seat' && m.status === 'seated'));
  await page.evaluate(() => window.sb.send({ t: 'start' }));
  for (const p of [page, pageB]) await wait(p, () => window.sb.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'betting')));
  const seatOf = (p) => p.evaluate(() => window.sb.msgs.filter((m) => m.t === 'seat').at(-1).seat);
  const [sa, sb] = [await seatOf(page), await seatOf(pageB)];
  await page.evaluate(() => window.sb.act({ type: 'bet', bets: [{ spot: 'small', amount: 1000 }, { spot: 'total:9', amount: 500 }] }));
  await pageB.evaluate(() => window.sb.act({ type: 'bet', bets: [{ spot: 'big', amount: 2500 }, { spot: 'single:6', amount: 300 }, { spot: 'combo:1-6', amount: 200 }] }));
  await pageB.evaluate(() => window.sb.act({ type: 'bet', bets: [{ spot: 'combo:3-3', amount: 300 }] })); // not on the layout: refused
  await wait(pageB, () => window.sb.msgs.some((m) => m.t === 'err'));
  const errB = await pageB.evaluate(() => window.sb.msgs.find((m) => m.t === 'err'));
  const t0 = Date.now();
  for (const p of [page, pageB]) await p.evaluate(() => window.sb.act({ type: 'ready', on: true }));
  for (const p of [page, pageB]) await wait(p, () => window.sb.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'settle')));
  const closedAfter = Date.now() - t0;
  await page.evaluate(() => window.sb.act({ type: 'bet', bets: [{ spot: 'big', amount: 500 }] })); // after the close: refused
  await wait(page, () => window.sb.msgs.filter((m) => m.t === 'err').length > 0);
  const report = (p) =>
    p.evaluate(() => {
      const ev = window.sb.msgs.find((m) => m.t === 'ev' && m.events.some((e) => e.type === 'settle'));
      const settle = ev.events.find((e) => e.type === 'settle');
      const roll = ev.events.find((e) => e.type === 'roll');
      const stacks = window.sb.msgs.filter((m) => m.t === 'seat').map((m) => m.stack);
      const err = window.sb.msgs.filter((m) => m.t === 'err').map((m) => m.code);
      return { dice: settle.dice, seats: settle.seats, shakeToRest: roll.restAt - roll.shakeAt, stacks, err, phase: ev.view.phase };
    });
  const ra = await report(page);
  const rb = await report(pageB);
  const check = (r, seat) => {
    const s = r.seats[seat];
    const final = r.stacks.at(-1);
    return { seat, wagered: s.wagered, returned: s.returned, final, ok: final === 50000 - s.wagered + s.returned };
  };
  console.log(JSON.stringify({ tableId, dice: ra.dice, shakeToRestMs: ra.shakeToRest, readyCloseMs: closedAfter, A: check(ra, sa), B: check(rb, sb), badSpotRefused: errB.code, lateBetRefused: ra.err, phase: ra.phase }, null, 1));
  if (!check(ra, sa).ok || !check(rb, sb).ok || errB.code !== 'BAD_REQUEST' || !ra.err.includes('WRONG_PHASE')) throw new Error('multiplayer check failed');
  for (const p of [page, pageB]) await p.evaluate(() => window.sb.send({ t: 'leave' }));
  await ctxB.close();

  // the view with three players' chips, the clock and the player list
  await sitDown('sicbo_view', 1000);
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
      phase: 'betting', round: 7, deadline: now + 12500, ready: [1],
      bets: { 0: { small: 2500, 'total:9': 500 }, 1: { small: 5000, 'triple:3': 100, 'combo:2-4': 500 }, 2: { big: 1000, 'single:6': 500, 'double:6': 200 } },
      history: [[2, 3, 5], [4, 4, 6], [1, 1, 1], [3, 5, 6], [2, 2, 4], [1, 4, 6]],
    };
    t.view.onTable(snap);
  });
  await page.waitForTimeout(900);
  await shot('7-multi');
}
