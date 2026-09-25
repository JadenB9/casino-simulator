// v6 invite6: invites to a lobby table. A player at a lobby table names players on the floor (or
// says everyone); the floor checks the table is real and open, that a private one's PIN is right,
// and hands each invitee who is here, at the keyboard and taking invites a card to click. Joining
// comes back here: the invite must be theirs and still good, and the table open with room; then
// the floor puts them beside it and gives them the table, with a private table's PIN. The PIN only
// ever leaves in that answer, so nobody gets it without an invite, and an invite can't be made up:
// it is a row in this object's SQLite that only the floor writes.
//
// Like the directory's limits, everything is in SQLite: the floor hibernates, and a limit kept in
// memory would forget itself every time it slept.

import { INVITE_MAX_TO, INVITE_MS, type ErrorCode, type FloorServerMsg, type Invite, type InviteClientMsg, type InviteSkip, type LobbySummary } from '../../../shared/src/protocol.ts';
import { CATALOG, TABLE_ID_RE } from '../../../shared/src/games/catalog.ts';
import type { GameId } from '../../../shared/src/engine.ts';
import { ZONES, clampTo, inRect } from '../../../shared/src/zones.ts';
import type { FloorAtt, Presence } from './presence.ts';
import type { Directory } from './directory.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Invites one player may send: a few a minute, and a cap an hour. */
export const SEND_LIMITS: readonly (readonly [n: number, ms: number])[] = [[6, MINUTE], [40, HOUR]];
/** "Invite everyone": once in this long per player, and per table. */
export const EVERYONE_MS = 3 * MINUTE;
/** The same player invited by the same person again this soon is skipped ("recent"). */
export const PAIR_MS = 45_000;
/** Invites one player can receive a minute, from everyone together; past it they're "busy". */
export const TARGET_PER_MIN = 6;
/** Joins one player may try a minute (each one asks the table how it stands). */
export const TAKE_PER_MIN = 10;
/** Nothing from a player for this long and they're away: invites pass them by. */
export const AWAY_MS = 5 * MINUTE;
/** A join lands where the invitee asked if it is this close to the inviter (cm); otherwise next to the inviter. */
export const NEAR_CM = 1000;

export interface InviteDeps {
  presence: Presence;
  directory: Directory;
  /** The table's list row (null: no such lobby, or closed), asked of the table itself. */
  summary(tableId: string): Promise<LobbySummary | null>;
  /** The open floor sockets of one account. */
  socketsOf(accountId: number): WebSocket[];
  /** Every open floor socket. */
  sockets(): WebSocket[];
}

export class Invites {
  private readonly sql: SqlStorage;

  constructor(
    ctx: DurableObjectState,
    private readonly deps: InviteDeps,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY, from_id INTEGER NOT NULL, table_id TEXT NOT NULL, game TEXT NOT NULL, station TEXT, until INTEGER NOT NULL) WITHOUT ROWID`);
    // who each invite reached: only they can join with it
    this.sql.exec(`CREATE TABLE IF NOT EXISTS invite_to (invite_id TEXT NOT NULL, account_id INTEGER NOT NULL, PRIMARY KEY (invite_id, account_id)) WITHOUT ROWID`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS invite_dnd (account_id INTEGER PRIMARY KEY)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS invite_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, until INTEGER NOT NULL) WITHOUT ROWID`);
  }

  /** A client's invite message. */
  async onMessage(ws: WebSocket, msg: InviteClientMsg, now = Date.now()): Promise<void> {
    const att = ws.deserializeAttachment() as FloorAtt | null;
    if (!att) return;
    if (msg.t === 'invite.dnd') return this.setDnd(att.accountId, msg.on);
    if (msg.t === 'invite') return this.invite(ws, att, msg, now);
    return this.take(ws, att, msg, now);
  }

  // --- sending --------------------------------------------------------------------------------

  private async invite(ws: WebSocket, att: FloorAtt, msg: Extract<InviteClientMsg, { t: 'invite' }>, now: number): Promise<void> {
    const me = att.accountId;
    const all = msg.to === 'all';
    const no = (code: ErrorCode, text: string, again?: number) =>
      send(ws, { t: 'invite.no', table: msg.table, code, msg: text, ...(again ? { again } : {}) });
    const game = gameOfTable(msg.table);
    if (!game || !CATALOG[game].multiplayer) return no('NOT_FOUND', 'That table has closed.');
    this.purge(now);
    // "Everyone" is checked first and only used up by an invite that goes out; the plain limits
    // count every attempt, so guessing at tables or PINs through here is as slow as anywhere.
    if (all) {
      const again = Math.max(this.until(`all:a:${me}`, now), this.until(`all:t:${msg.table}`, now));
      if (again > now) return no('RATE_LIMITED', 'You invited everyone a moment ago.', again);
    }
    const sendRules = SEND_LIMITS.map(([n, ms]) => ({ key: `send:${me}:${ms}`, n, ms }));
    const blocked = this.blocked(sendRules, now);
    if (blocked) return no('RATE_LIMITED', 'Too many invites. Wait a minute, then try again.', blocked);
    this.count(sendRules, now);

    const lobby = await this.deps.summary(msg.table).catch(() => null);
    if (!lobby || lobby.game !== game) return no('NOT_FOUND', 'That table has closed.');
    const pin = this.deps.directory.pinOf(msg.table);
    // A private table's PIN is what shows you're one of its players (members see it).
    if (pin !== null && msg.pin !== pin) return no('BAD_PIN', "That table's PIN has changed.");
    if (lobby.players >= lobby.max) return no('TABLE_FULL', 'The table is full.');

    const targets = all ? this.everyone(me) : (msg.to as number[]).filter((id) => id !== me).slice(0, INVITE_MAX_TO);
    const invite: Invite = {
      id: randomId(12),
      from: { id: me, name: att.name },
      tableId: msg.table,
      game,
      variant: lobby.variant,
      private: pin !== null,
      all,
      lobby,
      station: att.at?.station ?? null,
      at: now,
      until: now + INVITE_MS,
    };
    const skipped: { id: number; name: string; why: InviteSkip }[] = [];
    const reached: number[] = [];
    for (const id of targets) {
      const why = this.skipReason(me, id, now, all);
      if (why) {
        if (!all) skipped.push({ id, name: this.nameOf(id), why });
        continue;
      }
      this.count([{ key: `pair:${me}:${id}`, n: 1, ms: PAIR_MS }, { key: `to:${id}`, n: TARGET_PER_MIN, ms: MINUTE }], now);
      reached.push(id);
    }
    if (reached.length > 0) {
      this.sql.exec(
        `INSERT INTO invites (id, from_id, table_id, game, station, until) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        invite.id, me, invite.tableId, game, invite.station, invite.until,
      );
      const data = JSON.stringify({ t: 'invited', invite } satisfies FloorServerMsg);
      for (const id of reached) {
        this.sql.exec(`INSERT OR IGNORE INTO invite_to (invite_id, account_id) VALUES (?1, ?2)`, invite.id, id);
        for (const s of this.deps.socketsOf(id)) trySend(s, data);
      }
    }
    const sent = reached.length;
    let again: number | undefined;
    if (all && sent > 0) {
      this.count([{ key: `all:a:${me}`, n: 1, ms: EVERYONE_MS }, { key: `all:t:${msg.table}`, n: 1, ms: EVERYONE_MS }], now);
      again = now + EVERYONE_MS;
    }
    send(ws, { t: 'invite.sent', table: msg.table, all, sent, skipped, ...(again ? { again } : {}) });
  }

  /** Why an invite wouldn't reach this player now, or null if it will. */
  private skipReason(from: number, to: number, now: number, all: boolean): InviteSkip | null {
    const open = this.deps.socketsOf(to).filter((s) => s.readyState === WebSocket.OPEN);
    if (open.length === 0) return 'offline';
    if (this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM invite_dnd WHERE account_id = ?1`, to).one().n > 0) return 'dnd';
    const active = Math.max(...open.map((s) => this.deps.presence.activeAt(s) ?? 0));
    if (now - active >= AWAY_MS) return 'away';
    // "everyone" has its own, longer wait; asking one person again and again is what this stops
    if (!all && this.used(`pair:${from}:${to}`, now) >= 1) return 'recent';
    if (this.used(`to:${to}`, now) >= TARGET_PER_MIN) return 'busy';
    return null;
  }

  /** Every account on the floor but this one. */
  private everyone(except: number): number[] {
    const ids = new Set<number>();
    for (const s of this.deps.sockets()) {
      const a = s.deserializeAttachment() as FloorAtt | null;
      if (a && a.accountId !== except && s.readyState === WebSocket.OPEN) ids.add(a.accountId);
    }
    return [...ids];
  }

  private nameOf(id: number): string {
    for (const s of this.deps.socketsOf(id)) {
      const a = s.deserializeAttachment() as FloorAtt | null;
      if (a) return a.name;
    }
    return '';
  }

  // --- joining --------------------------------------------------------------------------------

  private async take(ws: WebSocket, att: FloorAtt, msg: Extract<InviteClientMsg, { t: 'invite.take' }>, now: number): Promise<void> {
    const me = att.accountId;
    const no = (code: ErrorCode, text: string) => send(ws, { t: 'invite.no', id: msg.id, code, msg: text });
    const rule = [{ key: `take:${me}`, n: TAKE_PER_MIN, ms: MINUTE }];
    if (this.blocked(rule, now)) return no('RATE_LIMITED', 'Too many tries. Wait a minute, then try again.');
    this.count(rule, now);
    this.purge(now);
    const row = this.sql
      .exec<{ from_id: number; table_id: string; game: string; station: string | null }>(
        `SELECT i.from_id, i.table_id, i.game, i.station FROM invites i JOIN invite_to t ON t.invite_id = i.id
         WHERE i.id = ?1 AND t.account_id = ?2 AND i.until > ?3`,
        msg.id, me, now,
      )
      .toArray()[0];
    if (!row) return no('NOT_FOUND', 'That invite has run out.');
    // Held somewhere (the jail): the invite can't take you out of it.
    if (att.confine) return no('NOT_ELIGIBLE', "You can't leave here just now.");
    const lobby = await this.deps.summary(row.table_id).catch(() => null);
    if (!lobby) return no('NOT_FOUND', 'That table has closed.');
    if (lobby.players >= lobby.max) return no('TABLE_FULL', 'That table is full now.');
    const pin = this.deps.directory.pinOf(row.table_id);

    // Beside the table: where the client asked, if that's near the inviter (or the inviter has
    // gone); otherwise right where the inviter is. Always on the casino floor.
    let to = clampTo(ZONES.casino, msg.x, msg.z);
    const host = this.deps.presence.positionOf(row.from_id);
    if (host && inRect(ZONES.casino, host.x, host.z) && Math.hypot(to.x - host.x, to.z - host.z) > NEAR_CM) to = { x: host.x, z: host.z };
    this.deps.presence.teleport(me, to.x, to.z, msg.r);
    const game = row.game as GameId;
    send(ws, {
      t: 'invite.go',
      id: msg.id,
      tableId: row.table_id,
      game,
      variant: lobby.variant,
      ...(pin !== null ? { pin } : {}),
      station: row.station,
      x: to.x,
      z: to.z,
      r: msg.r,
    });
  }

  private setDnd(accountId: number, on: boolean): void {
    if (on) this.sql.exec(`INSERT OR IGNORE INTO invite_dnd (account_id) VALUES (?1)`, accountId);
    else this.sql.exec(`DELETE FROM invite_dnd WHERE account_id = ?1`, accountId);
  }

  // --- storage --------------------------------------------------------------------------------

  private purge(now: number): void {
    this.sql.exec(`DELETE FROM invite_to WHERE invite_id IN (SELECT id FROM invites WHERE until <= ?1)`, now);
    this.sql.exec(`DELETE FROM invites WHERE until <= ?1`, now);
    this.sql.exec(`DELETE FROM invite_limits WHERE until <= ?1`, now);
  }

  private used(key: string, now: number): number {
    return this.sql.exec<{ n: number }>(`SELECT n FROM invite_limits WHERE key = ?1 AND until > ?2`, key, now).toArray()[0]?.n ?? 0;
  }

  /** When a window with anything in it ends (0 if there is none). */
  private until(key: string, now: number): number {
    return this.sql.exec<{ until: number }>(`SELECT until FROM invite_limits WHERE key = ?1 AND until > ?2`, key, now).toArray()[0]?.until ?? 0;
  }

  /** The end of the first full window among these, or 0 if none is full. */
  private blocked(rules: { key: string; n: number }[], now: number): number {
    for (const r of rules) if (this.used(r.key, now) >= r.n) return this.until(r.key, now);
    return 0;
  }

  /** Fixed windows: the first use starts one, later ones in it add up. */
  private count(rules: { key: string; n?: number; ms: number }[], now: number): void {
    for (const r of rules) {
      this.sql.exec(`DELETE FROM invite_limits WHERE key = ?1 AND until <= ?2`, r.key, now);
      this.sql.exec(
        `INSERT INTO invite_limits (key, n, until) VALUES (?1, 1, ?2) ON CONFLICT (key) DO UPDATE SET n = n + 1`,
        r.key, now + r.ms,
      );
    }
  }
}

/** The game a lobby table's id is for (its prefix), or null for anything that isn't one. */
export function gameOfTable(tableId: string): GameId | null {
  if (!TABLE_ID_RE.test(tableId)) return null;
  const prefix = tableId.slice(0, tableId.indexOf('-'));
  for (const info of Object.values(CATALOG)) if (info.prefix === prefix) return info.id;
  return null;
}

function send(ws: WebSocket, msg: FloorServerMsg): void {
  trySend(ws, JSON.stringify(msg));
}

function trySend(ws: WebSocket, data: string): boolean {
  try {
    ws.send(data);
    return true;
  } catch {
    return false;
  }
}

function randomId(len: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(len);
  // 252 is the largest multiple of 36 under 256: no letter comes up more often than another
  let s = '';
  while (s.length < len) {
    crypto.getRandomValues(buf);
    for (const b of buf) if (b < 252 && s.length < len) s += alphabet[b % 36];
  }
  return s;
}
