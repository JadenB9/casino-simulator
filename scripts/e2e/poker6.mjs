#!/usr/bin/env node
// Hold'em at any stakes, headless, in the game proper.
//
// micro      a solo table at $0.50/$1: the picker offers every stake from $0.50/$1 to
//            $100K/$200K plus Custom, the buy-in is $20 to $250, a raise goes in half dollars,
//            the bots play hands and each bot's plate says what kind of player it is.
// nosebleed  a solo table at $100K/$200K with a $50,000,000 buy-in (the account is given the
//            money the way a table pays it), custom blinds of $25,000/$50,000 on the way, and
//            every cent back through the escrow afterwards.
// multi      two players at a $0.50/$1 lobby and two at a custom $25,000/$50,000 lobby, playing
//            hands against each other.
//
// Usage: node scripts/e2e/poker6.mjs [port] [outDir] [part...]   (PORT_BASE=<port> npm run dev first)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port = '6390', out = '/tmp/poker6-e2e', ...only] = process.argv.slice(2);
const wanted = (part) => only.length === 0 || only.includes(part);
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? `http://localhost:${port}`;
const errors = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const check = (ok, what) => {
  if (!ok) errors.push(what);
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const failed = (where, err) => {
  const text = `${where}: ${String(err?.message ?? err).split('\n')[0]}`;
  errors.push(text);
  log(`FAIL ${text}`);
};

function sql(command) {
  return execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } }).toString();
}

/** Winnings, the way a table pays them: a ledger row and the balance, together. */
function grant(name, dollars) {
  const cents = dollars * 100;
  const now = Date.now();
  sql(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) SELECT 'e2e-win:' || id || ':${now}', id, 'cashout', ${cents}, 'e2e', ${now} FROM casino_accounts WHERE name = '${name}'; UPDATE casino_accounts SET balance = balance + ${cents}, rev = rev + 1 WHERE name = '${name}';`);
}

/** SUM(ledger) - SUM(items) - SUM(orders) = balance + in play, for one account. */
function balanced(name) {
  const r = JSON.parse(
    sql(`SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l JOIN casino_accounts a ON a.id = l.account_id WHERE a.name = '${name}') -
    (SELECT COALESCE(SUM(price), 0) FROM casino_items i JOIN casino_accounts a ON a.id = i.account_id WHERE a.name = '${name}') -
    (SELECT COALESCE(SUM(price), 0) FROM casino_orders o JOIN casino_accounts a ON a.id = o.account_id WHERE a.name = '${name}') AS sum,
    (SELECT balance FROM casino_accounts WHERE name = '${name}') AS balance,
    (SELECT in_play FROM casino_accounts WHERE name = '${name}') AS in_play`),
  )[0].results[0];
  return { ok: r.sum === r.balance + r.in_play, ...r };
}

const browser = await chromium.launch({
  args: process.env.GPU ? ['--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('casino.quality', 'low');
    for (const k of Object.keys(localStorage)) if (k.startsWith('casino.limits.')) localStorage.removeItem(k);
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120_000);
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  const login = async () => {
    await page.goto(`${base}/casino/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector('.name-input, .menu-item', { timeout: 600_000 });
    if (await page.$('.name-input')) {
      await page.fill('.name-input', name);
      await page.fill('.pass-input', 'casino-dev');
      await page.click('.enter-btn');
    }
    await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 30_000 });
    if (await page.$('.editor-panel.guided')) {
      for (let i = 0; i < 3; i++) {
        await page.click('.editor-panel .ed-buttons .btn.primary');
        await page.waitForTimeout(400);
      }
    } else await page.click('.menu-item >> nth=0');
    await page.waitForSelector('.hud', { timeout: 60_000 });
  };
  await login();
  return { page, name, login };
}

/** Click the first element matching `sel` whose text includes `text`, in the page (no waiting on animations). */
const clickText = async (page, sel, text) => {
  await page.waitForFunction(([sel, text]) => [...document.querySelectorAll(sel)].some((e) => e.textContent.includes(text)), [sel, text], { timeout: 30_000 });
  await page.$$eval(sel, (es, text) => es.find((e) => e.textContent.includes(text)).click(), text);
};

const shot = async (page, file) => {
  const path = `${out}/${file}.png`;
  await page.screenshot({ path });
  log(`shot ${path}`);
};

const walkUp = (page) =>
  page.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === 'he-1'));
  });

const me = (page) =>
  page.evaluate(async () => {
    const r = await fetch(`${window.__api ?? location.origin}/casino/api/me`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` } });
    return (await r.json()).profile;
  });

/** Pick a stake in the picker by its label ("$0.50/$1"). */
const pickStake = async (page, label) => {
  const ok = await page.$$eval('.lim-opt', (bs, label) => {
    const b = bs.find((x) => x.querySelector('.lim-opt-name')?.textContent === label);
    b?.click();
    return !!b;
  }, label);
  if (!ok) throw new Error(`no stake ${label}`);
};

async function buyIn(page, dollars) {
  await page.waitForSelector('.modal input[type=number]', { timeout: 30_000 });
  const note = (await page.textContent('.modal p')).trim();
  await page.fill('.modal input[type=number]', String(dollars));
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30_000 });
  return note;
}

/**
 * Play the player's turns automatically (check, else call; `raiseOnce` makes one raise of the
 * minimum plus a step first) and count the hands dealt and the refusals.
 */
const autoplay = (page, raiseOnce = false) =>
  page.evaluate((raiseOnce) => {
    const s = window.casino.app.table.session;
    s.__hands = new Set();
    s.__errs = [];
    s.__raised = null;
    s.__view = s.snapshot?.view ?? null;
    const orig = s.onMessage.bind(s);
    s.onMessage = (m) => {
      orig(m);
      if (m.t === 'err') s.__errs.push(m.msg);
      if (m.view) s.__view = m.view;
    };
    // Every so often: if it's our turn and we haven't answered this spot, answer it.
    let answered = '';
    clearInterval(s.__timer);
    s.__timer = setInterval(() => {
      const v = s.__view;
      if (!v) return;
      if (v.handId) s.__hands.add(v.handId);
      if (v.you?.sittingOut) s.link.act({ type: 'sitout', on: false });
      const l = v.you?.legal;
      const key = `${v.handId}|${v.street}|${v.total}|${v.bet}`;
      if (!l || key === answered) return;
      answered = key;
      const range = l.bet ?? l.raise;
      if (raiseOnce && !s.__raised && range && range.min + l.step < range.max) {
        const to = range.min + l.step;
        s.__raised = { to, step: l.step };
        s.link.act(l.bet ? { type: 'bet', amount: to } : { type: 'raise', to });
      } else s.link.act(l.check ? { type: 'check' } : { type: 'call' });
    }, 700);
  }, raiseOnce);

const handsSeen = (page) => page.evaluate(() => window.casino.app.table.session.__hands.size);

async function playHands(page, n, ms = 240_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && (await handsSeen(page)) < n) await page.waitForTimeout(1500);
  return handsSeen(page);
}

async function leave(page) {
  await page.evaluate(() => window.casino.app.escape());
  const btn = await page.waitForSelector('.modal .btn.primary', { timeout: 5000 }).catch(() => null);
  if (btn) await btn.click();
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000 && (await me(page)).inPlay !== 0) await page.waitForTimeout(1500);
}

// ---------------------------------------------------------------------------------------------

if (wanted('micro')) try {
  const a = await player('poker6_e2e_a');
  await walkUp(a.page);
  await a.page.waitForSelector('.lim-opt', { timeout: 20_000 });
  await a.page.waitForTimeout(500);
  const opts = await a.page.$$eval('.lim-opt', (bs) => bs.map((x) => x.textContent.trim()));
  check(opts[0] === '$0.50/$1' && opts.includes('$100K/$200K') && opts.includes('$25K/$50K') && opts.at(-1) === 'CustomAny blinds', `the picker offers every stake: ${opts.join(' | ')}`);
  check((await a.page.textContent('.lim-buyin')) === 'Buy-in $200–$2,500', 'Standard ($5/$10) takes 20 to 250 big blinds');
  await pickStake(a.page, '$0.50/$1');
  await a.page.waitForTimeout(300);
  check((await a.page.textContent('.lim-buyin')) === 'Buy-in $20–$250', 'the micro table takes $20 to $250');
  await shot(a.page, 'poker6-1-picker-micro');
  await a.clickText(page, '.lim-opt', 'Custom');
  await a.page.waitForTimeout(300);
  await shot(a.page, 'poker6-2-picker-custom');
  await pickStake(a.page, '$0.50/$1');
  await a.page.keyboard.press('s');
  const note = await buyIn(a.page, 250);
  check(note.includes('$20 to $250'), `the buy-in prompt says the range: "${note}"`);
  const cfg = await a.page.evaluate(() => window.casino.app.table.session.snapshot.meta.config);
  check(cfg.options.sb === 50 && cfg.options.bb === 100 && cfg.limits.default.step === 50, 'the table is $0.50/$1, betting in half dollars');
  await autoplay(a.page, true);
  const hands = await playHands(a.page, 4);
  check(hands >= 4, `hands played at the micro table: ${hands}`);
  const raised = await a.page.evaluate(() => ({ r: window.casino.app.table.session.__raised, errs: window.casino.app.table.session.__errs }));
  check(raised.r && raised.r.step === 50 && raised.r.to % 50 === 0 && raised.errs.length === 0, `a half-dollar raise went through: ${JSON.stringify(raised)}`);
  const styles = await a.page.$$eval('.he-plate', (ps) => ps.map((p) => p.title).filter(Boolean));
  check(styles.length >= 4, `the bots' plates say what kind of players they are: ${styles.join(' / ')}`);
  await a.page.waitForTimeout(800);
  await shot(a.page, 'poker6-3-micro-table');
  await leave(a.page);
  const bal = balanced(a.name);
  check(bal.ok && bal.in_play === 0, `every cent is accounted for after the micro table: ${JSON.stringify(bal)}`);
  await a.page.context().close();
} catch (err) {
  failed('micro', err);
}

if (wanted('nosebleed')) try {
  const b = await player('poker6_e2e_b');
  const have = (await me(b.page)).balance;
  if (have < 60_000_000_00) grant(b.name, 60_000_000 - Math.floor(have / 100));
  await b.login();
  await walkUp(b.page);
  await b.page.waitForSelector('.lim-opt', { timeout: 20_000 });
  await b.clickText(page, '.lim-opt', 'Custom');
  await b.page.fill('.lim-input >> nth=0', '25000');
  await b.page.fill('.lim-input >> nth=1', '50000');
  await b.page.waitForTimeout(300);
  check((await b.page.textContent('.lim-buyin')) === 'Buy-in $1,000,000–$12,500,000', 'custom blinds of $25,000/$50,000 take $1M to $12.5M');
  await shot(b.page, 'poker6-4-picker-custom-25k');
  await pickStake(b.page, '$100K/$200K');
  await b.page.waitForTimeout(300);
  check((await b.page.textContent('.lim-buyin')) === 'Buy-in $4,000,000–$50,000,000', 'the $100K/$200K table takes $4M to $50M');
  await shot(b.page, 'poker6-5-picker-nosebleed');
  await b.page.keyboard.press('s');
  await buyIn(b.page, 50_000_000);
  const seated = await me(b.page);
  check(seated.inPlay === 50_000_000_00, `$50,000,000 in play: ${seated.inPlay}`);
  await autoplay(b.page);
  const hands = await playHands(b.page, 3);
  check(hands >= 3, `hands played at $100K/$200K: ${hands}`);
  await b.page.waitForTimeout(800);
  await shot(b.page, 'poker6-6-nosebleed-table');
  await leave(b.page);
  const bal = balanced(b.name);
  check(bal.ok && bal.in_play === 0, `every cent is accounted for after the nosebleed table: ${JSON.stringify(bal)}`);
  await b.page.context().close();
} catch (err) {
  failed('nosebleed', err);
}

async function multi(label, names, pick, buy, file) {
  const [c, d] = [await player(names[0]), await player(names[1])];
  await walkUp(c.page);
  await c.page.waitForSelector('.lobby-choice', { timeout: 20_000 });
  await c.page.keyboard.press('m');
  await c.page.waitForSelector('.lobby-pin-input', { timeout: 10_000 });
  await pick(c.page);
  await c.page.waitForTimeout(300);
  await clickText(c.page, '.lobby-actions .btn', 'Public');
  await c.page.waitForSelector('.party-limits', { timeout: 15_000 });
  const shown = await c.page.textContent('.party-limits');
  await clickText(c.page, '.party-row .btn', 'Sit down');
  await buyIn(c.page, buy);
  const tableId = await c.page.evaluate(() => window.casino.app.table.session.snapshot.meta.tableId);
  await walkUp(d.page);
  await d.page.waitForSelector('.lobby-choice', { timeout: 20_000 });
  await d.page.keyboard.press('m');
  const row = `.lobby-row[data-table="${tableId}"]`;
  await d.page.waitForSelector(row, { timeout: 20_000 });
  const cell = (await d.page.textContent(`${row} .lobby-limits-cell`)).trim();
  check(cell === shown.trim(), `${label}: the second player sees the blinds before joining: "${cell}"`);
  await d.page.$eval(row, (e) => e.click());
  await d.page.waitForSelector('.party-limits', { timeout: 15_000 });
  await clickText(d.page, '.party-row .btn', 'Sit down');
  await buyIn(d.page, buy);
  await autoplay(c.page);
  await autoplay(d.page);
  await clickText(c.page, '.party-row .btn', 'Start');
  const hands = await playHands(c.page, 3);
  check(hands >= 3, `${label}: hands played between two people: ${hands}`);
  await c.page.waitForTimeout(800);
  await shot(c.page, `${file}-a`);
  await shot(d.page, `${file}-b`);
  await leave(c.page);
  await leave(d.page);
  for (const p of [c, d]) {
    const bal = balanced(p.name);
    check(bal.ok && bal.in_play === 0, `${label}: every cent accounted for, ${p.name}: ${JSON.stringify(bal)}`);
    await p.page.context().close();
  }
}

if (wanted('multi')) {
  try {
    await multi('$0.50/$1 lobby', ['poker6_e2e_c', 'poker6_e2e_d'], (p) => pickStake(p, '$0.50/$1'), 100, 'poker6-7-multi-micro');
  } catch (err) {
    failed('multi micro', err);
  }
  try {
    // two high rollers: the money a table would have paid them
    for (const n of ['poker6_e2e_e', 'poker6_e2e_f']) {
      const p = await player(n);
      const have = (await me(p.page)).balance;
      if (have < 20_000_000_00) grant(n, 20_000_000 - Math.floor(have / 100));
      await p.page.context().close();
    }
    await multi(
      '$25,000/$50,000 lobby',
      ['poker6_e2e_e', 'poker6_e2e_f'],
      async (p) => {
        await clickText(p, '.lim-opt', 'Custom');
        await p.fill('.lim-input >> nth=0', '25000');
        await p.fill('.lim-input >> nth=1', '50000');
      },
      5_000_000,
      'poker6-8-multi-high',
    );
  } catch (err) {
    failed('multi high', err);
  }
}

await browser.close();
console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nall good');
process.exit(errors.length ? 1 : 0);
