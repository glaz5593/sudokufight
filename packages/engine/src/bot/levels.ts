import type { PlayerInfo } from '../game/types';
import type { GameType } from '../gameType';

/**
 * Bots (spec §9; original spec §5.2, §20): five levels that play like people, not like a solver.
 *
 * Every number a bot plays by lives in BOT_CONFIG, so tuning one is a config change, not a code change
 * (CLAUDE.md, open decisions as settings): the level table of spec §9, the pace per game type, how the
 * difficulty of a cell stretches the think time, the share of locks a bot lets run out on purpose, and the
 * adaptation of levels 1–3. attachBot() takes overrides for a single bot.
 */

export const BOT_LEVEL_IDS = [1, 2, 3, 4, 5] as const;
export type BotLevelId = (typeof BOT_LEVEL_IDS)[number];

export const isBotLevelId = (v: unknown): v is BotLevelId => BOT_LEVEL_IDS.includes(v as BotLevelId);

/** A range of milliseconds; a value is drawn uniformly from it. */
export interface MsRange {
  min: number;
  max: number;
}

/** When a level sends interferences (spec §9 table, §7.2) [D40]. */
export interface BotInterferencePolicy {
  /** At most this many per game; null: no limit beyond the rising cost [D10]. */
  maxPerGame: number | null;
  /**
   * Only while the bot trails the best opponent by at least this many points; 0: by any amount (strictly
   * behind); null: whatever the score.
   */
  minDeficit: number | null;
  /** The chance to send one at each decision point (after each of its own moves) when the rest allows it. */
  chance: number;
}

/**
 * What a bot reacts to (spec §8, §9): an opponent's wrong digit (😂), being hit by an interference (😱), and
 * taking the lead (Maestro's 😎).
 */
export const BOT_REACTION_TRIGGERS = ['opponentMistake', 'hit', 'tookLead'] as const;
export type BotReactionTrigger = (typeof BOT_REACTION_TRIGGERS)[number];

export interface BotReaction {
  emoji: string;
  /** The chance to react when the trigger happens; the rate limit [D19] still applies. */
  chance: number;
}

/** One row of the level table (spec §9). */
export interface BotLevel {
  level: BotLevelId;
  /** A name, not a UI string: the same in every language. The level's title ("Novice") is the app's t(). */
  name: string;
  /** assets/avatars/<avatar>.svg */
  avatar: string;
  /** Base think time per move for the 'normal' game type; the others scale by `pace` (spec §9). */
  thinkMs: MsRange;
  /** The chance that a digit is wrong (a plausible one, never a random one). */
  mistakeRate: number;
  interference: BotInterferencePolicy;
  reactions: Partial<Record<BotReactionTrigger, BotReaction>>;
  /** Slows down a little when the human trails far behind (spec §9: levels 1–3 only). */
  adaptive: boolean;
}

/** How hard a cell looks on the current board: the simplest technique that solves it now. */
export const CELL_TECHNIQUES = ['nakedSingle', 'hiddenSingle', 'harder'] as const;
export type CellTechnique = (typeof CELL_TECHNIQUES)[number];

export interface BotConfig {
  /** The level table (spec §9). */
  levels: readonly BotLevel[];
  /** Think time multiplier per game type (spec §9: fast ×0.67, normal ×1, hard ×1.5). */
  pace: Record<GameType, number>;
  /**
   * The difficulty factor of a cell (spec §9: "the cell's difficulty: the number of options or the technique
   * it needs"): technique × (1 + perExtraOption × (options − 1)), at most `max`. Options are the cell's
   * candidates on the current board, without the digits already tried there.
   */
  difficulty: {
    technique: Record<CellTechnique, number>;
    perExtraOption: number;
    max: number;
  };
  /**
   * Cell choice (spec §9: "prefers easy cells, with random noise"): a cell is drawn with weight
   * exp(−(factor − easiest factor) / temperature). Lower picks the easiest cell more surely.
   */
  cellChoiceTemperature: number;
  /** After locking, the digit comes within this share of the game type's think time (spec §9: 80%). */
  placeWithin: number;
  /** The share of a move's think time spent after locking; the rest is the hesitation before it. */
  solveShare: { min: number; max: number };
  /** Locks the bot lets run out on purpose, "deliberate hesitation" (spec §9: about 2%). */
  lingerShare: number;
  /** Levels with `adaptive`: when the human trails by more than `humanTrailingBy`, think times × `slowdown`. */
  adaptation: { humanTrailingBy: number; slowdown: number };
  /** How long after its trigger a reaction comes. */
  reactionDelayMs: MsRange;
  /** How long after the decision an interference is launched. */
  interferenceDelayMs: MsRange;
  /** The wait before trying again after a refused action. */
  retryMs: number;
}

/** The level table of spec §9, as data. */
const LEVELS: readonly BotLevel[] = [
  {
    level: 1,
    name: 'Pip',
    avatar: 'av44', // mouse
    thinkMs: { min: 8000, max: 11000 },
    mistakeRate: 0.15,
    // "Rare: at most once a game" [D40].
    interference: { maxPerGame: 1, minDeficit: null, chance: 0.02 },
    // "Rare".
    reactions: { opponentMistake: { emoji: '😂', chance: 0.1 }, hit: { emoji: '😱', chance: 0.1 } },
    adaptive: true,
  },
  {
    level: 2,
    name: 'Biscuit',
    avatar: 'av42', // dog
    thinkMs: { min: 6000, max: 9000 },
    mistakeRate: 0.09,
    // "Sometimes, when trailing by 15 points or more" [D40].
    interference: { maxPerGame: null, minDeficit: 15, chance: 0.25 },
    // "😂 sometimes".
    reactions: { opponentMistake: { emoji: '😂', chance: 0.4 } },
    adaptive: true,
  },
  {
    level: 3,
    name: 'Mr. Hoot',
    avatar: 'av49', // owl
    thinkMs: { min: 4000, max: 7000 },
    mistakeRate: 0.05,
    // "When trailing by 10 points or more".
    interference: { maxPerGame: null, minDeficit: 10, chance: 0.5 },
    // "Yes".
    reactions: { opponentMistake: { emoji: '😂', chance: 0.6 }, hit: { emoji: '😱', chance: 0.6 } },
    adaptive: true,
  },
  {
    level: 4,
    name: 'Maestro',
    avatar: 'av39', // gentleman
    thinkMs: { min: 3000, max: 5000 },
    mistakeRate: 0.02,
    // "When trailing".
    interference: { maxPerGame: null, minDeficit: 0, chance: 0.5 },
    // "😎": a gentleman stays cool.
    reactions: {
      opponentMistake: { emoji: '😎', chance: 0.5 },
      hit: { emoji: '😎', chance: 0.5 },
      tookLead: { emoji: '😎', chance: 0.5 },
    },
    adaptive: false,
  },
  {
    level: 5,
    name: 'Overlord',
    avatar: 'av40', // monkey
    thinkMs: { min: 2000, max: 4000 },
    mistakeRate: 0.01,
    // "Aggressive": whatever the score, whenever it can pay; the doubling cost [D10] keeps it in check.
    interference: { maxPerGame: null, minDeficit: null, chance: 0.6 },
    // "Yes".
    reactions: { opponentMistake: { emoji: '😂', chance: 0.85 }, hit: { emoji: '😱', chance: 0.85 } },
    adaptive: false,
  },
];

export const BOT_CONFIG: BotConfig = {
  levels: LEVELS,
  pace: { fast: 0.67, normal: 1, hard: 1.5 },
  difficulty: {
    technique: { nakedSingle: 1, hiddenSingle: 1.25, harder: 1.6 },
    perExtraOption: 0.05,
    max: 2,
  },
  cellChoiceTemperature: 0.15,
  placeWithin: 0.8,
  solveShare: { min: 0.25, max: 0.5 },
  lingerShare: 0.02,
  adaptation: { humanTrailingBy: 25, slowdown: 1.2 },
  reactionDelayMs: { min: 600, max: 1600 },
  interferenceDelayMs: { min: 400, max: 1200 },
  retryMs: 300,
};

/** The level table (spec §9). */
export const BOT_LEVELS: readonly BotLevel[] = BOT_CONFIG.levels;
/** Think time multiplier per game type (spec §9). */
export const BOT_PACE: Record<GameType, number> = BOT_CONFIG.pace;

/** The defaults with a bot's own overrides. */
export const botConfig = (overrides: Partial<BotConfig> = {}): BotConfig => ({ ...BOT_CONFIG, ...overrides });

export function botLevel(level: BotLevelId, config: BotConfig = BOT_CONFIG): BotLevel {
  const row = config.levels.find((l) => l.level === level);
  if (!row) throw new RangeError(`No bot level ${String(level)}`);
  return row;
}

/** The bot as a player of a game: { id: `bot-<level>`, its name, isBot }. */
export function botPlayer(level: BotLevelId, id?: string): PlayerInfo {
  return { id: id ?? `bot-${level}`, name: botLevel(level).name, isBot: true };
}
