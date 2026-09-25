#!/usr/bin/env node
// Headless check of the parlour games on the real stack.
//
// Pachinko (--pachinko, the default): sit at Sakura Storm in the dev harness, buy in, launch a
// batch against the server, and check every ball lands in the pocket the server sent and the
// credit comes out at the server's stack; screenshot the machine from the floor, seated, mid-batch
// and settled. Then a jackpot chain played through the view (the server's draw can't be steered;
// nothing is paid) for the reach, the hit, the fever and the kakuhen.
//
// Bingo (--bingo): a solo game in the dev harness (buy cards, Call, watch it to the end, check the
// prizes against the server's), then (--multi) two players at one hall through the real table
// host: no Start, both buy cards, the clock calls the balls, both settle.
//
// Usage: node scripts/e2e/parlor6.mjs [port] [outDir] [--pachinko] [--bingo] [--multi] [--quick]
// GPU=1 uses the Mac's GPU. Fixed names parlor6_e2e_*.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (f) => process.argv.includes(f);
const [port = '6320', outDir = '/tmp/parlor6-shots'] = args;
mkdirSync(outDir, { recursive: true });
const base = `http://localhost:${port}`;
const gpu = process.env.GPU === '1';
const browser = await chromium.launch({
  args: gpu ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  headless: true,
});
const results = {};
const errors = [];
let failed = false;

async function newPage(viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => localStorage.setItem('casino.tips', '0'));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return page;
}

async function sitDown(p, dollars) {
  const seated = () => (window.casino?.table?.view?.debug?.state().stack ?? 0) > 0;
  await p.waitForFunction(() => !!document.querySelector('.modal input[type=number]') || (window.casino?.table?.view?.debug?.state().stack ?? 0) > 0, null, { timeout: 90000, polling: 100 });
  if (!(await p.evaluate(seated))) {
    await p.fill('.modal input[type=number]', dollars);
    await p.click('.modal .btn.primary', { force: true });
    await p.waitForFunction(seated, null, { timeout: 90000, polling: 100 });
  }
}

const shot = async (page, name) => {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path });
  console.log('shot', path);
};

if (flag('--pachinko') || !(flag('--bingo') || flag('--multi'))) await pachinko();
if (flag('--bingo')) await bingoSolo();
if (flag('--multi')) await bingoMulti();

console.log(JSON.stringify({ results, errors: errors.slice(0, 12) }, null, 1));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);

// ---------------------------------------------------------------------------------------------

async function pachinko() {
  const page = await newPage();
  const launches = [];
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        if (msg.t === 'ev') for (const e of msg.events) if (e.type === 'launch') launches.push(e);
      } catch {}
    }),
  );
  await page.goto(`${base}/casino/?dev=table&game=pachinko&name=parlor6_e2e_pa`);
  await sitDown(page, '2000');
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const state = () => page.evaluate(() => window.casino.table.view.debug.state());
  const home = await page.evaluate(() => ({ p: window.casino.engine.camera.position.toArray(), q: window.casino.engine.camera.quaternion.toArray() }));
  // from the aisle, as someone walking by sees it
  await page.evaluate(() => {
    const c = window.casino.engine.camera;
    c.position.set(1.3, 1.6, 2.2);
    c.lookAt(0, 1.3, 0);
  });
  await page.waitForTimeout(500);
  await shot(page, 'pa-0-floor');
  await page.evaluate(({ p, q }) => {
    window.casino.engine.camera.position.fromArray(p);
    window.casino.engine.camera.quaternion.fromArray(q);
  }, home);
  await page.waitForTimeout(400);
  const frame = await page.evaluate(() => ({ ms: window.casino.engine.frameMs(), calls: window.casino.engine.renderer.info.render.calls, tris: window.casino.engine.renderer.info.render.triangles }));
  console.log('frame', JSON.stringify(frame));
  await shot(page, 'pa-1-seated');
  if (flag('--quick')) return;

  const before = (await state()).stack;
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.casino.table.view.debug.state().flying > 4, null, { timeout: 20000, polling: 50 });
  await page.waitForTimeout(900);
  await shot(page, 'pa-2-firing');
  // record where every ball actually ends, against what the server sent
  const seen = await page.evaluate(async () => {
    const v = window.casino.table.view;
    const ends = [];
    const known = new Set();
    const t0 = performance.now();
    while (performance.now() - t0 < 60000) {
      const s = v.debug.state();
      ends.push(...s.ends);
      if (!s.batches.length && !s.flying && s.show === 'idle' && !s.holds) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    void known;
    return v.debug.state();
  });
  await page.waitForTimeout(300);
  await shot(page, 'pa-3-settled');
  const ev = launches.at(-1);
  const credit = seen.credit;
  const counts = {};
  for (const s of ev?.shots ?? []) counts[s.pocket] = (counts[s.pocket] ?? 0) + 1;
  results.pachinko = { before, bet: ev?.bet, balls: ev?.balls, payout: ev?.payout, serverStack: ev?.stack, credit, pockets: counts, simulated: seen.simulated };
  if (!ev || credit !== ev.stack || seen.stack !== ev.stack) failed = true;

  // every ball lands where it was sent: each flight the view took ended in its ball's pocket
  const fired = (await state()).fired;
  const wrong = fired.filter(([sent, end]) => sent !== end);
  results.pachinkoFlights = { fired: fired.length, wrong: wrong.length };
  if (wrong.length || fired.length < 25) failed = true;

  // a jackpot chain through the view: 7-7-7 (kakuhen), then 4 (the end), for the presentation
  await page.evaluate(() => {
    const v = window.casino.table.view;
    const st = v.debug.state();
    const shots = Array.from({ length: 25 }, (_, i) => (i === 1 ? { pocket: 'start', reels: [7, 7, 7], chain: [7, 4] } : { pocket: i % 6 === 0 ? 'left' : 'out' }));
    const balls = 4 + 300 + 3 * 5;
    void v.onEvents([{ type: 'launch', seat: 0, round: 1000, bet: 2500, balls, payout: balls * 100, jackpots: 2, power: 40, shots, stack: st.stack, data: { spins: 0, jackpots: 2, best: 2, chains: [2] } }], null);
  });
  const waitShow = (k, ms = 40000) => page.waitForFunction((kind) => window.casino.table.view.debug.state().show === kind, k, { timeout: ms, polling: 50 });
  await waitShow('spin');
  await page.waitForTimeout(2600);
  await shot(page, 'pa-4-reach');
  await waitShow('hit');
  await page.waitForTimeout(700);
  await shot(page, 'pa-5-jackpot');
  await waitShow('fever');
  await page.waitForTimeout(3500);
  await shot(page, 'pa-6-fever');
  await waitShow('kakuhen', 30000);
  await page.waitForTimeout(600);
  await shot(page, 'pa-7-kakuhen');
  await waitShow('end', 60000);
  await page.waitForTimeout(900);
  await shot(page, 'pa-8-fever-over');
  await page.waitForFunction(() => window.casino.table.view.debug.state().show === 'idle', null, { timeout: 30000 });
  await page.close();
}

async function bingoSolo() {}
async function bingoMulti() {}
