#!/usr/bin/env node
// "Reduce flashing & motion", as a player meets it, each scene both ways:
//   switch   (game) the login screen's switch starts from the system's reduced-motion setting,
//            marks the page and is kept; logged in, the Settings row turns it on and off live
//   marquee  (feed dev page) a new win: the LED sign blinks the winner's name, or holds it lit
//            when calm; turning calm on mid-blink stops it at once
//   slots    (feed dev page) a slot machine celebrating a big win on the floor: its bulbs chase
//            and its candle flashes; calm, frame to frame the machine barely changes
//   pit      (table harness) a huge blackjack celebration: the banner, the light round the cards
//            and a shower of 28 chips; calm, the banner and light stay and 9 chips fall
//   fx       (dev floor) the shop's effects: confetti throws a third of the paper when calm; Disco
//            Night's ball turns slower and its points stop twinkling, measured frame to frame
// Usage: node scripts/e2e/comfort6.mjs [port] [outDir] [checks...]   (default: all)
//   marquee, slots and fx need Vite only; switch and pit the local worker too (PORT_BASE=<port> npm run dev).
//   GPU=1 draws on the machine's GPU. Fixed names (comfort6_e2e_*) with the dev password.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port = '6380', out = '/tmp/comfort6', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const checks = wanted.length ? wanted : ['switch', 'marquee', 'slots', 'pit', 'fx'];
const browser = await chromium.launch(process.env.GPU === '1' ? { channel: 'chromium', args: ['--ignore-gpu-blocklist'] } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const ok = (cond, what) => (cond ? console.log(`ok   ${what}`) : fail(what));
const watch = (p, errors) => {
  p.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push(String(e)));
};
const shot = (p, name) => p.screenshot({ path: `${out}/comfort6-${name}.png` });
const COMFORT = '/casino/src/app/comfort.ts';
/** Turn calm on or off in the page, through the same module the game uses. */
const setCalm = (p, on) => p.evaluate(async ([url, v]) => (await import(url)).setCalm(v), [COMFORT, on]);
const bodyCalm = (p) => p.evaluate(() => document.body.classList.contains('calm'));
const clearRate = () => execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', 'DELETE FROM casino_rate', '-c', 'server/wrangler.toml'], { stdio: 'pipe' });

async function page(url, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...opts.ctx });
  if (opts.calm !== undefined) await ctx.addInitScript((v) => localStorage.setItem('casino.calm', v ? '1' : '0'), opts.calm);
  const p = await ctx.newPage();
  const errors = [];
  watch(p, errors);
  await p.goto(`http://localhost:${port}${url}`, { timeout: 180_000 });
  return { p, ctx, errors };
}

/**
 * How much a patch of the screen round a world point changes from one frame to the next: the mean
 * per-pixel change in brightness (0-255) between frames `gap` ms apart, and the largest. Each
 * sample draws the frame and reads it straight back.
 */
const flicker = (p, point, size, n, gap) =>
  p.evaluate(
    async ([pt, px, count, ms]) => {
      const { engine, THREE } = window.casino;
      const r = engine.renderer;
      const gl = r.getContext();
      const v = new THREE.Vector3(...pt).project(engine.camera);
      const W = r.domElement.width;
      const H = r.domElement.height;
      const x = Math.max(0, Math.min(W - px, Math.round((v.x * 0.5 + 0.5) * W - px / 2)));
      const y = Math.max(0, Math.min(H - px, Math.round((v.y * 0.5 + 0.5) * H - px / 2)));
      const buf = new Uint8Array(px * px * 4);
      let prev = null;
      const steps = [];
      for (let i = 0; i < count; i++) {
        await new Promise((res) => setTimeout(res, ms));
        r.render(engine.scene, engine.camera);
        gl.readPixels(x, y, px, px, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const lum = new Float32Array(px * px);
        for (let k = 0; k < px * px; k++) lum[k] = 0.2126 * buf[k * 4] + 0.7152 * buf[k * 4 + 1] + 0.0722 * buf[k * 4 + 2];
        if (prev) {
          let d = 0;
          for (let k = 0; k < lum.length; k++) d += Math.abs(lum[k] - prev[k]);
          steps.push(d / lum.length);
        }
        prev = lum;
      }
      return { mean: steps.reduce((s, d) => s + d, 0) / steps.length, most: Math.max(...steps) };
    },
    [point, size, n, gap],
  );

// --- the switch: login screen and Settings ------------------------------------------------------

if (checks.includes('switch')) {
  clearRate();
  // no system preference: the switch starts off
  {
    const { p, ctx, errors } = await page('/casino/');
    await p.waitForSelector('.calm-switch', { timeout: 300_000 });
    ok((await p.getAttribute('.calm-switch', 'aria-checked')) === 'false' && !(await bodyCalm(p)), 'login: the switch starts off with no system preference');
    await shot(p, 'login-off');
    await p.click('.calm-switch');
    ok((await p.getAttribute('.calm-switch', 'aria-checked')) === 'true' && (await bodyCalm(p)), 'login: a click turns it on and marks the page');
    ok((await p.evaluate(() => localStorage.getItem('casino.calm'))) === '1', 'login: the choice is kept');
    await shot(p, 'login-on');
    await p.reload();
    await p.waitForSelector('.calm-switch', { timeout: 300_000 });
    ok((await p.getAttribute('.calm-switch', 'aria-checked')) === 'true' && (await bodyCalm(p)), 'login: still on after a reload');
    await p.click('.calm-switch');
    ok(!(await bodyCalm(p)), 'login: and off again');
    ok(errors.length === 0, `login: no errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // the system asks for reduced motion: it starts on
  {
    const { p, ctx, errors } = await page('/casino/', { ctx: { reducedMotion: 'reduce' } });
    await p.waitForSelector('.calm-switch', { timeout: 300_000 });
    ok((await p.getAttribute('.calm-switch', 'aria-checked')) === 'true' && (await bodyCalm(p)), 'login: on from the start when the system asks for reduced motion');
    // logged in: the Settings row
    await p.fill('.name-input', 'comfort6_e2e_a');
    await p.fill('.pass-input', 'casino-dev');
    await p.click('.enter-btn');
    await p.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60_000 });
    if (await p.$('.editor-panel.guided')) {
      await p.waitForTimeout(1500);
      for (let i = 0; i < 3; i++) {
        await p.click('.editor-panel .ed-buttons .btn.primary');
        await p.waitForTimeout(500);
      }
    } else await p.click('.menu-item >> nth=0');
    await p.waitForSelector('.hud', { timeout: 60_000 });
    await p.waitForTimeout(1500);
    // the HUD's gear (clicked in the page: the floor's canvas holds the pointer while it looks around)
    await p.evaluate(() => document.querySelector('.hud button[aria-label="Settings"]').click());
    const group = '.settings-sheet [role=radiogroup][aria-label="Reduce flashing & motion"]';
    await p.waitForSelector(group);
    ok((await p.getAttribute(`${group} [data-id=reduced]`, 'aria-checked')) === 'true', 'Settings: the row shows Reduced');
    await p.locator(group).scrollIntoViewIfNeeded();
    await shot(p, 'settings-reduced');
    await p.click(`${group} [data-id=full]`);
    ok(!(await bodyCalm(p)) && (await p.evaluate(() => localStorage.getItem('casino.calm'))) === '0', 'Settings: Full turns it off at once, and is kept');
    await p.click(`${group} [data-id=reduced]`);
    ok(await bodyCalm(p), 'Settings: Reduced turns it back on');
    await shot(p, 'settings-back');
    ok(errors.length === 0, `game: no errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
}

// --- the marquee over the pit ---------------------------------------------------------------------

/** The LED faces' on/off uniform, sampled every 40 ms for `ms`. */
const sampleSign = (p, ms) =>
  p.evaluate(async (dur) => {
    const u = window.casino.life.marquee.mesh.material.uniforms.uOn;
    const seen = [];
    const end = performance.now() + dur;
    while (performance.now() < end) {
      seen.push(u.value);
      await new Promise((r) => setTimeout(r, 40));
    }
    return seen;
  }, ms);

if (checks.includes('marquee')) {
  for (const calm of [false, true]) {
    const tag = calm ? 'calm' : 'full';
    const { p, ctx, errors } = await page('/casino/src/ui/feed/dev.html?view=marquee&quality=high', { calm });
    await p.waitForFunction(() => window.casino?.life, null, { timeout: 300_000 });
    await p.waitForTimeout(1500);
    ok((await bodyCalm(p)) === calm, `marquee (${tag}): the page is ${calm ? '' : 'not '}marked calm`);
    await p.evaluate(() => window.casino.win(0));
    await p.waitForTimeout(300);
    const seen = await sampleSign(p, 1900);
    const dark = seen.filter((v) => v === 0).length;
    if (calm) ok(dark === 0, `marquee (calm): the winner's name holds lit (${seen.length} samples, none dark)`);
    else ok(dark > 0 && dark < seen.length, `marquee (full): the winner's name blinks (${dark} of ${seen.length} samples dark)`);
    await shot(p, `marquee-${tag}`);
    if (!calm) {
      // turned on mid-blink: steady from the next frame (the sign's queue cleared, a fresh win told)
      await p.evaluate(() => {
        const m = window.casino.life.marquee;
        m.queue.length = 0;
        m.next();
        m.announce({ name: 'COMFORT6', money: '$1,000', detail: 'Blackjack' });
      });
      await p.waitForTimeout(250);
      await setCalm(p, true);
      await p.waitForTimeout(60);
      const after = await sampleSign(p, 1200);
      ok(after.every((v) => v === 1), 'marquee: calm turned on mid-blink stops it at once');
    }
    ok(errors.length === 0, `marquee (${tag}): no errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
}

// --- the slot floor: a machine celebrating a big win ----------------------------------------------

if (checks.includes('slots')) {
  const { p, ctx, errors } = await page('/casino/src/ui/feed/dev.html?view=island&quality=low', { calm: false });
  await p.waitForFunction(() => window.casino?.life, null, { timeout: 300_000 });
  await p.waitForTimeout(2000);
  // the machine nearest the camera that's in view
  const pick = await p.evaluate(() => {
    const { world, engine, THREE, life } = window.casino;
    engine.camera.updateMatrixWorld();
    const best = world.stations
      .filter((s) => s.game === 'slots')
      .map((s) => {
        // the middle of its bulb ring (the cabinet handle's instanced bulbs)
        let bulbs = null;
        s.model.traverse((o) => {
          const h = o.userData.slots ?? o.userData.slots2;
          if (!bulbs && h?.bulbs) bulbs = h.bulbs;
        });
        if (!bulbs) return { seen: false };
        bulbs.computeBoundingSphere();
        bulbs.updateWorldMatrix(true, false);
        const top = bulbs.boundingSphere.center.clone().applyMatrix4(bulbs.matrixWorld);
        const v = top.clone().project(engine.camera);
        return { id: s.id, top: [top.x, top.y, top.z], d: top.distanceTo(engine.camera.position), seen: Math.abs(v.x) < 0.7 && Math.abs(v.y) < 0.7 && v.z < 1 };
      })
      .filter((s) => s.seen)
      .sort((a, b) => a.d - b.d)[0];
    life.attract.celebrate(best.id);
    return best;
  });
  ok(!!pick, `slots: ${pick?.id} celebrates a big win`);
  await p.waitForTimeout(500);
  const full = await flicker(p, pick.top, 90, 16, 70);
  await shot(p, 'slots-full');
  await setCalm(p, true);
  await p.evaluate((id) => window.casino.life.attract.celebrate(id), pick.id);
  await p.waitForTimeout(500);
  const calm = await flicker(p, pick.top, 90, 16, 70);
  await shot(p, 'slots-calm');
  console.log(`     frame-to-frame change round the machine: full ${full.mean.toFixed(2)} (most ${full.most.toFixed(2)}), calm ${calm.mean.toFixed(2)} (most ${calm.most.toFixed(2)})`);
  ok(full.mean > 1, 'slots (full): the celebrating machine flashes and chases');
  ok(calm.mean < full.mean / 3, 'slots (calm): the same machine is at least three times steadier');
  // the party over (its clock run out): the island in plain attract mode, calm
  await p.evaluate(() => window.casino.life.attract.update(100));
  await p.waitForTimeout(400);
  await shot(p, 'slots-idle-calm');
  ok(errors.length === 0, `slots: no errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// --- the pit: a huge win at blackjack ---------------------------------------------------------------

if (checks.includes('pit')) {
  clearRate();
  for (const calm of [false, true]) {
    const tag = calm ? 'calm' : 'full';
    const { p, ctx, errors } = await page(`/casino/?dev=table&game=blackjack&name=comfort6_e2e_p${calm ? 2 : 1}`, { calm });
    await p.waitForSelector('.modal input[type=number]', { timeout: 300_000 });
    await p.fill('.modal input[type=number]', '500');
    await p.click('.modal .btn.primary');
    await p.waitForTimeout(2500);
    const chips = await p.evaluate(async (url) => {
      const { celebrate } = await import(url);
      const t = window.casino.table;
      const V = t.stage.root.position.constructor;
      // the dealer's rack side of the felt, in front of the player
      celebrate({ stage: t.stage, ui: t.ui, sfx: t.sfx }, { title: 'Blackjack', sub: 'Pays 3 to 2 · $750', tier: 'huge', at: new V(0, 0.79, 0.28) });
      await new Promise((r) => setTimeout(r, 450));
      let n = 0;
      t.stage.root.traverse((o) => {
        if (o.isInstancedMesh && o.geometry.type === 'CylinderGeometry' && Math.abs(o.geometry.parameters.radiusTop - 0.019) < 1e-6) n = o.count;
      });
      return n;
    }, '/casino/src/table/celebrate.ts');
    await shot(p, `pit-${tag}`);
    ok(chips === (calm ? 9 : 28), `pit (${tag}): ${chips} chips shower down`);
    ok(!!(await p.$('.celebrate.tier-huge')), `pit (${tag}): the banner stays`);
    ok(errors.length === 0, `pit (${tag}): no errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
}

// --- the shop's effects on the floor ----------------------------------------------------------------

/** The most pieces the named particle mesh shows over `ms`. */
const peak = (p, name, ms) =>
  p.evaluate(
    async ([n, dur]) => {
      let most = 0;
      const end = performance.now() + dur;
      while (performance.now() < end) {
        window.casino.engine.scene.traverse((o) => {
          if (o.name === n && o.isInstancedMesh) most = Math.max(most, o.count);
        });
        await new Promise((r) => setTimeout(r, 100));
      }
      return most;
    },
    [name, ms],
  );

if (checks.includes('fx')) {
  const { p, ctx, errors } = await page('/casino/src/world/dev-floor.html?quality=high', { calm: false });
  await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done') && window.casino?.fx, null, { timeout: 300_000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.casino.fx.play('fx-confetti'));
  const full = await peak(p, 'fx-confetti', 3000);
  await shot(p, 'confetti-full');
  await p.waitForTimeout(6000);
  await setCalm(p, true);
  await p.evaluate(() => window.casino.fx.play('fx-confetti'));
  const calm = await peak(p, 'fx-confetti', 3000);
  await shot(p, 'confetti-calm');
  ok(full > 0 && calm > 0 && calm <= Math.ceil(full / 3) + 2, `fx: confetti throws ${full} pieces, ${calm} when calm`);
  await p.waitForTimeout(8000);

  // Disco Night: the ball down and turning, then calm turned on while it plays
  await setCalm(p, false);
  await p.evaluate(() => window.casino.fx.play('fx-disco', { secs: 40 }));
  await p.waitForTimeout(6500);
  const centre = await p.evaluate(() => {
    const { engine, THREE } = window.casino;
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(engine.camera.quaternion).multiplyScalar(4).add(engine.camera.position);
    return [v.x, v.y, v.z];
  });
  const discoFull = await flicker(p, centre, 240, 12, 80);
  await shot(p, 'disco-full');
  await setCalm(p, true);
  await p.waitForTimeout(300);
  const discoCalm = await flicker(p, centre, 240, 12, 80);
  await shot(p, 'disco-calm');
  console.log(`     frame-to-frame change in the middle of the view: full ${discoFull.mean.toFixed(2)} (most ${discoFull.most.toFixed(2)}), calm ${discoCalm.mean.toFixed(2)} (most ${discoCalm.most.toFixed(2)})`);
  ok(discoCalm.mean < discoFull.mean / 2, 'fx: Disco Night is at least twice as steady when calm');
  ok(errors.length === 0, `fx: no errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
