// The chat panel, in the bottom-right corner: a dock (Chat, the unread count, the T key) that opens
// into the log and a line to type in. A Floor tab, and a Table tab while you're at a lobby table,
// each with its own unread count; a switch that hides chat (no bubbles, no counts, no previews);
// and while it's closed, the newest lines peek in above the dock for a few seconds.
//
// Keys: Enter or T opens it and starts typing, Enter sends, Esc stops. While the line has focus
// the panel holds the keyboard (ui/keyboard.ts), so W/A/S/D type instead of walking and a table's
// shortcuts stay quiet. Opened by a key it closes again after sending; pinned (the pin in its head,
// or opening it with a click) it stays up, and is up again next time, until unpinned or closed.
// Pinned and not typing, it's `idle`: the log stays on screen while you walk, look round with the
// mouse held, sit and play, drawn lighter and letting clicks and drags through to the game; T or
// Enter (or a click on its line) types again. On a touch screen the idle log is only the newest
// lines, beside the action button and clear of the stick, and the dock starts typing. The corner
// is shared with some tables' meters, so the whole thing rises above any panel a table keeps down
// there. Names and lines go in with textContent only.

import './chat.css';
import { CHAT_MAX, cleanChat, type ChatLine, type ChatServerMsg } from '../../../../shared/src/protocol.ts';
import { el } from '../kit.ts';
import { holdKeyboard, isTyping, overlayCount } from '../keyboard.ts';
import { RoomLog, SendGate, chatLook, nameHue, type RoomId } from './model.ts';

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
/** Space kept between the chat and a table's panels, and the least log it will shrink to (px). */
const GAP = 10;
const MIN_LOG = 72;
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
  private readonly pinBtn = el('button', 'chat-icon chat-pin');
  private readonly rooms: Record<RoomId, Room>;
  private active: RoomId = 'floor';
  private table: RoomLink | null = null;
  private visible = false;
  private open = false;
  /** Pinned (or opened on purpose, with a click): it stays open after a line goes out, and next time. */
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
    // Idle on a touch screen the dock stays under the log: a tap there starts typing.
    this.dock.addEventListener('click', () => (this.open ? this.focus() : this.show(true, true)));

    // The open box: tabs and switches, the log, the line.
    const head = el('div', 'chat-head');
    const tabs = el('div', 'chat-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Chat rooms');
    this.muteBtn.type = 'button';
    this.muteBtn.addEventListener('click', () => this.setMuted(!this.muted));
    keepTyping(this.muteBtn);
    this.pinBtn.type = 'button';
    this.pinBtn.append(icon('pin'));
    this.pinBtn.addEventListener('click', () => this.setPinned(!this.pinned));
    keepTyping(this.pinBtn);
    const close = el('button', 'chat-icon chat-close');
    close.type = 'button';
    close.title = 'Close chat';
    close.setAttribute('aria-label', 'Close chat');
    close.append(icon('down'));
    close.addEventListener('click', () => this.show(false));
    head.append(tabs, this.muteBtn, this.pinBtn, close);

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
      keepTyping(tab);
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
    // Where the keyboard hold sends focus back to (ui/keyboard.ts focusFirst).
    this.input.dataset.autofocus = '';
    const send = el('button', 'chat-send');
    send.type = 'button';
    send.title = 'Send (Enter)';
    send.setAttribute('aria-label', 'Send');
    send.append(icon('send'));
    send.addEventListener('click', () => this.send());
    keepTyping(send);
    // Not live: past 150 characters it changes on every key. Refusals reach the log, which is.
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
    // A phone's on-screen keyboard covers the bottom of the page without resizing it (iOS): rise
    // above it while it's up, so the line being typed stays in sight.
    const vv = window.visualViewport;
    const keyboard = () => {
      const kb = vv ? Math.max(0, innerHeight - vv.height - vv.offsetTop) : 0;
      root.style.setProperty('--chat-kb', `${Math.round(kb)}px`);
    };
    vv?.addEventListener('resize', keyboard);
    vv?.addEventListener('scroll', keyboard);
    this.offs.push(() => {
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('keydown', this.onKey);
      removeEventListener('resize', this.place);
      vv?.removeEventListener('resize', keyboard);
      vv?.removeEventListener('scroll', keyboard);
    });

    this.select('floor');
    this.paintMute();
    this.paintPin();
  }

  /** Show the chat (on the floor, at a table) or hide it (the menu). */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.root.hidden = !on;
    if (!on) {
      this.input.blur();
      clearInterval(this.placeTimer);
      this.paintLook();
      return;
    }
    // A box left open (on purpose) last time is open again.
    if (this.pinned && !this.open) this.show(true);
    this.paintLook();
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
    // Word from a table already left (its socket lingers a moment) changes nothing.
    if (id === 'table' && !this.table) return [];
    const room = this.rooms[id];
    if (msg.t === 'chat.no') {
      if (msg.code === 'MUTED' && msg.until) this.serverMute(msg.until - msg.now);
      this.system(id, msg.msg);
      return [];
    }
    const reading = this.visible && this.open && this.active === id;
    const stick = this.atBottom();
    const epoch = room.log.epoch;
    const fresh = room.log.take(msg.lines, msg.backlog === true, this.deps.me(), reading);
    if (!fresh.length) return fresh;
    // The room began again (its backlog is older than what we had): draw it from scratch.
    if (room.log.epoch !== epoch) room.list.replaceChildren(el('p', 'chat-note', NOTES[id]));
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
    // an idle box on a touch screen has its line put away: out of idle first, or it can't take focus
    this.root.classList.remove('idle');
    this.input.focus({ preventScroll: true });
    if (document.activeElement !== this.input) this.paintLook();
  }

  /** Keep the chat up while you walk and play (the pin in its head); remembered for next time. */
  setPinned(on: boolean): void {
    if (on === this.pinned) return;
    if (on) this.pin();
    else {
      this.pinned = false;
      save(OPEN_KEY, null);
    }
    this.paintPin();
    // Unpinned while nothing's being typed, it goes away like a box opened by a key.
    if (!on && this.open && !this.release) this.show(false);
    this.paintLook();
  }

  get isPinned(): boolean {
    return this.pinned;
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
      this.paintPin();
    }
    if (on === this.open) return;
    this.open = on;
    this.box.hidden = !on;
    this.dock.setAttribute('aria-expanded', String(on));
    if (on) {
      this.peeks.replaceChildren();
      this.read(this.active);
      this.toBottom();
    } else if (document.activeElement === this.input) {
      // After `open` is false, so the focusout that follows finds nothing left to do.
      this.input.blur();
    }
    this.paintLook();
    this.place();
  }

  private pin(): void {
    this.pinned = true;
    save(OPEN_KEY, '1');
    this.paintPin();
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
    this.paintLook();
    // A walk key held down as the line took focus would never see its keyup (the floor ignores
    // keys typed into a field) and walk on by itself: the floor forgets held keys on a blur.
    dispatchEvent(new Event('blur'));
  }

  private typingStopped(): void {
    this.release?.();
    this.release = null;
    this.root.classList.remove('typing');
    this.paintLook();
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
    // The same refusal again (a burst of them) says nothing new.
    const last = room.list.lastElementChild;
    if (last?.classList.contains('chat-sys') && last.textContent === text) return;
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
    this.muteBtn.replaceChildren(icon(this.muted ? 'hidden' : 'shown'));
    this.dock.replaceChild(icon(this.muted ? 'muted' : 'chat'), this.dock.firstElementChild!);
  }

  private paintPin(): void {
    this.root.classList.toggle('pinned', this.pinned);
    this.pinBtn.setAttribute('aria-pressed', String(this.pinned));
    const label = this.pinned ? 'Unpin chat' : 'Pin chat open';
    this.pinBtn.title = this.pinned ? 'Pinned: chat stays up while you walk and play. Unpin' : 'Pin chat open: keep it up while you walk and play';
    this.pinBtn.setAttribute('aria-label', label);
  }

  /** Idle (pinned, not typing) or not; on a touch screen the dock stays under an idle log. */
  private paintLook(): void {
    const look = chatLook({ visible: this.visible, open: this.open, pinned: this.pinned, typing: this.release !== null });
    this.root.classList.toggle('idle', look === 'idle');
    this.dock.hidden = look === 'box';
    // the newest lines in view, whatever was scrolled to while typing
    if (look === 'idle') this.toBottom();
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
    // Disabling a focused field doesn't reliably fire its blur: stop typing first.
    if (this.release) {
      this.input.blur();
      this.typingStopped();
    }
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
   * Share the corner with whatever the table keeps there, measured, since each game lays out its
   * own: rise above the panels low in our column (baccarat's meters, a wide action bar on a narrow
   * screen), and let the log give up height to stay under the ones higher up (a lobby's party
   * panel). If rising would push the box into those, it stays down over the low ones instead: that
   * hides a few numbers for a moment, never the party's buttons.
   */
  private place = (): void => {
    if (!this.visible) return;
    // (idle on a touch screen the box stands beside the dock, which keeps the corner)
    const compact = this.root.classList.contains('idle') && document.documentElement.classList.contains('touch-ui');
    const shown = this.open && !compact ? this.box : this.dock;
    const r0 = shown.getBoundingClientRect();
    if (r0.width === 0) return;
    // Unlifted, from the CSS's own base (not the live rect: `bottom` is transitioned, and a
    // reading taken mid-way would be off), at the log's full height.
    const bottom = innerHeight - (parseFloat(getComputedStyle(this.root).getPropertyValue('--chat-base')) || 18);
    const log = Math.min(232, Math.max(120, innerHeight * 0.3));
    const height = shown === this.box ? shown.offsetHeight - this.scroller.offsetHeight + log : shown.offsetHeight;
    const top = bottom - height;
    let lift = 0;
    let ceiling = 0;
    const below: DOMRect[] = [];
    for (const p of this.deps.root.querySelectorAll<HTMLElement>('.panel')) {
      if (this.root.contains(p)) continue;
      const r = p.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= r0.left || r.left >= r0.right) continue;
      if (r.top < innerHeight * 0.5) ceiling = Math.max(ceiling, r.bottom);
      else below.push(r);
    }
    // Over whatever is in the way, then over whatever that lift runs into (a table's tray with the
    // hands picker stacked over it, on a phone on its side), until nothing is.
    for (let moved = true, n = 0; moved && n < 8; n++) {
      moved = false;
      for (const r of below) {
        if (r.bottom > top - lift && r.top < bottom - lift) {
          lift = bottom - r.top + GAP;
          moved = true;
        }
      }
    }
    let room = bottom - lift - ceiling - GAP;
    const least = height - log + MIN_LOG;
    if (lift && ceiling && room < least) {
      lift = 0;
      room = bottom - ceiling - GAP;
    }
    this.root.style.setProperty('--chat-lift', `${Math.round(lift)}px`);
    this.root.style.setProperty('--chat-log-max', ceiling && room < height ? `${Math.round(Math.max(MIN_LOG, room - (height - log)))}px` : 'none');
  };
}

/**
 * A button in the panel that shouldn't take focus from the line when pressed while typing: a tab
 * switches rooms mid-sentence, and on a phone losing focus would drop the keyboard.
 */
function keepTyping(b: HTMLElement): void {
  b.addEventListener('pointerdown', (e) => {
    if (document.activeElement?.classList.contains('chat-input')) e.preventDefault();
  });
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

function icon(name: 'chat' | 'muted' | 'shown' | 'hidden' | 'down' | 'send' | 'pin'): SVGSVGElement {
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
    case 'shown':
    case 'hidden':
      path('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z');
      path('M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 1 0 0-5.6z');
      if (name === 'hidden') path('M4 3.5l16.5 17');
      break;
    case 'down':
      path('M6.5 9.5l5.5 5.5 5.5-5.5');
      break;
    case 'send':
      path('M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5');
      break;
    case 'pin':
      // a push pin, its point down
      path('M9 3.5h6M10 3.5l-.6 6L6.5 13h11l-2.9-3.5-.6-6');
      path('M12 13v7.5');
      break;
  }
  return s;
}
