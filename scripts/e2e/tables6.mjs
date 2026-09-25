#!/usr/bin/env node
// Let It Ride and Pai Gow Poker, headless, on the real stack (PORT_BASE=<port> npm run dev):
// several hands of each alone in the dev harness (clicking chips onto the felt, following the
// tips, several hands at once, the house way), then two players at a shared table of each in the
// game proper, with a screenshot at every stage and both players' money checked at the end.
// Usage: node scripts/e2e/tables6.mjs [port] [outDir] [lr|pg|mp-lr|mp-pg|sizes ...]
// (sizes: a hand of each at a phone upright, a phone on its side and a small laptop window)
//
// Until the themed room places the two tables on the floor, the shared tables stand in for the
// Three Card Poker table's spot: the script adds a station there with the new game's model.
// GPU=1 uses the machine's GPU (quicker, closer to the real thing).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6310', outDir = '/tmp/casino-tables6', ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const which = only.length ? only : ['lr', 'pg', 'mp-lr', 'mp-pg'];
const browser = process.env.GPU === '1'
  ? await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
  : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const shots = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);

async function open(game, name, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(() => {
    localStorage.setItem('casino.quality', 'high');
    // tips on, so the bar marks the strategy's choice
    localStorage.setItem('casino.tips', '1');
  });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(`${game}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${game}: ${e}`));
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=${game}&name=${name}`);
  // a name still seated from an earlier run comes back to its chips instead of the buy-in
  const meters = game === 'letitride' ? '.lr-meters' : '.pg-meters';
  await page.waitForFunction((m) => document.querySelector('.modal input[type=number]') || /Chips\$[1-9]/.test(document.querySelector(m)?.textContent ?? ''), meters, { timeout: 180_000 });
  if (await page.$('.modal input[type=number]')) {
    await page.fill('.modal input[type=number]', '5000');
    await page.click('.modal .btn.primary');
  }
  await page.waitForFunction((m) => /Chips\$[1-9]/.test(document.querySelector(m)?.textContent ?? ''), meters, { timeout: 30_000 });
  await page.waitForTimeout(800);
  // nothing left on the layout from before
  await page.keyboard.press('x');
  return page;
}

const shot = async (page, name) => {
  const path = `${outDir}/${name}.png`;
  await page.mouse.move(30, 420);
  await page.screenshot({ path });
  shots.push(path);
  return path;
};

/** The screen position of a table-local point. */
const onScreen = (page, p) =>
  page.evaluate((p) => {
    const { table, engine } = window.casino;
    const V = engine.camera.position.constructor;
    const w = table.stage.root.localToWorld(new V(p[0], p[1], p[2]));
    w.project(engine.camera);
    return { x: ((w.x + 1) / 2) * innerWidth, y: ((1 - w.y) / 2) * innerHeight };
  }, p);

const view = (page) => page.evaluate(() => window.casino.table.view && window.casino.table.session?.snapshot?.view);
const waitFor = (page, fn, arg, ms = 30_000) => page.waitForFunction(fn, arg, { timeout: ms });
const meters = (page, cls) => page.textContent(cls).catch(() => '');

// ---------------------------------------------------------------------------------------------
// Let It Ride

// layout.ts: seat 0 sits at position 3 (0 degrees), its circles at r 0.97 from the arc centre
// (z -0.72) across its line 0.08 apart, the bonus at r 0.825.
const LR = { cz: -0.72, top: 0.76 };
const lrPoint = (angleDeg, r, side = 0) => {
  const a = (angleDeg * Math.PI) / 180;
  return [Math.sin(a) * r + Math.cos(a) * side, LR.top, LR.cz + Math.cos(a) * r - Math.sin(a) * side];
};

async function letItRide() {
  const page = await open('letitride', 'tables6_e2e_lr');
  const circle = await onScreen(page, lrPoint(0, 0.97, 0.08));
  const bonus = await onScreen(page, lrPoint(0, 0.825));
  // Hand 1: two $25 chips a circle ($50 x 3) and a $5 bonus, clicked onto the felt
  await page.mouse.click(circle.x, circle.y);
  await page.mouse.click(circle.x, circle.y);
  await page.keyboard.press('2');
  await page.mouse.click(bonus.x, bonus.y);
  await waitFor(page, () => /Bet\$155/.test(document.querySelector('.lr-meters')?.textContent ?? ''));
  await shot(page, 'lr-1-bets');
  const decide = async (tag) => {
    await page.waitForSelector('.lr-decide:not([hidden])', { timeout: 30_000 });
    await page.waitForTimeout(500);
    if (tag) await shot(page, tag);
    // follow the strategy: the button the tip marks
    const ride = await page.evaluate(() => document.querySelector('.lr-decide .btn.primary')?.classList.contains('tip-pick'));
    const pull = await page.evaluate(() => [...document.querySelectorAll('.lr-decide .btn')].some((b) => !b.classList.contains('primary') && b.classList.contains('tip-pick')));
    await page.keyboard.press(ride || !pull ? 'l' : 'p');
    return ride ? 'ride' : 'pull';
  };
  const handDone = async () => {
    await waitFor(page, () => /Bet\$0/.test(document.querySelector('.lr-meters')?.textContent ?? ''), null, 40_000);
    await page.waitForTimeout(300);
  };
  await page.keyboard.press('Space');
  const d1 = await decide('lr-2-bet1');
  const d2 = await decide('lr-3-bet2');
  await page.waitForSelector('.pill', { timeout: 30_000 });
  await page.waitForTimeout(500);
  await shot(page, 'lr-4-result');
  await handDone();
  log(`let it ride hand 1: ${d1}, ${d2}; ${await meters(page, '.lr-meters')}`);

  // Hands 2-4: rebet and play by the tips
  for (let h = 2; h <= 4; h++) {
    await page.keyboard.press('r');
    await waitFor(page, () => /Bet\$155/.test(document.querySelector('.lr-meters')?.textContent ?? ''));
    await page.keyboard.press('Space');
    const a = await decide();
    const b = await decide();
    await handDone();
    log(`let it ride hand ${h}: ${a}, ${b}; ${await meters(page, '.lr-meters')}`);
  }

  // Three hands at once, Max on the first
  await page.click('.mh-picker .mh-n >> nth=2');
  await page.waitForTimeout(1200);
  await shot(page, 'lr-5-three-hands');
  for (const deg of [0, -16, 16]) {
    const p = await onScreen(page, lrPoint(deg, 0.97));
    await page.keyboard.press('3');
    await page.mouse.click(p.x, p.y);
  }
  await waitFor(page, () => /Bet\$225/.test(document.querySelector('.lr-meters')?.textContent ?? ''));
  await shot(page, 'lr-6-three-bets');
  await page.keyboard.press('Space');
  for (let i = 0; i < 6; i++) await decide(i === 0 ? 'lr-7-three-decide' : undefined);
  await page.waitForSelector('.pill', { timeout: 30_000 });
  await page.waitForTimeout(700);
  await shot(page, 'lr-8-three-results');
  await handDone();
  log(`let it ride three hands: ${await meters(page, '.lr-meters')}`);

  // Rules card open
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  await shot(page, 'lr-9-rules');
  await page.keyboard.press('i');
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------
// Pai Gow Poker

async function paiGow() {
  const page = await open('paigow', 'tables6_e2e_pg');
  const PG = { cz: -0.72, top: 0.76 };
  const pgPoint = (deg, r) => {
    const a = (deg * Math.PI) / 180;
    return [Math.sin(a) * r, PG.top, PG.cz + Math.cos(a) * r];
  };
  const betSpot = await onScreen(page, pgPoint(9, 0.975));
  const fortune = await onScreen(page, pgPoint(9, 0.862));
  await page.mouse.click(betSpot.x, betSpot.y);
  await page.mouse.click(betSpot.x, betSpot.y);
  await page.keyboard.press('2');
  await page.mouse.click(fortune.x, fortune.y);
  await waitFor(page, () => /Bet\$55/.test(document.querySelector('.pg-meters')?.textContent ?? ''));
  await shot(page, 'pg-1-bets');
  await page.keyboard.press('Space');
  await page.waitForSelector('.pg-setter:not([hidden])', { timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, 'pg-2-seven');
  // pick two cards for the low hand by hand, then take the house way instead, and set it
  await page.click('.pg-setter .pg-card >> nth=0');
  await page.click('.pg-setter .pg-card >> nth=1');
  await page.waitForTimeout(200);
  await shot(page, 'pg-3-picked');
  await page.keyboard.press('h');
  await page.waitForTimeout(300);
  await shot(page, 'pg-4-house-way');
  await page.keyboard.press('Space');
  await page.waitForSelector('.pill', { timeout: 40_000 });
  await page.waitForTimeout(600);
  await shot(page, 'pg-5-result');
  await waitFor(page, () => /Bet\$0/.test(document.querySelector('.pg-meters')?.textContent ?? ''), null, 40_000);
  log(`pai gow hand 1: ${await meters(page, '.pg-meters')}`);
  for (let h = 2; h <= 4; h++) {
    await page.keyboard.press('r');
    await waitFor(page, () => /Bet\$55/.test(document.querySelector('.pg-meters')?.textContent ?? ''));
    await page.keyboard.press('Space');
    await page.waitForSelector('.pg-setter:not([hidden])', { timeout: 30_000 });
    await page.keyboard.press('h');
    await page.keyboard.press('Space');
    await waitFor(page, () => /Bet\$0/.test(document.querySelector('.pg-meters')?.textContent ?? ''), null, 40_000);
    log(`pai gow hand ${h}: ${await meters(page, '.pg-meters')}`);
  }
  // two hands at once
  await page.click('.mh-picker .mh-n >> nth=1');
  await page.waitForTimeout(1200);
  for (const deg of [9, -9]) {
    const p = await onScreen(page, pgPoint(deg, 0.975));
    await page.keyboard.press('3');
    await page.mouse.click(p.x, p.y);
  }
  await waitFor(page, () => /Bet\$50/.test(document.querySelector('.pg-meters')?.textContent ?? ''));
  await page.keyboard.press('Space');
  for (let i = 0; i < 2; i++) {
    await page.waitForSelector('.pg-setter:not([hidden])', { timeout: 30_000 });
    await page.waitForTimeout(400);
    if (i === 0) await shot(page, 'pg-6-two-hands');
    await page.keyboard.press('h');
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('.pill', { timeout: 40_000 });
  await page.waitForTimeout(700);
  await shot(page, 'pg-7-two-results');
  await waitFor(page, () => /Bet\$0/.test(document.querySelector('.pg-meters')?.textContent ?? ''), null, 40_000);
  log(`pai gow two hands: ${await meters(page, '.pg-meters')}`);
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  await shot(page, 'pg-8-rules');
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------
// Two players at a shared table, in the game proper

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('casino.quality', 'low');
    localStorage.setItem('casino.tips', '1');
  });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`http://localhost:${port}/casino/`);
  await page.waitForSelector('.name-input', { timeout: 180_000 });
  await page.fill('.name-input', name);
  await page.fill('.pass-input', 'casino-dev');
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else {
    await page.click('.menu-item >> nth=0');
  }
  await page.waitForSelector('.hud', { timeout: 30_000 });
  // the daily bonus sheet opens on arrival: leave it unclaimed (the money check below counts on it)
  if (await page.waitForSelector('.daily-sheet', { timeout: 5000 }).catch(() => null)) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.daily-sheet', { state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  return { page, name };
}

/** A station for `game` where the Three Card Poker table stands (its model hidden). */
async function addStation(p, game, id) {
  await p.page.evaluate(async ([game, id]) => {
    const w = window.casino.world;
    if (w.stations.some((s) => s.id === id)) return;
    const base = w.stations.find((s) => s.id === 'tc-1');
    const { GAMES } = await import('/casino/src/games/index.ts');
    const model = GAMES[game].createModel({ variant: '', quality: 'low' });
    base.model.visible = false;
    base.anchor.add(model);
    w.stations.push({ ...base, id, game, variant: '', model, name: game === 'letitride' ? 'Let It Ride' : 'Pai Gow Poker', footprint: GAMES[game].footprint });
  }, [game, id]);
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

const profile = (p) =>
  p.page.evaluate(async () => {
    const r = await fetch(`${location.origin}/casino/api/me`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` } });
    return (await r.json()).profile;
  });

async function shared(game) {
  const tag = game === 'letitride' ? 'lr' : 'pg';
  const station = `${tag}-e2e`;
  const a = await player(`tables6_e2e_${tag}a`);
  const b = await player(`tables6_e2e_${tag}b`);
  const before = [await profile(a), await profile(b)];
  for (const p of [a, b]) await addStation(p, game, station);
  await openLobby(a, station);
  await a.page.click('.lobby-actions .btn:has-text("Private")');
  await a.page.waitForSelector('.party-pin-digits', { timeout: 10_000 });
  const pin = (await a.page.textContent('.party-pin-digits .lb-seg-lit')).trim();
  await openLobby(b, station);
  await b.page.fill('.lobby-pin-input', pin);
  await b.page.keyboard.press('Enter');
  await b.page.waitForSelector('.lobby-go-btn', { timeout: 10_000 });
  await b.page.click('.lobby-go-btn');
  await a.page.waitForFunction(() => document.querySelectorAll('.party-member').length === 2, null, { timeout: 15_000 });
  for (const p of [a, b]) {
    await p.page.click('.party-row .btn:has-text("Sit down")');
    await p.page.waitForSelector('.modal input[type=number]', { timeout: 10_000 });
    await p.page.fill('.modal input[type=number]', '2000');
    await p.page.click('.modal .btn.primary');
  }
  await a.page.waitForFunction(() => [...document.querySelectorAll('.party-status')].filter((e) => e.textContent === '$2,000').length === 2, null, { timeout: 15_000 });
  log(`${game}: private table PIN ${pin}, both seated`);
  await shot(a.page, `${tag}-mp-0-seated`);
  // keep the newest view where the loop below can read it
  for (const p of [a, b]) {
    await p.page.evaluate(() => {
      const s = window.casino.app.table.session;
      s.__lastView = s.snapshot?.view;
      const orig = s.onMessage.bind(s);
      s.onMessage = (m) => {
        orig(m);
        if (m.t === 'ev' || m.t === 'table') s.__lastView = m.view;
      };
    });
  }
  await a.page.click('.party-row .btn:has-text("Start")');
  const meters = tag === 'lr' ? '.lr-meters' : '.pg-meters';
  // Each window: a bet through the table (the chips then show on the felt) and Ready; each decision
  // through the real controls, following the tips.
  const rounds = 2;
  const played = [0, 0];
  const t0 = Date.now();
  let shots = 0;
  while (Date.now() - t0 < 240_000 && Math.min(...played) < rounds) {
    for (const [i, p] of [a, b].entries()) {
      const st = await p.page.evaluate(() => {
        const s = window.casino.app.table?.session;
        const v = s?.__lastView;
        return { phase: v?.phase, round: v?.round, seat: s?.snapshot?.you?.seat };
      }).catch(() => ({}));
      if (st.phase === 'betting' && p.bet !== st.round) {
        p.bet = st.round;
        await p.page.evaluate(([tag, i]) => {
          const s = window.casino.app.table.session;
          s.link.act(tag === 'lr' ? { type: 'bet', unit: 2500, bonus: i ? 500 : 0 } : { type: 'bet', bet: 5000, fortune: i ? 500 : 0 });
          s.link.ready(true);
        }, [tag, i]);
      }
      if (tag === 'lr' && (await p.page.$('.lr-decide:not([hidden])'))) {
        if (shots < 2) await shot(p.page, `lr-mp-${++shots}-decide-${p.name.slice(-1)}`);
        const ride = await p.page.evaluate(() => document.querySelector('.lr-decide .btn.primary')?.classList.contains('tip-pick'));
        await p.page.keyboard.press(ride ? 'l' : 'p');
      }
      if (tag === 'pg' && (await p.page.$('.pg-setter:not([hidden])'))) {
        if (shots < 2) await shot(p.page, `pg-mp-${++shots}-setting-${p.name.slice(-1)}`);
        await p.page.keyboard.press('h');
        await p.page.keyboard.press('Space');
      }
      if (st.phase === 'results' && p.done !== st.round) {
        p.done = st.round;
        played[i]++;
        await p.page.waitForTimeout(2500);
        await shot(p.page, `${tag}-mp-result-${st.round}-${p.name.slice(-1)}`);
        log(`${game}: ${p.name} round ${st.round}: ${await p.page.textContent(meters).catch(() => '')}`);
      }
    }
    await a.page.waitForTimeout(300);
  }
  if (Math.min(...played) < rounds) throw new Error(`${game}: only ${played.join(' and ')} rounds settled`);
  // stand up and let the chips come home, then check the money: balance + chips on tables moved
  // only by what the table says was won or lost
  for (const p of [a, b]) {
    await p.page.evaluate(() => window.casino.app.escape());
    const leave = await p.page.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
    if (leave) await leave.click();
  }
  for (const [i, p] of [a, b].entries()) {
    const t1 = Date.now();
    let prof = await profile(p);
    while (Date.now() - t1 < 90_000 && prof.inPlay !== 0) {
      await p.page.waitForTimeout(2000);
      prof = await profile(p);
    }
    const r = prof.stats.games[game]?.rounds ?? 0;
    const was = before[i].stats.games[game]?.rounds ?? 0;
    const netStats = (prof.stats.games[game]?.net ?? 0) - (before[i].stats.games[game]?.net ?? 0);
    const moved = prof.balance + prof.inPlay - before[i].balance - before[i].inPlay;
    log(`${game}: ${p.name} ${r - was} rounds recorded, net ${netStats / 100}, balance moved ${moved / 100}, on tables ${prof.inPlay / 100}`);
    if (r - was < rounds) errors.push(`${game}: ${p.name} recorded ${r - was} rounds`);
    if (prof.inPlay !== 0) errors.push(`${game}: ${p.name} still has chips on the table`);
    if (moved !== netStats) errors.push(`${game}: ${p.name} balance moved ${moved} but the rounds net ${netStats}`);
  }
  await a.page.context().close();
  await b.page.context().close();
}

// ---------------------------------------------------------------------------------------------
// Small screens: the decision bar and the hand setter at a phone's and a small window's sizes

async function sizes() {
  const SIZES = [
    ['phone', { width: 390, height: 844 }],
    ['phone-side', { width: 844, height: 390 }],
    ['laptop', { width: 1024, height: 640 }],
  ];
  for (const [label, viewport] of SIZES) {
    for (const game of ['letitride', 'paigow']) {
      const tag = game === 'letitride' ? 'lr' : 'pg';
      const page = await open(game, `tables6_e2e_${tag}`, viewport);
      // one hand, and a chip on it
      await page.click('.mh-picker .mh-n >> nth=0');
      await page.waitForTimeout(1200);
      const at = await onScreen(page, tag === 'lr' ? lrPoint(0, 0.97) : [Math.sin((9 * Math.PI) / 180) * 0.975, 0.76, -0.72 + Math.cos((9 * Math.PI) / 180) * 0.975]);
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(400);
      await page.keyboard.press('Space');
      await page.waitForSelector(tag === 'lr' ? '.lr-decide:not([hidden])' : '.pg-setter:not([hidden])', { timeout: 30_000 }).catch(async (err) => {
        await shot(page, `${tag}-size-${label}-failed`);
        throw err;
      });
      await page.waitForTimeout(700);
      await shot(page, `${tag}-size-${label}`);
      if (tag === 'lr') {
        await page.keyboard.press('p');
        await page.waitForSelector('.lr-decide:not([hidden])', { timeout: 30_000 });
        await page.keyboard.press('p');
      } else {
        await page.keyboard.press('h');
        await page.keyboard.press('Space');
      }
      await waitFor(page, (m) => /Bet\$0/.test(document.querySelector(m)?.textContent ?? ''), `.${tag}-meters`, 40_000);
      await page.context().close();
    }
  }
}

try {
  if (which.includes('sizes')) await sizes();
  if (which.includes('lr')) await letItRide();
  if (which.includes('pg')) await paiGow();
  if (which.includes('mp-lr')) await shared('letitride');
  if (which.includes('mp-pg')) await shared('paigow');
} catch (err) {
  // every page still open, as it stood
  let i = 0;
  for (const c of browser.contexts()) for (const p of c.pages()) await shot(p, `failed-${i++}`).catch(() => {});
  console.log(JSON.stringify({ failed: String(err).split('\n')[0], shots, errors: errors.slice(0, 10) }, null, 1));
  await browser.close();
  process.exit(1);
}
console.log(JSON.stringify({ shots, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
