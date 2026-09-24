#!/usr/bin/env node
// Headless check of several hands at the solo tables, in the dev harness: pick three hands in the
// tray, bet each spot by clicking it on the felt, deal, play every hand in turn (blackjack splits
// one when it can), and screenshot each stage.
// Fixed player names (mh_e2e_*), so reruns don't spend the new-account limit.
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
  // A name used before may still have chips at its table; otherwise the table asks for a buy-in.
  await page.waitForFunction(() => window.casino?.table?.snapshot || document.querySelector('.modal input[type=number]'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  if (await page.$('.modal input[type=number]')) {
    await page.fill('.modal input[type=number]', '5000');
    await page.click('.modal .btn.primary');
  }
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
  /** The camera has stopped moving (a glide runs on the frame clock, slow in a headless browser). */
  const still = async () => {
    const at = () => page.evaluate(() => window.casino.engine.camera.position.toArray().map((x) => x.toFixed(4)).join());
    for (let prev = await at(), n = 0; n < 40; n++) {
      await page.waitForTimeout(250);
      const now = await at();
      if (now === prev) return;
      prev = now;
    }
  };
  /** Choose how many hands in the picker, and let the camera settle on them. */
  const pick = async (n) => {
    // a rerun under the same name can find last run's chips still on the layout
    await page.keyboard.press('x');
    await settle(100);
    await page.click(`.mh-picker .mh-n:nth-child(${n})`);
    await page.waitForFunction((n) => document.querySelector('.mh-n[aria-checked="true"]')?.textContent === String(n), n, { timeout: 10000 });
    await page.waitForTimeout(300);
    await still();
  };
  return { page, errors, shots, shot, settle, region, pick };
}

async function blackjack() {
  const t = await open('blackjack', 'mh_e2e_bj');
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
  await t.shot('1-three-spots');

  const did = { split: false, turnShot: false, insurance: false, celebration: false };
  let rounds = 0;
  // Deal on until a split, the insurance question (an ace up) and a celebration (a blackjack or a
  // winning double or split on one of the spots) have all come up.
  for (; rounds < 60 && !(did.split && did.turnShot && did.insurance && did.celebration); rounds++) {
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
    // the 'done' event puts a celebration banner up for a spot that had its moment
    const banner = await page.waitForSelector('.celebrate:not(.out)', { timeout: 1500 }).catch(() => null);
    if (banner && !did.celebration) {
      did.celebration = true;
      await t.shot('8-celebration');
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
  const t = await open('threecard', 'mh_e2e_tc');
  const { page } = t;
  const decideUp = () => page.waitForSelector('.tc-decide:not([hidden])', { timeout: 30000 });
  await t.pick(3);
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

async function war() {
  const t = await open('war', 'mh_e2e_wr');
  const { page } = t;
  await t.pick(3);
  await t.shot('1-three-spots');
  // $25 bets on all three spots (the tray starts on the $25 chip), a $5 Tie bet on the middle one.
  for (const spot of [0, 1, 2]) {
    const at = await t.region(`bet:${spot}`);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('2');
  const tie = await t.region('tie:0');
  await page.mouse.click(tie.x, tie.y);
  await page.waitForFunction(() => /Bet\$80/.test(document.querySelector('.wr-meters')?.textContent ?? ''), null, { timeout: 10000 });
  await t.settle(200);
  await t.shot('2-bets');
  let tied = false;
  let rounds = 0;
  for (; rounds < 30 && !tied; rounds++) {
    if (rounds > 0) {
      await page.keyboard.press('r');
      await page.waitForFunction(() => /Bet\$80/.test(document.querySelector('.wr-meters')?.textContent ?? ''), null, { timeout: 10000 });
      await t.settle(100);
    }
    await page.keyboard.press('Space');
    await t.settle(500);
    if (rounds === 0) await t.shot('3-deal');
    for (let k = 0; k < 3; k++) {
      const up = await page.$('.wr-decide:not([hidden])');
      if (!up) break;
      if (!tied) {
        tied = true;
        await t.shot('4-tie-decide');
      }
      await page.keyboard.press('w');
      await t.settle(400);
    }
    await t.settle(600);
  }
  if (tied) await t.shot('5-war-results');
  await page.waitForFunction(() => /Bet\$0/.test(document.querySelector('.wr-meters')?.textContent ?? ''), null, { timeout: 30000 });
  await t.settle(300);
  await t.shot('6-settled');
  const meters = await page.textContent('.wr-meters');
  report.war = { rounds, tied, meters, shots: t.shots, errors: t.errors.slice(0, 10) };
  await page.close();
}

try {
  if (which === 'all' || which === 'blackjack') await blackjack();
  if (which === 'all' || which === 'threecard') await threecard();
  if (which === 'all' || which === 'war') await war();
} catch (err) {
  report.error = String(err?.stack ?? err);
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
if (report.error || Object.values(report).some((r) => r?.errors?.length)) process.exit(1);
