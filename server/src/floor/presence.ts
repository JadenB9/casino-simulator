// Presence: who is on the floor, where they are standing, and where they are sitting.
//
// Each socket's attachment holds that player's identity and last pose, so the roster survives
// hibernation (the attachment does; memory doesn't). Movement arrives at up to 10 Hz per player
// while they walk; it is coalesced into snapshots as it arrives, at most one every FLUSH_MS, with
// no server timer, so the object only bills for handler time and sleeps when nobody moves.

import type { FloorClientMsg, FloorServerMsg, PlayerInfo } from '../../../shared/src/protocol.ts';
import { FLOOR_BOUNDS, PROTOCOL_VERSION } from '../../../shared/src/protocol.ts';
import type { Look } from '../../../shared/src/look.ts';

export const FLUSH_MS = 66;
/** Fastest a walking character moves, in cm per second, with slack for jitter. */
const MAX_SPEED = 900;

export interface FloorAtt {
  accountId: number;
  name: string;
  look: Look;
  x: number;
  z: number;
  r: number;
  at: { station: string } | null;
  /** Game whose lobby list this socket wants pushed (directory.ts). */
  watch: string | null;
  /** Server time of the last accepted position. */
  t: number;
}

type Broadcast = (msg: FloorServerMsg, except?: WebSocket) => void;

const SPAWN = { x: 0, z: 1800, r: 128 };

export class Presence {
  private dirty = new Set<WebSocket>();
  private moving = new Map<WebSocket, boolean>();
  private lastFlush = 0;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly broadcast: Broadcast,
  ) {}

  onConnect(ws: WebSocket, who: { accountId: number; name: string; look: Look }): void {
    const now = Date.now();
    const att: FloorAtt = { ...who, ...SPAWN, at: null, watch: null, t: now };
    ws.serializeAttachment(att);
    const players: PlayerInfo[] = [];
    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;
      const a = other.deserializeAttachment() as FloorAtt | null;
      if (a) players.push(info(a));
    }
    const online = this.onlineCount();
    this.send(ws, { t: 'hello', v: PROTOCOL_VERSION, you: info(att), players, online, now });
    this.broadcast({ t: 'join', player: info(att) }, ws);
    this.broadcast({ t: 'online', n: online }, ws);
  }

  onMessage(ws: WebSocket, msg: Exclude<FloorClientMsg, { t: 'watch' }>): void {
    const att = ws.deserializeAttachment() as FloorAtt | null;
    if (!att) return;
    const now = Date.now();
    const x = clamp(msg.x, FLOOR_BOUNDS.minX, FLOOR_BOUNDS.maxX);
    const z = clamp(msg.z, FLOOR_BOUNDS.minZ, FLOOR_BOUNDS.maxZ);
    // Presence carries no money, so the only checks are the floor bounds and a speed limit:
    // a jump further than anyone can walk in the elapsed time is clamped along its direction.
    const dt = Math.max(0.05, (now - att.t) / 1000);
    const dx = x - att.x;
    const dz = z - att.z;
    const dist = Math.hypot(dx, dz);
    const max = MAX_SPEED * dt + 50;
    const k = dist > max ? max / dist : 1;
    att.x = Math.round(att.x + dx * k);
    att.z = Math.round(att.z + dz * k);
    att.r = msg.r;
    att.t = now;
    ws.serializeAttachment(att);
    this.moving.set(ws, msg.t === 'mv');
    this.dirty.add(ws);
    if (msg.t === 'st' || now - this.lastFlush >= FLUSH_MS) this.flush(now);
  }

  onClose(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as FloorAtt | null;
    this.dirty.delete(ws);
    this.moving.delete(ws);
    if (!att) return;
    const stillHere = this.ctx.getWebSockets(`a:${att.accountId}`).some((w) => w !== ws);
    if (stillHere) return;
    this.broadcast({ t: 'leave', id: att.accountId }, ws);
    this.broadcast({ t: 'online', n: this.onlineCount(ws) }, ws);
  }

  setStation(accountId: number, station: string | null): void {
    for (const ws of this.ctx.getWebSockets(`a:${accountId}`)) {
      const att = ws.deserializeAttachment() as FloorAtt | null;
      if (!att) continue;
      att.at = station ? { station } : null;
      ws.serializeAttachment(att);
    }
    this.broadcast({ t: 'player', id: accountId, at: station ? { station } : null });
  }

  setLook(accountId: number, look: Look): void {
    for (const ws of this.ctx.getWebSockets(`a:${accountId}`)) {
      const att = ws.deserializeAttachment() as FloorAtt | null;
      if (!att) continue;
      att.look = look;
      ws.serializeAttachment(att);
    }
    this.broadcast({ t: 'player', id: accountId, look });
  }

  /** Accounts with an open floor connection. */
  onlineCount(except?: WebSocket): number {
    const ids = new Set<number>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const att = ws.deserializeAttachment() as FloorAtt | null;
      if (att) ids.add(att.accountId);
    }
    return ids.size;
  }

  private flush(now: number): void {
    if (this.dirty.size === 0) return;
    const p: [number, number, number, number, 0 | 1][] = [];
    for (const ws of this.dirty) {
      const a = ws.deserializeAttachment() as FloorAtt | null;
      if (a) p.push([a.accountId, a.x, a.z, a.r, this.moving.get(ws) ? 1 : 0]);
    }
    this.dirty.clear();
    this.lastFlush = now;
    if (p.length) this.broadcast({ t: 's', ts: now, p });
  }

  private send(ws: WebSocket, msg: FloorServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }
}

function info(a: FloorAtt): PlayerInfo {
  return { id: a.accountId, name: a.name, look: a.look, x: a.x, z: a.z, r: a.r, at: a.at };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
