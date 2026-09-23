#!/usr/bin/env node
// Headless check of Texas Hold'em in the dev harness: buy in against the five bots, play a few
// hands with the keyboard (C to check or call), move all-in once (A twice), and screenshot the
// deal, a decision, the all-in run-out and the showdown.
// Usage: node scripts/e2e/holdem.mjs [port] [out dir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5510', outDir = '/tmp/holdem-e2e'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const shots = [];
const shot = async (name) => {
  const path = `${outDir}/holdem-${name}.png`;
  await page.screenshot({ path });
  shots.push(path);
};
const handNo = async () => Number(((await page.textContent('.he-history-head span').catch(() => '')) ?? '').replace(/\D+/g, '') || 0);
const myTurn = () => page.locator('.he-bar.he-live').isVisible().catch(() => false);
const dealer = () => page.textContent('.dealer-line').catch(() => '');

await page.goto(`http://localhost:${port}/casino/?dev=table&game=holdem&name=holdem_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
await page.fill('.modal input[type=number]', '1000');
await page.click('.modal .btn.primary');

// the first hand: wait for the cards to come out
await page.waitForFunction(() => /Hand #\d/.test(document.querySelector('.he-history-head span')?.textContent ?? ''), null, { timeout: 30000 });
await page.waitForTimeout(1500);
await shot('1-deal');

const calls = [];
let allInHand = 0;
let decided = 0;
let sawAllIn = false;
let sawShowdown = false;
const t0 = Date.now();
while (Date.now() - t0 < 150_000) {
  const hand = await handNo();
  if (await myTurn()) {
    decided++;
    if (decided === 1) await shot('2-decision');
    if (!allInHand && hand >= 2) {
      allInHand = hand;
      await page.keyboard.press('a');
      await page.waitForTimeout(250);
      await page.keyboard.press('a');
    } else await page.keyboard.press('c');
    await page.waitForTimeout(600);
    continue;
  }
  const line = (await dealer()) ?? '';
  if (line && calls.at(-1) !== line) calls.push(line);
  if (allInHand && hand === allInHand && !sawAllIn && /shows/.test(line)) {
    sawAllIn = true;
    await page.waitForTimeout(700);
    await shot('3-allin');
  }
  if (/wins|Split|to /.test(line) && allInHand && hand === allInHand && !sawShowdown) {
    sawShowdown = true;
    await page.waitForTimeout(300);
    await shot('4-showdown');
  }
  if (allInHand && hand >= allInHand + 2) break;
  // busted on the all-in: buy back in
  if (await page.locator('.modal input[type=number]').isVisible().catch(() => false)) {
    await page.fill('.modal input[type=number]', '1000');
    await page.click('.modal .btn.primary');
  }
  await page.waitForTimeout(250);
}
await page.keyboard.press('h');
await page.waitForTimeout(400);
await shot('5-history');
const hud = await page.textContent('.dev-hud').catch(() => '');
console.log(JSON.stringify({ shots, hud, hands: await handNo(), decided, allInHand, sawAllIn, sawShowdown, calls: calls.slice(-14), errors: errors.slice(0, 10) }, null, 1));
await browser.close();
