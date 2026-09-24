#!/usr/bin/env node
// Headless check of the v3 table work, in the game proper on High (bloom on):
//   glow   every celebration tier at blackjack, baccarat, Three Card, Hold'em, roulette and craps,
//          shot at full light. The pixels inside each lit card, chip pile or printed spot are
//          compared with the frame before: they must not change (the light lies under and round
//          them, never over them), and the felt just outside must get brighter (the light shows).
//   poker  the poker room from the floor: close up, from across the casino (the far stand-ins
//          must still read green), and the Hold'em model's chairs, rail and fittings checked for
//          overlaps with each other and the table.
// Fixed player names, so reruns reuse the same accounts.
// Usage: node scripts/e2e/tables3.mjs [port] [outDir] [glow|poker ...]

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [port = '5960', out = '/tmp/tables3', ...wanted] = process.argv.slice(2);
const checks = wanted.length ? wanted : ['glow', 'poker'];
mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}/casino/`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const report = { glow: {}, poker: {}, shots: [], errors: [] };
const fail = (msg) => report.errors.push(msg);
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);

async function newPage(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem('casino.quality', 'high'));
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && fail(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => fail(`${name}: ${e}`));
  return page;
}

async function shot(page, name) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path });
  report.shots.push(path);
}

/**
 * Click through the DOM: on High the menu's backdrop scene renders so slowly under software GL
 * that Playwright's wait for a steady element can run out.
 */
const press = (page, sel) => page.$eval(sel, (e) => e.click());

async function enterFloor(page, name) {
  await page.goto(base);
  await page.waitForSelector('.name-input, .menu-item', { timeout: 180_000 });
  if (await page.$('.name-input')) {
    await page.fill('.name-input', name);
    await press(page, '.enter-btn');
  }
  await page.waitForSelector('.menu-item', { timeout: 60_000 });
  await press(page, '.menu-item');
  await page.waitForSelector('.hud', { timeout: 120_000 });
  await page.waitForTimeout(1500);
}

async function sit(page, station, buyIn = 2000) {
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, station);
  await page.waitForSelector('.lobby-choice', { timeout: 20_000 });
  await page.keyboard.press('s');
  // a returning name can still hold its seat: then the table comes straight up
  await page.waitForFunction(() => document.querySelector('.modal input[type=number]') || window.casino.app.table?.seated === true, null, { timeout: 30_000 });
  if (await page.$('.modal input[type=number]')) {
    await page.fill('.modal input[type=number]', String(buyIn));
    await press(page, '.modal .btn.primary');
  }
  await page.waitForFunction(() => window.casino.app.table?.seated === true && window.casino.app.table.session.view, null, { timeout: 30_000 });
  // the table's own light eases up over a second or two
  await page.waitForTimeout(3500);
}

async function stand(page) {
  await page.evaluate(() => window.casino.app.escape());
  const leave = await page.waitForSelector('.modal .btn.primary', { timeout: 4000 }).catch(() => null);
  if (leave) await press(page, '.modal .btn.primary');
  await page.waitForFunction(() => !window.casino.app.table, null, { timeout: 60_000 }).catch(() => fail('could not stand up'));
  await page.waitForTimeout(1500);
}

/** Wait until the table has played every animation it was sent. */
async function settle(page, extra = 400) {
  for (let quiet = 0; quiet < 3; ) {
    await page.waitForTimeout(250);
    quiet = (await page.evaluate(() => window.casino.app.table?.session.pending ?? 0)) === 0 ? quiet + 1 : 0;
  }
  await page.waitForTimeout(extra);
}

const act = (page, a) => page.evaluate((a) => window.casino.app.table.session.link.act(a), a);

// ---------------------------------------------------------------------------------------------
// In-page helpers: find the things to light, fire the kit, read pixels back.

async function installHelpers(page) {
  await page.evaluate(async () => {
    // the same module instance the tables use (same URL)
    const kit = await import(`${location.pathname}src/table/celebrate.ts`);
    window.__t3 = { kit };
  });
}

/**
 * Fire one moment with the kit and measure it: the mean colour inside each lit thing (shrunk so
 * only its face counts) and in a band just outside it, before and at full light.
 */
async function measure(page, label, spec) {
  const res = await page.evaluate(async ({ spec }) => {
    const { engine } = window.casino;
    const session = window.casino.app.table.session;
    const stage = session.stage;
    const cam = engine.camera;
    const W = engine.renderer.domElement.width;
    const H = engine.renderer.domElement.height;
    const sx = W / innerWidth;
    const objects = window.__t3.pick(spec);
    // screen rectangles of each thing: its face (shrunk), and its surroundings
    const rectOf = (pts) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        const v = p.clone().project(cam);
        const x = ((v.x + 1) / 2) * W;
        const y = ((1 - v.y) / 2) * H;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      return [x0, y0, x1, y1];
    };
    const faces = objects.faces.map(rectOf);
    let frame = null;
    const read = (keep = false) => {
      engine.renderer.render(engine.scene, engine.camera);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(engine.renderer.domElement, 0, 0);
      // the measured frame itself, for the eye (a screenshot comes too late on a slow renderer)
      if (keep) frame = c.toDataURL('image/png');
      const mean = ([x0, y0, x1, y1]) => {
        x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
        x1 = Math.min(W, Math.round(x1)); y1 = Math.min(H, Math.round(y1));
        if (x1 - x0 < 2 || y1 - y0 < 2) return null;
        const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
        let r = 0, gg = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        return [r / n, gg / n, b / n];
      };
      return faces.map(([x0, y0, x1, y1]) => {
        const w = x1 - x0, h = y1 - y0;
        const inner = [x0 + w * 0.22, y0 + h * 0.22, x1 - w * 0.22, y1 - h * 0.22];
        // a band 3-9 px outside the thing's screen box, left and right (the near and far edges can
        // be hidden by the thing's own thickness from a low camera)
        const pad = 3 * sx, span = 6 * sx;
        const around = [[x0 - pad - span, y0 + h * 0.3, x0 - pad, y1 - h * 0.3], [x1 + pad, y0 + h * 0.3, x1 + pad + span, y1 - h * 0.3]];
        return { face: mean(inner), around: around.map(mean).filter(Boolean) };
      });
    };
    const before = read();
    const stop = window.__t3.kit.celebrate({ stage, ui: session.ui, sfx: session.sfx }, { title: spec.title, sub: spec.sub, tier: spec.tier, glow: objects.glow, spots: objects.spots, at: objects.at });
    // wait for full light: the rings' material past most of its peak
    const t0 = performance.now();
    await new Promise((r) => {
      const tick = () => {
        const ring = stage.root.children.find((o) => o.isMesh && o.material?.alphaMap && o.material.blending === 2);
        if ((ring && ring.material.opacity > 0.8 * { nice: 0.28, big: 0.34, huge: 0.4 }[spec.tier]) || performance.now() - t0 > 6000) r();
        else requestAnimationFrame(tick);
      };
      tick();
    });
    const during = read(true);
    window.__t3.stop = stop;
    const diff = (a, b) => (a && b ? Math.max(...a.map((v, i) => Math.abs(v - b[i]))) : null);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return {
      frame,
      rows: before.map((b, i) => ({
        face: diff(b.face, during[i].face),
        faceLum: b.face ? Math.round(lum(b.face)) : null,
        lift: b.around.length ? Math.round(Math.max(...b.around.map((a, k) => lum(during[i].around[k]) - lum(a)))) : null,
      })),
    };
  }, { spec });
  const path = `${out}/glow-${label}.png`;
  writeFileSync(path, Buffer.from(res.frame.split(',')[1], 'base64'));
  report.shots.push(path);
  // and the page as it is now (the banner, if it's still up)
  await shot(page, `glow-${label}-page`);
  await page.evaluate(() => window.__t3.stop?.());
  await page.waitForTimeout(spec.tier === 'huge' ? 3400 : 900);
  const faces = res.rows.map((r) => r.face).filter((v) => v !== null);
  const lifts = res.rows.map((r) => r.lift).filter((v) => v !== null);
  const entry = { faceChange: faces.length ? +Math.max(...faces).toFixed(1) : null, glowLift: lifts.length ? Math.max(...lifts) : null, faceLum: res.rows.map((r) => r.faceLum) };
  report.glow[label] = entry;
  // a lit thing's face may move by a unit or two (dithering, the breath of the light on its edge)
  if (entry.faceChange === null) fail(`${label}: nothing measured`);
  else if (entry.faceChange > 4) fail(`${label}: the light changed what it lit by ${entry.faceChange}/255`);
  if (entry.glowLift !== null && entry.glowLift < 6) fail(`${label}: the light hardly shows round it (+${entry.glowLift})`);
  log(`${label}: ${JSON.stringify(entry)}`);
}

// Which things each table lights, found in its stage the way its view passes them.
const PICKERS = `
window.__t3.pick = (spec) => {
  const { engine } = window.casino;
  const session = window.casino.app.table.session;
  const view = session.view;
  const root = session.stage.root;
  // new vectors from the page's own three (a copy of one it already made)
  const V = (x, y, z) => root.position.clone().set(x, y, z);
  const cornersOf = (m) => {
    // the card's top face corners, in world space
    const g = m.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    const y = m.rotation.x > 1.5 ? b.min.y : b.max.y;
    return [[b.min.x, y, b.min.z], [b.max.x, y, b.min.z], [b.max.x, y, b.max.z], [b.min.x, y, b.max.z]].map(([x, yy, z]) => m.localToWorld(V(x, yy, z)));
  };
  const cardsNear = (n) => {
    const camLocal = root.worldToLocal(engine.camera.position.clone());
    return root.children.filter((o) => 'card' in o && o.card && o.visible && Math.abs(o.rotation.x) < 1.2)
      .sort((a, b) => a.position.distanceToSquared(camLocal) - b.position.distanceToSquared(camLocal)).slice(0, n);
  };
  if (spec.game === 'blackjack') {
    const cards = [...view.cards.entries()].filter(([k]) => k.startsWith('c:' + view.seat + ':')).map(([, m]) => m);
    return { glow: [cards], faces: cards.map(cornersOf) };
  }
  if (spec.game === 'baccarat') {
    const hands = ['player', 'banker'].map((h) => view.cards[h].slice(0, 2));
    return { glow: hands, faces: hands.flat().map(cornersOf) };
  }
  if (spec.game === 'threecard') {
    const cards = cardsNear(3);
    const mid = cards[1] ? cards[1].position.clone() : undefined;
    return { glow: [cards], faces: cards.map(cornersOf), at: spec.tier === 'huge' ? mid : undefined };
  }
  if (spec.game === 'holdem') {
    const cards = root.children.filter((o) => 'card' in o && o.card && o.visible && o.scale.x > 1.2);
    const board = cards.filter((c) => c.scale.x > 1.5).slice(0, 3);
    const mine = cards.filter((c) => c.scale.x < 1.5);
    const five = [...board, ...mine];
    const at = mine[0] ? V(0, mine[0].position.y, mine[0].position.z - 0.12) : undefined;
    return { glow: five, faces: five.map(cornersOf), at: spec.tier === 'huge' ? at : undefined };
  }
  if (spec.game === 'roulette' || spec.game === 'craps') {
    const spots = spec.spots;
    // the printed spot's middle (where the number or the box's words are)
    const faces = spots.map((s) => [V(s.x - s.w / 2, s.y, s.z - s.d / 2), V(s.x + s.w / 2, s.y, s.z - s.d / 2), V(s.x + s.w / 2, s.y, s.z + s.d / 2), V(s.x - s.w / 2, s.y, s.z + s.d / 2)].map((p) => root.localToWorld(p)));
    return { glow: [], spots, faces };
  }
  return { glow: [], faces: [] };
};
`;

// ---------------------------------------------------------------------------------------------

async function glowChecks() {
  const page = await newPage('glow');
  await enterFloor(page, 't3_glow');
  await installHelpers(page);
  await page.evaluate(PICKERS);
  const only = process.env.GAMES ? process.env.GAMES.split(',') : null;
  const want = (g) => !only || only.includes(g);
  const tiers = ['nice', 'big', 'huge'];
  const titles = { nice: 'Nice hand', big: 'Big win', huge: 'Huge win' };

  // Blackjack: bet, deal, stand, and light your hand while it's still on the felt.
  if (want('blackjack')) {
    await sit(page, 'bj-1');
    await act(page, { type: 'bet', amount: 2500 });
    await page.waitForTimeout(600);
    await act(page, { type: 'deal' });
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      const s = await page.evaluate(() => {
        const v = window.casino.app.table.session.view;
        return { phase: v.v?.phase, turn: v.v?.turn, seat: v.seat, insure: !v.insure?.hidden };
      });
      if (s.insure) await act(page, { type: 'insurance', take: false });
      else if (s.phase === 'play' && s.turn?.seat === s.seat) await act(page, { type: 'stand' });
      if (s.phase === 'betting' || s.phase === 'settled' || s.phase === 'done') break;
    }
    await settle(page, 800);
    await shot(page, 'glow-blackjack-0-before');
    for (const tier of tiers.slice(0, 2)) await measure(page, `blackjack-${tier}`, { game: 'blackjack', tier, title: tier === 'big' ? 'Blackjack' : 'Double down', sub: 'Pays 3 to 2 · +$37.50' });
    await stand(page);
  }

  // Baccarat: a coup, then both hands' first two cards lit (the pair bets).
  if (want('baccarat')) {
    await sit(page, 'bc-1');
    await act(page, { type: 'bet', banker: 2500 });
    await page.waitForTimeout(500);
    await act(page, { type: 'deal' });
    await settle(page, 1500);
    await shot(page, 'glow-baccarat-0-before');
    for (const tier of tiers) await measure(page, `baccarat-${tier}`, { game: 'baccarat', tier, title: tier === 'nice' ? 'Natural 9' : 'Both pairs', sub: 'Pays 11 to 1 · +$55' });
    // and once through the view's own call (a player pair)
    await page.evaluate(() => {
      const v = window.casino.app.table.session.view;
      v.celebrateCoup({ seat: v.mySeat, returned: 30000, wagered: 3000, spots: { playerPair: { outcome: 'win', bet: 500, returned: 6000 } } }, { winner: 'player', natural: false, playerTotal: 8, bankerTotal: 3 });
    });
    await page.waitForTimeout(700);
    await shot(page, 'glow-baccarat-view-pair');
    await page.waitForTimeout(2800);
    await stand(page);
  }

  // Three Card: ante, deal, play, and light the three cards after the reveal.
  if (want('threecard')) {
    await sit(page, 'tc-1');
    await act(page, { type: 'bet', ante: 1000, pairPlus: 500 });
    await page.waitForTimeout(500);
    await act(page, { type: 'deal' });
    await page.waitForSelector('.tc-decide:not([hidden])', { timeout: 40_000 }).catch(() => fail('threecard: no decision'));
    await page.waitForTimeout(800);
    await act(page, { type: 'play' });
    await settle(page, 1500);
    await shot(page, 'glow-threecard-0-before');
    for (const tier of tiers) await measure(page, `threecard-${tier}`, { game: 'threecard', tier, title: tier === 'huge' ? 'Straight flush' : tier === 'big' ? 'Three of a kind' : 'Flush', sub: 'Pays 40 to 1' });
    await stand(page);
  }

  // Hold'em: a scripted showdown (the feed paused), then the five lit at each tier.
  if (want('holdem')) {
    await sit(page, 'he-1', 1000);
    await page.evaluate(() => {
      const t = window.casino.app.table.session;
      const feed = t.onMessage.bind(t);
      t.onMessage = (m) => {
        if (m?.view) window.__lastView = m.view;
        if (!window.__paused) feed(m);
      };
    });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      window.__paused = true;
      const t = window.casino.app.table.session;
      const snap = structuredClone(t.snapshot);
      snap.view = structuredClone(window.__lastView ?? snap.view);
      const v = snap.view;
      const me = v.you.seat;
      const opp = v.seats.findIndex((s, i) => s && i !== me);
      const board = ['Kh', 'Kd', '9s', '9h', '2c'];
      Object.assign(v, { at: Date.now() + 1e7, phase: 'results', handId: 9002, street: 'river', board, pots: [], total: 0, bet: 0, turn: null, nextAt: null, log: [] });
      v.you = { seat: me, cards: ['Kc', '3d'], legal: null, sittingOut: false, waiting: false, bank: 30000 };
      v.seats.forEach((s, i) => {
        if (!s) return;
        Object.assign(s, { inHand: false, folded: i !== me && i !== opp, allIn: false, bet: 0, last: null, hand: null, best: null, won: 0, sittingOut: false, waiting: false, away: false, cards: i === me ? ['Kc', '3d'] : i === opp ? ['Ah', 'Qd'] : [] });
      });
      t.view.onTable(snap);
    });
    await page.waitForTimeout(1500);
    await shot(page, 'glow-holdem-0-before');
    for (const tier of tiers) await measure(page, `holdem-${tier}`, { game: 'holdem', tier, title: 'Full house', sub: 'Kings full of nines · $1,500' });
    await page.evaluate(() => (window.__paused = false));
    await stand(page);
  }

  // Roulette: chips on a number, then the number and a split's cells lit.
  if (want('roulette')) {
    await sit(page, 'rl-us');
    await act(page, { type: 'bet', bets: [{ kind: 'straight', numbers: [17], amount: 500 }] });
    await page.waitForTimeout(1500);
    const spots = await page.evaluate(async () => {
      const L = await import(`${location.pathname}src/games/roulette/layout.ts`);
      const M = await import(`${location.pathname}src/games/roulette/model.ts`);
      // the felt the view lays (TOP_Y + 0.0007), and the number's printed cell
      const r = L.layoutOf('american').cells.get(17);
      return r ? [{ x: r.x, y: M.TOP_Y + 0.0007, z: r.z, w: r.w, d: r.d }] : [];
    });
    if (!spots.length) fail('roulette: could not find the number 17 on the layout');
    await shot(page, 'glow-roulette-0-before');
    for (const tier of tiers) if (spots.length) await measure(page, `roulette-${tier}`, { game: 'roulette', tier, title: 'Straight up', sub: 'Pays 35 to 1 · +$175', spots });
    await stand(page);
  }

  // Craps: a hardway bet down, then its printed box lit.
  if (want('craps')) {
    await sit(page, 'cr-1');
    await act(page, { type: 'bet', bets: [{ kind: 'hard', number: 8, amount: 500 }] });
    await page.waitForTimeout(1500);
    const spots = await page.evaluate(async () => {
      const L = await import(`${location.pathname}src/games/craps/layout.ts`);
      const view = window.casino.app.table.session.view;
      const y = view.felt.mesh.position.y;
      return ['hard8', 'field'].map((id) => L.spotRect(id, 1)).filter(Boolean).map((r) => ({ x: (r[0] + r[2]) / 2, z: (r[1] + r[3]) / 2, w: r[2] - r[0], d: r[3] - r[1], y }));
    });
    if (!spots.length) fail('craps: no printed boxes found');
    await shot(page, 'glow-craps-0-before');
    for (const tier of tiers) if (spots.length) await measure(page, `craps-${tier}`, { game: 'craps', tier, title: 'Hard eight', sub: 'Pays 9 to 1 · +$45', spots: spots.slice(0, 1) });
    await stand(page);
  }
  await page.context().close();
}

// ---------------------------------------------------------------------------------------------

try {
  if (checks.includes('glow')) await glowChecks();
} catch (err) {
  fail(`stopped: ${String(err).split('\n')[0]}`);
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
process.exit(report.errors.length ? 1 : 0);
