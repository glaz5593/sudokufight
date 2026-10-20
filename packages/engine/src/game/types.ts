import type { GameType } from '../gameType';
import type { LevelResult, LevelRun } from '../levels/spec';
import type { RatingChange, RatingPairs } from '../rating';
import type { CellIndex, Digit } from '../sudoku/board';
import type { MoveScore } from '../sudoku/scoring';
import type { GameMode, InterferenceKind, ReleaseReason, Rules } from './rules';

export type PlayerId = string;

// ---------------------------------------------------------------------------------------------------------
// Configuration

export interface PlayerInfo {
  id: PlayerId;
  name?: string;
  isBot?: boolean;
  /** Ranked games: the rating in this game's rating key before the game, and how many games it has seen. */
  rating?: number;
  ratedGames?: number;
}

export interface GameConfig {
  id: string;
  mode: GameMode;
  gameType: GameType;
  puzzle: { id: string; givens: string; solution: string };
  /** In seat order: seat 0 first. */
  players: PlayerInfo[];
  rules: Rules;
  /**
   * Seed for whatever in this game needs chance (bots, stage 5), so a game can be replayed exactly (spec §6).
   * createGame draws one from the injected RNG when it is missing.
   */
  seed?: number;
  /**
   * A level of staged practice (1.0.2): which one, which attempt, its star rule. Absent from every other game,
   * so their configs keep their shape. The rules come with it (levelRulesFor).
   */
  level?: LevelRun;
}

// ---------------------------------------------------------------------------------------------------------
// State

export type PlayerStatus = 'active' | 'surrendered' | 'abandoned';

/**
 * One player's [score, moves] at the moment a leaving is judged (spec §11.2, the leave guards): moves = correct
 * + mistakes, digit entries only. A tuple, to keep the 4-player snapshot within its budget (spec §18).
 */
export type LeaveStanding = readonly [score: number, moves: number];

export interface BestMove {
  cell: CellIndex;
  digit: Digit;
  points: number;
  breakdown: MoveScore;
}

export interface PlayerState {
  id: PlayerId;
  seat: number;
  status: PlayerStatus;
  /** False from the hard phase of a lost connection on (spec §16.2); still true in the soft phase [D42]. */
  connected: boolean;
  /** Set while disconnected (spec §16.2). */
  graceEndsAt: number | null;
  /**
   * The soft phase of a lost connection [D42]: the player is only marked, the game goes on as usual, and at this
   * time the hard phase starts (playerDisconnected, graceEndsAt = softEndsAt + graceMs). Absent otherwise, and in
   * older snapshots: the key is left out, not set to null, for the snapshot budget (spec §18). isSoftOffline().
   */
  softEndsAt?: number;
  /**
   * After a return [D42]: moves made offline (`offlineMove`) are taken until `until` (inclusive), `left` more at
   * most. Absent when none are (the key is left out, as above). A new loss of the connection ends it. It stands
   * still while the game is frozen (no move is taken then): gameResumed moves `until` on, so a return during a
   * freeze has its whole window from the resume.
   */
  offlineWindow?: { until: number; left: number };
  /** 1 for the first player out (surrendered or abandoned), 2 for the next … */
  outOrder: number | null;
  /**
   * By seat: everyone's [score, moves] at the moment this player's leaving is judged (spec §11.2): taken at a
   * surrender, and at the connection loss (kept through the grace, cleared on reconnect) for an abandonment
   * (rules.rating.abandonJudgedAt). Absent while in the game and connected (and in older snapshots): the key
   * itself is left out, not set to null, because a 4-player snapshot is close to its 4 KB budget (spec §18).
   */
  leaveStandings?: LeaveStanding[];

  score: number;
  mistakes: number;
  /** The penalty of each of this player's mistakes, oldest first (§6.5); length = mistakes. */
  mistakePenalties: number[];
  correct: number;
  /** Sum of the points of correct moves, before penalties and interference costs. */
  pointsGained: number;
  interferencesSent: number;
  bestMove: BestMove | null;
  /** Sum of think times of correct moves (lock to digit, timers stopped excluded). */
  thinkMsTotal: number;
  /** When this player last placed a correct digit. */
  lastCorrectAt: number | null;
  /** The largest gap so far between the best opponent's score and this player's (for "Comeback"). */
  maxDeficit: number;

  /** Interference on this player, if any. */
  hitBy: { fromId: PlayerId; kind: InterferenceKind; endsAt: number } | null;
  /** No new interference before this time [D11]. */
  immuneUntil: number;
  lastReactionAt: number | null;
  /**
   * The time penalties so far (timePenalty: rules.mistakeTimeMs, a chain's "not yet" [D64]). Absent until the
   * first one: the key is left out, as above.
   */
  timePenaltyMs?: number;
}

export interface Lock {
  playerId: PlayerId;
  cell: CellIndex;
  lockedAt: number;
  /** Null while the timer is stopped because the holder is under interference [D11]. */
  expiresAt: number | null;
  /** Time left; meaningful while stopped. */
  remainingMs: number;
}

/** A lock's timer as events carry it (spec §18 `locks[]`). */
export interface LockTimer {
  playerId: PlayerId;
  cell: CellIndex;
  /** When it runs out; null while it is stopped. */
  expiresAt: number | null;
  remainingMs: number;
}

/** 'turns' model [D1]: whose turn it is and when it runs out. */
export interface Turn {
  playerId: PlayerId;
  /** null while the holder has a lock (the lock's timer counts instead) or while the turn timer is stopped. */
  endsAt: number | null;
  /** Time left while the turn timer is stopped by an interference [D11]; null otherwise. */
  stoppedMs: number | null;
}

export interface GameState {
  config: GameConfig;
  status: 'waiting' | 'running' | 'paused' | 'over';
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  pausedAt: number | null;
  /** seq of the last event. */
  seq: number;
  /** Time of the last event; the engine never lets time run backwards past it. */
  lastEventAt: number;

  /** Givens and correctly solved cells; 0 = empty. Wrong digits are never here. */
  grid: number[];
  givens: boolean[];
  /** Seat of whoever solved each cell; null for givens and empty cells. */
  owner: (number | null)[];
  /** Wrong digits tried in each cell, in order (spec §6.5). */
  wrong: { digit: Digit; playerId: PlayerId }[][];

  locks: Lock[];
  /** No re-lock of `cell` by `playerId` before `until` [D2]. */
  cooldowns: { playerId: PlayerId; cell: CellIndex; until: number }[];
  /** 'turns' model only. */
  turn: Turn | null;

  players: PlayerState[];
  result: GameResult | null;
  /**
   * When rules.timeLimitMs runs out: startedAt + timeLimitMs, sooner by every time penalty, later by every
   * freeze (gameResumed), and kept at the end for the level clock. Absent without a limit: the key is left out,
   * so other games' snapshots keep their shape.
   */
  timeUpAt?: number;
  /** The freeze is the app's own: it left the foreground mid-level [D65]. Absent otherwise. */
  pausedBy?: 'background';
  /**
   * [D65] The phone's own freezes that ended (gameResumed 'foreground'), in all: the game's clock leaves them
   * out (played.ts: the duration, a stage's clock, the replay's times). Absent until one ended, so every other
   * game's snapshot keeps its shape.
   */
  frozenMs?: number;
}

// ---------------------------------------------------------------------------------------------------------
// Actions

/**
 * What a player can do (spec §18, client → server). De-duplication by clientSeq and rate limits are the
 * server's job (spec §21); the engine sees each action once.
 *
 * `offlineMove` [D42]: a digit the player entered on his phone while his connection was lost, sent when he is
 * back (within rules.offlineMovesWindowMs of playerReconnected, at most rules.offlineMovesMax). It is decided
 * now, on the board as it is now: if the cell is still free for him it is locked (if he does not hold it) and
 * placed like any digit, with `offline: true` and his own think time clamped to [0, thinkTimeMs]; otherwise it is
 * refused with no penalty (cellFilled, cellTaken, digitTried, digitComplete): he lost the cell.
 */
export type PlayerAction = { playerId: PlayerId } & (
  | { type: 'select'; cell: CellIndex }
  | { type: 'release' }
  | { type: 'place'; cell: CellIndex; digit: Digit }
  | { type: 'interfere'; targetId: PlayerId; kind: InterferenceKind }
  | { type: 'react'; emoji: string }
  | { type: 'surrender' }
  | { type: 'offlineMove'; cell: CellIndex; digit: Digit; thinkMs: number }
);

/**
 * What the host does: start the game, report connections. A `disconnect` with `soft` is a connection that
 * dropped: it starts the soft phase when rules.softGraceMs > 0 [D42]. Without it (a deliberate leave, and the
 * default) the player is disconnected at once, the grace of [D4] runs, and a soft phase already running hardens.
 *
 * `pause` / `resume` [D65] (Moshe, 2026-10-18): the phone's own game froze because the app left the foreground
 * mid-level (a call, another app, the screen off), and goes on. Local play only (LocalGameHost.pause/resume):
 * a server never sends them. While frozen no timer runs (the time limit, locks, waits) and every move is
 * refused 'paused'; on resume every deadline moves on by the pause, so the time left is what it was.
 */
export type SystemAction =
  | { type: 'start' }
  | { type: 'disconnect'; playerId: PlayerId; soft?: boolean }
  | { type: 'reconnect'; playerId: PlayerId }
  | { type: 'pause' }
  | { type: 'resume' };

export type Action = PlayerAction | SystemAction;

export type RejectReason =
  /** Not an action the engine knows. */
  | 'badAction'
  | 'notStarted'
  | 'alreadyStarted'
  | 'gameOver'
  | 'paused'
  | 'unknownPlayer'
  | 'notActive'
  | 'disconnected'
  | 'badCell'
  | 'cellFilled'
  /** Locked by someone else: the UI shows "taken" (spec §6.2.3). */
  | 'cellTaken'
  | 'alreadyHeld'
  | 'cooldown'
  | 'notYourTurn'
  | 'noLock'
  | 'notLockedCell'
  | 'badDigit'
  /** Already tried wrongly in this cell [D12]. */
  | 'digitTried'
  /** All nine are on the board. */
  | 'digitComplete'
  | 'interferencesOff'
  | 'badKind'
  | 'badTarget'
  | 'targetOut'
  | 'targetDisconnected'
  /** Under interference, or in the second after one [D11]. */
  | 'targetBusy'
  | 'notEnoughPoints'
  | 'badEmoji'
  | 'tooSoon'
  | 'alreadyConnected'
  | 'alreadyDisconnected'
  /** An `offlineMove` without an open window: no return just before it, too late, or too many [D42]. */
  | 'offlineClosed'
  /** A cell outside rules.editableCells (a level's box). */
  | 'notEditable'
  /** A tap level: my taps wait out the freeze after a wrong one (findDuel, the tap engine). */
  | 'frozen'
  /** A puzzle: that box is fixed, or locked at home (lockOnCorrect), and never moves (the puzzle engine). */
  | 'boxFixed';

// ---------------------------------------------------------------------------------------------------------
// Events (spec §18, server → client). Every event has an increasing seq and the time it happened.

/** `targetReached` and `timeUp` end only a level's game (rules.endAtScore … rules.timeLimitMs). */
export type EndReason = 'boardComplete' | 'lastPlayerStanding' | 'practiceEnded' | 'targetReached' | 'timeUp';

export interface RankEntry {
  playerId: PlayerId;
  seat: number;
  /** 1-based; equal places share a number (1, 1, 3). */
  place: number;
  score: number;
  mistakes: number;
  correct: number;
  status: PlayerStatus;
}

export type AwardKind = 'bestMove' | 'fewestMistakes' | 'fastest' | 'comeback' | 'mostPoints';

export interface Award {
  kind: AwardKind;
  /** Everyone tied for it. */
  playerIds: PlayerId[];
  /** Points of the best move, mistakes, average think ms, largest deficit, or points gained. */
  value: number;
}

export interface PlayerStats {
  playerId: PlayerId;
  correct: number;
  mistakes: number;
  pointsGained: number;
  interferencesSent: number;
  bestMove: BestMove | null;
  /** Average think time of correct moves; null without any. */
  avgThinkMs: number | null;
}

export interface GameResult {
  reason: EndReason;
  durationMs: number;
  ranking: RankEntry[];
  /** Ranked games whose players all came with a rating. */
  ratingChanges: RatingChange[];
  /**
   * The same changes split by opponent (spec §11.2, Results-4P): present exactly when ratingChanges is not
   * empty. Absent from results stored before it existed (a ranked game's replay of an older game). A pair
   * held at 0 by a leave guard carries the guard's reason (`guard`), so the results can explain the 0.
   */
  ratingPairs?: RatingPairs[];
  awards: Award[];
  stats: PlayerStats[];
  /** A level's game only (config.level): its stars and measure. Absent from every other result. */
  level?: LevelResult;
}

type EventBody =
  | { type: 'gameCreated'; config: GameConfig }
  | { type: 'gameStarted' }
  /** endsAt null with remainingMs: the turn starts stopped (its holder is under interference). */
  | { type: 'turnStarted'; playerId: PlayerId; endsAt: number | null; remainingMs: number }
  /** Nobody can take the turn (everyone still in the game is disconnected); the first one back gets it. */
  | { type: 'turnCleared' }
  | { type: 'cellLocked'; playerId: PlayerId; cell: CellIndex; expiresAt: number | null; remainingMs: number }
  | {
      type: 'cellReleased';
      playerId: PlayerId;
      cell: CellIndex;
      reason: ReleaseReason;
      /** Only with a timeout penalty [D2]: what it cost and the score after it. */
      penalty?: number;
      score?: number;
    }
  | {
      type: 'placedCorrect';
      playerId: PlayerId;
      cell: CellIndex;
      digit: Digit;
      points: number;
      breakdown: MoveScore;
      score: number;
      thinkMs: number;
      /** Entered while the connection was lost, sent on the return (`offlineMove`) [D42]. */
      offline?: true;
    }
  | {
      type: 'placedWrong';
      playerId: PlayerId;
      cell: CellIndex;
      digit: Digit;
      penalty: number;
      mistakes: number;
      score: number;
      /** As placedCorrect.offline [D42]. */
      offline?: true;
    }
  | {
      type: 'interference';
      fromId: PlayerId;
      targetId: PlayerId;
      kind: InterferenceKind;
      cost: number;
      endsAt: number;
      /** The sender's score after paying. */
      score: number;
      /** The target's lock, now stopped (expiresAt null) [D11]. */
      locks: LockTimer[];
    }
  /** `locks`: the target's lock, running again (spec §18). */
  | {
      type: 'interferenceEnded';
      fromId: PlayerId;
      targetId: PlayerId;
      kind: InterferenceKind;
      locks: LockTimer[];
    }
  | { type: 'reaction'; playerId: PlayerId; emoji: string }
  /**
   * A level's time penalty: a wrong digit (rules.mistakeTimeMs), or a chain's right digit in a cell that cannot
   * be known yet [D64]. The time limit comes `ms` closer; `totalMs` is the player's total after it.
   */
  | {
      type: 'timePenalty';
      playerId: PlayerId;
      cell: CellIndex;
      reason: 'mistake' | 'notYet';
      ms: number;
      totalMs: number;
    }
  /**
   * The connection dropped: the soft phase [D42]. Only a mark; the game goes on as usual. At `softEndsAt`, if he
   * is not back, playerDisconnected follows (the hard phase of spec §16.2).
   */
  | { type: 'playerConnectionLost'; playerId: PlayerId; softEndsAt: number }
  | { type: 'playerDisconnected'; playerId: PlayerId; graceEndsAt: number }
  | { type: 'playerReconnected'; playerId: PlayerId }
  | { type: 'playerAbandoned'; playerId: PlayerId }
  | { type: 'playerSurrendered'; playerId: PlayerId }
  /** 'background': the phone's own game, the app out of the foreground mid-level [D65]; never from a server. */
  | { type: 'gamePaused'; reason: 'disconnect' | 'background' }
  /**
   * Every timer that stood still moves on by `pausedMs` (locks, interferences, the turn, re-lock waits);
   * `locks` lists the running locks with their new expiry (spec §18). Grace periods are never frozen.
   */
  | {
      type: 'gameResumed';
      reason: 'reconnect' | 'abandon' | 'foreground';
      pausedMs: number;
      locks: LockTimer[];
    }
  | ({ type: 'gameOver' } & GameResult);

export type GameEvent = EventBody & { seq: number; t: number };
export type GameEventType = GameEvent['type'];
/** The body of an event before it gets its seq and time. */
export type NewEvent = EventBody;
