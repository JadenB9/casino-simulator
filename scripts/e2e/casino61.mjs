#!/usr/bin/env node
// v6.1: tipping the dealer and the play reminder, in the game proper on the dev stack. Sits at a
// blackjack table alone, tips the dealer with K and with the panel's 2x button (the stack drops,
// the dealer thanks you), then brings the play reminder up early through its dev hook and takes a
// break from it: the table is left and every chip but the tips comes home. Screens the table, the
// thanks, the card at a laptop size and a small window, and the Settings rows.
// Starts its own dev stack (PORT_BASE=<port>: Vite there, the worker on port+1) and stops it.
// Usage: node scripts/e2e/casino61.mjs [port] [outDir]   GPU=1 for the Mac's GPU.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const [port = '6510', out = '/tmp/casino61'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}`;
const name = 'casino61_e2e_a';

let failed = 0;
const ok = (cond, what) => {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};

const dev = spawn('node', ['scripts/dev.mjs'], { stdio: 'ignore', env: { ...process.env, PORT_BASE: port }, detached: true });
const stop = () => {
  try {
    process.kill(-dev.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stop);
async function up(url) {
  for (let i = 0; i < 180; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} never came up`);
}
await up(`http://localhost:${Number(port) + 1}/casino/api/me`);
await up(`${base}/casino/`);
execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', 'DELETE FROM casino_rate'], { stdio: 'pipe', env: { ...process.env, CI: '1' } });

const browser = await chromium.launch(process.env.GPU === '1' ? { channel: 'chromium', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  localStorage.setItem('casino.quality', 'high');
  localStorage.setItem('casino.camera.view', 'third');
  localStorage.setItem('casino.reminder', '60');
});
const p = await ctx.newPage();
const errors = [];
p.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource|404/.test(m.text()) && errors.push(m.text()));
p.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => p.screenshot({ path: `${out}/casino61-${n}.png` });
async function finish() {
  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 4).join(' | ')}` : ''}`);
  await browser.close();
  stop();
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
}
const me = () =>
  p.evaluate(async () => {
    const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` } });
    return (await r.json()).profile;
  });
const stack = () => p.evaluate(() => window.casino.app.table?.session.snapshot?.you.stack ?? null);
/** Where the Tip panel is, whether it's all on screen, and any other control it covers. */
const tipBox = () =>
  p.evaluate(() => {
    const t = document.querySelector('.tip-dealer');
    if (!t || t.hidden) return null;
    const a = t.getBoundingClientRect();
    const hits = [];
    for (const e of document.querySelectorAll('#ui .panel, #ui .btn, #ui .hud-bar')) {
      if (t.contains(e) || e.contains(t)) continue;
      const b = e.getBoundingClientRect();
      if (b.width && b.height && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits.push(String(e.className));
    }
    return { at: [a.left, a.top, a.right, a.bottom].map(Math.round).join(','), hits, inView: a.left >= 0 && a.top >= 0 && a.right <= innerWidth && a.bottom <= innerHeight };
  });
const clear = (b, where) => ok(!!b && b.inView && b.hits.length === 0, `${where}: the Tip panel is on screen and covers nothing (${b ? `${b.at}${b.hits.length ? ` over ${b.hits.join(' / ')}` : ''}` : 'not shown'})`);

/** Sit down alone at a station with $1,000; false if the table never seated us. */
async function sit(id) {
  await p.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, id);
  const first = await p.waitForSelector('.lobby-choice, .modal input[type=number]', { timeout: 15_000 }).catch(() => null);
  if (first && (await p.$('.lobby-choice'))) await p.keyboard.press('s');
  const buy = await p.waitForSelector('.modal input[type=number]', { timeout: 20_000 }).catch(() => null);
  if (!buy) return false;
  await p.fill('.modal input[type=number]', '1000');
  await p.click('.modal .btn.primary');
  return p.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 }).then(() => true, () => false);
}

async function stand() {
  await p.evaluate(() => window.casino.app.escape());
  const leave = await p.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
  if (leave) await leave.click();
  await p.waitForFunction(() => !window.casino.app.table, null, { timeout: 10_000 }).catch(() => {});
  await p.waitForTimeout(1500);
}

try {
  await p.goto(`${base}/casino/`, { timeout: 180_000 });
  await p.waitForSelector('.name-input, .menu-item', { timeout: 300_000 });
  if (await p.$('.name-input')) {
    await p.fill('.name-input', name);
    if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
    await p.click('.enter-btn');
  }
  await p.waitForSelector('.menu-item, .editor-panel', { timeout: 60_000 });
  if (await p.$('.editor-panel')) {
    await p.waitForTimeout(1500);
    for (let i = 0; i < 10 && !(await p.$('.hud')); i++) {
      const next = await p.$('.editor-panel .ed-buttons .btn.primary');
      if (next) await next.click();
      await p.waitForTimeout(600);
    }
  } else await p.click('.menu-item >> nth=0');
  await p.waitForSelector('.hud', { timeout: 60_000 });
  await p.waitForFunction(() => window.casino?.app?.link?.you, null, { timeout: 30_000 });
  await p.waitForTimeout(2500);
  for (let i = 0; i < 3 && (await p.$('.sheet-scrim, .modal')); i++) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }

  // every other table with a dealer: the panel sits clear of each one's controls
  for (const id of ['rl-us', 'cr-1', 'bc-1', 'tc-1', 'wr-1', 'b6-1', 'sb-1', 'he-1', 'lr-1', 'pg-1', 'bg-1']) {
    if (!(await sit(id))) {
      ok(false, `${id}: sat down`);
      await stand();
      continue;
    }
    await p.waitForTimeout(3000);
    clear(await tipBox(), id);
    await shot(`tour-${id}`);
    await stand();
  }

  // blackjack, alone, $1,000 (the money measured from here, once the tour's chips are home)
  let before = await me();
  for (let i = 0; i < 40 && before.inPlay !== 0; i++) {
    await p.waitForTimeout(1500);
    before = await me();
  }
  ok(await sit('bj-1'), 'sat down at blackjack');
  await p.waitForTimeout(3000);
  const panel = await p.$('.tip-dealer:not([hidden])');
  ok(!!panel, 'the Tip dealer panel shows once seated');
  const labels = await p.$$eval('.tip-dealer .btn', (bs) => bs.map((b) => b.textContent));
  ok(labels.length === 2 && /\$25/.test(labels[0]) && /\$50/.test(labels[1]), `it offers the minimum and twice it: ${labels.join(' | ')}`);
  clear(await tipBox(), 'bj-1');
  await shot('table');
  await p.setViewportSize({ width: 1000, height: 640 });
  await p.waitForTimeout(1500);
  clear(await tipBox(), 'bj-1 at 1000x640');
  await shot('table-small');
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.waitForTimeout(1000);

  // K tips the minimum
  await p.mouse.move(640, 400);
  await p.keyboard.press('KeyK');
  await p.waitForFunction(() => window.casino.app.table?.session.snapshot?.you.stack === 97_500, null, { timeout: 10_000 }).catch(() => {});
  ok((await stack()) === 97_500, `K tipped $25: the stack is ${(await stack()) / 100}`);
  const line = await p.waitForSelector('.dealer-line:not([hidden])', { timeout: 6000 }).catch(() => null);
  ok(!!line && /Thank you/.test(await line.textContent()), `the dealer says thanks: "${line ? await line.textContent() : ''}"`);
  await p.waitForTimeout(600);
  await shot('thanks');
  // the panel's 2x button
  await p.click('.tip-dealer .btn >> nth=1');
  await p.waitForFunction(() => window.casino.app.table?.session.snapshot?.you.stack === 92_500, null, { timeout: 10_000 }).catch(() => {});
  ok((await stack()) === 92_500, `the $50 button tipped: the stack is ${(await stack()) / 100}`);

  // a bet out: a tip waits for the hand
  await p.evaluate(() => window.casino.app.table.session.link.act({ type: 'bet', amount: 2500 }));
  await p.waitForFunction(() => window.casino.app.table?.session.snapshot?.you.stack === 90_000, null, { timeout: 10_000 }).catch(() => {});
  await p.keyboard.press('KeyK');
  const refused = await p.waitForSelector('.toast.err', { timeout: 5000 }).catch(() => null);
  ok(!!refused && /between hands/.test(await refused.textContent()), `a tip with a bet out is refused: "${refused ? await refused.textContent() : ''}"`);
  ok((await stack()) === 90_000, 'and the stack is untouched');

  // the play reminder, brought forward
  await p.evaluate(() => globalThis.__reminder.every(1500));
  const card = await p.waitForSelector('.reminder', { timeout: 8000 }).catch(() => null);
  ok(!!card, 'the play reminder card shows');
  const text = card ? await card.textContent() : '';
  ok(/Play reminder/.test(text) && /Played/.test(text) && /Take a break/.test(text) && /Keep playing/.test(text), `it says the time and the net: "${text}"`);
  const box = card ? await card.boundingBox() : null;
  ok(!!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 800, `on screen at 1280x800 (${box && [box.x, box.y, box.width, box.height].map(Math.round).join(',')})`);
  await p.evaluate(() => globalThis.__reminder.every(null));
  await p.waitForTimeout(800);
  await shot('reminder');
  await p.setViewportSize({ width: 820, height: 520 });
  await p.waitForTimeout(1500);
  const small = await p.$eval('.reminder', (e) => e.getBoundingClientRect().toJSON()).catch(() => null);
  ok(!!small && small.left >= 0 && small.top >= 0 && small.right <= 820 && small.bottom <= 520, `on screen in an 820x520 window (${small && [small.left, small.top, small.right, small.bottom].map(Math.round).join(',')})`);
  await shot('reminder-small');
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.waitForTimeout(800);

  // Take a break: the bet plays out or comes back, the chips go home, less the tips
  await p.click('.reminder .btn.primary');
  await p.waitForFunction(() => !window.casino.app.table, null, { timeout: 10_000 }).catch(() => {});
  ok(!(await p.$('.reminder')), 'Take a break closes the card');
  ok(await p.evaluate(() => !window.casino.app.table), 'and stands you up from the table');
  let after = await me();
  for (let i = 0; i < 40 && after.inPlay !== 0; i++) {
    await p.waitForTimeout(1500);
    after = await me();
  }
  const moved = after.balance - before.balance;
  // the undealt $25 bet came back; the $75 of tips didn't
  ok(after.inPlay === 0 && moved === -7_500, `cashed out through the normal path: balance moved ${moved / 100}`);
  await p.waitForTimeout(2500);
  await shot('after-break');

  // the Settings rows
  await p.evaluate(() => document.querySelector('.hud-btn[title="Settings"]').click());
  await p.waitForSelector('.settings-sheet', { timeout: 5000 });
  const rows = await p.$$eval('.settings-sheet .set-label', (ls) => ls.map((l) => l.textContent));
  ok(rows.includes('Play reminder') && rows.includes('Loss limit'), `Settings has the Play rows: ${rows.join(', ')}`);
  await p.evaluate(() => [...document.querySelectorAll('.settings-sheet .set-label')].find((l) => l.textContent === 'Play reminder')?.scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(400);
  await shot('settings');
  await p.click('.settings-sheet .seg-btn:text("$1K")');
  ok(await p.evaluate(() => localStorage.getItem('casino.lossLimit') === '100000'), 'the loss limit is kept');
  await p.click('.settings-sheet [aria-label="Session loss limit"] .seg-btn:text("Off")');
  await p.keyboard.press('Escape');
} catch (err) {
  failed++;
  console.log('FAIL', err);
  await shot('error').catch(() => {});
}
await finish();
