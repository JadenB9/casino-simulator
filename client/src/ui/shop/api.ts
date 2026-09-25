// The boutique's and the bar's HTTP calls. net/api.ts keeps its request helper to itself, so this
// borrows its token and origin and throws its ApiError, which the screens already know how to
// word (menu/parts.ts problemText).

import type { HttpError } from '../../../../shared/src/protocol.ts';
import type { BuyResponse, EffectResponse, OrderResponse, ShopResponse } from '../../../../shared/src/items.ts';
import { API_ORIGIN, ApiError, savedToken } from '../../net/api.ts';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = savedToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_ORIGIN}/casino/api/${path}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({ error: 'INTERNAL', msg: 'The casino is not answering.' }))) as T & HttpError;
  if (!res.ok) throw new ApiError(res.status, out);
  return out;
}

/** The boutique's catalog, what you own and your balance. */
export const shop = (): Promise<ShopResponse> => call<ShopResponse>('shop');

/** Buy one item from your balance. Retrying with the same op is the same purchase. */
export const buy = (item: string, op: string): Promise<BuyResponse> => call<BuyResponse>('shop/buy', { item, op });

/** Play an effect where you stand: paid each time. Retrying with the same op is the same effect, charged once. */
export const fx = (item: string, op: string): Promise<EffectResponse> => call<EffectResponse>('shop/fx', { item, op });

/** Order from the bar; it's paid now and brought to you. Retrying with the same op is the same order. */
export const order = (item: string, op: string): Promise<OrderResponse> => call<OrderResponse>('bar/order', { item, op });

/** A fresh operation id for a purchase (what makes a retried request the same purchase). */
export function newOp(): string {
  return crypto.randomUUID();
}
