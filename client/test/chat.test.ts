// The chat's client side without the DOM: FloorLink's say and chat event, each room's log (what a
// backlog adds after a reconnect, what counts as unread) and the send limit the client keeps.

import { describe, it, expect, beforeAll } from 'vitest';
import type { FloorLink as FloorLinkT, FloorTransport } from '../src/net/presence.ts';
import { KEEP, RoomLog, SendGate, chatLook, nameHue, sayFor } from '../src/ui/chat/model.ts';
import { CHAT_BURST, type ChatLine, type ChatServerMsg } from '../../shared/src/protocol.ts';

// api.ts reads a constant Vite defines at build time; the unit project has no Vite define.
(globalThis as Record<string, unknown>).__API_ORIGIN__ = '';
let mod: typeof import('../src/net/presence.ts');
beforeAll(async () => {
  mod = await import('../src/net/presence.ts');
});

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

const line = (n: number, id = 2, text = `line ${n}`): ChatLine => ({ n, id, name: `p${id}`, text, at: 1_000 + n });
const lines = (from: number, to: number, id = 2) => Array.from({ length: to - from + 1 }, (_, i) => line(from + i, id));

describe('FloorLink chat', () => {
  it('says a line as { t: "say", text } and hands chat and refusals to its listeners', () => {
    const { link, sent, recv } = rig();
    const heard: ChatServerMsg[] = [];
    const also: string[] = [];
    link.on('chat', (m) => heard.push(m));
    link.on('message', (m) => also.push(m.t));
    expect(link.say('hello')).toBe(true);
    expect(sent).toEqual([{ t: 'say', text: 'hello' }]);
    const said = { t: 'chat', lines: [line(1)] } as const;
    const refused = { t: 'chat.no', code: 'RATE_LIMITED', msg: 'Slow down.', now: 5 } as const;
    recv(said);
    recv(refused);
    recv({ t: 'online', n: 3 });
    expect(heard).toEqual([said, refused]);
    expect(also).toEqual(['chat', 'chat.no', 'online']);
  });
});

describe('RoomLog', () => {
  it("keeps a first backlog as context, not unread, then counts others' new lines", () => {
    const log = new RoomLog();
    expect(log.take(lines(1, 5), true, 1, false).map((l) => l.n)).toEqual([1, 2, 3, 4, 5]);
    expect(log.unread).toBe(0);
    log.take([line(6)], false, 1, false);
    log.take([line(7, 1)], false, 1, false); // your own
    expect(log.unread).toBe(1);
    log.take([line(8)], false, 1, true); // while reading the room
    expect(log.unread).toBe(1);
    expect(log.lines.map((l) => l.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('takes from a reconnect backlog only what it missed, and counts that as unread', () => {
    const log = new RoomLog();
    log.take(lines(1, 10), true, 1, false);
    // The backlog after a reconnect overlaps what was shown; lines 11-13 came meanwhile.
    const added = log.take(lines(4, 13), true, 1, false);
    expect(added.map((l) => l.n)).toEqual([11, 12, 13]);
    expect(log.unread).toBe(3);
    expect(log.lines.map((l) => l.n)).toEqual(lines(1, 13).map((l) => l.n));
    // Repeats add nothing.
    expect(log.take([line(12), line(13)], false, 1, false)).toEqual([]);
  });

  it('starts over when a backlog is from a room that began again', () => {
    const log = new RoomLog();
    log.take(lines(40, 50), true, 1, false);
    const epoch = log.epoch;
    const added = log.take(lines(1, 3), true, 1, false);
    expect(log.epoch).toBe(epoch + 1);
    expect(added.map((l) => l.n)).toEqual([1, 2, 3]);
    expect(log.lines.map((l) => l.n)).toEqual([1, 2, 3]);
    expect(log.unread).toBe(0);
  });

  it(`keeps the newest ${KEEP} lines`, () => {
    const log = new RoomLog();
    for (let n = 1; n <= KEEP + 20; n++) log.take([line(n)], false, 1, false);
    expect(log.lines).toHaveLength(KEEP);
    expect(log.lines[0]!.n).toBe(21);
    expect(log.unread).toBe(KEEP + 20);
    log.clear();
    expect([log.lines.length, log.unread]).toEqual([0, 0]);
    expect(log.take([line(1)], true, 1, false)).toHaveLength(1);
  });
});

describe('SendGate', () => {
  it('lets the burst through, then about one a second, a little under the server', () => {
    const gate = new SendGate(undefined, undefined, 0);
    for (let i = 0; i < CHAT_BURST; i++) expect(gate.take(0)).toBe(true);
    expect(gate.take(0)).toBe(false);
    expect(gate.wait(0)).toBe(1112);
    expect(gate.take(1000)).toBe(false);
    expect(gate.take(1120)).toBe(true);
    expect(gate.take(1130)).toBe(false);
    // Idle a long while: back to a full burst, no more.
    expect([gate.take(60_000), gate.take(60_000), gate.take(60_000), gate.take(60_000)]).toEqual([true, true, true, false]);
  });
});

describe('small helpers', () => {
  it('give a name the same colour everywhere, case aside', () => {
    expect(nameHue('Lucky_7')).toBe(nameHue('lucky_7'));
    const hues = new Set(['al', 'bo', 'cy', 'di', 'ed', 'flo', 'gus', 'hal', 'ivy', 'jo'].map(nameHue));
    expect(hues.size).toBeGreaterThan(3);
    for (const h of hues) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(6);
    }
  });

  it('keep a bubble up 4 to 9 seconds, longer for longer lines', () => {
    expect(sayFor('hi')).toBe(4);
    expect(sayFor('x'.repeat(60))).toBeCloseTo(6.6);
    expect(sayFor('x'.repeat(200))).toBe(9);
  });
});

describe('the pinned chat', () => {
  const at = (o: Partial<Parameters<typeof chatLook>[0]>) => chatLook({ visible: true, open: false, pinned: false, typing: false, ...o });

  it('is nothing off the floor and the dock while closed, pinned or not', () => {
    expect(at({ visible: false, open: true, pinned: true })).toBe('hidden');
    expect(at({})).toBe('dock');
    expect(at({ pinned: true })).toBe('dock');
  });

  it('is the whole box while typing, pinned or not, and while opened for a moment', () => {
    expect(at({ open: true, typing: true })).toBe('box');
    expect(at({ open: true, typing: true, pinned: true })).toBe('box');
    expect(at({ open: true })).toBe('box');
  });

  it('stays up idle, letting the game have the clicks, once pinned and done typing', () => {
    expect(at({ open: true, pinned: true })).toBe('idle');
  });
});
