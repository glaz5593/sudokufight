import enHome from '../locales/en/home.json';
import enLevels from '../locales/en/levels.json';

/**
 * Staged practice in English says "Stage" and "Staged practice", never "Level" (dev-plan §1.4, components.md §19):
 * on the same screens "Level" already means a bot's level and my XP level. Every English string of the 'levels'
 * namespace, and of the new-game row (home modes.levels), is read; the only keys that may say it are those that
 * name a bot's level or an XP level.
 */

type Tree = { [key: string]: string | Tree };

function entries(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${prefix}${k}`, v] as [string, string]] : entries(v, `${prefix}${k}.`),
  );
}

/** Keys that name a bot's level ("Pip · Level 1 · Novice") or an XP level, and may say "Level". */
const ALLOWED = new Set(['levels:panel.bot']);

const LEVEL_WORD = /\blevels?\b/i;

const strings = [
  ...entries(enLevels as Tree).map(([k, v]) => [`levels:${k}`, v] as const),
  ...entries((enHome as unknown as { modes: { levels: Tree } }).modes.levels).map(
    ([k, v]) => [`home:modes.levels.${k}`, v] as const,
  ),
];

describe('English says "Stage", not "Level", for a stage', () => {
  it('reads every string of the stages', () => {
    expect(strings.length).toBeGreaterThan(150);
    expect(strings.some(([k]) => k === 'home:modes.levels.tagline')).toBe(true);
  });

  it('no string says "level" or "levels", but a bot’s level', () => {
    // A nested plural, $t(levels:hud.secondsAdded, …), names its namespace; the nested key's own words are read.
    const shown = (v: string) => v.replace(/\$t\([^)]*\)/g, '');
    const offending = strings
      .filter(([k, v]) => LEVEL_WORD.test(shown(v)) && !ALLOWED.has(k))
      .map(([k, v]) => `${k}: ${v}`);
    expect(offending).toEqual([]);
  });

  it('the allowed keys still exist, and still name a level', () => {
    for (const key of ALLOWED) {
      const found = strings.find(([k]) => k === key);
      expect({ key, says: found?.[1] }).toEqual({ key, says: expect.stringMatching(LEVEL_WORD) });
    }
  });

  it('the row’s English: "Staged practice", "Short stages · up to 3 stars"', () => {
    expect(enHome.modes.levels.title).toBe('Staged practice');
    expect(enHome.modes.levels.tagline).toBe('Short stages · up to 3 stars');
    expect(enLevels.stage).toBe('Stage {{n}}');
  });

  it('would catch one', () => {
    expect(LEVEL_WORD.test('Level 14 · 29 stars')).toBe(true);
    expect(LEVEL_WORD.test('All levels')).toBe(true);
    expect(LEVEL_WORD.test('Staged practice')).toBe(false);
    expect(LEVEL_WORD.test('Leveled')).toBe(false);
  });
});
