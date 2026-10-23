// The floor HUD. Top left: who you are and your money (balance, chips at this table, and the
// session's net and time, which responsible-gaming rules ask a casino to show). Top right: who
// else is here, the few tools most used (the map, emotes, tips, sound, settings) and More, which
// lists every action the HUD has, grouped, with its key; Ctrl K (Cmd K) searches them all, and
// the settings, rooms and games too (palette.ts). Every tool goes through addTool (tools.ts)
// whoever builds its button; one put straight into `.hud-right` the old way is adopted. One
// tooltip shows each tool's name and key on hover and keyboard focus (tooltip.ts).
//
// Everything stays in fixed places; the top centre belongs to the dealer's line and the
// bottom-left corner to the site's back chip. The HUD keeps --below-hud at its real bottom, so
// every panel placed under it is right however the HUD wraps.

import './hud.css';
import { tips } from '../../app/tips.ts';
import { isTyping, overlayCount, topPanel } from '../keyboard.ts';
import { formatMoney, type Cents } from '../../../../shared/src/money.ts';
import type { Profile } from '../../../../shared/src/protocol.ts';
import { el, toast } from '../kit.ts';
import type { Closable, SessionLike, SfxLike } from '../menu/deps.ts';
import { icon, type IconName } from '../menu/icons.ts';
import { formatDuration } from '../menu/parts.ts';
import { openSettings, SETTINGS_SECTIONS, type SettingsSection } from './settings.ts';
import { openShortcuts } from './shortcuts.ts';
import { netStart, sessionNet } from './net.ts';
import { calm } from '../../app/comfort.ts';
import { isKey, keyed, keyLabel, modified } from '../keys.ts';
import { mountReminder } from './reminder.ts'; // v6.1 casino61: the play reminder
import { themeButton } from './theme-button.ts';
import { theme } from '../../app/theme.ts';
import { adopt, byPlace, splitKey, type HudTool } from './tools.ts';
import { hasBadge, iconOf, openMore, toolKey, toolState, type MorePanel } from './more.ts';
import { openPalette, type Command, type Palette } from './palette.ts';
import { hideTooltip, installTooltips } from './tooltip.ts';
import { mountFps } from './display.ts';
import { openNotes } from '../feed/notes.ts';

export type { HudTool, ToolGroup } from './tools.ts';
export type { Command } from './palette.ts';

export interface HudDeps {
  root: HTMLElement;
  session: SessionLike;
  sfx: SfxLike;
  /** Opens settings (at a section, from the palette); defaults to the settings sheet. */
  onSettings?(section?: SettingsSection): void;
  /** When given, the name becomes a button that opens the profile. */
  onProfile?(): void;
  /** When given, the Main menu action appears (back to the main menu). */
  onMenu?(): void;
  /** v6.1 casino61: the play reminder's Take a break: stand up from any table, close any table flow. */
  onBreak?(): void;
  /** v7: the online count opens the list of who's on (ui/hud/online.ts). */
  onOnline?(): void;
}

export interface Hud extends Closable {
  /** The stack at the table you're seated at, and what you bought in with; null when you stand up. */
  setTableChips(stack: Cents | null, escrow?: Cents): void;
  /** Accounts connected to the floor; null hides the count. */
  setOnline(n: number | null): void;
  /** Open (or close) the keyboard list, as "?" does. */
  toggleShortcuts(): void;
  /**
   * Give the HUD a tool: a row in More and an entry in the palette, and a place in the bar when
   * it's primary. A tool with an id already there replaces it. Returns its removal.
   */
  addTool(tool: HudTool): () => void;
  /** More for the palette beyond the tools and settings (the rooms, the games); asked each time it opens. */
  addCommands(source: () => Command[]): () => void;
  /** Open or close the More panel. */
  toggleMore(): void;
  /** Open the command palette, with something typed already if given. */
  openPalette(query?: string): void;
  /** Open Settings, at a section if given. */
  openSettings(section?: SettingsSection): void;
}

const HINT_KEY = 'casino.hud.more';

/**
 * Once per browser, a few seconds onto the floor: where the buttons that used to fill the bar went.
 * Only for a player who knew the old bar (an account that has played, or is more than a day old):
 * a new one is never told, now or later. Not for a browser a script drives (the checks read the
 * toasts), and not again once it's said.
 */
function hintOnce(p: Profile | null): void {
  try {
    if (navigator.webdriver || localStorage.getItem(HINT_KEY)) return;
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    return;
  }
  if (!p || (p.stats.total.rounds === 0 && Date.now() - p.createdAt < 86_400_000)) return;
  const keys = matchMedia('(any-pointer: fine)').matches ? `, and ${PALETTE_KEY} finds anything` : '';
  toast(`The boutique, the bar, the daily bonus and the rest are under More now${keys}.`, 'info', 7_000);
}

/** Ctrl K on Windows and Linux, ⌘ K on a Mac: the palette's key, as its keycap says it. */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const PALETTE_KEY = MAC ? '⌘ K' : 'Ctrl K';

function stat(label: string, cls = ''): { tile: HTMLElement; value: HTMLElement } {
  const tile = el('div', `hud-stat ${cls}`.trim());
  const value = el('div', 'stat-value money');
  tile.append(el('div', 'stat-label', label), value);
  return { tile, value };
}

function toolButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'hud-btn');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

/** Rolls a money readout to its new value instead of jumping. */
function roller(target: HTMLElement): (to: Cents) => void {
  let shown: Cents | null = null;
  let raf = 0;
  let flash = 0;
  return (to) => {
    cancelAnimationFrame(raf);
    const from = shown;
    if (from === null || from === to || calm()) {
      shown = to;
      target.textContent = formatMoney(to);
      return;
    }
    // the brass tick starts over on the next frame (no layout read to restart it now)
    target.classList.remove('tick');
    cancelAnimationFrame(flash);
    flash = requestAnimationFrame(() => target.classList.add('tick'));
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
  installTooltips();
  const root = el('div', 'hud pass');
  root.setAttribute('aria-label', 'Status');

  // left: you and your money
  const left = el('div', 'hud-bar hud-left');
  const who = deps.onProfile ? el('button', 'hud-who') : el('div', 'hud-who');
  if (who instanceof HTMLButtonElement) {
    who.type = 'button';
    who.dataset.tip = 'Your profile';
    who.addEventListener('click', () => deps.onProfile?.());
  }
  const balance = stat('Balance', 'hud-balance');
  const table = stat('At table', 'hud-table');
  table.tile.hidden = true;
  // v6 bank6: net worth, once there's more than the balance (chips on tables, the bank)
  const worth = stat('Net worth', 'hud-worth');
  worth.tile.hidden = true;
  const sessionTile = stat('Session', 'hud-session');
  left.append(who, balance.tile, worth.tile, table.tile, sessionTile.tile);

  // right: the room and the tools
  const right = el('div', 'hud-right');
  const online = el('button', 'hud-bar hud-online');
  online.type = 'button';
  online.dataset.tip = "Who's online";
  online.setAttribute('aria-label', "Who's online");
  online.addEventListener('click', () => deps.onOnline?.());
  const onlineN = el('span', 'money', '');
  online.append(el('i', 'dot'), onlineN, el('span', 'hud-online-label', 'online'));
  online.hidden = true;
  let onlineCount: number | null = null;
  const moreBtn = el('button', 'hud-btn hud-more-btn');
  moreBtn.type = 'button';
  moreBtn.setAttribute('aria-label', 'More');
  moreBtn.setAttribute('aria-haspopup', 'dialog');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.dataset.tip = 'Every action, grouped';
  moreBtn.append(icon('more'), el('span', 'hud-more-label', 'More'), el('span', 'hud-more-badge'));
  moreBtn.addEventListener('click', () => toggleMore());
  right.append(online, moreBtn);
  // the tools not in the bar: in the HUD (so they're found by what they are), never shown
  const store = el('div', 'hud-store');
  store.hidden = true;
  root.append(left, right, store);
  deps.root.append(root);

  // --- the tools -----------------------------------------------------------------------------

  const tools = new Map<string, HudTool>();
  const byButton = new Map<HTMLButtonElement, HudTool>();
  const offKeys = new Map<string, () => void>();
  const commandSources = new Set<() => Command[]>();
  let more: MorePanel | null = null;
  let palette: Palette | null = null;

  /** The tool's tip from its title (taken off: the HUD's tooltip says it) or its label, and its key. */
  const syncTip = (t: HudTool) => {
    const b = t.button;
    const title = b.getAttribute('title');
    if (title !== null) {
      b.removeAttribute('title');
      b.dataset.tipTitle = title;
    }
    const split = splitKey(b.dataset.tipTitle ?? t.label);
    b.dataset.tip = split.text || t.label;
    const key = toolKey(t) ?? split.key;
    if (key) b.dataset.tipKey = key;
    else delete b.dataset.tipKey;
    if (!b.hasAttribute('aria-label')) b.setAttribute('aria-label', t.label);
  };

  const ordered = () => [...tools.values()].sort(byPlace);

  /** Where a tool's button goes: in the bar in order before More, or in the store. */
  const place = (t: HudTool) => {
    const b = t.button;
    b.classList.add('hud-btn');
    b.dataset.tool = t.id;
    b.dataset.rank = String(t.rank ?? 2);
    b.classList.toggle('keyboard-only', !!t.keyboardOnly);
    if (!t.primary) {
      if (b.parentElement !== store) store.append(b);
      return;
    }
    const after = ordered().find((o) => o.primary && o !== t && byPlace(o, t) > 0 && o.button.parentElement === right);
    const before = after?.button ?? moreBtn;
    if (b.nextElementSibling !== before || b.parentElement !== right) right.insertBefore(b, before);
  };

  /** A tool's button changed (its state, its title, its badge): the tip, More's rows and More's dot. */
  const toolObs = new MutationObserver((records) => {
    for (const r of records) {
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      const b = target?.closest('button') ?? null;
      const t = b ? byButton.get(b) : undefined;
      if (t && r.type === 'attributes' && r.attributeName === 'title' && b!.hasAttribute('title')) syncTip(t);
    }
    changed();
  });
  const watchButton = (b: HTMLButtonElement) => toolObs.observe(b, { attributes: true, attributeFilter: ['title', 'aria-label', 'aria-pressed', 'class', 'disabled', 'data-badge'], childList: true, subtree: true });

  const addTool = (t: HudTool): (() => void) => {
    const old = tools.get(t.id);
    if (old && old.button !== t.button) removeTool(old.id, true);
    tools.set(t.id, t);
    byButton.set(t.button, t);
    offKeys.get(t.id)?.();
    // its key's keycap follows a rebinding (ui/keys.ts)
    offKeys.set(t.id, keyed(() => syncTip(t)));
    place(t);
    watchButton(t.button);
    changed();
    return () => removeTool(t.id, true);
  };

  /** Forget a tool; `detach` also takes its button out of the HUD (its module keeps it). */
  function removeTool(id: string, detach: boolean): void {
    const t = tools.get(id);
    if (!t) return;
    tools.delete(id);
    byButton.delete(t.button);
    offKeys.get(id)?.();
    offKeys.delete(id);
    if (detach && (t.button.parentElement === store || t.button.parentElement === right)) t.button.remove();
    changed();
  }

  // Buttons put into the bar the old way are adopted; tools whose module took their button out
  // (a dispose) are forgotten.
  const barObs = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n instanceof HTMLButtonElement && n.classList.contains('hud-btn') && n !== moreBtn && !byButton.has(n) && n.parentElement === right) addTool(adopt(n));
      }
      for (const n of r.removedNodes) {
        if (!(n instanceof HTMLButtonElement)) continue;
        const t = byButton.get(n);
        if (t && n.parentElement !== right && n.parentElement !== store) removeTool(t.id, false);
      }
    }
  });
  barObs.observe(right, { childList: true });
  barObs.observe(store, { childList: true });

  let changeQueued = false;
  /** Tools came, went or changed: More's dot and its rows, once per frame at most. */
  function changed(): void {
    if (changeQueued) return;
    changeQueued = true;
    requestAnimationFrame(() => {
      changeQueued = false;
      // something waiting (the daily bonus) on a tool you can't see in the bar: a dot on More
      const waiting = [...tools.values()].some((t) => hasBadge(t.button) && (t.button.parentElement !== right || t.button.getClientRects().length === 0));
      moreBtn.classList.toggle('badged', waiting);
      more?.refresh();
    });
  }

  /** The online count as a tool of its own, for More and the palette (its pill stays first in the bar). */
  const onlineTool: HudTool = { id: 'online', button: online, label: "Who's online", group: 'social', order: 10, keywords: 'players people list bail', icon: () => icon('people'), state: () => (onlineCount === null ? null : `${onlineCount.toLocaleString('en-US')} on`) };
  const allTools = () => [...ordered(), ...(online.hidden ? [] : [onlineTool])].sort(byPlace);

  // --- the HUD's own tools ---------------------------------------------------------------------

  // Tips at the tables: the best play where a game has one. Lit while it's on.
  const bulb = toolButton('bulb', 'Tips at the tables', () => tips.toggle());
  const paintTips = () => {
    bulb.classList.toggle('on', tips.on);
    bulb.setAttribute('aria-pressed', String(tips.on));
    bulb.title = tips.on ? 'Tips at the tables: on' : 'Tips at the tables: off';
  };
  paintTips();
  const offTips = tips.subscribe(paintTips);

  const mute = toolButton(deps.sfx.muted ? 'muted' : 'sound', `Mute (${keyLabel('mute')})`, () => toggleMute());
  mute.classList.add('hud-mute');
  const paintMute = () => {
    mute.replaceChildren(icon(deps.sfx.muted ? 'muted' : 'sound'));
    mute.setAttribute('aria-pressed', String(deps.sfx.muted));
    mute.setAttribute('aria-label', `Mute (${keyLabel('mute')})`);
    mute.title = deps.sfx.muted ? 'Unmute' : 'Mute';
  };
  const toggleMute = () => {
    deps.sfx.setMuted(!deps.sfx.muted);
    if (!deps.sfx.muted) deps.sfx.play('ui-click', { volume: 0.5 });
    paintMute();
  };

  // light or dark for the menus and panels (app/theme.ts); Settings has it too
  const themeBtn = themeButton('hud-theme');
  const settingsBtn = toolButton('gear', 'Settings', () => openSettingsAt());
  const keysBtn = toolButton('keyboard', 'Keyboard shortcuts (?)', () => toggleShortcuts());
  const notesBtn = toolButton('bell', 'Notifications', () => openNotesSheet());

  addTool({ id: 'tips', button: bulb, label: 'Tips at the tables', group: 'play', order: 40, primary: true, toggle: true, keywords: 'advice strategy best play basic hints' });
  addTool({ id: 'notes', button: notesBtn, label: 'Notifications', group: 'social', order: 30, keywords: 'history toasts messages recent alerts' });
  addTool({ id: 'sound', button: mute, label: 'Sound', group: 'system', order: 10, primary: true, toggle: true, key: 'mute', keywords: 'mute unmute audio volume', state: () => (deps.sfx.muted ? 'Off' : 'On') });
  addTool({ id: 'theme', button: themeBtn.root, label: 'Theme', group: 'system', order: 20, toggle: true, keywords: 'light dark mode colours', state: () => (theme() === 'light' ? 'Light' : 'Dark') });
  addTool({ id: 'settings', button: settingsBtn, label: 'Settings', group: 'system', order: 30, primary: true, keywords: 'options preferences graphics quality controls' });
  addTool({ id: 'keys', button: keysBtn, label: 'Keyboard shortcuts', group: 'system', order: 40, key: { label: '?' }, keyboardOnly: true, keywords: 'keys help controls bindings' });
  if (deps.onMenu) addTool({ id: 'menu', button: toolButton('door', 'Menu', () => deps.onMenu?.()), label: 'Main menu', group: 'system', order: 60, keywords: 'leave floor log out character look' });

  // --- More, the palette, settings and the shortcut list ----------------------------------------

  function toggleMore(): void {
    if (more) {
      more.close();
      return;
    }
    if (overlayCount() > 0) return;
    hideTooltip();
    deps.sfx.play('ui-click', { volume: 0.3 });
    moreBtn.setAttribute('aria-expanded', 'true');
    moreBtn.classList.add('open');
    more = openMore({
      root: deps.root,
      anchor: moreBtn,
      tools: allTools,
      searchKey: PALETTE_KEY,
      onSearch: (q) => openPaletteNow(q),
      onClose: () => {
        more = null;
        moreBtn.setAttribute('aria-expanded', 'false');
        moreBtn.classList.remove('open');
      },
    });
  }

  const commands = (): Command[] => {
    const fine = matchMedia('(any-pointer: fine)').matches;
    const out: Command[] = allTools()
      .filter((t) => !t.keyboardOnly || fine)
      .map((t) => ({
        id: `tool:${t.id}`,
        label: t.label,
        hint: toolState(t) ?? undefined,
        group: 'Action',
        icon: () => iconOf(t),
        key: toolKey(t) ?? t.button.dataset.tipKey ?? null,
        keywords: t.keywords,
        run: () => t.button.click(),
      }));
    for (const s of SETTINGS_SECTIONS) {
      out.push({ id: `settings:${s.id}`, label: `Settings: ${s.title}`, hint: s.about, group: 'Setting', icon: () => icon('gear'), keywords: s.keywords, run: () => openSettingsAt(s.id) });
    }
    for (const src of commandSources) {
      try {
        out.push(...src());
      } catch (err) {
        console.warn('palette source failed', err);
      }
    }
    return out;
  };

  function openPaletteNow(query?: string): void {
    if (palette) return;
    more?.close();
    hideTooltip();
    if (!query) deps.sfx.play('ui-click', { volume: 0.3 });
    palette = openPalette({ root: deps.root, commands, query, onClose: () => (palette = null) });
  }

  function openSettingsAt(section?: SettingsSection): void {
    if (deps.onSettings) deps.onSettings(section);
    else openSettings({ root: deps.root, sfx: deps.sfx, section, onClose: paintMute });
  }

  let notes: Closable | null = null;
  function openNotesSheet(): void {
    if (notes) return;
    notes = openNotes({ root: deps.root, onClose: () => (notes = null) });
  }

  let shortcuts: Closable | null = null;
  const toggleShortcuts = () => {
    if (shortcuts) {
      shortcuts.close();
      return;
    }
    shortcuts = openShortcuts({ root: deps.root, paletteKey: PALETTE_KEY, onKeys: () => openSettingsAt('controls'), onClose: () => (shortcuts = null) });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || modified(e)) return;
    if (isTyping(e)) return;
    if (e.key === '?') {
      e.preventDefault();
      toggleShortcuts();
    } else if (isKey(e, 'mute') && !e.shiftKey) {
      e.preventDefault();
      toggleMute();
    }
  };
  addEventListener('keydown', onKey);

  // Ctrl K (⌘ K): the palette, from the floor or a table, or from More. Ahead of everything (a
  // table hears K as a tip) and never while typing in a field, but for the palette's own: there
  // it closes it (rather than the browser's own Ctrl K taking it to the address bar).
  const onPaletteKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyK' || !(MAC ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey || e.repeat) return;
    if (palette) {
      e.preventDefault();
      e.stopPropagation();
      palette.close();
      return;
    }
    if (isTyping(e)) return;
    const top = topPanel();
    if (overlayCount() > 0 && !(more && top && more.root.contains(top))) return;
    e.preventDefault();
    e.stopPropagation();
    openPaletteNow();
  };
  addEventListener('keydown', onPaletteKey, true);

  // --- money -----------------------------------------------------------------------------------

  const rollBalance = roller(balance.value);
  const rollTable = roller(table.value);
  const rollWorth = roller(worth.value);

  // Session net: won or lost at play since the HUD came up (ui/hud/net.ts): the bank's top-ups
  // aren't winnings and the boutique's and the bar's prices aren't losses.
  const startedAt = Date.now();
  const start = netStart(deps.session.profile, deps.session.spent ?? 0);
  let seat: { stack: Cents; escrow: Cents } | null = null;
  let netTimer = 0;

  const currentNet = () => {
    const p = deps.session.profile;
    return p ? sessionNet(p, start, seat, deps.session.spent ?? 0) : null;
  };
  // v6.1 casino61: the play reminder and the loss limit, on the same figures
  const reminder = mountReminder({ root: deps.root, startedAt, net: currentNet, onBreak: deps.onBreak });

  let sessionText = '';
  const paintSession = () => {
    const net = currentNet();
    if (net === null) return;
    reminder.check();
    const money = formatMoney(net, { sign: true });
    const time = formatDuration(Date.now() - startedAt);
    // (every half minute, and after each change of money: only a change is written)
    if (`${money}|${time}` === sessionText) return;
    sessionText = `${money}|${time}`;
    sessionTile.value.replaceChildren(el('span', net > 0 ? 'win' : net < 0 ? 'lose' : '', money), el('span', 'hud-time', ` · ${time}`));
  };
  // Balance, seat and stack messages don't arrive in one piece; wait for them to settle.
  const scheduleSession = () => {
    clearTimeout(netTimer);
    netTimer = window.setTimeout(paintSession, 400);
  };
  const clock = window.setInterval(paintSession, 30_000);

  // v7.1: at a table, net worth is what you had off it: your worth when you sat down less the
  // buy-in, held still until you stand up (the table's own tile counts the chips meanwhile)
  let lastWorth = 0;
  let seatedWorth: Cents | null = null;
  const paint = (p: Profile) => {
    who.textContent = p.name;
    if (who instanceof HTMLButtonElement) who.setAttribute('aria-label', `Profile: ${p.name}`);
    rollBalance(p.balance);
    const w = p.bank?.worth ?? p.balance + p.inPlay;
    lastWorth = w;
    if (seatedWorth !== null) {
      worth.tile.hidden = false;
      rollWorth(seatedWorth);
    } else {
      worth.tile.hidden = w === p.balance;
      if (!worth.tile.hidden) rollWorth(w);
    }
    scheduleSession();
  };

  // --- the space under the HUD ------------------------------------------------------------------

  // --below-hud is where the space under the HUD starts, in #ui's own coordinates (it's inset by
  // the safe area): the lowest of the HUD's pieces and a gap, kept as the HUD changes size.
  let below = '';
  const measure = () => {
    if (!root.isConnected) return;
    const host = deps.root.getBoundingClientRect();
    let bottom = 0;
    for (const part of [left, right]) {
      const r = part.getBoundingClientRect();
      if (r.height > 0) bottom = Math.max(bottom, r.bottom - host.top);
    }
    if (bottom <= 0) return;
    const gap = innerWidth <= 560 || innerHeight <= 480 ? 10 : 16;
    const next = `${Math.round(bottom + gap)}px`;
    if (next === below) return;
    below = next;
    document.documentElement.style.setProperty('--below-hud', next);
  };
  const sizeObs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;
  sizeObs?.observe(root);
  sizeObs?.observe(left);
  sizeObs?.observe(right);
  addEventListener('resize', measure);

  const offFps = mountFps(left);
  const hintTimer = window.setTimeout(() => hintOnce(deps.session.profile), 5_000);
  const off = deps.session.on(paint);
  if (deps.session.profile) paint(deps.session.profile);
  paintMute();
  paintSession();
  const offMuteKey = keyed(paintMute);
  // muted from Settings (or anywhere else): the button follows at once
  let shownMuted = deps.sfx.muted;
  const offSfx =
    deps.sfx.onChange?.(() => {
      if (deps.sfx.muted === shownMuted) return;
      shownMuted = deps.sfx.muted;
      paintMute();
    }) ?? (() => {});
  requestAnimationFrame(measure);

  return {
    root,
    setTableChips(stack, escrow) {
      if (stack === null) {
        seat = null;
        table.tile.hidden = true;
        seatedWorth = null;
        const p = deps.session.profile;
        if (p) paint(p);
      } else {
        if (seat === null) seatedWorth = Math.max(0, lastWorth - (escrow ?? stack));
        seat = { stack, escrow: escrow ?? seat?.escrow ?? stack };
        table.tile.hidden = false;
        rollTable(stack);
      }
      scheduleSession();
    },
    setOnline(n) {
      onlineCount = n;
      online.hidden = n === null;
      onlineN.textContent = n === null ? '' : n.toLocaleString('en-US');
      online.setAttribute('aria-label', n === null ? "Who's online" : `Who's online: ${n.toLocaleString('en-US')}`);
      more?.refresh();
    },
    toggleShortcuts,
    addTool,
    addCommands(source) {
      commandSources.add(source);
      return () => commandSources.delete(source);
    },
    toggleMore,
    openPalette: openPaletteNow,
    openSettings: openSettingsAt,
    close() {
      off();
      offTips();
      offMuteKey();
      offSfx();
      offFps();
      themeBtn.dispose();
      for (const fn of offKeys.values()) fn();
      offKeys.clear();
      toolObs.disconnect();
      barObs.disconnect();
      sizeObs?.disconnect();
      removeEventListener('resize', measure);
      removeEventListener('keydown', onKey);
      removeEventListener('keydown', onPaletteKey, true);
      clearInterval(clock);
      clearTimeout(netTimer);
      clearTimeout(hintTimer);
      reminder.close();
      shortcuts?.close();
      notes?.close();
      more?.close();
      palette?.close();
      hideTooltip();
      document.documentElement.style.removeProperty('--below-hud');
      root.remove();
    },
  };
}
