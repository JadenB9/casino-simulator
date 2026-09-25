-- Casino Simulator: the bank (shared/src/bank.ts, server/src/bank.ts): savings, term deposits,
-- the Casino Index fund and transfers between players. Ships in the site repo as
-- database/migrations/020_casino_bank.sql.
--
-- Additive only: one new column on casino_accounts, new tables, new indexes. The site's staging
-- environment points at this same database and a live Worker writes the ledger while this runs,
-- so nothing that exists is rebuilt (the ledger's kind list can't grow without a rebuild). As in
-- 017, the bank keeps its own money record, casino_bank, written in the same D1 batch as every
-- balance it moves.
--
-- THE MONEY IDENTITY. For every account a (every SUM over rows of that account):
--
--   (1) balance    = SUM(casino_ledger.amount) - SUM(casino_items.price) - SUM(casino_orders.price)
--                    + SUM(casino_bank.cash)
--   (2) in_play    = SUM(casino_escrow.amount)                                  (unchanged)
--   (3) casino_savings.balance            = SUM(casino_bank.saved)
--   (4) SUM(open casino_deposits.principal) = SUM(casino_bank.locked)            (open: closed_at IS NULL)
--   (5) casino_holdings.units             = SUM(casino_bank.units)
--       casino_holdings.cost              = SUM(casino_bank.cost)
--   (6) banked     = casino_savings.balance + SUM(open principal) + casino_holdings.cost
--   (7) every casino_bank row balances:  cash + saved + locked + cost = gain    (a CHECK below)
--
-- so, summing (1), (3)-(6) with (7):
--
--   balance + banked = SUM(ledger.amount) - SUM(items.price) - SUM(orders.price) + SUM(bank.gain)
--
-- and a player's money in all is balance + in_play + banked, the fund counted at what it cost.
-- `gain` is the only column that makes or destroys money, and only these rows carry it:
-- 'interest' (savings interest paid, > 0), 'unlock' (a deposit's fixed interest at maturity, > 0,
-- or the fee for breaking it early, < 0), 'sell' (the fund's realized gain or loss: proceeds less
-- the cost of the units sold), and 'send'/'receive', which always come in pairs whose gains cancel:
-- across all accounts, SUM(gain) over 'send' and 'receive' rows = 0.
--
-- Guards, as in 014/017: typeof() keeps every amount integer cents, the non-negative checks make
-- an overdraft (of the balance, savings, a holding or banked) an error that rolls the whole batch
-- back, primary keys make a retried operation collide instead of landing twice, foreign keys
-- refuse a row with no account behind it. Nothing here uses INSERT OR IGNORE on a money table.

-- What the account has in the bank, kept beside balance and in_play so "richest" can rank on
-- balance + in_play + banked with an index (below). Always (6); changed only in the same batch as
-- the casino_bank row that moves it.
ALTER TABLE casino_accounts ADD COLUMN banked INTEGER NOT NULL DEFAULT 0
    CONSTRAINT banked_nonneg CHECK (typeof(banked) = 'integer' AND banked >= 0);

-- The bank's journal: one row per money movement it makes, per account. op_id is the operation's
-- key ("bank:<account>:<client op>", "int:<account>:<day>" for a day's savings interest,
-- "xfer:<sender>:<client op>:out" and ":in" for the two sides of a transfer), so a retry
-- collides here. Columns are signed changes as seen by each place money sits:
--   cash    the balance (checking)            saved   savings
--   locked  term deposits' principal          cost    the fund, at what its units cost
--   units   the fund's units (millionths)     gain    money made (+) or gone (-) by this row
CREATE TABLE IF NOT EXISTS casino_bank (
    op_id       TEXT    PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    kind        TEXT    NOT NULL CHECK (kind IN ('save', 'unsave', 'interest', 'lock', 'unlock', 'buy', 'sell', 'send', 'receive')),
    cash        INTEGER NOT NULL DEFAULT 0 CHECK (typeof(cash) = 'integer'),
    saved       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(saved) = 'integer'),
    locked      INTEGER NOT NULL DEFAULT 0 CHECK (typeof(locked) = 'integer'),
    cost        INTEGER NOT NULL DEFAULT 0 CHECK (typeof(cost) = 'integer'),
    units       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(units) = 'integer'),
    gain        INTEGER NOT NULL DEFAULT 0 CHECK (typeof(gain) = 'integer'),
    peer        INTEGER REFERENCES casino_accounts(id),         -- the other player of a transfer
    ref         TEXT,                                           -- deposit id, transfer id, fund price, interest day
    at          INTEGER NOT NULL,                               -- unix ms
    CONSTRAINT bank_balanced CHECK (cash + saved + locked + cost = gain)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_casino_bank_account ON casino_bank (account_id, at);

-- Savings, one row per account. Interest is simple within a day and paid at each midnight UTC
-- (shared/src/bank.ts accrue): `accrued` whole cents and `frac` (the rest, in 1/INTEREST_DEN of a
-- cent) are what has been earned since the last midnight up to `since` and isn't paid yet, so it
-- isn't money yet and isn't in (3). A payment is an 'interest' row keyed by its day. Any change
-- first brings the row up to now, guarded on `since`, so two requests can't both count one span.
CREATE TABLE IF NOT EXISTS casino_savings (
    account_id  INTEGER PRIMARY KEY REFERENCES casino_accounts(id),
    balance     INTEGER NOT NULL DEFAULT 0
                CONSTRAINT savings_nonneg CHECK (typeof(balance) = 'integer' AND balance >= 0),
    accrued     INTEGER NOT NULL DEFAULT 0 CHECK (typeof(accrued) = 'integer' AND accrued >= 0),
    frac        INTEGER NOT NULL DEFAULT 0 CHECK (typeof(frac) = 'integer' AND frac >= 0),
    since       INTEGER NOT NULL,                               -- unix ms, interest counted to here
    earned      INTEGER NOT NULL DEFAULT 0 CHECK (typeof(earned) = 'integer' AND earned >= 0)
);

-- Term deposits: principal locked for a term at a rate fixed when opened; `interest` is what it
-- pays at maturity. Closing early pays the principal less a fee and no interest. op_id is the
-- opening operation ("dep:<account>:<client op>"); close_op the closing one.
CREATE TABLE IF NOT EXISTS casino_deposits (
    op_id       TEXT    PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    term        TEXT    NOT NULL CHECK (term IN ('1h', '24h', '7d')),
    principal   INTEGER NOT NULL CHECK (typeof(principal) = 'integer' AND principal > 0),
    interest    INTEGER NOT NULL CHECK (typeof(interest) = 'integer' AND interest >= 0),
    opened_at   INTEGER NOT NULL,
    matures_at  INTEGER NOT NULL,
    closed_at   INTEGER,
    close_op    TEXT,
    paid        INTEGER CHECK (paid IS NULL OR (typeof(paid) = 'integer' AND paid >= 0))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_casino_deposits_account ON casino_deposits (account_id, closed_at);

-- Fund holdings: units in millionths of a unit and what they cost in cents. Selling takes cost
-- off in proportion (all of it when the last unit goes).
CREATE TABLE IF NOT EXISTS casino_holdings (
    account_id  INTEGER NOT NULL REFERENCES casino_accounts(id),
    fund        TEXT    NOT NULL,
    units       INTEGER NOT NULL CHECK (typeof(units) = 'integer' AND units >= 0),
    cost        INTEGER NOT NULL CHECK (typeof(cost) = 'integer' AND cost >= 0),
    PRIMARY KEY (account_id, fund)
) WITHOUT ROWID;

-- The fund's price, one row per five-minute step (step = unix ms / 300000), in ten-thousandths
-- of a dollar. Written by the Worker up to the current step only, never ahead: each step's move
-- comes from an HMAC under a server secret, so nobody can work out the next one. Not money:
-- a step is the same whoever writes it, so a race writing it twice is harmless.
CREATE TABLE IF NOT EXISTS casino_market (
    fund        TEXT    NOT NULL,
    step        INTEGER NOT NULL,
    price       INTEGER NOT NULL CHECK (typeof(price) = 'integer' AND price > 0),
    PRIMARY KEY (fund, step)
) WITHOUT ROWID;

-- Money sent from one player to another: one row per transfer ("xfer:<sender>:<client op>"),
-- beside its two casino_bank rows. The limits (shared/src/bank.ts SEND) are read from here.
CREATE TABLE IF NOT EXISTS casino_transfers (
    op_id       TEXT    PRIMARY KEY,
    from_id     INTEGER NOT NULL REFERENCES casino_accounts(id),
    to_id       INTEGER NOT NULL REFERENCES casino_accounts(id),
    amount      INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
    note        TEXT,
    at          INTEGER NOT NULL,
    CHECK (from_id <> to_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_casino_transfers_from ON casino_transfers (from_id, at);
CREATE INDEX IF NOT EXISTS idx_casino_transfers_to ON casino_transfers (to_id, at);

-- The statement and the transfer rules read an account's ledger rows and orders by time. Each
-- index costs one extra row written per ledger row and per order.
CREATE INDEX IF NOT EXISTS idx_casino_ledger_account ON casino_ledger (account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_casino_orders_account ON casino_orders (account_id, created_at);

-- Richest by net worth: balance, chips on tables and the bank, best first. A query must spell the
-- expression exactly this way to use it.
CREATE INDEX IF NOT EXISTS idx_casino_accounts_networth ON casino_accounts ((balance + in_play + banked) DESC);
