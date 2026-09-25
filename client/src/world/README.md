# client/src/world: the casino floor

`createWorld(engine, opts)` builds the floor into `engine.scene` and returns the handles the rest
of the client needs. Call `world.update(dt)` every frame (`engine.onFrame((dt) => world.update(dt))`).

```ts
import { createWorld } from './world/index.ts';

const world = await createWorld(engine, {
  look, name,                 // the player's Look and name (your own name tag stays hidden)
  quality,                    // defaults to engine.quality
  ui,                         // where the "Press E" prompt goes (default #ui)
  onEscape,                   // Esc while seated: omit and the world stands up by itself
  onProgress: (k) => {},      // 0..1 for the loading bar
  canCapture: () => true,     // optional extra say on holding the mouse (see Mouse look)
});
engine.onFrame((dt) => world.update(dt));
```

## What it returns

| Field | What |
|---|---|
| `stations` | Every table and machine: `{ id, game, variant, anchor, name, limits, footprint, zone, model, yaw }`. `anchor` stands on the floor; the game's `createModel()` output is its child, and a `TableStage` for that station must be built on the same anchor (`new TableStage(engine, station.anchor)`), so views find their parts (video poker's screen and buttons, the slot reels) under it. |
| `cashier` | `{ id: 'cashier', anchor, position }`: the bank counter. Game-less, so not a Station. |
| `characterFactory` | `create(look, name)` returns a `Character` (root, setLook, setMotion 0 idle / 1 walk / 2 run, setName, update, dispose). `load(look)` resolves when that outfit's model is ready; `create()` never waits, the body appears when it loads. One draw call per character. Presence adds remote players' `root`s to the scene and calls `update(dt)`. |
| `player` | `character`, live `position`, `setEnabled(on)`, `state()` returning `{ x, z, yaw, moving }` (send it to the floor every frame) and `teleport(x, z, yaw)` (for the server's spawn in the first hello). `yaw` is `Object3D.rotation.y`; `Math.PI` faces -z. |
| `onEnter(cb)` | The player pressed E at a station. The camera is already flying (0.9 s) to `GAMES[game].playPose(variant, null)` in world space. |
| `onCashier(cb)` | The player pressed E at the cashier. Nothing moves; open the bank panel. |
| `exitTable()` | Fly back behind the player and hand the keys back (resolves when landed). |
| `enter(station, seat)` | Sit down without pressing E (lobby list, reconnect). With a seat, the camera flies to that seat's `playPose` (craps looks at its own end of the table). |
| `setQuality(q)` | Live switch: bloom, pixel ratio, lights, materials, chandeliers. Station models keep the quality they were built with. |
| `showEmote(who, e)` | An emote over a player: `'me'` or a floor id. A bubble with the wheel's icon for 2.8 s, and the character acts it out, standing or seated (wave, cheer with a hop, clap with its sound, thumbs up, shrug, 67). Your own at a table shows at the foot of the view, where you sit. False when that player has no character drawn. |
| `useRemotes(source)` | Where `showEmote` finds other players' characters: pass the app's `RemotePlayers` (anything with `character(id)`), `null` to forget it. |
| `holdItem(id)`, `dropHeld()` | A waiter hands over a paid bar order (its `id` from the bar's `onOrder`, or an item id for your newest paid order of it): it goes in your right hand, in your look, so everyone sees it. `dropHeld()` puts it down. Both go to the bar given to `useBar(bar)` (the app's, `ui/shop/bar.ts`; `null` to forget it). |
| `mouse`, `setMouse({ sensitivity, capture })` | Mouse look settings (sensitivity 0.25-3, 1 = default; capture: the floor holds the mouse, or drag to look), kept in localStorage (`casino.mouse.*`). `world/mouse.ts`'s `setMouseSettings()` does the same from anywhere (the Settings sheet's Controls block) and the walking player hears it at once. |
| `mouseCaptured`, `releaseMouse()` | Whether the mouse is held (Pointer Lock); let it go (a click on the floor takes it back). |
| `stats()` | `{ calls, triangles, programs, pixelRatio }` of the last frame. |
| `collider` | What the walker and the camera bump into; add a post or box for anything that stands on the floor (dealers). |
| `lod` | The far stand-ins: `lod.budget` (draw calls the real models in view may cost over their stand-ins) and `lod.pin(id, 'real' \| 'far' \| null)` for the checks. |
| `dealerGesture(stationId, g)` | A dealer's arm motion at a table, for its view to call as it animates: `'deal'` (a card off the deck in the left hand, sent out with the right), `'sweep'` (the right arm draws the chips in toward the rack), `'pay'` (both hands forward, setting a payout down). About a second each; a new one replaces one still playing. False when the station has no dealer (machines). The table views call it through their stage (`TableStage.gesture`, hooked up by the app when you sit down), one motion at a time. |
| `staff` | The floor's staff (npcs.ts): `posts` (`{ role, station, x, z, yaw }` for every dealer, the stickman, the bartender and the cashier), `at(stationId)` (that station's dealer character), `gesture(stationId, g)` (what `dealerGesture` calls). |
| `life` | The floor's life (`life/`, see Floor life below): `useLink(floorLink)` (seats go through the floor socket), `useBar(bar)` (the staff make and bring every order: `bar.deliverWith`), `useApp({ name, openBarMenu, openShop, holdItem, atTable })`, `bank(event)` and `leftBank()` (the banker answers the bank's sheet), `seatFor(id)` (where another player sits on a floor seat, for `RemotePlayers`' `seatFor`). |
| `plan`, `focus`, `teleport`, `dispose` | The floor plan (layout.ts), the station the player is at, respawn, teardown. |

`SPAWN` (exported) is where a new player appears: `(0, 12.8)`, yaw `Math.PI`, on the lobby's marble
inside the doors, facing into the casino. The server clamps positions to `FLOOR_BOUNDS`
(shared/src/protocol.ts), the building's outer walls, and spawns at the same point.

### Mouse look
On the floor the mouse is held (Pointer Lock): moving it turns the camera, walking or not, with
pitch clamped, and W walks where the camera faces. The player takes it on becoming enabled, so
entering the floor from the menu (the Enter Casino click is the gesture browsers want) and
standing up from a table both hold it straight away. Esc frees the cursor, and a click on the floor
view takes it back; a quiet "Click to look around" shows at the bottom while it's free. Tables need
the cursor, so sitting down lets it go; so does anything that holds the keyboard
(`overlayCount() > 0`: sheets, dialogs, the editor, the emote wheel) and a focused text field (the
chat line), and when that closes or loses focus the mouse is taken back if it was held before.
`opts.canCapture()` can refuse. With capture off in Settings (Controls: Drag) a press that drags
looks around instead. The follow camera never swings back behind the walker while the mouse is
held, and otherwise only after 3 s without mouse input.

### While seated
The world stops moving the player and does not touch the camera once the fly-in has landed; the
table view owns it (roulette's wheel shot, craps' per-seat pose). Esc calls `opts.onEscape` if
given (confirm live bets there, then call `exitTable()`), otherwise it stands up at once. The
player's own avatar is hidden while seated.

### Other players sitting
Seats with a chair or stool are measured once the floor has loaded (`measureSeats` in npcs.ts: a
ray straight down at every `seats()` position against the station's model and the floor props; a
top 0.3-0.95 m up counts). `seatWorld(station, slot)` returns it as `sit`, and `RemotePlayers`
calls `character.sit(sit)`: hips and knees bend until the shins reach the floor (a high stool
leaves them bent at the limit), the character drops onto the seat and the forearms come forward
onto the rail. The drop moves the whole root, so the name tag and speech or emote bubbles hung on
it come down with the head (the shadow stays on the floor). Where there is no seat (most tables are
played standing) `sit` is null and they stand.

### Screen space
The "Press E" prompt sits bottom-centre, clear of the bottom-left corner (the site's back chip).
Prompts read `Press E · Blackjack · $5–$500,000`: the limits a table there can be opened at
(`limitsSpan` in shared/src/limits.ts), or a machine's bets from its engine's config.

A thing counts as in front of you within about 75 degrees of the way your body faces or of the
way the camera looks (walk along a counter and look at it with the mouse: the body still faces
the way you walked). Big things offer their nearest point, not one spot in their middle: the
boutique's counter, each teller window's stretch of the cage, the bar's front, a directory board.

### Wearables
`wearables.ts` puts the boutique's pieces on any character the factory makes, from the look:
chains fitted to each outfit's neck and chest, grills, watches, aviators and hats skinned to
their bones and merged per material (at most two more draw calls near, one plain gold rope and a
hat past 9 m); special clothes as a body material of their own (no extra draw call); a held bar
order in the right hand, with a carrying pose added on top of the animation. characters.ts calls
it from a handful of lines (`dressed(look)` in setLook, `wear.dress(...)` after painting,
`wear.body(m)` on a quality change, `wear.dispose()`).

## The floor
The building is 62 m x 58 m (x east, z south, the street doors on the south wall), fourteen rooms
laid out in `rooms.ts`, each with its own floor, walls, ceiling, light and sign over every door:

| Room | Walls (x, z) | Size | What's in it |
|---|---|---|---|
| Lobby | -7..7, 3..15 | 14 x 12 m | the street doors, marble, a compass rose, the directory board, palms, benches; the grand opening north to the pit |
| The Pit | -13..13, -19..3 | 26 x 22 m | table games in two rows round the staff area and podium under a 6.6 m coffered ceiling (north: `rl-us`, `cr-1`, `sb-1`, `rl-eu`; south: `bj-1`, `bc-1`, `wr-1`, `tc-1`, `bj-2`), the Big Six `b6-1` on the west wall, a round banquette round a palm |
| Slots Hall | -31..-13, -19..3 | 18 x 22 m | twelve islands, every slots variant twice (`slots-<variant>-1..8`), a main aisle from the pit's arch, the win meter |
| Bar | 13..31, -19..3 | 18 x 22 m | the counter along the east wall with video poker `vp-1..4` set into it, bar stools, six high-tops with three stools each, board floor |
| Lounge | 17..31, 3..15 | 14 x 12 m | two sofa groups, armchairs, a fireplace |
| Poker Room | 9..31, -31..-19 | 22 x 12 m | four Hold'em tables `he-1..4` with lamps hung low over each, a host stand, armchairs |
| High Limit Salon | -9..9, -31..-19 | 18 x 12 m | `vip-bj-1`, `vip-bc-1`, `vip-rl-1` in plush chairs under chandeliers, opening at the High limit tier; tub chairs |
| Online Lounge | -31..-9, -31..-19 | 22 x 12 m | twenty-four desks, two for each House Original (`pk-1..2`, `tw`, `mn`, `dc`, `lb`, `kn`, `hl`, `cs`, `cf`, `wh`, `ca`, `dm`), in two islands of twelve either side of the way to the parlour, gaming-cafe light, HOUSE ORIGINALS in neon on the west wall |
| Bandit Camp | -31..-17, 3..15 | 14 x 12 m | the Bandit Wheel `bw-1` in a yard of concrete, rusted sheet, steel trusses, scrap, crates, barrels and a burning drum under a string of bulbs |
| Cashier & Bank | -17..-7, 3..15 | 10 x 12 m | the cage along the north wall with three teller windows and the vault behind them, benches |
| Boutique | 7..17, 3..15 | 10 x 12 m | a shop front on the lobby with windows, two display cases, four mannequins wearing the shop's pieces, the counter and its lit shelves |
| Pachinko Parlour | -31..-9, -43..-31 | 22 x 12 m | twelve Sakura Storm machines `pa-1..12` back to back in two islands (numbered end caps, a crown with its LED strip, a parlour stool at each), the prize counter with its wall of prizes and gold special prizes under the glass, drinks machines and benches, red paper lanterns strung across, indigo wave walls, PACHINKO in neon, noren over its doors |
| Jade Room | -9..9, -43..-31 | 18 x 12 m | a Macau card salon: Let It Ride `lr-1..2` and Pai Gow Poker `pg-1..2` under big red lanterns, a moon gate with a painted landscape on the north wall, lattice screens with lit paper, lacquer sideboards with porcelain, red lacquer coffers |
| Bingo Hall | 9..31, -43..-31 | 22 x 12 m | the hall `bg-1` (the caller's stage, blower, flashboard and four long tables of ten on stacking chairs) framed by velvet drapes, the pattern boards, a snack bar, high-tops and benches, a drop ceiling with fluorescent troffers |

Doors (≥1.4 m wide, `DOORS` in rooms.ts): the street doors, the lobby's grand opening to the pit,
portals to the bank and the boutique, arches from the pit to the slots and the bar and from the
bar to the lounge, portals from the pit to the salon, the online lounge and the poker room, from
the slots to the online lounge and (steel-framed) to the yard, and from the bar to the poker room.
The north wing opens off the back rooms: red lacquer doors (`lacquer`: posts and head, a black beam
across the top) from the online lounge to the parlour, from the salon to the Jade Room and between
the parlour and the Jade Room; portals from the poker room and the Jade Room to the bingo hall. A
wayfinding sign over the pit's north aisle points to all three.

Spacing comes from each module's `footprint` and `seats`: a row of tables is spaced by each
table's real reach (the table and the chairs round it), so real models re-flow the floor. There are
no rope barriers: only real things block the way. Everything solid that isn't a station is in
`plan.solids` (footprint, height, what it may hold); collision (`collide.ts`) is built from the same
list and the walls. `checkLayout(plan)` reports overlaps, stations in aisles or against walls,
blocked player sides, doors too narrow or too tall, and any solid passing through another, a
station, a wall or a ceiling. `client/test/world-layout.test.ts` runs it on the real footprints and
walks the floor (reach.ts) from `SPAWN` to every station, door and room;
`client/test/life-points.test.ts` walks to every seat, teller window, counter, case and waiter
loop. `node scripts/e2e/world4.mjs <port> <dir>` checks the real models against the plan (every
prop and piece of furniture inside its solids, every seat's top where the plan says), the rooms'
screenshots, the map and the draw calls; world3.mjs and world2.mjs still run their checks on it.

### No z-fighting
No two differently dressed faces of the building lie in one plane where anyone can see them (they
would flicker in stripes as the camera moves). Doorways have a lining through the wall, their
casings come in over it and everything on a casing (a bead, a keystone, a band) stands clear of the
faces round it; a wall's trims run along its room's own face and die into a casing at its outer
edge; a wall run closes over a corner only where no other wall carries on past it; anything set on
a surface (a lamp's diffuser, a mirror, a sign) stands a few millimetres off it. The far stand-ins
draw screens and glows as decals (polygonOffset). `zfight.ts` finds any two faces of different
materials within 2 mm of one plane that overlap, less what's pressed against something facing the
other way; `client/test/world-zfight.test.ts` runs it over everything the building's batch holds,
and `node scripts/e2e/world6.mjs <port> <dir> zfight` over the scene as drawn (furniture, props,
signs, the stand-ins; the stations' own models are listed, not failed). world6.mjs also shoots both
jambs of every doorway from both sides (`doors`), measures every palm and plant's foot against its
planter's middle (`palms`: props.ts stands them on their foot, not the middle of their spread),
the directory from the spawn and opened (`directory`), the boutique (`boutique`) and walks up to
every E spot (`prompts`). `node scripts/e2e/rooms6.mjs <port> <dir>` walks the real player from the
spawn into the north wing and across it through every door, checks every new station's prompt
and seat, sits at each kind, shoots each room and counts the draw calls there.

### Seats at every table
Every table game shows its seats: a chair or stool at each `seats()` position (furniture-spec.ts
`SEATING`: chairs at blackjack, baccarat, Three Card and War, stools at roulette, Sic Bo, the Big
Six and the slots, chairs at Let It Ride and Pai Gow, narrow stacking chairs at bingo's long
tables, a parlour stool with a low back at each pachinko machine; craps is played standing at its
rail). The salon's tables get plush chairs.
Hold'em's chairs, the Bandit Wheel's stools and the desks' gaming chairs are the modules' own. The
seat tops sit a fifth of a metre under each table's rail, inside what npcs' downward ray counts
(0.3-0.95 m), so other players sit on them. The chair you're sitting in is left out while you play.

### How to add a station
Everything is in `rooms.ts`; nothing else needs touching.
- A table on its own: add `{ kind: 'station', id: 'bj-3', game: 'blackjack', x, z, yaw }` to a
  room's `stations` (room-local metres from the room's middle; `yaw` 0 puts its players south).
- A table in a row: add `{ id, game }` to that row's `items`; the row re-spaces itself round the
  real footprints and chairs.
- A slot machine: add a variant to the slots list (`slotIslands()` in layout.ts) and a cell to the
  hall's `islands` grid (`cols` x `rows`).
- An online game: add it to the lounge's `desks.games` (two desks each, `per` desks a row).
- Machines back to back (pachinko): `{ kind: 'machines', game, islands: [{ x, z, yaw }], per }`,
  `per` machines a side along each island, side by side at their own width so their slices of
  island join; `plan.machineIslands` holds each island's end caps and crown (decor-themes.ts), and
  checkLayout lets an island's machines touch.
- Something to sit on: add `{ kind: 'armchair', x, z, yaw }` (or sofa, tub, bench, banquette,
  hightop, crate, plank-bench) to `furniture`; its seats join the life points by themselves.
Then run `npx vitest run --project unit client/test/world-layout.test.ts client/test/life-points.test.ts`:
it names anything that overlaps, blocks players, can't be reached or pokes through a wall.
Station ids are sent to the server: `[a-z0-9-]{1,24}`, and keep an id once it's live.

### How to add a room
1. Give it bounds in `ROOMS` that share a wall with a room it opens off (rooms tile; the walls
   are the rooms' edges, so no wall is drawn by hand), a `name`, the `sign` over its doors, an
   `about` line, and a `style` (floor, walls, wainscot, ceiling height and kind, downlights, cove
   colour, and the ambient light while you're in it).
2. Add a `DoorSpec` to `DOORS` (the two rooms, where along their shared wall, width ≥ 1.4 m,
   height under both ceilings less a lintel).
3. Fill its `stations`, `furniture`, `fixtures`, `aisles` (kept clear) and `plants` (corners).
4. If it's bigger than the building, grow `FLOOR_BOUNDS` in shared/src/protocol.ts (the unit test
   says so). Add its colour to `TINT` in wayfinding.ts and its door sign style to `DOOR_SIGNS` in
   signs.ts; the map, the directory board, room visibility and collision pick it up by themselves.

### Life points (life-points.ts)
`lifePoints(plan)` is the floor's registry for the people who walk it (sitting anywhere, waiters,
bankers, the shopkeeper), all in metres with yaw as `Object3D.rotation.y`:

- `seats`: every place to sit that isn't a table's own seat (`{ id, x, z, yaw, top, room, kind,
  station? }`): bar and high-top stools, sofa places, armchairs, tub chairs, benches, the
  banquette, the yard's crates and plank bench, and each online desk's chair (`station` is its PC,
  free only while nobody plays it). `x, z` is the sitter's hip point on the floor, `top` the seat's
  height (`SEAT_TOPS` and furniture-spec.ts). Ids are stable and go over the wire.
- `bar`: `tender` (the strip behind the counter), `front` (the customers' strip), `pickup` (where a
  waiter collects an order) and the counter's `top`.
- `bank.windows`: each teller window's `banker` and `customer` stand points (three).
- `boutique`: the `keeper` and `customer` at the counter, where to stand at each display case
  (with its top) and each mannequin (with the `item` the shop opens at).
- `routes`: closed waiter loops through clear floor (`pause` seconds at a stop): the bar and
  lounge, the pit, the salon, the poker room, the slots hall (`ROUTES` in rooms.ts).

### Wayfinding
The lobby's directory board draws the plan with every room and a "You are here"; it stands
between the ways to the cashier and to the pit, facing the doors, in view from the spawn and
clear of the palms. "E · Read the directory" in front of it opens the Map as the Floor Directory:
wide, with a legend of every room and what's in it beside the plan. The Map (the
HUD's map button, or N on the floor; never at a table, where N is blackjack's "no insurance")
draws the rooms, walls, doors, windows, tables and machines and you with the way you face; a click
on a room lights it and lists what's there. Over every doorway, on both sides, is the name of the
room it leads to.

## Staff
`npcs.ts` puts a dealer behind every table (a stickman across the craps table from its players,
the Big Six dealer beside the wheel, the roulette dealer between the wheel and the zero, the bingo
caller up on the stage behind the podium: a post's `y` is what they stand on), and can
put a bartender behind the bar and a cashier at the cage (the floor passes `skip` for both: the
floor's life brings its own, see Floor life). Where a dealer stands comes from
the table's own model: rays from the dealer's side at a couple of dozen heights find the table's
edge, and the dealer stands as close as a standing body allows at each height (toes at the floor,
thighs at table height, belly and chest above it) plus 4 cm, so a rebuilt table moves its dealer.
The players' seated cameras look over the table at the dealer, who frames it from behind.

- **Uniforms** (characters.ts, `uniformOutfit('vest' | 'blazer')` as `Look.outfit`): made in code
  from the suit (men) and smart (women) outfits, no extra files. Bone weights say what each vertex
  is: arms become white shirt sleeves under a vest (or stay the jacket's colour for the blazer), a
  vest stops at the waist, bare neckline goes under a collar; a bow tie, a brass name badge and,
  on the round-neck top, a shirt-front V are added as a few vertices skinned like the cloth under
  them. Still one mesh and one draw call; the Look colours it (top = vest or jacket). Dealers wear
  black vests, the bartender wine red, the cashier a navy blazer.
- **Faces**: `staffLooks()` gives every post a body, skin tone, hair colour and height; skin and
  height walk their lists at different strides, so no two of up to 56 staff match, and the same
  table keeps the same dealer every visit.
- **Life** (the posing layers on `Person`, applied after the mixer each frame): `setPace(rate,
  phase)` so the idle breathing is out of step, `sway(seed)` for weight shifts from foot to foot,
  `lookAt(point)` turning the head and neck (within 66 degrees; further round and they look ahead),
  and `gesture('deal' | 'sweep' | 'pay')`. Heads turn to the nearest person within 3.6 m in front of
  them for a couple of seconds at a time; with nobody near, a dealer glances over the layout. When
  you sit at a table its dealer turns (up to 46 degrees) and looks at you, now and then down at the
  layout. The bartender strolls a few steps along the bar every 8-22 s.
- **Cost**: staff outside the camera's view are hidden and not animated. Past `CULL_M` (15 m, back
  inside 14 m) each gives way to a still copy of itself (`Person.bake()`, posed at rest), drawn with
  everyone in the same uniform and colour as one instanced mesh: a view pays one call per live
  dealer it can see plus at most four for the whole far floor. All their shadows are one instanced
  mesh. Each stands on a collision post (0.28 m, `cam: false`) so nobody walks through them; the
  bartender's post follows the stroll.
- `node scripts/e2e/npcs.mjs <port> <dir> [tables seated staff gestures sitting calls]` screenshots
  every table with its dealer from its players' side, the seated views, the bar, the cage and the
  pit, a dealer's three motions and two players sitting at Hold'em (on stand-in chairs), and checks
  the dev views stay under 250 draw calls.

## Floor life
`life/` brings the floor's people who aren't players or dealers, from the building's life points
(`lifePoints(plan)` in life-points.ts: every seat that isn't a table's, the bar's two sides and its
pickup, the teller windows, the boutique, the waiters' loops). npcs.ts leaves the bartender and the
cashier to it (`new Staff(..., { skip: ['bartender', 'cashier'] })`). Its prompts come through
`Interact.spots(provider)`: the nearest thing of all (a station, a seat, a waiter) gets "Press E",
and a station within half a metre of the nearest spot wins it (a video poker machine set into the
bar over the bartender's Order, a computer over its own desk chair).

- **Sit anywhere** (sitting.ts): "E · Sit" at any free seat; the character glides on, faces the
  way the seat faces and sits (`Person.sit(top)`), and the camera swings round behind and a little
  above (the mouse still looks). E ("Stand up"), Esc with the mouse free, or walking gets you up.
  The floor arbitrates (`sit`/`stand` on the floor socket, `shared/src/seats.ts`): first come, one
  seat each, freed on stand, walking off, leaving or a second tab; a late second sitter is stood up
  with the floor's note ("Mia got there first."). Other players are drawn sitting on their seat
  (`RemotePlayers` `seatFor`) once their walk has reached it. A desk chair in the online lounge is
  its computer's: E there plays it (the seat is listed, and offered only while nobody plays at
  its computer, but the computer's own prompt comes first); table seats stay the tables'. A seat
  refused by the floor steps you back to where you came from. The camera settles behind the seat,
  or where round it there's room (a wall, a palm's fronds or a lamp behind: collide.ts
  `overhead()` for what hangs), never in the sitter's hair. Back from away or a dropped
  connection, the seat is taken again once the floor has been told where you are.
- **Waiters** (waiters.ts, routes.ts, rounds.ts, nav.ts, tray.ts): four in teal waistcoats with a
  tray on the left hand. Each walks a round (the building's loops, else rounds made from the pit,
  the poker room and the slots), all the same length and a share apart, timed by the server clock,
  so every client sees them in the same place; paths are A* on a grid of the plan's walkable floor
  (reach.ts), pulled tight, never through a table. They collect a tray at the bar's pickup, set a
  drink down at each stop, sidestep people. "E · Order a drink" at one: they stop, turn to you and
  ask, and the bar's menu opens.
- **Orders**: `useBar(bar)` takes delivery over (`bar.deliverWith`). The bartender (bartender.ts)
  makes each paid order (shaken and poured, or fetched from the back bar); at the bar it's handed
  straight across the counter, otherwise the waiter who took it (or the free one nearest the bar)
  takes it off the pickup, walks it to you (a seat, a sofa, wherever you stand), holds it out and
  calls `holdItem(order.id)`. At a game table it waits at the bar until you stand up. Those walks
  are this screen's own; everyone else sees the round, and the drink in your hand. "E · Order" at
  the counter brings the bartender over and opens the menu.
- **Bankers** (bankers.ts): one at each teller window. "E · Bank": they turn to you, greet you by
  name with a nod ("Good evening, Jaden."), and the bank's sheet opens beside them (the camera stands
  at the window on wide screens); a top-up is nodded through and counted out ("Here's your
  $40,000.01. Good luck out there."), a refusal gets a shake of the head. The cage's own prompt
  steps aside while there are tellers.
- **Shopkeeper** (shopkeeper.ts): "E · Browse the boutique" anywhere along the counter's front
  (its nearest point; a lit PURCHASES & FITTINGS sign hangs over it and a service bell sits on
  it), "E · Browse · Fur Coat" at a mannequin from any side (at what it wears), "E · Browse the
  cases" at a display case (or a mannequin, at what it
  wears): a welcome with both hands, a word by name, then `openShop()`; a goodbye after. Between
  customers: polishing a case, straightening a mannequin.
- **Cost**: the crew (crew.ts) are characters like the dealers (uniforms from characters.ts, one
  draw call each, the shared material), hidden out of view and in rooms the camera can't see
  into, waiters and the bartender as still copies past 22 m (one instanced mesh per uniform), one
  instanced mesh of shadows, trays drawn within 12 m. Lines are short and varied, no emoji
  (lines.ts). `node scripts/e2e/life4.mjs <port> <dir> [dev floor]` shoots all of it, with two
  players on the local worker.

## Rendering
- Rooms you can't see aren't drawn (visibility.ts): from the camera's room through every doorway
  in view, three rooms deep, each room seen through the screen rectangle of the doorways on the way
  to it; a station or a dealer in another room outside that rectangle isn't drawn either. Walls and
  ceilings, furniture, props, mannequins, stations and staff all follow it. The worst views in the
  building (across the pachinko parlour's twelve machines, and into the slots hall from the online
  lounge's door) are under 200 draw calls on High. Pachinko machines are machines to the far
  stand-ins (8 m) and to the bloom (the 'parlour' zone), and bingo's hall is one station ('hall').
- The light rig follows you (lighting.ts): three spots light the room you're in (the pit's two
  rows, the poker room, the salon), and the hemisphere takes that room's colours.
- Static architecture is merged per material (batch.ts), kept per room: one BatchedMesh per
  material, one instance per room, so hiding a room costs nothing and showing six costs one draw
  call per material; procedural furniture (furniture.ts) is instanced per kind and part; the floor's glowing strips and discs (LED
  underglow, the cove, downlights, shelf lights) are one vertex-coloured mesh (`GlowMerge`); props
  are instanced; all signs are one atlas mesh.
- Stations swap to baked stand-ins past 11 m (machines past 8 m): small textured parts and reel
  strips bake to their texture's average colour, and every part keeps its metalness and roughness
  per vertex (the stand-in material reads them from a `pbr` attribute), so chrome and brass stay
  metal and felts stay cloth. The stand-ins' plain and glowing parts are two `BatchedMesh`es for the
  whole floor. Real models in view also share a draw-call budget (`STATION_BUDGET`, 80 over their
  stand-ins, nearest first, a little hysteresis): the pit's busiest poses stay near 220 calls on
  High. `world3.mjs lod` compares every station's stand-in with its model (and poker felts must
  read green); `world3.mjs calls` sweeps the busiest poses with the big-win sign and meter up.
- Fixed lights: hemisphere + directional always; four spots on High (two pit rows, poker, and a
  focus spot that follows the table you're at). Warm pools on the carpet (under tables, banks and
  lamps, and a small scallop under each downlight over the aisles) are additive decals.
- High: glow only from light sources. The pit's spots are set so the brightest lit surface (white
  printing, a white chip in a rack) peaks near 1.5, and the floor's bloom threshold sits above
  that (1.65, soft knee): neon, LED strips, the cove, bulbs, lamp shades, the machines' lamps and
  specular glints on chrome all run past 2 and glow; cards, printing and chips never do. The high
  pass keeps only the light past the threshold, so a sign gives most of its light to its halo and
  the halo is tight (radius 0.2). Seated at a table the threshold is 4.2 (nothing on the table
  glows); at a machine 2.2 (its own lamps do, a little). `world.glow(on)` turns it off and on for
  the checks: `world3.mjs read` draws every table and machine, seated and from 6-10 m, idle and
  with a celebration's light, with the glow on and off and compares the cards' and the layout's
  own pixels (and the cards' contrast on Low). MSAA, pixel ratio up to 2 with step-down at
  p90 > 17 ms. Engine3D's renderer has no HalfFloat output buffer, so `renderer.setEffects()`
  refuses; bloom.ts renders the floor into its own HalfFloat target from the scene's render hooks
  instead, and switches to `setEffects([bloom])` automatically if the renderer is ever created
  with `outputBufferType: HalfFloatType`. `renderer.info.autoReset` is off while the world lives;
  `update()` resets it once per frame.
- High: the marble, lacquer and wood reflect the casino itself (a PMREM capture from inside the
  doors, taken once at load); the metals keep the studio environment. The chandeliers glint (one
  point cloud, one draw call).
- Low: no bloom, pixel ratio 1, Lambert/Basic materials, no spots, Quaternius chandeliers.
- The canvas itself isn't multisampled (the app and the dev floor make the engine with
  `antialias: false`): on High the bloom draws the scene into its own 4x target, and a
  multisampled canvas would only cost memory and make each pixel-ratio step stall. The pixel ratio
  steps back up only after eight fast seconds and never within 30 s of stepping down.

### The frame's CPU
- Labels (name tags, speech and emote bubbles, a table's totals) are drawn by render/labels.ts, a
  pass over what's shown that reuses the render's matrices; three's CSS2DRenderer walked the whole
  scene (6,000 objects) twice a frame and updated every matrix again. Make labels with
  `CSS2DObject` as before; hide one with `visible`, never with its element's style.
- Hidden things sit out the frame's matrix update (render/matrices.ts `skipWhileHidden`): every
  character's root (seventy-odd bones each) and every station's model and stand-in copy. Only the
  frame's own update skips them; an explicit `updateMatrixWorld(true)` still updates all of it.
- Other players (remote-players.ts) are drawn and animated only where the camera can see them
  (`world.canSee(x, z)`: in view, in a room being drawn, inside the doorway it's seen through), at
  most the nearest `MAX_DRAWN` (40) of a crowd, and their shadows are one instanced mesh. One left
  out is still there for the staff and waiters (`userData.offscreen`), who look at and step round
  everyone present.
- Nothing is drawn behind the loading screen (`engine.paused`): the world compiles every shader
  with `compileAsync`, the hidden things too, and the first long frame (the floor going onto the
  GPU) happens before the loading screen lifts.

### GPU memory at the tables
A table view's felt, dice, pucks and buttons are given back to the GPU when you stand up:
`TableStage` notes what the view has on the table before the view is disposed (`stage.hold()`,
table-session.ts) and releases every geometry, material and texture of it that nothing in the
scene still draws. Caches every table shares say so with `userData.shared = true` (the cards'
faces, box and edge, the chips' faces, sides and cylinder, the dice's materials), so they stay; a
game's own cache that doesn't is uploaded again the next time it's drawn. `node
scripts/e2e/session.mjs <port>` sits at a table of every kind round after round and counts what the
renderer, the heap and the DOM hold.

### Measuring
- `node scripts/e2e/perf.mjs <port> <dir> [flow sweep mobile] --bots 24 [--crowd] [--uncapped]`:
  frame rate, p95, the frame's own CPU time and draw calls over every room and doorway at High and
  Low with other players on the floor (perf-bots.mjs), and a mid phone on Low with the CPU slowed 4x.
- `node scripts/e2e/loadtime.mjs <port> [--net 4g]` on a production build (`vite preview` of
  dist/casino): the time to the login screen and to the floor, requests and bytes by type, and
  anything fetched twice.
- Published builds carry every model gzipped beside itself (client/vite.config.ts) and
  render/model-bytes.ts unpacks it: the site's CDN sends .glb files uncompressed.

## Assets
`node scripts/assets-world.mjs [staging]` rebuilds `client/public/assets/models` (characters,
props, `outfits.json`, `credits.json`) and `client/public/assets/textures` from the research
staging folder. Characters are the CC0 Quaternius Ultimate Modular Men/Women (never the CC-BY
women's suit): Idle/Walk/Run only, one skinned mesh per outfit, `--compress quantize`.
`outfits.json` maps each outfit's mesh/material pairs to the Look's slots; the dev floor's
`&lineup=1` shows every outfit in debug colours to check it.

## Dev floor
`/casino/src/world/dev-floor.html` (or `/casino/?dev=floor` once main.ts routes it): walk with
WASD/arrows, Shift runs, click to look with the mouse (Esc lets go) or drag, wheel to zoom, E to
sit, Esc to stand. `&quality=low|high`,
`&view=overview|slots|pit|cashier|bar|poker|lounge|bigsix|parlour|cardroom|bingo|table`, `&stats=1`, `&lineup=1`,
`&slots=sevens,neon,...` (the slot islands to lay out instead of the catalogue's).
