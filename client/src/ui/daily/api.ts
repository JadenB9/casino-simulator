// The daily bonus's two calls (server/src/daily.ts): where your streak stands, and today's claim.

import { API_ORIGIN, ApiError, savedToken } from '../../net/api.ts';
import type { HttpError } from '../../../../shared/src/protocol.ts';
import type { DailyClaimResponse, DailyStatus } from '../../../../shared/src/celebs.ts';

async function call<T>(path: string, method: 'GET' | 'POST'): Promise<T> {
  const token = savedToken();
  const res = await fetch(`${API_ORIGIN}/casino/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  const body = (await res.json().catch(() => ({ error: 'INTERNAL', msg: 'The casino is not answering.' }))) as T & HttpError;
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

export interface DailyApi {
  status(): Promise<DailyStatus>;
  claim(): Promise<DailyClaimResponse>;
}

export const dailyApi: DailyApi = {
  status: () => call<DailyStatus>('daily', 'GET'),
  claim: () => call<DailyClaimResponse>('daily/claim', 'POST'),
};
