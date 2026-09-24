#!/usr/bin/env node
// Headless looks at the boutique, the bar and what they sell: every piece up close in the
// showroom, characters wearing them on the floor, the boutique and bar sheets against the local
// worker, and a buy, a wear and an order end to end.
//
// Usage: node scripts/e2e/shop.mjs [port] [outDir] [checks...]   (checks: wear floor boutique bar; default all)
//   --sw          SwiftShader instead of the machine's GPU (new headless Chrome gets the GPU)
//   --only=a,b    in `wear`, only the cases whose name contains one of these
// The shop and bar checks log in as fixed names (shop_e2e, shop_e2e2) and give the first one
// winnings straight in the local database, so it can afford the boutique.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const [port = '6030', out = '/tmp/shop-shots', ...wanted] = args;
const checks = wanted.length ? wanted : ['wear', 'floor', 'boutique', 'bar'];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  flag('sw') ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--ignore-gpu-blocklist'] },
);
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};

async function page(url, viewport = { width: 1280, height: 800 }) {
  const p = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(url, { timeout: 180000 });
  return { p, errors };
}

const frames = (p, n = 4) => p.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// --- every piece up close -------------------------------------------------------------------------

const M = { v: 1, body: 'm', outfit: 'suit', skin: 2, hair: '#2b1d14', top: '#1f2430', bottom: '#1f2430', shoes: '#111111' };
const F = { v: 1, body: 'f', outfit: 'smart', skin: 1, hair: '#3a2415', top: '#1d2233', bottom: '#1d2233', shoes: '#111111' };
const held = (item) => ({ item, order: 'dev-order-0001', until: Date.now() + 3_600_000 });

const WEAR = [
  ['chain-rope', { ...M, chain: 'rope-chain' }, 'chest', 0],
  ['chain-figaro', { ...M, chain: 'figaro' }, 'chest', 0],
  ['chain-cuban', { ...M, chain: 'cuban-link' }, 'chest', 0],
  ['chain-iced', { ...M, chain: 'iced-cuban' }, 'chest', 0],
  ['chain-dice', { ...M, chain: 'dice-pendant' }, 'chest', 0],
  ['chain-ace', { ...M, chain: 'ace-pendant' }, 'chest', 0],
  ['chain-cuban-hoodie', { ...M, outfit: 'hoodie', top: '#3a3f4a', chain: 'cuban-link' }, 'chest', 0.25],
  ['chain-cuban-f', { ...F, outfit: 'dress', chain: 'cuban-link' }, 'chest', 0],
  ['chain-rope-back', { ...M, chain: 'rope-chain' }, 'chest', 2.6],
  ['grill-top-six', { ...M, grill: 'gold-top-six' }, 'face', 0.15],
  ['grill-full', { ...M, grill: 'full-gold' }, 'face', 0.15],
  ['grill-rose', { ...M, grill: 'rose-gold' }, 'face', 0.15],
  ['grill-diamond', { ...M, grill: 'diamond-set' }, 'face', 0.15],
  ['grill-f', { ...F, grill: 'full-gold' }, 'face', 0.15],
  ['watch-gold', { ...M, watch: 'gold-watch' }, 'wrist', null],
  ['watch-iced', { ...M, watch: 'iced-watch' }, 'wrist', null],
  ['shades', { ...M, shades: 'gold-aviators' }, 'face', 0.35],
  ['shades-f', { ...F, shades: 'gold-aviators' }, 'face', 0.35],
  ['hat-fedora', { ...M, hat: 'black-fedora' }, 'head', 0.5],
  ['hat-panama', { ...M, hat: 'panama-hat' }, 'head', 0.5],
  ['hat-f', { ...F, hat: 'black-fedora' }, 'head', 0.5],
  ['clothes-tracksuit', { ...M, clothes: 'gold-tracksuit' }, 'full', -0.35],
  ['clothes-tux', { ...M, clothes: 'white-tuxedo' }, 'full', -0.35],
  ['clothes-velvet', { ...M, clothes: 'velvet-jacket' }, 'full', -0.35],
  ['clothes-fur', { ...M, clothes: 'fur-coat' }, 'full', -0.35],
  ['clothes-diamond', { ...M, clothes: 'diamond-suit' }, 'full', -0.35],
  ['clothes-tux-close', { ...M, clothes: 'white-tuxedo' }, 'chest', 0],
  ['clothes-fur-f', { ...F, clothes: 'fur-coat' }, 'full', -0.35],
  ['clothes-diamond-f', { ...F, clothes: 'diamond-suit' }, 'full', -0.35],
  ['clothes-tracksuit-f', { ...F, clothes: 'gold-tracksuit' }, 'full', -0.35],
  ['clothes-tux-f', { ...F, clothes: 'white-tuxedo' }, 'full', -0.35],
  ['clothes-velvet-f', { ...F, clothes: 'velvet-jacket' }, 'full', -0.35],
  ['clothes-fur-close', { ...M, clothes: 'fur-coat' }, 'chest', 0.3],
  ['held-beer', { ...M, held: held('beer') }, 'hand', null],
  ['held-cocktail', { ...M, held: held('cocktail') }, 'hand', null],
  ['held-champagne', { ...M, held: held('champagne') }, 'hand', null],
  ['held-dom', { ...M, held: held('dom') }, 'hand', null],
  ['held-whiskey', { ...M, held: held('whiskey') }, 'hand', null],
  ['held-wine', { ...M, held: held('red-wine') }, 'hand', null],
  ['held-espresso', { ...M, held: held('espresso') }, 'hand', null],
  ['held-sliders', { ...M, held: held('sliders') }, 'hand', null],
  ['held-lobster', { ...M, held: held('lobster') }, 'hand', null],
  ['held-full', { ...M, held: held('champagne') }, 'full', 0.6],
  ['all-in', { ...M, chain: 'iced-cuban', grill: 'diamond-set', watch: 'iced-watch', shades: 'gold-aviators', hat: 'black-fedora', clothes: 'white-tuxedo', held: held('champagne') }, 'full', -0.3],
];

if (checks.includes('wear')) {
  const { p, errors } = await page(`http://localhost:${port}/casino/src/ui/shop/dev.html?screen=wear`, { width: 900, height: 900 });
  await p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  for (const [name, look, view, yaw] of WEAR) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    await p.evaluate(([l, v, y]) => window.dev.wear(l, v, y), [look, view, yaw]);
    // models load once; give the pieces a moment and the camera time to settle
    await p.waitForTimeout(900);
    await frames(p, 30);
    await p.screenshot({ path: `${out}/wear-${name}.png` });
    console.log('shot', `${out}/wear-${name}.png`);
  }
  if (errors.length) fail(`wear page errors: ${errors.slice(0, 5).join(' | ')}`);
  await p.close();
}

// --- the boutique and the bar, with a canned high roller (no server) -------------------------------

async function sheet(screen, viewport) {
  const r = await page(`http://localhost:${port}/casino/src/ui/shop/dev.html?screen=${screen}&fixture=1&delay=1500`, viewport);
  await r.p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  return r;
}

async function shot(p, name) {
  await frames(p, 20);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', `${out}/${name}.png`);
}

if (checks.includes('boutique')) {
  const { p, errors } = await sheet('boutique', { width: 1440, height: 900 });
  await p.waitForSelector('.bq-item');
  await p.waitForFunction(() => !document.querySelector('.bq-status')?.textContent?.startsWith('Checking'));
  await p.waitForTimeout(1200);
  await shot(p, 'boutique-chains');
  await p.click('.bq-item[data-id="iced-cuban"]');
  await p.waitForTimeout(1200);
  await shot(p, 'boutique-iced');
  if (!(await p.textContent('.bq-primary'))?.startsWith('Buy')) fail('an unowned piece offers Buy');
  await p.click('.bq-seg .seg-btn[data-id="grill"]');
  await p.waitForTimeout(1200);
  await shot(p, 'boutique-grills');
  if ((await p.textContent('.bq-item[aria-selected="true"] .bq-chip')) !== 'Owned') fail('the grills tab opens on the one you own');
  await p.click('.bq-seg .seg-btn[data-id="clothes"]');
  await p.click('.bq-item[data-id="velvet-jacket"]');
  await p.waitForTimeout(1500);
  await shot(p, 'boutique-clothes');
  // buy: a confirm that says the balance after, then it's yours and you're wearing it
  await p.click('.bq-primary');
  await p.waitForSelector('.modal');
  await shot(p, 'boutique-confirm');
  const confirm = await p.textContent('.modal');
  if (!/Balance after: \$2,718,200/.test(confirm ?? '')) fail(`confirm shows the balance after: ${confirm}`);
  await p.click('.modal .btn.primary');
  await p.waitForFunction(() => document.querySelector('.bq-item[data-id="velvet-jacket"] .bq-chip')?.textContent === 'Wearing', null, { timeout: 10000 });
  await p.waitForTimeout(800);
  await shot(p, 'boutique-bought');
  if ((await p.textContent('.bq-money-val')) !== '$2,718,200') fail('the balance drops by the price');
  // too dear: the button says so and is off
  await p.click('.bq-item[data-id="diamond-suit"]');
  await p.waitForTimeout(600);
  if (!(await p.isDisabled('.bq-primary'))) fail('an item you cannot afford cannot be bought');
  await shot(p, 'boutique-short');
  // Esc closes it
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  if (await p.$('.boutique')) fail('Esc closes the boutique');
  if (errors.length) fail(`boutique errors: ${errors.slice(0, 5).join(' | ')}`);
  await p.close();
  const phone = await sheet('boutique', { width: 390, height: 844 });
  await phone.p.waitForSelector('.bq-item');
  await phone.p.waitForTimeout(1500);
  await shot(phone.p, 'boutique-phone');
  await phone.p.close();
}

if (checks.includes('bar')) {
  const { p, errors } = await sheet('bar', { width: 1280, height: 800 });
  await p.waitForSelector('.bar-item');
  await p.waitForTimeout(800);
  await shot(p, 'bar-menu');
  await p.click('.bar-order[aria-label^="Order Champagne"]');
  await p.waitForFunction(() => document.querySelector('.bar-status')?.textContent?.includes('On its way'), null, { timeout: 5000 });
  await shot(p, 'bar-ordered');
  await p.waitForFunction(() => document.querySelector('.bar-status')?.textContent?.startsWith('In your hand: Champagne'), null, { timeout: 8000 });
  await shot(p, 'bar-holding');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await p.evaluate(() => window.dev.room.show('hand'));
  await p.waitForTimeout(1500);
  await shot(p, 'bar-in-hand');
  if (errors.length) fail(`bar errors: ${errors.slice(0, 5).join(' | ')}`);
  await p.close();
}

// --- on the floor, against the local worker ---------------------------------------------------------

/** Winnings, the way a table pays them: a ledger row and the balance, in the local database. */
function grant(name, dollars) {
  const cents = dollars * 100;
  const now = Date.now();
  const sql = `INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) SELECT 'e2e-win:' || id || ':${now}', id, 'cashout', ${cents}, 'e2e', ${now} FROM casino_accounts WHERE name = '${name}'; UPDATE casino_accounts SET balance = balance + ${cents}, rev = rev + 1 WHERE name = '${name}';`;
  execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', sql], { stdio: 'pipe', env: { ...process.env, CI: '1' } });
}

async function enterAs(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://localhost:${port}/casino/`, { timeout: 180000 });
  await p.waitForSelector('.name-input', { timeout: 180000 });
  await p.fill('.name-input', name);
  if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
  await p.click('.enter-btn');
  await p.waitForSelector('.menu-item', { timeout: 30000 });
  await p.click('.menu-item >> nth=0');
  await p.waitForSelector('.hud', { timeout: 30000 });
  await p.waitForTimeout(1500);
  return { p, ctx, errors };
}

const refresh = (p) =>
  p.evaluate(async () => {
    const t = sessionStorage.getItem('casino.token');
    const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } });
    window.casino.session.set((await r.json()).profile);
  });

/** Buy (unless it's already yours) and wear, through the boutique itself. */
async function buyAndWear(p, item) {
  await p.evaluate((id) => window.casino.app.openShop(id), item);
  await p.waitForSelector(`.bq-item[data-id="${item}"][aria-selected="true"]`);
  await p.waitForFunction(() => !document.querySelector('.bq-status')?.textContent?.startsWith('Checking'));
  const label = (await p.textContent('.bq-primary')) ?? '';
  if (label.startsWith('Buy')) {
    await p.click('.bq-primary');
    await p.waitForSelector('.modal .btn.primary');
    await p.click('.modal .btn.primary');
  } else if (label === 'Wear') {
    await p.click('.bq-primary');
  }
  await p.waitForFunction((id) => document.querySelector(`.bq-item[data-id="${id}"] .bq-chip`)?.textContent === 'Wearing', item, { timeout: 15000 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
}

if (checks.includes('floor')) {
  const a = await enterAs('shop_e2e');
  const b = await enterAs('shop_e2e2');
  grant('shop_e2e', 5_000_000);
  await refresh(a.p);
  const before = await a.p.evaluate(() => window.casino.session.profile.balance);
  for (const item of ['cuban-link', 'full-gold', 'gold-watch']) await buyAndWear(a.p, item);
  const look = await a.p.evaluate(() => window.casino.session.profile.look);
  if (look.chain !== 'cuban-link' || look.grill !== 'full-gold' || look.watch !== 'gold-watch') fail(`the look wears what was bought: ${JSON.stringify(look)}`);
  // the bar: order, and it's in the hand a few seconds later (no waiters yet)
  await a.p.evaluate(() => window.casino.app.openBarMenu());
  await a.p.click('.bar-order[aria-label^="Order Champagne"]');
  await a.p.waitForFunction(() => document.querySelector('.bar-status')?.textContent?.startsWith('In your hand: Champagne'), null, { timeout: 12000 });
  await a.p.keyboard.press('Escape');
  const after = await a.p.evaluate(() => window.casino.session.profile.balance);
  console.log(`balance ${before / 100} -> ${after / 100}`);
  // stand A where B can see them, facing B
  await a.p.evaluate(() => window.casino.world.player.teleport(0.6, 10.9, 0));
  await b.p.evaluate(() => window.casino.world.player.teleport(0, 13.4, Math.PI));
  await b.p.waitForTimeout(2500);
  const seen = await b.p.evaluate(() => {
    const me = window.casino.app;
    return [...(window.casino.world.characterFactory.people?.() ?? [])].length;
  });
  // B looks at A over their shoulder, then close
  await b.p.evaluate(() => {
    const { engine, world } = window.casino;
    world.player.setEnabled(false);
    world.player.character.root.visible = false;
    engine.onFrame(() => {
      engine.camera.position.set(0.25, 1.62, 12.9);
      engine.camera.lookAt(0.6, 1.25, 10.9);
    });
  });
  await b.p.waitForTimeout(1200);
  await shot(b.p, 'floor-remote');
  await b.p.evaluate(() => {
    const { engine } = window.casino;
    engine.onFrame(() => {
      engine.camera.position.set(0.55, 1.5, 11.85);
      engine.camera.lookAt(0.6, 1.36, 10.9);
    });
  });
  await b.p.waitForTimeout(800);
  await shot(b.p, 'floor-remote-close');
  // a lineup at floor distance: every chain, grill and outfit on characters in front of B
  await b.p.evaluate(() => {
    const { engine, world } = window.casino;
    const f = world.characterFactory;
    const M = { v: 1, body: 'm', outfit: 'suit', skin: 2, hair: '#2b1d14', top: '#1f2430', bottom: '#1f2430', shoes: '#111111' };
    const F = { v: 1, body: 'f', outfit: 'smart', skin: 1, hair: '#3a2415', top: '#1d2233', bottom: '#1d2233', shoes: '#111111' };
    const looks = [
      { ...M, chain: 'rope-chain' }, { ...M, chain: 'figaro', grill: 'gold-top-six' }, { ...M, chain: 'iced-cuban', grill: 'diamond-set' },
      { ...F, chain: 'dice-pendant' }, { ...M, chain: 'ace-pendant', grill: 'rose-gold', shades: 'gold-aviators' },
      { ...M, clothes: 'gold-tracksuit', chain: 'cuban-link' }, { ...M, clothes: 'white-tuxedo', hat: 'black-fedora' }, { ...M, clothes: 'velvet-jacket', watch: 'gold-watch' },
      { ...F, clothes: 'fur-coat', shades: 'gold-aviators' }, { ...M, clothes: 'diamond-suit', hat: 'panama-hat', held: { item: 'champagne', order: 'x-order-00001', until: Date.now() + 9e6 } },
    ];
    window.lineup = looks.map((look, i) => {
      const c = f.create(look, '');
      const row = i < 5 ? 0 : 1;
      c.root.position.set(-2.6 + (i % 5) * 1.3, 0, 9.4 - row * 1.9);
      engine.scene.add(c.root);
      engine.onFrame((dt) => c.update(dt));
      return c;
    });
    engine.onFrame(() => {
      engine.camera.position.set(0, 1.75, 12.6);
      engine.camera.lookAt(0, 1.05, 8.6);
    });
  });
  await b.p.waitForTimeout(4000);
  await shot(b.p, 'floor-lineup');
  await b.p.evaluate(() => {
    const { engine } = window.casino;
    engine.onFrame(() => {
      engine.camera.position.set(-1.3, 1.55, 10.95);
      engine.camera.lookAt(-1.3, 1.35, 9.4);
    });
  });
  await b.p.waitForTimeout(800);
  await shot(b.p, 'floor-lineup-close');
  for (const [who, r] of [['shop_e2e', a], ['shop_e2e2', b]]) if (r.errors.length) fail(`${who} errors: ${r.errors.slice(0, 5).join(' | ')}`);
  await a.ctx.close();
  await b.ctx.close();
}

console.log(failed ? `${failed} failed` : 'ok');
await browser.close();
process.exit(failed ? 1 : 0);
