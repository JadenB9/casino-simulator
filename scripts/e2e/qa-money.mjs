#!/usr/bin/env node
// The money pass, headless, on the real floor (not the dev harness): every online game at its desk
// in the Online Lounge, two-player Crash, the Bandit Wheel alone and with others, and money at the
// edges (logins, buy-ins at big limits, top-ups, cash-outs, the bank, the boutique and the bar, the
// leaderboards). After each part every account it touched is audited in the local D1 with the
// load script's invariants (ledger = balance, in_play = escrows, rounds' net = what moved), and
// each page's own numbers are checked against what the server sent.
//
// Usage: node scripts/e2e/qa-money.mjs [port] [outDir] [part...]   (PORT_BASE=<port> npm run dev first)
// Parts: desks crash2 wheel money security (all of them when none is named). GL=swiftshader for
// the software renderer; on a Mac the GPU draws by default.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// v6 celebs6: bar prices follow happy hour's schedule (half price inside a window)
import { halfPrice, happyHourAt } from '../../shared/src/happyhour.ts';

const run = promisify(execFile);
const [port = '6100', out = '/tmp/qa-money', ...only] = process.argv.slice(2);
const wanted = (part) => only.length === 0 || only.includes(part);
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}`;
const apiBase = `http://127.0.0.1:${Number(port) + 1}/casino/api`;
const PASS = 'casino-dev';

const problems = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const check = (ok, what) => {
  if (!ok) problems.push(what);
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  return ok;
};
const failed = (where, err) => {
  const text = `${where}: ${String(err?.stack ?? err?.message ?? err).split('\n').slice(0, 3).join(' | ')}`;
  problems.push(text);
  log(`FAIL ${text}`);
};
const money = (c) => (c < 0 ? '-' : '') + '$' + Math.floor(Math.abs(c) / 100).toLocaleString('en-US') + (Math.abs(c) % 100 ? '.' + String(Math.abs(c) % 100).padStart(2, '0') : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the server side: the API as a client calls it, and the local D1 --------------------------------

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { Origin: base, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase}/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json, text };
}

async function sql(query) {
  const { stdout } = await run('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', query], {
    env: { ...process.env, CI: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout.slice(stdout.indexOf('[')))[0]?.results ?? [];
}

/** Cash feats have paid this account (v6: grants beside the play, never part of a round's net). */
async function featPaid(id) {
  return (await sql(`SELECT COALESCE(SUM(amount), 0) AS n FROM casino_ledger WHERE account_id = ${Number(id)} AND op_id LIKE 'feat:%'`))[0]?.n ?? 0;
}

/** The load script's audit (scripts/load/net.mjs), for the named accounts. */
async function audit(names, where) {
  const list = names.map((n) => `'${n.replace(/'/g, '')}'`).join(',');
  const rows = await sql(
    `SELECT a.id, a.name, a.balance, a.in_play,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id) AS ledger,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id AND l.kind IN ('buyin', 'cashout', 'refund')) AS moved,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id AND l.kind IN ('grant', 'loan')) AS granted,
            (SELECT COALESCE(SUM(price), 0) FROM casino_items i WHERE i.account_id = a.id)
              + (SELECT COALESCE(SUM(price), 0) FROM casino_orders o WHERE o.account_id = a.id)
              - (SELECT COALESCE(SUM(cash), 0) FROM casino_bank b WHERE b.account_id = a.id) AS spent, -- v6 bank6: what went to (or came from) the bank counts like spending
            (SELECT COALESCE(SUM(net), 0) FROM casino_stats s WHERE s.account_id = a.id) AS net,
            (SELECT COALESCE(SUM(rounds), 0) FROM casino_stats s WHERE s.account_id = a.id) AS rounds,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_escrow e WHERE e.account_id = a.id) AS escrow,
            (SELECT COUNT(*) FROM casino_loans o WHERE o.account_id = a.id) AS loans,
            a.loans_taken
       FROM casino_accounts a WHERE a.name IN (${list}) ORDER BY a.id`,
  );
  let ok = true;
  for (const r of rows) {
    const bad = [];
    if (r.ledger - r.spent !== r.balance) bad.push(`ledger ${r.ledger} less purchases ${r.spent} but balance ${r.balance}`);
    if (r.in_play !== r.escrow) bad.push(`in_play ${r.in_play} but escrows ${r.escrow}`);
    if (r.escrow === 0 && r.balance !== r.granted + r.net - r.spent) bad.push(`balance ${r.balance} but granted ${r.granted} + net ${r.net} - spent ${r.spent}`);
    if (r.escrow === 0 && r.moved !== r.net) bad.push(`${r.moved} moved at the edges but rounds' net is ${r.net}`);
    if (r.loans !== r.loans_taken) bad.push(`${r.loans} loan rows but loans_taken ${r.loans_taken}`);
    ok = check(bad.length === 0, `${where}: ${r.name} reconciles (balance ${money(r.balance)}, in play ${money(r.in_play)}, ${r.rounds} rounds, net ${money(r.net)})${bad.length ? ': ' + bad.join('; ') : ''}`) && ok;
  }
  check(rows.length === names.length, `${where}: audited ${rows.length} of ${names.length} accounts`);
  return rows;
}

async function clearRate() {
  await sql('DELETE FROM casino_rate');
}

// --- the browser -------------------------------------------------------------------------------------

const gl = process.env.GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const glArgs = gl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: [...glArgs, `--explicitly-allowed-ports=${port},${Number(port) + 1}`] });

/** A page with its errors and every table frame it receives kept. */
async function newPage(name, { quality = 'high', viewport = { width: 1280, height: 800 }, tips = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(
    ([q, t]) => {
      localStorage.setItem('casino.quality', q);
      localStorage.setItem('casino.tips', t ? '1' : '0');
      for (const k of Object.keys(localStorage)) if (k.startsWith('casino.limits.')) localStorage.removeItem(k);
    },
    [quality, tips],
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  const errors = [];
  const frames = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource|WebSocket connection/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  // a page that loads again on its own (a crash, the dev server's reload) would lose its table: say so
  let loads = 0;
  page.on('load', () => {
    if (++loads > 1) log(`${name}: the page loaded again (${page.url()})`);
  });
  page.on('websocket', (ws) => {
    const table = /\/ws\/(table|solo)\//.test(ws.url());
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        msg.__table = table;
        msg.__at = Date.now();
        frames.push(msg);
      } catch {}
    });
  });
  return { page, ctx, errors, frames, name };
}

/** Log in through the real menu and end on the floor with the HUD up. */
async function login(p, { password = PASS } = {}) {
  const { page, name } = p;
  await page.goto(`${base}/casino/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.name-input', { timeout: 300_000 });
  await page.fill('.name-input', name);
  await page.fill('.pass-input', password);
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else {
    await page.click('.menu-item >> nth=0');
  }
  await page.waitForSelector('.hud', { timeout: 60_000 });
  await page.waitForTimeout(500);
  return p;
}

async function player(name, opts) {
  return login(await newPage(name, opts));
}

const token = (p) => p.page.evaluate(() => sessionStorage.getItem('casino.token'));
const me = async (p) => (await api('me', { token: await token(p) })).body?.profile;

/** Walk up to a station (teleported in front of it) and press E there. */
async function walkUp(p, id, seat = null) {
  await p.page.evaluate(
    ([id, seat]) => {
      const w = window.casino.world;
      const s = w.stations.find((x) => x.id === id);
      const a = s.anchor.position;
      w.teleport(a.x + Math.sin(s.yaw) * 2, a.z + Math.cos(s.yaw) * 2, s.yaw + Math.PI);
      w.enter(s, seat);
    },
    [id, seat],
  );
}

/** The station panel: pick a tier and press S; then the buy-in (dollars). Resolves once seated. */
async function sitSolo(p, id, { tier = 'Standard', buyin = '1000', shotAs = null } = {}) {
  const { page } = p;
  await walkUp(p, id);
  await page.waitForSelector('.lim-opt', { timeout: 20_000 });
  await page.click(`.lim-opt:has-text("${tier}")`);
  if (shotAs) await shoot(page, `${shotAs}-picker`);
  await page.keyboard.press('s');
  await page.waitForFunction(() => !!document.querySelector('.modal input[type=number]') || window.casino.app.table?.seated === true, null, { timeout: 30_000 });
  // a seat still held from an earlier run (inside its two minutes) comes back with its chips
  if (await page.evaluate(() => window.casino.app.table?.seated === true)) {
    log(`${p.name}: sat back down at ${id} with chips still on it`);
    return false;
  }
  if (shotAs) await shoot(page, `${shotAs}-buyin`);
  await page.fill('.modal input[type=number]', buyin);
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
  return true;
}

async function shoot(page, name) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

/** Stand up the way Esc does (confirming the Leave), and wait for the chips to come home. */
async function leave(p) {
  const { page } = p;
  // Esc does nothing while the camera is still flying in: try again until the question comes up
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Escape');
    const btn = await page.waitForSelector('.modal .btn.primary:has-text("Leave")', { timeout: 1500 }).catch(() => null);
    if (btn) {
      await btn.click();
      break;
    }
    if (await page.evaluate(() => !window.casino.app.table)) break;
  }
  await page.waitForFunction(() => !window.casino.app.table, null, { timeout: 20_000 });
}

/** Wait until the profile says nothing is on a table, and return it. */
async function settled(p, ms = 20_000) {
  const until = Date.now() + ms;
  for (;;) {
    const prof = await me(p);
    if (prof && prof.inPlay === 0) return prof;
    if (Date.now() > until) return prof;
    await sleep(500);
  }
}

const tableFrames = (p, since = 0) => p.frames.filter((m) => m.__table && m.__at >= since);
const eventsOf = (p, type, since = 0) => tableFrames(p, since).flatMap((m) => (m.t === 'ev' ? m.events.filter((e) => e.type === type) : []));
const lastSeat = (p) => tableFrames(p).filter((m) => m.t === 'seat').at(-1);

// ------------------------------------------------------------------------------------------------------
// Part: every online game at its desk

const pages = [];

if (wanted('desks')) {
  let p = null;
  try {
    await clearRate();
    p = await player('qm_desks');
    pages.push(p);
    const { page } = p;
    // chips still held on a table from an interrupted run come home first (two minutes at most)
    const start = await settled(p, 180_000);
    log(`qm_desks: balance ${money(start.balance)}`);

    const games = (process.env.GAMES ?? 'plinko,dice,limbo,keno,tower,mines,hilo,crash').split(',');
    for (const game of games) {
      const prefix = { plinko: 'pk', dice: 'dc', limbo: 'lb', keno: 'kn', tower: 'tw', mines: 'mn', hilo: 'hl', crash: 'cs' }[game];
      const since = Date.now();
      const before = await me(p);
      const paidBefore = await featPaid(before.id);
      await walkUp(p, `${prefix}-1`);
      // the fly-in, a third of the way and at rest, with the station panel up
      await page.waitForTimeout(300);
      await shoot(page, `desk-${game}-0-flying-in`);
      await page.waitForSelector('.lim-opt', { timeout: 20_000 });
      const tiers = await page.$$eval('.lim-opt', (bs) => bs.map((x) => x.textContent.trim()));
      check(tiers.length === 7, `${game}: the picker offers seven choices: ${tiers.join(' | ')}`);
      await page.click('.lim-opt:has-text("Standard")');
      const buyinLine = await page.textContent('.lim-buyin').catch(() => '');
      check(/\$10.\$100,000/.test(buyinLine), `${game}: Standard's buy-in is $10 to $100,000: "${buyinLine}"`);
      await page.waitForTimeout(700);
      await shoot(page, `desk-${game}-1-picker`);
      if (game === 'crash') {
        const note = await page.textContent('.lobby-choice >> nth=0');
        check(!/dealer/i.test(note), `crash: the single-player choice doesn't talk about a dealer: "${note.trim()}"`);
      }
      await page.keyboard.press('s');
      await page.waitForSelector('.modal input[type=number]', { timeout: 30_000 });
      await shoot(page, `desk-${game}-2-buyin`);
      await page.fill('.modal input[type=number]', '500');
      await page.click('.modal .btn.primary');
      await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
      await page.waitForSelector('.os-screen:not([hidden])', { timeout: 30_000 });
      await page.waitForFunction(() => document.querySelector('.os-stack-value')?.textContent === '$500', null, { timeout: 15_000 }).catch(() => null);
      await page.waitForTimeout(600);
      await shoot(page, `desk-${game}-3-seated`);
      check((await page.textContent('.os-stack-value')) === '$500', `${game}: the page shows the $500 bought in`);
      // Max = the table max or the chips here, whichever is less: $500 of chips at a $1,000 max
      await page.click('.os-chip-btn:has-text("Max")');
      const maxed = await page.inputValue('.os-bet-input');
      check(maxed === '500', `${game}: Max bets the $500 here (under the $1,000 max): "${maxed}"`);
      await page.fill('.os-bet-input', '5');
      await page.press('.os-bet-input', 'Enter');
      await page.waitForTimeout(200);

      await playOne(p, game, since);
      await page.waitForTimeout(1500);
      await shoot(page, `desk-${game}-4-played`);
      if (game === 'dice') {
        // the site's cashier: Add chips tops the stack up from the balance, saying how much fits
        const stackBefore = await page.evaluate(() => window.casino.app.table.session.snapshot.you.stack);
        await page.click('.os-add');
        await page.waitForSelector('.modal input[type=number]', { timeout: 10_000 });
        const said = await page.textContent('.modal p');
        check(/You have \$[0-9,.]+ here, and this table takes \$100,000 at most: add up to \$[0-9,]+\./.test(said), `Add chips says how much more fits: "${said}"`);
        await shoot(page, 'desk-dice-4b-add-chips');
        await page.fill('.modal input[type=number]', '250');
        await page.click('.modal .btn.primary');
        await page.waitForFunction((b) => window.casino.app.table.session.snapshot.you.stack === b + 25_000, stackBefore, { timeout: 15_000 });
        await page.waitForTimeout(400);
        check((await page.textContent('.os-stack-value')) === money(stackBefore + 25_000), `Add chips: $250 more on the stack, ${await page.textContent('.os-stack-value')} shown`);
      }

      // what the page shows is what the server holds
      const seat = lastSeat(p);
      const stackEv = tableFrames(p, since).filter((m) => m.t === 'ev').flatMap((m) => m.events).filter((e) => typeof e.stack === 'number').at(-1);
      const shown = await page.textContent('.os-stack-value');
      const serverStack = await page.evaluate(() => window.casino.app.table.session.snapshot.you.stack);
      check(shown === money(serverStack), `${game}: the page's chips ${shown} are the server's ${money(serverStack)}`);
      // stand up, fly out
      await page.keyboard.press('Escape');
      const btn = await page.waitForSelector('.modal .btn.primary:has-text("Leave")', { timeout: 5000 }).catch(() => null);
      if (btn) await btn.click();
      await page.waitForTimeout(250);
      await shoot(page, `desk-${game}-5-flying-out`);
      await page.waitForFunction(() => !window.casino.app.table, null, { timeout: 20_000 });
      const after = await settled(p);
      const rounds = roundsOf(p, game, since);
      const net = rounds.reduce((s, r) => s + r.returned - r.wagered, 0);
      const feats = (await featPaid(after.id)) - paidBefore;
      check(after.balance - before.balance - feats === net, `${game}: the balance moved by the rounds' net ${money(net)} (${rounds.length} rounds) and ${money(feats)} of feats: ${money(before.balance)} to ${money(after.balance)}`);
      for (const r of rounds) check(r.expected === null || r.expected === r.returned, `${game}: ${r.what} paid ${money(r.returned)}${r.expected !== null ? `, expected ${money(r.expected)}` : ''}`);
      check(after.inPlay === 0, `${game}: nothing left on the table`);
    }
    // Custom limits at a desk: the rule said as they're typed, the page and the server at the pick
    {
      const since = Date.now();
      await walkUp(p, 'kn-1');
      await page.waitForSelector('.lim-opt', { timeout: 20_000 });
      await page.click('.lim-opt:has-text("Custom")');
      await page.fill('.lim-input >> nth=0', '20000');
      await page.fill('.lim-input >> nth=1', '100000');
      const tooHigh = await page.textContent('.lim-rule');
      check(/\$10,000/.test(tooHigh) && (await page.isDisabled('.lobby-choice >> nth=0')), `Custom: a $20,000 minimum at an online game is refused in words: "${tooHigh}"`);
      await page.fill('.lim-input >> nth=0', '3');
      await page.fill('.lim-input >> nth=1', '2500');
      await page.waitForTimeout(200);
      await shoot(page, 'desk-keno-custom-picker');
      await page.keyboard.press('Tab');
      await page.click('.lobby-choice >> nth=0');
      await page.waitForSelector('.modal input[type=number]', { timeout: 30_000 });
      const line = await page.textContent('.modal p');
      check(/takes \$30 to \$250,000/.test(line), `Custom $3 to $2,500: the buy-in scales with it: "${line}"`);
      await page.fill('.modal input[type=number]', '300');
      await page.click('.modal .btn.primary');
      await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
      await page.waitForSelector('.os-screen:not([hidden])');
      await page.waitForTimeout(700);
      const range = await page.textContent('.os-bet-range');
      const cfg = await page.evaluate(() => window.casino.app.table.session.snapshot.meta.config.limits.default);
      check(range === '$3 to $2,500' && cfg.min === 300 && cfg.max === 250_000, `the page and the table are at $3 to $2,500 ("${range}", server ${cfg.min}-${cfg.max})`);
      const refused = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const s = window.casino.app.table.session;
            const orig = s.onMessage.bind(s);
            s.onMessage = (m) => {
              orig(m);
              if (m.t === 'err') resolve(m.msg);
              if (m.t === 'ev') resolve(null);
            };
            s.link.act({ type: 'bet', bet: 200, risk: 'classic', picks: [1, 2, 3] });
            setTimeout(() => resolve('no answer'), 5000);
          }),
      );
      check(refused !== null && /\$3/.test(refused), `a $2 bet under the $3 minimum is refused: "${refused}"`);
      await shoot(page, 'desk-keno-custom-seated');
      await leave(p);
      await settled(p);
      void since;
    }
    await audit(['qm_desks'], 'desks');
  } catch (err) {
    failed('desks', err);
    if (p) await shoot(p.page, 'desk-failure').catch(() => null);
  }
}

// ------------------------------------------------------------------------------------------------------
// Part: two players at one Crash table, from two desks; one drops mid-flight

/** Open a multiplayer table from a station: M, then Public (the picked tier), then Sit down. */
async function openLobby(p, id, { tier = 'Standard', buyin = '1000' } = {}) {
  const { page } = p;
  await walkUp(p, id);
  await page.waitForSelector('.lim-opt', { timeout: 20_000 });
  await page.click(`.lim-opt:has-text("${tier}")`);
  await page.keyboard.press('m');
  await page.waitForSelector('.lobby-actions .btn', { timeout: 10_000 });
  await page.click('.lobby-actions .btn:has-text("Public")');
  await page.waitForFunction(() => !!document.querySelector('.modal input[type=number]') || [...document.querySelectorAll('.party-row .btn')].some((b) => b.textContent === 'Sit down'), null, { timeout: 20_000 });
  if (!(await page.$('.modal input[type=number]'))) await page.click('.party-row .btn:has-text("Sit down")');
  await page.waitForSelector('.modal input[type=number]', { timeout: 10_000 });
  await page.fill('.modal input[type=number]', buyin);
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
  return page.evaluate(() => window.casino.app.table.session.snapshot.meta.tableId);
}

/** Join an open table from the list at a station, and sit down. */
async function joinLobby(p, id, tableId, buyin = '1000') {
  const { page } = p;
  await walkUp(p, id);
  await page.waitForSelector('.lobby-choice', { timeout: 20_000 });
  await page.keyboard.press('m');
  const row = `.lobby-row[data-table="${tableId}"]`;
  await page.waitForSelector(row, { timeout: 20_000 });
  await page.click(row);
  await page.waitForFunction(() => !!document.querySelector('.modal input[type=number]') || [...document.querySelectorAll('.party-row .btn')].some((b) => b.textContent === 'Sit down'), null, { timeout: 20_000 });
  if (!(await page.$('.modal input[type=number]'))) await page.click('.party-row .btn:has-text("Sit down")');
  await page.waitForSelector('.modal input[type=number]', { timeout: 10_000 });
  await page.fill('.modal input[type=number]', buyin);
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
}

const crashView = (p) => p.page.evaluate(() => {
  const s = window.casino.app.table?.session;
  return s ? { phase: s.view && s.snapshot ? null : null, seat: s.snapshot?.you.seat, stack: s.snapshot?.you.stack } : null;
});

/** Wait until the page's table session reports this Crash phase (from the frames it received). */
async function crashPhase(p, phase, since, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ev = tableFrames(p, since).filter((m) => m.t === 'ev' || m.t === 'table').at(-1);
    if (ev?.view?.phase === phase) return ev;
    await sleep(100);
  }
  throw new Error(`no ${phase} phase within ${ms} ms`);
}

if (wanted('crash2')) {
  let a = null;
  let b = null;
  try {
    await clearRate();
    a = await player('qm_crash_a');
    b = await player('qm_crash_b');
    pages.push(a, b);
    const since = Date.now();
    const tableId = await openLobby(a, 'cs-1', { buyin: '1000' });
    log(`qm_crash_a opened ${tableId} at cs-1`);
    await joinLobby(b, 'cs-2', tableId, '800');
    log('qm_crash_b joined from cs-2');
    await a.page.waitForTimeout(800);
    await shoot(a.page, 'crash2-1-two-desks-a');
    await shoot(b.page, 'crash2-1-two-desks-b');
    const partyOverPage = await a.page.evaluate(() => {
      const party = document.querySelector('.party')?.getBoundingClientRect();
      const screen = document.querySelector('.os-screen')?.getBoundingClientRect();
      if (!party || !screen) return null;
      const x = Math.max(0, Math.min(party.right, screen.right) - Math.max(party.left, screen.left));
      const y = Math.max(0, Math.min(party.bottom, screen.bottom) - Math.max(party.top, screen.top));
      return Math.round((x * y) / (screen.width * screen.height) * 100);
    });
    log(`the party panel covers ${partyOverPage}% of the site`);

    // A rides an auto cash-out at 2x; B presses Cash out at about 1.2x. Wait for a fresh window
    // with most of its seven seconds left, so both bets make it.
    let t0 = Date.now();
    const fresh = async () => {
      for (;;) {
        const f = tableFrames(a, t0).filter((m) => m.t === 'ev').at(-1);
        if (f?.events.some((e) => e.type === 'betting')) return f.view.round;
        await sleep(100);
      }
    };
    const round = await Promise.race([fresh(), sleep(200_000).then(() => { throw new Error('no fresh betting window'); })]);
    log(`round ${round} opens`);
    await a.page.click('.os-seg button:has-text("Auto cash-out")');
    await a.page.fill('.os-num-input >> nth=0', '2');
    await a.page.press('.os-num-input >> nth=0', 'Enter');
    await a.page.fill('.os-bet-input', '10');
    await a.page.press('.os-bet-input', 'Enter');
    await b.page.fill('.os-bet-input', '20');
    await b.page.press('.os-bet-input', 'Enter');
    await a.page.click('.os-action:has-text("Bet")');
    await b.page.click('.os-action:has-text("Bet")');
    const betsIn = eventsOf(b, 'bet', t0).filter((e) => e.amount);
    const until = Date.now() + 20_000;
    while (Date.now() < until && !eventsOf(b, 'launch', t0).some((e) => e.round === round)) await sleep(50);
    check(eventsOf(b, 'launch', t0).some((e) => e.round === round), `round ${round} launched with both bets in (${eventsOf(b, 'bet', t0).length} bets seen)`);
    void betsIn;
    await b.page.waitForTimeout(3200); // about 1.2x
    if (await b.page.$('.os-action.cash')) await b.page.click('.os-action.cash');
    await shoot(b.page, 'crash2-2-b-cashed');
    // A drops mid-flight and stays away until the round is over: the table socket goes, and the
    // reconnects can't get a ticket. (Chromium's offline mode would do it too, but a long spell of
    // it upsets the dev server's own proxy, which then reloads every page; production has none.)
    await a.page.route('**/casino/api/ticket', (route) => route.abort('internetdisconnected'));
    await a.page.evaluate(() => window.casino.app.table.session.socket.ws?.close(4000, 'network'));
    log('qm_crash_a is offline mid-flight');
    let crashEv = null;
    for (const stop = Date.now() + 200_000; Date.now() < stop && !crashEv; await sleep(200)) crashEv = eventsOf(b, 'crash', t0).find((e) => e.round === round) ?? null;
    check(!!crashEv, `round ${round} crashed (at ${crashEv ? crashEv.crash / 100 : '?'}x)`);
    // A stays away into the next round, so the round it missed is no longer on show when it's back
    for (const stop = Date.now() + 30_000; Date.now() < stop && !eventsOf(b, 'betting', t0).some((e) => e.round === round + 1); ) await sleep(200);
    await a.page.unroute('**/casino/api/ticket');
    await a.page.waitForFunction(() => window.casino.app.table?.session.socket.state === 'open', null, { timeout: 60_000 }).catch(() => null);
    await a.page.waitForTimeout(2500);
    await shoot(a.page, 'crash2-3-a-back');
    await shoot(b.page, 'crash2-3-b-after');
    const seatA = tableFrames(a).filter((m) => m.t === 'table').at(-1)?.you?.seat;
    const seatB = tableFrames(b).filter((m) => m.t === 'table').at(-1)?.you?.seat;
    const outs = eventsOf(b, 'cashout', t0);
    const outA = outs.find((e) => e.seat === seatA);
    const outB = outs.find((e) => e.seat === seatB);
    const crashAt = crashEv?.crash ?? 0;
    if (crashAt > 200) check(outA?.at === 200 && outA.payout === 2000 && outA.how === 'auto', `A, offline, was paid by the 2x auto cash-out: ${JSON.stringify(outA)}`);
    else check(!outA && crashEv?.busted.includes(seatA), `A's 2x target wasn't reached before the crash at ${crashAt / 100}x, and A lost`);
    if (outB) {
      check(outB.how === 'manual' && outB.at < crashAt && outB.payout === (2000 / 100) * outB.at, `B's press paid ${outB.at / 100}x on $20 = ${money(outB.payout)}, below the crash at ${crashAt / 100}x`);
    } else check(crashEv?.busted.includes(seatB), `B's press came too late: the crash took it (crash ${crashAt / 100}x)`);
    const tallyA = await a.page.$$eval('.os-tally .os-stat-value', (v) => v.map((x) => x.textContent.replace('\u2212', '-')));
    const profitA = (outA?.payout ?? 0) - 1000;
    check(tallyA[0] === '1' && tallyA[1] === '$10' && tallyA[2] === (profitA > 0 ? '+' : '') + money(profitA), `A's page counts the round settled while away: ${tallyA.join(' / ')}`);
    const expectA = 100_000 - 1000 + (outA?.payout ?? 0);
    const expectB = 80_000 - 2000 + (outB?.payout ?? 0);
    // the pages agree with the server afterwards
    for (const [p, want] of [[a, expectA], [b, expectB]]) {
      await p.page.waitForTimeout(500);
      const shown = await p.page.textContent('.os-stack-value');
      const server = await p.page.evaluate(() => window.casino.app.table?.session.snapshot.you.stack);
      check(shown === money(server) && server === want, `${p.name}: the page shows ${shown}, the server holds ${money(server)}, the rounds say ${money(want)}`);
    }
    // both stand up; everything reconciles
    await leave(a);
    await leave(b);
    await settled(a);
    await settled(b);
    await audit(['qm_crash_a', 'qm_crash_b'], 'crash2');
  } catch (err) {
    failed('crash2', err);
    if (a) await shoot(a.page, 'crash2-failure-a').catch(() => null);
    if (b) await shoot(b.page, 'crash2-failure-b').catch(() => null);
  }
}

// ------------------------------------------------------------------------------------------------------
// Part: the Bandit Wheel in Bandit Camp, alone and with a second player

const wheelState = (p) => p.page.evaluate(() => window.casino.app.table?.session.view?.debug?.state());

/** Wait for the wheel's betting window with at least `ms` left in it (the spin before it finished). */
async function wheelWindow(p, ms = 6000, timeout = 90_000) {
  await p.page.waitForFunction(
    (m) => {
      const s = window.casino.app.table?.session.view?.debug?.state();
      return s && s.phase === 'betting' && !s.animating && (s.left === null || s.left > m);
    },
    ms,
    { timeout, polling: 100 },
  );
}

/** Wait for the round's settle event, the wheel to come to rest on it, and return both. */
async function wheelResult(p, since, round) {
  const until = Date.now() + 90_000;
  let settle = null;
  while (Date.now() < until && !settle) {
    settle = eventsOf(p, 'settle', since).find((e) => e.round === round) ?? null;
    if (!settle) await sleep(200);
  }
  if (!settle) throw new Error(`round ${round} never settled`);
  await p.page.waitForFunction(() => {
    const s = window.casino.app.table?.session.view?.debug?.state();
    return s && !s.animating;
  }, null, { timeout: 60_000, polling: 100 });
  await p.page.waitForTimeout(400);
  return { settle, state: await wheelState(p) };
}

if (wanted('wheel')) {
  let a = null;
  let b = null;
  try {
    await clearRate();
    a = await player('qm_wheel_a');
    pages.push(a);
    await settled(a, 180_000);
    // alone, at the Penthouse tier: the $100K chip is offered, the $1M one isn't
    let before = await me(a);
    if (before.inPlay > 0) {
      // chips still on the wheel from an earlier run: stand up first
      await sitSolo(a, 'bw-1', { tier: 'Penthouse' }).catch(() => null);
      if (await a.page.evaluate(() => !!window.casino.app.table)) await leave(a);
      before = await settled(a);
    }
    let since = Date.now();
    if (!(await sitSolo(a, 'bw-1', { tier: 'Penthouse', buyin: '20000', shotAs: 'wheel-1' }))) {
      await leave(a);
      await settled(a);
      await sitSolo(a, 'bw-1', { tier: 'Penthouse', buyin: '20000', shotAs: 'wheel-1' });
    }
    await wheelWindow(a, 0);
    await a.page.waitForTimeout(800);
    await shoot(a.page, 'wheel-2-solo-seated');
    const chipsShown = await a.page.$$eval('.bw-chip:not(.bw-max)', (bs) => bs.filter((b) => !b.hidden).length);
    check(chipsShown === 9, `Penthouse ($1K to $100K a number): the terminal offers the chips up to $100K, not the $1M (${chipsShown} of 10)`);
    // Max on the 20: the table's $100,000 or the $20,000 here, whichever is less
    await a.page.keyboard.press('a');
    await a.page.click('.bw-slot[data-n="1"]');
    await a.page.waitForTimeout(700);
    let st = await wheelState(a);
    check(st.bets[1] === 2_000_000, `Max on the 1 puts all $20,000 here down (under the $100,000 max): ${money(st.bets[1] ?? 0)}`);
    await a.page.keyboard.press('x');
    await a.page.waitForTimeout(500);
    // a $1 chip on the 20 and one on the 1 put the $1,000 minimum down on each, then Spin now
    await a.page.click('.bw-chip >> nth=0');
    await a.page.click('.bw-slot[data-n="20"]');
    await a.page.click('.bw-slot[data-n="1"]');
    await a.page.waitForTimeout(600);
    st = await wheelState(a);
    const round = st.round;
    check(st.bets[20] === 100_000 && st.bets[1] === 100_000, `a $1 chip on a $1,000-minimum number puts the minimum down: ${JSON.stringify(st.bets)}`);
    const hudChips = (p) => p.page.textContent('.hud-table .stat-value');
    await a.page.waitForTimeout(1000); // the HUD rolls to the stack the chips left
    const hudBefore = await hudChips(a);
    await a.page.keyboard.press('Space');
    await a.page.waitForTimeout(2500);
    await shoot(a.page, 'wheel-3-solo-spinning');
    const hudSpinning = await hudChips(a);
    const r1 = await wheelResult(a, since, round);
    check(hudSpinning === hudBefore, `while the wheel turns the HUD keeps the chips it had (${hudBefore}, then ${hudSpinning}): the result isn't told early`);
    await a.page.waitForTimeout(1200);
    check((await hudChips(a)) === money(r1.state.stack), `once it rests the HUD shows the stack it left: ${await hudChips(a)}`);
    await shoot(a.page, 'wheel-4-solo-rest');
    const mine = r1.settle.seats[String(r1.state.mySeat)];
    const n = r1.settle.number;
    const want = (n === 20 ? 100_000 * 21 : 0) + (n === 1 ? 100_000 * 2 : 0);
    check(r1.state.shows === r1.settle.slot, `the flapper rests on the server's slot ${r1.settle.slot} (shows ${r1.state.shows}), a ${n}`);
    check(mine.wagered === 200_000 && mine.returned === want, `solo: $2,000 down, the ${n} came up, paid ${money(mine.returned)} (rules say ${money(want)})`);
    check(r1.state.stack === 2_000_000 - 200_000 + want, `solo: the stack is ${money(r1.state.stack)}`);
    await leave(a);
    const after = await settled(a);
    check(after.balance - before.balance === want - 200_000, `solo: the balance moved by ${money(after.balance - before.balance)}`);

    // two players: A opens a public wheel, B joins; the wheel spins on its own clock
    b = await player('qm_wheel_b');
    pages.push(b);
    await settled(b, 180_000);
    since = Date.now();
    const tableId = await openLobby(a, 'bw-1', { buyin: '1000' });
    await joinLobby(b, 'bw-1', tableId, '600');
    await wheelWindow(a, 4000);
    await wheelWindow(b, 4000);
    await a.page.click('.bw-chip >> nth=2'); // $25
    await a.page.click('.bw-slot[data-n="3"]');
    await a.page.click('.bw-slot[data-n="5"]');
    await b.page.keyboard.press('a');
    await b.page.click('.bw-slot[data-n="10"]');
    await a.page.waitForTimeout(800);
    const ra = await wheelState(a);
    const rb = await wheelState(b);
    check(ra.round === rb.round, `both at round ${ra.round}`);
    check(rb.bets[10] === 60_000, `B's Max on the 10 is the $600 B has (under the $1,000 max): ${money(rb.bets[10] ?? 0)}`);
    await shoot(b.page, 'wheel-5-multi-bets');
    const ma = await wheelResult(a, since, ra.round);
    const mb = await wheelResult(b, since, ra.round);
    await shoot(a.page, 'wheel-6-multi-rest-a');
    const num = ma.settle.number;
    check(ma.state.shows === ma.settle.slot && mb.state.shows === ma.settle.slot, `both wheels rest on the server's slot ${ma.settle.slot} (a ${num}): ${ma.state.shows}, ${mb.state.shows}`);
    const wantA = (num === 3 ? 2_500 * 4 : 0) + (num === 5 ? 2_500 * 6 : 0);
    const wantB = num === 10 ? 60_000 * 11 : 0;
    const sa = ma.settle.seats[String(ma.state.mySeat)];
    const sb = mb.settle.seats[String(mb.state.mySeat)];
    check(sa.returned === wantA && sa.wagered === 5_000, `A: $50 on the 3 and 5, paid ${money(sa.returned)} (rules ${money(wantA)})`);
    check(sb.returned === wantB && sb.wagered === 60_000, `B: $600 on the 10, paid ${money(sb.returned)} (rules ${money(wantB)})`);
    check(ma.state.stack === 100_000 - 5_000 + wantA && mb.state.stack === 60_000 - 60_000 + wantB, `stacks ${money(ma.state.stack)} and ${money(mb.state.stack)}`);
    await leave(a);
    if (await b.page.evaluate(() => !!window.casino.app.table)) await leave(b);
    await settled(a);
    await settled(b);
    await audit(['qm_wheel_a', 'qm_wheel_b'], 'wheel');
  } catch (err) {
    failed('wheel', err);
    if (a) await shoot(a.page, 'wheel-failure-a').catch(() => null);
    if (b) await shoot(b.page, 'wheel-failure-b').catch(() => null);
  }
}

// ------------------------------------------------------------------------------------------------------
// Part: money at the edges: logins, big limits, the bank, the boutique and the bar, the boards

/** Move an account's balance to exactly `cents`, keeping the ledger whole (a grant row for the difference). */
async function setBalance(name, cents) {
  const [r] = await sql(`SELECT id, balance FROM casino_accounts WHERE name = '${name}'`);
  const delta = cents - r.balance;
  if (delta === 0) return;
  await sql(
    `INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES ('qa-adjust:${r.id}:${Date.now()}:${Math.random().toString(36).slice(2)}', ${r.id}, 'grant', ${delta}, NULL, ${Date.now()});
     UPDATE casino_accounts SET balance = balance + ${delta}, rev = rev + 1 WHERE id = ${r.id};`,
  );
}

/** An account from before passwords: no hash, its grant in the ledger. */
async function oldAccount(name) {
  const now = Date.now();
  await sql(
    `INSERT INTO casino_accounts (name, balance, created_at, last_seen) SELECT '${name}', 5000000, ${now}, ${now} WHERE NOT EXISTS (SELECT 1 FROM casino_accounts WHERE name = '${name}');
     INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) SELECT 'grant:' || id, id, 'grant', 5000000, NULL, created_at FROM casino_accounts WHERE name = '${name}' AND NOT EXISTS (SELECT 1 FROM casino_ledger WHERE op_id = 'grant:' || casino_accounts.id);
     UPDATE casino_accounts SET pass_hash = NULL, pass_salt = NULL WHERE name = '${name}';`,
  );
}

const loginApi = (name, password = PASS) => api('login', { method: 'POST', body: { name, password } });

if (wanted('money')) {
  const names = [];
  try {
    await clearRate();
    // --- logins -----------------------------------------------------------------------------------
    await oldAccount('qm_oldtimer');
    names.push('qm_oldtimer');
    const claimPass = `claim-${Date.now().toString(36)}`;
    const o = await newPage('qm_oldtimer');
    pages.push(o);
    await o.page.goto(`${base}/casino/`, { waitUntil: 'domcontentloaded' });
    await o.page.waitForSelector('.name-input', { timeout: 300_000 });
    const note = await o.page.textContent('.login-note');
    check(/first one you pick claims your name/.test(note), `the login says how an old name is claimed: "${note}"`);
    await o.page.fill('.name-input', 'QM_OldTimer');
    await o.page.fill('.pass-input', claimPass);
    await o.page.click('.enter-btn');
    await o.page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
    const [claimed] = await sql(`SELECT name, pass_hash IS NOT NULL AS has FROM casino_accounts WHERE name = 'qm_oldtimer'`);
    check(claimed.has === 1 && claimed.name === 'qm_oldtimer', `an old name is claimed by its first password, in any case ("QM_OldTimer" logged into ${claimed.name})`);
    const again = await loginApi('qm_oldtimer', 'someone-else');
    check(again.status === 401 && again.body?.msg === 'Wrong name or password.', `after that, another password is refused: ${again.status} "${again.body?.msg}"`);
    // a wrong password in the page: said under the field, the field emptied, nothing else happens
    const w = await newPage('qm_wrongpass');
    pages.push(w);
    await w.page.goto(`${base}/casino/`, { waitUntil: 'domcontentloaded' });
    await w.page.waitForSelector('.name-input', { timeout: 300_000 });
    await w.page.fill('.name-input', 'qm_oldtimer');
    await w.page.fill('.pass-input', 'not-the-password');
    await w.page.click('.enter-btn');
    await w.page.waitForSelector('.pass-rule.err', { timeout: 20_000 });
    const said = await w.page.textContent('.pass-rule');
    check(said === 'Wrong name or password.' && (await w.page.inputValue('.pass-input')) === '', `a wrong password is said under the field and the field empties: "${said}"`);
    await shoot(w.page, 'money-1-wrong-password');
    // "Continue as" in a new tab: the name is remembered (localStorage), the session isn't (sessionStorage)
    const tab = await o.ctx.newPage();
    await tab.goto(`${base}/casino/`, { waitUntil: 'domcontentloaded' });
    await tab.waitForSelector('.continue-btn:not([hidden])', { timeout: 300_000 });
    const cont = await tab.textContent('.continue-name');
    check(cont === 'qm_oldtimer' && (await tab.inputValue('.pass-input')) === '', `a new tab offers Continue as ${cont}, with the password field empty`);
    await shoot(tab, 'money-2-continue-as');
    await tab.fill('.pass-input', claimPass);
    await tab.click('.continue-btn');
    await tab.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
    check(true, 'Continue as logs back in with the password');
    await tab.close();

    // --- big limits: Penthouse at an online desk, buy-ins to 100x the max, a top-up past it -------
    const whale = await player('qm_whale');
    pages.push(whale);
    names.push('qm_whale');
    await settled(whale, 180_000);
    await setBalance('qm_whale', 60_000_000 * 100);
    await whale.page.evaluate(async () => window.casino.session.set(await (await import('/casino/src/net/api.ts')).me()));
    const w0 = await me(whale);
    const w0Paid = await featPaid(w0.id);
    await walkUp(whale, 'lb-1');
    await whale.page.waitForSelector('.lim-opt', { timeout: 20_000 });
    await whale.page.click('.lim-opt:has-text("Penthouse")');
    const bigLine = await whale.page.textContent('.lim-buyin');
    check(bigLine === 'Buy-in $10,000–$10,000,000', `Penthouse at Limbo buys in up to 100x its $100,000 max: "${bigLine}"`);
    await whale.page.keyboard.press('s');
    await whale.page.waitForSelector('.modal input[type=number]', { timeout: 30_000 });
    const picks = await whale.page.$$eval('.modal .row .btn.ghost', (bs) => bs.map((b) => b.textContent).filter((t) => t.startsWith('$') || t.startsWith('All')));
    check(picks.at(-1) === '$10,000,000', `the prompt's last pick is the table's $10,000,000: ${picks.join(', ')}`);
    await shoot(whale.page, 'money-3-penthouse-buyin');
    await whale.page.fill('.modal input[type=number]', '10000000');
    await whale.page.click('.modal .btn.primary');
    await whale.page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
    await whale.page.waitForSelector('.os-screen:not([hidden])');
    await whale.page.waitForTimeout(800);
    await whale.page.click('.os-chip-btn:has-text("Max")');
    check((await whale.page.inputValue('.os-bet-input')) === '100000', `Max at Penthouse is the $100,000 table max: ${await whale.page.inputValue('.os-bet-input')}`);
    await shoot(whale.page, 'money-4-penthouse-limbo');
    const sinceW = Date.now();
    await whale.page.click('.os-action.go');
    await whale.page.waitForTimeout(2500);
    // a top-up past the table's buy-in is refused in words, with the amounts written out
    const errBefore = tableFrames(whale).filter((m) => m.t === 'err').length;
    await whale.page.evaluate(() => window.casino.app.table.session.link.topUp(500_000_000));
    await whale.page.waitForTimeout(1200);
    const topErr = tableFrames(whale).filter((m) => m.t === 'err').slice(errBefore).at(-1);
    // how much more fits, or (a stack won up to the top) that it's there already
    check(topErr?.code === 'LIMIT' && /^This table takes \$10,000,000 at most(: you can add up to \$[0-9,]+|, and you have \$[0-9,]+ here)\.$/.test(topErr.msg), `a top-up past the buy-in maximum says how much more fits: "${topErr?.msg}"`);
    // a top-up that fits, then Cash out while it's still on its way
    const stackNow = await whale.page.evaluate(() => window.casino.app.table.session.snapshot.you.stack);
    const add = Math.min(1_000_000_00, 10_000_000_00 - stackNow);
    // (a stack won past the top has no room left: then the cash-out goes alone)
    await whale.page.evaluate((a) => {
      const l = window.casino.app.table.session.link;
      if (a >= 100) l.topUp(a);
      l.cashOut();
    }, add);
    await whale.page.waitForTimeout(2500);
    const busyErr = tableFrames(whale, sinceW).filter((m) => m.t === 'err').map((m) => `${m.code}: ${m.msg}`);
    const seatAfter = lastSeat(whale);
    log(`top-up then cash-out: ${busyErr.join(' | ') || 'no refusals'}; seat ${seatAfter?.status} ${money(seatAfter?.stack ?? 0)}`);
    await leave(whale);
    const w1 = await settled(whale);
    const rounds = roundsOf(whale, 'limbo', sinceW);
    const netW = rounds.reduce((s2, r) => s2 + r.returned - r.wagered, 0);
    const featsW = (await featPaid(w1.id)) - w0Paid;
    check(w1.balance - w0.balance - featsW === netW, `big limits: the balance moved by the rounds' net ${money(netW)} and ${money(featsW)} of feats (${money(w0.balance)} to ${money(w1.balance)})`);

    // --- the bank: under $10,000 in all tops up to $50,000; $10,000 exactly doesn't -----------------
    const broke = await player('qm_broke');
    pages.push(broke);
    names.push('qm_broke');
    await settled(broke, 180_000);
    const tb = await token(broke);
    await setBalance('qm_broke', 999_999);
    let r = await api('bank/loan', { method: 'POST', token: tb });
    check(r.status === 200 && r.body.loan.amount === 4_000_001 && r.body.profile.balance === 5_000_000, `$9,999.99 is topped up by $40,000.01 to $50,000: ${r.status} ${JSON.stringify(r.body?.loan)}`);
    const loans1 = r.body?.profile?.loansTaken;
    await setBalance('qm_broke', 1_000_000);
    r = await api('bank/loan', { method: 'POST', token: tb });
    check(r.status === 409 && r.body.error === 'NOT_ELIGIBLE' && r.body.msg === 'You have $10,000 in all. The bank tops you up when that is under $10,000.', `$10,000 exactly is not under the line: ${r.status} "${r.body?.msg}"`);
    // chips on a table count
    await setBalance('qm_broke', 1_100_000);
    await sitSolo(broke, 'dc-1', { buyin: '6000' });
    r = await api('bank/loan', { method: 'POST', token: tb });
    check(r.status === 409 && /\$11,000 in all, \$6,000 of it in chips on tables/.test(r.body?.msg ?? ''), `$5,000 in the balance and $6,000 at Dice is $11,000 in all: "${r.body?.msg}"`);
    // the cashier's window says the same
    await leave(broke);
    await settled(broke);
    await setBalance('qm_broke', 100_000);
    await broke.page.evaluate(async () => window.casino.session.set(await (await import('/casino/src/net/api.ts')).me()));
    // the picker says so before sitting down when a tier's buy-in is past the balance
    await walkUp(broke, 'dc-1');
    await broke.page.waitForSelector('.lim-opt', { timeout: 20_000 });
    await broke.page.click('.lim-opt:has-text("Penthouse")');
    const shortLine = await broke.page.textContent('.lim-buyin');
    const isShort = await broke.page.$eval('.lim-buyin', (e) => e.classList.contains('short'));
    check(isShort && shortLine === 'Buy-in $10,000–$10,000,000 · you have $1,000', `a tier past the balance says so in the picker: "${shortLine}"`);
    await shoot(broke.page, 'money-4b-picker-short');
    await broke.page.click('.lim-opt:has-text("Standard")');
    check(!(await broke.page.$eval('.lim-buyin', (e) => e.classList.contains('short'))), 'and Standard, which $1,000 covers, does not');
    await broke.page.keyboard.press('Escape');
    await broke.page.waitForFunction(() => !document.querySelector('.lim-opt'), null, { timeout: 5000 });
    await broke.page.waitForTimeout(1200);
    await broke.page.evaluate(() => window.casino.app.openCashier());
    await broke.page.waitForSelector('.bank-sheet', { timeout: 10_000 });
    await broke.page.waitForTimeout(600);
    const standing = await broke.page.textContent('.bank-status');
    check(/You have \$1,000 in all\. The bank will add \$49,000\./.test(standing), `the cashier says what it will add: "${standing}"`);
    // a race: three asks at once make one loan
    const race = await Promise.all([0, 1, 2].map(() => api('bank/loan', { method: 'POST', token: tb })));
    const granted = race.filter((x) => x.status === 200);
    check(granted.length === 1 && granted[0].body.loan.amount === 4_900_000, `three asks at once: one loan of $49,000 (${race.map((x) => x.status).join(', ')})`);
    const bp = (await api('me', { token: tb })).body.profile;
    check(bp.balance === 5_000_000 && bp.loansTaken === loans1 + 1, `after the race: $50,000 and ${bp.loansTaken} loans (one more than before)`);
    await broke.page.click('.bank-take');
    await broke.page.waitForTimeout(1200);
    const afterAsk = await broke.page.textContent('.bank-status');
    check(/\$50,000 in all/.test(afterAsk), `asking at $50,000 is answered with the count: "${afterAsk}"`);
    await shoot(broke.page, 'money-5-cashier');
    await broke.page.keyboard.press('Escape');

    // --- the boutique and the bar: exactly the balance, refusals in words -------------------------
    const shopper = await player('qm_shopper');
    pages.push(shopper);
    names.push('qm_shopper');
    await settled(shopper, 180_000);
    const ts = await token(shopper);
    const shop = (await api('shop', { token: ts })).body;
    const owned = new Set(shop.owned.map((x) => x.item));
    const item = shop.items.filter((x) => !owned.has(x.id)).sort((x, y) => x.price - y.price)[0];
    await setBalance('qm_shopper', item.price);
    const op = `qa-${Date.now().toString(36)}-shop`;
    const buy = await api('shop/buy', { method: 'POST', token: ts, body: { item: item.id, op } });
    check(buy.status === 200 && buy.body.balance === 0, `the ${item.name} for exactly the balance (${money(item.price)}): ${buy.status}, balance ${money(buy.body?.balance ?? -1)}`);
    const same = await api('shop/buy', { method: 'POST', token: ts, body: { item: item.id, op } });
    check(same.status === 200 && same.body.balance === 0 && same.body.at === buy.body.at, 'the same op again is the same purchase, not a second charge');
    const twice = await api('shop/buy', { method: 'POST', token: ts, body: { item: item.id, op: `${op}-2` } });
    check(twice.status === 409 && twice.body.error === 'NOT_ELIGIBLE', `buying it again: ${twice.status} "${twice.body?.msg}"`);
    const domAsked = Date.now();
    const dom = await api('bar/order', { method: 'POST', token: ts, body: { item: 'dom', op: `${op}-bar` } });
    // v6 celebs6: the price the schedule gives at order time (either, if a window opened or closed meanwhile)
    const domPrices = [domAsked, Date.now()].map((t) => (happyHourAt(t) ? halfPrice(120_000) : 120_000));
    const domSays = domPrices.map((c) => `Not enough: the Bottle of Dom is ${money(c)} and your balance is $0.`);
    check(dom.status === 409 && domSays.includes(dom.body.msg), `the bar refuses what the balance can't pay: "${dom.body?.msg}"`);
    const loan0 = await api('bank/loan', { method: 'POST', token: ts });
    check(loan0.status === 200 && loan0.body.loan.amount === 5_000_000, `at $0 the bank tops up the whole $50,000: ${loan0.body?.loan?.amount}`);
    // in the page: the bar's refusal is shown in words
    await setBalance('qm_shopper', 500);
    await shopper.page.evaluate(async () => window.casino.session.set(await (await import('/casino/src/net/api.ts')).me()));
    await shopper.page.evaluate(() => window.casino.app.openBarMenu());
    await shopper.page.waitForTimeout(800);
    await shoot(shopper.page, 'money-6-bar-menu');
    const barHtml = await shopper.page.evaluate(() => document.querySelector('.sheet, .bar-sheet, .barmenu')?.textContent ?? '');
    log(`bar menu at $5: ${barHtml.slice(0, 200)}`);

    // --- the leaderboards -----------------------------------------------------------------------
    const boards = (await api('leaderboard', { token: await token(whale) })).body;
    const rich = boards.boards.richest;
    const wp = await me(whale);
    const top = rich.top.find((x) => x.name === 'qm_whale');
    // qa6: Richest is net worth now (balance + chips on tables + the bank: stats6/bank6), and on a
    // database the other scripts share someone may be richer than the whale
    const worth = wp.bank?.worth ?? wp.balance + wp.inPlay;
    check(top && top.value === worth && rich.top.filter((x) => x.value > worth).length === top.rank - 1, `the whale is on Richest at its net worth, ranked by it (${money(top?.value ?? 0)}, #${top?.rank}; age ${boards.age} ms)`);
    await audit(names, 'money');
  } catch (err) {
    failed('money', err);
  }
}

// ------------------------------------------------------------------------------------------------------
// Part: a big win at Limbo, heard on the floor (the toast, the sign's list, the day's meter), and
// the winner's HUD session net

if (wanted('bigwin')) {
  let luck = null;
  let watch = null;
  try {
    await clearRate();
    watch = await player('qm_watcher');
    luck = await player('qm_lucky');
    pages.push(watch, luck);
    await settled(luck, 180_000);
    // the watcher stands in the pit, facing the sign
    await watch.page.evaluate(() => {
      const w = window.casino.world;
      const pit = w.plan.rooms.find((r) => r.id === 'pit');
      w.teleport(pit.cx, pit.cz + 4, Math.PI);
    });
    const start = await me(luck);
    const startPaid = await featPaid(start.id);
    const since = Date.now();
    await sitSolo(luck, 'lb-1', { buyin: '3000' });
    await luck.page.waitForSelector('.os-screen:not([hidden])');
    // $10 at a 25.00x target, one bet at a time, until one lands (about 1 in 25)
    let win = null;
    for (let i = 0; i < 300 && !win; i++) {
      const before = tableFrames(luck, since).length;
      await luck.page.evaluate(() => window.casino.app.table.session.link.act({ type: 'bet', bet: 1_000, target: 2_500 }));
      const until = Date.now() + 5000;
      while (Date.now() < until && !tableFrames(luck, since).slice(before).some((m) => m.t === 'ev' || m.t === 'err')) await sleep(20);
      win = eventsOf(luck, 'result', since).find((e) => e.win) ?? null;
    }
    check(!!win, `Limbo paid a 25x target: ${win ? `${money(win.payout)} on ${money(win.bet)}` : 'no win in 300 bets'}`);
    if (win) {
      // the floor hears it once the page has shown it, and not before
      const heard = await watch.page.waitForFunction(() => document.querySelector('.bigwin-toast:not(.feat)')?.textContent ?? null, null, { timeout: 20_000 }).then((h) => h.jsonValue()).catch(() => null);
      check(heard === 'qm_lucky won $240Limbo, Target 25x', `the watcher's toast: "${heard}"`);
      const wire = watch.frames.filter((m) => m.t === 'bigwin').at(-1);
      check(wire && wire.amount === 24_000 && wire.what === 'Target 25x' && wire.station === 'lb-1' && wire.game === 'limbo', `the floor's news: ${JSON.stringify(wire && { amount: wire.amount, what: wire.what, station: wire.station })}`);
      const meter = await watch.page.evaluate(() => window.casino.app.floorLife?.tally ?? null).catch(() => null);
      void meter;
      await watch.page.waitForTimeout(600);
      await shoot(watch.page, 'bigwin-1-watcher');
      // the winner's own page celebrates it (25x is over the site's 10x), no toast for themselves
      await luck.page.waitForTimeout(1500);
      await shoot(luck.page, 'bigwin-2-winner');
      check(!(await luck.page.$('.bigwin-toast:not(.feat)')), 'the winner gets no toast about their own win');
    }
    // the HUD's session net is the rounds' net to the cent
    const rounds = roundsOf(luck, 'limbo', since);
    const net = rounds.reduce((a, r) => a + r.returned - r.wagered, 0);
    await luck.page.waitForTimeout(800);
    const hud = (await luck.page.textContent('.hud-session .stat-value')).replace('\u2212', '-').split(' ')[0].trim();
    check(hud === (net > 0 ? '+' : '') + money(net), `the HUD's session net ${hud} is the ${rounds.length} rounds' ${money(net)}`);
    await leave(luck);
    const end = await settled(luck);
    const featsL = (await featPaid(end.id)) - startPaid;
    check(end.balance - start.balance - featsL === net, `the balance moved by ${money(end.balance - start.balance)}, the rounds' net and ${money(featsL)} of feats`);
    await audit(['qm_lucky', 'qm_watcher'], 'bigwin');
  } catch (err) {
    failed('bigwin', err);
    if (luck) await shoot(luck.page, 'bigwin-failure-luck').catch(() => null);
    if (watch) await shoot(watch.page, 'bigwin-failure-watch').catch(() => null);
  }
}

// ------------------------------------------------------------------------------------------------------
// Part: security around money: socket tickets, a private lobby's PIN, a second tab at a seat with chips

/** Open a raw socket to `path` with this ticket; resolves with the first message or the close code. */
function rawSocket(path, ticket) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${Number(port) + 1}/casino/ws/${path}?v=1${ticket ? `&ticket=${encodeURIComponent(ticket)}` : ''}`, { headers: { Origin: base } });
    const done = (v) => {
      try {
        ws.close();
      } catch {}
      resolve(v);
    };
    ws.onmessage = (e) => done({ msg: JSON.parse(e.data) });
    ws.onclose = (e) => done({ code: e.code });
    setTimeout(() => done({ code: 'timeout' }), 8000);
  });
}

if (wanted('security')) {
  const names = ['qm_sec_a', 'qm_sec_b'];
  try {
    await clearRate();
    // tickets: one socket each, for one path, never without
    const la = await loginApi('qm_sec_a');
    const tok = la.body.token;
    const t1 = (await api('ticket', { method: 'POST', token: tok, body: { target: 'solo/limbo' } })).body.ticket;
    const first = await rawSocket('solo/limbo', t1);
    check(first.msg?.t === 'table', `a fresh ticket opens its socket (${first.msg?.t ?? first.code})`);
    const reused = await rawSocket('solo/limbo', t1);
    check(reused.code === 4006, `the same ticket again is refused with 4006 (${reused.code})`);
    const t2 = (await api('ticket', { method: 'POST', token: tok, body: { target: 'solo/limbo' } })).body.ticket;
    const elsewhere = await rawSocket('solo/dice', t2);
    check(elsewhere.code === 4006, `a ticket for Limbo doesn't open Dice (${elsewhere.code})`);
    const none = await rawSocket('solo/limbo', null);
    check(none.code === 4003, `no ticket: 4003 (${none.code})`);
    const bogus = await api('ticket', { method: 'POST', token: tok, body: { target: 'solo/limbo/../dice' } });
    check(bogus.status === 400, `a ticket for a made-up path is refused (${bogus.status})`);

    // a private Crash table: its PIN shows the table first, a wrong PIN doesn't
    const a = await player('qm_sec_a');
    const b = await player('qm_sec_b');
    pages.push(a, b);
    await settled(a, 180_000);
    await settled(b, 180_000);
    await walkUp(a, 'cs-1');
    await a.page.waitForSelector('.lim-opt', { timeout: 20_000 });
    await a.page.keyboard.press('m');
    await a.page.waitForSelector('.lobby-actions .btn', { timeout: 10_000 });
    await a.page.click('.lobby-actions .btn:has-text("Private")');
    await a.page.waitForFunction(() => window.casino.app.table?.session.snapshot?.meta.pin, null, { timeout: 20_000 });
    const pin = await a.page.evaluate(() => window.casino.app.table.session.snapshot.meta.pin);
    check(/^\d{4}$/.test(pin), `the private table has a PIN (${pin})`);
    const wrong = String((Number(pin) + 1) % 10000).padStart(4, '0');
    const bad = await api('tables/join', { method: 'POST', token: await token(b), body: { pin: wrong } });
    check(bad.status === 404 && bad.body.error === 'BAD_PIN', `a wrong PIN finds nothing (${bad.status} ${bad.body?.error})`);
    await walkUp(b, 'cs-2');
    await b.page.waitForSelector('.lobby-choice', { timeout: 20_000 });
    await b.page.keyboard.press('m');
    await b.page.waitForSelector('.lobby-pin-input', { timeout: 10_000 });
    await b.page.fill('.lobby-pin-input', pin);
    await b.page.click('.lobby-pin .btn.primary');
    await b.page.waitForSelector('.lobby-found', { timeout: 10_000 });
    const found = await b.page.textContent('.lobby-found');
    check(/qm_sec_a's table/.test(found) && /\$1–\$1,000/.test(found), `the PIN shows whose table and its limits before joining: "${found.slice(0, 120)}"`);
    await shoot(b.page, 'security-1-pin-table');
    await b.page.click('.lobby-go-btn');
    await b.page.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
    await b.page.fill('.modal input[type=number]', '100');
    await b.page.click('.modal .btn.primary');
    await b.page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
    check(true, 'B joined the private table with its PIN and sat down');
    await leave(b);
    if (await a.page.evaluate(() => !!window.casino.app.table)) await leave(a);

    // a second tab: the seat and its chips follow the account, never doubled
    await sitSolo(a, 'lb-1', { buyin: '1000' });
    await a.page.waitForSelector('.os-screen:not([hidden])');
    const tab = await newPage('qm_sec_a');
    pages.push(tab);
    // the same browser keeps the name, a new tab needs the password again
    await login(tab);
    await tab.page.waitForTimeout(1500);
    const halted = await a.page.evaluate(() => document.body.textContent.includes('Opened in another tab'));
    check(halted, 'the first tab says the casino opened in another tab');
    await shoot(a.page, 'security-2-first-tab');
    await walkUp(tab, 'lb-1');
    await tab.page.waitForSelector('.lim-opt', { timeout: 20_000 });
    await tab.page.keyboard.press('s');
    await tab.page.waitForFunction(() => !!document.querySelector('.modal input[type=number]') || window.casino.app.table?.seated === true, null, { timeout: 30_000 });
    const back = await tab.page.evaluate(() => window.casino.app.table?.session.snapshot?.you);
    check(back?.status === 'seated' && back.stack === 100_000, `the second tab sits back down at the chips already there: ${JSON.stringify(back && { status: back.status, stack: back.stack })}`);
    await tab.page.waitForTimeout(600);
    await leave(tab);
    const end = await settled(tab);
    check(end.inPlay === 0, 'standing up in the second tab cashes out the one seat');
    await audit(names, 'security');
  } catch (err) {
    failed('security', err);
  }
}

/** One round of each game through the page's own controls. */
async function playOne(p, game, since) {
  const { page } = p;
  const settle = (ms = 900) => page.waitForTimeout(ms);
  if (game === 'plinko') {
    const hud = () => page.textContent('.hud-table .stat-value');
    const before = await hud();
    await page.click('.os-action.go');
    await settle(700);
    const falling = await hud();
    check(falling === before, `plinko: while the ball falls the HUD keeps ${before} (${falling})`);
    await settle(3800);
  } else if (game === 'dice' || game === 'limbo') {
    await page.click('.os-action.go');
    await settle(2500);
  } else if (game === 'keno') {
    const auto = await page.$('button:has-text("Auto Pick")');
    if (auto) await auto.click();
    await settle(300);
    await page.click('.os-action.go');
    await settle(4500);
  } else if (game === 'tower') {
    await page.click('.os-action.go');
    await settle(700);
    await page.keyboard.press('1');
    await settle(1200);
    const hidden = tableFrames(p, since).filter((m) => m.t === 'ev' && m.view?.phase === 'climbing');
    check(hidden.every((m) => m.view.tower === null && !JSON.stringify(m.events).includes('"tower"')), 'tower: the tower stays hidden mid-climb');
    if (await page.$('.os-action.cash:not([disabled])')) {
      await page.click('.os-action.cash');
      await settle(1400);
    }
  } else if (game === 'mines') {
    await page.click('.os-action.go');
    await settle(700);
    await page.click('.mn-tile.closed >> nth=7');
    await settle(1200);
    const hidden = tableFrames(p, since).filter((m) => m.t === 'ev' && m.view?.phase === 'playing');
    check(hidden.every((m) => m.view.field === null && !JSON.stringify(m.events).includes('"field"')), 'mines: the mines stay hidden mid-round');
    if (await page.$('.os-action.cash:not([disabled])')) {
      await page.click('.os-action.cash');
      await settle(1400);
    }
  } else if (game === 'hilo') {
    await page.click('.os-action.go');
    await settle(900);
    const higher = await page.$('.hl-guess >> nth=0');
    if (higher) await higher.click();
    else await page.keyboard.press('ArrowUp');
    await settle(1500);
    if (await page.$('.os-action.cash:not([disabled])')) {
      await page.click('.os-action.cash');
      await settle(1400);
    }
  } else if (game === 'crash') {
    // an auto cash-out at 1.50x, so the round settles on its own
    await page.click('.os-seg button:has-text("Auto cash-out")');
    await page.fill('.os-num-input >> nth=0', '1.5');
    await page.press('.os-num-input >> nth=0', 'Enter');
    await page.waitForFunction(() => document.querySelector('.os-action')?.textContent === 'Bet' || /Bet next round/.test(document.querySelector('.os-action')?.textContent ?? ''), null, { timeout: 30_000 });
    await page.click('.os-action');
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && eventsOf(p, 'crash', since).length === 0) await sleep(400);
    await settle(1500);
    const flying = tableFrames(p, since).filter((m) => m.t === 'ev' && m.view && m.view.phase === 'running');
    check(flying.length > 0 && flying.every((m) => m.view.crash === null && !m.events.some((e) => e.type === 'crash')), `crash: the crash point stays hidden in flight (${flying.length} frames)`);
  }
}

/** The finished rounds this page saw since `since`, with what the rules say each should have paid. */
function roundsOf(p, game, since) {
  const evs = tableFrames(p, since).filter((m) => m.t === 'ev').flatMap((m) => m.events);
  const rounds = [];
  if (game === 'plinko') for (const e of evs.filter((e) => e.type === 'drop')) rounds.push({ what: `drop ${e.rows} rows ${e.risk} bin ${e.bin}`, wagered: e.bet, returned: e.payout, expected: (e.bet / 100) * e.mult });
  if (game === 'dice') for (const e of evs.filter((e) => e.type === 'roll')) rounds.push({ what: `roll ${e.roll} ${e.over ? 'over' : 'under'} ${e.target}`, wagered: e.bet, returned: e.payout, expected: e.win ? Math.floor((9900 * e.bet) / e.chance) : 0 });
  if (game === 'limbo') for (const e of evs.filter((e) => e.type === 'result')) rounds.push({ what: `limbo ${e.result} vs ${e.target}`, wagered: e.bet, returned: e.payout, expected: e.result >= e.target ? (e.bet / 100) * e.target : 0 });
  if (game === 'keno') for (const e of evs.filter((e) => e.type === 'draw')) rounds.push({ what: `keno ${e.hits} hits of ${e.picks?.length}`, wagered: e.bet, returned: e.payout, expected: null });
  if (game === 'tower' || game === 'mines' || game === 'hilo') for (const e of evs.filter((e) => e.type === 'over')) rounds.push({ what: `${game} ${e.outcome} at ${e.mult / 100}x`, wagered: e.bet, returned: e.payout, expected: e.outcome === 'bust' ? 0 : Math.floor((e.bet * e.mult) / 100) });
  if (game === 'crash') {
    const seat = tableFrames(p).filter((m) => m.t === 'table').at(-1)?.you?.seat;
    const paid = new Set();
    for (const e of evs.filter((e) => e.type === 'cashout' && e.seat === seat)) {
      rounds.push({ what: `crash cash-out at ${e.at / 100}x (${e.how})`, wagered: e.amount, returned: e.payout, expected: (e.amount / 100) * e.at });
    }
    const bets = evs.filter((e) => e.type === 'bet' && e.seat === seat);
    const lost = evs.filter((e) => e.type === 'crash' && e.busted.includes(seat)).length;
    for (let i = 0; i < lost; i++) rounds.push({ what: 'crash: rode it into the crash', wagered: bets[bets.length - lost + i]?.amount ?? 0, returned: 0, expected: 0 });
    void paid;
  }
  return rounds;
}

// ------------------------------------------------------------------------------------------------------

for (const p of pages) for (const e of p.errors) problems.push(e);
await browser.close();
console.log(problems.length ? `\n${problems.length} problem(s):\n- ${problems.join('\n- ')}` : '\nall checks passed');
process.exit(problems.length ? 1 : 0);
