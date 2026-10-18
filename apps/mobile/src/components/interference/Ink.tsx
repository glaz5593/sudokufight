import { Canvas, Circle, Group, Path, type Transforms3d, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { type SharedValue, useDerivedValue } from 'react-native-reanimated';

import { INK } from './config';
import type { EffectProps } from './effectProps';
import { hitAlpha } from './hitClock';
import { type InkBlot, inkPlan, inkPose } from './inkModel';
import type { EffectColors } from './palette';

/**
 * [D47] Ink over the board (spec §7.1 "כתמי דיו שנמחקים בהדרגה"; Moshe 2026-10-17): five blots splash down one
 * after another, hold, and are wiped away over the last 1.5 s. Skia vector shapes in one canvas; each frame only
 * their scale and opacity change (shared values on the UI thread), so nothing re-renders. The blots land on
 * the board inside the region (the whole screen or the board [D35]); the board's dim [D46] is under them.
 *
 * Reduced motion (spec §22): the same blots, all landed, standing still for the same 5 s (only the hit's fade).
 */
export function Ink({
  width,
  height,
  elapsed,
  totalMs,
  colors,
  reduce,
  fadeInMs,
  fadeOutMs,
  board,
  seed = 0,
  testID,
}: EffectProps) {
  const bx = board?.x ?? 0;
  const by = board?.y ?? 0;
  const bw = board?.width ?? width;
  const bh = board?.height ?? height;
  const plan = useMemo(() => inkPlan(seed, { x: bx, y: by, width: bw, height: bh }), [seed, bx, by, bw, bh]);
  const alpha = useDerivedValue(() => hitAlpha(elapsed.get(), totalMs, fadeInMs, fadeOutMs));

  return (
    <Canvas
      style={[styles.canvas, { width, height }]}
      pointerEvents="none"
      testID={testID ?? (reduce ? 'hit-ink-still' : 'hit-ink')}
    >
      <Group opacity={alpha}>
        {plan.blots.map((blot, i) =>
          reduce ? (
            <BlotArt key={i} blot={blot} colors={colors} />
          ) : (
            <LiveBlot key={i} blot={blot} colors={colors} elapsed={elapsed} totalMs={totalMs} />
          ),
        )}
      </Group>
    </Canvas>
  );
}

function LiveBlot({
  blot,
  colors,
  elapsed,
  totalMs,
}: {
  blot: InkBlot;
  colors: EffectColors;
  elapsed: SharedValue<number>;
  totalMs: number;
}) {
  const pose = useDerivedValue(() => inkPose(blot, elapsed.get(), totalMs));
  const opacity = useDerivedValue(() => pose.get().opacity);
  const transform = useDerivedValue<Transforms3d>(() => [{ scale: pose.get().scale }]);
  const origin = useMemo(() => vec(blot.x, blot.y), [blot.x, blot.y]);
  return (
    <Group origin={origin} transform={transform} opacity={opacity}>
      <BlotArt blot={blot} colors={colors} />
    </Group>
  );
}

/** One blot: the ink, its rim in the sender's colour, and its drops. */
function BlotArt({ blot, colors }: { blot: InkBlot; colors: EffectColors }) {
  return (
    <Group>
      <Path path={blot.path} color={colors.ink} />
      <Path path={blot.path} style="stroke" strokeWidth={INK.rim} strokeJoin="round" color={colors.sender} />
      {blot.drops.map((d, k) => (
        <Circle key={k} cx={d.x} cy={d.y} r={d.r} color={colors.ink} />
      ))}
    </Group>
  );
}

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: 0, top: 0 },
});
