// When a held order is drunk or eaten: sip by sip, bite by bite, on a timetable every screen works
// out the same way from the order itself, so everyone sees you drink when you drink. Nothing goes
// over the floor for it: the timetable comes from the order's id (its sips fall a little
// unevenly, the same unevenness for everyone), when it was paid for, when it leaves your hand, and
// when this screen first saw it in your hand (the hand-over, for everyone standing about then).
// Your own "Sip" key adds acts of your own on top, seen on your screen: the drink goes down faster
// and is finished sooner, and the others see it put down when it is.
//
// Pure: times are milliseconds on the server's clock, nothing here draws.

import { HOLD_MS, barItem } from '../../../../shared/src/items.ts';

/** What one act is: a sip from a glass, a swig from a bottle or can, a bite from the plate, a Dom's spray, a cake's candles. */
export type Act = 'sip' | 'swig' | 'bite' | 'spray' | 'blow';

export interface Profile {
  /** Sips or bites in the whole order. */
  portions: number;
  /** How the portions go. */
  act: Act;
  /** The first act, when it's a different one (the spray that opens a Dom, the candles on a cake): it takes no portion. */
  opener?: Act;
}

/** How long each act takes (s). */
export const ACT_SECS: Record<Act, number> = { sip: 2.6, swig: 2.8, bite: 3.0, spray: 4.2, blow: 2.6 };

/** How each order is had: a glass in five or six sips, a beer in eight swigs, a plate a piece at a time. */
export const PROFILES: Record<string, Profile> = {
  beer: { portions: 8, act: 'swig' },
  'red-wine': { portions: 6, act: 'sip' },
  cocktail: { portions: 5, act: 'sip' },
  whiskey: { portions: 4, act: 'sip' },
  champagne: { portions: 6, act: 'sip' },
  espresso: { portions: 3, act: 'sip' },
  dom: { portions: 8, act: 'swig', opener: 'spray' },
  margarita: { portions: 6, act: 'sip' },
  'energy-drink': { portions: 6, act: 'swig' },
  sliders: { portions: 3, act: 'bite' },
  'truffle-fries': { portions: 8, act: 'bite' },
  'shrimp-cocktail': { portions: 5, act: 'bite' },
  lobster: { portions: 5, act: 'bite' },
  caviar: { portions: 4, act: 'bite' },
  ribeye: { portions: 6, act: 'bite' },
  macarons: { portions: 6, act: 'bite' },
  'birthday-cake': { portions: 4, act: 'bite', opener: 'blow' },
};

/** Any bar item's profile (an item added to the menu later is had like others of its kind). */
export function profileOf(item: string): Profile {
  const known = PROFILES[item];
  if (known) return known;
  const it = barItem(item);
  return it?.kind === 'food' ? { portions: 4, act: 'bite' } : { portions: 5, act: 'sip' };
}

/** A waiter's walk: about this long from paying to the order reaching your hand (ms). */
export const DELIVERY_MS = 40_000;
/** The first act comes this long after the order reaches your hand (ms). */
export const FIRST_MS = 6_000;
/** The last one ends this long before the order has to leave your hand (ms), time to hand the empty back. */
export const END_MS = 35_000;
/** Seen first later than this after paying, you've come along late: some of it is already gone (ms). */
export const LATE_MS = 120_000;
/** Acts never come closer together than this, end to start (ms). */
export const GAP_MS = 1_200;

export interface Plan {
  item: string;
  profile: Profile;
  /** When each act on the timetable starts (ms), the opener first if there is one. */
  at: number[];
  /** Portions already gone before this screen saw it (a latecomer's view). */
  pre: number;
  /** How long each act takes (ms). */
  ms: number;
  openerMs: number;
}

/** A small seeded generator from the order id: the same unevenness on every screen. */
export function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The timetable for an order held until `until`, first seen in a hand at `seen`. Acts are spread
 * evenly over the time it's held, each nudged a little (by the order's own numbers), with the
 * opener a few seconds after it arrives. Seen long after it was paid for, the part of the order
 * that would be gone by then is gone.
 */
export function planFor(item: string, order: string, until: number, seen: number): Plan {
  const profile = profileOf(item);
  const ms = ACT_SECS[profile.act] * 1000;
  const openerMs = profile.opener ? ACT_SECS[profile.opener] * 1000 : 0;
  // (a hold longer than the bar's, as the dev pages give, counts from when it was seen)
  const paid = Math.min(until - HOLD_MS, seen);
  const rand = seeded(order);
  const start = seen + FIRST_MS;
  const end = Math.min(until, paid + HOLD_MS) - END_MS;
  // a latecomer: the share of the order a hand-over at the usual time would have had by now
  let pre = 0;
  if (seen - paid > LATE_MS) {
    const span = HOLD_MS - DELIVERY_MS - END_MS;
    pre = Math.min(profile.portions - 1, Math.floor((profile.portions * (seen - paid - DELIVERY_MS)) / span));
  }
  const n = profile.portions - pre;
  const at: number[] = [];
  let t = start;
  if (profile.opener && pre === 0) {
    at.push(t);
    t += openerMs + GAP_MS * 3;
  }
  // even steps over what's left, never tighter than an act and a breath
  const room = Math.max(0, end - t - ms);
  const step = Math.max(ms + GAP_MS, n > 1 ? room / (n - 1) : 0);
  const slack = step - ms - GAP_MS;
  for (let i = 0; i < n; i++) {
    // the first only ever later, the last only ever sooner: all of it inside the time in hand
    const r = rand();
    const nudge = i === 0 ? r * 0.25 : i === n - 1 ? -r * 0.3 : (r - 0.5) * 0.6;
    at.push(Math.round(t + step * i + nudge * slack));
  }
  // nudges never make two acts overlap
  for (let i = 1; i < at.length; i++) {
    const len = i === 1 && profile.opener && pre === 0 ? openerMs : ms;
    at[i] = Math.max(at[i]!, at[i - 1]! + len + GAP_MS);
  }
  return { item, profile, at, pre, ms, openerMs };
}

export interface ActNow {
  /** Which act on the list (0-based), what it is, when it started and how far through it is (0-1). */
  i: number;
  kind: Act;
  t0: number;
  phase: number;
  /** The portion it takes (portion n of the order), or -1 for an opener. */
  portion: number;
}

export interface Had {
  /** Acts, in order: the timetable's, with your own added (see acts()). */
  acts: number[];
  /** Whether acts[0] is the opener. */
  opener: boolean;
}

/**
 * The timetable with your own acts added: an act of yours takes the next portion, and a
 * timetabled one that would come while yours is going (or just after it) is let go. Nothing
 * past the last portion counts.
 */
export function acts(plan: Plan, own: readonly number[] = []): Had {
  const opener = !!plan.profile.opener && plan.pre === 0;
  const left = plan.profile.portions - plan.pre + (opener ? 1 : 0);
  const all = [...plan.at.map((t) => ({ t, own: false })), ...own.map((t) => ({ t, own: true }))].sort((a, b) => a.t - b.t || (a.own ? -1 : 1));
  const out: number[] = [];
  let busyUntil = -Infinity;
  for (const e of all) {
    if (out.length >= left) break;
    // a timetabled act that would come in the middle of another is let go; one of yours waits its turn
    if (e.t < busyUntil && !e.own) continue;
    const t = Math.max(e.t, busyUntil);
    out.push(t);
    busyUntil = t + (out.length === 1 && opener ? plan.openerMs : plan.ms) + GAP_MS;
  }
  return { acts: out, opener };
}

export interface State {
  /** Portions gone, counting the one going now once it's been had. */
  taken: number;
  /** What's left of it, 1 full to 0 empty, easing down as a sip goes down. */
  level: number;
  act: ActNow | null;
  /** The opener has happened (the cork's out, the candles are blown). */
  opened: boolean;
  /** Finished: nothing left and the last act is over. */
  done: boolean;
  /** When it was (or will be) finished (ms). */
  doneAt: number;
}

/** Where in an act the portion is had: a sip goes down in the middle of the tilt, a bite at the mouth. */
export const HAD_AT: Record<Act, [number, number]> = { sip: [0.4, 0.62], swig: [0.38, 0.66], bite: [0.46, 0.5], spray: [0.45, 0.85], blow: [0.4, 0.45] };

/** The order as it stands at `now`. */
export function stateAt(plan: Plan, had: Had, now: number): State {
  const total = plan.profile.portions;
  let taken = plan.pre;
  let level = 1 - plan.pre / total;
  let act: ActNow | null = null;
  let opened = !plan.profile.opener || plan.pre > 0;
  let portion = plan.pre;
  const lenOf = (i: number) => (i === 0 && had.opener ? plan.openerMs : plan.ms);
  for (let i = 0; i < had.acts.length; i++) {
    const t0 = had.acts[i]!;
    if (now < t0) break;
    const isOpener = i === 0 && had.opener;
    const kind = isOpener ? plan.profile.opener! : plan.profile.act;
    const phase = Math.min(1, (now - t0) / lenOf(i));
    const p = isOpener ? -1 : portion++;
    if (phase < 1) act = { i, kind, t0, phase, portion: p };
    const [a, b] = HAD_AT[kind];
    const k = smooth((phase - a) / (b - a));
    if (isOpener) {
      if (k >= 1) opened = true;
      continue;
    }
    taken = p + (k >= 1 ? 1 : 0);
    level = 1 - (p + k) / total;
  }
  const n = had.acts.length;
  const all = n === total - plan.pre + (had.opener ? 1 : 0);
  const doneAt = all && n > 0 ? had.acts[n - 1]! + lenOf(n - 1) : Infinity;
  return { taken, level: Math.max(0, level), act, opened, done: now >= doneAt, doneAt };
}

export function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * How far each arm pose is taken at `phase` of an act (0 none, 1 all the way). Sips and swigs lift
 * the glass to the lips, tip it and bring it down; a bite reaches the left hand to the plate, up to
 * the mouth and down; a spray raises the bottle, shakes it and points it up; the candles bring the
 * plate up under the chin.
 */
export interface Weights {
  lift: number;
  tip: number;
  reach: number;
  eat: number;
  raise: number;
  aim: number;
  chin: number;
  belly: number;
}

const NONE: Weights = { lift: 0, tip: 0, reach: 0, eat: 0, raise: 0, aim: 0, chin: 0, belly: 0 };

/** Up over [a, b], held, down over [c, d]. */
function env(t: number, a: number, b: number, c: number, d: number): number {
  if (t <= a || t >= d) return 0;
  if (t < b) return smooth((t - a) / (b - a));
  if (t <= c) return 1;
  return 1 - smooth((t - c) / (d - c));
}

export function weights(kind: Act, t: number): Weights {
  switch (kind) {
    case 'sip':
    case 'swig': {
      // lift to the lips, tip while drinking, back down
      const up = env(t, 0, 0.26, 0.74, 1);
      const tip = env(t, 0.26, 0.42, 0.62, 0.76);
      return { ...NONE, lift: up * (1 - tip), tip };
    }
    case 'bite': {
      // the left hand to the plate, then up to the mouth, a moment there, then down
      const reach = env(t, 0, 0.16, 0.24, 0.4);
      const eat = env(t, 0.24, 0.42, 0.62, 0.9);
      return { ...NONE, reach, eat, chin: 0.35 * env(t, 0.1, 0.3, 0.6, 0.85) };
    }
    case 'spray': {
      // up in front, shaken hard, then tipped up and sprayed
      const raise = env(t, 0, 0.12, 0.38, 0.5);
      const aim = env(t, 0.38, 0.46, 0.86, 1);
      const shake = t > 0.12 && t < 0.38 ? 0.5 + 0.5 * Math.sin(t * 150) : 0;
      return { ...NONE, raise: raise * (1 - 0.3 * shake), aim };
    }
    case 'blow':
      return { ...NONE, chin: env(t, 0, 0.3, 0.62, 1) };
  }
}

/** The gestures that aren't portions: a toast (the glass up in front), handing the empty back, a pat on the belly. */
export function extraWeights(kind: 'toast' | 'give' | 'pat', t: number): Weights {
  switch (kind) {
    case 'toast':
      return { ...NONE, raise: env(t, 0, 0.3, 0.7, 1) };
    case 'give':
      return { ...NONE, raise: env(t, 0, 0.4, 0.62, 1) };
    case 'pat':
      return { ...NONE, belly: env(t, 0, 0.22, 0.78, 1) * (0.82 + 0.18 * Math.cos(t * Math.PI * 2 * 3.5)) };
  }
}
