#!/usr/bin/env node
// Headless look at blackjack, Three Card Poker and baccarat with Tips on: each table's decision
// point (the tip line and the ringed control), the dealer's hand and its total label, and a
// settled hand. Fixed player names, so reruns reuse the same accounts.
// Usage: node scripts/e2e/tables2.mjs [port] [outDir] [blackjack|threecard|baccarat]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5700', outDir = '/tmp/tables2', only = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const report = {};

async function open(game, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${game}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${game}: ${e}`));
  await page.addInitScript(() => localStorage.setItem('casino.tips', '1'));
  // A fixed name may still hold its seat (and chips) from the last run: no buy-in is asked then.
  // A table the last run's page left a moment ago can still be letting that seat go, so a load
  // that doesn't end up seated is tried again.
  const seated = () => page.evaluate(() => window.casino?.table?.snapshot?.you?.status === 'seated');
  for (let attempt = 1; ; attempt++) {
    if (attempt === 1) await page.goto(`http://localhost:${port}/casino/?dev=table&game=${game}&name=${name}`);
    else await page.reload();
    try {
      await page.waitForFunction(() => document.querySelector('.modal input[type=number]') || window.casino?.table?.snapshot?.you?.status === 'seated', null, { timeout: 20000 });
      if (!(await seated())) {
        await page.fill('.modal input[type=number]', '2000');
        await page.click('.modal .btn.primary');
      }
      await page.waitForFunction(() => window.casino?.table?.snapshot?.you?.status === 'seated', null, { timeout: 15000 });
      break;
    } catch (err) {
      const seen = await page.evaluate(() => ({ you: window.casino?.table?.snapshot?.you, modal: document.querySelector('.modal')?.textContent, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) })).catch(() => null);
      console.error(`${game}: not seated (attempt ${attempt})`, JSON.stringify(seen));
      if (attempt === 3) throw err;
      await page.waitForTimeout(3000);
    }
  }
  await page.waitForTimeout(800);
  return page;
}

/** Wait until the table has played every animation it was sent. */
async function settle(page, extra = 250) {
  for (let quiet = 0; quiet < 2; ) {
    await page.waitForTimeout(150);
    quiet = (await page.evaluate(() => window.casino.table.pending)) === 0 ? quiet + 1 : 0;
  }
  await page.waitForTimeout(extra);
}

const tipText = (page) => page.evaluate(() => {
  const t = document.querySelector('.tip-line');
  return t && !t.hidden ? t.textContent : null;
});
const picked = (page) => page.evaluate(() => [...document.querySelectorAll('.tip-pick')].map((b) => b.textContent));

/** The same table seen from other seats' cameras (the solo harness always seats you at seat 0). */
async function seatShots(page, game, seats) {
  for (const seat of [...seats, 0]) {
    await page.evaluate((seat) => {
      const { engine, table } = window.casino;
      const pose = table.stage.worldPose(table.module.playPose('', seat));
      engine.camera.position.copy(pose.position);
      engine.camera.lookAt(pose.target);
    }, seat);
    await page.waitForTimeout(200);
    if (seat !== 0) await page.screenshot({ path: `${outDir}/${game}-seat${seat}.png` });
  }
}

/** Screenshot the first celebration banner that goes up on this page, in the background. */
function watchCelebration(page, name, out) {
  return page
    .waitForSelector('.celebrate', { timeout: 15 * 60_000 })
    .then(async () => {
      const text = await page.textContent('.celebrate');
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${outDir}/${name}-celebrate.png` });
      out.celebration = text;
    })
    .catch(() => {});
}

async function blackjack() {
  const page = await open('blackjack', 't2_bj');
  const out = { tips: [], rounds: 0 };
  const shot = new Set();
  const watcher = watchCelebration(page, 'blackjack', out);
  for (let round = 0; round < 40 && !(shot.has('decision') && out.celebration && round >= 3); round++) {
    out.rounds++;
    await page.evaluate(() => window.casino.table.link.act({ type: 'bet', amount: 2500 }));
    await page.waitForFunction(() => {
      const t = window.casino.table.view;
      return t.v?.phase === 'betting' && (t.v.bets[t.seat] ?? 0) > 0;
    }, null, { timeout: 8000 }).catch(async (err) => {
      const seen = await page.evaluate(() => {
        const t = window.casino.table;
        return { you: t.snapshot?.you, phase: t.view?.v?.phase, bets: t.view?.v?.bets, seat: t.view?.seat, seated: t.view?.seated, pending: t.pending, toasts: [...document.querySelectorAll('.toast')].map((x) => x.textContent) };
      });
      throw new Error(`bet did not land: ${JSON.stringify(seen)} ${err}`);
    });
    await settle(page, 100);
    await page.keyboard.press('Space');
    await settle(page, 400);
    for (let step = 0; step < 12; step++) {
      const s = await page.evaluate(() => {
        const t = window.casino.table.view;
        return { phase: t.v.phase, insure: !t.insure.hidden, actions: !t.actions.hidden };
      });
      if (s.phase !== 'insurance' && s.phase !== 'play') break;
      if (!s.insure && !s.actions) {
        await settle(page, 200);
        continue;
      }
      const tip = await tipText(page);
      const pick = await picked(page);
      if (out.tips.length < 30) out.tips.push({ tip, pick });
      const kind = s.insure ? 'insurance' : 'decision';
      if (!shot.has(kind)) {
        await page.screenshot({ path: `${outDir}/blackjack-${kind}.png` });
        if (kind === 'decision') await seatShots(page, 'blackjack', [5, 3, 6]);
        shot.add(kind);
      }
      // follow the tip: press the ringed button's key
      const key = await page.evaluate(() => document.querySelector('.bj-actions .tip-pick .key, .bj-insure .tip-pick .key')?.textContent ?? 'S');
      await page.keyboard.press(key.toLowerCase());
      await settle(page, 200);
    }
    await settle(page, 300);
    if (!shot.has('result')) {
      await page.screenshot({ path: `${outDir}/blackjack-result.png` });
      shot.add('result');
    }
    await page.waitForTimeout(out.celebration ? 0 : 900);
  }
  await Promise.race([watcher, page.waitForTimeout(20000)]);
  report.blackjack = out;
  await page.close();
}

async function threecard() {
  const page = await open('threecard', 't2_tc');
  const out = { tips: [] };
  for (let hand = 0; hand < 3; hand++) {
    // straight to the server: the view's own tray keeps its bets locally
    await page.evaluate(() => window.casino.table.link.act({ type: 'bet', ante: 2500, pairPlus: 500 }));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.casino.table.link.act({ type: 'deal' }));
    await page.waitForSelector('.tc-decide:not([hidden])', { timeout: 30000 });
    await page.waitForTimeout(600);
    out.tips.push({ tip: await tipText(page), pick: await picked(page) });
    if (hand === 0) await page.screenshot({ path: `${outDir}/threecard-decision.png` });
    const key = await page.evaluate(() => document.querySelector('.tc-decide .tip-pick .key')?.textContent ?? 'P');
    await page.keyboard.press(key.toLowerCase());
    await page.waitForFunction(() => /qualif|Dealer has|Folded/.test(document.querySelector('.dealer-line')?.textContent ?? ''), null, { timeout: 30000 });
    await page.waitForTimeout(900);
    if (hand === 0) await page.screenshot({ path: `${outDir}/threecard-reveal.png` });
    await settle(page, 600);
  }
  report.threecard = out;
  await page.close();
}

async function baccarat() {
  const page = await open('baccarat', 't2_bc');
  const out = { tips: [] };
  out.tips.push({ tip: await tipText(page), pick: await picked(page) });
  await page.screenshot({ path: `${outDir}/baccarat-betting.png` });
  await page.keyboard.press('3');
  await page.keyboard.press('b');
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  out.tips.push({ tip: await tipText(page), pick: await picked(page) });
  await settle(page, 300);
  await page.screenshot({ path: `${outDir}/baccarat-settled.png` });
  report.baccarat = out;
  await page.close();
}

for (const [name, run] of Object.entries({ blackjack, threecard, baccarat })) {
  if (only && only !== name) continue;
  try {
    await run();
  } catch (err) {
    errors.push(`${name}: ${String(err).split('\n')[0]}`);
  }
}
console.log(JSON.stringify({ outDir, report, errors: errors.slice(0, 20) }, null, 1));
await browser.close();
if (errors.length) process.exit(1);
