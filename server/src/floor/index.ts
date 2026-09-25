// CasinoFloor: the one Durable Object everyone on the casino floor connects to. It owns the
// sockets and hands each message to one of three parts:
//   presence.ts   who is here, where they are, who is sitting where, the online count
//   directory.ts  the lobby list and private-lobby PINs
//   chat.ts       the floor's chat room
//   fx.ts         effects bought in the shop, and the lobby's statues
//   invites.ts    invites to a lobby table (v6 invite6)
// Each keeps anything that must survive hibernation in this object's SQLite storage or in the
// sockets' attachments; memory is only a cache. The object's one alarm closes idle sockets.

import { DurableObject } from 'cloudflare:workers';
import { CLOSE, EMOTES, IDLE_MS, MAX_FLOOR_FRAME, PROTOCOL_VERSION, parseFloorMsg, parseSay, type EmoteId, type FloorServerMsg, type LobbySummary } from '../../../shared/src/protocol.ts';
import { isGameId } from '../../../shared/src/games/catalog.ts';
import type { GameId } from '../../../shared/src/engine.ts';
import { lookFromJson, type Look } from '../../../shared/src/look.ts';
import { effectItem, isFreeEmote, type FxEvent, type Statue } from '../../../shared/src/items.ts';
import { Presence, type FloorAtt } from './presence.ts';
import { Directory, ipKey } from './directory.ts';
import { FloorChat } from './chat.ts';
import { Wins, type BigWinReport } from './wins.ts';
import { Effects, Statues, fxKey, type Reserve } from './fx.ts';
import { Valet, type CallResult } from './valet.ts'; // v6 cars6
import { ride } from './lift.ts'; // v6 city6
import { Bucket, KeyedBuckets } from '../ratelimit.ts';
import { spendTicket } from '../tickets.ts';
import { Invites } from './invites.ts'; // v6 invite6
import type { CasinoTable } from '../table/host.ts'; // v6 invite6
import { Law, type HotReport, type StrikeResult } from '../law.ts'; // v6 law6
// v6 celebs6: celebrities and the gift box
import { Celebs } from './celebs.ts';
import { parseCelebMsg, type CelebServerMsg, type GiftBox, type Visit } from '../../../shared/src/celebs.ts';
import type { HappyHour } from '../../../shared/src/happyhour.ts';

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
  /** v6: effects bought in the shop, and the lobby's statues (fx.ts) */
  readonly fx: Effects;
  readonly statues: Statues;
  /** v6 invite6: invites to a lobby table (invites.ts) */
  readonly invites: Invites;
  /** v6 law6: punches, the staff's catches, jail (server/src/law.ts) */
  readonly law: Law;
  /** v6 cars6: the valet's curb (valet.ts) */
  readonly valet: Valet;
  /** v6 celebs6: celebrity visits and the gift box (celebs.ts) */
  readonly celebs: Celebs;
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
    this.fx = new Effects(ctx, (msg) => this.broadcast(msg));
    this.statues = new Statues(ctx, (msg) => this.broadcast(msg));
    // v6 invite6: a table's own list row is how an invite checks the table is open and has room
    this.invites = new Invites(ctx, {
      presence: this.presence,
      directory: this.directory,
      summary: (tableId) => {
        const ns = env.TABLE as unknown as DurableObjectNamespace<CasinoTable>;
        return ns.get(ns.idFromName(tableId)).summary();
      },
      socketsOf: (accountId) => this.ctx.getWebSockets(`a:${accountId}`),
      sockets: () => this.ctx.getWebSockets(),
    });
    this.law = new Law(ctx, env, this.presence, (msg) => this.broadcast(msg), (id, msg) => this.sendTo(id, msg));
    this.valet = new Valet((msg) => this.broadcast(msg)); // v6 cars6
    // v6 celebs6
    this.celebs = new Celebs({
      sql: ctx.storage.sql,
      db: () => env.DB,
      where: (ws) => {
        const att = ws.deserializeAttachment() as FloorAtt | null;
        const at = att ? this.presence.whereIs(att.accountId) : null;
        return att && at ? { accountId: att.accountId, ...at } : null;
      },
      broadcast: (msg: CelebServerMsg) => this.broadcast(msg as unknown as FloorServerMsg),
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const accountId = Number(request.headers.get('x-casino-account'));
    const name = request.headers.get('x-casino-name') ?? '';
    const look = lookFromJson(request.headers.get('x-casino-look'));
    const ip = request.headers.get('x-casino-ip') ?? '';
    // v6: the emotes this account owns beyond the free six, as the Worker read them from D1
    const emotes = ownedEmotes(request.headers.get('x-casino-emotes'));
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
    this.presence.onConnect(server, { accountId, name, look, emotes });
    this.chat.join(server);
    this.wins.greet(server); // features: the recent big wins, after hello
    this.fx.greet(server, Date.now()); // v6: effects playing or queued
    this.law.greet(accountId, Date.now()); // v6 law6: the detours under way; an inmate back inside
    this.valet.greet(server, Date.now()); // v6 cars6: the cars at the valet's curb
    this.celebs.greet(server, Date.now()); // v6 celebs6: the visit and the gift box, after hello
    // Everyone already here is due for the idle sweep no later than this newcomer, so a sweep
    // already set comes first; with none set (nobody here, or a floor from before idling), set one.
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    // v6: the lobby's statues (the floor's copy, or D1 when it has none)
    try {
      await this.statues.greet(server, this.env.DB, Date.now());
    } catch (err) {
      console.error('statues failed', err);
    }
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
    // v6 celebs6: anyone doing anything moves the celebrities' clock on (celebs.ts); a word with
    // one, or a gift box opened, counts against the misc limit like a lobby list.
    this.celebs.tick(Date.now());
    const celeb = parseCelebMsg(data);
    if (celeb) {
      if (!b.misc.take()) return this.strike(ws, b);
      this.presence.touch(ws, Date.now());
      return this.celebs.message(ws, celeb, Date.now());
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
    } else if (msg.t === 'invite' || msg.t === 'invite.take' || msg.t === 'invite.dnd') {
      // v6 invite6: sending, joining with and turning off invites (invites.ts)
      if (msg.t !== 'invite.dnd') this.presence.touch(ws, Date.now());
      await this.invites.onMessage(ws, msg);
    } else if (msg.t === 'lift') {
      // v6 city6: the elevator (lift.ts): from beside its doors, not at a table, not while held
      this.presence.touch(ws, Date.now());
      const att = ws.deserializeAttachment() as FloorAtt | null;
      const no = att ? ride(this.presence, att, msg.to) : null;
      if (no) this.send(ws, { t: 'lift.no', to: msg.to, msg: no });
    } else if (msg.t === 'punch') {
      // v6 law6
      const id = this.presence.accountOf(ws);
      this.presence.touch(ws, Date.now());
      if (id !== null) this.law.punch(id, msg.r, Date.now());
    } else {
      this.presence.onMessage(ws, msg);
      // v6 law6: an inmate stays inside, a free player isn't left in there
      const id = this.presence.accountOf(ws);
      if (id !== null) this.law.afterMove(id, Date.now());
    }
  }

  /**
   * The idle sweep: a socket nothing real has come from for IDLE_MS (pings never reach here, and
   * the same pose again doesn't count) is closed with CLOSE.IDLE. Then it waits for the next one
   * that could be due, and it stops when nobody is here.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    // v6: effects whose purchase the Worker never finished are settled against D1 (fx.ts)
    try {
      await this.fx.settle(this.env.DB, now);
    } catch (err) {
      console.error('fx settle failed', err);
    }
    let next = this.fx.due() ?? Infinity;
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
    this.statues.lookChanged(accountId, look);
  }

  /** v6 cars6: bring a player's car round to the valet's curb (the Worker checked they own it), or send it back (null). */
  valetCall(accountId: number, name: string, car: string | null): CallResult {
    return this.valet.call({ id: accountId, name }, car, this.presence.positionOf(accountId), Date.now());
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

  /**
   * v6: an account now owns these emotes (bought in the shop, or given by a feat): its sockets may
   * send them from now on (kept in their attachments, so it outlasts hibernation), and hear `owned`
   * with the ones that are new to it so the wheel adds them. Called by the Worker (shop.ts) and by
   * tables (feats) over RPC. An account not on the floor gets them with its next connect instead.
   */
  grant(accountId: number, emotes: EmoteId[]): void {
    const fresh = this.presence.grantEmotes(accountId, ownedEmotes(emotes.join(',')));
    if (fresh.length === 0) return;
    const data = JSON.stringify({ t: 'owned', emotes: fresh as EmoteId[] } satisfies FloorServerMsg);
    for (const ws of this.ctx.getWebSockets(`a:${accountId}`)) {
      try {
        ws.send(data);
      } catch {
        /* closing */
      }
    }
  }

  /**
   * v6: hold a slot for an effect this player is buying (fx.ts), where they stand now. Called by
   * the Worker (shop.ts) before it charges; AWAY if they aren't on the floor.
   */
  async fxReserve(accountId: number, fx: string, op: string): Promise<Reserve | { error: 'AWAY' | 'NOT_FOUND' }> {
    const item = effectItem(fx);
    if (!item) return { error: 'NOT_FOUND' };
    const now = Date.now();
    const key = fxKey(accountId, op);
    const had = this.fx.of(key);
    if (had) return { event: had };
    const who = this.presence.whereIs(accountId);
    if (!who) return { error: 'AWAY' };
    const r = this.fx.reserve(key, { accountId, ...who }, item, now);
    // The alarm settles a reservation left unconfirmed; make sure one comes round in time.
    const due = this.fx.due();
    const alarm = await this.ctx.storage.getAlarm();
    if (due !== null && (alarm === null || alarm > due)) await this.ctx.storage.setAlarm(due);
    return r;
  }

  /** v6: the charge for this effect landed: it plays for everyone. Null if it isn't held. */
  fxConfirm(accountId: number, op: string): FxEvent | null {
    return this.fx.confirm(fxKey(accountId, op));
  }

  /** v6: the charge was refused; the slot goes back. */
  fxCancel(accountId: number, op: string): void {
    this.fx.cancel(fxKey(accountId, op));
  }

  /** v6: the effect this purchase bought, if the floor still has it. */
  fxOf(accountId: number, op: string): FxEvent | null {
    return this.fx.of(fxKey(accountId, op));
  }

  /** v6: someone bought a statue: read the line-up again and show everyone. */
  async statueBought(): Promise<Statue[]> {
    return this.statues.refresh(this.env.DB, Date.now());
  }

  /** v6: someone earned a feat (feats.ts): a line in everyone's feed. Called by tables over RPC. */
  featEarned(accountId: number, name: string, feat: string): void {
    this.broadcast({ t: 'feat', id: accountId, name, feat });
  }

  /** v6 bank6: another player sent this account money (bank.ts): its own sockets hear it. */
  bankNote(accountId: number, msg: Extract<FloorServerMsg, { t: 'bank.in' }>): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(`a:${accountId}`)) {
      try {
        ws.send(data);
      } catch {
        /* closing */
      }
    }
  }

  /** v6 law6: a table says this player is winning too much there; the pit boss may be watching. */
  lawHot(r: HotReport): Promise<StrikeResult> {
    return this.law.hot(r, Date.now());
  }

  /** v6 law6: a round finished at this inmate's jail table, won or lost `net` (cents). */
  jailRound(accountId: number, net: number): Promise<void> {
    return this.law.progress(accountId, net, Date.now());
  }

  /** v6 law6: the dev stack's catch (index.ts, CASINO_DEV only): the pit boss, whether or not he can see you. */
  lawDevCatch(accountId: number, name: string): Promise<StrikeResult> {
    return this.law.strike(accountId, name, 'boss', 'win', Date.now());
  }

  /** v6 celebs6: the dev stack's celebrity and gift box on demand (celebs.ts celebsDevApi). */
  celebDev(kind: 'celeb' | 'gift' | 'happy', arg?: string | number, from?: number): Visit | GiftBox | HappyHour {
    return this.celebs.force(kind, Date.now(), arg, from);
  }

  /** Everyone on the floor sees the gesture over this player's head. */
  private emote(ws: WebSocket, e: EmoteId): void {
    const att = ws.deserializeAttachment() as FloorAtt | null;
    // v6: the free six, or one the account owns; anything else is dropped quietly (an old wheel)
    if (att && (isFreeEmote(e) || att.emotes?.includes(e))) this.broadcast({ t: 'emote', id: att.accountId, e });
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

  // v6 city6: one message to one socket
  private send(ws: WebSocket, msg: FloorServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closing */
    }
  }

  /** v6 law6: a message for one account's sockets. */
  private sendTo(accountId: number, msg: FloorServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets(`a:${accountId}`)) {
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

/** Emote ids from a comma list (the Worker's header): known, not free, each once. */
function ownedEmotes(raw: string | null): string[] {
  if (!raw) return [];
  const known = new Set<string>(EMOTES);
  return [...new Set(raw.split(',').filter((e) => known.has(e) && !isFreeEmote(e)))];
}
