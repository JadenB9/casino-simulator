// Dev page for the achievements, served by Vite in development only:
//   /casino/src/ui/feats/dev.html?screen=<sheet|card|hud>&game=<id>&card=<feat id>
// Canned progress (a regular's: a dozen feats, a title worn), or name=<n> to log in against the
// local worker and see a real account's. It is also a worked example of the wiring boot.ts does.

import '../menu/dev.css';
import { Engine3D, savedQuality } from '../../render/engine3d.ts';
import { Sfx } from '../../audio/sfx.ts';
import { devRoom } from '../../world/dev-room.ts';
import { GAMES } from '../../games/index.ts';
import * as realApi from '../../net/api.ts';
import { session } from '../../app/session.ts';
import { el } from '../kit.ts';
import { regular } from '../menu/fixtures.ts';
import { mountHud } from '../menu/index.ts';
import type { GameId } from '../../../../shared/src/engine.ts';
import type { FeatsResponse } from '../../../../shared/src/feats.ts';
import type { Look } from '../../../../shared/src/look.ts';
import { mountFeats, type FeatsApi } from './index.ts';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'sheet';
const ui = document.getElementById('ui')!;

const engine = new Engine3D(document.getElementById('scene') as HTMLCanvasElement, document.getElementById('labels')!, savedQuality());
const sfx = new Sfx();
void sfx.load().catch(() => {});
devRoom(engine, GAMES.videopoker, '');
engine.camera.position.set(1.95, 1.5, 2.35);
engine.camera.lookAt(0, 0.8, 0);

const DAY = 86_400_000;
const now = Date.now();
const EARNED: [string, number][] = [
  ['first-win', 30], ['won-10k', 29], ['bj-blackjack', 29], ['bj-double', 27], ['rl-straight', 22], ['cr-point', 20],
  ['bc-natural', 18], ['sl-bonus', 12], ['vp-quads', 9], ['vp-royal', 3], ['won-100k', 3], ['rounds-100', 26],
  ['games-5', 14], ['he-pot', 11], ['pk-edge', 6], ['round-10k', 3],
];
const TALLY: Record<string, number> = {
  won: 41_236_000, rounds: 2_571, best: 2_000_000,
  'won:blackjack': 3_120_000, 'wins:blackjack': 188, 'bj:naturals': 14,
  'won:roulette': 1_875_000, 'wins:roulette': 71,
  'won:craps': 912_500, 'wins:craps': 40,
  'won:baccarat': 2_400_000, 'wins:baccarat': 66,
  'won:slots': 4_450_000, 'wins:slots': 301,
  'won:videopoker': 5_210_000, 'wins:videopoker': 144,
  'won:holdem': 380_000, 'wins:holdem': 9,
  'won:plinko': 91_300, 'wins:plinko': 52,
};

const fixture: FeatsApi = {
  // (Four of a Kind was hit on a $25 hand: $31.25 of its $2,500)
  feats: () => new Promise<FeatsResponse>((r) => setTimeout(() => r({ feats: EARNED.map(([feat, d]) => ({ feat, at: now - d * DAY, ...(feat === 'vp-quads' ? { paid: 3_125 } : {}) })), tally: TALLY }), 250)),
  saveLook: async (look: Look) => look,
};

async function start(): Promise<void> {
  const name = q.get('name');
  if (name) session.set(await realApi.login(name, realApi.DEV_PASSWORD));
  else session.set({ ...regular(), look: { ...regular().look, title: 'vp-royal' }, feats: EARNED.map(([feat, d]) => ({ feat, at: now - d * DAY })) });
  const hud = mountHud({ root: ui, session, sfx, onMenu: () => {} });
  hud.setOnline(23);
  const feats = mountFeats({ root: ui, session, sfx, api: name ? undefined : fixture, game: () => (q.get('game') as GameId | null) ?? null });
  const bar = hud.root.querySelector('.hud-right')!;
  bar.insertBefore(feats.button, bar.querySelector('.hud-btn'));
  feats.useHud(hud.root);
  if (screen === 'sheet') feats.toggle();
  if (screen === 'card') for (const f of (q.get('card') ?? 'vp-royal,won-1m').split(',')) feats.tableFeat({ feat: f, at: Date.now() });
  (window as unknown as { dev: unknown }).dev = { engine, session, hud, feats };
}

start().catch((err) => {
  console.error(err);
  ui.append(el('p', 'dev-error', String(err?.message ?? err)));
});
