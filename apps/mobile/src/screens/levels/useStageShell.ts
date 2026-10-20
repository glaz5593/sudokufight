import type { GameView } from '@sudoku-fight/engine';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler } from 'react-native';

import { gameEndConfig } from '../../config/gameEnd';
import { useNow } from '../../game/useNow';
import type { LevelSession, PauseState } from '../../levels/levelSession';
import { crashReporter } from '../../services/crashlytics';
import { cue } from '../../services/feedback';
import { useLiveAnnouncer } from '../game/useLiveAnnouncer';

/**
 * What every stage screen of its own does around its board (levels-ui.md §4.6; a copy of TapLevelScreen's
 * shell, 1.0.3 lane UI-3): the host's picture re-read on every update and the stage's clock between them; the
 * D65 freeze as the session draws it; timers of the screen, all cancelled when it goes; the live region; the X
 * and Android back asking "לצאת מהשלב?"; and the end: held on the last picture, then the result from a timer
 * once the dialog is gone (never inside a press or an update), with a way on over everything if the result does
 * not replace the screen after the watchdog's time.
 *
 * PuzzleLevelScreen uses it. TapLevelScreen and GameScreen still keep their own copy; moving them onto this hook
 * is a separate step after the 1.0.3 lanes (levels-ui.md §11, owner UI-1).
 */

export interface StageShellOptions {
  session: LevelSession;
  /** The stage is over and its last picture held: its result. */
  onOver: () => void;
  /** How long the result may take to replace the screen before the fallback shows. */
  resultsWatchdogMs?: number;
}

export interface StageShell {
  /** The host's picture, as of its last update. */
  view: GameView;
  /** The stage's clock now (ticks while it runs; never before the picture was read). */
  now: number;
  running: boolean;
  /** [D65] The freeze as the session draws it. */
  pause: PauseState;
  /** The freeze while it covers the board; null when it does not. */
  covered: Exclude<PauseState, { kind: 'none' }> | null;
  /** Runs `fn` after `ms`, unless the screen has gone by then. */
  later: (ms: number, fn: () => void) => void;
  /** The live region's text, and how to add a line to it. */
  message: string;
  announce: (line: string) => void;
  /** The exit dialog ("לצאת מהשלב?"). */
  confirmOpen: boolean;
  openConfirm: () => void;
  closeConfirm: () => void;
  /** The dialog's "יציאה": the stage ends 'quit'. */
  confirmExit: () => void;
  /** The dialog has left the screen (ConfirmModal's onExited). */
  onDialogExited: () => void;
  /** The stage is over: hold its last picture `holdMs`, then the result (once; after the dialog is gone). */
  finish: (holdMs: number) => void;
  /** finish() was called. */
  isEnded: () => boolean;
  /** The result was asked for and did not come: the fallback shows. */
  stuck: boolean;
  /** The fallback's "לתוצאות": ask for the result again. */
  retryResult: () => void;
}

/** How often the clock re-renders. */
const TICK_MS = 250;

/** An error the game survives: reported (and shown in development), never thrown on. */
export function survive(error: unknown, context: string): void {
  if (__DEV__) console.warn(`[levels] ${context}`, error);
  crashReporter().recordError(error, `levels: ${context}`);
}

/** Runs a move of the screen; an error is reported and the screen goes on. */
export function safely(context: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    survive(error, context);
  }
}

export function useStageShell({
  session,
  onOver,
  resultsWatchdogMs = gameEndConfig.resultsWatchdogMs,
}: StageShellOptions): StageShell {
  const { t } = useTranslation('levels');

  // ---- the host's picture, re-read on every update ----
  const [{ view, readAt }, setShown] = useState<{ view: GameView; readAt: number }>(() => ({
    view: session.getView(),
    readAt: session.clock.now(),
  }));
  useEffect(
    () => session.subscribe(() => setShown({ view: session.getView(), readAt: session.clock.now() })),
    [session],
  );
  const running = view.status === 'running';
  const ticked = useNow(TICK_MS, { clock: session.clock, enabled: running });
  const now = Math.max(ticked, readAt);

  // [D65] The freeze as the session draws it.
  const onPause = useCallback((changed: () => void) => session.onPause(changed), [session]);
  const pause: PauseState = useSyncExternalStore(onPause, () => session.pause);

  // ---- timers of this screen, all cancelled when it goes ----
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const { message, announce } = useLiveAnnouncer(t('board:separator.list'));

  // ---- the end: held, then onOver from a timer, never while the dialog is still on the screen ----
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialogUp = useRef(false);
  const whenDialogGone = useRef<(() => void) | null>(null);
  const ended = useRef(false);
  const [stuck, setStuck] = useState(false);
  /** onOver, watched: the result should replace this screen (and its timers) before the watchdog fires. */
  const toResult = useCallback(() => {
    safely('the result', onOver);
    later(resultsWatchdogMs, () => {
      crashReporter().recordError(
        new Error('the stage result did not replace the board'),
        'levels: results watchdog',
      );
      setStuck(true);
    });
  }, [later, onOver, resultsWatchdogMs]);
  const finish = useCallback(
    (holdMs: number) => {
      if (ended.current) return;
      ended.current = true;
      setConfirmOpen(false);
      const go = () => later(holdMs, toResult);
      if (dialogUp.current) whenDialogGone.current = go;
      else go();
    },
    [later, toResult],
  );
  const isEnded = useCallback(() => ended.current, []);
  const onDialogExited = useCallback(() => {
    dialogUp.current = false;
    const next = whenDialogGone.current;
    whenDialogGone.current = null;
    next?.();
  }, []);
  const retryResult = useCallback(() => {
    setStuck(false);
    toResult();
  }, [toResult]);

  // ---- the X and Android back ----
  const openConfirm = useCallback(() => {
    if (ended.current) return;
    dialogUp.current = true;
    setConfirmOpen(true);
  }, []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const confirmExit = useCallback(() => {
    setConfirmOpen(false);
    cue('surrender');
    safely('quit', () => session.quit());
  }, [session]);
  // Android back asks first, like the X (an open dialog handles back itself).
  const back = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    back.current = () => {
      if (running && pause.kind === 'none') openConfirm();
    };
  });
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  return {
    view,
    now,
    running,
    pause,
    covered: pause.kind === 'none' ? null : pause,
    later,
    message,
    announce,
    confirmOpen,
    openConfirm,
    closeConfirm,
    confirmExit,
    onDialogExited,
    finish,
    isEnded,
    stuck,
    retryResult,
  };
}
