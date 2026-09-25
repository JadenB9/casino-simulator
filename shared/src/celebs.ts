// Things that bring people back: celebrities who drop in now and then and tip whoever says hello,
// a gift box hidden somewhere on the floor for the first to find it, and a daily bonus that grows
// for seven days in a row.
//
// Celebrities are invented characters. The floor (server/src/floor/celebs.ts) decides when one
// arrives, which, and with what seed; everything after that is worked out from the visit alone:
// where they are at any moment is a pure function of the route and the clock, so every client
// draws them in the same place and the server can check that a player who asks for a word is
// standing next to them. Routes are walks through the building's own aisles and doorways, baked
// here from the floor plan (client/test/celebs-routes.test.ts checks every leg against the plan
// and prints fresh ones if the building changes).
//
// Money: a tip, a gift and the daily bonus are 'grant' rows in casino_ledger written in the same D1
// batch as the balance change, keyed so a retry can never pay twice:
//   celeb:<account>:<visit>, gift:<box>, daily:<account>:<yyyy-mm-dd>.

import { DOLLAR, type Cents } from './money.ts';
import type { Look } from './look.ts';
import type { HappyHour } from './happyhour.ts';

// ---------------------------------------------------------------------------------------------
// Routes

/** Where a celebrity stops and what they do there (a wave at the doors on the way out is 'bye'). */
export type StopKind = 'greet' | 'sign' | 'table' | 'pose' | 'bye';

export interface RouteStop {
  /** Index into the route's points. */
  at: number;
  kind: StopKind;
  /** Seconds spent there. */
  secs: number;
  /** The way they face while there, in quarter turns: 0 south (+z), 1 east, 2 north, -1 west. */
  face: number;
}

export interface Route {
  /** Metres on the floor, walked in order: in at the street doors, out the same way. */
  pts: readonly (readonly [number, number])[];
  stops: readonly RouteStop[];
}

export const ROUTE_IDS = ['bar', 'yard', 'salon', 'boutique', 'online', 'pit', 'wing'] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

/**
 * The walks, each about four to five minutes: the lobby first, a table or two in the pit, a room
 * that suits whoever it is, and back out through the lobby with a wave at the doors.
 */
export const ROUTES: Record<RouteId, Route> = {
  // the pit's War table, the bar's counter, the lounge by the fire
  bar: {
    pts: [[0, 14.2], [2.3, 9.2], [0, 0.5], [0.16, -8.9], [10, -6], [25.4, -6.2], [21, -3], [23.7, 5], [24, 8.6], [21.1, -2.9], [21, -3], [10, -6], [0, 0.5], [2.3, 9.2], [0, 14.2]],
    stops: [{ at: 1, kind: 'greet', secs: 24, face: 0 }, { at: 3, kind: 'table', secs: 45, face: 2 }, { at: 5, kind: 'sign', secs: 50, face: -1 }, { at: 8, kind: 'pose', secs: 40, face: 0 }, { at: 14, kind: 'bye', secs: 9, face: 2 }],
  },
  // down the slots hall's aisle and out to the Bandit Wheel in the yard
  yard: {
    pts: [[0, 14.2], [2.3, 9.2], [0, 0.5], [-10, -6], [-22, -6.2], [-23.4, 9.8], [-22, -6.2], [-10, -6], [0, 0.5], [2.3, 9.2], [0, 14.2]],
    stops: [{ at: 1, kind: 'greet', secs: 24, face: 0 }, { at: 4, kind: 'sign', secs: 50, face: 1 }, { at: 5, kind: 'table', secs: 45, face: 0 }, { at: 10, kind: 'bye', secs: 9, face: 2 }],
  },
  // round the pit's east end to baccarat in the High Limit Salon, then the Poker Room
  salon: {
    pts: [[0, 14.2], [2.3, 9.2], [0, 0.5], [10, -6], [11.9, -7.8], [11.9, -17.6], [1.3, -18.4], [1.1, -18.7], [0, -23.2], [1.1, -18.6], [1.4, -18.4], [11.9, -17.6], [11.5, -18.7], [11.5, -19.4], [12.6, -20.1], [16.9, -21], [20, -25], [16.9, -21], [11.7, -19.6], [11.5, -19.3], [11.6, -17.9], [11.9, -17.6], [11.9, -7.8], [10, -6], [0, 0.5], [2.3, 9.2], [0, 14.2]],
    stops: [{ at: 1, kind: 'pose', secs: 30, face: 0 }, { at: 8, kind: 'table', secs: 45, face: 2 }, { at: 16, kind: 'sign', secs: 50, face: 0 }, { at: 26, kind: 'bye', secs: 9, face: 2 }],
  },
  // the boutique's counter first, Three Card Poker, then the bar
  boutique: {
    pts: [[0, 14.2], [2.3, 9.2], [12.6, 9.5], [2.3, 9.2], [0, 0.5], [4.2, -8.9], [10, -6], [25.4, -6.2], [10, -6], [0, 0.5], [2.3, 9.2], [0, 14.2]],
    stops: [{ at: 1, kind: 'greet', secs: 24, face: 0 }, { at: 2, kind: 'pose', secs: 40, face: -1 }, { at: 5, kind: 'table', secs: 45, face: 2 }, { at: 7, kind: 'sign', secs: 50, face: -1 }, { at: 11, kind: 'bye', secs: 9, face: 2 }],
  },
  // round the pit's west end to the Online Lounge's computers, then blackjack
  online: {
    pts: [[0, 14.2], [2.3, 9.2], [0, 0.5], [-10, -6], [-11.9, -7.8], [-11.9, -17.6], [-11.55, -19.65], [-16.45, -22.45], [-19.6, -22.3], [-20, -22.6], [-16.45, -22.5], [-11.6, -19.5], [-11.5, -19.3], [-11.6, -17.9], [-11.9, -17.6], [-11.9, -7.8], [-10.3, -7.8], [-8.34, -8.9], [0, 0.5], [2.3, 9.2], [0, 14.2]],
    stops: [{ at: 1, kind: 'greet', secs: 24, face: 0 }, { at: 9, kind: 'table', secs: 45, face: 2 }, { at: 17, kind: 'table', secs: 45, face: 2 }, { at: 20, kind: 'bye', secs: 9, face: 2 }],
  },
  // the north wing: through the Online Lounge to a pachinko machine, the Jade Room, a number
  // called at the Bingo Hall's stage, and back round by the Poker Room
  wing: {
    pts: [[0, 14.2], [0, 8.2], [0, 0.5], [-10, -6], [-11.9, -7.8], [-11.9, -17.6], [-11.5, -18.7], [-11.55, -19.65], [-16.45, -22.45], [-19.2, -23.6], [-19.3, -24.2], [-20, -31.4], [-21.3, -37.5], [-17.8, -35.9], [-13, -36], [-12, -37], [0, -37], [12, -37], [19, -35], [20, -34.8], [20, -30.6], [20, -25], [16.9, -21], [11.7, -19.6], [11.5, -19.3], [11.6, -17.9], [11.9, -17.6], [11.9, -7.8], [10, -6], [0, 0.5], [0, 8.2], [0, 14.2]],
    stops: [{ at: 1, kind: 'greet', secs: 24, face: 0 }, { at: 12, kind: 'table', secs: 45, face: -1 }, { at: 16, kind: 'sign', secs: 40, face: 0 }, { at: 19, kind: 'table', secs: 45, face: 2 }, { at: 31, kind: 'bye', secs: 9, face: 2 }],
  },
  // along the pit's south row, blackjack at both ends, then the slots hall
  pit: {
    pts: [[0, 14.2], [2.3, 9.2], [0, 0.5], [8.34, -8.9], [0.16, -8.9], [-7.4, -8.8], [-8.34, -8.9], [-10, -6], [-22, -6.2], [-10, -6], [0, 0.5], [2.3, 9.2], [0, 14.2]],
    stops: [{ at: 1, kind: 'pose', secs: 30, face: 0 }, { at: 3, kind: 'table', secs: 45, face: 2 }, { at: 6, kind: 'table', secs: 40, face: 2 }, { at: 8, kind: 'greet', secs: 40, face: 1 }, { at: 12, kind: 'bye', secs: 9, face: 2 }],
  },
};

/** A celebrity's stroll with the entourage (m/s). */
export const CELEB_SPEED = 1.1;
/** Seconds to get up to pace from a stop, and to slow into one. */
const EASE_S = 0.8;

interface WalkSeg {
  kind: 'walk';
  /** Distance along the route at the start and end. */
  a0: number;
  a1: number;
  t0: number;
  t1: number;
  /** How long speeding up and slowing down take in this run (shorter on a short run). */
  ease: number;
}

interface StopSeg {
  kind: 'stop';
  stop: number;
  a: number;
  t0: number;
  t1: number;
}

export interface Timeline {
  route: Route;
  /** Distance along the route at each point. */
  cum: number[];
  segs: (WalkSeg | StopSeg)[];
  /** The whole visit, in seconds. */
  secs: number;
}

const timelines = new Map<Route, Timeline>();

/** A route's walks and stops against the clock (worked out once per route). */
export function timeline(route: Route): Timeline {
  const known = timelines.get(route);
  if (known) return known;
  const cum = [0];
  for (let i = 1; i < route.pts.length; i++) {
    const [ax, az] = route.pts[i - 1]!;
    const [bx, bz] = route.pts[i]!;
    cum.push(cum[i - 1]! + Math.hypot(bx - ax, bz - az));
  }
  const segs: (WalkSeg | StopSeg)[] = [];
  let t = 0;
  let from = 0;
  const walkTo = (a1: number) => {
    const len = a1 - from;
    if (len <= 1e-9) return;
    // a trapezoid of speed: up to pace, along at pace, down again (a triangle on a short run)
    const ease = Math.min(EASE_S, len / CELEB_SPEED);
    const dur = len / CELEB_SPEED + ease;
    segs.push({ kind: 'walk', a0: from, a1, t0: t, t1: t + dur, ease });
    t += dur;
    from = a1;
  };
  route.stops.forEach((s, i) => {
    walkTo(cum[s.at]!);
    segs.push({ kind: 'stop', stop: i, a: cum[s.at]!, t0: t, t1: t + s.secs });
    t += s.secs;
  });
  walkTo(cum[cum.length - 1]!);
  const tl: Timeline = { route, cum, segs, secs: t };
  timelines.set(route, tl);
  return tl;
}

/** Where along a run of `len` metres someone is `tau` seconds in, speeding up and slowing down at its ends. */
function runArc(tau: number, len: number, ease: number): number {
  const v = CELEB_SPEED;
  const dur = len / v + ease;
  const t = Math.max(0, Math.min(dur, tau));
  if (ease <= 0) return Math.min(len, v * t);
  if (t < ease) return (v * t * t) / (2 * ease);
  if (t > dur - ease) {
    const r = dur - t;
    return len - (v * r * r) / (2 * ease);
  }
  return v * (t - ease / 2);
}

export interface Place {
  x: number;
  z: number;
  /** The way along the route here (rotation.y: 0 faces +z). */
  heading: number;
}

/** The point `arc` metres along a route, and the way the route runs there. */
export function pointAt(tl: Timeline, arc: number): Place {
  const { cum, route } = tl;
  const pts = route.pts;
  const a = Math.max(0, Math.min(cum[cum.length - 1]!, arc));
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < a) i++;
  // a zero-length step (a doubled point) has no direction of its own: look further along
  let j = i;
  while (j < cum.length - 1 && cum[j]! - cum[j - 1]! < 1e-9) j++;
  const [ax, az] = pts[i - 1]!;
  const [bx, bz] = pts[i]!;
  const seg = cum[i]! - cum[i - 1]!;
  const k = seg > 1e-9 ? (a - cum[i - 1]!) / seg : 1;
  const [dx0, dz0] = pts[j - 1]!;
  const [dx1, dz1] = pts[j]!;
  return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, heading: Math.atan2(dx1 - dx0, dz1 - dz0) };
}

export interface CelebPose extends Place {
  /** Distance along the route. */
  arc: number;
  walking: boolean;
  /** The stop they're at (an index into route.stops), or -1 while walking; and seconds into it. */
  stop: number;
  stopT: number;
  /** Seconds since the visit started. */
  t: number;
}

/** Where someone on this route is `t` seconds in (clamped to the visit). */
export function poseOn(tl: Timeline, t: number): CelebPose {
  const tt = Math.max(0, Math.min(tl.secs, t));
  for (const s of tl.segs) {
    if (tt > s.t1 && s !== tl.segs[tl.segs.length - 1]) continue;
    if (s.kind === 'stop') {
      const p = pointAt(tl, s.a);
      return { ...p, heading: faceYaw(tl.route.stops[s.stop]!.face), arc: s.a, walking: false, stop: s.stop, stopT: tt - s.t0, t: tt };
    }
    const arc = s.a0 + runArc(tt - s.t0, s.a1 - s.a0, s.ease);
    const p = pointAt(tl, arc);
    return { ...p, arc, walking: tt < s.t1, stop: -1, stopT: 0, t: tt };
  }
  const p = pointAt(tl, 0);
  return { ...p, arc: 0, walking: false, stop: -1, stopT: 0, t: tt };
}

/** A stop's facing as rotation.y. */
export function faceYaw(quarters: number): number {
  return (quarters * Math.PI) / 2;
}

// ---------------------------------------------------------------------------------------------
// The celebrities

export const CELEB_IDS = ['nightjar', 'maddox', 'vale', 'castellan', 'quill', 'harlow', 'marlowe'] as const;
export type CelebId = (typeof CELEB_IDS)[number];

export interface Celeb {
  id: CelebId;
  name: string;
  /** What they're known for, a few words under the name. */
  known: string;
  look: Look;
  /** Height against the average (character scale). */
  scale: number;
  route: RouteId;
  lines: {
    /** Said to whoever comes up to talk, with the tip: the server picks one. */
    hello: readonly string[];
    /** Called out to the room at a stop. */
    stop: readonly string[];
    /** At a table, playing for show. */
    table: readonly string[];
    /** At the doors on the way out. */
    bye: string;
  };
}

export const CELEBS: readonly Celeb[] = [
  {
    id: 'nightjar',
    name: 'DJ Nightjar',
    known: 'DJ, three residencies on the Strip',
    look: { v: 1, body: 'm', outfit: 'hoodie', skin: 5, hair: '#0e0c0b', top: '#141418', bottom: '#141418', shoes: '#e8e6e0', chain: 'cuban-link', watch: 'gold-watch', shades: 'round-shades' },
    scale: 1.02,
    route: 'bar',
    lines: {
      hello: [
        "You've got a good energy. Here, the next round's on me.",
        'Tell the bartender Nightjar sent you.',
        'Love the fit. Take this and go make some noise.',
        "I'm on the decks Saturday. Come through, this one's on me.",
        "Stay loud. Here's something for the tables.",
      ],
      stop: ['Who is up late with me tonight?', 'This room needs a bass line.', 'Somebody turn the lights down a little.'],
      table: ['Red. Always red.', 'Let it ride!', 'One more hand, then the set.'],
      bye: 'Goodnight, Las Vegas!',
    },
  },
  {
    id: 'maddox',
    name: "Rocco 'The Anvil' Maddox",
    known: 'Heavyweight champion of the world',
    look: { v: 1, body: 'm', outfit: 'casual', skin: 6, hair: '#0e0c0b', top: '#8a1c1c', bottom: '#1b1b1f', shoes: '#101010', clothes: 'gold-tracksuit', chain: 'rope-chain', grill: 'full-gold' },
    scale: 1.07,
    route: 'yard',
    lines: {
      hello: [
        'Firm handshake. I like you. Here.',
        'Keep your guard up at those tables, champ.',
        'Every round counts. Take this for the next one.',
        'You look like a fighter. Put this in your corner.',
        'Stay hungry, kid.',
      ],
      stop: ['Twelve rounds, and I still came out to play.', 'Who wants a picture with the champ?', 'Nobody hits harder than this place.'],
      table: ['Spin it! Spin it!', 'I never go down, and neither does this wheel.', 'Big money, big money!'],
      bye: 'Rematch next week!',
    },
  },
  {
    id: 'vale',
    name: 'Seraphina Vale',
    known: 'Pop singer, eleven number ones',
    look: { v: 1, body: 'f', outfit: 'dress', skin: 1, hair: '#d8b46a', top: '#c21f5b', bottom: '#c21f5b', shoes: '#d4af37', clothes: 'fur-coat', chain: 'tennis-chain', watch: 'iced-watch', shades: 'diamond-shades' },
    scale: 0.98,
    route: 'boutique',
    lines: {
      hello: [
        'Oh, hi! This is for you, darling.',
        "You're sweet. Go win something sparkly.",
        'Thank you for coming out tonight. Here.',
        'Promise you will be at the show. Take this.',
        'Love you! Spend it on something fabulous.',
      ],
      stop: ['Hello, lovelies!', 'Is that a camera? I am ready.', 'This place is gorgeous tonight.'],
      table: ['Come on, lucky cards!', 'Deal me in, darling.', 'Encore! Encore!'],
      bye: 'Kisses! Goodnight!',
    },
  },
  {
    id: 'castellan',
    name: 'Theo Castellan',
    known: 'Founder of Parallax, tech billionaire',
    look: { v: 1, body: 'm', outfit: 'casual', skin: 0, hair: '#6b4226', top: '#22252b', bottom: '#3a3f47', shoes: '#f0f0f0', watch: 'rose-watch' },
    scale: 1.0,
    route: 'online',
    lines: {
      hello: [
        'A rounding error for me. Life-changing for you. Maybe.',
        "Invest it wisely. Or don't, it's Las Vegas.",
        'I like your hustle. Call it a seed round.',
        'A small grant. No pitch deck required.',
        'Expected value says keep it. Take it anyway.',
      ],
      stop: ['Has anyone seen the high limit room?', 'I am told the house always wins. We will see.', 'Fascinating place. Terrible odds.'],
      table: ['The model says cash out at two.', 'Double down. The data says so.', 'Again. Same settings.'],
      bye: 'Off to the jet. Good luck, everyone.',
    },
  },
  {
    id: 'quill',
    name: 'Silas Quill',
    known: 'Stage magician, four shows a night',
    look: { v: 1, body: 'm', outfit: 'suit', skin: 2, hair: '#1b1512', top: '#3b0f1a', bottom: '#141417', shoes: '#0c0c0e', clothes: 'velvet-jacket', hat: 'top-hat' },
    scale: 1.01,
    route: 'pit',
    lines: {
      hello: [
        'Is this your card? No? Then take this instead.',
        'Check your pocket. Actually, check your balance.',
        "A little magic for you. Don't ask how it's done.",
        "Pick a card, any card. Never mind, here's cash.",
        "Now you see it. Now it's yours.",
      ],
      stop: ['Nothing up my sleeves.', 'Watch closely now.', 'The hand is quicker than the eye.'],
      table: ['The ace was there the whole time.', 'Shuffle up. I will wait.', 'Twenty-one. Of course.'],
      bye: 'And now... I vanish.',
    },
  },
  {
    id: 'harlow',
    name: 'Dex Harlow',
    known: 'Film star, Heist at Midnight',
    look: { v: 1, body: 'm', outfit: 'suit', skin: 3, hair: '#3a2618', top: '#f2efe6', bottom: '#141417', shoes: '#0c0c0e', clothes: 'white-tuxedo', shades: 'gold-aviators', watch: 'gold-watch' },
    scale: 1.04,
    route: 'salon',
    lines: {
      hello: [
        "Tell your friends you met me. Here's proof.",
        "You've got a face for the movies. Take this.",
        "No autographs tonight, but here's a tip.",
        'The director wants one more take. This is for the extras.',
        'Stay golden, friend.',
      ],
      stop: ['Just here for the tables tonight.', 'One photo, then back to the cards.', 'Great crowd. Great room.'],
      table: ['The camera loves a winner.', 'All in. Cut, print.', 'Deal the next scene.'],
      bye: "That's a wrap!",
    },
  },
  {
    id: 'marlowe',
    name: 'Buddy Marlowe',
    known: 'Game show host, Lucky Numbers',
    look: { v: 1, body: 'm', outfit: 'suit', skin: 4, hair: '#8c8a86', top: '#1c2a44', bottom: '#141417', shoes: '#0c0c0e', clothes: 'sequin-suit', watch: 'gold-watch' },
    scale: 1.0,
    route: 'wing',
    lines: {
      hello: [
        "Congratulations, you're tonight's lucky winner!",
        "Come on down! Here's a little something.",
        'Folks, give it up for this one. Here you go.',
        'No buzzer needed. The prize is yours.',
        'And the envelope says... you. Enjoy it.',
      ],
      stop: ['Good evening, everybody! Are you feeling lucky?', 'Keep those tickets close, folks!', "Let's make some noise in here!"],
      table: ['Under the B, number nine!', 'N, thirty-one. Anybody close?', 'Look at those silver balls go!', 'G, fifty-four. Somebody shout it!'],
      bye: 'Goodnight, and stay lucky!',
    },
  },
];

const BY_ID = new Map(CELEBS.map((c) => [c.id, c]));

export function celebOf(id: unknown): Celeb | null {
  return typeof id === 'string' ? (BY_ID.get(id as CelebId) ?? null) : null;
}

/** The entourage's look: black suits and dark glasses. */
export const GUARD_LOOK: Look = { v: 1, body: 'm', outfit: 'suit', skin: 4, hair: '#0e0c0b', top: '#101013', bottom: '#101013', shoes: '#0a0a0a', shades: 'gold-aviators' };

// ---------------------------------------------------------------------------------------------
// Visits

/** One celebrity's visit, everything the clients need to draw it. `id` is its start time (ms). */
export interface Visit {
  id: number;
  celeb: CelebId;
  /** Server time (ms) they walk in. */
  start: number;
  /** For the extras: the crowd, and which line they call out at each stop. */
  seed: number;
}

export function routeOfVisit(v: Visit): Timeline {
  return timeline(ROUTES[celebOf(v.celeb)?.route ?? 'bar']);
}

/** Server time (ms) the visit is over (the last of them out through the doors). */
export function visitEnd(v: Visit): number {
  return v.start + routeOfVisit(v).secs * 1000;
}

/** Where the celebrity is at server time `now`, or null before they arrive and after they've gone. */
export function celebAt(v: Visit, now: number): CelebPose | null {
  if (now < v.start || now >= visitEnd(v)) return null;
  return poseOn(routeOfVisit(v), (now - v.start) / 1000);
}

/** How near (m) the server lets a player be to say hello; the prompt shows nearer than this. */
export const TALK_REACH_M = 3.5;
export const TALK_PROMPT_M = 2.4;

/** Between visits (start to start), and after the floor fills up again, before the first. */
export const VISIT_GAP_MS: readonly [number, number] = [20 * 60_000, 40 * 60_000];
export const FIRST_VISIT_MS: readonly [number, number] = [4 * 60_000, 10 * 60_000];

/**
 * A tip, whole hundreds of dollars: usually $500 to $2,000, now and then up to $5,000, and once
 * in a while up to $10,000. `rand` returns [0, 1).
 */
export function rollTip(rand: () => number): Cents {
  const u = rand();
  const band = u < 0.7 ? [500, 2_000] : u < 0.95 ? [2_000, 5_000] : [5_000, 10_000];
  const steps = (band[1]! - band[0]!) / 100 + 1;
  return (band[0]! + Math.min(steps - 1, Math.floor(rand() * steps)) * 100) * DOLLAR;
}

export const TIP_MIN: Cents = 500 * DOLLAR;
export const TIP_MAX: Cents = 10_000 * DOLLAR;

// ---------------------------------------------------------------------------------------------
// The gift box

/**
 * Where a gift box can be left: corners and quiet ends of every room, all on open floor a walker
 * can reach from the doors (client/test/celebs-routes.test.ts).
 */
export const GIFT_SPOTS: readonly (readonly [number, number])[] = [
  [5.6, 4.3], [-5.6, 4.3], [-15.5, 13.4], [-29.4, 4.6], [-29.4, 13.4], [-29.2, -17.3], [-14.8, 1.1], [-29.6, -29.6],
  [-10.9, -29.2], [-7.3, -29.2], [7.1, -20.8], [29.1, -29.2], [10.7, -29.2], [14.8, -17.3], [29.3, 1.2], [29.2, 13.1],
  [18.7, 13.2], [15.6, 13.6], [-12.3, -18.3], [12.3, 0.9], [-12.3, 1.0],
  // the north wing: the Pachinko Parlour, the Jade Room, the Bingo Hall
  [-10.0, -42.0], [-29.0, -32.2], [-8.2, -41.0], [30.0, -42.0],
];

export interface GiftBox {
  /** When it was left (ms): its id, and part of its ledger key. */
  id: number;
  x: number;
  z: number;
  /** Server time (ms) it's taken away if nobody finds it. */
  until: number;
}

export const GIFT_REACH_M = 2.6;
export const GIFT_PROMPT_M = 1.6;
/** How long a box waits to be found. */
export const GIFT_MS = 15 * 60_000;
/** Between boxes, and after the floor fills up again, before the first. */
export const GIFT_GAP_MS: readonly [number, number] = [45 * 60_000, 75 * 60_000];
export const FIRST_GIFT_MS: readonly [number, number] = [6 * 60_000, 15 * 60_000];

/** What's in a box: $1,000 to $5,000 in steps of $250. */
export function rollGift(rand: () => number): Cents {
  return (1_000 + Math.min(16, Math.floor(rand() * 17)) * 250) * DOLLAR;
}

export const GIFT_MIN: Cents = 1_000 * DOLLAR;
export const GIFT_MAX: Cents = 5_000 * DOLLAR;

// ---------------------------------------------------------------------------------------------
// The daily bonus

/** Day 1 to day 7 of a streak; every day after the seventh pays the seventh's. */
export const DAILY_AMOUNTS: readonly Cents[] = [2_500, 5_000, 7_500, 10_000, 15_000, 20_000, 50_000].map((d) => d * DOLLAR);

/** What the `streak`th day in a row pays (1-based). */
export function dailyAmount(streak: number): Cents {
  return DAILY_AMOUNTS[Math.max(1, Math.min(DAILY_AMOUNTS.length, Math.floor(streak))) - 1]!;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar day before a YYYY-MM-DD day (calendar arithmetic: no clock, no time zone). */
export function prevDay(day: string): string {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`not a day: ${day}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1));
  return d.toISOString().slice(0, 10);
}

/** A day as the integer kept in casino_tally (20260925), and back. */
export function dayNumber(day: string): number {
  return Number(day.replace(/-/g, ''));
}

export function numberDay(n: number): string | null {
  if (!Number.isSafeInteger(n) || n < 10000101) return null;
  const s = String(n);
  const day = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return DAY_RE.test(day) ? day : null;
}

/**
 * The streak a claim on `today` makes, given the day of the last claim and the streak it made:
 * the day after carries it on, any later day starts again at 1. Null if today is already claimed.
 */
export function streakAfterClaim(last: string | null, streak: number, today: string): number | null {
  if (last === today) return null;
  return last !== null && last === prevDay(today) ? Math.max(0, streak) + 1 : 1;
}

export interface DailyStatus {
  /** The casino's date (Las Vegas time). */
  day: string;
  /** Days in a row, counting today if it's claimed; 0 once a day has been missed. */
  streak: number;
  /** Today's bonus has been taken. */
  claimed: boolean;
  /** Which day of the seven the next claim is (1-7), and what it pays: today's if unclaimed, else tomorrow's. */
  next: number;
  amount: Cents;
  amounts: readonly Cents[];
  /** Server time (ms) the casino's day ends. */
  resetAt: number;
  /** Celebrities met, and how many times. */
  met: Partial<Record<CelebId, number>>;
}

/** Where a streak stands on `today`, from the last claim. */
export function dailyState(last: string | null, streak: number, today: string): { streak: number; claimed: boolean; next: number } {
  if (last === today) return { streak, claimed: true, next: Math.min(DAILY_AMOUNTS.length, streak + 1) };
  const alive = last !== null && last === prevDay(today);
  return { streak: alive ? streak : 0, claimed: false, next: Math.min(DAILY_AMOUNTS.length, (alive ? streak : 0) + 1) };
}

export interface DailyClaimResponse {
  amount: Cents;
  streak: number;
  balance: Cents;
  inPlay: Cents;
  rev: number;
  status: DailyStatus;
}

// ---------------------------------------------------------------------------------------------
// Floor messages (they ride the floor socket beside protocol.ts's)

export type CelebClientMsg = { t: 'celeb.talk'; visit: number } | { t: 'gift.open'; id: number };

export type CelebNo = 'FAR' | 'MET' | 'GONE' | 'SLOW';

export type CelebServerMsg =
  /** Right after hello: the visit going on and the box waiting to be found, if any, and the happy hour going on or next. */
  | { t: 'celebs'; visit: Visit | null; gift: GiftBox | null; happy?: HappyHour }
  /** The next happy hour (happyhour.ts), once the last is over (or a dev one starts). */
  | { t: 'happy'; happy: HappyHour }
  /** A celebrity walks in (or a new visit replaces one). */
  | { t: 'celeb'; visit: Visit }
  /** The celebrity has a word with a player (everyone sees them turn and say it). */
  | { t: 'celeb.talk'; visit: number; id: number; line: number }
  /** To the player who said hello: the tip, paid, and the balance after it. */
  | { t: 'celeb.tip'; visit: number; line: number; amount: Cents; balance: Cents; inPlay: Cents; rev: number; met: number }
  | { t: 'celeb.no'; visit: number; code: CelebNo; msg: string }
  | { t: 'gift'; gift: GiftBox }
  /** Found (by `name`) or taken away (name null). */
  | { t: 'gift.gone'; id: number; name: string | null }
  | { t: 'gift.won'; id: number; amount: Cents; balance: Cents; inPlay: Cents; rev: number }
  | { t: 'gift.no'; id: number; code: CelebNo; msg: string };

/** A celebrity or gift message from a client, or null. */
export function parseCelebMsg(raw: unknown): CelebClientMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const n = m.t === 'celeb.talk' ? m.visit : m.t === 'gift.open' ? m.id : undefined;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) return null;
  return m.t === 'celeb.talk' ? { t: 'celeb.talk', visit: n } : { t: 'gift.open', id: n };
}
