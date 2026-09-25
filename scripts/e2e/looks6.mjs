#!/usr/bin/env node
// v6 looks: every new piece up close on both bodies (the showroom), every ride stood on from the
// front and the side, and on the floor against the local worker: two players, one riding each
// ride past the other, seen from the other's screen; the ride's speed; the ride parked while
// sitting; B stepping off and back on.
//
// Usage: node scripts/e2e/looks6.mjs [port] [outDir] [checks...]   (checks: wear ride hats floor touch; default all)
//   --sw          draw with SwiftShader (default: the machine's GPU)
//   --only=a,b    in `wear` and `ride`, only the cases whose name contains one of these
// Fixed names looks6_e2e_a and looks6_e2e_b with the dev password; the rides and pieces are put in
// their names in the local database (a ledger row and an item row of the same amount, so the money
// identity holds) rather than bought.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const only = (argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const [port = '6230', out = '/tmp/casino-looks6', ...wanted] = argv.filter((a) => !a.startsWith('--'));
const checks = wanted.length ? wanted : ['wear', 'ride', 'hats', 'floor', 'touch'];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  flag('sw') ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--ignore-gpu-blocklist'] },
);
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const pass = (what) => console.log(`ok   ${what}`);

async function page(url, viewport = { width: 1280, height: 800 }) {
  const p = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && !m.text().includes('404') && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(url, { timeout: 180000 });
  return { p, errors };
}

const frames = (p, n = 4) => p.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

async function shot(p, name) {
  await frames(p, 6);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', `${out}/${name}.png`);
}

const M = { v: 1, body: 'm', outfit: 'suit', skin: 2, hair: '#2b1d14', top: '#1f2430', bottom: '#1f2430', shoes: '#111111' };
const F = { v: 1, body: 'f', outfit: 'smart', skin: 1, hair: '#3a2415', top: '#1d2233', bottom: '#1d2233', shoes: '#111111' };

// --- every new piece up close, on both bodies ---------------------------------------------------------

const PIECES = [
  ['tennis-chain', 'chain', 'chest', 0],
  ['twentyone-pendant', 'chain', 'chest', 0],
  ['royal-pendant', 'chain', 'chest', 0],
  ['horseshoe-pendant', 'chain', 'chest', 0],
  ['rose-watch', 'watch', 'wrist', null],
  ['round-shades', 'shades', 'face', 0.35],
  ['diamond-shades', 'shades', 'face', 0.35],
  ['high-roller-shades', 'shades', 'face', 0.5],
  ['top-hat', 'hat', 'head', 0.5],
  ['cowboy-hat', 'hat', 'head', 0.5],
  ['gold-crown', 'hat', 'head', 0.5],
  ['leather-jacket', 'clothes', 'full', -0.35],
  ['sequin-suit', 'clothes', 'full', -0.35],
  ['champion-jacket', 'clothes', 'full', 2.8],
  ['billionaire-chain', 'chain', 'chest', 0],
  ['emperor-robe', 'clothes', 'full', -0.35],
  ['imperial-crown', 'hat', 'head', 0.5],
];

const RIDE_IDS = ['skateboard', 'e-scooter', 'hoverboard', 'segway', 'golden-board', 'hover-throne'];

async function showroom() {
  const r = await page(`http://localhost:${port}/casino/src/ui/shop/dev.html?screen=wear`, { width: 900, height: 900 });
  await r.p.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 120000 });
  return r;
}

async function wear(p, look, view, yaw) {
  await p.evaluate(([l, v, y]) => window.dev.wear(l, v, y), [look, view, yaw]);
  await p.waitForTimeout(900);
  await frames(p, 30);
}

if (checks.includes('wear')) {
  const { p, errors } = await showroom();
  for (const [id, kind, view, yaw] of PIECES) {
    for (const [body, base] of [
      ['m', M],
      ['f', F],
    ]) {
      const name = `wear-${id}-${body}`;
      if (only.length && !only.some((o) => name.includes(o))) continue;
      await wear(p, { ...base, [kind]: id }, view, yaw);
      // something of the piece is drawn: a wearables group (or the special clothes' own material)
      const drawn = await p.evaluate(() => {
        const ch = window.dev.room.character;
        let meshes = 0;
        ch.root.traverse((o) => o.name === 'wearables' && o.traverse((m) => m.isMesh && meshes++));
        const clothes = String(ch.mesh?.material?.name ?? '').startsWith('clothes:');
        return meshes > 0 || clothes;
      });
      if (!drawn) fail(`${name}: nothing drawn`);
      await shot(p, name);
    }
  }
  // everything new at once
  await wear(p, { ...M, clothes: 'sequin-suit', chain: 'tennis-chain', watch: 'rose-watch', shades: 'round-shades', hat: 'top-hat' }, 'full', -0.3);
  await shot(p, 'wear-all-new-m');
  await wear(p, { ...F, clothes: 'champion-jacket', chain: 'royal-pendant', shades: 'high-roller-shades', hat: 'gold-crown' }, 'full', -0.3);
  await shot(p, 'wear-all-new-f');
  await wear(p, { ...M, clothes: 'emperor-robe', chain: 'billionaire-chain', hat: 'imperial-crown', ride: 'hover-throne' }, 'full', -0.3);
  await shot(p, 'wear-all-billions');
  if (errors.length) fail(`wear page errors: ${errors.slice(0, 5).join(' | ')}`);
  else pass('every new piece drawn on both bodies');
  await p.close();
}

// --- every ride, stood on, from the front and the side -------------------------------------------------

if (checks.includes('ride')) {
  const { p, errors } = await showroom();
  for (const ride of RIDE_IDS) {
    for (const [body, base] of [
      ['m', M],
      ['f', F],
    ]) {
      for (const [side, yaw] of [
        ['front', 0],
        ['side', -Math.PI / 2],
        ['three', -0.7],
      ]) {
        const name = `ride-${ride}-${body}-${side}`;
        if (only.length && !only.some((o) => name.includes(o))) continue;
        if (body === 'f' && side === 'three') continue;
        await wear(p, { ...base, ride }, 'full', yaw);
        const r = await p.evaluate(() => {
          const ch = window.dev.room.character;
          const feet = ['FootL', 'FootR'].map((n) => ch.model?.getObjectByName(n)?.getWorldPosition(ch.root.position.clone()).y ?? null);
          return { riding: ch.riding, shown: ch.ride?.outer.visible ?? false, root: ch.root.getWorldPosition(ch.root.position.clone()).y, feet, deck: ch.ride?.spec.deck ?? 0 };
        });
        if (r.riding !== ride || !r.shown) fail(`${name}: not stood on (${JSON.stringify(r)})`);
        // the feet are up on the deck, not through it or floating over it
        const lift = Math.min(...r.feet) - r.root;
        // (sitting on a throne the shins hang to the footrest; the foot bones don't say where the shoes are)
        if (ride !== 'hover-throne' && !(lift > r.deck - 0.03 && lift < r.deck + 0.14)) fail(`${name}: feet at ${lift.toFixed(3)} over the floor, deck ${r.deck}`);
        await shot(p, name);
      }
    }
  }
  if (errors.length) fail(`ride page errors: ${errors.slice(0, 5).join(' | ')}`);
  else pass('every ride stood on, both bodies');
  await p.close();
}

// --- hats over tall hair: the hair is tucked in, nothing pokes through ---------------------------

const HATS = ['black-fedora', 'panama-hat', 'top-hat', 'cowboy-hat', 'gold-crown', 'imperial-crown'];

if (checks.includes('hats')) {
  const { p, errors } = await showroom();
  for (const [body, outfit] of [
    ['m', 'punk'],
    ['m', 'suit'],
    ['m', 'hoodie'],
    ['f', 'punk'],
    ['f', 'dress'],
    ['f', 'smart'],
  ]) {
    for (const hat of HATS) {
      const name = `hat-${hat}-${body}-${outfit}`;
      if (only.length && !only.some((o) => name.includes(o))) continue;
      await wear(p, { ...(body === 'f' ? F : M), outfit, hat }, 'head', 0.5);
      const tucked = await p.evaluate(() => String(window.dev.room.character.mesh?.material?.name ?? ''));
      if (!tucked.endsWith(':tuck')) fail(`${name}: the hair isn't tucked (${tucked})`);
      if (outfit === 'punk' || hat === 'cowboy-hat') await shot(p, name);
    }
  }
  if (errors.length) fail(`hat page errors: ${errors.slice(0, 5).join(' | ')}`);
  else pass('every hat tucks the hair in, on every body');
  await p.close();
}

// --- on the floor, against the local worker ----------------------------------------------------------

function sql(command) {
  execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } });
}

/** Put `items` in `name`'s wardrobe: winnings of the price, then the item bought for it (once). */
function own(name, items) {
  const now = Date.now();
  const parts = [];
  for (const [id, dollars] of items) {
    const cents = dollars * 100;
    const acct = `(SELECT id FROM casino_accounts WHERE name = '${name}')`;
    parts.push(
      `INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) SELECT 'e2e-own:' || id || ':${id}', id, 'cashout', ${cents}, 'e2e', ${now} FROM casino_accounts WHERE name = '${name}' AND NOT EXISTS (SELECT 1 FROM casino_items WHERE account_id = ${acct} AND item = '${id}');`,
      `INSERT OR IGNORE INTO casino_items (account_id, item, price, bought_at, op_id) SELECT id, '${id}', ${cents}, ${now}, 'e2e-own:' || id || ':${id}' FROM casino_accounts WHERE name = '${name}';`,
    );
  }
  sql(parts.join(' '));
}

async function enterAs(name, phone = false) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && !m.text().includes('404') && errors.push(m.text()));
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
  // the day's bonus sheet may greet you: close whatever is over the floor
  for (let i = 0; i < 4 && (await p.$('.sheet')); i++) {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }
  return { p, ctx, errors };
}

/** Save a look through the API, as the boutique's Wear does, and take it up. */
const saveLook = (p, change) =>
  p.evaluate(async (c) => {
    const t = sessionStorage.getItem('casino.token');
    const look = { ...window.casino.session.profile.look, ...c };
    for (const k of Object.keys(c)) if (c[k] === null) delete look[k];
    const r = await fetch('/casino/api/me/look', { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ look }) });
    const j = await r.json();
    if (!r.ok) return { error: j };
    window.casino.session.set({ ...window.casino.session.profile, look: j.look });
    return j.look;
  }, change);

/** The other player's character as B draws it: the one that isn't B's own. */
const remoteOf = (p) =>
  p.evaluate(() => {
    const mine = window.casino.world.player.character;
    for (const c of window.casino.world.characterFactory.people()) {
      if (c === mine) continue;
      const at = c.root.getWorldPosition(c.root.position.clone());
      return { riding: c.riding ?? null, shown: c.ride?.outer.visible ?? false, x: at.x, z: at.z, lean: c.ride?.lean ?? 0 };
    }
    return null;
  });

/** Point B's camera at the other player from `off` (metres from them), following as they go. */
const watchFrom = (p, off, look = 0.8) =>
  p.evaluate(
    ([o, h]) => {
      const { engine, world } = window.casino;
      world.player.setEnabled(false);
      world.player.character.root.visible = false;
      window.__watch?.();
      const mine = world.player.character;
      window.__watch = engine.onFrame(() => {
        const them = [...world.characterFactory.people()].find((c) => c !== mine);
        if (!them) return;
        const at = them.root.position;
        engine.camera.position.set(at.x + o[0], o[1], at.z + o[2]);
        engine.camera.lookAt(at.x, h, at.z);
      });
    },
    [off, look],
  );

const hold = async (p, keys, ms) => {
  for (const k of keys) await p.keyboard.down(k);
  await p.waitForTimeout(ms);
  for (const k of keys) await p.keyboard.up(k);
};

if (checks.includes('floor')) {
  const a = await enterAs('looks6_e2e_a');
  const b = await enterAs('looks6_e2e_b');
  own('looks6_e2e_a', [
    ['skateboard', 60000],
    ['e-scooter', 120000],
    ['hoverboard', 250000],
    ['segway', 400000],
    ['golden-board', 25000000],
    ['hover-throne', 2500000000],
    ['top-hat', 90000],
    ['tennis-chain', 1200000],
    ['leather-jacket', 180000],
    ['round-shades', 65000],
  ]);
  await saveLook(a.p, { clothes: 'leather-jacket', chain: 'tennis-chain', hat: 'top-hat', shades: 'round-shades' });
  // B stands out of the way; its camera is fixed on the lobby's middle
  await b.p.evaluate(() => window.casino.world.player.teleport(-6, 14, 0));
  for (const ride of RIDE_IDS) {
    const look = await saveLook(a.p, { ride });
    if (look.error || look.ride !== ride) {
      fail(`${ride}: the look didn't take it (${JSON.stringify(look.error ?? look.ride)})`);
      continue;
    }
    // across the lobby, left to right in front of B's camera, a curve at the end
    await a.p.evaluate(() => window.casino.world.player.teleport(-5.6, 10.4, Math.PI / 2));
    await watchFrom(b.p, [0.4, 1.3, -3.3]);
    await a.p.waitForTimeout(900);
    await a.p.keyboard.down('KeyW');
    await a.p.waitForTimeout(1000);
    const t0 = await a.p.evaluate(() => ({ ...window.casino.world.player.state(), t: performance.now() }));
    await a.p.waitForTimeout(500);
    const t1 = await a.p.evaluate(() => ({ ...window.casino.world.player.state(), t: performance.now() }));
    const speed = Math.hypot(t1.x - t0.x, t1.z - t0.z) / ((t1.t - t0.t) / 1000);
    if (speed < 3) fail(`${ride}: rides at ${speed.toFixed(2)} m/s, no faster than walking`);
    else pass(`${ride}: ${speed.toFixed(2)} m/s`);
    await shot(b.p, `floor-${ride}-side`);
    await a.p.keyboard.down('KeyD');
    await a.p.waitForTimeout(500);
    const seen = await remoteOf(b.p);
    await shot(b.p, `floor-${ride}-turn`);
    await a.p.keyboard.up('KeyD');
    await a.p.keyboard.up('KeyW');
    if (!seen || seen.riding !== ride || !seen.shown) fail(`${ride}: B doesn't see A riding it (${JSON.stringify(seen)})`);
    else pass(`${ride}: B sees A ride it (lean ${seen.lean.toFixed(2)})`);
    await shot(a.p, `floor-${ride}-own`);
    // head on: from the far side, straight at B's camera
    await a.p.evaluate(() => window.casino.world.player.teleport(0, 13.8, Math.PI));
    await watchFrom(b.p, [0.9, 1.2, -3.4]);
    await a.p.waitForTimeout(700);
    await hold(a.p, ['KeyW'], 450);
    await b.p.waitForTimeout(700);
    await shot(b.p, `floor-${ride}-front`);
  }
  // sitting parks the ride; standing up brings it back
  const parked = await a.p.evaluate(() => {
    const ch = window.casino.world.player.character;
    ch.sit(0.62);
    ch.update(0.016);
    const sitting = { riding: ch.riding, shown: ch.ride.outer.visible };
    ch.sit(null);
    ch.update(0.016);
    return { sitting, standing: { riding: ch.riding, shown: ch.ride.outer.visible } };
  });
  if (parked.sitting.riding !== null || parked.sitting.shown || parked.standing.riding !== 'hover-throne' || !parked.standing.shown) fail(`sitting doesn't park the ride: ${JSON.stringify(parked)}`);
  else pass('sitting parks the ride and standing brings it back');
  // B steps off, and back on
  await a.p.mouse.click(640, 400);
  await a.p.keyboard.press('KeyB');
  await a.p.waitForFunction(() => !window.casino.session.profile.look.ride, null, { timeout: 8000 }).catch(() => {});
  const offLook = await a.p.evaluate(() => window.casino.session.profile.look.ride ?? null);
  await a.p.waitForTimeout(600);
  await a.p.keyboard.press('KeyB');
  await a.p.waitForFunction(() => !!window.casino.session.profile.look.ride, null, { timeout: 8000 }).catch(() => {});
  const onLook = await a.p.evaluate(() => window.casino.session.profile.look.ride ?? null);
  if (offLook !== null || onLook !== 'hover-throne') fail(`B: off ${offLook}, back on ${onLook}`);
  else pass('B steps off and back onto the hover throne');
  await b.p.waitForTimeout(1200);
  const seenBack = await remoteOf(b.p);
  if (seenBack?.riding !== 'hover-throne') fail(`B's screen after the toggle: ${JSON.stringify(seenBack)}`);
  // what a ride costs to draw: A's own view standing still, on foot and on each ride (drawn only
  // on this screen, nothing saved)
  await a.p.evaluate(() => window.casino.world.player.teleport(0, 9, Math.PI));
  const calls = await a.p.evaluate(async (ids) => {
    const { world } = window.casino;
    const ch = world.player.character;
    const look = window.casino.session.profile.look;
    const settle = () => new Promise((r) => { let i = 0; const f = () => (++i >= 20 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const out = {};
    for (const id of [null, ...ids]) {
      const l = { ...look };
      if (id) l.ride = id;
      else delete l.ride;
      ch.setLook(l);
      await settle();
      // the least over a few frames: a waiter walking into view isn't the ride's
      let least = Infinity;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        least = Math.min(least, world.stats().calls);
      }
      out[id ?? 'foot'] = least;
    }
    ch.setLook(look);
    return out;
  }, RIDE_IDS);
  const extra = Object.fromEntries(RIDE_IDS.map((id) => [id, calls[id] - calls.foot]));
  console.log(`draw calls on foot ${calls.foot}; a ride adds ${JSON.stringify(extra)}`);
  for (const [id, n] of Object.entries(extra)) if (n > 2) fail(`${id} adds ${n} draw calls`);
  // a floating ride's glow over the edge of the lobby's runner: a soft pool over rug and marble alike
  for (const ride of ['hoverboard', 'hover-throne']) {
    await a.p.evaluate((id) => {
      const { engine, world, session } = window.casino;
      world.player.teleport(-2.2, 12.6, Math.PI);
      world.player.character.setLook({ ...session.profile.look, ride: id });
      world.player.setEnabled(false);
      window.__watch?.();
      window.__watch = engine.onFrame(() => {
        engine.camera.position.set(-3.6, 1.35, 11.1);
        engine.camera.lookAt(-2.2, 0.35, 12.6);
      });
    }, ride);
    await a.p.waitForTimeout(900);
    await shot(a.p, `glow-rug-edge-${ride}`);
  }
  await a.p.evaluate(() => {
    const { world, session } = window.casino;
    world.player.character.setLook(session.profile.look);
    window.__watch?.();
    world.player.setEnabled(true);
  });
  // the boutique's forms in the new pieces, one standing on a hoverboard
  await a.p.evaluate(() => window.casino.world.player.teleport(12.5, 8, Math.PI));
  await a.p.waitForTimeout(800);
  for (const [name, from, at] of [
    ['boutique-hoverboard-form', [14.2, 1.5, 6.2], [15.7, 0.9, 4.3]],
    ['boutique-forms-west', [11.4, 1.6, 9.2], [8.2, 1.1, 10.6]],
    ['boutique-sequin-form', [12.9, 1.55, 11.7], [12.9, 1.1, 14.05]],
  ]) {
    await a.p.evaluate(
      ([f, t]) => {
        const { engine, world } = window.casino;
        world.player.setEnabled(false);
        window.__watch?.();
        window.__watch = engine.onFrame(() => {
          engine.camera.position.set(f[0], f[1], f[2]);
          engine.camera.lookAt(t[0], t[1], t[2]);
        });
      },
      [from, at],
    );
    await a.p.waitForTimeout(900);
    await shot(a.p, name);
  }
  await a.p.evaluate(() => {
    window.__watch?.();
    window.casino.world.player.setEnabled(true);
  });
  // leave A on foot for the next run's first look
  await saveLook(a.p, { ride: null });
  for (const [who, r] of [
    ['a', a],
    ['b', b],
  ])
    if (r.errors.length) fail(`floor ${who} errors: ${r.errors.slice(0, 5).join(' | ')}`);
  await a.ctx.close();
  await b.ctx.close();
}

// --- a phone: the ride button beside the action button ---------------------------------------------

if (checks.includes('touch')) {
  const t = await enterAs('looks6_e2e_a', true);
  own('looks6_e2e_a', [['skateboard', 60000]]);
  await saveLook(t.p, { ride: 'skateboard' });
  // the login's clicks came from a mouse, which turns the touch controls off; a touch turns them on
  await t.p.touchscreen.tap(206, 520);
  const btn = '.touch-ride:not([hidden])';
  await t.p.waitForSelector(btn, { timeout: 15000 }).catch(() => {});
  if (!(await t.p.$(btn))) fail('touch: no ride button while riding');
  else {
    await shot(t.p, 'touch-riding');
    await t.p.tap('.touch-ride');
    await t.p.waitForFunction(() => !window.casino.session.profile.look.ride, null, { timeout: 8000 }).catch(() => {});
    const off = await t.p.evaluate(() => window.casino.session.profile.look.ride ?? null);
    await t.p.waitForTimeout(600);
    await shot(t.p, 'touch-off');
    await t.p.tap('.touch-ride');
    await t.p.waitForFunction(() => !!window.casino.session.profile.look.ride, null, { timeout: 8000 }).catch(() => {});
    const on = await t.p.evaluate(() => window.casino.session.profile.look.ride ?? null);
    if (off !== null || on !== 'skateboard') fail(`touch: the button stepped off to ${off}, back on to ${on}`);
    else pass('touch: the ride button steps off and back on');
  }
  await saveLook(t.p, { ride: null });
  if (t.errors.length) fail(`touch errors: ${t.errors.slice(0, 5).join(' | ')}`);
  await t.ctx.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
