// What the 3D model shows, read in the page (the pocket under the roulette ball, the dice's top
// faces by their own pips, the stop under a wheel's clapper, each slot reel's place on its strip,
// how far the camera is from the table's rest pose). Shared by anim.mjs (the dev harness) and
// journey.mjs (the game proper): evaluate `(${READ_MODEL.toString()})()` in the page once seated.

export const READ_MODEL = () => {
  const TAU = Math.PI * 2;
  const mod = (a, n) => ((a % n) + n) % n;
  const { engine } = window.casino;
  // the dev harness's table session, or the one the game proper is sitting at
  const table = window.casino.table ?? window.casino.app.table.session;
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
