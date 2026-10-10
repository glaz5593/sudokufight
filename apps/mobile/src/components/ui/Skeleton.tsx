import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { type DimensionValue, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { color, radius, size, space, tokens } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';
import { curve } from './motion';

/**
 * Loading placeholders (spec §4.1 #27 "טעינה"; Loading.dc.html in direction C, motion.md `skeleton`): blocks in
 * `color.skeleton.base` where the content will be, so a list or a card keeps its shape while it loads. Round
 * 1's gradient shimmer is dropped: the blocks pulse their opacity 0.5 ↔ 1 over 1200 ms on the `loop` curve.
 * Reduced motion: they stand still at 0.7 (no shimmer, no pulse).
 *
 * A group is one element for screen readers ("טוען את המשחקים…", busy); its blocks are hidden. Every block of
 * a group shares the group's one pulse.
 */

/** motion.md `skeleton`: the two ends of the pulse, and the still opacity of reduced motion. */
export const SKELETON_OPACITY = { low: 0.5, high: 1, still: 0.7 } as const;

const Pulse = createContext<SharedValue<number> | null>(null);

export interface SkeletonGroupProps {
  /** What a screen reader hears while it loads ("טוען את המשחקים…"). */
  label: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SkeletonGroup({ label, children, style, testID }: SkeletonGroupProps) {
  const reduce = useReduceMotion();
  const pulse = useSharedValue<number>(reduce ? SKELETON_OPACITY.still : SKELETON_OPACITY.low);

  useEffect(() => {
    cancelAnimation(pulse);
    if (reduce) {
      pulse.set(SKELETON_OPACITY.still);
      return;
    }
    pulse.set(SKELETON_OPACITY.low);
    pulse.set(
      withRepeat(
        withTiming(SKELETON_OPACITY.high, {
          duration: motion.loop.skeleton / 2,
          easing: curve('loop'),
          reduceMotion: reduceMotionFlag(false),
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(pulse);
  }, [reduce, pulse]);

  return (
    <View
      style={style}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      accessibilityLiveRegion="polite"
      testID={testID}
    >
      <Pulse.Provider value={pulse}>{children}</Pulse.Provider>
    </View>
  );
}

export interface SkeletonProps {
  width?: DimensionValue;
  height: number;
  /** Corner radius; a circle when `circle`. */
  rounded?: number;
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** One placeholder block. Outside a group it stands still at the reduced-motion opacity. */
export function Skeleton({
  width = '100%',
  height,
  rounded = radius.xs,
  circle = false,
  style,
  testID,
}: SkeletonProps) {
  const pulse = useContext(Pulse);
  const fade = useAnimatedStyle(() => ({ opacity: pulse ? pulse.get() : SKELETON_OPACITY.still }));
  return (
    <Animated.View
      style={[
        styles.block,
        { width: circle ? height : width, height, borderRadius: circle ? height / 2 : rounded },
        fade,
        style,
      ]}
      testID={testID}
    />
  );
}

/** A text line's placeholder: the line height of body text, a share of the width. */
export function SkeletonLine({
  width = '100%',
  style,
}: {
  width?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}) {
  return <Skeleton width={width} height={LINE} rounded={radius.xs} style={style} />;
}

export interface SkeletonRowsProps {
  /** How many rows (a first page shows what fits). */
  count?: number;
  /** The leading picture: an avatar (round-cornered square) or none. */
  avatar?: boolean;
  /** A number at the end (a rating, a score). */
  trailing?: boolean;
  /** Each row's height: the list row (64) or the taller history card. */
  height?: number;
  testID?: string;
}

/** List rows (the leaderboard's, the history's): a surface row with an avatar, two lines and a number. */
export function SkeletonRows({
  count = 5,
  avatar = true,
  trailing = true,
  height = size.listRow,
  testID,
}: SkeletonRowsProps) {
  return (
    <View style={styles.rows} testID={testID}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, { minHeight: height }]}>
          {avatar ? <Skeleton height={AVATAR} rounded={radius.md} width={AVATAR} /> : null}
          <View style={styles.lines}>
            <SkeletonLine width={WIDTHS[i % WIDTHS.length]} />
            <Skeleton height={SMALL_LINE} width="40%" />
          </View>
          {trailing ? <Skeleton height={NUMBER} width={NUMBER_WIDTH} /> : null}
        </View>
      ))}
    </View>
  );
}

export interface SkeletonCardProps {
  /** The avatar's side; none when 0. */
  avatar?: number;
  /** Text lines next to (or under) the avatar. */
  lines?: number;
  /** A bar under the lines (XP, a league's progress). */
  bar?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A card (a panel: the player's identity, the level): an avatar, a few lines, maybe a bar. */
export function SkeletonCard({
  avatar = AVATAR_LARGE,
  lines = 3,
  bar = false,
  style,
  testID,
}: SkeletonCardProps) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      <View style={styles.cardRow}>
        {avatar > 0 ? <Skeleton height={avatar} width={avatar} rounded={radius.xl} /> : null}
        <View style={styles.lines}>
          {Array.from({ length: lines }, (_, i) => (
            <SkeletonLine key={i} width={WIDTHS[i % WIDTHS.length]} />
          ))}
        </View>
      </View>
      {bar ? <Skeleton height={space[3]} rounded={radius.bar} /> : null}
    </View>
  );
}

/** Tiles in a row (the player card's ratings, the stats): `count` boxes of one height. */
export function SkeletonTiles({ count = 3, height = TILE }: { count?: number; height?: number }) {
  return (
    <View style={styles.tiles}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} rounded={radius.lg} style={styles.tile} />
      ))}
    </View>
  );
}

/** Text line heights (body 15, caption 12) and the block sizes of a row, from the spacing scale. */
const LINE = space[7];
const SMALL_LINE = space[5];
const NUMBER = space[9];
const NUMBER_WIDTH = space[14];
const AVATAR = size.avatar.list.size;
const AVATAR_LARGE = size.touch + space[8];
const TILE = space[15] + space[12];
/** Lines of different lengths, so the placeholder reads as text. */
const WIDTHS: readonly DimensionValue[] = ['70%', '55%', '82%', '62%'];

const styles = StyleSheet.create({
  block: { backgroundColor: color.skeleton.base },
  rows: { gap: space[4] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    paddingHorizontal: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  lines: { flex: 1, minWidth: 0, gap: space[3] },
  card: {
    padding: space[8],
    gap: space[6],
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: space[8] },
  tiles: { flexDirection: 'row', gap: space[4] },
  tile: { flex: 1, width: 'auto' },
});
