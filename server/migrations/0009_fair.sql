-- Casino Simulator: fair play (shared/src/fair.ts, server/src/fair.ts). Ships in the site repo as
-- the next free database/migrations number.
--
-- Additive only: two new tables, nothing else touched. No money moves through either: a pause
-- only stops new bets and buy-ins, and cash-outs go through casino_escrow and casino_ledger as
-- always, so the money identity is unchanged.
--
-- casino_fair: one row per account that has played since this shipped. `ev` is the evidence
-- (reaction times, bet signatures, walked stops, activity spans) as JSON; `score` the last
-- verdict. `state` is 'ok', 'due' (the next natural pause asks the check) or 'paused' (asked;
-- no new bets until it's passed). `clear_until` is when a passed check may be asked again;
-- `fails` the misses in a row and `retry_at` when the next try may start.
CREATE TABLE IF NOT EXISTS casino_fair (
    account_id  INTEGER PRIMARY KEY REFERENCES casino_accounts(id),
    ev          TEXT    NOT NULL DEFAULT '{}',
    score       REAL    NOT NULL DEFAULT 0,
    state       TEXT    NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'due', 'paused')),
    clear_until INTEGER NOT NULL DEFAULT 0,
    fails       INTEGER NOT NULL DEFAULT 0,
    retry_at    INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL
);

-- One row per check handed out: its answer stays here (the client only ever gets a picture or a
-- Turnstile widget), it expires, and it can be answered once.
CREATE TABLE IF NOT EXISTS casino_checks (
    id          TEXT    PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    kind        TEXT    NOT NULL CHECK (kind IN ('chip', 'turnstile')),
    answer      TEXT    NOT NULL,
    issued_at   INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS casino_checks_account ON casino_checks (account_id, issued_at);
