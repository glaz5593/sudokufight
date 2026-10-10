/** A clock that moves only when the test says so. Starts at 2026-10-09 12:00 UTC by default. */
export interface FakeClock {
  now: () => number;
  advance(ms: number): void;
  set(t: number): void;
}

export function fakeClock(start = Date.UTC(2026, 9, 9, 12)): FakeClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (to) => {
      t = to;
    },
  };
}
