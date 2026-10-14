import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { type AppVersionInfo, appVersionInfo } from '../config/appVersion';
import { color, space, text } from '../theme';
import { ltr } from './player/format';

export interface VersionInfoProps {
  /** What to show; by default this app's (config/appVersion.ts). Null, or no version: nothing. */
  info?: AppVersionInfo | null;
  /** The settings add the engine's version at the end of the second line. */
  engine?: string | number | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Which app this is (Moshe, 14.10.2026: "I can see it in the app"), at the bottom of the settings and of the
 * login screen: "גרסה 1.0.0", and under it, small, "build a1b2c3d · staging" (the commit `npm run apk` built and
 * the game server). Latin text in its own direction (CLAUDE.md: isolated), so it reads the same in Hebrew.
 */
export function VersionInfo({
  info = appVersionInfo(),
  engine = null,
  style,
  testID = 'app-version',
}: VersionInfoProps) {
  const { t } = useTranslation('common');
  if (!info?.version) return null;
  const version = t('appVersion.version', { version: ltr(info.version) });
  const details = [
    info.build ? t('appVersion.build', { build: info.build }) : null,
    info.server,
    engine === null ? null : t('appVersion.engine', { engine }),
  ]
    .filter((part): part is string => part !== null)
    .join(t('player:sep'));
  return (
    <View
      style={[styles.root, style]}
      accessible
      accessibilityLabel={`${version}${t('player:listSep')}${details}`}
      testID={testID}
    >
      <Text style={styles.version} testID={`${testID}-version`}>
        {version}
      </Text>
      <Text style={styles.details} testID={`${testID}-details`}>
        {ltr(details)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: space[1] },
  version: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
  details: { ...text('micro'), color: color.textFaint, textAlign: 'center' },
});
