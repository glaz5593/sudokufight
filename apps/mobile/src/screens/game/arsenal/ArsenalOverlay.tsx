import type { GameView, InterferenceKind, PlayerId } from '@sudoku-fight/engine';
import { type ComponentRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  BackHandler,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import type { AvatarId } from '../../../assets/avatars';
import { Icon } from '../../../components/Icon';
import { Avatar, Flag, formatScore, paletteAt, scoreText } from '../../../components/player';
import { dragClosesSheet, IconButton } from '../../../components/ui';
import { usePresence } from '../../../components/ui/motion';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { motion, useReduceMotion } from '../../../theme/motion';
import type { Point, Rect } from '../geometry';
import { useLiveAnnouncer } from '../useLiveAnnouncer';
import {
  type ArsenalModel,
  arsenalModel,
  dropZoneOf,
  launchable,
  relativeTo,
  scrimPieces,
} from './arsenalModel';
import { ARSENAL_CONFIG } from './config';
import { DragGhost, LaunchRipple } from './DragGhost';
import { useDragValues } from './drag';
import { arsenalMetrics as m } from './metrics';
import { TokenCard } from './TokenCard';
import type { ArsenalController } from './useArsenal';
import { isolate, kindWord, tapHint } from './wording';

/** Who the target is on this phone (the screen knows names and avatars; the engine's view does not). */
export interface ArsenalTargetInfo {
  /** The display name ("NinaVolt", "Mr. Hoot"). */
  name: string;
  /** Their palette index as this phone shows them (P2–P4; 0 is me). */
  colorIndex: number;
  avatarId?: AvatarId | null;
  /** ISO alpha-2. */
  country?: string | null;
}

export interface ArsenalOverlayProps {
  arsenal: ArsenalController;
  /** The host's latest view: costs, my score and whether the target can take one come from it. */
  view: GameView;
  /** Who a player is, for the header and the labels. */
  describe: (playerId: PlayerId) => ArsenalTargetInfo;
  /** The open tokens [D17]; default from ARSENAL_CONFIG. */
  unlocked?: readonly InterferenceKind[];
  /** The route "אני ← NinaVolt" on the ghost (spec §7.3.5). Default: in games of 3–4 players. */
  showRoute?: boolean;
  testID?: string;
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const settleSpring = { ...motion.spring.settle, reduceMotion: ReduceMotion.Never };
/** RNGH reports speeds per second; dragClosesSheet reads dp per ms. */
const PER_MS = 1 / 1000;

/**
 * The interference arsenal and its drag launch (spec §7.3; Arsenal, Interference-Drag; components.md §13;
 * motion.md §4.4). Rendered last in the game screen, over everything, and empty while closed.
 *
 * Opened from ⚡ on an opponent's card, it rises as a tray (240 ms; reduced motion: a 200 ms fade) over a scrim
 * with a hole: the card it was opened from stays above the scrim, framed as the one drop zone, and the other
 * cards dim (the screen spreads `arsenal.cardProps`). The tray says the next cost and the ones after it, my
 * score after paying, and holds the tokens with their live previews. A token is launched only by dragging it
 * onto that card (D18): the ghost follows the finger on the UI thread, the zone lights up while the finger is
 * over it, and letting go there launches (`onLaunch`, once), shrinks the token into the card with a ripple and
 * closes the tray (200 ms). Let go anywhere else and it flies back; nothing is charged. A tap only explains.
 *
 * Screen readers: the tray is a modal group, focus starts on its title, every token says its cost and what to
 * do, and a live region tells the drag (lifted, over the card, cancelled, launched). Android back closes it.
 */
export function ArsenalOverlay({
  arsenal,
  view,
  describe,
  unlocked = ARSENAL_CONFIG.unlocked,
  showRoute,
  testID = 'arsenal',
}: ArsenalOverlayProps) {
  const { t } = useTranslation('game');
  const { t: tUi } = useTranslation('ui');
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const drag = useDragValues();
  // The controller's methods are stable, so the tokens' gestures are not rebuilt as the drag goes on.
  const { targetId, dragKind, close, measureCard, lift, setHover, release, settle } = arsenal;
  const visible = targetId !== null;

  // What the tray shows: the target it was opened for, kept while it leaves.
  const [shownId, setShownId] = useState<PlayerId | null>(targetId);
  if (targetId !== null && targetId !== shownId) setShownId(targetId);
  const model = useMemo(
    () => (shownId === null ? null : arsenalModel(view, shownId, unlocked)),
    [view, shownId, unlocked],
  );
  const target = shownId === null ? null : describe(shownId);
  const targetName = target?.name ?? '';

  // How it leaves: 200 ms after a launch, 240 ms otherwise (motion.md `launch`, `sheet`).
  const [launched, setLaunched] = useState(false);
  // The token in the finger, from lift until its ghost has landed or gone back.
  const [carried, setCarried] = useState<{ kind: InterferenceKind; cost: number } | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setLaunched(false);
    // Closed under a held token (Android back, the scrim, the target gone, the game over): its slot leaves
    // with the tray, so its gesture may never end here. The drag is over and nothing was launched; the ghost
    // goes now rather than staying on the screen. (After a launch it is landing in the card: it stays.)
    else if (!launched && carried !== null) setCarried(null);
  }
  const { mounted, progress } = usePresence(visible, {
    inMs: motion.duration.trayRise,
    outMs: launched ? m.launch.closeMs : motion.duration.sheetOut,
    reduce,
  });

  // ---- where things are: the overlay in the window, the drop zone, and the overlay's own size ----
  const rootRef = useRef<ComponentRef<typeof View>>(null);
  const [origin, setOrigin] = useState<Point>({ x: 0, y: 0 });
  const [zone, setZone] = useState<Rect | null>(null);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const measure = useCallback(() => {
    if (targetId === null) return;
    rootRef.current?.measureInWindow?.((x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      drag.origin.set({ x, y });
      setOrigin((was) => (was.x === x && was.y === y ? was : { x, y }));
    });
    measureCard(targetId, (rect) => {
      const next = dropZoneOf(rect);
      drag.zone.set(next);
      setZone((was) => (was && sameRect(was, next) ? was : next));
    });
  }, [targetId, measureCard, drag]);
  useEffect(() => {
    if (!visible) {
      drag.zone.set(null);
      return;
    }
    measure();
  }, [visible, measure, drag, windowSize.width, windowSize.height]);
  const onRootLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      setArea((was) => (was?.width === width && was.height === height ? was : { width, height }));
      measure();
    },
    [measure],
  );
  const hole = zone && relativeTo(zone, origin);

  // ---- nothing to aim at any more (the target left or disconnected, the game is over, or I can't send
  // any): close ----
  const gone = visible && (model === null || model.gone);
  useEffect(() => {
    if (gone) close();
  }, [gone, close]);

  // ---- Android back closes it; screen readers start on the title ----
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [visible, close]);
  const titleRef = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (visible && titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
  }, [visible, mounted]);

  // ---- the drag, as JS hears it: lift, over / off the zone, let go, settled ----
  const { message, announce } = useLiveAnnouncer(t('listSep'));
  const [ripple, setRipple] = useState<Rect | null>(null);
  const [bubble, setBubble] = useState<{ kind: InterferenceKind; text: string } | null>(null);
  const latest = useRef({ model, targetName, hole, reduce, visible });
  useLayoutEffect(() => {
    latest.current = { model, targetName, hole, reduce, visible };
  });

  const onLift = useCallback(
    (kind: InterferenceKind) => {
      const { model: now, targetName: name } = latest.current;
      setBubble(null);
      setCarried({ kind, cost: now?.cost ?? 0 });
      measure(); // the card can't have moved, but a stale zone would be worse
      lift(kind);
      announce(t('arsenal.live.lift', { kind: kindWord(kind, t), name: isolate(name) }));
    },
    [lift, announce, measure, t],
  );
  const onHover = useCallback(
    (inside: boolean) => {
      setHover(inside);
      announce(
        inside
          ? t('arsenal.live.over', { name: isolate(latest.current.targetName) })
          : t('arsenal.live.left'),
      );
    },
    [setHover, announce, t],
  );
  const onRelease = useCallback(
    (kind: InterferenceKind, launch: boolean) => {
      const { model: now, targetName: name, hole: at, reduce: still, visible: open } = latest.current;
      const token = now?.tokens.find((x) => x.kind === kind);
      // The UI thread checked the zone; the view has the last word on whether it can still go.
      const go = launch && open && token !== undefined && launchable(token);
      if (go) {
        setLaunched(true);
        if (!still && at) setRipple(at);
        announce(t('arsenal.live.launched', { kind: kindWord(kind, t), name: isolate(name) }));
      } else {
        announce(t('arsenal.live.cancelled'));
      }
      release(kind, go);
    },
    [release, announce, t],
  );
  const onSettled = useCallback(() => {
    setCarried(null);
    settle();
  }, [settle]);
  const onTap = useCallback(
    (kind: InterferenceKind) => {
      const { model: now, targetName: name } = latest.current;
      const token = now?.tokens.find((x) => x.kind === kind);
      if (!token) return;
      const line = tapHint(token, name, t);
      setBubble({ kind, text: line });
      announce(line);
    },
    [announce, t],
  );
  useEffect(() => {
    if (!bubble) return;
    const id = setTimeout(() => setBubble(null), m.bubble.holdMs);
    return () => clearTimeout(id);
  }, [bubble]);
  const onRippleDone = useCallback(() => setRipple(null), []);

  // ---- the tray: slides up (or fades), and a downward drag of its head closes it ----
  const sheetHeight = useSharedValue(windowSize.height);
  const pull = useSharedValue(0);
  useEffect(() => {
    if (visible) pull.set(0);
  }, [visible, pull]);
  const onPullEnd = useCallback(
    (dy: number, vy: number) => {
      if (dragClosesSheet(dy, vy * PER_MS, sheetHeight.get())) close();
      else pull.set(withSpring(0, settleSpring));
    },
    [close, pull, sheetHeight],
  );
  const pullGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(m.closeDragActivate)
        .failOffsetX([-2 * m.dragSlop, 2 * m.dragSlop])
        .withTestId('arsenal-close-drag')
        .onUpdate((e) => {
          'worklet';
          pull.set(Math.max(0, e.translationY));
        })
        .onEnd((e) => {
          'worklet';
          scheduleOnRN(onPullEnd, e.translationY, e.velocityY);
        }),
    [pull, onPullEnd],
  );
  const sheetStyle = useAnimatedStyle(() =>
    reduce
      ? { opacity: progress.get(), transform: [{ translateY: pull.get() }] }
      : { transform: [{ translateY: pull.get() + (1 - progress.get()) * sheetHeight.get() }] },
  );

  if (!mounted && !ripple && !carried) return null;

  const routeTo = (showRoute ?? view.players.length > 2) ? targetName : null;
  const showTray = (mounted || visible) && model !== null && target !== null;

  return (
    <View
      ref={rootRef}
      style={StyleSheet.absoluteFill}
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityViewIsModal={visible}
      onLayout={onRootLayout}
      testID={testID}
    >
      {showTray ? (
        <>
          <Scrim
            progress={progress}
            hole={hole}
            area={area}
            label={t('arsenal.scrim')}
            onPress={close}
            testID={`${testID}-scrim`}
          />
          <Animated.View
            role="dialog"
            accessibilityLabel={t('arsenal.title')}
            onAccessibilityEscape={close}
            onLayout={(e) => sheetHeight.set(e.nativeEvent.layout.height)}
            style={[styles.sheet, { paddingBottom: m.sheet.paddingX + insets.bottom }, sheetStyle]}
            testID={`${testID}-sheet`}
          >
            <GestureDetector gesture={pullGesture}>
              <View>
                <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no" />
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <Text ref={titleRef} accessibilityRole="header" style={styles.title} numberOfLines={1}>
                      {t('arsenal.title')}
                    </Text>
                    <TargetLine
                      target={target}
                      label={t('arsenal.targetLabel', { name: isolate(targetName) })}
                    />
                  </View>
                  <IconButton
                    icon="close"
                    iconSize="header"
                    accessibilityLabel={tUi('sheet.close')}
                    onPress={close}
                    testID={`${testID}-close`}
                  />
                </View>
              </View>
            </GestureDetector>
            <CostRow model={model} />
            <Text style={styles.info}>{t('arsenal.info', { seconds: model.seconds })}</Text>
            <View style={styles.tokens}>
              {model.tokens.map((token) => (
                <TokenCard
                  key={token.kind}
                  token={token}
                  targetName={targetName}
                  drag={drag}
                  reduce={reduce}
                  dragging={dragKind === token.kind}
                  locked={dragKind !== null && dragKind !== token.kind}
                  bubble={bubble?.kind === token.kind ? bubble.text : null}
                  onLift={onLift}
                  onHover={onHover}
                  onRelease={onRelease}
                  onSettled={onSettled}
                  onTap={onTap}
                />
              ))}
            </View>
            <View style={styles.hint} testID={`${testID}-hint`}>
              <Icon name={dragKind ? 'cancel' : 'target'} size={m.hint.icon} color={color.textMuted} />
              <Text style={styles.hintText} numberOfLines={1}>
                {dragKind ? t('arsenal.cancelHint') : t('arsenal.hint', { name: isolate(targetName) })}
              </Text>
            </View>
          </Animated.View>
        </>
      ) : null}

      {/* Over everything, in physical coordinates (as measured), never touchable, silent. */}
      <View
        style={styles.layer}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {ripple ? <LaunchRipple zone={ripple} onDone={onRippleDone} /> : null}
        {carried ? (
          <DragGhost kind={carried.kind} cost={carried.cost} routeTo={routeTo} drag={drag} reduce={reduce} />
        ) : null}
      </View>

      {/* The drag, said to screen readers (Android reads the region, iOS gets announcements). */}
      <View style={styles.live} pointerEvents="none">
        <Text accessibilityLiveRegion="polite" style={styles.liveText} testID={`${testID}-live`}>
          {message}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------

function Scrim({
  progress,
  hole,
  area,
  label,
  onPress,
  testID,
}: {
  progress: SharedValue<number>;
  hole: Rect | null;
  area: { width: number; height: number } | null;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const fade = useAnimatedStyle(() => ({ opacity: progress.get() }));
  // Until the card is measured the scrim covers everything; then it leaves the card's frame uncovered.
  const pieces = hole && area ? scrimPieces(hole, area) : null;
  return (
    <Animated.View style={[styles.layer, fade]} pointerEvents="box-none">
      {pieces ? (
        pieces.map((p, i) => (
          <Pressable
            key={i}
            onPress={onPress}
            // One button for screen readers: the others are the same scrim.
            accessible={i === 0}
            accessibilityRole={i === 0 ? 'button' : undefined}
            accessibilityLabel={i === 0 ? label : undefined}
            importantForAccessibility={i === 0 ? 'yes' : 'no-hide-descendants'}
            style={[styles.piece, { left: p.x, top: p.y, width: p.width, height: p.height }]}
            testID={i === 0 ? testID : `${testID}-${i}`}
          />
        ))
      ) : (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[StyleSheet.absoluteFill, styles.scrim]}
          testID={testID}
        />
      )}
    </Animated.View>
  );
}

/** "יעד: [avatar] NinaVolt 🇩🇪" (components.md §13 header). */
function TargetLine({ target, label }: { target: ArsenalTargetInfo; label: string }) {
  const { t } = useTranslation('game');
  const ring = paletteAt(target.colorIndex).ring;
  return (
    <View style={styles.targetLine} accessible accessibilityLabel={label}>
      <Text style={styles.subtitle}>{t('arsenal.target')}</Text>
      <Avatar avatarId={target.avatarId} size="cell" style={[styles.miniAvatar, { borderColor: ring }]} />
      <Text style={[styles.subtitle, styles.targetName]} numberOfLines={1}>
        {target.name}
      </Text>
      <Flag country={target.country} size="sheet" decorative />
    </View>
  );
}

/**
 * "ההפרעה הבאה שלך: 2 נק׳ · אחריה 4, 8…" and my score before and after (components.md §13). Short of points (my
 * score dropped while the tray was open) it says how many are missing instead of a score after a launch that
 * can't happen.
 */
function CostRow({ model }: { model: ArsenalModel }) {
  const { t } = useTranslation('game');
  const later = model.laterCosts.join(t('listSep'));
  const short = model.missing > 0;
  const values = {
    cost: model.cost,
    costs: later,
    score: scoreText(model.score),
    after: scoreText(model.scoreAfter),
    missing: formatScore(model.missing),
  };
  const label = t(short ? 'arsenal.costLabelShort' : 'arsenal.costLabel', values);
  const afterLine = short
    ? t('arsenal.missing', { count: model.missing })
    : t('arsenal.after', { score: values.after });
  return (
    <View style={styles.costRow} accessible accessibilityLabel={label} testID="arsenal-cost">
      <View style={styles.costStart}>
        <Text style={styles.subtitle}>{t('arsenal.next')}</Text>
        <View style={styles.costLine}>
          <Text style={[m.costRow.costStyle, styles.accent]}>{String(model.cost)}</Text>
          <Text style={[styles.unit, styles.accent]}>{t('arsenal.unit')}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {t('arsenal.later', { costs: later })}
          </Text>
        </View>
      </View>
      <View style={styles.costEnd}>
        <Text style={styles.subtitle}>{t('arsenal.score')}</Text>
        <Text style={[m.costRow.scoreStyle, styles.myScore]}>{scoreText(model.score)}</Text>
        <Text style={styles.subtitle} testID="arsenal-after">
          {afterLine}
        </Text>
      </View>
    </View>
  );
}

const ME = paletteAt(0);

const styles = StyleSheet.create({
  // Layers drawn in measured window coordinates are LTR, so `left` and translateX stay physical.
  layer: { ...StyleSheet.absoluteFill, direction: 'ltr' },
  piece: { position: 'absolute', backgroundColor: color.scrim },
  scrim: { backgroundColor: color.scrim },
  sheet: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    maxHeight: '85%',
    paddingTop: m.sheet.paddingTop,
    paddingHorizontal: m.sheet.paddingX,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.sheet.border,
    backgroundColor: color.sheet.bg,
  },
  handle: {
    alignSelf: 'center',
    width: size.sheetHandle.width,
    height: size.sheetHandle.height,
    borderRadius: radius.bar,
    backgroundColor: color.sheet.handle,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: m.sheet.headerHeight,
    marginTop: m.sheet.headerTop,
  },
  headerText: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[2] },
  title: { ...text('h1'), color: color.text },
  targetLine: { flexDirection: 'row', alignItems: 'center', gap: m.subtitle.gap, minWidth: 0 },
  subtitle: { ...text('label'), color: color.textMuted },
  targetName: { color: color.text, flexShrink: 1 },
  miniAvatar: {
    borderWidth: m.subtitle.avatarRing,
    borderRadius: m.subtitle.avatarRadius,
    overflow: 'hidden',
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: m.costRow.gap,
    minHeight: m.costRow.height,
    marginTop: m.costRow.top,
    paddingHorizontal: m.costRow.paddingX,
    paddingVertical: space[3],
    borderRadius: m.costRow.radius,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  costStart: { flexShrink: 1, alignItems: 'flex-start', gap: space[1] },
  costLine: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  costEnd: { alignItems: 'flex-end', gap: space[1] },
  accent: { color: color.accent },
  unit: { ...text('badge') },
  myScore: { color: ME.ring },
  info: { ...text('label'), color: color.textMuted, marginTop: m.info.top, textAlign: 'center' },
  tokens: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space[4],
    marginTop: m.token.top,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: space[3],
    height: m.hint.height,
    marginTop: m.hint.top,
    paddingHorizontal: m.hint.paddingX,
    borderRadius: m.hint.radius,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  hintText: { ...text('label'), color: color.textMuted, flexShrink: 1 },
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
