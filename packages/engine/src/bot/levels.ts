import type { PlayerInfo } from '../game/types';
import type { GameType } from '../gameType';
import { TECHNIQUES } from '../sudoku/logic';

/**
 * Bots (spec §9; original spec §5.2, §20): five levels that play like people, not like a solver.
 *
 * Every number a bot plays by lives in BOT_CONFIG, so tuning one is a config change, not a code change
 * (CLAUDE.md, open decisions as settings): the level table of spec §9, the pace per game type, how the
 * difficulty of a cell stretches the think time, the share of locks a bot lets run out on purpose, and the
 * adaptation of levels 1–3. attachBot() takes overrides for a single bot.
 *
 * The think times are Moshe's (2026-10-14, after the first APK: "the bots are far too fast"): an ordinary
 * move takes 15–25 s for the Novice down to 3–5 s for the Grandmaster, and a cell that needs a harder
 * deduction takes longer, even for the best. They are a first guess, to be tuned from real players'
 * statistics (think time per move by rating and by technique): a change of BOT_CONFIG, nothing else.
 */

export const BOT_LEVEL_IDS = [1, 2, 3, 4, 5] as const;
export type BotLevelId = (typeof BOT_LEVEL_IDS)[number];

export const isBotLevelId = (v: unknown): v is BotLevelId => BOT_LEVEL_IDS.includes(v as BotLevelId);

/** A range of milliseconds; a value is drawn uniformly from it. */
export interface MsRange {
  min: number;
  max: number;
}

/**
 * When a level sends interferences (spec §9 table, §7.2) [D40]. The policy applies only in a game whose rules
 * have interferences on: today that is the fake client (a test tool that plays ranked as an ordinary
 * account), or a rules override. Practice against a bot has none, so a bot there never interferes [D44];
 * the values stay as config in case interferences against a bot ever come back.
 */
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
 * What a bot reacts to (spec §8, §9): an opponent's wrong digit (😂), being hit by an interference (😱, only
 * in a game that has interferences [D44]), and taking the lead (Maestro's 😎).
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
  /**
   * An avatar id of the catalog (packages/avatars, protocol AVATAR_IDS). A plain string: the engine does not
   * depend on the avatars. The bots wore the first pack until 2026-10-12 (spec §3.4); each kept its character.
   */
  avatar: string;
  /**
   * Base think time per move (spec §9): an ordinary move, a naked single, from the moment the bot can start
   * on it to its digit. A move takes base × the cell's difficulty factor (× `pace` of the game type, × the
   * adaptation); the base is drawn uniformly from this range with the injected RNG.
   */
  thinkMs: MsRange;
  /** The chance that a digit is wrong (a plausible one, never a random one). */
  mistakeRate: number;
  /** Only where interferences are on (the fake client in ranked, an override); never in bot practice [D44]. */
  interference: BotInterferencePolicy;
  reactions: Partial<Record<BotReactionTrigger, BotReaction>>;
  /** Slows down a little when the human trails far behind (spec §9: levels 1–3 only). */
  adaptive: boolean;
}

/**
 * The deduction that solves a cell on the board as it is, easiest first (spec §9): what the bot "sees" there.
 * The logical solver's own techniques (sudoku/logic, the ones the explanations use), plus two ends:
 *   lastGap       the last empty cell of a row, column or box, or the last place of a digit that is already
 *                 on the board eight times: nothing to work out
 *   nakedSingle   one digit fits the cell
 *   hiddenSingle  a digit fits nowhere else in one of the cell's row, column or box
 *   pointing, claiming, nakedPair, hiddenPair
 *                 a single only after eliminations; the hardest technique those needed (simplest first)
 *   harder        none of these: it needs other cells first, or more than the solver knows
 */
export const CELL_TECHNIQUES = ['lastGap', ...TECHNIQUES, 'harder'] as const;
export type CellTechnique = (typeof CELL_TECHNIQUES)[number];

export interface BotConfig {
  /** The level table (spec §9). */
  levels: readonly BotLevel[];
  /**
   * Think time multiplier per game type. 1 for all since 2026-10-14: the times are per move whatever the game
   * type, and a harder board is slower through its cells' techniques. Kept as a knob (spec §9).
   */
  pace: Record<GameType, number>;
  /**
   * The difficulty factor of a move (spec §9: "the cell's difficulty: the number of options or the technique
   * it needs"): technique × (1 + perExtraOption × (options − 1)), at most `max`. The technique is the
   * deduction that solves the cell on the board as it is (CELL_TECHNIQUES); a naked single is 1, the
   * reference of the level table. Options are the cell's candidates on the current board, without the
   * digits already tried there.
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

/**
 * The level table of spec §9, as data. Think times: Moshe's two ends (Novice 15–25 s, Grandmaster 3–5 s a
 * move), the levels between them evenly spaced (3 s off the bottom and 5 s off the top per level).
 */
const LEVELS: readonly BotLevel[] = [
  {
    level: 1,
    name: 'Pip',
    avatar: 'hatchling', // was a mouse: small and just out of the shell, a beginner
    thinkMs: { min: 15_000, max: 25_000 }, // Moshe: "15–25 s a move"
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
    avatar: 'fox', // was a dog: the catalog's canine
    thinkMs: { min: 12_000, max: 20_000 },
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
    avatar: 'owl', // an owl, as before
    thinkMs: { min: 9_000, max: 15_000 },
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
    avatar: 'professor', // was a gentleman: Professor Gedalya, mustache and all
    thinkMs: { min: 6_000, max: 10_000 },
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
    avatar: 'furry-monster', // was a monkey: the big furry one
    thinkMs: { min: 3_000, max: 5_000 }, // Moshe: "3–5 s a move"
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
  // The same per move in every game type (was fast ×0.67, hard ×1.5 until 2026-10-14).
  pace: { fast: 1, normal: 1, hard: 1 },
  difficulty: {
    // × the level's base. Novice: 12–20 s for a last gap, 15–25 s for a naked single, 19.5–32.5 s for a
    // hidden single, 25.5–42.5 s for pointing or claiming, 30–50 s for a pair, 37.5–62.5 s beyond that.
    technique: {
      lastGap: 0.8,
      nakedSingle: 1,
      hiddenSingle: 1.3,
      pointing: 1.7,
      claiming: 1.7,
      nakedPair: 2,
      hiddenPair: 2,
      harder: 2.5,
    },
    perExtraOption: 0.05,
    // A move takes at most 3 × the base (× 1.2 adapting): the Novice's longest is 75 s (90 s adapting).
    max: 3,
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
