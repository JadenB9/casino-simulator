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
  password.ts      the password rule (4-64 characters), shared the same way
  bank.ts          the bank's top-up rule (under $10,000 in all, back up to $50,000)
  games/<game>/    one folder per game: rules, engine, protocol, tests
server/src/        Cloudflare Worker + Durable Objects
  index.ts         gateway: router, CORS, Origin allowlist, tokens, rate limits
  auth.ts  db.ts   passwords (PBKDF2), the login decision, tokens (HMAC-SHA256); D1 access
  transfer.ts      buy-in / cash-out / top-up (loan) batches and applyTransfer()
  floor/           CasinoFloor: presence.ts, directory.ts
  table/           CasinoTable: host.ts (engine host, outbox, deadlines), party.ts (lobby/leader)
server/migrations/ the D1 schema (0001 published to the site as 014_casino.sql, 000N as 0(13+N)_casino_*)
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
keeps `in_play` honest. `/me` also asks any table that has held an escrow for more than two
minutes to reconcile, so a stuck escrow resolves itself, and `/bank/loan` asks every table
holding one (below).

### The bank

Under $10,000 in all, the cashier tops a player up to $50,000, as often as that happens. "In all"
is the balance plus every chip on every table: the gateway asks each table holding one of the
player's escrows to reconcile, and each seat reports its stack and the bets it has out (chips
on the felt still count, so putting them down for a moment can't earn a top-up). While chips
are moving between a table and D1 (a buy-in, top-up or cash-out in flight), or a table doesn't
answer, the bank answers `409 BUSY` instead of counting. Otherwise one batch decides and pays:

```sql
INSERT INTO casino_loans (op_id, account_id, amount, created_at)
  SELECT ?, id, 5000000 - (balance + :chips), ? FROM casino_accounts
   WHERE id = ? AND in_play = :in_play AND balance + :chips < 1000000
  RETURNING amount;
UPDATE casino_accounts SET balance = balance + (SELECT amount FROM casino_loans WHERE op_id = ?),
       loans_taken = loans_taken + 1, rev = rev + 1
 WHERE id = ? AND EXISTS (SELECT 1 FROM casino_loans WHERE op_id = ?)
   AND NOT EXISTS (SELECT 1 FROM casino_ledger WHERE op_id = ?);
INSERT INTO casino_ledger (...) SELECT op_id, account_id, 'loan', amount, NULL, created_at FROM casino_loans
 WHERE op_id = ? AND NOT EXISTS (SELECT 1 FROM casino_ledger WHERE op_id = ?);
```

The balance is read inside the transaction; `:chips` is what the tables just reported, and
`:in_play` pins what D1 held on tables when they were asked, so a buy-in or cash-out landing in
between turns the batch into a no-op (and the answer into `BUSY`) rather than a loan worked out
from stale numbers. The amount is exactly the gap to $50,000. The second and third statements
only follow a loan row with no ledger row yet, so all three happen or none do; a double click
finds the player at $50,000, and the same op id twice is one loan.

### The boutique and the bar

A purchase moves money out of the balance for good, so it is written like the other edges (one
batch: a row that records it and the balance change) but not into the ledger: its kinds are
fixed and the database is only ever added to. Each purchase has a table of its own, and that
row is the money record:

```sql
-- a shop item: owning is one row per account per item, so a second purchase collides
INSERT INTO casino_items (account_id, item, price, bought_at, op_id) VALUES (?, ?, ?, ?, 'shop:' || ? || ':' || ?);
UPDATE casino_accounts SET balance = balance - ?, rev = rev + 1 WHERE id = ? RETURNING balance, in_play, rev;
-- a bar order: one row per order, keyed by the account and the client's op
INSERT INTO casino_orders (op_id, account_id, item, price, created_at) VALUES ('bar:' || ? || ':' || ?, ?, ?, ?, ?);
UPDATE casino_accounts SET balance = balance - ?, rev = rev + 1 WHERE id = ? RETURNING balance, in_play, rev;
```

`balance_nonneg` refuses what the balance can't pay; the keys refuse a second charge, and after a
failed batch the row decides what happened (this op's row: it landed, answer with it; another
op's item row: you own it already). Every cent is accounted for as
`SUM(ledger) - SUM(items.price) - SUM(orders.price) = balance` per account (and so `= balance +
in_play` once nothing is on a table). Owned items are worn through the look, which the gateway
checks against `casino_items` before storing it; a held bar order is checked against
`casino_orders`.

## Accounts and tokens

Logging in is a name and a password. Names are first come, first served and case-insensitive
(`COLLATE NOCASE`): a new name is created with the password it arrives with, a name that has
a password needs it, and an account from before passwords (migration 0003) takes the first
password it is given, which claims it from then on.

`POST /casino/api/login {name, password}` does that and returns a signed token
`v2.<payload>.<HMAC-SHA256>` carrying the account id and name. The Worker verifies it with
`crypto.subtle.verify` on every HTTP request. v1 tokens came from the name-only login and are
refused, so every session logs in once with a password.

Sockets never carry the token (URLs end up in logs). Right before each connection attempt the
client trades it for a socket ticket (`POST /casino/api/ticket {target}`, `server/src/tickets.ts`):
`k1.<payload>.<HMAC-SHA256>`, signed apart from tokens so neither passes for the other, naming the
account and the one path it opens (`floor`, `table/<id>`, `solo/<game>`), good for a minute and
for one socket. The Worker checks the signature, the time and the path, strips any `x-casino-*`
headers the client sent, and forwards the upgrade to the Durable Object with trusted ones,
the ticket's id among them; the object spends that id in its own SQLite (a restart doesn't forget
it), so a ticket opens one socket once. A late, used or misdirected ticket closes with 4006 and the
client gets another; a page from before tickets (sending its token) is told to reload (4009).
Durable Objects can only be reached through the Worker, so they never see a token.

Passwords (4-64 characters, NFC-normalized) are hashed with PBKDF2-HMAC-SHA256 through
WebCrypto: a random 16-byte salt per account and 100,000 iterations (the Workers cap), stored
as `pbkdf2:<iterations>:<hex>` beside the salt in `pass_hash` / `pass_salt`, and compared with
`crypto.subtle.timingSafeEqual`. Nothing logs a password and no hash leaves the Worker. A
wrong password gets one answer whatever the account (`401 Wrong name or password.`).

Every login attempt counts against 30 a minute per address, and a new account against 10 an
hour per address (the `casino_rate` counter, one atomic statement per bump). Wrong passwords
count against 20 per 15 minutes per address and 60 per 15 minutes per name; past either, logins from
that address or to that name get `429` without any password work until the window ends. A
name takes more misses than one address can send, so nobody can lock a player out from a
single connection. "Per address" means per IP, and per /64 for IPv6, where one user can take a
fresh address from their /64 for every request.

The client keeps the token in `sessionStorage`, so two tabs can be two different players, and
remembers the last name (never the password) in `localStorage`: "Continue as ..." fills in the
name and asks only for its password.

## CasinoFloor (one object, "main")

- **Presence.** Every position is an event the one floor object must handle, so clients send
  one only when the others need it (`client/src/net/send-policy.ts`): at most every 200 ms while
  moving, every 320 ms on a steady straight line (everyone else draws the line between two
  positions), never for a change too small to see, and one stop message when they stop. The
  floor keeps positions in memory and, as messages arrive, flushes one snapshot of everyone who
  moved if at least 100 ms have passed since the last one; a row that arrives sooner (a stop too)
  goes out when the 100 ms are up, on a short timer that only runs while someone moves, so the
  object still hibernates when nobody walks. Each row carries its age, so clients place it when
  it arrived, and draw other players 300 ms back. At 150 walkers that is about 420 messages a
  second in (1,013 before this scheme) and 718 if everyone zig-zags nonstop (1,192), under the
  object's roughly 1,000 a second (`scripts/load/floor.mjs` measures it). Positions are clamped to
  the floor and speed-checked; presence carries no money, so that is all the checking it needs.
- **One connection per account.** A newer tab replaces the older one (close 4001).
- **Idle sockets.** A socket nothing real has come from for 15 minutes (`IDLE_MS`) is closed with
  4010. A real thing is a move or turn that changes the pose, chat, an emote, a lobby watch, or the
  page's `here`. The time is kept in the socket's attachment, and the object's one alarm sweeps
  for them, at most every 30 s, only while someone is connected. The page normally goes first
  (see Client).
- **Online count** is the number of connected accounts.
- **Lobby directory.** Public lobbies per game and private lobbies by PIN, persisted in the
  floor's SQLite so they survive hibernation. It is a hint: tables upsert their summary on
  every change and heartbeat every 60 s, entries older than 150 s are dropped, and the table
  re-checks capacity and PIN when someone actually joins.
- **PINs** are four digits, assigned by the server, held back for 10 minutes before reuse, and
  guessing is limited per account (5/min, 30/h) and per address (10/min, 60/h, per /64 for
  IPv6). A private table adds its own limits on top (see CasinoTable).

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
- **Alarms are the only timers.** Named deadlines (`grace:<account>`, `idle:<account>`,
  `leader`, `heartbeat`, `close`) live in a table. The one alarm is always set to the earliest of
  them, the engine's own deadline (a betting window, a turn) and the outbox's next retry. After a deploy restarts the object, turn
  deadlines are pushed out by the grace period so a restart doesn't auto-stand the table.
- **Party.** Members are ordered by join time. The creator is the leader. The leader switches
  public/private (private gets a PIN) and presses Start. If the leader leaves, the
  earliest-joined remaining member takes over, someone connected if possible; a leader who
  drops (or whom a restart drops), and a successor who is away, hand the lead on after 20 s. Seat limits: blackjack 7, baccarat 7,
  roulette 8, craps 8, Three Card Poker 6, Hold'em 2-9. Slots and video poker are one-player
  machines.
- **Disconnects.** "Connected" is never stored; it's read from the live sockets. A seat is
  held for 2 minutes after a drop and a reconnect gets the full table back. A player whose
  turn times out is stood (or folded in poker games). When the grace period ends with nothing
  live on the layout, the seat is cashed out.
- **Idle players.** Each member has an `idle:<account>` deadline 15 minutes after the last thing
  they asked for (`sync` aside). The page's `here` counts too. The deadline is written with a
  minute to spare, so at most once a minute. When it falls due with the player connected, their
  sockets close with 4010 and the seat is stood up exactly as Leave does it: live bets settle,
  then the cash-out goes through the outbox. A watcher just leaves, handing on the lead.
- **Hidden information stays on the server.** Each socket gets its own view: no hole cards,
  no shoe order, no bot cards, no future results in any message.
- **Seats changing hands.** Engines key a round by seat number, so a newcomer must never see a
  seat's view while the engine still holds the last occupant's round under it. A seat given up
  while a round is in play is held until nothing is on the layout anywhere (newcomers get other
  seats first; buying into a held one gets `BUSY`), a member gets their seat's view and events
  only once their chips have landed (the spectator view while buying in), and the card games clear
  a departed occupant's unshown cards when someone new sits down. `server/test/engines.test.ts`
  plays every multiplayer game with seats changing hands mid-round and checks every view and
  event per recipient.
- **Private tables** refuse a newcomer without the PIN (4005). Five wrong PINs from one account or
  one address lock it out for 10 minutes, and 30 wrong guesses at one PIN from everyone lock that
  PIN for everyone until the leader draws a new one: accounts are free and addresses cheap, so the
  per-PIN count is what stops many hands sweeping 10,000 PINs.

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
  rounds?: { seat: number; wagered: Cents; returned: Cents; spot?: number }[]; // finished rounds (one per hand), for stats
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
- **Remote players** are drawn 300 ms in the past, interpolated between snapshots, each position
  placed at the moment it reached the server (the snapshot's time less the row's age).
- **Quality**: High (bloom on emissive surfaces, MSAA, pixel ratio up to 2 with an adaptive
  step-down) and Low (no bloom, pixel ratio 1, cheaper materials), suggested from a frame-time
  probe and changeable in Settings.
- **Reconnect** with full-jitter backoff (0.5 s doubling to 30 s). A reconnect to a table
  gets the whole table state, so nothing is replayed.
- **Idle** (`app/idle.ts`, `ui/away/`): with no key, mouse, touch or wheel input for 15 minutes,
  the page shows "Still there?" for the last minute (any input clears it), then leaves any table
  the normal way, closes its sockets and shows "You were away for 15 minutes." with Come back,
  which reconnects where the player stood. While there is input it tells each socket `here` at
  most once a minute and once more after the last input, so the servers' own idle close (the
  backstop for a page that slept or was frozen) never comes first. 4010 never reconnects by itself.

## Deploys

A deploy restarts every Durable Object and drops every socket. So the casino Worker has its own
workflow (`deploy-casino.yml`, only for `workers/casino/**`), state is written on every
transition, deadlines are extended after a restart, and clients reconnect on their own. The
Worker is bundled in this repo and shipped prebuilt (`no_bundle = true`), so what deploys is
exactly what the tests ran.

## Security

- Origin allowlist on HTTP and WebSocket upgrades (j4den.com, www.j4den.com, localhost); a
  socket upgrade with no Origin is refused too.
- Sockets open with a single-use, one-minute ticket for their path, never the token.
- Every frame is size-capped before parsing and counted, junk included; then it is validated,
  and unknown types and wrong shapes are dropped. Each socket has token buckets for every kind
  of message (movement, game actions, money, lobby and party messages, emotes, chat), and frames
  dropped for a limit or for being junk are strikes that are forgiven slowly; too many close the
  socket (4008). Connecting is limited too, per account and per address. The HTTP routes with
  side effects have their own limits. `docs/PROTOCOL.md` lists them all.
- Rate limits keyed by address count an IPv6 /64 as one address.
- Table ids are validated by the Worker, and a table that was never initialized answers 404
  without writing anything (a ticket is spent only once the table is known to exist), so probing
  can't create storage.
- Errors tell the player what went wrong in a sentence and nothing about the inside; details go
  to the log.
- Names and chat are only ever rendered as text (`textContent`, canvas).
- `server/test/security.test.ts`, `tickets.test.ts`, `seats.test.ts` and `engines.test.ts` pin
  these down, and `scripts/load/run.mjs` plays every multiplayer game with eight players, storms
  of dropped sockets, leader handoffs, money races and a busy floor against `wrangler dev`,
  auditing every account's money in D1 afterwards.
- The page's CSP allows its own scripts, styles, fonts and media, `blob:` for textures inside
  models, and `https://api.j4den.com` plus `wss://api.j4den.com` (browsers don't treat the
  first as covering the second).
