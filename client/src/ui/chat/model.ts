// The chat's state, without the DOM: each room's lines and what's unread in it, and the send
// limit the client keeps so it never sends a line the server would refuse.

import { CHAT_BURST, CHAT_PER_S, type ChatLine } from '../../../../shared/src/protocol.ts';

export type RoomId = 'floor' | 'table';

/** Lines each room keeps on the client (the server keeps CHAT_HISTORY for newcomers). */
export const KEEP = 150;

export class RoomLog {
  readonly lines: ChatLine[] = [];
  unread = 0;
  /** Of the unread, the lines that mention you. */
  mentions = 0;
  /** Counts clears: a log drawn at an older epoch has to be drawn again from `lines`. */
  epoch = 0;
  /** The newest line's number: a backlog after a reconnect skips everything up to it. */
  private last = 0;

  /**
   * Take lines from the socket and return the ones not seen before, oldest first. The backlog a
   * room sends on joining is context, so the first one counts nothing as unread; a later one
   * (after a reconnect) is what was missed meanwhile, and counts. Your own lines never do, and
   * nothing does while you're `reading` this room.
   */
  take(lines: readonly ChatLine[], backlog: boolean, me: number | null, reading: boolean, forMe?: (l: ChatLine) => boolean): ChatLine[] {
    // A backlog that ends before our newest line is a different room (the storage was reset).
    if (backlog && lines.length && lines[lines.length - 1]!.n < this.last) this.clear();
    const first = this.last === 0;
    const fresh = lines.filter((l) => l.n > this.last);
    if (!fresh.length) return fresh;
    this.last = fresh[fresh.length - 1]!.n;
    this.lines.push(...fresh);
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
    if (!reading && !(backlog && first)) {
      const others = fresh.filter((l) => l.id !== me);
      this.unread += others.length;
      if (forMe) this.mentions += others.filter(forMe).length;
    }
    return fresh;
  }

  /** Everything read (the room is open in front of you). */
  read(): void {
    this.unread = 0;
    this.mentions = 0;
  }

  clear(): void {
    this.lines.length = 0;
    this.unread = 0;
    this.mentions = 0;
    this.last = 0;
    this.epoch++;
  }
}

/**
 * The server's limit, kept on this side a little slower (network jitter can bunch two lines up),
 * so a fast typist is told to wait instead of earning a strike toward a mute.
 */
export class SendGate {
  private tokens: number;
  private at: number;

  constructor(
    private readonly burst = CHAT_BURST,
    private readonly perSecond = CHAT_PER_S * 0.9,
    now = performance.now(),
  ) {
    this.tokens = burst;
    this.at = now;
  }

  take(now = performance.now()): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Milliseconds until a line may go. */
  wait(now = performance.now()): number {
    this.refill(now);
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.perSecond) * 1000);
  }

  private refill(now: number): void {
    this.tokens = Math.min(this.burst, this.tokens + (Math.max(0, now - this.at) / 1000) * this.perSecond);
    this.at = now;
  }
}

/** Lines from one person this close together run on under one name. */
export const GROUP_MS = 2 * 60_000;

/** Whether `line` runs on from `prev` under its name: the same speaker, said within GROUP_MS. */
export function continues(prev: Pick<ChatLine, 'id' | 'at'> | null, line: Pick<ChatLine, 'id' | 'at'>): boolean {
  return prev !== null && prev.id === line.id && line.at - prev.at >= 0 && line.at - prev.at < GROUP_MS;
}

/**
 * Where `text` mentions `name`: the name as a word of its own (names are letters, digits and _),
 * with or without an @ before it, in any case. Start and end offsets of each, for lighting them up.
 */
export function mentions(text: string, name: string): [number, number][] {
  if (!name) return [];
  const safe = name.replace(/[^A-Za-z0-9_]/g, (c) => `\\${c}`);
  const re = new RegExp(`(^|[^A-Za-z0-9_@])(@?${safe})(?![A-Za-z0-9_])`, 'gi');
  const out: [number, number][] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[1]!.length;
    out.push([start, start + m[2]!.length]);
  }
  return out;
}

/** A name's colour, one of six, the same on every screen. */
export function nameHue(name: string): number {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 6;
}

/** How long a speech bubble stays up, in seconds: longer lines are up longer. */
export function sayFor(text: string): number {
  return Math.min(9, Math.max(4, 3 + [...text].length * 0.06));
}

/**
 * What the chat's corner shows: nothing (off the floor), the dock alone, the whole box (typing,
 * or opened for a moment and not pinned), or `idle`: pinned open while you walk, look round, sit
 * and play, the log left up where clicks and drags go through it to the game.
 */
export type ChatLook = 'hidden' | 'dock' | 'box' | 'idle';

export function chatLook(s: { visible: boolean; open: boolean; pinned: boolean; typing: boolean }): ChatLook {
  if (!s.visible) return 'hidden';
  if (!s.open) return 'dock';
  return s.pinned && !s.typing ? 'idle' : 'box';
}
