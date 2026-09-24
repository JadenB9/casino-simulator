import { describe, it, expect } from 'vitest';
import { CATALOG } from '../../shared/src/games/catalog.ts';
import type { GameId } from '../../shared/src/engine.ts';
import { soloNote } from '../src/ui/lobby/notes.ts';

// The station panel's "Single player" line says how a table of your own runs. Only the card
// games deal; a wheel, the dice and Crash run otherwise, and the line must say so.
describe('the single-player line in the station panel', () => {
  const multi = (Object.keys(CATALOG) as GameId[]).filter((g) => CATALOG[g].multiplayer && !CATALOG[g].dev);
  const dealt = new Set<GameId>(['blackjack', 'baccarat', 'threecard', 'war']);

  it('talks about dealing only at the games that deal cards', () => {
    for (const g of multi) expect(/\bdeal\b/i.test(soloNote(g)), g).toBe(dealt.has(g));
  });

  it('says Crash runs its own rounds and the Bandit Wheel spins', () => {
    expect(soloNote('crash')).toMatch(/cash out before it crashes/);
    expect(soloNote('banditwheel')).toMatch(/Spin/);
  });
});
