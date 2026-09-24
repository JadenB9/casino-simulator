// Chat rooms: the floor's (everyone connected to the floor) and each lobby table's (its members).
//
// Text only. Every line goes through cleanChat (shared/src/protocol.ts: control and invisible
// characters out, 1 to 200 characters), has a short list of words masked, and is signed with
// the name the Worker put on the connection from the token, never one the client sends. The last
// CHAT_HISTORY lines live in the object's SQLite, so a room that hibernates or restarts still
// has them for whoever arrives next.
//
// Limits are per account rather than per socket, so reconnecting doesn't refill them: three
// lines in a burst, then one a second. A line over the limit is refused with a notice and is a
// strike; STRIKES of those close together mute the account for a minute, doubling with each
// mute after that within a day. Mutes are stored, so they outlast a reconnect and hibernation.
// Buckets and strikes live in memory, like every other bucket here (ratelimit.ts).
//
// The floor's socket plumbing is FloorChat, at the bottom; tables use ChatRoom directly
// (table/host.ts).

import { CHAT_BURST, CHAT_HISTORY, CHAT_MAX, CHAT_PER_S, CLOSE, cleanChat, type ChatLine, type ChatServerMsg, type FloorServerMsg } from '../../../shared/src/protocol.ts';
import { Bucket } from '../ratelimit.ts';
import type { FloorAtt } from './presence.ts';

export { CHAT_BURST, CHAT_PER_S };
/** Refused lines that earn a mute, when each comes within STRIKE_MS of the one before. */
export const STRIKES = 5;
export const STRIKE_MS = 30_000;
/** The first mute; each one after it within MUTE_MEMORY_MS lasts twice as long, up to MUTE_MAX_MS. */
export const MUTE_MS = 60_000;
const MUTE_MAX_MS = 16 * 60_000;
const MUTE_MEMORY_MS = 24 * 60 * 60_000;
/** Lines sent while muted before the socket is closed: a client that ignores the notice. */
export const FLOOD = 40;
/** Accounts whose limits are kept in memory before idle ones are forgotten. */
const LIMITS_KEPT = 256;
const LIMIT_IDLE_MS = 5 * 60_000;

export type ChatNotice = Extract<ChatServerMsg, { t: 'chat.no' }>;
export type SayResult = { ok: true; line: ChatLine } | { ok: false; notice: ChatNotice; close?: true };

interface Limit {
  bucket: Bucket;
  strikes: number;
  strikeAt: number;
  flood: number;
  usedAt: number;
}

export class ChatRoom {
  private ready = false;
  private readonly limits = new Map<number, Limit>();

  constructor(private readonly sql: SqlStorage) {}

  /** The room's last CHAT_HISTORY lines, oldest first. */
  backlog(): ChatLine[] {
    this.ensure();
    return this.sql
      .exec<{ n: number; account_id: number; name: string; text: string; at: number }>(
        `SELECT n, account_id, name, text, at FROM chat_lines ORDER BY n DESC LIMIT ?1`,
        CHAT_HISTORY,
      )
      .toArray()
      .reverse()
      .map((r) => ({ n: r.n, id: r.account_id, name: r.name, text: r.text, at: r.at }));
  }

  /** Take a line from `who`: the line to hand to the room, or the notice for the sender alone. */
  say(who: { id: number; name: string }, raw: string, now = Date.now()): SayResult {
    this.ensure();
    const lim = this.limitOf(who.id, now);
    const muted = this.mutedUntil(who.id, now);
    if (muted) {
      if (++lim.flood > FLOOD) return { ok: false, notice: mutedNotice(muted, now), close: true };
      return { ok: false, notice: mutedNotice(muted, now) };
    }
    // Every attempt costs a token, a malformed one too.
    if (!lim.bucket.take()) {
      lim.strikes = now - lim.strikeAt > STRIKE_MS ? 1 : lim.strikes + 1;
      lim.strikeAt = now;
      if (lim.strikes >= STRIKES) {
        lim.strikes = 0;
        return { ok: false, notice: mutedNotice(this.mute(who.id, now), now) };
      }
      return { ok: false, notice: { t: 'chat.no', code: 'RATE_LIMITED', msg: 'Slow down: one line a second.', now } };
    }
    lim.flood = 0;
    const text = cleanChat(raw);
    if (text === null) return { ok: false, notice: { t: 'chat.no', code: 'BAD_REQUEST', msg: `Lines are 1 to ${CHAT_MAX} characters.`, now } };
    const n = (this.sql.exec<{ n: number | null }>(`SELECT max(n) AS n FROM chat_lines`).one().n ?? 0) + 1;
    const line: ChatLine = { n, id: who.id, name: who.name, text: maskWords(text), at: now };
    this.sql.exec(`INSERT INTO chat_lines (n, account_id, name, text, at) VALUES (?1, ?2, ?3, ?4, ?5)`, n, who.id, who.name, line.text, now);
    this.sql.exec(`DELETE FROM chat_lines WHERE n <= ?1`, n - CHAT_HISTORY);
    return { ok: true, line };
  }

  /** When this account's mute ends, or 0 if it isn't muted. */
  mutedUntil(accountId: number, now = Date.now()): number {
    this.ensure();
    return this.sql.exec<{ until: number }>(`SELECT until FROM chat_mutes WHERE account_id = ?1 AND until > ?2`, accountId, now).toArray()[0]?.until ?? 0;
  }

  // Created on first use rather than up front: a table id that is only ever probed stays empty.
  private ensure(): void {
    if (this.ready) return;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chat_lines (
      n INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS chat_mutes (account_id INTEGER PRIMARY KEY, until INTEGER NOT NULL, n INTEGER NOT NULL)`);
    this.ready = true;
  }

  private mute(accountId: number, now: number): number {
    this.sql.exec(`DELETE FROM chat_mutes WHERE until < ?1`, now - MUTE_MEMORY_MS);
    const prev = this.sql.exec<{ n: number }>(`SELECT n FROM chat_mutes WHERE account_id = ?1`, accountId).toArray()[0];
    const n = (prev?.n ?? 0) + 1;
    const until = now + Math.min(MUTE_MAX_MS, MUTE_MS * 2 ** (n - 1));
    this.sql.exec(`INSERT OR REPLACE INTO chat_mutes (account_id, until, n) VALUES (?1, ?2, ?3)`, accountId, until, n);
    return until;
  }

  private limitOf(accountId: number, now: number): Limit {
    let lim = this.limits.get(accountId);
    if (!lim) {
      if (this.limits.size >= LIMITS_KEPT) {
        for (const [id, l] of this.limits) if (now - l.usedAt > LIMIT_IDLE_MS) this.limits.delete(id);
      }
      lim = { bucket: new Bucket(CHAT_BURST, CHAT_PER_S), strikes: 0, strikeAt: 0, flood: 0, usedAt: now };
      this.limits.set(accountId, lim);
    }
    lim.usedAt = now;
    return lim;
  }
}

function mutedNotice(until: number, now: number): ChatNotice {
  const min = Math.max(1, Math.round((until - now) / 60_000));
  return { t: 'chat.no', code: 'MUTED', msg: `Muted for ${min === 1 ? 'a minute' : `${min} minutes`}: too many lines too fast.`, until, now };
}

// ---------------------------------------------------------------------------------------------
// The word mask. A short list, matched per word, where a few digits and symbols stand in for
// letters ("sh1t", "a$$") and letters may be stretched ("fuuuck"). Most entries must be the whole
// word, give or take the prefixes and endings listed with them, so "class", "Scunthorpe",
// "spicy", "cocktail" and "Cushite" are left alone; such a word is masked after its first
// letter. Three are masked wherever they appear inside a word ("motherf***er"). Checked against
// a 236,000-word dictionary: what it masks there is the listed words and their own derivatives.
// Kept in ROT13 so the source doesn't read as a list of slurs.

const rot13 = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 84) % 26) + 97));

/**
 * A root's letters, stretchable: a letter the root has once matches once or three and more times,
 * a doubled one twice or more. Exactly two of a single letter is more often a real spelling
 * (Shiite, shiitake) than a stretch, so it doesn't count.
 */
const stretch = (root: string) => root.replace(/(.)\1*/g, (run, c: string) => (run.length === 1 ? `(?:${c}|${c}{3,})` : `${c}{${run.length},}`));

const ANYWHERE = new RegExp(['shpx', 'ovgpu', 'juber'].map((w) => stretch(rot13(w))).join('|'), 'g');
/** "prefixes>root:endings", either side optional. */
const WHOLE = [
  'ohyy|ubefr|qvc|ncr|ong|puvpxra|ubyl|qhzo|qbt|pbj>fuvg:f|r|rf|gl|gvre|gvrfg|gvat|grq|gre|gref|urnq|urnqf|ubyr|ubyrf|fubj|fubjf|fgbez|fgbezf|ont|ontf|snpr|snprq|ybnq|ybnqf|yrff|cbfg|gnyx',
  'phag:f', 'nff:rf|ubyr|ubyrf|ung|ungf|jvcr|jvcrf', 'qvpx:f|urnq|urnqf', 'pbpx:f|fhpxre|fhpxref', 'chffl', 'chffvrf',
  'fyhg:f|gl', 'onfgneq:f', 'gjng:f', 'jnaxre:f', 'cvff:rq|rf|re|vat', 'avttre:f', 'avttn:f|m', 'snttbg:f', 'snt:f',
  'ergneq:f|rq', 'xvxr:f', 'fcvp:f', 'genaal', 'genaavrf', 'qlxr:f',
].map((entry) => {
  const [head, endings] = rot13(entry).split(':') as [string, string | undefined];
  const [prefixes, root] = head.includes('>') ? (head.split('>') as [string, string]) : [undefined, head];
  return new RegExp(`^${prefixes ? `(?:${prefixes})?` : ''}${stretch(root)}${endings ? `(?:${endings})?` : ''}$`);
});

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's' };
const WORD = /[\p{L}\p{M}\p{N}@$]+/gu;

/** `text` with listed words masked: letters after the first become "*". */
export function maskWords(text: string): string {
  return text.replace(WORD, (word) => {
    const chars = [...word];
    // One UTF-16 unit per character, so a match's index is the character's index.
    const flat = chars
      .map((c) => {
        const low = c.toLowerCase();
        const m = LEET[low] ?? low;
        return m.length === 1 ? m : '#';
      })
      .join('');
    const hide = new Set<number>();
    if (WHOLE.some((re) => re.test(flat))) for (let i = 1; i < chars.length; i++) hide.add(i);
    for (const m of flat.matchAll(ANYWHERE)) for (let i = m.index + 1; i < m.index + m[0].length; i++) hide.add(i);
    return hide.size ? chars.map((c, i) => (hide.has(i) ? '*' : c)).join('') : word;
  });
}

// ---------------------------------------------------------------------------------------------
// The floor's room: every socket on the floor hears it.

export class FloorChat {
  readonly room: ChatRoom;

  constructor(
    ctx: DurableObjectState,
    private readonly broadcast: (msg: FloorServerMsg) => void,
  ) {
    this.room = new ChatRoom(ctx.storage.sql);
  }

  /** A new floor socket gets the room's last lines, right after its hello. */
  join(ws: WebSocket): void {
    send(ws, { t: 'chat', lines: this.room.backlog(), backlog: true });
  }

  say(ws: WebSocket, text: string): void {
    const att = ws.deserializeAttachment() as FloorAtt | null;
    if (!att) return;
    const out = this.room.say({ id: att.accountId, name: att.name }, text);
    if (out.ok) {
      this.broadcast({ t: 'chat', lines: [out.line] });
      return;
    }
    send(ws, out.notice);
    if (out.close) ws.close(CLOSE.RATE_LIMITED, 'slow down');
  }
}

function send(ws: WebSocket, msg: FloorServerMsg): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* closing */
  }
}
