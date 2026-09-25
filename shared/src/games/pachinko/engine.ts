// Pachinko in the parlour (docs/rules/parlour-games.md §2). One launch is one action and one
// round: the batch's price comes off the stack, all 25 balls are drawn, and what they won goes
// back on, in the step that takes the bet. The client then fires the balls up the rail and steers
// each one into the pocket it was sent, playing the reels and any fever as it goes; nothing is
// live between launches, so leaving is always clean.
//
// The machine keeps the data a parlour's lamp above it shows: spins of the reels since the last
// jackpot, jackpots so far, and the last few chains.

import { type Cents, DOLLAR, checkBet, formatMoney } from '../../money.ts';
import type { GameEngine, GameEvent, Refusal, Step, TableConfig, TableMode } from '../../engine.ts';
import { refuse, seatOf } from '../../engine.ts';
import { isInt, isObj } from '../../protocol.ts';
import { type Pocket, BATCH, drawBall, dressReels, ballsFor, payoutFor } from './rules.ts';

export type PachinkoAction = { type: 'launch'; bet: Cents; power: number };

/** One ball as the screen plays it. */
export interface BallView {
  pocket: Pocket;
  /** A start pocket ball: the three reels as they stop. */
  reels?: [number, number, number];
  /** The jackpot numbers of its chain (a start pocket ball that hit). */
  chain?: number[];
}

/** A settled launch, as the recent-launch strip and a reconnect see it. */
export interface LaunchSummary {
  round: number;
  bet: Cents;
  balls: number;
  payout: Cents;
  /** Jackpots in the launch. */
  jackpots: number;
}

export interface LaunchEvent extends LaunchSummary {
  type: 'launch';
  seat: number;
  /** The dial as it was (0-100): how the balls fly, nothing else. */
  power: number;
  shots: BallView[];
  /** The seat's stack once the launch is paid. */
  stack: Cents;
  data: MachineData;
}

/** The data lamp on top of the machine. */
export interface MachineData {
  /** Reel spins since the last jackpot. */
  spins: number;
  /** Jackpots on this machine (this sitting). */
  jackpots: number;
  /** The longest chain so far. */
  best: number;
  /** The last chains' lengths, newest first. */
  chains: number[];
}

export interface PachinkoState {
  cfg: TableConfig;
  round: number;
  recent: LaunchSummary[];
  data: MachineData;
}

export interface PachinkoView {
  round: number;
  recent: LaunchSummary[];
  data: MachineData;
}

export const RECENT = 12;
export const CHAINS_KEPT = 8;

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'pachinko',
    variant: '',
    mode,
    maxSeats: 1,
    buyIn: { min: 10 * DOLLAR, max: 100_000 * DOLLAR },
    // a batch of 25 balls
    limits: { default: { min: DOLLAR, max: 1_000 * DOLLAR, step: DOLLAR } },
    options: {},
  };
}

export function isPower(x: unknown): x is number {
  return isInt(x) && x >= 0 && x <= 100;
}

function parseAction(raw: unknown): PachinkoAction | null {
  if (!isObj(raw) || raw.type !== 'launch') return null;
  if (!isInt(raw.bet) || !isPower(raw.power)) return null;
  return { type: 'launch', bet: raw.bet, power: raw.power };
}

export const engine: GameEngine<PachinkoState, PachinkoAction, PachinkoView> = {
  id: 'pachinko',
  stateVersion: 1,
  seats: { min: 1, max: 1, multiplayer: false },
  config,

  create(cfg) {
    return { cfg, round: 0, recent: [], data: { spins: 0, jackpots: 0, best: 0, chains: [] } };
  },

  parseAction,

  act(state, seat, action, ctx): Step<PachinkoState> | Refusal {
    const me = seatOf(ctx, seat);
    if (!me) return refuse('NOT_SEATED', 'Buy in first.');
    const lim = state.cfg.limits.default;
    const problem = checkBet(action.bet, lim);
    // a ball is a 25th of the batch, so a whole-dollar batch keeps every ball in whole cents
    if (problem || action.bet % DOLLAR !== 0) return refuse('LIMIT', `A batch of ${BATCH} balls is ${formatMoney(lim.min)} to ${formatMoney(lim.max)}, in whole dollars.`);
    if (action.bet > me.stack) return refuse('NOT_ENOUGH_CHIPS', 'Not enough chips for that batch.');

    const s = structuredClone(state);
    // every ball's outcome first (the draws that decide money), then the reels' faces
    const outcomes = Array.from({ length: BATCH }, () => drawBall(ctx.rng));
    const shots: BallView[] = outcomes.map((o) => {
      if (o.pocket !== 'start') return { pocket: o.pocket };
      return o.chain.length ? { pocket: 'start', reels: dressReels(ctx.rng, o.chain), chain: [...o.chain] } : { pocket: 'start', reels: dressReels(ctx.rng, o.chain) };
    });
    let balls = 0;
    let jackpots = 0;
    for (const o of outcomes) {
      balls += ballsFor(o);
      jackpots += o.chain.length;
      if (o.pocket !== 'start') continue;
      s.data.spins++;
      if (o.chain.length) {
        s.data.spins = 0;
        s.data.jackpots += o.chain.length;
        s.data.best = Math.max(s.data.best, o.chain.length);
        s.data.chains = [o.chain.length, ...s.data.chains].slice(0, CHAINS_KEPT);
      }
    }
    const payout = payoutFor(action.bet, balls);
    s.round++;
    const summary: LaunchSummary = { round: s.round, bet: action.bet, balls, payout, jackpots };
    s.recent = [summary, ...s.recent].slice(0, RECENT);
    const event: LaunchEvent = { type: 'launch', seat, ...summary, power: action.power, shots, stack: me.stack - action.bet + payout, data: { ...s.data, chains: [...s.data.chains] } };
    return {
      state: s,
      events: [event as unknown as GameEvent],
      chips: [payout > 0 ? { seat, bet: action.bet, payout } : { seat, bet: action.bet }],
      rounds: [{ seat, wagered: action.bet, returned: payout }],
    };
  },

  // A launch settles in the step that takes its bet: there is never anything to wait for.
  tick: () => null,
  deadline: () => null,
  shiftDeadlines: (state) => state,
  seatJoined: (state) => ({ state, events: [] }),
  seatLeaving: (state) => ({ state, events: [] }),
  liveBets: () => 0,

  view(state) {
    return { round: state.round, recent: state.recent, data: state.data };
  },
};
