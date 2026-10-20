import {
  DEFAULT_RATING_RULES,
  defaultRules,
  type GameConfig,
  type GameType,
  type PlayerId,
  type RatingOption,
  type Rules,
  type Scheduler,
} from '@sudoku-fight/engine';

import { type CheatThresholds, DEFAULT_PRACTICE_XP_DAILY_CAP } from '../config';
import type { Db } from '../db';
import type { RankedPuzzleSource } from '../puzzles/rankedSource';
import { ratingKeyFor, ratingsAtStart } from '../ratings';
import { GameRecorder, type RecorderLog, type RecorderTuning } from './recorder';
import { personaIdsAmong } from './records';

/**
 * Ranked games on the server, start to end (stage 9; spec §11, §19, §20, §21): what a game room needs from
 * the database.
 *
 * - createConfig(): the game's config. The puzzle comes from the ranked pool without repeats (../puzzles);
 *   each player's rating and rated games in the game's key come from `ratings` (the engine computes the
 *   changes from them at the end); the rating rules carry the server's RATING_OPTION [D7].
 * - record(): a GameRecorder for the game: games, game_players, game_events, histories, then the result,
 *   ratings and anomaly flags (./recorder, ./records).
 *
 * And a friends room's game (1.0.4; friends-room.md §4, §7.1) [D81a], the third way next to a ranked game and
 * a development room's unrated one:
 * - createFriendsConfig(): the engine's ranked rules (interferences, locks, as in a ranked game) and a puzzle
 *   from the ranked pool without repeats, like a ranked game's (never the offline bank, so the solution stays
 *   on the server until the end), but the players carry no rating, so the engine moves none.
 * - recordFriends(): the same recorder, writing games.mode 'friends', no rating key, and each account's XP
 *   within the day's practice cap (`practiceXpDailyCap`, the server's PRACTICE_XP_DAILY_CAP).
 *
 * A stealth bot's persona (stealth-bot.md §6, §7) [D90] is a player like any other here: its users.id, its
 * rating in the game's key (a real one, from its own games), so the engine rates both seats. The one
 * difference is the puzzle: picked by the people's puzzle history alone (a persona has none, ./records), read
 * from users.kind, so nothing in the setup or the config needs to say which seat is the bot.
 */

export interface RankedPlayer {
  /** users.id (the identity's userId). */
  id: PlayerId;
  name: string;
}

export interface RankedGameSetup {
  id: string;
  gameType: GameType;
  /** In seat order. */
  players: readonly RankedPlayer[];
  /** Rule overrides (development and tests). */
  rules?: Partial<Rules>;
  seed: number;
}

export interface RankedGames {
  /** Throws NotRatedError (a player without a live account) or EmptyPoolError (no ranked puzzles). */
  createConfig(setup: RankedGameSetup): Promise<GameConfig>;
  record(config: GameConfig): GameRecorder;
  /**
   * A friends room's game (1.0.4) [D81a]: mode 'ranked' (the engine's rules for it), the players without
   * ratings, the puzzle from the ranked pool by the same no-repeat rule. Throws EmptyPoolError (no ranked
   * puzzles of the type). The room checked the accounts when they joined.
   */
  createFriendsConfig(setup: RankedGameSetup): Promise<GameConfig>;
  /** Records a friends room's game: games.mode 'friends', no rating, XP within the daily practice cap. */
  recordFriends(config: GameConfig): GameRecorder;
}

export interface RankedGamesOptions {
  db: Db | (() => Db);
  ratingOption: RatingOption;
  cheat: CheatThresholds;
  puzzles: RankedPuzzleSource;
  log: RecorderLog;
  scheduler?: Scheduler;
  recorder?: Partial<RecorderTuning>;
  /**
   * PRACTICE_XP_DAILY_CAP (config.progress.practiceXpDailyCap): the cap a friends game's XP shares with
   * practice and the levels (default DEFAULT_PRACTICE_XP_DAILY_CAP).
   */
  practiceXpDailyCap?: number;
}

/**
 * The people among a game's players (users.id): every id but a persona's, in their order. The puzzle is
 * picked by their histories alone. Never empty in practice (a stealth game has its person); if it were, the
 * pick has no history to avoid, as for a new player.
 */
async function peopleOf(db: Db, ids: readonly string[]): Promise<string[]> {
  const personaIds = await personaIdsAmong(db, ids);
  return ids.filter((id) => !personaIds.has(id));
}

export function rankedGames(options: RankedGamesOptions): RankedGames {
  const database = typeof options.db === 'function' ? options.db : () => options.db as Db;
  return {
    async createConfig({ id, gameType, players, rules: overrides = {}, seed }) {
      const key = ratingKeyFor(gameType, players.length, options.ratingOption);
      const rules = defaultRules('ranked', gameType, {
        ...overrides,
        rating: { ...DEFAULT_RATING_RULES, ...overrides.rating, option: options.ratingOption },
      });
      const ids = players.map((p) => p.id);
      // Accounts first: a player without one fails the game before a puzzle is spent on it.
      const ratings = await ratingsAtStart(database(), ids, key, rules.rating.initialRating);
      const puzzle = await options.puzzles.pickFor(gameType, await peopleOf(database(), ids));
      return {
        id,
        mode: 'ranked',
        gameType,
        puzzle,
        players: players.map((p) => {
          const r = ratings.get(p.id)!;
          return { id: p.id, name: p.name, rating: r.rating, ratedGames: r.games };
        }),
        rules,
        seed,
      };
    },

    record(config) {
      return new GameRecorder({
        db: database,
        config,
        ratingKey: ratingKeyFor(config.gameType, config.players.length, config.rules.rating.option),
        cheat: options.cheat,
        scheduler: options.scheduler,
        log: options.log,
        ...options.recorder,
      });
    },

    async createFriendsConfig({ id, gameType, players, rules: overrides = {}, seed }) {
      const rules = defaultRules('ranked', gameType, overrides);
      const puzzle = await options.puzzles.pickFor(
        gameType,
        players.map((p) => p.id),
      );
      return {
        id,
        mode: 'ranked',
        gameType,
        puzzle,
        // No rating and no rated games: the engine's result has no rating changes (results.ts).
        players: players.map((p) => ({ id: p.id, name: p.name })),
        rules,
        seed,
      };
    },

    recordFriends(config) {
      return new GameRecorder({
        db: database,
        config,
        ratingKey: null,
        friends: true,
        xpDailyCap: options.practiceXpDailyCap ?? DEFAULT_PRACTICE_XP_DAILY_CAP,
        cheat: options.cheat,
        scheduler: options.scheduler,
        log: options.log,
        ...options.recorder,
      });
    },
  };
}
