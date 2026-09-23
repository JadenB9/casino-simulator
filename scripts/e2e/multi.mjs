#!/usr/bin/env node
// Two players in two browser contexts through the game proper: both log in and walk the floor
// and see each other; then at each multiplayer table the first opens a private lobby, the second
// joins with its PIN, both buy in, the leader starts, and a small bot on each side bets every
// window until a round has been played. The check is the server's: after both cash out, each
// profile's per-game stats must show the round.
// Usage: node scripts/e2e/multi.mjs [port] [outDir] [games...]   (PORT_BASE=<port> npm run dev first)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', out = '/tmp/casino-multi', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const TABLES = { blackjack: 'bj-1', roulette: 'rl-us', craps: 'cr-1', baccarat: 'bc-1', threecard: 'tc-1', holdem: 'he-1' };
const games = only.length ? only : Object.keys(TABLES);
// Fixed names by default so reruns log back in: the API allows only a few new accounts per hour
// from one address.
const tag = process.env.TAG ?? 'e2e';
const errors = [];
const steps = [];
const log = (s) => {
  steps.push(s);
  console.log(new Date().toISOString().slice(11, 19), s);
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Two players share one software-rendered browser, so they play at low graphics unless
  // QUALITY=high asks otherwise; this check is about the tables, not the lights.
  const quality = process.env.QUALITY ?? 'low';
  await ctx.addInitScript((q) => localStorage.setItem('casino.quality', q), quality);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    // Refused moves while a bot guesses at turns show up as the table's toasts, not errors;
    // anything else logged as an error is kept.
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`http://localhost:${port}/casino/`);
  await page.waitForSelector('.name-input', { timeout: 180_000 });
  await page.fill('.name-input', name);
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item', { timeout: 20_000 });
  await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 20_000 });
  const id = await page.evaluate(() => window.casino.session.profile.id);
  return { page, name, id };
}

const shot = (p, file) => p.page.screenshot({ path: `${out}/${file}.png` });

/** The bot: bet each window and ready up; take the plain move when it is your turn. */
async function arm(p, game) {
  await p.page.evaluate((game) => {
    const s = window.casino.app.table.session;
    const act = (a) => s.link.act(a);
    const mine = () => s.snapshot?.you?.seat;
    let betRound = -1;
    s.__rounds = 0;
    const orig = s.onMessage.bind(s);
    s.onMessage = (m) => {
      orig(m);
      if (m.t === 'err') (window.__evlog ??= []).push(`ERR ${m.code}: ${m.msg}`);
      if (m.t !== 'ev') return;
      if (m.events.some((e) => ['result', 'settle', 'showdown', 'win', 'payout'].includes(e.type))) s.__rounds++;
      s.__lastView = m.view;
      (window.__evlog ??= []).push(m.events.map((e) => e.type).join(','));
      const me = mine();
      for (const e of m.events) {
        const t = e.type;
        if (game === 'blackjack') {
          if (t === 'betting') {
            act({ type: 'bet', amount: 2500 });
            s.link.ready(true);
          } else if (t === 'insurance') act({ type: 'insurance', take: false });
          else if (t === 'turn' && e.seat === me) act({ type: 'stand' });
        } else if (game === 'roulette') {
          if (t === 'betting' && e.round !== betRound) {
            betRound = e.round;
            act({ type: 'bet', bets: [{ kind: 'red', amount: 500 }] });
            act({ type: 'ready', on: true });
          }
        } else if (game === 'baccarat') {
          if (t === 'betting') {
            act({ type: 'bet', banker: 2500 });
            s.link.ready(true);
          }
        } else if (game === 'threecard') {
          if (t === 'betting') {
            act({ type: 'bet', ante: 1000, pairPlus: 0 });
            s.link.ready(true);
          } else if (t === 'decide') act({ type: 'play' });
        } else if (game === 'craps') {
          // A shooter needs a line bet on the come-out; the field is decided by every roll.
          if (t === 'open' || t === 'pause' || t === 'result' || t === 'shooter') {
            const mineBets = m.view?.bets?.[me] ?? {};
            const want = [];
            if (m.view?.point == null && !mineBets.pass) want.push({ kind: 'pass', amount: 1000 });
            if (!mineBets.field) want.push({ kind: 'field', amount: 1000 });
            if (want.length) act({ type: 'bet', bets: want });
            s.link.ready(true);
          }
          if (m.view?.shooter === me) setTimeout(() => act({ type: 'roll' }), 3200);
        } else if (game === 'holdem') {
          // Check when it's free, call when it isn't: a refused check is followed by a call.
          if (m.view?.turn?.seat === me && s.__turnAt !== m.view.turn.deadline) {
            s.__turnAt = m.view.turn.deadline;
            act({ type: 'check' });
            setTimeout(() => {
              if (s.__lastView?.turn?.seat === me && s.__lastView.turn.deadline === s.__turnAt) act({ type: 'call' });
            }, 700);
          }
        }
      }
    };
  }, game);
}

async function openLobby(p, station) {
  await p.page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, station);
  await p.page.waitForSelector('.lobby-choice', { timeout: 10_000 });
  await p.page.keyboard.press('m');
  await p.page.waitForSelector('.lobby-pin-input', { timeout: 10_000 });
}

async function sitDown(p) {
  await p.page.click('.party-row .btn:has-text("Sit down")');
  await p.page.waitForSelector('.modal input[type=number]', { timeout: 10_000 });
  await p.page.fill('.modal input[type=number]', '1000');
  await p.page.click('.modal .btn.primary');
}

async function statsOf(p) {
  return p.page.evaluate(async () => {
    const r = await fetch(`${window.location.origin}/casino/api/me`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` } });
    return (await r.json()).profile;
  });
}

try {
  const a = await player(`al_${tag}`);
  const b = await player(`bo_${tag}`);
  log(`logged in ${a.name} (${a.id}) and ${b.name} (${b.id})`);

  // Presence: each sees the other, and a walk shows up on the other side.
  await a.page.waitForFunction((id) => window.casino.app.remotes?.drawn?.has(id), b.id, { timeout: 15_000 });
  await b.page.waitForFunction((id) => window.casino.app.remotes?.drawn?.has(id), a.id, { timeout: 15_000 });
  const before = await b.page.evaluate((id) => window.casino.app.remotes.drawn.get(id).ch.root.position.toArray(), a.id);
  await a.page.keyboard.down('KeyW');
  await a.page.waitForTimeout(2500);
  await a.page.keyboard.up('KeyW');
  await b.page.waitForTimeout(1200);
  const after = await b.page.evaluate((id) => window.casino.app.remotes.drawn.get(id).ch.root.position.toArray(), a.id);
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
  const online = await b.page.textContent('.hud-online');
  log(`presence: ${b.name} sees ${a.name} walk ${moved.toFixed(2)} m; HUD "${online.trim()}"`);
  if (moved < 0.2) errors.push('presence: the walk did not show up on the other side');
  await shot(b, 'multi-0-presence');

  for (const game of games) {
    const station = TABLES[game];
    await openLobby(a, station);
    await a.page.click('.lobby-actions .btn:has-text("Private")');
    await a.page.waitForSelector('.party-pin-digits', { timeout: 10_000 });
    const pin = (await a.page.textContent('.party-pin-digits .lb-seg-lit')).trim();
    await openLobby(b, station);
    await b.page.fill('.lobby-pin-input', pin);
    await b.page.keyboard.press('Enter');
    await a.page.waitForFunction(() => document.querySelectorAll('.party-member').length === 2, null, { timeout: 15_000 });
    log(`${game}: private lobby PIN ${pin}, both in`);
    await sitDown(a);
    await sitDown(b);
    const seated = () => [...document.querySelectorAll('.party-status')].filter((e) => e.textContent === '$1,000').length === 2;
    await a.page.waitForFunction(seated, null, { timeout: 15_000 });
    await arm(a, game);
    await arm(b, game);
    await a.page.click('.party-row .btn:has-text("Start")');
    // The round is done when both seats' stacks have moved from $1,000 or a result event has
    // arrived; give slow headless animations plenty of time.
    const t0 = Date.now();
    const settled = async (p) =>
      p.page.evaluate(() => {
        const s = window.casino.app.table?.session;
        return !!s && (s.__rounds ?? 0) > 0;
      });
    while (Date.now() - t0 < 120_000 && !((await settled(a)) && (await settled(b)))) await a.page.waitForTimeout(1000);
    if (process.env.DEBUG) for (const p of [a, b]) console.log(game, p.name, (await p.page.evaluate(() => (window.__evlog ?? []).slice(-40).join(' | '))).slice(0, 3000));
    await shot(a, `multi-${game}-a`);
    await shot(b, `multi-${game}-b`);
    log(`${game}: round settled after ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    // Stand up (confirming the leave) and let the cash-out land.
    for (const p of [a, b]) {
      await p.page.evaluate(() => window.casino.app.escape());
      const leave = await p.page.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
      if (leave) await leave.click();
    }
    // Chips come home once nothing of yours is live; a craps line bet with a point stays up (it
    // can't be taken down) and the table rolls on its own until it's decided.
    for (const p of [a, b]) {
      const t1 = Date.now();
      while (Date.now() - t1 < 120_000 && (await statsOf(p)).inPlay !== 0) await p.page.waitForTimeout(2000);
    }
    for (const p of [a, b]) {
      const prof = await statsOf(p);
      const rounds = prof.stats.games[game]?.rounds ?? 0;
      log(`${game}: ${p.name} rounds ${rounds}, balance $${prof.balance / 100}, on tables $${prof.inPlay / 100}`);
      if (rounds < 1) errors.push(`${game}: no round recorded for ${p.name}`);
      if (prof.inPlay !== 0) errors.push(`${game}: ${p.name} still has chips on a table`);
    }
  }
} catch (err) {
  errors.push(`script: ${err?.message ?? err}`);
}

console.log(JSON.stringify({ steps, errors: errors.slice(0, 20) }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
