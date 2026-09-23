// The live list of public lobbies for one game, kept from the floor socket's lobby messages:
// 'lobbies' replaces the list (the answer to a watch), 'lobby' adds or updates one table, and
// 'lobby.gone' drops one. The server keeps the watch on the socket, so it is sent again whenever
// the floor reconnects ('hello' arrives on every connect).

import type { FloorClientMsg, FloorServerMsg, LobbySummary } from '../../../../shared/src/protocol.ts';
import type { GameId } from '../../../../shared/src/engine.ts';

/**
 * What the lobby needs from the floor socket. The floor link that owns the socket provides it
 * (or a two-line adapter does): a way to send, and a way to hear every message.
 */
export interface LobbyFloor {
  /** Send on the floor socket. May return false while it is reconnecting. */
  send(msg: FloorClientMsg): unknown;
  /** Hear every floor message; returns a function that stops listening. */
  subscribe(fn: (msg: FloorServerMsg) => void): () => void;
}

type Listener = (list: LobbySummary[]) => void;

export class LobbyWatch {
  private tables = new Map<string, LobbySummary>();
  private listeners = new Set<Listener>();
  private off: () => void;
  /** True once the server has answered the watch. */
  loaded = false;

  constructor(
    private readonly floor: LobbyFloor,
    readonly game: GameId,
  ) {
    this.off = floor.subscribe((m) => this.onMsg(m));
    floor.send({ t: 'watch', game });
  }

  get list(): LobbySummary[] {
    return sortLobbies([...this.tables.values()]);
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.off();
    this.listeners.clear();
    this.floor.send({ t: 'watch', game: null });
  }

  private onMsg(m: FloorServerMsg): void {
    switch (m.t) {
      case 'hello':
        this.floor.send({ t: 'watch', game: this.game });
        return;
      case 'lobbies':
        if (m.game !== this.game) return;
        this.tables = new Map(m.list.map((l) => [l.tableId, l]));
        this.loaded = true;
        break;
      case 'lobby':
        if (m.game !== this.game) return;
        this.tables.set(m.lobby.tableId, m.lobby);
        break;
      case 'lobby.gone':
        if (m.game !== this.game) return;
        this.tables.delete(m.tableId);
        break;
      default:
        return;
    }
    const list = this.list;
    for (const fn of this.listeners) fn(list);
  }
}

/** Tables you can sit down at before the game starts, then games already running, then full ones; busier first. */
export function sortLobbies(list: LobbySummary[]): LobbySummary[] {
  const rank = (l: LobbySummary) => (l.players >= l.max ? 2 : l.started ? 1 : 0);
  return list.sort((a, b) => rank(a) - rank(b) || b.players - a.players || a.tableId.localeCompare(b.tableId));
}

export function isFull(l: LobbySummary): boolean {
  return l.players >= l.max;
}
