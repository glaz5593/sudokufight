import type { ManualClock } from './clock';

/** Timers are injected too: the app passes the platform's, tests pass a ManualScheduler. */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Timers driven by a ManualClock: nothing runs until the test moves time forward. */
export class ManualScheduler implements Scheduler {
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private nextId = 1;

  constructor(readonly clock: ManualClock) {}

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, at: this.clock.now() + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((t) => t.id !== handle);
  }

  get pending(): number {
    return this.timers.length;
  }

  /** Moves time forward by `ms`, running every timer that falls due, in time order, at its own time. */
  advance(ms: number): void {
    const end = this.clock.now() + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      if (due.at > this.clock.now()) this.clock.set(due.at);
      due.fn();
    }
    this.clock.set(end);
  }
}
