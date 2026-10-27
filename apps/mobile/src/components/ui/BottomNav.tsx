import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, size, space, text, tokens } from '../../theme';
import { Icon, type IconName } from '../Icon';

import { Text } from './Text';
export type NavTab = 'home' | 'leaderboard' | 'history' | 'achievements';

/** Start → end: "בית" · "טבלת מובילים" · "היסטוריה" · "הישגים" (Dir-C-Home). In Hebrew "בית" is rightmost. */
export const NAV_TABS: readonly { key: NavTab; icon: IconName }[] = [
  { key: 'home', icon: 'home' },
  { key: 'leaderboard', icon: 'leaderboard' },
  { key: 'history', icon: 'history' },
  { key: 'achievements', icon: 'trophy' },
];

export interface BottomNavProps {
  active: NavTab;
  onSelect: (tab: NavTab) => void;
  testID?: string;
}

/**
 * The bottom navigation of the home-level screens (components.md §16). Never shown during a game.
 * Height is 64 plus the real bottom safe area (the design draws 20).
 */
export function BottomNav({ active, onSelect, testID }: BottomNavProps) {
  const { t } = useTranslation('ui');
  const { bottom } = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t('nav.label')}
      testID={testID}
      style={[styles.bar, { height: size.navBar - size.navBarBottomInset + bottom, paddingBottom: bottom }]}
    >
      {NAV_TABS.map(({ key, icon }) => {
        const selected = key === active;
        const label = t(`nav.tabs.${key}`);
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onSelect(key)}
            testID={testID && `${testID}-${key}`}
            style={styles.item}
          >
            {({ pressed }) => {
              const tint = selected ? color.nav.active : pressed ? color.text : color.nav.inactive;
              return (
                <>
                  <Icon name={icon} size={size.icon.nav} color={tint} />
                  <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
                    {label}
                  </Text>
                </>
              );
            }}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: space[4],
    backgroundColor: color.nav.bg,
    borderTopWidth: tokens.border.hairline,
    borderTopColor: color.nav.border,
  },
  item: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
  },
  label: {
    ...text('label'),
  },
});
