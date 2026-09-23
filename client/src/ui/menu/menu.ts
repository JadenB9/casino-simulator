// The main menu: a column of choices under the title, driven by the arrow keys (or W/S) and
// Enter like a game's front end, with the mouse moving the same selection. Each row carries one
// live fact on the right (who is online, your outfit, your rounds), in place of a description.

import './menu.css';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { savedQuality } from '../../render/engine3d.ts';
import { el } from '../kit.ts';
import type { Closable, SessionLike, SfxLike } from './deps.ts';
import { frontShell } from './front.ts';
import { keycap, statTile } from './parts.ts';
import { overlayCount } from './sheet.ts';
import { outfitName } from '../editor/palettes.ts';

export interface MenuDeps {
  root: HTMLElement;
  session: Pick<SessionLike, 'profile' | 'on'>;
  onEnter(): void;
  onCharacter(): void;
  onProfile(): void;
  onSettings(): void;
  onLogout(): void;
  /** Starts the 3D pass behind the menu and returns its stop; without it the menu paints its own. */
  backdrop?: () => (() => void) | void;
  sfx?: Pick<SfxLike, 'play'>;
}

export interface MenuHandle extends Closable {
  /** People on the floor, shown beside Enter Casino; null hides it. */
  setOnline(n: number | null): void;
  /** Put the keyboard back on the menu (after something that took it closes). */
  focus(): void;
}

type ItemId = 'enter' | 'character' | 'profile' | 'settings' | 'logout';

export function mountMenu(deps: MenuDeps): MenuHandle {
  const shell = frontShell(deps.root, 'front-menu', deps.backdrop);

  const who = el('div', 'menu-who front-rise');
  const player = statTile('Player', '');
  const balance = statTile('Balance', '');
  const onTables = statTile('On tables', '');
  who.append(player.tile, balance.tile, onTables.tile);

  const nav = el('nav', 'menu-list front-rise');
  nav.setAttribute('aria-label', 'Main menu');
  const facts = new Map<ItemId, HTMLElement>();
  const items: { id: ItemId; btn: HTMLButtonElement; run: () => void }[] = [];
  const add = (id: ItemId, label: string, run: () => void) => {
    const btn = el('button', 'menu-item');
    btn.type = 'button';
    btn.dataset.id = id;
    const fact = el('span', 'menu-fact');
    facts.set(id, fact);
    btn.append(el('span', 'menu-mark'), el('span', 'menu-label', label), fact);
    nav.append(btn);
    items.push({ id, btn, run });
  };
  add('enter', 'Enter Casino', deps.onEnter);
  add('character', 'Character', deps.onCharacter);
  add('profile', 'Profile', deps.onProfile);
  add('settings', 'Settings', deps.onSettings);
  add('logout', 'Log out', deps.onLogout);

  const hints = el('div', 'menu-hints front-rise');
  hints.append(keycap('↑'), keycap('↓'), el('span', '', 'Select'), keycap('Enter'), el('span', '', 'Open'));

  shell.col.append(who, nav);
  shell.root.append(hints);

  let sel = 0;
  let online: number | null = null;

  const paintFacts = (p: Profile | null) => {
    player.value.textContent = p?.name ?? '';
    balance.value.textContent = formatMoney(p?.balance ?? 0);
    onTables.value.textContent = formatMoney(p?.inPlay ?? 0);
    onTables.tile.hidden = !p || p.inPlay === 0;
    facts.get('enter')!.textContent = online === null ? '' : `${online} online`;
    facts.get('character')!.textContent = p ? outfitName(p.look.outfit) : '';
    const rounds = p?.stats.total.rounds ?? 0;
    facts.get('profile')!.textContent = `${rounds.toLocaleString('en-US')} ${rounds === 1 ? 'round' : 'rounds'}`;
    facts.get('settings')!.textContent = savedQuality() === 'high' ? 'High graphics' : 'Low graphics';
    facts.get('logout')!.textContent = p?.name ?? '';
  };

  const select = (i: number, focus = true, sound = true) => {
    const next = (i + items.length) % items.length;
    if (next !== sel && sound) deps.sfx?.play('ui-switch', { volume: 0.25 });
    sel = next;
    items.forEach((it, j) => {
      it.btn.classList.toggle('sel', j === sel);
      it.btn.tabIndex = j === sel ? 0 : -1;
    });
    if (focus) items[sel]!.btn.focus({ preventScroll: true });
  };

  const activate = (i: number) => {
    deps.sfx?.play('ui-click', { volume: 0.4 });
    items[i]!.run();
  };

  items.forEach((it, i) => {
    it.btn.addEventListener('click', () => {
      select(i, false, false);
      activate(i);
    });
    it.btn.addEventListener('pointerenter', () => select(i, true));
    it.btn.addEventListener('focus', () => select(i, false, false));
  });

  const onKey = (e: KeyboardEvent) => {
    if (overlayCount() > 0 || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    switch (e.code) {
      case 'ArrowDown':
      case 'KeyS':
        select(sel + 1);
        break;
      case 'ArrowUp':
      case 'KeyW':
        select(sel - 1);
        break;
      case 'Home':
        select(0);
        break;
      case 'End':
        select(items.length - 1);
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        // A focused button already turns Enter/Space into a click.
        if (e.target instanceof HTMLButtonElement && nav.contains(e.target)) return;
        activate(sel);
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  const off = deps.session.on(paintFacts);
  paintFacts(deps.session.profile);
  select(0, false, false);
  queueMicrotask(() => items[sel]!.btn.focus({ preventScroll: true }));

  return {
    root: shell.root,
    close() {
      document.removeEventListener('keydown', onKey);
      off();
      shell.close();
    },
    setOnline(n) {
      online = n;
      paintFacts(deps.session.profile);
    },
    focus() {
      select(sel, true, false);
    },
  };
}
