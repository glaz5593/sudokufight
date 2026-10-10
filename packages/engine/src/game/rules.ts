import type { GameType } from '../gameType';
import { DEFAULT_ELO, type EloOptions, INITIAL_RATING, type RatingOption } from '../rating';
import type { ScoreY } from '../sudoku/scoring';

/**
 * Game rules (spec §6–§8, §11.2, §16.2). Every open decision that touches the engine (D1–D19, D23, D31, D32,
 * D36; work plan stage 2) is a field here with the spec's default, so a change of mind is a config change,
 * not a code change. Decisions marked "pending approval" in spec §24 default to the original spec.
 */

export const GAME_MODES = ['solo', 'bot', 'ranked'] as const;
/** Solo practice, practice against a bot, or ranked (2–4 players) (spec §5.1). */
export type GameMode = (typeof GAME_MODES)[number];

export type TurnModel = 'simultaneous' | 'turns';

/** The V1 interferences (spec §7.1); more unlock later [D17]. */
export const INTERFERENCE_KINDS = ['fireworks', 'cats', 'warp'] as const;
export type InterferenceKind = (typeof INTERFERENCE_KINDS)[number];

/** The six base reactions (spec §8). */
export const REACTIONS = ['😂', '😱', '😎', '🤦', '🔥', '👀'] as const;

/** Why a lock ended without a correct digit. */
export type ReleaseReason =
  'cancel' | 'timeout' | 'switch' | 'mistake' | 'surrender' | 'disconnect' | 'abandon';

/** Think time per game type (spec §5.2) [D2]. */
export const THINK_TIME_MS: Record<GameType, number> = { fast: 8000, normal: 12000, hard: 18000 };

/** Rating rules (spec §11.2): Elo [D31], the starting point [D23], abandonment [D8, D32], the keys [D7]. */
export interface RatingRules extends EloOptions {
  /** B: one rating per game type; A: per game type and player count [D7]. */
  option: RatingOption;
  /** [D23] */
  initialRating: number;
  /** The [D32] alternative: extra rating points an abandoning player loses on top of the Elo result. */
  abandonPenalty: number;
}

export const DEFAULT_RATING_RULES: RatingRules = {
  ...DEFAULT_ELO,
  option: 'B',
  initialRating: INITIAL_RATING,
  abandonPenalty: 0,
};

export interface Rules {
  /** Everyone at once (the proposal, pending approval: the default), or one player at a time [D1]. */
  turnModel: TurnModel;
  /** In 'turns': how long the player whose turn it is has to pick a cell before the turn passes. */
  turnPickMs: number;

  /** How long a lock lasts before it is released automatically (spec §5.2, §6.2.4) [D2]. */
  thinkTimeMs: number;
  /** Points lost when a lock times out [D2: none]. */
  timeoutPenalty: number;
  /** After a release for any reason the same player waits this long to lock the same cell again (§6.2.6) [D2]. */
  relockCooldownMs: number;
  relockCooldownAfter: readonly ReleaseReason[];

  /** After a wrong digit the cell is released for everyone, or stays locked to whoever erred [D3]. */
  afterMistake: 'release' | 'keepLock';
  /** A digit already tried wrongly in a cell is disabled there for everyone, or only for whoever tried it [D12]. */
  wrongDigitDisabledFor: 'everyone' | 'mistaker';
  /** How Y of the score is picked: second after sorting, or second distinct value [D13]. */
  scoreY: ScoreY;
  /** The [D14] proposal: cap a single penalty (e.g. 8). null keeps the original doubling without a cap. */
  mistakePenaltyCap: number | null;
  /** Scores may go below zero [D15]. */
  negativeScore: boolean;
  /** Equal scores: fewer mistakes ranks higher, or whoever made their last correct move earlier [D16]. */
  tieBreak: 'fewerMistakes' | 'earlierLastMove';
  /** 3–4 players: whoever surrenders ranks by the order of leaving, or stays in the table by score [D36]. */
  surrenderRanking: 'exitOrder' | 'byScore';

  /** Interferences are part of ranked and bot games, not of solo practice (spec §7.2). */
  interferences: boolean;
  /** The kinds open in this game [D17]. */
  interferenceKinds: readonly InterferenceKind[];
  /** Exactly 5 seconds (spec §7.2). */
  interferenceMs: number;
  /** The n-th interference costs base^n: 2, 4, 8 … [D10]. */
  interferenceCostBase: number;
  /** Launching needs score ≥ cost [D10]. */
  interferenceNeedsScore: boolean;
  /** No interference on a player already under one, nor this long after it ends [D11]. */
  interferenceImmunityMs: number;
  /** The lock timer (and in 'turns' the turn timer) of a player under interference stops (§6.2.7) [D11]. */
  pauseLockWhileInterfered: boolean;

  /** At most one reaction per player per this many ms [D19]. */
  reactionCooldownMs: number;
  reactions: readonly string[];

  /** How long a disconnected player has to come back (spec §16.2) [D4]. */
  graceMs: number;
  /**
   * A game freezes while someone is disconnected if at most this many players are still in it (2 → a
   * two-player game freezes, a game of 3–4 goes on) [D4].
   */
  freezeUpToPlayers: number;

  rating: RatingRules;
}

export function defaultRules(mode: GameMode, gameType: GameType, overrides: Partial<Rules> = {}): Rules {
  return {
    turnModel: 'simultaneous',
    turnPickMs: THINK_TIME_MS[gameType],
    thinkTimeMs: THINK_TIME_MS[gameType],
    timeoutPenalty: 0,
    relockCooldownMs: 1000,
    relockCooldownAfter: ['cancel', 'timeout', 'switch', 'mistake', 'disconnect'],
    afterMistake: 'release',
    wrongDigitDisabledFor: 'everyone',
    scoreY: 'sorted',
    mistakePenaltyCap: null,
    negativeScore: true,
    tieBreak: 'fewerMistakes',
    surrenderRanking: 'exitOrder',
    interferences: mode !== 'solo',
    interferenceKinds: INTERFERENCE_KINDS,
    interferenceMs: 5000,
    interferenceCostBase: 2,
    interferenceNeedsScore: true,
    interferenceImmunityMs: 1000,
    pauseLockWhileInterfered: true,
    reactionCooldownMs: 2000,
    reactions: REACTIONS,
    graceMs: 15000,
    freezeUpToPlayers: 2,
    rating: DEFAULT_RATING_RULES,
    ...overrides,
  };
}
