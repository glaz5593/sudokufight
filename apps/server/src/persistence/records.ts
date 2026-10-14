import {
  DEFAULT_PROGRESS_RULES,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayerId,
  type ProgressRules,
} from '@sudoku-fight/engine';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { FAST_THINKING, fastThinkingFlags, insertCheatFlags } from '../cheat';
import type { CheatThresholds } from '../config';
import type { Db } from '../db';
import {
  displayNameKey,
  gameEvents,
  gamePlayers,
  games,
  opponentHistory,
  puzzleHistory,
  retiredNames,
  users,
} from '../db/schema';
import { addXp, rankedXpGains } from '../progress/xp';
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
 *   client while the game runs (spec §21). It carries the players' display names too: a deleted account's
 *   is replaced by its anonymous one (`anonymizeLoggedNames`), when the account is deleted and when a
 *   gameCreated is written after that (a game the account was still in); a name an admin reset away by the
 *   account's current one, likewise (`renameLoggedNames`, and `scrubLoggedNames` for a later gameCreated).
 * - A restart (`endInterruptedGames`, at boot): a game still running when the server stopped is gone (it lived
 *   in its room's memory); its row is ended as 'serverRestart', unrated.
 * - End (`recordGameEnd`), one transaction: ended_at and end_reason; each seat's final score, mistakes,
 *   place (§6.7: whoever surrendered or abandoned ranks after those still in, a normal loss [D32]), status,
 *   rating after and best move's points (stage 12, for the player card); the ratings themselves
 *   (../ratings); every account's XP (../progress/xp, spec §15: 50 for a win, 20 otherwise, a point per
 *   correct move); the anomaly flags (../cheat). The games row is locked and its ended_at checked first: a
 *   game already recorded is left as it is, so a retry never counts a game (its ratings, its XP) twice.
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

/** A log's first event, its gameCreated (the engine's createGame). */
const GAME_CREATED_SEQ = 1;

/**
 * Appends events; one already there (same seq) is skipped, so a batch may be sent again. A batch with the
 * gameCreated (the one event with names) then takes out of it the names of accounts deleted meanwhile, or
 * being deleted right now, and the names an admin reset away meanwhile, or is resetting right now
 * (scrubLoggedNames waits for those).
 */
export async function appendGameEvents(db: Db, gameId: string, events: readonly GameEvent[]): Promise<void> {
  for (let i = 0; i < events.length; i += EVENT_CHUNK) {
    await db
      .insert(gameEvents)
      .values(events.slice(i, i + EVENT_CHUNK).map((e) => eventRow(gameId, e)))
      .onConflictDoNothing();
  }
  if (events.some((e) => e.type === 'gameCreated')) await scrubLoggedNames(db, gameId);
}

/**
 * The display names of deleted accounts in the stored logs (spec §3.3, docs/DECISIONS-PENDING.md 1.9): the
 * one event that carries names is gameCreated (config.players[seat].name; no other engine event has one). A
 * deleted account's seat there gets the account's anonymous name (users.display_name, `deleted:<uuid>`), the
 * same one its row and the admin site show; the replay (history/store.ts withoutNames) and the history leave
 * it out for the players, who see "שחקן". Seats are the game_players rows: an account and its seat.
 *
 * - `{ userId }`: every game of that account (deleteUser, in its transaction, after the users row has its
 *   anonymous name): its seats through game_players_user_idx, each game's gameCreated through the primary
 *   key (game_id, seq 1): one row a game, however long its log.
 * - `{ gameId }`: one game, for a gameCreated written after the account was deleted (appendGameEvents). It
 *   first waits for a deletion still running (its users row locked): that deletion's own pass may have
 *   started before this log was stored, so this pass must see the deletion.
 *
 * Only a seat whose logged name differs is written, so running it again changes nothing; and only where the
 * log has the account's own id in that seat. An UPDATE … FROM writes a row once even when it joins several
 * seats (two deleted accounts in one game), so it runs again until nothing is left: once more per extra
 * deleted seat in a game, at most. Returns how many seats changed.
 */
export async function anonymizeLoggedNames(
  db: Db,
  scope: { userId: string } | { gameId: string },
): Promise<number> {
  return rewriteLoggedNames(db, scope, 'deleted');
}

/**
 * After an admin reset an offensive display name (spec §3.5, moderation/admin.ts): every game of that account
 * gets its new, temporary name in the logged gameCreated, so its opponents' replays no longer show the old
 * one. The same pass as anonymizeLoggedNames, for a live account. (A rename by the player keeps the logs as
 * they were played.) Returns how many seats changed.
 */
export async function renameLoggedNames(db: Db, userId: string): Promise<number> {
  return rewriteLoggedNames(db, { userId }, 'all');
}

/**
 * One game's gameCreated, written after its players' names changed under it (appendGameEvents): a deleted
 * account's seat gets its anonymous name (as anonymizeLoggedNames), and a seat whose logged name an admin reset
 * away (retired_names) gets the account's current name (as renameLoggedNames). The room took the names when the
 * players joined, and the recorder writes the log a little later (a batch, a retry): a reset in between would
 * otherwise leave the old name in that game's replay. A name the player changed themselves stays as played.
 * Waits for a deletion or a reset still running (their users row locked), as anonymizeLoggedNames does.
 */
export async function scrubLoggedNames(db: Db, gameId: string): Promise<number> {
  return rewriteLoggedNames(db, { gameId }, 'deletedOrRetired');
}

/**
 * Which seats get the account's current users.display_name: every seat that differs (`all`), a deleted
 * account's (`deleted`), or those and the seats whose logged name is retired (`deletedOrRetired`).
 */
type RewriteSeats = 'all' | 'deleted' | 'deletedOrRetired';

/** Sets the account's current users.display_name in its seats of the logged gameCreated events. */
async function rewriteLoggedNames(
  db: Db,
  scope: { userId: string } | { gameId: string },
  seats: RewriteSeats,
): Promise<number> {
  if ('gameId' in scope) {
    await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(gamePlayers, eq(gamePlayers.userId, users.id))
      .where(eq(gamePlayers.gameId, scope.gameId))
      .for('share', { of: users });
  }
  const seat = (field: 'id' | 'name') =>
    sql`array['config', 'players', ${gamePlayers.seat}::text, ${sql.raw(`'${field}'`)}]`;
  const loggedName = sql`${gameEvents.payload} #>> ${seat('name')}`;
  const which =
    seats === 'all'
      ? undefined
      : seats === 'deleted'
        ? isNotNull(users.deletedAt)
        : sql`(${users.deletedAt} is not null or ${displayNameKey(loggedName)} in (select ${retiredNames.nameKey} from ${retiredNames}))`;
  const pass = async () =>
    (
      await db
        .update(gameEvents)
        .set({
          payload: sql`jsonb_set(${gameEvents.payload}, ${seat('name')}, to_jsonb(${users.displayName}), false)`,
        })
        .from(gamePlayers)
        .innerJoin(users, eq(users.id, gamePlayers.userId))
        .where(
          and(
            'userId' in scope ? eq(gamePlayers.userId, scope.userId) : eq(gamePlayers.gameId, scope.gameId),
            eq(gameEvents.gameId, gamePlayers.gameId),
            eq(gameEvents.seq, GAME_CREATED_SEQ),
            eq(gameEvents.type, 'gameCreated'),
            which,
            sql`${gameEvents.payload} #>> ${seat('id')} = ${gamePlayers.userId}`,
            // A seat with a name (no name, nothing to replace) other than the account's current one already.
            sql`${loggedName} <> ${users.displayName}`,
          ),
        )
        .returning({ gameId: gameEvents.gameId })
    ).length;
  let changed = 0;
  // Each pass sets one seat in each row it writes, so this ends: by the number of seats at most.
  for (let n = await pass(); n > 0; n = await pass()) changed += n;
  return changed;
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
  /** XP rules (default the engine's DEFAULT_PROGRESS_RULES). */
  progress?: ProgressRules;
}

/** The end_reason of a game cut short by a server restart. Not an engine EndReason: no result, no rating. */
export const SERVER_RESTART = 'serverRestart';

/**
 * At boot, before any room opens: every game the database still has running was cut short when the server
 * stopped (a deploy, a crash), because a game lives in its room, in the server's memory (spec §16.2). They are
 * ended with end_reason 'serverRestart' and nothing else: no places or scores, no rating changes (game_players
 * keep rating_before, rating_after stays null), no anomaly check; the events written so far stay for the admin
 * site. The histories written at the start stay too (the players saw the puzzle and met each other).
 *
 * One server process per database (fly.toml: one machine), so at boot no other process plays them. Returns
 * the ids of the games ended.
 */
export async function endInterruptedGames(db: Db, at: Date): Promise<string[]> {
  const rows = await db
    .update(games)
    .set({ endedAt: at, endReason: SERVER_RESTART })
    .where(isNull(games.endedAt))
    .returning({ id: games.id });
  return rows.map((r) => r.id);
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
      const stats = result.stats.find((s) => s.playerId === entry.playerId);
      const final = {
        userId,
        finalScore: entry.score,
        mistakes: entry.mistakes,
        place: entry.place,
        status: entry.status,
        ratingKey: rated ? start.ratingKey : null,
        ratingBefore: rated ? change.before : null,
        ratingAfter: rated ? change.after : null,
        bestMovePoints: stats?.bestMove?.points ?? null,
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

    // XP for every account in the game (bots have none), in this transaction: recorded once, like the ratings.
    // Ranked games only: practice XP comes from the phone [D41].
    if (start.config.mode === 'ranked') {
      const rules = end.progress ?? DEFAULT_PROGRESS_RULES;
      const gains = rankedXpGains(result, rules).flatMap((g) => {
        const userId = userOf.get(g.playerId) ?? null;
        return userId === null ? [] : [{ userId, xp: g.xp }];
      });
      await addXp(tx, gains, rules);
    }

    const flags = fastThinkingFlags(end.log, end.cheat).flatMap((f) => {
      const userId = userOf.get(f.playerId) ?? null;
      return userId === null ? [] : [{ userId, gameId, reason: FAST_THINKING, value: f.avgMs }];
    });
    await insertCheatFlags(tx, flags, at);
    return 'recorded';
  });
}
