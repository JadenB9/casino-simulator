// A WebSocket that reconnects on its own. Backoff is "full jitter" (a random wait up to a doubling
// cap), so a deploy that drops everyone doesn't bring them all back in the same instant. Close
// codes from the server decide whether to reconnect at all.
//
// Only the current socket's events count. A socket that has been replaced or closed on purpose can
// still deliver an open, a message or a close afterwards; those are ignored, so a stale close never
// stops the current socket's timers and a stale pong never vouches for it.

import { CLOSE } from '../../../shared/src/protocol.ts';

export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketOptions {
  url: () => string;
  onMessage: (msg: any) => void;
  onState?: (state: SocketState, code?: number) => void;
}

const PING_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
/** Close codes that mean "don't come back" (another tab took over, the table is gone, reload). */
const FINAL = new Set<number>([CLOSE.REPLACED, CLOSE.NOT_FOUND, CLOSE.FORBIDDEN, CLOSE.UNAUTHORIZED, CLOSE.VERSION]);

export class Socket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stableTimer = 0;
  private pingTimer = 0;
  private pongTimer = 0;
  private retryTimer = 0;
  private stopped = false;
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
    ws?.close(1000, 'bye');
    this.setState('closed');
  }

  private poke = (): void => {
    if (this.stopped || document.visibilityState === 'hidden') return;
    if (this.state === 'reconnecting' && !this.ws) {
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
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.opts.url());
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
      this.attempt++;
      const cap = Math.min(30_000, 500 * 2 ** this.attempt);
      this.setState('reconnecting', e.code);
      this.retryTimer = window.setTimeout(() => this.open(), Math.random() * cap);
    };
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
