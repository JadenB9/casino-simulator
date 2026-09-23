// Slot machines: six one-player machines, one variant each (see lineup.ts). A spin is one action
// and one round: the bet comes off the stack, the reels are drawn and scored, the win goes back
// on, all in the same step. There is no betting window, no timer and nothing live between spins,
// so leaving is always clean.

import { type Cents, DOLLAR, checkBet } from '../../money.ts';
import { randInt } from '../../rng.ts';
import type { EngineCtx, GameEngine, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import type { Rng } from '../../rng.ts';
import { NEON, betOf } from './machines.ts';
import { neonLineWins, playNeon, spinSevens, spinWild, type NeonSpin } from './rules.ts';
import { LINEUP, isSlotId, reelLengths, type AnyMachine, type SlotId } from './lineup.ts';
import { settleDiamonds } from './diamonds.ts';
import { settleCherries } from './cherries.ts';
import { settleGoldRush } from './goldrush.ts';
import type { LineWinView, ReelsEvent, ResultEvent, SlotsAction, SlotsView, SpinEvent, SpinSettlement } from './protocol.ts';

export interface SlotsState {
  cfg: TableConfig;
  machine: SlotId;
  round: number;
  denom: Cents;
  coins: number;
  stops: number[];
  last: SlotsView['last'];
}

function machineOf(variant: string): AnyMachine {
  return LINEUP[isSlotId(variant) ? variant : 'sevens'];
}

/** The machines that settle a spin in their own file: the reels events, the win, the final stops. */
const SETTLE: Partial<Record<SlotId, (rng: Rng, unit: Cents) => SpinSettlement>> = {
  diamonds: settleDiamonds,
  cherries: settleCherries,
  goldrush: settleGoldRush,
};

/** Every bet this machine can take, for the limits: smallest, largest and their common step. */
function betRange(m: AnyMachine): { min: Cents; max: Cents; step: Cents } {
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
function idleStops(m: AnyMachine, ctx: EngineCtx): number[] {
  return reelLengths(m).map((n) => randInt(ctx.rng, n));
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
  const m = LINEUP[s.machine];
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
  const settle = SETTLE[s.machine];

  if (settle) {
    const r = settle(ctx.rng, unit);
    events.push(...r.reels);
    win = r.win;
    freeWin = r.freeWin;
    freeSpins = r.freeSpins;
    s.stops = r.stops;
  } else if (m.id === 'neon') {
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
  } else if (m.id === 'sevens' || m.id === 'wild') {
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
    const m = LINEUP[state.machine];
    if (!m.denoms.includes(action.denom)) return refuse('BAD_REQUEST', "That coin value isn't on this machine.");
    if (action.coins < 1 || action.coins > m.maxCoins) {
      return refuse('BAD_REQUEST', m.kind === 'stepper' ? `Bet 1 to ${m.maxCoins} coins.` : `Bet 1 to ${m.maxCoins} credits per line.`);
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
