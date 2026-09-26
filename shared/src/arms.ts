// v7: the gun store's stock and how each one shoots. Bought once and kept (a casino_items row, like
// a car), drawn on the floor with a key and fired with a left click. Nobody is ever hurt: a hit
// knocks someone off their feet for a moment, the way a punch staggers them, and they get up.
// Where it's fired decides the rest: security hears a shot anywhere in the casino (server/src/law.ts),
// the street has no guards, and the gun store's range is for shooting.
//
// The server checks every shot (server/src/floor/arms.ts): you own the gun, it's not faster than
// the gun can fire, you're standing (not seated, not driving), and it finds what the shot hits
// along the line you fired, never trusting a hit from the client. Every make here is made up.

import { DOLLAR, type Cents } from './money.ts';

export type GunModel = 'pistol' | 'revolver' | 'cannon' | 'smg' | 'shotgun' | 'rifle' | 'marksman' | 'drum' | 'rotary';

export interface GunItem {
  id: string;
  kind: 'gun';
  name: string;
  price: Cents;
  about: string;
  /** Which body the model builder draws (client/src/world/arms/models.ts). */
  model: GunModel;
  /** Finish: 'black' steel, 'steel', 'wood' furniture, or 'gold'. */
  finish: 'black' | 'steel' | 'wood' | 'gold' | 'chrome';
  /** Shots a second at most; `auto` keeps firing while the button is held. */
  rate: number;
  auto?: boolean;
  /** How far a shot reaches (m). */
  range: number;
  /** Pellets or bullets per shot (a shotgun's spread), and the spread's half-angle (radians). */
  pellets: number;
  spread: number;
  /** How hard a hit knocks someone back (m). */
  kick: number;
  /** Rounds before a reload, and the reload (s). */
  mag: number;
  reload: number;
}

/** Cheapest first. */
export const GUNS: readonly GunItem[] = [
  { id: 'compact-9', kind: 'gun', name: 'Kestrel Compact 9', price: 12_000 * DOLLAR, about: 'A polymer-frame 9 mm that fits a jacket pocket.', model: 'pistol', finish: 'black', rate: 4, range: 35, pellets: 1, spread: 0.012, kick: 0.6, mag: 15, reload: 1.3 },
  { id: 'service-45', kind: 'gun', name: 'Warden .45 Service', price: 28_000 * DOLLAR, about: 'Full-size steel .45, seven rounds, the old way.', model: 'pistol', finish: 'steel', rate: 3, range: 40, pellets: 1, spread: 0.01, kick: 0.9, mag: 8, reload: 1.4 },
  { id: 'revolver-357', kind: 'gun', name: 'Marlowe .357 Revolver', price: 45_000 * DOLLAR, about: 'Six-inch barrel, walnut grips, six in the cylinder.', model: 'revolver', finish: 'chrome', rate: 2, range: 45, pellets: 1, spread: 0.008, kick: 1.2, mag: 6, reload: 2.2 },
  { id: 'pump-12', kind: 'gun', name: 'Harrow 12-Gauge Pump', price: 90_000 * DOLLAR, about: 'Walnut stock, eight in the tube, a wide pattern up close.', model: 'shotgun', finish: 'wood', rate: 1.2, range: 22, pellets: 7, spread: 0.07, kick: 1.8, mag: 8, reload: 2.8 },
  { id: 'desert-50', kind: 'gun', name: 'Sirocco .50 Hand Cannon', price: 120_000 * DOLLAR, about: 'A gas-operated .50 pistol. Heavy, loud, unmistakable.', model: 'cannon', finish: 'steel', rate: 1.6, range: 50, pellets: 1, spread: 0.01, kick: 1.9, mag: 7, reload: 1.8 },
  { id: 'smg-9', kind: 'gun', name: 'Vesper 9 SMG', price: 160_000 * DOLLAR, about: 'Folding stock, 30 rounds, fully automatic.', model: 'smg', finish: 'black', rate: 11, auto: true, range: 35, pellets: 1, spread: 0.03, kick: 0.5, mag: 30, reload: 1.9 },
  { id: 'carbine-556', kind: 'gun', name: 'Ridgeline 5.56 Carbine', price: 280_000 * DOLLAR, about: 'A 16-inch carbine with a red-dot sight, automatic.', model: 'rifle', finish: 'black', rate: 9, auto: true, range: 70, pellets: 1, spread: 0.015, kick: 0.9, mag: 30, reload: 2.2 },
  { id: 'marksman', kind: 'gun', name: 'Longview Marksman Rifle', price: 450_000 * DOLLAR, about: 'Bolt-action .308 with a long scope. One shot, one fall.', model: 'marksman', finish: 'wood', rate: 0.8, range: 120, pellets: 1, spread: 0.002, kick: 2.4, mag: 5, reload: 2.6 },
  { id: 'drum-28', kind: 'gun', name: "Chicago Drum SMG '28", price: 2_500_000 * DOLLAR, about: 'Walnut, blued steel and a fifty-round drum, as the old films had it.', model: 'drum', finish: 'wood', rate: 12, auto: true, range: 40, pellets: 1, spread: 0.035, kick: 0.7, mag: 50, reload: 3 },
  { id: 'gold-50', kind: 'gun', name: 'Sirocco .50, 24k Gold', price: 7_500_000 * DOLLAR, about: 'The hand cannon, plated in gold with ivory grips.', model: 'cannon', finish: 'gold', rate: 1.6, range: 50, pellets: 1, spread: 0.01, kick: 2.1, mag: 7, reload: 1.8 },
  { id: 'rotary', kind: 'gun', name: 'Tempest Rotary Cannon', price: 40_000_000 * DOLLAR, about: 'Six spinning barrels, a belt of a thousand rounds.', model: 'rotary', finish: 'black', rate: 18, auto: true, range: 60, pellets: 1, spread: 0.04, kick: 1.1, mag: 200, reload: 4 },
];

const GUN_BY_ID = new Map(GUNS.map((g) => [g.id, g]));

/** A gun the store sells, or null. */
export function gunItem(id: unknown): GunItem | null {
  return typeof id === 'string' ? (GUN_BY_ID.get(id) ?? null) : null;
}

/** The fastest any gun may fire, shots a second (the floor's bucket for shots). */
export const MAX_RATE = Math.max(...GUNS.map((g) => g.rate));

/** How close to the line of a shot someone must be to be hit (m, from their middle). */
export const HIT_RADIUS = 0.42;

/** How long someone stays down after a hit knocks them over (ms); a second hit meanwhile only keeps them there. */
export const DOWN_MS = 2_200;

/**
 * What a shot along `yaw` from (x, z) hits first: the nearest candidate whose middle is within
 * HIT_RADIUS of the line and no further than `range` along it. Null for a miss. The line is in
 * the ground plane (people stand; nobody aims at feet or the sky).
 */
export function shotTarget<Id>(x: number, z: number, yaw: number, range: number, candidates: Iterable<{ id: Id; x: number; z: number }>): { id: Id; d: number } | null {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  let best: { id: Id; d: number } | null = null;
  for (const c of candidates) {
    const dx = c.x - x;
    const dz = c.z - z;
    const along = dx * fx + dz * fz;
    if (along <= 0.2 || along > range) continue;
    const off = Math.abs(dx * fz - dz * fx);
    if (off > HIT_RADIUS) continue;
    if (!best || along < best.d) best = { id: c.id, d: along };
  }
  return best;
}
