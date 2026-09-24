// A WebSocket that reconnects on its own. Backoff is "full jitter" (a random wait up to a doubling
// cap), so a deploy that drops everyone doesn't bring them all back in the same instant. Close
// codes from the server decide whether to reconnect at all.
//
// Only the current socket's events count. A socket that has been replaced or closed on purpose can
// still deliver an open, a message or a close afterwards; those are ignored, so a stale close never
// stops the current socket's timers and a stale pong never vouches for it.
//
// Every attempt asks for its URL afresh: the casino's sockets open with a single-use ticket that is
// good for a minute (net/api.ts socketUrl), so a reconnect after sleep or in a storm gets a new one.
// One attempt at a time, while its ticket is on the way too.

import { CLOSE } from '../../../shared/src/protocol.ts';

export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketOptions {
  /** The URL for the next attempt, asked for on every one; an error with status 401 means log in again. */
  url: () => string | Promise<string>;
  onMessage: (msg: any) => void;
  onState?: (state: SocketState, code?: number) => void;
}

const PING_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
/**
 * Close codes that mean "don't come back" (another tab took over, the table is gone, reload, or
 * away too long: the app offers Come back instead). A normal close (1000) from the other end is
 * final too: the server only says it after being asked to (a table's "left the table"), and coming
 * back would open a socket with a fresh ticket just for the page to throw it away.
 */
const FINAL = new Set<number>([1000, CLOSE.REPLACED, CLOSE.NOT_FOUND, CLOSE.FORBIDDEN, CLOSE.UNAUTHORIZED, CLOSE.VERSION, CLOSE.IDLE]);

export class Socket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stableTimer = 0;
  private pingTimer = 0;
  private pongTimer = 0;
  private retryTimer = 0;
  private stopped = false;
  /** An attempt is waiting for its URL (a ticket): nothing else starts one meanwhile. */
  private opening = false;
  state: SocketState = 'connecting';

  constructor(private readonly opts: SocketOptions) {
    this.open();
    addEventListener('online', this.poke);
    document.addEventListener('visibilitychange', this.poke);
  }

  send(msg: unknown): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.stopped = true;
    removeEventListener('online', this.poke);
    document.removeEventListener('visibilitychange', this.poke);
    clearTimeout(this.retryTimer);
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    // one still connecting is closed once it opens: closing it mid-handshake makes the browser
    // log a warning ("closed before the connection is established"), and the server hangs up anyway
    if (ws?.readyState === WebSocket.CONNECTING) {
      ws.onopen = () => ws.close(1000, 'bye');
      ws.onerror = () => {};
    } else ws?.close(1000, 'bye');
    this.setState('closed');
  }

  private poke = (): void => {
    if (this.stopped || document.visibilityState === 'hidden') return;
    if (this.state === 'reconnecting' && !this.ws && !this.opening) {
      // Waiting out a backoff: the network (or the tab) is back, so try now. A socket already on
      // its way is left to finish; opening another would race it for the seat.
      clearTimeout(this.retryTimer);
      this.open();
    } else if (this.state === 'open') {
      // Back from sleep or onto another network: a socket that still looks open is often dead,
      // and no close arrives until TCP gives up. Ask now instead of at the next interval.
      this.ping();
    }
  };

  /** Send a ping; no pong within PONG_TIMEOUT_MS closes the socket, which reconnects. */
  private ping(): void {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send('ping');
    // A ping still unanswered keeps its deadline: pinging again mustn't push it back, or a page
    // woken often enough would never notice its socket died.
    if (this.pongTimer) return;
    this.pongTimer = window.setTimeout(() => {
      this.pongTimer = 0;
      ws.close(4000, 'no pong');
    }, PONG_TIMEOUT_MS);
  }

  private open(): void {
    if (this.opening || this.stopped) return;
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let url: string | Promise<string>;
    try {
      url = this.opts.url();
    } catch (err) {
      url = Promise.reject(err);
    }
    if (typeof url === 'string') {
      this.connect(url);
      return;
    }
    this.opening = true;
    url.then(
      (u) => {
        this.opening = false;
        if (!this.stopped) this.connect(u);
      },
      (err: unknown) => {
        this.opening = false;
        if (this.stopped) return;
        // The token itself was refused: back to logging in, as a 4003 close would say.
        if ((err as { status?: number } | null)?.status === 401) {
          this.stopped = true;
          this.setState('closed', CLOSE.UNAUTHORIZED);
          return;
        }
        // Offline, or the casino didn't answer: try again after the same backoff as a drop.
        this.retry();
      },
    );
  }

  private connect(url: string): void {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.setState('open');
      this.stableTimer = window.setTimeout(() => (this.attempt = 0), 10_000);
      this.pingTimer = window.setInterval(() => this.ping(), PING_MS);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      if (e.data === 'pong') {
        clearTimeout(this.pongTimer);
        this.pongTimer = 0;
        return;
      }
      try {
        this.opts.onMessage(JSON.parse(e.data as string));
      } catch (err) {
        console.error('socket message handler failed', err);
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.clearTimers();
      this.ws = null;
      if (this.stopped) return;
      if (FINAL.has(e.code)) {
        this.stopped = true;
        this.setState('closed', e.code);
        if (e.code === CLOSE.VERSION) location.reload();
        return;
      }
      this.retry(e.code);
    };
  }

  /** Wait a random time under a doubling cap, then open again. */
  private retry(code?: number): void {
    this.attempt++;
    const cap = Math.min(30_000, 500 * 2 ** this.attempt);
    this.setState('reconnecting', code);
    this.retryTimer = window.setTimeout(() => this.open(), Math.random() * cap);
  }

  private clearTimers(): void {
    clearTimeout(this.stableTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.pongTimer);
    this.pongTimer = 0;
  }

  private setState(s: SocketState, code?: number): void {
    this.state = s;
    this.opts.onState?.(s, code);
  }
}
