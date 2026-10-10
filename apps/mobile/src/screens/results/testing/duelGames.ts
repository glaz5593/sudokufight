/* Test-only: practices against a bot played on a manual clock and saved as the session saves them. */
import type { GameResult, PlayerId } from '@sudoku-fight/engine';

import { openPracticeRepo, type PracticeGame, type PracticeRepo } from '../../../game/practiceRepo';
import { answerIn, wrongIn } from '../../../game/testing/practice';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import { type Duel, duel, ME } from '../../game/testing/duel';

export interface SavedDuel extends Duel {
  repo: PracticeRepo;
  id: string;
  /** Writes the log so far, and the end once the game is over (what the practice session does). */
  save(): Promise<void>;
}

/** Me against the level-3 bot ("Mr. Hoot", bot-3), saved in an in-memory practice database. */
export async function savedDuel(): Promise<SavedDuel> {
  const repo = await openPracticeRepo(await memoryDb());
  const game = duel();
  const config = game.host.state.config;
  await repo.createGame({
    id: config.id,
    mode: config.mode,
    gameType: config.gameType,
    puzzleId: config.puzzle.id,
    playerId: ME,
    seed: config.seed ?? null,
    startedAt: game.host.events[0]!.t,
  });
  const save = async () => {
    await repo.appendEvents(config.id, game.host.events);
    const state = game.host.state;
    if (state.result) await repo.finishGame(config.id, { result: state.result, endedAt: state.endedAt ?? 0 });
  };
  return { ...game, repo, id: config.id, save };
}

/** My move: lock, think, place (the answer by default). */
export function myMove(game: Duel, cell: number, thinkMs = 1_000, digit = answerIn(game.puzzle, cell)): void {
  game.session.host.select(cell);
  game.scheduler.advance(thinkMs);
  game.session.host.place(cell, digit);
}

/** I fill the board, a second a cell, with one mistake on the way; the bot does nothing. I win. */
export async function wonDuel(): Promise<SavedDuel> {
  const game = await savedDuel();
  const [first, ...rest] = game.cells;
  myMove(game, first!, 1_000, wrongIn(game.puzzle, first!));
  game.scheduler.advance(1_000); // the re-lock wait [D2]
  for (const cell of [first!, ...rest]) myMove(game, cell);
  await game.save();
  return game;
}

/** The bot fills the board after my one correct move. I lose. */
export async function lostDuel(): Promise<SavedDuel> {
  const game = await savedDuel();
  const [first, ...rest] = game.cells;
  myMove(game, first!);
  for (const cell of rest) {
    game.scheduler.advance(500);
    game.bot.solve(cell);
  }
  await game.save();
  return game;
}

/** One move each, then "סיום אימון": leaving is a loss (spec §6.6), with no rating change. */
export async function endedDuel(): Promise<SavedDuel> {
  const game = await savedDuel();
  const [a, b] = game.cells;
  myMove(game, a!, 2_000);
  game.bot.solve(b!);
  game.scheduler.advance(3_000);
  game.session.endPractice();
  await game.save();
  return game;
}

/** One move each, then the app goes away mid-game: nothing finished. */
export async function interruptedDuel(): Promise<SavedDuel> {
  const game = await savedDuel();
  const [a, b] = game.cells;
  myMove(game, a!, 2_000);
  game.bot.solve(b!);
  await game.save();
  await game.repo.markInterrupted(game.id);
  game.session.close();
  return game;
}

/**
 * A tie (spec §6.7: equal scores and equal mistakes share the place). Real moves rarely end level, so this is
 * a won game's record with its ranking made equal: what the engine reports for a true tie.
 */
export function tiedRecord(game: PracticeGame, bot: PlayerId): PracticeGame {
  const result = game.result!;
  const me = result.ranking.find((r) => r.playerId === ME)!;
  const tied: GameResult = {
    ...result,
    ranking: result.ranking.map((r) => ({
      ...r,
      place: 1,
      score: me.score,
      mistakes: me.mistakes,
      ...(r.playerId === bot ? { correct: me.correct } : null),
    })),
    awards: [],
  };
  return { ...game, result: tied };
}
