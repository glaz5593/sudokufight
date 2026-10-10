import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../../components/Icon';
import { BottomNav, type NavTab } from '../../components/ui';
import { color, radius, size, space, text, tokens } from '../../theme';
import { goToTab } from './navigation';
import { Chip, GUTTER } from './parts';

/** The tabs that are not built yet: the leaderboard and achievements (stage 12) and the history (stage 11). */
export type PlaceholderTab = Exclude<NavTab, 'home'>;

const ICON: Record<PlaceholderTab, IconName> = {
  leaderboard: 'leaderboard',
  history: 'history',
  achievements: 'trophy',
};

/** A bottom-nav tab that comes in a later stage: its title, a "בקרוב" note, and the navigation. */
export function PlaceholderScreen({ tab }: { tab: PlaceholderTab }) {
  const { t } = useTranslation('home');
  const { top } = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: top }]} testID={`placeholder-${tab}`}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          {t(`placeholder.${tab}.title`)}
        </Text>
        <View style={styles.card}>
          <View style={styles.iconBox}>
            <Icon name={ICON[tab]} size={size.icon.nav} color={color.textMuted} />
          </View>
          <Chip label={t('placeholder.soon')} />
          <Text style={styles.body}>{t(`placeholder.${tab}.body`)}</Text>
        </View>
      </ScrollView>
      <BottomNav active={tab} onSelect={(next) => goToTab(next, tab)} testID="nav" />
    </View>
  );
}

/** The icon's tile: as wide as a touch target. */
const ICON_BOX = size.touch + space[6];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: GUTTER.home, paddingTop: space[8], paddingBottom: space[12], gap: space[12] },
  title: { ...text('screenTitle'), color: color.text },
  card: {
    alignItems: 'center',
    gap: space[6],
    padding: space[10],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  iconBox: {
    width: ICON_BOX,
    height: ICON_BOX,
    borderRadius: radius.xl,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { ...text('bodyLong'), color: color.textMuted, textAlign: 'center' },
});
