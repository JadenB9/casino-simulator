#!/usr/bin/env node
// Hold to spin and Auto on the slot machines, against the real server in the dev harness. For
// each machine (one per view by default): insert money, run Auto for 10 spins, hold Space for a
// few, hold the Spin button with the mouse for a couple, start Auto on no limit and stop it with a
// key. Every spin's money is followed from the frames (the bet off the credits, the win on) and
// must chain exactly from one spin to the next, the credits and the balance must end where the
// spins say, and no spin may go out before the one before it has played out on the machine (an
// act only after the last result arrived and at least the reels' time since). A phone (touch)
// pass holds the Spin button with a finger. Screenshots of the Auto controls on both.
// Usage: node scripts/e2e/slots6.mjs [port] [outDir] [variants...]   (GPU=1: the Mac's GPU)

import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [port = '6450', outDir = '/tmp', ...only] = process.argv.slice(2);
const variants = only.length ? only : ['sevens', 'diamonds'];
const gpu = process.env.GPU === '1';
const browser = gpu
  ? await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] })
  : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
/** The shortest a spin can take on the machine: the reels' ~2.5 s, less a little for timers. */
const MIN_SPIN_MS = 1800;

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
  return ok;
};
const money = (c) => `$${(c / 100).toFixed(2)}`;

async function open(variant, device, opts = {}) {
  const ctx = await browser.newContext(device === 'phone' ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  // every table frame each way, stamped
  const frames = [];
  page.on('websocket', (ws) => {
    const note = (dir) => (f) => {
      try {
        const msg = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        frames.push({ dir, at: Date.now(), msg });
      } catch {}
    };
    ws.on('framesent', note('out'));
    ws.on('framereceived', note('in'));
  });
  const game = opts.game ?? 'slots';
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=${game}&variant=${variant}&name=${opts.name ?? `slots6_e2e_${device === 'phone' ? 'p' : 'd'}${variant.slice(0, 4)}`}`);
  await page.waitForSelector('.modal input[type=number], .slots-deck', { timeout: 60000 });
  await page.waitForTimeout(2500);
  if (await page.$('.modal input[type=number]')) {
    await page.fill('.modal input[type=number]', String(opts.buyIn ?? 300));
    await page.click('.modal .btn.primary');
  }
  if (game === 'slots') await page.waitForFunction(() => !document.querySelector('.slots-deck .slots-spin')?.disabled, null, { timeout: 30000 });
  else await page.waitForTimeout(2500);
  return { ctx, page, frames, errors };
}

const acts = (frames, since) => frames.filter((f) => f.dir === 'out' && f.msg.t === 'act' && f.at >= since);
const evs = (frames, since) => frames.filter((f) => f.dir === 'in' && f.msg.t === 'ev' && f.at >= since);
const me = (page) => page.evaluate(async () => (await import('/casino/src/net/api.ts')).me());
const autoOn = (page) => page.evaluate(() => !!document.querySelector('.slots-auto.on'));
const idle = (page) => page.waitForFunction(() => !document.querySelector('.slots-auto.on') && !document.querySelector('.slots-deck .slots-spin')?.disabled, null, { timeout: 240000 });
/** Wait until n results have come since `since`, and the machine is idle after them. */
async function resultsSince(t, since, n, ms = 120000) {
  const until = Date.now() + ms;
  while (Date.now() < until && evs(t.frames, since).length < n) await t.page.waitForTimeout(200);
}

/**
 * The spins since `since`: each act answered by one ev before the next act goes, each act at least
 * the reels' time after the ev before it, and the money chained exactly. Returns the credits after.
 */
function audit(t, since, label, startCredit) {
  const list = t.frames.filter((f) => f.at >= since && ((f.dir === 'out' && f.msg.t === 'act') || (f.dir === 'in' && (f.msg.t === 'ev' || f.msg.t === 'err'))));
  let out = 0;
  let overlaps = 0;
  let tooSoon = 0;
  let lastEv = null;
  let credit = startCredit;
  let chainBad = [];
  let spins = 0;
  let net = 0;
  for (const f of list) {
    if (f.dir === 'out') {
      if (out > 0) overlaps++;
      if (lastEv && f.at - lastEv < MIN_SPIN_MS) tooSoon++;
      out++;
    } else if (f.msg.t === 'err') {
      out = Math.max(0, out - 1);
    } else {
      out = Math.max(0, out - 1);
      lastEv = f.at;
      const spin = f.msg.events.find((e) => e.type === 'spin');
      const result = f.msg.events.find((e) => e.type === 'result');
      if (!spin || !result) continue;
      spins++;
      net += result.win - spin.bet;
      if (credit !== null && spin.credit !== credit - spin.bet) chainBad.push(`spin ${spins}: ${money(credit)} less ${money(spin.bet)} is not ${money(spin.credit)}`);
      if (result.credit !== spin.credit + result.win) chainBad.push(`spin ${spins}: ${money(spin.credit)} and ${money(result.win)} is not ${money(result.credit)}`);
      credit = result.credit;
    }
  }
  check(overlaps === 0, `${label}: no spin went while another was out (${overlaps})`);
  check(tooSoon === 0, `${label}: every next spin went only after the last had played (${tooSoon} too soon)`);
  check(chainBad.length === 0, `${label}: the money chains exactly over ${spins} spins, net ${money(net)}${chainBad.length ? ': ' + chainBad.slice(0, 3).join('; ') : ''}`);
  return { credit, spins, net };
}

const featCash = (frames, since) =>
  frames.filter((f) => f.dir === 'in' && f.msg.t === 'feat' && f.at >= since).reduce((s, f) => s + (f.msg.paid ?? 0), 0);

for (const variant of variants) {
  console.log(`--- ${variant}, desktop`);
  const t = await open(variant, 'desktop');
  const { page, frames } = t;
  const seatMsgs = frames.filter((f) => f.dir === 'in' && (f.msg.t === 'seat' || f.msg.t === 'table'));
  const last = seatMsgs.at(-1)?.msg;
  let credit = last?.t === 'seat' ? last.stack : last?.you?.stack ?? null;
  const startCredit = credit;
  const p0 = await me(page);
  const t0 = Date.now();
  await page.screenshot({ path: `${outDir}/slots6-${variant}-deck.png` });

  // --- Auto, 10 spins, no feature stop
  await page.click('.slots-auto');
  await page.waitForSelector('.slots-auto-pop');
  await page.click('.slots-auto-seg .btn:nth-child(1)');
  const feat = await page.$('.slots-auto-check input');
  if (await feat.isChecked()) await feat.uncheck();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-auto-panel.png` });
  check(/10 spins/.test(await page.textContent('.slots-auto-go')), `${variant}: the Start button names the spins and the bet: "${await page.textContent('.slots-auto-go')}"`);
  const autoStart = Date.now();
  await page.click('.slots-auto-go');
  await page.waitForTimeout(1200);
  const label = await page.textContent('.slots-auto');
  check(/Auto ·\s*10 left\s*Stop/.test(label), `${variant}: running, the button reads "${label.trim()}"`);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-auto-running.png` });
  await resultsSince(t, autoStart, 3);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-auto-later.png` });
  await idle(page);
  await page.waitForTimeout(500);
  const said = await page.textContent('.dealer-line').catch(() => '');
  const a = audit(t, autoStart, `${variant} Auto`, credit);
  check(a.spins === 10 || /Hand pay|Out of credits/.test(said), `${variant}: Auto spun ${a.spins} (10 asked) and says "${said}"`);
  credit = a.credit;

  // --- hold Space for three spins, then let go: that spin finishes and no more go
  const holdStart = Date.now();
  await page.keyboard.down('Space');
  await resultsSince(t, holdStart, 3);
  await page.keyboard.up('Space');
  const upAt = Date.now();
  await idle(page);
  await page.waitForTimeout(3500);
  const h = audit(t, holdStart, `${variant} hold Space`, credit);
  check(h.spins >= 3 && acts(frames, upAt).length === 0, `${variant}: holding Space spun ${h.spins}, none after letting go`);
  credit = h.credit;

  // --- hold the Spin button with the mouse for two
  const btn = await page.$('.slots-spin');
  const box = await btn.boundingBox();
  const mouseStart = Date.now();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  const held = await page.evaluate(() => document.querySelector('.slots-spin').classList.contains('held'));
  await resultsSince(t, mouseStart, 2);
  await page.mouse.up();
  const mouseUp = Date.now();
  await idle(page);
  await page.waitForTimeout(3500);
  const mh = audit(t, mouseStart, `${variant} hold the button`, credit);
  check(held && mh.spins >= 2 && acts(frames, mouseUp).length === 0, `${variant}: holding the button spun ${mh.spins} (held look ${held}), none after letting go`);
  credit = mh.credit;

  // --- Auto on no limit, stopped by a key: the spin out finishes, nothing more
  await page.click('.slots-auto');
  await page.click('.slots-auto-seg .btn:nth-child(5)');
  const infStart = Date.now();
  await page.click('.slots-auto-go');
  await resultsSince(t, infStart, 2);
  await page.keyboard.press('x');
  const keyAt = Date.now();
  const stoppedAt = await autoOn(page);
  await idle(page);
  await page.waitForTimeout(3500);
  const k = audit(t, infStart, `${variant} Auto stopped by a key`, credit);
  check(!stoppedAt && acts(frames, keyAt + 50).length === 0, `${variant}: a key stopped Auto after ${k.spins} spins, nothing sent after it`);
  credit = k.credit;

  // --- Auto stopped by Esc, without leaving the machine
  await page.click('.slots-auto');
  await page.click('.slots-auto-go');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(!(await autoOn(page)) && !!(await page.$('.slots-deck')), `${variant}: Esc stops Auto and stays at the machine`);
  await idle(page);
  await page.waitForTimeout(3500);
  const e = audit(t, infStart, `${variant} everything`, null);
  credit = e.credit ?? credit;

  // --- the machine's credits and the balance end where the spins say
  const seat = frames.filter((f) => f.dir === 'in' && f.msg.t === 'seat').at(-1)?.msg;
  check(seat?.stack === credit, `${variant}: the machine's credits ${money(seat?.stack ?? -1)} are the last spin's ${money(credit)}`);
  const all = audit(t, t0, `${variant} (all spins)`, startCredit);
  check(all.credit === startCredit + all.net, `${variant}: the credits went from ${money(startCredit)} by the spins' net ${money(all.net)} to ${money(all.credit)}`);
  // cash out: the balance takes exactly the credits the spins left (and any feat paid on the way)
  await page.evaluate(() => window.casino.table.link.cashOut());
  await page.waitForFunction(async () => (await (await import('/casino/src/net/api.ts')).me()).inPlay === 0, null, { timeout: 20000, polling: 500 }).catch(() => {});
  const p1 = await me(page);
  const feats = featCash(frames, t0);
  check(p1.inPlay === 0 && p1.balance - p0.balance === all.credit + feats, `${variant}: cashed out, the balance rose by the ${money(all.credit)} of credits${feats ? ` and ${money(feats)} of feats` : ''} (${money(p0.balance)} to ${money(p1.balance)}, in play ${money(p1.inPlay)})`);
  check(t.errors.length === 0, `${variant}: no page errors${t.errors.length ? ': ' + t.errors.slice(0, 3).join(' | ') : ''}`);
  await t.ctx.close();
}

// --- the high-limit room: a high roller at the top coin, Auto at $30,000 or $50,000 a spin, and
// video poker at five $5,000 coins
const run = promisify(execFile);
async function sql(query) {
  const { stdout } = await run('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', query], { env: { ...process.env, CI: '1' }, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout.slice(stdout.indexOf('[')))[0]?.results ?? [];
}
/** Log in (making the account), then give it exactly `cents`, keeping the ledger whole with a grant row. */
async function highRoller(name, cents) {
  const res = await fetch(`http://localhost:${port}/casino/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'casino-dev' }) });
  if (res.status !== 200) throw new Error(`login ${name}: ${res.status}`);
  const [r] = await sql(`SELECT id, balance FROM casino_accounts WHERE name = '${name}'`);
  const delta = cents - r.balance;
  if (delta) {
    await sql(
      `INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES ('e2e-adjust:${r.id}:${Date.now()}', ${r.id}, 'grant', ${delta}, NULL, ${Date.now()});
       UPDATE casino_accounts SET balance = balance + ${delta}, rev = rev + 1 WHERE id = ${r.id};`,
    );
  }
}

for (const variant of variants) {
  console.log(`--- ${variant}, high limit`);
  const name = `slots6_e2e_h${variant.slice(0, 4)}`;
  await highRoller(name, 10_000_000_00);
  const t = await open(variant, 'desktop', { name, buyIn: 3_000_000 });
  const { page, frames } = t;
  const last = frames.filter((f) => f.dir === 'in' && (f.msg.t === 'seat' || f.msg.t === 'table')).at(-1)?.msg;
  const startCredit = last?.t === 'seat' ? last.stack : last?.you?.stack;
  const p0 = await me(page);
  // the arrows walk up to the top coin and stop there; C goes round to the first and Shift+C back; A is Max
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('c');
  await page.waitForTimeout(200);
  const first = await page.textContent('.slots-coin');
  await page.keyboard.press('Shift+C');
  await page.keyboard.press('a');
  await page.waitForTimeout(400);
  const coin = await page.textContent('.slots-coin');
  const bet = await page.textContent('.slots-bet');
  check(!coin.includes(',') && /\$(25|30|50),000/.test(bet), `${variant}: the top coin and Max read "${coin.trim()}", "${bet.trim()}"`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  const lower = await page.textContent('.slots-coin');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  check(lower !== coin && first !== coin && (await page.textContent('.slots-coin')) === coin, `${variant}: C goes round to "${first.trim()}", Shift+C back to the top, the arrows step down ("${lower.trim()}") and back up, stopping at the top`);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-high.png` });
  await page.click('.slots-auto');
  await page.click('.slots-auto-seg .btn:nth-child(1)');
  const feat = await page.$('.slots-auto-check input');
  if (await feat.isChecked()) await feat.uncheck();
  await page.fill('.slots-auto-pop .slots-auto-money input >> nth=0', '100000');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-high-panel.png` });
  const autoStart = Date.now();
  await page.click('.slots-auto-go');
  await resultsSince(t, autoStart, 2);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-high-running.png` });
  await idle(page);
  await page.waitForTimeout(500);
  const said = await page.textContent('.dealer-line').catch(() => '');
  const a = audit(t, autoStart, `${variant} high-limit Auto`, startCredit);
  check(a.spins === 10 || /Jackpot|Out of credits|Credits under/.test(said), `${variant}: Auto at the top bet spun ${a.spins} and says "${said}"`);
  const top = frames.filter((f) => f.dir === 'in' && f.msg.t === 'ev' && f.at >= autoStart).map((f) => f.msg.events.find((e) => e.type === 'spin')?.bet);
  check(top.every((b) => b >= 2_500_000), `${variant}: every Auto spin was at the top bet (${[...new Set(top)].map(money).join(', ')})`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-high-after.png` });
  await page.evaluate(() => window.casino.table.link.cashOut());
  await page.waitForFunction(async () => (await (await import('/casino/src/net/api.ts')).me()).inPlay === 0, null, { timeout: 20000, polling: 500 }).catch(() => {});
  const p1 = await me(page);
  const feats = featCash(frames, autoStart - 60_000);
  check(p1.inPlay === 0 && p1.balance - p0.balance === a.credit + feats, `${variant}: cashed out ${money(a.credit)} to the cent (balance ${money(p0.balance)} to ${money(p1.balance)}${feats ? `, ${money(feats)} of feats` : ''})`);
  check(t.errors.length === 0, `${variant} high limit: no page errors${t.errors.length ? ': ' + t.errors.slice(0, 3).join(' | ') : ''}`);
  await t.ctx.close();
}

{
  console.log('--- video poker, high limit');
  const name = 'slots6_e2e_hvp';
  await highRoller(name, 10_000_000_00);
  const t = await open('', 'desktop', { name, game: 'videopoker', buyIn: 2_500_000 });
  const { page, frames } = t;
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const denom = await page.textContent('.vp-denom').catch(() => '');
  const since = Date.now();
  // Max: five coins, dealt
  await page.keyboard.press('b');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${outDir}/slots6-vp-high.png` });
  const deal = frames.filter((f) => f.dir === 'in' && f.msg.t === 'ev' && f.at >= since).flatMap((f) => f.msg.events).find((e) => e.type === 'deal');
  check(/\$5K/.test(denom) && deal?.bet === 2_500_000, `video poker: the coin reads "${denom.trim()}" and Max deals $25,000 (${money(deal?.bet ?? 0)})`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(3000);
  const result = frames.filter((f) => f.dir === 'in' && f.msg.t === 'ev' && f.at >= since).flatMap((f) => f.msg.events).find((e) => e.type === 'result');
  check(!!result && result.payout === result.credits * 500_000, `video poker: a $25,000 hand paid ${money(result?.payout ?? -1)} (${result?.credits} credits of $5,000)`);
  await page.screenshot({ path: `${outDir}/slots6-vp-high-drawn.png` });
  check(t.errors.length === 0, `video poker high limit: no page errors${t.errors.length ? ': ' + t.errors.slice(0, 3).join(' | ') : ''}`);
  await t.ctx.close();
}

// --- a phone: the panel, the running button, and a finger held on Spin
{
  const variant = variants[0];
  console.log(`--- ${variant}, phone`);
  const t = await open(variant, 'phone');
  const { page, frames } = t;
  await page.screenshot({ path: `${outDir}/slots6-${variant}-phone-deck.png` });
  await page.tap('.slots-auto');
  await page.waitForSelector('.slots-auto-pop');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-phone-panel.png` });
  await page.tap('.slots-auto-seg .btn:nth-child(1)');
  const autoStart = Date.now();
  await page.tap('.slots-auto-go');
  await resultsSince(t, autoStart, 1);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-phone-running.png` });
  // a tap on the machine stops it
  await page.tap('canvas');
  await idle(page);
  await page.waitForTimeout(3000);
  audit(t, autoStart, `${variant} phone Auto`, null);
  // a finger held on Spin
  const box = await (await page.$('.slots-spin')).boundingBox();
  const cdp = await t.ctx.newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
  const touchStart = Date.now();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await resultsSince(t, touchStart, 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const upAt = Date.now();
  await idle(page);
  await page.waitForTimeout(3500);
  const h = audit(t, touchStart, `${variant} phone hold`, null);
  check(h.spins >= 2 && acts(frames, upAt).length === 0, `${variant} phone: a held finger spun ${h.spins}, none after lifting it`);
  // on its side: one row; the panel and a running Auto still fit
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  await page.tap('.slots-auto');
  await page.waitForSelector('.slots-auto-pop');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-side-panel.png` });
  const sideStart = Date.now();
  await page.tap('.slots-auto-go');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/slots6-${variant}-side-running.png` });
  const fits = await page.evaluate(() => {
    const r = document.querySelector('.slots-deck').getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  check(fits, `${variant} on its side: the deck stays on screen while Auto runs`);
  await page.tap('.slots-auto');
  await idle(page);
  await page.waitForTimeout(3000);
  audit(t, sideStart, `${variant} side Auto`, null);
  check(t.errors.length === 0, `${variant} phone: no page errors${t.errors.length ? ': ' + t.errors.slice(0, 3).join(' | ') : ''}`);
  await t.ctx.close();
}

await browser.close();
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
