// The chat's state, without the DOM: each room's lines and what's unread in it, and the send
// limit the client keeps so it never sends a line the server would refuse.

import { CHAT_BURST, CHAT_PER_S, type ChatLine } from '../../../../shared/src/protocol.ts';

export type RoomId = 'floor' | 'table';

/** Lines each room keeps on the client (the server keeps CHAT_HISTORY for newcomers). */
export const KEEP = 150;

export class RoomLog {
  readonly lines: ChatLine[] = [];
  unread = 0;
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
  take(lines: readonly ChatLine[], backlog: boolean, me: number | null, reading: boolean): ChatLine[] {
    // A backlog that ends before our newest line is a different room (the storage was reset).
    if (backlog && lines.length && lines[lines.length - 1]!.n < this.last) this.clear();
    const first = this.last === 0;
    const fresh = lines.filter((l) => l.n > this.last);
    if (!fresh.length) return fresh;
    this.last = fresh[fresh.length - 1]!.n;
    this.lines.push(...fresh);
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
    if (!reading && !(backlog && first)) this.unread += fresh.filter((l) => l.id !== me).length;
    return fresh;
  }

  clear(): void {
    this.lines.length = 0;
    this.unread = 0;
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
