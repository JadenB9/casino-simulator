# Rules and Odds

Every game in the casino follows standard Las Vegas Strip rules and pays real odds. This page
is the summary. The full rules, every paytable, the strategy charts and the sources are in:

- [rules/table-games.md](rules/table-games.md): blackjack, roulette, craps, baccarat
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
return to player (RTP) is 1 minus that. "Measured" is filled in by the Monte Carlo suite.

| Game | Rules | Bet | Published | Measured |
|---|---|---|---|---|
| Blackjack | 6 decks, dealer stands on soft 17, blackjack pays 3:2, double any two, double after split, split to 4 hands, no resplitting aces, late surrender, dealer peeks, insurance 2:1, cut card at 75% | Basic strategy, cut card | 0.354% | |
| Roulette (American) | 0 and 00, all inside and outside bets | Every bet but the top line | 5.263% | |
| | | Top line (0-00-1-2-3), 6:1 | 7.895% | |
| Roulette (European) | single 0, no la partage | Every bet | 2.703% | |
| Craps | 3-4-5x odds, field pays 3:1 on 12, buy 4/10 with commission on a win, place bets off on the come-out | Pass line | 1.414% | |
| | | Don't pass (bar 12) | 1.364% | |
| | | Place 6 or 8 (7:6) | 1.515% | |
| | | Field | 2.778% | |
| | | Free odds | 0% | |
| Baccarat | punto banco, 8 decks, standard tableau, 5% commission, tie 8:1 | Banker | 1.058% | |
| | | Player | 1.235% | |
| | | Tie | 14.360% | |
| Three Card Poker | dealer qualifies with queen high; Ante Bonus 5-4-1; Pair Plus 40-30-6-3-1 | Ante and Play, Q-6-4 strategy | 3.373% | |
| | | Pair Plus | 7.276% | |
| Video poker | Jacks or Better 9/6, 5 coins, optimal hold list | | 99.544% RTP | |
| Slots | three machines, published reel strips | A "Classic Sevens" (3 reels) | 94.428% RTP | |
| | | B "Neon Nights" (5x3, 20 lines, free spins) | 95.374% RTP | |
| | | C "5x Wild" (3 reels, high volatility) | 89.820% RTP | |
| Texas Hold'em | no-limit, blinds, Poker TDA rules, no rake | | no house edge | |

The blackjack figure is for exactly these rules. The often-quoted 0.26-0.28% assumes aces can be
resplit, which this table doesn't allow, and a cut card adds about 0.02 points over dealing each
round from a fresh shoe (0.334%).
