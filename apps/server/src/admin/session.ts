import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The admin's sign-in (spec §27.3): Google (an address on ADMIN_EMAILS) or the password from the server's
 * settings, then a signed cookie.
 *
 * A session token is `<expiresAt>.<nonce>.<admin>.<mac>`: the expiry (epoch ms), 16 random bytes, who signed
 * in (base64url of `password` or `google:<email>`, so later admin actions can say who did them), and an
 * HMAC-SHA256 of the three. The key is derived from ADMIN_SESSION_SECRET *and* the admin password, so changing
 * either signs everyone out. With Google sign-in only (no password), the secret alone is the key: whoever knows
 * it can make a session for any address on ADMIN_EMAILS, so a secret set by hand is as secret as a password
 * (unset, it is random per boot). Nothing is stored on the server, except the tokens signed out before they ran
 * out (SessionKeeper.revoke), which stay refused until their expiry.
 */

const TOKEN_VERSION = 'v2';
/** The admin part: base64url of at most `google:` and a 254-character address. */
const TOKEN = /^(\d{1,15})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{1,400})\.([A-Za-z0-9_-]{43})$/;

/** Who a session belongs to: the password (one shared admin), or a Google account by its address. */
export type AdminIdentity = { method: 'password' } | { method: 'google'; email: string };

export interface VerifiedSession {
  expiresAt: number;
  admin: AdminIdentity;
}

const GOOGLE_PREFIX = 'google:';

function encodeAdmin(admin: AdminIdentity): string {
  const text = admin.method === 'password' ? 'password' : `${GOOGLE_PREFIX}${admin.email}`;
  return Buffer.from(text, 'utf8').toString('base64url');
}

function decodeAdmin(encoded: string): AdminIdentity | null {
  const text = Buffer.from(encoded, 'base64url').toString('utf8');
  if (text === 'password') return { method: 'password' };
  if (text.startsWith(GOOGLE_PREFIX) && text.length > GOOGLE_PREFIX.length) {
    return { method: 'google', email: text.slice(GOOGLE_PREFIX.length) };
  }
  return null;
}

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
  /** The admin password, or null when password sign-in is off. */
  password: string | null;
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
    this.key = hmac(options.secret, `sudoku-fight admin session ${TOKEN_VERSION}\n${options.password ?? ''}`);
  }

  /** A new token for this admin, good for `ttlMs` from now. */
  issue(admin: AdminIdentity): { token: string; expiresAt: number } {
    const expiresAt = this.options.now() + this.options.ttlMs;
    const nonce = randomBytes(16).toString('base64url');
    const who = encodeAdmin(admin);
    return { token: `${expiresAt}.${nonce}.${who}.${this.mac(expiresAt, nonce, who)}`, expiresAt };
  }

  /** The expiry and the admin of a valid, unexpired, not signed-out token; null for anything else. */
  verify(token: string | undefined): VerifiedSession | null {
    const m = token === undefined ? null : TOKEN.exec(token);
    if (m === null) return null;
    const [, exp, nonce, who, mac] = m as unknown as [string, string, string, string, string];
    const expiresAt = Number(exp);
    const expected = Buffer.from(this.mac(expiresAt, nonce, who), 'base64url');
    const actual = Buffer.from(mac, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    if (expiresAt <= this.options.now() || this.revoked.has(nonce)) return null;
    const admin = decodeAdmin(who);
    return admin === null ? null : { expiresAt, admin };
  }

  /** Signs a token out before it runs out (logout). Does nothing for an invalid one. */
  revoke(token: string | undefined): void {
    const session = this.verify(token);
    if (session === null || token === undefined) return;
    this.sweep();
    this.revoked.set(token.split('.')[1]!, session.expiresAt);
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

  private mac(expiresAt: number, nonce: string, who: string): string {
    return hmac(this.key, `${TOKEN_VERSION}.${expiresAt}.${nonce}.${who}`).toString('base64url');
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
