#!/usr/bin/env node
// Turned away at the door: the floor refuses the first connection the way a full casino does
// (close 4005), and the page says so with a Try again button instead of leaving the player walking
// about unseen. Try again connects for real, and the player is back on the floor with the others.
// Usage: node scripts/e2e/full.mjs [port] [out.png]   (PORT_BASE=<port> npm run dev first)

import { chromium } from 'playwright';

const [port = '5173', out = '/tmp/casino-full.png'] = process.argv.slice(2);
const base = process.env.BASE ?? `http://localhost:${port}`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(90_000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// The first floor socket is turned away; every later one goes through to the worker.
let floorTries = 0;
await page.routeWebSocket(/\/casino\/ws\/floor/, (ws) => {
  if (++floorTries === 1) {
    ws.close({ code: 4005, reason: 'the casino is full' });
    return;
  }
  ws.connectToServer();
});

await page.goto(`${base}/casino/`);
await page.waitForSelector('.name-input, .menu-item');
if (await page.locator('.name-input').isVisible()) await page.fill('.name-input', 'e2e_full');
if (await page.locator('.pass-input').isVisible()) await page.fill('.pass-input', 'casino-dev');
await page.click('.continue-btn:visible, .enter-btn:visible');
// (a new name's floor connects while it picks a look, so the refusal can come over the editor)
const dialog = page.locator('.modal h2', { hasText: 'The casino is full' });
const atMenu = page.locator('.menu-item').first();
await Promise.race([dialog.waitFor({ timeout: 30_000 }), atMenu.waitFor({ timeout: 30_000 })]).catch(() => {});
if (!(await dialog.isVisible()) && (await atMenu.isVisible())) {
  await atMenu.click();
  await dialog.waitFor({ timeout: 30_000 }).catch(() => {});
}
check(await dialog.isVisible(), 'a refused floor connection says the casino is full');
await page.screenshot({ path: out });
await page.click('.modal .btn.primary:has-text("Try again")');
await page.waitForFunction(() => window.casino?.app?.link?.you != null, null, { timeout: 30_000 }).catch(() => {});
check(floorTries === 2, `Try again opened one new floor socket (${floorTries} in all)`);
check(await page.evaluate(() => window.casino?.app?.link?.you != null), 'and the floor said hello');
check(!(await dialog.isVisible()), 'the dialog is gone');
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);

await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall ok');
process.exit(failures.length ? 1 : 0);
