#!/usr/bin/env node
// v6 invite6: invites through the game proper, with two and three players in their own browser
// contexts.
//   1. public table, by name, joined from the floor: A opens a public Blackjack lobby, invites B
//      from the party panel's picker; B's card shows on the floor; J takes B to the table.
//   2. private table, everyone, joined from another table: C sits at a single-player roulette
//      wheel with chips down; A (now at a private Baccarat lobby) invites everyone; B dismisses;
//      C joins, is asked first, leaves roulette (chips home) and lands at A's private table
//      without ever typing its PIN.
//   3. do not disturb: B turns invites off in Settings; A's invite says B isn't taking them.
// Screenshots of each step go to the out dir.
// Usage: node scripts/e2e/invite6.mjs [port] [outDir]   (PORT_BASE=<port> npm run dev first)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6370', out = '/tmp/casino-invite6'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const errors = [];
const steps = [];
const log = (s) => {
  steps.push(s);
  console.log(new Date().toISOString().slice(11, 19), s);
};
const check = (ok, what) => {
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) errors.push(what);
};

const browser = process.env.GPU === '1'
  ? await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
  : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((q) => {
    localStorage.setItem('casino.quality', q);
    // each run starts taking invites, whatever the last one left
    localStorage.setItem('casino.invites.dnd', '0');
  }, process.env.QUALITY ?? 'low');
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`http://localhost:${port}/casino/`);
  await page.waitForSelector('.name-input', { timeout: 180_000 });
  await page.fill('.name-input', name);
  await page.fill('.pass-input', 'casino-dev');
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else {
    await page.click('.menu-item >> nth=0');
  }
  await page.waitForSelector('.hud', { timeout: 20_000 });
  const id = await page.evaluate(() => window.casino.session.profile.id);
  return { page, name, id };
}

const shot = (p, file) => p.page.screenshot({ path: `${out}/${file}.png` });

async function openLobby(p, station, kind) {
  await p.page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, station);
  await p.page.waitForSelector('.lobby-choice', { timeout: 10_000 });
  await p.page.keyboard.press('m');
  await p.page.waitForSelector('.lobby-actions .btn', { timeout: 10_000 });
  await p.page.click(`.lobby-actions .btn:has-text("${kind}")`);
  await p.page.waitForSelector('.party-invite', { timeout: 15_000 });
}

async function leave(p) {
  await p.page.evaluate(() => window.casino.app.escape());
  const sure = await p.page.waitForSelector('.modal .btn.primary', { timeout: 2000 }).catch(() => null);
  if (sure) await sure.click();
  await p.page.waitForFunction(() => !window.casino.app.table && !window.casino.world.seated, null, { timeout: 15_000 });
}

async function me(p) {
  return p.page.evaluate(async () => {
    const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` } });
    return (await r.json()).profile;
  });
}

/** Tick these players in the open picker and send. */
async function inviteByName(p, names) {
  for (const n of names) await p.page.click(`.inv-row:has(.inv-name:text-is("${n}"))`);
  await p.page.click('.inv-foot .btn.primary');
}

const station = (p) => p.page.evaluate(() => window.casino.world.seated?.id ?? null);
const tableOf = (p) => p.page.evaluate(() => window.casino.app.table?.session.target ?? null);

try {
  const a = await player('invite6_e2e_a');
  const b = await player('invite6_e2e_b');
  log(`logged in ${a.name} (${a.id}) and ${b.name} (${b.id})`);
  await a.page.waitForFunction((id) => window.casino.app.link?.players.has(id), b.id, { timeout: 15_000 });

  // --- 1. a public table, by name, joined from the floor --------------------------------------
  await openLobby(a, 'bj-1', 'Public');
  await shot(a, 'invite6-1-party');
  await a.page.click('.party-invite');
  await a.page.waitForSelector('.inv-picker .inv-row', { timeout: 5000 });
  const offered = await a.page.$$eval('.inv-row .inv-name', (els) => els.map((e) => e.textContent));
  check(offered.includes(b.name) && !offered.includes(a.name), `the picker offers ${b.name} and not you (${offered.join(', ')})`);
  // search narrows the list
  await a.page.fill('.inv-search-input', b.name.slice(-3));
  const found = await a.page.$$eval('.inv-row .inv-name', (els) => els.map((e) => e.textContent));
  check(found.includes(b.name), `searching "${b.name.slice(-3)}" finds ${b.name}`);
  await shot(a, 'invite6-1-picker');
  await inviteByName(a, [b.name]);
  await a.page.waitForSelector('.inv-note:not([hidden])', { timeout: 5000 });
  const note = await a.page.textContent('.inv-note');
  check(/Invited/.test(note), `the picker says "${note}"`);
  await a.page.waitForSelector('.inv-status.sent', { timeout: 3000 });
  await shot(a, 'invite6-1-sent');

  await b.page.waitForSelector('.inv-card', { timeout: 10_000 });
  const card = await b.page.textContent('.inv-card');
  check(card.includes(a.name) && card.includes('Blackjack') && /seats? left/.test(card), `B's card: "${card.replace(/\s+/g, ' ')}"`);
  await shot(b, 'invite6-1-card-floor');
  await b.page.keyboard.press('j');
  await b.page.waitForFunction(() => window.casino.app.table?.session.target.kind === 'lobby', null, { timeout: 20_000 });
  await a.page.waitForFunction(() => document.querySelectorAll('.party-member').length === 2, null, { timeout: 15_000 });
  check((await station(b)) === 'bj-1', `J took ${b.name} to bj-1 (${await station(b)})`);
  check(!(await b.page.$('.inv-card')), 'the card is gone once joined');
  await b.page.waitForTimeout(1500);
  await shot(b, 'invite6-1-joined-b');
  await shot(a, 'invite6-1-joined-a');

  // --- 2. a private table, everyone, joined from another table -----------------------------------
  const c = await player('invite6_e2e_c');
  log(`logged in ${c.name} (${c.id})`);
  await leave(a);
  await leave(b);
  // C at a single-player roulette wheel with chips down
  await c.page.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === 'rl-us'));
  });
  await c.page.waitForSelector('.lobby-choice', { timeout: 10_000 });
  await c.page.keyboard.press('s');
  await c.page.waitForFunction(() => window.casino.app.table?.session.snapshot, null, { timeout: 20_000 });
  await c.page.evaluate(() => window.casino.app.table.session.link.buyIn(50_000));
  await c.page.waitForFunction(() => window.casino.app.table?.seated, null, { timeout: 15_000 });
  const cBefore = await me(c);
  log(`${c.name} bought in at roulette: balance $${cBefore.balance / 100}, on tables $${cBefore.inPlay / 100}`);

  await openLobby(a, 'bc-1', 'Private');
  const pin = (await a.page.textContent('.party-pin-digits .lb-seg-lit')).trim();
  await a.page.click('.party-invite');
  await a.page.waitForSelector('.inv-picker', { timeout: 5000 });
  await a.page.waitForFunction((n) => [...document.querySelectorAll('.inv-row .inv-name')].some((e) => e.textContent === n), c.name, { timeout: 10_000 });
  await shot(a, 'invite6-2-picker-private');
  await a.page.click('.inv-foot .btn:has-text("Invite everyone")');
  await a.page.waitForSelector('.inv-note:not([hidden])', { timeout: 5000 });
  // a rerun inside three minutes of the last one waits out the floor's "everyone" limit first
  if (/a moment ago/.test(await a.page.textContent('.inv-note'))) {
    log(`waiting for "Invite everyone" (the last run used it): ${await a.page.textContent('.inv-foot .btn:not(.primary)')}`);
    await a.page.waitForSelector('.inv-foot .btn:has-text("Invite everyone"):not(:disabled)', { timeout: 200_000 });
    await c.page.evaluate(() => window.casino.app.link.send({ t: 'here' }));
    await b.page.evaluate(() => window.casino.app.link.send({ t: 'here' }));
    await a.page.click('.inv-foot .btn:has-text("Invite everyone")');
    await a.page.waitForFunction(() => /Invited/.test(document.querySelector('.inv-note')?.textContent ?? ''), null, { timeout: 5000 });
  }
  log(`everyone: "${await a.page.textContent('.inv-note')}"; button "${await a.page.textContent('.inv-foot .btn:not(.primary)')}"`);
  check(/Everyone again in/.test(await a.page.textContent('.inv-foot .btn:not(.primary)')), '"Invite everyone" waits a few minutes after use');

  await b.page.waitForSelector('.inv-card', { timeout: 10_000 });
  await c.page.waitForSelector('.inv-card', { timeout: 10_000 });
  const cCard = await c.page.textContent('.inv-card');
  check(cCard.includes('Baccarat') && cCard.includes('Private') && !cCard.includes(pin), `C's card names the private table without its PIN: "${cCard.replace(/\s+/g, ' ')}"`);
  await shot(c, 'invite6-2-card-at-table');
  // B says no: quietly
  await shot(b, 'invite6-2-card-b');
  // on the floor the mouse looks around; Esc (here: releaseMouse) frees it to click the card
  const captured = await b.page.evaluate(() => window.casino.world.mouseCaptured);
  await b.page.evaluate(() => window.casino.world.releaseMouse());
  await b.page.click('.inv-card .btn.ghost', { timeout: 5000 });
  log(`B dismissed the card (the mouse was ${captured ? 'captured' : 'free'})`);
  check(!(await b.page.$('.inv-card')), 'Dismiss clears the card');

  await c.page.click('.inv-card .btn.primary');
  await c.page.waitForSelector('.modal', { timeout: 5000 });
  await shot(c, 'invite6-2-confirm');
  await c.page.click('.modal .btn.primary');
  await c.page.waitForFunction(() => window.casino.app.table?.session.target.kind === 'lobby', null, { timeout: 30_000 });
  await a.page.waitForFunction(() => document.querySelectorAll('.party-member').length === 2, null, { timeout: 15_000 });
  const ct = await tableOf(c);
  check((await station(c)) === 'bc-1' && ct.pin === pin, `C is at A's private table at bc-1 (${await station(c)}, PIN from the invite ${ct.pin === pin})`);
  await c.page.waitForTimeout(1500);
  await shot(c, 'invite6-2-joined-c');
  await shot(a, 'invite6-2-joined-a');
  // C's roulette chips came home
  let cAfter = await me(c);
  for (let i = 0; i < 10 && cAfter.tables.some((t) => t.game === 'roulette'); i++) {
    await c.page.waitForTimeout(1500);
    cAfter = await me(c);
  }
  check(!cAfter.tables.some((t) => t.game === 'roulette'), `C's roulette chips went home (balance $${cAfter.balance / 100})`);

  // --- 3. do not disturb ------------------------------------------------------------------------
  await b.page.click('.hud-btn[aria-label="Settings"]');
  await b.page.waitForSelector('.settings-sheet', { timeout: 5000 });
  await b.page.click('.set-row:has(.set-label:text-is("Invites")) button:has-text("Do not disturb")');
  await b.page.waitForTimeout(300);
  await shot(b, 'invite6-3-settings');
  await b.page.keyboard.press('Escape');
  await a.page.fill('.inv-search-input', '');
  await a.page.waitForFunction((n) => [...document.querySelectorAll('.inv-row .inv-name')].some((e) => e.textContent === n), b.name, { timeout: 10_000 });
  await inviteByName(a, [b.name]);
  await a.page.waitForFunction(() => /taking invites/.test(document.querySelector('.inv-note')?.textContent ?? ''), null, { timeout: 5000 });
  check(true, `A hears: "${await a.page.textContent('.inv-note')}"`);
  await b.page.waitForTimeout(800);
  check(!(await b.page.$('.inv-card')), 'no card reaches B while do not disturb is on');
  await shot(a, 'invite6-3-dnd');

  for (const p of [a, c]) await leave(p);
} catch (err) {
  errors.push(`script: ${err?.message ?? err}`);
}

console.log(JSON.stringify({ steps, errors: errors.slice(0, 20) }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
