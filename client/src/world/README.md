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

`SPAWN` (exported) is where a new player appears: `(0, 12.8)`, yaw `Math.PI`, on the marble inside
the doors, facing into the casino.

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
Prompts read `Press E · Blackjack · $5–$5,000` with the limits from
`ENGINES[game].config(variant, 'solo').limits.default`.

### Wearables
`wearables.ts` puts the boutique's pieces on any character the factory makes, from the look:
chains fitted to each outfit's neck and chest, grills, watches, aviators and hats skinned to
their bones and merged per material (at most two more draw calls near, one plain gold rope and a
hat past 9 m); special clothes as a body material of their own (no extra draw call); a held bar
order in the right hand, with a carrying pose added on top of the animation. characters.ts calls
it from a handful of lines (`dressed(look)` in setLook, `wear.dress(...)` after painting,
`wear.body(m)` on a quality change, `wear.dispose()`).

## The floor
40 m x 30 m (x east, z south, the entrance on the south wall). Friedman-low 3.4 m ceilings over
slots, the bar and the aisles; a 6.6 m coffered ceiling with a warm cove over the table pit.

| Zone | Stations |
|---|---|
| Table pit, two rows facing out round the staff area and podium | north row `rl-us`, `cr-1`, `sb-1`, `rl-eu`; south row `bj-1`, `bc-1`, `wr-1`, `tc-1`, `bj-2` |
| Feature spot (west wall, between the cashier queue and the cross aisle, facing the pit) | `b6-1`, the Big Six wheel (zone `feature`; about 3 m tall under the 3.4 m ceiling) |
| Poker room (north-east, navy carpet) | `he-1`, `he-2` (side on, or one behind the other when the room is short) |
| Slot islands (south-west), one per slots variant in `CATALOG`, 2+2 machines each, LED underglow and toppers | `slots-<variant>-1..4` for sevens, neon, wild, diamonds, cherries, goldrush; the grid re-flows for any count |
| Bar (east wall) with video poker set into the counter | `vp-1..4`; bar-top units (model under 0.9 m tall) sit on the counter, taller cabinets stand in gaps in it |
| Cashier cage (north-west) | `cashier` |
| Lounge, entrance palms, wayfinding | |

Spacing comes from each module's `footprint`, so real models re-flow the floor. There are no rope
barriers: only real things block the way (walls, tables, machines, the bar, columns, plants,
counters and the lounge's furniture). Everything solid that isn't a station is in `plan.solids`
(footprint, height, what it may hold), and the plants, palms, stools, signs and couches are placed
from the plan so they fit round everything else. `checkLayout(plan)` reports overlaps, stations in
aisles or against walls, blocked player sides, and any solid passing through another, a station,
a wall or a ceiling; `client/test/world-layout.test.ts` runs it for today's and bigger footprints,
bar-top video poker and six slot islands, and `node scripts/e2e/world3.mjs <port> <dir> layout`
checks the real models' geometry against the plan (every prop inside its solids, every station
inside its footprint). The dev floor logs any problem. `node scripts/e2e/world2.mjs <port> <dir>`
checks the layout with three and six slot islands, the views and their draw calls, mouse look,
the recentring rules and emotes.

Anything else that stands on the floor adds its own collision through `world.collider` (the
Collider built in `createWorld`), as the staff do with a post each.
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
- Static architecture is merged per material (batch.ts); the floor's glowing strips and discs (LED
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
