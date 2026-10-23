// Notifications: the sheet of what the passing notes said (history.ts), newest first, each with how
// long ago; it keeps itself current while it's open. From the HUD's More and the palette.

import './feed.css';
import { el } from '../kit.ts';
import { openSheet, type Sheet } from '../menu/sheet.ts';
import { ago, clearHistory, history, onHistory } from './history.ts';

export function openNotes(o: { root: HTMLElement; onClose?: () => void }): Sheet {
  const sheet = openSheet(o.root, {
    title: 'Notifications',
    cls: 'notes-sheet',
    onClose: () => {
      off();
      clearInterval(timer);
      o.onClose?.();
    },
  });
  const list = el('ol', 'notes-list');
  const empty = el('p', 'notes-empty', 'Nothing yet. Toasts, big wins and notes from the floor land here as they show.');
  const clear = el('button', 'btn ghost', 'Clear');
  clear.type = 'button';
  clear.addEventListener('click', () => clearHistory());
  const foot = el('div', 'notes-foot');
  foot.append(clear);
  sheet.body.append(list, empty, foot);

  const paint = () => {
    const now = Date.now();
    const notes = history();
    sheet.sub.textContent = notes.length ? `The last ${notes.length === 1 ? 'one' : notes.length} this visit` : '';
    sheet.sub.hidden = notes.length === 0;
    empty.hidden = notes.length > 0;
    clear.disabled = notes.length === 0;
    list.replaceChildren(
      ...notes.map((n) => {
        const li = el('li', `notes-row ${n.kind}`);
        li.append(el('span', 'notes-text', n.text), el('span', 'notes-at', ago(n.at, now)));
        if (n.sub) li.append(el('span', 'notes-sub', n.sub));
        return li;
      }),
    );
  };
  paint();
  const off = onHistory(paint);
  const timer = window.setInterval(paint, 30_000);
  return sheet;
}
