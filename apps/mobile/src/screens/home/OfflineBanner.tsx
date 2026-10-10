import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/ui/Spinner';
import { color, radius, size, space, text, tokens } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import { useEnter } from '../game/connection/motion';

export interface OfflineBannerProps {
  /** A check is running: "בודק…". */
  checking: boolean;
  testID?: string;
}

/** The banner's icon circle (Offline: 38). */
const ICON_CIRCLE = 38;

/**
 * "אין חיבור לאינטרנט" before a game (spec §16.1; the Offline board in C's look): a wifi-off icon in a red
 * circle, the title, "משחקים מדורגים לא זמינים", and "בודק…" with a spinner while the app checks again.
 * It drops in as it appears (reduced motion: a fade). The screen reads it as one line.
 */
export function OfflineBanner({ checking, testID = 'offline-banner' }: OfflineBannerProps) {
  const { t } = useTranslation('match');
  const reduce = useReduceMotion();
  const enter = useEnter(reduce, 'drop');
  return (
    <Animated.View
      style={[styles.banner, enter]}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={[t('offline.title'), t('offline.body'), checking ? t('offline.checking') : null]
        .filter(Boolean)
        .join(t('sep'))}
      testID={testID}
    >
      <View style={styles.icon}>
        <Icon name="wifiOff" size={size.icon.card} color={color.danger} />
      </View>
      <View style={styles.texts}>
        <Text style={styles.title} numberOfLines={1}>
          {t('offline.title')}
        </Text>
        <Text style={styles.body} numberOfLines={1}>
          {t('offline.body')}
        </Text>
      </View>
      {checking ? (
        <View style={styles.checking} testID={`${testID}-checking`}>
          <Spinner size={size.icon.inline} color={color.textMuted} />
          <Text style={styles.checkingText}>{t('offline.checking')}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[6],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.dangerBorder,
    backgroundColor: color.dangerSubtle,
  },
  icon: {
    width: ICON_CIRCLE,
    height: ICON_CIRCLE,
    borderRadius: radius.pill,
    borderWidth: tokens.border.focus,
    borderColor: color.danger,
    backgroundColor: color.iconBg.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[2] },
  title: { ...text('playerName'), color: color.text },
  body: { ...text('caption'), color: color.textMuted },
  checking: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  checkingText: { ...text('micro'), color: color.textMuted },
});
