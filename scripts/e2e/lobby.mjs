#!/usr/bin/env node
// Headless check of the lobby panels on their dev page, with separate browser contexts as separate
// players. Alice chooses Multiplayer and starts a private table; Bob joins it with the PIN Alice's
// party panel shows; both sit down; Alice makes the table public and Carol finds it on the live
// list. Screenshots of each step go to outDir.
// Usage: node scripts/e2e/lobby.mjs [port] [outDir] [tag]   (PORT_BASE=<port> npm run dev first)
// Players are alice_<tag>, bob_<tag> and carol_<tag> (tag defaults to e2e), so reruns log back in
// instead of creating accounts: the API allows only a few new accounts per hour from one address.

import { chromium } from 'playwright';

const [port = '5173', outDir = '/tmp', run = 'e2e'] = process.argv.slice(2);
const page0 = `http://localhost:${port}/casino/src/ui/lobby/dev.html`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const shots = [];
const steps = [];
let expect404 = false;

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    // The browser logs the deliberate wrong PIN's 404 as a failed resource.
    if (m.type() === 'error' && !(expect404 && m.text().includes('404'))) errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`${page0}?game=blackjack&name=${name}_${run}`);
  await page.waitForSelector('.lobby-choice', { timeout: 20_000 });
  // let the room render and the live count arrive
  await page.waitForFunction(() => document.querySelector('.lobby-choice-aside')?.textContent !== '…', null, { timeout: 10_000 });
  await page.waitForTimeout(400);
  return page;
}

async function shot(page, file) {
  const path = `${outDir}/${file}`;
  await page.screenshot({ path });
  shots.push(path);
}

const partyNames = (page) => page.$$eval('.party-member .party-name', (els) => els.map((e) => e.firstChild?.textContent ?? ''));

try {
  const alice = await player('alice');
  await shot(alice, 'lobby-1-choose.png');

  await alice.keyboard.press('m');
  await alice.waitForSelector('.lobby-pin-input');
  await alice.waitForTimeout(250);
  await shot(alice, 'lobby-2-browse.png');

  await alice.click('.lobby-actions .btn:has-text("Private")');
  await alice.waitForSelector('.party-pin-digits');
  const pin = (await alice.textContent('.party-pin-digits .lb-seg-lit')).trim();
  const tableId = await alice.evaluate(() => window.lobbyDev.tableId);
  if (!/^\d{4}$/.test(pin)) throw new Error(`no PIN on Alice's panel: "${pin}"`);
  steps.push(`alice created private table ${tableId}, PIN ${pin}`);

  const bob = await player('bob');
  await bob.click('.lobby-choice:has-text("Multiplayer")');
  await bob.waitForSelector('.lobby-pin-input');
  // A wrong PIN first: the panel says so and stays open.
  const wrong = pin === '0000' ? '0001' : '0000';
  expect404 = true;
  await bob.fill('.lobby-pin-input', wrong);
  await bob.keyboard.press('Enter');
  await bob.waitForSelector('.lobby-error:not([hidden])');
  await bob.waitForTimeout(100);
  expect404 = false;
  steps.push(`bob tried ${wrong}: "${(await bob.textContent('.lobby-error')).trim()}"`);
  await shot(bob, 'lobby-2b-bad-pin.png');
  // The real one typed with focus elsewhere: digits find the PIN box on their own.
  await bob.fill('.lobby-pin-input', '');
  await bob.click('.lobby-bar');
  await bob.keyboard.type(pin);
  const typed = await bob.inputValue('.lobby-pin-input');
  if (typed !== pin) throw new Error(`typed PIN landed as "${typed}"`);
  await bob.keyboard.press('Enter');
  await bob.waitForSelector('.party-member:nth-child(2)');
  await alice.waitForFunction(() => document.querySelectorAll('.party-member').length === 2);
  steps.push(`bob joined; alice sees ${JSON.stringify(await partyNames(alice))}`);

  for (const p of [alice, bob]) {
    await p.click('.party-row .btn:has-text("Sit down")');
    await p.waitForSelector('.modal input[type=number]');
    await p.fill('.modal input[type=number]', '1000');
    await p.click('.modal .btn.primary');
  }
  const bothSeated = () => [...document.querySelectorAll('.party-status')].filter((e) => e.textContent === '$1,000').length === 2;
  await alice.waitForFunction(bothSeated, null, { timeout: 10_000 });
  await bob.waitForFunction(bothSeated, null, { timeout: 10_000 });
  await alice.waitForTimeout(300);
  steps.push('both sat down with $1,000');
  await shot(alice, 'lobby-3-alice-leader.png');
  await shot(bob, 'lobby-4-bob-member.png');

  // Public: the PIN goes away for everyone and the table shows up on the list.
  await alice.click('.party-seg button:has-text("Public")');
  await bob.waitForFunction(() => !document.querySelector('.party-pin') && document.querySelector('.party-vis')?.textContent === 'Public');
  steps.push('alice made it public; bob sees it');
  const carol = await player('carol');
  await carol.click('.lobby-choice:has-text("Multiplayer")');
  await carol.waitForSelector(`.lobby-row[data-table="${tableId}"]`, { timeout: 10_000 });
  const row = (await carol.textContent(`.lobby-row[data-table="${tableId}"]`)).replace(/\s+/g, ' ').trim();
  steps.push(`carol sees on the list: "${row}"`);
  await carol.waitForTimeout(250);
  await shot(carol, 'lobby-5-carol-list.png');

  // Start: the panel folds away for the game.
  await alice.click('.party-row .btn:has-text("Start")');
  await bob.waitForSelector('.party.collapsed');
  await bob.waitForTimeout(250);
  steps.push('alice started; bob\'s panel folded');
  await shot(bob, 'lobby-6-bob-started.png');
} catch (err) {
  errors.push(`script: ${err?.message ?? err}`);
}

console.log(JSON.stringify({ steps, shots, errors: errors.slice(0, 12) }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
