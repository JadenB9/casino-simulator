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

  it('stops on the codes that mean "not here any more" (away too long included), and reloads on a version change', () => {
    for (const code of [1000, 4001, 4003, 4004, 4005, 4010]) {
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

  describe('with a ticket per attempt (an async URL)', () => {
    /** A URL source whose calls the test resolves or rejects by hand. */
    function tickets() {
      const pending: { resolve: (u: string) => void; reject: (e: unknown) => void }[] = [];
      let n = 0;
      const url = () =>
        new Promise<string>((resolve, reject) => {
          n++;
          pending.push({ resolve, reject });
        });
      return { url, pending, calls: () => n };
    }
    const flush = async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };

    it('asks for a fresh URL on every attempt, and connects with it', async () => {
      const t = tickets();
      const s = new Socket({ url: t.url, onMessage: () => {} });
      expect(FakeWS.all).toHaveLength(0);
      t.pending[0]!.resolve('wss://casino.test/ws?ticket=one');
      await flush();
      expect(FakeWS.all.map((w) => w.url)).toEqual(['wss://casino.test/ws?ticket=one']);
      FakeWS.all[0]!.accept();
      FakeWS.all[0]!.drop(1006);
      vi.advanceTimersByTime(30_000);
      expect(t.calls()).toBe(2);
      t.pending[1]!.resolve('wss://casino.test/ws?ticket=two');
      await flush();
      expect(FakeWS.all.map((w) => w.url)).toEqual(['wss://casino.test/ws?ticket=one', 'wss://casino.test/ws?ticket=two']);
      expect(s.state).toBe('reconnecting');
    });

    it('a refused token ends it as a 4003 would (back to logging in), with no retry', async () => {
      const t = tickets();
      const states: [string, number | undefined][] = [];
      const s = new Socket({ url: t.url, onMessage: () => {}, onState: (st, code) => states.push([st, code]) });
      t.pending[0]!.reject(Object.assign(new Error('Log in again.'), { status: 401 }));
      await flush();
      vi.advanceTimersByTime(60_000);
      expect(s.state).toBe('closed');
      expect(states.at(-1)).toEqual(['closed', 4003]);
      expect(t.calls()).toBe(1);
      expect(FakeWS.all).toHaveLength(0);
    });

    it('offline, or the casino not answering: it tries again after a backoff, and gets there', async () => {
      const t = tickets();
      const s = new Socket({ url: t.url, onMessage: () => {} });
      t.pending[0]!.reject(new TypeError('Failed to fetch'));
      await flush();
      expect(s.state).toBe('reconnecting');
      vi.advanceTimersByTime(30_000);
      expect(t.calls()).toBe(2);
      t.pending[1]!.resolve('wss://casino.test/ws?ticket=later');
      await flush();
      expect(FakeWS.all).toHaveLength(1);
      FakeWS.all[0]!.accept();
      expect(s.state).toBe('open');
    });

    it('a wake-up while a ticket is on its way does not start a second attempt', async () => {
      const t = tickets();
      new Socket({ url: t.url, onMessage: () => {} });
      t.pending[0]!.reject(new TypeError('Failed to fetch'));
      await flush();
      fire('online'); // back online: try now...
      expect(t.calls()).toBe(2);
      fire('visibilitychange'); // ...and a tab switch meanwhile changes nothing
      fire('online');
      expect(t.calls()).toBe(2);
      t.pending[1]!.resolve('wss://casino.test/ws?ticket=once');
      await flush();
      expect(FakeWS.all).toHaveLength(1);
    });

    it('closed while a ticket was on its way: no socket opens when it arrives', async () => {
      const t = tickets();
      const s = new Socket({ url: t.url, onMessage: () => {} });
      s.close();
      t.pending[0]!.resolve('wss://casino.test/ws?ticket=late');
      await flush();
      expect(FakeWS.all).toHaveLength(0);
      expect(s.state).toBe('closed');
    });
  });

  it('closed while still connecting, the socket is closed once it opens, not mid-handshake', () => {
    const { s } = make();
    const ws = FakeWS.all[0]!;
    s.close();
    expect(ws.closedWith).toBe(null);
    ws.accept();
    expect(ws.closedWith).toBe(1000);
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.all).toHaveLength(1);
    expect(s.state).toBe('closed');
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
