import { chapterLevelIds, levelNumber } from '../progress';
import type { LevelSpec } from '../spec';
import { buildLevel } from './build';
import { modelNumbers, PROFILE_IDS, PROFILES, TARGET_STARS } from './profiles';
import { chapterReport, simulateLevel } from './simulate';

/* The profile simulation (plan §4.4, dev-plan §2ד): deterministic, ordered, it warns and never fails. */

const chapter = (c: number): LevelSpec[] => chapterLevelIds(c).map((id) => buildLevel(levelNumber(id)!).spec);
const LONG = 60_000;

describe('the simulation', () => {
  const levels = [...chapter(3), ...chapter(7)];

  it(
    'is deterministic per seed',
    () => {
      const a = chapterReport(levels, { runs: 6 });
      expect(chapterReport(levels, { runs: 6 })).toEqual(a);
      expect(chapterReport(levels, { runs: 6, salt: 1 })).not.toEqual(a);
    },
    LONG,
  );

  it(
    'per chapter: excellent ≥ good ≥ casual',
    () => {
      const report = chapterReport(levels, { runs: 10 });
      for (const c of report.chapters) {
        expect(c.stars.excellent).toBeGreaterThanOrEqual(c.stars.good);
        expect(c.stars.good).toBeGreaterThanOrEqual(c.stars.casual);
      }
      expect(report.warnings.filter((w) => w.type === 'order')).toEqual([]);
    },
    LONG,
  );

  it(
    'a chapter off its target only warns',
    () => {
      const hopeless = Object.fromEntries(
        PROFILE_IDS.map((id) => [id, { ...PROFILES[id], findMs: { min: 60000, max: 60000 } }]),
      ) as unknown as typeof PROFILES;
      const report = chapterReport(chapter(1), { runs: 3, profiles: hopeless });
      expect(report.chapters[0]!.target).toEqual(TARGET_STARS[0]);
      expect(report.warnings.some((w) => w.type === 'offTarget' && w.chapter === 1)).toBe(true);
      expect(report.warnings.some((w) => w.type === 'tooHard')).toBe(true);
    },
    LONG,
  );

  it(
    'plays every kind: the chain, spot the error and the point hunter too',
    () => {
      for (const n of [34, 66, 85]) {
        const spec = buildLevel(n).spec;
        const casual = simulateLevel(spec, PROFILES.casual, 20);
        const excellent = simulateLevel(spec, PROFILES.excellent, 20);
        expect(casual.counts.reduce((a, b) => a + b)).toBe(20);
        expect(excellent.mean).toBeGreaterThanOrEqual(casual.mean);
      }
    },
    LONG,
  );

  it('the report lists every assumed number, none calibrated yet', () => {
    const numbers = modelNumbers();
    expect(numbers.every((n) => !n.calibrated)).toBe(true);
    expect(numbers.map((n) => n.name)).toEqual(
      expect.arrayContaining(['casual.findMs', 'good.fillBoxCellMs', 'excellent.duelMoveMs', 'search.tier']),
    );
    expect(chapterReport([], { runs: 1 }).assumptions).toEqual(numbers);
  });
});
