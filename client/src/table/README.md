# client/src/table

What every table view shares: the stage a view draws on (`stage.ts`), the felt and its click
regions (`felt.ts`), cards, chips and dice, tweens, the celebration, the Max rules, the limits
sign, and the board fit (`fit.ts`).

## Keeping the whole board in view (`fit.ts`)

A play pose is framed for a full screen. In a laptop window that isn't full screen, a short wide
window or a tall narrow one, or on a phone, part of the board could end up off the edge or under
the controls. Every table therefore fits its **board** (the playing surface: the betting spots,
the cards, the dealer's side, the wheel, the reels, the screen) into the part of the screen its
controls leave free, and fits it again whenever the window or the controls change.

The camera is never moved: its **lens** changes. It widens (`camera.zoom` below 1) only as much
as the board needs, and its centre slides (`camera.setViewOffset`) so the board sits inside the
free space. It's the game's own picture from the game's own eye, taken in wider, so the angle
and feel stay, nothing gets between the camera and the table, and the fly-ins, swings and glides
keep working. A board that already fits is left exactly as it was framed. Picking, labels and the
DOM screens mapped onto monitors all go through the camera's projection, so they follow the lens.

The free space is measured: the visible elements over the scene in `#ui` (and the children of
its see-through `.pass` wrappers, such as the HUD's two clusters), and the site's back chip. The
chosen space is the clear rectangle that takes the board with the least change (least widening,
then least slide). Something that shows now and then (the dealer's line, a chat peek) keeps its
place for 12 s after it hides, so the view doesn't breathe with it. Skipped: modals, toasts, the
floor prompt, anything covering most of the screen, and anything marked `data-fit="ignore"`.

`?fit=off` (or `localStorage['casino.fit'] = 'off'`) switches it off, to compare.

### Plugging a game in

The session drives the fit every frame; a view only says what its board is, in table-local
coordinates (the stage root's frame, the same one it draws in):

```ts
// a table with a felt: nothing to do, every felt region is the board by default
// name more (or less) with stage.board(), which replaces the default
ctx.stage.board(regionPoints(felt, (id) => id.startsWith('R|')), around(DEALER_CARDS, 0.2, 0.06));

// a machine: its face; a computer: the monitor's glass (OnlineScreen.follow() does this itself)
ctx.stage.board(playFace(layout));

// a view that swings the camera to another shot says what that shot must show, and ends it
stage.shot(WHEEL_POSE, ring([WHEEL_X, TOP_Y, 0], WHEEL_R));
stage.shot(null);
```

A part is a point (`[x, y, z]` or a `Vector3`), a `Box3`, an `Object3D` (its box in the table's
frame), a `Felt` (its regions), or a list of parts. Helpers: `around(p, hw, hd)` (a flat patch:
a card, a box), `ring(c, r)` (a wheel, a bowl), `regionPoints(felt, keep)` (some of a felt's
regions), `boxPoints(box)`.

Which board: the spots **you** play (all of them while you watch), and everything shared (the
dealer's cards and rack, the wheel, the layout of a game whose layout is everyone's). At a
shared table other seats' spots may fall outside on a small window, as they would to a player
sitting there. Call `board()` again when that changes (you sit, you take more spots).

A DOM board (a machine's screen, the online page) must carry `data-fit="ignore"` so it isn't
measured as a control over itself.

### Checking it

`scripts/e2e/fit6.mjs` sits at every game solo, resizes the window through the laptop, wide and
narrow sizes and the phone layouts, projects `stage.fit.keyPoints()` with the real camera and
checks each is on screen and clear of every control; `DEBUG=1` draws the points and the
controls on the screenshots. `client/test/fit.test.ts` covers the maths.
