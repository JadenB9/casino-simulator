#!/usr/bin/env node
// Headless checks for the v6 emotes: every emote the boutique sells or a feat gives, acted out by
// both bodies, from the front and from the side, frozen at moments through it (the two on the left
// face the camera, the two on the right are turned side-on), standing and seated; measurements that
// say each one is what it's named (the feet stay on the floor, a backflip goes over and lands, the
// moonwalk goes backwards, the throw it back is bent over with the hands on the knees, the props
// are in hand); and the wheel with all sixteen, owned and locked, on a laptop and a phone.
// Vite only for poses/seated/wheel (the dev floor and the social dev page run without a server);
// live needs the worker (PORT_BASE=<port> npm run dev).
// Usage: node scripts/e2e/emotes6.mjs [port] [out dir] [checks...]
//   checks: poses seated riding wheel live (default: all)
//   EMOTES=throwback,backflip limits the poses; CLOSE=1 adds close-ups; GPU=1 draws on the GPU.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [port = '6250', out = '/tmp/emotes6', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const checks = wanted.length ? wanted : ['poses', 'seated', 'riding', 'wheel', 'live'];
const quality = process.env.QUALITY ?? 'high';
const floorUrl = `http://localhost:${port}/casino/src/world/dev-floor.html`;
const browser = await chromium.launch(
  process.env.GPU === '1'
    ? { channel: 'chromium', args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] }
    : { channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] },
);
let failed = 0;
const fail = (what) => {
  failed++;
  console.log(`FAIL ${what}`);
};
const only = process.env.EMOTES ? process.env.EMOTES.split(',') : null;

/** Moments to freeze each emote at (seconds into it). */
const MOMENTS = {
  throwback: [0.6, 0.72, 1.9],
  griddy: [0.25, 0.75, 1.25, 3.0],
  floss: [0.25, 0.5, 0.75],
  dab: [0.9],
  robot: [0.3, 0.8, 1.8, 2.3, 2.8],
  backflip: [0.3, 0.55, 0.72, 0.8, 0.92, 1.05, 1.25, 1.9],
  moneyfan: [0.6, 1.8],
  bow: [1.2],
  trophy: [0.4, 1.5],
  moonwalk: [0.7, 1.2, 1.7, 2.9, 3.6],
};
const EMOTES = Object.keys(MOMENTS).filter((e) => !only || only.includes(e));
const tag = (t) => t.toFixed(2).replace('.', '_');

const LOOKS = [
  { v: 1, body: 'm', outfit: 'suit', skin: 1, hair: '#2b1d14', top: '#1f2430', bottom: '#1f2430', shoes: '#141414' },
  { v: 1, body: 'f', outfit: 'dress', skin: 2, hair: '#3a2415', top: '#1d4a44', bottom: '#1d4a44', shoes: '#1a1a1a' },
];

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
    const THREE = c.THREE;
    /** Where the body is, as posed now, in the character's own frame: lowest and highest vertex, feet, hands, head. */
    c.measure = (p) => {
      const mesh = p.mesh;
      p.root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(p.root.matrixWorld).invert();
      const v = new THREE.Vector3();
      const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
      const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      const n = mesh.geometry.getAttribute('position').count;
      for (let i = 0; i < n; i += 3) {
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
        lo.min(v);
        hi.max(v);
      }
      const at = (name) => {
        const o = p.model.getObjectByName(name);
        return o ? o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : null;
      };
      const r = (w) => w && w.toArray().map((x) => +x.toFixed(2));
      return { lo: r(lo), hi: r(hi), footR: r(at('FootR')), footL: r(at('FootL')), handR: r(at('WristR')), handL: r(at('WristL')), kneeR: r(at('LowerLegR')), kneeL: r(at('LowerLegL')), head: r(at('Head')), hips: r(at('Body')), up: r(new THREE.Vector3(0, 1, 0).applyQuaternion(p.model.quaternion)), fwd: r(new THREE.Vector3(0, 0, 1).applyQuaternion(p.model.quaternion)), prop: p.prop ? { id: p.prop.id, at: r(p.prop.mesh.position), scale: +p.prop.mesh.scale.x.toFixed(2) } : null };
    };
    /** Freeze everyone at `t` seconds into `e`: start it over and run it there in small steps (so a stop resets nothing). */
    c.freeze = (e, t) => {
      for (const p of c.cast) {
        p.gesture(e);
        let left = t;
        while (left > 1e-6) {
          const dt = Math.min(1 / 30, left);
          p.update(dt);
          left -= dt;
        }
        p.update(0);
      }
    };
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

if (checks.includes('poses')) {
  const { page, errors } = await openFloor();
  const z0 = await page.evaluate(async (looks) => {
    const c = window.casino;
    const f = c.world.characterFactory;
    for (const l of looks) await f.load(l);
    const z0 = c.world.plan.entrance.z0 - 5;
    // the man and the woman facing the camera, then the same two turned side-on
    c.cast = [0, 1, 0, 1].map((li, i) => {
      const p = f.create(looks[li], '');
      p.root.position.set(-2.4 + i * 1.6, 0, z0);
      p.root.rotation.y = i < 2 ? 0 : Math.PI / 2;
      c.engine.scene.add(p.root);
      p.update(0);
      return p;
    });
    return z0;
  }, LOOKS);
  const names = ['m front', 'f front', 'm side', 'f side'];
  for (const e of EMOTES) {
    for (const t of MOMENTS[e]) {
      const m = await page.evaluate(([e, t]) => {
        const c = window.casino;
        c.freeze(e, t);
        return c.cast.map((p) => c.measure(p));
      }, [e, t]);
      await place(page, [0, 1.25, z0 + 6.4], [0, 0.95, z0]);
      await frames(page);
      await page.screenshot({ path: `${out}/pose-${e}-${tag(t)}.png` });
      if (process.env.CLOSE) {
        for (const i of [0, 1, 2, 3]) {
          const x = -2.4 + i * 1.6;
          await place(page, [x, 1.2, z0 + 2.6], [x, 0.95, z0]);
          await frames(page, 2);
          await page.screenshot({ path: `${out}/close-${e}-${tag(t)}-${i}.png` });
        }
      }
      console.log(`${e} ${t.toFixed(2)}s:`);
      for (const [i, x] of m.slice(0, 2).entries()) console.log(`  ${names[i]}: ${JSON.stringify(x)}`);
      judge(e, t, m, names);
    }
    // it ends where it started: standing, upright, at the origin, nothing in hand
    const end = await page.evaluate((e) => {
      const c = window.casino;
      const dur = { throwback: 4, griddy: 4.4, floss: 3.5, dab: 1.8, robot: 4, backflip: 2.1, moneyfan: 3.4, bow: 2.6, trophy: 3.4, moonwalk: 4.2 }[e];
      c.freeze(e, dur + 0.1);
      return c.cast.map((p) => ({ ...c.measure(p), act: p.act, pos: p.model.position.toArray().map((v) => +v.toFixed(3)) }));
    }, e);
    for (const [i, x] of end.entries()) {
      if (x.act) fail(`${e} ${names[i]}: still playing after its time`);
      if (x.prop) fail(`${e} ${names[i]}: prop still in hand after it ended`);
      if (Math.abs(x.pos[0]) > 0.001 || Math.abs(x.pos[2]) > 0.001 || x.up[1] < 0.999) fail(`${e} ${names[i]}: body not back in place (${x.pos} up ${x.up})`);
    }
    // walking off fades a dance out (not in a backflip's air): gone in a third of a second, the body home
    const walked = await page.evaluate((e) => {
      const c = window.casino;
      c.freeze(e, 1.5);
      const p = c.cast[0];
      const glideAt = p.model.position.z;
      p.setMotion(1);
      const mid = [];
      for (let i = 0; i < 12; i++) {
        p.update(1 / 30);
        mid.push(+p.model.position.z.toFixed(3));
      }
      p.setMotion(0);
      for (let i = 0; i < 30; i++) p.update(1 / 30);
      return { glideAt: +glideAt.toFixed(3), act: !!p.act, z: +p.model.position.z.toFixed(3), mid };
    }, e);
    if (['throwback', 'griddy', 'floss', 'robot', 'moonwalk'].includes(e)) {
      if (walked.act || Math.abs(walked.z) > 0.001) fail(`${e}: walking off did not end it (${JSON.stringify(walked)})`);
      // no snap: each frame of the fade moves the body a little
      const steps = walked.mid.map((z, i) => Math.abs(z - (i ? walked.mid[i - 1] : walked.glideAt)));
      if (Math.max(...steps) > 0.12) fail(`${e}: the body jumps as it fades (${walked.mid})`);
    }
  }
  const props = await page.evaluate(async () => (await import('/casino/src/world/emote-props.ts')).propsOut());
  if (props !== 0) fail(`poses: ${props} prop kit(s) still built with nobody holding one`);
  if (errors.length) fail(`poses: ${errors.join(' | ')}`);
  await page.close();
}

/** What each emote must be at a moment, from the measurements. */
function judge(e, t, m, names) {
  for (const [i, x] of m.entries()) {
    const who = `${e} ${t.toFixed(2)}s ${names[i]}`;
    const floorY = x.lo[1];
    const flying = e === 'backflip' && t > 0.46 && t < 1.14;
    if (!flying && floorY < -0.03) fail(`${who}: through the floor (${floorY})`);
    if (!flying && !['moneyfan', 'trophy', 'dab'].includes(e) && floorY > 0.05 && !(e === 'moonwalk' && t > 3.3)) fail(`${who}: feet off the floor (${floorY})`);
    if (e === 'throwback') {
      if (!(x.head[1] < 1.3)) fail(`${who}: not bent over (head at ${x.head[1]})`);
      // behind the feet, along the way the (turned) body faces
      const back = (x.hips[0] - (x.footR[0] + x.footL[0]) / 2) * x.fwd[0] + (x.hips[2] - (x.footR[2] + x.footL[2]) / 2) * x.fwd[2];
      if (!(back < -0.12)) fail(`${who}: hips not pushed back behind the feet (${back.toFixed(2)})`);
      const reachR = Math.hypot(x.handR[0] - x.kneeR[0], x.handR[1] - x.kneeR[1], x.handR[2] - x.kneeR[2]);
      if (reachR > 0.22) fail(`${who}: right hand ${reachR.toFixed(2)} m from the knee`);
    }
    if (e === 'backflip') {
      if (t > 0.72 && t < 0.88 && !(x.up[1] < 0.2)) fail(`${who}: not over by now (up ${x.up})`);
      if (t > 0.6 && t < 1.0 && !(floorY > 0.15)) fail(`${who}: not off the floor mid-flip (${floorY})`);
      if (t >= 1.25 && x.up[1] < 0.999) fail(`${who}: not landed upright (up ${x.up})`);
    }
    if (e === 'moonwalk' && t > 1 && t < 2.7 && !(x.hips[2] < -0.15)) fail(`${who}: not gliding back (${x.hips[2]})`);
    if (e === 'moneyfan' || e === 'trophy') {
      if (!x.prop || x.prop.scale < 0.95) fail(`${who}: nothing in hand`);
    }
    if (e === 'trophy' && t > 1 && !(x.prop?.at[1] > 1.7)) fail(`${who}: the cup is not over the head (${x.prop?.at})`);
    if (e === 'griddy' && t > 2.5 && !(x.handR[1] > 1.35 && x.handL[1] > 1.35)) fail(`${who}: hands not up at the eyes`);
    if (e === 'dab' && !(x.handR[1] > 1.5 && x.handR[0] < -0.4)) fail(`${who}: the right arm is not flung out and up (${x.handR})`);
  }
}

if (checks.includes('seated')) {
  // Two players in the Hold'em chairs, drawn by the real RemotePlayers from a stand-in floor link.
  const { page, errors } = await openFloor();
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
    c.seatedAt = c.cast.map((p) => p.root.position.clone());
    const s = c.world.stations.find((x) => x.id === 'he-1');
    return { x: s.anchor.position.x, z: s.anchor.position.z };
  });
  const SEATED = { throwback: 0.6, griddy: 3.0, floss: 0.5, dab: 0.9, robot: 1.8, backflip: 0.8, moneyfan: 1.8, bow: 1.2, trophy: 1.5, moonwalk: 1.2 };
  for (const e of EMOTES) {
    const m = await page.evaluate(([e, t]) => {
      const c = window.casino;
      c.freeze(e, t);
      return c.cast.map((p, i) => ({ ...c.measure(p), moved: +p.root.position.distanceTo(c.seatedAt[i]).toFixed(3), model: p.model.position.toArray().map((v) => +v.toFixed(3)), up: p.model.quaternion.w }));
    }, [e, SEATED[e]]);
    await place(page, [st.x - 2.3, 1.55, st.z + 2.6], [st.x - 0.2, 0.8, st.z + 0.1]);
    await frames(page);
    await page.screenshot({ path: `${out}/seated-${e}.png` });
    for (const [i, x] of m.entries()) {
      // nothing below the waist moves on a chair, and the body stays in it
      if (x.moved > 0.001 || Math.abs(x.model[0]) > 0.001 || Math.abs(x.model[2]) > 0.001 || Math.abs(x.up) < 0.9999) fail(`seated ${e} ${i}: the body left the chair (${JSON.stringify(x)})`);
    }
    console.log(`seated ${e}: ${m.map((x) => `hands ${x.handR} / ${x.handL}, head ${x.head}`).join(' | ')}`);
  }
  if (errors.length) fail(`seated: ${errors.join(' | ')}`);
  await page.close();
}

if (checks.includes('riding')) {
  // On a ride (looks6's stances): a skateboard side-on and a scooter at its bar. Each emote is the
  // upper-body version on top of the stance, the feet stay on the deck and the body on the ride.
  const { page, errors } = await openFloor();
  const z0 = await page.evaluate(async (looks) => {
    const c = window.casino;
    const f = c.world.characterFactory;
    const z0 = c.world.plan.entrance.z0 - 5;
    const rides = ['skateboard', 'e-scooter'];
    c.cast = [];
    for (const [i, ride] of rides.entries()) {
      const look = { ...looks[i], ride };
      await f.load(look);
      const p = f.create(look, '');
      p.root.position.set(-0.9 + i * 1.8, 0, z0);
      c.engine.scene.add(p.root);
      p.update(0);
      c.cast.push(p);
    }
    return z0;
  }, LOOKS);
  for (const [e, t] of [['throwback', 0.6], ['backflip', 0.8], ['trophy', 1.5], ['dab', 0.9], ['moneyfan', 1.8], ['moonwalk', 1.2]]) {
    if (only && !only.includes(e)) continue;
    const m = await page.evaluate(([e, t]) => {
      const c = window.casino;
      const before = c.cast.map((p) => p.model.position.toArray());
      c.freeze(e, t);
      return c.cast.map((p, i) => ({ riding: p.riding, pos: p.model.position.toArray().map((v) => +v.toFixed(3)), before: before[i].map((v) => +v.toFixed(3)), prop: !!p.prop }));
    }, [e, t]);
    await place(page, [0, 1.35, z0 + 4.2], [0, 1.0, z0]);
    await frames(page);
    await page.screenshot({ path: `${out}/riding-${e}.png` });
    for (const [i, x] of m.entries()) {
      if (!x.riding) fail(`riding ${e} ${i}: not on the ride`);
      if (Math.abs(x.pos[0] - x.before[0]) > 0.001 || Math.abs(x.pos[2] - x.before[2]) > 0.001) fail(`riding ${e} ${i}: the body left the ride (${x.pos} from ${x.before})`);
      if ((e === 'trophy' || e === 'moneyfan') && !x.prop) fail(`riding ${e} ${i}: nothing in hand`);
    }
  }
  if (errors.length) fail(`riding: ${errors.join(' | ')}`);
  await page.close();
}

if (checks.includes('wheel')) {
  // The wheel on the social dev page: sixteen buttons, the free six on 1-6 in the inner ring, the
  // ten others round the outside on the letter keys, those not owned locked with their price.
  for (const [vw, vh, label] of [[1280, 800, 'laptop'], [390, 844, 'phone']]) {
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, hasTouch: label === 'phone' });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(`http://localhost:${port}/casino/src/ui/social/dev.html?screen=emotes&fixture=1&owned=throwback,dab,moonwalk`, { timeout: 180000 });
    await page.waitForSelector('.emo-wheel');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/wheel-${label}.png` });
    const info = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('.emo-btn')];
      const r = document.querySelector('.emo-wheel').getBoundingClientRect();
      return {
        n: bs.length,
        locked: bs.filter((b) => b.classList.contains('locked')).map((b) => b.dataset.emote),
        keys: bs.map((b) => b.querySelector('.emo-key')?.textContent ?? ''),
        box: [r.left, r.top, r.right, r.bottom],
      };
    });
    console.log(`wheel ${label}: ${JSON.stringify(info)}`);
    if (info.n !== 16) fail(`wheel ${label}: ${info.n} buttons`);
    if (info.locked.join() !== 'griddy,floss,robot,backflip,moneyfan,bow,trophy') fail(`wheel ${label}: locked ${info.locked}`);
    if (info.box[0] < 0 || info.box[1] < 0 || info.box[2] > vw || info.box[3] > vh) fail(`wheel ${label}: off the screen ${info.box}`);
    if (label === 'laptop') {
      // hovering a locked one says what it costs
      await page.hover('.emo-btn[data-emote="backflip"]');
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/wheel-${label}-locked.png` });
      const hub = await page.evaluate(() => document.querySelector('.emo-hub').textContent);
      if (!/Backflip/.test(hub) || !/\$500,000/.test(hub)) fail(`wheel: a locked emote's hub reads "${hub}"`);
      // Q plays the first outer one (throwback, owned); W (griddy, locked) offers the boutique
      await page.keyboard.press('q');
      await page.waitForTimeout(200);
      const sent = await page.evaluate(() => window.dev.sent.slice());
      if (sent.join() !== 'throwback') fail(`wheel: Q sent ${sent}`);
      await page.evaluate(() => window.dev.emotes.open());
      await page.waitForSelector('.emo-wheel');
      await page.click('.emo-btn[data-emote="griddy"]');
      await page.waitForTimeout(200);
      const shop = await page.evaluate(() => window.dev.shopped.slice());
      if (shop.join() !== 'griddy') fail(`wheel: a click on a locked emote opened the boutique at ${shop}`);
      // a locked reward goes to the boutique too, where it's listed as won
      await page.evaluate(() => window.dev.emotes.open());
      await page.waitForSelector('.emo-wheel');
      await page.click('.emo-btn[data-emote="trophy"]');
      await page.waitForTimeout(200);
      const shop2 = await page.evaluate(() => window.dev.shopped.slice());
      if (shop2.join() !== 'griddy,trophy') fail(`wheel: a click on a locked reward opened ${shop2}`);
      // an owned message while it's open unlocks it in place
      await page.evaluate(() => {
        window.dev.emotes.open();
        window.dev.grant(['griddy']);
      });
      await page.waitForTimeout(100);
      const nowLocked = await page.evaluate(() => document.querySelector('.emo-btn[data-emote="griddy"]').classList.contains('locked'));
      if (nowLocked) fail('wheel: griddy still locked after the owned message');
    }
    if (errors.length) fail(`wheel ${label}: ${errors.join(' | ')}`);
    await page.close();
  }
}

if (checks.includes('live')) {
  // Two players through the game proper. A is paid a win (a ledger row and the balance, the way a
  // table pays), buys Throw It Back in the boutique's API, sees it unlock on the wheel from the
  // floor's owned message, and plays it with Q; B sees A throw it back and hears the beat from
  // where A stands. Then A backflips and lifts the trophy (shown on B's side as the floor would
  // deliver them: A doesn't own those). A earlier run's purchase is refunded first.
  const name = process.env.TAG ?? 'e2e';
  const aName = `emo6_al_${name}`;
  const sql = (command) => execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--json', '--command', command], { stdio: 'pipe', env: { ...process.env, CI: '1' } }).toString();
  try {
    sql(`UPDATE casino_accounts SET balance = balance + (SELECT COALESCE(SUM(price), 0) FROM casino_items WHERE account_id = casino_accounts.id AND item = 'throwback') WHERE name = '${aName}';
         DELETE FROM casino_items WHERE item = 'throwback' AND account_id = (SELECT id FROM casino_accounts WHERE name = '${aName}');`);
  } catch {
    /* a fresh database: nothing to take back */
  }
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
      const m = await import('/casino/src/audio/beat.ts');
      window.beatCalls = [];
      const play = m.Beats.prototype.play;
      m.Beats.prototype.play = function (e, at, ...rest) {
        window.beatCalls.push({ e, from: at ? [at.x, at.z].map((v) => +v.toFixed(1)) : null });
        return play.call(this, e, at, ...rest);
      };
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
  const a = await player(aName);
  const b = await player(`emo6_bo_${name}`);
  await b.page.waitForFunction((id) => window.casino.app.remotes?.drawn?.has(id), a.id);
  await a.page.evaluate(() => window.casino.world.teleport(0.5, 9.4, 0));
  await b.page.waitForFunction((id) => Math.abs((window.casino.app.remotes.character(id)?.root.position.z ?? 0) - 9.4) < 0.05, a.id, { timeout: 20000 }).catch(() => {});
  await b.page.waitForTimeout(900);
  await b.page.evaluate(() => (window.shot = { pos: [0.5, 1.45, 12.4], at: [0.5, 1.0, 9.4] }));

  // locked before: the wheel shows its price
  await a.page.keyboard.press('g');
  await a.page.waitForSelector('.emo-wheel');
  await a.page.waitForTimeout(400);
  await a.page.screenshot({ path: `${out}/live-wheel-before.png` });
  if (!(await a.page.evaluate(() => document.querySelector('.emo-btn[data-emote="throwback"]').classList.contains('locked')))) fail('live: throwback not locked before buying');
  // paid a win, then bought (the wheel stays up: the owned message unlocks it in place)
  const now = Date.now();
  sql(`INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) SELECT 'e2e-win:' || id || ':${now}', id, 'cashout', 15000000, 'e2e', ${now} FROM casino_accounts WHERE name = '${aName}'; UPDATE casino_accounts SET balance = balance + 15000000, rev = rev + 1 WHERE name = '${aName}';`);
  const bought = await a.page.evaluate(async () => {
    const api = await import('/casino/src/ui/shop/api.ts');
    try {
      await api.buy('throwback', api.newOp());
      return 'ok';
    } catch (e) {
      return String(e?.message ?? e);
    }
  });
  if (bought !== 'ok') fail(`live: buying throwback: ${bought}`);
  await a.page.waitForFunction(() => !document.querySelector('.emo-btn[data-emote="throwback"]').classList.contains('locked'), null, { timeout: 15000 }).catch(() => fail('live: the owned message did not unlock throwback on the open wheel'));
  await a.page.screenshot({ path: `${out}/live-wheel-after.png` });
  const ownedNow = await a.page.evaluate(() => window.casino.session.profile.owned ?? []);
  if (!ownedNow.includes('throwback')) fail(`live: the profile does not own throwback (${ownedNow})`);
  // Q plays it, through the floor
  await a.page.keyboard.press('q');
  await b.page.waitForFunction((id) => window.casino.app.remotes.character(id)?.act?.e === 'throwback', a.id, { timeout: 10000 }).catch(() => fail('live: B did not see A throw it back'));
  for (const t of [0.7, 0.82]) {
    await b.page.evaluate(([id, t]) => {
      const ch = window.casino.app.remotes.character(id);
      if (ch?.act) ch.act.t = t;
    }, [a.id, t]);
    await b.page.waitForTimeout(40);
    await b.page.screenshot({ path: `${out}/live-remote-throwback-${tag(t)}.png` });
  }
  await a.page.screenshot({ path: `${out}/live-own-throwback.png` });
  await b.page.waitForTimeout(4500);
  // not owned: the floor drops them, so B is shown them the way the floor would deliver them
  for (const [e, t] of [['backflip', 0.8], ['trophy', 1.5]]) {
    await b.page.evaluate(([id, e]) => window.casino.world.showEmote(id, e), [a.id, e]);
    await a.page.evaluate((e) => window.casino.world.showEmote('me', e), e);
    await b.page.waitForTimeout(t * 1000);
    await b.page.screenshot({ path: `${out}/live-remote-${e}-${tag(t)}.png` });
    await a.page.screenshot({ path: `${out}/live-own-${e}.png` });
    await b.page.waitForTimeout(3500);
  }
  const heard = { a: await a.page.evaluate(() => window.beatCalls.slice()), b: await b.page.evaluate(() => window.beatCalls.slice()) };
  console.log(`beats: A ${JSON.stringify(heard.a)} B ${JSON.stringify(heard.b)}`);
  if (!(heard.a.length === 1 && heard.a[0].e === 'throwback' && heard.a[0].from === null)) fail('A does not hear its own beat for the throw it back (and only that)');
  if (!(heard.b.length === 1 && heard.b[0].from !== null)) fail("B does not hear A's beat from where A stands");
  // a locked one A presses the key for is only pointed out, and nothing goes to the floor
  await a.page.keyboard.press('g');
  await a.page.waitForSelector('.emo-wheel');
  await a.page.keyboard.press('w');
  await a.page.waitForTimeout(300);
  const hub = await a.page.evaluate(() => document.querySelector('.emo-hub')?.textContent ?? '');
  if (!/Griddy/.test(hub) || !/\$120,000/.test(hub)) fail(`live: W on the locked griddy reads "${hub}"`);
  if (!(await a.page.$('.emo-wheel'))) fail('live: W on a locked emote closed the wheel');
  await a.page.screenshot({ path: `${out}/live-wheel-locked-key.png` });
  await a.page.keyboard.press('Escape');
  for (const p of [a, b]) if (p.errors.length) fail(`live: ${p.errors.slice(0, 5).join(' | ')}`);
  await a.page.context().close();
  await b.page.context().close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all emotes6 checks passed');
process.exit(failed ? 1 : 0);
