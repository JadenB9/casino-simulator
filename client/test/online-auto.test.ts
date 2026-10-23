import { describe, it, expect } from 'vitest';
import { AutoBet, autoStop, autoCount, type AutoStops } from '../src/games/online/auto.ts';

// Auto-bet on the House Originals (games/online/auto.ts): it sends the game's own Bet only once
// the last has played out and its beat has passed, never two at once, and stops at once on any of
// its stops, a refusal, a missing answer or a reconnect.

function harness(stops: AutoStops, opts: { gapMs?: number; answerMs?: number; play?: () => boolean | string } = {}) {
  const sent: number[] = [];
  const stopped: string[] = [];
  let busy = false;
  let clock = 0;
  const auto = new AutoBet(
    {
      play: opts.play ?? (() => {
        if (busy) return false;
        busy = true;
        sent.push(clock);
        return true;
      }),
      changed: () => {},
      stopped: (why) => stopped.push(why),
    },
    { gapMs: opts.gapMs ?? 300, answerMs: opts.answerMs ?? 6000 },
  );
  /** The bet out plays out on the page: its stake and what came back. */
  const settle = (bet: number, back: number) => {
    busy = false;
    auto.answered();
    auto.settled(bet, back);
  };
  /** Frames of `ms` each. */
  const run = (ms: number, frames = 1) => {
    for (let i = 0; i < frames; i++) {
      clock += ms;
      auto.update(ms / 1000, clock);
    }
  };
  return { auto, sent, stopped, settle, run, start: () => auto.start(stops, clock) };
}

describe('auto-bet', () => {
  it('sends the first bet at once and the next only after the last settles and the beat passes', () => {
    const h = harness({ bets: 3, profit: null, loss: null });
    h.start();
    expect(h.sent.length).toBe(1);
    h.run(100, 20);
    expect(h.sent.length).toBe(1); // still out: nothing more goes
    h.settle(100, 0);
    h.run(100, 2);
    expect(h.sent.length).toBe(1); // within the 300 ms beat
    h.run(100, 2);
    expect(h.sent.length).toBe(2);
  });

  it('stops once the number of bets has played', () => {
    const h = harness({ bets: 2, profit: null, loss: null });
    h.start();
    h.settle(100, 200);
    h.run(400);
    h.settle(100, 0);
    h.run(400, 5);
    expect(h.sent.length).toBe(2);
    expect(h.auto.running).toBe(false);
    expect(h.stopped[0]).toMatch(/2 bets played/);
  });

  it('stops on a profit and on a loss, counting what came back less the stakes', () => {
    const up = harness({ bets: null, profit: 500, loss: null });
    up.start();
    up.settle(100, 300); // +2
    up.run(400);
    up.settle(100, 400); // +3: +5 in all
    expect(up.auto.running).toBe(false);
    expect(up.stopped[0]).toMatch(/Profit reached/);

    const down = harness({ bets: null, profit: null, loss: 250 });
    down.start();
    for (let i = 0; i < 2; i++) {
      down.settle(100, 0);
      down.run(400);
    }
    expect(down.auto.running).toBe(true); // down 2
    down.settle(100, 0); // down 3
    expect(down.auto.running).toBe(false);
    expect(down.stopped[0]).toMatch(/Loss limit/);
  });

  it('stops when the game says it can no longer bet (the chips are short)', () => {
    let calls = 0;
    const h = harness({ bets: null, profit: null, loss: null }, { play: () => (++calls === 1 ? true : 'not enough chips') });
    h.start();
    h.settle(100, 0);
    h.run(400);
    expect(h.auto.running).toBe(false);
    expect(h.stopped[0]).toBe('not enough chips');
  });

  it('waits, without counting a bet, while the game is busy', () => {
    let ready = false;
    const h = harness({ bets: 5, profit: null, loss: null }, { play: () => ready });
    h.start();
    h.run(100, 10);
    expect(h.auto.run?.placed).toBe(0);
    ready = true;
    h.run(100);
    expect(h.auto.run?.placed).toBe(1);
  });

  it('gives up on a table that does not answer', () => {
    const h = harness({ bets: null, profit: null, loss: null }, { answerMs: 2000 });
    h.start();
    h.run(500, 5);
    expect(h.auto.running).toBe(false);
    expect(h.stopped[0]).toMatch(/didn't answer/);
  });

  it('stops on a refusal and on a reconnect, and a stop sends nothing more', () => {
    const r = harness({ bets: null, profit: null, loss: null });
    r.start();
    r.auto.refused('Bets here are whole dollars');
    r.run(500, 4);
    expect(r.sent.length).toBe(1);
    expect(r.stopped[0]).toBe('Bets here are whole dollars');

    const c = harness({ bets: null, profit: null, loss: null });
    c.start();
    c.auto.reset();
    expect(c.auto.running).toBe(false);
    c.settle(100, 500); // the old bet's late result changes nothing
    c.run(500, 4);
    expect(c.sent.length).toBe(1);
  });

  it('ignores a result that is not one of its bets', () => {
    const h = harness({ bets: 2, profit: null, loss: null });
    h.start();
    h.settle(100, 0);
    h.auto.settled(100, 100_000); // nothing of the run's was out
    expect(h.auto.run?.settled).toBe(1);
    expect(h.auto.run?.net).toBe(-100);
  });

  it('says how far a run has gone', () => {
    expect(autoCount({ stops: { bets: 25, profit: null, loss: null }, placed: 4, settled: 3, net: 0 })).toBe('22 left');
    expect(autoCount({ stops: { bets: null, profit: null, loss: null }, placed: 4, settled: 3, net: 0 })).toBe('3 played');
    expect(autoStop({ stops: { bets: 10, profit: null, loss: null }, placed: 3, settled: 3, net: 50 })).toBeNull();
  });
});
