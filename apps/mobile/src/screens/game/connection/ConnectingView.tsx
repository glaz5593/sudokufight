import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button } from '../../../components/ui/Button';
import { Spinner } from '../../../components/ui/Spinner';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { useReduceMotion } from '../../../theme/motion';
import { Announcer } from './Announcer';
import { CONNECTING_STEPS, type ConnectingModel } from './connectionModel';
import { metrics } from './metrics';
import { useTick } from './motion';

export interface ConnectingViewProps {
  model: ConnectingModel;
  /** "ביטול": stop joining. Left out, there is no button. */
  onCancel?: () => void;
  testID?: string;
}

/**
 * Entering an online game (design Loading, its steps in C's look): "בכניסה למשחק", a spinner, the step
 * ("מתחבר לשרת המשחק…", "נכנס לחדר…", "מסנכרן ניקוד וטיימרים…") and three step marks. One progress bar for
 * screen readers ("טעינת המשחק, שלב 2 מתוך 3"), and each step is announced. Reduced motion: the spinner
 * stands still and the step text only fades.
 */
export function ConnectingView({ model, onCancel, testID = 'connecting' }: ConnectingViewProps) {
  const { t } = useTranslation('game');
  const reduce = useReduceMotion();
  const index = CONNECTING_STEPS.indexOf(model.step);
  const step = t(`connection.connecting.step.${model.step}`);
  const tick = useTick(index, reduce);
  return (
    <View style={styles.root} testID={testID}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('connection.connecting.label', {
          step: index + 1,
          total: CONNECTING_STEPS.length,
        })}
        accessibilityValue={{ min: 1, max: CONNECTING_STEPS.length, now: index + 1, text: step }}
        style={styles.column}
        testID={`${testID}-progress`}
      >
        <Text style={styles.title}>{t('connection.connecting.title')}</Text>
        <Spinner color={color.accent} size={metrics.banner.icon} stroke={tokens.border.lockRing} />
        <Animated.Text style={[styles.step, tick]} testID={`${testID}-step`}>
          {step}
        </Animated.Text>
        <View style={styles.marks}>
          {CONNECTING_STEPS.map((s, k) => (
            <View
              key={s}
              style={[styles.mark, k < index && styles.markDone, k === index && styles.markNow]}
              testID={`${testID}-mark-${s}`}
            />
          ))}
        </View>
      </View>
      {onCancel ? (
        <Button
          label={t('connection.connecting.cancel')}
          onPress={onCancel}
          variant="ghost"
          style={styles.cancel}
          testID={`${testID}-cancel`}
        />
      ) : null}
      <Announcer line={step} testID={`${testID}-live`} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[10],
    paddingHorizontal: tokens.layout.gutterHome,
    backgroundColor: color.bg,
  },
  column: { alignItems: 'center', gap: space[6] },
  title: { ...text('label'), color: color.textMuted },
  step: { ...text('sheetTitle'), color: color.text, textAlign: 'center' },
  marks: { flexDirection: 'row', gap: space[3] },
  mark: {
    width: space[10],
    height: size.dominanceBar.height,
    borderRadius: radius.bar,
    backgroundColor: color.border,
  },
  markDone: { backgroundColor: color.textMuted },
  markNow: { backgroundColor: color.accent },
  cancel: { alignSelf: 'center' },
});
