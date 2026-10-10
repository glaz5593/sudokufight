import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DS_SECTIONS, type DsSectionKey, DsSection, useContentWidth } from '../components/dev';
import { IconButton } from '../components/ui';
import { useSettings } from '../state/settings';
import { color, radius, size, space, text, tokens } from '../theme';
import { useReduceMotion } from '../theme/motion';

/**
 * Stage 3's development screen, /dev/design-system (docs/02-WORK-PLAN.md, components.md §18): every component
 * of direction C in its states, grouped like the canvas boards DS-Foundations and DS-Components. The header
 * switches the language (the root layout reloads the app when the direction flips) and reduced motion, so each
 * row can be checked in Hebrew, in English, and without motion.
 */
export interface DesignSystemScreenProps {
  /** The close button; the route passes the router's back. Without it there is no close button. */
  onClose?: () => void;
}

export function DesignSystemScreen({ onClose }: DesignSystemScreenProps) {
  const { t } = useTranslation('dev');
  const { top, bottom } = useSafeAreaInsets();
  const content = useContentWidth();
  const reduce = useReduceMotion();
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<DsSectionKey, number>>>({});

  const jump = (key: DsSectionKey) =>
    scroll.current?.scrollTo({ y: offsets.current[key] ?? 0, animated: !reduce });

  return (
    <View style={styles.screen} testID="design-system">
      <Header top={top} onClose={onClose} />
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottom + space[14] }]}
        testID="design-system-scroll"
      >
        <View style={{ width: content }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.index}
            accessibilityLabel={t('screen.index')}
          >
            {DS_SECTIONS.map(({ key }) => (
              <Pressable
                key={key}
                onPress={() => jump(key)}
                accessibilityRole="button"
                accessibilityLabel={t('screen.jumpTo', { section: t(`sections.${key}.title`) })}
                hitSlop={INDEX_SLOP}
                style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                testID={`jump-${key}`}
              >
                <Text style={styles.chipText}>{t(`sections.${key}.title`)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {DS_SECTIONS.map(({ key, Component }) => (
            <DsSection
              key={key}
              title={t(`sections.${key}.title`)}
              note={t(`sections.${key}.note`)}
              onLayout={(e) => {
                offsets.current[key] = e.nativeEvent.layout.y;
              }}
              testID={`section-${key}`}
            >
              <Component />
            </DsSection>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Header({ top, onClose }: { top: number; onClose?: () => void }) {
  const { t } = useTranslation('dev');
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const setReduceMotion = useSettings((s) => s.setReduceMotion);
  const reduce = useReduceMotion();
  const english = language === 'en';

  return (
    <View style={[styles.header, { paddingTop: top + space[4] }]}>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title} accessibilityRole="header">
            {t('screen.title')}
          </Text>
          <Text style={styles.subtitle}>{t('screen.subtitle')}</Text>
        </View>
        {onClose ? (
          <IconButton
            icon="close"
            iconSize="header"
            accessibilityLabel={t('screen.close')}
            onPress={onClose}
          />
        ) : null}
      </View>
      <View style={styles.switches}>
        <View style={styles.switchGroup}>
          <Text style={[styles.switchText, !english && styles.switchOn]}>{t('languages.he')}</Text>
          <Switch
            value={english}
            onValueChange={(on) => setLanguage(on ? 'en' : 'he')}
            accessibilityLabel={t('screen.englishSwitch')}
            accessibilityHint={t('screen.languageHint')}
            trackColor={TRACK}
            thumbColor={color.text}
            testID="switch-language"
          />
          <Text style={[styles.switchText, english && styles.switchOn]}>{t('languages.en')}</Text>
        </View>
        <View style={styles.switchGroup}>
          <Text style={styles.switchText}>{t('screen.reduceMotion')}</Text>
          <Switch
            value={reduce}
            onValueChange={(on) => setReduceMotion(on ? 'on' : 'off')}
            accessibilityLabel={t('screen.reduceMotion')}
            trackColor={TRACK}
            thumbColor={color.text}
            testID="switch-reduce-motion"
          />
        </View>
      </View>
    </View>
  );
}

const TRACK = { false: color.border, true: color.accent } as const;

/** The index chips are 32 high; the slop above and below brings the target to 44 dp (components.md §0.6). */
const INDEX_SLOP = { top: (size.touch - space[12]) / 2, bottom: (size.touch - space[12]) / 2 } as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    paddingHorizontal: tokens.layout.gutterGame,
    paddingBottom: space[6],
    gap: space[6],
    backgroundColor: color.bg,
    borderBottomWidth: tokens.border.hairline,
    borderBottomColor: color.border,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[6] },
  titleBlock: { flex: 1, gap: space[2] },
  title: { ...text('screenTitle'), color: color.text },
  subtitle: { ...text('caption'), color: color.textMuted },
  switches: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space[6] },
  switchGroup: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  switchText: { ...text('label'), color: color.textMuted },
  switchOn: { color: color.text },
  content: { alignItems: 'center', paddingHorizontal: tokens.layout.gutterGame },
  index: { gap: space[4], paddingTop: space[8] },
  chip: {
    height: space[12],
    paddingHorizontal: space[6],
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
  },
  chipPressed: { backgroundColor: color.surface2 },
  chipText: { ...text('label'), color: color.text },
});
