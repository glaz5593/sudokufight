import {
  type AppLevel,
  type GateState,
  LEVEL_RULES,
  type LevelRecords,
  levelIdOf,
  levelNumber,
  replayCandidates,
  type Stars,
} from '@sudoku-fight/engine';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LevelTile } from '../../components/levels/LevelTile';
import { MiniBar } from '../../components/levels/MiniBar';
import { Star, StarRow, STAR_SIZES } from '../../components/levels/StarRow';
import { ltr } from '../../components/player/format';
import { Button, Sheet } from '../../components/ui';
import { color, radius, size, space, text, tokens } from '../../theme';
import { kindName, type LevelsT, starsOf3 } from './levelWording';

/**
 * A locked gate's sheet (components.md §19.11; the Map-Gate board): "פרק 5 נעול", the stars it still needs
 * ("צריך 20 כוכבים בפרק 4. יש לך 17, חסרים 3."), up to three stages worth playing again (the engine's
 * replayCandidates: first the chapter's next stage not played yet, such as the boss, then the fewest stars, a tie
 * to the most recent), each with "שחק", the primary "שחק את שלב 34", and the footnote. With enough stars and the
 * boss not played, it says so ("יש לך מספיק כוכבים. שחק את שלב 40 (בוס) כדי לפתוח") and the boss is the primary.
 *
 * A stage is played only once the sheet has left the screen (onExited): no navigation under a closing window.
 */

export interface GateSheetProps {
  visible: boolean;
  /** The locked chapter (the gate at the end of the chapter before). */
  chapter: number | null;
  gate: GateState | null;
  records: LevelRecords;
  levelsById: ReadonlyMap<string, AppLevel>;
  onClose: () => void;
  /** A stage chosen in it: the map plays it once the sheet is gone. */
  onPick: (levelId: string) => void;
  onExited?: () => void;
}

/** What the sheet offers (pure; the tests read it): the candidates, the primary, and whether only the boss is missing. */
export function gateSheetModel(chapter: number, gate: GateState, records: LevelRecords) {
  const prev = chapter - 1;
  const ids = replayCandidates(prev, records);
  const boss = levelIdOf(prev * LEVEL_RULES.chapterSize);
  const bossOnly = gate.stars >= gate.need && !gate.bossPlayed;
  const primary = bossOnly ? boss : (ids[0] ?? boss);
  const missing = ids.reduce((sum, id) => sum + (3 - (records[id]?.stars ?? 0)), 0);
  return { prev, ids, boss, bossOnly, primary, missing };
}

export function GateSheet({
  visible,
  chapter,
  gate,
  records,
  levelsById,
  onClose,
  onPick,
  onExited,
}: GateSheetProps) {
  const { t } = useTranslation('levels');
  const model = chapter !== null && gate ? gateSheetModel(chapter, gate, records) : null;
  return (
    <Sheet
      visible={visible && model !== null}
      onClose={onClose}
      onExited={onExited}
      title={chapter === null ? '' : t('gateSheet.title', { n: chapter })}
      testID="gate-sheet"
    >
      {model && gate && chapter !== null ? (
        <View style={styles.body}>
          <Text style={styles.line} testID="gate-sheet-body">
            {model.bossOnly
              ? t('gateSheet.bossOnly', { boss: levelNumber(model.boss) })
              : t('gateSheet.missing', {
                  need: gate.need,
                  prev: model.prev,
                  stars: gate.stars,
                  missing: Math.max(0, gate.need - gate.stars),
                })}
          </Text>
          <View
            style={styles.progress}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('gateSheet.progress', {
              prev: model.prev,
              stars: Math.min(gate.stars, gate.need),
              need: gate.need,
            })}
          >
            <View style={styles.flex}>
              <MiniBar share={gate.stars / gate.need} height={BAR} />
            </View>
            <Star filled size={STAR_SIZES.panel} />
            <Text style={styles.count}>{ltr(t('gate.count', { stars: gate.stars, need: gate.need }))}</Text>
          </View>
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {t('gateSheet.rowsTitle')}
            </Text>
            <View style={styles.rule} />
            {model.missing > 0 ? (
              <Text style={styles.sectionNote} numberOfLines={1}>
                {t('gateSheet.rowsNote', { count: model.missing })}
              </Text>
            ) : null}
          </View>
          <View style={styles.rows} testID="gate-sheet-rows">
            {model.ids.map((id) => (
              <Row
                key={id}
                id={id}
                level={levelsById.get(id)}
                stars={records[id]?.stars ?? 0}
                played={(records[id]?.plays ?? 0) > 0}
                onPick={onPick}
                t={t}
              />
            ))}
          </View>
          <Button
            label={t('gateSheet.primary', { n: levelNumber(model.primary) })}
            size="md"
            onPress={() => onPick(model.primary)}
            testID="gate-sheet-primary"
          />
          <Text style={styles.footnote}>{t('gateSheet.footnote')}</Text>
        </View>
      ) : null}
    </Sheet>
  );
}

function Row({
  id,
  level,
  stars,
  played,
  onPick,
  t,
}: {
  id: string;
  level: AppLevel | undefined;
  stars: Stars;
  played: boolean;
  onPick: (id: string) => void;
  t: LevelsT;
}) {
  const n = levelNumber(id) ?? 0;
  const kind = level ? kindName(level, t) : '';
  const label = played
    ? t('gateSheet.rowLabel', { n, kind, stars: starsOf3(stars, t) })
    : t('gateSheet.rowNewLabel', { n, kind });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPick(id)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`gate-sheet-row-${n}`}
    >
      <LevelTile
        n={n}
        size={ROW_TILE}
        state="played"
        boss={level?.boss}
        testID={`gate-sheet-row-${n}-tile`}
      />
      <Text style={styles.rowTitle} numberOfLines={1}>
        {t('gateSheet.row', { n, kind })}
      </Text>
      <StarRow stars={stars} size={STAR_SIZES.chip} label={null} testID={`gate-sheet-row-${n}-stars`} />
      <Text style={styles.play}>{t('gateSheet.rowPlay')}</Text>
    </Pressable>
  );
}

const BAR = 6;
/** The rows' tiles: 36 (the Map-Gate board). */
const ROW_TILE = 36;

const styles = StyleSheet.create({
  body: { gap: space[6], paddingTop: space[4] },
  line: { ...text('bodyLong'), color: color.text },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1 },
  count: { ...text('scoreDelta'), color: color.text },
  section: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  sectionTitle: { ...text('label'), color: color.textMuted },
  rule: { flex: 1, height: tokens.border.hairline, backgroundColor: color.border },
  sectionNote: { ...text('caption'), color: color.textMuted, flexShrink: 1 },
  rows: { gap: space[3] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    minHeight: size.listRow - space[4],
    paddingHorizontal: space[5],
    borderRadius: radius.lg,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  rowPressed: { backgroundColor: color.border },
  rowTitle: { ...text('buttonSm'), color: color.text, flex: 1, minWidth: 0 },
  play: { ...text('label'), color: color.accent },
  footnote: { ...text('caption'), color: color.textMuted, textAlign: 'center' },
});
