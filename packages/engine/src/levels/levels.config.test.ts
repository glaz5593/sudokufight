import { BOT_CONFIG } from '../bot/levels';
import { seedFromString } from '../util/random';
import {
  boardGivens,
  boardTypeOf,
  bossKindOf,
  chainPlan,
  chapterBot,
  chapterKinds,
  fillBoxPlan,
  findScopes,
  findStars,
  kindOfLevel,
  LEVEL_GIVENS,
  levelBotOf,
  levelPlan,
  LEVELS_SALT,
  levelSeed,
  pointHunterPlan,
  RACE,
  RACE_MIN_GIVENS,
  spotErrorPlan,
  targetBoxEmpties,
  targetLogic,
  tierOfSlot,
} from './levels.config';
import { LEVEL_RULES, levelIdOf, maxLevel } from './progress';
import { type LevelKind, LEVEL_KINDS } from './spec';
import { POINT_SHARES } from './stars';

/*
 * The plan's numbers, copied from plan §2.1–§2.4, §3.1, §3.3 and §4.1–§4.4 (with dev-plan §1.4's fixes), against
 * levels.config: a changed number fails here first, so it is a deliberate, reviewed edit and a rebuild.
 */

const CHAPTERS = Array.from({ length: LEVEL_RULES.chapterCount }, (_, k) => k + 1);
const count = (kinds: readonly LevelKind[], kind: LevelKind) => kinds.filter((k) => k === kind).length;
const chapters = (from: number, to: number) => CHAPTERS.filter((c) => c >= from && c <= to);

describe('the kinds of each chapter (plan §4.1)', () => {
  it.each([
    // chapter, find, findDuel, fillBox, duel, ideas
    [1, 5, 0, 4, 0, 0],
    [2, 3, 3, 3, 0, 0],
    [3, 2, 2, 2, 3, 0],
    [4, 2, 2, 2, 2, 1],
  ])('chapter %i: %i find, %i race, %i box, %i duel, %i idea (the table)', (c, f, r, b, d, ideas) => {
    const kinds = chapterKinds(c).slice(0, 9);
    expect([
      count(kinds, 'find'),
      count(kinds, 'findDuel'),
      count(kinds, 'fillBox'),
      count(kinds, 'duel'),
    ]).toEqual([f, r, b, d]);
    expect(kinds.length - f - r - b - d).toBe(ideas);
  });

  it('chapter 4 brings Idea-1 (spot the error)', () => {
    expect(count(chapterKinds(4), 'spotError')).toBe(1);
  });

  it('chapters 5–9: two of each kind and one idea; Idea-2 enters in 7 with 2 (one race less), Idea-3 in 9 (one duel less)', () => {
    for (const c of chapters(5, 9)) {
      const kinds = chapterKinds(c).slice(0, 9);
      const ideas = kinds.filter((k) => k === 'spotError' || k === 'pointHunter' || k === 'chain');
      expect([c, count(kinds, 'find'), count(kinds, 'fillBox')]).toEqual([c, 2, 2]);
      if (c === 7)
        expect([count(kinds, 'pointHunter'), count(kinds, 'findDuel'), count(kinds, 'duel')]).toEqual([
          2, 1, 2,
        ]);
      else if (c === 9)
        expect([count(kinds, 'chain'), count(kinds, 'findDuel'), count(kinds, 'duel')]).toEqual([2, 2, 1]);
      else expect([ideas.length, count(kinds, 'findDuel'), count(kinds, 'duel')]).toEqual([1, 2, 2]);
    }
    expect(count(chapterKinds(7), 'pointHunter')).toBe(2);
    expect(count(chapterKinds(9), 'chain')).toBe(2);
    expect(
      chapterKinds(6)
        .slice(0, 9)
        .filter((k) => k === 'pointHunter' || k === 'chain'),
    ).toEqual([]);
    expect(
      chapterKinds(8)
        .slice(0, 9)
        .filter((k) => k === 'chain'),
    ).toEqual([]);
  });

  it('from chapter 10: one find, two each of race, box and duel, and two ideas in turn', () => {
    for (const c of chapters(10, 30)) {
      const kinds = chapterKinds(c).slice(0, 9);
      expect([
        c,
        count(kinds, 'find'),
        count(kinds, 'findDuel'),
        count(kinds, 'fillBox'),
        count(kinds, 'duel'),
      ]).toEqual([c, 1, 2, 2, 2]);
      const ideas = kinds.filter((k) => k === 'spotError' || k === 'pointHunter' || k === 'chain');
      expect(new Set(ideas).size).toBe(2);
    }
  });

  it('each idea is in the chapter that brings something new for it', () => {
    const has = (c: number, kind: LevelKind) => chapterKinds(c).includes(kind);
    expect([has(12, 'pointHunter'), has(21, 'pointHunter'), has(27, 'pointHunter')]).toEqual([
      true,
      true,
      true,
    ]);
    expect([has(13, 'spotError'), has(19, 'spotError')]).toEqual([true, true]);
    expect([has(14, 'chain'), has(22, 'chain'), has(29, 'chain')]).toEqual([true, true, true]);
  });

  it('the levels the design drew are those kinds: L066 a point hunter, L077 spot the error, L135 a chain', () => {
    expect([kindOfLevel(66), kindOfLevel(77), kindOfLevel(135)]).toEqual([
      'pointHunter',
      'spotError',
      'chain',
    ]);
  });

  it('300 levels: 43 find, 58 race, 63 box, 56 duel, 50 ideas, and 30 bosses (1 box, 15 races, 14 duels)', () => {
    const all = CHAPTERS.flatMap((c) => chapterKinds(c));
    const regular = CHAPTERS.flatMap((c) => chapterKinds(c).slice(0, 9));
    const bosses = CHAPTERS.map((c) => chapterKinds(c)[9]!);
    expect(all).toHaveLength(maxLevel());
    expect(LEVEL_KINDS.map((k) => count(regular, k))).toEqual([43, 58, 63, 56, 18, 16, 16]);
    expect([count(bosses, 'fillBox'), count(bosses, 'findDuel'), count(bosses, 'duel')]).toEqual([1, 15, 14]);
  });

  it('the boss (plan §3.3): chapter 1 a box, then the race in even chapters and the duel in odd ones', () => {
    expect(CHAPTERS.map(bossKindOf)).toEqual(
      CHAPTERS.map((c) => (c === 1 ? 'fillBox' : c % 2 === 0 ? 'findDuel' : 'duel')),
    );
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
    expect(levelPlan(12)).toMatchObject({ kind: 'findDuel', timeLimitMs: 30000, spots: 5 });
  });
});

describe('fillBox (plan §2.3)', () => {
  it.each([
    // chapter, missing, around (the chapter's own), ★★★, ★★, ★
    [1, 4, 72, 10000, 15000, 20000],
    [2, 4, 66, 10000, 15000, 20000],
    [3, 5, 60, 12000, 18000, 25000],
    [5, 5, 50, 12000, 18000, 25000],
    [6, 6, 42, 14000, 21000, 30000],
    [10, 6, 36, 14000, 21000, 30000],
    [11, 7, 34, 16000, 23000, 30000],
    [15, 7, 30, 16000, 23000, 30000],
    [16, 9, 30, 18000, 25000, 30000],
    [20, 9, 27, 18000, 25000, 30000],
    [21, 9, 27, 18000, 25000, 30000],
    [25, 9, 25, 18000, 25000, 30000],
    [26, 9, 25, 15000, 22000, 30000],
    [30, 9, 22, 15000, 22000, 30000],
  ])('chapter %i: %i missing, %i around, %i / %i / %i ms', (c, missing, around, three, two, one) => {
    expect(fillBoxPlan(c, 'base', false)).toMatchObject({
      missing,
      around,
      stars: { by: 'timeMs', three, two, one },
      limitMs: one,
    });
  });

  it('what the box needs: a naked single (1–5), a hidden single (6–10), nothing new (11–15), pointing or claiming, a pair, any elimination', () => {
    expect(fillBoxPlan(1, 'base', false).logic).toEqual({ techniques: ['nakedSingle'], mustNeed: [] });
    expect(fillBoxPlan(6, 'easy', false).logic.mustNeed).toEqual(['hiddenSingle']);
    expect(fillBoxPlan(11, 'base', false).logic.mustNeed).toEqual([]);
    expect(fillBoxPlan(16, 'base', false).logic.mustNeed).toEqual(['pointing', 'claiming']);
    expect(fillBoxPlan(21, 'base', false).logic.mustNeed).toEqual(['nakedPair', 'hiddenPair']);
    expect(fillBoxPlan(26, 'base', false).logic.mustNeed).toEqual([
      'pointing',
      'claiming',
      'nakedPair',
      'hiddenPair',
    ]);
  });

  it("chapter 1's boss: 5 missing, 10 / 15 / 20 s, the hard tier's board", () => {
    expect(levelPlan(10)).toMatchObject({
      kind: 'fillBox',
      boss: true,
      tier: 'hard',
      missing: 5,
      around: 66,
      stars: { three: 10000, two: 15000, one: 20000 },
    });
  });
});

describe('the duel (plan §2.4)', () => {
  it('first to 30 in 30 s; a lead of 15 / 8 / any', () => {
    expect(levelPlan(21)).toMatchObject({
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

  it('chapter 1 has no bot', () => {
    expect(chapterBot(1)).toBeNull();
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
    expect(levelSeed('L037', 1)).toBe(seedFromString('L037:r1', LEVELS_SALT));
    expect(levelPlan(37)).toMatchObject({
      id: 'L037',
      rev: 1,
      seed: levelSeed('L037', 1),
      chapter: 4,
      slot: 7,
    });
    expect(levelSeed('L037', 2)).not.toBe(levelSeed('L037', 1));
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
