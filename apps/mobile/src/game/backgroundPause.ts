import type { Scheduler } from '@sudoku-fight/engine';

import { motion } from '../theme/motion';

/**
 * [D65] The background freeze of a local game (1.0.2): a stage (levels/levelSession.ts), and, as Moshe extended
 * it on 2026-10-18, a solo practice and a practice against a bot (game/session.ts). Never an online game: those
 * keep the disconnect rules [D42], and RemoteGameHost's pause/resume do nothing.
 *
 * Any AppState but 'active' (a phone call, another app, the screen off) freezes the game: host.pause() stops its
 * clock, its time limit, its locks and its bot. Back to 'active': "3", "2", "1" (`resumeCountdownMs`, one number
 * a step) over the covered board (the screens draw `state` with ResumeCountdown), then host.resume(), from the
 * very same point and with the same time left. Away again mid-countdown: frozen again, and the countdown starts
 * over at the next return. `backgroundPause` off: no freeze at all.
 *
 * A hold (holdLocalGames) keeps every local game frozen while something is asked over it (1.0.4,
 * friends-room.md §6.6: a room link that came mid-practice asks "לעזוב את האימון?" over the frozen board, and
 * the "3", "2", "1" comes only after "לא"). It freezes like the app going away, and its release is the return.
 */

/**
 * The freeze as the screens draw it: none; frozen while the app is away (the board covered); back, counting
 * down to the resume ("3", "2", "1" over the covered board).
 */
export type PauseState = { kind: 'none' } | { kind: 'paused' } | { kind: 'countdown'; count: number };

export const NOT_PAUSED: PauseState = { kind: 'none' };

/** What a game needs of React Native's AppState (tests give their own). */
export interface AppStateSource {
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}

/** The freeze's settings: LEVEL_UI for a stage, PRACTICE_UI for a practice. */
export interface BackgroundPauseSettings {
  /** The app leaving the foreground freezes the game. */
  backgroundPause: boolean;
  /** The resume countdown's length. */
  resumeCountdownMs: number;
}

/** The part of a local host the freeze works (LocalGameHost, LocalFindHost). */
export interface PausableHost {
  pause(): void;
  resume(): void;
  getView(): { status: string };
}

export interface BackgroundPauseOptions {
  host: PausableHost;
  scheduler: Scheduler;
  settings: BackgroundPauseSettings;
  /** The app's foreground state; null: not watched (background()/foreground() still work). */
  appState: AppStateSource | null;
  /** A listener that failed. */
  onError: (what: string, error: unknown) => void;
}

/** The countdown's step: one number a second (motion.md `countdownStep`). */
const COUNT_STEP_MS = motion.duration.countdownStep;

/** The holds now on (holdLocalGames), and the games that follow them. */
const holds = new Set<object>();
const holdListeners = new Set<(held: boolean) => void>();

const tellHold = (held: boolean) => {
  for (const listener of [...holdListeners]) {
    try {
      listener(held);
    } catch (error) {
      // One game's failure never keeps the others (or the question over them) from going on.
      if (__DEV__) console.warn('[pause] a hold could not reach a game', error);
    }
  }
};

/**
 * Keeps every local game frozen until the returned release is called: a running one freezes as if the app went
 * away, one counting down to its resume freezes again, and none resumes meanwhile. At the last release, a
 * frozen game counts down to its resume if the app is in the foreground (else at its return). Releasing twice
 * does nothing. Online games have no freeze, so a hold changes nothing for them.
 */
export function holdLocalGames(): () => void {
  const token = {};
  holds.add(token);
  if (holds.size === 1) tellHold(true);
  return () => {
    if (!holds.delete(token)) return;
    if (holds.size === 0) tellHold(false);
  };
}

/** Some hold is on (holdLocalGames). */
export const localGamesHeld = (): boolean => holds.size > 0;

export class BackgroundPause {
  private current: PauseState = NOT_PAUSED;
  private readonly listeners = new Set<(state: PauseState) => void>();
  private countdownTimer: unknown = null;
  private readonly subscription: { remove(): void } | null = null;
  private readonly holdListener: ((held: boolean) => void) | null = null;
  private stopped = false;
  /** The app is in the foreground, as far as its AppState said (a game starts in the foreground). */
  private appActive = true;

  constructor(private readonly opts: BackgroundPauseOptions) {
    if (!opts.settings.backgroundPause) return;
    if (opts.appState)
      this.subscription = opts.appState.addEventListener('change', (state) => {
        this.appActive = state === 'active';
        if (this.appActive) this.foreground();
        else this.background();
      });
    // A hold freezes like the app going away; its release is the return, when the app is in the foreground.
    this.holdListener = (held) => {
      if (held) this.background();
      else if (this.appActive) this.foreground();
    };
    holdListeners.add(this.holdListener);
  }

  get state(): PauseState {
    return this.current;
  }

  /** Called on every change of `state`; returns the unsubscribe function. */
  onChange(listener: (state: PauseState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The app went away: a running game freezes (a countdown on the way stops, to start over at the return). */
  background(): void {
    if (this.stopped || !this.opts.settings.backgroundPause) return;
    if (this.current.kind === 'countdown') {
      this.stopCountdown();
      this.set({ kind: 'paused' });
      return;
    }
    const { host } = this.opts;
    if (this.current.kind === 'paused' || host.getView().status !== 'running') return;
    host.pause();
    if (host.getView().status === 'paused') this.set({ kind: 'paused' });
  }

  /** The app is active again: the countdown, then the game goes on (not while a hold is on). */
  foreground(): void {
    if (this.stopped || this.current.kind !== 'paused' || localGamesHeld()) return;
    const total = Math.max(0, this.opts.settings.resumeCountdownMs);
    const count = Math.ceil(total / COUNT_STEP_MS);
    if (count === 0) return this.resumeNow();
    this.set({ kind: 'countdown', count });
    // The first number shows for what is left over a whole number of steps, each after it for a full step.
    this.stepIn(total - (count - 1) * COUNT_STEP_MS, count);
  }

  /** The game is over: no cover any more, and nothing to freeze from now on. */
  end(): void {
    this.stopCountdown();
    this.stopped = true;
    if (this.current.kind !== 'none') this.set(NOT_PAUSED);
  }

  /** Stops listening to the app and to nothing else; no listener hears of it. */
  close(): void {
    this.stopped = true;
    this.stopCountdown();
    this.subscription?.remove();
    if (this.holdListener) holdListeners.delete(this.holdListener);
    this.listeners.clear();
  }

  // -----------------------------------------------------------------------------------------------------

  private stepIn(ms: number, count: number): void {
    this.countdownTimer = this.opts.scheduler.setTimeout(() => {
      this.countdownTimer = null;
      if (this.stopped) return;
      if (count <= 1) this.resumeNow();
      else {
        this.set({ kind: 'countdown', count: count - 1 });
        this.stepIn(COUNT_STEP_MS, count - 1);
      }
    }, ms);
  }

  private stopCountdown(): void {
    if (this.countdownTimer !== null) this.opts.scheduler.clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
  }

  private resumeNow(): void {
    this.stopCountdown();
    // The board shows again only as the game goes on: no thinking time while it was covered.
    this.set(NOT_PAUSED);
    this.opts.host.resume();
  }

  private set(state: PauseState): void {
    this.current = state;
    for (const listener of [...this.listeners]) {
      try {
        listener(state);
      } catch (error) {
        this.opts.onError('a pause listener failed', error);
      }
    }
  }
}
