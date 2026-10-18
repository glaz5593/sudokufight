import type { Me } from '@sudoku-fight/protocol';

import { type RankedEnd, storedIn } from '../game/rankedEnd';
import type { Timers } from '../services/telemetry/sender';

/**
 * The account's numbers after a ranked game (Moshe's device test of 1.0.0, 2026-10-15: "the rating doesn't
 * update at the end of the game; I closed the app and opened it, and then it did"). The server stores the
 * result, the ratings and the XP in the background after the end, so a read right after the end can still
 * get the old ones. For each ranked end the game session reports (however the screens are left):
 *
 * 1. The game's own rating change (the server's result, the number the results screen counts to) is shown at
 *    once, in memory (`showResult`: auth/authStore.ts showRankedResult).
 * 2. GET /v1/me is read after each of `confirmDelaysMs`, until the server shows the game stored (its games
 *    count in the game's rating key went up: game/rankedEnd.ts storedIn); then my progress and my card (level,
 *    XP, league, games/wins/streak) are read once. Out of attempts: the progress once, and the shown rating
 *    lapses by its TTL, the server's answer then wins (it is the authority).
 * 3. A ranked game that moved no rating of mine: GET /v1/me and the progress at each of `unratedDelaysMs`.
 *
 * Only the newest game is followed; a game whose end was handled is not followed again; its end replaces a
 * wait that came from leaving it (the player came back before the grace ran out). Pure: the reads, the timers
 * and what to show come in (progress/appProgress.ts wires them to the phone).
 */
export interface RankedRefreshDeps {
  /** GET /v1/me, adopted by the auth store; null when it could not be read (offline, an error). */
  fetchMe(): Promise<Me | null>;
  /** My progress and my card again (never throws). */
  refreshProgress(): Promise<void>;
  /** Shows the game's rating change before the server has stored it. */
  showResult(end: RankedEnd): void;
  timers: Timers;
  confirmDelaysMs: readonly number[];
  unratedDelaysMs: readonly number[];
  log?: (message: string, detail?: unknown) => void;
}

/** How many ended games are remembered, so the same end is never followed twice. */
export const REMEMBERED_ENDS = 20;

interface Wait {
  end: RankedEnd;
  delays: readonly number[];
  /** Reads done so far. */
  attempts: number;
  timer: unknown;
}

export class RankedRefresh {
  private wait: Wait | null = null;
  private readonly ended: string[] = [];

  constructor(private readonly deps: RankedRefreshDeps) {}

  /** The game followed now, or null (tests, diagnostics). */
  get following(): RankedEnd | null {
    return this.wait?.end ?? null;
  }

  /** A ranked game ended (or was left while it ran): show its result and follow it until the server has it. */
  gameEnded(end: RankedEnd): void {
    if (this.ended.includes(end.gameId)) return;
    this.cancel();
    if (!end.left) {
      this.ended.push(end.gameId);
      if (this.ended.length > REMEMBERED_ENDS) this.ended.shift();
    }
    if (end.change) {
      try {
        this.deps.showResult(end);
      } catch (error) {
        this.log('could not show the result', error);
      }
    }
    const wait: Wait = {
      end,
      delays: end.expectsStored ? this.deps.confirmDelaysMs : this.deps.unratedDelaysMs,
      attempts: 0,
      timer: null,
    };
    this.wait = wait;
    this.schedule(wait, end.waitMs + (wait.delays[0] ?? 0));
  }

  /** Stops following (sign-out, another account, the app's stop) and forgets the ends seen. */
  stop(): void {
    this.cancel();
    this.ended.length = 0;
  }

  // -----------------------------------------------------------------------------------------------------

  private cancel(): void {
    const wait = this.wait;
    this.wait = null;
    if (wait?.timer != null) this.deps.timers.clearTimeout(wait.timer);
  }

  private schedule(wait: Wait, ms: number): void {
    wait.timer = this.deps.timers.setTimeout(() => {
      wait.timer = null;
      void this.attempt(wait);
    }, ms);
  }

  private async attempt(wait: Wait): Promise<void> {
    if (this.wait !== wait) return;
    const { end, delays } = wait;
    wait.attempts += 1;
    const me = await this.deps.fetchMe().catch(() => null);
    if (this.wait !== wait) return;
    const last = wait.attempts >= delays.length;
    if (end.expectsStored) {
      if (me && storedIn(me, end)) {
        this.log(`${end.gameId}: stored in ${end.key} (read ${wait.attempts})`);
        return this.finish(wait);
      }
      if (last) {
        this.log(`${end.gameId}: not stored after ${wait.attempts} reads`);
        return this.finish(wait);
      }
    } else {
      await this.progress();
      if (this.wait !== wait) return;
      if (last) {
        this.wait = null;
        return;
      }
    }
    this.schedule(wait, delays[wait.attempts] ?? 0);
  }

  private async finish(wait: Wait): Promise<void> {
    if (this.wait === wait) this.wait = null;
    await this.progress();
  }

  private progress(): Promise<void> {
    return this.deps
      .refreshProgress()
      .catch((error: unknown) => this.log('could not read the progress', error));
  }

  private log(message: string, detail?: unknown): void {
    this.deps.log?.(`[ranked] ${message}`, detail);
  }
}
