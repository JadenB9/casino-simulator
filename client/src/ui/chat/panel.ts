// The chat panel, in the bottom-right corner: a dock (Chat, the unread count, the T key) that opens
// into the log and a line to type in. A Floor tab, and a Table tab while you're at a lobby table,
// each with its own unread count; a switch that hides chat (no bubbles, no counts, no previews);
// and while it's closed, the newest lines peek in above the dock for a few seconds.
//
// Keys: Enter or T opens it and starts typing, Enter sends, Esc stops. While the line has focus
// the panel holds the keyboard (ui/keyboard.ts), so W/A/S/D type instead of walking and a table's
// shortcuts stay quiet. Opened by a key it closes again after sending; opened with a click it
// stays open until closed. The corner is shared with some tables' meters, so the whole thing
// rises above any panel a table keeps down there. Names and lines go in with textContent only.

import './chat.css';
import { CHAT_MAX, cleanChat, type ChatLine, type ChatServerMsg } from '../../../../shared/src/protocol.ts';
import { el } from '../kit.ts';
import { holdKeyboard, isTyping, overlayCount } from '../keyboard.ts';
import { RoomLog, SendGate, nameHue, type RoomId } from './model.ts';

/** Where a room's lines go out: FloorLink.say, or the table socket. False while it's down. */
export interface RoomLink {
  say(text: string): boolean;
}

export interface PanelDeps {
  root: HTMLElement;
  floor: RoomLink;
  /** Your account id, to tell your own lines apart. */
  me(): number | null;
  /** The hide-chat switch changed. */
  onMute?(muted: boolean): void;
}

/** Previews shown above the closed dock, and for how long. */
const PEEKS = 3;
const PEEK_MS = 6000;
/** The counter shows from this many characters on. */
const COUNT_FROM = 150;
const MUTED_KEY = 'casino.chat.muted';
const OPEN_KEY = 'casino.chat.open';

const NOTES: Record<RoomId, string> = {
  floor: 'Everyone on the floor sees this',
  table: 'Only the players at this table see this',
};
const PLACEHOLDER: Record<RoomId, string> = { floor: 'Talk to the floor', table: 'Talk to the table' };

interface Room {
  log: RoomLog;
  list: HTMLElement;
  tab: HTMLButtonElement;
  badge: HTMLElement;
}

export class ChatPanel {
  readonly root = el('section', 'chat pass');
  muted = load(MUTED_KEY) === '1';
  private readonly dock = el('button', 'chat-dock');
  private readonly dockBadge = el('span', 'chat-badge');
  private readonly box = el('div', 'chat-box');
  private readonly peeks = el('div', 'chat-peeks');
  private readonly scroller = el('div', 'chat-log');
  private readonly input = el('input', 'chat-input');
  private readonly status = el('span', 'chat-status');
  private readonly muteBtn = el('button', 'chat-icon chat-mute');
  private readonly rooms: Record<RoomId, Room>;
  private active: RoomId = 'floor';
  private table: RoomLink | null = null;
  private visible = false;
  private open = false;
  /** Opened on purpose (a click): it stays open after a line goes out, and next time. */
  private pinned = load(OPEN_KEY) === '1';
  private release: (() => void) | null = null;
  private pressing = false;
  private readonly gate = new SendGate();
  /** performance.now() when a mute from the server ends. */
  private mutedUntil = 0;
  private statusTimer = 0;
  private muteTimer = 0;
  private placeTimer = 0;
  private readonly offs: (() => void)[] = [];

  constructor(private readonly deps: PanelDeps) {
    const root = this.root;
    root.setAttribute('aria-label', 'Chat');
    root.hidden = true;

    // The dock.
    this.dock.type = 'button';
    this.dock.setAttribute('aria-expanded', 'false');
    this.dock.title = 'Chat (T or Enter)';
    const kc = el('kbd', 'chat-kc', 'T');
    this.dock.append(icon('chat'), el('span', 'chat-dock-label', 'Chat'), this.dockBadge, kc);
    this.dock.addEventListener('click', () => this.show(true, true));

    // The open box: tabs and switches, the log, the line.
    const head = el('div', 'chat-head');
    const tabs = el('div', 'chat-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Chat rooms');
    this.muteBtn.type = 'button';
    this.muteBtn.addEventListener('click', () => this.setMuted(!this.muted));
    const close = el('button', 'chat-icon chat-close');
    close.type = 'button';
    close.title = 'Close chat';
    close.setAttribute('aria-label', 'Close chat');
    close.append(icon('down'));
    close.addEventListener('click', () => this.show(false));
    head.append(tabs, this.muteBtn, close);

    const room = (id: RoomId, label: string): Room => {
      const tab = el('button', 'chat-tab');
      tab.type = 'button';
      tab.id = `chat-tab-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `chat-list-${id}`);
      const badge = el('span', 'chat-badge');
      badge.hidden = true;
      tab.append(el('span', '', label), badge);
      tab.addEventListener('click', () => this.select(id));
      tabs.append(tab);
      const list = el('div', 'chat-list');
      list.id = `chat-list-${id}`;
      list.setAttribute('role', 'log');
      list.setAttribute('aria-live', 'polite');
      list.setAttribute('aria-labelledby', tab.id);
      list.append(el('p', 'chat-note', NOTES[id]));
      this.scroller.append(list);
      return { log: new RoomLog(), list, tab, badge };
    };
    this.rooms = { floor: room('floor', 'Floor'), table: room('table', 'Table') };
    this.rooms.table.tab.hidden = true;
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const ids = (['floor', 'table'] as const).filter((id) => !this.rooms[id].tab.hidden);
      const next = ids[(ids.indexOf(this.active) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]!;
      this.select(next);
      this.rooms[next].tab.focus();
      e.preventDefault();
    });

    const line = el('div', 'chat-line-in');
    this.input.type = 'text';
    this.input.maxLength = CHAT_MAX;
    this.input.autocomplete = 'off';
    this.input.spellcheck = true;
    this.input.enterKeyHint = 'send';
    this.input.setAttribute('aria-label', 'Chat message');
    const send = el('button', 'chat-send');
    send.type = 'button';
    send.title = 'Send (Enter)';
    send.setAttribute('aria-label', 'Send');
    send.append(icon('send'));
    // Tapping Send mustn't take focus from the line first (on a phone that drops the keyboard).
    send.addEventListener('pointerdown', (e) => e.preventDefault());
    send.addEventListener('click', () => this.send());
    this.status.setAttribute('aria-live', 'polite');
    line.append(this.input, this.status, send);
    this.box.append(head, this.scroller, line);
    this.box.hidden = true;
    root.append(this.peeks, this.dock, this.box);
    deps.root.append(root);

    this.input.addEventListener('focus', () => this.typingStarted());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this.send();
      }
    });
    this.input.addEventListener('input', () => this.showCount());
    // Leaving the line for somewhere else in the panel (a tab, Send) keeps the box; leaving the
    // panel altogether (a click on the floor) puts a box opened by a key away again.
    root.addEventListener('focusout', (e) => {
      if (e.target !== this.input) return;
      this.typingStopped();
      if (!this.visible || !this.open) return;
      // A click somewhere in the box (the log, say) means it's wanted: keep it open.
      if (this.pressing) this.pin();
      else if (!(e.relatedTarget instanceof Node && root.contains(e.relatedTarget))) this.afterTyping();
    });
    root.addEventListener('pointerdown', () => (this.pressing = true));
    const up = () => (this.pressing = false);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('keydown', this.onKey);
    addEventListener('resize', this.place);
    this.offs.push(() => {
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('keydown', this.onKey);
      removeEventListener('resize', this.place);
    });

    this.select('floor');
    this.paintMute();
  }

  /** Show the chat (on the floor, at a table) or hide it (the menu). */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.root.hidden = !on;
    if (!on) {
      this.input.blur();
      clearInterval(this.placeTimer);
      return;
    }
    // A box left open (on purpose) last time is open again.
    if (this.pinned && !this.open) this.show(true);
    this.place();
    // Tables mount and unmount their panels as they please; keep clear of them.
    this.placeTimer = window.setInterval(this.place, 1500);
  }

  /** A lobby table's room while you're at one; null when you leave it. */
  setTable(link: RoomLink | null): void {
    const t = this.rooms.table;
    this.table = link;
    t.log.clear();
    t.list.replaceChildren(el('p', 'chat-note', NOTES.table));
    t.tab.hidden = link === null;
    this.select(link ? 'table' : 'floor');
    this.paintBadges();
    this.place();
  }

  /** A chat message from a room's socket. Returns the lines it added (none for a refusal). */
  receive(id: RoomId, msg: ChatServerMsg): ChatLine[] {
    const room = this.rooms[id];
    if (msg.t === 'chat.no') {
      if (msg.code === 'MUTED' && msg.until) this.serverMute(msg.until - msg.now);
      this.system(id, msg.msg);
      return [];
    }
    if (id === 'table' && !this.table) return [];
    const reading = this.visible && this.open && this.active === id;
    const stick = this.atBottom();
    const fresh = room.log.take(msg.lines, msg.backlog === true, this.deps.me(), reading);
    if (!fresh.length) return fresh;
    for (const line of fresh) room.list.append(this.lineEl(line));
    trim(room.list);
    if (id === this.active && (stick || fresh.some((l) => l.id === this.deps.me()))) this.toBottom();
    this.paintBadges();
    if (!this.open && !msg.backlog && !this.muted && this.visible) {
      for (const line of fresh) if (line.id !== this.deps.me()) this.peek(line, id);
    }
    return fresh;
  }

  /** Open the box and start typing (a HUD button, a shortcut). */
  focus(): void {
    if (!this.visible) return;
    // Muted by the server there's nothing to type into: open it to show for how long, and keep
    // it open (Esc would otherwise go past it to the table behind).
    if (this.mutedLeft() > 0) {
      this.show(true, true);
      return;
    }
    this.show(true);
    this.input.focus({ preventScroll: true });
  }

  setMuted(on: boolean): void {
    if (on === this.muted) return;
    this.muted = on;
    save(MUTED_KEY, on ? '1' : null);
    if (on) this.peeks.replaceChildren();
    this.paintMute();
    this.paintBadges();
    this.deps.onMute?.(on);
  }

  dispose(): void {
    this.input.blur();
    this.release?.();
    this.release = null;
    clearTimeout(this.statusTimer);
    clearInterval(this.muteTimer);
    clearInterval(this.placeTimer);
    for (const off of this.offs) off();
    this.root.remove();
  }

  // --- opening, closing, typing ------------------------------------------------------------------

  /**
   * Open or close the box. `pin`: opened on purpose, so it stays open after a line goes out, and
   * is open again next time. Closing it unpins it.
   */
  private show(on: boolean, pin = false): void {
    if (pin) this.pin();
    if (!on && this.pinned) {
      this.pinned = false;
      save(OPEN_KEY, null);
    }
    if (on === this.open) return;
    this.open = on;
    this.box.hidden = !on;
    this.dock.hidden = on;
    this.dock.setAttribute('aria-expanded', String(on));
    if (on) {
      this.peeks.replaceChildren();
      this.read(this.active);
      this.toBottom();
    } else if (document.activeElement === this.input) {
      // After `open` is false, so the focusout that follows finds nothing left to do.
      this.input.blur();
    }
    this.place();
  }

  private pin(): void {
    this.pinned = true;
    save(OPEN_KEY, '1');
  }

  private select(id: RoomId): void {
    this.active = id;
    for (const [rid, room] of Object.entries(this.rooms) as [RoomId, Room][]) {
      const on = rid === id;
      room.tab.setAttribute('aria-selected', String(on));
      room.tab.tabIndex = on ? 0 : -1;
      room.list.hidden = !on;
    }
    this.input.placeholder = PLACEHOLDER[id];
    if (this.open) this.read(id);
    this.paintMuteClock();
    this.toBottom();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.visible || this.release || e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code !== 'KeyT' && e.key !== 'Enter') return;
    if (isTyping(e) || overlayCount() > 0) return;
    const t = e.target instanceof Element ? e.target : null;
    // Enter on a focused button presses that button; the chat's own buttons handle their keys.
    if (t && (this.root.contains(t) || (e.key === 'Enter' && t.closest('button, a[href], [role="button"]')))) return;
    // Not letting the key through also keeps the "t" out of the line it opens.
    e.preventDefault();
    this.focus();
  };

  private typingStarted(): void {
    if (this.release) return;
    this.release = holdKeyboard(this.root, () => {
      this.input.blur();
      this.afterTyping();
    });
    this.root.classList.add('typing');
    // A walk key held down as the line took focus would never see its keyup (the floor ignores
    // keys typed into a field) and walk on by itself: the floor forgets held keys on a blur.
    dispatchEvent(new Event('blur'));
  }

  private typingStopped(): void {
    this.release?.();
    this.release = null;
    this.root.classList.remove('typing');
  }

  /** Done typing: a box opened by a key goes away again. */
  private afterTyping(): void {
    if (!this.pinned) this.show(false);
  }

  private send(): void {
    const room = this.active;
    const text = cleanChat(this.input.value);
    if (text === null) {
      // Enter on an empty line puts it away.
      if (!this.input.value.trim()) {
        this.input.value = '';
        this.input.blur();
      }
      return;
    }
    if (this.mutedLeft() > 0) return;
    if (!this.gate.take()) {
      this.flash(`Wait ${Math.max(1, Math.ceil(this.gate.wait() / 1000))} s`);
      return;
    }
    const link = room === 'table' ? this.table : this.deps.floor;
    if (!link?.say(text)) {
      this.flash('Not connected');
      return;
    }
    this.input.value = '';
    this.showCount();
    // Back to the game: the focusout puts a box opened by a key away again.
    this.input.blur();
  }

  // --- drawing ---------------------------------------------------------------------------------

  private lineEl(line: ChatLine): HTMLElement {
    const mine = line.id === this.deps.me();
    const p = el('p', 'chat-line');
    p.append(el('span', `chat-name ${mine ? 'me' : `hue${nameHue(line.name)}`}`, line.name), el('span', 'chat-text', line.text));
    p.title = new Date(line.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return p;
  }

  /** A line from the game itself (a refusal), in that room's log. */
  private system(id: RoomId, text: string): void {
    const room = this.rooms[id];
    room.list.append(el('p', 'chat-line chat-sys', text));
    trim(room.list);
    if (id === this.active) this.toBottom();
    if (!this.open && this.visible) this.peek(null, id, text);
  }

  private peek(line: ChatLine | null, id: RoomId, text?: string): void {
    const p = el('div', `chat-peek${line ? '' : ' chat-sys'}`);
    if (line) {
      if (id === 'table') p.append(el('span', 'chat-peek-room', 'Table'));
      p.append(el('span', `chat-name hue${nameHue(line.name)}`, line.name), el('span', 'chat-text', line.text));
    } else {
      p.textContent = text ?? '';
    }
    this.peeks.append(p);
    while (this.peeks.childElementCount > PEEKS) this.peeks.firstElementChild!.remove();
    setTimeout(() => {
      p.classList.add('out');
      setTimeout(() => p.remove(), 350);
    }, PEEK_MS);
  }

  private read(id: RoomId): void {
    this.rooms[id].log.unread = 0;
    this.paintBadges();
  }

  private paintBadges(): void {
    let total = 0;
    for (const room of Object.values(this.rooms)) {
      const n = this.muted || room.tab.hidden ? 0 : room.log.unread;
      total += n;
      room.badge.hidden = n === 0;
      room.badge.textContent = n > 99 ? '99+' : String(n);
    }
    this.dockBadge.hidden = total === 0;
    this.dockBadge.textContent = total > 99 ? '99+' : String(total);
    this.dock.setAttribute('aria-label', total ? `Chat, ${total} unread` : 'Chat');
  }

  private paintMute(): void {
    this.root.classList.toggle('muted', this.muted);
    this.muteBtn.setAttribute('aria-pressed', String(this.muted));
    const label = this.muted ? 'Show chat' : 'Hide chat';
    this.muteBtn.title = this.muted ? 'Chat is hidden: no bubbles, counts or previews. Show chat' : 'Hide chat: no bubbles, counts or previews';
    this.muteBtn.setAttribute('aria-label', label);
    this.muteBtn.replaceChildren(icon(this.muted ? 'muted' : 'chat'));
    this.dock.replaceChild(icon(this.muted ? 'muted' : 'chat'), this.dock.firstElementChild!);
  }

  private showCount(): void {
    if (this.statusTimer) return;
    const n = [...this.input.value].length;
    this.status.textContent = n >= COUNT_FROM ? `${n}/${CHAT_MAX}` : '';
    this.status.classList.toggle('full', n >= CHAT_MAX);
  }

  /** A word in the status slot for a moment (the counter comes back after). */
  private flash(text: string): void {
    clearTimeout(this.statusTimer);
    this.status.textContent = text;
    this.status.classList.add('full');
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = 0;
      this.status.classList.remove('full');
      this.showCount();
    }, 1600);
  }

  // --- a mute from the server --------------------------------------------------------------------

  private serverMute(ms: number): void {
    this.mutedUntil = performance.now() + ms;
    clearInterval(this.muteTimer);
    this.muteTimer = window.setInterval(() => this.paintMuteClock(), 1000);
    this.paintMuteClock();
  }

  private mutedLeft(): number {
    return Math.max(0, this.mutedUntil - performance.now());
  }

  private paintMuteClock(): void {
    const left = this.mutedLeft();
    this.input.disabled = left > 0;
    this.root.classList.toggle('silenced', left > 0);
    if (left > 0) {
      const s = Math.ceil(left / 1000);
      this.input.placeholder = `Muted for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      return;
    }
    clearInterval(this.muteTimer);
    this.input.placeholder = PLACEHOLDER[this.active];
  }

  // --- where it sits -------------------------------------------------------------------------------

  private atBottom(): boolean {
    const s = this.scroller;
    return s.scrollHeight - s.scrollTop - s.clientHeight < 40;
  }

  private toBottom(): void {
    this.scroller.scrollTop = this.scroller.scrollHeight;
  }

  /**
   * Rise above any panel a table keeps in the bottom-right corner (baccarat's meters, a wide
   * action bar on a narrow screen), measured, since each game lays out its own.
   */
  private place = (): void => {
    if (!this.visible) return;
    const vw = innerWidth;
    const vh = innerHeight;
    const width = Math.min(360, vw - 32);
    const x0 = vw - 16 - width;
    let lift = 0;
    for (const p of this.deps.root.querySelectorAll<HTMLElement>('.panel')) {
      if (this.root.contains(p)) continue;
      const r = p.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Down in the corner: across our column, and low on the screen.
      if (r.right <= x0 || r.left >= vw - 16 || r.top < vh * 0.55 || r.bottom < vh - 170) continue;
      lift = Math.max(lift, vh - r.top - 18 + 10);
    }
    this.root.style.setProperty('--chat-lift', `${Math.round(lift)}px`);
  };
}

/** Keep a log's DOM from growing without end: a few more than the lines kept, for notices. */
function trim(list: HTMLElement): void {
  while (list.childElementCount > 170) list.children[1]!.remove();
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: it just won't be remembered */
  }
}

// Line icons in the UI's style (menu/icons.ts), built as SVG elements: the CSP rules out inline
// style attributes and data: URLs.
const NS = 'http://www.w3.org/2000/svg';

function icon(name: 'chat' | 'muted' | 'down' | 'send'): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'chat-ico');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  const path = (d: string) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
  };
  const bubble = 'M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.5L7 21v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z';
  switch (name) {
    case 'chat':
      path(bubble);
      path('M7.5 10.5h9M7.5 13.5h5.5');
      break;
    case 'muted':
      path(bubble);
      path('M4 3.5l16.5 17');
      break;
    case 'down':
      path('M6.5 9.5l5.5 5.5 5.5-5.5');
      break;
    case 'send':
      path('M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5');
      break;
  }
  return s;
}
