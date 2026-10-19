import { type AppLevel, isLevelKind, levelNumber } from '@sudoku-fight/engine';

/**
 * The levels that ship inside the app (1.0.2; plan §5.3, §5.6): data/levels.json, built by the engine's level
 * builder and copied here (`npm run levels -w @sudoku-fight/mobile`). It is frozen: the app only reads it. It
 * is read on first use (the map, a level's start), never at the app's start (spec §22: open in under 2 s;
 * startupGraph.test.ts), and never by the progress code: the "משחק חדש" row and my card come from levels.db.
 */

interface Loaded {
  all: readonly AppLevel[];
  byId: ReadonlyMap<string, AppLevel>;
  byChapter: ReadonlyMap<number, readonly AppLevel[]>;
}

let loaded: Loaded | null = null;

const isStr81 = (v: unknown): boolean => typeof v === 'string' && v.length === 81 && /^[0-9]+$/.test(v);

/** What is wrong with an entry, or null: the fields the screens and the hosts rely on. */
export function levelShapeProblem(v: unknown): string | null {
  if (typeof v !== 'object' || v === null) return 'not an object';
  const l = v as Partial<AppLevel> & Record<string, unknown>;
  if (typeof l.id !== 'string' || levelNumber(l.id) === null) return `id ${String(l.id)}`;
  if (!isLevelKind(l.kind)) return `${l.id}: kind ${String(l.kind)}`;
  if (!Number.isInteger(l.rev) || (l.rev ?? 0) < 1) return `${l.id}: rev`;
  if (!Number.isInteger(l.chapter) || !Number.isInteger(l.slot)) return `${l.id}: chapter or slot`;
  if (typeof l.boss !== 'boolean') return `${l.id}: boss`;
  if (!l.board || !isStr81(l.board.grid) || !isStr81(l.board.solution)) return `${l.id}: board`;
  if (!(typeof l.timeLimitMs === 'number' && l.timeLimitMs > 0)) return `${l.id}: timeLimitMs`;
  if (typeof l.stars !== 'object' || l.stars === null || typeof l.stars.by !== 'string')
    return `${l.id}: stars`;
  if (typeof l.targets !== 'object' || l.targets === null) return `${l.id}: targets`;
  return null;
}

/**
 * The file and its indexes, read once. Metro still bundles it (the require is static); the shape is checked
 * once, and a broken file fails loudly (it is a build's mistake: levels:validate checks every level).
 */
function data(): Loaded {
  if (loaded) return loaded;
  const raw = require('./data/levels.json') as unknown;
  if (!Array.isArray(raw)) throw new Error('levels.json: not a list of levels');
  const problems = raw.map(levelShapeProblem).filter((p): p is string => p !== null);
  if (problems.length > 0) throw new Error(`levels.json: ${problems.slice(0, 5).join('; ')}`);
  const all = [...(raw as AppLevel[])].sort((a, b) => levelNumber(a.id)! - levelNumber(b.id)!);
  const byChapter = new Map<number, AppLevel[]>();
  for (const level of all) {
    const list = byChapter.get(level.chapter) ?? [];
    list.push(level);
    byChapter.set(level.chapter, list);
  }
  loaded = { all, byId: new Map(all.map((l) => [l.id, l])), byChapter };
  return loaded;
}

/** A level by its id ("L037"), as shipped (play it through attemptLevel). */
export const levelById = (id: string): AppLevel | undefined => data().byId.get(id);

/** A chapter's levels, in order. */
export const levelsOfChapter = (chapter: number): readonly AppLevel[] => data().byChapter.get(chapter) ?? [];

/** Every level, in order. */
export const allLevels = (): readonly AppLevel[] => data().all;

/** How many levels ship. */
export const levelCount = (): number => data().all.length;
