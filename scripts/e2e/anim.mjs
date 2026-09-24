#!/usr/bin/env node
// Do the animations land on what the server drew? Plays many rounds of each game that animates a
// random result in the dev harness and, once each round has played out, reads the result back
// off the 3D model, not the view's state:
//   roulette   the pocket under the ball: the ball's position in the rotor's frame, looked up on
//              the pocket floor's and the number ring's own texture coordinates (both wheels)
//   craps      each die's top face: its mesh's face groups turned by the die's world rotation,
//   sicbo      and the pips counted on the top face's own texture
//   bigsix     the stop under the clapper's tip, and the slot under the Bandit Wheel's flapper
//   bandit     tip, in the wheel's frame, against the painted face's layout
//   slots      every reel's offset on its strip, against the server's stops (all six machines)
// Also: the dice rest flat on the table and inside the dome, the ball rests in its pocket, and
// the camera comes back to the table's resting pose after every spin or roll.
//
// Usage: node scripts/e2e/anim.mjs [port] [outDir] [part...]   (PORT_BASE=<port> npm run dev first)
//   parts: roulette-american roulette-european craps sicbo bigsix bandit slots-<machine>
//   ROUNDS=n rounds per part (default 12); GPU=1 draws on the machine's GPU (much faster).

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6110', out = '/tmp/casino-anim', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ROUNDS = Number(process.env.ROUNDS ?? 12);
const ROOT = process.cwd();
const gpu = process.env.GPU === '1';
const args = gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ channel: 'chromium', args });
const log = (s) => console.log(new Date().toISOString().slice(11, 19), s);
let failures = 0;
const fail = (what) => {
  failures++;
  log(`FAIL ${what}`);
};

const PARTS = {
  'roulette-american': { game: 'roulette', variant: 'american', bet: [{ type: 'bet', bets: [{ kind: 'red', amount: 500 }] }], go: { type: 'spin' }, end: 'settle' },
  'roulette-european': { game: 'roulette', variant: 'european', bet: [{ type: 'bet', bets: [{ kind: 'red', amount: 500 }] }], go: { type: 'spin' }, end: 'settle' },
  craps: { game: 'craps', variant: '', bet: [{ type: 'bet', bets: [{ kind: 'field', amount: 1000 }] }], go: { type: 'roll' }, end: 'roll' },
  sicbo: { game: 'sicbo', variant: '', bet: [{ type: 'bet', bets: [{ spot: 'small', amount: 500 }] }], go: { type: 'roll' }, end: 'settle' },
  bigsix: { game: 'bigsix', variant: '', bet: [{ type: 'bet', bets: [{ spot: 'one', amount: 500 }] }], go: { type: 'spin' }, end: 'settle' },
  bandit: { game: 'banditwheel', variant: '', bet: [{ type: 'bet', bets: [{ spot: 1, amount: 500 }] }], go: { type: 'spin' }, end: 'settle' },
  ...Object.fromEntries(
    ['sevens', 'neon', 'wild', 'diamonds', 'cherries', 'goldrush'].map((m) => [`slots-${m}`, { game: 'slots', variant: m, bet: [], go: { type: 'spin', coins: 1, denom: m === 'sevens' || m === 'wild' || m === 'diamonds' ? 100 : 5 }, end: 'result' }]),
  ),
};

// --- read back off the model (runs in the page) -------------------------------------------------
const HELPERS = () => {
  const TAU = Math.PI * 2;
  const mod = (a, n) => ((a % n) + n) % n;
  const { engine, table } = window.casino;
  const V = (x = 0, y = 0, z = 0) => new engine.camera.position.constructor(x, y, z);
  const Q = () => new engine.camera.quaternion.constructor();
  const shown = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const all = (pred) => {
    const found = [];
    table.stage.anchor.traverse((o) => pred(o) && shown(o) && found.push(o));
    return found;
  };
  const named = (name) => all((o) => o.name === name)[0] ?? null;
  /** u of the lathe vertex nearest angle phi (lathe: x = r sin φ, z = r cos φ, u = φ / 2π). */
  const latheU = (mesh, phi) => {
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    let best = null;
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getX(i), pos.getZ(i));
      const d = Math.abs(mod(a - phi + Math.PI, TAU) - Math.PI);
      if (!best || d < best.d) best = { d, u: uv.getX(i) };
    }
    return best.u;
  };
  const span = (mesh) => {
    const pos = mesh.geometry.attributes.position;
    let y0 = Infinity, y1 = -Infinity, r0 = Infinity, r1 = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      y0 = Math.min(y0, pos.getY(i));
      y1 = Math.max(y1, pos.getY(i));
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
    }
    return { y0, y1, r0, r1 };
  };
  /** Pips on a die face's own texture: blobs that differ from the face's ground colour. */
  const countPips = (canvas) => {
    const W = canvas.width;
    const H = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const bg = [d[(4 * W + 4) * 4], d[(4 * W + 4) * 4 + 1], d[(4 * W + 4) * 4 + 2]];
    const pip = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) pip[i] = Math.abs(d[i * 4] - bg[0]) + Math.abs(d[i * 4 + 1] - bg[1]) + Math.abs(d[i * 4 + 2] - bg[2]) > 120 ? 1 : 0;
    let blobs = 0;
    const stack = [];
    for (let i = 0; i < W * H; i++) {
      if (pip[i] !== 1) continue;
      let size = 0;
      pip[i] = 2;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop();
        size++;
        const x = j % W;
        for (const k of [j - 1, j + 1, j - W, j + W]) {
          if (k < 0 || k >= W * H || pip[k] !== 1) continue;
          if ((k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
          pip[k] = 2;
          stack.push(k);
        }
      }
      if (size >= 30) blobs++;
    }
    return blobs;
  };
  return {
    roulette(order) {
      const ball = all((o) => o.name === 'roulette-ball')[0];
      if (!ball) return { err: 'no ball showing' };
      const rotor = ball.parent.getObjectByName('roulette-rotor');
      const p = rotor.worldToLocal(ball.getWorldPosition(V()));
      const phi = Math.atan2(p.x, p.z);
      const n = order.length;
      let floor = null;
      let ring = null;
      rotor.traverse((m) => {
        if (!m.isMesh || m.isInstancedMesh || !m.geometry.attributes.uv) return;
        const s = span(m);
        if (s.y1 - s.y0 < 1e-5 && Math.abs(s.y0 - 0.0035) < 1e-4 && s.r1 > 0.24 && s.r0 < 0.2) floor = order[n - 1 - (Math.floor(latheU(m, phi) * n) % n)];
        if (s.r0 > 0.245 && s.r1 < 0.276 && s.y0 > 0.012 && s.y1 < 0.02) ring = order[n - 1 - (Math.floor(latheU(m, phi) * n) % n)];
      });
      return { floor, ring, r: +Math.hypot(p.x, p.z).toFixed(4), y: +p.y.toFixed(4) };
    },
    dice() {
      const dice = all((m) => {
        if (!m.isMesh || !Array.isArray(m.material) || m.material.length !== 6) return false;
        const g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        return Math.abs(g.boundingBox.max.x - g.boundingBox.min.x - 0.019) < 0.002;
      });
      return dice.map((m) => {
        const g = m.geometry;
        const q = m.getWorldQuaternion(Q());
        const nrm = g.attributes.normal;
        let best = null;
        for (const grp of g.groups) {
          const n = V();
          for (let k = grp.start; k < grp.start + grp.count; k++) {
            const i = g.index ? g.index.getX(k) : k;
            n.x += nrm.getX(i);
            n.y += nrm.getY(i);
            n.z += nrm.getZ(i);
          }
          n.normalize().applyQuaternion(q);
          if (!best || n.y > best.up) best = { up: n.y, mi: grp.materialIndex };
        }
        const w = m.getWorldPosition(V());
        const local = table.stage.root.worldToLocal(w.clone());
        return { face: countPips(m.material[best.mi].map.image), up: +best.up.toFixed(4), at: [+local.x.toFixed(3), +local.y.toFixed(4), +local.z.toFixed(3)] };
      });
    },
    wheel(rotorName, flapName, count) {
      const rotor = named(rotorName);
      const flap = named(flapName);
      if (!rotor || !flap) return { err: `no ${rotorName}/${flapName}` };
      let tip;
      if (flap.isMesh) {
        // the Bandit Wheel's strap: its last ring of vertices is the tip
        const pos = flap.geometry.attributes.position;
        tip = V();
        for (let i = pos.count - 4; i < pos.count; i++) tip.add(V(pos.getX(i), pos.getY(i), pos.getZ(i)));
        tip.multiplyScalar(0.25);
        flap.localToWorld(tip);
      } else {
        // the Big Six clapper: the leather tongue's lowest point
        let y = 0;
        flap.traverse((c) => {
          if (!c.isMesh) return;
          if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
          y = Math.min(y, c.geometry.boundingBox.min.y + c.position.y);
        });
        tip = flap.localToWorld(V(0, y + 0.004, 0));
      }
      const p = rotor.worldToLocal(tip);
      const a = mod(Math.atan2(p.x, p.y), TAU);
      return { index: Math.floor(a / (TAU / count)), frac: +((a / (TAU / count)) % 1).toFixed(3) };
    },
    reels() {
      const mats = [];
      table.stage.anchor.traverse((m) => {
        if (!m.isMesh || !shown(m) || !m.material?.uniforms?.uOffset) return;
        if (!mats.some((x) => x.mat === m.material)) mats.push({ mat: m.material, x: m.position.x });
      });
      if (mats.length === 1 && Array.isArray(mats[0].mat.uniforms.uOffset.value)) {
        const u = mats[0].mat.uniforms;
        return { offsets: [...u.uOffset.value], strip: u.uStops.value, bank: true };
      }
      mats.sort((a, b) => a.x - b.x);
      return { offsets: mats.map((m) => m.mat.uniforms.uOffset.value), strip: mats.map((m) => m.mat.uniforms.uStops.value), bank: false };
    },
    camera() {
      const rest = table.stage.restPose(engine.camera);
      return { dist: +engine.camera.position.distanceTo(rest.pos).toFixed(4), angle: +engine.camera.quaternion.angleTo(rest.quat).toFixed(4) };
    },
  };
};

async function open(part) {
  const spec = PARTS[part];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem('casino.quality', 'low'));
  const name = `qa_${part.replace(/[^a-z]/g, '').slice(0, 13)}`;
  await page.goto(`http://localhost:${port}/casino/?dev=table&game=${spec.game}&variant=${spec.variant}&name=${name}`, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 300000 });
  // buy in unless the table still has chips from an earlier run
  await page.waitForFunction(() => !!document.querySelector('.modal input[type=number]') || (window.casino?.table?.snapshot?.you?.stack ?? 0) > 0, null, { timeout: 120000 });
  if (await page.$('.modal input[type=number]')) {
    await page.fill('.modal input[type=number]', '2000');
    await page.click('.modal .btn.primary');
    await page.waitForFunction(() => (window.casino.table.snapshot?.you?.stack ?? 0) > 0, null, { timeout: 60000 });
  }
  await page.evaluate(`window.__qa = (${HELPERS.toString()})()`);
  const order = await page.evaluate(async ([root, game, variant]) => {
    if (game === 'roulette') return (await import(`/casino/@fs${root}/shared/src/games/roulette/rules.ts`)).WHEEL[variant];
    if (game === 'bigsix') return (await import(`/casino/@fs${root}/shared/src/games/bigsix/rules.ts`)).WHEEL;
    if (game === 'banditwheel') return (await import(`/casino/@fs${root}/shared/src/games/banditwheel/rules.ts`)).WHEEL;
    return null;
  }, [ROOT, spec.game, spec.variant]);
  return { page, errors, order };
}

/** One round: the bets, the go, and every event until the round's end has played out. */
async function playRound(page, spec) {
  return page.evaluate(
    async ({ bet, go, end }) => {
      const s = window.casino.table;
      const events = [];
      let done = false;
      const orig = s.onMessage.bind(s);
      s.onMessage = (m) => {
        orig(m);
        if (m.t === 'ev') {
          events.push(...m.events);
          if (m.events.some((e) => e.type === end)) done = true;
        }
        if (m.t === 'err') events.push({ type: 'err', msg: m.msg });
      };
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      try {
        for (const a of bet) {
          s.link.act(a);
          await wait(400);
        }
        s.link.act(go);
        const t0 = performance.now();
        while (!done && performance.now() - t0 < 60000) await wait(100);
        // the animations queue behind each other: wait for them to drain, then a beat more
        for (let i = 0; i < 4; i++) await Promise.race([s.queue, wait(60000)]);
        await wait(900);
      } finally {
        s.onMessage = orig;
      }
      return { done, events: events.filter((e) => ['spin', 'roll', 'reels', 'settle', 'result', 'err'].includes(e.type)) };
    },
    { bet: spec.bet, go: spec.go, end: spec.end },
  );
}

const rows = [];
for (const part of only.length ? only : Object.keys(PARTS)) {
  const spec = PARTS[part];
  if (!spec) {
    fail(`no part ${part}`);
    continue;
  }
  let ok = 0;
  let checked = 0;
  const { page, errors, order } = await open(part);
  const cam0 = await page.evaluate(() => window.__qa.camera());
  log(`${part}: seated (camera ${JSON.stringify(cam0)})`);
  for (let r = 0; r < ROUNDS; r++) {
    const res = await playRound(page, spec);
    const errs = res.events.filter((e) => e.type === 'err');
    if (!res.done) {
      fail(`${part} round ${r}: no ${spec.end} (${errs.map((e) => e.msg).join('; ') || 'no answer'})`);
      continue;
    }
    const seen = await page.evaluate(([game, order]) => {
      const qa = window.__qa;
      if (game === 'roulette') return qa.roulette(order);
      if (game === 'craps' || game === 'sicbo') return qa.dice();
      if (game === 'bigsix') return qa.wheel('bigsix-rotor', 'bigsix-flap', order.length);
      if (game === 'banditwheel') return qa.wheel('bw-rotor', 'bw-flapper', order.length);
      if (game === 'slots') return qa.reels();
      return null;
    }, [spec.game, order]);
    const cam = await page.evaluate(() => window.__qa.camera());
    let want;
    let good;
    let got;
    if (spec.game === 'roulette') {
      const e = res.events.find((x) => x.type === 'spin');
      want = e.pocket;
      got = `${seen.floor}/${seen.ring} r=${seen.r} y=${seen.y}`;
      good = seen.floor === want && seen.ring === want && Math.abs(seen.r - 0.222) < 0.003 && seen.y < 0.02;
    } else if (spec.game === 'craps' || spec.game === 'sicbo') {
      const e = res.events.find((x) => x.type === 'roll');
      want = [...e.dice].sort().join('');
      got = seen.map((d) => d.face).sort().join('');
      const flat = seen.every((d) => d.up > 0.995);
      good = got === want && flat && seen.length === e.dice.length;
      if (!flat) got += ` (not flat: ${seen.map((d) => d.up).join(',')})`;
      got += ` at ${JSON.stringify(seen.map((d) => d.at))}`;
    } else if (spec.game === 'bigsix' || spec.game === 'banditwheel') {
      const e = res.events.find((x) => x.type === 'spin');
      want = spec.game === 'bigsix' ? e.stop : e.slot;
      got = `${seen.index} (${order[seen.index]}, at ${seen.frac} of the way through)`;
      good = seen.index === want;
    } else if (spec.game === 'slots') {
      const reels = res.events.filter((x) => x.type === 'reels');
      const last = reels.at(-1);
      want = last.stops.join(',');
      const strips = Array.isArray(seen.strip) ? seen.strip : seen.offsets.map(() => seen.strip);
      const rowOff = { sevens: 0, wild: 0, diamonds: 0, neon: 1, cherries: 1, goldrush: 1.5 }[spec.variant];
      got = seen.offsets.map((o, i) => ((o - rowOff) % strips[i] + strips[i]) % strips[i]).map((x) => +x.toFixed(3)).join(',');
      good = got === want;
      got += ` (strips ${strips.join('/')}, free games ${reels.length - 1})`;
    }
    const camBack = cam.dist < 0.01 && cam.angle < 0.01;
    checked++;
    if (good && camBack) ok++;
    else fail(`${part} round ${r}: drew ${JSON.stringify(want)}, the model shows ${got}${camBack ? '' : `; camera off its rest pose by ${cam.dist} m, ${cam.angle} rad`}`);
    if (r < 2 || !good) {
      const file = `${out}/anim-${part}-${r}.png`;
      await page.screenshot({ path: file });
    }
    log(`${part} round ${r}: drew ${JSON.stringify(want)} -> ${got} ${good ? 'ok' : 'MISS'}${camBack ? '' : ' (camera away)'}`);
  }
  if (errors.length) fail(`${part}: page errors: ${errors.slice(0, 3).join(' | ')}`);
  rows.push({ part, rounds: checked, ok });
  await page.close();
}

await browser.close();
console.log('ANIM part | rounds | landed right');
for (const r of rows) console.log(`ANIM ${r.part} | ${r.rounds} | ${r.ok}`);
console.log(failures ? `${failures} failure(s)` : 'all landed where the server drew');
process.exit(failures ? 1 : 0);
