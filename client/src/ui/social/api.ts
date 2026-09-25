// The social screens' HTTP calls. net/api.ts keeps its request helper to itself, so this
// borrows its token and origin and throws its ApiError, which the screens already know how to
// word (menu/parts.ts problemText).

import type { GameId } from '../../../../shared/src/engine.ts';
import type { HttpError, LeaderboardResponse, StatsResponse } from '../../../../shared/src/protocol.ts';
import { API_ORIGIN, ApiError, savedToken } from '../../net/api.ts';

async function get<T>(path: string): Promise<T> {
  const token = savedToken();
  const res = await fetch(`${API_ORIGIN}/casino/api/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = (await res.json().catch(() => ({ error: 'INTERNAL', msg: 'The casino is not answering.' }))) as T & HttpError;
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

/** The leaderboards as the logged-in player sees them: the casino-wide ones, or one game's. */
export function leaderboard(game: GameId | null = null): Promise<LeaderboardResponse> {
  return get(game ? `leaderboard?game=${encodeURIComponent(game)}` : 'leaderboard');
}

/** v6 stats6: the logged-in player's own record, for the stats sheet. */
export function stats(): Promise<StatsResponse> {
  return get('stats');
}
