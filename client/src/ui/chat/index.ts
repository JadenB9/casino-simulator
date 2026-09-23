// Live chat, for app/boot.ts: the floor's room, and while you're at a lobby table that table's
// room. One object per session, made when the floor socket is (so the floor's backlog is caught
// even while the menu is up) and shown once you're on the floor:
//   panel.ts    the dock and box in the bottom-right corner, tabs, unread counts, typing
//   bubbles.ts  a floor line over whoever said it, for a few seconds
//   model.ts    each room's lines and unread count, the client's copy of the send limit
// The floor socket is FloorLink (say, and its chat event); the table's is the app's TableSession,
// which hands chat messages over through setTable/tableMessage.

import type * as THREE from 'three';
import type { ChatServerMsg } from '../../../../shared/src/protocol.ts';
import type { FloorLink } from '../../net/presence.ts';
import type { Character } from '../../world/contract.ts';
import { ChatPanel, type RoomLink } from './panel.ts';
import { SayBubbles } from './bubbles.ts';

export type { RoomLink } from './panel.ts';
export type { RoomId } from './model.ts';

export interface ChatDeps {
  /** Where the panel goes (#ui). */
  root: HTMLElement;
  /** The floor socket: floor chat goes out and comes in on it. */
  floor: FloorLink;
  /**
   * The character drawn for a floor id, yours included, for the speech bubbles; undefined when
   * that player isn't drawn. Without it there are no bubbles.
   */
  character?(id: number): Character | undefined;
  /** Per-frame time for the bubbles (Engine3D.onFrame). */
  onFrame?(fn: (dt: number) => void): () => void;
  /** Bubbles far from this camera are hidden. */
  camera?: THREE.Camera;
}

export interface Chat {
  readonly panel: ChatPanel;
  /** Show the chat (on the floor, at a table) or hide it (the menu). */
  setVisible(on: boolean): void;
  /** The lobby table you're at, for its room; null when you leave it (or at a solo table). */
  setTable(table: RoomLink | null): void;
  /** A chat message from the table's socket ({ t: 'chat' } or { t: 'chat.no' }). */
  tableMessage(msg: ChatServerMsg): void;
  /** Open it and start typing. */
  focus(): void;
  dispose(): void;
}

export function createChat(deps: ChatDeps): Chat {
  const me = () => deps.floor.you?.id ?? null;
  const bubbles = new SayBubbles(deps.camera);
  const panel = new ChatPanel({
    root: deps.root,
    floor: { say: (text) => deps.floor.say(text) },
    me,
    onMute: (muted) => muted && bubbles.clearAll(),
  });
  let shown = false;
  const offs = [
    deps.floor.on('chat', (msg) => {
      const fresh = panel.receive('floor', msg);
      // Only lines said just now: a backlog is old news, and nothing floats while chat is hidden.
      if (msg.t !== 'chat' || msg.backlog || !shown || panel.muted || !deps.character) return;
      for (const line of fresh) {
        const ch = deps.character(line.id);
        if (ch) bubbles.show(ch, line.text, line.id === me());
      }
    }),
    deps.floor.on('emote', (id) => {
      const ch = deps.character?.(id);
      if (ch) bubbles.lift(ch);
    }),
    deps.onFrame?.((dt) => bubbles.update(dt)) ?? (() => {}),
  ];
  return {
    panel,
    setVisible(on) {
      shown = on;
      if (!on) bubbles.clearAll();
      panel.setVisible(on);
    },
    setTable: (table) => panel.setTable(table),
    tableMessage: (msg) => void panel.receive('table', msg),
    focus: () => panel.focus(),
    dispose() {
      for (const off of offs) off();
      bubbles.dispose();
      panel.dispose();
    },
  };
}
