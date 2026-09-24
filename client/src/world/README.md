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
| `dealerGesture(stationId, g)` | A dealer's arm motion at a table, for its view to call as it animates: `'deal'` (a card off the deck in the left hand, sent out with the right), `'sweep'` (the right arm draws the chips in toward the rack), `'pay'` (both hands forward, setting a payout down). About a second each; a new one replaces one still playing. False when the station has no dealer (machines). Nothing calls it yet. |
| `staff` | The floor's staff (npcs.ts): `posts` (`{ role, station, x, z, yaw }` for every dealer, the stickman, the bartender and the cashier), `at(stationId)` (that station's dealer character), `gesture(stationId, g)` (what `dealerGesture` calls). |
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

### Wearables
`wearables.ts` puts the boutique's pieces on any character the factory makes, from the look:
chains fitted to each outfit's neck and chest, grills, watches, aviators and hats skinned to
their bones and merged per material (at most two more draw calls near, one plain gold rope and a
hat past 9 m); special clothes as a body material of their own (no extra draw call); a held bar
order in the right hand, with a carrying pose added on top of the animation. characters.ts calls
it from a handful of lines (`dressed(look)` in setLook, `wear.dress(...)` after painting,
`wear.body(m)` on a quality change, `wear.dispose()`).

## The floor
The building is 62 m x 46 m (x east, z south, the street doors on the south wall), eleven rooms
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
| Online Lounge | -31..-9, -31..-19 | 22 x 12 m | sixteen desks, two for each House Original (`pk-1..2`, `tw`, `mn`, `dc`, `lb`, `kn`, `hl`, `cs`), in two islands, gaming-cafe light, HOUSE ORIGINALS in neon |
| Bandit Camp | -31..-17, 3..15 | 14 x 12 m | the Bandit Wheel `bw-1` in a yard of concrete, rusted sheet, steel trusses, scrap, crates, barrels and a burning drum under a string of bulbs |
| Cashier & Bank | -17..-7, 3..15 | 10 x 12 m | the cage along the north wall with three teller windows and the vault behind them, benches |
| Boutique | 7..17, 3..15 | 10 x 12 m | a shop front on the lobby with windows, two display cases, four mannequins wearing the shop's pieces, the counter and its lit shelves |

Doors (≥1.4 m wide, `DOORS` in rooms.ts): the street doors, the lobby's grand opening to the pit,
portals to the bank and the boutique, arches from the pit to the slots and the bar and from the
bar to the lounge, portals from the pit to the salon, the online lounge and the poker room, from
the slots to the online lounge and (steel-framed) to the yard, and from the bar to the poker room.

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

### Seats at every table
Every table game shows its seats: a chair or stool at each `seats()` position (furniture-spec.ts
`SEATING`: chairs at blackjack, baccarat, Three Card and War, stools at roulette, Sic Bo, the Big
Six and the slots; craps is played standing at its rail). The salon's tables get plush chairs.
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
The lobby's directory board draws the plan with every room and a "You are here". The Map (the
HUD's map button, or N on the floor; never at a table, where N is blackjack's "no insurance")
draws the rooms, walls, doors, windows, tables and machines and you with the way you face; a click
on a room lights it and lists what's there. Over every doorway, on both sides, is the name of the
room it leads to.

## Staff
`npcs.ts` puts a dealer behind every table (a stickman across the craps table from its players,
the Big Six dealer beside the wheel, the roulette dealer between the wheel and the zero), a
bartender behind the bar and a cashier at the cage's east window. Where a dealer stands comes from
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

## Rendering
- Rooms you can't see aren't drawn (visibility.ts): from the camera's room through every doorway
  in view, three rooms deep, each room seen through the screen rectangle of the doorways on the way
  to it; a station or a dealer in another room outside that rectangle isn't drawn either. Walls and
  ceilings, furniture, props, mannequins, stations and staff all follow it. The worst view in the
  building (looking into the slots hall from the online lounge's door) is under 200 draw calls on
  High.
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
- High: bloom you can see through. The high pass keeps only the light past the threshold (1.0,
  with a soft knee), so a neon tube gives most of its light to its halo and a card or a paytable
  lit a little past it gives almost none; the halo is tight (radius 0.18). Seated, the threshold
  rises to 1.9 so nothing on the table glows. MSAA, pixel ratio up to 2 with step-down at
  p90 > 17 ms. Engine3D's renderer has no HalfFloat output buffer, so `renderer.setEffects()`
  refuses; bloom.ts renders the floor into its own HalfFloat target from the scene's render hooks
  instead, and switches to `setEffects([bloom])` automatically if the renderer is ever created
  with `outputBufferType: HalfFloatType`. `renderer.info.autoReset` is off while the world lives;
  `update()` resets it once per frame.
- High: the marble, lacquer and wood reflect the casino itself (a PMREM capture from inside the
  doors, taken once at load); the metals keep the studio environment. The chandeliers glint (one
  point cloud, one draw call).
- Low: no bloom, pixel ratio 1, Lambert/Basic materials, no spots, Quaternius chandeliers.

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
`&view=overview|slots|pit|cashier|bar|poker|lounge|bigsix|table`, `&stats=1`, `&lineup=1`,
`&slots=sevens,neon,...` (the slot islands to lay out instead of the catalogue's).
