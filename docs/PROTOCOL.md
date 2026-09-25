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
- An inbound frame over 4 KB (512 bytes on the floor) closes the socket (1009) before it is
  parsed. Unknown `t` and wrong shapes are dropped silently. Well-formed requests the server
  refuses get `err`.
- Every frame counts against its socket's limits, junk included ([Limits](#limits)): a frame
  dropped for a limit or for being junk is a strike, and too many strikes close the socket (4008).

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
| `BUSY` | the seat is buying in or cashing out; try again in a moment. Buying into a seat someone gave up mid-round: "This seat opens when the round in play ends." |

### Close codes

| code | meaning | client does |
|---|---|---|
| 4000 | protocol error | reconnect after backoff |
| 4001 | replaced by a newer connection for this account | show "opened in another tab"; don't reconnect |
| 4003 | no socket ticket, or its account is gone | back to login |
| 4004 | table not found or closed | back to the floor |
| 4005 | not allowed at this table (full, another player's solo table, a private lobby without its PIN, or too many wrong PINs) | back to the floor |
| 4006 | the socket ticket was expired, already used, or for another path | get a new ticket and reconnect (with backoff) |
| 4008 | rate limited repeatedly, or connecting again too fast | back off |
| 4009 | protocol version mismatch, or a page from before socket tickets (it sends `t=<token>`) | reload the page |
| 4010 | away too long: nothing from this player for 15 minutes ([Idle](#idle)); a seat is stood up first | show the away screen; reconnect only on Come back |
| anything else (1001, 1006, 1011, 1012, deploys) | transient | reconnect with full jitter |

Reconnect: `delay = random(0, min(30 s, 0.5 s × 2^attempt))`, reset after 10 s of a stable
connection, and immediately on `online` or when the tab becomes visible (one attempt at a time,
its ticket included). Every attempt gets a fresh socket ticket. Clients send the text `ping`
every 25 s, and at once when the tab wakes or the network comes back; the server answers `pong`
without waking the object; no pong in 10 s means reconnect.

### Limits

Per socket unless it says otherwise. "A strike" is a frame dropped for a limit or for being
junk (not JSON, an unknown `t`, a wrong shape).

| what | allowance | past it |
|---|---|---|
| table frames, any kind | 60 in a burst, then 30 a second | dropped, a strike |
| table `act` | 24, then 12 a second | `err RATE_LIMITED`, a strike |
| table `buyin`, `topup`, `cashout` | 3, then 1 a second | `err RATE_LIMITED`, a strike |
| other table messages (`here` included) | 8, then 4 a second | `err RATE_LIMITED`, a strike |
| table strikes | 40, one forgiven every 5 s | closed, 4008 |
| floor frames, any kind | 60, then 30 a second | dropped, a strike |
| floor `mv`, `st` | 30, then 16 a second | dropped, a strike |
| floor `watch`, `here` | 10, then 4 a second | dropped, a strike |
| floor `emote` | 3, then one every 2 s | dropped quietly, no strike |
| floor strikes | 200, one forgiven a second | closed, 4008 |
| chat `say` (both sockets) | per account per room: 3 lines, then 1 a second | `chat.no`; repeated, a mute ([Chat](#chat)) |
| connecting to a table | per account: 10, then one every 3 s | closed, 4008 |
| connecting to the floor | per account: 10, then one every 3 s; per address: 60, then 2 a second | closed, 4008 |
| socket tickets | per account: 30, then 1 a second | 429 |
| logins | 30 a minute per address | 429 |
| new accounts | 10 an hour per address | 429 |
| wrong passwords | 20 per 15 minutes per address, 60 per name | 429, no password work until the window ends |
| look changes | 20 a minute per account | 429 |
| the bank | 10 a minute per account | 429 |
| the shop, the bar | 20 purchases a minute per account, each | 429 |
| PIN joins (HTTP) | per account 5 a minute and 30 an hour; per address 10 a minute and 60 an hour | 429 |
| PINs at a private table | 5 wrong per account and per address, 30 wrong per PIN from everyone, per 10 minutes | closed 4005 "too many tries" |

"Per address" is per IP, and per /64 for IPv6 (one user can take a new address from theirs for
every request).

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
| POST | `/ticket` | `{ target }` | `{ ticket, exp }` | 400 (not a socket path), 401, 429 |
| GET | `/leaderboard` | `?game=<id>` (optional) | `LeaderboardResponse` | 400 (not a game on the floor), 401 |
| GET | `/stats` | | `StatsResponse` | 401 |
| GET | `/feats` | | `FeatsResponse` | 401 |
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

**Achievements and challenges** (`shared/src/feats.ts`). The tables decide them from the rounds
they settle (`server/src/feats.ts`); each is earned once per account and paid once, in one D1
batch: the `casino_feats` row and, for a cash reward, a `'grant'` ledger row with op id
`feat:<account>:<feat>` and the balance change. The player hears `{ t: 'feat', feat, at,
balance? }` on the table's socket (the balance after a cash reward) and everyone on the floor
`{ t: 'feat', id, name, feat }`. Reward pieces, emotes and titles need no row of their own: they
come with the feat (`profile.owned`, and `look.title` may name a feat whose reward has a
title). `GET /feats` is `{ feats: [{ feat, at }], tally }`: the tallies challenges are measured on
(`won`, `best`, `rounds`, `won:<game>`, `wins:<game>`, `bj:naturals`), as D1 has them. Tables
send their tallies now and then (two minutes after the first unsent one, when the player stands
up, and before paying a feat), so the numbers can trail a table still in play.

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
type LeaderboardId =                                            // LEADERBOARDS, in the sheet's order
  | "richest" | "netUp" | "netDown" | "won" | "lost" | "wagered" | "biggestWin" | "biggestLoss"
  | "rounds" | "winRate" | "streak" | "feats" | "celebs" | "collection"
  | "today" | "todayDown" | "week" | "weekDown";
// GAME_LEADERBOARDS, one game's: netUp netDown won lost biggestWin biggestLoss rounds winRate
type LeaderboardRow = { rank: number; name: string; value: number; of?: number; you?: true };
type Leaderboard = {
  top: LeaderboardRow[];                                       // at most LEADERBOARD_TOP (10), best first
  you: { rank: number | null; name: string; value: number; of?: number } | null;  // only when you're not in top
};
type LeaderboardResponse = { boards: Partial<Record<LeaderboardId, Leaderboard>>; game?: GameId; age: number };
type StatLine = { rounds; wagered; net; biggestWin;             // lifetime, from the cash-outs
                  counted; wins; won; lost; biggestLoss };      // from the round tallies (v6 on)
type StatsResponse = { name; createdAt; worth: { balance; inPlay; total }; total: StatLine;
                       games: Partial<Record<GameId, StatLine>>;
                       days: { day: string; net: number }[];    // STATS_DAYS (14) Las Vegas days, oldest first
                       streak; feats; celebs; collection };
```

Leaderboards (`server/src/leaderboard.ts`; what each counts is `shared/src/stats.ts`). Money in
cents, counts as counts, `winRate` in basis points (5234 = 52.34%) with `of` the rounds it's out
of. `richest` is balance plus chips taken to tables (`inPlay`, what the buy-ins took; a stack's
wins count once it cashes out). `netUp` / `netDown` are lifetime net over every game (the losers'
board holds only players who are down, most down first, values negative), `wagered` everything
bet, `rounds` rounds played, all from the cash-outs. `biggestWin` is the largest single-round
profit in any one game. From the round tallies, which begin with v6 and reach D1 with the feats'
flush (every couple of minutes at a table, and at cash-out): `won` / `lost` (the profit of winning
rounds, what losing rounds cost), `biggestLoss` (most lost on one round), `winRate` (rounds that
made a profit, out of `WIN_RATE_MIN` = 100 or more; a push is not a win), `streak` (winning rounds
in a row at one table; a push keeps it), `today` / `week` and their `Down` twins (net since
midnight / Monday midnight, Las Vegas time). `feats` counts achievements earned, `celebs` the
different celebrities met, `collection` what the kept items cost. `?game=<id>` answers that game's
eight boards instead (win rate over `WIN_RATE_MIN_GAME` = 50 rounds). Places are shared on a tie
(1, 2, 2, 4), ties listed oldest account first (newest first on the losers' boards). `you.rank`
is null when there's nothing to rank yet. Names only: no account ids. Each Worker isolate reads a
set of boards from D1 at most once a minute (each game's are a set of their own) and `age` says
how old they are (ms); a player outside a top ten has their own places read once per such read.

`GET /stats` is the asker's own record for the stats sheet, and nobody else's is ever sent.

**The daily bonus** (`server/src/daily.ts`, `shared/src/celebs.ts`). `GET /daily` says where your
streak stands; `POST /daily/claim` takes today's. Days are Las Vegas days. The first claim pays
$2,500, then $5,000, $7,500, $10,000, $15,000, $20,000 and $50,000 on seven days in a row, and
$50,000 every day after; a missed day starts again at $2,500. A claim is a `grant` in the ledger
keyed `daily:<account>:<yyyy-mm-dd>`, so a second claim the same day (another tab, a retry, a race)
is `409 NOT_ELIGIBLE` with the balance, never a second payment. 20 claims a minute per account.
`met` counts the celebrities you've said hello to.

```ts
type DailyStatus = { day: string; streak: number; claimed: boolean;
                     next: number;            // which of the seven days the next claim is (1-7)
                     amount: number;          // what it pays: today's if unclaimed, else tomorrow's
                     amounts: number[];       // the seven days' amounts, cents
                     resetAt: number;         // server time the Las Vegas day ends
                     met: Partial<Record<CelebId, number>> };
type DailyClaimResponse = { amount: number; streak: number; balance: number; inPlay: number; rev: number; status: DailyStatus };
```

On the dev stack only (`CASINO_DEV` in `server/wrangler.toml`; production never sets it),
`POST /dev/celeb {celeb?}` starts a celebrity's visit a moment from now and `POST /dev/gift
{spot?}` leaves a gift box at once, for the headless checks. Elsewhere both are `404`.

## Socket tickets

Sockets never carry the 30-day token. Right before each connection attempt the client asks for a
ticket for the path it is about to open (`POST /ticket {target}` with the token, `target` being
`floor`, `table/<tableId>` or `solo/<game>`) and opens the socket with `&ticket=<ticket>`. A
ticket names the account and that one path, works for a minute, and opens one socket once: the
Worker checks its signature (`k1.<payload>.<HMAC-SHA256>`, signed apart from tokens so neither
passes for the other), its time and its path, and the object behind the path spends it in its
own storage (so a restart doesn't forget). A ticket that is late, used or for another path gets
close 4006, and the client simply asks for another. No ticket at all gets 4003; a page from
before tickets that still sends `&t=<token>` gets 4009 and reloads. The account a socket
belongs to (and so a solo table's name) comes from the ticket.

## Idle

Nobody at the keyboard for `IDLE_MS` (15 minutes; `IDLE_WARN_MS` and `HERE_MS` sit beside it in
`shared/src/protocol.ts`) and the casino lets them go.

- **The page goes first.** It watches its own input (keys, mouse, touch, the wheel;
  `client/src/app/idle.ts`) on the wall clock, so a laptop that slept through the quarter hour
  finds out as soon as it wakes. A minute before the end it shows "Still there?" with a
  countdown, and any input clears it. At the end it leaves any table the normal way (`leave`),
  closes its sockets and shows "You were away for 15 minutes." with Come back, which reconnects
  (fresh tickets) and puts the player back where they stood: the first position on a new floor
  connection places the player.
- **`here`.** While there is input, the page sends `{ "t": "here" }` on each open socket, at most
  once every `HERE_MS` (a minute), and once more after the last input (retried every 5 s while a
  socket reconnects). So what a server last heard is never older than the last input, and the
  server never closes a socket before the page's own warning has run.
- **The floor** closes a socket nothing real has come from for `IDLE_MS` with 4010: a real thing is
  a move or turn that changes the pose (the same pose again isn't), a chat line, an emote, a
  `watch`, or `here`. Connecting counts; pings never reach the object. The time lives in the
  socket's attachment, so it survives hibernation, and one alarm sweeps at most every 30 s while
  anyone is connected.
- **A table** keeps an `idle:<account>` deadline per member, pushed back by anything the player
  asks for (`sync` excepted, which the client sends on its own). It's written with a minute to
  spare, so at most once a minute. When it falls due with the player connected, their sockets
  close with 4010 and the seat is stood up the way `leave` does it: live bets settle first, then
  the cash-out. A watcher just leaves, and the lead passes on. A player who had dropped is the
  grace period's business instead, and gets a whole new deadline if they come back after it
  passed.
- **The client** treats 4010 as final: no reconnect, the away screen instead.

## Floor socket

`wss://api.j4den.com/casino/ws/floor?v=1&ticket=<ticket>`

Client to server:

| t | fields | limit |
|---|---|---|
| `mv` | `x, z` (integer cm), `r` (yaw 0-255) | only while moving, and only when the others need it: at most every 200 ms, every 320 ms on a steady straight line, never for less than 5 cm or 2 yaw bytes (`client/src/net/send-policy.ts`) |
| `st` | `x, z, r` | once when you stop |
| `watch` | `game: GameId \| null` | subscribe to one game's lobby list |
| `emote` | `e: "wave" \| "cheer" \| "clap" \| "thumbs" \| "shrug" \| "sixseven"` (`EMOTES`, in the wheel's order: new ones go on the end) | 3 in a burst, then one every 2 s; extras are dropped without a reply |
| `sit` | `seat` (a floor seat id, `SEAT_ID_RE`), `x, z` (cm, where the seat is), `r` (the way it faces) | with `watch`: 10 in a burst, then 4 a second |
| `stand` | | same |
| `here` | | the player is at the keyboard ([Idle](#idle)); at most once a minute, no reply |

Movement rules. The first `mv` or `st` on a connection places you anywhere inside the floor
(`FLOOR_BOUNDS`, the room's walls): a first visit echoes the spawn in `hello`, and after a dropped
connection the client knows where it walked meanwhile. After that each position is checked
against a speed allowance and stops short on its line if it jumps further than anyone can walk.
Positions (stops too) go out in snapshots at most every 100 ms; a row that arrives sooner goes
out when the 100 ms are up. Each row carries its age, the ms since its position reached the floor,
so a client places it at `ts - age` whatever the flush added, and draws other players 300 ms in
the past (`client/src/net/interp.ts`): a steady straight line is drawn between positions the
sender didn't need to send.
A second tab for the same account takes the first one's place quietly: the old socket closes
with 4001, and nobody else sees a leave and a join.

Floor seats (`shared/src/seats.ts`): every chair, stool, sofa place and bench on the floor has an id,
and anyone can sit on a free one (table seats are the tables' own business). The floor arbitrates:
the first `sit` for a seat gets it and everyone hears `player { id, seat }`; a second gets
`seat.no` saying who got there first ("Mia got there first."), and so does a seat more than 2.5 m
from where the floor last saw you ("Walk up to it first."). Sitting moves you onto the seat (the
position goes through the usual checks). One seat per player: sitting elsewhere gives up the
first. `stand`, a position more than 60 cm from the seat (`SEAT_KEEP_CM`: walking off), closing
the socket and a second tab taking over all free it, with `player { id, seat: null }`. The seat
lives in the socket's attachment, so the floor sleeping loses nothing.

Server to client:

| t | fields |
|---|---|
| `hello` | `v, you: PlayerInfo, players: PlayerInfo[], online, now` |
| `s` | `ts, p: [id, x, z, r, moving, age][]` (players who moved since the last snapshot; `age` in ms) |
| `join` | `player: PlayerInfo` |
| `leave` | `id` |
| `player` | `id, look?, at?: { station: string } \| null` (who is sitting at which table), `seat?: string \| null` (on which floor seat) |
| `seat.no` | `seat, msg` (to the one asking: the seat went to someone else, or is out of reach) |
| `online` | `n` |
| `lobbies` | `game, list: LobbySummary[]` (the answer to `watch`) |
| `lobby` | `game, lobby: LobbySummary` (upsert, to watchers) |
| `lobby.gone` | `game, tableId` |
| `emote` | `id, e` (to everyone on the floor, the sender included) |
| `bigwins` | `list: BigWin[]` (newest first, at most 20), `today: WinsToday` (right after `hello`) |
| `bigwin` | `...BigWin, today: WinsToday` (to everyone on the floor) |

```ts
type PlayerInfo = { id: number; name: string; look: Look; x: number; z: number; r: number;
                    at: { station: string } | null;     // never a private table's id
                    seat?: string | null };             // the floor seat they sit on
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

### The law (v6)

`shared/src/law/` has the rules; the floor's side is `server/src/law.ts`.

| t (client) | fields | limit |
|---|---|---|
| `punch` | `r` (the way you face, yaw 0-255) | one per 650 ms (extras dropped); never from a table or a floor seat |

| t (server) | fields |
|---|---|
| `punch` | `id` (who threw it), `hit: number \| StaffId \| null` (a player, a member of staff, or the air), to everyone |
| `detour` | `d: Detour` (a guard or the pit boss leaving his loop to go to someone), to everyone |
| `detours` | `list: Detour[]` (the ones under way, right after `hello`) |
| `law` | `ev: { k: 'warn' \| 'jail' \| 'free', id, name, staff, why: 'punch' \| 'win' \| null, until? }`, to everyone |
| `jail` | `jail: { bail, won, at } \| null` (your own time inside: after `hello`, and as it changes) |

The staff aren't sent at all. Where each stands and faces is `poseAt(spec, t, detour)` of the
server's clock (`shared/src/law/patrol.ts`): the client draws the same function the server decides
by. A punch lands on the nearest player standing (not at a table, not on a seat) or member of staff
within 1.2 m in front. A guard who can see the puncher (in range, in his cone, in the same room:
`sight.ts`) catches it; a table reports a player whose winnings there reach its hot amount in five
minutes, or who hits a big win, and the pit boss catches it if he can see them then. Caught once
is a warning; caught again within five minutes of it (15 s later at the earliest: one moment is one
catch) is jail: bail is a fiftieth of what you had, $1,000 to $25,000, every table you sit at stands
you up the normal way, and after the guard walks over you get `tp` into the jail and stay confined
to it (every connect puts you back). Inmates play only the jail's tables (`ws/solo/blackjack` and
`ws/solo/sicbo` open `solo:<game>:jail:<id>` at $5 to a quarter of the bail; every other table
socket closes 4005, and `POST /tables` and `/tables/join` answer 403). Each finished round there
moves `won` by its net, never below zero; at the bail the jail table stands you up (you keep the
chips) and a moment later `tp` takes you to the casino's doors, strikes cleared.

### Celebrities and the gift box

Beside the messages above, the floor carries these (`shared/src/celebs.ts`, `server/src/floor/celebs.ts`).
A visit is planned ahead (every 20 to 40 minutes while people are on the floor, 4 to 10 minutes
after the floor fills up again) and told to everyone at once; clients draw the whole visit from
it and the server clock: the route (`ROUTES`, walked at 1.1 m/s with its stops) is the same
function on the server, which checks a player asking for a word is within 3.5 m of where it puts
the celebrity at that moment. One tip per account per visit, $500 to $10,000 in hundreds (mostly
under $2,000), a `grant` keyed `celeb:<account>:<visit>`. A gift box's place is only sent when it
appears; the first to open it within 2.6 m keeps $1,000 to $5,000 (`gift:<box>`, one payment per
box). Asking is limited to three in a burst, then one every two seconds (`SLOW`).

| From the client | Fields |
|---|---|
| `celeb.talk` | `visit` (a word with the celebrity, for a tip) |
| `gift.open` | `id` |

| From the floor | Fields |
|---|---|
| `celebs` | `visit: Visit \| null, gift: GiftBox \| null` (right after `hello`) |
| `celeb` | `visit: Visit` (a visit planned, or replacing one) |
| `celeb.talk` | `visit, id, line` (to everyone: the celebrity turns to player `id` and says `lines.hello[line]`) |
| `celeb.tip` | `visit, line, amount, balance, inPlay, rev, met` (to the one who asked: paid) |
| `celeb.no` | `visit, code: 'FAR' \| 'MET' \| 'GONE' \| 'SLOW', msg` |
| `gift` | `gift: GiftBox` (a box appears) |
| `gift.gone` | `id, name` (found by `name`, or run out when null) |
| `gift.won` | `id, amount, balance, inPlay, rev` (to the finder; asking again says it again) |
| `gift.no` | `id, code, msg` |

```ts
type Visit = { id: number; celeb: CelebId; start: number; seed: number };   // id = start (ms)
type GiftBox = { id: number; x: number; z: number; until: number };         // metres; id = when it was left
```

## Table socket

Lobby: `wss://api.j4den.com/casino/ws/table/<tableId>?v=1&ticket=<ticket>[&pin=<pin>]`
Solo: `wss://api.j4den.com/casino/ws/solo/<game>?v=1&ticket=<ticket>&variant=<variant>[&limits=<min>-<max>]`

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
| `here` | | anyone; the player is at the keyboard ([Idle](#idle)), no reply |

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
a member when it went private stays one. Five wrong PINs from one account, or from one address,
lock it out of that table for ten minutes, and thirty wrong guesses at one PIN from everyone
lock that PIN for everyone for ten minutes: the leader can draw a new one (private, public,
private again). The leader is whoever has been there longest; a leader who drops keeps the
lead for 20 seconds (their seat is held for two minutes), then it passes to the longest-present
player still connected (a successor who is away hands it on the same way, as does a leader a
restart dropped). An empty lobby closes after two minutes and gives up its PIN.

Seats. A newcomer takes the lowest free seat, passing over any seat given up while a round was
in play: the game may still keep that player's part of the round under the seat's number, so
the seat is held until nothing is on the layout anywhere. A newcomer gets a held seat only when
it is the only one free, and buying in there meanwhile is refused with `BUSY` ("This seat opens
when the round in play ends."). A member sees their seat's view, and the events addressed to it,
only once their chips have landed: while buying in, they get the spectator view.

## Chat

Both sockets carry chat: the floor's room is everyone on the floor, and each lobby table's room
is its members (solo tables have none). Text only.

| direction | t | fields |
|---|---|---|
| client to server | `say` | `text` |
| server to client | `chat` | `lines: ChatLine[], backlog?: true` (`backlog`: the room's last 30 lines, once, right after joining) |
| server to client | `chat.no` | `code: "RATE_LIMITED" \| "MUTED" \| "BAD_REQUEST", msg, until?, now` (to the sender only) |

```ts
type ChatLine = { n: number; id: number; name: string; text: string; at: number };  // n counts up per room
```

Every line is cleaned (NFC, whitespace folded, control, invisible and bidi characters removed,
piles of combining marks cut to four), must be 1 to 200 characters, has a short list of words
masked, and is signed with the account's own name, never one the client sends. Per account per
room: three lines in a burst, then one a second; five refused lines each within 30 s of the last
earn a mute of a minute, doubling (up to 16) for each mute within a day; mutes are stored, so a
reconnect doesn't lift them, and a client that keeps sending while muted is closed (4008). Chat
frames count against the socket's frame limit like any other.

## Game actions, events and views

Each game owns its namespace in `shared/src/games/<game>/protocol.ts`. Actions are
`{ type, ...fields }`; events are `{ type, to: "all" | seat, ...fields }`; the view is
everything needed to draw the table from scratch. The starting action sets (each game's
folder documents the final shapes):

| game | actions |
|---|---|
| blackjack | `bet {amount, spot?}`, `undo`, `clear`, `deal` (solo), `spots {n}` (solo, 1-5), `insurance {take, spot?}`, `hit`, `stand`, `double`, `split`, `surrender` (each `{spot?, hand?}`) |
| roulette | `bet {bets: {kind, numbers?, amount}[]}` (at most 40), `undo`, `clear`, `rebet {double}`, `ready {on}`, `spin` (solo) |
| craps | `bet {bets: {kind, number?, amount}[]}`, `odds {on, amount}`, `down {id, part?, amount?}`, `working {id, on}`, `roll` (shooter) |
| baccarat | `bet {player?, banker?, tie?, playerPair?, bankerPair?}` (adds to the spots named), `undo`, `clear`, `deal` (solo) |
| slots | `spin {coins, denom}` (free games play out inside the paid spin) |
| videopoker | `deal {coins, denom?}`, `draw {hold: boolean[5]}` |
| threecard | `bet {ante, pairPlus, spot?}`, `deal` (solo), `spots {n}` (solo, 1-3), `play {spot?}`, `fold {spot?}` |
| war | `bet {bet, tie, spot?}`, `deal` (solo), `spots {n}` (solo, 1-3), `war {spot?}`, `surrender {spot?}` |
| holdem | `fold`, `check`, `call`, `bet {amount}`, `raise {to}`, `allin`, `sitout {on}` |
| letitride | `bet {unit, bonus, spot?}` (unit on each of the three bets), `deal` (solo), `spots {n}` (solo, 1-3), `ride {spot?}`, `pull {spot?}` (the bet up now: 1, then 2) |
| paigow | `bet {bet, fortune, spot?}`, `deal` (solo), `spots {n}` (solo, 1-3), `set {low: [i, j], spot?}` (the two of the seven that make the low hand) |

Several hands (blackjack, Three Card Poker, Casino War, Let It Ride, Pai Gow Poker): a hand is played at a spot numbered like
the seats, and in these games' events and views every `seat` is a spot. At a shared table a
player's spot is their seat; a solo player can play spots 0 to n - 1 (`spots {n}`), and `spot`
in an action says which of them it's for. Each view's `mine` lists the viewer's spots.

Events are what the client animates: `card` (shoe to a hand, face up or down), `flip`,
`chips` (bets collected or paid), `spin` (roulette result and spin time), `dice` (both
faces), `reels` (each reel's stop, in stop order), `result` (per hand or spot, with the
amount). The events that lead to a result arrive together with the view that already holds
it.
