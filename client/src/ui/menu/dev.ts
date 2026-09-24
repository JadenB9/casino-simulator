// Dev page for the account screens, served by Vite in development only:
//   /casino/src/ui/menu/dev.html?screen=<flow|login|menu|profile|editor|onboard|hud|bank|settings|shortcuts>
// Options: fixture=1 (canned player instead of the local worker), broke=1 (that player at $0),
// new=1 (a brand-new player: the flow walks them through picking a look first),
// name=<n> (log in as n), backdrop=3d (a slow orbit of the room behind login and menu),
// online=<n>, seated=0, dock=0 (hide the screen links, for screenshots).
// It is also a worked example of the wiring app/boot.ts needs; see README.md.

import './dev.css';
import { Engine3D, savedQuality } from '../../render/engine3d.ts';
import { Sfx } from '../../audio/sfx.ts';
import { devRoom } from '../../world/dev-room.ts';
import { GAMES } from '../../games/index.ts';
import * as realApi from '../../net/api.ts';
import { session } from '../../app/session.ts';
import { el } from '../kit.ts';
import { broke, fixtureApi, newcomer, regular } from './fixtures.ts';
import { isNewPlayer, mountHud, mountLogin, mountMenu, openBank, openEditor, openOnboarding, openProfile, openSettings, openShortcuts, type AccountApi, type Hud } from './index.ts';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'flow';
const ui = document.getElementById('ui')!;

const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality());
const sfx = new Sfx();
void sfx.load().catch(() => {});
devRoom(engine, GAMES.highcard, '');
const cam = engine.camera;
const rest = () => {
  cam.position.set(1.95, 1.5, 2.35);
  cam.lookAt(0, 0.8, 0);
};
rest();

// A slow orbit of the room behind login and menu, counted so that going from one to the other
// keeps the same pass running (mount the next screen before closing the last).
let orbiters = 0;
let stopOrbit: (() => void) | null = null;
let angle = 0.7;
const orbit = () => {
  if (orbiters++ === 0) {
    stopOrbit = engine.onFrame((dt) => {
      angle += dt * 0.05;
      cam.position.set(Math.sin(angle) * 3.2, 1.5, Math.cos(angle) * 3.2);
      cam.lookAt(0, 0.8, 0);
    });
  }
  return () => {
    if (--orbiters === 0) {
      stopOrbit?.();
      stopOrbit = null;
      rest();
    }
  };
};
const backdrop = q.get('backdrop') === '3d' ? orbit : undefined;

const fixture = q.get('fixture') === '1';
const api: AccountApi = fixture
  ? fixtureApi(q.get('new') === '1' ? newcomer() : q.get('broke') === '1' ? broke() : regular(), { lastName: q.has('last') ? q.get('last') || null : undefined })
  : realApi;
const online = q.has('online') ? Number(q.get('online')) : 14;

async function ensureSession(): Promise<void> {
  if (session.profile) return;
  const name = q.get('name') ?? `dev_${Math.random().toString(36).slice(2, 8)}`;
  // A canned player keeps its own name unless the URL asks for another.
  session.set(fixture && !q.has('name') ? await api.me() : await api.login(name, realApi.DEV_PASSWORD));
}

let hud: Hud | null = null;

function showLogin(): void {
  const login = mountLogin({
    root: ui,
    api,
    session,
    sfx,
    backdrop,
    onDone: (p) => {
      if (isNewPlayer(p)) onboard();
      else showMenu();
      login.close();
    },
  });
}

function onboard(): void {
  openOnboarding({ root: ui, api, session, engine, sfx, onDone: () => enterFloor() });
}

function showMenu(): void {
  const menu = mountMenu({
    root: ui,
    session,
    sfx,
    backdrop,
    onEnter: () => {
      menu.close();
      enterFloor();
    },
    onCharacter: () => {
      menu.close();
      openEditor({ root: ui, api, session, engine, sfx, onClose: () => showMenu() });
    },
    onProfile: () => openProfile({ root: ui, api, session, onClose: () => menu.focus() }),
    onSettings: () => openSettings({ root: ui, sfx, onClose: () => menu.focus() }),
    onLogout: () => {
      api.forgetToken();
      session.profile = null;
      showLogin();
      menu.close();
    },
  });
  menu.setOnline(online);
}

function enterFloor(): void {
  hud = mountHud({
    root: ui,
    session,
    sfx,
    onProfile: () => openProfile({ root: ui, api, session }),
    onMenu: () => {
      hud?.close();
      hud = null;
      showMenu();
    },
  });
  hud.setOnline(online);
  if (q.get('seated') !== '0') hud.setTableChips(125_000, 100_000);
}

function dock(): void {
  if (q.get('dock') === '0') return;
  const nav = el('nav', 'dev-dock');
  for (const s of ['flow', 'login', 'menu', 'profile', 'editor', 'onboard', 'hud', 'bank', 'settings', 'shortcuts']) {
    const a = el('a', s === screen ? 'on' : '', s);
    const p = new URLSearchParams(q);
    p.set('screen', s);
    a.href = `?${p}`;
    nav.append(a);
  }
  const fx = el('a', fixture ? 'on' : '', 'fixture');
  const p = new URLSearchParams(q);
  if (fixture) p.delete('fixture');
  else p.set('fixture', '1');
  fx.href = `?${p}`;
  nav.append(fx);
  ui.append(nav);
}

async function start(): Promise<void> {
  dock();
  switch (screen) {
    case 'login':
    case 'flow':
      showLogin();
      break;
    case 'menu':
      await ensureSession();
      showMenu();
      break;
    case 'profile':
      await ensureSession();
      openProfile({ root: ui, api, session });
      break;
    case 'editor':
      await ensureSession();
      openEditor({ root: ui, api, session, engine, sfx, onClose: rest });
      break;
    case 'onboard':
      await ensureSession();
      openOnboarding({ root: ui, api, session, engine, sfx, onDone: rest });
      break;
    case 'hud':
      await ensureSession();
      enterFloor();
      break;
    case 'bank':
      await ensureSession();
      openBank({ root: ui, api, session, sfx });
      break;
    case 'settings':
      openSettings({ root: ui, sfx });
      break;
    case 'shortcuts':
      openShortcuts({ root: ui });
      break;
  }
}

(window as unknown as { dev: unknown }).dev = { engine, session, api, sfx, get hud() { return hud; }, openBank: () => openBank({ root: ui, api, session, sfx }) };
start().catch((err) => {
  console.error(err);
  ui.append(el('p', 'dev-error', String(err?.message ?? err)));
});
