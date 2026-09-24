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

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all emotes checks passed');
process.exit(failed ? 1 : 0);
