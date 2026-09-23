#!/usr/bin/env node
// Headless check of one game in the dev harness: log in, buy in, place a bet, play a round,
// screenshot. Usage: node scripts/e2e/smoke.mjs <game> [port] [out.png]
// Games override the "play a round" step through window.casino when they need to.

import { chromium } from 'playwright';

const [game = 'highcard', port = '5173', out = `/tmp/smoke-${game}.png`] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/casino/?dev=table&game=${game}&name=smoke_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 20000 });
await page.fill('.modal input[type=number]', '1000');
await page.click('.modal .btn.primary');
await page.waitForTimeout(800);
if (game === 'highcard') {
  await page.evaluate(() => window.casino.table.link.act({ type: 'bet', amount: 2500 }));
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await page.waitForTimeout(1300);
}
await page.screenshot({ path: out });
const hud = await page.textContent('.dev-hud').catch(() => '');
console.log(JSON.stringify({ out, hud, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
