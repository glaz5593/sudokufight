/**
 * The last `capacity` samples of a measure (ms), with its percentiles (spec §18: "p95 of the action response
 * time"). Pure, no clock: the samples come in as numbers.
 */

export interface StatsSummary {
  /** Samples in the window (at most the capacity). */
  count: number;
  /** Samples ever added, including those that left the window. */
  total: number;
  /** Rounded to whole ms; null with no samples. */
  p50: number | null;
  p95: number | null;
  max: number | null;
  last: number | null;
}

/** The nearest-rank percentile (0 < p ≤ 100) of `sorted` (ascending); null when empty. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export class RollingStats {
  private readonly samples: number[] = [];
  private added = 0;

  constructor(readonly capacity = 200) {
    if (!(capacity >= 1)) throw new RangeError(`capacity must be at least 1, got ${capacity}`);
  }

  add(value: number): void {
    if (!Number.isFinite(value)) return;
    this.samples.push(value);
    if (this.samples.length > this.capacity) this.samples.shift();
    this.added++;
  }

  get count(): number {
    return this.samples.length;
  }

  /** Samples ever added. */
  get total(): number {
    return this.added;
  }

  /** The window, oldest first. */
  values(): number[] {
    return this.samples.slice();
  }

  percentile(p: number): number | null {
    return percentile(
      this.samples.slice().sort((a, b) => a - b),
      p,
    );
  }

  clear(): void {
    this.samples.length = 0;
  }

  summary(): StatsSummary {
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const round = (v: number | null) => (v === null ? null : Math.round(v));
    return {
      count: sorted.length,
      total: this.added,
      p50: round(percentile(sorted, 50)),
      p95: round(percentile(sorted, 95)),
      max: round(sorted.length ? sorted[sorted.length - 1]! : null),
      last: round(this.samples.length ? this.samples[this.samples.length - 1]! : null),
    };
  }
}
