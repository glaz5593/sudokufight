import {
  type GameType,
  type InterferenceKind,
  type League,
  LEVEL_RULES,
  maxLevel,
  type Stars,
} from '@sudoku-fight/engine';

import type { AvatarId, CountryCode, NO_AVATAR_ID } from './account';

/**
 * Leaderboards, player cards and progress (spec §14.2, §14.3, §11.3, §15; work plan stage 12). Every route
 * takes the Firebase ID token (Authorization: Bearer). The rules (XP, levels, leagues) are the engine's
 * progress module; the server applies them and the app shows the numbers it gets.
 *
 * Routes:
 *   GET  /v1/leaderboard?tab=general|fast|normal|hard|friends&players=2|3|4&cursor=  → Leaderboard
 *        `players` only under RATING_OPTION=A (§11.1: a game-type tab shows a 2 / 3 / 4 picker); ignored under B.
 *   GET  /v1/players/:id                                                          → PlayerCard · 404
 *   GET  /v1/me/progress                                                          → MyProgress
 *   POST /v1/me/practice-results  PracticeResultsRequest                          → PracticeResultsResponse
 *        Practice XP is earned on the phone, queued while offline and sent when there is a connection [D41];
 *        each result has its own id, so a resend is counted once.
 *   GET  /v1/me/levels                                                            → MyLevels
 *   PUT  /v1/me/levels            PutMyLevelsRequest                              → LevelsSyncResponse
 *        Staged practice (1.0.2, spec §5.3.7, §15) [D55, D57]: the best of every level, kept on the server at
 *        the max ever sent, and the level XP the server pays from it (the section below).
 * Every route may answer (ProgressError): 400 badRequest (a bad tab, players, cursor, id or body; a body of
 * more than MAX_PRACTICE_RESULTS results or MAX_LEVELS_PER_REQUEST levels) · 401 unauthorized (refresh the token and try once more) · 404 notRegistered
 * (the sign-in has no account) or notFound (no such player, or a deleted one) · 413 tooLarge · 429
 * tooManyRequests (wait Retry-After seconds) · 503 disabled or unavailable · 500 internal. Answers are
 * personal: `Cache-Control: no-store`.
 *
 * Words the server uses (stage 12): a "win" is first place alone; first place shared is a "tie"; any later
 * place is a "loss" (the card's stats and streaks). XP follows §15's "place 1": a shared first place in a
 * ranked game earns xp.win too; a tie against a bot earns xp.played. On the 'friends' tab
 * `entries` is empty and `nextCursor` null: the list is `friends.recentOpponents`, each with their 'general'
 * rating and rank; `me` is my 'general' row.
 */

export const PROGRESS_PATHS = {
  leaderboard: '/v1/leaderboard',
  player: '/v1/players/:id',
  myProgress: '/v1/me/progress',
  practiceResults: '/v1/me/practice-results',
  myLevels: '/v1/me/levels',
} as const;

export const playerPath = (id: string): string => `/v1/players/${encodeURIComponent(id)}`;

export const LEADERBOARD_TABS = ['general', 'fast', 'normal', 'hard', 'friends'] as const;
export type LeaderboardTab = (typeof LEADERBOARD_TABS)[number];

export const LEADERBOARD_PAGE_SIZE = 50;
export const PODIUM_SIZE = 3;
/** §14.3: the last results on a player card. */
export const PLAYER_CARD_RECENT = 10;
/** A card's favourite interference counts the player's last this many ranked games (a bounded query). */
export const FAVORITE_INTERFERENCE_GAMES = 100;
/** Practice results per request. */
export const MAX_PRACTICE_RESULTS = 50;

export interface PublicPlayer {
  id: string;
  displayName: string;
  avatarId: AvatarId | typeof NO_AVATAR_ID;
  country: CountryCode | null;
  /** Null while every rating key is still provisional (§11.3). */
  league: League | null;
  level: number;
}

export interface LeaderboardEntry extends PublicPlayer {
  /** 1-based; equal ratings share a rank. */
  rank: number;
  rating: number;
  provisional: boolean;
  games: number;
}

export interface Leaderboard {
  tab: LeaderboardTab;
  /** The rating key this tab ranks by ('normal', 'normal-2p'); 'general' = each player's highest key [§14.2]. */
  ratingKey: string | null;
  /** Under option A, which table size a game-type tab shows. */
  players: 2 | 3 | 4 | null;
  entries: LeaderboardEntry[];
  /** My row, pinned at the bottom (§14.2), also when I'm on the page; null before any rated game in this tab. */
  me: LeaderboardEntry | null;
  /** Null on the last page. */
  nextCursor: string | null;
  /**
   * The 'friends' tab in V1 [D27]: recent opponents (newest first) and the invite button. Empty → the empty
   * state. Null on the other tabs.
   */
  friends: { recentOpponents: LeaderboardEntry[]; inviteUrl: string | null } | null;
}

export interface RatingSummary {
  key: string;
  rating: number;
  peak: number;
  games: number;
  provisional: boolean;
  /** Rating after each of the last games in this key, oldest first (at most 20): the trend line. */
  trend: number[];
}

export type RecentOutcome = 'win' | 'loss' | 'tie';

export interface RecentResult {
  gameId: string;
  gameType: GameType;
  players: number;
  place: number;
  outcome: RecentOutcome;
  score: number;
  ratingDelta: number | null;
  endedAt: number;
}

export interface PlayerStats {
  games: number;
  wins: number;
  losses: number;
  /** 0–1; null without games. */
  winRate: number | null;
  /** Current and best win streaks [D28]. */
  streak: number;
  bestStreak: number;
  bestMove: { points: number; gameId: string } | null;
  avgMistakes: number | null;
}

/**
 * "ההפרעה האהובה" (Profile.dc.html): the interference the player sent most in their last
 * FAVORITE_INTERFERENCE_GAMES ranked games, and how many times. Counted on the server from the games' stored
 * events (game_events of type 'interference' whose fromId is the player), through the player's own games only:
 * no new column, and a cost bounded by the window. Equal counts: the kind sent most recently.
 */
export interface FavoriteInterference {
  kind: InterferenceKind;
  count: number;
}

export interface PlayerCard extends PublicPlayer {
  /**
   * "במשחק מאז" (Profile.dc.html): when the account was made (users.created_at), epoch ms. Null only on a
   * card an older server sent (or an older app saved).
   */
  joinedAt: number | null;
  xp: number;
  /** Every rating key of the player: 3 under option B, 9 under option A (§14.3). */
  ratings: RatingSummary[];
  /** Ranked games only (practice stays on the phone). */
  stats: PlayerStats;
  /** Null before any interference in a ranked game (or from an older server). */
  favoriteInterference: FavoriteInterference | null;
  /** Newest first, at most PLAYER_CARD_RECENT. */
  recent: RecentResult[];
  /** Earned achievements, newest first (empty until the list is approved, stage 12). */
  achievements: { key: string; earnedAt: number }[];
}

export interface MyProgress {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  league: League | null;
  /** The rating the league comes from [D9], null while all keys are provisional. */
  leagueRating: number | null;
}

export type PracticeOutcome = 'win' | 'loss' | 'tie' | 'completed' | 'ended';
export const PRACTICE_OUTCOMES = [
  'win',
  'loss',
  'tie',
  'completed',
  'ended',
] as const satisfies readonly PracticeOutcome[];

/** A practice result's id: 1–64 letters, digits, `_` or `-` (a UUID fits). */
export const PRACTICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface PracticeResult {
  /** The practice game's id on the phone; a resend with the same id is ignored. */
  id: string;
  mode: 'solo' | 'bot';
  gameType: GameType;
  outcome: PracticeOutcome;
  correct: number;
  endedAt: number;
}

export interface PracticeResultsRequest {
  results: PracticeResult[];
}

export interface PracticeResultsResponse {
  accepted: number;
  duplicates: number;
  /**
   * Results the server refused as implausible (ended in the future, or too long ago to count): not stored, no
   * XP. The phone drops them from its queue like the others (any 200 empties the batch sent). A 400 means the
   * batch itself is malformed and a resend fails the same way; 401, 429, 5xx and no answer keep it queued.
   */
  rejected?: number;
  progress: MyProgress;
}

// ---------------------------------------------------------------------------------------------------------
// Staged practice (1.0.2)

/**
 * The levels' progress on the server (spec §5.3.7, §15) [D55, D57]. Levels are played on the phone and kept
 * there (levels.db); the phone sends each level's best (`PUT /v1/me/levels`: the changed ones, or all of them),
 * and the server keeps the max ever sent per level, so two phones merge into the best of both and a new phone
 * gets it all back (`GET /v1/me/levels`).
 *
 * Level XP is the server's own count, from what it stores: 10 for each best star of every level and 50 for each
 * open gate (the engine's levelsXpEarned), less what it already paid. So a resend, or the same star from two
 * phones, is paid once, and nothing goes through the practice results' queue. It shares the daily cap of
 * practice (PRACTICE_XP_DAILY_CAP, per UTC day of the server's clock); what does not fit today is paid on a
 * later day, at the next PUT (an empty one will do), and `owedXp` says how much is still to come.
 *
 * Compatibility: a server without this route answers 404 notFound (not notRegistered): the phone keeps its
 * levels and tries again later. A level id the server does not know yet (a newer app with more chapters: L301
 * on a server of 300) is skipped and listed in `unknown`, never a 400, so the rest is still stored; an id that
 * is not one at all (`l001`, `L1`, `L000`) is a 400.
 */

/** A level's id: "L" and its number in 3 digits, or 4 from L1000 (L001 … L300 today). */
export const LEVEL_ID_PATTERN = /^L[0-9]{3,4}$/;

/** Levels per PUT: every level there is (the engine's maxLevel(LEVEL_RULES), 300 today). */
export const MAX_LEVELS_PER_REQUEST = maxLevel(LEVEL_RULES);

/** The most plays a level's best may say (far beyond anyone's; a bound for the server, not a rule of the game). */
export const MAX_LEVEL_PLAYS = 1_000_000;

/**
 * One level's best, as the phone has it and the server keeps it: the best stars ever, and how many plays
 * counted (a play is any end the engine counts, countsAsPlayed). Stars need a play. Not the engine's
 * LevelBest (stars and the best measure), which stays on the phone.
 */
export interface LevelBest {
  /** "L001" … (LEVEL_ID_PATTERN, in its one spelling: the engine's levelIdOf). */
  id: string;
  stars: Stars;
  /** 0 … MAX_LEVEL_PLAYS. */
  plays: number;
}

export interface PutMyLevelsRequest {
  /** At most MAX_LEVELS_PER_REQUEST; an id twice counts as its max. Empty: only collect the XP still owed. */
  levels: LevelBest[];
}

export interface MyLevels {
  /** Every level the server has a best of (none never played), in level order. */
  levels: LevelBest[];
  /** How many levels the server knows (maxLevel(LEVEL_RULES)); a higher id is `unknown` to it. */
  maxLevel: number;
  /** Level XP earned but not paid yet (the daily cap): paid on a later day, at the next PUT. */
  owedXp: number;
}

export interface LevelsSyncResponse extends MyLevels {
  /** The level XP this request paid (0 for a resend). */
  xp: number;
  /** XP and level after it, as GET /v1/me/progress answers. */
  progress: MyProgress;
  /** Well-formed ids above `maxLevel`, sorted: skipped, not stored. Send them again to a newer server. */
  unknown: string[];
}

export const PROGRESS_ERROR_CODES = [
  'badRequest',
  'unauthorized',
  'notRegistered',
  'notFound',
  'tooLarge',
  'tooManyRequests',
  'internal',
  'disabled',
  'unavailable',
] as const;
export type ProgressErrorCode = (typeof PROGRESS_ERROR_CODES)[number];

export interface ProgressError {
  error: ProgressErrorCode;
  message?: string;
}
