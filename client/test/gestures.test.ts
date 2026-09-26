// The emotes as poses over time (world/gestures.ts) and the beat under the dances (audio/beat.ts):
// every emote has a gesture that gives finite numbers from start to end, seated or standing; a
// seated one never moves the legs, hips or whole body; the whole-body moves come back to where
// they started (a flip is a whole turn, the moonwalk glides back and spins home); the dances last
// a few beats, and their music keeps their time and stops before they end.

import { describe, it, expect } from 'vitest';
import { EMOTES, SHOP_EMOTES, REWARD_EMOTES, type EmoteId } from '../../shared/src/protocol.ts';
import { GESTURES, dances, gestureSeconds, movesLegs, type Pose } from '../src/world/gestures.ts';
import { beatTimes, hasBeat } from '../src/audio/beat.ts';

/** Every number in a pose (turns, hands, feet, whole-body moves). */
function numbers(p: Pose): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(p);
  return out;
}

const times = (dur: number) => Array.from({ length: 121 }, (_, i) => (dur * i) / 120);

describe('gestures', () => {
  it('every emote has one, with finite numbers all the way through', () => {
    for (const e of EMOTES) {
      const g = GESTURES[e];
      expect(g, e).toBeTruthy();
      expect(g.dur).toBeGreaterThan(1);
      expect(g.dur).toBeLessThan(5);
      expect(gestureSeconds(e)).toBe(g.dur);
      for (const seated of [false, true]) {
        for (const t of times(g.dur)) {
          for (const n of numbers(g.pose(t, seated))) expect(Number.isFinite(n), `${e} ${t} ${seated}`).toBe(true);
        }
      }
    }
  });

  it('seated, nothing below the waist moves and the body stays in the chair', () => {
    for (const e of EMOTES) {
      for (const t of times(GESTURES[e].dur)) {
        const p = GESTURES[e].pose(t, true);
        expect(movesLegs(p), `${e} ${t}`).toBe(false);
        expect(p.hop ?? 0).toBe(0);
        expect(p.spin ?? 0).toBe(0);
        for (const k of ['thighR', 'thighL', 'shinR', 'shinL', 'body'] as const) expect(p[k], `${e} ${k}`).toBeUndefined();
      }
    }
  });

  it('the dances move the legs standing', () => {
    for (const e of ['throwback', 'griddy', 'floss', 'robot', 'backflip', 'moonwalk'] as EmoteId[]) {
      expect(times(GESTURES[e].dur).some((t) => movesLegs(GESTURES[e].pose(t, false))), e).toBe(true);
    }
  });

  it('a backflip goes once over backwards, in the air, and lands upright', () => {
    const g = GESTURES.backflip;
    const ts = times(g.dur);
    const flips = ts.map((t) => g.pose(t, false).flip ?? 0);
    expect(Math.min(...flips)).toBeLessThan(-2 * Math.PI + 0.2);
    expect(Math.max(...flips)).toBeLessThanOrEqual(0);
    // turning only while off the floor
    for (const t of ts) {
      const p = g.pose(t, false);
      if (Math.abs(p.flip ?? 0) > 0.05 && Math.abs((p.flip ?? 0) + 2 * Math.PI) > 0.05) expect(p.hop ?? 0, `${t}`).toBeGreaterThan(0);
    }
    expect(g.pose(g.dur - 0.01, false).flip ?? 0).toBe(0);
    expect(g.pose(g.dur - 0.01, false).hop ?? 0).toBe(0);
  });

  it('the moonwalk glides backwards, and comes home by the end', () => {
    const g = GESTURES.moonwalk;
    const glide = times(g.dur).map((t) => g.pose(t, false).glide ?? 0);
    expect(Math.min(...glide)).toBeLessThan(-0.5);
    expect(Math.max(...glide)).toBeLessThanOrEqual(0);
    // backwards all through the glide: never forward until the spin
    for (let t = 0.3; t < 2.6; t += 0.05) expect(g.pose(t + 0.05, false).glide!).toBeLessThanOrEqual(g.pose(t, false).glide! + 1e-9);
    expect(Math.abs(g.pose(g.dur - 0.01, false).glide ?? 0)).toBeLessThan(1e-9);
    // (a whole turn, not a part of one)
    expect(g.pose(g.dur - 0.01, false).spin ?? 0).toBe(0);
  });

  it('the sold and the rewarded emotes all have props or moves of their own', () => {
    expect(GESTURES.moneyfan.prop).toBe('bills');
    expect(GESTURES.trophy.prop).toBe('trophy');
    for (const e of [...SHOP_EMOTES, ...REWARD_EMOTES]) expect(GESTURES[e].pose(1, false)).toBeTruthy();
  });
});

describe('dance beats', () => {
  it('the dances have music and the rest do not (the clap has its own)', () => {
    for (const e of ['throwback', 'griddy', 'floss', 'robot', 'moonwalk'] as EmoteId[]) {
      expect(hasBeat(e), e).toBe(true);
      expect(GESTURES[e].beat, e).toBe(0.5);
    }
    for (const e of ['wave', 'clap', 'dab', 'bow', 'backflip', 'trophy', 'moneyfan'] as EmoteId[]) expect(hasBeat(e), e).toBe(false);
  });

  it('keeps the dance time: the kick on the beat, and quiet as it eases out', () => {
    const beat = GESTURES.floss.beat!;
    const dur = GESTURES.floss.dur;
    const b = beatTimes('floss', beat, dur);
    // four to the floor: every beat
    expect(b.k).toEqual(b.k.map((_, i) => i * beat));
    expect(b.k.length).toBeGreaterThanOrEqual(6);
    for (const v of Object.values(b)) for (const t of v) expect(t).toBeLessThan(dur - 0.25);
    // the claps on two and four
    expect(b.c.slice(0, 2)).toEqual([beat, 3 * beat]);
    expect(beatTimes('wave', 0.5, 2).k).toEqual([]);
  });

  it('tells the dances (step off a ride for them) from emotes the arms do (done on the deck)', () => {
    const off = (['wave', 'cheer', 'clap', 'thumbs', 'shrug', 'sixseven', 'throwback', 'griddy', 'floss', 'dab', 'robot', 'backflip', 'moneyfan', 'bow', 'trophy', 'moonwalk'] as const).filter((e) => dances(e));
    expect(off).toEqual(['throwback', 'griddy', 'floss', 'robot', 'backflip', 'bow', 'moonwalk']);
    // a dab holds a stance but doesn't move the legs; a knock off the feet and a jump do
    expect(dances('knock')).toBe(true);
    expect(dances('jump')).toBe(true);
    expect(dances('punch')).toBe(false);
  });
});
