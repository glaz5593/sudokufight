import {
  type AppLevel,
  type BossTrait,
  botLevel,
  type BotLevelId,
  type FillRegion,
  LEVEL_METRIC,
  LEVEL_RULES,
  type LevelKind,
  type LevelOutcome,
  ROW_LETTERS,
  type StarRule,
  type Stars,
} from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';

import { formatScore, ltr } from '../../components/player/format';
import { secondsText } from '../home/homeModel';

/**
 * What a stage says about itself (components.md §19; plan §2, §3, §6; 1.0.3: levels-ui.md §6), in the 'levels'
 * namespace. Pure: a stage and a t() bound to 'levels' in, words out, so the map, its panel, "מוכן?", the result
 * and the gate sheet say the same thing, and the tests read the very same words. No rule lives here: the numbers
 * come from the stage's data (its star rule, its time limit, its targets), the engine's reading of an end
 * (levelOutcome) and the engine's facts (bossTraits, fillRegionOf, the puzzle's view).
 *
 * [D79] `find` is "מיקום מדויק" / "Pinpoint" wherever a stage is spoken of from outside (the map, its panel,
 * "מוכן?", "איך משחקים", the gate sheet, the result, a screen reader's labels), with no digit: "איפה ה־6?" is
 * said only inside the stage and "מוכן?", from the digit of the board being played (findPrompt, findSub), so
 * "שוב" with its digits relabelled [D63] never says a digit that is not on the board.
 *
 * The goals of the map's panel and the result name no region ("בריבוע אחד", "בשורה אחת"): "שוב" moves the
 * rows, columns and boxes, and only the stage screen knows the board played (fillTaskText, fillBoardLabel,
 * regionName, from fillRegionOf of the attempt's level).
 *
 * Times, scores and "18/30" are Latin and LTR inside Hebrew (ltr()); a range ("4–5") is an LTR isolate, or its
 * dash would turn it around in a right-to-left line.
 */

export type LevelsT = TFunction<'levels'>;

/** The bot of a stage against one: its name, from the engine's level table (the same in every language). */
export const botNameOf = (level: Pick<AppLevel, 'bot'>): string | null =>
  level.bot ? botLevel(level.bot.level as BotLevelId).name : null;

/** The kind's name as a title says it: "מיקום מדויק", "מרוץ מול הבוט", "דו־קרב ל־30". */
export function kindName(level: Pick<AppLevel, 'kind' | 'targets'>, t: LevelsT): string {
  return t(`kinds.${level.kind}.name`, kindParams(level));
}

/** The kind as a label says it, without a question mark: "מיקום מדויק", "דו־קרב ל־30". */
export function kindLabel(level: Pick<AppLevel, 'kind' | 'targets'>, t: LevelsT): string {
  return t(`kinds.${level.kind}.label`, kindParams(level));
}

/** [D79] find's name takes no digit: only the duel's name has a number (its target). */
function kindParams(level: Pick<AppLevel, 'kind' | 'targets'>): Record<string, string | number> {
  const l = level as AppLevel;
  if (l.kind === 'duel') return { target: l.targets.endAtScore };
  return {};
}

/**
 * [D79] "איפה ה־6?": find's question, in the stage and in "מוכן?" only, with the digit of the board being
 * played (GameView's level.find.digit, or the attempt's level), never the stored stage's.
 */
export const findPrompt = (digit: number, t: LevelsT): string => t('ready.findPrompt', { digit });

/** find's header line in the stage: "איפה ה־6? · פרק 1" (every other kind keeps hud.sub, "פאזל · פרק 3"). */
export const findSub = (digit: number, chapter: number, t: LevelsT): string =>
  t('hud.subFind', { digit, chapter });

/** "מוכן?" of a race: "5 מקומות, מרוץ מול Pip": no spot and no digit, no head start on the bot [D76]. */
export const raceSpotsText = (count: number, bot: string, t: LevelsT): string =>
  t('ready.raceSpots', { count, bot });

// ---------------------------------------------------------------------------------------------------------
// A region (a fill stage's box, row or column; a find target's scope), as the stage played says it

/** A region by unit and index: the box (0–8), the row (0–8, A–I) or the column (0–8, 1–9). */
export type RegionRef = Pick<FillRegion, 'unit' | 'index'>;

const rowLetter = (index: number): string => ROW_LETTERS[index] ?? '';

/** "ריבוע 5", "שורה D", "עמודה 5" ("מוכן?"'s caption under the small map, the map's label). */
export function regionName(region: RegionRef, t: LevelsT): string {
  switch (region.unit) {
    case 'box':
      return t('region.box', { n: region.index + 1 });
    case 'row':
      return t('region.row', { row: rowLetter(region.index) });
    case 'col':
      return t('region.col', { n: region.index + 1 });
  }
}

/** The small map's label for a screen reader: "מפת הלוח: שורה D". */
export const regionMapLabel = (region: RegionRef, t: LevelsT): string =>
  t('region.mapLabel', { region: regionName(region, t) });

/** A fill stage's task in its header: "מלא את ריבוע 5", "מלא את שורה D", "מלא את עמודה 5". */
export function fillTaskText(region: RegionRef, t: LevelsT): string {
  switch (region.unit) {
    case 'box':
      return t('hud.box.task', { n: region.index + 1 });
    case 'row':
      return t('hud.line.taskRow', { row: rowLetter(region.index) });
    case 'col':
      return t('hud.line.taskCol', { n: region.index + 1 });
  }
}

/** A fill stage's board label: "הלוח · ממלאים רק את 4 המשבצות החסרות בשורה D". */
export function fillBoardLabel(region: FillRegion, t: LevelsT): string {
  const count = region.cells.length;
  switch (region.unit) {
    case 'box':
      return t('hud.box.boardLabel', { n: region.index + 1, count });
    case 'row':
      return t('hud.line.boardLabelRow', { row: rowLetter(region.index), count });
    case 'col':
      return t('hud.line.boardLabelCol', { n: region.index + 1, count });
  }
}

// ---------------------------------------------------------------------------------------------------------
// The puzzle

/**
 * "3 ריבועים זזים · 6 ריבועים קבועים" ("מוכן?", the puzzle's header), or "כל הריבועים זזים". `moving` and
 * `fixed` from the engine: the view's `moving` and its 'fixed' slots, or a level's targets before the view.
 */
export function puzzleCountsText(moving: number, fixed: number, t: LevelsT): string {
  if (fixed === 0) return t('hud.puzzle.allMove');
  return t('hud.puzzle.counts', {
    moving: t('hud.puzzle.moving', { count: moving }),
    fixed: t('hud.puzzle.fixed', { count: fixed }),
  });
}

/** The puzzle board's label for a screen reader: "לוח הפאזל · 3 ריבועים זזים · 6 ריבועים קבועים". */
export const puzzleBoardLabel = (moving: number, fixed: number, t: LevelsT): string =>
  t('hud.puzzle.boardLabel', { counts: puzzleCountsText(moving, fixed, t) });

/** A puzzle level's counts before it is played: the boxes fixed at home, and the rest. */
export function puzzleCountsOf(level: AppLevel): { moving: number; fixed: number } | null {
  if (level.kind !== 'puzzle') return null;
  const fixed = level.targets.fixed.length;
  return { moving: level.targets.start.length - fixed, fixed };
}

/** A puzzle slot's state for a screen reader: "אפשר להזיז", "קבוע", "נבחר". */
export type PuzzleSlotWording = 'movable' | 'fixed' | 'selected';

/**
 * A puzzle slot as a screen reader says it: "ריבוע 4, אפשר להזיז: 5 3 9, 6 1 2, 8 7 4". `place` 0–8 (said
 * 1–9); `digits` its nine digits row by row, left to right (the board is always LTR).
 */
export function puzzleSlotLabel(
  place: number,
  state: PuzzleSlotWording,
  digits: readonly number[],
  t: LevelsT,
): string {
  const rows = [0, 3, 6].map((r) => digits.slice(r, r + 3).join(' ')).join(', ');
  return t('hud.puzzle.slotLabel', { n: place + 1, state: t(`hud.puzzle.state.${state}`), rows });
}

/** The live region after a swap: "ריבוע 4 וריבוע 7 התחלפו", with ". עוד 5 שניות" when it was a wrong one. */
export function puzzleSwapAnnouncement(from: number, to: number, penaltyMs: number, t: LevelsT): string {
  const values = { a: from + 1, b: to + 1 };
  return penaltyMs > 0
    ? t('hud.puzzle.swappedPenalty', { ...values, s: secondsText(penaltyMs) })
    : t('hud.puzzle.swapped', values);
}

/** The result's swaps: "4 החלפות · המינימום 3". */
export const puzzleSwapsText = (swaps: number, minSwaps: number, t: LevelsT): string =>
  t('result.swaps', { count: swaps, min: minSwaps });

// ---------------------------------------------------------------------------------------------------------
// The boss

/**
 * A boss's "what's harder" chip (levels-ui.md §3.2), only from the engine's bossTraits(level): "הבוט הראשון:
 * Pip", "Pip מהיר ב־10%" (the per cent an LTR isolate), "Overlord", "5 משבצות חסרות במקום 4".
 */
export function bossTraitText(trait: BossTrait, t: LevelsT): string {
  switch (trait.key) {
    case 'firstBot':
      return t('boss.traits.firstBot', { bot: trait.bot });
    case 'faster':
      return t('boss.traits.faster', { bot: trait.bot, percent: ltr(`${trait.pct}%`) });
    case 'overlord':
      return t('boss.traits.overlord');
    case 'moreCells':
      return t('boss.traits.moreCells', { cells: trait.to, usual: trait.from });
  }
}

/** The result's boss line, from the engine's levelOutcome().bossBeaten: "ניצחת את הבוס!" / "הבוס ניצח הפעם". */
export function bossResultText(bossBeaten: boolean | null | undefined, t: LevelsT): string | null {
  if (bossBeaten === true) return t('boss.result.won');
  if (bossBeaten === false) return t('boss.result.lost');
  return null;
}

/**
 * The boss result's chapter line: "השער לפרק 2: ★ 22/20 · נפתח!", or "השער לפרק 2: ★ 18/20" while it is
 * shut (`chapter`: the boss's chapter; the gate opens the next one). The count is an LTR isolate.
 */
export function bossGateText(
  chapter: number,
  stars: number,
  need: number,
  open: boolean,
  t: LevelsT,
): string {
  const count = ltr(`★ ${stars}/${need}`);
  return t(open ? 'boss.result.gateOpen' : 'boss.result.gateClosed', { n: chapter + 1, stars: count });
}

/** The boss band over a boss's stage: "בוס · פרק 3". */
export const bossBandText = (chapter: number, t: LevelsT): string => t('boss.band', { chapter });

/** A chapter's name ("בלש"). */
export const chapterName = (chapter: number, t: LevelsT): string => t(`chapters.${chapter}.name`);

/** What is new in a chapter ("מצא את הטעות"). */
export const chapterNews = (chapter: number, t: LevelsT): string => t(`chapters.${chapter}.news`);

/** Whole seconds, or one decimal: "20", "7.6". */
const seconds = (ms: number): string => secondsText(ms);

/**
 * The goal in one sentence (the panel, "מוכן?", the result): "מצא את המקום המדויק של ספרה אחת. השלב נגמר
 * ב־20 ש׳." A fill stage's goal names no box, row or column: "שוב" moves them (levels-ui.md §5).
 */
export function goalText(level: AppLevel, t: LevelsT): string {
  const s = seconds(level.timeLimitMs);
  const bot = botNameOf(level) ?? '';
  switch (level.kind) {
    case 'find':
      return t('goals.find', { s });
    case 'findDuel':
      return t('goals.findDuel', { s, bot, spots: level.targets.spots.length });
    case 'fillBox':
    case 'fillRow':
    case 'fillCol':
      return t(`goals.${level.kind}`, { s, cells: level.targets.cells.length });
    case 'puzzle':
      return t('goals.puzzle', { s, penalty: seconds(LEVEL_RULES.puzzleSwapPenaltyMs) });
    case 'duel':
      return t('goals.duel', { s, bot, target: level.targets.endAtScore });
    case 'spotError':
      return t('goals.spotError', { s, count: level.targets.errors.length });
    case 'pointHunter':
      return t('goals.pointHunter', { s, moves: level.targets.maxMoves });
    case 'chain':
      return t('goals.chain', { s, steps: level.targets.cells.length });
  }
}

export interface ScaleRow {
  stars: 1 | 2 | 3;
  /** "עד 5 ש׳", "3 מקומות", "פער 15 ומעלה", "מוביל בסוף". */
  text: string;
  /** "3 כוכבים: עד 5 ש׳". */
  label: string;
}

/**
 * The star scale, ★★★ first (the panel's three cells, "מוכן?"): what each number of stars takes. `total` is the
 * spots there are in a race (its ★★★ reads "4–5 מקומות").
 */
export function scaleRows(rule: StarRule, t: LevelsT, total?: number): ScaleRow[] {
  const text = (stars: 1 | 2 | 3): string => {
    const threshold = stars === 3 ? rule.three : stars === 2 ? rule.two : 'one' in rule ? rule.one : 0;
    switch (rule.by) {
      case 'timeMs':
        return t('scale.time', { s: seconds(threshold) });
      case 'spots':
        return stars === 3 && total !== undefined && total > threshold
          ? t('scale.spotsRange', { range: ltr(`${threshold}–${total}`) })
          : t('scale.spots', { count: threshold });
      case 'gap':
        return stars === 1 ? t('scale.lead') : t('scale.gap', { gap: formatScore(threshold) });
      case 'points':
        return t('scale.points', { points: formatScore(threshold) });
    }
  };
  return ([3, 2, 1] as const).map((stars) => {
    const words = text(stars);
    return { stars, text: words, label: t('scale.row', { stars: starCount(stars, t), text: words }) };
  });
}

/** The scale on one line, for a screen reader: "3 כוכבים: עד 5 ש׳ · 2 כוכבים: עד 10 ש׳ · כוכב אחד: עד 20 ש׳". */
export function scaleLine(rule: StarRule, t: LevelsT, total?: number): string {
  const [three, two, one] = scaleRows(rule, t, total).map((r) => r.label);
  return t('scale.line', { three, two, one });
}

/** "שני כוכבים מתוך שלושה" (a node, a gate row). */
export const starsOf3 = (stars: Stars, t: LevelsT): string => t(`stars.of3.${stars}`);

/** "כוכב אחד", "3 כוכבים". */
export const starCount = (count: number, t: LevelsT): string => t('stars.count', { count });

/** The spots of a race, or of a stage's targets: 5. */
export function spotsOf(level: AppLevel): number | undefined {
  return level.kind === 'findDuel' ? level.targets.spots.length : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// A measure, as the result and "השיא שלי" show it

/** A measure in parts: what comes before the big number, the number (Latin, LTR), and what comes after. */
export interface MetricParts {
  before: string | null;
  value: string;
  after: string | null;
  /** The whole of it on one line, for a label. */
  text: string;
}

/**
 * How a stage's measure reads (LEVEL_METRIC): the level clock "7.6 ש׳", "4 מתוך 5 מקומות", "פער 17",
 * "21.5 נקודות", "נמצאו 1 מתוך 2". `value` in the measure's unit (ms for a time).
 */
export function metricParts(
  level: AppLevel,
  measure: LevelKindMeasure,
  value: number,
  t: LevelsT,
): MetricParts {
  const join = (parts: (string | null)[]) => parts.filter(Boolean).join(' ');
  const out = (before: string | null, number: string, after: string | null): MetricParts => ({
    before,
    value: number,
    after,
    text: join([before, ltr(number), after]),
  });
  switch (measure) {
    case 'timeMs':
      return out(null, seconds(value), t('units.seconds'));
    case 'spots':
      return out(null, String(value), t('result.metric.spotsOf', { total: spotsOf(level) ?? 5 }));
    case 'gap':
      return out(t('result.metric.gap'), formatScore(value), null);
    case 'points':
      return out(null, formatScore(value), t('result.metric.points'));
    case 'found': {
      const total = level.kind === 'spotError' ? level.targets.errors.length : value;
      return out(t('result.metric.found'), String(value), t('result.metric.foundOf', { total }));
    }
  }
}

export type LevelKindMeasure = (typeof LEVEL_METRIC)[LevelKind];

/**
 * What the result shows big: the level clock when the stars go by time (and in spot the error once every error
 * was found), else the stage's own measure. The measure of an end that has none (a quit, a failure) is the
 * clock, or 0.
 */
export function headline(
  level: AppLevel,
  outcome: LevelOutcome,
): { measure: LevelKindMeasure; value: number } {
  const measure = LEVEL_METRIC[level.kind];
  if (measure === 'timeMs' || (level.kind === 'spotError' && outcome.reason === 'completed'))
    return { measure: 'timeMs', value: outcome.elapsedMs };
  return { measure, value: outcome.metric ?? 0 };
}

/** "השיא שלי" in the panel: the stored best measure, in the stage's unit. */
export function bestText(level: AppLevel, metric: number, t: LevelsT): string {
  return metricParts(level, LEVEL_METRIC[level.kind], metric, t).text;
}
