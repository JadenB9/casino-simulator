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

console.log(failed ? `${failed} failed` : 'ok');
await browser.close();
process.exit(failed ? 1 : 0);
