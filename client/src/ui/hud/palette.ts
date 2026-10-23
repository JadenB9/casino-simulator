// The command palette (Ctrl K, or Cmd K on a Mac, and Search in the HUD's More): type a few
// letters of anything the HUD can do, a setting, a room or a game, and Enter does it. Every HUD
// action is here with the key it has now, so it teaches the keys as it goes; a setting opens
// Settings at its section; a room or a game opens the Floor Directory with that room lit. With
// nothing typed it lists what was run last and then every action. It holds the keyboard while
// it's up: typing goes into its field (no game key fires), the arrows move, Esc closes.

import { el } from '../kit.ts';
import { holdKeyboard } from '../keyboard.ts';
import { icon } from '../menu/icons.ts';
import { bestScore } from './fuzzy.ts';

export interface Command {
  /** Stable, for remembering what was run last ("tool:map", "room:pit"). */
  id: string;
  label: string;
  /** A few words on the right: what's in a room, which section a setting is in. */
  hint?: string;
  /** What kind of thing it is: "Action", "Setting", "Room", "Game". */
  group: string;
  icon?: () => Element;
  /** Its keycap now, if it has one. */
  key?: string | null;
  /** More words it's found by. */
  keywords?: string;
  run(): void;
}

export interface PaletteOpts {
  root: HTMLElement;
  /** Everything it can run, asked for each time it opens. */
  commands: () => Command[];
  /** Typed already (the first letter typed on More's Search). */
  query?: string;
  onClose?(): void;
}

export interface Palette {
  readonly root: HTMLElement;
  close(): void;
}

const RECENT_KEY = 'casino.palette.recent';
const RECENT_MAX = 4;
const SHOW_MAX = 12;

function recent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recent().filter((x) => x !== id)].slice(0, RECENT_MAX)));
  } catch {
    /* kept for this visit only: not at all */
  }
}

/** What to show for a query: with nothing typed, the recent ones and then the actions; else the best matches. */
export function rank(all: readonly Command[], query: string, recentIds: readonly string[] = []): { head: string | null; cmd: Command }[] {
  const q = query.trim();
  if (!q) {
    const byId = new Map(all.map((c) => [c.id, c]));
    const last = recentIds.map((id) => byId.get(id)).filter((c): c is Command => !!c);
    const rest = all.filter((c) => c.group === 'Action' && !last.includes(c));
    return [...last.map((cmd, i) => ({ head: i === 0 ? 'Recent' : null, cmd })), ...rest.map((cmd, i) => ({ head: i === 0 ? 'Actions' : null, cmd }))];
  }
  const scored: { cmd: Command; score: number }[] = [];
  for (const cmd of all) {
    const s = bestScore(q, cmd.label, [cmd.keywords, cmd.hint, cmd.group].filter(Boolean).join(' '));
    if (s !== null) scored.push({ cmd, score: s + (cmd.group === 'Action' ? 4 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.cmd.label.localeCompare(b.cmd.label));
  // a name that holds what was typed as it stands: only those, and close matches beside them
  const letters = q.replace(/\s+/g, '').length;
  const strong = scored.length > 0 && scored[0]!.score >= 150;
  const kept = strong ? scored.filter((s) => s.score >= 100 || s.score >= letters * 6) : scored;
  return kept.slice(0, SHOW_MAX).map(({ cmd }) => ({ head: null, cmd }));
}

let seq = 0;

export function openPalette(o: PaletteOpts): Palette {
  const id = `palette-${++seq}`;
  const scrim = el('div', 'palette-scrim');
  scrim.dataset.fit = 'ignore';
  const panel = el('div', 'palette');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Search');
  const inner = el('div', 'palette-in');
  const field = el('label', 'palette-field');
  const input = el('input', 'palette-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Search actions, settings, rooms and games';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', `${id}-list`);
  input.setAttribute('aria-label', 'Search actions, settings, rooms and games');
  field.append(icon('search'), input, el('kbd', 'kc palette-esc', 'Esc'));
  const list = el('ul', 'palette-list');
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  const empty = el('p', 'palette-empty', 'Nothing by that name. Try a game, a room, a setting or an action.');
  empty.hidden = true;
  const foot = el('div', 'palette-foot');
  foot.append(el('kbd', 'kc', '↑'), el('kbd', 'kc', '↓'), el('span', '', 'to move'), el('kbd', 'kc', 'Enter'), el('span', '', 'to choose'), el('kbd', 'kc', 'Esc'), el('span', '', 'to close'));
  inner.append(field, list, empty, foot);
  panel.append(inner);
  scrim.append(panel);

  const all = o.commands();
  const recentIds = recent();
  let shown: Command[] = [];
  let sel = 0;
  const items: HTMLElement[] = [];

  const select = (i: number, scroll = true) => {
    if (!shown.length) return;
    sel = (i + shown.length) % shown.length;
    items.forEach((it, j) => it.setAttribute('aria-selected', String(j === sel)));
    const it = items[sel];
    if (it) {
      input.setAttribute('aria-activedescendant', it.id);
      if (scroll) it.scrollIntoView({ block: 'nearest' });
    }
  };

  const render = () => {
    const ranked = rank(all, input.value, recentIds);
    // under a heading (nothing typed) the kind of each row goes without saying
    const q = !input.value.trim();
    shown = ranked.map((r) => r.cmd);
    items.length = 0;
    const kids: HTMLElement[] = [];
    ranked.forEach(({ head, cmd }, i) => {
      if (head) {
        const h = el('li', 'palette-head', head);
        h.setAttribute('role', 'presentation');
        kids.push(h);
      }
      const li = el('li', 'palette-item');
      li.id = `${id}-${i}`;
      li.setAttribute('role', 'option');
      const ico = el('span', 'palette-ico');
      ico.append(cmd.icon?.() ?? icon('chevron'));
      const text = el('span', 'palette-text');
      text.append(el('span', 'palette-label', cmd.label));
      if (cmd.hint) text.append(el('span', 'palette-hint', cmd.hint));
      li.append(ico, text);
      if (!q) li.append(el('span', 'palette-group', cmd.group));
      if (cmd.key) li.append(el('kbd', 'kc', cmd.key));
      li.addEventListener('pointermove', () => sel !== i && select(i, false));
      li.addEventListener('click', () => choose(i));
      items.push(li);
      kids.push(li);
    });
    list.replaceChildren(...kids);
    empty.hidden = shown.length > 0;
    list.hidden = shown.length === 0;
    if (!shown.length) input.removeAttribute('aria-activedescendant');
    select(0);
  };

  const choose = (i: number) => {
    const cmd = shown[i];
    if (!cmd) return;
    remember(cmd.id);
    close();
    cmd.run();
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') select(sel + 1);
    else if (e.key === 'ArrowUp') select(sel - 1);
    else if (e.key === 'PageDown') select(Math.min(shown.length - 1, sel + 5));
    else if (e.key === 'PageUp') select(Math.max(0, sel - 5));
    else if (e.key === 'Enter') choose(sel);
    else return;
    e.preventDefault();
  });
  scrim.addEventListener('pointerdown', (e) => {
    if (e.target === scrim) {
      e.preventDefault();
      close();
    }
  });
  scrim.addEventListener('keydown', (e) => e.stopPropagation());

  input.value = o.query ?? '';
  render();
  o.root.append(scrim);
  const release = holdKeyboard(panel, () => close());
  input.focus({ preventScroll: true });
  // the caret after what was typed already
  input.setSelectionRange(input.value.length, input.value.length);

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    release();
    scrim.classList.add('closing');
    window.setTimeout(() => scrim.remove(), 160);
    o.onClose?.();
  }
  return { root: scrim, close };
}
