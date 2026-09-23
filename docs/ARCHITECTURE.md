# Architecture

Casino Simulator is three programs that share one set of game rules:

- a **client** (Three.js + plain DOM) that draws the casino and sends intentions,
- a **Worker** with two kinds of **Durable Object** that deal every card and roll every die,
- a **D1** database that holds accounts, balances, loans, stats and a money ledger.

The rules for every game live once, in `shared/src/games/`, as pure TypeScript with no browser
or Workers APIs. The server runs them, the tests run them millions of times, and the client
imports only their types and constants to know what to draw.

```
 browser (j4den.com/casino/)                       Cloudflare (api.j4den.com/casino/*)
 ┌───────────────────────────────┐  HTTPS  ┌──────────────────────────────────────────────────┐
 │ menu, profile, bank (DOM)     │────────▶│ Worker: login, me, look, loan, tables, join-by-PIN│──┐
 │                               │         │   Origin allowlist, signed tokens, rate limits    │  │
 │ floor (Three.js)              │   WS    │                                                  │  │
 │   you and everyone walking    │◀───────▶│ CasinoFloor "main"                               │  │
 │                               │         │   presence, online count, lobby list, PINs       │  │
 │ table view (Three.js + DOM)   │   WS    │ CasinoTable (one per lobby, one per solo session)│  │
 │   cards, chips, dice, wheel   │◀───────▶│   seats + stacks, game engine, deadlines, outbox │──┤
 └───────────────────────────────┘         └──────────────────────────────────────────────────┘  │
                                              D1 (shared with j4den): casino_accounts, _escrow,  ◀┘
                                              _ledger, _loans, _stats — touched at buy-in,
                                              cash-out and loans only
```

## Repository layout

```
shared/src/        pure TS; imported by server, client and tests; runs anywhere
  protocol.ts      envelope, HTTP + floor + table messages, validators, close codes (frozen)
  money.ts         Cents, chip denominations, table limits, bet steps, formatting
  rng.ts           Rng interface + unbiased int(); seeded generators live in test helpers
  cards.ts         Card codes, Shoe (Fisher-Yates, burn, cut card), hand helpers
  engine.ts        GameEngine interface: the settlement contract every game implements
  look.ts          character appearance type + validator
  names.ts         the username rule, shared by client and server
  games/<game>/    one folder per game: rules, engine, protocol, tests
server/src/        Cloudflare Worker + Durable Objects
  index.ts         gateway: router, CORS, Origin allowlist, tokens, rate limits
  auth.ts  db.ts   tokens (HMAC-SHA256) and D1 access
  transfer.ts      buy-in / cash-out / loan batches and applyTransfer()
  floor/           CasinoFloor: presence.ts, directory.ts
  table/           CasinoTable: host.ts (engine host, outbox, deadlines), party.ts (lobby/leader)
server/migrations/ the D1 schema (published to the site as 014_casino.sql)
client/src/
  net/             sockets with jittered reconnect, typed messages, snapshot interpolation, clock
  world/           floor scene, props, lighting, character, controller, camera, stations
  table/           table-view kit: stage, felt painter + hit regions, cards, chips, dice, tween
  games/<game>/    each game's table model and view
  ui/              menu, profile, character editor, HUD, lobby panels, bet controls, banners
  audio/           sound manager with a persisted mute
scripts/build.mjs  vite build + worker bundle, and --out <site repo> to publish into j4den
```

## Money

All amounts are integer **cents**. Bets are whole dollars. A few craps bets only pay whole
cents in larger steps (place 6/8 in $6 units, lay bets in $2/$3/$6 units, like a real table's
minimums), and the table enforces those steps. Hold'em pots that don't split evenly give the
odd chip to the first winner left of the button. Payouts are otherwise exact: no breakage,
which is what lets the measured house edge match the published one.

### Chips at the table

Money moves the way it does in a real casino: you bring chips to a table and cash them out
when you leave.

- **D1 holds the balance at rest.** `casino_accounts.balance` is spendable money;
  `in_play` is the total an account has taken to tables (one `casino_escrow` row per table).
- **A table holds its seats' stacks while they play.** Every round settles inside the
  table's Durable Object, in the same synchronous storage transaction that records the
  result. No network call sits between a bet and its settlement, so nothing can interleave
  with it and a round never waits on the database.
- **D1 only moves at the edges:** buy-in (balance → chips), top-up, cash-out (chips →
  balance), and the bank. Each edge is one D1 batch: a ledger row plus the balance change.

```sql
-- buy-in: ledger + balance + escrow, one transaction
INSERT INTO casino_ledger (op_id, account_id, kind, amount, table_id, created_at) VALUES (?, ?, 'buyin', -?, ?, ?);
UPDATE casino_accounts SET balance = balance - ?, in_play = in_play + ?, rev = rev + 1 WHERE id = ?;
INSERT INTO casino_escrow (...) VALUES (...) ON CONFLICT (account_id, table_id) DO UPDATE SET amount = amount + excluded.amount;
```

The schema turns every way this could go wrong into an error, and an error rolls back the
whole batch:

| failure | what stops it |
|---|---|
| buying in with more than the balance | `CONSTRAINT balance_nonneg CHECK (balance >= 0)` |
| a retry of a batch that already landed | the ledger's primary key on `op_id` |
| a batch aimed at an account that doesn't exist | foreign keys (D1 enforces them) |
| a fractional amount sneaking into a money column | `CHECK (typeof(x) = 'integer')` |
| cashing out a table with no escrow | `in_play - (SELECT ...)` becomes NULL and fails `NOT NULL` |

`applyTransfer()` treats "this op id is in the ledger" as success, whichever attempt wrote it,
and reads `balance_nonneg` in an error as "insufficient funds". Anything else is unknown and
is retried later with the same op id.

### The table outbox

A buy-in or cash-out is recorded as an intent in the table's own storage first, in the same
transaction that changes the seat (`buying_in` / `cashing_out` seats can't bet). A
single-flight pump then applies it to D1 and records the outcome in a second transaction.
If the object restarts in between, the intent is still there and the pump retries it; the op
id (`<table>:<incarnation>:<seq>`, where the incarnation is a random id written when the
table's storage is first created) makes that retry safe even for a solo table whose name is
reused.

A table cashes out a seat as soon as it can: when the player leaves, when a stack hits zero
with nothing on the layout, and when a disconnected player's grace period runs out. That
keeps `in_play` honest. `/me` and `/bank/loan` also ask any table that has held an escrow for
more than two minutes to reconcile, so a stuck escrow resolves itself instead of blocking a
loan.

### The bank

A loan is one batch that does anything only when the account is truly broke:

```sql
INSERT INTO casino_loans (op_id, account_id, amount, created_at)
  SELECT ?, id, 5000000, ? FROM casino_accounts WHERE id = ? AND balance = 0 AND in_play = 0;
UPDATE casino_accounts SET balance = balance + 5000000, loans_taken = loans_taken + 1, rev = rev + 1
  WHERE id = ? AND balance = 0 AND in_play = 0 AND EXISTS (SELECT 1 FROM casino_loans WHERE op_id = ?);
INSERT INTO casino_ledger (...) SELECT op_id, account_id, 'loan', amount, NULL, created_at FROM casino_loans WHERE op_id = ?;
```

Every statement shares the same guard, so either all three happen or none do, and a double
click can't produce two loans: after the first, the balance is no longer zero.

## Accounts and tokens

Logging in is typing a name. There is no password, on purpose: anyone who types a name gets
that account. It's play money.

`POST /casino/api/login {name}` creates the account if the name is free (names are
case-insensitive through `COLLATE NOCASE`) and returns a signed token
`v1.<payload>.<HMAC-SHA256>` carrying the account id and name. The Worker verifies it with
`crypto.subtle.verify` on every request and WebSocket upgrade, strips any `x-casino-*`
headers the client sent, and forwards the upgrade to the Durable Object with trusted ones.
Durable Objects can only be reached through the Worker, so they never see a token. The token
doesn't protect an account (the name does that, which is to say nothing); it binds a
connection to an account id the server issued and keys the rate limits.

Login and account creation are rate limited per IP with the site's existing atomic D1
counter (`auth_attempts`, migration 013).

The client keeps the token in `sessionStorage`, so two tabs can be two different players, and
remembers the last name in `localStorage` for a one-click "Continue as ...".

## CasinoFloor (one object, "main")

- **Presence.** Clients send their position (integer centimetres, yaw as a byte) at most
  every 100 ms while moving, and one stop message when they stop. The floor keeps positions
  in memory and, as messages arrive, flushes one snapshot of everyone who moved if at least
  66 ms have passed since the last one. There is no timer, so the object only bills handler
  time and hibernates when nobody is moving. Positions are clamped to the floor and
  speed-checked; presence carries no money, so that is all the checking it needs.
- **One connection per account.** A newer tab replaces the older one (close 4001).
- **Online count** is the number of connected accounts.
- **Lobby directory.** Public lobbies per game and private lobbies by PIN, persisted in the
  floor's SQLite so they survive hibernation. It is a hint: tables upsert their summary on
  every change and heartbeat every 60 s, entries older than 150 s are dropped, and the table
  re-checks capacity and PIN when someone actually joins.
- **PINs** are four digits, assigned by the server, held back for 10 minutes before reuse, and
  guessing is limited per account (5/min, 30/h) and per IP (10/min, 60/h).

## CasinoTable (one object per lobby or solo session)

- **Names.** Lobbies get a random id from the floor (`bj-k3x9...`). Solo sessions are named
  `solo:<game>:<account>` by the Worker from the token, so a client can't address anyone
  else's solo table, and reloading the page puts you back at your own table with your hand
  still in front of you.
- **Storage.** `meta` (game, config, incarnation, seq), `state` (one row, rewritten per
  transition), `seats` (account, stack, status, stats since buy-in), `outbox`, `deadlines`.
- **Transitions are synchronous.** Every action runs validate → `engine.act()` → one
  `transactionSync` (state, seats, deadlines) → set the alarm → send each socket its own view.
  The only awaited work is the outbox and floor updates, and they never touch anything a
  transition reads except through seat status. The runtime holds outgoing messages until the
  storage write is durable, so no client ever sees a result that isn't saved.
- **Alarms are the only timers.** Named deadlines (`betting_close`, `turn:<seat>`,
  `grace:<account>`, `idle_cashout:<account>`, `heartbeat`, `outbox_retry`) live in a table,
  and the one alarm is always set to the earliest. After a deploy restarts the object, turn
  deadlines are pushed out by the grace period so a restart doesn't auto-stand the table.
- **Party.** Members are ordered by join time. The creator is the leader. The leader switches
  public/private (private gets a PIN) and presses Start. If the leader leaves, the
  earliest-joined remaining member takes over. Seat limits: blackjack 7, baccarat 7,
  roulette 8, craps 8, Three Card Poker 6, Hold'em 2-9. Slots and video poker are one-player
  machines.
- **Disconnects.** "Connected" is never stored; it's read from the live sockets. A seat is
  held for 2 minutes after a drop and a reconnect gets the full table back. A player whose
  turn times out is stood (or folded in poker games). When the grace period ends with nothing
  live on the layout, the seat is cashed out.
- **Hidden information stays on the server.** Each socket gets its own view: no hole cards,
  no shoe order, no bot cards, no future results in any message.

## The engine contract

Every game implements `GameEngine` from `shared/src/engine.ts`. Engines are pure: given a
state, an action, an `Rng` and `ctx.now`, they return the next state. They never read the
clock, never call `Math.random`, and never touch storage or the network.

```ts
interface GameEngine<S, A, V> {
  id: GameId;
  seats: { min: number; max: number; multiplayer: boolean };
  create(cfg: TableConfig, ctx: EngineCtx): S;
  parseAction(raw: unknown): A | null;                    // untrusted input -> typed action or null
  act(s: S, seat: number, a: A, ctx: EngineCtx): Step<S> | Refusal;
  tick(s: S, ctx: EngineCtx): Step<S> | null;             // due deadlines: close betting, auto-stand, auto-fold
  deadline(s: S): number | null;
  seatJoined(s: S, seat: number, ctx: EngineCtx): Step<S>;
  seatLeaving(s: S, seat: number, ctx: EngineCtx): Step<S>; // resolve what that seat has live
  liveBets(s: S, seat: number): Cents;                    // chips on the layout; cash-out waits for 0
  view(s: S, viewer: number | null): V;                   // only what that viewer may see
}

interface Step<S> {
  state: S;
  events: GameEvent[];          // what to animate; each addressed to everyone or one seat
  chips?: { seat: number; bet?: Cents; payout?: Cents }[];  // stack -= bet, stack += payout
  rounds?: { seat: number; wagered: Cents; returned: Cents }[]; // finished rounds, for stats
}
```

The host applies `chips` to the seats' stacks inside the same transaction as the state and
refuses the step if any stack would go negative, so money invariants are enforced in one
place for every game. `ctx.seats` carries each seat's stack so an engine can refuse a bet the
player can't cover (poker also needs it for all-ins).

**Result first, animation second.** The server decides the outcome, then sends the events
that lead to it: `card` from the shoe, `flip`, the roulette result with its spin time, the
two dice faces, each reel's stop. The client animates toward that known result and then snaps
to the authoritative view that arrived with the events.

## RNG

The server draws 32-bit words from `crypto.getRandomValues` (a 64 KiB buffer, refilled as it
runs out) and maps them to a range with rejection sampling: values at or above
`2^32 - (2^32 mod n)` are thrown away, so every outcome in `[0, n)` is exactly equally likely.
Shoes are shuffled with Fisher-Yates (`for i from n-1 down to 1: swap(i, rng.int(i + 1))`).
Tests inject a seeded generator with the same interface, so a failure reproduces; one
statistical test checks the crypto source itself.

## Tests

- **Rule tables cell by cell.** Every entry of the blackjack strategy chart, the baccarat
  drawing table, the video poker hold list and each paytable has its own unit test: one
  wrong cell moves an edge by less than any Monte Carlo run can see.
- **Every payout,** including the edge cases (player blackjack against dealer blackjack,
  split aces, come-bet odds working or off, pushes and ties, side pots, the odd chip).
- **Exact enumeration** wherever the outcome space is small enough (roulette, craps, baccarat,
  Three Card Poker, the slot reels), checked against the published figure to many digits.
- **Monte Carlo** per game, millions of rounds, asserting the measured edge is within 3
  standard errors of the published one. Seeds are fixed, so the suite is deterministic;
  `MC_RNG=crypto` runs it on the production generator.

## Client

- **Boot** preloads models, card art and sounds behind a loading screen, then shows the menu
  over a slow camera pass through the real casino.
- **Floor**: third-person controller (WASD/arrows), a follow camera that pulls in when a wall
  or table is in the way, circle-vs-box collision on the floor plan, idle/walk blending, name
  tags. Stations (tables, machines, the cashier) show "Press E" within range.
- **Table view** happens in the same scene: the camera flies to the table's play pose and the
  DOM controls fade in. Other players keep walking past behind the table.
- **Remote players** are drawn 200 ms in the past, interpolated between snapshots.
- **Quality**: High (bloom on emissive surfaces, MSAA, pixel ratio up to 2 with an adaptive
  step-down) and Low (no bloom, pixel ratio 1, cheaper materials), suggested from a frame-time
  probe and changeable in Settings.
- **Reconnect** with full-jitter backoff (0.5 s doubling to 30 s). A reconnect to a table
  gets the whole table state, so nothing is replayed.

## Deploys

A deploy restarts every Durable Object and drops every socket. So the casino Worker has its own
workflow (`deploy-casino.yml`, only for `workers/casino/**`), state is written on every
transition, deadlines are extended after a restart, and clients reconnect on their own. The
Worker is bundled in this repo and shipped prebuilt (`no_bundle = true`), so what deploys is
exactly what the tests ran.

## Security

- Origin allowlist on HTTP and WebSocket upgrades (j4den.com, www.j4den.com, localhost).
- Every message is size-capped before parsing and then validated; unknown types and wrong
  shapes are dropped. Token buckets per socket for movement, game actions, lobby actions and
  PIN guesses; repeated abuse closes the socket.
- Table ids are validated by the Worker, and a table that was never initialized answers 404
  without writing anything, so probing can't create storage.
- Names are only ever rendered as text (`textContent`, canvas).
- The page's CSP allows its own scripts, styles, fonts and media, `blob:` for textures inside
  models, and `https://api.j4den.com` plus `wss://api.j4den.com` (browsers don't treat the
  first as covering the second).
