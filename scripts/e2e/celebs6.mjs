#!/usr/bin/env node
// Headless run of the things that bring players back (world/celebs/, ui/daily/, server/src/daily.ts,
// server/src/floor/celebs.ts) against the local worker, with two players on the floor:
//   daily   the daily bonus's sheet opening on arrival, the claim, the HUD button, a phone's width
//   celeb   a celebrity forced in with the dev trigger: the notice, the walk in with the entourage,
//           the lobby stop, "Talk to" for a tip (the flash, the photo, the balance), the other player
//           seeing the selfie, already met, and the stops after (photos, a table played for show)
//   gift    a gift box left in the lobby: seen by both, opened by one, gone for the other
//   phone   a visit on a phone's screen: the notice and the card clear of the HUD
//   happy   a happy hour started by hand: the notice, the card, the bartender, the menu at half price
//   lineup  each celebrity in turn at the lobby stop, close up (not run by default)
//
// Usage: node scripts/e2e/celebs6.mjs [port] [outDir] [checks...]   (default: daily celeb gift)
//   --sw     SwiftShader instead of the machine's GPU
//   --quick  skip waiting for the later stops (about three minutes)
// Logs in as fixed names (celebs6_e2e_a, celebs6_e2e_b) with the dev password; the dev stack's
// worker must have CASINO_DEV set (server/wrangler.toml does).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const [port = '6290', out = '/tmp/celebs6-shots', ...wanted] = args;
const checks = wanted.length ? wanted : ['daily', 'celeb', 'gift', 'happy', 'phone'];
mkdirSync(out, { recursive: true });
const SHARED = `/casino/@fs${resolve('shared/src/celebs.ts')}`;
const A = 'celebs6_e2e_a';
const B = 'celebs6_e2e_b';

const browser = await chromium.launch(flag('sw') ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const frames = (p, n = 4) => p.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function shot(p, name, clip) {
  await frames(p, 4);
  await p.screenshot({ path: `${out}/${name}.png`, ...(clip ? { clip } : {}) });
  console.log('shot', `${out}/${name}.png`);
}

function watch(p) {
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

function sql(command) {
  return execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } }).toString();
}

/**
 * Put an account back before today's bonus, keeping every cent accounted for: the grant comes off
 * the balance with its ledger row, and the streak goes.
 */
function resetDaily(name) {
  sql(
    `UPDATE casino_accounts SET balance = balance - COALESCE((SELECT SUM(amount) FROM casino_ledger WHERE account_id = casino_accounts.id AND op_id LIKE 'daily:%'), 0), rev = rev + 1 WHERE name = '${name}';
     DELETE FROM casino_ledger WHERE op_id LIKE 'daily:%' AND account_id = (SELECT id FROM casino_accounts WHERE name = '${name}');
     DELETE FROM casino_tally WHERE key IN ('daily-streak', 'daily-last') AND account_id = (SELECT id FROM casino_accounts WHERE name = '${name}');`,
  );
}

async function enterAs(name, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = watch(p);
  await p.goto(`http://localhost:${port}/casino/`, { timeout: 180000 });
  await p.waitForSelector('.name-input', { timeout: 180000 });
  await p.fill('.name-input', name);
  if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
  await p.click('.enter-btn');
  await p.waitForSelector('.menu-item, .editor-panel', { timeout: 30000 });
  if (!(await p.$('.menu-item'))) {
    await p.waitForTimeout(2500);
    for (let k = 0; k < 10 && !(await p.$('.hud')); k++) {
      const next = await p.$('.editor-panel .ed-buttons .btn.primary');
      if (next) await next.click();
      await p.waitForTimeout(700);
    }
  } else {
    await p.click('.menu-item >> nth=0');
  }
  await p.waitForSelector('.hud', { timeout: 30000 });
  await p.waitForTimeout(1200);
  return { p, ctx, errors };
}

/** The floor believes a walk's worth of movement a second: long trips go in hops. */
async function travel(p, x, z, yaw) {
  const from = await p.evaluate(() => ({ x: window.casino.world.player.position.x, z: window.casino.world.player.position.z }));
  const n = Math.max(1, Math.ceil(Math.hypot(x - from.x, z - from.z) / 7));
  for (let i = 1; i <= n; i++) {
    await p.evaluate(([a, b, c]) => window.casino.world.teleport(a, b, c), [from.x + ((x - from.x) * i) / n, from.z + ((z - from.z) * i) / n, yaw]);
    await p.waitForTimeout(1100);
  }
}

/** A camera the script holds (the player's own camera otherwise puts it back every frame). */
async function hold(p) {
  await p.evaluate(() => {
    const c = window.casino;
    // the walker's own camera would move it first each frame (and the frame's culling with it)
    c.world.player.setEnabled(false);
    if (c.held) return;
    c.held = true;
    c.shot = null;
    c.engine.onFrame(() => {
      const s = c.shot;
      if (!s) return;
      if (s.follow) {
        const m = s.follow();
        if (!m) return;
        const [dx, up, dz, lookUp] = s.world;
        c.engine.camera.position.set(m.x + dx, up, m.z + dz);
        c.engine.camera.lookAt(m.x, lookUp, m.z);
      } else {
        c.engine.camera.position.set(...s.pos);
        c.engine.camera.lookAt(...s.at);
      }
    });
  });
}
const aim = (p, pos, at) => p.evaluate(([a, b]) => (window.casino.shot = { pos: a, at: b }), [pos, at]);
const followStar = (p, world) => p.evaluate((w) => (window.casino.shot = { follow: () => window.casino.world.life.celebs.star(), world: w }), world);
const release = (p) =>
  p.evaluate(() => {
    window.casino.shot = null;
    window.casino.world.player.setEnabled(true);
  });
const api = (p, path, method = 'GET', body) =>
  p.evaluate(
    async ([pa, m, b]) => {
      const t = sessionStorage.getItem('casino.token');
      const r = await fetch(`/casino/api/${pa}`, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, ...(b ? { body: JSON.stringify(b) } : {}) });
      return { status: r.status, body: await r.json() };
    },
    [path, method, body],
  );
const balance = async (p) => (await api(p, 'me')).body.profile.balance;

// --- the daily bonus ------------------------------------------------------------------------------

if (checks.includes('daily')) {
  try {
    resetDaily(A);
  } catch {
    /* a new name: nothing to put back */
  }
  const a = await enterAs(A);
  // today's still waiting: the sheet opens by itself on the floor
  const opened = await a.p.waitForSelector('.daily-sheet', { timeout: 8000 }).then(() => true, () => false);
  if (!opened) fail('the daily sheet opens on arrival');
  await a.p.waitForTimeout(700);
  await shot(a.p, 'daily-sheet');
  const before = await balance(a.p);
  const amount = await a.p.evaluate(() => document.querySelector('.daily-claim')?.textContent ?? '');
  console.log('daily claim button', amount);
  await a.p.click('.daily-claim');
  await a.p.waitForSelector('.daily-done', { timeout: 8000 }).catch(() => fail('the claim goes through'));
  await a.p.waitForTimeout(500);
  await shot(a.p, 'daily-claimed');
  const after = await balance(a.p);
  console.log('daily balance', before, '->', after);
  if (after - before !== 250_000) fail(`day one pays $2,500 (${(after - before) / 100})`);
  const hudBalance = await a.p.evaluate(() => window.casino.session.profile.balance);
  if (hudBalance !== after) fail('the session shows the new balance');
  // again: refused, nothing paid
  const again = await api(a.p, 'daily/claim', 'POST', {});
  if (again.status !== 409) fail(`a second claim is refused (${again.status})`);
  if ((await balance(a.p)) !== after) fail('a second claim pays nothing');
  await a.p.keyboard.press('Escape');
  await a.p.waitForTimeout(500);
  await shot(a.p, 'daily-hud', { x: 780, y: 0, width: 500, height: 90 });
  // on a phone
  await a.ctx.close();
  resetDaily(A);
  const m = await enterAs(A, { width: 390, height: 844 });
  await m.p.waitForSelector('.daily-sheet', { timeout: 8000 }).catch(() => fail('the daily sheet opens on a phone'));
  await m.p.waitForTimeout(700);
  await shot(m.p, 'daily-phone');
  const fits = await m.p.evaluate(() => {
    const r = document.querySelector('.daily-sheet')?.getBoundingClientRect();
    return r ? r.left >= 0 && r.right <= innerWidth + 0.5 : false;
  });
  if (!fits) fail('the daily sheet fits a phone');
  await m.p.click('.daily-claim');
  await m.p.waitForSelector('.daily-done', { timeout: 8000 });
  // (the second claim above is refused on purpose: the browser logs that 409)
  for (const e of [...a.errors, ...m.errors]) if (!e.includes('409')) fail(`daily error: ${e}`);
  await m.ctx.close();
}

// --- a celebrity ----------------------------------------------------------------------------------

if (checks.includes('celeb')) {
  const a = await enterAs(A);
  const b = await enterAs(B);
  for (const r of [a, b]) await r.p.keyboard.press('Escape');
  const shared = await a.p.evaluate(async (path) => {
    const m = await import(path);
    const t = m.timeline(m.ROUTES.boutique);
    return { stops: t.segs.filter((s) => s.kind === 'stop').map((s) => ({ t0: s.t0, t1: s.t1, kind: t.route.stops[s.stop].kind, at: t.route.pts[t.route.stops[s.stop].at] })), secs: t.secs };
  }, SHARED);
  console.log('route', JSON.stringify(shared.stops.map((s) => [s.kind, Math.round(s.t0), Math.round(s.t1)])));
  // B waits in the lobby, A a little way up it
  await travel(b.p, 2.6, 6.4, -Math.PI * 0.7);
  await travel(a.p, 1.2, 6.2, Math.PI * 0.95);
  const before = await balance(a.p);
  const forced = await api(a.p, 'dev/celeb', 'POST', { celeb: 'vale' });
  if (forced.status !== 200) fail(`the dev trigger (${forced.status})`);
  const visit = forced.body.visit;
  console.log('visit', JSON.stringify(visit));
  // the notice, and the celebrity walking in with the bodyguards
  await a.p.waitForSelector('.celeb-notice', { timeout: 10000 }).catch(() => fail('a notice when they walk in'));
  const notice = await a.p.evaluate(() => document.querySelector('.celeb-notice')?.textContent);
  console.log('notice', notice);
  if (!notice?.includes('Seraphina Vale just walked in through the lobby')) fail(`the notice names them (${notice})`);
  await hold(a.p);
  await aim(a.p, [2.4, 1.7, 5.2], [0, 1.1, 12.5]);
  await a.p.waitForTimeout(2600);
  await shot(a.p, 'celeb-walks-in');
  const cast = await a.p.evaluate(() => {
    const c = window.casino.world.life.celebs;
    return { star: c.star(), cast: c.cast.length, shown: c.cast.filter((x) => x.shown).length };
  });
  console.log('cast', JSON.stringify(cast));
  if (!cast.star || cast.cast < 6) fail(`the celebrity, two guards and fans (${cast.cast})`);
  // the lobby stop: greeting the room
  const lobby = shared.stops[0];
  await a.p.waitForFunction(([s, t]) => window.casino.world.life.celebs.visit && Date.now() - s > t * 1000, [visit.start, lobby.t0 + 2.5], { timeout: 30000 }).catch(() => {});
  await followStar(a.p, [1.2, 1.75, -3.6, 1.25]);
  await a.p.waitForTimeout(1500);
  await shot(a.p, 'celeb-lobby-greet');
  await aim(a.p, [0.6, 3.5, 4.1], [0, 0.8, 8.6]);
  await a.p.waitForTimeout(800);
  await shot(a.p, 'celeb-lobby-crowd');
  await release(a.p);
  // the card at the right: who's on the floor and where
  const card = await a.p.evaluate(() => document.querySelector('.celeb-sighting')?.textContent ?? null);
  console.log('sighting', card);
  if (!card?.includes('Seraphina Vale')) fail('the on-the-floor card');

  // A walks up and says hello
  const star = await a.p.evaluate(() => window.casino.world.life.celebs.star());
  await travel(a.p, star.x + 0.6, star.z - 1.4, 0);
  await a.p.waitForTimeout(400);
  const prompt = await a.p.evaluate(() => document.querySelector('.world-prompt')?.textContent ?? '');
  console.log('prompt', prompt);
  if (!prompt.includes('Talk to Seraphina Vale')) fail(`the Talk prompt (${prompt})`);
  await hold(b.p);
  await followStar(b.p, [2.2, 1.7, -2.4, 1.3]);
  await a.p.keyboard.press('KeyE');
  await a.p.waitForTimeout(1350);
  await shot(a.p, 'celeb-talk-flash');
  // B, across the lobby, sees them turn to A and say it
  const said = await b.p.evaluate(() => [...document.querySelectorAll('.staff-say-text')].map((e) => e.textContent));
  console.log('B hears', JSON.stringify(said));
  if (!said.some((x) => x && x.length > 3)) fail('B sees the line');
  await shot(b.p, 'celeb-seen-by-b');
  await a.p.waitForFunction(() => document.querySelector('.celeb-photo'), null, { timeout: 8000 }).catch(() => fail('the photo card'));
  await a.p.waitForTimeout(700);
  await shot(a.p, 'celeb-photo');
  const after = await balance(a.p);
  const tip = after - before;
  console.log('tip', tip / 100);
  if (tip < 50_000 || tip > 1_000_000 || tip % 10_000 !== 0) fail(`a tip of $500-$10,000 in hundreds (${tip / 100})`);
  // met: no more prompt, and a second ask pays nothing
  await a.p.waitForTimeout(600);
  const prompt2 = await a.p.evaluate(() => document.querySelector('.world-prompt:not([hidden])')?.textContent ?? '');
  if (prompt2.includes('Talk to')) fail('no Talk prompt once met');
  await a.p.evaluate((id) => window.casino.world.life.celebs.link.send({ t: 'celeb.talk', visit: id }), visit.id);
  await a.p.waitForTimeout(1200);
  const met = await a.p.evaluate(() => [...document.querySelectorAll('.celeb-notice-title')].map((e) => e.textContent).join(' / '));
  console.log('second ask', met);
  if ((await balance(a.p)) !== after) fail('a second word pays nothing');
  const daily = (await api(a.p, 'daily')).body;
  if (!(daily.met?.vale >= 1)) fail(`the daily sheet counts the meeting (${JSON.stringify(daily.met)})`);

  if (!flag('quick')) {
    // the boutique: posing for photos, phones flashing
    for (const [i, name, world] of [[1, 'celeb-boutique-pose', [-3.6, 2.6, 1.4, 1.1]], [2, 'celeb-table', [0.6, 1.9, 2.7, 1.2]]]) {
      const s = shared.stops[i];
      const at = s.at;
      await travel(a.p, at[0] + world[0] * 0.8, at[1] + world[2] * 0.8, 0);
      await a.p.waitForFunction(([st, t]) => Date.now() - st > t * 1000, [visit.start, s.t0 + 4], { timeout: 200000 });
      await hold(a.p);
      await followStar(a.p, world);
      await a.p.waitForTimeout(1500);
      await shot(a.p, name);
      await release(a.p);
    }
  }
  for (const [who, r] of [['a', a], ['b', b]]) for (const e of r.errors) fail(`${who} error: ${e}`);
  await a.ctx.close();
  await b.ctx.close();
}

// --- the gift box ---------------------------------------------------------------------------------

if (checks.includes('gift')) {
  const a = await enterAs(A);
  const b = await enterAs(B);
  for (const r of [a, b]) await r.p.keyboard.press('Escape');
  await travel(a.p, -3.2, 6.5, Math.PI * 0.8);
  await travel(b.p, 2, 7, -Math.PI * 0.8);
  const left = await api(a.p, 'dev/gift', 'POST', { spot: 1 });
  const g = left.body.gift;
  console.log('gift', JSON.stringify(g));
  await a.p.waitForSelector('.celeb-notice', { timeout: 8000 }).catch(() => fail('a notice when a box is left'));
  await hold(a.p);
  await aim(a.p, [g.x + 2.2, 1.5, g.z + 2.6], [g.x, 0.35, g.z]);
  await a.p.waitForTimeout(900);
  await shot(a.p, 'gift-box');
  await aim(a.p, [0, 2.6, 12], [g.x, 0.4, g.z]);
  await a.p.waitForTimeout(600);
  await shot(a.p, 'gift-box-far');
  await release(a.p);
  const seenB = await b.p.evaluate(() => window.casino.world.life.celebs.gift?.id ?? null);
  if (seenB !== g.id) fail('B sees the box');
  const before = await balance(a.p);
  await travel(a.p, g.x + 0.9, g.z + 0.4, -Math.PI / 2 - 0.4);
  await a.p.waitForTimeout(400);
  const prompt = await a.p.evaluate(() => document.querySelector('.world-prompt')?.textContent ?? '');
  if (!prompt.includes('Open the gift box')) fail(`the Open prompt (${prompt})`);
  await a.p.keyboard.press('KeyE');
  await a.p.waitForFunction(() => document.querySelector('.celeb-photo'), null, { timeout: 8000 }).catch(() => fail('the gift card'));
  await a.p.waitForTimeout(500);
  await shot(a.p, 'gift-opened');
  const won = (await balance(a.p)) - before;
  console.log('gift won', won / 100);
  if (won < 100_000 || won > 500_000) fail(`$1,000-$5,000 in the box (${won / 100})`);
  await b.p.waitForFunction(() => window.casino.world.life.celebs.gift === null, null, { timeout: 8000 }).catch(() => fail('the box is gone for B'));
  const bNotice = await b.p.evaluate(() => [...document.querySelectorAll('.celeb-notice-title')].map((e) => e.textContent).join(' / '));
  console.log('B notice', bNotice);
  await shot(b.p, 'gift-gone-for-b');
  for (const [who, r] of [['a', a], ['b', b]]) for (const e of r.errors) fail(`${who} error: ${e}`);
  await a.ctx.close();
  await b.ctx.close();
}

// --- happy hour: the notice, the card, the bartender's call, the menu at half price ---------------

if (checks.includes('happy')) {
  const a = await enterAs(A);
  await a.p.keyboard.press('Escape');
  // by the bar's counter, facing the bartender
  await travel(a.p, 23.6, -8.5, Math.PI / 2);
  const started = await api(a.p, 'dev/happy', 'POST', { ms: 150_000 });
  if (started.status !== 200) fail(`the dev happy hour (${started.status})`);
  await a.p.waitForSelector('.happy-card', { timeout: 10000 }).catch(() => fail('the happy hour card'));
  await a.p.waitForTimeout(900);
  const said = await a.p.evaluate(() => [...document.querySelectorAll('.staff-say-text')].map((e) => e.textContent));
  console.log('happy: staff say', JSON.stringify(said));
  if (!said.some((x) => /half price|happy hour/i.test(x ?? ''))) fail('the bartender calls it');
  await shot(a.p, 'happy-floor');
  const card = await a.p.evaluate(() => document.querySelector('.happy-card')?.textContent ?? '');
  console.log('happy: card', card);
  await a.p.evaluate(() => window.casino.app.openBarMenu());
  await a.p.waitForSelector('.bar-sheet', { timeout: 8000 });
  await a.p.waitForTimeout(400);
  await shot(a.p, 'happy-menu');
  const tags = await a.p.evaluate(() => [...document.querySelectorAll('.bar-price')].slice(0, 2).map((e) => e.textContent));
  console.log('happy: prices', JSON.stringify(tags));
  if (!tags[0]?.includes('$9') || !tags[0]?.includes('$4.50')) fail(`the beer struck through at $9, $4.50 now (${tags[0]})`);
  const banner = await a.p.evaluate(() => document.querySelector('.happy-banner:not([hidden])')?.textContent ?? '');
  if (!banner.includes('half price')) fail(`the menu's happy hour line (${banner})`);
  const before = await balance(a.p);
  await a.p.click('.bar-order[aria-label^="Order Beer"]');
  await a.p.waitForFunction(() => document.querySelector('.bar-note.ok')?.textContent?.includes('$4.50'), null, { timeout: 8000 }).catch(() => fail('the note says $4.50'));
  const paid = before - (await balance(a.p));
  console.log('happy: paid', paid / 100);
  if (paid !== 450) fail(`a beer in happy hour is $4.50 (${paid / 100})`);
  await shot(a.p, 'happy-ordered');
  await a.p.keyboard.press('Escape');
  for (const e of a.errors) fail(`happy error: ${e}`);
  await a.ctx.close();
}

// --- every celebrity, as they greet the lobby ---------------------------------------------------------

if (checks.includes('lineup')) {
  const a = await enterAs(A);
  await a.p.keyboard.press('Escape');
  await travel(a.p, 3.2, 4.4, 0);
  await hold(a.p);
  for (const id of ['nightjar', 'maddox', 'vale', 'castellan', 'quill', 'harlow']) {
    const v = (await api(a.p, 'dev/celeb', 'POST', { celeb: id })).body.visit;
    await a.p.waitForFunction((st) => Date.now() - st > 9_000, v.start, { timeout: 30000 });
    // in front of them (they face the doors), a little to one side
    await followStar(a.p, [0.9, 1.6, 2.6, 1.1]);
    await a.p.waitForTimeout(1200);
    await shot(a.p, `lineup-${id}`, { x: 340, y: 60, width: 600, height: 620 });
  }
  for (const e of a.errors) fail(`lineup error: ${e}`);
  await a.ctx.close();
}

// --- on a phone: the notice, the on-the-floor card and the prompt clear of the HUD ------------------

if (checks.includes('phone')) {
  const m = await enterAs(B, { width: 390, height: 844 });
  await m.p.keyboard.press('Escape');
  await travel(m.p, 1.4, 6.8, Math.PI * 0.9);
  await api(m.p, 'dev/celeb', 'POST', { celeb: 'maddox' });
  await m.p.waitForSelector('.celeb-sighting', { timeout: 15000 }).catch(() => fail('the card on a phone'));
  await m.p.waitForTimeout(5000);
  await shot(m.p, 'phone-celeb');
  const boxes = await m.p.evaluate(() => {
    const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const hud = [...document.querySelectorAll('.hud .hud-btn, .hud-who, .hud-money')].map((e) => e.getBoundingClientRect());
    const card = r('.celeb-sighting');
    const overlaps = card ? hud.filter((h) => h.left < card.right && h.right > card.left && h.top < card.bottom && h.bottom > card.top).length : -1;
    return { card: card && [card.left, card.top, card.right, card.bottom], overlaps, width: innerWidth };
  });
  console.log('phone', JSON.stringify(boxes));
  if (boxes.overlaps !== 0) fail(`the card clear of the HUD on a phone (${boxes.overlaps})`);
  if (boxes.card && boxes.card[2] > boxes.width) fail('the card on screen');
  for (const e of m.errors) fail(`phone error: ${e}`);
  await m.ctx.close();
}

console.log(failed ? `${failed} failed` : 'ok');
await browser.close();
process.exit(failed ? 1 : 0);
