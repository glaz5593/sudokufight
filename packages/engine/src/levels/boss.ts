import { botLevel } from '../bot/levels';
import { BOSS, chapterBot, fillPlan } from './levels.config';
import { type AppLevel, fillRegionOf, isFillKind } from './spec';

/**
 * The boss (levels-content.md §6) [D72]: the tenth level of every chapter, one fight against a named bot. This
 * file is the one contract the screens build on for what is really harder about a boss than the chapter's
 * other levels; the words are the screen's (t()), the facts are here.
 *
 * Not a trait: a "harder board". The boss's board is the same tier as slots 7–9 (spec §5.3.3), so it is no real
 * difference and is never shown as one.
 */

export type BossTrait =
  /** Chapter 1: the first bot you meet. */
  | { key: 'firstBot'; bot: string }
  /** From chapter 2: the chapter's bot, `pct` per cent faster (from BOSS.pace: 10). */
  | { key: 'faster'; bot: string; pct: number }
  /** Chapters 28–30 (L280, L290, L300). */
  | { key: 'overlord' }
  /** Only under D72 ב (chapter 1's boss stays a fillBox): more missing cells than the chapter's. */
  | { key: 'moreCells'; from: number; to: number };

export type BossTraitKey = BossTrait['key'];

/** How much faster a boss's bot is than its chapter's, in per cent (BOSS.pace 0.9: 10). */
export const bossFasterPct = (): number => Math.round((1 - BOSS.pace) * 100);

/**
 * What a boss has that the chapter's other levels do not: [] when the level is not a boss; never more than 2.
 * Pure: from the level and the chapter table.
 * - A boss against a bot in a chapter with no bot of its own (chapter 1): `firstBot`, the bot's name.
 * - Overlord (BOSS.overlordFrom on): `overlord`. It is not the chapter's bot, so it is not "faster" than it.
 * - Any other boss against a bot: `faster`, the chapter's bot BOSS.pace faster.
 * - A boss with no bot (D72 ב: chapter 1's fillBox): `moreCells`, when its region misses more cells than the
 *   chapter's own fill levels.
 */
export function bossTraits(level: AppLevel): readonly BossTrait[] {
  if (!level.boss) return [];
  if (level.bot) {
    if (level.chapter >= BOSS.overlordFrom) return [{ key: 'overlord' }];
    const bot = botLevel(level.bot.level).name;
    if (chapterBot(level.chapter) === null) return [{ key: 'firstBot', bot }];
    return [{ key: 'faster', bot, pct: bossFasterPct() }];
  }
  if (isFillKind(level.kind)) {
    const from = fillPlan(level.chapter, 'base').missing;
    const to = fillRegionOf(level)!.cells.length;
    if (to > from) return [{ key: 'moreCells', from, to }];
  }
  return [];
}
