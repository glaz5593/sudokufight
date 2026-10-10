import { RollingStats } from './rollingStats';

/**
 * The server's clock as seen from the phone (spec §18: "the client works out the difference between its clock
 * and the server's with ping and pong, and shows timers by expiresAt in server time").
 *
 * A ping carries `t`, the phone's time when it left; the pong echoes it with `serverTime`, the server's clock
 * when it answered. Assuming the server answered half way through the round trip:
 *
 *   rtt    = now − t
 *   offset = serverTime − (t + rtt / 2)        serverNow() = phone time + offset
 *
 * One sample is noisy (a round trip that was slow one way only skews it by up to rtt/2), so the offset is the
 * median of the samples with the shortest round trips among the recent ones: those are the least skewed, and
 * a median ignores the odd one out. Pure: every time comes in as an argument.
 */

export interface ClockSample {
  rttMs: number;
  offsetMs: number;
  /** Phone time when the pong came. */
  at: number;
}

export interface ClockSyncOptions {
  /** Round trips kept for the statistics (the debug screen, stage 7's "p95 over 200 samples"). */
  rttWindow?: number;
  /** Recent samples the offset is worked out from. */
  offsetWindow?: number;
  /** Of those, how many with the shortest round trips. */
  offsetBest?: number;
  /** Pings on the way at most (older ones are forgotten: lost with a drop, or never answered). */
  maxInFlight?: number;
}

export class ClockSync {
  readonly rtt: RollingStats;
  private readonly samples: ClockSample[] = [];
  private readonly inFlight: number[] = [];
  private readonly offsetWindow: number;
  private readonly offsetBest: number;
  private readonly maxInFlight: number;
  private offset: number | null = null;

  constructor({
    rttWindow = 200,
    offsetWindow = 20,
    offsetBest = 5,
    maxInFlight = 16,
  }: ClockSyncOptions = {}) {
    this.rtt = new RollingStats(rttWindow);
    this.offsetWindow = Math.max(1, offsetWindow);
    this.offsetBest = Math.max(1, offsetBest);
    this.maxInFlight = Math.max(1, maxInFlight);
  }

  /** The `t` of a ping sent at `now` (unique among those on the way). */
  ping(now: number): number {
    let t = now;
    while (this.inFlight.includes(t)) t += 0.001;
    this.inFlight.push(t);
    if (this.inFlight.length > this.maxInFlight) this.inFlight.shift();
    return t;
  }

  /** A pong received at `now`: its sample, or null when it answers no ping of ours. */
  pong(t: number, serverTime: number, now: number): ClockSample | null {
    const k = this.inFlight.indexOf(t);
    if (k < 0 || !Number.isFinite(serverTime)) return null;
    this.inFlight.splice(k, 1);
    const rttMs = Math.max(0, now - t);
    const sample: ClockSample = { rttMs, offsetMs: serverTime - (t + rttMs / 2), at: now };
    this.rtt.add(rttMs);
    this.samples.push(sample);
    if (this.samples.length > this.offsetWindow) this.samples.shift();
    this.offset = robustOffset(this.samples, this.offsetBest);
    return sample;
  }

  /** Server time minus phone time; 0 before the first pong. */
  get offsetMs(): number {
    return this.offset ?? 0;
  }

  /** At least one pong came back. */
  get synced(): boolean {
    return this.offset !== null;
  }

  /** The recent samples, oldest first. */
  get recent(): readonly ClockSample[] {
    return this.samples;
  }

  /** Pings sent and not answered yet. */
  get unanswered(): number {
    return this.inFlight.length;
  }

  /** The connection dropped: the pings on the way will never be answered. */
  forgetInFlight(): void {
    this.inFlight.length = 0;
  }
}

/** The median offset of the `best` samples with the shortest round trips. */
export function robustOffset(samples: readonly ClockSample[], best: number): number | null {
  if (samples.length === 0) return null;
  const fastest = samples
    .slice()
    .sort((a, b) => a.rttMs - b.rttMs || b.at - a.at)
    .slice(0, Math.max(1, best))
    .map((s) => s.offsetMs)
    .sort((a, b) => a - b);
  const mid = fastest.length >> 1;
  return fastest.length % 2 ? fastest[mid]! : (fastest[mid - 1]! + fastest[mid]!) / 2;
}

/**
 * The server's rate limit for a message type, kept on the phone's side (spec §21): `limit` at once, refilled
 * evenly over `windowMs`. A message over the server's limit is dropped without an answer and counts towards
 * being disconnected for abuse, so the pings never go over it.
 */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    now: number,
  ) {
    this.tokens = limit;
    this.at = now;
  }

  /** Takes a token if there is one. */
  take(now: number): boolean {
    const elapsed = Math.max(0, now - this.at);
    this.tokens = Math.min(this.limit, this.tokens + (elapsed * this.limit) / this.windowMs);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
