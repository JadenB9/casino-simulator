// How each car drives, for the valet's card: its top speed and its pull from the same handling
// the city's driving uses (world/drive/physics.ts), and its size from its shape (world/cars/
// specs.ts). Each is a share of the line-up's best, so the bars compare the cars with each other;
// the dealer's sticker ("211 mph flat out") is the car's own story, these are how it goes here.

import { CARS } from '../../../../shared/src/items.ts';
import { CAR_SPECS, type CarSpec } from '../../world/cars/specs.ts';
import { handlingOf } from '../../world/drive/physics.ts';

export interface CarFacts {
  /** Top speed, pull and length as shares of the line-up's best (0 to 1). */
  speed: number;
  pull: number;
  size: number;
  /** Nose to tail, metres. */
  length: number;
  /** An open car's seats (a closed one's aren't drawn). */
  seats: number | null;
  speedWord: string;
  pullWord: string;
}

/** The shape's top: the body or the glasshouse, whichever is higher (the model kit's height, near enough). */
const heightOf = (s: CarSpec) => Math.max(...s.body.map((p) => p[1]), ...(s.cabin ?? []).map((p) => p[1]));
const lengthOf = (s: CarSpec) => Math.max(...s.body.map((p) => p[0])) - Math.min(...s.body.map((p) => p[0]));

const raw = new Map<string, { top: number; accel: number; length: number; seats: number | null }>();
for (const c of CARS) {
  const s = CAR_SPECS[c.id];
  if (!s) continue;
  const h = handlingOf(c.id, { wheelbase: s.front - s.rear, height: heightOf(s) });
  raw.set(c.id, { top: h.top, accel: h.accel, length: lengthOf(s), seats: s.open?.seats ?? null });
}
const best = (f: (v: { top: number; accel: number; length: number }) => number) => Math.max(...[...raw.values()].map(f));
const TOP = best((v) => v.top);
const ACCEL = best((v) => v.accel);
const LONG = best((v) => v.length);

function word(k: number, words: readonly [string, string, string, string]): string {
  return k >= 0.97 ? words[0] : k >= 0.85 ? words[1] : k >= 0.72 ? words[2] : words[3];
}

/** A car's facts, or null for one the shapes don't know. */
export function carSpecs(id: string): CarFacts | null {
  const v = raw.get(id);
  if (!v) return null;
  const speed = v.top / TOP;
  const pull = v.accel / ACCEL;
  return {
    speed,
    pull,
    size: v.length / LONG,
    length: v.length,
    seats: v.seats,
    speedWord: word(speed, ['The fastest', 'Very fast', 'Fast', 'Steady']),
    pullWord: word(pull, ['Fierce', 'Strong', 'Brisk', 'Gentle']),
  };
}
