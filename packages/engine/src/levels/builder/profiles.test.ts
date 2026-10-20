import { FILL_ROWS, levelsOfKind, PUZZLE_ROWS } from '../levels.config';
import { chapterLevelIds, levelNumber } from '../progress';
import type { LevelKind, LevelSpec } from '../spec';
import { buildLevel } from './build';
import {
  FILL_MODEL,
  fillMixMs,
  fillMixOf,
  modelNumbers,
  PROFILE_IDS,
  PROFILES,
  PUZZLE_MODEL,
  puzzleModelMs,
  TARGET_STARS,
} from './profiles';
import { BLIND_SWAPPER } from './puzzle';
import { chapterReport, simulateLevel } from './simulate';

/* The profile simulation (plan §4.4, dev-plan §2ד): deterministic, ordered, it warns and never fails. */

const chapter = (c: number): LevelSpec[] => chapterLevelIds(c).map((id) => buildLevel(levelNumber(id)!).spec);
const firstOf = (kind: LevelKind, c?: number): LevelSpec =>
  buildLevel(levelsOfKind(kind, c === undefined ? {} : { chapter: c })[0]!).spec;
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
        PROFILE_IDS.map((id) => [id, { ...PROFILES[id], findMs: { min: 60000, max: 60000 }, modelPace: 10 }]),
      ) as unknown as typeof PROFILES;
      const report = chapterReport(chapter(1), { runs: 3, profiles: hopeless });
      expect(report.chapters[0]!.target).toEqual(TARGET_STARS[0]);
      expect(report.warnings.some((w) => w.type === 'offTarget' && w.chapter === 1)).toBe(true);
      expect(report.warnings.some((w) => w.type === 'tooHard')).toBe(true);
    },
    LONG,
  );

  it(
    'plays every kind: the chain, spot the error, the point hunter, the row, the column and the puzzle too',
    () => {
      const kinds: LevelKind[] = ['spotError', 'pointHunter', 'chain', 'fillRow', 'fillCol', 'puzzle'];
      for (const kind of kinds) {
        const spec = firstOf(kind);
        const casual = simulateLevel(spec, PROFILES.casual, 20);
        const excellent = simulateLevel(spec, PROFILES.excellent, 20);
        expect([kind, casual.counts.reduce((a, b) => a + b)]).toEqual([kind, 20]);
        expect([kind, excellent.mean >= casual.mean]).toEqual([kind, true]);
      }
    },
    LONG,
  );

  it(
    'the fill kinds and the puzzle are a Monte Carlo of the model: deterministic, and the excellent player almost always gets ★★★ on chapter 1',
    () => {
      for (const spec of [firstOf('fillBox', 1), firstOf('fillRow', 1), firstOf('puzzle', 1)]) {
        expect(simulateLevel(spec, PROFILES.good, 30)).toEqual(simulateLevel(spec, PROFILES.good, 30));
        // A rare wrong digit or swap (2%) costs 5 s: past ★★★ now and then.
        expect([spec.id, simulateLevel(spec, PROFILES.excellent, 30).counts[3] >= 27]).toEqual([
          spec.id,
          true,
        ]);
      }
    },
    LONG,
  );

  it(
    'reports the blind swapper on every puzzle, held to it from 4 moving boxes',
    () => {
      const puzzles = [firstOf('puzzle', 1), firstOf('puzzle', 4)];
      const report = chapterReport(puzzles, { runs: 2 });
      expect(report.blind.map((b) => [b.id, b.moving, b.checked])).toEqual([
        [puzzles[0]!.id, 3, false],
        [puzzles[1]!.id, 4, true],
      ]);
      expect(report.blind[1]!.threeShare).toBeLessThan(BLIND_SWAPPER.maxThreeShare);
      expect(report.warnings.filter((w) => w.type === 'blindSwapper')).toEqual([]);
    },
    LONG,
  );

  it('the report lists every assumed number, none calibrated yet (D74)', () => {
    const numbers = modelNumbers();
    expect(numbers.every((n) => !n.calibrated)).toBe(true);
    expect(numbers.map((n) => n.name)).toEqual(
      expect.arrayContaining([
        'casual.findMs',
        'good.modelPace',
        'excellent.duelMoveMs',
        'search.tier',
        'fill.thinkMs',
        'puzzle.boxMs',
        'model.spread',
      ]),
    );
    expect(chapterReport([], { runs: 1 }).assumptions).toEqual(numbers);
  });
});

describe('the time model (levels-content.md §4.4, §5.3): assumptions, D74', () => {
  it('casual ×1.6, good ×1, excellent ×0.65 of the model', () => {
    expect(PROFILE_IDS.map((id) => PROFILES[id].modelPace)).toEqual([1.6, 1, 0.65]);
  });

  it('the fill model’s numbers', () => {
    expect(FILL_MODEL).toEqual({
      orientMs: 2000,
      typeMs: 1000,
      thinkMs: { fullBoard: 2000, single: 3000, hiddenSingle: 4500, locked: 9000, pair: 12000, last: 500 },
    });
  });

  it.each([
    // chapter, the plan's "זמן משוער" (s); chapter 5's 16 is the model's 15.5, the plan rounded it up
    [1, 6.5],
    [2, 9.5],
    [3, 11.5],
    [4, 15.5],
    [5, 15.5],
    [6, 21],
    [8, 25],
    [10, 30.5],
    [12, 34.5],
    [14, 40],
    [16, 44.5],
    [21, 47.5],
    [26, 49],
  ])('a good player on chapter %i’s row of the fill ladder: %f s', (c, seconds) => {
    const row = FILL_ROWS.find((r) => c >= r.from && c <= r.to)!;
    expect(fillMixMs(fillMixOf(row.missing, c), row.around[0] === 72)).toBe(seconds * 1000);
  });

  it('the puzzle: 19.5, 27.5, 36.5 and 46.5 s for 3 to 6 moving boxes (§5.3)', () => {
    expect(PUZZLE_MODEL).toEqual({
      orientMs: 3000,
      boxMs: 4500,
      extraPerBoxMs: 500,
      extraFrom: 3,
      swapMs: 1500,
    });
    expect([3, 4, 5, 6].map((m) => puzzleModelMs(m))).toEqual([19500, 27500, 36500, 46500]);
    for (const row of PUZZLE_ROWS) expect(puzzleModelMs(row.moving)).toBeLessThanOrEqual(row.stars[2]);
  });
});
