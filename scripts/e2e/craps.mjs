#!/usr/bin/env node
// Headless check of the craps table in the dev harness: buy in, bet the pass line, roll until a
// point is set, take odds, put down come, place and field bets, roll a few more times, and take
// screenshots along the way. Usage: node scripts/e2e/craps.mjs [port] [out-dir]

import { chromium } from 'playwright';

const [port = '5460', outDir = '/tmp'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/casino/?dev=table&game=craps&name=craps_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
await page.fill('.modal input[type=number]', '5000');
await page.click('.modal .btn.primary');
await page.waitForTimeout(1500);

const act = (a) => page.evaluate((x) => window.casino.table.link.act(x), a);
const view = () => page.evaluate(() => window.casino.table.snapshot && window.casino.table.view && window.casino.table.view.v);
const shot = async (name) => {
  const path = `${outDir}/craps-${name}.png`;
  await page.screenshot({ path });
  return path;
};
const shots = [await shot('1-layout')];

await act({ type: 'bet', bets: [{ kind: 'pass', amount: 2500 }] });
await page.waitForTimeout(500);
shots.push(await shot('2-pass-bet'));

const log = [];
async function roll() {
  await page.keyboard.press('Space');
  await page.waitForTimeout(5200);
  const v = await view();
  const last = v.history.at(-1);
  log.push({ dice: last, point: v.point });
  return v;
}

// come-out rolls until a point is set
let v = await view();
for (let i = 0; i < 8 && v.point === null; i++) {
  v = await roll();
  if (v.point === null && !v.bets[0]?.pass) await act({ type: 'bet', bets: [{ kind: 'pass', amount: 2500 }] });
}
shots.push(await shot('4-point-set'));

if (v.point !== null) {
  const max = { 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3 }[v.point] * 2500;
  await act({ type: 'odds', on: 'pass', amount: max });
  await act({ type: 'bet', bets: [{ kind: 'come', amount: 1000 }, { kind: 'field', amount: 1000 }, { kind: 'place', number: 6, amount: 1200 }, { kind: 'place', number: 8, amount: 1200 }, { kind: 'hard', number: 8, amount: 500 }, { kind: 'any7', amount: 100 }] });
  await page.waitForTimeout(600);
  shots.push(await shot('5-bets-down'));
  // throw and catch the dice mid-flight once
  await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  shots.push(await shot('6-dice-flying'));
  await page.waitForTimeout(4300);
  shots.push(await shot('7-after-roll'));
  for (let i = 0; i < 3; i++) {
    v = await roll();
    if (v.point === null && !v.bets[0]?.pass) break;
  }
  shots.push(await shot('8-later'));
}

const hud = await page.textContent('.craps-hud').catch(() => '');
const dealer = await page.textContent('.dealer-line').catch(() => '');
console.log(JSON.stringify({ shots, rolls: log, hud, dealer, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
