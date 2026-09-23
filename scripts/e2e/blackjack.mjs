#!/usr/bin/env node
// Headless check of the blackjack table in the dev harness: buy in, bet by clicking the betting
// circle, deal with Space, then play rounds with the keyboard until it has hit, stood, doubled
// and split, with a screenshot of each. The shoe is the server's, so it deals until a pair comes.
// Usage: node scripts/e2e/blackjack.mjs [port] [outDir]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', outDir = '/tmp/blackjack-e2e'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${port}/casino/?dev=table&game=blackjack&name=bj_${Date.now().toString(36).slice(-6)}`);
await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
await page.fill('.modal input[type=number]', '2000');
await page.click('.modal .btn.primary');
await page.waitForFunction(() => window.casino?.table?.view?.seated === true, null, { timeout: 20000 });

/** Wait until the table has played every animation it was sent. */
async function settle(extra = 250) {
  for (let quiet = 0; quiet < 2; ) {
    await page.waitForTimeout(150);
    quiet = (await page.evaluate(() => window.casino.table.pending)) === 0 ? quiet + 1 : 0;
  }
  await page.waitForTimeout(extra);
}

const state = () =>
  page.evaluate(() => {
    const t = window.casino.table.view;
    const v = t.v;
    const mine = v.spots.find((s) => s.seat === t.seat);
    return { phase: v.phase, turn: v.turn, seat: t.seat, moves: v.moves, hands: mine?.hands ?? [], bet: v.bets[t.seat] ?? 0, insurance: !t.insure.hidden, actions: !t.actions.hidden, stack: t.stack };
  });

/** Where the player's betting circle is on screen, from the felt's own click region. */
const circle = () =>
  page.evaluate(() => {
    const { engine, table } = window.casino;
    const view = table.view;
    const shape = view.felt.spec.regions.find((r) => r.id === `spot:${view.seat}`).shape;
    const p = engine.camera.position.clone().set(shape.x, view.felt.mesh.position.y, shape.z);
    table.stage.root.localToWorld(p);
    p.project(engine.camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  });

const total = (cards) => {
  let sum = 0;
  let ace = false;
  for (const c of cards) {
    const v = 'A23456789'.includes(c[0]) ? ('A'.includes(c[0]) ? 1 : Number(c[0])) : 10;
    sum += v;
    if (v === 1) ace = true;
  }
  return ace && sum <= 11 ? sum + 10 : sum;
};

const did = { hit: false, stand: false, double: false, split: false };
const shots = [];
const shot = async (name) => {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  shots.push(path);
};

let rounds = 0;
for (; rounds < 90 && !(did.hit && did.stand && did.double && did.split); rounds++) {
  if (rounds === 0) {
    await page.keyboard.press('3'); // the $25 chip
    const at = await circle();
    await page.mouse.click(at.x, at.y);
  } else {
    await page.keyboard.press('r'); // rebet
  }
  // The bet has to reach the server and come back before it shows in the circle.
  await page.waitForFunction(() => {
    const t = window.casino.table.view;
    return t.v?.phase === 'betting' && (t.v.bets[t.seat] ?? 0) > 0;
  }, null, { timeout: 8000 }).catch(async () => {
    throw new Error(`round ${rounds}: bet did not land in the circle: ${JSON.stringify(await state())}`);
  });
  await settle(100);
  await page.keyboard.press('Space');
  await settle(rounds === 0 ? 900 : 300);
  if (rounds === 0) await shot('01-deal');

  for (let step = 0; step < 24; step++) {
    const s = await state();
    if (s.phase !== 'insurance' && s.phase !== 'play') break;
    if (s.insurance) {
      await page.keyboard.press('n');
    } else if (s.actions && s.turn?.seat === s.seat) {
      const hand = s.hands[s.turn.hand];
      if (!did.split && s.moves.includes('split')) {
        await page.keyboard.press('p');
        did.split = true;
        await settle(500);
        await shot('03-split');
        continue;
      } else if (!did.double && did.hit && s.moves.includes('double')) {
        await page.keyboard.press('d');
        did.double = true;
        await settle(200);
        await shot('04-double');
        continue;
      } else if (total(hand.cards) < 17) {
        await page.keyboard.press('h');
        if (!did.hit) {
          did.hit = true;
          await settle(300);
          await shot('02-hit');
          continue;
        }
      } else {
        await page.keyboard.press('s');
        did.stand = true;
      }
    }
    await settle(200);
  }
  await settle(600);
  if (rounds === 0) await shot('05-result');
}
await shot('06-last');
const hud = await page.textContent('.dev-hud').catch(() => '');
const final = await state();
console.log(JSON.stringify({ rounds, did, stack: final.stack, shots, hud, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
if (!did.hit || !did.stand || !did.double || !did.split || errors.length) process.exit(1);
