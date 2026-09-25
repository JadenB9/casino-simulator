# Rules and Odds: the Parlour Games

Two games from their own rooms: 75-ball bingo in the bingo hall, and pachinko in the Tokyo-style
parlour. This page fixes their rules, prize tables and exact returns, with the working behind every
number, and the Monte Carlo results that check the engines against them.

Every figure here is printed by [`docs/math/bingo-pachinko.mjs`](../math/bingo-pachinko.mjs), which
works both games out exactly in integer arithmetic without touching the game code
(`node docs/math/bingo-pachinko.mjs`). The unit tests check the same numbers a second time through
the engines (`shared/test/bingo.test.ts`, `shared/test/pachinko.test.ts`).

| Section | Game | Return to player |
|---|---|---|
| [1](#1-bingo) | Bingo: 75 balls, 1 to 4 cards a game, line, four corners and blackout, prizes fixed by pattern and ball | 96.710234% of every card's price |
| [2](#2-pachinko) | Pachinko: batches of 25 balls, the start pocket, two tulips, jackpots that chain on odd numbers | 96.69189453125% of every batch |

## 0. Conventions

- **Money.** Bets are whole dollars and every payout is exact to the cent: bingo's prizes are
  hundredths of a whole-dollar card price, and a pachinko ball is a 25th of a whole-dollar batch.
- **Randomness.** The server draws everything from `crypto.getRandomValues`, with rejection sampling
  for every range that doesn't divide 2^32 (`shared/src/rng.ts`). What the screens show (a ball up
  the chute, a steel ball through the nails, the reels) only plays out what the server sent.
- **Return (RTP)** is the expected payout per unit bet, stake included. **SD** is the standard
  deviation of one round's net result in units of the bet.
- **Limits** come from the table's config (`limits.default`): $1 to $1,000 a card (bingo) or a batch
  (pachinko) in $1 steps at Standard, and every bet control has a Max.
- **Monte Carlo.** Fixed seeds (`mcRng`), SE = SD/√N, and every tally must land within 3 SE of the
  published return. z is (measured edge − published edge)/SE. `npm run test:mc` reproduces every
  figure below exactly; `MC_RNG=crypto` reruns on the production generator.

---

## 1. Bingo

### 1.1 The game

1. **Cards on sale.** Buy 1 to 4 cards for the next game, each at a price of your choosing (Max: the
   table maximum each, or your chips shared between them). A card's price comes off your stack when
   you buy it. **Return** hands them all back while the sale is open; **Rebuy** buys last game's
   again (as many, at the last price). In a shared hall the sale runs 25 seconds on the hall's clock
   (nobody presses Start, and a game follows a game while anyone is seated); if nobody has bought
   when it ends, it runs again. Alone, the sale waits for your first card, then runs 10 seconds;
   **Call** starts the game at once.
2. **Cards.** Each card is dealt by the server when you buy it: five columns under B-I-N-G-O, B from
   1-15, I 16-30, N four numbers from 31-45 round a free centre, G 46-60, O 61-75, drawn without
   replacement within each column. Only you see your cards' numbers.
3. **Eyes down.** When the sale closes, the server shuffles all 75 balls (Fisher-Yates) and keeps the
   order to itself. The caller then calls a ball every 2.2 seconds (1.3 alone). Each one is sent to
   the hall as it is called, never before.
4. **Patterns.** Every card is checked on every call for three patterns, each paid once:
   - **Line**: any row, column or diagonal (the four through the centre need only four numbers).
   - **Four corners**.
   - **Blackout**: all 24 numbers.
5. **Prizes.** A pattern pays a fixed multiple of the card's price, set by the call it was completed
   on (the table below), the moment that ball is called. Nobody shares a prize: every card is its own
   bet, so the return is the same with one card in the hall or 160.
6. **The end.** The game ends when no card in play can win anything more: past the 40th call for
   lines and the 35th for corners, and when no card could still fill in within 55 calls. That test
   uses only the balls already called, so the end of a game says nothing about the balls that were
   never called. At most 55 balls are called.
7. **Daubing.** Cards daub themselves; with auto daub off, a called number pulses on your card until
   you click it (D daubs everything). The caller checks every card either way: a missed daub never
   costs a prize.
8. **Leaving.** Cards bought for a game that hasn't started come back. Once eyes are down, your cards
   play to the end of the game and you are paid what they win, then you are cashed out.

### 1.2 The prize table

| Pattern | Completed on call | Pays (× the card's price) | Chance for a card |
|---|---|---|---|
| Line | 1-12 | 50 | 0.1995208% |
| | 13-16 | 20 | 0.5993843% |
| | 17-20 | 8 | 1.4885402% |
| | 21-25 | 3 | 4.1086603% |
| | 26-30 | 1.5 | 7.9578413% |
| | 31-35 | 0.8 | 12.8388363% |
| | 36-40 | 0.4 | 17.3703273% |
| Four corners | 1-12 | 100 | 0.0407257% |
| | 13-16 | 40 | 0.1090131% |
| | 17-20 | 12 | 0.2488790% |
| | 21-25 | 5 | 0.6421490% |
| | 26-30 | 2 | 1.2139537% |
| | 31-35 | 0.5 | 2.0531490% |
| Blackout (the jackpot) | 24-45 | 20,000 | 0.0000146% (1 in 6.83 million) |
| | 46-50 | 2,500 | 0.0004569% (1 in 219,000) |
| | 51-55 | 200 | 0.0091822% (1 in 10,900) |

A card's first line comes on call 41.37 on average, so about 45% of cards win a line prize.

### 1.3 The exact return

For one card and a uniformly shuffled order, only which of the card's 24 numbers have been called
matters. After n calls the card has k of them with chance C(24, k)·C(51, n − k)/C(75, n)
(hypergeometric), and every k-subset of its cells is equally likely. So:

- **Four corners** is complete after n calls with chance C(n, 4)/C(75, 4): the four corner balls are
  all among the first n.
- **Blackout**: C(n, 24)/C(75, 24).
- **Line**: Σₖ L(k)·C(51, n − k)/C(75, n), where L(k) is the number of k-subsets of the 24 cells that
  hold at least one of the 12 lines. L(k) is counted by walking all 2^24 subsets (the script) and by
  inclusion-exclusion over the 4,095 sets of lines (the engine's `lineSubsets`); the tests check
  that both agree for every k.

Each band's chance is the difference of those at its ends; each pattern's share of the return is
Σ chance × multiple:

| Share | Return |
|---|---|
| Line | 75.353989962% |
| Four corners | 18.084865688% |
| Blackout | 3.271378372% |
| **A card** | **96.710234022%** = 13647032714116553612359 / 14111260149541619790180 |

Published: **96.710234%** (house edge 3.289766%). The test checks that the exact fraction rounds to
it. A card's SD is about 13.4 prices, almost all of it the 20,000× jackpot.

### 1.4 Monte Carlo

| Tally | N | Measured edge | Published | SE | z |
|---|---|---|---|---|---|
| A card (dealCard, drawOrder, completions, prize table) | 3,000,000 cards | 3.0470% | 3.2898% | 0.7739% | −0.31 |
| Line's share, less its exact share | 3,000,000 | −0.0380% | 0 | 0.1678% | −0.23 |
| Four corners' share | 3,000,000 | 0.1605% | 0 | 0.1443% | 1.11 |
| Blackout's share | 3,000,000 | −0.3653% | 0 | 0.7398% | −0.49 |
| Through the engine: 15,000 games of 4 + 1 cards, a game's four cards one sample | 15,000 games | 4.9197% | 3.2898% | 1.7345% | 0.94 |

The call each card's first line came on matches its exact distribution: chi-square 58.34 over 58
degrees of freedom (critical 97.11 at p = 0.001).

---

## 2. Pachinko

### 2.1 The game

1. **A batch.** Set the batch's price (Max: the table maximum, or your chips) and press Launch: 25
   steel balls, each worth a 25th of the price, are fired up the rail one after another. The handle
   (the power dial) changes how hard they are shot, and so where they fly. It does not change what
   they win: the server has drawn where every ball goes before the first one leaves the launcher,
   and each one is steered onto its draw by a recorded flight through the nails that ends in that
   pocket.
2. **Where a ball goes.** Each ball, independently:

   | Pocket | Chance | Pays |
   |---|---|---|
   | Start pocket (the heso, under the screen) | 1 in 20 | 4 balls, and spins the reels |
   | Left tulip | 1 in 20 | 3 balls |
   | Right tulip | 1 in 20 | 3 balls |
   | Out (the hole at the bottom) | 17 in 20 | nothing |

3. **The reels.** Every start pocket ball spins the screen's three reels (0-9). Three of a kind is a
   jackpot, one spin in 32. Up to four spins wait their turn (the lamps under the reels), as on a
   real machine. A miss can be a **reach** (the outer reels agree and the middle one lets them
   down); that, and every face on a miss, is drawn by the server after the outcome, so it changes
   nothing.
4. **The fever.** A jackpot opens the attacker at the bottom of the board for 10 rounds of 15 balls:
   150 balls. Then the jackpot's number decides: **odd** (1, 3, 5, 7, 9: kakuhen) and the reels go
   again for another jackpot at once; **even**, and the fever is over. A chain holds at most 8
   jackpots (1,200 balls, 48 times the batch).
5. **Settlement.** The batch's price comes off the stack and everything it wins goes back on in the
   step that takes it, so nothing is ever live between batches. The screen then plays the batch out,
   and the credit on the panel counts each ball home as it lands.
6. **The data lamp** on top of the machine counts reel spins since the last jackpot, jackpots, and the
   longest chain, as a parlour's does.

### 2.2 The exact return

A chain of exactly n jackpots has chance (1/2)^n for n = 1 to 7 and (1/2)^7 for 8, so a chain holds
Σₖ₌₀⁷ (1/2)^k = 255/128 jackpots on average. Per ball:

| Source | Return |
|---|---|
| Tulips: 2 × (1/20) × 3 | 30% |
| Start pocket: (1/20) × 4 | 20% |
| Jackpots: (1/20) × (1/32) × 150 × 255/128 | 46.6918945312% |
| **A ball, and so a batch** | **96.69189453125%** |

Every denominator is a power of 2 times 5, so the return is this terminating decimal exactly. The
tests walk every one of a ball's 878,955 draw sequences (20 pockets, 32 reel stops, 10 numbers for
each jackpot) and get the same fraction, and play every pocket, reel stop and chain length through
the engine. House edge 3.30810546875%. A batch's SD is about 2.9 batch prices.

### 2.3 Monte Carlo

| Tally | N | Measured edge | Published | SE | z |
|---|---|---|---|---|---|
| A batch (drawBall × 25) | 2,000,000 batches | 3.4280% | 3.3081% | 0.2048% | 0.59 |
| Through the engine (launch, pay, stack) | 200,000 batches | 3.1752% | 3.3081% | 0.6477% | −0.21 |

Chain lengths match 1/2, 1/4, ... 1/128, 1/128: chi-square 8.51 over 7 degrees of freedom (critical
24.32 at p = 0.001), from 78,103 chains.
