#!/usr/bin/env node
// Close looks at the roulette wheel and table for judging the materials: the seated view, the wheel
// from three quarters and from above, the turret, the ball track and deflectors, the rail and chip
// rack, the felt, then a spin in the table's own camera (track, bounce, rest) and the ball in its
// pocket up close. Time is frozen for the close-ups so a slow renderer doesn't smear them.
//
// Usage: node scripts/e2e/roulette3.mjs [port] [outDir] [variant] [--gpu] [--floor] [--only=a,b] [--nospin]
//   --gpu     headed Chrome on the real GPU instead of headless SwiftShader
//   --floor   sit down at the floor's roulette table (the real lights and bloom) instead of the dev room

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.includes(`--${n}`);
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const [port = '5950', outDir = '/tmp/roulette3-shots', variant = 'american'] = args;
mkdirSync(outDir, { recursive: true });

const gpu = flag('gpu');
const browser = await chromium.launch(gpu ? { headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const floor = flag('floor');
const tag = (gpu ? 'gpu' : 'sw') + (floor ? '-floor' : '');
const shot = async (name) => {
  const path = `${outDir}/${variant}-${tag}-${name}.png`;
  await page.screenshot({ path });
  console.log('shot', path);
};
const until = (fn, timeout = 120000) => page.waitForFunction(fn, null, { timeout, polling: 50 });
const frames = (n = 3) => page.evaluate((k) => new Promise((res) => { let i = 0; const f = () => (++i >= k ? res(true) : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

if (floor) {
  await page.goto(`http://localhost:${port}/casino/`);
  await page.waitForSelector('.name-input', { timeout: 60000 });
  await page.fill('.name-input', 'rl3floor');
  await page.click('.enter-btn');
  await page.waitForSelector('.menu-item', { timeout: 20000 });
  await page.click('.menu-item >> nth=0');
  await page.waitForSelector('.hud', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, variant === 'american' ? 'rl-us' : 'rl-eu');
  await page.waitForSelector('.lobby', { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.keyboard.press('s');
} else {
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=roulette&variant=${variant}&name=rl3shots`);
}
// a table left open by an earlier run comes back seated, with no buy-in to answer
await page.waitForFunction(() => document.querySelector('.modal input[type=number]') || (window.casino?.table ?? window.casino?.app?.table?.session)?.view?.debug?.state().stack > 0, null, { timeout: 30000 });
if (await page.$('.modal input[type=number]')) {
  await page.fill('.modal input[type=number]', '2000');
  await page.click('.modal .btn.primary');
}
await page.evaluate(() => (window.__rv = () => (window.casino.table ?? window.casino.app?.table?.session)?.view));
await until(() => window.__rv()?.debug?.state().stack > 0, 20000);
await page.waitForTimeout(1200);
const info = await page.evaluate(() => ({ ms: window.casino.engine.frameMs(), calls: window.casino.engine.renderer.info.render.calls, tris: window.casino.engine.renderer.info.render.triangles, gl: (() => { const gl = window.casino.engine.renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })() }));
console.log('frame', JSON.stringify(info));
if (!only.length || only.includes('seated')) await shot('seated');

// camera helpers: poses are table-local (the dev room's table sits at the origin; on the floor the
// station's anchor places it)
const WX = -0.904;
const TY = 0.78;
const look = async (name, pos, target, fov = 55) => {
  if (only.length && !only.includes(name)) return;
  await page.evaluate(([p, t, f]) => {
    const e = window.casino.engine;
    const anchor = window.casino.app?.table?.station?.anchor;
    const V = e.camera.position.constructor;
    const w = (a) => (anchor ? anchor.localToWorld(new V(...a)) : new V(...a));
    e.timer.setTimescale(0);
    e.camera.fov = f;
    e.camera.updateProjectionMatrix();
    e.camera.position.copy(w(p));
    e.camera.lookAt(w(t));
    document.getElementById('ui').style.visibility = 'hidden';
    document.getElementById('labels').style.visibility = 'hidden';
  }, [pos, target, fov]);
  await frames(4);
  await shot(name);
};
const home = await page.evaluate(() => ({ p: window.casino.engine.camera.position.toArray(), q: window.casino.engine.camera.quaternion.toArray() }));
const restore = () => page.evaluate((h) => {
  const e = window.casino.engine;
  e.timer.setTimescale(1);
  e.camera.fov = 55;
  e.camera.updateProjectionMatrix();
  e.camera.position.fromArray(h.p);
  e.camera.quaternion.fromArray(h.q);
  document.getElementById('ui').style.visibility = '';
  document.getElementById('labels').style.visibility = '';
}, home);

await look('wheel34', [WX + 0.5, TY + 0.42, 0.52], [WX, TY + 0.03, 0], 45);
await look('wheeltop', [WX + 0.02, TY + 1.0, 0.14], [WX, TY, 0], 40);
await look('turret', [WX + 0.2, TY + 0.2, 0.21], [WX, TY + 0.06, 0], 40);
await look('track', [WX + 0.22, TY + 0.26, 0.22], [WX - 0.2, TY + 0.03, -0.18], 45);
await look('rimlow', [WX + 0.62, TY + 0.1, 0.36], [WX, TY + 0.04, 0], 35);
await look('rail', [0.1, TY + 0.28, 0.95], [-0.25, TY, 0.35], 50);
await look('rack', [WX + 0.55, TY + 0.45, 0.35], [WX + 0.5, TY, -0.4], 50);
await look('felt', [0.15, TY + 0.26, 0.42], [0.15, TY, 0.12], 45);
await restore();
await frames(2);

if (!flag('nospin')) {
  const click = async (key, chipKey) => {
    if (chipKey) await page.keyboard.press(chipKey);
    const p = await page.evaluate((k) => window.__rv().debug.screenOf(k), key);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  await click('straight:17', '2');
  await click('red', '3');
  await click('split:17-20', '1');
  await until(() => Object.keys(window.__rv().debug.state().bets).length >= 3, 15000);
  await page.mouse.move(700, 870);
  await shot('bets');
  await page.keyboard.press('Space');
  await until(() => window.__rv().debug.state().flight !== null, 15000);
  const f = await page.evaluate(() => window.__rv().debug.state().flight);
  await until(`window.__rv().debug.state().s >= ${f.tDrop - 1.2}`);
  await shot('spin-track');
  await until(`window.__rv().debug.state().s >= ${f.tEnter + 0.4}`);
  await shot('spin-bounce');
  await until(`window.__rv().debug.state().s >= ${f.tRest + 0.5}`);
  await shot('result');
  await until(() => !window.__rv().debug.state().animating, 90000);
  await page.waitForTimeout(400);
  await shot('settled');
  // the ball in its pocket, up close
  const ball = await page.evaluate(() => {
    const e = window.casino.engine;
    e.timer.setTimescale(0);
    const b = (window.casino.app?.table?.station?.anchor ?? e.scene).getObjectByName('roulette-ball');
    const p = b.getWorldPosition(new b.position.constructor());
    window.casino.app?.table?.station?.anchor.worldToLocal(p);
    return [p.x, p.y, p.z];
  });
  const dx = ball[0] - WX;
  const dz = ball[2];
  const d = Math.hypot(dx, dz) || 1;
  await look('ball', [ball[0] + (dx / d) * 0.13 + (dz / d) * 0.05, ball[1] + 0.11, ball[2] + (dz / d) * 0.13 - (dx / d) * 0.05], ball, 40);
  await restore();
}
console.log(JSON.stringify({ errors: errors.slice(0, 10) }, null, 1));
await browser.close();
