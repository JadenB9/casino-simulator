// Texas Hold'em, no-limit, cash game (docs/rules/cards-and-machines.md section 4).
//
// Multiplayer: 2-9 people. Once the leader starts the table, a hand is dealt whenever at least
// two seated players are ready to play. Each decision has a 25 second clock plus a small time
// bank; when it runs out the table checks if that is free and folds otherwise, and sits the
// player out until they come back.
//
// Single player: you against five bots at a six-seat table. The bots are the engine's own seats:
// their chips are the house's and never touch the host, which only ever sees your bets and what
// you win. They act on tick() after a short think, from what their own seat could see.
//
// Money: the host holds every person's stack. Blinds, calls, bets and raises go into the pot as
// chip moves (stack -= bet); uncalled bets and pots come back as payouts. A player whose stack
// reaches zero after a hand is cashed out by the host, and may buy in again.

import type { Card } from '../../cards.ts';
import { type Cents, DOLLAR, formatMoney } from '../../money.ts';
import type { EngineCtx, GameEngine, Step, Refusal, TableConfig, TableMode, ChipMove, RoundResult, GameEvent } from '../../engine.ts';
import { refuse } from '../../engine.ts';
import { isObj, isAmount } from '../../protocol.ts';
import { type Rng, shuffle, randInt, randUnit } from '../../rng.ts';
import * as R from './rules.ts';
import { evaluate, handName, bestFive, intCard, cardText } from './eval.ts';
import { decide, PERSONAS, PERSONA_IDS, type BotSituation, type Position } from './bots.ts';
import type {
  HoldemAction,
  HoldemEvent,
  HoldemPhase,
  HoldemView,
  HoldemSeatView,
  HoldemHandSummary,
  HoldemLegalView,
  StreetName,
} from './protocol.ts';

export type { HoldemAction, HoldemView, HoldemEvent } from './protocol.ts';

export const SMALL_BLIND: Cents = 5 * DOLLAR;
export const BIG_BLIND: Cents = 10 * DOLLAR;
/** Bets and raises are whole dollars (an all-in is whatever is left). */
export const STEP: Cents = DOLLAR;

/** The regular clock for one decision. */
export const ACT_MS = 25_000;
/** Time bank: starts at 15 s, gains 5 s every 10 hands, up to 30 s (4.8). */
export const BANK_START_MS = 15_000;
export const BANK_ADD_MS = 5_000;
export const BANK_MAX_MS = 30_000;
/** A player who timed out gets this long on later decisions of the same hand before the table acts for them. */
export const AWAY_MS = 1_500;
/** The beat between a table becoming ready and the first deal. */
export const START_MS = 2_000;
/** Between the streets of an all-in run-out. */
export const RUNOUT_MS = 2_000;
/** How long the finished hand stays on the table, at least and at most. */
export const RESULTS_MIN_MS = 2_600;
export const RESULTS_MAX_MS = 12_000;
/** How many finished hands the view carries. */
const HISTORY = 3;
const LOG_MAX = 60;

export const BOT_NAMES = ['Nora', 'Dex', 'Mabel', 'Sal', 'Priya', 'Hank', 'Lu', 'Otto', 'Rosa', 'Vic', 'June', 'Walt', 'Ines', 'Gus', 'Tess', 'Ray', 'Coco', 'Abe'];

// ---------------------------------------------------------------------------------------------
// State

export interface SeatState {
  seat: number;
  bot: boolean;
  name: string;
  /** Bots: which personality (bots.ts). */
  persona: string | null;
  accountId: number | null;
  /** Chips behind. For people this mirrors the host's stack; for bots it is the only record. */
  stack: Cents;
  /** Won't be dealt in (asked to, or timed out). */
  sittingOut: boolean;
  /** Timed out this hand: later decisions this hand are made for them after a short beat. */
  away: boolean;
  /** Waiting for the big blind before being dealt in (new players, and players back from missing it). */
  waiting: boolean;
  /** The big blind passed this seat while it sat out. */
  missedBB: boolean;
  /** People: seated at the host right now (not buying in, cashing out or gone). */
  present: boolean;
  connected: boolean;
  /** Leaving: removed as soon as nothing of theirs is live. */
  leaving: boolean;
  /** Time bank left, ms. */
  bank: number;
  /** Hands dealt in, for the time bank. */
  hands: number;
}

export interface HoldemState {
  cfg: TableConfig;
  /** Server time of the last step. */
  at: number;
  seats: Record<number, SeatState>;
  phase: HoldemPhase;
  hand: R.Hand | null;
  handNo: number;
  /** When tick() next has work: a turn clock, a bot's think time, a run-out street, the next hand. */
  due: number | null;
  turn: { seat: number; deadline: number; bankFrom: number | null } | null;
  lastButton: number | null;
  lastBB: number | null;
  log: string[];
  history: HoldemHandSummary[];
  /** Collected in the hand just finished, by seat. */
  won: Record<number, Cents>;
  /** Seats whose round result (for profile stats) has gone out this hand. */
  recorded: number[];
  /** What happened before the flop, as any player at the table saw it (for the bots). */
  pre: { raises: number; limpers: number; raisers: number[] };
  streetRaises: number;
  /** Who made the last bet or raise on the previous street. */
  prevAggressor: number | null;
  /** Chips the house has put in front of bots (buy-ins and rebuys): the one source of new chips. */
  house: Cents;
}

// ---------------------------------------------------------------------------------------------
// Config and parsing

function config(_variant: string, mode: TableMode): TableConfig {
  return {
    game: 'holdem',
    variant: '',
    mode,
    maxSeats: mode === 'solo' ? 6 : 9,
    // 20 to 100 big blinds (4.1).
    buyIn: { min: 20 * BIG_BLIND, max: 100 * BIG_BLIND },
    // No limit: a bet is capped by the stack, not by the table. `min` is the big blind.
    limits: { default: { min: BIG_BLIND, max: 1_000_000 * DOLLAR, step: STEP } },
    options: { sb: SMALL_BLIND, bb: BIG_BLIND },
  };
}

function blinds(cfg: TableConfig): { sb: Cents; bb: Cents } {
  const sb = Number(cfg.options.sb);
  const bb = Number(cfg.options.bb);
  return { sb: sb > 0 ? sb : SMALL_BLIND, bb: bb > 0 ? bb : BIG_BLIND };
}

function parseAction(raw: unknown): HoldemAction | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case 'fold':
    case 'check':
    case 'call':
    case 'allin':
      return { type: raw.type };
    case 'bet':
      return isAmount(raw.amount) ? { type: 'bet', amount: raw.amount } : null;
    case 'raise':
      return isAmount(raw.to) ? { type: 'raise', to: raw.to } : null;
    case 'sitout':
      return typeof raw.on === 'boolean' ? { type: 'sitout', on: raw.on } : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Steps

interface Out {
  events: HoldemEvent[];
  chips: ChipMove[];
  rounds: RoundResult[];
}

function newOut(): Out {
  return { events: [], chips: [], rounds: [] };
}

function done(s: HoldemState, out: Out, now: number): Step<HoldemState> {
  s.at = now;
  const step: Step<HoldemState> = { state: s, events: out.events as unknown as GameEvent[] };
  if (out.chips.length) step.chips = out.chips;
  if (out.rounds.length) step.rounds = out.rounds;
  return step;
}

function nameOf(s: HoldemState, seat: number): string {
  return s.seats[seat]?.name ?? `Seat ${seat + 1}`;
}

function say(s: HoldemState, line: string): void {
  if (s.log.length < LOG_MAX) s.log.push(line);
}

const money = (c: Cents) => formatMoney(c);

/** Chips between a seat and the pot. Only people's moves go to the host; a bot's stack is ours. */
function move(s: HoldemState, out: Out, seat: number, bet: Cents, payout: Cents): void {
  const st = s.seats[seat];
  if (!st) return;
  st.stack += payout - bet;
  if (st.bot) return;
  if (bet > 0) out.chips.push({ seat, bet });
  if (payout > 0) out.chips.push({ seat, payout });
}

// ---------------------------------------------------------------------------------------------
// Seats

/** Bring our record of the people at the table in line with the host's. */
function sync(s: HoldemState, ctx: EngineCtx): void {
  const here = new Set<number>();
  for (const sc of ctx.seats) {
    here.add(sc.seat);
    let st = s.seats[sc.seat];
    if (!st || st.bot) {
      st = person(s, sc.seat, sc.name, sc.accountId, sc.stack);
      s.seats[sc.seat] = st;
    }
    st.name = sc.name;
    st.accountId = sc.accountId;
    st.connected = sc.connected;
    st.present = true;
    st.stack = sc.stack;
    // Table stakes can't promise chips the host doesn't have (it never happens: the host only
    // changes a stack between hands or through our own moves).
    const p = s.hand && R.player(s.hand, sc.seat);
    if (p && !p.folded && p.start - p.put > sc.stack) p.start = p.put + sc.stack;
  }
  for (const st of Object.values(s.seats)) if (!st.bot && !here.has(st.seat)) st.present = false;
}

function person(s: HoldemState, seat: number, name: string, accountId: number, stack: Cents): SeatState {
  return {
    seat,
    bot: false,
    name,
    persona: null,
    accountId,
    stack,
    sittingOut: false,
    away: false,
    // Multiplayer newcomers wait for the big blind; alone against bots there is nobody to wait for.
    waiting: s.cfg.mode === 'multi',
    missedBB: false,
    present: true,
    connected: true,
    leaving: false,
    bank: BANK_START_MS,
    hands: 0,
  };
}

function botBuyIn(s: HoldemState, rng: Rng): Cents {
  const { bb } = blinds(s.cfg);
  return (60 + randInt(rng, 41)) * bb;
}

/** Single player: fill the other five seats with bots, each with its own name and style. */
function seatBots(s: HoldemState, rng: Rng): void {
  if (s.cfg.mode !== 'solo') return;
  const taken = new Set(Object.values(s.seats).map((st) => st.name));
  const names = shuffle(rng, BOT_NAMES.filter((n) => !taken.has(n)));
  const styles = shuffle(rng, [...PERSONA_IDS]);
  let k = 0;
  // Seat 0 is the player's: the host seats the first (and only) person there.
  for (let seat = 1; seat < s.cfg.maxSeats; seat++) {
    if (s.seats[seat]) continue;
    const stack = botBuyIn(s, rng);
    s.house += stack;
    s.seats[seat] = {
      seat,
      bot: true,
      name: names[k] ?? `Player ${seat + 1}`,
      persona: styles[k % styles.length]!,
      accountId: null,
      stack,
      sittingOut: false,
      away: false,
      waiting: false,
      missedBB: false,
      present: true,
      connected: true,
      leaving: false,
      bank: 0,
      hands: 0,
    };
    k++;
  }
}

function dealable(st: SeatState): boolean {
  if (st.stack <= 0 || st.sittingOut || st.leaving) return false;
  return st.bot || (st.present && st.connected);
}

function canStart(s: HoldemState, ctx: EngineCtx): boolean {
  if (!ctx.started) return false;
  const seats = Object.values(s.seats).filter(dealable);
  const people = seats.filter((st) => !st.bot).length;
  return s.cfg.mode === 'solo' ? people >= 1 && seats.length >= 2 : people >= 2;
}

/** Clockwise strictly between seats a and b. */
function between(a: number, b: number, x: number): boolean {
  const d = (y: number) => (y - a + 64) % 64;
  return d(x) > 0 && d(x) < d(b);
}

// ---------------------------------------------------------------------------------------------
// The hand

function startHand(s: HoldemState, ctx: EngineCtx, out: Out): boolean {
  const eligible = Object.values(s.seats)
    .filter(dealable)
    .map((st) => ({ seat: st.seat, fresh: st.waiting }));
  const pos = R.positions(eligible, s.lastButton, s.lastBB, (n) => randInt(ctx.rng, n));
  if (!pos) return false;
  const { sb, bb } = blinds(s.cfg);
  if (s.lastBB !== null) {
    for (const st of Object.values(s.seats)) {
      if (!st.bot && !pos.dealt.includes(st.seat) && !dealable(st) && between(s.lastBB, pos.bb, st.seat)) st.missedBB = true;
    }
  }
  s.handNo += 1;
  const deck = shuffle(ctx.rng, Array.from({ length: 52 }, (_, i) => i));
  const h = R.newHand({
    id: s.handNo,
    sb,
    bb,
    button: pos.button,
    sbSeat: pos.sb,
    bbSeat: pos.bb,
    players: pos.dealt.map((seat) => ({ seat, stack: s.seats[seat]!.stack })),
    deck,
  });
  s.hand = h;
  s.phase = 'playing';
  s.lastButton = pos.button;
  s.lastBB = pos.bb;
  s.log = [];
  s.won = {};
  s.recorded = [];
  s.pre = { raises: 0, limpers: 0, raisers: [] };
  s.streetRaises = 0;
  s.prevAggressor = null;
  for (const seat of pos.dealt) {
    const st = s.seats[seat]!;
    st.waiting = false;
    st.missedBB = false;
    st.away = false;
    st.hands += 1;
    if (!st.bot && st.hands % 10 === 0) st.bank = Math.min(BANK_MAX_MS, st.bank + BANK_ADD_MS);
  }
  const order = R.dealOrder(h).map((p) => p.seat);
  out.events.push({ type: 'hand', id: h.id, button: h.button, sb: h.sbSeat, bb: h.bbSeat, seats: order });
  say(s, `Hand #${h.id}: ${nameOf(s, h.button)} has the button, blinds ${money(sb)}/${money(bb)}`);
  for (const [seat, blind] of [
    [h.sbSeat, 'sb'],
    [h.bbSeat, 'bb'],
  ] as const) {
    const p = R.player(h, seat)!;
    move(s, out, seat, p.put, 0);
    out.events.push({ type: 'post', seat, blind, amount: p.put, allIn: p.allIn });
    say(s, `${nameOf(s, seat)} posts the ${blind === 'sb' ? 'small' : 'big'} blind ${money(p.put)}${p.allIn ? ' and is all-in' : ''}`);
  }
  out.events.push({ type: 'deal', order });
  const first = R.nextToAct(h, h.bbSeat);
  const dealMs = 700 + order.length * 2 * 150;
  if (first) setTurn(s, ctx, first.seat, ctx.now + dealMs);
  else closeRound(s, ctx, out, ctx.now + dealMs);
  return true;
}

function setTurn(s: HoldemState, ctx: EngineCtx, seat: number, startAt: number): void {
  const h = s.hand!;
  const st = s.seats[seat]!;
  h.toAct = seat;
  if (st.bot) {
    const p = PERSONAS[st.persona ?? 'reg'] ?? PERSONAS.reg!;
    const think = Math.round(p.think * (0.55 + randUnit(ctx.rng) * 0.9) * (h.street >= 2 ? 1.25 : 1));
    s.turn = { seat, deadline: startAt + think, bankFrom: null };
  } else if (st.away || !st.present || st.leaving) {
    s.turn = { seat, deadline: startAt + AWAY_MS, bankFrom: null };
  } else {
    const bankFrom = startAt + ACT_MS;
    s.turn = { seat, deadline: bankFrom + st.bank, bankFrom };
  }
  s.due = s.turn.deadline;
}

/** Charge the time bank for whatever part of it this decision used. */
function useBank(s: HoldemState, seat: number, now: number): void {
  const t = s.turn;
  const st = s.seats[seat];
  if (!t || !st || t.seat !== seat || t.bankFrom === null) return;
  if (now > t.bankFrom) st.bank = Math.max(0, st.bank - (now - t.bankFrom));
}

const MOVE_WORDS: Record<string, string> = { fold: 'folds', check: 'checks', call: 'calls', bet: 'bets', raise: 'raises to', allin: 'is all-in' };

/** Everything that follows a decision: chips, the event, the log, and whose turn it is now. */
function afterMove(s: HoldemState, ctx: EngineCtx, out: Out, seat: number, r: { move: R.Move; added: Cents }, prevBet: Cents, auto?: 'timeout' | 'leave'): void {
  const h = s.hand!;
  const p = R.player(h, seat)!;
  if (r.added > 0) move(s, out, seat, r.added, 0);
  const mv = r.move as 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
  out.events.push({ type: 'act', seat, move: mv, added: r.added, total: p.street, ...(auto ? { auto } : {}) });
  const raised = h.bet > prevBet;
  const amount = mv === 'call' ? ` ${money(r.added)}` : mv === 'bet' || mv === 'raise' ? ` ${money(p.street)}` : mv === 'allin' ? ` (${money(p.street)})` : '';
  const why = auto === 'timeout' ? ' (out of time)' : auto === 'leave' ? ' (left the table)' : '';
  say(s, `${nameOf(s, seat)} ${MOVE_WORDS[mv]}${amount}${why}`);
  if (raised) {
    s.streetRaises += 1;
    if (h.street === 0) {
      s.pre.raises += 1;
      if (!s.pre.raisers.includes(seat)) s.pre.raisers.push(seat);
    }
  } else if (h.street === 0 && mv === 'call' && s.pre.raises === 0) s.pre.limpers += 1;
  if (p.folded) record(s, out, seat);
  advance(s, ctx, out, seat, ctx.now + 500);
}

function advance(s: HoldemState, ctx: EngineCtx, out: Out, from: number, startAt: number): void {
  const h = s.hand!;
  s.turn = null;
  h.toAct = null;
  if (R.livePlayers(h).length <= 1) {
    winUncontested(s, ctx, out);
    return;
  }
  const next = R.nextToAct(h, from);
  if (next) setTurn(s, ctx, next.seat, startAt);
  else closeRound(s, ctx, out, startAt);
}

/** A betting round is over: uncalled chips back, bets into the pot, then the next street, a run-out or the showdown. */
function closeRound(s: HoldemState, ctx: EngineCtx, out: Out, startAt: number): void {
  const h = s.hand!;
  s.prevAggressor = h.aggressor;
  sweep(s, out);
  s.streetRaises = 0;
  if (h.street === 3) {
    showdown(s, ctx, out);
    return;
  }
  if (R.ableCount(h) >= 2) {
    const cards = R.dealStreet(h);
    boardEvent(s, out, cards);
    const first = R.nextToAct(h, h.button);
    if (first) {
      setTurn(s, ctx, first.seat, startAt + 600 + cards.length * 280);
      return;
    }
  }
  // Nobody can bet any more: every hand is turned up now (TDA 17) and the board runs out.
  h.closed = true;
  for (const seat of R.showdownOrder(h)) reveal(s, out, seat);
  s.phase = 'runout';
  s.turn = null;
  s.due = startAt + RUNOUT_MS;
}

function sweep(s: HoldemState, out: Out): void {
  const h = s.hand!;
  const back = R.endStreet(h);
  if (back) {
    move(s, out, back.seat, 0, back.amount);
    out.events.push({ type: 'uncalled', seat: back.seat, amount: back.amount });
    say(s, `Uncalled bet of ${money(back.amount)} returned to ${nameOf(s, back.seat)}`);
  }
  out.events.push({ type: 'collect', pots: R.computePots(h.players).map((p) => p.amount) });
}

function boardEvent(s: HoldemState, out: Out, cards: number[]): void {
  const h = s.hand!;
  const street = R.STREET_NAMES[h.street] as StreetName;
  const codes = cards.map(intCard);
  out.events.push({ type: 'board', street, cards: codes });
  const label = street[0]!.toUpperCase() + street.slice(1);
  say(s, `${label}: ${h.board.map((c) => cardText(intCard(c))).join(' ')}`);
}

function reveal(s: HoldemState, out: Out, seat: number): void {
  const h = s.hand!;
  const p = R.player(h, seat)!;
  if (p.shown) return;
  p.shown = true;
  const cards = [...p.hole, ...h.board];
  const hand = cards.length >= 5 ? handName(evaluate(cards)) : null;
  out.events.push({ type: 'reveal', seat, cards: p.hole.map(intCard), hand });
  say(s, `${nameOf(s, seat)} shows ${p.hole.map((c) => cardText(intCard(c))).join(' ')}${hand ? ` (${hand})` : ''}`);
}

function runout(s: HoldemState, ctx: EngineCtx, out: Out): void {
  const h = s.hand!;
  const cards = R.dealStreet(h);
  boardEvent(s, out, cards);
  if (h.street === 3) showdown(s, ctx, out);
  else s.due = ctx.now + RUNOUT_MS;
}

/**
 * Hands are tabled in order (4.5): the last aggressor first, otherwise the first player left of
 * the button. With nobody all-in, a later hand that can't beat the best one shown is mucked.
 */
function showdown(s: HoldemState, ctx: EngineCtx, out: Out): void {
  const h = s.hand!;
  h.closed = true;
  const order = R.showdownOrder(h);
  const values = new Map<number, number>();
  for (const seat of order) values.set(seat, R.handValue(h, R.player(h, seat)!));
  const allIn = h.players.some((p) => !p.folded && p.allIn);
  const mucked = new Set<number>();
  let best = -1;
  for (const seat of order) {
    const p = R.player(h, seat)!;
    const v = values.get(seat)!;
    if (p.shown || allIn || v >= best) {
      if (!p.shown) reveal(s, out, seat);
      best = Math.max(best, v);
    } else {
      p.mucked = true;
      mucked.add(seat);
      out.events.push({ type: 'muck', seat });
      say(s, `${nameOf(s, seat)} mucks`);
    }
  }
  pay(s, out, R.awardPots(h, values, mucked));
  finishHand(s, ctx, out);
}

function winUncontested(s: HoldemState, ctx: EngineCtx, out: Out): void {
  const h = s.hand!;
  sweep(s, out);
  h.closed = true;
  pay(s, out, R.awardPots(h, new Map()));
  finishHand(s, ctx, out);
}

/** Side pots first, then the main pot (RRP showdown rule 7). */
function pay(s: HoldemState, out: Out, awards: R.Award[]): void {
  const h = s.hand!;
  for (const a of [...awards].reverse()) {
    const label = a.pot === 0 ? 'main pot' : awards.length > 2 ? `side pot ${a.pot}` : 'side pot';
    for (const w of a.winners) {
      move(s, out, w.seat, 0, w.amount);
      s.won[w.seat] = (s.won[w.seat] ?? 0) + w.amount;
    }
    const contested = a.value >= 0 && h.board.length === 5;
    const hand = contested ? handName(a.value) : null;
    const lead = a.winners[0]!.seat;
    const best = contested ? bestFive([...R.player(h, lead)!.hole, ...h.board]).map(intCard) : null;
    out.events.push({ type: 'win', pot: a.pot, label, amount: a.amount, winners: a.winners, hand, best });
    const names = a.winners.map((w) => nameOf(s, w.seat));
    if (a.winners.length === 1) say(s, `${names[0]} wins ${money(a.amount)} (${label})${hand ? ` with ${hand}` : ''}`);
    else say(s, `${names.join(' and ')} split the ${label}, ${money(a.amount)}${hand ? `, with ${hand}` : ''}`);
  }
}

function record(s: HoldemState, out: Out, seat: number): void {
  const st = s.seats[seat];
  const p = s.hand && R.player(s.hand, seat);
  if (!st || st.bot || !p || s.recorded.includes(seat)) return;
  s.recorded.push(seat);
  out.rounds.push({ seat, wagered: p.put, returned: s.won[seat] ?? 0 });
}

function finishHand(s: HoldemState, ctx: EngineCtx, out: Out): void {
  const h = s.hand!;
  s.turn = null;
  h.toAct = null;
  for (const p of h.players) record(s, out, p.seat);
  out.events.push({ type: 'handEnd', id: h.id });
  s.history.unshift({ id: h.id, board: h.board.map(intCard), lines: [...s.log] });
  s.history.length = Math.min(s.history.length, HISTORY);
  // Busted bots buy back in with the house's money; people are cashed out by the host.
  for (const st of Object.values(s.seats)) {
    if (st.bot && st.stack === 0) {
      const amount = botBuyIn(s, ctx.rng);
      st.stack = amount;
      s.house += amount;
      out.events.push({ type: 'rebuy', seat: st.seat, amount });
      say(s, `${st.name} rebuys for ${money(amount)}`);
    }
    if (!st.bot && st.leaving) delete s.seats[st.seat];
  }
  s.phase = 'results';
  let ms = RESULTS_MIN_MS;
  for (const e of out.events) ms += e.type === 'win' ? 1_500 : e.type === 'reveal' ? 600 : e.type === 'board' ? 500 : e.type === 'muck' ? 250 : 0;
  s.due = ctx.now + Math.min(RESULTS_MAX_MS, ms);
}

// ---------------------------------------------------------------------------------------------
// Bots

function positionOf(h: R.Hand, seat: number): Position {
  if (seat === h.button) return 'late';
  if (seat === h.sbSeat) return 'sb';
  if (seat === h.bbSeat) return 'bb';
  const seats = h.players.map((p) => p.seat);
  const order: number[] = [];
  for (let x = R.after(seats, h.bbSeat); x !== h.button; x = R.after(seats, x)) order.push(x);
  const i = order.indexOf(seat);
  const f = order.length <= 1 ? 1 : i / order.length;
  return f < 1 / 3 ? 'early' : f < 2 / 3 ? 'middle' : 'late';
}

/** What the bot in `seat` can see: its own cards and the public table, nothing else. */
export function botSituation(s: HoldemState, seat: number): BotSituation {
  const h = s.hand!;
  const p = R.player(h, seat)!;
  return {
    hole: [p.hole[0]!, p.hole[1]!],
    board: [...h.board],
    street: h.street,
    bb: h.bb,
    step: STEP,
    pot: R.potTotal(h),
    bet: h.bet,
    legal: R.legal(h, p, STEP),
    position: positionOf(h, seat),
    opponents: h.players.filter((o) => o.seat !== seat && !o.folded).map((o) => ({ strong: s.pre.raisers.includes(o.seat) })),
    preRaises: s.pre.raises,
    limpers: s.pre.limpers,
    streetRaises: s.streetRaises,
    aggressor: s.prevAggressor === seat,
  };
}

/** Counts bot decisions the rules refused (the tests require zero). */
export const botStats = { decisions: 0, refused: 0 };

function botAct(s: HoldemState, ctx: EngineCtx, out: Out, seat: number): void {
  const h = s.hand!;
  const st = s.seats[seat]!;
  const p = R.player(h, seat)!;
  const persona = PERSONAS[st.persona ?? 'reg'] ?? PERSONAS.reg!;
  const d = decide(botSituation(s, seat), persona, ctx.rng);
  const prevBet = h.bet;
  botStats.decisions++;
  let r = R.applyMove(h, p, d.kind, d.to, STEP);
  if (!r.ok) {
    botStats.refused++;
    const m = R.timeoutMove(h, p);
    r = { ok: true, move: m, added: 0 };
  }
  afterMove(s, ctx, out, seat, r, prevBet);
}

// ---------------------------------------------------------------------------------------------
// People

function timeout(s: HoldemState, ctx: EngineCtx, out: Out, seat: number): void {
  const h = s.hand!;
  const st = s.seats[seat]!;
  const p = R.player(h, seat)!;
  const prevBet = h.bet;
  if (s.turn?.bankFrom !== null && s.turn?.bankFrom !== undefined) st.bank = 0;
  const m = R.timeoutMove(h, p);
  if (!st.away && !st.leaving) {
    st.away = true;
    st.sittingOut = true;
    out.events.push({ type: 'sitout', seat, on: true });
  }
  afterMove(s, ctx, out, seat, { move: m, added: 0 }, prevBet, 'timeout');
}

function act(state: HoldemState, seat: number, action: HoldemAction, ctx: EngineCtx): Step<HoldemState> | Refusal {
  const s = structuredClone(state);
  const out = newOut();
  sync(s, ctx);
  const st = s.seats[seat];
  if (!st || st.bot) return refuse('NOT_SEATED', 'Take a seat first.');

  if (action.type === 'sitout') {
    if (action.on === st.sittingOut && !st.away) return { state, events: [] };
    if (action.on) st.sittingOut = true;
    else {
      st.sittingOut = false;
      st.away = false;
      if (st.missedBB && s.cfg.mode === 'multi') st.waiting = true;
      st.missedBB = false;
    }
    out.events.push({ type: 'sitout', seat, on: action.on });
    say(s, `${st.name} ${action.on ? 'sits out' : 'is back'}`);
    if (!action.on && s.phase === 'waiting' && s.due === null && canStart(s, ctx)) s.due = ctx.now + START_MS;
    return done(s, out, ctx.now);
  }

  const h = s.hand;
  if (!h || s.phase !== 'playing') return refuse('WRONG_PHASE', 'Wait for the next hand.');
  if (h.toAct !== seat) return refuse('NOT_YOUR_TURN', "It isn't your turn.");
  const p = R.player(h, seat)!;
  const prevBet = h.bet;
  const to = action.type === 'bet' ? action.amount : action.type === 'raise' ? action.to : undefined;
  const r = R.applyMove(h, p, action.type, to, STEP);
  if (!r.ok) return refuse(r.code, r.msg);
  useBank(s, seat, ctx.now);
  st.away = false;
  afterMove(s, ctx, out, seat, r, prevBet);
  return done(s, out, ctx.now);
}

// ---------------------------------------------------------------------------------------------
// View

function seatView(s: HoldemState, st: SeatState, viewer: number | null): HoldemSeatView {
  const h = s.hand;
  const p = h ? R.player(h, st.seat) : undefined;
  const handOver = s.phase === 'results';
  let cards: (Card | null)[] = [];
  let hand: string | null = null;
  let best: Card[] | null = null;
  if (h && p && p.hole.length === 2) {
    const mine = viewer === st.seat;
    if (mine || p.shown) {
      cards = p.hole.map(intCard);
      const all = [...p.hole, ...h.board];
      if (all.length >= 5) {
        hand = handName(evaluate(all));
        if (p.shown && handOver && h.board.length === 5) best = bestFive(all).map(intCard);
      }
    } else if (!p.folded) cards = [null, null];
  }
  return {
    seat: st.seat,
    name: st.name,
    bot: st.bot,
    stack: st.stack,
    sittingOut: st.sittingOut,
    waiting: st.waiting,
    away: !st.bot && (!st.connected || !st.present),
    inHand: !!p && !handOver,
    folded: !!p?.folded,
    allIn: !!p?.allIn && !handOver,
    bet: p && !handOver ? p.street : 0,
    cards,
    last: p?.last ?? null,
    hand,
    best,
    won: handOver ? (s.won[st.seat] ?? 0) : 0,
  };
}

function legalView(h: R.Hand, p: R.Player): HoldemLegalView {
  const l = R.legal(h, p, STEP);
  return {
    fold: !l.canCheck,
    check: l.canCheck,
    call: l.toCall,
    callAllIn: l.toCall > 0 && l.toCall === l.behind,
    bet: l.canBet ? { min: l.minTo, max: l.maxTo } : null,
    raise: l.canRaise ? { min: l.minTo, max: l.maxTo } : null,
    behind: l.behind,
    street: p.street,
    step: STEP,
  };
}

function view(s: HoldemState, viewer: number | null): HoldemView {
  const h = s.hand;
  const live = s.phase === 'playing' || s.phase === 'runout';
  const seats: HoldemView['seats'] = [];
  for (let i = 0; i < s.cfg.maxSeats; i++) seats.push(s.seats[i] ? seatView(s, s.seats[i]!, viewer) : null);
  const me = viewer !== null ? s.seats[viewer] : undefined;
  const mine = h && viewer !== null ? R.player(h, viewer) : undefined;
  const pots = h && live ? R.computePots(h.players, true) : [];
  return {
    at: s.at,
    mode: s.cfg.mode,
    maxSeats: s.cfg.maxSeats,
    blinds: blinds(s.cfg),
    phase: s.phase,
    handId: h?.id ?? 0,
    button: h?.button ?? null,
    sbSeat: h?.sbSeat ?? null,
    bbSeat: h?.bbSeat ?? null,
    street: h ? R.STREET_NAMES[h.street] : null,
    board: h ? h.board.map(intCard) : [],
    pots: pots.map((p, i) => ({ amount: p.amount, label: i === 0 ? 'Main pot' : pots.length > 2 ? `Side pot ${i}` : 'Side pot', eligible: p.eligible })),
    total: h && live ? R.potTotal(h) : 0,
    bet: h && live ? h.bet : 0,
    turn: s.phase === 'playing' && s.turn ? { ...s.turn } : null,
    nextAt: s.phase === 'results' || s.phase === 'waiting' ? s.due : null,
    seats,
    you:
      me && !me.bot
        ? {
            seat: me.seat,
            cards: mine ? mine.hole.map(intCard) : [],
            legal: h && mine && s.phase === 'playing' && h.toAct === me.seat ? legalView(h, mine) : null,
            sittingOut: me.sittingOut,
            waiting: me.waiting,
            bank: me.bank,
          }
        : null,
    log: [...s.log],
    history: s.history,
  };
}

// ---------------------------------------------------------------------------------------------
// The engine

export const engine: GameEngine<HoldemState, HoldemAction, HoldemView> = {
  id: 'holdem',
  stateVersion: 1,
  seats: { min: 2, max: 9, multiplayer: true },
  config,

  create(cfg, ctx) {
    const s: HoldemState = {
      cfg,
      at: ctx.now,
      seats: {},
      phase: 'waiting',
      hand: null,
      handNo: 0,
      due: null,
      turn: null,
      lastButton: null,
      lastBB: null,
      log: [],
      history: [],
      won: {},
      recorded: [],
      pre: { raises: 0, limpers: 0, raisers: [] },
      streetRaises: 0,
      prevAggressor: null,
      house: 0,
    };
    sync(s, ctx);
    seatBots(s, ctx.rng);
    return s;
  },

  parseAction,
  act,

  tick(state, ctx) {
    if (state.due === null || ctx.now < state.due) {
      // A waiting table deals as soon as enough players are ready, after a short beat.
      if (state.phase !== 'waiting' || state.due !== null) return null;
      const s = structuredClone(state);
      sync(s, ctx);
      if (!canStart(s, ctx)) return null;
      s.due = ctx.now + START_MS;
      s.at = ctx.now;
      return { state: s, events: [] };
    }
    const s = structuredClone(state);
    const out = newOut();
    sync(s, ctx);
    seatBots(s, ctx.rng);
    switch (s.phase) {
      case 'playing': {
        const seat = s.hand?.toAct ?? null;
        const st = seat !== null ? s.seats[seat] : undefined;
        if (seat === null || !st) s.due = null;
        else if (st.bot) botAct(s, ctx, out, seat);
        else timeout(s, ctx, out, seat);
        break;
      }
      case 'runout':
        runout(s, ctx, out);
        break;
      case 'results':
      case 'waiting':
        s.phase = 'waiting';
        s.due = null;
        s.turn = null;
        if (canStart(s, ctx)) startHand(s, ctx, out);
        break;
    }
    return done(s, out, ctx.now);
  },

  deadline(state) {
    return state.due;
  },

  shiftDeadlines(state, ms) {
    const s = structuredClone(state);
    if (s.due !== null) s.due += ms;
    if (s.turn) {
      s.turn.deadline += ms;
      if (s.turn.bankFrom !== null) s.turn.bankFrom += ms;
    }
    return s;
  },

  seatJoined(state, seat, ctx) {
    const s = structuredClone(state);
    const out = newOut();
    const old = s.seats[seat];
    if (old && !old.bot && !old.leaving) {
      sync(s, ctx);
    } else {
      delete s.seats[seat];
      sync(s, ctx);
    }
    const st = s.seats[seat];
    if (st) {
      st.leaving = false;
      st.sittingOut = false;
      st.away = false;
    }
    seatBots(s, ctx.rng);
    if (s.phase === 'waiting' && s.due === null && canStart(s, ctx)) s.due = ctx.now + START_MS;
    return done(s, out, ctx.now);
  },

  seatLeaving(state, seat, ctx) {
    const st0 = state.seats[seat];
    if (!st0 || st0.bot) return { state, events: [] };
    const s = structuredClone(state);
    const out = newOut();
    sync(s, ctx);
    const st = s.seats[seat]!;
    st.leaving = true;
    const h = s.hand;
    const p = h ? R.player(h, seat) : undefined;
    let live = false;
    if (h && p && !p.folded && (s.phase === 'playing' || s.phase === 'runout')) {
      if (s.phase === 'playing' && !p.allIn && !h.closed) {
        // Leaving mid-hand folds the hand, even out of turn. Chips already in stay in the pot.
        R.fold(p);
        if (h.toAct === seat) useBank(s, seat, ctx.now);
        out.events.push({ type: 'act', seat, move: 'fold', added: 0, total: p.street, auto: 'leave' });
        say(s, `${st.name} folds (left the table)`);
        record(s, out, seat);
        if (h.toAct === seat) advance(s, ctx, out, seat, ctx.now + 500);
        else if (R.livePlayers(h).length <= 1) winUncontested(s, ctx, out);
      } else live = true; // all-in, or the board is running out: the hand plays on
    }
    if (!live && s.seats[seat]) delete s.seats[seat];
    return done(s, out, ctx.now);
  },

  liveBets(state, seat) {
    const h = state.hand;
    if (!h || (state.phase !== 'playing' && state.phase !== 'runout')) return 0;
    const p = R.player(h, seat);
    return p && !p.folded ? p.put : 0;
  },

  view,
};
