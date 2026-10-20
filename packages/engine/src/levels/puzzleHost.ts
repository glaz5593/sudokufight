import type { HostUpdate } from '../game/host';
import type { InterferenceKind } from '../game/rules';
import type { PlayerId } from '../game/types';
import type { GameView } from '../game/view';
import type { CellIndex, Digit } from '../sudoku/board';
import type { Scheduler } from '../util/scheduler';
import { LocalLevelHost, type LevelMachine } from './localLevelHost';
import {
  applyPuzzle,
  createPuzzle,
  nextPuzzleDeadline,
  type PuzzleAction,
  type PuzzleActionResult,
  type PuzzleDeps,
  type PuzzleSetup,
  type PuzzleState,
  puzzleView,
  tickPuzzle,
} from './puzzle';
import type { PuzzleEvent, PuzzleLevelOver } from './spec';

/**
 * LocalPuzzleHost runs a puzzle (levels-content.md §5.4) on the phone behind the same GameHost interface as
 * LocalGameHost and LocalFindHost: the screens can't tell them apart. The one move is `swapBoxes(from, to)`;
 * `surrender` is the X (the level ends 'quit'); `pause` / `resume` the phone's own freeze [D65]. Nothing can be
 * selected, placed, tapped, sent or reacted to in a puzzle: those are refused at once ('badAction', the log
 * untouched) [D62]. Updates carry the puzzle's events as `puzzleEvents` (`events` stays empty).
 *
 * The screen always asks: a box dropped on another one is a swapBoxes call, and the answer is in the update (a
 * 'boxFixed' refusal, or boxesSwapped with its penalty). One scheduler timer (the limit), the outbox and the
 * freeze are LocalLevelHost's, shared with LocalFindHost.
 */

export interface LocalPuzzleHostOptions extends PuzzleSetup, PuzzleDeps {
  scheduler: Scheduler;
  /** Start right away (default). Set false to start with dispatch({ type: 'start' }) after a countdown. */
  autoStart?: boolean;
}

/** The puzzle engine as LocalLevelHost drives it. */
const PUZZLE_MACHINE: LevelMachine<PuzzleState, PuzzleAction, PuzzleEvent> = {
  apply: applyPuzzle,
  tick: tickPuzzle,
  nextDeadline: nextPuzzleDeadline,
  view: puzzleView,
  update: (puzzleEvents, view) => ({ kind: 'events', events: [], view, puzzleEvents }),
  running: (s) => s.status === 'running',
  paused: (s) => s.status === 'paused',
  pauseAction: { type: 'pause' },
  resumeAction: { type: 'resume' },
};

export class LocalPuzzleHost {
  readonly playerId: PlayerId;
  private readonly core: LocalLevelHost<PuzzleState, PuzzleAction, PuzzleEvent>;

  constructor(options: LocalPuzzleHostOptions) {
    const { scheduler, autoStart = true, ...rest } = options;
    this.playerId = rest.player.id;
    this.core = new LocalLevelHost(PUZZLE_MACHINE, createPuzzle(rest, rest), {
      playerId: this.playerId,
      clock: rest.clock,
      scheduler,
    });
    if (autoStart) this.dispatch({ type: 'start' });
  }

  /** The full event log: replayPuzzle() rebuilds the level from it. */
  get events(): readonly PuzzleEvent[] {
    return this.core.events;
  }

  get state(): PuzzleState {
    return this.core.state;
  }

  /** How the puzzle ended (the levelOver event), for levelOutcome(); null while it runs. */
  get over(): PuzzleLevelOver | null {
    return this.core.state.result;
  }

  // -- GameHost ------------------------------------------------------------------------------------------

  getView(): GameView {
    return this.core.getView();
  }

  /** Returns the unsubscribe function. */
  subscribe(onEvent: (update: HostUpdate) => void): () => void {
    return this.core.subscribe(onEvent);
  }

  /** A puzzle has no cells to choose and no keypad: refused, the log untouched. */
  select(cell: CellIndex): void {
    this.core.refuse({ type: 'select', cell }, 'badAction');
  }

  release(): void {
    this.core.refuse({ type: 'release' }, 'badAction');
  }

  place(cell: CellIndex, digit: Digit): void {
    this.core.refuse({ type: 'place', cell, digit }, 'badAction');
  }

  /** No interference of any kind in a level [D49]. */
  interfere(targetId: PlayerId, kind: InterferenceKind): void {
    this.core.refuse({ type: 'interfere', targetId, kind }, 'badAction');
  }

  /** No reactions in a puzzle: it is played alone [D62]. */
  react(emoji: string): void {
    this.core.refuse({ type: 'react', emoji }, 'badAction');
  }

  /** The X, confirmed: the level ends 'quit'. Allowed while frozen too. */
  surrender(): void {
    this.core.send({ type: 'surrender' }, { type: 'quit', playerId: this.playerId });
  }

  /** Not a move of a puzzle (the tap levels have their own host): refused, the log untouched. */
  tap(cell: CellIndex): void {
    this.core.refuse({ type: 'tap', cell }, 'badAction');
  }

  /** The puzzle's one move: swap the boxes at two places (0–8, row-major, LTR). */
  swapBoxes(from: number, to: number): void {
    this.core.send({ type: 'swapBoxes', from, to }, { type: 'swap', playerId: this.playerId, from, to });
  }

  /**
   * [D65] The app left the foreground mid-level: the puzzle freezes (levelPaused). Nothing runs out meanwhile,
   * and swaps are refused 'paused'. Only a running puzzle; again while frozen: nothing.
   */
  pause(): void {
    this.core.pause();
  }

  /** [D65] Back, after the 3, 2, 1: the puzzle goes on with the same time left. Only while frozen. */
  resume(): void {
    this.core.resume();
  }

  close(): void {
    this.core.close();
  }

  // -- beyond the interface ------------------------------------------------------------------------------

  /** Any action of the puzzle engine: the host's own (start, pause, resume) or the player's. */
  dispatch(action: PuzzleAction): PuzzleActionResult {
    return this.core.dispatch(action);
  }
}
