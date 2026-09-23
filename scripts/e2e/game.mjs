#!/usr/bin/env node
// Headless walk through the game proper: log in, the menu, the floor, walk, sit at a table solo,
// buy in, stand up, the cashier. Usage: node scripts/e2e/game.mjs [port] [outdir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', out = '/tmp/casino-game'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const name = process.env.NAME ?? 'walker_e2e';
await page.goto(`http://localhost:${port}/casino/`);
await page.waitForSelector('.name-input', { timeout: 60000 });
await page.waitForTimeout(1500);
await shot('01-login');
await page.fill('.name-input', name);
await page.click('.enter-btn');
await page.waitForSelector('.menu-item', { timeout: 20000 });
await page.waitForTimeout(1500);
await shot('02-menu');
log('menu up for', name);

await page.click('.menu-item >> nth=0');
await page.waitForSelector('.hud', { timeout: 20000 });
await page.waitForTimeout(1500);
await shot('03-floor');
await page.keyboard.down('KeyW');
await page.waitForTimeout(1800);
await page.keyboard.up('KeyW');
await page.waitForTimeout(600);
await shot('04-walk');
const walk = await page.evaluate(() => ({ ms: window.casino.engine.frameMs(), pos: window.casino.world.player.state(), stats: window.casino.world.stats() }));
log('walked', JSON.stringify(walk));

// Sit at a table through the same path E takes.
const station = process.env.STATION ?? 'bj-1';
await page.evaluate((id) => {
  const w = window.casino.world;
  w.enter(w.stations.find((s) => s.id === id));
}, station);
const machine = /^(slots|vp)-/.test(station);
if (!machine) {
  await page.waitForSelector('.lobby', { timeout: 10000 });
  await page.waitForTimeout(500);
  await shot('05-choose');
  await page.keyboard.press('s');
}
await page.waitForSelector('.modal input[type=number]', { timeout: 20000 });
await page.fill('.modal input[type=number]', '1000');
await page.click('.modal .btn.primary');
await page.waitForTimeout(2500);
await shot('06-seated');
const seated = await page.evaluate(() => ({ hud: document.querySelector('.hud')?.textContent ?? '', ms: window.casino.engine.frameMs(), stats: window.casino.world.stats() }));
log('seated', JSON.stringify(seated));

await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const confirm = await page.$('.modal .btn.primary');
if (confirm) await confirm.click();
await page.waitForTimeout(1500);
await shot('07-stood');
const after = await page.evaluate(() => ({ profile: window.casino.session.profile && { balance: window.casino.session.profile.balance, inPlay: window.casino.session.profile.inPlay } }));
log('stood up', JSON.stringify(after));

console.log(JSON.stringify({ out, errors: errors.slice(0, 20) }, null, 1));
await browser.close();
