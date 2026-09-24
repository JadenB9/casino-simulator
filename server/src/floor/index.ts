// CasinoFloor: the one Durable Object everyone on the casino floor connects to. It owns the
// sockets and hands each message to one of three parts:
//   presence.ts   who is here, where they are, who is sitting where, the online count
//   directory.ts  the lobby list and private-lobby PINs
//   chat.ts       the floor's chat room
// Each keeps anything that must survive hibernation in this object's SQLite storage or in the
// sockets' attachments; memory is only a cache. The object's one alarm closes idle sockets.

import { DurableObject } from 'cloudflare:workers';
import { CLOSE, IDLE_MS, MAX_FLOOR_FRAME, PROTOCOL_VERSION, parseFloorMsg, parseSay, type EmoteId, type FloorServerMsg, type LobbySummary } from '../../../shared/src/protocol.ts';
import { isGameId } from '../../../shared/src/games/catalog.ts';
import type { GameId } from '../../../shared/src/engine.ts';
import { lookFromJson, type Look } from '../../../shared/src/look.ts';
import { Presence, type FloorAtt } from './presence.ts';
import { Directory, ipKey } from './directory.ts';
import { FloorChat } from './chat.ts';
import { Wins, type BigWinReport } from './wins.ts';
import { Bucket, KeyedBuckets } from '../ratelimit.ts';
import { spendTicket } from '../tickets.ts';

/** A hard cap on floor connections; a busy night past this gets a polite "casino is full". */
export const MAX_FLOOR = 150;
/**
 * Connections per account: a burst, then one every few seconds. Every connect sends the whole
 * roster, so a reconnect loop from one client would otherwise cost the one floor everyone shares.
 */
export const FLOOR_CONNECT_BURST = 10;
const FLOOR_CONNECT_PER_SEC = 1 / 3;
/** Per address (a /64 for IPv6): generous, since a household or a campus can share one. */
const ADDR_CONNECT_BURST = 60;
const ADDR_CONNECT_PER_SEC = 2;
/** Frames of any kind: well above ten moves a second plus the odd watch and emote. */
const FRAME_BURST = 60;
const FRAME_PER_SEC = 30;
/** Dropped frames a socket may run up (forgiven one a second) before it is closed. */
export const FLOOR_STRIKES = 200;
/** The idle sweep runs at most this often, so a socket goes up to this long after IDLE_MS, never before. */
export const IDLE_SWEEP_MS = 30_000;

interface FloorLimits {
  frames: Bucket;
  move: Bucket;
  misc: Bucket;
  emote: Bucket;
  strikes: Bucket;
}

export class CasinoFloor extends DurableObject<Env> {
  readonly presence: Presence;
  readonly directory: Directory;
  readonly chat: FloorChat;
  /** features: big-win announcements (wins.ts) */
  readonly wins: Wins;
  private buckets = new Map<WebSocket, FloorLimits>();
  private connects = new KeyedBuckets(FLOOR_CONNECT_BURST, FLOOR_CONNECT_PER_SEC);
  private addrConnects = new KeyedBuckets(ADDR_CONNECT_BURST, ADDR_CONNECT_PER_SEC);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.presence = new Presence(ctx, (msg, except) => this.broadcast(msg, except));
    this.directory = new Directory(ctx, (msg, game) => this.toWatchers(msg, game));
    this.chat = new FloorChat(ctx, (msg) => this.broadcast(msg));
    this.wins = new Wins(ctx, (msg) => this.broadcast(msg));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const accountId = Number(request.headers.get('x-casino-account'));
    const name = request.headers.get('x-casino-name') ?? '';
    const look = lookFromJson(request.headers.get('x-casino-look'));
    const ip = request.headers.get('x-casino-ip') ?? '';
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // A reconnect loop (or a script) gets a burst, then waits; 4008 makes the client back off.
    if (!this.connects.take(`a:${accountId}`) || (ip && !this.addrConnects.take(ipKey(ip)))) {
      server.accept();
      server.close(CLOSE.RATE_LIMITED, 'slow down');
      return new Response(null, { status: 101, webSocket: client });
    }
    // The ticket that let this socket through the Worker opens it once (tickets.ts).
    if (!spendTicket(this.ctx.storage.sql, request.headers.get('x-casino-ticket'), Number(request.headers.get('x-casino-ticket-exp')), Date.now())) {
      server.accept();
      server.close(CLOSE.TICKET, 'ticket used');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (this.ctx.getWebSockets().length >= MAX_FLOOR && this.ctx.getWebSockets(`a:${accountId}`).length === 0) {
      server.accept();
      server.close(CLOSE.FORBIDDEN, 'the casino is full');
      return new Response(null, { status: 101, webSocket: client });
    }
    // One floor connection per account: the newest tab takes over.
    for (const old of this.ctx.getWebSockets(`a:${accountId}`)) {
      try {
        old.close(CLOSE.REPLACED, 'opened elsewhere');
      } catch {
        /* gone */
      }
      this.presence.onClose(old);
    }
    this.ctx.acceptWebSocket(server, [`a:${accountId}`]);
    this.presence.onConnect(server, { accountId, name, look });
    this.chat.join(server);
    this.wins.greet(server); // features: the recent big wins, after hello
    // Everyone already here is due for the idle sweep no later than this newcomer, so a sweep
    // already set comes first; with none set (nobody here, or a floor from before idling), set one.
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_FLOOR_FRAME) {
      ws.close(1009, 'frame too large');
      return;
    }
    const b = this.bucketsFor(ws);
    // Every frame counts, junk and chat included; junk and overflow are dropped and count as strikes.
    let data: unknown;
    if (b.frames.take()) {
      try {
        data = JSON.parse(raw);
      } catch {
        /* not JSON */
      }
    }
    // Chat keeps its own limits and mutes (chat.ts) on top of the frame count.
    const say = parseSay(data);
    if (say) {
      this.presence.touch(ws, Date.now());
      return this.chat.say(ws, say.text);
    }
    const msg = parseFloorMsg(data, isGameId);
    if (!msg) {
      this.strike(ws, b);
      return;
    }
    // Extra emotes are dropped quietly (people mash the key); they already counted as frames.
    if (msg.t === 'emote') {
      if (b.emote.take()) {
        this.presence.touch(ws, Date.now());
        this.emote(ws, msg.e);
      }
      return;
    }
    const ok = msg.t === 'mv' || msg.t === 'st' ? b.move.take() : b.misc.take();
    if (!ok) {
      this.strike(ws, b);
      return;
    }
    if (msg.t === 'watch') {
      this.directory.watch(ws, msg.game);
      this.presence.touch(ws, Date.now());
    } else if (msg.t === 'here') {
      this.presence.touch(ws, Date.now());
    } else if (msg.t === 'sit') {
      // sitting down or getting up is someone at the keyboard too
      this.presence.sit(ws, msg);
      this.presence.touch(ws, Date.now());
    } else if (msg.t === 'stand') {
      this.presence.stand(ws);
      this.presence.touch(ws, Date.now());
    } else {
      this.presence.onMessage(ws, msg);
    }
  }

  /**
   * The idle sweep: a socket nothing real has come from for IDLE_MS (pings never reach here, and
   * the same pose again doesn't count) is closed with CLOSE.IDLE. Then it waits for the next one
   * that could be due, and it stops when nobody is here.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    let next = Infinity;
    for (const ws of this.ctx.getWebSockets()) {
      const active = this.presence.activeAt(ws);
      if (active === null) continue;
      if (now - active >= IDLE_MS) this.idleOut(ws);
      else next = Math.min(next, active + IDLE_MS);
    }
    if (next !== Infinity) await this.ctx.storage.setAlarm(Math.max(next, now + IDLE_SWEEP_MS));
  }

  private idleOut(ws: WebSocket): void {
    try {
      ws.close(CLOSE.IDLE, 'away');
    } catch {
      /* already closing */
    }
    // Gone from the roster now, as a replaced socket is, rather than whenever its close comes back.
    this.buckets.delete(ws);
    this.directory.unwatch(ws);
    this.presence.onClose(ws);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* closed */
    }
    this.buckets.delete(ws);
    this.directory.unwatch(ws);
    this.presence.onClose(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.buckets.delete(ws);
    this.directory.unwatch(ws);
    this.presence.onClose(ws);
  }

  // --- RPC from tables and the Worker ------------------------------------------------------

  /** A player sat down at (or left) a station on the floor. */
  playerAt(accountId: number, station: string | null): void {
    this.presence.setStation(accountId, station);
  }

  /** A player changed their look in the menu. */
  playerLook(accountId: number, look: Look): void {
    this.presence.setLook(accountId, look);
  }

  online(): number {
    return this.presence.onlineCount();
  }

  lobbyUpsert(summary: LobbySummary): void {
    this.directory.upsert(summary, Date.now());
  }

  lobbyRemove(tableId: string, game: GameId): void {
    this.directory.remove(tableId, game);
  }

  allocatePin(tableId: string, game: GameId): string | null {
    return this.directory.allocatePin(tableId, game, Date.now());
  }

  releasePin(tableId: string): void {
    this.directory.releasePin(tableId, Date.now());
  }

  /** Reserve a new lobby id (and a PIN if private). The Worker then initializes the table. */
  createLobby(p: { game: GameId; visibility: 'public' | 'private'; accountId: number; ip: string }): { tableId: string; pin: string | null } | { error: 'RATE_LIMITED' } {
    return this.directory.createLobby(p, Date.now());
  }

  joinByPin(p: { pin: string; accountId: number; ip: string }): { tableId: string; game: GameId } | { error: 'BAD_PIN' | 'RATE_LIMITED' } {
    return this.directory.joinByPin(p, Date.now());
  }

  /** features: a table's round paid big; the floor announces it within its limits (wins.ts). */
  bigWin(r: BigWinReport): 'sent' | 'limited' | 'refused' {
    return this.wins.report(r);
  }

  /** Everyone on the floor sees the gesture over this player's head. */
  private emote(ws: WebSocket, e: EmoteId): void {
    const att = ws.deserializeAttachment() as FloorAtt | null;
    if (att) this.broadcast({ t: 'emote', id: att.accountId, e });
  }

  // --- plumbing ------------------------------------------------------------------------------

  private bucketsFor(ws: WebSocket): FloorLimits {
    let b = this.buckets.get(ws);
    if (!b) {
      // Emotes are a gesture, not a chat: a few in a row, then one every couple of seconds.
      b = {
        frames: new Bucket(FRAME_BURST, FRAME_PER_SEC),
        move: new Bucket(30, 16),
        misc: new Bucket(10, 4),
        emote: new Bucket(3, 0.5),
        strikes: new Bucket(FLOOR_STRIKES, 1),
      };
      this.buckets.set(ws, b);
    }
    return b;
  }

  /** Count a dropped frame; the socket is closed once there have been too many. */
  private strike(ws: WebSocket, b: FloorLimits): void {
    if (b.strikes.take()) return;
    try {
      ws.close(CLOSE.RATE_LIMITED, 'slow down');
    } catch {
      /* already closing */
    }
  }

  private broadcast(msg: FloorServerMsg, except?: WebSocket): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        /* closing */
      }
    }
  }

  private toWatchers(msg: FloorServerMsg, game: GameId): void {
    const data = JSON.stringify(msg);
    // Tags are fixed when a socket is accepted, so who watches which game lives in attachments.
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as FloorAtt | null;
      if (att?.watch === game) {
        try {
          ws.send(data);
        } catch {
          /* closing */
        }
      }
    }
  }
}

export { PROTOCOL_VERSION };
