/* Test-only helpers for practice games: a known puzzle, hosts on a manual clock, and moves by cell name. */
import {
  type CellIndex,
  defaultRules,
  type Digit,
  type GameMode,
  LocalGameHost,
  ManualClock,
  ManualScheduler,
  parseCellName,
  type PlayerInfo,
  type Rules,
} from '@sudoku-fight/engine';

import { allOfflinePuzzles, type OfflinePuzzle, poolOf, type PuzzlePool } from '../offlinePool';

/** The first puzzle of the offline pool (bank #1). */
export const PUZZLE: OfflinePuzzle = allOfflinePuzzles()[0]!;

/** A pool of the first `n` offline puzzles of a game type. */
export function smallPool(n: number, gameType: OfflinePuzzle['gameType'] = 'fast'): PuzzlePool {
  return poolOf(
    allOfflinePuzzles()
      .filter((p) => p.gameType === gameType)
      .slice(0, n),
  );
}

const cellOf = (cell: string | CellIndex): CellIndex =>
  typeof cell === 'string' ? parseCellName(cell) : cell;

export const answerIn = (puzzle: Pick<OfflinePuzzle, 'solution'>, cell: string | CellIndex): Digit =>
  Number(puzzle.solution[cellOf(cell)]) as Digit;

export function wrongIn(
  puzzle: Pick<OfflinePuzzle, 'solution'>,
  cell: string | CellIndex,
  skip: number[] = [],
): Digit {
  const right = answerIn(puzzle, cell);
  for (let d = 1; d <= 9; d++) if (d !== right && !skip.includes(d)) return d as Digit;
  throw new Error('no wrong digit left');
}

export const emptyCellsOf = (puzzle: Pick<OfflinePuzzle, 'givens'>): CellIndex[] =>
  [...puzzle.givens].flatMap((c, i) => (c === '0' ? [i] : []));

export interface TestHost {
  host: LocalGameHost;
  clock: ManualClock;
  scheduler: ManualScheduler;
}

/**
 * A LocalGameHost on a manual clock: solo by default, or with more players (the first is 'me'). `rules` overrides
 * the engine's rules for the mode, e.g. `{ interferences: true }` for a duel with a bot that may interfere (a
 * practice against a bot has none by default, D44).
 */
export function testHost({
  mode = 'solo',
  players = [{ id: 'me' }],
  puzzle = PUZZLE,
  at = 1_000_000,
  rules,
}: {
  mode?: GameMode;
  players?: PlayerInfo[];
  puzzle?: OfflinePuzzle;
  at?: number;
  rules?: Partial<Rules>;
} = {}): TestHost {
  const clock = new ManualClock(at);
  const scheduler = new ManualScheduler(clock);
  const host = new LocalGameHost({
    config: {
      id: 'test-game',
      mode,
      gameType: puzzle.gameType,
      puzzle: { id: puzzle.id, givens: puzzle.givens, solution: puzzle.solution },
      players,
      rules: defaultRules(mode, puzzle.gameType, rules),
      seed: 1,
    },
    playerId: players[0]!.id,
    clock,
    scheduler,
  });
  return { host, clock, scheduler };
}
