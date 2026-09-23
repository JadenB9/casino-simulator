-- Casino Simulator (j4den.com/casino/): accounts, chips on tables, the money ledger, loans and
-- per-game stats. Ships in the site repo as database/migrations/014_casino.sql.
--
-- Additive only. The site's staging environment points at this same database, so this
-- migration creates new casino_* tables and touches nothing that already exists.
--
-- Money is integer cents, and it only moves through D1 at the edges of a table session:
-- buying in, cashing out, and the bank. Rounds themselves settle inside the table's Durable
-- Object. Every edge is one D1 batch (a transaction) of a ledger insert plus the balance
-- change, so the constraints below are load-bearing:
--   * balance_nonneg makes an overdraft an error, which rolls back the whole batch;
--   * the ledger's primary key makes a retried batch an error instead of a second payment;
--   * the foreign keys make a batch against a missing account an error instead of a
--     ledger row with no balance change behind it;
--   * typeof() stops a stray 12.5 from being stored as a float and drifting.
-- Nothing here may ever use INSERT OR IGNORE / ON CONFLICT DO NOTHING on the ledger: a
-- skipped insert with a balance update beside it is exactly the double payment the key exists
-- to prevent.

-- Login is a name and nothing else, on purpose (it's play money): whoever types a name gets
-- that account. NOCASE makes "Ace" and "ace" the same account; names are ASCII-only
-- ([A-Za-z0-9_], 3-16), which is exactly what NOCASE folds.
CREATE TABLE IF NOT EXISTS casino_accounts (
    id          INTEGER PRIMARY KEY,
    name        TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    balance     INTEGER NOT NULL
                CONSTRAINT balance_nonneg CHECK (typeof(balance) = 'integer' AND balance >= 0),
    in_play     INTEGER NOT NULL DEFAULT 0                    -- = SUM(casino_escrow.amount)
                CONSTRAINT in_play_nonneg CHECK (typeof(in_play) = 'integer' AND in_play >= 0),
    rev         INTEGER NOT NULL DEFAULT 0,                   -- bumped on every money change
    loans_taken INTEGER NOT NULL DEFAULT 0,
    look        TEXT    NOT NULL DEFAULT '{}',                -- character appearance (JSON)
    created_at  INTEGER NOT NULL,                             -- unix ms
    last_seen   INTEGER NOT NULL
);

-- Chips an account has taken to a table and not yet cashed out. The table's Durable Object is
-- the only writer of its own rows (single writer), and it knows the live stack; this row is the
-- amount that left the balance, which is what "chips on tables" has to account for.
CREATE TABLE IF NOT EXISTS casino_escrow (
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    table_id    TEXT    NOT NULL,
    amount      INTEGER NOT NULL
                CONSTRAINT escrow_nonneg CHECK (typeof(amount) = 'integer' AND amount >= 0),
    opened_at   INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (account_id, table_id)
) WITHOUT ROWID;

-- Append-only record of every change to a balance. op_id is chosen by the writer and is
-- deterministic for the operation ("<table>:<incarnation>:<seq>" for tables), so a retry of a
-- batch that already landed collides here and rolls back; the caller then looks the op_id up
-- to learn that it landed.
CREATE TABLE IF NOT EXISTS casino_ledger (
    op_id       TEXT    PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    kind        TEXT    NOT NULL CHECK (kind IN ('grant', 'buyin', 'cashout', 'refund', 'loan')),
    amount      INTEGER NOT NULL CHECK (typeof(amount) = 'integer'),  -- signed, as seen by balance
    table_id    TEXT,
    created_at  INTEGER NOT NULL
) WITHOUT ROWID;

-- Every loan the bank has made. Free, no interest, never repaid; only granted at $0 with nothing
-- on any table, which the loan batch checks inside the same transaction.
CREATE TABLE IF NOT EXISTS casino_loans (
    op_id       TEXT    PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    amount      INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
    created_at  INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_casino_loans_account ON casino_loans(account_id, created_at);

-- One row per account per game, folded in when a seat cashes out.
CREATE TABLE IF NOT EXISTS casino_stats (
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    game        TEXT    NOT NULL,
    rounds      INTEGER NOT NULL DEFAULT 0,
    wagered     INTEGER NOT NULL DEFAULT 0,
    net         INTEGER NOT NULL DEFAULT 0,
    biggest_win INTEGER NOT NULL DEFAULT 0,                   -- largest single-round profit
    PRIMARY KEY (account_id, game)
) WITHOUT ROWID;

-- Attempt counters for login and account creation, per client IP. One statement reads,
-- increments and resets the window, so a burst of requests counts as a burst.
CREATE TABLE IF NOT EXISTS casino_rate (
    k           TEXT    PRIMARY KEY,                          -- "<gate>:<ip>"
    n           INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL                              -- unix ms; the row is reset, not deleted
) WITHOUT ROWID;
