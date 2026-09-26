#!/usr/bin/env node
// v7.4: rebinding a key through Settings, on the real stack: open Settings, find Keys, click
// "Walk forward", press I; I walks and W doesn't; the help (?) shows I; Reset puts W back.
// Usage: node scripts/e2e/keys74.mjs [port] [outDir]   (PORT_BASE=<port> npm run dev first)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6350', out = '/tmp/keys74'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
let failed = 0;
const ok = (c, what) => (c ? console.log(`ok   ${what}`) : (failed++, console.log(`FAIL ${what}`)));
await p.goto(`http://localhost:${port}/casino/`);
await p.waitForSelector('.name-input', { timeout: 300000 });
await p.fill('.name-input', 'keys74_e2e_1');
if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
await p.click('.enter-btn');
await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 30000 });
if (await p.$('.editor-panel.guided')) { for (let i = 0; i < 3; i++) { await p.click('.editor-panel .ed-buttons .btn.primary'); await p.waitForTimeout(500); } } else await p.click('.menu-item >> nth=0');
await p.waitForSelector('.hud', { timeout: 30000 });
await p.waitForTimeout(1500);
await p.keyboard.press('Escape');
await p.waitForTimeout(300);
await p.click('.hud [aria-label^="Settings"], .hud [title^="Settings"]');
await p.waitForSelector('.keys-list');
const walk = p.locator('.keys-key[aria-label^="Walk forward"]');
await walk.scrollIntoViewIfNeeded();
await walk.click();
ok((await walk.textContent()) === 'Press a key', 'the key waits for a press');
await p.keyboard.press('KeyI');
ok((await walk.textContent()) === 'I', 'walk forward is I now');
await p.screenshot({ path: `${out}/keys74-settings.png` });
await p.keyboard.press('Escape');
await p.waitForTimeout(500);
const pos = () => p.evaluate(() => ({ x: window.casino.world.player.position.x, z: window.casino.world.player.position.z }));
const hold = async (key) => {
  const a = await pos();
  await p.keyboard.down(key);
  await p.waitForTimeout(900);
  await p.keyboard.up(key);
  await p.waitForTimeout(300);
  const b = await pos();
  return Math.hypot(b.x - a.x, b.z - a.z);
};
ok((await hold('KeyI')) > 0.5, 'I walks');
ok((await hold('KeyW')) < 0.05, 'W no longer does');
ok((await hold('ArrowUp')) > 0.5, 'the arrow still walks');
await p.keyboard.press('Shift+Slash');
await p.waitForSelector('.shortcuts-sheet');
const help = await p.locator('.shortcuts-sheet').innerText();
ok(/I\s*A\s*S\s*D/.test(help), 'the help shows I A S D');
await p.keyboard.press('Escape');
await p.click('.hud [aria-label^="Settings"], .hud [title^="Settings"]');
await p.waitForSelector('.keys-reset');
await p.locator('.keys-reset').scrollIntoViewIfNeeded();
await p.click('.keys-reset');
ok((await walk.textContent()) === 'W', 'reset puts W back');
ok(await p.evaluate(() => localStorage.getItem('casino.keys') === null), 'nothing kept once back on the defaults');
ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
console.log(failed ? `${failed} failed` : 'all passed');
await browser.close();
process.exit(failed ? 1 : 0);
