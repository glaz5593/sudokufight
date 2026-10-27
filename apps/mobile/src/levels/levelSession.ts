import {
  type AppLevel,
  type AppLevelOf,
  attachBot,
  attemptLevel,
  type BotHandle,
  type BotLevelId,
  botPlayer,
  type CellIndex,
  type Clock,
  createRng,
  explain,
  type GameMode,
  type GameView,
  type HostUpdate,
  isTapKind,
  levelBotConfig,
  type LevelEndOf,
  levelEngineOf,
  levelGameConfig,
  levelModeFor,
  levelOutcome,
  type LevelOutcome,
  type LevelRules,
  type LevelView,
  levelNumber,
  LocalFindHost,
  LocalGameHost,
  LocalPuzzleHost,
  parseGrid,
  puzzleConflictsOn,
  REACTIONS,
  type Scheduler,
} from '@sudoku-fight/engine';
import type { GameHost } from '@sudoku-fight/protocol';
import { AppState } from 'react-native';

import { LEVEL_UI, type LevelUiSettings } from '../config/levels';
import { levelRulesNow } from '../config/testing';
import { type AppStateSource, BackgroundPause, type PauseState } from '../game/backgroundPause';
import { guardedScheduler, systemClock, timeoutScheduler } from '../game/clock';
import { botSeedOf, ME } from '../game/session';
import i18n from '../i18n';
import { closeSentence } from '../i18n/compose';
import { formatBlock, formatExplanation } from '../i18n/explain';
import { type AnalyticsEventName, type AnalyticsProps, track as defaultTrack } from '../services/analytics';
import { crashReporter } from '../services/crashlytics';
import { levelQuitProps, levelStartProps } from './analyticsProps';
import { levelAttemptOf, type LevelFinished, levelFinished, type LevelFinisher } from './appLevels';
import { allLevels } from './levelsData';
import { useLevels } from './levelsStore';

/**
 * One attempt at a stage on the phone (1.0.2; dev-plan §2ח): the stage's host, its bot, its start and its end.
 * The screens talk to `host` (the GameHost interface) and never to the engine, as in a practice:
 *
 * - The attempt's number comes from levels.db (levelAttemptOf: the attempts at the level's rev, plus one), and from
 *   the second attempt on the stage is played on an equivalent board (attemptLevel: transformLevel while
 *   LEVEL_RULES.replayTransform is on) [D63]. Its stars rule, limits and bot are the stored stage's.
 * - A digit kind (fillBox, duel, and the ideas' pointHunter, chain) runs in a LocalGameHost with the stage's
 *   game (levelGameConfig: mode 'solo' or 'bot', its rules, `config.level`); a duel's bot is the engine's
 *   (attachBot) at the stage's final pace (levelBotConfig: a boss's ×0.9 is already in it), with dice from the
 *   game's seed, which is the stage's and the attempt's. It never interferes: a stage has none [D49].
 * - A tap kind (find, findDuel, spotError) runs in a LocalFindHost: the race's bot lives inside the tap engine
 *   (its plan drawn from the stage and the attempt), so nothing is attached.
 * - The stage's rules are LEVEL_RULES as it starts (levelRulesNow): a staging build's switch plays a chain under
 *   chainNotYet 'penalty' [D64, waiting for Moshe], so flipping it changes the next chain stage only.
 * - `level_start` goes once, as the stage starts (after "מוכן?" or "איך משחקים"), with the attempt, the best
 *   stars so far and `quick` (a result's "לשלב הבא").
 * - The end (any end: the X confirmed too, `quit`, which counts as played with 0 stars per LEVEL_RULES) is
 *   stored once (levelFinished: levels.db, the sync, level_end and chapter_gate), and `result` resolves with it.
 * - close() before the end: the attempt does not count (nothing is stored), and `level_quit` says so.
 * - [D65] The app leaving the foreground (any AppState but 'active': a phone call, another app, the screen
 *   off) freezes the stage: host.pause() stops its clock, its time limit, the locks, the race's freezes and the
 *   bot. Back to 'active': a 3, 2, 1 countdown (LEVEL_UI.resumeCountdownMs) over the covered board (the screens
 *   draw `pause`), then host.resume(), from the very same point. LEVEL_UI.backgroundPause off: no freeze. The
 *   freeze is game/backgroundPause.ts, which a solo practice and a practice against a bot share.
 *
 * A stage never touches practice.db, the practice session, its XP queue or game_start / game_end [D58]. Errors
 * of the way (storage, telemetry) are reported, never thrown at the screens.
 */

/** How a stage ended, as its host gives it: the game engine's result, the tap engine's or the puzzle's levelOver. */
export type LevelEnd = LevelEndOf;

/** [D65] The stage's freeze as the screens draw it, and the AppState it listens to (game/backgroundPause.ts). */
export type { AppStateSource, PauseState };

/** The stage's end, once stored: what the result screen shows (screens/levels/LevelResultView). */
export interface LevelFinishResult {
  end: LevelEnd;
  /** The engine's reading of the end (levelOutcome of the stored stage). */
  outcome: LevelOutcome;
  /** What levels.db kept (null: nobody signed in, or no database). */
  finished: LevelFinished | null;
  /** My mistakes: wrong digits or wrong taps (a race's freeze is no time penalty, so it is counted here). */
  mistakes: number;
  /** The cells I tapped wrongly, in order (a tap stage's "למה?"). */
  wrongTaps: readonly CellIndex[];
  /** The final picture. */
  view: GameView;
}

export interface LevelStartOptions {
  /** Started by a result's "לשלב הבא" (level_start's `quick`). */
  quick?: boolean;
}

export interface LevelSessionDeps {
  clock?: Clock;
  scheduler?: Scheduler;
  /** The player on this phone; ME by default. */
  playerId?: string;
  /** The attempt's number at the level's rev (levels.db); levelAttemptOf by default. */
  attemptOf?: (levelId: string, rev: number) => Promise<number>;
  /** My best stars at the stage so far (level_start); the levels store's by default. */
  bestStarsOf?: (levelId: string) => number;
  /** Stores the end; the app's levelFinished by default. */
  finish?: LevelFinisher;
  track?: (name: AnalyticsEventName, props: AnalyticsProps) => void;
  /** Where errors of the way go (telemetry, the end's storage); console.warn by default. */
  onError?: (what: string, error: unknown) => void;
  /** An error out of one of the stage's timers: reported, never thrown at React Native. Crashlytics by default. */
  onTimerError?: (error: unknown) => void;
  /** [D65] The app's foreground state; React Native's AppState by default, null for none. */
  appState?: AppStateSource | null;
  settings?: Pick<LevelUiSettings, 'backgroundPause' | 'resumeCountdownMs' | 'reactions' | 'worthHintLevels'>;
  /** Where a stage stands among the stages of its kind (0 for the first); the levels' data by default. */
  kindOrdinalOf?: (level: AppLevel) => number;
  /** The stages' rules; levelRulesNow() by default (LEVEL_RULES, and a staging build's switches). */
  rules?: LevelRules;
}

export interface LevelSession {
  readonly id: string;
  /** The stage as stored (levelsData): its stars rule, what is recorded. */
  readonly level: AppLevel;
  /** The stage as this attempt plays it: the stored board on attempt 1, an equivalent one after [D63]. */
  readonly played: AppLevel;
  readonly attempt: number;
  readonly quick: boolean;
  /** The rules this attempt plays by (a chain's chainNotYet [D64]: its HUD says what a guess costs). */
  readonly rules: LevelRules;
  readonly mode: Extract<GameMode, 'solo' | 'bot'>;
  /** The race's or the duel's bot; null alone. */
  readonly botLevel: BotLevelId | null;
  /** What the screens talk to. */
  readonly host: GameHost;
  /** The clock the stage runs on: the countdowns compare its time with the view's deadlines. */
  readonly clock: Clock;
  readonly playerId: string;
  getView(): GameView;
  subscribe(onUpdate: (update: HostUpdate) => void): () => void;
  /** GameView.level: the stage's clock, its marks, its progress (and level.find in a tap stage). */
  levelView(): LevelView | null;
  /** A tap stage's move. */
  tap(cell: CellIndex): void;
  /**
   * A puzzle stage's move (1.0.3, levels-ui.md §4.3): swap the boxes at two places (0–8, row-major, LTR) through
   * the host (GameHost.swapBoxes). The engine decides everything: a fixed box is refused ('boxFixed'), a wrong
   * swap costs its penalty, the right arrangement ends the stage. Any other stage's host refuses it.
   */
  swap(from: number, to: number): void;
  /** The X, confirmed: the stage ends 'quit' (0 stars; it counts as played, LEVEL_RULES.quitCountsAsPlayed). */
  quit(): void;
  /** The game screen's end (its confirmed dialog): the X's quit. */
  endPractice(): void;
  /** [D65] The freeze as the screens draw it. */
  readonly pause: PauseState;
  /** Called on every change of `pause`; returns the unsubscribe function. */
  onPause(listener: (state: PauseState) => void): () => void;
  /** [D65] The app went to the background: the stage freezes (no-op once over, or with backgroundPause off). */
  background(): void;
  /** [D65] The app is active again: the countdown, then the stage goes on. */
  foreground(): void;
  /** The end as the host gave it; null while it runs. */
  readonly over: LevelEnd | null;
  /** Resolves once, when the end is stored (or could not be: then `finished` is null). */
  readonly result: Promise<LevelFinishResult>;
  /** Stops the stage, its timers and the bot. Before the end: not played, `level_quit`. */
  close(): void;
}

/** An error out of a stage's timer, on the phone: kept with the crash reports (and shown in development). */
function reportTimerError(error: unknown): void {
  if (__DEV__) console.warn('[levels] a stage timer failed', error);
  crashReporter().recordError(error, 'levels: tick');
}

const bestStarsInStore = (levelId: string): number => useLevels.getState().progress[levelId]?.stars ?? 0;

/** How many stages of the same kind come before this one, in the levels' data. */
function kindOrdinalInData(level: AppLevel): number {
  const n = levelNumber(level.id) ?? 0;
  return allLevels().filter((l) => l.kind === level.kind && (levelNumber(l.id) ?? 0) < n).length;
}

/**
 * The point hunter's "שווה 6" (the view's selectedWorth) in the kind's first LEVEL_UI.worthHintLevels stages:
 * the setting decides, whatever the data says. Any other kind is played as it is.
 */
function withWorthHint(played: AppLevel, ordinal: () => number, hintLevels: number): AppLevel {
  if (played.kind !== 'pointHunter') return played;
  const worthHint = ordinal() < hintLevels;
  if ((played.worthHint === true) === worthHint) return played;
  const { worthHint: _data, ...rest } = played;
  return worthHint ? { ...rest, worthHint: true } : rest;
}

/**
 * Starts an attempt at `level` (the stored stage): reads its number, builds its host (and bot), starts it and
 * reports `level_start`. Call it when the stage's `playing` phase begins.
 */
export async function startLevel(
  level: AppLevel,
  { quick = false }: LevelStartOptions = {},
  deps: LevelSessionDeps = {},
): Promise<LevelSession> {
  const onError = deps.onError ?? ((what, error) => console.warn(`[levels] ${what}`, error));
  let attempt = 1;
  try {
    attempt = await (deps.attemptOf ?? levelAttemptOf)(level.id, level.rev);
  } catch (error) {
    onError('could not read the attempt', error);
  }
  if (!(Number.isInteger(attempt) && attempt >= 1)) attempt = 1;
  return new Session(level, attempt, quick, deps, onError);
}

class Session implements LevelSession {
  readonly id: string;
  readonly played: AppLevel;
  readonly rules: LevelRules;
  readonly mode: Extract<GameMode, 'solo' | 'bot'>;
  readonly botLevel: BotLevelId | null;
  readonly clock: Clock;
  readonly playerId: string;
  readonly result: Promise<LevelFinishResult>;

  private readonly scheduler: Scheduler;
  private readonly local: LocalGameHost | LocalFindHost | LocalPuzzleHost;
  private readonly track: (name: AnalyticsEventName, props: AnalyticsProps) => void;
  private readonly settings: NonNullable<LevelSessionDeps['settings']>;
  private readonly finishWith: LevelFinisher;
  private bot: BotHandle | null = null;
  private closed = false;
  private ended: LevelEnd | null = null;
  private startedAt = 0;
  private readonly wrongCells: CellIndex[] = [];
  private resolve!: (result: LevelFinishResult) => void;
  private readonly unsubscribe: () => void;
  private readonly freeze: BackgroundPause;

  constructor(
    readonly level: AppLevel,
    readonly attempt: number,
    readonly quick: boolean,
    deps: LevelSessionDeps,
    private readonly onError: (what: string, error: unknown) => void,
  ) {
    this.clock = deps.clock ?? systemClock;
    // The stage's timers (its clock, the bot's, the countdown) never throw out to React Native.
    this.scheduler = guardedScheduler(
      deps.scheduler ?? timeoutScheduler,
      deps.onTimerError ?? reportTimerError,
    );
    this.playerId = deps.playerId ?? ME;
    this.track = deps.track ?? defaultTrack;
    this.settings = deps.settings ?? LEVEL_UI;
    this.finishWith = deps.finish ?? levelFinished;
    this.result = new Promise((resolve) => {
      this.resolve = resolve;
    });

    // Read once, as the stage starts: a switch flipped meanwhile is for the next one.
    const rules = deps.rules ?? levelRulesNow();
    this.rules = rules;
    this.played = withWorthHint(
      attemptLevel(level, attempt, rules),
      () => (deps.kindOrdinalOf ?? kindOrdinalInData)(level),
      this.settings.worthHintLevels,
    );
    this.mode = levelModeFor(level);
    this.botLevel = this.mode === 'bot' ? (level.bot?.level ?? null) : null;
    this.id = `level-${level.id}-${this.clock.now().toString(36)}`;
    const player = { id: this.playerId };
    if (isTapKind(this.played.kind)) {
      this.local = new LocalFindHost({
        id: this.id,
        spec: this.played,
        player,
        attempt,
        clock: this.clock,
        scheduler: this.scheduler,
        rules,
        // D62: no reactions button in a stage, unless LEVEL_UI.reactions brings it back.
        reactions: this.settings.reactions ? REACTIONS : [],
        autoStart: false,
      });
    } else if (levelEngineOf(this.played.kind) === 'puzzle') {
      // 1.0.3 (levels-ui.md §4): the puzzle's own host, so a puzzle stage starts, freezes and ends (by its
      // limit or the X) like any other; its screen (PuzzleLevelScreen) moves the boxes with session.swap.
      this.local = new LocalPuzzleHost({
        id: this.id,
        spec: this.played as AppLevelOf<'puzzle'>,
        player,
        attempt,
        clock: this.clock,
        scheduler: this.scheduler,
        rules,
        conflicts: puzzleConflictsOn((deps.kindOrdinalOf ?? kindOrdinalInData)(level) + 1, rules),
        autoStart: false,
      });
    } else {
      const config = levelGameConfig(this.played, { id: this.id, player, attempt, rules });
      this.local = new LocalGameHost({
        config,
        playerId: this.playerId,
        clock: this.clock,
        scheduler: this.scheduler,
        autoStart: false,
      });
    }
    // [D65] Ready before the stage starts: its end (finish) takes the cover away.
    this.freeze = new BackgroundPause({
      host: this.local,
      scheduler: this.scheduler,
      settings: this.settings,
      appState: deps.appState === undefined ? AppState : deps.appState,
      onError: this.onError,
    });
    // Subscribed before any screen and before the bot, so the end is heard before anyone reacts to it.
    this.unsubscribe = this.local.subscribe((update) => this.onUpdate(update));

    this.startedAt = this.clock.now();
    this.local.dispatch({ type: 'start' });
    this.attachBotIfAny();
    this.report('level_start', () =>
      levelStartProps(level, {
        attempt,
        bestStars: (deps.bestStarsOf ?? bestStarsInStore)(level.id),
        quick,
      }),
    );
  }

  get host(): GameHost {
    return this.local;
  }

  get over(): LevelEnd | null {
    return this.ended;
  }

  get pause(): PauseState {
    return this.freeze.state;
  }

  getView(): GameView {
    return this.local.getView();
  }

  subscribe(onUpdate: (update: HostUpdate) => void): () => void {
    return this.local.subscribe(onUpdate);
  }

  levelView(): LevelView | null {
    return this.local.getView().level ?? null;
  }

  tap(cell: CellIndex): void {
    if (this.closed) return;
    this.local.tap(cell);
  }

  swap(from: number, to: number): void {
    if (this.closed) return;
    this.local.swapBoxes(from, to);
  }

  quit(): void {
    if (this.closed || this.ended) return;
    this.local.surrender();
  }

  endPractice(): void {
    this.quit();
  }

  onPause(listener: (state: PauseState) => void): () => void {
    return this.freeze.onChange(listener);
  }

  background(): void {
    if (this.closed || this.ended) return;
    this.freeze.background();
  }

  foreground(): void {
    if (this.closed) return;
    this.freeze.foreground();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.freeze.close();
    this.detachBot();
    const view = this.local.getView();
    this.unsubscribe();
    this.local.close();
    if (!this.ended) this.report('level_quit', () => levelQuitProps(this.level, view.level?.elapsedMs ?? 0));
  }

  // -----------------------------------------------------------------------------------------------------

  private attachBotIfAny(): void {
    if (!(this.local instanceof LocalGameHost) || this.mode !== 'bot' || !this.played.bot) return;
    if (this.local.state.status === 'over') return;
    const { level, pace } = this.played.bot;
    const seed = this.local.state.config.seed ?? 0;
    this.bot = attachBot(this.local, {
      botId: botPlayer(level).id,
      level,
      clock: this.clock,
      scheduler: this.scheduler,
      // The game's seed is the stage's and the attempt's: the first attempt always meets the same bot.
      rng: createRng(botSeedOf(seed)),
      config: levelBotConfig(pace),
    });
  }

  private detachBot(): void {
    const bot = this.bot;
    this.bot = null;
    bot?.detach();
  }

  private onUpdate(update: HostUpdate): void {
    if (update.kind !== 'events' || this.ended) return;
    for (const e of update.levelEvents ?? [])
      if (e.type === 'tapped' && !e.right && e.playerId === this.playerId) this.wrongCells.push(e.cell);
    const end = this.endOf(update);
    if (end) this.finish(end, update.view);
  }

  private endOf(update: Extract<HostUpdate, { kind: 'events' }>): LevelEnd | null {
    if (this.local instanceof LocalFindHost)
      return update.levelEvents?.some((e) => e.type === 'levelOver') ? this.local.over : null;
    if (this.local instanceof LocalPuzzleHost)
      return update.puzzleEvents?.some((e) => e.type === 'levelOver') ? this.local.over : null;
    return update.events.some((e) => e.type === 'gameOver') ? this.local.state.result : null;
  }

  private finish(end: LevelEnd, view: GameView): void {
    this.ended = end;
    this.detachBot();
    this.freeze.end();
    const outcome = levelOutcome(this.level, end);
    const me = view.players.find((p) => p.id === this.playerId);
    const mistakes = me?.mistakes ?? 0;
    const endedAt = this.clock.now();
    const done = (finished: LevelFinished | null) =>
      this.resolve({ end, outcome, finished, mistakes, wrongTaps: this.wrongCells.slice(), view });
    // Stored once; whatever fails on the way, the result still shows the end.
    this.finishWith({
      level: this.level,
      end,
      playerId: this.playerId,
      attempt: this.attempt,
      mistakes,
      quick: this.quick,
      startedAt: this.startedAt,
      endedAt,
    }).then(done, (error: unknown) => {
      this.onError('could not store the stage', error);
      done(null);
    });
  }

  private report(name: AnalyticsEventName, props: () => AnalyticsProps): void {
    try {
      this.track(name, props());
    } catch (error) {
      this.onError(`could not track ${name}`, error);
    }
  }
}

/**
 * A find stage's "למה?" (the result's, components.md §19.10): the engine's explanation of the target in its
 * scope ("ה־6 חייב להיות ב־E4 …"), and why my first wrong tap could not hold it, both worded in `lang` by
 * i18n/explain.ts (cell names already isolated in a right-to-left language). Null for any other kind (the ideas'
 * come with their screens) or when nothing explains.
 */
export function findWhy(played: AppLevel, wrongTaps: readonly CellIndex[], lang: string): string | null {
  if (played.kind !== 'find') return null;
  const { target } = played.targets;
  const cell = target.cell ?? target.accept[0];
  if (cell === undefined) return null;
  try {
    const grid = parseGrid(played.board.grid);
    const solution = parseGrid(played.board.solution);
    const unit = target.scope.kind === 'board' ? undefined : target.scope;
    const expl = explain(grid, cell, solution, { unit, digit: target.digit });
    const lines = [formatExplanation(expl, lang)];
    const tapped = wrongTaps.find((c) => !target.accept.includes(c));
    const last = expl.steps[expl.steps.length - 1];
    const blocked =
      tapped !== undefined && last?.technique === 'hiddenSingle'
        ? last.blocked.find((b) => b.cell === tapped)
        : undefined;
    if (tapped !== undefined && blocked)
      lines.push(closeSentence(formatBlock(tapped, blocked.block, target.digit, lang), i18n.getFixedT(lang)));
    return lines.join('\n');
  } catch {
    return null;
  }
}
