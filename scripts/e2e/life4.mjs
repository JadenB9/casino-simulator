#!/usr/bin/env node
// Headless looks at the floor's life (client/src/world/life/): a waiter with a tray on the round,
// sitting on a sofa and a bar stool, the bartender, the bankers and the shopkeeper on the dev floor;
// then against the local worker with two players: one sits and the other sees it, an order walked
// over by a waiter and handed across, the banker's greeting with the bank's sheet beside them.
//
// Usage: node scripts/e2e/life4.mjs [port] [outDir] [checks...]   (checks: dev floor; default both)
//   --sw   SwiftShader instead of the machine's GPU
// The floor checks log in as fixed names (life_e2e_a, life_e2e_b) with the dev password.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const [port = '6070', out = '/tmp/life4-shots', ...wanted] = args;
const checks = wanted.length ? wanted : ['dev', 'floor'];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(flag('sw') ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : { channel: 'chromium', args: ['--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const frames = (p, n = 4) => p.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function shot(p, name, clip) {
  await frames(p, 6);
  await p.screenshot({ path: `${out}/${name}.png`, ...(clip ? { clip } : {}) });
  console.log('shot', `${out}/${name}.png`);
}

function watch(p) {
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** A camera the script holds: `aim(page, [pos], [at])`, or follow a crew member from an offset. */
async function hold(p) {
  await p.evaluate(() => {
    const c = window.casino;
    c.shot = null;
    c.engine.onFrame(() => {
      const s = c.shot;
      if (!s) return;
      if (s.follow) {
        const m = s.follow();
        const f = [Math.sin(m.yaw), Math.cos(m.yaw)];
        const [ahead, side, up, lookUp] = s.offset;
        c.engine.camera.position.set(m.x + f[0] * ahead + f[1] * side, up, m.z + f[1] * ahead - f[0] * side);
        c.engine.camera.lookAt(m.x, lookUp, m.z);
      } else {
        c.engine.camera.position.set(...s.pos);
        c.engine.camera.lookAt(...s.at);
      }
    });
  });
}
const aim = (p, pos, at) => p.evaluate(([a, b]) => (window.casino.shot = { pos: a, at: b }), [pos, at]);

// --- the dev floor: the staff and sitting, no server ---------------------------------------------

if (checks.includes('dev')) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = watch(p);
  await p.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?quality=high`, { timeout: 180000 });
  await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300000 });
  await hold(p);
  const info = await p.evaluate(() => {
    const l = window.casino.world.life;
    return { waiters: l.waiters.list.length, tellers: l.bankers.tellers.length, seats: window.casino.world.plan && l.seating ? 1 : 0, grid: l.grid.cols * l.grid.rows };
  });
  console.log('life', JSON.stringify(info));
  if (info.waiters < 2 || info.waiters > 4) fail(`2-4 waiters (${info.waiters})`);
  if (info.tellers < 2) fail(`a banker at each window (${info.tellers})`);

  // a waiter walking the round, from the front and from the side, close
  for (const [i, name, offset] of [[0, 'waiter-front', [2.2, 0.4, 1.55, 1.1]], [1, 'waiter-side', [0.6, 2.2, 1.45, 1.1]], [2, 'waiter-back', [-2.4, 0.6, 1.8, 1.1]]]) {
    await p.evaluate(([k, o]) => {
      const m = window.casino.world.life.waiters.list[k].m;
      window.casino.shot = { follow: () => m, offset: o };
    }, [i, offset]);
    await p.waitForTimeout(1500);
    await shot(p, name, { x: 320, y: 80, width: 640, height: 640 });
  }

  // the bartender and the bar, the bankers at the cage
  const pts = await p.evaluate(() => {
    const l = window.casino.world.life;
    return { bar: l.bartender.m.x, barZ: l.bartender.m.z, tellers: l.bankers.tellers.map((t) => ({ x: t.home.x, z: t.home.z, cx: t.customer.x, cz: t.customer.z })) };
  });
  await aim(p, [pts.bar - 3.2, 1.7, pts.barZ + 1.2], [pts.bar, 1.2, pts.barZ]);
  await p.waitForTimeout(800);
  await shot(p, 'bartender', { x: 240, y: 100, width: 800, height: 600 });
  const t0 = pts.tellers[0];
  const t1 = pts.tellers[1];
  await aim(p, [(t0.cx + t1.cx) / 2, 1.65, t0.cz + 2.2], [(t0.x + t1.x) / 2, 1.3, t0.z]);
  await p.waitForTimeout(800);
  await shot(p, 'bankers', { x: 200, y: 120, width: 880, height: 560 });

  // sitting: the player on a sofa place and on a bar stool, from behind (the game's own camera)
  await p.evaluate(() => (window.casino.shot = null));
  for (const [id, name] of [['lounge.sofa.1a.2', 'sit-sofa'], ['bar.stool.3', 'sit-stool']]) {
    await p.evaluate((sid) => {
      const w = window.casino.world;
      const s = w.life.seating;
      if (s.seated) s.stand({ walk: true });
      const seat = window.__seats?.find((x) => x.id === sid) ?? null;
      return seat;
    }, id);
    const seat = await p.evaluate(async (sid) => {
      const { lifePoints } = await import('/casino/src/world/life-points.ts');
      const w = window.casino.world;
      const seat = lifePoints(w.plan).seats.find((x) => x.id === sid);
      w.player.setEnabled(true);
      w.player.character.root.visible = true;
      w.teleport(seat.x + Math.sin(seat.yaw) * 0.8, seat.z + Math.cos(seat.yaw) * 0.8, seat.yaw + Math.PI);
      return seat;
    }, id);
    await p.waitForTimeout(500);
    await p.evaluate((sid) => {
      const w = window.casino.world;
      const s = w.life.seating;
      const seats = w.life.seating.spots(w.player.position);
      const sit = seats.find((x) => x.key === `sit:${sid}`);
      sit?.use();
    }, id);
    await p.waitForTimeout(1600);
    const sat = await p.evaluate(() => window.casino.world.life.seating.seated?.id ?? null);
    if (sat !== id) fail(`sat on ${id} (${sat})`);
    await shot(p, name);
    // and from the side, close
    await aim(p, [seat.x + Math.sin(seat.yaw + Math.PI / 2) * 2.2 + Math.sin(seat.yaw) * 0.8, 1.2, seat.z + Math.cos(seat.yaw + Math.PI / 2) * 2.2 + Math.cos(seat.yaw) * 0.8], [seat.x, 0.8, seat.z]);
    await p.waitForTimeout(600);
    await shot(p, `${name}-side`, { x: 320, y: 100, width: 640, height: 600 });
    await p.evaluate(() => (window.casino.shot = null));
    await p.evaluate(() => window.casino.world.life.seating.stand());
    await p.waitForTimeout(700);
  }

  // the shopkeeper, at a stand-in counter in the lounge until the boutique is built
  await p.evaluate(() => {
    const w = window.casino.world;
    const L = w.plan.lounge;
    const x = L.x0 + 0.9;
    const z = (L.z0 + L.z1) / 2;
    w.life.useBoutique({ keeper: { x, z, yaw: Math.PI / 2 }, customer: { x: x + 1.4, z, yaw: -Math.PI / 2 }, cases: [{ x: x + 0.2, z: z - 1.5, yaw: Math.PI / 2, top: 0.95 }], mannequins: [{ x: x + 0.3, z: z + 1.6, yaw: Math.PI / 2 }] });
  });
  const follow = () =>
    p.evaluate(() => {
      const m = window.casino.world.life.shopkeeper.m;
      window.casino.shot = { follow: () => m, offset: [2.3, 0.7, 1.6, 1.15] };
    });
  await p.evaluate(() => {
    const m = window.casino.world.life.shopkeeper.m;
    window.casino.world.life.crew.play(m, 'welcome');
  });
  await follow();
  await p.waitForTimeout(700);
  await shot(p, 'shopkeeper', { x: 320, y: 100, width: 640, height: 600 });
  for (const [motion, name] of [['polish', 'shopkeeper-polish'], ['adjust', 'shopkeeper-adjust'], ['count', 'banker-count'], ['handOver', 'handover']]) {
    await p.evaluate((mo) => {
      const l = window.casino.world.life;
      const m = mo === 'count' ? l.bankers.tellers[0].m : l.shopkeeper.m;
      l.crew.play(m, mo);
    }, motion);
    await p.waitForTimeout(motion === 'count' ? 900 : 1100);
    if (motion === 'count') {
      const t = pts.tellers[0];
      await aim(p, [t.x + 0.4, 1.55, t.z + 2.0], [t.x, 1.2, t.z]);
      await p.waitForTimeout(200);
    }
    await shot(p, name, { x: 320, y: 100, width: 640, height: 600 });
    if (motion === 'count') await follow();
  }
  const calls = await p.evaluate(async () => {
    const w = window.casino.world;
    w.player.setEnabled(false);
    window.casino.shot = { pos: [0.8, 1.95, w.plan.entrance.z0 - 2.4], at: [0, 1.1, -8.7] };
    await new Promise((r) => setTimeout(r, 1500));
    return w.stats().calls;
  });
  console.log('draw calls (overview)', calls);
  if (calls > 250) fail(`draw calls ${calls} > 250`);
  if (errors.length) fail(`dev errors: ${errors.slice(0, 5).join(' | ')}`);
  await p.close();
}

// --- against the worker: two players --------------------------------------------------------------

async function enterAs(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = watch(p);
  await p.goto(`http://localhost:${port}/casino/`, { timeout: 180000 });
  await p.waitForSelector('.name-input', { timeout: 180000 });
  await p.fill('.name-input', name);
  if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
  await p.click('.enter-btn');
  // a new name picks a look first
  await p.waitForSelector('.menu-item, .editor-panel', { timeout: 30000 });
  if (!(await p.$('.menu-item'))) {
    // a new name: through "Pick your look", step by step
    await p.waitForTimeout(2500);
    for (let k = 0; k < 10 && !(await p.$('.hud')); k++) {
      const next = await p.$('.editor-panel .ed-buttons .btn.primary');
      if (next) await next.click();
      await p.waitForTimeout(700);
    }
  } else {
    await p.click('.menu-item >> nth=0');
  }
  await p.waitForSelector('.hud', { timeout: 30000 });
  await p.waitForTimeout(1500);
  return { p, ctx, errors };
}

if (checks.includes('floor')) {
  const a = await enterAs('life_e2e_a');
  const b = await enterAs('life_e2e_b');
  // A sits on a sofa; B, standing a few metres off, sees A sitting there
  const seat = await a.p.evaluate(async () => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    const w = window.casino.world;
    const s = lifePoints(w.plan).seats.find((x) => x.id === 'lounge.sofa.1a.2');
    w.teleport(s.x + Math.sin(s.yaw) * 0.75, s.z + Math.cos(s.yaw) * 0.75, s.yaw + Math.PI);
    return s;
  });
  await a.p.waitForTimeout(900);
  await a.p.evaluate(() => {
    const w = window.casino.world;
    w.life.seating.spots(w.player.position).find((x) => x.key === 'sit:lounge.sofa.1a.2')?.use();
  });
  await a.p.waitForTimeout(1500);
  await shot(a.p, 'floor-a-sitting');
  await b.p.evaluate(([x, z]) => window.casino.world.teleport(x, z, Math.PI * 0.75), [seat.x + 2.6, seat.z + 2.2]);
  await b.p.waitForTimeout(2500);
  const seen = await b.p.evaluate((id) => {
    const l = window.casino.world.life;
    return [...l.seating.book.entries()].map(([s]) => s).includes(id);
  }, seat.id);
  if (!seen) fail('B knows A sits on the sofa');
  await hold(b.p);
  await aim(b.p, [seat.x + 2.3, 1.55, seat.z + 2.0], [seat.x, 0.75, seat.z]);
  await b.p.waitForTimeout(900);
  await shot(b.p, 'floor-b-sees-a-sitting');
  // B tries the same seat: refused with A's name (the floor's word)
  await b.p.evaluate(async ([x, z]) => window.casino.world.teleport(x, z, 0), [seat.x + Math.sin(seat.yaw) * 0.75, seat.z + Math.cos(seat.yaw) * 0.75]);
  await b.p.waitForTimeout(600);
  const offered = await b.p.evaluate((id) => {
    const w = window.casino.world;
    return w.life.seating.spots(w.player.position).some((x) => x.key === `sit:${id}`);
  }, seat.id);
  if (offered) fail("a taken seat isn't offered to someone else");

  // A orders a champagne from the sofa: the bartender makes it and a waiter brings it over
  grant('life_e2e_a', 5000);
  await a.p.evaluate(async () => {
    const t = sessionStorage.getItem('casino.token');
    const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } });
    window.casino.session.set((await r.json()).profile);
  });
  await a.p.evaluate(() => window.casino.app.openBarMenu());
  await a.p.click('.bar-order[aria-label^="Order Champagne"]');
  await a.p.waitForFunction(() => document.querySelector('.bar-status')?.textContent?.includes('On its way'), null, { timeout: 8000 });
  await a.p.keyboard.press('Escape');
  // follow the waiter who has it
  await hold(a.p);
  let brought = false;
  for (let k = 0; k < 60 && !brought; k++) {
    await a.p.waitForTimeout(1000);
    const st = await a.p.evaluate(() => {
      const l = window.casino.world.life;
      const w = l.waiters.list.find((x) => x.job?.kind === 'deliver' && x.job.phase !== 'back');
      const held = window.casino.session.profile?.look.held?.item ?? null;
      return { phase: w?.job?.phase ?? null, i: w ? l.waiters.list.indexOf(w) : -1, held };
    });
    if (st.i >= 0 && k % 1 === 0) {
      await a.p.evaluate((i) => {
        const m = window.casino.world.life.waiters.list[i].m;
        window.casino.shot = { follow: () => m, offset: [2.0, 0.6, 1.6, 1.15] };
      }, st.i);
    }
    if (st.phase === 'guest' && !(await exists(`${out}/floor-waiter-brings.png`))) await shot(a.p, 'floor-waiter-brings');
    if (st.phase === 'hand') await shot(a.p, 'floor-waiter-hands-over');
    if (st.held === 'champagne') brought = true;
  }
  if (!brought) fail('the waiter brought the champagne');
  await a.p.evaluate(() => (window.casino.shot = null));
  await a.p.waitForTimeout(1200);
  await shot(a.p, 'floor-a-holding');

  // A goes to the bank: a teller window, the banker's greeting, the sheet beside them. With
  // $9,999.99 in all the bank tops A up: the banker nods it through and counts out $40,000.01.
  await a.p.evaluate(() => window.casino.world.life.seating.stand());
  sql(`UPDATE casino_accounts SET balance = 999999, rev = rev + 1 WHERE name = 'life_e2e_a';`);
  await a.p.evaluate(async () => {
    const t = sessionStorage.getItem('casino.token');
    const r = await fetch('/casino/api/me', { headers: { Authorization: `Bearer ${t}` } });
    window.casino.session.set((await r.json()).profile);
  });
  await a.p.evaluate(() => {
    const w = window.casino.world;
    const t = w.life.bankers.tellers[1];
    w.teleport(t.customer.x, t.customer.z + 0.5, Math.PI);
  });
  await a.p.waitForTimeout(900);
  await a.p.evaluate(() => {
    const w = window.casino.world;
    w.life.bankers.spots(w.player.position)[0]?.use();
  });
  await a.p.waitForTimeout(500);
  await shot(a.p, 'floor-banker-greets');
  await a.p.waitForSelector('.bank-sheet', { timeout: 8000 });
  await a.p.waitForTimeout(1200);
  await shot(a.p, 'floor-bank-sheet');
  await a.p.waitForFunction(() => !document.querySelector('.bank-take')?.disabled, null, { timeout: 8000 }).catch(() => fail('the top-up is offered under $10,000'));
  await a.p.click('.bank-take');
  await a.p.waitForFunction(() => document.querySelector('.bank-status')?.textContent?.startsWith('Loan made'), null, { timeout: 8000 }).catch(() => fail('the top-up went through'));
  await a.p.waitForTimeout(1800);
  await shot(a.p, 'floor-banker-counts');
  const said = await a.p.evaluate(() => [...document.querySelectorAll('.staff-say-text')].map((e) => e.textContent));
  console.log('banker says', JSON.stringify(said));
  if (!said.some((s) => s.includes('$40,000.01'))) fail(`the banker counts out $40,000.01 (${said.join(' / ')})`);
  await a.p.keyboard.press('Escape');
  await a.p.waitForTimeout(900);
  for (const [who, r] of [['a', a], ['b', b]]) if (r.errors.length) fail(`${who} errors: ${r.errors.slice(0, 5).join(' | ')}`);
  await a.ctx.close();
  await b.ctx.close();
}

async function exists(path) {
  try {
    const { statSync } = await import('node:fs');
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Winnings, the way a table pays them: a ledger row and the balance, in the local database. */
function grant(name, dollars) {
  const cents = dollars * 100;
  const now = Date.now();
  sql(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) SELECT 'e2e-win:' || id || ':${now}', id, 'cashout', ${cents}, 'e2e', ${now} FROM casino_accounts WHERE name = '${name}'; UPDATE casino_accounts SET balance = balance + ${cents}, rev = rev + 1 WHERE name = '${name}';`);
}

function sql(command) {
  execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } });
}

console.log(failed ? `${failed} failed` : 'ok');
await browser.close();
process.exit(failed ? 1 : 0);
