import { StyleSheet, View } from 'react-native';

import { color, radius, tokens } from '../../theme';
import { Icon } from '../Icon';

/**
 * The puzzle's marks over a box (levels-ui.md §4; components.md §19.13), apart from the board so a picture can
 * draw them too: PuzzleBoard's tiles, and "איך משחקים"'s puzzle pictures (HowToPlayPanels), which show the real
 * look the lines describe ("ריבוע עם מנעול קבוע", the held box over its gold target). Static and decorative;
 * each sits over its parent (the box), in the board's own LTR coordinates.
 */

/** The region's gold frame (levels-ui.md §2.2): 3 dp gold between two 1 dp dark keylines. */
export function GoldFrame({ testID }: { testID?: string }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, puzzleMarkStyles.keyline]} testID={testID}>
      <View style={[puzzleMarkStyles.fill, puzzleMarkStyles.gold]}>
        <View style={[puzzleMarkStyles.fill, puzzleMarkStyles.keyline]} />
      </View>
    </View>
  );
}

/** "Me": a 3 dp P1 frame with its dark inner keyline (P1 on cream alone is too faint): a held or chosen box. */
export function MeFrame({ testID }: { testID?: string }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, puzzleMarkStyles.me]} testID={testID}>
      <View style={[puzzleMarkStyles.fill, puzzleMarkStyles.meEdge]} />
    </View>
  );
}

/** A fixed box's lock as it stands still (no shake, no red), in the top corner of its box. */
export function PuzzleLockMark({ size, testID }: { size: number; testID?: string }) {
  return (
    <View pointerEvents="none" style={puzzleMarkStyles.lock} testID={testID}>
      <Icon name="lock" size={size} color={color.board.given} />
    </View>
  );
}

const P1 = color.players[0];
const TILE_RADIUS = radius.xs;

export const puzzleMarkStyles = StyleSheet.create({
  /** Where a fixed box's lock sits (PuzzleBoard's own lock, which shakes, takes this too). */
  lock: {
    position: 'absolute',
    top: 1,
    right: 1,
    padding: 1,
    borderRadius: radius.xs,
    borderWidth: tokens.border.hairline,
    borderColor: 'transparent',
  },
  fill: { flex: 1, borderRadius: TILE_RADIUS },
  keyline: {
    borderWidth: tokens.border.regionKeyline,
    borderColor: color.board.given,
    borderRadius: TILE_RADIUS,
  },
  gold: { borderWidth: tokens.border.regionFrame, borderColor: color.focusRing },
  me: { borderWidth: tokens.border.lockRing, borderColor: P1.ring, borderRadius: TILE_RADIUS },
  meEdge: { borderWidth: tokens.border.lockEdge, borderColor: P1.lockEdge },
});
