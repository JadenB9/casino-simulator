#!/usr/bin/env node
// Headless check of Tips and the celebrations at craps, roulette and the three slot machines, in
// the dev harness with Tips on. The tips come from real table states (a come-out, a point with a
// line bet, a top-line bet); the celebrations are fed to the view as the events a lucky roll, spin
// or pull would bring, since the view only animates what it's given.
// Usage: node scripts/e2e/dice2.mjs [port] [outDir] [craps|roulette|european|sevens|wild|neon...]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5720', outDir = '/tmp/casino-dice2', ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const runs = only.length ? only : ['craps', 'roulette', 'european', 'sevens', 'wild', 'neon'];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = {};
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);

async function open(game, variant, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('casino.tips', '1');
    localStorage.setItem('casino.quality', 'low');
  });
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=${game}${variant ? `&variant=${variant}` : ''}&name=${name}`);
  await page.waitForSelector('.modal input[type=number]', { timeout: 90_000 });
  await page.fill('.modal input[type=number]', '5000');
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.table.view && window.casino.table.snapshot?.you?.seat !== null, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const shots = [];
  const shot = async (label) => {
    const path = `${outDir}/${name}-${label}.png`;
    await page.screenshot({ path });
    shots.push(path);
  };
  const tip = () => page.evaluate(() => {
    const t = document.querySelector('.tip-line');
    return t && !t.hidden ? t.textContent : null;
  });
  const banner = () => page.evaluate(() => [...document.querySelectorAll('.celebrate')].map((b) => `${b.className}: ${b.textContent}`));
  return { page, errors, shot, shots, tip, banner };
}

/** Where a table-local point is on screen. */
const screenOf = (page, x, y, z) =>
  page.evaluate(([x, y, z]) => {
    const t = window.casino.table.view;
    const stage = t.ctx?.stage ?? window.casino.table.stage;
    const V = window.casino.engine.camera.position.constructor;
    const p = stage.root.localToWorld(new V(x, y, z)).project(window.casino.engine.camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  }, [x, y, z]);

async function craps() {
  const s = await open('craps', null, 'd2_craps');
  const { page } = s;
  const out = { tips: [] };
  out.tips.push(await s.tip());
  await s.shot('1-comeout-tip');
  const act = (a) => page.evaluate((x) => window.casino.table.link.act(x), a);
  const view = () => page.evaluate(() => window.casino.table.view.v);
  await act({ type: 'bet', bets: [{ kind: 'pass', amount: 1000 }] });
  await page.waitForTimeout(600);
  out.tips.push(await s.tip());
  let v = await view();
  for (let i = 0; i < 10 && v.point === null; i++) {
    const n = v.rolls;
    await page.keyboard.press('Space');
    await page.waitForFunction((k) => { const t = window.casino.table.view; return t.v.rolls > k && !t.rolling; }, n, { timeout: 60_000 });
    await page.waitForTimeout(400);
    v = await view();
    if (v.point === null && !v.bets[0]?.pass) await act({ type: 'bet', bets: [{ kind: 'pass', amount: 1000 }] });
    await page.waitForTimeout(300);
  }
  out.point = v.point;
  out.tips.push(await s.tip());
  await s.shot('2-odds-nudge');
  // hover the 6 box: the card carries the exact house edge
  const felt = await page.evaluate(() => {
    const t = window.casino.table.view;
    const a = t.felt.anchorOf('R|box6');
    return { a, y: t.puck.mesh.position.y };
  });
  const at = await screenOf(page, felt.a[0], felt.y, felt.a[1]);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(500);
  out.hover = await page.evaluate(() => document.querySelector('.craps-tip')?.textContent ?? null);
  await s.shot('3-hover-edge');
  await page.mouse.move(640, 790);
  // full odds: the nudge gives way to the best bets
  if (v.point !== null) {
    await act({ type: 'odds', on: 'pass', amount: { 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3 }[v.point] * 1000 });
    await page.waitForTimeout(600);
    out.tips.push(await s.tip());
  }
  // a hard eight (big)
  await page.evaluate(() => {
    const t = window.casino.table.view;
    const seat = t.mySeat;
    const v = structuredClone(t.v);
    v.bets[seat] = { ...(v.bets[seat] ?? {}), hard8: { amount: 500 } };
    t.draw(v);
    const next = structuredClone(v);
    void t.onEvents([{ type: 'roll', shooter: seat, dice: [4, 4], total: 8, point: v.point === 8 ? 6 : v.point, auto: false }, { type: 'result', seat, id: 'hard8', flat: 'win', win: 4500, back: 0 }], next);
  });
  await page.waitForSelector('.celebrate', { timeout: 30_000 });
  await page.waitForTimeout(450);
  out.hard8 = await s.banner();
  await s.shot('4-hard-eight');
  await page.waitForFunction(() => !window.casino.table.view.rolling && !document.querySelector('.celebrate'), null, { timeout: 30_000 });
  // a point made with full odds behind the line (big)
  await page.evaluate(() => {
    const t = window.casino.table.view;
    const seat = t.mySeat;
    const v = structuredClone(t.v);
    v.point = 6;
    v.bets[seat] = { pass: { amount: 1000, odds: 5000 } };
    t.draw(v);
    const next = structuredClone(v);
    next.point = null;
    next.bets[seat] = {};
    void t.onEvents([{ type: 'roll', shooter: seat, dice: [2, 4], total: 6, point: 6, auto: false }, { type: 'result', seat, id: 'pass', flat: 'win', odds: 'win', win: 7000, back: 13000 }, { type: 'puck', point: null, made: true }], next);
  });
  await page.waitForSelector('.celebrate', { timeout: 30_000 });
  await page.waitForTimeout(450);
  out.pointMade = await s.banner();
  await s.shot('5-point-made');
  out.errors = s.errors.slice(0, 8);
  out.shots = s.shots;
  await page.close();
  return out;
}

async function roulette(variant) {
  const name = variant === 'european' ? 'd2_rl_eu' : 'd2_rl_us';
  const s = await open('roulette', variant, name);
  const { page } = s;
  const out = { tips: [await s.tip()] };
  await s.shot('1-tip');
  const act = (a) => page.evaluate((x) => window.casino.table.link.act(x), a);
  if (variant === 'american') {
    await act({ type: 'bet', bets: [{ kind: 'topline', numbers: [0, 1, 2, 3, 37], amount: 500 }] });
    await page.waitForTimeout(700);
    out.tips.push(await s.tip());
    await s.shot('2-topline-warning');
    await act({ type: 'clear' });
    await page.waitForTimeout(500);
  }
  // a straight-up 17 hit (big): the bet is real, the spin that pays it is fed to the view
  await act({ type: 'bet', bets: [{ kind: 'straight', numbers: [17], amount: 1000 }] });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const s = window.casino.table;
    const t = s.view;
    const seat = s.snapshot.you.seat;
    const cur = s.snapshot.view;
    const round = cur.round;
    const settled = { [seat]: { wagered: 1000, returned: 36000, bets: [['straight:17', 1000, 36000]] } };
    const next = { ...cur, phase: 'results', bets: {}, ready: [], spin: { round, pocket: 17, launchAt: 0, restAt: 6000 }, settled, history: [17, ...cur.history], canRebet: [seat] };
    void t.onEvents([{ type: 'spin', round, pocket: 17, launchAt: 0, restAt: 6000 }, { type: 'settle', round, pocket: 17, seats: settled }], next);
  });
  await page.waitForSelector('.celebrate', { timeout: 60_000 });
  await page.waitForTimeout(500);
  out.straight = await s.banner();
  await s.shot('3-straight-up');
  out.errors = s.errors.slice(0, 8);
  out.shots = s.shots;
  await page.close();
  return out;
}

// Stops that show the win the synthetic event describes: three single bars, three double bars,
// three triple bars; Neon Nights' middle row (line 1), and three scatters on the top row.
const WINS = {
  sevens: [{ stops: [2, 6, 2], combo: 'three1B', x: 20 }, { stops: [6, 2, 6], combo: 'three2B', x: 50 }],
  wild: [{ stops: [10, 6, 4], combo: 'three3B', x: 40 }],
  neon: [{ stops: [5, 22, 29, 1, 27], line: { line: 0, symbol: 'SEVEN', count: 5 }, x: 25 }],
};

async function slots(machine) {
  const s = await open('slots', machine, `d2_${machine}`);
  const { page } = s;
  const out = { tips: [await s.tip()], wins: [] };
  await s.shot('1-tip');
  let i = 0;
  for (const w of WINS[machine]) {
    await page.evaluate((w) => {
      const s = window.casino.table;
      const seat = s.snapshot.you.seat;
      const cur = s.snapshot.view;
      const video = cur.machine === 'neon';
      const denom = video ? 5 : cur.machine === 'wild' ? 100 : 25;
      const bet = video ? 20 * denom : denom;
      const credit = s.snapshot.you.stack - bet;
      const win = w.x * bet;
      const reels = {
        type: 'reels', stops: w.stops, spin: 0, freeLeft: 0, lines: w.line ? [{ ...w.line, win }] : [{ line: 0, symbol: '1B', count: 3, win }],
        hits: [true, true, true], combo: w.combo ?? null, wilds: 0, scatters: 0, scatterWin: 0, win, trigger: false, multiplier: 1,
      };
      const next = { machine: cur.machine, round: cur.round + 1, denom, coins: 1, stops: w.stops, last: { bet, win, freeSpins: 0 } };
      void s.view.onEvents([{ type: 'spin', seat, round: cur.round + 1, denom, coins: 1, bet, credit }, reels, { type: 'result', seat, bet, win, freeSpins: 0, freeWin: 0, credit: credit + win }], next);
    }, w);
    await page.waitForSelector('.celebrate', { timeout: 60_000 });
    await page.waitForTimeout(1200);
    out.wins.push({ banner: await s.banner(), meter: await page.evaluate(() => document.querySelector('.slots-countup')?.textContent) });
    await s.shot(`${2 + i}-win-${w.x}x`);
    await page.waitForFunction(() => document.querySelector('.slots-countup')?.hidden !== false, null, { timeout: 30_000 });
    await page.waitForTimeout(800);
    i++;
  }
  if (machine === 'neon') {
    // free games: three scatters on the paid spin, one free game of five diamonds (x3)
    await page.evaluate(() => {
      const s = window.casino.table;
      const seat = s.snapshot.you.seat;
      const cur = s.snapshot.view;
      const bet = 100;
      const credit = s.snapshot.you.stack - bet;
      const trig = { type: 'reels', stops: [11, 13, 11, 0, 0], spin: 0, freeLeft: 10, lines: [], hits: [], combo: null, wilds: 0, scatters: 3, scatterWin: 200, win: 200, trigger: true, multiplier: 1 };
      const free = { type: 'reels', stops: [16, 8, 4, 11, 3], spin: 1, freeLeft: 9, lines: [{ line: 0, symbol: 'DIAMOND', count: 5, win: 15000 }], hits: [], combo: null, wilds: 0, scatters: 0, scatterWin: 0, win: 15000, trigger: false, multiplier: 3 };
      const next = { machine: 'neon', round: cur.round + 1, denom: 5, coins: 1, stops: free.stops, last: { bet, win: 15200, freeSpins: 10 } };
      void s.view.onEvents([{ type: 'spin', seat, round: cur.round + 1, denom: 5, coins: 1, bet, credit }, trig, free, { type: 'result', seat, bet, win: 15200, freeSpins: 10, freeWin: 15000, credit: credit + 15200 }], next);
    });
    await page.waitForFunction(() => document.querySelector('.slots-banner.feature') && !document.querySelector('.slots-banner.feature').hidden, null, { timeout: 60_000 });
    await page.waitForTimeout(700);
    out.feature = await page.evaluate(() => document.querySelector('.slots-banner')?.textContent);
    await s.shot('4-free-games');
    await page.waitForSelector('.celebrate', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    out.freeWin = { banner: await s.banner(), meter: await page.evaluate(() => document.querySelector('.slots-countup')?.textContent) };
    await s.shot('5-free-games-huge');
  }
  out.errors = s.errors.slice(0, 8);
  out.shots = s.shots;
  await page.close();
  return out;
}

for (const r of runs) {
  log(r);
  try {
    if (r === 'craps') report.craps = await craps();
    else if (r === 'roulette') report.roulette = await roulette('american');
    else if (r === 'european') report.european = await roulette('european');
    else report[r] = await slots(r);
  } catch (e) {
    report[r] = { failed: String(e).slice(0, 400) };
  }
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
