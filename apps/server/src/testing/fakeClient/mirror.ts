import { evolve, type GameEvent, type GameState, type PlayerId } from '@sudoku-fight/engine';

/**
 * The game as a client holds it (spec §18): the last snapshot, moved on with the engine's evolve() over every
 * event above its seq. RemoteGameHost does the same on the phone; the fake client and the tests use this one.
 *
 * - A snapshot replaces everything (join, reconnect, rejoin): the server is authoritative.
 * - Events at or below the state's seq are duplicates and are skipped. An event that skips ahead is a gap:
 *   the server never sends one, so the mirror counts it and stops there until the next snapshot.
 * - After gameOver the server sends the solution (spec §21: only then); solution() puts it into the config,
 *   which makes the state equal to the server's publicState() of the finished game.
 */
export class GameMirror {
  private base: GameState | null = null;
  private current: GameState | null = null;
  /** The events applied since the last snapshot, for stateAt(). */
  private readonly applied: GameEvent[] = [];
  private me: PlayerId | null = null;
  private broken = false;
  /** Events whose seq skipped ahead (never expected). */
  gaps = 0;
  /** Events received again (seq at or below the state's), skipped. */
  duplicates = 0;
  /** Snapshots of an unfinished game that carried the solution (spec §21 says never). */
  leaks = 0;
  /** Snapshots taken so far (1 + reconnections and rejoins). */
  snapshots = 0;

  get state(): GameState | null {
    return this.current;
  }

  /** The player this client is (from the snapshot). */
  get playerId(): PlayerId | null {
    return this.me;
  }

  /** A state, and no gap since the last snapshot. */
  get inSync(): boolean {
    return this.current !== null && !this.broken;
  }

  snapshot(state: GameState, playerId: PlayerId): void {
    if (state.status !== 'over' && state.config.puzzle.solution !== '') this.leaks++;
    this.base = state;
    this.current = state;
    this.applied.length = 0;
    this.me = playerId;
    this.broken = false;
    this.snapshots++;
  }

  /** Applies the events above the state's seq, in order, and returns those applied. */
  events(events: readonly GameEvent[]): GameEvent[] {
    const out: GameEvent[] = [];
    if (this.current === null || this.broken) return out;
    for (const e of events) {
      if (e.seq <= this.current.seq) {
        this.duplicates++;
        continue;
      }
      if (e.seq !== this.current.seq + 1) {
        this.gaps++;
        this.broken = true;
        break;
      }
      this.current = evolve(this.current, e);
      this.applied.push(e);
      out.push(e);
    }
    return out;
  }

  /** The solution, sent after gameOver (for the replay). */
  solution(solution: string): void {
    if (this.current === null) return;
    const config = this.current.config;
    this.current = { ...this.current, config: { ...config, puzzle: { ...config.puzzle, solution } } };
  }

  /**
   * The state right after event `seq`, rebuilt from the last snapshot; null when `seq` is before that
   * snapshot or not reached yet. (Without the solution: that comes after the last event.)
   */
  stateAt(seq: number): GameState | null {
    if (this.base === null || seq < this.base.seq) return null;
    let state = this.base;
    for (const e of this.applied) {
      if (e.seq > seq) break;
      state = evolve(state, e);
    }
    return state.seq === seq ? state : null;
  }
}
