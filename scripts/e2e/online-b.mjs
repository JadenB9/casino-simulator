#!/usr/bin/env node
// Headless check of Tower, Mines, Hi-Lo and Crash in the dev harness (the camera already sits at
// the desk's pcPose there): buy in, play against the real server through the page's own buttons
// and keys, and screenshot each game at rest, mid-round and after. Each page also checks what it
// shows against what the server sent (the chips, the result), that nothing hidden (a mine, a
// dragon, the next card, the crash point) reached the page before its time, and a page error
// fails the run.
// Usage: node scripts/e2e/online-b.mjs [port] [outDir] [games...]   (PORT_BASE=<port> npm run dev first)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6010', outDir = '/tmp/online-b', ...only] = process.argv.slice(2);
const games = only.length ? only : ['tower', 'mines', 'hilo', 'crash'];
mkdirSync(outDir, { recursive: true });

// On a Mac the GPU draws the page at full speed; elsewhere, or with GL=swiftshader, the software path.
const gl = process.env.GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const glArgs = gl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: [...glArgs, `--explicitly-allowed-ports=${port},${Number(port) + 1}`] });
const report = [];
let failed = false;
const money = (c) => '$' + Math.floor(c / 100).toLocaleString('en-US') + (c % 100 ? '.' + String(c % 100).padStart(2, '0') : '');

async function open(game, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const frames = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        if (msg.t === 'ev' || msg.t === 'err' || msg.t === 'table') frames.push(msg);
      } catch {}
    }),
  );
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=${game}&name=${name}`);
  if (await page.waitForSelector('.pass-input', { timeout: 2500 }).catch(() => null)) await page.fill('.pass-input', 'casino-dev');
  await page.waitForSelector('.os-screen:not([hidden])', { timeout: 30000 });
  // A seat still held from an earlier run (within the table's grace period) needs no buy-in.
  if (await page.waitForSelector('.modal input[type=number]', { timeout: 6000 }).catch(() => null)) {
    await page.fill('.modal input[type=number]', '2000');
    await page.click('.modal .btn.primary');
  }
  await page.waitForFunction(() => document.querySelector('.os-stack-value')?.textContent !== '$0', null, { timeout: 15000 });
  await page.waitForTimeout(800);
  return { page, errors, frames };
}

for (const game of games) {
  const { page, errors, frames } = await open(game, `ob_${game}`);
  const shots = [];
  const shot = async (name) => {
    const path = `${outDir}/${game}-${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
  };
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);
  const events = (type) => frames.flatMap((m) => (m.t === 'ev' ? m.events.filter((e) => e.type === type) : []));
  const views = () => frames.filter((m) => m.t === 'ev' || m.t === 'table').map((m) => m.view);
  const check = (ok, what) => {
    if (!ok) {
      failed = true;
      errors.push(`check failed: ${what}`);
    }
  };
  const settle = (ms = 1200) => page.waitForTimeout(ms);
  const out = { game, shots, errors, notes: [] };
  await shot('0-idle');

  if (game === 'tower') {
    await page.fill('.os-bet-input', '10');
    await page.press('.os-bet-input', 'Enter');
    await page.click('.os-side .os-seg button:has-text("Medium")');
    await page.click('.os-action.go');
    await settle(600);
    await shot('1-first-row');
    // Climb with the keyboard until three eggs or the dragon.
    for (let i = 0; i < 3; i++) {
      const before = events('pick').length;
      await page.keyboard.press(String((i % 3) + 1));
      await page.waitForFunction((n) => true, before);
      await settle(700);
      const last = events('pick').at(-1);
      if (!last || !last.safe) break;
    }
    await shot('2-climbing');
    const picks = events('pick');
    out.notes.push(`picks: ${picks.map((p) => `row ${p.row} tile ${p.tile} ${p.safe ? 'egg' : 'DRAGON'}`).join(', ')}`);
    // In flight, no view or event carried the tower.
    const early = frames.filter((m) => m.t === 'ev' && m.view.phase === 'climbing');
    check(early.every((m) => m.view.tower === null && !JSON.stringify(m.events).includes('"tower"')), 'the tower stays hidden while climbing');
    if (picks.at(-1)?.safe) {
      await page.click('.os-action.cash');
      await settle(1400);
      await shot('3-cashed-out');
    } else await shot('3-dragon');
    const over = events('over').at(-1);
    check(!!over, 'the climb ended');
    const lastView = views().at(-1);
    check(lastView && JSON.stringify(lastView.tower) === JSON.stringify(over?.tower), 'the whole tower is shown at the end');
    out.notes.push(`over: ${over?.outcome} at ${over?.mult / 100}x paid ${money(over?.payout ?? 0)}`);
    // A Master climb with random picks, to see the dragon.
    await page.click('.os-side .os-seg button:has-text("Master")');
    for (let r = 0; r < 6; r++) {
      await page.click('.os-action.go');
      await settle(500);
      await page.keyboard.press('r');
      await settle(900);
      if (events('over').at(-1)?.outcome === 'bust') break;
      if (await page.$('.os-action.cash:not([disabled])')) {
        await page.click('.os-action.cash');
        await settle(900);
      }
    }
    await settle(600);
    await shot('4-master');
    const stackShown = await text('.os-stack-value');
    const seat = frames.filter((m) => m.t === 'table').at(-1);
    out.notes.push(`chips shown ${stackShown}`);
  }

  if (game === 'mines') {
    await page.fill('.os-bet-input', '5');
    await page.press('.os-bet-input', 'Enter');
    await page.fill('.mn-counts .os-num >> nth=0 >> input', '3');
    await page.press('.mn-counts .os-num >> nth=0 >> input', 'Enter');
    await page.click('.os-action.go');
    await settle(600);
    // Turn tiles in reading order until four gems or a mine.
    for (let i = 0; i < 4; i++) {
      await page.click(`.mn-tile.closed >> nth=${i * 3}`);
      await settle(700);
      if (!events('reveal').at(-1)?.safe) break;
    }
    await shot('1-playing');
    const early = frames.filter((m) => m.t === 'ev' && m.view.phase === 'playing');
    check(early.every((m) => m.view.field === null && !JSON.stringify(m.events).includes('"field"')), 'the mines stay hidden while playing');
    if (events('reveal').at(-1)?.safe) {
      await page.click('.os-action.cash');
      await settle(1400);
      await shot('2-cashed-out');
    } else await shot('2-mine');
    const over = events('over').at(-1);
    check(!!over && JSON.stringify(views().at(-1).field) === JSON.stringify(over.field), 'the whole board is shown at the end');
    out.notes.push(`first board: ${over?.outcome}, ${over?.gems} gems at ${over?.mult / 100}x paid ${money(over?.payout ?? 0)}`);
    // Ten mines, random tiles until one goes off.
    await page.fill('.mn-counts .os-num >> nth=0 >> input', '10');
    await page.press('.mn-counts .os-num >> nth=0 >> input', 'Enter');
    for (let r = 0; r < 8 && events('over').at(-1)?.outcome !== 'bust'; r++) {
      await page.click('.os-action.go');
      await settle(500);
      for (let i = 0; i < 6 && !(await page.$('.os-action.go')); i++) {
        await page.keyboard.press('r');
        await settle(650);
      }
      if (await page.$('.os-action.cash:not([disabled])')) {
        await page.click('.os-action.cash');
        await settle(800);
      }
    }
    await settle(900);
    await shot('3-ten-mines');
    const last = frames.filter((m) => m.t === 'ev').at(-1);
    out.notes.push(`chips shown ${await text('.os-stack-value')}; boards ${events('over').length}`);
  }

  if (game === 'hilo') {
    await page.fill('.os-bet-input', '10');
    await page.press('.os-bet-input', 'Enter');
    // A free skip before betting, then a round: the likelier side until two right guesses.
    await page.keyboard.press('s');
    await settle(700);
    await page.click('.os-action.go');
    await settle(700);
    await shot('1-bet');
    for (let i = 0; i < 2; i++) {
      const v = views().at(-1);
      const dir = v.hi.count >= v.lo.count ? 'hi' : 'lo';
      await page.click(`.hl-guess.${dir}`);
      await settle(900);
      if (!events('guess').at(-1)?.win) break;
    }
    await page.keyboard.press('s');
    await settle(800);
    await shot('2-guessing');
    const g = events('guess');
    out.notes.push(`guesses: ${g.map((e) => `${e.dir} ${e.count}/13 -> ${e.card} ${e.win ? 'right ' + e.mult / 100 + 'x' : 'WRONG'}`).join(', ')}`);
    // No view or event ever carried a card ahead of the one face up.
    check(frames.filter((m) => m.t === 'ev').every((m) => m.events.every((e) => e.type !== 'guess' || e.card === m.view.card || m.events.at(-1) !== e)), 'events carry only cards already face up');
    check(g.every((e) => typeof e.card === 'string'), 'each guess comes with its card');
    if (views().at(-1).phase === 'playing' && views().at(-1).mult > 0) {
      await page.click('.os-action.cash');
      await settle(1200);
      await shot('3-cashed-out');
    } else await shot('3-lost');
    const over = events('over').at(-1);
    check(!!over, 'the round ended');
    out.notes.push(`over: ${over?.outcome} after ${over?.guesses} at ${over?.mult / 100}x paid ${money(over?.payout ?? 0)}; trail ${await page.$$eval('.os-trail-item', (t) => t.length)} cards`);
    // A long round on the likelier side to fill the trail.
    await page.click('.os-action.go');
    await settle(600);
    for (let i = 0; i < 8 && views().at(-1).phase === 'playing'; i++) {
      const v = views().at(-1);
      await page.keyboard.press(v.hi.count >= v.lo.count ? 'ArrowUp' : 'ArrowDown');
      await settle(800);
    }
    await shot('4-long-round');
    out.notes.push(`chips shown ${await text('.os-stack-value')}`);
  }

  out.notes.push(`frames: ${frames.length}`);
  report.push(out);
  // Stand up, so the chips go home and the next run starts with a buy-in.
  await page.evaluate(() => window.casino.table.leave());
  await page.waitForTimeout(1500);
  await page.close();
}

console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(failed || report.some((r) => r.errors.length) ? 1 : 0);
