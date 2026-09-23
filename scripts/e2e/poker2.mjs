#!/usr/bin/env node
// Headless check of the poker tables with Tips on. Hold'em: real decisions against the bots (the
// tip line, the one ringed move, the guide note), Tips switched off and on again, then scenes
// played with the live feed paused: a made hand (banner and glow) and a big showdown win (the
// five lifted, banner, chips). Video poker: the ringed cards against the tip's hold, holding them
// and drawing, the fifth-coin tip, a scripted deal with a close hold, and a scripted royal.
// Usage: node scripts/e2e/poker2.mjs [port] [out dir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5710', outDir = '/tmp/poker2-e2e'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const base = `http://localhost:${port}/casino/`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = { shots: [], holdem: {}, videopoker: {}, errors: [] };
const fail = (msg) => report.errors.push(msg);

async function open(game, name) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => m.type() === 'error' && report.errors.push(`${game}: ${m.text()}`));
  page.on('pageerror', (e) => report.errors.push(`${game}: ${e.stack ?? e}`));
  await page.addInitScript(() => localStorage.setItem('casino.tips', '1'));
  await page.goto(`${base}?dev=table&game=${game}&name=${name}`);
  // A returning account may still hold its seat, so either the buy-in or the table comes first.
  await page.waitForFunction(() => document.querySelector('.modal input[type=number]') || window.casino?.table?.snapshot, null, { timeout: 30000 });
  await buyIn(page);
  // Keep the newest view from the feed (the join snapshot can predate your seat), and a switch
  // to pause the feed while a scripted scene plays.
  await page.evaluate(() => {
    const t = window.casino.table;
    const feed = t.onMessage.bind(t);
    t.onMessage = (m) => {
      if (m?.view) window.__lastView = m.view;
      if (!window.__paused) feed(m);
    };
    // Every celebration banner shown, recorded as it's added: software rendering can stall the
    // page for longer than a banner stays up, so polling the page for one can miss it.
    window.__banners = [];
    new MutationObserver((changes) => {
      for (const c of changes) for (const n of c.addedNodes) if (n.classList?.contains('celebrate')) window.__banners.push(n.textContent);
    }).observe(document.body, { childList: true, subtree: true });
    // A snapshot to draw a scripted scene from: the newest view.
    window.__sceneSnapshot = () => {
      const snap = structuredClone(t.snapshot);
      snap.view = structuredClone(window.__lastView ?? snap.view);
      return snap;
    };
  });
  return page;
}

async function buyIn(page) {
  if (await page.locator('.modal input[type=number]').isVisible().catch(() => false)) {
    await page.fill('.modal input[type=number]', '1000');
    await page.click('.modal .btn.primary');
    await page.waitForTimeout(600);
  }
}

async function shot(page, name) {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  report.shots.push(path);
}

const tipState = (page) =>
  page.evaluate(() => {
    const line = document.querySelector('.tip-line');
    return {
      text: line && !line.hidden ? line.textContent.replace(/^Tip/, '') : null,
      picks: [...document.querySelectorAll('.tip-pick')].map((b) => b.textContent.trim()),
      note: document.querySelector('.he-bar-note')?.textContent ?? null,
    };
  });

/** Wait for a condition in the page. Headless software rendering can run at a frame or two a
 * second, and animations advance per frame, so the checks wait on what the screen shows, not on
 * fixed times. */
const until = (page, fn, arg, ms = 40_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 150 }).then(() => true, () => false);
const bannerCount = (page) => page.evaluate(() => window.__banners.length);
const lastBanner = (page) => page.evaluate(() => window.__banners.at(-1) ?? null);
const tipLike = (page, re) => until(page, (src) => new RegExp(src).test(document.querySelector('.tip-line:not([hidden])')?.textContent ?? ''), re.source);

/** Switch the Tips setting from inside the page (the same module instance the table uses). */
const setTips = (page, on) =>
  page.evaluate(async (on) => {
    const m = await import(`${location.pathname}src/app/tips.ts`);
    m.tips.set(on);
  }, on);

// ---------------------------------------------------------------------------------------------
// Hold'em: real decisions

{
  const page = await open('holdem', 'poker2_he');
  const seen = [];
  const want = { preflop: false, flop: false, facing: false };
  const t0 = Date.now();
  let toggled = false;
  while (Date.now() - t0 < 240_000 && (seen.length < 14 || !want.flop || !want.facing)) {
    await buyIn(page);
    if (await page.locator('.he-back').isVisible().catch(() => false)) await page.click('.he-back').catch(() => {});
    if (!(await page.locator('.he-bar.he-live').isVisible().catch(() => false))) {
      await page.waitForTimeout(200);
      continue;
    }
    // Tips wait for the batch's animation (a deal or a street), then a moment for the estimate.
    // Headless rendering can take many seconds over a deal, so give it time.
    let tip = await tipState(page);
    for (let i = 0; i < 100 && !tip.text; i++) {
      await page.waitForTimeout(200);
      tip = await tipState(page);
    }
    if (!(await page.locator('.he-bar.he-live').isVisible().catch(() => false))) continue;
    seen.push(tip);
    if (!tip.text) fail(`holdem: no tip at a decision (${JSON.stringify(tip)})`);
    else if (tip.picks.length !== 1) fail(`holdem: ${tip.picks.length} ringed moves for "${tip.text}"`);
    if (tip.text && tip.note !== 'Tips are a guide, not a guarantee') fail(`holdem: guide note missing (${tip.note})`);
    const pre = /suited|offsuit|Pocket/.test(tip.text ?? '');
    if (pre && !want.preflop) {
      want.preflop = true;
      await shot(page, 'holdem-1-tip-preflop');
    } else if (!pre && /Nothing to call/.test(tip.text ?? '') && !want.flop) {
      want.flop = true;
      await shot(page, 'holdem-2-tip-flop');
    } else if (/Calling needs/.test(tip.text ?? '') && !want.facing) {
      want.facing = true;
      await shot(page, 'holdem-3-tip-facing-bet');
    }
    if (!toggled && seen.length >= 3 && tip.text) {
      // Off: the line and the ring go at once; on again: they come back for the same decision.
      toggled = true;
      await setTips(page, false);
      await page.waitForTimeout(150);
      const off = await tipState(page);
      await setTips(page, true);
      await page.waitForTimeout(300);
      const on = await tipState(page);
      report.holdem.toggle = { off, on };
      if (off.text || off.picks.length) fail(`holdem: tip still showing with Tips off (${JSON.stringify(off)})`);
      if (!on.text || on.picks.length !== 1) fail(`holdem: tip didn't come back (${JSON.stringify(on)})`);
    }
    await page.keyboard.press('c');
    await page.waitForTimeout(350);
    const after = await tipState(page);
    if (after.picks.length) fail('holdem: ring left on after acting');
  }
  report.holdem.decisions = seen.length;
  report.holdem.samples = [...new Set(seen.map((s) => `${s.text} [${s.picks.join(',')}]`))].slice(0, 16);
  report.holdem.shotsFor = want;

  // -------------------------------------------------------------------------------------------
  // Hold'em: scenes played with the live feed paused

  await page.evaluate(() => (window.__paused = true));
  let banners = 0;
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const t = window.casino.table;
    const snap = window.__sceneSnapshot();
    const v = snap.view;
    const me = v.you.seat;
    const opp = v.seats.findIndex((s, i) => s && i !== me);
    snap.you = { ...snap.you, seat: me, status: 'seated' };
    window.__scene = { me, opp };
    const soon = Date.now() + 10_000_000;
    Object.assign(v, { at: soon, phase: 'playing', handId: 9001, street: 'preflop', board: [], pots: [{ amount: 4000, label: 'Main pot', eligible: [me, opp] }], total: 4000, bet: 0, turn: null, nextAt: null, log: [] });
    v.you = { seat: me, cards: ['7c', '7s'], legal: null, sittingOut: false, waiting: false, bank: 30000 };
    v.seats.forEach((s, i) => {
      if (!s) return;
      Object.assign(s, { inHand: i === me || i === opp, folded: false, allIn: false, bet: 0, last: null, hand: null, best: null, won: 0, sittingOut: false, waiting: false, away: false, cards: i === me ? ['7c', '7s'] : i === opp ? [null, null] : [] });
    });
    t.view.onTable(snap);
    const next = structuredClone(v);
    Object.assign(next, { street: 'flop', board: ['7h', 'Kd', '2s'], turn: { seat: me, deadline: soon, bankFrom: soon } });
    next.you.legal = { fold: false, check: true, call: 0, callAllIn: false, bet: { min: 1000, max: 90000 }, raise: null, behind: 90000, street: 0, step: 100 };
    void t.view.onEvents([{ type: 'board', street: 'flop', cards: ['7h', 'Kd', '2s'] }], next);
  });
  if (!(await until(page, (n) => window.__banners.length > n, banners))) fail('holdem: no banner for a made set');
  report.holdem.madeHandBanner = await lastBanner(page);
  banners = await bannerCount(page);
  await page.waitForTimeout(400);
  await shot(page, 'holdem-4-made-hand');
  if (!(await tipLike(page, /Three of a kind/))) fail('holdem: no tip after the made set');
  report.holdem.madeHandTip = await tipState(page);
  await shot(page, 'holdem-5-made-hand-tip');
  // Let the set's banner and glow finish before the next scene.
  await until(page, () => !document.querySelector('.celebrate'));

  await page.evaluate(() => {
    const t = window.casino.table;
    const { me, opp } = window.__scene;
    const snap = window.__sceneSnapshot();
    const v = snap.view;
    snap.you = { ...snap.you, seat: me, status: 'seated' };
    const soon = Date.now() + 10_000_000;
    const board = ['Kh', 'Kd', '9s', '9h', '2c'];
    Object.assign(v, { at: soon, phase: 'runout', handId: 9002, street: 'river', board, pots: [{ amount: 150000, label: 'Main pot', eligible: [me, opp] }], total: 150000, bet: 0, turn: null, nextAt: null, log: [] });
    v.you = { seat: me, cards: ['Kc', '3d'], legal: null, sittingOut: false, waiting: false, bank: 30000 };
    v.seats.forEach((s, i) => {
      if (!s) return;
      Object.assign(s, { inHand: i === me || i === opp, folded: false, allIn: i === me || i === opp, bet: 0, last: null, hand: null, best: null, won: 0, sittingOut: false, waiting: false, away: false, cards: i === me ? ['Kc', '3d'] : i === opp ? [null, null] : [] });
    });
    t.view.onTable(snap);
    const next = structuredClone(v);
    const best = ['Kc', 'Kh', 'Kd', '9s', '9h'];
    Object.assign(next, { phase: 'results', pots: [], total: 0 });
    next.seats[opp] = { ...next.seats[opp], cards: ['Ah', 'Qd'], hand: 'Two Pair, Kings and Nines', allIn: false, inHand: false };
    next.seats[me] = { ...next.seats[me], hand: 'Full House, Kings full of Nines', best, won: 150000, allIn: false, inHand: false, stack: 150000 };
    void t.view.onEvents(
      [
        { type: 'reveal', seat: opp, cards: ['Ah', 'Qd'], hand: 'Two Pair, Kings and Nines' },
        { type: 'reveal', seat: me, cards: ['Kc', '3d'], hand: 'Full House, Kings full of Nines' },
        { type: 'win', pot: 0, label: 'main pot', amount: 150000, winners: [{ seat: me, amount: 150000 }], hand: 'Full House, Kings full of Nines', best },
        { type: 'handEnd', id: 9002 },
      ],
      next,
    );
  });
  if (!(await until(page, (n) => window.__banners.length > n, banners))) fail('holdem: no banner for the showdown win');
  report.holdem.banner = await lastBanner(page);
  await page.waitForTimeout(300);
  await shot(page, 'holdem-6-showdown-win');
  await until(page, () => !document.querySelector('.celebrate'));
  await shot(page, 'holdem-7-showdown-settled');
  await page.close();
}

// ---------------------------------------------------------------------------------------------
// Video poker

{
  const page = await open('videopoker', 'poker2_vp');
  const screenCards = () =>
    page.evaluate(() => [...document.querySelectorAll('.vp-slot')].map((s) => ({ card: s.querySelector('.vp-card').getAttribute('src').split('/').pop().replace('.svg', ''), pick: s.classList.contains('tip-pick') })));
  const text = (c) => `${c[0] === 'T' ? '10' : c[0]}${{ s: '♠', h: '♥', d: '♦', c: '♣' }[c[1]]}`;
  const hands = [];
  // Ready for a deal: the coin value can be changed only between hands, once a result has played out.
  const ready = () => until(page, () => document.querySelector('.vp-denom') && !document.querySelector('.vp-denom').disabled);
  for (let h = 0; h < 4; h++) {
    if (!(await ready())) fail('videopoker: machine never came back to idle');
    await page.keyboard.press('Space');
    await tipLike(page, /Best hold/);
    const tip = (await tipState(page)).text;
    const slots = await screenCards();
    const ringed = slots.filter((s) => s.pick).map((s) => text(s.card));
    hands.push({ cards: slots.map((s) => s.card).join(' '), tip, ringed });
    if (!tip) fail('videopoker: no best-hold tip after the deal');
    else {
      const named = /^Best hold: (none|all five|[^·]+) ·/.exec(tip)?.[1]?.trim();
      const expect = named === 'none' ? [] : named === 'all five' ? slots.map((s) => text(s.card)) : named.split(' ');
      if (expect.join(' ') !== ringed.join(' ')) fail(`videopoker: ringed ${ringed.join(' ')} but the tip says ${tip}`);
    }
    if (h === 0) await shot(page, 'videopoker-1-tip');
    // Hold what the tip rings, draw, and let the result play out.
    for (const [i, s] of slots.entries()) if (s.pick) await page.keyboard.press(String(i + 1));
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
    if ((await tipState(page)).text) fail('videopoker: tip left up during the draw');
  }
  await ready();
  report.videopoker.hands = hands;

  // One coin short of max: the fifth-coin tip.
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  report.videopoker.betTip = (await tipState(page)).text;
  if (!/Bet 5 coins/.test(report.videopoker.betTip ?? '')) fail(`videopoker: no fifth-coin tip (${report.videopoker.betTip})`);
  await shot(page, 'videopoker-2-bet-tip');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  if ((await tipState(page)).text) fail('videopoker: fifth-coin tip still up at five coins');

  // Scripted, with the live feed paused: a close hold, then a royal.
  await page.evaluate(() => {
    const t = window.casino.table;
    window.__paused = true;
    const v = structuredClone(window.__lastView ?? t.snapshot.view);
    const cards = ['Kh', 'Qh', 'Jh', '5h', '2c'];
    void t.view.onEvents([{ type: 'deal', round: 9001, coins: 5, denom: 100, bet: 500, cards, made: 0 }], { ...v, phase: 'dealt', round: 9001, coins: 5, denom: 100, hand: cards, held: [false, false, false, false, false], dealt: 0, result: null });
  });
  if (!(await tipLike(page, /Best hold: K♥ Q♥ J♥/))) fail('videopoker: no tip for the scripted deal');
  report.videopoker.closeHold = { tip: (await tipState(page)).text, ringed: (await screenCards()).filter((s) => s.pick).map((s) => s.card) };
  await shot(page, 'videopoker-3-close-hold');
  const before = await bannerCount(page);
  await page.evaluate(() => {
    const t = window.casino.table;
    const v = structuredClone(window.__lastView ?? t.snapshot.view);
    const royal = ['Ts', 'Js', 'Qs', 'Ks', 'As'];
    void t.view.onEvents(
      [
        { type: 'deal', round: 9002, coins: 5, denom: 100, bet: 500, cards: ['Ts', 'Js', 'Qs', 'Ks', '2c'], made: 0 },
        { type: 'draw', hold: [true, true, true, true, false], cards: royal },
        { type: 'result', seat: 0, rank: 9, name: 'Royal Flush', coins: 5, denom: 100, credits: 4000, payout: 400000 },
      ],
      { ...v, phase: 'over', round: 9002, coins: 5, denom: 100, hand: royal, held: [true, true, true, true, false], dealt: 0, result: { rank: 9, name: 'Royal Flush', credits: 4000, payout: 400000 } },
    );
  });
  if (!(await until(page, (n) => window.__banners.length > n, before))) fail('videopoker: no banner for the royal');
  await page.waitForTimeout(500);
  report.videopoker.banner = await lastBanner(page);
  report.videopoker.status = await page.evaluate(() => document.querySelector('.vp-status')?.className);
  await shot(page, 'videopoker-4-royal');
  await page.close();
}

console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.errors.length ? 1 : 0);
