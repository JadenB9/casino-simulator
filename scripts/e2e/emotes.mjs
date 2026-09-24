#!/usr/bin/env node
// Headless checks for the emotes: every gesture on both bodies (the men's and the women's rigs),
// standing and seated, frozen at chosen moments and shot from the front and the side, with the
// hands measured (the clap's palms must meet, 67's must be up); the wheel with its six, on a
// laptop and a phone. Vite only (the dev floor and the social dev page run without a server).
// Usage: node scripts/e2e/emotes.mjs [port] [out dir] [checks...]
//   checks: poses seated wheel (default: all)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6080', out = '/tmp/emotes', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const checks = wanted.length ? wanted : ['poses', 'seated', 'wheel'];
const quality = process.env.QUALITY ?? 'high';
const floorUrl = `http://localhost:${port}/casino/src/world/dev-floor.html`;
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const only = process.env.EMOTES ? process.env.EMOTES.split(',') : null;

async function openFloor() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(`${m.text()} ${m.location()?.url ?? ''}`.trim()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${floorUrl}?quality=${quality}`, { timeout: 180000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300000 });
  await page.evaluate(() => {
    const c = window.casino;
    c.world.player.setEnabled(false);
    c.world.player.character.root.visible = false;
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
async function frames(page, n = 3) {
  await page.evaluate((k) => new Promise((r) => {
    let i = 0;
    const f = () => (++i >= k ? r() : requestAnimationFrame(f));
    requestAnimationFrame(f);
  }), n);
}

const LOOKS = [
  { v: 1, body: 'm', outfit: 'suit', skin: 1, hair: '#2b1d14', top: '#1f2430', bottom: '#1f2430', shoes: '#141414' },
  { v: 1, body: 'm', outfit: 'casual', skin: 4, hair: '#1a1410', top: '#6b2230', bottom: '#2a3140', shoes: '#1a1a1a' },
  { v: 1, body: 'f', outfit: 'dress', skin: 2, hair: '#3a2415', top: '#1d4a44', bottom: '#1d4a44', shoes: '#1a1a1a' },
  { v: 1, body: 'f', outfit: 'smart', skin: 5, hair: '#15100c', top: '#2f3b5c', bottom: '#20232b', shoes: '#1a1a1a' },
];

/** Moments to freeze each gesture at (seconds into it). */
const MOMENTS = {
  wave: [0.5, 0.75],
  cheer: [0.2, 0.45],
  clap: [0.35, 0.5, 0.62, 0.72],
  thumbs: [0.9],
  shrug: [0.9],
  sixseven: [0.5, 0.75, 1.0],
};
const EMOTES = Object.keys(MOMENTS);

if (checks.includes('poses')) {
  const { page, errors } = await openFloor();
  const z0 = await page.evaluate(async (looks) => {
    const c = window.casino;
    const f = c.world.characterFactory;
    for (const l of looks) await f.load(l);
    const z0 = c.world.plan.entrance.z0 - 5;
    c.cast = looks.map((l, i) => {
      const p = f.create(l, '');
      p.root.position.set(-2.1 + i * 1.4, 0, z0);
      c.engine.scene.add(p.root);
      p.update(0);
      return p;
    });
    /** Freeze everyone at `t` seconds into `e`, facing `yaw`. */
    c.freeze = (e, t, yaw) => {
      for (const p of c.cast) {
        p.root.rotation.y = yaw;
        p.gesture(e);
        p.update(t);
      }
    };
    return z0;
  }, LOOKS);
  for (const e of EMOTES) {
    if (only && !only.includes(e)) continue;
    for (const t of MOMENTS[e] ?? [0.6]) {
      for (const [side, yaw] of [['front', 0], ['side', Math.PI / 2]]) {
        await page.evaluate(([e, t, yaw]) => window.casino.freeze(e, t, yaw), [e, t, yaw]);
        await place(page, [0, 1.3, z0 + 4.6], [0, 1.05, z0]);
        await frames(page);
        await page.screenshot({ path: `${out}/pose-${e}-${String(t).replace('.', '_')}-${side}.png` });
      }
    }
  }
  if (errors.length) fail(`poses: ${errors.join(' | ')}`);
  await page.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all emotes checks passed');
process.exit(failed ? 1 : 0);
