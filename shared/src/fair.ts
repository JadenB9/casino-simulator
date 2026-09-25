// Fair play: telling a script from a person by how they play, so a script can be asked to do
// something only a person does (the "Quick check", server/src/fair.ts). The owner's rule is that
// a real player must never see the check; a script playing for a little while is the price of
// that. So everything here leans loose:
//
//   Server-side only  Every figure comes from what the server already sees: when a table's news
//                     reached you and when your next move arrived, the bets each round took,
//                     where you stopped walking, and when you were doing anything at all. The
//                     client can say anything about itself, so it's never asked.
//   Big windows       Nothing is judged on fewer than MIN_RT reactions (or MIN_STOPS stops), and
//                     every statistic is a robust one (medians and median deviations), so a
//                     streak, a lag spike or a run of quick rebets moves nothing.
//   Several signals   Four independent signals are scored from 0 to 1. The check comes only when
//                     at least two of them are strong (STRONG) and the total, with bet sameness
//                     added at half weight, reaches TRIP. No single signal can do it alone.
//
// The signals, and why a person doesn't trip them:
//
//   tempo    How alike your reaction times are: the spread of their logarithms (1.4826 x the
//            median absolute deviation, which estimates the standard deviation of a lognormal).
//            People's reaction times are lognormal with a log-spread of 0.35 to 1 for choices like
//            these (and wider once looking away, chatting and thinking are in); a script waiting
//            a fixed delay has only network jitter, 0.02 to 0.08. Starts counting under
//            TEMPO_FROM (0.2), full at TEMPO_FULL (0.08). A person at the very tightest (0.3) over
//            150 reactions sits three standard errors above where it starts, and ten above full.
//   speed    How many reactions came back faster than FAST_MS (300 ms) from the moment the news
//            left the server: that includes the trip to the screen and back, drawing it, seeing
//            it and moving a hand. People manage it now and then (a key already held, an
//            obvious rebet), a few percent of the time; this starts at 60% and is full at 85%.
//   stamina  Hours of play without a single five-minute break: from STAMINA_FROM (4 h) to
//            STAMINA_FULL (8 h), or 14 to 20 hours active in the last day. People do play
//            marathons, which is why this can never be the only strong signal.
//   path     Where you stop walking. The client stops wherever the keys let go, to the
//            centimetre, so a stop lands on a 25 cm grid point one time in 625; a script
//            steering by waypoints stops on its grid every time. Starts at a quarter of the last
//            MIN_STOPS+ stops (from at least 15 different grid points), full at half. Stops that
//            aren't the end of a walk (a teleport, standing up from a seat) never count.
//   sameness The same bet round after round (at half weight, and never one of the two strong
//            signals): plenty of people flat-bet, so it only adds to a case already made.
//
// Expected false positives: a person trips only with two strong signals, and at most one of
// them (stamina) is something people do. Tempo and speed each need hundreds of reactions a
// person essentially can't produce (shared/test/fair.test.ts runs thousands of synthetic players
// with lognormal reactions, pauses, anticipations, flat bets and marathons, and none gets past
// half of TRIP), and path needs a coincidence of about one in 10^16. A script that waits a
// fixed or a quick delay trips after MIN_RT reactions (tens of minutes of play); a script that
// waits a random, human-looking delay, takes breaks and walks like a person is not caught,
// which is the trade the owner asked for.

/** Reactions kept per account (the newest), and the fewest judged. */
export const RT_KEEP = 400;
export const MIN_RT = 150;
/** Reactions slower than this aren't reactions (away, chatting, thinking it over): not kept. */
export const RT_MAX_MS = 30_000;
/** Round bet signatures kept, and the fewest judged. */
export const BETS_KEEP = 400;
export const MIN_BETS = 300;
/** Walked stops kept, the fewest judged, and the grid a waypoint script stops on (cm). */
export const STOPS_KEEP = 100;
export const MIN_STOPS = 30;
export const GRID_CM = 25;
export const MIN_GRID_POINTS = 15;
/** A gap in activity at least this long is a break; spans older than SPANS_MS are dropped. */
export const BREAK_MS = 5 * 60_000;
export const SPANS_MS = 48 * 3_600_000;

export const TEMPO_FROM = 0.2;
export const TEMPO_FULL = 0.08;
export const FAST_MS = 300;
export const SPEED_FROM = 0.6;
export const SPEED_FULL = 0.85;
export const STAMINA_FROM = 4 * 3_600_000;
export const STAMINA_FULL = 8 * 3_600_000;
export const DAY_FROM = 14 * 3_600_000;
export const DAY_FULL = 20 * 3_600_000;
export const GRID_FROM = 0.25;
export const GRID_FULL = 0.5;
export const SAME_FROM = 0.97;
export const SAME_FULL = 1;

/** A signal at least this strong is a strong one; two strong ones and a total of TRIP. */
export const STRONG = 0.75;
export const TRIP = 2;

/** What one account's play has shown so far (kept as JSON in D1, casino_fair.ev). */
export interface Evidence {
  /** Reaction times (ms), oldest first. */
  rt: number[];
  /** One number per finished round: a hash of the game and what was bet. */
  bets: number[];
  /** Walked stops [x, z] in cm, oldest first. */
  stops: [number, number][];
  /** Activity as [from, to] spans (ms), sorted, merged across gaps shorter than BREAK_MS. */
  spans: [number, number][];
}

/** What a table or the floor saw since it last reported (server/src/fair.ts note()). */
export interface Batch {
  rt?: number[];
  bets?: number[];
  stops?: [number, number][];
  /** Moments this account did something (ms). */
  at?: number[];
}

export interface Signals {
  tempo: number;
  speed: number;
  stamina: number;
  path: number;
  sameness: number;
}

export interface Verdict {
  signals: Signals;
  score: number;
  strong: number;
  tripped: boolean;
}

export function emptyEvidence(): Evidence {
  return { rt: [], bets: [], stops: [], spans: [] };
}

/** Evidence from stored JSON; anything malformed is simply left out. */
export function evidenceFrom(json: string | null | undefined): Evidence {
  const ev = emptyEvidence();
  if (!json) return ev;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return ev;
  }
  if (!raw || typeof raw !== 'object') return ev;
  const r = raw as Record<string, unknown>;
  const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => Number.isFinite(n)) : []);
  const pairs = (v: unknown): [number, number][] =>
    Array.isArray(v) ? v.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) : [];
  ev.rt = nums(r.rt).slice(-RT_KEEP);
  ev.bets = nums(r.bets).slice(-BETS_KEEP);
  ev.stops = pairs(r.stops).slice(-STOPS_KEEP);
  ev.spans = pairs(r.spans);
  return ev;
}

/** Add a batch to the evidence: windows keep their newest, spans merge and old ones go. */
export function merge(ev: Evidence, batch: Batch, now: number): Evidence {
  const rt = [...ev.rt, ...(batch.rt ?? []).filter((t) => t >= 0 && t <= RT_MAX_MS)].slice(-RT_KEEP);
  const bets = [...ev.bets, ...(batch.bets ?? [])].slice(-BETS_KEEP);
  const stops = [...ev.stops, ...(batch.stops ?? [])].slice(-STOPS_KEEP);
  const spans: [number, number][] = [...ev.spans, ...(batch.at ?? []).map((t): [number, number] => [t, t])]
    .filter(([, to]) => to > now - SPANS_MS)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [from, to] of spans) {
    const last = merged[merged.length - 1];
    if (last && from - last[1] < BREAK_MS) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return { rt, bets, stops, spans: merged };
}

/** 0 at `from`, 1 at `full`, straight in between (either direction). */
function ramp(x: number, from: number, full: number): number {
  const t = (x - from) / (full - from);
  return Math.max(0, Math.min(1, t));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** The robust log-spread of reaction times: 1.4826 x MAD of ln(rt), rt floored at 20 ms. */
export function logSpread(rt: number[]): number {
  const logs = rt.map((t) => Math.log(Math.max(20, t)));
  const m = median(logs);
  return 1.4826 * median(logs.map((l) => Math.abs(l - m)));
}

export function signals(ev: Evidence, now: number): Signals {
  let tempo = 0;
  let speed = 0;
  if (ev.rt.length >= MIN_RT) {
    tempo = ramp(logSpread(ev.rt), TEMPO_FROM, TEMPO_FULL);
    speed = ramp(ev.rt.filter((t) => t < FAST_MS).length / ev.rt.length, SPEED_FROM, SPEED_FULL);
  }
  // The longest unbroken span and the time active, both inside the last day.
  let longest = 0;
  let day = 0;
  for (const [from, to] of ev.spans) {
    const a = Math.max(from, now - 24 * 3_600_000);
    if (to <= a) continue;
    longest = Math.max(longest, to - a);
    day += to - a;
  }
  const stamina = Math.max(ramp(longest, STAMINA_FROM, STAMINA_FULL), ramp(day, DAY_FROM, DAY_FULL));
  let path = 0;
  if (ev.stops.length >= MIN_STOPS) {
    const on = ev.stops.filter(([x, z]) => x % GRID_CM === 0 && z % GRID_CM === 0);
    const points = new Set(on.map(([x, z]) => `${x},${z}`)).size;
    if (points >= MIN_GRID_POINTS) path = ramp(on.length / ev.stops.length, GRID_FROM, GRID_FULL);
  }
  let sameness = 0;
  if (ev.bets.length >= MIN_BETS) {
    const counts = new Map<number, number>();
    for (const b of ev.bets) counts.set(b, (counts.get(b) ?? 0) + 1);
    sameness = ramp(Math.max(...counts.values()) / ev.bets.length, SAME_FROM, SAME_FULL);
  }
  return { tempo, speed, stamina, path, sameness };
}

export function judge(s: Signals): Verdict {
  const main = [s.tempo, s.speed, s.stamina, s.path];
  const strong = main.filter((v) => v >= STRONG).length;
  const score = main.reduce((a, b) => a + b, 0) + 0.5 * s.sameness;
  return { signals: s, score, strong, tripped: strong >= 2 && score >= TRIP };
}

export function verdict(ev: Evidence, now: number): Verdict {
  return judge(signals(ev, now));
}

/** A round's bet signature: the game and the amount, hashed to a small number (FNV-1a). */
export function betSig(game: string, wagered: number): number {
  let h = 0x811c9dc5;
  for (const c of `${game}:${wagered}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return h >>> 0;
}
