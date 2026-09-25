#!/usr/bin/env node
// Leaderboards and the stats sheet for real, on the local dev stack. Two players with fixed names
// play Dice at the online lounge: A a run of safe rolls then a few long shots, B one big losing
// roll. Both stand up (their round tallies go to D1 with the cash-out). Then A opens the
// leaderboards from the HUD: A is on today's winners, B on today's losers, A on the lost board and
// the Dice boards (picked from the game picker) with the rounds A played; the place beside each
// board's name matches the board. A opens the stats sheet from their name: the Dice row, the
// fortnight chart with today's bar, the record, and win rate agree with GET /stats, and no other
// player's record is ever in it. Screenshots of each; a phone-width sheet too.
//
// Usage: node scripts/e2e/stats6.mjs [port] [outDir]   (PORT_BASE=<port> npm run dev first)
// Each run starts both players' tallies and stats over in the LOCAL database (KEEP=1 to skip).

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [port = '6410', out = '/tmp/stats6'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const A_NAME = 'stats6_e2e_a';
const B_NAME = 'stats6_e2e_b';
const base = `http://localhost:${port}`;
const problems = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const check = (ok, what) => {
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) problems.push(what);
};

const d1 = (sql) =>
  JSON.parse(
    execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', sql], {
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString(),
  )[0].results;

// Start over: no tallies (feats count stays), no stats. The money is left alone.
if (!process.env.KEEP) {
  for (const name of [A_NAME, B_NAME]) {
    d1(
      `DELETE FROM casino_tally WHERE key != 'feats' AND account_id = (SELECT id FROM casino_accounts WHERE name = '${name}'); ` +
        `DELETE FROM casino_stats WHERE account_id = (SELECT id FROM casino_accounts WHERE name = '${name}');`,
    );
  }
}

const gl = process.env.GL ?? (process.env.GPU ? 'metal' : 'swiftshader');
const glArgs = gl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: glArgs });

async function enterAs(name, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource|GL Driver/.test(m.text()) && errors.push(m.text()));
  await p.goto(`${base}/casino/`, { timeout: 180_000 });
  await p.waitForSelector('.name-input, .menu-item', { timeout: 180_000 });
  if (await p.$('.name-input')) {
    await p.fill('.name-input', name);
    await p.fill('.pass-input', 'casino-dev');
    await p.click('.enter-btn');
  }
  await p.waitForSelector('.menu-item, .editor-panel', { timeout: 30_000 });
  if (await p.$('.menu-item')) await p.click('.menu-item >> nth=0');
  else {
    await p.waitForTimeout(2500);
    for (let k = 0; k < 12 && !(await p.$('.hud')); k++) {
      const next = await p.$('.editor-panel .ed-buttons .btn.primary');
      if (next) await next.click();
      await p.waitForTimeout(700);
    }
  }
  await p.waitForSelector('.hud', { timeout: 60_000 });
  await p.waitForTimeout(1500);
  // whatever opens on arrival (today's daily bonus) is put away first
  for (let i = 0; i < 5 && (await p.$('.sheet-scrim')); i++) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
  }
  return { p, errors };
}

const api = (p, path) =>
  p.evaluate(async (path) => {
    const r = await fetch(`${location.origin}/casino/api/${path}`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` } });
    return r.json();
  }, path);

async function sit(p, game, chips) {
  await p.evaluate((g) => {
    const w = window.casino.world;
    w.enter(w.stations.find((x) => x.game === g));
  }, game);
  await p.waitForFunction(() => window.casino.app.table?.seated === true || !!document.querySelector('.lobby-choice, .modal input[type=number]'), null, { timeout: 30_000 });
  if (await p.$('.lobby-choice')) {
    await p.waitForTimeout(400);
    await p.click('.lobby-choice >> nth=0');
  }
  await p.waitForFunction(() => window.casino.app.table?.seated === true || !!document.querySelector('.modal input[type=number]'), null, { timeout: 30_000 });
  if (await p.$('.modal input[type=number]')) {
    await p.fill('.modal input[type=number]', String(chips));
    await p.click('.modal .btn.primary');
  }
  await p.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
}

async function leaveTable(p) {
  for (let i = 0; i < 20; i++) {
    if (await p.evaluate(() => window.casino.app.table === null && window.casino.world.seated === null)) {
      await p.waitForTimeout(1200);
      return;
    }
    const leave = await p.$('.modal .btn.primary');
    if (leave) await leave.click();
    else await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
  }
}

/** One Dice roll, waiting for the table to settle it. */
async function roll(p, bet, target, over) {
  const before = await p.evaluate(() => window.casino.app.table.session.stack ?? null);
  await p.evaluate(([bet, target, over]) => window.casino.app.table.session.link.act({ type: 'roll', bet, target, over }), [bet, target, over]);
  await p.waitForTimeout(700);
  return before;
}

// --- play ----------------------------------------------------------------------------------------

const A = await enterAs(A_NAME);
const B = await enterAs(B_NAME);

// A: six safe rolls (98%), then six long shots (4%): mostly wins, some losses, maybe a streak.
await sit(A.p, 'dice', 3000);
for (let i = 0; i < 6; i++) await roll(A.p, 5000, 200, true);
for (let i = 0; i < 6; i++) await roll(A.p, 1000, 400, false);
await A.p.waitForTimeout(1500);
await leaveTable(A.p);

// B: one big roll that almost surely loses (a 2% shot).
await sit(B.p, 'dice', 3000);
await roll(B.p, 100_000, 200, false);
await B.p.waitForTimeout(1500);
await leaveTable(B.p);

// The tallies go to D1 with the cash-out; give the flush a moment.
let sa = null;
let sb = null;
for (let i = 0; i < 40; i++) {
  sa = await api(A.p, 'stats');
  sb = await api(B.p, 'stats');
  if ((sa.total?.counted ?? 0) >= 12 && (sb.total?.counted ?? 0) >= 1 && (sa.games?.dice?.rounds ?? 0) >= 12) break;
  await A.p.waitForTimeout(500);
}
const aDice = sa.games?.dice;
check(sa.total.counted === 12 && aDice?.rounds === 12, `A's twelve rounds are counted (${JSON.stringify(aDice)})`);
check(aDice && aDice.won - aDice.lost === aDice.net, `A's won less lost is A's net at Dice (${aDice?.won} - ${aDice?.lost} = ${aDice?.net})`);
const aToday = sa.days.at(-1);
check(aToday.net === aDice.net, `A's day on the chart is A's Dice net (${aToday.net})`);
const bNet = sb.games?.dice?.net ?? 0;
log(`A: ${aDice.wins} wins of 12, net ${aDice.net}, streak ${sa.streak}; B: net ${bNet}`);

// --- the leaderboards --------------------------------------------------------------------------

// qa6: leaving the table gives mouse look back, and on the GPU's headless Chrome the pointer lock
// really takes, so the HUD isn't clickable until it's let go (Esc, for a person)
await A.p.evaluate(() => document.exitPointerLock());
await A.p.click('button[aria-label="Leaderboards"]');
await A.p.waitForSelector('.lb-sheet .lb-table', { timeout: 15_000 });
await A.p.waitForTimeout(800);
await A.p.screenshot({ path: `${out}/boards-networth.png` });

async function showBoard(p, id) {
  await p.click(`.lb-nav [id$="-${id}"]`);
  await p.waitForTimeout(400);
  return p.evaluate(() => ({
    title: document.querySelector('.lb-title')?.textContent,
    rows: [...document.querySelectorAll('.lb-table tbody tr:not(.lb-gap)')].map((r) => ({
      rank: r.querySelector('.lb-rank')?.textContent,
      name: r.querySelector('.lb-name')?.firstChild?.textContent,
      value: r.querySelector('.lb-value')?.textContent,
      you: r.classList.contains('you'),
    })),
    place: document.querySelector('.lb-item[aria-selected="true"] .lb-place')?.textContent,
  }));
}

const money = (c) => {
  const s = `$${Math.floor(Math.abs(c) / 100).toLocaleString('en-US')}${Math.abs(c) % 100 ? `.${String(Math.abs(c) % 100).padStart(2, '0')}` : ''}`;
  return c < 0 ? `−${s}` : c > 0 ? `+${s}` : s;
};

if (aDice.net > 0) {
  const today = await showBoard(A.p, 'today');
  const me = today.rows.find((r) => r.you);
  check(me?.name === A_NAME && me.value === money(aDice.net), `A on "Up today" at ${money(aDice.net)} (${JSON.stringify(me)})`);
  check(today.place === (me?.rank ? ordinalOf(+me.rank) : '—'), `the list shows A's place beside "Up today" (${today.place})`);
  await A.p.screenshot({ path: `${out}/boards-today.png` });
}
if (bNet < 0) {
  const down = await showBoard(A.p, 'todayDown');
  check(down.rows.some((r) => r.name === B_NAME && r.value === money(bNet)), `B on "Down today" at ${money(bNet)}`);
  await A.p.screenshot({ path: `${out}/boards-today-down.png` });
}
if (aDice.lost > 0) {
  const lost = await showBoard(A.p, 'lost');
  const me = lost.rows.find((r) => r.you);
  check(me?.value === money(aDice.lost).replace('+', ''), `A on "Total lost" at ${money(aDice.lost)} (${JSON.stringify(me)})`);
}
// Every board: names only, no ids anywhere in what the page got.
const raw = await api(A.p, 'leaderboard');
check(!/"(id|accountId|account_id)"/.test(JSON.stringify(raw)), 'the boards carry names, never ids');

// The Dice boards, from the picker.
await A.p.selectOption('.lb-scope', 'dice');
await A.p.waitForTimeout(1200);
const rounds = await showBoard(A.p, 'rounds');
const meRounds = rounds.rows.find((r) => r.you);
check(meRounds?.value === '12', `A on the Dice "Most rounds" board with 12 (${JSON.stringify(meRounds)})`);
check(rounds.title === 'Most rounds', `the Dice boards are listed (${rounds.title})`);
await A.p.screenshot({ path: `${out}/boards-dice.png` });
await A.p.keyboard.press('Escape');
await A.p.waitForSelector('.lb-sheet', { state: 'detached', timeout: 5_000 });

function ordinalOf(n) {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

// --- the stats sheet ---------------------------------------------------------------------------

await A.p.click('.hud-who');
await A.p.waitForSelector('.profile-sheet .pf-games', { timeout: 15_000 });
await A.p.waitForTimeout(1000);
const sheet = await A.p.evaluate(() => ({
  dice: [...document.querySelectorAll('.pf-games tbody tr')].map((r) => [...r.children].map((c) => c.textContent)).find((c) => c[0] === 'Dice'),
  bars: document.querySelectorAll('.pf-bar').length,
  today: document.querySelector('.pf-bar.today')?.getAttribute('class'),
  record: Object.fromEntries([...document.querySelectorAll('.pf-rec')].map((r) => [r.querySelector('dt').textContent, r.querySelector('dd').textContent])),
  tiles: Object.fromEntries([...document.querySelectorAll('.pf-strip .stat')].map((t) => [t.querySelector('.stat-label').textContent, t.querySelector('.stat-value').textContent])),
  text: document.querySelector('.profile-sheet').textContent,
}));
check(sheet.dice?.[1] === '12', `the Dice row has 12 rounds (${JSON.stringify(sheet.dice)})`);
check(sheet.dice?.[4] === money(aDice.net), `the Dice row's net is ${money(aDice.net)}`);
check(sheet.bars === 14, `fourteen bars on the chart (${sheet.bars})`);
check(aToday.net === 0 || /today/.test(sheet.today ?? ''), "today's bar is marked");
check(sheet.record['Rounds won'] === `${sa.total.wins} of ${sa.total.counted}`, `the record: ${sheet.record['Rounds won']}`);
check(!sheet.text.includes(B_NAME), "B's name is nowhere on A's sheet");
await A.p.screenshot({ path: `${out}/stats-sheet.png` });
await A.p.evaluate(() => (document.querySelector('.profile-sheet .sheet-body').scrollTop = 99999));
await A.p.waitForTimeout(400);
await A.p.screenshot({ path: `${out}/stats-sheet-end.png` });
// Sort by net.
await A.p.click('.pf-games th:nth-child(5) .pf-sort');
await A.p.waitForTimeout(300);
check((await A.p.getAttribute('.pf-games th:nth-child(5)', 'aria-sort')) === 'descending', 'the games table sorts by net');
await A.p.keyboard.press('Escape');

// Phone width: the boards as a strip, the sheet in one column.
const P = await enterAs(A_NAME, { width: 390, height: 844 });
await P.p.click('button[aria-label="Leaderboards"]').catch(() => {});
await P.p.waitForSelector('.lb-sheet .lb-table', { timeout: 15_000 }).catch(() => {});
await P.p.waitForTimeout(800);
await P.p.screenshot({ path: `${out}/boards-phone.png` });

for (const [who, e] of [[A_NAME, A.errors], [B_NAME, B.errors], ['phone', P.errors]]) check(e.length === 0, `${who}: no page errors ${e.slice(0, 3).join(' | ')}`);

await browser.close();
log(problems.length ? `${problems.length} problem(s)` : 'all good');
console.log(
  JSON.stringify(
    { shots: ['boards-networth', 'boards-today', 'boards-today-down', 'boards-dice', 'stats-sheet', 'stats-sheet-end', 'boards-phone'].map((s) => `${out}/${s}.png`), problems },
    null,
    1,
  ),
);
process.exit(problems.length ? 1 : 0);
