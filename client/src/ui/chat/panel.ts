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
// there. Lines from one person in a row run on under one name; each line's time shows on hover; a
// line that mentions you (your name as a word, or @name) is lit, and the dock says one is waiting;
// a name in the log is a quick reply (@name in the line); scrolled up, new lines raise a pill that
// jumps to them. A row of quick emotes sits over the line: your starred ones from the wheel (the
// first four everyone has until you star any), one click each. Names and lines go in with
// textContent only.

import './chat.css';
import { CHAT_MAX, cleanChat, type ChatLine, type ChatServerMsg, type EmoteId } from '../../../../shared/src/protocol.ts';
import { isFreeEmote } from '../../../../shared/src/items.ts';
import { FAV_DEFAULT, emoteGate, favourites, noteEmote, onFavourites } from '../social/favourites.ts';
import { EMOTE_LABELS, emoteGlyph } from '../social/icons.ts';
import { el } from '../kit.ts';
import { holdKeyboard, isTyping, overlayCount } from '../keyboard.ts';
import { RoomLog, SendGate, chatLook, continues, mentions, nameHue, type RoomId } from './model.ts';
import { isKey, keyLabel, keyed } from '../keys.ts';

/** Where a room's lines go out: FloorLink.say, or the table socket. False while it's down. */
export interface RoomLink {
  say(text: string): boolean;
}

export interface PanelDeps {
  root: HTMLElement;
  floor: RoomLink;
  /** Your account id, to tell your own lines apart. */
  me(): number | null;
  /** Your name, to light up the lines that mention you. */
  myName?(): string | null;
  /** The hide-chat switch changed. */
  onMute?(muted: boolean): void;
  /** Make an emote (the quick row); none: no row. False while the floor is down. */
  emote?(e: EmoteId): boolean;
  /** Every item and emote id you have, and a way to hear when that changes (the quick row shows only yours). */
  owned?(): Iterable<string> | undefined;
  onOwned?(fn: () => void): () => void;
}

/** Previews shown above the closed dock, and for how long. */
const PEEKS = 3;
const PEEK_MS = 6000;
/** The counter shows from this many characters on. */
const COUNT_FROM = 150;
/**
 * Space kept between the chat and a table's panels, and the least log it will shrink to (px): two
 * lines, so on a short screen (a phone on its side, a table's tray and tip panel under it) the box
 * still fits between the table's bar and the HUD rather than coming down over the bar.
 */
const GAP = 10;
const MIN_LOG = 44;
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
  /** The newest line drawn, for running the next one on under the same name. */
  last: ChatLine | null;
}

export class ChatPanel {
  readonly root = el('section', 'chat pass');
  muted = load(MUTED_KEY) === '1';
  private readonly dock = el('button', 'chat-dock');
  private readonly dockBadge = el('span', 'chat-badge');
  private offKeys: () => void = () => {};
  private readonly box = el('div', 'chat-box');
  private readonly peeks = el('div', 'chat-peeks');
  private readonly scroller = el('div', 'chat-log');
  private readonly input = el('input', 'chat-input');
  private readonly status = el('span', 'chat-status');
  private readonly muteBtn = el('button', 'chat-icon chat-mute');
  private readonly pinBtn = el('button', 'chat-icon chat-pin');
  /** Scrolled up, "3 new": a click goes down to them. */
  private readonly jump = el('button', 'chat-jump');
  /** Your starred emotes, over the line. */
  private readonly quick = el('div', 'chat-quick');
  /** Lines the active room had while you were scrolled up. */
  private unseen = 0;
  private readonly peekTimers = new Set<number>();
  /** The corner's place as last written (--chat-lift, --chat-log-max), so an unchanged one isn't. */
  private placed = '';
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
    const kc = el('kbd', 'chat-kc');
    this.offKeys = keyed(() => {
      kc.textContent = keyLabel('chat');
      this.dock.title = `Chat (${keyLabel('chat')} or Enter)`;
    });
    this.dock.append(icon('chat'), el('span', 'chat-dock-label', 'Chat'), this.dockBadge, kc);
    // Idle on a touch screen the dock stays under the log: a tap there starts typing.
    // (v7.2: on a touch screen the chat button closes an open chat again; with a keyboard it goes to the box)
    this.dock.addEventListener('click', () => (!this.open ? this.show(true, true) : touchScreen() ? this.show(false) : this.focus()));

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
      return { log: new RoomLog(), list, tab, badge, last: null };
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
    this.jump.type = 'button';
    this.jump.hidden = true;
    this.jump.addEventListener('click', () => this.toBottom());
    keepTyping(this.jump);
    this.scroller.addEventListener('scroll', () => this.unseen > 0 && this.atBottom() && this.seen(), { passive: true });
    this.quick.setAttribute('role', 'group');
    this.quick.setAttribute('aria-label', 'Quick emotes');
    this.quick.hidden = !deps.emote;
    if (deps.emote) {
      this.paintQuick();
      this.offs.push(onFavourites(() => this.paintQuick()));
      if (deps.onOwned) this.offs.push(deps.onOwned(() => this.paintQuick()));
    }
    // the pill hangs from the log's bottom edge, whatever is under it
    const jumpAt = el('div', 'chat-jump-at');
    jumpAt.append(this.jump);
    this.box.append(head, this.scroller, jumpAt, this.quick, line);
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
      // A click somewhere in the box (the log, say) keeps it up for now; only the pin keeps it up
      // for good (v7: a click inside used to pin it without saying so).
      if (this.pressing) return;
      if (!(e.relatedTarget instanceof Node && root.contains(e.relatedTarget))) this.afterTyping();
    });
    root.addEventListener('pointerdown', () => (this.pressing = true));
    // v7: unpinned, a click anywhere outside the chat puts it away
    const outside = (e: PointerEvent) => {
      if (!this.visible || !this.open || this.pinned || this.mutedLeft() > 0) return;
      if (e.target instanceof Node && root.contains(e.target)) return;
      this.input.blur();
      this.show(false);
      this.paintLook();
    };
    addEventListener('pointerdown', outside, true);
    this.offs.push(() => removeEventListener('pointerdown', outside, true));
    const up = () => (this.pressing = false);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('keydown', this.onKey);
    addEventListener('resize', this.place);
    // A table's panels mounting or going (the UI root's own children): placed again on the next
    // frame, not only on the poll. Only that one level is watched, so it costs nothing per frame.
    let queued = 0;
    const watch = new MutationObserver(() => {
      if (queued || !this.visible) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        this.place();
      });
    });
    watch.observe(deps.root, { childList: true });
    this.offs.push(() => {
      watch.disconnect();
      cancelAnimationFrame(queued);
    });
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
    t.last = null;
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
    const me = this.deps.me();
    const fresh = room.log.take(msg.lines, msg.backlog === true, me, reading, (l) => this.forMe(l));
    if (!fresh.length) return fresh;
    // The room began again (its backlog is older than what we had): draw it from scratch.
    if (room.log.epoch !== epoch) {
      room.list.replaceChildren(el('p', 'chat-note', NOTES[id]));
      room.last = null;
    }
    for (const line of fresh) room.list.append(this.lineEl(line, room, msg.backlog !== true));
    trim(room.list);
    if (id === this.active) {
      if (stick || fresh.some((l) => l.id === me)) this.toBottom();
      else if (this.open) {
        // scrolled up reading something older: say what came in below
        this.unseen += fresh.filter((l) => l.id !== me).length;
        this.paintJump();
      }
    }
    this.paintBadges();
    if (!this.open && !msg.backlog && !this.muted && this.visible) {
      for (const line of fresh) if (line.id !== me) this.peek(line, id);
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
    this.offKeys();
    this.input.blur();
    this.release?.();
    this.release = null;
    clearTimeout(this.statusTimer);
    clearInterval(this.muteTimer);
    clearInterval(this.placeTimer);
    for (const t of this.peekTimers) clearTimeout(t);
    this.peekTimers.clear();
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
    if (!isKey(e, 'chat') && e.key !== 'Enter') return;
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

  private lineEl(line: ChatLine, room: Room, live: boolean): HTMLElement {
    const mine = line.id === this.deps.me();
    const p = el('p', 'chat-line');
    // a line said just now fades up once (not a backlog's, and not again when its room is shown)
    if (live) {
      p.classList.add('new');
      p.addEventListener('animationend', () => p.classList.remove('new'), { once: true });
    }
    // the same speaker again, straight after: the name stays for screen readers, out of sight
    const before = room.list.lastElementChild;
    if (continues(room.last, line) && before?.classList.contains('chat-line') && !before.classList.contains('chat-sys')) p.classList.add('cont');
    room.last = line;
    const hue = `chat-name ${mine ? 'me' : `hue${nameHue(line.name)}`}`;
    let name: HTMLElement;
    if (mine) name = el('span', hue, line.name);
    else {
      // a quick reply: @name in the line (not a tab stop: typing the name does the same)
      const b = el('button', hue, line.name);
      b.type = 'button';
      b.tabIndex = -1;
      b.title = `Reply to ${line.name}`;
      b.addEventListener('click', () => this.replyTo(line.name));
      keepTyping(b);
      name = b;
    }
    const text = el('span', 'chat-text');
    const spans = mine ? [] : mentions(line.text, this.deps.myName?.() ?? '');
    if (spans.length) {
      p.classList.add('mention');
      marked(text, line.text, spans);
    } else text.textContent = line.text;
    p.append(name, text);
    // shown on hover by the CSS (not part of the line's text)
    p.dataset.time = new Date(line.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return p;
  }

  /** Someone else's line that mentions you. */
  private forMe(l: ChatLine): boolean {
    return l.id !== this.deps.me() && mentions(l.text, this.deps.myName?.() ?? '').length > 0;
  }

  /** Start a reply to `name`: the box open, "@name " at the start of the line. */
  private replyTo(name: string): void {
    this.focus();
    if (this.input.disabled) return;
    const tag = `@${name} `;
    const rest = this.input.value.replace(/^@[A-Za-z0-9_]+\s*/, '');
    this.input.value = (tag + rest).slice(0, CHAT_MAX);
    const end = this.input.value.length;
    this.input.setSelectionRange(end, end);
    this.showCount();
  }

  /** The quick emotes: your starred ones that you have (the default four if none are). */
  private paintQuick(): void {
    const have = new Set(this.deps.owned?.() ?? []);
    const mine = (e: EmoteId) => isFreeEmote(e) || have.has(e);
    let picks = favourites().filter(mine);
    if (picks.length === 0) picks = [...FAV_DEFAULT];
    // (the profile changes with every round's balance: redrawn only when the picks do)
    if (picks.join() === this.quick.dataset.picks) return;
    this.quick.dataset.picks = picks.join();
    const buttons = picks.map((e) => {
      const b = el('button', 'chat-emo');
      b.type = 'button';
      const name = EMOTE_LABELS[e] ?? e;
      b.title = name;
      b.setAttribute('aria-label', `${name} (emote)`);
      b.append(emoteGlyph(e));
      b.addEventListener('click', () => this.emote(e));
      keepTyping(b);
      return b;
    });
    const hint = el('span', 'chat-quick-hint', 'Star more on the wheel');
    hint.title = 'Open the emote wheel and press F on one to star it';
    this.quick.replaceChildren(...buttons, hint);
  }

  private emote(e: EmoteId): void {
    if (!emoteGate.take()) {
      this.flash('One moment');
      return;
    }
    if (this.deps.emote?.(e)) noteEmote(e);
    else this.flash('Not connected');
  }

  /** The newest lines are in view: the pill goes. */
  private seen(): void {
    if (this.unseen === 0) return;
    this.unseen = 0;
    this.paintJump();
  }

  private paintJump(): void {
    this.jump.hidden = this.unseen === 0;
    if (this.unseen === 0) return;
    this.jump.replaceChildren(icon('down'), el('span', '', `${this.unseen > 99 ? '99+' : this.unseen} new`));
    this.jump.setAttribute('aria-label', `${this.unseen} new ${this.unseen === 1 ? 'line' : 'lines'}: go to the newest`);
  }

  /** A line from the game itself (a refusal), in that room's log. */
  private system(id: RoomId, text: string): void {
    const room = this.rooms[id];
    // The same refusal again (a burst of them) says nothing new.
    const last = room.list.lastElementChild;
    if (last?.classList.contains('chat-sys') && last.textContent === text) return;
    room.list.append(el('p', 'chat-line chat-sys', text));
    room.last = null;
    trim(room.list);
    if (id === this.active) this.toBottom();
    if (!this.open && this.visible) this.peek(null, id, text);
  }

  private peek(line: ChatLine | null, id: RoomId, text?: string): void {
    const p = el('div', `chat-peek${line ? '' : ' chat-sys'}${line && this.forMe(line) ? ' mention' : ''}`);
    if (line) {
      if (id === 'table') p.append(el('span', 'chat-peek-room', 'Table'));
      p.append(el('span', `chat-name hue${nameHue(line.name)}`, line.name), el('span', 'chat-text', line.text));
    } else {
      p.textContent = text ?? '';
    }
    this.peeks.append(p);
    while (this.peeks.childElementCount > PEEKS) this.peeks.firstElementChild!.remove();
    const out = window.setTimeout(() => {
      this.peekTimers.delete(out);
      p.classList.add('out');
      const gone = window.setTimeout(() => {
        this.peekTimers.delete(gone);
        p.remove();
      }, 350);
      this.peekTimers.add(gone);
    }, PEEK_MS);
    this.peekTimers.add(out);
  }

  private read(id: RoomId): void {
    this.rooms[id].log.read();
    this.paintBadges();
  }

  private paintBadges(): void {
    let total = 0;
    let forMe = 0;
    for (const room of Object.values(this.rooms)) {
      const off = this.muted || room.tab.hidden;
      const n = off ? 0 : room.log.unread;
      const at = off ? 0 : room.log.mentions;
      total += n;
      forMe += at;
      room.badge.hidden = n === 0;
      room.badge.textContent = n > 99 ? '99+' : String(n);
      room.badge.classList.toggle('at', at > 0);
    }
    this.dockBadge.hidden = total === 0;
    this.dockBadge.textContent = total > 99 ? '99+' : String(total);
    // a line for you among them: the badge turns (its number stays the count)
    this.dockBadge.classList.toggle('at', forMe > 0);
    this.dock.setAttribute('aria-label', total ? `Chat, ${total} unread${forMe ? `, ${forMe} for you` : ''}` : 'Chat');
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
    this.seen();
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
    // the HUD along the top is a ceiling too (it is no .panel): the box never reaches into it
    const hud = this.deps.root.querySelector<HTMLElement>('.hud')?.getBoundingClientRect();
    let ceiling = hud && hud.height > 0 ? hud.bottom : 0;
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
    const liftPx = `${Math.round(lift)}px`;
    const logMax = ceiling && room < height ? `${Math.round(Math.max(MIN_LOG, room - (height - log)))}px` : 'none';
    if (`${liftPx} ${logMax}` === this.placed) return;
    this.placed = `${liftPx} ${logMax}`;
    this.root.style.setProperty('--chat-lift', liftPx);
    this.root.style.setProperty('--chat-log-max', logMax);
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
  if (list.childElementCount <= 170) return;
  while (list.childElementCount > 170) list.children[1]!.remove();
  // the first line left has lost the one it ran on from: it shows its name again
  list.children[1]?.classList.remove('cont');
}

/** `text` into `into`, the spans in `at` as <mark>s (text nodes only, never markup). */
function marked(into: HTMLElement, text: string, at: [number, number][]): void {
  let i = 0;
  for (const [a, b] of at) {
    if (a > i) into.append(document.createTextNode(text.slice(i, a)));
    into.append(el('mark', 'chat-at', text.slice(a, b)));
    i = b;
  }
  if (i < text.length) into.append(document.createTextNode(text.slice(i)));
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

/** A touch screen in use (the floor's touch controls are on), or a coarse pointer at all. */
function touchScreen(): boolean {
  return document.documentElement.classList.contains('touch-ui') || matchMedia('(pointer: coarse)').matches;
}
