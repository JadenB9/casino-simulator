#!/usr/bin/env node
// Headless check of the leaderboard sheet and the emote wheel on their dev page: each board
// (you below the ten, no place yet, you in the ten), a phone-width sheet, a failed request, the
// wheel by mouse and by keyboard (G, 1-6, the burst limit), the wheel on a phone by touch, then the real boards from the local
// worker. Screenshots go to <out dir>.
// Usage: node scripts/e2e/social.mjs [port] [out dir]

import { chromium } from 'playwright';

const [port = '5173', out = '/tmp'] = process.argv.slice(2);
const base = `http://localhost:${port}/casino/src/ui/social/dev.html`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const results = {};

async function page(query, viewport = { width: 1280, height: 800 }, touch = false) {
  const p = await browser.newPage({ viewport, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
  p.on('console', (m) => m.type() === 'error' && errors.push(`${query}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${query}: ${e}`));
  await p.goto(`${base}?${query}`);
  return p;
}

// Boards from the fixture: one per tab.
{
  const p = await page('screen=leaderboard&fixture=1');
  await p.waitForSelector('.lb-table');
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/social-richest.png` });
  results.richest = await p.$$eval('.lb-table tbody tr', (rows) => rows.map((r) => r.className + ' | ' + r.textContent));
  results.sub = await p.textContent('.sheet-sub');
  await p.click('.lb-nav [id$="-biggestWin"]');
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/social-biggestwin.png` });
  // Arrow keys move between tabs from the focused tab.
  await p.focus('.lb-nav [aria-selected="true"]');
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(900);
  results.afterArrow = await p.textContent('.lb-nav [aria-selected="true"]');
  await p.screenshot({ path: `${out}/social-rounds.png` });
  await p.waitForTimeout(1500);
  results.subLater = await p.textContent('.sheet-sub');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.lb-sheet', { state: 'detached', timeout: 3000 }).catch(() => {});
  results.closedByEsc = (await p.$('.lb-sheet')) === null;
  await p.close();
}

// Phone width, and a request that fails.
{
  const p = await page('screen=leaderboard&fixture=1', { width: 390, height: 844 });
  await p.waitForSelector('.lb-table');
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/social-phone.png` });
  await p.close();
  const f = await page('screen=leaderboard&fixture=1&fail=1');
  await f.waitForSelector('.lb-problem');
  await f.waitForTimeout(300);
  await f.screenshot({ path: `${out}/social-failed.png` });
  results.failed = await f.textContent('.lb-panel');
  await f.close();
}

// The wheel: hover, then the keyboard, then the burst limit.
{
  const p = await page('screen=hud&fixture=1');
  await p.waitForSelector('.hud-right');
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/social-hud.png`, clip: { x: 640, y: 0, width: 640, height: 80 } });
  await p.keyboard.press('g');
  await p.waitForSelector('.emo-wheel');
  await p.hover('.emo-btn[data-emote="cheer"]');
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/social-wheel.png` });
  results.hub = await p.textContent('.emo-name');
  await p.keyboard.press('2');
  await p.waitForTimeout(150);
  results.afterPick = { open: (await p.$('.emo-wheel')) !== null, toast: await p.textContent('.toasts').catch(() => null) };
  // Esc puts it away.
  await p.keyboard.press('g');
  await p.waitForSelector('.emo-wheel');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(100);
  results.closedByEsc2 = (await p.$('.emo-wheel')) === null;
  // Six on the wheel, 67 on key 6, and the keys are the page's again once it has closed.
  await p.keyboard.press('g');
  await p.waitForSelector('.emo-wheel');
  results.buttons = await p.$$eval('.emo-btn', (bs) => bs.map((b) => b.getAttribute('aria-label')));
  results.hint = await p.textContent('.emo-hint');
  await p.keyboard.press('6');
  await p.waitForTimeout(150);
  results.after6 = { open: (await p.$('.emo-wheel')) !== null, scrim: (await p.$('.emo-scrim')) !== null };
  await p.keyboard.press('g');
  results.reopensAfter6 = (await p.waitForSelector('.emo-wheel', { timeout: 2000 }).catch(() => null)) !== null;
  await p.keyboard.press('Escape');
  results.toasts = await p.$$eval('.toast', (ts) => ts.map((t) => t.textContent));
  await p.close();
}

// A phone: the HUD button and a tap on 67, then a tap outside.
{
  const p = await page('screen=hud&fixture=1', { width: 390, height: 844 }, true);
  await p.waitForSelector('.hud-right');
  await p.waitForTimeout(1500);
  await p.tap('.hud-btn[aria-label="Emotes (G)"]');
  await p.waitForSelector('.emo-wheel');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/social-wheel-phone.png` });
  results.phoneWheel = await p.$eval('.emo-wheel', (w) => {
    const r = w.getBoundingClientRect();
    const b = [...w.querySelectorAll('.emo-btn')].map((x) => x.getBoundingClientRect());
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, smallest: Math.min(...b.map((x) => Math.min(x.width, x.height))), keysShown: [...w.querySelectorAll('.emo-key')].some((k) => getComputedStyle(k).display !== 'none') };
  });
  await p.tap('.emo-btn[data-emote="sixseven"]');
  await p.waitForTimeout(200);
  results.phonePicked = { open: (await p.$('.emo-wheel')) !== null, toast: await p.$$eval('.toast', (ts) => ts.map((t) => t.textContent)) };
  await p.tap('.hud-btn[aria-label="Emotes (G)"]');
  await p.waitForSelector('.emo-wheel');
  await p.touchscreen.tap(30, 780);
  await p.waitForTimeout(200);
  results.phoneTapOutside = (await p.$('.emo-scrim')) === null;
  await p.close();
}

// The burst limit, on a fresh page and in one go (slow frames would otherwise let a token
// refill between keypresses): three go out, the fourth waits with the wheel open.
{
  const p = await page('screen=hud&fixture=1');
  await p.waitForSelector('.hud-right');
  // The software renderer is slow on a fresh page; let the room finish its first frames.
  await p.waitForTimeout(2500);
  results.burstOpenAfter = await p.evaluate(() => {
    const open = [];
    for (let i = 0; i < 4; i++) {
      window.dev.emotes.open();
      document.querySelector('.emo-wheel').dispatchEvent(new KeyboardEvent('keydown', { key: String(i + 1), bubbles: true }));
      open.push(window.dev.emotes.isOpen);
    }
    return open;
  });
  results.cooling = { open: (await p.$('.emo-wheel.cooling')) !== null, hint: await p.textContent('.emo-hint').catch(() => null) };
  // A moment to draw it (the hint shows for 1.2 s).
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/social-wheel-cooling.png` });
  await p.close();
}

// The real thing, from the local worker (a fixed name: new accounts are rate limited).
{
  const p = await page('screen=leaderboard&name=social_shot');
  await p.waitForSelector('.lb-table, .lb-board .quiet', { timeout: 20000 });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/social-live.png` });
  results.live = await p.$$eval('.lb-table tbody tr', (rows) => rows.map((r) => r.className + ' | ' + r.textContent));
  results.liveSub = await p.textContent('.sheet-sub');
  await p.close();
}

console.log(JSON.stringify({ results, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
