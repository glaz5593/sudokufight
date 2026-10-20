import { StyleSheet, View } from 'react-native';

import { color, radius } from '../../theme';

/**
 * The boss's "arena" (levels-ui.md §3.2, D77): four gold corners around a boss stage's board, and around a boss's
 * tile on the map (LevelTile). Never a whole frame: a gold frame is the task's region (RegionFrame), and a gold
 * ring on the map is "you are here" (components.md §19.2), so corners say "boss" without being taken for either.
 *
 * Laid over its parent (absolute, the parent gives the box), `outset` dp out of it on every side; a box's corners
 * are the same whichever way the text runs, so it draws the same in Hebrew and in English. Static (no motion, so
 * nothing to reduce) and decorative: the boss band (StageHeader) and the node's label say "boss".
 *
 * The stage screens put it around the board (levelChrome, TapLevelScreen; lane UI-1 wires it):
 *   <View>{board}{level.boss ? <BossFrame /> : null}</View>
 */

/** levels-ui.md §3.2: 3 dp thick, 20 dp long, around the board. */
export const ARENA = { length: 20, thickness: 3, outset: 4 } as const;

export type ArenaCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

const CORNERS: readonly ArenaCorner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

export interface BossFrameProps {
  /** Each arm of a corner, in dp. */
  length?: number;
  /** The corner's stroke, in dp. */
  thickness?: number;
  /** How far out of the parent's box the corners sit, in dp. */
  outset?: number;
  testID?: string;
}

export function BossFrame({
  length = ARENA.length,
  thickness = ARENA.thickness,
  outset = ARENA.outset,
  testID = 'boss-frame',
}: BossFrameProps) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { top: -outset, left: -outset, right: -outset, bottom: -outset }]}
      testID={testID}
    >
      {CORNERS.map((corner) => (
        <View
          key={corner}
          style={[styles.corner, cornerStyle(corner, length, thickness)]}
          testID={`${testID}-${corner}`}
        />
      ))}
    </View>
  );
}

/** One corner: an L of two borders, rounded on its outside like the board's own corner. */
function cornerStyle(corner: ArenaCorner, length: number, thickness: number) {
  const top = corner === 'topLeft' || corner === 'topRight';
  const left = corner === 'topLeft' || corner === 'bottomLeft';
  return {
    width: length,
    height: length,
    ...(top ? { top: 0, borderTopWidth: thickness } : { bottom: 0, borderBottomWidth: thickness }),
    ...(left ? { left: 0, borderLeftWidth: thickness } : { right: 0, borderRightWidth: thickness }),
    ...(top && left ? { borderTopLeftRadius: radius.xs } : null),
    ...(top && !left ? { borderTopRightRadius: radius.xs } : null),
    ...(!top && left ? { borderBottomLeftRadius: radius.xs } : null),
    ...(!top && !left ? { borderBottomRightRadius: radius.xs } : null),
  };
}

const styles = StyleSheet.create({
  box: { position: 'absolute' },
  corner: { position: 'absolute', borderColor: color.accent },
});
