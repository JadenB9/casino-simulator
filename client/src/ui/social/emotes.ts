// The emote wheel: five gestures around a hub, opened with G or a HUD button. Pick one by its
// number, with the arrow keys and Enter, or with a click; it goes out on the floor socket and the
// wheel closes. While it's open it holds the keyboard like any panel, so a number picks a gesture
// rather than a chip and W doesn't walk. Esc, G again or a click outside put it away.
//
// The floor lets three gestures through in a burst, then one every two seconds
// (server/src/floor/index.ts). The wheel keeps the same count, a little slower, so it never
// sends one the server would drop, and says so instead.

import './social.css';
import { EMOTES, type EmoteId } from '../../../../shared/src/protocol.ts';
import { el } from '../kit.ts';
import { GLOBAL_KEYS, holdKeyboard, isTyping, overlayCount } from '../keyboard.ts';
import { EMOTE_LABELS, emoteGlyph } from './icons.ts';

export interface EmoteDeps {
  root: HTMLElement;
  /** Send the gesture: `(e) => link.emote(e)`. */
  send(e: EmoteId): void;
  /** Listen for G to open and close the wheel (default true). */
  key?: boolean;
}

export interface EmoteWheel {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Close it and stop listening for G (leaving the floor). */
  dispose(): void;
}

const BURST = 3;
/** The server refills at 0.5 a second; a tenth slower here absorbs network jitter. */
const REFILL_PER_S = 0.45;
/** Distance from the hub to each button's centre, px. */
const RADIUS = 84;
const HINT = '1-5 · Esc';

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

  let ui: { scrim: HTMLElement; wheel: HTMLElement; name: HTMLElement; hint: HTMLElement; buttons: HTMLButtonElement[]; release: () => void; before: HTMLElement | null } | null = null;
  let hintTimer = 0;

  const label = (e: EmoteId | null) => {
    if (!ui) return;
    ui.name.textContent = e ? EMOTE_LABELS[e] : 'Emotes';
  };

  const pick = (e: EmoteId) => {
    if (!ui) return;
    if (!take()) {
      // Too soon: say so and stay open, so the next try is one keypress away.
      ui.wheel.classList.add('cooling');
      ui.hint.textContent = 'One moment';
      clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => {
        ui?.wheel.classList.remove('cooling');
        if (ui) ui.hint.textContent = HINT;
      }, 1_200);
      return;
    }
    deps.send(e);
    close();
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
    wheel.append(el('div', 'emo-ring'), hub);

    const buttons = EMOTES.map((e, i) => {
      const b = el('button', 'emo-btn');
      b.type = 'button';
      b.dataset.emote = e;
      b.setAttribute('aria-label', `${EMOTE_LABELS[e]} (${i + 1})`);
      // Clockwise from the top.
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / EMOTES.length;
      b.style.setProperty('--x', `${(Math.cos(a) * RADIUS).toFixed(1)}px`);
      b.style.setProperty('--y', `${(Math.sin(a) * RADIUS).toFixed(1)}px`);
      b.append(emoteGlyph(e), el('span', 'emo-key', String(i + 1)));
      b.addEventListener('click', () => pick(e));
      b.addEventListener('pointerenter', () => label(e));
      b.addEventListener('pointerleave', () => label(null));
      b.addEventListener('focus', () => label(e));
      b.addEventListener('blur', () => label(null));
      wheel.append(b);
      return b;
    });

    wheel.addEventListener('keydown', (e) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= EMOTES.length && !e.repeat) {
        e.preventDefault();
        pick(EMOTES[n - 1]!);
      } else if (e.code === 'KeyG' && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
    scrim.addEventListener('pointerdown', (e) => {
      if (e.target === scrim) close();
    });

    scrim.append(wheel);
    deps.root.append(scrim);
    const release = holdKeyboard(wheel, () => close());
    ui = { scrim, wheel, name, hint, buttons, release, before };
    // Focus goes into the wheel at once, so the very next key (a number) is the wheel's.
    wheel.focus({ preventScroll: true });
  };

  const close = () => {
    if (!ui) return;
    const { scrim, release, before } = ui;
    ui = null;
    clearTimeout(hintTimer);
    release();
    scrim.remove();
    if (before?.isConnected) before.focus({ preventScroll: true });
  };

  const onKey = (e: KeyboardEvent) => {
    if (ui || e.code !== 'KeyG' || e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
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
    dispose() {
      removeEventListener('keydown', onKey);
      close();
    },
  };
}
