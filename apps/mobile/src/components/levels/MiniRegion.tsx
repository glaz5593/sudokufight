import { boxOf, CELL_COUNT, type CellIndex, colOf, type FindScope, rowOf } from '@sudoku-fight/engine';
import { memo } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { color, size as sizes } from '../../theme';

/**
 * A small map of the board with a stage's region lit (levels-ui.md §2.4–2.5, D75–D76): the nine boxes in
 * iconFaint on the dark ground, the region (a box, a row, a column; every box for the whole board) in gold.
 * 27 dp in a fill stage's header (BoxHud), 72 dp in "מוכן?" (ReadyView). Always LTR, like the board: box 1, row
 * A and column 1 at the top-left, in Hebrew too. Gold on iconFaint is 3.4:1 and the boxes on the ground at least
 * 3.1:1 (src/__tests__/contrast.test.ts), and the region is the lighter one, so the map reads in greyscale too.
 *
 * Decorative by default (the text beside it says the region); with `accessibilityLabel` (regionMapLabel: "מפת
 * הלוח: שורה D") it is one image for a screen reader.
 */

/** A region's shape on the 9 × 9 board: a box (0–8), a row (0–8, A–I), a column (0–8, 1–9), or the whole board. */
export type RegionShape = { unit: 'box' | 'row' | 'col'; index: number } | { unit: 'board' };

/** A find's scope as a region shape (FindScope says `kind` where a fill region says `unit`). */
export const regionOfScope = (scope: FindScope): RegionShape =>
  scope.kind === 'board' ? { unit: 'board' } : { unit: scope.kind, index: scope.index };

const ALL: readonly CellIndex[] = Array.from({ length: CELL_COUNT }, (_, i) => i);

/** The cells of a region, row by row: nine for a box, a row or a column; all 81 for the whole board. */
export function regionCellsOf(region: RegionShape): CellIndex[] {
  switch (region.unit) {
    case 'box':
      return ALL.filter((i) => boxOf(i) === region.index);
    case 'row':
      return ALL.filter((i) => rowOf(i) === region.index);
    case 'col':
      return ALL.filter((i) => colOf(i) === region.index);
    case 'board':
      return ALL.slice();
  }
}

export interface MiniRegionProps {
  region: RegionShape;
  /** Its side in dp: size.miniRegion.hud (27) by default, size.miniRegion.ready (72) in "מוכן?". */
  size?: number;
  /** One image for a screen reader with this label; decorative (hidden) without it. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A rect on the map, in dp from its top-left corner. */
interface MapRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The map's layout at `side`: the gap between boxes, a box, a cell. */
export function miniLayout(side: number) {
  const gap = Math.max(1, Math.round(side / 24));
  const box = (side - 2 * gap) / 3;
  return { gap, box, cell: box / 3 };
}

/** Where row or column `k` (0–8) starts on the map: whole boxes with their gap, then cells. */
const startOf = (k: number, box: number, gap: number, cell: number) =>
  Math.floor(k / 3) * (box + gap) + (k % 3) * cell;

/** The lit rects of a region on a map of `side`. A row or a column runs through the gaps between boxes. */
export function litRects(region: RegionShape, side: number): MapRect[] {
  const { gap, box, cell } = miniLayout(side);
  const boxRect = (b: number): MapRect => ({
    left: (b % 3) * (box + gap),
    top: Math.floor(b / 3) * (box + gap),
    width: box,
    height: box,
  });
  switch (region.unit) {
    case 'box':
      return [boxRect(region.index)];
    case 'row':
      return [{ left: 0, top: startOf(region.index, box, gap, cell), width: side, height: cell }];
    case 'col':
      return [{ left: startOf(region.index, box, gap, cell), top: 0, width: cell, height: side }];
    case 'board':
      return Array.from({ length: 9 }, (_, b) => boxRect(b));
  }
}

export const MiniRegion = memo(function MiniRegion({
  region,
  size = sizes.miniRegion.hud,
  accessibilityLabel,
  style,
  testID = 'mini-region',
}: MiniRegionProps) {
  const { gap, box } = miniLayout(size);
  const corner = Math.max(1, Math.round(size / 36));
  const labelled = accessibilityLabel !== undefined;
  return (
    <View
      style={[styles.map, { width: size, height: size }, style]}
      accessible={labelled}
      accessibilityRole={labelled ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!labelled}
      importantForAccessibility={labelled ? 'yes' : 'no-hide-descendants'}
      testID={testID}
    >
      {Array.from({ length: 9 }, (_, b) => (
        <View
          key={b}
          style={[
            styles.box,
            {
              left: (b % 3) * (box + gap),
              top: Math.floor(b / 3) * (box + gap),
              width: box,
              height: box,
              borderRadius: corner,
            },
          ]}
        />
      ))}
      {litRects(region, size).map((r, k) => (
        <View key={k} style={[styles.lit, r, { borderRadius: corner }]} testID={`${testID}-lit`} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  // The board's direction whatever the app's: `left` is the physical left (CLAUDE.md, spec §22).
  map: { direction: 'ltr' },
  box: { position: 'absolute', backgroundColor: color.iconFaint },
  lit: { position: 'absolute', backgroundColor: color.focusRing },
});
