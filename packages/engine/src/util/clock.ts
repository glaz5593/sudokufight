/**
 * Time is injected (spec §6, §17). The engine reads no system clock: every function that needs "now" takes
 * it as an argument, and hosts that need a ticking clock get a Clock.
 */
export interface Clock {
  /** Milliseconds; any fixed origin works (the server uses epoch ms). */
  now(): number;
}

/** A clock that moves only when told to; for tests and replays. */
export class ManualClock implements Clock {
  constructor(private t = 0) {}
  now(): number {
    return this.t;
  }
  set(t: number): void {
    this.t = t;
  }
  advance(ms: number): number {
    this.t += ms;
    return this.t;
  }
}
