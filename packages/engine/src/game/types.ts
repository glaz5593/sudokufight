import type { GameType } from '../gameType';
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
}

// ---------------------------------------------------------------------------------------------------------
// State

export type PlayerStatus = 'active' | 'surrendered' | 'abandoned';

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
  connected: boolean;
  /** Set while disconnected (spec §16.2). */
  graceEndsAt: number | null;
  /** 1 for the first player out (surrendered or abandoned), 2 for the next … */
  outOrder: number | null;

  score: number;
  mistakes: number;
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
}

// ---------------------------------------------------------------------------------------------------------
// Actions

/**
 * What a player can do (spec §18, client → server). De-duplication by clientSeq and rate limits are the
 * server's job (spec §21); the engine sees each action once.
 */
export type PlayerAction = { playerId: PlayerId } & (
  | { type: 'select'; cell: CellIndex }
  | { type: 'release' }
  | { type: 'place'; cell: CellIndex; digit: Digit }
  | { type: 'interfere'; targetId: PlayerId; kind: InterferenceKind }
  | { type: 'react'; emoji: string }
  | { type: 'surrender' }
);

/** What the host does: start the game, report connections. */
export type SystemAction =
  { type: 'start' } | { type: 'disconnect'; playerId: PlayerId } | { type: 'reconnect'; playerId: PlayerId };

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
  | 'alreadyDisconnected';

// ---------------------------------------------------------------------------------------------------------
// Events (spec §18, server → client). Every event has an increasing seq and the time it happened.

export type EndReason = 'boardComplete' | 'lastPlayerStanding' | 'practiceEnded';

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
   * empty. Absent from results stored before it existed (a ranked game's replay of an older game).
   */
  ratingPairs?: RatingPairs[];
  awards: Award[];
  stats: PlayerStats[];
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
    }
  | {
      type: 'placedWrong';
      playerId: PlayerId;
      cell: CellIndex;
      digit: Digit;
      penalty: number;
      mistakes: number;
      score: number;
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
  | { type: 'playerDisconnected'; playerId: PlayerId; graceEndsAt: number }
  | { type: 'playerReconnected'; playerId: PlayerId }
  | { type: 'playerAbandoned'; playerId: PlayerId }
  | { type: 'playerSurrendered'; playerId: PlayerId }
  | { type: 'gamePaused'; reason: 'disconnect' }
  /**
   * Every timer that stood still moves on by `pausedMs` (locks, interferences, the turn, re-lock waits);
   * `locks` lists the running locks with their new expiry (spec §18). Grace periods are never frozen.
   */
  | { type: 'gameResumed'; reason: 'reconnect' | 'abandon'; pausedMs: number; locks: LockTimer[] }
  | ({ type: 'gameOver' } & GameResult);

export type GameEvent = EventBody & { seq: number; t: number };
export type GameEventType = GameEvent['type'];
/** The body of an event before it gets its seq and time. */
export type NewEvent = EventBody;
