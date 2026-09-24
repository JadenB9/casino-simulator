#!/usr/bin/env node
// Table limits and Max, headless.
//
// Part 1, the game proper with two players: Alice walks up to blackjack, picks Custom limits of
// $30 to $3,000 and opens a public table; the party panel and the buy-in prompt follow them. Bob
// walks up to the same station and sees her table in the list with its limits before joining,
// joins, is refused a bet over the maximum, and his Max puts all his chips down (they are less
// than the maximum). The table's painted sign shows the table's own limits to both.
//
// Part 2, solo tables in the dev harness at chosen limits: Max at blackjack, War, Three Card,
// baccarat, roulette, Big Six, Sic Bo and craps, and Hold'em's All-in, with a screenshot of each.
//
// Usage: node scripts/e2e/limits.mjs [port] [outDir] [lobby|<game>...]   (PORT_BASE=<port> npm run dev first)
// With no parts named, all of them run.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', out = '/tmp/casino-limits', ...only] = process.argv.slice(2);
const wanted = (part) => only.length === 0 || only.includes(part);
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? `http://localhost:${port}`;
// Fixed names so reruns log back in: the API allows only a few new accounts per hour from one address.
const tag = process.env.TAG ?? 'e2e';
const errors = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const check = (ok, what) => {
  if (!ok) errors.push(what);
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
/** A step that threw: say so now (and in the summary), with where it was. */
const failed = (where, err) => {
  const text = `${where}: ${String(err?.message ?? err).split('\n')[0]}`;
  errors.push(text);
  log(`FAIL ${text}`);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function newPage(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('casino.quality', 'low');
    // every run starts from the Standard pick
    for (const k of Object.keys(localStorage)) if (k.startsWith('casino.limits.')) localStorage.removeItem(k);
  });
  const page = await ctx.newPage();
  // software rendering on a busy machine: every step gets room
  page.setDefaultTimeout(120_000);
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  return page;
}

async function player(name) {
  const page = await newPage(name);
  await page.goto(`${base}/casino/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  // the whole floor loads first: minutes on a software renderer sharing the machine
  await page.waitForSelector('.name-input', { timeout: 600_000 });
  await page.fill('.name-input', name);
  await page.fill('.pass-input', 'casino-dev'); // DEV_PASSWORD in client/src/net/api.ts
  await page.click('.enter-btn');
  // a name's first visit walks through its look first; either way end on the floor
  await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 30_000 });
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else {
    await page.click('.menu-item >> nth=0');
  }
  await page.waitForSelector('.hud', { timeout: 30_000 });
  return { page, name };
}

const shot = (page, file) => page.screenshot({ path: `${out}/${file}.png` });

const walkUp = (page, station) =>
  page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, station);

/** Keep the newest table view where the checks can read it (a lobby's view is wrapped by its party panel). */
const trackView = (page) =>
  page.evaluate(() => {
    const s = window.casino.app.table.session;
    s.__view = s.snapshot?.view ?? null;
    const orig = s.onMessage.bind(s);
    s.onMessage = (m) => {
      orig(m);
      if (m.t === 'ev' || m.t === 'table') s.__view = m.view;
    };
  });

/** The server's answer to one action: the refusal's words, or null if it went through. */
const tryAct = (page, action) =>
  page.evaluate(
    (a) =>
      new Promise((resolve) => {
        const s = window.casino.app.table.session;
        const orig = s.onMessage.bind(s);
        const done = (v) => {
          s.onMessage = orig;
          resolve(v);
        };
        s.onMessage = (m) => {
          orig(m);
          if (m.t === 'err') done(m.msg);
          else if (m.t === 'ev' && m.events.some((e) => e.type === 'bet')) done(null);
        };
        s.link.act(a);
        setTimeout(() => done('no answer'), 5000);
      }),
    action,
  );

// ---------------------------------------------------------------------------------------------
// Part 1

if (wanted('lobby')) try {
  const a = await player(`lim_al_${tag}`);
  const b = await player(`lim_bo_${tag}`);
  log(`logged in ${a.name} and ${b.name}`);

  await walkUp(a.page, 'bj-1');
  await a.page.waitForSelector('.lim-opt', { timeout: 10_000 });
  await a.page.waitForTimeout(400);
  const tiers = await a.page.$$eval('.lim-opt', (bs) => bs.map((x) => x.textContent.trim()));
  check(tiers.length === 7 && tiers[1] === 'Standard$25–$5K' && tiers[5] === 'Penthouse$5K–$500K', `the first screen offers every tier: ${tiers.join(' | ')}`);
  check((await a.page.textContent('.lim-buyin')) === 'Buy-in $100–$500,000', 'and the Standard buy-in, up to a hundred times the maximum');
  await a.page.click('.lim-opt:has-text("Penthouse")');
  const pent = await a.page.textContent('.lim-buyin');
  check(pent === 'Buy-in $20,000–$50,000,000', `Penthouse brings the buy-in with it: "${pent}"`);
  await shot(a.page, 'limits-1-picker-penthouse');
  await a.page.click('.lim-opt:has-text("Standard")');
  await shot(a.page, 'limits-1-picker');

  await a.page.keyboard.press('m');
  await a.page.waitForSelector('.lobby-pin-input', { timeout: 10_000 });
  await a.page.click('.lim-opt:has-text("Custom")');
  await a.page.fill('.lim-input >> nth=0', '30');
  await a.page.fill('.lim-input >> nth=1', '200');
  const bad = await a.page.textContent('.lim-rule');
  check(/at least 10 times/.test(bad) && (await a.page.isDisabled('.lobby-actions .btn >> nth=0')), `a maximum under 10x the minimum is refused in words: "${bad}"`);
  await a.page.fill('.lim-input >> nth=1', '3000');
  await a.page.waitForTimeout(200);
  await shot(a.page, 'limits-2-start-custom');
  await a.page.click('.lobby-actions .btn:has-text("Public")');
  await a.page.waitForSelector('.party-limits', { timeout: 15_000 });
  check((await a.page.textContent('.party-limits')) === '$30–$3,000', 'the party panel shows the table limits');
  await a.page.click('.party-row .btn:has-text("Sit down")');
  await a.page.waitForSelector('.modal input[type=number]', { timeout: 10_000 });
  const noteA = await a.page.textContent('.modal p');
  check(noteA.includes('$120 to $300,000'), `the buy-in follows the limits: "${noteA.trim()}"`);
  await a.page.fill('.modal input[type=number]', '2000');
  await a.page.click('.modal .btn.primary');
  await a.page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });
  const tableId = await a.page.evaluate(() => window.casino.app.table.session.snapshot.meta.tableId);
  log(`Alice opened ${tableId} at $30–$3,000 and sat down`);

  await walkUp(b.page, 'bj-1');
  await b.page.waitForSelector('.lobby-choice', { timeout: 10_000 });
  await b.page.keyboard.press('m');
  const row = `.lobby-row[data-table="${tableId}"]`;
  await b.page.waitForSelector(row, { timeout: 15_000 });
  const cell = (await b.page.textContent(`${row} .lobby-limits-cell`)).trim();
  const said = await b.page.getAttribute(row, 'aria-label');
  check(cell === '$30–$3,000' && said.includes('limits $30–$3,000'), `Bob sees the limits before joining: "${cell}", "${said}"`);
  await b.page.waitForTimeout(300);
  await shot(b.page, 'limits-3-list');
  await b.page.click(row);
  await b.page.waitForSelector('.party-limits', { timeout: 15_000 });
  const cfg = await b.page.evaluate(() => window.casino.app.table.session.snapshot.meta.config);
  check(cfg.limits.default.min === 3000 && cfg.limits.default.max === 300000, 'the table Bob joined is at the limits he was shown');
  await b.page.click('.party-row .btn:has-text("Sit down")');
  await b.page.waitForSelector('.modal input[type=number]', { timeout: 10_000 });
  await shot(b.page, 'limits-4-buyin');
  await b.page.fill('.modal input[type=number]', '1000');
  await b.page.click('.modal .btn.primary');
  await b.page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });

  await trackView(b.page);
  await a.page.click('.party-row .btn:has-text("Start")');
  await b.page.waitForFunction(() => window.casino.app.table.session.__view?.phase === 'betting', null, { timeout: 20_000 });
  const over = await tryAct(b.page, { type: 'bet', amount: 300_100 });
  check(over === 'The table maximum is $3,000.', `a bet over the table maximum is refused: "${over}"`);
  const under = await tryAct(b.page, { type: 'bet', amount: 3_000_00 + 100 });
  check(under !== null, 'and so is any bet past it');
  // Max (A): his $1,000 is under the $3,000 maximum, so all of it goes down.
  await b.page.keyboard.press('a');
  await b.page.waitForFunction(() => {
    const s = window.casino.app.table.session;
    return s.__view?.bets?.[s.snapshot.you.seat] === 100_000;
  }, null, { timeout: 10_000 });
  check(true, "Bob's Max puts all $1,000 of his chips down");
  await b.page.waitForTimeout(600);
  await shot(b.page, 'limits-5-max-blackjack');
  await shot(a.page, 'limits-5-alice');

  for (const p of [a.page, b.page]) {
    await p.evaluate(() => window.casino.app.escape());
    const leave = await p.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
    if (leave) await leave.click();
  }
  await a.page.context().close();
  await b.page.context().close();
} catch (err) {
  failed('part 1', err);
}

// ---------------------------------------------------------------------------------------------
// Part 2: Max at each table, solo at chosen limits

async function harness(game, limits, buyIn, extra = '') {
  const page = await newPage(game);
  await page.goto(`${base}/casino/?dev=table&game=${game}&name=lim_${game.slice(0, 8)}_${tag}&limits=${limits}${extra}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.modal input[type=number]', { timeout: 300_000 });
  await page.fill('.modal input[type=number]', String(buyIn));
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino?.table?.snapshot?.you?.status === 'seated' || window.casino?.table?.view?.seated === true, null, { timeout: 20_000 });
  await page.waitForTimeout(800);
  return page;
}

/** Where a felt region (by id pattern) is on screen: of several, the one nearest the player's edge (mine). */
const regionAt = (page, pattern) =>
  page.evaluate((src) => {
    const re = new RegExp(src);
    const { engine, table } = window.casino;
    let best = null;
    for (const f of table.stage.felts) {
      for (const r of f.spec.regions) {
        if (!re.test(r.id)) continue;
        const a = f.anchorOf(r.id);
        if (!best || a[1] > best.a[1]) best = { f, a };
      }
    }
    if (!best) return null;
    const p = engine.camera.position.clone().set(best.a[0], best.f.mesh.position.y, best.a[1]);
    table.stage.root.localToWorld(p);
    p.project(engine.camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  }, pattern);

const stackOf = (page) => page.evaluate(() => window.casino.table.snapshot.you.stack);

async function pickAndClick(page, at, file) {
  await page.keyboard.press('a');
  await page.waitForSelector('.tray .max-btn[aria-pressed="true"]', { timeout: 5000 });
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(250);
  await shot(page, `${file}-hover`);
  const before = await stackOf(page);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction((b) => window.casino.table.snapshot.you.stack !== b, before, { timeout: 30_000 });
  await page.waitForTimeout(500);
  await shot(page, file);
  return before - (await stackOf(page));
}

const solo = [
  ['blackjack', '10000-1000000', 3000, async (page) => pickAndClick(page, await regionAt(page, '^spot:'), 'max-blackjack'), 300_000],
  // War keeps the raise's match back: $1,001 puts $500 on the bet
  ['war', '2500-250000', 1001, async (page) => pickAndClick(page, await regionAt(page, '^bet:'), 'max-war'), 50_000],
  ['threecard', '2500-250000', 5000, async (page) => pickAndClick(page, await regionAt(page, '^ante:'), 'max-threecard'), 250_000],
  ['baccarat', '10000-2500000', 40000, async (page) => pickAndClick(page, await regionAt(page, ':banker$'), 'max-baccarat'), 2_500_000],
  ['roulette', '2500-1000000', 30000, async (page) => pickAndClick(page, await page.evaluate(() => window.casino.table.view.debug.screenOf('red')), 'max-roulette'), 1_000_000],
  ['bigsix', '500-100000', 10000, async (page) => pickAndClick(page, await page.evaluate(() => window.casino.table.view.debug.screenOf('one')), 'max-bigsix'), 100_000],
  ['sicbo', '2500-1000000', 3000, async (page) => pickAndClick(page, await page.evaluate(() => window.casino.table.view.debug.screenOf('big')), 'max-sicbo'), 300_000],
  ['craps', '2500-1000000', 2500, async (page) => pickAndClick(page, await regionAt(page, '^R\\|pass$'), 'max-craps'), 250_000],
];

for (const [game, limits, buyIn, run, want] of solo) {
  if (!wanted(game)) continue;
  try {
    const page = await harness(game, limits, buyIn);
    const got = await run(page);
    check(got === want, `${game}: Max put down $${got / 100} (want $${want / 100})`);
    await page.context().close();
  } catch (err) {
    failed(game, err);
  }
}

// Hold'em: All-in and Max in the action bar at $1/$2
if (wanted('holdem')) try {
  const page = await harness('holdem', '100-200', 200);
  await page.waitForSelector('.he-bar.he-live', { timeout: 60_000 });
  await page.waitForTimeout(400);
  await shot(page, 'max-holdem');
  await page.click('.he-preset:has-text("Max")');
  const raise = (await page.textContent('.he-raise .he-btn-text')).trim();
  check(/^All-in \$/.test(raise), `Hold'em's Max size sets the raise to all in: "${raise}"`);
  await shot(page, 'max-holdem-sized');
  const blinds = await page.evaluate(() => window.casino.table.snapshot.view.blinds);
  check(blinds.sb === 100 && blinds.bb === 200, `Hold'em plays the chosen blinds: ${JSON.stringify(blinds)}`);
  await page.context().close();
} catch (err) {
  failed('holdem', err);
}

await browser.close();
console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join('\n')}` : '\nall good');
process.exit(errors.length ? 1 : 0);
