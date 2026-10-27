import type { CellIndex, Digit } from '@sudoku-fight/engine';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Insets, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { AvatarArt } from '../../avatars';
import { color, type PlayerPalette, radius, size, text, tokens } from '../../theme';
import { Icon } from '../Icon';
import { motion, useReduceMotion } from '../../theme/motion';
import { Text } from '../ui/Text';
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
 *
 * A lock that goes (motion.md `lock.release`) fades its ring and pill out from the cell itself: the cell keeps
 * drawing their last look while they fade (240 ms; reduced motion: the 200 ms fade), then drops them. Never a
 * Reanimated layout animation (`exiting`): the game's end clears every lock at once, and a layout animation
 * still running when the results replaced the game screen is the best fit for Moshe's black screens of 1.0.0.
 * Nothing on the game screen uses layout animations (src/__tests__/noLayoutAnimationsInGame.test.ts).
 */

export type CellFlashKind =
  /** #12: a correct digit, in the solver's colour. */
  | 'correct'
  /** #13: a wrong digit: red flash and shake. */
  | 'wrong'
  /** #11: a tap on someone else's lock, or on my cell during its re-lock wait: shake, no red. */
  | 'denied'
  /** A wrong tap in a tap stage (components.md §19.7): a red X over the cell, a red wash and a shake. */
  | 'miss';

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
  /** A tap stage's board: a tap is the move (the hint says so; there is no keypad). */
  tap?: boolean;
  testID?: string;
}

const DEFAULT_GEOMETRY = geometryForCell();
const { lockRing, lockEdge, lockPulse, focus } = tokens.border;
const players = color.players;

/** An opponent's avatar rises this much when the cell also has wrong digits (components.md §11.4: 3 dp). */
const AVATAR_LIFT = size.lockBadge.inset;

/** The pause mark in my pill (components.md §11.3 #10): two 2 × 7 bars, drawn like an icon. */
const PAUSE_GLYPH = { width: 6, height: 7, bar: 2 } as const;

/** A find's digit already on the board (Lv-Find): a 30 dp dark chip with a 20 dp digit, at the design's cell. */
const TARGET_CHIP = { size: 30, font: 20 } as const;
/** A wrong tap's X (components.md §19.7): two 24 × 2 bars. */
const CROSS = { length: 24, bar: 2 } as const;
/** A found error (Idea-1): a 24 dp strike, and the right digit in a 16 dp disc 2 dp from the corner. */
const CORRECTION = { strike: 24, disc: 16, inset: 2 } as const;

/** How a lock's ring looks: what its fading copy keeps drawing once the lock has gone. */
interface RingLook {
  ringColor: string;
  edgeColor: string | null;
  strength: number;
  enterMs: number;
}

const sameRing = (a: RingLook, b: RingLook) =>
  a.ringColor === b.ringColor &&
  a.edgeColor === b.edgeColor &&
  a.strength === b.strength &&
  a.enterMs === b.enterMs;

/** My lock's seconds pill as it was drawn. */
interface PillLook {
  lock: CellLock;
  palette: PlayerPalette;
}

const samePill = (a: PillLook, b: PillLook) => a.palette === b.palette && sameLock(a.lock, b.lock);

/** The JS side gives up waiting for a fade's end this long after it should have ended. */
const GONE_SAFETY_MS = 100;

/**
 * A part of the cell (a lock's ring, my pill) that was there a moment ago and no longer is: true from the render
 * it goes in until `gone`, while it fades out. Derived while rendering, so the part stays mounted in the very
 * frame its lock goes; a new lock on the cell ends it. The cell's state changes only when the part comes or goes
 * (not on every tick of my pill's seconds): the part keeps its own last look (useLastLook).
 */
function useLeaving(present: boolean): [boolean, () => void] {
  const [held, setHeld] = useState({ was: present, leaving: false });
  let shown = held;
  if (present !== held.was) {
    shown = { was: present, leaving: !present };
    setHeld(shown);
  }
  const gone = useCallback(() => setHeld((h) => (h.leaving ? { ...h, leaving: false } : h)), []);
  return [shown.leaving, gone];
}

/** What a part draws: its look now, or (its lock gone) the last one it had, while it fades out. */
function useLastLook<T>(look: T | null, same: (a: T, b: T) => boolean): T | null {
  const [kept, setKept] = useState<T | null>(look);
  if (look !== null && (kept === null || !same(look, kept))) {
    setKept(look);
    return look;
  }
  return look ?? kept;
}

/**
 * A part whose lock has gone fades to 0 (motion.md `lock.release`: 240 ms, `exit`; reduced motion: the 200 ms
 * fade), then calls onGone. A JS timer is the safety net should the UI thread's end never come.
 */
function useFadeAway(level: SharedValue<number>, leaving: boolean, reduce: boolean, onGone?: () => void) {
  const done = useRef(onGone);
  useEffect(() => {
    done.current = onGone;
  });
  useEffect(() => {
    if (!leaving) return;
    const ms = reduce ? motion.duration.reducedFade : motion.duration.lockAutoRelease;
    const finish = () => done.current?.();
    level.set(
      withTiming(0, timing(ms, 'exit'), (finished) => {
        if (finished) scheduleOnRN(finish);
      }),
    );
    const safety = setTimeout(finish, ms + GONE_SAFETY_MS);
    return () => {
      clearTimeout(safety);
      cancelAnimation(level);
    };
  }, [leaving, reduce, level]);
}

function cornerRadius(corner: BoardCorner | null | undefined, r: number): ViewStyle | null {
  if (!corner) return null;
  return {
    topLeft: { borderTopLeftRadius: r },
    topRight: { borderTopRightRadius: r },
    bottomLeft: { borderBottomLeftRadius: r },
    bottomRight: { borderBottomRightRadius: r },
  }[corner];
}

/** A cell's ground: in a stage's region, outside it, or on a board without one (CellModel.area null). */
export function regionBase(area: CellModel['area'], alt: boolean): string {
  const board = color.board;
  if (area === 'in') return alt ? board.focusCellAlt : board.focusCell;
  if (area === 'out') return alt ? board.outCellAlt : board.outCell;
  return alt ? board.cellAlt : board.cell;
}

function CellView({
  cell,
  geometry: g = DEFAULT_GEOMETRY,
  flash,
  onCellPress,
  corner,
  hitSlop,
  tap = false,
  testID,
}: CellProps) {
  const { t } = useTranslation('board');
  const reduce = useReduceMotion();
  const palette: PlayerPalette | null = cell.player ? (players[cell.player.colorIndex] ?? null) : null;
  // A stage's region (levels-ui.md §2.2, D75a): cream inside, blue-grey outside with its givens in givenOut,
  // the same for every kind and shape; a board without one keeps its own colours. A solved cell's tint wins.
  const out = cell.area === 'out';
  const base = regionBase(cell.area, cell.alt);
  // My tap waiting for the server (#9), and my digit waiting for the connection (#14, [D42]): the half ring.
  const waiting = cell.kind === 'pending' || cell.kind === 'queued';
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

  // A lock's ring, with its timer or without one (a stage alone: BoardModelOptions.lockTimer false).
  const held = cell.kind === 'myLock' || cell.kind === 'oppLock';
  const lockRingColor = waiting ? players[0].ring : held && palette ? palette.ring : null;
  // The lock's ring and my pill; once the lock goes, their last look fades out (motion.md `lock.release`).
  const ringLook: RingLook | null = lockRingColor
    ? {
        ringColor: lockRingColor,
        edgeColor: !waiting && palette ? palette.lockEdge : null,
        strength: waiting ? PENDING_RING_OPACITY : 1,
        enterMs: cell.kind === 'oppLock' ? motion.duration.stateChange : motion.duration.tapFeedbackMax,
      }
    : null;
  const [ringLeaving, ringGone] = useLeaving(ringLook !== null);
  const pillLook: PillLook | null =
    cell.kind === 'myLock' && palette && cell.lock ? { lock: cell.lock, palette } : null;
  const [pillLeaving, pillGone] = useLeaving(pillLook !== null);
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
      accessibilityHint={cellHint(cell, t, tap)}
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

        {ringLook || ringLeaving ? (
          <LockRing look={ringLook} g={g} reduce={reduce} corner={corner} onGone={ringGone} />
        ) : null}

        {cell.correction && cell.digit !== null ? (
          <Correction wrong={cell.correction.wrong} right={cell.digit} g={g} corner={corner} />
        ) : cell.mark === 'target' && cell.digit !== null ? (
          <TargetChip digit={cell.digit} g={g} />
        ) : cell.digit !== null ? (
          <CellDigit
            digit={cell.digit}
            given={cell.kind === 'given'}
            digitColor={
              (cell.kind === 'solved' || cell.kind === 'queued') && palette
                ? palette.digit
                : out
                  ? color.board.givenOut
                  : color.board.given
            }
            g={g}
            popId={flash?.kind === 'correct' ? flash.id : undefined}
            reduce={reduce}
          />
        ) : null}

        {cell.kind === 'queued' && palette ? <QueuedMark palette={palette} g={g} /> : null}

        {cell.kind === 'oppLock' && cell.player ? (
          <MiniAvatar player={cell.player} g={g} lifted={lifted} reduce={reduce} />
        ) : null}

        {cell.kind === 'solved' && palette && !cell.correction ? <SeatGlyph palette={palette} g={g} /> : null}

        {pillLook || pillLeaving ? (
          <SecondsPill look={pillLook} g={g} reduce={reduce} onGone={pillGone} />
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
 * appears, and out when it goes (`look` null: it keeps its last look, and the cell keeps it until `onGone`);
 * `strength` is 0.5 while my tap waits for the server.
 */
function LockRing({
  look,
  g,
  reduce,
  corner,
  onGone,
}: {
  look: RingLook | null;
  g: BoardGeometry;
  reduce: boolean;
  corner: BoardCorner | null | undefined;
  onGone?: () => void;
}) {
  const shown = useLastLook(look, sameRing);
  const leaving = look === null;
  const strength = shown?.strength ?? 1;
  const enterMs = shown?.enterMs ?? motion.duration.stateChange;
  const opacity = useSharedValue(reduce || leaving ? strength : 0);
  useEffect(() => {
    if (leaving) return;
    opacity.set(reduce ? strength : withTiming(strength, timing(enterMs)));
  }, [opacity, strength, reduce, enterMs, leaving]);
  useFadeAway(opacity, leaving, reduce, onGone);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  if (!shown) return null;
  const { ringColor, edgeColor } = shown;
  const ring = px(g, lockRing);
  const radius = px(g, tokens.radius.board);
  return (
    <Animated.View
      pointerEvents="none"
      testID={leaving ? 'cell-ring-leaving' : 'cell-ring'}
      style={[StyleSheet.absoluteFill, style]}
    >
      <View
        style={[
          StyleSheet.absoluteFill,
          { borderWidth: ring, borderColor: ringColor },
          cornerRadius(corner, radius),
        ]}
        testID="cell-ring-line"
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
      <AvatarArt
        avatarId={player.avatar}
        size={side}
        crop="head"
        radius={px(g, size.avatar.cell.radius)}
        testID="cell-avatar-art"
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

/** A find stage's digit already on the board (Lv-Find): a dark rounded chip, so the eye finds every 6 at once. */
function TargetChip({ digit, g }: { digit: Digit; g: BoardGeometry }) {
  const side = px(g, TARGET_CHIP.size);
  return (
    <View
      style={[
        styles.chip,
        { width: side, height: side, borderRadius: px(g, radius.xs), backgroundColor: color.board.given },
      ]}
      testID="cell-target"
    >
      <Text
        style={[
          text('digitCell'),
          {
            color: color.board.cell,
            fontSize: fontPx(g, TARGET_CHIP.font),
            lineHeight: fontPx(g, TARGET_CHIP.font),
          },
        ]}
        testID="cell-digit"
      >
        {digit}
      </Text>
    </View>
  );
}

/**
 * A planted error I found (spot the error, Idea-1): the wrong digit that stood here, struck in red, the right
 * one small in a success disc at the top-right, and a 2 dp success ring around the cell. Static: what it
 * shows is the information, so it is the same with reduced motion.
 */
function Correction({
  wrong,
  right,
  g,
  corner,
}: {
  wrong: Digit;
  right: Digit;
  g: BoardGeometry;
  corner: BoardCorner | null | undefined;
}) {
  const type = tokens.type.digitCell;
  const disc = px(g, CORRECTION.disc);
  const inset = px(g, CORRECTION.inset);
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderWidth: px(g, focus), borderColor: color.success },
          cornerRadius(corner, px(g, tokens.radius.board)),
        ]}
        testID="cell-correction-ring"
      />
      <Text
        style={[
          text('digitCell'),
          {
            color: color.board.wrongDigit,
            fontSize: fontPx(g, type.size),
            lineHeight: fontPx(g, type.lineHeight),
          },
        ]}
        testID="cell-correction-wrong"
      >
        {wrong}
      </Text>
      <View
        pointerEvents="none"
        style={[
          styles.strike,
          {
            width: px(g, CORRECTION.strike),
            height: px(g, CROSS.bar),
            backgroundColor: color.board.wrongDigit,
          },
        ]}
        testID="cell-correction-strike"
      />
      <View
        style={[
          styles.fix,
          { top: inset, right: inset, width: disc, height: disc, borderRadius: disc / 2 },
          { backgroundColor: color.success },
        ]}
        testID="cell-correction-right"
      >
        <Text
          style={[
            text('wrongDigit'),
            {
              color: color.board.given,
              fontSize: fontPx(g, tokens.type.wrongDigit.size),
              lineHeight: fontPx(g, tokens.type.wrongDigit.lineHeight),
            },
          ]}
        >
          {right}
        </Text>
      </View>
    </>
  );
}

/**
 * My digit waiting for the connection (components.md §11.3 #14, [D42]): a small wifi-off mark at the top-right,
 * in my glyph colour, where my lock's seconds were. Static (no pulse, no blink), so reduced motion changes
 * nothing; the screen reader hears "ממתין לחיבור" in the cell's label.
 */
function QueuedMark({ palette, g }: { palette: PlayerPalette; g: BoardGeometry }) {
  const side = px(g, size.solverGlyph.size);
  const inset = px(g, size.lockBadge.inset);
  return (
    <View style={[styles.glyph, { top: inset, right: inset }]} testID="cell-queued-mark">
      <Icon name="wifiOff" size={side} color={palette.glyph} />
    </View>
  );
}

/**
 * My lock's seconds (top-right). Gold and blinking in the last seconds; a pause mark while stopped. When the
 * lock goes (`look` null) it fades out as it last was, until `onGone`.
 */
function SecondsPill({
  look,
  g,
  reduce,
  onGone,
}: {
  look: PillLook | null;
  g: BoardGeometry;
  reduce: boolean;
  onGone?: () => void;
}) {
  const shown = useLastLook(look, samePill);
  const leaving = look === null;
  const scale = useSharedValue(reduce || leaving ? 1 : POP_FROM);
  const blink = useSharedValue(1);
  const presence = useSharedValue(1);
  useEffect(() => {
    if (!leaving) scale.set(reduce ? 1 : withSpring(1, springs.pop));
  }, [scale, reduce, leaving]);
  const urgent = shown?.lock.urgent ?? false;
  useEffect(() => {
    cancelAnimation(blink);
    blink.set(1);
    if (urgent && !reduce && !leaving)
      blink.set(
        withRepeat(withTiming(URGENT_BLINK_LOW, timing(motion.loop.lockUrgentBlink / 2, 'loop')), -1, true),
      );
    return () => cancelAnimation(blink);
  }, [blink, urgent, reduce, leaving]);
  // Back to full when a new lock takes the place of a leaving pill.
  useEffect(() => {
    if (!leaving) presence.set(1);
  }, [presence, leaving]);
  useFadeAway(presence, leaving, reduce, onGone);
  const style = useAnimatedStyle(() => ({ opacity: blink.get(), transform: [{ scale: scale.get() }] }));
  const slotStyle = useAnimatedStyle(() => ({ opacity: presence.get() }));

  if (!shown) return null;
  const { lock, palette } = shown;
  const badge = size.lockBadge;
  const fg = urgent ? color.onAccent : palette.onRing;
  const glyphH = px(g, PAUSE_GLYPH.height);
  return (
    <Animated.View
      testID={leaving ? 'cell-pill-leaving' : 'cell-pill-slot'}
      style={[styles.pillSlot, { top: px(g, badge.inset), right: px(g, badge.inset) }, slotStyle]}
    >
      <Animated.View
        testID={
          leaving
            ? 'cell-pill-fading'
            : lock.paused
              ? 'cell-pill-paused'
              : urgent
                ? 'cell-pill-urgent'
                : 'cell-pill'
        }
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
  kind: 'fill' | 'frame' | 'digit' | 'cross';
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
 * - miss (a wrong tap in a tap stage): the red wash of a wrong digit and a red X that holds 300 ms and fades.
 *   Reduced: the static 2 dp red frame for 300 ms, as a wrong digit's.
 */
export function flashPart(layer: 'under' | 'over', flash: CellFlash, reduce: boolean): FlashPart | null {
  const d = motion.duration;
  if (flash.kind === 'miss') {
    if (layer === 'under')
      return reduce ? null : { kind: 'fill', tone: 'wrongFlash', from: 1, holdMs: 0, fadeMs: d.wrongFlash };
    return reduce
      ? { kind: 'frame', tone: 'danger', from: 1, holdMs: d.wrongShake, fadeMs: d.reducedFade, width: focus }
      : { kind: 'cross', tone: 'danger', from: 1, holdMs: d.wrongShake, fadeMs: d.stateChange };
  }
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

  if (part.kind === 'cross') {
    const bar = { width: px(g, CROSS.length), height: px(g, CROSS.bar), backgroundColor: tone };
    return (
      <Animated.View pointerEvents="none" style={[styles.center, style]} testID="cell-flash-miss-cross">
        <View style={[styles.crossBar, bar, styles.crossA]} />
        <View style={[styles.crossBar, bar, styles.crossB]} />
      </Animated.View>
    );
  }
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
      a.area === b.area &&
      a.mark === b.mark &&
      a.mine === b.mine &&
      a.correction?.wrong === b.correction?.wrong &&
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
    a.tap === b.tap &&
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
  crossBar: { position: 'absolute', borderRadius: radius.bar },
  crossA: { transform: [{ rotate: '45deg' }] },
  crossB: { transform: [{ rotate: '-45deg' }] },
  chip: { alignItems: 'center', justifyContent: 'center' },
  strike: { position: 'absolute', borderRadius: radius.bar, transform: [{ rotate: '-38deg' }] },
  fix: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
