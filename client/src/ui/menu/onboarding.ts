// A new player's first minutes: before the menu, the character editor walks them through picking
// their look (body and outfit, skin and hair, clothes), starting from a look of their own, and
// then goes straight onto the floor. Nobody walks in as the default suit: anyone still in it gets
// their own starting look (the same one every time for that account) when they enter, saved so
// everyone else sees it too.
//
// "New" comes from the profile alone: no rounds played, created in the last quarter of an hour,
// and still in the default look. A reload half way through starts the walk-through again.

import type { Profile } from '../../../../shared/src/protocol.ts';
import { DEFAULT_LOOK, type Look } from '../../../../shared/src/look.ts';
import { openEditor, type EditorDeps } from '../editor/editor.ts';
import { sameLook, startingLook } from '../editor/palettes.ts';
import type { AccountApi, Closable, SessionLike } from './deps.ts';

/** How long after its creation an account that hasn't played or dressed yet counts as new. */
export const NEW_FOR_MS = 15 * 60_000;

export function isNewPlayer(p: Profile, now = Date.now()): boolean {
  return p.stats.total.rounds === 0 && now - p.createdAt < NEW_FOR_MS && sameLook(p.look, DEFAULT_LOOK);
}

export interface OnboardingDeps extends Omit<EditorDeps, 'guided' | 'start' | 'onClose'> {
  /** The look is saved (and in the session): go onto the floor. */
  onDone(look: Look): void;
}

/** "Pick your look": the guided editor, starting from the account's own starting look. */
export function openOnboarding(deps: OnboardingDeps): Closable {
  const p = deps.session.profile;
  const { onDone, ...rest } = deps;
  return openEditor({
    ...rest,
    guided: true,
    start: p ? { ...p.look, ...startingLook(p.id) } : DEFAULT_LOOK,
    onClose: (saved) => onDone(saved ?? deps.session.profile?.look ?? DEFAULT_LOOK),
  });
}

/**
 * On entering the floor: an account still in the default look gets its starting look, in the
 * session at once (your character changes before anyone sees the suit) and saved for everyone
 * else. Returns the look it gave, or null when the account already has its own. A failed save
 * is tried again a couple of times; the look stays for this visit either way.
 */
export function ensureOwnLook(deps: { api: Pick<AccountApi, 'saveLook'>; session: SessionLike }): Look | null {
  const p = deps.session.profile;
  if (!p || !sameLook(p.look, DEFAULT_LOOK)) return null;
  // only the body and clothes are dealt: anything worn from the boutique or the bar stays on
  const look: Look = { ...p.look, ...startingLook(p.id) };
  deps.session.set({ ...p, look });
  const save = (tries: number) =>
    deps.api
      .saveLook(look)
      .then((stored) => {
        const now = deps.session.profile;
        if (now?.id === p.id && !sameLook(now.look, stored)) deps.session.set({ ...now, look: stored });
      })
      .catch(() => {
        if (tries > 1) setTimeout(() => void save(tries - 1), 5000);
      });
  void save(3);
  return look;
}
