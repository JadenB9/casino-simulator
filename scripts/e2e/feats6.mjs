#!/usr/bin/env node
// Achievements for real, on the local dev stack: one player earns feats at the online lounge's
// computers by playing (Dice at 98% for Beginner's Luck, Dice at 4% until Long Odds lands, Mines
// with 24 mines until a board is cleared for Clean Sweep and its title), while a second player
// walks the floor. Checks: each feat's card shows at the table once the round has played out and
// its cash reaches the balance; the other player gets a toast naming it; the sheet (J) lists it
// earned with the right progress; wearing the Minesweeper title shows it under the name in the
// HUD and over the player's head for the other one; D1's money identity holds.
// Screenshots of the card, the toast, the sheet and the name tag.
//
// Usage: node scripts/e2e/feats6.mjs [port] [outDir]   (PORT_BASE=<port> npm run dev first)
// Each run starts the earner's feats over in the LOCAL database (grants taken back out of the
// balance with them, so every cent still adds up); pass KEEP=1 to skip that.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [port = '6260', out = '/tmp/feats6', ...rest] = process.argv.slice(2);
void rest;
mkdirSync(out, { recursive: true });
const EARNER = 'feats6_e2e_a';
const WATCHER = 'feats6_e2e_b';
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

/** Start the earner over: their feats, the cash those paid (out of the balance again) and their tallies. */
function reset() {
  const [a] = d1(`SELECT id, balance, (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger WHERE account_id = casino_accounts.id AND op_id LIKE 'feat:%') AS paid FROM casino_accounts WHERE name = '${EARNER}'`);
  if (!a) return;
  if (a.balance < a.paid) {
    log(`can't start ${EARNER} over: ${a.paid} paid in feats, ${a.balance} left`);
    return;
  }
  d1(
    `UPDATE casino_accounts SET balance = balance - ${a.paid}, rev = rev + 1 WHERE id = ${a.id}; ` +
      `DELETE FROM casino_ledger WHERE account_id = ${a.id} AND op_id LIKE 'feat:%'; ` +
      `DELETE FROM casino_feats WHERE account_id = ${a.id}; DELETE FROM casino_tally WHERE account_id = ${a.id};`,
  );
  log(`started ${EARNER} over (${a.paid} cents of feats taken back)`);
}

function identity(name) {
  const [r] = d1(
    `SELECT a.balance, a.in_play, (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger WHERE account_id = a.id) AS ledger, ` +
      `(SELECT COALESCE(SUM(price), 0) FROM casino_items WHERE account_id = a.id) AS items, ` +
      `(SELECT COALESCE(SUM(price), 0) FROM casino_orders WHERE account_id = a.id) AS orders FROM casino_accounts a WHERE a.name = '${name}'`,
  );
  return r;
}

if (!process.env.KEEP) reset();

const gl = process.env.GL ?? (process.env.GPU ? 'metal' : 'swiftshader');
const glArgs = gl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: glArgs });

async function enterAs(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
    // a new name picks a look first
    await p.waitForTimeout(2500);
    for (let k = 0; k < 12 && !(await p.$('.hud')); k++) {
      const next = await p.$('.editor-panel .ed-buttons .btn.primary');
      if (next) await next.click();
      await p.waitForTimeout(700);
    }
  }
  await p.waitForSelector('.hud', { timeout: 30_000 });
  await p.waitForTimeout(1500);
  // put away whatever greets a player on arrival (the daily bonus)
  for (let i = 0; i < 4 && (await p.$('.sheet-scrim')); i++) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }
  return { p, errors };
}

const api = (p, path, init) =>
  p.evaluate(
    async ([path, init]) => {
      const r = await fetch(`${location.origin}/casino/api/${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` } });
      return r.json();
    },
    [path, init],
  );

/** Sit at the first station of a game, bought in with `chips` dollars. */
async function sit(p, game, chips) {
  const id = await p.evaluate((g) => {
    const w = window.casino.world;
    const s = w.stations.find((x) => x.game === g);
    w.enter(s);
    return s.id;
  }, game);
  // a seat still held from a run cut short comes back seated, with no buy-in to answer
  const ready = () => p.waitForFunction(() => window.casino.app.table?.seated === true || !!document.querySelector('.modal input[type=number]'), null, { timeout: 20_000 });
  await p.waitForFunction(() => window.casino.app.table?.seated === true || !!document.querySelector('.lobby-choice, .modal input[type=number]'), null, { timeout: 20_000 });
  if (await p.$('.lobby-choice')) {
    // "Play" / "Single player" is the first choice
    await p.waitForTimeout(400);
    await p.click('.lobby-choice >> nth=0');
  }
  await ready();
  if (await p.$('.modal input[type=number]')) {
    await p.fill('.modal input[type=number]', String(chips));
    await p.click('.modal .btn.primary');
  }
  await p.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });
  // Watch the table's feat messages from here on.
  await p.evaluate(() => {
    const s = window.casino.app.table.session;
    window.__feats = [];
    const orig = s.onMessage.bind(s);
    s.onMessage = (m) => {
      if (m.t === 'feat') window.__feats.push(m);
      orig(m);
    };
  });
  log(`sat at ${id}`);
}

/** Stand up the way a player does: Esc (closing whatever is open first), then Leave. */
async function leaveTable(p) {
  for (let i = 0; i < 20; i++) {
    if (await p.evaluate(() => window.casino.app.table === null && window.casino.world.seated === null)) {
      // back behind the player on the floor
      await p.waitForTimeout(1200);
      return;
    }
    const leave = await p.$('.modal .btn.primary');
    if (leave) await leave.click();
    else await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
  }
  await p.waitForFunction(() => window.casino.app.table === null, null, { timeout: 20_000 });
}

const featsSeen = (p) => p.evaluate(() => window.__feats.map((m) => m.feat));
async function waitFeat(p, feat, ms = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await featsSeen(p)).includes(feat)) return true;
    await p.waitForTimeout(200);
  }
  return false;
}

// --- the two players ---------------------------------------------------------------------------

const A = await enterAs(EARNER);
const B = await enterAs(WATCHER);
const startA = await api(A.p, 'me');
log(`${EARNER}: balance ${startA.profile.balance}, ${startA.profile.feats?.length ?? 0} feats`);

// B stands in the online lounge, out on the floor (toasts only show there), looking at the desks.
await sit(A.p, 'dice', 2000);
const deskAt = await A.p.evaluate(() => {
  const s = window.casino.world.stations.find((x) => x.game === 'dice');
  const v = s.anchor.getWorldPosition(s.anchor.position.clone());
  return { x: v.x, z: v.z };
});
await B.p.evaluate(({ x, z }) => window.casino.world.player.teleport(x + 2.2, z + 2.2, Math.atan2(2.2, 2.2)), deskAt);

// 1. Beginner's Luck: a 98% roll (again, the odd time it loses).
let first = false;
for (let i = 0; i < 5 && !first; i++) {
  await A.p.evaluate(() => window.casino.app.table.session.link.act({ type: 'roll', bet: 100, target: 200, over: true }));
  first = await waitFeat(A.p, 'first-win', 4_000);
}
check(first, "Beginner's Luck came from the table");

// 2. Long Odds: 4% rolls until one lands.
let long = false;
for (let i = 0; i < 150 && !long; i++) {
  await A.p.evaluate(() => window.casino.app.table.session.link.act({ type: 'roll', bet: 100, target: 400, over: false }));
  await A.p.waitForTimeout(450);
  long = (await featsSeen(A.p)).includes('dc-long');
}
check(long, 'Long Odds came from the table after a 4% roll won');
// The card waits for the roll to be shown; then it's up for five seconds.
const card = await A.p.waitForSelector('.ft-card', { timeout: 10_000 }).catch(() => null);
check(!!card, 'the unlock card shows at the table');
await A.p.waitForTimeout(700);
await A.p.screenshot({ path: `${out}/card-at-table.png` });
const toast = await B.p.waitForSelector('.bigwin-toast.feat', { timeout: 15_000 }).catch(() => null);
const toastText = toast ? await toast.textContent() : '';
check(/feats6_e2e_a/i.test(toastText ?? '') && /earned/.test(toastText ?? ''), `the other player's toast: "${toastText}"`);
await B.p.screenshot({ path: `${out}/toast-other-player.png` });

// 3. The sheet at the table: J opens it at Dice.
await A.p.waitForTimeout(6000);
await A.p.keyboard.press('j');
await A.p.waitForSelector('.feats-sheet', { timeout: 5_000 });
await A.p.waitForTimeout(900);
const sheet = await A.p.evaluate(() => ({
  group: document.querySelector('.ft-group')?.textContent,
  earned: [...document.querySelectorAll('.ft-row.earned')].map((r) => r.dataset.feat),
  wonHere: document.querySelector('.ft-won')?.textContent,
}));
check(sheet.group === 'Dice' && sheet.earned.includes('dc-long') && sheet.wonHere === 'Won here', `the sheet opens at Dice with Long Odds earned (${JSON.stringify(sheet)})`);
await A.p.screenshot({ path: `${out}/sheet-dice.png` });
await A.p.keyboard.press('j');
await A.p.waitForSelector('.feats-sheet', { state: 'detached', timeout: 5_000 });

// Stand up: the chips and the tallies go home.
await leaveTable(A.p);

// 4. Clean Sweep at Mines: 24 mines, one gem; turn a tile until it's the gem.
await sit(A.p, 'mines', 2000);
let swept = false;
for (let i = 0; i < 250 && !swept; i++) {
  await A.p.evaluate(() => window.casino.app.table.session.link.act({ type: 'bet', amount: 100, mines: 24 }));
  await A.p.waitForTimeout(150);
  await A.p.evaluate(() => window.casino.app.table.session.link.act({ type: 'random' }));
  await A.p.waitForTimeout(300);
  swept = (await featsSeen(A.p)).includes('mn-clear');
}
check(swept, 'Clean Sweep came from the table after a board with 24 mines was cleared');
await A.p.waitForTimeout(6500);

// Wear the title from the sheet.
await A.p.keyboard.press('j');
await A.p.waitForSelector('.ft-title-seg .seg-btn', { timeout: 5_000 });
await A.p.click('.ft-title-seg .seg-btn:has-text("Minesweeper")');
await A.p.waitForFunction(() => window.casino.session.profile.look.title === 'mn-clear', null, { timeout: 5_000 });
await A.p.waitForTimeout(500);
await A.p.screenshot({ path: `${out}/sheet-title.png` });
const hudTitle = await A.p.evaluate(() => document.querySelector('.hud-who .hud-title')?.textContent);
check(hudTitle === 'Minesweeper', `the HUD shows the title under the name (${hudTitle})`);
await leaveTable(A.p);

// 5. B sees the title over A's head: B walks up to where it draws A (people are drawn walking to
// a new spot rather than jumping, so B goes to A rather than the other way round).
await B.p.bringToFront();
await B.p.waitForTimeout(2500);
const placed = await B.p.evaluate(() => {
  const { engine, world, app } = window.casino;
  const a = [...app.remotes.drawn.values()][0];
  if (!a) return false;
  const d = engine.camera.getWorldDirection(engine.camera.position.clone());
  const k = Math.hypot(d.x, d.z) || 1;
  world.player.teleport(a.x - (d.x / k) * 3.6, a.z - (d.z / k) * 3.6, world.player.state().yaw);
  return true;
});
check(placed, 'the watcher draws the earner on the floor');
await B.p.waitForTimeout(1500);
let tag = null;
for (let i = 0; i < 40 && !tag; i++) {
  await B.p.waitForTimeout(250);
  tag = await B.p.evaluate(() => {
    const t = [...document.querySelectorAll('.world-tag, .remote-tag')].find((e) => /feats6_e2e_a/i.test(e.textContent ?? ''));
    return t ? { text: t.textContent, title: t.querySelector('.tag-title')?.textContent ?? null } : null;
  });
}
check(tag?.title === 'Minesweeper', `the name tag over the earner says ${JSON.stringify(tag)}`);
await B.p.screenshot({ path: `${out}/nametag-title.png` });

// 6. D1: the feats, the money.
await A.p.waitForTimeout(2500);
const end = await api(A.p, 'feats');
const got = end.feats.map((f) => f.feat);
check(['first-win', 'dc-long', 'mn-clear'].every((f) => got.includes(f)), `GET /feats has them: ${got.join(', ')}`);
check((end.tally.rounds ?? 0) > 2 && (end.tally['wins:dice'] ?? 0) >= 2, `the tallies reached D1 at cash-out (${JSON.stringify(end.tally)})`);
for (const name of [EARNER, WATCHER]) {
  const r = identity(name);
  check(r.in_play === 0 && r.ledger - r.items - r.orders === r.balance, `${name}: ledger ${r.ledger} - items ${r.items} - orders ${r.orders} = balance ${r.balance}`);
}
for (const [who, e] of [[EARNER, A.errors], [WATCHER, B.errors]]) check(e.length === 0, `${who}: no page errors ${e.slice(0, 3).join(' | ')}`);

await browser.close();
log(problems.length ? `${problems.length} problem(s)` : 'all good');
console.log(JSON.stringify({ shots: ['card-at-table', 'toast-other-player', 'sheet-dice', 'sheet-title', 'nametag-title'].map((s) => `${out}/${s}.png`), problems }, null, 1));
process.exit(problems.length ? 1 : 0);
