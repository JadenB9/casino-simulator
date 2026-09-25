// The law on the floor: punches, the staff's catches, warnings, jail and bail. The rules are
// shared/src/law/rules.ts and where the staff are is shared/src/law/patrol.ts; this is the floor's
// side of them.
//
//   punch()     a punch lands on the nearest player or staff member in reach, everyone sees it,
//               and any guard who can see the puncher (sight.ts) catches it
//   hot()       a table says someone is winning too much there; the pit boss catches it if he
//               can see them right now
//   strike()    a catch: a warning, or jail if they were warned in the last few minutes
//   progress()  a jail table's finished round: nearer bail, and out when it's made
//
// A stay in jail is a row in D1 (casino_jail), so the Worker can keep inmates off every other
// table and it survives anything. The floor keeps a copy of the open rows and each warning in
// its own SQLite, so a connect or a move never waits on D1. Detours are only a few seconds long
// and live in memory: a restart loses the walk, never the warning.
//
// Moving someone into jail or out is presence's teleport and confine; confinement is re-applied
// on every connect, so reconnecting never lets anyone out.

import type { FloorServerMsg } from '../../shared/src/protocol.ts';
import { STAFF, detourOf, makeDetour, poseAt, staffSpec, type Detour, type StaffId } from '../../shared/src/law/patrol.ts';
import { sees } from '../../shared/src/law/sight.ts';
import {
  ESCORT_TALK_MS,
  JAIL,
  JAIL_RECT,
  PUNCH_GAP_MS,
  RELEASE_MS,
  STRIKE_QUIET_MS,
  STRIKE_WINDOW_MS,
  WARN_TALK_MS,
  bailFor,
  isJailTable,
  punchTarget,
  type JailState,
  type LawEvent,
  type Offence,
} from '../../shared/src/law/rules.ts';
import { inRect } from '../../shared/src/zones.ts';
import type { Presence } from './floor/presence.ts';
import { SPAWN } from './floor/presence.ts';
import { escrowsOf } from './db.ts';
import type { CasinoTable } from './table/host.ts';

/** What a table tells the floor about someone winning too much there. */
export interface HotReport {
  accountId: number;
  name: string;
  /** Net winnings in the window (cents), for the log. */
  amount: number;
}

export type StrikeResult = 'warned' | 'jailed' | 'quiet' | 'unseen';

interface WarnRow {
  at: number;
  until: number;
}

const TAU = Math.PI * 2;

/** An open stay in jail, from D1. */
export async function jailOf(db: D1Database, accountId: number): Promise<JailState | null> {
  const row = await db.prepare(`SELECT bail, won, at FROM casino_jail WHERE account_id = ?1 AND released_at IS NULL`).bind(accountId).first<JailState>();
  return row ?? null;
}

export class Law {
  private readonly sql: SqlStorage;
  private detours: Detour[] = [];
  /** Accounts being locked up right now (D1 on its way): no second arrest meanwhile. */
  private readonly jailing = new Set<number>();
  /** When each lock-up or release moves its player (in memory: after a restart, the next move does it). */
  private readonly moveAt = new Map<number, number>();
  private readonly lastPunch = new Map<number, number>();
  /** Accounts whose moves are checked against the jail (inmates, and everyone's first moves after a connect). */
  private readonly watch = new Set<number>();

  constructor(
    ctx: DurableObjectState,
    private readonly env: Env,
    private readonly presence: Presence,
    private readonly broadcast: (msg: FloorServerMsg) => void,
    private readonly sendTo: (accountId: number, msg: FloorServerMsg) => void,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS law_warn (account_id INTEGER PRIMARY KEY, at INTEGER NOT NULL, until INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS law_jail (account_id INTEGER PRIMARY KEY, bail INTEGER NOT NULL, won INTEGER NOT NULL, at INTEGER NOT NULL)`);
    // inmates' moves are always checked, from before a restart too
    for (const r of this.sql.exec<{ account_id: number }>(`SELECT account_id FROM law_jail`)) this.watch.add(r.account_id);
  }

  // --- state ---------------------------------------------------------------------------------

  /** Whether this account is in jail (the elevator and anything else that moves people asks). */
  isConfined(accountId: number): boolean {
    return this.jailOf(accountId) !== null;
  }

  jailOf(accountId: number): JailState | null {
    return this.sql.exec<{ bail: number; won: number; at: number }>(`SELECT bail, won, at FROM law_jail WHERE account_id = ?1`, accountId).toArray()[0] ?? null;
  }

  private warnOf(accountId: number, now: number): WarnRow | null {
    const row = this.sql.exec<{ at: number; until: number }>(`SELECT at, until FROM law_warn WHERE account_id = ?1`, accountId).toArray()[0];
    return row && row.until > now ? row : null;
  }

  /** Detours still under way (the rest are dropped). */
  active(now: number): Detour[] {
    this.detours = this.detours.filter((d) => d.until > now);
    return this.detours;
  }

  private poseOf(id: StaffId, now: number) {
    return poseAt(staffSpec(id), now, detourOf(this.active(now), id, now));
  }

  // --- connecting and moving -----------------------------------------------------------------

  /** A new connection: the detours under way, and an inmate goes back inside (confined, and moved there if out). */
  greet(accountId: number, now: number): void {
    this.watch.add(accountId);
    const list = this.active(now);
    if (list.length) this.sendTo(accountId, { t: 'detours', list });
    const jail = this.jailOf(accountId);
    if (jail) {
      this.lockUp(accountId);
      this.sendTo(accountId, { t: 'jail', jail });
    }
  }

  /**
   * After each move: an inmate who somehow isn't confined (the floor restarted during the walk
   * out) is locked up now, and a free player standing inside the jail (let out while away, the
   * page kept where they were) is walked out to the casino.
   */
  afterMove(accountId: number, now: number): void {
    if (!this.watch.has(accountId)) return;
    const due = this.moveAt.get(accountId);
    if (due !== undefined && now < due) return;
    const pos = this.presence.positionOf(accountId);
    if (!pos) return;
    const inside = inRect(JAIL_RECT, pos.x, pos.z);
    if (this.jailOf(accountId)) {
      if (!inside) this.lockUp(accountId);
      return;
    }
    if (this.jailing.has(accountId)) return;
    if (inside) this.letOut(accountId);
    this.watch.delete(accountId);
  }

  // --- punches -------------------------------------------------------------------------------

  /** A punch thrown by this player facing `r` (yaw byte). */
  punch(accountId: number, r: number, now: number): void {
    const me = this.presence.standing().find((p) => p.accountId === accountId);
    // not from a chair or a table, and not faster than a fist can go
    if (!me || me.at || me.seat) return;
    if (now - (this.lastPunch.get(accountId) ?? -Infinity) < PUNCH_GAP_MS) return;
    this.lastPunch.set(accountId, now);
    const x = me.x / 100;
    const z = me.z / 100;
    const yaw = (r / 256) * TAU;
    const candidates: { id: number | StaffId; x: number; z: number }[] = [];
    for (const p of this.presence.standing()) {
      if (p.accountId === accountId || p.at || p.seat) continue;
      candidates.push({ id: p.accountId, x: p.x / 100, z: p.z / 100 });
    }
    for (const s of STAFF) {
      const pose = this.poseOf(s.id, now);
      candidates.push({ id: s.id, x: pose.x, z: pose.z });
    }
    const hit = punchTarget(x, z, yaw, candidates);
    this.broadcast({ t: 'punch', id: accountId, hit });
    if (hit === null) return;
    // Hitting staff is always seen (by him); otherwise any guard who can see you.
    let by: StaffId | null = typeof hit === 'string' ? hit : null;
    if (!by) {
      for (const s of STAFF) {
        if (s.kind === 'guard' && sees(s, this.poseOf(s.id, now), x, z)) {
          by = s.id;
          break;
        }
      }
    }
    if (by) void this.strike(accountId, me.name, by, 'punch', now);
  }

  // --- the pit boss --------------------------------------------------------------------------

  /** A table's hot streak: caught if the pit boss can see the player now. */
  async hot(r: HotReport, now: number): Promise<StrikeResult> {
    if (this.isConfined(r.accountId)) return 'unseen';
    const pos = this.presence.positionOf(r.accountId);
    if (!pos) return 'unseen';
    const boss = staffSpec('boss');
    if (!sees(boss, this.poseOf('boss', now), pos.x / 100, pos.z / 100)) return 'unseen';
    return this.strike(r.accountId, r.name, 'boss', 'win', now);
  }

  // --- strikes -------------------------------------------------------------------------------

  /** Caught: a warning, or jail within the window of the last one. */
  async strike(accountId: number, name: string, staff: StaffId, why: Offence, now: number): Promise<StrikeResult> {
    if (this.jailing.has(accountId) || this.isConfined(accountId)) return 'jailed';
    const warned = this.warnOf(accountId, now);
    if (warned && now - warned.at < STRIKE_QUIET_MS) return 'quiet';
    if (warned) {
      await this.arrest(accountId, name, staff, why, now);
      return 'jailed';
    }
    const until = now + STRIKE_WINDOW_MS;
    this.sql.exec(`INSERT OR REPLACE INTO law_warn (account_id, at, until) VALUES (?1, ?2, ?3)`, accountId, now, until);
    this.walkOver(staff, accountId, 'warn', WARN_TALK_MS, now);
    this.tell({ k: 'warn', id: accountId, name, staff, why, until });
    return 'warned';
  }

  /** Send a member of staff over to someone (unless he's busy with someone else already). */
  private walkOver(staff: StaffId, accountId: number, kind: Detour['kind'], talk: number, now: number): Detour | null {
    if (detourOf(this.active(now), staff, now)) return null;
    const pos = this.presence.positionOf(accountId);
    if (!pos) return null;
    const d = makeDetour(staffSpec(staff), now, accountId, kind, { x: pos.x / 100, z: pos.z / 100 }, talk);
    this.detours.push(d);
    this.broadcast({ t: 'detour', d });
    return d;
  }

  private tell(ev: LawEvent): void {
    this.broadcast({ t: 'law', ev });
  }

  // --- jail ----------------------------------------------------------------------------------

  /**
   * Lock someone up: the bail from what they're worth, the row in D1 (then the floor's copy),
   * every table they sit at stood up the normal way (bets settle, chips go home), and once the
   * guard has walked over, across the street.
   */
  async arrest(accountId: number, name: string, staff: StaffId, why: Offence, now: number): Promise<void> {
    if (this.jailing.has(accountId) || this.isConfined(accountId)) return;
    this.jailing.add(accountId);
    try {
      const db = this.env.DB;
      const acct = await db.prepare(`SELECT balance + in_play + banked AS worth FROM casino_accounts WHERE id = ?1`).bind(accountId).first<{ worth: number }>();
      if (!acct) return;
      await db
        .prepare(`INSERT OR IGNORE INTO casino_jail (account_id, at, bail, won, why) VALUES (?1, ?2, ?3, 0, ?4)`)
        .bind(accountId, now, bailFor(acct.worth), why)
        .run();
      const jail = await jailOf(db, accountId);
      if (!jail) return;
      this.sql.exec(`INSERT OR REPLACE INTO law_jail (account_id, bail, won, at) VALUES (?1, ?2, ?3, ?4)`, accountId, jail.bail, jail.won, jail.at);
      this.sql.exec(`DELETE FROM law_warn WHERE account_id = ?1`, accountId);
      const d = this.walkOver(staff, accountId, 'jail', ESCORT_TALK_MS, Date.now());
      const moveAt = Date.now() + (d ? d.go + ESCORT_TALK_MS : ESCORT_TALK_MS);
      this.moveAt.set(accountId, moveAt);
      this.watch.add(accountId);
      this.tell({ k: 'jail', id: accountId, name, staff, why });
      this.sendTo(accountId, { t: 'jail', jail });
      setTimeout(() => {
        this.moveAt.delete(accountId);
        if (this.isConfined(accountId)) this.lockUp(accountId);
      }, moveAt - Date.now());
      await this.evict(accountId, (t) => !isJailTable(t));
    } catch (err) {
      console.error('arrest failed', accountId, err);
    } finally {
      this.jailing.delete(accountId);
    }
  }

  /** Confined to the jail, and moved in to booking if not inside already. */
  private lockUp(accountId: number): void {
    this.presence.confine(accountId, JAIL_RECT);
    const pos = this.presence.positionOf(accountId);
    if (pos && !inRect(JAIL_RECT, pos.x, pos.z)) {
      this.presence.teleport(accountId, Math.round(JAIL.spawn.x * 100), Math.round(JAIL.spawn.z * 100), yawByte(JAIL.spawn.yaw));
    }
  }

  /** Free to go: back at the casino's doors. */
  private letOut(accountId: number): void {
    this.presence.confine(accountId, null);
    this.presence.teleport(accountId, SPAWN.x, SPAWN.z, SPAWN.r);
  }

  /** A finished round at a jail table: nearer bail (never below nothing), and out once it's made. */
  async progress(accountId: number, net: number, now: number): Promise<void> {
    if (!Number.isSafeInteger(net) || net === 0) return;
    const db = this.env.DB;
    const row = await db
      .prepare(`UPDATE casino_jail SET won = max(0, won + ?1) WHERE account_id = ?2 AND released_at IS NULL RETURNING id, bail, won, at`)
      .bind(net, accountId)
      .first<{ id: number; bail: number; won: number; at: number }>();
    if (!row) return;
    const jail: JailState = { bail: row.bail, won: row.won, at: row.at };
    if (row.won < row.bail) {
      this.sql.exec(`UPDATE law_jail SET won = ?1 WHERE account_id = ?2`, row.won, accountId);
      this.sendTo(accountId, { t: 'jail', jail });
      return;
    }
    await this.release(accountId, row.id, now);
  }

  /** Bail made: the row closes, strikes are cleared, the jail tables cash out, and after the door, the casino. */
  private async release(accountId: number, rowId: number, now: number): Promise<void> {
    const done = await this.env.DB.prepare(`UPDATE casino_jail SET released_at = ?1 WHERE id = ?2 AND released_at IS NULL`).bind(now, rowId).run();
    if (!done.meta.changes) return;
    this.sql.exec(`DELETE FROM law_jail WHERE account_id = ?1`, accountId);
    this.sql.exec(`DELETE FROM law_warn WHERE account_id = ?1`, accountId);
    const name = this.presence.whereIs(accountId)?.name ?? '';
    this.tell({ k: 'free', id: accountId, name, staff: null, why: null });
    this.sendTo(accountId, { t: 'jail', jail: null });
    this.moveAt.set(accountId, Date.now() + RELEASE_MS);
    this.watch.add(accountId);
    setTimeout(() => {
      this.moveAt.delete(accountId);
      if (!this.isConfined(accountId)) this.letOut(accountId);
    }, RELEASE_MS);
    await this.evict(accountId, isJailTable);
  }

  /** Stand this account up from its tables (those `which` picks), the way leaving does. */
  private async evict(accountId: number, which: (tableId: string) => boolean): Promise<void> {
    const ns = this.env.TABLE as unknown as DurableObjectNamespace<CasinoTable>;
    const tables = (await escrowsOf(this.env.DB, accountId)).map((e) => e.table_id).filter(which);
    await Promise.all(
      tables.map(async (t) => {
        try {
          await ns.get(ns.idFromName(t)).evict(accountId);
        } catch (err) {
          console.error('evict failed', t, err);
        }
      }),
    );
  }
}

function yawByte(yaw: number): number {
  return ((Math.round((yaw / TAU) * 256) % 256) + 256) % 256;
}
