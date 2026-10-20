import { BOT_CONFIG } from '../bot/levels';
import { seedFromString } from '../util/random';
import {
  boardGivens,
  boardTypeOf,
  bossKindOf,
  chainPlan,
  CHAPTER_PATTERNS,
  chapterBot,
  chapterKinds,
  FILL_ROWS,
  fillPlan,
  findScopes,
  findStars,
  FIRST_BOSS,
  kindOfLevel,
  LEVEL_GIVENS,
  LEVEL_REVS,
  levelBotOf,
  levelPlan,
  levelRev,
  LEVELS_SALT,
  levelSeed,
  levelsOfKind,
  lineKindOf,
  pointHunterPlan,
  PUZZLE_ROWS,
  puzzlePlan,
  RACE,
  RACE_MIN_GIVENS,
  regionIndexOf,
  spotErrorPlan,
  targetBoxEmpties,
  targetLogic,
  tierOfSlot,
} from './levels.config';
import { LEVEL_REV_BASE, LEVEL_RULES, levelIdOf, maxLevel, maxMsOf } from './progress';
import { FILL_LEVEL_KINDS, type LevelKind, LEVEL_KINDS } from './spec';
import { POINT_SHARES } from './stars';

/*
 * The plan's numbers, copied from plan §2.1–§2.4, §3.1, §3.3 and §4.1–§4.4 (with dev-plan §1.4's fixes) and from
 * 1.0.3's levels-content.md §3–§7, against levels.config: a changed number fails here first, so it is a
 * deliberate, reviewed edit and a rebuild.
 */

const CHAPTERS = Array.from({ length: LEVEL_RULES.chapterCount }, (_, k) => k + 1);
const count = (kinds: readonly LevelKind[], kind: LevelKind) => kinds.filter((k) => k === kind).length;
const chapters = (from: number, to: number) => CHAPTERS.filter((c) => c >= from && c <= to);
const ALL_KINDS = CHAPTERS.flatMap((c) => chapterKinds(c));

/** The tables of levels-content.md §3.2 and §3.3, in its own words' order. */
const F = 'find';
const R = 'findDuel';
const B = 'fillBox';
const D = 'duel';
const E = 'spotError';
const P = 'pointHunter';
const C = 'chain';
const W = 'fillRow';
const K = 'fillCol';
const Z = 'puzzle';

describe('the kinds of each chapter (levels-content.md §3) [D66]', () => {
  it.each([
    [1, [F, B, Z, W, F, B, Z, W, F, R]],
    [2, [F, K, R, B, Z, W, R, K, F, R]],
    [3, [D, B, E, Z, R, F, D, E, K, D]],
    [4, [C, B, R, Z, D, C, W, E, F, R]],
    [5, [P, K, R, B, E, P, D, Z, C, D]],
  ] as const)('chapter %i, slot by slot (§3.2)', (c, kinds) => {
    expect(chapterKinds(c)).toEqual(kinds);
  });

  it('chapters 6–30: three patterns in turn (§3.3), the line a row in odd chapters and a column in even ones', () => {
    expect(CHAPTER_PATTERNS).toEqual([
      [F, E, B, Z, R, C, 'line', D, P],
      [Z, D, P, 'line', E, F, B, R, C],
      ['line', R, C, B, P, D, F, Z, E],
    ]);
    expect(chapterKinds(6)).toEqual([F, E, B, Z, R, C, K, D, P, R]);
    expect(chapterKinds(7)).toEqual([Z, D, P, W, E, F, B, R, C, D]);
    expect(chapterKinds(8)).toEqual([K, R, C, B, P, D, F, Z, E, R]);
    expect(chapterKinds(29)).toEqual([W, R, C, B, P, D, F, Z, E, D]);
    expect(chapterKinds(30)).toEqual([F, E, B, Z, R, C, K, D, P, R]);
    expect([lineKindOf(9), lineKindOf(10)]).toEqual(['fillRow', 'fillCol']);
  });

  it('from chapter 6 every family once a chapter (the row and the column one family)', () => {
    for (const c of chapters(6, 30)) {
      const family = chapterKinds(c)
        .slice(0, 9)
        .map((k) => (k === 'fillRow' || k === 'fillCol' ? 'line' : k));
      expect([c, new Set(family).size]).toEqual([c, 9]);
    }
  });

  it('never two levels of one kind in a row, across chapters too (a race or a duel never next to its boss)', () => {
    const repeats = ALL_KINDS.flatMap((k, i) => (i > 0 && ALL_KINDS[i - 1] === k ? [levelIdOf(i + 1)] : []));
    expect(repeats).toEqual([]);
  });

  it('chapter 1 has four kinds and a bot boss; all ten kinds by chapter 5', () => {
    expect(new Set(chapterKinds(1).slice(0, 9)).size).toBe(4);
    expect(new Set(chapters(1, 5).flatMap((c) => chapterKinds(c))).size).toBe(LEVEL_KINDS.length);
    expect(LEVEL_KINDS).toHaveLength(10);
  });

  it('the first chapter of each kind (§3.1): spot the error from 3, the chain from 4, the point hunter from 5', () => {
    const first = (kind: LevelKind) => CHAPTERS.find((c) => chapterKinds(c).includes(kind));
    expect(LEVEL_KINDS.map((k) => [k, first(k)])).toEqual([
      ['find', 1],
      ['findDuel', 1],
      ['fillBox', 1],
      ['duel', 3],
      ['spotError', 3],
      ['pointHunter', 5],
      ['chain', 4],
      ['fillRow', 1],
      ['fillCol', 2],
      ['puzzle', 1],
    ]);
    // The race is only the boss in chapter 1; regular races from chapter 2.
    expect(chapterKinds(1).slice(0, 9)).not.toContain('findDuel');
  });

  it('a new kind gets two levels in its first chapter (find, the opener, three in chapter 1)', () => {
    for (const kind of LEVEL_KINDS) {
      const c = CHAPTERS.find((ch) => chapterKinds(ch).slice(0, 9).includes(kind))!;
      expect([kind, count(chapterKinds(c).slice(0, 9), kind)]).toEqual([kind, kind === 'find' ? 3 : 2]);
    }
  });

  it('300 levels (§3.4): the regular levels and the 30 bosses of each kind', () => {
    const regular = CHAPTERS.flatMap((c) => chapterKinds(c).slice(0, 9));
    const bosses = CHAPTERS.map((c) => chapterKinds(c)[9]!);
    expect(ALL_KINDS).toHaveLength(maxLevel());
    // find, findDuel, fillBox, duel, spotError, pointHunter, chain, fillRow, fillCol, puzzle
    expect(LEVEL_KINDS.map((k) => count(regular, k))).toEqual([32, 30, 31, 29, 29, 27, 28, 16, 17, 31]);
    expect(regular).toHaveLength(270);
    expect([count(bosses, 'findDuel'), count(bosses, 'duel'), count(bosses, 'fillBox')]).toEqual([16, 14, 0]);
  });

  it('the boss [D72]: chapter 1 the race (against Pip), then the race in even chapters and the duel in odd ones', () => {
    expect(CHAPTERS.map((c) => bossKindOf(c))).toEqual(
      CHAPTERS.map((c) => (c === 1 || c % 2 === 0 ? 'findDuel' : 'duel')),
    );
    expect(bossKindOf(1, 'fillBox')).toBe('fillBox');
  });

  it('kindOfLevel reads the table: L003 a puzzle, L004 a row, L010 the race, L012 a column', () => {
    expect([3, 4, 10, 12].map((n) => kindOfLevel(n))).toEqual(['puzzle', 'fillRow', 'findDuel', 'fillCol']);
    expect(ALL_KINDS).toEqual(Array.from({ length: maxLevel() }, (_, k) => kindOfLevel(k + 1)));
  });

  it('levelsOfKind picks the levels of a kind, of a chapter, bosses or not', () => {
    expect(levelsOfKind('fillBox', { chapter: 1 })).toEqual([2, 6]);
    expect(levelsOfKind('findDuel', { chapter: 1 })).toEqual([10]);
    expect(levelsOfKind('findDuel', { chapter: 1, boss: false })).toEqual([]);
    expect(levelsOfKind('puzzle')).toHaveLength(31);
    expect(levelsOfKind('duel', { boss: true })).toHaveLength(14);
  });
});

describe('the saw-tooth (plan §4.1)', () => {
  it('slots 1–3 easy, 4–6 the chapter, 7–9 and the boss hard', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(tierOfSlot)).toEqual([
      'easy',
      'easy',
      'easy',
      'base',
      'base',
      'base',
      'hard',
      'hard',
      'hard',
      'hard',
    ]);
  });

  it('a tier moves the givens one chapter back or forward', () => {
    expect([
      boardGivens('find', 2, 'easy'),
      boardGivens('find', 2, 'base'),
      boardGivens('find', 2, 'hard'),
    ]).toEqual([50, 49, 48]);
  });
});

describe('boards (plan §4.3, D43, dev-plan §1.4)', () => {
  it.each([
    // chapter, type, first and last givens of its act
    [1, 'fast', 50, 45],
    [6, 'normal', 40, 35],
    [11, 'normal', 38, 35],
    [16, 'hard', 29, 27],
    [21, 'hard', 28, 24],
    [26, 'hard', 24, 22],
  ] as const)('act of chapter %i: %s, %i → %i givens', (from, type, first, last) => {
    expect(boardTypeOf('find', from)).toBe(type);
    expect(boardGivens('find', from, 'base')).toBe(first);
    expect(boardGivens('find', from + 4, 'base')).toBe(last);
  });

  it('every full board is within the D43 range of its type (fast 45–50, normal 35–40, hard 22–29)', () => {
    expect(LEVEL_GIVENS).toEqual({
      fast: { min: 45, max: 50 },
      normal: { min: 35, max: 40 },
      hard: { min: 22, max: 29 },
    });
    const kinds = ['find', 'findDuel', 'duel', 'pointHunter', 'chain'] as const;
    for (const c of CHAPTERS)
      for (const kind of kinds)
        for (const tier of ['easy', 'base', 'hard'] as const) {
          const n = boardGivens(kind, c, tier);
          const range = LEVEL_GIVENS[boardTypeOf(kind, c)];
          expect([kind, c, tier, n >= range.min && n <= range.max]).toEqual([kind, c, tier, true]);
        }
  });

  it('the duel: fast up to chapter 7, normal from 8 to 15, hard from 16', () => {
    expect([7, 8, 15, 16].map((c) => boardTypeOf('duel', c))).toEqual(['fast', 'normal', 'normal', 'hard']);
  });

  it('the race keeps at least 24 givens (act 6)', () => {
    expect(RACE_MIN_GIVENS).toBe(24);
    expect(boardGivens('findDuel', 30, 'hard')).toBe(24);
    expect(boardGivens('find', 30, 'hard')).toBe(22);
  });
});

describe('find (plan §2.1)', () => {
  it.each([
    [1, 5000],
    [10, 5000],
    [11, 4000],
    [25, 4000],
    [26, 3000],
    [30, 3000],
  ])('chapter %i: ★★★ up to %i ms, ★★ 10 s, ★ 20 s', (c, three) => {
    expect(findStars(c)).toEqual({ by: 'timeMs', three, two: 10000, one: 20000 });
  });

  it('a find level ends at 20 s', () => {
    expect(levelPlan(1)).toMatchObject({ kind: 'find', timeLimitMs: 20000 });
  });

  it('the scope: a box (1–5), a row or column (6–10), the whole board (11–30); the race keeps to units', () => {
    expect([1, 5, 6, 10, 11, 30].map((c) => findScopes('find', c))).toEqual([
      ['box'],
      ['box'],
      ['row', 'col'],
      ['row', 'col'],
      ['board'],
      ['board'],
    ]);
    expect(findScopes('findDuel', 11)).toEqual(['box', 'row', 'col']);
  });

  it("the target's box: 3 empty cells in chapter 1, up to 7–8 in chapter 30", () => {
    expect(targetBoxEmpties(1, 'base')).toEqual({ min: 3, max: 3 });
    expect(targetBoxEmpties(30, 'base')).toEqual({ min: 7, max: 8 });
  });

  it('what a target must need: nothing in acts 1–3 and chapter 16, pointing or claiming in 17–20, a pair in 21–25, any elimination in 26–30; the easy slots nothing new', () => {
    expect([1, 10, 15, 16].map((c) => targetLogic(c, 'base').mustNeed)).toEqual([[], [], [], []]);
    expect(targetLogic(17, 'base').mustNeed).toEqual(['pointing', 'claiming']);
    expect(targetLogic(21, 'hard').mustNeed).toEqual(['nakedPair', 'hiddenPair']);
    expect(targetLogic(26, 'base').mustNeed).toEqual(['pointing', 'claiming', 'nakedPair', 'hiddenPair']);
    expect(targetLogic(26, 'easy').mustNeed).toEqual([]);
  });
});

describe('the race (plan §2.2)', () => {
  it('5 spots in 30 s; ★★★ 4–5, ★★ 3, ★ 2', () => {
    expect(RACE).toEqual({ spots: 5, limitMs: 30000, stars: { by: 'spots', three: 4, two: 3, one: 2 } });
    expect(levelPlan(levelsOfKind('findDuel', { boss: false })[0]!)).toMatchObject({
      kind: 'findDuel',
      timeLimitMs: 30000,
      spots: 5,
    });
  });

  it('chapter 1’s boss [D72]: a race against Pip at ×1.1, on a fast board, its targets in boxes', () => {
    expect(FIRST_BOSS).toEqual({ kind: 'findDuel', bot: { level: 1, pace: 1.1 } });
    expect(levelPlan(10)).toMatchObject({
      kind: 'findDuel',
      boss: true,
      gameType: 'fast',
      scopes: ['box'],
      bot: { level: 1, pace: 1.1 },
    });
  });
});

describe('the fill ladder (levels-content.md §4.3) [D67, D68, D69]', () => {
  it.each([
    // chapter, missing, around, every digit missing, ★★★, ★★, ★
    [1, 2, 72, 0, 10000, 15000, 20000],
    [2, 3, 72, 0, 14000, 20000, 30000],
    [3, 3, 68, 0, 16000, 24000, 30000],
    [4, 4, 66, 0, 22000, 30000, 40000],
    [5, 4, 63, 1, 22000, 30000, 40000],
    [6, 5, 58, 1, 28000, 38000, 50000],
    [7, 5, 54, 1, 28000, 38000, 50000],
    [8, 6, 50, 1, 32000, 44000, 60000],
    [9, 6, 46, 1, 32000, 44000, 60000],
    [10, 7, 43, 1, 36000, 48000, 60000],
    [11, 7, 40, 1, 36000, 48000, 60000],
    [12, 8, 38, 1, 38000, 50000, 60000],
    [13, 8, 36, 1, 38000, 50000, 60000],
    [14, 9, 35, 1, 42000, 54000, 60000],
    [15, 9, 34, 1, 42000, 54000, 60000],
    [16, 9, 33, 1, 45000, 55000, 60000],
    [20, 9, 30, 1, 45000, 55000, 60000],
    [21, 9, 30, 1, 45000, 55000, 60000],
    [25, 9, 27, 1, 45000, 55000, 60000],
    [26, 9, 27, 1, 44000, 54000, 60000],
    [30, 9, 24, 1, 44000, 54000, 60000],
  ])(
    'chapter %i: %i missing, %i around, gaps %i; %i / %i / %i ms',
    (c, missing, around, gaps, three, two, one) => {
      expect(fillPlan(c, 'base')).toMatchObject({
        missing,
        around,
        minDigitGaps: gaps,
        stars: { by: 'timeMs', three, two, one },
        limitMs: one,
      });
    },
  );

  it('the techniques: naked singles (1–5), a hidden single a must (6–10), singles (11–15), pointing or claiming, a pair, any elimination', () => {
    expect(fillPlan(1, 'base').logic).toEqual({ techniques: ['nakedSingle'], mustNeed: [] });
    expect(fillPlan(5, 'base').logic).toEqual({ techniques: ['nakedSingle'], mustNeed: [] });
    expect([6, 9, 10].map((c) => fillPlan(c, 'base').logic.mustNeed)).toEqual([
      ['hiddenSingle'],
      ['hiddenSingle'],
      ['hiddenSingle'],
    ]);
    expect(fillPlan(11, 'base').logic).toEqual({ techniques: ['nakedSingle', 'hiddenSingle'], mustNeed: [] });
    expect(fillPlan(16, 'base').logic.mustNeed).toEqual(['pointing', 'claiming']);
    expect(fillPlan(21, 'base').logic.mustNeed).toEqual(['nakedPair', 'hiddenPair']);
    expect(fillPlan(26, 'base').logic.mustNeed).toEqual(['pointing', 'claiming', 'nakedPair', 'hiddenPair']);
  });

  it('graded: the missing never drop, the givens around never rise, every digit missing from chapter 5, thresholds ordered and never dropping up to chapter 20, ★ within 60 s', () => {
    const plans = CHAPTERS.map((c) => fillPlan(c, 'base'));
    plans.forEach((p, k) => {
      const c = k + 1;
      const prev = plans[k - 1];
      expect([c, p.stars.three < p.stars.two && p.stars.two < p.stars.one]).toEqual([c, true]);
      for (const kind of FILL_LEVEL_KINDS) expect([c, p.limitMs <= maxMsOf(kind)]).toEqual([c, true]);
      expect([c, p.minDigitGaps]).toEqual([c, c >= 5 ? 1 : 0]);
      if (!prev) return;
      expect([c, p.missing >= prev.missing, p.around <= prev.around]).toEqual([c, true, true]);
      if (c <= 20)
        expect([c, p.stars.three >= prev.stars.three, p.stars.one >= prev.stars.one]).toEqual([
          c,
          true,
          true,
        ]);
    });
    expect(FILL_ROWS[0]!.from).toBe(1);
    expect(FILL_ROWS.at(-1)!.to).toBe(LEVEL_RULES.chapterCount);
  });

  it('the saw-tooth: slots 1–3 the row of the chapter before, 4–6 its own, 7–9 and the boss the next', () => {
    expect(fillPlan(6, 'easy')).toEqual(fillPlan(5, 'base'));
    expect(fillPlan(6, 'hard')).toEqual(fillPlan(7, 'base'));
    expect(fillPlan(1, 'easy')).toEqual(fillPlan(1, 'base'));
    expect(fillPlan(30, 'hard')).toEqual(fillPlan(30, 'base'));
  });

  it('chapter 1: 2 missing on a full board in both its boxes; chapter 14’s box: 9 missing', () => {
    for (const n of levelsOfKind('fillBox', { chapter: 1 }))
      expect(levelPlan(n)).toMatchObject({ kind: 'fillBox', missing: 2, around: 72, timeLimitMs: 20000 });
    expect(levelPlan(levelsOfKind('fillBox', { chapter: 14 })[0]!)).toMatchObject({
      missing: 9,
      timeLimitMs: 60000,
    });
  });

  it('the row and the column play the box’s ladder; each kind goes round all nine regions', () => {
    for (const kind of FILL_LEVEL_KINDS) {
      const plans = levelsOfKind(kind).map((n) => levelPlan(n));
      for (const p of plans) {
        const { missing, around, stars } = fillPlan(p.chapter, p.tier);
        expect(p).toMatchObject({ kind, missing, around, stars });
      }
      const indexes = plans.map((p) => ('index' in p ? p.index : -1));
      expect(new Set(indexes.slice(0, 9)).size).toBe(9);
      expect(indexes).toEqual(indexes.map((_, k) => regionIndexOf(kind, k)));
    }
  });
});

describe('the puzzle (levels-content.md §5.3) [D70, D71]', () => {
  it.each([
    // chapter, moving, ★★★, ★★, ★
    [1, 3, 26000, 36000, 45000],
    [3, 3, 26000, 36000, 45000],
    [4, 4, 36000, 48000, 60000],
    [6, 4, 36000, 48000, 60000],
    [7, 5, 44000, 54000, 60000],
    [10, 5, 44000, 54000, 60000],
    [11, 5, 40000, 52000, 60000],
    [15, 5, 40000, 52000, 60000],
    [16, 6, 45000, 55000, 60000],
    [20, 6, 45000, 55000, 60000],
    [21, 6, 42000, 52000, 60000],
    [30, 6, 42000, 52000, 60000],
  ])('chapter %i: %i moving; %i / %i / %i ms', (c, moving, three, two, one) => {
    expect(puzzlePlan(c, 'base')).toEqual({
      moving,
      lockOnCorrect: false,
      stars: { by: 'timeMs', three, two, one },
      limitMs: one,
    });
  });

  it('the moving boxes never drop, 3 to 6, at least 2 fixed, never a lock (D71), ★ within 60 s', () => {
    PUZZLE_ROWS.forEach((row, k) => {
      expect(row.moving >= 3 && row.moving <= 6 && 9 - row.moving >= 2).toBe(true);
      expect(row.lockOnCorrect).toBe(false);
      expect(row.stars[2] <= maxMsOf('puzzle')).toBe(true);
      if (k > 0) expect(row.moving).toBeGreaterThanOrEqual(PUZZLE_ROWS[k - 1]!.moving);
    });
  });

  it('the saw-tooth: chapter 3’s hard slots already have 4 moving; the first three puzzles 3', () => {
    expect(puzzlePlan(3, 'hard').moving).toBe(4);
    expect(
      levelsOfKind('puzzle')
        .slice(0, 3)
        .map((n) => (levelPlan(n) as { moving: number }).moving),
    ).toEqual([3, 3, 3]);
  });
});

describe('the duel (plan §2.4)', () => {
  it('first to 30 in 30 s; a lead of 15 / 8 / any', () => {
    expect(levelPlan(levelsOfKind('duel')[0]!)).toMatchObject({
      kind: 'duel',
      endAtScore: 30,
      timeLimitMs: 30000,
      stars: { by: 'gap', three: 15, two: 8 },
    });
  });
});

describe('Idea-1, spot the error (plan §3.1, §4.3)', () => {
  it.each([
    // chapter, visible, silent, limit, ★★★, ★★, ★
    [3, 1, 0, 20000, 6000, 12000, 20000],
    [4, 1, 0, 20000, 6000, 12000, 20000],
    [7, 1, 0, 20000, 6000, 12000, 20000],
    [8, 2, 0, 30000, 12000, 20000, 30000],
    [12, 2, 0, 30000, 12000, 20000, 30000],
    [13, 0, 2, 30000, 12000, 20000, 30000],
    [18, 0, 2, 30000, 12000, 20000, 30000],
    [19, 1, 2, 30000, 15000, 22000, 30000],
    [30, 1, 2, 30000, 15000, 22000, 30000],
  ])(
    'chapter %i: %i visible, %i silent, %i ms; %i / %i / %i',
    (c, visible, silent, limitMs, three, two, one) => {
      expect(spotErrorPlan(c, 'base')).toMatchObject({
        visible,
        silent,
        limitMs,
        stars: { three, two, one },
      });
    },
  );
});

describe('Idea-2, the point hunter (plan §3.1, §4.3)', () => {
  it.each([
    [5, 'fast', 30000],
    [7, 'fast', 30000],
    [11, 'fast', 30000],
    [12, 'normal', 25000],
    [20, 'normal', 25000],
    [21, 'hard', 20000],
    [30, 'hard', 20000],
  ] as const)('chapter %i: a %s board, %i ms, 3 moves', (c, type, limitMs) => {
    expect(boardTypeOf('pointHunter', c)).toBe(type);
    expect(pointHunterPlan(c)).toMatchObject({ maxMoves: 3, limitMs });
  });

  it('★ 70%, ★★ 85%, ★★★ 95% of the best; from chapter 27 ★★★ 98%', () => {
    expect(pointHunterPlan(26).shares).toEqual(POINT_SHARES);
    expect(POINT_SHARES).toEqual({ one: 0.7, two: 0.85, three: 0.95 });
    expect(pointHunterPlan(27).shares).toEqual({ one: 0.7, two: 0.85, three: 0.98 });
  });

  it('the first two point hunters show what a locked cell is worth', () => {
    const hunters = Array.from({ length: maxLevel() }, (_, k) => levelPlan(k + 1)).filter(
      (p) => p.kind === 'pointHunter',
    );
    expect(hunters.map((p) => (p.kind === 'pointHunter' ? p.worthHint : null)).slice(0, 4)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('Idea-3, the chain (plan §3.1, §4.3; dev-plan §1.4)', () => {
  it.each([
    [4, 3, 24000, 10000, 16000, 24000],
    [9, 3, 24000, 10000, 16000, 24000],
    [13, 3, 24000, 10000, 16000, 24000],
    [14, 4, 30000, 13000, 20000, 30000],
    [21, 4, 30000, 13000, 20000, 30000],
    [22, 5, 30000, 16000, 23000, 30000],
    [28, 5, 30000, 16000, 23000, 30000],
    [29, 5, 30000, 12000, 23000, 30000],
    [30, 5, 30000, 12000, 23000, 30000],
  ])('chapter %i: %i steps, %i ms; %i / %i / %i', (c, steps, limitMs, three, two, one) => {
    expect(chainPlan(c, 'base')).toMatchObject({ steps, limitMs, stars: { by: 'timeMs', three, two, one } });
  });
});

describe('bots (plan §4.2, §3.3) [D61]', () => {
  it.each([
    [2, 1, 1],
    [3, 1, 1],
    [4, 1, 0.9],
    [5, 2, 1],
    [6, 2, 1],
    [7, 2, 1],
    [8, 2, 0.9],
    [9, 2, 0.9],
    [10, 3, 1],
    [11, 3, 1],
    [12, 3, 1],
    [13, 3, 0.9],
    [14, 3, 0.9],
    [15, 3, 0.9],
    [16, 3, 0.85],
    [17, 3, 0.8],
    [18, 4, 1.1],
    [19, 4, 1.1],
    [20, 4, 1.05],
    [21, 4, 1],
    [22, 4, 1],
    [23, 4, 1],
    [24, 4, 0.95],
    [25, 4, 0.9],
    [26, 4, 0.9],
    [27, 4, 0.85],
    [28, 4, 0.85],
    [29, 4, 0.85],
    [30, 4, 0.8],
  ])('chapter %i: bot level %i at ×%s', (c, level, pace) => {
    expect(chapterBot(c)).toEqual({ level, pace });
  });

  it('chapter 1 has no bot of its own; its boss meets Pip at ×1.1 [D72]', () => {
    expect(chapterBot(1)).toBeNull();
    expect(levelBotOf(1, false)).toBeNull();
    expect(levelBotOf(1, true)).toEqual({ level: 1, pace: 1.1 });
  });

  it('every boss has a bot (D72 א)', () => {
    const bosses = Array.from({ length: LEVEL_RULES.chapterCount }, (_, k) => levelPlan((k + 1) * 10));
    expect(bosses.filter((p) => !('bot' in p)).map((p) => p.id)).toEqual([]);
  });

  it('a boss is its chapter bot at ×0.9, and Overlord exactly in L280, L290 and L300', () => {
    for (const c of chapters(2, 30)) {
      const boss = levelBotOf(c, true)!;
      expect(boss.pace).toBeCloseTo(chapterBot(c)!.pace * 0.9, 9);
      expect(boss.level).toBe(c >= 28 ? 5 : chapterBot(c)!.level);
    }
    const overlords = Array.from({ length: maxLevel() }, (_, k) => levelPlan(k + 1))
      .filter((p) => 'bot' in p && p.bot.level === 5)
      .map((p) => p.id);
    expect(overlords).toEqual(['L280', 'L290', 'L300']);
  });

  it('every bot pace is within ×0.7–×1.2', () => {
    expect(levelBotOf(1, true)!.pace).toBeLessThanOrEqual(1.2);
    for (const c of chapters(2, 30))
      for (const boss of [false, true]) {
        const pace = levelBotOf(c, boss)!.pace;
        expect(pace >= 0.7 && pace <= 1.2).toBe(true);
      }
  });

  it("the race's bot searches by BOT_CONFIG.find (the plan's first guess, frozen per level at build)", () => {
    expect(BOT_CONFIG.find.ms[1]).toEqual({ min: 8000, max: 12000 });
    expect(BOT_CONFIG.find.ms[5]).toEqual({ min: 3000, max: 4500 });
  });
});

describe('ids and seeds', () => {
  it("a level's seed comes from its id and rev, salted (never the bank's)", () => {
    expect(levelSeed('L037', 2)).toBe(seedFromString('L037:r2', LEVELS_SALT));
    expect(levelPlan(37)).toMatchObject({
      id: 'L037',
      rev: 2,
      seed: levelSeed('L037', 2),
      chapter: 4,
      slot: 7,
    });
    expect(levelSeed('L037', 2)).not.toBe(levelSeed('L037', 1));
  });

  it('[D73] all 300 at rev 2 (LEVEL_REV_BASE), none moved further yet', () => {
    expect(LEVEL_REV_BASE).toBe(2);
    expect(LEVEL_REVS).toEqual({});
    for (let n = 1; n <= maxLevel(); n++) expect([n, levelRev(levelIdOf(n))]).toEqual([n, 2]);
  });

  it('every plan has its id, chapter and slot', () => {
    for (let n = 1; n <= maxLevel(); n++) {
      const p = levelPlan(n);
      expect([p.id, p.chapter, p.slot, p.boss]).toEqual([
        levelIdOf(n),
        Math.ceil(n / 10),
        ((n - 1) % 10) + 1,
        n % 10 === 0,
      ]);
    }
  });
});
