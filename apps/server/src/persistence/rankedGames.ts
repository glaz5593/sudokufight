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

import type { CheatThresholds } from '../config';
import type { Db } from '../db';
import type { RankedPuzzleSource } from '../puzzles/rankedSource';
import { ratingKeyFor, ratingsAtStart } from '../ratings';
import { GameRecorder, type RecorderLog, type RecorderTuning } from './recorder';

/**
 * Ranked games on the server, start to end (stage 9; spec §11, §19, §20, §21): what a game room needs from
 * the database.
 *
 * - createConfig(): the game's config. The puzzle comes from the ranked pool without repeats (../puzzles);
 *   each player's rating and rated games in the game's key come from `ratings` (the engine computes the
 *   changes from them at the end); the rating rules carry the server's RATING_OPTION [D7].
 * - record(): a GameRecorder for the game: games, game_players, game_events, histories, then the result,
 *   ratings and anomaly flags (./recorder, ./records).
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
}

export interface RankedGamesOptions {
  db: Db | (() => Db);
  ratingOption: RatingOption;
  cheat: CheatThresholds;
  puzzles: RankedPuzzleSource;
  log: RecorderLog;
  scheduler?: Scheduler;
  recorder?: Partial<RecorderTuning>;
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
      const puzzle = await options.puzzles.pickFor(gameType, ids);
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
  };
}
