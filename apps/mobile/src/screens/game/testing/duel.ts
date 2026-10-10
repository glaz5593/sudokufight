/* Test-only: a practice against a bot on a manual clock, where the test plays the bot's moves itself. */
import {
  botPlayer,
  type CellIndex,
  type Digit,
  type InterferenceKind,
  type LocalGameHost,
  type ManualClock,
  type ManualScheduler,
  type PlayerAction,
  type PlayerInfo,
} from '@sudoku-fight/engine';

import type { OfflinePuzzle } from '../../../game/offlinePool';
import { answerIn, emptyCellsOf, PUZZLE, testHost, wrongIn } from '../../../game/testing/practice';
import type { GameSession } from '../GameScreen';

/** Level 3: { id: 'bot-3', name: 'Mr. Hoot', isBot: true }. */
export const BOT: PlayerInfo = botPlayer(3);
export const ME = 'me';

export interface Duel {
  session: GameSession & { close(): void };
  host: LocalGameHost;
  clock: ManualClock;
  scheduler: ManualScheduler;
  puzzle: OfflinePuzzle;
  /** The puzzle's empty cells, in board order. */
  cells: CellIndex[];
  /** The bot's actions, dispatched as the engine's bot would. */
  bot: {
    select(cell: CellIndex): void;
    place(cell: CellIndex, digit: Digit): void;
    /** Locks the cell and places its answer. */
    solve(cell: CellIndex): void;
    /** Locks the cell and places a wrong digit. */
    miss(cell: CellIndex): Digit;
    react(emoji: string): void;
    interfere(kind?: InterferenceKind): void;
  };
}

type WithoutPlayer<A> = A extends unknown ? Omit<A, 'playerId'> : never;

/** Me and a bot (mode 'bot', the engine's rules for it), on the pool's first puzzle. */
export function duel({
  puzzle = PUZZLE,
  bot = BOT,
}: { puzzle?: OfflinePuzzle; bot?: PlayerInfo } = {}): Duel {
  const { host, clock, scheduler } = testHost({ mode: 'bot', players: [{ id: ME }, bot], puzzle });
  const dispatch = (action: WithoutPlayer<PlayerAction>) => {
    const result = host.dispatch({ ...action, playerId: bot.id } as PlayerAction);
    if (result.rejected) throw new Error(`The bot's ${action.type} was refused: ${result.rejected}`);
  };
  const session: Duel['session'] = {
    id: host.state.config.id,
    host,
    clock,
    playerId: ME,
    getView: () => host.getView(),
    subscribe: (fn) => host.subscribe(fn),
    endPractice: () => host.surrender(),
    close: () => host.close(),
  };
  return {
    session,
    host,
    clock,
    scheduler,
    puzzle,
    cells: emptyCellsOf(puzzle),
    bot: {
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
      react: (emoji) => dispatch({ type: 'react', emoji }),
      interfere: (kind = 'fireworks') => dispatch({ type: 'interfere', targetId: ME, kind }),
    },
  };
}
