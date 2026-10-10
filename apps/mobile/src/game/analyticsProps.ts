import type { GameMode, GameResult, GameType, PlayerId } from '@sudoku-fight/engine';

import { outcomeOf } from './outcome';

/**
 * The props of a game's analytics events (spec §22), as the practice session sends them. Pure: no React
 * Native or Expo imports, so the server's contract test builds the very same props and checks that the server
 * stores them and the admin site counts them (practice games are `game_end` with mode solo or bot).
 * Nothing personal: the mode, the type, counts and the outcome, never a name.
 */

export interface GameStartProps {
  [key: string]: string | number;
  mode: GameMode;
  type: GameType;
  players: number;
}

export interface GameEndProps {
  [key: string]: string | number;
  mode: GameMode;
  result: string;
  score: number;
  mistakes: number;
  durationSec: number;
}

/** game_start{mode,type,players}. */
export function gameStartProps(mode: GameMode, type: GameType, players: number): GameStartProps {
  return { mode, type, players };
}

/** game_end's `result` (spec §22): a practice is completed or ended; a game with others is won, lost or tied. */
export function resultLabel(mode: GameMode, result: GameResult, playerId: PlayerId): string {
  if (mode === 'solo') return result.reason === 'boardComplete' ? 'completed' : 'ended';
  return outcomeOf(result, playerId) ?? 'unknown';
}

/** game_end{mode,result,score,mistakes,durationSec}, for `playerId` (the player on this phone). */
export function gameEndProps(mode: GameMode, result: GameResult, playerId: PlayerId): GameEndProps {
  const me = result.ranking.find((r) => r.playerId === playerId);
  return {
    mode,
    result: resultLabel(mode, result, playerId),
    score: me?.score ?? 0,
    mistakes: me?.mistakes ?? 0,
    durationSec: Math.round(result.durationMs / 1000),
  };
}
