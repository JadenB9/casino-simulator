#!/usr/bin/env node
// The v6 boutique on the real stack: two players on the floor; A buys a ride, an emote, an effect
// (from the HUD's Effects list) and the statue through the screens themselves, and B sees each
// land: the emote passed on, the effect broadcast, the statue in the lobby's line-up. Then every
// boutique section is screenshotted, and the phone layout.
//
// Usage: node scripts/e2e/shop6.mjs [port] [outDir]    (--sw: SwiftShader instead of the GPU)
// Logs in as fixed names (shop6_e2e_a, shop6_e2e_b) and gives A winnings straight in the local
// database. Each run starts A over: what an earlier run bought is taken back and its price put back
// on the balance (so the money identity still holds) and A gets off the ride.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const [port = '6220', out = '/tmp/shop6-shots'] = args;
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

/** Winnings, the way a table pays them: a ledger row and the balance, together. */
function grant(name, dollars) {
  const cents = dollars * 100;
  const now = Date.now();
  sql(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) SELECT 'e2e-win:' || id || ':${now}', id, 'cashout', ${cents}, 'e2e', ${now} FROM casino_accounts WHERE name = '${name}'; UPDATE casino_accounts SET balance = balance + ${cents}, rev = rev + 1 WHERE name = '${name}';`);
}

/** SUM(ledger) - SUM(items) - SUM(orders) = balance, for one account. */
function balanced(name) {
  const r = JSON.parse(sql(`SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM casino_ledger l JOIN casino_accounts a ON a.id = l.account_id WHERE a.name = '${name}') -
    (SELECT COALESCE(SUM(price), 0) FROM casino_items i JOIN casino_accounts a ON a.id = i.account_id WHERE a.name = '${name}') -
    (SELECT COALESCE(SUM(price), 0) FROM casino_orders o JOIN casino_accounts a ON a.id = o.account_id WHERE a.name = '${name}') AS sum,
    (SELECT balance FROM casino_accounts WHERE name = '${name}') AS balance`))[0].results[0];
  return r.sum === r.balance;
}

async function enterAs(name, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && !/status of 404/.test(m.text()) && errors.push(m.text()));
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
  await p.waitForTimeout(1500);
  // everything the floor socket says, for the checks
  await p.evaluate(() => {
    window.heard = [];
    window.casino.app.link.subscribe((m) => window.heard.push(m));
  });
  await p.evaluate(`window.matches = ${matches.toString()}`);
  return { p, ctx, errors };
}

const refresh = (p) =>
  p.evaluate(async () => {
    const t = sessionStorage.getItem('casino.token');
    const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } });
    window.casino.session.set((await r.json()).profile);
  });

/**
 * What a page's floor socket has said matching `q`: its type, fields equal to `eq`, a list field
 * holding a value (`has: [field, value]`), a statue named `statue`, a look riding `ride`.
 */
function matches(m, q) {
  return m.t === q.t
    && Object.entries(q.eq ?? {}).every(([k, v]) => m[k] === v)
    && (!q.has || (m[q.has[0]] ?? []).includes(q.has[1]))
    && (!q.statue || (m.list ?? []).some((s) => s.name === q.statue))
    && (!q.ride || m.look?.ride === q.ride);
}
const heard = (p, q) => p.evaluate((q) => window.heard.filter((m) => window.matches(m, q)), q);
const waitHeard = (p, q, ms = 10000) => p.waitForFunction((q) => window.heard.some((m) => window.matches(m, q)), q, { timeout: ms });

const frames = (p, n = 20) => p.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function shot(p, name) {
  await frames(p);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', `${out}/${name}.png`);
}

/** Open the boutique at an id and wait for it to know what you own. */
async function openAt(p, id) {
  await p.evaluate((i) => window.casino.app.openShop(i), id);
  await p.waitForSelector(`.bq-item[data-id="${id}"][aria-selected="true"]`).catch(async (e) => {
    await p.screenshot({ path: `${out}/failed-open-${id}.png` }); // qa6: what was on screen instead
    throw e;
  });
  await p.waitForFunction(() => !document.querySelector('.bq-status')?.textContent?.startsWith('Checking'));
}

/** Buy what's picked through the confirm (if it isn't yours yet). */
async function buyPicked(p) {
  const label = (await p.textContent('.bq-primary')) ?? '';
  if (!label.startsWith('Buy')) return false;
  await p.click('.bq-primary');
  await p.waitForSelector('.modal .btn.primary');
  await p.click('.modal .btn.primary');
  await p.waitForFunction(() => document.querySelector('.bq-status')?.classList.contains('ok') || document.querySelector('.bq-status')?.classList.contains('err'), null, { timeout: 15000 });
  return true;
}

/** Take back what an earlier run bought (refunded, so ledger - items - orders = balance still holds). */
function startOver(name) {
  const items = "('skateboard', 'throwback', 'statue')";
  sql(`UPDATE casino_accounts SET balance = balance + (SELECT COALESCE(SUM(price), 0) FROM casino_items WHERE account_id = casino_accounts.id AND item IN ${items}),
         look = json_remove(look, '$.ride') WHERE name = '${name}';
       DELETE FROM casino_items WHERE item IN ${items} AND account_id = (SELECT id FROM casino_accounts WHERE name = '${name}');`);
}
try {
  startOver('shop6_e2e_a');
} catch {
  /* a fresh database: nobody to start over */
}

const a = await enterAs('shop6_e2e_a');
const b = await enterAs('shop6_e2e_b');
grant('shop6_e2e_a', 12_000_000);
await refresh(a.p);
// stand A in the lobby where B can see them
await a.p.evaluate(() => window.casino.world.player.teleport(0.6, 10.9, 0));
await b.p.evaluate(() => window.casino.world.player.teleport(0, 13.4, Math.PI));
await a.p.waitForTimeout(1200);

// --- a ride: bought, and A rides it
await openAt(a.p, 'skateboard');
await shot(a.p, 'rides');
await buyPicked(a.p);
if ((await a.p.textContent('.bq-primary')) === 'Ride it') await a.p.click('.bq-primary');
await a.p.waitForFunction(() => window.casino.session.profile.look.ride === 'skateboard', null, { timeout: 10000 });
check(true, 'A rides the skateboard');
await shot(a.p, 'rides-bought');
const aId = await a.p.evaluate(() => window.casino.session.profile.id);
await b.p.waitForFunction((id) => window.casino.app.link.players.get(id)?.info.look.ride === 'skateboard', aId, { timeout: 10000 }).then(
  () => check(true, 'B sees the ride on A'),
  () => fail('B sees the ride on A'),
);

// --- an emote: bought, `owned` arrives, and B sees A do it
await a.p.click('.bq-seg .seg-btn[data-id="emote"]');
await a.p.click('.bq-item[data-id="throwback"]');
await a.p.waitForTimeout(800);
await shot(a.p, 'emotes');
const boughtEmote = await buyPicked(a.p);
check(boughtEmote, 'A buys the Throw It Back');
if (boughtEmote) await waitHeard(a.p, { t: 'owned', has: ['emotes', 'throwback'] }).then(() => check(true, 'A hears owned: throwback'), () => fail('A hears owned: throwback'));
await shot(a.p, 'emotes-bought');
await a.p.keyboard.press('Escape');
await a.p.waitForTimeout(500);
await a.p.evaluate(() => window.casino.app.link.emote('throwback'));
await waitHeard(b.p, { t: 'emote', eq: { e: 'throwback' } }).then(() => check(true, 'B sees A throw it back'), () => fail('B sees A throw it back'));
// one A doesn't own goes nowhere
await b.p.waitForTimeout(2100);
await a.p.evaluate(() => window.casino.app.link.emote('backflip'));
await b.p.waitForTimeout(800);
check((await heard(b.p, { t: 'emote', eq: { e: 'backflip' } })).length === 0, "an emote A doesn't own isn't passed on");

// --- an effect, from the HUD's Effects list: two presses, then everyone hears it
check(!!(await a.p.$('.hud-btn[aria-label="Effects"]')), 'the HUD has an Effects button');
await a.p.evaluate(() => window.casino.app.openEffects());
await a.p.waitForSelector('.fx-sheet .fx-row');
await a.p.waitForTimeout(500);
await shot(a.p, 'effects-hud');
await a.p.click('.fx-play[aria-label^="Play Confetti Cannon"]');
await a.p.waitForTimeout(300);
await shot(a.p, 'effects-hud-armed');
await a.p.click('.fx-play[aria-label^="Confirm Confetti Cannon"]');
await waitHeard(b.p, { t: 'fx', eq: { fx: 'fx-confetti' } }).then(() => check(true, 'B hears the confetti'), () => fail('B hears the confetti'));
await a.p.waitForFunction(() => document.querySelector('.fx-sheet .bar-note')?.classList.contains('ok'), null, { timeout: 8000 }).catch(() => fail('the Effects list says it went off'));
await shot(a.p, 'effects-hud-bought');
await a.p.keyboard.press('Escape');
await b.p.evaluate(() => window.casino.world.player.teleport(-0.4, 11.4, Math.PI));
const [ev] = await heard(b.p, { t: 'fx', eq: { fx: 'fx-confetti' } });
check(ev && Math.abs(ev.x - 60) < 40 && Math.abs(ev.z - 1090) < 40, `the confetti plays where A stands (${ev?.x}, ${ev?.z})`);

// --- the statue
await openAt(a.p, 'statue');
await a.p.waitForTimeout(1200);
await shot(a.p, 'statue');
const boughtStatue = await buyPicked(a.p);
check(boughtStatue, 'A buys the statue');
if (boughtStatue) await waitHeard(b.p, { t: 'statues', statue: 'shop6_e2e_a' }).then(() => check(true, 'B sees the statue line-up change'), () => fail('B sees the statue line-up change'));
await a.p.waitForTimeout(800);
await shot(a.p, 'statue-bought');
check(await b.p.evaluate(() => window.casino.app.link.statues.some((s) => s.name === 'shop6_e2e_a')), 'the statues B knows include A');

// --- the other sections, for the record
await a.p.click('.bq-seg .seg-btn[data-id="wear"]');
await a.p.waitForTimeout(1200);
await shot(a.p, 'wear');
await a.p.click('.bq-sub .seg-btn[data-id="hat"]');
await a.p.click('.bq-item[data-id="gold-crown"]');
await a.p.waitForTimeout(1200);
await shot(a.p, 'wear-crown');
await a.p.click('.bq-item[data-id="panama-hat"]');
await a.p.click('.bq-seg .seg-btn[data-id="fx"]');
await a.p.click('.bq-item[data-id="fx-goldenhour"]');
await a.p.waitForTimeout(1500);
await shot(a.p, 'effects');
await a.p.click('.bq-item[data-id="fx-disco"]');
await a.p.waitForTimeout(1500);
await shot(a.p, 'effects-disco');
// the private collection, in its case
await a.p.click('.bq-seg .seg-btn[data-id="vault"]');
await a.p.waitForTimeout(1200);
await shot(a.p, 'vault');
await a.p.click('.bq-item[data-id="emperor-robe"]');
await a.p.waitForTimeout(1500);
await shot(a.p, 'vault-robe');
check((await a.p.$$('.bq-item.vault')).length === 5, 'the Vault shows the five pieces of the collection');
await a.p.keyboard.press('Escape');
await a.p.waitForTimeout(400);
check(!(await a.p.$('.boutique')), 'Esc closes the boutique');

check(balanced('shop6_e2e_a'), 'the money identity holds for A');
const owned = JSON.parse(sql(`SELECT item FROM casino_items i JOIN casino_accounts a ON a.id = i.account_id WHERE a.name = 'shop6_e2e_a'`))[0].results.map((r) => r.item);
check(['skateboard', 'throwback', 'statue'].every((i) => owned.includes(i)), `A owns the ride, the emote and the statue (${owned.join(', ')})`);
const orders = JSON.parse(sql(`SELECT count(*) AS n FROM casino_orders o JOIN casino_accounts a ON a.id = o.account_id WHERE a.name = 'shop6_e2e_a' AND o.op_id LIKE 'fx:%'`))[0].results[0].n;
check(orders >= 1, `A's effects are casino_orders rows (${orders})`);

// --- a phone
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pp = await phone.newPage();
await pp.goto(`http://localhost:${port}/casino/src/ui/shop/dev.html?screen=boutique&fixture=1&section=fx`, { timeout: 180000 });
await pp.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
await pp.waitForTimeout(2500);
await shot(pp, 'phone-effects');
await pp.click('.bq-seg .seg-btn[data-id="emote"]');
await pp.waitForTimeout(1200);
await shot(pp, 'phone-emotes');
await phone.close();

for (const [who, r] of [['A', a], ['B', b]]) if (r.errors.length) fail(`${who} errors: ${r.errors.slice(0, 5).join(' | ')}`);
await a.ctx.close();
await b.ctx.close();
console.log(failed ? `${failed} failed` : 'ok');
await browser.close();
process.exit(failed ? 1 : 0);
