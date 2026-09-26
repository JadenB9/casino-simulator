// v6 cars6: the valet's curb. The Worker checks the car is yours (D1) and asks the floor to bring
// it round; the floor checks you're at the stand, gives it a space at the curb (valet.ts in
// shared) and tells everyone, so the players out front see it pull up. A newcomer hears what's at
// the curb after hello. The curb is only a few minutes deep, so it lives in memory: after the
// object sleeps it's empty, and the next call starts it again.

import type { FloorServerMsg } from '../../../shared/src/protocol.ts';
import { atStand, callCar, sendBack, type CarCall } from '../../../shared/src/valet.ts';

export type CallResult = { call: CarCall | null } | { error: 'AWAY' | 'BUSY'; wait?: number };

export class Valet {
  private calls: CarCall[] = [];

  constructor(private readonly broadcast: (msg: FloorServerMsg) => void) {}

  /**
   * Bring `car` round for this player standing at (x, z) cm, or send theirs back (car null). A
   * send-back works from anywhere; a call needs the stand.
   */
  call(who: { id: number; name: string }, car: string | null, at: { x: number; z: number } | null, now: number): CallResult {
    if (car === null) {
      const back = sendBack(this.calls, who.id, now);
      if (!back) return { call: null };
      this.calls = back.list;
      this.broadcast({ t: 'car', ...back.call });
      return { call: null };
    }
    if (!at || !atStand(at.x / 100, at.z / 100)) return { error: 'AWAY' };
    const r = callCar(this.calls, who, car, now);
    if ('error' in r) return r;
    const fresh = r.call.at === now;
    this.calls = r.list;
    if (fresh) this.broadcast({ t: 'car', ...r.call });
    return { call: r.call };
  }

  /** v7: its owner got into it at the curb and drove off: off the curb at once, no valet driving it away. */
  take(accountId: number, car: string, now: number): void {
    const mine = this.calls.find((c) => c.id === accountId && c.until > now);
    if (!mine) return;
    // v7.1: one car at a time: a different car at the curb goes back with the valet
    if (mine.car !== car) {
      this.call({ id: accountId, name: mine.name }, null, null, now);
      return;
    }
    this.calls = this.calls.filter((c) => c !== mine);
    this.broadcast({ t: 'car', ...mine, until: now, taken: true });
  }

  /** What's at the curb, for a newcomer. */
  greet(ws: WebSocket, now: number): void {
    this.calls = this.calls.filter((c) => c.until > now);
    if (this.calls.length === 0) return;
    try {
      ws.send(JSON.stringify({ t: 'cars', list: this.calls } satisfies FloorServerMsg));
    } catch {
      /* gone */
    }
  }
}
