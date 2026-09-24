-- Casino Simulator: the boutique and the bar. Ships in the site repo as
-- database/migrations/017_casino_items.sql.
--
-- Additive only: two new tables and nothing else touched. The site's staging environment points
-- at this same database, and a live Worker writes the ledger while this runs, so no existing
-- table is rebuilt (the ledger's kind list can't grow without a rebuild). Instead each new table
-- is the money record for its own spending, written in the same D1 batch as the balance change:
--
--   SUM(casino_ledger.amount) - SUM(casino_items.price) - SUM(casino_orders.price)
--     = balance + in_play, per account.
--
-- The same guards as the ledger make a mistake an error that rolls the whole batch back:
-- balance_nonneg on the account refuses an overdraft, the primary keys refuse a second payment
-- for the same purchase, the foreign keys refuse a row with no account behind it, and typeof()
-- keeps prices integer cents.

-- Shop items are bought once and kept for good: one row per account per item, so buying what you
-- already own collides here and rolls back. op_id is the purchase's operation id, kept so a
-- retry of that same purchase can be told apart from a second attempt to buy it.
CREATE TABLE IF NOT EXISTS casino_items (
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    item        TEXT    NOT NULL,
    price       INTEGER NOT NULL CHECK (typeof(price) = 'integer' AND price > 0),
    bought_at   INTEGER NOT NULL,                              -- unix ms
    op_id       TEXT    NOT NULL,
    PRIMARY KEY (account_id, item)
) WITHOUT ROWID;

-- Bar orders are bought as often as you like. op_id is "bar:<account>:<the client's op>", so a
-- retried order collides on the key and one account's op can never answer for another's.
CREATE TABLE IF NOT EXISTS casino_orders (
    op_id       TEXT    PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    item        TEXT    NOT NULL,
    price       INTEGER NOT NULL CHECK (typeof(price) = 'integer' AND price > 0),
    created_at  INTEGER NOT NULL                               -- unix ms
) WITHOUT ROWID;
