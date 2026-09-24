import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { TableStage, type DealerGesture } from '../src/table/stage.ts';
import type { Engine3D } from '../src/render/engine3d.ts';

// The dealer's motions as the views ask for them: each runs about a second and starts from the arm
// at rest, so a motion asked for while one is under way waits for it (a run of cards is one dealing
// motion after another, and the pay follows the sweep) instead of snapping the arm back to the start.

function stage(): { st: TableStage; seen: [DealerGesture, number][] } {
  const st = new TableStage({ camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() } as unknown as Engine3D, new THREE.Group());
  const seen: [DealerGesture, number][] = [];
  st.dealer = (g) => seen.push([g, performance.now()]);
  return { st, seen };
}

describe("the dealer's gestures", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('plays a motion at once when the dealer is still', () => {
    const { st, seen } = stage();
    st.gesture('deal');
    expect(seen).toEqual([['deal', 0]]);
  });

  it('turns a run of cards into one dealing motion after another', () => {
    const { st, seen } = stage();
    // a card every 300 ms for two seconds
    for (let t = 0; t <= 2000; t += 300) {
      if (t > 0) vi.advanceTimersByTime(300);
      st.gesture('deal');
    }
    vi.advanceTimersByTime(3000);
    expect(seen.map(([g]) => g)).toEqual(['deal', 'deal', 'deal']);
    // each starts as the one before it ends
    expect(seen[1]![1] - seen[0]![1]).toBeGreaterThanOrEqual(1000);
    expect(seen[2]![1] - seen[1]![1]).toBeGreaterThanOrEqual(1000);
  });

  it('pays after the sweep it was asked for during', () => {
    const { st, seen } = stage();
    st.gesture('sweep');
    vi.advanceTimersByTime(400);
    st.gesture('pay');
    expect(seen.map(([g]) => g)).toEqual(['sweep']);
    vi.advanceTimersByTime(1000);
    expect(seen.map(([g]) => g)).toEqual(['sweep', 'pay']);
    expect(seen[1]![1]).toBeGreaterThanOrEqual(1350);
  });

  it('keeps only the latest motion waiting', () => {
    const { st, seen } = stage();
    st.gesture('deal');
    st.gesture('sweep');
    st.gesture('pay');
    vi.advanceTimersByTime(5000);
    expect(seen.map(([g]) => g)).toEqual(['deal', 'pay']);
  });

  it('does nothing without a dealer, and nothing after the table is gone', () => {
    const { st, seen } = stage();
    st.gesture('deal');
    st.gesture('pay');
    st.dispose();
    vi.advanceTimersByTime(5000);
    expect(seen.map(([g]) => g)).toEqual(['deal']);
    const bare = new TableStage({ camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() } as unknown as Engine3D, new THREE.Group());
    expect(() => bare.gesture('deal')).not.toThrow();
  });
});
