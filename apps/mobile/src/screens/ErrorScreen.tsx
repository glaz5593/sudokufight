import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { Text } from '../components/ui/Text';
import { crashReporter } from '../services/crashlytics';
import { color, radius, size, space, text, tokens } from '../theme';

/**
 * The root error boundary's screen (app/_layout.tsx exports it as expo-router's ErrorBoundary): a render error
 * anywhere is recorded in Crashlytics (when the build has it) and the player can try again.
 */
export function ErrorScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const { t } = useTranslation('common');
  useEffect(() => {
    crashReporter().recordError(error, 'error boundary');
  }, [error]);
  return (
    <View style={styles.screen} testID="error-screen">
      <View style={styles.icon}>
        <Icon name="alert" size={size.icon.nav} color={color.danger} />
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {t('crash.title')}
      </Text>
      <Text style={styles.body}>{t('crash.body')}</Text>
      <Button label={t('crash.retry')} size="lg" onPress={() => void retry()} testID="error-retry" />
    </View>
  );
}

const ICON = size.ctaHero - space[8];

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: space[8],
    paddingHorizontal: tokens.layout.gutterGame,
    backgroundColor: color.bg,
  },
  icon: {
    alignSelf: 'center',
    width: ICON,
    height: ICON,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.iconBg.danger,
  },
  title: { ...text('screenTitle'), color: color.text, textAlign: 'center' },
  body: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
});
