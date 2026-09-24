#!/usr/bin/env node
// Headless checks for floor life on the dev page (Vite only, no server): the big-win sign over the
// pit and the day's meter from several places, an announcement in progress, attract mode on the
// slot floor, draw calls against the 250 budget, and no console errors.
// Usage: node scripts/e2e/features.mjs [port] [out dir] [views...]
//   views: front marquee north tally tallyback slots island announce idle low (default: all)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '5980', out = '/tmp/features', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const SIX = 'sevens,neon,wild,diamonds,cherries,goldrush';
const all = ['front', 'marquee', 'north', 'tally', 'tallyback', 'slots', 'island', 'announce', 'idle', 'low'];
const views = wanted.length ? wanted : all;
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || (m.type() === 'warning' && /attract mode/.test(m.text()))) && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`http://localhost:${port}/casino/src/ui/feed/dev.html?${query}`, { timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done') && window.casino?.life, null, { timeout: 300000 });
  return { page, errors };
}

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
    return { calls, frameMs: +((performance.now() - t0) / frames).toFixed(1) };
  });
}

for (const name of views) {
  const query =
    name === 'announce' ? `quality=high&stats=1&slots=${SIX}&view=front&win=1`
    : name === 'idle' ? `quality=high&stats=1&slots=${SIX}&view=marquee&wins=0`
    : name === 'low' ? `quality=low&stats=1&slots=${SIX}&view=front`
    : name === 'island' ? `quality=high&stats=1&slots=${SIX}&view=island&busy=slots-sevens-2`
    : `quality=high&stats=1&slots=${SIX}&view=${name}`;
  const { page, errors } = await open(query);
  await page.waitForTimeout(name === 'announce' ? 1600 : 1200);
  const s = await stats(page);
  const file = `${out}/features-${name}.png`;
  await page.screenshot({ path: file });
  if (name === 'announce') {
    // the name blinks, then the amount holds
    await page.waitForTimeout(2300);
    await page.screenshot({ path: `${out}/features-announce-amount.png` });
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `${out}/features-announce-line.png` });
  }
  if (name === 'island') {
    // a big win at a machine on this island: its lights go
    await page.evaluate(() => window.casino.life.attract.celebrate(window.casino.world.stations.find((s) => s.id === 'slots-sevens-1').id));
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/features-island-party.png` });
  }
  console.log(JSON.stringify({ view: name, file, ...s, errors: errors.slice(0, 3) }));
  if (s.calls > 250) fail(`${name}: ${s.calls} draw calls`);
  if (errors.length) fail(`${name}: ${errors[0]}`);
  await page.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
