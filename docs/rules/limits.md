# Table limits, buy-ins and Max

Every table's minimum and maximum bet is chosen by whoever starts it: a solo table each time you
sit down, a lobby when it is created. The choice is one of the game's tiers or a custom pair of
amounts. The rules live once in `shared/src/limits.ts`; the station panel shows them as you pick,
and the server moves anything a client sends to the nearest table the game allows. Limits change
how much can be bet, never what a bet pays, so every published return in these pages holds at every
table.

## Choosing them

The station panel (press E at a table) opens on the game's tiers with your last pick for that game
already chosen, so one key still sits you down. Single player opens your table at the picked limits;
Multiplayer shows the open lobbies, each with its limits, and Start a table opens a new one at the
picked limits. A private lobby's PIN shows its table (host, limits, seats) before you join it.

| Game | Low | Standard | High | High limit | Salon | Penthouse | Custom |
|---|---|---|---|---|---|---|---|
| Blackjack | $5–$500 | $25–$5,000 | $100–$10,000 | $500–$50,000 | $1,000–$100,000 | $5,000–$500,000 | to $1,000,000 |
| Roulette (outside bets) | $1–$1,000 | $5–$5,000 | $25–$10,000 | $100–$50,000 | $1,000–$100,000 | $5,000–$500,000 | to $1,000,000 |
| Craps (line bets) | $5–$1,000 | $10–$5,000 | $25–$10,000 | $100–$50,000 | $1,000–$100,000 | $5,000–$500,000 | to $1,000,000 |
| Baccarat (Player, Banker) | $5–$1,000 | $10–$5,000 | $50–$10,000 | $100–$50,000 | $1,000–$100,000 | $5,000–$500,000 | to $1,000,000 |
| Three Card Poker (Ante) | $5–$500 | $10–$1,000 | $25–$5,000 | $100–$10,000 | $1,000–$100,000 | $5,000–$500,000 | to $1,000,000 |
| Casino War (the bet) | $5–$500 | $10–$1,000 | $25–$5,000 | $100–$10,000 | $1,000–$100,000 | $5,000–$500,000 | to $1,000,000 |
| Sic Bo (Small, Big, Odd, Even) | $1–$500 | $5–$5,000 | $25–$10,000 | $100–$50,000 | $1,000–$100,000 | $5,000–$500,000 | to $1,000,000 |
| Big Six (each spot) | $1–$100 | $1–$500 | $5–$1,000 | $25–$5,000 | $100–$25,000 | $1,000–$100,000 | to $100,000 |
| Bandit Wheel, the online games | $1–$100 | $1–$1,000 | $5–$5,000 | $25–$10,000 | $100–$50,000 | $1,000–$100,000 | to $100,000 |

Texas Hold'em chooses its blinds, from the micros to the nosebleeds: $0.50/$1, $1/$2, $2/$5, **$5/$10**
(Standard), $10/$20, $25/$50, $50/$100, $100/$200, $250/$500, $500/$1,000, $1,000/$2,000,
$5,000/$10,000, $25,000/$50,000, $100,000/$200,000, or custom: any small blind of $0.50 or whole
dollars up to $100,000, and a big blind two to three times it in whole dollars. At $0.50/$1 bets go in
half dollars. The bots at a solo table are drawn by the stakes: loose, passive players at the micros,
strong regulars at the top ([cards-and-machines.md](cards-and-machines.md) 4.9).

**Custom limits**, for a game of bets: the minimum is $1 up to a tenth of the game's ceiling ($100,000
at the tables, $10,000 at Big Six, the Bandit Wheel and the online games), in whole dollars; the
maximum is at least ten times the minimum and at most the ceiling, in whole dollars. The panel says
which rule a pair breaks as you type it; the server clamps the minimum into its range and then the
maximum into the range that minimum allows, and a body whose limits aren't two amounts is refused.

## The rest of a table follows its headline

Each engine's own config is its Standard table. A table at other limits keeps the Standard table's
shape: every other bet's minimum scales with the chosen minimum and its maximum with the chosen
maximum, in the proportion the Standard table has, rounded up (minimums) or down (maximums) to that
bet's step. So at every table:

- **Roulette:** inside bets a number from a fifth of the minimum to a tenth of the maximum; at most
  twice the maximum on the layout a spin. (Standard: inside $1–$500, outside $5–$5,000, $10,000 a spin.)
- **Craps:** the line bet is the headline; odds up to five times its maximum and laid odds six times,
  so full 3-4-5x odds (6x laid) always fit behind a maximum line bet; place, buy, lay, field, big 6/8,
  hardways and the one-roll bets in the Standard proportions, each in its own step ($6 for place 6/8,
  $5 for place 4/5/9/10, $2/$3/$6 for lays, $4 for the horn, $2 for C&E; section 3.5 of
  table-games.md).
- **Baccarat:** Tie half the minimum to a fifth of the maximum; each pair half the minimum to a tenth.
- **Three Card Poker:** Pair Plus half the Ante's minimum to half its maximum.
- **Casino War:** the Tie bet a tenth of the bet's minimum and maximum.
- **Big Six:** at most five times the spot maximum on the layout a spin.
- **Sic Bo:** single numbers a fifth of the Small/Big minimum and maximum; totals, two-dice
  combinations, doubles and any triple a fifth of the minimum and a tenth of the maximum; specific
  triples a fifth of the minimum and a fiftieth of the maximum; at most twice the maximum on the
  layout a roll.
- **Hold'em:** the big blind is the smallest bet; there is no maximum bet (no limit).

## Buy-ins

Every table takes a buy-in (and top-ups) of up to **a hundred times its maximum bet**. The smallest
buy-in is the Standard table's, scaled to the chosen minimum (four times the minimum bet at blackjack,
for example). Your balance is the only other cap, and the buy-in prompt's last choice is your whole
balance whenever the table would take more. Hold'em takes 20 to 250 big blinds (a short stack to a
deep one), at any blinds from $0.50/$1 to $100,000/$200,000 (custom: a $0.50 small blind or whole
dollars up to $100,000, the big blind two to three times it). The machines take up to $500,000.

## Solo tables and chips left on them

A solo table takes the limits of each sitting. If chips of yours are still on it (you reloaded, or
your connection dropped, within the two minute hold), it keeps the limits they were bought in at
until you cash out, and the table says so when you sit down.

## Signs

The limit signs painted on the tables (blackjack, roulette, baccarat, War, Big Six and Sic Bo; Three
Card Poker's placard and the Hold'em felt too) show the Standard table on the floor and the actual
table's limits while you are seated at it.

## Max

Every table has a gold **Max** in its chip tray (key **A**, for "all in", while a bet can go down; M
stays the casino's mute) that bets the most the spot takes or every chip you have at the table,
whichever is less:

| Table | What Max bets |
|---|---|
| Blackjack | Pick Max, then click a circle: that circle's maximum (the limits are per circle), from what your other circles left |
| Casino War | Pick Max, then click a hand's bet (or press B for every hand): each keeps its own raise's match back and every other hand's |
| Three Card Poker | Pick Max, then click a hand's Ante (keeping its Play's match back, and every other hand's) or its Pair Plus |
| Baccarat | Pick Max, then click Player, Banker, Tie or a pair (or press P, B, T) |
| Roulette, Big Six, Sic Bo | Pick Max, then click any spot: its own maximum, within what the table maximum a round leaves |
| Craps | Pick Max, then click: a flat bet to its maximum (a lay bet with its commission paid from what you have), or full odds behind your line or come bet |
| Hold'em | All-in (A, pressed twice), and Max beside the pot-size presets sets the amount to all in |
| Bandit Wheel | Pick Max (A) in the terminal, then a number |
| The online games | Max in the bet panel |

Playing several hands alone (blackjack's circles, Three Card and War hands), every limit is per
hand, and Max works hand by hand. A chip smaller than what a spot still needs to reach its minimum
puts the minimum down (in the spot's step), as a dealer would ask, rather than being refused.

The hover over a spot says what Max would add there. The server checks every bet as it always has,
so Max can never put down more than the table allows.

## Machines

Slots and video poker keep their coin values rather than table limits, with high-limit coins added:
Classic Sevens 25¢ to $100, Neon Nights 5¢ to $5, 5x Wild $1 to $100, Diamond Line $1 to $100,
Lucky Cherries 1¢ to $5, Gold Rush 1¢ to $1, video poker $1 to $100 (five coins, so up to $500 a hand).
Every pay is per coin, so every machine's return is the same at every coin value.
