/* Test-only: ranked games on a manual clock, driven through the engine's own connection actions. */
import type { GameView, PlayerId, PlayerInfo } from '@sudoku-fight/engine';

import { testHost } from '../../../../game/testing/practice';

/** The games start at this time (the "server" clock of these tests). */
export const T0 = 1_000_000;
export const ME = 'me';
export const NINA = 'nina';
export const AIKO = 'aiko';

export const MOSHE_INFO: PlayerInfo = { id: ME, name: 'MosheG', rating: 1287, ratedGames: 30 };
export const NINA_INFO: PlayerInfo = { id: NINA, name: 'NinaVolt', rating: 1305, ratedGames: 30 };
export const AIKO_INFO: PlayerInfo = { id: AIKO, name: 'Aiko_M', rating: 1250, ratedGames: 30 };

export interface RankedGame {
  view(): GameView;
  now(): number;
  /** Moves the clock, running the engine's timers (grace, locks) as they fall due. */
  advance(ms: number): void;
  disconnect(playerId: PlayerId): void;
  reconnect(playerId: PlayerId): void;
  surrender(playerId: PlayerId): void;
}

/** A ranked game, started, with me in seat 0 (MosheG vs NinaVolt by default, both rated). */
export function rankedGame(players: PlayerInfo[] = [MOSHE_INFO, NINA_INFO]): RankedGame {
  const { host, clock, scheduler } = testHost({ mode: 'ranked', players, at: T0 });
  const act = (action: Parameters<typeof host.dispatch>[0]) => {
    const result = host.dispatch(action);
    if (result.rejected) throw new Error(`${action.type} was refused: ${result.rejected}`);
  };
  return {
    view: () => host.getView(),
    now: () => clock.now(),
    advance: (ms) => scheduler.advance(ms),
    disconnect: (playerId) => act({ type: 'disconnect', playerId }),
    reconnect: (playerId) => act({ type: 'reconnect', playerId }),
    surrender: (playerId) => act({ type: 'surrender', playerId }),
  };
}
