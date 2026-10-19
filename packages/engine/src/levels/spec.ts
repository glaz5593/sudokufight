import { type BotLevelId, botPlayer } from '../bot/levels';
import { defaultRules, type GameMode, type Rules } from '../game/rules';
import type { GameConfig, PlayerId, PlayerInfo } from '../game/types';
import type { GameType } from '../gameType';
import type { CellIndex, Digit } from '../sudoku/board';
import type { Technique } from '../sudoku/logic';
import { seedFromString } from '../util/random';
import { LEVEL_RULES, type LevelRules } from './progress';

/**
 * Staged practice ("אימון בשלבים", app 1.0.2; plan.md, dev-plan.md §2א): what a level is, as the frozen data
 * file levels.json holds it, and every type the level code shares. The tap engine (find.ts), the solver's
 * targets (sudoku/targets.ts), the builder (levels/builder/) and the app import these types and never declare
 * their own.
 *
 * A level is short (at most LEVEL_RULES.levelMaxMs, 30 s), has one task and no interferences at all [D49]. The
 * digit kinds (fillBox, duel, pointHunter, chain) run in the game engine as a 'solo' or 'bot' game with
 * `config.level` set and the rules of levelRulesFor(); the tap kinds (find, findDuel, spotError) run in the tap
 * engine (LocalFindHost). Both go through the GameHost interface, and levelOutcome() (progress.ts) reads the
 * end of either.
 */

/** The seven kinds (plan §2, §3): the four Moshe defined, and the three ideas of V1 [D54]. */
export const LEVEL_KINDS = [
  'find',
  'findDuel',
  'fillBox',
  'duel',
  'spotError',
  'pointHunter',
  'chain',
] as const;
export type LevelKind = (typeof LEVEL_KINDS)[number];

export const isLevelKind = (v: unknown): v is LevelKind => LEVEL_KINDS.includes(v as LevelKind);

/** The kinds played by tapping cells, with no keypad and no lock (LocalFindHost). */
export const TAP_LEVEL_KINDS: readonly LevelKind[] = ['find', 'findDuel', 'spotError'];

export const isTapKind = (kind: LevelKind): boolean => TAP_LEVEL_KINDS.includes(kind);

/**
 * A wrong digit (fillBox, chain), a digit that cannot be known yet (chain, D64) and a wrong tap (find,
 * spotError) cost this much time (plan §2.1, §2.3, §3.1).
 */
export const LEVEL_PENALTY_MS = 5000;

export type Stars = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------------------------------------
// Star rules (plan §2, §3.1, §4.4) [D52]. starsFor() in stars.ts applies them.

/** By the level clock (time played plus the time penalties): ★★★ up to `three` ms, ★★ up to `two`, ★ up to `one`, all inclusive (5.000 s is still ★★★, 5.01 s is ★★). Unfinished: 0. */
export interface TimeStars {
  by: 'timeMs';
  three: number;
  two: number;
  one: number;
}

/** findDuel: the spots I took, at least `three` / `two` / `one` (of 5: 4–5, 3, 2). */
export interface SpotStars {
  by: 'spots';
  three: number;
  two: number;
  one: number;
}

/** duel: my lead at the end, at least `three` / `two`, or any lead (> 0). A tie, the bot ahead, or the bot first to the target: 0. */
export interface GapStars {
  by: 'gap';
  three: number;
  two: number;
}

/** pointHunter: my points, at least each threshold (pointThresholds of `max`, the best the board allows). */
export interface PointStars {
  by: 'points';
  max: number;
  three: number;
  two: number;
  one: number;
}

export type StarRule = TimeStars | SpotStars | GapStars | PointStars;

// ---------------------------------------------------------------------------------------------------------
// Targets

/** Where a find target lies: a box, row or column (index 0–8), or the whole board (plan §2.1). */
export type FindScope = { kind: 'box' | 'row' | 'col'; index: number } | { kind: 'board' };

/**
 * How hard a target is (sudoku/targets.ts): a single in its scope, one only after an elimination (pointing,
 * claiming, a naked or hidden pair), or one known only after one other cell is filled ('chain2', act 6 of plan
 * §4.3). The bot's search time is ×1.3 for every tier but 'single' (plan §2.2).
 */
export const TARGET_TIERS = ['single', 'pointing', 'claiming', 'nakedPair', 'hiddenPair', 'chain2'] as const;
export type TargetTier = (typeof TARGET_TIERS)[number];

/** "Where must the 7 go?": a digit and a scope (find, and each spot of findDuel). */
export interface FindTarget {
  digit: Digit;
  scope: FindScope;
  /** The one cell where the digit must go in the scope; null for scope 'board' (any cell of `accept`). */
  cell: CellIndex | null;
  /**
   * The cells a tap is right on: [cell] in a box, row or column; with scope 'board' every empty cell whose
   * answer is the digit (plan §2.1).
   */
  accept: readonly CellIndex[];
  tier: TargetTier;
}

/** spotError: a wrong digit planted among "my" digits (board.mine). */
export interface PlantedError {
  cell: CellIndex;
  /** The wrong digit shown; the right one is the solution's. */
  digit: Digit;
  /** Clashes with a given in its row, column or box (a visible error), or only with the logic (a silent one). */
  visible: boolean;
}

/** One move of the best line of a pointHunter board (the full search of the builder). */
export interface BestLineMove {
  cell: CellIndex;
  digit: Digit;
  points: number;
}

/** What each kind's task is made of. */
export interface LevelTargetMap {
  find: { target: FindTarget };
  /** The spots, in the order they are shown (5, plan §2.2) [D53]. */
  findDuel: { spots: readonly FindTarget[] };
  /** The box (0–8) and its missing cells: the only cells that can be chosen (plan §2.3). */
  fillBox: { box: number; cells: readonly CellIndex[] };
  /** The first to this many points wins (30, plan §2.4). */
  duel: { endAtScore: number };
  spotError: { errors: readonly PlantedError[] };
  /** The moves allowed (3), and the best line of the board (its points add up to stars.max). */
  pointHunter: { maxMoves: number; best: readonly BestLineMove[] };
  /** The chain's cells, in the order they become knowable (plan Idea-3). */
  chain: { cells: readonly CellIndex[] };
}

// ---------------------------------------------------------------------------------------------------------
// A level

/**
 * The bot of findDuel and duel (plan §2.2, §2.4, §4.2) [D61]. `pace` is final: a boss's ×0.9 is already in
 * it. `findMs` ([min, max] for each findDuel spot) and `missShare` are frozen at build time, so a later change
 * of BOT_CONFIG never alters a built level.
 */
export interface LevelBot {
  level: BotLevelId;
  pace: number;
  findMs?: readonly (readonly [min: number, max: number])[];
  missShare?: number;
  /** findDuel: the share of spots on which the bot reacts to my wrong tap (frozen like missShare). */
  reactShare?: number;
}

export interface LevelBoard {
  /** The givens, 81 characters, 0 = empty. */
  grid: string;
  solution: string;
  /** spotError: "my" digits around the givens (81 characters, 0 = none), the planted errors among them. */
  mine?: string;
}

/** What the builder checked a level against; kept in the engine's levels.json, never shipped in the app. */
export interface LevelCheck {
  /** The techniques of the chapter and kind. */
  techniques: readonly Technique[];
  /** What the level must need (the new technique of its act); empty when the act adds none. */
  mustNeed: readonly Technique[];
}

interface LevelSpecBase {
  /** L001 … L300 (levelIdOf). */
  id: string;
  /** 1, and one more each time the level is rebuilt on purpose; its stars are kept (mergeBest). */
  rev: number;
  /** 1–30. */
  chapter: number;
  /** 1–10 in the chapter; 10 is the boss. */
  slot: number;
  /** The tenth level of a chapter (plan §3.3): its kind is the challenge's (fillBox, findDuel or duel). */
  boss: boolean;
  /** The builder's seed (from `${id}:r${rev}`), and the base of the bot's draws (with the attempt). */
  seed: number;
  /** The board's type: the lock time of a duel comes with it (spec §5.2) [D43]. */
  gameType: GameType;
  board: LevelBoard;
  /** At most LEVEL_RULES.levelMaxMs. */
  timeLimitMs: number;
  stars: StarRule;
  bot?: LevelBot;
  /** pointHunter, the first two of the kind: the view says what my locked cell is worth (selectedWorth). */
  worthHint?: boolean;
  check?: LevelCheck;
}

/** A level as levels.json holds it, its targets typed by its kind. */
export type LevelSpec = {
  [K in LevelKind]: LevelSpecBase & { kind: K; targets: LevelTargetMap[K] };
}[LevelKind];

export type LevelSpecOf<K extends LevelKind> = Extract<LevelSpec, { kind: K }>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The part of a level the app ships and plays (apps/mobile/src/levels/data/levels.json): no build checks. */
export type AppLevel = DistributiveOmit<LevelSpec, 'check'>;

// ---------------------------------------------------------------------------------------------------------
// A level being played

/** GameConfig.level: the game is this level's attempt (a digit kind, in the game engine). */
export interface LevelRun {
  id: string;
  rev: number;
  kind: LevelKind;
  boss?: boolean;
  /** 1 for the first attempt; from 2 on the board is an equivalent one (transformLevel) [D63]. */
  attempt: number;
  stars: StarRule;
  /** The view gives selectedWorth (pointHunter, the first two of the kind). */
  worthHint?: boolean;
}

/** GameResult.level: how a level game ended, for the result screen and levelOutcome(). */
export interface LevelResult {
  stars: Stars;
  /** In the unit of the level's metric (LEVEL_METRIC): the level clock, my lead, or my points. */
  metric: number;
  /** The level clock at the end: the time played (no freeze) plus the time penalties. */
  elapsedMs: number;
  penaltyMs: number;
}

/** How far the task is (GameView.level.progress); a chain says how many steps, never which cell is next. */
export type LevelProgressView =
  | { kind: 'cells'; done: number; total: number }
  | { kind: 'chain'; done: number; total: number }
  | { kind: 'moves'; used: number; max: number; score: number }
  | { kind: 'score'; mine: number; opponent: number | null; target: number };

/** GameView.level: present only in a level, by either host. */
export interface LevelView {
  id: string;
  rev: number;
  kind: LevelKind;
  boss: boolean;
  attempt: number;
  /** The level clock: the time played plus the time penalties; it stands still while frozen and at the end. */
  elapsedMs: number;
  /** The time limit, or null. */
  limitMs: number | null;
  /** When the time runs out, in the clock the game runs on; null while it stands still (or without a limit). */
  endsAt: number | null;
  /** The time left; what to show while it stands still. Null without a limit. */
  remainingMs: number | null;
  /** My time penalties so far. */
  penaltyMs: number;
  /** The star rule: the bar's marks. */
  marks: StarRule;
  /** Stars if the level ended well now (provisional), or as it ended (`final`). */
  stars: Stars;
  final: boolean;
  /** fillBox: the cells that can be chosen; null when any empty cell can. */
  editableCells: readonly CellIndex[] | null;
  progress: LevelProgressView | null;
  /** False when locks have no timer (rules.lockTimeout false): the board shows no countdown on my cell. */
  lockTimer: boolean;
  /** What the right digit in my locked cell scores now (§6.4), only with LevelRun.worthHint and a lock. */
  selectedWorth?: number;
  /** The tap kinds (LocalFindHost). */
  find?: LevelFindView;
}

// ---------------------------------------------------------------------------------------------------------
// The tap engine (find.ts, findHost.ts): its view and its events

export type FindEndReason = 'targetReached' | 'timeUp' | 'tooManyMisses' | 'quit';

/** How a tap level ended (the levelOver event): levelOutcome() reads it. */
export interface FindLevelOver {
  reason: FindEndReason;
  /** The level clock at the end: the time played plus the time penalties. */
  elapsedMs: number;
  penaltyMs: number;
  /** findDuel: the spots I took; find: 1 when found. */
  spots: number;
  /** spotError: the planted errors found. */
  found: number;
  stars: Stars;
}

/** findDuel: one spot as the view shows it. */
export type LevelSpotView =
  /** Not shown yet. */
  | { state: 'waiting' }
  /** The current one, nobody's yet. */
  | { state: 'open' }
  | { state: 'won'; playerId: PlayerId; cell: CellIndex }
  /** Nobody took it: time ran out on it, or both players were out of it. */
  | { state: 'void' };

/** What the tap engine's view adds (GameView.level.find). */
export interface LevelFindView {
  /** The target now: find's one, findDuel's current spot; null in spotError. */
  digit: Digit | null;
  scope: FindScope | null;
  /** findDuel: the current spot, 0-based. */
  spotIndex: number;
  /** findDuel: each spot, in order. */
  spots: readonly LevelSpotView[];
  /** My taps are refused ('frozen') until then, after a wrong one (findDuel, 3 s). */
  frozenUntil: number | null;
  wrongTaps: number;
  /** spotError: the errors found so far. */
  found: readonly CellIndex[];
  /** After the end: where the target was (find), the errors not found (spotError). */
  answer?: readonly CellIndex[];
  /** findDuel: I am out of the current spot (a second wrong tap on it) until the next one is shown. */
  out?: boolean;
  /** After the end: how it ended (the levelOver event), for levelOutcome(). */
  over?: FindLevelOver;
}

/** findDuel: the bot's plan for one spot, drawn when the level is created (within LevelBot.findMs). */
export interface BotSpotPlan {
  /**
   * Ms after the spot is shown that the bot taps the right cell: its search time, within LevelBot.findMs; a
   * miss before it costs FindRules.freezeMs more (plan §2.2).
   */
  tapAtMs: number;
  /** A wrong tap first (LevelBot.missShare): when, and where; it freezes the bot for 3 s. */
  miss: { atMs: number; cell: CellIndex } | null;
  /** The bot reacts (😂) to my wrong tap on this spot. */
  react: boolean;
}

/** The rules a tap level is played by, as they were when it was created (levels/find.ts). */
export interface FindRules {
  /** find, spotError: a wrong tap costs this much time (LEVEL_PENALTY_MS). */
  penaltyMs: number;
  /** findDuel: a wrong tap keeps the tapper out this long, the bot too (BOT_CONFIG.find.wrongFreezeMs). */
  freezeMs: number;
  /** A tap on a filled cell: nothing happens, or it counts as a wrong tap (LEVEL_RULES.tapOnFilled) [D52]. */
  tapOnFilled: 'ignore' | 'penalty';
  /** The reactions I may send: none by default [D62] (LEVEL_UI.reactions brings them back). */
  reactions: readonly string[];
  /** findDuel: the bot's reaction to my wrong tap (its level's, spec §9), and how long after it comes. */
  botReaction: string | null;
  reactAfterMs: number;
}

/** A tap level as created: everything replayFind needs, the bot's plan included (no RNG on replay). */
export interface FindConfig {
  id: string;
  level: LevelRun;
  /** The level as played: transformLevel(spec, attempt) from the second attempt on [D63]. */
  spec: AppLevel;
  /** Me first; the bot second in findDuel. */
  players: PlayerInfo[];
  botPlan: readonly BotSpotPlan[] | null;
  rules: FindRules;
}

type LevelEventBody =
  | { type: 'levelCreated'; config: FindConfig }
  | { type: 'levelStarted' }
  /** A target is shown (find: the one; findDuel: spot `index`), and when the bot will tap it (null: never). */
  | { type: 'targetShown'; index: number; botTapAt: number | null }
  | {
      type: 'tapped';
      playerId: PlayerId;
      cell: CellIndex;
      right: boolean;
      /** A wrong tap's time penalty (find, spotError). */
      penaltyMs?: number;
      /** A wrong tap's freeze (findDuel). */
      frozenUntil?: number;
    }
  | { type: 'spotWon'; index: number; playerId: PlayerId; cell: CellIndex }
  | { type: 'spotVoid'; index: number }
  /** The bot's reaction (D62: the player has no reactions button in a level; the bot still reacts). */
  | { type: 'reacted'; playerId: PlayerId; emoji: string }
  /** D65: the app left the foreground; everything stands still. */
  | { type: 'levelPaused' }
  /** Every deadline (the limit, freezes, the bot's plan) moves on by `pausedMs`. */
  | { type: 'levelResumed'; pausedMs: number }
  | ({ type: 'levelOver' } & FindLevelOver);

export type LevelEvent = LevelEventBody & { seq: number; t: number };
export type LevelEventType = LevelEvent['type'];
/** The body of a level event before it gets its seq and time. */
export type NewLevelEvent = LevelEventBody;

// ---------------------------------------------------------------------------------------------------------
// The rules of a digit level

/**
 * The game rules of each digit kind, the only place these choices live (plan §2.3, §2.4, §3.1, dev-plan §2א):
 * - fillBox: only the box's missing cells; a wrong digit costs 5 s; no lock timer (no opponent), and after a
 *   mistake the lock stays, with no wait to lock again.
 * - duel: first to `endAtScore` within the time limit, and otherwise the game as it is (locks, scores, §6.5).
 * - pointHunter: 3 moves, no lock timer, the lock kept after a mistake.
 * - chain: only the chain's order counts (chainNotYet, D64), a wrong digit costs 5 s, as fillBox's locks.
 * The tap kinds read their spec in the tap engine: only the limit here. No kind has an interference key: a
 * level's mode ('solo' or 'bot') has none [D44, D49].
 */
export function levelRulesFor(spec: AppLevel, rules: LevelRules = LEVEL_RULES): Partial<Rules> {
  const noOpponentLocks = {
    lockTimeout: false,
    afterMistake: 'keepLock',
    relockCooldownMs: 0,
  } as const satisfies Partial<Rules>;
  switch (spec.kind) {
    case 'fillBox':
      return {
        editableCells: spec.targets.cells,
        timeLimitMs: spec.timeLimitMs,
        mistakeTimeMs: LEVEL_PENALTY_MS,
        ...noOpponentLocks,
      };
    case 'duel':
      return { endAtScore: spec.targets.endAtScore, timeLimitMs: spec.timeLimitMs };
    case 'pointHunter':
      return { maxMoves: spec.targets.maxMoves, timeLimitMs: spec.timeLimitMs, ...noOpponentLocks };
    case 'chain':
      return {
        chainCells: spec.targets.cells,
        chainNotYet: rules.chainNotYet,
        mistakeTimeMs: LEVEL_PENALTY_MS,
        timeLimitMs: spec.timeLimitMs,
        ...noOpponentLocks,
      };
    case 'find':
    case 'findDuel':
    case 'spotError':
      return { timeLimitMs: spec.timeLimitMs };
  }
}

/** The engine mode a level runs in: against the bot (findDuel, duel, and their bosses) or alone. */
export const levelModeFor = (spec: Pick<AppLevel, 'kind'>): Extract<GameMode, 'solo' | 'bot'> =>
  spec.kind === 'findDuel' || spec.kind === 'duel' ? 'bot' : 'solo';

/** GameConfig.level of an attempt. */
export function levelRunOf(spec: AppLevel, attempt: number): LevelRun {
  return {
    id: spec.id,
    rev: spec.rev,
    kind: spec.kind,
    ...(spec.boss ? { boss: true } : null),
    attempt,
    stars: spec.stars,
    ...(spec.worthHint ? { worthHint: true } : null),
  };
}

export interface LevelGameOptions {
  /** The game's id (the session's). */
  id: string;
  /** The player on this phone. */
  player: PlayerInfo;
  /** The opponent of a 'bot' level; by default botPlayer(spec.bot.level). */
  bot?: PlayerInfo;
  attempt: number;
  rules?: LevelRules;
}

/**
 * The game of a digit level's attempt (LocalGameHost): its mode, players, board, rules and `level`. `spec` is
 * the level as played: attemptLevel() of the stored one. The seed (the bot's draws) comes from the level and
 * the attempt, so the first attempt always meets the same bot and "שוב" draws again.
 */
export function levelGameConfig(spec: AppLevel, o: LevelGameOptions): GameConfig {
  if (isTapKind(spec.kind)) throw new RangeError(`A ${spec.kind} level is played by the tap engine`);
  if (!(Number.isInteger(o.attempt) && o.attempt >= 1)) throw new RangeError('An attempt is 1 or more');
  const mode = levelModeFor(spec);
  let players = [o.player];
  if (mode === 'bot') {
    const bot = o.bot ?? (spec.bot ? botPlayer(spec.bot.level) : null);
    if (!bot) throw new RangeError(`Level ${spec.id} has no bot`);
    players = [o.player, { ...bot, isBot: true }];
  }
  return {
    id: o.id,
    mode,
    gameType: spec.gameType,
    puzzle: {
      id: `${spec.id}:r${spec.rev}:a${o.attempt}`,
      givens: spec.board.grid,
      solution: spec.board.solution,
    },
    players,
    rules: defaultRules(mode, spec.gameType, levelRulesFor(spec, o.rules)),
    seed: seedFromString(`${spec.id}:r${spec.rev}:a${o.attempt}`, spec.seed),
    level: levelRunOf(spec, o.attempt),
  };
}
