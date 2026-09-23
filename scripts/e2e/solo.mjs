#!/usr/bin/env node
// One player through a solo round of every game in the game proper (tables alone, Hold'em
// against bots, the machines), then broke: lose a small bankroll at roulette, take the bank's
// loan at the cashier, reload, and check the loan and balance survived.
// Usage: node scripts/e2e/solo.mjs [port] [outDir] [games...]   (PORT_BASE=<port> npm run dev first)
// BROKE_SQL=1 lets it lower the local account's balance first (local dev database only), so the
// bust takes a few spins instead of a thousand.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [port = '5173', out = '/tmp/casino-solo', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const STATIONS = {
  blackjack: 'bj-1', roulette: 'rl-us', craps: 'cr-1', baccarat: 'bc-1', threecard: 'tc-1', holdem: 'he-1',
  slots: 'slots-sevens-1', videopoker: 'vp-1',
};
const games = process.env.ONLY_BROKE ? [] : only.length ? only : Object.keys(STATIONS);
const errors = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(([q, api]) => { localStorage.setItem('casino.quality', q); if (api) window.__api = api; }, [process.env.QUALITY ?? 'low', process.env.API ?? '']);
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const name = process.env.NAME ?? 'solo_e2e';

async function enterFloor() {
  await page.goto(`${process.env.BASE ?? `http://localhost:${port}`}/casino/`);
  await page.waitForSelector('.name-input, .menu-item', { timeout: 180_000 });
  if (await page.$('.name-input')) {
    await page.fill('.name-input', name);
    await page.fill('.pass-input', 'casino-dev'); // DEV_PASSWORD in client/src/net/api.ts
    await page.click('.enter-btn');
  }
  await page.waitForSelector('.menu-item', { timeout: 20_000 });
  await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 20_000 });
}

const me = () =>
  page.evaluate(async () => {
    const r = await fetch(`${window.__api ?? location.origin}/casino/api/me`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` } });
    return (await r.json()).profile;
  });

async function sit(station, buyIn = 1000) {
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, station);
  if (!/^(slots|vp)-/.test(station)) {
    await page.waitForSelector('.lobby-choice', { timeout: 10_000 });
    await page.keyboard.press('s');
  }
  await page.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
  await page.fill('.modal input[type=number]', String(buyIn));
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });
}

/** Play until the table reports a finished round for us, acting through the table link. */
async function playRound(game) {
  await page.evaluate((game) => {
    const s = window.casino.app.table.session;
    const act = (a) => s.link.act(a);
    s.__done = false;
    const seat = () => s.snapshot?.you?.seat;
    const orig = s.onMessage.bind(s);
    s.onMessage = (m) => {
      orig(m);
      if (m.t !== 'ev') return;
      for (const e of m.events) {
        if (['result', 'settle', 'win', 'done'].includes(e.type) && (e.seat === undefined || e.seat === seat())) s.__done = true;
        if (game === 'blackjack' && e.type === 'turn' && e.seat === seat()) act({ type: 'stand' });
        if (game === 'blackjack' && e.type === 'insurance') act({ type: 'insurance', take: false });
        if (game === 'threecard' && e.type === 'decide') act({ type: 'play' });
        if (game === 'holdem' && m.view?.turn?.seat === seat()) {
          act({ type: 'check' });
          setTimeout(() => act({ type: 'call' }), 700);
        }
        if (game === 'videopoker' && e.type === 'deal') setTimeout(() => act({ type: 'draw', hold: [true, true, false, false, false] }), 400);
        if (game === 'slots' && e.type === 'spin') s.__done = true;
        if (game === 'videopoker' && (e.type === 'result' || e.type === 'draw')) s.__done = true;
        if (game === 'craps' && e.type === 'roll') s.__done = true;
      }
    };
    const first = {
      blackjack: [{ type: 'bet', amount: 2500 }, { type: 'deal' }],
      roulette: [{ type: 'bet', bets: [{ kind: 'red', amount: 500 }] }, { type: 'spin' }],
      craps: [{ type: 'bet', bets: [{ kind: 'field', amount: 1000 }] }, { type: 'roll' }],
      baccarat: [{ type: 'bet', banker: 2500 }, { type: 'deal' }],
      threecard: [{ type: 'bet', ante: 1000, pairPlus: 0 }, { type: 'deal' }],
      holdem: [],
      slots: [{ type: 'spin', coins: 1, denom: 100 }],
      videopoker: [{ type: 'deal', coins: 5, denom: 100 }],
    }[game];
    first.forEach((a, i) => setTimeout(() => act(a), 300 + i * 600));
  }, game);
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000 && !(await page.evaluate(() => window.casino.app.table?.session.__done))) await page.waitForTimeout(1000);
  await page.waitForTimeout(2500);
  return (Date.now() - t0) / 1000;
}

async function stand() {
  await page.evaluate(() => window.casino.app.escape());
  const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
  if (leave) await leave.click();
  const t1 = Date.now();
  while (Date.now() - t1 < 90_000 && (await me()).inPlay !== 0) await page.waitForTimeout(1500);
}

try {
  await enterFloor();
  const start = await me();
  log(`${name}: balance $${start.balance / 100}, loans ${start.loansTaken}`);
  for (const game of games) {
    const before = (await me()).stats.games[game]?.rounds ?? 0;
    await sit(STATIONS[game]);
    const secs = await playRound(game);
    await shot(`solo-${game}`);
    await stand();
    const prof = await me();
    const after = prof.stats.games[game]?.rounds ?? 0;
    log(`${game}: round in ${secs.toFixed(0)} s, rounds ${before} -> ${after}, balance $${prof.balance / 100}, on tables $${prof.inPlay / 100}`);
    if (after <= before) errors.push(`${game}: no round recorded`);
    if (prof.inPlay !== 0) errors.push(`${game}: chips left on the table`);
  }

  if (!only.length || process.env.BROKE) {
    // Broke: bring the balance down to $60 in the local database, then lose it at roulette.
    if (process.env.BROKE_SQL) {
      const id = (await me()).id;
      execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', `UPDATE casino_accounts SET balance = 6000 WHERE id = ${id} AND in_play = 0`], { env: { ...process.env, CI: '1' }, stdio: 'ignore' });
      await page.reload();
      await page.waitForSelector('.menu-item', { timeout: 180_000 });
      await page.click('.menu-item >> nth=0');
      await page.waitForSelector('.hud', { timeout: 20_000 });
    }
    const low = await me();
    log(`broke run: balance $${low.balance / 100}`);
    await sit(STATIONS.roulette, Math.min(low.balance / 100, 20_000));
    const stake = (await me()).inPlay;
    await page.evaluate((stake) => {
      const s = window.casino.app.table.session;
      const spin = () => {
        const stack = s.__stack ?? 0;
        if (stack <= 0) return;
        // Everything on black, a table limit at a time.
        s.link.act({ type: 'bet', bets: [{ kind: 'black', amount: Math.min(stack, 500_000) }] });
        setTimeout(() => s.link.act({ type: 'spin' }), 400);
      };
      const orig = s.onMessage.bind(s);
      s.onMessage = (m) => {
        orig(m);
        if (m.t === 'seat') s.__stack = m.stack;
        if (m.t === 'ev' && m.events.some((e) => e.type === 'settle')) setTimeout(spin, 800);
      };
      // The seat message with the stack came before this hook; the escrow is the same number.
      s.__stack = stake;
      spin();
    }, stake);
    const t0 = Date.now();
    while (Date.now() - t0 < 240_000) {
      const p = await me();
      if (p.balance === 0 && p.inPlay === 0) break;
      await page.waitForTimeout(2000);
    }
    await shot('broke-1-table');
    await stand();
    const busted = await me();
    log(`busted: balance $${busted.balance / 100}, on tables $${busted.inPlay / 100}`);
    if (busted.balance !== 0 || busted.inPlay !== 0) errors.push('could not go broke (the wheel kept paying); loan step skipped');
    else {
      // The cashier, the way a player gets there: E at the cage.
      await page.evaluate(() => {
        const w = window.casino.world;
        w.teleport(w.cashier.position.x, w.cashier.position.z, Math.PI);
      });
      await page.waitForTimeout(800);
      await page.keyboard.press('e');
      await page.waitForSelector('.bank-take', { timeout: 10_000 });
      await page.waitForTimeout(600);
      await shot('broke-2-cashier');
      await page.click('.bank-take');
      await page.waitForFunction(() => (window.casino.session.profile?.balance ?? 0) > 0, null, { timeout: 10_000 });
      await page.waitForTimeout(800);
      await shot('broke-3-loan');
      const lent = await me();
      log(`loan: balance $${lent.balance / 100}, loans taken ${lent.loansTaken}`);
      if (lent.balance !== 5_000_000 || lent.loansTaken !== busted.loansTaken + 1) errors.push('loan did not land');

      // Reload: the session and the money are still there.
      await page.reload();
      await page.waitForSelector('.menu-item', { timeout: 180_000 });
      await page.waitForTimeout(1200);
      await shot('broke-4-reloaded');
      const again = await page.evaluate(() => window.casino.session.profile);
      log(`reloaded: ${again.name} balance $${again.balance / 100}, loans ${again.loansTaken}`);
      if (again.balance !== lent.balance || again.loansTaken !== lent.loansTaken) errors.push('reload lost the balance or the loan');
    }
  }
} catch (err) {
  errors.push(`script: ${err?.message ?? err}`);
}

console.log(JSON.stringify({ errors: errors.slice(0, 20) }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
