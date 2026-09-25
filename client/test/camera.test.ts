// First person's arithmetic and the camera setting: how far each view lets you look up and down,
// where the eyes are over the head bone as the look nods, and the choice kept for next time.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEAD_Y, clampPitch, eyeOffset, headHeight, showsFromFront, stepToward } from '../src/world/player.ts';
import { EMOTES } from '../../shared/src/protocol.ts';

/** The walker's circle (player.ts RADIUS) and the near plane's reach from the camera (0.05 m out, under 0.09 m across). */
const WALKER = 0.3;
const NEAR_REACH = 0.09;

describe('pitch', () => {
  it('keeps the follow camera between a little under the head and high above', () => {
    expect(clampPitch(0.26, 'third')).toBe(0.26);
    expect(clampPitch(-1, 'third')).toBe(-0.3);
    expect(clampPitch(2, 'third')).toBe(1.1);
  });

  it('lets the eyes look much further: down past the chest to the shoes, up to the chandeliers', () => {
    expect(clampPitch(1.3, 'first')).toBe(1.3);
    expect(clampPitch(-1.3, 'first')).toBe(-1.3);
    expect(clampPitch(3, 'first')).toBe(1.4);
    expect(clampPitch(-3, 'first')).toBe(-1.35);
    // about 80 degrees down and 77 up
    expect((clampPitch(9, 'first') * 180) / Math.PI).toBeGreaterThan(79);
    expect((-clampPitch(-9, 'first') * 180) / Math.PI).toBeGreaterThan(76);
  });

  it('never lets a broken input through', () => {
    for (const view of ['first', 'third'] as const) {
      expect(Number.isFinite(clampPitch(Number.NaN, view))).toBe(true);
      expect(Number.isFinite(clampPitch(Number.POSITIVE_INFINITY, view))).toBe(true);
    }
  });
});

describe('the eyes', () => {
  it('stand over the head bone as drawn, whatever the body', () => {
    // both bodies' head joints measure 1.55 m standing; a taller model's would be higher
    expect(headHeight(1.547, 0)).toBeCloseTo(1.547, 9);
    expect(headHeight(1.7, 0)).toBeCloseTo(1.7, 9);
    // before the model has loaded
    expect(headHeight(null, 0)).toBe(HEAD_Y);
  });

  it('sink with the body onto a seat and rise with anything that lifts the walker', () => {
    // on a bench the drawn head is about 0.4 m lower
    expect(headHeight(1.15, 0)).toBeLessThan(headHeight(1.547, 0) - 0.3);
    // a ride 0.2 m up lifts the eyes the same
    expect(headHeight(1.547, 0.2) - headHeight(1.547, 0)).toBeCloseTo(0.2, 9);
    expect(headHeight(null, 0.2) - headHeight(null, 0)).toBeCloseTo(0.2, 9);
  });

  it('are where the face is looking level: over the joint and a little ahead', () => {
    const o = eyeOffset(0);
    expect(o.up).toBeCloseTo(0.11, 9);
    expect(o.ahead).toBeCloseTo(0.16, 9);
    // about 1.66 m up on a standing body
    expect(headHeight(1.547, 0) + o.up).toBeCloseTo(1.657, 3);
  });

  it('tip forward over the chest looking down and back looking up, as a head nods', () => {
    const level = eyeOffset(0);
    const down = eyeOffset(1.4);
    const up = eyeOffset(-1.35);
    expect(down.ahead).toBeGreaterThan(level.ahead);
    expect(down.up).toBeLessThan(level.up);
    expect(up.ahead).toBeLessThan(level.ahead);
    expect(up.up).toBeGreaterThan(level.up);
    // past the limits the head nods no further
    expect(eyeOffset(3)).toEqual(down);
  });

  it('stay inside the walker at every pitch, so no wall or column comes within the near plane', () => {
    for (let p = -1.5; p <= 1.5; p += 0.01) {
      const o = eyeOffset(p);
      expect(o.ahead).toBeGreaterThanOrEqual(0);
      expect(o.ahead + NEAR_REACH).toBeLessThanOrEqual(WALKER);
    }
  });
});

describe('your own gestures in first person', () => {
  it('swings out in front for every emote, free, bought or earned', () => {
    for (const e of EMOTES) expect(showsFromFront(e)).toBe(true);
  });

  it('keeps the eyes put for a punch thrown or taken, and anything else', () => {
    for (const g of ['punch', 'hit', 'brush', 'deal', 'sweep', 'pay', '']) expect(showsFromFront(g)).toBe(false);
  });
});

describe('the swing between views', () => {
  it('steps toward its end and stops there', () => {
    expect(stepToward(0, 1, 0.3)).toBeCloseTo(0.3, 9);
    expect(stepToward(0.9, 1, 0.3)).toBe(1);
    expect(stepToward(1, 0, 0.25)).toBe(0.75);
    expect(stepToward(0.1, 0, 0.25)).toBe(0);
    expect(stepToward(0.5, 1, 0)).toBe(0.5);
    expect(stepToward(0.5, 1, Number.NaN)).toBe(0.5);
  });
});

describe('the camera setting', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it('starts in third person', async () => {
    const m = await import('../src/world/mouse.ts');
    expect(m.loadMouse().view).toBe('third');
  });

  it('is saved and read back on the next load, next to the mouse settings', async () => {
    let m = await import('../src/world/mouse.ts');
    m.setMouseSettings({ sensitivity: 1.5 });
    m.setMouseSettings({ view: 'first' });
    expect(store.get('casino.camera.view')).toBe('first');
    // the next page load
    vi.resetModules();
    m = await import('../src/world/mouse.ts');
    expect(m.loadMouse()).toEqual({ sensitivity: 1.5, capture: true, view: 'first' });
    m.setMouseSettings({ view: 'third' });
    vi.resetModules();
    m = await import('../src/world/mouse.ts');
    expect(m.loadMouse().view).toBe('third');
  });

  it('tells the walking player at once, and changing it leaves the mouse settings alone', async () => {
    const m = await import('../src/world/mouse.ts');
    m.setMouseSettings({ capture: false, sensitivity: 0.5 });
    const heard: string[] = [];
    const off = m.onMouseChange((s) => heard.push(s.view));
    m.setMouseSettings({ view: 'first' });
    off();
    m.setMouseSettings({ view: 'third' });
    expect(heard).toEqual(['first']);
    expect(m.loadMouse()).toEqual({ sensitivity: 0.5, capture: false, view: 'third' });
  });

  it('ignores anything but the two views, stored or given', async () => {
    store.set('casino.camera.view', 'sideways');
    const m = await import('../src/world/mouse.ts');
    expect(m.loadMouse().view).toBe('third');
    m.setMouseSettings({ view: 'first' });
    m.setMouseSettings({ view: 'overhead' as never });
    expect(m.loadMouse().view).toBe('first');
  });

  it('lasts the page when storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const m = await import('../src/world/mouse.ts');
    expect(m.loadMouse().view).toBe('third');
    m.setMouseSettings({ view: 'first' });
    expect(m.loadMouse().view).toBe('first');
  });
});
