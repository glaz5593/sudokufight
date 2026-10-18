import type { Clock, Digit } from '@sudoku-fight/engine';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { KeypadGuard } from '../../../components/board/Keypad';
import { KEYPAD } from '../../../components/interference/config';
import { KeypadShuffler } from '../../../components/interference/keypadModel';
import { type HitInfo, hitSeedOf, isHitOn } from './hitModel';

export interface KeypadShuffleOptions {
  /** The interference on me, or null: only a 'keypad' one moves the keys. */
  hit: HitInfo | null;
  /** The game clock's time, as the screen last rendered it. */
  now: number;
  clock: Clock;
  reduce: boolean;
  /**
   * A press dropped because the keys were still moving: the screen's light nudge (cue('nudge')). Pass a stable
   * function: the guard is made again when it changes.
   */
  onRefused: (digit: Digit) => void;
}

export interface KeypadShuffle {
  /** Which digit's key stands in each slot, left to right; null: 1–9 as always. */
  order: readonly Digit[] | null;
  /** For the keypad: where the fingers are, and whether a press counts (stable while `reduce` is). */
  guard: KeypadGuard;
}

/**
 * [D47] "מקלדת מתערבלת" on my keypad (Moshe 2026-10-17): while a 'keypad' hit is on me, the order the keys stand
 * in, from the game clock (KeypadShuffler: every 1.5 s, never under a finger), and the guards the keypad needs.
 * Pass both to <Keypad order guard>. A press that started while the keys were still moving is dropped (it is
 * never sent), and `onRefused` gives the light nudge.
 */
export function useKeypadShuffle({
  hit,
  now,
  clock,
  reduce,
  onRefused,
}: KeypadShuffleOptions): KeypadShuffle {
  const [shuffler] = useState(() => new KeypadShuffler(clock));
  const on = hit !== null && hit.kind === 'keypad' && isHitOn(hit, now);
  const endsAt = on ? hit.endsAt : null;
  const remainingMs = on ? (hit.remainingMs ?? 0) : 0;
  const totalMs = on ? hit.totalMs : 0;
  const seed = on ? hitSeedOf(hit) : 0;

  useEffect(() => {
    shuffler.update(on ? { endsAt, remainingMs, totalMs, seed } : null, reduce);
  }, [shuffler, on, endsAt, remainingMs, totalMs, seed, reduce]);
  useEffect(() => () => shuffler.dispose(), [shuffler]);

  const order = useSyncExternalStore(shuffler.subscribe, shuffler.order);
  // One object while nothing it holds changes (the keypad is memoised on it).
  const guard = useMemo<KeypadGuard>(
    () => ({
      fingers: shuffler.fingers,
      settled: shuffler.settled,
      refused: onRefused,
      reduce,
      moveMs: KEYPAD.moveMs,
      fadeMs: KEYPAD.fadeMs,
    }),
    [shuffler, reduce, onRefused],
  );
  return { order, guard };
}
