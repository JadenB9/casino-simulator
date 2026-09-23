// The social screens' one HTTP call. net/api.ts keeps its request helper to itself, so this
// borrows its token and origin and throws its ApiError, which the screens already know how to
// word (menu/parts.ts problemText).

import type { HttpError, LeaderboardResponse } from '../../../../shared/src/protocol.ts';
import { API_ORIGIN, ApiError, savedToken } from '../../net/api.ts';

/** The three leaderboards as the logged-in player sees them. */
export async function leaderboard(): Promise<LeaderboardResponse> {
  const token = savedToken();
  const res = await fetch(`${API_ORIGIN}/casino/api/leaderboard`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = (await res.json().catch(() => ({ error: 'INTERNAL', msg: 'The casino is not answering.' }))) as LeaderboardResponse & HttpError;
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}
