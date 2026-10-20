import type { AppLevel, AppLevelOf, LevelKind } from '@sudoku-fight/engine';

import { allLevels } from '../../levelsData';

/**
 * Tests pick a level by its kind (and chapter), never by a fixed id (1.0.3; levels-content.md §12, lane ו): a
 * rebuild of levels.json (a new rev, a new chapter table) may give an id another kind, and a test that read
 * "L012" as "the race against Pip" would then test something else. These read the app's own levels.json.
 */

export interface LevelPick {
  /** Only this chapter's levels. */
  chapter?: number;
  /** Bosses only (true), or no boss (false, the default): "the first race" is a regular one. */
  boss?: boolean;
}

/** The shipped levels of a kind, in order (no boss unless `boss` says so). */
export function levelsOf<K extends LevelKind>(kind: K, pick: LevelPick = {}): AppLevelOf<K>[] {
  const boss = pick.boss ?? false;
  return allLevels().filter(
    (l): l is AppLevelOf<K> =>
      l.kind === kind && l.boss === boss && (pick.chapter === undefined || l.chapter === pick.chapter),
  );
}

/** The first shipped level of a kind (in a chapter, when given): a regular one, unless `boss` asks for a boss. */
export function firstLevelOf<K extends LevelKind>(kind: K, chapter?: number | LevelPick): AppLevelOf<K> {
  const pick = typeof chapter === 'number' ? { chapter } : (chapter ?? {});
  const level = levelsOf(kind, pick)[0];
  if (!level) throw new Error(`No ${pick.boss ? 'boss' : 'level'} of kind ${kind} (${JSON.stringify(pick)})`);
  return level;
}

/** The first boss of a kind (in a chapter, when given). */
export const firstBossOf = <K extends LevelKind>(kind: K, chapter?: number): AppLevelOf<K> =>
  firstLevelOf(kind, { chapter, boss: true });

/** The shipped level of a chapter at a slot (1–10; 10 is the boss), whatever its kind. */
export function levelAt(chapter: number, slot: number): AppLevel {
  const level = allLevels().find((l) => l.chapter === chapter && l.slot === slot);
  if (!level) throw new Error(`No level at chapter ${chapter}, slot ${slot}`);
  return level;
}
