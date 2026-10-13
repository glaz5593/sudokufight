/* Test-only: a game of 3–4 players on a manual clock, where the test plays the others' moves itself. */
import {
  botPlayer,
  type CellIndex,
  type Digit,
  type GameMode,
  type InterferenceKind,
  type LocalGameHost,
  type ManualClock,
  type ManualScheduler,
  type PlayerAction,
  type PlayerId,
  type PlayerInfo,
} from '@sudoku-fight/engine';

import type { OfflinePuzzle } from '../../../game/offlinePool';
import { answerIn, emptyCellsOf, PUZZLE, testHost, wrongIn } from '../../../game/testing/practice';
import type { GameSession } from '../GameScreen';

export const ME = 'me';

/**
 * The others, in seat order after me: Pip (hatchling), Biscuit (fox) and Maestro (professor), with the ratings
 * of the design's 4-player board (they make each card show a rating).
 */
export const OTHERS: readonly PlayerInfo[] = [
  { ...botPlayer(1), rating: 1305, ratedGames: 30 },
  { ...botPlayer(2), rating: 1271, ratedGames: 30 },
  { ...botPlayer(4), rating: 1318, ratedGames: 30 },
];

/** The others' moves, dispatched as each of them would send them. */
export interface Hand {
  select(cell: CellIndex): void;
  place(cell: CellIndex, digit: Digit): void;
  /** Locks the cell and places its answer. */
  solve(cell: CellIndex): void;
  /** Locks the cell and places a wrong digit. */
  miss(cell: CellIndex): Digit;
  interfere(targetId: PlayerId, kind?: InterferenceKind): void;
  react(emoji: string): void;
  surrender(): void;
}

export interface Group {
  session: GameSession & { close(): void };
  host: LocalGameHost;
  clock: ManualClock;
  scheduler: ManualScheduler;
  puzzle: OfflinePuzzle;
  /** The puzzle's empty cells, in board order. */
  cells: CellIndex[];
  /** Everyone, in seat order (me first). */
  players: PlayerInfo[];
  /** Another player's hand, by id. */
  as(id: PlayerId): Hand;
}

type WithoutPlayer<A> = A extends unknown ? Omit<A, 'playerId'> : never;

/** Me and 2 or 3 others (a ranked game by default: the engine's rules for it, interferences on). */
export function group({
  count = 3,
  mode = 'ranked',
  puzzle = PUZZLE,
}: { count?: 3 | 4; mode?: GameMode; puzzle?: OfflinePuzzle } = {}): Group {
  const players: PlayerInfo[] = [
    { id: ME, name: 'MosheG', rating: 1287, ratedGames: 30 },
    ...OTHERS.slice(0, count - 1),
  ];
  const { host, clock, scheduler } = testHost({ mode, players, puzzle });
  const as = (id: PlayerId): Hand => {
    const dispatch = (action: WithoutPlayer<PlayerAction>) => {
      const result = host.dispatch({ ...action, playerId: id } as PlayerAction);
      if (result.rejected) throw new Error(`${id}'s ${action.type} was refused: ${result.rejected}`);
    };
    return {
      select: (cell) => dispatch({ type: 'select', cell }),
      place: (cell, digit) => dispatch({ type: 'place', cell, digit }),
      solve: (cell) => {
        dispatch({ type: 'select', cell });
        dispatch({ type: 'place', cell, digit: answerIn(puzzle, cell) });
      },
      miss: (cell) => {
        const digit = wrongIn(puzzle, cell);
        dispatch({ type: 'select', cell });
        dispatch({ type: 'place', cell, digit });
        return digit;
      },
      interfere: (targetId, kind = 'fireworks') => dispatch({ type: 'interfere', targetId, kind }),
      react: (emoji) => dispatch({ type: 'react', emoji }),
      surrender: () => dispatch({ type: 'surrender' }),
    };
  };
  const session: Group['session'] = {
    id: host.state.config.id,
    host,
    clock,
    playerId: ME,
    getView: () => host.getView(),
    subscribe: (fn) => host.subscribe(fn),
    endPractice: () => host.surrender(),
    close: () => host.close(),
  };
  return { session, host, clock, scheduler, puzzle, cells: emptyCellsOf(puzzle), players, as };
}
