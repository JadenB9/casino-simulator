// The casino as data: its rooms, the doors between them, and what stands in each. Everything the
// floor builds is placed from here (layout.ts turns it into world space, checks it and fits the
// plants round it; room.ts, decor.ts and furniture.ts draw it). Adding a table, a machine, a sofa
// or a whole room is an edit to this file; README.md ("How to add a station / a room") walks
// through it, and client/test/world-layout.test.ts checks that nothing overlaps and everything can
// be walked to.
//
// Coordinates: metres, +x east, +z south (the entrance is on the south wall), y up. A room's
// bounds are the centre lines of its walls; everything inside a room is placed in room-local
// coordinates, measured from the middle of its bounds (world = local + centre). A yaw is
// Object3D.rotation.y: a station's players stand on its local +z side, so yaw 0 puts them south
// of it and PI north of it; a seat's yaw is the way its sitter faces.

import type { GameId } from '../../../shared/src/engine.ts';

export type RoomId = 'lobby' | 'pit' | 'slots' | 'bar' | 'lounge' | 'poker' | 'salon' | 'online' | 'yard' | 'bank' | 'boutique';

export interface RoomStyle {
  /** Floor material (materials.ts) and the metres one texture repeat covers. */
  floor: string;
  floorUv: number;
  /** The wall above the wainscot, the wainscot (null: the wall runs to the floor), the chair rail and crown. */
  wall: string;
  wainscot: string | null;
  rail: string;
  /** Ceiling height and material; a tray is a raised middle washed by a hidden cove. */
  ceiling: number;
  ceilingMat: string;
  kind: 'panels' | 'tray' | 'coffer' | 'truss';
  /** Recessed downlights on this pitch (0: none), and the cove's glow (lighting.ts GLOW), if any. */
  downlights: number;
  cove: 'warm' | 'cool' | 'neon' | 'amber' | null;
  /** The hemisphere light while you're in this room: its sky and ground colours and strength. */
  ambient: { sky: string; ground: string; k: number };
}

/** A station placed on its own. */
export interface StationItem {
  kind: 'station';
  id: string;
  game: GameId;
  variant?: string;
  x: number;
  z: number;
  yaw: number;
  /** High-limit tables open at a higher tier of limits by default. */
  tier?: 'high';
}

/**
 * Tables in a row, spaced by their real size (the table and the chairs round it) with `gap`
 * between neighbours, centred on (x, z), players on the side `yaw` faces.
 */
export interface RowItem {
  kind: 'row';
  x: number;
  z: number;
  yaw: number;
  gap: number;
  tier?: 'high';
  items: { id: string; game: GameId; variant?: string }[];
}

/**
 * Slot islands on a grid: `cols` x `rows` centres, one island per variant in the list (the floor's
 * own list when this is `'catalogue'`), machines back to back facing north and south.
 */
export interface IslandsItem {
  kind: 'islands';
  cols: number[];
  rows: number[];
}

/**
 * Online desks: islands of desks back to back (monitors meeting in the middle, chairs outside),
 * `per` desks a row. Each game gets two desks side by side.
 */
export interface DesksItem {
  kind: 'desks';
  islands: { x: number; z: number }[];
  per: number;
  pitch: number;
  games: GameId[];
}

export type StationSpec = StationItem | RowItem | IslandsItem | DesksItem;

/** Loose furniture: every one of them is also solid, and those with seats are in the life points. */
export type FurnitureKind =
  | 'sofa'
  | 'armchair'
  | 'tub'
  | 'bench'
  | 'banquette'
  | 'hightop'
  | 'coffee'
  | 'side'
  | 'case'
  | 'mannequin'
  | 'crate'
  | 'barrel'
  | 'pallets'
  | 'scrap'
  | 'workbench'
  | 'drum-fire'
  | 'plank-bench'
  | 'directory'
  | 'podium'
  | 'lamp'
  | 'palm';

export interface FurnitureItem {
  kind: FurnitureKind;
  x: number;
  z: number;
  yaw: number;
  /** A mannequin's look: the shop items it wears; `item` is the piece the boutique opens at. */
  wears?: { body: 'm' | 'f'; outfit: string; clothes?: string; chain?: string; grill?: string; watch?: string; hat?: string; shades?: string; item: string };
  /** A palm's height (fitted to the ceiling when left out). */
  size?: number;
}

/** A built-in fixture with its own builder in decor.ts. */
export type FixtureItem =
  /** The bar along a wall: counter, back bar, video poker set into the counter's north end. */
  | { kind: 'bar'; z0: number; z1: number; vp: number }
  /** The cashier's cage along the north wall with its teller windows (x of each). */
  | { kind: 'cage'; depth: number; windows: number[] }
  /** The boutique's counter (a rect) and the wall of shelves behind it. */
  | { kind: 'counter'; x0: number; x1: number; z0: number; z1: number }
  /** Two sofas facing each other across a coffee table, a floor lamp at each end. */
  | { kind: 'sofas'; x: number; z: number }
  /** A fireplace set into the east wall. */
  | { kind: 'fireplace'; z: number }
  /** The pit's podium in the middle of the staff area. */
  | { kind: 'pit-podium' }
  /** A big neon sign on a wall (room-local point on the wall face, facing into the room). */
  | { kind: 'neon'; text: string; color: string; x: number; y: number; z: number; ry: number; w: number; h: number; font?: 'Tilt Neon' | 'Limelight' | 'Cinzel' }
  /** The vault door in the bank's back wall. */
  | { kind: 'vault'; x: number }
  /** Lamps hanging low over each poker table. */
  | { kind: 'table-lamps' }
  /** Work lamps and a string of bulbs over the yard. */
  | { kind: 'festoon'; from: [number, number]; to: [number, number] };

/** A sign box hung from the ceiling: its text (or wayfinding segments), both faces. */
export interface HangItem {
  id: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  w: number;
  h: number;
  kind: 'lit' | 'neon' | 'way';
  text?: string;
  color?: string;
  front?: { text: string; arrow: 'left' | 'right' | 'up' | 'down'; before?: boolean }[];
  back?: { text: string; arrow: 'left' | 'right' | 'up' | 'down'; before?: boolean }[];
}

/** A spot on High, room-local: where it hangs and what it lights. */
export interface SpotItem {
  x: number;
  z: number;
  tx: number;
  tz: number;
  k: number;
  angle: number;
  /** The light's colour (default: the warm incandescent the other rooms share). */
  color?: string;
}

export interface RoomSpec {
  id: RoomId;
  /** What the map and the directory call it, and the words over its doors. */
  name: string;
  sign: string;
  /** What else is there, for the map and the directory (its games are listed from its stations). */
  about?: string;
  /** The centre lines of its walls. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  style: RoomStyle;
  stations: StationSpec[];
  furniture: FurnitureItem[];
  fixtures: FixtureItem[];
  hanging: HangItem[];
  spots: SpotItem[];
  /** Walkways kept clear (room-local): nothing standing on the floor may be put in them. */
  aisles: { x0: number; z0: number; x1: number; z1: number }[];
  /** Plants for the corners, where they fit (room-local points, pushed against the walls). */
  plants: [number, number][];
}

export type DoorKind = 'entrance' | 'grand' | 'portal' | 'arch' | 'shopfront' | 'industrial';

export interface DoorSpec {
  id: string;
  /** The rooms either side ('outside' for the street). */
  a: RoomId;
  b: RoomId | 'outside';
  /** Where along the shared wall its middle is (world x for a wall running east-west, world z otherwise). */
  at: number;
  width: number;
  height: number;
  kind: DoorKind;
}

// --- styles --------------------------------------------------------------------------------------

const WARM = { sky: '#ffd6a6', ground: '#3a1810', k: 1.35 };

const PIT: RoomStyle = { floor: 'carpet', floorUv: 3.2, wall: 'wall', wainscot: 'wainscot', rail: 'brass', ceiling: 3.4, ceilingMat: 'ceiling', kind: 'coffer', downlights: 2.4, cove: 'warm', ambient: WARM };

export const ROOMS: RoomSpec[] = [
  // --- the lobby: the doors, marble, the directory, and the grand opening to the pit ---------------
  {
    id: 'lobby',
    name: 'Lobby',
    sign: 'LOBBY',
    about: 'The doors, the directory, the way to everything',
    x0: -7,
    z0: 3,
    x1: 7,
    z1: 15,
    style: { floor: 'marble-floor', floorUv: 2.4, wall: 'wall', wainscot: 'wainscot', rail: 'brass', ceiling: 5.0, ceilingMat: 'ceiling', kind: 'tray', downlights: 0, cove: 'warm', ambient: { sky: '#ffe2b8', ground: '#3a2016', k: 1.45 } },
    stations: [],
    furniture: [
      // the directory stands between the ways to the cashier and to the pit, facing the doors: in
      // view as you come in, clear of the palms' fronds and of anyone's path
      { kind: 'directory', x: -3.6, z: -0.3, yaw: 0.72 },
      { kind: 'bench', x: -6.2, z: -3.3, yaw: Math.PI / 2 },
      { kind: 'bench', x: 6.2, z: -3.3, yaw: -Math.PI / 2 },
      { kind: 'palm', x: -3.6, z: 4.8, yaw: 0 },
      { kind: 'palm', x: 3.6, z: 4.8, yaw: 0 },
    ],
    fixtures: [],
    hanging: [],
    spots: [],
    // the runner from the doors to the compass rose, and on from it to the pit
    aisles: [
      { x0: -2.2, z0: -5.85, x1: 2.2, z1: -1.7 },
      { x0: -2.2, z0: 1.7, x1: 2.2, z1: 5.85 },
    ],
    plants: [
      [-6.4, 5.4],
      [6.4, 5.4],
    ],
  },

  // --- the pit: table games in two rows round the staff area, under the coffered ceiling ------------
  {
    id: 'pit',
    name: 'The Pit',
    sign: 'TABLE GAMES',
    about: 'Table games under the chandeliers',
    x0: -13,
    z0: -19,
    x1: 13,
    z1: 3,
    style: PIT,
    stations: [
      {
        kind: 'row',
        x: 0,
        z: -6.6,
        yaw: Math.PI,
        gap: 1.5,
        // the dice games share the middle of the north row, the roulettes its ends
        items: [
          { id: 'rl-us', game: 'roulette', variant: 'american' },
          { id: 'cr-1', game: 'craps' },
          { id: 'sb-1', game: 'sicbo' },
          { id: 'rl-eu', game: 'roulette', variant: 'european' },
        ],
      },
      {
        kind: 'row',
        x: 0,
        z: -2.55,
        yaw: 0,
        gap: 1.1,
        // Casino War mid-row, facing the lobby
        items: [
          { id: 'bj-1', game: 'blackjack' },
          { id: 'bc-1', game: 'baccarat' },
          { id: 'wr-1', game: 'war' },
          { id: 'tc-1', game: 'threecard' },
          { id: 'bj-2', game: 'blackjack' },
        ],
      },
      // the Big Six stands about 3 m tall against the west wall, facing the main aisle
      { kind: 'station', id: 'b6-1', game: 'bigsix', x: -11.55, z: 6.2, yaw: Math.PI / 2 },
    ],
    furniture: [{ kind: 'banquette', x: 8.4, z: 6.3, yaw: 0 }],
    fixtures: [{ kind: 'pit-podium' }],
    hanging: [
      { id: 'table-games', x: 0, y: 2.96, z: -0.15, ry: 0, w: 4.6, h: 0.6, kind: 'lit', text: 'TABLE GAMES', color: '#ffe0a0' },
    ],
    spots: [],
    aisles: [
      // the cross aisle between the side arches, and the main aisle from the lobby
      { x0: -12.85, z0: 0.1, x1: 12.85, z1: 2.8 },
      { x0: -2.1, z0: 2.8, x1: 2.1, z1: 10.85 },
      // the north aisle behind the north row's players, to the salon, poker room and lounge doors
      { x0: -12.85, z0: -10.85, x1: 12.85, z1: -9.9 },
    ],
    plants: [
      [-12.3, 10.3],
      [12.3, 10.3],
    ],
  },

  // --- the slots hall: twelve islands, two for each machine, round a main aisle ------------------------
  {
    id: 'slots',
    name: 'Slots Hall',
    sign: 'SLOTS',
    about: 'Twelve islands of machines',
    x0: -31,
    z0: -19,
    x1: -13,
    z1: 3,
    style: { floor: 'carpet-slots', floorUv: 3.2, wall: 'wall', wainscot: 'wainscot', rail: 'brass', ceiling: 3.4, ceilingMat: 'ceiling', kind: 'panels', downlights: 2.4, cove: 'neon', ambient: { sky: '#ffd0b4', ground: '#2a1024', k: 1.3 } },
    stations: [{ kind: 'islands', cols: [-6.1, -2.3, 1.5, 5.3], rows: [-7.3, -2.1, 5.6] }],
    furniture: [],
    fixtures: [],
    hanging: [],
    spots: [],
    aisles: [
      // the main aisle from the pit's arch, and the lane between the door to the online lounge and the yard's
      { x0: -8.85, z0: 0.05, x1: 8.85, z1: 3.5 },
      { x0: -1.0, z0: -10.85, x1: 0.2, z1: 10.85 },
    ],
    plants: [
      [-8.4, -10.4],
      [8.4, -10.4],
      [-8.4, 10.4],
      [8.4, 10.4],
    ],
  },

  // --- the bar: the counter along the east wall with video poker in it, high-tops across the room ------
  {
    id: 'bar',
    name: 'Bar',
    sign: 'BAR & LOUNGE',
    about: 'Cocktails, food and high-tops; video poker at the counter',
    x0: 13,
    z0: -19,
    x1: 31,
    z1: 3,
    style: { floor: 'floor-wood', floorUv: 2.2, wall: 'wall-bar', wainscot: 'wainscot', rail: 'brass', ceiling: 3.8, ceilingMat: 'ceiling', kind: 'panels', downlights: 2.6, cove: 'amber', ambient: { sky: '#ffcf9a', ground: '#2c140c', k: 1.3 } },
    stations: [],
    furniture: [
      { kind: 'hightop', x: -5.6, z: -7.6, yaw: 0 },
      { kind: 'hightop', x: -2.0, z: -7.6, yaw: 0.5 },
      { kind: 'hightop', x: -5.6, z: -3.5, yaw: 0.3 },
      { kind: 'hightop', x: -2.0, z: -3.5, yaw: 0.9 },
      { kind: 'hightop', x: -5.6, z: 6.2, yaw: 0.6 },
      { kind: 'hightop', x: -2.0, z: 6.2, yaw: 0.1 },
    ],
    fixtures: [{ kind: 'bar', z0: -9.4, z1: 7.4, vp: 4 }],
    hanging: [],
    spots: [],
    aisles: [
      // from the pit's arch to the counter, on to the lounge, and from the poker room's door
      { x0: -8.85, z0: -0.4, x1: 4.2, z1: 3.4 },
      { x0: -0.5, z0: 3.4, x1: 3.8, z1: 10.85 },
      { x0: -0.7, z0: -10.85, x1: 1.7, z1: -8.8 },
    ],
    plants: [
      [-8.4, -10.4],
      [-8.4, 10.4],
      [7.9, 10.4],
    ],
  },

  // --- the lounge: sofas round coffee tables, armchairs by the fire ----------------------------------
  {
    id: 'lounge',
    name: 'Lounge',
    sign: 'LOUNGE',
    about: 'Sofas and armchairs by the fire',
    x0: 17,
    z0: 3,
    x1: 31,
    z1: 15,
    style: { floor: 'carpet-lounge', floorUv: 2.8, wall: 'wall-bar', wainscot: 'wainscot', rail: 'brass', ceiling: 3.4, ceilingMat: 'ceiling', kind: 'tray', downlights: 0, cove: 'amber', ambient: { sky: '#ffc890', ground: '#2a120a', k: 1.25 } },
    stations: [],
    furniture: [
      { kind: 'armchair', x: -6.0, z: -0.6, yaw: Math.PI / 2 },
      { kind: 'armchair', x: 4.2, z: -2.8, yaw: Math.PI / 2 },
      { kind: 'armchair', x: 4.2, z: -0.4, yaw: Math.PI / 2 },
      { kind: 'side', x: 4.3, z: -1.6, yaw: 0 },
      { kind: 'armchair', x: -1.2, z: 4.9, yaw: Math.PI },
      { kind: 'armchair', x: 0.6, z: 4.9, yaw: Math.PI },
      { kind: 'side', x: -0.3, z: 5.1, yaw: 0 },
    ],
    fixtures: [
      { kind: 'sofas', x: -3.3, z: -0.6 },
      { kind: 'sofas', x: 3.0, z: 2.6 },
      { kind: 'fireplace', z: -1.6 },
    ],
    hanging: [],
    spots: [],
    aisles: [{ x0: -2.2, z0: -5.85, x1: 2.2, z1: -4.8 }],
    plants: [
      [-6.4, 5.4],
      [6.4, 5.4],
      [6.4, -5.4],
    ],
  },

  // --- the poker room: four Hold'em tables, lamps low over each -------------------------------------
  {
    id: 'poker',
    name: 'Poker Room',
    sign: 'POKER ROOM',
    about: "Four Hold'em tables",
    x0: 9,
    z0: -31,
    x1: 31,
    z1: -19,
    style: { floor: 'carpet-poker', floorUv: 2.4, wall: 'wall-navy', wainscot: 'wainscot', rail: 'brass', ceiling: 3.6, ceilingMat: 'ceiling', kind: 'tray', downlights: 0, cove: 'warm', ambient: { sky: '#ffd8b0', ground: '#101830', k: 1.2 } },
    stations: [
      { kind: 'station', id: 'he-1', game: 'holdem', x: -5.2, z: -2.4, yaw: 0 },
      { kind: 'station', id: 'he-2', game: 'holdem', x: 5.2, z: -2.4, yaw: 0 },
      { kind: 'station', id: 'he-3', game: 'holdem', x: -5.2, z: 2.3, yaw: 0 },
      { kind: 'station', id: 'he-4', game: 'holdem', x: 5.2, z: 2.3, yaw: 0 },
    ],
    furniture: [
      { kind: 'podium', x: -10.3, z: 0.1, yaw: Math.PI / 2 },
      { kind: 'armchair', x: 10.0, z: -1.1, yaw: -Math.PI / 2 },
      { kind: 'armchair', x: 10.0, z: 1.1, yaw: -Math.PI / 2 },
      { kind: 'side', x: 10.1, z: 0, yaw: 0 },
    ],
    fixtures: [{ kind: 'table-lamps' }],
    hanging: [],
    spots: [{ x: 0, z: 0, tx: 0, tz: 0, k: 31, angle: 1.05 }],
    aisles: [],
    plants: [
      [-10.4, -5.4],
      [10.4, -5.4],
    ],
  },

  // --- the high limit salon: three premium tables, plush chairs, chandeliers ------------------------
  {
    id: 'salon',
    name: 'High Limit Salon',
    sign: 'HIGH LIMIT SALON',
    about: 'Premium tables at high limits',
    x0: -9,
    z0: -31,
    x1: 9,
    z1: -19,
    style: { floor: 'carpet-salon', floorUv: 2.6, wall: 'wall-salon', wainscot: 'wainscot', rail: 'brass', ceiling: 4.2, ceilingMat: 'ceiling', kind: 'tray', downlights: 0, cove: 'warm', ambient: { sky: '#ffe2b8', ground: '#0e1c12', k: 1.3 } },
    stations: [
      {
        kind: 'row',
        x: 0,
        z: -2.3,
        yaw: 0,
        gap: 2.0,
        tier: 'high',
        items: [
          { id: 'vip-bj-1', game: 'blackjack' },
          { id: 'vip-bc-1', game: 'baccarat' },
          { id: 'vip-rl-1', game: 'roulette', variant: 'european' },
        ],
      },
    ],
    furniture: [
      { kind: 'tub', x: -7.8, z: 3.5, yaw: Math.PI / 2 },
      { kind: 'tub', x: -6.4, z: 4.9, yaw: Math.PI },
      { kind: 'side', x: -7.7, z: 4.8, yaw: 0 },
      { kind: 'tub', x: 7.8, z: 3.5, yaw: -Math.PI / 2 },
      { kind: 'tub', x: 6.4, z: 4.9, yaw: Math.PI },
      { kind: 'side', x: 7.7, z: 4.8, yaw: 0 },
    ],
    fixtures: [{ kind: 'neon', text: 'HIGH LIMIT', color: '#f2c86a', x: 0, y: 2.75, z: -5.85, ry: 0, w: 3.4, h: 0.5, font: 'Cinzel' }],
    hanging: [],
    spots: [{ x: 0, z: -1.0, tx: 0, tz: -1.5, k: 28, angle: 1.1 }],
    aisles: [{ x0: -1.9, z0: 3.4, x1: 1.9, z1: 5.85 }],
    plants: [
      [-8.4, -5.4],
      [8.4, -5.4],
    ],
  },

  // --- the online lounge: sixteen desks, two for each House Original --------------------------------
  {
    id: 'online',
    name: 'Online Lounge',
    sign: 'ONLINE LOUNGE',
    about: 'The House Originals on sixteen computers',
    x0: -31,
    z0: -31,
    x1: -9,
    z1: -19,
    // A gaming cafe: the neon and the screens set the mood, but the floor between the desks and
    // the walls must still read (a cool fill, lifted off black, and a cool spot over each island).
    style: { floor: 'carpet-online', floorUv: 2.0, wall: 'wall-dark', wainscot: null, rail: 'chrome', ceiling: 3.2, ceilingMat: 'ceiling-dark', kind: 'panels', downlights: 0, cove: 'cool', ambient: { sky: '#b8c2ff', ground: '#2e2250', k: 1.6 } },
    stations: [
      {
        kind: 'desks',
        islands: [
          { x: -4.6, z: -0.6 },
          { x: 4.6, z: -0.6 },
        ],
        per: 4,
        pitch: 1.3,
        games: ['plinko', 'tower', 'mines', 'dice', 'limbo', 'keno', 'hilo', 'crash'],
      },
    ],
    furniture: [{ kind: 'sofa', x: 3.2, z: 5.05, yaw: Math.PI }],
    fixtures: [{ kind: 'neon', text: 'HOUSE ORIGINALS', color: '#1fe07e', x: 0, y: 2.35, z: -5.85, ry: 0, w: 5.4, h: 0.62, font: 'Tilt Neon' }],
    hanging: [],
    spots: [
      { x: -4.6, z: 0.6, tx: -4.6, tz: -0.6, k: 22, angle: 1.0, color: '#cfdcff' },
      { x: 4.6, z: 0.6, tx: 4.6, tz: -0.6, k: 22, angle: 1.0, color: '#cfdcff' },
    ],
    aisles: [],
    plants: [
      [-10.4, 5.4],
      [10.4, -5.4],
    ],
  },

  // --- the Bandit Camp: the Bandit Wheel in a yard of scrap and timber ---------------------------------
  {
    id: 'yard',
    name: 'Bandit Camp',
    sign: 'BANDIT CAMP',
    about: 'The Bandit Wheel in a yard of scrap and timber',
    x0: -31,
    z0: 3,
    x1: -17,
    z1: 15,
    style: { floor: 'concrete', floorUv: 3.0, wall: 'corrugated', wainscot: null, rail: 'steel', ceiling: 5.0, ceilingMat: 'ceiling-dark', kind: 'truss', downlights: 0, cove: null, ambient: { sky: '#ffbe84', ground: '#1c120c', k: 1.15 } },
    stations: [{ kind: 'station', id: 'bw-1', game: 'banditwheel', x: 0.6, z: 3.85, yaw: Math.PI }],
    furniture: [
      { kind: 'pallets', x: -6.0, z: 2.6, yaw: 0.1 },
      { kind: 'barrel', x: -6.2, z: 4.9, yaw: 0 },
      { kind: 'barrel', x: -5.5, z: 5.2, yaw: 1 },
      { kind: 'drum-fire', x: -5.4, z: -2.2, yaw: 0 },
      { kind: 'crate', x: -4.5, z: -3.6, yaw: 0.3 },
      { kind: 'crate', x: -3.4, z: -2.2, yaw: -0.4 },
      { kind: 'workbench', x: -6.1, z: -0.2, yaw: Math.PI / 2 },
      { kind: 'scrap', x: 5.4, z: -4.5, yaw: 0.4 },
      { kind: 'plank-bench', x: 6.2, z: -1.4, yaw: -Math.PI / 2 },
      { kind: 'crate', x: 5.9, z: 1.7, yaw: 0.2 },
      { kind: 'barrel', x: 6.1, z: 5.2, yaw: 0 },
    ],
    fixtures: [{ kind: 'festoon', from: [-6.4, -4.4], to: [6.4, 1.6] }],
    hanging: [],
    spots: [],
    aisles: [],
    plants: [],
  },

  // --- the cashier and the bank: the cage along the north wall, three teller windows ------------------
  {
    id: 'bank',
    name: 'Cashier & Bank',
    sign: 'CASHIER',
    about: 'Three teller windows: your balance and loans',
    x0: -17,
    z0: 3,
    x1: -7,
    z1: 15,
    style: { floor: 'marble-floor', floorUv: 2.4, wall: 'wall', wainscot: 'wainscot', rail: 'brass', ceiling: 3.4, ceilingMat: 'ceiling', kind: 'panels', downlights: 2.2, cove: null, ambient: { sky: '#ffe0b4', ground: '#34180e', k: 1.4 } },
    stations: [],
    furniture: [
      { kind: 'bench', x: -2.3, z: 5.35, yaw: Math.PI },
      { kind: 'bench', x: 2.3, z: 5.35, yaw: Math.PI },
    ],
    fixtures: [
      { kind: 'cage', depth: 2.4, windows: [-2.6, 0, 2.6] },
      { kind: 'vault', x: 0 },
    ],
    hanging: [],
    spots: [],
    aisles: [],
    plants: [
      [-4.4, 5.4],
      [4.4, 5.4],
    ],
  },

  // --- the boutique: a storefront on the lobby, cases, mannequins, the counter ------------------------
  {
    id: 'boutique',
    name: 'Boutique',
    sign: 'THE BOUTIQUE',
    about: 'Chains, grills, watches and clothes',
    x0: 7,
    z0: 3,
    x1: 17,
    z1: 15,
    style: { floor: 'marble-light', floorUv: 2.0, wall: 'wall-cream', wainscot: null, rail: 'brass', ceiling: 3.6, ceilingMat: 'ceiling-light', kind: 'tray', downlights: 1.8, cove: 'warm', ambient: { sky: '#fff0dc', ground: '#4a3426', k: 1.7 } },
    stations: [],
    furniture: [
      { kind: 'mannequin', x: -3.8, z: -3.1, yaw: -Math.PI / 2, wears: { body: 'm', outfit: 'suit', clothes: 'white-tuxedo', chain: 'cuban-link', grill: 'full-gold', item: 'white-tuxedo' } },
      { kind: 'mannequin', x: -3.8, z: 4.1, yaw: -Math.PI / 2, wears: { body: 'f', outfit: 'dress', clothes: 'fur-coat', chain: 'iced-cuban', shades: 'gold-aviators', item: 'fur-coat' } },
      { kind: 'mannequin', x: 0.9, z: -5.05, yaw: 0, wears: { body: 'm', outfit: 'suit', chain: 'dice-pendant', grill: 'diamond-set', watch: 'iced-watch', shades: 'gold-aviators', item: 'dice-pendant' } },
      { kind: 'mannequin', x: 0.9, z: 5.05, yaw: Math.PI, wears: { body: 'm', outfit: 'suit', clothes: 'velvet-jacket', chain: 'ace-pendant', watch: 'iced-watch', hat: 'black-fedora', item: 'velvet-jacket' } },
      { kind: 'case', x: -0.9, z: -2.4, yaw: 0 },
      { kind: 'case', x: -0.9, z: 3.4, yaw: 0 },
      { kind: 'armchair', x: -2.4, z: 5.0, yaw: Math.PI },
    ],
    fixtures: [{ kind: 'counter', x0: 2.55, x1: 3.25, z0: -2.0, z1: 3.0 }],
    // over the counter, so the way to buy is plain from the door
    hanging: [{ id: 'boutique-counter', x: 2.05, y: 2.62, z: 0.5, ry: -Math.PI / 2, w: 2.6, h: 0.42, kind: 'lit', text: 'PURCHASES & FITTINGS', color: '#ffe6b8' }],
    spots: [],
    aisles: [{ x0: -4.85, z0: -0.7, x1: 2.4, z1: 1.7 }],
    plants: [],
  },
];

export const DOORS: DoorSpec[] = [
  { id: 'entrance', a: 'lobby', b: 'outside', at: 0, width: 2.6, height: 2.9, kind: 'entrance' },
  { id: 'lobby-pit', a: 'lobby', b: 'pit', at: 0, width: 8, height: 3.2, kind: 'grand' },
  { id: 'lobby-bank', a: 'lobby', b: 'bank', at: 9.5, width: 2.4, height: 2.8, kind: 'portal' },
  { id: 'lobby-boutique', a: 'lobby', b: 'boutique', at: 9.5, width: 2.2, height: 2.7, kind: 'shopfront' },
  { id: 'pit-slots', a: 'pit', b: 'slots', at: -6.4, width: 4.2, height: 3.1, kind: 'arch' },
  { id: 'pit-bar', a: 'pit', b: 'bar', at: -6.4, width: 4.2, height: 3.1, kind: 'arch' },
  { id: 'pit-salon', a: 'pit', b: 'salon', at: 0, width: 3.2, height: 3.0, kind: 'portal' },
  { id: 'pit-online', a: 'pit', b: 'online', at: -11, width: 2.0, height: 2.7, kind: 'portal' },
  { id: 'pit-poker', a: 'pit', b: 'poker', at: 11, width: 2.0, height: 2.8, kind: 'portal' },
  { id: 'slots-online', a: 'slots', b: 'online', at: -22.4, width: 2.4, height: 2.7, kind: 'portal' },
  { id: 'slots-yard', a: 'slots', b: 'yard', at: -22.4, width: 3.4, height: 3.0, kind: 'industrial' },
  { id: 'bar-poker', a: 'bar', b: 'poker', at: 22.5, width: 2.4, height: 2.8, kind: 'portal' },
  { id: 'bar-lounge', a: 'bar', b: 'lounge', at: 24, width: 5.0, height: 3.0, kind: 'arch' },
];

/** The ceiling heights doors must clear: the lower of the two rooms', less a lintel. */
export const LINTEL = 0.2;

/**
 * The waiters' loops, closed (the last point walks back to the first): each point a room and a
 * room-local spot, with an optional pause in seconds; 'pickup' is the bar's pickup at the counter.
 */
export const ROUTES: [RoomId | 'pickup', number, number, number?][][] = [
  // the bar and the lounge: from the pickup into the lounge between its couch groups, back out,
  // then between the high-tops and round to the counter again
  [
    ['pickup', 0, 0],
    ['bar', 2.4, 8.6],
    ['lounge', 0, -4.8],
    ['lounge', 0.9, -0.4, 3],
    ['lounge', -0.1, 2.3, 3],
    ['lounge', 0, -4.6],
    ['bar', 1.4, 7.8],
    ['bar', 0.2, 4.4],
    ['bar', -3.8, 4.2, 2],
    ['bar', -3.8, -5.5, 2],
    ['bar', -0.2, -5.5],
    ['bar', 1.0, -1.6],
    ['bar', 2.6, 6.4],
  ],
  // the pit: in through the bar's arch, along the cross aisle, up the west side, along behind the
  // north row's players and back down the east side
  [
    ['bar', -7.5, 1.6],
    ['pit', 11.6, 1.2],
    ['pit', 0, 1.2, 2],
    ['pit', -11.6, 1.2],
    ['pit', -11.6, -9.4],
    ['pit', 0, -9.4, 2],
    ['pit', 11.6, -9.4],
    ['pit', 11.8, 0.9],
  ],
  // the salon, from the pit's north aisle
  [
    ['pit', 0, -9.6],
    ['salon', 0, 4.6],
    ['salon', -5.6, 1.2, 3],
    ['salon', 5.6, 1.2, 3],
    ['salon', 0.6, 4.6],
  ],
  // the poker room, from the bar's north door, round between its two rows of tables
  [
    ['bar', 0.5, -9.4],
    ['poker', 2.5, 4.9],
    ['poker', 0, 0, 2],
    ['poker', -8.4, 0, 2],
    ['poker', -8.4, 4.9],
    ['poker', 2.3, 5.0],
  ],
  // the slots hall: along the main aisle and up and down the lane between the islands
  [
    ['slots', 8.0, 1.6],
    ['slots', -0.4, 1.6],
    ['slots', -0.4, -9.9, 2],
    ['slots', -0.4, 9.7, 2],
    ['slots', -0.4, 2.2],
    ['slots', 8.0, 2.2],
  ],
];
