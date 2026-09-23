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
| `stats()` | `{ calls, triangles, programs, pixelRatio }` of the last frame. |
| `plan`, `focus`, `teleport`, `dispose` | The floor plan (layout.ts), the station the player is at, respawn, teardown. |

`SPAWN` (exported) is where a new player appears: `(0, 12.8)`, yaw `Math.PI`, on the marble inside
the doors, facing into the casino.

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
| Table pit, two rows facing out round a roped staff area and podium | north row `rl-us`, `cr-1`, `rl-eu`; south row `bj-1`, `bc-1`, `tc-1`, `bj-2` |
| Poker room (north-east, navy carpet, ropes) | `he-1`, `he-2` |
| Slot islands (south-west and by the cashier), 2+2 machines each, LED underglow and toppers | `slots-sevens-1..4`, `slots-wild-1..4`, `slots-neon-1..4` |
| Bar (east wall) with video poker set into the counter | `vp-1..4`; bar-top units (model under 0.9 m tall) sit on the counter, taller cabinets stand in gaps in it |
| Cashier cage (north-west) | `cashier` |
| Lounge, entrance palms, wayfinding | |

Spacing comes from each module's `footprint`, so real models re-flow the floor. `checkLayout(plan)`
reports overlaps, stations in aisles or against walls, and blocked player sides; the dev floor
logs it and `node scripts/e2e/world.mjs 5400 /tmp/world layout` checks today's footprints and
typical real ones (both clean).

## Rendering
- Static architecture is merged per material (batch.ts); props are instanced; all signs are one
  atlas mesh. Floor view with today's stub models: 44-85 draw calls, under 160k triangles.
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
WASD/arrows, Shift runs, drag to look, wheel to zoom, E to sit, Esc to stand. `&quality=low|high`,
`&view=overview|slots|pit|cashier|bar|poker|lounge|table`, `&stats=1`, `&lineup=1`.
