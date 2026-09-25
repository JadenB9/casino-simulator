#!/usr/bin/env node
// Drinking and eating at the bar, on the real stack: the menu, an order walked over by a waiter,
// sipping (Q) and the glass going down, a remote player seeing it from the front and the side, an
// espresso's quicker pace, a toast between two players (both screens), a Dom sprayed, a cake's
// candles blown out, a bite from a plate, the chips on the HUD, and the empty taken away.
//
// Usage: node scripts/e2e/dine6.mjs [port] [outDir] [checks...]   (checks: menu drinks food; default all)
//   --sw   SwiftShader instead of the machine's GPU
// Logs in as fixed names (dine6_e2e_a, dine6_e2e_b) with the dev password.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { barPriceAt } from '../../shared/src/happyhour.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const [port = '6270', out = '/tmp/dine6-shots', ...wanted] = args;
const checks = wanted.length ? wanted : ['menu', 'drinks', 'food', 'poses', 'phone'];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(flag('sw') ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const ok = (what) => console.log(`ok   ${what}`);
const check = (cond, what) => (cond ? ok(what) : fail(what));
const frames = (p, n = 4) => p.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function shot(p, name) {
  await frames(p, 8);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', `${out}/${name}.png`);
}

async function enterAs(name, phone = false) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
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
  // anything the floor opens on arrival (the daily visit's sheet) is closed first
  for (let i = 0; i < 3 && (await p.$('.sheet-scrim')); i++) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }
  // and what's still in hand from an earlier run is put down
  await p.evaluate(() => window.casino.world.dropHeld());
  await p.waitForFunction(() => !window.casino.session.profile?.look.held, null, { timeout: 10000 });
  return { p, ctx, errors };
}

/** Order through the menu; `walk` waits for a waiter to bring it, otherwise it's handed straight over. */
async function order(p, name, walk = false) {
  // (an order still in hand from an earlier run doesn't count)
  const prev = await p.evaluate(() => window.casino.session.profile?.look.held?.order ?? null);
  await p.evaluate(() => window.casino.app.openBarMenu());
  await p.waitForSelector('.dine-sheet .bar-item');
  await p.click(`.bar-order[aria-label^="Order ${name},"]`);
  await p.waitForFunction(() => document.querySelector('.bar-status')?.textContent?.includes('On its way'), null, { timeout: 12000 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  if (!walk) {
    await p.evaluate(() => {
      const bar = window.casino.app.bar;
      const o = bar.pending.at(-1);
      if (o) window.casino.world.holdItem(o.id);
    });
  }
  await p.waitForFunction(([n, old]) => {
    const h = window.casino.session.profile?.look.held;
    return h && h.order !== old && window.casino.app.diner.current?.order === h.order && document.querySelector('.dine-card-name')?.textContent === n;
  }, [name, prev], { timeout: walk ? 150000 : 15000 });
  return p.evaluate(() => window.casino.session.profile.look.held);
}

/** Let the drinking clock run again after pose() pinned it. */
const pin = (p) => p.evaluate(() => window.__dine.setClock(null));

/** Pose `order` on this screen at act `i`, `phase` of the way through (i = 'done' + ms: after the last). */
async function pose(p, orderId, i, phase) {
  return p.evaluate(([id, k, ph]) => {
    const h = [...window.__dine.heldOrders()].find((x) => x.order === id);
    if (!h) return false;
    const tl = h.timeline();
    const len = k === 0 && tl.opener ? tl.openerMs : tl.ms;
    const t = typeof k === 'string' ? tl.acts.at(-1) + tl.ms + Number(k.slice(4)) : tl.acts[k] + ph * len;
    window.__dine.setClock(() => t);
    return true;
  }, [orderId, i, phase]);
}

/** A camera the script holds, looking at `at` from `pos` (world). */
async function hold(p) {
  await p.evaluate(() => {
    const c = window.casino;
    c.shot = null;
    c.engine.onFrame(() => {
      const s = c.shot;
      if (!s) return;
      c.engine.camera.position.set(...s.pos);
      c.engine.camera.lookAt(...s.at);
    });
  });
}
const aim = (p, pos, at) => p.evaluate(([a, b]) => (window.casino.shot = { pos: a, at: b }), [pos, at]);
const free = (p) => p.evaluate(() => (window.casino.shot = null));

// A stands at (0, 11) facing +z; B a metre on, facing A.
const A_AT = [0, 11, 0];
const B_AT = [0, 12.15, Math.PI];

// --- the menu -------------------------------------------------------------------------------------

if (checks.includes('menu')) {
  const a = await enterAs('dine6_e2e_a');
  await a.p.evaluate(() => window.casino.app.openBarMenu());
  await a.p.waitForSelector('.dine-sheet .bar-item');
  await a.p.waitForTimeout(600);
  await shot(a.p, 'menu');
  const rows = await a.p.$$eval('.dine-item', (els) => els.map((e) => e.dataset.id));
  check(rows.length === 17, `the menu lists every item (${rows.length})`);
  check((await a.p.$$('.dine-glyph')).length >= 17, 'each item has its drawing');
  const sw = await a.p.getAttribute('.dine-switch', 'aria-pressed');
  await a.p.click('.dine-switch');
  const sw2 = await a.p.getAttribute('.dine-switch', 'aria-pressed');
  await a.p.click('.dine-switch');
  check(sw === 'true' && sw2 === 'false', 'the sway switch starts on and turns off');
  await a.p.keyboard.press('Escape');
  await a.ctx.close();
  if (a.errors.length) fail(`menu errors: ${a.errors.slice(0, 4).join(' | ')}`);
}

// --- drinks: a waiter's walk, sips, the remote view, pace, a toast, a Dom ---------------------------

if (checks.includes('drinks')) {
  const a = await enterAs('dine6_e2e_a');
  const b = await enterAs('dine6_e2e_b');
  const tp = (r, [x, z, yaw]) => r.p.evaluate(([x2, z2, y2]) => window.casino.world.player.teleport(x2, z2, y2), [x, z, yaw]);
  await tp(a, A_AT);
  await tp(b, B_AT);

  // champagne, walked over by a waiter
  const bal0 = await a.p.evaluate(() => window.casino.session.profile.balance);
  const asked = Date.now();
  const champ = await order(a.p, 'Champagne', true);
  const bal1 = await a.p.evaluate(() => window.casino.session.profile.balance);
  // happy hour halves it; either price if a window's edge fell while ordering
  const prices = new Set([barPriceAt(3200, asked), barPriceAt(3200, Date.now())]);
  check(prices.has(bal0 - bal1), `champagne costs what the bar asks (${(bal0 - bal1) / 100}, expected ${[...prices].map((c) => c / 100).join(' or ')})`);
  await tp(a, A_AT);
  await a.p.waitForTimeout(800);
  await shot(a.p, 'a-holding');

  // Q: a sip of your own, the glass goes down
  const before = await a.p.evaluate(() => window.casino.app.diner.current.state.level);
  await a.p.evaluate(() => window.casino.world.releaseMouse());
  await a.p.keyboard.press('KeyQ');
  await a.p.waitForTimeout(1300);
  const mid = await a.p.evaluate(() => window.casino.app.diner.current.state);
  check(mid.act?.kind === 'sip', `Q takes a sip (${mid.act?.kind})`);
  await shot(a.p, 'a-sipping-own-view');
  await a.p.waitForTimeout(2000);
  const after = await a.p.evaluate(() => window.casino.app.diner.current.state.level);
  check(after < before, `the glass goes down (${before} -> ${after.toFixed(3)})`);
  const chips = await a.p.$$eval('.dine-chip', (els) => els.map((e) => e.textContent));
  check(chips.some((c) => c.startsWith('Bubbly')), `champagne makes you bubbly (${chips.join(', ')})`);
  await shot(a.p, 'a-hud-bubbly');

  // B sees A drink: the same sip on B's screen, front and side
  await b.p.waitForFunction((id) => [...window.__dine.heldOrders()].some((h) => h.order === id), champ.order, { timeout: 15000 });
  await hold(b.p);
  // B's own character would stand in the way of the camera
  await b.p.evaluate(() => {
    window.casino.world.player.setEnabled(false);
    window.casino.world.player.character.root.visible = false;
  });
  for (const [name, phase] of [['lift', 0.18], ['sip', 0.5]]) {
    await pose(b.p, champ.order, 1, phase);
    await aim(b.p, [0.05, 1.55, 12.35], [0, 1.4, 11]);
    await b.p.waitForTimeout(500);
    await shot(b.p, `remote-${name}-front`);
    await aim(b.p, [1.35, 1.5, 11.2], [0, 1.4, 11]);
    await b.p.waitForTimeout(300);
    await shot(b.p, `remote-${name}-side`);
  }
  const bLevel = await b.p.evaluate((id) => [...window.__dine.heldOrders()].find((h) => h.order === id).state.level, champ.order);
  check(bLevel < 1, `B sees the champagne going down (${bLevel.toFixed(3)})`);
  await pin(b.p);
  await free(b.p);
  await b.p.evaluate(() => {
    window.casino.world.player.setEnabled(true);
    window.casino.world.player.character.root.visible = true;
  });

  // a toast: B gets a drink too, both stand face to face
  const beer = await order(b.p, 'Beer');
  await tp(a, A_AT);
  await tp(b, B_AT);
  const toasted = await Promise.all(
    [a, b].map((r) =>
      r.p
        .waitForFunction(() => [...window.__dine.heldOrders()].filter((h) => window.__dine.extraAt(h.order, window.__dine.now())?.e.kind === 'toast' || (window.__dine.extras(h.order) ?? []).some((e) => e.kind === 'toast')).length >= 2, null, { timeout: 20000 })
        .then(() => true)
        .catch(() => false),
    ),
  );
  check(toasted[0] && toasted[1], `both screens toast (${toasted})`);
  const t0s = await Promise.all([a, b].map((r) => r.p.evaluate((id) => window.__dine.extras(id).find((e) => e.kind === 'toast')?.t0, champ.order)));
  const bt0s = await Promise.all([a, b].map((r) => r.p.evaluate((id) => window.__dine.extras(id).find((e) => e.kind === 'toast')?.t0, beer.order)));
  check(bt0s[0] === t0s[0] && bt0s[1] === t0s[1], `both glasses toast together (${bt0s})`);
  check(t0s[0] && t0s[0] === t0s[1], `the toast is at the same moment on both (${t0s})`);
  // the clink, from the side, on B's screen
  await hold(b.p);
  await b.p.evaluate(() => window.casino.world.player.setEnabled(false));
  await b.p.evaluate((t) => window.__dine.setClock(() => t + 0.45 * 2400), t0s[1]);
  await aim(b.p, [1.6, 1.55, 11.6], [0, 1.35, 11.6]);
  await b.p.waitForTimeout(250);
  await shot(b.p, 'toast-clink');
  await pin(b.p);
  await free(b.p);
  await b.p.evaluate(() => window.casino.world.player.setEnabled(true));
  void beer;

  // an espresso: quicker on your feet
  await order(a.p, 'Espresso');
  const cup = await a.p.evaluate(() => window.casino.session.profile.look.held);
  await a.p.evaluate(() => window.casino.world.releaseMouse());
  await a.p.waitForTimeout(400);
  await a.p.keyboard.press('KeyQ');
  await a.p.waitForTimeout(3200);
  const pace = await a.p.evaluate(() => window.casino.app.diner.effects.paceNow(Date.now()));
  check(pace > 1.1 && pace <= 1.3, `an espresso quickens your pace (${pace})`);
  const speed = async () => {
    await tp(a, [0, 4, Math.PI]);
    await a.p.keyboard.down('ShiftLeft');
    await a.p.keyboard.down('KeyW');
    await a.p.waitForTimeout(1200);
    const s = await a.p.evaluate(() => {
      const w = window.casino.world;
      const x0 = w.player.position.clone();
      return new Promise((res) => setTimeout(() => res(w.player.position.distanceTo(x0) / 0.5), 500));
    });
    await a.p.keyboard.up('KeyW');
    await a.p.keyboard.up('ShiftLeft');
    return s;
  };
  const fast = await speed();
  await tp(a, A_AT);
  check(fast > 5.2 && fast < 9, `running with an espresso: ${fast.toFixed(2)} m/s (a run is 4.8, the server allows 9)`);
  // the steam, close up
  await hold(a.p);
  await a.p.evaluate(() => window.casino.world.player.setEnabled(false));
  await tp(a, A_AT);
  await pose(a.p, cup.order, 1, 0.05);
  await aim(a.p, [0.25, 1.45, 11.75], [-0.1, 1.2, 11.1]);
  await a.p.waitForTimeout(1500);
  await shot(a.p, 'espresso-steam');
  await pin(a.p);
  await free(a.p);
  await a.p.evaluate(() => window.casino.world.player.setEnabled(true));

  // a Dom: popped and sprayed
  const dom = await order(a.p, 'Bottle of Dom');
  await tp(a, A_AT);
  await hold(a.p);
  await a.p.evaluate(() => window.casino.world.player.setEnabled(false));
  for (const [name, phase] of [['shake', 0.25], ['spray', 0.62]]) {
    await pose(a.p, dom.order, 0, phase - 0.12);
    await a.p.waitForTimeout(250);
    await pose(a.p, dom.order, 0, phase);
    await aim(a.p, [1.7, 1.6, 12.7], [0, 1.6, 11.2]);
    await a.p.waitForTimeout(450);
    await shot(a.p, `dom-${name}`);
  }
  await pin(a.p);
  await free(a.p);
  await a.p.evaluate(() => window.casino.world.player.setEnabled(true));

  // a few drinks in: the view sways and warms at the edges, the body leans; the switch turns the view's part off
  await a.p.evaluate(() => {
    const fx = window.casino.app.diner.effects;
    for (let i = 0; i < 16; i++) fx.portion('whiskey', Date.now(), false);
  });
  await tp(a, A_AT);
  await a.p.waitForTimeout(1500);
  const warm = await a.p.evaluate(() => Number(getComputedStyle(document.querySelector('.dine-vignette')).opacity));
  check(warm > 0.3, `tipsy warms the view's edges (${warm})`);
  const roll1 = await a.p.evaluate(() => window.casino.engine.camera.rotation.z);
  await a.p.waitForTimeout(900);
  const roll2 = await a.p.evaluate(() => window.casino.engine.camera.rotation.z);
  check(Math.abs(roll1 - roll2) > 1e-4, `and sways it (${roll1.toFixed(4)} -> ${roll2.toFixed(4)})`);
  await shot(a.p, 'tipsy-view');
  await a.p.evaluate(() => window.casino.app.openBarMenu());
  await a.p.waitForSelector('.dine-switch');
  if ((await a.p.getAttribute('.dine-switch', 'aria-pressed')) === 'true') await a.p.click('.dine-switch');
  await a.p.keyboard.press('Escape');
  await a.p.waitForTimeout(1200);
  const cool = await a.p.evaluate(() => Number(getComputedStyle(document.querySelector('.dine-vignette')).opacity));
  check(cool < 0.05, `the switch takes the sway off the view (${cool})`);
  await a.p.evaluate(() => window.casino.app.openBarMenu());
  await a.p.waitForSelector('.dine-switch');
  await a.p.click('.dine-switch');
  await a.p.keyboard.press('Escape');

  for (const [who, r] of [['a', a], ['b', b]]) if (r.errors.length) fail(`${who} errors: ${r.errors.slice(0, 5).join(' | ')}`);
  await a.ctx.close();
  await b.ctx.close();
}

// --- food: a bite, a cake's candles, a full stomach, the empty taken away -------------------------

if (checks.includes('food')) {
  const a = await enterAs('dine6_e2e_a');
  const tp = (xz) => a.p.evaluate(([x2, z2, y2]) => window.casino.world.player.teleport(x2, z2, y2), xz);
  await tp(A_AT);
  const cake = await order(a.p, 'Birthday Cake');
  await tp(A_AT);
  await hold(a.p);
  await a.p.evaluate(() => window.casino.world.player.setEnabled(false));
  await pose(a.p, cake.order, 0, 0.2);
  await aim(a.p, [0.35, 1.5, 11.75], [-0.05, 1.25, 11.1]);
  await a.p.waitForTimeout(700);
  await shot(a.p, 'cake-lit');
  await pose(a.p, cake.order, 0, 0.36);
  await a.p.waitForTimeout(200);
  await pose(a.p, cake.order, 0, 0.5);
  await aim(a.p, [0.9, 1.7, 12.9], [0, 1.4, 11]);
  await a.p.waitForTimeout(600);
  await shot(a.p, 'cake-blown');
  for (const [name, phase] of [['reach', 0.2], ['bite', 0.5]]) {
    await pose(a.p, cake.order, 1, phase);
    await aim(a.p, [0.1, 1.55, 12.3], [0, 1.4, 11]);
    await a.p.waitForTimeout(500);
    await shot(a.p, `cake-${name}-front`);
    await aim(a.p, [-1.3, 1.5, 11.25], [0, 1.4, 11]);
    await a.p.waitForTimeout(300);
    await shot(a.p, `cake-${name}-side`);
  }
  await pin(a.p);
  await free(a.p);
  await a.p.evaluate(() => window.casino.world.player.setEnabled(true));

  // sliders, eaten to the last, then a pat on the belly and a waiter takes the plate
  const sliders = await order(a.p, 'Sliders');
  await tp(A_AT);
  await pose(a.p, sliders.order, 'done200', 0);
  await a.p.waitForFunction(() => window.casino.app.diner.current?.state?.done === true, null, { timeout: 5000 });
  const fed = await a.p.evaluate(() => window.casino.app.diner.effects.isFed(Date.now()));
  check(fed, 'sliders leave you well fed');
  await hold(a.p);
  await a.p.evaluate(() => window.casino.world.player.setEnabled(false));
  await pose(a.p, sliders.order, 'done1500', 0);
  await aim(a.p, [0.4, 1.4, 12.6], [0, 1.1, 11]);
  await a.p.waitForTimeout(600);
  await shot(a.p, 'sliders-pat');
  await free(a.p);
  await a.p.evaluate(() => window.casino.world.player.setEnabled(true));
  await pose(a.p, sliders.order, 'done5000', 0);
  const cleared = await a.p
    .waitForFunction(() => !window.casino.session.profile?.look.held, null, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  check(cleared, 'the empty plate is taken away');
  await pin(a.p);
  await shot(a.p, 'after-fed-hud');
  const chips = await a.p.$$eval('.dine-chip', (els) => els.map((e) => e.textContent));
  check(chips.some((c) => c.startsWith('Well fed')), `a well fed chip (${chips.join(', ')})`);
  if (a.errors.length) fail(`food errors: ${a.errors.slice(0, 5).join(' | ')}`);
  await a.ctx.close();
}

// --- through your own eyes, and sitting on a sofa -------------------------------------------------

if (checks.includes('poses')) {
  const a = await enterAs('dine6_e2e_a');
  const wine = await order(a.p, 'Red Wine');
  // first person: the glass comes up into view
  await a.p.evaluate(() => window.casino.world.setMouse({ view: 'first' }));
  await a.p.evaluate(() => window.casino.world.player.teleport(0, 11, 0));
  await a.p.waitForTimeout(1200);
  for (const [name, phase] of [['carry', -1], ['sip', 0.5]]) {
    if (phase < 0) await pose(a.p, wine.order, 0, 0);
    else await pose(a.p, wine.order, 1, phase);
    await a.p.waitForTimeout(700);
    await shot(a.p, `first-person-${name}`);
  }
  await pin(a.p);
  await a.p.evaluate(() => window.casino.world.setMouse({ view: 'third' }));
  // a bench: sit, and the arm still brings the glass up (walked there in hops the floor believes)
  const seat = await a.p.evaluate(() => {
    const s = window.casino.world.life.seating.byId.get('lobby.bench.1.1');
    return s ? { ...s } : null;
  });
  check(!!seat, `a seat to sit on (${seat?.id})`);
  if (seat) {
    const to = [seat.x + Math.sin(seat.yaw) * 0.8, seat.z + Math.cos(seat.yaw) * 0.8];
    const from = await a.p.evaluate(() => ({ x: window.casino.world.player.position.x, z: window.casino.world.player.position.z }));
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from.x, to[1] - from.z) / 7));
    for (let i = 1; i <= n; i++) {
      await a.p.evaluate(([x, z, y]) => window.casino.world.player.teleport(x, z, y), [from.x + ((to[0] - from.x) * i) / n, from.z + ((to[1] - from.z) * i) / n, seat.yaw + Math.PI]);
      await a.p.waitForTimeout(1100);
    }
    await a.p.keyboard.press('KeyE');
    await a.p.waitForFunction(() => window.casino.world.life.seating.seated, null, { timeout: 8000 }).catch(() => {});
    check(await a.p.evaluate(() => !!window.casino.world.life.seating.seated), 'sat down on the sofa, the glass still in hand');
    await a.p.waitForTimeout(1500);
    await hold(a.p);
    const f = [Math.sin(seat.yaw), Math.cos(seat.yaw)];
    const eye = [seat.x + f[0] * 1.6 + f[1] * 0.6, 1.3, seat.z + f[1] * 1.6 - f[0] * 0.6];
    for (const [name, phase] of [['carry', -1], ['sip', 0.5]]) {
      if (phase < 0) await pose(a.p, wine.order, 0, 0);
      else await pose(a.p, wine.order, 1, phase);
      await aim(a.p, eye, [seat.x, 0.95, seat.z]);
      await a.p.waitForTimeout(700);
      await shot(a.p, `sofa-${name}`);
    }
    await pin(a.p);
    await free(a.p);
  }
  if (a.errors.length) fail(`poses errors: ${a.errors.slice(0, 5).join(' | ')}`);
  await a.ctx.close();
}

// --- a phone: the card's button takes the sip ---------------------------------------------------

if (checks.includes('phone')) {
  const a = await enterAs('dine6_e2e_a', true);
  await order(a.p, 'Margarita');
  await a.p.waitForTimeout(500);
  await a.p.tap('.dine-act');
  await a.p.waitForTimeout(800);
  const s = await a.p.evaluate(() => window.casino.app.diner.current.state);
  check(s.act?.kind === 'sip', `a tap on the card takes a sip (${s.act?.kind})`);
  await shot(a.p, 'phone-sip');
  if (a.errors.length) fail(`phone errors: ${a.errors.slice(0, 5).join(' | ')}`);
  await a.ctx.close();
}

console.log(failed ? `${failed} failed` : 'ok');
await browser.close();
process.exit(failed ? 1 : 0);
