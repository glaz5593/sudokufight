import { type Clock, createRng, type Digit, shuffled } from '@sudoku-fight/engine';

import { KEYPAD } from './config';
import { elapsedOf, type HitTime, remainingOf } from './hitClock';

/**
 * [D47] "מקלדת מתערבלת" (`keypad`), Moshe 2026-10-17: while it hits me, the nine digit keys trade places every
 * 1.5 s. Only where a key stands changes: each key still enters the digit printed on it, with its own count and
 * state, and the row stays LTR (1–9 is just no longer in order for 5 s). Reduced motion: one order for the
 * whole hit, in and out with a fade.
 *
 * Fair to the finger (KEYPAD in config.ts): no key moves while a finger is on the keypad, nor for a moment
 * after one lifts (the moves wait, then catch up), and a press that started while the keys were still moving
 * into place does not count. The orders come from the hit's seed (the game and the interference's event), so
 * a hit always moves the same way.
 */

export type KeypadConfig = typeof KEYPAD;

const DIGITS: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** The keys in their usual order: slot k holds digit k + 1. */
export const NATURAL_ORDER: readonly Digit[] = DIGITS;

export interface KeypadPlan {
  everyMs: number;
  totalMs: number;
  /** The order of each step (which digit stands in each slot, left to right): every key moves each time. */
  orders: readonly (readonly Digit[])[];
}

/** No key stays where it was: every key visibly moves at each step. */
const movesEveryKey = (from: readonly Digit[], to: readonly Digit[]): boolean =>
  to.every((d, slot) => from[slot] !== d);

/** The orders of one hit of `totalMs`, one per `everyMs` step from its start. */
export function keypadPlan(seed: number, totalMs: number, cfg: KeypadConfig = KEYPAD): KeypadPlan {
  const rng = createRng(seed ^ 0x6b3d);
  const steps = Math.max(1, Math.ceil(totalMs / cfg.everyMs));
  const orders: Digit[][] = [];
  let last: readonly Digit[] = NATURAL_ORDER;
  for (let k = 0; k < steps; k++) {
    let next = shuffled(rng, DIGITS);
    // About a third of the shuffles move every key; a handful of tries is enough (and still deterministic).
    for (let tries = 0; tries < 50 && !movesEveryKey(last, next); tries++) next = shuffled(rng, DIGITS);
    orders.push(next);
    last = next;
  }
  return { everyMs: cfg.everyMs, totalMs, orders };
}

/** The order the keys should be in at `elapsed` ms into the hit; reduced motion keeps the first one. */
export function keypadOrderAt(plan: KeypadPlan, elapsed: number, reduce: boolean): readonly Digit[] {
  if (reduce) return plan.orders[0]!;
  const k = Math.min(plan.orders.length - 1, Math.max(0, Math.floor(elapsed / plan.everyMs)));
  return plan.orders[k]!;
}

/** The slot a digit's key stands in (0 = the left end). */
export const slotOf = (order: readonly Digit[] | null, digit: Digit): number =>
  order ? order.indexOf(digit) : digit - 1;

const sameOrder = (a: readonly Digit[] | null, b: readonly Digit[] | null): boolean =>
  a === b || (a !== null && b !== null && a.every((d, k) => b[k] === d));

/** A finger count this old (no touch event since) is taken as lifted: a lost lift must not freeze the keys. */
export const STUCK_FINGERS_MS = 10_000;

/** The hit as the shuffler needs it: its time, and the seed of its orders. */
export interface KeypadHit extends HitTime {
  seed: number;
}

/**
 * The keys' order through a 'keypad' hit, on the game clock, with the finger guards. Plain JS with timers (the
 * keys move a few times a second at most): the game screen's hook (useKeypadShuffle) feeds it the hit and
 * renders `order()`; the keypad tells it where the fingers are and asks it whether a press counts.
 */
export class KeypadShuffler {
  private hit: KeypadHit | null = null;
  private reduce = false;
  private plan: KeypadPlan | null = null;
  private current: readonly Digit[] | null = null;
  private down = 0;
  private releasedAt = Number.NEGATIVE_INFINITY;
  private movedAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly clock: Clock,
    private readonly cfg: KeypadConfig = KEYPAD,
  ) {}

  /** The order the keys stand in now (null: 1–9). */
  readonly order = (): readonly Digit[] | null => this.current;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The 'keypad' hit on me (null when there is none, or it ended), and the motion setting. */
  update(hit: KeypadHit | null, reduce: boolean): void {
    const samePlan =
      hit !== null && this.hit !== null && hit.seed === this.hit.seed && hit.totalMs === this.hit.totalMs;
    if (!samePlan) this.plan = hit ? keypadPlan(hit.seed, hit.totalMs, this.cfg) : null;
    this.hit = hit;
    this.reduce = reduce;
    this.sync();
  }

  /**
   * How many fingers are on the keys now, after each touch event on the keypad: while one is down, nothing moves.
   * The keypad counts them by touch id (fingersOnKeys in board/Keypad), never by adding up event sizes: on iOS
   * the touches of one frame come as one event, sent once to each key they landed on. A count left over from a
   * lost lift (no event for STUCK_FINGERS_MS) is dropped, so the keys can't freeze for good.
   */
  readonly fingers = (count: number): void => {
    const now = this.clock.now();
    const before = this.fingersAt(now);
    this.down = Math.max(0, count);
    this.touchedAt = now;
    if (before > 0 && this.down === 0) {
      this.releasedAt = now;
      this.sync();
    }
  };

  private touchedAt = Number.NEGATIVE_INFINITY;

  private fingersAt(now: number): number {
    return now - this.touchedAt > STUCK_FINGERS_MS ? 0 : this.down;
  }

  /** Whether a press starting now counts: not while the keys are still moving into place, nor just after. */
  readonly settled = (): boolean => {
    const move = this.reduce ? this.cfg.fadeMs : this.cfg.moveMs;
    return this.clock.now() >= this.movedAt + move + this.cfg.guardMs;
  };

  /** Stops its timer (the screen is going away). */
  dispose(): void {
    this.clear();
  }

  /** The order the clock asks for now. */
  private wanted(now: number): readonly Digit[] | null {
    const { hit, plan } = this;
    if (!hit || !plan || remainingOf(hit, now) <= 0) return null;
    return keypadOrderAt(plan, elapsedOf(hit, now), this.reduce);
  }

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private later(ms: number) {
    this.clear();
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.sync();
      },
      Math.max(0, ms),
    );
  }

  /** Moves the keys if the clock says so and no finger is in the way, then waits for the next move. */
  private sync() {
    this.clear();
    const now = this.clock.now();
    const want = this.wanted(now);
    if (!sameOrder(want, this.current)) {
      // A finger is down: wait for it to lift (fingers() comes back here). Just lifted: wait a moment.
      if (this.fingersAt(now) > 0) return this.later(this.touchedAt + STUCK_FINGERS_MS + 1 - now);
      const wait = this.releasedAt + this.cfg.freezeMs - now;
      if (wait > 0) return this.later(wait);
      this.current = want;
      this.movedAt = now;
      this.listeners.forEach((l) => l());
    }
    // The next move: the next step, or the end. Nothing moves while the game is frozen (endsAt null).
    const { hit, plan } = this;
    if (!hit || !plan || hit.endsAt === null || want === null) return;
    const elapsed = elapsedOf(hit, now);
    const nextStep = this.reduce ? hit.totalMs : (Math.floor(elapsed / plan.everyMs) + 1) * plan.everyMs;
    this.later(Math.min(nextStep, hit.totalMs) - elapsed);
  }
}

/** The rumble of a keypad hit: a light knock each time the keys trade places (not the first: the start cue). */
export function keypadRumble(totalMs: number, cfg: KeypadConfig = KEYPAD): number[] {
  const times: number[] = [];
  for (let at = cfg.everyMs; at < totalMs; at += cfg.everyMs) times.push(at);
  return times;
}
