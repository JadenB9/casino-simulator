// Being away (app/idle.ts): the "Still there?" line a minute before the casino lets an idle
// player go, and the screen they come back to. The line takes nothing over: any input clears it.
// The screen holds the keyboard and waits for Come back, which reconnects where they were.

import { IDLE_MS, IDLE_WARN_MS } from '../../../../shared/src/protocol.ts';
import { holdKeyboard } from '../keyboard.ts';
import { button, el } from '../kit.ts';
import './away.css';

const touch = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** "15 minutes", from the one constant. */
export function awayFor(ms = IDLE_MS): string {
  const min = Math.round(ms / 60_000);
  return `${min} minute${min === 1 ? '' : 's'}`;
}

export interface WarningHandle {
  close(): void;
}

/** The "Still there?" line, counting down to `at` (Date.now() clock). */
export function showIdleWarning(opts: { root: HTMLElement; at: number; atTable: boolean }): WarningHandle {
  const box = el('div', 'idle-warn panel');
  box.setAttribute('role', 'status');
  const secs = el('b', 'idle-secs');
  const line = el('p', 'idle-line');
  const stay = touch() ? 'Tap anywhere to stay.' : 'Move the mouse or press a key to stay.';
  if (opts.atTable) line.append('In ', secs, ' you leave the table and your chips go back to your balance. ', stay);
  else line.append('In ', secs, ' you leave the floor. ', stay);
  const bar = el('div', 'idle-bar');
  const fill = el('div', 'idle-fill');
  bar.append(fill);
  box.append(el('strong', 'idle-title', 'Still there?'), line, bar);
  opts.root.append(box);
  const tick = () => {
    const left = Math.max(0, opts.at - Date.now());
    secs.textContent = `${Math.ceil(left / 1000)} s`;
    // The bar drains with the time left (CSSOM, which the page's CSP allows).
    fill.style.transform = `scaleX(${Math.min(1, left / IDLE_WARN_MS)})`;
  };
  tick();
  const timer = setInterval(tick, 250);
  return {
    close() {
      clearInterval(timer);
      box.remove();
    },
  };
}

export interface AwayHandle {
  close(): void;
}

/** The screen an idle player comes back to. `onBack` runs inside the click (a user gesture). */
export function showAway(opts: { root: HTMLElement; atTable: boolean; onBack: () => void }): AwayHandle {
  const screen = el('div', 'away');
  const card = el('div', 'away-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const title = el('h2', 'away-title', `You were away for ${awayFor()}.`);
  title.id = 'away-title';
  card.setAttribute('aria-labelledby', title.id);
  card.append(title);
  if (opts.atTable) card.append(el('p', 'away-line', 'You left the table. Anything still in play settles as usual, and your chips go back to your balance.'));
  let done = false;
  const back = button('Come back', () => {
    if (done) return;
    done = true;
    close();
    opts.onBack();
  }, { cls: 'primary away-back' });
  card.append(back);
  screen.append(card);
  opts.root.append(screen);
  // Esc does nothing here: the only way on is Come back.
  const release = holdKeyboard(card, () => {});
  back.focus({ preventScroll: true });
  function close(): void {
    release();
    screen.remove();
  }
  return {
    close() {
      done = true;
      close();
    },
  };
}
