// The floor's security: a pit boss and four guards, each on a fixed loop through the casino. Where
// one of them stands and which way he faces is a pure function of the time, so the server (which
// decides what they see) and every client (which draws them) agree without a word on the wire.
// Only a detour is news: a guard or the pit boss leaving his loop to have a word with someone, or
// to walk them out. It is a handful of numbers, and the same function places him on it.
//
// Units are metres and radians (a yaw is a character's rotation.y: it faces (sin yaw, cos yaw)),
// and times are server milliseconds. Every leg of every loop is walkable on the floor plan
// (client/test/law-plan.test.ts walks them).

export type StaffId = 'boss' | 'g1' | 'g2' | 'g3' | 'g4';
export const STAFF_IDS: readonly StaffId[] = ['boss', 'g1', 'g2', 'g3', 'g4'];

/** A point on a loop. With `wait` he stops there that many seconds, facing `face` and looking round by `sweep`. */
export interface Stop {
  x: number;
  z: number;
  wait?: number;
  face?: number;
  sweep?: number;
}

export interface StaffSpec {
  id: StaffId;
  kind: 'boss' | 'guard';
  /** What the speech bubble and the toasts call him. */
  name: string;
  /** Walking pace on the loop, m/s. */
  speed: number;
  /** Where on his loop he is at time 0, in ms (so the guards don't all stop at once). */
  offset: number;
  route: readonly Stop[];
  /** How far he sees (m) and how wide: half the cone's angle (radians). */
  range: number;
  half: number;
}

export interface Pose {
  x: number;
  z: number;
  yaw: number;
  moving: boolean;
  /** Off his loop on a detour: talking, or walking to or from someone. He watches nobody else meanwhile. */
  busy: boolean;
}

/** A detour off the loop: walk to (x, z) in `go` ms, talk until `until - back`, walk back in `back` ms. */
export interface Detour {
  staff: StaffId;
  /** Who he goes to (an account id). */
  who: number;
  kind: 'warn' | 'jail';
  at: number;
  go: number;
  back: number;
  until: number;
  /** Where he stands to talk (m), facing `face`. */
  x: number;
  z: number;
  face: number;
}

const N = Math.PI; // facing north (-z)
const S = 0; // facing south (+z), toward the doors
const E = Math.PI / 2; // facing east (+x)
const W = -Math.PI / 2; // facing west (-x)

/** A slow look to either side while standing still: this many ms for a full look left and right. */
const SWEEP_MS = 7_000;

export const STAFF: readonly StaffSpec[] = [
  {
    // The pit boss works the staff corridor between the two rows of tables, watching one row and
    // then the other, and now and then walks through to the high limit salon.
    id: 'boss',
    kind: 'boss',
    name: 'the pit boss',
    speed: 0.85,
    offset: 0,
    range: 9,
    half: 1.0,
    route: [
      { x: -1.9, z: -12.6, wait: 6, face: N, sweep: 0.5 },
      { x: -5.6, z: -12.6, wait: 8, face: S, sweep: 0.6 },
      { x: -9.2, z: -12.6, wait: 6, face: N, sweep: 0.5 },
      { x: -0.1, z: -13.3 },
      { x: 1.2, z: -13.3 },
      { x: 1.9, z: -12.6, wait: 6, face: S, sweep: 0.5 },
      { x: 5.6, z: -12.6, wait: 8, face: N, sweep: 0.6 },
      { x: 9.2, z: -12.6, wait: 6, face: S, sweep: 0.5 },
      { x: 5.9, z: -13.7 },
      { x: 5.2, z: -14.5 },
      { x: 4.3, z: -16 },
      { x: 1.2, z: -18.6 },
      { x: 0, z: -22 },
      { x: -5, z: -24.3, wait: 7, face: N, sweep: 0.5 },
      { x: 5, z: -24.3, wait: 7, face: N, sweep: 0.5 },
      { x: 1.2, z: -19.4 },
      { x: 0, z: -13.6 },
      { x: -0.2, z: -13.4 },
      { x: -0.5, z: -13.3 },
      { x: -1.3, z: -13.2 },
    ],
  },
  {
    // The front of house: the lobby, down into the pit and along its open south half (clear of its fountain).
    id: 'g1',
    kind: 'guard',
    name: 'security',
    speed: 1.0,
    offset: 11_000,
    range: 11,
    half: 0.95,
    route: [
      { x: -1.4, z: 13.2, wait: 6, face: N, sweep: 0.7 },
      { x: -2, z: 9.3 },
      { x: -1.9, z: 6.4 },
      { x: -1.5, z: 5.6 },
      { x: 0, z: -2, wait: 4, face: N, sweep: 0.6 },
      { x: -10, z: -6.5, wait: 6, face: E, sweep: 0.7 },
      { x: 10, z: -6.5, wait: 6, face: W, sweep: 0.7 },
      { x: 2.6, z: -2.9 },
      { x: -1.8, z: 8 },
      { x: -2, z: 8.6 },
      { x: -1.8, z: 12.8 },
    ],
  },
  {
    // The slot floor and the online lounge behind it, and out into the yard.
    id: 'g2',
    kind: 'guard',
    name: 'security',
    speed: 1.0,
    offset: 37_000,
    range: 11,
    half: 0.95,
    route: [
      { x: -14.5, z: -6.5, wait: 4, face: W, sweep: 0.6 },
      { x: -30, z: -6.5, wait: 4, face: E, sweep: 0.6 },
      { x: -30, z: -13, wait: 3, face: E, sweep: 0.5 },
      { x: -27.1, z: -13.5 },
      { x: -26.5, z: -14.1 },
      { x: -25.9, z: -16.5 },
      { x: -23.2, z: -18.6 },
      { x: -22.4, z: -21.5, wait: 4, face: E, sweep: 0.6 },
      { x: -11, z: -21.5, wait: 4, face: W, sweep: 0.6 },
      { x: -22.4, z: -21.5 },
      { x: -23.2, z: -18.6 },
      { x: -25.9, z: -16.5 },
      { x: -26.5, z: -14.1 },
      { x: -27.1, z: -13.5 },
      { x: -30, z: -13 },
      { x: -30, z: 0.5 },
      { x: -22.4, z: 0.5 },
      { x: -22.4, z: 8, wait: 5, face: S, sweep: 0.8 },
      { x: -22.4, z: 0.5 },
      { x: -14.5, z: 0.5, wait: 3, face: W, sweep: 0.6 },
    ],
  },
  {
    // The bar, the poker room past it and the lounge.
    id: 'g3',
    kind: 'guard',
    name: 'security',
    speed: 1.0,
    offset: 5_000,
    range: 11,
    half: 0.95,
    route: [
      { x: 14.5, z: -6.4, wait: 4, face: E, sweep: 0.6 },
      { x: 20.6, z: -14.4 },
      { x: 21.1, z: -14.9 },
      { x: 22.5, z: -17.2 },
      { x: 20, z: -25, wait: 5, face: E, sweep: 0.7 },
      { x: 28.5, z: -25, wait: 4, face: W, sweep: 0.6 },
      { x: 20, z: -25 },
      { x: 22.5, z: -17.2 },
      { x: 22, z: -1, wait: 3, face: S, sweep: 0.5 },
      { x: 24, z: 8, wait: 5, face: N, sweep: 0.7 },
      { x: 22, z: -1 },
      { x: 21, z: -2.6 },
      { x: 20.7, z: -2.9 },
    ],
  },
  {
    // The lobby's sides: the bank and the boutique, between the fountain and the statues.
    id: 'g4',
    kind: 'guard',
    name: 'security',
    speed: 0.95,
    offset: 23_000,
    range: 10,
    half: 0.95,
    route: [
      { x: -1.4, z: 6.4, wait: 5, face: S, sweep: 0.8 },
      { x: -6.7, z: 8.8 },
      { x: -12, z: 9.5, wait: 5, face: N, sweep: 0.7 },
      { x: -0.2, z: 11 },
      { x: 6.2, z: 10.6 },
      { x: 6.7, z: 10.1 },
      { x: 12, z: 9.5, wait: 5, face: N, sweep: 0.7 },
      { x: 2.3, z: 8.4 },
      { x: 1.3, z: 7.4 },
      { x: 0.8, z: 7.1 },
    ],
  },
];

export function staffSpec(id: StaffId): StaffSpec {
  return STAFF.find((s) => s.id === id)!;
}

export function isStaffId(x: unknown): x is StaffId {
  return typeof x === 'string' && (STAFF_IDS as readonly string[]).includes(x);
}

// --- the loop --------------------------------------------------------------------------------

/** One stretch of a loop: standing at a stop, or walking from one stop to the next. */
interface Piece {
  t0: number;
  t1: number;
  from: Stop;
  to: Stop;
  /** Standing still (from === to), facing `yaw`. */
  still: boolean;
  yaw: number;
}

interface Timeline {
  pieces: Piece[];
  period: number;
}

const timelines = new Map<StaffId, Timeline>();

function timeline(spec: StaffSpec): Timeline {
  let tl = timelines.get(spec.id);
  if (tl) return tl;
  const pieces: Piece[] = [];
  let t = 0;
  const r = spec.route;
  // the way he last walked, for a stop that doesn't say which way to face
  let heading = headingTo(r[r.length - 1]!, r[0]!);
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    if (a.wait) {
      const ms = a.wait * 1000;
      pieces.push({ t0: t, t1: t + ms, from: a, to: a, still: true, yaw: a.face ?? heading });
      t += ms;
    }
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > 0) {
      heading = headingTo(a, b);
      const ms = (d / spec.speed) * 1000;
      pieces.push({ t0: t, t1: t + ms, from: a, to: b, still: false, yaw: heading });
      t += ms;
    }
  }
  tl = { pieces, period: t };
  timelines.set(spec.id, tl);
  return tl;
}

/** How long one lap of this loop takes (ms). */
export function lapMs(spec: StaffSpec): number {
  return timeline(spec).period;
}

function headingTo(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.atan2(b.x - a.x, b.z - a.z);
}

/** Where he is on his loop at server time `t`, ignoring any detour. */
export function loopPose(spec: StaffSpec, t: number): Pose {
  const tl = timeline(spec);
  const u = (((t + spec.offset) % tl.period) + tl.period) % tl.period;
  // loops have a couple of dozen pieces: a straight search is as quick as anything
  let p = tl.pieces[tl.pieces.length - 1]!;
  for (const q of tl.pieces) {
    if (u < q.t1) {
      p = q;
      break;
    }
  }
  if (p.still) {
    const sweep = p.from.sweep ?? 0;
    return { x: p.from.x, z: p.from.z, yaw: p.yaw + sweep * Math.sin((2 * Math.PI * (u - p.t0)) / SWEEP_MS), moving: false, busy: false };
  }
  const k = Math.min(1, Math.max(0, (u - p.t0) / (p.t1 - p.t0)));
  return { x: p.from.x + (p.to.x - p.from.x) * k, z: p.from.z + (p.to.z - p.from.z) * k, yaw: p.yaw, moving: true, busy: false };
}

// --- detours ---------------------------------------------------------------------------------

/** Walking to someone and back he hurries a little. */
export const HURRY = 2.0;
/** And never takes longer than this to get there (a lerp across the room is better than a long wait). */
const GO_MAX_MS = 7_000;
const GO_MIN_MS = 600;
/** He stands this far from whoever he talks to. */
const TALK_GAP = 0.9;

/** Where he is at `t`: on his loop, or on the detour if one covers that moment. */
export function poseAt(spec: StaffSpec, t: number, detour: Detour | null = null): Pose {
  if (!detour || detour.staff !== spec.id || t < detour.at || t >= detour.until) return loopPose(spec, t);
  const d = detour;
  if (t < d.at + d.go) {
    const from = loopPose(spec, d.at);
    const k = (t - d.at) / d.go;
    return { x: from.x + (d.x - from.x) * k, z: from.z + (d.z - from.z) * k, yaw: headingTo(from, d), moving: true, busy: true };
  }
  const leave = d.until - d.back;
  if (t < leave) return { x: d.x, z: d.z, yaw: d.face, moving: false, busy: true };
  const to = loopPose(spec, d.until);
  const k = (t - leave) / d.back;
  return { x: d.x + (to.x - d.x) * k, z: d.z + (to.z - d.z) * k, yaw: headingTo(d, to), moving: true, busy: true };
}

/** The detour covering `t` for this staff member, if any, from a list. */
export function detourOf(list: readonly Detour[], staff: StaffId, t: number): Detour | null {
  for (const d of list) if (d.staff === staff && t >= d.at && t < d.until) return d;
  return null;
}

/**
 * A detour starting at `now`: from wherever he is on his loop to beside the player at (x, z),
 * a word lasting `talk` ms, and back onto his loop.
 */
export function makeDetour(spec: StaffSpec, now: number, who: number, kind: Detour['kind'], at: { x: number; z: number }, talk: number): Detour {
  const from = loopPose(spec, now);
  const dx = from.x - at.x;
  const dz = from.z - at.z;
  const dist = Math.hypot(dx, dz);
  // beside the player on the side he comes from (or where he is, if he's that close already)
  const gap = Math.min(dist, TALK_GAP);
  const x = dist > 1e-6 ? at.x + (dx / dist) * gap : at.x;
  const z = dist > 1e-6 ? at.z + (dz / dist) * gap : at.z + TALK_GAP;
  const go = walkMs(Math.hypot(x - from.x, z - from.z));
  // back to about where his loop will have got to
  const home = loopPose(spec, now + go + talk);
  const back = walkMs(Math.hypot(home.x - x, home.z - z));
  const face = dist > 1e-6 ? Math.atan2(at.x - x, at.z - z) : from.yaw;
  return { staff: spec.id, who, kind, at: now, go, back, until: now + go + talk + back, x: round2(x), z: round2(z), face: round2(face) };
}

function walkMs(d: number): number {
  return Math.round(Math.min(GO_MAX_MS, Math.max(GO_MIN_MS, (d / HURRY) * 1000)));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A detour from the wire, checked (numbers finite, times in order); null if it isn't one. */
export function parseDetour(raw: unknown): Detour | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!isStaffId(d.staff) || (d.kind !== 'warn' && d.kind !== 'jail') || !Number.isSafeInteger(d.who)) return null;
  if (![d.at, d.go, d.back, d.until, d.x, d.z, d.face].every(num)) return null;
  const at = d.at as number;
  const go = d.go as number;
  const back = d.back as number;
  const until = d.until as number;
  if (go <= 0 || back <= 0 || until < at + go + back) return null;
  return { staff: d.staff, who: d.who as number, kind: d.kind, at, go, back, until, x: d.x as number, z: d.z as number, face: d.face as number };
}
