#!/usr/bin/env node
// Headless checks for the v3 floor. Usage:
//   node scripts/e2e/world3.mjs [port] [out dir] [checks...]
//   checks: shots layout lod (dev floor, Vite only); lock onboard (the game proper, needs the
//   worker too: PORT_BASE=<port> npm run dev). Default: all.
// SHOTS=pit,poker limits the fixed views. GPU=1 renders on the machine's GPU (Metal) for real
// frame times; otherwise SwiftShader. Runs Chrome's new headless mode (channel 'chromium'): the
// headless shell refuses Pointer Lock.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5930', out = '/tmp/world3', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const all = ['shots', 'layout', 'lod', 'lock', 'onboard'];
const checks = wanted.length ? wanted : all;
const gpu = process.env.GPU === '1';
const args = gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chromium', args });
const floorUrl = `http://localhost:${port}/casino/src/world/dev-floor.html`;
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};

function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(`${m.text()} ${m.location()?.url ?? ''}`.trim()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`));
  return errors;
}

async function openFloor(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = watch(page);
  await page.goto(`${floorUrl}?${query}`, { timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300000 });
  return { page, errors };
}

/** Draw calls over a second or two of frames (the most seen), and the average frame time. */
async function stats(page) {
  return page.evaluate(async () => {
    const c = window.casino;
    const t0 = performance.now();
    let frames = 0;
    let calls = 0;
    await new Promise((r) => {
      const tick = () => {
        frames++;
        calls = Math.max(calls, c.world.stats().calls);
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
        else r();
      };
      requestAnimationFrame(tick);
    });
    const s = c.world.stats();
    return { calls: s.calls, maxCalls: calls, triangles: s.triangles, frameMs: +((performance.now() - t0) / frames).toFixed(1) };
  });
}

/** Hold the camera at a pose (the player stands aside). */
function camera(page, pos, at) {
  return page.evaluate(
    ([pos, at]) => {
      const { world, engine } = window.casino;
      world.player.setEnabled(false);
      world.player.character.root.visible = false;
      window.__cam?.();
      window.__cam = engine.onFrame(() => {
        engine.camera.position.set(...pos);
        engine.camera.lookAt(...at);
      });
    },
    [pos, at],
  );
}

// --- fixed views --------------------------------------------------------------------------------
// Named views of the dev floor, plus hand-placed cameras: the poker room from across the floor
// (its tables are stand-ins there), the rows of the pit from the staff side, the bar's stools.
const CAMS = {
  pokerfar: { pos: [3.5, 2.2, -3.4], at: [16.8, 0.6, -10.8] },
  pokernear: { pos: [13.6, 1.9, -5.9], at: [16.8, 0.7, -10.8] },
  staff: { pos: [-10.6, 1.7, -8.7], at: [6, 0.8, -8.7] },
  rows: { pos: [-11, 1.8, -3.4], at: [0, 0.8, -8] },
  stools: { pos: [12.5, 1.4, 13.6], at: [16.5, 0.7, 7.5] },
  marble: { pos: [0, 1.7, 14.6], at: [0, 0.2, 9] },
  bigsixside: { pos: [-13.4, 2.2, -3.8], at: [-18.4, 1.5, -7.4] },
  cashierq: { pos: [-12.4, 1.8, -8.4], at: [-16, 1, -12.5] },
  lounge: { pos: [4.5, 1.6, 3.2], at: [8.5, 0.6, 8.8] },
};
if (checks.includes('shots')) {
  const only = process.env.SHOTS?.split(',');
  const quality = process.env.QUALITY ?? 'high';
  const views = ['overview', 'pit', 'poker', 'bar', 'slots', 'cashier', 'lounge', 'bigsix', ...Object.keys(CAMS)].filter((v) => !only || only.includes(v));
  for (const view of views) {
    const cam = CAMS[view];
    const { page, errors } = await openFloor(`quality=${quality}&stats=1${cam ? '' : `&view=${view}`}`);
    if (cam) await camera(page, cam.pos, cam.at);
    await page.waitForTimeout(1500);
    const s = await stats(page);
    const file = `${out}/world3-${view}-${quality}.png`;
    await page.screenshot({ path: file });
    console.log(JSON.stringify({ check: 'shot', view, quality, file, ...s, errors: errors.slice(0, 3) }));
    if (s.maxCalls > 250) fail(`${view}/${quality}: ${s.maxCalls} draw calls`);
    if (errors.length) fail(`${view}/${quality}: ${errors[0]}`);
    await page.close();
  }
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
