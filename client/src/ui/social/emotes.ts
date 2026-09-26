// The emote wheel: every gesture in two rings round a hub, opened with G or a HUD button, on the
// floor or at a table (where everyone else sees your seated character do it). The six everyone
// has sit on the inner ring on 1 to 6; the ten from the boutique and the feats go round the
// outside on the top row of letters, Q to P, always in the same places, so a key never moves when
// you buy another. Pick one by its key, with the arrow keys and Enter, or with a click or a tap;
// it goes out on the floor socket and the wheel closes.
//
// One you don't have yet is on the wheel too, dimmed, with its price (or, for a feat's reward,
// what earns it): its key only points it out, and a click or Enter on it opens the boutique at it
// (where a reward is shown as won, never sold, with the feat that gives it). What you own comes
// from the profile and from the floor's `owned` message, which grant() takes while the wheel is up.
//
// While it's open it holds the keyboard like any panel, so a number picks a gesture rather than
// a chip and W doesn't walk; it lets go the moment it closes. Esc, G again or a click or tap
// outside put it away.
//
// The floor lets three gestures through in a burst, then one every two seconds
// (server/src/floor/index.ts). The wheel keeps the same count, a little slower, so it never
// sends one the server would drop, and says so instead.

import './social.css';
import { FREE_EMOTES, REWARD_EMOTES, SHOP_EMOTES, type EmoteId } from '../../../../shared/src/protocol.ts';
import { emoteItem, isFreeEmote } from '../../../../shared/src/items.ts';
import { FEATS } from '../../../../shared/src/feats.ts';
import { formatCompact, formatMoney } from '../../../../shared/src/money.ts';
import { el } from '../kit.ts';
import { GLOBAL_KEYS, holdKeyboard, isTyping, overlayCount } from '../keyboard.ts';
import { EMOTE_LABELS, emoteGlyph, lockGlyph } from './icons.ts';
import { isKey } from '../keys.ts';

export interface EmoteDeps {
  root: HTMLElement;
  /** Send the gesture: `(e) => link.emote(e)`. */
  send(e: EmoteId): void;
  /** Every item and emote id the account has (the profile's `owned`); none: only the free six. */
  owned?: () => Iterable<string> | undefined;
  /** Open the boutique at an emote you don't have yet; none: a locked one only shows its price. */
  shop?: (e: EmoteId) => void;
  /** Listen for G to open and close the wheel (default true). */
  key?: boolean;
}

export interface EmoteWheel {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** You own these now (the floor's `owned` message): unlocked on the wheel at once. */
  grant(emotes: readonly string[]): void;
  /** Close it and stop listening for G (leaving the floor). */
  dispose(): void;
}

/** The inner ring (1-6), then the outer ring (Q-P): the sold ones, then the feats' rewards. */
const INNER: readonly EmoteId[] = FREE_EMOTES;
// (v7.4: the Twerk came after the rewards, so it goes after them and nobody's keys move)
const OUTER: readonly EmoteId[] = [...SHOP_EMOTES.slice(0, 8), ...REWARD_EMOTES, ...SHOP_EMOTES.slice(8)];
export const WHEEL_EMOTES: readonly EmoteId[] = [...INNER, ...OUTER];
/** The outer ring's keys, clockwise from the top: the keyboard's top row. */
const OUTER_KEYS = 'QWERTYUIOP[';

const BURST = 3;
/** The server refills at 0.5 a second; a tenth slower here absorbs network jitter. */
const REFILL_PER_S = 0.45;
/** Distance from the hub to each ring's button centres, px, and the wheel's own size. */
const RADIUS = 92;
const RADIUS_OUT = 170;
const WHEEL_PX = 432;
const HINT = '1-6 · Q-[ · Esc';

/** The emote a key picks on the wheel: 1 to 6 the inner ring, Q to P (by key position) the outer, or null. */
export function emoteForKey(key: string, code = ''): EmoteId | null {
  if (/^[1-9]$/.test(key)) return INNER[Number(key) - 1] ?? null;
  const letter = /^Key[A-Z]$/.test(code) ? code.slice(3) : code === 'BracketLeft' || key === '[' ? '[' : /^[a-z]$/i.test(key) ? key.toUpperCase() : '';
  const i = letter ? OUTER_KEYS.indexOf(letter) : -1;
  return i >= 0 ? (OUTER[i] ?? null) : null;
}

/** The key shown on an emote's button. */
export function keyOf(e: EmoteId): string {
  const i = INNER.indexOf(e);
  return i >= 0 ? String(i + 1) : (OUTER_KEYS[OUTER.indexOf(e)] ?? '');
}

/** Where the `i`-th of `n` buttons sits from the hub: clockwise from the top, `r` px out. */
export function wheelSpot(i: number, n: number, r = RADIUS): { x: number; y: number } {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** Every button on the wheel: its emote, ring, key and place from the hub. */
export function wheelLayout(): { e: EmoteId; ring: 0 | 1; key: string; x: number; y: number }[] {
  return [
    ...INNER.map((e, i) => ({ e, ring: 0 as const, key: keyOf(e), ...wheelSpot(i, INNER.length, RADIUS) })),
    ...OUTER.map((e, i) => ({ e, ring: 1 as const, key: keyOf(e), ...wheelSpot(i, OUTER.length, RADIUS_OUT) })),
  ];
}

/** Whether you can play `e`: one of the free six, or in what you own. */
export function hasEmote(e: EmoteId, owned: ReadonlySet<string>): boolean {
  return isFreeEmote(e) || owned.has(e);
}

/** The emotes on the wheel you can't play yet, in wheel order. */
export function lockedEmotes(owned: Iterable<string> | undefined): EmoteId[] {
  const have = new Set(owned ?? []);
  return WHEEL_EMOTES.filter((e) => !hasEmote(e, have));
}

/** What a locked emote's button says under it, and the hub's line for it. */
export function lockedLabel(e: EmoteId): { tag: string; line: string; reward: boolean } {
  const item = emoteItem(e);
  if (item?.reward) {
    const feat = FEATS.find((f) => f.reward.emote === e);
    return { tag: 'Reward', line: feat ? `Earned: ${feat.about.replace(/\.$/, '')}` : 'Earned, not sold', reward: true };
  }
  const price = item?.price ?? 0;
  return { tag: formatCompact(price), line: `${formatMoney(price)} in the boutique`, reward: false };
}

export function mountEmotes(deps: EmoteDeps): EmoteWheel {
  let tokens = BURST;
  let tokensAt = performance.now();
  const take = (): boolean => {
    const now = performance.now();
    tokens = Math.min(BURST, tokens + ((now - tokensAt) / 1000) * REFILL_PER_S);
    tokensAt = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
  /** Emotes the floor says you've got since the profile was read. */
  const granted = new Set<string>();
  const owned = (): Set<string> => new Set([...(deps.owned?.() ?? []), ...granted]);

  interface Ui {
    scrim: HTMLElement;
    wheel: HTMLElement;
    name: HTMLElement;
    hint: HTMLElement;
    buttons: HTMLButtonElement[];
    have: Set<string>;
    release: () => void;
    before: HTMLElement | null;
  }
  let ui: Ui | null = null;
  let hintTimer = 0;

  const label = (e: EmoteId | null) => {
    if (!ui || ui.wheel.classList.contains('cooling')) return;
    ui.name.textContent = e ? (EMOTE_LABELS[e] ?? e) : 'Emotes';
    ui.hint.textContent = e && !hasEmote(e, ui.have) ? lockedLabel(e).line : HINT;
    ui.hint.classList.toggle('price', !!e && !hasEmote(e, ui.have));
  };

  const pick = (e: EmoteId) => {
    if (!ui) return;
    if (!hasEmote(e, ui.have)) {
      // not yours yet: to the boutique, which sells it or says what earns it
      if (deps.shop) {
        close();
        deps.shop(e);
      } else {
        focusOn(e);
      }
      return;
    }
    if (!take()) {
      // Too soon: say so and stay open, so the next try is one keypress away.
      ui.wheel.classList.add('cooling');
      ui.name.textContent = EMOTE_LABELS[e] ?? e;
      ui.hint.textContent = 'One moment';
      ui.hint.classList.remove('price');
      clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => {
        ui?.wheel.classList.remove('cooling');
        label(null);
      }, 1_200);
      return;
    }
    deps.send(e);
    close();
  };

  /** Point a locked one out (its key was pressed): focused, its price in the hub. */
  const focusOn = (e: EmoteId) => {
    const b = ui?.buttons.find((x) => x.dataset.emote === e);
    b?.focus({ preventScroll: true });
    label(e);
  };

  /** Mark each button owned or locked (on opening, and when the floor grants one). */
  const paint = () => {
    if (!ui) return;
    ui.have = owned();
    for (const b of ui.buttons) {
      const e = b.dataset.emote as EmoteId;
      const locked = !hasEmote(e, ui.have);
      b.classList.toggle('locked', locked);
      b.querySelector('.emo-tag')?.remove();
      const name = EMOTE_LABELS[e] ?? e;
      if (locked) {
        const l = lockedLabel(e);
        const tag = el('span', 'emo-tag');
        tag.append(lockGlyph(), document.createTextNode(l.tag));
        b.append(tag);
        b.setAttribute('aria-label', `${name}, locked: ${l.line}`);
      } else {
        b.setAttribute('aria-label', `${name} (${keyOf(e)})`);
      }
    }
  };

  /** Fit the wheel on a small screen (a phone held upright). */
  const fit = () => {
    if (!ui) return;
    const s = Math.min(1, (innerWidth - 16) / WHEEL_PX, (innerHeight - 16) / WHEEL_PX);
    ui.wheel.style.setProperty('--emo-scale', s.toFixed(3));
  };

  const open = () => {
    if (ui) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrim = el('div', 'emo-scrim');
    const wheel = el('div', 'emo-wheel');
    wheel.setAttribute('role', 'dialog');
    wheel.setAttribute('aria-label', 'Emotes');
    wheel.tabIndex = -1;
    const hub = el('div', 'emo-hub');
    const name = el('div', 'emo-name', 'Emotes');
    const hint = el('div', 'emo-hint', HINT);
    hub.append(name, hint);
    wheel.append(el('div', 'emo-ring'), el('div', 'emo-divide'), hub);

    const buttons = wheelLayout().map(({ e, ring, key, x, y }) => {
      const b = el('button', ring ? 'emo-btn outer' : 'emo-btn');
      b.type = 'button';
      b.dataset.emote = e;
      b.style.setProperty('--x', `${x.toFixed(1)}px`);
      b.style.setProperty('--y', `${y.toFixed(1)}px`);
      b.append(emoteGlyph(e), el('span', 'emo-key', key));
      b.addEventListener('click', () => pick(e));
      b.addEventListener('pointerenter', () => label(e));
      b.addEventListener('pointerleave', () => label(null));
      b.addEventListener('focus', () => label(e));
      b.addEventListener('blur', () => label(null));
      wheel.append(b);
      return b;
    });

    wheel.addEventListener('keydown', (e) => {
      const picked = e.ctrlKey || e.metaKey || e.altKey ? null : emoteForKey(e.key, e.code);
      if (picked && !e.repeat) {
        e.preventDefault();
        if (ui && !hasEmote(picked, ui.have)) focusOn(picked);
        else pick(picked);
      } else if (isKey(e, 'emotes') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        close();
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
        const next = at < 0 ? (step > 0 ? 0 : buttons.length - 1) : (at + step + buttons.length) % buttons.length;
        buttons[next]!.focus();
      }
      // Nothing typed in the wheel reaches the floor or a table behind it.
      if (!GLOBAL_KEYS.has(e.key)) e.stopPropagation();
    });
    // On the click, not the press: closing on the press would hand the rest of that click to
    // whatever is under it, and the HUD's emotes button would open the wheel straight back up.
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) close();
    });

    scrim.append(wheel);
    deps.root.append(scrim);
    const release = holdKeyboard(wheel, () => close());
    ui = { scrim, wheel, name, hint, buttons, have: new Set(), release, before };
    paint();
    fit();
    addEventListener('resize', fit);
    // Focus goes into the wheel at once, so the very next key (a number) is the wheel's.
    wheel.focus({ preventScroll: true });
  };

  const close = () => {
    if (!ui) return;
    const { scrim, release, before } = ui;
    ui = null;
    clearTimeout(hintTimer);
    removeEventListener('resize', fit);
    release();
    scrim.remove();
    if (before?.isConnected) before.focus({ preventScroll: true });
  };

  const onKey = (e: KeyboardEvent) => {
    if (ui || !isKey(e, 'emotes') || e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e) || overlayCount() > 0) return;
    e.preventDefault();
    open();
  };
  if (deps.key !== false) addEventListener('keydown', onKey);

  return {
    get isOpen() {
      return ui !== null;
    },
    open,
    close,
    toggle: () => (ui ? close() : open()),
    grant(emotes) {
      for (const e of emotes) granted.add(e);
      paint();
    },
    dispose() {
      removeEventListener('keydown', onKey);
      close();
    },
  };
}
