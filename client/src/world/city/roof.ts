// The sky terrace (plan.ts ROOF): a teak deck on top of the tower behind a glass railing, facing
// west into the sunset. The elevators come up into a stone pavilion at its east end under a flat
// roof; loungers line the railing, two groups of sofas sit round fire tables under strings of
// bulbs, a small bar stands on the north side, palms and planters along the south. Past the
// railing: the neighbouring towers, the skyline in three layers of haze, the streets far below,
// the sun a hand's width over the horizon.

import * as THREE from 'three';
import type { Quality } from '../../render/engine3d.ts';
import type { Mats } from '../materials.ts';
import type { Collider } from '../collision.ts';
import { GLOW } from '../lighting.ts';
import { hdr } from '../materials.ts';
import { Props } from '../props.ts';
import { BAR_STOOL, FURNITURE } from '../furniture-spec.ts';
import { LIFTS } from '../../../../shared/src/lifts.ts';
import { Bank, panelTexture } from './bank.ts';
import { Kit } from './kit.ts';
import { ROOF } from './plan.ts';
import { Beacons, cityBelow, rng, skyDome, skylineRing, towers, type Tower } from './sky.ts';
import type { ZoneBuild } from './zone.ts';

/** Toward the sun: low in the west, a little south. */
export const SUN_DIR = new THREE.Vector3(-1, 0.075, 0.28).normalize();

const RAIL_H = 1.08;

export function buildRoof(mats: Mats, col: Collider, quality: Quality): ZoneBuild {
  const kit = new Kit('roof', mats, col);
  const group = new THREE.Group();
  group.name = 'zone:roof';
  const high = quality === 'high';
  const D = ROOF.deck;
  const P = ROOF.pavilion;
  const C = ROOF.canopy;
  const cy = ROOF.canopyY;

  // --- the deck, its stone edge, the tower under it ---------------------------------------------------
  kit.box('deck', D.x0, D.x1, -0.2, 0, D.z0, D.z1, 2.8);
  // (stopping just short of the deck's edge, so their ends never share a plane)
  kit.box('pavers', C.x0, P.x0 - 0.005, -0.2, 0.004, C.z0, C.z1, 3.2);
  const edge = 0.5;
  kit.box('stone-warm', D.x0 - edge, D.x1 + edge, -0.7, 0.06, D.z0 - edge, D.z0, 1.6);
  kit.box('stone-warm', D.x0 - edge, D.x1 + edge, -0.7, 0.06, D.z1, D.z1 + edge, 1.6);
  kit.box('stone-warm', D.x0 - edge, D.x0, -0.7, 0.06, D.z0, D.z1, 1.6);
  kit.box('stone-warm', D.x1, D.x1 + edge, -0.7, 0.06, D.z0, P.z0, 1.6);
  kit.box('stone-warm', D.x1, D.x1 + edge, -0.7, 0.06, P.z1, D.z1, 1.6);
  // (the tower's own east face takes in the pavilion over its edge)
  const below: Tower[] = [{ x: (D.x0 - 0.4 + P.x1 + 0.2) / 2, z: 0, w: P.x1 + 0.2 - (D.x0 - 0.4), d: D.z1 - D.z0 + 0.8, h: ROOF.depth - 0.72, y0: -ROOF.depth }];

  // --- the glass railing round the deck -----------------------------------------------------------------
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? x1 - x0 : z1 - z0;
    const n = Math.max(1, Math.round(len / 1.7));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      kit.box('chrome', x - 0.03, x + 0.03, 0.06, RAIL_H - 0.02, z - 0.03, z + 0.03);
    }
    if (alongX) {
      kit.box('glass', x0, x1, 0.1, RAIL_H - 0.08, z0 - 0.01, z0 + 0.01);
      kit.box('teak', x0 - 0.04, x1 + 0.04, RAIL_H - 0.02, RAIL_H + 0.03, z0 - 0.05, z0 + 0.05);
      kit.solid(x0, x1, z0 - 0.1, z0 + 0.1, RAIL_H);
    } else {
      kit.box('glass', x0 - 0.01, x0 + 0.01, 0.1, RAIL_H - 0.08, z0, z1);
      kit.box('teak', x0 - 0.05, x0 + 0.05, RAIL_H - 0.02, RAIL_H + 0.03, z0 - 0.04, z1 + 0.04);
      kit.solid(x0 - 0.1, x0 + 0.1, z0, z1, RAIL_H);
    }
  };
  const inset = 0.2;
  rail(D.x0 + inset, D.z0 + inset, D.x0 + inset, D.z1 - inset);
  rail(D.x0 + inset, D.z0 + inset, D.x1 - inset, D.z0 + inset);
  rail(D.x0 + inset, D.z1 - inset, D.x1 - inset, D.z1 - inset);
  rail(D.x1 - inset, D.z0 + inset, D.x1 - inset, P.z0);
  rail(D.x1 - inset, P.z1, D.x1 - inset, D.z1 - inset);

  // --- the pavilion: stone walls either side of the elevators, its roof over the arrivals ----------------
  const bankSpan = LIFTS.roof.cars * 1.9 + 0.8;
  kit.box('granite', P.x0, P.x1, 0, cy, P.z0, -bankSpan / 2, 1.2);
  kit.box('granite', P.x0, P.x1, 0, cy, bankSpan / 2, P.z1, 1.2);
  kit.solid(P.x0, P.x1, P.z0, -bankSpan / 2, cy);
  kit.solid(P.x0, P.x1, bankSpan / 2, P.z1, cy);
  const bank = new Bank(LIFTS.roof, kit.batch, kit.glow, mats, col, { height: cy, clad: 'granite', trim: 'brass', door: 'lift-door' }, panelTexture('roof'));
  group.add(bank.group);
  kit.box('granite', C.x0, P.x1, cy, cy + 0.34, C.z0, C.z1, 1.2);
  kit.box('ceiling-light', C.x0 + 0.2, P.x0, cy - 0.01, cy, C.z0 + 0.2, C.z1 - 0.2);
  kit.box('brass', C.x0 - 0.03, C.x0, cy + 0.06, cy + 0.14, C.z0, C.z1);
  kit.light(GLOW.soft, C.x0 + 0.25, cy - 0.03, 0, 0.03, 0.03, C.z1 - C.z0 - 0.6);
  for (const z of [C.z0 + 0.5, C.z1 - 0.5]) {
    kit.cylinder('brass', C.x0 + 0.5, z, 0.09, 0, cy, 14);
    kit.post(C.x0 + 0.5, z, 0.12, cy);
  }
  for (let x = C.x0 + 1.4; x < P.x0 - 0.6; x += 2.4) {
    for (const z of [-3.6, 0, 3.6]) {
      kit.glow.add(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16), GLOW.bulb, { x, y: cy - 0.016, z });
      kit.pool(x, z, 1.8);
    }
  }
  // big pots with palms either side of the arrivals
  for (const z of [C.z0 - 0.9, C.z1 + 0.9]) {
    kit.cylinder('stone-warm', P.x0 - 1.6, z, 0.62, 0, 0.8, 24, 0.7);
    kit.prop('palm', P.x0 - 1.6, z, 4.2, z * 0.5, 0.8);
    kit.post(P.x0 - 1.6, z, 0.7, 1.5);
  }

  // --- loungers along the west railing, facing the sun -----------------------------------------------
  const loungers = [-10.2, -7.0, -3.8, 3.8, 7.0, 10.2];
  loungers.forEach((z, i) => {
    const x = D.x0 + 2.6;
    // a teak frame, a cushion, the back raised at the east end
    kit.box('teak', x - 1.0, x + 1.0, 0.1, 0.32, z - 0.38, z + 0.38, 1.2);
    for (const dx of [-0.9, 0.9]) for (const dz of [-0.32, 0.32]) kit.box('teak', x + dx - 0.04, x + dx + 0.04, 0, 0.1, z + dz - 0.04, z + dz + 0.04);
    kit.box('cushion', x - 0.98, x + 0.45, 0.32, 0.42, z - 0.35, z + 0.35);
    kit.batch.add(new THREE.BoxGeometry(0.72, 0.1, 0.7), kit.mat('cushion'), { x: x + 0.72, y: 0.62, z, rz: 0.72 });
    kit.batch.add(new THREE.BoxGeometry(0.7, 0.05, 0.74), kit.mat('teak'), { x: x + 0.8, y: 0.56, z, rz: 0.72 });
    kit.solid(x - 1.0, x + 1.05, z - 0.4, z + 0.4, 0.9);
    kit.seat({ id: `roof.lounger.${i + 1}`, x: x + 0.28, z, yaw: -Math.PI / 2, top: 0.42, kind: 'chair' });
    // a side table between pairs
    if (i % 2 === 0 && loungers[i + 1] !== undefined) {
      const tz = (z + loungers[i + 1]!) / 2;
      kit.cylinder('teak', x + 0.2, tz, 0.26, 0.44, 0.48, 18);
      kit.cylinder('chrome', x + 0.2, tz, 0.03, 0, 0.44, 8);
      kit.post(x + 0.2, tz, 0.28, 0.5);
    }
  });
  // a coin telescope on the prow, looking west
  const tx = D.x0 + 1.2;
  kit.cylinder('steel', tx, 0, 0.07, 0, 1.1, 12);
  kit.cylinder('steel', tx, 0, 0.22, 0, 0.06, 18);
  kit.batch.add(new THREE.CylinderGeometry(0.1, 0.14, 0.62, 16), kit.mat('brass'), { x: tx - 0.08, y: 1.3, z: 0, rz: Math.PI / 2 - 0.12 });
  kit.box('steel', tx - 0.12, tx + 0.12, 1.08, 1.22, -0.14, 0.14);
  kit.post(tx, 0, 0.24, 1.4);

  // --- two sofa groups round fire tables, under strings of bulbs ---------------------------------------
  const sofa = FURNITURE.sofa;
  [-5.4, 5.4].forEach((gz, gi) => {
    const gx = -134.5;
    for (const side of [-1, 1] as const) {
      const cz = gz + side * 1.35;
      const yaw = side < 0 ? 0 : Math.PI;
      kit.prop('couch', gx, cz, sofa.w, yaw);
      kit.solid(gx - sofa.w / 2, gx + sofa.w / 2, cz - sofa.d / 2, cz + sofa.d / 2, sofa.h);
      sofa.seats!.forEach((s, k) => {
        const lx = side < 0 ? s.x : -s.x;
        kit.seat({ id: `roof.sofa.${gi + 1}${side < 0 ? 'a' : 'b'}.${k + 1}`, x: gx + lx, z: cz + (side < 0 ? s.z : -s.z), yaw, top: sofa.top!, kind: 'sofa' });
      });
    }
    // the fire table: a long stone trough, glass guards, the flame strip in the middle
    kit.box('stone-warm', gx - 0.95, gx + 0.95, 0, 0.38, gz - 0.36, gz + 0.36, 1.2);
    kit.box('marble-black', gx - 0.97, gx + 0.97, 0.38, 0.42, gz - 0.38, gz + 0.38, 1.2);
    kit.box('glass', gx - 0.72, gx + 0.72, 0.42, 0.62, gz - 0.13, gz - 0.12);
    kit.box('glass', gx - 0.72, gx + 0.72, 0.42, 0.62, gz + 0.12, gz + 0.13);
    kit.light(hdr('#ff8a2a', 3.2), gx, 0.44, gz, 1.36, 0.04, 0.08);
    kit.light(hdr('#ffc070', 2.0), gx, 0.49, gz, 1.2, 0.06, 0.03);
    kit.solid(gx - 0.97, gx + 0.97, gz - 0.38, gz + 0.38, 0.62);
    kit.pool(gx, gz, 2.4);
    kit.prop('lamp-floor', gx - sofa.w / 2 - 0.45, gz + (gi === 0 ? -1.35 : 1.35), 1.6);
    kit.post(gx - sofa.w / 2 - 0.45, gz + (gi === 0 ? -1.35 : 1.35), 0.25, 1.6);
  });
  // the strings of bulbs: four posts, bulbs hung in sagging lines between them
  const posts = [
    [-140.8, -8.9],
    [-128.6, -8.9],
    [-140.8, 8.9],
    [-128.6, 8.9],
  ] as const;
  for (const [x, z] of posts) {
    kit.cylinder('steel', x, z, 0.05, 0, 3.4, 10);
    kit.cylinder('steel', x, z, 0.16, 0, 0.05, 14);
    kit.post(x, z, 0.12, 3.4);
  }
  const bulb = hdr('#ffd9a0', 2.8);
  const string = (a: readonly [number, number], b: readonly [number, number]) => {
    const n = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.55);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const y = 3.3 - Math.sin(t * Math.PI) * 0.7;
      kit.light(bulb, a[0] + (b[0] - a[0]) * t, y, a[1] + (b[1] - a[1]) * t, 0.05, 0.07, 0.05);
    }
  };
  string(posts[0], posts[1]);
  string(posts[2], posts[3]);
  string(posts[0], posts[3]);
  string(posts[1], posts[2]);

  // --- the bar, on the north side ------------------------------------------------------------------------
  const bar = { x0: -127.4, x1: -119.4, z0: D.z0 + 2.7, z1: D.z0 + 3.5 };
  kit.box('wood', bar.x0, bar.x1, 0, 1.04, bar.z0, bar.z1, 1.2);
  kit.box('marble-black', bar.x0 - 0.06, bar.x1 + 0.06, 1.04, 1.1, bar.z0 - 0.04, bar.z1 + 0.12, 1.2);
  kit.box('brass', bar.x0, bar.x1, 0.2, 0.24, bar.z1 + 0.18, bar.z1 + 0.22);
  kit.light(GLOW.shelf, (bar.x0 + bar.x1) / 2, 1.02, bar.z1 + 0.005, bar.x1 - bar.x0 - 0.2, 0.02, 0.01);
  kit.solid(bar.x0, bar.x1, bar.z0, bar.z1 + 0.12, 1.1);
  // the back bar: a cabinet with lit shelves and bottles, a canopy over the whole
  const bb = { z0: D.z0 + 0.55, z1: D.z0 + 1.05 };
  kit.box('wood', bar.x0, bar.x1, 0, 0.95, bb.z0, bb.z1, 1.2);
  kit.box('wood', bar.x0, bar.x1, 0.95, 2.4, bb.z0, bb.z0 + 0.1, 1.2);
  for (const y of [1.35, 1.8]) {
    kit.box('marble-black', bar.x0 + 0.1, bar.x1 - 0.1, y - 0.03, y, bb.z0 + 0.1, bb.z1, 1.2);
    kit.light(GLOW.shelf, (bar.x0 + bar.x1) / 2, y - 0.035, bb.z1 - 0.02, bar.x1 - bar.x0 - 0.4, 0.01, 0.02);
  }
  kit.solid(bar.x0, bar.x1, bb.z0, bb.z1, 2.4);
  const bottles = ['bottle-tall', 'bottle-red', 'bottle-white'] as const;
  const brnd = rng(0xba7);
  for (const y of [0.95, 1.35, 1.8]) {
    for (let x = bar.x0 + 0.4; x < bar.x1 - 0.3; x += 0.34 + brnd() * 0.2) {
      const k = bottles[Math.floor(brnd() * 3)]!;
      kit.prop(k, x, bb.z0 + 0.3, k === 'bottle-tall' ? 0.34 : 0.3, brnd() * 6, y);
    }
  }
  for (let x = bar.x0 + 0.5; x < bar.x1; x += 1.9) kit.prop('glass-cocktail', x, bar.z0 + 0.35, 0.16, 0, 1.1);
  kit.box('teak', bar.x0 - 0.3, bar.x1 + 0.3, 2.7, 2.8, bb.z0 - 0.2, bar.z1 + 0.6, 1.2);
  for (const x of [bar.x0 - 0.2, bar.x1 + 0.2]) {
    kit.box('teak', x - 0.06, x + 0.06, 0, 2.7, bb.z0 - 0.1, bb.z0 + 0.02);
    kit.box('teak', x - 0.06, x + 0.06, 0, 2.7, bar.z1 + 0.48, bar.z1 + 0.6);
    kit.post(x, bar.z1 + 0.54, 0.08, 2.7);
  }
  for (let x = bar.x0 + 0.9; x < bar.x1 - 0.4; x += 1.62) {
    kit.glow.add(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 14), GLOW.bulb, { x, y: 2.694, z: bar.z0 + 0.7 });
    kit.pool(x, bar.z0 + 0.9, 1.4);
  }
  const stoolZ = bar.z1 + 0.62;
  let si = 0;
  for (let x = bar.x0 + 0.8; x < bar.x1 - 0.5; x += 1.55) {
    kit.prop('stool', x, stoolZ, BAR_STOOL.h, 0);
    kit.post(x, stoolZ, BAR_STOOL.r, BAR_STOOL.h);
    kit.seat({ id: `roof.stool.${++si}`, x, z: stoolZ, yaw: Math.PI, top: BAR_STOOL.h, kind: 'stool' });
  }

  // --- planters along the south railing, and at the deck's corners --------------------------------------
  for (let x = D.x0 + 6; x < D.x1 - 8; x += 7.5) {
    const z = D.z1 - 1.0;
    kit.box('stone-warm', x - 1.6, x + 1.6, 0, 0.55, z - 0.4, z + 0.4, 1.6);
    kit.box('soil', x - 1.5, x + 1.5, 0.55, 0.56, z - 0.3, z + 0.3);
    kit.box('hedge', x - 1.45, x + 1.45, 0.56, 0.95, z - 0.26, z + 0.26, 1.2);
    kit.solid(x - 1.6, x + 1.6, z - 0.4, z + 0.4, 0.95);
    kit.prop('plant-b', x - 1.0, z, 1.3, x, 0.56);
    kit.prop('plant-a', x + 1.0, z, 1.2, -x, 0.56);
  }
  for (const [x, z] of [
    [D.x0 + 1.2, D.z0 + 1.2],
    [D.x0 + 1.2, D.z1 - 1.2],
  ] as const) {
    kit.cylinder('stone-warm', x, z, 0.55, 0, 0.7, 22, 0.6);
    kit.prop('palm', x, z, 3.4, x + z, 0.7);
    kit.post(x, z, 0.6, 1.4);
  }

  // --- the city: neighbouring towers, the skyline, the streets below, the sky ------------------------------
  const rnd = rng(0x5e7);
  // the tall neighbours to the east, behind the pavilion (the casino's floor is out that way: they
  // stand between)
  const near: Tower[] = [
    ...below,
    { x: -88, z: -33, w: 18, d: 34, h: ROOF.depth + 32, y0: -ROOF.depth },
    { x: -86, z: 0, w: 16, d: 28, h: ROOF.depth + 14, y0: -ROOF.depth },
    { x: -89, z: 32, w: 20, d: 32, h: ROOF.depth + 44, y0: -ROOF.depth },
  ];
  const cx = -135;
  for (let i = 0; i < 34; i++) {
    const a = rnd() * Math.PI * 2;
    // the west (the sun's side) keeps lower towers, so the view over the railing stays open
    const west = Math.cos(a - Math.atan2(SUN_DIR.x, SUN_DIR.z)) > 0.6;
    const r = 70 + rnd() * 110;
    const x = cx + Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const top = west ? -60 + rnd() * 40 : -40 + rnd() * 90;
    const w = 16 + rnd() * 20;
    const d = 16 + rnd() * 20;
    if (near.some((t) => Math.abs(t.x - x) < (t.w + w) / 2 + 4 && Math.abs(t.z - z) < (t.d + d) / 2 + 4)) continue;
    near.push({ x, z, w, d, h: top + ROOF.depth, y0: -ROOF.depth });
  }
  group.add(towers(near, 'sunset', 0x70e7, high ? 1024 : 512));
  const beacons = new Beacons(
    near.filter((t) => t !== below[0] && (t.y0 ?? 0) + t.h > -12).map((t) => new THREE.Vector3(t.x, (t.y0 ?? 0) + t.h + 1.2, t.z)),
    29,
  );
  group.add(beacons.points);
  group.add(cityBelow(470, -ROOF.depth, 0xc17));
  group.add(skyDome('sunset', SUN_DIR));
  const sunAngle = Math.atan2(SUN_DIR.x, SUN_DIR.z);
  for (const r of [
    { radius: 210, y0: -ROOF.depth, y1: 70, seed: 11, low: 0.35, high: 0.92, body: '#2a1c2c', haze: '#8a5a5a', lit: 0.18, glow: 1.15 },
    { radius: 310, y0: -ROOF.depth, y1: 25, seed: 13, low: 0.42, high: 0.95, body: '#4a3448', haze: '#b07868', lit: 0.12, glow: 1.0 },
    { radius: 430, y0: -ROOF.depth, y1: 4, seed: 19, low: 0.55, high: 0.98, body: '#7a5462', haze: '#d09a7c', lit: 0.06, glow: 0.95 },
  ].slice(0, high ? 3 : 2)) {
    const ring = skylineRing({ ...r, kind: 'sunset', sunAngle, size: high ? 4096 : 2048 });
    ring.position.x = cx;
    group.add(ring);
  }

  // the edge of the zone: nobody walks off the deck
  kit.solid(D.x0 - 1, D.x0 - 0.1, D.z0 - 1, D.z1 + 1, 3);
  kit.solid(D.x0 - 1, D.x1 + 1, D.z0 - 1, D.z0 - 0.1, 3);
  kit.solid(D.x0 - 1, D.x1 + 1, D.z1 + 0.1, D.z1 + 1, 3);
  kit.solid(P.x1, P.x1 + 1, D.z0, D.z1, 3);

  const meshes = kit.batch.build(group, 'roof');
  const glowMeshes = kit.glow.build(group);
  const pools = kit.pools('#ffb070', 0.2);
  if (pools) group.add(pools);
  const props = new Props(quality);
  group.add(props.group);
  const ready = props.build(kit.props, kit.chandeliers).catch((err) => console.warn('roof props failed', err));

  return {
    id: 'roof',
    group,
    bank,
    seats: kit.seats,
    ready,
    light() {
      return 'outside';
    },
    ceilingAt(x, z) {
      if (x >= C.x0 && x <= P.x1 && z >= C.z0 && z <= C.z1) return cy;
      if (x >= -127.8 && x <= -119 && z >= D.z0 && z <= D.z0 + 4.1) return 2.7;
      return null;
    },
    update(dt) {
      beacons.update(dt);
    },
    setQuality(q) {
      void props.setQuality(q);
    },
    dispose() {
      bank.dispose();
      for (const m of [...meshes.meshes, ...glowMeshes.meshes]) m.dispose();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null; emissiveMap?: THREE.Texture | null };
        if (mat.name === 'skyline' || mat.name === 'towers' || mat.name?.startsWith('sky-') || mat.name === 'city-below' || mat.name === 'city-pools' || mat.name === 'lift-panels') {
          mat.map?.dispose();
          mat.emissiveMap?.dispose();
          mat.dispose();
          mesh.geometry.dispose();
        }
      });
      group.removeFromParent();
    },
  };
}
