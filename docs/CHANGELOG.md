# Changelog

What changed in each numbered release of the casino. Older releases are described by their
merge commits in the site repo.

## 1.5 (2026-10-24)

The overhaul: refined graphics everywhere, a cleaner interface, smoother motion, nothing covering
anything else at any window size, and new things to do.

### The floor
- Characters are smooth-shaded: skin takes the light softly and warmly, cloth and hair catch a
  soft sheen at their edges, and eyes, earrings, ties and badges shine their own way. Everyone
  casts a soft shadow, drawn in one go.
- Feet stay planted: the walk and run play in step at the pace a character really moves (you,
  other players, guards, celebrities and inmates), everyone leans into turns, and sitting down or
  getting up eases instead of snapping. Other players' walks and turns are smoothed between
  updates.
- The follow camera rides a spring: no jolts starting, stopping or brushing past a column, and it
  comes in before a wall fills the view.
- Nothing on the floor floats: chairs, stools, tables, slot islands, counters, sofas, planters and
  statues stand in soft shadows of their own shape, walls meet the floor softly, and the cars, the
  ground floor's hall, the roof terrace and the apartment are grounded too.
- On High each room has its own light (warmer in the pit, the bar and the lounge, cooler in the
  online lounge, green in the salon, pink in the parlour), easing in as you walk through a door,
  with softly darkened corners and no banding in the dark ceilings. The wood has a lacquered gloss,
  leather a waxed one, velvet and the chairs' upholstery a sheen. Low smooths jagged edges where
  the graphics card can.
- One clear prompt: the key, what it does ("Play Blackjack"), then the limits. Name tags sit on a
  plate that reads over anything, fade a little with distance and show a worn title.
- The map lists the rooms and, new, Find a game: every game in the building, where it is and how
  far. Show the way draws the route on the plan and a trail of brass chevrons on the floor, with a
  chip under the HUD counting down the metres.
- Photo mode (P, or More): the HUD and names go, the camera circles you (drag, wheel, arrows or
  pinch), and Save photo downloads the picture.
- Your first time on the floor, four coach marks show the way (walking, sitting down, the map, the
  HUD's tools), moving on as you do each thing; Skip tour puts them away for good.

### The HUD, Settings and the rest of the screen
- The HUD keeps the map, emotes, tips, sound and settings to hand; More lists every other action,
  grouped Play, Shop, Social and System, each with what it's at and its key, and a dot on More says
  something is waiting. On a phone it is one row.
- Ctrl K (⌘ K) searches every action, each part of Settings, the rooms and the games: a room opens
  the Floor Directory there, and a game shows the way to its nearest table.
- One tooltip for the HUD and the controls over the tables, with the action and its key, on hover
  and on keyboard focus.
- Toasts, big wins and the celebrities' notices share one column under the HUD, three at most, and
  step aside for an open sheet; Notifications, in More, keeps the last thirty.
- Settings comes in sections with a rail to jump between them. New: game sounds, the room and
  music each at their own level; an interface size; Show frame rate; and in Graphics, Resolution
  (Auto, Sharp, Fast), Glow, Smooth edges, Film look and a 30 fps battery saver, all applied at once.
- Sound no longer clips when many things play at once, every level change is smooth, and sound
  starts on a phone for a returning player.
- The login and the menu sit on one card over the floor, so the room behind keeps its colours. The
  name and password are labelled boxes with Show, a Caps Lock warning and the problem said under
  the field; Enter turns while it logs you in. The menu has one gold choice, Enter Casino.
- The look editor's three steps are tabs you can click; zoom in on the face (wheel, pinch, + and -;
  0 puts the view back); Surprise me is in the full editor too; the chosen colour wears a check;
  the dressing room is lit like a studio.
- The profile shows your initial and the title you wear, the fortnight chart has a scale, and every
  sheet fits a phone. The daily bonus lays the week out as seven cards, today's standing out.

### At the tables
- Every table keeps the bottom of the screen in order: the Hands picker, Tip the dealer, the meters
  and the Tips line stack above the chips at any window size. Nothing covers Deal, and on a phone
  the tray fits in two rows.
- Cards have rounded corners and sit on the felt with a soft shadow, arc in when dealt and lift as
  they turn over; the faces are sharper on High, with a new card back. Chips look like casino chips
  (spots over the edge, a value you can read), piles are shaded chip by chip, and the felt has a
  cloth grain.
- The Deal button shows your bet, and with nothing down deals last round's bets again in one press;
  Undo, Clear and Rebet look plainly off when there's nothing to do, and each chip shows its key.
- A win's amount rises off its chips and every winning hand lights up. History (O) lists your last
  rounds at a card table and what each paid. A four-colour deck is in Settings.
- Sitting down is quicker: Single player and Multiplayer are two clear cards under the table's
  limits, open tables can be narrowed to a stake or leave out the full ones, and custom limits say
  which amount is wrong as you type. The buy-in has a slider along the table's range and quick
  amounts. The High Limit Salon's tables take custom limits above $1,000,000 again.
- Hold'em shows more plainly whose turn it is (the plate lifts, the clock goes red near the end);
  a held video poker card stands up; hand labels and Rules buttons read in the light theme.
- Roulette: a racetrack (L) with neighbour bets, the French called bets and three favourite
  layouts; the last numbers with the colours' split and the hot and cold numbers; every spot's card
  says how many pockets it covers and its house edge; the ball clatters over the frets and rocks in
  its pocket before it rests.
- Craps: an Odds button (O) for every line and come bet; Across, Inside and Hardways in one tap;
  Undo takes back a whole call; the point's box is lit; a plaque for every roll.
- Sic Bo, Big Six and the Bandit Wheel keep tallies under the last results; each Sic Bo box says how
  many of the 216 rolls win it. On a phone or tablet, touching a spot shows what it covers and pays.
- Slot machines keep a tally of your time at the machine (spins, bet, paid, net, best win). The Pays
  sheet stands over the bet controls, shows your bet and can show every pay in money at it. The
  three classic cabinets light their glass from behind, every cabinet is lacquered on High, and a
  big win's count-up can be skipped (and now stops the meters too).
- Pachinko: hold Space or Launch and the balls keep coming; a ball that pays shows +3 over its
  pocket. Bingo: each prize shows its pattern, the ink looks like a dauber's, and the hall fits a
  phone either way up.
- The House Originals read as one site: all twelve share the same bet panel (½, 2× and Max, with
  what a win makes and its odds under the bet), a row of recent results along the top of the board,
  the same pill for a win or a loss, and their keys on the buttons; Space plays in every game.
- Auto in eleven of them (not Hi-Lo, where every guess is a choice): a number of bets or until
  stopped, with stops on a profit or a loss. Mines turns the tiles you ring, Tower climbs the path
  you set, Coinflip rides to the streak you choose and Crash bets every round with its auto
  cash-out. A run stops at once if you leave, run short, the table refuses or drops, the tab goes
  to the background or a dialog opens.
- Plinko's pegs glint and its balls trail, Mines and Tower tiles turn over in depth, Hi-Lo deals its
  card off the deck, Keno's numbers drop in with a ring, the Wheel's pointer kicks on every peg, the
  coin shows its milled edge and Crash's number warms as it climbs. On a phone or an upright tablet
  the page lies flat over the room at the screen's own size, and the desks carry a strip of light
  in their game's colour.

### Money and things to buy
- The boutique is a grid of cards, each piece with a picture drawn for it: search every section,
  show what you can buy, own or have saved, sort by price, keep a wishlist on this device. The
  confirm shows your balance before and after.
- The bar's card says what each drink and plate does in a word and for how long; happy hour is
  stamped across it with the prices halved, or it says when the next one starts.
- The bank checks amounts as you type, shows where the money ends up before you press, and retries
  a lost answer as the same operation. The Casino Index chart is tagged and readable with the keys;
  the statement goes by day, with Purchases, Bank, Tables and Transfers filters.
- The valet draws every car side on, with how the picked one drives as bars, a Can buy filter, and
  your car at the curb with its minutes left. The gun and home stores confirm with the balance
  after, and Ace Arms says how each gun fires.

### People
- Chat runs a person's lines together, shows each line's time on hover, lights up lines that
  mention you (a red @ on the chat button), lets you click a name to reply and puts your favourite
  emotes a click away; speech bubbles read over anything.
- Invites show their time running out, Do not disturb is on every invite, and alone at your table
  the people you've played with are one click to invite.
- Achievements can be filtered and searched across every game, today's challenges say when they
  change, and the leaderboards keep your place in view and give the top three medals.
- On the emote wheel, F stars an emote for the chat's quick row and Space makes the last one again.

### Fixed
- A player dropping at your table no longer blacks out the screen.
- Mute (N) works over an open sheet again and follows a rebinding.
- The bank and the stores can't move money twice when an answer is lost and you press again.
- Ace Arms says how each gun fires (the revolver, the pump and the bolt-action rifle were all
  called semi-automatic), and the Warden .45 and the Tempest say as many rounds as they hold.
- The map is on M everywhere it's described (it moved in 1.3), and the keyboard sheet's roulette
  row names the racetrack's real key.

### Faster
- The casino opens on less: ten tables' own code comes once you're inside, quietly while you're on
  the menu, and the page no longer carries every game's dealer and bots just to read the limits.
- Other players walk on a smooth curve through the positions the floor sends instead of straight
  lines that jolt at each one, and a late correction eases in. A computer whose clock jumps forward
  no longer leaves other players frozen and the wheels' spins out of step.
- The floor does less work for every step anyone takes.
- Walking the floor makes less garbage each frame (fewer small hitches), cards and chips take fewer
  draw calls, and the slot machines, pachinko and bingo repaint only what changed.
- For contributors: `npm run check` runs the typecheck, the tests and the privacy scan;
  `npm run size` shows what the page downloads to open; `npm run dev -- --preview` serves the
  production build.

## 1.4 (2026-10-15)

- Light and dark for the 2D layer: the login and menu, the HUD, every sheet and panel, the chat,
  the chip tray and the controls over the tables. A sun and moon button on the login screen and
  in the HUD, and a Theme row in Settings. It is the same choice as the rest of j4den.com, follows
  the device until one is made, and is set before the first paint. The casino keeps its lights.
- The browser's own bar colour follows the theme, and the page declares both colour schemes.
- The renderer hears the device pixel ratio change (the window dragged to another screen, or the
  browser zoomed) and redraws at the new ratio; the floor's adaptive ratio starts over from it.
- The game is in the entry chunk, so the page fetches it and three.js as it reads the HTML rather
  than one round trip later.
- A character leaving (or changing outfit) no longer frees the vertex buffers every other
  character in that outfit draws with, which had the whole crowd re-upload on each leave.
- A reconnect's hello refreshes who is crouching and names; an emote bubble goes with a player
  who leaves mid-emote instead of hanging where it was.
- Worker: a ticket for a lobby id that was never made no longer leaves an empty object's tables
  in storage; a Turnstile token must have been solved on one of the site's own hosts; a paused
  account's expired checks are cleared as the next is issued. See docs/SECURITY-REVIEW.md.

## 1.3.1

- A full casino says so with Try again (no more walking about unseen); sockets come back at once
  from a dead link; bail is paid once per stay; a short big blind all-in no longer folds the small
  blind; the floor answers a failed message instead of throwing.
