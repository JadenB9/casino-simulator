import { exports } from 'cloudflare:workers';
import type { TableServerMsg } from '../../shared/src/protocol.ts';

export const ORIGIN = 'http://localhost:5173';

export async function login(name: string): Promise<{ token: string; profile: any }> {
  const res = await exports.default.fetch(
    new Request('http://casino.test/casino/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ name }),
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

/** Open a socket; `ip` is the client address the edge would report (none by default). */
export async function connect(path: string, token: string, extra = '', ip?: string): Promise<{ res: Response; client: Client | null }> {
  const res = await exports.default.fetch(
    new Request(`http://casino.test/casino/ws/${path}?v=1&t=${encodeURIComponent(token)}${extra}`, {
      headers: { Upgrade: 'websocket', Origin: ORIGIN, ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
    }),
  );
  return { res, client: res.webSocket ? new Client(res.webSocket) : null };
}
