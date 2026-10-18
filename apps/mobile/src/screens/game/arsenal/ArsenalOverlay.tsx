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

import { AVATAR_REACTIONS, type AvatarIdOrNone } from '../../../avatars';
import { Avatar, Flag, formatScore, paletteAt, scoreText, signedText } from '../../../components/player';
import { dragClosesSheet, IconButton } from '../../../components/ui';
import { usePresence } from '../../../components/ui/motion';
import { cue } from '../../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { motion, useReduceMotion } from '../../../theme/motion';
import type { Point, Rect } from '../geometry';
import { useLiveAnnouncer } from '../useLiveAnnouncer';
import {
  type ArsenalModel,
  arsenalModel,
  launchable,
  pickerLayout,
  relativeTo,
  scrimPieces,
  targetFrameOf,
} from './arsenalModel';
import { ARSENAL_CONFIG } from './config';
import { KindButton } from './KindButton';
import { LaunchRipple } from './LaunchRipple';
import { arsenalMetrics as m } from './metrics';
import { RouteLine } from './RouteLine';
import type { ArsenalController } from './useArsenal';
import { blockedSentence, isolate, kindWord } from './wording';

/** Who the target is on this phone (the screen knows names and avatars; the engine's view does not). */
export interface ArsenalTargetInfo {
  /** The display name ("NinaVolt", "Mr. Hoot"). */
  name: string;
  /** Their palette index as this phone shows them (P2–P4; 0 is me). */
  colorIndex: number;
  avatarId?: AvatarIdOrNone | null;
  /** ISO alpha-2. */
  country?: string | null;
}

export interface ArsenalOverlayProps {
  arsenal: ArsenalController;
  /** The host's latest view: costs, my score, the kinds and whether the target can take one come from it. */
  view: GameView;
  /** Who a player is, for the header and the labels. */
  describe: (playerId: PlayerId) => ArsenalTargetInfo;
  /** The kinds open at my level [D17]; default from ARSENAL_CONFIG. */
  unlocked?: readonly InterferenceKind[];
  /**
   * The route "אני ← Biscuit" with both avatars in the header (original §17): `describe(view.me)` is its start.
   * Default: in games of 3–4 players.
   */
  showRoute?: boolean;
  /** Taps in this long after it opened are ignored [D45]; default ARSENAL_CONFIG.armMs. */
  armMs?: number;
  testID?: string;
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const settleSpring = { ...motion.spring.settle, reduceMotion: ReduceMotion.Never };
/** RNGH reports speeds per second; dragClosesSheet reads dp per ms. */
const PER_MS = 1 / 1000;

/**
 * The interference picker (spec §7.3; components.md §13; motion.md §4.4) [D45: two taps, no drag]. Rendered
 * last in the game screen, over everything, and empty while closed.
 *
 * The first tap, "הפרעה" on an opponent's card, opens it aimed at THAT card (original §17): it rises as a sheet
 * (240 ms; reduced motion: a 200 ms fade) over a scrim with a hole, so the target card stays bright above the
 * scrim, framed with an "יעד" chip, and the other cards dim (the screen spreads `arsenal.cardProps`). The
 * header names the target ("יעד: NinaVolt"), or in 3–4 players the route "אני ← Biscuit" with both avatars and
 * shapes; there is no way to change the target in here. Under it the price row (the price "⁦−2⁩ נק׳", the next
 * one, and my score before and after), then every kind this game allows in a 3 × 2 grid, all visible at once
 * on a small phone (pickerLayout), each with its preview, name and price chip; a kind above my level stays in
 * the grid, dimmed, with "רמה N" (D17).
 *
 * The second tap, on a kind, launches it at once (`arsenal.launch`, once per opening) and the sheet closes in
 * 200 ms with a ripple out of the target card (full motion only). Taps in the first `armMs` after it opened are
 * ignored, so a quick double tap can't launch by mistake. A kind that can't go (short of points, the target
 * busy, locked) only says why, in a bubble and to screen readers, with a light haptic.
 *
 * Screen readers: the sheet is a modal group, focus starts on its title, every kind says its price and its
 * target, and a live region says what happened. Android back, the scrim, the close button and the card's button
 * again close it; so does the target leaving, or the game ending.
 */
export function ArsenalOverlay({
  arsenal,
  view,
  describe,
  unlocked = ARSENAL_CONFIG.unlocked,
  showRoute,
  armMs = ARSENAL_CONFIG.armMs,
  testID = 'arsenal',
}: ArsenalOverlayProps) {
  const { t } = useTranslation('game');
  const { t: tUi } = useTranslation('ui');
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const { targetId, close, measureCard, launch } = arsenal;
  const visible = targetId !== null;

  // What the sheet shows: the target it was opened for, kept while it leaves.
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
  // Armed `armMs` after it opened: the taps before are ignored [D45].
  const [armed, setArmed] = useState(armMs <= 0);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setLaunched(false);
      setArmed(armMs <= 0);
    }
  }
  useEffect(() => {
    if (!visible || armMs <= 0) return;
    const id = setTimeout(() => setArmed(true), armMs);
    return () => clearTimeout(id);
  }, [visible, armMs]);
  const { mounted, progress } = usePresence(visible, {
    inMs: motion.duration.trayRise,
    outMs: launched ? m.launch.closeMs : motion.duration.sheetOut,
    reduce,
  });

  // ---- where things are: the overlay in the window, the target's frame, and the overlay's own size ----
  const rootRef = useRef<ComponentRef<typeof View>>(null);
  const [origin, setOrigin] = useState<Point>({ x: 0, y: 0 });
  const [frame, setFrame] = useState<Rect | null>(null);
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const measure = useCallback(() => {
    if (targetId === null) return;
    rootRef.current?.measureInWindow?.((x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      setOrigin((was) => (was.x === x && was.y === y ? was : { x, y }));
    });
    measureCard(targetId, (rect) => {
      const next = targetFrameOf(rect);
      setFrame((was) => (was && sameRect(was, next) ? was : next));
    });
  }, [targetId, measureCard]);
  useEffect(() => {
    if (visible) measure();
  }, [visible, measure, windowSize.width, windowSize.height]);
  const onRootLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      setArea((was) => (was?.width === width && was.height === height ? was : { width, height }));
      measure();
    },
    [measure],
  );
  const hole = frame && relativeTo(frame, origin);

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

  // ---- the second tap: launch, or say why not ----
  const { message, announce } = useLiveAnnouncer(t('listSep'));
  const [ripple, setRipple] = useState<Rect | null>(null);
  const [bubble, setBubble] = useState<{ kind: InterferenceKind; text: string } | null>(null);
  const latest = useRef({ model, targetName, hole, reduce, visible, armed });
  useLayoutEffect(() => {
    latest.current = { model, targetName, hole, reduce, visible, armed };
  });

  const onKind = useCallback(
    (kind: InterferenceKind) => {
      const now = latest.current;
      // Too soon after it opened (a tap that went through, a double tap), or already on its way out.
      if (!now.armed || !now.visible) return;
      const token = now.model?.tokens.find((x) => x.kind === kind);
      if (!token) return;
      if (!launchable(token)) {
        const line = blockedSentence(token.blockedReason!, token, now.targetName, t);
        cue('nudge');
        setBubble({ kind, text: line });
        announce(line);
        return;
      }
      setBubble(null);
      if (!launch(kind)) return;
      setLaunched(true);
      if (!now.reduce && now.hole) setRipple(now.hole);
      announce(t('arsenal.live.launched', { kind: kindWord(kind, t), name: isolate(now.targetName) }));
    },
    [launch, announce, t],
  );
  useEffect(() => {
    if (!bubble) return;
    const id = setTimeout(() => setBubble(null), m.bubble.holdMs);
    return () => clearTimeout(id);
  }, [bubble]);
  const onRippleDone = useCallback(() => setRipple(null), []);

  // ---- the sheet: slides up (or fades), and a downward drag of its head closes it ----
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
        .failOffsetX([-2 * m.closeDragActivate, 2 * m.closeDragActivate])
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

  if (!mounted && !ripple) return null;

  // 3–4 players: from me to the card it was opened from (original §17), both avatars and shapes.
  const route =
    (showRoute ?? view.players.length > 2) && target !== null && view.me !== null
      ? { from: describe(view.me), to: target }
      : null;
  const showSheet = (mounted || visible) && model !== null && target !== null;
  const layout = pickerLayout({
    width: windowSize.width,
    height: windowSize.height,
    bottomInset: insets.bottom,
    count: model?.tokens.length ?? 0,
  });

  return (
    <View
      ref={rootRef}
      style={StyleSheet.absoluteFill}
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityViewIsModal={visible}
      onLayout={onRootLayout}
      testID={testID}
    >
      {showSheet ? (
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
            style={[styles.sheet, { paddingBottom: m.sheet.paddingBottom + insets.bottom }, sheetStyle]}
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
                    {route ? (
                      <RouteLine from={route.from} to={route.to} testID={`${testID}-route`} />
                    ) : (
                      <TargetLine
                        target={target}
                        label={t('arsenal.targetLabel', { name: isolate(targetName) })}
                      />
                    )}
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
            <PriceRow model={model} />
            <View style={styles.grid} testID={`${testID}-grid`}>
              {model.tokens.map((token) => (
                <KindButton
                  key={token.kind}
                  token={token}
                  targetName={targetName}
                  width={layout.columnWidth}
                  reduce={reduce}
                  bubble={bubble?.kind === token.kind ? bubble.text : null}
                  onPress={onKind}
                />
              ))}
            </View>
            <Text style={styles.info} numberOfLines={1}>
              {t('arsenal.info', { seconds: model.seconds })}
            </Text>
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
        {ripple ? <LaunchRipple zone={ripple} reduce={reduce} onDone={onRippleDone} /> : null}
      </View>

      {/* What happened, said to screen readers (Android reads the region, iOS gets announcements). */}
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

/** "יעד: [avatar] NinaVolt 🇩🇪" (components.md §13 header, 2 players). */
function TargetLine({ target, label }: { target: ArsenalTargetInfo; label: string }) {
  const { t } = useTranslation('game');
  const ring = paletteAt(target.colorIndex).ring;
  return (
    <View style={styles.targetLine} accessible accessibilityLabel={label} testID="arsenal-target">
      <Text style={styles.subtitle}>{t('arsenal.target')}</Text>
      <Avatar
        avatarId={target.avatarId}
        size="cell"
        expression={AVATAR_REACTIONS.moods.target}
        style={[styles.miniAvatar, { borderColor: ring }]}
      />
      <Text style={[styles.subtitle, styles.targetName]} numberOfLines={1}>
        {target.name}
      </Text>
      <Flag country={target.country} size="sheet" decorative />
    </View>
  );
}

/**
 * The price row (components.md §13): "מחיר ⁦−2⁩ נק׳ · הבאה: 4" at the start, my score before and after at the
 * end ("53 ← 51"). Short of points (my score dropped while the picker was open) the end says how many are
 * missing instead of a score after a launch that can't happen. One element for screen readers.
 */
function PriceRow({ model }: { model: ArsenalModel }) {
  const { t } = useTranslation('game');
  const short = model.missing > 0;
  const values = {
    cost: model.cost,
    next: model.nextCost,
    score: scoreText(model.score),
    after: scoreText(model.scoreAfter),
    missing: formatScore(model.missing),
  };
  const label = t(short ? 'arsenal.costLabelShort' : 'arsenal.costLabel', values);
  return (
    <View style={styles.priceRow} accessible accessibilityLabel={label} testID="arsenal-cost">
      <View style={styles.priceStart}>
        <Text style={styles.subtitle}>{t('arsenal.price')}</Text>
        <Text style={[m.price.priceStyle, styles.accent]} testID="arsenal-price">
          {signedText(-model.cost)}
        </Text>
        <Text style={[styles.unit, styles.accent]}>{t('arsenal.unit')}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {t('arsenal.nextPrice', { cost: model.nextCost })}
        </Text>
      </View>
      <View style={styles.priceEnd} testID="arsenal-after">
        {short ? (
          <Text style={styles.subtitle}>{t('arsenal.missing', { count: model.missing })}</Text>
        ) : (
          <>
            <Text style={styles.subtitle} numberOfLines={1}>
              {t('arsenal.score')}
            </Text>
            <Text style={[m.price.scoreStyle, styles.myScore]}>{values.score}</Text>
            <Text style={styles.subtitle}>{t('arsenal.routeArrow')}</Text>
            <Text style={[m.price.scoreStyle, styles.myScore]}>{values.after}</Text>
          </>
        )}
      </View>
    </View>
  );
}

const ME = paletteAt(0);

const styles = StyleSheet.create({
  // Layers drawn in measured window coordinates are LTR, so `left` stays physical.
  layer: { ...StyleSheet.absoluteFill, direction: 'ltr' },
  piece: { position: 'absolute', backgroundColor: color.scrim },
  scrim: { backgroundColor: color.scrim },
  sheet: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    maxHeight: `${m.sheet.maxShare * 100}%` as const,
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
    height: m.sheet.handle,
    borderRadius: radius.bar,
    backgroundColor: color.sheet.handle,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    minHeight: m.header.height,
    marginTop: m.header.top,
  },
  headerText: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: m.header.gap },
  title: { ...text('h1'), color: color.text },
  targetLine: { flexDirection: 'row', alignItems: 'center', gap: m.subtitle.gap, minWidth: 0 },
  subtitle: { ...text('label'), color: color.textMuted },
  targetName: { color: color.text, flexShrink: 1 },
  miniAvatar: {
    borderWidth: m.subtitle.avatarRing,
    borderRadius: m.subtitle.avatarRadius,
    overflow: 'hidden',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: m.price.gap,
    height: m.price.height,
    marginTop: m.price.top,
    paddingHorizontal: m.price.paddingX,
    borderRadius: m.price.radius,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  priceStart: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], flexShrink: 1 },
  priceEnd: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  accent: { color: color.accent },
  unit: { ...text('badge') },
  myScore: { color: ME.ring },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: m.grid.gap,
    marginTop: m.grid.top,
  },
  info: {
    ...text('micro'),
    color: color.textMuted,
    marginTop: m.info.top,
    lineHeight: m.info.height,
    textAlign: 'center',
  },
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
