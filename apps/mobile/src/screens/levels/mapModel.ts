import {
  chapterLevelIds,
  chapterOf,
  chapterStars,
  countsAsPlayed,
  gateState,
  type GateState,
  isBossLevel,
  isLevelOpen,
  LEVEL_RULES,
  levelIdOf,
  type LevelOutcome,
  type LevelRecords,
  type LevelRules,
  maxLevel,
  nextLevelId,
  type Stars,
} from '@sudoku-fight/engine';

import { size } from '../../theme';

/**
 * The level map's geometry and states (components.md §19.2–§19.3; the Main and Map-Gate boards). Pure: the
 * screen's FlatList takes its item heights (getItemLayout) and where to open from here, and every number of the
 * boards is a constant below. What is open, the gates and the stars come from the engine's progress rules
 * (isLevelOpen, gateState, chapterStars): nothing is decided here.
 *
 * The map is one list item per chapter. An item stacks, top to bottom ('down', D60):
 *   16 above · the chapter header (44) · the gate plate under it (52 closed, 44 open, then 16; the first chapter
 *   has none, 4) · the nodes on a zigzag, 56 apart (64 to the boss) · their stars (16) · 12 below (with the
 *   next item's 16 above, the board's 28 between a boss's stars and the next header).
 * Node centres are measured from the start edge (the right in Hebrew) on the boards' 390 dp phone:
 * [64, 146, 228, 310, 228, 146], scaled down on a narrower one and centred on a wider one. `mapDirection: 'up'`
 * turns every item upside down and the list's order around: stage 1 at the bottom.
 */

export type MapDirection = 'down' | 'up';

/** The Main board's numbers. */
export const MAP = {
  /** The boards' phone width: the zigzag's x are for it. */
  boardWidth: 390,
  /** Node centres from the start edge, period 6. */
  zigzag: [64, 146, 228, 310, 228, 146],
  /** Above each chapter's header (the list's top padding on the board). */
  top: 16,
  header: 44,
  /** The chapter header's own row inside its 44. */
  headerRow: 32,
  gateClosed: 52,
  gateOpen: 44,
  /** Under the plate, before the first node. */
  gateGap: 16,
  /** The first chapter has no gate: its first node starts this far under the header. */
  noGate: 4,
  /** From one node's centre to the next, and to the boss's. */
  pitch: 56,
  pitchBoss: 64,
  /** The stars under a tile: 4 below it, 12 high. */
  starsRow: 16,
  /**
   * Under the last node's stars: the board's 28 before the next header, less the 16 above it (each item has
   * its own `top`).
   */
  bottom: 12,
  /** The plates' widths. */
  plateClosedWidth: 220,
  plateOpenWidth: 180,
  /** The current node sits at this share of the map's height when it opens. */
  openAt: 0.4,
} as const;

export const nodeSize = (boss: boolean): number => (boss ? size.levelNodeBoss : size.levelNode);

export interface NodeSpot {
  id: string;
  /** The stage number, 1–300. */
  n: number;
  boss: boolean;
  /** The centre: x from the start edge, y from the item's top. */
  cx: number;
  cy: number;
  /** The tile's side (56, or 68 for the boss). */
  size: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Solid up to where I am (the end is open), faint after. */
  reached: boolean;
}

export type PlateKind = 'closed' | 'open';

export interface ChapterLayout {
  chapter: number;
  /** From the top of the list. */
  offset: number;
  height: number;
  /** The header's row top, in the item. */
  headerY: number;
  /** The gate plate under the header (chapters 2 and up): its box and centre x from the start edge. */
  gate: { y: number; height: number; width: number; cx: number; kind: PlateKind } | null;
  nodes: NodeSpot[];
  /** The path's connectors in this item, the halves of a link across items included. */
  links: Segment[];
}

export interface MapLayout {
  width: number;
  direction: MapDirection;
  /** In list order (chapter 30 first when 'up'). */
  chapters: ChapterLayout[];
  /** The list's whole height. */
  height: number;
}

export interface MapLayoutOptions {
  /** Each gate's plate: closed or open (by the chapter it opens). Closed when missing. */
  plateOf?: (chapter: number) => PlateKind;
  /** Whether a stage is open (its node and the line up to it solid). */
  isOpen?: (n: number) => boolean;
  rules?: LevelRules;
}

/** The zigzag's x for a stage on a map `width` wide: the boards' 390 scaled down (never up), and centred. */
export function zigzagX(n: number, width: number): number {
  const scale = Math.min(1, width / MAP.boardWidth);
  const offset = (width - MAP.boardWidth * scale) / 2;
  return offset + MAP.zigzag[(n - 1) % MAP.zigzag.length]! * scale;
}

/**
 * The whole map's layout (getItemLayout's offsets and heights, the nodes, the gates and the path). Pure: the
 * plates' states and what is open come in as functions of the progress.
 */
export function mapLayout(
  width: number,
  direction: MapDirection,
  { plateOf = () => 'closed', isOpen = () => false, rules = LEVEL_RULES }: MapLayoutOptions = {},
): MapLayout {
  // First 'down', chapter 1 at the top, in coordinates of the whole map; then cut into items.
  const items: ChapterLayout[] = [];
  let y = 0;
  /** The previous chapter's last node (its boss), where the path comes from. */
  let from: { x: number; y: number } | null = null;
  const segments: Segment[] = [];
  for (let chapter = 1; chapter <= rules.chapterCount; chapter++) {
    const top = y;
    const headerY = MAP.top;
    let cursor = top + MAP.top + MAP.header;
    let gate: ChapterLayout['gate'] = null;
    const segs: Segment[] = [];
    const ids = chapterLevelIds(chapter, rules);
    if (chapter > 1) {
      const kind = plateOf(chapter);
      const h = kind === 'closed' ? MAP.gateClosed : MAP.gateOpen;
      const w = kind === 'closed' ? MAP.plateClosedWidth : MAP.plateOpenWidth;
      gate = { y: cursor - top, height: h, width: w, cx: width / 2, kind };
      const centre = { x: width / 2, y: cursor + h / 2 };
      if (from) segs.push({ x1: from.x, y1: from.y, x2: centre.x, y2: centre.y, reached: kind === 'open' });
      from = centre;
      cursor += h + MAP.gateGap;
    } else {
      cursor += MAP.noGate;
    }
    const nodes: NodeSpot[] = [];
    let prevCy: number | null = null;
    for (const id of ids) {
      const n = (chapter - 1) * rules.chapterSize + nodes.length + 1;
      const boss = isBossLevel(n, rules);
      const half = nodeSize(boss) / 2;
      const cy: number = prevCy === null ? cursor + half : prevCy + (boss ? MAP.pitchBoss : MAP.pitch);
      prevCy = cy;
      const cx = zigzagX(n, width);
      nodes.push({ id, n, boss, cx, cy, size: nodeSize(boss) });
      if (from) segs.push({ x1: from.x, y1: from.y, x2: cx, y2: cy, reached: isOpen(n) });
      from = { x: cx, y: cy };
    }
    const last = nodes[nodes.length - 1]!;
    const end = last.cy + last.size / 2 + MAP.starsRow + MAP.bottom;
    items.push({
      chapter,
      offset: top,
      height: end - top,
      headerY,
      gate,
      nodes: nodes.map((p) => ({ ...p, cy: p.cy - top })),
      links: [],
    });
    segments.push(...segs);
    y = end;
  }
  const total = y;
  // Each segment drawn by the items it crosses, cut at their edges (an item draws only inside itself).
  for (const seg of segments) {
    for (const item of items) {
      const a = item.offset;
      const b = item.offset + item.height;
      const lo = Math.min(seg.y1, seg.y2);
      const hi = Math.max(seg.y1, seg.y2);
      if (hi <= a || lo >= b) continue;
      const at = (yy: number) => seg.x1 + ((seg.x2 - seg.x1) * (yy - seg.y1)) / (seg.y2 - seg.y1 || 1);
      const y1 = Math.max(seg.y1, a);
      const y2 = Math.min(seg.y2, b);
      item.links.push({ x1: at(y1), y1: y1 - a, x2: at(y2), y2: y2 - a, reached: seg.reached });
    }
  }
  if (direction === 'down') return { width, direction, chapters: items, height: total };
  // 'up': each item upside down, and the list from the last chapter to the first.
  const flipped = [...items].reverse();
  let offset = 0;
  const chapters = flipped.map((item) => {
    const h = item.height;
    const out: ChapterLayout = {
      ...item,
      offset,
      headerY: h - item.headerY - MAP.headerRow,
      gate: item.gate ? { ...item.gate, y: h - item.gate.y - item.gate.height } : null,
      nodes: item.nodes.map((p) => ({ ...p, cy: h - p.cy })),
      links: item.links.map((s) => ({ ...s, y1: h - s.y1, y2: h - s.y2 })),
    };
    offset += h;
    return out;
  });
  return { width, direction, chapters, height: total };
}

/** FlatList's getItemLayout over the layout's items. */
export function itemLayoutOf(layout: MapLayout) {
  return (_: unknown, index: number) => {
    const item = layout.chapters[index]!;
    return { length: item.height, offset: item.offset, index };
  };
}

/** The list index of a chapter. */
export const indexOfChapter = (layout: MapLayout, chapter: number): number =>
  layout.chapters.findIndex((c) => c.chapter === chapter);

/**
 * Where the map opens (scrollToOffset): the node of stage `n` at MAP.openAt (40 %) of a viewport `viewport`
 * high, never before the top or past the end.
 */
export function openOffset(layout: MapLayout, n: number, viewport: number, rules = LEVEL_RULES): number {
  const chapter = layout.chapters.find((c) => c.chapter === chapterOf(n, rules));
  const node = chapter?.nodes.find((p) => p.n === n);
  if (!chapter || !node) return 0;
  const at = chapter.offset + node.cy - viewport * MAP.openAt;
  return Math.max(0, Math.min(at, Math.max(0, layout.height - viewport)));
}

// ---------------------------------------------------------------------------------------------------------
// States, from the progress

export type NodeState = 'played' | 'current' | 'open' | 'locked';

export interface NodeInfo {
  n: number;
  id: string;
  state: NodeState;
  /** The best stars (0 for a stage never played). */
  stars: Stars;
  boss: boolean;
}

/**
 * The stage to go on with (the map's current node, the panel's "המשך"): the first open stage never played, else
 * the last open one. The same rule as levels.db's summary.
 */
export function currentLevel(
  records: LevelRecords,
  openedChapters: readonly number[] = [],
  rules = LEVEL_RULES,
): number {
  let lastOpen = 1;
  for (let n = 1; n <= maxLevel(rules); n++) {
    if (!isLevelOpen(n, records, openedChapters, rules)) break;
    lastOpen = n;
    if ((records[levelIdOf(n)]?.plays ?? 0) === 0) return n;
  }
  return lastOpen;
}

/** A node's state: played, the current one, open (not played, not current), or locked. */
export function nodeInfo(
  n: number,
  records: LevelRecords,
  openedChapters: readonly number[],
  current: number,
  rules = LEVEL_RULES,
): NodeInfo {
  const id = levelIdOf(n);
  const record = records[id];
  const stars = record?.stars ?? 0;
  const boss = isBossLevel(n, rules);
  if (n === current) return { n, id, state: 'current', stars, boss };
  if ((record?.plays ?? 0) > 0) return { n, id, state: 'played', stars, boss };
  const open = isLevelOpen(n, records, openedChapters, rules);
  return { n, id, state: open ? 'open' : 'locked', stars, boss };
}

/**
 * "פתח את כל השלבים (בדיקה)" (a staging build's switch, config/testing.ts): every chapter as if its gate had
 * opened, so every gate is open and "לשלב הבא" goes on past it. With unlockedNode, every stage is open on the map.
 */
export const everyChapter = (rules = LEVEL_RULES): number[] =>
  Array.from({ length: Math.max(0, rules.chapterCount - 1) }, (_, i) => i + 2);

/** A node as the map draws it with every stage open (the testing switch): a locked one is open. */
export const unlockedNode = (info: NodeInfo): NodeInfo =>
  info.state === 'locked' ? { ...info, state: 'open' } : info;

/** The gate in front of `chapter` (2 and up): the previous chapter's, as gateState reads it. */
export const gateBefore = (
  chapter: number,
  records: LevelRecords,
  openedChapters: readonly number[] = [],
  rules = LEVEL_RULES,
): GateState => gateState(chapter - 1, records, openedChapters, rules);

/**
 * How a gate's plate reads (components.md §19.3): closed ("נפתח ב־20 כוכבים", "17/20"), enough stars but the
 * boss not played ("22/20", "שחק את שלב הבוס כדי לפתוח"), or open ("פרק 5 פתוח").
 */
export type PlateState = 'closed' | 'bossMissing' | 'open';

export function plateState(gate: GateState): PlateState {
  if (gate.open) return 'open';
  return gate.stars >= gate.need && !gate.bossPlayed ? 'bossMissing' : 'closed';
}

/** Every stage's best stars, summed ("★ 84/900"), and the most there are. */
export function totalStars(records: LevelRecords, rules = LEVEL_RULES): { stars: number; max: number } {
  let stars = 0;
  for (let n = 1; n <= maxLevel(rules); n++) stars += records[levelIdOf(n)]?.stars ?? 0;
  return { stars, max: maxLevel(rules) * 3 };
}

/** A chapter's best stars ("★ 18/30"), and the most it has. */
export const chapterTotal = (chapter: number, records: LevelRecords, rules = LEVEL_RULES) => ({
  stars: chapterStars(chapter, records, rules),
  max: rules.chapterSize * 3,
});

// ---------------------------------------------------------------------------------------------------------
// After an attempt

/**
 * The records as they stand after an attempt that ended with `outcome` (the result's "לשלב הבא" and its chapter
 * line): the best stars never lower, and one more play when the end counts (countsAsPlayed, which reads
 * LEVEL_RULES.quitCountsAsPlayed). levels.db does the same when it stores the attempt; this only spares the
 * result from waiting for the store to read it back.
 */
export function withAttempt(
  records: LevelRecords,
  levelId: string,
  outcome: Pick<LevelOutcome, 'reason' | 'stars'>,
  rules = LEVEL_RULES,
): LevelRecords {
  const prev = records[levelId];
  const plays = (prev?.plays ?? 0) + (countsAsPlayed(outcome.reason, rules) ? 1 : 0);
  const stars = Math.max(prev?.stars ?? 0, outcome.stars) as Stars;
  return { ...records, [levelId]: { ...prev, stars, plays } };
}

/** "לשלב הבא" after an attempt: the next stage when it is open now, else null (a closed gate, the last stage). */
export function nextAfterAttempt(
  levelId: string,
  records: LevelRecords,
  openedChapters: readonly number[],
  outcome: Pick<LevelOutcome, 'reason' | 'stars'>,
  rules = LEVEL_RULES,
): string | null {
  return nextLevelId(levelId, withAttempt(records, levelId, outcome, rules), openedChapters, rules);
}
