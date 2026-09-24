// Tower: the online lounge's take on Stake's Dragon Tower (docs/rules/online-games-b.md §1).
//
// Bet takes the stake and builds the whole tower from the server's Rng: for each of the nine
// rows, which tiles hide the dragon. That layout stays in the engine's state and never reaches a
// view or an event until the round is over. The player picks one tile per row, bottom up (or
// asks for a random one); an egg climbs a row, the dragon ends the round. Cash out any time after
// the first egg; the ninth egg cashes out on its own. When the round ends, win or lose, the whole
// tower is shown.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import { randInt } from '../../rng.ts';
import type { GameEngine, Step, Refusal, TableConfig, TableMode, GameEvent } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isObj, isInt, isAmount } from '../../protocol.ts';
import { type Difficulty, LEVELS, SPECS, isDifficulty, multiplier, drawTower } from './rules.ts';

export type TowerAction =
  | { type: 'bet'; amount: Cents; difficulty: Difficulty }
  | { type: 'pick'; tile: number }
  | { type: 'random' }
  | { type: 'cashout' };

export interface TowerResult {
  /** cashout: the player took it; top: the ninth egg paid on its own; bust: the dragon. */
  outcome: 'cashout' | 'top' | 'bust';
  /** Rows climbed when it ended. */
  level: number;
  /** Hundredths the stake was paid at (0 on a bust). */
  mult: number;
  payout: Cents;
}

export interface TowerState {
  cfg: TableConfig;
  phase: 'idle' | 'climbing' | 'over';
  round: number;
  seat: number | null;
  bet: Cents;
  difficulty: Difficulty;
  /** The dragon's tiles in each row, bottom row first. Server only until the round is over. */
  bad: number[][];
  /** The tile picked in each row so far; after a bust the last one is the dragon. */
  picks: number[];
  result: TowerResult | null;
}

export interface TowerView {
  phase: TowerState['phase'];
  round: number;
  bet: Cents;
  difficulty: Difficulty;
  /** Rows climbed (safe picks). */
  level: number;
  picks: number[];
  /** What cashing out now pays, in hundredths (0 before the first egg). */
  mult: number;
  result: TowerResult | null;
  /** The whole tower (the dragon's tiles per row), once the round is over. */
  tower: number[][] | null;
}

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'tower',
    variant: '',
    mode,
    maxSeats: 1,
    buyIn: { min: 10 * DOLLAR, max: 10_000 * DOLLAR },
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: { levels: LEVELS },
  };
}

function parseAction(raw: unknown): TowerAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'bet':
      if (!isAmount(raw.amount) || !isDifficulty(raw.difficulty)) return null;
      return { type: 'bet', amount: raw.amount, difficulty: raw.difficulty };
    case 'pick':
      if (!isInt(raw.tile)) return null;
      return { type: 'pick', tile: raw.tile };
    case 'random':
    case 'cashout':
      return { type: raw.type };
    default:
      return null;
  }
}

function level(s: TowerState): number {
  // Every pick but a losing last one is an egg.
  return s.result?.outcome === 'bust' ? s.picks.length - 1 : s.picks.length;
}

/** End the round: pay `mult` (0 on a bust), show the tower. */
function finish(s: TowerState, outcome: TowerResult['outcome'], events: GameEvent[]): Step<TowerState> {
  const seat = s.seat!;
  const climbed = outcome === 'bust' ? s.picks.length - 1 : s.picks.length;
  const mult = outcome === 'bust' ? 0 : multiplier(s.difficulty, climbed);
  // Whole-dollar bets times a multiplier in hundredths: always a whole number of cents.
  const payout = (s.bet / 100) * mult;
  s.result = { outcome, level: climbed, mult, payout };
  s.phase = 'over';
  events.push({ type: 'over', round: s.round, outcome, level: climbed, mult, payout, bet: s.bet, tower: s.bad });
  return {
    state: s,
    events,
    chips: payout > 0 ? [{ seat, payout }] : [],
    rounds: [{ seat, wagered: s.bet, returned: payout }],
  };
}

/** Pick `tile` on the next row. */
function pick(s: TowerState, tile: number): Step<TowerState> {
  const row = s.picks.length;
  const safe = !s.bad[row]!.includes(tile);
  s.picks.push(tile);
  const events: GameEvent[] = [];
  if (!safe) {
    events.push({ type: 'pick', row, tile, safe: false, mult: 0 });
    return finish(s, 'bust', events);
  }
  const climbed = row + 1;
  events.push({ type: 'pick', row, tile, safe: true, mult: multiplier(s.difficulty, climbed) });
  if (climbed === LEVELS) return finish(s, 'top', events);
  return { state: s, events };
}

export const engine: GameEngine<TowerState, TowerAction, TowerView> = {
  id: 'tower',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, phase: 'idle', round: 0, seat: null, bet: 0, difficulty: 'easy', bad: [], picks: [], result: null };
  },

  parseAction,

  act(state, seat, action, ctx): Step<TowerState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Take a seat first.');

    if (action.type === 'bet') {
      if (state.phase === 'climbing') return refuse('WRONG_PHASE', 'Finish this climb first: pick a tile or cash out.');
      const lim = state.cfg.limits.default;
      const problem = checkBet(action.amount, lim);
      if (problem === 'OFF_STEP' || problem === 'NOT_CENTS') return refuse('LIMIT', `Bets are whole ${formatMoney(lim.step)} amounts.`);
      if (problem) return refuse('LIMIT', `Bet ${formatMoney(lim.min)} to ${formatMoney(lim.max)}.`);
      if (action.amount > me.stack) return refuse('NOT_ENOUGH_CHIPS', `You have ${formatMoney(me.stack)} here.`);
      const s = structuredClone(state);
      s.round++;
      s.seat = seat;
      s.bet = action.amount;
      s.difficulty = action.difficulty;
      s.bad = drawTower(ctx.rng, action.difficulty);
      s.picks = [];
      s.result = null;
      s.phase = 'climbing';
      return {
        state: s,
        events: [{ type: 'bet', round: s.round, bet: s.bet, difficulty: s.difficulty }],
        chips: [{ seat, bet: s.bet }],
      };
    }

    if (state.phase !== 'climbing') return refuse('WRONG_PHASE', 'Place a bet to start a climb.');
    if (state.seat !== seat) return refuse('NOT_YOUR_TURN', 'This climb belongs to another player.');

    if (action.type === 'cashout') {
      if (state.picks.length === 0) return refuse('WRONG_PHASE', 'Find the first egg before cashing out.');
      return finish(structuredClone(state), 'cashout', []);
    }

    const tiles = SPECS[state.difficulty].tiles;
    const tile = action.type === 'random' ? randInt(ctx.rng, tiles) : action.tile;
    if (!Number.isInteger(tile) || tile < 0 || tile >= tiles) return refuse('BAD_REQUEST', `Pick one of the ${tiles} tiles.`);
    return pick(structuredClone(state), tile);
  },

  // Nothing here runs on a clock: the tower waits for the player.
  tick: () => null,
  deadline: () => null,
  shiftDeadlines: (state) => state,

  seatJoined(state) {
    return { state, events: [] };
  },

  seatLeaving(state, seat) {
    if (state.phase !== 'climbing' || state.seat !== seat) return { state, events: [] };
    const s = structuredClone(state);
    // Standing up with eggs found cashes them out; before the first pick nothing has been risked
    // yet, so the stake simply comes back (no round is counted).
    if (s.picks.length > 0) return finish(s, 'cashout', []);
    s.phase = 'idle';
    s.bad = [];
    return { state: s, events: [{ type: 'void', round: s.round, bet: s.bet }], chips: [{ seat, payout: s.bet }] };
  },

  liveBets(state, seat) {
    return state.phase === 'climbing' && state.seat === seat ? state.bet : 0;
  },

  view(state) {
    const climbed = level(state);
    return {
      phase: state.phase,
      round: state.round,
      bet: state.bet,
      difficulty: state.difficulty,
      level: climbed,
      picks: [...state.picks],
      mult: state.phase === 'climbing' ? multiplier(state.difficulty, climbed) : state.result?.mult ?? 0,
      result: state.result,
      tower: state.phase === 'over' ? state.bad.map((r) => [...r]) : null,
    };
  },
};
