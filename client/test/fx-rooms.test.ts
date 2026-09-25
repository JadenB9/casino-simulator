// The floor decides which room an effect plays in from where its buyer stands (server/src/floor/
// fx.ts). It keeps its own copy of the rooms' walls; this pins the copy to the room plan, so a
// room that moves on the client fails here rather than lighting up the wrong room.

import { describe, expect, it } from 'vitest';
import { ROOMS } from '../src/world/rooms.ts';
import { ROOM_BOUNDS, roomAt, slotOf } from '../../server/src/floor/fx.ts';
import { effectItem } from '../../shared/src/items.ts';

describe('the floor room table', () => {
  it('matches client/src/world/rooms.ts', () => {
    expect([...ROOM_BOUNDS].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      ROOMS.map((r) => ({ id: r.id, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 })).sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('puts every room centre in its room, and the doorstep outside in the lobby', () => {
    for (const r of ROOMS) expect(roomAt(((r.x0 + r.x1) / 2) * 100, ((r.z0 + r.z1) / 2) * 100)).toBe(r.id);
    expect(roomAt(0, 1500)).toBe('lobby');
    expect(roomAt(0, 1520)).toBe('lobby');
  });

  it('gives a player effect a slot per player, a room effect one per room, a casino effect one', () => {
    const you = effectItem('fx-confetti')!;
    const room = effectItem('fx-disco')!;
    const all = effectItem('fx-goldenhour')!;
    expect(slotOf(you, 7, 0, 900)).toBe('you:7');
    expect(slotOf(you, 8, 0, 900)).toBe('you:8');
    expect(slotOf(room, 7, 0, 900)).toBe('room:lobby');
    expect(slotOf(room, 8, 2200, -800)).toBe('room:bar');
    expect(slotOf(all, 7, 2200, -800)).toBe('casino');
  });
});
