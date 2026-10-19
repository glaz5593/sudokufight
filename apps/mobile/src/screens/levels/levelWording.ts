import {
  type AppLevel,
  botLevel,
  type BotLevelId,
  LEVEL_METRIC,
  type LevelKind,
  type LevelOutcome,
  type StarRule,
  type Stars,
} from '@sudoku-fight/engine';
import type { TFunction } from 'i18next';

import { formatScore, ltr } from '../../components/player/format';
import { secondsText } from '../home/homeModel';

/**
 * What a stage says about itself (components.md §19; plan §2, §3, §6), in the 'levels' namespace. Pure: a stage
 * and a t() bound to 'levels' in, words out, so the map, its panel, "מוכן?", the result and the gate sheet say
 * the same thing, and the tests read the very same words. No rule lives here: the numbers come from the stage's
 * data (its star rule, its time limit, its targets) and the engine's reading of an end (levelOutcome).
 *
 * Times, scores and "18/30" are Latin and LTR inside Hebrew (ltr()); a range ("4–5") is an LTR isolate, or its
 * dash would turn it around in a right-to-left line.
 */

export type LevelsT = TFunction<'levels'>;

/** The bot of a stage against one: its name, from the engine's level table (the same in every language). */
export const botNameOf = (level: Pick<AppLevel, 'bot'>): string | null =>
  level.bot ? botLevel(level.bot.level as BotLevelId).name : null;

/** The kind's name as a title says it: "איפה ה־7?", "מרוץ מול הבוט", "דו־קרב ל־30". */
export function kindName(level: Pick<AppLevel, 'kind' | 'targets'>, t: LevelsT): string {
  return t(`kinds.${level.kind}.name`, kindParams(level));
}

/** The kind as a label says it, without a question mark: "איפה ה־7". */
export function kindLabel(level: Pick<AppLevel, 'kind' | 'targets'>, t: LevelsT): string {
  return t(`kinds.${level.kind}.label`, kindParams(level));
}

function kindParams(level: Pick<AppLevel, 'kind' | 'targets'>): Record<string, string | number> {
  const l = level as AppLevel;
  if (l.kind === 'find') return { digit: l.targets.target.digit };
  if (l.kind === 'duel') return { target: l.targets.endAtScore };
  return {};
}

/** A chapter's name ("בלש"). */
export const chapterName = (chapter: number, t: LevelsT): string => t(`chapters.${chapter}.name`);

/** What is new in a chapter ("מצא את הטעות"). */
export const chapterNews = (chapter: number, t: LevelsT): string => t(`chapters.${chapter}.news`);

/** Whole seconds, or one decimal: "20", "7.6". */
const seconds = (ms: number): string => secondsText(ms);

/** The goal in one sentence (the panel, "מוכן?"): "מציאה אחת. השלב נגמר ב־20 ש׳." */
export function goalText(level: AppLevel, t: LevelsT): string {
  const s = seconds(level.timeLimitMs);
  const bot = botNameOf(level) ?? '';
  switch (level.kind) {
    case 'find':
      return t('goals.find', { s });
    case 'findDuel':
      return t('goals.findDuel', { s, bot, spots: level.targets.spots.length });
    case 'fillBox':
      return t('goals.fillBox', { s, cells: level.targets.cells.length, box: level.targets.box + 1 });
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
