// What a sitting at a slot machine has come to, for the session readout (deck.ts): the spins,
// what they were bet and paid, the net, the biggest win and the time since you sat down. Kept by
// the view from the results the machine showed (the server's own), from the moment you sit until
// you leave; nothing is sent or stored.

import { formatMoney, type Cents } from '../../../../shared/src/money.ts';

export class SessionLog {
  spins = 0;
  bet: Cents = 0;
  paid: Cents = 0;
  /** The biggest single spin's pay, and what that spin was bet. */
  best: Cents = 0;
  bestBet: Cents = 0;

  constructor(readonly since = performance.now()) {}

  /** One spin as the machine showed it: what it took and what it paid (free games included). */
  add(bet: Cents, win: Cents): void {
    this.spins++;
    this.bet += bet;
    this.paid += win;
    if (win > this.best) {
      this.best = win;
      this.bestBet = bet;
    }
  }

  get net(): Cents {
    return this.paid - this.bet;
  }
}

/** "0:07", "4:07", "1:02:45": time at the machine. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The net in the deck's words: "+$4.50", "−$1.25", "$0". */
export function netText(net: Cents): string {
  return formatMoney(net, { sign: true });
}
