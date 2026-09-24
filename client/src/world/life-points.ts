// Where the floor's life happens, for the people who walk it (the life4 module: sitting anywhere,
// the waiters, the bankers and the shopkeeper): every place to sit that isn't a table's seat, the
// bar's two sides and where a waiter picks up, the cashier's teller windows, the boutique's
// counter, cases and mannequins, and the waiters' loops. All of it comes from the floor plan, so
// when a room moves its points move with it.
//
// Metres; yaw is Object3D.rotation.y (0 faces +z, PI/2 faces +x).

import { BAR_TOP, STOOL, type FloorPlan } from './layout.ts';

export interface Seatable {
  /** Stable and unique, at most 40 characters of [a-z0-9._:-]; it goes over the wire. */
  id: string;
  /** The sitter's hip point, on the floor. */
  x: number;
  z: number;
  /** Which way the sitter faces. */
  yaw: number;
  /** The seat's top above the floor. */
  top: number;
  room: string;
  kind: 'chair' | 'stool' | 'sofa' | 'bench';
  /** An online lounge desk's chair: its PC station, which is only free while nobody plays it. */
  station?: string;
}

export interface Stand {
  x: number;
  z: number;
  yaw: number;
}

export interface Strip {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Which way someone in the strip faces the counter. */
  yaw: number;
}

export interface LifePoints {
  /** Every chair, stool, sofa place and bench place that isn't a table's own seat. */
  seats: Seatable[];
  bar: {
    /** Behind the counter, where the bartender works, facing the customers. */
    tender: Strip;
    /** In front of it, where customers stand or sit, facing the bar. */
    front: Strip;
    /** Where a waiter collects an order at the counter. */
    pickup: Stand;
    /** The counter's height. */
    top: number;
  };
  bank: { windows: { banker: Stand; customer: Stand }[] };
  boutique: { keeper: Stand; customer: Stand; cases: (Stand & { top: number })[]; mannequins: Stand[] } | null;
  /** Closed waiter loops: walk them in order and back to the first point; `pause` seconds at a stop. */
  routes?: { x: number; z: number; pause?: number }[][];
}

/**
 * The seats of the loose furniture, as the models stand on the floor (measured from the models;
 * world4.mjs checks them against the real geometry with a ray straight down at every seat).
 */
export const SEAT_TOPS = {
  /** A bar stool: stool.glb is scaled to STOOL.h and its top is the cushion. */
  barStool: STOOL.h,
  /** The lounge couch's cushion (couch.glb at COUCH.w long). */
  sofa: 0.375,
} as const;
/** The couch's three places along it, and how far forward of its middle a sitter's hips are. */
const SOFA_PLACES = [-0.62, 0, 0.62];
const SOFA_HIP = 0.1;

const round = (v: number) => Math.round(v * 1000) / 1000;

/** The floor's life points, from its plan. */
export function lifePoints(plan: FloorPlan): LifePoints {
  const seats: Seatable[] = [];
  const bar = plan.bar;

  // the bar's stools face the counter (+x)
  bar.stools.forEach((z, i) => seats.push({ id: `bar.stool.${i + 1}`, x: round(bar.stoolX), z: round(z), yaw: Math.PI / 2, top: SEAT_TOPS.barStool, room: 'bar', kind: 'stool' }));

  // the lounge: two couches facing each other across each coffee table (decor.ts places them)
  plan.loungeGroups.forEach((g, gi) => {
    for (const [k, side] of [-1, 1].entries()) {
      const cz = g.z + side * 1.25;
      // the couch north of the table faces +z (yaw 0), the one south of it faces -z (yaw PI)
      const yaw = side < 0 ? 0 : Math.PI;
      const fz = Math.cos(yaw);
      SOFA_PLACES.forEach((dx, p) => {
        const x = g.x + dx;
        seats.push({ id: `lounge.sofa.${gi + 1}${'ab'[k]}.${p + 1}`, x: round(x), z: round(cz + fz * SOFA_HIP), yaw, top: SEAT_TOPS.sofa, room: 'lounge', kind: 'sofa' });
      });
    }
  });

  // the bar: the bartender's side between the counter and the back bar, the customers' side
  // along the stools, and the pickup at the counter's south end, past the last stool
  // (clear of any video poker cabinet standing through the counter)
  const cabinets = plan.vpMode === 'floor' ? plan.stations.filter((s) => s.game === 'videopoker').map((s) => s.x + s.fp.depth / 2) : [];
  const tender: Strip = { x0: round(Math.max(bar.front + bar.depth + 0.25, ...cabinets.map((x) => x + 0.25))), x1: round(bar.back - 0.25), z0: round(bar.z0 + 0.45), z1: round(bar.z1 - 0.45), yaw: -Math.PI / 2 };
  const front: Strip = { x0: round(bar.stoolX - 0.55), x1: round(bar.front - 0.32), z0: round(bar.z0 + 0.3), z1: round(bar.z1 - 0.3), yaw: Math.PI / 2 };
  const lastStool = bar.stools.length ? bar.stools[bar.stools.length - 1]! : bar.z0;
  const pickup: Stand = { x: round(bar.front - 0.62), z: round(Math.min(bar.z1 - 0.2, lastStool + 0.62)), yaw: Math.PI / 2 };

  // the cashier's cage: a teller window a metre either side of where players stand (decor.ts)
  const c = plan.cashier;
  const windows = [c.x - 1.0, c.x + 1.0].map((x) => ({
    banker: { x: round(x), z: round(c.counter.z1 - 0.64 - 0.3), yaw: 0 },
    customer: { x: round(x), z: round(c.counter.z1 + 0.6), yaw: Math.PI },
  }));

  // one waiter loop: from the bar's pickup round the lounge's couch groups and back
  const routes: LifePoints['routes'] = [];
  if (plan.loungeGroups.length) {
    const L = plan.lounge;
    const east = round(L.x1 + 1.45);
    const west = round(L.x0 + 1.4);
    const inner = round(L.x1 - 0.95);
    const north = round(L.z0 - 0.7);
    const mid = plan.loungeGroups.length > 1 ? round((plan.loungeGroups[0]!.z + plan.loungeGroups[1]!.z) / 2) : round(plan.loungeGroups[0]!.z + 2.2);
    const back = round(Math.min(pickup.z - 0.65, L.z1 - 1.2));
    routes.push([
      { x: pickup.x, z: pickup.z, pause: 4 },
      { x: east, z: back },
      { x: east, z: north },
      { x: west, z: north },
      { x: west, z: mid, pause: 2 },
      { x: inner, z: mid, pause: 2 },
      { x: inner, z: back },
    ]);
  }

  return { seats, bar: { tender, front, pickup, top: BAR_TOP }, bank: { windows }, boutique: null, routes };
}

