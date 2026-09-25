#!/usr/bin/env node
// Straw, Sticks & Bricks on the floor: the dev floor with the catalogue's islands, where the
// machine's island (four cabinets and its topper) stands in the slots hall. Screenshots it from
// the aisle and close up, counts draw calls over the hall against the 250 budget with and without
// the new cabinets, and walks up to one to check the E prompt reaches it. The machine at play is
// scripts/e2e/slots2.mjs (pigs) and slots6.mjs (pigs).
// Usage: node scripts/e2e/pigs6.mjs [port] [outDir]   (GPU=1: the Mac's GPU)

import { chromium } from 'playwright';

const [port = '6470', outDir = '/tmp'] = process.argv.slice(2);
const gpu = process.env.GPU === '1';
const browser = gpu
  ? await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] })
  : await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
  return ok;
};

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`http://localhost:${port}/casino/src/world/dev-floor.html?${query}`, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600000 });
  return { page, errors };
}

const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

async function pose(page, pos, at) {
  await page.evaluate(([pos, at]) => {
    const { world, engine } = window.casino;
    world.player.setEnabled(false);
    world.player.character.root.visible = false;
    window.__cam?.();
    window.__cam = engine.onFrame(() => {
      engine.camera.position.set(...pos);
      engine.camera.lookAt(...at);
    });
  }, [pos, at]);
  await frames(page, 6);
  await page.waitForTimeout(400);
}

const callsNow = (page) =>
  page.evaluate(async () => {
    let calls = 0;
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      calls = Math.max(calls, window.casino.world.stats().calls);
    }
    return calls;
  });

for (const quality of ['high', 'low']) {
  const { page, errors } = await open(`quality=${quality}`);
  const ids = await page.evaluate(() => window.casino.world.stations.filter((s) => s.variant === 'pigs').map((s) => s.id));
  check(ids.length >= 2 && ids.length <= 4, `${quality}: ${ids.length} Straw, Sticks & Bricks machines on the floor (${ids.join(', ')})`);
  const where = await page.evaluate(() => {
    const s = window.casino.world.stations.filter((x) => x.variant === 'pigs');
    const p = s.map((x) => x.anchor.getWorldPosition(x.anchor.position.clone()));
    return { x: p.reduce((a, v) => a + v.x, 0) / p.length, z: p.reduce((a, v) => a + v.z, 0) / p.length };
  });
  // from the main aisle, then close up to the cabinets' faces
  await pose(page, [where.x + 3.2, 1.75, where.z + 4.8], [where.x, 1.4, where.z]);
  await page.screenshot({ path: `${outDir}/pigs6-floor-${quality}.png` });
  await pose(page, [where.x + 0.2, 1.6, where.z + 2.3], [where.x, 1.5, where.z + 0.4]);
  await page.screenshot({ path: `${outDir}/pigs6-close-${quality}.png` });
  // the hall from its middle: draw calls with every island, against the budget
  await pose(page, [-22, 2.2, 1.5], [-22, 1.0, -12]);
  const calls = await callsNow(page);
  await page.screenshot({ path: `${outDir}/pigs6-hall-${quality}.png` });
  check(calls > 0 && calls <= 250, `${quality}: ${calls} draw calls over the slots hall (budget 250)`);
  check(errors.length === 0, `${quality}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await page.close();
}

// the prompt: walk up to a cabinet and the E prompt names it
{
  const { page, errors } = await open('quality=low');
  await page.evaluate(() => {
    const w = window.casino.world;
    const s = w.stations.find((x) => x.variant === 'pigs');
    const a = s.anchor.position;
    const d = s.footprint.depth / 2 + 0.7;
    w.teleport(a.x + Math.sin(s.yaw) * d, a.z + Math.cos(s.yaw) * d, s.yaw + Math.PI);
    const pl = w.life.seating.player;
    pl.camYaw = s.yaw;
    pl.camPitch = 0.3;
  });
  await page.waitForTimeout(800);
  const prompt = await page.evaluate(() => document.querySelector('.world-prompt:not([hidden])')?.textContent ?? '');
  await page.screenshot({ path: `${outDir}/pigs6-prompt.png` });
  check(/Straw, Sticks & Bricks/.test(prompt), `the E prompt in front of the machine: ${JSON.stringify(prompt)}`);
  check(errors.length === 0, `prompt: no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await page.close();
}

await browser.close();
console.log(failures ? `${failures} failed` : 'all ok');
process.exit(failures ? 1 : 0);
