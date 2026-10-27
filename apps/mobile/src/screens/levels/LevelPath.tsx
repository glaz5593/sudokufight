import type { AppLevel, GateState } from '@sudoku-fight/engine';
import { memo, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, I18nManager, type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { Star } from '../../components/levels/StarRow';
import { ltr } from '../../components/player/format';
import { Text } from '../../components/ui/Text';
import { color, space, text, tokens } from '../../theme';
import { GatePlate } from './GatePlate';
import { LevelNode } from './LevelNode';
import { chapterName } from './levelWording';
import { type ChapterLayout, itemLayoutOf, MAP, type MapLayout, type NodeInfo } from './mapModel';

/**
 * The path (components.md §19.3; the Main board): a virtualised list with one item per chapter (300 nodes in
 * 30 items), each item drawn from the map's layout (mapModel): its header ("פרק 4 · בלש" and "★ 18/30"), the
 * gate plate under it, the zigzag of its ten nodes and the 2 dp connectors between them, solid up to where I am
 * and faint after. The item heights are known (getItemLayout), so the list opens straight at the current chapter
 * (initialScrollIndex), and the screen then puts the current node at 40 % of the height.
 */

/** What is chosen on the map: a stage, or a gate. */
export type MapSelection = { kind: 'level'; n: number } | { kind: 'gate'; chapter: number };

export interface LevelPathProps {
  /** The map's layout (mapModel; not React Native's `layout` prop, a layout animation's). */
  geometry: MapLayout;
  levelsById: ReadonlyMap<string, AppLevel>;
  nodeOf: (n: number) => NodeInfo;
  /** The gate in front of a chapter (2 and up). */
  gateOf: (chapter: number) => GateState;
  chapterStarsOf: (chapter: number) => { stars: number; max: number };
  selected: MapSelection | null;
  /** The locked node tapped last, and a counter that replays its shake. */
  shake: { n: number; key: number } | null;
  /** The chapter whose gate opened and is shown open for the first time. */
  unlocking: number | null;
  initialIndex: number;
  onNode: (info: NodeInfo) => void;
  onGate: (chapter: number) => void;
  /** The list's own height, once laid out (where 40 % is). */
  onViewport: (height: number) => void;
  listRef: Ref<FlatList<ChapterLayout>>;
}

export function LevelPath({
  geometry: layout,
  levelsById,
  nodeOf,
  gateOf,
  chapterStarsOf,
  selected,
  shake,
  unlocking,
  initialIndex,
  onNode,
  onGate,
  onViewport,
  listRef,
}: LevelPathProps) {
  const { t } = useTranslation('levels');
  return (
    <FlatList
      ref={listRef}
      data={layout.chapters}
      keyExtractor={(c) => String(c.chapter)}
      getItemLayout={itemLayoutOf(layout)}
      initialScrollIndex={initialIndex}
      initialNumToRender={2}
      windowSize={5}
      showsVerticalScrollIndicator={false}
      extraData={[selected, shake, unlocking, nodeOf, gateOf]}
      onLayout={(e: LayoutChangeEvent) => onViewport(e.nativeEvent.layout.height)}
      accessibilityLabel={t('map.label')}
      testID="level-map-list"
      renderItem={({ item }) => (
        <ChapterBlock
          item={item}
          width={layout.width}
          levelsById={levelsById}
          nodeOf={nodeOf}
          gate={item.chapter > 1 ? gateOf(item.chapter) : null}
          stars={chapterStarsOf(item.chapter)}
          selected={selected}
          shake={shake}
          unlocking={unlocking === item.chapter}
          onNode={onNode}
          onGate={onGate}
        />
      )}
    />
  );
}

interface ChapterBlockProps {
  item: ChapterLayout;
  width: number;
  levelsById: ReadonlyMap<string, AppLevel>;
  nodeOf: (n: number) => NodeInfo;
  gate: GateState | null;
  stars: { stars: number; max: number };
  selected: MapSelection | null;
  shake: { n: number; key: number } | null;
  unlocking: boolean;
  onNode: (info: NodeInfo) => void;
  onGate: (chapter: number) => void;
}

const ChapterBlock = memo(function ChapterBlock({
  item,
  width,
  levelsById,
  nodeOf,
  gate,
  stars,
  selected,
  shake,
  unlocking,
  onNode,
  onGate,
}: ChapterBlockProps) {
  const { t } = useTranslation('levels');
  // The svg's x run left to right whatever the language; the layout's x are from the start edge.
  const physical = (x: number) => (I18nManager.isRTL ? width - x : x);
  const name = chapterName(item.chapter, t);
  return (
    <View style={{ height: item.height, width }} testID={`chapter-${item.chapter}`}>
      <Svg
        width={width}
        height={item.height}
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {item.links.map((s, i) => (
          <Line
            key={i}
            x1={physical(s.x1)}
            y1={s.y1}
            x2={physical(s.x2)}
            y2={s.y2}
            stroke={s.reached ? color.iconFaint : color.border}
            strokeWidth={LINK_WIDTH}
            strokeLinecap="round"
          />
        ))}
      </Svg>
      <View style={[styles.header, { top: item.headerY }]} testID={`chapter-${item.chapter}-header`}>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
          {t('chapter', { n: item.chapter })}
        </Text>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.rule} />
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('chapterHeader.label', {
            count: stars.stars,
            stars: stars.stars,
            max: stars.max,
          })}
          style={styles.count}
          testID={`chapter-${item.chapter}-stars`}
        >
          <Star filled={stars.stars > 0} size={HEADER_STAR} />
          <Text style={styles.countText}>{ltr(t('chapterHeader.stars', stars))}</Text>
        </View>
      </View>
      {item.gate && gate ? (
        <View
          style={[
            styles.abs,
            { top: item.gate.y, start: (width - item.gate.width) / 2, width: item.gate.width },
          ]}
        >
          <GatePlate
            chapter={item.chapter}
            gate={gate}
            width={item.gate.width}
            height={item.gate.height}
            selected={selected?.kind === 'gate' && selected.chapter === item.chapter}
            unlocking={unlocking}
            onPress={() => onGate(item.chapter)}
          />
        </View>
      ) : null}
      {item.nodes.map((p) => (
        <View key={p.n} style={[styles.abs, { top: p.cy - p.size / 2, start: p.cx - p.size / 2 }]}>
          <LevelNode
            info={nodeOf(p.n)}
            level={levelsById.get(p.id)}
            selected={selected?.kind === 'level' && selected.n === p.n}
            shakeKey={shake?.n === p.n ? shake.key : 0}
            onPress={onNode}
          />
        </View>
      ))}
    </View>
  );
});

const LINK_WIDTH = 2;
const HEADER_STAR = 14;

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  header: {
    position: 'absolute',
    start: tokens.layout.gutterGame,
    end: tokens.layout.gutterGame,
    // The least: a taller script may need more, never cut (localization plan 0ט).
    minHeight: MAP.headerRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    backgroundColor: color.bg,
  },
  title: { ...text('h2'), color: color.text },
  name: { ...text('caption'), color: color.textMuted, flexShrink: 1 },
  rule: { flex: 1, height: tokens.border.hairline, backgroundColor: color.border },
  count: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  countText: { ...text('scoreSm'), color: color.text },
});
