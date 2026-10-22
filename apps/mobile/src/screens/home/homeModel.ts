import {
  BOT_LEVELS,
  BOT_PACE,
  type BotLevelId,
  defaultRules,
  GAME_TYPES,
  type GameMode,
  type GameType,
} from '@sudoku-fight/engine';
import type { QueuePlayerCount, RatingEntry } from '@sudoku-fight/protocol';

import { type AvatarIdOrNone, normalizeAvatarId } from '../../avatars';
import type { Outcome } from '../../game/outcome';
import type { PracticeGameRecord } from '../../game/practiceRepo';
import type { LastPlay } from '../../state/profile';
import { botLevelOf } from '../game/identity';

/**
 * Pure data for the home-level screens (spec §4.3, §5, §9): the six options of "משחק חדש", what each game type
 * means, the five bots to choose from, and how a saved practice reads in the recent list. No React, no rules
 * of play: the think time comes from the engine's rules config, the bots from the engine's level table, the
 * numbers of a game from the practice database.
 */

// ---------------------------------------------------------------------------------------------------------
// Game modes (spec §5.1): six options (D48, Moshe 15.10.2026: the sixth is staged practice).

export type ModeKey = 'ranked2' | 'ranked3' | 'ranked4' | 'bot' | 'solo' | 'levels';
export type ModeGroup = 'ranked' | 'practice';

export interface ModeOption {
  key: ModeKey;
  group: ModeGroup;
  /** The engine's game mode it starts; null for staged practice, which opens its map (/levels) instead. */
  mode: GameMode | null;
  /** Players at the table, the bot included. */
  players: number;
}

/**
 * In the order of the screen: ranked 2 · 3 · 4, then practice against a bot, solo practice (Moshe's device
 * test, 15.10.2026: the bot above solo), and staged practice after it (D48: the row 3.23 kept for it).
 */
export const MODE_OPTIONS: readonly ModeOption[] = [
  { key: 'ranked2', group: 'ranked', mode: 'ranked', players: 2 },
  { key: 'ranked3', group: 'ranked', mode: 'ranked', players: 3 },
  { key: 'ranked4', group: 'ranked', mode: 'ranked', players: 4 },
  { key: 'bot', group: 'practice', mode: 'bot', players: 2 },
  { key: 'solo', group: 'practice', mode: 'solo', players: 1 },
  { key: 'levels', group: 'practice', mode: null, players: 1 },
];

export const MODE_GROUPS: readonly ModeGroup[] = ['ranked', 'practice'];

/**
 * The sections of the list of "משחק חדש", top to bottom: the option groups, and between them, when the friends
 * buttons sit in the list (config/friends.ts FRIENDS_UI.modesPlacement 'list', 1.0.4's D80a), "עם חברים": one
 * row of two buttons, "צור חדר" | "הצטרף עם קוד", not options of its own (friends-room.md §2). Without it (the
 * buttons pinned under the list, D100, or FRIENDS_UI.modesGroup off) the list is the two groups, as in 1.0.3.
 */
export type ModesSection = ModeGroup | 'friends';

export function modesSections(friendsGroup: boolean): readonly ModesSection[] {
  return friendsGroup ? ['ranked', 'friends', 'practice'] : MODE_GROUPS;
}

/**
 * The options that can be played in this build: all six (ranked 2 players since stage 9, 3 and 4 since stage
 * 10, staged practice since 1.0.2), in the screen's order. A setting: an option left out shows "בקרוב" (with
 * its player count out of RANKED_TABLES_OPEN below).
 */
export const AVAILABLE_MODES: readonly ModeKey[] = ['ranked2', 'ranked3', 'ranked4', 'bot', 'solo', 'levels'];

export const isAvailable = (key: ModeKey): boolean => AVAILABLE_MODES.includes(key);

/** The mode of the game-type screen when the link names none (the results' "משחק חדש" keeps only the type). */
export const DEFAULT_MODE: GameMode = 'solo';

/**
 * The modes the game-type screen can start: the practices (against a bot via the bot selection), and ranked
 * (stage 9: the game type, then the matchmaking search).
 */
export const STARTABLE_MODES: readonly GameMode[] = ['solo', 'bot', 'ranked'];

export const isStartableMode = (mode: unknown): mode is GameMode =>
  STARTABLE_MODES.includes(mode as GameMode);

/**
 * The ranked tables this app offers: 2 players (stage 9), 3 and 4 (stage 10). A setting, apart from the
 * server's open queues (protocol OPEN_QUEUE_PLAYER_COUNTS): a server that closes a queue says `queueClosed`.
 */
export const RANKED_TABLES_OPEN: readonly QueuePlayerCount[] = [2, 3, 4];

export const isOpenPlayerCount = (n: unknown): n is QueuePlayerCount =>
  RANKED_TABLES_OPEN.includes(n as QueuePlayerCount);

/** A ranked table when none is named: the first open one (2 players). */
export const DEFAULT_RANKED_PLAYERS: QueuePlayerCount = RANKED_TABLES_OPEN[0] ?? 2;

/**
 * My rating for a ranked game of `type` at a table of `players` (spec §11.1): the key `normal-2p` under
 * RATING_OPTION A, else `normal` (B, the default). Null when the account has neither (or no account).
 */
export function rankedRatingIn(
  ratings: readonly RatingEntry[] | null,
  type: GameType,
  players: QueuePlayerCount = DEFAULT_RANKED_PLAYERS,
): RatingEntry | null {
  if (!ratings) return null;
  return ratings.find((r) => r.key === `${type}-${players}p`) ?? ratings.find((r) => r.key === type) ?? null;
}

// ---------------------------------------------------------------------------------------------------------
// Game types (spec §5.2) [D5]: board difficulty and pace together.

/** Preselected when the player has no last game yet: the middle one, as on the GameType board. */
export const DEFAULT_GAME_TYPE: GameType = 'normal';

export interface GameTypeInfo {
  gameType: GameType;
  /** How long a lock lasts (spec §5.2) [D2], from the engine's rules. */
  thinkTimeMs: number;
  /**
   * The spec's estimate in minutes, [from, to]. Spec §5.2 gives it for a 2-player game; there is no solo
   * figure yet, so this is the same until one is decided.
   */
  durationMin: readonly [number, number];
}

const DURATION_MIN: Record<GameType, readonly [number, number]> = {
  fast: [4, 6],
  normal: [6, 9],
  hard: [9, 14],
};

export function gameTypeInfo(mode: GameMode, gameType: GameType): GameTypeInfo {
  return {
    gameType,
    thinkTimeMs: defaultRules(mode, gameType).thinkTimeMs,
    durationMin: DURATION_MIN[gameType],
  };
}

export const gameTypeInfos = (mode: GameMode): GameTypeInfo[] =>
  GAME_TYPES.map((type) => gameTypeInfo(mode, type));

/** Whole seconds, for "8 ש׳". */
export const thinkSeconds = (info: GameTypeInfo): number => Math.round(info.thinkTimeMs / 1000);

// ---------------------------------------------------------------------------------------------------------
// The bots (spec §9): the engine's level table, as the bot selection shows it.

/**
 * Preselected when the player has not played a bot yet: the middle one, as on the BotSelect board (Mr. Hoot).
 * A setting, easy to change.
 */
export const DEFAULT_BOT_LEVEL: BotLevelId = 3;

export interface BotOption {
  level: BotLevelId;
  /** The bot's name: data from the engine, the same in every language. */
  name: string;
  avatar: AvatarIdOrNone;
  /**
   * The think time of an ordinary move (a naked single) in this game type: the table's × the pace, which is 1
   * in every type (spec §9). A harder cell takes longer, the last gap of a row, column or box less.
   */
  thinkMs: { min: number; max: number };
  /** The share of its digits that are wrong, 0–1. */
  mistakeRate: number;
}

/** The five bots for a game type, easiest first. */
export function botOptions(gameType: GameType): BotOption[] {
  const pace = BOT_PACE[gameType];
  return BOT_LEVELS.map((b) => ({
    level: b.level,
    name: b.name,
    avatar: normalizeAvatarId(b.avatar),
    thinkMs: { min: b.thinkMs.min * pace, max: b.thinkMs.max * pace },
    mistakeRate: b.mistakeRate,
  }));
}

/** Seconds with one decimal, none for whole ones: 5360 → "5.4", 8000 → "8", 16500 → "16.5". */
export function secondsText(ms: number): string {
  const tenths = Math.round(ms / 100);
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

/** A share as a whole percentage: 0.15 → 15. */
export const percentOf = (share: number): number => Math.round(share * 100);

// ---------------------------------------------------------------------------------------------------------
// The recent list (spec §4.3 "משחקים אחרונים בקצרה") and "עוד סיבוב".

/** How many saved games Home shows; the full list is the History screen (stage 11). */
export const HOME_RECENT_COUNT = 5;

/**
 * How a saved practice ended, for its row. Alone: the board was completed, or the player ended it ("סיום
 * אימון"). Against a bot: won, lost or tied. Either way: the app went away mid-game (interrupted), or it is
 * still running.
 */
export type RecentOutcome = 'completed' | 'ended' | Outcome | 'interrupted' | 'playing';

export function recentOutcome(
  game: Pick<PracticeGameRecord, 'status' | 'endReason'> & { outcome?: Outcome | null },
): RecentOutcome {
  if (game.status === 'interrupted') return 'interrupted';
  if (game.status === 'playing') return 'playing';
  if (game.outcome) return game.outcome;
  return game.endReason === 'boardComplete' ? 'completed' : 'ended';
}

/** The bot of a saved game: its level, by the opponent's id (`bot-3`); null for a solo practice. */
export function botLevelOfGame(game: Partial<Pick<PracticeGameRecord, 'opponents'>>): BotLevelId | null {
  for (const o of game.opponents ?? []) {
    const level = o.isBot ? botLevelOf(o.id) : null;
    if (level !== null) return level;
  }
  return null;
}

/**
 * The setting "עוד סיבוב" repeats: the one remembered, or else the newest saved game's. A bot practice comes
 * with its level: the one played, else the last one chosen (`botLevel`), else the default. A ranked one comes
 * with its number of players (a search in the same queue), while that table is open.
 */
export function lastPlayOf(
  remembered: LastPlay | null,
  recent: readonly (Pick<PracticeGameRecord, 'mode' | 'gameType'> &
    Partial<Pick<PracticeGameRecord, 'opponents'>>)[],
  botLevel: BotLevelId | null = null,
): LastPlay | null {
  const newest = recent[0];
  const play: LastPlay | null =
    remembered ??
    (newest ? { mode: newest.mode, gameType: newest.gameType, ...levelOf(botLevelOfGame(newest)) } : null);
  if (!play || !isStartableMode(play.mode)) return null;
  if (play.mode === 'ranked') {
    const players = play.players ?? DEFAULT_RANKED_PLAYERS;
    return isOpenPlayerCount(players) ? { mode: 'ranked', gameType: play.gameType, players } : null;
  }
  if (play.mode !== 'bot') return { mode: play.mode, gameType: play.gameType };
  return { mode: 'bot', gameType: play.gameType, botLevel: play.botLevel ?? botLevel ?? DEFAULT_BOT_LEVEL };
}

const levelOf = (level: BotLevelId | null): { botLevel?: BotLevelId } =>
  level === null ? {} : { botLevel: level };

/** When a game was played, in the app language: "9 באוק׳, 14:32". */
export function playedAtText(at: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace('T', ' ');
  }
}
