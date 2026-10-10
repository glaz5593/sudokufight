import type { GameMode, GameResult, GameType, PlayerId } from '@sudoku-fight/engine';
import type { PracticeOutcome, PracticeResult } from '@sudoku-fight/protocol';

import { outcomeOf } from '../game/outcome';

/**
 * A practice that just ended, as the session reports it (game/session.ts `onFinish`), and the PracticeResult
 * it earns XP with [D41]. The XP itself is the server's to give (the engine's xpForGame, spec §15); the phone
 * only says what happened: solo or against a bot, the outcome, and how many correct moves were mine.
 */
export interface FinishedPractice {
  /** The practice game's id: the result's id, so a resend is counted once. */
  id: string;
  mode: GameMode;
  gameType: GameType;
  playerId: PlayerId;
  result: Pick<GameResult, 'reason' | 'ranking'>;
  endedAt: number;
}

/** Null for anything that is not a practice (a ranked game earns its XP on the server). */
export function practiceResultOf(game: FinishedPractice): PracticeResult | null {
  if (game.mode !== 'solo' && game.mode !== 'bot') return null;
  const me = game.result.ranking.find((r) => r.playerId === game.playerId);
  let outcome: PracticeOutcome;
  if (game.mode === 'bot') {
    // Against a bot (spec §6.7): first alone is a win, a shared first a tie, behind a loss.
    outcome = outcomeOf(game.result, game.playerId) ?? 'loss';
  } else {
    // Solo: the board done, or the practice ended before it (spec §6.6).
    outcome = game.result.reason === 'boardComplete' ? 'completed' : 'ended';
  }
  return {
    id: game.id,
    mode: game.mode,
    gameType: game.gameType,
    outcome,
    correct: Math.max(0, Math.floor(me?.correct ?? 0)),
    endedAt: Math.floor(game.endedAt),
  };
}
