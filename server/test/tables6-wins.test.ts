// The floor's big-win news names Let It Ride and Pai Gow hands from what the table turned over
// once the round was over, never from a player's own cards before it.

import { describe, it, expect } from 'vitest';
import { describeWin } from '../src/floor/wins.ts';
import { engine as letitride, type LetItRideState } from '../../shared/src/games/letitride/engine.ts';
import { engine as paigow, type PaiGowState } from '../../shared/src/games/paigow/engine.ts';
import { DECK, houseWay, lowIndexes, type PgCard } from '../../shared/src/games/paigow/rules.ts';
import type { GameEvent } from '../../shared/src/engine.ts';
import { newDeck, type Card } from '../../shared/src/cards.ts';
import type { Rng } from '../../shared/src/rng.ts';
import { TableSim } from '../../shared/test/helpers/table-sim.ts';

/** A fresh-deck deal whose top cards come out in this order (the engines' own Fisher-Yates draws). */
function stacked<T>(deck: readonly T[], top: T[]): Rng {
  const cur = deck.slice();
  const draws = top.map((card, t) => {
    const i = cur.length - 1 - t;
    const j = cur.indexOf(card);
    [cur[i], cur[j]] = [cur[j]!, cur[i]!];
    return j;
  });
  let k = 0;
  return { next32: () => draws[k++]! };
}

describe('big wins at the new card tables', () => {
  it('Let It Ride: the royal flush, turned over with the second community card', () => {
    const sim = new TableSim(letitride, stacked(newDeck(), 'As Ks Qs Js Ts'.split(' ') as Card[]), 'solo', [{ seat: 0, stack: 100_000 }]) as TableSim<LetItRideState, unknown, unknown>;
    sim.act(0, { type: 'bet', unit: 1_000, bonus: 0 });
    sim.act(0, { type: 'deal' });
    const deal = sim.lastEvents as GameEvent[];
    sim.act(0, { type: 'ride' });
    const first = sim.lastEvents as GameEvent[];
    sim.act(0, { type: 'ride' });
    const r = sim.rounds[0]!;
    expect(describeWin('letitride', '', [...first, ...(sim.lastEvents as GameEvent[])], 0, r.wagered, r.returned)).toBe('Royal flush');
    // the private deal alone names nothing
    expect(describeWin('letitride', '', deal, 0, 3_000, 30_000)).toBe('10x');
  });

  it('Pai Gow: the Fortune line', () => {
    const top = '8s 8h 8c 8d Kh 9s 2c 7h 6d 5c 4s 2h 3d 9d'.split(' ') as PgCard[];
    const sim = new TableSim(paigow, stacked(DECK, top), 'solo', [{ seat: 0, stack: 100_000 }]) as TableSim<PaiGowState, unknown, unknown>;
    sim.act(0, { type: 'bet', bet: 1_000, fortune: 500 });
    sim.act(0, { type: 'deal' });
    const seven = top.slice(0, 7);
    sim.act(0, { type: 'set', low: lowIndexes(seven, houseWay(seven)) });
    const r = sim.rounds[0]!;
    expect(describeWin('paigow', '', sim.lastEvents as GameEvent[], 0, r.wagered, r.returned)).toBe('Fortune, Four of a kind');
  });
});
