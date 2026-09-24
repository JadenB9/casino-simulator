#!/usr/bin/env node
// The floor as a player meets it, the checks from the v5 QA pass (world and social):
//   prompts   (dev floor) every station's own "Press E" from its players' side (a video poker
//             machine in the bar's counter, a computer over its desk chair), and "Sit" at every
//             floor seat but the desk chairs (their computer's prompt comes first)
//   seatcam   (dev floor) sitting on a bench against a wall, the banquette under its palm and an
//             armchair backed by a lamp: the camera settles a proper distance off, not in the hair
//   bubble    (dev floor) a staff line with the camera right in front of the speaker stays on screen
//   deskfly   (dev floor) flying in to every computer and back out, the camera keeps clear of the
//             gaming chair's back and headrest (a straight line went through it for a frame)
//   panels    walking with W held, the map, the emotes and the keyboard sheet stop the walker, and W
//             or E typed into an open panel neither walks nor sits you down
//   onboard   a new name's "Pick your look" shows the character in the dressing room (the floor's
//             first hello used to pull the camera back onto the lobby)
//   race      two players go for the same stool: one sits, the other hears who got there first and
//             steps back to where they came from
//   away      sitting on a bench, away and back: still sitting; a drink paid for just before going
//             away is still brought after Come back
// Usage: node scripts/e2e/qa-world.mjs [port] [outDir] [checks...]   (default: all)
//   dev floor checks need Vite only; the others the local worker too (PORT_BASE=<port> npm run dev).
//   GPU=1 draws on the machine's GPU. Fixed names (qaw_e2e_*) with the dev password.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port = '6090', out = '/tmp/qa-world', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const all = ['prompts', 'seatcam', 'bubble', 'deskfly', 'panels', 'onboard', 'race', 'away'];
const checks = wanted.length ? wanted : all;
const browser = await chromium.launch(process.env.GPU === '1' ? { channel: 'chromium', args: ['--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const ok = (cond, what) => (cond ? console.log(`ok   ${what}`) : fail(what));
const sql = (q) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', q, '-c', 'server/wrangler.toml'], { stdio: 'pipe' });
const watch = (p, errors) => {
  p.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
};
const shot = (p, name) => p.screenshot({ path: `${out}/qa-world-${name}.png` });
const overlays = (p) => p.evaluate(async () => (await import('/casino/src/ui/keyboard.ts')).overlayCount());
const at = (p) => p.evaluate(() => ({ x: window.casino.world.player.position.x, z: window.casino.world.player.position.z }));
const seatNamed = (p, id) =>
  p.evaluate(async (sid) => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    return lifePoints(window.casino.world.plan).seats.find((s) => s.id === sid);
  }, id);
/** Sit on a floor seat the way E does, from a step in front of it. */
const sitOn = (p, s) =>
  p.evaluate((seat) => {
    const w = window.casino.world;
    const spot = w.life.seating.spots(w.player.position).find((x) => x.key === `sit:${seat.id}`);
    spot?.use();
    return !!spot;
  }, s);

async function devFloor() {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  watch(p, errors);
  await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=low`, { timeout: 180_000 });
  await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300_000 });
  return { p, errors };
}

// --- the dev floor ----------------------------------------------------------------------------------

if (checks.some((c) => ['prompts', 'seatcam', 'bubble', 'deskfly'].includes(c))) {
  const { p, errors } = await devFloor();

  if (checks.includes('prompts')) {
    const r = await p.evaluate(async () => {
      const { lifePoints } = await import('/casino/src/world/life-points.ts');
      const w = window.casino.world;
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const prompt = () => {
        const e = document.querySelector('.world-prompt');
        return e && !e.hidden ? e.textContent : '';
      };
      const stations = [];
      for (const s of w.stations) {
        const f = [Math.sin(s.yaw), Math.cos(s.yaw)];
        const d = s.footprint.depth / 2 + 0.7;
        w.teleport(s.anchor.position.x + f[0] * d, s.anchor.position.z + f[1] * d, s.yaw + Math.PI);
        await frame();
        if (!prompt().includes(s.name)) stations.push(`${s.id}: "${prompt()}"`);
      }
      const seats = [];
      const desks = [];
      for (const s of lifePoints(w.plan).seats) {
        let sit = false;
        for (const turn of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
          const a = s.yaw + turn;
          w.teleport(s.x + Math.sin(a) * 0.8, s.z + Math.cos(a) * 0.8, a + Math.PI);
          await frame();
          if (/· Sit$/.test(prompt())) {
            sit = true;
            break;
          }
        }
        if (s.station) {
          if (sit) desks.push(s.id);
        } else if (!sit) seats.push(s.id);
      }
      return { stations, seats, desks, nStations: w.stations.length };
    });
    ok(r.stations.length === 0, `every station (${r.nStations}) shows its own prompt from its players' side${r.stations.length ? `: ${r.stations.slice(0, 6).join(', ')}` : ''}`);
    ok(r.seats.length === 0, `every floor seat offers Sit${r.seats.length ? `: not ${r.seats.slice(0, 8).join(', ')}` : ''}`);
    ok(r.desks.length === 0, `a computer's prompt comes before its desk chair's Sit${r.desks.length ? `: ${r.desks.join(', ')}` : ''}`);
  }

  if (checks.includes('seatcam')) {
    for (const id of ['lobby.bench.1.1', 'pit.banquette.1.6', 'lounge.armchair.1']) {
      const s = await seatNamed(p, id);
      await p.evaluate((seat) => window.casino.world.teleport(seat.x + Math.sin(seat.yaw) * 0.8, seat.z + Math.cos(seat.yaw) * 0.8, seat.yaw + Math.PI), s);
      await p.waitForTimeout(300);
      await sitOn(p, s);
      await p.waitForTimeout(1800);
      const d = await p.evaluate(() => {
        const c = window.casino.engine.camera.position;
        const q = window.casino.world.player.position;
        return Math.hypot(c.x - q.x, c.z - q.z);
      });
      ok(d > 1.5, `sitting on ${id}, the camera settles ${d.toFixed(2)} m off (not in the sitter's hair)`);
      await shot(p, `seatcam-${id.replace(/\./g, '-')}`);
      await p.evaluate(() => window.casino.world.life.seating.stand());
      await p.waitForTimeout(600);
    }
  }

  if (checks.includes('bubble')) {
    // the camera 0.8 m in front of the bartender's face, looking at it
    await p.evaluate(() => {
      const c = window.casino;
      c.world.player.setEnabled(false);
      c.qaHold = c.engine.onFrame(() => {
        const m = c.world.life.bartender.m;
        const f = [Math.sin(m.yaw), Math.cos(m.yaw)];
        c.engine.camera.position.set(m.x + f[0] * 0.8, 1.35, m.z + f[1] * 0.8);
        c.engine.camera.lookAt(m.x, 1.3, m.z);
      });
      const l = c.world.life;
      l.speech.say(l.bartender.m.ch.root, "What'll it be tonight? Everything on the shelf is poured fresh.", 'Bartender');
    });
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const b = document.querySelector('.staff-say-bubble')?.getBoundingClientRect();
      return b ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right } : null;
    });
    ok(r && r.top >= 70 && r.left >= 0 && r.right <= 1280 && r.bottom <= 800, `a staff line up close stays on screen, under the HUD's bar (${JSON.stringify(r)})`);
    await shot(p, 'bubble-close');
    await p.evaluate(() => {
      window.casino.qaHold?.();
      window.casino.world.player.setEnabled(true);
    });
  }

  if (checks.includes('deskfly')) {
    const worst = await p.evaluate(async () => {
      const w = window.casino.world;
      const cam = window.casino.engine.camera;
      let out = { d: Infinity, id: '' };
      for (const s of w.stations.filter((x) => x.footprint.width === 1.2 && x.footprint.depth === 1.6)) {
        const f = [Math.sin(s.yaw), Math.cos(s.yaw)];
        const d = s.footprint.depth / 2 + 0.7;
        w.teleport(s.anchor.position.x + f[0] * d, s.anchor.position.z + f[1] * d, s.yaw + Math.PI);
        await new Promise((res) => setTimeout(res, 300));
        const inv = s.anchor.matrixWorld.clone().invert();
        let min = Infinity;
        const off = window.casino.engine.onFrame(() => {
          // the chair's back and headrest in the station's frame (games/online/pc.ts)
          const l = cam.position.clone().applyMatrix4(inv);
          min = Math.min(min, Math.hypot(Math.max(0, Math.abs(l.x) - 0.25), Math.max(0, 0.5 - l.y, l.y - 1.35), Math.max(0, 0.66 - l.z, l.z - 0.86)));
        });
        w.enter(s);
        await new Promise((res) => setTimeout(res, 1200));
        await w.exitTable();
        off();
        if (min < out.d) out = { d: min, id: s.id };
      }
      return out;
    });
    ok(worst.d > 0.1, `flying in to a computer and out, the camera keeps clear of the gaming chair (closest ${worst.d.toFixed(2)} m, at ${worst.id})`);
  }

  if (errors.length) fail(`dev floor errors: ${errors.slice(0, 3).join(' | ')}`);
  await p.close();
}

// --- with the worker: players -----------------------------------------------------------------------

async function enterAs(name, { onboard = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
  const p = await ctx.newPage();
  const errors = [];
  watch(p, errors);
  await p.goto(`http://localhost:${port}/casino/`, { timeout: 180_000 });
  await p.waitForSelector('.name-input, .menu-item', { timeout: 300_000 });
  if (await p.$('.name-input')) {
    await p.fill('.name-input', name);
    if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
    await p.click('.enter-btn');
  }
  await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
  if (await p.$('.editor-panel.guided')) {
    await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 });
    await p.waitForTimeout(1500);
    if (onboard) await onboard(p);
    for (let i = 0; i < 3; i++) {
      await p.click('.editor-panel .ed-buttons .btn.primary');
      await p.waitForTimeout(500);
    }
  } else {
    await p.click('.menu-item >> nth=0');
  }
  await p.waitForSelector('.hud', { timeout: 30_000 });
  await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 });
  await p.waitForTimeout(1200);
  return { p, ctx, errors };
}

/** Hops a walk's worth at a time, so the floor believes it (presence.ts MAX_BANK). */
async function travel(p, x, z, yaw) {
  const from = await at(p);
  const n = Math.max(1, Math.ceil(Math.hypot(x - from.x, z - from.z) / 7));
  for (let i = 1; i <= n; i++) {
    await p.evaluate(([a, b, c]) => window.casino.world.teleport(a, b, c), [from.x + ((x - from.x) * i) / n, from.z + ((z - from.z) * i) / n, yaw]);
    await p.waitForTimeout(1100);
  }
}

const needsServer = checks.some((c) => ['panels', 'onboard', 'race', 'away'].includes(c));
if (needsServer) sql('DELETE FROM casino_rate');

async function panels(p) {
  for (const [name, key] of [
    ['the map', 'KeyN'],
    ['the emotes', 'KeyG'],
    ['the keyboard sheet', 'Shift+Slash'],
  ]) {
    await p.evaluate(() => window.casino.world.teleport(0, 9, Math.PI));
    await p.waitForTimeout(300);
    await p.keyboard.down('KeyW');
    await p.waitForTimeout(300);
    await p.keyboard.press(key);
    const a = await at(p);
    await p.waitForTimeout(900);
    const b = await at(p);
    await p.keyboard.up('KeyW');
    const open = await overlays(p);
    ok(open > 0 && Math.hypot(b.x - a.x, b.z - a.z) < 0.4, `${name} opened while walking stops the walker (${Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)} m on)`);
    await p.keyboard.down('KeyW');
    await p.waitForTimeout(500);
    await p.keyboard.up('KeyW');
    await p.keyboard.press('KeyE');
    await p.waitForTimeout(250);
    const c = await at(p);
    const sat = await p.evaluate(() => window.casino.world.life.seating.seated?.id ?? window.casino.world.seated?.id ?? null);
    ok(Math.hypot(c.x - b.x, c.z - b.z) < 0.01 && sat === null, `W and E typed into ${name} neither walk nor sit`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    ok((await overlays(p)) === 0, `Esc closes ${name}`);
  }
}

if (checks.includes('panels')) {
  const a = await enterAs('qaw_e2e_a');
  await panels(a.p);
  if (a.errors.length) fail(`panels errors: ${a.errors.slice(0, 3).join(' | ')}`);
  await a.ctx.close();
}

if (checks.includes('onboard')) {
  // a fixed name made new again: the default look, created a moment ago
  try {
    sql(`UPDATE casino_accounts SET look = '{}', created_at = ${Date.now()} WHERE name = 'qaw_e2e_new'`);
  } catch {
    /* not made yet: the first run makes it */
  }
  let camY = null;
  const a = await enterAs('qaw_e2e_new', {
    onboard: async (p) => {
      camY = await p.evaluate(() => window.casino.engine.camera.position.y);
      await shot(p, 'onboard');
    },
  });
  ok(camY !== null && camY < -20, `Pick your look frames the dressing room (camera at y ${camY?.toFixed(1)})`);
  if (a.errors.length) fail(`onboard errors: ${a.errors.slice(0, 3).join(' | ')}`);
  await a.ctx.close();
}

if (checks.includes('race')) {
  const a = await enterAs('qaw_e2e_a');
  const b = await enterAs('qaw_e2e_b');
  const s = await seatNamed(a.p, 'bar.stool.3');
  const back = (dx) => [s.x - Math.sin(s.yaw) * 0.7 + dx, s.z - Math.cos(s.yaw) * 0.7, s.yaw];
  await Promise.all([travel(a.p, ...back(0.3)), travel(b.p, ...back(-0.3))]);
  const [ua, ub] = await Promise.all([sitOn(a.p, s), sitOn(b.p, s)]);
  await a.p.waitForTimeout(2200);
  const seated = async (p) => p.evaluate(() => window.casino.world.life.seating.seated?.id ?? null);
  const [sa, sb] = [await seated(a.p), await seated(b.p)];
  ok(ua && ub && (sa === s.id) !== (sb === s.id), `two players go for one stool: one sits (${sa ?? '-'} / ${sb ?? '-'})`);
  const loser = sa === s.id ? b : a;
  const toast = (await loser.p.$$eval('.toast', (els) => els.map((e) => e.textContent))).join(' ');
  ok(/got there first/.test(toast), `the other hears who got there first ("${toast}")`);
  const where = await at(loser.p);
  ok(Math.hypot(where.x - s.x, where.z - s.z) > 0.4, `and steps back off the stool (${Math.hypot(where.x - s.x, where.z - s.z).toFixed(2)} m)`);
  await shot(loser.p, 'race-loser');
  for (const x of [a, b]) if (x.errors.length) fail(`race errors: ${x.errors.slice(0, 3).join(' | ')}`);
  await a.ctx.close();
  await b.ctx.close();
}

if (checks.includes('away')) {
  const a = await enterAs('qaw_e2e_away');
  const idle = (ms) =>
    a.p.evaluate(async (t) => {
      const { IdleWatch } = await import('/casino/src/app/idle.ts');
      const app = window.casino.app;
      app.idle.stop();
      app.idle = new IdleWatch(app.idle.hooks, t ? { idleMs: t, warnMs: t / 2, hereMs: 3_000 } : undefined);
      app.idle.start();
    }, ms);
  const awayAndBack = async () => {
    await idle(6_000);
    await a.p.waitForSelector('.away', { timeout: 30_000 });
    await a.p.waitForTimeout(1_500);
    await a.p.click('.away-back');
    await a.p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20_000 });
    await idle(0);
  };
  // on a bench
  const s = await seatNamed(a.p, 'lobby.bench.2.2');
  await travel(a.p, s.x + Math.sin(s.yaw) * 0.8, s.z + Math.cos(s.yaw) * 0.8, s.yaw + Math.PI);
  await sitOn(a.p, s);
  await a.p.waitForTimeout(1200);
  await awayAndBack();
  await a.p.waitForTimeout(2_000);
  const still = await a.p.evaluate(() => {
    const l = window.casino.world.life;
    return { mine: l.seating.seated?.id ?? null, book: l.seating.book.seatOf(window.casino.app.link.you.id) };
  });
  ok(still.mine === s.id && still.book === s.id, `away and back on a bench: still sitting there (${JSON.stringify(still)})`);
  // a drink paid for, then away before it comes
  await a.p.evaluate(() => window.casino.world.life.seating.stand());
  await a.p.waitForTimeout(600);
  await a.p.evaluate(() => window.casino.app.openBarMenu());
  await a.p.click('.bar-order[aria-label^="Order Espresso"]');
  await a.p.waitForFunction(() => document.querySelector('.bar-status')?.textContent?.includes('On its way'), null, { timeout: 8_000 });
  await a.p.keyboard.press('Escape');
  await awayAndBack();
  let held = null;
  for (let k = 0; k < 90 && held !== 'espresso'; k++) {
    await a.p.waitForTimeout(700);
    held = await a.p.evaluate(() => window.casino.session.profile?.look.held?.item ?? null);
  }
  ok(held === 'espresso', 'a drink paid for just before going away is brought after Come back');
  await shot(a.p, 'away-drink');
  if (a.errors.length) fail(`away errors: ${a.errors.slice(0, 3).join(' | ')}`);
  await a.ctx.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all qa-world checks passed');
process.exit(failed ? 1 : 0);
