import type { Clock } from '@sudoku-fight/engine';
import { useEffect } from 'react';
import { type SharedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

/**
 * The time of an interference on screen (spec §7.2: exactly 5 s). The effects never run a timer of their
 * own: where they are in their 5 s comes from the game's clock and the hit's `endsAt`, the same numbers the
 * engine (and later the server) uses to end it.
 */
export interface HitTime {
  /** When it ends, in the game's clock; null while the game is frozen (spec §16.2), then `remainingMs`. */
  endsAt: number | null;
  /** Time left while frozen (the view's `remainingMs`). Ignored while `endsAt` is set. */
  remainingMs?: number;
  /** Its whole length: the rules' `interferenceMs`. */
  totalMs: number;
}

/** Time left at `now`, never below 0. */
export function remainingOf(hit: HitTime, now: number): number {
  if (hit.endsAt === null) return Math.max(0, hit.remainingMs ?? 0);
  return Math.max(0, hit.endsAt - now);
}

/** How far into its `totalMs` the hit is at `now` (0 … totalMs). */
export function elapsedOf(hit: HitTime, now: number): number {
  return Math.min(hit.totalMs, Math.max(0, hit.totalMs - remainingOf(hit, now)));
}

/**
 * The effect's opacity at `elapsed`: in over `fadeIn` from its start, out over the last `fadeOut` before its
 * end, and 0 from the end on, so nothing of it is left at `endsAt`.
 */
export function hitAlpha(elapsed: number, total: number, fadeIn: number, fadeOut: number): number {
  'worklet';
  if (elapsed >= total) return 0;
  const enter = fadeIn > 0 ? Math.min(1, Math.max(0, elapsed) / fadeIn) : 1;
  const leave = fadeOut > 0 ? Math.min(1, (total - elapsed) / fadeOut) : 1;
  return Math.max(0, Math.min(enter, leave));
}

/**
 * Where the hit is in its time, in ms (0 … totalMs), on the UI thread: a shared value the effects read in
 * their worklets, so nothing re-renders per frame (spec §22: 60 fps).
 *
 * It is set from the game clock whenever the hit's deadline changes (a new hit, or a freeze that moved
 * `endsAt`), then follows the display's frame timestamps from there: one frame callback, no JS timer. While
 * the game is frozen (`endsAt` null) it stands still. The React side ends the effect by `now >= endsAt`; the
 * worklets reach their end on the same instant, so the fade-out is finished exactly at `endsAt`.
 */
export function useHitClock(hit: HitTime | null, clock: Clock): SharedValue<number> {
  const elapsed = useSharedValue(0);
  const base = useSharedValue(0);
  const anchor = useSharedValue(-1);
  const total = useSharedValue(0);

  const frame = useFrameCallback((info) => {
    'worklet';
    if (anchor.get() < 0) anchor.set(info.timestamp);
    elapsed.set(Math.min(total.get(), base.get() + info.timestamp - anchor.get()));
  }, false);

  const on = hit !== null;
  const endsAt = hit?.endsAt ?? null;
  const frozenLeft = hit && hit.endsAt === null ? Math.max(0, hit.remainingMs ?? 0) : 0;
  const totalMs = hit?.totalMs ?? 0;

  useEffect(() => {
    if (!on) {
      frame.setActive(false);
      return;
    }
    const start = elapsedOf({ endsAt, remainingMs: frozenLeft, totalMs }, clock.now());
    total.set(totalMs);
    base.set(start);
    anchor.set(-1);
    elapsed.set(start);
    frame.setActive(endsAt !== null && start < totalMs);
    return () => frame.setActive(false);
  }, [on, endsAt, frozenLeft, totalMs, clock, frame, elapsed, base, anchor, total]);

  return elapsed;
}
