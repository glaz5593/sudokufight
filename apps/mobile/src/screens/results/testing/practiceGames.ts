/* Test-only: practices played on a manual clock and saved in an in-memory database, for the results tests. */
import { type CellIndex, type Digit, ManualClock, ManualScheduler } from '@sudoku-fight/engine';

import { type OfflinePuzzle, puzzleById } from '../../../game/offlinePool';
import { openPracticeRepo, type PracticeRepo } from '../../../game/practiceRepo';
import { type PracticeSession, startPractice } from '../../../game/session';
import { answerIn, emptyCellsOf, smallPool, wrongIn } from '../../../game/testing/practice';
import { memoryDb } from '../../../game/testing/sqlJsDb';

export interface SavedPractice {
  repo: PracticeRepo;
  clock: ManualClock;
  scheduler: ManualScheduler;
  session: PracticeSession;
  puzzle: OfflinePuzzle;
  /** The puzzle's empty cells, in board order. */
  cells: CellIndex[];
}

/** A fast solo practice on the pool's first puzzle, saved as it goes. */
export async function savedPractice(): Promise<SavedPractice> {
  const repo = await openPracticeRepo(await memoryDb());
  const clock = new ManualClock(1_700_000_000_000);
  const scheduler = new ManualScheduler(clock);
  const session = await startPractice(
    { gameType: 'fast' },
    { repo, clock, scheduler, pool: smallPool(1), seed: 7, track: () => undefined, onError: () => undefined },
  );
  const puzzle = puzzleById(session.puzzleId)!;
  return { repo, clock, scheduler, session, puzzle, cells: emptyCellsOf(puzzle) };
}

/** Locks `cell`, thinks `thinkMs`, and places `digit` (the answer by default). */
export function move(game: SavedPractice, cell: CellIndex, thinkMs: number, digit?: Digit): void {
  game.session.host.select(cell);
  game.scheduler.advance(thinkMs);
  game.session.host.place(cell, digit ?? answerIn(game.puzzle, cell));
}

/** Two correct moves (2 s and 3 s of thought) and one mistake, then "סיום אימון". */
export async function endedPractice(): Promise<SavedPractice> {
  const game = await savedPractice();
  const [a, b, c] = game.cells;
  move(game, a!, 2_000);
  move(game, b!, 3_000);
  move(game, c!, 1_000, wrongIn(game.puzzle, c!));
  game.scheduler.advance(4_000);
  game.session.endPractice();
  await game.session.flush();
  return game;
}

/** Every empty cell filled, a second each. */
export async function completedPractice(): Promise<SavedPractice> {
  const game = await savedPractice();
  for (const cell of game.cells) move(game, cell, 1_000);
  await game.session.flush();
  return game;
}

/** One correct move and one mistake, then the screen goes away mid-game. */
export async function interruptedPractice(): Promise<SavedPractice> {
  const game = await savedPractice();
  const [a, b] = game.cells;
  move(game, a!, 2_500);
  move(game, b!, 1_000, wrongIn(game.puzzle, b!));
  game.session.close();
  await game.session.flush();
  return game;
}
