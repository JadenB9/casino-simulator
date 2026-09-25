// The valet: where the stand is, where a called car pulls up, and how long it waits there. The
// client draws the stand, the curb and the cars from these; the floor checks a call against them
// (you have to be at the stand) and hands out the curb's spaces, one car per player at a time.
//
// Positions here are metres in the ground zone (zones.ts has them in centimetres); the server
// multiplies by 100.

/** The valet's podium, on the sidewalk under the porte-cochère, facing the lobby's doors (-x). */
export const VALET_STAND = { x: 129.6, z: 5.0 } as const;

/** A call is taken from this close to the stand (metres, the floor's last known position). */
export const CALL_REACH = 8;

/**
 * The curb's spaces, where a called car stops: in the drive's lane under the porte-cochère,
 * nose north (+z), passenger side to the sidewalk.
 */
export const CURB: readonly { x: number; z: number }[] = [
  { x: 132.6, z: 0.5 },
  { x: 132.6, z: -6.5 },
  { x: 132.6, z: 7.0 },
];

/** From the call to the car standing at the curb, and the keys handed over (ms). */
export const ARRIVE_MS = 11_000;
/** How long a called car waits at the curb before the valet takes it back (ms, from the call). */
export const CURB_MS = 120_000;
/** Calls per account per minute (the HTTP route's limit). */
export const CALLS_PER_MIN = 6;

/** A car at the curb or on its way there (the floor's `car` message; `cars` after hello). */
export interface CarCall {
  /** Whose car: the account id and name. */
  id: number;
  name: string;
  /** The car's id (items.ts CARS). */
  car: string;
  /** Which curb space (an index into CURB). */
  slot: number;
  /** Server time it was called, and when it leaves (sent back early, until is the time it was). */
  at: number;
  until: number;
}

/** POST /shop/valet: bring this car round (a car you own), or send yours back (null). */
export interface CarCallRequest {
  car: string | null;
}

export interface CarCallResponse {
  /** Your car at the curb now, or null when it's gone back. */
  call: CarCall | null;
}

/** Whether a point (metres) is close enough to the stand to call a car. */
export function atStand(x: number, z: number): boolean {
  return Math.hypot(x - VALET_STAND.x, z - VALET_STAND.z) <= CALL_REACH;
}

export type CallOutcome = { call: CarCall; list: CarCall[] } | { error: 'BUSY'; wait: number };

/**
 * Bring a player's car round. Their own car already out: the same car is left as it is (a retry,
 * a double press); a different one takes its space and the first goes back. Otherwise the first
 * free space, or BUSY with how long until one frees. `list` is what's at the curb after (calls
 * that have left are dropped).
 */
export function callCar(calls: readonly CarCall[], who: { id: number; name: string }, car: string, now: number): CallOutcome {
  const live = calls.filter((c) => c.until > now);
  const mine = live.find((c) => c.id === who.id);
  if (mine && mine.car === car) return { call: mine, list: live };
  let slot = mine?.slot;
  if (slot === undefined) {
    const used = new Set(live.map((c) => c.slot));
    slot = CURB.findIndex((_, i) => !used.has(i));
    if (slot < 0) return { error: 'BUSY', wait: Math.min(...live.map((c) => c.until)) - now };
  }
  const call: CarCall = { id: who.id, name: who.name, car, slot, at: now, until: now + CURB_MS };
  return { call, list: [...live.filter((c) => c.id !== who.id), call] };
}

/** Send a player's car back now; null if they had none out. */
export function sendBack(calls: readonly CarCall[], id: number, now: number): { call: CarCall; list: CarCall[] } | null {
  const live = calls.filter((c) => c.until > now);
  const mine = live.find((c) => c.id === id);
  if (!mine) return null;
  const call = { ...mine, until: now };
  return { call, list: live.filter((c) => c.id !== id) };
}
