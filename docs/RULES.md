# Rules and Odds

Every game in the casino follows standard Las Vegas Strip rules and pays real odds. This page
is the summary. The full rules, every paytable, the strategy charts and the sources are in:

- [rules/table-games.md](rules/table-games.md): blackjack, roulette, craps, baccarat, Casino War,
  the Big Six wheel, Sic Bo and the Bandit Wheel
- [rules/cards-and-machines.md](rules/cards-and-machines.md): Three Card Poker, video poker,
  slots, Texas Hold'em
- [rules/online-games.md](rules/online-games.md): the online games on the lounge computers
- [math/](math/): the dependency-free Node scripts that enumerate each game exactly
  (`node docs/math/three-card-poker.mjs` and so on)

## How the numbers are checked

- **Money is exact.** Balances are integer cents, table bets are whole dollars, and every payout
  is paid to the cent with no rounding. The few craps bets that would need fractions of a cent
  take bets in their real-table steps instead (place 6/8 in $6 units, lay bets in $2, $3 or $6
  units). Hold'em pots that don't split evenly give the odd chip to the first winner left of
  the button. Online Dice, whose multiplier (99 over the win chance) is rarely a whole number of
  cents, floors each win to the cent, and its published return includes that floor exactly. Tower,
  Mines and Hi-Lo floor their multipliers to the cent the same way (Hi-Lo only when it pays), and
  their published returns include that floor exactly too.
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
| Big Six Wheel | 54 stops: $1 ×24, $2 ×15, $5 ×7, $10 ×4, $20 ×2, Star and Crown pay 40:1 | $1 (1:1) | 11.111% | 11.109% (10M spins, z −0.08) |
| | | $2, $5, $10, $20 | 16.667%, 22.222%, 18.519%, 22.222% | 16.705%, 22.147%, 18.492%, 22.299% (10M spins, z +0.91, −1.18, −0.29, +0.61) |
| | | Star, Crown (40:1) | 24.074% | 23.921%, 24.214% (10M spins, z −0.87, +0.80) |
| Bandit Wheel | Rust's big wheel: 25 slots, 1 ×12, 3 ×6, 5 ×4, 10 ×2, 20 ×1; a win pays the number to 1 and the bet back | 1, 3 or 5 (1:1, 3:1, 5:1) | 4.000% | 3.965%, 3.979%, 4.106% (10M spins, z −1.12, −0.39, +1.53) |
| | | 10 (10:1) | 12.000% | 12.085% (10M spins, z +0.90) |
| | | 20 (20:1) | 16.000% | 15.946% (10M spins, z −0.41) |
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
| Casino War | 6 decks, cover card a quarter from the bottom; on a tie surrender half or go to war (raise equal to the bet, burn three); a tie in the war pays the raise 2:1; Tie bet 10:1 | Bet, going to war on every tie | 2.330% | 2.323% (10M rounds, z −0.21) |
| | | Bet, surrendering every tie | 3.698% | 3.719% (10M rounds, z +0.69) |
| | | Tie bet | 18.650% | 18.642% (10M rounds, z −0.08) |
| Video poker | Jacks or Better 9/6, 5 coins, optimal hold list | | 99.544% RTP | 99.447% (20M hands, z −1.00) |
| Slots | six machines, published reel strips | A "Classic Sevens" (3 reels) | 94.428% RTP | 94.563% (10M spins, z +0.65) |
| | | B "Neon Nights" (5x3, 20 lines, free spins) | 95.374% RTP | 95.325% (10M spins, z −0.41) |
| | | C "5x Wild" (3 reels, high volatility) | 89.820% RTP | 89.968% (50M spins, z +0.39) |
| Sic Bo | three dice in an automated shaker, US (Atlantic City) pay table, Odd and Even offered | Small, Big, Odd, Even (lose to any triple) | 2.778% | 2.755%, 2.781%, 2.754%, 2.782% (4M rolls, z −0.46, +0.06, −0.48, +0.08) |
| | | Single number (1, 2 or 3 to 1) | 7.870% | 7.814% on 4 (4M rolls, z −1.01) |
| | | Totals: 7 or 14 at 12:1 (best) to 9 or 12 at 6:1 (worst) | 9.722% to 18.981% | 9.507% on 7, 19.080% on 9 (4M rolls, z −1.30, +0.88) |
| | | Specific triple (180:1) / any triple (30:1) | 16.204% / 13.889% | 15.799% on 6-6-6, 14.197% (4M rolls, z −0.66, +1.21) |
| | | Double (10:1) / two-dice combination (5:1) | 18.519% / 16.667% | 18.524% on 5-5, 16.857% on 2-5 (4M rolls, z +0.04, +1.84) |
| | | D "Diamond Line" (3 reels, doubling diamond wild) | 94.983% RTP | 94.929% (10M spins, z −0.28) |
| | | E "Lucky Cherries" (5x3, 10 lines, Cherry Wheel) | 94.028% RTP | 94.126% (10M spins, z +0.90) |
| | | F "Gold Rush" (5x4, 40 lines, sticky-wild free games) | 92.994% RTP | 93.138% (10M spins, z +1.22) |
| Texas Hold'em | no-limit, blinds, Poker TDA rules, no rake | | no house edge | every seat within 1.2 SE of 0 (300K hands, 6 seats); deals uniform (chi-square z 0.45, 2M deals) |
| Plinko (online) | 8 to 16 rows, Low/Medium/High (Stake's tables), each bounce 50/50 | 16 rows High (top pay 1,000×) | 98.976% RTP | 98.938% (4M drops, z −0.12) |
| | | 11 rows High (best) / 8 rows Medium (worst) | 99.160% / 98.906% RTP | 99.405% / 98.913% (4M drops, z +1.18, +0.10) |
| | | Every board | 98.906% to 99.160% RTP | all 27 within 2.2 SE (4M drops each) |
| Dice (online) | roll 0.00 to 99.99 over or under a target, multiplier 99/chance, wins floored to the cent | 49.50% (2×), $1 | 99.000% RTP | 98.978% (10M rolls, z −0.68) |
| | | 70% at $1 (the floor costs 0.3 points) | 98.700% RTP | 98.700% (10M rolls, z +0.01) |
| | | Any chance, any bet | 98.031% (97.06% at $1) to 99.000% RTP | 8 bets within 1.4 SE (10M rolls) |
| Limbo (online) | target 1.01× to 1,000,000×, P(result ≥ x) = 0.99/x exactly | Every target | 99.000% RTP | 98.974% at 2× (10M bets, z −0.83); 9 targets to 100,000× within 1.5 SE |
| Keno (online) | 40 numbers, 10 drawn, 1 to 10 picks, Classic/Low/Medium/High (Stake's tables) | Classic, 10 picks | 99.037% RTP | 99.057% (5M draws, z +0.32) |
| | | Every table | 98.654% to 99.069% RTP | all 40 within 1.9 SE (5M draws) |
| Tower (online) | 9 rows; Easy 4 tiles/1 dragon, Medium 3/1, Hard 2/1, Expert 3/2, Master 4/3 (Stake's Dragon Tower rows); a row pays 0.99 ÷ P(survive), floored to the cent | Hard, Expert, Master: any row | 99.000% RTP | 98.970% Hard row 1, 98.891% Master row 1 (4M climbs, z −0.61, −1.27); 4 more rows within 1.6 SE |
| | | Easy, Medium: by row (the floor costs up to 0.33 points) | 98.667% to 99.000% RTP | Medium row 2 98.623%, Easy row 9 98.820% (4M climbs, z −0.79, −0.82) |
| Mines (online) | 5×5, 1 to 24 mines; after k gems pays 0.99 · C(25, k) / C(25 − m, k), floored to the cent | 3 mines, 5 gems (1.99×) | 98.635% RTP | 98.683% (4M boards, z +0.97) |
| | | Every (mines, gems) cell | 98.28% to 99.000% RTP | 10 cells within 1.6 SE (4M boards each) |
| Hi-Lo (online) | cards with replacement; higher or same / lower or same (strict on an ace or a king); a guess on c ranks pays 12.87/c, the product floored at payout | One guess on the likelier side, then cash out | 98.728% RTP | 98.739% (10M rounds, z +0.62) |
| | | Skip to an A, 3, 5, 9, J or K, then one guess | 99.000% RTP | exact (enumerated) |
| | | Each further guess | 99% of what rides | two guesses 97.822%, three 96.824% (10M rounds, z +0.20, −0.18) |
| Crash (online) | shared rounds, m(t) = e^(0.00006 t); P(crash point > x) = 0.99/x, so 1% of rounds end at 1.00×; paid only below the crash point | Every cash-out, auto or pressed | 99.000% RTP | 98.968% at 2× (10M rounds, z −1.03); 5 targets to 100× within 1.6 SE; presses through the engine 99.152% (60K rounds, z +0.39) |

The blackjack figure is for exactly these rules. The often-quoted 0.26-0.28% assumes aces can be
resplit, which this table doesn't allow, and a cut card adds about 0.02 points over dealing each
round from a fresh shoe (0.334%).

The Casino War figure most often quoted, 2.88%, is for tables that pay a tie in the war only even
money on the raise. Pennsylvania's rules and the Mirage pay it 2:1 (a bonus equal to the bet), which
brings the edge down to 2.33%. Going to war always beats surrendering, whatever rank tied.
