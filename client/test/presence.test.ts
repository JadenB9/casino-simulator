import { describe, it, expect, beforeAll } from 'vitest';
import type { FloorLink as FloorLinkT, FloorTransport } from '../src/net/presence.ts';
import type { PlayerInfo } from '../../shared/src/protocol.ts';
import { DEFAULT_LOOK } from '../../shared/src/look.ts';

// api.ts reads a constant Vite defines at build time; the unit project has no Vite define.
(globalThis as Record<string, unknown>).__API_ORIGIN__ = '';
let mod: typeof import('../src/net/presence.ts');
beforeAll(async () => {
  mod = await import('../src/net/presence.ts');
});

/** A FloorLink wired to a fake socket: `sent` collects outgoing messages, `recv` feeds it. */
function rig() {
  const sent: any[] = [];
  let feed: (m: unknown) => void = () => {};
  const link: FloorLinkT = new mod.FloorLink({
    open: (onMessage): FloorTransport => {
      feed = onMessage;
      return { send: (m) => (sent.push(m), true), close: () => {} };
    },
  });
  return { link, sent, recv: (m: unknown) => feed(m) };
}

const player = (id: number, over: Partial<PlayerInfo> = {}): PlayerInfo => ({
  id, name: `p${id}`, look: DEFAULT_LOOK, x: 0, z: 1800, r: 128, at: null, ...over,
});
const hello = (players: PlayerInfo[] = [], now = 1_000_000) => ({ t: 'hello', v: 1, you: player(1), players, online: players.length + 1, now });

describe('yaw bytes', () => {
  it('maps radians to 0-255 and back, the short way round', () => {
    expect(mod.yawToByte(0)).toBe(0);
    expect(mod.yawToByte(Math.PI)).toBe(128);
    expect(mod.yawToByte(-Math.PI / 2)).toBe(192);
    expect(mod.yawToByte(Math.PI * 2)).toBe(0);
    expect(mod.yawToByte(Math.PI * 2 - 0.001)).toBe(0);
    for (let yaw = -7; yaw < 7; yaw += 0.37) {
      const back = mod.byteToYaw(mod.yawToByte(yaw));
      const diff = Math.abs(Math.atan2(Math.sin(back - yaw), Math.cos(back - yaw)));
      expect(diff).toBeLessThanOrEqual(Math.PI / 256 + 1e-9);
    }
  });
});

describe('FloorLink sending', () => {
  it('sends nothing before hello, then places the player on the first frame', () => {
    const { link, sent, recv } = rig();
    link.update({ x: 1, z: 2, yaw: 0, moving: false }, 0);
    expect(sent).toEqual([]);
    recv(hello());
    link.update({ x: 0, z: 18, yaw: Math.PI, moving: false }, 10);
    expect(sent).toEqual([{ t: 'st', x: 0, z: 1800, r: 128 }]);
    link.update({ x: 0, z: 18, yaw: Math.PI, moving: false }, 30);
    expect(sent.length).toBe(1);
  });

  it('walking sends mv at most every 100 ms in integer cm, and one st once it has stopped', () => {
    const { link, sent, recv } = rig();
    recv(hello());
    link.update({ x: 0, z: 18, yaw: 0, moving: false }, -1000);
    sent.length = 0;
    // 16 ms frames for about half a second, 2 cm a frame along +x.
    for (let f = 1; f <= 30; f++) link.update({ x: f * 0.02, z: 18, yaw: Math.PI / 2, moving: true }, f * 16 + 1);
    expect(sent.every((m) => m.t === 'mv' && m.z === 1800 && m.r === 64)).toBe(true);
    expect(sent.map((m) => m.x)).toEqual([2, 16, 30, 44, 58]); // frames at 17, 129, 241, 353, 465 ms
    // The last step lands on the frame the controller stops; the next still frame sends the stop.
    link.update({ x: 0.7512, z: 18, yaw: Math.PI / 2, moving: false }, 497);
    expect(sent.length).toBe(5);
    link.update({ x: 0.7512, z: 18, yaw: Math.PI / 2, moving: false }, 513);
    expect(sent.at(-1)).toEqual({ t: 'st', x: 75, z: 1800, r: 64 });
    for (let f = 0; f < 20; f++) link.update({ x: 0.7512, z: 18, yaw: Math.PI / 2, moving: false }, 529 + f * 16);
    expect(sent.length).toBe(6);
  });

  it('turning on the spot, or being moved by the scene, sends mv and then settles with st', () => {
    const { link, sent, recv } = rig();
    recv(hello());
    link.update({ x: 0, z: 18, yaw: 0, moving: false }, -1000);
    sent.length = 0;
    for (let f = 1; f <= 12; f++) link.update({ x: 0, z: 18, yaw: f * 0.1, moving: false }, f * 16);
    expect(sent.map((m) => m.t)).toEqual(['mv', 'mv']);
    link.update({ x: 0, z: 18, yaw: 1.2, moving: false }, 13 * 16);
    expect(sent.at(-1)).toEqual({ t: 'st', x: 0, z: 1800, r: mod.yawToByte(1.2) });
    // Sitting down: one jump to the seat.
    link.update({ x: -2.4, z: 15.15, yaw: Math.PI, moving: false }, 400);
    link.update({ x: -2.4, z: 15.15, yaw: Math.PI, moving: false }, 416);
    expect(sent.slice(-2)).toEqual([
      { t: 'mv', x: -240, z: 1515, r: 128 },
      { t: 'st', x: -240, z: 1515, r: 128 },
    ]);
  });

  it('after a reconnect it tells the server where it is, even standing still', () => {
    const { link, sent, recv } = rig();
    recv(hello());
    link.update({ x: 3, z: 4, yaw: 0, moving: false }, 0);
    sent.length = 0;
    recv(hello([], 2_000_000));
    link.update({ x: 3, z: 4, yaw: 0, moving: false }, 50);
    expect(sent).toEqual([{ t: 'st', x: 300, z: 400, r: 0 }]);
  });
});

describe('FloorLink receiving', () => {
  it('keeps the roster, tracks and online count from hello, join, s, player and leave', () => {
    const { link, recv } = rig();
    const events: string[] = [];
    link.on('join', (p) => events.push(`join ${p.info.id}`));
    link.on('leave', (id) => events.push(`leave ${id}`));
    link.on('look', (id) => events.push(`look ${id}`));
    link.on('at', (id, at) => events.push(`at ${id} ${at?.station ?? '-'}`));
    link.on('online', (n) => events.push(`online ${n}`));
    let first: boolean | null = null;
    link.on('hello', (_you, f) => (first = f));

    recv(hello([player(2, { x: 100, z: 200 })]));
    expect(first).toBe(true);
    expect(link.onlineCount).toBe(2);
    expect(link.players.get(2)!.track.at(1_000_500)).toMatchObject({ x: 100, z: 200 });

    recv({ t: 'join', player: player(3) });
    recv({ t: 's', ts: 1_000_100, p: [[2, 110, 200, 0, 1], [1, 5, 5, 5, 1], [99, 1, 1, 1, 1]] });
    recv({ t: 's', ts: 1_000_200, p: [[2, 120, 200, 0, 0]] });
    expect(link.players.has(1)).toBe(false); // our own rows are ignored, as are strangers'
    expect(link.players.has(99)).toBe(false);
    // Drawn 200 ms behind: at server time 1_000_350 we see the pose from 1_000_150.
    expect(link.players.get(2)!.track.at(1_000_350)!.x).toBeCloseTo(115);

    const look = { ...DEFAULT_LOOK, top: '#aa0000' };
    recv({ t: 'player', id: 3, look });
    recv({ t: 'player', id: 3, at: { station: 'bj-1' } });
    recv({ t: 'player', id: 1, at: { station: 'rl-1' } });
    expect(link.players.get(3)!.info.look.top).toBe('#aa0000');
    expect(link.players.get(3)!.info.at).toEqual({ station: 'bj-1' });
    expect(link.you!.at).toEqual({ station: 'rl-1' });
    recv({ t: 'online', n: 3 });
    recv({ t: 'leave', id: 3 });
    recv({ t: 'leave', id: 3 });
    expect(link.players.has(3)).toBe(false);
    expect(events).toEqual(['join 2', 'online 2', 'join 3', 'look 3', 'at 3 bj-1', 'at 1 rl-1', 'online 3', 'leave 3']);
  });

  it('a reconnect drops whoever left meanwhile, keeps the rest, and snaps a big jump', () => {
    const { link, recv } = rig();
    const events: string[] = [];
    link.on('join', (p) => events.push(`join ${p.info.id}`));
    link.on('leave', (id) => events.push(`leave ${id}`));
    link.on('at', (id, at) => events.push(`at ${id} ${at?.station ?? '-'}`));
    let first: boolean | null = null;
    link.on('hello', (_you, f) => (first = f));
    recv(hello([player(2, { x: 0, z: 0 }), player(4), player(6)]));
    const track2 = link.players.get(2)!.track;
    recv(hello([player(2, { x: 20, z: 0 }), player(5, { at: { station: 'cr-1' } }), player(4, { at: { station: 'bj-2' } })], 1_010_000));
    expect(first).toBe(false);
    expect(link.players.get(2)!.track).toBe(track2); // a small move keeps the track
    expect([...link.players.keys()].sort()).toEqual([2, 4, 5]);
    expect(events).toEqual(['join 2', 'join 4', 'join 6', 'leave 6', 'join 5', 'at 4 bj-2']);

    // Someone reappearing across the room is drawn there at once, not gliding through tables.
    recv({ t: 's', ts: 1_010_100, p: [[2, 2000, 1500, 0, 0]] });
    expect(link.players.get(2)!.track).not.toBe(track2);
    expect(link.players.get(2)!.track.at(1_010_150)).toMatchObject({ x: 2000, z: 1500 });
  });
});
