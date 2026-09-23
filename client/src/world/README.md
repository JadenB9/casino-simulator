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
  canCapture: () => true,     // optional extra say on capturing the mouse (see Mouse look)
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
| `mouse`, `setMouse({ sensitivity, capture })` | Mouse look settings (sensitivity 0.25-3, 1 = default; capture on/off), kept in localStorage (`casino.mouse.*`). |
| `mouseCaptured`, `releaseMouse()` | Whether a click has captured the mouse; let it go. |
| `stats()` | `{ calls, triangles, programs, pixelRatio }` of the last frame. |
| `plan`, `focus`, `teleport`, `dispose` | The floor plan (layout.ts), the station the player is at, respawn, teardown. |

`SPAWN` (exported) is where a new player appears: `(0, 12.8)`, yaw `Math.PI`, on the marble inside
the doors, facing into the casino.

### Mouse look
A click on the floor view captures the mouse (Pointer Lock); moving it then turns the camera,
walking or not, with pitch clamped, and W walks where the camera faces. Esc lets it go. A press
that drags looks around without capture. The follow camera never swings back behind the walker
while the mouse is captured, and otherwise only after 3 s without mouse input. There is no
capture while seated or while the player is disabled (menus, the lobby, the cashier), while
anything holds the keyboard (`overlayCount() > 0`: sheets, dialogs, the editor, the emote wheel),
or when `opts.canCapture()` says no; any of those starting lets a captured mouse go.

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
| Table pit, two rows facing out round a roped staff area and podium | north row `rl-us`, `cr-1`, `sb-1`, `rl-eu`; south row `bj-1`, `bc-1`, `wr-1`, `tc-1`, `bj-2` |
| Feature spot (west wall, between the cashier queue and the cross aisle, facing the pit) | `b6-1`, the Big Six wheel (zone `feature`; about 3 m tall under the 3.4 m ceiling) |
| Poker room (north-east, navy carpet, ropes) | `he-1`, `he-2` (side on, or one behind the other when the room is short) |
| Slot islands (south-west), one per slots variant in `CATALOG`, 2+2 machines each, LED underglow and toppers | `slots-<variant>-1..4` for sevens, neon, wild, diamonds, cherries, goldrush; the grid re-flows for any count |
| Bar (east wall) with video poker set into the counter | `vp-1..4`; bar-top units (model under 0.9 m tall) sit on the counter, taller cabinets stand in gaps in it |
| Cashier cage (north-west) | `cashier` |
| Lounge, entrance palms, wayfinding | |

Spacing comes from each module's `footprint`, so real models re-flow the floor. `checkLayout(plan)`
reports overlaps, stations in aisles or against walls, and blocked player sides; the dev floor
logs it and `node scripts/e2e/world.mjs 5400 /tmp/world layout` checks today's footprints and
typical real ones (both clean). `node scripts/e2e/world2.mjs <port> <dir>` checks the layout with
three and six slot islands, the views and their draw calls, mouse look (pointer lock and drag),
the recentring rules and emotes.

## Rendering
- Static architecture is merged per material (batch.ts); props are instanced; all signs are one
  atlas mesh. Stations swap to baked stand-ins past 11 m (machines past 8 m): small textured
  parts and reel strips bake to their texture's average colour. With six slot islands and the
  v2 tables, the dev views draw 42-221 calls on High (the slot floor is the busiest).
- Fixed lights: hemisphere + directional always; four spots on High (two pit rows, poker, and a
  focus spot that follows the table you're at). Warm pools on the carpet are additive decals.
- High: bloom on anything brighter than 1.0, MSAA, pixel ratio up to 2 with step-down at p90 > 17 ms.
  Engine3D's renderer has no HalfFloat output buffer, so `renderer.setEffects()` refuses; bloom.ts
  renders the floor into its own HalfFloat target from the scene's render hooks instead, and
  switches to `setEffects([bloom])` automatically if the renderer is ever created with
  `outputBufferType: HalfFloatType`. `renderer.info.autoReset` is off while the world lives;
  `update()` resets it once per frame.
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
