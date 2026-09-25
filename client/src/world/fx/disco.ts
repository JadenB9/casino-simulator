// Disco Night: in the buyer's room a mirror ball comes down from the ceiling on its cable and turns,
// two pin spots light it and it throws hundreds of points of light that sweep round the floor and
// the walls; four coloured moving heads swing their beams across the room, and the room's own light
// drops to a dim violet so all of it shows. A groove plays (audio/fx.ts). A minute, then the ball
// goes back up and the lights come back.
//
// The points of light are one shader over the room's floor and walls (a thin shell just proud of
// them, built from the plan's wall pieces, so doorways and shop windows stay clear): each point on
// the shell looks back at the ball, finds which mirror tile would send light there as the ball
// turns, and lights up if one does. The moving heads' pools are worked out in the same shader.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FxEvent } from '../../../../shared/src/items.ts';
import { WALL, ceilingAt, inRect, type FloorPlan, type PlannedRoom } from '../layout.ts';
import { aimBeam } from './particles.ts';
import type { Stock } from './stock.ts';
import type { Effect, FxWorld } from './types.ts';
import { fxRoom } from './scope.ts';
import { envelope } from './timing.ts';

const BALL_R = 0.3;
/** The moving heads' colours: magenta, cyan, amber, violet. */
const HEADS = ['#ff2d95', '#1fd2ff', '#ffb01f', '#8a4dff'];
/** How long the ball takes to come down, and to go back up at the end. */
const DOWN = 4;
const UP = 3;

/** Something hanging from a ceiling the ball must keep clear of (a chandelier, a sign). */
export interface Hanger {
  x: number;
  z: number;
  r: number;
}

/** Where the ball hangs in a room: its middle, or the nearest place near it clear of what hangs there. */
export function ballSpot(room: PlannedRoom, hangers: readonly Hanger[]): { x: number; z: number } {
  const L = room.inner;
  const cx = (L.x0 + L.x1) / 2;
  const cz = (L.z0 + L.z1) / 2;
  for (let ring = 0; ring < 8; ring++) {
    const n = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * ring * 0.8;
      const z = cz + Math.sin(a) * ring * 0.8;
      if (!inRect(L, x, z, -1.5)) continue;
      if (hangers.every((h) => Math.hypot(h.x - x, h.z - z) >= h.r + 0.9)) return { x, z };
    }
  }
  return { x: cx, z: cz };
}

export function disco(w: FxWorld, stock: Stock, ev: FxEvent, late: boolean, hangers: readonly Hanger[]): Effect | null {
  const room = fxRoom(w.plan, ev);
  if (!room) return null;
  const q = w.quality();
  const secs = (ev.until - ev.at) / 1000;
  const group = new THREE.Group();
  group.name = 'fx-disco';
  w.root.add(group);

  const spot = ballSpot(room, hangers);
  const ceiling = ceilingAt(w.plan, spot.x, spot.z);
  const low = Math.max(2.7, Math.min(ceiling - 1.3, 4.4));
  const high = ceiling - 0.2 - BALL_R;
  const ball = new THREE.Mesh(ballGeometry(), ballMaterial());
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 6).translate(0, -0.5, 0), stock.dark(q));
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.14, 16).translate(0, -0.07, 0), stock.dark(q));
  motor.position.set(spot.x, ceiling, spot.z);
  group.add(ball, cable, motor);

  // the room's floor and walls, lit by the ball and the heads
  const shell = new THREE.Mesh(shellGeometry(w.plan, room), shellMaterial());
  shell.frustumCulled = false;
  group.add(shell);

  // the beams: four coloured heads round the ball, two white pin spots on it
  const L = room.inner;
  const heads = HEADS.map((c, i) => {
    const a = (i / HEADS.length) * Math.PI * 2 + Math.PI / 4;
    const x = Math.min(L.x1 - 0.7, Math.max(L.x0 + 0.7, spot.x + Math.cos(a) * 2.6));
    const z = Math.min(L.z1 - 0.7, Math.max(L.z0 + 0.7, spot.z + Math.sin(a) * 2.6));
    return { from: new THREE.Vector3(x, ceilingAt(w.plan, x, z) - 0.15, z), to: new THREE.Vector3(), dir: new THREE.Vector3(), color: new THREE.Color(c) };
  });
  const pins = [-1, 1].map((s) => {
    const x = Math.min(L.x1 - 0.5, Math.max(L.x0 + 0.5, spot.x + s * 3.2));
    const z = Math.min(L.z1 - 0.5, Math.max(L.z0 + 0.5, spot.z - 1.2 * s));
    return new THREE.Vector3(x, ceilingAt(w.plan, x, z) - 0.12, z);
  });
  const beamMat = stock.beam().clone();
  beamMat.uniforms.uColor!.value = new THREE.Color(1, 1, 1);
  const beams = new THREE.InstancedMesh(stock.beamGeo, beamMat, heads.length + pins.length);
  beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((heads.length + pins.length) * 3), 3);
  beams.frustumCulled = false;
  heads.forEach((h, i) => beams.setColorAt(i, h.color));
  pins.forEach((_, i) => beams.setColorAt(heads.length + i, _white.setRGB(0.55, 0.52, 0.48)));
  group.add(beams);

  const su = (shell.material as THREE.ShaderMaterial).uniforms;
  const bu = (ball.material as THREE.ShaderMaterial).uniforms;
  su.uHeadPos!.value = heads.map((h) => h.from);
  su.uHeadDir!.value = heads.map((h) => h.dir);
  su.uHeadCol!.value = heads.map((h) => h.color);
  bu.uPins!.value = pins;

  let stopSound: (() => void) | null = null;
  let heard = false;
  /** The room the camera was in last frame (the groove is muffled through the walls). */
  let here = '';
  let spin = Math.random() * 6;
  /** The heads' sweep, run on its own clock so it can slow down without jumping. */
  let sweep = 0;
  const tint = new THREE.Color();
  const _m = new THREE.Matrix4();

  return {
    update(dt, t, left, view) {
      here = view.here;
      const insideRoom = here === room.id;
      if (!heard && t >= 0) {
        heard = true;
        // a late page joins the groove where it is (it's a loop: it doesn't matter where)
        stopSound = w.sounds?.disco({ x: spot.x, y: low, z: spot.z }, Math.max(1, left), () => here === room.id) ?? null;
      }
      // the ball: down on its cable, turning; back up at the end
      const down = late ? 1 : Math.min(1, t / DOWN);
      const up = Math.min(1, left / UP);
      const y = high + (low - high) * ease(Math.min(down, up));
      // with flashing and motion turned down: a slow turn, slow steady sweeps, no twinkle or glints
      const still = w.calm();
      spin += dt * (still ? 0.15 : 0.55);
      sweep += dt * (still ? 0.3 : 1);
      ball.position.set(spot.x, y, spot.z);
      ball.rotation.y = spin;
      cable.position.set(spot.x, ceiling, spot.z);
      cable.scale.set(1, Math.max(0.01, ceiling - y - BALL_R), 1);
      // the light show runs while the ball is down
      const k = envelope(late ? t + DOWN : t, left, DOWN * 0.8, UP);
      for (const [i, h] of heads.entries()) {
        const s = sweep * (0.23 + i * 0.041) + i * 1.7;
        h.to.set(spot.x + Math.sin(s) * (L.x1 - L.x0) * 0.33, 0, spot.z + Math.cos(s * 1.31 + i) * (L.z1 - L.z0) * 0.33);
        h.dir.subVectors(h.to, h.from).normalize();
        beams.setMatrixAt(i, aimBeam(_m, h.from, h.to, 0.55));
      }
      pins.forEach((p, i) => beams.setMatrixAt(heads.length + i, aimBeam(_m, p, _v.set(spot.x, y, spot.z), 0.12)));
      beams.instanceMatrix.needsUpdate = true;
      beamMat.uniforms.uK!.value = (q === 'high' ? 0.3 : 0.42) * k;
      beamMat.uniforms.uTime!.value = t;
      su.uBall!.value.set(spot.x, y, spot.z);
      su.uSpin!.value = spin;
      su.uK!.value = k * (q === 'high' ? 1 : 1.4);
      su.uTime!.value = t;
      su.uCalm!.value = still ? 1 : 0;
      bu.uTime!.value = t;
      bu.uK!.value = (0.35 + 0.65 * k) * (still ? 0.2 : 1);
      bu.uCalm!.value = still ? 1 : 0;
      // the room's light, only for those in it: dim, and slowly shifting from violet to magenta
      if (insideRoom && k > 0.01) {
        if (still) tint.set('#5a34d8');
        else tint.set('#4a2cff').lerp(_c.set('#ff2d95'), 0.5 + 0.5 * Math.sin(t * 0.35));
        w.lighting.setTint(`disco:${ev.id}:${ev.at}`, { color: tint, k: 0.7 * k, dim: 1 - (still ? 0.45 : 0.65) * k });
      } else {
        w.lighting.setTint(`disco:${ev.id}:${ev.at}`, null);
      }
      if (left <= 0) {
        w.lighting.setTint(`disco:${ev.id}:${ev.at}`, null);
        stopSound?.();
        stopSound = null;
      }
      return left > 0;
    },
    dispose() {
      stopSound?.();
      w.lighting.setTint(`disco:${ev.id}:${ev.at}`, null);
      group.removeFromParent();
      for (const m of [ball, cable, motor, shell]) m.geometry.dispose();
      (ball.material as THREE.Material).dispose();
      (shell.material as THREE.Material).dispose();
      beams.dispose();
      beamMat.dispose();
    },
  };
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _white = new THREE.Color();

function ease(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

// --- the ball ------------------------------------------------------------------------------------

/**
 * A mirror ball: rows of small square tiles round a sphere, a hairline of dark grout between them,
 * each tile flat (its own normal), so it flashes when it catches a pin spot.
 */
export function ballGeometry(r = BALL_R, rows = 18): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const tile: number[] = [];
  const at = (lat: number, lon: number) => new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  let id = 0;
  for (let i = 0; i < rows; i++) {
    const lat0 = -Math.PI / 2 + (i / rows) * Math.PI;
    const lat1 = -Math.PI / 2 + ((i + 1) / rows) * Math.PI;
    const mid = (lat0 + lat1) / 2;
    const cols = Math.max(6, Math.round(rows * 2 * Math.cos(mid)));
    for (let j = 0; j < cols; j++) {
      const lon0 = (j / cols) * Math.PI * 2;
      const lon1 = ((j + 1) / cols) * Math.PI * 2;
      const g = 0.08;
      const la0 = lat0 + (lat1 - lat0) * g;
      const la1 = lat1 - (lat1 - lat0) * g;
      const lo0 = lon0 + (lon1 - lon0) * g;
      const lo1 = lon1 - (lon1 - lon0) * g;
      const n = at(mid, (lon0 + lon1) / 2);
      const c = [at(la0, lo0), at(la0, lo1), at(la1, lo1), at(la1, lo0)].map((v) => v.multiplyScalar(r));
      for (const k of [0, 2, 1, 0, 3, 2]) {
        pos.push(c[k]!.x, c[k]!.y, c[k]!.z);
        nrm.push(n.x, n.y, n.z);
        tile.push(id);
      }
      id++;
    }
  }
  // the grout: a slightly smaller dark sphere inside
  const core = new THREE.SphereGeometry(r * 0.985, 24, 16).toNonIndexed();
  const cp = core.getAttribute('position');
  for (let i = 0; i < cp.count; i++) {
    pos.push(cp.getX(i), cp.getY(i), cp.getZ(i));
    nrm.push(0, 0, 0);
    tile.push(-1);
  }
  core.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aTile', new THREE.Float32BufferAttribute(tile, 1));
  g.computeBoundingSphere();
  return g;
}

function ballMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'fx-mirrorball',
    uniforms: { uPins: { value: [] as THREE.Vector3[] }, uTime: { value: 0 }, uK: { value: 0 }, uCalm: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aTile;
      varying vec3 vN;
      varying vec3 vW;
      varying float vTile;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = mat3(modelMatrix) * normal;
        vTile = aTile;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uPins[2];
      uniform float uTime;
      uniform float uK;
      uniform float uCalm;
      varying vec3 vN;
      varying vec3 vW;
      varying float vTile;
      float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
      void main() {
        vec3 c;
        if (vTile < 0.0) {
          c = vec3(0.012);
        } else {
          vec3 n = normalize(vN);
          vec3 v = normalize(cameraPosition - vW);
          vec3 r = reflect(-v, n);
          // what a mirror sees in a dim room: dark below, the ceiling's glow above
          c = mix(vec3(0.03, 0.025, 0.035), vec3(0.3, 0.26, 0.3), smoothstep(-0.4, 0.8, r.y));
          c *= 0.7 + 0.6 * hash(vTile);
          // a tile that catches a pin spot on its way to you flashes past the bloom threshold
          for (int i = 0; i < 2; i++) {
            vec3 l = normalize(uPins[i] - vW);
            float g = pow(max(dot(r, l), 0.0), 220.0);
            c += vec3(1.0, 0.96, 0.9) * g * 14.0 * uK;
          }
          // and each tile twinkles a little as the light across it shifts
          c += vec3(0.9, 0.85, 1.0) * pow(max(sin(uTime * 3.0 + hash(vTile + 7.0) * 60.0), 0.0), 30.0) * 1.5 * uK * (1.0 - uCalm);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// --- the room's floor and walls ------------------------------------------------------------------

/**
 * A thin shell over a room's floor and the faces of its walls, just proud of them (and of the
 * wainscot below the chair rail), leaving out doorways and shop windows: what the ball's points and
 * the heads' pools are drawn on.
 */
export function shellGeometry(plan: FloorPlan, room: PlannedRoom): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const L = room.inner;
  const ceil = room.style.ceiling;
  parts.push(new THREE.PlaneGeometry(L.x1 - L.x0, L.z1 - L.z0).rotateX(-Math.PI / 2).translate((L.x0 + L.x1) / 2, 0.013, (L.z0 + L.z1) / 2));
  for (const w of plan.wallPieces) {
    const side = w.neg === room.id ? -1 : w.pos === room.id ? 1 : 0;
    if (side === 0) continue;
    // along the wall, within the room
    const a0 = Math.max(w.a0, w.axis === 'x' ? L.x0 : L.z0);
    const a1 = Math.min(w.a1, w.axis === 'x' ? L.x1 : L.z1);
    if (a1 - a0 < 0.05) continue;
    const top = Math.min(w.y1, ceil);
    const full = w.y0 === 0 && top >= ceil - 0.001;
    const bands: [number, number, number][] = full
      ? [
          [0.15, 1.09, 0.045],
          [1.17, ceil - 0.2, 0.014],
        ]
      : w.y0 === 0
        ? [[0.15, top - 0.05, 0.014]]
        : [[w.y0 + 0.02, Math.min(top, ceil - 0.2), 0.014]];
    for (const [y0, y1, proud] of bands) {
      if (y1 - y0 < 0.05) continue;
      // the room is on the wall's `side` (-1 north or west): its face is WALL / 2 that way from the centre line
      const c = w.c + side * (WALL / 2 + proud);
      const g = new THREE.PlaneGeometry(a1 - a0, y1 - y0);
      // facing into the room
      if (w.axis === 'x') g.rotateY(side < 0 ? Math.PI : 0).translate((a0 + a1) / 2, (y0 + y1) / 2, c);
      else g.rotateY(side < 0 ? -Math.PI / 2 : Math.PI / 2).translate(c, (y0 + y1) / 2, (a0 + a1) / 2);
      parts.push(g);
    }
  }
  const out = mergeGeometries(parts.map((p) => p.deleteAttribute('uv')))!;
  for (const p of parts) p.dispose();
  return out;
}

function shellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'fx-disco-shell',
    uniforms: {
      uBall: { value: new THREE.Vector3() },
      uSpin: { value: 0 },
      uK: { value: 0 },
      uTime: { value: 0 },
      uCalm: { value: 0 },
      uHeadPos: { value: [] as THREE.Vector3[] },
      uHeadDir: { value: [] as THREE.Vector3[] },
      uHeadCol: { value: [] as THREE.Color[] },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBall;
      uniform float uSpin;
      uniform float uK;
      uniform float uTime;
      uniform float uCalm;
      uniform vec3 uHeadPos[4];
      uniform vec3 uHeadDir[4];
      uniform vec3 uHeadCol[4];
      varying vec3 vW;
      varying vec3 vN;
      const float PI = 3.14159265;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = vW - uBall;
        float dist = length(d);
        d /= dist;
        // turn with the ball
        float cs = cos(uSpin);
        float sn = sin(uSpin);
        vec3 r = vec3(cs * d.x - sn * d.z, d.y, sn * d.x + cs * d.z);
        // which tile's reflection lands here: rows of cells round the sphere of directions
        float rows = 34.0;
        float lat = asin(clamp(r.y, -1.0, 1.0));
        float band = floor((lat / PI + 0.5) * rows);
        float latc = ((band + 0.5) / rows - 0.5) * PI;
        float cols = max(6.0, floor(rows * 2.0 * cos(latc)));
        float lon = atan(r.z, r.x);
        float cell = floor((lon / (2.0 * PI) + 0.5) * cols);
        float lonc = ((cell + 0.5) / cols - 0.5) * 2.0 * PI;
        vec3 cd = vec3(cos(latc) * cos(lonc), sin(latc), cos(latc) * sin(lonc));
        float ang = acos(clamp(dot(r, cd), -1.0, 1.0));
        float h = hash(vec2(band, cell));
        float size = 0.0075 + 0.003 * h;
        float spot = smoothstep(size, size * 0.7, ang) * step(0.3, h);
        // nearer surfaces get brighter points; each point twinkles as its tile turns
        float twinkle = mix(0.7 + 0.3 * sin(uTime * 4.0 + h * 40.0), 0.75, uCalm);
        float facing = abs(dot(vN, -d));
        vec3 c = vec3(1.0, 0.95, 0.88) * spot * twinkle * (0.5 + 0.5 * facing) * 2.6 / (0.6 + 0.05 * dist * dist);
        // the moving heads' pools
        for (int i = 0; i < 4; i++) {
          vec3 l = vW - uHeadPos[i];
          float ld = length(l);
          float a = dot(l / ld, uHeadDir[i]);
          float pool = smoothstep(0.972, 0.985, a);
          c += uHeadCol[i] * pool * 0.9 * (0.4 + 0.6 * abs(dot(vN, -l / ld))) * 3.0 / (1.0 + 0.04 * ld * ld);
        }
        gl_FragColor = vec4(c * uK, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
