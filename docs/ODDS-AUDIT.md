# Odds and cheese audit (v6)

Two questions, asked of every game and every way money moves:

1. **Odds.** Is each published return right (proved exactly where the outcome space allows,
   and measured by the Monte Carlo suite), and is it one a real casino would offer?
2. **Cheese.** Can a player farm money: play for free, collect something twice, launder the
   house's money through a second account, time a request, or see what they shouldn't?

Checked on main 6a6e7df plus this branch (v6/audit6). poker6's stakes and bots work was still
in progress; its money paths are covered only where they already exist on main.

## 1. Odds

`npm run test:mc` on this branch: **37 files, 85 tests, all pass**. Every Monte Carlo lands
within 3 standard errors of its published figure, with fixed seeds (docs/RULES.md has each z).
"Exact" names the unit test that proves the published figure by enumeration or closed form (in
`shared/test/`); "MC" names the Monte Carlo file (`shared/test/*.mc.test.ts`).

"Real casinos" is what the same game returns on the Las Vegas Strip or at the big online
operators: Wizard of Odds for the table games, the Nevada Gaming Control Board for slots, and
Stake's published tables for the online originals.

| Game | Bet | Published (edge or RTP) | Real casinos | Exact proof | MC | Verdict |
|---|---|---|---|---|---|---|
| Blackjack | basic strategy, 6D S17 DAS LS, cut card 75% | 0.354% edge | 0.26-0.6% on the Strip | Wizard of Odds calculator for exactly these rules (rules.ts and the strategy chart cell-by-cell in blackjack.strategy.test.ts) | blackjack.mc (12M rounds), blackjack-spots.mc (3 and 5 spots), fresh-shoe 0.3336% | Realistic. **See 1.1: card counting beats this shoe.** |
| Roulette | American, every bet except top line | 5.263% | 5.26% | roulette.test "has the published edge for every bet, by exact enumeration" | roulette.mc | Realistic |
| | American top line | 7.895% | 7.89% | same | same | Realistic |
| | European | 2.703% | 2.70% | same | same | Realistic |
| Craps | pass / don't pass | 1.414% / 1.364% | same | craps-rules.test (full odds, lay, place, field, buy) | craps.mc | Realistic |
| | place 6/8, field, free odds | 1.515%, 2.778%, 0% | same | craps-rules.test "odds alone are a fair bet" | craps.mc | Realistic |
| Baccarat | banker / player / tie 8:1 | 1.058% / 1.235% / 14.36% | same | baccarat-enumeration.test (every six-card sequence) | baccarat.mc | Realistic |
| Three Card Poker | Ante/Play Q-6-4 / Pair Plus 40-30-6-3-1 | 3.373% / 7.276% | 3.37% / 7.28% (the Strip's common table) | threecard.test (407,170,400 and 22,100 enumerations) | threecard.mc, threecard-spots.mc | Realistic |
| Casino War | war on ties (2:1 bonus) / surrender / tie 10:1 | 2.330% / 3.698% / 18.65% | 2.33-2.88% / 3.70% / 18.65% | war.test (closed form and exactOdds) | war.mc, war-spots.mc | Realistic |
| Big Six | $1 to $20, Star/Crown 40:1 | 11.1% to 24.1% | 11-24% | bigsix.test "exact enumeration of the 54 stops" | bigsix.mc | Realistic (a sucker bet, as in Vegas) |
| Sic Bo | small/big to specific triple | 2.78% to 18.98% | same (Atlantic City table) | sicbo.test "exact enumeration of the 216 rolls" | sicbo.mc | Realistic |
| Bandit Wheel | 1/3/5, 10, 20 | 4%, 12%, 16% | Rust's wheel; a Big Six cousin | banditwheel.test "exact edges ... by enumerating the 25 slots" | banditwheel.mc | Realistic |
| Let It Ride | the three bets / 3-Card Bonus | 3.506% of a unit / 7.095% | 3.51% / 7.10% | letitride-exact.test | letitride.mc | Realistic |
| Pai Gow Poker | house way vs house way / Fortune PT2 | 2.731% / 7.766% | 2.72-2.73% / 7.77% | paigow-fortune.exact.mc (all 154,143,080 hands); house way by MC | paigow.mc | Realistic |
| Video poker | 9/6 Jacks or Better, 5 coins | 99.544% RTP | 99.54% (full pay; the Strip often has 8/5 97.3%) | videopoker.exact.mc (hold list optimal on every deal) | videopoker.mc | Realistic, player-friendly end |
| Slots A Classic Sevens | | 94.428% | Strip slots 88-94% (NGCB) | slots-exact.test 247,536 / 262,144 | slots.mc | Realistic |
| Slots B Neon Nights | | 95.374% | same | slots-exact.test (base by enumeration, free games closed form) | slots.mc | Realistic |
| Slots C 5x Wild | | 89.820% | same | slots-exact.test 335,253 / 373,248 | slots.mc (50M spins) | Realistic (high volatility, low end) |
| Slots D Diamond Line | | 94.983% | same | slots-diamonds.test 248,992 / 262,144 | slots-diamonds.mc | Realistic |
| Slots E Lucky Cherries | | 94.028% | same | slots-cherries.test (30^5 windows + wheel) | slots-cherries.mc | Realistic |
| Slots F Gold Rush | | 92.994% | same | slots-goldrush.test (32^5 windows + free games) | slots-goldrush.mc | Realistic |
| Texas Hold'em | multiplayer, no rake | no house edge | real rooms rake 5-10% of each pot, capped | holdem.mc (every seat breaks even; 133,784,560 hands; uniform deals) | holdem.mc | Player to player, so no rake is fine (a friends' game). **Solo against the bots: see 1.2** |
| Plinko | 27 boards | 98.906% to 99.160% | Stake 98.9-99.2% | plinko.test "every board returns ..., as published" | plinko.mc | Realistic |
| Dice | multiplier 99/chance, floored to the cent | 99.0% (98.03% at worst; 97.06% chance at $1) | Stake 99% | dice.test (every roll of every target at $1) | dice.mc | Realistic; the cent floor only bites at $1 bets |
| Limbo | every target | 99.0% | Stake 99% | limbo.test (switch points exact) | limbo.mc | Realistic |
| Keno | 40 tables | 98.654% to 99.069% | Stake 98.6-99.1% (real-casino live keno is 70-75%) | keno.test (hypergeometric sums) | keno.mc | Realistic for an online game |
| Tower | every row and difficulty | 98.667% to 99.0% | Stake 99% | tower.test (exact integers) | tower.mc | Realistic |
| Mines | every (mines, gems) cell | 98.28% to 99.0% | Stake 99% | mines.test (all 300 cells) | mines.mc | Realistic |
| Hi-Lo | one guess / each further guess | 98.728% / 99% of what rides | Stake 99% | hilo.test (every path, enumerated) | hilo.mc | Realistic |
| Crash | any cash-out | 99.0% | Stake/Bustabit 99% | crash.test (sampler exact in integers) | crash.mc (incl. random clicks through the engine) | Realistic |
| Coinflip | any stop, any plan | 99.0% | 98-99% | coinflip.test (closed form; every 8-flip path) | coinflip.mc | Realistic |
| Wheel | 15 wheels | 99.0% | Stake 99% | wheel.test (all 450 segments) | wheel.mc | Realistic |
| Cases | 4 cases | 99.0% | 95-99% (case sites often lower) | cases.test (weights sum and return exact) | cases.mc | Realistic |
| Diamonds | every hand | 99.0% | Stake 98% (50× five of a kind; here 66.99× makes it 99%) | diamonds.test (all 16,807 hands) | diamonds.mc | Realistic |
| Bingo | every card | 96.710234% | halls 70-85%, video bingo 85-95% | bingo.test "returns 96.710234%" (inclusion-exclusion, exact) | bingo.mc | Generous next to a hall, fine next to a machine; kept |
| Pachinko | every batch | 96.69189453125% | parlours about 85-90%, pachislot to 97% | pachinko.test (every draw walked) | pachinko.mc | Generous but inside the real range; kept |
| High Card | test fixture | no edge | n/a | highcard.test | highcard.mc | Dev stack only (fixed here, see 2) |

No paytable is clearly wrong: nothing returns more than 100%, and nothing is stingier than a
real casino's version of the same game. The low end (5x Wild 89.8%, Big Six 24%, Sic Bo
specific triples) is where real casinos sit too.

### 1.1 Card counting beats blackjack (decision for the owner)

The shoe is dealt to a 75% cut card and a custom table allows $1 to $1,000,000. Counting beats
that, as it would in Vegas, and a script counts perfectly. Hi-Lo with basic strategy only (no
index plays), simulated through the game's own rule functions (`openShoe`, `startRound`,
`play`), 4M rounds each:

| Betting | Per round (units of the minimum) | Edge on money bet |
|---|---|---|
| Flat | -0.0029 (SE 0.0006) | -0.26% (house) |
| 1-12 spread by true count | +0.0134 (SE 0.0019) | +0.57% (player) |
| 1-100 spread | +0.207 (SE 0.018) | +1.38% (player) |

Real casinos answer this by backing counters off or dealing from continuous shufflers. The
options: (a) a fresh shoe every round (the continuous-shuffler figure, 0.3336%, is already
measured); (b) the dealer shuffles up when a seat's bet jumps mid-shoe; (c) keep it and
document it. Recommended: (a). Waiting on the orchestrator.

Every other card game is safe: Three Card Poker, Let It Ride and Pai Gow deal one fresh deck a
round, Hi-Lo draws with replacement, and counting baccarat or the War tie bet is worth
hundredths of a percent at most.

### 1.2 Hold'em against the bots (decision for poker6 and the owner)

At a single-player Hold'em table the other five seats are bots playing the house's chips, with
no rake. A player who beats the bots (a real poker player, or a script tuned against
rule-based play) takes money from the house with no edge against them, at stakes up to
$100K/$200K. Suggested: a standard rake at bot tables (5% of the pot, capped at three big
blinds, no flop no drop), or a stakes cap at bot tables. Multiplayer tables stay rake-free
(player to player).

### 1.3 Comps and feats

feats6's rules hold: an achievement's cash is at most half the game's lowest edge on its stake,
and count challenges and dailies are comps of at most half of theo. `GAME_EDGE` is at or below
every game's real minimum edge (checked row by row against the table above: craps 0.3% against
don't pass with 3-4-5x lay odds at 0.273% is the tightest, and comps at half of 0.3% still stay
below it). The amount challenges pay as listed, once per account. The cheapest route is
blackjack at about 0.7% of the amount won: roughly $70 for won-10k ($1,000), $700 for won-100k
($5,000), $714K for won-100m ($1M), and about $350 for each game's won-<game> ($2,500). That is
a small one-time sign-on bonus per account, accepted by the orchestrator. Their cheap route
through Hold'em is closed (see 2).

## 2. Cheese

Each money path, how it was attacked, and what stops it. "Fixed" rows are new on this branch,
with worker tests in `server/test/audit6.test.ts`.

| Path | Attack | Result | Test |
|---|---|---|---|
| **Hold'em chip dumping** | alt takes the cashier's top-up, sits at a private Hold'em table with the main account and loses on purpose; repeat (the top-up has no end) | **Fixed.** Top-ups, bonuses, tips, gift boxes and feat cash from the last 3 days, and transfers received in the last day (the same money transfers hold back), can't be bought into a multiplayer Hold'em table. Checked atomically inside the buy-in batch (a race can't pass it) with a clear message. The starting $50,000 is exempt so friends who just joined can play together (sign-ups are limited to 10 an hour per address, the same limit transfers rely on). Solo Hold'em against bots and every other game take the money as before | audit6 "the cashier's top-up can't be taken...", "only what is held stays off" |
| **Amount challenges through Hold'em** | two players pass a pot back and forth: every pot won adds to `won` and `best` → won-100m ($1M cash), won-10m, round-1m and the rest at zero cost; the global boards too | **Fixed.** Hold'em rounds count only toward Hold'em's own tallies (`won:holdem`, `wins:holdem`, `lost:holdem`), never toward the everywhere tallies (`won`, `best`, `wins`, `lost`, `worst`, day and week nets, win streaks). The personal stats page sums its totals from the games' own rows, so it still shows Hold'em | audit6 "a pot won from other players counts at Hold'em only"; feats-rounds updated |
| **Test fixture game in production** | open `ws/solo/highcard` (a 0% edge game hidden from the floor): no house edge, rounds count in stats | **Fixed.** Opens only when `CASINO_DEV=1` (dev stack and tests), like its lobbies | audit6 "High Card ... opens only on the dev stack" |
| **Bail** | put everything in savings before getting caught: bail is a fiftieth of balance + chips only, so it drops to the $1,000 floor | **Fixed.** Bail counts the bank too (balance + in play + banked) | audit6 "bail counts the bank too" |
| Cashier top-up (loan) | park money in savings, deposits, the fund, other tables, or send it to an alt, then ask | Safe: everything is counted (tables report stacks and bets out, pending moves refuse, the bank at today's price, sends in the last 3 days) in one statement | bank.test, transfer.test |
| Loan races | two loan requests at once; a buy-in landing between the count and the loan | Safe: `in_play` pinned in the loan's own statement; the second finds $50,000 | transfer.test |
| Loan while jailed / at the jail tables | | Allowed on purpose (nobody is stuck); jail tables' chips count | law.test |
| Daily bonus + streak | second tab, retry, race, claiming either side of midnight | Safe: op id `daily:<account>:<day>`; the day is the server's Las Vegas date | daily.test |
| Celebrity tips | talk twice, two tabs, reconnect, talk from across the room | Safe: one grant per account per visit (`celeb:<account>:<visit>`); distance checked on the server's position, which is speed-limited (9 m/s) | celebs.test |
| Gift boxes | two players at once, retry after a lost answer | Safe: one grant per box (`gift:<box>`); the box's contents are never sent | celebs.test |
| Achievements | $1 bets for big cash, multi-hand, bots, free games | Safe (feats6): cash scales with the stake; comps are shares of theo; pendants need $25; nothing staked counts for nothing; Hold'em titles only; the dev game counts for nothing | feats.test, feats-rounds.test |
| Challenges paying twice | two tables reaching the same challenge | Safe: the feat row's key refuses a second payment | feats.test |
| Happy hour | order at the edge of the window, replay an op from inside it | Safe: priced on the server clock when paid; a replayed op returns the same order, never a new one | happyhour.test, shop.test |
| Shop, effects, bar | charged but never played, double charge, refunds | Safe: purchase row and charge in one batch keyed by op id; effects hold a slot first and the floor's alarm settles against D1 (paid: plays; unpaid: dropped); nothing is ever refunded or resold | shop.test, shop6.test |
| Shop via top-ups | spend under $10,000, take the top-up, buy again | Only consumables (bar, effects up to $50K) can be had this way; every item, car and the statue costs $250,000 or more, so it has to be won | cars.test "out of reach of a fresh account or a loan" |
| Cars and valet | | No money moves after the purchase (valet calls are free, rate limited) | cars6.test |
| Bank interest | ask every second, split a span, deposit for a moment, break early | Safe: interest exact to fractions of a cent and paid only at midnight; early close pays no interest and costs 0.5% | bank.test |
| Casino Index | know the next step, buy and sell around it | Safe: steps come from a server secret (HMAC walk); trades are at the current step's price | bank.test |
| Transfers | alt laundering, new accounts, racing caps, sending from jail | Safe: house money held 72 hours, gifts 24 hours, new accounts 24 hours, $250K a day and $100K per pair checked again inside the batch, no sending from jail | transfer.test |
| Invites | join a private table without its PIN | Safe: an invite is a floor row naming the invitee; the PIN leaves only in the join answer | invites.test |
| Jail escape | open another table, a lobby, the online games; take the lift; reconnect; get invited | Safe: every socket and POST /tables checks the jail row in D1; presence confines; the lift refuses; greet() moves you back inside | law.test, lift.test |
| Bail farming | anything paid on release? | Nothing is paid; progress uses the jail tables' own real results | law.test |
| Leaving mid-round | stand up after seeing cards to get the bet back | Safe for every engine: dealt bets settle (blackjack stands, Three Card Poker folds, War goes to war, Let It Ride pulls back, Pai Gow is set by the house way, video poker stands pat, Crash cashes out at the clock's multiplier below the crash point, bingo cards play on). Mines, Tower and Hi-Lo hand the stake back only before the first pick or guess, when nothing has been risked (a Hi-Lo skip is free anyway) | each engine's test file |
| Crash timing | cash out after the crash point | Safe: cash-outs are judged on the server clock after settling anything due; the crash point is never sent before the crash | crash.test, crash.mc |
| Mines, Tower, Hi-Lo peeking | read the field from the view | Safe: the field and dragons appear only when the round is over; Hi-Lo draws the next card when you guess | mines.test, tower.test, hilo.test |
| Plinko, Pachinko, Wheel, Cases, Dice, Limbo, Keno | pick the landing | Safe: drawn on the server when the bet lands; the animation plays a known result | each game's engine test |
| Hidden cards | read hole cards or other hands from snapshots or events | Safe: each engine's view is built per viewer (hole cards, a dealer's hole card and folded hands stay on the server), and the tests read every message a seat receives | seats.test, security.test |
| Replayed or forged messages | resend an action id, reuse a ticket, fake headers | Safe: action ids are remembered 15 min; tickets are single use; the Durable Objects only trust headers the Worker sets | table.test, tickets.test, security.test |
| Every POST | retry after a lost answer | Safe: shop, fx, bar, bank, transfers and daily take op ids (a retry is answered with what landed); the loan refuses a second top-up by its own rule | shop.test, bank.test, daily.test |
| Multi-hand, Max bet, custom limits | exceed the limits, bet off-step, bet more than the stack | Safe: the server checks each spot against the table's limits and step and the stack covers every spot; Max is a client button | limits.test, blackjack-spots.test |
| Cent rounding | pick bets where rounding pays you | Safe: table payouts are exact (steps make them so); online multipliers are integer hundredths or floored to the cent (the house side); no payout ever rounds up | money.test, dice.test, mines.test, tower.test |
| Bots and practice | free chips or free play | No practice mode exists; slots' free games are part of the paid spin; Hold'em bots only at solo tables (see 1.2) | |

### Known limits, accepted

- **Alt accounts' starting stakes.** Each new account brings $50,000. It can be sent on after
  3 days, or lost at a Hold'em table at once; sign-ups are the limit (10 an hour per address,
  per /64 for IPv6).
- **Hold'em boards between friends.** Two players can still pass pots to each other to raise
  their own Hold'em rows (won:holdem, the "Rounder" title). No cash and no everywhere board.
- **Bank yields.** Savings at 0.5% a day on $100,000, deposits at 3.5% a week, and the Index
  drifting +0.1% a day are far richer than a real bank (they're game rewards), but capped:
  about $1,400 a day of savings, $5,000 of deposits, and an expected $10,000 on a full
  $10M fund position.
- **Retention cash.** Celebrity tips ($500-$10,000 a visit, a visit every 20-40 minutes while
  anyone is on the floor), the daily streak ($2,500-$50,000) and gift boxes all pay house
  money: capped per visit, day or box, held from transfers and multiplayer Hold'em.
