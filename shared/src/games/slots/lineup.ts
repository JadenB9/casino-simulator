// Every machine on the floor, by the variant id the catalog lists: the first three (machines.ts)
// and Diamond Line, Lucky Cherries, Gold Rush and Straw, Sticks & Bricks, each in its own file.

import { MACHINES, MACHINE_IDS, type Machine, type MachineId } from './machines.ts';
import { DIAMONDS } from './diamonds.ts';
import { CHERRIES } from './cherries.ts';
import { GOLDRUSH } from './goldrush.ts';
import { PIGS } from './pigs.ts';

export type SlotId = MachineId | 'diamonds' | 'cherries' | 'goldrush' | 'pigs';
export const SLOT_IDS: readonly SlotId[] = [...MACHINE_IDS, 'diamonds', 'cherries', 'goldrush', 'pigs'];

export type AnyMachine = Machine | typeof DIAMONDS | typeof CHERRIES | typeof GOLDRUSH | typeof PIGS;

export const LINEUP: Readonly<Record<SlotId, AnyMachine>> = { ...MACHINES, diamonds: DIAMONDS, cherries: CHERRIES, goldrush: GOLDRUSH, pigs: PIGS };

export function isSlotId(x: unknown): x is SlotId {
  return typeof x === 'string' && (SLOT_IDS as readonly string[]).includes(x);
}

/** Stops per reel: physical stops on a stepper, strip length on a video machine. */
export function reelLengths(m: AnyMachine): number[] {
  return m.kind === 'stepper' ? m.reels.map((r) => r.length) : m.strips.map((s) => s.length);
}
