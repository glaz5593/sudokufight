import { levelEndReason, levelStars } from '../levels/progress';
import type { LevelProgressView, LevelResult, LevelView, StarRule } from '../levels/spec';
import { starsFor } from '../levels/stars';
import { type CellIndex, isDigit } from '../sudoku/board';
import { moveScore } from '../sudoku/scoring';
import type { EndReason, GameState, PlayerId, PlayerState } from './types';

/**
 * A level of staged practice in the game engine (1.0.2; levels/spec.ts): its clock, its measure, its result and
 * its part of the view. Only a game with `config.level` comes here; every other game's results and views keep
 * their shape.
 */

/** The player the level is for: the viewer when he is in the game, else the one who is not a bot. */
function levelPlayer(state: GameState, viewer: PlayerId | null = null): PlayerState | undefined {
  return (
    state.players.find((p) => p.id === viewer) ??
    state.players.find((p) => state.config.players[p.seat]?.isBot !== true) ??
    state.players[0]
  );
}

/**
 * The level clock at `at`: the time played plus the time penalties. With a limit it is read off the deadline
 * (timeUpAt moves with every penalty and every freeze), so it stands still in a freeze and stops at the end;
 * without one, the freezes that ended (frozenMs) are left out.
 */
export function levelElapsedMs(state: GameState, at: number): number {
  if (state.startedAt === null) return 0;
  const t = state.status === 'paused' && state.pausedAt !== null ? state.pausedAt : at;
  const limit = state.config.rules.timeLimitMs;
  if (limit !== undefined && state.timeUpAt !== undefined)
    return Math.min(limit, Math.max(0, limit - (state.timeUpAt - t)));
  return Math.max(0, t - state.startedAt - (state.frozenMs ?? 0)) + (levelPlayer(state)?.timePenaltyMs ?? 0);
}

/** The level's measure for `me` now, in its star rule's unit: the clock, my lead, my points. */
function levelValue(
  state: GameState,
  rule: StarRule,
  me: PlayerState | undefined,
  elapsedMs: number,
): number {
  const score = me?.score ?? 0;
  switch (rule.by) {
    case 'timeMs':
      return elapsedMs;
    case 'gap': {
      const others = state.players.filter((p) => p !== me).map((p) => p.score);
      return others.length ? score - Math.max(...others) : score;
    }
    case 'points':
      return score;
    case 'spots':
      return 0;
  }
}

/** GameResult.level at the end of a level's game (results.ts): its stars, measure and clock. */
export function levelResultOf(state: GameState, reason: EndReason, at: number): LevelResult {
  const run = state.config.level!;
  const me = levelPlayer(state);
  const elapsedMs = levelElapsedMs(state, at);
  const metric = levelValue(state, run.stars, me, elapsedMs);
  const stars = levelStars(run.stars, levelEndReason(run.kind, reason, metric), metric, elapsedMs);
  return { stars, metric, elapsedMs, penaltyMs: me?.timePenaltyMs ?? 0 };
}

/** How far the task is; a chain gives a count only, never which cell is next. */
function progressOf(state: GameState, me: PlayerState | undefined): LevelProgressView | null {
  const r = state.config.rules;
  const done = (cells: readonly CellIndex[]) => cells.filter((c) => state.grid[c] !== 0).length;
  if (r.chainCells) return { kind: 'chain', done: done(r.chainCells), total: r.chainCells.length };
  if (r.editableCells) return { kind: 'cells', done: done(r.editableCells), total: r.editableCells.length };
  if (r.maxMoves !== undefined)
    return {
      kind: 'moves',
      used: (me?.correct ?? 0) + (me?.mistakes ?? 0),
      max: r.maxMoves,
      score: me?.score ?? 0,
    };
  if (r.endAtScore !== undefined) {
    const others = state.players.filter((p) => p !== me).map((p) => p.score);
    return {
      kind: 'score',
      mine: me?.score ?? 0,
      opponent: others.length ? Math.max(...others) : null,
      target: r.endAtScore,
    };
  }
  return null;
}

/**
 * GameView.level: the clock (standing still in a freeze, stopped at the end), the stars so far (if it ended well
 * now) or as it ended, the progress, and what my locked cell is worth when the level gives that hint.
 */
export function levelViewOf(state: GameState, viewer: PlayerId | null, now: number): LevelView {
  const run = state.config.level!;
  const rules = state.config.rules;
  const me = levelPlayer(state, viewer);
  const over = state.status === 'over';
  const at = over ? (state.endedAt ?? now) : now;
  const elapsedMs = levelElapsedMs(state, at);
  const limitMs = rules.timeLimitMs ?? null;
  const running = state.status === 'running';
  const remainingMs = limitMs === null ? null : Math.max(0, limitMs - elapsedMs);
  const stars = over
    ? (state.result?.level?.stars ?? 0)
    : starsFor(run.stars, levelValue(state, run.stars, me, elapsedMs));

  let selectedWorth: number | undefined;
  const lock = me ? state.locks.find((l) => l.playerId === me.id) : undefined;
  const right = lock ? Number(state.config.puzzle.solution[lock.cell]) : NaN;
  // The solution is the phone's own in a level; a public state (no solution) gives no hint.
  if (run.worthHint && lock && isDigit(right))
    selectedWorth = moveScore(state.grid, lock.cell, right, rules.scoreY).points;

  return {
    id: run.id,
    rev: run.rev,
    kind: run.kind,
    boss: run.boss === true,
    attempt: run.attempt,
    elapsedMs,
    limitMs,
    endsAt: running && state.timeUpAt !== undefined ? state.timeUpAt : null,
    remainingMs,
    penaltyMs: me?.timePenaltyMs ?? 0,
    marks: { ...run.stars },
    stars,
    final: over,
    editableCells: rules.editableCells ? rules.editableCells.slice() : null,
    progress: progressOf(state, me),
    lockTimer: rules.lockTimeout !== false,
    ...(selectedWorth === undefined ? null : { selectedWorth }),
  };
}
