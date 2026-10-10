import type { GameEvent } from '@sudoku-fight/engine';

import { DEFAULT_CHEAT_THRESHOLDS } from '../config';
import { fastThinkingFlags } from '.';

/**
 * Spec §21: an average think time below 1.2 s over 20 consecutive moves is flagged. Synthetic event logs:
 * only placedCorrect (and a few others around it) matter.
 */

let seq = 0;
const correct = (playerId: string, thinkMs: number): GameEvent => ({
  type: 'placedCorrect',
  playerId,
  cell: 0,
  digit: 1,
  points: 5,
  breakdown: { row: 0, col: 0, box: 0, num: 0, X: 0, Y: 0, points: 5 },
  score: 5,
  thinkMs,
  seq: ++seq,
  t: seq * 1000,
});
const wrong = (playerId: string): GameEvent => ({
  type: 'placedWrong',
  playerId,
  cell: 0,
  digit: 2,
  penalty: 1,
  mistakes: 1,
  score: 0,
  seq: ++seq,
  t: seq * 1000,
});
const moves = (playerId: string, times: number[]) => times.map((ms) => correct(playerId, ms));
const times = (n: number, ms: number) => Array<number>(n).fill(ms);

beforeEach(() => {
  seq = 0;
});

describe('fast thinking flags (spec §21)', () => {
  it('flags 20 consecutive correct moves averaging under 1.2 s, with the average as the value', () => {
    const log = moves('ana', [...times(19, 1000), 1700]); // (19·1000 + 1700) / 20 = 1035
    expect(fastThinkingFlags(log, DEFAULT_CHEAT_THRESHOLDS)).toEqual([
      { playerId: 'ana', avgMs: 1035, fromSeq: 1 },
    ]);
  });

  it('not at exactly 1.2 s, nor with only 19 moves', () => {
    expect(fastThinkingFlags(moves('ana', times(20, 1200)), DEFAULT_CHEAT_THRESHOLDS)).toEqual([]);
    expect(fastThinkingFlags(moves('ana', times(19, 300)), DEFAULT_CHEAT_THRESHOLDS)).toEqual([]);
  });

  it('finds the fastest window inside a longer game, and flags the player once', () => {
    const log = moves('ana', [...times(10, 3000), ...times(25, 900), ...times(10, 3000)]);
    expect(fastThinkingFlags(log, DEFAULT_CHEAT_THRESHOLDS)).toEqual([
      { playerId: 'ana', avgMs: 900, fromSeq: 11 },
    ]);
  });

  it('a slow game with a few fast moves is not flagged', () => {
    const log = moves('ana', [...times(5, 200), ...times(40, 2500), ...times(5, 200)]);
    expect(fastThinkingFlags(log, DEFAULT_CHEAT_THRESHOLDS)).toEqual([]);
  });

  it("counts each player's own moves: moves interleaved with an opponent's are still consecutive", () => {
    const log: GameEvent[] = [];
    for (let k = 0; k < 25; k++) log.push(correct('ana', 800), correct('ben', 4000));
    expect(fastThinkingFlags(log, DEFAULT_CHEAT_THRESHOLDS)).toEqual([
      { playerId: 'ana', avgMs: 800, fromSeq: 1 },
    ]);
  });

  it('a wrong digit in between neither counts nor breaks the run', () => {
    const log = [...moves('ana', times(10, 1000)), wrong('ana'), ...moves('ana', times(10, 1000))];
    expect(fastThinkingFlags(log, DEFAULT_CHEAT_THRESHOLDS)).toEqual([
      { playerId: 'ana', avgMs: 1000, fromSeq: 1 },
    ]);
  });

  it('takes its thresholds from the settings (CHEAT_FAST_THINK_MS, CHEAT_FAST_THINK_MOVES)', () => {
    const log = moves('ana', times(10, 1500));
    expect(fastThinkingFlags(log, DEFAULT_CHEAT_THRESHOLDS)).toEqual([]);
    expect(fastThinkingFlags(log, { thinkMs: 2000, moves: 10 })).toEqual([
      { playerId: 'ana', avgMs: 1500, fromSeq: 1 },
    ]);
  });
});
