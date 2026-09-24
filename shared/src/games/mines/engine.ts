// Mines: a 5 × 5 board, 1 to 24 mines, gems under the rest (docs/rules/online-games.md §6).
//
// Bet takes the stake and places the mines with the server's Rng. Where they are stays in the
// engine's state and never reaches a view or an event until the round is over. The player turns
// tiles one at a time (or asks for a random one): a gem raises the multiplier, a mine ends the
// round. Cash out any time after the first gem; finding the last gem cashes out on its own. When
// the round ends, win or lose, the whole board is shown.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import { randInt } from '../../rng.ts';
import type { GameEngine, Step, Refusal, TableConfig, TableMode, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj, isInt, isAmount } from '../../protocol.ts';
import { TILES, MIN_MINES, MAX_MINES, gemsOf, multiplier, drawField } from './rules.ts';

export type MinesAction =
  | { type: 'bet'; amount: Cents; mines: number }
  | { type: 'reveal'; tile: number }
  | { type: 'random' }
  | { type: 'cashout' };

export interface MinesResult {
  /** cashout: the player took it; cleared: the last gem paid on its own; bust: a mine. */
  outcome: 'cashout' | 'cleared' | 'bust';
  gems: number;
  /** Hundredths the stake was paid at (0 on a bust). */
  mult: number;
  payout: Cents;
}

export interface MinesState {
  cfg: TableConfig;
  phase: 'idle' | 'playing' | 'over';
  round: number;
  seat: number | null;
  bet: Cents;
  mines: number;
  /** The mined tiles (0-24, row by row). Server only until the round is over. */
  field: number[];
  /** Gems turned over, in order. */
  revealed: number[];
  /** The mine that ended the round, if one did. */
  hit: number | null;
  result: MinesResult | null;
}

export interface MinesView {
  phase: MinesState['phase'];
  round: number;
  bet: Cents;
  mines: number;
  revealed: number[];
  hit: number | null;
  /** What cashing out now pays, in hundredths (0 before the first gem). */
  mult: number;
  result: MinesResult | null;
  /** Every mine, once the round is over. */
  field: number[] | null;
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'mines',
    variant: '',
    mode,
    maxSeats: 1,
    // up to a hundred times the table maximum (shared/src/limits.ts scales it with the table)
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: { tiles: TILES, mines: { min: MIN_MINES, max: MAX_MINES } },
  };
}

function parseAction(raw: unknown): MinesAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet':
      if (!isAmount(raw.amount) || !isInt(raw.mines)) return null;
      return { type: 'bet', amount: raw.amount, mines: raw.mines };
    case 'reveal':
      if (!isInt(raw.tile)) return null;
      return { type: 'reveal', tile: raw.tile };
    case 'random':
    case 'cashout':
      return { type: raw.type };
    default:
      return null;
  }
}

/** End the round: pay `mult` (0 on a bust), show the board. */
function finish(s: MinesState, outcome: MinesResult['outcome'], events: GameEvent[]): Step<MinesState> {
  const seat = s.seat!;
  const gems = s.revealed.length;
  const mult = outcome === 'bust' ? 0 : multiplier(s.mines, gems);
  const payout = (s.bet / 100) * mult;
  s.result = { outcome, gems, mult, payout };
  s.phase = 'over';
  events.push({ type: 'over', round: s.round, outcome, gems, mult, payout, bet: s.bet, field: s.field, hit: s.hit });
  return {
    state: s,
    events,
    chips: payout > 0 ? [{ seat, payout }] : [],
    rounds: [{ seat, wagered: s.bet, returned: payout }],
  };
}

function reveal(s: MinesState, tile: number): Step<MinesState> {
  const events: GameEvent[] = [];
  if (s.field.includes(tile)) {
    s.hit = tile;
    events.push({ type: 'reveal', tile, safe: false, gems: s.revealed.length, mult: 0 });
    return finish(s, 'bust', events);
  }
  s.revealed.push(tile);
  const gems = s.revealed.length;
  events.push({ type: 'reveal', tile, safe: true, gems, mult: multiplier(s.mines, gems) });
  if (gems === gemsOf(s.mines)) return finish(s, 'cleared', events);
  return { state: s, events };
}

export const engine: GameEngine<MinesState, MinesAction, MinesView> = {
  id: 'mines',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, phase: 'idle', round: 0, seat: null, bet: 0, mines: 3, field: [], revealed: [], hit: null, result: null };
  },

  parseAction,

  act(state, seat, action, ctx): Step<MinesState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') {
      if (state.phase === 'playing') return refuse('WRONG_PHASE', 'Finish this board first: turn a tile or cash out.');
      if (action.mines < MIN_MINES || action.mines > MAX_MINES) return refuse('LIMIT', `Play with ${MIN_MINES} to ${MAX_MINES} mines.`);
      const lim = state.cfg.limits.default;
      const problem = checkBet(action.amount, lim);
      if (problem === 'OFF_STEP' || problem === 'NOT_CENTS') return refuse('LIMIT', `Bets are whole ${formatMoney(lim.step)} amounts.`);
      if (problem) return refuse('LIMIT', `Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}.`);
      if (action.amount > me.stack) return refuse('NOT_ENOUGH_CHIPS', `You have ${formatMoney(me.stack)} here.`);
      const s = structuredClone(state);
      s.round++;
      s.seat = seat;
      s.bet = action.amount;
      s.mines = action.mines;
      s.field = drawField(ctx.rng, action.mines);
      s.revealed = [];
      s.hit = null;
      s.result = null;
      s.phase = 'playing';
      return {
        state: s,
        events: [{ type: 'bet', round: s.round, bet: s.bet, mines: s.mines }],
        chips: [{ seat, bet: s.bet }],
      };
    }

    if (state.phase !== 'playing') return refuse('WRONG_PHASE', 'Place a bet to start a board.');
    if (state.seat !== seat) return refuse('NOT_YOUR_TURN', 'This board belongs to another player.');

    if (action.type === 'cashout') {
      if (state.revealed.length === 0) return refuse('WRONG_PHASE', 'Find a gem before cashing out.');
      return finish(structuredClone(state), 'cashout', []);
    }

    let tile: number;
    if (action.type === 'random') {
      const open = Array.from({ length: TILES }, (_, i) => i).filter((i) => !state.revealed.includes(i));
      tile = open[randInt(ctx.rng, open.length)]!;
    } else {
      tile = action.tile;
      if (tile < 0 || tile >= TILES) return refuse('BAD_REQUEST', 'That tile is not on the board.');
      if (state.revealed.includes(tile)) return refuse('BAD_REQUEST', 'That gem is already showing.');
    }
    return reveal(structuredClone(state), tile);
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
    // Standing up with gems found cashes them out; before the first tile the stake comes back.
    if (s.revealed.length > 0) return finish(s, 'cashout', []);
    s.phase = 'idle';
    s.field = [];
    return { state: s, events: [{ type: 'void', round: s.round, bet: s.bet }], chips: [{ seat, payout: s.bet }] };
  },

  liveBets(state, seat) {
    return state.phase === 'playing' && state.seat === seat ? state.bet : 0;
  },

  view(state) {
    return {
      phase: state.phase,
      round: state.round,
      bet: state.bet,
      mines: state.mines,
      revealed: [...state.revealed],
      hit: state.hit,
      mult: state.phase === 'playing' ? multiplier(state.mines, state.revealed.length) : state.result?.mult ?? 0,
      result: state.result,
      field: state.phase === 'over' ? [...state.field] : null,
    };
  },
};
