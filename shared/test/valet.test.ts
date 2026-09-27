// The valet's curb: one car per player, the first free space, a swap keeps its space, full says
// how long, sent back frees it; and the stand and the curb are out front in the valet's lot.

import { describe, expect, it } from 'vitest';
import { ARRIVE_MS, CURB, CURB_MS, STAGGER_MS, VALET_STAND, atStand, callCar, sendBack, type CarCall } from '../src/valet.ts';
import { LOTS, inRect } from '../src/zones.ts';

const who = (id: number) => ({ id, name: `p${id}` });

describe('valet curb', () => {
  it('stands in the valet lot, with every curb space in it', () => {
    const inValet = (x: number, z: number) => inRect(LOTS.valet, x * 100, z * 100);
    expect(inValet(VALET_STAND.x, VALET_STAND.z)).toBe(true);
    for (const c of CURB) expect(inValet(c.x, c.z)).toBe(true);
    expect(ARRIVE_MS).toBeLessThan(CURB_MS);
  });

  it('takes a call only near the stand', () => {
    expect(atStand(VALET_STAND.x - 1, VALET_STAND.z)).toBe(true);
    expect(atStand(VALET_STAND.x + 20, VALET_STAND.z)).toBe(false);
    expect(atStand(0, 12.8)).toBe(false);
  });

  it('fills the spaces in order, keeps a repeat as it is, and swaps a second car into the same space', () => {
    let calls: CarCall[] = [];
    const a = callCar(calls, who(1), 'halden-roadster', 1000);
    if ('error' in a) throw new Error('refused');
    expect(a.call).toEqual({ id: 1, name: 'p1', car: 'halden-roadster', slot: 0, at: 1000, until: 1000 + CURB_MS });
    calls = a.list;
    const b = callCar(calls, who(2), 'stallard-440', 2000);
    if ('error' in b) throw new Error('refused');
    expect(b.call.slot).toBe(1);
    // (1.3: a second car called a second after the first waits its turn down the drive)
    expect(b.call).toMatchObject({ at: 1000 + STAGGER_MS, until: 1000 + STAGGER_MS + CURB_MS });
    calls = b.list;
    const again = callCar(calls, who(1), 'halden-roadster', 3000);
    if ('error' in again) throw new Error('refused');
    expect(again.call).toBe(a.call);
    const swap = callCar(calls, who(1), 'ombra-oro', 4000);
    if ('error' in swap) throw new Error('refused');
    expect(swap.call).toMatchObject({ car: 'ombra-oro', slot: 0, at: b.call.at + STAGGER_MS });
    expect(swap.list.filter((c) => c.id === 1)).toHaveLength(1);
  });

  it('1.3: no two cars ever set off down the drive closer than STAGGER_MS, and the spaces fit a stretch limousine with room', () => {
    let calls: CarCall[] = [];
    for (let i = 0; i < CURB.length; i++) {
      const r = callCar(calls, who(i), 'aurelian-stretch', 1000);
      if ('error' in r) throw new Error('refused');
      calls = r.list;
    }
    const starts = calls.map((c) => c.at).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(STAGGER_MS);
    for (let i = 1; i < CURB.length; i++) expect(Math.abs(CURB[i]!.z - CURB[i - 1]!.z)).toBeGreaterThanOrEqual(7.73 + 3);
    // a car called long after the last has set off goes at once
    const late = callCar(sendBack(calls, 0, 9000)!.list, who(50), 'halden-roadster', 60_000);
    if ('error' in late) throw new Error('refused');
    expect(late.call.at).toBe(60_000);
  });

  it('says how long until a space frees when the curb is full, and a send-back frees one', () => {
    let calls: CarCall[] = [];
    for (let i = 0; i < CURB.length; i++) {
      const r = callCar(calls, who(i), 'halden-roadster', 1000 + i);
      if ('error' in r) throw new Error('refused');
      calls = r.list;
    }
    const full = callCar(calls, who(99), 'halden-roadster', 5000);
    expect(full).toEqual({ error: 'BUSY', wait: 1000 + CURB_MS - 5000 });
    // time runs out for the first: its space is free
    const later = callCar(calls, who(99), 'halden-roadster', 1000 + CURB_MS);
    expect('error' in later ? null : later.call.slot).toBe(0);
    const back = sendBack(calls, 1, 6000)!;
    expect(back.call.until).toBe(6000);
    expect(back.list.some((c) => c.id === 1)).toBe(false);
    const next = callCar(back.list, who(99), 'halden-roadster', 6000);
    expect('error' in next ? null : next.call.slot).toBe(1);
    expect(sendBack(calls, 42, 6000)).toBeNull();
  });
});
