/* Test-only helpers for a practice against the engine's bot: where "me" can play next, and my move. */
import type { CellIndex, GameEvent, GameView } from '@sudoku-fight/engine';

import type { OfflinePuzzle } from '../offlinePool';
import type { PracticeSession } from '../session';
import { answerIn } from './practice';

/**
 * The first cell I can take now: empty, not held by anyone (the bot may be on one), and not one I must wait
 * for (the re-lock wait [D2]). Null when there is none at this moment.
 */
export function freeCellFor(view: GameView, now: number): CellIndex | null {
  const held = new Set(view.players.flatMap((p) => (p.lock ? [p.lock.cell] : [])));
  const waiting = new Set(view.cooldowns.filter((c) => c.until > now).map((c) => c.cell));
  for (let cell = 0; cell < 81; cell++)
    if (view.grid[cell] === 0 && !held.has(cell) && !waiting.has(cell)) return cell;
  return null;
}

/**
 * My move, right away: lock the first free cell and place its answer. Returns the cell, or null when no cell
 * was free (or the game is not running).
 */
export function playMyMove(session: PracticeSession, puzzle: OfflinePuzzle): CellIndex | null {
  const view = session.getView();
  if (view.status !== 'running') return null;
  const cell = freeCellFor(view, session.clock.now());
  if (cell === null) return null;
  session.host.select(cell);
  if (session.getView().players.find((p) => p.id === session.playerId)?.lock?.cell !== cell) return null;
  session.host.place(cell, answerIn(puzzle, cell));
  return cell;
}

/** The cells a player solved, from a log. */
export const solvedBy = (events: readonly GameEvent[], playerId: string): CellIndex[] =>
  events.flatMap((e) => (e.type === 'placedCorrect' && e.playerId === playerId ? [e.cell] : []));
