// Table bots for the load scripts and the server's hidden-information tests: given a game's view as
// one seat sees it, the move a plausible player makes now, or null to wait. They bet near the table
// minimum every window and act on every turn; they aren't trying to win.
//
// Plain TypeScript with nothing but erasable syntax, so Node runs it as is (scripts/load/*.mjs
// import it directly) and vitest bundles it for the worker tests.

export type Rand = () => number;

export interface BotSeat {
  seat: number;
  /** Chips behind, from the table's `seat` messages. */
  stack: number;
}

/** The games the load scripts seat eight players at. */
export const LOBBY_GAMES = ['blackjack', 'roulette', 'craps', 'baccarat', 'threecard', 'holdem', 'war', 'sicbo', 'bigsix', 'crash', 'banditwheel'] as const;
export type LobbyGame = (typeof LOBBY_GAMES)[number];

/** What each bot brings to a table: enough for a long session at the minimums, within the table's buy-in. */
export const BUY_IN: Record<LobbyGame, number> = {
  blackjack: 200_000,
  roulette: 100_000,
  craps: 200_000,
  baccarat: 200_000,
  threecard: 200_000,
  holdem: 50_000,
  war: 200_000,
  sicbo: 100_000,
  bigsix: 100_000,
  crash: 100_000,
  banditwheel: 100_000,
};

/** Games whose betting window closes early on the game's own Ready action (the others use the table's). */
export const ENGINE_READY = new Set<string>(['roulette', 'sicbo', 'bigsix']);

function pick<T>(rand: Rand, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length)]!;
}

/** A blackjack hand's best total. */
export function bjTotal(cards: readonly (string | null)[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (!c) continue;
    const r = c[0]!;
    if (r === 'A') {
      aces++;
      total += 11;
    } else if ('TJQK'.includes(r)) total += 10;
    else total += Number(r);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function has(rec: Record<string, unknown> | undefined): boolean {
  return !!rec && Object.keys(rec).length > 0;
}

/**
 * The move for this seat right now, or null. `betting` is what the bot would put down in an open
 * window; turn-based decisions follow the view's own list of legal moves where it has one.
 */
export function botMove(game: string, view: any, me: BotSeat, rand: Rand): Record<string, unknown> | null {
  if (!view) return null;
  const seat = me.seat;
  switch (game) {
    case 'blackjack': {
      if (view.phase === 'betting') {
        if ((view.bets?.[seat] ?? 0) > 0 || me.stack < 2_500) return null;
        return { type: 'bet', amount: 2_500 };
      }
      const spot = (view.spots ?? []).find((s: any) => s.seat === seat);
      if (view.phase === 'insurance') return spot?.insurance === 'offered' ? { type: 'insurance', take: false } : null;
      if (view.phase === 'play' && view.turn?.seat === seat && (view.moves ?? []).length) {
        const hand = spot?.hands?.[view.turn.hand];
        const total = hand ? bjTotal(hand.cards) : 21;
        const moves: string[] = view.moves;
        if (moves.includes('split') && rand() < 0.5) return { type: 'split' };
        if (moves.includes('double') && total >= 9 && total <= 11 && rand() < 0.5) return { type: 'double' };
        return { type: total < 17 && moves.includes('hit') ? 'hit' : 'stand' };
      }
      return null;
    }
    case 'roulette': {
      if (view.phase !== 'betting' || has(view.bets?.[seat])) return null;
      const bets: Record<string, unknown>[] = [{ kind: pick(rand, ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'column2']), amount: 500 }];
      if (rand() < 0.5) bets.push({ kind: 'straight', numbers: [Math.floor(rand() * 37)], amount: 100 });
      return me.stack >= 600 ? { type: 'bet', bets } : null;
    }
    case 'sicbo': {
      if (view.phase !== 'betting' || has(view.bets?.[seat])) return null;
      const bets: Record<string, unknown>[] = [{ spot: pick(rand, ['big', 'small', 'odd', 'even']), amount: 500 }];
      if (rand() < 0.5) bets.push({ spot: `total:${4 + Math.floor(rand() * 14)}`, amount: 100 });
      return me.stack >= 600 ? { type: 'bet', bets } : null;
    }
    case 'bigsix': {
      if (view.phase !== 'betting' || has(view.bets?.[seat])) return null;
      const bets = [{ spot: pick(rand, ['one', 'two', 'five', 'ten', 'twenty', 'star', 'crown']), amount: 100 }];
      return me.stack >= 100 ? { type: 'bet', bets } : null;
    }
    case 'baccarat': {
      if (view.phase !== 'betting' || has(view.bets?.[seat])) return null;
      if (me.stack < 1_500) return null;
      const bet: Record<string, unknown> = { type: 'bet', [rand() < 0.5 ? 'banker' : 'player']: 1_000 };
      if (rand() < 0.2) bet.tie = 500;
      return bet;
    }
    case 'threecard': {
      const mine = view.seats?.[seat];
      if (view.phase === 'betting') {
        if (mine) return null;
        const pairPlus = rand() < 0.5 ? 500 : 0;
        return me.stack >= 2_000 + pairPlus ? { type: 'bet', ante: 1_000, pairPlus } : null;
      }
      if (view.phase === 'deciding' && mine?.decision === 'pending') return { type: rand() < 0.8 && me.stack >= mine.ante ? 'play' : 'fold' };
      return null;
    }
    case 'war': {
      const mine = view.seats?.[seat];
      if (view.phase === 'betting') {
        if (mine) return null;
        return me.stack >= 2_000 ? { type: 'bet', bet: 1_000, tie: rand() < 0.2 ? 100 : 0 } : null;
      }
      if (view.phase === 'deciding' && mine?.decision === 'pending') return { type: rand() < 0.8 && me.stack >= mine.bet ? 'war' : 'surrender' };
      return null;
    }
    case 'craps': {
      if (view.phase !== 'open') return null;
      const mine = view.bets?.[seat] ?? {};
      const line = mine.pass || mine.dontpass;
      if (view.point === null && !line && me.stack >= 1_000) return { type: 'bet', bets: [{ kind: rand() < 0.8 ? 'pass' : 'dontpass', amount: 1_000 }] };
      if (view.point !== null && mine.pass && !mine.pass.odds && me.stack >= 1_000 && rand() < 0.5) return { type: 'odds', on: 'pass', amount: 1_000 };
      if (!mine.field && me.stack >= 500 && rand() < 0.1) return { type: 'bet', bets: [{ kind: 'field', amount: 500 }] };
      if (view.shooter === seat && !view.rollRequested && (view.point !== null || line)) return { type: 'roll' };
      return null;
    }
    case 'crash': {
      const mine = (view.bets ?? []).find((b: any) => b.seat === seat);
      if (view.phase === 'betting') {
        if (mine || me.stack < 500) return null;
        // Half set an auto cash-out (in hundredths, from 1.01x); the rest press the button.
        return { type: 'bet', amount: 500, auto: rand() < 0.5 ? 110 + Math.floor(rand() * 300) : null };
      }
      if (view.phase === 'running' && mine && mine.cashed === null && !mine.busted && rand() < 0.15) return { type: 'cashout' };
      return null;
    }
    case 'banditwheel': {
      if (view.phase !== 'betting' || has(view.bets?.[seat])) return null;
      return me.stack >= 100 ? { type: 'bet', bets: [{ spot: pick(rand, [1, 3, 5, 10, 20]), amount: 100 }] } : null;
    }
    case 'holdem': {
      const legal = view.you?.legal;
      if (!legal) return null;
      const r = rand();
      if (legal.check) return r < 0.2 && legal.bet ? { type: 'bet', amount: legal.bet.min } : { type: 'check' };
      if (r < 0.12) return { type: 'fold' };
      if (r < 0.2 && legal.raise) return { type: 'raise', to: legal.raise.min };
      return { type: 'call' };
    }
    default:
      return null;
  }
}

/** Whether this seat has put down what it wants in the current betting window (so it can press Ready). */
export function botDoneBetting(game: string, view: any, seat: number): boolean {
  if (!view) return false;
  switch (game) {
    case 'blackjack':
      return view.phase === 'betting' && (view.bets?.[seat] ?? 0) > 0;
    case 'roulette':
    case 'sicbo':
    case 'bigsix':
      return view.phase === 'betting' && has(view.bets?.[seat]);
    case 'baccarat':
      return view.phase === 'betting' && has(view.bets?.[seat]);
    case 'threecard':
    case 'war':
      return view.phase === 'betting' && !!view.seats?.[seat];
    default:
      return false;
  }
}
