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
import { READ_MODEL } from './read-model.mjs';

const [port = '6110', out = '/tmp/casino-journey', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const QUALITY = process.env.QUALITY ?? 'low';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const NAME = process.env.NAME ?? `qa_jr_${QUALITY}`;
const gpu = process.env.GPU === '1';
const ROOT = process.cwd();
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

/** How each table is played: Max's spot (and the later rounds' chip), the round's decisions, its end. */
const GAMES = {
  blackjack: { max: (seat) => ({ felt: `spot:${seat}` }), keys: { turn: 's', insurance: 'n' }, end: ['done'] },
  // (baccarat's seats are numbered from the middle out: the first player sits at 4)
  baccarat: { max: (seat) => ({ felt: `s${[4, 3, 5, 2, 6, 1, 7][seat]}:banker` }), keys: {}, end: ['result', 'outcome'] },
  threecard: { max: (seat) => ({ felt: `ante:${seat}` }), keys: { decide: 'p' }, end: ['result'] },
  war: { max: (seat) => ({ felt: `bet:${seat}` }), keys: { decide: 'w' }, end: ['result'] },
  roulette: { max: () => ({ screen: 'red' }), keys: {}, end: ['settle'] },
  craps: { max: () => ({ felt: 'R|field', alt: 'L|field' }), keys: {}, end: ['roll'] },
  sicbo: { max: () => ({ screen: 'small' }), keys: {}, end: ['settle'] },
  bigsix: { max: () => ({ screen: 'one' }), keys: {}, end: ['settle'] },
};

const STATIONS = {
  'bj-1': 'blackjack', 'bj-2': 'blackjack', 'bc-1': 'baccarat', 'tc-1': 'threecard', 'wr-1': 'war',
  'rl-us': 'roulette', 'rl-eu': 'roulette', 'cr-1': 'craps', 'sb-1': 'sicbo', 'b6-1': 'bigsix',
  'vip-bj-1': 'blackjack', 'vip-bc-1': 'baccarat', 'vip-rl-1': 'roulette',
  'he-1': 'holdem', 'vp-1': 'videopoker',
  'slots-sevens-1': 'slots', 'slots-neon-1': 'slots', 'slots-wild-1': 'slots', 'slots-diamonds-1': 'slots', 'slots-cherries-1': 'slots', 'slots-goldrush-1': 'slots',
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
  await onFloor(page);
  return { ctx, page, errors };
}

/**
 * Onto the floor: log in, past the look editor or the menu. Also after the page has reloaded
 * under a run (the dev server's live-reload socket can drop under load, and its client reloads).
 */
async function onFloor(page) {
  if (await page.evaluate(() => !!window.casino?.app && !!document.querySelector('.hud')).catch(() => false)) return;
  await page.waitForSelector('.front:not(.closing) .name-input, .menu-item, .editor-panel.guided, .hud', { timeout: 600_000 });
  if (await page.$('.front:not(.closing) .name-input')) {
    await page.fill('.name-input', NAME);
    await page.fill('.pass-input', 'casino-dev');
    await page.click('.enter-btn');
    await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  }
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else if (!(await page.$('.hud'))) {
    await page.click('.menu-item >> nth=0');
  }
  await page.waitForSelector('.hud', { timeout: 120_000 });
  await page.evaluate(async () => window.casino.session.set(await (await import('/casino/src/net/api.ts')).me()));
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

/**
 * A seat held from an earlier run that stopped part way comes back as it was, chips and bets and
 * all: stand up from it first (its chips go home), so every station starts from a fresh buy-in.
 */
async function standUpIfHeld(page, id) {
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, id);
  await page.waitForSelector('.lim-opt, .modal input[type=number]', { timeout: 30_000 }).catch(() => {});
  if (await page.$('.lim-opt')) await page.keyboard.press('s');
  const held = await page
    .waitForFunction(() => (window.casino.app.table?.seated === true ? 'held' : document.querySelector('.modal input[type=number]') ? 'fresh' : null), null, { timeout: 60_000 })
    .then((h) => h.jsonValue())
    .catch(() => 'fresh');
  if (held === 'held') log(`${id}: a seat from an earlier run was still held; standing up from it first`);
  await page.evaluate(() => window.casino.app.escape());
  const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 4000 }).catch(() => null);
  if (leave && held === 'held') await leave.click();
  else await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.casino.world.seated === null, null, { timeout: 30_000 }).catch(() => {});
  // the chips come home: wait for the profile to say so
  for (let i = 0; i < 20; i++) {
    const p = await page.evaluate(async () => window.casino.session.set(await (await import('/casino/src/net/api.ts')).me()) ?? window.casino.session.profile);
    if (held !== 'held' || p) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(held === 'held' ? 3000 : 500);
  await page.evaluate(async () => window.casino.session.set(await (await import('/casino/src/net/api.ts')).me()));
}

async function playStation(page, id) {
  const game = STATIONS[id];
  const spec = GAMES[game];
  const tag = `${id}-${QUALITY}`;
  const profile0 = await page.evaluate(() => window.casino.app && window.casino.session?.profile);
  const balance0 = profile0?.balance ?? 0;
  // (chips still parked at other tables from an earlier run stay in play)
  const inPlay0 = profile0?.inPlay ?? 0;
  // a bet that went down in a round that never dealt comes back when you leave
  let undealt = 0;
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
  // the model's own reading of each result (the ball's pocket, the dice, the clapper), as anim.mjs
  await page.evaluate(`window.__qa = (${READ_MODEL.toString()})()`);
  const order = await page.evaluate(async ([root, game]) => {
    const variant = window.casino.app.table.session.snapshot.meta.variant;
    if (game === 'roulette') return (await import(`/casino/@fs${root}/shared/src/games/roulette/rules.ts`)).WHEEL[variant];
    if (game === 'bigsix') return (await import(`/casino/@fs${root}/shared/src/games/bigsix/rules.ts`)).WHEEL;
    return null;
  }, [ROOT, game]);

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
    } else if (r === ROUNDS - 1 && game !== 'craps') {
      // the last round puts nothing down: Space alone repeats the last round's bets and goes
      placed = -1;
    } else {
      // as a player would: the smallest chip on show, on the same spot (a chip under the spot's
      // minimum puts the minimum down)
      await page.keyboard.press('1');
      const at = await screenOf(page, spec.max(seat));
      if (at) await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(1200);
      placed = s0 - (await stackOf(page));
      check(placed > 0, `${id} round ${r}: a chip went down (${placed / 100})`);
    }
    // --- the round: Space, then the decisions (the highlighted control while Tips are on)
    const tipsNow = r < ROUNDS - 1;
    if (!tipsNow) await page.evaluate(() => localStorage.getItem('casino.tips') === '1' && document.querySelector('.hud [aria-label="Tips at the tables"], .hud [title="Tips at the tables"]')?.click());
    await page.keyboard.press('Space');
    if (placed === -1) {
      await page.waitForTimeout(1200);
      placed = s0 - (await stackOf(page));
      check(placed > 0 || (await page.evaluate(() => window.casino.app.table.session.__events.some((e) => e.type === 'bet' || e.type === 'bets'))), `${id} round ${r}: Space with nothing down put the last bets back and went (${placed / 100} down)`);
    }
    const t0 = Date.now();
    let tipLines = 0;
    let tipPicks = 0;
    let mid = false;
    while (Date.now() - t0 < 90_000) {
      const st = await page.evaluate((end) => {
        const s = window.casino.app.table.session;
        const tip = document.querySelector('.tip-line:not([hidden])');
        const pick = [...document.querySelectorAll('button.tip-pick')].find((e) => e.offsetParent !== null && !e.disabled);
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
        await page.click('button.tip-pick:not([disabled])', { timeout: 2000 }).catch(() => {});
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
    if (!res.types.split(',').some((t) => spec.end.includes(t))) undealt += placed;
    if (['roulette', 'craps', 'sicbo', 'bigsix'].includes(game)) {
      const m = await page.evaluate(([game, order]) => {
        const qa = window.__qa;
        const ev = window.casino.app.table.session.__events.find((e) => e.type === 'spin' || e.type === 'roll');
        if (!ev) return null;
        if (game === 'roulette') {
          const r = qa.roulette(order);
          return { drew: ev.pocket, shows: r.floor, also: r.ring, ok: r.floor === ev.pocket && r.ring === ev.pocket };
        }
        if (game === 'bigsix') {
          const r = qa.wheel('bigsix-rotor', 'bigsix-flap', order.length);
          return { drew: ev.stop, shows: r.index, ok: r.index === ev.stop };
        }
        const d = qa.dice();
        const shows = d.map((x) => x.face).sort().join('');
        const drew = [...ev.dice].sort().join('');
        return { drew, shows, ok: shows === drew && d.every((x) => x.up > 0.995) };
      }, [game, order]);
      if (m) check(m.ok, `${id} round ${r}: the model shows what was drawn (${JSON.stringify(m.drew)}, the model ${JSON.stringify(m.shows)})`);
    }
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

  // --- several hands at once (blackjack's five spots, Three Card's and War's three)
  if (['blackjack', 'threecard', 'war'].includes(game)) {
    const most = await page.$$eval('.mh-picker .mh-n', (bs) => bs.length);
    if (check(most > 1, `${id}: the Hands picker offers ${most}`)) {
      await page.click(`.mh-picker .mh-n >> nth=${most - 1}`);
      await page.waitForFunction((n) => (window.casino.app.table.session.__view?.mine?.length ?? 0) === n, most, { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const s0 = await stackOf(page);
      const mine = await page.evaluate(() => window.casino.app.table.session.__view?.mine ?? []);
      await page.evaluate(() => {
        const s = window.casino.app.table.session;
        s.__events = [];
        s.__errs = [];
      });
      await page.keyboard.press('1');
      for (const m of mine) {
        const at = await screenOf(page, spec.max(m));
        if (at) await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(500);
      }
      const staked = s0 - (await stackOf(page));
      check(staked > 0, `${id}: ${mine.length} hands bet (${staked / 100} down)`);
      await page.keyboard.press('Space');
      const t0 = Date.now();
      let px = null;
      while (Date.now() - t0 < 120_000) {
        const st = await page.evaluate((end) => {
          const s = window.casino.app.table.session;
          const { engine } = window.casino;
          // how wide the smallest face-up card is on screen, in pixels
          let min = Infinity;
          s.stage.root.traverse((o) => {
            if (!('card' in o) || !o.card || !o.visible || Math.abs(o.rotation.x) > 1.2) return;
            const g = o.geometry;
            if (!g.boundingBox) g.computeBoundingBox();
            const b = g.boundingBox;
            const a = o.localToWorld(engine.camera.position.clone().set(b.min.x, b.max.y, 0)).project(engine.camera);
            const c = o.localToWorld(engine.camera.position.clone().set(b.max.x, b.max.y, 0)).project(engine.camera);
            min = Math.min(min, (Math.hypot(a.x - c.x, (a.y - c.y) * innerHeight / innerWidth) / 2) * innerWidth);
          });
          return { ended: s.__events.some((e) => end.includes(e.type)), min: Number.isFinite(min) ? Math.round(min) : null, pick: !!document.querySelector('.tip-pick') };
        }, spec.end);
        if (st.min !== null) px = px === null ? st.min : Math.min(px, st.min);
        if (st.ended) break;
        for (const k of Object.values(spec.keys)) await page.keyboard.press(k);
        await page.waitForTimeout(700);
      }
      await settle(page, 1500);
      await shot(page, `${tag}-6-hands${mine.length}`);
      const res = await page.evaluate(() => {
        const s = window.casino.app.table.session;
        const { engine } = window.casino;
        const rest = s.stage.restPose(engine.camera);
        return { d: +engine.camera.position.distanceTo(rest.pos).toFixed(3), errs: s.__errs, types: [...new Set(s.__events.map((e) => e.type))].join(',') };
      });
      const net = (await stackOf(page)) - s0;
      if (!res.types.split(',').some((t) => spec.end.includes(t))) undealt += staked;
      log(`${id}: ${mine.length} hands, net ${net / 100}, smallest card ${px} px wide, events ${res.types}`);
      check(res.d < 0.02, `${id}: with ${mine.length} hands the camera is back at the seat (${res.d} m)`);
      check(res.errs.length === 0, `${id}: with ${mine.length} hands nothing refused (${res.errs.join(' | ')})`);
      // (a measurement, not a verdict: the framing takes in every hand between the celebration
      // banner and the tray, and the hands' totals and results are written out beside them)
      log(`${id}: with ${mine.length} hands the smallest card is ${px} px wide at 1280x800`);
    }
  }

  // --- leave: Esc, Leave; the balance comes home
  const stackEnd = await stackOf(page);
  // craps: a winning bet stays up on the layout (only the win is paid over), so it comes home too
  if (game === 'craps') {
    undealt += await page.evaluate(() => {
      const s = window.casino.app.table.session;
      const mine = s.__view?.bets?.[s.snapshot.you.seat] ?? {};
      return Object.values(mine).reduce((a, b) => a + (b?.amount ?? 0) + (b?.odds ?? 0), 0);
    });
  }
  await page.evaluate(() => window.casino.app.escape());
  const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 5000 }).catch(() => null);
  if (leave) await leave.click();
  await page.waitForFunction(() => window.casino.world.seated === null, null, { timeout: 30_000 });
  const t0 = Date.now();
  let prof = null;
  while (Date.now() - t0 < 30_000) {
    prof = await page.evaluate(async () => (await import('/casino/src/net/api.ts')).me());
    if (prof?.inPlay === inPlay0) break;
    await page.waitForTimeout(1000);
  }
  const want = balance0 - buyIn + stackEnd + undealt;
  check(prof?.balance === want && prof?.inPlay === inPlay0, `${id}: cashed out, balance ${prof?.balance / 100} = ${balance0 / 100} - ${buyIn / 100} + the stack ${stackEnd / 100}${undealt ? ` + ${undealt / 100} undealt` : ''} (in play ${prof?.inPlay / 100}, was ${inPlay0 / 100})`);
  // the app asks for the profile a moment after leaving (the cash-out lands after the socket closes)
  let hud = null;
  for (let i = 0; i < 20 && hud !== prof?.balance; i++) {
    hud = await page.evaluate(() => window.casino.session.profile?.balance);
    if (hud !== prof?.balance) await page.waitForTimeout(1000);
  }
  check(hud === prof?.balance, `${id}: the HUD shows the balance the server has (${hud / 100})`);
}

/** Leave the table (Esc, Leave) and check the balance comes home. */
async function leaveAndReconcile(page, id, balance0, inPlay0, buyIn, extra = 0) {
  const stackEnd = await stackOf(page);
  await page.evaluate(() => window.casino.app.escape());
  const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 5000 }).catch(() => null);
  if (leave) await leave.click();
  await page.waitForFunction(() => window.casino.world.seated === null, null, { timeout: 30_000 });
  const t0 = Date.now();
  let prof = null;
  while (Date.now() - t0 < 30_000) {
    prof = await page.evaluate(async () => (await import('/casino/src/net/api.ts')).me());
    if (prof?.inPlay === inPlay0) break;
    await page.waitForTimeout(1000);
  }
  const want = balance0 - buyIn + stackEnd + extra;
  check(prof?.balance === want && prof?.inPlay === inPlay0, `${id}: cashed out, balance ${prof?.balance / 100} = ${balance0 / 100} - ${buyIn / 100} + the stack ${stackEnd / 100} (in play ${prof?.inPlay / 100}, was ${inPlay0 / 100})`);
}

/** Sit down alone: the limits (when the game has them), then the biggest quick buy-in. */
async function sitAlone(page, id, tier) {
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, id);
  await page.waitForSelector('.lim-opt, .modal input[type=number]', { timeout: 30_000 });
  if (await page.$('.lim-opt')) {
    if (tier !== null) await page.click(`.lim-opt >> nth=${tier}`);
    await shot(page, `${id}-${QUALITY}-0-limits`);
    await page.keyboard.press('s');
    await page.waitForSelector('.modal input[type=number]', { timeout: 60_000 });
  }
  await page.click('.modal .row:first-of-type .btn >> nth=-1');
  const buyIn = Math.round(Number(await page.inputValue('.modal input[type=number]')) * 100);
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 60_000 });
  await trackSession(page);
  const stack0 = await stackOf(page);
  check(stack0 === buyIn, `${id}: bought in for ${buyIn / 100}, stack ${stack0 / 100}`);
  return buyIn;
}

/** Hold'em against the bots: hands played by the Tips (then C), and All-in (A, A) once. */
async function playHoldem(page, id) {
  const prof0 = await page.evaluate(() => window.casino.session.profile);
  const buyIn = await sitAlone(page, id, 2);
  const dealer = await page.evaluate((id) => !!window.casino.world.staff?.at?.(id), id);
  check(dealer, `${id}: a dealer stands at the table`);
  await page.waitForTimeout(1500);
  await shot(page, `${id}-${QUALITY}-2-seated`);
  await page.click('.hud [aria-label="Tips at the tables"], .hud [title="Tips at the tables"]').catch(() => {});
  let hands = 0;
  let allin = false;
  let tipSeen = 0;
  const t0 = Date.now();
  while (hands < ROUNDS && Date.now() - t0 < 240_000) {
    const st = await page.evaluate(() => {
      const s = window.casino.app.table.session;
      const v = s.__view;
      const me = s.snapshot?.you?.seat;
      const wins = s.__events.filter((e) => e.type === 'win').length;
      const pick = [...document.querySelectorAll('button.tip-pick')].find((e) => e.offsetParent !== null && !e.disabled);
      return { mine: v?.turn?.seat === me, wins, tip: !!document.querySelector('.tip-line:not([hidden])'), pick: !!pick, stack: s.snapshot?.you?.stack ?? 0 };
    });
    hands = st.wins;
    if (st.tip) tipSeen++;
    if (st.mine) {
      if (!allin && hands === ROUNDS - 1) {
        allin = true;
        await page.keyboard.press('a');
        await page.waitForTimeout(250);
        await page.keyboard.press('a');
        await shot(page, `${id}-${QUALITY}-3-allin`);
      } else if (st.pick) await page.click('button.tip-pick:not([disabled])', { timeout: 2000 }).catch(() => {});
      else await page.keyboard.press('c');
      await page.waitForTimeout(900);
    } else await page.waitForTimeout(400);
    if (hands === 1 && tipSeen < 1000) {
      await shot(page, `${id}-${QUALITY}-4-hand`);
      tipSeen += 1000;
    }
  }
  check(hands >= ROUNDS, `${id}: ${hands} hands played against the bots`);
  check(tipSeen % 1000 > 0, `${id}: the Tips spoke on a decision`);
  await settle(page, 2000);
  const res = await page.evaluate(() => {
    const s = window.casino.app.table.session;
    const { engine } = window.casino;
    const rest = s.stage.restPose(engine.camera);
    return { d: engine.camera.position.distanceTo(rest.pos), errs: s.__errs, gestures: [...new Set(s.__gestures)] };
  });
  check(res.d < 0.02, `${id}: the camera is at the seat (${res.d.toFixed(3)} m)`);
  check(res.errs.length === 0, `${id}: the table refused nothing (${res.errs.join(' | ')})`);
  log(`${id}: dealer gestures ${res.gestures.join(',') || 'none'}`);
  await shot(page, `${id}-${QUALITY}-5-after`);
  // a hand in progress is folded on the way out; wait for the one being played to finish
  await page.waitForFunction(() => {
    const s = window.casino.app.table.session;
    return !s.__view?.turn || s.__view.phase === 'waiting' || s.__view.phase === 'results';
  }, null, { timeout: 60_000 }).catch(() => {});
  await leaveAndReconcile(page, id, prof0.balance, prof0.inPlay ?? 0, buyIn);
}

/** A machine: Max (A) for the most coins, spins or hands with Space, then cash out. */
async function playMachine(page, id, game) {
  const prof0 = await page.evaluate(() => window.casino.session.profile);
  const buyIn = await sitAlone(page, id, null);
  await page.waitForTimeout(1200);
  await shot(page, `${id}-${QUALITY}-2-seated`);
  if (game === 'videopoker') await page.click('.hud [aria-label="Tips at the tables"], .hud [title="Tips at the tables"]').catch(() => {});
  const s0 = await stackOf(page);
  const reset = () =>
    page.evaluate(() => {
      const s = window.casino.app.table.session;
      s.__events = [];
      s.__celebrations = 0;
    });
  await reset();
  // Max: the most coins (video poker's Bet Max deals at once, as the machine's button does)
  await page.keyboard.press('a');
  await page.waitForTimeout(600);
  for (let r = 0; r < ROUNDS; r++) {
    const before = r === 0 ? s0 : await stackOf(page);
    if (r > 0 || game !== 'videopoker') await reset();
    if (r > 0 || game !== 'videopoker') await page.keyboard.press('Space');
    if (game === 'videopoker') {
      await page.waitForFunction(() => window.casino.app.table.session.__events.some((e) => e.type === 'deal'), null, { timeout: 30_000 });
      await settle(page, 600);
      // hold what the Tips ring, then draw
      const held = await page.$$eval('.tip-pick', (els) => els.length);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.casino.app.table.session.__events.some((e) => e.type === 'result'), null, { timeout: 30_000 });
      log(`${id} hand ${r}: the Tips ringed ${held} control(s)`);
    } else {
      await page.waitForFunction(() => window.casino.app.table.session.__events.some((e) => e.type === 'result'), null, { timeout: 30_000 });
    }
    await settle(page, 1200);
    const res = await page.evaluate(() => {
      const s = window.casino.app.table.session;
      const r = s.__events.find((e) => e.type === 'result');
      const go = s.__events.find((e) => e.type === 'spin' || e.type === 'deal');
      return { bet: r?.bet ?? 0, win: (r?.win ?? 0) + (r?.freeWin ?? 0), coins: go?.coins ?? 0, most: s.snapshot.meta.config.options?.maxCoins, cel: s.__celebrations, errs: s.__errs };
    });
    const after = await stackOf(page);
    if (r === 0) check(res.coins === res.most, `${id}: Max (A) set the most coins (${res.coins} of ${res.most}, ${res.bet / 100} a ${game === 'videopoker' ? 'hand' : 'spin'})`);
    check(after - before === res.win - res.bet, `${id} round ${r}: the stack moved by what the machine paid (${(after - before) / 100} = ${res.win / 100} - ${res.bet / 100})`);
    check(res.cel === 0 || res.win > res.bet, `${id} round ${r}: a celebration (${res.cel}) only for a win (${res.win / 100} on ${res.bet / 100})`);
    check(res.errs.length === 0, `${id} round ${r}: nothing refused (${res.errs.join(' | ')})`);
    await shot(page, `${id}-${QUALITY}-5-after${r}`);
  }
  if (game === 'videopoker') await page.click('.hud [aria-label="Tips at the tables"], .hud [title="Tips at the tables"]').catch(() => {});
  await leaveAndReconcile(page, id, prof0.balance, prof0.inPlay ?? 0, buyIn);
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
const reloaded = (err) => /Execution context was destroyed|reading 'app'|reading 'session'|reading 'world'/.test(String(err?.message ?? err));
for (const id of only.length ? only : Object.keys(STATIONS)) {
  const game = STATIONS[id];
  const play = async () => {
    await onFloor(page);
    await standUpIfHeld(page, id);
    if (game === 'holdem') await playHoldem(page, id);
    else if (game === 'videopoker' || game === 'slots') await playMachine(page, id, game);
    else await playStation(page, id);
  };
  try {
    const mark = problems.length;
    try {
      await play();
    } catch (err) {
      if (!reloaded(err)) throw err;
      // the page reloaded under this station (not the game's doing): forget what it half checked
      log(`${id}: the page reloaded mid-station; again from the floor`);
      problems.splice(mark);
      await play();
    }
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
