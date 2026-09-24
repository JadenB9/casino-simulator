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

/** The load script's audit (scripts/load/net.mjs), for the named accounts. */
async function audit(names, where) {
  const list = names.map((n) => `'${n.replace(/'/g, '')}'`).join(',');
  const rows = await sql(
    `SELECT a.id, a.name, a.balance, a.in_play,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id) AS ledger,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id AND l.kind IN ('buyin', 'cashout', 'refund')) AS moved,
            (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l WHERE l.account_id = a.id AND l.kind IN ('grant', 'loan')) AS granted,
            (SELECT COALESCE(SUM(price), 0) FROM casino_items i WHERE i.account_id = a.id)
              + (SELECT COALESCE(SUM(price), 0) FROM casino_orders o WHERE o.account_id = a.id) AS spent,
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
  await page.waitForSelector('.modal input[type=number]', { timeout: 30_000 });
  if (shotAs) await shoot(page, `${shotAs}-buyin`);
  await page.fill('.modal input[type=number]', buyin);
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
}

async function shoot(page, name) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

/** Stand up the way Esc does (confirming the Leave), and wait for the chips to come home. */
async function leave(p) {
  const { page } = p;
  await page.keyboard.press('Escape');
  const btn = await page.waitForSelector('.modal .btn.primary:has-text("Leave")', { timeout: 5000 }).catch(() => null);
  if (btn) await btn.click();
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
    const start = await me(p);
    log(`qm_desks: balance ${money(start.balance)}`);

    const games = (process.env.GAMES ?? 'plinko,dice,limbo,keno,tower,mines,hilo,crash').split(',');
    for (const game of games) {
      const prefix = { plinko: 'pk', dice: 'dc', limbo: 'lb', keno: 'kn', tower: 'tw', mines: 'mn', hilo: 'hl', crash: 'cs' }[game];
      const since = Date.now();
      const before = await me(p);
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
      check(after.balance - before.balance === net, `${game}: the balance moved by the rounds' net ${money(net)} (${rounds.length} rounds): ${money(before.balance)} to ${money(after.balance)}`);
      for (const r of rounds) check(r.expected === null || r.expected === r.returned, `${game}: ${r.what} paid ${money(r.returned)}${r.expected !== null ? `, expected ${money(r.expected)}` : ''}`);
      check(after.inPlay === 0, `${game}: nothing left on the table`);
    }
    await audit(['qm_desks'], 'desks');
  } catch (err) {
    failed('desks', err);
    if (p) await shoot(p.page, 'desk-failure').catch(() => null);
  }
}

/** One round of each game through the page's own controls. */
async function playOne(p, game, since) {
  const { page } = p;
  const settle = (ms = 900) => page.waitForTimeout(ms);
  if (game === 'plinko') {
    await page.click('.os-action.go');
    await settle(4500);
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
