#!/usr/bin/env node
// Headless run of the bank (client/src/ui/bank/, server/src/bank.ts) against the local worker, with
// two players on the floor:
//   A walks to a teller window: the bank opens beside the banker on Checking; A moves $20,000 to
//     savings and watches the day's interest tick, then the dev clock passes midnight and the
//     interest is paid in; A opens an hour's term deposit, buys the Casino Index and sells some
//     (the chart), sends B $1,250 with a note, and reads the statement.
//   B is on the floor when it lands: the notice; B's bank shows it received; the HUD's net worth.
//   A phone's width: the rail across the top, the pane below.
// Then the money identity from migration 0007 for both, straight from D1.
//
// Usage: node scripts/e2e/bank6.mjs [port] [outDir]   (--sw: SwiftShader instead of the GPU)
// Logs in as fixed names (bank6_e2e_a, bank6_e2e_b) with the dev password; the dev stack's worker
// must have CASINO_DEV set (server/wrangler.toml does), which allows the per-account dev clock.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const [port = '6400', out = '/tmp/bank6-shots'] = args;
mkdirSync(out, { recursive: true });
const A = 'bank6_e2e_a';
const B = 'bank6_e2e_b';
const DAY = 86_400_000;

const browser = await chromium.launch(flag('sw') ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const check = (what, ok, detail = '') => (ok ? console.log(`ok   ${what}`) : fail(`${what} ${detail}`));
const frames = (p, n = 4) => p.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function shot(p, name, clip) {
  await frames(p, 4);
  await p.screenshot({ path: `${out}/${name}.png`, ...(clip ? { clip } : {}) });
  console.log('shot', `${out}/${name}.png`);
}

function watch(p) {
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

function sql(command) {
  return JSON.parse(execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } }).toString());
}

async function enterAs(name, viewport = { width: 1400, height: 860 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = watch(p);
  await p.goto(`http://localhost:${port}/casino/`, { timeout: 180000 });
  await p.waitForSelector('.name-input', { timeout: 180000 });
  await p.fill('.name-input', name);
  if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
  await p.click('.enter-btn');
  await p.waitForSelector('.menu-item, .editor-panel', { timeout: 30000 });
  if (!(await p.$('.menu-item'))) {
    await p.waitForTimeout(2500);
    for (let k = 0; k < 10 && !(await p.$('.hud')); k++) {
      const next = await p.$('.editor-panel .ed-buttons .btn.primary');
      if (next) await next.click();
      await p.waitForTimeout(700);
    }
  } else {
    await p.click('.menu-item >> nth=0');
  }
  await p.waitForSelector('.hud', { timeout: 30000 });
  await p.waitForTimeout(1200);
  // the daily bonus's sheet opens on arrival some days: out of the way
  if (await p.$('.daily-sheet')) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }
  return { p, ctx, errors };
}

const api = (p, path, method = 'GET', body) =>
  p.evaluate(
    async ([pa, m, b]) => {
      const t = sessionStorage.getItem('casino.token');
      const r = await fetch(`/casino/api/${pa}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, ...(b ? { body: JSON.stringify(b) } : {}) });
      return { status: r.status, body: await r.json() };
    },
    [path, method, body],
  );
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);

/** The floor believes a walk's worth of movement a second: long trips go in hops. */
async function travel(p, x, z, yaw) {
  const from = await p.evaluate(() => ({ x: window.casino.world.player.position.x, z: window.casino.world.player.position.z }));
  const n = Math.max(1, Math.ceil(Math.hypot(x - from.x, z - from.z) / 7));
  for (let i = 1; i <= n; i++) {
    await p.evaluate(([a, b, c]) => window.casino.world.teleport(a, b, c), [from.x + ((x - from.x) * i) / n, from.z + ((z - from.z) * i) / n, yaw]);
    await p.waitForTimeout(1100);
  }
}

/** Every cent of an account accounted for (0007_bank.sql). */
function identity(name) {
  const [r] = sql(`SELECT a.balance, a.in_play, a.banked,
      (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger WHERE account_id = a.id) AS ledger,
      (SELECT COALESCE(SUM(price), 0) FROM casino_items WHERE account_id = a.id) + (SELECT COALESCE(SUM(price), 0) FROM casino_orders WHERE account_id = a.id) AS spent,
      (SELECT COALESCE(SUM(cash), 0) FROM casino_bank WHERE account_id = a.id) AS cash,
      (SELECT COALESCE(SUM(gain), 0) FROM casino_bank WHERE account_id = a.id) AS gain,
      (SELECT COALESCE(SUM(saved), 0) FROM casino_bank WHERE account_id = a.id) AS saved,
      (SELECT COALESCE(SUM(balance), 0) FROM casino_savings WHERE account_id = a.id) AS savings,
      (SELECT COALESCE(SUM(locked), 0) FROM casino_bank WHERE account_id = a.id) AS locked,
      (SELECT COALESCE(SUM(principal), 0) FROM casino_deposits WHERE account_id = a.id AND closed_at IS NULL) AS open,
      (SELECT COALESCE(SUM(cost), 0) FROM casino_bank WHERE account_id = a.id) AS cost,
      (SELECT COALESCE(SUM(cost), 0) FROM casino_holdings WHERE account_id = a.id) AS held
     FROM casino_accounts a WHERE a.name = '${name}'`)[0].results;
  const bad = [];
  if (r.ledger - r.spent + r.cash !== r.balance) bad.push(`balance ${r.balance} vs ${r.ledger - r.spent + r.cash}`);
  if (r.saved !== r.savings) bad.push(`savings ${r.savings} vs ${r.saved}`);
  if (r.locked !== r.open) bad.push(`deposits ${r.open} vs ${r.locked}`);
  if (r.cost !== r.held) bad.push(`fund ${r.held} vs ${r.cost}`);
  if (r.banked !== r.savings + r.open + r.held) bad.push(`banked ${r.banked} vs ${r.savings + r.open + r.held}`);
  if (r.balance + r.banked !== r.ledger - r.spent + r.gain) bad.push('balance + banked vs ledger + gain');
  check(`money identity for ${name}`, bad.length === 0, bad.join('; '));
}

try {
  sql(`SELECT 1`);
} catch (err) {
  console.log('no local D1 (start the dev stack first):', String(err).slice(0, 200));
  process.exit(1);
}

const b = await enterAs(B);
const a = await enterAs(A);
const aId = sql(`SELECT id FROM casino_accounts WHERE name = '${A}'`)[0].results[0].id;
// A has money to bank: a win-like credit if it's short (with its ledger row, so every cent stays accounted for)
const aBal = sql(`SELECT balance FROM casino_accounts WHERE name = '${A}'`)[0].results[0].balance;
if (aBal < 6_000_000) {
  sql(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES ('e2e-win:${aId}:${Date.now()}', ${aId}, 'cashout', ${6_000_000 - aBal}, 'e2e-table', ${Date.now()});
       UPDATE casino_accounts SET balance = balance + ${6_000_000 - aBal}, rev = rev + 1 WHERE id = ${aId};`);
}
// The dev clock: A's bank runs at least four days ahead, so the account is past its first day and
// nothing it holds came from the house in the last three; each run starts where the last one left
// it (the clock never goes back) and moves it on a day for the interest.
const was = sql(`SELECT n FROM casino_tally WHERE account_id = ${aId} AND key = 'bank-clock'`)[0].results[0]?.n ?? 0;
const o1 = Math.max(4 * DAY, was);
const clock0 = (await api(a.p, 'dev/bank/clock', 'POST', { ms: o1 })).body.state;
check('the dev clock moves the bank on', clock0 && clock0.now - Date.now() > o1 - 60_000);
await a.p.evaluate(async () => {
  const t = sessionStorage.getItem('casino.token');
  const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } });
  window.casino.session.set((await r.json()).profile);
});

// --- A at a teller window ---------------------------------------------------------------------------
const win = await a.p.evaluate(() => window.casino.world.life.bankers.tellers[1]?.customer ?? null);
if (win) {
  await travel(a.p, win.x, win.z + 0.5, Math.PI);
  await a.p.evaluate(() => {
    const w = window.casino.world;
    w.life.bankers.spots(w.player.position)[0]?.use();
  });
} else {
  await a.p.evaluate(() => window.casino.app.openCashier());
}
await a.p.waitForSelector('.bank-sheet', { timeout: 8000 });
await a.p.waitForSelector('.bank-rail-item.on', { timeout: 8000 });
await a.p.waitForFunction(() => !document.querySelector('.bank-loading'), null, { timeout: 10000 });
await a.p.waitForTimeout(1500);
await shot(a.p, '01-checking-at-the-window');
check('checking shows the rule over the window', (await text(a.p, '.bank-rule')) === 'Under $10,000 in all? The bank tops you up to $50,000.');

const pane = async (label) => {
  await a.p.click(`.bank-rail-item:has(.bank-rail-label:text-is("${label}"))`);
  await a.p.waitForTimeout(500);
};
const state = async (p = a.p) => (await api(p, 'bank')).body;

// savings: $20,000 in, the day's interest ticking
await pane('Savings');
const before = await state();
await a.p.fill('#bank-sav-amt', '20000');
await a.p.click('.bank-actions .btn.primary');
await a.p.waitForSelector('.bank-status.ok', { timeout: 8000 });
const s1 = await state();
check('savings: $20,000 moved in', s1.savings.balance - before.savings.balance === 2_000_000 && before.balance - s1.balance === 2_000_000, `${before.savings.balance} -> ${s1.savings.balance}`);
const tick1 = await text(a.p, '.bank-ticking');
await a.p.waitForTimeout(4000);
const tick2 = await text(a.p, '.bank-ticking');
check('savings: the interest ticks', tick1 !== tick2 && Number(tick2.slice(1)) > Number(tick1.slice(1)), `${tick1} -> ${tick2}`);
await shot(a.p, '02-savings-ticking');

// past midnight on the dev clock: the day's interest is paid in
await api(a.p, 'dev/bank/clock', 'POST', { ms: o1 + DAY });
const s2 = await state();
check('savings: a midnight passed pays the interest', s2.savings.balance > s1.savings.balance && s2.savings.earned > s1.savings.earned, `${s1.savings.balance} -> ${s2.savings.balance}`);
console.log('interest paid', (s2.savings.balance - s1.savings.balance) / 100);
await pane('Checking');
await pane('Savings');
await a.p.waitForTimeout(600);
await shot(a.p, '03-savings-paid');

// a term deposit
await pane('Term deposits');
await a.p.click('.bank-seg .seg-btn >> nth=0');
await a.p.fill('#bank-dep-amt', '5000');
await a.p.waitForTimeout(200);
check('deposits: the preview says what it pays', (await text(a.p, '.bank-preview')).startsWith('Pays $5,000.75 ($0.75 interest)'), await text(a.p, '.bank-preview'));
await a.p.click('.bank-actions .btn.primary');
await a.p.waitForSelector('.bank-status.ok', { timeout: 8000 });
await a.p.waitForTimeout(1200);
await shot(a.p, '04-deposit-open');

// the Casino Index: buy $3,000, sell $1,000
await pane('Casino Index');
await a.p.waitForTimeout(800);
await a.p.fill('#bank-fund-amt', '3000');
await a.p.click('.bank-actions .btn.primary');
await a.p.waitForSelector('.bank-status.ok', { timeout: 8000 });
await a.p.fill('#bank-fund-amt', '1000');
await a.p.click('.bank-actions .btn:not(.primary):not(.ghost)');
await a.p.waitForFunction(() => document.querySelector('.bank-status.ok')?.textContent?.startsWith('Sold'), null, { timeout: 8000 }).catch(() => fail('fund: sold'));
const s3 = await state();
check('fund: holding and cost after a buy and a sale', s3.fund.units > 0 && s3.fund.cost > 0);
await a.p.hover('.bank-chart-canvas', { position: { x: 300, y: 80 } });
await a.p.waitForTimeout(400);
await shot(a.p, '05-casino-index');

// send B $1,250 with a note; B is on the floor
await pane('Send money');
await a.p.waitForTimeout(400);
await shot(a.p, '06-send-form');
await a.p.fill('#bank-send-to', B);
await a.p.fill('#bank-send-amt', '1250');
await a.p.fill('#bank-send-note', 'for the cab home');
const bBefore = sql(`SELECT balance FROM casino_accounts WHERE name = '${B}'`)[0].results[0].balance;
await a.p.click('.bank-actions .btn.primary');
await a.p.waitForSelector('.bank-status.ok', { timeout: 8000 }).catch(async () => fail(`send: ${await text(a.p, '.bank-status')}`));
const toast = await b.p.waitForFunction(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).find((t) => t?.includes('sent you')), null, { timeout: 8000 }).then((h) => h.jsonValue(), () => null);
check('B hears it on the floor', toast === `${A} sent you $1,250: "for the cab home"`, String(toast));
await shot(b.p, '07-b-notice');
const bAfter = sql(`SELECT balance FROM casino_accounts WHERE name = '${B}'`)[0].results[0].balance;
check('B has $1,250 more', bAfter - bBefore === 125_000, `${bBefore} -> ${bAfter}`);
// a big one asks first
await a.p.fill('#bank-send-amt', '10000');
await a.p.click('.bank-actions .btn.primary');
const asked = await a.p.waitForSelector('.modal', { timeout: 4000 }).then(() => true, () => false);
check('send: $10,000 asks to confirm', asked);
await shot(a.p, '08-send-confirm');
if (asked) await a.p.click('.modal .btn.ghost');

// the statement
await pane('Statement');
await a.p.waitForSelector('.bank-line:not(.bank-line-head)', { timeout: 8000 });
await a.p.waitForTimeout(500);
await shot(a.p, '09-statement');
const first = await text(a.p, '.bank-lines .bank-line .bank-line-text');
check('statement: newest first', first.startsWith(`Sent to ${B}`), first);
await a.p.keyboard.press('Escape');
await a.p.waitForTimeout(600);
await shot(a.p, '10-a-hud', { x: 0, y: 0, width: 700, height: 90 });
check('HUD: net worth shown', (await a.p.$('.hud-worth:not([hidden])')) !== null);

// B's bank: the transfer received
await b.p.evaluate(() => window.casino.app.openCashier());
await b.p.waitForSelector('.bank-inbox-row', { timeout: 8000 }).catch(() => fail("B's bank lists what came in"));
await b.p.waitForTimeout(600);
await shot(b.p, '11-b-received');
await b.p.keyboard.press('Escape');

// a phone's width
await a.ctx.close();
const m = await enterAs(A, { width: 390, height: 844 });
await m.p.evaluate(() => window.casino.app.openCashier());
await m.p.waitForSelector('.bank-rail-item.on', { timeout: 8000 });
await m.p.waitForTimeout(800);
await m.p.click('.bank-rail-item:has(.bank-rail-label:text-is("Casino Index"))');
await m.p.waitForTimeout(1200);
await shot(m.p, '12-phone-index');
const fits = await m.p.evaluate(() => {
  const r = document.querySelector('.bank-sheet')?.getBoundingClientRect();
  return r ? r.left >= 0 && r.right <= innerWidth + 0.5 : false;
});
check('the bank fits a phone', fits);

identity(A);
identity(B);
for (const [who, r] of [['a', a], ['b', b], ['phone', m]]) for (const e of r.errors) fail(`${who} error: ${e}`);
await m.ctx.close();
await b.ctx.close();
await browser.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
