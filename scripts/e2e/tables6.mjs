#!/usr/bin/env node
// Let It Ride and Pai Gow Poker, headless, on the real stack (PORT_BASE=<port> npm run dev):
// several hands of each alone in the dev harness (clicking chips onto the felt, following the
// tips, one hand pulled back and one let ride, several hands at once, Max), with a screenshot at
// every stage. Usage: node scripts/e2e/tables6.mjs [port] [outDir] [lr|pg ...]
// GPU=1 uses the machine's GPU (quicker, closer to the real thing).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6310', outDir = '/tmp/casino-tables6', ...only] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const which = only.length ? only : ['lr', 'pg'];
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

try {
  if (which.includes('lr')) await letItRide();
  if (which.includes('pg')) await paiGow();
} catch (err) {
  console.log(JSON.stringify({ failed: String(err).split('\n')[0], shots, errors: errors.slice(0, 10) }, null, 1));
  await browser.close();
  process.exit(1);
}
console.log(JSON.stringify({ shots, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
