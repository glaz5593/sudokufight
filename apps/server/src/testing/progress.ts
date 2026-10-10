import type { GameType } from '@sudoku-fight/engine';
import { sql } from 'drizzle-orm';

import type { Db } from '../db';
import { gamePlayers, games, opponentHistory, ratings } from '../db/schema';
import { NEARLY_DONE } from './game';
import { addPuzzles, T0 } from './ranked';

/** Test helpers for stage 12 (leaderboards, player cards, XP): ratings and finished games written directly. */

/** Sets a user's rating row in one key (made when missing). */
export async function setRating(
  db: Db,
  userId: string,
  key: string,
  rating: number,
  games: number,
  peak: number = rating,
): Promise<void> {
  const row = {
    userId,
    ratingKey: key,
    rating,
    games,
    provisional: games < 10,
    peak,
    updatedAt: new Date(T0),
  };
  await db
    .insert(ratings)
    .values(row)
    .onConflictDoUpdate({
      target: [ratings.userId, ratings.ratingKey],
      set: { rating, games, provisional: row.provisional, peak },
    });
}

/** The puzzle stored games point at (games.puzzle_id is a foreign key). */
export async function addGamePuzzle(db: Db): Promise<string> {
  await addPuzzles(db, [NEARLY_DONE]);
  return NEARLY_DONE.id;
}

export interface SeatResult {
  userId: string | null;
  place: number | null;
  score?: number;
  mistakes?: number;
  bestMove?: number | null;
  ratingKey?: string | null;
  ratingBefore?: number | null;
  ratingAfter?: number | null;
  status?: 'active' | 'surrendered' | 'abandoned';
}

export interface StoredGame {
  id: string;
  gameType?: GameType;
  mode?: string;
  /** Epoch ms; null: still running. */
  endedAt: number | null;
  endReason?: string;
  seats: SeatResult[];
}

/** A games row (puzzle NEARLY_DONE, which must be stored) with its seats, as recordGameEnd leaves them. */
export async function addStoredGame(db: Db, game: StoredGame): Promise<void> {
  const endedAt = game.endedAt === null ? null : new Date(game.endedAt);
  await db.insert(games).values({
    id: game.id,
    mode: game.mode ?? 'ranked',
    gameType: game.gameType ?? 'normal',
    playerCount: game.seats.length,
    puzzleId: NEARLY_DONE.id,
    rules: {},
    startedAt: new Date((game.endedAt ?? T0) - 300_000),
    endedAt,
    endReason: endedAt === null ? null : (game.endReason ?? 'boardComplete'),
  });
  await db.insert(gamePlayers).values(
    game.seats.map((s, seat) => ({
      gameId: game.id,
      userId: s.userId,
      seat,
      finalScore: s.place === null ? null : (s.score ?? 0),
      mistakes: s.place === null ? null : (s.mistakes ?? 0),
      place: s.place,
      status: s.status ?? 'active',
      ratingKey: s.ratingKey ?? null,
      ratingBefore: s.ratingBefore ?? null,
      ratingAfter: s.ratingAfter ?? null,
      bestMovePoints: s.bestMove ?? null,
    })),
  );
}

/** `userId` met `opponentId` in `gameType` at `at` (the row the start of a ranked game writes, one way). */
export async function addOpponent(
  db: Db,
  userId: string,
  opponentId: string,
  at: number,
  gameType: GameType = 'normal',
): Promise<void> {
  await db
    .insert(opponentHistory)
    .values({ userId, opponentId, gameType, playedAt: new Date(at) })
    .onConflictDoUpdate({
      target: [opponentHistory.userId, opponentHistory.opponentId, opponentHistory.gameType],
      set: { playedAt: sql`excluded.played_at` },
    });
}
