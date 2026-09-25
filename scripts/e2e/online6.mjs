#!/usr/bin/env node
// Headless check of Coinflip, Wheel, Cases and Diamonds in the dev harness (the camera already
// sits at the desk's pcPose there): buy in, play against the real server through the page's own
// buttons and keys, and screenshot each game at rest, mid-round and after. Each page also checks
// what it shows against what the server sent (the chips, the result), and a page error fails the
// run.
// Usage: node scripts/e2e/online6.mjs [port] [outDir] [games...]   (PORT_BASE=<port> npm run dev first)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6300', outDir = '/tmp/online6', ...only] = process.argv.slice(2);
const games = only.length ? only : ['coinflip', 'wheel', 'cases', 'diamonds'];
// Player names stay short (the name rules cap them): online6_e2e_cf and so on.
const CODE = { coinflip: 'cf', wheel: 'wh', cases: 'ca', diamonds: 'dm' };
mkdirSync(outDir, { recursive: true });

// On a Mac the GPU draws the page at full speed; elsewhere, or with GL=swiftshader, the software path.
const gl = process.env.GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const glArgs = gl === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: [...glArgs, `--explicitly-allowed-ports=${port},${Number(port) + 1}`] });
const report = [];
let failed = false;
const money = (c) => '$' + Math.floor(c / 100).toLocaleString('en-US') + (c % 100 ? '.' + String(c % 100).padStart(2, '0') : '');

// `desks` as the only game stands the four desks in a row, as the lounge will, and shoots them
// from across the floor and each monitor's attract picture up close.
if (games[0] === 'desks') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=coinflip&name=online6_e2e_dk`);
  if (await page.waitForSelector('.pass-input', { timeout: 2500 }).catch(() => null)) await page.fill('.pass-input', 'casino-dev');
  await page.waitForSelector('.modal .btn', { timeout: 30000 }).catch(() => null);
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { engine, table } = window.casino;
    // The harness's own desk (Coinflip) loses its page; Wheel, Cases and Diamonds stand to its right.
    table.view.dispose();
    const { GAMES } = await import('/casino/src/games/index.ts');
    const anchor = table.stage.anchor;
    ['wheel', 'cases', 'diamonds'].forEach((id, i) => {
      const m = GAMES[id].createModel({ variant: '', quality: engine.quality });
      m.position.set(anchor.position.x + 1.35 * (i + 1), 0, anchor.position.z);
      engine.scene.add(m);
    });
    engine.camera.position.set(2.1, 1.75, 3.1);
    engine.camera.lookAt(2.0, 0.85, -0.3);
  });
  await page.waitForTimeout(800);
  const shots = [`${outDir}/desks-row.png`];
  await page.screenshot({ path: shots[0] });
  for (let i = 0; i < 4; i++) {
    await page.evaluate((x) => {
      const { engine } = window.casino;
      engine.camera.position.set(x + 0.3, 1.2, 0.55);
      engine.camera.lookAt(x, 1.06, -0.47);
    }, 1.35 * i);
    await page.waitForTimeout(300);
    const path = `${outDir}/desk-${['coinflip', 'wheel', 'cases', 'diamonds'][i]}.png`;
    await page.screenshot({ path });
    shots.push(path);
  }
  console.log(JSON.stringify({ shots, errors }, null, 1));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}

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
        if (msg.t === 'ev' || msg.t === 'err' || msg.t === 'table' || msg.t === 'seat') frames.push(msg);
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
  const { page, errors, frames } = await open(game, `online6_e2e_${CODE[game]}`);
  const shots = [];
  const shot = async (name) => {
    const path = `${outDir}/${game}-${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
  };
  const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);
  const events = (type) => frames.flatMap((m) => (m.t === 'ev' ? m.events.filter((e) => e.type === type) : []));
  const views = () => frames.filter((m) => m.t === 'ev' || m.t === 'table').map((m) => m.view);
  const lastStack = () => frames.filter((m) => m.t === 'seat' || m.t === 'table').map((m) => (m.t === 'seat' ? m.stack : m.you.stack)).at(-1);
  const check = (ok, what) => {
    if (!ok) {
      failed = true;
      errors.push(`check failed: ${what}`);
    }
  };
  const settle = (ms = 1200) => page.waitForTimeout(ms);
  const setBet = async (dollars) => {
    await page.fill('.os-bet-input', String(dollars));
    await page.press('.os-bet-input', 'Enter');
  };
  /** The chips at the top of the page match the seat's stack on the server. */
  const checkChips = async () => {
    const shown = await text('.os-stack-value');
    check(shown === money(lastStack()), `chips shown ${shown} = the server's ${money(lastStack())}`);
    return shown;
  };
  const out = { game, shots, errors, notes: [] };
  await shot('0-idle');

  if (game === 'coinflip') {
    await setBet(10);
    await page.click('.os-side .os-seg button:has-text("Tails")');
    // Bet, then call again while the calls come right, up to three in a row.
    await page.click('.os-action.go');
    await settle(1300);
    for (let i = 0; i < 2 && views().at(-1)?.phase === 'playing'; i++) {
      await page.keyboard.press(i % 2 ? 't' : 'h');
      await page.keyboard.press('Space');
      await settle(1300);
    }
    await shot('1-streak');
    const flips = events('flip');
    out.notes.push(`flips: ${flips.map((f) => `${f.call}->${f.side}${f.win ? ` ${f.mult / 100}x` : ' WRONG'}`).join(', ')}`);
    check(flips.length > 0 && flips.every((f) => f.win === (f.call === f.side)), 'a flip wins exactly when the call matches');
    if (views().at(-1)?.phase === 'playing') {
      await page.click('.os-action.cash');
      await settle(1400);
      await shot('2-cashed-out');
    } else await shot('2-wrong-call');
    const over = events('over').at(-1);
    check(!!over && (over.outcome === 'bust' ? over.payout === 0 : over.payout === (over.bet / 100) * over.mult), 'the round paid its streak exactly');
    out.notes.push(`over: ${over?.outcome} after ${over?.streak} at ${over?.mult / 100}x paid ${money(over?.payout ?? 0)}`);
    // Ride for a long streak (up to five calls) a few times, to see the ladder climb.
    for (let r = 0; r < 6; r++) {
      await page.keyboard.press('Space');
      await settle(1200);
      for (let i = 0; i < 4 && views().at(-1)?.phase === 'playing'; i++) {
        await page.keyboard.press('r');
        await settle(1200);
      }
      if (views().at(-1)?.phase === 'playing') {
        await shot('3-long-streak');
        await page.keyboard.press('c');
        await settle(1300);
        break;
      }
    }
    await settle(600);
    await shot('4-after');
    out.notes.push(`rounds ${events('over').length}; chips shown ${await checkChips()}`);
  }

  if (game === 'wheel') {
    await setBet(10);
    await page.click('.os-side .os-seg button:has-text("Medium")');
    await page.click('.os-side .os-seg button:has-text("30")');
    await page.click('.os-action.go');
    await settle(1200);
    await shot('1-spinning');
    await settle(2600);
    await shot('2-landed');
    const spin = events('spin').at(-1);
    check(!!spin && spin.risk === 'medium' && spin.segments === 30, 'the spin went out on Medium, 30');
    const hub = await text('.wh-hub-mult');
    check(hub === `${(spin.mult / 100).toFixed(2)}×`, `the hub shows the server's ${spin.mult / 100}× (${hub})`);
    const hit = await page.$eval('.wh-key-item.hit', (e) => Number(e.dataset.mult)).catch(() => null);
    check(hit === spin.mult, 'the key lights the multiplier that came up');
    out.notes.push(`spin: segment ${spin.segment} ${spin.mult / 100}x paid ${money(spin.payout)}`);
    // High risk, 50 segments, until something pays or eight spins.
    await page.click('.os-side .os-seg button:has-text("High")');
    await page.click('.os-side .os-seg button:has-text("50")');
    await settle(300);
    await shot('3-high-50');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Space');
      await settle(3600);
      if (events('spin').at(-1).payout > 0) break;
    }
    await shot('4-high-after');
    await page.hover('.wh-key-item >> nth=1');
    await settle(300);
    await shot('5-key-card');
    // Low risk, 10 segments, a few spins.
    await page.click('.os-side .os-seg button:has-text("Low")');
    await page.click('.os-side .os-seg button:has-text("10")');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Space');
      await settle(3500);
    }
    await shot('6-low-10');
    const spins = events('spin');
    check(spins.every((s) => s.payout === (s.bet / 100) * s.mult), 'every spin paid its multiplier exactly');
    out.notes.push(`spins ${spins.length}: ${spins.map((s) => `${s.risk[0]}${s.segments} ${s.mult / 100}x`).join(', ')}; chips shown ${await checkChips()}`);
  }

  if (game === 'cases') {
    await setBet(25);
    await page.click('.os-side .ca-cases button:has-text("High Roller")');
    await settle(300);
    await shot('1-high-roller');
    await page.click('.os-action.go');
    await settle(1800);
    await shot('2-reel-running');
    await settle(4600);
    await shot('3-opened');
    const open = events('open').at(-1);
    check(!!open && open.case === 'highroller' && open.bet === 2500 && !open.quick, 'a High Roller case went out at $25');
    const won = await page.$eval('.ca-card.won', (e) => Number(e.dataset.item)).catch(() => null);
    check(won === open.item, `the reel stopped on the server's item (${won} = ${open.item})`);
    // The marker sits over the winning card.
    const centred = await page.evaluate(() => {
      const m = document.querySelector('.ca-marker').getBoundingClientRect();
      const c = document.querySelector('.ca-card.won').getBoundingClientRect();
      const x = m.left + m.width / 2;
      return x > c.left && x < c.right;
    });
    check(centred, 'the marker is over the winning card');
    out.notes.push(`opened: item ${open.item} ${open.mult / 100}x paid ${money(open.payout)}; result line "${await text('.ca-result')}"`);
    // Quick opens across the other cases.
    await page.click('.os-side .os-seg button:has-text("Quick open")');
    for (const name of ['Starter', 'Classic', 'Vault']) {
      await page.click(`.os-side .ca-cases button:has-text("${name}")`);
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Space');
        await settle(1700);
      }
    }
    await shot('4-quick-vault');
    const opens = events('open');
    check(opens.slice(1).every((o) => o.quick && o.restAt - 0 > 0), 'quick opens went out quick');
    check(opens.every((o) => o.payout === (o.bet / 100) * o.mult), 'every case paid its item exactly');
    out.notes.push(`opens ${opens.length}: ${opens.map((o) => `${o.case} ${o.mult / 100}x`).join(', ')}; chips shown ${await checkChips()}`);
  }

  if (game === 'diamonds') {
    await setBet(10);
    await page.click('.os-action.go');
    await settle(450);
    await shot('1-dropping');
    await settle(1200);
    await shot('2-hand');
    const d = events('draw').at(-1);
    check(!!d && d.gems.length === 5, 'five gems came back');
    const shown = await page.$$eval('.dm-slot .dm-gem', (g) => g.map((x) => x.title));
    const NAMES = ['Emerald', 'Sapphire', 'Ruby', 'Amethyst', 'Topaz', 'Aquamarine', 'Rose'];
    check(JSON.stringify(shown) === JSON.stringify(d.gems.map((c) => NAMES[c])), `the page shows the server's gems (${shown.join(' ')})`);
    const hit = await page.$eval('.dm-pay.hit .dm-pay-name', (e) => e.textContent).catch(() => null);
    out.notes.push(`hand ${d.gems.join('')} ${d.pattern} ${d.mult / 100}x paid ${money(d.payout)}; paytable lit "${hit}"`);
    // Play on until a hand of two pair or better (or twenty hands).
    for (let i = 0; i < 20; i++) {
      const p = events('draw').at(-1).pattern;
      if (!['none', 'pair'].includes(p)) break;
      await page.keyboard.press('Space');
      await settle(1700);
    }
    await shot('3-better-hand');
    const hands = events('draw');
    check(hands.every((h) => h.payout === (h.bet / 100) * h.mult), 'every hand paid its pattern exactly');
    out.notes.push(`hands ${hands.length}: ${hands.map((h) => h.pattern).join(', ')}; chips shown ${await checkChips()}`);
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
