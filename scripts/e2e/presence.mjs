#!/usr/bin/env node
// Headless check of floor presence: two browser contexts (so two sessionStorage tokens, two
// players) open the presence dev page, see each other, walk at the same time, one sits down at
// a table and stands up again, then leaves. Screenshots of both views go to the output folder.
// Usage: node scripts/e2e/presence.mjs [port] [outDir]
// The names are fixed so repeated runs reuse two accounts instead of creating new ones.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5173', outDir = '/tmp/presence-e2e'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const NAME_A = process.env.PRESENCE_A ?? 'pe2e_ava';
const NAME_B = process.env.PRESENCE_B ?? 'pe2e_ben';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const checks = [];
const shots = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...(ok ? {} : { detail }) });

async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`http://localhost:${port}/casino/src/net/presence-dev.html?name=${name}`);
  await page.waitForFunction(() => window.presenceDev, null, { timeout: 20000 });
  await page.evaluate(() => window.presenceDev.ready);
  const id = await page.evaluate(() => window.presenceDev.me().id);
  return { ctx, page, name, id };
}

/** Wait for a condition in a page; a timeout is recorded as a failed check instead of a crash. */
async function until(who, label, fn, arg, timeout = 5000) {
  try {
    await who.page.waitForFunction(fn, arg, { timeout });
    check(label, true);
    return true;
  } catch {
    check(label, false, 'timed out');
    return false;
  }
}

const seen = (who, id) => who.page.evaluate((i) => window.presenceDev.remotes().find((r) => r.id === i) ?? null, id);
const shot = async (who, file) => {
  const p = `${outDir}/${file}`;
  await who.page.screenshot({ path: p });
  shots.push(p);
};

const a = await open(NAME_A);
const b = await open(NAME_B);
await until(a, 'A sees B', (id) => window.presenceDev.remotes().some((r) => r.id === id && r.visible), b.id);
await until(b, 'B sees A', (id) => window.presenceDev.remotes().some((r) => r.id === id && r.visible), a.id);
const online = await b.page.evaluate(() => window.presenceDev.me().online);
check('online count includes both', online >= 2, online);

// New looks go through the real API; the floor pushes them to everyone.
const LOOK_A = { v: 1, body: 'f', outfit: 'dress', skin: 1, hair: '#6b2a1a', top: '#8e1b2b', bottom: '#8e1b2b', shoes: '#1a0d0d' };
const LOOK_B = { v: 1, body: 'm', outfit: 'suit', skin: 4, hair: '#1b1410', top: '#c9b48a', bottom: '#3a3226', shoes: '#2b1d14' };
await a.page.evaluate((l) => window.presenceDev.setLook(l), LOOK_A);
await b.page.evaluate((l) => window.presenceDev.setLook(l), LOOK_B);
await until(b, "B sees A's new look", ([id, top]) => window.presenceDev.remotes().find((r) => r.id === id)?.look.top === top, [a.id, LOOK_A.top]);
await until(a, "A sees B's new look", ([id, top]) => window.presenceDev.remotes().find((r) => r.id === id)?.look.top === top, [b.id, LOOK_B.top]);

// Both walk at once: A across to the left, B toward the right-hand table.
const walkA = a.page.evaluate(() => window.presenceDev.walkTo(-3.4, 16.6));
const walkB = b.page.evaluate(() => window.presenceDev.walkTo(1.8, 16.1));
// Headless software GL renders a few frames a second, so sample the drawn walk several times
// rather than trusting one reading: it should keep closing on A's target at a walking pace.
const trail = [];
for (let i = 0; i < 6; i++) {
  await sleep(200);
  const r = await seen(b, a.id);
  if (r) trail.push({ x: r.x, z: r.z, speed: r.speed });
  if (i === 3) {
    await shot(a, 'presence-a-walking.png');
    await shot(b, 'presence-b-walking.png');
  }
}
const toTarget = trail.map((p) => Math.hypot(p.x - -3.4, p.z - 16.6));
check('B draws A walking', Math.max(...trail.map((p) => p.speed)) > 0.3, trail);
check("B draws A closing on A's target", toTarget.every((d, i) => i === 0 || d <= toTarget[i - 1] + 1e-6) && toTarget.at(-1) < toTarget[0] - 0.3, toTarget);
const midB = await seen(a, b.id);
check('A draws B walking', midB && midB.speed > 0.1, midB);
await Promise.all([walkA, walkB]);
await sleep(1000); // the 200 ms interpolation delay, then the walk blend easing out

const endA = await a.page.evaluate(() => window.presenceDev.me());
const endB = await b.page.evaluate(() => window.presenceDev.me());
const restA = await seen(b, a.id);
const restB = await seen(a, b.id);
check('B draws A where A stopped', restA && Math.hypot(restA.x - endA.x, restA.z - endA.z) < 0.05, { restA, endA });
check('A draws B where B stopped', restB && Math.hypot(restB.x - endB.x, restB.z - endB.z) < 0.05, { restB, endB });
check('A idles once stopped', restA && restA.speed < 0.05, restA);
await shot(b, 'presence-b-stopped.png');

// A walks up to the left table and sits: the table tells the floor, and B draws A in the seat.
await a.page.evaluate(() => window.presenceDev.walkTo(-2.4, 15.7));
await a.page.evaluate(() => window.presenceDev.sit('dev-hc-1'));
if (await until(b, 'B hears A sat at dev-hc-1', (id) => window.presenceDev.remotes().find((r) => r.id === id)?.at?.station === 'dev-hc-1', a.id)) {
  // The snap into the chair travels as one short move, so B draws a step into the seat first.
  const inSeat = (id) => {
    const r = window.presenceDev.remotes().find((p) => p.id === id);
    return r && r.visible && Math.hypot(r.x - -2.4, r.z - 15.15) < 0.05;
  };
  if (await until(b, 'B draws A in the seat', inSeat, a.id, 3000)) await shot(b, 'presence-b-seated.png');
}
await a.page.evaluate(() => window.presenceDev.stand());
await until(b, 'B sees A stand up', (id) => window.presenceDev.remotes().find((r) => r.id === id)?.at === null, a.id);
await a.page.evaluate(() => window.presenceDev.walkTo(-1.2, 17.2));
await sleep(700);

// A closes the tab: B sees them go and the count drop.
const before = await b.page.evaluate(() => window.presenceDev.me().online);
await a.ctx.close();
await until(b, 'B sees A leave', (id) => !window.presenceDev.remotes().some((r) => r.id === id), a.id);
await until(b, 'online count drops by one', (n) => window.presenceDev.me().online === n - 1, before);
await shot(b, 'presence-b-alone.png');
const frameMs = Math.round(await b.page.evaluate(() => window.presenceDev.me().frameMs));
await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ ok: failed.length === 0 && errors.length === 0, frameMs, checks, shots, errors: errors.slice(0, 10) }, null, 1));
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
