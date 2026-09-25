#!/usr/bin/env node
// Headless checks for the emotes: every gesture on both bodies (the men's and the women's rigs),
// standing and seated, frozen at chosen moments and shot from the front and the side, with the
// hands measured (the clap's palms must meet, 67's must be up); the wheel with its six, on a
// laptop and a phone. Vite only (the dev floor and the social dev page run without a server).
// Usage: node scripts/e2e/emotes.mjs [port] [out dir] [checks...]
//   checks: poses seated live (default: all; live needs the worker: PORT_BASE=<port> npm run dev)
// live: two players through the game proper. B watches A clap and do 67 (frozen at moments, from a
// camera placed in front of A), each hears the claps it should (A's own, B's only while A is near),
// and A sits at a blackjack table and waves: A's own bubble at the foot of the view, and B sees A
// do it in the chair.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6080', out = '/tmp/emotes', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const checks = wanted.length ? wanted : ['poses', 'seated', 'live'];
const quality = process.env.QUALITY ?? 'high';
const floorUrl = `http://localhost:${port}/casino/src/world/dev-floor.html`;
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
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

/** Moments to freeze each gesture at (seconds into it): a clap's hands meet at every third of a second. */
const MOMENTS = {
  wave: [0.5, 0.75],
  cheer: [0.2, 0.45],
  clap: [1 / 3, 0.5, 2 / 3, 5 / 6],
  thumbs: [0.35, 1.0],
  shrug: [0.9],
  sixseven: [0.47, 0.78, 1.1],
};
const EMOTES = Object.keys(MOMENTS);
const tag = (t) => t.toFixed(2).replace('.', '_');

/** Set up `window.casino.cast` (people to pose) and the helpers that freeze and measure them. */
async function castHelpers(page) {
  await page.evaluate(() => {
    const c = window.casino;
    const THREE = c.THREE;
    const HAND = /^(Wrist|Index\d|Middle\d|Ring\d|Pinky\d|Thumb\d)([RL])$/;
    /** Which hand each vertex belongs to (by the bone it mostly follows), per mesh. */
    const sides = new Map();
    const sideOf = (mesh) => {
      let s = sides.get(mesh);
      if (s) return s;
      const names = mesh.skeleton.bones.map((b) => b.name.replace(/\./g, ''));
      const si = mesh.geometry.getAttribute('skinIndex');
      const sw = mesh.geometry.getAttribute('skinWeight');
      s = new Array(si.count);
      for (let i = 0; i < si.count; i++) {
        let best = 0;
        for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
        const m = HAND.exec(names[si.getComponent(i, best)] ?? '');
        s[i] = m ? m[2] : null;
      }
      sides.set(mesh, s);
      return s;
    };
    /** The hands, skinned as posed now, in the character's frame: the gap between them along x (the right is on -x). */
    c.hands = (p) => {
      const mesh = p.mesh;
      p.root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(p.root.matrixWorld).invert();
      const s = sideOf(mesh);
      const v = new THREE.Vector3();
      let maxR = -Infinity;
      let minL = Infinity;
      const lo = { R: Infinity, L: Infinity };
      const hi = { R: -Infinity, L: -Infinity };
      for (let i = 0; i < s.length; i++) {
        if (!s[i]) continue;
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
        if (s[i] === 'R') maxR = Math.max(maxR, v.x);
        else minL = Math.min(minL, v.x);
        lo[s[i]] = Math.min(lo[s[i]], v.y);
        hi[s[i]] = Math.max(hi[s[i]], v.y);
      }
      return { gap: minL - maxR, yR: (lo.R + hi.R) / 2, yL: (lo.L + hi.L) / 2 };
    };
    /** Which way each palm faces now, in the character's frame (from the arm the emotes measured). */
    c.palms = (p) => {
      const q = p.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      const out = {};
      for (const side of ['R', 'L']) {
        const arm = p.arms[side];
        if (!arm) continue;
        const w = arm.wrist.getWorldQuaternion(new THREE.Quaternion()).premultiply(q);
        out[side] = arm.palm.clone().applyQuaternion(w).toArray().map((x) => +x.toFixed(2));
      }
      return out;
    };
    /** Freeze everyone at `t` seconds into `e`. */
    c.freeze = (e, t) => {
      for (const p of c.cast) {
        p.gesture(e);
        p.update(t);
      }
    };
  });
}

if (checks.includes('poses')) {
  const { page, errors } = await openFloor();
  await castHelpers(page);
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
    return z0;
  }, LOOKS);
  const names = LOOKS.map((l) => `${l.body}/${l.outfit}`);
  for (const e of EMOTES) {
    if (only && !only.includes(e)) continue;
    for (const t of MOMENTS[e]) {
      for (const [side, yaw] of [['front', 0], ['side', Math.PI / 2]]) {
        const m = await page.evaluate(([e, t, yaw]) => {
          const c = window.casino;
          for (const p of c.cast) p.root.rotation.y = yaw;
          c.freeze(e, t);
          return c.cast.map((p) => ({ ...c.hands(p), palms: c.palms(p) }));
        }, [e, t, yaw]);
        await place(page, [0, 1.3, z0 + 4.6], [0, 1.05, z0]);
        await frames(page);
        await page.screenshot({ path: `${out}/pose-${e}-${tag(t)}-${side}.png` });
        if (process.env.CLOSE) {
          // close up on the man in the suit and the woman in the dress
          for (const i of [0, 2]) {
            const x = -2.1 + i * 1.4;
            // (the people turn for the side view, not the camera)
            await place(page, [x, 1.35, z0 + 1.7], [x, 1.2, z0]);
            await frames(page, 2);
            await page.screenshot({ path: `${out}/close-${e}-${tag(t)}-${side}-${i}.png` });
          }
        }
        if (side !== 'front') continue;
        console.log(`${e} ${t.toFixed(2)}s: ${m.map((x, i) => `${names[i]} gap ${(x.gap * 100).toFixed(1)} cm, hands at ${x.yR.toFixed(2)}/${x.yL.toFixed(2)} m, palms R ${x.palms.R} L ${x.palms.L}`).join(' | ')}`);
        if (e === 'clap') {
          const meet = Math.abs(t * 3 - Math.round(t * 3)) < 0.01;
          for (const [i, x] of m.entries()) {
            if (meet && (x.gap > 0.02 || x.gap < -0.025)) fail(`clap ${t.toFixed(2)}s ${names[i]}: palms ${(x.gap * 100).toFixed(1)} cm apart when they should meet`);
            if (!meet && x.gap < 0.12) fail(`clap ${t.toFixed(2)}s ${names[i]}: hands only ${(x.gap * 100).toFixed(1)} cm apart between claps`);
          }
        }
        if (e === 'sixseven') {
          for (const [i, x] of m.entries()) {
            if (!(x.palms.R?.[1] > 0.8 && x.palms.L?.[1] > 0.8)) fail(`67 ${t.toFixed(2)}s ${names[i]}: palms not up (${x.palms.R} / ${x.palms.L})`);
          }
        }
      }
    }
  }
  if (errors.length) fail(`poses: ${errors.join(' | ')}`);
  await page.close();
}

if (checks.includes('seated')) {
  // Two players in the Hold'em chairs, drawn by the real RemotePlayers from a stand-in floor link
  // (as npcs.mjs does), frozen partway through each emote.
  const { page, errors } = await openFloor();
  await castHelpers(page);
  const st = await page.evaluate(async () => {
    const c = window.casino;
    const { seatWorld } = await import('/casino/src/world/stations.ts');
    const { RemotePlayers } = await import('/casino/src/world/remote-players.ts');
    const look = (body, outfit, skin, hair, top, bottom) => ({ v: 1, body, outfit, skin, hair, top, bottom, shoes: '#1a1a1a' });
    const players = new Map([
      [101, { info: { id: 101, name: 'Marisol', look: look('f', 'dress', 3, '#2b1a12', '#7a1f3d', '#7a1f3d'), at: { station: 'he-1' } }, track: { at: () => ({ x: 0, z: 0, r: 0, moving: false }) }, last: null }],
      [102, { info: { id: 102, name: 'Dev', look: look('m', 'suit', 1, '#4a3020', '#1f2430', '#1f2430'), at: { station: 'he-1' } }, track: { at: () => ({ x: 0, z: 0, r: 0, moving: false }) }, last: null }],
    ]);
    for (const p of players.values()) await c.world.characterFactory.load(p.info.look);
    const remotes = new RemotePlayers({ players, on: () => () => {} }, c.engine.scene, { factory: c.world.characterFactory, seatOf: (id, slot) => seatWorld(c.world.stations.find((x) => x.id === id), slot) });
    for (let i = 0; i < 5; i++) remotes.update(0.05);
    c.cast = [remotes.character(101), remotes.character(102)];
    const s = c.world.stations.find((x) => x.id === 'he-1');
    return { x: s.anchor.position.x, z: s.anchor.position.z };
  });
  for (const e of ['clap', 'sixseven', 'wave', 'cheer', 'thumbs', 'shrug']) {
    if (only && !only.includes(e)) continue;
    const t = e === 'clap' ? 1 / 3 : e === 'sixseven' ? 0.47 : 0.9;
    const m = await page.evaluate(([e, t]) => {
      const c = window.casino;
      c.freeze(e, t);
      return c.cast.map((p) => ({ ...c.hands(p), palms: c.palms(p) }));
    }, [e, t]);
    await place(page, [st.x - 2.3, 1.55, st.z + 2.6], [st.x - 0.2, 0.8, st.z + 0.1]);
    await frames(page);
    await page.screenshot({ path: `${out}/seated-${e}.png` });
    await place(page, [st.x - 2.6, 1.1, st.z + 0.9], [st.x - 0.9, 0.85, st.z + 0.55]);
    await frames(page);
    await page.screenshot({ path: `${out}/seated-${e}-side.png` });
    console.log(`seated ${e} ${t.toFixed(2)}s: ${m.map((x) => `gap ${(x.gap * 100).toFixed(1)} cm, hands at ${x.yR.toFixed(2)}/${x.yL.toFixed(2)} m, palms ${x.palms.R} / ${x.palms.L}`).join(' | ')}`);
    if (e === 'clap' && m.some((x) => Math.abs(x.gap) > 0.025)) fail('seated clap: the palms do not meet');
    if (e === 'sixseven' && m.some((x) => !(x.palms.R[1] > 0.8 && x.palms.L[1] > 0.8))) fail('seated 67: palms not up');
  }
  if (errors.length) fail(`seated: ${errors.join(' | ')}`);
  await page.close();
}

if (checks.includes('live')) {
  const name = process.env.TAG ?? 'e2e';
  async function player(who) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
    const page = await ctx.newPage();
    page.setDefaultTimeout(300000);
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://localhost:${port}/casino/`);
    await page.waitForSelector('.name-input', { timeout: 300000 });
    await page.fill('.name-input', who);
    if (await page.$('.pass-input')) await page.fill('.pass-input', 'casino-dev');
    await page.click('.enter-btn');
    // A first visit picks a look (three steps) and walks in; a later one enters from the menu.
    await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60000 });
    if (await page.$('.editor-panel.guided')) {
      for (let i = 0; i < 3; i++) {
        await page.click('.editor-panel .ed-buttons .btn.primary');
        await page.waitForTimeout(500);
      }
    } else {
      await page.click('.menu-item >> nth=0');
    }
    await page.waitForSelector('.hud');
    // anything that greets you on arrival (the daily bonus) is put away: it holds the keyboard
    await page.waitForTimeout(1500);
    for (let i = 0; i < 3; i++) {
      const held = await page.evaluate(async () => (await import('/casino/src/ui/keyboard.ts')).overlayCount());
      if (!held) break;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    await page.evaluate(async () => {
      const c = window.casino;
      // every clap the floor plays, and whether it came from somewhere (someone else's)
      const m = await import('/casino/src/audio/claps.ts');
      window.clapCalls = [];
      const play = m.Claps.prototype.play;
      m.Claps.prototype.play = function (times, at) {
        window.clapCalls.push({ n: times.length, from: at ? [at.x, at.z].map((v) => +v.toFixed(1)) : null });
        return play.call(this, times, at);
      };
      // hold a character at a moment of its emote (frames go by with no time passing for it)
      window.hold = (ch, e, t) => {
        if (!ch.heldUpdate) {
          const update = ch.update.bind(ch);
          ch.heldUpdate = true;
          ch.update = (dt) => update(ch.held ? 0 : dt);
        }
        ch.held = true;
        ch.gesture(e);
        ch.act.t = t;
      };
      window.release = (ch) => (ch.held = false);
      window.shot = null;
      c.engine.onFrame(() => {
        if (!window.shot) return;
        c.engine.camera.position.set(...window.shot.pos);
        c.engine.camera.lookAt(...window.shot.at);
      });
    });
    const id = await page.evaluate(() => window.casino.session.profile.id);
    return { page, id, errors };
  }
  const settle = (p, n = 4) => frames(p.page, n);
  const a = await player(`emo_al_${name}`);
  const b = await player(`emo_bo_${name}`);
  await a.page.waitForFunction((id) => window.casino.app.remotes?.drawn?.has(id), b.id);
  await b.page.waitForFunction((id) => window.casino.app.remotes?.drawn?.has(id), a.id);
  const facing = async (yaw) => {
    await a.page.evaluate((y) => window.casino.world.teleport(0.5, 9.4, y), yaw);
    await b.page.waitForFunction((id) => Math.abs((window.casino.app.remotes.character(id)?.root.position.z ?? 0) - 9.4) < 0.05, a.id, { timeout: 20000 }).catch(() => {});
    await b.page.waitForTimeout(900);
  };
  const remoteHold = (e, t) => b.page.evaluate(([id, e, t]) => window.hold(window.casino.app.remotes.character(id), e, t), [a.id, e, t]);
  const ownHold = (e, t) => a.page.evaluate(([e, t]) => window.hold(window.casino.world.player.character, e, t), [e, t]);
  const emote = async (e) => {
    const before = await b.page.evaluate(() => document.querySelectorAll('#labels .emote-bubble').length);
    await a.page.evaluate((x) => window.casino.app.link.emote(x), e);
    await b.page.waitForFunction((n) => document.querySelectorAll('#labels .emote-bubble').length > n || document.querySelectorAll('#labels .emote-bubble').length > 0, before, { timeout: 10000 });
  };
  // B's camera close in front of A (A faces +z at yaw 0)
  await b.page.evaluate(() => (window.shot = { pos: [0.5, 1.45, 11.6], at: [0.5, 1.15, 9.4] }));
  await facing(0);

  await emote('clap');
  for (const [t, label] of [[1 / 3, 'meet'], [0.5, 'open']]) {
    await remoteHold('clap', t);
    await ownHold('clap', t);
    await settle(b);
    await b.page.screenshot({ path: `${out}/live-remote-clap-${label}.png` });
    await settle(a);
    await a.page.screenshot({ path: `${out}/live-own-clap-${label}.png` });
  }
  await facing(Math.PI / 2);
  await remoteHold('clap', 1 / 3);
  await settle(b);
  await b.page.screenshot({ path: `${out}/live-remote-clap-meet-side.png` });
  await remoteHold('clap', 0.5);
  await settle(b);
  await b.page.screenshot({ path: `${out}/live-remote-clap-open-side.png` });
  const heard = { a: await a.page.evaluate(() => window.clapCalls.slice()), b: await b.page.evaluate(() => window.clapCalls.slice()) };
  console.log(`claps heard near: A ${JSON.stringify(heard.a)} B ${JSON.stringify(heard.b)}`);
  if (!(heard.a.length === 1 && heard.a[0].from === null && heard.a[0].n === 5)) fail('A does not hear its own five claps (from right here)');
  if (!(heard.b.length === 1 && heard.b[0].from !== null && heard.b[0].n === 5)) fail("B does not hear A's claps from where A stands");

  await b.page.waitForTimeout(2200);
  await facing(0);
  await emote('sixseven');
  for (const [t, label] of [[0.47, 'a'], [0.78, 'b']]) {
    await remoteHold('sixseven', t);
    await ownHold('sixseven', t);
    await settle(b);
    await b.page.screenshot({ path: `${out}/live-remote-67-${label}.png` });
    await settle(a);
    await a.page.screenshot({ path: `${out}/live-own-67-${label}.png` });
  }
  await facing(Math.PI / 2);
  await remoteHold('sixseven', 0.47);
  await settle(b);
  await b.page.screenshot({ path: `${out}/live-remote-67-side.png` });
  await b.page.evaluate((id) => window.release(window.casino.app.remotes.character(id)), a.id);
  await a.page.evaluate(() => window.release(window.casino.world.player.character));

  // Far off: B hears nothing of it, A still hears its own.
  await b.page.waitForTimeout(2200);
  await a.page.evaluate(() => window.casino.world.teleport(0.5, -8, 0));
  await b.page.waitForFunction((id) => window.casino.app.remotes.character(id)?.root.position.z < -7, a.id, { timeout: 20000 }).catch(() => {});
  await a.page.evaluate(() => window.casino.app.link.emote('clap'));
  await b.page.waitForTimeout(1500);
  const far = { a: await a.page.evaluate(() => window.clapCalls.length), b: await b.page.evaluate(() => window.clapCalls.length) };
  console.log(`claps heard far: A ${far.a} B ${far.b}`);
  if (far.a !== 2) fail("A's own clap from far off was not heard by A");
  if (far.b !== 1) fail(`B heard A's claps from ${(16 + 8).toFixed(0)} m away`);

  // At a table: A sits at blackjack and waves.
  await b.page.waitForTimeout(2200);
  await a.page.evaluate(() => window.casino.world.teleport(0, 12.8, Math.PI));
  await a.page.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === 'bj-1'));
  });
  await a.page.waitForSelector('.lobby-choice', { timeout: 20000 });
  await a.page.keyboard.press('s');
  await a.page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
  await a.page.fill('.modal input[type=number]', '500');
  await a.page.click('.modal .btn.primary');
  await a.page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30000 });
  await a.page.waitForTimeout(1500);
  // G opens the wheel at the table too; 1 waves
  await a.page.keyboard.press('g');
  await a.page.waitForSelector('.emo-wheel');
  await a.page.screenshot({ path: `${out}/live-own-table-wheel.png` });
  await a.page.keyboard.press('1');
  await a.page.waitForSelector('.emote-own .emote-bubble', { timeout: 10000 });
  // (software rendering: the pop can start a second late)
  await a.page.waitForFunction(() => getComputedStyle(document.querySelector('.emote-own .emote-bubble')).opacity === '1', null, { timeout: 10000 });
  await a.page.screenshot({ path: `${out}/live-own-table-wave.png` });
  const seat = await b.page.waitForFunction((id) => {
    const ch = window.casino.app.remotes.character(id);
    return ch?.root.visible && window.casino.app.link.players.get(id)?.info.at?.station === 'bj-1' ? [ch.root.position.x, ch.root.position.y, ch.root.position.z, ch.root.rotation.y] : null;
  }, a.id, { timeout: 20000 }).then((h) => h.jsonValue()).catch(() => null);
  if (!seat) fail('B does not see A seated at the blackjack table');
  else {
    const [x, y, z, yaw] = seat;
    await b.page.evaluate(([x, z, yaw]) => (window.shot = { pos: [x + Math.sin(yaw) * 1.9 + Math.cos(yaw) * 0.9, 1.5, z + Math.cos(yaw) * 1.9 - Math.sin(yaw) * 0.9], at: [x, 1.0, z] }), [x, z, yaw]);
    await remoteHold('wave', 0.9);
    await settle(b);
    await b.page.screenshot({ path: `${out}/live-remote-seated-wave.png` });
    await remoteHold('clap', 1 / 3);
    await settle(b);
    await b.page.screenshot({ path: `${out}/live-remote-seated-clap.png` });
  }
  for (const p of [a, b]) if (p.errors.length) fail(`live: ${p.errors.slice(0, 5).join(' | ')}`);
  await a.page.context().close();
  await b.page.context().close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all emotes checks passed');
process.exit(failed ? 1 : 0);
