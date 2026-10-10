import type { GameConfig, GameEvent, GameState, PlayerId } from '@sudoku-fight/engine';
import { eq, sql } from 'drizzle-orm';

import { FAST_THINKING, fastThinkingFlags, insertCheatFlags } from '../cheat';
import type { CheatThresholds } from '../config';
import type { Db } from '../db';
import { gameEvents, gamePlayers, games, opponentHistory, puzzleHistory } from '../db/schema';
import { applyRatingChanges, type RatingWrite } from '../ratings';

/**
 * A ranked game in the database (spec §19): what is written when it starts, while it runs and when it ends.
 * Every write here is idempotent, so the recorder (./recorder) can retry any of them after a failure, and the
 * end can write whatever the start or the event batches did not manage to.
 *
 * - Start (`recordGameStart`): the games row (mode, type, player count, puzzle, the rules as played,
 *   started_at), a game_players row per seat (status 'active', rating key and rating before), and for every
 *   account a puzzle_history row and an opponent_history row per opponent.
 *   History is written at the start, not the end: from "found" on a player is in the game [D32], and a player
 *   who then leaves (abandonment) has seen the board, so the puzzle counts as played for them and the
 *   opponent as met. Someone who never connects never gets here: the game starts only with everyone in
 *   (spec §10, D37).
 * - While it runs (`appendGameEvents`): the engine's events, in small batches. All of them, as the engine
 *   made them: gameCreated carries the solution, which the server keeps for the replay and never sends to a
 *   client while the game runs (spec §21).
 * - End (`recordGameEnd`), one transaction: ended_at and end_reason; each seat's final score, mistakes,
 *   place (§6.7: whoever surrendered or abandoned ranks after those still in, a normal loss [D32]), status
 *   and rating after; the ratings themselves (../ratings); the anomaly flags (../cheat). The games row is
 *   locked and its ended_at checked first: a game already recorded is left as it is, so a retry never counts
 *   a game twice.
 */

/** A seat and the account playing it (null: no account, e.g. a bot). */
export interface GameSeat {
  seat: number;
  playerId: PlayerId;
  userId: string | null;
}

export interface GameStartRecord {
  config: GameConfig;
  startedAt: number;
  seats: readonly GameSeat[];
  /** The rating key this game moves; null for a game that moves no rating. */
  ratingKey: string | null;
}

/** The seats of a config: every player's id is its users.id, except bots'. */
export function seatsOf(config: GameConfig): GameSeat[] {
  return config.players.map((p, seat) => ({ seat, playerId: p.id, userId: p.isBot ? null : p.id }));
}

/** The games row with its players and histories (idempotent: what is there already stays). */
export async function recordGameStart(db: Db, start: GameStartRecord): Promise<void> {
  await db.transaction((tx) => writeStart(tx, start));
}

async function writeStart(db: Db, { config, startedAt, seats, ratingKey }: GameStartRecord): Promise<void> {
  const at = new Date(startedAt);
  await db
    .insert(games)
    .values({
      id: config.id,
      mode: config.mode,
      gameType: config.gameType,
      playerCount: config.players.length,
      puzzleId: config.puzzle.id,
      rules: config.rules,
      startedAt: at,
    })
    .onConflictDoNothing();
  await db
    .insert(gamePlayers)
    .values(
      seats.map(({ seat, userId }) => {
        const rating = config.players[seat]?.rating;
        const rated = ratingKey !== null && rating !== undefined && userId !== null;
        return {
          gameId: config.id,
          userId,
          seat,
          status: 'active',
          ratingKey: rated ? ratingKey : null,
          ratingBefore: rated ? rating : null,
        };
      }),
    )
    .onConflictDoNothing();

  const accounts = seats.flatMap((s) => (s.userId === null ? [] : [s.userId]));
  if (accounts.length === 0) return;
  await db
    .insert(puzzleHistory)
    .values(accounts.map((userId) => ({ userId, puzzleId: config.puzzle.id, playedAt: at })))
    .onConflictDoNothing();
  const pairs = accounts.flatMap((userId) =>
    accounts
      .filter((other) => other !== userId)
      .map((opponentId) => ({ userId, opponentId, gameType: config.gameType, playedAt: at })),
  );
  if (pairs.length === 0) return;
  await db
    .insert(opponentHistory)
    .values(pairs)
    .onConflictDoUpdate({
      target: [opponentHistory.userId, opponentHistory.opponentId, opponentHistory.gameType],
      set: { playedAt: sql`greatest(${opponentHistory.playedAt}, excluded.played_at)` },
    });
}

/** One game_events row per engine event (seq, t, type; the rest of the event is the payload). */
export function eventRow(gameId: string, event: GameEvent): typeof gameEvents.$inferInsert {
  const { seq, t, type, ...payload } = event;
  return { gameId, seq, tMs: t, type, payload };
}

/** Rows per INSERT for events: well under Postgres's parameter limit. */
const EVENT_CHUNK = 500;

/** Appends events; one already there (same seq) is skipped, so a batch may be sent again. */
export async function appendGameEvents(db: Db, gameId: string, events: readonly GameEvent[]): Promise<void> {
  for (let i = 0; i < events.length; i += EVENT_CHUNK) {
    await db
      .insert(gameEvents)
      .values(events.slice(i, i + EVENT_CHUNK).map((e) => eventRow(gameId, e)))
      .onConflictDoNothing();
  }
}

export interface GameEndRecord {
  start: GameStartRecord;
  /** The game, over. */
  state: GameState;
  /** Events that may not be stored yet (any already there are skipped). */
  unwritten: readonly GameEvent[];
  /** The whole log, for the anomaly check. */
  log: readonly GameEvent[];
  cheat: CheatThresholds;
}

export type EndOutcome = 'recorded' | 'alreadyRecorded';

export async function recordGameEnd(db: Db, end: GameEndRecord): Promise<EndOutcome> {
  const { start, state } = end;
  const result = state.result;
  if (state.status !== 'over' || result === null || state.endedAt === null)
    throw new Error(`Game ${start.config.id} is not over`);
  const gameId = start.config.id;
  const at = new Date(state.endedAt);

  return db.transaction(async (tx): Promise<EndOutcome> => {
    // Whatever the start did not manage to write (it failed, or is still retrying).
    await writeStart(tx, start);
    const [row] = await tx
      .select({ endedAt: games.endedAt })
      .from(games)
      .where(eq(games.id, gameId))
      .for('update');
    if (row === undefined) throw new Error(`Game ${gameId} has no games row`);
    if (row.endedAt !== null) return 'alreadyRecorded';

    await appendGameEvents(tx, gameId, end.unwritten);
    await tx.update(games).set({ endedAt: at, endReason: result.reason }).where(eq(games.id, gameId));

    const userOf = new Map(start.seats.map((s) => [s.playerId, s.userId]));
    const ratingWrites: RatingWrite[] = [];
    for (const entry of result.ranking) {
      const userId = userOf.get(entry.playerId) ?? null;
      const change = result.ratingChanges.find((c) => c.playerId === entry.playerId);
      const rated = start.ratingKey !== null && change !== undefined && userId !== null;
      if (rated) ratingWrites.push({ userId, change });
      const final = {
        userId,
        finalScore: entry.score,
        mistakes: entry.mistakes,
        place: entry.place,
        status: entry.status,
        ratingKey: rated ? start.ratingKey : null,
        ratingBefore: rated ? change.before : null,
        ratingAfter: rated ? change.after : null,
      };
      await tx
        .insert(gamePlayers)
        .values({ gameId, seat: entry.seat, ...final })
        .onConflictDoUpdate({ target: [gamePlayers.gameId, gamePlayers.seat], set: final });
    }

    if (start.ratingKey !== null && ratingWrites.length > 0) {
      await applyRatingChanges(tx, start.ratingKey, ratingWrites, {
        provisionalGames: start.config.rules.rating.provisionalGames,
        at,
      });
    }

    const flags = fastThinkingFlags(end.log, end.cheat).flatMap((f) => {
      const userId = userOf.get(f.playerId) ?? null;
      return userId === null ? [] : [{ userId, gameId, reason: FAST_THINKING, value: f.avgMs }];
    });
    await insertCheatFlags(tx, flags, at);
    return 'recorded';
  });
}
