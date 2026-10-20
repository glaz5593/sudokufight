import {
  type AppLevel,
  type BotLevelId,
  chapterOf,
  chapterOpen,
  DEFAULT_PROGRESS_RULES,
  type GateState,
  isLevelOpen,
  LEVEL_RULES,
  levelIdOf,
  type LevelRecord,
  levelNumber,
} from '@sudoku-fight/engine';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Star, STAR_SIZES } from '../../components/levels/StarRow';
import { ltr } from '../../components/player/format';
import { useToast } from '../../components/ui';
import { LEVEL_UI } from '../../config/levels';
import { useUnlockAllLevels } from '../../config/testing';
import { bestMetricAt } from '../../levels/levelsRepo';
import { cue } from '../../services/feedback';
import { color, radius, size, space, text, tokens } from '../../theme';
import { useReduceMotion } from '../../theme/motion';
import { ScreenHeader } from '../home/parts';
import { ChapterJumpSheet, type ChapterRow } from './ChapterJumpSheet';
import { ChapterUnlockedView } from './ChapterUnlockedView';
import { GateSheet } from './GateSheet';
import { LevelPanel, type PanelSelection } from './LevelPanel';
import { LevelPath, type MapSelection } from './LevelPath';
import {
  chapterTotal,
  type ChapterLayout,
  currentLevel,
  everyChapter,
  gateBefore,
  indexOfChapter,
  mapLayout,
  nodeInfo,
  type NodeInfo,
  openOffset,
  totalStars,
  unlockedNode,
} from './mapModel';

/**
 * The level map, /levels (components.md §19.2–§19.4; the Main and Map-Gate boards): the header (back, "אימון
 * בשלבים" and the "★ 84/900" chip that opens the chapter list), the path of 300 stages by chapter, and the docked
 * panel of what is chosen. It opens at the current chapter, with the current node at 40 % of the height.
 *
 * - A stage tapped: chosen, the panel says it. A locked one shakes and the map says why ("קודם משחקים את שלב 37",
 *   or its chapter's gate).
 * - A gate tapped: a closed one opens the gate sheet (up to 3 stages to play again); an open one is shown in the
 *   panel.
 * - The panel's button plays: "המשך · שלב 37" for the current stage, "שחק" for another open one.
 * - A gate that opened and was not celebrated yet: "פרק חדש נפתח" over the map, once.
 *
 * What is open, the gates and the stars: the engine's rules over levels.db's records (the route reads them).
 * Every navigation waits for a closing sheet to leave first (no window torn down with the screen).
 */

/**
 * My bests by stage id, as levels.db reads them: the engine's records, the best measure and the rev it was made
 * at (best_rev; null for a row restored from the server). A best made at another rev is not shown [D73].
 */
export type MapRecords = Readonly<
  Record<string, (LevelRecord & { metric?: number | null; rev?: number | null }) | undefined>
>;

export interface LevelMapScreenProps {
  /** The stages (levels.json, read on first use). */
  levels: readonly AppLevel[];
  /** My bests by stage id (levels.db), with the measure for "השיא שלי". */
  records: MapRecords;
  /** The chapters a gate opened once. */
  openedChapters: readonly number[];
  /**
   * Every stage open (a staging build's "פתח את כל השלבים (בדיקה)", config/testing.ts); the switch by default.
   * Stars and XP count as usual.
   */
  unlockAll?: boolean;
  /** A stage to choose when the map opens (the result's "לשלב הבא" with the quick entry off). */
  select?: string | null;
  /** A chapter whose gate opened and whose "פרק חדש נפתח" waits, and when it was shown. */
  celebrate?: number | null;
  onCelebrated?: (chapter: number) => void;
  onBack: () => void;
  onPlay: (levelId: string) => void;
}

export function LevelMapScreen({
  levels,
  records,
  openedChapters: openedOnce,
  unlockAll: unlockAllProp,
  select = null,
  celebrate = null,
  onCelebrated,
  onBack,
  onPlay,
}: LevelMapScreenProps) {
  const { t } = useTranslation('levels');
  // The testing switch: every chapter as opened (every gate open), and every node open (nodeOf).
  const unlockSwitch = useUnlockAllLevels();
  const unlockAll = unlockAllProp ?? unlockSwitch;
  const openedChapters = useMemo(() => (unlockAll ? everyChapter() : openedOnce), [unlockAll, openedOnce]);
  const reduce = useReduceMotion();
  const { top, bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const levelsById = useMemo(() => new Map(levels.map((l) => [l.id, l])), [levels]);
  const current = useMemo(() => currentLevel(records, openedChapters), [records, openedChapters]);
  const layout = useMemo(
    () =>
      mapLayout(width, LEVEL_UI.mapDirection, {
        plateOf: (c) => (gateBefore(c, records, openedChapters).open ? 'open' : 'closed'),
        isOpen: (n) => unlockAll || isLevelOpen(n, records, openedChapters),
      }),
    [width, records, openedChapters, unlockAll],
  );
  const nodeOf = useCallback(
    (n: number): NodeInfo => {
      const info = nodeInfo(n, records, openedChapters, current);
      return unlockAll ? unlockedNode(info) : info;
    },
    [records, openedChapters, current, unlockAll],
  );
  const gateOf = useCallback(
    (c: number) => gateBefore(c, records, openedChapters),
    [records, openedChapters],
  );
  const chapterStarsOf = useCallback((c: number) => chapterTotal(c, records), [records]);

  const preselected = select ? levelNumber(select) : null;
  const [selected, setSelected] = useState<MapSelection>({ kind: 'level', n: preselected ?? current });
  const [shake, setShake] = useState<{ n: number; key: number } | null>(null);
  const [gateSheet, setGateSheet] = useState<number | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  /** A stage picked in the gate sheet: played once the sheet has left the screen. */
  const pendingPlay = useRef<string | null>(null);

  // Open at the current (or chosen) node, at 40 % of the map's height; once.
  const list = useRef<FlatList<ChapterLayout>>(null);
  const focus = preselected ?? current;
  const initialIndex = Math.max(0, indexOfChapter(layout, chapterOf(focus)));
  const placed = useRef(false);
  const viewport = useRef(0);
  const onViewport = (height: number) => {
    viewport.current = height;
    if (placed.current || height <= 0) return;
    placed.current = true;
    list.current?.scrollToOffset({ offset: openOffset(layout, focus, height), animated: false });
  };

  // Back from a stage, the current one moved on: the choice follows it (when it was on the old one), and so
  // does the map (derived during render; the scroll once it has run).
  const [seenCurrent, setSeenCurrent] = useState(current);
  if (current !== seenCurrent) {
    setSeenCurrent(current);
    if (selected.kind === 'level' && selected.n === seenCurrent) setSelected({ kind: 'level', n: current });
  }
  const follow = useEffectEvent((n: number) => {
    if (!placed.current || viewport.current <= 0) return;
    list.current?.scrollToOffset({ offset: openOffset(layout, n, viewport.current), animated: !reduce });
  });
  // Only when the current stage moves (not for a new layout of the same progress).
  useEffect(() => follow(current), [current]);

  const toast = (message: string) => useToast.getState().show({ variant: 'info', message });

  const onNode = (info: NodeInfo) => {
    setSelected({ kind: 'level', n: info.n });
    if (info.state !== 'locked') {
      cue('toggle');
      return;
    }
    cue('cellDenied');
    setShake((s) => ({ n: info.n, key: (s?.key ?? 0) + 1 }));
    const chapter = chapterOf(info.n);
    if (chapter > 1 && !chapterOpen(chapter, records, openedChapters)) {
      const gate = gateOf(chapter);
      toast(t('map.gateToast', { chapter, need: gate.need, prev: chapter - 1 }));
    } else toast(t('map.lockedToast', { n: current }));
  };

  const onGate = (chapter: number) => {
    setSelected({ kind: 'gate', chapter });
    cue('toggle');
    if (!gateOf(chapter).open) setGateSheet(chapter);
  };

  const onJump = (chapter: number) => {
    setJumpOpen(false);
    const index = indexOfChapter(layout, chapter);
    if (index >= 0) list.current?.scrollToIndex({ index, animated: !reduce });
  };

  const sheetGone = () => {
    const id = pendingPlay.current;
    pendingPlay.current = null;
    if (id) onPlay(id);
  };

  const total = totalStars(records);
  const panel = panelSelection(selected, levelsById, nodeOf, gateOf, records, openedChapters);
  const chapters: ChapterRow[] = useMemo(
    () =>
      Array.from({ length: LEVEL_RULES.chapterCount }, (_, i) => ({
        chapter: i + 1,
        ...chapterTotal(i + 1, records),
        open: chapterOpen(i + 1, records, openedChapters),
      })),
    [records, openedChapters],
  );
  const celebrated = celebrate !== null ? chapterBot(levels, celebrate) : null;

  return (
    <View style={[styles.screen, { paddingTop: top }]} testID="level-map">
      <ScreenHeader
        title={t('title')}
        onBack={onBack}
        style={styles.header}
        end={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('map.totalLabel', total)}
            onPress={() => setJumpOpen(true)}
            style={styles.totalButton}
            testID="level-map-total"
          >
            <View style={styles.total}>
              <Star filled size={STAR_SIZES.chip + 3} />
              <Text style={styles.totalText}>{ltr(t('map.total', total))}</Text>
            </View>
          </Pressable>
        }
      />
      <View style={styles.map}>
        <LevelPath
          geometry={layout}
          levelsById={levelsById}
          nodeOf={nodeOf}
          gateOf={gateOf}
          chapterStarsOf={chapterStarsOf}
          selected={selected}
          shake={shake}
          unlocking={celebrate}
          initialIndex={initialIndex}
          onNode={onNode}
          onGate={onGate}
          onViewport={onViewport}
          listRef={list}
        />
      </View>
      {panel ? (
        <LevelPanel
          selection={panel}
          current={current}
          onPlay={(n) => onPlay(levelIdOf(n))}
          bottomInset={bottom}
        />
      ) : null}
      <GateSheet
        visible={gateSheet !== null}
        chapter={gateSheet}
        gate={gateSheet !== null ? gateOf(gateSheet) : null}
        records={records}
        levelsById={levelsById}
        onClose={() => setGateSheet(null)}
        onPick={(id) => {
          pendingPlay.current = id;
          setGateSheet(null);
        }}
        onExited={sheetGone}
      />
      <ChapterJumpSheet
        visible={jumpOpen}
        chapters={chapters}
        onClose={() => setJumpOpen(false)}
        onJump={onJump}
      />
      {celebrate !== null ? (
        <ChapterUnlockedView
          chapter={celebrate}
          bot={celebrated}
          xp={DEFAULT_PROGRESS_RULES.xp.levelGate}
          onDone={() => onCelebrated?.(celebrate)}
        />
      ) : null}
    </View>
  );
}

/** The bot of a chapter: the first of its stages against one (Pip in chapter 2, Biscuit from 5…). */
function chapterBot(levels: readonly AppLevel[], chapter: number): BotLevelId | null {
  const level = levels.find((l) => l.chapter === chapter && l.bot);
  return (level?.bot?.level as BotLevelId | undefined) ?? null;
}

/** What the panel shows for the choice on the map. */
function panelSelection(
  selected: MapSelection,
  levelsById: ReadonlyMap<string, AppLevel>,
  nodeOf: (n: number) => NodeInfo,
  gateOf: (c: number) => GateState,
  records: MapRecords,
  openedChapters: readonly number[],
): PanelSelection | null {
  if (selected.kind === 'gate')
    return { kind: 'gate', chapter: selected.chapter, gate: gateOf(selected.chapter) };
  const id = levelIdOf(selected.n);
  const level = levelsById.get(id);
  if (!level) return null;
  const info = nodeOf(selected.n);
  const chapter = chapterOf(selected.n);
  const lockedBy: Extract<PanelSelection, { kind: 'level' }>['lockedBy'] =
    info.state !== 'locked'
      ? undefined
      : chapter > 1 && !chapterOpen(chapter, records, openedChapters)
        ? { kind: 'gate', gate: gateOf(chapter) }
        : { kind: 'previous', n: selected.n - 1 };
  // [D73] "השיא שלי" starts over on a rebuilt level (a new rev, maybe a new kind): the old rev's best is hidden.
  const record = records[id];
  const bestMetric = bestMetricAt({ metric: record?.metric ?? null, rev: record?.rev ?? null }, level.rev);
  return { kind: 'level', level, info, bestMetric, lockedBy };
}

const TOTAL_CHIP = 32;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { paddingHorizontal: tokens.layout.gutterGame },
  totalButton: { minHeight: size.touch, justifyContent: 'center' },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    height: TOTAL_CHIP,
    paddingHorizontal: space[6],
    borderRadius: radius.pill,
    borderWidth: tokens.border.hairline,
    borderColor: color.border,
    backgroundColor: color.surface2,
  },
  totalText: { ...text('scoreSm'), color: color.text },
  map: { flex: 1 },
});
