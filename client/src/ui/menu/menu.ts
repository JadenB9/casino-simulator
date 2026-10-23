// The main menu: who you are and your money under the title, then a column of choices driven by
// the arrow keys (or W/S) and Enter like a game's front end, with the mouse moving the same
// selection. Enter Casino is the one gold choice; each of the others carries one live fact on the
// right (your outfit, your rounds, the graphics), in place of a description.

import './menu.css';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { formatMoney } from '../../../../shared/src/money.ts';
import { savedQuality } from '../../render/engine3d.ts';
import { el } from '../kit.ts';
import type { Closable, SessionLike, SfxLike } from './deps.ts';
import { frontShell, monogram } from './front.ts';
import { glyph, type GlyphName } from './glyphs.ts';
import { keycap } from './parts.ts';
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

const ICONS: Record<Exclude<ItemId, 'enter'>, GlyphName> = { character: 'person', profile: 'chart', settings: 'gear', logout: 'door' };

export function mountMenu(deps: MenuDeps): MenuHandle {
  const shell = frontShell(deps.root, 'front-menu', deps.backdrop);

  // you: your initial, your name, and what you have (chips on tables only when there are some)
  const who = el('div', 'menu-who front-rise');
  const mono = el('span', 'menu-mono');
  const whoText = el('div', 'menu-who-text');
  const whoName = el('div', 'menu-who-name');
  const money = el('div', 'menu-who-money');
  const balance = el('span', 'menu-who-figure money');
  const onTables = el('span', 'menu-who-figure money');
  const balanceTile = el('span', 'menu-who-tile');
  balanceTile.append(el('span', 'menu-who-label', 'Balance'), balance);
  const tablesTile = el('span', 'menu-who-tile');
  tablesTile.append(el('span', 'menu-who-label', 'On tables'), onTables);
  money.append(balanceTile, tablesTile);
  whoText.append(whoName, money);
  who.append(mono, whoText);

  const nav = el('nav', 'menu-list front-main front-rise');
  nav.setAttribute('aria-label', 'Main menu');
  const facts = new Map<ItemId, HTMLElement>();
  const items: { id: ItemId; btn: HTMLButtonElement; run: () => void }[] = [];
  const add = (id: ItemId, label: string, run: () => void) => {
    const btn = el('button', id === 'enter' ? 'menu-item primary' : 'menu-item');
    btn.type = 'button';
    btn.dataset.id = id;
    const fact = el('span', 'menu-fact');
    facts.set(id, fact);
    if (id === 'enter') btn.append(el('span', 'menu-label', label), fact, glyph('arrow'));
    else btn.append(glyph(ICONS[id]), el('span', 'menu-label', label), fact);
    nav.append(btn);
    items.push({ id, btn, run });
  };
  add('enter', 'Enter Casino', deps.onEnter);
  add('character', 'Character', deps.onCharacter);
  add('profile', 'Profile', deps.onProfile);
  add('settings', 'Settings', deps.onSettings);
  add('logout', 'Log out', deps.onLogout);

  const hints = el('div', 'menu-hints front-rise');
  hints.setAttribute('aria-hidden', 'true');
  hints.append(keycap('↑'), keycap('↓'), el('span', '', 'Select'), keycap('Enter'), el('span', '', 'Open'));

  shell.col.append(who, nav, hints);

  let sel = 0;
  let online: number | null = null;
  // what each piece last said, so a profile tick that changes nothing writes nothing
  const said = new Map<HTMLElement, string>();
  const say = (e: HTMLElement, text: string) => {
    if (said.get(e) === text) return;
    said.set(e, text);
    e.textContent = text;
  };

  const paintFacts = (p: Profile | null) => {
    const name = p?.name ?? '';
    if (said.get(mono) !== name) {
      said.set(mono, name);
      mono.replaceChildren(monogram(name));
    }
    say(whoName, name);
    say(balance, formatMoney(p?.balance ?? 0));
    say(onTables, formatMoney(p?.inPlay ?? 0));
    tablesTile.hidden = !p || p.inPlay === 0;
    say(facts.get('enter')!, online === null ? '' : `${online.toLocaleString('en-US')} online`);
    say(facts.get('character')!, p ? outfitName(p.look.outfit) : '');
    const rounds = p?.stats.total.rounds ?? 0;
    say(facts.get('profile')!, `${rounds.toLocaleString('en-US')} ${rounds === 1 ? 'round' : 'rounds'}`);
    say(facts.get('settings')!, savedQuality() === 'high' ? 'High graphics' : 'Low graphics');
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
    it.btn.addEventListener('pointerenter', (e) => {
      // a finger's tap goes straight to its click: no hover sound or focus move first
      if (e.pointerType === 'mouse') select(i, true);
    });
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
