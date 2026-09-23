#!/usr/bin/env node
// Headless check of the video poker machine in the dev harness: buy in, bet max and deal, hold
// cards, draw, play a few hands, and screenshot each step. Also clicks a deck button (the 3D
// BET ONE) and a card on the DOM screen, and checks the screen stays lined up with the cabinet.
// Usage: node scripts/e2e/videopoker.mjs [port] [outdir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5490', outdir = '/tmp/vp-e2e'] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/casino/?dev=table&game=videopoker&name=vp_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
await page.fill('.modal input[type=number]', '1000');
await page.click('.modal .btn.primary');
await page.waitForTimeout(1500);

const shot = async (name) => {
  const path = `${outdir}/${name}.png`;
  await page.screenshot({ path });
  return path;
};
const screenState = () =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = q('.vp-screen')?.getBoundingClientRect();
    return {
      status: q('.vp-status')?.textContent,
      meters: [...document.querySelectorAll('.vp-meter')].map((m) => m.textContent),
      bet: q('.vp-cell.on') ? [...document.querySelectorAll('.vp-row:first-child .vp-cell')].findIndex((c) => c.classList.contains('on')) + 1 : 0,
      cards: [...document.querySelectorAll('.vp-card')].map((i) => i.getAttribute('src').split('/').pop().replace('.svg', '')),
      held: [...document.querySelectorAll('.vp-held')].map((h) => h.classList.contains('on')),
      rows: [...document.querySelectorAll('.vp-row')].map((r) => r.className).filter((c) => c !== 'vp-row'),
      rect: rect && { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      transform: q('.vp-screen')?.style.transform.slice(0, 60),
    };
  });

const out = { shots: [], states: [] };
out.shots.push(await shot('0-idle'));
out.states.push(['idle', await screenState()]);

// Coin value to $5 and back to $1 by key; BET ONE on the 3D deck by clicking it (screen-space from the camera).
await page.keyboard.press('d');
await page.waitForTimeout(150);
out.states.push(['denom $5', await screenState()]);
await page.keyboard.press('d');
await page.keyboard.press('d');
await page.waitForTimeout(150);
const betOne = await page.evaluate(() => {
  const { engine, table } = window.casino;
  const obj = table.stage.anchor.getObjectByName('vp-btn-betone');
  const v = obj.getWorldPosition(obj.position.clone());
  v.y += 0.012;
  v.project(engine.camera);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
});
await page.mouse.click(betOne.x, betOne.y);
await page.waitForTimeout(200);
out.states.push(['after clicking BET ONE on the deck', await screenState()]);
out.shots.push(await shot('1-bet-one'));

for (let hand = 1; hand <= 4; hand++) {
  // Bet max deals.
  await page.keyboard.press('b');
  await page.waitForTimeout(1400);
  out.states.push([`hand ${hand} dealt`, await screenState()]);
  if (hand === 1) out.shots.push(await shot('2-dealt'));
  // Hold cards 1 and 3 (the first by clicking it on the screen, the other by key).
  await page.click('.vp-slot >> nth=0');
  await page.keyboard.press('3');
  await page.waitForTimeout(250);
  if (hand === 1) {
    out.states.push([`hand ${hand} held`, await screenState()]);
    out.shots.push(await shot('3-held'));
  }
  await page.keyboard.press('Space');
  await page.waitForTimeout(hand === 1 ? 900 : 2600);
  out.states.push([`hand ${hand} drawn`, await screenState()]);
  if (hand === 1) out.shots.push(await shot('4-drawing'));
  await page.waitForTimeout(hand === 1 ? 2200 : 400);
  out.shots.push(await shot(`5-result-${hand}`));
}

// Help screen.
await page.keyboard.press('h');
await page.waitForTimeout(200);
out.shots.push(await shot('6-help'));
await page.keyboard.press('h');

// The server can't be asked for a royal, so replay one through the view (display only; the
// next snapshot resyncs) to check the center moment and the long rollup, then a dealt made hand.
await page.evaluate(() => {
  const royal = ['Ts', 'Js', 'Qs', 'Ks', 'As'];
  const view = { phase: 'over', round: 99, coins: 5, denom: 100, hand: royal, held: [false, false, false, false, false], dealt: null, result: { rank: 9, name: 'Royal Flush', credits: 4000, payout: 400000 } };
  void window.casino.table.view.onEvents(
    [
      { type: 'draw', hold: [true, true, false, false, true], cards: royal },
      { type: 'result', seat: 0, rank: 9, name: 'Royal Flush', coins: 5, denom: 100, credits: 4000, payout: 400000 },
    ],
    view,
  );
});
await page.waitForTimeout(2600);
out.shots.push(await shot('7-royal-moment'));
out.states.push(['royal replay', await screenState()]);
await page.waitForTimeout(9000);
await page.evaluate(() => {
  const cards = ['Jh', '4c', 'Js', '8d', '2s'];
  const view = { phase: 'dealt', round: 100, coins: 5, denom: 100, hand: cards, held: [false, false, false, false, false], dealt: 1, result: null };
  void window.casino.table.view.onEvents([{ type: 'deal', round: 100, coins: 5, denom: 100, bet: 500, cards, made: 1 }], view);
});
await page.waitForTimeout(2500);
out.shots.push(await shot('8-made-hand'));
out.states.push(['made hand replay', await screenState()]);

out.hud = await page.textContent('.dev-hud').catch(() => '');
out.errors = errors.slice(0, 10);
console.log(JSON.stringify(out, null, 1));
await browser.close();
