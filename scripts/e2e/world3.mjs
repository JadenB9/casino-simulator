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
  await page.goto(`${floorUrl}?${query}`, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600000 });
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

// --- clipping: the plan's own check, then the real geometry against the plan -----------------------
// Every prop's vertices must lie inside the solids the plan gives it (so checkLayout's answer is
// about the real models), and every station's model inside its footprint.
if (checks.includes('layout')) {
  const { page, errors } = await openFloor('quality=high&view=overview');
  const result = await page.evaluate(async () => {
    const L = await import('/casino/src/world/layout.ts');
    const { THREE, world, engine } = window.casino;
    const plan = world.plan;
    const TOL = 0.03;
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const inside = (s, x, y, z) => {
      let out = Math.max(0, s.y0 - y, y - s.y1);
      if (s.round) out = Math.max(out, Math.hypot(x - s.x, z - s.z) - s.w / 2);
      else {
        const c = Math.cos(s.yaw);
        const sn = Math.sin(s.yaw);
        const lx = (x - s.x) * c - (z - s.z) * sn;
        const lz = (x - s.x) * sn + (z - s.z) * c;
        out = Math.max(out, Math.abs(lx) - s.w / 2, Math.abs(lz) - s.d / 2);
      }
      return out;
    };
    const props = [];
    const kinds = { stool: /^stool-/, couch: /-couch-/, 'lamp-floor': /-lamp-/, palm: /^palm-/, 'plant-a': /^plant-/, 'plant-b': /^plant-/ };
    engine.scene.updateMatrixWorld(true);
    engine.scene.traverse((o) => {
      const kind = o.name?.startsWith('prop:') ? o.name.slice(5) : null;
      if (!kind || !kinds[kind]) return;
      const meshes = o.children.filter((c) => c.isInstancedMesh);
      const n = meshes[0]?.count ?? 0;
      for (let i = 0; i < n; i++) {
        const pts = [];
        for (const mesh of meshes) {
          mesh.getMatrixAt(i, m);
          const pos = mesh.geometry.attributes.position;
          const step = Math.max(1, Math.floor(pos.count / 4000));
          for (let k = 0; k < pos.count; k += step) {
            v.fromBufferAttribute(pos, k).applyMatrix4(m).applyMatrix4(mesh.matrixWorld);
            pts.push([v.x, v.y, v.z]);
          }
        }
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
        const cz = pts.reduce((a, p) => a + p[2], 0) / pts.length;
        // the solids of the thing this prop is: the group whose nearest member stands closest
        const cands = plan.solids.filter((s) => kinds[kind].test(s.id));
        let best = null;
        for (const s of cands) {
          const d = Math.hypot(s.x - cx, s.z - cz);
          if (!best || d < best.d) best = { s, d };
        }
        if (!best) {
          props.push(`${kind} #${i} has no solid in the plan`);
          continue;
        }
        const group = kind === 'couch' ? [best.s] : plan.solids.filter((s) => s.group === best.s.group);
        let worst = 0;
        let at = null;
        for (const [x, y, z] of pts) {
          const e = Math.min(...group.map((s) => inside(s, x, y, z)));
          if (e > worst) {
            worst = e;
            at = [x, y, z];
          }
        }
        if (worst > TOL) props.push(`${kind} #${i} (${best.s.group}) sticks out of its solid by ${worst.toFixed(2)} m at ${at.map((q) => q.toFixed(2)).join(',')}`);
      }
    });
    // stations: the model inside its footprint (in the station's own frame) and under its height
    const stations = [];
    for (const st of world.stations) {
      const inv = new THREE.Matrix4().copy(st.anchor.matrixWorld).invert();
      let ex = 0;
      let ez = 0;
      let top = 0;
      st.model.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const pos = o.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / 2000));
        const inst = o.isInstancedMesh ? o.count : 1;
        for (let i = 0; i < inst; i++) {
          if (o.isInstancedMesh) o.getMatrixAt(i, m);
          for (let k = 0; k < pos.count; k += step) {
            v.fromBufferAttribute(pos, k);
            if (o.isInstancedMesh) v.applyMatrix4(m);
            v.applyMatrix4(o.matrixWorld).applyMatrix4(inv);
            ex = Math.max(ex, Math.abs(v.x) - st.footprint.width / 2);
            ez = Math.max(ez, Math.abs(v.z) - st.footprint.depth / 2);
            top = Math.max(top, v.y + st.anchor.position.y);
          }
        }
      });
      const h = L.STATION_H[st.zone];
      if (ex > 0.05 || ez > 0.05 || top > h) stations.push(`${st.id}: model past its footprint by ${ex.toFixed(2)} (width) ${ez.toFixed(2)} (depth), top ${top.toFixed(2)} m (allowed ${h})`);
    }
    return { plan: L.checkLayout(plan), props, stations, plants: plan.plants.length, palms: plan.palms.map((p) => p.size) };
  });
  console.log(JSON.stringify({ check: 'layout', ...result, errors: errors.slice(0, 3) }));
  for (const k of ['plan', 'props', 'stations']) if (result[k].length) fail(`layout ${k}: ${result[k].join('; ')}`);
  await page.close();
}

// --- far stand-ins: each station's baked copy against its real model, same camera, same lights ------
// Renders both on their own, compares the mean colour of the pixels they cover, and saves a contact
// sheet (near left, far right) for a look.
if (checks.includes('lod')) {
  const { page, errors } = await openFloor('quality=high&view=overview');
  const result = await page.evaluate(async () => {
    const { THREE, world, engine } = window.casino;
    const renderer = engine.renderer;
    const W = 200;
    const H = 150;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 0 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(40, W / H, 0.05, 100);
    const scene = engine.scene;
    const floor = scene.getObjectByName('floor');
    const hidden = [];
    // everything but the stations and the lights goes dark for this
    floor.children.forEach((c) => {
      if (c.name !== 'stations' && c.name !== 'lights' && c.visible) {
        c.visible = false;
        hidden.push(c);
      }
    });
    const bg = scene.background;
    scene.background = new THREE.Color('#808080');
    const buf = new Uint8Array(W * H * 4);
    const sheet = document.createElement('canvas');
    const games = [...new Set(world.stations.map((s) => s.id.replace(/-\d+$/, '')))];
    const picks = world.stations.filter((s, i, all) => all.findIndex((t) => t.game === s.game && t.variant === s.variant) === i);
    sheet.width = W * 2;
    sheet.height = H * picks.length;
    const ctx = sheet.getContext('2d');
    const img = ctx.createImageData(W, H);
    const out = [];
    const shot = (st, far, row, col) => {
      for (const s of world.stations) {
        s.anchor.visible = s === st;
      }
      const copy = st.model.parent.getObjectByName(`far:${st.id}`);
      st.model.visible = !far;
      if (copy) copy.visible = far;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      renderer.setRenderTarget(null);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = ((H - 1 - y) * W + x) * 4;
          const o = (y * W + x) * 4;
          img.data[o] = buf[i];
          img.data[o + 1] = buf[i + 1];
          img.data[o + 2] = buf[i + 2];
          img.data[o + 3] = 255;
          // background grey is 128 (or its tone-mapped neighbour): skip it
          if (Math.abs(buf[i] - buf[i + 1]) < 3 && Math.abs(buf[i + 1] - buf[i + 2]) < 3 && Math.abs(buf[i] - 128) < 14) continue;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
          n++;
        }
      }
      ctx.putImageData(img, col * W, row * H);
      return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n), n] : [0, 0, 0, 0];
    };
    picks.forEach((st, row) => {
      const a = st.anchor;
      const size = Math.max(st.footprint.width, st.footprint.depth);
      const dist = size * 1.35 + 1.2;
      // from the players' side, a little above
      const fx = Math.sin(st.yaw);
      const fz = Math.cos(st.yaw);
      cam.position.set(a.position.x + fx * dist * 0.8 + fz * dist * 0.35, a.position.y + 1.3 + size * 0.35, a.position.z + fz * dist * 0.8 - fx * dist * 0.35);
      const box = new THREE.Box3().setFromObject(st.model);
      cam.lookAt(box.getCenter(new THREE.Vector3()));
      const near = shot(st, false, row, 0);
      const far = shot(st, true, row, 1);
      const d = Math.hypot(near[0] - far[0], near[1] - far[1], near[2] - far[2]);
      out.push({ id: st.id, near, far, diff: +d.toFixed(1) });
      st.model.visible = true;
      const copy = st.model.parent.getObjectByName(`far:${st.id}`);
      if (copy) copy.visible = false;
    });
    for (const s of world.stations) s.anchor.visible = true;
    for (const c of hidden) c.visible = true;
    scene.background = bg;
    rt.dispose();
    void games;
    return { stations: out, sheet: sheet.toDataURL('image/png') };
  });
  const { writeFileSync } = await import('node:fs');
  const file = `${out}/world3-lod-sheet.png`;
  writeFileSync(file, Buffer.from(result.sheet.split(',')[1], 'base64'));
  for (const s of result.stations) console.log(JSON.stringify({ check: 'lod', ...s }));
  console.log(JSON.stringify({ check: 'lod', file, errors: errors.slice(0, 3) }));
  const bad = result.stations.filter((s) => s.diff > 28);
  if (bad.length) fail(`far stand-ins off colour: ${bad.map((s) => `${s.id} ${s.diff}`).join(', ')}`);
  await page.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
