import type { CellIndex, Digit } from '@sudoku-fight/engine';
import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { LEVEL_MOTION, LEVEL_UI } from '../../config/levels';
import { color, radius, text, tokens } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import { springs } from '../board/animation';
import { boardGeometry, type CellRect, cellRect, fontPx, px } from '../board/geometry';
import { timing } from '../ui/motion';

import { Text } from '../ui/Text';
/**
 * A stage's region on the board (levels-ui.md §2.2–2.3, D75; components.md §19.7), drawn over the board in its
 * own LTR coordinates (Board's children). Static and decorative: the board's label says the region.
 *
 * - `region` (the default): the task's area, one look for every kind and every shape (a box, a row, a column):
 *   a 3 dp gold band between two 1 dp dark lines (border.regionFrame, border.regionKeyline), just outside the
 *   region's cells, so it never covers one of them. The dark lines give it contrast on both sides: against the
 *   cream region (focusCell) and against the blue-grey cells outside (outCell).
 * - `answer`: where a missed target was, at a stage's end: its own look, never the region's gold, so the region
 *   never swallows it: a 3 dp dark ring on the cell with a 1 dp white line inside it, and a find's digit in a
 *   dark chip (the look of the digits it asked for). Information: the same with Reduced Motion.
 *
 * [D75b] The spotlight (motion.md `level.region.intro`, LEVEL_UI.regionIntro): when the board first shows, the
 * frame lands (1.06 → 1 on the `pop` spring, opacity 0 → 1 over 320 ms), then a gold band around it flashes
 * once (0 → 1 → 0 over 600 ms). Under a second, while the clock already runs, never a loop. A race's next spot
 * flashes the band only (`intro="band"`, a new `key` plays it again). With Reduced Motion, or the setting off,
 * the frame is simply there from the first frame and nothing flashes.
 */

export type RegionFrameLook = 'region' | 'answer';

/** The spotlight: the frame lands and the band flashes ('full'), the band only ('band'), or nothing. */
export type RegionIntro = 'full' | 'band' | 'none';

export interface RegionFrameProps {
  /** The region's cells: their bounding rect is framed (a box, a row, a column; one cell for an answer). */
  cells: readonly CellIndex[];
  /** The board's side (the one Board was given). */
  width: number;
  look?: RegionFrameLook;
  /** An answer's digit, in a dark chip (find); none for spot the error (its cell shows its own digit). */
  digit?: Digit | null;
  /** The spotlight as the frame first shows ('none' by default). Ignored for an answer. */
  intro?: RegionIntro;
  /**
   * @deprecated 1.0.2's two rings (a light one for a find, a gold one for the box). Since 1.0.3 every region has
   * the one look (D75a), so this is ignored; kept only so the tutorial pictures' fixtures still type-check.
   */
  tone?: 'focus' | 'gold';
  /**
   * The frame's own id (the band beside it is `${testID}-band`). Its parts carry none, so a test that looks for
   * ids starting with it finds the frame once: the gold band is the frame's child, the inner dark line the gold's
   * (an answer: the white line, then the digit's chip).
   */
  testID?: string;
}

const KEY = tokens.border.regionKeyline;
const FRAME = tokens.border.regionFrame;
/** The whole frame: a dark line, the gold band, a dark line. */
const THICK = 2 * KEY + FRAME;
/** An answer's digit chip at the design's 38.4 dp cell, inside the ring and its white line (Lv-Focus). */
const ANSWER_CHIP = { size: 26, font: 18 } as const;

/** The bounding rect of `cells` on a board of geometry `g`. */
function boundsOf(width: number, cells: readonly CellIndex[]): CellRect {
  const g = boardGeometry(width);
  const rects = cells.map((c) => cellRect(g, c));
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** `r` grown by `by` on every side. */
const grow = (r: CellRect, by: number) => ({
  left: r.x - by,
  top: r.y - by,
  width: r.width + 2 * by,
  height: r.height + 2 * by,
});

/** The spotlight actually played: none with Reduced Motion or with LEVEL_UI.regionIntro off. */
export function regionIntroOf(intro: RegionIntro, reduce: boolean): RegionIntro {
  return reduce || !LEVEL_UI.regionIntro ? 'none' : intro;
}

export const RegionFrame = memo(function RegionFrame({
  cells,
  width,
  look = 'region',
  digit = null,
  intro = 'none',
  testID,
}: RegionFrameProps) {
  if (!cells.length) return null;
  const bounds = boundsOf(width, cells);
  if (look === 'answer')
    return <AnswerRing bounds={bounds} width={width} digit={digit} testID={testID ?? 'answer-frame'} />;
  return <AreaFrame bounds={bounds} intro={intro} testID={testID ?? 'region-frame'} />;
});

/** The task's area: dark line, gold band, dark line, outside the cells; the spotlight when it first shows. */
function AreaFrame({ bounds, intro, testID }: { bounds: CellRect; intro: RegionIntro; testID: string }) {
  const reduce = useReduceMotion();
  // Decided once, on the first frame: a later Reduced Motion change does not replay or cut the spotlight.
  const [played] = useState(() => regionIntroOf(intro, reduce));
  const land = played === 'full';
  const scale = useSharedValue(land ? LEVEL_MOTION.regionLandScale : 1);
  const opacity = useSharedValue(land ? 0 : 1);
  const band = useSharedValue(0);
  useEffect(() => {
    if (played === 'none') return;
    if (land) {
      scale.set(withSpring(1, springs.pop));
      opacity.set(withTiming(1, timing(LEVEL_MOTION.regionLandMs, 'emphasized', false)));
    }
    const half = timing(LEVEL_MOTION.regionBandMs / 2, 'standard', false);
    band.set(
      withDelay(land ? LEVEL_MOTION.regionLandMs : 0, withSequence(withTiming(1, half), withTiming(0, half))),
    );
  }, [played, land, scale, opacity, band]);
  const frameStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ scale: scale.get() }],
  }));
  const bandStyle = useAnimatedStyle(() => ({ opacity: band.get() }));
  const wide = LEVEL_MOTION.regionBandWidth;
  const r = radius.xs;
  return (
    <>
      {played !== 'none' ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.abs,
            grow(bounds, THICK + wide),
            { borderWidth: wide, borderColor: color.board.regionBand, borderRadius: r + wide },
            bandStyle,
          ]}
          testID={`${testID}-band`}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.abs,
          grow(bounds, THICK),
          { borderWidth: KEY, borderColor: color.board.given, borderRadius: r },
          frameStyle,
        ]}
        testID={testID}
      >
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderWidth: FRAME, borderColor: color.focusRing, borderRadius: r - KEY },
          ]}
        >
          <View
            style={[
              StyleSheet.absoluteFill,
              { borderWidth: KEY, borderColor: color.board.given, borderRadius: r - KEY - FRAME },
            ]}
          />
        </View>
      </Animated.View>
    </>
  );
}

/** Where a missed target was: a dark ring on the cell, a white line inside it, a find's digit in a dark chip. */
function AnswerRing({
  bounds,
  width,
  digit,
  testID,
}: {
  bounds: CellRect;
  width: number;
  digit: Digit | null;
  testID: string;
}) {
  const g = boardGeometry(width);
  const chip = px(g, ANSWER_CHIP.size);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.abs,
        styles.center,
        grow(bounds, 0),
        { borderWidth: FRAME, borderColor: color.board.given, borderRadius: px(g, radius.bar) },
      ]}
      testID={testID}
    >
      <View style={[StyleSheet.absoluteFill, { borderWidth: KEY, borderColor: color.board.answerKeyline }]} />
      {digit !== null ? (
        <View
          style={[
            styles.center,
            { width: chip, height: chip, borderRadius: px(g, radius.xs), backgroundColor: color.board.given },
          ]}
        >
          <Text
            style={[
              text('digitCell'),
              {
                color: color.board.cell,
                fontSize: fontPx(g, ANSWER_CHIP.font),
                lineHeight: fontPx(g, ANSWER_CHIP.font),
              },
            ]}
          >
            {digit}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
