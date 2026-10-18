import type { InterferenceKind } from '@sudoku-fight/engine';
import { type ReactNode, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  ReduceMotion,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import { Icon } from '../../../components/Icon';
import { paletteAt } from '../../../components/player';
import { color, radius, tokens } from '../../../theme';

/**
 * The small live preview of an interference (spec §7.3.1, components.md §13: the illustration on each
 * kind button of the picker). In the C palette, as the full effects are (motion.md §4.4): the sender is me, so the
 * sender's colour is P1, with gold and white. Each preview loops on the UI thread (one clock per preview, the
 * frames in worklets, no React render per frame). `still`: one fixed frame (reduced motion, locked kinds).
 *
 * Decorative: the kind button's label says what it is. A kind this app doesn't know (a newer player's) gets a
 * still bolt.
 */
export interface TokenArtProps {
  kind: InterferenceKind;
  /** The box, in dp (the picker's 36-dp preview on each kind button; 56 on the collection, 32 on a player card). */
  size: number;
  /** A fixed frame instead of the loop. */
  still?: boolean;
  testID?: string;
}

const SENDER = paletteAt(0).ring;

/** One loop: 0 → 1 over `periodMs`, again and again; `still` holds it at 0. */
function useLoop(still: boolean, periodMs: number): SharedValue<number> {
  const t = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(t);
    t.set(0);
    if (still) return;
    t.set(
      withRepeat(
        withTiming(1, { duration: periodMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(t);
  }, [still, periodMs, t]);
  return t;
}

export function TokenArt({ kind, size, still = false, testID }: TokenArtProps) {
  const box = { width: size, height: size };
  return (
    <View
      style={[styles.box, box]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID ?? `token-art-${kind}`}
    >
      <Preview kind={kind} size={size} still={still} />
    </View>
  );
}

/** The preview of each kind; a kind this app doesn't know (a newer player's) gets a still bolt. */
function Preview({ kind, size, still }: { kind: InterferenceKind; size: number; still: boolean }) {
  switch (kind) {
    case 'fireworks':
      return <Fireworks size={size} still={still} />;
    case 'cats':
      return <Cat size={size} still={still} />;
    case 'warp':
      return <Warp size={size} still={still} />;
    case 'scramble':
      return <Scramble size={size} still={still} />;
    case 'ink':
      return <Ink size={size} still={still} />;
    case 'keypad':
      return <Keys size={size} still={still} />;
    default:
      return (
        <View style={[styles.fill, styles.center]} testID="token-art-unknown">
          <Icon name="bolt" size={Math.round(size * 0.6)} color={color.accent} />
        </View>
      );
  }
}

// ---------------------------------------------------------------------------------------------------------
// Fireworks: two bursts that bloom and fade in turn (motion.md `sf-bloom`), and embers that fall.

const RAYS =
  'M66 50L90 50M61.3 61.3L78.3 78.3M50 66L50 90M38.7 61.3L21.7 78.3M34 50L10 50M38.7 38.7L21.7 21.7M50 34L50 10M61.3 38.7L78.3 21.7';
const INNER_RAYS =
  'M61.1 54.6L77.7 61.5M54.6 61.1L61.5 77.7M45.4 61.1L38.5 77.7M38.9 54.6L22.3 61.5M38.9 45.4L22.3 38.5M45.4 38.9L38.5 22.3M54.6 38.9L61.5 22.3M61.1 45.4L77.7 38.5';
const BLOOM_MS = 1500;

/** Bursts as fractions of the box: centre and size, and where in the loop each one starts. */
const BURSTS = [
  { x: 0.4, y: 0.4, size: 0.78, phase: 0, rays: color.accent, inner: SENDER },
  { x: 0.72, y: 0.7, size: 0.5, phase: 0.5, rays: SENDER, inner: color.accent },
] as const;
const EMBERS = [
  { x: 0.18, y: 0.55, phase: 0.2, tint: color.accent },
  { x: 0.62, y: 0.22, phase: 0.55, tint: SENDER },
  { x: 0.86, y: 0.36, phase: 0.8, tint: color.text },
] as const;

function Fireworks({ size, still }: { size: number; still: boolean }) {
  const t = useLoop(still, BLOOM_MS);
  return (
    <>
      {BURSTS.map((b, i) => (
        <Burst
          key={i}
          t={t}
          still={still}
          size={size}
          burst={b}
          testID={i === 0 ? 'token-art-motion' : undefined}
        />
      ))}
      {EMBERS.map((e, i) => (
        <Ember key={i} t={t} still={still} size={size} ember={e} />
      ))}
    </>
  );
}

function Burst({
  t,
  still,
  size,
  burst,
  testID,
}: {
  t: SharedValue<number>;
  still: boolean;
  size: number;
  burst: (typeof BURSTS)[number];
  testID?: string;
}) {
  const side = size * burst.size;
  const style = useAnimatedStyle(() => {
    if (still) return { opacity: 1, transform: [{ scale: 1 }] };
    const p = (t.get() + burst.phase) % 1;
    return {
      opacity: interpolate(p, [0, 0.12, 0.55, 1], [0, 1, 1, 0]),
      transform: [{ scale: interpolate(p, [0, 0.55, 1], [0.15, 1, 1.12]) }],
    };
  });
  const place = {
    width: side,
    height: side,
    left: size * burst.x - side / 2,
    top: size * burst.y - side / 2,
  };
  return (
    <Animated.View style={[styles.layer, place, style]} testID={testID}>
      <Svg width={side} height={side} viewBox="0 0 100 100">
        <Path d={RAYS} stroke={burst.rays} strokeWidth={7} strokeLinecap="round" fill="none" />
        <Path d={INNER_RAYS} stroke={burst.inner} strokeWidth={5.5} strokeLinecap="round" fill="none" />
        <Circle cx={50} cy={50} r={9} fill={color.text} />
      </Svg>
    </Animated.View>
  );
}

function Ember({
  t,
  still,
  size,
  ember,
}: {
  t: SharedValue<number>;
  still: boolean;
  size: number;
  ember: (typeof EMBERS)[number];
}) {
  const dot = Math.max(2, Math.round(size / 16));
  const fall = size * 0.22;
  const style = useAnimatedStyle(() => {
    if (still) return { opacity: 1, transform: [{ translateY: fall / 2 }] };
    const p = (t.get() + ember.phase) % 1;
    return { opacity: 1 - p, transform: [{ translateY: p * fall }] };
  });
  const place = {
    width: dot,
    height: dot,
    borderRadius: dot / 2,
    left: size * ember.x,
    top: size * ember.y,
    backgroundColor: ember.tint,
  };
  return <Animated.View style={[styles.layer, place, style]} />;
}

// ---------------------------------------------------------------------------------------------------------
// Cats: a cat that pads to and fro and bobs as it goes (motion.md: cats cross, bobbing every 220–340 ms).

const WALK_MS = 1600;
const BOB_MS = 560;

function Cat({ size, still }: { size: number; still: boolean }) {
  const walk = useLoop(still, WALK_MS);
  const bob = useLoop(still, BOB_MS);
  const reach = size * 0.14;
  const lift = size * 0.05;
  const style = useAnimatedStyle(() => {
    if (still) return { transform: [{ translateX: 0 }, { translateY: 0 }, { scaleX: 1 }] };
    const w = walk.get();
    // There and back: the cat faces the way it walks.
    const there = w < 0.5;
    const x = there ? interpolate(w, [0, 0.5], [-reach, reach]) : interpolate(w, [0.5, 1], [reach, -reach]);
    const y = -lift * Math.abs(Math.sin(bob.get() * Math.PI * 2));
    return { transform: [{ translateX: x }, { translateY: y }, { scaleX: there ? 1 : -1 }] };
  });
  return (
    <Animated.View style={[styles.fill, style]} testID="token-art-motion">
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path
          d="M24 46L20 14L46 32Z"
          fill={color.textMuted}
          stroke={color.bg}
          strokeWidth={3}
          strokeLinejoin="round"
        />
        <Path
          d="M76 46L80 14L54 32Z"
          fill={color.textMuted}
          stroke={color.bg}
          strokeWidth={3}
          strokeLinejoin="round"
        />
        <Circle cx={50} cy={56} r={30} fill={color.textMuted} stroke={color.bg} strokeWidth={3} />
        <Ellipse cx={50} cy={70} rx={14} ry={10} fill={color.text} />
        <Ellipse cx={39} cy={51} rx={6} ry={7.5} fill={color.text} stroke={color.bg} strokeWidth={2} />
        <Ellipse cx={61} cy={51} rx={6} ry={7.5} fill={color.text} stroke={color.bg} strokeWidth={2} />
        <Circle cx={40} cy={52} r={3.4} fill={color.bg} />
        <Circle cx={62} cy={52} r={3.4} fill={color.bg} />
        <Path d="M46 63L54 63L50 68Z" fill={color.accent} />
        <Path
          d="M30 66L12 62M30 71L12 74M70 66L88 62M70 71L88 74"
          stroke={color.text}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Warp: a grid that skews and swells (1300 ms there and back), and an offset copy in the sender's colour at
// 50 % that jumps in steps (motion.md §4.4 "Warp"). Still: a fixed 6° skew, scale 1.04 and the copy offset.

const GRID =
  'M16 18C36 10 60 26 80 16C88 36 72 60 82 80C60 88 38 72 14 82C8 60 24 38 16 18Z M37 15C44 36 30 58 38 83 M59 19C52 40 66 60 60 85 M14 40C36 32 58 50 83 38 M12 61C36 54 58 70 81 59';
const SWAY_MS = 2600;
const STEP_MS = 1800;
const SKEW_DEG = 8;
const STILL_SKEW_DEG = 6;
const SWELL = 1.06;
const STILL_SWELL = 1.04;
const COPY_ALPHA = 0.5;

function Warp({ size, still }: { size: number; still: boolean }) {
  const sway = useLoop(still, SWAY_MS);
  const step = useLoop(still, STEP_MS);
  const shift = size * 0.06;
  const grid = useAnimatedStyle(() => {
    if (still) return { transform: [{ skewX: `${STILL_SKEW_DEG}deg` }, { scale: STILL_SWELL }] };
    // There and back on the loop curve: −8° → 8° → −8°.
    const k = (1 - Math.cos(sway.get() * Math.PI * 2)) / 2;
    return { transform: [{ skewX: `${-SKEW_DEG + 2 * SKEW_DEG * k}deg` }, { scale: 1 + (SWELL - 1) * k }] };
  });
  const copy = useAnimatedStyle(() => {
    if (still) return { transform: [{ translateX: shift }, { translateY: -shift / 4 }] };
    const n = Math.floor(step.get() * 4);
    return {
      transform: [
        { translateX: n % 2 === 0 ? shift : -shift },
        { translateY: n < 2 ? -shift / 4 : shift / 4 },
      ],
    };
  });
  return (
    <>
      <Animated.View style={[styles.fill, styles.copy, copy]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path
            d={GRID}
            stroke={SENDER}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.fill, grid]} testID="token-art-motion">
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path
            d={GRID}
            stroke={color.text}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Animated.View>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// [D47] Scrambled digits: a 2 × 2 corner of the board, two of its digits rolling like a slot machine in the
// sender's colour, a step every 400 ms (the effect's own rate). Still: "?" in both, as the reduced effect does.

const ROLL_MS = 1600;
const ROLL = ['?', '3', '8', '5'] as const;
const STILL_ROLL = ['?'] as const;

function Scramble({ size, still }: { size: number; still: boolean }) {
  const t = useLoop(still, ROLL_MS);
  const gap = Math.max(1, Math.round(size / 28));
  const cell = (size * 0.84 - gap) / 2;
  const plain = (d: string, alt: boolean) => (
    <MiniCell cell={cell} alt={alt}>
      <Text style={[styles.miniDigit, digitStyle(cell), { color: color.board.given }]}>{d}</Text>
    </MiniCell>
  );
  return (
    <View style={[styles.fill, styles.center]}>
      <View style={[styles.miniGrid, { gap, width: 2 * cell + gap }]}>
        <RollingCell t={t} still={still} cell={cell} phase={0} testID="token-art-motion" />
        {plain('4', true)}
        {plain('7', true)}
        <RollingCell t={t} still={still} cell={cell} phase={0.5} />
      </View>
    </View>
  );
}

const digitStyle = (cell: number) => ({
  fontSize: Math.round(cell * 0.72),
  lineHeight: cell,
  height: cell,
  width: cell,
});

function MiniCell({ cell, alt, children }: { cell: number; alt: boolean; children: ReactNode }) {
  return (
    <View
      style={[
        styles.miniCell,
        { width: cell, height: cell, backgroundColor: alt ? color.board.cellAlt : color.board.cell },
      ]}
    >
      {children}
    </View>
  );
}

/** One cell whose digit rolls (a column of digits moving up a step at a time); still: "?". */
function RollingCell({
  t,
  still,
  cell,
  phase,
  testID,
}: {
  t: SharedValue<number>;
  still: boolean;
  cell: number;
  phase: number;
  testID?: string;
}) {
  const steps = still ? STILL_ROLL : ROLL;
  const roll = useAnimatedStyle(() => {
    const n = still ? 0 : Math.floor(((t.get() + phase) % 1) * ROLL.length) % ROLL.length;
    return { transform: [{ translateY: -n * cell }] };
  });
  return (
    <MiniCell cell={cell} alt={false}>
      <Animated.View style={roll} testID={testID}>
        {steps.map((d, i) => (
          <Text key={i} style={[styles.miniDigit, digitStyle(cell), { color: SENDER }]}>
            {d}
          </Text>
        ))}
      </Animated.View>
    </MiniCell>
  );
}

// ---------------------------------------------------------------------------------------------------------
// [D47] Ink: a blot splashes onto a small board and fades away (1600 ms loop). Still: the blot, landed.

const BLOT =
  'M50 18C61 16 66 27 74 30C85 34 86 47 82 56C78 66 84 76 72 81C61 86 55 78 45 80C34 82 22 78 20 66C18 56 12 48 19 39C26 30 38 20 50 18Z';
const SPLASH_MS = 1600;

function Ink({ size, still }: { size: number; still: boolean }) {
  const t = useLoop(still, SPLASH_MS);
  const board = size * 0.84;
  const style = useAnimatedStyle(() => {
    if (still) return { opacity: 1, transform: [{ scale: 1 }] };
    const p = t.get();
    return {
      opacity: interpolate(p, [0, 0.05, 0.6, 0.95, 1], [0, 1, 1, 0, 0]),
      transform: [{ scale: interpolate(p, [0, 0.12, 0.2, 1], [0.3, 1.08, 1, 0.9]) }],
    };
  });
  return (
    <View style={[styles.fill, styles.center]}>
      <View
        style={[
          styles.miniBoard,
          { width: board, height: board, borderRadius: Math.max(2, Math.round(size / 12)) },
        ]}
      />
      <Animated.View style={[styles.fill, style]} testID="token-art-motion">
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path d={BLOT} fill={color.bg} stroke={SENDER} strokeWidth={4} strokeLinejoin="round" />
          <Circle cx={86} cy={24} r={5} fill={color.bg} />
          <Circle cx={14} cy={82} r={4} fill={color.bg} />
        </Svg>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------
// [D47] Scrambled keypad: three keys trade places, sliding, every 600 ms (the effect slides in 200 ms).
// Still: one order, standing.

const SHUFFLE_MS = 1800;
const KEY_LABELS = ['1', '2', '3'] as const;
/** The slot of key k at step s (three steps a loop), and the still order. */
const slotAt = (k: number, s: number): number => {
  'worklet';
  return (k + s) % 3;
};
const STILL_STEP = 2;

function Keys({ size, still }: { size: number; still: boolean }) {
  const t = useLoop(still, SHUFFLE_MS);
  const gap = Math.max(1, Math.round(size / 24));
  const key = (size * 0.9 - 2 * gap) / 3;
  const pitch = key + gap;
  return (
    <View style={[styles.fill, styles.center]}>
      <View style={{ width: 3 * key + 2 * gap, height: key * 1.5 }}>
        {KEY_LABELS.map((label, k) => (
          <SlidingKey
            key={label}
            label={label}
            index={k}
            t={t}
            still={still}
            side={key}
            pitch={pitch}
            testID={k === 0 ? 'token-art-motion' : undefined}
          />
        ))}
      </View>
    </View>
  );
}

function SlidingKey({
  label,
  index,
  t,
  still,
  side,
  pitch,
  testID,
}: {
  label: string;
  index: number;
  t: SharedValue<number>;
  still: boolean;
  side: number;
  pitch: number;
  testID?: string;
}) {
  const style = useAnimatedStyle(() => {
    if (still) return { transform: [{ translateX: slotAt(index, STILL_STEP) * pitch }] };
    const phase = t.get() * 3;
    const step = Math.floor(phase) % 3;
    const into = phase - Math.floor(phase);
    // Slide over the first quarter of each step, then stand.
    const k = Math.min(1, into / 0.25);
    const from = slotAt(index, (step + 2) % 3);
    const to = slotAt(index, step);
    return { transform: [{ translateX: (from + (to - from) * (1 - (1 - k) * (1 - k))) * pitch }] };
  });
  return (
    <Animated.View
      style={[styles.miniKey, { width: side, height: side * 1.5, borderRadius: radius.xs }, style]}
      testID={testID}
    >
      <Text style={[styles.miniDigit, { fontSize: Math.round(side * 0.7), lineHeight: side * 0.9 }]}>
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Drawn in physical coordinates, like the board (the art is the same in both languages).
  box: { direction: 'ltr' },
  layer: { position: 'absolute' },
  fill: { ...StyleSheet.absoluteFill },
  center: { alignItems: 'center', justifyContent: 'center' },
  copy: { opacity: COPY_ALPHA },
  miniGrid: { direction: 'ltr', flexDirection: 'row', flexWrap: 'wrap' },
  miniCell: { overflow: 'hidden', borderRadius: radius.bar, alignItems: 'center' },
  miniDigit: {
    fontFamily: tokens.type.keyDigit.fontFamily,
    includeFontPadding: false,
    textAlign: 'center',
    color: color.keypad.keyText,
  },
  miniBoard: { position: 'absolute', backgroundColor: color.board.cell },
  miniKey: {
    position: 'absolute',
    left: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.keypad.keyBg,
    borderWidth: tokens.border.hairline,
    borderColor: color.keypad.keyBorder,
  },
});
