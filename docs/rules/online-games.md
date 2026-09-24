# Rules and Odds: the Online Games

The computers in the online lounge run a small casino site, House Originals, in the style of the
big crypto-casino "originals": a dense dark page with the bet panel on the left and the game on the
right. Each game is a one-player table: you buy in at the desk and bet from those chips. This page
fixes each game's rules, paytables and exact return, with the proof or the enumeration behind every
number, and the Monte Carlo results that check the engines against them.

Every figure here is printed by [`docs/math/plinko-dice-limbo-keno.mjs`](../math/plinko-dice-limbo-keno.mjs),
which enumerates each game exactly in integer arithmetic without touching the game code
(`node docs/math/plinko-dice-limbo-keno.mjs`). The unit tests check the same numbers a second time
through the engines themselves.

| Section | Game | Return to player |
|---|---|---|
| [1](#1-plinko) | Plinko: 8 to 16 rows, Low, Medium or High risk (Stake's tables) | 98.90625% to 99.16015625% by board |
| [2](#2-dice) | Dice: roll 0.00 to 99.99 over or under a target | 99% before the cent floor; at $1, 98.0306% to 99% by win chance |
| [3](#3-limbo) | Limbo: a target from 1.01× to 1,000,000× | exactly 99% on every target |
| [4](#4-keno) | Keno: 40 numbers, 10 drawn, 1 to 10 picks, four risks (Stake's tables) | 98.6538% to 99.0689% by risk and picks |

## 0. Conventions

- **Money.** Bets are whole dollars and every payout is exact to the cent. Multipliers are kept in
  hundredths (5.6× is 560), so a whole-dollar bet times any two-decimal multiplier is a whole number
  of cents: Plinko, Limbo and Keno pay with no rounding at all. Dice's multiplier, 99 over the win
  chance, is not a two-decimal number, so its payouts are floored to the cent, and the published
  return includes that floor exactly (§2.2).
- **One action, one round.** The bet comes off the stack, the server draws the outcome and the
  payout goes back on, all in the step that takes the bet. Nothing is live between bets, so walking
  away is always clean, and there is no hidden state to leak: the outcome a page receives is
  already settled.
- **Randomness.** The server draws everything from `crypto.getRandomValues`, with rejection sampling
  for every range that doesn't divide 2^32 (`shared/src/rng.ts`). The pages decide nothing; the ball,
  the slider and the count-up only show what the server sent.
- **Return (RTP)** is the expected payout per unit bet, stake included. **SD** is the standard
  deviation of one round's net result in units of the bet.
- **Limits** come from the table's config (`limits.default`): $1 to $1,000 in $1 steps unless a
  table is created with others, and a buy-in of $10 to $10,000. Engines check the config's limits;
  pages print them in the footer next to the return ("Return 99.00% · Bet $1 to $1,000").
- **Monte Carlo.** Fixed seeds (`mcRng`), SE = SD/√N, and every tally must land within 3 SE of the
  published return. z is (measured return − published return)/SE. `npm run test:mc` reproduces
  every figure below exactly; `MC_RNG=crypto` reruns on the production generator.

---

## 1. Plinko

### 1.1 Rules

1. Choose the rows (8 to 16), the risk (Low, Medium or High) and a bet, and press Drop.
2. The ball falls through `rows` rows of pegs. At each row it bounces left or right with
   probability 1/2, independently of every other row. It lands in bin k, where k is the number of
   rights (bins 0 to `rows`, left to right), and the bet pays the bin's multiplier.
3. The server draws the whole path as one integer below 2^rows (`randInt`, uniform); bit i is row
   i's bounce, 1 for right. Every one of the 2^rows paths is equally likely, so bin k comes up with
   probability C(rows, k) / 2^rows.
4. Every drop is a round of its own, settled when it is made. The page plays the ball down the exact
   path it was sent, peg by peg: row r of the triangle has r + 3 pegs, and a ball that has gone right
   R times in its first r rows lands on peg R + 1 of row r. Several balls can be in the air at once.
   Rows and risk are locked while a ball is falling, since the board can't change under it. There
   is no autoplay.

### 1.2 Multiplier tables

These are Stake's Plinko tables ([stake-plinko]), bin for bin. Every table is symmetric. Only the
left half is shown, from the edge bin to the middle one.

| Rows | Risk | Bins, left edge to the middle (the right half mirrors it) |
|---:|---|---|
| 8 | Low | 5.6 · 2.1 · 1.1 · 1 · 0.5 |
| 8 | Medium | 13 · 3 · 1.3 · 0.7 · 0.4 |
| 8 | High | 29 · 4 · 1.5 · 0.3 · 0.2 |
| 9 | Low | 5.6 · 2 · 1.6 · 1 · 0.7 |
| 9 | Medium | 18 · 4 · 1.7 · 0.9 · 0.5 |
| 9 | High | 43 · 7 · 2 · 0.6 · 0.2 |
| 10 | Low | 8.9 · 3 · 1.4 · 1.1 · 1 · 0.5 |
| 10 | Medium | 22 · 5 · 2 · 1.4 · 0.6 · 0.4 |
| 10 | High | 76 · 10 · 3 · 0.9 · 0.3 · 0.2 |
| 11 | Low | 8.4 · 3 · 1.9 · 1.3 · 1 · 0.7 |
| 11 | Medium | 24 · 6 · 3 · 1.8 · 0.7 · 0.5 |
| 11 | High | 120 · 14 · 5.2 · 1.4 · 0.4 · 0.2 |
| 12 | Low | 10 · 3 · 1.6 · 1.4 · 1.1 · 1 · 0.5 |
| 12 | Medium | 33 · 11 · 4 · 2 · 1.1 · 0.6 · 0.3 |
| 12 | High | 170 · 24 · 8.1 · 2 · 0.7 · 0.2 · 0.2 |
| 13 | Low | 8.1 · 4 · 3 · 1.9 · 1.2 · 0.9 · 0.7 |
| 13 | Medium | 43 · 13 · 6 · 3 · 1.3 · 0.7 · 0.4 |
| 13 | High | 260 · 37 · 11 · 4 · 1 · 0.2 · 0.2 |
| 14 | Low | 7.1 · 4 · 1.9 · 1.4 · 1.3 · 1.1 · 1 · 0.5 |
| 14 | Medium | 58 · 15 · 7 · 4 · 1.9 · 1 · 0.5 · 0.2 |
| 14 | High | 420 · 56 · 18 · 5 · 1.9 · 0.3 · 0.2 · 0.2 |
| 15 | Low | 15 · 8 · 3 · 2 · 1.5 · 1.1 · 1 · 0.7 |
| 15 | Medium | 88 · 18 · 11 · 5 · 3 · 1.3 · 0.5 · 0.3 |
| 15 | High | 620 · 83 · 27 · 8 · 3 · 0.5 · 0.2 · 0.2 |
| 16 | Low | 16 · 9 · 2 · 1.4 · 1.4 · 1.2 · 1.1 · 1 · 0.5 |
| 16 | Medium | 110 · 41 · 10 · 5 · 3 · 1.5 · 1 · 0.5 · 0.3 |
| 16 | High | 1000 · 130 · 26 · 9 · 4 · 2 · 0.2 · 0.2 · 0.2 |

Stake's own pages refused automated requests when this was researched (HTTP 403, 2026-09-23), so
the tables were taken from independent copies of Stake's game that agree bin for bin:
[anson-plinko], a replica of Stake's Plinko; [audited-plinko], an audit of Stake's Plinko, which
matches on 26 of the 27 tables and gives 12 rows High only 12 bins (it drops one of the three
middle 0.2× bins; every other copy has 13); and more than a dozen other open-source copies
([bc-hackathon], [stake-clone] and others found by searching GitHub for the exact rows).

### 1.3 Exact return by board

Return = Σₖ C(rows, k) · multₖ / 2^rows, summed over all 2^rows paths. The denominator is
100 · 2^rows (multipliers in hundredths), so every return is a terminating decimal, printed here
in full. The last column is the chance of the top pay, either edge bin: 2 / 2^rows.

| Rows | Low | Medium | High | SD Low / Med / High (bets) | Edge bin, either side |
|---:|---:|---:|---:|---:|---:|
| 8 | 98.984375% | 98.90625% | 99.0625% | 0.558 / 1.238 / 2.670 | 1 in 128 |
| 9 | 98.984375% | 99.140625% | 99.0625% | 0.461 / 1.281 / 2.944 | 1 in 256 |
| 10 | 99.00390625% | 98.90625% | 99.0625% | 0.527 / 1.206 / 3.644 | 1 in 512 |
| 11 | 99.00390625% | 99.0234375% | 99.16015625% | 0.442 / 1.116 / 4.126 | 1 in 1,024 |
| 12 | 98.9794921875% | 98.9892578125% | 99.1162109375% | 0.388 / 1.288 / 4.381 | 1 in 2,048 |
| 13 | 98.9990234375% | 98.994140625% | 99.0869140625% | 0.470 / 1.356 / 4.847 | 1 in 4,096 |
| 14 | 99.000244140625% | 98.994140625% | 98.978271484375% | 0.319 / 1.362 / 5.578 | 1 in 8,192 |
| 15 | 99.0008544921875% | 98.9984130859375% | 99.0264892578125% | 0.410 / 1.559 / 6.005 | 1 in 16,384 |
| 16 | 98.99871826171875% | 98.98834228515625% | 98.9764404296875% | 0.332 / 1.467 / 6.565 | 1 in 32,768 |

None of them is exactly 99%, which Stake advertises. Its printed multipliers are rounded to one or
two significant figures, and the rounding moves each board a little away from 99%. The best board
is 11 rows High (99.16015625%). The worst are 8 and 10 rows Medium (98.90625%). The spread is 0.25
points: rows and risk change the swings far more than the price.

### 1.4 Monte Carlo

Four million drops per row count, each path drawn with the engine's own `drawBits` and scored on
all three risk tables at once; then 150,000 drops through the whole engine (bet, draw, pay, stack)
for three boards. The bins also get a chi-square against the binomial: 2.18 to 21.47 against a
critical value of 26.12 to 39.25 at p = 0.001, depending on the row count.

| Bet | N | Published | Measured | SE | z |
|---|---:|---:|---:|---:|---:|
| 8 rows Low | 4,000,000 | 98.9844% | 98.9951% | 0.0279% | +0.38 |
| 8 rows Medium | 4,000,000 | 98.9062% | 98.9125% | 0.0619% | +0.10 |
| 8 rows High | 4,000,000 | 99.0625% | 99.0655% | 0.1335% | +0.02 |
| 9 rows Low | 4,000,000 | 98.9844% | 98.9820% | 0.0230% | -0.10 |
| 9 rows Medium | 4,000,000 | 99.1406% | 99.1075% | 0.0639% | -0.52 |
| 9 rows High | 4,000,000 | 99.0625% | 98.9722% | 0.1469% | -0.62 |
| 10 rows Low | 4,000,000 | 99.0039% | 99.0088% | 0.0264% | +0.18 |
| 10 rows Medium | 4,000,000 | 98.9062% | 98.9105% | 0.0604% | +0.07 |
| 10 rows High | 4,000,000 | 99.0625% | 99.1365% | 0.1829% | +0.40 |
| 11 rows Low | 4,000,000 | 99.0039% | 99.0264% | 0.0221% | +1.02 |
| 11 rows Medium | 4,000,000 | 99.0234% | 99.0814% | 0.0560% | +1.03 |
| 11 rows High | 4,000,000 | 99.1602% | 99.4052% | 0.2077% | +1.18 |
| 12 rows Low | 4,000,000 | 98.9795% | 98.9701% | 0.0194% | -0.48 |
| 12 rows Medium | 4,000,000 | 98.9893% | 98.9687% | 0.0644% | -0.32 |
| 12 rows High | 4,000,000 | 99.1162% | 99.1143% | 0.2198% | -0.01 |
| 13 rows Low | 4,000,000 | 98.9990% | 99.0140% | 0.0236% | +0.64 |
| 13 rows Medium | 4,000,000 | 98.9941% | 99.0900% | 0.0684% | +1.40 |
| 13 rows High | 4,000,000 | 99.0869% | 99.6150% | 0.2479% | +2.13 |
| 14 rows Low | 4,000,000 | 99.0002% | 98.9999% | 0.0159% | -0.02 |
| 14 rows Medium | 4,000,000 | 98.9941% | 98.9361% | 0.0675% | -0.86 |
| 14 rows High | 4,000,000 | 98.9783% | 98.4682% | 0.2713% | -1.88 |
| 15 rows Low | 4,000,000 | 99.0009% | 98.9869% | 0.0205% | -0.68 |
| 15 rows Medium | 4,000,000 | 98.9984% | 98.9744% | 0.0779% | -0.31 |
| 15 rows High | 4,000,000 | 99.0265% | 98.9276% | 0.3006% | -0.33 |
| 16 rows Low | 4,000,000 | 98.9987% | 98.9838% | 0.0167% | -0.89 |
| 16 rows Medium | 4,000,000 | 98.9883% | 98.9717% | 0.0735% | -0.23 |
| 16 rows High | 4,000,000 | 98.9764% | 98.9379% | 0.3220% | -0.12 |
| engine 16 rows High | 150,000 | 98.9764% | 99.7860% | 1.8667% | +0.43 |
| engine 8 rows Low | 150,000 | 98.9844% | 98.7853% | 0.1420% | -1.40 |
| engine 12 rows Medium | 150,000 | 98.9893% | 98.7119% | 0.3365% | -0.82 |

### 1.5 Implementation notes

- `shared/src/games/plinko/rules.ts`: the tables (`MULTS`, in hundredths), `drawBits`, `binOf`,
  `payoutFor` (bet / 100 × multiplier, exact cents), `boardReturn`.
- `engine.ts`: one `drop` action is one round. Its event carries the path, the bin, the multiplier,
  the payout and the stack after it. The state keeps the last 16 drops for the results column.
- The page counts a ball's payout into the chips it shows when the ball lands; the server paid it
  when the ball was dropped.

---

## 2. Dice

### 2.1 Rules

1. The roll is one of the 10,000 numbers 0.00, 0.01, ..., 99.99, all equally likely
   (`randInt(10000)`, in hundredths).
2. **Roll Under T** wins on a roll below T; **Roll Over T** wins on a roll above T. A roll equal to
   the target loses either way. Targets are on the same 0.01 grid.
3. The **win chance** c, counted in winning rolls out of 10,000, is T for Roll Under and 9,999 − T
   for Roll Over (T in hundredths). It runs from 1 (0.01%) to 9,800 (98%). Roll Under 49.50 and Roll
   Over 50.49 are both 49.50%.
4. The **multiplier** is 99% of fair: 9,900 / c, so 2.0000× at 49.50% and 1.0102× at 98%. The page
   shows it to four decimals.
5. Target, win chance and multiplier are one choice seen three ways. The page takes any of them,
   by dragging the slider or typing in any of the three fields, and works out the other two. A
   typed multiplier M sets c = round(9,900 / M). The ⇄ button swaps Over and Under and keeps the
   chance.

### 2.2 Payout and exact return

A win pays ⌊9,900 · b / c⌋ cents on a bet of b cents, stake included. Every win at a given bet and
chance pays the same, and c of the 10,000 equally likely rolls win, so

    RTP(b, c) = c · ⌊9,900 b / c⌋ / (10,000 b).

Since 9,900b/c − 1 < ⌊9,900b/c⌋ ≤ 9,900b/c, the return lies in (99% − c / (10,000 b), 99%]. It is
exactly 99% when c divides 9,900 b, and a win never pays more than one cent under the ideal amount.
The floor matters most on small bets at high chances:

| Bet | Chances (of 9,800) that pay exactly 99% | Lowest return, and where |
|---|---:|---|
| $1 | 114 | 98.0306% at 97.06% (a win pays $1.01, not $1.02) |
| $2 | 130 | 98.5154% at 97.54% |
| $5 | 117 | 98.806% at 97.25% |
| $10 | 133 | 98.90276% at 97.73% |
| $25 | 117 | 98.9616% at 97.25% |
| $100 | 146 | 98.99032% at 97.24% |
| $1,000 | 157 | 98.999028% at 97.80% |

| Win chance | Multiplier | $1 win pays | Return at $1 | Return at $100 |
|---:|---:|---:|---:|---:|
| 0.01% | 9,900.0000× | $9,900.00 | 99% | 99% |
| 1.00% | 99.0000× | $99.00 | 99% | 99% |
| 10.00% | 9.9000× | $9.90 | 99% | 99% |
| 25.00% | 3.9600× | $3.96 | 99% | 99% |
| 33.33% | 2.9703× | $2.97 | 98.9901% | 98.996766% |
| 49.50% | 2.0000× | $2.00 | 99% | 99% |
| 50.00% | 1.9800× | $1.98 | 99% | 99% |
| 60.00% | 1.6500× | $1.65 | 99% | 99% |
| 70.00% | 1.4143× | $1.41 | 98.7% | 98.994% |
| 90.00% | 1.1000× | $1.10 | 99% | 99% |
| 97.06% | 1.0200× | $1.01 | 98.0306% | 98.991494% |
| 98.00% | 1.0102× | $1.01 | 98.98% | 98.9996% |

The page shows the return at the current bet and chance under the bet panel and in the footer, and
the tip names the nearest chance that pays exactly 99% when the floor costs something. The SD of a
round is √(p·m² − r²) bets, for win probability p = c/10,000, paid multiple m and return r: 1.000 at
49.50%, 0.646 at 70% ($1), 101 at 0.01%.

### 2.3 Monte Carlo

Ten million rolls with the engine's `drawRoll`, each settled against eight bets with its own `wins`
and `winPayout`, cent floor included; then 300,000 rolls through the whole engine. The 10,000
faces get a chi-square: 10,051.3 on 9,999 degrees of freedom (critical 10,436.0 at p = 0.001).

| Bet | N | Published | Measured | SE | z |
|---|---:|---:|---:|---:|---:|
| under 49.50, $1 | 10,000,000 | 99.0000% | 98.9784% | 0.0316% | -0.68 |
| over 50.49, $1 | 10,000,000 | 99.0000% | 99.0249% | 0.0316% | +0.79 |
| under 70.00, $1 | 10,000,000 | 98.7000% | 98.7002% | 0.0204% | +0.01 |
| over 2.90, $1 | 10,000,000 | 98.0609% | 98.0613% | 0.0054% | +0.07 |
| under 0.01, $1 | 10,000,000 | 99.0000% | 103.2570% | 3.1971% | +1.33 |
| under 33.33, $7 | 10,000,000 | 98.9901% | 98.9973% | 0.0443% | +0.16 |
| over 60.00, $25 | 10,000,000 | 98.9992% | 99.0133% | 0.0384% | +0.37 |
| under 98.00, $1 | 10,000,000 | 98.9800% | 98.9835% | 0.0045% | +0.79 |
| engine under 70.00, $1 | 300,000 | 98.7000% | 98.6845% | 0.1180% | -0.13 |

---

## 3. Limbo

### 3.1 Rules

1. Choose a target multiplier x from 1.01× to 1,000,000.00× on the 0.01 grid (the page takes the
   target or the win chance, and works out the other), and a bet.
2. The server draws a result R on the same grid, from 1.00× to 1,000,000.00×. If R ≥ x the bet wins
   and pays x times the bet (a whole-dollar bet times a two-decimal x is whole cents); otherwise it
   loses.
3. The page counts the big number up from 1.00× to R, on a log scale, and shows it green on a win
   and red on a loss.

### 3.2 The draw, and why every target returns 99%

Work in hundredths, X = 100x. Draw U uniformly from (0, 1) and set

    R = ⌊99 / U⌋, clamped to [100, 100,000,000].

**Claim.** For every target 101 ≤ X ≤ 10⁸, P(R ≥ X) = 99/X; that is, P(result ≥ x) = 0.99/x.

**Proof.** For an integer X, ⌊99/U⌋ ≥ X exactly when 99/U ≥ X, that is when U ≤ 99/X. U is
uniform, so that has probability 99/X, which is below 1 for X ≥ 100. Clamping changes only results
below 100, which lose to every target, and results above 10⁸, which become 10⁸ and still reach
every target. So P(R ≥ X) = 99/X for every target a bet can name. ∎

A bet on x therefore wins with probability 0.99/x and pays x: its return is exactly 99%, whatever
the target. Two consequences: the result is 1.00×, below every target, exactly 1% of the time
(U > 0.99), and it reaches 1,000,000× with probability 9.9 × 10⁻⁷.

**No rounding.** U is never rounded to a float. Its base-2³² digits are the generator's words, read
one at a time. After n words U lies in [A / 2³²ⁿ, (A + 1) / 2³²ⁿ). Since ⌊99/U⌋ only falls as U grows,
the result lies between ⌊99 · 2³²ⁿ / (A + 1)⌋ and ⌊99 · 2³²ⁿ / A⌋. When those agree after clamping,
every U in the interval gives the same result, so it is exactly ⌊99/U⌋ for the U the digits go on to
spell, and no more words are read. One word decides all but about 3 draws in 10,000; two words decide
the rest but for about one in 10¹¹ (`drawResult` in `shared/src/games/limbo/rules.ts`, integer
arithmetic throughout). The math script checks the switch at U = 99/X for 20,561 targets from 1.01×
to 1,000,000×, and the unit tests do it for every X up to 200.00× and 3,000 more above.

| Target | Win chance | SD per bet |
|---:|---:|---:|
| 1.01× | 98.02% | 0.141 |
| 1.50× | 66.00% | 0.711 |
| 2.00× | 49.50% | 1.000 |
| 10.00× | 9.900% | 2.987 |
| 100.00× | 0.9900% | 9.900 |
| 1,000.00× | 0.09900% | 31.45 |
| 10,000.00× | 0.009900% | 99.49 |
| 1,000,000.00× | 0.0000990% | 995.0 |

### 3.3 Monte Carlo

Ten million results from the engine's `drawResult`, each settled against nine targets; the same
draws check P(R ≥ x) = 0.99/x at eleven points from 1.01× to 1,000,000× (z from −1.83 to +0.67);
then 300,000 bets through the whole engine. The tallies share their draws, so they rise and fall
together. Reruns on other seeds and on the production generator scatter z both ways around zero.

| Bet | N | Published | Measured | SE | z |
|---|---:|---:|---:|---:|---:|
| 1.01x | 10,000,000 | 99.0000% | 98.9936% | 0.0045% | -1.44 |
| 1.50x | 10,000,000 | 99.0000% | 98.9702% | 0.0225% | -1.33 |
| 2.00x | 10,000,000 | 99.0000% | 98.9738% | 0.0316% | -0.83 |
| 3.33x | 10,000,000 | 99.0000% | 99.0293% | 0.0481% | +0.61 |
| 10.00x | 10,000,000 | 99.0000% | 98.9585% | 0.0944% | -0.44 |
| 100.00x | 10,000,000 | 99.0000% | 98.6950% | 0.3126% | -0.98 |
| 1,000.00x | 10,000,000 | 99.0000% | 99.0300% | 0.9946% | +0.03 |
| 10,000.00x | 10,000,000 | 99.0000% | 96.7000% | 3.1095% | -0.74 |
| 100,000.00x | 10,000,000 | 99.0000% | 92.0000% | 9.5916% | -0.73 |
| engine 2.50x | 300,000 | 99.0000% | 98.4467% | 0.2230% | -2.48 |

---

## 4. Keno

### 4.1 Rules

1. The board holds the numbers 1 to 40, eight across and five down. Pick 1 to 10 of them (or Auto
   Pick for ten at random), choose a risk (Classic, Low, Medium or High) and bet.
2. The server draws ten different numbers: a partial Fisher-Yates shuffle of 1 to 40 that stops
   after ten, so every ordered draw of ten is equally likely. The picks among them are the hits.
3. The bet pays the multiplier for its pick count and hits on the chosen risk's table (§4.2).
4. The page reveals the ten one at a time in the order drawn, marks each hit with a gem, and lights
   the paytable column for the hits so far. The picks stay on the board for the next game.

### 4.2 Paytables

These are Stake's Keno paytables ([stake-keno]), cell for cell. Rows are pick counts, columns are
hits, and a blank cell can't happen.

**Classic**

| Picks | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0× | 3.96× |  |  |  |  |  |  |  |  |  |
| 2 | 0× | 1.9× | 4.5× |  |  |  |  |  |  |  |  |
| 3 | 0× | 1× | 3.1× | 10.4× |  |  |  |  |  |  |  |
| 4 | 0× | 0.8× | 1.8× | 5× | 22.5× |  |  |  |  |  |  |
| 5 | 0× | 0.25× | 1.4× | 4.1× | 16.5× | 36× |  |  |  |  |  |
| 6 | 0× | 0× | 1× | 3.68× | 7× | 16.5× | 40× |  |  |  |  |
| 7 | 0× | 0× | 0.47× | 3× | 4.5× | 14× | 31× | 60× |  |  |  |
| 8 | 0× | 0× | 0× | 2.2× | 4× | 13× | 22× | 55× | 70× |  |  |
| 9 | 0× | 0× | 0× | 1.55× | 3× | 8× | 15× | 44× | 60× | 85× |  |
| 10 | 0× | 0× | 0× | 1.4× | 2.25× | 4.5× | 8× | 17× | 50× | 80× | 100× |

**Low**

| Picks | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.7× | 1.85× |  |  |  |  |  |  |  |  |  |
| 2 | 0× | 2× | 3.8× |  |  |  |  |  |  |  |  |
| 3 | 0× | 1.1× | 1.38× | 26× |  |  |  |  |  |  |  |
| 4 | 0× | 0× | 2.2× | 7.9× | 90× |  |  |  |  |  |  |
| 5 | 0× | 0× | 1.5× | 4.2× | 13× | 300× |  |  |  |  |  |
| 6 | 0× | 0× | 1.1× | 2× | 6.2× | 100× | 700× |  |  |  |  |
| 7 | 0× | 0× | 1.1× | 1.6× | 3.5× | 15× | 225× | 700× |  |  |  |
| 8 | 0× | 0× | 1.1× | 1.5× | 2× | 5.5× | 39× | 100× | 800× |  |  |
| 9 | 0× | 0× | 1.1× | 1.3× | 1.7× | 2.5× | 7.5× | 50× | 250× | 1000× |  |
| 10 | 0× | 0× | 1.1× | 1.2× | 1.3× | 1.8× | 3.5× | 13× | 50× | 250× | 1000× |

**Medium**

| Picks | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.4× | 2.75× |  |  |  |  |  |  |  |  |  |
| 2 | 0× | 1.8× | 5.1× |  |  |  |  |  |  |  |  |
| 3 | 0× | 0× | 2.8× | 50× |  |  |  |  |  |  |  |
| 4 | 0× | 0× | 1.7× | 10× | 100× |  |  |  |  |  |  |
| 5 | 0× | 0× | 1.4× | 4× | 14× | 390× |  |  |  |  |  |
| 6 | 0× | 0× | 0× | 3× | 9× | 180× | 710× |  |  |  |  |
| 7 | 0× | 0× | 0× | 2× | 7× | 30× | 400× | 800× |  |  |  |
| 8 | 0× | 0× | 0× | 2× | 4× | 11× | 67× | 400× | 900× |  |  |
| 9 | 0× | 0× | 0× | 2× | 2.5× | 5× | 15× | 100× | 500× | 1000× |  |
| 10 | 0× | 0× | 0× | 1.6× | 2× | 4× | 7× | 26× | 100× | 500× | 1000× |

**High**

| Picks | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0× | 3.96× |  |  |  |  |  |  |  |  |  |
| 2 | 0× | 0× | 17.1× |  |  |  |  |  |  |  |  |
| 3 | 0× | 0× | 0× | 81.5× |  |  |  |  |  |  |  |
| 4 | 0× | 0× | 0× | 10× | 259× |  |  |  |  |  |  |
| 5 | 0× | 0× | 0× | 4.5× | 48× | 450× |  |  |  |  |  |
| 6 | 0× | 0× | 0× | 0× | 11× | 350× | 710× |  |  |  |  |
| 7 | 0× | 0× | 0× | 0× | 7× | 90× | 400× | 800× |  |  |  |
| 8 | 0× | 0× | 0× | 0× | 5× | 20× | 270× | 600× | 900× |  |  |
| 9 | 0× | 0× | 0× | 0× | 4× | 11× | 56× | 500× | 800× | 1000× |  |
| 10 | 0× | 0× | 0× | 0× | 3.5× | 8× | 13× | 63× | 500× | 800× | 1000× |

As with Plinko, stake.com refused automated requests, so the tables come from copies that agree
cell for cell: [verify-keno], a verifier for Stake's game results whose table of hit probabilities
matches §4.3 to every digit it prints, and [vfair-keno] ("reference paytables").

### 4.3 Hit probabilities

With p picks, the draws of ten (as sets) with exactly h hits number C(p, h) · C(40 − p, 10 − h),
out of C(40, 10) = 847,660,528:

| Picks | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 75.0000% | 25.0000% |  |  |  |  |  |  |  |  |  |
| 2 | 55.7692% | 38.4615% | 5.7692% |  |  |  |  |  |  |  |  |
| 3 | 41.0931% | 44.0283% | 13.6640% | 1.2146% |  |  |  |  |  |  |  |
| 4 | 29.9869% | 44.4250% | 21.4192% | 3.9392% | 0.2298% |  |  |  |  |  |  |
| 5 | 21.6572% | 41.6484% | 27.7656% | 7.9330% | 0.9574% | 0.0383% |  |  |  |  |  |
| 6 | 15.4694% | 37.1266% | 32.1288% | 12.6929% | 2.3799% | 0.1970% | 0.00547% |  |  |  |  |
| 7 | 10.9196% | 31.8488% | 34.3967% | 17.6393% | 4.5732% | 0.5880% | 0.0338% | 0.000644% |  |  |  |
| 8 | 7.6106% | 26.4717% | 34.7441% | 22.2363% | 7.4834% | 1.3304% | 0.1188% | 0.00468% | 0.0000585% |  |  |
| 9 | 5.2323% | 21.4049% | 33.5033% | 26.0581% | 10.9444% | 2.5256% | 0.3118% | 0.0191% | 0.000494% | 0.00000366% |  |
| 10 | 3.5445% | 16.8784% | 31.0716% | 28.8200% | 14.7102% | 4.2365% | 0.6789% | 0.0575% | 0.00231% | 0.0000354% | 1.18e-7% |

### 4.4 Exact return by risk and picks

Return = Σₕ C(p, h) · C(40 − p, 10 − h) · multₕ / C(40, 10):

| Picks | Classic | Low | Medium | High |
|---:|---:|---:|---:|---:|
| 1 | 99.0000% | 98.7500% | 98.7500% | 99.0000% |
| 2 | 99.0385% | 98.8462% | 98.6538% | 98.6538% |
| 3 | 99.0182% | 98.8664% | 98.9879% | 98.9879% |
| 4 | 98.9605% | 98.9222% | 98.7827% | 98.9058% |
| 5 | 98.9858% | 98.9031% | 98.9441% | 98.8894% |
| 6 | 98.9665% | 99.0084% | 98.8347% | 98.9988% |
| 7 | 98.9815% | 98.9388% | 98.9618% | 98.9618% |
| 8 | 99.0228% | 99.0042% | 98.9236% | 98.9571% |
| 9 | 98.9753% | 99.0689% | 98.9420% | 98.9645% |
| 10 | 99.0374% | 98.7597% | 98.9743% | 99.0083% |

As reduced fractions:

| Picks | Classic | Low | Medium | High |
|---:|---|---|---|---|
| 1 | 99/100 | 79/80 | 79/80 | 99/100 |
| 2 | 103/104 | 257/260 | 513/520 | 513/520 |
| 3 | 9783/9880 | 1221/1235 | 489/494 | 489/494 |
| 4 | 476/481 | 18081/18278 | 36111/36556 | 9039/9139 |
| 5 | 144741/146224 | 36155/36556 | 18085/18278 | 18075/18278 |
| 6 | 180891/182780 | 72387/73112 | 18065/18278 | 18095/18278 |
| 7 | 3618369/3655600 | 6148569/6214520 | 153750/155363 | 153750/155363 |
| 8 | 650882/657305 | 3383949/3417986 | 130046/131461 | 130090/131461 |
| 9 | 13531853/13671944 | 33861599/34179860 | 27054595/27343888 | 13530365/13671944 |
| 10 | 1679001083/1695321056 | 8371473091/8476605280 | 419483099/423830264 | 76295861/77060048 |

SD per game, in bets:

| Picks | Classic | Low | Medium | High |
|---:|---:|---:|---:|---:|
| 1 | 1.715 | 0.498 | 1.018 | 1.715 |
| 2 | 1.255 | 1.181 | 1.332 | 3.987 |
| 3 | 1.445 | 2.833 | 5.519 | 8.927 |
| 4 | 1.465 | 4.597 | 5.154 | 12.534 |
| 5 | 2.007 | 6.094 | 7.808 | 10.012 |
| 6 | 1.688 | 6.880 | 9.669 | 16.455 |
| 7 | 1.764 | 4.694 | 8.090 | 10.348 |
| 8 | 2.064 | 1.814 | 4.002 | 10.494 |
| 9 | 1.827 | 1.156 | 2.294 | 8.033 |
| 10 | 1.359 | 0.680 | 1.437 | 3.600 |

Every table returns between 98.6538% (2 picks, Medium or High) and 99.0689% (9 picks, Low). The
pick counts do not all return the same, but they are close: within 0.42 points of each other. The
tip gives the current table's return and rings the risk that returns the most for that many picks.

### 4.5 Monte Carlo

Five million draws with the engine's own `drawNumbers`, each scored for picks {1..p} for every p
from 1 to 10 on all four tables (forty tallies; any fixed picks see the same odds, since the draw
is uniform); then 200,000 games through the whole engine. The hit counts for ten picks get a
chi-square against §4.3 (8 and more pooled): 10.55 on 8 degrees of freedom (critical 26.12 at
p = 0.001).

| Bet | N | Published | Measured | SE | z |
|---|---:|---:|---:|---:|---:|
| Classic 1 pick | 5,000,000 | 99.0000% | 99.0121% | 0.0767% | +0.16 |
| Classic 2 picks | 5,000,000 | 99.0385% | 99.0525% | 0.0561% | +0.25 |
| Classic 3 picks | 5,000,000 | 99.0182% | 98.9863% | 0.0645% | -0.50 |
| Classic 4 picks | 5,000,000 | 98.9605% | 98.9388% | 0.0656% | -0.33 |
| Classic 5 picks | 5,000,000 | 98.9858% | 98.9297% | 0.0896% | -0.63 |
| Classic 6 picks | 5,000,000 | 98.9665% | 98.9453% | 0.0754% | -0.28 |
| Classic 7 picks | 5,000,000 | 98.9815% | 98.9700% | 0.0788% | -0.15 |
| Classic 8 picks | 5,000,000 | 99.0228% | 99.0388% | 0.0922% | +0.17 |
| Classic 9 picks | 5,000,000 | 98.9753% | 98.9794% | 0.0815% | +0.05 |
| Classic 10 picks | 5,000,000 | 99.0374% | 99.0570% | 0.0607% | +0.32 |
| Low 1 pick | 5,000,000 | 98.7500% | 98.7535% | 0.0223% | +0.16 |
| Low 2 picks | 5,000,000 | 98.8462% | 98.8646% | 0.0528% | +0.35 |
| Low 3 picks | 5,000,000 | 98.8664% | 98.6828% | 0.1263% | -1.45 |
| Low 4 picks | 5,000,000 | 98.9222% | 98.9455% | 0.2058% | +0.11 |
| Low 5 picks | 5,000,000 | 98.9031% | 98.5064% | 0.2683% | -1.48 |
| Low 6 picks | 5,000,000 | 99.0084% | 98.7803% | 0.3038% | -0.75 |
| Low 7 picks | 5,000,000 | 98.9388% | 98.7269% | 0.2063% | -1.03 |
| Low 8 picks | 5,000,000 | 99.0042% | 98.9239% | 0.0793% | -1.01 |
| Low 9 picks | 5,000,000 | 99.0689% | 98.9764% | 0.0500% | -1.85 |
| Low 10 picks | 5,000,000 | 98.7597% | 98.7151% | 0.0299% | -1.49 |
| Medium 1 pick | 5,000,000 | 98.7500% | 98.7572% | 0.0455% | +0.16 |
| Medium 2 picks | 5,000,000 | 98.6538% | 98.6638% | 0.0595% | +0.17 |
| Medium 3 picks | 5,000,000 | 98.9879% | 98.6758% | 0.2461% | -1.27 |
| Medium 4 picks | 5,000,000 | 98.7827% | 98.7940% | 0.2308% | +0.05 |
| Medium 5 picks | 5,000,000 | 98.9441% | 98.4371% | 0.3436% | -1.48 |
| Medium 6 picks | 5,000,000 | 98.8347% | 98.5632% | 0.4293% | -0.63 |
| Medium 7 picks | 5,000,000 | 98.9618% | 98.6804% | 0.3577% | -0.79 |
| Medium 8 picks | 5,000,000 | 98.9236% | 98.8136% | 0.1752% | -0.63 |
| Medium 9 picks | 5,000,000 | 98.9420% | 98.8657% | 0.1002% | -0.76 |
| Medium 10 picks | 5,000,000 | 98.9743% | 98.9715% | 0.0634% | -0.04 |
| High 1 pick | 5,000,000 | 99.0000% | 99.0121% | 0.0767% | +0.16 |
| High 2 picks | 5,000,000 | 98.6538% | 98.5863% | 0.1782% | -0.38 |
| High 3 picks | 5,000,000 | 98.9879% | 98.3868% | 0.3980% | -1.51 |
| High 4 picks | 5,000,000 | 98.9058% | 99.0253% | 0.5614% | +0.21 |
| High 5 picks | 5,000,000 | 98.8894% | 98.3894% | 0.4421% | -1.13 |
| High 6 picks | 5,000,000 | 98.9988% | 98.5998% | 0.7335% | -0.54 |
| High 7 picks | 5,000,000 | 98.9618% | 98.5815% | 0.4594% | -0.83 |
| High 8 picks | 5,000,000 | 98.9571% | 98.7186% | 0.4664% | -0.51 |
| High 9 picks | 5,000,000 | 98.9645% | 98.5493% | 0.3531% | -1.18 |
| High 10 picks | 5,000,000 | 99.0083% | 99.0219% | 0.1564% | +0.09 |
| engine Classic 7 picks | 200,000 | 98.9815% | 99.2487% | 0.3945% | +0.68 |

---

## Tips and celebrations (§1-4)

With Tips on, each page says what the numbers above say, and nothing else:

- **Plinko:** the board's return, the range over all 27 boards, and that 11 rows, High returns the
  most (its two buttons are ringed).
- **Dice:** when the cent floor costs something at this bet and chance, what a win pays, the return,
  and the nearest chance that pays exactly 99% (the Win Chance field is ringed); otherwise, that the
  chance returns 99%.
- **Limbo:** every target returns exactly 99%; a higher one only makes the swings bigger.
- **Keno:** the table's return, and the risk that returns the most for this many picks (ringed).

A win is celebrated (the banner and chime from `client/src/table/celebrate.ts`) only when it pays at
least ten times the bet: nice from 10×, big from 100×, huge from 1,000×. Anything less shows on the
page alone.

## Sources for §1-4

- [stake-plinko]: Stake, Plinko: https://stake.com/casino/games/plinko
- [stake-keno]: Stake, Keno: https://stake.com/casino/games/keno
- [anson-plinko]: A. Ho, plinko-game, "a replication of Stake.com's Plinko game", multiplier tables in
  `src/lib/constants/game.ts`: https://github.com/AnsonH/plinko-game
- [audited-plinko]: M. Powers, Provably_Audited, Stake Plinko multipliers in
  `Stake_Plinko/Multipliers.py`: https://github.com/michaelpowers8/Provably_Audited
- [bc-hackathon]: `src/lib/plinko.js`: https://github.com/gngenius02/bc-hackathon
- [stake-clone]: stake-originals-clone, `src/components/PlinkoGame/constants.js`:
  https://github.com/tanh1c/stake-originals-clone
- [verify-keno]: tokenwin/verify, Stake result verifier, `kenoMultipliers` and `kenoProbabilities` in
  `src/utils.ts`: https://github.com/tokenwin/verify
- [vfair-keno]: vfair-games, `libs/game-math/src/keno/keno-reference-paytables.ts`:
  https://github.com/vfairgames/vfair-games

[stake-plinko]: https://stake.com/casino/games/plinko
[stake-keno]: https://stake.com/casino/games/keno
[anson-plinko]: https://github.com/AnsonH/plinko-game
[audited-plinko]: https://github.com/michaelpowers8/Provably_Audited
[bc-hackathon]: https://github.com/gngenius02/bc-hackathon
[stake-clone]: https://github.com/tanh1c/stake-originals-clone
[verify-keno]: https://github.com/tokenwin/verify
[vfair-keno]: https://github.com/vfairgames/vfair-games
