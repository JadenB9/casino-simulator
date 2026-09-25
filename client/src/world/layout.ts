// The floor plan. rooms.ts says what the casino is (its rooms, doors and what stands in each, in
// room-local terms); this file places all of it in world space: stations from each game module's
// footprint (rows and islands re-flow round the real sizes), the chairs at every table seat, the
// fixtures and furniture, the walls with their doorways, the aisles kept clear, and the plants and
// palms fitted into whatever corners are left. Every solid thing is also listed as a Solid (its
// footprint and height), and checkLayout() checks that nothing passes through anything else, a
// wall or a ceiling, and that no door is too narrow. reach.ts walks the result.
//
// Coordinates: metres, +x east, +z south (toward the entrance), y up. Station yaw follows
// Object3D.rotation.y; a station's player side is its local +z, so yaw 0 faces the players south.

import type { GameId } from '../../../shared/src/engine.ts';
import { CATALOG } from '../../../shared/src/games/catalog.ts';
import { DOORS, LINTEL, ROOMS, type DoorKind, type DoorSpec, type FixtureItem, type FurnitureItem, type FurnitureKind, type HangItem, type RoomId, type RoomSpec, type RoomStyle, type SpotItem } from './rooms.ts';
import { BAR_STOOL, CHAIRS, FURNITURE, SEATING, type ChairKind } from './furniture-spec.ts';

export type { RoomId } from './rooms.ts';

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

/** What kind of station: a table in the pit (or the salon), poker, a machine, the wheels, a desk. */
/** Pachinko machines stand in the parlour's islands; bingo's hall is one station with its stage. */
export type Zone = 'pit' | 'slots' | 'bar' | 'poker' | 'cashier' | 'feature' | 'online' | 'wheel' | 'parlour' | 'hall';

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
  room: RoomId;
  /** A high-limit table: it opens at the higher limits by default. */
  tier?: 'high';
}

/** A seat as a game module lists it (GameClientModule.seats). */
export interface SeatSpot {
  position: [number, number, number];
  yaw: number;
}

/** A chair or stool at a table's seat. */
export interface ChairPlace {
  station: string;
  slot: number;
  room: RoomId;
  kind: ChairKind;
  x: number;
  z: number;
  /** The way its sitter faces (toward the table). */
  yaw: number;
  top: number;
}

/** A piece of loose furniture in world space. */
export interface PlacedFurniture {
  kind: FurnitureKind;
  room: RoomId;
  x: number;
  z: number;
  yaw: number;
  /** Its number among the room's pieces of this kind (1-based), for stable seat ids. */
  n: number;
  wears?: FurnitureItem['wears'];
  size?: number;
}

export interface Bank {
  variant: string;
  /** Centre and long axis of the island; machines face out on both sides. */
  x: number;
  z: number;
  /** 0: long axis along x (machines face north and south); PI/2: along z (machines face east and west). */
  yaw: number;
  length: number;
  depth: number;
  ids: string[];
}

/** An island of machines back to back (the pachinko parlour's): its middle, its long axis's turn, its size. */
export interface MachineIsland {
  game: GameId;
  x: number;
  z: number;
  /** 0: the long axis along x; PI/2: along z. */
  yaw: number;
  /** The machines' run along the island, and across it (both rows and the spine). */
  length: number;
  depth: number;
  ids: string[];
  room: RoomId;
  /** Its number on the floor, for its end caps. */
  n: number;
}

/** A counter along a wall (the parlour's prizes, the bingo hall's snack bar): the counter's rect, the wall behind it. */
export interface WallCounter {
  kind: 'prizes' | 'snack';
  counter: Rect;
  /** The wall face the shelves stand against, and which way that is from the counter (+1 east or south, -1 west or north). */
  wall: number;
  axis: 'x' | 'z';
  side: 1 | -1;
  room: RoomId;
}

/** Something flat set on a wall face: its middle on the face, its turn (facing into the room) and width. */
export interface WallMount {
  x: number;
  z: number;
  ry: number;
  w: number;
  room: RoomId;
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
  room: RoomId;
}

export interface Palm {
  x: number;
  z: number;
  size: number;
  room: RoomId;
}

/** A sign box hung from the ceiling on two rods: centre, turn and the face's size, and what it says. */
export interface Hanging {
  id: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  w: number;
  h: number;
  room: RoomId;
  kind?: HangItem['kind'];
  text?: string;
  color?: string;
  front?: HangItem['front'];
  back?: HangItem['back'];
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
  /**
   * How near a walker's centre may come to its centre, when that isn't its drawn size: walkers
   * brush through a plant's leaf tips, and keep a palm's arc of fronds clear (the collider is given
   * the same). Round solids only.
   */
  walk?: number;
  /** The station a table's chair belongs to: it may stand in that station's footprint and players' room. */
  of?: string;
  room?: RoomId;
}

/** Bar-top video poker sits on the counter; a taller cabinet stands on the floor in a gap in the bar. */
export type VpMode = 'bartop' | 'floor';

export interface PlannedRoom {
  id: RoomId;
  name: string;
  sign: string;
  about: string;
  /** Its walls' centre lines, and the faces of its walls (what you can stand inside). */
  bounds: Rect;
  inner: Rect;
  cx: number;
  cz: number;
  style: RoomStyle;
  /** The spots that light it on High (world space). */
  spots: SpotItem[];
  /** Its own walkways (world space), drawn as runners. */
  runners: Rect[];
}

export interface PlannedDoor {
  id: string;
  a: RoomId;
  b: RoomId | 'outside';
  kind: DoorKind;
  /** The wall it's in: 'x' runs east-west at z = c, 'z' runs north-south at x = c. */
  axis: 'x' | 'z';
  c: number;
  /** Its span along the wall, and its height. */
  a0: number;
  a1: number;
  height: number;
  /** The walkable way through the wall. */
  rect: Rect;
}

/**
 * A stretch of wall between two rooms (or a room and the street), from y0 up to the taller room's
 * ceiling. Over a door it's the lintel (y0 is the door's height); under a shop window, the sill.
 */
export interface WallPiece {
  axis: 'x' | 'z';
  c: number;
  a0: number;
  a1: number;
  /** The room on its north (or west) side and on its south (or east) side; null for the street. */
  neg: RoomId | null;
  pos: RoomId | null;
  y0: number;
  y1: number;
}

/** A shop window: glass in a wall between y0 and y1. */
export interface Window {
  axis: 'x' | 'z';
  c: number;
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  neg: RoomId;
  pos: RoomId;
}

export interface FloorPlan {
  /** The whole building's walls' faces (its bounds). */
  room: Rect;
  rooms: PlannedRoom[];
  doors: PlannedDoor[];
  wallPieces: WallPiece[];
  windows: Window[];
  /** Walls (and shop windows) as boxes on the floor, for reach.ts. */
  walls: Rect[];
  /** The walkable ways through walls. */
  doorways: Rect[];
  stations: Placement[];
  chairs: ChairPlace[];
  furniture: PlacedFurniture[];
  /** The pit's coffered ceiling (6.6 m) over its two rows of tables. */
  pit: Rect;
  /** The dealers' side between the two rows, with the pit podium. */
  staff: Rect;
  podium: { x: number; z: number };
  /** Walkways kept clear of anything standing on the floor. The first is the pit's cross aisle. */
  aisles: Rect[];
  /** The lobby's floor inside the entrance, and the entrance itself. */
  entrance: Rect;
  door: { x0: number; x1: number; height: number; z: number };
  pokerRoom: Rect;
  slotsZone: Rect;
  /** Where the Big Six stands against the pit's wall, with its players' room. */
  feature: Rect;
  barZone: Rect;
  banks: Bank[];
  bar: {
    /** Customer face of the counter (x), and its run along z. */
    front: number;
    depth: number;
    z0: number;
    z1: number;
    /** The back bar, and the wall face it stands against. */
    back: number;
    wall: number;
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
    /** Where a player stands at the middle window, and which way they face (yaw of a character looking at the counter). */
    x: number;
    z: number;
    face: number;
    /** Every teller window's x. */
    windows: number[];
  };
  boutique: { counter: Rect; wall: number; keeper: { x: number; z: number; yaw: number }; customer: { x: number; z: number; yaw: number } } | null;
  lounge: Rect;
  /** Couch groups round a coffee table (the table's centre). */
  loungeGroups: { x: number; z: number; room: RoomId }[];
  fireplaces: { x: number; z: number; room: RoomId }[];
  vaults: { x: number; z: number; room: RoomId }[];
  /** Neon signs fixed to walls. */
  neons: { text: string; color: string; font: 'Tilt Neon' | 'Limelight' | 'Cinzel'; x: number; y: number; z: number; ry: number; w: number; h: number; room: RoomId }[];
  /** Lamps hanging low over the poker tables. */
  tableLamps: { x: number; z: number; yaw: number; room: RoomId }[];
  /** The online lounge's islands of desks (their middle, their length, the games along them). */
  deskIslands: { x: number; z: number; w: number; room: RoomId; games: GameId[] }[];
  /** Strings of bulbs (the yard's). */
  festoons: { x0: number; z0: number; x1: number; z1: number; y: number; room: RoomId }[];
  /** Islands of machines back to back (the pachinko parlour's). */
  machineIslands: MachineIsland[];
  /** Counters along a wall with shelves behind: the prize counter, the snack bar. */
  counters: WallCounter[];
  /** Paper lanterns on cords: each lantern's middle and its colour; the cord's ends. */
  lanterns: { x: number; z: number; y: number; color: string; room: RoomId }[];
  cords: { x0: number; z0: number; x1: number; z1: number; y: number; room: RoomId }[];
  /** A big lantern low over each table in the rooms that ask for them. */
  tableLanterns: { x: number; z: number; room: RoomId }[];
  /** Moon gates, lattice screens and pattern boards on the walls. */
  moongates: WallMount[];
  lattices: WallMount[];
  patternBoards: WallMount[];
  /** Stage drapes: `w` is the stage's width between the two curtains. */
  drapes: WallMount[];
  /**
   * Where statues on plinths may stand (the lobby's, for the shop's statues): world x, z and the
   * way each faces, best first. checkLayout keeps a plinth's floor and a walk round it clear.
   */
  statues: { x: number; z: number; yaw: number; room: RoomId }[];
  columns: (Column & { room: RoomId })[];
  plants: Plant[];
  palms: Palm[];
  hanging: Hanging[];
  /** Everything solid besides the stations: see Solid. */
  solids: Solid[];
  /** Where the win meter hangs over the slots hall's main aisle. */
  tallyAt: { x: number; z: number };
  /** Where the floor's reflections are captured from (High). */
  capture: { x: number; y: number; z: number };
}

/** The usual low ceiling (slots, the bank, the pit round its coffers). Rooms say their own. */
export const CEILING = 3.4;
/** The grand coffered ceiling over the table pit. */
export const PIT_CEILING = 6.6;
export const WALL = 0.3;
/** How far the wainscot, chair rail and crown stand proud of a wall's face. */
export const TRIM = 0.08;
/** The whole building, as the walls' outer faces (x east, z south). */
export const ROOM: Rect = bounds(ROOMS);
/** Where a player first appears: inside the doors on the marble, facing into the casino (-z). */
export const SPAWN = { x: 0, z: 12.8, yaw: Math.PI };

function bounds(rooms: RoomSpec[]): Rect {
  return {
    x0: Math.min(...rooms.map((r) => r.x0)) - WALL / 2,
    z0: Math.min(...rooms.map((r) => r.z0)) - WALL / 2,
    x1: Math.max(...rooms.map((r) => r.x1)) + WALL / 2,
    z1: Math.max(...rooms.map((r) => r.z1)) + WALL / 2,
  };
}

// The loose props' shapes at their placed sizes, measured from the models (world3.mjs audits them).
/** Planters: the least radius, the height of the pot and the height the plant stands at. */
export const PLANTER = { r: 0.32, h: 0.46, seat: 0.42 };
export const PALM_PLANTER = { r: 0.5, h: 0.62, seat: 0.55 };
/**
 * Per metre of plant, measured from the middle of its foot (props.ts stands each on it): the
 * model's own pot or root ball there (the planter is made wider than that), the leaves' spread,
 * and where the leaves start as a fraction of its height.
 */
export const LEAVES: Record<PlantKind | 'palm', { base: number; r: number; from: number }> = {
  'plant-a': { base: 0.26, r: 0.71, from: 0.03 },
  'plant-b': { base: 0.15, r: 0.77, from: 0.05 },
  palm: { base: 0.09, r: 0.64, from: 0.39 },
};
/** How far a palm's trunk reaches from the middle of its foot, per metre (it wanders a little). */
const PALM_TRUNK = 0.12;
/** Walkers keep this far from a palm's centre (under the low fronds). */
export const PALM_WALK = 1.0;
/** How near a walker comes to a plant's centre: through the leaf tips, never the pot. */
export function plantWalk(kind: PlantKind, size: number): number {
  return Math.max(planterRadius(kind, size), LEAVES[kind].r * size - 0.25);
}

/** The planter a plant stands in: wide enough for the model's own pot to sit inside it. */
export function planterRadius(kind: PlantKind | 'palm', size: number): number {
  return Math.max(kind === 'palm' ? PALM_PLANTER.r : PLANTER.r, LEAVES[kind].base * size + 0.04);
}
export const STOOL = BAR_STOOL;
export const COUCH = { w: FURNITURE.sofa.w, d: FURNITURE.sofa.d, h: FURNITURE.sofa.h };
export const FLOOR_LAMP = { r: 0.42, h: 1.45 };
export const COFFEE_TABLE = { w: 1.3, d: 0.7, h: 0.44 };
export const PODIUM = { w: 1.4, d: 0.64, h: 1.49 };
/** The bar counter's height (the video poker bar-top units stand on it). */
export const BAR_TOP = 1.08;
/** The Jade Room's moon gate: the round opening's radius and its middle's height. */
export const MOONGATE = { r: 1.15, y: 1.62 };
/** A bingo pattern board: its face, its middle's height. */
export const PATTERN_BOARD = { w: 1.08, h: 1.3, y: 1.72 };
/** A paper lantern: its radius (the tall ones are a little taller than wide) and height. */
export const LANTERN = { r: 0.2, h: 0.46 };
/** The big lanterns over the Jade Room's tables. */
export const TABLE_LANTERN = { r: 0.36, h: 0.62, y: 2.35 };
/** A statue's plinth (square), and the clear floor kept round it. */
export const STATUE_PLINTH = 1.12;
export const STATUE_CLEAR = 0.55;
/** Stage drapes: each curtain's width, how far it stands off the wall, and the pelmet across the top. */
export const DRAPES = { w: 2.0, d: 0.2, pelmet: 0.36 };
/** A counter along a wall (the prizes, the snack bar): its height, and the shelves' depth and height behind it. */
export const WALL_COUNTER = { h: 1.02, shelf: 0.42, back: 2.3 };

/** Room for a dealer standing beside a station (npcs.ts's bodies are 0.28 m posts). */
const DEALER_ROOM = 0.7;

/** How tall each kind of station stands, for checking what hangs or leans over it. */
export const STATION_H: Record<Zone, number> = { pit: 1.45, poker: 1.45, slots: 2.45, bar: 1.8, feature: 3.05, cashier: 1.2, online: 1.4, wheel: 3.3, parlour: 2.1, hall: 3.4 };

/** Standing or seated players in front of a table or machine. */
const PLAYER_ZONE = 0.95;
/** The dealers' side between the pit's two rows. */
const STAFF_DEPTH = 2.6;

/** Every slots variant in the catalogue. */
export function slotVariants(): string[] {
  return CATALOG.slots.variants.map((v) => v.id);
}
/** The slot hall's islands: every variant twice, in catalogue order. */
export function slotIslands(): string[] {
  const v = slotVariants();
  return [...v, ...v];
}
const PER_SIDE = 2;
/** The gap between the backs of an island's two rows of machines, where its spine stands. */
export const MACHINE_SPINE = 0.12;
/** How far an island's end caps stand out past its machines, and how tall an island's crown stands. */
export const ISLAND_CAP = 0.2;
export const ISLAND_TOP = 2.36;
const VP_COUNT_DEFAULT = 4;

function zoneOf(game: GameId): Zone {
  if (game === 'slots') return 'slots';
  if (game === 'videopoker') return 'bar';
  if (game === 'holdem') return 'poker';
  if (game === 'bigsix') return 'feature';
  if (game === 'banditwheel') return 'wheel';
  if (game === 'pachinko') return 'parlour';
  if (game === 'bingo') return 'hall';
  if (CATALOG[game]?.online) return 'online';
  return 'pit';
}

export interface PlanOptions {
  vpMode?: VpMode;
  /** Each game module's seats; with them every table gets its chairs (GAMES[g].seats). */
  seats?: (game: GameId, variant: string) => SeatSpot[];
}

/**
 * The floor plan from the rooms' data. `footprint` is each game module's; `slots` is the list of
 * slot islands (one variant each, in order), defaulting to every variant twice.
 */
export function planFloor(footprint: (game: GameId) => Footprint, slots: readonly string[] = slotIslands(), opts: PlanOptions = {}): FloorPlan {
  const fp = (g: GameId) => {
    const f = footprint(g);
    return { width: Math.max(0.4, f.width), depth: Math.max(0.4, f.depth) };
  };
  const seatsOf = opts.seats;

  // --- rooms, walls and doors ----------------------------------------------------------------
  const rooms: PlannedRoom[] = ROOMS.map((r) => {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    return {
      id: r.id,
      name: r.name,
      sign: r.sign,
      about: r.about ?? '',
      bounds: { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 },
      inner: { x0: r.x0 + WALL / 2, z0: r.z0 + WALL / 2, x1: r.x1 - WALL / 2, z1: r.z1 - WALL / 2 },
      cx,
      cz,
      style: r.style,
      spots: r.spots.map((s) => ({ ...s, x: s.x + cx, z: s.z + cz, tx: s.tx + cx, tz: s.tz + cz })),
      runners: r.aisles.map((a) => ({ x0: a.x0 + cx, z0: a.z0 + cz, x1: a.x1 + cx, z1: a.z1 + cz })),
    };
  });
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const room = (id: RoomId) => byId.get(id)!;
  const doors = DOORS.map((d) => planDoor(d, room));
  const windows = shopWindows(doors, room);
  const wallPieces = planWalls(rooms, doors, windows);

  // --- stations --------------------------------------------------------------------------------
  const stations: Placement[] = [];
  const chairs: ChairPlace[] = [];
  const banks: Bank[] = [];
  const add = (p: Omit<Placement, 'zone' | 'fp'>) => {
    const placed: Placement = { ...p, zone: zoneOf(p.game), fp: fp(p.game) };
    stations.push(placed);
    if (seatsOf) chairs.push(...chairsFor(placed, seatsOf(p.game, p.variant)));
  };
  // how far a station and its chairs reach along world x and z from its centre
  const reach = (game: GameId, variant: string, yaw: number, tier?: 'high') => {
    const f = fp(game);
    const pts: [number, number, number][] = [
      [-f.width / 2, -f.depth / 2, 0],
      [f.width / 2, -f.depth / 2, 0],
      [f.width / 2, f.depth / 2, 0],
      [-f.width / 2, f.depth / 2, 0],
    ];
    const seating = SEATING[game];
    if (seatsOf && seating) {
      const kind = tier === 'high' && seating.high ? seating.high.kind : seating.kind;
      const r = Math.max(CHAIRS[kind].w, CHAIRS[kind].d) / 2 + 0.04;
      for (const s of seatsOf(game, variant)) pts.push([s.position[0], s.position[2], r]);
    }
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    let x0 = 0;
    let x1 = 0;
    let z0 = 0;
    let z1 = 0;
    for (const [lx, lz, r] of pts) {
      const wx = lx * c + lz * sn;
      const wz = -lx * sn + lz * c;
      x0 = Math.min(x0, wx - r);
      x1 = Math.max(x1, wx + r);
      z0 = Math.min(z0, wz - r);
      z1 = Math.max(z1, wz + r);
    }
    return { x0, x1, z0, z1 };
  };

  const rows: { room: RoomId; z: number; yaw: number; ids: string[]; x0: number; x1: number; depth: number; seatDepth: number }[] = [];
  const deskIslands: FloorPlan['deskIslands'] = [];
  const machineIslands: MachineIsland[] = [];
  let slotList = [...slots];
  for (const spec of ROOMS) {
    const r = room(spec.id);
    for (const item of spec.stations) {
      if (item.kind === 'station') {
        add({ id: item.id, game: item.game, variant: item.variant ?? '', x: r.cx + item.x, z: r.cz + item.z, yaw: item.yaw, room: r.id, tier: item.tier });
      } else if (item.kind === 'row') {
        const ext = item.items.map((w) => reach(w.game, w.variant ?? '', item.yaw, item.tier));
        const len = ext.reduce((s, e) => s + (e.x1 - e.x0), 0) + item.gap * (item.items.length - 1);
        let x = r.cx + item.x - len / 2;
        const ids: string[] = [];
        item.items.forEach((w, i) => {
          const e = ext[i]!;
          add({ id: w.id, game: w.game, variant: w.variant ?? '', x: x - e.x0, z: r.cz + item.z, yaw: item.yaw, room: r.id, tier: item.tier });
          ids.push(w.id);
          x += e.x1 - e.x0 + item.gap;
        });
        const depth = Math.max(...item.items.map((w) => fp(w.game).depth));
        // how far the chairs reach past the tables on the players' side
        const seatDepth = Math.max(0, ...ext.map((e, i) => (Math.cos(item.yaw) > 0 ? e.z1 : -e.z0) - fp(item.items[i]!.game).depth / 2));
        rows.push({ room: r.id, z: r.cz + item.z, yaw: item.yaw, ids, x0: r.cx + item.x - len / 2, x1: r.cx + item.x + len / 2, depth, seatDepth });
      } else if (item.kind === 'islands') {
        const sf = fp('slots');
        const pitch = sf.width + 0.06;
        const cells: [number, number][] = [];
        for (const rz of item.rows) for (const cx of item.cols) cells.push([r.cx + cx, r.cz + rz]);
        const counts = new Map<string, number>();
        slotList.slice(0, cells.length).forEach((variant, i) => {
          const [x, z] = cells[i]!;
          const ids: string[] = [];
          for (const side of [1, -1]) {
            for (let k = 0; k < PER_SIDE; k++) {
              const along = (k - (PER_SIDE - 1) / 2) * pitch * side;
              const off = side * (0.15 + sf.depth / 2);
              const n = (counts.get(variant) ?? 0) + 1;
              counts.set(variant, n);
              const id = `slots-${variant}-${n}`;
              ids.push(id);
              add({ id, game: 'slots', variant, x: x + along, z: z + off, yaw: side > 0 ? 0 : Math.PI, room: r.id });
            }
          }
          banks.push({ variant, x, z, yaw: 0, length: PER_SIDE * pitch, depth: 2 * sf.depth + 0.3, ids });
        });
        slotList = slotList.slice(cells.length);
      } else if (item.kind === 'machines') {
        const f = fp(item.game);
        const pitch = f.width;
        for (const isl of item.islands) {
          const X = r.cx + isl.x;
          const Z = r.cz + isl.z;
          const c = Math.cos(isl.yaw);
          const sn = Math.sin(isl.yaw);
          const ids: string[] = [];
          // one row on each side of the spine, machines side by side so their slices of island join up
          for (const side of [1, -1]) {
            for (let k = 0; k < item.per; k++) {
              const lx = (k - (item.per - 1) / 2) * pitch * side;
              const lz = side * (MACHINE_SPINE / 2 + f.depth / 2);
              const n = stations.filter((s) => s.game === item.game).length + 1;
              const id = `${CATALOG[item.game].prefix}-${n}`;
              ids.push(id);
              add({ id, game: item.game, variant: '', x: X + lx * c + lz * sn, z: Z - lx * sn + lz * c, yaw: isl.yaw + (side > 0 ? 0 : Math.PI), room: r.id });
            }
          }
          machineIslands.push({ game: item.game, x: X, z: Z, yaw: isl.yaw, length: item.per * pitch, depth: 2 * f.depth + MACHINE_SPINE, ids, room: r.id, n: machineIslands.length + 1 });
        }
      } else if (item.kind === 'desks') {
        const f = fp(item.games[0]!);
        let g = 0;
        item.islands.forEach((isl) => {
          deskIslands.push({ x: r.cx + isl.x, z: r.cz + isl.z, w: item.per * item.pitch, room: r.id, games: item.games.slice(g / 2, g / 2 + item.per) });
          for (const [rowYaw, dir] of [
            [Math.PI, -1],
            [0, 1],
          ] as const) {
            const z = r.cz + isl.z + dir * (f.depth / 2 + 0.03);
            for (let k = 0; k < item.per; k++) {
              const game = item.games[Math.floor(g / 2)];
              g++;
              if (!game) continue;
              const x = r.cx + isl.x + (k - (item.per - 1) / 2) * item.pitch;
              const n = stations.filter((s) => s.game === game).length + 1;
              add({ id: `${CATALOG[game].prefix}-${n}`, game, variant: '', x, z, yaw: rowYaw, room: r.id });
            }
          }
        });
      }
    }
  }

  // --- the pit: its two rows, the staff area between them, the coffers over them ------------------
  const pitRoom = room('pit');
  const north = rows.find((w) => w.room === 'pit' && Math.abs(w.yaw - Math.PI) < 0.01);
  const south = rows.find((w) => w.room === 'pit' && Math.abs(w.yaw) < 0.01);
  const zN = north?.z ?? pitRoom.cz - 5;
  const zS = south?.z ?? pitRoom.cz - 1;
  const dN = north?.depth ?? 1.6;
  const dS = south?.depth ?? 1.3;
  const staffHalf = Math.min(north ? (north.x1 - north.x0) / 2 : 5, south ? (south.x1 - south.x0) / 2 : 5);
  const staff: Rect = { x0: pitRoom.cx - staffHalf, x1: pitRoom.cx + staffHalf, z0: zN + dN / 2, z1: zS - dS / 2 };
  const podium = { x: (staff.x0 + staff.x1) / 2, z: (staff.z0 + staff.z1) / 2 };
  const half = Math.max(north ? (north.x1 - north.x0) / 2 : 5, south ? (south.x1 - south.x0) / 2 : 5);
  const pit: Rect = {
    x0: pitRoom.cx - half - 0.7,
    x1: pitRoom.cx + half + 0.7,
    z0: zN - dN / 2 - (north?.seatDepth ?? 0) - PLAYER_ZONE - 0.2,
    z1: zS + dS / 2 + (south?.seatDepth ?? 0) + 0.45,
  };

  // --- fixtures ----------------------------------------------------------------------------------
  let bar: FloorPlan['bar'] | null = null;
  let barZone: Rect = room('bar').inner;
  let cashier: FloorPlan['cashier'] | null = null;
  let boutique: FloorPlan['boutique'] = null;
  const loungeGroups: FloorPlan['loungeGroups'] = [];
  const fireplaces: FloorPlan['fireplaces'] = [];
  const vaults: FloorPlan['vaults'] = [];
  const neons: FloorPlan['neons'] = [];
  const tableLamps: FloorPlan['tableLamps'] = [];
  const festoons: FloorPlan['festoons'] = [];
  const counters: WallCounter[] = [];
  const lanterns: FloorPlan['lanterns'] = [];
  const cords: FloorPlan['cords'] = [];
  const tableLanterns: FloorPlan['tableLanterns'] = [];
  const moongates: WallMount[] = [];
  const lattices: WallMount[] = [];
  const patternBoards: WallMount[] = [];
  const drapes: WallMount[] = [];
  for (const spec of ROOMS) {
    const r = room(spec.id);
    for (const fx of spec.fixtures) fixture(fx, r);
  }
  function fixture(fx: FixtureItem, r: PlannedRoom): void {
    switch (fx.kind) {
      case 'bar': {
        // the counter along the room's east wall, the back bar against it, video poker in the north end
        const wall = r.inner.x1;
        const back = wall - 0.75;
        const front = back - 2.9;
        const z0 = r.cz + fx.z0;
        const z1 = r.cz + fx.z1;
        const vf = fp('videopoker');
        const vpPitch = Math.max(1.25, vf.width + 0.2);
        const vp: string[] = [];
        for (let i = 0; i < (fx.vp ?? VP_COUNT_DEFAULT); i++) {
          const id = `vp-${i + 1}`;
          vp.push(id);
          add({ id, game: 'videopoker', variant: '', x: front + vf.depth / 2 - 0.05, z: z0 + 0.9 + vpPitch / 2 + i * vpPitch, yaw: -Math.PI / 2, room: r.id });
        }
        const pendants: number[] = [];
        for (let z = z0 + 0.9; z < z1 - 0.5; z += 1.9) pendants.push(z);
        // stools stand far enough out that their legs clear the foot rail
        bar = { front, depth: 0.78, z0, z1, back, wall, segments: [], stoolX: front - 0.52, stools: [], vp, pendants };
        barZone = r.inner;
        break;
      }
      case 'cage': {
        const counter: Rect = { x0: r.inner.x0, x1: r.inner.x1, z0: r.inner.z0, z1: r.inner.z0 + fx.depth };
        const windows = fx.windows.map((x) => r.cx + x);
        const mid = windows[Math.floor(windows.length / 2)] ?? r.cx;
        cashier = { counter, x: mid, z: counter.z1 + 0.6, face: Math.PI, windows };
        break;
      }
      case 'counter': {
        const counter: Rect = { x0: r.cx + fx.x0, x1: r.cx + fx.x1, z0: r.cz + fx.z0, z1: r.cz + fx.z1 };
        const mz = (counter.z0 + counter.z1) / 2;
        const wall = r.inner.x1;
        boutique = { counter, wall, keeper: { x: (counter.x1 + wall) / 2 + 0.1, z: mz, yaw: -Math.PI / 2 }, customer: { x: counter.x0 - 0.6, z: mz, yaw: Math.PI / 2 } };
        break;
      }
      case 'sofas':
        loungeGroups.push({ x: r.cx + fx.x, z: r.cz + fx.z, room: r.id });
        break;
      case 'fireplace':
        fireplaces.push({ x: r.inner.x1, z: r.cz + fx.z, room: r.id });
        break;
      case 'vault':
        vaults.push({ x: r.cx + fx.x, z: r.inner.z0, room: r.id });
        break;
      case 'neon':
        // a few centimetres off the wall, the way it faces
        neons.push({ text: fx.text, color: fx.color, font: fx.font ?? 'Tilt Neon', x: r.cx + fx.x + Math.sin(fx.ry) * 0.03, y: fx.y, z: r.cz + fx.z + Math.cos(fx.ry) * 0.03, ry: fx.ry, w: fx.w, h: fx.h, room: r.id });
        break;
      case 'prizes':
      case 'snack': {
        const counter: Rect = { x0: r.cx + fx.x0, x1: r.cx + fx.x1, z0: r.cz + fx.z0, z1: r.cz + fx.z1 };
        // against the nearer of the room's walls, across the counter's narrow way
        const alongZ = counter.z1 - counter.z0 > counter.x1 - counter.x0;
        const I = r.inner;
        if (alongZ) {
          const east = I.x1 - counter.x1 < counter.x0 - I.x0;
          counters.push({ kind: fx.kind, counter, wall: east ? I.x1 : I.x0, axis: 'z', side: east ? 1 : -1, room: r.id });
        } else {
          const south = I.z1 - counter.z1 < counter.z0 - I.z0;
          counters.push({ kind: fx.kind, counter, wall: south ? I.z1 : I.z0, axis: 'x', side: south ? 1 : -1, room: r.id });
        }
        break;
      }
      case 'lanterns': {
        const y = r.style.ceiling - 0.62;
        const [x0, z0] = [r.cx + fx.from[0], r.cz + fx.from[1]];
        const [x1, z1] = [r.cx + fx.to[0], r.cz + fx.to[1]];
        cords.push({ x0, z0, x1, z1, y: y + 0.36, room: r.id });
        for (let i = 0; i < fx.n; i++) {
          const t = fx.n === 1 ? 0.5 : i / (fx.n - 1);
          lanterns.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, y, color: fx.color, room: r.id });
        }
        break;
      }
      case 'table-lanterns':
        for (const s of stations) if (s.room === r.id && s.zone === 'pit') tableLanterns.push({ x: s.x, z: s.z, room: r.id });
        break;
      case 'moongate':
        moongates.push({ x: r.cx + fx.x, z: r.cz + fx.z, ry: fx.ry, w: MOONGATE.r * 2 + 0.5, room: r.id });
        break;
      case 'lattice':
        for (const [x, z] of fx.at) lattices.push({ x: r.cx + x, z: r.cz + z, ry: fx.ry, w: fx.w, room: r.id });
        break;
      case 'drapes':
        drapes.push({ x: r.cx + fx.x, z: r.cz + fx.z, ry: fx.ry, w: fx.w, room: r.id });
        break;
      case 'patterns':
        for (const [x, z] of fx.at) patternBoards.push({ x: r.cx + x, z: r.cz + z, ry: fx.ry, w: PATTERN_BOARD.w, room: r.id });
        break;
      case 'table-lamps':
        for (const s of stations) if (s.room === r.id && s.game === 'holdem') tableLamps.push({ x: s.x, z: s.z, yaw: s.yaw, room: r.id });
        break;
      case 'festoon':
        festoons.push({ x0: r.cx + fx.from[0], z0: r.cz + fx.from[1], x1: r.cx + fx.to[0], z1: r.cz + fx.to[1], y: r.style.ceiling - 1.15, room: r.id });
        break;
      case 'pit-podium':
        break;
    }
  }
  const b = bar as FloorPlan['bar'] | null;
  const bankCashier = cashier as FloorPlan['cashier'] | null;

  // --- furniture -------------------------------------------------------------------------------
  const furniture: PlacedFurniture[] = [];
  for (const spec of ROOMS) {
    const r = room(spec.id);
    const counts = new Map<FurnitureKind, number>();
    for (const f of spec.furniture) {
      const n = (counts.get(f.kind) ?? 0) + 1;
      counts.set(f.kind, n);
      furniture.push({ kind: f.kind, room: r.id, x: r.cx + f.x, z: r.cz + f.z, yaw: f.yaw, n, wears: f.wears, size: f.size });
    }
  }

  // --- aisles: each room's walkways, then the approach to every door on both sides -----------------
  const aisles: Rect[] = [];
  const statues: FloorPlan['statues'] = [];
  const pitSpec = ROOMS.find((r) => r.id === 'pit');
  const ordered = pitSpec ? [pitSpec, ...ROOMS.filter((r) => r !== pitSpec)] : ROOMS;
  for (const spec of ordered) {
    const r = room(spec.id);
    for (const a of [...spec.aisles, ...(spec.keep ?? [])]) aisles.push({ x0: r.cx + a.x0, z0: r.cz + a.z0, x1: r.cx + a.x1, z1: r.cz + a.z1 });
    // a statue's plinth and the walk round it are kept clear of anything placed (checkLayout)
    for (const [x, z, yaw] of spec.statues ?? []) statues.push({ x: r.cx + x, z: r.cz + z, yaw, room: r.id });
  }
  for (const d of doors) {
    if (d.b === 'outside') continue;
    const depth = 1.1;
    aisles.push(d.axis === 'x' ? { x0: d.a0, x1: d.a1, z0: d.c - WALL / 2 - depth, z1: d.c + WALL / 2 + depth } : { x0: d.c - WALL / 2 - depth, x1: d.c + WALL / 2 + depth, z0: d.a0, z1: d.a1 });
  }

  // --- the entrance, and the pieces other parts of the client read -----------------------------------
  const lobby = room('lobby');
  const entranceDoor = doors.find((d) => d.b === 'outside');
  const door = entranceDoor ? { x0: entranceDoor.a0, x1: entranceDoor.a1, height: entranceDoor.height, z: entranceDoor.c } : { x0: -1.3, x1: 1.3, height: 2.9, z: lobby.bounds.z1 };
  const entrance: Rect = { ...lobby.inner };
  const wheel = stations.find((s) => s.zone === 'feature');
  const feature: Rect = wheel ? { x0: room(wheel.room).inner.x0, x1: wheel.x + wheel.fp.depth / 2 + 1.6, z0: wheel.z - wheel.fp.width / 2 - DEALER_ROOM, z1: wheel.z + wheel.fp.width / 2 } : pit;
  // the pit's columns stand at the coffers' south corners, the lobby's either side of the grand opening
  const columns: FloorPlan['columns'] = [
    { x: pit.x0, z: pit.z1, r: 0.42, room: 'pit' },
    { x: pit.x1, z: pit.z1, r: 0.42, room: 'pit' },
  ];
  const grand = doors.find((d) => d.kind === 'grand');
  if (grand) for (const x of [grand.a0 - 0.62, grand.a1 + 0.62]) columns.push({ x, z: grand.c + WALL / 2 + 0.66, r: 0.34, room: grand.a });

  // hanging signs, world space
  const hanging: Hanging[] = [];
  for (const spec of ROOMS) {
    const r = room(spec.id);
    for (const h of spec.hanging) hanging.push({ ...h, x: r.cx + h.x, z: r.cz + h.z, room: r.id });
  }

  const slotsRoom = room('slots');
  const pitDoor = doors.find((d) => d.id === 'pit-slots');
  const tallyAt = { x: slotsRoom.inner.x1 - 2.9, z: pitDoor ? (pitDoor.a0 + pitDoor.a1) / 2 : slotsRoom.cz };

  const plan: FloorPlan = {
    room: ROOM,
    rooms,
    doors,
    wallPieces,
    windows,
    walls: wallRects(wallPieces, windows),
    doorways: doors.filter((d) => d.b !== 'outside').map((d) => d.rect),
    stations,
    chairs,
    furniture,
    pit,
    staff,
    podium,
    aisles,
    entrance,
    door,
    pokerRoom: room('poker').inner,
    slotsZone: slotsRoom.inner,
    feature,
    barZone,
    banks,
    bar: b ?? { front: 0, depth: 0.78, z0: 0, z1: 0, back: 0, wall: 0, segments: [], stoolX: 0, stools: [], vp: [], pendants: [] },
    vpMode: 'floor',
    cashier: bankCashier ?? { counter: { x0: 0, x1: 0, z0: 0, z1: 0 }, x: 0, z: 0, face: Math.PI, windows: [] },
    boutique,
    lounge: room('lounge').inner,
    loungeGroups,
    fireplaces,
    vaults,
    neons,
    tableLamps,
    festoons,
    machineIslands,
    counters,
    lanterns,
    cords,
    tableLanterns,
    moongates,
    lattices,
    patternBoards,
    drapes,
    statues,
    deskIslands,
    columns,
    plants: [],
    palms: [],
    hanging,
    solids: [],
    tallyAt,
    capture: { x: pitRoom.cx, y: 1.7, z: pit.z1 + 2.4 },
  };
  setVpMode(plan, opts.vpMode ?? 'floor');
  return plan;
}

// --- chairs ----------------------------------------------------------------------------------------

/** A table's chairs or stools, one at each of its seats, facing the table. */
function chairsFor(p: Placement, seats: SeatSpot[]): ChairPlace[] {
  const seating = SEATING[p.game];
  if (!seating) return [];
  const { kind, top } = p.tier === 'high' && seating.high ? seating.high : seating;
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return seats.map((seat, slot) => {
    const [lx, , lz] = seat.position;
    return { station: p.id, slot, room: p.room, kind, x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c, yaw: p.yaw + seat.yaw, top };
  });
}

// --- walls and doors ----------------------------------------------------------------------------

function planDoor(d: DoorSpec, room: (id: RoomId) => PlannedRoom): PlannedDoor {
  const a = room(d.a);
  const reach = 0.6;
  let axis: 'x' | 'z';
  let c: number;
  if (d.b === 'outside') {
    // a door to the street is in the room's south wall
    axis = 'x';
    c = a.bounds.z1;
  } else {
    const bb = room(d.b).bounds;
    const ab = a.bounds;
    if (ab.z1 === bb.z0 || ab.z0 === bb.z1) {
      axis = 'x';
      c = ab.z1 === bb.z0 ? ab.z1 : ab.z0;
    } else if (ab.x1 === bb.x0 || ab.x0 === bb.x1) {
      axis = 'z';
      c = ab.x1 === bb.x0 ? ab.x1 : ab.x0;
    } else {
      throw new Error(`door ${d.id}: ${d.a} and ${d.b} share no wall`);
    }
  }
  const a0 = d.at - d.width / 2;
  const a1 = d.at + d.width / 2;
  const rect = axis === 'x' ? { x0: a0, x1: a1, z0: c - reach, z1: c + reach } : { x0: c - reach, x1: c + reach, z0: a0, z1: a1 };
  return { id: d.id, a: d.a, b: d.b, kind: d.kind, axis, c, a0, a1, height: d.height, rect };
}

/** Where a shopfront's glass goes: its wall either side of the door, clear of the corners. */
function shopWindows(doors: PlannedDoor[], room: (id: RoomId) => PlannedRoom): Window[] {
  const out: Window[] = [];
  for (const d of doors) {
    if (d.kind !== 'shopfront' || d.b === 'outside') continue;
    const a = room(d.a).bounds;
    const bb = room(d.b).bounds;
    const lo = d.axis === 'x' ? Math.max(a.x0, bb.x0) : Math.max(a.z0, bb.z0);
    const hi = d.axis === 'x' ? Math.min(a.x1, bb.x1) : Math.min(a.z1, bb.z1);
    // neg is the room on the line's north or west side
    const aNeg = d.axis === 'x' ? a.z1 === d.c : a.x1 === d.c;
    const neg = aNeg ? d.a : d.b;
    const pos = aNeg ? d.b : d.a;
    for (const [s0, s1] of [
      [lo + 0.9, d.a0 - 0.4],
      [d.a1 + 0.4, hi - 0.9],
    ] as const) {
      if (s1 - s0 > 0.8) out.push({ axis: d.axis, c: d.c, a0: s0, a1: s1, y0: 0.42, y1: 2.72, neg, pos });
    }
  }
  return out;
}

/** Every stretch of wall, split round doors (a lintel over each) and shop windows (a sill and a head). */
function planWalls(rooms: PlannedRoom[], doors: PlannedDoor[], windows: Window[]): WallPiece[] {
  const out: WallPiece[] = [];
  const ceil = (id: RoomId | null) => (id ? (rooms.find((r) => r.id === id)?.style.ceiling ?? CEILING) : 0);
  for (const axis of ['x', 'z'] as const) {
    // lines: z = c for walls running east-west ('x'), x = c for north-south ones
    const lines = new Set<number>();
    for (const r of rooms) {
      if (axis === 'x') {
        lines.add(r.bounds.z0);
        lines.add(r.bounds.z1);
      } else {
        lines.add(r.bounds.x0);
        lines.add(r.bounds.x1);
      }
    }
    for (const c of lines) {
      // rooms on each side of the line, and where along it they reach
      const negs = rooms.filter((r) => (axis === 'x' ? r.bounds.z1 === c : r.bounds.x1 === c));
      const poss = rooms.filter((r) => (axis === 'x' ? r.bounds.z0 === c : r.bounds.x0 === c));
      const span = (r: PlannedRoom): [number, number] => (axis === 'x' ? [r.bounds.x0, r.bounds.x1] : [r.bounds.z0, r.bounds.z1]);
      const cuts = [...new Set([...negs, ...poss].flatMap((r) => span(r)))].sort((p, q) => p - q);
      let run: WallPiece | null = null;
      for (let i = 0; i + 1 < cuts.length; i++) {
        const p = cuts[i]!;
        const q = cuts[i + 1]!;
        const m = (p + q) / 2;
        const neg = negs.find((r) => span(r)[0] <= m && span(r)[1] >= m)?.id ?? null;
        const pos = poss.find((r) => span(r)[0] <= m && span(r)[1] >= m)?.id ?? null;
        if (!neg && !pos) {
          run = null;
          continue;
        }
        if (run && run.neg === neg && run.pos === pos && run.a1 === p) {
          run.a1 = q;
          continue;
        }
        run = { axis, c, a0: p, a1: q, neg, pos, y0: 0, y1: Math.max(ceil(neg), ceil(pos)) };
        out.push(run);
      }
    }
  }
  // extend each run over the wall thickness where it ends at a corner, so corners close: not where
  // the next run on the same line carries on, and not where it meets a wall running on past it (a
  // T): there the other wall already fills the joint, and an end pushed through to its far face
  // would sit in that face and flicker against it
  const ends = out.map((w) => ({ w, a0: w.a0, a1: w.a1 }));
  for (const e of ends) {
    const touching = (v: number) => ends.some((o) => o !== e && o.w.axis === e.w.axis && o.w.c === e.w.c && (Math.abs(o.a0 - v) < 1e-6 || Math.abs(o.a1 - v) < 1e-6));
    const across = (v: number, lo: number, hi: number) => ends.some((o) => o.w.axis !== e.w.axis && Math.abs(o.w.c - v) < 1e-6 && o.a0 <= lo + 1e-6 && o.a1 >= hi - 1e-6);
    const through = (v: number) => across(v, e.w.c - 0.01, e.w.c) && across(v, e.w.c, e.w.c + 0.01);
    if (!touching(e.a0) && !through(e.a0)) e.w.a0 -= WALL / 2;
    if (!touching(e.a1) && !through(e.a1)) e.w.a1 += WALL / 2;
  }
  // openings: doors (a lintel stays over them) and windows (a sill below, a head above)
  const cut = (list: WallPiece[], o: { axis: 'x' | 'z'; c: number; a0: number; a1: number }, keep: [number, number][]): WallPiece[] => {
    const res: WallPiece[] = [];
    for (const w of list) {
      if (w.axis !== o.axis || w.c !== o.c || o.a1 <= w.a0 || o.a0 >= w.a1 || w.y0 > 0) {
        res.push(w);
        continue;
      }
      if (o.a0 > w.a0) res.push({ ...w, a1: o.a0 });
      for (const [y0, y1] of keep) if (y1 > y0) res.push({ ...w, a0: Math.max(w.a0, o.a0), a1: Math.min(w.a1, o.a1), y0, y1: Math.min(y1, w.y1) });
      if (o.a1 < w.a1) res.push({ ...w, a0: o.a1 });
    }
    return res;
  };
  let pieces = out;
  for (const d of doors) {
    const top = pieces.find((w) => w.axis === d.axis && w.c === d.c && w.a0 < d.a1 && w.a1 > d.a0)?.y1 ?? CEILING;
    pieces = cut(pieces, d, [[d.height, top]]);
  }
  for (const w of windows) {
    const top = pieces.find((p) => p.axis === w.axis && p.c === w.c && p.a0 < w.a1 && p.a1 > w.a0)?.y1 ?? CEILING;
    pieces = cut(pieces, w, [
      [0.0001, w.y0],
      [w.y1, top],
    ]);
  }
  // a sill starts at the floor
  for (const p of pieces) if (p.y0 > 0 && p.y0 < 0.001) p.y0 = 0;
  return pieces;
}

/** Walls and windows as boxes on the floor (what a walker bumps into). */
function wallRects(pieces: WallPiece[], windows: Window[]): Rect[] {
  const box = (axis: 'x' | 'z', c: number, a0: number, a1: number): Rect => (axis === 'x' ? { x0: a0, x1: a1, z0: c - WALL / 2, z1: c + WALL / 2 } : { x0: c - WALL / 2, x1: c + WALL / 2, z0: a0, z1: a1 });
  return [...pieces.filter((p) => p.y0 < 1.2).map((p) => box(p.axis, p.c, p.a0, p.a1)), ...windows.map((w) => box(w.axis, w.c, w.a0, w.a1))];
}

// --- where things are -----------------------------------------------------------------------------

/** The room a point on the floor is in (its walls' centre lines), or null outside the building. */
export function roomAt(plan: FloorPlan, x: number, z: number): PlannedRoom | null {
  for (const r of plan.rooms) {
    const b = r.bounds;
    if (x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1) return r;
  }
  return null;
}

/** The ceiling over a point: its room's, or the pit's coffers over its tables. */
export function ceilingAt(plan: FloorPlan, x: number, z: number, lip = 0): number {
  const r = roomAt(plan, x, z);
  if (!r) return CEILING;
  if (r.id === 'pit' && inRect(plan.pit, x, z, -lip)) return PIT_CEILING;
  return r.style.ceiling;
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
  let room: RoomId = 'pit';
  const box = (id: string, group: string, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, extra: Partial<Solid> = {}) =>
    out.push({ id, group, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, yaw: 0, y0, y1, room, ...extra });
  const round = (id: string, group: string, x: number, z: number, r: number, y0: number, y1: number, extra: Partial<Solid> = {}) =>
    out.push({ id, group, x, z, w: 2 * r, d: 2 * r, yaw: 0, y0, y1, round: true, room, ...extra });
  const turned = (id: string, group: string, x: number, z: number, w: number, d: number, yaw: number, y0: number, y1: number, extra: Partial<Solid> = {}) =>
    out.push({ id, group, x, z, w, d, yaw, y0, y1, room, ...extra });
  const roomOf = (x: number, z: number) => roomAt(plan, x, z)?.id ?? 'pit';

  // columns rise to their room's own ceiling (the pit's stand under the coffers' lip)
  plan.columns.forEach((c, i) => {
    room = c.room;
    round(`column-${i + 1}`, `column-${i + 1}`, c.x, c.z, c.r + 0.12, 0, plan.rooms.find((r) => r.id === c.room)?.style.ceiling ?? CEILING);
  });

  // slot islands: plinth, spine, end caps and LED strips; the topper on its mast above
  for (const b of plan.banks) {
    room = roomOf(b.x, b.z);
    const g = `bank-${b.variant}-${Math.round(b.x * 10)}-${Math.round(b.z * 10)}`;
    turned(`${g}-island`, g, b.x, b.z, b.length + 0.54, b.depth + 0.2, b.yaw, 0, 1.95, { holds: b.ids, floor: true });
    const tw = Math.min(Math.max(b.length * 0.9, 1.6), 3.2);
    turned(`${g}-topper`, g, b.x, b.z, tw + 0.16, 0.22, b.yaw, 2.31, 2.945);
  }

  // the bar: counter runs (the marble top overhangs the front, the armrest further), the foot
  // rail, the returns closing the bartenders' side, the back bar, the pendants over the counter
  const bar = plan.bar;
  if (bar.z1 > bar.z0) {
    room = roomOf(bar.front, (bar.z0 + bar.z1) / 2);
    const onCounter = plan.vpMode === 'bartop' ? bar.vp : undefined;
    bar.segments.forEach(([z0, z1], i) => {
      box(`bar-counter-${i + 1}`, 'bar', bar.front - 0.145, bar.front + bar.depth + 0.04, z0 - 0.03, z1 + 0.03, 0, BAR_TOP + 0.065, { holds: onCounter, floor: true });
      box(`bar-rail-${i + 1}`, 'bar', bar.front - 0.262, bar.front, z0, z1, 0.17, 0.23, { holds: onCounter });
    });
    for (const [k, z] of [bar.z0, bar.z1].entries()) box(`bar-return-${k + 1}`, 'bar', bar.front + bar.depth, bar.back, z - 0.1, z + 0.1, 0, BAR_TOP);
    box('back-bar', 'bar', bar.back, bar.wall, bar.z0 + 0.15, bar.z1 - 0.15, 0, ceilingAt(plan, bar.back, bar.z0 + 1), { wall: true });
    bar.pendants.forEach((z, i) => round(`bar-pendant-${i + 1}`, 'bar', bar.front + bar.depth / 2 - 0.1, z, 0.21, 2.15, ceilingAt(plan, bar.front, z)));
    bar.stools.forEach((z, i) => round(`stool-${i + 1}`, `stool-${i + 1}`, bar.stoolX, z, STOOL.r, 0, STOOL.h, { floor: true }));
  }

  // the cashier's cage along the bank's north wall, wall to wall: the counter, the bars and fascia
  // over it; behind the counter is open floor, where the tellers stand
  const c = plan.cashier;
  if (c.counter.x1 > c.counter.x0) {
    room = roomOf(c.x, c.z);
    const k = c.counter;
    box('cashier-counter', 'cashier', k.x0, k.x1, k.z1 - 0.66, k.z1 + 0.06, 0, 1.15, { wall: true, floor: true });
    box('cashier-screen', 'cashier', k.x0, k.x1, k.z1 - 0.43, k.z1 - 0.21, 1.15, ceilingAt(plan, c.x, c.z), { wall: true });
  }
  for (const v of plan.vaults) {
    room = v.room;
    box(`vault-${Math.round(v.x)}`, 'vault', v.x - 1.05, v.x + 1.05, v.z, v.z + 0.22, 0.25, 2.45, { wall: true });
  }

  // the boutique's counter and the shelves behind it
  if (plan.boutique) {
    const k = plan.boutique.counter;
    room = roomOf((k.x0 + k.x1) / 2, (k.z0 + k.z1) / 2);
    box('boutique-counter', 'boutique-counter', k.x0, k.x1, k.z0, k.z1, 0, 1.0, { floor: true });
    box('boutique-shelves', 'boutique-shelves', plan.boutique.wall - 0.36, plan.boutique.wall, k.z0 - 0.4, k.z1 + 0.4, 0, 2.5, { wall: true });
  }

  // the pit podium, with its lamp
  room = 'pit';
  box('podium', 'podium', plan.podium.x - PODIUM.w / 2, plan.podium.x + PODIUM.w / 2, plan.podium.z - PODIUM.d / 2, plan.podium.z + PODIUM.d / 2, 0, PODIUM.h, { floor: true });

  // the lounges: couches facing each other across a coffee table, a floor lamp at each end
  plan.loungeGroups.forEach((gp, i) => {
    room = gp.room;
    const g = `lounge-${i + 1}`;
    for (const [k, s] of [-1, 1].entries()) {
      box(`${g}-couch-${k + 1}`, g, gp.x - COUCH.w / 2, gp.x + COUCH.w / 2, gp.z + s * 1.25 - COUCH.d / 2, gp.z + s * 1.25 + COUCH.d / 2, 0, COUCH.h, { floor: true });
      round(`${g}-lamp-${k + 1}`, `${g}-lamp-${k + 1}`, gp.x - s * loungeLampX(), gp.z + s * 1.25, FLOOR_LAMP.r, 0, FLOOR_LAMP.h, { floor: true });
    }
    box(`${g}-table`, g, gp.x - COFFEE_TABLE.w / 2, gp.x + COFFEE_TABLE.w / 2, gp.z - COFFEE_TABLE.d / 2, gp.z + COFFEE_TABLE.d / 2, 0, COFFEE_TABLE.h, { floor: true });
  });
  for (const f of plan.fireplaces) {
    room = f.room;
    box(`fireplace-${Math.round(f.z)}`, 'fireplace', f.x - 0.55, f.x, f.z - 1.1, f.z + 1.1, 0, 1.3, { wall: true, floor: true });
    box(`fireplace-${Math.round(f.z)}-breast`, 'fireplace', f.x - 0.34, f.x, f.z - 0.95, f.z + 0.95, 1.3, ceilingAt(plan, f.x - 0.2, f.z), { wall: true });
  }

  // the loose furniture (a palm's planter comes with placePalms)
  for (const f of plan.furniture) {
    if (f.kind === 'palm') continue;
    room = f.room;
    const spec = FURNITURE[f.kind];
    const g = `${f.room}-${f.kind}-${f.n}`;
    if (spec.round) round(`${g}`, g, f.x, f.z, spec.w / 2, 0, spec.h, { floor: true, walk: spec.walk });
    else turned(`${g}`, g, f.x, f.z, spec.w, spec.d, f.yaw, 0, spec.h, { floor: true, wall: f.kind === 'workbench' || f.kind === 'pallets' });
  }

  // the tables' chairs and stools: each may stand in its own table's footprint and players' room
  for (const ch of plan.chairs) {
    room = ch.room;
    const k = CHAIRS[ch.kind];
    const g = `chairs-${ch.station}`;
    // (a round seat is its cushion, or its back where it has one: the pachinko stool's)
    if (k.round) round(`chair-${ch.station}-${ch.slot + 1}`, g, ch.x, ch.z, k.w / 2, 0, Math.max(ch.top + 0.06, k.h), { of: ch.station });
    else turned(`chair-${ch.station}-${ch.slot + 1}`, g, ch.x, ch.z, k.w, k.d, ch.yaw, 0, k.h, { of: ch.station });
  }

  // islands of machines: the spine and the plinth hold the machines; end caps and a crown over them
  for (const isl of plan.machineIslands) {
    room = isl.room;
    const g = `island-${isl.n}`;
    turned(`${g}-body`, g, isl.x, isl.z, isl.length + 2 * ISLAND_CAP, isl.depth, isl.yaw, 0, ISLAND_TOP, { holds: isl.ids, floor: true });
  }

  // counters along a wall (the parlour's prizes, the bingo hall's snack bar) and the shelves behind them
  for (const c of plan.counters) {
    room = c.room;
    const k = c.counter;
    const g = `${c.kind}-${Math.round(k.x0)}-${Math.round(k.z0)}`;
    box(`${g}-counter`, g, k.x0, k.x1, k.z0, k.z1, 0, WALL_COUNTER.h, { floor: true });
    const back = c.side > 0 ? [c.wall - WALL_COUNTER.shelf, c.wall] : [c.wall, c.wall + WALL_COUNTER.shelf];
    if (c.axis === 'z') box(`${g}-shelves`, g, back[0]!, back[1]!, k.z0 - 0.3, k.z1 + 0.3, 0, WALL_COUNTER.back, { wall: true });
    else box(`${g}-shelves`, g, k.x0 - 0.3, k.x1 + 0.3, back[0]!, back[1]!, 0, WALL_COUNTER.back, { wall: true });
  }

  // paper lanterns on their cords, and the big ones low over the Jade Room's tables
  plan.lanterns.forEach((l, i) => {
    room = l.room;
    round(`lantern-${i + 1}`, `lantern-${i + 1}`, l.x, l.z, LANTERN.r, l.y - LANTERN.h / 2 - 0.05, ceilingAt(plan, l.x, l.z));
  });
  for (const l of plan.tableLanterns) {
    room = l.room;
    round(`table-lantern-${Math.round(l.x)}-${Math.round(l.z)}`, 'table-lanterns', l.x, l.z, TABLE_LANTERN.r, TABLE_LANTERN.y - TABLE_LANTERN.h / 2 - 0.08, ceilingAt(plan, l.x, l.z));
  }

  // things on the walls: the moon gate's frame, lattice screens, the pattern boards
  const onWall = (id: string, m: WallMount, d: number, y0: number, y1: number) => {
    room = m.room;
    turned(id, id, m.x + Math.sin(m.ry) * (d / 2), m.z + Math.cos(m.ry) * (d / 2), m.w, d, m.ry, y0, y1, { wall: true });
  };
  plan.moongates.forEach((m, i) => onWall(`moongate-${i + 1}`, m, 0.16, 0, MOONGATE.y + MOONGATE.r + 0.62));
  plan.lattices.forEach((m, i) => onWall(`lattice-${i + 1}`, m, 0.16, 0.3, 2.62));
  plan.drapes.forEach((m, i) => {
    const top = ceilingAt(plan, m.x, m.z) - 0.02;
    for (const e of [-1, 1]) onWall(`drape-${i + 1}-${e > 0 ? 'e' : 'w'}`, { ...m, x: m.x + Math.cos(m.ry) * e * (m.w / 2 + DRAPES.w / 2), z: m.z - Math.sin(m.ry) * e * (m.w / 2 + DRAPES.w / 2), w: DRAPES.w }, DRAPES.d, 0, top - DRAPES.pelmet);
    onWall(`pelmet-${i + 1}`, { ...m, w: m.w + 2 * DRAPES.w + 0.2 }, DRAPES.d + 0.08, top - DRAPES.pelmet, top);
  });
  plan.patternBoards.forEach((m, i) => onWall(`pattern-board-${i + 1}`, m, 0.09, PATTERN_BOARD.y - PATTERN_BOARD.h / 2 - 0.05, PATTERN_BOARD.y + PATTERN_BOARD.h / 2 + 0.05));

  // lamps low over the poker tables, and the yard's string of bulbs overhead
  for (const l of plan.tableLamps) {
    room = l.room;
    turned(`table-lamp-${Math.round(l.x)}-${Math.round(l.z)}`, 'table-lamps', l.x, l.z, 1.9, 0.62, l.yaw, 2.02, ceilingAt(plan, l.x, l.z));
  }

  // hanging signs: the box with its brass trims
  for (const h of plan.hanging) {
    room = h.room;
    out.push({ id: `sign-${h.id}`, group: `sign-${h.id}`, x: h.x, z: h.z, w: h.w + 0.2, d: 0.17, yaw: h.ry, y0: h.y - h.h / 2 - 0.08, y1: h.y + h.h / 2 + 0.08, room });
  }
  return out;
}

/** How far from the lounge's centre line its floor lamps stand: clear of the couch's arm. */
function loungeLampX(): number {
  return COUCH.w / 2 + FLOOR_LAMP.r + 0.1;
}
export const LOUNGE_LAMP_X = loungeLampX();

function palmSolids(p: Palm, id: string): Solid[] {
  const g = id;
  const r = LEAVES.palm.r * p.size;
  return [
    { id: `${g}-planter`, group: g, x: p.x, z: p.z, w: 2 * planterRadius('palm', p.size), d: 2 * planterRadius('palm', p.size), yaw: 0, y0: 0, y1: PALM_PLANTER.h, round: true, floor: true, walk: Math.max(planterRadius('palm', p.size), PALM_WALK), room: p.room },
    { id: `${g}-trunk`, group: g, x: p.x, z: p.z, w: 2 * PALM_TRUNK * p.size, d: 2 * PALM_TRUNK * p.size, yaw: 0, y0: PALM_PLANTER.seat, y1: PALM_PLANTER.seat + p.size, round: true, room: p.room },
    { id: `${g}-fronds`, group: g, x: p.x, z: p.z, w: 2 * r, d: 2 * r, yaw: 0, y0: PALM_PLANTER.seat + LEAVES.palm.from * p.size, y1: PALM_PLANTER.seat + p.size, round: true, room: p.room },
  ];
}

/**
 * The palms, each as big as fits: under its room's ceiling, the fronds clear of the walls, the
 * door frames and everything else. A banquette's palm stands in its middle, over the sitters' heads.
 */
function placePalms(plan: FloorPlan): void {
  let k = 0;
  for (const f of plan.furniture) {
    if (f.kind !== 'palm' && f.kind !== 'banquette') continue;
    const ceiling = ceilingAt(plan, f.x, f.z);
    const sizes = f.size ? [f.size] : [2.6, 2.4, 2.2, 2.0, 1.8];
    const group = f.kind === 'banquette' ? `${f.room}-banquette-${f.n}` : `palm-${++k}`;
    const I = plan.rooms.find((r) => r.id === f.room)!.inner;
    for (const size of sizes) {
      if (PALM_PLANTER.seat + size > ceiling - 0.15) continue;
      // over a banquette the fronds must start above the heads of the people sitting there
      if (f.kind === 'banquette' && PALM_PLANTER.seat + LEAVES.palm.from * size < 1.45) continue;
      // a palm near a wall stands as close to it as its fronds allow
      const r = LEAVES.palm.r * size;
      let x = f.x;
      let z = f.z;
      if (f.kind === 'palm') {
        const inset = r + TRIM + 0.02;
        if (x - I.x0 < 2) x = I.x0 + inset;
        else if (I.x1 - x < 2) x = I.x1 - inset;
        if (z - I.z0 < 2) z = I.z0 + inset;
        else if (I.z1 - z < 2) z = I.z1 - inset;
      }
      const p: Palm = { x, z, size, room: f.room };
      const parts = palmSolids(p, group).map((s) => (f.kind === 'banquette' && s.id.endsWith('-planter') ? { ...s, floor: false } : s));
      if (parts.every((s) => clashes(plan, s, plan.solids).length === 0)) {
        plan.palms.push(p);
        plan.solids.push(...parts);
        break;
      }
    }
  }
}

function plantSolids(p: Plant, i: number): Solid[] {
  const g = `plant-${i + 1}`;
  const leaves = LEAVES[p.kind];
  return [
    { id: `${g}-planter`, group: g, x: p.x, z: p.z, w: 2 * planterRadius(p.kind, p.size), d: 2 * planterRadius(p.kind, p.size), yaw: 0, y0: 0, y1: PLANTER.h, round: true, floor: true, room: p.room },
    { id: `${g}-leaves`, group: g, x: p.x, z: p.z, w: 2 * leaves.r * p.size, d: 2 * leaves.r * p.size, yaw: 0, y0: PLANTER.seat + leaves.from * p.size, y1: PLANTER.seat + p.size, round: true, walk: plantWalk(p.kind, p.size), room: p.room },
  ];
}

/**
 * Plants for the corners the rooms ask for. A spot near a wall is pushed against it for each leaf
 * spread tried; the plant is the largest of a few sizes whose leaves clear the walls, the stations,
 * their players and every solid, or the spot is left bare.
 */
function placePlants(plan: FloorPlan): void {
  const inset = (r: number) => r + TRIM + 0.02;
  for (const spec of ROOMS) {
    const room = plan.rooms.find((r) => r.id === spec.id)!;
    const I = room.inner;
    spec.plants.forEach(([lx, lz], k) => {
      const kind: PlantKind = k % 2 === 0 ? 'plant-a' : 'plant-b';
      for (const size of [1.1, 0.95, 0.8]) {
        const r = LEAVES[kind].r * size;
        let x = room.cx + lx;
        let z = room.cz + lz;
        // pushed into the corner or against the wall it's near
        if (x - I.x0 < 1.4) x = I.x0 + inset(r);
        else if (I.x1 - x < 1.4) x = I.x1 - inset(r);
        if (z - I.z0 < 1.4) z = I.z0 + inset(r);
        else if (I.z1 - z < 1.4) z = I.z1 - inset(r);
        const p: Plant = { kind, x, z, size, room: room.id };
        const parts = plantSolids(p, plan.plants.length);
        if (parts.every((s) => clashes(plan, s, plan.solids).length === 0)) {
          plan.plants.push(p);
          plan.solids.push(...parts);
          break;
        }
      }
    });
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

/** The ceiling over a solid: the pit's coffers only when it is wholly inside them, clear of the cove's lip. */
function ceilingOver(plan: FloorPlan, s: Solid): number {
  const [x0, x1, z0, z1] = extent(s);
  const lip = 0.45;
  const p = plan.pit;
  const inPit = roomAt(plan, s.x, s.z)?.id === 'pit';
  if (inPit && x0 >= p.x0 + lip && x1 <= p.x1 - lip && z0 >= p.z0 + lip && z1 <= p.z1 - lip) return PIT_CEILING;
  // the lowest ceiling anywhere under it
  return Math.min(...[
    [x0, z0],
    [x1, z0],
    [x0, z1],
    [x1, z1],
    [s.x, s.z],
  ].map(([x, z]) => {
    const r = roomAt(plan, x!, z!);
    return r ? r.style.ceiling : CEILING;
  }));
}

/** A station's standing room: a strip along its player side (tables, and machines on the floor). */
function playerStrip(p: Placement): Poly | null {
  if (p.zone === 'bar') return null;
  const off = p.fp.depth / 2 + 0.45;
  return corners(p.x + Math.sin(p.yaw) * off, p.z + Math.cos(p.yaw) * off, p.fp.width * 0.8, 0.7, p.yaw);
}

/** The room a rect of floor stands in: the one holding its middle. */
function holder(plan: FloorPlan, x: number, z: number): PlannedRoom | null {
  return roomAt(plan, x, z);
}

/** What `s` passes through, as readable strings: walls, the ceiling, stations, their players, aisles, other solids. */
function clashes(plan: FloorPlan, s: Solid, others: Solid[]): string[] {
  const out: string[] = [];
  const [x0, x1, z0, z1] = extent(s);
  const r = holder(plan, s.x, s.z);
  if (!r) out.push(`${s.id} stands outside the building`);
  else {
    const R = r.inner;
    const margin = s.wall ? -0.001 : TRIM;
    // a wall with a door in it may be passed through only at the door
    const inside = x0 >= R.x0 + margin && x1 <= R.x1 - margin && z0 >= R.z0 + margin && z1 <= R.z1 - margin;
    if (!inside) out.push(`${s.id} pokes through a wall of the ${r.name}`);
  }
  if (s.y1 > ceilingOver(plan, s) + 0.001) out.push(`${s.id} pokes through the ceiling`);
  const shape = shapeOf(s);
  for (const p of plan.stations) {
    if (s.holds?.includes(p.id) || s.of === p.id) continue;
    const box = corners(p.x, p.z, p.fp.width, p.fp.depth, p.yaw);
    if (s.y0 < STATION_H[p.zone] && shapesOverlap(shape, { poly: box })) out.push(`${s.id} clips ${p.id}`);
    const strip = playerStrip(p);
    // anything at body height in front of a station is in its players' way
    if (strip && s.y0 < 1.8 && !s.holds?.length && shapesOverlap(shape, { poly: strip })) out.push(`${s.id} blocks the players of ${p.id}`);
  }
  if (s.floor) for (const [k, aisle] of plan.aisles.entries()) if (shapesOverlap(shape, { poly: rectPoly(aisle) })) out.push(`${s.id} stands in aisle ${k}`);
  // a statue's place: nothing standing on its plinth or the walk round it, and nothing overhead
  // (a palm's fronds) within reach of the figure
  for (const [k, st] of plan.statues.entries()) {
    const h = STATUE_PLINTH / 2 + STATUE_CLEAR;
    const onFloor = s.y0 < 1.2 && shapesOverlap(shape, { poly: rectPoly({ x0: st.x - h, z0: st.z - h, x1: st.x + h, z1: st.z + h }) });
    const over = s.y0 >= 1.2 && s.y0 < 3.2 && shapesOverlap(shape, { x: st.x, z: st.z, r: 0.45 });
    if (onFloor || over) out.push(`${s.id} stands on statue place ${k + 1}`);
  }
  for (const o of others) {
    if (o === s || o.group === s.group) continue;
    if (s.y0 >= o.y1 || o.y0 >= s.y1) continue;
    if (shapesOverlap(shape, shapeOf(o))) out.push(`${s.id} clips ${o.id}`);
  }
  return out;
}

/**
 * Problems with a plan, as readable strings (empty when it's sound): stations overlapping each
 * other, the walls or an aisle, players' standing room blocked, doors too narrow or too tall for
 * their rooms, and any solid (furniture, chairs, plants, signs, the bar, columns) passing through
 * another, a station, a wall or a ceiling.
 */
export function checkLayout(plan: FloorPlan): string[] {
  const out: string[] = [];
  const PAD = 0.05;
  const boxes = plan.stations.map((s) => ({ s, poly: corners(s.x, s.z, s.fp.width + PAD, s.fp.depth + PAD, s.yaw) }));
  // an island's machines stand shoulder to shoulder on purpose: each is its slice of the island
  const island = new Map<string, number>();
  for (const isl of plan.machineIslands) for (const id of isl.ids) island.set(id, isl.n);
  const together = (a: string, b: string) => island.has(a) && island.get(a) === island.get(b);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    const r = plan.rooms.find((x) => x.id === a.s.room);
    const inner = r ? { x0: r.inner.x0 + WALL / 2, z0: r.inner.z0 + WALL / 2, x1: r.inner.x1 - WALL / 2, z1: r.inner.z1 - WALL / 2 } : plan.room;
    for (const [x, z] of a.poly) if (!inRect(inner, x, z, 0.01)) out.push(`${a.s.id} pokes through a wall`);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      if (overlaps(a.poly, b.poly) && !together(a.s.id, b.s.id)) out.push(`${a.s.id} overlaps ${b.s.id}`);
    }
    for (const [k, aisle] of plan.aisles.entries()) if (overlaps(a.poly, rectPoly(aisle))) out.push(`${a.s.id} stands in aisle ${k}`);
    const front = playerStrip(a.s);
    if (front) {
      for (const b of boxes) if (b !== a && overlaps(front, b.poly)) out.push(`${b.s.id} blocks the players of ${a.s.id}`);
      for (const [x, z] of front) if (!inRect(inner, x, z, 0.01)) out.push(`${a.s.id} has its players against a wall`);
    }
    if (STATION_H[a.s.zone] > ceilingAt(plan, a.s.x, a.s.z) - 0.05) out.push(`${a.s.id} is too tall for its ceiling`);
  }
  // doors: wide enough to walk through, under both rooms' ceilings, clear of the corners
  for (const d of plan.doors) {
    if (d.a1 - d.a0 < 1.4) out.push(`door ${d.id} is only ${(d.a1 - d.a0).toFixed(2)} m wide`);
    const sides = [d.a, d.b].filter((x): x is RoomId => x !== 'outside');
    for (const id of sides) {
      const r = plan.rooms.find((x) => x.id === id)!;
      if (d.height > r.style.ceiling - LINTEL + 0.001) out.push(`door ${d.id} is too tall for the ${r.name}`);
      const span: [number, number] = d.axis === 'x' ? [r.inner.x0, r.inner.x1] : [r.inner.z0, r.inner.z1];
      if (d.a0 < span[0] + 0.25 || d.a1 > span[1] - 0.25) out.push(`door ${d.id} runs into a corner of the ${r.name}`);
    }
  }
  // every solid against everything else (each pair once)
  plan.solids.forEach((s, i) => out.push(...clashes(plan, s, plan.solids.slice(i + 1))));
  return [...new Set(out)];
}
