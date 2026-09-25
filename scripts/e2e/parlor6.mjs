#!/usr/bin/env node
// Headless check of the parlour games on the real stack.
//
// Pachinko (--pachinko, the default): sit at Sakura Storm in the dev harness, buy in, launch a
// batch against the server, and check every ball lands in the pocket the server sent and the
// credit comes out at the server's stack; screenshot the machine from the floor, seated, mid-batch
// and settled. Then a jackpot chain played through the view (the server's draw can't be steered;
// nothing is paid) for the reach, the hit, the fever and the kakuhen.
//
// Bingo (--bingo): a solo game in the dev harness (buy cards, Call, watch it to the end, check the
// prizes against the server's), then (--multi) two players at one hall through the real table
// host: no Start, both buy cards, the clock calls the balls, both settle.
//
// Fit (--fit): both games mid-play (bingo with four cards on the screen, pachinko mid-batch) at
// 1280x600, 1024x640 and 900x1000: every corner of the board on the screen and clear of the
// controls (table/fit.ts), and every control on the screen.
//
// Usage: node scripts/e2e/parlor6.mjs [port] [outDir] [--pachinko] [--bingo] [--multi] [--fit] [--quick]
// GPU=1 uses the Mac's GPU; CALM=1 turns Reduce flashing & motion on. Fixed names parlor6_e2e_*.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (f) => process.argv.includes(f);
const [port = '6320', outDir = '/tmp/parlor6-shots'] = args;
mkdirSync(outDir, { recursive: true });
const base = `http://localhost:${port}`;
const gpu = process.env.GPU === '1';
const browser = await chromium.launch({
  args: gpu ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  headless: true,
});
const results = {};
const errors = [];
let failed = false;

async function newPage(viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript((calm) => {
    localStorage.setItem('casino.tips', '0');
    // CALM=1: Reduce flashing & motion on
    localStorage.setItem('casino.calm', calm ? '1' : '0');
  }, process.env.CALM === '1');
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return page;
}

async function sitDown(p, dollars) {
  const seated = () => (window.casino?.table?.view?.debug?.state().stack ?? 0) > 0;
  await p.waitForFunction(() => !!document.querySelector('.modal input[type=number]') || (window.casino?.table?.view?.debug?.state().stack ?? 0) > 0, null, { timeout: 90000, polling: 100 });
  if (!(await p.evaluate(seated))) {
    await p.fill('.modal input[type=number]', dollars);
    await p.click('.modal .btn.primary', { force: true });
    await p.waitForFunction(seated, null, { timeout: 90000, polling: 100 });
  }
}

const shot = async (page, name) => {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  console.log('shot', path);
};

if (flag('--pachinko') || !(flag('--bingo') || flag('--multi'))) await pachinko();
if (flag('--bingo')) await bingoSolo();
if (flag('--multi')) await bingoMulti();
if (flag('--fit')) await fits();

console.log(JSON.stringify({ results, errors: errors.slice(0, 12) }, null, 1));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);

// ---------------------------------------------------------------------------------------------

async function pachinko() {
  const page = await newPage();
  const launches = [];
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        if (msg.t === 'ev') for (const e of msg.events) if (e.type === 'launch') launches.push(e);
      } catch {}
    }),
  );
  await page.goto(`${base}/casino/?dev=table&game=pachinko&name=parlor6_e2e_pa`);
  await sitDown(page, '2000');
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const state = () => page.evaluate(() => window.casino.table.view.debug.state());
  const home = await page.evaluate(() => ({ p: window.casino.engine.camera.position.toArray(), q: window.casino.engine.camera.quaternion.toArray() }));
  // from the aisle, as someone walking by sees it
  await page.evaluate(() => {
    const c = window.casino.engine.camera;
    c.position.set(1.3, 1.6, 2.2);
    c.lookAt(0, 1.3, 0);
  });
  await page.waitForTimeout(500);
  await shot(page, 'pa-0-floor');
  await page.evaluate(({ p, q }) => {
    window.casino.engine.camera.position.fromArray(p);
    window.casino.engine.camera.quaternion.fromArray(q);
  }, home);
  await page.waitForTimeout(400);
  const frame = await page.evaluate(() => ({ ms: window.casino.engine.frameMs(), calls: window.casino.engine.renderer.info.render.calls, tris: window.casino.engine.renderer.info.render.triangles }));
  console.log('frame', JSON.stringify(frame));
  await shot(page, 'pa-1-seated');
  if (flag('--quick')) return;

  const before = (await state()).stack;
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.casino.table.view.debug.state().flying > 4, null, { timeout: 20000, polling: 50 });
  await page.waitForTimeout(900);
  await shot(page, 'pa-2-firing');
  // record where every ball actually ends, against what the server sent
  const seen = await page.evaluate(async () => {
    const v = window.casino.table.view;
    const ends = [];
    const known = new Set();
    const t0 = performance.now();
    while (performance.now() - t0 < 60000) {
      const s = v.debug.state();
      ends.push(...s.ends);
      if (!s.batches.length && !s.flying && s.show === 'idle' && !s.holds) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    void known;
    return v.debug.state();
  });
  await page.waitForTimeout(300);
  await shot(page, 'pa-3-settled');
  const ev = launches.at(-1);
  const credit = seen.credit;
  const counts = {};
  for (const s of ev?.shots ?? []) counts[s.pocket] = (counts[s.pocket] ?? 0) + 1;
  results.pachinko = { before, bet: ev?.bet, balls: ev?.balls, payout: ev?.payout, serverStack: ev?.stack, credit, pockets: counts, simulated: seen.simulated };
  if (!ev || credit !== ev.stack || seen.stack !== ev.stack) failed = true;

  // every ball lands where it was sent: each flight the view took ended in its ball's pocket
  const fired = (await state()).fired;
  const wrong = fired.filter(([sent, end]) => sent !== end);
  results.pachinkoFlights = { fired: fired.length, wrong: wrong.length };
  if (wrong.length || fired.length < 25) failed = true;

  // a jackpot chain through the view: 7-7-7 (kakuhen), then 4 (the end), for the presentation
  await page.evaluate(() => {
    const v = window.casino.table.view;
    const st = v.debug.state();
    const shots = Array.from({ length: 25 }, (_, i) => (i === 1 ? { pocket: 'start', reels: [7, 7, 7], chain: [7, 4] } : { pocket: i % 6 === 0 ? 'left' : 'out' }));
    const balls = 4 + 300 + 3 * 5;
    void v.onEvents([{ type: 'launch', seat: 0, round: 1000, bet: 2500, balls, payout: balls * 100, jackpots: 2, power: 40, shots, stack: st.stack, data: { spins: 0, jackpots: 2, best: 2, chains: [2] } }], null);
  });
  const waitShow = (k, ms = 40000) => page.waitForFunction((kind) => window.casino.table.view.debug.state().show === kind, k, { timeout: ms, polling: 50 });
  await waitShow('spin');
  await page.waitForTimeout(2600);
  await shot(page, 'pa-4-reach');
  await waitShow('hit');
  await page.waitForTimeout(700);
  await shot(page, 'pa-5-jackpot');
  await waitShow('fever');
  await page.waitForTimeout(3500);
  await shot(page, 'pa-6-fever');
  await waitShow('kakuhen', 30000);
  await page.waitForTimeout(600);
  await shot(page, 'pa-7-kakuhen');
  await waitShow('end', 60000);
  await page.waitForTimeout(900);
  await shot(page, 'pa-8-fever-over');
  await page.waitForFunction(() => window.casino.table.view.debug.state().show === 'idle', null, { timeout: 30000 });
  await page.close();
}

async function bingoSolo() {
  const page = await newPage();
  await page.goto(`${base}/casino/?dev=table&game=bingo&name=parlor6_e2e_bg`);
  await sitDown(page, '2000');
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 90000 });
  const state = () => page.evaluate(() => window.casino.table.view.debug.state());
  // a game left running from an earlier run plays out first
  await page.waitForFunction(() => window.casino.table.view.debug.state().phase === 'buying', null, { timeout: 120000, polling: 100 });
  await page.waitForTimeout(800);
  await shot(page, 'bg-0-sale');
  const home = await page.evaluate(() => ({ p: window.casino.engine.camera.position.toArray(), q: window.casino.engine.camera.quaternion.toArray() }));
  await page.evaluate(() => {
    const c = window.casino.engine.camera;
    c.position.set(4.2, 2.4, 5.2);
    c.lookAt(0, 1.0, -1.2);
  });
  await page.waitForTimeout(500);
  await shot(page, 'bg-0-hall');
  await page.evaluate(({ p, q }) => {
    window.casino.engine.camera.position.fromArray(p);
    window.casino.engine.camera.quaternion.fromArray(q);
  }, home);
  const before = (await state()).stack;
  await page.keyboard.press('4');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.casino.table.view.debug.state().cards.length === 4, null, { timeout: 15000, polling: 50 });
  await page.waitForTimeout(400);
  await shot(page, 'bg-1-cards');
  if (flag('--quick')) return;
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.casino.table.view.debug.state().called.length >= 12, null, { timeout: 60000, polling: 100 });
  await shot(page, 'bg-2-calling');
  await page.waitForFunction(() => window.casino.table.view.debug.state().phase === 'results', null, { timeout: 120000, polling: 100 });
  await page.waitForTimeout(1200);
  await shot(page, 'bg-3-over');
  const st = await state();
  // every card's prizes, worked out here from the balls the view showed, against what the server paid
  const rules = await import('../../shared/src/games/bingo/rules.ts');
  const at = new Array(76).fill(Infinity);
  st.called.forEach((b, i) => (at[b] = i + 1));
  let expected = 0;
  let paid = 0;
  const mismatches = [];
  for (const c of st.cards) {
    const done = rules.completions(c.nums, at);
    for (const p of rules.PATTERNS) {
      const want = done[p] <= st.called.length ? rules.prizeFor(p, done[p], c.stake) : 0;
      const got = c.won[p]?.paid ?? 0;
      expected += want;
      paid += got;
      if (want !== got) mismatches.push({ card: c.id, p, want, got });
    }
  }
  const cost = st.cards.reduce((n, c) => n + c.stake, 0);
  await page.waitForTimeout(600);
  const after = (await state()).stack;
  results.bingoSolo = { calls: st.called.length, cards: st.cards.length, cost, expected, paid, mismatches, before, after, ok: mismatches.length === 0 && after === before - cost + paid };
  if (!results.bingoSolo.ok) failed = true;
  await page.close();
}
/**
 * Two players at one hall through the real table host, raw sockets from inside pages (so the
 * Origin is the dev site's): nobody presses Start, both buy cards in the sale, the clock calls the
 * balls, both seats settle to the cent; spectators and the other seat never see a card's numbers
 * or a ball before it is called. Then the view is shown a busy hall for a screenshot.
 */
async function bingoMulti() {
  const page = await newPage();
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  for (const p of [page, pageB]) await p.goto(`${base}/casino/fonts/cinzel/OFL.txt`);
  const login = (p, name) => p.evaluate(async (n) => (await (await fetch('/casino/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, password: 'casino-dev' }) })).json()).token, name);
  const tA = await login(page, 'parlor6_e2e_ann');
  const tB = await login(pageB, 'parlor6_e2e_bo');
  if (!tA || !tB) throw new Error('login failed (new-account limit?)');
  const made = await page.evaluate(async (t) => (await (await fetch('/casino/api/tables', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` }, body: JSON.stringify({ game: 'bingo', variant: '', visibility: 'public' }) })).json()), tA);
  const tableId = made.tableId;
  if (!tableId) throw new Error(`no table: ${JSON.stringify(made)}`);
  const open = (p, t) =>
    p.evaluate(async ([id, tok]) => {
      const { ticket } = await (await fetch('/casino/api/ticket', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ target: `table/${id}` }) })).json();
      return new Promise((res, rej) => {
        const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/casino/ws/table/${id}?v=1&ticket=${encodeURIComponent(ticket)}`);
        window.bg = { ws, msgs: [], aid: 0, send: (m) => ws.send(JSON.stringify(m)), act: (a) => ws.send(JSON.stringify({ t: 'act', aid: `x${window.bg.aid++}`, a })) };
        ws.onmessage = (e) => window.bg.msgs.push(JSON.parse(e.data));
        ws.onopen = () => res(true);
        ws.onerror = () => rej(new Error('socket failed'));
      });
    }, [tableId, t]);
  await open(page, tA);
  await open(pageB, tB);
  const wait = (p, pred, ms = 60000, arg) => p.waitForFunction(pred, arg, { timeout: ms, polling: 100 });
  for (const p of [page, pageB]) await p.evaluate(() => window.bg.send({ t: 'buyin', aid: 'b1', amount: 50000 }));
  for (const p of [page, pageB]) await wait(p, () => window.bg.msgs.some((m) => m.t === 'seat' && m.status === 'seated'));
  // no Start: the first seat opens the sale
  for (const p of [page, pageB]) await wait(p, () => window.bg.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'buying')));
  const started = await page.evaluate(() => window.bg.msgs.find((m) => m.t === 'table').meta.started);
  const seatOf = (p) => p.evaluate(() => window.bg.msgs.filter((m) => m.t === 'seat').at(-1).seat);
  const [sa, sb] = [await seatOf(page), await seatOf(pageB)];
  await page.evaluate(() => window.bg.act({ type: 'buy', count: 3, stake: 500 }));
  await pageB.evaluate(() => window.bg.act({ type: 'max', count: 2 }));
  await pageB.evaluate(() => window.bg.act({ type: 'call' })); // nobody starts a shared hall
  await pageB.evaluate(() => window.bg.act({ type: 'buy', count: 5, stake: 100 })); // malformed: five cards
  await wait(pageB, () => window.bg.msgs.filter((m) => m.t === 'err').length >= 2);
  const errsB = await pageB.evaluate(() => window.bg.msgs.filter((m) => m.t === 'err').map((m) => m.code));
  // the whole game on the clock
  for (const p of [page, pageB]) await wait(p, () => window.bg.msgs.some((m) => m.t === 'ev' && m.events.some((e) => e.type === 'end')), 200000);
  const report = (p, seat) =>
    p.evaluate((s) => {
      const evs = window.bg.msgs.filter((m) => m.t === 'ev').flatMap((m) => m.events);
      const mine = evs.filter((e) => e.type === 'cards').flatMap((e) => e.cards);
      const others = evs.filter((e) => e.type === 'cards' && e.seat !== s).length;
      const balls = evs.filter((e) => e.type === 'ball').map((e) => e.ball);
      const wins = evs.filter((e) => e.type === 'win');
      const end = evs.find((e) => e.type === 'end');
      const stacks = window.bg.msgs.filter((m) => m.t === 'seat').map((m) => m.stack);
      // what a view said was called, at each point, never ran ahead of the balls told so far
      let told = 0;
      let ahead = 0;
      for (const m of window.bg.msgs) {
        if (m.t === 'ev') {
          told += m.events.filter((e) => e.type === 'ball').length;
          if (m.view.called.length > told) ahead++;
          if (JSON.stringify(m).includes('"order"')) ahead++;
        }
      }
      return { mine, others, balls, wins, end, stacks, ahead };
    }, seat);
  const ra = await report(page, sa);
  const rb = await report(pageB, sb);
  const rules = await import('../../shared/src/games/bingo/rules.ts');
  const check = (r, seat) => {
    const at = new Array(76).fill(Infinity);
    r.balls.forEach((b, i) => (at[b] = i + 1));
    let expected = 0;
    for (const c of r.mine) {
      const done = rules.completions(c.nums, at);
      for (const p of rules.PATTERNS) if (done[p] <= r.balls.length) expected += rules.prizeFor(p, done[p], c.stake);
    }
    const res = r.end.seats[seat];
    const cost = r.mine.reduce((n, c) => n + c.stake, 0);
    const paid = r.wins.filter((w) => w.seat === seat).reduce((n, w) => n + w.paid, 0);
    return { seat, cards: r.mine.length, cost, expected, paid, returned: res.returned, wagered: res.wagered, final: r.stacks.at(-1), leaks: r.others + r.ahead, ok: expected === paid && paid === res.returned && cost === res.wagered && r.stacks.at(-1) === 50000 - cost + paid && r.others === 0 && r.ahead === 0 };
  };
  const A = check(ra, sa);
  const B = check(rb, sb);
  const sameBalls = JSON.stringify(ra.balls) === JSON.stringify(rb.balls);
  results.bingoMulti = { tableId, startedWithoutLeader: started, calls: ra.balls.length, sameBalls, A, B, refusedB: errsB };
  if (!started || !A.ok || !B.ok || !sameBalls || !errsB.includes('BAD_REQUEST')) failed = true;
  for (const p of [page, pageB]) await p.evaluate(() => window.bg.send({ t: 'leave' }));
  await ctxB.close();

  // the view in a busy hall: a snapshot with players around you, mid-game
  await page.goto(`${base}/casino/?dev=table&game=bingo&name=parlor6_e2e_view`);
  await sitDown(page, '1000');
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const t = window.casino.table;
    const snap = structuredClone(t.snapshot);
    snap.meta.mode = 'multi';
    snap.you.seat = 13;
    snap.you.status = 'seated';
    const me = snap.members[0];
    const names = ['Marisol', 'Theo', 'Ade', 'Priya', 'Kenji', 'Rosa', 'Dmitri', 'Hollis', 'June', 'Walt', 'Ines'];
    snap.members = [{ ...me, seat: 13, status: 'seated' }, ...names.map((n, i) => ({ ...me, accountId: 9000 + i, name: n, seat: i * 3, status: 'seated', stack: 100000 + i * 7300, connected: i !== 4 }))];
    const called = [7, 22, 41, 60, 68, 3, 17, 33, 52, 71, 12, 28, 44, 57, 63, 9, 19, 38];
    const card = (id, nums, won) => ({ id, nums, stake: 500, won });
    const mine = [
      card(1, [7, 22, 41, 60, 68, 3, 17, 33, 52, 71, 12, 28, 0, 57, 63, 9, 19, 38, 46, 74, 1, 16, 31, 55, 70], { line: { call: 5, paid: 250000 } }),
      card(2, [2, 18, 34, 49, 61, 4, 20, 36, 50, 62, 5, 21, 0, 51, 64, 6, 23, 39, 53, 66, 8, 24, 40, 54, 67], {}),
      card(3, [10, 25, 42, 56, 69, 11, 26, 43, 58, 72, 13, 27, 0, 59, 73, 14, 29, 45, 47, 75, 15, 30, 35, 48, 65], {}),
    ];
    const players = { 13: { cards: 3, staked: 1500, won: 250000, best: 2 } };
    names.forEach((_, i) => (players[i * 3] = { cards: 1 + (i % 4), staked: 500 * (1 + (i % 4)), won: i === 2 ? 40000 : 0, best: i % 3 === 0 ? 1 : 3 }));
    snap.view = { phase: 'calling', round: 12, deadline: Date.now() + 2000, window: 25000, callMs: 2200, called, mine, players, results: {}, history: [], canRebuy: [] };
    t.view.onTable(snap);
  });
  await page.waitForTimeout(1200);
  await shot(page, 'bg-4-hall-multi');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await shot(page, 'bg-5-phone');
  await page.close();
}

/** Where the board's corners land on the screen, and the controls' boxes, as scripts/e2e/fit6.mjs measures them. */
function measureFit(page) {
  return page.evaluate(() => {
    const W = innerWidth;
    const H = innerHeight;
    const stage = window.casino.table.stage;
    const cam = stage.engine.camera;
    cam.updateMatrixWorld();
    const pts = stage.fit.keyPoints().map((p) => {
      const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
      const behind = v.z > -0.01;
      v.applyMatrix4(cam.projectionMatrix);
      return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, behind };
    });
    const ui = [];
    const skip = ['modal', 'scrim', 'toasts', 'toast', 'celebrate'];
    for (const e of document.getElementById('ui').children) {
      if (e.hidden || skip.some((c) => e.classList.contains(c)) || e.dataset.fit === 'ignore' || e.classList.contains('pass')) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.width * r.height > 0.45 * W * H) continue;
      ui.push({ cls: [...e.classList].join('.'), left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    return { W, H, pts, ui, zoom: stage.fit.debug().lens.zoom };
  });
}

async function fitSweep(page, game) {
  for (const [w, h] of [[1280, 600], [1024, 640], [900, 1000]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1500);
    const m = await measureFit(page);
    const bad = [];
    for (const p of m.pts) {
      if (p.behind || p.x < -1 || p.y < -1 || p.x > m.W + 1 || p.y > m.H + 1) bad.push(`(${p.x.toFixed(0)},${p.y.toFixed(0)}) off screen`);
      else {
        const under = m.ui.find((r) => p.x > r.left + 1 && p.x < r.right - 1 && p.y > r.top + 1 && p.y < r.bottom - 1);
        if (under) bad.push(`(${p.x.toFixed(0)},${p.y.toFixed(0)}) under ${under.cls}`);
      }
    }
    for (const r of m.ui) if (r.left < -1 || r.right > m.W + 1 || r.bottom > m.H + 1) bad.push(`${r.cls} runs off the edge`);
    (results.fit ??= []).push({ game, size: `${w}x${h}`, points: m.pts.length, zoom: +m.zoom.toFixed(2), bad });
    if (bad.length || !m.pts.length) failed = true;
    await shot(page, `fit-${game}-${w}x${h}`);
  }
}

async function fits() {
  const page = await newPage();
  await page.goto(`${base}/casino/?dev=table&game=bingo&name=parlor6_e2e_fit`);
  await sitDown(page, '1000');
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 90000 });
  await page.waitForFunction(() => window.casino.table.view.debug.state().phase === 'buying', null, { timeout: 120000, polling: 100 });
  await page.keyboard.press('4');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.casino.table.view.debug.state().cards.length === 4, null, { timeout: 15000 });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.casino.table.view.debug.state().called.length >= 3, null, { timeout: 30000 });
  await fitSweep(page, 'bingo');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/casino/?dev=table&game=pachinko&name=parlor6_e2e_fit`);
  await sitDown(page, '1000');
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.casino.table.view.debug.state().flying > 2, null, { timeout: 20000 });
  await fitSweep(page, 'pachinko');
  await page.close();
}
