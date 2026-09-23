// Every machine on the floor, by the variant id the catalog lists: the first three (machines.ts)
// and Diamond Line, Lucky Cherries and Gold Rush, each in its own file.

import { MACHINES, MACHINE_IDS, type Machine, type MachineId } from './machines.ts';
import { DIAMONDS } from './diamonds.ts';
import { CHERRIES } from './cherries.ts';
import { GOLDRUSH } from './goldrush.ts';

export type SlotId = MachineId | 'diamonds' | 'cherries' | 'goldrush';
export const SLOT_IDS: readonly SlotId[] = [...MACHINE_IDS, 'diamonds', 'cherries', 'goldrush'];

export type AnyMachine = Machine | typeof DIAMONDS | typeof CHERRIES | typeof GOLDRUSH;

export const LINEUP: Readonly<Record<SlotId, AnyMachine>> = { ...MACHINES, diamonds: DIAMONDS, cherries: CHERRIES, goldrush: GOLDRUSH };

export function isSlotId(x: unknown): x is SlotId {
  return typeof x === 'string' && (SLOT_IDS as readonly string[]).includes(x);
}

/** Stops per reel: physical stops on a stepper, strip length on a video machine. */
export function reelLengths(m: AnyMachine): number[] {
  return m.kind === 'stepper' ? m.reels.map((r) => r.length) : m.strips.map((s) => s.length);
}
