#!/usr/bin/env node
// Headless check of Diamond Line, Lucky Cherries, Gold Rush and Straw, Sticks & Bricks in the dev harness: for each
// machine, insert money, spin a few times against the real server (the reels must land on the
// stops it sent), screenshot the machine at rest, mid-spin and after, open the Pays sheet, and
// then play one of the machine's showpiece spins through the view (a diamonds win, a Cherry Wheel
// spin, a Gold Rush feature, a Blowdown with a gold mansion and one that builds the Whole Street), settled by the same shared code with a seeded generator, to
// screenshot the presentation. Those replayed spins are client-side only; nothing is paid.
// Usage: node scripts/e2e/slots2.mjs [port] [outDir] [variants...]   (GPU=1: the Mac's GPU)

import { chromium } from 'playwright';
import { seededRng } from '../../shared/test/helpers/seeded.ts';
import { settleDiamonds } from '../../shared/src/games/slots/diamonds.ts';
import { settleCherries } from '../../shared/src/games/slots/cherries.ts';
import { settleGoldRush } from '../../shared/src/games/slots/goldrush.ts';
import { settlePigs } from '../../shared/src/games/slots/pigs.ts';

const [port = '5730', outDir = '/tmp', ...only] = process.argv.slice(2);
const variants = only.length ? only : ['diamonds', 'cherries', 'goldrush'];
const ROW_OFFSET = { diamonds: 0, cherries: 1, goldrush: 1.5, pigs: 1 };
const STOPS = { diamonds: 22, cherries: 30, goldrush: 32, pigs: 30 };

/** A seeded settlement that shows the machine off: two diamonds in a win, a wheel spin, free games. */
function showpiece(variant, unit, street = false) {
  for (let seed = 1; seed < (street ? 3_000_000 : 200_000); seed++) {
    const rng = seededRng(seed);
    if (variant === 'diamonds') {
      const s = settleDiamonds(rng, unit);
      if (s.reels[0].wilds === 2 && s.reels[0].combo === 'three3B') return s;
    } else if (variant === 'cherries') {
      const s = settleCherries(rng, unit);
      if (s.reels[0].wheel && s.reels[0].wheel.prize >= 15) return s;
    } else if (variant === 'pigs') {
      const s = settlePigs(rng, unit);
      const bd = s.reels[0].blowdown;
      if (street ? bd?.street > 0 : bd && bd.houses.some((h) => h[1] === 3) && bd.spins.some((x) => x.landed.length)) return s;
    } else {
      const s = settleGoldRush(rng, unit);
      if (s.freeSpins === 8 && s.reels.at(-1).held.length >= 3) return s;
    }
  }
  throw new Error(`no showpiece for ${variant}`);
}

const browser = process.env.GPU === '1'
  ? await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] })
  : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = [];

for (const variant of variants) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  let lastStops = null;
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        if (msg.t === 'ev') for (const e of msg.events) if (e.type === 'reels' && e.spin === 0) lastStops = e.stops;
      } catch {}
    }),
  );
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=slots&variant=${variant}&name=sl2_${variant}`);
  await page.waitForSelector('.modal input[type=number], .slots-deck', { timeout: 30000 });
  await page.waitForTimeout(2500);
  if (await page.$('.modal input[type=number]')) {
    await page.fill('.modal input[type=number]', '2000');
    await page.click('.modal .btn.primary');
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/slots2-${variant}-idle.png` });

  const shownStops = () =>
    page.evaluate(
      ({ rowOffset, stops }) => {
        let offs = null;
        window.casino.engine.scene.traverse((o) => {
          const u = o.material?.uniforms;
          if (o.isMesh && u?.uReels && u?.uOffset) offs = u.uOffset.value.slice(0, u.uReels.value);
        });
        return offs && offs.map((v) => (((Math.round(v - rowOffset) % stops) + stops) % stops));
      },
      { rowOffset: ROW_OFFSET[variant], stops: STOPS[variant] },
    );

  const results = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForFunction(() => !document.querySelector('.slots-deck .btn.primary')?.disabled, null, { timeout: 90000 });
    await page.keyboard.press('Space');
    if (i === 0) {
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${outDir}/slots2-${variant}-spinning.png` });
    }
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => !document.querySelector('.slots-deck .btn.primary')?.disabled, null, { timeout: 120000 });
    await page.waitForTimeout(500); // the result pill joins the page on the next frame
    const shown = await shownStops();
    results.push({ result: await page.evaluate(() => document.querySelector('.slots-result')?.textContent ?? '(no win)'), server: lastStops, shown, landed: JSON.stringify(shown) === JSON.stringify(lastStops) });
    if (i === 1) await page.screenshot({ path: `${outDir}/slots2-${variant}-after.png` });
  }
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('i');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/slots2-${variant}-pays.png` });
  await page.keyboard.press('i');

  // the showpiece, played through the view as if the server had sent it
  const coins = 2, denom = { diamonds: 100, cherries: 5, goldrush: 5, pigs: 5 }[variant];
  const lines = { diamonds: 1, cherries: 10, goldrush: 40, pigs: 20 }[variant];
  const bet = lines * coins * denom;
  const play = (s) => {
    const credit = 200_000 - bet;
    const events = [
      { type: 'spin', seat: 0, round: 99, denom, coins, bet, credit },
      ...s.reels,
      { type: 'result', seat: 0, bet, win: s.win, freeSpins: s.freeSpins, freeWin: s.freeWin, credit: credit + s.win },
    ];
    const view = { machine: variant, round: 99, denom, coins, stops: s.stops, last: { bet, win: s.win, freeSpins: s.freeSpins } };
    return page.evaluate(({ events, view }) => void window.casino.table.view.onEvents(events, view), { events, view });
  };
  const s = showpiece(variant, coins * denom);
  await play(s);
  // headless frames are slow and the view's tweens run on frame time, so wait for each moment
  const tagIs = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.slots-tag')?.textContent ?? ''), re, { timeout: 180000 });
  const shot = async (k) => page.screenshot({ path: `${outDir}/slots2-${variant}-show-${k}.png` });
  let wheelCheck = null;
  if (variant === 'cherries') {
    await page.waitForSelector('.slots-banner:not([hidden])', { timeout: 120000 });
    await shot(1);
    await tagIs('^Cherry Wheel$');
    await page.waitForTimeout(1500);
    await shot(2);
    await tagIs('x the bet');
    await page.waitForTimeout(300);
    await shot(3);
    wheelCheck = await page.evaluate((segment) => {
      let rot = null;
      window.casino.engine.scene.traverse((o) => {
        if (o.name === 'cherry-wheel') rot = o.rotation.z;
      });
      const seg = (Math.PI * 2) / 20;
      const at = ((Math.round(rot / seg) % 20) + 20) % 20;
      return { segment, at, landed: at === segment };
    }, s.reels[0].wheel.segment);
  } else if (variant === 'goldrush') {
    await page.waitForSelector('.slots-banner:not([hidden])', { timeout: 120000 });
    await shot(1);
    await tagIs('Free game 3 of');
    await shot(2);
    await tagIs('Free game 8 of');
    await page.waitForTimeout(2500);
    await shot(3);
    await tagIs('Free games won');
    await page.waitForTimeout(600);
  } else if (variant === 'pigs') {
    await page.waitForSelector('.slots-banner:not([hidden])', { timeout: 120000 });
    await shot(1);
    await tagIs('^Blowdown · 3 spins left');
    await page.waitForTimeout(700);
    await shot(2);
    await tagIs('built|rebuilt');
    await page.waitForTimeout(400);
    await shot(3);
    await tagIs('The wolf comes');
    await page.waitForTimeout(1600);
    await shot(4);
    await tagIs('The wolf blew down');
    await shot(5);
    await tagIs('^Blowdown won');
  }
  await page.waitForSelector('.celebrate', { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(900);
  await shot(9);
  await page.waitForFunction(() => !document.querySelector('.slots-countup:not([hidden])'), null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot(10);
  if (variant === 'pigs') {
    // the Whole Street: every plot built, a thousand bets on top
    await page.waitForFunction(() => !document.querySelector('.slots-deck .btn.primary')?.disabled, null, { timeout: 180000 });
    const st = showpiece(variant, coins * denom, true);
    await play(st);
    const tagIs2 = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.slots-tag')?.textContent ?? ''), re, { timeout: 240000 });
    await tagIs2('The wolf comes');
    await page.waitForTimeout(1200);
    await shot(11);
    await tagIs2('^The Whole Street ·');
    await page.waitForTimeout(600);
    await shot(12);
    await page.waitForSelector('.celebrate', { timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(900);
    await shot(13);
    await page.waitForFunction(() => !document.querySelector('.slots-deck .btn.primary')?.disabled, null, { timeout: 240000 }).catch(() => {});
  }
  const hud = await page.textContent('.dev-hud').catch(() => '');
  report.push({ variant, hud, results, showpiece: { win: s.win, freeSpins: s.freeSpins, wheel: s.reels[0].wheel ?? null, wheelCheck }, errors: errors.slice(0, 8) });
  await page.close();
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
// Fail the run on page errors, reels that stopped off the server's stops, or a wheel off its segment.
process.exit(report.some((r) => r.errors.length || r.results.some((x) => !x.landed) || r.showpiece.wheelCheck?.landed === false) ? 1 : 0);
