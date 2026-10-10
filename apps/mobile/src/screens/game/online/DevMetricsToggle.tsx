import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../../components/Icon';
import { color, radius, size, space, text, tokens } from '../../../theme';
import { NetMetricsPanel, type NetMetricsSource } from './NetMetricsPanel';

export interface DevMetricsToggleProps {
  source: NetMetricsSource;
  testID?: string;
}

/**
 * Development builds, over an online game: a small "ms" chip at the bottom corner that opens the network
 * measures (spec §18) as a panel at the top of the screen, and closes them again. The game goes on under it;
 * only the chip and the panel take touches.
 */
export function DevMetricsToggle({ source, testID = 'dev-metrics' }: DevMetricsToggleProps) {
  const { t } = useTranslation('dev');
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID={testID}>
      {open ? (
        <View style={[styles.panel, { top: insets.top + space[2] }]} testID={`${testID}-panel`}>
          <ScrollView>
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">
                {t('metrics.title')}
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t('metrics.close')}
                hitSlop={space[4]}
                style={styles.close}
                testID={`${testID}-close`}
              >
                <Icon name="close" size={size.icon.inline} color={color.textMuted} />
              </Pressable>
            </View>
            <NetMetricsPanel source={source} />
          </ScrollView>
        </View>
      ) : null}
      <Pressable
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityLabel={t('metrics.open')}
        accessibilityState={{ expanded: open }}
        style={[styles.chip, { bottom: insets.bottom + space[2] }]}
        testID={`${testID}-chip`}
      >
        <Text style={styles.chipText}>{t('metrics.chip')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    start: tokens.layout.gutterGame,
    end: tokens.layout.gutterGame,
    maxHeight: '70%',
    padding: space[4],
    borderRadius: radius.card,
    backgroundColor: color.bg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space[4],
  },
  title: { ...text('rowTitle'), color: color.text },
  close: {
    minWidth: size.touch,
    minHeight: size.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    position: 'absolute',
    start: space[2],
    minWidth: size.touch,
    minHeight: size.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: color.surface2,
  },
  chipText: { ...text('micro'), color: color.textMuted, writingDirection: 'ltr' },
});
