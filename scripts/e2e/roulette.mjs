#!/usr/bin/env node
// Headless check of the roulette table in the dev harness: buy in, put chips on a straight, a
// split, a corner, a street, a six line, the top line (or first four) and a few outside bets by
// clicking where they sit on the felt, spin, and take screenshots while the ball is on the track,
// while it bounces in the rotor, at the call, with the winners paid, and once the table settles.
// Waits follow the table's own spin clock, so a slow software renderer only makes it take longer.
//
// Usage: node scripts/e2e/roulette.mjs [port] [outDir] [variant] [--quick] [--low]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const quick = process.argv.includes('--quick');
const low = process.argv.includes('--low');
const [port = '5450', outDir = '/tmp/roulette-shots', variant = 'american'] = args;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
if (low) await page.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name) => {
  const path = `${outDir}/${variant}-${name}.png`;
  await page.screenshot({ path });
  console.log('shot', path);
};
const state = () => page.evaluate(() => window.casino.table.view.debug.state());
/** Wait until the view's spin clock passes t seconds (or the predicate on the state holds). */
const until = (fnSrc, timeout = 120000) => page.waitForFunction(fnSrc, null, { timeout, polling: 50 });

await page.goto(`http://localhost:${port}/casino/?dev=table&game=roulette&variant=${variant}&name=rl_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
await page.fill('.modal input[type=number]', '2000');
await page.click('.modal .btn.primary');
await until(() => window.casino?.table?.view?.debug?.state().stack > 0, 20000);
await page.waitForTimeout(800);
const frame = await page.evaluate(() => ({ ms: window.casino.engine.frameMs(), calls: window.casino.engine.renderer.info.render.calls, tris: window.casino.engine.renderer.info.render.triangles }));
console.log('frame', JSON.stringify(frame));
await shot('0-empty');
if (quick) {
  console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 1));
  await browser.close();
  process.exit(0);
}

const at = (key) => page.evaluate((k) => window.casino.table.view.debug.screenOf(k), key);
const click = async (key, chipKey) => {
  if (chipKey) await page.keyboard.press(chipKey);
  const p = await at(key);
  if (!p) throw new Error(`no screen position for ${key}`);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
};

const zeroCombo = variant === 'american' ? 'topline:0-1-2-3-37' : 'firstfour:0-1-2-3';
const bets = [
  ['straight:17', '2'],
  ['straight:17', '2'],
  ['split:17-20', '1'],
  ['corner:25-26-28-29', '2'],
  ['street:13-14-15', '1'],
  ['sixline:31-32-33-34-35-36', '2'],
  [zeroCombo, '1'],
  ['split:0-2', '1'],
  ['red', '3'],
  ['dozen2', '2'],
  ['column3', '2'],
  ['odd', '2'],
];
for (const [key, chip] of bets) await click(key, chip);
await until(() => Object.keys(window.casino.table.view.debug.state().bets).length >= 11, 15000);
// hover a split to show the tooltip and the numbers it covers
const sp = await at('split:17-18');
await page.mouse.move(sp.x, sp.y);
await page.waitForTimeout(400);
await shot('1-bets');
const before = await state();
console.log('bets', JSON.stringify(before.bets));

await page.mouse.move(700, 870);
await page.keyboard.press('Space');
await until(() => window.casino.table.view.debug.state().flight !== null, 15000);
const f = (await state()).flight;
console.log('flight', JSON.stringify(f));
await until(`window.casino.table.view.debug.state().s >= ${f.tDrop - 1.2}`);
await shot('2-track');
await until(`window.casino.table.view.debug.state().s >= ${f.tEnter + 0.45}`);
await shot('3-bounce');
await until(`window.casino.table.view.debug.state().s >= ${f.tRest + 0.6}`);
await shot('4-rest');
await until(() => !!document.querySelector('.pill') || !window.casino.table.view.debug.state().animating, 60000);
await page.waitForTimeout(400);
await shot('5-paid');
await until(() => !window.casino.table.view.debug.state().animating, 90000);
await page.waitForTimeout(500);
await shot('6-settled');
const after = await state();
console.log(JSON.stringify({ history: after.history, stack: after.stack, phase: after.phase, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
