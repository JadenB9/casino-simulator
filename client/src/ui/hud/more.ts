// The HUD's More panel: every action the HUD has, grouped (Play, Shop, Social, System), each row
// with the tool's own icon, its name, what it's at now (On, Off, "$2,500 waiting", "12 on") and
// its key. A row presses the tool's own button, so whatever the tool does (and its state) stays
// its module's; a toggle's row stays open and changes in place, anything else closes the panel
// first. Above the groups, Search opens the command palette. It holds the keyboard while it's up
// (Esc closes it, arrows move, Tab stays inside) and a click anywhere else closes it without
// reaching the floor behind (a click there would throw a punch).

import { el } from '../kit.ts';
import { holdKeyboard, onOverlayChange, topPanel } from '../keyboard.ts';
import { keyLabel } from '../keys.ts';
import { icon } from '../menu/icons.ts';
import { GROUPS, buttonLabel, type HudTool } from './tools.ts';

export interface MoreDeps {
  /** Where it goes (#ui). */
  root: HTMLElement;
  /** The More button: the panel hangs under it, and focus goes back to it. */
  anchor: HTMLElement;
  /** Every tool, in order. */
  tools: () => readonly HudTool[];
  /** The key that opens the palette, as a keycap ("Ctrl K"). */
  searchKey: string;
  /** Open the palette (the More panel has closed by then). */
  onSearch(query?: string): void;
  onClose?(): void;
}

export interface MorePanel {
  readonly root: HTMLElement;
  /** Bring every row up to date (a tool changed while it's open). */
  refresh(): void;
  close(): void;
}

/** What a tool's row says it's at: its own state, else what its tip says after "Label: ", else On or Off. */
export function toolState(t: HudTool): string | null {
  if (t.state) return t.state();
  const tip = t.button.dataset.tip ?? buttonLabel(t.button);
  const prefix = `${t.label}: `;
  if (tip.toLowerCase().startsWith(prefix.toLowerCase())) {
    const rest = tip.slice(prefix.length).trim();
    return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : null;
  }
  if (t.toggle) return t.button.getAttribute('aria-pressed') === 'true' ? 'On' : 'Off';
  return null;
}

/** A tool's key as a keycap now, if it has one. */
export function toolKey(t: Pick<HudTool, 'key'>): string | null {
  if (!t.key) return null;
  return typeof t.key === 'string' ? keyLabel(t.key) : t.key.label;
}

/** Whether a tool's button says something is waiting for you (the daily bonus's dot). */
export function hasBadge(b: HTMLElement): boolean {
  return b.classList.contains('waiting') || (b.dataset.badge ?? '') !== '';
}

/** A tool's icon for its row: its button's own, else the one it names. */
export function iconOf(t: HudTool): Element {
  const svg = t.button.querySelector('svg');
  return svg ? (svg.cloneNode(true) as Element) : (t.icon?.() ?? icon('chevron'));
}

export function openMore(d: MoreDeps): MorePanel {
  const scrim = el('div', 'hud-more-scrim');
  scrim.dataset.fit = 'ignore';
  const panel = el('div', 'hud-more');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'More');
  panel.tabIndex = -1;
  const inner = el('div', 'hud-more-in');
  panel.append(inner);
  scrim.append(panel);

  const search = el('button', 'hud-more-search');
  search.type = 'button';
  search.append(icon('search'), el('span', 'hud-more-search-text', 'Search actions, settings and rooms'), el('kbd', 'kc', d.searchKey));
  search.addEventListener('click', () => {
    close(true);
    d.onSearch();
  });
  const groups = el('div', 'hud-more-groups');
  inner.append(search, groups);

  const rows = new Map<string, { row: HTMLButtonElement; tool: HudTool }>();
  const paintRow = (row: HTMLButtonElement, t: HudTool) => {
    const state = toolState(t);
    const key = toolKey(t);
    const kids: Node[] = [el('span', 'hud-more-ico'), el('span', 'hud-more-name', t.label)];
    kids[0]!.appendChild(iconOf(t));
    if (state) kids.push(el('span', `hud-more-state${hasBadge(t.button) ? ' lit' : ''}`, state));
    else if (hasBadge(t.button)) kids.push(el('span', 'hud-more-dot'));
    if (key) kids.push(el('kbd', 'kc', key));
    row.replaceChildren(...kids);
    row.disabled = t.button.disabled;
    if (t.toggle) row.setAttribute('aria-pressed', String(t.button.getAttribute('aria-pressed') === 'true'));
    row.setAttribute('aria-label', [t.label, state, key ? `(${key})` : ''].filter(Boolean).join(' '));
  };

  const build = () => {
    rows.clear();
    const tools = d.tools();
    const out: HTMLElement[] = [];
    for (const g of GROUPS) {
      const mine = tools.filter((t) => t.group === g.id);
      if (!mine.length) continue;
      const section = el('section', `hud-more-group g-${g.id}`);
      const list = el('ul', 'hud-more-list');
      for (const t of mine) {
        const row = el('button', `hud-more-row${t.keyboardOnly ? ' keyboard-only' : ''}`);
        row.type = 'button';
        row.dataset.tool = t.id;
        paintRow(row, t);
        row.addEventListener('click', () => run(t));
        rows.set(t.id, { row, tool: t });
        const li = el('li');
        li.append(row);
        list.append(li);
      }
      section.append(el('h3', 'hud-more-head', g.label), list);
      out.push(section);
    }
    groups.replaceChildren(...out);
  };

  const run = (t: HudTool) => {
    if (t.toggle) {
      t.button.click();
      refresh();
      return;
    }
    close(true);
    t.button.click();
  };

  // hang it under the More button, right edges in line, and no taller than the screen allows
  const placeIt = () => {
    const r = d.anchor.getBoundingClientRect();
    const host = d.root.getBoundingClientRect();
    const top = Math.round(r.bottom - host.top + 8);
    panel.style.top = `${top}px`;
    panel.style.right = `${Math.max(8, Math.round(host.right - r.right))}px`;
    panel.style.maxHeight = `${Math.max(160, Math.round(host.height - top - 10))}px`;
  };

  const refresh = () => {
    for (const { row, tool } of rows.values()) paintRow(row, tool);
  };

  // arrows move between the rows (and Search), Home and End to the ends
  panel.addEventListener('keydown', (e) => {
    const list = [search, ...groups.querySelectorAll<HTMLButtonElement>('.hud-more-row')].filter((b) => b.getClientRects().length > 0 && !b.disabled);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % list.length;
    else if (e.key === 'ArrowUp') next = at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (document.activeElement === search && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      // typing on Search starts the search with that letter
      e.preventDefault();
      close(true);
      d.onSearch(e.key);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    list[next]?.focus();
  });
  scrim.addEventListener('pointerdown', (e) => {
    // (the scrim covers the HUD too, so a press on More itself lands here and closes it)
    if (e.target !== scrim) return;
    e.preventDefault();
    close(false);
  });
  // keys typed in the panel stay in it
  scrim.addEventListener('keydown', (e) => e.stopPropagation());

  build();
  d.root.append(scrim);
  placeIt();
  const release = holdKeyboard(panel, () => close(true));
  queueMicrotask(() => search.focus({ preventScroll: true }));
  addEventListener('resize', placeIt);
  // something opened over it (a sheet from a global key, ? or the achievements): it's done
  const offOver = onOverlayChange(() => {
    const top = topPanel();
    if (top && top !== panel) close(false);
  });

  let closed = false;
  function close(focusBack: boolean): void {
    if (closed) return;
    closed = true;
    offOver();
    release();
    removeEventListener('resize', placeIt);
    scrim.classList.add('closing');
    window.setTimeout(() => scrim.remove(), 160);
    if (focusBack) d.anchor.focus({ preventScroll: true });
    d.onClose?.();
  }

  return { root: scrim, refresh, close: () => close(true) };
}
