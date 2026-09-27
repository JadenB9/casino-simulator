#!/usr/bin/env node
// v1.1: your apartment on the real stack. The account is given an apartment and the new pieces in
// the local database, rides up, and: every new piece stands (screenshots of each corner); the sofa
// is moved with Move and Set down, and the lamp picked up, and both are still so after a reload
// (the floor keeps them); E at the Poker Table opens the Hold'em table flow and a table of your own
// seats you; on a phone, a drawn gun shows Aim beside Fire and a tap aims in.
// Usage: node scripts/e2e/home11.mjs [port] [outDir]   (PORT_BASE=<port - 0> npm run dev first)
import { chromium, devices } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [port = '5600', out = '/tmp/home11'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const NAME = process.env.NAME ?? 'home11_e2e_1';
const gpu = process.env.GPU !== '0';
const browser = await chromium.launch(gpu ? { channel: 'chromium', args: ['--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = 0;
const ok = (c, what) => (c ? console.log(`ok   ${what}`) : (failed++, console.log(`FAIL ${what}`)));
const sql = (command) => execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } });

const ITEMS = ['apt-residence', 'apt-grand', 'sofa-chesterfield', 'games-poker', 'lamp-arc', 'books-library', 'desk-exec', 'grill-outdoor', 'plant-bonsai', 'rug-silk', 'dining-glass', 'bed-platform', 'arcade-pinball', 'tv-85', 'compact-9'];

async function login(ctx) {
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(`http://localhost:${port}/casino/`);
  await p.waitForSelector('.name-input', { timeout: 300000 });
  await p.fill('.name-input', NAME);
  if (await p.$('.pass-input')) await p.fill('.pass-input', 'casino-dev');
  await p.click('.enter-btn');
  await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 30000 });
  if (await p.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) {
      await p.click('.editor-panel .ed-buttons .btn.primary');
      await p.waitForTimeout(500);
    }
  } else await p.click('.menu-item >> nth=0');
  await p.waitForSelector('.hud', { timeout: 30000 });
  await p.waitForFunction(() => window.casino.app.link?.you, null, { timeout: 20000 });
  await p.keyboard.press('Escape').catch(() => {});
  return p;
}

async function rideHome(p) {
  const car = await p.evaluate(() => {
    const L = window.casino.world.city.casinoBank;
    return { ...L.centre(0), yaw: L.yaw };
  });
  await p.evaluate(([x, z, y]) => window.casino.world.teleport(x, z, y), [car.x, car.z, car.yaw]);
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    const l = window.casino.app.link;
    window.__liftNo = null;
    l.subscribe((m) => m.t === 'lift.no' && (window.__liftNo = m.msg));
    l.send({ t: 'lift', to: 'home' });
  });
  await p.waitForTimeout(1500);
  const no = await p.evaluate(() => window.__liftNo);
  if (no) console.log(`lift refused: ${no}`);
  await p.waitForFunction(() => window.casino.world.zone === 'home' && !window.casino.world.city.riding && window.casino.world.city.apt, null, { timeout: 30000 });
  await p.waitForTimeout(2000);
}

/** Stand at (x, z) facing `h` (radians, 0 = +z) in first person. */
async function stand(p, x, z, h) {
  await p.evaluate(([x, z, h]) => {
    const w = window.casino.world;
    w.teleport(x, z, h);
    w.walker.setView('first');
  }, [x, z, h]);
  await p.waitForTimeout(700);
}

const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
let p = await login(ctx);
const id = await p.evaluate(() => window.casino.app.link.you.id);
const now = Date.now();
sql(`INSERT OR IGNORE INTO casino_items (account_id, item, price, bought_at, op_id) VALUES ${ITEMS.map((it, i) => `(${id}, '${it}', 100, ${now}, 'home11-${id}-${i}')`).join(', ')}`);
// a fresh start: nothing moved or picked up from an earlier run
await p.close();
p = await login(ctx);
await rideHome(p);
await p.evaluate(() => {
  const l = window.casino.app.link;
  for (const s of ['sofa', 'lamp', 'games']) {
    l.send({ t: 'home.move', slot: s, at: null });
  }
  l.send({ t: 'home.pick', slot: 'lamp', item: 'lamp-arc' });
});
await p.waitForTimeout(1500);
const pieces = () => p.evaluate(() => Object.fromEntries([...window.casino.world.city.homeInterior().furnished.pieces].map(([k, v]) => [k, v?.id ?? null])));
const have = await pieces();
for (const [slot, it] of Object.entries({ sofa: 'sofa-chesterfield', lamp: 'lamp-arc', books: 'books-library', desk: 'desk-exec', grill: 'grill-outdoor', plant: 'plant-bonsai', rug: 'rug-silk', dining: 'dining-glass', bed: 'bed-platform', arcade: 'arcade-pinball', games: 'games-poker' })) ok(have[slot] === it, `${slot}: ${it} stands (${have[slot]})`);

// every corner, to look at (from where you'd stand, toward what's there)
const toward = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
for (const [name, x, z, tx, tz] of [
  ['living', -137.5, 73.8, -142.4, 80.5],
  ['games', -144.2, 76.2, -150.5, 79.8],
  ['bedroom', -145.3, 60.0, -149.5, 59.6],
  ['books', -150.6, 63.0, -147.6, 63.6],
  ['dining', -134.5, 69.5, -137.5, 66.4],
  ['terrace', -127.6, 72.0, -122.8, 61.5],
]) {
  await stand(p, x, z, toward(x, z, tx, tz));
  await p.screenshot({ path: `${out}/home11-${name}.png` });
}

// the Poker Table: a Hold'em station where the games piece stands
const poker = await p.evaluate(() => {
  const s = window.casino.world.stations.find((x) => x.id === 'apt-poker');
  return s && { x: s.anchor.position.x, z: s.anchor.position.z, visible: s.anchor.visible };
});
ok(poker && poker.visible && Math.abs(poker.x + 149.6) < 0.01 && Math.abs(poker.z - 79.6) < 0.01, `the Poker Table stands in the games corner (${JSON.stringify(poker)})`);

// carrying the Poker Table: a copy is carried, the station itself put away; Esc puts it back
await stand(p, -146.6, 79.6, -Math.PI / 2);
await p.evaluate(() => window.casino.app.v7.startMove('games'));
await p.waitForTimeout(900);
const carried = await p.evaluate(() => ({ station: window.casino.world.stations.find((x) => x.id === 'apt-poker').anchor.visible, copy: !!window.casino.engine.scene.getObjectByName('home:carried-poker') }));
ok(carried.copy && !carried.station, `the Poker Table is carried as a copy, the station put away (${JSON.stringify(carried)})`);
await p.screenshot({ path: `${out}/home11-carrying-poker.png` });
await p.keyboard.press('Escape');
await p.waitForTimeout(900);
ok(await p.evaluate(() => window.casino.world.stations.find((x) => x.id === 'apt-poker').anchor.visible && !window.casino.engine.scene.getObjectByName('home:carried-poker')), 'Esc puts the Poker Table back');

// move the sofa: E at it, Move, walk a little, Set down
await stand(p, -141.6, 77.3, 0);
await p.keyboard.press('KeyE');
await p.waitForSelector('.store-sheet .store-acts', { timeout: 5000 });
await p.screenshot({ path: `${out}/home11-sofa-sheet.png` });
await p.click('.store-sheet .store-acts .btn:has-text("Move")');
await p.waitForSelector('.home-move:not([hidden])', { timeout: 5000 });
await p.waitForTimeout(400);
ok(await p.evaluate(() => window.casino.world.city.homeInterior().furnished.pieces.get('sofa') === null), 'the carried sofa is gone from its place');
// turn about and walk back a few steps
await p.evaluate(() => window.casino.world.teleport(-141.6, 73.2, 0));
await p.waitForTimeout(400);
await p.keyboard.press('KeyR');
await p.keyboard.press('KeyR');
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/home11-carrying.png` });
const green = await p.evaluate(() => window.casino.app.v7.mover.ok);
ok(green, 'the sofa fits where it is carried');
await p.click('.home-move .btn:has-text("Set down")');
await p.waitForTimeout(1500);
const moved = await p.evaluate(() => window.casino.world.city.apt.places?.sofa);
// (it faced you as you carried it, a half turn from your heading, then two eighths more)
ok(moved && Math.abs(moved.x / 100 + 141.6) < 0.1 && moved.z / 100 > 74 && moved.r === 192, `the sofa stands where it was set down, turned a quarter (${JSON.stringify(moved)})`);
await p.screenshot({ path: `${out}/home11-moved.png` });

// a place that doesn't fit: into the kitchen's worktop
const bad = await p.evaluate(async () => {
  const { fits } = await import('/casino/src/world/home/mover.ts');
  return fits(window.casino.world.collider, -136.4, 58.5, 1.3, 0.5, 0);
});
ok(!bad, "a piece doesn't fit into the kitchen's units");

// pick the lamp up
await stand(p, -144.6, 77.3, 0);
await p.keyboard.press('KeyE');
await p.waitForSelector('.store-sheet .store-acts', { timeout: 5000 });
await p.click('.store-sheet .store-acts .btn:has-text("Pick up")');
await p.waitForTimeout(1200);
ok(await p.evaluate(() => window.casino.world.city.homeInterior().furnished.pieces.get('lamp') === null), 'the lamp is picked up');
await p.keyboard.press('Escape');

// the floor kept both: reload and ride up again
await p.close();
p = await login(ctx);
await rideHome(p);
const kept = await p.evaluate(() => ({ sofa: window.casino.world.city.apt.places?.sofa ?? null, lamp: window.casino.world.city.homeInterior().furnished.pieces.get('lamp') }));
ok(kept.sofa && kept.sofa.r === 192 && kept.lamp === null, `after a reload the sofa is still moved and the lamp still away (${JSON.stringify(kept)})`);

// E at the Poker Table: the Hold'em table flow, then a table of your own
await stand(p, -147.2, 79.6, -Math.PI / 2);
await p.keyboard.press('KeyE');
const flow = await p.waitForSelector('.lobby-choice, .lobby-sheet, .lobby', { timeout: 8000 }).catch(() => null);
ok(!!flow, 'E at the Poker Table opens the table flow');
await p.screenshot({ path: `${out}/home11-poker-flow.png` });
if (flow) {
  const solo = p.locator('.lobby-choice').first();
  await solo.click();
  await p.waitForTimeout(800);
  // a buy-in, if asked
  const buy = p.locator('.buyin-sheet .btn.primary, .buy-in .btn.primary').first();
  if (await buy.count()) await buy.click().catch(() => {});
  await p.waitForTimeout(4000);
  const seated = await p.evaluate(() => window.casino.world.seated?.id ?? null);
  ok(seated === 'apt-poker', `sitting at the apartment's Poker Table (${seated})`);
  await p.screenshot({ path: `${out}/home11-poker-table.png` });
  // stand up and cash out, so the next run's elevator isn't refused for chips on the table
  await p.evaluate(() => window.casino.app.escape());
  const leave = await p.waitForSelector('.modal .btn.primary', { timeout: 3000 }).catch(() => null);
  if (leave) await leave.click();
  await p.waitForFunction(() => !window.casino.world.seated, null, { timeout: 20000 }).catch(() => {});
}
ok(p.errors.length === 0, `no page errors (${p.errors.slice(0, 3).join(' | ')})`);
await ctx.close();

// on a phone: a drawn gun shows Aim beside Fire; a tap aims in, another comes back out
const phone = await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined });
p = await login(phone);
// (the login's clicks were a mouse's: a tap on the view turns the touch controls on)
await p.tap('canvas');
await p.waitForFunction(() => document.documentElement.classList.contains('touch-ui'), null, { timeout: 5000 });
await p.evaluate(() => {
  const w = window.casino.world;
  w.teleport(0, 12, Math.PI);
});
await p.waitForTimeout(800);
await p.tap('.arms-gun');
await p.waitForTimeout(600);
const btns = await p.evaluate(() => {
  const r = (s) => {
    const e = document.querySelector(s);
    if (!e || e.hidden) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom };
  };
  return { fire: r('.arms-fire'), aim: r('.arms-aim'), gun: r('.arms-gun'), act: r('.touch-act'), ride: r('.touch-ride') };
});
ok(btns.aim && btns.fire, `Aim shows beside Fire (${JSON.stringify(btns)})`);
const hit = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
ok(!hit(btns.aim, btns.fire) && !hit(btns.aim, btns.gun) && !hit(btns.aim, btns.act), 'Aim overlaps no other button');
await p.tap('.arms-aim');
await p.waitForTimeout(700);
const aimed = await p.evaluate(() => window.casino.app.v7.arms.aimK);
ok(aimed > 0.5, `a tap aims in (${aimed.toFixed(2)})`);
await p.screenshot({ path: `${out}/home11-phone-aim.png` });
await p.tap('.arms-aim');
await p.waitForTimeout(900);
ok((await p.evaluate(() => window.casino.app.v7.arms.aimK)) < 0.05, 'another tap comes back out');
ok(p.errors.length === 0, `no phone page errors (${p.errors.slice(0, 3).join(' | ')})`);
await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall ok');
process.exit(failed ? 1 : 0);
