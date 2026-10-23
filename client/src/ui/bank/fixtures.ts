// A stand-in bank for the dev page (shop/dev.html?screen=bank&fixture=1, no server): a regular's
// savings earning, a deposit running and one come due, a holding in the Casino Index with a month
// of prices behind it, a statement with every kind of line, and a transfer waiting in the inbox.
// It plays by server/src/bank.ts's rules (shared/src/bank.ts's numbers, the same refusals in the
// same words) and moves money between the session's balance and the bank, so the screens can be
// driven end to end. `empty`: a day-old account that has never used the bank.

import {
  DAY_MS, DEPOSIT_CAP, DEPOSIT_MAX_OPEN, DEPOSIT_MIN, FUND_CAP, FUND_ID, FUND_MIN, FUND_NAME, FUND_START, FUND_STEP_MS, HOUR_MS, SEND, STEPS_PER_DAY,
  accrue, costOf, depositInterest, depositPayout, nextPrice, notYet, refillFor, sendable, stepOf, termOf, unitsFor, valueOf,
  type BankState, type DepositView, type MarketResponse, type Received, type SavingsView, type StatementLine, type StatementResponse, type TermId,
} from '../../../../shared/src/bank.ts';
import { DOLLAR, formatMoney, type Cents } from '../../../../shared/src/money.ts';
import type { HttpError, LoanResponse, Profile } from '../../../../shared/src/protocol.ts';
import { ApiError } from '../../net/api.ts';
import type { SessionLike } from '../menu/deps.ts';
import type { BankApi } from './api.ts';

/** Players the stand-in knows, for Send money. */
export const FIXTURE_PLAYERS = ['Queen_Bee', 'Vegas_Vic', 'Lucky_Lou', 'High_Card'];

type Line = Omit<StatementLine, 'balance'>;

/** A seeded generator, so the month of prices is the same every load. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const refuse = (status: number, error: HttpError['error'], msg: string): ApiError => new ApiError(status, { error, msg });

export function fixtureBank(session: SessionLike, opts: { empty?: boolean; latency?: number } = {}): BankApi & { me(): Promise<Profile>; takeLoan(): Promise<LoanResponse> } {
  const ms = opts.latency ?? 260;
  const wait = () => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  const me = () => session.profile!;

  // the Casino Index: a month of five-minute steps up to now
  const last = stepOf(t0);
  const first = last - 30 * STEPS_PER_DAY - 1;
  const rnd = seeded(7);
  const prices: number[] = [FUND_START];
  for (let s = first + 1; s <= last; s++) prices.push(nextPrice(prices.at(-1)!, rnd(), rnd()));
  const priceAt = (step: number) => prices[Math.max(0, Math.min(prices.length - 1, step - first))]!;
  const stepNow = () => Math.min(last, stepOf(Date.now()));

  const empty = !!opts.empty;
  let savings: SavingsView = empty
    ? { balance: 0, accrued: 0, frac: 0, since: t0, earned: 0 }
    : { balance: 120_000 * DOLLAR, accrued: 0, frac: 0, since: t0 - 5 * HOUR_MS, earned: 4_210_55 };
  const deposits: DepositView[] = [];
  const holding = { units: 0, cost: 0 };
  const inbox: Received[] = [];
  const sends: { to: string; amount: Cents; at: number }[] = [];
  /** Newest first. */
  const lines: Line[] = [];
  let seq = 0;
  const add = (l: Omit<Line, 'id'> & { id?: string }) => lines.unshift({ id: l.id ?? `fx-${++seq}`, ...l } as Line);

  if (!empty) {
    // a statement going back ten days, oldest first (add() puts each on top)
    const at = (daysAgo: number, h = 0) => t0 - daysAgo * DAY_MS + h * HOUR_MS;
    const ledger = (when: number, kind: string, cash: Cents, ref: string | null, id: string) => add({ id, at: when, src: 'ledger', kind, cash, banked: 0, ref });
    ledger(at(10), 'grant', 50_000 * DOLLAR, null, 'daily:7:a');
    ledger(at(9.6), 'buyin', -20_000 * DOLLAR, 'bj-k3x9d0q2mz', 'bj:in:1');
    ledger(at(9.5), 'cashout', 64_250 * DOLLAR, 'bj-k3x9d0q2mz', 'bj:out:1');
    add({ at: at(9.4), src: 'item', kind: 'item', cash: -250_000 * DOLLAR, banked: 0, ref: 'rope-chain' });
    add({ at: at(8.2), src: 'order', kind: 'bar', cash: -32 * DOLLAR, banked: 0, ref: 'champagne' });
    add({ at: at(8, 2), src: 'bank', kind: 'save', cash: -100_000 * DOLLAR, banked: 100_000 * DOLLAR, ref: null });
    for (let d = 7; d >= 1; d--) add({ at: at(d, -12), src: 'bank', kind: 'interest', cash: 0, banked: 500 * DOLLAR + d * 1_37, ref: new Date(at(d + 1, -12)).toISOString().slice(0, 10) });
    ledger(at(6.5), 'buyin', -5_000 * DOLLAR, 'solo:roulette:american:7', 'rl:in:1');
    ledger(at(6.4), 'refund', 5_000 * DOLLAR, 'solo:roulette:american:7', 'rl:ref:1');
    add({ at: at(5.8), src: 'item', kind: 'item', cash: -150_000 * DOLLAR, banked: 0, ref: 'gold-top-six' });
    const buyStep = last - 20 * STEPS_PER_DAY;
    holding.units = unitsFor(24_000 * DOLLAR, priceAt(buyStep));
    holding.cost = 24_000 * DOLLAR;
    add({ at: buyStep * FUND_STEP_MS, src: 'bank', kind: 'buy', cash: -24_000 * DOLLAR, banked: 24_000 * DOLLAR, units: holding.units, ref: `${buyStep}:${priceAt(buyStep)}` });
    ledger(at(4.2), 'grant', 2_500 * DOLLAR, null, 'celeb:7:b');
    add({ at: at(4), src: 'item', kind: 'item', cash: -60_000 * DOLLAR, banked: 0, ref: 'skateboard' });
    add({ at: at(3.5), src: 'order', kind: 'fx', cash: -5_000 * DOLLAR, banked: 0, ref: 'fx-confetti' });
    add({ at: at(3.1), src: 'item', kind: 'item', cash: -60_000 * DOLLAR, banked: 0, ref: 'dab' });
    add({ at: at(2.4), src: 'item', kind: 'item', cash: -250_000 * DOLLAR, banked: 0, ref: 'halden-roadster' });
    ledger(at(2), 'loan', 41_200 * DOLLAR, null, 'loan:7:c');
    add({ at: at(1.2), src: 'bank', kind: 'unsave', cash: 5_000 * DOLLAR, banked: -5_000 * DOLLAR, ref: null });
    add({ at: at(0, -3.2), src: 'bank', kind: 'lock', cash: -5_000 * DOLLAR, banked: 5_000 * DOLLAR, ref: 'dep:7:old' });
    add({ at: at(0, -2.2), src: 'bank', kind: 'unlock', cash: 5_000_75, banked: -5_000 * DOLLAR, gain: 75, ref: 'dep:7:old' });
    deposits.push({ id: 'dep:7:old', term: '1h', principal: 5_000 * DOLLAR, interest: 75, openedAt: at(0, -3.2), maturesAt: at(0, -2.2), closedAt: at(0, -2.2), paid: 5_000_75 });
    const open = (term: TermId, principal: Cents, ago: number, id: string) => {
      const t = termOf(term)!;
      const openedAt = t0 - ago;
      deposits.unshift({ id, term, principal, interest: depositInterest(principal, t), openedAt, maturesAt: openedAt + t.ms });
      add({ at: openedAt, src: 'bank', kind: 'lock', cash: -principal, banked: principal, ref: id });
    };
    open('1h', 10_000 * DOLLAR, 75 * 60_000, 'dep:7:due');
    open('24h', 50_000 * DOLLAR, 5 * HOUR_MS, 'dep:7:day');
    add({ at: at(0, -1.5), src: 'bank', kind: 'send', cash: -1_250 * DOLLAR, banked: 0, peer: 'Queen_Bee', note: 'for the cab home', ref: 'xfer:7:q' });
    sends.push({ to: 'Queen_Bee', amount: 1_250 * DOLLAR, at: at(0, -1.5) });
    const gift = { id: 'xfer:9:v', from: 'Vegas_Vic', amount: 2_500 * DOLLAR, note: 'Drinks are on me', at: t0 - 40 * 60_000 };
    inbox.push(gift);
    add({ at: gift.at, src: 'bank', kind: 'receive', cash: gift.amount, banked: 0, peer: gift.from, note: gift.note, ref: gift.id });
    lines.sort((a, b) => b.at - a.at);
  } else {
    add({ id: 'grant:9:a', at: t0 - 20 * HOUR_MS, src: 'ledger', kind: 'grant', cash: 50_000 * DOLLAR, banked: 0, ref: null });
  }

  // ---- money in and out of the session's balance
  const setBalance = (balance: Cents) => {
    const p = me();
    session.set({ ...p, balance, rev: p.rev + 1 });
  };
  const pay = (amount: Cents) => {
    const b = me().balance;
    if (amount > b) throw refuse(409, 'INSUFFICIENT_FUNDS', `Not enough: that's ${formatMoney(amount)} and your balance is ${formatMoney(b)}.`);
    setBalance(b - amount);
  };
  const settle = (now: number) => {
    const { state, paid } = accrue(savings, now);
    for (const d of paid) add({ at: (d.day + 1) * DAY_MS, src: 'bank', kind: 'interest', cash: 0, banked: d.amount, ref: new Date(d.day * DAY_MS).toISOString().slice(0, 10) });
    savings = { ...state, earned: savings.earned + paid.reduce((t, d) => t + d.amount, 0) };
  };
  const openDeposits = () => deposits.filter((d) => d.closedAt === undefined);

  const state = (): BankState => {
    const now = Date.now();
    settle(now);
    const step = stepNow();
    const price = priceAt(step);
    const p = me();
    const locked = openDeposits().reduce((t, d) => t + d.principal, 0);
    const value = valueOf(holding.units, price);
    const sentToday = sends.filter((s) => s.at > now - DAY_MS).reduce((t, s) => t + s.amount, 0);
    const held = empty ? p.balance : Math.min(p.balance, 50_000 * DOLLAR);
    const newUntil = empty ? t0 + 4 * HOUR_MS : 0;
    const chips = p.tables.reduce((t, x) => t + (x.stack ?? x.escrow), 0);
    return {
      now,
      balance: p.balance,
      inPlay: p.inPlay,
      rev: p.rev,
      banked: savings.balance + locked + holding.cost,
      savings,
      deposits: [...openDeposits(), ...deposits.filter((d) => d.closedAt !== undefined && d.closedAt > now - DAY_MS)],
      fund: { id: FUND_ID, name: FUND_NAME, price, step, dayAgo: priceAt(step - STEPS_PER_DAY), units: holding.units, cost: holding.cost, value },
      send: { sendable: newUntil ? 0 : sendable(p.balance, held, sentToday), held, sentToday, newUntil, jailed: false },
      inbox: [...inbox],
      worth: p.balance + chips + savings.balance + locked + value,
      gain: empty ? savings.earned : savings.earned + 75 + 2_500 * DOLLAR - 1_250 * DOLLAR,
    };
  };

  return {
    async bank() {
      await wait();
      return state();
    },
    async market(range): Promise<MarketResponse> {
      await wait();
      const days = range === '30d' ? 30 : range === '7d' ? 7 : 1;
      const to = stepNow();
      const from = to - days * STEPS_PER_DAY;
      const points: [number, number][] = [];
      for (let s = Math.max(first, from); s <= to; s++) if ((s - from) % days === 0 || s === to) points.push([s, priceAt(s)]);
      // one market for everyone: a new account sees the same history
      return { fund: FUND_ID, name: FUND_NAME, points };
    },
    async statement(before): Promise<StatementResponse> {
      await wait();
      const PAGE = 15;
      const start = before ? lines.findIndex((l) => `${l.at}:${l.id}` === before) + 1 : 0;
      let balance = me().balance - lines.slice(0, start).reduce((t, l) => t + l.cash, 0);
      const out: StatementLine[] = [];
      for (const l of lines.slice(start, start + PAGE)) {
        out.push({ ...l, balance });
        balance -= l.cash;
      }
      const tail = out.at(-1);
      return { lines: out, next: out.length === PAGE && start + PAGE < lines.length && tail ? `${tail.at}:${tail.id}` : null };
    },
    async savings(dir, amount) {
      await wait();
      const now = Date.now();
      settle(now);
      if (dir === 'out' && amount > savings.balance) throw refuse(409, 'INSUFFICIENT_FUNDS', `Your savings hold ${formatMoney(savings.balance)}.`);
      if (dir === 'in') pay(amount);
      else setBalance(me().balance + amount);
      savings = { ...savings, balance: savings.balance + (dir === 'in' ? amount : -amount) };
      add({ at: now, src: 'bank', kind: dir === 'in' ? 'save' : 'unsave', cash: dir === 'in' ? -amount : amount, banked: dir === 'in' ? amount : -amount, ref: null });
      return state();
    },
    async deposit(term, amount) {
      await wait();
      const t = termOf(term)!;
      if (amount < DEPOSIT_MIN) throw refuse(400, 'BAD_REQUEST', `Deposits start at ${formatMoney(DEPOSIT_MIN)}.`);
      const open = openDeposits();
      if (open.length >= DEPOSIT_MAX_OPEN) throw refuse(409, 'LIMIT', `You can have ${DEPOSIT_MAX_OPEN} deposits open at once.`);
      const locked = open.reduce((s, d) => s + d.principal, 0);
      if (locked + amount > DEPOSIT_CAP) throw refuse(409, 'LIMIT', `Deposits hold up to ${formatMoney(DEPOSIT_CAP)} in all; you have ${formatMoney(locked)} locked.`);
      pay(amount);
      const now = Date.now();
      const id = `dep:7:${++seq}`;
      deposits.unshift({ id, term, principal: amount, interest: depositInterest(amount, t), openedAt: now, maturesAt: now + t.ms });
      add({ at: now, src: 'bank', kind: 'lock', cash: -amount, banked: amount, ref: id });
      return state();
    },
    async closeDeposit(id) {
      await wait();
      const d = deposits.find((x) => x.id === id);
      if (!d) throw refuse(404, 'NOT_FOUND', 'No such deposit.');
      if (d.closedAt !== undefined) throw refuse(409, 'NOT_ELIGIBLE', 'That deposit is already closed.');
      const now = Date.now();
      const out = depositPayout(d, now);
      d.closedAt = now;
      d.paid = out.paid;
      setBalance(me().balance + out.paid);
      add({ at: now, src: 'bank', kind: 'unlock', cash: out.paid, banked: -d.principal, gain: out.gain, ref: id });
      return state();
    },
    async buy(amount) {
      await wait();
      if (amount < FUND_MIN) throw refuse(400, 'BAD_REQUEST', `Buys start at ${formatMoney(FUND_MIN)}.`);
      if (holding.cost + amount > FUND_CAP) throw refuse(409, 'LIMIT', `The ${FUND_NAME} takes up to ${formatMoney(FUND_CAP)} per player, at cost; you have ${formatMoney(holding.cost)} in it.`);
      pay(amount);
      const step = stepNow();
      const units = unitsFor(amount, priceAt(step));
      holding.units += units;
      holding.cost += amount;
      add({ at: Date.now(), src: 'bank', kind: 'buy', cash: -amount, banked: amount, units, ref: `${step}:${priceAt(step)}` });
      return state();
    },
    async sell(amount) {
      await wait();
      if (holding.units === 0) throw refuse(409, 'NOT_ELIGIBLE', `You don't hold any of the ${FUND_NAME}.`);
      const step = stepNow();
      const price = priceAt(step);
      let units = holding.units;
      if (amount !== 'all') {
        units = unitsFor(amount, price);
        if (valueOf(units, price) < amount) units += 1;
        units = Math.min(units, holding.units);
      }
      const proceeds = valueOf(units, price);
      const cost = costOf(units, holding);
      holding.units -= units;
      holding.cost -= cost;
      setBalance(me().balance + proceeds);
      add({ at: Date.now(), src: 'bank', kind: 'sell', cash: proceeds, banked: -cost, units: -units, gain: proceeds - cost, ref: `${step}:${price}` });
      return state();
    },
    async send(to, amount, note, confirm) {
      await wait();
      const p = me();
      const target = FIXTURE_PLAYERS.find((n) => n.toLowerCase() === to.toLowerCase());
      if (to.toLowerCase() === p.name.toLowerCase()) throw refuse(409, 'NOT_ELIGIBLE', "You can't send money to yourself.");
      if (!target) throw refuse(404, 'NOT_FOUND', `Nobody here goes by ${to}.`);
      if (amount < SEND.min) throw refuse(400, 'BAD_REQUEST', `Transfers start at ${formatMoney(SEND.min)}.`);
      if (amount >= SEND.confirmAt && !confirm) throw refuse(409, 'NOT_ELIGIBLE', `Confirm sending ${formatMoney(amount)} to ${target}.`);
      const s = state().send;
      if (s.newUntil) throw refuse(409, 'NOT_ELIGIBLE', 'New accounts can send money after their first day: in 4 hours.');
      if (amount > s.sendable) throw refuse(409, 'LIMIT', `You can send ${formatMoney(s.sendable)} now.`);
      const pair = sends.filter((x) => x.to === target && x.at > Date.now() - DAY_MS).reduce((t, x) => t + x.amount, 0);
      if (pair + amount > SEND.pairCap) throw refuse(409, 'LIMIT', `One player can receive ${formatMoney(SEND.pairCap)} from you in any 24 hours; ${formatMoney(Math.max(0, SEND.pairCap - pair))} is left for ${target}.`);
      pay(amount);
      const now = Date.now();
      sends.push({ to: target, amount, at: now });
      add({ at: now, src: 'bank', kind: 'send', cash: -amount, banked: 0, peer: target, note: note.trim() || null, ref: `xfer:7:${++seq}` });
      return state();
    },
    async seen(at) {
      for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i]!.at <= at) inbox.splice(i, 1);
      return { ok: true };
    },
    // the cashier's side (AccountApi's me and takeLoan), against the same balance
    async me() {
      await wait();
      return structuredClone(me());
    },
    async takeLoan() {
      await wait();
      const p = me();
      const chips = p.tables.reduce((t, x) => t + (x.stack ?? x.escrow), 0);
      const s = state();
      const banked = s.savings.balance + openDeposits().reduce((t, d) => t + d.principal, 0) + s.fund.value;
      const add = refillFor(p.balance + chips + banked);
      if (add === 0) throw new ApiError(409, { error: 'NOT_ELIGIBLE', msg: notYet(p.balance + chips + banked, chips, banked), balance: p.balance, inPlay: p.inPlay });
      const at = Date.now();
      const next = { ...p, balance: p.balance + add, loansTaken: p.loansTaken + 1, loans: [{ amount: add, at }, ...p.loans], rev: p.rev + 1 };
      session.set(next);
      return { profile: structuredClone(next), loan: { amount: add, at } };
    },
  };
}
