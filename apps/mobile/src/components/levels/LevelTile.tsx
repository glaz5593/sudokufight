import { StyleSheet, Text, View } from 'react-native';

import { color, radius, size, space, text, tokens } from '../../theme';
import { Icon } from '../Icon';
import { SeatGlyph } from '../player/SeatGlyph';
import { paletteAt } from '../player/metrics';

/**
 * A stage as a tile (components.md §19.1, §19.2): a mini 3 × 3 sudoku box with the stage number in Teko, the
 * map's node (56, the boss's 68) and the new-game row's picture (44).
 *
 * - **played** (and any open stage): the board's light cell, its grid lines, the given's dark number;
 * - **current**: the same, and my pin at the top-start corner (P1 with ●), the one sign of "you are here" that
 *   does not move (the node's ring pulses around it);
 * - **locked**: dark (`color.surface2`), the number in `color.textFaint` (never by opacity: it stays readable),
 *   and a lock badge at the top-end corner;
 * - **boss**: a crown over the top edge (gold, or faint while locked).
 *
 * Decorative: the button around it (the node, the row) says which stage it is.
 */

export type LevelTileState = 'played' | 'current' | 'locked';

export interface LevelTileProps {
  /** The stage number, 1–300. */
  n: number;
  /** 44 (the new-game row), 56 (a node), 68 (a boss). */
  size: number;
  state: LevelTileState;
  boss?: boolean;
  /**
   * A tap on a locked node under Reduced Motion: the lock badge's border lights up for a moment instead of the
   * shake (motion.md `level.node.locked`).
   */
  flash?: boolean;
  testID?: string;
}

/** The number's size for each tile (the boards: Teko 600 at 24 / 30 / 34). */
function numberSize(px: number): number {
  if (px >= size.levelNodeBoss) return 34;
  if (px >= size.levelNode) return 30;
  return 24;
}

/** components.md §19.2: the pin 22 (radius 7), the lock badge 20, the crown's badge 28 × 20. */
const PIN = 22;
const PIN_GLYPH = 8;
const LOCK_BADGE = 20;
const LOCK_ICON = 12;
const CROWN = { width: 28, height: 20, icon: 16, top: -12 } as const;
const BADGE_INSET = { pin: -8, lock: -6 } as const;

export function LevelTile({
  n,
  size: px,
  state,
  boss = false,
  flash = false,
  testID = 'level-tile',
}: LevelTileProps) {
  const locked = state === 'locked';
  // The grid lines at a third and two thirds (18 / 37 on a 56 tile, 22 / 45 on 68, 14 / 29 on 44).
  const lines = [Math.floor(px / 3), Math.floor((2 * px) / 3)];
  const lineColor = locked ? color.border : color.board.grid;
  const fontSize = numberSize(px);
  return (
    <View
      style={[styles.box, { width: px, height: px }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <View
        style={[
          styles.tile,
          { width: px, height: px, backgroundColor: locked ? color.surface2 : color.board.cell },
        ]}
        testID={`${testID}-face`}
      >
        {lines.map((at) => (
          <View key={`v${at}`} style={[styles.vLine, { start: at, backgroundColor: lineColor }]} />
        ))}
        {lines.map((at) => (
          <View key={`h${at}`} style={[styles.hLine, { top: at, backgroundColor: lineColor }]} />
        ))}
        <Text
          style={[
            styles.number,
            {
              fontSize,
              lineHeight: Math.round(fontSize * 0.8),
              color: locked ? color.textFaint : color.board.given,
            },
          ]}
          testID={`${testID}-number`}
        >
          {String(n)}
        </Text>
      </View>
      {state === 'current' ? (
        <View style={styles.pin} testID={`${testID}-pin`}>
          <SeatGlyph colorIndex={0} size={PIN_GLYPH} />
        </View>
      ) : null}
      {locked ? (
        <View style={[styles.lock, flash && styles.lockFlash]} testID={`${testID}-lock`}>
          <Icon name="lock" size={LOCK_ICON} color={color.textMuted} />
        </View>
      ) : null}
      {boss ? (
        <View style={styles.crownRow} testID={`${testID}-crown`}>
          <View style={styles.crown}>
            <Icon name="crown" size={CROWN.icon} color={locked ? color.iconFaint : color.accent} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const ME = paletteAt(0);

const styles = StyleSheet.create({
  box: {},
  tile: { borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  vLine: { position: 'absolute', top: 0, bottom: 0, width: tokens.border.hairline },
  hLine: { position: 'absolute', start: 0, end: 0, height: tokens.border.hairline },
  number: {
    ...text('scoreSm'),
    // Teko's figures sit low in their line (the boards' padding-top 4).
    paddingTop: space[2],
    writingDirection: 'ltr',
    textAlign: 'center',
  },
  pin: {
    position: 'absolute',
    top: BADGE_INSET.pin,
    start: BADGE_INSET.pin,
    width: PIN,
    height: PIN,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: ME.ring,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: {
    position: 'absolute',
    top: BADGE_INSET.lock,
    end: BADGE_INSET.lock,
    width: LOCK_BADGE,
    height: LOCK_BADGE,
    borderRadius: LOCK_BADGE / 2,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockFlash: { borderColor: color.text },
  crownRow: { position: 'absolute', top: CROWN.top, start: 0, end: 0, alignItems: 'center' },
  crown: {
    width: CROWN.width,
    height: CROWN.height,
    borderRadius: radius.xs,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
