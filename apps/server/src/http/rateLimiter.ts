/**
 * Token buckets, one per key (an IP, an installId…): `limit` requests at once, refilled evenly over
 * `windowMs`. Pure: time comes from the injected `now`, so tests move the clock themselves.
 *
 * Memory stays bounded: a bucket that has refilled completely is the same as no bucket, so a sweep (at most
 * once per window, during take()) drops those; and past `maxKeys` the least recently used key goes first.
 */

export interface RateLimitRule {
  /** Requests allowed in a burst, and per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimiterOptions extends RateLimitRule {
  now: () => number;
  /** At most this many keys are tracked (default 50,000). */
  maxKeys?: number;
}

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterMs: number };

interface Bucket {
  tokens: number;
  at: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly perMs: number;
  private readonly maxKeys: number;
  private lastSweep: number;

  constructor(private readonly options: RateLimiterOptions) {
    const { limit, windowMs, maxKeys = 50_000 } = options;
    if (!(limit >= 1) || !(windowMs > 0) || !(maxKeys >= 1)) {
      throw new RangeError(`Bad rate limit: ${limit} per ${windowMs} ms, ${maxKeys} keys`);
    }
    this.perMs = limit / windowMs;
    this.maxKeys = maxKeys;
    this.lastSweep = options.now();
  }

  /** Keys tracked right now. */
  get size(): number {
    return this.buckets.size;
  }

  /** Takes `cost` tokens from `key`'s bucket, or says how long until there are enough. */
  take(key: string, cost = 1): RateLimitResult {
    const { limit, now } = this.options;
    if (!(cost > 0 && cost <= limit)) throw new RangeError(`Bad cost ${cost} (limit ${limit})`);
    const t = now();
    if (t - this.lastSweep >= this.options.windowMs) this.sweep(t);

    const tokens = this.tokensAt(this.buckets.get(key), t);
    // Delete and set again: a Map iterates in insertion order, so the first key is the least recently used.
    this.buckets.delete(key);
    if (tokens >= cost) {
      this.buckets.set(key, { tokens: tokens - cost, at: t });
      this.evictOverflow();
      return { ok: true, remaining: Math.floor(tokens - cost) };
    }
    this.buckets.set(key, { tokens, at: t });
    this.evictOverflow();
    return { ok: false, retryAfterMs: Math.ceil((cost - tokens) / this.perMs) };
  }

  /** Drops buckets that have refilled completely. Returns how many went. */
  sweep(t = this.options.now()): number {
    this.lastSweep = t;
    let dropped = 0;
    for (const [key, bucket] of this.buckets) {
      if (this.tokensAt(bucket, t) >= this.options.limit) {
        this.buckets.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  private tokensAt(bucket: Bucket | undefined, t: number): number {
    if (bucket === undefined) return this.options.limit;
    // A clock that steps back refills nothing.
    return Math.min(this.options.limit, bucket.tokens + Math.max(0, t - bucket.at) * this.perMs);
  }

  private evictOverflow(): void {
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done === true) return;
      this.buckets.delete(oldest.value);
    }
  }
}
