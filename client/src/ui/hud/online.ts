// v7: who is online. The HUD's "12 online" is a button: it opens this list of everyone connected
// to the floor right now, you first, then by name, each with where they are (the room, the table
// they sit at, the street, the jail, the roof). The list keeps itself current while it's open.

import { el } from '../kit.ts';
import { openSheet, type Sheet } from '../menu/sheet.ts';

export interface OnlineRow {
  id: number;
  name: string;
  /** Where they are, in a few words ("At Blackjack", "The Pit", "On the street"). */
  where: string;
  you?: boolean;
}

export interface OnlineOpts {
  root: HTMLElement;
  /** Everyone connected now (you included, marked). */
  rows: () => OnlineRow[];
  onClose?: () => void;
}

/** Open the list; it refreshes itself every second until it's closed. */
export function openOnline(o: OnlineOpts): Sheet {
  const sheet = openSheet(o.root, { title: 'Online now', cls: 'online-sheet', onClose: () => {
    clearInterval(timer);
    o.onClose?.();
  } });
  const list = el('ol', 'online-list');
  sheet.body.append(list);
  let last = '';
  const paint = () => {
    const rows = o.rows().sort((a, b) => Number(!!b.you) - Number(!!a.you) || a.name.localeCompare(b.name));
    const key = rows.map((r) => `${r.id}:${r.name}:${r.where}`).join('|');
    if (key === last) return;
    last = key;
    sheet.sub.textContent = rows.length === 1 ? 'Just you right now' : `${rows.length.toLocaleString('en-US')} players on the floor`;
    sheet.sub.hidden = false;
    list.replaceChildren(
      ...rows.map((r) => {
        const li = el('li', `online-row${r.you ? ' you' : ''}`);
        li.append(el('i', 'dot'), el('span', 'online-name', r.name), el('span', 'online-where', r.you ? `${r.where} · you` : r.where));
        return li;
      }),
    );
  };
  paint();
  const timer = setInterval(paint, 1000);
  return sheet;
}
