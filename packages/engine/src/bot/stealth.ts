import type { InterferenceKind } from '../game/rules';
import type {
  BotConfig,
  BotProfile,
  BotReaction,
  BotReactionTrigger,
  BotRetaliationPolicy,
  MsRange,
} from './levels';

/**
 * The stealth bot (stealth-bot plan, D90–D99; Moshe, 2026-10-19 and his "yes" of 2026-10-20): when a ranked
 * two-player search finds nobody, the server may seat a bot that looks and plays like a person. The engine's
 * part: the level it plays by, built from its opponent's own pace (./pace), and its rule for interferences:
 * it never starts one, and hits back for each one it received (D98, ./brain decideRetaliation).
 *
 * Every number lives in STEALTH_BOT_CONFIG, so tuning is a config change (CLAUDE.md, open decisions as
 * settings). Most are a first guess, to be tuned by the win rate against it that the admin site shows (target
 * 45%–55%). Whether a server seats it at all is the server's switch (STEALTH_BOT_ENABLED, off by default, and
 * the admin switch), not the engine's.
 */

export interface StealthBotConfig {
  /**
   * [D96] A move's base is drawn uniformly from (1 ± spread) × the player's base (Moshe: ±30%), then × the
   * cell's difficulty factor, as every bot's (brain thinkTime).
   */
  spread: number;
  /** [D96] The base of a player without a ranked game with data: an ordinary move, ms (between Biscuit and Mr. Hoot). */
  defaultBaseMs: number;
  /** [D96] The base is kept within these (ms), before and after the bot's own factors. */
  baseBounds: MsRange;
  /** [D96] How many of the player's last ranked games with data count. */
  games: number;
  /** [D96] With fewer games than this, his numbers are blended with the defaults (n/minGames of his). */
  minGames: number;
  /** [D96] When at least this many of those games are of the game type about to be played, only those count. */
  sameTypeMin: number;
  /** [D96] A move longer than this × the median of his moves in the game is not counted (the phone rang). */
  outlierFactor: number;
  /** [D97a] The bot errs at the player's own rate: wrong digits ÷ digits, within min–max; `default` without data. */
  mistakes: { min: number; max: number; default: number };
  /**
   * × the player's base, so the bot's mean time per move comes close to his (plan §5.1: "not by itself").
   * Two things pull against each other: the bot prefers easy cells (BOT_CONFIG.cellChoiceTemperature) more
   * surely than a person, so its cells are easier than his (quicker); and the base measured from his games
   * already holds the time he lost to cells taken from under him, which the bot loses again (slower).
   * Calibrated by the closed-loop test of simulation.test.ts (2026-10-20): at 1 the bot is within ±10% of a
   * model player's mean per move, and the model wins about half (1.1: three games of four).
   */
  normalization: number;
  /**
   * The tuning knob (plan §5.1): × the bot's base for everyone. Lower is quicker: if players beat it more than
   * 55% of the time, 0.95.
   */
  paceScale: number;
  /**
   * The guard against farming (plan §5.1): a player who wins more than `winShare` of `games` stealth games in a
   * row gets a bot quicker by `step`, down to `min`. The server passes his last `history` stealth results.
   */
  guard: { games: number; winShare: number; step: number; min: number; history: number };
  /** [D98] Hitting back: 2–20 s after the end of the interference it received, half the same kind. */
  retaliate: BotRetaliationPolicy;
  /**
   * [D97b] Its reactions: none (Moshe: "אייקונים: לדעתי אין צורך"; many people never react). The alternative,
   * a fixed temperament per persona, would be a table here.
   */
  reactions: Partial<Record<BotReactionTrigger, BotReaction>>;
}

export const STEALTH_BOT_CONFIG: StealthBotConfig = {
  spread: 0.3,
  defaultBaseMs: 14_000,
  baseBounds: { min: 3000, max: 40_000 },
  games: 10,
  minGames: 3,
  sameTypeMin: 5,
  outlierFactor: 3,
  mistakes: { min: 0.02, max: 0.2, default: 0.08 },
  normalization: 1,
  paceScale: 1,
  guard: { games: 10, winShare: 0.65, step: 0.05, min: 0.8, history: 40 },
  retaliate: { afterEndMs: { min: 2000, max: 20_000 }, chance: 1, sameKindShare: 0.5, retryMs: 1000 },
  reactions: {},
};

/** What stealthBotLevel builds the bot from: paceFromHistory's result, and the persona's kinds. */
export interface StealthBotInput {
  /** The player's base: an ordinary move, ms (paceFromHistory().baseMs). Not a positive number: the default. */
  baseMs: number;
  /** His mistake rate (paceFromHistory().mistakeRate). Not a number: the default. */
  mistakeRate: number;
  /** The guard's personal scale (paceFromHistory().scale); 1 by default. */
  scale?: number;
  /**
   * The kinds the persona may send: those its level has unlocked [D17]. The game's own kinds still have the
   * last word [D47]. Absent: all of the game's.
   */
  kinds?: readonly InterferenceKind[];
}

/**
 * [D96, D97a, D97b, D98] The level the stealth bot plays by, built for one game from its opponent's pace (the
 * pace is set once, at the start: it does not change during the game):
 * - think time: a base of the player's base × normalization × paceScale × his guard scale, within the bounds;
 *   each move draws (1 ± spread) of it, × the cell's difficulty (brain thinkTime);
 * - mistakes at his rate, within 2%–20%, plausible ones as every bot's;
 * - interferences: it never starts one (chance 0); it hits back for each one it received (D98);
 * - no reactions (D97b), and no slowing down when he trails (its pace is already his).
 * A value that is not a number falls back to the default, so a bad stored figure never stops a game.
 */
export function stealthBotLevel(
  input: StealthBotInput,
  config: StealthBotConfig = STEALTH_BOT_CONFIG,
): BotProfile {
  const { min, max } = config.baseBounds;
  const own = Number.isFinite(input.baseMs) && input.baseMs > 0 ? input.baseMs : config.defaultBaseMs;
  const scale =
    input.scale !== undefined && Number.isFinite(input.scale) && input.scale > 0 ? input.scale : 1;
  const base = Math.min(max, Math.max(min, own * config.normalization * config.paceScale * scale));
  const rate = Number.isFinite(input.mistakeRate) ? input.mistakeRate : config.mistakes.default;
  const retaliate: BotRetaliationPolicy = {
    ...config.retaliate,
    afterEndMs: { ...config.retaliate.afterEndMs },
  };
  if (input.kinds) retaliate.kinds = [...input.kinds];
  return {
    thinkMs: { min: Math.round(base * (1 - config.spread)), max: Math.round(base * (1 + config.spread)) },
    mistakeRate: Math.min(config.mistakes.max, Math.max(config.mistakes.min, rate)),
    interference: { maxPerGame: null, minDeficit: null, chance: 0, retaliate },
    reactions: { ...config.reactions },
    adaptive: false,
  };
}

/**
 * attachBot's `config` for the stealth bot: its pace is already the player's own, so the pace per game type of
 * the level table never applies (1 for every type). Everything else as every bot's: the difficulty factors, the
 * choice of easy cells, the 80% of the lock, and the ~2% of locks left to run out (plan §5.3).
 */
export function stealthBotConfig(): Partial<BotConfig> {
  return { pace: { fast: 1, normal: 1, hard: 1 } };
}
