-- Casino Simulator: achievements and challenges (shared/src/feats.ts). Ships in the site repo as
-- database/migrations/018_casino_feats.sql.
--
-- Additive only, like 017: two new tables, nothing else touched. A cash reward is a 'grant' row
-- in casino_ledger whose op_id is "feat:<account>:<feat>", written in the same D1 batch as the
-- casino_feats row and the balance change, so the money identity from 017 still holds:
--
--   SUM(casino_ledger.amount) - SUM(casino_items.price) - SUM(casino_orders.price) = balance.
--
-- A feat is earned once: the primary key refuses a second row, which rolls back its batch (and
-- with it a second payment).
CREATE TABLE IF NOT EXISTS casino_feats (
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    feat        TEXT    NOT NULL,
    at          INTEGER NOT NULL,                              -- unix ms
    PRIMARY KEY (account_id, feat)
) WITHOUT ROWID;

-- Running totals the challenges are measured on ("won": cents won in winning rounds, "wins:bj":
-- blackjack rounds won...). Tables add to them as rounds settle.
CREATE TABLE IF NOT EXISTS casino_tally (
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    key         TEXT    NOT NULL,
    n           INTEGER NOT NULL DEFAULT 0 CHECK (typeof(n) = 'integer'),
    PRIMARY KEY (account_id, key)
) WITHOUT ROWID;
