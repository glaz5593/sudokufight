import type { GameType } from '../gameType';
import { type CellIndex, type Digit, DIGITS, digitCount } from '../sudoku/board';
import { evolve } from './evolve';
import { rankPlayers } from './results';
import type { GameMode, InterferenceKind, TurnModel } from './rules';
import type { BestMove, GameConfig, GameEvent, GameResult, GameState, PlayerId, PlayerStatus } from './types';

/**
 * What a player's screen may know (spec §17.2, §21): everything on the table, never the solution while the
 * game runs. Screens render this and nothing else, so they hold no game logic: the place on each card, the
 * leader, the keypad's disabled digits and whether ⚡ can be used are all worked out here.
 *
 * Timers come as `expiresAt` (in the clock the engine runs on) or, while stopped, as `expiresAt: null` with
 * `remainingMs` — under interference [D11], and for everything while the game is frozen (spec §16.2).
 */

export interface TimerView {
  /** When it runs out; null while it is stopped. */
  expiresAt: number | null;
  /** Time left; what to show while stopped. */
  remainingMs: number;
}

export interface PlayerView {
  id: PlayerId;
  seat: number;
  name: string | null;
  isBot: boolean;
  /** The rating in this game's rating key, for the card (spec §6.8); null outside ranked games. */
  rating: number | null;
  status: PlayerStatus;
  connected: boolean;
  graceEndsAt: number | null;
  score: number;
  mistakes: number;
  correct: number;
  /** The current place (1–4, shared on a tie), as the game would end now (spec §6.8). */
  place: number;
  /** Alone or tied at place 1 while still in the game. */
  isLeader: boolean;
  /** The cell this player holds, if any ("choosing · D5" with its timer). */
  lock: ({ cell: CellIndex } & TimerView) | null;
  /** Interference on this player. */
  hitBy: ({ fromId: PlayerId; kind: InterferenceKind } & TimerView) | null;
  immuneUntil: number;
  bestMove: BestMove | null;
}

export interface InterferenceTarget {
  playerId: PlayerId;
  /** Why it can't be sent now; null when it can. 'notRunning': the game has not started, is frozen or is over. */
  blockedBy: 'out' | 'disconnected' | 'busy' | 'points' | 'notRunning' | null;
  /** Only with 'busy': when the target can take one again (end of the interference plus the immunity) [D11]. */
  busyUntil?: number;
}

export interface GameView {
  gameId: string;
  mode: GameMode;
  gameType: GameType;
  status: GameState['status'];
  seq: number;
  startedAt: number | null;
  pausedAt: number | null;
  rules: {
    turnModel: TurnModel;
    thinkTimeMs: number;
    interferenceMs: number;
    interferences: boolean;
    interferenceKinds: readonly InterferenceKind[];
    reactions: readonly string[];
    reactionCooldownMs: number;
  };

  /** 81 values, 0 = empty. */
  grid: number[];
  givens: boolean[];
  /** Seat of whoever solved each cell. */
  owner: (number | null)[];
  /** Wrong digits shown small and red in each cell, by everyone (spec §6.5). */
  wrong: { digit: Digit; playerId: PlayerId }[][];
  players: PlayerView[];
  /** 'turns' model [D1]. */
  turn: ({ playerId: PlayerId } & TimerView) | null;

  /** The viewer; null for a spectator view. */
  me: PlayerId | null;
  /** The viewer's keypad (spec §6.3). */
  keypad: {
    /** How many of each digit are still to be placed, index 0 = digit 1. */
    remaining: number[];
    /** Digits that cannot be pressed now: all nine placed, or already tried wrongly in my locked cell [D12]. */
    disabled: Digit[];
    /** The keypad works only while I hold a lock (and the game runs). */
    enabled: boolean;
  };
  /** My re-lock waits [D2]: cells I just let go of and can't take again yet. */
  cooldowns: { cell: CellIndex; until: number }[];
  /**
   * The cost of my next interference, and whether each opponent can take it now [D10, D11]. Null when
   * interferences are off or I can't send any (spectator, left the game, disconnected).
   */
  interference: { nextCost: number; missingPoints: number; targets: InterferenceTarget[] } | null;
  /** When I may react again. */
  reactionReadyAt: number;

  result: GameResult | null;
  /** Only once the game is over (for the replay). */
  solution: string | null;
}

/** `now` decides the time-bound parts: re-lock waits and the second of immunity after an interference. */
export function toView(state: GameState, viewer: PlayerId | null, now: number): GameView {
  const rules = state.config.rules;
  const me = state.players.find((p) => p.id === viewer) ?? null;
  const t = now;
  const myLock = me ? (state.locks.find((l) => l.playerId === me.id) ?? null) : null;
  const frozenAt = state.status === 'paused' ? state.pausedAt : null;

  /** A deadline as the screen shows it: stopped while the game is frozen; remainingMs is always current. */
  const timer = (expiresAt: number | null, remainingMs: number): TimerView =>
    expiresAt === null
      ? { expiresAt, remainingMs }
      : frozenAt !== null
        ? { expiresAt: null, remainingMs: Math.max(0, expiresAt - frozenAt) }
        : { expiresAt, remainingMs: Math.max(0, expiresAt - t) };

  const disabled = DIGITS.filter((d) => {
    if (digitCount(state.grid, d) >= 9) return true;
    if (!myLock) return false;
    return state.wrong[myLock.cell]!.some(
      (w) => w.digit === d && (rules.wrongDigitDisabledFor === 'everyone' || w.playerId === me!.id),
    );
  });

  let interference: GameView['interference'] = null;
  if (me && rules.interferences && me.status === 'active' && me.connected) {
    const nextCost = rules.interferenceCostBase ** (me.interferencesSent + 1);
    const missingPoints = rules.interferenceNeedsScore ? Math.max(0, nextCost - me.score) : 0;
    interference = {
      nextCost,
      missingPoints,
      targets: state.players
        .filter((p) => p.id !== me.id)
        .map((p): InterferenceTarget => {
          const blockedBy: InterferenceTarget['blockedBy'] =
            p.status !== 'active'
              ? 'out'
              : !p.connected
                ? 'disconnected'
                : p.hitBy || p.immuneUntil > t
                  ? 'busy'
                  : state.status !== 'running'
                    ? 'notRunning'
                    : missingPoints > 0
                      ? 'points'
                      : null;
          if (blockedBy !== 'busy') return { playerId: p.id, blockedBy };
          const busyUntil = p.hitBy ? p.hitBy.endsAt + rules.interferenceImmunityMs : p.immuneUntil;
          return { playerId: p.id, blockedBy, busyUntil };
        }),
    };
  }

  const ranking = rankPlayers(state);
  const placeOf = new Map(ranking.map((r) => [r.playerId, r.place]));
  // The leader is the best placed player still in the game ([D36] 'byScore' may rank someone who left higher).
  const leaderPlace = Math.min(...ranking.filter((r) => r.status === 'active').map((r) => r.place));

  return {
    gameId: state.config.id,
    mode: state.config.mode,
    gameType: state.config.gameType,
    status: state.status,
    seq: state.seq,
    startedAt: state.startedAt,
    pausedAt: state.pausedAt,
    rules: {
      turnModel: rules.turnModel,
      thinkTimeMs: rules.thinkTimeMs,
      interferenceMs: rules.interferenceMs,
      interferences: rules.interferences,
      interferenceKinds: rules.interferenceKinds,
      reactions: rules.reactions,
      reactionCooldownMs: rules.reactionCooldownMs,
    },
    grid: state.grid.slice(),
    givens: state.givens.slice(),
    owner: state.owner.slice(),
    wrong: state.wrong.map((w) => w.slice()),
    players: state.players.map((p) => {
      const info = state.config.players[p.seat]!;
      const lock = state.locks.find((l) => l.playerId === p.id);
      const place = placeOf.get(p.id) ?? state.players.length;
      return {
        id: p.id,
        seat: p.seat,
        name: info.name ?? null,
        isBot: info.isBot ?? false,
        rating: state.config.mode === 'ranked' ? (info.rating ?? null) : null,
        status: p.status,
        connected: p.connected,
        graceEndsAt: p.graceEndsAt,
        score: p.score,
        mistakes: p.mistakes,
        correct: p.correct,
        place,
        isLeader: p.status === 'active' && place === leaderPlace && state.players.length > 1,
        lock: lock ? { cell: lock.cell, ...timer(lock.expiresAt, lock.remainingMs) } : null,
        hitBy: p.hitBy && {
          fromId: p.hitBy.fromId,
          kind: p.hitBy.kind,
          ...timer(p.hitBy.endsAt, Math.max(0, p.hitBy.endsAt - t)),
        },
        immuneUntil: p.immuneUntil,
        bestMove: p.bestMove && { ...p.bestMove, breakdown: { ...p.bestMove.breakdown } },
      };
    }),
    turn: state.turn && {
      playerId: state.turn.playerId,
      ...timer(state.turn.endsAt, state.turn.stoppedMs ?? Math.max(0, (state.turn.endsAt ?? t) - t)),
    },
    me: me?.id ?? null,
    keypad: {
      remaining: DIGITS.map((d) => 9 - digitCount(state.grid, d)),
      disabled,
      enabled: !!myLock && state.status === 'running',
    },
    cooldowns: me
      ? state.cooldowns
          // A wait stands still in a freeze (it moves on with the resume), so it still shows.
          .filter((c) => c.playerId === me.id && c.until > (frozenAt ?? t))
          .map((c) => ({ cell: c.cell, until: c.until }))
      : [],
    interference,
    reactionReadyAt: me?.lastReactionAt != null ? me.lastReactionAt + rules.reactionCooldownMs : 0,
    // A copy: a screen that sorts or edits it must not reach into the game's own state.
    result: state.result && (JSON.parse(JSON.stringify(state.result)) as GameResult),
    solution: state.status === 'over' ? state.config.puzzle.solution : null,
  };
}

// ---------------------------------------------------------------------------------------------------------

/** The config as clients may see it while the game runs: no solution. */
export function publicConfig(config: GameConfig): GameConfig {
  return { ...config, puzzle: { ...config.puzzle, solution: '' } };
}

/**
 * The state as a client may hold it (spec §18, §21): the solution only once the game is over. A client keeps
 * it current with evolve() over the public events, and draws it with toView(): the same code as the server.
 */
export function publicState(state: GameState): GameState {
  return state.status === 'over' ? state : { ...state, config: publicConfig(state.config) };
}

/** An event as it may leave the server during the game (spec §21): gameCreated loses the solution. */
export function toPublicEvent(event: GameEvent): GameEvent {
  return event.type === 'gameCreated' ? { ...event, config: publicConfig(event.config) } : event;
}

/** Every state of a game, rebuilt from its event log (spec §13.1): states[k] follows events[k]. */
export function replay(events: readonly GameEvent[]): GameState[] {
  const states: GameState[] = [];
  let state: GameState | null = null;
  for (const e of events) {
    state = evolve(state, e);
    states.push(state);
  }
  return states;
}
