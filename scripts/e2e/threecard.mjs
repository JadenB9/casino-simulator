#!/usr/bin/env node
// Headless Three Card Poker in the dev harness: buy in, click chips onto the Ante and Pair Plus
// spots, deal, play one hand, fold the next, bet Pair Plus alone on a third, and screenshot each
// stage. Usage: node scripts/e2e/threecard.mjs [port] [outdir]

import { chromium } from 'playwright';

const [port = '5500', outDir = '/tmp'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/casino/?dev=table&game=threecard&name=tc_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
await page.fill('.modal input[type=number]', '2000');
await page.click('.modal .btn.primary');
// seated once the chips have landed
await page.waitForFunction(() => /Chips\$2,000/.test(document.querySelector('.tc-meters')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(400);

// Screen position of one of seat 0's spots (layout.ts: seat 0 sits at 10 degrees).
const spotOnScreen = (r) =>
  page.evaluate((r) => {
    const { table, engine } = window.casino;
    const a = (10 * Math.PI) / 180;
    const V = engine.camera.position.constructor;
    const p = table.stage.root.localToWorld(new V(Math.sin(a) * r, 0.76, -0.64 + Math.cos(a) * r));
    p.project(engine.camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  }, r);
const shot = async (name) => {
  const path = `${outDir}/threecard-${name}.png`;
  await page.screenshot({ path });
  return path;
};
const shots = [];

const meters = () => page.textContent('.tc-meters').catch(() => '');
const waitMeters = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.tc-meters')?.textContent ?? ''), re.source, { timeout: 30000 });
const waitLine = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.dealer-line')?.textContent ?? ''), re.source, { timeout: 30000 });
const waitDecide = () => page.waitForSelector('.tc-decide:not([hidden])', { timeout: 30000 });
const log = [];

try {
// Hand 1: $25 Ante (the tray starts on the $25 chip) and $5 Pair Plus, clicked onto the felt; Play.
const ante = await spotOnScreen(0.862);
const pp = await spotOnScreen(0.745);
await page.mouse.click(ante.x, ante.y);
await page.keyboard.press('2'); // $5 chip
await page.mouse.click(pp.x, pp.y);
await waitMeters(/Bet\$30/);
await page.mouse.move(40, 400);
shots.push(await shot('1-bets'));
await page.keyboard.press('Space');
await waitDecide();
await page.waitForTimeout(600);
shots.push(await shot('2-decide'));
await page.keyboard.press('p');
await waitLine(/qualif|Dealer has/);
await page.waitForTimeout(500);
shots.push(await shot('3-reveal'));
await page.waitForSelector('.pill', { timeout: 30000 });
await page.waitForTimeout(450);
shots.push(await shot('4-result'));
await waitMeters(/Bet\$0/);
await page.waitForTimeout(300);
shots.push(await shot('5-settled'));
log.push(await meters());

// Hand 2: Rebet, then fold.
await page.keyboard.press('r');
await waitMeters(/Bet\$30/);
await page.keyboard.press('Space');
await waitDecide();
await page.keyboard.press('f');
await waitLine(/Folded/);
await waitMeters(/Bet\$0/);
await page.waitForTimeout(600);
shots.push(await shot('6-fold'));
log.push(await meters());

// Hand 3: Pair Plus alone, two $5 chips.
await page.mouse.click(pp.x, pp.y);
await page.mouse.click(pp.x, pp.y);
await waitMeters(/Bet\$10/);
const before = await meters();
await page.keyboard.press('Space');
await page.waitForFunction((b) => document.querySelector('.tc-meters')?.textContent !== b && !/Bet\$10/.test(document.querySelector('.tc-meters')?.textContent ?? ''), before, { timeout: 30000 });
await page.waitForTimeout(400);
shots.push(await shot('7-pairplus'));
log.push(await meters());

} catch (err) {
  shots.push(await shot('failed'));
  const state = await page.evaluate(() => ({
    meters: document.querySelector('.tc-meters')?.textContent,
    toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
    line: document.querySelector('.dealer-line')?.textContent,
  }));
  console.log(JSON.stringify({ failed: String(err).split('\n')[0], state, shots, errors }, null, 1));
  await browser.close();
  process.exit(1);
}
const dealerLine = await page.textContent('.dealer-line').catch(() => '');
const hud = await page.textContent('.dev-hud').catch(() => '');
console.log(JSON.stringify({ shots, log, dealerLine, hud, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
