// The valet's HTTP calls: buying a car goes through the boutique's POST /shop/buy (a car is kept
// like any other purchase); bringing one round is POST /shop/valet.

import type { HttpError } from '../../../../shared/src/protocol.ts';
import type { CarCallResponse } from '../../../../shared/src/valet.ts';
import { API_ORIGIN, ApiError, savedToken } from '../../net/api.ts';

async function post<T>(path: string, body: unknown): Promise<T> {
  const token = savedToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_ORIGIN}/casino/api/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const out = (await res.json().catch(() => ({ error: 'INTERNAL', msg: 'The casino is not answering.' }))) as T & HttpError;
  if (!res.ok) throw new ApiError(res.status, out);
  return out;
}

/** Bring a car you own round to the curb (you have to be at the stand), or send yours back (null). */
export const valet = (car: string | null): Promise<CarCallResponse> => post<CarCallResponse>('shop/valet', { car });
