import { exports } from 'cloudflare:workers';
import type { TableServerMsg } from '../../shared/src/protocol.ts';

export const ORIGIN = 'http://localhost:5173';

/** What test accounts log in with: a new name takes it as its password, later logins bring it. */
export const TEST_PASSWORD = 'test-pass';

export async function login(name: string, password = TEST_PASSWORD): Promise<{ token: string; profile: any }> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ name, password }),
    }),
  );
  if (res.status !== 200) throw new Error(`login ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}

export async function api(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(
    new Request(`http://casino.test/casino/api/${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    }),
  );
}

/** A test client for a table socket: collects messages and lets a test wait for one. */
export class Client {
  msgs: any[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  constructor(readonly ws: WebSocket) {
    ws.accept();
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      const m = JSON.parse(e.data);
      this.msgs.push(m);
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    });
    ws.addEventListener('close', (e) => {
      this.closed = { code: e.code, reason: e.reason };
    });
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  next<T = any>(pred: (m: any) => boolean, ms = 3000): Promise<T> {
    const found = this.msgs.find(pred);
    if (found) {
      this.msgs.splice(this.msgs.indexOf(found), 1);
      return Promise.resolve(found);
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for message; got ' + JSON.stringify(this.msgs.slice(-5)))), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); resolve(m); } });
    });
  }
}

/**
 * A single-use ticket for one socket path, the way the client gets one right before connecting;
 * null when the token is refused.
 */
export async function ticketFor(path: string, token: string, ip?: string): Promise<string | null> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Authorization: `Bearer ${token}`, ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
      body: JSON.stringify({ target: path }),
    }),
  );
  return res.status === 200 ? ((await res.json()) as { ticket: string }).ticket : null;
}

/** Open a socket with a raw query (a ticket or not); `ip` is the client address the edge would report. */
export async function connectRaw(path: string, query: string, ip?: string): Promise<{ res: Response; client: Client | null }> {
  const res = await exports.default.fetch(
    new Request(`http://casino.test/casino/ws/${path}?v=1${query}`, {
      headers: { Upgrade: 'websocket', Origin: ORIGIN, ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
    }),
  );
  return { res, client: res.webSocket ? new Client(res.webSocket) : null };
}

/**
 * Open a socket as the client does: a fresh ticket for the path, then the upgrade with it. A token
 * the ticket route refuses connects with no ticket at all (and is refused, 4003).
 */
export async function connect(path: string, token: string, extra = '', ip?: string): Promise<{ res: Response; client: Client | null }> {
  const ticket = await ticketFor(path, token, ip);
  return connectRaw(path, `${ticket ? `&ticket=${encodeURIComponent(ticket)}` : ''}${extra}`, ip);
}
