# Rules and Odds: Three Card Poker, Video Poker, Slots, Texas Hold'em

This document fixes the rules, paytables and math for four of the casino's games. It is written so the
server code can be built and tested directly from it: every published number has a source link, and every
number we compute ourselves comes from a small Node.js script in [`docs/math/`](../math/) that
enumerates the game exactly. Where both exist, they agree to the digits shown.

| Section | Game | Headline number |
|---|---|---|
| [1](#1-three-card-poker) | Three Card Poker (Ante/Play with 1/4/5 Ante Bonus, Pair Plus 40-30-6-3-1) | Ante house edge 3.3730% with Q-6-4 strategy; Pair Plus 7.2760% |
| [2](#2-video-poker-jacks-or-better-96) | Video poker, Jacks or Better 9/6 | 99.5439% with the hold list in 2.4 (5 coins) |
| [3](#3-slot-machines) | Slots: six machines with published reel strips | A 94.4275%, B 95.3741%, C 89.8204%, D 94.9829%, E 94.0280%, F 92.9936% |
| [4](#4-texas-holdem-no-limit-cash-game) | Texas Hold'em, no-limit, blinds, no rake | No house edge; rules follow the Poker TDA and Robert's Rules |

## 0. Conventions and test targets

- **Money.** Balances and payouts are integer cents. Table bets are whole dollars. Video poker and slots
  bet whole coins (or credits) of a fixed denomination such as $0.25, $1 or $5, and every paytable entry is
  a whole number of coins, so every payout is exact. Each machine's coin values (high-limit ones included)
  and every table's choosable limits are in [limits.md](limits.md); a table's limits never change a payout.
- **House edge** is the expected loss divided by the initial wager (for Three Card Poker, the Ante).
  **Return to player (RTP)** is 1 minus the house edge. **Element of risk** is the expected loss divided by
  the average total amount wagered in a round (it counts the Play bet too).
- **SD** is the standard deviation of the net result of one round, in units of the initial wager.
- **Monte Carlo test rule** used by the project: after `n` independent rounds, the standard error is
  `SE = SD / sqrt(n)`, and the test passes when `|measured - published| <= 3 * SE`. Use a seeded
  generator in CI so a run is reproducible; production uses `crypto.getRandomValues`.

| Game and bet | Target value | SD per round | 3 SE after 10M rounds |
|---|---|---:|---:|
| Three Card Poker, Ante and Play (Q-6-4 strategy) | -3.3730% per Ante | 1.6393 | +/- 0.156% |
| Three Card Poker, Pair Plus 40-30-6-3-1 | -7.2760% | 2.8496 | +/- 0.270% |
| Jacks or Better 9/6, 5 coins, hold list of 2.4 | 99.5439% RTP | 4.4175 | +/- 0.419% |
| Slot A "Classic Sevens" | 94.4275% RTP | 6.6640 | +/- 0.632% |
| Slot B "Neon Nights" (free spins counted in the paid spin) | 95.3741% RTP | 3.7849 | +/- 0.359% |
| Slot C "5x Wild" | 89.8204% RTP | 26.7169 | +/- 2.535% (+/- 0.80% at 100M) |
| Texas Hold'em | no house edge (no rake) | n/a | see 4.10 |

All scripts run with plain Node.js (18 or newer, no dependencies): `node three-card-poker.mjs`, and so on.
Their full source and output are reproduced in the [appendix](#appendix-scripts-and-output).

Abbreviations used for sources: **WoO** = Wizard of Odds (Michael Shackleford, wizardofodds.com);
**PA** = the Pennsylvania Code's Three Card Poker rules (58 Pa. Code chapter 649a); **NGCB** = Nevada
Gaming Control Board; **TDA** = Poker Tournament Directors Association rules; **RRP** = *Robert's Rules of
Poker*. Full links are in [Sources](#sources).

---

## 1. Three Card Poker

### 1.1 Round flow

One 52-card deck, freshly shuffled every round. Each player plays only against the dealer, and the dealer's
hand is shared by all seats.

1. The player bets an **Ante**, a **Pair Plus**, or both.
2. Every player and the dealer receive three cards; the dealer's cards are face down.
3. A player with an Ante either **folds**, losing the Ante, or **plays** by placing a **Play** bet exactly
   equal to the Ante ([WoO][tcp], [58 Pa. Code 649a.11(b)][pa11]). Under the Pennsylvania rule a player who
   folds also forfeits a Pair Plus bet ([649a.11(b)(1)][pa11]); we follow that rule. It never costs a
   correct-strategy player anything, because every Pair Plus winner (a pair or better) is always played.
4. The dealer's hand **qualifies with queen high or better**.
5. Settlement:

| Dealer hand | Player vs dealer | Ante | Play | Ante Bonus |
|---|---|---|---|---|
| Below queen high (does not qualify) | any | wins 1:1 | push | paid if straight or better |
| Qualifies | player higher | wins 1:1 | wins 1:1 | paid if straight or better |
| Qualifies | tie | push | push | paid if straight or better |
| Qualifies | dealer higher | loses | loses | paid if straight or better |
| any | player folded | loses | none | not paid |

The **Ante Bonus** is paid on the Ante "regardless of whether the player's Three Card Poker hand outranks
the dealer's hand" ([649a.12(b)][pa12]; [WoO][tcp]), but only to a player who made the Play bet.
**Pair Plus** is settled on the player's own three cards, "irrespective of whether the player's Three Card
Poker hand outranks the dealer's hand" ([649a.11(c)(4)][pa11]); anything below a pair loses.

### 1.2 Hand ranks

From highest to lowest ([58 Pa. Code 649a.6][pa6]):

1. **Straight flush**: three suited cards in sequence. A-K-Q is the highest, A-2-3 the lowest.
2. **Three of a kind**.
3. **Straight**: A-K-Q highest, A-2-3 lowest. The ace plays high, or low only in A-2-3; K-A-2 is not a
   straight.
4. **Flush**.
5. **Pair**.
6. **High card**.

A straight beats a flush and three of a kind beats a straight because, with three cards, those hands are
rarer (see 1.3). Ties are broken by the highest card not held by the other hand ([649a.6(c)][pa6]), which
works out to:

- straight flush and straight: the top card (A-2-3 counts as 3-high, the lowest);
- three of a kind: its rank;
- flush and high card: highest card, then second, then third (so Q-7-3 beats Q-6-4, [WoO][tcp]);
- pair: the pair's rank, then the odd card.

Suits never break ties. Equal hands push. A convenient score is
`category * 13^3 + tiebreak`, as used in `three-card-poker.mjs`.

### 1.3 Hand frequencies (22,100 three-card hands)

| Hand | Combinations | Probability |
|---|---:|---:|
| Straight flush | 48 | 0.002172 |
| Three of a kind | 52 | 0.002353 |
| Straight | 720 | 0.032579 |
| Flush | 1,096 | 0.049593 |
| Pair | 3,744 | 0.169412 |
| High card | 16,440 | 0.743891 |
| **Total** | **22,100** | **1** |

Published by [WoO][tcp]; reproduced exactly by `three-card-poker.mjs`.

### 1.4 Ante Bonus pay table

We use **straight 1:1, three of a kind 4:1, straight flush 5:1** (1/4/5). Wizard of Odds lists it as
table 1 and says "the vast majority of tables follow pay table #1" ([WoO][tcp]); it is Pennsylvania's
Paytable A ([649a.12(b)][pa12]).

| Table ([WoO][tcp]) | Straight | Trips | Straight flush | House edge | Element of risk |
|---|---:|---:|---:|---:|---:|
| **1 (used here)** | **1** | **4** | **5** | **3.37%** | **2.01%** |
| 2 | 1 | 3 | 4 | 3.83% | 2.28% |
| 3 | 1 | 2 | 3 | 4.28% | 2.56% |
| 4 | 1 | 3 | 5 | 3.61% | 2.16% |
| 5 | 1 | 8 | 9 | 1.56% | 0.93% |
| 6 | 1 | 10 | 12.5 | 0.33% | 0.20% |

### 1.5 Pair Plus pay tables

Pays are "to 1". House edge and hit rate (25.61% for every table) are exact over the 22,100 hands; the SD is
per unit bet.

| Straight flush | Trips | Straight | Flush | Pair | House edge (exact) | SD | Where it appears |
|---:|---:|---:|---:|---:|---:|---:|---|
| 40 | 30 | 6 | 4 | 1 | 2.32% (512/22,100) | 2.9106 | WoO table 1, the original; PA Paytable D |
| 35 | 33 | 6 | 4 | 1 | 2.70% (596/22,100) | 2.8464 | WoO table 2 |
| 40 | 25 | 6 | 4 | 1 | 3.49% (772/22,100) | 2.7972 | WoO table 3; PA Paytable E |
| 35 | 25 | 6 | 4 | 1 | 4.58% (1,012/22,100) | 2.6474 | WoO table 4; PA Paytable A |
| 50 | 30 | 6 | 3 | 1 | 5.10% (1,128/22,100) | 3.1745 | WoO table 5 |
| 40 | 30 | 5 | 4 | 1 | 5.57% (1,232/22,100) | 2.8480 | WoO table 6; PA Paytable B |
| 40 | 25 | 5 | 4 | 1 | 6.75% (1,492/22,100) | 2.7317 | WoO table 7 |
| **40** | **30** | **6** | **3** | **1** | **7.28% (1,608/22,100)** | **2.8496** | WoO table 8; PA Paytable C |

Sources: edges from [WoO][tcp], paytable letters from [649a.12(d)][pa12], SDs from `three-card-poker.mjs`.

**Chosen table: 40-30-6-3-1 (house edge 7.28%).** Wizard of Odds presents it as "the most common pay table
of the Pairplus bet" and uses it with the 1/4/5 Ante Bonus as "the most common pay tables" in his combined
analysis ([WoO][tcp]); his FAQ adds "as far as I know every casino in Vegas follows the stingier
1/3/6/30/40 pay table" ([WoO FAQ][tcpfaq]). Sources do not fully agree: the same page also says "pay table
7 is the norm" (40-25-5-4-1, 6.75%), and Caesars' own how-to-play page shows a 4:1 flush
(40-30-6-4-1) ([Caesars][caesars]). Keep the pay table as configuration so it can be switched to
40-30-6-4-1 (2.32%) with a one-line change.

### 1.6 Strategy: play Q-6-4 or better

Play (make the Play bet) with any pair or better, and with high-card hands that rank Q-6-4 or higher;
fold everything else ([WoO][tcp]). High-card hands compare card by card from the top, so:

- every A-high and K-high hand plays;
- a Q-high hand plays if its second card is 7 or higher, or if it is Q-6 with a third card of 4 or 5;
- Q-6-3, Q-6-2, Q-5-x and lower fold, and so does every J-high hand.

"If you raise on queen/6/3 you can expect to lose 1.00255 units, more than the 1 unit by folding. However
if you raise on queen/6/4 the expected loss is .993378" ([WoO][tcp]). The enumeration confirms that playing
exactly the hands at or above Q-6-4 is the optimal decision for all 22,100 player hands; the Pair Plus bet
does not change it. For comparison, copying the dealer (play any queen high) costs 3.45%, and always
playing costs 7.65% ([WoO][tcp]).

### 1.7 Ante and Play: exact results

Full enumeration of 22,100 player hands against the 18,424 dealer hands left in the deck
(407,170,400 deals), with the 1/4/5 Ante Bonus and the Q-6-4 rule. Net result is in Antes and includes the
Ante Bonus.

| Net | What happened | Combinations | Probability | Return |
|---:|---|---:|---:|---:|
| +7 | beats the dealer with a straight flush | 617,044 | 0.001515 | 0.010608 |
| +6 | beats the dealer with trips, or straight flush and dealer does not qualify | 931,972 | 0.002289 | 0.013733 |
| +5 | straight flush tie, or trips and dealer does not qualify | 289,104 | 0.000710 | 0.003550 |
| +3 | beats the dealer with a straight, or straight flush loses | 8,976,452 | 0.022046 | 0.066138 |
| +2 | beats the dealer with a flush or less, straight and dealer does not qualify, or trips lose | 91,100,696 | 0.223741 | 0.447482 |
| +1 | dealer does not qualify (flush or less), or straight ties | 80,955,780 | 0.198825 | 0.198825 |
| 0 | tie with a flush or less | 249,216 | 0.000612 | 0 |
| -1 | fold, or straight loses | 132,923,304 | 0.326456 | -0.326456 |
| -2 | loses with a flush or less | 91,126,832 | 0.223805 | -0.447610 |
| **Total** | | **407,170,400** | **1** | **-0.033730** |

- Expected value per Ante: **-13,733,780 / 407,170,400 = -0.033730**, a **3.3730%** house edge
  ([WoO][tcp]: 3.37%, total -0.033730).
- The player plays 67.4208% of hands, so the average total wager is 1.674208 Antes and the
  **element of risk is 2.0147%** ([WoO][tcp]: 2.01%).
- **SD per round: 1.6393 Antes** ([WoO FAQ][tcpfaq]: 1.64).
- The Ante wins 44.91%, pushes 0.06% and loses 55.03% of rounds ([WoO][tcp] gives the same figures).
- Pair Plus is independent of these decisions: 40-30-6-3-1 has EV -1,608/22,100 = -0.072760 and SD 2.8496
  per unit bet.

### 1.8 Implementation notes

- Unit tests: the six frequency counts above; Q-6-4 plays and Q-6-3 folds; Q-7-2 plays; J-10-8 folds;
  A-2-3 loses to 2-3-4; K-A-2 is an ace-high hand, not a straight; the Ante Bonus is paid to a player who
  loses to the dealer; nothing is paid on a fold.
- All pays are whole multiples of the bet, so whole-dollar bets settle to whole dollars.
- Nevada's reported Three Card Poker "win percent" on the Strip (33.28% for 2025, [NGCB][ngcb]) is win
  divided by drop, the cash and markers exchanged for chips at the table, not the house edge. Do not
  compare the two.

### 1.9 Several hands (solo tables)

At a solo table a player can play one to three hands at once, from the one stack, at the player's
own position and the ones the next players would take. Each hand has its own Ante and Pair Plus
inside the table's limits, and every Ante is taken only with its Play bet still in the stack, so
each hand can be played whatever the cards. All the hands come from the round's one deck (three
cards to each hand, then the dealer's three). Each hand is played or folded on its own, one at a
time from first base, and each settles on its own, a round of its own in the stats. At a shared
table every player keeps one hand.

**Odds.** The deal is a uniformly random pick of cards, so each hand's three cards and the
dealer's three are a uniformly random six cards whatever the other hands hold, and the Q-6-4 rule
looks only at the hand's own cards: the other hands are cards nobody looks at. The edge per hand
is therefore exactly the one-hand edge, 3.373% of the Ante (Q-6-4) and 7.276% for Pair Plus. The
hands share the dealer's cards, so the Monte Carlo takes its standard error from each round's
average over its hands (shared/test/threecard-spots.mc.test.ts):

| Bet | Published | Measured per hand | SE | z | N |
|---|---|---|---|---|---|
| Ante and Play, Q-6-4 | 3.3730% | 3.3801% | 0.0352% | +0.20 | 10M rounds, 30M hands |
| Pair Plus | 7.2760% | 7.3423% | 0.0520% | +1.27 | the same deals |
| All three bets through the table engine, one stack (per Ante) | 10.6490% | 11.1878% | 0.5757% | +0.94 | 166,667 rounds |

---

## 2. Video poker: Jacks or Better 9/6

### 2.1 Rules

- One 52-card deck, freshly shuffled for every hand. The player bets 1 to 5 coins of $1, $5, $25 or $100 and
  is dealt five cards.
- The player holds any subset of the five (none to all) and the rest are replaced from the same shuffled
  deck. In code: shuffle all 52 once, deal positions 0-4, and fill discards from positions 5, 6, 7 and so
  on. Every unseen card is then equally likely, which is what Nevada requires of a machine that represents
  a live game: "the mathematical probability of a symbol or other element appearing in a game outcome must
  be equal to the mathematical probability of that symbol or element occurring in the live gambling game"
  ([NV Reg. 14.040(5)][nv14]).
- The final hand is paid from the table below. Pays are what the machine credits back, so a pair of jacks
  "pays 1" per coin and simply returns the bet.

### 2.2 Pay table (9/6 "full pay")

| Hand | 1 coin | 2 coins | 3 coins | 4 coins | 5 coins |
|---|---:|---:|---:|---:|---:|
| Royal flush | 250 | 500 | 750 | 1,000 | **4,000** |
| Straight flush | 50 | 100 | 150 | 200 | 250 |
| Four of a kind | 25 | 50 | 75 | 100 | 125 |
| Full house | 9 | 18 | 27 | 36 | 45 |
| Flush | 6 | 12 | 18 | 24 | 30 |
| Straight | 4 | 8 | 12 | 16 | 20 |
| Three of a kind | 3 | 6 | 9 | 12 | 15 |
| Two pair | 2 | 4 | 6 | 8 | 10 |
| Jacks or better | 1 | 2 | 3 | 4 | 5 |

The royal pays 800 per coin at 5 coins and 250 per coin otherwise ([WoO pay tables][vptables]).

| Coins bet | Strategy | Return |
|---|---|---:|
| 5 | optimal, which the hold list in 2.4 reproduces exactly | **99.5439%** ([WoO][vptables]; enumeration 99.543904%) |
| 5 | hold list in 2.4 without footnotes A-F | 99.5429% (enumeration) |
| 5 | Wizard of Odds' 16-line simple strategy | 99.46% ([WoO simple][vpsimple]; enumeration 99.459239%) |
| 1-4 | optimal for a 250-per-coin royal | 98.3735% (enumeration) |
| 1-4 | hold list in 2.4 (tuned for 5 coins) | 98.1822% (enumeration) |

For reference, other Jacks or Better tables return 98.45% (9/5), 98.39% (8/6), 97.30% (8/5), 96.15% (7/5)
and 95.00% (6/5) ([WoO pay tables][vptables]).

### 2.3 Final hands under optimal play (5 coins)

Combinations are weighted to a common denominator of 5 x C(47,5) per deal, the convention Wizard of Odds
uses; `video-poker-job96.mjs` reproduces his table to the last digit.

| Final hand | Pays (per coin) | Combinations | Probability | Return |
|---|---:|---:|---:|---:|
| Royal flush | 800 | 493,512,264 | 0.00002476 | 0.01980661 |
| Straight flush | 50 | 2,178,883,296 | 0.00010931 | 0.00546545 |
| Four of a kind | 25 | 47,093,167,764 | 0.00236255 | 0.05906364 |
| Full house | 9 | 229,475,482,596 | 0.01151221 | 0.10360987 |
| Flush | 6 | 219,554,786,160 | 0.01101451 | 0.06608707 |
| Straight | 4 | 223,837,565,784 | 0.01122937 | 0.04491747 |
| Three of a kind | 3 | 1,484,003,070,324 | 0.07444870 | 0.22334610 |
| Two pair | 2 | 2,576,946,164,148 | 0.12927890 | 0.25855780 |
| Jacks or better | 1 | 4,277,372,890,968 | 0.21458503 | 0.21458503 |
| Nothing | 0 | 10,872,274,993,896 | 0.54543467 | 0 |
| **Total** | | **19,933,230,517,200** | **1** | **0.99543904** |

**SD per hand: 4.4175** in units of the total bet ([WoO][vptables]: 4.42). A royal comes about once in
40,391 hands.

### 2.4 Hold strategy

To play a hand, find every way to hold it that appears on the list and pick the one **highest** on the
list ([WoO optimal][vpopt]). Holds that are not on the list are never correct. In code: classify each of the
32 possible holds to a line number (or "never") and take the smallest. Holds on the same line are
interchangeable: across all 2,598,960 deals, no two holds on the same line ever differ in EV.

**Terms** ([WoO optimal][vpopt])

- **High card**: J, Q, K or A.
- **Outside straight**: four consecutive ranks that either end can complete, 2-3-4-5 through 10-J-Q-K.
- **Inside straight**: four ranks inside a five-rank window that only one rank completes, such as 5-6-7-9.
  A-2-3-4 and J-Q-K-A count as inside.
- **3 to a straight flush**: three suited cards that fit inside one five-rank straight window (the ace may
  play low: A-2-3 through A-4-5). Gaps = highest rank - lowest rank - 2 (0, 1 or 2).
  - Type 1: high cards >= gaps (except the type 2 special cases).
  - Type 2: one gap and no high cards; two gaps and one high card; ace-low (A-2-3, A-2-4, A-2-5, A-3-4,
    A-3-5, A-4-5); or 2-3-4.
  - Type 3: two gaps and no high cards.
- **Penalty card**: a discard that would have helped the hold. A flush penalty is a discard of the held
  cards' suit; a straight penalty is a discard of a rank that could complete a straight with the held cards.

**The list** (EV = average return per unit bet for hands in that line, from [WoO optimal][vpopt])

| # | Hold | EV |
|---:|---|---|
| 1 | Dealt royal flush | 800.0000 |
| 2 | Dealt straight flush | 50.0000 |
| 3 | Dealt four of a kind (hold the four) | 25.0000 |
| 4 | 4 to a royal flush | 18.3617 |
| 5 | Dealt full house | 9.0000 |
| 6 | Dealt flush | 6.0000 |
| 7 | Three of a kind | 4.3025 |
| 8 | Dealt straight | 4.0000 |
| 9 | 4 to a straight flush | 3.5319 |
| 10 | Two pair | 2.5957 |
| 11 | High pair (jacks or better) | 1.5365 |
| 12 | 3 to a royal flush (footnote A) | 1.2868 |
| 13 | 4 to a flush | 1.2766 |
| 14 | Unsuited 10-J-Q-K | 0.8723 |
| 15 | Low pair (2s through 10s) | 0.8237 |
| 16 | 4 to an outside straight with 0-2 high cards | 0.6809 |
| 17 | 3 to a straight flush, type 1 | 0.6207 to 0.6429 |
| 18 | Suited Q-J (footnote B) | 0.6004 |
| 19 | 4 to an inside straight with 4 high cards (J-Q-K-A) | 0.5957 |
| 20 | Suited K-Q or K-J | 0.5821 |
| 21 | Suited A-K, A-Q or A-J | 0.5678 |
| 22 | 4 to an inside straight with 3 high cards (footnote C) | 0.5319 |
| 23 | 3 to a straight flush, type 2 | 0.5097 to 0.5227 |
| 24 | Unsuited J-Q-K | 0.5005 |
| 25 | Unsuited J-Q | 0.4980 |
| 26 | Suited 10-J (footnote D) | 0.4968 |
| 27 | 2 unsuited high cards, king highest (K-Q or K-J) | 0.4862 |
| 28 | Suited 10-Q (footnote E) | 0.4825 |
| 29 | 2 unsuited high cards, ace highest (A-K, A-Q or A-J) | 0.4743 |
| 30 | J alone | 0.4713 |
| 31 | Suited 10-K (footnote F) | 0.4682 |
| 32 | Q alone | 0.4681 |
| 33 | K alone | 0.4649 |
| 34 | A alone | 0.4640 |
| 35 | 3 to a straight flush, type 3 | 0.4431 |
| 36 | Discard everything | 0.3597 |

Never hold these ([WoO optimal][vpopt]): suited 10-A (hold the A alone), three unsuited high cards that
include an ace (hold the two lowest), and 4 to an inside straight with 0-2 high cards. Never hold a kicker
with a pair.

**Footnotes.** Wizard of Odds lists six rare exceptions ([WoO optimal][vpopt]). The exact conditions below
come from the enumeration (every misplay of the plain list falls into one of these six cases, and coding
them removes all of them). Each example gives the exact EVs.

- **A.** 3 to a royal that includes both the 10 and the ace (10-J-A, 10-Q-A, 10-K-A) loses to 4 to a
  flush when the fifth card, the off-suit one, is a 10 or one of the two royal ranks you are not holding.
  2♣ 10♣ 10♦ J♣ A♣: hold 2♣ 10♣ J♣ A♣ (1.27660), not 10♣ J♣ A♣ (1.27567).
- **B.** Suited Q-J with an off-suit K and A: hold J-Q-K-A when the fifth card is a 9 or of the Q-J suit.
  2♦ J♦ Q♦ K♣ A♣: hold J♦ Q♦ K♣ A♣ (0.59574), not J♦ Q♦ (0.58372).
- **C.** 3 to a straight flush spanning five ranks with exactly one high card (such as 7-9-J, 7-10-J or
  8-10-Q suited) beats 4 to an inside straight with 3 high cards, unless a discard fills one of the two
  missing ranks inside the straight flush draw. 7♥ 9♥ J♥ Q♦ K♣: hold 7♥ 9♥ J♥ (0.53747), not
  9♥ J♥ Q♦ K♣ (0.53191).
- **D.** Suited 10-J with an off-suit K: hold J-K instead when any discard is of the 10-J suit.
  2♦ 3♣ 10♦ J♦ K♣: hold J♦ K♣ (0.48615), not 10♦ J♦ (0.48412).
- **E.** Suited 10-Q with an off-suit A: hold Q-A instead when any discard is of the 10-Q suit.
  2♦ 3♣ 10♦ Q♦ A♣: hold Q♦ A♣ (0.47431), not 10♦ Q♦ (0.46981).
- **F.** Suited 10-K: hold the K alone when the discards include a 9 and a card of the 10-K suit.
  3♦ 6♣ 9♠ 10♣ K♣: hold K♣ (0.45977), not 10♣ K♣ (0.45822).

**Verification** (`video-poker-job96.mjs`): the list plus footnotes A-F makes the optimal play on all
2,598,960 deals. It returns 99.543904% and its final-hand counts match the 2.3 table exactly. Without the
footnotes it misplays 5,496 deals and returns 99.542919%, 0.001% less. That difference is far inside any
Monte Carlo tolerance, but the footnotes are cheap to code.

### 2.5 Tricky holds (exact EVs)

| Dealt | Correct hold | EV | Tempting alternative | EV |
|---|---|---:|---|---:|
| A♠ K♠ Q♠ J♠ 5♠ (a made flush) | A♠ K♠ Q♠ J♠ | 18.4255 | keep the flush | 6.0000 |
| 9♣ 10♥ J♥ Q♥ K♥ (a made straight) | 10♥ J♥ Q♥ K♥ | 19.5957 | keep the straight | 4.0000 |
| 9♥ 10♥ J♥ Q♥ J♦ | 9♥ 10♥ J♥ Q♥ (4 to a straight flush) | 3.6383 | J♥ J♦ | 1.5365 |
| J♣ J♦ 4♥ 4♠ 9♣ | both pairs | 2.5957 | all five | 2.0000 |
| J♥ J♠ Q♥ K♥ 2♣ | J♥ J♠ | 1.5365 | J♥ Q♥ K♥ (3 to a royal) | 1.4884 |
| K♥ Q♥ J♥ 5♥ 2♣ | K♥ Q♥ J♥ | 1.4829 | 4 to a flush | 1.3404 |
| 5♣ 5♦ 7♦ J♦ Q♦ | 5♦ 7♦ J♦ Q♦ (4 to a flush) | 1.2766 | the low pair | 0.8237 |
| 10♣ J♦ Q♥ K♠ 3♠ | 10-J-Q-K | 0.8723 | J-Q-K | 0.4857 |
| 5♣ 6♦ 7♥ 8♣ 8♠ | 8♣ 8♠ (the low pair) | 0.8237 | 5-6-7-8 (outside straight) | 0.6809 |
| J♠ Q♥ K♦ A♣ 3♠ | J-Q-K-A | 0.5957 | J-Q-K | 0.4977 |
| 10♠ J♠ A♥ 4♣ 7♦ | 10♠ J♠ | 0.5008 | J♠ A♥ | 0.4743 |
| 8♣ 9♦ J♥ Q♠ 3♣ | J♥ Q♠ | 0.4990 | 8-9-J-Q (inside, 2 high cards) | 0.4681 |
| Q♥ K♦ A♣ 4♠ 7♣ | Q♥ K♦ (drop the ace) | 0.4834 | Q♥ A♣ or K♦ A♣ | 0.4677 |
| J♣ A♦ 3♦ 5♥ 8♠ | J♣ A♦ | 0.4783 | J♣ alone | 0.4740 |

Reproduce any row with `node video-poker-job96.mjs --hand=As,Ks,Qs,Js,5s`.

### 2.6 Implementation notes

- Unit tests: every paytable line for 1-5 coins; the royal is 4,000 only at 5 coins; A-2-3-4-5 is a
  straight and J-Q-K-A-2 is not; a pair of 10s pays nothing.
- The Monte Carlo test needs an automatic strategy: code 2.4 exactly (line numbers plus footnotes) and
  compare with 99.5439%, SD 4.4175. With about 40,000 hands per royal, 10 million hands give about 250
  royals, enough for the 3 SE rule.

---

## 3. Slot machines

### 3.1 How slot math works

- **The outcome is decided at the button press.** The machine draws one random number per reel, maps each
  to a reel position, and the spin animation just shows the result: "the outcome is predestined the moment
  you press the button; the rest is just for show", and "there are no hot and cold cycles" ([WoO slot
  basics][slotbasics]).
- **Physical reels and virtual reels.** An electromechanical ("stepper") reel has 22 physical stops, usually
  symbols alternating with blanks. Inge Telnaes' 1984 patent (US 4,448,419, later assigned to IGT) added a
  lookup table between the random number and the reel: each stop's number is "entered one or more times
  to control the payout odds of each particular stopping position being selected thereby enabling any
  odds to be set without changing the physical characteristics of the machine" ([patent
  abstract][telnaes]). IGT's Red White & Blue maps 64 virtual stops onto 22 physical stops per reel, and
  half of each 64 are blanks ([WoO appendix 6][rwb]). A Double Strike was modelled with 128 virtual stops
  per reel ([WoO appendix 1][app1]).
- **PAR sheet.** The manufacturer's "paytable and reel strip" sheet lists every reel strip, every weight
  and every pay, and the return, hit frequency and volatility that follow from them; regulators approve it
  ([Harrigan 2007][harrigan]). Sections 3.3-3.5 are our PAR sheets.
- **Return** is the sum over every winning combination of probability x pay. Because the cycle (64^3 =
  262,144 outcomes for a 64-stop, 3-reel machine) is finite, it can be enumerated exactly ([WoO fruit slot
  example][fruit]).
- **Paylines.** A line reads one symbol per reel. Classic reel machines use 1 to 5 lines; video slots show
  a 5x3 window with 9 to 50 lines. Line wins usually count left to right on adjacent reels starting at
  reel 1, only the highest win on a line is paid, and the line bet multiplies the line pay.
- **Wild** symbols substitute for others (usually not for scatters) and may multiply the win.
- **Scatter** symbols pay for how many appear anywhere in the window, times the total bet, and often start
  a feature.
- **Free spins** are extra spins at the triggering bet that cost nothing, often with a multiplier, and can
  often be retriggered.
- **Hit frequency** is the chance that a spin pays anything. **Volatility** is the SD per spin.
- **Near misses.** Weighting the blanks just above and below the top symbol makes the top symbol show up
  next to the payline far more often than on it. Nevada never banned this form, while in 1989 it did ban
  algorithms that make a "secondary decision" to display a near miss after a loss was already decided
  ([Harrigan 2007][harrigan]). **Our machines spread blank weight evenly and do not weight the stops next to
  the top symbols.**

### 3.2 Regulation and real-world returns

- **Nevada**: every device must "theoretically pay out a mathematically demonstrable percentage of all
  amounts wagered, which must not be less than 75 percent for each wager available for play on the device"
  ([Reg. 14.040(1)(a)][nv14]). The rules and odds cannot change once a game starts (14.040(2)), and a device
  "must not alter any function of the device based on the actual hold percentage" (14.040(7)): no adaptive
  payback.
- **New Jersey**: "Each slot machine game which requires a wager shall have a theoretical return to player
  (RTP) equal to or greater than 83 percent", and "slot machines shall not offer a play with odds greater
  than 100 million to 1" ([N.J.A.C. 13:69E-1.28A][nj28a]).
- **What the Strip actually holds** (Nevada Gaming Control Board, Las Vegas Strip area, 12 months ending
  December 2025; win % = win / amount played, so RTP is roughly 100% minus win %) ([NGCB][ngcb]):

| Denomination | Win % | Approx. RTP |
|---|---:|---:|
| 1 cent | 10.79% | 89.2% |
| 5 cents | 7.88% | 92.1% |
| 25 cents | 11.27% | 88.7% |
| $1 | 7.48% | 92.5% |
| $5 | 4.92% | 95.1% |
| $25 | 7.13% | 92.9% |
| $100 | 6.28% | 93.7% |
| Multi-denomination | 7.61% | 92.4% |
| All slots | 7.83% | 92.2% |

These are actual results over a year, not theoretical returns, so they are approximate. Our six machines
(89.8% to 95.4%) span about the same range as the Strip's denominations (roughly 88.7% to 95.1%) and are
far above both legal minimums.

### 3.3 Machine A: "Classic Sevens" (3 reels, 1 line, weighted virtual reels)

- **Format:** 3 reels, 22 physical stops each (11 symbols alternating with 11 blanks), **64 virtual stops per
  reel**, one center payline, 1-3 coins per spin. Pays are per coin and scale linearly, so RTP does not
  depend on coins bet. Real machines often pay a bigger top award for max coins (Red White & Blue pays
  2,400 for one coin but 10,000 for three, [WoO appendix 6][rwb]); we don't, so one RTP covers every bet.
- **Evaluation:** only the highest win on the line is paid. "Any three bars" is any mix of single, double
  and triple bars. Cherries count from reel 1: one on reel 1, cherries on reels 1 and 2, or all three
  (the same convention as [WoO's fruit slot][fruit]). Bars and cherries never combine.

| Payline | Pays per coin |
|---|---:|
| Seven Seven Seven | 1,000 |
| Triple bar x3 | 100 |
| Double bar x3 | 50 |
| Single bar x3 | 20 |
| Any three bars | 5 |
| Cherry Cherry Cherry | 20 |
| Cherry on reels 1 and 2 | 5 |
| Cherry on reel 1 | 2 |

**Reel strips and weights.** Weight = number of the 64 virtual stops that map to that physical stop.

| Stop | Reel 1 | Weight | Reel 2 | Weight | Reel 3 | Weight |
|---:|:---|---:|:---|---:|:---|---:|
| 0 | Seven | 2 | Seven | 2 | Seven | 2 |
| 1 | blank | 3 | blank | 3 | blank | 3 |
| 2 | Single bar | 4 | Double bar | 3 | Single bar | 4 |
| 3 | blank | 3 | blank | 3 | blank | 3 |
| 4 | Cherry | 4 | Cherry | 4 | Triple bar | 3 |
| 5 | blank | 2 | blank | 3 | blank | 3 |
| 6 | Double bar | 4 | Single bar | 4 | Double bar | 3 |
| 7 | blank | 3 | blank | 3 | blank | 3 |
| 8 | Single bar | 3 | Triple bar | 3 | Cherry | 3 |
| 9 | blank | 2 | blank | 3 | blank | 3 |
| 10 | Triple bar | 3 | Double bar | 3 | Single bar | 4 |
| 11 | blank | 3 | blank | 3 | blank | 3 |
| 12 | Cherry | 4 | Single bar | 3 | Double bar | 3 |
| 13 | blank | 2 | blank | 3 | blank | 3 |
| 14 | Single bar | 3 | Cherry | 4 | Triple bar | 3 |
| 15 | blank | 3 | blank | 3 | blank | 3 |
| 16 | Double bar | 3 | Double bar | 2 | Single bar | 3 |
| 17 | blank | 2 | blank | 3 | blank | 3 |
| 18 | Cherry | 4 | Single bar | 3 | Cherry | 3 |
| 19 | blank | 3 | blank | 2 | blank | 2 |
| 20 | Triple bar | 2 | Triple bar | 2 | Double bar | 2 |
| 21 | blank | 2 | blank | 2 | blank | 2 |
| **Total** | | **64** | | **64** | | **64** |

**Exact results** (all 262,144 virtual-stop combinations):

| | Value |
|---|---|
| RTP | **247,536 / 262,144 = 94.4275%** |
| Hit frequency | 61,810 / 262,144 = 23.5786% |
| SD per spin | 6.6640 (units of the amount bet) |
| Top award (three sevens) | 1 in 32,768 spins |

```text
MACHINE A - Classic Sevens (3 reels, 1 line, 64 virtual stops per reel)
Symbol weights per reel (of 64):
  7   weights  2  2  2   physical stops 1 1 1
  3B  weights  5  5  6   physical stops 2 2 2
  2B  weights  7  8  8   physical stops 2 3 3
  1B  weights 10 10 11   physical stops 3 3 3
  CH  weights 12  8  6   physical stops 3 2 2
  BL  weights 28 31 31   physical stops 11 11 11

Combination                   Pays   Count  Probability    Return
Three 7s                      1000       8   0.00003052  0.030518
Three triple bars              100     150   0.00057220  0.057220
Three double bars               50     448   0.00170898  0.085449
Three single bars               20    1100   0.00419617  0.083923
Any three bars                   5   10952   0.04177856  0.208893
Three cherries                  20     576   0.00219727  0.043945
Cherries on reels 1 and 2        5    5568   0.02124023  0.106201
Cherry on reel 1                 2   43008   0.16406250  0.328125
No win                           0  200334   0.76421356  0.000000
Total                               262144

Return to player: 247536 / 262144 = 94.4275%
Hit frequency:    61810 / 262144 = 23.5786%
Standard deviation per spin: 6.6640 (units of the amount bet)
Top award (three 7s): 1 in 32768 spins
```

### 3.4 Machine B: "Neon Nights" (5x3 video slot, 20 lines, wild, scatter free spins)

- **Format:** 5 reels x 3 rows, 20 fixed lines, 1 credit per line (total bet 20 credits of a fixed
  denomination; a 1-5 credits-per-line option scales every pay with the bet). Each reel is a 32-stop strip.
  The server draws each reel's stop `s` uniformly from 0-31, and the reel shows `strip[s]`,
  `strip[s+1]` and `strip[s+2]` (wrapping) in the top, middle and bottom rows. Cycle: 32^5 = 33,554,432.
- **Symbols:** WILD (reels 2-5 only), SCATTER (all reels), Diamond, Seven, Bell, Horseshoe, A, K, Q, J, 10.
- **Line wins:** 3, 4 or 5 of a kind on adjacent reels from reel 1, paid per credit on the line. WILD
  substitutes for every symbol except SCATTER and pays nothing on its own. Reel 1 has no WILD, so each line
  has exactly one candidate symbol. Line wins on different lines add up.
- **Scatter:** 3, 4 or 5 SCATTERs anywhere pay 2x, 10x or 50x the total bet, added to line wins. Three or
  more award **10 free spins**.
- **Free spins:** played on the same reels and lines at the triggering bet, at no cost. **All wins x3**
  (line and scatter). Three or more SCATTERs during free spins add 10 more, with no cap.

| Symbol | 3 | 4 | 5 |
|---|---:|---:|---:|
| Diamond | 50 | 200 | 1,000 |
| Seven | 30 | 100 | 500 |
| Bell | 20 | 75 | 250 |
| Horseshoe | 15 | 50 | 200 |
| A | 10 | 30 | 125 |
| K | 10 | 25 | 100 |
| Q | 5 | 20 | 100 |
| J | 5 | 15 | 75 |
| 10 | 5 | 10 | 50 |
| SCATTER (x total bet, anywhere) | 2 | 10 | 50 |

**Paylines** (row on each reel):

| Line | Reel 1 | Reel 2 | Reel 3 | Reel 4 | Reel 5 |
|---:|:---|:---|:---|:---|:---|
| 1 | middle | middle | middle | middle | middle |
| 2 | top | top | top | top | top |
| 3 | bottom | bottom | bottom | bottom | bottom |
| 4 | top | middle | bottom | middle | top |
| 5 | bottom | middle | top | middle | bottom |
| 6 | middle | top | top | top | middle |
| 7 | middle | bottom | bottom | bottom | middle |
| 8 | top | top | middle | bottom | bottom |
| 9 | bottom | bottom | middle | top | top |
| 10 | middle | bottom | middle | top | middle |
| 11 | middle | top | middle | bottom | middle |
| 12 | top | middle | middle | middle | top |
| 13 | bottom | middle | middle | middle | bottom |
| 14 | top | middle | top | middle | top |
| 15 | bottom | middle | bottom | middle | bottom |
| 16 | middle | middle | top | middle | middle |
| 17 | middle | middle | bottom | middle | middle |
| 18 | top | top | bottom | top | top |
| 19 | bottom | bottom | top | bottom | bottom |
| 20 | top | bottom | bottom | bottom | top |

**Reel strips** (stop 0-31; the window at stop `s` shows `s`, `s+1` and `s+2`):

| Stop | Reel 1 | Reel 2 | Reel 3 | Reel 4 | Reel 5 |
|---:|:---|:---|:---|:---|:---|
| 0 | Diamond | Seven | A | K | Q |
| 1 | 10 | J | Bell | 10 | Horseshoe |
| 2 | A | K | Q | Seven | 10 |
| 3 | Bell | WILD | WILD | Q | A |
| 4 | K | Q | K | WILD | Diamond |
| 5 | Q | 10 | Diamond | A | K |
| 6 | Seven | Horseshoe | 10 | Horseshoe | J |
| 7 | J | A | J | J | WILD |
| 8 | 10 | J | Horseshoe | K | Q |
| 9 | Horseshoe | Diamond | A | Bell | 10 |
| 10 | A | K | Q | Q | Bell |
| 11 | SCATTER | Q | SCATTER | 10 | A |
| 12 | K | Bell | K | Diamond | SCATTER |
| 13 | Q | SCATTER | Seven | A | K |
| 14 | Bell | J | WILD | SCATTER | Seven |
| 15 | J | 10 | 10 | J | J |
| 16 | 10 | WILD | A | WILD | Q |
| 17 | Diamond | A | Bell | K | Horseshoe |
| 18 | A | K | J | Horseshoe | 10 |
| 19 | K | Horseshoe | K | Q | A |
| 20 | Horseshoe | Q | Horseshoe | A | Bell |
| 21 | Q | Bell | Q | Bell | K |
| 22 | J | J | WILD | 10 | WILD |
| 23 | 10 | Seven | A | WILD | Q |
| 24 | Seven | K | Diamond | J | J |
| 25 | A | 10 | 10 | Seven | Diamond |
| 26 | K | WILD | K | K | 10 |
| 27 | Bell | Q | Bell | Q | A |
| 28 | Q | Diamond | J | Diamond | Seven |
| 29 | J | A | Q | A | K |
| 30 | Horseshoe | Horseshoe | Seven | Bell | Bell |
| 31 | 10 | Bell | Horseshoe | Horseshoe | Horseshoe |

**Symbol counts per reel:** WILD 0/3/3/3/2, SCATTER 1/1/1/1/1, Diamond 2 on every reel, Seven 2,
Bell 3, Horseshoe 3, A 4/3/4/4/4, K 4, Q 4, J 4/4/3/3/3, 10 5/3/3/3/4.

**Exact results**

| | Value | How |
|---|---|---|
| Line pays | 75.792074% (per line: 25,431,600 / 33,554,432) | exact, from symbol counts; the full enumeration gives the same |
| Scatter pays | 1.739681% (583,740 / 33,554,432) | exact enumeration |
| **Base game** | **77.531755%** | exact enumeration of all 33,554,432 stop combinations |
| Feature trigger | 239,058 / 33,554,432 = 0.712448% (1 in 140.36 paid spins) | exact enumeration |
| Free spins per feature | 10 / (1 - 10p) = 10.7671 | analytic |
| Average feature win | 25.04 x total bet | analytic, from the enumerated distribution |
| **Free-spin contribution** | **17.842390%** | **analytic** (closed form below) |
| **Total RTP** | **95.374145%** | base (enumeration) + feature (analytic) |
| Hit frequency (base spin pays anything) | 44.3851% (1 in 2.25) | exact enumeration |
| SD per paid spin, feature included | 3.7849 x total bet | analytic |
| SD per spin, base game only | 2.2741 x total bet | exact enumeration |
| Check: 20,000,000 simulated paid spins | 95.3565% +/- 0.0846%, -0.21 SE from exact; SD 3.7850 | simulation, seeded |

Why the line return needs only symbol counts: each reel stop is uniform, and every line reads one row per
reel, so any single line sees each reel's symbols with the same probabilities as the middle row, and the
reels are independent. The full enumeration is still needed for the scatter distribution, the hit
frequency and the SD, where lines interact.

**Free-spin closed form.** Let `W` be the total win of one spin in credits, `T` = 1 if it triggers,
`p = P(T)`, `m = 3` and `F = 10`. One free spin together with all the free spins it retriggers is worth
`A = mW + T * (A_1 + ... + A_F)`, where the `A_i` are independent copies of `A`. So

- `E[A] = m E[W] / (1 - F p)`
- `E[A^2] = (m^2 E[W^2] + 2 m F E[WT] E[A] + p F (F - 1) E[A]^2) / (1 - F p)`
- a feature of `F` spins: `E[S] = F E[A]`, `E[S^2] = F E[A^2] + F (F - 1) E[A]^2`
- a paid spin `X = W + T S`: `E[X] = E[W] + p E[S]` and `E[X^2] = E[W^2] + 2 E[WT] E[S] + p E[S^2]`

`E[W]`, `E[W^2]`, `E[WT]` and `p` all come from the base-game enumeration, so the total is exact:
RTP = `E[X] / 20` = 95.374145%.

```text
MACHINE B - Neon Nights (5x3, 20 lines, 1 credit per line, total bet 20 credits)
Base-game enumeration: 33,554,432 stop combinations in 0.3 s

Symbol counts per reel (32 stops each):
  WILD        0  3  3  3  2
  SCATTER     1  1  1  1  1
  DIAMOND     2  2  2  2  2
  SEVEN       2  2  2  2  2
  BELL        3  3  3  3  3
  HORSESHOE   3  3  3  3  3
  A           4  3  4  4  4
  K           4  4  4  4  4
  Q           4  4  4  4  4
  J           4  4  3  3  3
  10          5  3  3  3  4

Line wins (exact, from symbol counts; each line has this distribution):
  Symbol      n  Pays  Ways of 32^5  Return per line
  DIAMOND     3    50         43200         0.064373
  DIAMOND     4   200          7000         0.041723
  DIAMOND     5  1000          1000         0.029802
  SEVEN       3    30         43200         0.038624
  SEVEN       4   100          7000         0.020862
  SEVEN       5   500          1000         0.014901
  BELL        3    20         89856         0.053558
  BELL        4    75         17496         0.039107
  BELL        5   250          3240         0.024140
  HORSESHOE   3    15         89856         0.040169
  HORSESHOE   4    50         17496         0.026071
  HORSESHOE   5   200          3240         0.019312
  A           3    10        134400         0.040054
  A           4    30         30576         0.027337
  A           5   125          7056         0.026286
  K           3    10        156800         0.046730
  K           4    25         35672         0.026578
  K           5   100          8232         0.024533
  Q           3     5        156800         0.023365
  Q           4    20         35672         0.021262
  Q           5   100          8232         0.024533
  J           3     5        139776         0.020828
  J           4    15         27216         0.012167
  J           5    75          5040         0.011265
  10          3     5        149760         0.022316
  10          4    10         28080         0.008368
  10          5    50          6480         0.009656
  line return from counts:      25431600 / 33554432 = 75.792074%
  line return from enumeration: 75.792074%

Scatter pays return:           1.739681%
Base game return (lines + scatters): 77.531755%
Base game hit frequency:       44.3851%  (1 in 2.25)
Feature trigger probability:   0.712448%  (1 in 140.36 paid spins)
Expected free spins per feature: 10.7671
Expected feature win:          25.0438 x total bet
Free-spin contribution:        17.842390%  (analytic)
TOTAL RETURN TO PLAYER:        95.374145%
Standard deviation per paid spin (incl. feature): 3.7849 x total bet
Standard deviation per spin, base game only:      2.2741 x total bet
Largest single base-game spin: 2440 credits (122 x total bet), 1 way(s) in 32^5

Simulation, 20,000,000 paid spins (seeded sfc32), 4.3 s:
  measured return 95.3565% +/- 0.0846% (1 SE); SD per spin 3.7850
  features 142294 (1 in 140.6), free spins played 1531360 (10.762 per feature)
  difference from exact: -0.21 SE
```

### 3.5 Machine C: "5x Wild" (high-volatility 3-reel, multiplier wild)

- **Format:** 3 reels, 22 physical stops, **72 virtual stops per reel**, one line, 1-3 coins (linear).
  Cycle: 72^3 = 373,248.
- **5X wild:** substitutes for Sevens and all bars. Each 5X in a win multiplies it by 5, so one 5X pays x5
  and two pay x25. Three 5X pay the top award. Only the highest win on the line is paid.

| Payline | Pays per coin | With one 5X | With two 5X |
|---|---:|---:|---:|
| 5X 5X 5X | 5,000 | | |
| Seven x3 | 100 | 500 | 2,500 |
| Triple bar x3 | 40 | 200 | 1,000 |
| Double bar x3 | 25 | 125 | 625 |
| Single bar x3 | 10 | 50 | 250 |
| Any three bars | 5 | 25 | 125 |
| Two 5X with a blank (no line win) | 10 | | |
| One 5X, no line win | 2 | | |

**Reel strips and weights** (weight = virtual stops out of 72):

| Stop | Reel 1 | Weight | Reel 2 | Weight | Reel 3 | Weight |
|---:|:---|---:|:---|---:|:---|---:|
| 0 | 5X wild | 2 | 5X wild | 2 | 5X wild | 1 |
| 1 | blank | 4 | blank | 4 | blank | 5 |
| 2 | Single bar | 3 | Double bar | 2 | Single bar | 3 |
| 3 | blank | 5 | blank | 5 | blank | 4 |
| 4 | Double bar | 2 | Single bar | 3 | Triple bar | 2 |
| 5 | blank | 4 | blank | 4 | blank | 5 |
| 6 | Seven | 2 | Triple bar | 2 | Double bar | 2 |
| 7 | blank | 5 | blank | 5 | blank | 4 |
| 8 | Single bar | 3 | Single bar | 2 | Single bar | 3 |
| 9 | blank | 4 | blank | 4 | blank | 5 |
| 10 | Triple bar | 2 | Seven | 2 | Seven | 2 |
| 11 | blank | 5 | blank | 5 | blank | 4 |
| 12 | Single bar | 2 | Double bar | 2 | Single bar | 2 |
| 13 | blank | 4 | blank | 4 | blank | 5 |
| 14 | Double bar | 2 | Single bar | 2 | Double bar | 2 |
| 15 | blank | 5 | blank | 5 | blank | 4 |
| 16 | Single bar | 2 | Triple bar | 2 | Triple bar | 2 |
| 17 | blank | 4 | blank | 4 | blank | 5 |
| 18 | Triple bar | 1 | Single bar | 2 | Single bar | 2 |
| 19 | blank | 5 | blank | 5 | blank | 4 |
| 20 | Double bar | 2 | Double bar | 2 | Double bar | 2 |
| 21 | blank | 4 | blank | 4 | blank | 4 |
| **Total** | | **72** | | **72** | | **72** |

**Exact results** (all 373,248 virtual-stop combinations):

| | Value |
|---|---|
| RTP | **335,253 / 373,248 = 89.8204%** |
| Hit frequency | 32,576 / 373,248 = 8.7277% |
| SD per spin | 26.7169 (units of the amount bet), four times Machine A's |
| Top award (5X 5X 5X) | 1 in 93,312 spins |

```text
MACHINE C - 5x Wild (3 reels, 1 line, 72 virtual stops per reel)
Symbol weights per reel (of 72):
  WX  weights  2  2  1   physical stops 1 1 1
  7   weights  2  2  2   physical stops 1 1 1
  3B  weights  3  4  4   physical stops 2 2 2
  2B  weights  6  6  6   physical stops 3 3 3
  1B  weights 10  9 10   physical stops 4 4 4
  BL  weights 49 49 49   physical stops 11 11 11

Combination                     Pays   Count  Probability    Return
5X 5X 5X                        5000       4   0.00001072  0.053584
Three 7 with 2 wild             2500      16   0.00004287  0.107167
Three 3B with 2 wild            1000      30   0.00008038  0.080376
Three 2B with 2 wild             625      48   0.00012860  0.080376
Three 7 with 1 wild              500      20   0.00005358  0.026792
Three 1B with 2 wild             250      78   0.00020898  0.052244
Three 3B with 1 wild             200      68   0.00018218  0.036437
Three 2B with 1 wild             125     180   0.00048225  0.060282
Three 7                          100       8   0.00002143  0.002143
Three 1B with 1 wild              50     470   0.00125922  0.062961
Three 3B                          40      48   0.00012860  0.005144
Any three bars with 1 wild        25    1163   0.00311589  0.077897
Three 2B                          25     216   0.00057870  0.014468
Three 1B                          10     900   0.00241127  0.024113
Two 5X, no line win               10     392   0.00105024  0.010502
Any three bars                     5    6056   0.01622514  0.081126
One 5X, no line win                2   22879   0.06129705  0.122594
No win                             0  340672   0.91272291  0.000000
Total                                 373248

Return to player: 335253 / 373248 = 89.8204%
Hit frequency:    32576 / 373248 = 8.7277%
Standard deviation per spin: 26.7169 (units of the amount bet)
Top award (three 5X): 1 in 93312 spins
```

### 3.6 Implementation notes

- **Server flow:** draw each reel's virtual stop with the unbiased generator (rejection sampling, no
  modulo bias), map it to the physical stop through the expanded weight table (`virtualReel()` in the
  scripts), score the line, settle, and then send the stops to the client, which spins the reels and stops
  them left to right. The rows above and below a 3-reel payline are the neighboring physical stops.
- **Store the tables as data**, not code. The scripts export `REELS`, `STRIPS`, `LINES` and the pays, so
  unit and Monte Carlo tests can import the exact tables documented here.
- **Unit tests:** weights sum to 64 or 72; strips have 22 or 32 stops; reel 1 of B has no WILD; each paytable
  line pays as specified, including edge cases (three cherries pay 20, not 5; 5X 5X Seven pays 2,500;
  5X 5X blank pays 10; a scatter never completes a line).
- **Monte Carlo:** for B, add the whole feature's winnings into the paid spin that triggered it, as the
  formulas above do; the per-spin SD then includes the feature.
- **Money:** win (cents) = pay (coins) x coins bet x denomination (cents). For B,
  win = pay x credits per line x denomination. Progressive jackpots are out of scope.

### 3.7 Machine D: "Diamond Line" (3 reels, 1 line, doubling diamond wild)

- **Format:** 3 reels, 22 physical stops (11 symbols alternating with 11 blanks), **64 virtual stops per
  reel**, one center payline, 1-3 coins at $1, $2, $5, $25 or $100. Pays are per coin and linear, so one RTP covers
  every bet. Cycle: 64^3 = 262,144.
- **Diamond wild:** the DIAMOND substitutes for every symbol, cherries included, and each DIAMOND in a win
  doubles it: one pays x2, two pay x4. Three DIAMONDs pay the top award.
- **Cherries** pay anywhere on the line: one pays 2, two pay 5, three pay 10. A DIAMOND counts as a
  cherry, so a DIAMOND on its own pays one cherry doubled (4), and two DIAMONDs with any other symbol pay
  two cherries x4 (20) unless they make something better.
- **Evaluation:** only the highest win on the line is paid. "Any three bars" is any mix of single, double
  and triple bars.
- **No near-miss weighting:** the blanks beside the DIAMOND and the Seven weigh 3, below each reel's
  average blank weight (39/11 or 40/11).

| Payline | Pays per coin | With one diamond | With two diamonds |
|---|---:|---:|---:|
| Diamond Diamond Diamond | 1,000 | | |
| Seven x3 | 80 | 160 | 320 |
| Triple bar x3 | 40 | 80 | 160 |
| Double bar x3 | 25 | 50 | 100 |
| Single bar x3 | 10 | 20 | 40 |
| Any three bars | 5 | 10 | (two diamonds and a bar make three of that bar) |
| Three cherries | 10 | 20 | 40 |
| Any two cherries | 5 | 10 | 20 |
| Any one cherry | 2 | 4 | |

**Reel strips and weights** (weight = virtual stops out of 64):

| Stop | Reel 1 | Weight | Reel 2 | Weight | Reel 3 | Weight |
|---:|:---|---:|:---|---:|:---|---:|
| 0 | Diamond | 2 | Diamond | 2 | Diamond | 1 |
| 1 | blank | 3 | blank | 3 | blank | 3 |
| 2 | Single bar | 3 | Double bar | 3 | Single bar | 3 |
| 3 | blank | 4 | blank | 4 | blank | 4 |
| 4 | Cherry | 2 | Single bar | 3 | Triple bar | 2 |
| 5 | blank | 4 | blank | 4 | blank | 4 |
| 6 | Double bar | 3 | Triple bar | 2 | Double bar | 3 |
| 7 | blank | 4 | blank | 3 | blank | 4 |
| 8 | Single bar | 3 | Cherry | 2 | Cherry | 1 |
| 9 | blank | 3 | blank | 4 | blank | 3 |
| 10 | Seven | 2 | Single bar | 3 | Seven | 2 |
| 11 | blank | 3 | blank | 3 | blank | 3 |
| 12 | Triple bar | 2 | Seven | 2 | Single bar | 3 |
| 13 | blank | 4 | blank | 3 | blank | 4 |
| 14 | Single bar | 3 | Double bar | 2 | Double bar | 3 |
| 15 | blank | 4 | blank | 4 | blank | 4 |
| 16 | Double bar | 2 | Single bar | 3 | Triple bar | 2 |
| 17 | blank | 3 | blank | 4 | blank | 4 |
| 18 | Cherry | 1 | Triple bar | 2 | Single bar | 3 |
| 19 | blank | 4 | blank | 4 | blank | 4 |
| 20 | Triple bar | 2 | Cherry | 1 | Cherry | 1 |
| 21 | blank | 3 | blank | 3 | blank | 3 |
| **Total** | | **64** | | **64** | | **64** |

**Exact results** (all 262,144 virtual-stop combinations, through the engine's `spinDiamonds`):

| | Value |
|---|---|
| RTP | **248,992 / 262,144 = 94.9829%** |
| Hit frequency | 55,967 / 262,144 = 21.3497% |
| SD per spin | 6.0563 (units of the amount bet) |
| Top award (three diamonds) | 1 in 65,536 spins |

A lone diamond (4 per coin, a quarter of the return) and a lone cherry (2 per coin) carry half the return
between them, so this is a steady machine; the top award and the x4 wins give it its reach.

```text
MACHINE D - Diamond Line (3 reels, 1 line, 64 virtual stops per reel)
Symbol weights per reel (of 64):
  DI  weights  2  2  1   physical stops 1 1 1
  7   weights  2  2  2   physical stops 1 1 1
  3B  weights  4  4  4   physical stops 2 2 2
  2B  weights  5  5  6   physical stops 2 2 2
  1B  weights  9  9  9   physical stops 3 3 3
  CH  weights  3  3  2   physical stops 2 2 2
  BL  weights 39 39 40   physical stops 11 11 11

Combination                       Pays   Count  Probability    Return
Diamond Diamond Diamond           1000       4   0.00001526  0.015259
Three 7 with 2 diamonds            320      16   0.00006104  0.019531
Three 3B with 2 diamonds           160      32   0.00012207  0.019531
Three 7 with 1 diamond             160      20   0.00007629  0.012207
Three 2B with 2 diamonds           100      44   0.00016785  0.016785
Three 3B with 1 diamond             80      80   0.00030518  0.024414
Three 7                             80       8   0.00003052  0.002441
Three 2B with 1 diamond             50     145   0.00055313  0.027657
Three 1B with 2 diamonds            40      72   0.00027466  0.010986
Three 3B                            40      64   0.00024414  0.009766
Three cherries with 2 diamonds      40      20   0.00007629  0.003052
Three 2B                            25     150   0.00057220  0.014305
Three 1B with 1 diamond             20     405   0.00154495  0.030899
Two cherries with 2 diamonds        20     316   0.00120544  0.024109
Three cherries with 1 diamond       20      33   0.00012589  0.002518
Two cherries with 1 diamond         10    1558   0.00594330  0.059433
Any three bars with 1 diamond       10    1062   0.00405121  0.040512
Three 1B                            10     729   0.00278091  0.027809
Three cherries                      10      18   0.00006866  0.000687
Any three bars                       5    5213   0.01988602  0.099430
Two cherries                         5    1257   0.00479507  0.023975
One cherry with 1 diamond            4   16165   0.06166458  0.246658
One cherry                           2   28556   0.10893250  0.217865
No win                               0  206177   0.78650284  0.000000
Total                                   262144

Return to player: 248992 / 262144 = 94.9829%
Hit frequency:    55967 / 262144 = 21.3497%
Standard deviation per spin: 6.0563 (units of the amount bet)
Top award (three diamonds): 1 in 65536 spins
```

### 3.8 Machine E: "Lucky Cherries" (5x3 video slot, 10 lines, Cherry Wheel)

- **Format:** 5 reels x 3 rows, 10 fixed lines, 1-5 credits per line at 1, 5 or 25 cents (the total bet
  is 10 x credits x coin value; every pay scales with it). Each reel is a 30-stop strip; the server draws
  each reel's stop `s` uniformly from 0-29 and the reel shows `strip[s]`, `strip[s+1]` and `strip[s+2]`.
  Cycle: 30^5 = 24,300,000.
- **Symbols:** Seven, Bell, Melon, Grapes, Plum, Orange, Lemon, Cherry, and BONUS (one on every reel). No
  wild.
- **Line wins:** adjacent matches from reel 1, paid per credit on the line. Cherries pay from two, every
  other fruit from three. BONUS never completes a line. Line wins on different lines add up.
- **Cherry Wheel:** 3, 4 or 5 BONUS symbols anywhere spin the wheel on the top box. It has 20 equal
  segments, each equally likely and drawn after the window (so it is independent of it), clockwise from
  the pointer: 5, 10, 6, 15, 5, 10, 6, 20, 5, 12, 6, 25, 5, 10, 6, 15, 5, 12, 6, 100 (mean 14.2). The
  prize is paid in total bets, times 1, 2 or 5 for three, four or five BONUS, on top of the line wins.
- **Math:** the lines by enumeration of every window (and again from symbol counts, since every line sees
  the same distribution); the wheel in closed form from the BONUS count distribution:
  E[wheel] = sum over k of P(K = k) m(k) E[V]; for the SD,
  E[X^2] = E[W^2] + 2 sum_k E[W 1(K = k)] m(k) E[V] + sum_k P(K = k) m(k)^2 E[V^2].

| Fruit | 5 | 4 | 3 | 2 |
|---|---:|---:|---:|---:|
| Seven | 5,000 | 750 | 150 | |
| Bell | 1,000 | 250 | 60 | |
| Melon | 750 | 200 | 50 | |
| Grapes | 500 | 150 | 40 | |
| Plum | 250 | 75 | 25 | |
| Orange | 200 | 60 | 20 | |
| Lemon | 150 | 50 | 15 | |
| Cherry | 200 | 50 | 10 | 3 |

| BONUS symbols | Chance per spin | Wheel prize |
|---|---:|---|
| 3 | 0.810000% | segment x1 the total bet |
| 4 | 0.045000% | segment x2 |
| 5 | 0.001000% | segment x5 |

Lines (rows 0-2 on reels 1-5): 1 = 11111, 2 = 00000, 3 = 22222, 4 = 01210, 5 = 21012, 6 = 10001,
7 = 12221, 8 = 00122, 9 = 22100, 10 = 12101.

**Reel strips** (30 stops each):

| Stop | Reel 1 | Reel 2 | Reel 3 | Reel 4 | Reel 5 |
|---:|:---|:---|:---|:---|:---|
| 0 | Cherry | Cherry | Seven | Bell | Lemon |
| 1 | Lemon | Orange | Lemon | Orange | Plum |
| 2 | Seven | Plum | Cherry | Lemon | Bell |
| 3 | Plum | Cherry | Orange | Grapes | Orange |
| 4 | Cherry | Grapes | Grapes | Cherry | Grapes |
| 5 | Orange | Lemon | Plum | Plum | Lemon |
| 6 | Melon | Bell | Lemon | Melon | Cherry |
| 7 | Grapes | Cherry | Melon | Orange | Plum |
| 8 | Cherry | Melon | Cherry | Lemon | Melon |
| 9 | Lemon | Orange | Orange | BONUS | Orange |
| 10 | Bell | Lemon | Bell | Grapes | Seven |
| 11 | Cherry | Cherry | Grapes | Bell | Lemon |
| 12 | Plum | Plum | Lemon | Plum | Grapes |
| 13 | Orange | Seven | Plum | Cherry | Plum |
| 14 | BONUS | Grapes | Cherry | Orange | Bell |
| 15 | Cherry | Cherry | Orange | Lemon | Orange |
| 16 | Grapes | Orange | BONUS | Melon | Cherry |
| 17 | Lemon | Melon | Melon | Seven | Lemon |
| 18 | Melon | Cherry | Lemon | Grapes | Melon |
| 19 | Cherry | Lemon | Grapes | Plum | Plum |
| 20 | Plum | BONUS | Cherry | Orange | Grapes |
| 21 | Orange | Plum | Plum | Cherry | BONUS |
| 22 | Bell | Cherry | Orange | Bell | Orange |
| 23 | Cherry | Bell | Bell | Lemon | Bell |
| 24 | Grapes | Grapes | Lemon | Melon | Lemon |
| 25 | Lemon | Orange | Grapes | Grapes | Plum |
| 26 | Cherry | Cherry | Cherry | Orange | Cherry |
| 27 | Melon | Lemon | Orange | Plum | Grapes |
| 28 | Orange | Melon | Melon | Cherry | Orange |
| 29 | Plum | Plum | Plum | Lemon | Melon |

**Exact results:**

| | Value |
|---|---|
| RTP | **94.027955%** (lines 81.176955%, wheel 12.851000%) |
| Wheel spins | 1 in 116.82 paid spins |
| Hit frequency (anything paid) | 56.2234% |
| SD per paid spin (wheel included) | 3.4151 x the total bet |
| Largest line win | 5,025 credits (502.5 x the total bet), 1 way in 30^5 |

```text
MACHINE E - Lucky Cherries (5x3, 10 lines, Cherry Wheel)
Enumerated 24,300,000 windows in 2527 ms

Symbol counts per reel (of 30):
  SEVEN    1  1  1  1  1
  BELL     2  2  2  3  3
  MELON    3  3  3  3  3
  GRAPES   3  3  4  4  4
  PLUM     4  4  4  4  5
  ORANGE   4  4  5  5  5
  LEMON    4  4  5  5  5
  CHERRY   8  8  5  4  3
  BONUS    1  1  1  1  1

Line pays from counts (per line, per credit):
  Symbol  n  Pays         Ways       Return
  SEVEN   3   150          870     0.005370
  SEVEN   4   750           29     0.000895
  SEVEN   5  5000            1     0.000206
  BELL    3    60         6480     0.016000
  BELL    4   250          648     0.006667
  BELL    5  1000           72     0.002963
  MELON   3    50        21870     0.045000
  MELON   4   200         2187     0.018000
  MELON   5   750          243     0.007500
  GRAPES  3    40        28080     0.046222
  GRAPES  4   150         3744     0.023111
  GRAPES  5   500          576     0.011852
  PLUM    3    25        49920     0.051358
  PLUM    4    75         6400     0.019753
  PLUM    5   250         1280     0.013169
  ORANGE  3    20        60000     0.049383
  ORANGE  4    60        10000     0.024691
  ORANGE  5   200         2000     0.016461
  LEMON   3    15        60000     0.037037
  LEMON   4    50        10000     0.020576
  LEMON   5   150         2000     0.012346
  CHERRY  2     3      1440000     0.177778
  CHERRY  3    10       249600     0.102716
  CHERRY  4    50        34560     0.071111
  CHERRY  5   200         3840     0.031605
  line return from counts:      81.176955%
  line return from enumeration: 81.176955%  (19726000 per line of 30^5)

BONUS symbols in the window:
  0:  14348907  59.049000%
  1:   7971615  32.805000%
  2:   1771470  7.290000%
  3:    196830  0.810000%
  4:     10935  0.045000%
  5:       243  0.001000%

Wheel: mean prize 14.2 x total bet, multiplier 1/2/5 for 3/4/5 BONUS
Wheel spins:                   1 in 116.82 paid spins
Line return:                   81.176955%
Wheel return:                  12.851000%
TOTAL RETURN TO PLAYER:        94.027955%
Hit frequency (anything paid): 56.2234%
Standard deviation per paid spin (wheel included): 3.4151 x total bet
Largest line win: 5025 credits (502.5 x total bet), 1 way(s) in 30^5

Simulation, 20,000,000 paid spins (seeded sfc32), 7.0 s:
  measured return 94.0454% +/- 0.0763% (1 SE); SD per spin 3.4116
  wheel spins 171379 (1 in 116.7)
  difference from exact: 0.23 SE
```

### 3.9 Machine F: "Gold Rush" (5x4 video slot, 40 lines, sticky-wild free games)

- **Format:** 5 reels x 4 rows, 40 fixed lines, 1-5 credits per line at 1, 5 or 10 cents (total bet 40 x
  credits x coin value). Each reel is a 32-stop strip drawn uniformly; the window shows `strip[s]` to
  `strip[s+3]`. Cycle: 32^5 = 33,554,432.
- **Symbols:** WILD (reels 2-5 only), NUGGET (one on every reel), Cart, Pickaxe, Lantern, Pan, A, K, Q, J,
  10.
- **Line wins:** 3, 4 or 5 of a kind on adjacent reels from reel 1, paid per credit on the line. WILD
  stands in for everything but NUGGET and pays nothing on its own; reel 1 has no WILD, so each line has
  one candidate symbol.
- **Free games:** 3, 4 or 5 NUGGETs anywhere start **8, 10 or 15 free games** on the same bet. Every WILD
  that lands during them **sticks** in its cell until they end. The free games spin their own strips (one
  WILD on each of reels 2-5, no NUGGET), so they cannot retrigger, and they are paid with the spin that
  started them.
- **Math, exact:** the base game by enumeration of every window (and again from symbol counts). The free
  games in closed form: a line reads one cell per reel; a cell's symbol and its sticky history depend only
  on its own reel; the reels are independent; and every row of a uniformly stopped strip shows the same
  distribution. So in free game t (counting from 1) a cell on reel r >= 2 reads WILD with probability
  1 - (1 - q_r)^t (q_r = WILDs on the free strip / 32: one landed there in this game or an earlier one)
  and shows symbol X with probability (1 - q_r)^(t-1) f_r(X), and every line has the same expected pay,
  e(t) = sum over X and n of pay(X, n) f_1(X) prod_{r=2..n} a_r(t, X) (1 - a_{n+1}(t, X)), with
  a_r(t, X) = 1 - (1 - q_r)^t + (1 - q_r)^(t-1) f_r(X). A feature of T games is worth e(1) + ... + e(T)
  total bets. The tests check a_r(t, X) by brute force over every stop sequence of a reel (t up to 3),
  and the Monte Carlo plays whole features against e(1) + ... + e(T).

| Symbol | 5 | 4 | 3 |
|---|---:|---:|---:|
| Cart | 1,000 | 250 | 75 |
| Pickaxe | 500 | 150 | 50 |
| Lantern | 400 | 100 | 30 |
| Pan | 250 | 75 | 25 |
| A | 150 | 40 | 12 |
| K | 125 | 35 | 12 |
| Q | 100 | 25 | 5 |
| J | 80 | 20 | 5 |
| 10 | 60 | 15 | 5 |

| NUGGETs | Chance per spin | Free games | Worth (total bets) |
|---|---:|---:|---:|
| 3 | 1.495361% | 8 | 15.397699 |
| 4 | 0.106812% | 10 | 26.508102 |
| 5 | 0.003052% | 15 | 76.891374 |

Lines (rows 0-3 on reels 1-5): 1: 11111, 2: 22222, 3: 00000, 4: 33333, 5: 01210, 6: 32123, 7: 12321, 8: 21012, 9: 01110, 10: 32223, 11: 10001, 12: 23332, 13: 12221, 14: 21112, 15: 00100, 16: 33233, 17: 11011, 18: 22322, 19: 11211, 20: 22122, 21: 01010, 22: 32323, 23: 10101, 24: 23232, 25: 12121, 26: 21212, 27: 00123, 28: 33210, 29: 01233, 30: 32100, 31: 10121, 32: 23212, 33: 01222, 34: 32111, 35: 11100, 36: 22233, 37: 00012, 38: 33321, 39: 12101, 40: 21232.

**Base-game strips** (32 stops each):

| Stop | Reel 1 | Reel 2 | Reel 3 | Reel 4 | Reel 5 |
|---:|:---|:---|:---|:---|:---|
| 0 | Cart | WILD | K | J | A |
| 1 | Ten | Q | A | Pan | Lantern |
| 2 | A | A | WILD | K | Q |
| 3 | J | Pan | J | A | K |
| 4 | Pan | J | Lantern | NUGGET | Ten |
| 5 | K | K | Q | Q | WILD |
| 6 | Q | Cart | Ten | WILD | J |
| 7 | Lantern | Ten | Pick | Ten | Pan |
| 8 | Ten | A | A | Cart | A |
| 9 | A | Lantern | K | J | Pick |
| 10 | Pick | Q | Pan | Lantern | Q |
| 11 | J | J | J | K | K |
| 12 | K | Pick | Cart | A | Cart |
| 13 | Ten | K | Q | Pick | J |
| 14 | Q | NUGGET | A | Q | Lantern |
| 15 | Pan | A | Ten | Pan | Ten |
| 16 | NUGGET | WILD | Lantern | Ten | A |
| 17 | A | Ten | K | J | NUGGET |
| 18 | Lantern | Pan | WILD | K | Q |
| 19 | J | Q | J | Lantern | Pan |
| 20 | K | Lantern | Pan | A | K |
| 21 | Cart | J | NUGGET | Q | WILD |
| 22 | Q | K | Q | WILD | J |
| 23 | Ten | Cart | A | Cart | A |
| 24 | Pan | A | Pick | J | Ten |
| 25 | A | Ten | K | Ten | Pick |
| 26 | J | Q | Ten | Pan | Q |
| 27 | Pick | Pick | J | K | Lantern |
| 28 | K | J | Cart | A | K |
| 29 | Lantern | Pan | Q | Pick | Cart |
| 30 | Q | K | Pan | Q | J |
| 31 | Ten | Lantern | Lantern | Lantern | Pan |

**Free-game strips** (32 stops each):

| Stop | Reel 1 | Reel 2 | Reel 3 | Reel 4 | Reel 5 |
|---:|:---|:---|:---|:---|:---|
| 0 | Cart | WILD | Q | K | J |
| 1 | J | J | A | Ten | Pan |
| 2 | A | K | J | J | Q |
| 3 | Q | Pan | Lantern | A | A |
| 4 | Pan | A | Ten | Cart | Ten |
| 5 | Ten | Ten | K | Q | Lantern |
| 6 | K | Q | Pick | Lantern | K |
| 7 | Lantern | Cart | J | J | J |
| 8 | J | J | A | Pan | Cart |
| 9 | Q | Lantern | Pan | K | Q |
| 10 | Pick | K | Q | Ten | A |
| 11 | A | A | WILD | A | Pick |
| 12 | Ten | Pick | Ten | Pick | Ten |
| 13 | K | Ten | K | J | J |
| 14 | J | J | J | Q | K |
| 15 | Pan | Q | Cart | Lantern | Pan |
| 16 | Q | Pan | A | K | Q |
| 17 | Lantern | A | Lantern | A | Lantern |
| 18 | A | Lantern | Q | Ten | A |
| 19 | Cart | K | Pan | J | J |
| 20 | J | J | J | WILD | Ten |
| 21 | Ten | Ten | Ten | Q | K |
| 22 | K | Cart | K | Pan | Cart |
| 23 | Q | Q | Pick | A | Q |
| 24 | Pick | A | A | Cart | Pick |
| 25 | Pan | Pick | Q | K | J |
| 26 | A | J | Lantern | J | A |
| 27 | J | K | J | Pick | WILD |
| 28 | Lantern | Pan | Cart | Ten | Ten |
| 29 | K | Ten | K | Q | K |
| 30 | Q | Q | Ten | Lantern | Lantern |
| 31 | Ten | Lantern | Pan | Pan | Pan |

**Exact results:**

| | Value |
|---|---|
| RTP | **92.993553%** (base game 66.902405%, free games 26.091148%) |
| Free games started | 1 in 62.30 paid spins |
| Hit frequency (a line win or free games) | 47.1153% |
| SD per spin, base game only | 1.6239 x the total bet |
| SD per paid spin, free games included | about 3.73 x the total bet (simulated; the sticky wilds tie the free games together) |
| Largest base-game line win | 2,367 credits (59.2 x the total bet), 1 way in 32^5 |

```text
MACHINE F - Gold Rush (5x4, 40 lines, sticky-wild free games)
Enumerated 33,554,432 windows in 13435 ms

Symbol counts per reel (of 32), base / free:
  WILD      0  2  2  2  2   /   0  1  1  1  1
  NUGGET    1  1  1  1  1   /   0  0  0  0  0
  CART      2  2  2  2  2   /   2  2  2  2  2
  PICK      2  2  2  2  2   /   2  2  2  2  2
  LANTERN   3  3  3  3  3   /   3  3  3  3  3
  PAN       3  3  3  3  3   /   3  3  3  3  3
  A         4  4  4  4  4   /   4  4  4  4  4
  K         4  4  4  4  4   /   4  4  4  4  4
  Q         4  4  4  4  4   /   5  4  4  4  4
  J         4  4  4  4  4   /   5  5  5  5  5
  10        5  3  3  3  3   /   4  4  4  4  4

Line return from counts:      66.902405%
Line return from enumeration: 66.902405%  (22448722 per line of 32^5)

NUGGETs in the window:
  0:  17210368  51.290894%
  1:  12293120  36.636353%
  2:   3512320  10.467529%
  3:    501760  1.495361%
  4:     35840  0.106812%
  5:      1024  0.003052%

Free games (sticky wilds), expected line pay per line per game:
  game  1: 0.429872
  game  2: 0.683163
  game  3: 1.013870
  game  4: 1.430176
  game  5: 1.939602
  game  6: 2.548831
  game  7: 3.263592
  game  8: 4.088593
  game  9: 5.027494
  game 10: 6.082910
  game 11: 7.256443
  game 12: 8.548723
  game 13: 9.959468
  game 14: 11.487555
  game 15: 13.131084
  3 NUGGETs: 8 free games worth 15.397699 x total bet
  4 NUGGETs: 10 free games worth 26.508102 x total bet
  5 NUGGETs: 15 free games worth 76.891374 x total bet

Feature started:               1 in 62.30 paid spins
Base game return:              66.902405%
Free-game return:              26.091148%
TOTAL RETURN TO PLAYER:        92.993553%
Base hit frequency (a line win or a feature): 47.1153%
Standard deviation per spin, base game only: 1.6239 x total bet
Largest base-game line win: 2367 credits (59.175 x total bet), 1 way(s) in 32^5

Simulation, 20,000,000 paid spins (seeded sfc32), 21.3 s:
  measured return 92.9076% +/- 0.0833% (1 SE); SD per spin 3.7253
  features 320549 (1 in 62.4), 16.254 x total bet each
  difference from exact: -1.03 SE
```

The three later machines follow the implementation notes of 3.6: the tables are data in
`shared/src/games/slots/{diamonds,cherries,goldrush}.ts`, checked stop for stop against the scripts above,
and the tests enumerate through the engine's own scoring (`shared/test/slots-{diamonds,cherries,goldrush}.test.ts`).

---

## 4. Texas Hold'em (no-limit, cash game)

The rules below follow the Poker Tournament Directors Association rules ([TDA 2026, version 1.0][tda]) and
Bob Ciaffone's *Robert's Rules of Poker*, version 11 ([RRP][rrp]). The TDA rules are written for
tournaments; where cash games differ, Robert's Rules governs.

### 4.1 Table and stakes

- 2 to 9 seats. One 52-card deck, shuffled for every hand. Two blinds, small (SB) and big (BB), chosen when
  the table is started: fourteen stakes from $0.50/$1 to $100,000/$200,000, or any custom blinds in between
  (a $0.50 small blind or whole dollars up to $100,000, the big blind two to three times it;
  [limits.md](limits.md)); $5/$10 at Standard. No antes, no straddles, no rake. Bets and raises are whole
  dollars, or half dollars at a table whose blinds are on the half dollar ($0.50/$1), so every bet is made
  of real chips.
- **Table stakes:** only chips on the table when the hand starts can be bet, and chips cannot be added or
  removed during a hand ([Wikipedia][wikibet]). Buy-in: 20 to 250 big blinds, in whole dollars. The low end
  is the common short-stack convention ("in a $1/2 No Limit cash game, the minimum stake is often set at $40
  while maximum stake is often set at $200" [Wikipedia][wikibet]); the top is a deep-stack table's, so one
  table does both. Players top up only between hands.

### 4.2 Button, blinds and seating

- The button marks the nominal dealer. The SB is the first player clockwise from the button and the BB the
  second ([RRP][rrp] section 4).
- **Heads-up:** the button posts the SB, is dealt the last card, and acts **first before the flop** and
  **last on the flop, turn and river** ([TDA][tda] rule 36-C; [RRP][rrp] 4-3). When a game becomes
  heads-up, "the player who had the big blind the most recently is given the button, and his opponent is
  given the big blind" ([RRP][rrp] 4-3), so nobody posts the BB twice in a row.
- **Button movement: moving button.** After each hand the button moves to the next seat clockwise that
  will be dealt in, and the SB and BB are the next two such seats ([RRP][rrp] 4-2(a)). Robert's Rules allows
  either a moving or a dead button and says a cardroom may pick one for simplicity. The moving button
  "makes sure no player gets the advantage of last action twice on a round" ([RRP][rrp] explanation 1). It
  also needs no empty-seat special cases, which suits an online table where people come and go. (Tournament
  rules use a dead button, [TDA][tda] rule 34; we are not running tournaments.)
- **New players** either wait for the big blind or post one BB and are dealt in on the next hand
  ([RRP][rrp] 4-4). A posted entry blind is live: it counts toward calling, and the player keeps the option
  to raise, as with made-up blinds ([RRP][rrp] 4-10). A new player whose seat lies clockwise after the
  button and before the big blind (the seats the button and small blind are about to move through) waits
  until the button has passed: "A new player cannot be dealt in between the big blind and the button"
  ([RRP][rrp] 4-7).
- **Missed blinds (simplified):** a player who sits out through their big blind comes back by posting one
  live BB or by waiting for the BB. This simplifies [RRP][rrp] 4-10, which also collects a dead small blind.
- **Short blind:** a BB with too few chips posts what they have and is all-in. The amount to call stays the
  full BB, and a preflop raise must be to at least twice the BB ([RRP][rrp] no-limit rule 2).

### 4.3 The deal and betting rounds

1. Post blinds. Deal two hole cards, one at a time, clockwise starting left of the button (heads-up, the
   button is dealt last).
2. **Preflop:** action starts with the player left of the BB (heads-up: the button). The BB's post counts
   as a bet; if everyone just calls, the BB still has the option to check or raise ([RRP][rrp] 4-9;
   [Wikipedia][wikibet]).
3. **Flop:** burn one card, turn three community cards; betting starts with the first active player left
   of the button (heads-up: the BB).
4. **Turn:** burn one, turn one; betting.
5. **River:** burn one, turn one; betting.
6. **Showdown** if two or more players remain.

Each player makes the best five-card hand from their two hole cards and the five community cards, using
any combination, including all five community cards ("play the board", [RRP][rrp] section 5; [TDA][tda]
rule 20). Burn cards change nothing about fairness with a uniformly shuffled deck; keep them for realism.

### 4.4 Betting rules

State for each betting round:

- `currentBet`: the most any player has put in this round.
- `minRaise`: the size of the last **full** bet or raise this round, starting at 1 BB.
- For each player, `committed` this round, and `actedAt`, the value of `currentBet` when they last acted
  (unset until they act).

The player to act has `toCall = currentBet - committed`.

- **No bet facing (`toCall = 0`):** check, or bet at least 1 BB. The minimum bet is the big blind on every
  round, unless the player is all-in for less ([RRP][rrp] no-limit rule 2).
- **Facing a bet:** fold, call (all-in for less is allowed), or raise to at least `currentBet + minRaise`
  and at most all-in. A player who cannot make a full raise may still move all-in (a short all-in).
  "All raises must be equal to or greater than the size of the previous bet or raise on that betting
  round, except for an all-in wager" ([RRP][rrp] no-limit rule 3; [TDA][tda] rule 45-A).
- **Full raise:** if a raise lifts `currentBet` by at least `minRaise`, set `minRaise` to that increase.
- **Short all-in:** an all-in that lifts `currentBet` by less than `minRaise` raises `currentBet` but leaves
  `minRaise` unchanged.
- **Who may raise (reopening).** A player who has not acted this round may always raise. A player who has
  already acted may raise only if `currentBet - actedAt >= minRaise`, meaning they face at least one full
  bet or raise since their last action; several short all-ins add up. "An all-in wager (or cumulative
  multiple short all-ins) totaling less than a full bet or raise will not reopen betting for players who
  have already acted and are not facing at least a full bet or raise when the action returns to them"
  ([TDA][tda] rule 49-A; [RRP][rrp] no-limit rules 3-4; [Wikipedia][wikibet] calls this the full-bet rule).
  Otherwise the player may only call or fold.
- **All-in below the minimum bet:** others may call it, or raise to at least the all-in amount plus 1 BB.
  Robert's Rules' example: with a $100 minimum bet and a $20 all-in, the next player "may fold, call $20, or
  raise to at least a total of $120" ([RRP][rrp] no-limit rule 2).
- **No cap** on the number of raises ([TDA][tda] rule 50; [RRP][rrp] no-limit rule 1).
- **The round ends** when every player who has neither folded nor gone all-in has acted at least once
  (preflop, the BB included) and has `committed = currentBet`, or when only one player is left.
- **All-in run-out:** once a betting round is complete and no more than one player still has chips to
  bet, there is no more betting; deal the rest of the board and go to showdown with every hand face up
  ([TDA][tda] rule 17).

**Test fixtures** (from the [TDA][tda] rule 49 addendum; no-limit):

- *Example 1* (blinds 50/100, after the flop): A bets 100, B is all-in for 125, C calls 125, D is all-in
  for 200, E calls 200. A now faces 100 more, a full raise in total, so A may fold, call or raise.
- *1-A:* A just calls 200. C faces 75 more, less than 100, so C may only call or fold.
- *1-B:* A raises to 300 instead. C faces 175 more, at least 100, so C may re-raise.
- *Example 2:* A bets 300, B is all-in for 500, C all-in 650, D all-in 800, E calls 800. F's minimum raise
  is to 1,100, because the minimum raise stays 300.
- *Example 3* (blinds 2,000/4,000, preflop): A calls 4,000, C is all-in for 7,500, and the SB folds.
  *3-A:* the BB has not acted, so it may raise, to at least 11,500; if the BB just calls, A faces 3,500
  (less than 4,000) and may only call or fold. *3-B:* if the BB raises to 11,500, A faces 7,500 and may
  re-raise.

### 4.5 Ending the hand and showdown

- **Everyone else folds:** the last player wins and does not have to show ([TDA][tda] rule 18-B).
- **Uncalled bets:** the part of the last bet or raise that nobody matched goes back to its owner before
  pots are awarded ([TDA][tda] rules 16-B and 67-A: "the uncalled amount will be returned").
- **All-in showdowns:** all hands are turned up once betting is complete, and no player who is all-in or
  who called may muck without showing ([TDA][tda] rule 17).
- **Showdown order when nobody is all-in:** "The last aggressive player on the final betting round (final
  street) must table first. If there was no final round bet, the player who would act first in a final
  betting round must table first (i.e. first seat left of the button in flop games...)" ([TDA][tda] rule
  18-A; the same in [RRP][rrp] 3, showdown rule 8). Later players, in clockwise order, either show or muck.
- **Mucking:** a player who mucks without showing gives up all claim to the pot ([TDA][tda] rules 18-B and
  19-A). Online, offer Show or Muck with auto-muck for losing hands, and let a caller always see the river
  bettor's hand ([TDA][tda] rule 19-B).
- **Cards speak:** the server evaluates every hand, and what a player claims to hold does not matter
  ([TDA][tda] rule 13).

### 4.6 Pots, side pots, split pots and odd chips

With `c_i` the total each player put in during the hand, folded players included:

1. Return any uncalled amount (4.5).
2. Let `L1 < L2 < ...` be the distinct amounts contributed by players who have not folded (with `L0 = 0`).
   Pot k collects `min(c_i, Lk) - min(c_i, Lk-1)` from every player, folded players included. The players
   eligible for pot k are those who have not folded and have `c_i >= Lk`. After step 1, no folded player
   has contributed more than the top level, so every chip lands in exactly one pot.
3. Award each pot separately ([TDA][tda] rule 23; [RRP][rrp] ties rule 5(d)). Decide side pots before the
   main pot ([RRP][rrp] showdown rule 7).
4. **Split pots:** divide equally among the tied best hands. The smallest unit is 1 cent, because balances
   are integer cents. Odd units go one each to the tied winners in seat order starting from the first seat
   left of the button ([TDA][tda] rule 21-A: "the odd chip goes to the first seat left of the button";
   [RRP][rrp] ties rules 3-5). Example: $5.00 split three ways pays 167, 167 and 166 cents, the extra cent
   going to the first winner left of the button.

### 4.7 Hand rankings

From highest to lowest: straight flush (an ace-high straight flush is a royal flush), four of a kind, full
house, flush, straight, three of a kind, two pair, one pair, high card. Suits never rank. The ace is high,
or low only in the **wheel** A-2-3-4-5, which is the lowest straight and straight flush (5-high). There is
no wraparound: Q-K-A-2-3 is not a straight.

Ties within a category are decided in order, and the first difference wins:

| Category | Compare |
|---|---|
| Straight flush, straight | highest card (the wheel counts as 5) |
| Four of a kind | rank of the four, then the kicker |
| Full house | rank of the three, then rank of the pair |
| Flush, high card | all five cards, highest to lowest |
| Three of a kind | rank of the three, then two kickers |
| Two pair | higher pair, lower pair, kicker |
| One pair | pair rank, then three kickers |

Only the best five cards count; a sixth or seventh card never breaks a tie. Identical five-card hands
split the pot.

**Evaluator test counts.** From [Wikipedia][pokerprob], reproduced exactly by `holdem-hand-counts.mjs`:

| Hand | 5-card hands | Probability | Best 5 of 7 cards | Probability |
|---|---:|---:|---:|---:|
| Royal flush | 4 | 0.00000154 | 4,324 | 0.00003232 |
| Straight flush (not royal) | 36 | 0.00001385 | 37,260 | 0.00027851 |
| Four of a kind | 624 | 0.00024010 | 224,848 | 0.00168067 |
| Full house | 3,744 | 0.00144058 | 3,473,184 | 0.02596102 |
| Flush | 5,108 | 0.00196540 | 4,047,644 | 0.03025494 |
| Straight | 10,200 | 0.00392465 | 6,180,020 | 0.04619382 |
| Three of a kind | 54,912 | 0.02112845 | 6,461,620 | 0.04829870 |
| Two pair | 123,552 | 0.04753902 | 31,433,400 | 0.23495536 |
| One pair | 1,098,240 | 0.42256903 | 58,627,800 | 0.43822546 |
| High card | 1,302,540 | 0.50117739 | 23,294,460 | 0.17411920 |
| **Total** | **2,598,960** | | **133,784,560** | |

Also from [Wikipedia][pokerprob]: there are 7,462 distinct five-card hand values, and 4,824 distinct values
occur as the best five of seven. An evaluator that returns a rank from 1 to 7,462 can be checked against
both numbers.

### 4.8 Action clock and time bank

A reasonable online setup, modelled on PokerStars' 2019 cash-game settings: 10 seconds to act before the
flop when not facing a raise and 15 seconds otherwise; a time bank that starts at 15 seconds, gains 5
seconds every 10 hands played, and is capped at 30 seconds before the flop and 60 after
([PokerNews][pokernews]). When time runs out, check if possible, otherwise fold. That matches the TDA
clock rule: "If the player faces a bet and time expires, the hand is dead; if not facing a bet, the hand is
checked" ([TDA][tda] rule 31). Treat a disconnected player the same way.

### 4.9 Bots for single-player tables

Rule-based opponents built the way solid poker bots are: position-aware charts before the flop, ranges and
equity after it, and players that differ from one another and from hand to hand. Everything a bot decides
from is what its own seat could see at a real table: its two cards, the board, the bets and stacks, the
public actions of this hand, and what it has seen each player do in the hands it played with them. It never
sees the deck or anyone's hole cards (`shared/src/games/holdem/situation.ts` builds its view; a test deals
everyone else different cards and checks the bot's view and decision don't change).

**1. Before the flop: charts by seat.** The standard raise-first-in ranges for six- and nine-handed cash
games at 100 big blinds, the solver-derived charts widely published for training ([Upswing][upsrfi];
[GTO Wizard][gtowrfi]), rounded to the notation players use (`ranges.ts`):

| Seat | Opens | Share of hands |
|---|---|---|
| UTG, nine handed | 77+, ATs+, KTs+, QTs+, JTs, AJo+, KQo | 10% |
| UTG six handed, lojack nine handed | 22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KJo+ | 19% |
| Hijack | + K8s, T8s, 97s, 76s, 65s, A9o, KTo, QJo | 23% |
| Cutoff | + K5s-K7s, Q8s, J8s, 86s, 75s, 54s, A8o, A5o, QTo, JTo | 29% |
| Button, small blind | + the rest of the suited kings, Q4s+, J6s+, T6s+ ... A2o+, K8o+, Q9o+, J9o+, T8o+, 98o, 87o | 46% |

The charts nest, so they also order all 169 kinds of hand, best first (within a tier by Bill Chen's score,
[The Poker Bank][chen]); "the top 12%" means the same thing to every bot. Heads-up the button opens 80%.

- **Facing a raise:** the raiser's range is their seat's chart, widened or narrowed by how often the bot
  has seen them raise. A bot 3-bets the top eighth of that range (at least QQ+ and AK) and, against
  late-position opens, a few suited wheel aces and suited connectors as bluffs; it flat-calls the next half
  in position, defends its big blind by the price (about 1.4 times the opener's range at a 2.5x open), and
  plays small pairs and suited connectors only with the stack behind to pay them off (15 and 18 times the
  call). Against a 3-bet it 4-bets the top third of the 3-bettor's range and calls with the next slice;
  against a 4-bet only the very top goes on. 3-bets are 3x the raise in position and about 3.8x out of it.
- **Short stacks:** 15 big blinds or fewer, move in or fold, wider the shorter the stack.
- **All-or-nothing calls:** facing an all-in, or a call of more than a third of the stack, the bot deals the
  hand out against the raiser's range and calls when its chance beats the price.

**2. After the flop: equity against a range, then pot odds.** The bot sizes up its hand on the board
(`postflop.ts`: the nuts, a set, top pair graded by kicker, an underpair, air; flush and straight draws and
whether the flush draw is the nuts) and the board's texture (dry to wet: suits, connectedness, pairs). It
then estimates its chance of winning by dealing the hand out 220 times, each opponent dealt from their
range: their preflop range, narrowed by how they have bet since (a bet says a medium pair or a draw at
least, a raise more, a re-raise more again; the street being played counts most), passing weaker hands
only as often as that player bluffs, which it reads from how often they bet and raise rather than call.
This is the University of Alberta approach of re-weighting opponent hands by their actions ([Billings et
al. 1998][billings98]; [Billings et al. 2002][billings02]). Then:

- **Pot odds:** facing a bet of `c` into a pot of `P` (the pot already including the bet), call when the
  chance is at least `c / (P + c)`; a real draw on the flop or turn adds implied odds (a share of what is
  left behind). A skilled bot also defends a little wider than the bare price against small bets.
- **Value:** bet when well ahead of the players still in (55% heads-up, more multiway), thinner against
  players who call too much; raise a bet with about 72% or more heads-up. A monster on a dry board is
  sometimes slow-played, which out of position makes check-raises.
- **Continuation bets and barrels** by texture, position and the number of players: more on dry boards,
  in position and heads-up; less against players who rarely fold. Strong draws semi-bluff.
- **Sizing:** a third of the pot on dry flops up to three quarters on wet ones, two thirds on the turn,
  two thirds to the pot on the river with the occasional overbet with the nuts; raises about 3x. Sizes are
  mixed a little and rounded the way people say them.
- **Stack to pot:** with the stack about the size of the pot or less, a good hand just gets it in.
- **River bluffs** balanced against the value bets: for a river bet of `b` times the pot the bettor's
  bluffs-to-value ratio should be `b : (1 + b)`, so bluffs make up `b / (1 + 2b)` of the betting range (a
  third for a pot-sized bet); the caller must defend `1 / (1 + b)` of the time (Chen and Ankenman, *The
  Mathematics of Poker*, 2006; [summary][mop]). Missed draws and air bluff at about that rate, more with
  the initiative, less against players who don't fold.

**3. Reads.** Every hand, the table notes each player's public actions (`reads.ts`): how often they put
money in before the flop (VPIP) and raise it (PFR), how often they bet and raise after the flop rather than
call, and how often they fold to a bet. A read starts at the population's averages and moves toward what
the player does as hands go by (twelve hands weigh as much as the prior); old hands fade. This is what
keeps one-note play from farming the bots: a player who raises every hand is read as a wide raiser and
called and re-raised wider; one who calls everything is value-bet thinner and never bluffed.

**4. Who sits at which stakes.** Eight kinds of player: the calling station, the loose fish, the maniac,
the rock, the tight-aggressive and loose-aggressive players, the solid regular and the professional, each
set by how loose, aggressive and bluffy it is, how much it calls, how it takes a bad beat, and its skill.
Skill decides how well a bot reads ranges (a weak player barely narrows a bettor's range and ignores what
it has seen), whether it plays by position, and how often it makes a mistake. The line-up is drawn by
the stakes: at a $1 big blind half the table is stations, fish and maniacs; at $10,000 and up nearly all
are regulars and professionals, with the odd rich amateur; everyone's skill rises a little with the
stakes and varies a little from bot to bot.

**5. Variance.** Every range edge is mixed (a hand near it is played some of the time), sizes are
randomised, and every bot slips now and then, the way its kind does: a loose call from a station, a spewy
bluff from a maniac, a nervous fold from a rock, a hero call or a strange size from a regular (about 2% of
decisions for a professional, 15% for a fish). A bot that loses a big pot tilts (by its persona): looser,
more aggressive, more mistakes, fading hand by hand. A randomised think time of about 1 to 3 seconds keeps
the pace human. Bots act through the same action path as people, so all table rules apply to them
unchanged.

**Measured** (`shared/test/holdem-bots.mc.test.ts`, duplicate format: every deal played once per seating
so each player holds every seat's cards; 100 big blinds, topped up each hand): bots drawn for high stakes
beat bots drawn for micro stakes; a professional beats a station, a fish, a maniac and a rock heads-up;
and no trivial strategy (always call, always raise the pot, min-raise every street, all-in every hand)
wins against the tables the engine seats at high stakes. A decision takes well under a millisecond on
average (the Monte Carlo is bounded at 220 deals).

### 4.10 Testing Hold'em

There is no house edge to measure, so the Monte Carlo test checks the pieces that can fail silently:

- the evaluator category counts in 4.7, exactly;
- chip conservation: the total of all stacks plus the pot never changes during a hand, and the pots paid
  out equal the chips put in;
- the TDA fixtures in 4.4 as unit tests of reopening and minimum raises;
- side-pot splits with three or more all-ins, including odd-cent splits;
- deal uniformity: over millions of deals, each of the 1,326 hole-card combinations appears about equally
  often (chi-square test);
- the bots (4.9): stronger line-ups beat weaker ones and no trivial strategy beats the high-stakes tables,
  in big blinds per 100 hands with standard errors, over thousands of duplicate deals with fixed seeds.

---

## Sources

**Three Card Poker**
- [tcp]: Wizard of Odds, Three Card Poker: https://wizardofodds.com/games/three-card-poker/
- [tcpfaq]: Wizard of Odds, Ask the Wizard, Three Card Poker: https://wizardofodds.com/ask-the-wizard/three-card-poker
- [pa6]: 58 Pa. Code 649a.6, Three Card Poker rankings: https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/058/chapter649a/s649a.6.html
- [pa11]: 58 Pa. Code 649a.11, Procedures for completion of each round of play: https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/058/chapter649a/s649a.11.html
- [pa12]: 58 Pa. Code 649a.12, Payout odds: https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/058/chapter649a/s649a.12.html
- [caesars]: Caesars, How to play 3 Card Poker: https://www.caesars.com/las-vegas/explore/casino/how-to-play-3-card-poker
- [ngcb]: Nevada Gaming Control Board, Monthly Revenue Report, December 2025 (Clark County, Las Vegas Strip area): https://www.gaming.nv.gov/siteassets/content/about/gaming-revenue/december-2025-monthly-revenue-report.pdf

**Video poker**
- [vptables]: Wizard of Odds, Jacks or Better pay tables and return: https://wizardofodds.com/games/video-poker/tables/jacks-or-better/
- [vpopt]: Wizard of Odds, 9/6 Jacks or Better optimal strategy: https://wizardofodds.com/games/video-poker/strategy/jacks-or-better/9-6/optimal/
- [vpsimple]: Wizard of Odds, 9/6 Jacks or Better simple strategy: https://wizardofodds.com/games/video-poker/strategy/jacks-or-better/9-6/simple/
- [nv14]: Nevada Gaming Commission Regulation 14 (Rev. 12/24), section 14.040: https://www.gaming.nv.gov/siteassets/content/home/features/Regulation14.pdf

**Slots**
- [slotbasics]: Wizard of Odds, slot machine basics: https://wizardofodds.com/games/slots/basics/
- [telnaes]: US Patent 4,448,419 (Telnaes, 1984): https://patents.google.com/patent/US4448419A/en
- [rwb]: Wizard of Odds, Red White & Blue analysis (slot appendix 6): https://wizardofodds.com/games/slots/appendix/6/
- [app1]: Wizard of Odds, slot appendix 1 (Double Strike): https://wizardofodds.com/games/slots/appendix/1/
- [fruit]: Wizard of Odds, the Wizard's fruit slot (slot appendix 4): https://wizardofodds.com/games/slots/appendix/4/
- [harrigan]: K. Harrigan (2007), *Electronic Gaming Machine Structural Characteristics*, University of Waterloo: https://www.greo.ca/Modules/EvidenceCentre/files/Harrigan%20(2007)Electronic_gaming_machine_structural_characteristics.pdf
- [nj28a]: N.J.A.C. 13:69E-1.28A, Standards for the approval of a slot machine game: https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-13-69E-1-28A
- NGCB and Nevada Regulation 14 as above.

**Texas Hold'em**
- [tda]: Poker TDA Rules, 2026 version 1.0 (Sept 7, 2026), with Recommended Procedures and Illustration Addendum: https://www.pokertda.com/view-poker-tda-rules/
- [rrp]: Robert's Rules of Poker, version 11 (Bob Ciaffone): https://www.pagat.com/docs/RobsPkrRules11.pdf
- [wikibet]: Wikipedia, Betting in poker: https://en.wikipedia.org/wiki/Betting_in_poker
- [pokerprob]: Wikipedia, Poker probability: https://en.wikipedia.org/wiki/Poker_probability
- [pokernews]: PokerNews (Jan 30, 2019), "PokerStars Speeds Up Cash Games With Significantly Shorter Time Banks": https://www.pokernews.com/news/2019/01/pokerstars-speeds-up-cash-games-33253.htm
- [chen]: The Poker Bank, the Chen formula: https://www.thepokerbank.com/strategy/basic/starting-hand-selection/chen-formula/
- [wikistart]: Wikipedia, Texas hold 'em starting hands: https://en.wikipedia.org/wiki/Texas_hold_%27em_starting_hands
- [sm16]: RakebackPros, Texas Hold'em starting hands (Sklansky groups 1-6): https://www.rakebackpros.net/texas-holdem-starting-hands/
- [sm78]: Hablando de Poker, Sklansky hand groups: https://www.hablandodepoker.com/poker-en-general/grupos-de-manos-de-david-sklansky/
- [smpb]: The Poker Bank, Sklansky and Malmuth hand groups: https://www.thepokerbank.com/strategy/basic/starting-hand-selection/sklansky-groups/
- [billings98]: D. Billings, D. Papp, J. Schaeffer, D. Szafron, "Opponent Modeling in Poker", AAAI-98: https://cdn.aaai.org/AAAI/1998/AAAI98-070.pdf
- [billings02]: D. Billings, A. Davidson, J. Schaeffer, D. Szafron, "The challenge of poker", *Artificial Intelligence* 134 (2002) 201-240: https://doi.org/10.1016/S0004-3702(01)00130-8
- [ehs]: Wikipedia, Effective hand strength algorithm: https://en.wikipedia.org/wiki/Effective_hand_strength_algorithm
- [upsrfi]: Upswing Poker, preflop charts (6-max and full ring raise-first-in): https://upswingpoker.com/preflop-charts/
- [gtowrfi]: GTO Wizard, cash game preflop ranges: https://gtowizard.com/
- [mop]: Summary of Chen and Ankenman, *The Mathematics of Poker* (ConJelCo, 2006): https://www.overnightmonster.com/pages/mathematicsofpoker

[tcp]: https://wizardofodds.com/games/three-card-poker/
[tcpfaq]: https://wizardofodds.com/ask-the-wizard/three-card-poker
[pa6]: https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/058/chapter649a/s649a.6.html
[pa11]: https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/058/chapter649a/s649a.11.html
[pa12]: https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/058/chapter649a/s649a.12.html
[caesars]: https://www.caesars.com/las-vegas/explore/casino/how-to-play-3-card-poker
[ngcb]: https://www.gaming.nv.gov/siteassets/content/about/gaming-revenue/december-2025-monthly-revenue-report.pdf
[vptables]: https://wizardofodds.com/games/video-poker/tables/jacks-or-better/
[vpopt]: https://wizardofodds.com/games/video-poker/strategy/jacks-or-better/9-6/optimal/
[vpsimple]: https://wizardofodds.com/games/video-poker/strategy/jacks-or-better/9-6/simple/
[nv14]: https://www.gaming.nv.gov/siteassets/content/home/features/Regulation14.pdf
[slotbasics]: https://wizardofodds.com/games/slots/basics/
[telnaes]: https://patents.google.com/patent/US4448419A/en
[rwb]: https://wizardofodds.com/games/slots/appendix/6/
[app1]: https://wizardofodds.com/games/slots/appendix/1/
[fruit]: https://wizardofodds.com/games/slots/appendix/4/
[harrigan]: https://www.greo.ca/Modules/EvidenceCentre/files/Harrigan%20(2007)Electronic_gaming_machine_structural_characteristics.pdf
[nj28a]: https://www.law.cornell.edu/regulations/new-jersey/N-J-A-C-13-69E-1-28A
[tda]: https://www.pokertda.com/view-poker-tda-rules/
[rrp]: https://www.pagat.com/docs/RobsPkrRules11.pdf
[wikibet]: https://en.wikipedia.org/wiki/Betting_in_poker
[pokerprob]: https://en.wikipedia.org/wiki/Poker_probability
[pokernews]: https://www.pokernews.com/news/2019/01/pokerstars-speeds-up-cash-games-33253.htm
[chen]: https://www.thepokerbank.com/strategy/basic/starting-hand-selection/chen-formula/
[wikistart]: https://en.wikipedia.org/wiki/Texas_hold_%27em_starting_hands
[sm16]: https://www.rakebackpros.net/texas-holdem-starting-hands/
[sm78]: https://www.hablandodepoker.com/poker-en-general/grupos-de-manos-de-david-sklansky/
[smpb]: https://www.thepokerbank.com/strategy/basic/starting-hand-selection/sklansky-groups/
[billings98]: https://cdn.aaai.org/AAAI/1998/AAAI98-070.pdf
[billings02]: https://doi.org/10.1016/S0004-3702(01)00130-8
[ehs]: https://en.wikipedia.org/wiki/Effective_hand_strength_algorithm
[mop]: https://www.overnightmonster.com/pages/mathematicsofpoker

---

## Appendix: scripts and output

All scripts live in [`docs/math/`](../math/), need only Node.js 18 or newer, and print everything
quoted in this document. Run times on a laptop: under 3 seconds each, except the video poker analysis
(about 40 seconds).

### Three Card Poker: `three-card-poker.mjs`

```text
THREE CARD POKER - exact enumeration
Player/dealer deals enumerated: 407,170,400

3-card hand frequencies (of 22,100):
  Straight flush       48  0.002172
  Three of a kind      52  0.002353
  Straight            720  0.032579
  Flush              1096  0.049593
  Pair               3744  0.169412
  High card         16440  0.743891

Optimal play/fold decision matches "play Q-6-4 or better": true
Weakest hand worth playing: Q-6-4

Ante & Play, Ante Bonus 1/4/5, Q-6-4 strategy (units = one Ante):
  net  -2     91126832  0.223805  -0.447610
  net  -1    132923304  0.326456  -0.326456
  net   0       249216  0.000612  0.000000
  net   1     80955780  0.198825  0.198825
  net   2     91100696  0.223741  0.447482
  net   3      8976452  0.022046  0.066138
  net   4            0  0.000000  0.000000
  net   5       289104  0.000710  0.003550
  net   6       931972  0.002289  0.013733
  net   7       617044  0.001515  0.010608
  expected value per Ante      -0.033730  = -13733780 / 407170400  (house edge 3.3730%)
  optimal-decision EV check    -0.033730
  average total wager (antes)  1.674208
  element of risk              2.0147%
  standard deviation per round 1.6393 antes
  P(play) 0.674208  P(fold) 0.325792
  dealer does not qualify (when played) 0.209970

Pair Plus pay tables (straight flush-trips-straight-flush-pair):
  40-30-6-4-1  EV -0.023167 (edge 2.32%, exact -512/22100)  SD 2.9106  hit 25.61%
  35-33-6-4-1  EV -0.026968 (edge 2.70%, exact -596/22100)  SD 2.8464  hit 25.61%
  40-25-6-4-1  EV -0.034932 (edge 3.49%, exact -772/22100)  SD 2.7972  hit 25.61%
  35-25-6-4-1  EV -0.045792 (edge 4.58%, exact -1012/22100)  SD 2.6474  hit 25.61%
  50-30-6-3-1  EV -0.051041 (edge 5.10%, exact -1128/22100)  SD 3.1745  hit 25.61%
  40-30-5-4-1  EV -0.055747 (edge 5.57%, exact -1232/22100)  SD 2.8480  hit 25.61%
  40-25-5-4-1  EV -0.067511 (edge 6.75%, exact -1492/22100)  SD 2.7317  hit 25.61%
  40-30-6-3-1  EV -0.072760 (edge 7.28%, exact -1608/22100)  SD 2.8496  hit 25.61%
```

<details><summary>Source</summary>

```js
// Three Card Poker: exact analysis by full enumeration.
// Every player hand (22,100) against every dealer hand from the remaining
// 49 cards (18,424) = 407,170,400 deals.
//
// Rules modelled: Ante and Play (Play = Ante), dealer qualifies with queen
// high or better, dealer not qualifying pays Ante 1:1 and pushes Play,
// Ante Bonus 5/4/1 (straight flush/trips/straight) paid when the player
// plays, regardless of the dealer's hand.
//
// Run: node three-card-poker.mjs

const RANKS = '23456789TJQKA';
const rankOf = (c) => c >> 2;   // 0 = deuce ... 12 = ace
const suitOf = (c) => c & 3;

// Categories, high to low: straight flush 5, trips 4, straight 3, flush 2,
// pair 1, high card 0.
const CAT_NAMES = ['High card', 'Pair', 'Flush', 'Straight', 'Three of a kind', 'Straight flush'];

// Returns an integer; a larger value is a better hand, equal values tie.
function score(a, b, c) {
  let r = [rankOf(a), rankOf(b), rankOf(c)].sort((x, y) => y - x);
  const flush = suitOf(a) === suitOf(b) && suitOf(b) === suitOf(c);
  let straightTop = -1;
  if (r[0] - r[1] === 1 && r[1] - r[2] === 1) straightTop = r[0];
  if (r[0] === 12 && r[1] === 1 && r[2] === 0) straightTop = 1; // A-2-3 is the lowest straight
  let cat, tie;
  if (straightTop >= 0 && flush) { cat = 5; tie = straightTop; }
  else if (r[0] === r[2]) { cat = 4; tie = r[0]; }
  else if (straightTop >= 0) { cat = 3; tie = straightTop; }
  else if (flush) { cat = 2; tie = r[0] * 169 + r[1] * 13 + r[2]; }
  else if (r[0] === r[1] || r[1] === r[2]) {
    const pair = r[1];
    const kicker = r[0] === r[1] ? r[2] : r[0];
    cat = 1; tie = pair * 13 + kicker;
  } else { cat = 0; tie = r[0] * 169 + r[1] * 13 + r[2]; }
  return cat * 2197 + tie;
}
const category = (s) => Math.floor(s / 2197);

// All 3-card hands.
const hands = [];
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++)
    for (let c = b + 1; c < 52; c++) {
      const s = score(a, b, c);
      const lo = (a < 32 ? 1 << a : 0) | (b < 32 ? 1 << b : 0) | (c < 32 ? 1 << c : 0);
      const hi = (a >= 32 ? 1 << (a - 32) : 0) | (b >= 32 ? 1 << (b - 32) : 0) | (c >= 32 ? 1 << (c - 32) : 0);
      hands.push({ a, b, c, s, lo, hi });
    }
const N = hands.length; // 22100

// Queen-high threshold for the dealer, Q-6-4 threshold for the player.
const QUEEN_HIGH_MIN = 0 * 2197 + 10 * 169 + 1 * 13 + 0; // Q-3-2, the lowest queen-high hand
const Q64 = 0 * 2197 + 10 * 169 + 4 * 13 + 2;            // Q-6-4

const bonus = (cat) => (cat === 5 ? 5 : cat === 4 ? 4 : cat === 3 ? 1 : 0);

// Hand frequencies.
const catCount = new Array(6).fill(0);
for (const h of hands) catCount[category(h.s)]++;

// Enumerate.
const dist = new Map();           // net result (in antes) -> weight
let optimalEvSum = 0;             // sum over player hands of max(EV(play), -1) * 18424
let q64Agrees = true;
let lowestPlay = null;            // weakest hand for which playing is better than folding
const add = (k, w) => dist.set(k, (dist.get(k) || 0) + w);
const outcome = { win: 0, tie: 0, lose: 0, noQualify: 0, fold: 0 };

for (let i = 0; i < N; i++) {
  const p = hands[i];
  const pcat = category(p.s);
  let win = 0, tie = 0, lose = 0, nq = 0;
  for (let j = 0; j < N; j++) {
    const d = hands[j];
    if ((p.lo & d.lo) | (p.hi & d.hi)) continue;
    if (d.s < QUEEN_HIGH_MIN) nq++;
    else if (p.s > d.s) win++;
    else if (p.s === d.s) tie++;
    else lose++;
  }
  const total = win + tie + lose + nq; // 18424
  const b = bonus(pcat);
  const evPlay = (b * total + nq * 1 + win * 2 - lose * 2) / total;
  const shouldPlay = evPlay > -1;
  const q64Play = p.s >= Q64;
  if (shouldPlay !== q64Play) q64Agrees = false;
  if (shouldPlay && (lowestPlay === null || p.s < lowestPlay.s)) lowestPlay = p;
  optimalEvSum += Math.max(evPlay, -1) * total;

  // Distribution under the Q-6-4 rule.
  if (q64Play) {
    add(b + 1, nq); add(b + 2, win); add(b + 0, tie); add(b - 2, lose);
    outcome.win += win; outcome.tie += tie; outcome.lose += lose; outcome.noQualify += nq;
  } else {
    add(-1, total);
    outcome.fold += total;
  }
}

const TOTAL = N * 18424;
let mean = 0, m2 = 0, playWeight = 0, numerator = 0;
for (const [k, w] of dist) { mean += k * w; m2 += k * k * w; numerator += k * w; }
mean /= TOTAL; m2 /= TOTAL;
const sd = Math.sqrt(m2 - mean * mean);
playWeight = outcome.win + outcome.tie + outcome.lose + outcome.noQualify;
const avgWager = 1 + playWeight / TOTAL;

const nameOf = (h) => [h.a, h.b, h.c].map((c) => RANKS[rankOf(c)]).sort((x, y) => RANKS.indexOf(y) - RANKS.indexOf(x)).join('-');

console.log('THREE CARD POKER - exact enumeration');
console.log('Player/dealer deals enumerated:', TOTAL.toLocaleString('en-US'));
console.log('\n3-card hand frequencies (of 22,100):');
for (let k = 5; k >= 0; k--) console.log(`  ${CAT_NAMES[k].padEnd(16)} ${String(catCount[k]).padStart(6)}  ${(catCount[k] / N).toFixed(6)}`);
console.log('\nOptimal play/fold decision matches "play Q-6-4 or better":', q64Agrees);
console.log('Weakest hand worth playing:', nameOf(lowestPlay));
console.log('\nAnte & Play, Ante Bonus 1/4/5, Q-6-4 strategy (units = one Ante):');
const keys = [...dist.keys()].sort((x, y) => x - y);
for (const k of keys) {
  const w = dist.get(k);
  console.log(`  net ${String(k).padStart(3)}  ${String(w).padStart(11)}  ${(w / TOTAL).toFixed(6)}  ${(k * w / TOTAL).toFixed(6)}`);
}
console.log(`  expected value per Ante      ${mean.toFixed(6)}  = ${numerator} / ${TOTAL}  (house edge ${(-mean * 100).toFixed(4)}%)`);
console.log(`  optimal-decision EV check    ${(optimalEvSum / TOTAL).toFixed(6)}`);
console.log(`  average total wager (antes)  ${avgWager.toFixed(6)}`);
console.log(`  element of risk              ${(-mean / avgWager * 100).toFixed(4)}%`);
console.log(`  standard deviation per round ${sd.toFixed(4)} antes`);
console.log(`  P(play) ${(playWeight / TOTAL).toFixed(6)}  P(fold) ${(outcome.fold / TOTAL).toFixed(6)}`);
console.log(`  dealer does not qualify (when played) ${(outcome.noQualify / TOTAL).toFixed(6)}`);

// Pair Plus: depends only on the player's three cards.
console.log('\nPair Plus pay tables (straight flush-trips-straight-flush-pair):');
const tables = [
  [40, 30, 6, 4, 1], [35, 33, 6, 4, 1], [40, 25, 6, 4, 1], [35, 25, 6, 4, 1],
  [50, 30, 6, 3, 1], [40, 30, 5, 4, 1], [40, 25, 5, 4, 1], [40, 30, 6, 3, 1],
];
for (const t of tables) {
  const pays = { 5: t[0], 4: t[1], 3: t[2], 2: t[3], 1: t[4], 0: -1 };
  let e = 0, e2 = 0;
  for (let k = 0; k <= 5; k++) { e += pays[k] * catCount[k]; e2 += pays[k] * pays[k] * catCount[k]; }
  const ev = e / N; const v = e2 / N - ev * ev;
  console.log(`  ${t.join('-').padEnd(12)} EV ${ev.toFixed(6)} (edge ${(-ev * 100).toFixed(2)}%, exact ${e}/22100)  SD ${Math.sqrt(v).toFixed(4)}  hit ${( (N - catCount[0]) / N * 100).toFixed(2)}%`);
}
```

</details>

### Jacks or Better 9/6: `video-poker-job96.mjs`

Output with 5 coins (royal 800 per coin):

```text
JACKS OR BETTER 9/6 - exact analysis over 2,598,960 deals; royal pays 800 per coin

[optimal] return 99.543904%  (check 99.543904%)  SD per hand (units of total bet) 4.4175 bets
  Royal flush       800           493512264  0.00002476  0.01980661
  Straight flush     50          2178883296  0.00010931  0.00546545
  Four of a kind     25         47093167764  0.00236255  0.05906364
  Full house          9        229475482596  0.01151221  0.10360987
  Flush               6        219554786160  0.01101451  0.06608707
  Straight            4        223837565784  0.01122937  0.04491747
  Three of a kind     3       1484003070324  0.07444870  0.22334610
  Two pair            2       2576946164148  0.12927890  0.25855780
  Jacks or better     1       4277372890968  0.21458503  0.21458503
  Nothing             0      10872274993896  0.54543467  0.00000000
  total combinations 19933230517200

[listNoExceptions] return 99.542919%  (check 99.542919%)  SD per hand (units of total bet) 4.4474 bets
  deals where this list is worse than optimal: 5496  (same-line ties with different EV: 0)
  Royal flush       800           501787872  0.00002517  0.02013875
  Straight flush     50          2182408092  0.00010949  0.00547430
  Four of a kind     25         47091616668  0.00236247  0.05906170
  Full house          9        229472668332  0.01151207  0.10360860
  Flush               6        218710850616  0.01097217  0.06583304
  Straight            4        223980621108  0.01123654  0.04494618
  Three of a kind     3       1484028486936  0.07444997  0.22334992
  Two pair            2       2577124786320  0.12928786  0.25857573
  Jacks or better     1       4274501705460  0.21444099  0.21444099
  Nothing             0      10875635585796  0.54560326  0.00000000
  total combinations 19933230517200

[listWithExceptions] return 99.543904%  (check 99.543904%)  SD per hand (units of total bet) 4.4175 bets
  deals where this list is worse than optimal: 0  (same-line ties with different EV: 0)
  Royal flush       800           493512264  0.00002476  0.01980661
  Straight flush     50          2178883296  0.00010931  0.00546545
  Four of a kind     25         47093167764  0.00236255  0.05906364
  Full house          9        229475482596  0.01151221  0.10360987
  Flush               6        219554786160  0.01101451  0.06608707
  Straight            4        223837565784  0.01122937  0.04491747
  Three of a kind     3       1484003070324  0.07444870  0.22334610
  Two pair            2       2576946164148  0.12927890  0.25855780
  Jacks or better     1       4277372890968  0.21458503  0.21458503
  Nothing             0      10872274993896  0.54543467  0.00000000
  total combinations 19933230517200

[simple] return 99.459239%  (check 99.459239%)  SD per hand (units of total bet) 4.4421 bets
  deals where this list is worse than optimal: 58944  (same-line ties with different EV: 1152)
  Royal flush       800           500232132  0.00002510  0.02007631
  Straight flush     50          2213505864  0.00011105  0.00555230
  Four of a kind     25         47096098128  0.00236269  0.05906732
  Full house          9        229580618112  0.01151748  0.10365734
  Flush               6        220995584064  0.01108679  0.06652075
  Straight            4        212034436788  0.01063723  0.04254894
  Three of a kind     3       1485881963064  0.07454296  0.22362887
  Two pair            2       2582389438344  0.12955198  0.25910396
  Jacks or better     1       4274414268228  0.21443660  0.21443660
  Nothing             0      10878124372476  0.54572812  0.00000000
  total combinations 19933230517200

first deals where [listNoExceptions] loses EV:
  2d 3c 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  2h 3c 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  2s 3c 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  2c 3d 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  2c 3h 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  2c 3s 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  2d 4c 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  2h 4c 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  2s 4c 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  3d 4c 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  3h 4c 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598
  3s 4c 9d Tc Kc | list holds [Tc Kc] 0.4582 | best [Kc] 0.4598

first deals where [listWithExceptions] loses EV:
```

Summary with 1-4 coins (`--royal=250`):

```text
JACKS OR BETTER 9/6 - exact analysis over 2,598,960 deals; royal pays 250 per coin
[optimal] return 98.373457%  (check 98.373457%)  SD per hand (units of total bet) 2.2196 bets
[listNoExceptions] return 98.158380%  (check 98.158380%)  SD per hand (units of total bet) 2.2954 bets
  deals where this list is worse than optimal: 93852  (same-line ties with different EV: 0)
[listWithExceptions] return 98.182200%  (check 98.182200%)  SD per hand (units of total bet) 2.2899 bets
  deals where this list is worse than optimal: 88356  (same-line ties with different EV: 0)
[simple] return 98.078992%  (check 98.078992%)  SD per hand (units of total bet) 2.2949 bets
  deals where this list is worse than optimal: 127044  (same-line ties with different EV: 1152)
first deals where [listNoExceptions] loses EV:
first deals where [listWithExceptions] loses EV:
```

Single-deal mode, used for the table in 2.5 (`--hand=...`, top holds shown):

```text
Deal: 5s Js Qs Ks As  (royal 800 per coin)
  hold [Js Qs Ks As]  EV 18.425532
  hold [5s Js Qs Ks As]  EV 6.000000
Deal: 9c Th Jh Qh Kh  (royal 800 per coin)
  hold [Th Jh Qh Kh]  EV 19.595745
  hold [9c Th Jh Qh Kh]  EV 4.000000
Deal: 5c 5d 7d Jd Qd  (royal 800 per coin)
  hold [5d 7d Jd Qd]  EV 1.276596
  hold [5c 5d]  EV 0.823682
Deal: 5c 6d 7h 8c 8s  (royal 800 per coin)
  hold [8c 8s]  EV 0.823682
  hold [5c 6d 7h 8c]  EV 0.680851
Deal: 3s Tc Jd Qh Ks  (royal 800 per coin)
  hold [Tc Jd Qh Ks]  EV 0.872340
  hold [Jd Qh Ks]  EV 0.485661
Deal: 2c Jh Js Qh Kh  (royal 800 per coin)
  hold [Jh Js]  EV 1.536540
  hold [Jh Qh Kh]  EV 1.488437
Deal: 2c 5h Jh Qh Kh  (royal 800 per coin)
  hold [Jh Qh Kh]  EV 1.482886
  hold [5h Jh Qh Kh]  EV 1.340426
Deal: 9h Th Jd Jh Qh  (royal 800 per coin)
  hold [9h Th Jh Qh]  EV 3.638298
  hold [Jd Jh]  EV 1.536540
Deal: 4h 4s 9c Jc Jd  (royal 800 per coin)
  hold [4h 4s Jc Jd]  EV 2.595745
  hold [4h 4s 9c Jc Jd]  EV 2.000000
Deal: 3s Js Qh Kd Ac  (royal 800 per coin)
  hold [Js Qh Kd Ac]  EV 0.595745
  hold [Js Qh Kd]  EV 0.497687
Deal: 4s 7c Qh Kd Ac  (royal 800 per coin)
  hold [Qh Kd]  EV 0.483441
  hold [Qh Ac]  EV 0.467653
Deal: 3d 5h 8s Jc Ad  (royal 800 per coin)
  hold [Jc Ad]  EV 0.478261
  hold [Jc]  EV 0.473989
Deal: 3c 8c 9d Jh Qs  (royal 800 per coin)
  hold [Jh Qs]  EV 0.498982
  hold [Jh]  EV 0.468517
Deal: 4c 7d Ts Js Ah  (royal 800 per coin)
  hold [Ts Js]  EV 0.500771
  hold [Js Ah]  EV 0.474314
Deal: 3d 6c 9s Tc Kc  (royal 800 per coin)
  hold [Kc]  EV 0.459765
  hold [Tc Kc]  EV 0.458218
Deal: 2d 3c Td Qd Ac  (royal 800 per coin)
  hold [Qd Ac]  EV 0.474314
  hold [Td Qd]  EV 0.469812
```

<details><summary>Source</summary>

```js
// Jacks or Better 9/6 video poker: exact analysis.
//
// 1. Optimal play: for every one of the 2,598,960 deals, the expected value of
//    all 32 ways to hold is computed exactly (every possible draw from the 47
//    unseen cards), and the best hold is kept.
// 2. The ordered hold list in RULES.md is coded and scored the same way, so
//    its exact return is known, not estimated.
//
// Method: count, for every subset of up to 5 cards, how many final 5-card
// hands contain it (by pay category). The number of final hands that contain
// the held cards and none of the discarded cards then follows from
// inclusion-exclusion over the discards.
//
// Run: node video-poker-job96.mjs            (5 coins: royal pays 4000 = 800 per coin)
//      node video-poker-job96.mjs --royal=250 (1-4 coins: royal pays 250 per coin)
//      node video-poker-job96.mjs --hand=As,Ks,Qs,Js,5s   (exact EV of every hold for one deal)
// Takes well under a minute.

const royalArg = process.argv.find((a) => a.startsWith('--royal='));
const PAY = [0, 1, 2, 3, 4, 6, 9, 25, 50, royalArg ? Number(royalArg.split('=')[1]) : 800]; // per coin
const CAT = ['Nothing', 'Jacks or better', 'Two pair', 'Three of a kind', 'Straight', 'Flush',
  'Full house', 'Four of a kind', 'Straight flush', 'Royal flush'];
const NC = 10;
const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const T = 8, J = 9, Q = 10, K = 11, A = 12;

// Binomials.
const Cb = [];
for (let n = 0; n <= 52; n++) {
  Cb.push(new Array(6).fill(0));
  Cb[n][0] = 1;
  for (let k = 1; k <= 5 && k <= n; k++) Cb[n][k] = Cb[n - 1][k - 1] + (k <= n - 1 ? Cb[n - 1][k] : 0);
}
const C47 = [1, 47, 1081, 16215, 178365, 1533939]; // C(47, k)

// Category of a 5-card hand.
const cnt = new Int8Array(13);
function category(h) {
  cnt.fill(0);
  let mask = 0, flush = true;
  for (let i = 0; i < 5; i++) { const r = h[i] >> 2; cnt[r]++; mask |= 1 << r; if ((h[i] & 3) !== (h[0] & 3)) flush = false; }
  let pairs = 0, trips = 0, quads = 0, highPair = false, distinct = 0;
  for (let r = 0; r < 13; r++) {
    if (cnt[r]) distinct++;
    if (cnt[r] === 2) { pairs++; if (r >= J) highPair = true; }
    else if (cnt[r] === 3) trips++;
    else if (cnt[r] === 4) quads++;
  }
  let straight = false;
  if (distinct === 5) {
    const lo = 31 - Math.clz32(mask & -mask), hi = 31 - Math.clz32(mask);
    if (hi - lo === 4 || mask === 0b1000000001111) straight = true;
  }
  if (straight && flush) return mask === 0b1111100000000 ? 9 : 8;
  if (quads) return 7;
  if (trips && pairs) return 6;
  if (flush) return 5;
  if (straight) return 4;
  if (trips) return 3;
  if (pairs === 2) return 2;
  if (highPair) return 1;
  return 0;
}

// Subset counts: cntK[k][idx * NC + cat] = number of final hands containing
// the k-subset with colex index idx, by category.
const cntK = [new Float64Array(NC), new Int32Array(52 * NC), new Int32Array(1326 * NC),
  new Int32Array(22100 * NC), new Int32Array(270725 * NC)];
const cat5 = new Uint8Array(2598960);
const hand = [0, 0, 0, 0, 0];
let idx5 = 0;
for (let e = 4; e < 52; e++) for (let d = 3; d < e; d++) for (let c = 2; c < d; c++)
  for (let b = 1; b < c; b++) for (let a = 0; a < b; a++) {
    hand[0] = a; hand[1] = b; hand[2] = c; hand[3] = d; hand[4] = e;
    const cat = category(hand);
    cat5[idx5++] = cat;
    for (let m = 0; m < 31; m++) {
      let k = 0, idx = 0;
      for (let i = 0; i < 5; i++) if (m & (1 << i)) { k++; idx += Cb[hand[i]][k]; }
      cntK[k][idx * NC + cat]++;
    }
  }

// Payout-weighted versions.
const payK = cntK.map((arr) => {
  const out = new Float64Array(arr.length / NC);
  for (let i = 0; i < out.length; i++) { let s = 0; for (let c = 0; c < NC; c++) s += PAY[c] * arr[i * NC + c]; out[i] = s; }
  return out;
});

const popcount = (m) => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };
const POP = Array.from({ length: 32 }, (_, m) => popcount(m));
// Weight that turns "final hands for this hold" into a common denominator of
// 5 * C(47,5) per deal, matching the combination counts published by Wizard of Odds.
const WEIGHT = [5, 43, 473, 7095, 163185, 7669695];

// ---------- the hold-order list (see RULES.md) ----------
// Entry numbers follow the published optimal list; lower is better.
function isSfWindow(rs) { // rs: distinct ranks ascending
  const lo = rs[0], hi = rs[rs.length - 1];
  if (hi - lo <= 4) return true;
  if (hi === A) { const lo2 = -1, hi2 = rs[rs.length - 2]; return hi2 - lo2 <= 4; }
  return false;
}
function sf3Type(rs) { // 3 distinct suited ranks ascending, known to fit a window
  if (rs[2] === A && rs[2] - rs[0] > 4) return 2;          // ace low
  if (rs[0] === 0 && rs[1] === 1 && rs[2] === 2) return 2;   // 2-3-4
  const gaps = rs[2] - rs[0] - 2;
  let high = 0; for (const r of rs) if (r >= J) high++;
  if (high >= gaps) return 1;
  if ((gaps === 1 && high === 0) || (gaps === 2 && high === 1)) return 2;
  return 3;
}
const NONE = 999;

// Returns the list entry for holding `m` from the dealt hand (ranks rk, suits st,
// dealt category cat). NONE means the hold never appears in the list.
function entryOptimal(m, rk, st, cat) {
  const n = POP[m];
  if (n === 0) return 36;
  if (n === 5) {
    if (cat === 9) return 1; if (cat === 8) return 2; if (cat === 6) return 5;
    if (cat === 5) return 6; if (cat === 4) return 8; return NONE;
  }
  const rs = [], ss = [];
  for (let i = 0; i < 5; i++) if (m & (1 << i)) { rs.push(rk[i]); ss.push(st[i]); }
  rs.sort((x, y) => x - y);
  const suited = ss.every((s) => s === ss[0]);
  let distinct = true; for (let i = 1; i < n; i++) if (rs[i] === rs[i - 1]) distinct = false;
  let high = 0; for (const r of rs) if (r >= J) high++;
  const has = (...want) => want.length === n && want.every((w, i) => rs[i] === w);

  if (n === 4) {
    if (rs[0] === rs[3]) return 3;                                       // four of a kind
    if (!distinct) {
      if (rs[0] === rs[1] && rs[2] === rs[3]) return 10;                 // two pair
      return NONE;
    }
    if (suited && rs[0] >= T) return 4;                                  // 4 to a royal
    if (suited && isSfWindow(rs)) return 9;                              // 4 to a straight flush
    if (suited) return 13;                                               // 4 to a flush
    if (has(T, J, Q, K)) return 14;                                      // unsuited TJQK
    const outside = rs[3] - rs[0] === 3 && rs[3] !== A;
    if (outside) return 16;                                              // 4 to outside straight, 0-2 high
    if (has(J, Q, K, A)) return 19;                                      // inside straight, 4 high
    if (isSfWindow(rs) && high === 3) return 22;                         // inside straight, 3 high
    return NONE;
  }
  if (n === 3) {
    if (rs[0] === rs[2]) return 7;                                       // three of a kind
    if (!distinct) return NONE;
    if (suited && rs[0] >= T) return 12;                                 // 3 to a royal
    if (suited && isSfWindow(rs)) { const t = sf3Type(rs); return t === 1 ? 17 : t === 2 ? 23 : 35; }
    if (has(J, Q, K)) return 24;                                         // unsuited JQK
    return NONE;
  }
  if (n === 2) {
    if (rs[0] === rs[1]) return rs[0] >= J ? 11 : 15;                    // high pair / low pair
    if (suited) {
      if (has(J, Q)) return 18;
      if (has(Q, K) || has(J, K)) return 20;
      if (has(K, A) || has(Q, A) || has(J, A)) return 21;
      if (has(T, J)) return 26;
      if (has(T, Q)) return 28;
      if (has(T, K)) return 31;
      return NONE;
    }
    if (has(J, Q)) return 25;
    if (has(Q, K) || has(J, K)) return 27;
    if (has(K, A) || has(Q, A) || has(J, A)) return 29;
    return NONE;
  }
  // n === 1
  if (rs[0] === J) return 30; if (rs[0] === Q) return 32; if (rs[0] === K) return 33; if (rs[0] === A) return 34;
  return NONE;
}

// Penalty-card exceptions (footnotes A-F of the list). Each one moves a hold to a
// fractional position between two list lines for the specific hands it covers.
function withExceptions(m, e, rk, st) {
  if (e !== 12 && e !== 18 && e !== 23 && e !== 26 && e !== 28 && e !== 31) return e;
  const held = [], disc = [];
  for (let i = 0; i < 5; i++) (m & (1 << i) ? held : disc).push(i);
  const suit = st[held[0]];
  const hr = held.map((i) => rk[i]).sort((x, y) => x - y);
  const flushPenalty = disc.some((i) => st[i] === suit);
  if (e === 12) {
    // A: 3 to a royal holding both the T and the A loses to 4 to a flush when the
    // off-suit fifth card is a T or one of the two missing royal ranks.
    if (hr[0] !== T || hr[2] !== A) return e;
    const same = disc.filter((i) => st[i] === suit), other = disc.filter((i) => st[i] !== suit);
    if (same.length !== 1 || other.length !== 1) return e;
    const r = rk[other[0]];
    return r === T || ((r === J || r === Q || r === K) && !hr.includes(r)) ? 13.5 : e;
  }
  if (e === 18) {
    // B: suited QJ with an off-suit K and A loses to J-Q-K-A when the fifth card
    // is a 9 or a flush penalty card.
    const dr = disc.map((i) => rk[i]);
    if (!(dr.includes(K) && dr.includes(A))) return e;
    const fifth = disc.find((i) => rk[i] !== K && rk[i] !== A);
    return fifth !== undefined && (rk[fifth] === 7 || st[fifth] === suit) ? 19.5 : e;
  }
  if (e === 23) {
    // C: 3 to a straight flush spanning 5 ranks with 1 high card beats 4 to an inside
    // straight with 3 high cards, unless a discard is a straight penalty card
    // (a rank that fills the straight-flush draw's window).
    let high = 0; for (const r of hr) if (r >= J) high++;
    if (hr[2] - hr[0] !== 4 || high !== 1) return e;
    const penalty = disc.some((i) => rk[i] > hr[0] && rk[i] < hr[2] && !hr.includes(rk[i]));
    return penalty ? e : 21.5;
  }
  // D: suited TJ drops below unsuited KJ with a flush penalty card.
  if (e === 26) return flushPenalty ? 27.5 : e;
  // E: suited TQ drops below unsuited AQ with a flush penalty card.
  if (e === 28) return flushPenalty ? 29.5 : e;
  // F: suited TK drops below K alone when a 9 and a flush penalty card are discarded.
  if (e === 31) return flushPenalty && disc.some((i) => rk[i] === 7) ? 33.5 : e;
  return e;
}

function entrySimple(m, rk, st, cat) {
  const n = POP[m];
  if (n === 0) return 16;
  if (n === 5) {
    if (cat === 9 || cat === 8) return 1;
    if (cat === 6 || cat === 5 || cat === 4) return 3;
    return NONE;
  }
  // Trips share line 3 with dealt made hands; ranking trips at 3.1 keeps a dealt full house whole.
  const rs = [], ss = [];
  for (let i = 0; i < 5; i++) if (m & (1 << i)) { rs.push(rk[i]); ss.push(st[i]); }
  rs.sort((x, y) => x - y);
  const suited = ss.every((s) => s === ss[0]);
  let distinct = true; for (let i = 1; i < n; i++) if (rs[i] === rs[i - 1]) distinct = false;
  let high = 0; for (const r of rs) if (r >= J) high++;
  if (n === 4) {
    if (rs[0] === rs[3]) return 1;
    if (!distinct) return rs[0] === rs[1] && rs[2] === rs[3] ? 5 : NONE;
    if (suited && rs[0] >= T) return 2;
    if (suited && isSfWindow(rs)) return 4;
    if (suited) return 8;
    if (rs[3] - rs[0] === 3 && rs[3] !== A) return 10;
    return NONE;
  }
  if (n === 3) {
    if (rs[0] === rs[2]) return 3.1;
    if (!distinct) return NONE;
    if (suited && rs[0] >= T) return 7;
    if (suited && isSfWindow(rs)) return 12;
    return NONE;
  }
  if (n === 2) {
    if (rs[0] === rs[1]) return rs[0] >= J ? 6 : 9;
    if (high === 2) return suited ? 11 : 13 + (rs[0] + rs[1]) / 100;  // prefer the lowest two
    if (suited && rs[0] === T && rs[1] >= J && rs[1] <= K) return 14;
    return NONE;
  }
  return rs[0] >= J ? 15 : NONE;                                     // one high card
}

// ---------- single-hand mode ----------
const handArg = process.argv.find((a) => a.startsWith('--hand='));
if (handArg) {
  const parse = (t) => RANKS.indexOf(t[0].toUpperCase()) * 4 + SUITS.indexOf(t[1].toLowerCase());
  const cards = handArg.slice(7).split(',').map(parse).sort((x, y) => x - y);
  if (cards.length !== 5 || cards.some((c) => c < 0) || new Set(cards).size !== 5) throw new Error('need 5 distinct cards like As,Ks,Qs,Js,5s');
  const Wm = new Float64Array(32);
  for (let m = 0; m < 32; m++) {
    let k = 0, idx = 0;
    for (let i = 0; i < 5; i++) if (m & (1 << i)) { k++; idx += Cb[cards[i]][k]; }
    Wm[m] = k === 5 ? PAY[cat5[idx]] : k === 0 ? payK[0][0] : payK[k][idx];
  }
  for (let bit = 1; bit < 32; bit <<= 1) for (let m = 0; m < 32; m++) if (!(m & bit)) Wm[m] -= Wm[m | bit];
  const name = (c) => RANKS[c >> 2] + SUITS[c & 3];
  const holds = [...Array(32).keys()].map((m) => ({ m, ev: Wm[m] / C47[5 - POP[m]] })).sort((a, b) => b.ev - a.ev);
  console.log(`Deal: ${cards.map(name).join(' ')}  (royal ${PAY[9]} per coin)`);
  for (const { m, ev } of holds.slice(0, 8))
    console.log(`  hold [${[0, 1, 2, 3, 4].filter((i) => m & (1 << i)).map((i) => name(cards[i])).join(' ') || 'nothing'}]  EV ${ev.toFixed(6)}`);
  process.exit(0);
}

// ---------- main loop over all deals ----------
const W = new Float64Array(32);
const f = new Float64Array(32);
const subIdx = new Int32Array(32);
const subK = new Int8Array(32);
const rk = [0, 0, 0, 0, 0], st = [0, 0, 0, 0, 0];

const strategies = {
  optimal: { sum: 0, dist: new Float64Array(NC) },
  listNoExceptions: { sum: 0, dist: new Float64Array(NC), wrong: 0, ambiguous: 0 },
  listWithExceptions: { sum: 0, dist: new Float64Array(NC), wrong: 0, ambiguous: 0 },
  simple: { sum: 0, dist: new Float64Array(NC), wrong: 0, ambiguous: 0 },
};

function addDist(dist, m, nHeld) {
  // final-hand categories for hold m: inclusion-exclusion over supersets
  for (let s = m; s < 32; s = (s + 1) | m) {
    const sign = (POP[s] - nHeld) & 1 ? -1 : 1;
    if (s === 31) dist[cat5[subIdx[31]]] += sign * WEIGHT[nHeld];
    else { const k = subK[s], base = subIdx[s] * NC, arr = cntK[k]; for (let c = 0; c < NC; c++) dist[c] += sign * arr[base + c] * WEIGHT[nHeld]; }
  }
}

const EXAMPLES = { listNoExceptions: [], listWithExceptions: [] };
const cardName = (c) => RANKS[c >> 2] + SUITS[c & 3];

let deal = 0;
for (let e = 4; e < 52; e++) for (let d = 3; d < e; d++) for (let c = 2; c < d; c++)
  for (let b = 1; b < c; b++) for (let a = 0; a < b; a++) {
    hand[0] = a; hand[1] = b; hand[2] = c; hand[3] = d; hand[4] = e;
    for (let i = 0; i < 5; i++) { rk[i] = hand[i] >> 2; st[i] = hand[i] & 3; }
    for (let m = 0; m < 32; m++) {
      let k = 0, idx = 0;
      for (let i = 0; i < 5; i++) if (m & (1 << i)) { k++; idx += Cb[hand[i]][k]; }
      subIdx[m] = idx; subK[m] = k;
      W[m] = k === 5 ? PAY[cat5[idx]] : k === 0 ? payK[0][0] : payK[k][idx];
    }
    // Möbius transform over supersets: f[h] = sum_{s ⊇ h} (-1)^{|s|-|h|} W[s]
    for (let m = 0; m < 32; m++) f[m] = W[m];
    for (let bit = 1; bit < 32; bit <<= 1)
      for (let m = 0; m < 32; m++) if (!(m & bit)) f[m] -= f[m | bit];

    // Optimal hold (exact comparison of fractions f/C47).
    let best = 0;
    for (let m = 1; m < 32; m++) {
      const lhs = f[m] * C47[5 - POP[best]], rhs = f[best] * C47[5 - POP[m]];
      if (lhs > rhs) best = m;
    }
    const ev = (m) => f[m] / C47[5 - POP[m]];
    const bestEv = ev(best);
    strategies.optimal.sum += bestEv;
    addDist(strategies.optimal.dist, best, POP[best]);

    const cat = cat5[deal];
    for (const [name, fn] of [['listNoExceptions', (m) => entryOptimal(m, rk, st, cat)],
      ['listWithExceptions', (m) => withExceptions(m, entryOptimal(m, rk, st, cat), rk, st)],
      ['simple', (m) => entrySimple(m, rk, st, cat)]]) {
      let pick = -1, pickE = NONE + 1, tie = false;
      for (let m = 0; m < 32; m++) {
        const en = fn(m);
        if (en < pickE) { pickE = en; pick = m; tie = false; }
        else if (en === pickE && Math.abs(ev(m) - ev(pick)) > 1e-12) tie = true;
      }
      const s = strategies[name];
      s.sum += ev(pick);
      addDist(s.dist, pick, POP[pick]);
      if (ev(pick) < bestEv - 1e-12) {
        s.wrong++;
        if (EXAMPLES[name] && EXAMPLES[name].length < 12) {
          const held = [0, 1, 2, 3, 4].filter((i) => pick & (1 << i)).map((i) => cardName(hand[i])).join(' ');
          const opt = [0, 1, 2, 3, 4].filter((i) => best & (1 << i)).map((i) => cardName(hand[i])).join(' ');
          EXAMPLES[name].push(`${hand.map(cardName).join(' ')} | list holds [${held}] ${ev(pick).toFixed(4)} | best [${opt}] ${bestEv.toFixed(4)}`);
        }
      }
      if (tie) s.ambiguous++;
    }
    deal++;
  }

const DEALS = 2598960;
console.log('JACKS OR BETTER 9/6 - exact analysis over', DEALS.toLocaleString('en-US'), 'deals; royal pays', PAY[9], 'per coin');
for (const [name, s] of Object.entries(strategies)) {
  const ret = s.sum / DEALS;
  const tot = s.dist.reduce((x, y) => x + y, 0);
  let m1 = 0, m2 = 0;
  for (let c = 0; c < NC; c++) { const p = s.dist[c] / tot; m1 += PAY[c] * p; m2 += PAY[c] * PAY[c] * p; }
  console.log(`\n[${name}] return ${(ret * 100).toFixed(6)}%  (check ${(m1 * 100).toFixed(6)}%)  SD per hand (units of total bet) ${Math.sqrt(m2 - m1 * m1).toFixed(4)} bets`);
  if (s.wrong !== undefined) console.log(`  deals where this list is worse than optimal: ${s.wrong}  (same-line ties with different EV: ${s.ambiguous})`);
  for (let c = NC - 1; c >= 0; c--) {
    const p = s.dist[c] / tot;
    console.log(`  ${CAT[c].padEnd(16)} ${String(PAY[c]).padStart(4)}  ${Math.round(s.dist[c]).toString().padStart(18)}  ${p.toFixed(8)}  ${(PAY[c] * p).toFixed(8)}`);
  }
  console.log(`  total combinations ${Math.round(tot)}`);
}
for (const [name, list] of Object.entries(EXAMPLES)) {
  console.log(`\nfirst deals where [${name}] loses EV:`);
  for (const line of list) console.log('  ' + line);
}
```

</details>

### Slot machine A: `slot-a-classic-3reel.mjs`

Output is in 3.3.

<details><summary>Source</summary>

```js
// Machine A, "Classic Sevens": 3 reels, 1 payline, 1-3 coins (pays scale linearly).
// Each reel has 22 physical stops (11 symbols alternating with 11 blanks). A
// 64-entry virtual reel maps random numbers to physical stops; a stop's weight is
// how many of the 64 virtual stops point at it. The whole cycle is 64^3 = 262,144
// equally likely outcomes, all enumerated below.
//
// Run: node slot-a-classic-3reel.mjs

import { pathToFileURL } from 'node:url';

export const VIRTUAL_STOPS = 64;

// [symbol, weight] for physical stops 0..21 on each reel.
// Symbols: 7 = red seven, 3B/2B/1B = triple/double/single bar, CH = cherry, BL = blank.
export const REELS = [
  [['7', 2], ['BL', 3], ['1B', 4], ['BL', 3], ['CH', 4], ['BL', 2], ['2B', 4], ['BL', 3], ['1B', 3], ['BL', 2], ['3B', 3],
   ['BL', 3], ['CH', 4], ['BL', 2], ['1B', 3], ['BL', 3], ['2B', 3], ['BL', 2], ['CH', 4], ['BL', 3], ['3B', 2], ['BL', 2]],
  [['7', 2], ['BL', 3], ['2B', 3], ['BL', 3], ['CH', 4], ['BL', 3], ['1B', 4], ['BL', 3], ['3B', 3], ['BL', 3], ['2B', 3],
   ['BL', 3], ['1B', 3], ['BL', 3], ['CH', 4], ['BL', 3], ['2B', 2], ['BL', 3], ['1B', 3], ['BL', 2], ['3B', 2], ['BL', 2]],
  [['7', 2], ['BL', 3], ['1B', 4], ['BL', 3], ['3B', 3], ['BL', 3], ['2B', 3], ['BL', 3], ['CH', 3], ['BL', 3], ['1B', 4],
   ['BL', 3], ['2B', 3], ['BL', 3], ['3B', 3], ['BL', 3], ['1B', 3], ['BL', 3], ['CH', 3], ['BL', 2], ['2B', 2], ['BL', 2]],
];

// Pays per coin bet. Only the highest win on the line is paid.
export const PAYS = {
  'Three 7s': 1000,
  'Three triple bars': 100,
  'Three double bars': 50,
  'Three single bars': 20,
  'Any three bars': 5,
  'Three cherries': 20,
  'Cherries on reels 1 and 2': 5,
  'Cherry on reel 1': 2,
};

const isBar = (s) => s === '3B' || s === '2B' || s === '1B';

// Returns [combination name, pay per coin] for the three payline symbols.
export function evaluate([a, b, c]) {
  if (a === '7' && b === '7' && c === '7') return ['Three 7s', PAYS['Three 7s']];
  if (a === '3B' && b === '3B' && c === '3B') return ['Three triple bars', PAYS['Three triple bars']];
  if (a === '2B' && b === '2B' && c === '2B') return ['Three double bars', PAYS['Three double bars']];
  if (a === '1B' && b === '1B' && c === '1B') return ['Three single bars', PAYS['Three single bars']];
  if (isBar(a) && isBar(b) && isBar(c)) return ['Any three bars', PAYS['Any three bars']];
  if (a === 'CH' && b === 'CH' && c === 'CH') return ['Three cherries', PAYS['Three cherries']];
  if (a === 'CH' && b === 'CH') return ['Cherries on reels 1 and 2', PAYS['Cherries on reels 1 and 2']];
  if (a === 'CH') return ['Cherry on reel 1', PAYS['Cherry on reel 1']];
  return ['No win', 0];
}

// Virtual reel: index 0..63 -> physical stop. This is the table the server uses:
// draw a uniform integer in [0, 64) per reel, look up the physical stop, and the
// client spins that reel to that stop.
export function virtualReel(reel) {
  const map = [];
  reel.forEach(([, w], stop) => { for (let i = 0; i < w; i++) map.push(stop); });
  return map;
}

function main() {
  const maps = REELS.map((r, i) => {
    const m = virtualReel(r);
    if (r.length !== 22 || m.length !== VIRTUAL_STOPS) throw new Error(`reel ${i + 1}: ${r.length} stops, ${m.length} weights`);
    return m;
  });
  const tally = new Map();
  let total = 0, sum = 0, sumSq = 0, hits = 0;
  for (const v1 of maps[0].keys()) for (const v2 of maps[1].keys()) for (const v3 of maps[2].keys()) {
    const line = [REELS[0][maps[0][v1]][0], REELS[1][maps[1][v2]][0], REELS[2][maps[2][v3]][0]];
    const [name, pay] = evaluate(line);
    tally.set(name, (tally.get(name) || 0) + 1);
    total++; sum += pay; sumSq += pay * pay; if (pay > 0) hits++;
  }
  const rtp = sum / total, sd = Math.sqrt(sumSq / total - rtp * rtp);

  console.log('MACHINE A - Classic Sevens (3 reels, 1 line, 64 virtual stops per reel)');
  console.log('Symbol weights per reel (of 64):');
  for (const sym of ['7', '3B', '2B', '1B', 'CH', 'BL']) {
    const w = REELS.map((r) => r.filter(([s]) => s === sym).reduce((t, [, x]) => t + x, 0));
    const n = REELS.map((r) => r.filter(([s]) => s === sym).length);
    console.log(`  ${sym.padEnd(3)} weights ${w.map((x) => String(x).padStart(2)).join(' ')}   physical stops ${n.join(' ')}`);
  }
  console.log(`\n${'Combination'.padEnd(28)} ${'Pays'.padStart(5)} ${'Count'.padStart(7)} ${'Probability'.padStart(12)} ${'Return'.padStart(9)}`);
  for (const name of [...Object.keys(PAYS), 'No win']) {
    const n = tally.get(name) || 0, pay = PAYS[name] || 0;
    console.log(`${name.padEnd(28)} ${String(pay).padStart(5)} ${String(n).padStart(7)} ${(n / total).toFixed(8).padStart(12)} ${(n * pay / total).toFixed(6).padStart(9)}`);
  }
  console.log(`${'Total'.padEnd(28)} ${''.padStart(5)} ${String(total).padStart(7)}`);
  console.log(`\nReturn to player: ${sum} / ${total} = ${(rtp * 100).toFixed(4)}%`);
  console.log(`Hit frequency:    ${hits} / ${total} = ${(hits / total * 100).toFixed(4)}%`);
  console.log(`Standard deviation per spin: ${sd.toFixed(4)} (units of the amount bet)`);
  console.log(`Top award (three 7s): 1 in ${(total / tally.get('Three 7s')).toFixed(0)} spins`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

</details>

### Slot machine B: `slot-b-video-5reel.mjs`

Output (run with `--simulate=20000000`) is in 3.4.

<details><summary>Source</summary>

```js
// Machine B, "Neon Nights": 5 reels x 3 rows, 20 fixed lines, wild + scatter free spins.
//
// Base game: exact, by enumerating all 32^5 = 33,554,432 reel-stop combinations
// (every line and the scatter count evaluated on the full 5x3 window).
// Free spins: exact, by solving the retrigger recursion in closed form from the
// base-game distribution (free games use the same reels, all wins x3).
// Optional check: `--simulate=N` plays N paid spins, free games included, with a
// seeded generator and prints the measured return with its standard error.
//
// Run: node slot-b-video-5reel.mjs               (the enumeration takes about a second)
//      node slot-b-video-5reel.mjs --simulate=20000000

import { pathToFileURL } from 'node:url';

export const SYMBOLS = ['WILD', 'SCATTER', 'DIAMOND', 'SEVEN', 'BELL', 'HORSESHOE', 'A', 'K', 'Q', 'J', '10'];
const [W, S, D, SE, BE, HS, A, K, Q, J, T] = SYMBOLS.map((_, i) => i);

// Reel strips, 32 stops each. A stop s shows strip[s], strip[s+1], strip[s+2]
// (wrapping) in the top, middle and bottom rows.
export const STRIPS = [
  [D, T, A, BE, K, Q, SE, J, T, HS, A, S, K, Q, BE, J, T, D, A, K, HS, Q, J, T, SE, A, K, BE, Q, J, HS, T],
  [SE, J, K, W, Q, T, HS, A, J, D, K, Q, BE, S, J, T, W, A, K, HS, Q, BE, J, SE, K, T, W, Q, D, A, HS, BE],
  [A, BE, Q, W, K, D, T, J, HS, A, Q, S, K, SE, W, T, A, BE, J, K, HS, Q, W, A, D, T, K, BE, J, Q, SE, HS],
  [K, T, SE, Q, W, A, HS, J, K, BE, Q, T, D, A, S, J, W, K, HS, Q, A, BE, T, W, J, SE, K, Q, D, A, BE, HS],
  [Q, HS, T, A, D, K, J, W, Q, T, BE, A, S, K, SE, J, Q, HS, T, A, BE, K, W, Q, J, D, T, A, SE, K, BE, HS],
];

// Row (0 top, 1 middle, 2 bottom) on reels 1-5 for each of the 20 lines.
export const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1], [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 2, 2, 0],
];

// Line pays in credits per credit bet on the line, for 3, 4, 5 of a kind from reel 1.
export const LINE_PAYS = {
  [D]: [50, 200, 1000], [SE]: [30, 100, 500], [BE]: [20, 75, 250], [HS]: [15, 50, 200],
  [A]: [10, 30, 125], [K]: [10, 25, 100], [Q]: [5, 20, 100], [J]: [5, 15, 75], [T]: [5, 10, 50],
};
// Scatter pays, multiplied by the total bet, by number of scatters anywhere in the window.
export const SCATTER_PAYS = [0, 0, 0, 2, 10, 50];
export const FREE_SPINS = 10, FREE_SPIN_MULTIPLIER = 3, TRIGGER = 3;

const L = 32, NL = LINES.length, BET = NL; // one credit per line

function tables() {
  STRIPS.forEach((s, r) => { if (s.length !== L) throw new Error(`reel ${r + 1} has ${s.length} stops`); });
  if (STRIPS[0].includes(W)) throw new Error('wild must not appear on reel 1');
  // lineSym[r][s * NL + l]: symbol that line l reads on reel r when that reel stops at s.
  const lineSym = STRIPS.map(() => new Int8Array(L * NL));
  for (let r = 0; r < 5; r++) for (let s = 0; s < L; s++) for (let l = 0; l < NL; l++)
    lineSym[r][s * NL + l] = STRIPS[r][(s + LINES[l][r]) % L];
  const scat = STRIPS.map((strip) => Int8Array.from({ length: L }, (_, s) => [0, 1, 2].filter((k) => strip[(s + k) % L] === S).length));
  const pay = new Int32Array(SYMBOLS.length * 6);
  for (const [sym, p] of Object.entries(LINE_PAYS)) { pay[sym * 6 + 3] = p[0]; pay[sym * 6 + 4] = p[1]; pay[sym * 6 + 5] = p[2]; }
  return { lineSym, scat, pay };
}

// Win in credits for one spin given five stops (used by the simulator and as a spot check).
export function spinWin(stops, tb) {
  const { lineSym, scat, pay } = tb;
  let win = 0, sc = 0;
  for (let l = 0; l < NL; l++) {
    const first = lineSym[0][stops[0] * NL + l];
    if (first === S) continue;
    let n = 1;
    while (n < 5) { const x = lineSym[n][stops[n] * NL + l]; if (x === first || x === W) n++; else break; }
    win += pay[first * 6 + n];
  }
  for (let r = 0; r < 5; r++) sc += scat[r][stops[r]];
  return { win: win + SCATTER_PAYS[sc] * BET, trigger: sc >= TRIGGER, lineWin: win };
}

function exact(tb) {
  const { lineSym, scat, pay } = tb;
  const [ls0, ls1, ls2, ls3, ls4] = lineSym;
  const MAXW = 30000;
  const hist = new Float64Array(MAXW), histT = new Float64Array(MAXW);
  let lineSum = 0, scatterSum = 0;
  const f = new Int8Array(NL), a2 = new Uint8Array(NL), a3 = new Uint8Array(NL), alive = new Int32Array(NL);
  for (let s1 = 0; s1 < L; s1++) {
    for (let l = 0; l < NL; l++) f[l] = ls0[s1 * NL + l];
    for (let s2 = 0; s2 < L; s2++) {
      for (let l = 0; l < NL; l++) { const x = ls1[s2 * NL + l]; a2[l] = f[l] !== S && (x === f[l] || x === W) ? 1 : 0; }
      for (let s3 = 0; s3 < L; s3++) {
        for (let l = 0; l < NL; l++) { const x = ls2[s3 * NL + l]; a3[l] = a2[l] && (x === f[l] || x === W) ? 1 : 0; }
        for (let s4 = 0; s4 < L; s4++) {
          let fixed = 0, k = 0;
          for (let l = 0; l < NL; l++) if (a3[l]) {
            const x = ls3[s4 * NL + l];
            if (x === f[l] || x === W) alive[k++] = l; else fixed += pay[f[l] * 6 + 3];
          }
          const sc4 = scat[0][s1] + scat[1][s2] + scat[2][s3] + scat[3][s4];
          for (let s5 = 0; s5 < L; s5++) {
            let w = fixed;
            for (let i = 0; i < k; i++) {
              const l = alive[i], x = ls4[s5 * NL + l];
              w += pay[f[l] * 6 + (x === f[l] || x === W ? 5 : 4)];
            }
            const sc = sc4 + scat[4][s5];
            const sp = SCATTER_PAYS[sc] * BET;
            lineSum += w; scatterSum += sp;
            hist[w + sp]++;
            if (sc >= TRIGGER) histT[w + sp]++;
          }
        }
      }
    }
  }
  return { hist, histT, lineSum, scatterSum };
}

// Exact line return from symbol counts alone (every line has the same distribution,
// because each reel stop is uniform and a line reads one row per reel).
function lineReturnFromCounts() {
  const count = STRIPS.map((strip) => SYMBOLS.map((_, sym) => strip.filter((x) => x === sym).length));
  let num = 0; const rows = [];
  for (const sym of Object.keys(LINE_PAYS).map(Number)) {
    const ge = [0, count[0][sym]]; // ways (out of L^n) to get at least n in a row
    for (let r = 1; r < 5; r++) ge.push(ge[r] * (count[r][sym] + count[r][W]));
    for (let n = 3; n <= 5; n++) {
      const exactly = ge[n] * L ** (5 - n) - (n < 5 ? ge[n + 1] * L ** (4 - n) : 0);
      const p = LINE_PAYS[sym][n - 3];
      num += p * exactly;
      rows.push([SYMBOLS[sym], n, p, exactly]);
    }
  }
  return { num, den: L ** 5, rows };
}

function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0; d = d + 1 | 0;
    a = b ^ b >>> 9; b = c + (c << 3) | 0; c = c << 21 | c >>> 11; c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}

function simulate(n, tb) {
  const rand = sfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x12345678);
  const stops = [0, 0, 0, 0, 0];
  const spin = () => { for (let r = 0; r < 5; r++) stops[r] = Math.floor(rand() * L); return spinWin(stops, tb); };
  let sum = 0, sumSq = 0, features = 0, freeSpins = 0;
  for (let i = 0; i < n; i++) {
    const base = spin();
    let x = base.win;
    if (base.trigger) {
      features++;
      let left = FREE_SPINS;
      while (left > 0) {
        left--; freeSpins++;
        const fs = spin();
        x += FREE_SPIN_MULTIPLIER * fs.win;
        if (fs.trigger) left += FREE_SPINS;
      }
    }
    sum += x; sumSq += x * x;
  }
  const mean = sum / n / BET, sd = Math.sqrt(sumSq / n - (sum / n) ** 2) / BET;
  return { mean, sd, se: sd / Math.sqrt(n), features, freeSpins };
}

function main() {
  const tb = tables();
  const t0 = Date.now();
  const { hist, histT, lineSum, scatterSum } = exact(tb);
  const N = L ** 5;
  let EW = 0, EW2 = 0, EWT = 0, pT = 0, hits = 0;
  for (let w = 0; w < hist.length; w++) {
    if (!hist[w]) continue;
    EW += w * hist[w]; EW2 += w * w * hist[w]; if (w > 0) hits += hist[w];
    EWT += w * histT[w]; pT += histT[w];
  }
  EW /= N; EW2 /= N; EWT /= N; pT /= N;

  const m = FREE_SPIN_MULTIPLIER, F = FREE_SPINS;
  if (F * pT >= 1) throw new Error('retrigger rate makes the feature unbounded');
  const EA = m * EW / (1 - F * pT);
  const EA2 = (m * m * EW2 + 2 * m * F * EWT * EA + pT * F * (F - 1) * EA * EA) / (1 - F * pT);
  const EF = F * EA, EF2 = F * EA2 + F * (F - 1) * EA * EA;
  const EX = EW + pT * EF, EX2 = EW2 + 2 * EWT * EF + pT * EF2;

  const lr = lineReturnFromCounts();
  console.log('MACHINE B - Neon Nights (5x3, 20 lines, 1 credit per line, total bet 20 credits)');
  console.log(`Base-game enumeration: ${N.toLocaleString('en-US')} stop combinations in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log('\nSymbol counts per reel (32 stops each):');
  for (let sym = 0; sym < SYMBOLS.length; sym++)
    console.log(`  ${SYMBOLS[sym].padEnd(10)} ${STRIPS.map((s) => String(s.filter((x) => x === sym).length).padStart(2)).join(' ')}`);
  console.log('\nLine wins (exact, from symbol counts; each line has this distribution):');
  console.log(`  ${'Symbol'.padEnd(10)} ${'n'.padStart(2)} ${'Pays'.padStart(5)} ${'Ways of 32^5'.padStart(13)} ${'Return per line'.padStart(16)}`);
  for (const [name, n, p, ways] of lr.rows) console.log(`  ${name.padEnd(10)} ${String(n).padStart(2)} ${String(p).padStart(5)} ${String(ways).padStart(13)} ${(p * ways / lr.den).toFixed(6).padStart(16)}`);
  console.log(`  line return from counts:      ${lr.num} / ${lr.den} = ${(lr.num / lr.den * 100).toFixed(6)}%`);
  console.log(`  line return from enumeration: ${(lineSum / N / BET * 100).toFixed(6)}%`);
  console.log(`\nScatter pays return:           ${(scatterSum / N / BET * 100).toFixed(6)}%`);
  console.log(`Base game return (lines + scatters): ${(EW / BET * 100).toFixed(6)}%`);
  console.log(`Base game hit frequency:       ${(hits / N * 100).toFixed(4)}%  (1 in ${(N / hits).toFixed(2)})`);
  console.log(`Feature trigger probability:   ${(pT * 100).toFixed(6)}%  (1 in ${(1 / pT).toFixed(2)} paid spins)`);
  console.log(`Expected free spins per feature: ${(F / (1 - F * pT)).toFixed(4)}`);
  console.log(`Expected feature win:          ${(EF / BET).toFixed(4)} x total bet`);
  console.log(`Free-spin contribution:        ${(pT * EF / BET * 100).toFixed(6)}%  (analytic)`);
  console.log(`TOTAL RETURN TO PLAYER:        ${(EX / BET * 100).toFixed(6)}%`);
  console.log(`Standard deviation per paid spin (incl. feature): ${(Math.sqrt(EX2 - EX * EX) / BET).toFixed(4)} x total bet`);
  console.log(`Standard deviation per spin, base game only:      ${(Math.sqrt(EW2 - EW * EW) / BET).toFixed(4)} x total bet`);
  let top = 0; for (let w = hist.length - 1; w > 0; w--) if (hist[w]) { top = w; break; }
  console.log(`Largest single base-game spin: ${top} credits (${top / BET} x total bet), ${hist[top]} way(s) in 32^5`);

  const simArg = process.argv.find((a) => a.startsWith('--simulate='));
  if (simArg) {
    const n = Number(simArg.split('=')[1]);
    const t1 = Date.now();
    const r = simulate(n, tb);
    console.log(`\nSimulation, ${n.toLocaleString('en-US')} paid spins (seeded sfc32), ${((Date.now() - t1) / 1000).toFixed(1)} s:`);
    console.log(`  measured return ${(r.mean * 100).toFixed(4)}% +/- ${(r.se * 100).toFixed(4)}% (1 SE); SD per spin ${r.sd.toFixed(4)}`);
    console.log(`  features ${r.features} (1 in ${(n / r.features).toFixed(1)}), free spins played ${r.freeSpins} (${(r.freeSpins / r.features).toFixed(3)} per feature)`);
    console.log(`  difference from exact: ${((r.mean - EX / BET) / r.se).toFixed(2)} SE`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

</details>

### Slot machine C: `slot-c-wild-3reel.mjs`

Output is in 3.5.

<details><summary>Source</summary>

```js
// Machine C, "5x Wild": high-volatility 3-reel, 1 payline, 1-3 coins (linear).
// 22 physical stops per reel, 72 virtual stops per reel, cycle 72^3 = 373,248.
// The 5X symbol is wild for 7s and bars and multiplies the win: one 5X pays x5,
// two pay x25. Three 5X pay the top award.
//
// Run: node slot-c-wild-3reel.mjs

import { pathToFileURL } from 'node:url';

export const VIRTUAL_STOPS = 72;

// [symbol, weight] for physical stops 0..21. WX = 5X wild, BL = blank.
export const REELS = [
  [['WX', 2], ['BL', 4], ['1B', 3], ['BL', 5], ['2B', 2], ['BL', 4], ['7', 2], ['BL', 5], ['1B', 3], ['BL', 4], ['3B', 2],
   ['BL', 5], ['1B', 2], ['BL', 4], ['2B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['3B', 1], ['BL', 5], ['2B', 2], ['BL', 4]],
  [['WX', 2], ['BL', 4], ['2B', 2], ['BL', 5], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['7', 2],
   ['BL', 5], ['2B', 2], ['BL', 4], ['1B', 2], ['BL', 5], ['3B', 2], ['BL', 4], ['1B', 2], ['BL', 5], ['2B', 2], ['BL', 4]],
  [['WX', 1], ['BL', 5], ['1B', 3], ['BL', 4], ['3B', 2], ['BL', 5], ['2B', 2], ['BL', 4], ['1B', 3], ['BL', 5], ['7', 2],
   ['BL', 4], ['1B', 2], ['BL', 5], ['2B', 2], ['BL', 4], ['3B', 2], ['BL', 5], ['1B', 2], ['BL', 4], ['2B', 2], ['BL', 4]],
];

// Base pays per coin; the multiplier applies when 5X symbols complete the win.
export const BASE = { '7': 100, '3B': 40, '2B': 25, '1B': 10 };
export const ANY_BAR = 5;
export const THREE_WILDS = 5000;
export const TWO_WILDS_ONLY = 10;   // two 5X with a symbol they cannot complete (for example a blank)
export const ONE_WILD_ONLY = 2;     // one 5X and no other win

const isBar = (s) => s === '3B' || s === '2B' || s === '1B';

// Returns [combination name, pay per coin]. Only the highest win is paid.
export function evaluate(line) {
  const wilds = line.filter((s) => s === 'WX').length;
  if (wilds === 3) return ['5X 5X 5X', THREE_WILDS];
  const rest = line.filter((s) => s !== 'WX');
  const mult = 5 ** wilds;
  let best = 0, name = '';
  if (rest.every((s) => s === rest[0]) && BASE[rest[0]]) { best = BASE[rest[0]] * mult; name = `Three ${rest[0]}`; }
  if (rest.every(isBar) && ANY_BAR * mult > best) { best = ANY_BAR * mult; name = 'Any three bars'; }
  if (best > 0) return [wilds ? `${name} with ${wilds} wild` : name, best];
  if (wilds === 2) return ['Two 5X, no line win', TWO_WILDS_ONLY];
  if (wilds === 1) return ['One 5X, no line win', ONE_WILD_ONLY];
  return ['No win', 0];
}

export function virtualReel(reel) {
  const map = [];
  reel.forEach(([, w], stop) => { for (let i = 0; i < w; i++) map.push(stop); });
  return map;
}

function main() {
  const maps = REELS.map((r, i) => {
    const m = virtualReel(r);
    if (r.length !== 22 || m.length !== VIRTUAL_STOPS) throw new Error(`reel ${i + 1}: ${r.length} stops, ${m.length} weights`);
    return m;
  });
  const tally = new Map();
  let total = 0, sum = 0, sumSq = 0, hits = 0;
  for (const v1 of maps[0].keys()) for (const v2 of maps[1].keys()) for (const v3 of maps[2].keys()) {
    const line = [REELS[0][maps[0][v1]][0], REELS[1][maps[1][v2]][0], REELS[2][maps[2][v3]][0]];
    const [name, pay] = evaluate(line);
    const t = tally.get(name) || { n: 0, pay }; t.n++; tally.set(name, t);
    total++; sum += pay; sumSq += pay * pay; if (pay > 0) hits++;
  }
  const rtp = sum / total, sd = Math.sqrt(sumSq / total - rtp * rtp);

  console.log('MACHINE C - 5x Wild (3 reels, 1 line, 72 virtual stops per reel)');
  console.log('Symbol weights per reel (of 72):');
  for (const sym of ['WX', '7', '3B', '2B', '1B', 'BL']) {
    const w = REELS.map((r) => r.filter(([s]) => s === sym).reduce((t, [, x]) => t + x, 0));
    const n = REELS.map((r) => r.filter(([s]) => s === sym).length);
    console.log(`  ${sym.padEnd(3)} weights ${w.map((x) => String(x).padStart(2)).join(' ')}   physical stops ${n.join(' ')}`);
  }
  console.log(`\n${'Combination'.padEnd(30)} ${'Pays'.padStart(5)} ${'Count'.padStart(7)} ${'Probability'.padStart(12)} ${'Return'.padStart(9)}`);
  const rows = [...tally.entries()].sort((a, b) => b[1].pay - a[1].pay || b[1].n - a[1].n);
  for (const [name, { n, pay }] of rows)
    console.log(`${name.padEnd(30)} ${String(pay).padStart(5)} ${String(n).padStart(7)} ${(n / total).toFixed(8).padStart(12)} ${(n * pay / total).toFixed(6).padStart(9)}`);
  console.log(`${'Total'.padEnd(30)} ${''.padStart(5)} ${String(total).padStart(7)}`);
  console.log(`\nReturn to player: ${sum} / ${total} = ${(rtp * 100).toFixed(4)}%`);
  console.log(`Hit frequency:    ${hits} / ${total} = ${(hits / total * 100).toFixed(4)}%`);
  console.log(`Standard deviation per spin: ${sd.toFixed(4)} (units of the amount bet)`);
  console.log(`Top award (three 5X): 1 in ${(total / tally.get('5X 5X 5X').n).toFixed(0)} spins`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

</details>

### Slot machines D, E and F: `slot-d-diamond-line.mjs`, `slot-e-lucky-cherries.mjs`, `slot-f-gold-rush.mjs`

Their output is in 3.7, 3.8 and 3.9; the scripts are in [../math/](../math/) (`node docs/math/slot-e-lucky-cherries.mjs --simulate=20000000`
adds a seeded simulation of that many paid spins).

### Poker hand counts: `holdem-hand-counts.mjs`

```text

5-card hands: 2,598,960 (0.1 s)
  Royal flush                 4  0.00000154
  Straight flush             36  0.00001385
  Four of a kind            624  0.00024010
  Full house              3,744  0.00144058
  Flush                   5,108  0.00196540
  Straight               10,200  0.00392465
  Three of a kind        54,912  0.02112845
  Two pair              123,552  0.04753902
  One pair            1,098,240  0.42256903
  High card           1,302,540  0.50117739

7-card hands: 133,784,560 (2.5 s)
  Royal flush             4,324  0.00003232
  Straight flush         37,260  0.00027851
  Four of a kind        224,848  0.00168067
  Full house          3,473,184  0.02596102
  Flush               4,047,644  0.03025494
  Straight            6,180,020  0.04619382
  Three of a kind     6,461,620  0.04829870
  Two pair           31,433,400  0.23495536
  One pair           58,627,800  0.43822546
  High card          23,294,460  0.17411920
```

<details><summary>Source</summary>

```js
// Poker hand category counts for evaluator tests: every 5-card hand
// (2,598,960) and every 7-card set (133,784,560, best five of seven).
// Run: node holdem-hand-counts.mjs     (about half a minute)

const NAMES = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush',
  'Full house', 'Four of a kind', 'Straight flush', 'Royal flush'];

// STRAIGHT[mask] is true when the 13-bit rank mask holds five consecutive ranks
// (A-2-3-4-5 counts; bit 0 = deuce, bit 12 = ace).
const STRAIGHT = new Uint8Array(8192);
for (let m = 0; m < 8192; m++) {
  let ok = (m & 0b1000000001111) === 0b1000000001111; // wheel A-2-3-4-5
  for (let lo = 0; lo <= 8; lo++) if (((m >> lo) & 31) === 31) ok = true;
  STRAIGHT[m] = ok ? 1 : 0;
}
const ROYAL = 0b1111100000000;

const rankCount = new Int8Array(13);
const suitCount = new Int8Array(4);
const suitMask = new Int32Array(4);
const bucket = new Int32Array(5); // number of ranks held exactly k times
let rankMask = 0;

function add(c) {
  const r = c >> 2, s = c & 3, old = rankCount[r];
  bucket[old]--; bucket[old + 1]++; rankCount[r] = old + 1;
  if (old === 0) rankMask |= 1 << r;
  suitCount[s]++; suitMask[s] |= 1 << r;
}
function remove(c) {
  const r = c >> 2, s = c & 3, old = rankCount[r];
  bucket[old]--; bucket[old - 1]++; rankCount[r] = old - 1;
  if (old === 1) rankMask &= ~(1 << r);
  suitCount[s]--; suitMask[s] &= ~(1 << r);
}
function category() {
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) {
    const m = suitMask[s];
    if ((m & ROYAL) === ROYAL) return 9;
    return STRAIGHT[m] ? 8 : 5;       // quads or a full house cannot coexist with a flush in 7 cards
  }
  if (bucket[4]) return 7;
  if (bucket[3] >= 2 || (bucket[3] && bucket[2])) return 6;
  if (STRAIGHT[rankMask]) return 4;
  if (bucket[3]) return 3;
  if (bucket[2] >= 2) return 2;
  if (bucket[2]) return 1;
  return 0;
}

function enumerate(k) {
  const counts = new Array(10).fill(0);
  bucket.fill(0); bucket[0] = 13;
  const rec = (start, depth) => {
    if (depth === k) { counts[category()]++; return; }
    for (let c = start; c <= 52 - (k - depth); c++) { add(c); rec(c + 1, depth + 1); remove(c); }
  };
  rec(0, 0);
  return counts;
}

for (const k of [5, 7]) {
  const t0 = Date.now();
  const counts = enumerate(k);
  const total = counts.reduce((a, b) => a + b, 0);
  console.log(`\n${k}-card hands: ${total.toLocaleString('en-US')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (let c = 9; c >= 0; c--) console.log(`  ${NAMES[c].padEnd(16)} ${counts[c].toLocaleString('en-US').padStart(12)}  ${(counts[c] / total).toFixed(8)}`);
}
```

</details>
