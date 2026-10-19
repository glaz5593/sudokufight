import { type AppLevel, levelNumber } from '@sudoku-fight/engine';
import { useEffect, useEffectEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { BossBadge } from '../../components/levels/BossBadge';
import { timing } from '../../components/ui/motion';
import { LEVEL_UI } from '../../config/levels';
import { color, radius, size, space, text, tokens } from '../../theme';
import { motion, useReduceMotion } from '../../theme/motion';
import { KIND_ICON } from './LevelNode';
import { ScaleCells } from './LevelPanel';
import { goalText, kindName } from './levelWording';

/**
 * "מוכן?" (components.md §19.8, no board; D56): before a stage's clock starts, for LEVEL_UI.readyMs (2 s), the
 * kind, the goal and the star scale over the empty stage area. No board yet, so the wait gives no thinking time;
 * then the stage begins (onDone), and its clock with it.
 *
 * Motion (`level.ready`): a fade in (240 ms) and out at the end; Reduced Motion: 200 ms fades, the same 2 s.
 * `paused` (the app left the foreground, D65): the 2 s stand still and go on from where they were, the fades with
 * them: the fade out is timed by the same running 2 s (never by the frames, which go on while the app is away),
 * so the stage's intro is still there when the player is back.
 */

export interface ReadyViewProps {
  level: AppLevel;
  onDone: () => void;
  /** How long it shows; LEVEL_UI.readyMs by default. */
  durationMs?: number;
  /** The app is in the background: the wait stands still. */
  paused?: boolean;
}

export function ReadyView({ level, onDone, durationMs = LEVEL_UI.readyMs, paused = false }: ReadyViewProps) {
  const { t } = useTranslation('levels');
  const reduce = useReduceMotion();
  const { top } = useSafeAreaInsets();
  const done = useEffectEvent(onDone);

  // The 2 s, kept across a pause: what is left. The fade out is timed from it too, so it ends with the wait.
  const left = useRef(durationMs);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (paused) return;
    const fade = reduce ? motion.duration.reducedFade : motion.duration.stateChange;
    const started = Date.now();
    const remaining = left.current;
    const out = Math.min(fade, remaining);
    // In (back to full after a pause), and out over the wait's last `fade` ms.
    opacity.set(withTiming(1, timing(fade, 'standard', reduce)));
    const fadeOut = setTimeout(
      () => opacity.set(withTiming(0, timing(out, 'exit', reduce))),
      remaining - out,
    );
    const timer = setTimeout(() => {
      left.current = 0;
      done();
    }, remaining);
    return () => {
      clearTimeout(fadeOut);
      clearTimeout(timer);
      // Stands still with the 2 s: no fade runs on while the app is away.
      cancelAnimation(opacity);
      left.current = Math.max(0, remaining - (Date.now() - started));
    };
  }, [paused, reduce, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  const kind = kindName(level, t);
  const goal = goalText(level, t);
  const n = levelNumber(level.id);
  return (
    <View style={[styles.screen, { paddingTop: top + space[12] }]} testID="level-ready">
      <Animated.View
        style={[styles.content, style]}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('ready.label', { n, kind, goal })}
        testID="level-ready-content"
      >
        <Text style={styles.title}>{t('ready.title')}</Text>
        <View style={styles.kind}>
          <View style={styles.icon}>
            <Icon
              name={level.boss ? 'crown' : KIND_ICON[level.kind]}
              size={size.icon.nav}
              color={color.text}
            />
          </View>
          <Text style={styles.stage} numberOfLines={1}>
            {t('panel.title', { n, kind })}
          </Text>
          {level.boss ? <BossBadge /> : null}
        </View>
        <Text style={styles.goal}>{goal}</Text>
        <View style={styles.scale}>
          <ScaleCells level={level} t={t} testID="level-ready-scale" />
        </View>
      </Animated.View>
    </View>
  );
}

const ICON = 56;

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: tokens.layout.gutterGame, backgroundColor: color.bg },
  content: { alignItems: 'center', gap: space[8] },
  title: { ...text('screenTitle'), color: color.accent, textAlign: 'center' },
  kind: { alignItems: 'center', gap: space[4] },
  icon: {
    width: ICON,
    height: ICON,
    borderRadius: radius.pill,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: { ...text('h1'), color: color.text, textAlign: 'center' },
  goal: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
  scale: { alignSelf: 'stretch' },
});
