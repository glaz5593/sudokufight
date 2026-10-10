import {
  Canvas,
  createPicture,
  Group,
  PaintStyle,
  Picture,
  Rect,
  Skia,
  type SkPicture,
  StrokeCap,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';

import { drawFireworks, type FireworksPlan, fireworksPlan, STILL_AT_MS } from './fireworksModel';
import type { EffectProps } from './effectProps';
import { hitAlpha } from './hitClock';

/**
 * Fireworks over the region (spec §7.1; Hit-Fireworks; motion.md §4.4), drawn by Skia. The whole frame is one
 * picture recorded on the UI thread from the hit's clock (`elapsed`), a few hundred particles at most: no
 * React render per frame. Under the bursts, a night wash dims what is behind (the interference's job is to
 * get in the way of reading the board; it never hides it completely).
 *
 * Reduced motion (spec §22): one frozen frame with the same bursts in the same places, over the same area,
 * for the same 5 s.
 */
export function Fireworks(props: EffectProps) {
  return props.reduce ? <FireworksStill {...props} /> : <FireworksLive {...props} />;
}

/** How dark the night wash gets (of `color.scrim`). */
export const NIGHT_OPACITY = 0.55;

type Hexes = readonly [string, string, string];

/** Records the plan at `t` into a picture. A worklet: the live version calls it on every frame. */
function recordFireworks(
  plan: FireworksPlan,
  hexes: Hexes,
  t: number,
  alpha: number,
  width: number,
  height: number,
): SkPicture {
  'worklet';
  return createPicture(
    (canvas) => {
      const stroke = Skia.Paint();
      stroke.setAntiAlias(true);
      stroke.setStyle(PaintStyle.Stroke);
      stroke.setStrokeCap(StrokeCap.Round);
      const fill = Skia.Paint();
      fill.setAntiAlias(true);
      const colors = [Skia.Color(hexes[0]), Skia.Color(hexes[1]), Skia.Color(hexes[2])] as const;
      drawFireworks(canvas, { colors, stroke, fill }, plan, t, alpha);
    },
    { width, height },
  );
}

function FireworksLive({
  width,
  height,
  elapsed,
  totalMs,
  colors,
  fadeInMs,
  fadeOutMs,
  testID,
}: EffectProps) {
  const plan = useMemo(() => fireworksPlan(totalMs, width, height), [totalMs, width, height]);
  const hexes: Hexes = useMemo(
    () => [colors.sender, colors.accent, colors.light],
    [colors.sender, colors.accent, colors.light],
  );
  const alpha = useDerivedValue(() => hitAlpha(elapsed.get(), totalMs, fadeInMs, fadeOutMs));
  const wash = useDerivedValue(() => alpha.get() * NIGHT_OPACITY);
  const picture = useDerivedValue(() =>
    recordFireworks(plan, hexes, elapsed.get(), alpha.get(), width, height),
  );

  return (
    <Canvas
      style={[styles.canvas, { width, height }]}
      pointerEvents="none"
      testID={testID ?? 'hit-fireworks'}
    >
      <Rect x={0} y={0} width={width} height={height} color={colors.night} opacity={wash} />
      <Picture picture={picture} />
    </Canvas>
  );
}

function FireworksStill({
  width,
  height,
  elapsed,
  totalMs,
  colors,
  fadeInMs,
  fadeOutMs,
  testID,
}: EffectProps) {
  const picture = useMemo(
    () =>
      recordFireworks(
        fireworksPlan(totalMs, width, height),
        [colors.sender, colors.accent, colors.light],
        STILL_AT_MS,
        1,
        width,
        height,
      ),
    [totalMs, width, height, colors.sender, colors.accent, colors.light],
  );
  // Only the fade moves: in over 200 ms, out over the last 240 ms before the end.
  const alpha = useDerivedValue(() => hitAlpha(elapsed.get(), totalMs, fadeInMs, fadeOutMs));

  return (
    <Canvas
      style={[styles.canvas, { width, height }]}
      pointerEvents="none"
      testID={testID ?? 'hit-fireworks-still'}
    >
      <Group opacity={alpha}>
        <Rect x={0} y={0} width={width} height={height} color={colors.night} opacity={NIGHT_OPACITY} />
        <Picture picture={picture} />
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0 },
});
