#!/usr/bin/env node
// Headless checks for the v6 building fixes (the dev floor, Vite only). Usage:
//   node scripts/e2e/world6.mjs [port] [out dir] [checks...]
//   checks: zfight doors palms directory boutique prompts (default: all)
// zfight: in each zone (the casino, the ground floor, the roof) every mesh in the scene as drawn
//   (the building's batch, the glows, furniture, props, signs, the directory, the stations'
//   models), in world space, through zfight.ts: two differently dressed faces in one plane that
//   overlap where anyone can look. Fails on any, the stations' and props' own models included; a
//   far stand-in against its own live model is only counted (lod.ts never draws both), and two
//   see-through overlays that don't write depth (a light pool, a blob shadow) can't fight.
// doors: close-ups of both jambs of every doorway from both sides (doors-<id>-<room>-<jamb>.png).
// palms: every palm and plant from the side, the trunk against its planter's middle
//   (palm-<n>.png), and the measured trunk base against the planter's centre.
// directory: the lobby's board from the way in (directory-*.png), E on it opens it big.
// boutique: the shop from its door and the prompt at the counter's end (boutique-*.png).
// prompts: walks up to every E spot the floor offers (the boutique's counter and mannequins, the
//   bar, each teller window, the cashier, seats, computers, the directory) from its natural
//   approach and checks the prompt says the right thing, and that a station next to a spot still
//   wins (a video poker machine over the bartender's Order, a computer over its chair).
// GPU=1 renders on the machine's GPU (Metal); otherwise SwiftShader.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [port = '6200', out = '/tmp/world6', ...wanted] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const all = ['zfight', 'doors', 'palms', 'directory', 'boutique', 'prompts'];
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
  // each zone with the player standing in it (the ground floor and the roof are built and shown there)
  for (const zone of ['casino', 'ground', 'roof']) {
  const r = await page.evaluate(async ([zone, root]) => {
    const Z = await import('/casino/src/world/zfight.ts');
    const ZN = await import(`/casino/@fs${root}/shared/src/zones.ts`);
    const LF = await import(`/casino/@fs${root}/shared/src/lifts.ts`);
    const L = await import('/casino/src/world/layout.ts');
    const { THREE, world, engine } = window.casino;
    const plan = world.plan;
    if (zone !== 'casino') {
      const a = LF.LIFTS[zone].arrive;
      world.teleport(a.x / 100, a.z / 100, 0);
      if (zone === 'ground') {
        // the game adds the valet, the parked cars, your garage (a few cars in it) and the jail (app/boot.ts)
        const { Cars } = await import('/casino/src/world/cars/index.ts');
        const { buildJail } = await import('/casino/src/world/law/jail.ts');
        const cars = new Cars({ engine, world, now: () => Date.now(), me: () => 1, onValet() {}, onKeys() {}, standIns: true });
        await cars.load();
        cars.setOwned(['halden-roadster', 'raffica-v10', 'ombra-oro', 'solenne-cabriolet'], 'Zed');
        cars.group.visible = true;
        engine.scene.add(buildJail({ quality: world.quality, collider: world.collider }).group);
      }
      for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    }
    world.rooms.showAll(true);
    world.lod.pin?.(null, null);
    engine.scene.updateMatrixWorld(true);
    const surfaces = [];
    const overlays = new Set();
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
      // see-through and not writing depth (a light pool, a blob shadow): two of those on one plane
      // can't fight each other (neither hides the other), only something solid under them
      const overlay = material && [material].flat().every((x) => x.transparent && !x.depthWrite);
      if (overlay) overlays.add(`${name} (${mat})`);
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
    const unseen = ([x, y, z], n) => {
      const ny = n[1];
      if (zone !== 'casino') {
        // this zone's own patch of the world, its ground's underside left out
        const Q = ZN.ZONES[zone];
        if (x * 100 < Q.minX || x * 100 > Q.maxX || z * 100 < Q.minZ || z * 100 > Q.maxZ) return true;
        // a face on the zone's edge facing out of it: nobody stands out there
        const [nx, , nz] = n;
        if ((nx > 0.99 && x * 100 > Q.maxX - 0.1) || (nx < -0.99 && x * 100 < Q.minX + 0.1) || (nz > 0.99 && z * 100 > Q.maxZ - 0.1) || (nz < -0.99 && z * 100 < Q.minZ + 0.1)) return true;
        return ny < -0.99 && y < 0.001;
      }
      const R = plan.room;
      if (x < R.x0 + 0.001 || x > R.x1 - 0.001 || z < R.z0 + 0.001 || z > R.z1 - 0.001) return true;
      if (ny < -0.99 && y < 0.001) return true;
      return ny > 0.99 && y > L.ceilingAt(plan, x, z) - 0.001;
    };
    const t = performance.now();
    const fights = Z.findFights(surfaces, { unseen }).filter((f) => !(overlays.has(f.a) && overlays.has(f.b)));
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
      // a station's model against anything but a stand-in: the games' own models
      stations: fights.filter((f) => (kind(f.a) === 'station' || kind(f.b) === 'station') && kind(f.a) !== 'far' && kind(f.b) !== 'far').map(Z.describeFight),
      // a stand-in against its live model or itself: lod.ts shows one or the other, never both
      swaps: fights.filter((f) => ((kind(f.a) === 'station' || kind(f.b) === 'station') && (kind(f.a) === 'far' || kind(f.b) === 'far')) || ownCopy(f)).length,
    };
  }, [zone, process.cwd()]);
  console.log(`zfight ${zone}: ${r.surfaces} surfaces, ${r.tris} triangles (${r.skinned} skinned meshes left out), ${r.ms} ms`);
  for (const f of r.building) fail(`z-fight ${f}`);
  for (const f of r.own) fail(`z-fight inside a prop's own model ${f}`);
  for (const f of r.far) fail(`z-fight in the far stand-ins ${f}`);
  for (const f of r.stations) fail(`z-fight inside a station's model ${f}`);
  if (r.swaps) console.log(`  a stand-in against its own live model (never drawn together): ${r.swaps}`);
  // the distinct kinds: a station's id and an instance's number left out, a stand-in against its own station left out (never drawn together)
  const kinds = new Map();
  for (const f of r.stations) {
    const m = /^\(([^)]*)\) facing [^:]*: (.*) vs (.*), ([0-9.]+) cm², ([0-9.]+) mm apart$/.exec(f);
    if (!m) continue;
    const [, , a, b, , mm] = m;
    const sa = /^station ([a-z0-9-]+)/.exec(a)?.[1] ?? /^far:([a-z0-9-]+)/.exec(a)?.[1];
    const sb = /^station ([a-z0-9-]+)/.exec(b)?.[1] ?? /^far:([a-z0-9-]+)/.exec(b)?.[1];
    if ((a.startsWith('far:') || b.startsWith('far:')) && (a.startsWith('far:solid') || b.startsWith('far:solid') || sa === sb)) continue;
    const k = `${a} vs ${b}`.replace(/station [a-z]+-?[a-z]*-\d+:|far:[a-z]+-\d+:/g, '').replace(/#\d+/g, '');
    const e = kinds.get(k) ?? { n: 0, mm, eg: f };
    e.n++;
    kinds.set(k, e);
  }
  if (kinds.size) console.log(`  station kinds (${kinds.size}):`);
  for (const [k, e] of [...kinds].sort((x, y) => y[1].n - x[1].n)) console.log(`    ${e.n}x ${k} (${e.mm} mm) e.g. ${e.eg}`);
  }
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

// --- palms and plants in their planters ----------------------------------------------------------
if (checks.includes('palms')) {
  const { page } = await openFloor('quality=high&view=overview');
  const r = await page.evaluate(() => {
    const { THREE, world, engine } = window.casino;
    const plan = world.plan;
    world.rooms.showAll(true);
    engine.scene.updateMatrixWorld(true);
    const props = engine.scene.getObjectByName('props');
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const out = [];
    // each instance's foot (its lowest few centimetres) against the planter it stands in
    for (const [kind, list] of [
      ['palm', plan.palms],
      ['plant-a', plan.plants.filter((p) => p.kind === 'plant-a')],
      ['plant-b', plan.plants.filter((p) => p.kind === 'plant-b')],
    ]) {
      const g = props.getObjectByName(`prop:${kind}`);
      const meshes = g ? g.children.filter((c) => c.isInstancedMesh) : [];
      for (let i = 0; i < (meshes[0]?.count ?? 0); i++) {
        const pts = [];
        for (const mesh of meshes) {
          mesh.getMatrixAt(i, m);
          const pos = mesh.geometry.attributes.position;
          for (let k = 0; k < pos.count; k++) {
            v.fromBufferAttribute(pos, k).applyMatrix4(m).applyMatrix4(mesh.matrixWorld);
            pts.push([v.x, v.y, v.z]);
          }
        }
        const y0 = Math.min(...pts.map((p) => p[1]));
        const foot = pts.filter((p) => p[1] < y0 + 0.06);
        const fx = (Math.min(...foot.map((p) => p[0])) + Math.max(...foot.map((p) => p[0]))) / 2;
        const fz = (Math.min(...foot.map((p) => p[2])) + Math.max(...foot.map((p) => p[2]))) / 2;
        // the planter under it
        let best = null;
        for (const p of list) {
          const d = Math.hypot(p.x - fx, p.z - fz);
          if (!best || d < best.d) best = { p, d };
        }
        out.push({ kind, i, off: best ? +best.d.toFixed(3) : null, at: best ? [best.p.x, best.p.z, best.p.size, best.p.room] : null });
      }
    }
    return out;
  });
  for (const p of r) {
    if (p.off === null) fail(`${p.kind} #${p.i} stands in no planter`);
    else if (p.off > 0.03) fail(`${p.kind} #${p.i} (${p.at[3]}) stands ${p.off} m off its planter's middle`);
  }
  console.log(`palms: ${r.length} palms and plants, the furthest foot ${Math.max(...r.map((p) => p.off ?? 0)).toFixed(3)} m off its planter's middle`);
  // each palm from beside it, low, the way 2.png saw it
  const palms = r.filter((p) => p.kind === 'palm');
  for (const [n, p] of palms.entries()) {
    const [x, z] = p.at;
    await camera(page, [x + 1.6, 1.05, z + 1.1], [x, 0.75, z], 50);
    await frames(page, 8);
    await page.screenshot({ path: `${out}/palm-${n + 1}-${p.at[3]}.png` });
  }
  await page.close();
}

// --- the directory board: in view from the way in, and E opens it big -----------------------------
if (checks.includes('directory')) {
  const { page } = await openFloor('quality=high');
  const board = await page.evaluate(() => {
    const f = window.casino.world.plan.furniture.find((q) => q.kind === 'directory');
    return f ? { x: f.x, z: f.z, yaw: f.yaw } : null;
  });
  if (!board) fail('no directory board in the lobby');
  else {
    // from the spawn (the camera behind the player, as a player comes in) and from part way over
    await page.evaluate(() => window.casino.world.teleport(0, 12.8, Math.PI));
    await frames(page, 20);
    await page.screenshot({ path: `${out}/directory-spawn.png` });
    const view = await page.evaluate(({ x, z }) => {
      // is the board's face in the camera's view, and nothing solid of the palms' in the way?
      const { THREE, engine } = window.casino;
      const cam = engine.camera;
      const v = new THREE.Vector3(x, 1.46, z).project(cam);
      const ray = new THREE.Raycaster(cam.position.clone(), new THREE.Vector3(x, 1.46, z).sub(cam.position).normalize());
      const hits = ray.intersectObjects(engine.scene.getObjectByName('props')?.children ?? [], true).filter((h) => h.distance < cam.position.distanceTo(new THREE.Vector3(x, 1.46, z)) - 0.1);
      return { onScreen: Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && v.z < 1, blocked: hits.map((h) => h.object.parent?.name ?? h.object.name) };
    }, board);
    if (!view.onScreen) fail('the directory is out of view from the spawn');
    if (view.blocked.length) fail(`the directory is hidden from the spawn behind ${[...new Set(view.blocked)].join(', ')}`);
    // walk up to it: 1.4 m in front of it, facing it
    const at = { x: board.x + Math.sin(board.yaw) * 1.4, z: board.z + Math.cos(board.yaw) * 1.4 };
    await page.evaluate(({ x, z, yaw }) => window.casino.world.teleport(x, z, yaw + Math.PI), { ...at, yaw: board.yaw });
    await frames(page, 12);
    const prompt = await page.evaluate(() => document.querySelector('.world-prompt:not([hidden])')?.textContent ?? '');
    if (!/Read the directory/.test(prompt)) fail(`at the directory the prompt says "${prompt}"`);
    await page.screenshot({ path: `${out}/directory-near.png` });
    await page.keyboard.press('KeyE');
    await frames(page, 12);
    const sheet = await page.evaluate(() => {
      const s = document.querySelector('.map-sheet');
      return s ? { title: s.querySelector('h2, .sheet-title')?.textContent ?? s.textContent.slice(0, 40), w: s.getBoundingClientRect().width } : null;
    });
    if (!sheet) fail('E at the directory opened nothing');
    else if (!/Floor Directory/.test(sheet.title)) fail(`E at the directory opened "${sheet.title}"`);
    await page.screenshot({ path: `${out}/directory-open.png` });
    console.log(`directory: at ${board.x.toFixed(2)}, ${board.z.toFixed(2)}; in view from the spawn; E opens "${sheet?.title}" (${Math.round(sheet?.w ?? 0)} px wide)`);
  }
  await page.close();
}

// --- the boutique: the counter reads as the place to buy -------------------------------------------
if (checks.includes('boutique')) {
  const { page } = await openFloor('quality=high');
  const k = await page.evaluate(async () => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    return lifePoints(window.casino.world.plan).boutique.counter;
  });
  // from the shop's door, the way in from the lobby
  await camera(page, [7.6, 1.7, 9.5], [k.x, 1.5, (k.z0 + k.z1) / 2], 60);
  await frames(page, 10);
  await page.screenshot({ path: `${out}/boutique-door.png` });
  // walked up to the counter's north end, looking at it: the prompt
  await page.evaluate(() => {
    window.__cam?.();
    window.__cam = null;
    window.casino.world.player.setEnabled(true);
    window.casino.world.player.character.root.visible = true;
  });
  await page.evaluate(({ x, z }) => {
    const { world } = window.casino;
    world.teleport(x - 1.0, z, 0);
    world.life.seating.player.camYaw = Math.atan2(1.0, -0.8) + Math.PI;
  }, { x: k.x, z: k.z0 + 0.8 });
  await frames(page, 20);
  await page.screenshot({ path: `${out}/boutique-counter.png` });
  await page.close();
}

// --- every E spot, from the way you'd walk up to it ----------------------------------------------
if (checks.includes('prompts')) {
  const { page } = await openFloor('quality=low');
  const r = await page.evaluate(async () => {
    const { lifePoints } = await import('/casino/src/world/life-points.ts');
    const { world } = window.casino;
    const plan = world.plan;
    const pts = lifePoints(plan);
    const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const prompt = () => {
      const e = document.querySelector('.world-prompt');
      return e && !e.hidden ? e.textContent : '';
    };
    const player = world.life.seating.player;
    // stand at (x, z) with the body facing `face` and the camera looking toward (lx, lz)
    const at = async (x, z, face, look) => {
      world.teleport(x, z, face);
      if (look) player.camYaw = Math.atan2(look[0] - x, look[1] - z) + Math.PI;
      await frame();
      await frame();
      return prompt();
    };
    const out = [];
    const want = async (what, re, x, z, face, look) => {
      const got = await at(x, z, face, look);
      out.push({ what, ok: re.test(got), got });
    };
    const b = pts.boutique;
    if (b) {
      const k = b.counter;
      // along the whole counter front: walking along it (the body faces along), looking at it
      for (const t of [0.1, 0.5, 0.9]) {
        const z = k.z0 + (k.z1 - k.z0) * t;
        await want(`boutique counter at ${t}`, /Browse the boutique/, k.x - 0.9, z, 0, [k.x, z]);
        await want(`boutique counter at ${t}, facing it`, /Browse the boutique/, k.x - 1.3, z, Math.PI / 2);
      }
      for (const [i, m] of b.mannequins.entries()) {
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const x = m.at.x + Math.sin(a) * (m.at.r + 0.7);
          const z = m.at.z + Math.cos(a) * (m.at.r + 0.7);
          // skip sides against a wall or another piece (nobody stands there)
          if (!plan.rooms.find((r) => r.id === 'boutique') || x < 7.4 || x > 16.6 || z < 3.4 || z > 14.6) continue;
          await want(`mannequin ${i + 1} from ${Math.round((a * 180) / Math.PI)}°`, /Browse · /, x, z, a + Math.PI);
        }
      }
      for (const [i, c] of b.cases.entries()) await want(`case ${i + 1}`, /Browse the cases/, c.x, c.z, c.yaw);
    }
    // each teller window, straight on and off to either side
    for (const [i, w] of pts.bank.windows.entries()) {
      for (const dx of [-0.6, 0, 0.6]) await want(`teller ${i + 1} ${dx}`, /Bank/, w.front.x + dx, w.front.z + 0.9, Math.PI);
    }
    // the bar, along its front, looking at the counter
    const f = pts.bar.front;
    for (const t of [0.35, 0.6, 0.85]) {
      const z = f.z0 + (f.z1 - f.z0) * t;
      await want(`bar at ${t}`, /Order|Sit|Video Poker/, (f.x0 + f.x1) / 2, z, 0, [f.x1 + 1, z]);
    }
    // the video poker machines in the counter and the computers at their desks: the station first
    for (const s of world.stations.filter((q) => q.game === 'videopoker' || q.zone === 'online')) {
      const d = s.footprint.depth / 2 + 0.7;
      await want(`${s.id} over its neighbours`, new RegExp(s.name), s.anchor.position.x + Math.sin(s.yaw) * d, s.anchor.position.z + Math.cos(s.yaw) * d, s.yaw + Math.PI);
    }
    return out;
  });
  for (const x of r) if (!x.ok) fail(`prompt at ${x.what}: "${x.got}"`);
  console.log(`prompts: ${r.filter((x) => x.ok).length}/${r.length} spots offer the right thing`);
  await page.close();
}

await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
