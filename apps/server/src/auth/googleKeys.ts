import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose';

/**
 * The public keys Firebase signs ID tokens with: Google's "securetoken" JWK set, fetched over HTTPS and
 * cached for as long as its Cache-Control says (Google rotates them every few hours; max-age tells when).
 *
 * - One fetch at a time: concurrent requests share it.
 * - A token whose key id is not in the cached set (a fresh rotation) triggers a refresh, at most once per
 *   `refreshCooldownMs`, so tokens with made-up key ids can't make the server hammer Google.
 * - When Google can't be reached: stale keys keep working for `staleGraceMs` past their expiry; without any
 *   keys every check fails with KeysUnavailableError (the routes answer 503 `unavailable`, not 401, so the
 *   app does not sign the player out), and the next try waits `failureCooldownMs`.
 *
 * Time comes from `now` and the network from `fetch`, both injected: tests never call Google.
 */

export const GOOGLE_SECURETOKEN_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** The keys could not be fetched (network, HTTP error, or not a JWK set). */
export class KeysUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KeysUnavailableError';
  }
}

export interface GoogleKeysOptions {
  now: () => number;
  /** Default: the global fetch. */
  fetch?: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  url?: string;
  /** Cache this long when the answer has no max-age (default 1 hour). */
  defaultMaxAgeMs?: number;
  /** max-age is kept between these (default 1 minute and 1 day). */
  minMaxAgeMs?: number;
  maxMaxAgeMs?: number;
  /** At most one refresh for an unknown key id per this many ms (default 1 minute). */
  refreshCooldownMs?: number;
  /** After a failed fetch, wait this long before trying again (default 10 seconds). */
  failureCooldownMs?: number;
  /** Expired keys stay usable this long while Google can't be reached (default 1 day). */
  staleGraceMs?: number;
  /** Per fetch (default 5 seconds). */
  timeoutMs?: number;
  /** Where a failed refresh is reported (default console.warn). */
  warn?: (message: string) => void;
}

export interface GoogleKeys {
  /** For jose's jwtVerify(). Rejects with KeysUnavailableError, or jose's JWKSNoMatchingKey. */
  getKey: JWTVerifyGetKey;
  /** Fetches made so far (tests, logs). */
  readonly fetches: number;
}

interface Cached {
  getKey: ReturnType<typeof createLocalJWKSet>;
  fetchedAt: number;
  expiresAt: number;
}

/** Seconds of freshness left in an answer: Cache-Control max-age minus Age. Null without a max-age. */
export function freshnessMs(cacheControl: string | null, age: string | null): number | null {
  const m = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?\s*(?:,|$)/i.exec(cacheControl ?? '');
  if (m === null) return null;
  const ageSec = /^\d+$/.test(age?.trim() ?? '') ? Number(age) : 0;
  return Math.max(0, Number(m[1]) - ageSec) * 1000;
}

function isJwkSet(body: unknown): body is JSONWebKeySet {
  if (typeof body !== 'object' || body === null) return false;
  const { keys } = body as { keys?: unknown };
  return Array.isArray(keys) && keys.length > 0 && keys.every((k) => typeof k === 'object' && k !== null);
}

export function googleKeys(options: GoogleKeysOptions): GoogleKeys {
  const {
    now,
    fetch: fetchFn = (url, init) => fetch(url, init),
    url = GOOGLE_SECURETOKEN_JWKS_URL,
    defaultMaxAgeMs = 3_600_000,
    minMaxAgeMs = 60_000,
    maxMaxAgeMs = 86_400_000,
    refreshCooldownMs = 60_000,
    failureCooldownMs = 10_000,
    staleGraceMs = 86_400_000,
    timeoutMs = 5_000,
    warn = (message: string) => console.warn(message),
  } = options;

  let cached: Cached | null = null;
  let inflight: Promise<Cached> | null = null;
  let failedAt: number | null = null;
  let fetches = 0;

  async function fetchKeys(): Promise<Cached> {
    fetches++;
    let res: Response;
    try {
      res = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      });
    } catch (err) {
      throw new KeysUnavailableError(`Google's token keys: ${(err as Error).message}`, { cause: err });
    }
    if (!res.ok) throw new KeysUnavailableError(`Google's token keys: HTTP ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new KeysUnavailableError("Google's token keys: not JSON", { cause: err });
    }
    if (!isJwkSet(body)) throw new KeysUnavailableError("Google's token keys: not a JWK set");
    const fresh = freshnessMs(res.headers.get('cache-control'), res.headers.get('age')) ?? defaultMaxAgeMs;
    const t = now();
    return {
      getKey: createLocalJWKSet(body),
      fetchedAt: t,
      expiresAt: t + Math.min(maxMaxAgeMs, Math.max(minMaxAgeMs, fresh)),
    };
  }

  /** Fetches (or joins the fetch in flight), and keeps the result. */
  function refresh(): Promise<Cached> {
    if (inflight !== null) return inflight;
    if (failedAt !== null && now() - failedAt < failureCooldownMs) {
      return Promise.reject(new KeysUnavailableError("Google's token keys: unreachable, retrying shortly"));
    }
    inflight = fetchKeys().then(
      (keys) => {
        cached = keys;
        failedAt = null;
        inflight = null;
        return keys;
      },
      (err: unknown) => {
        failedAt = now();
        inflight = null;
        throw err;
      },
    );
    return inflight;
  }

  async function current(): Promise<Cached> {
    const keys = cached;
    if (keys === null) return refresh();
    if (now() < keys.expiresAt) return keys;
    try {
      return await refresh();
    } catch (err) {
      if (now() - keys.expiresAt > staleGraceMs) throw err;
      warn(`[auth] ${(err as Error).message}; using the cached keys for now`);
      return keys;
    }
  }

  const getKey: JWTVerifyGetKey = async (header, token) => {
    const keys = await current();
    try {
      return await keys.getKey(header, token);
    } catch (err) {
      // A key id we don't have: Google may have rotated. Look again, now and then.
      if (!(err instanceof errors.JWKSNoMatchingKey) || now() - keys.fetchedAt < refreshCooldownMs) throw err;
      const fresh = await refresh();
      return fresh.getKey(header, token);
    }
  };

  return {
    getKey,
    get fetches() {
      return fetches;
    },
  };
}
