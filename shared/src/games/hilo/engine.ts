// Hi-Lo: guess whether the next card is higher or lower, as far as you dare
// (docs/rules/online-games-b.md §3).
//
// A card is always face up. Between rounds it can be skipped for free; Bet starts a round on it.
// Each guess draws the next card from a fresh 52-card deck (with replacement) at the moment it is
// made, so there is no next card anywhere until then: nothing to hide, nothing to leak. A right
// guess multiplies what's riding by 12.87 / (winning ranks); a wrong one loses the bet. Skip moves
// to a new card without changing the multiplier. Cash out any time after the first right guess.

import type { Card } from '../../cards.ts';
import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, Step, Refusal, TableConfig, TableMode, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj, isAmount } from '../../protocol.ts';
import { type Guess, MAX_SKIPS, drawCard, winCount, wins, guessLabel, payMult, guessAllowed, rankOfCard } from './rules.ts';

export type HiloAction = { type: 'bet'; amount: Cents } | { type: 'guess'; dir: Guess } | { type: 'skip' } | { type: 'cashout' };

export interface HiloStep {
  card: Card;
  /** How this card came up: the round's first card, a skip, or a guess on the card before it. */
  how: 'start' | 'skip' | Guess;
  /** For a guess, whether it was right (a start or a skip is always true). */
  win: boolean;
  /** What would be paid after this card, in hundredths (0 until the first right guess). */
  mult: number;
}

export interface HiloResult {
  outcome: 'cashout' | 'bust';
  /** Right guesses in the round. */
  guesses: number;
  /** Hundredths the stake was paid at (0 on a bust). */
  mult: number;
  payout: Cents;
}

export interface HiloState {
  cfg: TableConfig;
  phase: 'idle' | 'playing' | 'over';
  round: number;
  seat: number | null;
  bet: Cents;
  /** The card face up now; between rounds, the one the next round starts on. */
  card: Card;
  /** This round's cards, in order. */
  trail: HiloStep[];
  /** How many ranks out of 13 won each right guess this round. */
  counts: number[];
  skips: number;
  result: HiloResult | null;
}

export interface HiloOption {
  label: string;
  /** Ranks out of 13 that win it. */
  count: number;
  /** What cashing out would pay after winning it, in hundredths. */
  mult: number;
  /** False when a win would pass the 1,000,000× ceiling. */
  allowed: boolean;
}

export interface HiloView {
  phase: HiloState['phase'];
  round: number;
  bet: Cents;
  card: Card;
  trail: HiloStep[];
  /** What cashing out now pays, in hundredths (0 before the first right guess). */
  mult: number;
  hi: HiloOption;
  lo: HiloOption;
  skipsLeft: number;
  result: HiloResult | null;
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'hilo',
    variant: '',
    mode,
    maxSeats: 1,
    buyIn: { min: 10 * DOLLAR, max: 10_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: { maxSkips: MAX_SKIPS },
  };
}

function parseAction(raw: unknown): HiloAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet':
      return isAmount(raw.amount) ? { type: 'bet', amount: raw.amount } : null;
    case 'guess':
      return raw.dir === 'hi' || raw.dir === 'lo' ? { type: 'guess', dir: raw.dir } : null;
    case 'skip':
    case 'cashout':
      return { type: raw.type };
    default:
      return null;
  }
}

function option(counts: readonly number[], card: Card, g: Guess): HiloOption {
  const r = rankOfCard(card);
  const count = winCount(r, g);
  return { label: guessLabel(r, g), count, mult: payMult([...counts, count]), allowed: guessAllowed(counts, count) };
}

function finish(s: HiloState, outcome: HiloResult['outcome'], events: GameEvent[]): Step<HiloState> {
  const seat = s.seat!;
  const mult = outcome === 'bust' ? 0 : payMult(s.counts);
  const payout = (s.bet / 100) * mult;
  s.result = { outcome, guesses: s.counts.length, mult, payout };
  s.phase = 'over';
  events.push({ type: 'over', round: s.round, outcome, guesses: s.counts.length, mult, payout, bet: s.bet });
  return {
    state: s,
    events,
    chips: payout > 0 ? [{ seat, payout }] : [],
    rounds: [{ seat, wagered: s.bet, returned: payout }],
  };
}

export const engine: GameEngine<HiloState, HiloAction, HiloView> = {
  id: 'hilo',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg, ctx) {
    return { cfg, phase: 'idle', round: 0, seat: null, bet: 0, card: drawCard(ctx.rng), trail: [], counts: [], skips: 0, result: null };
  },

  parseAction,

  act(state, seat, action, ctx): Step<HiloState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');
    const playing = state.phase === 'playing';

    if (action.type === 'bet') {
      if (playing) return refuse('WRONG_PHASE', 'Finish this round first: guess, skip or cash out.');
      const lim = state.cfg.limits.default;
      const problem = checkBet(action.amount, lim);
      if (problem === 'OFF_STEP' || problem === 'NOT_CENTS') return refuse('LIMIT', `Bets are whole ${formatMoney(lim.step)} amounts.`);
      if (problem) return refuse('LIMIT', `Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}.`);
      if (action.amount > me.stack) return refuse('NOT_ENOUGH_CHIPS', `You have ${formatMoney(me.stack)} here.`);
      const s = structuredClone(state);
      s.round++;
      s.seat = seat;
      s.bet = action.amount;
      s.trail = [{ card: s.card, how: 'start', win: true, mult: 0 }];
      s.counts = [];
      s.skips = 0;
      s.result = null;
      s.phase = 'playing';
      return { state: s, events: [{ type: 'bet', round: s.round, bet: s.bet, card: s.card }], chips: [{ seat, bet: s.bet }] };
    }

    if (action.type === 'skip') {
      // Between rounds a skip just changes the card the next round starts on.
      if (!playing) {
        const s = structuredClone(state);
        s.card = drawCard(ctx.rng);
        return { state: s, events: [{ type: 'skip', card: s.card, mult: 0, playing: false }] };
      }
      if (state.seat !== seat) return refuse('NOT_YOUR_TURN', 'This round belongs to another player.');
      if (state.skips >= MAX_SKIPS) return refuse('LIMIT', `That's ${MAX_SKIPS} skips this round: guess or cash out.`);
      const s = structuredClone(state);
      s.card = drawCard(ctx.rng);
      s.skips++;
      const mult = payMult(s.counts);
      s.trail.push({ card: s.card, how: 'skip', win: true, mult });
      return { state: s, events: [{ type: 'skip', card: s.card, mult, playing: true }] };
    }

    if (!playing) return refuse('WRONG_PHASE', 'Place a bet to start a round.');
    if (state.seat !== seat) return refuse('NOT_YOUR_TURN', 'This round belongs to another player.');

    if (action.type === 'cashout') {
      if (state.counts.length === 0) return refuse('WRONG_PHASE', 'Win a guess before cashing out.');
      return finish(structuredClone(state), 'cashout', []);
    }

    // guess
    const r = rankOfCard(state.card);
    const count = winCount(r, action.dir);
    if (!guessAllowed(state.counts, count)) return refuse('LIMIT', 'That would pass the 1,000,000× ceiling: cash out.');
    const s = structuredClone(state);
    const next = drawCard(ctx.rng);
    const win = wins(r, action.dir, rankOfCard(next));
    s.card = next;
    if (win) s.counts.push(count);
    const mult = win ? payMult(s.counts) : 0;
    s.trail.push({ card: next, how: action.dir, win, mult });
    const events: GameEvent[] = [{ type: 'guess', dir: action.dir, count, card: next, win, mult }];
    if (!win) return finish(s, 'bust', events);
    return { state: s, events };
  },

  tick: () => null,
  deadline: () => null,
  shiftDeadlines: (state) => state,

  seatJoined(state) {
    return { state, events: [] };
  },

  seatLeaving(state, seat) {
    if (state.phase !== 'playing' || state.seat !== seat) return { state, events: [] };
    const s = structuredClone(state);
    // Standing up after a right guess cashes it out; before one, the stake comes back.
    if (s.counts.length > 0) return finish(s, 'cashout', []);
    s.phase = 'idle';
    return { state: s, events: [{ type: 'void', round: s.round, bet: s.bet }], chips: [{ seat, payout: s.bet }] };
  },

  liveBets(state, seat) {
    return state.phase === 'playing' && state.seat === seat ? state.bet : 0;
  },

  view(state) {
    const counts = state.phase === 'playing' ? state.counts : [];
    return {
      phase: state.phase,
      round: state.round,
      bet: state.bet,
      card: state.card,
      trail: state.trail.map((t) => ({ ...t })),
      mult: state.phase === 'playing' ? payMult(state.counts) : state.result?.mult ?? 0,
      hi: option(counts, state.card, 'hi'),
      lo: option(counts, state.card, 'lo'),
      skipsLeft: state.phase === 'playing' ? MAX_SKIPS - state.skips : MAX_SKIPS,
      result: state.result,
    };
  },
};

