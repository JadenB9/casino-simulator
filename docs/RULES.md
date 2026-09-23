# Rules and Odds

Every game in the casino follows standard Las Vegas Strip rules and pays real odds. This page
is the summary. The full rules, every paytable, the strategy charts and the sources are in:

- [rules/table-games.md](rules/table-games.md): blackjack, roulette, craps, baccarat, Sic Bo
- [rules/cards-and-machines.md](rules/cards-and-machines.md): Three Card Poker, video poker,
  slots, Texas Hold'em
- [math/](math/): the dependency-free Node scripts that enumerate each game exactly
  (`node docs/math/three-card-poker.mjs` and so on)

## How the numbers are checked

- **Money is exact.** Balances are integer cents, table bets are whole dollars, and every payout
  is paid to the cent with no rounding. The few craps bets that would need fractions of a cent
  take bets in their real-table steps instead (place 6/8 in $6 units, lay bets in $2, $3 or $6
  units). Hold'em pots that don't split evenly give the odd chip to the first winner left of
  the button.
- **The server draws every card and number** with `crypto.getRandomValues` and rejection
  sampling (no modulo bias), and shuffles shoes with Fisher-Yates.
- **Rule tables are tested cell by cell** (the blackjack chart, the baccarat drawing rules, the
  video poker hold list, every paytable), because one wrong cell moves an edge by less than any
  simulation can see.
- **Exact enumeration** checks the engines wherever the outcome space is small enough.
- **Monte Carlo tests** play millions of rounds per game and require the measured edge to land
  within 3 standard errors of the published one. Seeds are fixed so the suite is deterministic.

## Summary

House edge is the expected loss divided by the initial wager (the Ante for Three Card Poker);
return to player (RTP) is 1 minus that. "Measured" is the Monte Carlo suite's result with its
sample size and how many standard errors it landed from the published figure (z); every one is
inside 3. Seeds are fixed, so `npm run test:mc` reproduces these exactly.

| Game | Rules | Bet | Published | Measured |
|---|---|---|---|---|
| Blackjack | 6 decks, dealer stands on soft 17, blackjack pays 3:2, double any two, double after split, split to 4 hands, no resplitting aces, late surrender, dealer peeks, insurance 2:1, cut card at 75% | Basic strategy, cut card | 0.354% | 0.328% (12M rounds, z −0.80) |
| Roulette (American) | 0 and 00, all inside and outside bets | Every bet but the top line | 5.263% | red 5.229%, odd 5.222%, straight 17 5.748% (3M spins, z −0.59, −0.72, +1.46) |
| | | Top line (0-00-1-2-3), 6:1 | 7.895% | 7.924% (3M spins, z +0.21) |
| Roulette (European) | single 0, no la partage | Every bet | 2.703% | red 2.717%, odd 2.601%, straight 17 2.813% (3M spins, z +0.24, −1.77, +0.33) |
| Craps | 3-4-5x odds, field pays 3:1 on 12, buy 4/10 with commission on a win, place bets off on the come-out | Pass line | 1.414% | 1.426% (4M bets, z +0.24) |
| | | Don't pass (bar 12) | 1.364% | 1.389% (2M bets, z +0.37) |
| | | Place 6 or 8 (7:6) | 1.515% | 1.658% (2M bets, z +1.87) |
| | | Field | 2.778% | 2.712% (4M bets, z −1.16) |
| | | Free odds | 0% | 0 exactly (enumerated) |
| Baccarat | punto banco, 8 decks, standard tableau, 5% commission, tie 8:1 | Banker | 1.058% | 1.011% (10M coups, z −1.60) |
| | | Player | 1.235% | 1.283% (10M coups, z +1.59) |
| | | Tie | 14.360% | 14.300% (10M coups, z −0.72) |
| Three Card Poker | dealer qualifies with queen high; Ante Bonus 5-4-1; Pair Plus 40-30-6-3-1 | Ante and Play, Q-6-4 strategy | 3.373% | 3.384% (10M hands, z +0.20) |
| | | Pair Plus | 7.276% | 7.264% (10M hands, z −0.14) |
| Video poker | Jacks or Better 9/6, 5 coins, optimal hold list | | 99.544% RTP | 99.447% (20M hands, z −1.00) |
| Slots | three machines, published reel strips | A "Classic Sevens" (3 reels) | 94.428% RTP | 94.563% (10M spins, z +0.65) |
| | | B "Neon Nights" (5x3, 20 lines, free spins) | 95.374% RTP | 95.325% (10M spins, z −0.41) |
| | | C "5x Wild" (3 reels, high volatility) | 89.820% RTP | 89.968% (50M spins, z +0.39) |
| Sic Bo | three dice in an automated shaker, US (Atlantic City) pay table, Odd and Even offered | Small, Big, Odd, Even (lose to any triple) | 2.778% | 2.755%, 2.781%, 2.754%, 2.782% (4M rolls, z −0.46, +0.06, −0.48, +0.08) |
| | | Single number (1, 2 or 3 to 1) | 7.870% | 7.814% on 4 (4M rolls, z −1.01) |
| | | Totals: 7 or 14 at 12:1 (best) to 9 or 12 at 6:1 (worst) | 9.722% to 18.981% | 9.507% on 7, 19.080% on 9 (4M rolls, z −1.30, +0.88) |
| | | Specific triple (180:1) / any triple (30:1) | 16.204% / 13.889% | 15.799% on 6-6-6, 14.197% (4M rolls, z −0.66, +1.21) |
| | | Double (10:1) / two-dice combination (5:1) | 18.519% / 16.667% | 18.524% on 5-5, 16.857% on 2-5 (4M rolls, z +0.04, +1.84) |
| Texas Hold'em | no-limit, blinds, Poker TDA rules, no rake | | no house edge | every seat within 1.2 SE of 0 (300K hands, 6 seats); deals uniform (chi-square z 0.45, 2M deals) |

The blackjack figure is for exactly these rules. The often-quoted 0.26-0.28% assumes aces can be
resplit, which this table doesn't allow, and a cut card adds about 0.02 points over dealing each
round from a fresh shoe (0.334%).
