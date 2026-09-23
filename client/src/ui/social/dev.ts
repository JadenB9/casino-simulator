// Dev page for the leaderboards and the emote wheel, served by Vite in development only:
//   /casino/src/ui/social/dev.html?screen=<leaderboard|emotes|hud>
// Options: fixture=1 (canned boards instead of the local worker), fail=1 (with fixture: the
// request fails), name=<n> (log in as n against the worker), tab=<richest|biggestWin|rounds>.
// It is also a worked example of the wiring app/boot.ts needs: the HUD gets two buttons, G
// opens the wheel, and a pick goes to the floor link (here, a toast).

import '../menu/dev.css';
import { Engine3D, savedQuality } from '../../render/engine3d.ts';
import { Sfx } from '../../audio/sfx.ts';
import { devRoom } from '../../world/dev-room.ts';
import { GAMES } from '../../games/index.ts';
import * as realApi from '../../net/api.ts';
import { session } from '../../app/session.ts';
import { el, toast } from '../kit.ts';
import { regular } from '../menu/fixtures.ts';
import { mountHud } from '../menu/index.ts';
import { fixtureApi } from './fixtures.ts';
import { EMOTE_LABELS, mountEmotes, openLeaderboard, socialApi, socialIcon, type LeaderboardApi } from './index.ts';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'leaderboard';
const ui = document.getElementById('ui')!;

const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality());
const sfx = new Sfx();
void sfx.load().catch(() => {});
devRoom(engine, GAMES.blackjack, '');
engine.camera.position.set(1.95, 1.5, 2.35);
engine.camera.lookAt(0, 0.8, 0);

const fixture = q.get('fixture') === '1';
const api: LeaderboardApi = fixture ? fixtureApi({ fail: q.get('fail') === '1' }) : socialApi;

async function ensureSession(): Promise<void> {
  if (fixture) {
    session.set(regular());
    return;
  }
  session.set(await realApi.login(q.get('name') ?? `dev_${Math.random().toString(36).slice(2, 8)}`));
}

function hudButton(icon: 'leaderboard' | 'emotes', label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'hud-btn');
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(socialIcon(icon));
  b.addEventListener('click', onClick);
  return b;
}

async function start(): Promise<void> {
  await ensureSession();
  const hud = mountHud({ root: ui, session, sfx, onMenu: () => {} });
  hud.setOnline(23);
  const emotes = mountEmotes({ root: ui, send: (e) => toast(`${EMOTE_LABELS[e]} sent`) });
  const openBoards = () => openLeaderboard({ root: ui, api });
  // Where boot.ts would put them: with the HUD's other buttons, before the bulb.
  const right = hud.root.querySelector('.hud-right')!;
  right.insertBefore(hudButton('emotes', 'Emotes (G)', () => emotes.toggle()), right.querySelector('.hud-btn'));
  right.insertBefore(hudButton('leaderboard', 'Leaderboards', openBoards), right.querySelector('.hud-btn'));

  const tab = q.get('tab');
  if (screen === 'leaderboard') {
    openBoards();
    if (tab) {
      await new Promise((r) => setTimeout(r, 50));
      document.querySelector<HTMLButtonElement>(`.lb-tabs [id$="-${tab}"]`)?.click();
    }
  } else if (screen === 'emotes') {
    emotes.open();
  }
  (window as unknown as { dev: unknown }).dev = { engine, session, hud, emotes, openBoards };
}

start().catch((err) => {
  console.error(err);
  ui.append(el('p', 'dev-error', String(err?.message ?? err)));
});
