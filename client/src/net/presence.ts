// Floor presence on the client: the floor socket, our own position going out, and everyone
// else's coming in as interpolation tracks.
//
// Out: `update()` is called every frame with the local player's pose. While the player moves it
// sends `mv` at most every SEND_MS; the frame it comes to rest it sends one `st`. The first
// frame after each (re)connect sends the pose unconditionally, because the server lets that
// first position place the player: after a dropped connection we kept walking on our own.
//
// In: each remote player gets a Track of snapshots in wire units (integer cm, yaw byte) that
// the renderer samples 200 ms in the past (net/interp.ts). Scene code converts with the helpers
// below; one scene unit is one metre.

import { Socket, type SocketState } from './socket.ts';
import { socketUrl } from './api.ts';
import { observeServerTime, serverNow } from './clock.ts';
import { Track, type Pose } from './interp.ts';
import type { ChatClientMsg, ChatServerMsg, EmoteId, FloorClientMsg, FloorServerMsg, PlayerInfo } from '../../../shared/src/protocol.ts';
import type { Look } from '../../../shared/src/look.ts';

/** Shortest gap between two `mv` messages, in ms (the protocol's limit). */
export const SEND_MS = 100;
/** A sample this far from the previous one (cm) is a jump, not a step: snap instead of gliding. */
const SNAP_CM = 300;
const TAU = Math.PI * 2;

/** Yaw in radians (a character's rotation.y) to the wire's byte, 0-255 for one full turn. */
export function yawToByte(yaw: number): number {
  return (((Math.round((yaw / TAU) * 256) % 256) + 256) % 256);
}

export function byteToYaw(r: number): number {
  return (r / 256) * TAU;
}

export interface RemotePlayer {
  /** Name, look and station are kept current; x/z/r are only where the player was first seen. */
  info: PlayerInfo;
  /** Where the player is, in cm and yaw bytes: sample with `track.at(serverNow())`. */
  track: Track;
  /** The newest sample, to tell a jump from a step. */
  last: Pose | null;
}

/** The local player's pose in scene units: metres on the floor and rotation.y in radians. */
export interface LocalPose {
  x: number;
  z: number;
  yaw: number;
  /** The controller is walking (input held or still slowing down). */
  moving: boolean;
}

export interface FloorEvents {
  /** `first` is the page's first hello; a later one follows a reconnect. */
  hello: (you: PlayerInfo, first: boolean) => void;
  join: (p: RemotePlayer) => void;
  leave: (id: number) => void;
  look: (id: number, look: Look) => void;
  at: (id: number, at: { station: string } | null) => void;
  online: (n: number) => void;
  state: (state: SocketState, code?: number) => void;
  /** Every message, after the roster has taken what it needs (the lobby list rides this socket). */
  message: (msg: FloorServerMsg) => void;
  /** Someone (you included) made a gesture. */
  emote: (id: number, e: EmoteId) => void;
  /** Floor chat: new lines (your own come back too), the room's backlog after each hello, or why your last line was refused. */
  chat: (msg: ChatServerMsg) => void;
}

type Listeners = { [K in keyof FloorEvents]: Set<FloorEvents[K]> };

/** What FloorLink needs from a socket; the real one reconnects on its own (net/socket.ts). */
export interface FloorTransport {
  send(msg: unknown): boolean;
  close(): void;
}

export interface FloorLinkOptions {
  /** The floor socket's URL, asked for on every attempt (by default with a fresh ticket). */
  url?: () => string | Promise<string>;
  /** Replace the socket (tests drive FloorLink without a network this way). */
  open?: (onMessage: (msg: unknown) => void, onState: (state: SocketState, code?: number) => void) => FloorTransport;
}

export class FloorLink {
  readonly players = new Map<number, RemotePlayer>();
  /** Us, as the server last described us (null until the first hello). */
  you: PlayerInfo | null = null;
  onlineCount = 0;
  private readonly socket: FloorTransport;
  private readonly listeners: Listeners = { hello: new Set(), join: new Set(), leave: new Set(), look: new Set(), at: new Set(), online: new Set(), state: new Set(), message: new Set(), emote: new Set(), chat: new Set() };
  private connected = false;
  private placed = false;
  private sent: { x: number; z: number; r: number } | null = null;
  private sentAt = -Infinity;
  /** The server last heard `mv` from us, so it shows us walking until a `st`. */
  private walking = false;
  private frame: { x: number; z: number; r: number } | null = null;

  constructor(opts: FloorLinkOptions = {}) {
    const onMessage = (m: unknown) => this.receive(m as FloorServerMsg);
    const onState = (state: SocketState, code?: number) => {
      if (state !== 'open') this.connected = false;
      this.emit('state', state, code);
    };
    this.socket = opts.open
      ? opts.open(onMessage, onState)
      : new Socket({ url: opts.url ?? (() => socketUrl('floor')), onMessage, onState });
  }

  on<K extends keyof FloorEvents>(event: K, fn: FloorEvents[K]): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  /** Hear every floor message (the lobby list rides the same socket). */
  subscribe(fn: (msg: FloorServerMsg) => void): () => void {
    return this.on('message', fn);
  }

  /** Make a gesture everyone on the floor sees (the server echoes it back to you too). */
  emote(e: EmoteId): boolean {
    return this.socket.send({ t: 'emote', e } satisfies FloorClientMsg);
  }

  /** Say a line in the floor's chat (ui/chat keeps it to what the server takes). False while reconnecting. */
  say(text: string): boolean {
    return this.socket.send({ t: 'say', text } satisfies ChatClientMsg);
  }

  /** Send something other than movement (a lobby watch). False while reconnecting. */
  send(msg: FloorClientMsg): boolean {
    return this.socket.send(msg);
  }

  /** Call once per frame with the local player's pose; sends at most one message. */
  update(pose: LocalPose, now = performance.now()): void {
    const cur = { x: Math.round(pose.x * 100), z: Math.round(pose.z * 100), r: yawToByte(pose.yaw) };
    const prev = this.frame;
    this.frame = cur;
    if (!this.connected) return;
    if (!this.placed) {
      this.push(pose.moving ? 'mv' : 'st', cur, now);
      return;
    }
    // Turning on the spot or being moved by the scene (sitting down) counts as moving too.
    const stirring = pose.moving || !prev || !same(prev, cur);
    if (stirring) {
      if (!same(this.sent, cur) && now - this.sentAt >= SEND_MS) this.push('mv', cur, now);
    } else if (this.walking || !same(this.sent, cur)) {
      this.push('st', cur, now);
    }
  }

  close(): void {
    this.socket.close();
    this.connected = false;
    this.players.clear();
  }

  private push(t: 'mv' | 'st', p: { x: number; z: number; r: number }, now: number): void {
    if (!this.socket.send({ t, x: p.x, z: p.z, r: p.r })) return;
    this.placed = true;
    this.sent = p;
    this.sentAt = now;
    this.walking = t === 'mv';
  }

  private receive(m: FloorServerMsg): void {
    switch (m.t) {
      case 'hello': {
        observeServerTime(m.now);
        const first = this.you === null;
        this.you = m.you;
        this.onlineCount = m.online;
        this.connected = true;
        this.placed = false;
        this.walking = false;
        // After a reconnect the roster is rebuilt from scratch: whoever left meanwhile is gone.
        const here = new Set(m.players.map((p) => p.id));
        for (const id of [...this.players.keys()]) {
          if (!here.has(id)) this.drop(id);
        }
        for (const p of m.players) this.upsert(p, m.now - 1);
        this.emit('online', m.online);
        this.emit('hello', m.you, first);
        break;
      }
      case 's':
        observeServerTime(m.ts);
        for (const [id, x, z, r, moving] of m.p) {
          const p = this.players.get(id);
          if (p) this.sample(p, m.ts, { x, z, r, moving: moving === 1 });
        }
        break;
      case 'join':
        if (m.player.id !== this.you?.id) this.upsert(m.player, serverNow() - 1000);
        break;
      case 'leave':
        this.drop(m.id);
        break;
      case 'player': {
        const info = m.id === this.you?.id ? this.you : this.players.get(m.id)?.info;
        if (!info) break;
        if (m.look) {
          info.look = m.look;
          this.emit('look', m.id, m.look);
        }
        if (m.at !== undefined) {
          info.at = m.at;
          this.emit('at', m.id, m.at);
        }
        break;
      }
      case 'online':
        this.onlineCount = m.n;
        this.emit('online', m.n);
        break;
      case 'emote':
        this.emit('emote', m.id, m.e);
        break;
      case 'chat':
      case 'chat.no':
        this.emit('chat', m);
        break;
    }
    this.emit('message', m);
  }

  /** Add a player, or refresh one we already have (a reconnect's hello) without losing its track. */
  private upsert(info: PlayerInfo, t: number): void {
    const known = this.players.get(info.id);
    const pose = { x: info.x, z: info.z, r: info.r, moving: false };
    if (!known) {
      const p: RemotePlayer = { info: { ...info }, track: new Track(), last: null };
      this.sample(p, t, pose);
      this.players.set(info.id, p);
      this.emit('join', p);
      return;
    }
    this.sample(known, t, pose);
    if (JSON.stringify(known.info.look) !== JSON.stringify(info.look)) {
      known.info.look = info.look;
      this.emit('look', info.id, info.look);
    }
    if (known.info.at?.station !== info.at?.station) {
      known.info.at = info.at;
      this.emit('at', info.id, info.at);
    }
  }

  private sample(p: RemotePlayer, t: number, pose: Pose): void {
    // A jump (a reconnect placing someone across the room) snaps rather than gliding through tables.
    if (p.last && Math.hypot(pose.x - p.last.x, pose.z - p.last.z) > SNAP_CM) p.track = new Track();
    p.track.push(t, pose);
    p.last = pose;
  }

  private drop(id: number): void {
    if (this.players.delete(id)) this.emit('leave', id);
  }

  private emit<K extends keyof FloorEvents>(event: K, ...args: Parameters<FloorEvents[K]>): void {
    for (const fn of this.listeners[event]) {
      try {
        (fn as (...a: Parameters<FloorEvents[K]>) => void)(...args);
      } catch (err) {
        console.error(`floor ${event} handler failed`, err);
      }
    }
  }
}

function same(a: { x: number; z: number; r: number } | null, b: { x: number; z: number; r: number }): boolean {
  return a !== null && a.x === b.x && a.z === b.z && a.r === b.r;
}
