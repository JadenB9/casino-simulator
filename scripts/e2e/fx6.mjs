#!/usr/bin/env node
// Headless checks for the shop's effects and the lobby's statues.
// Usage: node scripts/e2e/fx6.mjs [port] [out dir] [checks...]
//   checks: preview perf statues live (default: preview statues perf)
//   preview  every effect on the dev floor (Vite only), played round the player and shot at its
//            best moment from a fixed camera, High and Low (QUALITY=high|low|both, default both)
//   statues  three sample statues in the lobby: shot from the doors, their collision, walking
//            round them, the directory's face kept clear
//   perf     several effects at once: frame time and draw calls against the floor without them
//   live     the real stack (PORT_BASE=<port> npm run dev): two players, A buys effects through the
//            shop's endpoint and B sees them (needs the shop's /shop/effect; skipped if it 404s)
// GPU=1 draws on the machine's GPU in visible windows (much faster, and what a player sees).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6240', out = '/tmp/fx6', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const checks = wanted.length ? wanted : ['preview', 'statues', 'perf'];
const qualities = (process.env.QUALITY ?? 'both') === 'both' ? ['high', 'low'] : [process.env.QUALITY];
const gpu = process.env.GPU === '1';
const args = gpu
  ? ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--autoplay-policy=no-user-gesture-required']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const browser = await chromium.launch({ channel: 'chromium', headless: !gpu, args });
const floorUrl = `http://localhost:${port}/casino/src/world/dev-floor.html`;
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const ok = (what) => console.log(`ok   ${what}`);

async function openFloor(quality, extra = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/favicon|404 \(Not Found\)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${floorUrl}?quality=${quality}${extra}`, { timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(() => {
    const c = window.casino;
    c.world.player.setEnabled(false);
    c.shot = null;
    c.engine.onFrame(() => {
      if (!c.shot) return;
      c.engine.camera.position.set(...c.shot.pos);
      c.engine.camera.lookAt(...c.shot.at);
    });
  });
  return { page, errors };
}

const place = (page, pos, at) => page.evaluate(([p, a]) => (window.casino.shot = { pos: p, at: a }), [pos, at]);
const stand = (page, x, z, yaw = Math.PI) => page.evaluate(([x, z, yaw]) => window.casino.world.teleport(x, z, yaw), [x, z, yaw]);
const wait = (page, s) => page.waitForTimeout(s * 1000);
const shot = async (page, name) => {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path });
  console.log(`     ${path}`);
};

// where each effect is shown: the player stands at `at`, the camera at `cam` looking at `look`,
// shots `when` seconds after it starts
const LOBBY = { at: [0.2, 8.6], cam: [0.9, 1.85, 12.7], look: [0, 1.25, 8.4] };
const PIT = { at: [0, 1.4], cam: [4.2, 2.0, 2.6], look: [-1, 1.5, -4] };
const PREVIEW = [
  { fx: 'fx-confetti', ...LOBBY, when: [0.55, 2.2, 5.5] },
  { fx: 'fx-spotlight', ...LOBBY, when: [1.5, 4.5], walk: { at: 2, to: [-1.6, 7.2] }, wide: { cam: [2.4, 2.4, 13.6], look: [0, 3, 7.5] } },
  { fx: 'fx-round', ...LOBBY, when: [1.5], crowd: true },
  { fx: 'fx-rain', ...LOBBY, when: [2.5, 7] },
  { fx: 'fx-sparklers', ...LOBBY, when: [1.5, 6] },
  { fx: 'fx-disco', ...PIT, when: [6, 14], wide: { cam: [9, 2.2, 1.8], look: [-2, 1.6, -5] } },
  { fx: 'fx-marquee', at: [0, 1.4], sign: true, when: [1.1, 3.6, 7.5] },
  { fx: 'fx-goldenhour', ...LOBBY, when: [4, 10] },
];

async function preview(quality) {
  const { page, errors } = await openFloor(quality);
  for (const p of PREVIEW) {
    await stand(page, p.at[0], p.at[1], Math.PI * 0.85);
    if (p.sign) {
      const s = await page.evaluate(() => window.casino.fx.sign);
      await place(page, [s.x + 2.2, 1.8, s.z + 5.5], [s.x, 3.45, s.z]);
    } else await place(page, p.cam, p.look);
    if (p.crowd) await page.evaluate(([x, z]) => window.casino.fx.stranger(x + 1.1, z - 0.4), p.at);
    await wait(page, 0.5);
    const ev = await page.evaluate((fx) => window.casino.fx.play(fx), p.fx);
    let last = 0;
    for (const t of p.when) {
      if (p.walk && last < p.walk.at && t > p.walk.at) {
        await wait(page, p.walk.at - last);
        last = p.walk.at;
        await stand(page, p.walk.to[0], p.walk.to[1], Math.PI);
      }
      await wait(page, t - last);
      last = t;
      await shot(page, `preview-${quality}-${p.fx}-${String(t).replace('.', '_')}`);
    }
    if (p.wide) {
      await place(page, p.wide.cam, p.wide.look);
      await wait(page, 0.4);
      await shot(page, `preview-${quality}-${p.fx}-wide`);
    }
    const state = await page.evaluate(() => ({ active: window.casino.world.fx.active, tint: window.casino.world.fx ? null : null }));
    if (!state.active.some((a) => a.fx === p.fx) && p.fx !== 'fx-confetti') fail(`${quality} ${p.fx} is not playing ${p.when.at(-1)} s in`);
    else ok(`${quality} ${p.fx} plays`);
    // let it finish before the next (the long ones are cut short: play them with their own length)
    const left = (ev.until - Date.now()) / 1000;
    if (left > 0) await wait(page, Math.min(left + 1.5, 4));
  }
  if (errors.length) fail(`${quality} console errors: ${errors.slice(0, 5).join(' | ')}`);
  await page.close();
}

async function statues(quality) {
  const { page, errors } = await openFloor(quality);
  await stand(page, 0, 13.4, Math.PI);
  await page.evaluate(() => window.casino.fx.statues(3));
  await wait(page, 1);
  const s = await page.evaluate(() => window.casino.world.fx.statues.standing);
  if (s.length !== 3) fail(`${quality} statues: ${s.length} standing, want 3`);
  else ok(`${quality} three statues: ${s.map((x) => `${x.name} (${x.x.toFixed(1)}, ${x.z.toFixed(1)})`).join(', ')}`);
  // solid: walking into the middle of one leaves you outside its post
  const pushed = await page.evaluate((st) => {
    const c = window.casino;
    const p = { x: st.x + 0.05, z: st.z };
    c.world.collider.resolve(p, 0.3);
    return Math.hypot(p.x - st.x, p.z - st.z);
  }, s[0]);
  if (pushed < 0.9) fail(`${quality} a statue doesn't stop the walker (pushed ${pushed.toFixed(2)} m)`);
  else ok(`${quality} statues are solid (pushed out ${pushed.toFixed(2)} m)`);
  await place(page, [0, 1.75, 14.3], [0, 1.6, 7]);
  await wait(page, 0.6);
  await shot(page, `statues-${quality}-doors`);
  // in front of the newest, then its plaque, then all three from the pit's doorway
  const front = (st, d, y) => [st.x + Math.sin(st.yaw) * d, y, st.z + Math.cos(st.yaw) * d];
  await place(page, front(s[0], 3.2, 1.7), [s[0].x, 2.0, s[0].z]);
  await wait(page, 0.6);
  await shot(page, `statues-${quality}-close`);
  await place(page, front(s[1], 1.0, 0.8), [s[1].x, 0.5, s[1].z]);
  await wait(page, 0.6);
  await shot(page, `statues-${quality}-plaque`);
  await place(page, [0, 2.2, 4.2], [0, 1.4, 12]);
  await wait(page, 0.6);
  await shot(page, `statues-${quality}-back`);
  // a new list replaces them: one statue, then none
  await page.evaluate(() => window.casino.fx.statues(1));
  await wait(page, 0.5);
  const one = await page.evaluate(() => ({ n: window.casino.world.fx.statues.standing.length, posts: window.casino.world.collider.posts.length }));
  await page.evaluate(() => window.casino.world.setStatues([]));
  const none = await page.evaluate(() => ({ n: window.casino.world.fx.statues.standing.length, posts: window.casino.world.collider.posts.length }));
  if (one.n !== 1 || none.n !== 0 || one.posts - none.posts !== 1) fail(`${quality} statues don't clear: ${JSON.stringify({ one, none })}`);
  else ok(`${quality} statues clear with their collision`);
  if (errors.length) fail(`${quality} statues console errors: ${errors.slice(0, 5).join(' | ')}`);
  await page.close();
}

async function perf(quality) {
  const { page, errors } = await openFloor(quality);
  await stand(page, 0.2, 1.4, Math.PI);
  await place(page, [4.8, 2.3, 7.6], [0, 1.4, 0.8]);
  const sample = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const c = window.casino;
          const ms = [];
          let calls = 0;
          let last = performance.now();
          let n = 0;
          const f = () => {
            const now = performance.now();
            ms.push(now - last);
            last = now;
            calls = Math.max(calls, c.world.stats().calls);
            if (++n < 90) requestAnimationFrame(f);
            else {
              ms.sort((a, b) => a - b);
              resolve({ median: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)], calls });
            }
          };
          requestAnimationFrame(f);
        }),
    );
  await wait(page, 1.5);
  const before = await sample();
  await page.evaluate(() => {
    const f = window.casino.fx;
    f.stranger(1.6, 0.8);
    for (const fx of ['fx-confetti', 'fx-rain', 'fx-sparklers', 'fx-spotlight', 'fx-disco', 'fx-goldenhour']) f.play(fx);
    f.play('fx-rain', { who: 'stranger' });
  });
  await wait(page, 4);
  const during = await sample();
  await shot(page, `perf-${quality}-all`);
  console.log(`     ${quality}: floor ${before.median.toFixed(1)} ms (p95 ${before.p95.toFixed(1)}), ${before.calls} calls; with seven effects ${during.median.toFixed(1)} ms (p95 ${during.p95.toFixed(1)}), ${during.calls} calls`);
  if (during.calls - before.calls > 30) fail(`${quality} effects cost ${during.calls - before.calls} draw calls`);
  else ok(`${quality} seven effects add ${during.calls - before.calls} draw calls`);
  // everything goes when it's over
  await page.evaluate(() => {
    for (const ev of window.casino.world.fx.known) ev.until = Date.now();
  });
  await wait(page, 3.5);
  const after = await page.evaluate(() => ({ active: window.casino.world.fx.active.length, groups: window.casino.world.fx.group.children.length, tint: window.casino.world.fx.lightingTint?.() ?? 0 }));
  if (after.active !== 0) fail(`${quality} ${after.active} effects still playing after their end`);
  else ok(`${quality} every effect let go after its end (${after.groups} groups left: the warm-up and the statues)`);
  if (errors.length) fail(`${quality} perf console errors: ${errors.slice(0, 5).join(' | ')}`);
  await page.close();
}

try {
  for (const q of qualities) {
    if (checks.includes('preview')) await preview(q);
    if (checks.includes('statues')) await statues(q);
    if (checks.includes('perf')) await perf(q);
  }
  if (checks.includes('live')) {
    const { live } = await import('./fx6-live.mjs');
    failed += await live({ browser, port, out });
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
