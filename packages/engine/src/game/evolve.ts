import { CELL_COUNT, parseGrid } from '../sudoku/board';
import type { GameConfig, GameEvent, GameState, LockTimer, PlayerState } from './types';

/**
 * The reducer: the only place where state changes, always because of an event. Replaying the event log
 * through it rebuilds every state of a game exactly (spec §13.1, §18).
 * Pure: it returns a new state and never touches the one it was given.
 */

export function initialState(config: GameConfig, createdAt: number): GameState {
  const grid = parseGrid(config.puzzle.givens);
  return {
    config,
    status: 'waiting',
    createdAt,
    startedAt: null,
    endedAt: null,
    pausedAt: null,
    seq: 0,
    lastEventAt: createdAt,
    grid,
    givens: grid.map((v) => v !== 0),
    owner: new Array<number | null>(CELL_COUNT).fill(null),
    wrong: Array.from({ length: CELL_COUNT }, () => []),
    locks: [],
    cooldowns: [],
    turn: null,
    players: config.players.map((p, seat): PlayerState => ({
      id: p.id,
      seat,
      status: 'active',
      connected: true,
      graceEndsAt: null,
      outOrder: null,
      score: 0,
      mistakes: 0,
      correct: 0,
      pointsGained: 0,
      interferencesSent: 0,
      bestMove: null,
      thinkMsTotal: 0,
      lastCorrectAt: null,
      maxDeficit: 0,
      hitBy: null,
      immuneUntil: 0,
      lastReactionAt: null,
    })),
    result: null,
  };
}

/** Copies what an event may change; untouched parts are shared. */
function draft(s: GameState): GameState {
  return {
    ...s,
    grid: s.grid.slice(),
    owner: s.owner.slice(),
    wrong: s.wrong.slice(),
    locks: s.locks.map((l) => ({ ...l })),
    cooldowns: s.cooldowns.slice(),
    turn: s.turn && { ...s.turn },
    players: s.players.map((p) => ({ ...p, hitBy: p.hitBy && { ...p.hitBy } })),
  };
}

function player(s: GameState, id: string): PlayerState {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`Event for an unknown player: ${id}`);
  return p;
}

/**
 * After any score change: each player still in the game records the largest gap so far behind the best
 * opponent still in the game (for the Comeback award, spec §12). Players who left do not count.
 */
function trackDeficits(s: GameState): void {
  const inGame = s.players.filter((p) => p.status === 'active');
  for (const p of inGame) {
    let best = -Infinity;
    for (const q of inGame) if (q !== p) best = Math.max(best, q.score);
    if (best > -Infinity) p.maxDeficit = Math.max(p.maxDeficit, best - p.score);
  }
}

/** Applies lock timers carried by an event. */
function applyTimers(s: GameState, timers: readonly LockTimer[]): void {
  for (const t of timers) {
    const lock = s.locks.find((l) => l.playerId === t.playerId && l.cell === t.cell);
    if (!lock) throw new Error(`Event timer for a lock that does not exist: ${t.playerId}`);
    lock.expiresAt = t.expiresAt;
    lock.remainingMs = t.remainingMs;
  }
}

export function evolve(state: GameState | null, e: GameEvent): GameState {
  if (e.type === 'gameCreated') {
    if (state) throw new Error('gameCreated in the middle of a game');
    if (e.seq !== 1) throw new Error(`gameCreated must be seq 1, got ${e.seq}`);
    return { ...initialState(e.config, e.t), seq: 1 };
  }
  if (!state) throw new Error(`The first event must be gameCreated, got ${e.type}`);
  if (e.seq !== state.seq + 1) throw new Error(`Event seq ${e.seq} after ${state.seq}`);
  const s = draft(state);
  s.seq = e.seq;
  s.lastEventAt = Math.max(s.lastEventAt, e.t);
  const rules = s.config.rules;

  switch (e.type) {
    case 'gameStarted':
      s.status = 'running';
      s.startedAt = e.t;
      break;

    case 'turnStarted':
      s.turn = {
        playerId: e.playerId,
        endsAt: e.endsAt,
        stoppedMs: e.endsAt === null ? e.remainingMs : null,
      };
      break;

    case 'turnCleared':
      s.turn = null;
      break;

    case 'cellLocked':
      s.locks = s.locks.filter((l) => l.playerId !== e.playerId);
      s.locks.push({
        playerId: e.playerId,
        cell: e.cell,
        lockedAt: e.t,
        expiresAt: e.expiresAt,
        remainingMs: e.remainingMs,
      });
      // The lock's own timer counts now; the turn timer stops for good.
      if (s.turn?.playerId === e.playerId) s.turn = { ...s.turn, endsAt: null, stoppedMs: null };
      break;

    case 'cellReleased': {
      s.locks = s.locks.filter((l) => l.playerId !== e.playerId);
      // Waits stand still in a freeze: inside one, "now" for them is the moment the game froze.
      const at = s.status === 'paused' && s.pausedAt !== null ? s.pausedAt : e.t;
      // One wait per player and cell: switching away and back must not dodge it.
      s.cooldowns = s.cooldowns.filter(
        (c) => !(c.playerId === e.playerId && c.cell === e.cell) && c.until > at,
      );
      if (rules.relockCooldownAfter.includes(e.reason) && rules.relockCooldownMs > 0)
        s.cooldowns.push({ playerId: e.playerId, cell: e.cell, until: at + rules.relockCooldownMs });
      if (e.score !== undefined) {
        player(s, e.playerId).score = e.score;
        trackDeficits(s);
      }
      break;
    }

    case 'placedCorrect': {
      const p = player(s, e.playerId);
      s.grid[e.cell] = e.digit;
      s.owner[e.cell] = p.seat;
      s.locks = s.locks.filter((l) => l.playerId !== e.playerId);
      p.score = e.score;
      p.correct++;
      p.pointsGained += e.points;
      p.thinkMsTotal += e.thinkMs;
      p.lastCorrectAt = e.t;
      if (!p.bestMove || e.points > p.bestMove.points)
        p.bestMove = { cell: e.cell, digit: e.digit, points: e.points, breakdown: e.breakdown };
      trackDeficits(s);
      break;
    }

    case 'placedWrong': {
      const p = player(s, e.playerId);
      s.wrong[e.cell] = [...s.wrong[e.cell]!, { digit: e.digit, playerId: e.playerId }];
      p.mistakes = e.mistakes;
      p.score = e.score;
      trackDeficits(s);
      break;
    }

    case 'interference': {
      const from = player(s, e.fromId);
      from.score = e.score;
      from.interferencesSent++;
      player(s, e.targetId).hitBy = { fromId: e.fromId, kind: e.kind, endsAt: e.endsAt };
      applyTimers(s, e.locks);
      // In 'turns' the turn timer of the target stops too [D11].
      if (rules.pauseLockWhileInterfered && s.turn?.playerId === e.targetId && s.turn.endsAt !== null)
        s.turn = { ...s.turn, endsAt: null, stoppedMs: Math.max(0, s.turn.endsAt - e.t) };
      trackDeficits(s);
      break;
    }

    case 'interferenceEnded': {
      const target = player(s, e.targetId);
      target.hitBy = null;
      target.immuneUntil = e.t + rules.interferenceImmunityMs;
      applyTimers(s, e.locks);
      if (s.turn?.playerId === e.targetId && s.turn.stoppedMs !== null)
        s.turn = { ...s.turn, endsAt: e.t + s.turn.stoppedMs, stoppedMs: null };
      break;
    }

    case 'reaction':
      player(s, e.playerId).lastReactionAt = e.t;
      break;

    case 'playerDisconnected': {
      const p = player(s, e.playerId);
      p.connected = false;
      p.graceEndsAt = e.graceEndsAt;
      break;
    }

    case 'playerReconnected': {
      const p = player(s, e.playerId);
      p.connected = true;
      p.graceEndsAt = null;
      break;
    }

    case 'playerAbandoned':
    case 'playerSurrendered': {
      const p = player(s, e.playerId);
      p.status = e.type === 'playerAbandoned' ? 'abandoned' : 'surrendered';
      p.outOrder = s.players.reduce((n, q) => Math.max(n, q.outOrder ?? 0), 0) + 1;
      p.graceEndsAt = null;
      if (e.type === 'playerAbandoned') p.connected = false;
      s.locks = s.locks.filter((l) => l.playerId !== e.playerId);
      if (s.turn?.playerId === e.playerId) s.turn = null;
      break;
    }

    case 'gamePaused':
      s.status = 'paused';
      s.pausedAt = e.t;
      break;

    case 'gameResumed': {
      // Everything that stood still moves on by the length of the pause; grace periods were not frozen.
      const d = e.pausedMs;
      const pausedAt = s.pausedAt ?? e.t - d;
      s.status = 'running';
      s.pausedAt = null;
      for (const l of s.locks) if (l.expiresAt !== null) l.expiresAt += d;
      applyTimers(s, e.locks);
      for (const p of s.players) {
        if (p.hitBy) p.hitBy.endsAt += d;
        if (p.immuneUntil > pausedAt) p.immuneUntil += d;
      }
      s.cooldowns = s.cooldowns.map((c) => ({ ...c, until: c.until + d }));
      if (s.turn?.endsAt != null) s.turn = { ...s.turn, endsAt: s.turn.endsAt + d };
      break;
    }

    case 'gameOver': {
      const { type: _type, seq: _seq, t: _t, ...result } = e;
      s.status = 'over';
      s.endedAt = e.t;
      s.pausedAt = null;
      s.locks = [];
      s.turn = null;
      // Nothing is running any more: no interference stays on screen over the results (spec §12).
      for (const p of s.players) p.hitBy = null;
      s.result = result;
      break;
    }
  }
  return s;
}
