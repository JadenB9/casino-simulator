// Another player's track (client/src/net/interp.ts): through every sample exactly, smoothly
// between them, easing into a stop, and when a late sample shows the extrapolation was wrong the
// drawn walker eases back onto the path instead of jumping (unless it's a jump of metres).

import { describe, expect, it } from 'vitest';
import { DELAY_MS, Track } from '../src/net/interp.ts';

const walk = (t: number, x: number, moving = true) => ({ t, pose: { x, z: 0, r: 64, moving } });

function track(samples: { t: number; pose: { x: number; z: number; r: number; moving: boolean } }[]): Track {
  const tr = new Track();
  for (const s of samples) tr.push(s.t, s.pose);
  return tr;
}

/** x drawn at moment t (the track is asked DELAY_MS later, as the renderer does). */
const xAt = (tr: Track, t: number) => tr.at(t + DELAY_MS)!.x;

describe('a remote player track', () => {
  it('passes through every sample and moves on smoothly between them', () => {
    const tr = track([walk(0, 0), walk(200, 50), walk(400, 100), walk(600, 150), walk(800, 200)]);
    for (const [t, x] of [[200, 50], [400, 100], [600, 150]] as const) expect(xAt(tr, t)).toBeCloseTo(x, 6);
    // a steady walk stays a steady walk: no surge or stall between samples
    for (let t = 210; t < 600; t += 20) expect(xAt(tr, t) - xAt(tr, t - 10)).toBeCloseTo(2.5, 1);
  });

  it('eases into a stop instead of halting at full speed', () => {
    const tr = track([walk(0, 0), walk(200, 50), walk(400, 100, false)]);
    const near = xAt(tr, 390) - xAt(tr, 380);
    const early = xAt(tr, 220) - xAt(tr, 210);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(early * 0.5);
    expect(xAt(tr, 600)).toBeCloseTo(100, 6);
  });

  it('reuses its pose object: read it, do not keep it', () => {
    const tr = track([walk(0, 0), walk(200, 50)]);
    expect(tr.at(100 + DELAY_MS)).toBe(tr.at(150 + DELAY_MS));
    expect(new Track().at(0)).toBeNull();
  });

  it('eases back onto the path when a late sample shows the extrapolation went too far', () => {
    const tr = track([walk(0, 0), walk(200, 50)]);
    // past the last sample: it keeps walking at the same pace for a moment
    const t0 = 300;
    expect(xAt(tr, t0)).toBeCloseTo(75, 6);
    // the walker had in fact stopped at 60 by then
    tr.push(280, { x: 60, z: 0, r: 64, moving: false });
    // the next frame is still about where the last one was, not snapped back 15 cm
    const next = xAt(tr, t0 + 16);
    expect(Math.abs(next - 75)).toBeLessThan(5);
    // and a few frames on it is on the path, at the stop
    expect(xAt(tr, t0 + 300)).toBeCloseTo(60, 1);
  });

  it('draws a jump of metres at once', () => {
    const tr = track([walk(0, 0), walk(200, 100)]);
    expect(xAt(tr, 300)).toBeCloseTo(150, 6);
    tr.push(280, { x: 2_000, z: 0, r: 64, moving: false });
    expect(xAt(tr, 316)).toBeCloseTo(2_000, 6);
  });

  it('turns the short way round through north', () => {
    const tr = new Track();
    tr.push(0, { x: 0, z: 0, r: 250, moving: true });
    tr.push(200, { x: 0, z: 0, r: 6, moving: true });
    const r = tr.at(100 + DELAY_MS)!.r;
    // half way from 250 to 6 the short way is about 0 (256), never 128
    expect(Math.min(r, 256 - r)).toBeLessThan(10);
  });
});
