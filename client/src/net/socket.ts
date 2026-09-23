// A WebSocket that reconnects on its own. Backoff is "full jitter" (a random wait up to a doubling
// cap), so a deploy that drops everyone doesn't bring them all back in the same instant. Close
// codes from the server decide whether to reconnect at all.

import { CLOSE } from '../../../shared/src/protocol.ts';

export type SocketState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SocketOptions {
  url: () => string;
  onMessage: (msg: any) => void;
  onState?: (state: SocketState, code?: number) => void;
}

const PING_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;

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
    this.ws?.close(1000, 'bye');
    this.setState('closed');
  }

  private poke = (): void => {
    if (this.stopped || document.visibilityState === 'hidden') return;
    if (this.state === 'reconnecting') {
      clearTimeout(this.retryTimer);
      this.open();
    }
  };

  private open(): void {
    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(this.opts.url());
    this.ws = ws;
    ws.onopen = () => {
      this.setState('open');
      this.stableTimer = window.setTimeout(() => (this.attempt = 0), 10_000);
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send('ping');
        this.pongTimer = window.setTimeout(() => ws.close(4000, 'no pong'), PONG_TIMEOUT_MS);
      }, PING_MS);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') {
        clearTimeout(this.pongTimer);
        return;
      }
      try {
        this.opts.onMessage(JSON.parse(e.data as string));
      } catch (err) {
        console.error('socket message handler failed', err);
      }
    };
    ws.onclose = (e) => {
      this.clearTimers();
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      // Codes that mean "don't come back" (another tab took over, the table is gone, reload).
      if (e.code === CLOSE.REPLACED || e.code === CLOSE.NOT_FOUND || e.code === CLOSE.FORBIDDEN || e.code === CLOSE.UNAUTHORIZED || e.code === CLOSE.VERSION) {
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
  }

  private setState(s: SocketState, code?: number): void {
    this.state = s;
    this.opts.onState?.(s, code);
  }
}
