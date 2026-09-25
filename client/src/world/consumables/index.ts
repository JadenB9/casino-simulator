// Drinking and eating at the bar (see held.ts, schedule.ts, effects.ts and diner.ts).

import { heldOrders } from './held.ts';
import { extraActs, extraAt, now, setClock } from './state.ts';

export { HeldOrder, heldOrders } from './held.ts';

// Handles for the dev pages and the headless checks: pin the clock to pose a moment.
if (import.meta.env.DEV) (globalThis as unknown as { __dine: unknown }).__dine = { setClock, heldOrders, now, extraAt, extras: extraActs };
