#!/usr/bin/env node
// The law on the real stack, two players. A walks up to B in front of a guard and punches: B sees
// it land (the hit), the guard walks over and has a word, A is warned. A few seconds on, A punches
// B again in front of a guard: across the street to jail, confined there, bail on the HUD and the
// board. A buys in at the jail's Sic Bo table and bets Big until the winnings make bail, then is
// let out at the casino's doors with the money. Last, the pit boss: B's client is handed the floor's
// messages for a catch at his tables (the catch itself is the worker tests': it needs a lucky
// streak in front of him) and draws him walking over to say so.
//
// Usage: node scripts/e2e/law6.mjs [port] [outDir]    (--sw: SwiftShader instead of the GPU)
// Fixed names law6_e2e_a and law6_e2e_b. A run that finds A still inside (an earlier run stopped
// half way) skips to making bail.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const [port = '6340', out = '/tmp/law6-shots'] = args;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  flag('sw') ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--ignore-gpu-blocklist'] },
);
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const check = (ok, what) => (ok ? console.log(`ok   ${what}`) : fail(what));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function enterAs(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`http://localhost:${port}/casino/?quality=${process.env.QUALITY ?? 'high'}`, { timeout: 180000 });
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
  // anything that greets you on arrival (the daily bonus) is put away unclaimed: it holds the keyboard
  await p.waitForTimeout(1500);
  for (let i = 0; i < 3; i++) {
    const held = await p.evaluate(async () => (await import('/casino/src/ui/keyboard.ts')).overlayCount());
    if (!held) break;
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
  }
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    window.heard = [];
    window.casino.app.link.subscribe((m) => window.heard.push(m));
    const c = window.casino;
    c.shot = null;
    c.engine.onFrame(() => {
      if (!c.shot) return;
      c.engine.camera.position.set(...c.shot.pos);
      c.engine.camera.lookAt(...c.shot.at);
    });
  });
  const id = await p.evaluate(() => window.casino.app.link.you.id);
  return { p, ctx, errors, id, name };
}

const frames = (p, n = 20) => p.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function shot(p, name, cam) {
  await p.evaluate((cam) => (window.casino.shot = cam ?? null), cam ?? null);
  await frames(p, 8);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', `${out}/${name}.png`);
}
/** What a page's floor socket has said, filtered here (the page's CSP rightly allows no eval). */
const heard = async (p, pred) => (await p.evaluate(() => window.heard)).filter(pred);
async function waitHeard(p, pred, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if ((await heard(p, pred)).length) return;
  throw new Error('not heard');
}

/** Walk (a couple of metres at a time, as fast as the floor allows) to (x, z), then face `yaw`. */
async function walkTo(pl, x, z, yaw) {
  for (let i = 0; i < 80; i++) {
    const done = await pl.p.evaluate(([x, z, yaw]) => {
      const w = window.casino.world;
      const q = w.player.position;
      const d = Math.hypot(x - q.x, z - q.z);
      const k = Math.min(1, 1.8 / Math.max(d, 1e-6));
      w.player.teleport(q.x + (x - q.x) * k, q.z + (z - q.z) * k, yaw);
      return d <= 1.8;
    }, [x, z, yaw]);
    await sleep(240);
    if (done) break;
  }
  await sleep(600);
}

/**
 * The next moment (at least `lead` ms away) a guard will stand still at one of his stops for a
 * good while, and the spots in front of him for the puncher and the one punched.
 */
async function guardSpot(pl, lead) {
  return pl.p.evaluate((lead) => {
    const staff = window.casino.app.law.staff;
    const now = Date.now();
    for (let t = now + lead; t < now + 240000; t += 250) {
      for (const id of ['g1', 'g2', 'g3', 'g4']) {
        const a = staff.poseOf(id, t);
        if (a.moving || a.busy) continue;
        let still = true;
        for (let u = t; still && u < t + 4500; u += 500) {
          const b = staff.poseOf(id, u);
          still = !b.moving && Math.abs(b.x - a.x) < 0.01 && Math.abs(b.z - a.z) < 0.01;
        }
        if (!still) continue;
        // his stop's heading, without the look to either side
        const face = staff.poseOf(id, t + 1).yaw;
        const f = [Math.sin(face), Math.cos(face)];
        // both on open floor (not in a display case or a table), where the walker can stand
        const nav = window.casino.world.life.grid;
        for (const ahead of [2.2, 3.0, 3.8, 1.8]) {
          const me = [a.x + f[0] * ahead, a.z + f[1] * ahead];
          const them = [me[0] + f[0] * 0.8, me[1] + f[1] * 0.8];
          if (nav.isClear(me[0], me[1]) && nav.isClear(them[0], them[1])) return { id, t, face, me, them, guard: [a.x, a.z] };
        }
      }
    }
    return null;
  }, lead);
}

/** Both walk to the spots in front of a guard; A faces B. Returns when the guard is standing there. */
async function lineUp(A, B, lead) {
  const g = await guardSpot(A, lead);
  if (!g) throw new Error('no guard stands still in the next few minutes');
  console.log(`     ${g.id} at (${g.guard.map((v) => v.toFixed(1))}), in ${((g.t - Date.now()) / 1000).toFixed(1)}s`);
  await Promise.all([walkTo(A, g.me[0], g.me[1], g.face), walkTo(B, g.them[0], g.them[1], g.face + Math.PI)]);
  const wait = g.t + 800 - Date.now();
  if (wait > 0) await sleep(wait);
  return g;
}

const A = await enterAs('law6_e2e_a');
const B = await enterAs('law6_e2e_b');
console.log(`A ${A.id}, B ${B.id}`);

const alreadyIn = await A.p.evaluate(() => window.casino.app.law.jailed);
if (!alreadyIn) {
  // --- the first punch: a warning --------------------------------------------------------------
  const g1 = await lineUp(A, B, 12000);
  await A.p.keyboard.press('v');
  await waitHeard(B.p, (m) => m.t === 'punch' && m.hit !== null).then(
    () => check(true, "B sees A's punch land on B"),
    () => fail("B sees A's punch land on B"),
  );
  const punch = (await heard(B.p, (m) => m.t === 'punch'))[0];
  check(punch?.id === A.id && punch?.hit === B.id, 'the punch is from A and lands on B');
  await sleep(250);
  // B's view of A mid-punch and B taking it
  await shot(B.p, 'punch-seen-by-b', { pos: [g1.them[0] + Math.cos(g1.face) * 2.2, 1.7, g1.them[1] - Math.sin(g1.face) * 2.2], at: [(g1.me[0] + g1.them[0]) / 2, 1.3, (g1.me[1] + g1.them[1]) / 2] });
  await waitHeard(A.p, (m) => m.t === 'law' && m.ev.k === 'warn').then(
    () => check(true, 'a guard saw it: A is warned'),
    () => fail('a guard saw it: A is warned'),
  );
  const warn = (await heard(A.p, (m) => m.t === 'law' && m.ev.k === 'warn'))[0];
  check(warn?.ev.why === 'punch' && warn?.ev.staff?.startsWith('g'), `the warning is for the punch, from a guard (${warn?.ev.staff})`);
  check((await heard(A.p, (m) => m.t === 'detour' && m.d.who === A.id)).length === 1, 'the guard walks over to A');
  await sleep(2500);
  await A.p.evaluate(() => (window.casino.shot = null));
  await shot(A.p, 'warned-a');
  check(await A.p.evaluate(() => !document.querySelector('.law-hud')?.hidden && /warning/i.test(document.querySelector('.law-hud')?.textContent ?? '')), "A's HUD says A is on warning");
  await shot(B.p, 'guard-has-a-word', { pos: [g1.them[0] + Math.cos(g1.face) * 3, 2.0, g1.them[1] - Math.sin(g1.face) * 3], at: [g1.me[0], 1.5, g1.me[1]] });

  // --- the second catch, within the window, while A plays a slot machine: jail ------------------
  // (the pit boss's catch on the dev stack's trigger: a real one needs a lucky streak in his sight)
  await sleep(16000);
  const machine = await A.p.evaluate(() => {
    const s = window.casino.world.stations.find((x) => x.id === 'slots-sevens-1');
    const a = s.anchor.position;
    return { x: a.x + Math.sin(s.yaw) * 1.0, z: a.z + Math.cos(s.yaw) * 1.0, yaw: s.yaw + Math.PI };
  });
  await walkTo(A, machine.x, machine.z, machine.yaw);
  await A.p.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((x) => x.id === 'slots-sevens-1'));
  });
  await A.p.waitForFunction(() => window.casino.app.table?.session, null, { timeout: 15000 });
  await sleep(2000);
  await A.p.evaluate(() => window.casino.app.table.session.link.buyIn(50000));
  await A.p.waitForFunction(() => window.casino.app.table?.seated, null, { timeout: 15000 }).catch(() => fail('A sat down and bought in at a slot machine'));
  const beforeCatch = await A.p.evaluate(async () => {
    const t = sessionStorage.getItem('casino.token');
    return (await (await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } })).json()).profile;
  });
  check(beforeCatch.inPlay === 50000, `A has $${beforeCatch.inPlay / 100} on the machine`);
  const caught = await A.p.evaluate(async () => {
    const t = sessionStorage.getItem('casino.token');
    return (await (await fetch('/casino/api/dev/law/catch', { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).json()).result;
  });
  check(caught === 'jailed', `caught again inside five minutes, at the machine: ${caught}`);
  await waitHeard(A.p, (m) => m.t === 'jail' && m.jail).then(
    () => check(true, 'A goes to jail'),
    () => fail('A goes to jail'),
  );
  // stood up from the machine before the move: off the table, the camera back on the floor
  await A.p.waitForFunction(() => window.casino.app.table === null && window.casino.world.seated === null, null, { timeout: 6000 }).then(
    () => check(true, 'A is stood up from the machine first'),
    () => fail('A is stood up from the machine first'),
  );
  check(!(await heard(A.p, (m) => m.t === 'tp')).length, 'and only then moved (no tp yet)');
  await waitHeard(B.p, (m) => m.t === 'law' && m.ev.k === 'jail' && m.ev.id === A.id).then(
    () => check(true, 'B hears A was taken away'),
    () => fail('B hears A was taken away'),
  );
  await waitHeard(A.p, (m) => m.t === 'tp', 15000).catch(() => fail('A is moved across the street'));
  await sleep(2500);
  const afterCatch = await A.p.evaluate(async () => {
    const t = sessionStorage.getItem('casino.token');
    return (await (await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } })).json()).profile;
  });
  check(afterCatch.inPlay === 0 && afterCatch.balance === beforeCatch.balance + 50000, `the machine cashed out: nothing in play, balance $${afterCatch.balance / 100}`);
  await shot(A.p, 'jailed-after-machine');
}

// --- inside --------------------------------------------------------------------------------------
const inside = await A.p.evaluate(() => {
  const p = window.casino.world.player.position;
  return { x: p.x, z: p.z, jail: window.casino.app.law.jailed };
});
check(inside.x > 172 && inside.x < 195 && inside.z > -41 && inside.z < -9, `A is inside the jail (${inside.x.toFixed(1)}, ${inside.z.toFixed(1)})`);
check(!!inside.jail && inside.jail.bail >= 100000, `A's bail is set (${inside.jail?.bail / 100})`);
await shot(A.p, 'jailed-a');
await shot(A.p, 'jail-yard-sky', { pos: [177, 2.2, -31.4], at: [186, 4.2, -40] });
check(await A.p.evaluate(() => window.casino.world.zone === 'ground'), 'the world is in the ground zone (the city\'s sky over the yard)');
await A.p.evaluate(() => (window.casino.shot = null));
// trying to walk out: the walls hold, and the floor keeps A inside
await A.p.evaluate(() => window.casino.world.player.teleport(160, -25, -Math.PI / 2));
await sleep(1500);
const heldAt = await B.p.evaluate((id) => {
  const p = window.casino.app.link.players.get(id);
  return p?.last ? { x: p.last.x, z: p.last.z } : null;
}, A.id);
check(!heldAt || (heldAt.x >= 17240 && heldAt.x <= 19460), `the floor keeps A inside (B sees A at ${heldAt ? heldAt.x + ',' + heldAt.z : 'nowhere yet'})`);
await walkTo(A, 188.4, -21.1, Math.PI);
await shot(A.p, 'jail-board-a', { pos: [186.6, 1.75, -21.4], at: [189.2, 2.1, -30] });

// the jail's Sic Bo: buy in, bet Big until the bail is made
await A.p.evaluate(() => {
  const w = window.casino.world;
  w.enter(w.stations.find((s) => s.id === 'jail-sb'));
});
await A.p.waitForFunction(() => window.casino.app.table?.session, null, { timeout: 15000 });
await sleep(2500);
await A.p.evaluate(() => window.casino.app.table.session.link.buyIn(1000000));
await A.p.waitForFunction(() => window.casino.app.table?.seated, null, { timeout: 15000 }).catch(() => fail('bought in at the jail table'));
const limits = await A.p.evaluate(() => window.casino.app.table.session.snapshot?.meta?.config?.limits?.even ?? null).catch(() => null);
console.log(`     jail Sic Bo limits ${JSON.stringify(limits)}`);
let rounds = 0;
let released = false;
const bail = inside.jail?.bail ?? 100000;
const bet = Math.max(500, Math.floor(bail / 4 / 500) * 500);
for (; rounds < 200 && !released; rounds++) {
  await A.p.evaluate((amount) => {
    const l = window.casino.app.table?.session?.link;
    l?.act({ type: 'bet', bets: [{ spot: 'big', amount }] });
    l?.act({ type: 'roll' });
  }, bet);
  await sleep(1600);
  released = await A.p.evaluate(() => window.heard.some((m) => m.t === 'jail' && m.jail === null));
  if (rounds === 3) await shot(A.p, 'jail-sicbo-a');
}
const progress = await heard(A.p, (m) => m.t === 'jail' && m.jail);
check(progress.length > 1, `the HUD followed the winnings (${progress.length} updates over ${rounds} rolls)`);
check(progress.every((m) => m.jail.won >= 0), 'progress never went below zero');
check(released, `bail made after ${rounds} rolls: A is let out`);
await waitHeard(A.p, (m) => m.t === 'law' && m.ev.k === 'free').then(
  () => check(true, 'everyone hears A walked out'),
  () => fail('everyone hears A walked out'),
);
await sleep(5000);
const outside = await A.p.evaluate(() => {
  const p = window.casino.world.player.position;
  return { x: p.x, z: p.z, table: window.casino.app.table !== null, jail: window.casino.app.law.jailed };
});
check(Math.abs(outside.x) < 31 && outside.z < 15.2 && outside.z > -31, `A is back in the casino (${outside.x.toFixed(1)}, ${outside.z.toFixed(1)})`);
check(!outside.table && !outside.jail, 'A is off the jail table and out of jail');
await shot(A.p, 'released-a');
const inPlay = await A.p.evaluate(async () => {
  const t = sessionStorage.getItem('casino.token');
  const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } });
  return (await r.json()).profile.inPlay;
});
check(inPlay === 0, 'the jail table cashed out: nothing left in play');

// --- the pit boss: B's client draws a catch at his tables ------------------------------------------
await walkTo(B, -5.6, -9.2, Math.PI);
const bossCatch = await B.p.evaluate((id) => {
  const law = window.casino.app.law;
  const link = window.casino.app.link;
  const now = Date.now();
  const from = law.staff.poseOf('boss', now);
  const d = { staff: 'boss', who: id, kind: 'warn', at: now, go: 1500, back: 3000, until: now + 1500 + 4000 + 3000, x: -5.6, z: -10.1, face: 0 };
  link.receive({ t: 'detour', d });
  link.receive({ t: 'law', ev: { k: 'warn', id, name: 'law6_e2e_b', staff: 'boss', why: 'win', until: now + 300000 } });
  return { from };
}, B.id);
console.log(`     the pit boss from (${bossCatch.from.x.toFixed(1)}, ${bossCatch.from.z.toFixed(1)})`);
await sleep(2600);
await shot(B.p, 'pit-boss-word', { pos: [-4.2, 1.8, -7.6], at: [-5.6, 1.5, -10.1] });
check(await B.p.evaluate(() => /pit boss/i.test(document.querySelector('.staff-say')?.textContent ?? '')), 'the pit boss says his piece over his head');
check(await B.p.evaluate(() => /warning/i.test(document.querySelector('.law-hud')?.textContent ?? '')), "B's HUD shows the warning");

const errs = [...A.errors, ...B.errors].filter((e) => !/WebSocket|ERR_CONNECTION|net::/.test(e));
check(errs.length === 0, `no console errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
