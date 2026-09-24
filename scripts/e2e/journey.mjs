#!/usr/bin/env node
// Every table as a player meets it, in the game proper (the building's pit, poker room and high
// limit salon). At each station: walk up, pick limits (a high tier: the buy-in follows), sit down
// alone with a big buy-in, press A for Max and put it on the table's main spot (the amount must be
// the most that spot takes or all the chips, whichever is less), play rounds with Tips on (following
// the highlighted control wherever there is one) and then off, and leave. Along the way:
//   - the table's dealer stands at it, and gestures as cards go out and chips move;
//   - the camera is back at the seat's rest pose after every round (spins and rolls swing it away);
//   - a celebration only ever follows a round that returned more than it staked;
//   - the tip line and its highlighted control come and go with the setting;
//   - leaving, the balance comes back to what it was less the buy-in plus the chips left.
// Screenshots of each table seated, mid-round and at rest.
//
// Usage: node scripts/e2e/journey.mjs [port] [outDir] [station...]   (PORT_BASE=<port> npm run dev first)
//   QUALITY=high|low (default low), ROUNDS=n (default 3), GPU=1 (the machine's GPU), NAME=<player>

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port = '6110', out = '/tmp/casino-journey', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const QUALITY = process.env.QUALITY ?? 'low';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const NAME = process.env.NAME ?? `qa_jr_${QUALITY}`;
const gpu = process.env.GPU === '1';
const args = gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chromium', args });
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
const problems = [];
const check = (ok, what) => {
  if (!ok) problems.push(what);
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  return ok;
};

// Local dev database only: a rich player, so the high tiers' buy-ins fit.
function sql(command) {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', command, '-c', 'server/wrangler.toml'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** How each table is played: Max's spot, a small follow-up bet, the round's decisions, its end. */
const GAMES = {
  blackjack: { max: (seat) => ({ felt: `spot:${seat}` }), small: (min) => ({ type: 'bet', amount: min }), keys: { turn: 's', insurance: 'n' }, end: ['done'] },
  // (baccarat's seats are numbered from the middle out: the first player sits at 4)
  baccarat: { max: (seat) => ({ felt: `s${[4, 3, 5, 2, 6, 1, 7][seat]}:banker` }), small: (min) => ({ type: 'bet', banker: min }), keys: {}, end: ['result', 'outcome'] },
  threecard: { max: (seat) => ({ felt: `ante:${seat}` }), small: (min) => ({ type: 'bet', ante: min, pairPlus: 0 }), keys: { decide: 'p' }, end: ['result'] },
  war: { max: (seat) => ({ felt: `bet:${seat}` }), small: (min) => ({ type: 'bet', bet: min, tie: 0 }), keys: { decide: 'w' }, end: ['result'] },
  roulette: { max: () => ({ screen: 'red' }), small: (min) => ({ type: 'bet', bets: [{ kind: 'red', amount: min }] }), keys: {}, end: ['settle'] },
  craps: { max: () => ({ felt: 'R|field', alt: 'L|field' }), small: (min) => ({ type: 'bet', bets: [{ kind: 'field', amount: min }] }), keys: {}, end: ['roll'] },
  sicbo: { max: () => ({ screen: 'small' }), small: (min) => ({ type: 'bet', bets: [{ spot: 'small', amount: min }] }), keys: {}, end: ['settle'] },
  bigsix: { max: () => ({ screen: 'one' }), small: (min) => ({ type: 'bet', bets: [{ spot: 'one', amount: min }] }), keys: {}, end: ['settle'] },
};

const STATIONS = {
  'bj-1': 'blackjack', 'bj-2': 'blackjack', 'bc-1': 'baccarat', 'tc-1': 'threecard', 'wr-1': 'war',
  'rl-us': 'roulette', 'rl-eu': 'roulette', 'cr-1': 'craps', 'sb-1': 'sicbo', 'b6-1': 'bigsix',
  'vip-bj-1': 'blackjack', 'vip-bc-1': 'baccarat', 'vip-rl-1': 'roulette',
};

async function login() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((q) => {
    localStorage.setItem('casino.quality', q);
    localStorage.setItem('casino.tips', '0');
    for (const k of Object.keys(localStorage)) if (k.startsWith('casino.limits.')) localStorage.removeItem(k);
  }, QUALITY);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120_000);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/casino/`, { timeout: 300_000 });
  await page.waitForSelector('.name-input, .menu-item', { timeout: 600_000 });
  if (await page.$('.name-input')) {
    await page.fill('.name-input', NAME);
    await page.fill('.pass-input', 'casino-dev');
    await page.click('.enter-btn');
  }
  await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else {
    await page.click('.menu-item >> nth=0');
  }
  await page.waitForSelector('.hud', { timeout: 120_000 });
  return { ctx, page, errors };
}

/** Everything the table said, kept on the session for the checks to read. */
const trackSession = (page) =>
  page.evaluate(() => {
    const s = window.casino.app.table.session;
    s.__events = [];
    s.__errs = [];
    s.__view = s.snapshot?.view ?? null;
    s.__celebrations = 0;
    s.__escrow = null;
    const orig = s.onMessage.bind(s);
    s.onMessage = (m) => {
      orig(m);
      if (m.t === 'ev') {
        s.__events.push(...m.events);
        s.__view = m.view;
      }
      if (m.t === 'table') s.__view = m.view;
      if (m.t === 'err') s.__errs.push(m.msg);
      // the chips at the table in all (the stack and any bets down): what comes home on leaving
      if (m.t === 'seat' && m.status !== 'watching') s.__escrow = m.escrow;
    };
    // a celebration's banner, whenever one goes up
    new MutationObserver((list) => {
      for (const r of list) for (const n of r.addedNodes) if (n.classList?.contains('celebrate')) s.__celebrations++;
    }).observe(document.body, { childList: true, subtree: true });
    // the dealer's gestures, counted
    const w = window.casino.world;
    const station = window.casino.app.table.station.id;
    s.__gestures = [];
    const staff = w.staff;
    if (staff && !staff.__qa) {
      const g = staff.gesture.bind(staff);
      staff.gesture = (id, what) => {
        window.casino.app.table?.session.__gestures?.push(`${id}:${what}`);
        return g(id, what);
      };
      staff.__qa = true;
    }
    void station;
  });

/** A felt region's (or a view's own spot's) place on screen. */
const screenOf = (page, spot) =>
  page.evaluate((spot) => {
    const s = window.casino.app.table.session;
    const { engine } = window.casino;
    const project = (p) => {
      const v = p.project(engine.camera);
      return v.z < 1 ? { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight } : null;
    };
    if (spot.screen) return s.view?.debug?.screenOf?.(spot.screen) ?? null;
    for (const id of [spot.felt, spot.alt].filter(Boolean)) {
      for (const f of s.stage.felts) {
        const a = f.anchorOf(id);
        if (!a) continue;
        const p = engine.camera.position.clone().set(a[0], f.mesh.position.y, a[1]);
        s.stage.root.localToWorld(p);
        const at = project(p);
        if (at && at.x > 0 && at.x < innerWidth && at.y > 0 && at.y < innerHeight) return at;
      }
    }
    return null;
  }, spot);

const stackOf = (page) => page.evaluate(() => window.casino.app.table?.session.snapshot?.you?.stack ?? 0);
const shot = (page, file) => page.screenshot({ path: `${out}/${file}.png` });
/** Wait for the table's queued animations to finish, then a beat. */
const settle = (page, ms = 800) =>
  page.evaluate(async (ms) => {
    const s = window.casino.app.table?.session;
    for (let i = 0; i < 4 && s; i++) await Promise.race([s.queue, new Promise((r) => setTimeout(r, 60000))]);
    await new Promise((r) => setTimeout(r, ms));
  }, ms);

async function playStation(page, id) {
  const game = STATIONS[id];
  const spec = GAMES[game];
  const tag = `${id}-${QUALITY}`;
  const profile0 = await page.evaluate(() => window.casino.app && window.casino.session?.profile);
  const balance0 = profile0?.balance ?? 0;
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, id);

  // --- the limits picker: a high tier, and the buy-in follows it
  await page.waitForSelector('.lim-opt', { timeout: 30_000 });
  const tiers = await page.$$eval('.lim-opt', (bs) => bs.map((b) => ({ text: b.textContent.trim(), on: b.getAttribute('aria-pressed') ?? b.getAttribute('aria-checked') ?? (b.classList.contains('on') ? 'true' : 'false') })));
  const preset = tiers.find((t) => t.on === 'true')?.text ?? '?';
  log(`${id}: tiers ${tiers.map((t) => t.text).join(' | ')} (picked: ${preset})`);
  if (id.startsWith('vip-')) check(/^High limit/.test(preset), `${id}: the salon's table opens at High limit (${preset})`);
  const tierName = id.startsWith('vip-') ? 'Penthouse' : 'High limit';
  const before = await page.textContent('.lim-buyin');
  await page.click(`.lim-opt:has-text("${tierName}")`);
  const after = await page.textContent('.lim-buyin');
  check(after !== before || preset.startsWith(tierName), `${id}: ${tierName} brings its buy-in (${before} -> ${after})`);
  await shot(page, `${tag}-0-limits`);
  await page.keyboard.press('s');

  // --- the buy-in: the biggest quick pick
  await page.waitForSelector('.modal input[type=number]', { timeout: 60_000 });
  const note = await page.textContent('.modal p');
  // (the quick picks are the modal's first row; its last row is Buy in and Cancel)
  const picks = await page.$$eval('.modal .row:first-of-type .btn', (bs) => bs.map((b) => b.textContent.trim()));
  await page.click('.modal .row:first-of-type .btn >> nth=-1');
  const buyIn = Math.round(Number(await page.inputValue('.modal input[type=number]')) * 100);
  await shot(page, `${tag}-1-buyin`);
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 60_000 });
  await trackSession(page);
  const stack0 = await stackOf(page);
  check(stack0 === buyIn, `${id}: bought in for ${buyIn / 100} (${note.trim()}; picks ${picks.join(', ')}), stack ${stack0 / 100}`);
  const cfg = await page.evaluate(() => window.casino.app.table.session.snapshot.meta.config);
  const seat = await page.evaluate(() => window.casino.app.table.session.snapshot.you.seat);

  // --- the dealer is at the table
  const dealer = await page.evaluate((id) => {
    const d = window.casino.world.staff?.at?.(id);
    if (!d) return null;
    let shown = true;
    for (let o = d.root ?? d; o; o = o.parent) if (o.visible === false) shown = false;
    return { shown };
  }, id);
  check(!!dealer?.shown, `${id}: a dealer stands at the table (${JSON.stringify(dealer)})`);

  // --- the seated camera, and a look at the table
  await page.waitForTimeout(1500);
  await shot(page, `${tag}-2-seated`);

  // --- Tips on (the HUD's bulb)
  await page.click('.hud [aria-label="Tips at the tables"], .hud [title="Tips at the tables"]').catch(async () => page.evaluate(() => localStorage.setItem('casino.tips', '1')));
  const tipsOn = await page.evaluate(() => localStorage.getItem('casino.tips') === '1');
  check(tipsOn, `${id}: the bulb turns Tips on`);

  for (let r = 0; r < ROUNDS; r++) {
    const s0 = await stackOf(page);
    await page.evaluate(() => {
      const s = window.casino.app.table.session;
      s.__events = [];
      s.__errs = [];
      s.__celebrations = 0;
      s.__gestures = [];
    });
    // --- the bet: Max on the main spot the first round, the minimum after
    let placed = 0;
    if (r === 0) {
      await page.keyboard.press('a');
      await page.waitForTimeout(250);
      const at = await screenOf(page, spec.max(seat));
      if (!check(!!at, `${id}: Max's spot is on screen`)) continue;
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(1200);
      placed = s0 - (await stackOf(page));
      const room = limitFor(game, cfg, s0);
      check(placed > 0 && placed === room, `${id}: Max put down ${placed / 100} (the most that spot takes or all the chips: ${room / 100})`);
      await shot(page, `${tag}-3-max`);
    } else {
      await page.evaluate((a) => window.casino.app.table.session.link.act(a), spec.small(Math.max(cfg.limits.default.min, cfg.limits.outside?.min ?? 0, cfg.limits.line?.min ?? 0, cfg.limits.even?.min ?? 0, cfg.limits.spot?.min ?? 0, cfg.limits.ante?.min ?? 0, cfg.limits.bet?.min ?? 0)));
      await page.waitForTimeout(900);
      placed = s0 - (await stackOf(page));
    }
    // --- the round: Space, then the decisions (the highlighted control while Tips are on)
    const tipsNow = r < ROUNDS - 1;
    if (!tipsNow) await page.evaluate(() => localStorage.getItem('casino.tips') === '1' && document.querySelector('.hud [aria-label="Tips at the tables"], .hud [title="Tips at the tables"]')?.click());
    await page.keyboard.press('Space');
    const t0 = Date.now();
    let tipLines = 0;
    let tipPicks = 0;
    let mid = false;
    while (Date.now() - t0 < 90_000) {
      const st = await page.evaluate((end) => {
        const s = window.casino.app.table.session;
        const tip = document.querySelector('.tip-line:not([hidden])');
        const pick = [...document.querySelectorAll('.tip-pick')].find((e) => e.offsetParent !== null && !e.disabled);
        return {
          ended: s.__events.some((e) => end.includes(e.type)),
          tip: tip?.textContent ?? null,
          pick: pick ? (pick.textContent || pick.getAttribute('aria-label') || pick.className).trim().slice(0, 40) : null,
          cards: (() => {
            let n = 0;
            s.stage.root.traverse((o) => 'card' in o && o.card && o.visible && n++);
            return n;
          })(),
        };
      }, spec.end);
      if (st.tip) tipLines++;
      if (st.pick) tipPicks++;
      if (!mid && st.cards > 0) {
        mid = true;
        await shot(page, `${tag}-4-round${r}`);
      }
      if (st.ended) break;
      if (st.pick && tipsNow) {
        await page.click('.tip-pick:not([disabled])').catch(() => {});
      } else {
        for (const k of Object.values(spec.keys)) await page.keyboard.press(k);
      }
      await page.waitForTimeout(700);
    }
    await settle(page, 1500);
    const res = await page.evaluate(() => {
      const s = window.casino.app.table.session;
      const { engine } = window.casino;
      const rest = s.stage.restPose(engine.camera);
      const mine = s.snapshot?.you?.seat;
      return {
        ended: s.__events.length,
        types: [...new Set(s.__events.map((e) => e.type))].join(','),
        errs: s.__errs.slice(0, 3),
        // a decision was asked of this player (the Tips only have a best play to show then)
        decided: s.__events.some((e) => (e.type === 'turn' && e.seat === mine) || (e.type === 'decide' && (e.seats ?? [e.seat]).includes(mine)) || e.type === 'insurance'),
        celebrations: s.__celebrations,
        gestures: [...new Set(s.__gestures)],
        cam: { d: +engine.camera.position.distanceTo(rest.pos).toFixed(3), a: +engine.camera.quaternion.angleTo(rest.quat).toFixed(3) },
        tipShown: !!document.querySelector('.tip-line:not([hidden])'),
      };
    });
    const s1 = await stackOf(page);
    // what came back to the stack for what was staked this round (a decision can add to the stake)
    const net = s1 - s0;
    check(res.cam.d < 0.02 && res.cam.a < 0.02, `${id} round ${r}: the camera is back at the seat (${res.cam.d} m, ${res.cam.a} rad)`);
    check(res.celebrations === 0 || net > 0, `${id} round ${r}: a celebration (${res.celebrations}) only for a win (net ${net / 100})`);
    if (tipsNow) check(tipLines > 0 || !res.decided, `${id} round ${r}: Tips said something (${tipLines} looks, ${tipPicks} with a highlighted control${res.decided ? ', a decision came up' : ''})`);
    else check(!res.tipShown, `${id} round ${r}: Tips off, no tip line`);
    log(`${id} round ${r}: staked ${placed / 100}, net ${net / 100}, events ${res.types}${res.errs.length ? `, refused: ${res.errs.join(' | ')}` : ''}, dealer gestures ${res.gestures.join(',') || 'none'}`);
    check(res.errs.length === 0, `${id} round ${r}: the table refused nothing a player did (${res.errs.join(' | ')})`);
    await shot(page, `${tag}-5-after${r}`);
  }

  // --- leave: Esc, Leave; the balance comes home
  const stackEnd = await stackOf(page);
  const escrowEnd = (await page.evaluate(() => window.casino.app.table.session.__escrow)) ?? stackEnd;
  await page.evaluate(() => window.casino.app.escape());
  const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 5000 }).catch(() => null);
  if (leave) await leave.click();
  await page.waitForFunction(() => window.casino.world.seated === null, null, { timeout: 30_000 });
  const t0 = Date.now();
  let prof = null;
  while (Date.now() - t0 < 30_000) {
    prof = await page.evaluate(async () => (await import('/casino/src/net/api.ts')).me());
    if (prof?.inPlay === 0) break;
    await page.waitForTimeout(1000);
  }
  const want = balance0 - buyIn + escrowEnd;
  check(prof?.balance === want && prof?.inPlay === 0, `${id}: cashed out, balance ${prof?.balance / 100} = ${balance0 / 100} - ${buyIn / 100} + ${escrowEnd / 100} (the stack ${stackEnd / 100} and any bets down; in play ${prof?.inPlay})`);
  const hud = await page.evaluate(() => window.casino.session.profile?.balance);
  check(hud === prof?.balance, `${id}: the HUD shows the balance the server has (${hud / 100})`);
}

/** The most Max may put on the tested spot: the game's rule for that spot, or all the chips. */
function limitFor(game, cfg, stack) {
  const L = (k) => cfg.limits[k] ?? cfg.limits.default;
  const cap = (lim, s, room = Infinity) => Math.min(lim.max, s, room) - (Math.min(lim.max, s, room) % lim.step);
  switch (game) {
    case 'blackjack':
      return cap(L('default'), stack);
    case 'baccarat':
      return cap(L('banker'), stack);
    case 'threecard':
      return cap(L('ante'), Math.floor(stack / 2));
    case 'war':
      return cap(L('bet'), Math.floor(stack / 2));
    case 'roulette':
      return cap(L('outside'), stack, cfg.limits.default.max);
    case 'craps':
      return cap(L('field'), stack);
    case 'sicbo':
      return cap(L('even'), stack, cfg.limits.default.max);
    case 'bigsix':
      return cap(L('spot'), stack, cfg.limits.default.max);
    default:
      return -1;
  }
}

const { ctx, page, errors } = await login();
sql(`UPDATE casino_accounts SET balance = 1000000000 WHERE name = '${NAME}' AND in_play = 0`);
// the rich player's balance, as the server has it now
await page.evaluate(async () => window.casino.session.set(await (await import('/casino/src/net/api.ts')).me()));
for (const id of only.length ? only : Object.keys(STATIONS)) {
  try {
    await playStation(page, id);
  } catch (err) {
    check(false, `${id}: ${String(err?.message ?? err).split('\n')[0]}`);
    await shot(page, `${id}-${QUALITY}-error`).catch(() => {});
    // stand up if still seated, for the next station
    await page.evaluate(() => window.casino.world.seated && window.casino.app.escape()).catch(() => {});
    await page.click('.modal .btn.primary', { timeout: 3000 }).catch(() => {});
    await page.waitForFunction(() => window.casino.world.seated === null, null, { timeout: 30_000 }).catch(() => {});
  }
  await page.waitForTimeout(1000);
}
check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
writeFileSync(`${out}/journey-${QUALITY}.json`, JSON.stringify({ problems }, null, 2));
await ctx.close();
await browser.close();
console.log(problems.length ? `${problems.length} problem(s):\n${problems.join('\n')}` : 'every table played as it should');
process.exit(problems.length ? 1 : 0);
