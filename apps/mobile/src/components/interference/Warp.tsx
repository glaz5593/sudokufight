import { Canvas, Group, Path, Rect, RoundedRect, type Transforms3d } from '@shopify/react-native-skia';
import type { Clock, InterferenceKind } from '@sudoku-fight/engine';
import { type ReactNode, useMemo } from 'react';
import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';

import { radius } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import {
  HIT_FADE_IN_MS,
  HIT_FADE_IN_REDUCED_MS,
  HIT_FADE_OUT_MS,
  INTERFERENCE_SCOPE,
  type InterferenceScope,
} from './config';
import type { EffectProps } from './effectProps';
import { hitAlpha, type HitTime, remainingOf, useHitClock } from './hitClock';
import {
  GHOST_STEPS,
  GLITCH_BANDS,
  GLITCH_FRAME,
  GLITCH_STEPS,
  NO_WARP,
  SPIRAL_BOX,
  SPIRAL_PATH,
  SPIRAL_SHARE,
  stepOf,
  WARP_GLITCH_MS,
  WARP_SPIRAL_MS,
  WARP_SWING_MS,
  WARP_WAVE_MS,
  waveLength,
  waveLines,
  warpPose,
  warpStill,
  warpTransform,
} from './warpModel';

export interface WarpFrameProps {
  /** The interference on me, if any; the frame moves only for a warp. */
  hit: (HitTime & { kind: InterferenceKind }) | null;
  /** The game clock's time, as the screen last rendered it. */
  now: number;
  clock: Clock;
  /**
   * What this frame holds: the whole game screen, or the board. It moves only when that is the effect's
   * scope [D35], so a screen can wrap both and let the setting choose.
   */
  region: InterferenceScope;
  scope?: InterferenceScope;
  /** Defaults to the player's setting (useReduceMotion). */
  reduceMotion?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
}

/**
 * The view a warp distorts (spec §7.1; Hit-Warp; motion.md §4.4): wrap the game screen's content (or the
 * board) in it. While a warp hits me it tilts in perspective and wobbles with the wave, from the hit's
 * clock, on the UI thread; the content stays live, so I can still play (spec §7.2). Otherwise it is a plain
 * view: its children are never re-mounted when a warp starts or ends.
 *
 * Reduced motion: a fixed tilt for the hit's 5 s, then straight again.
 */
export function WarpFrame({
  hit,
  now,
  clock,
  region,
  scope = INTERFERENCE_SCOPE,
  reduceMotion,
  style,
  children,
  testID,
}: WarpFrameProps) {
  const reducedSetting = useReduceMotion();
  const reduce = reduceMotion ?? reducedSetting;
  const active = hit !== null && hit.kind === 'warp' && region === scope && remainingOf(hit, now) > 0;
  const elapsed = useHitClock(active ? hit : null, clock);
  const totalMs = hit?.totalMs ?? 0;
  const fadeIn = reduce ? HIT_FADE_IN_REDUCED_MS : HIT_FADE_IN_MS;

  const motionStyle = useAnimatedStyle(() => {
    if (!active) return { transform: warpTransform(NO_WARP) };
    const t = elapsed.get();
    const a = hitAlpha(t, totalMs, fadeIn, HIT_FADE_OUT_MS);
    return { transform: warpTransform(reduce ? warpStill(a > 0, region) : warpPose(t, a, region)) };
  });

  return (
    <Animated.View style={[style, motionStyle]} testID={testID}>
      {children}
    </Animated.View>
  );
}

/** The instant the reduced-motion overlay shows. */
const STILL_AT_MS = 400;

/**
 * What a warp draws over its region (Skia): a colour shift between the sender's colour and gold, wave lines
 * running across, two glitch bands jumping, a slow spiral, and an offset copy of the board's frame in the
 * sender's colour at 50 % jumping in steps (motion.md: "an offset copy … at 50 %"). Everything moves from
 * the hit's clock; with reduced motion all of it stands still at one instant.
 */
export function WarpOverlay({
  width,
  height,
  elapsed,
  totalMs,
  colors,
  reduce,
  fadeInMs,
  fadeOutMs,
  board,
  testID,
}: EffectProps) {
  const still = reduce;
  const slots = [colors.sender, colors.accent, colors.light] as const;
  const lines = useMemo(() => waveLines(width, height), [width, height]);
  const wavelength = waveLength(width);
  const unit = height / GLITCH_FRAME;
  const spiral = board ?? { x: 0, y: 0, width, height };
  const spiralSide = Math.min(spiral.width, spiral.height) * SPIRAL_SHARE;
  const spiralScale = spiralSide / SPIRAL_BOX;
  const spiralX = spiral.x + spiral.width / 2;
  const spiralY = spiral.y + spiral.height / 2;

  // The hit's time, frozen at one instant with reduced motion (then nothing below changes after the fade).
  const time = useDerivedValue(() => (still ? STILL_AT_MS : elapsed.get()));
  const alpha = useDerivedValue(() => hitAlpha(elapsed.get(), totalMs, fadeInMs, fadeOutMs));

  // Colour shift: the sender's colour and gold take turns, there and back with the tilt.
  const shift = useDerivedValue(() => 0.5 + 0.5 * Math.sin((time.get() / WARP_SWING_MS) * Math.PI));
  const tintSender = useDerivedValue(() => alpha.get() * (0.06 + 0.1 * shift.get()));
  const tintGold = useDerivedValue(() => alpha.get() * (0.06 + 0.1 * (1 - shift.get())));
  const lineOpacity = useDerivedValue(() => alpha.get() * 0.5);
  const waves = useDerivedValue<Transforms3d>(() => [
    { translateX: -(((time.get() / WARP_WAVE_MS) % 1) * wavelength) },
  ]);
  const band0 = useDerivedValue<Transforms3d>(() => {
    const [dx, dy] = GLITCH_STEPS[stepOf(time.get(), GLITCH_BANDS[0].period, GLITCH_BANDS[0].lead)]!;
    return [{ translateX: dx }, { translateY: dy * unit }];
  });
  const band1 = useDerivedValue<Transforms3d>(() => {
    const [dx, dy] = GLITCH_STEPS[stepOf(time.get(), GLITCH_BANDS[1].period, GLITCH_BANDS[1].lead)]!;
    return [{ translateX: dx }, { translateY: dy * unit }];
  });
  const ghost = useDerivedValue<Transforms3d>(() => {
    const [dx, dy] = GHOST_STEPS[stepOf(time.get(), WARP_GLITCH_MS[0])]!;
    return [{ translateX: dx }, { translateY: dy }];
  });
  const ghostEcho = useDerivedValue<Transforms3d>(() => {
    const [dx, dy] = GHOST_STEPS[stepOf(time.get(), WARP_GLITCH_MS[0])]!;
    return [{ translateX: -dx }, { translateY: -dy }];
  });
  const ghostOpacity = useDerivedValue(() => alpha.get() * 0.5);
  const echoOpacity = useDerivedValue(() => alpha.get() * 0.35);
  const spin = useDerivedValue<Transforms3d>(() => [
    { translateX: spiralX },
    { translateY: spiralY },
    { rotate: ((time.get() % WARP_SPIRAL_MS) / WARP_SPIRAL_MS) * Math.PI * 2 },
    { scale: spiralScale },
    { translateX: -SPIRAL_BOX / 2 },
    { translateY: -SPIRAL_BOX / 2 },
  ]);
  const spiralOpacity = useDerivedValue(() => alpha.get() * 0.32);

  return (
    <Canvas
      style={[styles.canvas, { width, height }]}
      pointerEvents="none"
      testID={testID ?? (still ? 'hit-warp-still' : 'hit-warp')}
    >
      <Rect x={0} y={0} width={width} height={height} color={colors.sender} opacity={tintSender} />
      <Rect x={0} y={0} width={width} height={height} color={colors.accent} opacity={tintGold} />

      <Group transform={spin} opacity={spiralOpacity}>
        <Path path={SPIRAL_PATH} style="stroke" strokeWidth={4} strokeCap="round" color={colors.sender} />
      </Group>

      <Group transform={waves} opacity={lineOpacity}>
        {lines.map((line, i) => (
          <Path
            key={i}
            path={line.d}
            style="stroke"
            strokeWidth={line.width}
            strokeCap="round"
            color={slots[line.slot]}
          />
        ))}
      </Group>

      <Group transform={band0} opacity={tintSender}>
        <Rect
          x={0}
          y={GLITCH_BANDS[0].top * unit}
          width={width}
          height={GLITCH_BANDS[0].height}
          color={colors.sender}
        />
      </Group>
      <Group transform={band1} opacity={tintGold}>
        <Rect
          x={0}
          y={GLITCH_BANDS[1].top * unit}
          width={width}
          height={GLITCH_BANDS[1].height}
          color={colors.accent}
        />
      </Group>

      {board ? (
        <>
          <Group transform={ghost} opacity={ghostOpacity}>
            <BoardOutline rect={board} color={colors.sender} />
          </Group>
          <Group transform={ghostEcho} opacity={echoOpacity}>
            <BoardOutline rect={board} color={colors.accent} />
          </Group>
        </>
      ) : null}
    </Canvas>
  );
}

/** The board's frame and its box lines (3 × 3), as an outline: the "offset copy". */
function BoardOutline({
  rect,
  color: ink,
}: {
  rect: { x: number; y: number; width: number; height: number };
  color: string;
}) {
  const boxes = useMemo(() => {
    const { x, y, width, height } = rect;
    const v1 = x + width / 3;
    const v2 = x + (2 * width) / 3;
    const h1 = y + height / 3;
    const h2 = y + (2 * height) / 3;
    return `M${v1} ${y}V${y + height}M${v2} ${y}V${y + height}M${x} ${h1}H${x + width}M${x} ${h2}H${x + width}`;
  }, [rect]);
  return (
    <>
      <RoundedRect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        r={radius.board}
        style="stroke"
        strokeWidth={3}
        color={ink}
      />
      <Path path={boxes} style="stroke" strokeWidth={3} color={ink} />
    </>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0 },
});
