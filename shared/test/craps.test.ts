import { describe, it, expect } from 'vitest';
import { engine, type CrapsState, PAUSE_MS, MIN_PAUSE_MS, SHOOT_MS, LEAVING_ROLL_MS } from '../src/games/craps/engine.ts';
import type { CrapsView } from '../src/games/craps/protocol.ts';
import { BET_KINDS, NUMBERED, limitKey } from '../src/games/craps/rules.ts';
import type { Rng } from '../src/rng.ts';
import { randInt } from '../src/rng.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';

/** Loaded dice: each roll takes the next two queued faces. */
class Dice implements Rng {
  private q: number[] = [];
  set(d1: number, d2: number): void {
    this.q.push(d1 - 1, d2 - 1);
  }
  next32(): number {
    const x = this.q.shift();
    if (x === undefined) throw new Error('no dice queued');
    return x;
  }
}

const START = 1_000_000; // $10,000

function solo(cfgOptions: Record<string, unknown> = {}) {
  const dice = new Dice();
  const cfg = { ...engine.config('', 'solo'), options: { ...engine.config('', 'solo').options, ...cfgOptions } };
  const sim = new TableSim(engine, dice, 'solo', [{ seat: 0, stack: START }], cfg);
  const roll = (d1: number, d2: number) => {
    dice.set(d1, d2);
    sim.act(0, { type: 'roll' });
  };
  const v = () => sim.view(0) as CrapsView;
  return { sim, dice, roll, v };
}

function bet(kind: string, amount: number, number?: number) {
  return { type: 'bet', bets: [number === undefined ? { kind, amount } : { kind, number, amount }] };
}

function refusal(sim: TableSim<CrapsState, unknown, unknown>, seat: number, a: unknown): string | undefined {
  return sim.act(seat, a, { allowRefusal: true }).refused;
}

describe('craps engine: the line and the puck', () => {
  it('a come-out 7 wins the pass line, and the bet stays up for the next come-out', () => {
    const { sim, roll, v } = solo();
    sim.act(0, bet('pass', 1000));
    expect(sim.stack(0)).toBe(START - 1000);
    roll(3, 4);
    expect(sim.stack(0)).toBe(START);
    expect(v().bets[0]!.pass).toEqual({ amount: 1000 });
    expect(v().point).toBeNull();
    expect(sim.rounds).toEqual([{ seat: 0, wagered: 1000, returned: 2000 }]);
    roll(5, 6); // yo
    expect(sim.stack(0)).toBe(START + 1000);
  });

  it("bar 12: a come-out 12 loses the pass line and pushes don't pass", () => {
    const { sim, roll, v } = solo();
    sim.act(0, { type: 'bet', bets: [{ kind: 'pass', amount: 1000 }, { kind: 'dontpass', amount: 1000 }] });
    roll(6, 6);
    expect(v().bets[0]).toEqual({ dontpass: { amount: 1000 } });
    expect(sim.stack(0)).toBe(START - 2000);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 2000, returned: 1000 });
    roll(1, 2); // three craps: don't pass wins
    expect(sim.stack(0)).toBe(START - 1000);
  });

  it('sets the point, takes 3-4-5x odds, and pays the odds at true odds when the point is made', () => {
    const { sim, roll, v } = solo();
    sim.act(0, bet('pass', 1000));
    roll(2, 4);
    expect(v().point).toBe(6);
    expect(sim.lastEvents).toContainEqual({ type: 'puck', point: 6 });
    expect(refusal(sim, 0, { type: 'odds', on: 'pass', amount: 5001 })).toBe('LIMIT');
    sim.act(0, { type: 'odds', on: 'pass', amount: 5000 });
    expect(refusal(sim, 0, { type: 'down', id: 'pass' })).toBe('WRONG_PHASE');
    const before = sim.stack(0);
    roll(3, 3);
    // flat wins $10 and stays up; $50 odds come back with $60
    expect(sim.stack(0)).toBe(before + 1000 + 5000 + 6000);
    expect(v().bets[0]!.pass).toEqual({ amount: 1000 });
    expect(v().point).toBeNull();
    expect(v().pointsMade).toBe(1);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 6000, returned: 13000 });
  });

  it('odds limits by point: 3x on 4/10, 4x on 5/9, 5x on 6/8, 6x laid', () => {
    for (const [p, d1, d2, x] of [[4, 1, 3, 3], [5, 1, 4, 4], [6, 1, 5, 5], [8, 2, 6, 5], [9, 3, 6, 4], [10, 4, 6, 3]] as const) {
      const { sim, roll } = solo();
      sim.act(0, { type: 'bet', bets: [{ kind: 'pass', amount: 1200 }, { kind: 'dontpass', amount: 1200 }] });
      roll(d1, d2);
      expect(refusal(sim, 0, { type: 'odds', on: 'pass', amount: 1200 * x + 100 }), `take on ${p}`).toBe('LIMIT');
      sim.act(0, { type: 'odds', on: 'pass', amount: 1200 * x });
      expect(refusal(sim, 0, { type: 'odds', on: 'dontpass', amount: 1200 * 6 + 600 }), `lay on ${p}`).toBe('LIMIT');
      sim.act(0, { type: 'odds', on: 'dontpass', amount: 1200 * 6 });
    }
  });

  it("seven-out: pass and its odds lose, don't pass and its lay odds win", () => {
    const { sim, roll, v } = solo();
    sim.act(0, { type: 'bet', bets: [{ kind: 'pass', amount: 1000 }, { kind: 'dontpass', amount: 1000 }] });
    roll(1, 3);
    sim.act(0, { type: 'odds', on: 'pass', amount: 3000 });
    sim.act(0, { type: 'odds', on: 'dontpass', amount: 6000 });
    const before = sim.stack(0);
    roll(3, 4);
    // don't pass: $10 flat stays up and wins $10; $60 laid comes back with $30
    expect(sim.stack(0)).toBe(before + 1000 + 6000 + 3000);
    expect(v().bets[0]).toEqual({ dontpass: { amount: 1000 } });
    expect(sim.lastEvents).toContainEqual({ type: 'puck', point: null, sevenOut: true });
    expect(sim.lastEvents).toContainEqual({ type: 'shooter', seat: 0, why: 'sevenout' });
    expect(v().pointsMade).toBe(0);
  });

  it('only line bets on the come-out, only come bets with a point', () => {
    const { sim, roll } = solo();
    expect(refusal(sim, 0, bet('come', 1000))).toBe('WRONG_PHASE');
    expect(refusal(sim, 0, bet('dontcome', 1000))).toBe('WRONG_PHASE');
    sim.act(0, bet('pass', 1000));
    roll(4, 4);
    expect(refusal(sim, 0, bet('pass', 1000))).toBe('WRONG_PHASE');
    expect(refusal(sim, 0, bet('dontpass', 1000))).toBe('WRONG_PHASE');
    sim.act(0, bet('come', 1000));
    sim.act(0, bet('dontcome', 1000));
  });
});

describe('craps engine: come bets', () => {
  it('a come bet moves to its number, takes odds, and wins with them', () => {
    const { sim, roll, v } = solo();
    sim.act(0, bet('pass', 1000));
    roll(2, 3);
    sim.act(0, bet('come', 1000));
    roll(4, 4);
    expect(sim.lastEvents).toContainEqual({ type: 'move', seat: 0, from: 'come', id: 'come8', amount: 1000 });
    expect(v().bets[0]!.come8).toEqual({ amount: 1000 });
    expect(refusal(sim, 0, { type: 'down', id: 'come8' })).toBe('WRONG_PHASE');
    sim.act(0, { type: 'odds', on: 'come8', amount: 5000 });
    const before = sim.stack(0);
    roll(2, 6);
    expect(sim.stack(0)).toBe(before + 2000 + 5000 + 6000);
    expect(v().bets[0]!.come8).toBeUndefined();
  });

  it('the old come bet on a number is paid before a new one moves there', () => {
    const { sim, roll, v } = solo();
    sim.act(0, bet('pass', 1000));
    roll(2, 3);
    sim.act(0, bet('come', 1000));
    roll(4, 4);
    sim.act(0, bet('come', 2000));
    const before = sim.stack(0);
    roll(5, 3);
    expect(v().bets[0]!.come8).toEqual({ amount: 2000 });
    expect(sim.stack(0)).toBe(before + 2000);
  });

  it('come odds are off on the come-out: a come-out hit pays the flat bet and hands the odds back', () => {
    const { sim, roll, v } = solo();
    sim.act(0, bet('pass', 1000));
    roll(2, 3);
    sim.act(0, bet('come', 1000));
    roll(4, 4);
    sim.act(0, { type: 'odds', on: 'come8', amount: 1000 });
    roll(1, 4); // point made; puck off
    expect(v().point).toBeNull();
    const before = sim.stack(0);
    roll(2, 6);
    expect(sim.stack(0)).toBe(before + 2000 + 1000);
    expect(sim.lastEvents).toContainEqual({ type: 'result', seat: 0, id: 'come8', flat: 'win', odds: 'returned', win: 1000, back: 3000 });
  });

  it('a come-out 7 loses come bets on numbers and hands their odds back', () => {
    const { sim, roll } = solo();
    sim.act(0, bet('pass', 1000));
    roll(2, 3);
    sim.act(0, bet('come', 1000));
    roll(4, 4);
    sim.act(0, { type: 'odds', on: 'come8', amount: 1000 });
    roll(1, 4);
    const before = sim.stack(0);
    roll(3, 4); // come-out 7: pass (up for the new come-out) wins, come 8 loses, its odds come back
    expect(sim.stack(0)).toBe(before + 1000 + 1000);
  });

  it('come odds called on work on the come-out', () => {
    const { sim, roll } = solo();
    sim.act(0, bet('pass', 1000));
    roll(2, 3);
    sim.act(0, bet('come', 1000));
    roll(4, 4);
    sim.act(0, { type: 'odds', on: 'come8', amount: 1000 });
    sim.act(0, { type: 'working', id: 'come8', on: true });
    roll(1, 4);
    const before = sim.stack(0);
    roll(2, 6);
    expect(sim.stack(0)).toBe(before + 2000 + 1000 + 1200);
  });

  it("don't come: bar 12 in the box, then lay odds win on a seven, and they work on the come-out", () => {
    const { sim, roll, v } = solo();
    sim.act(0, bet('pass', 1000));
    roll(2, 2);
    sim.act(0, bet('dontcome', 1000));
    let before = sim.stack(0);
    roll(6, 6);
    expect(sim.stack(0)).toBe(before + 1000); // pushed and handed back
    sim.act(0, bet('dontcome', 1000));
    roll(4, 5);
    expect(v().bets[0]!.dontcome9).toEqual({ amount: 1000 });
    expect(refusal(sim, 0, { type: 'odds', on: 'dontcome9', amount: 100 })).toBe('LIMIT'); // $3 steps on 5/9
    sim.act(0, { type: 'odds', on: 'dontcome9', amount: 600 });
    roll(2, 2); // point made
    before = sim.stack(0);
    roll(3, 4); // come-out 7: don't come on 9 wins with its lay odds (on by default); the pass line wins too
    expect(sim.stack(0)).toBe(before + 2000 + 600 + 400 + 1000);
  });
});

describe('craps engine: place, buy, hardways and props', () => {
  it('place bets are off on the come-out unless called on, and stay up after a win', () => {
    const { sim, roll, v } = solo();
    sim.act(0, { type: 'bet', bets: [{ kind: 'pass', amount: 1000 }, { kind: 'place', number: 6, amount: 600 }] });
    let before = sim.stack(0);
    roll(3, 3); // point 6; place 6 is off
    expect(sim.stack(0)).toBe(before);
    before = sim.stack(0);
    roll(4, 2); // point made: the pass line wins $10 and place 6 (working) wins $7; both stay up
    expect(sim.stack(0)).toBe(before + 700 + 1000);
    expect(v().bets[0]!.place6).toEqual({ amount: 600 });
    sim.act(0, { type: 'working', id: 'place6', on: true });
    before = sim.stack(0);
    roll(5, 1); // come-out 6, called on
    expect(sim.stack(0)).toBe(before + 700);
  });

  it('a seven-out takes place and buy bets', () => {
    const { sim, roll, v } = solo();
    sim.act(0, bet('pass', 1000));
    roll(4, 5);
    sim.act(0, { type: 'bet', bets: [{ kind: 'place', number: 8, amount: 1200 }, { kind: 'buy', number: 4, amount: 2000 }] });
    roll(1, 3);
    expect(sim.lastEvents).toContainEqual({ type: 'result', seat: 0, id: 'buy4', flat: 'win', odds: null, win: 3900, back: 3900 });
    roll(3, 4);
    expect(v().bets[0]).toEqual({});
  });

  it('hardways work on the come-out, lose the easy way, and can be called off', () => {
    const { sim, roll, v } = solo();
    sim.act(0, bet('hard', 100, 8));
    roll(2, 6);
    expect(v().bets[0]!.hard8).toBeUndefined();
    sim.act(0, bet('hard', 100, 8));
    let before = sim.stack(0);
    roll(4, 4);
    expect(sim.stack(0)).toBe(before + 900);
    sim.act(0, { type: 'working', id: 'hard8', on: false });
    before = sim.stack(0);
    roll(3, 4);
    expect(sim.stack(0)).toBe(before);
    expect(v().bets[0]!.hard8).toEqual({ amount: 100, on: false });
  });

  it('field and props settle in one roll', () => {
    const { sim, roll } = solo();
    sim.act(0, { type: 'bet', bets: [{ kind: 'field', amount: 500 }, { kind: 'aces', amount: 100 }, { kind: 'horn', amount: 400 }, { kind: 'ce', amount: 200 }, { kind: 'any7', amount: 100 }] });
    const before = sim.stack(0);
    roll(1, 1); // field 2:1 +$10, aces 30:1 +$30, horn +$27, C&E +$6, any 7 loses $1
    expect(sim.stack(0)).toBe(before + 1000 + 3000 + 2700 + 600);
  });

  it('bet steps keep every payout exact', () => {
    const { sim } = solo();
    expect(refusal(sim, 0, bet('place', 500, 6))).toBe('LIMIT');
    expect(refusal(sim, 0, bet('place', 600, 5))).toBe('LIMIT');
    expect(refusal(sim, 0, bet('horn', 500))).toBe('LIMIT');
    expect(refusal(sim, 0, bet('ce', 300))).toBe('LIMIT');
    expect(refusal(sim, 0, bet('pass', 900))).toBe('LIMIT');
    sim.act(0, bet('place', 1200, 6));
    sim.act(0, bet('place', 1000, 5));
    sim.act(0, bet('horn', 800));
    sim.act(0, bet('ce', 400));
    // the table publishes each limit and step in its config
    const l = sim.cfg.limits;
    expect([l.place6!.step, l.place4!.step, l.horn!.step, l.ce!.step, l.layOdds5!.step, l.layOdds6!.step]).toEqual([600, 500, 400, 200, 300, 600]);
  });

  it('refuses a bet bigger than the stack, all or nothing', () => {
    const dice = new Dice();
    const sim = new TableSim(engine, dice, 'solo', [{ seat: 0, stack: 2500 }]);
    expect(refusal(sim, 0, { type: 'bet', bets: [{ kind: 'pass', amount: 2000 }, { kind: 'field', amount: 1000 }] })).toBe('NOT_ENOUGH_CHIPS');
    expect(sim.stack(0)).toBe(2500);
  });
});

describe('craps engine: lay bets (house option)', () => {
  it('are refused unless the table books them', () => {
    const { sim } = solo();
    expect(refusal(sim, 0, bet('lay', 4000, 4))).toBe('WRONG_PHASE');
  });

  it('charge 5% of the win up front, hand it back when taken down, and pay true odds on a seven', () => {
    const { sim, roll } = solo({ lay: true });
    expect(refusal(sim, 0, bet('lay', 4100, 4))).toBe('LIMIT'); // $2 steps
    sim.act(0, bet('lay', 4000, 4));
    expect(sim.stack(0)).toBe(START - 4100);
    sim.act(0, { type: 'down', id: 'lay4' });
    expect(sim.stack(0)).toBe(START);
    sim.act(0, bet('lay', 4000, 4));
    roll(3, 4);
    expect(sim.stack(0)).toBe(START - 100 + 2000);
    expect(sim.rounds.at(-1)).toEqual({ seat: 0, wagered: 4100, returned: 6000 });
  });
});

describe('craps engine: taking bets down', () => {
  it("don't pass can come down after the point, but can't go back up", () => {
    const { sim, roll } = solo();
    sim.act(0, bet('dontpass', 1000));
    roll(2, 2);
    sim.act(0, { type: 'down', id: 'dontpass' });
    expect(sim.stack(0)).toBe(START);
    expect(refusal(sim, 0, bet('dontpass', 1000))).toBe('WRONG_PHASE');
  });

  it('odds come down on their own; a flat bet reduced below its odds is refused', () => {
    const { sim, roll, v } = solo();
    sim.act(0, bet('dontpass', 2000));
    roll(3, 3);
    sim.act(0, { type: 'odds', on: 'dontpass', amount: 12000 });
    expect(refusal(sim, 0, { type: 'down', id: 'dontpass', amount: 1000 })).toBe('LIMIT');
    sim.act(0, { type: 'down', id: 'dontpass', part: 'odds', amount: 6000 });
    sim.act(0, { type: 'down', id: 'dontpass', amount: 1000 });
    expect(v().bets[0]!.dontpass).toEqual({ amount: 1000, odds: 6000 });
  });
});

describe('craps engine: leaving with contract bets', () => {
  it('hands back what can come down and keeps rolling (solo) until the contract bets resolve', () => {
    const { sim, dice, roll, v } = solo();
    sim.act(0, bet('pass', 1000));
    roll(2, 4);
    sim.act(0, { type: 'odds', on: 'pass', amount: 2000 });
    sim.act(0, { type: 'bet', bets: [{ kind: 'come', amount: 1000 }, { kind: 'field', amount: 500 }, { kind: 'place', number: 8, amount: 600 }] });
    roll(4, 5); // come to 9; field wins and stays
    sim.act(0, { type: 'odds', on: 'come9', amount: 1000 });
    const stackBefore = sim.stack(0);
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    // odds, the field and place 8 come back; pass and come 9 stay working
    expect(sim.stack(0)).toBe(stackBefore + 2000 + 500 + 600 + 1000);
    expect(engine.liveBets(sim.state, 0)).toBe(2000);
    expect(v().leaving).toEqual([0]);
    expect(engine.deadline(sim.state)).toBe(sim.now + LEAVING_ROLL_MS);
    dice.set(3, 3); // point made; the pass bet comes down for the leaving seat
    sim.advance(LEAVING_ROLL_MS);
    expect(v().bets[0]).toEqual({ come9: { amount: 1000 } });
    dice.set(1, 1);
    sim.advance(LEAVING_ROLL_MS);
    dice.set(5, 4); // come 9 wins
    sim.advance(LEAVING_ROLL_MS);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.deadline(sim.state)).toBeNull();
    // the host's sweep calls seatLeaving again and cashes the seat out
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(v().leaving).toEqual([]);
    expect(v().bets[0]).toBeUndefined();
  });

  it('with nothing under contract, leaving returns everything at once', () => {
    const { sim } = solo();
    sim.act(0, { type: 'bet', bets: [{ kind: 'pass', amount: 1000 }, { kind: 'hard', number: 6, amount: 500 }] });
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(sim.stack(0)).toBe(START);
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(engine.deadline(sim.state)).toBeNull();
  });
});

describe('craps engine: multiplayer shooter', () => {
  function multi() {
    const dice = new Dice();
    const sim = new TableSim(engine, dice, 'multi', [{ seat: 0, stack: START }, { seat: 2, stack: START }, { seat: 5, stack: START }]);
    sim.started = true;
    sim.advance(0);
    const v = () => sim.view(0) as CrapsView;
    return { sim, dice, v };
  }

  it('opens with a betting pause and the first seat shooting; the shooter needs a line bet', () => {
    const { sim, v } = multi();
    expect(v().phase).toBe('open');
    expect(v().shooter).toBe(0);
    expect(v().pauseUntil).toBe(sim.now + PAUSE_MS);
    expect(v().rollBy).toBe(sim.now + PAUSE_MS + SHOOT_MS);
    expect(refusal(sim, 0, { type: 'roll' })).toBe('WRONG_PHASE');
    expect(refusal(sim, 2, { type: 'roll' })).toBe('NOT_YOUR_TURN');
  });

  it('a throw during the pause waits for it; everyone else ready ends it early (but not before the dice settle)', () => {
    const { sim, dice, v } = multi();
    sim.act(0, bet('pass', 1000));
    sim.act(0, { type: 'roll' });
    expect(v().rollRequested).toBe(true);
    expect(v().rolls).toBe(0);
    sim.seats.get(2)!.ready = true;
    sim.seats.get(5)!.ready = true;
    sim.advance(1000);
    expect(v().pauseUntil).toBe(sim.now - 1000 + MIN_PAUSE_MS);
    dice.set(1, 3);
    sim.advance(MIN_PAUSE_MS - 1000);
    expect(v().rolls).toBe(1);
    expect(v().point).toBe(4);
  });

  it('rolls for a shooter who runs out of time, and passes the dice clockwise after a seven-out', () => {
    const { sim, dice, v } = multi();
    sim.act(0, bet('pass', 1000));
    sim.advance(PAUSE_MS);
    expect(v().pauseOver).toBe(true);
    dice.set(1, 3);
    sim.advance(SHOOT_MS);
    expect(sim.lastEvents[0]).toMatchObject({ type: 'roll', auto: true, dice: [1, 3] });
    dice.set(3, 4);
    sim.advance(PAUSE_MS + SHOOT_MS);
    expect(v().shooter).toBe(2);
    expect(sim.lastEvents).toContainEqual({ type: 'shooter', seat: 2, why: 'sevenout' });
  });

  it('on the come-out, the dice skip a shooter with no line bet', () => {
    const { sim, v } = multi();
    sim.act(5, bet('dontpass', 1000));
    sim.advance(PAUSE_MS + SHOOT_MS);
    expect(v().shooter).toBe(5);
    expect(sim.lastEvents).toContainEqual({ type: 'shooter', seat: 5, why: 'nobet' });
    expect(v().rolls).toBe(0);
  });

  it('when the shooter leaves, the dice go to the next seat; contract bets stay until decided', () => {
    const { sim, dice, v } = multi();
    sim.act(0, bet('pass', 1000));
    sim.act(2, bet('pass', 1000));
    sim.advance(PAUSE_MS);
    dice.set(2, 3);
    sim.act(0, { type: 'roll' });
    expect(v().point).toBe(5);
    sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
    expect(v().shooter).toBe(2);
    expect(v().leaving).toEqual([0]);
    expect(engine.liveBets(sim.state, 0)).toBe(1000);
    sim.advance(PAUSE_MS);
    dice.set(4, 1);
    sim.act(2, { type: 'roll' });
    expect(engine.liveBets(sim.state, 0)).toBe(0);
    expect(sim.stack(0)).toBe(START + 1000);
  });

  it('with only leaving seats left, the table rolls on its own until their bets resolve', () => {
    const dice = new Dice();
    const sim = new TableSim(engine, dice, 'multi', [{ seat: 3, stack: START }]);
    sim.started = true;
    sim.advance(0);
    sim.act(3, bet('pass', 1000));
    sim.advance(PAUSE_MS);
    dice.set(2, 4);
    sim.act(3, { type: 'roll' });
    sim.apply(engine.seatLeaving(sim.state, 3, sim.ctx()));
    expect((sim.view(3) as CrapsView).shooter).toBeNull();
    expect(engine.deadline(sim.state)).toBe(sim.now + LEAVING_ROLL_MS);
    dice.set(6, 1);
    sim.advance(LEAVING_ROLL_MS);
    expect(engine.liveBets(sim.state, 3)).toBe(0);
    expect((sim.view(3) as CrapsView).phase).toBe('idle');
  });

  it('shiftDeadlines pushes every timer back', () => {
    const { sim } = multi();
    const s = engine.shiftDeadlines(sim.state, 5000);
    expect([s.pauseUntil, s.minPauseEnd, s.rollBy]).toEqual([sim.state.pauseUntil! + 5000, sim.state.minPauseEnd! + 5000, sim.state.rollBy! + 5000]);
  });
});

describe('craps engine: parsing and accounting', () => {
  it('parses only well-formed actions', () => {
    const p = engine.parseAction;
    expect(p({ type: 'bet', bets: [{ kind: 'place', number: 6, amount: 600 }] })).not.toBeNull();
    expect(p({ type: 'bet', bets: [{ kind: 'place', number: 7, amount: 600 }] })).toBeNull();
    expect(p({ type: 'bet', bets: [{ kind: 'field', number: 2, amount: 500 }] })).toBeNull();
    expect(p({ type: 'bet', bets: [{ kind: 'pass', amount: -5 }] })).toBeNull();
    expect(p({ type: 'bet', bets: [] })).toBeNull();
    expect(p({ type: 'odds', on: 'place6', amount: 100 })).toBeNull();
    expect(p({ type: 'odds', on: 'come6', amount: 100 })).not.toBeNull();
    expect(p({ type: 'down', id: 'come8', part: 'odds' })).not.toBeNull();
    expect(p({ type: 'down', id: 'come7' })).toBeNull();
    expect(p({ type: 'working', id: 'place6', on: null })).not.toBeNull();
    expect(p({ type: 'working', id: 'place6', on: 'yes' })).toBeNull();
    expect(p({ type: 'roll' })).toEqual({ type: 'roll' });
    expect(p({ type: 'shoot' })).toBeNull();
  });

  it('never loses or makes a cent: stack + chips on the layout + live commission = start + net of every decided bet', () => {
    const dice = seededRng(20260922);
    const pick = seededRng(7);
    const cfg = { ...engine.config('', 'solo'), options: { lay: true } };
    const sim = new TableSim(engine, dice, 'solo', [{ seat: 0, stack: 50_000_000 }], cfg);
    const kinds = BET_KINDS;
    let net = 0;
    for (let i = 0; i < 3000; i++) {
      for (let j = 0; j < 3; j++) {
        const kind = kinds[randInt(pick, kinds.length)]!;
        const nums = NUMBERED[kind];
        const number = nums ? nums[randInt(pick, nums.length)] : undefined;
        const lk = sim.cfg.limits[limitKey(kind, number)] ?? sim.cfg.limits.default;
        sim.act(0, bet(kind, lk.min * (1 + randInt(pick, 3)), number), { allowRefusal: true });
      }
      const mine = (sim.view(0) as CrapsView).bets[0] ?? {};
      for (const id of Object.keys(mine)) {
        if (/^(pass|dontpass|come\d+|dontcome\d+)$/.test(id) && randInt(pick, 2)) sim.act(0, { type: 'odds', on: id, amount: 600 * (1 + randInt(pick, 2)) }, { allowRefusal: true });
        if (randInt(pick, 8) === 0) sim.act(0, { type: 'down', id }, { allowRefusal: true });
        if (randInt(pick, 8) === 0) sim.act(0, { type: 'working', id, on: randInt(pick, 2) === 0 }, { allowRefusal: true });
      }
      const n0 = sim.rounds.length;
      sim.act(0, { type: 'roll' }, { allowRefusal: true });
      for (const r of sim.rounds.slice(n0)) net += r.returned - r.wagered;
      const v = sim.view(0) as CrapsView;
      const vig = Object.values(v.bets[0] ?? {}).reduce((a, b) => a + (b.vig ?? 0), 0);
      expect(sim.stack(0) + engine.liveBets(sim.state, 0) + vig).toBe(50_000_000 + net);
    }
    expect(sim.rounds.length).toBeGreaterThan(2000);
  });
});
