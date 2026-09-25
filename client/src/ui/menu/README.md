# Account screens

Login, main menu, profile, character editor, HUD (with settings and the keyboard list) and the
cashier. Everything is exported from `client/src/ui/menu/index.ts`; each function takes its
dependencies explicitly, so `app/boot.ts` decides the flow and nothing here reaches for globals.

| export | what it is | returns |
|---|---|---|
| `mountLogin({ root, api, session, onDone, backdrop?, sfx? })` | name and password fields with their live rules, Show/Hide, "Continue as" (asks for the password), API errors under the field they're about | `{ root, close }` |
| `mountMenu({ root, session, onEnter, onCharacter, onProfile, onSettings, onLogout, backdrop?, sfx? })` | Enter Casino, Character, Profile, Settings, Log out; arrows/W/S + Enter | `{ root, close, setOnline(n), focus() }` |
| `openProfile({ root, api, session, onClose? })` | balance, chips on tables, per-game stats, loans | `{ root, close }` |
| `openEditor({ root, api, session, engine, characters?, at?, onClose?(saved), sfx? })` | 3D preview you can turn, body/outfit/colours, Save = `PUT /me/look` | `{ root, close }` |
| `mountHud({ root, session, sfx, onSettings?, onProfile?, onMenu?, onBreak? })` | name, balance, chips at table, session net/time, online, mute, settings, "?"; the play reminder card (ui/hud/reminder.ts, set in Settings by menu/reminder.ts), whose Take a break calls `onBreak` | `{ root, close, setTableChips(stack, escrow?), setOnline(n), toggleShortcuts() }` |
| `openBank({ root, api, session, onClose?, sfx? })` | cashier: balance, chips on tables, loans taken, the top-up rule (under $10,000 in all, back to $50,000), Top up | `{ root, close }` |
| `openSettings({ root, sfx, quality?, reload? })`, `openShortcuts({ root })` | the two sheets the HUD opens; the menu's Settings uses the first | `{ root, close }` |
| `overlayCount()`, `onOverlayChange(fn)` | how many sheets/editor are up: pause the floor controller while > 0 | |

`api` is `import * as api from '../net/api.ts'`, `session` is `app/session.ts`'s singleton,
`engine` the Engine3D, `sfx` the Sfx. `root` is `#ui`.

## Wiring in app/boot.ts

```ts
import * as api from '../net/api.ts';
import { session } from './session.ts';
import { mountHud, mountLogin, mountMenu, openBank, openEditor, openProfile, openSettings } from '../ui/menu/index.ts';

const ui = document.getElementById('ui')!;
// The floor's slow camera pass behind login and menu. Called on mount, its return on close.
// Count users so login -> menu keeps one pass running (mount the menu before closing the login).
const backdrop = () => world.cameraPass();

async function start() {
  if (api.savedToken()) {
    try { session.set(await api.me()); return showMenu(); } catch { api.forgetToken(); }
  }
  showLogin();
}
function showLogin() {
  const login = mountLogin({ root: ui, api, session, sfx, backdrop, onDone: () => { showMenu(); login.close(); } });
}
function showMenu() {
  const menu = mountMenu({
    root: ui, session, sfx, backdrop,
    onEnter: () => { menu.close(); enterFloor(); },
    onCharacter: () => { menu.close(); openEditor({ root: ui, api, session, engine, characters: world.characters, sfx, onClose: () => showMenu() }); },
    onProfile: () => openProfile({ root: ui, api, session, onClose: () => menu.focus() }),
    onSettings: () => openSettings({ root: ui, sfx, quality: engine.quality, onClose: () => menu.focus() }),
    onLogout: () => { api.forgetToken(); session.profile = null; showLogin(); menu.close(); },
  });
  presence.onOnline = (n) => menu.setOnline(n);   // if the floor socket is already up
}
function enterFloor() {
  const hud = mountHud({ root: ui, session, sfx, onProfile: () => openProfile({ root: ui, api, session }), onMenu: () => { hud.close(); showMenu(); } });
  presence.onOnline = (n) => hud.setOnline(n);
  // table session: on each `seat` message -> hud.setTableChips(m.stack, m.escrow); on leaving -> hud.setTableChips(null)
  // cashier station (Press E): openBank({ root: ui, api, session, sfx })
}
```

Notes for integration:

- **The editor borrows the camera.** It builds a small dressing room 60 m below the floor (pass
  `at` to move it), points `engine.camera` at it and restores the camera on close. Pause the
  floor's follow camera and controller while it is open (`overlayCount() > 0` covers this and
  every sheet). Its lights have a short reach, so they never light the floor.
- **Characters.** Pass the world's `CharacterFactory` as `characters`; without it a primitive
  mannequin stands in (`mannequins`, also usable on the floor until models load). The editor
  disposes only what it built; the world's character is disposed through its own `dispose()`.
- **Your own avatar.** After a save the session's profile carries the new look
  (`session.on`); the server also pushes it to everyone on the floor (`player` with `look`).
- **Keys.** Sheets and the editor take the keyboard: Esc closes the top one, Tab stays inside,
  other keydowns never reach window listeners behind them (keyups do, so held WASD clears). M and
  ? stay global; the HUD handles both. Floor code should also ignore keys while
  `overlayCount() > 0`.
- **Volume.** Sfx owns it: `sfx.setVolume(v)` persists `casino.volume`, and unmuting comes back
  to that level.
- **Balance timing.** The HUD rolls to whatever the session says; hold `session.balance()` until a
  table's reveal lands if the view wants the number to change after the animation.
- **Bottom-left corner** is left empty on every screen for the site's back chip.

## Dev page

`PORT_BASE=5430 npm run dev`, then
`http://localhost:5430/casino/src/ui/menu/dev.html?screen=<flow|login|menu|profile|editor|hud|bank|settings|shortcuts>`
with `fixture=1` (a canned regular player), `broke=1` (that player at $0), `name=<n>`,
`backdrop=3d`, `dock=0`. Headless tour with screenshots: `node scripts/e2e/accounts.mjs 5430 <outDir>`.
