import { describe, it, expect } from 'vitest';
import {
  type Hand,
  type Player,
  type MoveKind,
  applyMove,
  legal,
  nextToAct,
  endStreet,
  dealStreet,
  newHand,
  positions,
  computePots,
  awardPots,
  showdownOrder,
  handValue,
  dealOrder,
  player,
} from '../src/games/holdem/rules.ts';
import { cardInt } from '../src/games/holdem/eval.ts';
import type { Card } from '../src/cards.ts';

// The TDA fixtures count in chips; step 1 lets any chip amount be a legal size.
const STEP = 1;

/** A hand already past the preflop betting, everyone at `stacks`, nothing in the pot yet. */
function postflop(stacks: number[], bb: number, button = stacks.length - 1): Hand {
  const players: Player[] = stacks.map((s, seat) => ({
    seat,
    hole: [],
    start: s,
    put: 0,
    street: 0,
    folded: false,
    allIn: false,
    acted: null,
    last: null,
    shown: false,
    mucked: false,
  }));
  return {
    id: 1,
    sb: bb / 2,
    bb,
    button,
    sbSeat: (button + 1) % stacks.length,
    bbSeat: (button + 2) % stacks.length,
    deck: Array.from({ length: 52 }, (_, i) => i),
    pos: 0,
    board: [],
    players,
    street: 1,
    bet: 0,
    minRaise: bb,
    toAct: null,
    aggressor: null,
    closed: false,
  };
}

function act(h: Hand, seat: number, kind: MoveKind, to?: number) {
  const p = player(h, seat)!;
  const r = applyMove(h, p, kind, to, STEP);
  if (!r.ok) throw new Error(`seat ${seat} ${kind} ${to}: ${r.msg}`);
  return r;
}

const L = (h: Hand, seat: number) => legal(h, player(h, seat)!, STEP);
const A = 0, B = 1, C = 2, D = 3, E = 4, F = 5;

describe('holdem betting: TDA rule 49 worked examples (4.4)', () => {
  function example1(): Hand {
    // blinds 50/100, after the flop
    const h = postflop([10_000, 125, 10_000, 200, 10_000], 100);
    act(h, A, 'bet', 100);
    act(h, B, 'allin'); // 125: a short all-in
    act(h, C, 'call');
    act(h, D, 'allin'); // 200: another short all-in
    act(h, E, 'call');
    return h;
  }

  it('example 1: A faces a full raise in total and may raise', () => {
    const h = example1();
    expect(h.bet).toBe(200);
    expect(h.minRaise).toBe(100);
    expect(nextToAct(h, E)?.seat).toBe(A);
    const l = L(h, A);
    expect(l.toCall).toBe(100);
    expect(l.canRaise).toBe(true);
    expect(l.minTo).toBe(300);
  });

  it('1-A: A just calls, so C faces 75 more and may only call or fold', () => {
    const h = example1();
    act(h, A, 'call');
    expect(nextToAct(h, A)?.seat).toBe(C);
    const l = L(h, C);
    expect(l.toCall).toBe(75);
    expect(l.canRaise).toBe(false);
    expect(applyMove(h, player(h, C)!, 'raise', 400, STEP).ok).toBe(false);
    expect(applyMove(h, player(h, C)!, 'allin', undefined, STEP).ok).toBe(false);
    act(h, C, 'call');
    expect(nextToAct(h, C)).toBeNull();
  });

  it('1-B: A raises to 300, so C faces 175 and may re-raise', () => {
    const h = example1();
    act(h, A, 'raise', 300);
    expect(h.minRaise).toBe(100);
    const l = L(h, C);
    expect(l.toCall).toBe(175);
    expect(l.canRaise).toBe(true);
    expect(l.minTo).toBe(400);
  });

  it('example 2: three short all-ins leave the minimum raise at 300, so F raises to at least 1,100', () => {
    const h = postflop([10_000, 500, 650, 800, 10_000, 10_000], 100);
    act(h, A, 'bet', 300);
    act(h, B, 'allin');
    act(h, C, 'allin');
    act(h, D, 'allin');
    act(h, E, 'call');
    expect(h.bet).toBe(800);
    expect(h.minRaise).toBe(300);
    const l = L(h, F);
    expect(l.canRaise).toBe(true);
    expect(l.minTo).toBe(1_100);
    expect(applyMove(h, player(h, F)!, 'raise', 1_099, STEP).ok).toBe(false);
    act(h, F, 'raise', 1_100);
  });

  function example3(): Hand {
    // blinds 2,000/4,000, preflop. Seats: SB 0, BB 1, A 2, C 3 (the button).
    const h = newHand({
      id: 1,
      sb: 2_000,
      bb: 4_000,
      button: 3,
      sbSeat: 0,
      bbSeat: 1,
      players: [
        { seat: 0, stack: 100_000 },
        { seat: 1, stack: 100_000 },
        { seat: 2, stack: 100_000 },
        { seat: 3, stack: 7_500 },
      ],
      deck: Array.from({ length: 52 }, (_, i) => i),
    });
    expect(nextToAct(h, h.bbSeat)?.seat).toBe(2);
    act(h, 2, 'call');
    act(h, 3, 'allin'); // 7,500: 3,500 more, less than a full raise
    act(h, 0, 'fold');
    return h;
  }

  it('example 3-A: the big blind has not acted, so may raise to at least 11,500; if it calls, A may only call or fold', () => {
    const h = example3();
    expect(nextToAct(h, 0)?.seat).toBe(1);
    const bb = L(h, 1);
    expect(bb.canRaise).toBe(true);
    expect(bb.minTo).toBe(11_500);
    act(h, 1, 'call');
    const a = L(h, 2);
    expect(nextToAct(h, 1)?.seat).toBe(2);
    expect(a.toCall).toBe(3_500);
    expect(a.canRaise).toBe(false);
  });

  it('example 3-B: the big blind raises to 11,500, so A faces 7,500 and may re-raise', () => {
    const h = example3();
    act(h, 1, 'raise', 11_500);
    const a = L(h, 2);
    expect(a.toCall).toBe(7_500);
    expect(a.canRaise).toBe(true);
    expect(a.minTo).toBe(15_500);
  });

  it('an all-in below the minimum bet can be called or raised by at least one big blind over it (RRP)', () => {
    const h = postflop([20, 10_000, 10_000], 100);
    act(h, A, 'allin');
    expect(h.bet).toBe(20);
    expect(h.minRaise).toBe(100);
    const l = L(h, B);
    expect(l.toCall).toBe(20);
    expect(l.canRaise).toBe(true);
    expect(l.minTo).toBe(120);
  });

  it('the minimum bet is one big blind; a bet sets the next minimum raise', () => {
    const h = postflop([10_000, 10_000], 100);
    expect(applyMove(h, player(h, A)!, 'bet', 99, STEP).ok).toBe(false);
    act(h, A, 'bet', 150);
    expect(h.minRaise).toBe(150);
    expect(L(h, B).minTo).toBe(300);
    act(h, B, 'raise', 500); // raises by 350
    expect(h.minRaise).toBe(350);
    expect(L(h, A).minTo).toBe(850);
  });

  it('checking is only possible with nothing to call, and folding is refused when checking is free', () => {
    const h = postflop([10_000, 10_000], 100);
    expect(applyMove(h, player(h, A)!, 'fold', undefined, STEP).ok).toBe(false);
    act(h, A, 'check');
    act(h, B, 'bet', 100);
    expect(applyMove(h, player(h, A)!, 'check', undefined, STEP).ok).toBe(false);
    act(h, A, 'fold');
    expect(nextToAct(h, A)).toBeNull();
  });

  it('a short big blind posts what it has; the call stays a full blind and raises go to twice the blind', () => {
    const h = newHand({
      id: 1,
      sb: 50,
      bb: 100,
      button: 0,
      sbSeat: 1,
      bbSeat: 2,
      players: [
        { seat: 0, stack: 10_000 },
        { seat: 1, stack: 10_000 },
        { seat: 2, stack: 70 },
      ],
      deck: Array.from({ length: 52 }, (_, i) => i),
    });
    expect(player(h, 2)!.allIn).toBe(true);
    expect(h.bet).toBe(100);
    expect(L(h, 0).toCall).toBe(100);
    expect(L(h, 0).minTo).toBe(200);
  });

  it('bets must be in whole steps unless all-in', () => {
    const h = postflop([10_050, 10_000], 100);
    expect(applyMove(h, player(h, A)!, 'bet', 150, 100).ok).toBe(false);
    expect(applyMove(h, player(h, A)!, 'bet', 10_050, 100).ok).toBe(true);
  });
});

describe('holdem betting: heads-up order (4.2, TDA 36-C)', () => {
  it('the button posts the small blind, acts first before the flop and last after it', () => {
    const pos = positions([{ seat: 2, fresh: false }, { seat: 5, fresh: false }], 2, null, () => 0)!;
    expect(pos.button).toBe(5);
    expect(pos.sb).toBe(5);
    expect(pos.bb).toBe(2);
    const h = newHand({
      id: 1,
      sb: 50,
      bb: 100,
      button: pos.button,
      sbSeat: pos.sb,
      bbSeat: pos.bb,
      players: [
        { seat: 2, stack: 10_000 },
        { seat: 5, stack: 10_000 },
      ],
      deck: Array.from({ length: 52 }, (_, i) => i),
    });
    expect(player(h, 5)!.street).toBe(50);
    expect(player(h, 2)!.street).toBe(100);
    // the button is dealt last
    expect(dealOrder(h).map((p) => p.seat)).toEqual([2, 5]);
    expect(nextToAct(h, h.bbSeat)?.seat).toBe(5);
    act(h, 5, 'call');
    expect(nextToAct(h, 5)?.seat).toBe(2); // the big blind's option
    act(h, 2, 'check');
    expect(nextToAct(h, 2)).toBeNull();
    endStreet(h);
    dealStreet(h);
    expect(h.board).toHaveLength(3);
    expect(nextToAct(h, h.button)?.seat).toBe(2);
  });

  it('when a game goes heads-up, the last big blind gets the button', () => {
    const pos = positions([{ seat: 1, fresh: false }, { seat: 4, fresh: false }], 0, 4, () => 0)!;
    expect(pos.button).toBe(4);
    expect(pos.bb).toBe(1);
    // and heads-up the button then alternates
    const next = positions([{ seat: 1, fresh: false }, { seat: 4, fresh: false }], 4, 1, () => 0)!;
    expect(next.button).toBe(1);
    expect(next.bb).toBe(4);
  });
});

describe('holdem positions: moving button and new players (4.2)', () => {
  const seats = (...s: [number, boolean][]) => s.map(([seat, fresh]) => ({ seat, fresh }));

  it('moves the button one seat clockwise and puts the blinds on the next two', () => {
    const p = positions(seats([0, false], [2, false], [3, false], [7, false]), 2, 7, () => 0)!;
    expect(p).toEqual({ button: 3, sb: 7, bb: 0, dealt: [0, 2, 3, 7] });
    const q = positions(seats([0, false], [2, false], [3, false], [7, false]), 7, 2, () => 0)!;
    expect(q).toEqual({ button: 0, sb: 2, bb: 3, dealt: [0, 2, 3, 7] });
  });

  it('a new player waits for the big blind and is dealt in when it reaches them', () => {
    // seat 5 just sat down between the small blind and the big blind's next spot
    const p = positions(seats([0, false], [2, false], [4, false], [5, true]), 0, 4, () => 0)!;
    expect(p.button).toBe(2);
    expect(p.sb).toBe(4);
    expect(p.bb).toBe(5);
    expect(p.dealt).toEqual([0, 2, 4, 5]);
    // sitting just after the button, they wait: the button and blinds pass them first
    const q = positions(seats([0, false], [1, true], [2, false], [4, false]), 0, 4, () => 0)!;
    expect(q.button).toBe(2);
    expect(q.dealt).toEqual([0, 2, 4]);
    expect(q.dealt).not.toContain(1);
  });

  it('with fewer than three players in the game, everyone ready is dealt in', () => {
    const p = positions(seats([0, false], [3, true], [6, false]), 0, 6, () => 0)!;
    expect(p.dealt).toEqual([0, 3, 6]);
    expect(positions(seats([0, true], [3, true]), null, null, () => 1)!.button).toBe(3);
    expect(positions(seats([0, false]), null, null, () => 0)).toBeNull();
  });
});

describe('holdem pots: uncalled bets, side pots, odd chips (4.5, 4.6)', () => {
  it('returns an uncalled bet to its owner', () => {
    const h = postflop([10_000, 10_000, 10_000], 100);
    act(h, A, 'bet', 500);
    act(h, B, 'fold');
    act(h, C, 'fold');
    expect(endStreet(h)).toEqual({ seat: A, amount: 500 });
    expect(player(h, A)!.put).toBe(0);
  });

  it('returns only the part nobody could match when the caller is all-in for less', () => {
    const h = postflop([10_000, 200, 10_000], 100);
    act(h, A, 'bet', 500);
    act(h, B, 'call'); // all-in for 200
    act(h, C, 'fold');
    expect(nextToAct(h, C)).toBeNull();
    expect(endStreet(h)).toEqual({ seat: A, amount: 300 });
    expect(computePots(h.players)).toEqual([{ amount: 400, eligible: [A, B] }]);
  });

  it('keeps a folded bettor’s chips in the pot as dead money', () => {
    const h = postflop([10_000, 10_000, 10_000], 100);
    act(h, A, 'bet', 300);
    player(h, A)!.folded = true; // left the table out of turn
    act(h, B, 'call');
    act(h, C, 'fold');
    expect(endStreet(h)).toBeNull();
    expect(computePots(h.players)).toEqual([{ amount: 600, eligible: [B] }]);
  });

  it('the big blind wins the small blind when everyone folds, and gets its own extra back', () => {
    const h = newHand({
      id: 1,
      sb: 50,
      bb: 100,
      button: 0,
      sbSeat: 1,
      bbSeat: 2,
      players: [
        { seat: 0, stack: 10_000 },
        { seat: 1, stack: 10_000 },
        { seat: 2, stack: 10_000 },
      ],
      deck: Array.from({ length: 52 }, (_, i) => i),
    });
    act(h, 0, 'fold');
    act(h, 1, 'fold');
    expect(nextToAct(h, 1)).toBeNull();
    expect(endStreet(h)).toEqual({ seat: 2, amount: 50 });
    const awards = awardPots(h, new Map());
    expect(awards).toEqual([{ pot: 0, amount: 100, winners: [{ seat: 2, amount: 100 }], value: -1 }]);
  });

  it('builds a main pot and side pots from four all-ins and a fold', () => {
    // A 100, B 300, C 600, D 1,000 all in; E called 50 earlier and folded.
    const h = postflop([100, 300, 600, 1_000, 10_000], 100);
    act(h, A, 'allin');
    act(h, B, 'allin');
    act(h, C, 'allin');
    act(h, D, 'allin');
    player(h, E)!.put = 50;
    player(h, E)!.folded = true;
    expect(endStreet(h)).toEqual({ seat: D, amount: 400 });
    const pots = computePots(h.players);
    expect(pots).toEqual([
      { amount: 450, eligible: [A, B, C, D] },
      { amount: 600, eligible: [B, C, D] },
      { amount: 600, eligible: [C, D] },
    ]);
    const total = h.players.reduce((a, p) => a + p.put, 0);
    expect(pots.reduce((a, p) => a + p.amount, 0)).toBe(total);

    // A has the best hand, then C, then B, then D: A takes the main pot, C both side pots.
    const values = new Map([
      [A, 900],
      [B, 500],
      [C, 700],
      [D, 100],
    ]);
    const awards = awardPots(h, values);
    expect(awards.map((a) => a.winners)).toEqual([[{ seat: A, amount: 450 }], [{ seat: C, amount: 600 }], [{ seat: C, amount: 600 }]]);
  });

  it('with three all-ins at the same level, there is one pot', () => {
    const h = postflop([500, 500, 500, 10_000], 100);
    act(h, A, 'allin');
    act(h, B, 'call');
    act(h, C, 'call');
    act(h, D, 'call');
    expect(endStreet(h)).toBeNull();
    expect(computePots(h.players)).toEqual([{ amount: 2_000, eligible: [A, B, C, D] }]);
  });

  it('splits to the cent, odd cents first to the winners left of the button (TDA 21-A)', () => {
    // $5.00 three ways: 167, 167, 166. Button on seat 2, so seat 3 is first left of it.
    const h = postflop([10_000, 10_000, 10_000, 10_000], 100, 2);
    for (const s of [0, 1, 3]) player(h, s)!.put = 150;
    player(h, 2)!.put = 50;
    player(h, 2)!.folded = true;
    h.board = ['Ts', 'Js', 'Qs', 'Ks', 'As'].map((c) => cardInt(c as Card));
    for (const s of [0, 1, 3]) player(h, s)!.hole = [cardInt('2d'), cardInt('3c')];
    const values = new Map([0, 1, 3].map((s) => [s, handValue(h, player(h, s)!)] as [number, number]));
    const awards = awardPots(h, values);
    expect(awards).toHaveLength(1);
    expect(awards[0]!.winners).toEqual([
      { seat: 3, amount: 167 },
      { seat: 0, amount: 167 },
      { seat: 1, amount: 166 },
    ]);
  });

  it('split main and side pots add up to what was put in', () => {
    const h = postflop([1_000, 1_000, 333], 100, 0);
    act(h, B, 'allin');
    act(h, C, 'allin');
    act(h, A, 'call');
    expect(endStreet(h)).toBeNull();
    const pots = computePots(h.players);
    expect(pots).toEqual([
      { amount: 999, eligible: [A, B, C] },
      { amount: 1_334, eligible: [A, B] },
    ]);
    const awards = awardPots(h, new Map([[A, 5], [B, 5], [C, 1]]));
    expect(awards[0]!.winners).toEqual([
      { seat: B, amount: 500 },
      { seat: A, amount: 499 },
    ]);
    expect(awards[1]!.winners).toEqual([
      { seat: B, amount: 667 },
      { seat: A, amount: 667 },
    ]);
  });
});

describe('holdem showdown order (4.5, TDA 18-A)', () => {
  it('the last aggressor on the river shows first, then clockwise', () => {
    const h = postflop([10_000, 10_000, 10_000, 10_000], 100, 0);
    h.street = 3;
    act(h, B, 'check');
    act(h, C, 'bet', 200);
    act(h, D, 'call');
    act(h, A, 'call');
    act(h, B, 'call');
    expect(showdownOrder(h)).toEqual([C, D, A, B]);
  });

  it('with no river bet, the first live player left of the button shows first', () => {
    const h = postflop([10_000, 10_000, 10_000, 10_000], 100, 2);
    h.street = 3;
    player(h, D)!.folded = true;
    expect(showdownOrder(h)).toEqual([A, B, C]);
  });
});
