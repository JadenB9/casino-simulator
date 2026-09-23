// The floor HUD. Top left: who you are and your money (balance, chips at this table, and the
// session's net and time, which responsible-gaming rules ask a casino to show). Top right: who
// else is here, mute, settings and the shortcut list. Everything stays in fixed places; the
// top centre belongs to the dealer's line and the bottom-left corner to the site's back chip.

import './hud.css';
import { LOAN_AMOUNT, formatMoney, type Cents } from '../../../../shared/src/money.ts';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { el } from '../kit.ts';
import type { Closable, SessionLike, SfxLike } from '../menu/deps.ts';
import { icon } from '../menu/icons.ts';
import { formatDuration } from '../menu/parts.ts';
import { openSettings } from './settings.ts';
import { openShortcuts } from './shortcuts.ts';

export interface HudDeps {
  root: HTMLElement;
  session: SessionLike;
  sfx: SfxLike;
  /** Opens settings; defaults to the settings sheet. */
  onSettings?(): void;
  /** When given, the name becomes a button that opens the profile. */
  onProfile?(): void;
  /** When given, a menu button appears (back to the main menu). */
  onMenu?(): void;
}

export interface Hud extends Closable {
  /** The stack at the table you're seated at, and what you bought in with; null when you stand up. */
  setTableChips(stack: Cents | null, escrow?: Cents): void;
  /** Accounts connected to the floor; null hides the count. */
  setOnline(n: number | null): void;
  /** Open (or close) the keyboard list, as "?" does. */
  toggleShortcuts(): void;
}

function stat(label: string, cls = ''): { tile: HTMLElement; value: HTMLElement } {
  const tile = el('div', `hud-stat ${cls}`.trim());
  const value = el('div', 'stat-value money');
  tile.append(el('div', 'stat-label', label), value);
  return { tile, value };
}

function iconButton(name: Parameters<typeof icon>[0], label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'hud-btn');
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Rolls a money readout to its new value instead of jumping. */
function roller(target: HTMLElement): (to: Cents) => void {
  let shown: Cents | null = null;
  let raf = 0;
  return (to) => {
    cancelAnimationFrame(raf);
    const from = shown;
    if (from === null || from === to || reduceMotion()) {
      shown = to;
      target.textContent = formatMoney(to);
      return;
    }
    target.classList.remove('tick');
    void target.offsetWidth;
    target.classList.add('tick');
    const start = performance.now();
    const ms = Math.min(900, 350 + Math.log10(Math.abs(to - from) + 1) * 90);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      shown = t === 1 ? to : Math.round(from + (to - from) * e);
      target.textContent = formatMoney(shown);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
}

export function mountHud(deps: HudDeps): Hud {
  const root = el('div', 'hud pass');
  root.setAttribute('aria-label', 'Status');

  // left: you and your money
  const left = el('div', 'hud-bar hud-left');
  const who = deps.onProfile ? el('button', 'hud-who') : el('div', 'hud-who');
  if (who instanceof HTMLButtonElement) {
    who.type = 'button';
    who.title = 'Profile';
    who.addEventListener('click', () => deps.onProfile?.());
  }
  const balance = stat('Balance', 'hud-balance');
  const table = stat('At table', 'hud-table');
  table.tile.hidden = true;
  const sessionTile = stat('Session', 'hud-session');
  left.append(who, balance.tile, table.tile, sessionTile.tile);

  // right: the room and the controls
  const right = el('div', 'hud-right');
  const online = el('div', 'hud-bar hud-online');
  const onlineN = el('span', 'money', '');
  online.append(el('i', 'dot'), onlineN, el('span', 'hud-online-label', 'online'));
  online.hidden = true;
  const mute = iconButton(deps.sfx.muted ? 'muted' : 'sound', 'Mute (M)', () => toggleMute());
  const settings = iconButton('gear', 'Settings', () => (deps.onSettings ? deps.onSettings() : openSettings({ root: deps.root, sfx: deps.sfx, onClose: paintMute })));
  const help = iconButton('help', 'Keyboard shortcuts (?)', () => toggleShortcuts());
  right.append(online, mute, settings, help);
  if (deps.onMenu) right.append(iconButton('menu', 'Menu', () => deps.onMenu?.()));
  root.append(left, right);
  deps.root.append(root);

  const rollBalance = roller(balance.value);
  const rollTable = roller(table.value);

  // Session net = what you're worth now - what you had when the HUD came up - loans since.
  // Chips at the current table count at their live stack, other tables at what went in.
  const startedAt = Date.now();
  const p0 = deps.session.profile;
  const startWorth = p0 ? p0.balance + p0.inPlay : 0;
  const startLoans = p0?.loansTaken ?? 0;
  let seat: { stack: Cents; escrow: Cents } | null = null;
  let netTimer = 0;

  const paintSession = () => {
    const p = deps.session.profile;
    if (!p) return;
    const worth = p.balance + p.inPlay + (seat ? seat.stack - seat.escrow : 0);
    const net = worth - startWorth - (p.loansTaken - startLoans) * LOAN_AMOUNT;
    sessionTile.value.replaceChildren(
      el('span', net > 0 ? 'win' : net < 0 ? 'lose' : '', formatMoney(net, { sign: true })),
      el('span', 'hud-time', ` · ${formatDuration(Date.now() - startedAt)}`),
    );
  };
  // Balance, seat and stack messages don't arrive in one piece; wait for them to settle.
  const scheduleSession = () => {
    clearTimeout(netTimer);
    netTimer = window.setTimeout(paintSession, 400);
  };
  const clock = window.setInterval(paintSession, 30_000);

  const paint = (p: Profile) => {
    who.textContent = p.name;
    rollBalance(p.balance);
    scheduleSession();
  };

  const paintMute = () => {
    mute.replaceChildren(icon(deps.sfx.muted ? 'muted' : 'sound'));
    mute.setAttribute('aria-pressed', String(deps.sfx.muted));
    mute.title = deps.sfx.muted ? 'Unmute (M)' : 'Mute (M)';
  };
  const toggleMute = () => {
    deps.sfx.setMuted(!deps.sfx.muted);
    if (!deps.sfx.muted) deps.sfx.play('ui-click', { volume: 0.5 });
    paintMute();
  };

  let shortcuts: Closable | null = null;
  const toggleShortcuts = () => {
    if (shortcuts) {
      shortcuts.close();
      return;
    }
    shortcuts = openShortcuts({ root: deps.root, onClose: () => (shortcuts = null) });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable)) return;
    if (e.key === '?') {
      e.preventDefault();
      toggleShortcuts();
    } else if (e.code === 'KeyM' && !e.shiftKey) {
      e.preventDefault();
      toggleMute();
    }
  };
  addEventListener('keydown', onKey);

  const off = deps.session.on(paint);
  if (deps.session.profile) paint(deps.session.profile);
  paintMute();
  paintSession();

  return {
    root,
    setTableChips(stack, escrow) {
      if (stack === null) {
        seat = null;
        table.tile.hidden = true;
      } else {
        seat = { stack, escrow: escrow ?? seat?.escrow ?? stack };
        table.tile.hidden = false;
        rollTable(stack);
      }
      scheduleSession();
    },
    setOnline(n) {
      online.hidden = n === null;
      onlineN.textContent = n === null ? '' : n.toLocaleString('en-US');
    },
    toggleShortcuts,
    close() {
      off();
      removeEventListener('keydown', onKey);
      clearInterval(clock);
      clearTimeout(netTimer);
      shortcuts?.close();
      root.remove();
    },
  };
}
