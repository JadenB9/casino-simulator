#!/usr/bin/env node
// Do the animations land on what the server drew? Plays many rounds of each game that animates a
// random result in the dev harness and, once each round has played out, reads the result back
// off the 3D model, not the view's state:
//   roulette   the pocket under the ball: the ball's position in the rotor's frame, looked up on
//              the pocket floor's and the number ring's own texture coordinates (both wheels)
//   craps      each die's top face: its mesh's face groups turned by the die's world rotation,
//   sicbo      and the pips counted on the top face's own texture
//   bigsix     the stop under the clapper's tip, and the slot under the Bandit Wheel's flapper
//   bandit     tip, in the wheel's frame, against the painted face's layout
//   slots      every reel's offset on its strip, against the server's stops (all six machines)
// Also: the dice rest flat on the table and inside the dome, the ball rests in its pocket, and
// the camera comes back to the table's resting pose after every spin or roll.
//
// Usage: node scripts/e2e/anim.mjs [port] [outDir] [part...]   (PORT_BASE=<port> npm run dev first)
//   parts: roulette-american roulette-european craps sicbo bigsix bandit slots-<machine>
//   ROUNDS=n rounds per part (default 12); GPU=1 draws on the machine's GPU (much faster).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { READ_MODEL } from './read-model.mjs';

const [port = '6110', out = '/tmp/casino-anim', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ROUNDS = Number(process.env.ROUNDS ?? 12);
const ROOT = process.cwd();
const gpu = process.env.GPU === '1';
const args = gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chromium', args });
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
let failures = 0;
const fail = (what) => {
  failures++;
  log(`FAIL ${what}`);
};

const PARTS = {
  'roulette-american': { game: 'roulette', variant: 'american', bet: [{ type: 'bet', bets: [{ kind: 'red', amount: 500 }] }], go: { type: 'spin' }, end: 'settle' },
  'roulette-european': { game: 'roulette', variant: 'european', bet: [{ type: 'bet', bets: [{ kind: 'red', amount: 500 }] }], go: { type: 'spin' }, end: 'settle' },
  craps: { game: 'craps', variant: '', bet: [{ type: 'bet', bets: [{ kind: 'field', amount: 1000 }] }], go: { type: 'roll' }, end: 'roll' },
  sicbo: { game: 'sicbo', variant: '', bet: [{ type: 'bet', bets: [{ spot: 'small', amount: 500 }] }], go: { type: 'roll' }, end: 'settle' },
  bigsix: { game: 'bigsix', variant: '', bet: [{ type: 'bet', bets: [{ spot: 'one', amount: 500 }] }], go: { type: 'spin' }, end: 'settle' },
  bandit: { game: 'banditwheel', variant: '', bet: [{ type: 'bet', bets: [{ spot: 1, amount: 500 }] }], go: { type: 'spin' }, end: 'settle' },
  ...Object.fromEntries(
    ['sevens', 'neon', 'wild', 'diamonds', 'cherries', 'goldrush'].map((m) => [`slots-${m}`, { game: 'slots', variant: m, bet: [], go: { type: 'spin', coins: 1, denom: m === 'sevens' || m === 'wild' || m === 'diamonds' ? 100 : 5 }, end: 'result' }]),
  ),
};

async function open(part) {
  const spec = PARTS[part];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
  const name = `qa_${part.replace(/[^a-z]/g, '').slice(0, 13)}`;
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=${spec.game}&variant=${spec.variant}&name=${name}`, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300000 });
  // buy in unless the table still has chips from an earlier run
  await page.waitForFunction(() => !!document.querySelector('.modal input[type=number]') || (window.casino?.table?.snapshot?.you?.stack ?? 0) > 0, null, { timeout: 120000 });
  if (await page.$('.modal input[type=number]')) {
    await page.fill('.modal input[type=number]', '2000');
    await page.click('.modal .btn.primary');
    await page.waitForFunction(() => (window.casino.table.snapshot?.you?.stack ?? 0) > 0, null, { timeout: 60000 });
  }
  await page.evaluate(`window.__qa = (${READ_MODEL.toString()})()`);
  const order = await page.evaluate(async ([root, game, variant]) => {
    if (game === 'roulette') return (await import(`/casino/@fs${root}/shared/src/games/roulette/rules.ts`)).WHEEL[variant];
    if (game === 'bigsix') return (await import(`/casino/@fs${root}/shared/src/games/bigsix/rules.ts`)).WHEEL;
    if (game === 'banditwheel') return (await import(`/casino/@fs${root}/shared/src/games/banditwheel/rules.ts`)).WHEEL;
    return null;
  }, [ROOT, spec.game, spec.variant]);
  return { page, errors, order };
}

/** One round: the bets, the go, and every event until the round's end has played out. */
async function playRound(page, spec) {
  return page.evaluate(
    async ({ bet, go, end }) => {
      const s = window.casino.table;
      const events = [];
      let done = false;
      const orig = s.onMessage.bind(s);
      s.onMessage = (m) => {
        orig(m);
        if (m.t === 'ev') {
          events.push(...m.events);
          s.__lastView = m.view;
          if (m.events.some((e) => e.type === end)) done = true;
        }
        if (m.t === 'err') events.push({ type: 'err', msg: m.msg });
      };
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        for (const a of bet) {
          s.link.act(a);
          await wait(400);
        }
        s.link.act(go);
        const t0 = performance.now();
        while (!done && performance.now() - t0 < 60000) await wait(100);
        // the animations queue behind each other: wait for them to drain, then a beat more
        for (let i = 0; i < 4; i++) await Promise.race([s.queue, wait(60000)]);
        await wait(900);
      } finally {
        s.onMessage = orig;
      }
      return { done, events: events.filter((e) => ['spin', 'roll', 'reels', 'settle', 'result', 'err'].includes(e.type)), finalStops: s.__lastView?.stops ?? null };
    },
    { bet: spec.bet, go: spec.go, end: spec.end },
  );
}

const rows = [];
for (const part of only.length ? only : Object.keys(PARTS)) {
  const spec = PARTS[part];
  if (!spec) {
    fail(`no part ${part}`);
    continue;
  }
  let ok = 0;
  let checked = 0;
  const { page, errors, order } = await open(part);
  const cam0 = await page.evaluate(() => window.__qa.camera());
  log(`${part}: seated (camera ${JSON.stringify(cam0)})`);
  for (let r = 0; r < ROUNDS; r++) {
    let res;
    try {
      res = await playRound(page, spec);
    } catch (err) {
      if (!/Execution context was destroyed/.test(String(err))) throw err;
      // the dev server's live-reload reloaded the page (not the game's doing): back to the table
      log(`${part} round ${r}: the page reloaded; carrying on`);
      await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done') && (window.casino?.table?.snapshot?.you?.stack ?? 0) > 0, null, { timeout: 300000 });
      await page.evaluate(`window.__qa = (${READ_MODEL.toString()})()`);
      r--;
      continue;
    }
    const errs = res.events.filter((e) => e.type === 'err');
    if (!res.done) {
      fail(`${part} round ${r}: no ${spec.end} (${errs.map((e) => e.msg).join('; ') || 'no answer'})`);
      continue;
    }
    const seen = await page.evaluate(([game, order]) => {
      const qa = window.__qa;
      if (game === 'roulette') return qa.roulette(order);
      if (game === 'craps' || game === 'sicbo') return qa.dice();
      if (game === 'bigsix') return qa.wheel('bigsix-rotor', 'bigsix-flap', order.length);
      if (game === 'banditwheel') return qa.wheel('bw-rotor', 'bw-flapper', order.length);
      if (game === 'slots') return qa.reels();
      return null;
    }, [spec.game, order]);
    const cam = await page.evaluate(() => window.__qa.camera());
    let want;
    let good;
    let got;
    if (spec.game === 'roulette') {
      const e = res.events.find((x) => x.type === 'spin');
      want = e.pocket;
      got = `${seen.floor}/${seen.ring} r=${seen.r} y=${seen.y}`;
      good = seen.floor === want && seen.ring === want && Math.abs(seen.r - 0.222) < 0.003 && seen.y < 0.02;
    } else if (spec.game === 'craps' || spec.game === 'sicbo') {
      const e = res.events.find((x) => x.type === 'roll');
      want = [...e.dice].sort().join('');
      got = seen.map((d) => d.face).sort().join('');
      const flat = seen.every((d) => d.up > 0.995);
      // no two dice in each other: centres at least a die's diagonal apart on the felt (19 mm dice)
      const apart = seen.every((a, i) => seen.every((b, j) => j <= i || Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2]) >= 0.0265));
      good = got === want && flat && apart && seen.length === e.dice.length;
      if (!flat) got += ` (not flat: ${seen.map((d) => d.up).join(',')})`;
      if (!apart) got += ' (two dice overlap)';
      got += ` at ${JSON.stringify(seen.map((d) => d.at))}`;
    } else if (spec.game === 'bigsix' || spec.game === 'banditwheel') {
      const e = res.events.find((x) => x.type === 'spin');
      want = spec.game === 'bigsix' ? e.stop : e.slot;
      got = `${seen.index} (${order[seen.index]}, at ${seen.frac} of the way through)`;
      good = seen.index === want;
    } else if (spec.game === 'slots') {
      const reels = res.events.filter((x) => x.type === 'reels');
      const last = reels.at(-1);
      // where the server says the reels rest once it's all over: a machine with free games ends
      // on the last one (Neon Nights) or back on the paid spin (Gold Rush), as its engine decides
      const rest = res.finalStops ?? last.stops;
      want = rest.join(',');
      const strips = Array.isArray(seen.strip) ? seen.strip : seen.offsets.map(() => seen.strip);
      const rowOff = { sevens: 0, wild: 0, diamonds: 0, neon: 1, cherries: 1, goldrush: 1.5 }[spec.variant];
      // (a bank's shader has room for five reels; a three-reel machine leaves the last two at 0)
      got = seen.offsets.slice(0, rest.length).map((o, i) => ((o - rowOff) % strips[i] + strips[i]) % strips[i]).map((x) => +x.toFixed(3)).join(',');
      good = got === want;
      got += ` (strips ${strips.join('/')}, free games ${reels.length - 1})`;
    }
    const camBack = cam.dist < 0.01 && cam.angle < 0.01;
    checked++;
    if (good && camBack) ok++;
    else fail(`${part} round ${r}: drew ${JSON.stringify(want)}, the model shows ${got}${camBack ? '' : `; camera off its rest pose by ${cam.dist} m, ${cam.angle} rad`}`);
    if (r < 2 || !good) {
      const file = `${out}/anim-${part}-${r}.png`;
      await page.screenshot({ path: file });
    }
    log(`${part} round ${r}: drew ${JSON.stringify(want)} -> ${got} ${good ? 'ok' : 'MISS'}${camBack ? '' : ' (camera away)'}`);
  }
  if (errors.length) fail(`${part}: page errors: ${errors.slice(0, 3).join(' | ')}`);
  rows.push({ part, rounds: checked, ok });
  await page.close();
}

await browser.close();
console.log('ANIM part | rounds | landed right');
for (const r of rows) console.log(`ANIM ${r.part} | ${r.rounds} | ${r.ok}`);
console.log(failures ? `${failures} failure(s)` : 'all landed where the server drew');
process.exit(failures ? 1 : 0);
