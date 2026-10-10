/* Test-only: practices saved the way the game saves them, for the home screen to list. */
import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';

import { puzzleById } from '../../../game/offlinePool';
import type { PracticeRepo } from '../../../game/practiceRepo';
import { startBotPractice, startPractice } from '../../../game/session';
import { playMyMove } from '../../../game/testing/botPractice';
import { answerIn, emptyCellsOf, smallPool } from '../../../game/testing/practice';

export const SEED_START = 1_760_000_000_000;

/**
 * Saves two practices the way a real game does (through a session): a fast one with one correct digit that
 * the player ended ("סיום אימון"), then a hard one left running and closed (interrupted). Returns their ids,
 * oldest first.
 */
export async function seedPractices(repo: PracticeRepo): Promise<{ ended: string; interrupted: string }> {
  const clock = new ManualClock(SEED_START);
  const scheduler = new ManualScheduler(clock);
  const quiet = { track: () => undefined, onError: () => undefined };

  const ended = await startPractice(
    { gameType: 'fast' },
    { repo, clock, scheduler, pool: smallPool(3), seed: 1, ...quiet },
  );
  const puzzle = puzzleById(ended.puzzleId)!;
  const cell = emptyCellsOf(puzzle)[0]!;
  clock.advance(2_000);
  ended.host.select(cell);
  clock.advance(1_000);
  ended.host.place(cell, answerIn(puzzle, cell));
  ended.endPractice();
  await ended.flush();
  ended.close();

  clock.advance(60_000);
  const interrupted = await startPractice(
    { gameType: 'hard' },
    { repo, clock, scheduler, pool: smallPool(3, 'hard'), seed: 2, ...quiet },
  );
  interrupted.close();
  await interrupted.flush();
  return { ended: ended.id, interrupted: interrupted.id };
}

/**
 * Saves practices against the engine's bot the way a real game does (a session, the bot on a manual clock):
 * a fast one against Pip that I win by filling the board quickly, a normal one against Maestro that I end
 * after a while (a surrender: a loss, spec §6.6), and a hard one against Biscuit closed mid-game
 * (interrupted). Returns their ids, oldest first.
 */
export async function seedBotPractices(
  repo: PracticeRepo,
  at = SEED_START,
): Promise<{ won: string; lost: string; interrupted: string }> {
  const clock = new ManualClock(at);
  const scheduler = new ManualScheduler(clock);
  const quiet = { track: () => undefined, onError: () => undefined };

  const won = await startBotPractice(
    { gameType: 'fast', level: 1 },
    { repo, clock, scheduler, pool: smallPool(3), seed: 3, ...quiet },
  );
  const puzzle = puzzleById(won.puzzleId)!;
  while (won.getView().status !== 'over') {
    scheduler.advance(1_000);
    playMyMove(won, puzzle);
  }
  await won.flush();
  won.close();

  clock.advance(60_000);
  const lost = await startBotPractice(
    { gameType: 'normal', level: 4 },
    { repo, clock, scheduler, pool: smallPool(3, 'normal'), seed: 4, ...quiet },
  );
  scheduler.advance(20_000);
  lost.endPractice();
  await lost.flush();
  lost.close();

  clock.advance(60_000);
  const interrupted = await startBotPractice(
    { gameType: 'hard', level: 2 },
    { repo, clock, scheduler, pool: smallPool(3, 'hard'), seed: 5, ...quiet },
  );
  scheduler.advance(5_000);
  interrupted.close();
  await interrupted.flush();
  return { won: won.id, lost: lost.id, interrupted: interrupted.id };
}
