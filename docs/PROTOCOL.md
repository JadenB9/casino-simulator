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
| POST | `/login` | `{ name }` | `{ token, profile }` | 400 `BAD_NAME`, 429 |
| GET | `/me` | | `{ profile }` | 401 |
| PUT | `/me/look` | `{ look }` | `{ look }` | 400, 401 |
| POST | `/bank/loan` | | `{ profile, loan }` | 409 `NOT_ELIGIBLE {balance, inPlay}` |
| POST | `/tables` | `{ game, variant?, visibility }` | `{ tableId, pin? }` | 400, 429 |
| POST | `/tables/join` | `{ pin }` | `{ tableId, game }` | 404 `BAD_PIN`, 429 |
| GET | `/health` | | `ok` | |

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
              hair: string; top: string; bottom: string; shoes: string };   // "#rrggbb"; either case in, lower case stored
```

## Floor socket

`wss://api.j4den.com/casino/ws/floor?v=1&t=<token>`

Client to server:

| t | fields | limit |
|---|---|---|
| `mv` | `x, z` (integer cm), `r` (yaw 0-255) | at most every 100 ms, only while moving |
| `st` | `x, z, r` | once when you stop |
| `watch` | `game: GameId \| null` | subscribe to one game's lobby list |

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

```ts
type PlayerInfo = { id: number; name: string; look: Look; x: number; z: number; r: number;
                    at: { station: string } | null };   // never a private table's id
type LobbySummary = { tableId: string; game: GameId; variant?: string; leader: string;
                      players: number; max: number; started: boolean };  // public lobbies only
```

## Table socket

Lobby: `wss://api.j4den.com/casino/ws/table/<tableId>?v=1&t=<token>[&pin=<pin>]`
Solo: `wss://api.j4den.com/casino/ws/solo/<game>?v=1&t=<token>&variant=<variant>`

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
                   started: boolean; maxSeats: number; limits: TableLimits };
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
