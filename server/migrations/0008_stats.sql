-- Casino Simulator v6 leaderboards and stats sheet (server/src/leaderboard.ts, server/src/stats.ts).
-- Ships in the site repo as database/migrations/021_casino_stats.sql (after law's 019 and the
-- bank's 020).
--
-- Additive only: four new indexes and one backfilled tally row per account with feats, no table
-- changes. Each index costs one extra entry written when a column it reads is written: the tally
-- index on each tally flush (every couple of minutes per player at a table, never per round), the
-- three stats indexes on each cash-out that folds in stats.

-- Every board read from casino_tally: one key's rows, largest first ("won", "lost", "worst",
-- "streak", "feats", "won:blackjack", "d:2026-09-25:net"...). casino_tally is WITHOUT ROWID, so
-- each entry also carries account_id: a top ten reads ten entries, "how many are ahead of you" is
-- a count over the entries above you, and neither touches the table. Also serves the range reads
-- of the celebrity rows (celeb:<id>) and the clearing of old day and week rows.
CREATE INDEX IF NOT EXISTS idx_casino_tally_key_n ON casino_tally (key, n DESC);

-- One game's boards: top earners and biggest losers (net, read in both directions), biggest single
-- win and most rounds, each a ten-entry read of its game's slice of the index.
CREATE INDEX IF NOT EXISTS idx_casino_stats_game_net ON casino_stats (game, net DESC);
CREATE INDEX IF NOT EXISTS idx_casino_stats_game_win ON casino_stats (game, biggest_win DESC);
CREATE INDEX IF NOT EXISTS idx_casino_stats_game_rounds ON casino_stats (game, rounds DESC);

-- The "most achievements" board counts feats in a tally row that each feat's payment adds to
-- (server/src/feats.ts unlockStatements). Feats earned before that row existed are counted here
-- once; on a database where they already are, this sets the same number again.
INSERT INTO casino_tally (account_id, key, n)
SELECT account_id, 'feats', COUNT(*) FROM casino_feats WHERE true GROUP BY account_id
ON CONFLICT (account_id, key) DO UPDATE SET n = excluded.n;
