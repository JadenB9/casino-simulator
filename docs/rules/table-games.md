# Table Game Rules and Odds

Blackjack, roulette, craps, baccarat and the Big Six wheel as this casino deals them. For each game this page lists the
house rules, every bet's payout, its house edge with a source, and the standard deviation (SD) per
bet. The Monte Carlo tests use the SD to work out how many rounds they need.

Researched 2026-09-22. Defaults follow standard Las Vegas Strip practice. Where sources disagree,
both are shown and one is picked, with the reason.

---

## 0. Conventions

- **Payout notation.** `a:b` ("a to b") is the net win on a stake of `b`, and the stake comes back
  on top. "X for 1" includes the stake, so "8 for 1" is 7:1. Casino guides mix the two styles (the
  Venetian lists "Hard Four pays 8 for 1" [21]). The engine should store `a:b` only.
- **House edge** = expected loss ÷ the initial wager. Pushes count as settled bets with a net of 0.
  This is the Wizard of Odds convention [7]. Money added after the first wager (doubles, splits,
  odds) is not in the denominator. Where a common alternative exists (ties excluded, per roll, per
  total amount wagered), both figures are given.
- **SD** = standard deviation of the net result per 1 unit of the initial wager, for one decision
  of that bet (one round, spin, coup, or one resolution of a craps bet).
- **Money.** Integer cents, whole-dollar wagers, exact payouts with no rounding. A payout `a:b` on a
  wager of `W` dollars is exact in cents when `100·W·a` is divisible by `b`. Every payout on this
  page is exact at $1 steps except the few craps bets in §3.5.
- **Monte Carlo acceptance.** For N independent decisions of one bet, SE = SD/√N. A correct engine
  passes `|measured edge − published edge| ≤ 3·SE` 99.73% of the time, whatever N is. N sets the
  test's power instead. To also catch a bug that moves the edge by δ at least 97.7% of the time,
  use `N ≥ (5·SD/δ)²`. See §5.

---

## 1. Blackjack

### 1.1 House rules

| Rule | Setting |
|---|---|
| Decks | 6 (312 cards) |
| Shuffle | Full Fisher-Yates shuffle of all 312 cards; burn 1 card after each shuffle (house procedure only, no effect on the odds) |
| Cut card / penetration | Cut card 78 cards from the back (75% penetration). When the cut card comes out, finish the round, then shuffle before the next one |
| Dealer soft 17 | Stands on all 17s (S17) |
| Hole card | American style: the dealer takes a hole card and **peeks** for blackjack when the up card is an ace or a ten-value card |
| Blackjack pays | 3:2 |
| Doubling | On any first two cards, for the full original bet, one card only |
| Double after split (DAS) | Allowed |
| Splitting | Any two cards of equal value (two ten-value cards count, e.g. J-Q), up to 4 hands in total |
| Split aces | Split once only (no resplitting aces), exactly one card each, no hitting or doubling. Ace + ten is 21, not blackjack |
| Surrender | Late (after the peek). Only on the first two cards of an unsplit hand. The player gives up half the bet |
| Insurance | Offered only when the up card is an ace, before the peek. Up to half the original bet. Pays 2:1 |
| Even money | Offered to a player blackjack against a dealer ace. Pays 1:1 at once |
| Ties | Push |

The rules text comes from [8] (Wizard of Odds rules) and Pennsylvania's published blackjack rules
[11] (insurance §633a.8, surrender §633a.9, double §633a.10, split §633a.11, payouts §633a.13).
Nevada lets each casino set these house rules. No Nevada rulebook that fixes them was found, so
Pennsylvania's code serves as the regulator-written reference for procedure.

### 1.2 House edge for this rule set

The Wizard of Odds calculator [1] stores its combinatorial results for 6,912 rule combinations in a
table in the page source. The entry for this game is **0.330512%**. That entry uses these settings:
6 decks, S17, DAS, double on any two cards, split to 4 hands, no resplitting aces, no hitting split
aces, "player loses only original bet against dealer BJ" (this is the peek rule), late surrender and
3:2.

That entry is the "optimal" figure: perfect composition-dependent strategy with a reshuffle after
every hand. The page then applies two fixed 6-deck adjustments. It adds +0.0231 points for
total-dependent basic strategy dealt to a cut card, then subtracts the cut-card effect of 0.020
points to get the continuous-shuffler figure.

| Source | Strategy / dealing | House edge |
|---|---|---|
| Wizard of Odds calculator [1] | Optimal (composition-dependent), reshuffled every hand | 0.3305% |
| Wizard of Odds calculator [1] | Total-dependent basic strategy, continuous shuffler (fresh shoe each round) | **0.3336%** |
| Wizard of Odds calculator [1] | Total-dependent basic strategy, cut card | **0.3536%** |
| BlackjackInfo strategy engine [3] | "Estimated house edge" for 6D S17 DA2 DAS LS peek (split and resplit assumptions not stated) | 0.36% |
| Snyder, Las Vegas Advisor [4] | Additive rule effects: 6-deck base 0.54% − DAS 0.14% − late surrender 0.08% | 0.32% |
| Simulation, this rule set and the chart in §1.4 | Fresh shoe each round, 8×10⁹ rounds | 0.3333% ± 0.0013% |
| Simulation, this rule set and the chart in §1.4 | Cut card after 234 of 312 cards, one seat, 8×10⁹ rounds | 0.3578% ± 0.0013% |

The ± values are 1 SE. The simulation was a separate check. It used a Go program with the
xoshiro256** generator and unbiased bounded draws, played exactly these rules with the chart in
§1.4, and took no insurance. It lands within 0.0003 points of the Wizard's fresh-shoe figure.

**Cut-card effect.** Dealing to a fixed cut card favors the dealer. The Wizard's table puts the
effect at 0.020 points for 6 decks [5], without stating the penetration. The simulation above
measured 0.0245 ± 0.0018 points at 75% penetration with one seat. The size depends on penetration
and on how many seats are playing.

**Which number the tests use.** Use **0.354%** when the test deals a single seat to the 75% cut
card, matching the game as played. Use **0.334%** when the test deals every round from a fresh
shoe. The simulated cut-card figure is 0.004 points off the published one. That gap stays under
1 SE for any run shorter than 5×10⁸ rounds.

The brief's "~0.3%" is close. The often-quoted 0.26–0.28% "liberal Strip" figure assumes
resplitting aces is allowed, which is worth about 0.07 points [1], [6].

Nearby rule sets from the same calculator [1], for when a rule becomes a table option:

| Variation of this game | Optimal | Basic strategy, fresh shoe | Basic strategy, cut card |
|---|---|---|---|
| This game (6D S17 DAS LS, no RSA) | 0.3305% | 0.3336% | 0.3536% |
| No surrender | 0.4031% | 0.4062% | 0.4262% |
| Resplit aces allowed | 0.2620% | 0.2651% | 0.2851% |
| Dealer hits soft 17 | 0.5274% | 0.5305% | 0.5505% |
| 8 decks | 0.3551% | 0.3571% | 0.3711% |

### 1.3 Payout table

| Bet / outcome | Pays | House edge | SD per unit | Source |
|---|---|---|---|---|
| Main bet, whole game, basic strategy | 1:1; blackjack 3:2; surrender returns ½ | 0.354% (cut card), 0.334% (fresh shoe) | 1.15 published; 1.1405 measured for this rule set | [1], [7], [6] |
| Player blackjack (natural) | 3:2 | P = 192/4043 = **4.749%** per round (fresh shoe) | – | [9] |
| Insurance | 2:1 | **7.40%** average (−23/311: only the dealer ace is known). By the player's cards: 6.80% (no tens), 7.77% (one ten), 8.74% (two tens) | 1.386 per unit insured | [10]; per-hand values calculated |
| Even money | 1:1 on a natural against a dealer ace | Takes a sure +1.000 instead of +1.039 by declining (6 decks) | 0 | calculated |
| Late surrender | Lose ½ | Chart decision, not a separate wager | – | [2] |

Insurance and even money are never correct under basic strategy [2]. The published SD figures
differ slightly by rule set. The Wizard's house-edge table gives 1.15 for "liberal Vegas rules"
[7]. Its variance appendix gives 1.142 for 6D S17 DAS LS with resplit aces [6]. The simulation
measured 1.1405 for this rule set (variance 1.3007). Use **1.15** as a safe upper bound when sizing N.

### 1.4 Basic strategy (6 decks, S17, DAS, late surrender, peek)

Both sources agree on every cell: the Wizard of Odds 4–8 deck chart and text strategy for dealer
stands on soft 17 [2], and BlackjackInfo's engine for 6D S17 DA2 DAS LS peek [3]. This is the
**total-dependent** strategy that the 0.334% and 0.354% figures assume.

Legend: **H** hit · **S** stand · **D** double, or hit if doubling isn't allowed · **Ds** double,
or stand if doubling isn't allowed · **P** split · **Rh** surrender, or hit if surrender isn't
allowed. Dealer ace = A, any ten-value card = 10.

**Order of decisions.**

1. If the hand is a pair and another split is allowed (fewer than 4 hands, and not split aces),
   use the pairs table. If it says split, split. Otherwise treat the hand as its total.
2. Otherwise, or if the pair is not split, use the hard or soft table.
3. Rh counts only on the first two cards of an unsplit hand after the peek. Otherwise hit.
4. D and Ds count only on a hand's first two cards, split hands included. Otherwise D means hit and
   Ds means stand.
5. Never take insurance or even money.

This order matches the Wizard's text rule "surrender 16 but not a pair of 8s" [2]. A pair of 8s
always splits. An unsplittable 8-8 (already 4 hands) plays as hard 16, and surrender is not
available after a split.

**Hard totals**

| Player | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| 5–8 | H | H | H | H | H | H | H | H | H | H |
| 9 | H | D | D | D | D | H | H | H | H | H |
| 10 | D | D | D | D | D | D | D | D | H | H |
| 11 | D | D | D | D | D | D | D | D | D | H |
| 12 | H | H | S | S | S | H | H | H | H | H |
| 13 | S | S | S | S | S | H | H | H | H | H |
| 14 | S | S | S | S | S | H | H | H | H | H |
| 15 | S | S | S | S | S | H | H | H | Rh | H |
| 16 | S | S | S | S | S | H | H | Rh | Rh | Rh |
| 17–21 | S | S | S | S | S | S | S | S | S | S |

**Soft totals** (an ace counted as 11)

| Player | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,2 (soft 13) | H | H | H | D | D | H | H | H | H | H |
| A,3 (soft 14) | H | H | H | D | D | H | H | H | H | H |
| A,4 (soft 15) | H | H | D | D | D | H | H | H | H | H |
| A,5 (soft 16) | H | H | D | D | D | H | H | H | H | H |
| A,6 (soft 17) | H | D | D | D | D | H | H | H | H | H |
| A,7 (soft 18) | S | Ds | Ds | Ds | Ds | S | S | H | H | H |
| A,8 (soft 19) | S | S | S | S | S | S | S | S | S | S |
| A,9 (soft 20) | S | S | S | S | S | S | S | S | S | S |

Multi-card soft hands use the row for their soft total (e.g. A-2-4 is soft 17).

**Pairs** (with double after split)

| Pair | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | A |
|---|---|---|---|---|---|---|---|---|---|---|
| A,A | P | P | P | P | P | P | P | P | P | P |
| 10,10 | S | S | S | S | S | S | S | S | S | S |
| 9,9 | P | P | P | P | P | S | P | P | S | S |
| 8,8 | P | P | P | P | P | P | P | P | P | P |
| 7,7 | P | P | P | P | P | P | H | H | H | H |
| 6,6 | P | P | P | P | P | H | H | H | H | H |
| 5,5 | D | D | D | D | D | D | D | D | H | H |
| 4,4 | H | H | H | P | P | H | H | H | H | H |
| 3,3 | P | P | P | P | P | P | H | H | H | H |
| 2,2 | P | P | P | P | P | P | H | H | H | H |

**Late surrender** (already shown as Rh above): hard 16 (not 8-8) against 9, 10, A; hard 15
against 10. Nothing else.

**Code-ready form.** Each string holds one character per dealer up card, in the order
`2 3 4 5 6 7 8 9 T A`. Codes: `H` hit, `S` stand, `D` double else hit, `B` double else stand,
`R` surrender else hit. In the pairs block, `Y` means split and `N` means play the hand as its total.

```text
HARD   5-8 HHHHHHHHHH    SOFT  A2 HHHDDHHHHH    PAIRS  AA YYYYYYYYYY
       9   HDDDDHHHHH          A3 HHHDDHHHHH           TT NNNNNNNNNN
       10  DDDDDDDDHH          A4 HHDDDHHHHH           99 YYYYYNYYNN
       11  DDDDDDDDDH          A5 HHDDDHHHHH           88 YYYYYYYYYY
       12  HHSSSHHHHH          A6 HDDDDHHHHH           77 YYYYYYNNNN
       13  SSSSSHHHHH          A7 SBBBBSSHHH           66 YYYYYNNNNN
       14  SSSSSHHHHH          A8 SSSSSSSSSS           55 NNNNNNNNNN
       15  SSSSSHHHRH          A9 SSSSSSSSSS           44 NNNYYNNNNN
       16  SSSSSHHRRR                                  33 YYYYYYNNNN
       17+ SSSSSSSSSS                                  22 YYYYYYNNNN
```

### 1.5 Edge cases (each one should have a unit test)

1. **Player blackjack vs dealer blackjack** is a push, and the stake comes back.
2. **Player blackjack vs no dealer blackjack** is paid 3:2 right after the peek, or at once if the
   up card is 2–9. A dealer 21 made later with three or more cards doesn't matter. A natural can't
   be doubled, split or surrendered.
3. **Dealer blackjack (found by the peek)** ends the round before any player decision. Every player
   hand without a natural loses exactly its original bet. Doubles, splits and surrender never happen
   against a dealer blackjack under the peek. The engine should still enforce "only the original
   wager is lost to a dealer blackjack" as an invariant, as [11] §633a.10(b) and §633a.11(d) require.
4. **Peek with a ten up.** The dealer checks for an ace underneath. No insurance is offered. If the
   dealer has blackjack, rule 3 applies.
5. **Insurance.** Offered only with an ace up, before the peek. Any whole-cent amount up to half the
   original bet. Half of a whole-dollar bet is always a whole number of cents, so the 2:1 payout is
   exact. It pays 2:1 if the hole card is a ten-value card and is settled right after the peek. It
   is separate from the main bet. A full insurance bet (half the main bet) against a dealer
   blackjack nets 0 on a non-natural hand.
6. **Even money.** Offered only on a player natural against a dealer ace. It pays 1:1 at once and
   ends the hand. It is equivalent to insuring the natural for half the bet: the result is +1
   whatever the hole card is ([11] §633a.8(e)).
7. **Late surrender** is allowed only after the peek finds no dealer blackjack. Only on the first
   two cards of an unsplit hand, and before any other action. It is not allowed after hitting,
   doubling or splitting, and not on a natural. The player loses half the bet. If the player took
   insurance and then surrenders, the two wagers settle separately ([11] §633a.9(b)).
8. **21 after a split is not blackjack.** A split ace plus a ten, or a split ten plus an ace, is 21.
   It pays 1:1 and pushes against a dealer 21 ([8]).
9. **Split aces**: split once only (a third ace can't be resplit), one card each, no hit, no double.
   The hand is finished as soon as its second card arrives.
10. **Resplitting** other pairs: allowed until the player has 4 hands. A pair that can't be split
    because of the limit plays as its total (8-8 → hard 16, hit against 7–A, no surrender).
11. **Pairs are by value.** Any two ten-value cards may be split ([8]; [11] §633a.11(a) uses K and
    10 as its example). Basic strategy never does it.
12. **Double** on the first two cards of any hand, split hands included (DAS). One more card only.
    The double amount equals the original bet. "Double for less" is legal in many casinos but is
    never better for a basic-strategy player, so the engine can offer full doubles only.
13. **Busted hands lose right away**, even if the dealer busts later. If every player hand at the
    table has busted, surrendered or been settled as a natural, the dealer turns the hole card and
    does not draw. This affects which cards are used, so it slightly changes the cut-card effect.
14. **Dealer stands on every 17**, soft 17 included (A-6, A-2-4, …). The dealer hits 16 or less.
15. **Soft totals**: an ace counts 11 unless that would bust the hand. A hand is "soft" while one ace
    is still counted as 11.
16. **Cut card reached mid-round**: finish the round, then shuffle. The engine needs a fallback in
    case the shoe could run dry mid-round, which is practically impossible with 78 cards behind the
    cut card. The fallback: reshuffle the discards (not the cards on the table) and keep dealing.
17. **Multi-seat order**: seats act from the dealer's left. Each seat finishes all its split hands
    before the next seat acts. The dealer's hand is played once, after every seat.
18. **Auto-stand on 21**: a hand that reaches 21 takes no more actions.

### 1.6 Reference numbers from the simulation (fresh shoe each round, 8×10⁹ rounds)

Distribution of the net result of one round, in units of the initial bet. This is useful for a
distribution (chi-square) test and for checking the engine's settlement code.

| Net | −8 | −7 | −6 | −5 | −4 | −3 | −2 | −1 | −0.5 | 0 |
|---|---|---|---|---|---|---|---|---|---|---|
| P | 0.00000018 | 0.00000236 | 0.00001769 | 0.00008900 | 0.00047415 | 0.00201036 | 0.04195844 | 0.40160518 | 0.04475140 | 0.08499145 |

| Net | +1 | +1.5 | +2 | +3 | +4 | +5 | +6 | +7 | +8 |
|---|---|---|---|---|---|---|---|---|---|
| P | 0.31690512 | 0.04532153 | 0.05859757 | 0.00236419 | 0.00072248 | 0.00014450 | 0.00003763 | 0.00000613 | 0.00000066 |

Per round: win 42.41%, push 8.50%, lose 49.09% (4.48% of which are surrenders). Frequencies: player
natural 4.749%, dealer natural 4.749%, both 0.217%, surrender 4.48% of rounds. Splits and doubles
are counted per action, so one round can have several: 2.78 splits and 10.38 doubles per 100
rounds. The average total amount wagered is 1.1316 initial units, which makes the loss per unit
of total action ("element of risk") 0.295%. That figure must **not** be used as the house edge.

---

## 2. Roulette

### 2.1 House rules

| Rule | American table | European table |
|---|---|---|
| Pockets | 38: 0, 00, 1–36 | 37: 0, 1–36 |
| Payouts | Standard (§2.4) | Same payouts [12] |
| Zero rule | 0 and 00 lose all outside bets | 0 loses all outside bets. No la partage or en prison by default |
| Spin | Ball spun against the wheel's rotation for at least four revolutions ([14] §617a.5). The server picks the pocket first and the animation lands on it | same |

Optional variant, off by default: la partage returns half of an even-money bet when 0 hits [15].
That cuts those bets to exactly 1/74 = 1.35% (calculated).

### 2.2 Wheels (pocket order, clockwise)

**Double-zero (American)**, clockwise, as written in [14] §617a.1(d) and matching [13] and [15]:

```text
0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 00,
27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2
```

**Single-zero (European)**, clockwise, as written in [14] §617a.1(c) and matching [13] and [15]:

```text
0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
```

**Colors.** Red = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}. Black = the
other 18 numbers. 0 and 00 are green. Both sequences above were checked by script: every number
appears once, and red and black alternate all the way round. On the American wheel, 0 and 00 sit
directly opposite each other (positions 0 and 19). Every odd number n has n+1 directly opposite it
[13]. The pockets are equally spaced ([14] §617a.1).

### 2.3 Layout geometry

- **Number grid**: 12 rows × 3 columns. Number n sits in row `r = ceil(n/3)` (1–12) and column
  `c = n − 3(r−1)` (1–3). Row 1 (1-2-3) is next to the zeros at the wheel end. Row 12 (34-35-36)
  is at the far end.
- **Zeros.** European: one 0 box across all three columns above row 1. American: two boxes, 0 on
  the column-1 side and 00 on the column-3 side, each covering half of column 2.
- **Column bets** ("2 to 1" boxes) sit past row 12. Column 1 is 1, 4, …, 34. Column 2 is 2, 5, …, 35.
  Column 3 is 3, 6, …, 36 ([14] §617a.3(e)(7); [15]).
- **Dozens** run along the long side: 1st 12 = rows 1–4, 2nd 12 = rows 5–8, 3rd 12 = rows 9–12.
- **Even-money boxes** run along the outer edge, two rows each, starting at the zero end:
  1 to 18, EVEN, RED, BLACK, ODD, 19 to 36.

Every legal inside bet, listed so the engine can use a fixed table:

| Bet | Definition | Count |
|---|---|---|
| Straight | Any single pocket | 38 / 37 |
| Split | Horizontal `(n, n+1)` with `c ≠ 3` (24), vertical `(n, n+3)` with `n ≤ 33` (33), plus zero splits. American: 0-1, 0-2, 00-2, 00-3, 0-00. European: 0-1, 0-2, 0-3 | 62 / 60 |
| Street | `(3r−2, 3r−1, 3r)` | 12 |
| Trio (three numbers with a zero) | American: 0-1-2, 0-00-2, 00-2-3 ([14] §617a.3(e)(3)). European: 0-1-2, 0-2-3 [15] | 3 / 2 |
| Corner | `(n, n+1, n+3, n+4)` with `c ≠ 3` and `n ≤ 32` | 22 |
| First four / "basket" (European only) | 0-1-2-3 | 1 |
| Top line / five-number (American only) | 0-00-1-2-3 ([14] §617a.3(e)(5)) | 1 |
| Six line | Rows r and r+1 (`3r−2 … 3r+3`), r = 1..11 | 11 |

"Basket" means different bets in different places. Some sources use it for a trio, others for the
five-number bet. The engine and UI should name bets by the numbers they cover.

### 2.4 Payout tables

House edge = (pockets − 36) ÷ pockets for every bet that covers k numbers and pays 36/k − 1. The
only exception is the American top line.

**American (double zero)**

| Bet | Covers | Pays | P(win) | House edge | SD | Source |
|---|---|---|---|---|---|---|
| Straight up | 1 | 35:1 | 2.632% | 5.263% (1/19) | 5.763 | [12], [16] |
| Split | 2 | 17:1 | 5.263% | 5.263% | 4.019 | [12] |
| Street, trio | 3 | 11:1 | 7.895% | 5.263% | 3.236 | [12], [14] |
| Corner | 4 | 8:1 | 10.526% | 5.263% | 2.762 | [12] |
| **Top line 0-00-1-2-3** | 5 | 6:1 | 13.158% | **7.895% (3/38)** | 2.366 | [12], [14] |
| Six line | 6 | 5:1 | 15.789% | 5.263% | 2.188 | [12] |
| Column, dozen | 12 | 2:1 | 31.579% | 5.263% | 1.394 | [12] |
| Red/black, odd/even, 1–18/19–36 | 18 | 1:1 | 47.368% | 5.263% | 0.9986 | [12], [16] |

**European (single zero)**

| Bet | Covers | Pays | P(win) | House edge | SD | Source |
|---|---|---|---|---|---|---|
| Straight up | 1 | 35:1 | 2.703% | 2.703% (1/37) | 5.838 | [12] |
| Split | 2 | 17:1 | 5.405% | 2.703% | 4.070 | [12] |
| Street, trio | 3 | 11:1 | 8.108% | 2.703% | 3.276 | [12], [15] |
| Corner, first four 0-1-2-3 | 4 | 8:1 | 10.811% | 2.703% | 2.795 | [12], [15] |
| Six line | 6 | 5:1 | 16.216% | 2.703% | 2.212 | [12] |
| Column, dozen | 12 | 2:1 | 32.432% | 2.703% | 1.404 | [12] |
| Red/black, odd/even, 1–18/19–36 | 18 | 1:1 | 48.649% | 2.703% | 0.9996 | [12] |

The SDs are calculated as `(k+1)·sqrt(p·(1−p))` for a bet that pays `k:1` and wins with
probability `p`. They match the Wizard's published 5.762617 and 0.998614 for double zero [16].

### 2.5 Edge cases

1. 0 and 00 lose every outside bet (red/black, odd/even, low/high, dozens, columns). 0 is neither
   odd nor even ([14] §617a.4(b); [15]).
2. The top line is the only American bet with a different edge. The European layout has no
   five-number bet, and its first four (0-1-2-3) pays 8:1 at the usual 2.70%.
3. Straight bets on 0 or 00 pay 35:1 like any other number.
4. A bet that covers several numbers wins once, whichever of its numbers hits.
5. Pick the pocket index uniformly with rejection sampling (0..37 or 0..36). Then map it to the
   wheel position from §2.2 for the animation. Don't generate a wheel angle and then read off a
   pocket.
6. Call bets (voisins, tiers and so on), la partage and en prison are out of scope.

---

## 3. Craps

### 3.1 House rules

| Rule | Setting | Source |
|---|---|---|
| Dice | Two six-sided dice, each uniform on 1–6. Store both faces, not just the sum, because hardways and hops need them | – |
| Free odds | 3-4-5x: take up to 3x the flat bet on 4/10, 4x on 5/9, 5x on 6/8. Lay up to 6x the flat bet on any point | [17] |
| Field | 3, 4, 9, 10, 11 pay 1:1; **2 pays 2:1; 12 pays 3:1** | [17] ("most casinos" in Las Vegas), [21] |
| Place | 4/10 pay 9:5, 5/9 pay 7:5, 6/8 pay 7:6 | [17], [20] §623a.5 |
| Buy | **4 and 10 only**, true odds 2:1, **5% of the bet taken only when the bet wins** | [17], [20] §623a.5(g), [22] |
| Lay (buy against) | Off by default. If turned on: all six numbers, true odds, 5% of the possible win charged up front | [17], [22] |
| Big 6 / Big 8 | 1:1 | [17] |
| Hardways | Hard 4/10 pay 7:1, hard 6/8 pay 9:1 | [17], [20], [21] |
| One-roll bets | Any 7 4:1, any craps 7:1, 2 and 12 30:1, 3 and 11 15:1, horn, C&E. Hop bets 30:1 / 15:1 are optional | [17], [20] |
| Place to lose | Not offered (not a Las Vegas bet [17]). Listed below for completeness | [17] |
| Put bets | Not offered. Pass and come bets are taken only when their own come-out roll comes next | simplification |

**Buy commission: why "4 and 10, charged on a win".** The Wizard says the commission "is usually
non-refundable" (charged up front), and that "at some casinos, the commission on the 4 and 10 is
charged only on a win" [17]. He also writes that he has never seen commission on a win for buys on
5, 6, 8 or 9 [18]. Pennsylvania's rules allow both methods and give "winning Buy Bets placed on the
4 or 10" as the example for commission on a win ([20] §623a.5(g)(3)). Forum reports name Aria,
Bellagio, Caesars properties and Station Casinos as charging on a win for 4/10 buys, and MGM
properties as charging on a win for all numbers since 2022 [22], [23]. One 2023 post there calls
commission on a win "rare" [22]. So the choice is buys on 4 and 10 with commission on a win, which
is well documented, and no buys on 5/6/8/9. With the commission paid up front, placing 5, 6, 8
or 9 is always the better bet [17].

### 3.2 Dice and puck state machine

```text
           7, 11, 2, 3, 12                        any total except n or 7
              +------+                                  +------+
              |      v                                  |      v
          +--------------------+  4,5,6,8,9,10 = n  +--------------------+
  start ->| COME-OUT, puck OFF |------------------->| POINT n, puck ON n |
          +--------------------+                    +--------------------+
              ^      ^                                  |            |
              |      +------------ n -------------------+            |
              |          point made, same shooter                    |
              +------------------------- 7 --------------------------+
                             seven-out, next shooter
```

Line-bet results on each transition:

| Puck | Roll | Pass | Don't pass | Next state |
|---|---|---|---|---|
| OFF (come-out) | 7, 11 | Win 1:1 | Lose | Come-out |
| OFF | 2, 3 | Lose | Win 1:1 | Come-out |
| OFF | 12 | Lose | Push (bar 12) | Come-out |
| OFF | 4, 5, 6, 8, 9, 10 | Point set to n | Point set to n | Point n |
| ON n | n | Win 1:1 (odds pay true odds) | Lose (with lay odds) | Come-out, same shooter |
| ON n | 7 | Lose (with odds) | Win 1:1 (lay odds pay true odds) | Come-out, next shooter |
| ON n | anything else | No decision | No decision | Point n |

Come and don't come bets follow the same rows, using their own come-out roll (the roll after
they are placed) and their own point. On a seven-out every place, buy, big 6/8, come-on-number
and working hardway bet also loses, and every lay and don't-come-on-number bet wins.

What happens on each roll:

1. Freeze the table. No bet can be added, removed or turned on or off during a roll.
2. Settle every bet against the roll, using the state **before** the roll (puck OFF or ON n):
   one-roll bets (field, props, hops); multi-roll bets (place, buy, lay, big 6/8, hardways, come
   and don't come bets already on numbers, with their odds); come and don't come bets sitting in
   the come box, which treat this roll as their own come-out; then pass and don't pass with their
   odds.
3. Move come and don't come bets from the come box to their number if the roll set one.
4. Update the puck: OFF → ON n, ON n → OFF (point made or seven-out), or no change.
5. On a seven-out, pass the dice to the next shooter (clockwise in multiplayer; cosmetic in single
   player).

**Come bets** can only be made while the puck is ON. The next roll is the come bet's own come-out.
On 7 or 11 it wins. On 2, 3 or 12 it loses. On any point number n it moves to box n, then wins if n
repeats before a 7 and loses on a 7. **Don't come** works the other way round, with 12 as a push.

### 3.3 Payout table

Edges are **per bet resolved**: one trial per win, loss or push, whatever the number of rolls.
Don't pass and don't come count the bar-12 push as a settled bet, which gives 1.364%. The per-roll
figures (e.g. place 6 at 0.46% per roll) are a different measure and should not be used in the tests.

| Bet | Pays | House edge | Exact | SD | Avg rolls | Source |
|---|---|---|---|---|---|---|
| Pass / Come | 1:1 | 1.414% | 7/495 | 1.000 | 3.38 | [17], [18], [7] |
| Don't Pass / Don't Come, bar 12 | 1:1, 12 on the come-out pushes | 1.364% (ties counted); 1.403% (ties excluded) | 3/220; 27/1925 | 0.986 | 3.38 (3.47 if a bar-12 push leaves the bet up) | [17], [18], [7] |
| Take odds on 4/10 | 2:1 | 0 | 0 | 1.414 | 4.00 | [17], [7] |
| Take odds on 5/9 | 3:2 | 0 | 0 | 1.225 | 3.60 | [17], [7] |
| Take odds on 6/8 | 6:5 | 0 | 0 | 1.095 | 3.27 | [17], [7] |
| Lay odds on 4/10 | 1:2 | 0 | 0 | 0.707 | 4.00 | [17], [20] §623a.6 |
| Lay odds on 5/9 | 2:3 | 0 | 0 | 0.816 | 3.60 | [17] |
| Lay odds on 6/8 | 5:6 | 0 | 0 | 0.913 | 3.27 | [17] |
| Pass + full 3-4-5x odds | – | 1.414% per flat unit; **0.374% of total wagered** | – | 4.9156 per flat unit | – | [17], [19] |
| Don't pass + full 6x lay | – | 1.364% per flat unit; **0.273% of total wagered** | – | 4.9128 per flat unit | – | [17], [19] |
| Place 4/10 | 9:5 | 6.667% | 1/15 | 1.320 | 4.00 | [17], [18], [7] |
| Place 5/9 | 7:5 | 4.000% | 1/25 | 1.176 | 3.60 | [17], [18], [7] |
| Place 6/8 | 7:6 | 1.515% | 1/66 | 1.079 | 3.27 | [17], [18], [7] |
| **Buy 4/10, commission on a win** | 2:1 less 5% of the bet (39:20) | **1.667%** | 1/60 | 1.391 | 4.00 | [17], [18] |
| Buy 4/10, commission up front | 39:21 on bet + commission | 4.762% | 1/21 | 1.347 | 4.00 | [17], [18] |
| Buy 5/9 or 6/8, commission up front (not offered) | 29:21, 23:21 | 4.762% | 1/21 | 1.166 / 1.043 | – | [18] |
| Buy 5/9 or 6/8, commission on a win (not offered) | 29:20, 23:20 | 2.000% / 2.273% | 1/50, 1/44 | 1.200 / 1.071 | – | [18] |
| Lay 4/10, commission up front | 19:41 on lay + commission | 2.439% | 1/41 | 0.690 | 4.00 | [17], [18] |
| Lay 5/9, commission up front | 19:31 | 3.226% | 1/31 | 0.790 | 3.60 | [17], [18] |
| Lay 6/8, commission up front | 19:25 | 4.000% | 1/25 | 0.876 | 3.27 | [17], [18] |
| Lay 4/10, 5/9, 6/8, commission on a win (variant) | 19:40, 19:30, 19:24 | 1.667% / 2.000% / 2.273% | 1/60, 1/50, 1/44 | 0.695 / 0.800 / 0.892 | – | [18] |
| Place to lose 4/10, 5/9, 6/8 (not offered) | 5:11, 5:8, 4:5 | 3.030% / 2.500% / 1.818% | 1/33, 1/40, 1/55 | 0.686 / 0.796 / 0.896 | – | [17], [20] §623a.5 |
| Big 6 / Big 8 | 1:1 | 9.091% | 1/11 | 0.996 | 3.27 | [17], [7] |
| **Field (2 pays 2:1, 12 pays 3:1)** | 1:1 / 2:1 / 3:1 | **2.778%** | 1/36 | 1.142 | 1 | [17], [7] |
| Field (2 and 12 both pay 2:1) | 1:1 / 2:1 | 5.556% | 1/18 | 1.079 | 1 | [17], [7] |
| Hard 4 / Hard 10 | 7:1 | 11.111% | 1/9 | 2.514 | 4.00 | [17], [18], [7] |
| Hard 6 / Hard 8 | 9:1 | 9.091% | 1/11 | 2.875 | 3.27 | [17], [18], [7] |
| Any 7 | 4:1 | 16.667% | 1/6 | 1.863 | 1 | [17], [7] |
| Any craps (2, 3, 12) | 7:1 | 11.111% | 1/9 | 2.514 | 1 | [17], [7] |
| 2 (aces) or 12 (boxcars) | 30:1 | 13.889% | 5/36 | 5.094 | 1 | [17], [7] |
| 3 (ace-deuce) or 11 (yo) | 15:1 | 11.111% | 1/9 | 3.665 | 1 | [17], [7] |
| Horn (1 unit each on 2, 3, 11, 12) | Each part at its own odds | 12.500% of the whole bet | 1/8 | 2.085 per unit | 1 | [17], [20] §623a.5(c) |
| C&E (half any craps, half 11) | Same as 3:1 on craps, 7:1 on 11, per total bet | 11.111% | 1/9 | 2.132 per unit | 1 | [20] §623a.5(b) |
| Hop, hard (e.g. 3-3), optional | 30:1 | 13.889% | 5/36 | 5.094 | 1 | [17], [20] |
| Hop, easy (e.g. 1-4), optional | 15:1 | 11.111% | 1/9 | 3.665 | 1 | [17], [20] |

Where the Wizard publishes an SD [7], the value calculated here from the exact probabilities
matches it: pass 1.00, don't pass 0.99, odds 1.41, 1.22 and 1.10, field 1.14 and 1.08, place 1.08,
1.18 and 1.32, hardways 2.51 and 2.87, any 7 1.86, 2/12 5.09, 3/11 3.66. The combined SDs
4.915632 and 4.912807 are published in [19]. Probabilities used: pass wins 244/495 and loses
251/495. Don't pass wins 949/1980, loses 244/495 and pushes 1/36. A point of n repeats before a 7
with probability 3/9, 4/10 or 5/11 for n = 4/10, 5/9 and 6/8.

### 3.4 Working or off on the come-out roll

| Bet | Default on the come-out roll | Source |
|---|---|---|
| Pass, don't pass (flat) | Settled by the come-out | [17] |
| Come / don't come flat bets already on a number | Working | [17] |
| Odds on come bets | **Off**. If the come bet is settled on a come-out, its odds are returned without payment | [17] |
| Lay odds on don't come bets | **On** | [17] |
| Place bets | **Off** | [17]; [20] §623a.3(a)(5) |
| Buy bets | **Off** | [17]; [20] §623a.3(a)(41) |
| Lay bets | **On** | [17]; [20] §623a.3(a)(42) |
| Hardways | **On** (Las Vegas practice). The player can turn them off | [17]. Pennsylvania and Atlantic City default to off ([20] §623a.3(a)(7)–(10)) |
| Big 6 / Big 8 | On (always working) | secondary source only [26] |
| Field and one-roll bets | Act on the roll they are placed for | – |

The Wizard's rule of thumb: a bet that a come-out 7 would **win** stays on, and a bet that a 7
would **lose** is turned off. Hardways are the exception, and are left on in Las Vegas [17].
Practice varies from casino to casino. An Art of Craps guide tells players to call "hardways off"
before the come-out, which implies they are on by default [27]. Every bet needs a player "on/off"
toggle anyway. The on/off status doesn't change any per-bet-resolved edge: a roll where the bet is
off simply doesn't count for it.

### 3.5 Bet sizes that keep payouts exact in cents

A whole-dollar wager W is exact when `100·W·a / b` is a whole number of cents. Only these bets need
a step larger than $1:

| Bet | Pays | Smallest exact step | Usual casino step (what to show in the UI) |
|---|---|---|---|
| Place 6/8 | 7:6 | $3 ($3 → $3.50) | $6 ($6 → $7) |
| Lay odds on 5/9 | 2:3 | $3 ($3 → $2) | $3 |
| Lay odds on 6/8 | 5:6 | $3 ($3 → $2.50) | $6 ($6 → $5) |
| Lay 4/10 (5% of the win) | 1:2 | $2 (win $1, commission $0.05) | $40 (win $20, commission $1) |
| Lay 5/9 | 2:3 | $3 (win $2, commission $0.10) | $30 |
| Lay 6/8 | 5:6 | $6 (win $5, commission $0.25) | $24 |
| Horn | per number | $4 | $4 |
| C&E (split as two bets) | per part | $2 | $2 |

All other bets are exact at $1 steps. That includes place 4/10 ($1 → $1.80), place 5/9 ($1 →
$1.40), odds 3:2 and 6:5 ($1 → $1.50, $1.20) and buy 4/10 ($1 wins $1.95). Casinos use $5 steps
for place 4/5/9/10 and odds on 6/8 because they pay in whole dollars. With cents, that is a UI
choice, not a requirement. Maximum lay odds (6x the flat bet) is always a multiple of $6, so it is
always exact.

### 3.6 Edge cases

1. **Bar 12**: a 12 on the come-out pushes don't pass and don't come, and loses pass and come.
2. **Contract bets**: pass and come flat bets can't be removed or reduced once their point is set
   ([20] §623a.4(c)). Don't pass and don't come may be removed or reduced but not put back up
   ([20] §623a.4(d)). Odds, place, buy, lay and hardway bets may be removed or turned off between
   rolls.
3. **Odds need a flat bet**: take odds only behind a pass or come bet with a point. Lay odds only
   behind a don't pass or don't come bet with a point. Enforce the 3-4-5x and 6x limits against the
   flat bet.
4. **Come-out 7 with come bets on numbers**: the flat come bets lose and their odds (off) come
   back. Don't come bets on numbers win flat plus lay odds (on).
5. **Come-out roll hitting a come bet's number**: the flat bet wins 1:1 and its odds come back
   unpaid unless the player turned them on.
6. **Point made**: pass wins and the puck goes OFF. Come bets on other numbers, place and buy bets
   stay up. Place and buy bets and come odds go off for the next come-out.
7. **Seven-out**: pass loses. Every place, buy and big 6/8 bet loses, as does every come bet on a
   number with its odds, and every working hardway. Don't pass, don't come on numbers, lay bets and
   lay odds win. Then the next shooter takes the dice.
8. **Hardways** lose on any 7 and on the "easy" way (e.g. hard 8 loses to 2-6 and 3-5). They win
   only on the pair.
9. **Field** loses on 5, 6, 7, 8. The 2 pays 2:1 and the 12 pays 3:1.
10. **Horn and C&E** are settled as their separate parts (§3.3). In a winning horn roll the other
    three parts lose.
11. **Buy commission**: 5% of the buy amount is deducted from a winning payout only. There is no
    commission on a loss, and none when the player takes the bet down.

---

## 4. Baccarat (punto banco)

### 4.1 House rules and dealing procedure

| Rule | Setting | Source |
|---|---|---|
| Decks | 8 (416 cards) | [24] |
| Card values | A = 1, 2–9 = pip value, 10/J/Q/K = 0. Hand total = sum mod 10 | [24], [25] §627a.6 |
| Burn | After the shuffle, turn the first card face up and burn that many more cards face down. 10/J/Q/K count as 10 and the ace as 1 | [24], [25] §627a.5(f) |
| Cut card | 16 cards from the bottom | [24]. Pennsylvania requires at least 14 ([25] §627a.5(d)) |
| End of shoe | When the cut card appears, finish that coup, deal **one more** coup, then shuffle | [24]; [25] §627a.9(e) |
| Deal order | Player, Banker, Player, Banker. Then a third card if needed, Player's first | [25] §627a.8, §627a.9(c) |
| Banker commission | 5% of the win, exact (no rounding up to 25¢) | [24]. [25] §627a.12(c) permits rounding, which is not used here |
| Tie | Pays 8:1. Player and Banker bets push | [24], [25] §627a.12 |
| Pair side bets | Player Pair and Banker Pair pay 11:1 | [24] |

### 4.2 Drawing rules (tableau)

1. **Natural**: if either hand totals 8 or 9 on its first two cards, both hands stand.
2. **Player**: draws a third card on 0–5 and stands on 6–7.
3. **Banker when the Player stood** (Player had 6 or 7): Banker draws on 0–5 and stands on 6–7.
4. **Banker when the Player drew**: it depends on the Banker's two-card total and the **value of
   the Player's third card** (not the Player's total). D = draw, S = stand.

| Banker total | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0, 1, 2 | D | D | D | D | D | D | D | D | D | D |
| 3 | D | D | D | D | D | D | D | D | **S** | D |
| 4 | S | S | D | D | D | D | D | D | S | S |
| 5 | S | S | S | S | D | D | D | D | S | S |
| 6 | S | S | S | S | S | S | D | D | S | S |
| 7 | S | S | S | S | S | S | S | S | S | S |

Sources: [24] and [25] §627a.10 (identical). In code:

```text
banker draws if b <= 2
             or b == 3 and p3 != 8
             or b == 4 and 2 <= p3 <= 7
             or b == 5 and 4 <= p3 <= 7
             or b == 6 and p3 in (6, 7)
```

No hand ever gets more than three cards ([25] §627a.9(d)).

### 4.3 Outcome probabilities (8 decks, from a full shoe)

Counts are over all 4,998,398,275,503,360 ordered six-card sequences. The Wizard's figures [24]
were recomputed here and match exactly.

| Outcome | Sequences | Probability |
|---|---|---|
| Banker wins | 2,292,252,566,437,888 | 0.458597 |
| Player wins | 2,230,518,282,592,256 | 0.446247 |
| Tie | 475,627,426,473,216 | 0.095156 |

### 4.4 Payout table

| Bet | Pays | House edge | Exact EV per unit | SD | Source |
|---|---|---|---|---|---|
| Banker | 1:1 less 5% (19:20) | **1.0579%** (ties counted); 1.1692% (ties excluded) | −114753351728/10847218479825 | 0.9274 | [24], [7] |
| Player | 1:1 | **1.2351%** (ties counted); 1.3650% (ties excluded) | −241149546272/19524993263685 | 0.9512 | [24], [7] |
| Tie | 8:1 | **14.3596%** | −103841353768/723147898655 | 2.6409 | [24], [7] |
| Tie at 9:1 (variant, off) | 9:1 | 4.8440% | – | 2.9343 | [24] |
| Player Pair | 11:1 | **10.3614%** | −43/415 | 3.1549 | [24] |
| Banker Pair | 11:1 | **10.3614%** | −43/415 | 3.1549 | [24] |

A pair means the hand's first two cards have the same **rank** (K-K, 10-10). J-Q is not a pair.
With 8 decks P(pair) = 13·C(32,2)/C(416,2) = 31/415 = 7.4699% [24]. The Wizard's rules text says
pairs pay "10 to 1", but its return table uses 11:1 and gives the 10.36% edge [24]. At 10:1 the edge
would be 17.83%. 11:1 is used here.

**Shoe check.** A simulation of 2×10⁹ coups dealt from the shoe measured banker 1.0578%, player
1.2352% (both ± 0.0021%), tie 14.354% ± 0.006%, and player and banker pair 10.363% and 10.373%
± 0.007%. It used 8 decks, the burn procedure above, a cut card 16 from the bottom, and one more
coup after the cut card. Unlike blackjack, baccarat shows no measurable cut-card effect, so the
full-shoe edges are also the test targets.

### 4.5 Edge cases

1. A natural (8 or 9) on either side stops all drawing. A Player 8 or 9 means the Banker never
   draws, even on 0–5. A Banker natural means the Player never draws.
2. Natural against natural: 9 beats 8, and equal totals tie.
3. When the Player stands on 6 or 7, the Banker ignores the table in §4.2 and draws on 0–5.
4. Banker 3 against a Player third card of 8 stands. Banker 6 draws only against a Player third
   card of 6 or 7.
5. A tie pushes Player and Banker bets (stake returned) and pays Tie bets 8:1.
6. Commission applies only to winning Banker bets: 5% of the win, i.e. 5 cents per dollar, which is
   always exact. It is taken when the bet is paid; there is no running commission owed.
7. Pair bets are settled on the first two cards of that hand, whoever wins the coup.
8. Cut card reached during a coup: finish it, deal one more coup, then shuffle ([25] §627a.9(e)).
   The 16 cards behind the cut card always cover two more coups (at most 6 cards each).

---

## 5. Monte Carlo test reference

Test definitions. These decide whether the published number applies.

- **Blackjack**: one trial = one round for one seat, using the chart in §1.4, no insurance and flat
  bets. Edge = −(total net) ÷ (total **initial** bets). Using total money wagered gives 0.295%
  (element of risk), not the house edge.
- **Roulette**: one trial = one spin, per bet type.
- **Craps**: one trial = one **resolution** of the bet. Place the bet, leave it up until it wins or
  loses, and count pushes (don't pass bar 12) as trials with net 0. Per-roll accounting gives
  different numbers.
- **Baccarat**: one trial = one coup. Ties count as pushes for Player and Banker. Excluding ties
  gives 1.17% and 1.36% instead.

| Bet | Published edge | SD | SE at N = 10⁷ | N to catch a bug of size δ (`(5·SD/δ)²`) |
|---|---|---|---|---|
| Blackjack, basic strategy, cut card | 0.354% [1] | 1.15 | 0.036% | Late surrender missing (δ≈0.07%): 6.7×10⁷. DAS missing (0.14%): 1.7×10⁷. Dealer hits soft 17 (0.20%): 8.3×10⁶ |
| Roulette straight up (American) | 5.263% | 5.763 | 0.182% | Pays 34:1 (δ = 2.63%): 1.2×10⁶ |
| Roulette even money (American) | 5.263% | 0.9986 | 0.032% | 00 not losing (δ = 2.63%): 3.6×10⁴ |
| Craps pass line | 1.414% | 1.000 | 0.032% | Missing a win on 11 (δ = 11.1%): trivial. Wrong point odds: under 10⁵ |
| Craps place 6 | 1.515% | 1.079 | 0.034% | Pays 1:1 (δ = 7.6%): trivial |
| Craps field | 2.778% | 1.142 | 0.036% | 12 pays 2:1 (δ = 2.78%): 4.2×10⁴ |
| Baccarat banker | 1.058% | 0.927 | 0.029% | Player stands on 5 (δ = 0.27%): 2.9×10⁶. A single wrong banker cell moves the edge only 0.0004–0.034 points, which Monte Carlo can't reliably catch. Use the exact check below |
| Baccarat tie | 14.360% | 2.641 | 0.084% | – |

- **Several assertions at once.** At 3 SE each, a correct engine fails at least one of k independent
  checks with probability `1 − 0.9973^k`, which is about 10% for k = 40. Either fix the seed so CI
  is deterministic and re-derive the results when the engine changes, or use 4 SE per check (about
  0.25% family-wide for 40 checks).
- **Rule tables need exact checks, not Monte Carlo.** A single wrong cell in the blackjack chart
  or the baccarat tableau moves the edge by thousandths of a point. Examples, calculated with an
  exact 8-deck enumeration: Banker 3 drawing against an 8 moves the Banker edge by 0.0014 points,
  Banker 5 drawing against a 3 by 0.033 points, and a Player standing on 5 by 0.27 points. So unit-test every
  chart and tableau cell. For baccarat, also assert the three combination counts in §4.3. An
  exhaustive enumeration of all ordered six-card sequences runs in about a second and reproduces
  them exactly.
- **Match the procedure to the number.** Test blackjack with a cut card against 0.354% and with a
  fresh shoe against 0.334%. Test with one seat: the cut-card effect changes with the number of
  seats.
- **Random numbers.** Cards, pockets and dice should all come from `crypto.getRandomValues` with
  rejection sampling and a Fisher-Yates shuffle. A modulo-biased draw shifts edges by amounts these
  tests can detect.

---

## 6. Where sources disagree

| Topic | Disagreement | Choice and reason |
|---|---|---|
| Blackjack house edge | 0.32% [4], 0.33%/0.35% [1], 0.36% [3] | [1]: exact combinatorial table with the dealing method stated, and confirmed by simulation within 0.0003 points |
| Blackjack SD | 1.15 [7] vs 1.142 [6] (with resplit aces) vs 1.1405 measured | Size N with 1.15 (conservative). Report measured SD from the test run |
| Cut-card effect, 6 decks | 0.020 points [5] vs 0.0245 ± 0.0018 measured at 75% | Both small. Test with a cut card against [1]'s cut-card figure |
| Hardways on the come-out | On in Las Vegas [17] vs off in PA and Atlantic City [20] | On by default (Las Vegas brief, preferred source), with a player toggle. Edge per bet resolved is the same either way |
| Buy commission | Up front is "usual" [17] vs on a win for 4/10 at many Vegas casinos [22], [23] (both methods allowed by [20]) | On a win for 4/10 only (§3.1) |
| Place-to-lose on the come-out | On [17] (author unsure) vs off [20] | Not offered |
| Field 12 | 3:1 in most Las Vegas casinos [17], [21] vs 2:1 at some casinos and in Pennsylvania [17], [20] | 3:1 (2.78%) |
| Baccarat cut card | 16 from the bottom [24] vs at least 14 [25] | 16 |
| Baccarat pair payout | Rules text "10 to 1" vs return table 11:1 in [24] | 11:1 (10.36%) |
| Big 6/8 on the come-out | Only a secondary source [26] | Always working. No effect on the per-bet edge |

---

## 7. Big Six Wheel

The money wheel: an upright wheel of 54 stops, a leather clapper at the top, and a layout with one
spot per symbol. You bet on a symbol; the dealer spins; every bet on the symbol the clapper stops on
is paid. Researched 2026-09-23; the sources for this section are listed at its end ([B1]–[B3]).

### 7.1 House rules

| Rule | This table |
|---|---|
| Wheel | 54 equal stops with a peg on every boundary and a leather clapper at the top ([B2]; [B3] §619a.1) |
| Symbols | $1 ×24, $2 ×15, $5 ×7, $10 ×4, $20 ×2, and two pictures, one each: the Star and the Crown. Real wheels carry a joker and the casino's logo [B2]; these are generic stand-ins |
| Payouts | The bills pay the number on the bill to 1. The Star and the Crown pay 40 to 1, each on its own symbol only [B1] |
| Spin | The server picks the stop first, uniformly over the 54, and the wheel is animated onto it. Every spin turns the wheel at least three times ([B3] §619a.2 asks for three) |
| Settlement | The stop the clapper comes to rest in wins ([B3] §619a.2). All spots settle at once |
| Limits | $1 to $500 on each spot, whole dollars, and at most $2,500 on the layout per player per spin |
| Single player | Place chips, press Spin. The wheel turns from "No more bets" to rest in about 10.5 seconds |
| Multiplayer | A 20 second betting window once the leader starts the table. It closes early once every connected seated player has pressed Ready (and someone has a bet down). The stop is drawn only when betting closes |

### 7.2 The wheel (stops clockwise from the Star)

```text
Star, 1, 2, 1, 5, 2, 1, 10, 1, 5, 1, 2, 1, 20, 1, 2, 1, 5, 2, 1,
10, 1, 2, 5, 1, 2, 1, Crown, 2, 1, 2, 1, 2, 1, 10, 1, 5, 1, 2, 1,
20, 1, 2, 1, 5, 2, 1, 10, 1, 2, 5, 1, 2, 1
```

The order is the one written in [B3] §619a.1, which is for a wheel with 23 × $1 and 8 × $5. Its one
$5 that stands between two $2 stops (position 29, counting the Star as 0) is a $1 here, which gives
the Las Vegas counts of [B1] and still never puts two $1 stops side by side. The Star and the Crown
sit directly opposite each other, as do the two $20s and each pair of $10s. A unit test checks the
order against [B3] stop by stop, the counts, and the neighbours.

### 7.3 Payout table

House edge = (54 − stops × (pays + 1)) ÷ 54, exactly, for every spot.

| Spot | Stops | Pays | P(win) | House edge | SD | Source |
|---|---|---|---|---|---|---|
| $1 | 24 | 1:1 | 44.444% | **11.111%** (1/9) | 0.9938 | [B1], [B2] |
| $2 | 15 | 2:1 | 27.778% | 16.667% (1/6) | 1.3437 | [B1] |
| $5 | 7 | 5:1 | 12.963% | 22.222% (2/9) | 2.0154 | [B1] |
| $10 | 4 | 10:1 | 7.407% | 18.519% (5/27) | 2.8808 | [B1] |
| $20 | 2 | 20:1 | 3.704% | 22.222% (2/9) | 3.9659 | [B1] |
| Star | 1 | 40:1 | 1.852% | **24.074%** (13/54) | 5.5275 | [B1], [B2] |
| Crown | 1 | 40:1 | 1.852% | **24.074%** (13/54) | 5.5275 | [B1], [B2] |

The $1 is the best bet on the layout and the pictures the worst. The table's Tips say so. The SDs
are `(k+1)·sqrt(p·(1−p))` for a spot that pays `k:1` and wins with probability `p`.

### 7.4 Edge cases

1. The Star and the Crown are two different bets. A Star bet loses when the Crown comes up, and the
   other way round [B1].
2. A spot wins on any of its stops: the $20 on either $20 stop.
3. Draw the stop index uniformly with rejection sampling (0..53), then turn the wheel to it. Never
   generate a wheel angle and read a stop off it.
4. Chips on the layout before "No more bets" come back to a player who leaves. After it they are
   already settled.
5. Every payout is a whole number of dollars on a whole-dollar bet, so nothing needs rounding.

### 7.5 Monte Carlo

One trial = one spin, per spot. `shared/test/bigsix.mc.test.ts` spins drawStop and returnFor (the
functions the engine settles with) ten million times on seed 20260923, then plays 200,000 spins
through the whole engine (seed 20260924). Every spot lands within 3 SE of its exact edge:

| Spot | Published | Measured (10M spins) | SE | z |
|---|---|---|---|---|
| $1 | 11.1111% | 11.1087% | 0.0314% | −0.08 |
| $2 | 16.6667% | 16.7051% | 0.0425% | +0.91 |
| $5 | 22.2222% | 22.1470% | 0.0638% | −1.18 |
| $10 | 18.5185% | 18.4921% | 0.0911% | −0.29 |
| $20 | 22.2222% | 22.2992% | 0.1254% | +0.61 |
| Star | 24.0741% | 23.9212% | 0.1750% | −0.87 |
| Crown | 24.0741% | 24.2140% | 0.1746% | +0.80 |

The 54 stops came up evenly (chi-square 62.07 over 53 degrees of freedom; the critical value at
p = 0.001 is 90.57). A $1 bet paying 2:1 or the pictures paying 45:1 would move an edge by 44 or 9
points, far past 3 SE at these sample sizes.

### 7.6 Where sources disagree

| Topic | Disagreement | Choice and reason |
|---|---|---|
| Joker and logo payout | 40 to 1 in Las Vegas [B1] vs 45 to 1 in Atlantic City [B1] and Pennsylvania [B3]. [B2]: "40 to 1 or 45 to 1, depending on local gaming regulations or the practice of the casino" | 40 to 1 (24.07%), the Las Vegas rule. The casino follows Strip rules throughout |
| Stop counts | 24 × $1 and 7 × $5 in Las Vegas [B1] vs 23 × $1 and 8 × $5 in Pennsylvania [B3] | Las Vegas counts, laid out in [B3]'s order with one $5 printed as a $1 (§7.2) |

### Sources for §7

- [B1] Wizard of Odds, "Big Six" (Las Vegas rules table: stops, pays, probability and house edge per
  bet; Atlantic City's logos pay 45 to 1). https://wizardofodds.com/games/big-six/
- [B2] Wikipedia, "Big Six wheel" (the bills and the two special symbols; "40 to 1 or 45 to 1";
  "11.1% on the $1-bill bet to more than 24% on the joker or logo (when it pays at 40 to 1)"; the
  pointer on a flexible piece of leather that rubs against the pins). https://en.wikipedia.org/wiki/Big_Six_wheel
- [B3] 58 Pa. Code Chapter 619a, Big Six Wheel (§619a.1: 54 equally spaced sections, the clockwise
  sequence, the clapper, at least 5 feet across; §619a.2: "no more bets", at least three
  revolutions, settled where the clapper comes to rest). https://www.pacodeandbulletin.gov/Display/pacode?file=%2Fsecure%2Fpacode%2Fdata%2F058%2Fchapter619a%2Fchap619atoc.html

---

## References

1. Wizard of Odds, "Blackjack House Edge Calculator" (rule-combination table in the page source, with its basic-strategy and cut-card adjustments). https://wizardofodds.com/games/blackjack/calculator/
2. Wizard of Odds, "4-Deck to 8-Deck Blackjack Strategy" (charts and text strategy, dealer stands on soft 17, surrender). https://wizardofodds.com/games/blackjack/strategy/4-decks/
3. BlackjackInfo (Ken Smith), "Blackjack Basic Strategy Engine", 6 decks, S17, double any 2, DAS, late surrender, peek. https://www.blackjackinfo.com/blackjack-basic-strategy-engine/?numdecks=6&soft17=s17&dbl=all&das=yes&surr=ls&peek=yes
4. Arnold Snyder, "The House Edge at Blackjack", Las Vegas Advisor, Gambling With an Edge, 2022-09-15. https://www.lasvegasadvisor.com/gambling-with-an-edge/the-house-edge-at-blackjack/
5. Wizard of Odds, "Cut Card Effect". https://wizardofodds.com/games/blackjack/cut-card-effect/
6. Wizard of Odds, "Variance in Blackjack" (Blackjack Appendix 4). https://wizardofodds.com/games/blackjack/variance/
7. Wizard of Odds, "What is the House Edge?" (house edge and standard deviation by game and bet). https://wizardofodds.com/gambling/house-edge/
8. Wizard of Odds, "Blackjack" (rules, rule variations). https://wizardofodds.com/games/blackjack/basics/
9. Wizard of Odds, "Ask the Wizard: Blackjack, Probability" (P(blackjack) = 192/4043 for six decks). https://wizardofodds.com/ask-the-wizard/blackjack/probability/
10. Wizard of Odds, "Ask the Wizard: Blackjack, General Questions" (insurance house edge 7.395% in a six-deck game). https://wizardofodds.com/ask-the-wizard/blackjack/general/
11. 58 Pa. Code Chapter 633a, Blackjack. https://www.pacodeandbulletin.gov/Display/pacode?file=%2Fsecure%2Fpacode%2Fdata%2F058%2Fchapter633a%2Fchap633atoc.html&d=reduce
12. Wizard of Odds, "Roulette". https://wizardofodds.com/games/roulette/basics/
13. Wizard of Odds, "Number Sequence in Roulette". https://wizardofodds.com/games/roulette/number-sequence/
14. 58 Pa. Code Chapter 617a, Roulette (wheel order §617a.1, wagers §617a.3, payout odds §617a.4, spin §617a.5). https://www.pacodeandbulletin.gov/Display/pacode?file=%2Fsecure%2Fpacode%2Fdata%2F058%2Fchapter617a%2Fchap617atoc.html
15. Wikipedia, "Roulette" (bet definitions, trio/first-four placement, la partage). https://en.wikipedia.org/wiki/Roulette
16. Wizard of Odds, "Ask the Wizard: Roulette" (double-zero SD: even money 0.998614, single number 5.762617). https://wizardofodds.com/ask-the-wizard/roulette/
17. Wizard of Odds, "Craps" (bets, edges, field, odds limits, working/off on the come-out). https://wizardofodds.com/games/craps/basics/
18. Wizard of Odds, "House Edge for all the Major Craps Bets on Both a Per Bet Made and Per Roll Basis" (Craps Appendix 2). https://wizardofodds.com/games/craps/appendix/2/
19. Wizard of Odds, "Ask the Wizard: Craps, General Questions" (SD with full 3-4-5x odds: 4.915632 pass, 4.912807 don't pass). https://wizardofodds.com/ask-the-wizard/craps/general/
20. 58 Pa. Code Chapter 623a, Craps and Mini-Craps (wagers §623a.3, removal §623a.4, payout odds and commission §623a.5, odds §623a.6). https://www.pacodeandbulletin.gov/Display/pacode?file=%2Fsecure%2Fpacode%2Fdata%2F058%2Fchapter623a%2Fchap623atoc.html
21. The Venetian Resort Las Vegas, "How to Play Craps" (field 2:1 on 2 and 3:1 on 12; hardways "8 for 1" and "10 for 1"). https://www.venetianlasvegas.com/resort/casino/table-games/craps-basic-rules.html
22. Wizard of Vegas forum, "Vig on win only Vegas craps games?" (casino reports, 2019–2023). https://wizardofvegas.com/forum/gambling/craps/32255-vig-on-win-only-vegas-craps-games/
23. Wizard of Vegas forum, "MGM No Vig Up Front" (2022–2023). https://wizardofvegas.com/forum/gambling/craps/37090-mgm-no-vig-up-front/
24. Wizard of Odds, "Baccarat" (rules, drawing table, burn and cut-card procedure, 8-deck return tables). https://wizardofodds.com/games/baccarat/basics/
25. 58 Pa. Code Chapter 627a, Minibaccarat (shuffle, burn and cut §627a.5, dealing §627a.8–9, drawing rules §627a.10, payouts §627a.12). https://pacodeandbulletin.gov/Display/pacode?d=&file=%2Fsecure%2Fpacode%2Fdata%2F058%2Fchapter627a%2Fchap627atoc.html
26. Casino News Daily, "The Big Six and Big Eight Craps Bets" ("The Big Six and Eight are always working"). https://www.casinonewsdaily.com/craps-guide/big-six-big-eight/
27. Art of Craps, "Hardways Bets in Craps" (players call "hardways off" before the come-out). https://www.artofcraps.com/craps-bets/hardways-bets/
