#!/usr/bin/env node
// Headless check of the baccarat table in the dev harness: log in, buy in, bet the Banker with
// the keyboard (3 picks the $25 chip, B bets it, Space deals), play a few coups at full speed of
// animation with a screenshot mid-deal, then run a batch of quick coups to fill the scoreboard
// and screenshot the table with its roads.
// Usage: node scripts/e2e/baccarat.mjs [port] [out-dir] [quick-coups] [shoe]
// With "shoe" as the fourth argument it then plays on to the end of the shoe and screenshots the
// cut card and "Last hand", and the next shoe's shuffle and burn. With "multi" it instead opens a
// public lobby for two players (the harness is solo-only, so the page imports the app's own
// modules to switch tables), screenshots the betting window with its countdown and seat tags,
// then the settled coup.

import { chromium } from 'playwright';

const [port = '5470', outDir = '/tmp', quick = '24', mode = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const dealer = () => page.textContent('.dealer-line').catch(() => '');
const calls = [];

if (mode === 'multi') {
  await multi();
  await browser.close();
  process.exit(0);
}

await page.goto(`http://localhost:${port}/casino/?dev=table&game=baccarat&name=bacc_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
await page.fill('.modal input[type=number]', '2000');
await page.click('.modal .btn.primary');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/baccarat-empty.png` });


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
if (mode === 'shoe') {
  // the table's own drawn state (the view object is reachable through the dev harness)
  const shoe = () => page.evaluate(() => window.casino.table.view.view?.shoe ?? null);
  const quickCoup = () => page.evaluate(() => {
    window.casino.table.link.act({ type: 'bet', banker: 2500 });
    window.casino.table.link.act({ type: 'deal' });
  });
  for (let guard = 0; guard < 200; guard++) {
    const s = await shoe();
    if (s?.lastHand) break;
    await quickCoup();
    // near the cut card, one coup at a time so the last hand isn't dealt past
    await page.waitForTimeout(s && s.left < 40 ? 16000 : 450);
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${outDir}/baccarat-lasthand.png` });
  calls.push(await dealer());
  await page.keyboard.press('b');
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await page.waitForTimeout(16000);
  await page.keyboard.press('b');
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `${outDir}/baccarat-burn.png` });
  calls.push(await dealer());
  await page.waitForTimeout(14000);
}
const board = await page.textContent('.bc-board').catch(() => '');
const strip = await page.textContent('.bc-meters').catch(() => '');
const hud = await page.textContent('.dev-hud').catch(() => '');
console.log(JSON.stringify({ outDir, hud, board, strip, calls, errors: errors.slice(0, 10) }, null, 1));
await browser.close();

async function openLobby(p, tableId) {
  await p.goto(`http://localhost:${port}/casino/?dev=table&game=baccarat&name=bm_${Math.random().toString(36).slice(2, 8)}`);
  await p.waitForSelector('.modal .btn.ghost', { timeout: 30000 });
  await p.click('.modal .btn.ghost');
  return p.evaluate(async (existing) => {
    const api = await import('/casino/src/net/api.ts');
    const { TableSession } = await import('/casino/src/app/table-session.ts');
    const c = window.casino;
    const old = c.table;
    old.close();
    const id = existing ?? (await api.createTable('baccarat', 'public')).tableId;
    const t = new TableSession({ kind: 'lobby', game: 'baccarat', variant: '', tableId: id }, old.module, old.stage, old.ui, old.sfx, (fn) => c.engine.onFrame(fn), () => {});
    c.table = t;
    return id;
  }, tableId ?? null);
}

async function multi() {
  const other = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  other.on('pageerror', (e) => errors.push(String(e)));
  const tableId = await openLobby(page, null);
  await page.waitForTimeout(1500);
  await openLobby(other, tableId);
  await other.waitForTimeout(1500);
  await page.evaluate(() => window.casino.table.send({ t: 'start' }));
  for (const p of [page, other]) await p.evaluate(() => window.casino.table.link.buyIn(200000));
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.casino.table.link.act({ type: 'bet', banker: 5000, bankerPair: 500 }));
  await other.evaluate(() => window.casino.table.link.act({ type: 'bet', player: 2500, tie: 1000 }));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.casino.table.view.primary());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/baccarat-multi-betting.png` });
  const seats = await page.evaluate(() => [...document.querySelectorAll('.bc-seat')].map((e) => e.textContent));
  const timer = await page.evaluate(() => document.querySelector('.bc-timer-num')?.textContent ?? '');
  await other.evaluate(() => window.casino.table.view.primary());
  await page.waitForTimeout(19000);
  await page.screenshot({ path: `${outDir}/baccarat-multi-settled.png` });
  const board = await page.textContent('.bc-board').catch(() => '');
  console.log(JSON.stringify({ tableId, seats, timer, board, calls: [await dealer()], errors: errors.slice(0, 10) }, null, 1));
}
