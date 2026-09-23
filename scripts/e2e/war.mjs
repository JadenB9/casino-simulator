#!/usr/bin/env node
// Headless Casino War in the dev harness, with Tips on: buy in, click chips onto the BET and TIE
// spots, deal, and keep dealing (Rebet, Space) until a tie comes up; go to war on the first tie
// and surrender the second, screenshotting each stage and checking the chips add up.
// Usage: node scripts/e2e/war.mjs [port] [outdir]   (PORT_BASE=<port - 0> npm run dev first)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5740', outDir = '/tmp/casino-war'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const name = process.env.NAME ?? 'wr_e2e';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => localStorage.setItem('casino.tips', '1'));
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${process.env.BASE ?? `http://localhost:${port}`}/casino/?dev=table&game=war&name=${name}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 60_000 });
await page.fill('.modal input[type=number]', '2000');
await page.click('.modal .btn.primary');
// seated once the chips have landed
await page.waitForFunction(() => /Chips\$2,000/.test(document.querySelector('.wr-meters')?.textContent ?? ''), null, { timeout: 30_000 });
await page.waitForTimeout(500);

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
const shots = [];
const shot = async (label) => {
  const path = `${outDir}/war-${label}.png`;
  await page.screenshot({ path });
  shots.push(path);
};
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
const chips = async () => Number((await text('.wr-meters')).match(/Chips\$([\d,.]+)/)?.[1]?.replace(/,/g, '') ?? NaN);
const waitMeters = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.wr-meters')?.textContent ?? ''), re.source, { timeout: 30_000 });
const decideUp = () => page.evaluate(() => !!document.querySelector('.wr-decide:not([hidden])'));
const log = [];

try {
  // Round 1: $25 on the BET (the tray starts on the $25 chip) and $5 on the TIE, clicked onto the felt.
  const bet = await spotOnScreen(0.866);
  const tie = await spotOnScreen(0.75);
  await page.mouse.click(bet.x, bet.y);
  await page.keyboard.press('2'); // $5 chip
  await page.mouse.click(tie.x, tie.y);
  await waitMeters(/Bet\$30/);
  await page.mouse.move(40, 400);
  const tipLine = await text('.tip-line');
  if (!/tie bet has a high edge/i.test(tipLine)) throw new Error(`no Tie bet tip while betting: "${tipLine}"`);
  await shot('1-bets');

  let wars = 0;
  let surrenders = 0;
  let rounds = 0;
  let before = await chips();
  let dealt = false;
  while ((wars === 0 || surrenders === 0) && rounds < 90) {
    if (rounds > 0) {
      await page.keyboard.press('r'); // rebet $25 + $5
      await waitMeters(/Bet\$30/);
    }
    before = await chips();
    await page.keyboard.press('Space');
    rounds++;
    // either the round settles (Bet back to $0) or a tie asks for a decision
    await page.waitForFunction(
      () => !!document.querySelector('.wr-decide:not([hidden])') || /Bet\$0/.test(document.querySelector('.wr-meters')?.textContent ?? ''),
      null,
      { timeout: 30_000 },
    );
    if (!dealt) {
      dealt = true;
      await page.waitForTimeout(700);
      await shot('2-first-deal');
    }
    if (!(await decideUp())) {
      await page.waitForTimeout(400);
      continue;
    }
    await page.waitForTimeout(500);
    const tip = await text('.tip-line');
    const picked = await page.evaluate(() => document.querySelector('.wr-decide .tip-pick')?.textContent ?? '');
    if (!/always go to war/i.test(tip) || !/war/i.test(picked)) throw new Error(`no war tip on a tie: "${tip}" / "${picked}"`);
    const choice = wars === 0 ? 'war' : 'surrender';
    await shot(`3-tie-${choice}`);
    await page.keyboard.press(choice === 'war' ? 'w' : 's');
    await waitMeters(/Bet\$0/);
    await page.waitForTimeout(choice === 'war' ? 300 : 900);
    await shot(`4-${choice}-result`);
    const after = await chips();
    const line = await text('.dealer-line');
    log.push({ round: rounds, choice, before, after, line });
    if (choice === 'war') wars++;
    else surrenders++;
    await page.waitForTimeout(1600);
  }
  await page.waitForTimeout(600);
  await shot('5-settled');
  // Every round's bet is $25 + $5, so the stack must have moved in steps a round could produce.
  log.push({ rounds, wars, surrenders, final: await chips() });
  if (wars === 0 || surrenders === 0) throw new Error(`no tie in ${rounds} rounds`);
  await page.keyboard.press('i');
  await page.waitForTimeout(300);
  await shot('6-rules');
} catch (err) {
  await shot('failed');
  const state = await page.evaluate(() => ({
    meters: document.querySelector('.wr-meters')?.textContent,
    toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
    line: document.querySelector('.dealer-line')?.textContent,
    tip: document.querySelector('.tip-line')?.textContent,
  }));
  console.log(JSON.stringify({ failed: String(err).split('\n')[0], state, shots, log, errors }, null, 1));
  await browser.close();
  process.exit(1);
}
const hud = await page.textContent('.dev-hud').catch(() => '');
console.log(JSON.stringify({ shots, log, hud, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
if (errors.length) process.exit(1);
