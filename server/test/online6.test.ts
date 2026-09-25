import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { connect, featsHad, login, type Client } from './helpers.ts';
import type { GameEngine, GameId } from '../../shared/src/engine.ts';
import { isRefusal } from '../../shared/src/engine.ts';
import { engineFor } from '../../shared/src/games/index.ts';
import { TableSim } from '../../shared/test/helpers/table-sim.ts';
import { seededRng } from '../../shared/test/helpers/seeded.ts';
import { hasLimitChoice, standardLimits } from '../../shared/src/limits.ts';
import { describeWin } from '../src/floor/wins.ts';

// Coinflip, Wheel, Cases and Diamonds on the real table host: every chip that moves at the table
// shows up in D1 exactly at the edges (buy-in and cash-out), a replayed action id is applied once,
// and standing up mid-streak at Coinflip cashes the streak out before the chips go home. Then the
// same hostile input as the older online games get (engines.test.ts): nothing throws, and no
// chip move is ever fractional, negative or more than a stack holds.

async function money(id: number) {
  return env.DB.prepare(`SELECT balance, in_play FROM casino_accounts WHERE id = ?1`).bind(id).first<{ balance: number; in_play: number }>();
}

/** Follow the seat's stack through the seat messages until `pred` holds. */
async function seat(c: Client, pred: (m: any) => boolean) {
  return c.next((m) => m.t === 'seat' && pred(m), 4_000);
}

/** The next events message that carries an event of one of these types. */
function events(c: Client, ...types: string[]) {
  return c.next((m) => m.t === 'ev' && m.events.some((e: any) => types.includes(e.type)), 4_000);
}

const ROUNDS: Record<'wheel' | 'cases' | 'diamonds', (i: number) => object> = {
  wheel: (i) => ({ type: 'spin', bet: 500, risk: (['low', 'medium', 'high'] as const)[i % 3], segments: [10, 20, 30, 40, 50][i % 5] }),
  cases: (i) => ({ type: 'open', bet: 500, case: (['starter', 'classic', 'highroller', 'vault'] as const)[i % 4], quick: i % 2 === 0 }),
  diamonds: () => ({ type: 'bet', bet: 500 }),
};

describe('the four new online games on the table host', () => {
  for (const game of ['wheel', 'cases', 'diamonds'] as const) {
    it(`${game}: rounds settle at the table, D1 moves only at the edges`, { timeout: 20_000 }, async () => {
      const { token, profile } = await login(`o6_${game}`);
      // the money here is checked to the cent: no feat pays beside the play
      await featsHad(profile.id);
      const c = (await connect(`solo/${game}`, token)).client!;
      const hello = await c.next((m) => m.t === 'table');
      expect(hello.meta.game).toBe(game);
      const start = (await money(profile.id))!.balance;
      c.send({ t: 'buyin', aid: 'b1', amount: 100_000 });
      await seat(c, (m) => m.status === 'seated');
      expect(await money(profile.id)).toEqual({ balance: start - 100_000, in_play: 100_000 });

      let stack = 100_000;
      for (let i = 0; i < 8; i++) {
        c.send({ t: 'act', aid: `r${i}`, a: ROUNDS[game](i) });
        const ev = await events(c, 'spin', 'open', 'draw');
        const e = ev.events.find((x: any) => x.seat === 0);
        // the event's own stack is the seat's after this round
        expect(e.stack).toBe(stack - 500 + e.payout);
        expect(e.payout).toBe(5 * e.mult);
        stack = e.stack;
      }
      expect(await money(profile.id)).toEqual({ balance: start - 100_000, in_play: 100_000 });
      c.send({ t: 'cashout', aid: 'c1' });
      const bal = await c.next((m) => m.t === 'balance' && m.inPlay === 0);
      expect(bal.balance).toBe(start - 100_000 + stack);
      expect(await money(profile.id)).toEqual({ balance: start - 100_000 + stack, in_play: 0 });
    });
  }

  it('coinflip: a streak rides at the table, and a replayed call is applied once', { timeout: 20_000 }, async () => {
    const { token, profile } = await login('o6_money_cf');
    // the money here is checked to the cent: no feat pays beside the play
    await featsHad(profile.id);
    const c = (await connect('solo/coinflip', token)).client!;
    await c.next((m) => m.t === 'table');
    const start = (await money(profile.id))!.balance;
    c.send({ t: 'buyin', aid: 'b1', amount: 50_000 });
    await seat(c, (m) => m.status === 'seated');

    let stack = 50_000;
    let rounds = 0;
    let replayed = false;
    for (let i = 0; i < 30 && rounds < 6; i++) {
      c.msgs.length = 0;
      c.send({ t: 'act', aid: `bet${i}`, a: { type: 'bet', amount: 1_000, side: i % 2 ? 'heads' : 'tails' } });
      let ev = await events(c, 'flip');
      stack -= 1_000;
      let view = ev.view;
      // call once more after a right first call; the second send of the same id is dropped
      if (view.phase === 'playing') {
        c.send({ t: 'act', aid: `flip${i}`, a: { type: 'flip', side: 'heads' } });
        if (!replayed) c.send({ t: 'act', aid: `flip${i}`, a: { type: 'flip', side: 'heads' } });
        ev = await events(c, 'flip');
        view = ev.view;
        if (!replayed) {
          await new Promise((r) => setTimeout(r, 150));
          expect(c.msgs.filter((m) => m.t === 'ev' && m.events.length > 0)).toHaveLength(0);
          expect(view.flips).toHaveLength(2);
          replayed = true;
        }
        if (view.phase === 'playing') {
          c.send({ t: 'act', aid: `cash${i}`, a: { type: 'cashout' } });
          ev = await events(c, 'over');
          view = ev.view;
        }
      }
      const over = ev.events.find((e: any) => e.type === 'over');
      expect(over).toBeTruthy();
      expect(over.payout).toBe(over.outcome === 'bust' ? 0 : 10 * over.mult);
      stack += over.payout;
      rounds++;
    }
    expect(replayed).toBe(true);
    c.send({ t: 'cashout', aid: 'c1' });
    const bal = await c.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(bal.balance).toBe(start - 50_000 + stack);
  });

  it('coinflip: cashing out mid-streak pays the streak before the chips go home', { timeout: 20_000 }, async () => {
    const { token, profile } = await login('o6_leave_cf');
    // the money here is checked to the cent: no feat pays beside the play
    await featsHad(profile.id);
    const c = (await connect('solo/coinflip', token)).client!;
    await c.next((m) => m.t === 'table');
    const start = (await money(profile.id))!.balance;
    c.send({ t: 'buyin', aid: 'b1', amount: 20_000 });
    await seat(c, (m) => m.status === 'seated');
    // bet until a right first call leaves a streak riding
    let stack = 20_000;
    for (let i = 0; i < 40; i++) {
      c.send({ t: 'act', aid: `bet${i}`, a: { type: 'bet', amount: 100, side: 'heads' } });
      const ev = await events(c, 'flip');
      stack -= 100;
      if (ev.view.phase === 'playing') break;
    }
    c.send({ t: 'cashout', aid: 'c1' });
    const ev = await events(c, 'over');
    const over = ev.events.find((e: any) => e.type === 'over');
    expect(over).toMatchObject({ outcome: 'cashout', streak: 1, mult: 198, payout: 198 });
    const bal = await c.next((m) => m.t === 'balance' && m.inPlay === 0);
    expect(bal.balance).toBe(start - 20_000 + stack + 198);
  });
});

// ---------------------------------------------------------------------------------------------

type Engine = GameEngine<any, any, any>;

function rand32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each game's real moves, for junk to be mixed into. */
const MOVES: unknown[] = [
  { type: 'bet', amount: 100, side: 'heads' },
  { type: 'flip', side: 'tails' },
  { type: 'cashout' },
  { type: 'spin', bet: 100, risk: 'high', segments: 50 },
  { type: 'open', bet: 100, case: 'vault', quick: true },
  { type: 'bet', bet: 100 },
];

/** Real moves with junk mixed in, and junk alone. */
function hostile(rand: () => number): unknown[] {
  const nums = [0, -1, 1, 0.5, 100, 150, 1e21, Number.MAX_SAFE_INTEGER, NaN, Infinity, '100', null, true, [], {}];
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
  const types = ['bet', 'flip', 'cashout', 'spin', 'open', 'draw', 'deal', '__proto__', 'toString', ''];
  const keys = ['amount', 'bet', 'side', 'risk', 'segments', 'case', 'quick', '__proto__', 'constructor'];
  const vals = [...nums, 'heads', 'tails', 'edge', 'low', 'medium', 'high', 10, 25, 50, 'starter', 'vault', 'safe', false];
  const out: unknown[] = [null, 1, 'bet', [], JSON.parse('{"__proto__": {"type": "bet"}}')];
  for (let i = 0; i < 400; i++) {
    const a: Record<string, unknown> = rand() < 0.5 ? { ...(pick(MOVES) as object) } : { type: pick(types) };
    const n = Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) a[pick(keys)] = pick(vals);
    out.push(a);
  }
  return out;
}

describe('hostile actions at the four new online games', () => {
  for (const game of ['coinflip', 'wheel', 'cases', 'diamonds'] as GameId[]) {
    it(`${game}: junk never throws, and nothing moves chips a stack can't cover`, () => {
      const engine = engineFor(game) as Engine;
      const rand = rand32(game.length * 977);
      const sim = new TableSim(engine, seededRng(17), 'solo', [{ seat: 0, stack: 2_000 }]);
      let applied = 0;
      for (let round = 0; round < 6; round++) {
        for (const raw of hostile(rand)) {
          let parsed: unknown;
          expect(() => (parsed = engine.parseAction(raw)), JSON.stringify(raw)).not.toThrow();
          if (parsed === null) continue;
          const res = engine.act(sim.state, 0, parsed, sim.ctx());
          if (isRefusal(res)) continue;
          // TableSim.apply throws on a fractional, negative or overdrawing chip move.
          sim.apply(res);
          applied++;
          JSON.stringify(sim.state);
        }
        // a seat leaving mid-round settles cleanly too
        sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
        expect(engine.liveBets(sim.state, 0)).toBe(0);
      }
      expect(applied).toBeGreaterThan(0);
      expect(Number.isSafeInteger(sim.stack(0)) && sim.stack(0) >= 0).toBe(true);
    });
  }
});

describe('the big-win feed and the limits know the four new games', () => {
  it('names what paid, to the hundredth of the multiplier', () => {
    expect(describeWin('coinflip', '', [{ type: 'flip' }, { type: 'over', outcome: 'cashout', streak: 7, mult: 12_672, payout: 126_720, bet: 1_000 }], 0, 1_000, 126_720)).toBe('7 right calls, 126.72x');
    expect(describeWin('wheel', '', [{ type: 'spin', seat: 0, risk: 'high', segments: 50, segment: 0, mult: 4_950, payout: 49_500 }], 0, 1_000, 49_500)).toBe('50 segments High, 49.50x');
    expect(describeWin('cases', '', [{ type: 'open', seat: 0, case: 'vault', item: 10, mult: 100_000, payout: 1_000_000 }], 0, 1_000, 1_000_000)).toBe('Briefcase of Cash, Vault case, 1,000x');
    expect(describeWin('diamonds', '', [{ type: 'draw', seat: 0, gems: [2, 2, 2, 2, 2], pattern: 'five', mult: 6_699, payout: 66_990 }], 0, 1_000, 66_990)).toBe('Five of a kind, 66.99x');
    // junk falls back to the plain multiple
    expect(describeWin('cases', '', [{ type: 'open', seat: 0, case: 'safe', item: 99 }], 0, 1_000, 20_000)).toBe('20x');
  });

  it('their limits are chosen like the other online games', () => {
    for (const game of ['coinflip', 'wheel', 'cases', 'diamonds'] as GameId[]) {
      expect(hasLimitChoice(game)).toBe(true);
      expect(standardLimits(game)).toEqual({ min: engineFor(game).config('', 'solo').limits.default.min, max: engineFor(game).config('', 'solo').limits.default.max });
    }
  });
});
