// The Hold'em bots, piece by piece: the starting-hand charts and order, what a hand is worth on a
// board, equity against a range, the decisions a solid player makes in textbook spots, the line-up
// by stakes, the reads, tilt, how fast a decision is, and that a bot only ever sees its own cards.
// (Who beats whom over many hands is holdem-bots.mc.test.ts.)

import { describe, it, expect } from 'vitest';
import { parseRange, CHART_WIDTH, ORDER, TOP, className, handClass, dealKind, kindInTop, strength } from '../src/games/holdem/ranges.ts';
import { classify, texture } from '../src/games/holdem/postflop.ts';
import { decide, rangeEquity, lineUp, drawBot, openWidth, PERSONAS, type BotSituation } from '../src/games/holdem/bots.ts';
import { observe, tendency, PRIOR, type Act, type Reads } from '../src/games/holdem/reads.ts';
import { engine, botSituation, type HoldemState, type HoldemView, type HoldemAction } from '../src/games/holdem/engine.ts';
import * as R from '../src/games/holdem/rules.ts';
import { cardInt } from '../src/games/holdem/eval.ts';
import type { Card } from '../src/cards.ts';
import { TableSim } from './helpers/table-sim.ts';
import { seededRng } from './helpers/seeded.ts';
import { PRIOR as P } from '../src/games/holdem/reads.ts';

const c = (s: string) => s.split(' ').map((x) => cardInt(x as Card));

describe('the starting-hand charts', () => {
  it('reads range notation the way players write it', () => {
    expect(parseRange('22+').size).toBe(13);
    expect(parseRange('A2s+').size).toBe(12);
    expect(parseRange('ATo+').size).toBe(4);
    expect(parseRange('AK').size).toBe(2);
    expect([...parseRange('76s-54s')].map(className).sort()).toEqual(['54s', '65s', '76s']);
    expect([...parseRange('K9s-K7s')].map(className).sort()).toEqual(['K7s', 'K8s', 'K9s']);
  });

  it('opens about the standard share of hands from each seat', () => {
    // UTG9, UTG, HJ, CO, BTN
    const w = CHART_WIDTH.slice(2, 7);
    expect(w[0]).toBeGreaterThan(0.08);
    expect(w[0]).toBeLessThan(0.12);
    expect(w[1]).toBeGreaterThan(0.15);
    expect(w[1]).toBeLessThan(0.2);
    expect(w[3]).toBeGreaterThan(0.25);
    expect(w[3]).toBeLessThan(0.32);
    expect(w[4]).toBeGreaterThan(0.42);
    expect(w[4]).toBeLessThan(0.5);
    for (let i = 1; i < CHART_WIDTH.length; i++) expect(CHART_WIDTH[i]).toBeGreaterThan(CHART_WIDTH[i - 1]!);
    expect(openWidth(3, 6)).toBe(CHART_WIDTH[3]);
    expect(openWidth(0, 6)).toBeGreaterThan(openWidth(1, 6));
    expect(openWidth(7, 9)).toBeLessThan(openWidth(3, 9));
  });

  it('orders all 169 kinds of hand, aces first and the worst offsuit rags last', () => {
    expect(new Set(ORDER).size).toBe(169);
    expect(ORDER.slice(0, 3).map(className)).toEqual(['AA', 'KK', 'QQ']);
    expect(TOP[ORDER.at(-1)!]).toBeCloseTo(1, 10);
    for (const h of ['72o', '32o', '42o']) expect(TOP[ORDER.find((k) => className(k) === h)!]).toBeGreaterThan(0.9);
    // suited beats offsuit, bigger pairs beat smaller
    const s = (x: string) => strength(c(x)[0]!, c(x)[1]!);
    expect(s('Ah Kh')).toBeLessThan(s('Ah Kd'));
    expect(s('Qh Qd')).toBeLessThan(s('Jh Jd'));
    expect(s('7h 6h')).toBeLessThan(s('7h 2d'));
  });

  it('deals a kind of hand around the dead cards, weighted by combinations', () => {
    const dead = new Uint8Array(52);
    for (const x of c('Ah As Ad')) dead[x] = 1;
    const out = new Int32Array(2);
    const aa = ORDER[0]!;
    expect(dealKind(aa, dead, 0.3, out, 0)).toBe(false);
    dead[cardInt('Ad')] = 0;
    expect(dealKind(aa, dead, 0.9, out, 0)).toBe(true);
    expect([...out].sort()).toEqual(c('Ad Ac').sort());
    // the top 2.6%: only QQ+ and AK
    const rng = seededRng(5);
    const kinds = new Set<string>();
    for (let i = 0; i < 2000; i++) kinds.add(className(kindInTop(CHART_WIDTH[0]!, rng.next32() / 2 ** 32)));
    expect([...kinds].sort()).toEqual(['AA', 'AKo', 'AKs', 'KK', 'QQ']);
    expect(handClass(cardInt('Kd'), cardInt('Ad'))).toBe(handClass(cardInt('As'), cardInt('Ks')));
  });
});

describe('a hand on a board', () => {
  const on = (hole: string, board: string) => {
    const h = c(hole);
    const b = c(board);
    return classify(h[0]!, h[1]!, b, b.length);
  };

  it('grades made hands: sets and overpairs over top pair, top pair by its kicker, weak pairs below', () => {
    const set = on('7h 7d', 'Kc 7s 2d');
    const over = on('Ah Ad', 'Kc 7s 2d');
    const tptk = on('As Kh', 'Kc 7s 2d');
    const weakKicker = on('Kh 4d', 'Kc 7s 2d');
    const second = on('8h 7d', 'Kc 7s 2d');
    const air = on('Qh Jd', 'Kc 7s 2d');
    expect(set.made).toBeGreaterThan(over.made);
    expect(over.made).toBeGreaterThan(tptk.made);
    expect(tptk.made).toBeGreaterThan(weakKicker.made);
    expect(weakKicker.made).toBeGreaterThan(second.made);
    expect(second.made).toBeGreaterThan(air.made);
    expect(air.made).toBeLessThan(0.2);
  });

  it('finds draws and the nut flush', () => {
    expect(on('Ah 5h', 'Kh 7h 2d')).toMatchObject({ draw: 2, nutDraw: true });
    expect(on('9h 8h', 'Th 7h 2d')).toMatchObject({ draw: 3 });
    expect(on('9c 8d', 'Th 7s 2d').draw).toBe(2);
    expect(on('9c 6d', 'Th 7s 2d').draw).toBe(1);
    expect(on('9c 6d', 'Th 7s 2d 3c 4h').draw).toBe(0);
    expect(on('Ah 2h', 'Kh 7h 3h').made).toBeGreaterThan(0.9); // the nut flush
    expect(on('6h 2h', 'Kh 7h 3h').made).toBeLessThan(on('Qh 2h', 'Kh 7h 3h').made);
    // a straight the board makes on its own is worth little
    expect(on('2c 2d', '9h Ts Jc Qd Kh').made).toBeLessThan(0.4);
  });

  it('reads textures: dry, wet, paired', () => {
    expect(texture(c('Kc 7s 2d')).wet).toBeLessThan(0.15);
    expect(texture(c('Jh Th 9c')).wet).toBeGreaterThan(0.5);
    expect(texture(c('Jh Th 9h')).wet).toBeGreaterThan(0.8);
    expect(texture(c('8s 8d 3c')).paired).toBe(true);
    expect(texture(c('Ah 2c 4d')).connected).toBe(true);
  });
});

describe('equity against a range', () => {
  const rng = seededRng(12);
  it('aces against anything, and against a range of only aces', () => {
    expect(rangeEquity(c('As Ah'), [], [{ w: 1, min: 0, bluff: 1 }], 3000, rng)).toBeGreaterThan(0.82);
    expect(rangeEquity(c('Ks Kh'), [], [{ w: 0.0045, min: 0, bluff: 1 }], 2000, rng)).toBeLessThan(0.25);
  });

  it('a bet that says "good hand" makes a medium hand worse', () => {
    const board = c('Kc 7s 2d');
    const loose = rangeEquity(c('Qd Qs'), board, [{ w: 0.5, min: 0, bluff: 1 }], 3000, rng);
    const strong = rangeEquity(c('Qd Qs'), board, [{ w: 0.5, min: 0.6, bluff: 0.05 }], 3000, rng);
    expect(loose).toBeGreaterThan(0.6);
    expect(strong).toBeLessThan(loose - 0.2);
  });
});

/** A situation for textbook spots: six handed, 100 big blinds, nobody known yet. */
function spot(over: Partial<BotSituation> & { hole: [number, number] }): BotSituation {
  const bb = 200;
  const legal = over.legal ?? { behind: 100 * bb, toCall: bb, canCheck: false, canBet: false, canRaise: true, minTo: 2 * bb, maxTo: 100 * bb };
  return {
    seat: 3,
    board: [],
    street: 0,
    bb,
    step: 100,
    pot: 1.5 * bb,
    bet: bb,
    legal,
    position: 'early',
    dist: 3,
    players: 6,
    ip: false,
    opponents: [0, 1, 2, 4, 5].map((seat, i) => ({ seat, stack: 100 * bb, street: i === 1 ? bb / 2 : i === 2 ? bb : 0, allIn: false, dist: [2, -1, -2, 1, 0][i]!, read: tendency(undefined) })),
    acts: [],
    preRaises: 0,
    limpers: 0,
    streetRaises: 0,
    aggressor: false,
    ...over,
  };
}

function often(sit: BotSituation, persona: string, skill: number, kinds: string[], n = 200): number {
  const rng = seededRng(77);
  let k = 0;
  for (let i = 0; i < n; i++) if (kinds.includes(decide(sit, PERSONAS[persona]!, rng, { skill, tilt: 0 }).kind)) k++;
  return k / n;
}

describe('a solid player in textbook spots', () => {
  it('opens aces from any seat, folds seven-deuce under the gun, and opens suited kings on the button', () => {
    expect(often(spot({ hole: c('As Ah') as [number, number] }), 'pro', 0.97, ['raise', 'allin'])).toBe(1);
    expect(often(spot({ hole: c('7s 2h') as [number, number] }), 'pro', 0.97, ['fold'])).toBeGreaterThan(0.97);
    expect(often(spot({ hole: c('Ks 8s') as [number, number], dist: 0, position: 'late' }), 'pro', 0.97, ['raise'])).toBeGreaterThan(0.9);
    expect(often(spot({ hole: c('Ks 8s') as [number, number], dist: 4, position: 'early', players: 9 }), 'pro', 0.97, ['fold'])).toBeGreaterThan(0.9);
  });

  it('3-bets the top of an opener’s range and folds the bottom against it', () => {
    const facing = (hole: string) =>
      spot({
        hole: c(hole) as [number, number],
        dist: 0,
        position: 'late',
        pot: 4 * 200,
        bet: 2.5 * 200,
        preRaises: 1,
        legal: { behind: 100 * 200, toCall: 2.5 * 200, canCheck: false, canBet: false, canRaise: true, minTo: 4 * 200, maxTo: 100 * 200 },
        acts: [{ seat: 0, street: 0, kind: 'r', to: 500, size: 1, allIn: false }],
      });
    expect(often(facing('Ks Kh'), 'pro', 0.97, ['raise', 'allin'])).toBeGreaterThan(0.95);
    expect(often(facing('8d 3c'), 'pro', 0.97, ['fold'])).toBeGreaterThan(0.97);
  });

  it('bets the nuts, and folds air to a big river bet', () => {
    const board = c('Kh 7h 3h 9c 2d');
    const river = (hole: string, toCall: number) =>
      spot({
        hole: c(hole) as [number, number],
        board,
        street: 3,
        pot: 20 * 200 + toCall,
        bet: toCall,
        opponents: [{ seat: 0, stack: 80 * 200, street: toCall, allIn: false, dist: 1, read: tendency(undefined) }],
        acts: toCall ? [{ seat: 0, street: 3, kind: 'b', to: toCall, size: toCall / (20 * 200), allIn: false }] : [],
        legal: { behind: 80 * 200, toCall, canCheck: toCall === 0, canBet: toCall === 0, canRaise: toCall > 0, minTo: toCall ? 2 * toCall : 200, maxTo: 80 * 200 },
      });
    expect(often(river('Ah 4h', 0), 'pro', 0.97, ['bet', 'allin'])).toBeGreaterThan(0.75);
    expect(often(river('Qs Jd', 20 * 200), 'pro', 0.97, ['fold'])).toBeGreaterThan(0.9);
    // and a calling station calls a lot more than the pro with a weak pair
    const pairCall = (who: string, skill: number) => often(river('7c 5c', 15 * 200), who, skill, ['call']);
    expect(pairCall('station', 0.15)).toBeGreaterThan(pairCall('pro', 0.97) + 0.2);
  });
});

describe('who sits at which stakes', () => {
  it('micro stakes are mostly loose players, the nosebleeds mostly regulars and pros', () => {
    const micro = lineUp(100);
    const high = lineUp(10_000_00);
    const weak = (m: Record<string, number>) => m.station! + m.fish! + m.maniac!;
    const strong = (m: Record<string, number>) => m.reg! + m.pro! + m.lag! + m.tag!;
    expect(weak(micro)).toBeGreaterThan(0.5);
    expect(strong(high)).toBeGreaterThan(0.85);
    expect(weak(high)).toBeGreaterThan(0); // the odd rich amateur
    expect(micro.pro).toBe(0);
  });

  it('bots play better as the stakes go up, and no two draws are quite alike', () => {
    const avg = (bb: number) => {
      const rng = seededRng(bb);
      let s = 0;
      const seen = new Set<number>();
      for (let i = 0; i < 400; i++) {
        const b = drawBot(bb, rng);
        s += b.skill;
        seen.add(Math.round(b.skill * 100));
      }
      expect(seen.size).toBeGreaterThan(10);
      return s / 400;
    };
    const a = avg(100);
    const b = avg(10_000);
    const d = avg(10_000_00);
    expect(b).toBeGreaterThan(a + 0.1);
    expect(d).toBeGreaterThan(b + 0.1);
  });
});

describe('reads', () => {
  it('counts what each player did, and starts every stranger at the average', () => {
    const acts: Act[] = [
      { seat: 0, street: 0, kind: 'r', to: 500, size: 1, allIn: false },
      { seat: 1, street: 0, kind: 'c', to: 500, size: 0, allIn: false },
      { seat: 2, street: 0, kind: 'f', to: 200, size: 0, allIn: false },
      { seat: 0, street: 1, kind: 'b', to: 600, size: 0.5, allIn: false },
      { seat: 1, street: 1, kind: 'f', to: 0, size: 0, allIn: false },
    ];
    const reads: Reads = {};
    observe(reads, { 0: 'Ann', 1: 'Bo', 2: 'Cy' }, acts, new Set(['Ann', 'Bo', 'Cy']));
    expect(reads.Ann).toMatchObject({ n: 1, vpip: 1, pfr: 1, agg: 1 });
    expect(reads.Bo).toMatchObject({ n: 1, vpip: 1, pfr: 0, faced: 1, folded: 1 });
    expect(reads.Cy).toMatchObject({ n: 1, vpip: 0 });
    expect(tendency(undefined)).toMatchObject({ vpip: P.vpip, pfr: PRIOR.pfr, n: 0 });
    // many hands of raising: the read moves most of the way to what they do
    for (let i = 0; i < 60; i++) observe(reads, { 0: 'Ann' }, acts.slice(0, 1), new Set(['Ann']));
    expect(tendency(reads.Ann).pfr).toBeGreaterThan(0.8);
  });
});

type Sim = TableSim<HoldemState, HoldemAction, HoldemView>;

function soloAt(seed: number, bb = 1_000): Sim {
  const cfg = { ...engine.config('', 'solo'), options: { sb: bb / 2, bb } };
  return new TableSim(engine, seededRng(seed), 'solo', [{ seat: 0, stack: 100 * bb }], cfg);
}

function toBotTurn(sim: Sim, street = 0): number {
  for (let i = 0; i < 5_000; i++) {
    const h = sim.state.hand;
    if (sim.state.phase === 'playing' && h && h.toAct !== null && h.toAct !== 0 && h.street >= street) return h.toAct;
    if (sim.state.phase === 'playing' && h?.toAct === 0) {
      const l = (sim.view(0) as HoldemView).you!.legal!;
      sim.act(0, l.check ? { type: 'check' } : { type: 'call' });
      continue;
    }
    const d = engine.deadline(sim.state);
    sim.advance(d === null ? 0 : Math.max(0, d - sim.now));
  }
  throw new Error('no bot turn');
}

describe('a bot sees only its own cards', () => {
  it('its situation is the same whatever the other hands and the deck hold', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const sim = soloAt(seed);
      const seat = toBotTurn(sim, seed % 2);
      const s = sim.state;
      const before = botSituation(s, seat);
      // Deal everyone else, and the undealt deck, different cards: the bot can't tell.
      const alt = structuredClone(s);
      const h = alt.hand!;
      const mine = new Set([...R.player(h, seat)!.hole, ...h.board]);
      const rest = h.deck.filter((x) => !mine.has(x)).reverse();
      let k = 0;
      for (const p of h.players) if (p.seat !== seat) p.hole = p.hole.map(() => rest[k++]!);
      h.deck = h.deck.map((x) => (mine.has(x) ? x : rest[k++ % rest.length]!));
      expect(botSituation(alt, seat)).toEqual(before);
      // and so its decision, from the same random draws, is the same too
      const st = s.seats[seat]!;
      const p = PERSONAS[st.persona!]!;
      expect(decide(botSituation(alt, seat), p, seededRng(9), { skill: st.skill!, tilt: 0 })).toEqual(decide(before, p, seededRng(9), { skill: st.skill!, tilt: 0 }));
      // nothing in it but its own two cards and the board
      const cards = new Set<number>([...before.hole, ...before.board]);
      expect(cards.size).toBe(2 + before.board.length);
      expect(Object.keys(before).sort()).toEqual(
        ['acts', 'aggressor', 'bb', 'bet', 'board', 'dist', 'hole', 'ip', 'legal', 'limpers', 'opponents', 'players', 'position', 'pot', 'preRaises', 'seat', 'step', 'street', 'streetRaises'].sort(),
      );
      for (const o of before.opponents) expect(Object.keys(o).sort()).toEqual(['allIn', 'dist', 'read', 'seat', 'stack', 'street']);
    }
  });
});

describe('the table', () => {
  it('seats bots by the stakes, with skills and no tilt yet', () => {
    const micro = soloAt(3, 100);
    const high = soloAt(3, 2_000_000);
    const bots = (s: Sim) => Object.values(s.state.seats).filter((x) => x.bot);
    for (const b of [...bots(micro), ...bots(high)]) {
      expect(PERSONAS[b.persona!]).toBeDefined();
      expect(b.skill).toBeGreaterThan(0);
      expect(b.tilt).toBe(0);
    }
    const mean = (s: Sim) => bots(s).reduce((a, b) => a + b.skill!, 0) / 5;
    expect(mean(high)).toBeGreaterThan(mean(micro));
  });

  it('a bot that loses a big pot tilts, and it fades', () => {
    const sim = soloAt(4);
    const s = sim.state;
    const bot = Object.values(s.seats).find((x) => x.bot)!;
    bot.persona = 'maniac';
    bot.tilt = 0;
    // play hands until that bot has lost 25 big blinds in one
    let tilted = 0;
    for (let i = 0; i < 20_000 && tilted === 0; i++) {
      const h = sim.state.hand;
      if (sim.state.phase === 'playing' && h?.toAct === 0) {
        const l = (sim.view(0) as HoldemView).you!.legal!;
        sim.act(0, l.raise || l.bet ? { type: 'allin' } : l.check ? { type: 'check' } : { type: 'call' });
      } else {
        const d = engine.deadline(sim.state);
        sim.advance(d === null ? 0 : Math.max(0, d - sim.now));
      }
      tilted = sim.state.seats[bot.seat]!.tilt ?? 0;
      if (sim.stack(0) === 0 && engine.liveBets(sim.state, 0) === 0) {
        sim.apply(engine.seatLeaving(sim.state, 0, sim.ctx()));
        sim.seats.get(0)!.stack = 100_000;
        sim.apply(engine.seatJoined(sim.state, 0, sim.ctx()));
      }
    }
    expect(tilted).toBeGreaterThan(0.05);
    // and the table reads the player who shoves every hand as the most aggressive of all
    const reads = sim.state.reads!;
    expect(tendency(reads.P0).pfr).toBeGreaterThan(0.5);
  });
});

describe('speed', () => {
  it('a decision after the flop against five players takes a few milliseconds at most', () => {
    const rng = seededRng(31);
    const board = c('Qh 9h 4c 7d');
    const sit = spot({
      hole: c('Qs Jh') as [number, number],
      board,
      street: 2,
      pot: 30 * 200,
      bet: 10 * 200,
      opponents: [0, 1, 2, 4, 5].map((seat, i) => ({ seat, stack: 80 * 200, street: i === 0 ? 10 * 200 : 0, allIn: false, dist: [2, -1, -2, 1, 0][i]!, read: tendency(undefined) })),
      acts: [{ seat: 0, street: 2, kind: 'b', to: 2000, size: 0.5, allIn: false }],
      legal: { behind: 80 * 200, toCall: 10 * 200, canCheck: false, canBet: false, canRaise: true, minTo: 20 * 200, maxTo: 80 * 200 },
    });
    decide(sit, PERSONAS.pro!, rng); // warm up
    const t0 = performance.now();
    const n = 100;
    for (let i = 0; i < n; i++) decide(sit, PERSONAS.pro!, rng, { skill: 0.95, tilt: 0 });
    const mean = (performance.now() - t0) / n;
    // bounded Monte Carlo: about a millisecond on a laptop; generous for a busy machine
    expect(mean).toBeLessThan(15);
  });
});

describe('the rake', () => {
  const hand = (board: string, puts: number[]) => {
    const h = R.newHand({ id: 1, sb: 100, bb: 200, button: 0, sbSeat: 1, bbSeat: 2, players: puts.map((_, seat) => ({ seat, stack: 100_000 })), deck: Array.from({ length: 52 }, (_, i) => i) });
    h.board = board ? c(board) : [];
    h.players.forEach((p, i) => (p.put = puts[i]!));
    return h;
  };

  it('is 5% of the pot to the cent, at most three big blinds, and nothing without a flop', () => {
    expect(R.rakeOf(hand('Kc 7s 2d', [1_000, 1_000, 1_000]))).toBe(150);
    expect(R.rakeOf(hand('Kc 7s 2d', [2_001, 2_000, 0]))).toBe(200);
    expect(R.rakeOf(hand('Kc 7s 2d', [50_000, 50_000, 0]))).toBe(600);
    expect(R.rakeOf(hand('', [50_000, 50_000, 0]))).toBe(0);
  });

  it('comes out of the pots before they are paid, side pots in proportion', () => {
    const h = hand('Kc 7s 2d 9h 4c', [1_000, 3_000, 3_000]);
    const v = new Map([[0, 9], [1, 5], [2, 1]]);
    const plain = R.awardPots(h, v).reduce((a, x) => a + x.amount, 0);
    const awards = R.awardPots(h, v, new Set(), 350);
    expect(awards.reduce((a, x) => a + x.amount, 0)).toBe(plain - 350);
    expect(awards.flatMap((a) => a.winners).reduce((a, w) => a + w.amount, 0)).toBe(plain - 350);
  });

  it('is taken at bot tables and never at a table of people', () => {
    const solo = soloAt(21);
    for (let i = 0; i < 3_000 && !(solo.state.raked ?? 0); i++) {
      if (solo.state.phase === 'playing' && solo.state.hand?.toAct === 0) {
        const l = (solo.view(0) as HoldemView).you!.legal!;
        solo.act(0, l.check ? { type: 'check' } : { type: 'call' });
      } else {
        const d = engine.deadline(solo.state);
        solo.advance(d === null ? 0 : Math.max(0, d - solo.now));
      }
    }
    expect(solo.state.raked).toBeGreaterThan(0);
    expect(solo.state.history.some((x) => x.lines.some((l) => l.startsWith('Rake $')))).toBe(true);
    const multi = new TableSim(engine, seededRng(22), 'multi', [0, 1, 2].map((seat) => ({ seat, stack: 100_000 })));
    multi.started = true;
    for (let i = 0; i < 3_000 && multi.state.handNo < 30; i++) {
      const t = multi.state.phase === 'playing' ? multi.state.hand?.toAct : null;
      if (t !== null && t !== undefined) {
        const l = (multi.view(t) as HoldemView).you!.legal!;
        multi.act(t, l.check ? { type: 'check' } : { type: 'call' });
      } else {
        const d = engine.deadline(multi.state);
        multi.advance(d === null ? 0 : Math.max(0, d - multi.now));
      }
    }
    expect(multi.state.handNo).toBeGreaterThanOrEqual(30);
    expect(multi.state.raked ?? 0).toBe(0);
  });
});
