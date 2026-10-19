import type { GameType } from '../gameType';
import { DEFAULT_ELO, type EloOptions, INITIAL_RATING, type RatingOption } from '../rating';
import type { CellIndex } from '../sudoku/board';
import type { ScoreY } from '../sudoku/scoring';

/**
 * Game rules (spec §6–§8, §11.2, §16.2). Every open decision that touches the engine (D1–D13, D15–D19, D23,
 * D31, D32 and its leave guards, D36, D42, D44, D47; work plan stage 2) is a field here with the spec's
 * default, so a change of mind is a config change, not a code change. Decisions marked "pending approval" in spec §24 default
 * to the original spec. [D14] is not a field: Moshe closed it on 2026-10-15 (a mistake costs the missed points,
 * §6.5) and asked for no option to bring the old ladder back.
 *
 * Configs stored or sent before a field existed lack it. The engine reads the [D42] fields as `?? 0` / falsy,
 * so an older game (or an older server's snapshot) keeps the behaviour it was played with: no soft phase and
 * no offline moves.
 */

export const GAME_MODES = ['solo', 'bot', 'ranked'] as const;
/** Solo practice, practice against a bot, or ranked (2–4 players) (spec §5.1). */
export type GameMode = (typeof GAME_MODES)[number];

export type TurnModel = 'simultaneous' | 'turns';

/**
 * Every interference kind this engine knows (spec §7.1), in the order of the picker and of unlocking [D17]:
 * the three of V1, then the three Moshe asked for on 2026-10-17 [D47]: `scramble` (the board's digits roll),
 * `ink` (blots that fade) and `keypad` (the digit keys swap places). Every kind lasts `interferenceMs` and
 * costs the same 2^n by order of use, not by kind [D10]. Which kinds a player has unlocked is client-side
 * config (§15); the engine only checks a kind against the game's `rules.interferenceKinds`.
 */
export const INTERFERENCE_KINDS = ['fireworks', 'cats', 'warp', 'scramble', 'ink', 'keypad'] as const;
export type InterferenceKind = (typeof INTERFERENCE_KINDS)[number];

/**
 * The kinds an app that declares none can show: app 1.0.0 knows only these three and crashes on any other.
 * A ranked room allows only the kinds every player's app declared, and an app that declared nothing counts
 * as this list [D47].
 */
export const LEGACY_INTERFERENCE_KINDS: readonly InterferenceKind[] = ['fireworks', 'cats', 'warp'];

/** Whether a value (a wire string, say) names a kind this engine knows. */
export const isInterferenceKind = (v: unknown): v is InterferenceKind =>
  typeof v === 'string' && (INTERFERENCE_KINDS as readonly string[]).includes(v);

/**
 * Where interferences are part of the game by default (spec §7.2) [D44]: only in ranked games. Not in solo
 * practice, and not in a game where the player knows the opponent is a bot (Moshe, 2026-10-17: hitting a bot
 * is pointless, and a bot hitting back only loses points), so the bot never interferes either. That replaces
 * the original §20 ("use interferences") and the §10 interference button in games against a bot. A stored
 * config keeps its own value, so the replay of an older bot game still shows the hits it had. A rules
 * override can still turn them on (tests, the fake client).
 */
export const INTERFERENCES_BY_MODE: Readonly<Record<GameMode, boolean>> = {
  solo: false,
  bot: false,
  ranked: true,
};

/** The six base reactions (spec §8). */
export const REACTIONS = ['😂', '😱', '😎', '🤦', '🔥', '👀'] as const;

/** Why a lock ended without a correct digit. */
export type ReleaseReason =
  'cancel' | 'timeout' | 'switch' | 'mistake' | 'surrender' | 'disconnect' | 'abandon';

/** Think time per game type (spec §5.2) [D2]. */
export const THINK_TIME_MS: Record<GameType, number> = { fast: 8000, normal: 12000, hard: 18000 };

/**
 * Rating rules (spec §11.2): Elo [D31], the starting point [D23], abandonment [D8, D32], the keys [D7], and the
 * leave guards (Moshe, 2026-10-15). A surrender or an abandonment is a normal loss and a full win for whoever
 * stays [D32, D8], except in a pair the guards hold. Each pair with a leaver is judged at the moment the first
 * of the two left, by everyone's score and moves (digit entries, right or wrong) at that moment:
 * (a) the leaver loses nothing to an opponent who was not ahead of him, or if he had not placed a digit yet;
 * (b) the one who stays gains nothing from the leaver if he had not placed a digit yet himself, or if the
 * leaver was ahead of him. Both guards off is the old [D32] rule. Configs stored before these fields lack
 * them, which reads as off; results are never recomputed from them.
 */
export interface RatingRules extends EloOptions {
  /** B: one rating per game type; A: per game type and player count [D7]. */
  option: RatingOption;
  /** [D23] */
  initialRating: number;
  /**
   * The [D32] alternative: extra rating points an abandoning player loses on top of the Elo result. Waived
   * when guard (a) holds against every opponent who was still in the game when he left.
   */
  abandonPenalty: number;
  /** Guard (a) [D32, Moshe 2026-10-15]: no rating lost by a leaver who was not behind, or had not moved. */
  leaverGuard: boolean;
  /** Guard (b) [D32, D8, Moshe 2026-10-15]: no rating gained from a leaver who was ahead, or before my move. */
  stayerGuard: boolean;
  /**
   * When an abandonment is judged: at the disconnect it followed (whoever led when the connection fell is
   * not judged by what the others did while he was away), or at the end of the grace period.
   */
  abandonJudgedAt: 'disconnect' | 'graceEnd';
}

export const DEFAULT_RATING_RULES: RatingRules = {
  ...DEFAULT_ELO,
  option: 'B',
  initialRating: INITIAL_RATING,
  abandonPenalty: 0,
  leaverGuard: true,
  stayerGuard: true,
  abandonJudgedAt: 'disconnect',
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
  /**
   * How Y of the score is picked: second after sorting, or second distinct value [D13]. It also prices a
   * mistake: a wrong digit always costs what the right one would have scored there at that moment (§6.5,
   * `missedPoints`). That is Moshe's decision of 2026-10-15, closed with no rule to switch it: the original
   * §13 ladder 1, 2, 4, 8 … and its [D14] cap are gone.
   */
  scoreY: ScoreY;
  /** Scores may go below zero [D15]. */
  negativeScore: boolean;
  /** Equal scores: fewer mistakes ranks higher, or whoever made their last correct move earlier [D16]. */
  tieBreak: 'fewerMistakes' | 'earlierLastMove';
  /** 3–4 players: whoever surrenders ranks by the order of leaving, or stays in the table by score [D36]. */
  surrenderRanking: 'exitOrder' | 'byScore';

  /**
   * Interferences are part of ranked games only: not of solo practice, and not of a game against a bot the
   * player knows is a bot (spec §7.2) [D44]. Default: `INTERFERENCES_BY_MODE`.
   */
  interferences: boolean;
  /**
   * The kinds this game allows: all of `INTERFERENCE_KINDS` by default; a ranked room narrows it to the kinds
   * every player's app can show [D47]. Empty means nothing can be sent (the view then offers no panel).
   */
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

  /**
   * How long a disconnected player has to come back (spec §16.2) [D4]. After a lost connection it starts when
   * the soft phase ends (softGraceMs), so abandonment comes softGraceMs + graceMs after the drop.
   */
  graceMs: number;
  /**
   * A game freezes while someone is disconnected if at most this many players are still in it (2 → a
   * two-player game freezes, a game of 3–4 goes on) [D4].
   */
  freezeUpToPlayers: number;
  /**
   * The soft phase of a lost connection [D42] (Moshe, 2026-10-15): for this long the player is only marked as
   * without a connection. The game goes on as usual for everyone (no freeze, no release, every timer runs, no
   * connection messages), and his phone lets him play on (spec §16.2). Then the grace of [D4] starts. Only a
   * connection that drops gets it; a deliberate leave is hard at once. 0 = off: every drop is hard at once.
   */
  softGraceMs: number;
  /**
   * [D42] How many moves made offline a returning player may send (`offlineMove`); each is decided when it
   * arrives: lost with no penalty if the cell is no longer free for him. 0 = none.
   */
  offlineMovesMax: number;
  /** [D42] For how long after the return they are accepted (they are sent at once: this covers the round trip). */
  offlineMovesWindowMs: number;
  /**
   * [D42] Interferences may be sent at a player in the soft phase. Off by default, as at a disconnected player
   * (§7.2): nobody pays points for a hit the target can't see.
   */
  interfereSoftOffline: boolean;

  rating: RatingRules;

  // -------------------------------------------------------------------------------------------------------
  // Staged practice (app 1.0.2; dev-plan §2א). Every key is optional and absent from defaultRules: only a
  // level's rules (levels/spec.ts levelRulesFor) bring them in, so ranked, solo and bot games, their snapshots
  // and their stored rules stay exactly as they were. createGame checks them (RangeError).

  /**
   * The game ends 'timeUp' this long after its start (a level: at most 30 s), earlier by every time penalty
   * (timePenalty) and later by every freeze. The timer comes before every other one at the same instant, so an
   * action at the deadline itself is too late ('gameOver').
   */
  timeLimitMs?: number;
  /** The first player to this score ends the game 'targetReached' (duel, 30 points). */
  endAtScore?: number;
  /** Only these empty cells can be chosen ('notEditable' for the others); all filled ends 'targetReached' (fillBox). */
  editableCells?: readonly CellIndex[];
  /** Each player who is not a bot has this many digit entries, right or wrong; all used ends 'targetReached' (pointHunter). */
  maxMoves?: number;
  /**
   * A chain: these cells, in the order they become knowable; all filled ends 'targetReached'. One player only.
   * A wrong digit anywhere is a mistake; a right one in any cell but the next is decided by `chainNotYet`.
   */
  chainCells?: readonly CellIndex[];
  /**
   * [D64] (waiting for Moshe, who tries both first, 2026-10-18; built per the original §14): 'accept' (the
   * default) takes it as any right digit, with its points; only chain cells advance the chain. 'penalty' (the
   * proposal) costs mistakeTimeMs and places nothing: no mistake is recorded, the digit stays on the keypad, the
   * lock stays.
   */
  chainNotYet?: 'accept' | 'penalty';
  /** False: a lock has no timer (expiresAt null) and never runs out; needs interferences off (no opponent). */
  lockTimeout?: false;
  /** A wrong digit also costs this much time (timePenalty): fillBox and chain, 5 s. One player only. */
  mistakeTimeMs?: number;
  /** Reserved for idea 4 ("no mistakes", plan §3.1), not built: createGame refuses it. */
  maxMistakes?: number;
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
    negativeScore: true,
    tieBreak: 'fewerMistakes',
    surrenderRanking: 'exitOrder',
    interferences: INTERFERENCES_BY_MODE[mode],
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
    softGraceMs: 10000,
    offlineMovesMax: 8,
    offlineMovesWindowMs: 5000,
    interfereSoftOffline: false,
    rating: DEFAULT_RATING_RULES,
    ...overrides,
  };
}
