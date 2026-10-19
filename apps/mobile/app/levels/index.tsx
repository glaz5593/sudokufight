import type { AppLevel } from '@sudoku-fight/engine';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Spinner } from '../../src/components/ui';
import { levelMapOpenProps } from '../../src/levels/analyticsProps';
import { allLevels } from '../../src/levels/levelsData';
import { openLevelsStorage } from '../../src/levels/levelsStorage';
import { refreshLevels, useLevels, useLevelsProgress, useOpenedChapters } from '../../src/levels/levelsStore';
import { useOwner } from '../../src/progress/hooks';
import { FlowFallback } from '../../src/screens/FlowFallback';
import { goBack } from '../../src/screens/home/navigation';
import { LevelMapScreen } from '../../src/screens/levels/LevelMapScreen';
import { currentLevel, totalStars } from '../../src/screens/levels/mapModel';
import { track } from '../../src/services/analytics';
import { color, size, space, text } from '../../src/theme';

const NO_RECORDS = {};

/** A stage chosen on the map (its panel, or the gate sheet): its own route, ready → play → result. */
const openStage = (id: string) => router.push({ pathname: '/levels/play', params: { id } });

/**
 * /levels: the level map (staged practice, 1.0.2; components.md §19). The stages come from levels.json, read
 * on first use here (never at the app's start); my bests from levels.db (levelsStore, read again each time the
 * map is shown). Signed out, nothing is stored, so the map starts at stage 1. A gate that opened and was not
 * celebrated yet shows its "פרק חדש נפתח" over the map once (levels.db `level_gates.celebrated`).
 * `level_map_open` once per visit, when the map has its numbers.
 */
export default function LevelsRoute() {
  const { t } = useTranslation('levels');
  const { select } = useLocalSearchParams<{ select?: string }>();
  const owner = useOwner();
  const progress = useLevelsProgress();
  const opened = useOpenedChapters();
  const status = useLevels((s) => s.status);
  const [levels] = useState<readonly AppLevel[] | null>(() => {
    try {
      return allLevels();
    } catch (error) {
      console.warn('[levels] the stages could not be read', error);
      return null;
    }
  });
  const [celebrate, setCelebrate] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refreshLevels();
      if (!owner) return;
      let live = true;
      openLevelsStorage()
        .then((db) => db.gatesToCelebrate(owner))
        .then((chapters) => {
          if (live) setCelebrate(chapters[0] ?? null);
        })
        .catch((error: unknown) => {
          if (__DEV__) console.log('[levels] could not read the gates to celebrate', error);
        });
      return () => {
        live = false;
      };
    }, [owner]),
  );

  const celebrated = (chapter: number) => {
    setCelebrate(null);
    if (!owner) return;
    void openLevelsStorage()
      .then(async (db) => {
        await db.markCelebrated(owner, chapter);
        return db.gatesToCelebrate(owner);
      })
      .then((chapters) => setCelebrate(chapters[0] ?? null))
      .catch((error: unknown) => {
        if (__DEV__) console.log('[levels] could not keep the celebration', error);
      });
  };

  // Signed in, the numbers are on their way (or levels.db is unavailable: then the map starts from nothing).
  const waiting = owner !== null && progress === null && status !== 'unavailable';
  const records = progress ?? NO_RECORDS;

  const tracked = useRef(false);
  useEffect(() => {
    if (waiting || !levels || tracked.current) return;
    tracked.current = true;
    track('level_map_open', levelMapOpenProps(currentLevel(records, opened), totalStars(records).stars));
  }, [waiting, levels, records, opened]);

  if (!levels) return <FlowFallback reason="levels: the stages could not be read" onHome={goBack} />;
  if (waiting) {
    return (
      <View style={styles.waiting} testID="level-map-loading">
        <Spinner color={color.textMuted} size={size.icon.nav} />
        <Text style={styles.waitingText}>{t('map.loading')}</Text>
      </View>
    );
  }
  return (
    <LevelMapScreen
      levels={levels}
      records={records}
      openedChapters={opened}
      select={select ?? null}
      celebrate={celebrate}
      onCelebrated={celebrated}
      onBack={goBack}
      onPlay={openStage}
    />
  );
}

const styles = StyleSheet.create({
  waiting: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[6],
    backgroundColor: color.bg,
  },
  waitingText: { ...text('body'), color: color.textMuted },
});
