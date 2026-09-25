// Achievements on the floor, in one place for app/boot.ts: the HUD's cup button and J, the sheet,
// the card when you earn one, and the title under your name in the HUD.
//
//   const feats = mountFeats({ root: ui, session, sfx, game: () => atTableGame });
//   hudBar.insertBefore(feats.button, first);    // once the HUD is up; feats.useHud(hud.root)
//   feats.tableFeat(msg, (fn) => table.afterShown(fn));   // a table's {t:'feat'}
//   feats.floorFeat(msg);                        // the floor's {t:'feat'}: yours, if no table said
//
// A feat is announced by the table where it was earned, once the round behind it has been shown
// (never over the dealer's result). One earned after you stood up (its tallies reached D1 as you
// left) only reaches you through the floor, and shows from there.

import './feats.css';
import type { GameId } from '../../../../shared/src/engine.ts';
import { featOf } from '../../../../shared/src/feats.ts';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { isTyping } from '../keyboard.ts';
import type { SfxLike, SessionLike } from '../menu/deps.ts';
import { el } from '../kit.ts';
import { saveLook } from '../../net/api.ts';
import * as featsApi from './api.ts';
import { cupIcon } from './icons.ts';
import { titleText } from './lines.ts';
import { openFeats, type FeatsApi, type FeatsSheet } from './sheet.ts';
import { UnlockCards } from './unlock.ts';

export { openFeats, type FeatsApi, type FeatsSheet } from './sheet.ts';
export { UnlockCards } from './unlock.ts';
export { feedLines, titleText } from './lines.ts';
export { featsApi };

/** A card waits at most this long for its table to finish showing the round. */
const SHOW_BY_MS = 15_000;

export interface FeatsDeps {
  root: HTMLElement;
  session: SessionLike & { balance?(balance: number, inPlay: number, rev: number): void };
  sfx?: SfxLike;
  /** GET /feats and the look save; the real ones by default. */
  api?: FeatsApi;
  /** The game at the table you're at, if any: the sheet opens at its feats. */
  game?: () => GameId | null;
}

/** A table's news: you earned one here. */
export interface TableFeat {
  feat: string;
  at: number;
  balance?: { balance: number; inPlay: number; rev: number };
  /** The cash it paid (it scales with the round's stake): short of the listed amount, the card says so. */
  paid?: number;
}

export interface FeatsUi {
  /** The HUD button (the cup): boot puts it in the HUD's right-hand bar. */
  readonly button: HTMLButtonElement;
  toggle(): void;
  /** Put the title you wear under your name in this HUD (call again for a new HUD). */
  useHud(hudRoot: HTMLElement | null): void;
  /** A table said you earned one; `whenShown` runs its callback once the round has been shown. */
  tableFeat(m: TableFeat, whenShown?: (fn: () => void) => void): void;
  /** The floor's feed line: shown here only if it is yours and no table has said so. */
  floorFeat(m: { id: number; feat: string }): void;
  dispose(): void;
}

export function mountFeats(deps: FeatsDeps): FeatsUi {
  const { session } = deps;
  const api: FeatsApi = deps.api ?? { feats: featsApi.feats, saveLook };
  let sheet: FeatsSheet | null = null;
  const toggle = () => {
    if (sheet) {
      sheet.close();
      return;
    }
    sheet = openFeats({ root: deps.root, api, session, game: deps.game?.() ?? null, onClose: () => (sheet = null) });
  };
  const cards = new UnlockCards(deps.root, deps.sfx, () => {
    if (!sheet) toggle();
  });

  const button = el('button', 'hud-btn');
  button.type = 'button';
  button.title = 'Achievements (J)';
  button.setAttribute('aria-label', 'Achievements (J)');
  button.append(cupIcon());
  button.addEventListener('click', toggle);

  const onKey = (e: KeyboardEvent) => {
    // (Shift+J joins the newest invite: ui/lobby/invites.ts)
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || isTyping(e)) return;
    if (e.code !== 'KeyJ') return;
    e.preventDefault();
    toggle();
  };
  addEventListener('keydown', onKey);

  // --- your title in the HUD ---------------------------------------------------------------------

  let hudWho: HTMLElement | null = null;
  const paintWho = (p: Profile | null) => {
    if (!hudWho || !p) return;
    const title = titleText(p.look.title);
    // the HUD writes the name as the element's text; with a title it becomes two lines
    hudWho.classList.toggle('titled', title !== null);
    if (title) hudWho.replaceChildren(el('span', 'hud-name', p.name), el('span', 'hud-title', title));
    else if (hudWho.childElementCount > 0) hudWho.textContent = p.name;
  };
  const offSession = session.on((p) => paintWho(p));

  // --- earning one -----------------------------------------------------------------------------

  /** Feats already announced (or being announced) this page, so the floor's copy doesn't repeat one. */
  const told = new Set<string>();
  const land = (feat: string, at: number, balance?: TableFeat['balance'], paid?: number) => {
    // The profile learns of the feat with the money it paid (the HUD's session net leaves that
    // cash out, so the two go together); without the money, the next profile read brings both.
    const p = session.profile;
    const known = !(featOf(feat)?.reward.cash) || (balance !== undefined && paid !== undefined);
    if (known && p && !(p.feats ?? []).some((f) => f.feat === feat)) session.set({ ...p, feats: [...(p.feats ?? []), { feat, at, ...(paid !== undefined ? { paid } : {}) }] });
    if (balance) deps.session.balance?.(balance.balance, balance.inPlay, balance.rev);
    cards.show(feat, paid);
    sheet?.earned(feat, at, paid);
  };

  return {
    button,
    toggle,
    useHud(hudRoot) {
      hudWho = hudRoot?.querySelector<HTMLElement>('.hud-who') ?? null;
      paintWho(session.profile);
    },
    tableFeat(m, whenShown) {
      if (!featOf(m.feat) || told.has(m.feat)) return;
      told.add(m.feat);
      // The card and the money wait for the round that earned them to play out; a table left
      // before that (it never finishes showing) still gets its card, a little later.
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        land(m.feat, m.at, m.balance, m.paid);
      };
      if (!whenShown) return go();
      whenShown(go);
      window.setTimeout(go, SHOW_BY_MS);
    },
    floorFeat(m) {
      const me = session.profile?.id;
      if (me === undefined || m.id !== me || !featOf(m.feat) || told.has(m.feat)) return;
      told.add(m.feat);
      land(m.feat, Date.now());
    },
    dispose() {
      removeEventListener('keydown', onKey);
      offSession();
      sheet?.close();
      cards.dispose();
      button.remove();
      if (hudWho && session.profile) hudWho.textContent = session.profile.name;
    },
  };
}
