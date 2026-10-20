import type { PuzzleLevelOver } from '@sudoku-fight/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ResumeCountdown } from '../../components/board/ResumeCountdown';
import { PuzzleBoard, type PuzzleRefusal } from '../../components/levels/PuzzleBoard';
import { ConfirmModal } from '../../components/ui';
import { gameEndConfig } from '../../config/gameEnd';
import { LEVEL_UI, PUZZLE_UI } from '../../config/levels';
import type { LevelEffect } from '../../levels/levelEffects';
import type { LevelSession } from '../../levels/levelSession';
import { useLevelEffects } from '../../levels/useLevelEffects';
import { cue, preloadCues } from '../../services/feedback';
import { color, space, text, tokens } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import { FlowFallback } from '../FlowFallback';
import { boardSide } from '../game/geometry';
import { PuzzleHud, puzzleCountsText } from './hud/PuzzleHud';
import { levelEndDelayMs } from './levelChrome';
import { safely, useStageShell } from './useStageShell';

/**
 * The puzzle's screen (levels-ui.md §4; the Lv-Puzzle board; D70, D78): the HUD (PuzzleHud), the nine boxes
 * (PuzzleBoard, always LTR), and under them, where a keypad would be, how to move a box ("גרור ריבוע אל ריבוע
 * אחר", and with LEVEL_UI.puzzleTapSwap "או: הקש על ריבוע, ואז על ריבוע אחר"). The screen talks only to the
 * session's GameHost: a box dropped on another one is session.swap(from, to) (GameHost.swapBoxes), and what it
 * did comes back as the puzzle engine's events (levelEffectsOf): two boxes swapped (a wrong swap's "‎+5 ש׳" by
 * the clock, and "עוד 5 שניות" in the live region), a refusal ('boxFixed': the box goes home, the lock shakes),
 * and the end. It decides nothing: not whether a swap may be made, nor whether the puzzle is solved.
 *
 * Around the board, as every stage (useStageShell, a copy of TapLevelScreen's): the X and Android back ask
 * "לצאת מהשלב?" (0 stars), the D65 freeze covers the board and counts 3, 2, 1 back, a live region says each
 * swap, and the end holds the last picture (solved: every box's gold frame flashes) before onOver; if the result
 * does not replace this screen in time, a way on shows over everything.
 */

export interface PuzzleLevelScreenProps {
  session: LevelSession;
  /** The stage is over and its last picture held: its result. */
  onOver: () => void;
  /** Out of the stage (to the map): the way out when its result does not come (the watchdog's fallback). */
  onLeave: () => void;
  resultsWatchdogMs?: number;
  testID?: string;
}

/** The hold on a puzzle's last picture: solved, the gold flash and the board's usual hold; nothing for a quit. */
export function puzzleEndDelayMs(over: Pick<PuzzleLevelOver, 'reason'>, reduce: boolean): number {
  if (over.reason === 'quit') return 0;
  const hold = levelEndDelayMs('boardComplete', reduce);
  if (over.reason !== 'targetReached') return hold;
  return Math.max(hold, reduce ? PUZZLE_UI.solvedReducedMs : PUZZLE_UI.solvedFlashMs);
}

export function PuzzleLevelScreen({
  session,
  onOver,
  onLeave,
  resultsWatchdogMs = gameEndConfig.resultsWatchdogMs,
  testID = 'puzzle-level',
}: PuzzleLevelScreenProps) {
  const { t } = useTranslation('levels');
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const shell = useStageShell({ session, onOver, resultsWatchdogMs });
  const { view, now, running, pause, covered, announce, finish, isEnded } = shell;
  const level = session.played;
  const lv = view.level;
  const puzzle = lv?.puzzle ?? null;

  // ---- what the engine said ----
  const [penalty, setPenalty] = useState<{ id: number; ms: number } | null>(null);
  const [refusal, setRefusal] = useState<PuzzleRefusal | null>(null);
  const refusals = useRef(0);
  const onEffect = (e: LevelEffect) => {
    switch (e.kind) {
      case 'swapped': {
        cue('cellRelease');
        const a = e.from + 1;
        const b = e.to + 1;
        if (e.penaltyMs > 0) {
          setPenalty({ id: e.seq, ms: e.penaltyMs });
          announce(t('hud.puzzle.swappedPenalty', { a, b, s: e.penaltyMs / 1000 }));
        } else announce(t('hud.puzzle.swapped', { a, b }));
        return;
      }
      case 'swapRefused':
        refusals.current += 1;
        setRefusal({ key: refusals.current, from: e.from, to: e.to });
        if (e.reason === 'boxFixed') announce(t('hud.puzzle.fixedTap'));
        return;
      case 'puzzleEnded':
        if (e.over.reason === 'targetReached') {
          cue('correct');
          announce(t('hud.puzzle.solved'));
        }
        finish(puzzleEndDelayMs(e.over, reduce));
        return;
      default:
        return;
    }
  };
  useLevelEffects(session, (effects) => {
    for (const e of effects) onEffect(e);
  });
  // A puzzle already over when the screen opened goes to its result after the same hold.
  const overNow = puzzle?.over ?? null;
  useEffect(() => {
    if (overNow && !isEnded()) finish(puzzleEndDelayMs(overNow, reduce));
  }, [overNow, finish, reduce, isEnded]);

  useEffect(() => {
    preloadCues();
  }, []);

  // ---- the move: always the host's to judge ----
  const onSwap = useCallback(
    (from: number, to: number) => safely('swap', () => session.swap(from, to)),
    [session],
  );
  const onFixed = useCallback(() => announce(t('hud.puzzle.fixedTap')), [announce, t]);

  // ---- the board ----
  const [roomHeight, setRoomHeight] = useState<number | null>(null);
  const side = boardSide(windowWidth, roomHeight);
  const solved = puzzle?.over?.reason === 'targetReached';
  const counts = puzzle ? puzzleCountsText(puzzle, t) : '';

  return (
    <View style={styles.root} testID={testID}>
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + space[2], paddingBottom: insets.bottom + space[6] },
        ]}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        testID={`${testID}-content`}
      >
        <PuzzleHud
          level={level}
          view={view}
          now={now}
          penalty={penalty}
          onExit={shell.openConfirm}
          style={styles.gutter}
        />
        <View style={styles.room} onLayout={(e) => setRoomHeight(e.nativeEvent.layout.height)}>
          {puzzle ? (
            <PuzzleBoard
              grid={view.grid}
              slots={puzzle.slots}
              conflicts={puzzle.conflicts}
              width={side}
              enabled={running && pause.kind === 'none' && !puzzle.over}
              onSwap={onSwap}
              refusal={refusal}
              onFixed={onFixed}
              solved={solved}
              tapSwap={LEVEL_UI.puzzleTapSwap}
              label={t('hud.puzzle.boardLabel', { counts })}
            />
          ) : null}
        </View>
        <View style={[styles.gutter, styles.hints]} testID="puzzle-hints">
          <Text style={styles.hint}>{t('hud.puzzle.dragHint')}</Text>
          {LEVEL_UI.puzzleTapSwap ? (
            <Text style={styles.hintMuted} testID="puzzle-tap-hint">
              {t('hud.puzzle.tapHint')}
            </Text>
          ) : null}
        </View>
      </View>

      {/* The live region (components.md §11.6): invisible, read by screen readers as it changes. */}
      <View style={styles.live} pointerEvents="none">
        <Text accessibilityLiveRegion="polite" style={styles.liveText} testID="level-live">
          {shell.message}
        </Text>
      </View>

      <ConfirmModal
        visible={shell.confirmOpen}
        tone="danger"
        placement="bottom"
        icon="close"
        title={t('exit.title')}
        body={t('exit.body')}
        confirmLabel={t('exit.confirm')}
        cancelLabel={t('exit.cancel')}
        accessibilityLabel={t('exit.button')}
        onConfirm={shell.confirmExit}
        onCancel={shell.closeConfirm}
        onExited={shell.onDialogExited}
        testID="level-exit"
      />
      <ResumeCountdown state={covered} />
      {/* Over everything: the result was asked for and did not come (the watchdog). */}
      {shell.stuck ? (
        <FlowFallback
          reason="levels: the stage result did not open"
          actionsAfterMs={0}
          report={false}
          onResults={shell.retryResult}
          onHome={onLeave}
          testID="results-fallback"
        />
      ) : null}
    </View>
  );
}

const gutter = tokens.layout.gutterGame;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { flex: 1, gap: space[6] },
  gutter: { marginHorizontal: gutter },
  room: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  hints: { alignItems: 'center', gap: space[2] },
  hint: { ...text('body'), color: color.text, textAlign: 'center' },
  hintMuted: { ...text('label'), color: color.textMuted, textAlign: 'center' },
  live: {
    position: 'absolute',
    top: 0,
    start: 0,
    width: tokens.border.hairline,
    height: tokens.border.hairline,
    overflow: 'hidden',
  },
  liveText: { color: color.bg },
});
