import { Canvas, Circle, Group, Oval, type Transforms3d } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';

import { color, radius, space, text, tokens } from '../../theme';
import { Text } from '../ui/Text';
import { CatArt } from './CatArt';
import {
  captionAt,
  CAT_RUNS,
  type CatField,
  catField,
  catPose,
  type CatRun,
  catTransform,
  type PawPrint,
  pawPrints,
} from './catsModel';
import type { EffectProps } from './effectProps';
import { hitAlpha } from './hitClock';
import { CAT_PALETTES } from './palette';

/**
 * Cartoon cats galloping across (spec §7.1; Hit-Cats; motion.md §4.4): five of them, of different sizes and
 * speeds, over the board and the screen around it, two shouting "מיאו!". The cats are Skia vector art in one
 * canvas; each frame only their transforms change (shared values on the UI thread), so nothing re-renders.
 * Faint paw prints in the sender's colour mark where they ran.
 *
 * Reduced motion (spec §22): the same five cats in the same spots, standing still, for the same 5 s.
 */
export function Cats({
  width,
  height,
  elapsed,
  totalMs,
  colors,
  reduce,
  fadeInMs,
  fadeOutMs,
  scope,
  testID,
}: EffectProps) {
  const field = useMemo(() => catField(width, height, scope), [width, height, scope]);
  const paws = useMemo(() => pawPrints(field), [field]);
  const alpha = useDerivedValue(() => hitAlpha(elapsed.get(), totalMs, fadeInMs, fadeOutMs));

  return (
    <View
      style={[styles.field, { width, height }]}
      pointerEvents="none"
      testID={testID ?? (reduce ? 'hit-cats-still' : 'hit-cats')}
    >
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group opacity={alpha}>
          {paws.map((paw, i) => (
            <Paw key={i} paw={paw} color={colors.sender} />
          ))}
          {CAT_RUNS.map((run, i) =>
            reduce ? (
              <StillCat key={i} run={run} field={field} />
            ) : (
              <RunningCat key={i} run={run} field={field} elapsed={elapsed} />
            ),
          )}
        </Group>
      </Canvas>
      {CAT_RUNS.map((run, i) =>
        run.caption ? (
          <Caption key={i} run={run} field={field} elapsed={elapsed} alpha={alpha} still={reduce} />
        ) : null,
      )}
    </View>
  );
}

function RunningCat({ run, field, elapsed }: { run: CatRun; field: CatField; elapsed: SharedValue<number> }) {
  const pose = useDerivedValue(() => catPose(run, field, elapsed.get()));
  const transform = useDerivedValue(() => catTransform(pose.get()));
  const swing = useDerivedValue<Transforms3d>(() => [{ rotate: pose.get().swing }]);
  const counter = useDerivedValue<Transforms3d>(() => [{ rotate: -pose.get().swing }]);
  return (
    <Group transform={transform}>
      <CatArt palette={CAT_PALETTES[run.palette]} swing={swing} counter={counter} />
    </Group>
  );
}

const STANDING: Transforms3d = [{ rotate: 0 }];

/** Where it is at the hit's start, legs together. */
function StillCat({ run, field }: { run: CatRun; field: CatField }) {
  const transform = useMemo(() => catTransform(catPose(run, field, 0)), [run, field]);
  return (
    <Group transform={transform}>
      <CatArt palette={CAT_PALETTES[run.palette]} swing={STANDING} counter={STANDING} />
    </Group>
  );
}

/** A paw print (round 1's: a pad and four toes), turned along the run. */
function Paw({ paw, color: ink }: { paw: PawPrint; color: string }) {
  const transform = useMemo<Transforms3d>(
    () => [
      { translateX: paw.x },
      { translateY: paw.y },
      { rotate: paw.angle },
      { scale: paw.size / PAW_BOX },
      { translateX: -PAW_BOX / 2 },
      { translateY: -PAW_BOX / 2 },
    ],
    [paw],
  );
  return (
    <Group transform={transform} color={ink} opacity={paw.opacity}>
      <Oval x={5} y={8.8} width={10} height={8.4} />
      <Circle cx={4.5} cy={7.5} r={2} />
      <Circle cx={8.5} cy={4.5} r={2} />
      <Circle cx={12.5} cy={4.5} r={2} />
      <Circle cx={16} cy={7.5} r={2} />
    </Group>
  );
}
const PAW_BOX = 20;

/** "מיאו!" in a speech bubble that runs with its cat (not tilted, like round 1's). */
function Caption({
  run,
  field,
  elapsed,
  alpha,
  still,
}: {
  run: CatRun;
  field: CatField;
  elapsed: SharedValue<number>;
  alpha: SharedValue<number>;
  still: boolean;
}) {
  const { t } = useTranslation('game');
  const big = run.caption === 'meow';
  const style = useAnimatedStyle(() => {
    const at = captionAt(catPose(run, field, still ? 0 : elapsed.get()));
    return {
      opacity: alpha.get(),
      transform: [{ translateX: at.x }, { translateY: at.y }, { rotate: CAPTION_TILT }],
    };
  });
  return (
    <Animated.View style={[styles.bubble, style]}>
      <Text
        style={[big ? styles.meow : styles.mew, styles.caption]}
        allowFontScaling={false}
        numberOfLines={1}
      >
        {t(`hit.${run.caption ?? 'meow'}`)}
      </Text>
    </Animated.View>
  );
}
const CAPTION_TILT = '-8deg';

const styles = StyleSheet.create({
  // LTR, so `left` and translateX are physical, like the poses.
  field: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', direction: 'ltr' },
  bubble: {
    position: 'absolute',
    left: 0,
    top: 0,
    paddingHorizontal: space[5],
    paddingTop: space[2],
    paddingBottom: space[1],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.textMuted,
    backgroundColor: color.bg,
  },
  meow: text('h1'),
  mew: text('h2'),
  caption: { color: color.text },
});
