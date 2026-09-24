#!/usr/bin/env node
// Headless check of Plinko, Dice, Limbo and Keno in the dev harness (the camera already sits at
// the desk's pcPose there): buy in, play against the real server through the page's own buttons,
// and screenshot each game at rest, mid-round and after. Each page also checks what it shows
// against what the server sent (the chips, the last result), and a page error fails the run.
// `desks` as the only game instead stands the four desks in a row, as the lounge will, and shoots
// their attract pictures and chair colours from the floor.
// Usage: node scripts/e2e/online-a.mjs [port] [outDir] [games... | desks]

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6000', outDir = '/tmp/online-a', ...only] = process.argv.slice(2);
const games = only.length ? only : ['plinko', 'dice', 'limbo', 'keno'];
mkdirSync(outDir, { recursive: true });

// On a Mac the GPU draws the page at full speed (SwiftShader manages about one frame a second
// here, which slows every animation tenfold); elsewhere, or with GL=swiftshader, the software path.
// Chromium refuses port 6000 (X11) unless told otherwise, and this slice's dev stack lives there.
const gl = process.env.GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const glArgs = gl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: [...glArgs, `--explicitly-allowed-ports=${port},${Number(port) + 1}`] });
const report = [];
let failed = false;

if (games[0] === 'desks') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=plinko&name=oa_desks`);
  await page.waitForSelector('.modal .btn', { timeout: 30000 }).catch(() => null);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { engine, table } = window.casino;
    // The harness's own desk (Plinko) loses its page; Dice, Limbo and Keno stand to its right.
    table.view.dispose();
    const { GAMES } = await import('/casino/src/games/index.ts');
    const anchor = table.stage.anchor;
    ['dice', 'limbo', 'keno'].forEach((id, i) => {
      const m = GAMES[id].createModel({ variant: '', quality: engine.quality });
      m.position.set(anchor.position.x + 1.35 * (i + 1), 0, anchor.position.z);
      engine.scene.add(m);
    });
    engine.camera.position.set(2.1, 1.75, 3.1);
    engine.camera.lookAt(2.0, 0.85, -0.3);
  });
  await page.waitForTimeout(600);
  const path = `${outDir}/desks-row.png`;
  await page.screenshot({ path });
  await page.evaluate(() => {
    const { engine } = window.casino;
    engine.camera.position.set(0.55, 1.3, 1.25);
    engine.camera.lookAt(0.05, 1.0, -0.47);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/desks-plinko.png` });
  console.log(JSON.stringify({ shots: [path, `${outDir}/desks-plinko.png`], errors }, null, 1));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

for (const game of games) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const frames = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        if (msg.t === 'ev' || msg.t === 'err') frames.push(msg);
      } catch {}
    }),
  );
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=${game}&name=oa_${game}`);
  if (await page.waitForSelector('.pass-input', { timeout: 2500 }).catch(() => null)) await page.fill('.pass-input', 'casino-dev');
  // A seat kept from an earlier run (the page closed without leaving) comes back seated, with no
  // buy-in to answer.
  if (await page.waitForSelector('.modal input[type=number]', { timeout: 10000 }).catch(() => null)) {
    await page.fill('.modal input[type=number]', '2000');
    await page.click('.modal .btn.primary');
  }
  await page.waitForTimeout(1500);
  const shots = [];
  const shot = async (name) => {
    const path = `${outDir}/${game}-${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
  };
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);
  const events = (type) => frames.flatMap((m) => (m.t === 'ev' ? m.events.filter((e) => e.type === type) : []));
  const check = (ok, what) => {
    if (!ok) {
      failed = true;
      errors.push(`check failed: ${what}`);
    }
  };
  await shot('0-idle');
  const out = { game, shots, errors, notes: [] };

  if (game === 'plinko') {
    // Rows 12, High; a $3 bet; five balls dropped quickly so several are in the air at once.
    await page.click('.os-side .os-seg button:has-text("High")');
    await page.click('.os-side .os-seg.dense button:has-text("12")');
    await page.fill('.os-bet-input', '3');
    await page.press('.os-bet-input', 'Enter');
    for (let i = 0; i < 5; i++) {
      await page.click('.os-action.go');
      await page.waitForTimeout(140);
    }
    await page.waitForTimeout(250);
    await shot('1-in-flight');
    out.notes.push(`in flight: ${await page.$$eval('.pk-bin', (b) => b.length)} bins, locked rows ${await page.$eval('.os-seg.dense button', (b) => b.disabled)}`);
    await page.waitForTimeout(3200);
    await shot('2-landed');
    const drops = events('drop');
    check(drops.length === 5, `5 drops settled (got ${drops.length})`);
    check(drops.every((d) => d.rows === 12 && d.risk === 'high' && d.bet === 300 && d.path.length === 12), 'drops carry the chosen board and bet');
    const tiles = await page.$$eval('.pk-result', (t) => t.map((x) => x.textContent));
    out.notes.push(`results column: ${tiles.join(' ')}; server bins ${drops.map((d) => d.bin).join(',')}`);
    const last = drops.at(-1);
    check(last && (await text('.os-stack-value')) === money(last.stack), `chips shown match the server (${await text('.os-stack-value')} vs ${last && money(last.stack)})`);
    // Hover a bin for its card.
    await page.hover('.pk-bin >> nth=0');
    await page.waitForTimeout(150);
    await shot('3-bin-card');
    out.notes.push(`bin card: ${await text('.pk-card')}`);
    // 16 rows, Medium, one more ball to watch mid-board.
    await page.mouse.move(5, 5);
    await page.click('.os-side .os-seg button:has-text("Medium")');
    await page.click('.os-side .os-seg.dense button:has-text("16")');
    await page.keyboard.press('Space');
    await page.waitForTimeout(1100);
    await shot('4-sixteen-rows');
    await page.waitForTimeout(2500);
  }

  if (game === 'dice') {
    await page.fill('.os-bet-input', '5');
    await page.press('.os-bet-input', 'Enter');
    // Type a win chance of 25%, then swap to roll over.
    await page.fill('.dc-fields .os-num >> nth=2 >> input', '25');
    await page.press('.dc-fields .os-num >> nth=2 >> input', 'Enter');
    await page.click('.dc-fields .os-num-btn');
    await page.waitForTimeout(200);
    out.notes.push(`after 25% + swap: ${await page.$$eval('.dc-fields input', (i) => i.map((x) => x.value).join(' | '))}`);
    await shot('1-set');
    for (let i = 0; i < 6; i++) {
      await page.click('.os-action.go');
      await page.waitForTimeout(700);
    }
    await shot('2-rolled');
    const rolls = events('roll');
    check(rolls.length === 6, `6 rolls settled (got ${rolls.length})`);
    const last = rolls.at(-1);
    check(last && (await text('.dc-marker')) === (last.roll / 100).toFixed(2), `marker shows the roll (${await text('.dc-marker')} vs ${last && (last.roll / 100).toFixed(2)})`);
    check(last && (await text('.os-stack-value')) === money(last.stack), 'chips shown match the server');
    // Drag the slider to about 80 and roll under.
    const track = await page.$('.dc-track');
    const box = await track.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.click('.dc-fields .os-num-btn');
    await page.waitForTimeout(200);
    out.notes.push(`after drag + swap: ${await page.$$eval('.dc-fields input', (i) => i.map((x) => x.value).join(' | '))}`);
    await page.keyboard.press('Space');
    await page.waitForTimeout(160);
    await shot('3-sliding');
    await page.waitForTimeout(700);
    await shot('4-after');
  }

  if (game === 'limbo') {
    await page.fill('.os-bet-input', '2');
    await page.press('.os-bet-input', 'Enter');
    await page.fill('.lb-fields .os-num >> nth=0 >> input', '1.5');
    await page.press('.lb-fields .os-num >> nth=0 >> input', 'Enter');
    await page.waitForTimeout(150);
    out.notes.push(`target 1.5: ${await page.$$eval('.lb-fields input', (i) => i.map((x) => x.value).join(' | '))}`);
    await shot('1-set');
    for (let i = 0; i < 6; i++) {
      await page.click('.os-action.go');
      await page.waitForTimeout(1000);
    }
    await shot('2-played');
    const bets = events('result');
    check(bets.length === 6, `6 bets settled (got ${bets.length})`);
    const last = bets.at(-1);
    check(last && (await text('.lb-number')) === `${(last.result / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`, `big number shows the result (${await text('.lb-number')})`);
    check(last && (await text('.os-stack-value')) === money(last.stack), 'chips shown match the server');
    // A long shot, to watch the count-up.
    await page.fill('.lb-fields .os-num >> nth=1 >> input', '0.5');
    await page.press('.lb-fields .os-num >> nth=1 >> input', 'Enter');
    await page.keyboard.press('Space');
    await page.waitForTimeout(180);
    await shot('3-counting');
    await page.waitForTimeout(1500);
    await shot('4-after');
  }

  if (game === 'keno') {
    await page.fill('.os-bet-input', '4');
    await page.press('.os-bet-input', 'Enter');
    for (const n of [3, 7, 12, 18, 21, 26, 33]) await page.click(`.kn-tile >> nth=${n - 1}`);
    await page.click('.os-side .os-seg button:has-text("High")');
    await page.waitForTimeout(150);
    await shot('1-picked');
    await page.click('.os-action.go');
    await page.waitForTimeout(700);
    await shot('2-drawing');
    await page.waitForTimeout(1600);
    await shot('3-drawn');
    const draws = events('draw');
    check(draws.length === 1, `1 draw settled (got ${draws.length})`);
    const d = draws[0];
    const marked = await page.$$eval('.kn-tile.drawn', (t) => t.map((x) => Number(x.dataset.n)).sort((a, b) => a - b));
    check(d && JSON.stringify(marked) === JSON.stringify([...d.drawn].sort((a, b) => a - b)), `the ten drawn tiles are the server's (${marked.join(',')} vs ${d && d.drawn.join(',')})`);
    const hits = await page.$$eval('.kn-tile.hit', (t) => t.length);
    check(d && hits === d.hits, `hits marked (${hits} vs ${d && d.hits})`);
    check(d && (await text('.os-stack-value')) === money(d.stack), 'chips shown match the server');
    // Auto pick and a few more games.
    await page.click('.os-pair .os-action >> nth=0');
    await page.click('.os-side .os-seg button:has-text("Classic")');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(2300);
    }
    await shot('4-auto');
  }

  // Tips on: reload with the setting saved (the seat is kept, so no buy-in) and read the tip.
  await page.evaluate(() => localStorage.setItem('casino.tips', '1'));
  await page.reload();
  await page.waitForSelector('.os-screen:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(1500);
  if (game === 'keno' && !(await page.$('.kn-tile.picked'))) await page.click('.kn-tile >> nth=4');
  await shot('5-tips');
  out.tip = await text('.tip-line');
  out.tipPick = await page.$$eval('.tip-pick', (els) => els.map((e) => e.textContent || e.className).slice(0, 4));
  await page.evaluate(() => localStorage.setItem('casino.tips', '0'));

  // A showpiece the server can't be asked for, replayed through the view (display only; nothing
  // is paid, and the next snapshot puts the page back): a top pay, for its celebration.
  const stack = await page.evaluate(() => window.casino.table.snapshot.you.stack);
  const showpiece = {
    plinko: [{ type: 'drop', seat: 0, round: 9999, rows: 16, risk: 'high', bet: 100, bin: 0, mult: 100000, payout: 100000, path: new Array(16).fill(0), stack: stack + 99900 }],
    dice: [{ type: 'roll', seat: 0, round: 9999, bet: 100, target: 100, over: false, chance: 100, roll: 42, win: true, payout: 9900, stack: stack + 9800 }],
    limbo: [{ type: 'result', seat: 0, round: 9999, bet: 100, target: 20000, result: 31337, win: true, payout: 20000, stack: stack + 19900 }],
    keno: [{ type: 'draw', seat: 0, round: 9999, bet: 100, risk: 'high', picks: [4, 9, 13, 22, 27, 31, 38, 2, 17, 40], drawn: [2, 9, 13, 17, 4, 27, 31, 38, 22, 36], hits: 9, mult: 80000, payout: 80000, stack: stack + 79900 }],
  }[game];
  await page.evaluate((events) => void window.casino.table.view.onEvents(events, window.casino.table.snapshot.view), showpiece);
  await page.waitForTimeout(game === 'plinko' ? 3100 : game === 'keno' ? 1700 : 900);
  await shot('6-showpiece');

  out.hud = await text('.dev-hud');
  out.foot = await text('.os-foot');
  // Stand up, so the next run starts with a buy-in.
  await page.evaluate(() => window.casino.table.leave());
  await page.waitForTimeout(400);
  out.errors = errors.slice(0, 10);
  if (errors.length) failed = true;
  report.push(out);
  await page.close();
}

function money(c) {
  const whole = Math.floor(Math.abs(c) / 100).toLocaleString('en-US');
  const cents = Math.abs(c) % 100;
  return `${c < 0 ? '−' : ''}$${whole}${cents ? '.' + String(cents).padStart(2, '0') : ''}`;
}

console.log(JSON.stringify(report, null, 1));
await browser.close();
if (failed) process.exit(1);
