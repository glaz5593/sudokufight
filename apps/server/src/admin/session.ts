import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The admin's sign-in (spec §27.3): one password from the server's settings, and a signed cookie.
 *
 * A session token is `<expiresAt>.<nonce>.<mac>`: the expiry (epoch ms), 16 random bytes, and an
 * HMAC-SHA256 of both. The key is derived from ADMIN_SESSION_SECRET *and* the admin password, so changing
 * either signs everyone out. Nothing is stored on the server, except the tokens signed out before they ran
 * out (SessionKeeper.revoke), which stay refused until their expiry.
 */

const TOKEN_VERSION = 'v1';
const TOKEN = /^(\d{1,15})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/**
 * Compares a typed password with the right one in constant time: both go through an HMAC first, so the
 * comparison sees two 32-byte digests whatever the lengths (timingSafeEqual needs equal lengths, and a length
 * check of its own would leak the password's length).
 */
export function passwordMatches(given: string, expected: string): boolean {
  const key = randomBytes(32);
  return timingSafeEqual(hmac(key, given), hmac(key, expected));
}

export interface SessionKeeperOptions {
  secret: string;
  password: string;
  ttlMs: number;
  now: () => number;
  /** Signed-out tokens remembered at most (the oldest go first). Default 10,000. */
  maxRevoked?: number;
}

export class SessionKeeper {
  private readonly key: Buffer;
  /** nonce → expiresAt of tokens signed out early. */
  private readonly revoked = new Map<string, number>();

  constructor(private readonly options: SessionKeeperOptions) {
    this.key = hmac(options.secret, `sudoku-fight admin session ${TOKEN_VERSION}\n${options.password}`);
  }

  /** A new token, good for `ttlMs` from now. */
  issue(): { token: string; expiresAt: number } {
    const expiresAt = this.options.now() + this.options.ttlMs;
    const nonce = randomBytes(16).toString('base64url');
    return { token: `${expiresAt}.${nonce}.${this.mac(expiresAt, nonce)}`, expiresAt };
  }

  /** The expiry of a valid, unexpired, not signed-out token; null for anything else. */
  verify(token: string | undefined): number | null {
    const m = token === undefined ? null : TOKEN.exec(token);
    if (m === null) return null;
    const [, exp, nonce, mac] = m as unknown as [string, string, string, string];
    const expiresAt = Number(exp);
    const expected = Buffer.from(this.mac(expiresAt, nonce), 'base64url');
    const actual = Buffer.from(mac, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    if (expiresAt <= this.options.now() || this.revoked.has(nonce)) return null;
    return expiresAt;
  }

  /** Signs a token out before it runs out (logout). Does nothing for an invalid one. */
  revoke(token: string | undefined): void {
    const expiresAt = this.verify(token);
    if (expiresAt === null || token === undefined) return;
    this.sweep();
    this.revoked.set(token.split('.')[1]!, expiresAt);
    const max = this.options.maxRevoked ?? 10_000;
    for (const nonce of this.revoked.keys()) {
      if (this.revoked.size <= max) break;
      this.revoked.delete(nonce);
    }
  }

  /** Signed-out tokens remembered right now. */
  get revokedCount(): number {
    return this.revoked.size;
  }

  private sweep(): void {
    const now = this.options.now();
    for (const [nonce, expiresAt] of this.revoked) if (expiresAt <= now) this.revoked.delete(nonce);
  }

  private mac(expiresAt: number, nonce: string): string {
    return hmac(this.key, `${TOKEN_VERSION}.${expiresAt}.${nonce}`).toString('base64url');
  }
}

/** One cookie's value from a Cookie header, or undefined. Names are compared exactly. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}
