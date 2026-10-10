import type { CellIndex, Digit } from '@sudoku-fight/engine';
import { Image } from 'expo-image';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type Insets, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';

import { AVATARS } from '../../assets/avatars';
import { color, type PlayerPalette, size, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import {
  PENDING_RING_OPACITY,
  POP_FROM,
  shake,
  springs,
  timing,
  URGENT_BLINK_LOW,
  WRONG_DIGIT_SHRINK,
} from './animation';
import { type CellLock, type CellModel, type CellPlayer, shownWrongDigits } from './boardModel';
import { type BoardCorner, type BoardGeometry, fontPx, geometryForCell, px } from './geometry';
import { cellHint, cellLabel } from './labels';

/**
 * One board cell (components.md §11.2–11.4, motion.md §4.1–4.3). It draws a CellModel and plays the flashes it
 * is given; it decides nothing. Fixed corners: owner glyph top-left, lock seconds top-right, wrong digits
 * bottom-right, digit or mini avatar in the centre (the board is always LTR, so left and right are physical).
 */

export type CellFlashKind =
  /** #12: a correct digit, in the solver's colour. */
  | 'correct'
  /** #13: a wrong digit: red flash and shake. */
  | 'wrong'
  /** #11: a tap on someone else's lock, or on my cell during its re-lock wait: shake, no red. */
  | 'denied';

export interface CellFlash {
  kind: CellFlashKind;
  /** A new id plays the flash again (the same kind can come twice in a row). */
  id: number;
  /** 'wrong': the digit tried. It shows full size in red, then shrinks toward its corner mark. */
  digit?: Digit;
}

export interface CellProps {
  cell: CellModel;
  /** The board's geometry; a lone cell defaults to the design's 38.4 dp. */
  geometry?: BoardGeometry;
  flash?: CellFlash | null;
  /** Called for interactive cells only (cell.interactive). Pass a stable function. */
  onCellPress?: (index: CellIndex) => void;
  /** The board's corner cells round their outer corner. */
  corner?: BoardCorner | null;
  /** The board sets this per cell (geometry.cellHitSlop); a lone cell reaches 44 dp on every side. */
  hitSlop?: Insets;
  testID?: string;
}

const DEFAULT_GEOMETRY = geometryForCell();
const { lockRing, lockEdge, lockPulse, focus } = tokens.border;
const players = color.players;

/** An opponent's avatar rises this much when the cell also has wrong digits (components.md §11.4: 3 dp). */
const AVATAR_LIFT = size.lockBadge.inset;

/** The pause mark in my pill (components.md §11.3 #10): two 2 × 7 bars, drawn like an icon. */
const PAUSE_GLYPH = { width: 6, height: 7, bar: 2 } as const;

function cornerRadius(corner: BoardCorner | null | undefined, r: number): ViewStyle | null {
  if (!corner) return null;
  return {
    topLeft: { borderTopLeftRadius: r },
    topRight: { borderTopRightRadius: r },
    bottomLeft: { borderBottomLeftRadius: r },
    bottomRight: { borderBottomRightRadius: r },
  }[corner];
}

function CellView({
  cell,
  geometry: g = DEFAULT_GEOMETRY,
  flash,
  onCellPress,
  corner,
  hitSlop,
  testID,
}: CellProps) {
  const { t } = useTranslation('board');
  const reduce = useReduceMotion();
  const palette: PlayerPalette | null = cell.player ? (players[cell.player.colorIndex] ?? null) : null;
  const base = cell.alt ? color.board.cellAlt : color.board.cell;
  const tint = (cell.kind === 'solved' || cell.kind === 'myLock') && palette ? palette.tint : null;
  const radius = px(g, tokens.radius.board);
  const cornerStyle = cornerRadius(corner, radius);

  // Shake: a wrong digit or a "taken" tap moves this cell only. Reduced motion: no movement (frames instead).
  const shakeX = useSharedValue(0);
  const shaken = useRef<number | null>(null);
  const flashId = flash?.id;
  const flashKind = flash?.kind;
  useEffect(() => {
    if (flashId === undefined || flashKind === 'correct' || reduce || shaken.current === flashId) return;
    shaken.current = flashId;
    shakeX.set(0);
    shakeX.set(shake());
  }, [flashId, flashKind, reduce, shakeX]);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.get() }] }));

  const lockRingColor =
    cell.kind === 'pending' ? players[0].ring : cell.lock && palette ? palette.ring : null;
  const lifted = cell.kind === 'oppLock' && cell.wrong.length > 0;
  const wrongShown = shownWrongDigits(cell);
  const interactive = cell.interactive && !!onCellPress;
  // My own lock is not "disabled" for a screen reader: it is the selected cell, and a tap just does nothing.
  const a11yDisabled = !cell.interactive && cell.kind !== 'myLock';
  const outer = Math.max(0, (size.touch - g.cell) / 2);
  const id = testID ?? `cell-${cell.name}`;

  return (
    <Pressable
      onPress={interactive && onCellPress ? () => onCellPress(cell.index) : undefined}
      disabled={a11yDisabled}
      hitSlop={hitSlop ?? outer}
      accessibilityRole="button"
      accessibilityLabel={cellLabel(cell, t)}
      accessibilityHint={cellHint(cell, t)}
      accessibilityState={{ disabled: a11yDisabled, selected: cell.kind === 'myLock' }}
      style={{ width: g.cell, height: g.cell }}
      testID={id}
    >
      <Animated.View
        testID={`${id}-face`}
        style={[styles.content, { backgroundColor: tint ?? base }, cornerStyle, shakeStyle]}
      >
        {flash ? (
          <FlashLayer
            key={`under-${flash.id}`}
            layer="under"
            flash={flash}
            palette={palette}
            base={base}
            g={g}
            reduce={reduce}
            cornerStyle={cornerStyle}
          />
        ) : null}

        {cell.kind === 'myLock' && palette && cell.lock && !cell.lock.paused && !reduce ? (
          <PulseBand palette={palette} g={g} cornerStyle={cornerStyle} />
        ) : null}

        {lockRingColor ? (
          <LockRing
            ringColor={lockRingColor}
            edgeColor={cell.kind !== 'pending' && palette ? palette.lockEdge : null}
            strength={cell.kind === 'pending' ? PENDING_RING_OPACITY : 1}
            enterMs={cell.kind === 'oppLock' ? motion.duration.stateChange : motion.duration.tapFeedbackMax}
            g={g}
            reduce={reduce}
            corner={corner}
          />
        ) : null}

        {cell.digit !== null ? (
          <CellDigit
            digit={cell.digit}
            given={cell.kind === 'given'}
            digitColor={cell.kind === 'solved' && palette ? palette.digit : color.board.given}
            g={g}
            popId={flash?.kind === 'correct' ? flash.id : undefined}
            reduce={reduce}
          />
        ) : null}

        {cell.kind === 'oppLock' && cell.player ? (
          <MiniAvatar player={cell.player} g={g} lifted={lifted} reduce={reduce} />
        ) : null}

        {cell.kind === 'solved' && palette ? <SeatGlyph palette={palette} g={g} /> : null}

        {cell.kind === 'myLock' && palette && cell.lock ? (
          <SecondsPill lock={cell.lock} palette={palette} g={g} reduce={reduce} />
        ) : null}

        {wrongShown.length ? (
          <Text
            style={[
              text('wrongDigit'),
              styles.wrong,
              {
                fontSize: fontPx(g, tokens.type.wrongDigit.size),
                lineHeight: fontPx(g, tokens.type.wrongDigit.lineHeight),
                right: px(g, size.wrongDigitInset.right),
                bottom: px(g, size.wrongDigitInset.bottom),
              },
            ]}
            testID="cell-wrong"
          >
            {wrongShown.join(' ')}
          </Text>
        ) : null}

        {flash ? (
          <FlashLayer
            key={`over-${flash.id}`}
            layer="over"
            flash={flash}
            palette={palette}
            base={base}
            g={g}
            reduce={reduce}
            cornerStyle={cornerStyle}
          />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------------------

/** My lock's pulse (`sf-lock`): a 7 dp inner band at 28% fading in and out over 1.6 s. Never under reduced motion. */
function PulseBand({
  palette,
  g,
  cornerStyle,
}: {
  palette: PlayerPalette;
  g: BoardGeometry;
  cornerStyle: ViewStyle | null;
}) {
  const level = useSharedValue(0);
  useEffect(() => {
    level.set(withRepeat(withTiming(1, timing(motion.loop.lockPulse / 2, 'loop')), -1, true));
    return () => cancelAnimation(level);
  }, [level]);
  const style = useAnimatedStyle(() => ({ opacity: level.get() }));
  return (
    <Animated.View
      pointerEvents="none"
      testID="cell-pulse"
      style={[
        StyleSheet.absoluteFill,
        { borderWidth: px(g, lockPulse), borderColor: palette.lockPulse },
        cornerStyle,
        style,
      ]}
    />
  );
}

/**
 * The 3 dp lock ring plus its 1 dp inner edge (components.md §11.3 #5, #6, #9). It fades in when the lock
 * appears and out when it goes; `strength` is 0.5 while my tap waits for the server.
 */
function LockRing({
  ringColor,
  edgeColor,
  strength,
  enterMs,
  g,
  reduce,
  corner,
}: {
  ringColor: string;
  edgeColor: string | null;
  strength: number;
  enterMs: number;
  g: BoardGeometry;
  reduce: boolean;
  corner: BoardCorner | null | undefined;
}) {
  const opacity = useSharedValue(reduce ? strength : 0);
  useEffect(() => {
    opacity.set(reduce ? strength : withTiming(strength, timing(enterMs)));
  }, [opacity, strength, reduce, enterMs]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const ring = px(g, lockRing);
  const radius = px(g, tokens.radius.board);
  // The release fade is a layout animation on a wrapper, apart from the animated opacity (Reanimated's rule).
  return (
    <Animated.View
      pointerEvents="none"
      exiting={FadeOut.duration(motion.duration.lockAutoRelease)}
      style={StyleSheet.absoluteFill}
    >
      <Animated.View pointerEvents="none" testID="cell-ring" style={[StyleSheet.absoluteFill, style]}>
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderWidth: ring, borderColor: ringColor },
            cornerRadius(corner, radius),
          ]}
        />
        {edgeColor ? (
          <View
            testID="cell-ring-edge"
            style={[
              styles.edge,
              { top: ring, left: ring, right: ring, bottom: ring },
              { borderWidth: px(g, lockEdge), borderColor: edgeColor },
              cornerRadius(corner, Math.max(0, radius - ring)),
            ]}
          />
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

/** A given (Rubik 600) or solved (Rubik 500, solver's colour) digit; it pops when a correct move lands. */
function CellDigit({
  digit,
  given,
  digitColor,
  g,
  popId,
  reduce,
}: {
  digit: Digit;
  given: boolean;
  digitColor: string;
  g: BoardGeometry;
  popId: number | undefined;
  reduce: boolean;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const played = useRef<number | null>(null);
  useEffect(() => {
    if (popId === undefined || played.current === popId) return;
    played.current = popId;
    // Pop 0.6 → 1 with the `pop` spring; reduced motion: a 140 ms fade, no scale (motion.md `digit.pop`).
    opacity.set(0);
    opacity.set(withTiming(1, timing(motion.duration.tapFeedbackMax)));
    if (!reduce) {
      scale.set(POP_FROM);
      scale.set(withSpring(1, springs.pop));
    }
  }, [popId, reduce, scale, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));
  const type = given ? tokens.type.digitCell : tokens.type.digitCellOwned;
  return (
    <Animated.View style={style}>
      <Text
        style={[
          text(given ? 'digitCell' : 'digitCellOwned'),
          { color: digitColor, fontSize: fontPx(g, type.size), lineHeight: fontPx(g, type.lineHeight) },
        ]}
        testID="cell-digit"
      >
        {digit}
      </Text>
    </Animated.View>
  );
}

/** The holder's 22 dp avatar in an opponent's lock; it pops in, and rises 3 dp to clear wrong digits (§11.4). */
function MiniAvatar({
  player,
  g,
  lifted,
  reduce,
}: {
  player: CellPlayer;
  g: BoardGeometry;
  lifted: boolean;
  reduce: boolean;
}) {
  const scale = useSharedValue(reduce ? 1 : POP_FROM);
  useEffect(() => {
    scale.set(reduce ? 1 : withSpring(1, springs.pop));
  }, [scale, reduce]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const side = px(g, size.avatar.cell.size);
  return (
    <Animated.View style={[style, lifted ? { top: -px(g, AVATAR_LIFT) } : null]} testID="cell-avatar">
      <Image
        source={AVATARS[player.avatar]}
        style={{ width: side, height: side, borderRadius: px(g, size.avatar.cell.radius) }}
        contentFit="cover"
        accessible={false}
      />
    </Animated.View>
  );
}

/** The solver's shape (● ▲ ■ ◆) at the top-left, so ownership never rests on colour alone (spec §22). */
function SeatGlyph({ palette, g }: { palette: PlayerPalette; g: BoardGeometry }) {
  const side = px(g, size.solverGlyph.size);
  const inset = px(g, size.solverGlyph.inset);
  return (
    <View style={[styles.glyph, { top: inset, left: inset }]} testID={`cell-glyph-${palette.shapeName}`}>
      <Svg width={side} height={side} viewBox="0 0 24 24">
        <Path d={palette.shapePath} fill={palette.glyph} />
      </Svg>
    </View>
  );
}

/** My lock's seconds (top-right). Gold and blinking in the last seconds; a pause mark while stopped. */
function SecondsPill({
  lock,
  palette,
  g,
  reduce,
}: {
  lock: CellLock;
  palette: PlayerPalette;
  g: BoardGeometry;
  reduce: boolean;
}) {
  const scale = useSharedValue(reduce ? 1 : POP_FROM);
  const blink = useSharedValue(1);
  useEffect(() => {
    scale.set(reduce ? 1 : withSpring(1, springs.pop));
  }, [scale, reduce]);
  const urgent = lock.urgent;
  useEffect(() => {
    cancelAnimation(blink);
    blink.set(1);
    if (urgent && !reduce)
      blink.set(
        withRepeat(withTiming(URGENT_BLINK_LOW, timing(motion.loop.lockUrgentBlink / 2, 'loop')), -1, true),
      );
    return () => cancelAnimation(blink);
  }, [blink, urgent, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: blink.get(), transform: [{ scale: scale.get() }] }));

  const badge = size.lockBadge;
  const fg = urgent ? color.onAccent : palette.onRing;
  const glyphH = px(g, PAUSE_GLYPH.height);
  return (
    <Animated.View
      testID="cell-pill-slot"
      exiting={FadeOut.duration(motion.duration.lockAutoRelease)}
      style={[styles.pillSlot, { top: px(g, badge.inset), right: px(g, badge.inset) }]}
    >
      <Animated.View
        testID={lock.paused ? 'cell-pill-paused' : urgent ? 'cell-pill-urgent' : 'cell-pill'}
        style={[
          styles.pill,
          {
            minWidth: px(g, badge.minWidth),
            height: px(g, badge.height),
            paddingHorizontal: px(g, badge.paddingX),
            borderRadius: px(g, tokens.radius.badge),
            backgroundColor: urgent ? color.accent : palette.ring,
          },
          style,
        ]}
      >
        {lock.paused ? (
          <Svg
            width={(glyphH * PAUSE_GLYPH.width) / PAUSE_GLYPH.height}
            height={glyphH}
            viewBox={`0 0 ${PAUSE_GLYPH.width} ${PAUSE_GLYPH.height}`}
          >
            <Rect x={0} y={0} width={PAUSE_GLYPH.bar} height={PAUSE_GLYPH.height} fill={fg} />
            <Rect
              x={PAUSE_GLYPH.width - PAUSE_GLYPH.bar}
              y={0}
              width={PAUSE_GLYPH.bar}
              height={PAUSE_GLYPH.height}
              fill={fg}
            />
          </Svg>
        ) : (
          <Text
            style={[
              text('lockTimer'),
              styles.teko,
              {
                color: fg,
                fontSize: fontPx(g, tokens.type.lockTimer.size),
                lineHeight: fontPx(g, tokens.type.lockTimer.lineHeight),
              },
            ]}
          >
            {lock.seconds}
          </Text>
        )}
      </Animated.View>
    </Animated.View>
  );
}

/** One drawn part of a flash: what it looks like and how it fades. */
export interface FlashPart {
  kind: 'fill' | 'frame' | 'digit';
  /** 'solver': the solver's ring colour; 'base': the cell's own colour (reduced cross-fade). */
  tone: 'solver' | 'base' | 'wrongFlash' | 'danger' | 'wrongDigit' | 'ring';
  /** Opacity it starts at, before fading to 0. */
  from: number;
  /** How long it holds before fading. */
  holdMs: number;
  fadeMs: number;
  /** Frame width in design dp. */
  width?: number;
}

/**
 * The flashes of a move (motion.md §4.2, §4.3, `cell.denied`). 'under' parts sit below the digit, 'over' parts
 * above everything.
 * - correct: the solver's ring colour at 60% fading over 700 ms. Reduced: the old cell colour fades off the new
 *   tint in 240 ms (a cross-fade, no flash).
 * - wrong: red at 55% fading over 550 ms, and the tried digit full size in red, which shrinks and fades after
 *   300 ms. Reduced: a 2 dp red frame for 300 ms, then a short fade.
 * - denied: the shake alone. Reduced: the ring thickens from 3 to 5 dp for 300 ms.
 */
export function flashPart(layer: 'under' | 'over', flash: CellFlash, reduce: boolean): FlashPart | null {
  const d = motion.duration;
  if (layer === 'under') {
    if (flash.kind === 'correct')
      return reduce
        ? { kind: 'fill', tone: 'base', from: 1, holdMs: 0, fadeMs: d.stateChange }
        : {
            kind: 'fill',
            tone: 'solver',
            from: tokens.opacity.correctFlash,
            holdMs: 0,
            fadeMs: d.correctFlash,
          };
    if (flash.kind === 'wrong' && !reduce)
      return { kind: 'fill', tone: 'wrongFlash', from: 1, holdMs: 0, fadeMs: d.wrongFlash };
    return null;
  }
  if (flash.kind === 'wrong') {
    if (reduce)
      return {
        kind: 'frame',
        tone: 'danger',
        from: 1,
        holdMs: d.wrongShake,
        fadeMs: d.reducedFade,
        width: focus,
      };
    if (flash.digit !== undefined)
      return { kind: 'digit', tone: 'wrongDigit', from: 1, holdMs: d.wrongShake, fadeMs: d.stateChange };
    return null;
  }
  if (flash.kind === 'denied' && reduce)
    return {
      kind: 'frame',
      tone: 'ring',
      from: 1,
      holdMs: d.wrongShake,
      fadeMs: d.tapFeedbackMin,
      width: lockRing + focus,
    };
  return null;
}

/** Draws one flash part, and plays it once when it mounts (the cell mounts one per flash id). */
function FlashLayer({
  layer,
  flash,
  palette,
  base,
  g,
  reduce,
  cornerStyle,
}: {
  layer: 'under' | 'over';
  flash: CellFlash;
  palette: PlayerPalette | null;
  base: string;
  g: BoardGeometry;
  reduce: boolean;
  cornerStyle: ViewStyle | null;
}) {
  const part = flashPart(layer, flash, reduce);
  const opacity = useSharedValue(part?.from ?? 0);
  const scale = useSharedValue(1);
  const played = useRef(false);
  const kind = part?.kind;
  const holdMs = part?.holdMs ?? 0;
  const fadeMs = part?.fadeMs ?? 0;
  useEffect(() => {
    if (!kind || played.current) return;
    played.current = true;
    const fade = withTiming(0, timing(fadeMs, kind === 'digit' ? 'exit' : 'standard'));
    opacity.set(holdMs ? withDelay(holdMs, fade) : fade);
    if (kind === 'digit')
      scale.set(withDelay(holdMs, withTiming(WRONG_DIGIT_SHRINK, timing(motion.duration.stateChange))));
  }, [kind, holdMs, fadeMs, opacity, scale]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }));

  if (!part) return null;
  const tone = {
    solver: palette?.ring ?? null,
    base,
    wrongFlash: color.board.wrongFlash,
    danger: color.danger,
    wrongDigit: color.board.wrongDigit,
    ring: palette?.ring ?? players[0].ring,
  }[part.tone];
  if (!tone) return null;

  if (part.kind === 'digit') {
    const type = tokens.type.digitCell;
    return (
      <Animated.View pointerEvents="none" style={[styles.center, style]} testID="cell-flash-digit">
        <Text
          style={[
            text('digitCell'),
            { color: tone, fontSize: fontPx(g, type.size), lineHeight: fontPx(g, type.lineHeight) },
          ]}
        >
          {flash.digit}
        </Text>
      </Animated.View>
    );
  }
  return (
    <Animated.View
      pointerEvents="none"
      testID={`cell-flash-${flash.kind}-${part.kind}`}
      style={[
        StyleSheet.absoluteFill,
        part.kind === 'fill'
          ? { backgroundColor: tone }
          : { borderWidth: px(g, part.width ?? focus), borderColor: tone },
        cornerStyle,
        style,
      ]}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------

const samePlayer = (a: CellPlayer | null, b: CellPlayer | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.id === b.id &&
    a.colorIndex === b.colorIndex &&
    a.name === b.name &&
    a.avatar === b.avatar &&
    a.isMe === b.isMe);

const sameLock = (a: CellLock | null, b: CellLock | null) =>
  a === b || (!!a && !!b && a.seconds === b.seconds && a.paused === b.paused && a.urgent === b.urgent);

const sameDigits = (a: readonly Digit[], b: readonly Digit[]) =>
  a === b || (a.length === b.length && a.every((d, k) => d === b[k]));

/**
 * Two cell models draw the same (a new model on every countdown tick must not redraw 81 cells). Runs 81 times
 * a tick (the board's memo too), so it allocates nothing.
 */
export function sameCell(a: CellModel, b: CellModel): boolean {
  return (
    a === b ||
    (a.index === b.index &&
      a.kind === b.kind &&
      a.digit === b.digit &&
      a.alt === b.alt &&
      a.interactive === b.interactive &&
      a.cooldown === b.cooldown &&
      sameDigits(a.wrong, b.wrong) &&
      samePlayer(a.player, b.player) &&
      sameLock(a.lock, b.lock))
  );
}

export const Cell = memo(
  CellView,
  (a, b) =>
    sameCell(a.cell, b.cell) &&
    a.geometry === b.geometry &&
    a.flash?.id === b.flash?.id &&
    a.flash?.kind === b.flash?.kind &&
    a.onCellPress === b.onCellPress &&
    a.corner === b.corner &&
    a.hitSlop === b.hitSlop &&
    a.testID === b.testID,
);

const styles = StyleSheet.create({
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  edge: { position: 'absolute' },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { position: 'absolute' },
  wrong: { position: 'absolute', color: color.board.wrongDigit },
  pillSlot: { position: 'absolute' },
  // Teko is centred by line height, not by Android's font padding (components.md §0.4).
  teko: { includeFontPadding: false },
  pill: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
});
