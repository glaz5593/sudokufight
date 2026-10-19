import { useEffect, useMemo } from 'react';
import { I18nManager, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { color, tokens } from '../../theme';
import { motion, reduceMotionFlag, useReduceMotion } from '../../theme/motion';

/**
 * One burst of confetti (motion.md `level.confetti`, `confetti`): at most 40 pieces in P1, gold and white fall
 * from the top for 1600 ms, once, and are gone. It takes no touch and says nothing to a screen reader.
 * Reduced Motion: nothing at all (the caller does not mount it either). The pieces are spread by a fixed
 * pattern, not by chance, so every burst is the same and a test can count them.
 */

export interface ConfettiProps {
  /** How long the fall takes (1600 ms, motion.md). */
  durationMs?: number;
  /** When it starts, after it mounts (the result: 700 ms, once the stars are in). */
  delayMs?: number;
  /** At most 40 (motion.md limits.confettiPieces). */
  pieces?: number;
  testID?: string;
}

const PALETTE = [color.players[0]!.ring, color.accent, color.text] as const;
const PIECE = { width: 6, height: 10 } as const;

/** A fixed spread: the n-th piece's start (0–1 across), drift, spin and lag, from a small hash of n. */
function pieceOf(n: number) {
  const h = (k: number) => {
    const x = Math.sin((n + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: h(1), drift: h(2) * 2 - 1, spin: h(3) * 2 - 1, lag: h(4), color: PALETTE[n % PALETTE.length]! };
}

export function Confetti({
  durationMs = motion.sequence.victory.confetti,
  delayMs = 0,
  pieces = motion.limits.confettiPieces,
  testID = 'confetti',
}: ConfettiProps) {
  const reduce = useReduceMotion();
  const count = Math.min(pieces, motion.limits.confettiPieces);
  const list = useMemo(() => Array.from({ length: count }, (_, n) => pieceOf(n)), [count]);
  if (reduce) return null;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {list.map((p, n) => (
        <Piece key={n} piece={p} durationMs={durationMs} delayMs={delayMs} testID={`${testID}-piece`} />
      ))}
    </View>
  );
}

function Piece({
  piece,
  durationMs,
  delayMs,
  testID,
}: {
  piece: ReturnType<typeof pieceOf>;
  durationMs: number;
  delayMs: number;
  testID: string;
}) {
  const { width, height } = useWindowDimensions();
  // The pieces start at the start edge (the right in Hebrew): across is toward the end.
  const across = I18nManager.isRTL ? -width : width;
  const fall = useSharedValue(0);
  useEffect(() => {
    // Mounted only with full motion (Confetti returns nothing under `reduce`): gravity is a quad ease-in.
    const lag = Math.round(piece.lag * durationMs * 0.25);
    fall.set(
      withDelay(
        delayMs + lag,
        withTiming(1, {
          duration: durationMs - lag,
          easing: Easing.in(Easing.quad),
          reduceMotion: reduceMotionFlag(false),
        }),
        reduceMotionFlag(false),
      ),
    );
    return () => cancelAnimation(fall);
  }, [fall, piece.lag, delayMs, durationMs]);
  const style = useAnimatedStyle(() => {
    const f = fall.get();
    return {
      opacity: f >= 1 ? 0 : f > 0 ? 1 : 0,
      transform: [
        { translateX: piece.x * across + piece.drift * across * 0.15 * f },
        { translateY: -PIECE.height + f * height * 0.9 },
        { rotate: `${piece.spin * 540 * f}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[styles.piece, { backgroundColor: piece.color, borderRadius: tokens.radius.bar }, style]}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  piece: { position: 'absolute', top: 0, start: 0, width: PIECE.width, height: PIECE.height },
});
