// Opponents for single-player tables: rule-based players built the way solid poker bots are.
//
// Before the flop a bot plays from the standard raise-first-in charts by position (ranges.ts),
// and against a raise it reads the raiser's range from their position and what it has seen them
// do: it 3-bets the top of that range (and a few suited wheel aces and connectors as bluffs),
// flats with hands that play well behind it, defends its big blind by the price, and 4-bets or
// gets it in with the hands that are ahead of a 3-bettor's range. Short stacked it moves in or
// folds. After the flop it sizes up its hand and the board (postflop.ts), estimates its chance
// against each opponent's range (narrowed by how that opponent has bet this hand, and by how
// often they bluff) by dealing the hand out a couple of hundred times, and compares that with
// the pot odds, adding implied odds for draws. It continuation-bets by texture and position,
// semi-bluffs draws, slow-plays and check-raises now and then, sizes its bets from the board,
// commits when the stack is small next to the pot, and balances its river bets with bluffs.
//
// Players differ: a persona sets how loose, aggressive and bluffy a bot is and how much it
// knows; a bot's skill scales with the stakes (fish at the micros, regulars at the nosebleeds);
// and every bot makes mistakes now and then (a loose call, a spewy bluff, a hero call), more
// often the less skilled it is and after it has lost a big pot (tilt). Sizes and frequencies are
// mixed, so no two hands play quite alike.
//
// A bot decides from what its own seat could see at a real table: its two cards, the board, the
// bets, the stacks, the public actions of this hand and what it has seen each player do in the
// hands it played with them. It never sees the deck or anyone's hole cards; the engine builds its
// situation from public state and the bot's own hand.

import type { Cents } from '../../money.ts';
import { type Rng, randInt, randUnit } from '../../rng.ts';
import { evaluate } from './eval.ts';
import type { Legal, MoveKind } from './rules.ts';
import { chen } from './preflop.ts';
import { CHART_WIDTH, strength, kindInTop, dealKind } from './ranges.ts';
import { classify, texture } from './postflop.ts';
import { type Act, type Tendency, PRIOR } from './reads.ts';

export { chen, sklanskyGroup, preflopScore } from './preflop.ts';

export interface Persona {
  id: string;
  /** What kind of player this is, in a few words (the seat's tooltip). */
  label: string;
  /** Hands played, as a multiple of the charts: 1 plays the charts, 2 twice as many hands. */
  loose: number;
  /** 0..1: how often it raises rather than calls, and bets its hands rather than checks them. */
  aggr: number;
  /** How often it bluffs, as a multiple of a balanced player. */
  bluff: number;
  /** Equity it gives up to call: positive calls too much, negative folds too much. */
  sticky: number;
  /** 0..1 before the stakes: how well it reads ranges and avoids mistakes. */
  skill: number;
  /** 0..1: how hard a big loss hits it. */
  tilt: number;
  /** 0..1: of the hands it plays first in, how many it limps instead of raising. */
  limp: number;
  /** Typical think time, ms. */
  think: number;
}

export const PERSONAS: Record<string, Persona> = {
  station: { id: 'station', label: 'Calls a lot, rarely raises', loose: 2.2, aggr: 0.15, bluff: 0.3, sticky: 0.12, skill: 0.15, tilt: 0.4, limp: 0.7, think: 1200 },
  fish: { id: 'fish', label: 'Plays too many hands', loose: 1.8, aggr: 0.3, bluff: 0.6, sticky: 0.05, skill: 0.25, tilt: 0.6, limp: 0.45, think: 1300 },
  maniac: { id: 'maniac', label: 'Raises everything', loose: 2.0, aggr: 0.95, bluff: 2.2, sticky: 0.02, skill: 0.3, tilt: 0.8, limp: 0, think: 900 },
  rock: { id: 'rock', label: 'Tight, waits for big hands', loose: 0.65, aggr: 0.45, bluff: 0.35, sticky: -0.05, skill: 0.5, tilt: 0.2, limp: 0.05, think: 1700 },
  tag: { id: 'tag', label: 'Tight and aggressive', loose: 0.95, aggr: 0.75, bluff: 0.9, sticky: 0, skill: 0.7, tilt: 0.3, limp: 0, think: 1400 },
  lag: { id: 'lag', label: 'Loose and aggressive', loose: 1.3, aggr: 0.85, bluff: 1.25, sticky: 0.01, skill: 0.72, tilt: 0.4, limp: 0, think: 1100 },
  reg: { id: 'reg', label: 'A solid regular', loose: 1.0, aggr: 0.72, bluff: 1.0, sticky: 0, skill: 0.8, tilt: 0.2, limp: 0, think: 1500 },
  pro: { id: 'pro', label: 'A strong professional', loose: 1.05, aggr: 0.75, bluff: 1.0, sticky: 0, skill: 0.95, tilt: 0.1, limp: 0, think: 1600 },
};

export const PERSONA_IDS = Object.keys(PERSONAS);

/** A bot's state of mind: its skill at these stakes, and how tilted it is right now (0..1). */
export interface Mood {
  skill: number;
  tilt: number;
}

// ---------------------------------------------------------------------------------------------
// Who sits at which stakes

/**
 * The line-up by stakes: weights over the personas at a $1, $10, $100, $1,000 and $10,000+ big
 * blind, blended in between. Micro stakes are full of loose, passive players; the nosebleeds are
 * mostly regulars and professionals, with the odd rich amateur.
 */
const MIX: readonly Record<string, number>[] = [
  { station: 0.26, fish: 0.24, maniac: 0.1, rock: 0.2, tag: 0.12, lag: 0.03, reg: 0.05, pro: 0 },
  { station: 0.15, fish: 0.2, maniac: 0.08, rock: 0.17, tag: 0.2, lag: 0.07, reg: 0.13, pro: 0 },
  { station: 0.06, fish: 0.1, maniac: 0.05, rock: 0.1, tag: 0.26, lag: 0.15, reg: 0.23, pro: 0.05 },
  { station: 0.02, fish: 0.06, maniac: 0.04, rock: 0.05, tag: 0.2, lag: 0.18, reg: 0.3, pro: 0.15 },
  { station: 0, fish: 0.05, maniac: 0.03, rock: 0, tag: 0.12, lag: 0.2, reg: 0.25, pro: 0.35 },
];

/** 0 at a $1 big blind to 4 at $10,000 and up. */
function stakesLevel(bb: Cents): number {
  return Math.max(0, Math.min(4, Math.log10(Math.max(1, bb / 100))));
}

/** The personas' weights at this big blind. */
export function lineUp(bb: Cents): Record<string, number> {
  const x = stakesLevel(bb);
  const i = Math.min(3, Math.floor(x));
  const f = x - i;
  const out: Record<string, number> = {};
  for (const id of PERSONA_IDS) out[id] = MIX[i]![id]! * (1 - f) + MIX[i + 1]![id]! * f;
  return out;
}

/** Everyone plays a little better as the stakes go up. */
export function stakesSkill(bb: Cents): number {
  return (stakesLevel(bb) - 1) * 0.05;
}

/** A bot for a seat at this big blind: who it is, and how well it plays today. */
export function drawBot(bb: Cents, rng: Rng): { persona: string; skill: number } {
  const w = lineUp(bb);
  let u = randUnit(rng) * PERSONA_IDS.reduce((a, id) => a + w[id]!, 0);
  let persona = 'reg';
  for (const id of PERSONA_IDS) {
    u -= w[id]!;
    if (u < 0) {
      persona = id;
      break;
    }
  }
  const skill = clamp(PERSONAS[persona]!.skill + stakesSkill(bb) + (randUnit(rng) - 0.5) * 0.12, 0.05, 0.99);
  return { persona, skill };
}

/** How many big blinds a bot sits down with: regulars a full stack, the rest all over the place. */
export function botStackBBs(persona: string, rng: Rng): number {
  const u = randUnit(rng);
  switch (persona) {
    case 'rock':
    case 'tag':
    case 'reg':
      return 90 + randInt(rng, 41); // 90-130
    case 'pro':
    case 'lag':
      return u < 0.5 ? 100 + randInt(rng, 21) : 150 + randInt(rng, 101); // a full stack or deep
    default:
      return 60 + randInt(rng, 141); // 60-200
  }
}

// ---------------------------------------------------------------------------------------------
// Equity

const pool = new Int32Array(52);
const seen = new Uint8Array(52);
const seven = new Int32Array(7);

/**
 * Chance of winning at showdown against the opponents still in (a k-way tie counts 1/k), by
 * dealing random hands and the rest of the board `samples` times. An opponent who raised before
 * the flop is dealt from stronger hands (Chen 8 or more, by rejection) instead of any two cards.
 * (Tips use this one; the bots use rangeEquity.)
 */
export function equity(hole: readonly number[], board: readonly number[], opponents: readonly { strong: boolean }[], samples: number, rng: Rng): number {
  seen.fill(0);
  for (const c of hole) seen[c] = 1;
  for (const c of board) seen[c] = 1;
  let n = 0;
  for (let c = 0; c < 52; c++) if (seen[c] === 0) pool[n++] = c;
  const need = 5 - board.length;
  const opp = new Int32Array(opponents.length * 2);
  let k = 0;
  // A partial Fisher-Yates shuffle: each draw swaps a random undrawn card into place.
  const draw = () => {
    const j = k + randInt(rng, n - k);
    const t = pool[k]!;
    pool[k] = pool[j]!;
    pool[j] = t;
    return pool[k++]!;
  };
  let total = 0;
  for (let s = 0; s < samples; s++) {
    k = 0;
    for (let o = 0; o < opponents.length; o++) {
      let a = draw();
      let b = draw();
      if (opponents[o]!.strong) {
        for (let tries = 0; tries < 6 && chen(a, b) < 8; tries++) {
          k -= 2; // put them back and deal again
          a = draw();
          b = draw();
        }
      }
      opp[2 * o] = a;
      opp[2 * o + 1] = b;
    }
    for (let i = 0; i < board.length; i++) seven[2 + i] = board[i]!;
    for (let i = 0; i < need; i++) seven[2 + board.length + i] = draw();
    seven[0] = hole[0]!;
    seven[1] = hole[1]!;
    const mine = evaluate(seven, 7);
    let best = -1;
    let count = 0;
    for (let o = 0; o < opponents.length; o++) {
      seven[0] = opp[2 * o]!;
      seven[1] = opp[2 * o + 1]!;
      const v = evaluate(seven, 7);
      if (v > best) {
        best = v;
        count = 1;
      } else if (v === best) count++;
    }
    if (mine > best) total += 1;
    else if (mine === best) total += 1 / (count + 1);
  }
  return total / samples;
}

/**
 * An opponent's range as a bot pictures it: the top `w` of starting hands, of which the ones
 * that don't make at least `min` on this board (postflop.ts scores) are kept only `bluff` of the
 * time: a bet says "something good, or a bluff".
 */
export interface RangeSpec {
  w: number;
  min: number;
  bluff: number;
}

const dead = new Uint8Array(52);
const hands = new Int32Array(18);
const full = new Int32Array(5);

/** Chance of winning at showdown against these ranges, dealing the hand out `samples` times. */
export function rangeEquity(hole: readonly number[], board: readonly number[], opps: readonly RangeSpec[], samples: number, rng: Rng): number {
  if (opps.length === 0) return 1;
  const nb = board.length;
  let total = 0;
  for (let s = 0; s < samples; s++) {
    dead.fill(0);
    dead[hole[0]!] = 1;
    dead[hole[1]!] = 1;
    for (let i = 0; i < nb; i++) dead[board[i]!] = 1;
    for (let o = 0; o < opps.length; o++) {
      const r = opps[o]!;
      for (let tries = 0; ; tries++) {
        // (every hand of a very narrow range can be dead: widen it rather than loop)
        const k = kindInTop(tries < 16 ? r.w : 1, randUnit(rng));
        if (!dealKind(k, dead, randUnit(rng), hands, 2 * o)) continue;
        if (tries < 10 && r.min > 0 && nb >= 3) {
          const sc = classify(hands[2 * o]!, hands[2 * o + 1]!, board, nb).score;
          if (sc < r.min && randUnit(rng) >= r.bluff) continue;
        }
        break;
      }
      dead[hands[2 * o]!] = 1;
      dead[hands[2 * o + 1]!] = 1;
    }
    for (let i = 0; i < nb; i++) full[i] = board[i]!;
    for (let i = nb; i < 5; i++) {
      let c: number;
      do c = randInt(rng, 52);
      while (dead[c] === 1);
      dead[c] = 1;
      full[i] = c;
    }
    for (let i = 0; i < 5; i++) seven[2 + i] = full[i]!;
    seven[0] = hole[0]!;
    seven[1] = hole[1]!;
    const mine = evaluate(seven, 7);
    let best = -1;
    let count = 0;
    for (let o = 0; o < opps.length; o++) {
      seven[0] = hands[2 * o]!;
      seven[1] = hands[2 * o + 1]!;
      const v = evaluate(seven, 7);
      if (v > best) {
        best = v;
        count = 1;
      } else if (v === best) count++;
    }
    if (mine > best) total += 1;
    else if (mine === best) total += 1 / (count + 1);
  }
  return total / samples;
}

// ---------------------------------------------------------------------------------------------
// The situation

export type Position = 'early' | 'middle' | 'late' | 'sb' | 'bb';

/** An opponent still in the hand, as the table shows them. */
export interface Opp {
  seat: number;
  /** Chips behind. */
  stack: Cents;
  /** In front of them on this street. */
  street: Cents;
  allIn: boolean;
  /** Where they sat before the flop: 0 the button, 1 the cutoff, ...; -1 small blind, -2 big blind. */
  dist: number;
  /** What the table has seen them do in earlier hands. */
  read: Tendency;
}

/** Everything a bot knows when it has to act. */
export interface BotSituation {
  seat: number;
  hole: [number, number];
  board: number[];
  street: 0 | 1 | 2 | 3;
  bb: Cents;
  step: Cents;
  /** All chips committed this hand, including the bets in front of the seats. */
  pot: Cents;
  /** The bet to match on this street (a street total). */
  bet: Cents;
  legal: Legal;
  position: Position;
  /** This bot's place before the flop, as for Opp.dist. */
  dist: number;
  /** Players dealt in. */
  players: number;
  /** Acts after every opponent still able to bet, after the flop. */
  ip: boolean;
  /** Opponents still in the hand. */
  opponents: Opp[];
  /** The public actions of this hand so far, in order. */
  acts: Act[];
  /** Bets and raises before the flop so far (the blinds don't count). */
  preRaises: number;
  /** Players who just called the big blind before anyone raised. */
  limpers: number;
  /** Bets and raises on this street so far. */
  streetRaises: number;
  /** This bot made the last bet or raise on the previous street (a continuation-bet spot). */
  aggressor: boolean;
}

export interface BotDecision {
  kind: MoveKind;
  to?: Cents;
}

/** Deals per equity estimate after the flop, and for a big decision before it. */
export const EQUITY_SAMPLES = 220;
export const PREFLOP_SAMPLES = 160;

/** The raise-first-in share of hands by place: the charts, and wider heads-up. */
export function openWidth(dist: number, players: number): number {
  if (players <= 2) return dist === 0 ? 0.8 : 0.6;
  if (dist === -1) return 0.42;
  if (dist === -2) return 0.55;
  if (dist === 0) return CHART_WIDTH[6]!;
  if (dist === 1) return CHART_WIDTH[5]!;
  if (dist === 2) return CHART_WIDTH[4]!;
  if (dist === 3) return CHART_WIDTH[3]!;
  if (dist === 4) return 0.15;
  if (dist === 5) return 0.125;
  return CHART_WIDTH[2]!;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** How a bot plays right now: its persona, its skill, and its tilt. */
interface Style {
  p: Persona;
  loose: number;
  aggr: number;
  bluff: number;
  sticky: number;
  skill: number;
  /** Chance a decision goes wrong. */
  err: number;
}

function styleOf(p: Persona, mood: Mood): Style {
  const tilt = clamp(mood.tilt, 0, 1);
  const skill = clamp(mood.skill - tilt * 0.3, 0.02, 0.99);
  return {
    p,
    loose: p.loose * (1 + tilt * 0.5),
    aggr: clamp(p.aggr + tilt * 0.2, 0, 1),
    bluff: p.bluff * (1 + tilt),
    sticky: p.sticky + tilt * 0.05,
    skill,
    err: 0.015 + (1 - skill) * 0.16 + tilt * 0.08,
  };
}

export function decide(sit: BotSituation, persona: Persona, rng: Rng, mood: Mood = { skill: persona.skill, tilt: 0 }): BotDecision {
  const st = styleOf(persona, mood);
  const d = sit.street === 0 ? preflop(sit, st, rng) : postflop(sit, st, rng);
  return slip(d, sit, st, rng);
}

// ---------------------------------------------------------------------------------------------
// Moves

function passive(sit: BotSituation): BotDecision {
  return sit.legal.canCheck ? { kind: 'check' } : { kind: 'fold' };
}

function call(sit: BotSituation): BotDecision {
  return sit.legal.toCall > 0 ? { kind: 'call' } : { kind: 'check' };
}

/** A size a person would say: whole big blinds when it's big, half ones in between. */
function nice(sit: BotSituation, x: Cents): Cents {
  const unit = x >= 40 * sit.bb ? sit.bb : x >= 8 * sit.bb ? sit.bb / 2 : sit.step;
  const u = Math.max(sit.step, Math.round(unit / sit.step) * sit.step);
  return Math.round(x / u) * u;
}

/** A bet or raise to about `target` (a street total), made legal: clamped, rounded, all-in when it is most of the stack. */
function aggressive(sit: BotSituation, target: Cents): BotDecision {
  const l = sit.legal;
  if (!l.canBet && !l.canRaise) return l.toCall > 0 ? { kind: 'call' } : { kind: 'check' };
  let to = Math.max(l.minTo, nice(sit, target));
  to = Math.ceil(to / sit.step) * sit.step;
  if (to >= l.maxTo * 0.75) return { kind: 'allin' };
  return { kind: sit.bet === 0 ? 'bet' : 'raise', to: Math.min(to, l.maxTo) };
}

/** Chips this bot can win or lose against the biggest stack still in, in big blinds. */
function effBBs(sit: BotSituation): number {
  let opp = 0;
  for (const o of sit.opponents) opp = Math.max(opp, o.stack + o.street);
  return Math.min(sit.legal.maxTo, opp) / sit.bb;
}

/** Mixed at the edges: a hand at `pct` is in a range of width `w` a bit more or less than exactly. */
function inRange(pct: number, w: number, rng: Rng): boolean {
  return pct < w * (0.86 + randUnit(rng) * 0.28);
}

const hiRank = (sit: BotSituation) => Math.max(sit.hole[0] >> 2, sit.hole[1] >> 2);
const loRank = (sit: BotSituation) => Math.min(sit.hole[0] >> 2, sit.hole[1] >> 2);
const suited = (sit: BotSituation) => (sit.hole[0] & 3) === (sit.hole[1] & 3);
const pair = (sit: BotSituation) => sit.hole[0] >> 2 === sit.hole[1] >> 2;

/** Hands that 3-bet and 4-bet as bluffs: suited wheel aces and suited connectors. */
function bluffCandidate(sit: BotSituation): boolean {
  if (!suited(sit)) return false;
  const h = hiRank(sit);
  const l = loRank(sit);
  return (h === 12 && l <= 3) || (h - l === 1 && l >= 3 && h <= 8) || (h === 11 && l >= 7);
}

/** Pairs and suited connectors: hands that want a cheap flop and a deep stack behind. */
function speculative(sit: BotSituation): boolean {
  return pair(sit) || (suited(sit) && hiRank(sit) - loRank(sit) <= 2);
}

// ---------------------------------------------------------------------------------------------
// Ranges from the public actions

/** The preflop actions so far, in order. */
function preActs(sit: BotSituation): Act[] {
  return sit.acts.filter((a) => a.street === 0);
}

/** How far a read moves a range: not at all for a bot that ignores reads, fully for a pro. */
function lean(ratio: number, lo: number, hi: number, skill: number): number {
  return Math.pow(clamp(ratio, lo, hi), skill);
}

/**
 * The share of starting hands an opponent plays the way they have this hand before the flop: a
 * raise first in is their opening range for their seat (wider if they raise a lot), a 3-bet is
 * the top few percent, a call is the part of their range that calls, a limp is loose, a checked
 * big blind is anything.
 */
function preWidth(sit: BotSituation, o: Opp, st: Style): number {
  const pfr = lean(o.read.pfr / PRIOR.pfr, 0.4, 5.5, st.skill);
  const vpip = lean(o.read.vpip / PRIOR.vpip, 0.5, 3.3, st.skill);
  let raises = 0;
  let w = 1;
  let openW = 0.3;
  for (const a of preActs(sit)) {
    if (a.kind === 'r' || a.kind === 'b') {
      raises++;
      if (a.seat === o.seat) {
        if (raises === 1) w = clamp(openWidth(o.dist, sit.players) * pfr, 0.02, 1);
        else if (raises === 2) w = clamp((openW > 0.25 ? 0.075 : 0.05) * pfr, 0.02, 0.6);
        else if (raises === 3) w = clamp(0.026 * pfr, 0.012, 0.35);
        else w = clamp(0.018 * pfr, 0.009, 0.25);
      }
      if (raises === 1) openW = clamp(openWidth(a.seat === o.seat ? o.dist : distOfSeat(sit, a.seat), sit.players), 0.05, 1);
    } else if (a.seat === o.seat) {
      if (a.kind === 'x') w = 1;
      else if (a.kind === 'c') {
        if (raises === 0) w = clamp(0.5 * vpip, 0.15, 1);
        else if (raises === 1) w = clamp(openW * (o.dist === -2 ? 1.35 : 0.6) * vpip, 0.03, 1);
        else if (raises === 2) w = clamp(0.09 * vpip, 0.02, 0.6);
        else w = clamp(0.035 * vpip, 0.012, 0.3);
      }
    }
  }
  return w;
}

function distOfSeat(sit: BotSituation, seat: number): number {
  if (seat === sit.seat) return sit.dist;
  return sit.opponents.find((o) => o.seat === seat)?.dist ?? 2;
}

/**
 * An opponent's range after the flop: their preflop range, and the least they are likely to
 * have given how they have bet since (a raise says more than a bet, a bet more than a call; the
 * street being played counts most), passing weaker hands only as often as they bluff.
 */
function postRange(sit: BotSituation, o: Opp, st: Style): RangeSpec {
  const w = preWidth(sit, o, st);
  let min = 0;
  let lastAggro = false;
  const raised = [0, 0, 0, 0];
  for (const a of sit.acts) {
    if (a.street === 0 || a.seat !== o.seat) continue;
    let base = 0;
    if (a.kind === 'b') base = 0.42;
    else if (a.kind === 'r') base = 0.58 + 0.12 * raised[a.street]!++;
    else if (a.kind === 'c') base = 0.26;
    if (base === 0) continue;
    if (a.size >= 0.9) base += 0.04;
    if (a.allIn) base += 0.04;
    const fade = Math.pow(0.85, sit.street - a.street);
    min = Math.max(min, base * fade);
    lastAggro = a.kind === 'b' || a.kind === 'r';
  }
  // A weak player doesn't put people on hands: a bet tells it less than it should.
  min *= 0.4 + 0.6 * st.skill;
  // How often a line like theirs is a bluff: less for a raise, more for a player who bets a lot.
  let bluff = lastAggro ? 0.24 : 0.4;
  bluff *= lean(o.read.agg / PRIOR.agg, 0.25, 2.2, st.skill * 1.5);
  return { w, min, bluff: clamp(bluff, 0.04, 0.8) };
}

/** How often this table folds to a bet, by the reads (1 is an average player). */
function foldiness(sit: BotSituation, st: Style): number {
  let f = 1;
  for (const o of sit.opponents) f *= lean(o.read.fold / PRIOR.fold, 0.2, 2, st.skill);
  return f;
}

// ---------------------------------------------------------------------------------------------
// Before the flop

function preflop(sit: BotSituation, st: Style, rng: Rng): BotDecision {
  const l = sit.legal;
  const bb = sit.bb;
  // Where the hand ranks among all starting hands, 0 best; inRange mixes the edges of each range.
  const pct = strength(sit.hole[0], sit.hole[1]);
  const eff = effBBs(sit);
  const raises = sit.preRaises;
  // A bot that ignores position plays much the same hands from every seat.
  const chart = openWidth(sit.dist, sit.players);
  const baseW = chart * st.skill + 0.3 * (1 - st.skill);
  const w = clamp(baseW * st.loose, 0.02, 0.95);

  // A call for most of the stack (or facing an all-in): decide on the equity against their range.
  if (l.toCall > 0 && (l.toCall >= l.behind * 0.35 || !l.canRaise)) return commitDecision(sit, st, rng);

  // Short: move in or fold.
  if (eff <= 15 && raises <= 1) {
    if (raises === 0) {
      const pushW = clamp(w * (0.7 + 0.06 * (15 - eff)), 0.03, 0.9);
      if (inRange(pct, pushW, rng)) return { kind: 'allin' };
      return passive(sit);
    }
    const opener = aggressorOpp(sit);
    const wo = opener ? preWidth(sit, opener, st) : 0.2;
    if (inRange(pct, Math.max(0.04, wo * 0.32), rng)) return { kind: 'allin' };
    if (sit.dist === -2 && l.toCall <= bb * 1.5 && inRange(pct, wo * 0.9, rng)) return call(sit);
    return passive(sit);
  }

  if (raises === 0) {
    const limpers = sit.limpers;
    const openTo = (openSize(sit, st, rng) + limpers) * bb;
    if (l.canCheck) {
      // The big blind's option over limpers: raise the good hands, check the rest.
      if (inRange(pct, Math.max(0.05, 0.12 * st.loose * st.aggr * 1.4), rng)) return aggressive(sit, (3.5 + limpers) * bb);
      return { kind: 'check' };
    }
    if (limpers === 0) {
      if (inRange(pct, w, rng)) {
        // Passive players raise only the top of their range and limp the rest (a calling
        // station limps nearly everything).
        const limp = st.p.limp;
        if (limp > 0 && pct > w * (1 - limp) * (1 - limp) && randUnit(rng) < 0.5 + limp * 0.7) return call(sit);
        return aggressive(sit, openTo);
      }
      // The small blind completes a little wider when it's that kind of player.
      if (sit.dist === -1 && st.p.limp > 0 && inRange(pct, w * 1.3, rng)) return call(sit);
      return passive(sit);
    }
    // Limpers in front: raise to isolate them, or limp behind with hands that like a cheap flop.
    if (inRange(pct, w * (0.45 + 0.3 * st.aggr) * (1 - st.p.limp), rng) && randUnit(rng) < 0.4 + st.aggr * 0.6) return aggressive(sit, openTo + bb);
    if (inRange(pct, w * 1.15, rng) && (speculative(sit) || pct < w * 0.6 || st.p.limp > 0)) return call(sit);
    if (sit.dist === -1 && inRange(pct, 0.6 * st.loose, rng)) return call(sit);
    return passive(sit);
  }

  const agg = aggressorOpp(sit);
  const wo = agg ? preWidth(sit, agg, st) : 0.2;
  const callers = callersAfterLastRaise(sit);
  const potOdds = l.toCall / (sit.pot + l.toCall);
  const oop = sit.dist === -1 || sit.dist === -2 || (agg !== undefined && agg.dist >= 0 && agg.dist < sit.dist);

  if (raises === 1) {
    const value = Math.max(0.026, wo * 0.13) * (callers ? 0.9 : 1);
    // Passive players 3-bet only the very top and call with the rest.
    const valueW = st.aggr < 0.35 ? 0.02 : value;
    if (inRange(pct, valueW, rng)) return aggressive(sit, threeBetTo(sit, oop, callers, rng));
    // A few suited aces and connectors 3-bet as bluffs against late-position opens.
    const lateOpen = !agg || agg.dist <= 1 || agg.dist === -1;
    if (bluffCandidate(sit) && lateOpen && eff >= 60 && randUnit(rng) < 0.3 * st.bluff * st.aggr * (0.4 + st.skill)) {
      return aggressive(sit, threeBetTo(sit, oop, callers, rng));
    }
    let flat: number;
    if (sit.dist === -2) flat = wo * clamp(1.4 * (0.27 / Math.max(potOdds, 0.08)), 0.45, 1.8);
    else if (sit.dist === -1) flat = wo * 0.3;
    else flat = wo * (callers ? 0.6 : 0.5);
    flat *= Math.sqrt(st.loose);
    // Small pairs and suited connectors need the stack behind to pay off.
    if (!inRange(pct, flat, rng)) return passive(sit);
    if (speculative(sit) && pct > value * 2 && sit.dist !== -2) {
      const need = pair(sit) ? 15 : 18;
      if (eff * bb < need * l.toCall && st.skill > 0.4) return passive(sit);
    }
    return call(sit);
  }

  if (raises === 2) {
    // Facing a 3-bet (usually after opening).
    const value = Math.max(0.018, wo * 0.35);
    if (inRange(pct, value, rng)) return aggressive(sit, fourBetTo(sit, oop, rng));
    const opened = preActs(sit).some((a) => a.seat === sit.seat && a.kind === 'r');
    if (opened && bluffCandidate(sit) && hiRank(sit) === 12 && eff >= 90 && randUnit(rng) < 0.12 * st.bluff * st.skill) return aggressive(sit, fourBetTo(sit, oop, rng));
    const callW = wo * (oop ? 0.9 : 1.2) * Math.sqrt(st.loose);
    if (inRange(pct, callW, rng) && (!speculative(sit) || eff * bb >= 18 * l.toCall || pct < callW * 0.5)) return call(sit);
    return passive(sit);
  }

  // Facing a 4-bet or more: the very top gets it in, a little calls deep.
  if (inRange(pct, Math.max(0.012, wo * 0.45), rng)) return { kind: 'allin' };
  if (eff > 150 && inRange(pct, wo * 0.8, rng)) return call(sit);
  return passive(sit);
}

/** Open to 2.2 to 3 big blinds; weaker players size up, and all-over-the-place players wildly. */
function openSize(sit: BotSituation, st: Style, rng: Rng): number {
  const base = sit.dist === -1 ? 3 : sit.dist >= 3 ? 2.6 : 2.3;
  const sloppy = (1 - st.skill) * (randUnit(rng) < 0.25 ? 2 : 0.6);
  return base + sloppy + randUnit(rng) * 0.4;
}

function threeBetTo(sit: BotSituation, oop: boolean, callers: number, rng: Rng): Cents {
  return sit.bet * ((oop ? 3.8 : 3) + callers + randUnit(rng) * 0.4);
}

function fourBetTo(sit: BotSituation, oop: boolean, rng: Rng): Cents {
  return sit.bet * ((oop ? 2.5 : 2.2) + randUnit(rng) * 0.3);
}

/** The opponent who made the last raise. */
function aggressorOpp(sit: BotSituation): Opp | undefined {
  for (let i = sit.acts.length - 1; i >= 0; i--) {
    const a = sit.acts[i]!;
    if (a.street === sit.street && (a.kind === 'r' || a.kind === 'b') && a.seat !== sit.seat) return sit.opponents.find((o) => o.seat === a.seat);
  }
  return undefined;
}

function callersAfterLastRaise(sit: BotSituation): number {
  let n = 0;
  for (let i = sit.acts.length - 1; i >= 0; i--) {
    const a = sit.acts[i]!;
    if (a.street !== sit.street) break;
    if (a.kind === 'r' || a.kind === 'b') break;
    if (a.kind === 'c') n++;
  }
  return n;
}

/**
 * Most of the stack to call (or an all-in to face): get it in when the chance against their
 * range beats the price, else fold. The same test before and after the flop.
 */
function commitDecision(sit: BotSituation, st: Style, rng: Rng): BotDecision {
  const l = sit.legal;
  const specs = sit.opponents.map((o) => (sit.street === 0 ? { w: preWidth(sit, o, st), min: 0, bluff: 1 } : postRange(sit, o, st)));
  const eq = rangeEquity(sit.hole, sit.board, specs, sit.street === 0 ? PREFLOP_SAMPLES : EQUITY_SAMPLES, rng);
  const potOdds = l.toCall / (sit.pot + l.toCall);
  const need = potOdds - st.sticky + (1 - st.skill) * 0.02;
  if (eq < need) return passive(sit);
  // Ahead of the price: shove over a non-all-in bet when that is most of what is left anyway.
  if (l.canRaise && eq > 0.6 && randUnit(rng) < 0.5 + st.aggr * 0.5) return { kind: 'allin' };
  return call(sit);
}

// ---------------------------------------------------------------------------------------------
// After the flop

function postflop(sit: BotSituation, st: Style, rng: Rng): BotDecision {
  const l = sit.legal;
  const n = Math.max(1, sit.opponents.length);
  const me = classify(sit.hole[0], sit.hole[1], sit.board, sit.board.length);
  const tex = texture(sit.board);
  const specs = sit.opponents.map((o) => postRange(sit, o, st));
  const eq = rangeEquity(sit.hole, sit.board, specs, EQUITY_SAMPLES, rng);
  const pot = sit.pot;
  const eff = effBBs(sit) * sit.bb;
  const behind = eff - (sit.legal.maxTo - sit.legal.behind); // chips still to play after what's in front
  const spr = Math.max(0, behind) / Math.max(1, pot);
  const u = randUnit(rng);
  const river = sit.street === 3;
  const fold = foldiness(sit, st);
  const initiative = sit.aggressor || (sit.street === 1 && lastPreRaiser(sit) === sit.seat);

  // Most of the stack to call, or an all-in to face: all or nothing on the equity.
  if (l.toCall > 0 && (l.toCall >= l.behind * 0.45 || aggressorOpp(sit)?.allIn)) return commitDecision(sit, st, rng);

  if (l.canCheck) {
    if (!l.canBet) return { kind: 'check' };
    // Thin value against players who call too much; a little thicker on the river.
    const valueAt = (n === 1 ? 0.55 : n === 2 ? 0.63 : 0.7) + (river ? 0.04 : 0) - (1 - Math.min(1, fold)) * 0.06 * st.skill;
    if (eq >= valueAt) {
      if (spr <= 1 && eq >= 0.6) return { kind: 'allin' };
      // Slow-play a monster on a dry board now and then (out of position: to check-raise).
      if (eq >= 0.85 && tex.wet < 0.35 && !river && u < 0.12 + 0.18 * st.skill) return { kind: 'check' };
      // Passive players check a lot of their good hands.
      if (u > 0.3 + st.aggr * 0.75) return { kind: 'check' };
      return aggressive(sit, pot * valueSize(sit, tex.wet, eq, st, rng));
    }
    // Semi-bluff a real draw.
    if (!river && me.draw >= 2 && u < st.aggr * 0.55 * Math.min(1.4, fold) * Math.min(1.5, st.bluff)) return aggressive(sit, pot * betSize(sit, tex.wet, rng));
    // Continuation bets and barrels: more on dry boards, heads-up and in position.
    if (initiative && !river) {
      let freq = (sit.street === 1 ? 0.62 : 0.42) * (sit.ip ? 1.1 : 0.85) * (tex.wet < 0.3 ? 1.15 : tex.wet > 0.6 ? 0.75 : 0.95);
      freq *= n === 1 ? 1 : n === 2 ? 0.5 : 0.25;
      freq *= Math.min(1.5, fold) * (0.5 + st.aggr * 0.7) * Math.min(1.6, st.bluff);
      // the ones with some equity first
      if (eq > 0.3 || me.overs > 0 || me.draw > 0) freq *= 1.2;
      if (u < freq) return aggressive(sit, pot * betSize(sit, tex.wet, rng));
    }
    // Checked to in position: a stab at the pot.
    if (sit.ip && n === 1 && !initiative && sit.streetRaises === 0 && u < 0.18 * st.bluff * Math.min(1.5, fold)) return aggressive(sit, pot * betSize(sit, tex.wet, rng));
    // River bluffs, balanced against the value bets: missed draws and air, more with the initiative.
    if (river && n === 1 && eq < 0.3 && u < 0.26 * st.bluff * Math.min(1.6, fold) * (initiative ? 1.2 : 0.6)) return aggressive(sit, pot * (0.6 + randUnit(rng) * 0.4));
    return { kind: 'check' };
  }

  // Facing a bet or a raise.
  const potOdds = l.toCall / (pot + l.toCall);
  let need = potOdds;
  // Implied odds for a real draw: what more it can win when it gets there.
  if (!river && me.draw >= 2) {
    const oppBehind = Math.min(behind - l.toCall, pot);
    need = l.toCall / (pot + l.toCall + Math.max(0, oppBehind) * (me.nutDraw || me.draw === 3 ? 0.35 : 0.2));
  }
  need -= st.sticky;
  const raiseAt = n === 1 ? 0.72 : 0.8;
  if (eq >= raiseAt && l.canRaise) {
    if (spr <= 1.5) return { kind: 'allin' };
    // Just call sometimes with the best of it (in position on a dry board most of all).
    const slow = sit.ip && tex.wet < 0.35 && !river ? 0.35 : 0.12;
    if (u < (1 - slow) * (0.45 + st.aggr * 0.55)) return aggressive(sit, raiseTo(sit, tex.wet, rng));
    return call(sit);
  }
  // Semi-bluff raise (often a check-raise) with a big draw.
  if (l.canRaise && !river && me.draw >= 2 && eq >= need * 0.8 && sit.streetRaises <= 1 && u < st.aggr * Math.min(1.5, st.bluff) * 0.28 * Math.min(1.5, fold)) {
    return aggressive(sit, raiseTo(sit, tex.wet, rng));
  }
  // A bluff raise with nothing, rarely, on the flop.
  if (l.canRaise && sit.street === 1 && sit.streetRaises === 1 && me.score < 0.2 && u < 0.05 * st.bluff * st.skill * Math.min(1.5, fold)) return aggressive(sit, raiseTo(sit, tex.wet, rng));
  if (eq >= need) return call(sit);
  // Don't be run over by small bets: a skilled player defends a bit wider than the bare price.
  const small = l.toCall <= pot * 0.35;
  if (small && st.skill > 0.5 && eq >= need * 0.82 && me.made >= 0.3 && randUnit(rng) < 0.4) return call(sit);
  return passive(sit);
}

function lastPreRaiser(sit: BotSituation): number | null {
  let who: number | null = null;
  for (const a of sit.acts) if (a.street === 0 && (a.kind === 'r' || a.kind === 'b')) who = a.seat;
  return who;
}

/** A bet as a share of the pot, by texture: a third on dry boards, two thirds or more on wet ones. */
function betSize(sit: BotSituation, wet: number, rng: Rng): number {
  const base = sit.street === 1 ? 0.33 + wet * 0.4 : sit.street === 2 ? 0.55 + wet * 0.2 : 0.65;
  return base * (0.88 + randUnit(rng) * 0.24);
}

/** Value bets: the texture's size, bigger with the nuts on the river (an overbet now and then). */
function valueSize(sit: BotSituation, wet: number, eq: number, st: Style, rng: Rng): number {
  let f = betSize(sit, wet, rng);
  if (sit.street === 3) f = eq > 0.85 && randUnit(rng) < 0.25 * st.skill ? 1.2 + randUnit(rng) * 0.3 : 0.6 + randUnit(rng) * 0.35;
  return f;
}

/** A raise: about three times the bet, a little more on wet boards. */
function raiseTo(sit: BotSituation, wet: number, rng: Rng): Cents {
  return sit.bet * (2.7 + wet * 0.6 + randUnit(rng) * 0.5) + (sit.pot - sit.bet) * 0.15;
}

// ---------------------------------------------------------------------------------------------
// Mistakes

/**
 * Now and then a decision goes wrong, the way that kind of player's decisions go wrong: a loose
 * call from a calling station, a spewy bluff from a maniac, a nervous fold from a rock, and from
 * anyone a hero call or a bet sized for no good reason.
 */
function slip(d: BotDecision, sit: BotSituation, st: Style, rng: Rng): BotDecision {
  if (randUnit(rng) >= st.err) return d;
  const l = sit.legal;
  const u = randUnit(rng);
  const pot = sit.pot;
  const id = st.p.id;
  const cheap = l.toCall > 0 && l.toCall <= l.behind * 0.5;
  if (id === 'station' || id === 'fish') {
    if (d.kind === 'fold' && cheap) return { kind: 'call' };
    if ((d.kind === 'bet' || d.kind === 'raise') && u < 0.5) return call(sit);
    return d;
  }
  if (id === 'maniac' || id === 'lag') {
    if ((d.kind === 'check' || d.kind === 'fold' || d.kind === 'call') && (l.canBet || l.canRaise)) return aggressive(sit, sit.bet === 0 ? pot * 0.8 : sit.bet * 3);
    return d;
  }
  if (id === 'rock') {
    if (d.kind === 'call' && sit.street > 0) return { kind: 'fold' };
    return d;
  }
  // A solid player's mistakes: a hero call, a bluff at the wrong time, a strange size.
  if (d.kind === 'fold' && cheap && sit.street === 3) return { kind: 'call' };
  if (d.kind === 'check' && l.canBet && u < 0.5) return aggressive(sit, pot * (0.4 + randUnit(rng) * 0.6));
  if ((d.kind === 'bet' || d.kind === 'raise') && d.to !== undefined) return aggressive(sit, d.to * (0.6 + randUnit(rng) * 1.1));
  return d;
}

/** How long a bot takes to act, ms: quick folds, longer over big decisions. */
export function thinkTime(sit: BotSituation, p: Persona, rng: Rng): number {
  const big = sit.legal.toCall > sit.pot * 0.5 || sit.street >= 2 ? 1.3 : 1;
  return Math.round(p.think * (0.55 + randUnit(rng) * 0.9) * big);
}
