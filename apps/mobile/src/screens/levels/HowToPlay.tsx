import type { AppLevel } from '@sudoku-fight/engine';
import type { LevelTutorialKind } from '@sudoku-fight/protocol';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { levelTutorialProps } from '../../levels/analyticsProps';
import { track } from '../../services/analytics';
import { syncSettingsStorage } from '../../state/settings';
import { color, radius, size, space, text, tokens } from '../../theme';
import { KIND_ICON } from './LevelNode';
import { kindName } from './levelWording';

/**
 * "איך משחקים" (components.md §19.8; plan §4.1, §6 #13): before the first stage of each kind, and before the
 * first boss, a card of three panels with "הבנתי" (primary) and "דלג" (ghost), once per kind on this phone. Its
 * end is reported (`level_tutorial`: the kind, and whether it was skipped). This is the shell: the pictures are
 * drawn from the real board (HowToPlayPanels, the stage screens' part) and come in through `renderPanel`; until
 * then each slot shows the kind's mark. Every panel says its line to a screen reader.
 */

/** Which kinds were seen on this phone (kept on the phone, like the settings). */
interface TutorialsState {
  seen: Partial<Record<LevelTutorialKind, true>>;
  markSeen: (kind: LevelTutorialKind) => void;
}

export const useTutorials = create<TutorialsState>()(
  persist(
    (set) => ({
      seen: {},
      markSeen: (kind) => set((s) => ({ seen: { ...s.seen, [kind]: true } })),
    }),
    {
      name: 'levels-tutorials',
      version: 1,
      storage: createJSONStorage(() => syncSettingsStorage),
      partialize: ({ seen }) => ({ seen }),
    },
  ),
);

/**
 * The card a stage needs first, or none: the boss's before the first boss, else its kind's before the first of
 * that kind.
 */
export function tutorialFor(
  level: Pick<AppLevel, 'kind' | 'boss'>,
  seen: Partial<Record<LevelTutorialKind, true>>,
): LevelTutorialKind | null {
  if (level.boss && !seen.boss) return 'boss';
  return seen[level.kind] ? null : level.kind;
}

/** Three panels a kind. */
export const TUTORIAL_PANELS = 3;

export interface HowToPlayProps {
  kind: LevelTutorialKind;
  /** The stage it comes before (the kind's name in the title). */
  level: AppLevel;
  /** Seen or skipped: the stage goes on to "מוכן?". */
  onDone: (skipped: boolean) => void;
  /** A panel's picture (the real board); the kind's mark until the stage screens give one. */
  renderPanel?: (kind: LevelTutorialKind, index: number) => ReactNode;
}

export function HowToPlay({ kind, level, onDone, renderPanel }: HowToPlayProps) {
  const { t } = useTranslation('levels');
  const { top, bottom } = useSafeAreaInsets();
  const finish = (skipped: boolean) => {
    useTutorials.getState().markSeen(kind);
    track('level_tutorial', levelTutorialProps(kind, skipped));
    onDone(skipped);
  };
  const title = kind === 'boss' ? t('boss.name') : kindName(level, t);
  return (
    <View style={[styles.screen, { paddingTop: top, paddingBottom: bottom + space[8] }]} testID="how-to-play">
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text style={styles.over}>{t('tutorial.title')}</Text>
          <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Button
          label={t('tutorial.skip')}
          variant="ghost"
          onPress={() => finish(true)}
          testID="how-to-play-skip"
        />
      </View>
      <ScrollView contentContainerStyle={styles.panels}>
        {Array.from({ length: TUTORIAL_PANELS }, (_, i) => {
          const line = t(`tutorial.${kind}.${i + 1}`);
          return (
            <View
              key={i}
              style={styles.panel}
              accessible
              accessibilityLabel={t('tutorial.panel', { n: i + 1, total: TUTORIAL_PANELS, text: line })}
              testID={`how-to-play-panel-${i + 1}`}
            >
              <View style={styles.picture} testID={`how-to-play-picture-${i + 1}`}>
                {renderPanel?.(kind, i) ?? (
                  <View style={styles.placeholder}>
                    <Icon
                      name={kind === 'boss' ? 'crown' : KIND_ICON[kind]}
                      size={size.icon.nav * 2}
                      color={color.textMuted}
                    />
                  </View>
                )}
              </View>
              <Text style={styles.line}>{line}</Text>
            </View>
          );
        })}
      </ScrollView>
      <Button label={t('tutorial.got')} size="lg" onPress={() => finish(false)} testID="how-to-play-got" />
    </View>
  );
}

const PICTURE_HEIGHT = 140;

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: tokens.layout.gutterGame, gap: space[6], backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[6], minHeight: size.header + space[6] },
  titles: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: space[1] },
  over: { ...text('label'), color: color.textMuted },
  title: { ...text('h1'), color: color.text },
  panels: { gap: space[6], paddingBottom: space[6] },
  panel: {
    gap: space[4],
    padding: space[6],
    borderRadius: radius.card,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  picture: { height: PICTURE_HEIGHT, direction: 'ltr', alignItems: 'center', justifyContent: 'center' },
  placeholder: {
    flex: 1,
    alignSelf: 'stretch',
    borderRadius: radius.md,
    backgroundColor: color.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { ...text('bodyLong'), color: color.text },
});
