// Signed tokens: "v1.<payload>.<signature>", HMAC-SHA256 over "v1.<payload>".
//
// Login is a name and nothing else, on purpose, so a token doesn't protect an account from
// anyone. It binds a connection to an account id the server issued (so a client can't claim
// someone else's id or solo table) and keys the rate limits.

const TOKEN_DAYS = 30;
const enc = new TextEncoder();

export interface Claims {
  /** account id */
  a: number;
  /** account name, as it was when the token was issued */
  n: string;
  /** issued / expires, unix seconds */
  iat: number;
  exp: number;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const keys = new Map<string, Promise<CryptoKey>>();

function key(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keys.set(secret, k);
  }
  return k;
}

export async function signToken(secret: string, accountId: number, name: string, nowMs: number): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const claims: Claims = { a: accountId, n: name, iat, exp: iat + TOKEN_DAYS * 86_400 };
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode('v1.' + payload));
  return `v1.${payload}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyToken(secret: string, token: string | null | undefined, nowMs: number): Promise<Claims | null> {
  if (!token || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const payload = parts[1]!;
  const sig = unb64url(parts[2]!);
  if (!sig) return null;
  const ok = await crypto.subtle.verify('HMAC', await key(secret), sig, enc.encode('v1.' + payload));
  if (!ok) return null;
  const raw = unb64url(payload);
  if (!raw) return null;
  let claims: Claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(raw)) as Claims;
  } catch {
    return null;
  }
  if (!Number.isSafeInteger(claims.a) || claims.a <= 0 || typeof claims.n !== 'string') return null;
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 < nowMs) return null;
  return claims;
}

export function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}
