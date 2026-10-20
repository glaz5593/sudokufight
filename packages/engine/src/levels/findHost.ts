import type { HostUpdate } from '../game/host';
import type { InterferenceKind } from '../game/rules';
import type { PlayerId } from '../game/types';
import type { GameView } from '../game/view';
import type { CellIndex, Digit } from '../sudoku/board';
import type { Scheduler } from '../util/scheduler';
import {
  applyFind,
  createFind,
  type FindAction,
  type FindActionResult,
  type FindDeps,
  type FindSetup,
  type FindState,
  findView,
  nextFindDeadline,
  tickFind,
} from './find';
import { LocalLevelHost, type LevelMachine } from './localLevelHost';
import type { FindLevelOver, LevelEvent } from './spec';

/**
 * LocalFindHost runs a tap level (find, findDuel, spotError) on the phone behind the same GameHost interface as
 * LocalGameHost (spec §17.2; dev-plan §1.4): the screens can't tell the two apart. Like it, it has one
 * scheduler timer (nextFindDeadline) and an outbox that delivers updates in order, one at a time: the
 * machinery it shares with the puzzle's host (LocalLevelHost, 1.0.3).
 *
 * What a tap level can do: `tap` (the one move), `surrender` (the X: the level ends 'quit'), and the phone's own
 * freeze [D65] (`pause` / `resume`). There is nothing to select, place, swap or send: those are refused at once
 * ('badAction', the log untouched), and so is `react` while the level allows no reactions (none by default,
 * D62; the bot still reacts). Updates carry the tap engine's events as `levelEvents` (`events` stays empty).
 */

export interface LocalFindHostOptions extends FindSetup, FindDeps {
  scheduler: Scheduler;
  /** Start right away (default). Set false to start with dispatch({ type: 'start' }) after a countdown. */
  autoStart?: boolean;
}

/** The tap engine as LocalLevelHost drives it. */
const FIND_MACHINE: LevelMachine<FindState, FindAction, LevelEvent> = {
  apply: applyFind,
  tick: tickFind,
  nextDeadline: nextFindDeadline,
  view: findView,
  update: (levelEvents, view) => ({ kind: 'events', events: [], view, levelEvents }),
  running: (s) => s.status === 'running',
  paused: (s) => s.status === 'paused',
  pauseAction: { type: 'pause' },
  resumeAction: { type: 'resume' },
};

export class LocalFindHost {
  readonly playerId: PlayerId;
  private readonly core: LocalLevelHost<FindState, FindAction, LevelEvent>;

  constructor(options: LocalFindHostOptions) {
    const { scheduler, autoStart = true, ...rest } = options;
    this.playerId = rest.player.id;
    this.core = new LocalLevelHost(FIND_MACHINE, createFind(rest, rest), {
      playerId: this.playerId,
      clock: rest.clock,
      scheduler,
    });
    if (autoStart) this.dispatch({ type: 'start' });
  }

  /** The full event log, the bot's plan included: replayFind() rebuilds the level from it. */
  get events(): readonly LevelEvent[] {
    return this.core.events;
  }

  get state(): FindState {
    return this.core.state;
  }

  /** How the level ended (the levelOver event), for levelOutcome(); null while it runs. */
  get over(): FindLevelOver | null {
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

  /** A tap level has no lock and no keypad: refused, the log untouched. */
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

  /** Refused while the level allows no reactions (none by default, D62). */
  react(emoji: string): void {
    this.core.send({ type: 'react', emoji }, { type: 'react', playerId: this.playerId, emoji });
  }

  /** The X, confirmed: the level ends 'quit'. Allowed while frozen too. */
  surrender(): void {
    this.core.send({ type: 'surrender' }, { type: 'quit', playerId: this.playerId });
  }

  tap(cell: CellIndex): void {
    this.core.send({ type: 'tap', cell }, { type: 'tap', playerId: this.playerId, cell });
  }

  /** Not a move of a tap level (the puzzle has its own host): refused, the log untouched. */
  swapBoxes(from: number, to: number): void {
    this.core.refuse({ type: 'swapBoxes', from, to }, 'badAction');
  }

  /**
   * [D65] The app left the foreground mid-level: the level freezes (levelPaused). Nothing runs out meanwhile,
   * and taps are refused 'paused'. Only a running level; again while frozen: nothing.
   */
  pause(): void {
    this.core.pause();
  }

  /**
   * [D65] Back, after the 3, 2, 1 over the covered board: the level goes on from where it froze, every deadline
   * (the limit, the 3 s freezes, the bot's plan) moved on by the freeze. Only while frozen; else nothing.
   */
  resume(): void {
    this.core.resume();
  }

  close(): void {
    this.core.close();
  }

  // -- beyond the interface ------------------------------------------------------------------------------

  /** Any action of the tap engine: the host's own (start, pause, resume) or a player's. */
  dispatch(action: FindAction): FindActionResult {
    return this.core.dispatch(action);
  }
}
