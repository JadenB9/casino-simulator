#!/usr/bin/env node
// The Quick check (server/src/fair.ts) in the real game. The dev stack never asks one by itself
// (its scripts are scripts), so this forces one with POST /api/dev/check and then plays it the
// way a person would:
//   - a round of roulette with nothing waiting: no check;
//   - the check made due mid-session: the round in play finishes, and only then the panel opens;
//   - while it's up a bet is refused, with the panel's words and no toast;
//   - the chip dropped on the wrong ring: "Not quite", a countdown, then a new picture by itself;
//   - the chip dragged onto the right ring (where GET /api/dev/check/answer says it is): passed,
//     the panel closes and the next round plays.
// Usage: node scripts/e2e/bot6.mjs [port] [outDir]   (PORT_BASE=<port> npm run dev first)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', out = '/tmp/casino-bot6'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const errors = [];
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const gpu = process.env.GPU === '1';

const browser = await chromium.launch({ args: gpu ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(([q, api]) => { localStorage.setItem('casino.quality', q); if (api) window.__api = api; }, [process.env.QUALITY ?? 'low', process.env.API ?? '']);
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const name = process.env.NAME ?? 'bot6_e2e_a';

const call = (path, init = {}) =>
  page.evaluate(
    async ([path, init]) => {
      const r = await fetch(`${window.__api ?? location.origin}/casino/api/${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('casino.token')}` },
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [path, init],
  );

async function enterFloor() {
  await page.goto(`${process.env.BASE ?? `http://localhost:${port}`}/casino/`);
  await page.waitForSelector('.name-input, .menu-item', { timeout: 180_000 });
  if (await page.$('.name-input')) {
    await page.fill('.name-input', name);
    await page.fill('.pass-input', 'casino-dev'); // DEV_PASSWORD in client/src/net/api.ts
    await page.click('.enter-btn');
  }
  await page.waitForSelector('.menu-item', { timeout: 20_000 });
  await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 20_000 });
}

async function sit(station, buyIn = 1000) {
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, station);
  await page.waitForSelector('.lobby-choice', { timeout: 10_000 });
  await page.keyboard.press('s');
  await page.waitForSelector('.modal input[type=number]', { timeout: 20_000 });
  await page.fill('.modal input[type=number]', String(buyIn));
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 20_000 });
}

/** Bet red and spin; resolves with the table's answer to the bet (an err, or the round's result). */
async function spin() {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const s = window.casino.app.table.session;
        const orig = s.onMessage.bind(s);
        const done = (v) => {
          s.onMessage = orig;
          resolve(v);
        };
        s.onMessage = (m) => {
          orig(m);
          if (m.t === 'err') done({ err: m.code, msg: m.msg });
          if (m.t === 'ev' && m.events.some((e) => e.type === 'result' || e.type === 'settle')) done({ ok: true });
        };
        s.link.act({ type: 'bet', bets: [{ kind: 'red', amount: 500 }] });
        setTimeout(() => s.link.act({ type: 'spin' }), 500);
        setTimeout(() => done({ timeout: true }), 30_000);
      }),
  );
}

const checkUp = () => page.$('.check-modal');

/** Drag the chip from its corner to (x, y) in picture pixels. */
async function dragChipTo(x, y) {
  const canvas = await page.waitForSelector('.check-canvas', { timeout: 10_000 });
  const box = await canvas.boundingBox();
  const to = (px, py) => [box.x + (px / 360) * box.width, box.y + (py / 220) * box.height];
  const [hx, hy] = to(34, 190);
  const [tx, ty] = to(x, y);
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(hx + ((tx - hx) * i) / 12, hy + ((ty - hy) * i) / 12);
  await page.mouse.up();
}

const fail = (msg) => {
  errors.push(msg);
  log(`FAIL ${msg}`);
};

try {
  await enterFloor();
  if ((await call('check')).body?.state !== 'ok') fail('a check was waiting before the run');
  await sit('rl-us');
  log('seated at roulette');

  // Nothing waiting: a round plays and no panel shows.
  const r1 = await spin();
  if (!r1.ok) fail(`first round: ${JSON.stringify(r1)}`);
  await page.waitForTimeout(1500);
  if (await checkUp()) fail('the panel opened with nothing waiting');
  log('round 1 played, no check');

  // Due mid-session: asked only once the round in play is over.
  await call('dev/check', { method: 'POST', body: '{}' });
  const r2 = await spin();
  if (!r2.ok) fail(`the round in play when the check came due was refused: ${JSON.stringify(r2)}`);
  await page.waitForSelector('.check-modal .check-canvas', { timeout: 15_000 });
  await page.waitForTimeout(600);
  await shot('bot6-check');
  const text = await page.textContent('.check-modal');
  if (/\bbot\b/i.test(text)) fail('the panel says "bot"');
  log('check asked after the round');

  // A bet while it waits: refused with the panel's words, and no toast over it.
  const r3 = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const s = window.casino.app.table.session;
        const orig = s.onMessage.bind(s);
        s.onMessage = (m) => {
          orig(m);
          if (m.t === 'err') {
            s.onMessage = orig;
            resolve(m);
          }
        };
        s.link.act({ type: 'bet', bets: [{ kind: 'red', amount: 500 }] });
        setTimeout(() => resolve(null), 5000);
      }),
  );
  if (r3?.code !== 'NOT_ELIGIBLE') fail(`bet while paused: ${JSON.stringify(r3)}`);
  if ((await page.$$('.toast.err')).length) fail('a toast doubled the panel');

  // A miss: far from the right ring.
  let want = (await call('dev/check/answer')).body;
  await dragChipTo(want.x > 180 ? want.x - 120 : want.x + 120, want.y);
  await page.waitForFunction(() => /Another go in/.test(document.querySelector('.check-status')?.textContent ?? ''), null, { timeout: 10_000 });
  await shot('bot6-miss');
  log('miss: waiting');
  // The countdown runs out and a new picture comes by itself.
  await page.waitForSelector('.check-modal .check-canvas', { timeout: 30_000 });
  await page.waitForTimeout(500);

  // The right ring.
  want = (await call('dev/check/answer')).body;
  await dragChipTo(want.x, want.y);
  await page.waitForFunction(() => !document.querySelector('.check-modal'), null, { timeout: 10_000 });
  await page.waitForTimeout(300);
  await shot('bot6-passed');
  if ((await call('check')).body?.state !== 'ok') fail('not ok after passing');
  log('passed');

  // Play goes on.
  const r4 = await spin();
  if (!r4.ok) fail(`round after passing: ${JSON.stringify(r4)}`);
  log('round after the check played');
} catch (err) {
  errors.push(String(err));
  await shot('bot6-error').catch(() => {});
} finally {
  await browser.close();
}
if (errors.length) {
  console.log('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
log(`ok: screenshots in ${out}`);
