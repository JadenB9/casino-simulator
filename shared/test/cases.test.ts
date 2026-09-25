import { describe, it, expect } from 'vitest';
import { CASES, CASE_INFO, WEIGHT, caseReturn, itemAt, rarityOf, isCase, payoutFor } from '../src/games/cases/rules.ts';
import { engine, REEL_MS, QUICK_MS, type CasesAction, type CasesEvent, type CasesState, type CasesView } from '../src/games/cases/engine.ts';
import { TableSim } from './helpers/table-sim.ts';
import { queuedRng } from './online-rng.ts';

type Sim = TableSim<CasesState, CasesAction, CasesView>;

function solo(queue: number[] = [], stack = 1_000_000): Sim {
  return new TableSim(engine, queuedRng(queue, 6), 'solo', [{ seat: 0, stack }]);
}

describe('cases', () => {
  it('each case weighs exactly a million and returns exactly 99%', () => {
    for (const id of CASES) {
      const items = CASE_INFO[id].items;
      expect(items.reduce((a, it) => a + it.weight, 0)).toBe(WEIGHT);
      const r = caseReturn(id);
      expect(r.num * 100).toBe(r.den * 99);
      // cheapest first, all different, every weight positive
      for (let i = 1; i < items.length; i++) expect(items[i]!.mult).toBeGreaterThan(items[i - 1]!.mult);
      for (const it of items) expect(Number.isInteger(it.weight) && it.weight > 0).toBe(true);
    }
  });

  it('tops out at 10×, 50×, 250× and 1,000×, and says so', () => {
    expect(CASES.map((id) => CASE_INFO[id].items.at(-1)!.mult)).toEqual([1_000, 5_000, 25_000, 100_000]);
    expect(Math.round(WEIGHT / CASE_INFO.classic.items.at(-1)!.weight)).toBe(680);
    expect(Math.round(WEIGHT / CASE_INFO.highroller.items.at(-1)!.weight)).toBe(4_386);
    expect(Math.round(WEIGHT / CASE_INFO.vault.items.at(-1)!.weight)).toBe(17_544);
    const starter = CASE_INFO.starter.items.filter((it) => it.mult > 100).reduce((a, it) => a + it.weight, 0) / WEIGHT;
    expect(starter).toBeGreaterThan(0.33);
    expect(starter).toBeLessThan(0.35);
  });

  it('lays the items end to end: every draw below a million lands on one, at the exact edges', () => {
    for (const id of CASES) {
      let at = 0;
      CASE_INFO[id].items.forEach((it, i) => {
        expect(itemAt(id, at)).toBe(i);
        expect(itemAt(id, at + it.weight - 1)).toBe(i);
        at += it.weight;
      });
      expect(at).toBe(WEIGHT);
    }
  });

  it('gives each multiplier a rarity', () => {
    expect([5, 99, 100, 199, 200, 499, 500, 1_999, 2_000, 9_999, 10_000, 49_999, 50_000, 100_000].map(rarityOf)).toEqual([
      'common', 'common', 'uncommon', 'uncommon', 'rare', 'rare', 'epic', 'epic', 'legendary', 'legendary', 'mythic', 'mythic', 'exotic', 'exotic',
    ]);
    expect(isCase('vault') && !isCase('safe')).toBe(true);
    expect(payoutFor(700, 'vault', 10)).toBe(700_000);
  });
});

describe('cases engine', () => {
  it('opens a case onto the drawn item and pays it (every item of every case, and its edges)', () => {
    for (const id of CASES) {
      const items = CASE_INFO[id].items;
      const draws: number[] = [];
      let at = 0;
      for (const it of items) {
        draws.push(at, at + it.weight - 1);
        at += it.weight;
      }
      const sim = solo(draws);
      for (let i = 0; i < draws.length; i++) {
        const before = sim.stack(0);
        sim.act(0, { type: 'open', bet: 200, case: id, quick: i % 2 === 1 });
        const e = sim.lastEvents[0] as CasesEvent;
        const k = Math.floor(i / 2);
        expect(e).toMatchObject({ type: 'open', case: id, item: k, mult: items[k]!.mult, payout: 2 * items[k]!.mult, quick: i % 2 === 1 });
        expect(e.restAt).toBe(sim.now + (i % 2 ? QUICK_MS : REEL_MS));
        expect(sim.stack(0) - before).toBe(e.payout - 200);
        expect(e.stack).toBe(sim.stack(0));
      }
    }
  });

  it('refuses bets off the limits or the stack, and junk', () => {
    const sim = solo([], 500);
    expect(sim.act(0, { type: 'open', bet: 50, case: 'starter' }, { allowRefusal: true }).refused).toBe('LIMIT');
    expect(sim.act(0, { type: 'open', bet: 600, case: 'starter' }, { allowRefusal: true }).refused).toBe('NOT_ENOUGH_CHIPS');
    expect(engine.parseAction({ type: 'open', bet: 100, case: 'safe' })).toBeNull();
    expect(engine.parseAction({ type: 'open', bet: 100, case: 'vault', quick: 'yes' })).toBeNull();
    expect(engine.parseAction({ type: 'open', bet: 100, case: 'vault' })).toEqual({ type: 'open', bet: 100, case: 'vault', quick: false });
  });
});
