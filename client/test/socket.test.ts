// The reconnecting socket (client/src/net/socket.ts) against a fake WebSocket and a fake clock:
// one socket at a time whatever the page does meanwhile, stale sockets' events ignored, a quick
// liveness check when the page wakes up, the close codes that end it, and backoff that grows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWS {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static all: FakeWS[] = [];
  readyState = FakeWS.CONNECTING;
  sent: string[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeWS.all.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  /** The page closing it: the close event follows a moment later, as in a browser. */
  close(code = 1000): void {
    if (this.readyState === FakeWS.CLOSED) return;
    this.readyState = FakeWS.CLOSED;
    this.closedWith = code;
    setTimeout(() => this.onclose?.({ code }), 0);
  }
  // What the network and the server do:
  accept(): void {
    this.readyState = FakeWS.OPEN;
    this.onopen?.();
  }
  drop(code: number): void {
    this.readyState = FakeWS.CLOSED;
    this.onclose?.({ code });
  }
  receive(data: string): void {
    this.onmessage?.({ data });
  }
}

const listeners = new Map<string, Set<() => void>>();
const on = (type: string, fn: () => void) => (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
const off = (type: string, fn: () => void) => listeners.get(type)?.delete(fn);
const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn());
const doc = { visibilityState: 'visible', addEventListener: on, removeEventListener: off };
const reload = vi.fn();

let Socket: typeof import('../src/net/socket.ts').Socket;

beforeEach(async () => {
  vi.useFakeTimers();
  FakeWS.all = [];
  listeners.clear();
  doc.visibilityState = 'visible';
  reload.mockReset();
  vi.stubGlobal('WebSocket', FakeWS);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('addEventListener', on);
  vi.stubGlobal('removeEventListener', off);
  vi.stubGlobal('location', { reload });
  ({ Socket } = await import('../src/net/socket.ts'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function make() {
  const states: [string, number | undefined][] = [];
  const msgs: unknown[] = [];
  const s = new Socket({ url: () => 'wss://casino.test/ws', onMessage: (m) => msgs.push(m), onState: (st, code) => states.push([st, code]) });
  return { s, states, msgs };
}

describe('Socket', () => {
  it('a wake-up while a reconnect is still connecting does not open a second socket', () => {
    const { s } = make();
    FakeWS.all[0]!.accept();
    FakeWS.all[0]!.drop(1006);
    vi.advanceTimersByTime(30_000); // the backoff runs out: a new socket is on its way
    expect(FakeWS.all).toHaveLength(2);
    expect(s.state).toBe('reconnecting');
    // The tab comes back and the network says online, while that socket is still connecting.
    fire('visibilitychange');
    fire('online');
    expect(FakeWS.all).toHaveLength(2);
    FakeWS.all[1]!.accept();
    expect(s.state).toBe('open');
  });

  it('a wake-up during the backoff tries again at once', () => {
    make();
    FakeWS.all[0]!.accept();
    FakeWS.all[0]!.drop(1006);
    expect(FakeWS.all).toHaveLength(1);
    fire('online');
    expect(FakeWS.all).toHaveLength(2);
  });

  it("a replaced socket's late events change nothing: no stolen pong, no cleared timers, no stop", () => {
    const { s, msgs } = make();
    const first = FakeWS.all[0]!;
    first.accept();
    first.drop(1006);
    vi.advanceTimersByTime(30_000);
    const second = FakeWS.all[1]!;
    second.accept();
    // The first socket's ghost speaks up: a message, a pong, and a "replaced" close.
    first.receive(JSON.stringify({ t: 'ghost' }));
    first.receive('pong');
    first.onclose?.({ code: 4001 });
    expect(msgs).toEqual([]);
    expect(s.state).toBe('open');
    // The current socket still pings on schedule, and still gives up on a missing pong.
    vi.advanceTimersByTime(25_000);
    expect(second.sent).toEqual(['ping']);
    vi.advanceTimersByTime(10_000);
    expect(second.closedWith).toBe(4000);
  });

  it('back from sleep, an open socket is pinged at once and dropped if nothing answers', () => {
    const { s } = make();
    const ws = FakeWS.all[0]!;
    ws.accept();
    vi.advanceTimersByTime(5_000);
    fire('visibilitychange');
    expect(ws.sent).toEqual(['ping']);
    ws.receive('pong');
    vi.advanceTimersByTime(10_000);
    expect(ws.closedWith).toBeNull();
    // Asleep again, woken again, and this time the connection is dead.
    fire('online');
    vi.advanceTimersByTime(10_000);
    expect(ws.closedWith).toBe(4000);
    vi.advanceTimersByTime(1);
    expect(s.state).toBe('reconnecting');
  });

  it('pinging again while a ping is unanswered does not push its deadline back', () => {
    make();
    const ws = FakeWS.all[0]!;
    ws.accept();
    fire('online');
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(3_000);
      fire('visibilitychange');
    }
    expect(ws.closedWith).toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(ws.closedWith).toBe(4000);
  });

  it('a hidden tab does not ping or reconnect on events', () => {
    make();
    const ws = FakeWS.all[0]!;
    ws.accept();
    doc.visibilityState = 'hidden';
    fire('visibilitychange');
    expect(ws.sent).toEqual([]);
  });

  it('stops on the codes that mean "not here any more", and reloads on a version change', () => {
    for (const code of [4001, 4003, 4004, 4005]) {
      const { s, states } = make();
      const ws = FakeWS.all.at(-1)!;
      ws.accept();
      ws.drop(code);
      vi.advanceTimersByTime(60_000);
      expect(s.state).toBe('closed');
      expect(states.at(-1)).toEqual(['closed', code]);
      expect(FakeWS.all.at(-1)).toBe(ws);
    }
    make();
    FakeWS.all.at(-1)!.drop(4009);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rate limited or dropped, it backs off further each time (full jitter under a doubling cap)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    make();
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      const ws = FakeWS.all.at(-1)!;
      ws.accept();
      ws.drop(4008);
      const before = FakeWS.all.length;
      let waited = 0;
      while (FakeWS.all.length === before) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      waits.push(waited);
    }
    for (let i = 1; i < waits.length; i++) expect(waits[i]!).toBeGreaterThanOrEqual(waits[i - 1]!);
    expect(waits.at(-1)!).toBeLessThanOrEqual(30_000);
    expect(waits.at(-1)!).toBeGreaterThan(20_000);
  });

  it('close() is final: nothing reconnects, and late events from the old socket are ignored', () => {
    const { s, states } = make();
    const ws = FakeWS.all[0]!;
    ws.accept();
    s.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.all).toHaveLength(1);
    expect(states.at(-1)).toEqual(['closed', undefined]);
    expect(s.send({ t: 'sync' })).toBe(false);
  });
});
