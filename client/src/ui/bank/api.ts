// The bank's HTTP calls (server/src/bank.ts). net/api.ts keeps its request helper to itself, so
// this borrows its token and origin and throws its ApiError, which the screens already know how
// to word (menu/parts.ts problemText). Every change answers with the bank as it now stands.

import type { HttpError } from '../../../../shared/src/protocol.ts';
import type { BankResponse, BankState, MarketResponse, StatementResponse, TermId } from '../../../../shared/src/bank.ts';
import { API_ORIGIN, ApiError, savedToken } from '../../net/api.ts';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = savedToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_ORIGIN}/casino/api/${path}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({ error: 'INTERNAL', msg: 'The bank is not answering.' }))) as T & HttpError;
  if (!res.ok) throw new ApiError(res.status, out);
  return out;
}

const state = async (path: string, body: unknown): Promise<BankState> => (await call<BankResponse>(path, body)).state;

/** A fresh operation id: retrying with the same one is the same operation, done once. */
export function newOp(): string {
  return crypto.randomUUID();
}

export const bank = (): Promise<BankState> => call<BankState>('bank');
export const market = (range: '1d' | '7d' | '30d'): Promise<MarketResponse> => call<MarketResponse>(`bank/market?range=${range}`);
export const statement = (before?: string | null): Promise<StatementResponse> =>
  call<StatementResponse>(`bank/statement${before ? `?before=${encodeURIComponent(before)}` : ''}`);

export const savings = (dir: 'in' | 'out', amount: number, op = newOp()): Promise<BankState> => state('bank/savings', { op, dir, amount });
export const deposit = (term: TermId, amount: number, op = newOp()): Promise<BankState> => state('bank/deposit', { op, term, amount });
export const closeDeposit = (id: string, op = newOp()): Promise<BankState> => state('bank/deposit/close', { op, id });
export const buy = (amount: number, op = newOp()): Promise<BankState> => state('bank/fund', { op, side: 'buy', amount });
export const sell = (amount: number | 'all', op = newOp()): Promise<BankState> =>
  state('bank/fund', amount === 'all' ? { op, side: 'sell', all: true } : { op, side: 'sell', amount });
export const send = (to: string, amount: number, note: string, confirm: boolean, op = newOp()): Promise<BankState> =>
  state('bank/send', { op, to, amount, note, confirm });
/** Transfers received up to `at` have been seen. */
export const seen = (at: number): Promise<{ ok: true }> => call<{ ok: true }>('bank/seen', { at });

export type BankApi = {
  bank: typeof bank;
  market: typeof market;
  statement: typeof statement;
  savings: typeof savings;
  deposit: typeof deposit;
  closeDeposit: typeof closeDeposit;
  buy: typeof buy;
  sell: typeof sell;
  send: typeof send;
  seen: typeof seen;
};
