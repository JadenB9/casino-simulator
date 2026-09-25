// What a bar order is drawn as in the hand: the glass, bottle, cup, can or plate, and what's in it
// or on it, built once per item and shared by everyone holding one.
//
// Each is built upright in the grip's own frame (origin where the fingers close round it, x ahead
// along the fingers, y up, z out to the right-hand side; see wearables.ts heldFit), in metres.
// What goes down as it's drunk is kept apart from the glass: the drink is scaled down toward its
// bottom (a cone keeps its shape, a tumbler only gets shallower), a floater (an ice cube, the
// crema) rides its surface. A plate's food is one mesh with the pieces in the order they're eaten,
// so what's left is a draw range; the piece in the eating hand has a mesh of its own.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { barItem, type BarModel } from '../../../../shared/src/items.ts';

/** Colour (linear RGB), metalness and roughness, per vertex (the wearables' jewel material reads them). */
export interface Finish {
  c: readonly [number, number, number];
  m: number;
  r: number;
}
const fin = (r: number, g: number, b: number, m: number, rough: number): Finish => ({ c: [r, g, b], m, r: rough });

const CHINA = fin(0.85, 0.84, 0.8, 0, 0.2);
const GOLD_FOIL = fin(1.0, 0.76, 0.37, 1, 0.3);
const STEEL = fin(0.62, 0.62, 0.62, 1, 0.22);
const BUN = fin(0.55, 0.26, 0.07, 0, 0.55);
const BEEF = fin(0.12, 0.04, 0.02, 0, 0.7);
const CHEDDAR = fin(0.8, 0.5, 0.05, 0, 0.5);
const FRY = fin(0.78, 0.5, 0.12, 0, 0.6);
const PRAWN = fin(0.9, 0.35, 0.18, 0, 0.35);
const SHELL = fin(0.6, 0.05, 0.02, 0, 0.35);
const MEAT = fin(0.92, 0.78, 0.7, 0, 0.45);
const BUTTER = fin(0.85, 0.62, 0.12, 0, 0.2);
const BLINI = fin(0.7, 0.5, 0.2, 0, 0.6);
const ROE = fin(0.01, 0.01, 0.012, 0, 0.12);
const CREME = fin(0.9, 0.88, 0.8, 0, 0.4);
const SEAR = fin(0.16, 0.06, 0.03, 0, 0.6);
const PINK = fin(0.62, 0.16, 0.14, 0, 0.5);
const HERB = fin(0.05, 0.2, 0.03, 0, 0.5);
const SPONGE = fin(0.1, 0.035, 0.015, 0, 0.8);
const FROSTING = fin(0.16, 0.06, 0.025, 0, 0.35);
const CREAM_LAYER = fin(0.85, 0.8, 0.68, 0, 0.5);
const WAX = fin(0.85, 0.82, 0.74, 0, 0.5);
const WICK = fin(0.02, 0.02, 0.02, 0, 0.9);

/** The six macarons, in the order they're eaten: pistachio to raspberry. */
const MACARONS: Finish[] = [fin(0.32, 0.5, 0.18, 0, 0.6), fin(0.9, 0.72, 0.2, 0, 0.6), fin(0.45, 0.3, 0.6, 0, 0.6), fin(0.9, 0.82, 0.62, 0, 0.6), fin(0.22, 0.1, 0.05, 0, 0.6), fin(0.85, 0.2, 0.3, 0, 0.6)];

/** Drinks, by item: colour of what's poured. */
const POURS: Record<string, Finish> = {
  beer: fin(0.55, 0.28, 0.03, 0, 0.08),
  'red-wine': fin(0.12, 0.004, 0.012, 0, 0.05),
  cocktail: fin(0.8, 0.85, 0.85, 0, 0.05),
  whiskey: fin(0.45, 0.16, 0.02, 0, 0.05),
  champagne: fin(0.75, 0.55, 0.18, 0, 0.05),
  espresso: fin(0.05, 0.022, 0.01, 0, 0.3),
  margarita: fin(0.62, 0.7, 0.3, 0, 0.1),
};

/** A shape filled with the drink, and how it goes down: scaled toward `base`, y by level^ay, across by level^ax. */
export interface Pour {
  geo: THREE.BufferGeometry;
  base: THREE.Vector3;
  ay: number;
  ax: number;
}

/** Something riding the drink's surface: at `low` empty, `high` full (its y), shrinking across by level^ax. */
export interface Floater {
  geo: THREE.BufferGeometry;
  low: THREE.Vector3;
  high: THREE.Vector3;
  ax: number;
}

export interface Food {
  /** Every piece, in the order they're eaten; `starts[i]` is where piece i begins in the index (starts[n] = the end). */
  geo: THREE.BufferGeometry;
  starts: number[];
  /** What the eating hand holds for portion i (centred on the hand's pinch). */
  hand: THREE.BufferGeometry[];
}

export interface HeldModel {
  model: BarModel;
  /** The vessel and anything that stays: china, metal, labels, the parts of a dish that aren't eaten. */
  solid: THREE.BufferGeometry | null;
  /** Clear glass. */
  glass: THREE.BufferGeometry | null;
  /** Coloured glass (a beer bottle's amber), with its colour. */
  tinted: { geo: THREE.BufferGeometry; color: THREE.Color } | null;
  pour: Pour | null;
  floater: Floater | null;
  food: Food | null;
  /** Candle flames (a cake), lit until the candles are blown out. */
  flames: THREE.Vector3[];
  /** The middle of the rim you drink from, and the rim's radius: its near side goes to the lips. */
  lip: THREE.Vector3;
  rimR: number;
  /** Where a bottle's spray or a cup's steam comes from. */
  spout: THREE.Vector3;
  /** Bubbles rise in it (champagne, beer): the column's bottom and radius. */
  fizz: { bottom: THREE.Vector3; r: number } | null;
  /** Where the plate's middle is (for the eating hand), for dishes. */
  plate: THREE.Vector3 | null;
}

// --- building ------------------------------------------------------------------------------------

const lathe = (pts: [number, number][], segs = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const RY = (a: number) => new THREE.Matrix4().makeRotationY(a);
const RZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);
const RX = (a: number) => new THREE.Matrix4().makeRotationX(a);

/** Parts of one material, each painted with its finish, merged into one geometry. */
class Parts {
  private list: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, f: Finish | null, m?: THREE.Matrix4): this {
    let geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    if (m) geo.applyMatrix4(m);
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const pbr = new Float32Array(n * 2);
    const ff = f ?? fin(1, 1, 1, 0, 0.05);
    for (let i = 0; i < n; i++) {
      col.set(ff.c, i * 3);
      pbr[i * 2] = ff.m;
      pbr[i * 2 + 1] = ff.r;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('pbr', new THREE.BufferAttribute(pbr, 2));
    this.list.push(geo);
    return this;
  }

  get count(): number {
    return this.list.reduce((s, g) => s + g.getAttribute('position').count, 0);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.list.length) return null;
    const g = this.list.length === 1 ? this.list[0]! : mergeGeometries(this.list, false)!;
    if (g !== this.list[0]) for (const p of this.list) p.dispose();
    this.list = [];
    g.computeBoundingSphere();
    return g;
  }
}

/** Pieces eaten one after another: each group of parts is one piece, in order. */
class Pieces {
  private groups: Parts[] = [];
  readonly hand: THREE.BufferGeometry[] = [];

  piece(): Parts {
    const p = new Parts();
    this.groups.push(p);
    return p;
  }

  build(): Food | null {
    const starts: number[] = [0];
    const geos: THREE.BufferGeometry[] = [];
    for (const g of this.groups) {
      const n = g.count;
      const built = g.build();
      if (built) geos.push(built);
      starts.push(starts.at(-1)! + n);
    }
    if (!geos.length) return null;
    const geo = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false)!;
    if (geo !== geos[0]) for (const g of geos) g.dispose();
    geo.computeBoundingSphere();
    return { geo, starts, hand: this.hand };
  }
}

function blank(model: BarModel): HeldModel {
  return { model, solid: null, glass: null, tinted: null, pour: null, floater: null, food: null, flames: [], lip: new THREE.Vector3(0, 0.1, 0), rimR: 0.02, spout: new THREE.Vector3(0, 0.1, 0), fizz: null, plate: null };
}

/** Where a plate's centre sits from the hand holding its rim: toward the body, in front of it. */
export const PLATE_Z = -0.085;

const cache = new Map<string, HeldModel>();

/** The model for an item (shared; never dispose it). */
export function heldModel(item: string): HeldModel | null {
  const known = cache.get(item);
  if (known) return known;
  const it = barItem(item);
  if (!it) return null;
  const built = build(item, it.model);
  cache.set(item, built);
  return built;
}

function build(item: string, model: BarModel): HeldModel {
  const out = blank(model);
  const solid = new Parts();
  const glass = new Parts();
  const pour = POURS[item] ?? POURS.cocktail!;
  // stemmed glasses are held by the stem, a tumbler up in the fingers, a cup's saucer resting inward
  let shift = T(0, 0, 0);
  switch (model) {
    case 'bottle': {
      // amber glass you can see the beer through, a cream label, a gold cap
      const tint = new Parts();
      tint.add(lathe([[0.0001, -0.07], [0.029, -0.07], [0.03, -0.066], [0.03, 0.03], [0.026, 0.045], [0.0125, 0.075], [0.0115, 0.108], [0.0135, 0.112], [0.012, 0.118], [0.0001, 0.118]]), null);
      out.tinted = { geo: tint.build()!, color: new THREE.Color(0.55, 0.22, 0.03) };
      solid.add(lathe([[0.0304, -0.03], [0.0304, 0.018]]), fin(0.72, 0.62, 0.42, 0, 0.6));
      solid.add(lathe([[0.0122, 0.108], [0.0132, 0.113], [0.0122, 0.118], [0.0001, 0.119]]), GOLD_FOIL);
      const p = new Parts().add(lathe([[0.0001, 0], [0.027, 0], [0.027, 0.09], [0.0232, 0.102], [0.0001, 0.102]], 16), pour);
      out.pour = { geo: p.build()!, base: new THREE.Vector3(0, -0.066, 0), ay: 1, ax: 0 };
      out.pour.geo.translate(0, -0.066, 0);
      out.lip.set(0, 0.118, 0);
      out.rimR = 0.012;
      out.spout.set(0, 0.118, 0);
      out.fizz = { bottom: new THREE.Vector3(0, -0.06, 0), r: 0.018 };
      break;
    }
    case 'magnum': {
      // a dark green champagne bottle, gold foil on the neck, a cream shield label
      const green = fin(0.01, 0.045, 0.02, 0, 0.08);
      solid.add(lathe([[0.0001, -0.1], [0.038, -0.1], [0.04, -0.094], [0.04, 0.03], [0.034, 0.07], [0.016, 0.11], [0.0145, 0.16], [0.0001, 0.162]], 28), green);
      solid.add(lathe([[0.0162, 0.1], [0.0168, 0.116], [0.0152, 0.163], [0.0001, 0.166]], 28), GOLD_FOIL);
      solid.add(lathe([[0.0404, -0.05], [0.0404, 0.02]], 28), fin(0.75, 0.68, 0.52, 0, 0.55));
      out.lip.set(0, 0.166, 0);
      out.rimR = 0.015;
      out.spout.set(0, 0.17, 0);
      break;
    }
    case 'can': {
      // a slim energy drink: brushed aluminium top and bottom, a black and electric-green wrap
      solid.add(lathe([[0.0001, -0.07], [0.022, -0.07], [0.0265, -0.062], [0.0265, 0.055], [0.022, 0.066], [0.0001, 0.066]], 28), fin(0.02, 0.022, 0.025, 0.6, 0.35));
      solid.add(lathe([[0.02655, -0.03], [0.02655, 0.0], [0.02655, 0.018]], 28), fin(0.25, 0.9, 0.05, 0.3, 0.3));
      solid.add(lathe([[0.02, 0.066], [0.022, 0.0665], [0.0205, 0.069], [0.0001, 0.068]], 28), STEEL);
      solid.add(lathe([[0.0001, -0.0705], [0.021, -0.0705]], 28), STEEL);
      solid.add(new THREE.BoxGeometry(0.012, 0.0015, 0.007), STEEL, T(0.008, 0.069, 0));
      out.lip.set(0, 0.068, 0);
      out.rimR = 0.02;
      out.spout.set(0.008, 0.07, 0);
      break;
    }
    case 'flute': {
      shift = T(0.004, 0.045, 0);
      glass.add(lathe([[0.0001, -0.075], [0.028, -0.075], [0.029, -0.072], [0.004, -0.068], [0.003, -0.01], [0.012, 0.004], [0.022, 0.05], [0.023, 0.13], [0.0215, 0.13], [0.0205, 0.05], [0.011, 0.007]]), null);
      const p = new Parts().add(lathe([[0.0001, 0.006], [0.011, 0.009], [0.0198, 0.05], [0.0205, 0.1], [0.0001, 0.1]]), pour);
      out.pour = { geo: p.build()!, base: new THREE.Vector3(0, 0.006, 0), ay: 1, ax: 0.12 };
      out.lip.set(0, 0.13, 0);
      out.rimR = 0.022;
      out.fizz = { bottom: new THREE.Vector3(0, 0.012, 0), r: 0.012 };
      break;
    }
    case 'martini': {
      shift = T(0.006, 0.05, 0);
      glass.add(lathe([[0.0001, -0.075], [0.03, -0.075], [0.031, -0.072], [0.004, -0.068], [0.003, 0.0], [0.05, 0.06], [0.052, 0.062], [0.049, 0.062], [0.004, 0.004]]), null);
      const p = new Parts().add(lathe([[0.0001, 0.006], [0.042, 0.05], [0.0001, 0.05]]), pour);
      out.pour = { geo: p.build()!, base: new THREE.Vector3(0, 0.006, 0), ay: 1 / 3, ax: 1 / 3 };
      // the olive on its pick, leaning on the rim: it goes with the last sip
      const olive = new Parts()
        .add(new THREE.SphereGeometry(0.0065, 12, 8).scale(1, 1.25, 1), fin(0.12, 0.2, 0.02, 0, 0.35), T(0.008, 0.035, 0))
        .add(new THREE.CylinderGeometry(0.0008, 0.0008, 0.06, 5), fin(0.6, 0.45, 0.25, 0, 0.6), T(0.004, 0.045, 0).multiply(RZ(0.35)));
      out.floater = { geo: olive.build()!, low: new THREE.Vector3(0, -0.03, 0), high: new THREE.Vector3(0, 0, 0), ax: 0 };
      out.lip.set(0, 0.062, 0);
      out.rimR = 0.05;
      break;
    }
    case 'wine': {
      shift = T(0.006, 0.05, 0);
      glass.add(lathe([[0.0001, -0.075], [0.03, -0.075], [0.031, -0.072], [0.0045, -0.068], [0.0035, -0.005], [0.03, 0.02], [0.037, 0.06], [0.031, 0.1], [0.0295, 0.1], [0.0355, 0.06], [0.0285, 0.022]]), null);
      const p = new Parts().add(lathe([[0.0001, 0.0], [0.028, 0.02], [0.0335, 0.045], [0.0001, 0.045]]), pour);
      out.pour = { geo: p.build()!, base: new THREE.Vector3(0, 0.0, 0), ay: 0.6, ax: 0.3 };
      out.lip.set(0, 0.1, 0);
      out.rimR = 0.03;
      break;
    }
    case 'margarita': {
      // the classic stepped glass: a broad shallow bowl over a small one, a salted rim, a lime wheel
      shift = T(0.006, 0.05, 0);
      glass.add(
        lathe([[0.0001, -0.075], [0.03, -0.075], [0.031, -0.072], [0.004, -0.068], [0.0035, -0.01], [0.016, 0.0], [0.02, 0.018], [0.03, 0.03], [0.056, 0.05], [0.058, 0.056], [0.0555, 0.056], [0.029, 0.034], [0.018, 0.021], [0.013, 0.004]], 28),
        null,
      );
      solid.add(new THREE.TorusGeometry(0.0568, 0.0022, 5, 40).rotateX(Math.PI / 2), fin(0.92, 0.92, 0.9, 0, 0.9), T(0, 0.0565, 0));
      solid.add(new THREE.CylinderGeometry(0.018, 0.018, 0.003, 18).rotateX(Math.PI / 2), fin(0.45, 0.62, 0.08, 0, 0.5), T(0.05, 0.062, 0).multiply(RY(0.4)));
      const p = new Parts().add(lathe([[0.0001, 0.004], [0.013, 0.006], [0.018, 0.021], [0.029, 0.034], [0.05, 0.048], [0.0001, 0.048]], 28), pour);
      out.pour = { geo: p.build()!, base: new THREE.Vector3(0, 0.004, 0), ay: 0.55, ax: 0.35 };
      out.lip.set(0, 0.056, 0);
      out.rimR = 0.056;
      break;
    }
    case 'rocks': {
      shift = T(0.012, 0.03, -0.004);
      glass.add(lathe([[0.0001, -0.035], [0.037, -0.035], [0.038, 0.045], [0.035, 0.045], [0.034, -0.025], [0.0001, -0.025]]), null);
      const p = new Parts().add(lathe([[0.0001, -0.024], [0.0335, -0.024], [0.0335, 0.008], [0.0001, 0.008]]), pour);
      out.pour = { geo: p.build()!, base: new THREE.Vector3(0, -0.024, 0), ay: 1, ax: 0 };
      // the cube floats down with the whisky
      const ice = new Parts().add(new RoundedBoxGeometry(0.026, 0.026, 0.026, 2, 0.004), fin(0.7, 0.75, 0.78, 0, 0.1), T(0.004, 0, -0.004).multiply(RY(0.5)));
      out.floater = { geo: ice.build()!, low: new THREE.Vector3(0, -0.011, 0), high: new THREE.Vector3(0, 0.005, 0), ax: 0 };
      out.lip.set(0, 0.045, 0);
      out.rimR = 0.037;
      break;
    }
    case 'cup': {
      // an espresso cup on its saucer; the crema goes down with it
      shift = T(0, 0.01, -0.05);
      solid.add(lathe([[0.0001, -0.03], [0.058, -0.028], [0.06, -0.022], [0.0001, -0.026]], 32), CHINA);
      solid.add(lathe([[0.0001, -0.024], [0.022, -0.024], [0.028, 0.0], [0.03, 0.022], [0.028, 0.022], [0.026, 0.004], [0.0001, 0.004]], 28), CHINA);
      solid.add(new THREE.TorusGeometry(0.009, 0.0028, 6, 14, Math.PI * 1.3), CHINA, T(0.031, 0.006, 0).multiply(RZ(-Math.PI * 0.65)));
      const crema = new Parts().add(lathe([[0.0001, 0], [0.027, 0]], 28), fin(0.3, 0.14, 0.05, 0, 0.35));
      out.floater = { geo: crema.build()!, low: new THREE.Vector3(0, 0.005, 0), high: new THREE.Vector3(0, 0.016, 0), ax: 0.25 };
      out.lip.set(0, 0.022, 0);
      out.rimR = 0.029;
      out.spout.set(0, 0.024, 0);
      break;
    }
    case 'plate':
    case 'cake': {
      const plate = new THREE.Vector3(0, 0.002, PLATE_Z);
      out.plate = plate.clone().add(new THREE.Vector3(0, 0.02, 0));
      solid.add(lathe([[0.0001, -0.004], [0.075, -0.004], [0.1, 0.004], [0.104, 0.008], [0.1, 0.008], [0.075, 0.0], [0.0001, 0.0]], 36), CHINA, T(0, 0, PLATE_Z));
      const on = T(plate.x, plate.y, plate.z);
      const food = new Pieces();
      dish(item, on, solid, food, out);
      out.food = food.build();
      out.lip.copy(plate).add(new THREE.Vector3(0, 0.05, 0.02));
      out.spout.copy(plate).add(new THREE.Vector3(0, 0.1, 0));
      break;
    }
  }
  const moveAll = (g: THREE.BufferGeometry | null | undefined) => g?.applyMatrix4(shift);
  out.solid = solid.build();
  out.glass = glass.build();
  moveAll(out.solid);
  moveAll(out.glass);
  moveAll(out.tinted?.geo);
  if (out.pour) {
    moveAll(out.pour.geo);
    out.pour.base.applyMatrix4(shift);
  }
  if (out.floater) {
    // a floater is built round its own origin and placed between low and high
    out.floater.low.applyMatrix4(shift);
    out.floater.high.applyMatrix4(shift);
  }
  for (const v of [out.lip, out.spout, ...out.flames, ...(out.fizz ? [out.fizz.bottom] : []), ...(out.plate ? [out.plate] : [])]) v.applyMatrix4(shift);
  return out;
}

/** What's on the plate, piece by piece, and the pieces as the eating hand holds them. */
function dish(item: string, on: THREE.Matrix4, solid: Parts, food: Pieces, out: HeldModel): void {
  const at = (x: number, y: number, z: number, rot = 0) => on.clone().multiply(T(x, y, z)).multiply(RY(rot));
  switch (item) {
    case 'sliders': {
      const slider = (p: Parts, m: THREE.Matrix4) =>
        p
          .add(new THREE.SphereGeometry(0.022, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1), BUN, m.clone().multiply(T(0, 0.022, 0)))
          .add(new THREE.CylinderGeometry(0.021, 0.021, 0.008, 14), BEEF, m.clone().multiply(T(0, 0.014, 0)))
          .add(new THREE.CylinderGeometry(0.023, 0.023, 0.003, 14), CHEDDAR, m.clone().multiply(T(0, 0.0185, 0)))
          .add(new THREE.CylinderGeometry(0.02, 0.021, 0.008, 14), BUN, m.clone().multiply(T(0, 0.006, 0)));
      for (const [x, z] of [
        [0.0, -0.028],
        [0.028, 0.02],
        [-0.03, 0.012],
      ] as const)
        slider(food.piece(), at(x, 0, z));
      const h = new Parts();
      slider(h, T(0, -0.02, 0));
      food.hand.push(h.build()!);
      break;
    }
    case 'truffle-fries': {
      // a pile of fries: the ones on top go first, three at a time
      const fries: { x: number; y: number; z: number; a: number }[] = [];
      for (let i = 0; i < 24; i++) {
        const a = i * 2.4;
        const r = 0.01 + (i % 5) * 0.009;
        fries.push({ x: Math.cos(a) * r, y: 0.006 + (i % 3) * 0.006, z: Math.sin(a) * r, a });
      }
      fries.sort((p, q) => q.y - p.y || p.x - q.x);
      for (let b = 0; b < 8; b++) {
        const p = food.piece();
        for (const f of fries.slice(b * 3, b * 3 + 3)) p.add(new THREE.BoxGeometry(0.007, 0.007, 0.055), FRY, at(f.x, f.y, f.z, f.a));
      }
      // parmesan and a scatter of truffle stay on the plate
      for (let i = 0; i < 10; i++) solid.add(new THREE.BoxGeometry(0.004, 0.002, 0.004), fin(0.9, 0.85, 0.6, 0, 0.7), at(Math.cos(i * 1.7) * 0.05, 0.003, Math.sin(i * 1.7) * 0.05, i));
      const h = new Parts();
      for (const [dx, a] of [
        [-0.004, 0.2],
        [0, -0.1],
        [0.004, 0.35],
      ] as const)
        h.add(new THREE.BoxGeometry(0.007, 0.007, 0.055), FRY, RX(1.2).multiply(T(dx, 0, 0)).multiply(RY(a * 0.3)));
      food.hand.push(h.build()!);
      break;
    }
    case 'shrimp-cocktail': {
      solid.add(new THREE.CylinderGeometry(0.035, 0.03, 0.02, 20), fin(0.8, 0.84, 0.86, 0.6, 0.1), at(0, 0.01, 0));
      solid.add(new THREE.CylinderGeometry(0.031, 0.031, 0.004, 20), fin(0.7, 0.12, 0.06, 0, 0.3), at(0, 0.019, 0));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        food.piece().add(new THREE.TorusGeometry(0.014, 0.0065, 6, 12, Math.PI * 1.2), PRAWN, at(Math.cos(a) * 0.03, 0.024, Math.sin(a) * 0.03, -a));
      }
      food.hand.push(new Parts().add(new THREE.TorusGeometry(0.014, 0.0065, 6, 12, Math.PI * 1.2), PRAWN, RX(Math.PI / 2)).build()!);
      break;
    }
    case 'lobster': {
      // the shell stays; the tail meat, cut in rounds, goes a round at a time
      solid.add(new THREE.CapsuleGeometry(0.02, 0.07, 4, 12).rotateX(Math.PI / 2).scale(1, 0.55, 1), SHELL, at(-0.02, 0.012, 0));
      for (const s of [-1, 1]) solid.add(new THREE.SphereGeometry(0.014, 10, 8).scale(1, 0.7, 1.6), SHELL, at(-0.02 + s * 0.028, 0.012, -0.055, s * 0.4));
      solid.add(new THREE.CylinderGeometry(0.014, 0.012, 0.016, 12), fin(0.8, 0.8, 0.8, 0.8, 0.2), at(0.05, 0.008, 0.035));
      solid.add(new THREE.CylinderGeometry(0.0125, 0.0125, 0.002, 12), BUTTER, at(0.05, 0.0155, 0.035));
      for (let i = 0; i < 5; i++) food.piece().add(new THREE.CylinderGeometry(0.012, 0.013, 0.012, 12).rotateZ(Math.PI / 2), MEAT, at(0.035, 0.012, -0.045 + i * 0.016));
      food.hand.push(new Parts().add(new THREE.CylinderGeometry(0.012, 0.013, 0.012, 12), MEAT).add(new THREE.CylinderGeometry(0.0122, 0.0122, 0.003, 12), PINK, T(0, 0.006, 0)).build()!);
      break;
    }
    case 'caviar': {
      solid.add(new THREE.CylinderGeometry(0.03, 0.03, 0.014, 24), STEEL, at(-0.02, 0.007, 0));
      solid.add(new THREE.CylinderGeometry(0.027, 0.027, 0.002, 24), ROE, at(-0.02, 0.0142, 0));
      const blini = (p: Parts, m: THREE.Matrix4) =>
        p
          .add(new THREE.CylinderGeometry(0.014, 0.014, 0.005, 14), BLINI, m)
          .add(new THREE.SphereGeometry(0.007, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), CREME, m.clone().multiply(T(0, 0.0025, 0)))
          .add(new THREE.SphereGeometry(0.0055, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1), ROE, m.clone().multiply(T(0.001, 0.0055, 0)));
      for (const [x, z] of [
        [0.045, 0.01],
        [0.035, -0.035],
        [-0.03, 0.04],
        [0.02, 0.045],
      ] as const)
        blini(food.piece(), at(x, 0.003, z));
      const h = new Parts();
      blini(h, RX(-0.5));
      food.hand.push(h.build()!);
      break;
    }
    case 'ribeye': {
      // slices fanned across the plate, a spoon of chimichurri at the side
      const slice = (p: Parts, m: THREE.Matrix4) =>
        p.add(new RoundedBoxGeometry(0.05, 0.012, 0.014, 2, 0.003), SEAR, m).add(new THREE.BoxGeometry(0.044, 0.0122, 0.0128), PINK, m.clone().multiply(T(0, 0, 0.0009)));
      for (let i = 0; i < 6; i++) slice(food.piece(), at(-0.01 + i * 0.004, 0.008, 0.04 - i * 0.015, 0.35));
      for (let i = 0; i < 6; i++) solid.add(new THREE.SphereGeometry(0.006, 8, 6).scale(1, 0.4, 1), HERB, at(0.05 + Math.cos(i) * 0.008, 0.002, -0.02 + Math.sin(i) * 0.008));
      const h = new Parts();
      slice(h, RZ(Math.PI / 2).multiply(RX(0.3)));
      food.hand.push(h.build()!);
      break;
    }
    case 'macarons': {
      const macaron = (p: Parts, m: THREE.Matrix4, f: Finish) =>
        p
          .add(new THREE.SphereGeometry(0.014, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), f, m.clone().multiply(T(0, 0.009, 0)))
          .add(new THREE.CylinderGeometry(0.0125, 0.0125, 0.004, 14), CREAM_LAYER, m.clone().multiply(T(0, 0.007, 0)))
          .add(new THREE.SphereGeometry(0.014, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.35, 1), f, m.clone().multiply(T(0, 0.005, 0)));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        macaron(food.piece(), at(Math.cos(a) * 0.045, 0, Math.sin(a) * 0.045, a), MACARONS[i]!);
        const h = new Parts();
        macaron(h, RX(1.3).multiply(T(0, -0.007, 0)), MACARONS[i]!);
        food.hand.push(h.build()!);
      }
      break;
    }
    case 'birthday-cake': {
      // a small chocolate layer cake in four wedges, a candle on three of them
      const R = 0.052;
      const H = 0.05;
      const wedge = (p: Parts, m: THREE.Matrix4, a0: number, candle: boolean) => {
        const w = Math.PI / 2;
        p.add(new THREE.CylinderGeometry(R, R, H * 0.42, 10, 1, false, a0, w), SPONGE, m.clone().multiply(T(0, H * 0.21, 0)))
          .add(new THREE.CylinderGeometry(R, R, H * 0.1, 10, 1, false, a0, w), CREAM_LAYER, m.clone().multiply(T(0, H * 0.47, 0)))
          .add(new THREE.CylinderGeometry(R, R, H * 0.4, 10, 1, false, a0, w), SPONGE, m.clone().multiply(T(0, H * 0.72, 0)))
          .add(new THREE.CylinderGeometry(R + 0.002, R + 0.002, H * 0.1, 10, 1, false, a0, w), FROSTING, m.clone().multiply(T(0, H * 0.96, 0)));
        // the cut faces, so a slice shows its layers
        for (const a of [a0, a0 + w]) {
          // each faces away from the wedge: back toward a0 at a0, on round at the other
          const face = new THREE.PlaneGeometry(R, H);
          if (a !== a0) face.rotateY(Math.PI);
          p.add(face.translate(R / 2, H / 2, 0), SPONGE, m.clone().multiply(RY(a - Math.PI / 2)));
        }
        if (candle) {
          const mid = a0 + w / 2;
          const cx = Math.sin(mid) * R * 0.55;
          const cz = Math.cos(mid) * R * 0.55;
          p.add(new THREE.CylinderGeometry(0.0022, 0.0022, 0.03, 8), WAX, m.clone().multiply(T(cx, H + 0.015, cz)));
          p.add(new THREE.CylinderGeometry(0.0004, 0.0004, 0.004, 4), WICK, m.clone().multiply(T(cx, H + 0.032, cz)));
          return new THREE.Vector3(cx, H + 0.038, cz).applyMatrix4(m);
        }
        return null;
      };
      for (let i = 0; i < 4; i++) {
        const flame = wedge(food.piece(), on, (i * Math.PI) / 2, i !== 3);
        if (flame) out.flames.push(flame);
      }
      const h = new Parts();
      wedge(h, T(-R * 0.35, -H * 0.5, -R * 0.35).premultiply(new THREE.Matrix4().makeScale(0.8, 0.8, 0.8)), 0, false);
      food.hand.push(h.build()!);
      break;
    }
    default: {
      // something new on the menu: a golden mound, in bites
      for (let i = 0; i < 4; i++) food.piece().add(new THREE.SphereGeometry(0.02, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), fin(0.62, 0.36, 0.14, 0, 0.5), at(Math.cos(i * 1.6) * 0.035, 0, Math.sin(i * 1.6) * 0.035));
      food.hand.push(new Parts().add(new THREE.SphereGeometry(0.018, 12, 8).scale(1, 0.6, 1), fin(0.62, 0.36, 0.14, 0, 0.5)).build()!);
    }
  }
}
