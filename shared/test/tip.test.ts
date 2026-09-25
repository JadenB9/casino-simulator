import { describe, expect, it } from 'vitest';
import { ENGINES } from '../src/games/index.ts';
import { applyLimits } from '../src/limits.ts';
import { parseTableMsg } from '../src/protocol.ts';
import { TIP_GAMES, canTip, tipAmounts, tipRefusal } from '../src/tip.ts';

describe('tipping the dealer', () => {
  it('offers the table minimum and twice it (Hold\'em: the big blind), at any limits', () => {
    expect(tipAmounts(ENGINES.blackjack.config('', 'solo'))).toEqual([2_500, 5_000]);
    expect(tipAmounts(applyLimits(ENGINES.blackjack.config('', 'solo'), { min: 100_000, max: 5_000_000 }))).toEqual([100_000, 200_000]);
    const he = ENGINES.holdem.config('', 'solo');
    expect(tipAmounts(he)[0]).toBe(Number(he.options.bb));
    for (const g of TIP_GAMES) expect(tipAmounts(ENGINES[g].config('', 'solo'))[0]).toBeGreaterThan(0);
  });

  it('is for tables with a dealer, not machines or the lounge computers', () => {
    expect(canTip('craps')).toBe(true);
    expect(canTip('bingo')).toBe(true);
    expect(canTip('slots')).toBe(false);
    expect(canTip('videopoker')).toBe(false);
    expect(canTip('plinko')).toBe(false);
  });

  it('takes whole cents the stack covers, between hands only', () => {
    expect(tipRefusal(2_500, 10_000, 0, false)).toBeNull();
    expect(tipRefusal(10_000, 10_000, 0, false)).toBeNull();
    expect(tipRefusal(10_001, 10_000, 0, false)?.code).toBe('LIMIT');
    expect(tipRefusal(2_500, 10_000, 500, false)?.code).toBe('WRONG_PHASE');
    expect(tipRefusal(2_500, 10_000, 0, true)?.code).toBe('WRONG_PHASE');
    for (const bad of [0, -100, 12.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) expect(tipRefusal(bad, 10_000, 0, false)?.code).toBe('BAD_REQUEST');
  });

  it('parses only a positive whole amount with an action id', () => {
    expect(parseTableMsg({ t: 'tip', aid: 'a1', amount: 2_500 })).toEqual({ t: 'tip', aid: 'a1', amount: 2_500 });
    expect(parseTableMsg({ t: 'tip', aid: 'a1', amount: 0 })).toBeNull();
    expect(parseTableMsg({ t: 'tip', aid: 'a1', amount: -5 })).toBeNull();
    expect(parseTableMsg({ t: 'tip', aid: 'a1', amount: 2.5 })).toBeNull();
    expect(parseTableMsg({ t: 'tip', aid: 'a1', amount: '2500' })).toBeNull();
    expect(parseTableMsg({ t: 'tip', amount: 2_500 })).toBeNull();
  });
});
