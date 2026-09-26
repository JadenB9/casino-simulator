// v7.4: the Keys block of the Settings sheet: every rebindable control (ui/keys.ts) with its key.
// A click on a key waits for the next key pressed (Esc: never mind); taking a key another control
// had swaps the two, and the note under the list says so. Reset puts every key back.

import { el } from '../kit.ts';
import { KEY_SPECS, bindKey, customised, keyLabel, keyName, onKeysChange, resetKeys, reservedKey, type KeyAction } from '../keys.ts';
import './keybinds.css';

/** The block's nodes, and what to call when the sheet closes. */
export function keySettings(): { nodes: HTMLElement[]; dispose(): void } {
  const list = el('div', 'keys-list');
  const note = el('p', 'set-note keys-note', 'Click a key, then press the one you want. The arrow keys always walk and steer too.');
  const reset = el('button', 'btn keys-reset', 'Reset to defaults');
  reset.type = 'button';
  const buttons = new Map<KeyAction, HTMLButtonElement>();
  let waiting: { action: KeyAction; stop: () => void } | null = null;

  const paint = () => {
    for (const [action, b] of buttons) {
      if (waiting?.action === action) continue;
      b.textContent = keyLabel(action);
      b.classList.remove('waiting');
    }
    reset.disabled = !customised();
  };

  const listen = (action: KeyAction, b: HTMLButtonElement) => {
    waiting?.stop();
    b.textContent = 'Press a key';
    b.classList.add('waiting');
    // (the capture phase on the window, ahead of the sheet's own Esc and every game key)
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') return stop();
      if (/^(Meta|Control|Alt)/.test(e.code)) return;
      if (reservedKey(e.code)) {
        note.textContent = `${keyName(e.code)} stays the game's own (menus, emotes, the help). Pick another key.`;
        return;
      }
      const spec = KEY_SPECS.find((s) => s.action === action)!;
      const swapped = bindKey(action, e.code);
      const other = swapped ? KEY_SPECS.find((s) => s.action === swapped)! : null;
      note.textContent = other ? `${spec.name}: ${keyLabel(action)}. ${other.name} moved to ${keyLabel(other.action)}.` : `${spec.name}: ${keyLabel(action)}.`;
      stop();
    };
    const stop = () => {
      removeEventListener('keydown', onKey, true);
      waiting = null;
      paint();
    };
    addEventListener('keydown', onKey, true);
    waiting = { action, stop };
  };

  for (const s of KEY_SPECS) {
    const r = el('div', 'keys-row');
    const b = el('button', 'keys-key');
    b.type = 'button';
    b.setAttribute('aria-label', `${s.name}: change key`);
    b.addEventListener('click', () => (waiting?.action === s.action ? waiting.stop() : listen(s.action, b)));
    buttons.set(s.action, b);
    r.append(el('span', 'keys-name', s.name), b);
    list.append(r);
  }
  reset.addEventListener('click', () => {
    waiting?.stop();
    resetKeys();
    note.textContent = 'Every key is back where it started.';
  });
  const off = onKeysChange(paint);
  paint();
  return {
    nodes: [el('h3', 'section-label', 'Keys'), list, note, reset],
    dispose() {
      waiting?.stop();
      off();
    },
  };
}
