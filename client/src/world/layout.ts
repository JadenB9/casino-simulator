// The floor plan, as data. Everything that stands on the floor is placed from here: the table
// pit, the slot banks (one island per slots variant in the catalogue), the Big Six wheel, the
// video poker bar, the cashier, the poker room, the lounge, the aisles, the columns, the plants
// and the hanging signs. Station spacing comes from each game module's footprint, so when a real
// table or machine replaces a stub the floor re-flows around it and the aisles stay clear.
//
// Only real things block the way: walls, tables, machines, the bar, columns, plants and counters.
// Every one of them is also listed as a solid (its footprint and height), and checkLayout() checks
// that no two of them pass through each other, a wall or a ceiling.
//
// Coordinates: metres, +x east, +z south (toward the entrance), y up. Station yaw follows
// Object3D.rotation.y; a station's player side is its local +z, so yaw 0 faces the players south.

import type { GameId } from '../../../shared/src/engine.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';

export interface Footprint {
  width: number;
  depth: number;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type Zone = 'pit' | 'slots' | 'bar' | 'poker' | 'cashier' | 'feature';

export interface Placement {
  id: string;
  game: GameId;
  variant: string;
  x: number;
  z: number;
  yaw: number;
  zone: Zone;
  /** Footprint used for spacing and collision. */
  fp: Footprint;
}

export interface Bank {
  variant: string;
  /** Centre and long axis of the island; machines face out on both sides (or one side against a wall). */
  x: number;
  z: number;
  /** 0: long axis along x (machines face north and south); PI/2: along z (machines face east and west). */
  yaw: number;
  length: number;
  depth: number;
  ids: string[];
}

export interface Column {
  x: number;
  z: number;
  r: number;
}

export type PlantKind = 'plant-a' | 'plant-b';

/** A plant in a lacquer planter. `size` is the plant's height above the pot. */
export interface Plant {
  kind: PlantKind;
  x: number;
  z: number;
  size: number;
}

export interface Palm {
  x: number;
  z: number;
  size: number;
}

export type HangingId = 'table-games' | 'slots' | 'poker' | 'entrance' | 'cashier';

/** A sign box hung from the ceiling on two rods: centre, turn and the face's size. */
export interface Hanging {
  id: HangingId;
  x: number;
  y: number;
  z: number;
  ry: number;
  w: number;
  h: number;
}

/** Something solid on the floor besides the stations, for the clipping checks. */
export interface Solid {
  id: string;
  /** Parts of one thing (a planter and its leaves, the bar's counter and foot rail) share a group and may touch. */
  group: string;
  /** Centre, size along its own x and z, and turn (Object3D.rotation.y). A round solid's diameter is `w`. */
  x: number;
  z: number;
  w: number;
  d: number;
  yaw: number;
  /** Bottom and top above the floor. */
  y0: number;
  y1: number;
  round?: boolean;
  /** Built against a wall on purpose (the back bar, the cashier's cage): it may meet the wall's face. */
  wall?: boolean;
  /** Stations standing in or on it (a slot island's machines, video poker on a bar-top counter). */
  holds?: string[];
  /** Standing on the floor in someone's way (planters, stools, furniture): kept out of the aisles. */
  floor?: boolean;
}

/** Bar-top video poker sits on the counter; a taller cabinet stands on the floor in a gap in the bar. */
export type VpMode = 'bartop' | 'floor';

export interface FloorPlan {
  room: Rect;
  stations: Placement[];
  pit: Rect;
  /** The dealers' side between the two rows, with the pit podium. */
  staff: Rect;
  podium: { x: number; z: number };
  aisles: Rect[];
  entrance: Rect;
  door: { x0: number; x1: number; height: number };
  pokerRoom: Rect;
  slotsZone: Rect;
  /** Where a tall feature (the Big Six wheel) stands against a wall, with its players' room. */
  feature: Rect;
  barZone: Rect;
  banks: Bank[];
  bar: {
    /** Customer face of the counter (x), and its run along z. */
    front: number;
    depth: number;
    z0: number;
    z1: number;
    /** The back bar against the east wall. */
    back: number;
    /** The runs of counter (z0, z1): the whole bar, less a gap for each floor-standing video poker cabinet. */
    segments: [number, number][];
    /** Bar stools: their line (x) and where along it. */
    stoolX: number;
    stools: number[];
    vp: string[];
    /** Drum pendants over the counter (z of each). */
    pendants: number[];
  };
  vpMode: VpMode;
  cashier: {
    counter: Rect;
    /** Where a player stands to use it, and which way they face (yaw of a character looking at the counter). */
    x: number;
    z: number;
    face: number;
  };
  lounge: Rect;
  /** Couch groups round a coffee table (the table's centre). */
  loungeGroups: { x: number; z: number }[];
  columns: Column[];
  plants: Plant[];
  palms: Palm[];
  hanging: Hanging[];
  /** Everything solid besides the stations: see Solid. */
  solids: Solid[];
}

export const ROOM: Rect = { x0: -20, z0: -15, x1: 20, z1: 15 };
/** Friedman-low ceiling over slots, the bar and the aisles. */
export const CEILING = 3.4;
/** The grand coffered ceiling over the table pit. */
export const PIT_CEILING = 6.6;
export const WALL = 0.3;
/** How far the wainscot, chair rail and crown stand proud of a wall's face. */
const TRIM = 0.08;

// The loose props' shapes at their placed sizes, measured from the models (world3.mjs audits them).
/** Planters: the least radius, the height of the pot and the height the plant stands at. */
export const PLANTER = { r: 0.32, h: 0.46, seat: 0.42 };
export const PALM_PLANTER = { r: 0.5, h: 0.62, seat: 0.55 };
/**
 * Per metre of plant: the model's own pot or root ball at its foot (the planter is made wider than
 * that), the leaves' spread, and where the leaves start as a fraction of its height.
 */
export const LEAVES: Record<PlantKind | 'palm', { base: number; r: number; from: number }> = {
  'plant-a': { base: 0.33, r: 0.71, from: 0.03 },
  'plant-b': { base: 0.21, r: 0.77, from: 0.05 },
  palm: { base: 0.22, r: 0.64, from: 0.39 },
};
/** A palm's trunk leans off the pot's centre (the model is centred on its fronds): its reach, per metre. */
const PALM_TRUNK = 0.23;

/** The planter a plant stands in: wide enough for the model's own pot to sit inside it. */
export function planterRadius(kind: PlantKind | 'palm', size: number): number {
  return Math.max(kind === 'palm' ? PALM_PLANTER.r : PLANTER.r, LEAVES[kind].base * size + 0.04);
}
export const STOOL = { r: 0.21, h: 0.8 };
export const COUCH = { w: 2.2, d: 0.8, h: 0.85 };
export const FLOOR_LAMP = { r: 0.42, h: 1.45 };
export const COFFEE_TABLE = { w: 1.3, d: 0.7, h: 0.44 };
export const PODIUM = { w: 1.4, d: 0.64, h: 1.49 };
/** The bar counter's height (the video poker bar-top units stand on it). */
export const BAR_TOP = 1.08;

/** How tall each kind of station stands, for checking what hangs or leans over it. */
export const STATION_H: Record<Zone, number> = { pit: 1.45, poker: 1.45, slots: 2.45, bar: 1.8, feature: 3.05, cashier: 1.2 };

const TABLE_GAP = 1.7;
const NORTH_AISLE = 3.4;
const STAFF_DEPTH = 2.6;
/** Standing or seated players in front of a table or machine. */
const PLAYER_ZONE = 0.95;
const CROSS_AISLE = 2.8;

interface Want {
  id: string;
  game: GameId;
  variant: string;
}

// The dice games share the middle of the north row, the roulettes at its ends; Casino War sits
// mid-row in the south, facing the main aisle and the doors.
const NORTH_ROW: Want[] = [
  { id: 'rl-us', game: 'roulette', variant: 'american' },
  { id: 'cr-1', game: 'craps', variant: '' },
  { id: 'sb-1', game: 'sicbo', variant: '' },
  { id: 'rl-eu', game: 'roulette', variant: 'european' },
];

const SOUTH_ROW: Want[] = [
  { id: 'bj-1', game: 'blackjack', variant: '' },
  { id: 'bc-1', game: 'baccarat', variant: '' },
  { id: 'wr-1', game: 'war', variant: '' },
  { id: 'tc-1', game: 'threecard', variant: '' },
  { id: 'bj-2', game: 'blackjack', variant: '' },
];

/** The Big Six wheel stands about 3 m tall: against the west wall, facing the pit. */
const BIG_SIX: Want = { id: 'b6-1', game: 'bigsix', variant: '' };

const POKER: Want[] = [
  { id: 'he-1', game: 'holdem', variant: '' },
  { id: 'he-2', game: 'holdem', variant: '' },
];

/** Every slots variant in the catalogue gets an island, in catalogue order. */
export function slotVariants(): string[] {
  return CATALOG.slots.variants.map((v) => v.id);
}
const PER_SIDE = 2;
const VP_COUNT = 4;
/** Walking room between the end caps of neighbouring slot islands, and between facing players. */
const ISLAND_GAP = 1.6;
const ISLAND_LANE = 1.3;

export function planFloor(footprint: (game: GameId) => Footprint, slots: readonly string[] = slotVariants(), opts: { vpMode?: VpMode } = {}): FloorPlan {
  const stations: Placement[] = [];
  const fp = (g: GameId) => {
    const f = footprint(g);
    return { width: Math.max(0.4, f.width), depth: Math.max(0.4, f.depth) };
  };

  // --- table pit: two rows facing out, dealers back to back across the staff area ---------------
  const rowLen = (row: Want[]) => row.reduce((s, w) => s + fp(w.game).width, 0) + TABLE_GAP * (row.length - 1);
  const rowDepth = (row: Want[]) => Math.max(...row.map((w) => fp(w.game).depth));
  const dN = rowDepth(NORTH_ROW);
  const dS = rowDepth(SOUTH_ROW);
  const zN = ROOM.z0 + NORTH_AISLE + dN / 2;
  const zS = zN + dN / 2 + STAFF_DEPTH + dS / 2;
  const placeRow = (row: Want[], z: number, yaw: number) => {
    let x = -rowLen(row) / 2;
    for (const w of row) {
      const f = fp(w.game);
      stations.push({ ...w, x: x + f.width / 2, z, yaw, zone: 'pit', fp: f });
      x += f.width + TABLE_GAP;
    }
  };
  placeRow(NORTH_ROW, zN, Math.PI);
  placeRow(SOUTH_ROW, zS, 0);
  const half = Math.max(rowLen(NORTH_ROW), rowLen(SOUTH_ROW)) / 2;
  const pit: Rect = { x0: -half - 1.9, x1: half + 1.9, z0: zN - dN / 2 - PLAYER_ZONE - 0.8, z1: zS + dS / 2 + PLAYER_ZONE + 0.7 };
  const staffHalf = Math.min(rowLen(NORTH_ROW), rowLen(SOUTH_ROW)) / 2;
  const staff: Rect = { x0: -staffHalf, x1: staffHalf, z0: zN + dN / 2, z1: zS - dS / 2 };
  const podium = { x: (staff.x0 + staff.x1) / 2, z: (staff.z0 + staff.z1) / 2 };

  // --- aisles --------------------------------------------------------------------------------
  const crossZ0 = zS + dS / 2 + PLAYER_ZONE;
  const crossZ1 = crossZ0 + CROSS_AISLE;
  const entrance: Rect = { x0: -4.6, x1: 4.6, z0: 11.6, z1: ROOM.z1 };
  const aisles: Rect[] = [
    { x0: ROOM.x0 + WALL, x1: ROOM.x1 - WALL, z0: crossZ0, z1: crossZ1 },
    { x0: -2.1, x1: 2.1, z0: crossZ1, z1: entrance.z0 },
    { x0: pit.x0 - 0.2, x1: pit.x1 + 0.2, z0: ROOM.z0 + WALL, z1: zN - dN / 2 - PLAYER_ZONE },
  ];

  // --- cashier: a cage on the north wall in the west corner, wall to wall -----------------------
  const counter: Rect = { x0: ROOM.x0, x1: -12.6, z0: ROOM.z0, z1: -12.4 };
  const cashier = { counter, x: (counter.x0 + counter.x1) / 2 + 0.4, z: counter.z1 + 0.75, face: Math.PI };

  // --- poker room: north-east, two hold'em tables. Side on (dealers against the east wall) when
  // the room is long enough for both with walking room between; otherwise one behind the other.
  const pokerRoom: Rect = { x0: Math.max(pit.x1 + 1.6, 11.4), x1: ROOM.x1 - WALL, z0: ROOM.z0 + WALL, z1: crossZ0 - 0.4 };
  {
    const f = fp('holdem');
    const long = pokerRoom.z1 - pokerRoom.z0;
    const sideOn = 2 * f.width + 1.6 + 2 * 0.7 <= long;
    if (sideOn) {
      const x = ROOM.x1 - WALL - 1.6 - f.depth / 2;
      const gap = Math.min(2.6, long - 2 * f.width - 1.4);
      let z = (pokerRoom.z0 + pokerRoom.z1) / 2 - (f.width + gap / 2);
      for (const w of POKER) {
        stations.push({ ...w, x, z: z + f.width / 2, yaw: -Math.PI / 2, zone: 'poker', fp: f });
        z += f.width + gap;
      }
    } else {
      // players' side south: each table needs its depth plus standing room in front
      const x = (pokerRoom.x0 + 1.2 + pokerRoom.x1) / 2;
      const cell = f.depth + PLAYER_ZONE;
      const gap = Math.max(0.6, Math.min(1.8, (long - 0.5 - 2 * cell) / 2));
      let z = pokerRoom.z0 + 0.5;
      for (const w of POKER) {
        stations.push({ ...w, x, z: z + f.depth / 2, yaw: 0, zone: 'poker', fp: f });
        z += cell + gap;
      }
    }
  }

  // --- slots: one island per variant, in a grid on the south-west floor -----------------------
  // Islands run east-west with machines back to back facing north and south. The grid takes as
  // few rows as fit the zone's depth (squarish when there's room), spreads the islands evenly
  // and keeps a lane between every pair of facing players.
  const slotsZone: Rect = { x0: ROOM.x0 + WALL, x1: -3.1, z0: crossZ1, z1: ROOM.z1 - WALL };
  const sf = fp('slots');
  const pitch = sf.width + 0.06;
  const bankLen = PER_SIDE * pitch;
  const bankDepth = 2 * sf.depth + 0.3;
  const banks: Bank[] = [];
  const addBank = (variant: string, x: number, z: number, yaw: number) => {
    const ids: string[] = [];
    // machines along the long axis, back to back across the spine
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    // the side normal: yaw 0 -> +z, yaw PI/2 -> +x
    const nx = Math.sin(yaw);
    const nz = Math.cos(yaw);
    let n = banks.reduce((s, b) => s + (b.variant === variant ? b.ids.length : 0), 0);
    for (const side of [1, -1]) {
      for (let i = 0; i < PER_SIDE; i++) {
        const along = (i - (PER_SIDE - 1) / 2) * pitch * side;
        const off = side * (0.15 + sf.depth / 2);
        const id = `slots-${variant}-${++n}`;
        ids.push(id);
        stations.push({
          id,
          game: 'slots',
          variant,
          x: x + ax * along + nx * off,
          z: z + az * along + nz * off,
          yaw: side > 0 ? yaw : yaw + Math.PI,
          zone: 'slots',
          fp: sf,
        });
      }
    }
    banks.push({ variant, x, z, yaw, length: bankLen, depth: bankDepth, ids });
  };
  {
    // an island's size with its end caps and plinth (decor.ts)
    const islandW = bankLen + 0.62;
    const colPitch = islandW + ISLAND_GAP;
    const rowPitch = bankDepth + 2 * PLAYER_ZONE + ISLAND_LANE;
    const gx0 = slotsZone.x0 + 0.9 + islandW / 2;
    const gx1 = slotsZone.x1 - 0.9 - islandW / 2;
    const gz0 = slotsZone.z0 + PLAYER_ZONE + 0.6 + bankDepth / 2;
    const gz1 = slotsZone.z1 - PLAYER_ZONE - 1.6 - bankDepth / 2;
    const maxCols = Math.max(1, Math.floor((gx1 - gx0) / colPitch) + 1);
    const maxRows = Math.max(1, Math.floor((gz1 - gz0) / rowPitch) + 1);
    const n = slots.length;
    let rows = Math.max(1, Math.min(maxRows, Math.ceil(Math.sqrt(n))));
    let cols = Math.ceil(n / rows);
    while (cols > maxCols && rows < maxRows) cols = Math.ceil(n / ++rows);
    // spread evenly, but no further apart than looks like one slot floor
    const dx = cols > 1 ? Math.min((gx1 - gx0) / (cols - 1), colPitch * 1.6) : 0;
    const dz = rows > 1 ? Math.min((gz1 - gz0) / (rows - 1), rowPitch * 1.5) : 0;
    const cx = (gx0 + gx1) / 2;
    const cz = rows > 1 ? (gz0 + gz1) / 2 : gz0;
    slots.forEach((variant, i) => {
      const r = Math.floor(i / cols);
      // a short last row sits in the middle
      const inRow = Math.min(cols, n - r * cols);
      const c = i % cols;
      addBank(variant, cx + (c - (inRow - 1) / 2) * dx, cz + (r - (rows - 1) / 2) * dz, 0);
    });
  }

  // --- the feature spot: the Big Six against the west wall, between the cashier's queue and the
  // cross aisle, facing east toward the pit ------------------------------------------------------
  const queueEnd = counter.z1 + 3.2;
  const feature: Rect = { x0: ROOM.x0 + WALL, x1: Math.min(pit.x0, -9.5) - 0.6, z0: queueEnd, z1: crossZ0 - 0.4 };
  {
    const f = fp(BIG_SIX.game);
    const x = feature.x0 + 0.35 + f.depth / 2;
    const z = Math.max(feature.z0 + f.width / 2, (feature.z0 + feature.z1) / 2);
    stations.push({ ...BIG_SIX, x, z, yaw: Math.PI / 2, zone: 'feature', fp: f });
  }

  // --- the bar: counter along the east wall, video poker set into the north end ----------------
  const barZone: Rect = { x0: 3.1, x1: ROOM.x1 - WALL, z0: crossZ1, z1: ROOM.z1 - WALL };
  const back = ROOM.x1 - WALL - 0.75;
  const front = back - 2.9;
  const barZ0 = barZone.z0 + 1.6;
  const barZ1 = ROOM.z1 - WALL - 1.5;
  const vf = fp('videopoker');
  const vpPitch = Math.max(1.25, vf.width + 0.2);
  const vp: string[] = [];
  for (let i = 0; i < VP_COUNT; i++) {
    const id = `vp-${i + 1}`;
    vp.push(id);
    stations.push({
      id,
      game: 'videopoker',
      variant: '',
      x: front + vf.depth / 2 - 0.05,
      z: barZ0 + 0.9 + vpPitch / 2 + i * vpPitch,
      yaw: -Math.PI / 2,
      zone: 'bar',
      fp: vf,
    });
  }
  const pendants: number[] = [];
  for (let z = barZ0 + 0.9; z < barZ1 - 0.5; z += 1.9) pendants.push(z);
  // stools stand far enough out that their legs clear the foot rail
  const stoolX = front - 0.52;
  const bar: FloorPlan['bar'] = { front, depth: 0.78, z0: barZ0, z1: barZ1, back, segments: [], stoolX, stools: [], vp, pendants };

  const lounge: Rect = { x0: 4.2, x1: front - 3.2, z0: Math.max(barZone.z0 + 3.2, 4.2), z1: ROOM.z1 - WALL - 1.2 };
  const loungeGroups = (lounge.z1 - lounge.z0 > 6.5 ? [lounge.z0 + 2.2, lounge.z1 - 2.3] : [(lounge.z0 + lounge.z1) / 2]).map((z) => ({ x: (lounge.x0 + lounge.x1) / 2, z }));

  // --- columns: the pit corners, the main aisle and the vestibule -----------------------------
  const columns: Column[] = [
    { x: pit.x0, z: pit.z0, r: 0.42 },
    { x: pit.x1, z: pit.z0, r: 0.42 },
    { x: pit.x0, z: pit.z1, r: 0.42 },
    { x: pit.x1, z: pit.z1, r: 0.42 },
    { x: -2.95, z: crossZ1 + 3.4, r: 0.34 },
    { x: 2.95, z: crossZ1 + 3.4, r: 0.34 },
    { x: -2.95, z: entrance.z0 - 2.6, r: 0.34 },
    { x: 2.95, z: entrance.z0 - 2.6, r: 0.34 },
  ];

  // --- hanging signs ----------------------------------------------------------------------------
  const cross = { z: (crossZ0 + crossZ1) / 2 };
  const slotCols = columns.filter((c) => c.x < 0 && c.z > crossZ1);
  const hanging: Hanging[] = [
    // under the pit's south cove, over the cross aisle
    { id: 'table-games', x: 0, y: 2.96, z: pit.z1 + 0.2, ry: 0, w: 4.6, h: 0.6 },
    // over the slot floor's edge facing the main aisle, midway between its two columns so
    // neither stands in front of it
    { id: 'slots', x: slotsZone.x1 - 0.35, y: 2.92, z: slotCols.length === 2 ? (slotCols[0]!.z + slotCols[1]!.z) / 2 : slotsZone.z0 + 3.2, ry: Math.PI / 2, w: 2.4, h: 0.66 },
    { id: 'poker', x: pokerRoom.x0 - 0.05, y: 2.98, z: (pokerRoom.z0 + pokerRoom.z1) / 2, ry: -Math.PI / 2, w: 2.2, h: 0.6 },
    { id: 'entrance', x: 0, y: 3.0, z: entrance.z0 - 0.9, ry: 0, w: 5.2, h: 0.5 },
    { id: 'cashier', x: pit.x0 - 1.2, y: 3.02, z: cross.z, ry: Math.PI / 2, w: 3.2, h: 0.44 },
  ];

  const plan: FloorPlan = {
    room: ROOM,
    stations,
    pit,
    staff,
    podium,
    aisles,
    entrance,
    door: { x0: -1.3, x1: 1.3, height: 2.9 },
    pokerRoom,
    slotsZone,
    feature,
    barZone,
    banks,
    bar,
    vpMode: 'floor',
    cashier,
    lounge,
    loungeGroups,
    columns,
    plants: [],
    palms: [],
    hanging,
    solids: [],
  };
  setVpMode(plan, opts.vpMode ?? 'floor');
  return plan;
}

/**
 * The bar's counter runs and stools for how video poker stands (on the counter or in gaps in
 * it), then the plants (which keep clear of everything) and the solids list. planFloor() calls it;
 * call it again if the machines turn out to be bar-top units.
 */
export function setVpMode(plan: FloorPlan, mode: VpMode): void {
  plan.vpMode = mode;
  const bar = plan.bar;
  const vps = plan.stations.filter((s) => s.game === 'videopoker');
  const gaps: [number, number][] = mode === 'floor' ? vps.map((s) => [s.z - s.fp.width / 2 - 0.04, s.z + s.fp.width / 2 + 0.04]) : [];
  const segments: [number, number][] = [];
  let z = bar.z0;
  for (const [a, c] of gaps.sort((p, q) => p[0] - q[0])) {
    if (a > z + 0.05) segments.push([z, a]);
    z = Math.max(z, c);
  }
  if (bar.z1 > z + 0.05) segments.push([z, bar.z1]);
  bar.segments = segments;
  const vpEnd = vps.length ? Math.max(...vps.map((s) => s.z + s.fp.width / 2)) : bar.z0;
  const stools: number[] = [];
  for (let s = vpEnd + 0.1 + 0.75; s < bar.z1 - 0.5; s += 0.95) stools.push(s);
  // bar-top units get a stool each, in front of the counter
  if (mode === 'bartop') stools.unshift(...vps.map((s) => s.z));
  bar.stools = stools;
  plan.plants = [];
  plan.palms = [];
  plan.solids = baseSolids(plan);
  placePalms(plan);
  placePlants(plan);
}

// --- solids -----------------------------------------------------------------------------------

/** The fixed furniture's solids: everything but the plants, which are fitted in round these. */
function baseSolids(plan: FloorPlan): Solid[] {
  const out: Solid[] = [];
  const box = (id: string, group: string, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, extra: Partial<Solid> = {}) =>
    out.push({ id, group, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, yaw: 0, y0, y1, ...extra });
  const round = (id: string, group: string, x: number, z: number, r: number, y0: number, y1: number, extra: Partial<Solid> = {}) =>
    out.push({ id, group, x, z, w: 2 * r, d: 2 * r, yaw: 0, y0, y1, round: true, ...extra });

  plan.columns.forEach((c, i) => round(`column-${i + 1}`, `column-${i + 1}`, c.x, c.z, c.r + 0.12, 0, CEILING));

  // slot islands: plinth, spine, end caps and LED strips; the topper on its mast above
  for (const b of plan.banks) {
    const g = `bank-${b.variant}`;
    out.push({ id: `${g}-island`, group: g, x: b.x, z: b.z, w: b.length + 0.54, d: b.depth + 0.2, yaw: b.yaw, y0: 0, y1: 1.95, holds: b.ids, floor: true });
    const tw = Math.min(Math.max(b.length * 0.9, 1.6), 3.2);
    out.push({ id: `${g}-topper`, group: g, x: b.x, z: b.z, w: tw + 0.16, d: 0.22, yaw: b.yaw, y0: 2.31, y1: 2.945 });
  }

  // the bar: counter runs (the marble top overhangs the front, the armrest further), the foot
  // rail, the returns closing the bartenders' side, the back bar, the pendants over the counter
  const bar = plan.bar;
  const onCounter = plan.vpMode === 'bartop' ? bar.vp : undefined;
  bar.segments.forEach(([z0, z1], i) => {
    box(`bar-counter-${i + 1}`, 'bar', bar.front - 0.145, bar.front + bar.depth + 0.04, z0 - 0.03, z1 + 0.03, 0, BAR_TOP + 0.065, { holds: onCounter, floor: true });
    box(`bar-rail-${i + 1}`, 'bar', bar.front - 0.262, bar.front, z0, z1, 0.17, 0.23, { holds: onCounter });
  });
  for (const [k, z] of [bar.z0, bar.z1].entries()) box(`bar-return-${k + 1}`, 'bar', bar.front + bar.depth, bar.back, z - 0.1, z + 0.1, 0, BAR_TOP);
  box('back-bar', 'bar', bar.back, plan.room.x1, bar.z0 + 0.15, bar.z1 - 0.15, 0, CEILING, { wall: true });
  bar.pendants.forEach((z, i) => round(`bar-pendant-${i + 1}`, 'bar', bar.front + bar.depth / 2 - 0.1, z, 0.21, 2.15, CEILING));
  bar.stools.forEach((z, i) => round(`stool-${i + 1}`, `stool-${i + 1}`, bar.stoolX, z, STOOL.r, 0, STOOL.h, { floor: true }));

  // the cashier's cage: counter, bars, fascia and its side wall, wall to wall in the corner
  {
    const c = plan.cashier.counter;
    box('cashier-cage', 'cashier', c.x0, c.x1 + 0.22, plan.room.z0, c.z1 + 0.06, 0, CEILING, { wall: true, floor: true });
  }

  // the pit podium, with its lamp
  box('podium', 'podium', plan.podium.x - PODIUM.w / 2, plan.podium.x + PODIUM.w / 2, plan.podium.z - PODIUM.d / 2, plan.podium.z + PODIUM.d / 2, 0, PODIUM.h, { floor: true });

  // the lounge: couches facing each other across a coffee table, a floor lamp at each end
  plan.loungeGroups.forEach((gp, i) => {
    const g = `lounge-${i + 1}`;
    for (const [k, s] of [-1, 1].entries()) {
      box(`${g}-couch-${k + 1}`, g, gp.x - COUCH.w / 2, gp.x + COUCH.w / 2, gp.z + s * 1.25 - COUCH.d / 2, gp.z + s * 1.25 + COUCH.d / 2, 0, COUCH.h, { floor: true });
      round(`${g}-lamp-${k + 1}`, `${g}-lamp-${k + 1}`, gp.x - s * loungeLampX(), gp.z + s * 1.25, FLOOR_LAMP.r, 0, FLOOR_LAMP.h, { floor: true });
    }
    box(`${g}-table`, g, gp.x - COFFEE_TABLE.w / 2, gp.x + COFFEE_TABLE.w / 2, gp.z - COFFEE_TABLE.d / 2, gp.z + COFFEE_TABLE.d / 2, 0, COFFEE_TABLE.h, { floor: true });
  });

  // hanging signs: the box with its brass trims
  for (const h of plan.hanging) {
    out.push({ id: `sign-${h.id}`, group: `sign-${h.id}`, x: h.x, z: h.z, w: h.w + 0.2, d: 0.17, yaw: h.ry, y0: h.y - h.h / 2 - 0.08, y1: h.y + h.h / 2 + 0.08 });
  }
  return out;
}

/** How far from the lounge's centre line its floor lamps stand: clear of the couch's arm. */
function loungeLampX(): number {
  return COUCH.w / 2 + FLOOR_LAMP.r + 0.1;
}
export const LOUNGE_LAMP_X = loungeLampX();

function palmSolids(p: Palm, i: number): Solid[] {
  const g = `palm-${i + 1}`;
  const r = LEAVES.palm.r * p.size;
  return [
    { id: `${g}-planter`, group: g, x: p.x, z: p.z, w: 2 * planterRadius('palm', p.size), d: 2 * planterRadius('palm', p.size), yaw: 0, y0: 0, y1: PALM_PLANTER.h, round: true, floor: true },
    { id: `${g}-trunk`, group: g, x: p.x, z: p.z, w: 2 * PALM_TRUNK * p.size, d: 2 * PALM_TRUNK * p.size, yaw: 0, y0: PALM_PLANTER.seat, y1: PALM_PLANTER.seat + p.size, round: true },
    { id: `${g}-fronds`, group: g, x: p.x, z: p.z, w: 2 * r, d: 2 * r, yaw: 0, y0: PALM_PLANTER.seat + LEAVES.palm.from * p.size, y1: PALM_PLANTER.seat + p.size, round: true },
  ];
}

/**
 * A palm either side of the doors, as big as fits: under the ceiling, the fronds clear of the
 * door frame, the front wall and the players at the nearest slot machines.
 */
function placePalms(plan: FloorPlan): void {
  const R = plan.room;
  for (const size of [2.6, 2.4, 2.2, 2.0, 1.8]) {
    if (PALM_PLANTER.seat + size > CEILING - 0.15) continue;
    const r = LEAVES.palm.r * size;
    const x = plan.door.x1 + 0.2 + r;
    const z = R.z1 - TRIM - 0.02 - r;
    const palms: Palm[] = [
      { x: -x, z, size },
      { x, z, size },
    ];
    const parts = palms.flatMap((p, i) => palmSolids(p, i));
    if (parts.every((s) => clashes(plan, s, plan.solids).length === 0)) {
      plan.palms = palms;
      plan.solids.push(...parts);
      return;
    }
  }
}

function plantSolids(p: Plant, i: number): Solid[] {
  const g = `plant-${i + 1}`;
  const leaves = LEAVES[p.kind];
  return [
    { id: `${g}-planter`, group: g, x: p.x, z: p.z, w: 2 * planterRadius(p.kind, p.size), d: 2 * planterRadius(p.kind, p.size), yaw: 0, y0: 0, y1: PLANTER.h, round: true, floor: true },
    { id: `${g}-leaves`, group: g, x: p.x, z: p.z, w: 2 * leaves.r * p.size, d: 2 * leaves.r * p.size, yaw: 0, y0: PLANTER.seat + leaves.from * p.size, y1: PLANTER.seat + p.size, round: true },
  ];
}

/**
 * Plants for the corners and ends that want one. Each spot says where the plant stands for a
 * given leaf spread (so it can hug a wall); the plant is the largest of a few sizes whose leaves
 * clear the walls, the stations, their players and every solid, or the spot is left bare.
 */
function placePlants(plan: FloorPlan): void {
  const R = plan.room;
  const bar = plan.bar;
  const wheel = plan.stations.find((s) => s.zone === 'feature');
  const inset = (r: number) => r + TRIM + 0.02;
  type Spot = { kind: PlantKind; at: (r: number) => [number, number] };
  const spots: Spot[] = [
    // the west wall beside the Big Six: north of it (toward the cashier's queue), or south
    ...(wheel
      ? ([
          { kind: 'plant-b', at: (r) => [R.x0 + inset(r), wheel.z - wheel.fp.width / 2 - r - 0.08] },
          { kind: 'plant-b', at: (r) => [R.x0 + inset(r), wheel.z + wheel.fp.width / 2 + r + 0.08] },
        ] as Spot[])
      : []),
    // beside the cashier's cage, in the north-west corner of the pit's aisle
    { kind: 'plant-a', at: (r) => [plan.cashier.counter.x1 + 0.22 + r + 0.06, R.z0 + inset(r)] },
    // the poker room's north-west corner
    { kind: 'plant-b', at: (r) => [plan.pokerRoom.x0 + 0.7, R.z0 + inset(r)] },
    // the east wall north of the bar
    { kind: 'plant-a', at: (r) => [R.x1 - inset(r), bar.z0 - 0.1 - r - 0.06] },
    // the south end of the bar
    { kind: 'plant-b', at: (r) => [bar.front - 0.145 - r - 0.06, R.z1 - inset(r)] },
    // the south-west corner of the slot floor
    { kind: 'plant-a', at: (r) => [R.x0 + inset(r), R.z1 - inset(r)] },
    // either side of the vestibule, by the front wall
    { kind: 'plant-b', at: (r) => [-5.3, R.z1 - inset(r)] },
    { kind: 'plant-b', at: (r) => [5.3, R.z1 - inset(r)] },
    // the lounge's far corner
    { kind: 'plant-a', at: (r) => [plan.lounge.x1 - 0.6, R.z1 - inset(r)] },
  ];
  for (const spot of spots) {
    for (const size of [1.1, 0.95, 0.8]) {
      const r = LEAVES[spot.kind].r * size;
      const [x, z] = spot.at(r);
      const p: Plant = { kind: spot.kind, x, z, size };
      const parts = plantSolids(p, plan.plants.length);
      if (parts.every((s) => clashes(plan, s, plan.solids).length === 0)) {
        plan.plants.push(p);
        plan.solids.push(...parts);
        break;
      }
    }
  }
}

// --- geometry ------------------------------------------------------------------------------------

type Poly = [number, number][];
type Shape = { poly: Poly } | { x: number; z: number; r: number };

function corners(x: number, z: number, w: number, d: number, yaw: number): Poly {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ].map(([lx, lz]) => [x + lx! * c + lz! * s, z - lx! * s + lz! * c] as [number, number]);
}

/** Separating-axis test for two convex quads. */
function overlaps(a: Poly, b: Poly): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const ax = -(q[1] - p[1]);
      const az = q[0] - p[0];
      const proj = (pts: Poly) => pts.map(([x, z]) => x * ax + z * az);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

/** Distance from a point to a convex quad (0 inside). */
function pointToPoly(x: number, z: number, poly: Poly): number {
  let inside = true;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [px, pz] = poly[i]!;
    const [qx, qz] = poly[(i + 1) % poly.length]!;
    const ex = qx - px;
    const ez = qz - pz;
    // the quads are wound the same way throughout, so one side of every edge is inside
    if (ex * (z - pz) - ez * (x - px) < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((x - px) * ex + (z - pz) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(px + ex * t - x, pz + ez * t - z));
  }
  return inside ? 0 : best;
}

function shapeOf(s: Solid): Shape {
  return s.round ? { x: s.x, z: s.z, r: s.w / 2 } : { poly: corners(s.x, s.z, s.w, s.d, s.yaw) };
}

function shapesOverlap(a: Shape, b: Shape): boolean {
  if ('poly' in a && 'poly' in b) return overlaps(a.poly, b.poly);
  if ('r' in a && 'r' in b) return Math.hypot(a.x - b.x, a.z - b.z) < a.r + b.r - 1e-6;
  const c = ('r' in a ? a : b) as { x: number; z: number; r: number };
  const p = ('poly' in a ? a : b) as { poly: Poly };
  return pointToPoly(c.x, c.z, p.poly) < c.r - 1e-6;
}

/** The solid's extent on the floor, as [x0, x1, z0, z1]. */
function extent(s: Solid): [number, number, number, number] {
  if (s.round) return [s.x - s.w / 2, s.x + s.w / 2, s.z - s.w / 2, s.z + s.w / 2];
  const p = corners(s.x, s.z, s.w, s.d, s.yaw);
  const xs = p.map((q) => q[0]);
  const zs = p.map((q) => q[1]);
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
}

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
}

function rectPoly(r: Rect): Poly {
  return [
    [r.x0, r.z0],
    [r.x1, r.z0],
    [r.x1, r.z1],
    [r.x0, r.z1],
  ];
}

/** The ceiling over a solid: the pit's coffers only when it is wholly inside the pit, clear of the cove's lip. */
function ceilingOver(plan: FloorPlan, s: Solid): number {
  const [x0, x1, z0, z1] = extent(s);
  const p = plan.pit;
  const lip = 0.45;
  return x0 >= p.x0 + lip && x1 <= p.x1 - lip && z0 >= p.z0 + lip && z1 <= p.z1 - lip ? PIT_CEILING : CEILING;
}

/** A station's standing room: a strip along its player side (tables, and machines on the floor). */
function playerStrip(p: Placement): Poly | null {
  if (p.zone === 'bar') return null;
  const off = p.fp.depth / 2 + 0.45;
  return corners(p.x + Math.sin(p.yaw) * off, p.z + Math.cos(p.yaw) * off, p.fp.width * 0.8, 0.7, p.yaw);
}

/** What `s` passes through, as readable strings: walls, the ceiling, stations, their players, aisles, other solids. */
function clashes(plan: FloorPlan, s: Solid, others: Solid[]): string[] {
  const out: string[] = [];
  const R = plan.room;
  const [x0, x1, z0, z1] = extent(s);
  const margin = s.wall ? -0.001 : TRIM;
  if (x0 < R.x0 + margin || x1 > R.x1 - margin || z0 < R.z0 + margin || z1 > R.z1 - margin) out.push(`${s.id} pokes through a wall`);
  if (s.y1 > ceilingOver(plan, s) + 0.001) out.push(`${s.id} pokes through the ceiling`);
  const shape = shapeOf(s);
  for (const p of plan.stations) {
    if (s.holds?.includes(p.id)) continue;
    const box = corners(p.x, p.z, p.fp.width, p.fp.depth, p.yaw);
    if (s.y0 < STATION_H[p.zone] && shapesOverlap(shape, { poly: box })) out.push(`${s.id} clips ${p.id}`);
    const strip = playerStrip(p);
    // anything at body height in front of a station is in its players' way
    if (strip && s.y0 < 1.8 && !s.holds?.length && shapesOverlap(shape, { poly: strip })) out.push(`${s.id} blocks the players of ${p.id}`);
  }
  if (s.floor) for (const [k, aisle] of plan.aisles.entries()) if (shapesOverlap(shape, { poly: rectPoly(aisle) })) out.push(`${s.id} stands in aisle ${k}`);
  for (const o of others) {
    if (o === s || o.group === s.group) continue;
    if (s.y0 >= o.y1 || o.y0 >= s.y1) continue;
    if (shapesOverlap(shape, shapeOf(o))) out.push(`${s.id} clips ${o.id}`);
  }
  return out;
}

/**
 * Problems with a plan, as readable strings (empty when it's sound): stations overlapping each
 * other, the walls or an aisle, players' standing room blocked, and any solid (furniture, plants,
 * signs, the bar, columns) passing through another, a station, a wall or a ceiling.
 */
export function checkLayout(plan: FloorPlan): string[] {
  const out: string[] = [];
  const PAD = 0.05;
  const boxes = plan.stations.map((s) => ({ s, poly: corners(s.x, s.z, s.fp.width + PAD, s.fp.depth + PAD, s.yaw) }));
  const inner: Rect = { x0: plan.room.x0 + WALL, z0: plan.room.z0 + WALL, x1: plan.room.x1 - WALL, z1: plan.room.z1 - WALL };
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    for (const [x, z] of a.poly) if (!inRect(inner, x, z, 0.01)) out.push(`${a.s.id} pokes through a wall`);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      if (overlaps(a.poly, b.poly)) out.push(`${a.s.id} overlaps ${b.s.id}`);
    }
    for (const [k, aisle] of plan.aisles.entries()) if (overlaps(a.poly, rectPoly(aisle))) out.push(`${a.s.id} stands in aisle ${k}`);
    const front = playerStrip(a.s);
    if (front) {
      for (const b of boxes) if (b !== a && overlaps(front, b.poly)) out.push(`${b.s.id} blocks the players of ${a.s.id}`);
      for (const [x, z] of front) if (!inRect(inner, x, z, 0.01)) out.push(`${a.s.id} has its players against a wall`);
    }
  }
  // every solid against everything else (each pair once)
  plan.solids.forEach((s, i) => out.push(...clashes(plan, s, plan.solids.slice(i + 1))));
  return [...new Set(out)];
}
