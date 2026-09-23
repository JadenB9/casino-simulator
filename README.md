# Casino Simulator

A 3D casino you walk around in with other people, playing table games and machines that follow
Las Vegas Strip rules and pay real odds. Play it at **[j4den.com/casino](https://j4den.com/casino/)**.

![The casino floor](docs/screenshot.jpg)

There is no password: typing a name opens that account, and the money is play money.

## What's in it

- **The floor.** A 40 × 30 m room built in code: a table pit, a poker room, six banks of slot
  machines, a Big Six wheel, video poker set into the bar, a cashier cage and a lounge. You walk it
  with WASD, look around with the mouse, and see everyone else on it walking, standing or sitting
  at a table, with their name over their head. Press E at a table to sit down, G to wave, cheer or
  clap at the people around you.
- **Eleven games.** Blackjack, roulette (American and European wheels), craps, baccarat, Three
  Card Poker, Casino War, Sic Bo, the Big Six wheel, Jacks or Better video poker, six slot machines
  and no-limit Texas Hold'em. Every table game can be played alone or in a lobby with others:
  public lobbies are listed for anyone at that table, private ones take a four-digit PIN. Hold'em
  can be played against other people or against bots.
- **Tips when you want them.** Turn on the bulb and each game shows its best play as you go: the
  basic-strategy move at blackjack, the best hold at video poker, pot odds and equity at Hold'em,
  the bets with the lowest edge at the dice and wheel games.
- **Wins you can see.** A made hand, a blackjack or a big slot line gets its name on screen and
  the cards or spots that made it light up; the biggest wins drop a shower of chips on the felt.
  Leaderboards show the richest players and the biggest single wins.
- **Money that stays put.** Accounts start with $50,000. The server holds every balance and deals
  every card; the browser only sends what you want to do. When everything is gone, balance and
  table chips alike, the cashier lends another $50,000 and the profile counts the loans.

## Rules and odds

Each game's full rules, paytables, strategy charts and sources are in [docs/RULES.md](docs/RULES.md).
The Monte Carlo suite plays millions of rounds of each and requires the measured house edge to land
within three standard errors of the published one:

| Game | Bet | Published edge | Measured |
|---|---|---|---|
| Blackjack (6 decks, S17, 3:2, DAS, late surrender) | Basic strategy | 0.354% | 0.328% (12M rounds) |
| Roulette, American | Every bet but the top line | 5.263% | 5.229% on red (3M spins) |
| Roulette, European | Every bet | 2.703% | 2.717% on red (3M spins) |
| Craps | Pass line | 1.414% | 1.426% (4M bets) |
| | Don't pass | 1.364% | 1.389% (2M bets) |
| | Field (3:1 on 12) | 2.778% | 2.712% (4M bets) |
| Baccarat | Banker | 1.058% | 1.011% (10M coups) |
| | Player | 1.235% | 1.283% (10M coups) |
| | Tie (8:1) | 14.360% | 14.300% (10M coups) |
| Three Card Poker | Ante and Play (Q-6-4) | 3.373% | 3.384% (10M hands) |
| | Pair Plus (40-30-6-3-1) | 7.276% | 7.264% (10M hands) |
| Video poker, Jacks or Better 9/6 | Optimal holds | 0.456% (99.544% RTP) | 99.447% RTP (20M hands) |
| Casino War | Going to war on every tie | 2.330% | 2.323% (10M rounds) |
| | Tie (10:1) | 18.650% | 18.642% (10M rounds) |
| Sic Bo | Small or Big | 2.778% | 2.755% / 2.781% (4M rolls) |
| | Any triple (30:1) | 13.889% | 14.197% (4M rolls) |
| Big Six wheel | $1 (1:1) | 11.111% | 11.109% (10M spins) |
| | Star or Crown (40:1) | 24.074% | 23.921% / 24.214% (10M spins) |
| Slots: Classic Sevens / Neon Nights / 5x Wild | | 94.428% / 95.374% / 89.820% RTP | 94.563% / 95.325% / 89.968% RTP |
| Slots: Diamond Line / Lucky Cherries / Gold Rush | | 94.983% / 94.028% / 92.994% RTP | 94.929% / 94.126% / 93.138% RTP |
| Texas Hold'em | | no house edge, no rake | 0 per seat within 1.2 SE (300K hands, 6 seats) |

Where the outcome space is small enough the engines are also enumerated exactly (every roulette
spot, every craps bet, every Sic Bo roll and Big Six stop, all 4,998,398,275,503,360 baccarat
six-card sequences, all 407,170,400 Three Card Poker deals, every video poker deal and draw, every
slot reel stop), and the strategy tables are tested cell by cell. Cards and numbers come from `crypto.getRandomValues` with
rejection sampling, and shoes are shuffled with Fisher-Yates.

## How it works

```
browser (Three.js + DOM)  --HTTPS-->  Worker: login, profile, bank, lobby create/join
                          <--WS---->  CasinoFloor Durable Object: presence, online count, lobby list
                          <--WS---->  CasinoTable Durable Object: one per table, runs the game
                                         |
                                         v
                                      D1: accounts, balances, a ledger, loans, stats
```

- The rules of every game are pure TypeScript in `shared/src/games/`, with no browser or Workers
  APIs. The server runs them, the tests run them millions of times, and the client only imports
  their types to know what to draw.
- Buying in moves money from your D1 balance onto the table (an escrow row, in one transaction).
  Rounds settle inside the table's Durable Object, and cashing out moves the stack back. Every
  transfer has an idempotent operation id, so a retry after a dropped connection can't pay twice.
- Views animate to results the server already decided: the wheel is solved backwards from the
  pocket, the dice land on the faces that were rolled, the reels stop where the server stopped
  them.
- A dropped player keeps their seat for two minutes; turns that time out stand or fold for them.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the wire format in
[docs/PROTOCOL.md](docs/PROTOCOL.md).

## Stack

TypeScript throughout, no frameworks. [three.js](https://threejs.org/) for the 3D, Vite to
bundle, Cloudflare Workers with SQLite-backed Durable Objects and D1 on the server, and Vitest
(with the Workers pool for the server tests). Everything is bundled; the page loads no scripts
from other sites.

## Running it locally

Node 22.12 or newer.

```sh
npm ci
npm run dev                 # http://localhost:5173/casino/  (Vite on 5173, the Worker on 5174)
```

`npm run dev` applies the D1 migrations to a local database and runs `wrangler dev` next to Vite.
Open a second browser (or a private window) to be a second player; each tab keeps its own login.

```sh
npm test                    # unit and Worker tests
npm run test:mc             # the Monte Carlo suite (a few minutes)
npm run typecheck
npm run build               # the client to dist/casino, the Worker to dist/worker
```

`?dev=table&game=<game>` opens one game's table on its own, and `?dev=floor` the floor.

## Credits

The cards, fonts, sounds, character models, props and textures are CC0 or SIL OFL; every one is
listed with its source in [docs/CREDITS.md](docs/CREDITS.md). Everything else (the tables, the
wheel, the slot machines, the felts, the carpet) is drawn in code here.

Code is MIT licensed; see [LICENSE](LICENSE).
