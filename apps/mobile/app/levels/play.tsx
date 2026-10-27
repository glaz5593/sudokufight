import {
  type AppLevel,
  attemptLevel,
  chapterStars,
  isTapKind,
  LEVEL_RULES,
  levelEngineOf,
} from '@sudoku-fight/engine';
import type { LevelTutorialKind } from '@sudoku-fight/protocol';
import { type Href, router, Stack, useLocalSearchParams } from 'expo-router';
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';

import { ResumeCountdown } from '../../src/components/board/ResumeCountdown';
import { LEVEL_UI } from '../../src/config/levels';
import { gameEndConfig } from '../../src/config/gameEnd';
import { levelRulesNow, useUnlockAllLevels } from '../../src/config/testing';
import { levelAttemptOf } from '../../src/levels/appLevels';
import {
  type LevelSession,
  type LevelSessionDeps,
  type PauseState,
  startLevel,
} from '../../src/levels/levelSession';
import { levelById } from '../../src/levels/levelsData';
import { useLevelsProgress, useOpenedChapters } from '../../src/levels/levelsStore';
import { crashReporter } from '../../src/services/crashlytics';
import { color } from '../../src/theme';
import { FlowFallback } from '../../src/screens/FlowFallback';
import { GameScreen } from '../../src/screens/game/GameScreen';
import { HowToPlay, tutorialFor, useTutorials } from '../../src/screens/levels/HowToPlay';
import { renderTutorialPanel } from '../../src/screens/levels/HowToPlayPanels';
import { levelChrome, levelPlayedOf } from '../../src/screens/levels/levelChrome';
import { PuzzleLevelScreen } from '../../src/screens/levels/PuzzleLevelScreen';
import { TapLevelScreen } from '../../src/screens/levels/TapLevelScreen';
import {
  type LevelPlayed,
  LevelResultView,
  type ResultChapter,
} from '../../src/screens/levels/LevelResultView';
import { everyChapter, nextAfterAttempt, withAttempt } from '../../src/screens/levels/mapModel';
import { ReadyView } from '../../src/screens/levels/ReadyView';

/**
 * /levels/play?id=L037&quick=1: one stage, in phases of this one route (components.md §19.8–§19.10): "איך
 * משחקים" before the first stage of a kind (or the first boss), "מוכן?" (LEVEL_UI.readyMs, no board yet), the
 * stage itself, and its result, a state of the same screen (no navigation at a stage's end: the black screen of
 * 1.0.0 came with those). The result's "לשלב הבא" starts the next stage right here (the quick entry, D56;
 * LEVEL_UI.quickEntry off: back to the map with it chosen), "שוב" plays this one again (the session plays an
 * equivalent board from the second attempt, D63), "למפה" goes back to the map.
 *
 * The `playing` phase is the stage screens' (the tap kinds' screen, the puzzle's, the game screen with a stage's
 * chrome): they fill `Playing` (LevelPlayingProps), report the end once with what the result shows
 * (LevelPlayed), and call onLeave for a way out with no end. Never an empty screen: no stage to play, a
 * fallback; a way out that did not leave in time (the watchdog), the fallback's actions, reported.
 *
 * [D76] The attempt's number is read once, as the run starts (before "איך משחקים" and "מוכן?"): "מוכן?" shows
 * the board that attempt plays (attemptLevel: its digit, its region), and the session plays the very same
 * attempt. A read that fails, or does not answer within ATTEMPT_READ_MS: attempt 1 for both.
 */

/** What the `playing` phase gets: the stage, and the two ways out of it. */
export interface LevelPlayingProps {
  /** The stage as stored (levelsData); the session plays its attempt's board (attemptLevel). */
  level: AppLevel;
  /** Started from a result's "לשלב הבא" (level_start's `quick`). */
  quick: boolean;
  /** The stage ended (any end, the X confirmed included), once: the result shows in this route. */
  onFinished: (played: LevelPlayed) => void;
  /**
   * [D76] The attempt's number as the run read it before "מוכן?" (never rejects): the session plays this one, so
   * it always agrees with what "מוכן?" showed. Left out: the session reads it itself.
   */
  attempt?: Promise<number>;
  /**
   * Out with no end (nothing could start): back to the map. Call it only once every window of the stage (its
   * exit dialog) has left the screen.
   */
  onLeave: () => void;
}

export default function LevelPlayRoute() {
  return <LevelPlayFlow Playing={LevelStage} renderTutorialPanel={renderTutorialPanel} />;
}

export interface LevelStageProps extends LevelPlayingProps {
  /** The session's dependencies (a test's clock and scheduler); the app's by default. */
  deps?: LevelSessionDeps;
  /** How long the stage may take to start (levels.db's attempt) before a way out shows in place of the blank. */
  startWatchdogMs?: number;
}

const NOT_PAUSED: PauseState = { kind: 'none' };

/**
 * The `playing` phase (work plan 2ח): starts the attempt's session (levelSession: its board, host, bot and
 * level_start), plays it on the tap stages' screen (find, the race; spot the error) or on the game screen with
 * the stage's chrome (fill the box, the duel; the ideas' digit kinds), and hands the stored end to the result.
 * The session is closed when this phase goes (before the end: not played, level_quit). [D65] The session
 * freezes the stage while the app is away; this draws its countdown over the covered board.
 */
export function LevelStage({
  level,
  quick,
  onFinished,
  onLeave,
  attempt,
  deps,
  startWatchdogMs = gameEndConfig.resultsWatchdogMs,
}: LevelStageProps) {
  const { t, i18n } = useTranslation('levels');
  const [session, setSession] = useState<LevelSession | null>(null);
  const [failed, setFailed] = useState(false);
  // A start that does not come (levels.db that does not answer): a way out to the map, not a blank for good.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (session || failed) return;
    const timer = setTimeout(() => setSlow(true), startWatchdogMs);
    return () => clearTimeout(timer);
  }, [session, failed, startWatchdogMs]);
  const startDeps = useRef(deps);
  // The run's attempt (read before "מוכן?"), unless the dependencies bring their own reader (the tests).
  const runAttempt = useRef(attempt);
  useEffect(() => {
    let live = true;
    let made: LevelSession | null = null;
    const read = runAttempt.current;
    const given = startDeps.current;
    const sessionDeps: LevelSessionDeps | undefined =
      read && !given?.attemptOf ? { ...given, attemptOf: () => read } : given;
    startLevel(level, { quick }, sessionDeps).then(
      (s) => {
        if (!live) return s.close();
        made = s;
        setSession(s);
      },
      (error: unknown) => {
        crashReporter().recordError(error, 'levels: the stage did not start');
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
      made?.close();
    };
  }, [level, quick]);

  const onPause = useCallback(
    (changed: () => void) => (session ? session.onPause(changed) : () => undefined),
    [session],
  );
  const pause: PauseState = useSyncExternalStore(onPause, () => session?.pause ?? NOT_PAUSED);

  // The stage's end, once stored: the result.
  const lang = i18n.language;
  const onOver = useCallback(() => {
    if (!session) return;
    void session.result.then((r) => onFinished(levelPlayedOf(session, r, lang)));
  }, [session, lang, onFinished]);

  const covered = pause.kind === 'none' ? null : pause;
  const cover = useMemo(() => <ResumeCountdown state={covered} />, [covered]);
  const chrome = useMemo(
    () =>
      session
        ? levelChrome(session.played, t, { onOver, cover, covered: covered !== null, rules: session.rules })
        : null,
    [session, t, onOver, cover, covered],
  );

  if (failed) return <FlowFallback reason={`levels/play: ${level.id} did not start`} onHome={onLeave} />;
  if (!session) {
    if (slow)
      return (
        <FlowFallback
          reason={`levels/play: ${level.id} did not start in time`}
          actionsAfterMs={0}
          onHome={onLeave}
        />
      );
    return <View style={styles.starting} testID="level-stage-starting" />;
  }
  if (isTapKind(session.played.kind))
    return <TapLevelScreen session={session} onOver={onOver} onLeave={onLeave} />;
  // 1.0.3 (levels-ui.md §4.6): the puzzle has a screen of its own, neither the tap screen nor the game screen.
  if (levelEngineOf(session.played.kind) === 'puzzle')
    return <PuzzleLevelScreen session={session} onOver={onOver} onLeave={onLeave} />;
  if (!chrome) return <FlowFallback reason={`levels/play: no screen for ${level.kind}`} onHome={onLeave} />;
  // "לבית" of the game screen's fallbacks (the results watchdog, no seat) leaves the stage, to the map.
  return (
    <GameScreen session={session} onEnded={onOver} onHome={onLeave} level={chrome} testID="level-game" />
  );
}

/** [D65] The app is in the foreground (any other AppState freezes the stage, "מוכן?" included). */
function useAppActive(): boolean {
  const [active, setActive] = useState(
    () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

export interface LevelPlayFlowProps {
  Playing: ComponentType<LevelPlayingProps>;
  /** "איך משחקים"'s pictures (HowToPlayPanels); the kind's mark until then. */
  renderTutorialPanel?: (kind: LevelTutorialKind, index: number) => ReactNode;
  /** Reads an attempt's number at the level's rev (levels.db: the attempts, plus one); levelAttemptOf by default. */
  attemptOf?: (levelId: string, rev: number) => Promise<number>;
}

/**
 * [D76] How long the run waits for the attempt's number before "מוכן?" counts down with attempt 1 (levels.db
 * that does not answer; it usually answers within a tenth of a second). The session then plays attempt 1 too.
 */
export const ATTEMPT_READ_MS = 1500;

/** The attempt's number, read once for the run: a valid answer, else 1 (an error, a bad value, no answer). */
export function readRunAttempt(
  levelId: string,
  attemptOf: (levelId: string) => Promise<number>,
  timeoutMs: number = ATTEMPT_READ_MS,
): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (n: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(Number.isInteger(n) && n >= 1 ? n : 1);
    };
    const timer = setTimeout(() => settle(1), timeoutMs);
    try {
      attemptOf(levelId).then(settle, (error: unknown) => {
        console.warn('[levels] could not read the attempt', error);
        settle(1);
      });
    } catch (error) {
      console.warn('[levels] could not read the attempt', error);
      settle(1);
    }
  });
}

/** The board an attempt plays, for "מוכן?" (the session plays the same: attemptLevel, the same rules). */
function playedOf(level: AppLevel, attempt: number): AppLevel {
  try {
    return attemptLevel(level, attempt, levelRulesNow());
  } catch (error) {
    console.warn('[levels] could not prepare the attempt', error);
    return level;
  }
}

interface Run {
  id: string;
  quick: boolean;
  /** Counts the runs of this route: "שוב" and "לשלב הבא" start a new one. */
  n: number;
}

const toMap = () => router.dismissTo('/levels');
const home = () => router.replace('/');

/** The route's flow, with its `playing` phase given (the tests give a stand-in). */
export function LevelPlayFlow({
  Playing,
  renderTutorialPanel,
  attemptOf = levelAttemptOf,
}: LevelPlayFlowProps) {
  const params = useLocalSearchParams<{ id?: string; quick?: string }>();
  const [run, setRun] = useState<Run>(() => ({ id: params.id ?? '', quick: params.quick === '1', n: 0 }));
  const [leaving, setLeaving] = useState(false);
  const [stuck, setStuck] = useState(false);

  // The watchdog: a way out asked for, and this screen still here after the results' time.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      crashReporter().recordError(new Error('the level route did not leave'), 'levels: leave watchdog');
      setStuck(true);
    }, gameEndConfig.resultsWatchdogMs);
    return () => clearTimeout(timer);
  }, [leaving]);

  const leave = (href: Href = '/levels') => {
    setLeaving(true);
    if (href === '/levels') toMap();
    else router.dismissTo(href);
  };

  const start = (id: string, quick: boolean) => {
    router.setParams({ id, quick: quick ? '1' : undefined });
    setRun((r) => ({ id, quick, n: r.n + 1 }));
  };

  const level = stageOf(run.id);
  if (stuck)
    return <FlowFallback reason="levels: the route did not leave" actionsAfterMs={0} onHome={home} />;
  if (!level) return <FlowFallback reason={`levels/play: no stage ${run.id}`} onHome={home} />;
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <StageRun
        key={`${run.id}:${run.n}`}
        level={level}
        quick={run.quick}
        Playing={Playing}
        renderTutorialPanel={renderTutorialPanel}
        attemptOf={attemptOf}
        onNext={(next) => {
          if (LEVEL_UI.quickEntry) start(next, true);
          else leave({ pathname: '/levels', params: { select: next } });
        }}
        onAgain={() => start(level.id, false)}
        onMap={() => leave()}
      />
    </>
  );
}

/** The stage of an id, or none (a link to a stage that does not exist; a data file that cannot be read). */
function stageOf(id: string): AppLevel | null {
  try {
    return levelById(id) ?? null;
  } catch (error) {
    console.warn('[levels] the stages could not be read', error);
    return null;
  }
}

type Phase =
  | { kind: 'tutorial'; tutorial: LevelTutorialKind }
  | { kind: 'ready' }
  | { kind: 'playing' }
  | { kind: 'result'; played: LevelPlayed };

interface StageRunProps {
  level: AppLevel;
  quick: boolean;
  Playing: ComponentType<LevelPlayingProps>;
  renderTutorialPanel?: LevelPlayFlowProps['renderTutorialPanel'];
  attemptOf: (levelId: string, rev: number) => Promise<number>;
  onNext: (id: string) => void;
  onAgain: () => void;
  onMap: () => void;
}

/** One attempt: its phases, from the card or "מוכן?" to the result. */
function StageRun({
  level,
  quick,
  Playing,
  renderTutorialPanel,
  attemptOf,
  onNext,
  onAgain,
  onMap,
}: StageRunProps) {
  const [phase, setPhase] = useState<Phase>(() => {
    const tutorial = tutorialFor(level, useTutorials.getState().seen);
    return tutorial ? { kind: 'tutorial', tutorial } : { kind: 'ready' };
  });
  // [D76] The attempt, read once as the run starts: "מוכן?" and the session both take it from here.
  const [attemptRead] = useState(() => readRunAttempt(level.id, (id) => attemptOf(id, level.rev)));
  const [attempt, setAttempt] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void attemptRead.then((n) => {
      if (live) setAttempt(n);
    });
    return () => {
      live = false;
    };
  }, [attemptRead]);
  const readyPlayed = useMemo(() => (attempt === null ? null : playedOf(level, attempt)), [level, attempt]);
  const records = useLevelsProgress() ?? NO_RECORDS;
  const opened = useOpenedChapters();
  // A staging build's "פתח את כל השלבים (בדיקה)": "לשלב הבא" goes on past a closed gate too.
  const unlockAll = useUnlockAllLevels();
  const finishedOnce = useRef(false);
  // [D65] "מוכן?"'s 2 s stand still while the app is away (LEVEL_UI.backgroundPause).
  const active = useAppActive();

  if (phase.kind === 'tutorial') {
    return (
      <HowToPlay
        kind={phase.tutorial}
        level={level}
        renderPanel={renderTutorialPanel}
        onDone={() => setPhase({ kind: 'ready' })}
      />
    );
  }
  if (phase.kind === 'ready')
    return (
      <ReadyView
        level={level}
        played={readyPlayed}
        paused={LEVEL_UI.backgroundPause && !active}
        onDone={() => setPhase({ kind: 'playing' })}
      />
    );
  if (phase.kind === 'playing') {
    return (
      <Playing
        level={level}
        quick={quick}
        attempt={attemptRead}
        onFinished={(played) => {
          if (finishedOnce.current) return;
          finishedOnce.current = true;
          setPhase({ kind: 'result', played });
        }}
        onLeave={onMap}
      />
    );
  }
  const { played } = phase;
  const openedNow =
    played.finished?.gateOpened && !opened.includes(level.chapter + 1)
      ? [...opened, level.chapter + 1]
      : opened;
  const next = nextAfterAttempt(level.id, records, unlockAll ? everyChapter() : openedNow, played.outcome);
  return (
    <LevelResultView
      level={level}
      played={played}
      chapter={resultChapter(level, played, records)}
      next={next}
      onNext={() => next && onNext(next)}
      onAgain={onAgain}
      onMap={onMap}
    />
  );
}

const NO_RECORDS = {};

const styles = StyleSheet.create({
  starting: { flex: 1, backgroundColor: color.bg },
});

/** The result's chapter line: what levels.db gave back (the gate after this attempt), else none. */
function resultChapter(
  level: AppLevel,
  played: LevelPlayed,
  records: Parameters<typeof withAttempt>[0],
): ResultChapter | null {
  if (!played.finished) return null;
  const max = LEVEL_RULES.chapterSize * 3;
  const gate = played.finished.gate;
  if (gate) return { stars: gate.stars, max, gate };
  return {
    stars: chapterStars(level.chapter, withAttempt(records, level.id, played.outcome)),
    max,
    gate: null,
  };
}
