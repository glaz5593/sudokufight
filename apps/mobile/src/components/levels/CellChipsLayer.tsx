import type { CellIndex } from '@sudoku-fight/engine';
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { color, radius, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { boardGeometry, cellRect } from '../board/geometry';
import { timing } from '../ui/motion';

import { Text } from '../ui/Text';
/**
 * Small chips over cells (components.md §19.7): a move's points ("‎+6.5" in the point hunter), a wrong tap's
 * "‎+5 ש׳", "שווה 6" over my locked cell. Each sits on the top edge of its cell, in the board's own LTR
 * coordinates (Board's children). Decorative: what a chip says is said in the screen's live region, so the layer
 * is hidden from screen readers and takes no touch.
 *
 * Motion (`level.chip`): a chip fades in over 240 ms as it comes; Reduced Motion: the 200 ms fade
 * (components/ui/motion timing).
 */

export interface CellChip {
  /** A new id is a new chip (it fades in again). */
  id: number | string;
  cell: CellIndex;
  /** Already formatted (signedText for a signed number). */
  text: string;
  tone: 'gain' | 'penalty' | 'info';
}

export interface CellChipsLayerProps {
  chips: readonly CellChip[];
  /** The board's side (the one Board was given). */
  width: number;
  testID?: string;
}

export const CellChipsLayer = memo(function CellChipsLayer({
  chips,
  width,
  testID = 'cell-chips',
}: CellChipsLayerProps) {
  const reduce = useReduceMotion();
  if (!chips.length) return null;
  const g = boardGeometry(width);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
      testID={testID}
    >
      {chips.map((chip) => {
        const r = cellRect(g, chip.cell);
        return (
          <Chip
            key={chip.id}
            chip={chip}
            reduce={reduce}
            left={r.x + r.width / 2}
            top={r.y}
            testID={testID}
          />
        );
      })}
    </View>
  );
});

function Chip({
  chip,
  reduce,
  left,
  top,
  testID,
}: {
  chip: CellChip;
  reduce: boolean;
  left: number;
  top: number;
  testID: string;
}) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.set(withTiming(1, timing(motion.duration.stateChange, 'standard', reduce)));
  }, [opacity, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const tone =
    chip.tone === 'gain'
      ? { bg: color.players[0].ring, fg: color.players[0].onRing }
      : chip.tone === 'penalty'
        ? { bg: color.danger, fg: color.onDanger }
        : { bg: color.surface2, fg: color.text };
  return (
    <Animated.View
      style={[styles.slot, { left, top: top - CHIP_HEIGHT / 2 }, style]}
      testID={`${testID}-${chip.cell}`}
    >
      <View style={[styles.chip, { backgroundColor: tone.bg }]}>
        <Text style={[styles.text, { color: tone.fg }]} numberOfLines={1}>
          {chip.text}
        </Text>
      </View>
    </Animated.View>
  );
}

/** components.md §19.7: an 18 dp chip. */
const CHIP_HEIGHT = 18;

const styles = StyleSheet.create({
  // Centred on the cell's top edge: the slot is wide and the chip sits in its middle.
  slot: { position: 'absolute', width: CHIP_HEIGHT * 4, marginLeft: -CHIP_HEIGHT * 2, alignItems: 'center' },
  chip: {
    height: CHIP_HEIGHT,
    paddingHorizontal: space[2],
    borderRadius: radius.xs,
    justifyContent: 'center',
    borderWidth: tokens.border.hairline,
    borderColor: color.bg,
  },
  text: { ...text('badge') },
});
