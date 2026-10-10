import type { CellIndex } from '@sudoku-fight/engine';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { color, space, text, tokens } from '../../theme';
import type { BoardModel } from './boardModel';
import { Cell, type CellFlash } from './Cell';
import { boardGeometry, cellHitSlop, cornerOf, px } from './geometry';
import { boardLabel } from './labels';

/**
 * The 9 × 9 board of direction C (components.md §11): 3 × 3 boxes on the dark ground with 3 dp gaps, 1 dp grid
 * lines inside each box, a checkerboard of light boxes, radius 12 at the outer corners. **Always LTR**, in
 * Hebrew too (CLAUDE.md): column 1 is on the left, row A on top.
 */

export interface BoardFlash extends CellFlash {
  cell: CellIndex;
}

export interface BoardProps {
  model: Pick<BoardModel, 'cells' | 'myLock' | 'otherLocks'>;
  /** Side of the board in dp: min(screen width − 32, the height left after cards, strip and keypad). */
  width?: number;
  /** A tap on an interactive cell. Pass a stable function: the cells are memoised. */
  onCellPress?: (cell: CellIndex) => void;
  /** Flashes to play now: a correct or wrong move, or a refused tap. One per cell; a new id replays. */
  flashes?: readonly BoardFlash[];
  /** Coordinate rails (A–I down the left, 1–9 across the top). Not drawn in C, so off by default (§11.1). */
  showCoordinates?: boolean;
  testID?: string;
}

const { boxGap, grid } = tokens.border;
const THREE = [0, 1, 2] as const;
const NINE = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
const ROW_LETTERS = 'ABCDEFGHI';

export function Board({
  model,
  width,
  onCellPress,
  flashes,
  showCoordinates = false,
  testID = 'board',
}: BoardProps) {
  const { t } = useTranslation('board');
  const g = useMemo(() => boardGeometry(width), [width]);
  // One stable inset object per cell, so memoised cells don't redraw on every board render.
  const hitSlops = useMemo(() => NINE.flatMap((r) => NINE.map((c) => cellHitSlop(r, c, g))), [g]);
  const flashAt = new Map(flashes?.map((f) => [f.cell, f] as const));
  const radius = px(g, tokens.radius.board);

  const boxCorner = (b: number): ViewStyle | null =>
    b === 0
      ? { borderTopLeftRadius: radius }
      : b === 2
        ? { borderTopRightRadius: radius }
        : b === 6
          ? { borderBottomLeftRadius: radius }
          : b === 8
            ? { borderBottomRightRadius: radius }
            : null;

  const board = (
    <View
      style={[styles.board, { gap: boxGap, borderRadius: radius }]}
      role="grid"
      accessibilityLabel={boardLabel(model, t)}
      testID={testID}
    >
      {THREE.map((br) => (
        <View key={br} style={[styles.row, { gap: boxGap }]}>
          {THREE.map((bc) => {
            const b = br * 3 + bc;
            return (
              <View key={b} style={[styles.box, { gap: grid }, boxCorner(b)]}>
                {THREE.map((r) => (
                  <View key={r} style={[styles.row, { gap: grid }]}>
                    {THREE.map((c) => {
                      const row = br * 3 + r;
                      const col = bc * 3 + c;
                      const index = row * 9 + col;
                      const cell = model.cells[index];
                      if (!cell) return null;
                      return (
                        <Cell
                          key={index}
                          cell={cell}
                          geometry={g}
                          flash={flashAt.get(index) ?? null}
                          onCellPress={onCellPress}
                          corner={cornerOf(row, col)}
                          hitSlop={hitSlops[index]}
                        />
                      );
                    })}
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );

  if (!showCoordinates) return <View style={styles.ltr}>{board}</View>;

  // Rails: decorative (each cell's label carries its name). My lock's row and column light up in P1.
  const active = model.myLock ? { row: Math.floor(model.myLock.cell / 9), col: model.myLock.cell % 9 } : null;
  const rail = (k: number, isActive: boolean, horizontal: boolean) => (
    <View
      key={k}
      style={[
        styles.railCell,
        horizontal ? { width: g.cell } : { height: g.cell },
        horizontal ? { marginLeft: k === 0 ? 0 : k % 3 === 0 ? boxGap : grid } : null,
        horizontal ? null : { marginTop: k === 0 ? 0 : k % 3 === 0 ? boxGap : grid },
      ]}
    >
      <Text
        style={[text('plateNameCompact'), { color: isActive ? color.players[0].ring : color.textMuted }]}
        testID={horizontal ? `rail-col-${k + 1}` : `rail-row-${ROW_LETTERS[k]}`}
      >
        {horizontal ? String(k + 1) : ROW_LETTERS[k]}
      </Text>
    </View>
  );
  return (
    <View style={styles.ltr} testID={`${testID}-with-coordinates`}>
      <View
        style={[styles.row, { marginLeft: RAIL + space[2], marginBottom: space[2] }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {NINE.map((k) => rail(k, active?.col === k, true))}
      </View>
      <View style={styles.row}>
        <View
          style={{ width: RAIL, marginRight: space[2] }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {NINE.map((k) => rail(k, active?.row === k, false))}
        </View>
        {board}
      </View>
    </View>
  );
}

/** Thickness of a coordinate rail. */
const RAIL = space[8];

const styles = StyleSheet.create({
  // The board, its cells and their names are LTR whatever the app's direction (CLAUDE.md, spec §22).
  ltr: { direction: 'ltr' },
  board: {
    direction: 'ltr',
    backgroundColor: color.board.boxGap,
    // No overflow clipping: it would cut the outer cells' touch slop. The corner boxes and cells round themselves.
  },
  row: { flexDirection: 'row' },
  box: { backgroundColor: color.board.grid },
  railCell: { alignItems: 'center', justifyContent: 'center' },
});
