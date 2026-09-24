// Where the floor's life happens, for the people who walk it (the life4 module: sitting anywhere,
// the waiters, the bankers and the shopkeeper): every place to sit that isn't a table's seat, the
// bar's two sides and where a waiter picks up, the cashier's teller windows, the boutique's
// counter, cases and mannequins, and the waiters' loops. All of it comes from the floor plan, so
// when a room moves its points move with it.
//
// Metres; yaw is Object3D.rotation.y (0 faces +z, PI/2 faces +x).

import { BAR_TOP, type FloorPlan, type PlacedFurniture } from './layout.ts';
import { FURNITURE, BAR_STOOL } from './furniture-spec.ts';
import { ROUTES } from './rooms.ts';
import { PC_SEAT, SEAT_TOP as PC_SEAT_TOP } from '../games/online/pc.ts';

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
  /**
   * The boutique: the shopkeeper behind the counter and the customer before it; where a customer
   * stands to look at each display case (with the case's height) and each mannequin (with the
   * piece the shop opens at).
   */
  boutique: { keeper: Stand; customer: Stand; cases: (Stand & { top: number })[]; mannequins: (Stand & { item?: string })[] } | null;
  /** Closed waiter loops: walk them in order and back to the first point; `pause` seconds at a stop. */
  routes?: { x: number; z: number; pause?: number }[][];
}

/**
 * The seats of the loose furniture, as the models stand on the floor (measured from the models;
 * world4.mjs checks them against the real geometry with a ray straight down at every seat).
 */
export const SEAT_TOPS = {
  /** A bar stool: stool.glb is scaled to STOOL.h and its top is the cushion. */
  barStool: BAR_STOOL.h,
  /** The lounge couch's cushion (couch.glb at COUCH.w long). */
  sofa: FURNITURE.sofa.top!,
  /** An online desk's gaming chair (games/online/pc.ts). */
  desk: PC_SEAT_TOP,
} as const;

const round = (v: number) => Math.round(v * 1000) / 1000;
const turnAngle = (a: number) => round(Math.atan2(Math.sin(a), Math.cos(a)));

/** A point in a piece's own frame, in world space. */
function at(f: { x: number; z: number; yaw: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  return [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
}

/** The floor's life points, from its plan. */
export function lifePoints(plan: FloorPlan): LifePoints {
  const seats: Seatable[] = [];
  const bar = plan.bar;

  // the bar's stools face the counter (+x)
  bar.stools.forEach((z, i) => seats.push({ id: `bar.stool.${i + 1}`, x: round(bar.stoolX), z: round(z), yaw: turnAngle(Math.PI / 2), top: SEAT_TOPS.barStool, room: 'bar', kind: 'stool' }));

  // the lounges' couch groups: two couches facing each other across each coffee table
  const groups = new Map<string, number>();
  plan.loungeGroups.forEach((g) => {
    const gi = (groups.get(g.room) ?? 0) + 1;
    groups.set(g.room, gi);
    for (const [k, side] of [-1, 1].entries()) {
      const cz = g.z + side * 1.25;
      // the couch north of the table faces +z (yaw 0), the one south of it faces -z (yaw PI)
      const yaw = side < 0 ? 0 : Math.PI;
      FURNITURE.sofa.seats!.forEach((s, p) => {
        const [x, z] = at({ x: g.x, z: cz, yaw }, s.x, s.z);
        seats.push({ id: `${g.room}.sofa.${gi}${'ab'[k]}.${p + 1}`, x: round(x), z: round(z), yaw: turnAngle(yaw), top: SEAT_TOPS.sofa, room: g.room, kind: 'sofa' });
      });
    }
  });

  // loose furniture with places to sit
  for (const f of plan.furniture) {
    const spec = FURNITURE[f.kind];
    if (!spec.seats || spec.top === undefined || !spec.seatKind) continue;
    const many = spec.seats.length > 1;
    spec.seats.forEach((s, p) => {
      const [x, z] = at(f, s.x, s.z);
      seats.push({ id: `${f.room}.${f.kind}.${f.n}${many ? `.${p + 1}` : ''}`, x: round(x), z: round(z), yaw: turnAngle(f.yaw + s.yaw), top: spec.top!, room: f.room, kind: spec.seatKind! });
    });
  }

  // the online lounge's gaming chairs, free while nobody plays at that desk
  for (const s of plan.stations) {
    if (s.zone !== 'online') continue;
    const [x, z] = at(s, PC_SEAT[0], PC_SEAT[2]);
    seats.push({ id: `${s.room}.desk.${s.id}`, x: round(x), z: round(z), yaw: turnAngle(s.yaw + Math.PI), top: SEAT_TOPS.desk, room: s.room, kind: 'chair', station: s.id });
  }

  // the bar: the bartender's side between the counter and the back bar, the customers' side
  // along the stools, and the pickup at the counter's south end, past the last stool
  // (clear of any video poker cabinet standing through the counter)
  const cabinets = plan.vpMode === 'floor' ? plan.stations.filter((s) => s.game === 'videopoker').map((s) => s.x + s.fp.depth / 2) : [];
  const tender: Strip = { x0: round(Math.max(bar.front + bar.depth + 0.25, ...cabinets.map((x) => x + 0.25))), x1: round(bar.back - 0.25), z0: round(bar.z0 + 0.45), z1: round(bar.z1 - 0.45), yaw: turnAngle(-Math.PI / 2) };
  const front: Strip = { x0: round(bar.stoolX - 0.55), x1: round(bar.front - 0.32), z0: round(bar.z0 + 0.3), z1: round(bar.z1 - 0.3), yaw: turnAngle(Math.PI / 2) };
  const pickup = barPickup(plan);

  // the cashier's cage: a banker behind each teller window, the customer before it
  const c = plan.cashier;
  const windows = c.windows.map((x) => ({
    banker: { x: round(x), z: round(c.counter.z1 - 0.64 - 0.3), yaw: 0 },
    customer: { x: round(x), z: round(c.counter.z1 + 0.6), yaw: turnAngle(Math.PI) },
  }));

  // the boutique
  let boutique: LifePoints['boutique'] = null;
  if (plan.boutique) {
    const room = plan.rooms.find((r) => r.id === 'boutique');
    const inside = (x: number, z: number) => !room || (x > room.inner.x0 + 0.35 && x < room.inner.x1 - 0.35 && z > room.inner.z0 + 0.35 && z < room.inner.z1 - 0.35);
    const view = (f: PlacedFurniture, gap: number): Stand => {
      // in front of it, facing it; from behind when its front faces out through the window
      for (const dir of [1, -1]) {
        const [x, z] = at(f, 0, dir * gap);
        if (inside(x, z)) return { x: round(x), z: round(z), yaw: turnAngle(f.yaw + (dir > 0 ? Math.PI : 0)) };
      }
      const [x, z] = at(f, 0, gap);
      return { x: round(x), z: round(z), yaw: turnAngle(f.yaw + Math.PI) };
    };
    const mid = room ? room.cz : 0;
    const cases = plan.furniture
      .filter((f) => f.kind === 'case' && f.room === 'boutique')
      .map((f) => {
        // from the side facing the middle of the shop, where the aisle is
        const toward = Math.sign(mid - f.z) || 1;
        const facing = Math.cos(f.yaw) >= 0 ? toward : -toward;
        const [x, z] = at(f, 0, facing * (FURNITURE.case.d / 2 + 0.45));
        return { x: round(x), z: round(z), yaw: turnAngle(f.yaw + (facing > 0 ? Math.PI : 0)), top: FURNITURE.case.h };
      });
    const mannequins = plan.furniture.filter((f) => f.kind === 'mannequin' && f.room === 'boutique').map((f) => ({ ...view(f, 0.95), item: f.wears?.item }));
    const b = plan.boutique;
    boutique = {
      keeper: { x: round(b.keeper.x), z: round(b.keeper.z), yaw: turnAngle(b.keeper.yaw) },
      customer: { x: round(b.customer.x), z: round(b.customer.z), yaw: turnAngle(b.customer.yaw) },
      cases,
      mannequins,
    };
  }

  // the waiters' loops (rooms.ts), the bar's starting at its pickup
  const routes: LifePoints['routes'] = ROUTES.map((route) =>
    route.map(([id, x, z, pause]) => {
      if (id === 'pickup') return { x: pickup.x, z: pickup.z, pause: pause ?? 4 };
      const r = plan.rooms.find((q) => q.id === id)!;
      return { x: round(r.cx + x), z: round(r.cz + z), ...(pause ? { pause } : {}) };
    }),
  );

  return { seats, bar: { tender, front, pickup, top: BAR_TOP }, bank: { windows }, boutique, routes };
}

/** Where a waiter picks up at the bar: the counter's south end, just past the last stool. */
export function barPickup(plan: FloorPlan): Stand {
  const bar = plan.bar;
  const lastStool = bar.stools.length ? bar.stools[bar.stools.length - 1]! : bar.z0;
  return { x: round(bar.front - 0.62), z: round(Math.min(bar.z1 - 0.2, lastStool + 0.62)), yaw: turnAngle(Math.PI / 2) };
}
