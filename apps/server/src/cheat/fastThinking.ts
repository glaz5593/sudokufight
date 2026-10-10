import type { GameEvent, PlayerId } from '@sudoku-fight/engine';

import type { CheatThresholds } from '../config';

/**
 * Anomaly detection (spec §21): "an average think time below 1.2 s over 20 consecutive moves is written to
 * cheat_flags for review". No automatic action in V1: the flag is for a person to look at.
 *
 * Read from a game's event log (the engine's own events, as stored for the replay):
 * - a move is a correct digit (placedCorrect), and its think time is the event's thinkMs: from the lock to the
 *   digit, without the time its timer stood still (interference, a frozen game);
 * - "consecutive" is the player's own correct moves in order; a wrong digit in between neither counts nor
 *   breaks the run (a wrong digit says nothing about a solver's speed, and skipping it is the stricter reading);
 * - every window of `moves` consecutive correct moves is checked; a player is flagged once per game, with the
 *   lowest window average (ms) as the flag's value.
 */

export const FAST_THINKING = 'fastThinking';

export interface FastThinkingFlag {
  playerId: PlayerId;
  /** The lowest average think time over `moves` consecutive correct moves, in ms (below the threshold). */
  avgMs: number;
  /** seq of the first correct move of that window. */
  fromSeq: number;
}

export function fastThinkingFlags(
  events: readonly GameEvent[],
  { thinkMs, moves }: CheatThresholds,
): FastThinkingFlag[] {
  const byPlayer = new Map<PlayerId, { seq: number; ms: number }[]>();
  for (const e of events) {
    if (e.type !== 'placedCorrect') continue;
    const list = byPlayer.get(e.playerId) ?? [];
    list.push({ seq: e.seq, ms: e.thinkMs });
    byPlayer.set(e.playerId, list);
  }
  const flags: FastThinkingFlag[] = [];
  for (const [playerId, list] of byPlayer) {
    if (list.length < moves) continue;
    let sum = 0;
    let best: { avgMs: number; fromSeq: number } | null = null;
    for (let i = 0; i < list.length; i++) {
      sum += list[i]!.ms;
      if (i >= moves) sum -= list[i - moves]!.ms;
      if (i < moves - 1) continue;
      const avgMs = sum / moves;
      if (best === null || avgMs < best.avgMs) best = { avgMs, fromSeq: list[i - moves + 1]!.seq };
    }
    if (best !== null && best.avgMs < thinkMs) flags.push({ playerId, ...best });
  }
  return flags;
}
