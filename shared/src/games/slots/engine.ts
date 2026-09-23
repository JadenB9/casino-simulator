// Slot machines: three one-player machines, one variant each (see machines.ts). A spin is one
// action and one round: the bet comes off the stack, the reels are drawn and scored, the win
// goes back on, all in the same step. There is no betting window, no timer and nothing live
// between spins, so leaving is always clean.

import { type Cents, DOLLAR, checkBet } from '../../money.ts';
import { randInt } from '../../rng.ts';
import type { EngineCtx, GameEngine, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import { MACHINES, NEON, betOf, isMachineId, type Machine, type MachineId } from './machines.ts';
import { neonLineWins, playNeon, spinSevens, spinWild, type NeonSpin } from './rules.ts';
import type { LineWinView, ReelsEvent, ResultEvent, SlotsAction, SlotsView, SpinEvent } from './protocol.ts';

export interface SlotsState {
  cfg: TableConfig;
  machine: MachineId;
  round: number;
  denom: Cents;
  coins: number;
  stops: number[];
  last: SlotsView['last'];
}

function machineOf(variant: string): Machine {
  return MACHINES[isMachineId(variant) ? variant : 'sevens'];
}

/** Every bet this machine can take, for the limits: smallest, largest and their common step. */
function betRange(m: Machine): { min: Cents; max: Cents; step: Cents } {
  const bets: Cents[] = [];
  for (const d of m.denoms) for (let c = 1; c <= m.maxCoins; c++) bets.push(betOf(m, c, d));
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  return { min: Math.min(...bets), max: Math.max(...bets), step: bets.reduce(gcd) };
}

function config(variant: string, mode: TableMode): TableConfig {
  const m = machineOf(variant);
  return {
    game: 'slots',
    variant: m.id,
    mode,
    maxSeats: 1,
    buyIn: { min: 20 * DOLLAR, max: 10_000 * DOLLAR },
    limits: { default: betRange(m) },
    options: { machine: m.id, denoms: [...m.denoms], maxCoins: m.maxCoins, lines: m.lines },
  };
}

function parseAction(raw: unknown): SlotsAction | null {
  if (!isObj(raw) || raw.type !== 'spin') return null;
  if (!isInt(raw.coins) || !isInt(raw.denom)) return null;
  return { type: 'spin', coins: raw.coins, denom: raw.denom };
}

/** The window a new machine shows before its first spin. Cosmetic only; nothing is paid on it. */
function idleStops(m: Machine, ctx: EngineCtx): number[] {
  const lengths = m.kind === 'video' ? m.strips.map((r) => r.length) : m.reels.map((r) => r.length);
  return lengths.map((n) => randInt(ctx.rng, n));
}

/** The symbol a 3-reel pay glass row is about ('BAR' for any three bars). */
const COMBO_SYMBOL: Record<string, string> = {
  three7: '7', three3B: '3B', three2B: '2B', three1B: '1B', anyBar: 'BAR',
  threeCH: 'CH', twoCH: 'CH', oneCH: 'CH', threeWX: 'WX', twoWX: 'WX', oneWX: 'WX',
};

function reelsFromNeon(spin: NeonSpin, index: number, freeLeft: number, unit: Cents, multiplier: number): ReelsEvent {
  const lines: LineWinView[] = neonLineWins(spin.stops).map((w) => ({ line: w.line, symbol: w.symbol, count: w.count, win: w.pay * unit * multiplier }));
  return {
    type: 'reels',
    stops: spin.stops,
    spin: index,
    freeLeft,
    lines,
    hits: [],
    combo: null,
    wilds: 0,
    scatters: spin.scatters,
    scatterWin: spin.scatterCredits * unit * multiplier,
    win: spin.credits * unit * multiplier,
    trigger: spin.trigger,
    multiplier,
  };
}

/** Which of the three payline symbols made a 3-reel win. */
function stepperHits(symbols: readonly string[], combo: string | null): boolean[] {
  if (combo === null) return [false, false, false];
  if (combo === 'oneCH') return [true, false, false];
  if (combo === 'twoCH') return [true, true, false];
  if (combo === 'oneWX' || combo === 'twoWX') return symbols.map((s) => s === 'WX');
  return [true, true, true];
}

function spin(s: SlotsState, seat: number, a: SlotsAction, stack: Cents, ctx: EngineCtx): Step<SlotsState> {
  const m = MACHINES[s.machine];
  const bet = betOf(m, a.coins, a.denom);
  const credit = stack - bet;
  s.round++;
  s.denom = a.denom;
  s.coins = a.coins;
  const spinEv: SpinEvent = { type: 'spin', seat, round: s.round, denom: a.denom, coins: a.coins, bet, credit };
  const events: (SpinEvent | ReelsEvent | ResultEvent)[] = [spinEv];
  // One coin (or one credit per line) of this denomination; every pay is a whole number of these.
  const unit = a.coins * a.denom;
  let win = 0;
  let freeWin = 0;
  let freeSpins = 0;

  if (m.kind === 'video') {
    const play = playNeon(ctx.rng);
    win = play.credits * unit;
    events.push(reelsFromNeon(play.base, 0, play.free.length, unit, 1));
    play.free.forEach((fs, i) => {
      const ev = reelsFromNeon(fs, i + 1, play.free.length - i - 1, unit, NEON.freeMultiplier);
      freeWin += ev.win;
      events.push(ev);
    });
    freeSpins = play.free.length;
    s.stops = (play.free.at(-1) ?? play.base).stops;
  } else {
    const r = m.id === 'sevens' ? spinSevens(ctx.rng) : spinWild(ctx.rng);
    win = r.pay * unit;
    const hits = stepperHits(r.symbols, r.combo);
    events.push({
      type: 'reels',
      stops: r.stops,
      spin: 0,
      freeLeft: 0,
      lines: r.combo === null ? [] : [{ line: 0, symbol: COMBO_SYMBOL[r.combo]!, count: hits.filter(Boolean).length, win }],
      hits,
      combo: r.combo,
      wilds: r.wilds,
      scatters: 0,
      scatterWin: 0,
      win,
      trigger: false,
      multiplier: 1,
    });
    s.stops = r.stops;
  }

  events.push({ type: 'result', seat, bet, win, freeSpins, freeWin, credit: credit + win });
  s.last = { bet, win, freeSpins };
  return {
    state: s,
    events,
    chips: [win > 0 ? { seat, bet, payout: win } : { seat, bet }],
    rounds: [{ seat, wagered: bet, returned: win }],
  };
}

export const engine: GameEngine<SlotsState, SlotsAction, SlotsView> = {
  id: 'slots',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg, ctx) {
    const m = machineOf(cfg.variant);
    return { cfg, machine: m.id, round: 0, denom: m.denoms[0]!, coins: 1, stops: idleStops(m, ctx), last: null };
  },

  parseAction,

  act(state, seat, action, ctx): Step<SlotsState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Insert money first.');
    const m = MACHINES[state.machine];
    if (!m.denoms.includes(action.denom)) return refuse('BAD_REQUEST', "That coin value isn't on this machine.");
    if (action.coins < 1 || action.coins > m.maxCoins) {
      return refuse('BAD_REQUEST', m.kind === 'video' ? `Bet 1 to ${m.maxCoins} credits per line.` : `Bet 1 to ${m.maxCoins} coins.`);
    }
    const bet = betOf(m, action.coins, action.denom);
    if (checkBet(bet, state.cfg.limits.default)) return refuse('LIMIT', "That bet is outside this machine's limits.");
    if (bet > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough credits for that bet.');
    return spin(structuredClone(state), seat, action, me.stack, ctx);
  },

  // Nothing ever waits: a spin settles in the step that starts it.
  tick: () => null,
  deadline: () => null,
  shiftDeadlines: (state) => state,
  seatJoined: (state) => ({ state, events: [] }),
  seatLeaving: (state) => ({ state, events: [] }),
  liveBets: () => 0,

  view(state) {
    return { machine: state.machine, round: state.round, denom: state.denom, coins: state.coins, stops: state.stops, last: state.last };
  },
};
