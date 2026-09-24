// The Hold'em table as it stands on the floor: a racetrack oval with green speed cloth, a walnut
// racetrack round the felt, a padded black leather rail with stitched seams (broken at the middle
// of the far side for the dealer), the dealer's chip tray with the deck on their left and the
// muck on their right, a steel cup holder in the rail at every seat, a walnut apron on two
// turned pedestals, and nine chairs pulled up to it. Built in code; the textures are shared.
//
// Heights and radii are from the felt's oval (table.ts): everything is swept round the same two
// centres, so the rail, the racetrack and the felt can never drift apart.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CHIPS } from '../../../../shared/src/money.ts';
import { CHIP_R, CHIP_H } from '../../table/chips.ts';
import { CARD_W, CARD_H } from '../../table/cards.ts';
import type { Quality } from '../../render/engine3d.ts';
import { oval, SL, RR, TOP_Y, TRIM, RAIL_IN, RAIL_W, RAIL_OUT, DEALER_GAP, CHAIR_R, chairSpots, nearestOnOval, feltGeometry, floorFelt } from './table.ts';
import { pokerMaterials, type PokerMaterials, type RailSeams } from './art.ts';

/** The rail's cross-section: a padded pillow, flatter on top (so the cup holders sit in it). */
const RAIL_BOTTOM = -0.022;
const RAIL_CROWN = 0.045;
const PILLOW = 3.2;
/** The apron's face, set in under the rail's overhang, and how deep it drops. */
const APRON_R = RAIL_OUT - 0.03;
const APRON_BOTTOM = -0.13;
/** Rail stitches, one every this many metres (the texture holds eight). */
const STITCH = 0.009;
/** The rail's ends are rounded off over this length. */
const RAIL_END = 0.03;

type Profile = [number, number][];

/** The rail's pillow, as [r out from RAIL_IN, y up from TOP_Y], round from the bottom, outer side first. */
function railProfile(n: number): Profile {
  const a = RAIL_W / 2;
  const b = (RAIL_CROWN - RAIL_BOTTOM) / 2;
  const yc = RAIL_BOTTOM + b;
  const e = 2 / PILLOW;
  const out: Profile = [];
  for (let i = 0; i <= n; i++) {
    const th = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    out.push([a + a * Math.sign(c) * Math.abs(c) ** e, yc + b * Math.sign(s) * Math.abs(s) ** e]);
  }
  return out;
}

/** Where the seams fall round the rail's profile (its shoulders), as fractions of its length. */
function seamsOf(p: Profile): RailSeams {
  const len = lengths(p);
  const total = len[len.length - 1]!;
  // the shoulders: where the profile is at 45 degrees, either side of the crown
  const at = (th: number) => len[Math.round(((th + Math.PI / 2) / (Math.PI * 2)) * (p.length - 1))]! / total;
  return { outer: at(Math.PI / 4), inner: at((3 * Math.PI) / 4) };
}

function lengths(p: Profile): number[] {
  const out = [0];
  for (let i = 1; i < p.length; i++) out.push(out[i - 1]! + Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]));
  return out;
}

interface Station {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/**
 * Stations along the oval of radius `base` from t0 to t1 (a whole loop when t1 - t0 is 1), about
 * `step` metres apart, closer together within `fine` metres of either end (for rounded ends).
 */
function path(base: number, t0: number, t1: number, step: number, fine = 0): Station[] {
  const perim = 4 * SL + 2 * Math.PI * base;
  const len = (t1 - t0) * perim;
  const ts: number[] = [];
  let s = 0;
  while (s < len) {
    ts.push(t0 + s / perim);
    const nearEnd = fine > 0 && (s < fine || len - s < fine);
    s += nearEnd ? Math.min(step, fine / 8) : step;
  }
  ts.push(t1);
  return ts.map((t) => {
    const e = oval(t, base);
    return { x: e.x, z: e.z, nx: e.nx, nz: e.nz };
  });
}

/**
 * Sweep a profile ([r out from the path, y up from TOP_Y]) along a path round the oval. u runs
 * along the length (each profile point's own distance, over `uLen`), v round the profile. `scale`
 * shrinks the profile about `centre` at a station (0 closes it to a point). The faces look out of
 * the side a profile runs counter-clockwise round (outward and up for a profile going up its
 * outer face, then in across its top).
 */
function sweep(stations: Station[], closed: boolean, profile: Profile, uLen: number, scale?: (i: number) => number, centre: [number, number] = [0, 0]): THREE.BufferGeometry {
  const n = stations.length;
  const m = profile.length;
  const plen = lengths(profile);
  const vTotal = plen[m - 1]! || 1;
  const pos = new Float32Array(n * m * 3);
  const uv = new Float32Array(n * m * 2);
  const run = new Float64Array(m);
  const prev: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const st = stations[i]!;
    const k = scale ? scale(i) : 1;
    for (let j = 0; j < m; j++) {
      const r = centre[0] + (profile[j]![0] - centre[0]) * k;
      const y = centre[1] + (profile[j]![1] - centre[1]) * k;
      const x = st.x + st.nx * r;
      const z = st.z + st.nz * r;
      if (i > 0) run[j]! += Math.hypot(x - prev[j]![0], z - prev[j]![1]);
      prev[j] = [x, z];
      const o = (i * m + j) * 3;
      pos[o] = x;
      pos[o + 1] = TOP_Y + y;
      pos[o + 2] = z;
      uv[(i * m + j) * 2] = run[j]! / uLen;
      uv[(i * m + j) * 2 + 1] = plen[j]! / vTotal;
    }
  }
  const index: number[] = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j;
      const b = i2 * m + j;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A flat oval of radius r at height y, facing up (or down). */
function ovalDisc(r: number, y: number, down = false): THREE.BufferGeometry {
  const pts = path(r, 0, 1, 0.03).slice(0, -1).map((p) => new THREE.Vector2(p.x, -p.z));
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
  // (the oval is symmetric front to back, so turning it face down leaves it in place)
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// ---------------------------------------------------------------------------------------------

/**
 * Put away the chairs on the near side (yours and the two beside it, between the play camera and
 * the rail) until the returned undo. Nobody else is drawn at the table you're sitting at.
 */
export function hideNearChairs(station: THREE.Object3D): () => void {
  const saved: [THREE.InstancedMesh, number, THREE.Matrix4][] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const gone = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const name of ['holdem-chairs-wood', 'holdem-chairs-leather']) {
    const mesh = station.getObjectByName(name);
    if (!(mesh instanceof THREE.InstancedMesh)) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      if (p.setFromMatrixPosition(m).z < CHAIR_R - 0.1) continue;
      saved.push([mesh, i, m.clone()]);
      mesh.setMatrixAt(i, gone);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  return () => {
    for (const [mesh, i, was] of saved.splice(0)) {
      mesh.setMatrixAt(i, was);
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
}

export function tableModel(quality: Quality): THREE.Group {
  const high = quality === 'high';
  const g = new THREE.Group();
  g.name = 'holdem-table';
  const profile = railProfile(high ? 40 : 24);
  const mats = pokerMaterials(quality, seamsOf(profile));
  const step = high ? 0.02 : 0.04;

  // The felt: green speed cloth with the house's printing, a hair under where the view lays its
  // own felt, so from the floor it's the table's top (and seated the view's covers it).
  const feltGeo = feltGeometry(RR + 0.004).rotateX(-Math.PI / 2).translate(0, TOP_Y - 0.0002, 0);
  const felt = new THREE.Mesh(feltGeo, floorFelt(high));
  felt.name = 'holdem-felt';
  g.add(felt);

  // The walnut racetrack: a lip down to the felt at its edge, then flat out under the rail.
  const trimProfile: Profile = [
    [TRIM + 0.008, 0.0042],
    [0.004, 0.0042],
    [0.0012, 0.0037],
    [0, 0.0025],
    [0, -0.0012],
  ];
  g.add(new THREE.Mesh(sweep(path(RR, 0, 1, step), true, trimProfile, 0.6), mats.walnut));

  // The rail, round every side but the dealer's: its ends rounded off over their last 3 cm.
  g.add(rail(profile, mats, step));

  // The apron under the rail's overhang and the table's underside, in walnut.
  const apron = sweep(path(APRON_R, 0, 1, step), true, [[-0.02, APRON_BOTTOM], [0, APRON_BOTTOM], [0, -0.02]], 0.6);
  const under = ovalDisc(APRON_R - 0.02, TOP_Y + APRON_BOTTOM, true);
  g.add(new THREE.Mesh(mergeGeometries([apron, plain(under)], false)!, mats.walnut));

  g.add(dealerStation(mats), pedestals(mats, high), cupHolders(mats, high), chairs(mats));
  return g;
}

/** Ready to merge: just position, normal and uv, and (with `flat`) no index, as RoundedBoxGeometry has none. */
function plain(geo: THREE.BufferGeometry, flat = false): THREE.BufferGeometry {
  const g = flat && geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  return g;
}

/** The padded rail from one side of the dealer's gap round to the other. */
function rail(profile: Profile, mats: PokerMaterials, step: number): THREE.Mesh {
  // the gap spans x in [-DEALER_GAP, DEALER_GAP] on the far side, found on the rail's own oval
  const base = RAIL_IN;
  const perim = 4 * SL + 2 * Math.PI * base;
  const farStart = SL + Math.PI * base; // where the far side begins (x = -SL)
  const t0 = (farStart + SL + DEALER_GAP) / perim;
  const t1 = 1 + (farStart + SL - DEALER_GAP) / perim;
  const END = RAIL_END;
  const stations = path(base, t0, t1, step, END);
  // distance of each station from the nearer end, for the rounded ends
  const along = [0];
  for (let i = 1; i < stations.length; i++) along.push(along[i - 1]! + Math.hypot(stations[i]!.x - stations[i - 1]!.x, stations[i]!.z - stations[i - 1]!.z));
  const total = along[along.length - 1]!;
  const scale = (i: number) => {
    const d = Math.min(along[i]!, total - along[i]!);
    if (d >= END) return 1;
    const k = 1 - d / END;
    return Math.sqrt(Math.max(0, 1 - k * k));
  };
  const geo = sweep(stations, false, profile, STITCH * 8, scale, [RAIL_W / 2, (RAIL_BOTTOM + RAIL_CROWN) / 2]);
  const mesh = new THREE.Mesh(geo, mats.leather);
  mesh.name = 'holdem-rail';
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// The dealer's place: a walnut shelf where the rail breaks, the chip tray set into it, the deck
// in its holder on the dealer's left (+x: they face the players, +z) and the muck on their right.

const TRAY_W = 0.44;
const TRAY_D = 0.092;
/** Chip rolls in the tray, left to right as the dealer sees them. */
const TRAY_ROLLS = [1000, 500, 100, 100, 25, 25, 5, 5, 1, 1];

function dealerStation(mats: PokerMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'holdem-dealer';
  const zIn = -RAIL_IN;
  const zOut = -RAIL_OUT;
  const depth = zIn - zOut;
  const zMid = (zIn + zOut) / 2;
  // the shelf fills the rail's gap and runs on under its rounded ends (so no hollow shows under
  // them), its front face over the apron; its top half a millimetre under the racetrack, which
  // laps onto it
  const shelfTop = TOP_Y + 0.0037;
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(2 * (DEALER_GAP + RAIL_END), 0.034, depth + 0.004), mats.walnut);
  shelf.position.set(0, shelfTop - 0.017, zMid - 0.002);
  shelf.name = 'holdem-shelf';
  g.add(shelf);

  // the tray: a lacquered well a little proud of the shelf, chips standing in rolls in it
  const trayZ = zMid;
  const trayTop = shelfTop + 0.0025;
  const tray = new THREE.Mesh(new RoundedBoxGeometry(TRAY_W + 0.016, 0.022, TRAY_D + 0.014, 2, 0.005), mats.tray);
  tray.position.set(0, trayTop - 0.011, trayZ);
  g.add(tray);
  const per = 22;
  const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H * 0.94, 20);
  chipGeo.rotateX(Math.PI / 2); // lying on edge, axis along z (toward the dealer)
  const chips = new THREE.InstancedMesh(chipGeo, mats.chip, TRAY_ROLLS.length * per);
  const m = new THREE.Matrix4();
  const colour = new THREE.Color();
  const pitch = TRAY_W / TRAY_ROLLS.length;
  TRAY_ROLLS.forEach((value, k) => {
    const spec = CHIPS.find((c) => c.value === value * 100) ?? CHIPS[0]!;
    // left to right for the dealer, who looks toward +z: their left is +x
    const x = TRAY_W / 2 - pitch * (k + 0.5);
    for (let i = 0; i < per; i++) {
      const z = trayZ - (per / 2 - 0.5 - i) * CHIP_H;
      // sunk 12 mm into their channel
      m.makeTranslation(x, trayTop - 0.012 + CHIP_R, z);
      chips.setMatrixAt(k * per + i, m);
      chips.setColorAt(k * per + i, colour.set(spec.body));
    }
  });
  chips.computeBoundingSphere();
  chips.name = 'holdem-tray-chips';
  g.add(chips);

  // the deck, face down in a low walnut holder, on the dealer's left; the muck in a clear one on
  // their right. Merged by material: a handful of draw calls, not a dozen boxes.
  const parts: Record<'walnut' | 'tray' | 'acrylic' | 'back' | 'edge', THREE.BufferGeometry[]> = { walnut: [], tray: [], acrylic: [], back: [], edge: [] };
  cardHolder(parts, 0.285, zMid, shelfTop, 34, false);
  cardHolder(parts, -0.285, zMid, shelfTop, 12, true);
  const merged = (list: THREE.BufferGeometry[], mat: THREE.Material) => new THREE.Mesh(mergeGeometries(list.map((x) => plain(x, true)), false)!, mat);
  g.add(merged(parts.walnut, mats.walnut), merged(parts.tray, mats.tray), merged(parts.acrylic, mats.acrylic), merged(parts.back, mats.cardBack), merged(parts.edge, mats.cardEdge));
  return g;
}

/** A low holder (walnut, or clear for the muck) with `cards` face-down cards in it, as geometry by material. */
function cardHolder(parts: Record<'walnut' | 'tray' | 'acrylic' | 'back' | 'edge', THREE.BufferGeometry[]>, x: number, z: number, base: number, cards: number, clear: boolean): void {
  const w = CARD_W + 0.012;
  const d = CARD_H + 0.012;
  const at = (geo: THREE.BufferGeometry, px: number, py: number, pz: number) => geo.translate(x + px, py, z + pz);
  (clear ? parts.tray : parts.walnut).push(at(new THREE.BoxGeometry(w, 0.004, d), 0, base + 0.002, 0));
  const wall = 0.004;
  const h = 0.02;
  for (const [ww, dd, px, pz] of [
    [w, wall, 0, -d / 2 + wall / 2],
    [w, wall, 0, d / 2 - wall / 2],
    [wall, d - 2 * wall, -w / 2 + wall / 2, 0],
    [wall, d - 2 * wall, w / 2 - wall / 2, 0],
  ] as const) {
    (clear ? parts.acrylic : parts.walnut).push(at(new THREE.BoxGeometry(ww, h, dd), px, base + 0.004 + h / 2, pz));
  }
  // a face-down stack: paper edges, the red back on top; the muck is a loose pile, turned a little
  const thick = cards * 0.0003;
  const turn = clear ? 0.12 : 0;
  const body = new THREE.BoxGeometry(CARD_W, thick, CARD_H);
  body.rotateY(turn);
  parts.edge.push(at(body, 0, base + 0.004 + thick / 2, 0));
  const back = new THREE.PlaneGeometry(CARD_W, CARD_H);
  back.rotateX(-Math.PI / 2);
  back.rotateY(turn);
  parts.back.push(at(back, 0, base + 0.004 + thick + 0.0001, 0));
}

// ---------------------------------------------------------------------------------------------

/** Two turned walnut columns on black feet, brass where they meet. */
function pedestals(mats: PokerMaterials, high: boolean): THREE.Group {
  const g = new THREE.Group();
  const top = TOP_Y + APRON_BOTTOM;
  const foot = 0.035;
  const turned = [
    [0.075, 0],
    [0.11, 0.02],
    [0.1, 0.06],
    [0.085, 0.12],
    [0.08, top - foot - 0.08],
    [0.1, top - foot - 0.03],
    [0.14, top - foot],
  ].map(([r, y]) => new THREE.Vector2(r!, y!));
  const seg = high ? 32 : 16;
  const woods: THREE.BufferGeometry[] = [];
  const blacks: THREE.BufferGeometry[] = [];
  const brasses: THREE.BufferGeometry[] = [];
  for (const x of [-SL * 0.72, SL * 0.72]) {
    const col = new THREE.LatheGeometry(turned, seg);
    col.translate(x, foot, 0);
    woods.push(col);
    const base = new THREE.CylinderGeometry(0.3, 0.32, foot, seg);
    base.translate(x, foot / 2, 0);
    blacks.push(base);
    const ring = new THREE.TorusGeometry(0.078, 0.008, 8, seg);
    ring.rotateX(Math.PI / 2);
    ring.translate(x, foot + 0.004, 0);
    brasses.push(ring);
  }
  g.add(new THREE.Mesh(mergeGeometries(woods, false)!, mats.walnut));
  g.add(new THREE.Mesh(mergeGeometries(blacks, false)!, mats.tray));
  g.add(new THREE.Mesh(mergeGeometries(brasses, false)!, mats.brass));
  g.name = 'holdem-pedestals';
  return g;
}

/**
 * A brushed steel cup holder set into the rail's crown at each chair, to the sitter's right,
 * clear of the dealer's gap.
 */
function cupHolders(mats: PokerMaterials, high: boolean): THREE.Group {
  const g = new THREE.Group();
  const spots = chairSpots();
  const mid = RAIL_IN + RAIL_W / 2;
  const places: THREE.Vector3[] = [];
  for (const c of spots) {
    // the sitter faces the table (-n); their right is along (n.z, -n.x)
    for (const side of [1, -1]) {
      const px = c.x + side * c.nz * 0.3;
      const pz = c.z - side * c.nx * 0.3;
      const on = nearestOnOval(px, pz, mid);
      if (on.z < 0 && Math.abs(on.x) < DEALER_GAP + 0.07) continue;
      places.push(new THREE.Vector3(on.x, TOP_Y + RAIL_CROWN, on.z));
      break;
    }
  }
  const seg = high ? 32 : 16;
  // the ring sits 1.5 mm into the crown; the well's dark top a hair over the crown inside it,
  // its edge under the ring, reading as the hole
  const ringGeo = new THREE.TorusGeometry(0.041, 0.0045, 8, seg);
  ringGeo.rotateX(Math.PI / 2);
  ringGeo.translate(0, -0.0015, 0);
  const wellGeo = new THREE.CylinderGeometry(0.037, 0.037, 0.03, seg);
  wellGeo.translate(0, -0.015 + 0.0003, 0);
  const rings = new THREE.InstancedMesh(ringGeo, mats.chrome, places.length);
  const wells = new THREE.InstancedMesh(wellGeo, mats.recess, places.length);
  const m = new THREE.Matrix4();
  places.forEach((p, i) => {
    m.makeTranslation(p.x, p.y, p.z);
    rings.setMatrixAt(i, m);
    wells.setMatrixAt(i, m);
  });
  rings.computeBoundingSphere();
  wells.computeBoundingSphere();
  rings.name = 'holdem-cup-rings';
  wells.name = 'holdem-cup-wells';
  g.name = 'holdem-cups';
  g.add(rings, wells);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Chairs: walnut frame, black leather seat and back, at every seat the world seats people in
// (chairSpots, the same points as the module's seats()). Built facing +z (the sitter's front),
// turned to face the table. Seat top 0.48 m; the back leans 8 degrees.

const SEAT_TOP = 0.48;
const SEAT_W = 0.46;
const SEAT_D = 0.42;
const LEAN = (8 * Math.PI) / 180;

function chairParts(): { wood: THREE.BufferGeometry; leather: THREE.BufferGeometry } {
  const wood: THREE.BufferGeometry[] = [];
  const leather: THREE.BufferGeometry[] = [];
  const frameTop = SEAT_TOP - 0.07;
  // legs, a little tapered
  for (const [x, z] of [[-0.19, 0.17], [0.19, 0.17], [-0.19, -0.17], [0.19, -0.17]] as const) {
    const leg = new THREE.CylinderGeometry(0.017, 0.013, frameTop, 10);
    leg.translate(x, frameTop / 2, z);
    wood.push(leg);
  }
  // the seat frame under the cushion
  const frame = new THREE.BoxGeometry(SEAT_W - 0.02, 0.05, SEAT_D - 0.02);
  frame.translate(0, frameTop - 0.025, 0);
  wood.push(frame);
  const cushion = new RoundedBoxGeometry(SEAT_W, 0.075, SEAT_D + 0.02, 3, 0.024);
  cushion.translate(0, SEAT_TOP - 0.0375, 0.01);
  leather.push(cushion);
  // back: two posts and a top rail leaning back from the seat's rear edge, the pad between them
  const lean = (geo: THREE.BufferGeometry, y: number, z: number) => {
    geo.rotateX(-LEAN);
    geo.translate(0, frameTop + y * Math.cos(LEAN), -SEAT_D / 2 + z - y * Math.sin(LEAN));
    return geo;
  };
  for (const x of [-0.205, 0.205]) {
    const post = new THREE.BoxGeometry(0.034, 0.5, 0.034);
    post.translate(x, 0, 0);
    wood.push(lean(post, 0.25, 0.005));
  }
  const topRail = new RoundedBoxGeometry(0.46, 0.045, 0.04, 2, 0.012);
  wood.push(lean(topRail, 0.5, 0.005));
  const pad = new RoundedBoxGeometry(0.39, 0.31, 0.055, 3, 0.022);
  leather.push(lean(pad, 0.27, 0.012));
  return { wood: mergeGeometries(wood.map((g) => plain(g, true)), false)!, leather: mergeGeometries(leather.map((g) => plain(g, true)), false)! };
}

let chairGeo: { wood: THREE.BufferGeometry; leather: THREE.BufferGeometry } | null = null;

function chairs(mats: PokerMaterials): THREE.Group {
  chairGeo ??= chairParts();
  const spots = chairSpots();
  const wood = new THREE.InstancedMesh(chairGeo.wood, mats.walnut, spots.length);
  const leather = new THREE.InstancedMesh(chairGeo.leather, mats.hide, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    m.compose(new THREE.Vector3(s.x, 0, s.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw), one);
    wood.setMatrixAt(i, m);
    leather.setMatrixAt(i, m);
  });
  wood.computeBoundingSphere();
  leather.computeBoundingSphere();
  wood.name = 'holdem-chairs-wood';
  leather.name = 'holdem-chairs-leather';
  const g = new THREE.Group();
  g.name = 'holdem-chairs';
  g.add(wood, leather);
  return g;
}
