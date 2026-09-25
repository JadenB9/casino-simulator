// The feats sheet's one HTTP call (GET /feats). Like the social screens', it borrows net/api.ts's
// token and origin and throws its ApiError, which menu/parts.ts problemText knows how to word.

import type { HttpError } from '../../../../shared/src/protocol.ts';
import type { FeatsResponse } from '../../../../shared/src/feats.ts';
import { API_ORIGIN, ApiError, savedToken } from '../../net/api.ts';

/** What you've earned and how far along each tally is, as D1 has it. */
export async function feats(): Promise<FeatsResponse> {
  const token = savedToken();
  const res = await fetch(`${API_ORIGIN}/casino/api/feats`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = (await res.json().catch(() => ({ error: 'INTERNAL', msg: 'The casino is not answering.' }))) as FeatsResponse & HttpError;
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}
