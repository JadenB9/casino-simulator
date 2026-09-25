-- Casino Simulator: jail (shared/src/law/rules.ts). Ships in the site repo as
-- database/migrations/019_casino_law.sql.
--
-- Additive only: one new table and its indexes, nothing else touched. No money moves through
-- it. Jail tables are ordinary solo tables whose buy-ins and cash-outs go through casino_escrow
-- and casino_ledger as always, so the money identity is unchanged:
--
--   SUM(casino_ledger.amount) - SUM(casino_items.price) - SUM(casino_orders.price) = balance.
--
-- A stay in jail is a row: open while released_at is NULL. At most one open row per account:
-- the partial unique index refuses a second (the floor locks someone up with INSERT OR IGNORE,
-- so a repeat is a no-op). `won` is the progress toward `bail`: jail-table winnings, never below
-- zero. Rows are kept after release as the record.
CREATE TABLE IF NOT EXISTS casino_jail (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    at          INTEGER NOT NULL,                              -- unix ms, locked up
    bail        INTEGER NOT NULL CHECK (typeof(bail) = 'integer' AND bail > 0),
    won         INTEGER NOT NULL DEFAULT 0 CHECK (typeof(won) = 'integer' AND won >= 0),
    why         TEXT    NOT NULL CHECK (why IN ('punch', 'win')),
    released_at INTEGER                                        -- unix ms, NULL while inside
);

CREATE UNIQUE INDEX IF NOT EXISTS casino_jail_open ON casino_jail (account_id) WHERE released_at IS NULL;
