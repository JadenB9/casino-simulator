import { describe, expect, it } from 'vitest';
import {
  BREAK_MS,
  MIN_RT,
  RT_KEEP,
  SPANS_MS,
  betSig,
  emptyEvidence,
  evidenceFrom,
  logSpread,
  merge,
  verdict,
  type Evidence,
} from '../src/fair.ts';

// A small seeded generator, so every synthetic player is the same on every run.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

const H = 3_600_000;
const NOW = 1_800_000_000_000;

/**
 * A person: lognormal reactions (median 0.45 s to 3 s, log-spread 0.3 to 1), now and then one
 * that was already under way (a held key, an obvious rebet) or a pause to think or look away.
 */
function humanReactions(r: () => number, n: number, o: { median?: number; sigma?: number } = {}): number[] {
  const median = o.median ?? 450 + r() * 2550;
  const sigma = o.sigma ?? 0.3 + r() * 0.7;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = r();
    if (u < 0.04) out.push(150 + r() * 150);
    else if (u < 0.08) out.push(4000 + r() * 20_000);
    else out.push(Math.max(180, median * Math.exp(sigma * gauss(r))));
  }
  return out;
}

/** Where a person stops walking: anywhere, to the centimetre. */
function humanStops(r: () => number, n: number): [number, number][] {
  return Array.from({ length: n }, () => [Math.round(-3000 + r() * 6000), Math.round(-4200 + r() * 5800)] as [number, number]);
}

/** Play from `from` to NOW, active every minute with no break at all (the hardest marathon). */
function marathon(hours: number): [number, number][] {
  return [[NOW - hours * H, NOW]];
}

function evidence(p: Partial<Evidence>): Evidence {
  return { ...emptyEvidence(), ...p };
}

describe('fair: people never trip it', () => {
  it('thousands of synthetic players, each with every other signal against them, stay well under', () => {
    let worst = 0;
    let worstTiming = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const r = rng(seed);
      // The worst case for everything but the reactions: a twelve-hour marathon with no break,
      // the same bet every round, and a full window of stops.
      const v = verdict(
        evidence({
          rt: humanReactions(r, RT_KEEP),
          bets: Array.from({ length: 400 }, () => betSig('blackjack', 2500)),
          stops: humanStops(r, 100),
          spans: marathon(12),
        }),
        NOW,
      );
      expect(v.tripped).toBe(false);
      expect(v.strong).toBeLessThanOrEqual(1);
      worst = Math.max(worst, v.score);
      worstTiming = Math.max(worstTiming, v.signals.tempo + v.signals.speed + v.signals.path);
    }
    // Stamina (1) and sameness (0.5) are things people do; the timing and path signals stay at 0.
    expect(worst).toBeLessThanOrEqual(1.5);
    expect(worstTiming).toBe(0);
  });

  it('the fastest, steadiest person we could model still reads as a person', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const r = rng(10_000 + seed);
      const v = verdict(evidence({ rt: humanReactions(r, RT_KEEP, { median: 380, sigma: 0.3 }), spans: marathon(12) }), NOW);
      expect(v.tripped).toBe(false);
      expect(v.signals.tempo).toBe(0);
      expect(v.signals.speed).toBe(0);
    }
  });

  it('a stretch of quick rebets (a person on a roll) moves nothing', () => {
    const r = rng(7);
    const rt = [...humanReactions(r, 250), ...Array.from({ length: 60 }, () => 200 + r() * 80), ...humanReactions(r, 90)];
    const v = verdict(evidence({ rt, spans: marathon(12) }), NOW);
    expect(v.signals.speed).toBe(0);
    expect(v.tripped).toBe(false);
  });
});

describe('fair: scripts trip it once there is enough evidence', () => {
  const fixed = (r: () => number, n: number, ms: number, jitter: number) => Array.from({ length: n }, () => ms + (r() - 0.5) * 2 * jitter);

  it('a quick fixed delay (fast and regular) trips after MIN_RT reactions, not before', () => {
    const r = rng(1);
    expect(verdict(evidence({ rt: fixed(r, MIN_RT - 1, 110, 8) }), NOW).tripped).toBe(false);
    const v = verdict(evidence({ rt: fixed(r, MIN_RT, 110, 8) }), NOW);
    expect(v.signals.speed).toBe(1);
    expect(v.signals.tempo).toBeGreaterThanOrEqual(0.75);
    expect(v.tripped).toBe(true);
  });

  it('a slow fixed delay is only one signal: it takes a marathon too', () => {
    const r = rng(2);
    const rt = fixed(r, 300, 1500, 60);
    expect(verdict(evidence({ rt, spans: marathon(3) }), NOW).tripped).toBe(false);
    const v = verdict(evidence({ rt, spans: marathon(9) }), NOW);
    expect(v.signals.tempo).toBe(1);
    expect(v.signals.stamina).toBe(1);
    expect(v.tripped).toBe(true);
  });

  it('a quick but jittery delay is only one signal (speed) until the hours add up', () => {
    const r = rng(6);
    const rt = fixed(r, 300, 110, 40);
    const v = verdict(evidence({ rt, spans: marathon(2) }), NOW);
    expect(v.signals.speed).toBe(1);
    expect(v.strong).toBe(1);
    expect(v.tripped).toBe(false);
    expect(verdict(evidence({ rt, spans: marathon(9) }), NOW).tripped).toBe(true);
  });

  it('breaks reset the marathon: a regular script taking one every three hours through the evening is let be', () => {
    const r = rng(3);
    const spans: [number, number][] = [];
    for (let h = 10; h > 0; h -= 3.5) spans.push([NOW - h * H, NOW - (h - 3) * H]);
    const v = verdict(evidence({ rt: fixed(r, 300, 1500, 60), spans }), NOW);
    expect(v.signals.stamina).toBeLessThan(0.75);
    expect(v.tripped).toBe(false);
  });

  it('...but not when it runs twenty hours of the day', () => {
    const r = rng(3);
    const spans: [number, number][] = [];
    for (let h = 24; h > 0; h -= 3.5) spans.push([NOW - h * H, NOW - (h - 3) * H]);
    expect(verdict(evidence({ rt: fixed(r, 300, 1500, 60), spans }), NOW).tripped).toBe(true);
  });

  it('a waypoint walker with regular timing trips', () => {
    const r = rng(4);
    const stops = Array.from({ length: 60 }, (_, i) => [((i * 7) % 40) * 25 - 500, ((i * 3) % 30) * 25 - 400] as [number, number]);
    const v = verdict(evidence({ rt: fixed(r, 200, 900, 30), stops }), NOW);
    expect(v.signals.path).toBe(1);
    expect(v.tripped).toBe(true);
  });

  it('grid stops at the same few spots (a teleport point, a seat) never count', () => {
    const stops = Array.from({ length: 60 }, (_, i) => [i % 2 ? 500 : 0, i % 2 ? -250 : 1275] as [number, number]);
    expect(verdict(evidence({ stops }), NOW).signals.path).toBe(0);
  });

  it('a script that waits a random human-looking delay is not caught by timing (the trade the owner chose)', () => {
    const r = rng(5);
    const v = verdict(evidence({ rt: Array.from({ length: 400 }, () => 500 + r() * 2500), spans: marathon(3) }), NOW);
    expect(v.signals.tempo).toBe(0);
    expect(v.tripped).toBe(false);
  });
});

describe('fair: evidence', () => {
  it('keeps the newest reactions, drops ones too slow to be reactions', () => {
    let ev = emptyEvidence();
    for (let i = 0; i < 5; i++) ev = merge(ev, { rt: Array.from({ length: 100 }, (_, j) => i * 100 + j) }, NOW);
    ev = merge(ev, { rt: [60_000, -1] }, NOW);
    expect(ev.rt).toHaveLength(RT_KEEP);
    expect(ev.rt[0]).toBe(100);
  });

  it('merges activity across short gaps, splits at a break, forgets old days', () => {
    let ev = merge(emptyEvidence(), { at: [NOW - 10 * 60_000, NOW - 8 * 60_000, NOW - 8 * 60_000 + BREAK_MS - 1] }, NOW);
    expect(ev.spans).toEqual([[NOW - 10 * 60_000, NOW - 8 * 60_000 + BREAK_MS - 1]]);
    ev = merge(ev, { at: [NOW - 60 * 60_000] }, NOW);
    expect(ev.spans).toHaveLength(2);
    ev = merge(ev, { at: [NOW - SPANS_MS - 1] }, NOW);
    expect(ev.spans).toHaveLength(2);
  });

  it('reads back what it stored and shrugs off junk', () => {
    const ev = merge(emptyEvidence(), { rt: [500, 600], bets: [1], stops: [[1, 2]], at: [NOW] }, NOW);
    expect(evidenceFrom(JSON.stringify(ev))).toEqual(ev);
    expect(evidenceFrom('nope')).toEqual(emptyEvidence());
    expect(evidenceFrom('{"rt":["x",5],"stops":[[1],[2,3]]}')).toEqual({ ...emptyEvidence(), rt: [5], stops: [[2, 3]] });
  });

  it('log-spread estimates a lognormal\'s sigma', () => {
    const r = rng(9);
    const rt = Array.from({ length: 4000 }, () => 1000 * Math.exp(0.5 * gauss(r)));
    expect(logSpread(rt)).toBeCloseTo(0.5, 1);
  });
});
