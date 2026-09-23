import { describe, it, expect } from 'vitest';
import { engine, BETTING_MS, RESULTS_MS, type HighCardView } from '../src/games/highcard/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

describe('highcard (reference engine)', () => {
  it('solo: bet, deal, settle with exact chip moves', () => {
    const sim = new TableSim(engine, seededRng(1), 'solo', [{ seat: 0, stack: 10_000 }]);
    sim.act(0, { type: 'bet', amount: 500 });
    expect(sim.stack(0)).toBe(9_500);
    sim.act(0, { type: 'deal' });
    const v = sim.view(0) as HighCardView;
    const r = v.results[0]!;
    expect(['win', 'lose', 'push']).toContain(r.outcome);
    expect(sim.stack(0)).toBe(9_500 + r.payout);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 500, returned: r.payout });
  });

  it('refuses bets over the stack or the limits', () => {
    const sim = new TableSim(engine, seededRng(2), 'solo', [{ seat: 0, stack: 300 }]);
    expect(sim.act(0, { type: 'bet', amount: 500 }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.act(0, { type: 'bet', amount: 150 }, { allowRefusal: true }).refused).toBe('LIMIT');
  });

  it('multiplayer: window opens on start, closes at the deadline, next round follows', () => {
    const sim = new TableSim(engine, seededRng(3), 'multi', [
      { seat: 0, stack: 10_000 },
      { seat: 2, stack: 10_000 },
    ]);
    sim.started = true;
    sim.advance(0);
    expect((sim.view(null) as HighCardView).phase).toBe('betting');
    sim.act(0, { type: 'bet', amount: 1000 });
    sim.act(2, { type: 'bet', amount: 200 });
    expect(sim.act(0, { type: 'deal' }, { allowRefusal: true }).refused).toBe('WRONG_PHASE');
    sim.advance(BETTING_MS);
    const v = sim.view(null) as HighCardView;
    expect(v.phase).toBe('results');
    expect(Object.keys(v.cards)).toEqual(['0', '2']);
    sim.advance(RESULTS_MS);
    expect((sim.view(null) as HighCardView).phase).toBe('betting');
  });

  it('a leaving player gets an undealt bet back and has nothing live', () => {
    const sim = new TableSim(engine, seededRng(4), 'multi', [{ seat: 1, stack: 5_000 }]);
    sim.started = true;
    sim.advance(0);
    sim.act(1, { type: 'bet', amount: 700 });
    expect(engine.liveBets(sim.state, 1)).toBe(700);
    sim.apply(engine.seatLeaving(sim.state, 1, sim.ctx()));
    expect(sim.stack(1)).toBe(5_000);
    expect(engine.liveBets(sim.state, 1)).toBe(0);
  });

  it('shifts its deadline', () => {
    const sim = new TableSim(engine, seededRng(5), 'multi', [{ seat: 0, stack: 5_000 }]);
    sim.started = true;
    sim.advance(0);
    const d = engine.deadline(sim.state)!;
    expect(engine.deadline(engine.shiftDeadlines(sim.state, 20_000))).toBe(d + 20_000);
  });
});
