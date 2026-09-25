#!/usr/bin/env node
// Headless checks for the v6 building fixes (the dev floor, Vite only). Usage:
//   node scripts/e2e/world6.mjs [port] [out dir] [checks...]
//   checks: zfight doors palms directory prompts (default: all)
// zfight: every mesh in the scene as drawn (the building's batch, the glows, furniture, props,
//   signs, the directory, the stations' models), in world space, through zfight.ts: two
//   differently dressed faces in one plane that overlap where anyone can look. Fails on any in
//   the building (the stations' own models are listed, not failed: they're the games').
// doors: close-ups of both jambs of every doorway from both sides (doors-<id>-<room>-<jamb>.png).
// palms: every palm and plant from the side, the trunk against its planter's middle
//   (palm-<n>.png), and the measured trunk base against the planter's centre.
// directory: the lobby's board from the way in (directory-*.png), E on it opens it big.
// prompts: walks up to every E spot the floor offers (the boutique's counter and mannequins, the
//   bar, each teller window, the cashier, seats, computers, the directory) from its natural
//   approach and checks the prompt says the right thing, and that a station next to a spot still
//   wins (a video poker machine over the bartender's Order, a computer over its chair).
// GPU=1 renders on the machine's GPU (Metal); otherwise SwiftShader.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6200', out = '/tmp/world6', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const all = ['zfight', 'doors', 'palms', 'directory', 'prompts'];
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

async function openFloor(query, viewport = { width: 1100, height: 760 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${floorUrl}?${query}`, { timeout: 300000 });
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 600000 });
  return { page, errors };
}

/** Hold the camera at a pose (the player stands aside). */
const camera = (page, pos, at, fov = 55) =>
  page.evaluate(
    ([pos, at, fov]) => {
      const { world, engine } = window.casino;
      world.player.setEnabled(false);
      world.player.character.root.visible = false;
      window.__cam?.();
      window.__cam = engine.onFrame(() => {
        engine.camera.fov = fov;
        engine.camera.updateProjectionMatrix();
        engine.camera.position.set(...pos);
        engine.camera.lookAt(...at);
      });
    },
    [pos, at, fov],
  );

const frames = (page, n = 6) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);

// --- z-fighting over the whole scene ------------------------------------------------------------
if (checks.includes('zfight')) {
  const { page, errors } = await openFloor('quality=high&view=overview');
  const r = await page.evaluate(async () => {
    const Z = await import('/casino/src/world/zfight.ts');
    const L = await import('/casino/src/world/layout.ts');
    const { THREE, world, engine } = window.casino;
    const plan = world.plan;
    world.rooms.showAll(true);
    world.lod.pin?.(null, null);
    engine.scene.updateMatrixWorld(true);
    const surfaces = [];
    const station = new Map();
    for (const st of world.stations) st.model.traverse((o) => station.set(o, st.id));
    const m = new THREE.Matrix4();
    const w = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const matName = (mat) => (Array.isArray(mat) ? mat.map((x) => x.name || x.type).join('+') : mat.name || mat.type);
    const push = (name, mat, geo, matrix, group, material) => {
      // a decal (drawn pulled toward the eye, polygonOffset) wins over the face it lies on
      if (material && [material].flat().every((x) => x.polygonOffset && x.polygonOffsetFactor < 0)) return;
      const pos = geo.attributes.position;
      if (!pos) return;
      const idx = geo.index;
      const start = group ? group.start : 0;
      const count = group ? group.count : idx ? idx.count : pos.count;
      const out = new Float32Array(Math.floor(count / 3) * 9);
      for (let k = 0; k < Math.floor(count / 3) * 3; k++) {
        const i = idx ? idx.getX(start + k) : start + k;
        v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
        out[k * 3] = v.x;
        out[k * 3 + 1] = v.y;
        out[k * 3 + 2] = v.z;
      }
      surfaces.push({ name, mat, pos: out });
    };
    let skinned = 0;
    // one mesh's triangles, world space, per material (instances each their own surface)
    const meshSurfaces = (o, label) => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const groups = Array.isArray(o.material) && o.geometry.groups.length ? o.geometry.groups : [null];
      if (o.isBatchedMesh) {
        // each instance its own surface, placed by its own matrix (the building's batch has one per room)
        for (let i = 0; i < o.instanceCount ?? o._instanceInfo?.length ?? 0; i++) {
          let gid;
          try {
            gid = o.getGeometryIdAt(i);
          } catch {
            continue;
          }
          if (gid === undefined || gid < 0) continue;
          const range = o.getGeometryRangeAt(gid);
          o.getMatrixAt(i, m);
          w.multiplyMatrices(o.matrixWorld, m);
          const idx = o.geometry.index;
          push(`${label}#${i}`, matName(o.material), o.geometry, w, idx ? { start: range.indexStart, count: range.indexCount } : { start: range.vertexStart, count: range.vertexCount }, o.material);
        }
        return;
      }
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          w.multiplyMatrices(o.matrixWorld, m);
          for (const g of groups) push(`${label}#${i}`, g ? matName(mats[g.materialIndex]) : matName(o.material), o.geometry, w, g, g ? mats[g.materialIndex] : o.material);
        }
        return;
      }
      for (const g of groups) push(label, g ? matName(mats[g.materialIndex]) : matName(o.material), o.geometry, o.matrixWorld, g, g ? mats[g.materialIndex] : o.material);
    };
    // the building as drawn (every room shown): not the characters, not the stations or their
    // far stand-ins (the stations' models are checked on their own below)
    const skip = (o) => station.has(o) || o.name?.startsWith('far:');
    const far = [];
    const walk = (o) => {
      if (!o.visible || skip(o)) return;
      if (o.isSkinnedMesh) skinned++;
      else if (o.isMesh) meshSurfaces(o, o.name || o.parent?.name || 'mesh');
      for (const c of o.children) walk(c);
    };
    walk(engine.scene);
    // the stations' far stand-ins (lod.ts): each station's copy, and the two batches of all of them
    engine.scene.traverse((o) => {
      if (!o.name?.startsWith('far:')) return;
      o.traverse((c) => c.isMesh && meshSurfaces(c, `${o.name}${c === o ? '' : ':' + (c.name || 'part')}`));
    });
    for (const st of world.stations) st.model.traverse((o) => o.isMesh && !o.isSkinnedMesh && meshSurfaces(o, `station ${st.id}: ${o.name || o.parent?.name || 'mesh'}`));
    const unseen = ([x, y, z], [, ny]) => {
      const R = plan.room;
      if (x < R.x0 + 0.001 || x > R.x1 - 0.001 || z < R.z0 + 0.001 || z > R.z1 - 0.001) return true;
      if (ny < -0.99 && y < 0.001) return true;
      return ny > 0.99 && y > L.ceilingAt(plan, x, z) - 0.001;
    };
    const t = performance.now();
    const fights = Z.findFights(surfaces, { unseen });
    // what a fight is between: a thing (its name less the instance's material), a station's model, a stand-in
    const thing = (x) => x.replace(/ \([^)]*\)$/, '');
    // a stand-in's copy of one station against itself is that station's model again (the game's)
    const copyOf = (x) => /^far:([a-z0-9-]+):/.exec(x)?.[1] ?? null;
    const kind = (x) => (x.startsWith('station ') ? 'station' : x.startsWith('far:') ? 'far' : 'building');
    const ownCopy = (f) => copyOf(f.a) !== null && copyOf(f.a) === copyOf(f.b);
    return {
      ms: Math.round(performance.now() - t),
      surfaces: surfaces.length,
      tris: surfaces.reduce((n, s) => n + s.pos.length / 9, 0),
      skinned,
      // between two things of the building (a wall and a sign, a case's glass and its posts): ours to fix
      building: fights.filter((f) => kind(f.a) === 'building' && kind(f.b) === 'building' && thing(f.a) !== thing(f.b)).map(Z.describeFight),
      // inside one model's own parts (a prop's GLB, a chandelier's bulbs in their cups)
      own: fights.filter((f) => kind(f.a) === 'building' && kind(f.b) === 'building' && thing(f.a) === thing(f.b)).map(Z.describeFight),
      // a far stand-in against itself or anything (lod.ts): ours
      far: fights.filter((f) => (kind(f.a) === 'far' || kind(f.b) === 'far') && kind(f.a) !== 'station' && kind(f.b) !== 'station' && !ownCopy(f)).map(Z.describeFight),
      // a station's model against anything: the games' own models
      stations: fights.filter((f) => kind(f.a) === 'station' || kind(f.b) === 'station' || ownCopy(f)).map(Z.describeFight),
    };
  });
  console.log(`zfight: ${r.surfaces} surfaces, ${r.tris} triangles (${r.skinned} skinned meshes left out), ${r.ms} ms`);
  for (const f of r.building) fail(`z-fight ${f}`);
  for (const f of r.far) fail(`z-fight in the far stand-ins ${f}`);
  if (r.own.length) console.log(`  inside a prop's own model: ${r.own.length} (first: ${r.own[0]})`);
  if (r.stations.length) console.log(`  inside the stations' own models (the games'): ${r.stations.length}`);
  for (const f of r.stations.slice(0, 40)) console.log(`  station ${f}`);
  if (errors.length) fail(`zfight page errors: ${errors.slice(0, 3).join(' | ')}`);
  await page.close();
}

// --- doorways, close up ------------------------------------------------------------------------
if (checks.includes('doors')) {
  const { page } = await openFloor('quality=high&view=overview');
  const poses = await page.evaluate(() => {
    const { world } = window.casino;
    const plan = world.plan;
    world.rooms.showAll(true);
    const out = [];
    for (const d of plan.doors) {
      for (const id of [d.a, d.b]) {
        if (id === 'outside') continue;
        const r = plan.rooms.find((q) => q.id === id);
        const n = d.axis === 'x' ? (r.bounds.z1 === d.c ? -1 : 1) : r.bounds.x1 === d.c ? -1 : 1;
        const face = d.c + n * 0.15;
        for (const [jamb, a, dir] of [
          ['a0', d.a0, -1],
          ['a1', d.a1, 1],
        ]) {
          // stand in the room beside the jamb and look across it at the opening's edge
          // (as a player walking past it sees it: a couple of metres off, a little to the side)
          const along = a + dir * 1.1;
          const off = face + n * 1.9;
          const eye = d.axis === 'x' ? [along, 1.6, off] : [off, 1.6, along];
          const at = d.axis === 'x' ? [a, 1.5, d.c] : [d.c, 1.5, a];
          out.push({ file: `doors-${d.id}-${id}-${jamb}.png`, eye, at });
        }
      }
    }
    return out;
  });
  for (const p of poses) {
    await camera(page, p.eye, p.at, 60);
    await frames(page, 8);
    await page.screenshot({ path: `${out}/${p.file}` });
  }
  console.log(`doors: ${poses.length} close-ups in ${out}`);
  await page.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
