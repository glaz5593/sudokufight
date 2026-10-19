import type { CellIndex } from '@sudoku-fight/engine';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius, tokens } from '../../theme';
import { boardGeometry, cellRect } from '../board/geometry';

/**
 * A stage's area on the board (components.md §19.7): a flat 2 dp ring around the cells it is about, drawn in the
 * box gap, never a glow. `focus`: the light ring of a find's area (Lv-Find, the text colour); `gold`: the box to
 * fill (Lv-Box, the focus colour). Drawn over the board in its own LTR coordinates (Board's children), static,
 * decorative: the board's label says the area.
 */

export interface RegionFrameProps {
  /** The area's cells: their bounding rect is framed (a box, a row, a column). */
  cells: readonly CellIndex[];
  /** The board's side (the one Board was given). */
  width: number;
  tone?: 'focus' | 'gold';
  testID?: string;
}

/** The ring's width (components.md §19.7: 2 dp, in the 3 dp gap between boxes). */
const RING = tokens.border.focus;

export const RegionFrame = memo(function RegionFrame({
  cells,
  width,
  tone = 'focus',
  testID = 'region-frame',
}: RegionFrameProps) {
  if (!cells.length) return null;
  const g = boardGeometry(width);
  const rects = cells.map((c) => cellRect(g, c));
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.frame,
        {
          left: left - RING,
          top: top - RING,
          width: right - left + 2 * RING,
          height: bottom - top + 2 * RING,
          borderColor: tone === 'gold' ? color.focusRing : color.text,
        },
      ]}
      testID={`${testID}-${tone}`}
    />
  );
});

const styles = StyleSheet.create({
  frame: { position: 'absolute', borderWidth: RING, borderRadius: radius.xs },
});
