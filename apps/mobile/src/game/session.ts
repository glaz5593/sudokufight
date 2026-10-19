import {
  attachBot,
  type BotHandle,
  type BotLevelId,
  botPlayer,
  type Clock,
  createRng,
  defaultRules,
  type GameConfig,
  type GameEvent,
  type GameMode,
  type GameResult,
  type GameType,
  type GameView,
  type HostUpdate,
  LocalGameHost,
  type PlayerInfo,
  type PlayRecord,
  type Scheduler,
  selectPuzzle,
} from '@sudoku-fight/engine';
import type { GameHost } from '@sudoku-fight/protocol';
import { AppState } from 'react-native';

import { PRACTICE_UI, type PracticeUiSettings } from '../config/practice';
import { type AnalyticsEventName, type AnalyticsProps, track as defaultTrack } from '../services/analytics';
import { crashReporter } from '../services/crashlytics';
import { gameEndProps, gameStartProps } from './analyticsProps';
import { type AppStateSource, BackgroundPause, NOT_PAUSED, type PauseState } from './backgroundPause';
import { guardedScheduler, systemClock, timeoutScheduler } from './clock';
import { offlinePool, type PuzzlePool } from './offlinePool';
import type { PracticeRepo } from './practiceRepo';

/**
 * A practice on the phone (spec §5.1, §6.6), alone or against a bot (spec §9): picks a puzzle without repeats
 * from the offline pool and the local history (spec §20), runs it in a LocalGameHost on the device's clock,
 * and saves the FULL event log as the game goes [D25]. Screens talk to `host` (the GameHost interface) and
 * never to the engine. Against a bot, the engine's bot (attachBot) sits at the same host, on the same clock and
 * scheduler, with dice seeded from the game's seed: the saved seed and log tell the whole game.
 *
 * Saving never holds the game up: writes queue behind each other (one batch per update, merged while a write
 * is running), and a failed write is retried with the next update (the repository skips what it has).
 *
 * [D65, extended by Moshe 2026-10-18] The app leaving the foreground mid-game (a call, another app, the screen
 * off) freezes the practice as it freezes a stage (game/backgroundPause.ts): host.pause() stops the game clock,
 * the lock timer and the bot, which keeps the think time it had left. Back: "3", "2", "1" over the covered board
 * (the game screen draws `pause`), then host.resume(), from the very same point. The freeze is in the saved log
 * as the engine emits it (gamePaused 'background', gameResumed 'foreground'), and the game's clock leaves it out
 * (the engine's playedMs: the duration, the HUD, the replay's times). PRACTICE_UI.backgroundPause off: no freeze.
 */

/** The player on this phone, until accounts arrive (stage 8). */
export const ME = 'me';

export interface PracticeOptions {
  gameType: GameType;
}

export interface BotPracticeOptions {
  gameType: GameType;
  /** The bot's level (spec §9): 1 Pip … 5 Overlord. */
  level: BotLevelId;
}

/**
 * The bot's dice come from the game's seed, but not as the same stream as the puzzle choice (which draws
 * from the seed itself): the seed, xor-ed with this.
 */
export const BOT_SEED_SALT = 0x5bd1e995;

export const botSeedOf = (seed: number): number => (seed ^ BOT_SEED_SALT) >>> 0;

export interface PracticeDeps {
  /** Null plays without saving (the database couldn't open). */
  repo: PracticeRepo | null;
  clock?: Clock;
  scheduler?: Scheduler;
  pool?: PuzzlePool;
  /** Chooses the puzzle and seeds the game; random by default. */
  seed?: number;
  playerId?: string;
  track?: (name: AnalyticsEventName, props: AnalyticsProps) => void;
  /** Where save errors go; console.warn by default. */
  onError?: (what: string, error: unknown) => void;
  /**
   * An error out of one of the game's timers (a listener that failed on a lock running out, say): reported here,
   * never thrown at React Native. Crashlytics by default.
   */
  onTimerError?: (error: unknown) => void;
  /**
   * The game is over (once): its practice XP goes to the queue [D41] (progress/appProgress.ts). An error
   * here is reported, never thrown at the game.
   */
  onFinish?: (game: PracticeFinish) => void;
  /** [D65] The app's foreground state; React Native's AppState by default, null for none. */
  appState?: AppStateSource | null;
  /** [D65] The background freeze; PRACTICE_UI by default. */
  settings?: Pick<PracticeUiSettings, 'backgroundPause' | 'resumeCountdownMs'>;
}

/** A practice that just ended, for its XP (spec §15). */
export interface PracticeFinish {
  id: string;
  mode: GameMode;
  gameType: GameType;
  playerId: string;
  result: GameResult;
  endedAt: number;
}

export interface PracticeSession {
  readonly id: string;
  readonly mode: GameMode;
  readonly gameType: GameType;
  readonly puzzleId: string;
  readonly seed: number;
  readonly playerId: string;
  /** The bot's level in a practice against a bot; null in a solo practice. */
  readonly botLevel: BotLevelId | null;
  /** What the screens talk to. */
  readonly host: GameHost;
  /** The clock the game runs on: countdowns compare its time with the view's deadlines. */
  readonly clock: Clock;
  /** The full log so far, solution included. */
  readonly events: readonly GameEvent[];
  getView(): GameView;
  subscribe(onUpdate: (update: HostUpdate) => void): () => void;
  /**
   * "End practice" (spec §6.6): the engine ends a solo practice with reason 'practiceEnded'; against a bot it
   * is a surrender, and the bot wins.
   */
  endPractice(): void;
  /** Stops the game, its timers and the bot. A game still running is saved as interrupted. */
  close(): void;
  /** Resolves once everything so far is written (or has failed and been reported). */
  flush(): Promise<void>;
  /** [D65] The freeze as the game screen draws it (ResumeCountdown over the covered board). */
  readonly pause: PauseState;
  /** Called on every change of `pause`; returns the unsubscribe function. */
  onPause(listener: (state: PauseState) => void): () => void;
  /** [D65] The app went to the background: the game freezes (no-op once over, or with backgroundPause off). */
  background(): void;
  /** [D65] The app is active again: the countdown, then the game goes on. */
  foreground(): void;
}

const randomSeed = (): number => Math.floor(Math.random() * 2 ** 31);

/** An error out of a game timer, on the phone: kept with the crash reports (and shown in development). */
function reportTimerError(error: unknown): void {
  if (__DEV__) console.warn('[practice] a game timer failed', error);
  crashReporter().recordError(error, 'game: tick');
}

/** The puzzle for a practice: none from the current cycle of the history, if possible (spec §20). */
export function choosePuzzle(
  pool: PuzzlePool,
  gameType: GameType,
  history: readonly PlayRecord[],
  seed: number,
): string {
  return selectPuzzle(pool.ids(gameType), [history], { rng: createRng(seed) });
}

/** A solo practice. */
export function startPractice({ gameType }: PracticeOptions, deps: PracticeDeps): Promise<PracticeSession> {
  return openPractice({ mode: 'solo', gameType, bot: null }, deps);
}

/**
 * A practice against a bot (spec §5.1, §9): me in seat 0 and the engine's bot of `level` in seat 1, under the
 * engine's rules for mode 'bot'. The bot plays until the game is over or the session closes. No interferences,
 * either way [D44]: the player knows it is a bot, so the rules turn them off (the bot never sends one, and no
 * card shows "הפרעה").
 */
export function startBotPractice(
  { gameType, level }: BotPracticeOptions,
  deps: PracticeDeps,
): Promise<PracticeSession> {
  return openPractice({ mode: 'bot', gameType, bot: level }, deps);
}

async function openPractice(
  { mode, gameType, bot }: { mode: GameMode; gameType: GameType; bot: BotLevelId | null },
  deps: PracticeDeps,
): Promise<PracticeSession> {
  const pool = deps.pool ?? offlinePool;
  const onError = deps.onError ?? ((what, error) => console.warn(`[practice] ${what}`, error));
  const seed = deps.seed ?? randomSeed();

  let history: PlayRecord[] = [];
  if (deps.repo) {
    try {
      history = await deps.repo.playHistory(gameType);
    } catch (error) {
      onError('could not read the play history', error);
    }
  }
  const puzzleId = choosePuzzle(pool, gameType, history, seed);
  const puzzle = pool.byId(puzzleId);
  if (!puzzle) throw new Error(`Puzzle ${puzzleId} is not in the pool`);

  const clock = deps.clock ?? systemClock;
  // The game's timers (its clock, the bot's) never throw out to React Native: a listener's error from a tick is
  // reported, and the game goes on (see guardedScheduler).
  const scheduler = guardedScheduler(
    deps.scheduler ?? timeoutScheduler,
    deps.onTimerError ?? reportTimerError,
  );
  const playerId = deps.playerId ?? ME;
  const opponent: PlayerInfo | null = bot === null ? null : botPlayer(bot);
  const config: GameConfig = {
    id: `practice-${clock.now().toString(36)}-${seed.toString(36)}`,
    mode,
    gameType,
    puzzle: { id: puzzle.id, givens: puzzle.givens, solution: puzzle.solution },
    players: opponent ? [{ id: playerId }, opponent] : [{ id: playerId }],
    rules: defaultRules(mode, gameType),
    seed,
  };
  const host = new LocalGameHost({ config, playerId, clock, scheduler });
  const attach =
    bot === null || !opponent
      ? null
      : (h: LocalGameHost) =>
          attachBot(h, { botId: opponent.id, level: bot, clock, scheduler, rng: createRng(botSeedOf(seed)) });
  const freeze = new BackgroundPause({
    host,
    scheduler,
    settings: deps.settings ?? PRACTICE_UI,
    appState: deps.appState === undefined ? AppState : deps.appState,
    onError,
  });
  return new Session(
    host,
    config,
    clock,
    deps.repo,
    deps.track ?? defaultTrack,
    onError,
    bot,
    attach,
    deps.onFinish ?? null,
    freeze,
  );
}

class Session implements PracticeSession {
  readonly id: string;
  readonly mode: GameMode;
  readonly gameType: GameType;
  readonly puzzleId: string;
  readonly seed: number;
  readonly playerId: string;

  /** The bot at the table, until the game is over or the session closes. */
  private bot: BotHandle | null = null;
  private closed = false;
  private finished = false;
  /** False once the game's row could not be created: its events would have no game to belong to. */
  private saving: boolean;
  /** How many events of the log are on disk. */
  private saved = 0;
  private saveQueued = false;
  private tail: Promise<void> = Promise.resolve();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly local: LocalGameHost,
    config: GameConfig,
    readonly clock: Clock,
    private readonly repo: PracticeRepo | null,
    private readonly track: (name: AnalyticsEventName, props: AnalyticsProps) => void,
    private readonly onError: (what: string, error: unknown) => void,
    readonly botLevel: BotLevelId | null = null,
    attach: ((host: LocalGameHost) => BotHandle) | null = null,
    private readonly onFinish: ((game: PracticeFinish) => void) | null = null,
    private readonly freeze: BackgroundPause | null = null,
  ) {
    this.id = config.id;
    this.mode = config.mode;
    this.gameType = config.gameType;
    this.puzzleId = config.puzzle.id;
    this.seed = config.seed!;
    this.playerId = local.playerId;
    this.saving = repo !== null;

    const created = local.events[0];
    const opponents = config.players.filter((p) => p.id !== this.playerId);
    this.write('could not save the new game', async () => {
      try {
        await repo!.createGame({
          id: this.id,
          mode: this.mode,
          gameType: this.gameType,
          puzzleId: this.puzzleId,
          playerId: this.playerId,
          seed: this.seed,
          startedAt: created?.t ?? clock.now(),
          opponents,
        });
      } catch (error) {
        this.saving = false;
        throw error;
      }
    });
    this.save(); // gameCreated and gameStarted happened in the host's constructor
    // Subscribed before any screen and before the bot, so a game's events are queued for saving before anyone
    // reacts to them.
    this.unsubscribe = local.subscribe((update) => this.onUpdate(update));
    this.track('game_start', gameStartProps(this.mode, this.gameType, config.players.length));
    if (attach && local.state.status !== 'over') this.bot = attach(local);
  }

  get host(): GameHost {
    return this.local;
  }

  get events(): readonly GameEvent[] {
    return this.local.events;
  }

  getView(): GameView {
    return this.local.getView();
  }

  subscribe(onUpdate: (update: HostUpdate) => void): () => void {
    return this.local.subscribe(onUpdate);
  }

  endPractice(): void {
    if (this.closed || this.local.state.status === 'over') return;
    this.local.surrender();
  }

  get pause(): PauseState {
    return this.freeze?.state ?? NOT_PAUSED;
  }

  onPause(listener: (state: PauseState) => void): () => void {
    return this.freeze ? this.freeze.onChange(listener) : () => undefined;
  }

  background(): void {
    if (this.closed || this.finished) return;
    this.freeze?.background();
  }

  foreground(): void {
    if (this.closed) return;
    this.freeze?.foreground();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.freeze?.close();
    this.detachBot();
    this.unsubscribe();
    this.local.close();
    if (!this.finished)
      this.write('could not mark the game interrupted', async () => {
        await this.repo!.markInterrupted(this.id);
      });
  }

  async flush(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = this.tail;
      await seen;
    } while (seen !== this.tail);
  }

  // -----------------------------------------------------------------------------------------------------

  private onUpdate(update: HostUpdate): void {
    if (update.kind !== 'events') return;
    this.save();
    if (!this.finished && update.events.some((e) => e.type === 'gameOver')) this.finish();
  }

  /** The bot leaves the table: it never acts again, and its timers are cleared. */
  private detachBot(): void {
    const bot = this.bot;
    this.bot = null;
    bot?.detach();
  }

  private finish(): void {
    const state = this.local.state;
    const result = state.result;
    if (!result) return;
    this.finished = true;
    this.detachBot();
    this.freeze?.end();
    const endedAt = state.endedAt ?? this.clock.now();
    this.write('could not save the end of the game', async () => {
      await this.repo!.finishGame(this.id, { result, endedAt });
    });
    // Nothing here stops the end (the XP below, the saved finish above): a failure is reported.
    try {
      this.track('game_end', gameEndProps(this.mode, result, this.playerId));
    } catch (error) {
      this.onError('could not track the end of the game', error);
    }
    try {
      this.onFinish?.({
        id: this.id,
        mode: this.mode,
        gameType: this.gameType,
        playerId: this.playerId,
        result,
        endedAt,
      });
    } catch (error) {
      this.onError('could not report the end of the game', error);
    }
  }

  /** Queues the events not on disk yet; updates that come while a write runs join one batch. */
  private save(): void {
    if (!this.saving || this.saveQueued) return;
    this.saveQueued = true;
    this.write('could not save the game events', async () => {
      this.saveQueued = false;
      const batch = this.local.events.slice(this.saved);
      if (!batch.length) return;
      await this.repo!.appendEvents(this.id, batch);
      this.saved += batch.length;
    });
  }

  /** Runs a write after the ones before it; errors are reported, never thrown at the game. */
  private write(what: string, task: () => Promise<void>): void {
    this.tail = this.tail.then(async () => {
      if (!this.saving) return;
      try {
        await task();
      } catch (error) {
        this.onError(what, error);
      }
    });
  }
}
