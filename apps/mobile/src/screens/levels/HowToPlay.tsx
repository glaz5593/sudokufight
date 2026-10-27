import type { AppLevel } from '@sudoku-fight/engine';
import type { LevelTutorialKind } from '@sudoku-fight/protocol';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { Icon } from '../../components/Icon';
import { Button } from '../../components/ui';
import { Text } from '../../components/ui/Text';
import { LEVEL_UI } from '../../config/levels';
import { levelTutorialProps } from '../../levels/analyticsProps';
import { track } from '../../services/analytics';
import { syncSettingsStorage } from '../../state/settings';
import { color, radius, size, space, text, tokens } from '../../theme';
import { TUTORIAL_LINE_PARAMS } from './howToPlayFixtures';
import { KIND_ICON } from './LevelNode';
import { kindName } from './levelWording';

/**
 * "איך משחקים" (components.md §19.8; plan §4.1, §6 #13): before the first stage of each kind, and before the
 * first boss, a card of three panels with "הבנתי" (primary) and "דלג" (ghost), once per kind on this phone. Its
 * end is reported (`level_tutorial`: the kind, and whether it was skipped). This is the shell: the pictures are
 * drawn from the real board (HowToPlayPanels, the stage screens' part) and come in through `renderPanel`; until
 * then each slot shows the kind's mark. Every panel says its line to a screen reader.
 *
 * 1.0.3 (levels-ui.md §3.2) [D77]: the first boss (L010) is also the first race. With
 * LEVEL_UI.mergeFirstBossTutorial (on), a boss whose own kind's card was not seen yet gets that card, with a
 * fourth panel "זה גם שלב בוס" (the boss's first picture), and both cards count as seen: one card, not two in a
 * row. The title of find is its name, "מיקום מדויק", with no digit [D79].
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
 * that kind. [D77] With `merge` (LEVEL_UI.mergeFirstBossTutorial), a first boss whose kind was not seen yet gets
 * its kind's card (HowToPlay adds the boss's panel to it).
 */
export function tutorialFor(
  level: Pick<AppLevel, 'kind' | 'boss'>,
  seen: Partial<Record<LevelTutorialKind, true>>,
  merge: boolean = LEVEL_UI.mergeFirstBossTutorial,
): LevelTutorialKind | null {
  if (level.boss && !seen.boss) return merge && !seen[level.kind] ? level.kind : 'boss';
  return seen[level.kind] ? null : level.kind;
}

/**
 * [D77] The kind's card of a first boss carries the boss's panel too: a boss stage, a kind's card (not the
 * boss's own), the boss's card not seen yet, and the merge on.
 */
export function withBossPanel(
  kind: LevelTutorialKind,
  level: Pick<AppLevel, 'boss'>,
  seen: Partial<Record<LevelTutorialKind, true>>,
  merge: boolean = LEVEL_UI.mergeFirstBossTutorial,
): boolean {
  return merge && level.boss && kind !== 'boss' && !seen.boss;
}

/** Three panels a kind (a fourth, the boss's, on a merged first boss). */
export const TUTORIAL_PANELS = 3;

export interface HowToPlayProps {
  kind: LevelTutorialKind;
  /** The stage it comes before (the kind's name in the title). */
  level: AppLevel;
  /** Seen or skipped: the stage goes on to "מוכן?". */
  onDone: (skipped: boolean) => void;
  /**
   * A panel's picture (the real board); the kind's mark until the stage screens give one. The merged boss panel
   * asks for the boss's first picture ('boss', 0).
   */
  renderPanel?: (kind: LevelTutorialKind, index: number) => ReactNode;
}

export function HowToPlay({ kind, level, onDone, renderPanel }: HowToPlayProps) {
  const { t } = useTranslation('levels');
  const { top, bottom } = useSafeAreaInsets();
  // Decided once, when the card opens: finishing it marks the boss seen, which would take the panel away.
  const [bossPanel] = useState(() => withBossPanel(kind, level, useTutorials.getState().seen));
  const finish = (skipped: boolean) => {
    const { markSeen } = useTutorials.getState();
    markSeen(kind);
    if (bossPanel) markSeen('boss');
    track('level_tutorial', levelTutorialProps(kind, skipped));
    onDone(skipped);
  };
  const title = kind === 'boss' ? t('boss.name') : kindName(level, t);
  const params = TUTORIAL_LINE_PARAMS[kind] ?? {};
  // Each panel: its line, its picture (or, without one, the mark of the card it belongs to).
  const panels: { line: string; picture: ReactNode; mark: LevelTutorialKind }[] = [
    ...Array.from({ length: TUTORIAL_PANELS }, (_, i) => ({
      line: t(`tutorial.${kind}.${i + 1}`, params),
      picture: renderPanel?.(kind, i),
      mark: kind,
    })),
    ...(bossPanel
      ? [{ line: t('tutorial.alsoBoss'), picture: renderPanel?.('boss', 0), mark: 'boss' as const }]
      : []),
  ];
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
        {panels.map(({ line, picture, mark }, i) => (
          <View
            key={i}
            style={styles.panel}
            accessible
            accessibilityLabel={t('tutorial.panel', { n: i + 1, total: panels.length, text: line })}
            testID={`how-to-play-panel-${i + 1}`}
          >
            <View style={styles.picture} testID={`how-to-play-picture-${i + 1}`}>
              {picture ?? (
                <View style={styles.placeholder}>
                  <Icon
                    name={mark === 'boss' ? 'crown' : KIND_ICON[mark]}
                    size={size.icon.nav * 2}
                    color={color.textMuted}
                  />
                </View>
              )}
            </View>
            <Text style={styles.line}>{line}</Text>
          </View>
        ))}
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
