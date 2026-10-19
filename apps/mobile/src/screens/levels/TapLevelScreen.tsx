import {
  BOT_CONFIG,
  boxOf,
  CELL_COUNT,
  type CellIndex,
  cellName,
  colOf,
  type Digit,
  type FindLevelOver,
  type FindScope,
  type GameView,
  LEVEL_PENALTY_MS,
  LEVEL_RULES,
  rowOf,
} from '@sudoku-fight/engine';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Board, type BoardFlash, boardModel, type BoardModelOptions } from '../../components/board';
import { boardGeometry, cellRect } from '../../components/board/geometry';
import { ResumeCountdown } from '../../components/board/ResumeCountdown';
import { BoardFreezeLayer } from '../../components/levels/BoardFreezeLayer';
import { RegionFrame } from '../../components/levels/RegionFrame';
import { StarsBar } from '../../components/levels/StarsBar';
import { ltr } from '../../components/player';
import { signedText } from '../../components/player/format';
import { ConfirmModal } from '../../components/ui';
import { timing } from '../../components/ui/motion';
import { gameEndConfig } from '../../config/gameEnd';
import { LEVEL_UI } from '../../config/levels';
import { useNow } from '../../game/useNow';
import type { LevelEffect } from '../../levels/levelEffects';
import type { LevelSession, PauseState } from '../../levels/levelSession';
import { useLevelEffects } from '../../levels/useLevelEffects';
import { crashReporter } from '../../services/crashlytics';
import { cue, preloadCues } from '../../services/feedback';
import { useProfile } from '../../state/profile';
import { color, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { FlowFallback } from '../FlowFallback';
import { boardSide } from '../game/geometry';
import { FLASH_CLEAR_MS } from '../game/model';
import { REACTION_MS } from '../game/ReactionLayer';
import { ReactionPicker, useReactions } from '../game/reactions';
import { useLiveAnnouncer } from '../game/useLiveAnnouncer';
import { FindHud, FindTargetPanel, levelClock, scopeText, StageHeader } from './hud/FindHud';
import { RaceHud } from './hud/RaceHud';
import { SpotErrorHud, SpotErrorTip, spotTipShown } from './hud/SpotErrorHud';
import { levelEndDelayMs } from './levelChrome';

/**
 * The tap stages' screen (components.md §19.7; the Lv-Find, Lv-Race and Idea-1 boards; plan §2.1, §2.2, Idea-1):
 * find ("איפה ה־6?"), the race against the bot, and spot the error (SpotErrorHud over the board, its tip card
 * under it in the kind's first stages; "mine" digits in P1 with ●, a found error corrected on the board, the
 * errors not found framed at the end). No keypad: a tap on a cell is the move,
 * and the screen talks only to the session's GameHost (session.tap). What a tap did comes back as the tap
 * engine's events (levelEffectsOf): a right one flashes its cell in my colour and the digit falls into it (with
 * Reduced Motion it just appears there); a wrong one draws a red X with the "‎+5 ש׳" it cost, or, in the race,
 * freezes my taps for 3 s (BoardFreezeLayer); the bot's spots flash in its colour, its avatar hops (full motion
 * only) and it laughs at my wrong tap (😂 on its card) when its plan says so. A live region says each of them.
 *
 * The area of the target is framed and the rest of the board dimmed; every digit like the target is a dark
 * chip, so the eye finds it at once. The X and Android back ask "לצאת מהשלב?" (0 stars, the next stage opens)
 * and quit. The end holds the last picture (the answer, when it was missed) for a moment, then onOver from a
 * timer of this screen, once the dialog is gone, never inside a press or an update. The result should replace
 * this screen then; if it has not after gameEndConfig.resultsWatchdogMs (levels.db that does not answer), a way
 * on shows over everything: "לתוצאות" asks for it again, "לבית" (and Android back) leaves the stage (onLeave).
 *
 * [D65] While the app is away the board is covered, and back, "3, 2, 1" counts over it (ResumeCountdown, the
 * session's `pause`) before the stage goes on.
 */

export interface TapLevelScreenProps {
  session: LevelSession;
  /** The stage is over and its last picture held: its result. */
  onOver: () => void;
  /** Out of the stage (to the map): the way out when its result does not come (the watchdog's fallback). */
  onLeave: () => void;
  /** How long the result may take to replace this screen before the fallback shows. */
  resultsWatchdogMs?: number;
  testID?: string;
}

/** How often the clock and the rings re-render. */
const TICK_MS = 250;
/** A missed target's answer stays this long before the result (information: the same with Reduced Motion). */
export const ANSWER_HOLD_MS = 1500;

/** The hold on a tap stage's last picture: the answer of a miss, a found target's flash, nothing for a quit. */
export function tapEndDelayMs(over: FindLevelOver, reduce: boolean, answer: boolean): number {
  if (over.reason === 'quit') return 0;
  if (answer && over.reason !== 'targetReached') return ANSWER_HOLD_MS;
  return levelEndDelayMs('boardComplete', reduce);
}

/** The cells of a find's scope; null for the whole board (no frame, no dimming). */
export function scopeCells(scope: FindScope | null): CellIndex[] | null {
  if (!scope || scope.kind === 'board') return null;
  const all = Array.from({ length: CELL_COUNT }, (_, i) => i);
  if (scope.kind === 'box') return all.filter((i) => boxOf(i) === scope.index);
  if (scope.kind === 'row') return all.filter((i) => rowOf(i) === scope.index);
  return all.filter((i) => colOf(i) === scope.index);
}

/** An error the game survives: reported (and shown in development), never thrown on. */
function survive(error: unknown, context: string): void {
  if (__DEV__) console.warn(`[levels] ${context}`, error);
  crashReporter().recordError(error, `levels: ${context}`);
}

function safely(context: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    survive(error, context);
  }
}

export function TapLevelScreen({
  session,
  onOver,
  onLeave,
  resultsWatchdogMs = gameEndConfig.resultsWatchdogMs,
  testID = 'tap-level',
}: TapLevelScreenProps) {
  const { t } = useTranslation('levels');
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const myAvatar = useProfile((s) => s.avatarId);
  const level = session.played;

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
  const lv = view.level;
  const find = lv?.find;
  const me = view.players.find((p) => p.id === view.me) ?? null;

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

  // ---- feedback ----
  const [flashes, setFlashes] = useState<BoardFlash[]>([]);
  const [penalty, setPenalty] = useState<{ id: number; ms: number } | null>(null);
  const [drop, setDrop] = useState<{ id: number; cell: CellIndex; digit: Digit } | null>(null);
  const [botReaction, setBotReaction] = useState<{ id: number; emoji: string } | null>(null);
  const [botHop, setBotHop] = useState<number | null>(null);
  const { message, announce } = useLiveAnnouncer(t('board:separator.list'));
  const deniedIds = useRef(0);
  const flash = (f: BoardFlash) => {
    setFlashes((list) => [...list.filter((x) => x.cell !== f.cell), f]);
    later(FLASH_CLEAR_MS, () => setFlashes((list) => list.filter((x) => x !== f)));
  };
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '';

  // ---- the end: held, then onOver from a timer, never while the dialog is still on the screen ----
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialogUp = useRef(false);
  const whenDialogGone = useRef<(() => void) | null>(null);
  const ended = useRef(false);
  // The result asked for and this screen still here after the watchdog's time: a way on, over everything.
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
    (over: FindLevelOver, answer: boolean) => {
      if (ended.current) return;
      ended.current = true;
      setConfirmOpen(false);
      const go = () => later(tapEndDelayMs(over, reduce, answer), toResult);
      if (dialogUp.current) whenDialogGone.current = go;
      else go();
    },
    [later, toResult, reduce],
  );
  const onDialogExited = useCallback(() => {
    dialogUp.current = false;
    const next = whenDialogGone.current;
    whenDialogGone.current = null;
    next?.();
  }, []);

  const onEffect = (e: LevelEffect) => {
    switch (e.kind) {
      case 'found': {
        const cell = ltr(cellName(e.cell));
        flash({ cell: e.cell, kind: 'correct', id: e.seq });
        if (e.byMe) {
          cue('correct');
          const digit = find?.digit ?? null;
          if (digit !== null && !reduce) {
            const next = { id: e.seq, cell: e.cell, digit };
            setDrop(next);
            later(motion.duration.stateChange + motion.duration.correctFlash, () =>
              setDrop((d) => (d === next ? null : d)),
            );
          }
          if (digit !== null) announce(t('hud.find.found', { digit, cell }));
          // Spot the error: the error found, what stood there and what holds now.
          const error =
            level.kind === 'spotError' ? level.targets.errors.find((x) => x.cell === e.cell) : undefined;
          if (error)
            announce(
              t('hud.spotError.foundCell', {
                cell,
                wrong: error.digit,
                right: Number(level.board.solution[e.cell]),
              }),
            );
        }
        return;
      }
      case 'spotWon':
        if (e.byMe) announce(t('hud.race.mine', { n: e.index + 1 }));
        else {
          setBotHop(e.seq);
          announce(t('hud.race.theirs', { name: nameOf(e.playerId), n: e.index + 1 }));
        }
        return;
      case 'miss': {
        flash({ cell: e.cell, kind: 'miss', id: e.seq });
        if (!e.byMe) return;
        cue('wrong');
        const cell = ltr(cellName(e.cell));
        if (e.penaltyMs !== null) {
          setPenalty({ id: e.seq, ms: e.penaltyMs });
          const penalty = signedText(e.penaltyMs / 1000);
          // Spot the error: the digit tapped was a right one.
          announce(
            level.kind === 'spotError'
              ? t('hud.spotError.rightTap', { cell, penalty })
              : t('hud.find.missed', { cell, penalty }),
          );
        }
        return;
      }
      case 'spotVoid':
        announce(t('hud.race.void', { n: e.index + 1 }));
        return;
      case 'shown': {
        const next = session.getView().level?.find;
        if (e.index > 0 && next?.digit != null && next.scope)
          announce(
            t('hud.race.next', { n: e.index + 1, digit: next.digit, scope: scopeText(next.scope, t) }),
          );
        return;
      }
      case 'reaction':
        if (e.byMe) return;
        setBotReaction({ id: e.seq, emoji: e.emoji });
        later(REACTION_MS, () => setBotReaction((r) => (r?.id === e.seq ? null : r)));
        return;
      case 'refused':
        // A tap the engine took nothing from: frozen (the race) shakes the cell; the rest say nothing.
        if (e.reason === 'frozen' && e.cell !== undefined) {
          deniedIds.current -= 1;
          flash({ cell: e.cell, kind: 'denied', id: deniedIds.current });
          cue('cellDenied');
        }
        return;
      case 'ended': {
        const answer = session.getView().level?.find?.answer ?? [];
        const cells = answer.map((c) => ltr(cellName(c))).join(', ');
        if (answer.length && e.over.reason !== 'targetReached' && e.over.reason !== 'quit')
          announce(
            level.kind === 'spotError'
              ? t('hud.spotError.missed', { cells })
              : t('hud.find.answer', { cell: cells }),
          );
        finish(e.over, answer.length > 0);
        return;
      }
      case 'paused':
      case 'resumed':
        return;
    }
  };
  useLevelEffects(session, (effects) => {
    for (const e of effects) onEffect(e);
  });
  // A stage already over when the screen opened goes to its result after the same hold.
  const overNow = find?.over ?? null;
  useEffect(() => {
    if (overNow && !ended.current) finish(overNow, (find?.answer?.length ?? 0) > 0);
  }, [overNow, finish, find?.answer?.length]);

  useEffect(() => {
    preloadCues();
  }, []);

  // ---- actions ----
  const onCellPress = useCallback((cell: CellIndex) => safely('tap', () => session.tap(cell)), [session]);
  // My reactions, only with LEVEL_UI.reactions (D62: none in a stage; the engine refuses them otherwise).
  const react = useCallback((emoji: string) => safely('react', () => session.host.react(emoji)), [session]);
  const reactions = useReactions({ view, now, onReact: react });
  const openConfirm = useCallback(() => {
    if (ended.current) return;
    dialogUp.current = true;
    setConfirmOpen(true);
  }, []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const confirmExit = () => {
    setConfirmOpen(false);
    cue('surrender');
    safely('quit', () => session.quit());
  };
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

  // ---- the board ----
  const [roomHeight, setRoomHeight] = useState<number | null>(null);
  const side = boardSide(windowWidth, roomHeight);
  const area = useMemo(() => scopeCells(find?.scope ?? null), [find?.scope]);
  const errors = level.kind === 'spotError' ? level.targets.errors : null;
  const found = find?.found;
  const corrected = useMemo(
    () =>
      errors && found
        ? errors.filter((e) => found.includes(e.cell)).map((e) => ({ cell: e.cell, wrong: e.digit }))
        : null,
    [errors, found],
  );
  const options = useMemo<BoardModelOptions>(
    () => ({
      area,
      editable: area,
      // A filled cell takes a tap only when the engine judges one: spot the error's "mine" digits always, any
      // filled cell with LEVEL_RULES.tapOnFilled 'penalty'.
      tappable: LEVEL_RULES.tapOnFilled === 'penalty' ? 'all' : level.kind === 'spotError',
      highlightDigit: find?.digit ?? null,
      corrected,
      mine: level.kind === 'spotError',
      lockTimer: false,
    }),
    [area, level.kind, find?.digit, corrected],
  );
  const board = useMemo(
    () => boardModel(view, me?.seat ?? null, now, options),
    [view, me?.seat, now, options],
  );
  const scope = find?.scope ? scopeText(find.scope, t) : null;
  const boardLabel = scope
    ? t('hud.boardLabel', { scope })
    : level.kind === 'spotError'
      ? t('hud.spotError.boardLabel')
      : t('board:board.tapLabel');
  // Spot the error's tip card: the kind's first LEVEL_UI.tipLevels stages, until the player closes it.
  const [tipOpen, setTipOpen] = useState(() => spotTipShown(level));
  const closeTip = useCallback(() => setTipOpen(false), []);
  const answer = find?.answer ?? null;
  const overlay = useMemo(
    () => (
      <>
        {area ? <RegionFrame cells={area} width={side} tone="focus" /> : null}
        {/* The answer (find: where it was; spot the error: the errors not found), one frame a cell. */}
        {answer?.map((c) => (
          <RegionFrame key={c} cells={[c]} width={side} tone="gold" testID="answer-frame" />
        ))}
        {drop ? <DigitDrop key={drop.id} cell={drop.cell} digit={drop.digit} width={side} /> : null}
      </>
    ),
    [area, answer, drop, side],
  );

  // The freeze's deadline is the engine's; it is over by the stage's clock even before the next update.
  const frozenUntil = find?.frozenUntil != null && find.frozenUntil > now ? find.frozenUntil : null;
  const covered = pause.kind === 'none' ? null : pause;

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
        {lv && level.kind === 'find' ? (
          <FindHud level={level} view={lv} now={now} onExit={openConfirm} style={styles.gutter} />
        ) : level.kind === 'findDuel' ? (
          <RaceHud
            level={level}
            view={view}
            now={now}
            myAvatar={myAvatar}
            botReaction={botReaction}
            botHop={botHop}
            onExit={openConfirm}
            onReactions={LEVEL_UI.reactions ? reactions.togglePicker : undefined}
            style={styles.gutter}
          />
        ) : lv && level.kind === 'spotError' ? (
          <SpotErrorHud
            level={level}
            view={lv}
            now={now}
            penalty={penalty}
            onExit={openConfirm}
            style={styles.gutter}
          />
        ) : (
          <View style={[styles.gutter, styles.stage]}>
            <StageHeader level={level} onExit={openConfirm} />
            {lv ? (
              <StarsBar rule={lv.marks} value={levelClock(lv, now).elapsedMs} max={lv.limitMs ?? undefined} />
            ) : null}
          </View>
        )}
        <View style={styles.room} onLayout={(e) => setRoomHeight(e.nativeEvent.layout.height)}>
          <View>
            <Board
              model={board}
              width={side}
              onCellPress={running && pause.kind === 'none' ? onCellPress : undefined}
              flashes={flashes}
              label={boardLabel}
              tap
            >
              {overlay}
            </Board>
            <BoardFreezeLayer
              frozenUntil={frozenUntil}
              totalMs={FREEZE_MS}
              now={now}
              out={find?.out === true}
            />
          </View>
        </View>
        {lv && level.kind === 'find' ? (
          <FindTargetPanel
            view={lv}
            now={now}
            penaltyMs={LEVEL_PENALTY_MS}
            penalty={penalty}
            style={styles.gutter}
          />
        ) : null}
        {level.kind === 'spotError' && tipOpen ? (
          <SpotErrorTip onClose={closeTip} style={styles.gutter} />
        ) : null}
      </View>

      {/* The live region (components.md §11.6): invisible, read by screen readers as it changes. */}
      <View style={styles.live} pointerEvents="none">
        <Text accessibilityLiveRegion="polite" style={styles.liveText} testID="level-live">
          {message}
        </Text>
      </View>

      <ConfirmModal
        visible={confirmOpen}
        tone="danger"
        placement="bottom"
        icon="close"
        title={t('exit.title')}
        body={t('exit.body')}
        confirmLabel={t('exit.confirm')}
        cancelLabel={t('exit.cancel')}
        accessibilityLabel={t('exit.button')}
        onConfirm={confirmExit}
        onCancel={closeConfirm}
        onExited={onDialogExited}
        testID="level-exit"
      />
      {LEVEL_UI.reactions ? (
        <ReactionPicker
          visible={reactions.pickerOpen}
          anchor={null}
          items={reactions.model.items}
          onPick={reactions.pick}
          onClose={reactions.closePicker}
        />
      ) : null}
      <ResumeCountdown state={covered} />
      {/* Over everything: the result was asked for and did not come (the watchdog). */}
      {stuck ? (
        <FlowFallback
          reason="levels: the stage result did not open"
          actionsAfterMs={0}
          report={false}
          onResults={() => {
            setStuck(false);
            toResult();
          }}
          onHome={onLeave}
          testID="results-fallback"
        />
      ) : null}
    </View>
  );
}

/** The race's freeze after a wrong tap (the engine's BOT_CONFIG.find.wrongFreezeMs; the ring only draws it). */
const FREEZE_MS = BOT_CONFIG.find.wrongFreezeMs;

/**
 * My found digit falling into its cell (motion.md `level.find.drop`): from a cell above, down into it, over 240
 * ms, then the cell's own digit shows. Full motion only: with Reduced Motion the digit just appears in place.
 */
function DigitDrop({ cell, digit, width }: { cell: CellIndex; digit: Digit; width: number }) {
  const reduce = useReduceMotion();
  const g = boardGeometry(width);
  const r = cellRect(g, cell);
  const y = useSharedValue(-r.height);
  const opacity = useSharedValue(1);
  useEffect(() => {
    y.set(withTiming(0, timing(motion.duration.stateChange, 'emphasized', reduce)));
    opacity.set(withTiming(0, { ...timing(motion.duration.correctFlash, 'exit', reduce) }));
  }, [y, opacity, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: y.get() }] }));
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.drop, { left: r.x, top: r.y, width: r.width, height: r.height }, style]}
      testID="digit-drop"
    >
      <Text style={[styles.dropDigit, { color: color.players[0].digit }]}>{digit}</Text>
    </Animated.View>
  );
}

const gutter = tokens.layout.gutterGame;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { flex: 1, gap: space[6] },
  gutter: { marginHorizontal: gutter },
  stage: { gap: space[6] },
  room: { flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' },
  drop: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  dropDigit: { ...text('digitCellOwned') },
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
