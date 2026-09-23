#!/usr/bin/env node
// Live chat with two players in two browser contexts, through the game proper (it needs the chat
// wired into app/boot.ts): floor lines with speech bubbles over the speaker, typing that holds the
// keyboard (W types instead of walking, and a walk key held as the chat opens doesn't walk on),
// unread counts and previews on a closed dock, a bubble next to an emote, hiding chat, a private
// lobby's own room, a phone-width box, and the server's mute. Screenshots go to <outDir>.
// Usage: node scripts/e2e/chat.mjs [port] [outDir]   (PORT_BASE=<port> npm run dev first)
// On a busy machine: BOOT_MS (loading the floor, default 5 min) and STEP_MS (the least any wait allows).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', out = '/tmp/casino-chat'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
// Fixed names so reruns log back in: the API allows only a few new accounts per hour from one address.
const tag = process.env.TAG ?? 'e2e';
const errors = [];
const results = {};
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const check = (ok, what) => {
  if (!ok) errors.push(`check failed: ${what}`);
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** A wait's timeout, stretched on a busy machine (STEP_MS). */
const T = (ms) => ({ timeout: Math.max(ms, Number(process.env.STEP_MS ?? 0)) });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((q) => localStorage.setItem('casino.quality', q), process.env.QUALITY ?? 'low');
  const page = await ctx.newPage();
  page.setDefaultTimeout(Math.max(30_000, Number(process.env.STEP_MS ?? 0)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`http://localhost:${port}/casino/`);
  await page.waitForSelector('.name-input', { timeout: Number(process.env.BOOT_MS ?? 300_000) });
  await page.fill('.name-input', name);
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item', T(20_000));
  await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', T(20_000));
  await page.waitForSelector('.chat-dock', T(10_000));
  const id = await page.evaluate(() => window.casino.session.profile.id);
  return { page, name, id };
}

const shot = (p, file) => p.page.screenshot({ path: `${out}/${file}.png` });
const pose = (p) => p.page.evaluate(() => window.casino.world.player.state());
const moved = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const texts = (p, sel) => p.page.$$eval(sel, (els) => els.map((e) => e.textContent));
const bubbles = (p) => texts(p, '#labels .say-text');

/** Type a line the way a player does: T, the words, Enter. */
async function say(p, text, key = 't') {
  await p.page.keyboard.press(key);
  await p.page.waitForSelector('.chat.typing', T(3000));
  await p.page.keyboard.type(text);
  await p.page.keyboard.press('Enter');
  // The client's own limit is a little under the server's one a second.
  await wait(1_200);
}

async function openLobby(p, station) {
  await p.page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, station);
  await p.page.waitForSelector('.lobby-choice', T(10_000));
  await p.page.keyboard.press('m');
  await p.page.waitForSelector('.lobby-pin-input', T(10_000));
}

try {
  const a = await player(`chat_al_${tag}`);
  const b = await player(`chat_bo_${tag}`);
  log(`logged in ${a.name} (${a.id}) and ${b.name} (${b.id})`);
  await a.page.waitForFunction((id) => window.casino.app.remotes?.drawn?.has(id), b.id, T(15_000));
  await b.page.waitForFunction((id) => window.casino.app.remotes?.drawn?.has(id), a.id, T(15_000));
  // A stands a few steps in front of B, facing B's camera.
  await a.page.evaluate(() => window.casino.world.teleport(0.5, 9.4, 0));
  await wait(1500);

  // --- the floor: a line, the bubble over the speaker, the log --------------------------------
  // Long enough to stay up a while (bubbles last longer for longer lines): screenshots are slow.
  const first = 'Anyone up for blackjack? Two seats open at the table in the middle';
  await say(a, first);
  await b.page.waitForFunction((t) => [...document.querySelectorAll('#labels .say-text')].some((e) => e.textContent === t), first, T(5_000));
  // Read everything first; the previews and bubbles are on timers.
  results.bubbleOnB = await bubbles(b);
  results.bubbleOnA = await bubbles(a);
  results.badgeB = await b.page.textContent('.chat-dock .chat-badge');
  results.peeksB = await texts(b, '.chat-peek');
  const bLog = await texts(b, '#chat-list-floor .chat-line');
  await shot(b, 'chat-1-bubble-b');
  await shot(a, 'chat-1-bubble-a');
  check(results.bubbleOnA.includes(first), 'the speaker sees their own bubble');
  check(bLog.some((t) => t === `${a.name}${first}`), 'the other player has the line in the floor log');
  check(results.badgeB === '1' && results.peeksB.length === 1, 'a closed dock counts the line and previews it');

  // --- typing holds the keyboard ------------------------------------------------------------------
  let p0 = await pose(a);
  await a.page.keyboard.press('Enter');
  await a.page.waitForSelector('.chat.typing');
  await a.page.keyboard.down('KeyW');
  await wait(700);
  await a.page.keyboard.up('KeyW');
  let p1 = await pose(a);
  results.typedW = await a.page.inputValue('.chat-input');
  check(moved(p0, p1) < 0.02 && results.typedW === 'w', 'W types into the line instead of walking');
  await a.page.keyboard.press('Escape');
  await wait(200);
  check(!(await a.page.$('.chat.typing')) && (await a.page.isHidden('.chat-box')), 'Esc stops typing and puts away a box a key opened');
  await a.page.evaluate(() => (document.querySelector('.chat-input').value = ''));
  // A walk key held down as the chat opens must not walk on by itself afterwards.
  await a.page.keyboard.down('KeyW');
  await wait(500);
  await a.page.keyboard.press('KeyT');
  await a.page.keyboard.up('KeyW');
  await wait(100);
  await a.page.keyboard.press('Escape');
  p0 = await pose(a);
  await wait(900);
  p1 = await pose(a);
  results.driftAfterChat = +moved(p0, p1).toFixed(3);
  check(results.driftAfterChat < 0.02, 'a walk key held as the chat opened does not keep walking');
  await a.page.evaluate(() => window.casino.world.teleport(0.5, 9.4, 0));
  await wait(800);

  // --- more lines while B's dock is closed; B opens it and answers ----------------------------------
  await say(a, 'Table in the middle, the one with the green felt');
  await say(a, 'I will open a private lobby');
  await wait(300);
  results.badgeB2 = await b.page.textContent('.chat-dock .chat-badge');
  check(results.badgeB2 === '3', 'the dock counts every unread line');
  await shot(b, 'chat-2-unread-b');
  await b.page.click('.chat-dock');
  await b.page.waitForSelector('.chat-box:not([hidden])');
  check(await b.page.isHidden('.chat-dock .chat-badge'), 'opening the box reads the room');
  await say(b, 'Sure, send me the PIN', 'Enter');
  check(await b.page.isVisible('.chat-box'), 'a box opened with a click stays open after sending');
  await a.page.waitForFunction(() => [...document.querySelectorAll('#labels .say-text')].some((e) => e.textContent === 'Sure, send me the PIN'), null, T(5_000));
  await wait(400);
  await shot(b, 'chat-3-open-b');
  await shot(a, 'chat-3-reply-a');

  // --- a line and an emote together ----------------------------------------------------------------
  await say(a, 'On my way, see you at the table');
  await a.page.evaluate(() => window.casino.app.link.emote('wave'));
  results.lifted = await b.page
    .waitForFunction(() => document.querySelector('#labels .say.lifted') !== null && document.querySelector('#labels .emote') !== null, null, T(5_000))
    .then(() => true, () => false);
  await shot(b, 'chat-4-emote-b');
  check(results.lifted, 'a bubble rises clear of an emote on the same player');

  // --- hiding chat ------------------------------------------------------------------------------------
  await b.page.click('.chat-mute');
  await b.page.click('.chat-close');
  await say(a, 'can you hear me');
  await wait(400);
  results.hidden = { bubbles: await bubbles(b), badge: await b.page.isVisible('.chat-dock .chat-badge'), peeks: (await texts(b, '.chat-peek')).length };
  check(!results.hidden.bubbles.includes('can you hear me') && !results.hidden.badge && results.hidden.peeks === 0, 'hidden chat: no bubble, no count, no preview');
  const inLog = await texts(b, '#chat-list-floor .chat-line');
  check(inLog.some((t) => t.endsWith('can you hear me')), 'hidden chat still keeps the log');
  await shot(b, 'chat-5-hidden-b');
  await b.page.click('.chat-dock');
  await b.page.click('.chat-mute');

  // --- a private lobby's own room ---------------------------------------------------------------------
  await openLobby(a, 'bj-1');
  await a.page.click('.lobby-actions .btn:has-text("Private")');
  await a.page.waitForSelector('.party-pin-digits', T(10_000));
  const pin = (await a.page.textContent('.party-pin-digits .lb-seg-lit')).trim();
  await openLobby(b, 'bj-1');
  await b.page.fill('.lobby-pin-input', pin);
  await b.page.keyboard.press('Enter');
  await a.page.waitForFunction(() => document.querySelectorAll('.party-member').length === 2, null, T(15_000));
  log(`lobby PIN ${pin}, both in`);
  check(await a.page.isVisible('#chat-tab-table') || (await a.page.$('#chat-tab-table:not([hidden])')) !== null, 'the Table tab appears at a lobby table');
  await a.page.click('.chat-dock');
  await a.page.click('.chat-input');
  await a.page.keyboard.type('Good luck, table');
  await a.page.keyboard.press('Enter');
  await b.page.waitForFunction(() => [...document.querySelectorAll('#chat-list-table .chat-line')].some((e) => e.textContent.endsWith('Good luck, table')), null, T(5_000));
  const bFloor = await texts(b, '#chat-list-floor .chat-line');
  check(!bFloor.some((t) => t.endsWith('Good luck, table')), "the table's line stays out of the floor log");
  check((await bubbles(b)).every((t) => t !== 'Good luck, table'), "the table's line makes no bubble on the floor");
  await wait(1_200);
  await b.page.click('.chat-input');
  await b.page.keyboard.type('Thanks! Dealer looks cold tonight');
  await b.page.keyboard.press('Enter');
  await a.page.waitForFunction(() => [...document.querySelectorAll('#chat-list-table .chat-line')].some((e) => e.textContent.endsWith('cold tonight')), null, T(5_000));
  await wait(600);
  await shot(a, 'chat-6-table-a');
  await shot(b, 'chat-6-table-b');
  results.corner = await a.page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect().toJSON() ?? null;
    return { chat: r('.chat'), party: r('.party') };
  });

  // A phone-width box.
  await b.page.setViewportSize({ width: 390, height: 844 });
  await wait(1500);
  await shot(b, 'chat-7-phone-b');
  await b.page.setViewportSize({ width: 1280, height: 800 });

  // --- the server's mute: a client that ignores the limit ------------------------------------------------
  await a.page.evaluate(() => {
    for (let i = 0; i < 9; i++) window.casino.app.table.session.socket.send({ t: 'say', text: `spam ${i}` });
  });
  await a.page.waitForFunction(() => /^Muted for \d:\d\d$/.test(document.querySelector('.chat-input').placeholder), null, T(5_000));
  results.mutedPlaceholder = await a.page.getAttribute('.chat-input', 'placeholder');
  check(await a.page.isDisabled('.chat-input'), 'a muted player cannot type');
  results.mutedNotices = await texts(a, '#chat-list-table .chat-sys');
  await wait(400);
  await shot(a, 'chat-8-muted-a');
  const bTable = await texts(b, '#chat-list-table .chat-line');
  results.spamSeenByB = bTable.filter((t) => t.includes('spam')).length;
  check(results.spamSeenByB === 3, 'only the burst of three got through to the other player');

  // Leaving the table takes its tab away.
  for (const p of [a, b]) await p.page.evaluate(() => window.casino.app.escape());
  await wait(1500);
  check((await a.page.$('#chat-tab-table:not([hidden])')) === null, 'the Table tab goes when you leave the table');
} catch (err) {
  errors.push(`script: ${err?.stack ?? err}`);
}

console.log(JSON.stringify({ results, errors: errors.slice(0, 20) }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
