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
 * Entering an online game (design Loading, its game card in C's look): "בכניסה למשחק" over a card titled "טוען
 * לוח…", the progress as three step marks across the card, and under it a small spinner with the step
 * ("מתחבר לשרת המשחק…", "נכנס לחדר…", "מסנכרן ניקוד וטיימרים…"). One progress bar for screen readers ("טעינת
 * המשחק, שלב 2 מתוך 3"), and each step is announced. Reduced motion: the spinner stands still and the step text
 * only fades. (The board's players, mini board and tip need the match's data, which this step doesn't have.)
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
        <View style={styles.card} testID={`${testID}-card`}>
          <Text style={styles.board} testID={`${testID}-board`}>
            {t('connection.connecting.board')}
          </Text>
          <View style={styles.marks}>
            {CONNECTING_STEPS.map((s, k) => (
              <View
                key={s}
                style={[styles.mark, k < index && styles.markDone, k === index && styles.markNow]}
                testID={`${testID}-mark-${s}`}
              />
            ))}
          </View>
          <View style={styles.stepRow}>
            <Spinner color={color.accent} size={size.icon.inline} stroke={tokens.border.lockRing} />
            <Animated.Text style={[styles.step, tick]} numberOfLines={2} testID={`${testID}-step`}>
              {step}
            </Animated.Text>
          </View>
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
  column: { alignSelf: 'stretch', alignItems: 'center', gap: space[4] },
  title: { ...text('label'), color: color.textMuted },
  card: {
    alignSelf: 'stretch',
    gap: space[6],
    padding: space[8],
    borderRadius: radius.xxl,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  board: { ...text('h1'), color: color.text },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  step: { ...text('label'), color: color.text, flexShrink: 1 },
  marks: { flexDirection: 'row', gap: space[2] },
  mark: {
    flex: 1,
    height: metrics.dot.size,
    borderRadius: radius.bar,
    backgroundColor: color.border,
  },
  markDone: { backgroundColor: color.textMuted },
  markNow: { backgroundColor: color.accent },
  cancel: { alignSelf: 'center' },
});
