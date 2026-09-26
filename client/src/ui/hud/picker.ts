// v7.4: pick one of what you own: the guns V draws, the rides B steps onto. A small sheet of one
// button each, in order, with its number key (1-9); a click or the number picks, Esc closes.
// Pressing the key that opened it again closes it too.

import { el } from '../kit.ts';
import { openSheet, type Sheet } from '../menu/sheet.ts';
import { keycap } from '../menu/parts.ts';
import './picker.css';

export interface PickRow {
  id: string;
  name: string;
  /** A few words under the name (a gun's kind, a ride's top speed). */
  note?: string;
  /** The one in use now (drawn, ridden). */
  current?: boolean;
}

export interface PickOpts {
  root: HTMLElement;
  title: string;
  subtitle?: string;
  rows: PickRow[];
  /** The key that opened it (its code): pressed again, it closes. */
  key?: string;
  pick(id: string): void;
}

let open: Sheet | null = null;

export function openPicker(o: PickOpts): void {
  open?.close();
  const sheet = openSheet(o.root, { title: o.title, subtitle: o.subtitle, cls: 'pick-sheet', onClose: () => removeEventListener('keydown', onKey, true) });
  open = sheet;
  const list = el('ol', 'pick-list');
  const choose = (id: string) => {
    sheet.close();
    o.pick(id);
  };
  o.rows.forEach((r, i) => {
    const b = el('button', `pick-row${r.current ? ' current' : ''}`);
    b.type = 'button';
    const text = el('span', 'pick-text');
    text.append(el('span', 'pick-name', r.name));
    if (r.note || r.current) text.append(el('span', 'pick-note', [r.note, r.current ? 'in use' : ''].filter(Boolean).join(' · ')));
    b.append(keycap(String(i + 1)), text);
    b.addEventListener('click', () => choose(r.id));
    const li = el('li');
    li.append(b);
    list.append(li);
  });
  sheet.body.append(list);
  const onKey = (e: KeyboardEvent) => {
    if (sheet.closed) return;
    const n = /^Digit([1-9])$/.exec(e.code);
    if (n) {
      const r = o.rows[Number(n[1]) - 1];
      if (r) {
        e.preventDefault();
        e.stopPropagation();
        choose(r.id);
      }
    } else if (o.key && e.code === o.key && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      sheet.close();
    }
  };
  addEventListener('keydown', onKey, true);
  (list.querySelector('button') as HTMLButtonElement | null)?.focus();
}
