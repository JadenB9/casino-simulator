#!/usr/bin/env node
// The valet and the garage on the real stack: log in, go down to the valet stand out front, E
// opens the valet, buy a car (charged once, the money still adds up), have it brought round (the
// car drives down to the curb and the valet hands over the keys), then cross the street to the
// garage and see it on display with its plaque. Screenshots of each step.
//
// Usage: node scripts/e2e/cars6.mjs [port] [outDir]     (--sw: SwiftShader instead of the GPU)
// Logs in as cars6_e2e_1 (and cars6_e2e_2, who watches the car pull up) with the dev password,
// and gives the first one winnings straight in the local database.
//
// Getting to the ground floor: the elevator when the city is in (the `lift` message), else the
// client is put there and the server told nothing (the call then has to be refused: the floor
// still thinks you're in the casino).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const [port = '6360', out = '/tmp/cars6-shots'] = args;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  flag('sw') ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--ignore-gpu-blocklist'] },
);
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : fail(what));

function sql(command) {
  return execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } }).toString();
}
const rows = (command) => JSON.parse(sql(command))[0].results;

function grant(name, dollars) {
  const cents = dollars * 100;
  const now = Date.now();
  sql(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) SELECT 'e2e-win:' || id || ':${now}', id, 'cashout', ${cents}, 'e2e', ${now} FROM casino_accounts WHERE name = '${name}'; UPDATE casino_accounts SET balance = balance + ${cents}, rev = rev + 1 WHERE name = '${name}';`);
}

function balanced(name) {
  const r = rows(`SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l JOIN casino_accounts a ON a.id = l.account_id WHERE a.name = '${name}') -
    (SELECT COALESCE(SUM(price), 0) FROM casino_items i JOIN casino_accounts a ON a.id = i.account_id WHERE a.name = '${name}') -
    (SELECT COALESCE(SUM(price), 0) FROM casino_orders o JOIN casino_accounts a ON a.id = o.account_id WHERE a.name = '${name}') AS sum,
    (SELECT balance FROM casino_accounts WHERE name = '${name}') AS balance`)[0];
  return r.sum === r.balance;
}

async function enterAs(name, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && !/status of (404|409)/.test(m.text()) && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://localhost:${port}/casino/`, { timeout: 180000 });
  await p.waitForSelector('.name-input', { timeout: 180000 });
  await p.fill('.name-input', name);
  if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
  await p.click('.enter-btn');
  await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 30000 });
  if (await p.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) {
      await p.click('.editor-panel .ed-buttons .btn.primary');
      await p.waitForTimeout(500);
    }
  } else {
    await p.click('.menu-item >> nth=0');
  }
  await p.waitForSelector('.hud', { timeout: 30000 });
  await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20000 });
  await p.evaluate(() => {
    window.heard = [];
    window.casino.app.link.subscribe((m) => window.heard.push(m));
  });
  return { p, ctx, errors };
}

const shot = (p, name) => p.screenshot({ path: `${out}/${name}.png` }).then(() => console.log(`     ${out}/${name}.png`));

/** Down to the valet stand: the elevator if the city is in, else put there on this client only. */
async function toStand(p) {
  const lifted = await p.evaluate(async () => {
    const c = window.casino;
    if (typeof c.app.lift === 'function') {
      await c.app.lift('ground');
      return true;
    }
    return false;
  }).catch(() => false);
  // then walk up to the podium from the lobby side (the stand is at 129.6, 5.0; E faces -x)
  await p.evaluate(() => window.casino.world.teleport(128.3, 5.0, Math.PI / 2));
  await p.waitForTimeout(1200);
  return lifted;
}

// --- one: buy at the valet --------------------------------------------------------------------

const NAME = 'cars6_e2e_1';
const CAR = 'stallard-440';
const a = await enterAs(NAME);
grant(NAME, 2_000_000);
await a.p.evaluate(async () => {
  const t = sessionStorage.getItem('casino.token');
  const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } });
  window.casino.session.set((await r.json()).profile);
});
const lifted = await toStand(a.p);
console.log(lifted ? 'down in the elevator' : 'no elevator yet: put by the stand on this client');
check(await a.p.evaluate(() => window.casino.app.cars.shown), 'the ground floor is drawn once the camera is down there');
const prompt = await a.p.textContent('.world-prompt').catch(() => '');
check(/Valet/.test(prompt ?? ''), `E prompt at the podium ("${prompt?.trim()}")`);
await shot(a.p, '01-stand');

await a.p.keyboard.press('KeyE');
await a.p.waitForSelector('.boutique.valet', { timeout: 5000 }).catch(() => fail('E opens the valet'));
await a.p.waitForFunction(() => !document.querySelector('.valet .bq-status')?.textContent?.startsWith('Checking'), null, { timeout: 10000 });
await a.p.click(`.valet .bq-item[data-id="${CAR}"]`);
await a.p.waitForTimeout(900);
await shot(a.p, '02-valet');
const owned0 = rows(`SELECT count(*) AS n FROM casino_items i JOIN casino_accounts a ON a.id = i.account_id WHERE a.name = '${NAME}' AND i.item = '${CAR}'`)[0].n;
if (owned0 === 0) {
  const before = rows(`SELECT balance FROM casino_accounts WHERE name = '${NAME}'`)[0].balance;
  await a.p.click('.valet .bq-primary');
  await a.p.waitForSelector('.modal .btn.primary', { timeout: 5000 });
  await shot(a.p, '03-confirm');
  await a.p.click('.modal .btn.primary');
  await a.p.waitForFunction(() => document.querySelector('.valet .bq-status')?.classList.contains('ok') || document.querySelector('.valet .bq-status')?.classList.contains('err'), null, { timeout: 15000 });
  const said = await a.p.textContent('.valet .bq-status');
  check(/is yours/.test(said ?? ''), `bought: "${said}"`);
  const after = rows(`SELECT balance FROM casino_accounts WHERE name = '${NAME}'`)[0].balance;
  check(before - after === 650_000 * 100, `charged $650,000 once (${(before - after) / 100})`);
} else console.log('     already owned from an earlier run');
check(balanced(NAME), 'the money adds up: ledger - items - orders = balance');
check(await a.p.evaluate((car) => window.casino.session.profile.owned?.includes(car), CAR), 'the profile owns it');
await shot(a.p, '04-bought');

// --- have it brought round ----------------------------------------------------------------------

const b = await enterAs('cars6_e2e_2', { width: 1100, height: 700 });
const label = await a.p.textContent('.valet .bq-primary');
check(/Bring it round/.test(label ?? ''), `the button offers to bring it round ("${label}")`);
await a.p.click('.valet .bq-primary');
await a.p.waitForTimeout(1500);
const open = await a.p.$('.boutique.valet');
if (!open) {
  check(true, 'the valet went for it (the panel closed to watch)');
  const heardA = await a.p.waitForFunction(() => window.heard.some((m) => m.t === 'car'), null, { timeout: 5000 }).then(() => true, () => false);
  check(heardA, 'the floor told the caller');
  const heardB = await b.p.waitForFunction((id) => window.heard.some((m) => m.t === 'car' && m.id === id), await a.p.evaluate(() => window.casino.app.link.you.id), { timeout: 5000 }).then(() => true, () => false);
  check(heardB, 'the floor told another player');
  await a.p.waitForTimeout(4000);
  await shot(a.p, '05-arriving');
  await a.p.waitForTimeout(6000);
  await shot(a.p, '06-keys');
  const toasts = await a.p.$$eval('.toast', (t) => t.map((x) => x.textContent));
  check(toasts.some((t) => /hands you the keys/.test(t ?? '')), 'the keys handed over');
} else {
  const said = await a.p.textContent('.valet .bq-status');
  check(!lifted && /valet stand/.test(said ?? ''), `without the elevator the floor refuses the call ("${said}")`);
  await a.p.keyboard.press('Escape');
  await a.p.waitForTimeout(400);
  // show the pull-up on this client, the way the floor's message would
  await a.p.evaluate(async (car) => {
    const c = window.casino;
    const now = Date.now();
    c.app.cars.hear({ t: 'car', id: c.app.link.you.id, name: 'me', car, slot: 0, at: now, until: now + 120000 });
  }, CAR);
  await a.p.waitForTimeout(4000);
  await shot(a.p, '05-arriving');
  await a.p.waitForTimeout(6500);
  await shot(a.p, '06-keys');
}

// --- across the street to the garage -------------------------------------------------------------

await a.p.evaluate(() => window.casino.world.teleport(172, 25, Math.PI / 2 + 0.25));
await a.p.waitForTimeout(1500);
check(await a.p.evaluate((car) => window.casino.app.cars.garage['key'].includes(car), CAR), 'the garage shows the car');
await shot(a.p, '07-garage');
await a.p.evaluate(() => window.casino.world.teleport(164, 25, Math.PI / 2));
await a.p.waitForTimeout(1200);
await shot(a.p, '08-garage-street');
const stats = await a.p.evaluate(() => window.casino.world.stats());
console.log(`     draw calls at the garage's front: ${stats.calls}, triangles ${stats.triangles}`);

for (const x of [a, b]) {
  check(x.errors.length === 0, `no console errors (${x.errors.slice(0, 3).join(' | ')})`);
  await x.ctx.close();
}
await browser.close();
console.log(failed ? `${failed} failed` : 'all ok');
process.exit(failed ? 1 : 0);
