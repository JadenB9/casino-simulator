// Small HTTP helpers for the gateway: JSON responses, CORS and the Origin allowlist.

import type { ErrorCode, HttpError } from '../../shared/src/protocol.ts';

/**
 * ALLOWED_ORIGINS is a comma-separated list; an entry ending in ":*" matches any port, so local
 * development can say "http://localhost:*".
 */
export function originAllowed(origin: string | null, allowed: string): boolean {
  if (!origin) return false;
  for (const raw of allowed.split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.endsWith(':*')) {
      const base = entry.slice(0, -2);
      if (origin === base || (origin.startsWith(base + ':') && /^\d+$/.test(origin.slice(base.length + 1)))) return true;
    } else if (origin === entry) {
      return true;
    }
  }
  return false;
}

export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  if (!origin || !originAllowed(origin, allowed)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function fail(status: number, error: ErrorCode, msg: string, headers: Record<string, string> = {}, extra: Partial<HttpError> = {}): Response {
  const body: HttpError = { error, msg, ...extra };
  return json(body, status, headers);
}

/**
 * Read a JSON body of at most `limit` bytes, or null. A body sent without a Content-Length
 * (chunked) is read only up to the limit, never buffered whole.
 */
export async function readJson(request: Request, limit = 2048): Promise<unknown> {
  const len = Number(request.headers.get('Content-Length') ?? '0');
  if (len > limit) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Answer a WebSocket upgrade with an immediate close carrying an application code, so the client
 * learns why (a refused upgrade only ever shows up in the browser as a bare 1006).
 */
export function closeWith(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}
