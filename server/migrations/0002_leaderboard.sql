-- Casino Simulator leaderboards (GET /casino/api/leaderboard). Ships in the site repo as
-- database/migrations/015_casino_leaderboard.sql.
--
-- Additive only: two new indexes, no table changes, nothing else touched. The site's staging
-- environment points at this same database.
--
-- Each index costs one extra row written when a column it reads is written: the worth index when
-- an account is created and on each buy-in, top-up, cash-out or loan (not on a login, which only
-- sets last_seen), the win index on each cash-out that folds in stats. Rounds themselves never
-- write to D1.

-- Richest: balance plus chips on tables, best first. The query must spell the expression the
-- same way (balance + in_play) for SQLite to use this index. It serves the top ten in ten
-- steps and counts the players ahead of you without reading the table.
CREATE INDEX IF NOT EXISTS idx_casino_accounts_worth ON casino_accounts ((balance + in_play) DESC);

-- Biggest single win: rows by biggest_win, best first. casino_stats is WITHOUT ROWID, so each
-- entry also carries the primary key (account_id, game): the top ten read a bounded prefix of
-- this index, and "how many players won more than you" never touches the table.
CREATE INDEX IF NOT EXISTS idx_casino_stats_biggest_win ON casino_stats (biggest_win DESC);
