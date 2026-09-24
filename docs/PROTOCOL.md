# Protocol

Everything the client and server say to each other. The TypeScript source of truth is
`shared/src/protocol.ts` (envelope, HTTP, floor, table) and `shared/src/games/<game>/protocol.ts`
(each game's actions, events and view). **Version 1.**

## Conventions

- Money on the wire is **integer cents**. Bet amounts the client sends are cents too, and must
  be whole dollars in the table's step for that bet (e.g. place 6/8 in $6 units).
- Cards are two-character codes: rank `A23456789TJQK` + suit `shdc` (`"As"`, `"Td"`). A card
  the viewer may not see is `null`.
- Roulette pockets are `0..36`, and `37` means `00`.
- Times are server epoch milliseconds. Every countdown is sent as `{ deadline, now }`, so the
  client counts `deadline - now` from when it arrived and clock skew doesn't matter.
- Client messages: `{ "t": <type>, ...fields }`. Table actions carry `aid`, a client-chosen id;
  the table ignores an `aid` it has already applied, so a resend after a reconnect can't place
  a bet twice.
- Server replies to a specific message carry `ref: <aid>`.
- Inbound frames over 4 KB (512 bytes on the floor) are dropped before parsing. Unknown `t`
  and wrong shapes are dropped silently. Well-formed requests the server refuses get `err`.

### Errors

`{ "t": "err", "ref": "a17", "code": "NOT_ENOUGH_CHIPS", "msg": "That bet is more than your stack." }`

| code | when |
|---|---|
| `BAD_REQUEST` | valid shape, invalid move (a split on non-pairs, a bet off the step) |
| `NOT_YOUR_TURN`, `WRONG_PHASE` | out of turn; betting after "no more bets" |
| `LIMIT` | bet outside the table's min/max |
| `NOT_ENOUGH_CHIPS` | the bet is more than the seat's stack |
| `INSUFFICIENT_FUNDS` | a buy-in or top-up is more than the balance |
| `NOT_LEADER` | lobby control by a non-leader |
| `TABLE_FULL`, `NOT_FOUND`, `BAD_PIN` | joining |
| `RATE_LIMITED` | a token bucket is empty |
| `BUSY` | the seat is buying in or cashing out; try again in a moment |

### Close codes

| code | meaning | client does |
|---|---|---|
| 4000 | protocol error | reconnect after backoff |
| 4001 | replaced by a newer connection for this account | show "opened in another tab"; don't reconnect |
| 4003 | missing or expired token | back to login |
| 4004 | table not found or closed | back to the floor |
| 4005 | not allowed at this table (full, another player's solo table, a private lobby without its PIN, or too many wrong PINs) | back to the floor |
| 4008 | rate limited repeatedly | back off |
| 4009 | protocol version mismatch | reload the page |
| anything else (1001, 1006, 1011, 1012, deploys) | transient | reconnect with full jitter |

Reconnect: `delay = random(0, min(30 s, 0.5 s × 2^attempt))`, reset after 10 s of a stable
connection, and immediately on `online` or when the tab becomes visible. Clients send the text
`ping` every 25 s; the server answers `pong` without waking the object; no pong in 10 s means
reconnect.

## HTTP (`https://api.j4den.com/casino/api`)

`Authorization: Bearer <token>` on everything except `/login` and `/health`.

| method | path | body | success | errors |
|---|---|---|---|---|
| POST | `/login` | `{ name, password }` | `{ token, profile }` | 400 `BAD_NAME`, 400 `BAD_REQUEST` (password), 401 `UNAUTHORIZED`, 429 |
| GET | `/me` | | `{ profile }` | 401 |
| PUT | `/me/look` | `{ look }` | `{ look }` | 400, 401, 403 `NOT_ELIGIBLE` (wears a piece you don't own) |
| POST | `/bank/loan` | | `{ profile, loan }` | 409 `NOT_ELIGIBLE {balance, inPlay}`, 409 `BUSY` |
| POST | `/tables` | `{ game, variant?, visibility, limits?: { min, max } }` | `{ tableId, pin? }` | 400, 429 |
| POST | `/tables/join` | `{ pin }` | `{ tableId, game, lobby?: LobbySummary }` | 404 `BAD_PIN`, 429 |
| GET | `/leaderboard` | | `LeaderboardResponse` | 401 |
| GET | `/shop` | | `ShopResponse` | 401 |
| POST | `/shop/buy` | `{ item, op }` | `BuyResponse` | 400 (op), 404 `NOT_FOUND`, 409 `INSUFFICIENT_FUNDS {balance, inPlay}`, 409 `NOT_ELIGIBLE` (already yours), 429 |
| POST | `/bar/order` | `{ item, op }` | `OrderResponse` | 400 (op), 404 `NOT_FOUND`, 409 `INSUFFICIENT_FUNDS {balance, inPlay}`, 429 |
| GET | `/health` | | `ok` | |

**Logging in.** Names are first come, first served (3-16 of `A-Z a-z 0-9 _`, any case the same
name) and a password keeps one yours: 4-64 characters of anything, spaces included, counted
after NFC normalization. A new name is created with the password it came with; a name that has
one needs it; an account from before passwords takes the first password it is given and is
claimed from then on. A wrong password is `401 { error: 'UNAUTHORIZED', msg: 'Wrong name or
password.' }` whichever account it was. Past 20 wrong passwords from one address, or 60 to one
name, in 15 minutes, logins from there or to it are `429` until the window ends; so are more
than 30 attempts a minute, or 10 new names an hour, from one address. Tokens are `v2.`; a `v1.`
token (from the name-only login) is a 401 like any other bad token.

**The bank.** Under $10,000 in all (the balance plus every chip on every table, bets out
included, as the tables report them when asked), `/bank/loan` tops the balance up to exactly
$50,000 and records the difference as a loan: `loan.amount` is that difference, and
`profile.loansTaken` / `profile.loans` count it. At $10,000 or more it is `409 NOT_ELIGIBLE`
whose `msg` says what the bank counted; `balance` and `inPlay` are the profile's. While chips
are moving between a table and D1 (a buy-in, top-up or cash-out in flight) it is `409 BUSY`:
ask again in a moment.

```ts
type Profile = {
  id: number; name: string; look: Look; createdAt: number;
  balance: number; inPlay: number; rev: number;             // cents; inPlay = chips on tables
  tables: { tableId: string; game: GameId; escrow: number; stack?: number }[];
  loansTaken: number; loans: { amount: number; at: number }[];
  stats: {
    total: { rounds: number; wagered: number; net: number; biggestWin: number };
    games: Partial<Record<GameId, { rounds: number; wagered: number; net: number; biggestWin: number }>>;
  };
};
type Look = { v: 1; body: "m" | "f"; outfit: string;      // outfit ids per body in shared/src/look.ts
              skin: number;                                  // 0-7, lightest to darkest
              hair: string; top: string; bottom: string; shoes: string;     // "#rrggbb"; either case in, lower case stored
              chain?: string; grill?: string; clothes?: string;             // shop item ids you own
              watch?: string; shades?: string; hat?: string;
              held?: { item: string; order: string; until: number } };      // a bar order in your hand
```

**The boutique and the bar** (`shared/src/items.ts`). Both are paid from the balance only; chips
on tables stay where they are. `op` is an id the client picks per purchase (8-40 of `A-Z a-z 0-9
_ -`, a UUID): the same `op` again is the same purchase, answered with what it bought and never
charged twice. A shop item is yours for good; buying it again with a new `op` is `409
NOT_ELIGIBLE`. A bar order can be bought as often as you like. Each is limited to 20 a minute per
account. A refusal for money says so in `msg` ("Not enough: the Rope Chain is $250,000 and your
balance is $50,000.") and carries the numbers.

What you own is worn through your look: `chain`, `grill`, `clothes`, `watch`, `shades`, `hat`
(item ids of that kind). `/me/look` stores a look only if you own every piece on it (otherwise
`403 NOT_ELIGIBLE`, nothing stored); an id that isn't an item of that kind is dropped. `held` is
a bar order in your hand, `{ item, order, until }`: it stays only while `order` is one of your
paid orders, of that `item`, less than five minutes old, and `until` is set from when it was
paid. The floor sends looks to everyone, so what you wear and hold is seen by all.

```ts
type ShopResponse = { items: ShopItem[]; owned: { item: string; price: number; at: number }[]; balance: number };
type BuyResponse = { item: string; price: number; at: number; balance: number; inPlay: number; rev: number };
type BarOrder = { id: string; item: string; price: number; at: number; until: number };   // id = the op
type OrderResponse = { order: BarOrder; balance: number; inPlay: number; rev: number };
```

```ts
type LeaderboardId = "richest" | "biggestWin" | "rounds";       // LEADERBOARDS, in tab order
type LeaderboardRow = { rank: number; name: string; value: number; you?: true };
type Leaderboard = {
  top: LeaderboardRow[];                                       // at most LEADERBOARD_TOP (10), best first
  you: { rank: number | null; name: string; value: number } | null;  // only when you're not in top
};
type LeaderboardResponse = { boards: Record<LeaderboardId, Leaderboard>; age: number };
```

Leaderboards. `richest` is balance plus chips taken to tables (`inPlay`, what the buy-ins took;
a stack's wins count once it cashes out), in cents. `biggestWin` is the largest single-round
profit in any one game, in cents. `rounds` is rounds played over every game, a count. Places
are shared on a tie (1, 2, 2, 4), and ties are listed oldest account first. `you.rank` is null
when there's nothing to rank yet (no money, no win, no rounds). Names only: no account ids.
Each Worker isolate reads the boards from D1 at most once a minute and `age` says how old they
are (ms); a player outside a top ten has their own place read once per such read.

## Floor socket

`wss://api.j4den.com/casino/ws/floor?v=1&t=<token>`

Client to server:

| t | fields | limit |
|---|---|---|
| `mv` | `x, z` (integer cm), `r` (yaw 0-255) | at most every 100 ms, only while moving |
| `st` | `x, z, r` | once when you stop |
| `watch` | `game: GameId \| null` | subscribe to one game's lobby list |
| `emote` | `e: "wave" \| "cheer" \| "clap" \| "thumbs" \| "shrug"` (`EMOTES`) | 3 in a burst, then one every 2 s; extras are dropped without a reply |

Movement rules. The first `mv` or `st` on a connection places you anywhere inside the floor
(`FLOOR_BOUNDS`, the room's walls): a first visit echoes the spawn in `hello`, and after a dropped
connection the client knows where it walked meanwhile. After that each position is checked
against a speed allowance and stops short on its line if it jumps further than anyone can walk.
A `st` is sent to everyone at once; walking positions go out in snapshots at most every 66 ms.
A second tab for the same account takes the first one's place quietly: the old socket closes
with 4001, and nobody else sees a leave and a join.

Server to client:

| t | fields |
|---|---|
| `hello` | `v, you: PlayerInfo, players: PlayerInfo[], online, now` |
| `s` | `ts, p: [id, x, z, r, moving][]` (players who moved since the last snapshot) |
| `join` | `player: PlayerInfo` |
| `leave` | `id` |
| `player` | `id, look?, at?: { station: string } \| null` (who is sitting at which table) |
| `online` | `n` |
| `lobbies` | `game, list: LobbySummary[]` (the answer to `watch`) |
| `lobby` | `game, lobby: LobbySummary` (upsert, to watchers) |
| `lobby.gone` | `game, tableId` |
| `emote` | `id, e` (to everyone on the floor, the sender included) |
| `bigwins` | `list: BigWin[]` (newest first, at most 20), `today: WinsToday` (right after `hello`) |
| `bigwin` | `...BigWin, today: WinsToday` (to everyone on the floor) |

```ts
type PlayerInfo = { id: number; name: string; look: Look; x: number; z: number; r: number;
                    at: { station: string } | null };   // never a private table's id
type LobbySummary = { tableId: string; game: GameId; variant?: string; leader: string;
                      players: number; max: number; started: boolean;   // public lobbies only
                      limits?: { min: number; max: number } };           // cents; Hold'em: the blinds
type BigWin = { name: string; game: GameId; amount: number;   // cents won: returned - wagered
                what: string;                                  // "Straight 17", "Royal Flush", "Neon Nights, 250x"
                at: number;                                    // server time the winner sees it
                station?: string };                            // where on the floor, if anywhere
type WinsToday = { day: string; total: number; count: number };  // YYYY-MM-DD, Las Vegas time
```

Big wins. A round that returns at least 25 times its stake and wins $100 or more, or wins $5,000 or
more, is reported by its table to the floor (`server/src/floor/wins.ts`). The floor announces at
most one a minute per player and six a minute in all, keeps the last 20 for newcomers, and adds
every one (announced or not) to the day's total. `at` is when the result shows at the table (the
ball lands, the reels and any free games stop): clients hold the news until then, so nobody on
the floor hears about a win before the winner sees it. The words in `what` come only from what
the table showed everyone once the round was over: the bet that paid, a hand turned over to be
paid, a machine's own display. A Hold'em pot won without a showdown is just "Took the pot".

## Table socket

Lobby: `wss://api.j4den.com/casino/ws/table/<tableId>?v=1&t=<token>[&pin=<pin>]`
Solo: `wss://api.j4den.com/casino/ws/solo/<game>?v=1&t=<token>&variant=<variant>[&limits=<min>-<max>]`

Table limits (`shared/src/limits.ts`, docs/rules/limits.md). A lobby's are the `limits` of the
`/tables` call that made it: two whole numbers of cents or the call is a 400, moved to the nearest
limits the game allows otherwise, and Standard when left out. A solo table takes the `limits` of each
connection the same way (anything else in the parameter is ignored), unless chips are still on it:
then it keeps the limits they were bought in at until they are cashed out. Either way the table's
`meta.config` carries what it got (every bet's limits and the buy-in), and `/tables/join` returns the
table's summary so the join can show its limits first.

Client to server:

| t | fields | who |
|---|---|---|
| `buyin` | `aid, amount` | anyone without a seat (a machine calls it "insert") |
| `topup` | `aid, amount` | seated, any time; the seat keeps playing and the chips join the stack when they land (one at a time; cash-out waits for it) |
| `cashout` | `aid` | seated; completes when nothing of yours is live on the layout |
| `act` | `aid, a: <game action>` | seated; parsed by that game's `parseAction` |
| `ready` | `on` | seated; the table clears everyone's flag after each finished round |
| `visibility` | `visibility` | leader |
| `start` | | leader |
| `leave` | | anyone; implies cash-out |
| `sync` | | anyone; answered with a full `table` |

Server to client:

| t | fields |
|---|---|
| `table` | `v, meta, members, leader, you, view, seq, now` (first message, and after `sync`) |
| `members` | `members, leader, visibility, pin?, started` |
| `ev` | `seq, events: GameEvent[], view, now` (per recipient) |
| `seat` | `stack, status: "buying_in" \| "seated" \| "cashing_out", escrow` (yours) |
| `balance` | `balance, inPlay, rev` (after a buy-in, top-up or cash-out lands) |
| `closed` | `reason` |

```ts
type TableMeta = { tableId: string; game: GameId; variant?: string; mode: "solo" | "multi";
                   visibility: "public" | "private"; pin?: string;   // pin: members only
                   started: boolean; config: TableConfig };   // seats, every bet's limits, the buy-in
type Member = { accountId: number; name: string; look: Look; seat: number | null; joinedAt: number;
                connected: boolean; ready: boolean; stack?: number; bot?: true };
```

`seq` is persisted and increases by one per `ev`. A client that sees a gap sends `sync`.
Countdowns (betting windows, turns, the shooter's clock) are deadlines inside each game's view,
counted down against `now`; there is no separate timer message.

Lobbies. A private lobby lets in only newcomers who bring its PIN (`&pin=`); whoever was already
a member when it went private stays one. Five wrong PINs from one account lock it out of that
table for ten minutes. The leader is whoever has been there longest; a leader who drops keeps the
lead for 20 seconds (their seat is held for two minutes), then it passes to the longest-present
player still connected. An empty lobby closes after two minutes and gives up its PIN.

## Game actions, events and views

Each game owns its namespace in `shared/src/games/<game>/protocol.ts`. Actions are
`{ type, ...fields }`; events are `{ type, to: "all" | seat, ...fields }`; the view is
everything needed to draw the table from scratch. The starting action sets (each game's
folder documents the final shapes):

| game | actions |
|---|---|
| blackjack | `bet {amount}`, `undo`, `clear`, `deal` (solo), `insurance {take}`, `hit`, `stand`, `double`, `split`, `surrender` |
| roulette | `bet {bets: {kind, numbers?, amount}[]}` (at most 40), `undo`, `clear`, `rebet {double}`, `ready {on}`, `spin` (solo) |
| craps | `bet {bets: {kind, number?, amount}[]}`, `odds {on, amount}`, `down {id, part?, amount?}`, `working {id, on}`, `roll` (shooter) |
| baccarat | `bet {player?, banker?, tie?, playerPair?, bankerPair?}` (adds to the spots named), `undo`, `clear`, `deal` (solo) |
| slots | `spin {coins, denom}` (free games play out inside the paid spin) |
| videopoker | `deal {coins, denom?}`, `draw {hold: boolean[5]}` |
| threecard | `bet {ante, pairPlus}`, `deal` (solo), `play`, `fold` |
| holdem | `fold`, `check`, `call`, `bet {amount}`, `raise {to}`, `allin`, `sitout {on}` |

Events are what the client animates: `card` (shoe to a hand, face up or down), `flip`,
`chips` (bets collected or paid), `spin` (roulette result and spin time), `dice` (both
faces), `reels` (each reel's stop, in stop order), `result` (per hand or spot, with the
amount). The events that lead to a result arrive together with the view that already holds
it.
