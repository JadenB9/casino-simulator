#!/usr/bin/env node
// Headless check of the baccarat table in the dev harness: log in, buy in, bet the Banker with
// the keyboard (3 picks the $25 chip, B bets it, Space deals), play a few coups at full speed of
// animation with a screenshot mid-deal, then run a batch of quick coups to fill the scoreboard
// and screenshot the table with its roads.
// Usage: node scripts/e2e/baccarat.mjs [port] [out-dir] [quick-coups]

import { chromium } from 'playwright';

const [port = '5470', outDir = '/tmp', quick = '24'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${port}/casino/?dev=table&game=baccarat&name=bacc_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
await page.fill('.modal input[type=number]', '2000');
await page.click('.modal .btn.primary');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/baccarat-empty.png` });

const dealer = () => page.textContent('.dealer-line').catch(() => '');
const calls = [];

// A few coups played at the pace a player sees them.
await page.keyboard.press('3');
for (let coup = 0; coup < 3; coup++) {
  await page.keyboard.press('b');
  await page.waitForTimeout(350);
  await page.keyboard.press('Space');
  if (coup === 1) {
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `${outDir}/baccarat-deal.png` });
    calls.push(await dealer());
    await page.waitForTimeout(6000);
  } else {
    await page.waitForTimeout(coup === 0 ? 12000 : 8500);
  }
  calls.push(await dealer());
}
await page.screenshot({ path: `${outDir}/baccarat-settled.png` });

// Quick coups: a bet and a deal back to back; the table snaps animations when events pile up.
for (let i = 0; i < Number(quick); i++) {
  await page.evaluate(() => {
    const link = window.casino.table.link;
    link.act({ type: 'bet', banker: 2500, ...(Math.random() < 0.3 ? { tie: 500 } : {}), ...(Math.random() < 0.3 ? { playerPair: 500 } : {}) });
    link.act({ type: 'deal' });
  });
  await page.waitForTimeout(450);
}
// Let the table catch up, then one more coup at normal pace, screenshot once it's settled.
const coupsShown = () => page.evaluate(() => document.querySelector('.bc-board-shoe')?.textContent ?? '');
for (let i = 0; i < 90; i++) {
  const line = await coupsShown();
  await page.waitForTimeout(1000);
  if ((await coupsShown()) === line && i > 4) break;
}
await page.keyboard.press('b');
await page.waitForTimeout(400);
await page.keyboard.press('Space');
await page.waitForTimeout(14000);
calls.push(await dealer());
await page.screenshot({ path: `${outDir}/baccarat-roads.png` });
const board = await page.textContent('.bc-board').catch(() => '');
const strip = await page.textContent('.bc-meters').catch(() => '');
const hud = await page.textContent('.dev-hud').catch(() => '');
console.log(JSON.stringify({ outDir, hud, board, strip, calls, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
