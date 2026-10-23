import { describe, it, expect } from 'vitest';
import { resultText, RoundLog, type RoundHistory, type Round } from '../src/table/history.ts';

// The last rounds at a table (table/history.ts): what a round paid, in words, and a round of
// several hands logged once, when its last hand has settled.

describe('a round’s result', () => {
  it('says what came back over what went down', () => {
    expect(resultText({ staked: 2500, returned: 5000 })).toEqual({ text: '+$25', kind: 'win' });
    expect(resultText({ staked: 2500, returned: 0 })).toEqual({ text: '−$25', kind: 'lose' });
    expect(resultText({ staked: 2500, returned: 2500 })).toEqual({ text: 'Push', kind: 'push' });
    expect(resultText({ staked: 0, returned: 0 })).toEqual({ text: 'No bet', kind: 'push' });
  });
});

describe('a round of several hands', () => {
  const sink = () => {
    const rounds: Round[] = [];
    return { rounds, history: { add: (r: Round) => rounds.push(r) } as unknown as RoundHistory };
  };

  it('waits for every hand, then logs one round with each hand on its second line', () => {
    const { rounds, history } = sink();
    const log = new RoundLog(history);
    log.start(3);
    log.settle('Fold', 1000, 0);
    expect(rounds).toHaveLength(0);
    log.vs = 'Queen high';
    log.settle('Pair of Kings', 2000, 4000);
    log.settle('Flush', 2000, 10000);
    expect(rounds).toEqual([{ what: '3 hands vs Queen high', staked: 5000, returned: 14000, detail: 'Fold −$10, Pair of Kings +$20, Flush +$80' }]);
  });

  it('one hand reads as itself, and a result after the round is ignored', () => {
    const { rounds, history } = sink();
    const log = new RoundLog(history);
    log.start(1);
    log.settle('King vs 9', 2500, 5000);
    log.settle('late', 100, 0);
    expect(rounds).toEqual([{ what: 'King vs 9', staked: 2500, returned: 5000, detail: undefined }]);
  });
});
