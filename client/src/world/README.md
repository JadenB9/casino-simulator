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
| `showEmote(who, e)` | An emote over a player: `'me'` or a floor id. A bubble with the gesture's icon for 2.8 s, and the character acts it out (wave, cheer with a hop, clap, thumbs up, shrug). False when that player has no character drawn. |
| `useRemotes(source)` | Where `showEmote` finds other players' characters: pass the app's `RemotePlayers` (anything with `character(id)`), `null` to forget it. |
| `mouse`, `setMouse({ sensitivity, capture })` | Mouse look settings (sensitivity 0.25-3, 1 = default; capture: the floor holds the mouse, or drag to look), kept in localStorage (`casino.mouse.*`). `world/mouse.ts`'s `setMouseSettings()` does the same from anywhere (the Settings sheet's Controls block) and the walking player hears it at once. |
| `mouseCaptured`, `releaseMouse()` | Whether the mouse is held (Pointer Lock); let it go (a click on the floor takes it back). |
| `stats()` | `{ calls, triangles, programs, pixelRatio }` of the last frame. |
| `collider` | What the walker and the camera bump into; add a post or box for anything that stands on the floor (dealers). |
| `lod` | The far stand-ins: `lod.budget` (draw calls the real models in view may cost over their stand-ins) and `lod.pin(id, 'real' \| 'far' \| null)` for the checks. |
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

### Screen space
The "Press E" prompt sits bottom-centre, clear of the bottom-left corner (the site's back chip).
Prompts read `Press E · Blackjack · $5–$5,000` with the limits from
`ENGINES[game].config(variant, 'solo').limits.default`.

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

Hooks for others: dealers standing in the staff area want collision, since the staff area is open
now: `world.collider.post(x, z, 0.28, 1.9, { cam: false })` (the Collider built in `createWorld`).

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
