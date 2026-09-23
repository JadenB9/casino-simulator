// CasinoFloor: the one Durable Object everyone on the casino floor connects to. It owns the
// sockets and hands each message to one of three parts:
//   presence.ts   who is here, where they are, who is sitting where, the online count
//   directory.ts  the lobby list and private-lobby PINs
//   chat.ts       the floor's chat room
// Each keeps anything that must survive hibernation in this object's SQLite storage or in the
// sockets' attachments; memory is only a cache.

import { DurableObject } from 'cloudflare:workers';
import { CLOSE, MAX_FLOOR_FRAME, PROTOCOL_VERSION, parseFloorMsg, parseSay, type EmoteId, type FloorServerMsg, type LobbySummary } from '../../../shared/src/protocol.ts';
import { isGameId } from '../../../shared/src/games/catalog.ts';
import type { GameId } from '../../../shared/src/engine.ts';
import { lookFromJson, type Look } from '../../../shared/src/look.ts';
import { Presence, type FloorAtt } from './presence.ts';
import { Directory } from './directory.ts';
import { FloorChat } from './chat.ts';
import { Bucket } from '../ratelimit.ts';

/** A hard cap on floor connections; a busy night past this gets a polite "casino is full". */
export const MAX_FLOOR = 150;

export class CasinoFloor extends DurableObject<Env> {
  readonly presence: Presence;
  readonly directory: Directory;
  readonly chat: FloorChat;
  private buckets = new Map<WebSocket, { move: Bucket; misc: Bucket; emote: Bucket; strikes: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.presence = new Presence(ctx, (msg, except) => this.broadcast(msg, except));
    this.directory = new Directory(ctx, (msg, game) => this.toWatchers(msg, game));
    this.chat = new FloorChat(ctx, (msg) => this.broadcast(msg));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const accountId = Number(request.headers.get('x-casino-account'));
    const name = request.headers.get('x-casino-name') ?? '';
    const look = lookFromJson(request.headers.get('x-casino-look'));
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
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
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_FLOOR_FRAME) {
      ws.close(1009, 'frame too large');
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    // Chat keeps its own limits and mutes (chat.ts), so it goes round the buckets below.
    const say = parseSay(data);
    if (say) return this.chat.say(ws, say.text);
    const msg = parseFloorMsg(data, isGameId);
    if (!msg) return;
    const b = this.bucketsFor(ws);
    const ok = msg.t === 'mv' || msg.t === 'st' ? b.move.take() : msg.t === 'emote' ? b.emote.take() : b.misc.take();
    if (!ok) {
      if (++b.strikes > 200) ws.close(CLOSE.RATE_LIMITED, 'slow down');
      return;
    }
    if (msg.t === 'watch') this.directory.watch(ws, msg.game);
    else if (msg.t === 'emote') this.emote(ws, msg.e);
    else this.presence.onMessage(ws, msg);
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

  /** Everyone on the floor sees the gesture over this player's head. */
  private emote(ws: WebSocket, e: EmoteId): void {
    const att = ws.deserializeAttachment() as FloorAtt | null;
    if (att) this.broadcast({ t: 'emote', id: att.accountId, e });
  }

  // --- plumbing ------------------------------------------------------------------------------

  private bucketsFor(ws: WebSocket) {
    let b = this.buckets.get(ws);
    if (!b) {
      // Emotes are a gesture, not a chat: a few in a row, then one every couple of seconds.
      b = { move: new Bucket(30, 16), misc: new Bucket(10, 4), emote: new Bucket(3, 0.5), strikes: 0 };
      this.buckets.set(ws, b);
    }
    return b;
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
