#!/usr/bin/env node
// Headless check of several hands at the solo tables, in the dev harness: pick three hands in the
// tray, bet each spot by clicking it on the felt, deal, play every hand in turn (blackjack splits
// one when it can), and screenshot each stage.
// Usage: node scripts/e2e/multihand.mjs [port] [outDir] [blackjack|threecard|war|all]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', outDir = '/tmp/multihand-e2e', which = 'all'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = {};

async function open(game, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=${game}&name=${name}`);
  await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
  await page.fill('.modal input[type=number]', '5000');
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino?.table?.snapshot?.you?.status === 'seated', null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const shots = [];
  const shot = async (label) => {
    const path = `${outDir}/${game}-${label}.png`;
    await page.mouse.move(8, 400);
    await page.screenshot({ path });
    shots.push(path);
  };
  /** Wait until the table has played every animation it was sent. */
  const settle = async (extra = 250) => {
    for (let quiet = 0; quiet < 2; ) {
      await page.waitForTimeout(150);
      quiet = (await page.evaluate(() => window.casino.table.pending)) === 0 ? quiet + 1 : 0;
    }
    await page.waitForTimeout(extra);
  };
  /** The screen point of one of the felt's click regions (`spot:1`, `ante:2`). */
  const region = (id) =>
    page.evaluate((id) => {
      const { engine, table } = window.casino;
      const felt = table.stage.felts[0];
      const shape = felt.spec.regions.find((r) => r.id === id).shape;
      const p = engine.camera.position.clone().set(shape.x, felt.mesh.position.y, shape.z);
      table.stage.root.localToWorld(p);
      p.project(engine.camera);
      return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
    }, id);
  /** Choose how many hands in the tray's picker. */
  const pick = (n) => page.click(`.mh-picker .mh-n:nth-child(${n})`);
  return { page, errors, shots, shot, settle, region, pick };
}

async function blackjack() {
  const t = await open('blackjack', `mhbj_${Date.now().toString(36).slice(-5)}`);
  const { page } = t;
  const state = () =>
    page.evaluate(() => {
      const view = window.casino.table.view;
      const v = view.v;
      return { phase: v.phase, turn: v.turn, mine: view.mine, moves: v.moves, spots: v.spots, bets: v.bets, insurance: !view.insure.hidden, actions: !view.actions.hidden, stack: view.stack };
    });
  const total = (cards) => {
    let sum = 0;
    let ace = false;
    for (const c of cards) {
      const v = c[0] === 'A' ? 1 : '23456789'.includes(c[0]) ? Number(c[0]) : 10;
      sum += v;
      if (v === 1) ace = true;
    }
    return ace && sum <= 11 ? sum + 10 : sum;
  };
  await t.pick(3);
  await page.waitForFunction(() => window.casino.table.view.mine.length === 3, null, { timeout: 10000 });
  await page.waitForTimeout(1100);
  await t.shot('1-three-spots');

  const did = { split: false, turnShot: false, insurance: false };
  let rounds = 0;
  for (; rounds < 40 && !(did.split && did.turnShot); rounds++) {
    if (rounds === 0) {
      await page.keyboard.press('3'); // the $25 chip
      for (const spot of [0, 1, 2]) {
        const at = await t.region(`spot:${spot}`);
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(120);
      }
    } else {
      await page.keyboard.press('r');
    }
    await page.waitForFunction(() => {
      const v = window.casino.table.view.v;
      return v.phase === 'betting' && Object.keys(v.bets).length === 3;
    }, null, { timeout: 10000 });
    await t.settle(150);
    if (rounds === 0) await t.shot('2-bets');
    await page.keyboard.press('Space');
    await t.settle(rounds === 0 ? 900 : 300);
    if (rounds === 0) await t.shot('3-deal');
    for (let step = 0; step < 40; step++) {
      const s = await state();
      if (s.phase !== 'insurance' && s.phase !== 'play') break;
      if (s.insurance) {
        if (!did.insurance) {
          did.insurance = true;
          await t.shot('insurance');
        }
        await page.keyboard.press('n');
      } else if (s.actions && s.turn) {
        const sp = s.spots.find((x) => x.seat === s.turn.seat);
        const hand = sp.hands[s.turn.hand];
        // The second spot to play, mid-round: the lit circle shows which hand is up.
        const order = s.spots.map((x) => x.seat);
        if (!did.turnShot && order.indexOf(s.turn.seat) === 1) {
          did.turnShot = true;
          await t.shot('4-second-spot');
        }
        if (!did.split && s.moves.includes('split')) {
          await page.keyboard.press('p');
          did.split = true;
          await t.settle(500);
          await t.shot('5-split');
          continue;
        }
        await page.keyboard.press(total(hand.cards) < 13 ? 'h' : 's');
      }
      await t.settle(200);
    }
    await t.settle(700);
    if (rounds === 0 || (did.split && !report.blackjackSplitResult)) {
      await t.shot(rounds === 0 ? '6-results' : '7-split-results');
      if (did.split) report.blackjackSplitResult = true;
    }
  }
  const final = await state();
  report.blackjack = { rounds, did, stack: final.stack, mine: final.mine, shots: t.shots, errors: t.errors.slice(0, 10) };
  await page.close();
}

async function threecard() {
  const t = await open('threecard', `mhtc_${Date.now().toString(36).slice(-5)}`);
  const { page } = t;
  const decideUp = () => page.waitForSelector('.tc-decide:not([hidden])', { timeout: 30000 });
  await t.pick(3);
  await page.waitForFunction(() => document.querySelector('.mh-n[aria-checked="true"]')?.textContent === '3', null, { timeout: 10000 });
  await page.waitForTimeout(1100);
  await t.shot('1-three-hands');
  // $25 Antes on all three (the tray starts on the $25 chip), $5 Pair Plus on the first two.
  for (const spot of [0, 1, 2]) {
    const at = await t.region(`ante:${spot}`);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('2');
  for (const spot of [0, 1]) {
    const at = await t.region(`pairPlus:${spot}`);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => /Bet\$85/.test(document.querySelector('.tc-meters')?.textContent ?? ''), null, { timeout: 10000 });
  await t.settle(200);
  await t.shot('2-bets');
  await page.keyboard.press('Space');
  await decideUp();
  await t.settle(500);
  await t.shot('3-decide-first');
  const hints = [await page.textContent('.tc-hint')];
  await page.keyboard.press('p');
  await t.settle(300);
  await decideUp();
  await t.settle(300);
  hints.push(await page.textContent('.tc-hint'));
  await t.shot('4-decide-second');
  await page.keyboard.press('f');
  await t.settle(300);
  await decideUp();
  hints.push(await page.textContent('.tc-hint'));
  await page.keyboard.press('p');
  await page.waitForSelector('.pill', { timeout: 30000 });
  await page.waitForTimeout(700);
  await t.shot('5-results');
  await t.settle(600);
  await page.waitForFunction(() => /Bet\$0/.test(document.querySelector('.tc-meters')?.textContent ?? ''), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  await t.shot('6-settled');
  const meters = await page.textContent('.tc-meters');
  report.threecard = { hints, meters, shots: t.shots, errors: t.errors.slice(0, 10) };
  await page.close();
}

try {
  if (which === 'all' || which === 'blackjack') await blackjack();
  if (which === 'all' || which === 'threecard') await threecard();
} catch (err) {
  report.error = String(err?.stack ?? err);
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
if (report.error || Object.values(report).some((r) => r?.errors?.length)) process.exit(1);
