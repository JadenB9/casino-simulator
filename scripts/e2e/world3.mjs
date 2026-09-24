#!/usr/bin/env node
// Headless checks for the v3 floor. Usage:
//   node scripts/e2e/world3.mjs [port] [out dir] [checks...]
//   checks: shots calls layout lod (dev floor, Vite only); lock onboard (the game proper, needs
//   the worker too: PORT_BASE=<port> npm run dev). Default: all.
// calls sweeps the busiest camera poses on the floor with the big-win sign and meter up (the
// feed dev page) and fails past CALL_LIMIT (235: room under 250 for the dealers).
// SHOTS=pit,poker limits the fixed views. GPU=1 renders on the machine's GPU (Metal) for real
// frame times; otherwise SwiftShader. Runs Chrome's new headless mode (channel 'chromium'): the
// headless shell refuses Pointer Lock.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [port = '5930', out = '/tmp/world3', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const all = ['shots', 'calls', 'layout', 'lod', 'lock', 'onboard', 'bloom'];
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

async function openFloor(query, url = floorUrl) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = watch(page);
  await page.goto(`${url}?${query}`, { timeout: 300000 });
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

// --- draw calls at the busiest poses, the features' sign and meter up ------------------------------
const CALL_LIMIT = Number(process.env.CALL_LIMIT ?? 235);
if (checks.includes('calls')) {
  const quality = process.env.QUALITY ?? 'high';
  const { page, errors } = await openFloor(`quality=${quality}&stats=1&slots=sevens,neon,wild,diamonds,cherries,goldrush`, `http://localhost:${port}/casino/src/ui/feed/dev.html`);
  const poses = await page.evaluate(() => {
    const p = window.casino.world.plan;
    const m = window.casino.marqueeAt ?? { x: 0, z: (p.staff.z0 + p.staff.z1) / 2 };
    const t = window.casino.tallyAt ?? { x: p.pit.x0 - 3, z: (p.aisles[0].z0 + p.aisles[0].z1) / 2 };
    const mz = (p.staff.z0 + p.staff.z1) / 2;
    const out = [];
    // the north row's players looking south across the pit, and the south row's looking north
    for (const x of [-9, -6, -3, 0, 3, 6, 9]) out.push([`north${x}`, [m.x + x - 1.2, 1.7, p.staff.z0 - 3.4], [m.x + x, 3.3, mz]]);
    for (const x of [-9, -5, 0, 5, 9]) out.push([`south${x}`, [x + 1.2, 1.7, p.pit.z1 + 0.6], [x, 1.2, mz]]);
    out.push(['marquee', [m.x + 1.6, 1.7, p.staff.z1 + 3.6], [m.x, 3.3, m.z]]);
    out.push(['staffE', [p.staff.x0 + 0.5, 1.7, mz], [p.staff.x1, 0.8, mz]]);
    out.push(['staffW', [p.staff.x1 - 0.5, 1.7, mz], [p.staff.x0, 0.8, mz]]);
    // standing on the cross aisle, turning round
    const cz = (p.aisles[0].z0 + p.aisles[0].z1) / 2;
    for (const x of [-12, -6, 0, 6]) for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      out.push([`cross${x}@${k * 45}`, [x, 1.7, cz], [x + Math.sin(a) * 10, 1.1, cz - Math.cos(a) * 10]]);
    }
    out.push(['tally', [t.x + 2.2, 1.7, t.z + 6.2], [t.x, 2.85, t.z]]);
    out.push(['tallyback', [t.x - 1.4, 1.7, t.z - 5.0], [t.x, 2.85, t.z]]);
    out.push(['front', [0.6, 1.75, p.entrance.z0 - 1.6], [-1.6, 2.6, m.z]]);
    out.push(['slotsSE', [p.slotsZone.x1 - 3.1, 2.5, p.slotsZone.z1 - 0.7], [p.slotsZone.x0 + 3, 0.8, p.slotsZone.z0 + 2]]);
    out.push(['slotsN', [-11.4, 1.7, p.slotsZone.z0 - 1], [-11.4, 0.9, p.slotsZone.z1]]);
    out.push(['entrance', [0, 1.7, p.entrance.z0 + 1], [0, 1.2, p.pit.z0]]);
    out.push(['barN', [p.bar.front - 5, 1.7, p.bar.z0 - 2], [p.bar.front, 1, p.bar.z1]]);
    out.push(['poker', [p.pokerRoom.x0 + 0.5, 1.8, p.pokerRoom.z1 - 0.4], [p.pokerRoom.x1 - 1.5, 0.8, p.pokerRoom.z0 + 2.5]]);
    return out;
  });
  const results = [];
  for (const [name, pos, at] of poses) {
    const calls = await page.evaluate(async ([pos, at]) => {
      const { world, engine } = window.casino;
      world.player.setEnabled(false);
      world.player.character.root.visible = false;
      window.__cam?.();
      window.__cam = engine.onFrame(() => {
        engine.camera.position.set(...pos);
        engine.camera.lookAt(...at);
      });
      for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
      let max = 0;
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        max = Math.max(max, world.stats().calls);
      }
      return max;
    }, [pos, at]);
    results.push([name, calls]);
  }
  results.sort((a, b) => b[1] - a[1]);
  const worst = results[0];
  await page.evaluate(([pos, at]) => {
    const { engine } = window.casino;
    window.__cam?.();
    window.__cam = engine.onFrame(() => {
      engine.camera.position.set(...pos);
      engine.camera.lookAt(...at);
    });
  }, poses.find((p) => p[0] === worst[0]).slice(1));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/world3-calls-worst-${quality}.png` });
  // what the worst view's calls are made of: each group of the scene switched off in turn
  const parts = await page.evaluate(async () => {
    const { world, engine } = window.casino;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const calls = async () => {
      for (let i = 0; i < 3; i++) await frame();
      return world.stats().calls;
    };
    const all = await calls();
    const out = { all };
    const floor = engine.scene.getObjectByName('floor');
    const groups = [...floor.children, ...engine.scene.children.filter((c) => c !== floor)];
    for (const g of groups) {
      if (!g.visible) continue;
      g.visible = false;
      const saved = all - (await calls());
      g.visible = true;
      if (saved > 0) out[g.name || g.type] = (out[g.name || g.type] ?? 0) + saved;
    }
    out.realStations = world.stations.filter((s) => s.model.visible).map((s) => s.id).join(',');
    return out;
  });
  console.log(JSON.stringify({ check: 'calls-worst', pose: worst[0], ...parts }));
  console.log(JSON.stringify({ check: 'calls', quality, worst, top: results.slice(0, 8).map(([n, c]) => `${n}:${c}`), all: results.length, errors: errors.slice(0, 3) }));
  const over = results.filter(([, c]) => c > CALL_LIMIT);
  if (over.length) fail(`calls over ${CALL_LIMIT}: ${over.map(([n, c]) => `${n} ${c}`).join(', ')}`);
  if (errors.length) fail(`calls: ${errors[0]}`);
  await page.close();
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
    // every station on its real model (under a hidden anchor, so drawn by none), the one being
    // looked at on whichever the shot wants: the stand-ins' batched parts follow the pins
    for (const s of world.stations) world.lod.pin(s.id, 'real');
    const shot = (st, far, row, col) => {
      for (const s of world.stations) s.anchor.visible = s === st;
      world.lod.pin(st.id, far ? 'far' : 'real');
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
    const reset = (st) => world.lod.pin(st.id, 'real');
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
      const entry = { id: st.id, near, far, diff: +d.toFixed(1) };
      // tables: straight down on the playing surface too, near and far (the felt's own colour)
      if (st.zone === 'pit' || st.zone === 'poker') {
        cam.position.set(a.position.x, box.max.y + size * 1.1, a.position.z + 0.001);
        cam.lookAt(a.position.x, box.max.y - 0.2, a.position.z);
        const top = [shot(st, false, row, 0), shot(st, true, row, 1)];
        entry.topNear = top[0];
        entry.topFar = top[1];
        entry.topDiff = +Math.hypot(top[0][0] - top[1][0], top[0][1] - top[1][1], top[0][2] - top[1][2]).toFixed(1);
        // redo the side view for the contact sheet
        cam.position.set(a.position.x + fx * dist * 0.8 + fz * dist * 0.35, a.position.y + 1.3 + size * 0.35, a.position.z + fz * dist * 0.8 - fx * dist * 0.35);
        cam.lookAt(box.getCenter(new THREE.Vector3()));
        shot(st, false, row, 0);
        shot(st, true, row, 1);
      }
      out.push(entry);
      reset(st);
    });
    for (const s of world.stations) {
      s.anchor.visible = true;
      world.lod.pin(s.id, null);
    }
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
  const bad = result.stations.filter((s) => s.diff > 20 || s.topDiff > 20);
  if (bad.length) fail(`far stand-ins off colour: ${bad.map((s) => `${s.id} ${s.diff}/${s.topDiff ?? '-'}`).join(', ')}`);
  // poker tables read green on the floor, near and far
  const green = ([r, g, b]) => g > r * 1.15 && g > b;
  for (const s of result.stations.filter((x) => /^he-/.test(x.id))) {
    if (!green(s.topFar)) fail(`${s.id}: the far stand-in's felt is not green (${s.topFar.slice(0, 3)}); the near model's is ${green(s.topNear) ? 'green' : 'not green either (holdem/table.ts: the top cap of the apron covers the felt)'}`);
  }
  await page.close();
}

// --- the game proper: log in (fixed names; the local dev database only), then the floor ----------
const gameUrl = `http://localhost:${port}/casino/`;
const PASSWORD = 'casino-dev'; // DEV_PASSWORD in client/src/net/api.ts

/** Local dev database only: run one statement against it. */
function sql(command) {
  execFileSync('node_modules/.bin/wrangler', ['d1', 'execute', 'DB', '--local', '-c', 'server/wrangler.toml', '--command', command], { env: { ...process.env, CI: '1' }, stdio: 'ignore' });
}

async function openGame(name, init = () => {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(gameUrl, { timeout: 300000 });
  await page.waitForSelector('.name-input, .menu-item', { timeout: 600000 });
  if (await page.$('.name-input')) {
    await page.fill('.name-input', name);
    await page.fill('.pass-input', PASSWORD);
    await page.click('.enter-btn');
  }
  await page.waitForSelector('.menu-item, .editor-panel.guided', { timeout: 60000 });
  return { ctx, page, errors };
}

const lockState = (page) => page.evaluate(() => ({ lock: document.pointerLockElement?.id ?? null, world: window.casino.world.mouseCaptured }));
const camYaw = (page) =>
  page.evaluate(() => {
    const d = new window.casino.engine.camera.position.constructor();
    window.casino.engine.camera.getWorldDirection(d);
    return +Math.atan2(d.x, -d.z).toFixed(3);
  });
/** Wait up to `ms` for the lock to be (or not be) held. */
async function waitLock(page, want, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await lockState(page)).world === want) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

// --- mouse always held on the floor -----------------------------------------------------------------
if (checks.includes('lock')) {
  const { ctx, page, errors } = await openGame('world3_e2e', () => {
    localStorage.setItem('casino.quality', 'low');
    localStorage.removeItem('casino.mouse.capture');
  });
  const r = {};
  // a first visit for this name walks through the look first; either way end on the floor
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else {
    await page.click('.menu-item >> nth=0');
  }
  await page.waitForSelector('.hud', { timeout: 30000 });
  r.onEntry = await waitLock(page, true, 3000);
  // moving the mouse, no button held, turns the camera
  const y0 = await camYaw(page);
  for (let i = 1; i <= 12; i++) await page.mouse.move(640 + i * 14, 400);
  await page.waitForTimeout(300);
  r.turned = +Math.abs((await camYaw(page)) - y0).toFixed(3);
  await page.screenshot({ path: `${out}/world3-lock-floor.png` });
  // Esc frees the cursor; a click on the view takes it back
  await page.keyboard.press('Escape');
  r.escFrees = await waitLock(page, false);
  await page.waitForTimeout(1300); // Chrome refuses a lock straight after an Esc
  r.hintShown = await page.evaluate(() => !!document.querySelector('.world-hint:not([hidden])'));
  await page.screenshot({ path: `${out}/world3-lock-hint.png` });
  await page.mouse.click(640, 420);
  r.clickTakes = await waitLock(page, true);
  // an overlay takes the cursor and gives it back when it closes
  await page.evaluate(async () => {
    const k = await import('/casino/src/ui/keyboard.ts');
    const panel = document.createElement('div');
    document.body.append(panel);
    window.__release = k.holdKeyboard(panel, () => {});
  });
  r.overlayFrees = await waitLock(page, false);
  await page.evaluate(() => window.__release());
  r.overlayGivesBack = await waitLock(page, true);
  if (!r.overlayGivesBack) {
    await page.mouse.click(640, 420);
    r.overlayThenClick = await waitLock(page, true);
  }
  // typing (a text field with focus, as the chat line) frees it; done typing gives it back
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'w3-typing';
    document.getElementById('ui').append(input);
    input.focus();
  });
  r.typingFrees = await waitLock(page, false);
  await page.evaluate(() => {
    const input = document.getElementById('w3-typing');
    input.blur();
    input.remove();
  });
  r.typingGivesBack = await waitLock(page, true);
  if (!r.typingGivesBack) {
    await page.mouse.click(640, 420);
    await waitLock(page, true);
  }
  // sitting down frees it (tables need the cursor); standing up takes it again
  await page.evaluate(() => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === 'bj-1'));
  });
  r.seatedFrees = await waitLock(page, false);
  await page.waitForTimeout(1500);
  r.seatedClickRefused = await (async () => {
    await page.mouse.click(640, 300);
    await page.waitForTimeout(400);
    return !(await lockState(page)).world;
  })();
  await page.keyboard.press('Escape'); // closes the table choice, which stands you up
  await page.waitForTimeout(400);
  if (await page.evaluate(() => window.casino.world.seated !== null)) await page.evaluate(() => window.casino.world.exitTable());
  r.standTakes = await waitLock(page, true, 6000);
  if (!r.standTakes) {
    await page.mouse.click(640, 420);
    r.standThenClick = await waitLock(page, true);
  }
  // Settings: Drag turns the lock off at once, and clicks no longer take the mouse
  await page.evaluate(async () => (await import('/casino/src/world/mouse.ts')).setMouseSettings({ capture: false }));
  r.dragFrees = await waitLock(page, false);
  await page.mouse.click(640, 420);
  await page.waitForTimeout(400);
  r.dragNoLock = !(await lockState(page)).world;
  const d0 = await camYaw(page);
  await page.mouse.move(640, 420);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(640 + i * 12, 420);
  await page.mouse.up();
  r.dragTurns = +Math.abs((await camYaw(page)) - d0).toFixed(3);
  await page.evaluate(async () => (await import('/casino/src/world/mouse.ts')).setMouseSettings({ capture: true }));
  console.log(JSON.stringify({ check: 'lock', ...r, errors: errors.slice(0, 3) }));
  for (const k of ['onEntry', 'escFrees', 'clickTakes', 'overlayFrees', 'typingFrees', 'seatedFrees', 'seatedClickRefused', 'dragFrees', 'dragNoLock']) if (!r[k]) fail(`lock: ${k}`);
  if (r.turned < 0.2) fail(`lock: moving the mouse turned the camera only ${r.turned}`);
  if (r.dragTurns < 0.2) fail(`lock: dragging with the lock off turned the camera only ${r.dragTurns}`);
  if (!r.hintShown) fail('lock: no "click to look" hint after Esc');
  if (!(r.overlayGivesBack || r.overlayThenClick)) fail('lock: not held again after an overlay closed');
  if (!(r.standTakes || r.standThenClick)) fail('lock: not held again after standing up');
  if (errors.length) fail(`lock: ${errors[0]}`);
  await ctx.close();
}

// --- a new player picks a look before anything else ------------------------------------------------
if (checks.includes('onboard')) {
  // the fixed name, made new again: no rounds, just created, the default look (local database only)
  const NAME = 'world3_new';
  try {
    sql(`UPDATE casino_accounts SET look = '{}', created_at = ${Date.now()} WHERE name = '${NAME}'`);
  } catch {
    /* first run: login creates it */
  }
  const { ctx, page, errors } = await openGame(NAME, () => localStorage.setItem('casino.quality', 'high'));
  const r = {};
  r.guided = !!(await page.$('.editor-panel.guided'));
  if (r.guided) {
    await page.waitForTimeout(2500); // the model and the framing
    r.title = await page.textContent('.editor-panel .sheet-title');
    const steps = [];
    for (let i = 0; i < 3; i++) {
      steps.push(await page.textContent('.ed-step-name'));
      await page.screenshot({ path: `${out}/world3-onboard-${i + 1}.png` });
      if (i === 2) {
        // Surprise me deals a whole new look: the clothes' chosen swatches change
        const picked = () => page.$$eval('.editor-panel [role=radiogroup] [aria-checked=true]', (els) => els.map((e) => e.getAttribute('aria-label')).join('|'));
        const before = await picked();
        await page.click('.ed-buttons .btn.ed-reset');
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${out}/world3-onboard-surprise.png` });
        r.surpriseChanged = before !== (await picked());
      }
      await page.click('.editor-panel .ed-buttons .btn.primary');
      await page.waitForTimeout(600);
    }
    r.steps = steps;
    await page.waitForSelector('.hud', { timeout: 30000 });
    r.lockedOnEntry = await waitLock(page, true, 3000);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/world3-onboard-floor.png` });
    const me = await page.evaluate(async () => {
      const api = await import('/casino/src/net/api.ts');
      return (await api.me()).look;
    });
    r.saved = me;
    r.notDefault = !(me.body === 'm' && me.outfit === 'suit' && me.top === '#1f2430' && me.bottom === '#1f2430');
  }
  await ctx.close();
  // back again: not new any more, so the menu as usual
  const again = await openGame(NAME);
  r.secondVisitMenu = !!(await again.page.$('.menu-item')) && !(await again.page.$('.editor-panel.guided'));
  await again.ctx.close();
  // an older account still in the default suit gets its own look on entering (and keeps it)
  const OLD = 'world3_old';
  const first = await openGame(OLD);
  if (await first.page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await first.page.click('.editor-panel .ed-buttons .btn.primary');
    await first.page.waitForSelector('.hud', { timeout: 30000 });
  }
  await first.ctx.close();
  sql(`UPDATE casino_accounts SET look = '{}', created_at = ${Date.now() - 86400000} WHERE name = '${OLD}'`);
  const old = await openGame(OLD);
  await old.page.click('.menu-item >> nth=0');
  await old.page.waitForSelector('.hud', { timeout: 30000 });
  await old.page.waitForTimeout(1500);
  const oldLook = await old.page.evaluate(async () => (await (await import('/casino/src/net/api.ts')).me()).look);
  r.oldGotLook = !(oldLook.body === 'm' && oldLook.outfit === 'suit' && oldLook.top === '#1f2430' && oldLook.bottom === '#1f2430');
  await old.ctx.close();
  console.log(JSON.stringify({ check: 'onboard', ...r, errors: errors.slice(0, 3) }));
  if (!r.guided) fail('onboard: a new player went past the look');
  if (r.guided && r.title !== 'Pick your look') fail(`onboard: title ${r.title}`);
  if (r.guided && !r.surpriseChanged) fail('onboard: Surprise me did not change the look');
  if (r.guided && !r.lockedOnEntry) fail('onboard: the mouse was not held on entering the floor');
  if (r.guided && !r.notDefault) fail('onboard: the saved look is the default suit');
  if (!r.secondVisitMenu) fail('onboard: a returning player did not get the menu');
  if (!r.oldGotLook) fail('onboard: an account in the default suit kept it on entering');
  if (errors.length) fail(`onboard: ${errors[0]}`);
}

// --- bloom you can see through: seated at baccarat with the cards out, on High ----------------------
// A round of baccarat (a banker bet), then the table and its cards as the player sees them. The
// numbers are the brightest card pixels and how much the glow lifts the felt beside them.
if (checks.includes('bloom')) {
  const { ctx, page, errors } = await openGame('world3_e2e', () => localStorage.setItem('casino.quality', 'high'));
  if (await page.$('.editor-panel.guided')) {
    for (let i = 0; i < 3; i++) await page.click('.editor-panel .ed-buttons .btn.primary');
  } else {
    await page.click('.menu-item >> nth=0');
  }
  await page.waitForSelector('.hud', { timeout: 30000 });
  const station = process.env.BLOOM_STATION ?? 'bc-1';
  await page.evaluate((id) => {
    const w = window.casino.world;
    w.enter(w.stations.find((s) => s.id === id));
  }, station);
  await page.waitForSelector('.lobby-choice', { timeout: 20000 });
  await page.keyboard.press('s');
  await page.waitForSelector('.modal input[type=number]', { timeout: 30000 });
  await page.fill('.modal input[type=number]', '1000');
  await page.click('.modal .btn.primary');
  await page.waitForFunction(() => window.casino.app.table?.seated === true, null, { timeout: 30000 });
  await page.evaluate(() => {
    const s = window.casino.app.table.session;
    s.__done = false;
    const orig = s.onMessage.bind(s);
    s.onMessage = (m) => {
      orig(m);
      if (m.t === 'ev' && m.events.some((e) => ['result', 'settle', 'done'].includes(e.type))) s.__done = true;
    };
    setTimeout(() => s.link.act({ type: 'bet', banker: 2500 }), 300);
    setTimeout(() => s.link.act({ type: 'deal' }), 1000);
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && !(await page.evaluate(() => window.casino.app.table?.session.__done))) await page.waitForTimeout(1000);
  await page.waitForTimeout(6000);
  const file = `${out}/world3-bloom-${station}.png`;
  await page.screenshot({ path: file });
  console.log(JSON.stringify({ check: 'bloom', station, file, errors: errors.slice(0, 3) }));
  if (errors.length) fail(`bloom: ${errors[0]}`);
  await ctx.close();
}

await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
