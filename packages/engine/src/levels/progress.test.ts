import type { GameResult } from '../game/types';
import { DEFAULT_PROGRESS_RULES } from '../progress/progress';
import { answer, wrongDigit } from '../testing/game';
import {
  CHAIN_LEVEL,
  DUEL_LEVEL,
  FILL_BOX_LEVEL,
  levelDriver,
  PIP,
  POINT_HUNTER_LEVEL,
} from '../testing/levels';
import {
  chapterLevelIds,
  chapterOf,
  chapterStars,
  countsAsPlayed,
  gateOpen,
  gateState,
  isBetterMetric,
  isBossLevel,
  isLevelId,
  isLevelOpen,
  LEVEL_END_REASONS,
  LEVEL_METRIC,
  LEVEL_REV_BASE,
  LEVEL_RULES,
  type LevelOutcome,
  type LevelRecord,
  type LevelRecords,
  levelIdOf,
  levelNumber,
  levelOutcome,
  levelsXpEarned,
  levelXpFor,
  maxLevel,
  maxMsOf,
  mergeBest,
  nextLevelId,
  openedChaptersOf,
  puzzleConflictsOn,
  replayCandidates,
} from './progress';
import { type FindLevelOver, type FindTarget, LEVEL_KINDS, type PuzzleLevelOver, type Stars } from './spec';

/* Progress through the levels (plan §4.5, §5.1; dev-plan §1.4, §3.1) [D50, D51, D55]. */

/** One spot of a race (only counted here). */
const FIND_TARGET: FindTarget = {
  digit: 7,
  scope: { kind: 'box', index: 4 },
  cell: 40,
  accept: [40],
  tier: 'single',
};

const rec = (stars: Stars, plays = 1, lastPlayedAt?: number): LevelRecord =>
  lastPlayedAt === undefined ? { stars, plays } : { stars, plays, lastPlayedAt };

/** A chapter whose levels, in order, have these best stars (all played); `null` leaves one unplayed. */
function chapter(n: number, stars: (Stars | null)[], into: Record<string, LevelRecord> = {}) {
  chapterLevelIds(n).forEach((id, k) => {
    const s = stars[k];
    if (s !== undefined && s !== null) into[id] = rec(s);
  });
  return into;
}

describe('ids and order', () => {
  it('L001 ↔ 1 in chapter 1, L010 its boss, L300 ↔ 300 in chapter 30', () => {
    expect([levelIdOf(1), levelNumber('L001'), chapterOf('L001')]).toEqual(['L001', 1, 1]);
    expect([isBossLevel('L010'), isBossLevel('L009'), chapterOf(10), chapterOf(11)]).toEqual([
      true,
      false,
      1,
      2,
    ]);
    expect([levelIdOf(300), levelNumber('L300'), chapterOf('L300'), isBossLevel(300)]).toEqual([
      'L300',
      300,
      30,
      true,
    ]);
    expect(maxLevel()).toBe(300);
    for (let n = 1; n <= maxLevel(); n++) expect(levelNumber(levelIdOf(n))).toBe(n);
  });

  it('only one spelling is an id', () => {
    for (const bad of ['l001', 'L1', 'L01', 'L0001', 'L000', 'L-01', ' L001', 'X001'])
      expect([bad, levelNumber(bad), isLevelId(bad)]).toEqual([bad, null, false]);
    expect(isLevelId('L301')).toBe(true); // a later version's level: an id, not one of today's 300
    expect(() => levelIdOf(0)).toThrow(RangeError);
  });
});

describe('what is open (plan §4.5) [D51]', () => {
  it('L001 is always open; L002 once L001 was played, whatever its stars', () => {
    expect(isLevelOpen('L001', {})).toBe(true);
    expect(isLevelOpen('L002', {})).toBe(false);
    expect(isLevelOpen('L002', { L001: rec(0) })).toBe(true);
    expect(isLevelOpen('L003', { L001: rec(3) })).toBe(false);
  });

  it("[D64] a chain is built per the original §14 until Moshe decides: LEVEL_RULES.chainNotYet is 'accept'", () => {
    expect(LEVEL_RULES.chainNotYet).toBe('accept');
  });

  it('a quit counts as played (LEVEL_RULES.quitCountsAsPlayed), and every other end too', () => {
    for (const reason of LEVEL_END_REASONS) expect(countsAsPlayed(reason)).toBe(true);
  });

  it('with quitCountsAsPlayed off, a quit does not open the next level', () => {
    const rules = { ...LEVEL_RULES, quitCountsAsPlayed: false };
    expect(countsAsPlayed('quit', rules)).toBe(false);
    expect(countsAsPlayed('failed', rules)).toBe(true);
    // The phone counts a play only when it counts as played.
    const plays = countsAsPlayed('quit', rules) ? 1 : 0;
    expect(isLevelOpen('L002', { L001: rec(0, plays) }, [], rules)).toBe(false);
  });

  it('the gate of chapter 1: 19 stars → L011 closed; 20 → open; 20 with L010 unplayed → closed', () => {
    const nineteen = chapter(1, [2, 2, 2, 2, 2, 2, 2, 2, 2, 1]);
    expect(chapterStars(1, nineteen)).toBe(19);
    expect(isLevelOpen('L011', nineteen)).toBe(false);
    const twenty = chapter(1, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect([gateOpen(1, twenty), isLevelOpen('L011', twenty)]).toEqual([true, true]);
    const noBoss = chapter(1, [3, 3, 2, 2, 2, 2, 2, 2, 2, null]);
    expect(chapterStars(1, noBoss)).toBe(20);
    expect([gateOpen(1, noBoss), isLevelOpen('L011', noBoss)]).toEqual([false, false]);
  });

  it('a gate that opened once stays open: gateStars rising to 22, or a new unplayed level in the chapter', () => {
    const twenty = chapter(1, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    const stricter = { ...LEVEL_RULES, gateStars: 22 };
    expect(isLevelOpen('L011', twenty, [], stricter)).toBe(false); // never opened: the new bar holds
    expect(isLevelOpen('L011', twenty, [2], stricter)).toBe(true); // opened at 20: stays open
    const { L010: _boss, ...rebuilt } = twenty; // its boss is a new level now, not played yet
    expect(isLevelOpen('L011', rebuilt, [2])).toBe(true);
    // And a level that was played stays open, whatever happened since.
    expect(isLevelOpen('L012', { ...rebuilt, L011: rec(1) }, [], stricter)).toBe(true);
  });

  it('a level beyond the last one is never open', () => {
    expect(isLevelOpen('L301', { L300: rec(3) })).toBe(false);
  });
});

describe('the next level, and the gate (plan §4.5)', () => {
  it('L037 → L038 mid-chapter; at a closed gate (L040 played, 19 stars) none; after L300 none', () => {
    const records: Record<string, LevelRecord> = {};
    for (let c = 1; c <= 3; c++) chapter(c, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2], records);
    chapter(4, [2, 2, 2, 2, 2, 2, 2, 2, 2, 1], records);
    expect(nextLevelId('L037', records)).toBe('L038');
    expect(chapterStars(4, records)).toBe(19);
    expect(nextLevelId('L040', records)).toBeNull();
    expect(nextLevelId('L300', { L300: rec(3) })).toBeNull();
  });

  it('22 stars with L040 unplayed: the gate is closed, its boss not played, and L040 comes first to play', () => {
    const records = chapter(4, [3, 3, 3, 3, 3, 3, 2, 1, 1, null]);
    expect(gateState(4, records)).toEqual({
      chapter: 4,
      open: false,
      stars: 22,
      need: 20,
      bossPlayed: false,
    });
    expect(replayCandidates(4, records)[0]).toBe('L040');
    records.L040 = rec(0);
    expect(gateState(4, records)).toMatchObject({ open: true, bossPlayed: true });
  });

  it('what to play again: at most 3, the fewest stars first, a tie to the most recently played', () => {
    const records: LevelRecords = {
      L031: rec(3, 1, 100),
      L032: rec(1, 2, 200),
      L033: rec(1, 1, 500),
      L034: rec(0, 1, 50),
      L035: rec(2, 1, 900),
      L036: rec(1, 1, 300),
      L037: rec(2, 1, 10),
      L038: rec(3, 1, 1),
      L039: rec(2, 1, 2),
      L040: rec(2, 1, 3),
    };
    expect(replayCandidates(4, records)).toEqual(['L034', 'L033', 'L036']);
    expect(replayCandidates(4, records, LEVEL_RULES, 5)).toEqual(['L034', 'L033', 'L036', 'L032', 'L035']);
  });

  it('the open chapters, from the gates', () => {
    const records = chapter(1, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(openedChaptersOf(records)).toEqual([2]);
    expect(openedChaptersOf(records, [5])).toEqual([2, 5]);
  });
});

describe('the time a level may take [D49, D68]', () => {
  it('30 s by default; 60 s for fillBox, fillRow, fillCol and the puzzle (Moshe’s request, 2026-10-19)', () => {
    expect(LEVEL_RULES.levelMaxMs).toBe(30000);
    expect(LEVEL_RULES.kindMaxMs).toEqual({ fillBox: 60000, fillRow: 60000, fillCol: 60000, puzzle: 60000 });
    expect(Object.fromEntries(LEVEL_KINDS.map((k) => [k, maxMsOf(k)]))).toEqual({
      find: 30000,
      findDuel: 30000,
      fillBox: 60000,
      duel: 30000,
      spotError: 30000,
      pointHunter: 30000,
      chain: 30000,
      fillRow: 60000,
      fillCol: 60000,
      puzzle: 60000,
    });
  });

  it('both are settings: another table changes maxMsOf', () => {
    const rules = { ...LEVEL_RULES, levelMaxMs: 25000, kindMaxMs: { puzzle: 45000 } };
    expect([maxMsOf('puzzle', rules), maxMsOf('fillBox', rules), maxMsOf('find', rules)]).toEqual([
      45000, 25000, 25000,
    ]);
  });
});

describe('the puzzle’s settings', () => {
  it('[D70c] a wrong swap costs 5 s, as a wrong digit', () => {
    expect(LEVEL_RULES.puzzleSwapPenaltyMs).toBe(5000);
  });

  it("[D78b] repeated digits are never marked by default ('none')", () => {
    expect(LEVEL_RULES.puzzleConflicts).toBe('none');
    for (const n of [1, 2, 3, 4, 30]) expect(puzzleConflictsOn(n)).toBe(false);
  });

  it("'always' marks them in every puzzle; 'firstStages' in the first 3 puzzles, not the 4th", () => {
    const always = { ...LEVEL_RULES, puzzleConflicts: 'always' } as const;
    for (const n of [1, 3, 4, 30]) expect(puzzleConflictsOn(n, always)).toBe(true);
    const first = { ...LEVEL_RULES, puzzleConflicts: 'firstStages' } as const;
    expect(LEVEL_RULES.puzzleConflictsFirstStages).toBe(3);
    expect([1, 2, 3, 4, 5].map((n) => puzzleConflictsOn(n, first))).toEqual([true, true, true, false, false]);
    expect(puzzleConflictsOn(0, first)).toBe(false);
    expect(puzzleConflictsOn(2, { ...first, puzzleConflictsFirstStages: 1 })).toBe(false);
  });
});

describe('bests', () => {
  it('stars never go down: ★★★ then ★ → ★★★; without revs, as one rev', () => {
    const three = mergeBest('fillBox', null, { stars: 3, metric: 9000 });
    expect(mergeBest('fillBox', three, { stars: 1, metric: 18000 })).toEqual({ stars: 3, metric: 9000 });
    expect(mergeBest('fillBox', three, { stars: 1, metric: null })).toEqual({ stars: 3, metric: 9000 });
  });

  it('[D73] a new rev keeps the stars and starts the best measure over; the same rev, as always', () => {
    const rev1 = { stars: 3, metric: 7600, rev: 1 } as const;
    // L003 was a find at rev 1 (★★★, 7.6 s); at rev 2 it is a puzzle: ★ in 40 s.
    expect(mergeBest('puzzle', rev1, { stars: 1, metric: 40000, rev: 2 })).toEqual({
      stars: 3,
      metric: 40000,
      rev: 2,
    });
    // A quit at the new rev: the stars stay, and there is no measure yet.
    expect(mergeBest('puzzle', rev1, { stars: 0, metric: null, rev: 2 })).toEqual({
      stars: 3,
      metric: null,
      rev: 2,
    });
    // Then the same rev: the better time is kept, as before.
    const rev2 = { stars: 1, metric: 40000, rev: 2 } as const;
    expect(mergeBest('puzzle', rev2, { stars: 2, metric: 31000, rev: 2 })).toEqual({
      stars: 2,
      metric: 31000,
      rev: 2,
    });
    expect(mergeBest('puzzle', rev2, { stars: 1, metric: 50000, rev: 2 })).toEqual(rev2);
  });

  it('[D73] an attempt at an older rev than the record (synced late) adds its stars, never its measure', () => {
    expect(
      mergeBest('fillBox', { stars: 1, metric: 40000, rev: 2 }, { stars: 3, metric: 5000, rev: 1 }),
    ).toEqual({ stars: 3, metric: 40000, rev: 2 });
  });

  it('a rev on one side only: as one rev, and the rev is kept', () => {
    expect(mergeBest('find', { stars: 2, metric: 7600 }, { stars: 2, metric: 6000, rev: 2 })).toEqual({
      stars: 2,
      metric: 6000,
      rev: 2,
    });
  });

  it('LEVEL_REV_BASE: every level is rebuilt at rev 2 in 1.0.3', () => {
    expect(LEVEL_REV_BASE).toBe(2);
  });

  it('every kind has a measure; the three new ones go by the level clock', () => {
    for (const kind of LEVEL_KINDS) expect(LEVEL_METRIC[kind]).toBeDefined();
    expect([LEVEL_METRIC.fillRow, LEVEL_METRIC.fillCol, LEVEL_METRIC.puzzle]).toEqual([
      'timeMs',
      'timeMs',
      'timeMs',
    ]);
    expect([isBetterMetric('puzzle', 30000, 31000), isBetterMetric('fillRow', 31000, 30000)]).toEqual([
      true,
      false,
    ]);
  });

  it('the better measure is kept, by the kind’s direction', () => {
    expect(mergeBest('find', { stars: 2, metric: 7600 }, { stars: 2, metric: 6000 }).metric).toBe(6000);
    expect(mergeBest('duel', { stars: 2, metric: 9 }, { stars: 1, metric: 3 }).metric).toBe(9);
    expect(mergeBest('duel', { stars: 0, metric: null }, { stars: 1, metric: 3 }).metric).toBe(3);
  });

  it('isBetterMetric: a time lower; spots, a lead, points and errors found higher; equal is not better', () => {
    expect([isBetterMetric('find', 4000, 5000), isBetterMetric('fillBox', 5000, 4000)]).toEqual([
      true,
      false,
    ]);
    expect(isBetterMetric('chain', 9000, 9000)).toBe(false);
    for (const kind of ['findDuel', 'duel', 'pointHunter', 'spotError'] as const) {
      expect([
        kind,
        isBetterMetric(kind, 4, 3),
        isBetterMetric(kind, 3, 4),
        isBetterMetric(kind, 3, 3),
      ]).toEqual([kind, true, false, false]);
    }
  });
});

describe('XP (plan §5.1) [D55]', () => {
  it('10 per new star only, 50 per gate opened', () => {
    expect(levelXpFor(1, 1, false)).toBe(0);
    expect(levelXpFor(1, 3, false)).toBe(20);
    expect(levelXpFor(2, 2, false)).toBe(0); // a quit: 0 stars, the best unchanged
    expect(levelXpFor(1, 1, true)).toBe(50);
    expect(levelXpFor(0, 2, true)).toBe(70);
    expect(DEFAULT_PROGRESS_RULES.xp).toMatchObject({ levelStar: 10, levelGate: 50 });
  });

  it('all 900 stars and the 29 gates: 10,450', () => {
    const all: Record<string, LevelRecord> = {};
    for (let n = 1; n <= maxLevel(); n++) all[levelIdOf(n)] = rec(3);
    expect(openedChaptersOf(all)).toHaveLength(29);
    expect(levelsXpEarned(all)).toBe(10450);
  });

  it('counts only today’s levels, and a gate only once open', () => {
    expect(levelsXpEarned({ L301: rec(3) })).toBe(0);
    const nineteen = chapter(1, [2, 2, 2, 2, 2, 2, 2, 2, 2, 1]);
    expect(levelsXpEarned(nineteen)).toBe(190);
    expect(levelsXpEarned({ ...nineteen, L010: rec(2) })).toBe(200 + 50);
  });
});

describe('levelOutcome: every end of every kind, through both hosts', () => {
  const over = (o: Partial<FindLevelOver> & Pick<FindLevelOver, 'reason'>): FindLevelOver => ({
    elapsedMs: 0,
    penaltyMs: 0,
    spots: 0,
    found: 0,
    stars: 0,
    ...o,
  });
  const findTime = { by: 'timeMs', three: 5000, two: 10000, one: 20000 } as const;
  const find = { kind: 'find', stars: findTime } as const;
  const findDuel = { kind: 'findDuel', stars: { by: 'spots', three: 4, two: 3, one: 2 } } as const;
  const spotError = {
    kind: 'spotError',
    stars: { by: 'timeMs', three: 12000, two: 20000, one: 30000 },
  } as const;

  const outcomes: [string, LevelOutcome, Partial<LevelOutcome>][] = [];
  const add = (name: string, outcome: LevelOutcome, expected: Partial<LevelOutcome>) =>
    outcomes.push([name, outcome, expected]);

  // The tap engine (LocalFindHost).
  add(
    'find, found at 4 s',
    levelOutcome(find, over({ reason: 'targetReached', elapsedMs: 4000, spots: 1 })),
    {
      reason: 'completed',
      stars: 3,
      metric: 4000,
    },
  );
  add('find, time up', levelOutcome(find, over({ reason: 'timeUp', elapsedMs: 20000 })), {
    reason: 'timeUp',
    stars: 0,
    metric: null,
  });
  add('find, a second wrong tap', levelOutcome(find, over({ reason: 'tooManyMisses', elapsedMs: 3000 })), {
    reason: 'failed',
    stars: 0,
    metric: null,
  });
  add('find, quit', levelOutcome(find, over({ reason: 'quit', elapsedMs: 2000 })), {
    reason: 'quit',
    stars: 0,
    metric: null,
  });
  add('findDuel, all 5 spots taken', levelOutcome(findDuel, over({ reason: 'targetReached', spots: 4 })), {
    reason: 'completed',
    stars: 3,
    metric: 4,
  });
  add('findDuel, time up with 2', levelOutcome(findDuel, over({ reason: 'timeUp', spots: 2 })), {
    reason: 'timeUp',
    stars: 1,
    metric: 2,
  });
  add(
    'spotError, all found at 11 s',
    levelOutcome(spotError, over({ reason: 'targetReached', elapsedMs: 11000, found: 2 })),
    { reason: 'completed', stars: 3, metric: 2 },
  );
  add('spotError, time up with one found', levelOutcome(spotError, over({ reason: 'timeUp', found: 1 })), {
    reason: 'timeUp',
    stars: 0,
    metric: 1,
  });

  // The game engine (LocalGameHost), real games.
  const result = (g: ReturnType<typeof levelDriver>): GameResult => g.state.result!;
  {
    const g = levelDriver(FILL_BOX_LEVEL);
    for (const cell of ['D4', 'D5', 'E4', 'E5', 'F4']) g.solve('me', cell, 9000);
    add('fillBox, filled at 9 s', levelOutcome(FILL_BOX_LEVEL, result(g)), {
      reason: 'completed',
      stars: 3,
      metric: 9000,
    });
    const t = levelDriver(FILL_BOX_LEVEL);
    t.tickTo(20000);
    add('fillBox, time up', levelOutcome(FILL_BOX_LEVEL, result(t)), {
      reason: 'timeUp',
      stars: 0,
      metric: null,
    });
  }
  {
    const g = levelDriver(CHAIN_LEVEL);
    for (const cell of ['A1', 'B2', 'C1']) g.solve('me', cell, 12000);
    add('chain, done at 12 s', levelOutcome(CHAIN_LEVEL, result(g)), { reason: 'completed', stars: 2 });
    const t = levelDriver(CHAIN_LEVEL);
    t.tickTo(24000);
    add('chain, time up', levelOutcome(CHAIN_LEVEL, result(t)), { reason: 'timeUp', stars: 0 });
  }
  {
    const g = levelDriver(POINT_HUNTER_LEVEL);
    g.solve('me', 'A1', 1000);
    g.solve('me', 'B2', 2000);
    g.solve('me', 'F8', 3000);
    add('pointHunter, the best line', levelOutcome(POINT_HUNTER_LEVEL, result(g)), {
      reason: 'completed',
      stars: 3,
      metric: 23.5,
    });
    const t = levelDriver(POINT_HUNTER_LEVEL);
    t.solve('me', 'A1', 1000);
    t.tickTo(30000);
    add('pointHunter, time up after one move', levelOutcome(POINT_HUNTER_LEVEL, result(t)), {
      reason: 'timeUp',
      stars: 0,
      metric: 8,
    });
  }
  {
    // A1 8, A2 6.5, B4 8, G8 7, A5: past 30.
    const race = (id: string) => {
      const g = levelDriver(DUEL_LEVEL);
      for (const [k, cell] of ['A1', 'A2', 'B4', 'G8', 'A5'].entries()) g.solve(id, cell, 1000 * (k + 1));
      return g;
    };
    const mine = race('me');
    add('duel, me to 30', levelOutcome(DUEL_LEVEL, result(mine)), {
      reason: 'completed',
      stars: 3,
      metric: mine.score('me'),
    });
    add('duel, the bot to 30', levelOutcome(DUEL_LEVEL, result(race(PIP.id))), {
      reason: 'botWon',
      stars: 0,
    });
    const ahead = levelDriver(DUEL_LEVEL);
    ahead.solve('me', 'A1', 1000);
    ahead.tickTo(30000);
    add('duel, time up with me ahead', levelOutcome(DUEL_LEVEL, result(ahead)), {
      reason: 'timeUp',
      stars: 2,
      metric: 8,
    });
    const behind = levelDriver(DUEL_LEVEL);
    behind.solve(PIP.id, 'A1', 1000);
    behind.tickTo(30000);
    add('duel, time up with the bot ahead', levelOutcome(DUEL_LEVEL, result(behind)), {
      reason: 'timeUp',
      stars: 0,
      metric: -8,
    });
    const quit = levelDriver(DUEL_LEVEL);
    quit.solve('me', 'A1', 1000);
    quit.playerAct('me', { type: 'surrender' }, 2000);
    add('duel, surrender', levelOutcome(DUEL_LEVEL, result(quit)), {
      reason: 'quit',
      stars: 0,
      metric: null,
    });
  }
  {
    const quit = levelDriver(FILL_BOX_LEVEL);
    quit.select('me', 'D4', 1000);
    quit.place('me', 'D4', wrongDigit('D4'));
    quit.place('me', 'D4', answer('D4'));
    quit.playerAct('me', { type: 'surrender' }, 3000);
    add('fillBox, surrender', levelOutcome(FILL_BOX_LEVEL, result(quit)), {
      reason: 'quit',
      stars: 0,
      metric: null,
      elapsedMs: 8000,
    });
  }

  // The puzzle engine (LocalPuzzleHost): its levelOver, stars by the level clock (wrong swaps included).
  const puzzle = {
    kind: 'puzzle',
    stars: { by: 'timeMs', three: 26000, two: 36000, one: 45000 },
  } as const;
  const solved = (o: Partial<PuzzleLevelOver> & Pick<PuzzleLevelOver, 'reason'>): PuzzleLevelOver => ({
    elapsedMs: 0,
    penaltyMs: 0,
    swaps: 0,
    mistakes: 0,
    stars: 0,
    ...o,
  });
  add(
    'puzzle, solved at 26.000 s (the edge is still ★★★), one wrong swap in it',
    levelOutcome(
      puzzle,
      solved({ reason: 'targetReached', elapsedMs: 26000, penaltyMs: 5000, swaps: 3, mistakes: 1 }),
    ),
    { reason: 'completed', stars: 3, metric: 26000, elapsedMs: 26000 },
  );
  add(
    'puzzle, solved at 37 s',
    levelOutcome(puzzle, solved({ reason: 'targetReached', elapsedMs: 37000, swaps: 5 })),
    { reason: 'completed', stars: 1, metric: 37000 },
  );
  add(
    'puzzle, time up',
    levelOutcome(puzzle, solved({ reason: 'timeUp', elapsedMs: 45000, swaps: 9, mistakes: 4 })),
    { reason: 'timeUp', stars: 0, metric: null, elapsedMs: 45000 },
  );
  add('puzzle, quit', levelOutcome(puzzle, solved({ reason: 'quit', elapsedMs: 9000, swaps: 1 })), {
    reason: 'quit',
    stars: 0,
    metric: null,
  });

  it.each(outcomes)('%s', (_, outcome, expected) => {
    expect(outcome).toMatchObject(expected);
    expect(LEVEL_END_REASONS).toContain(outcome.reason);
  });

  it('a level that is not a boss: bossBeaten is null, whatever the end', () => {
    for (const [, outcome] of outcomes) expect(outcome.bossBeaten).toBeNull();
  });

  it('the engine’s own stars agree with the outcome’s', () => {
    const g = levelDriver(FILL_BOX_LEVEL);
    for (const cell of ['D4', 'D5', 'E4', 'E5', 'F4']) g.solve('me', cell, 11000);
    expect(levelOutcome(FILL_BOX_LEVEL, g.state.result!).stars).toBe(g.state.result!.level!.stars);
    expect(g.state.result!.level!.stars).toBe(2);
  });

  it('LEVEL_END_REASONS: completed, timeUp, botWon, failed, quit', () => {
    expect(LEVEL_END_REASONS).toEqual(['completed', 'timeUp', 'botWon', 'failed', 'quit']);
  });
});

describe('levelOutcome().bossBeaten: the engine says whether I beat the boss [D72]', () => {
  const over = (o: Partial<FindLevelOver> & Pick<FindLevelOver, 'reason'>): FindLevelOver => ({
    elapsedMs: 30000,
    penaltyMs: 0,
    spots: 0,
    found: 0,
    stars: 0,
    ...o,
  });
  const raceBoss = {
    kind: 'findDuel',
    boss: true,
    stars: { by: 'spots', three: 4, two: 3, one: 2 },
  } as const;

  it('a race boss, 2 spots mine and 3 the bot’s: a star, and still the bot’s win', () => {
    const outcome = levelOutcome(raceBoss, over({ reason: 'targetReached', spots: 2, opponentSpots: 3 }));
    expect(outcome).toMatchObject({ reason: 'completed', stars: 1, bossBeaten: false });
  });

  it('a race boss, 3 against 2: beaten; 2 against 1 with two void: beaten; 2 against 2: not', () => {
    expect(
      levelOutcome(raceBoss, over({ reason: 'targetReached', spots: 3, opponentSpots: 2 })).bossBeaten,
    ).toBe(true);
    expect(levelOutcome(raceBoss, over({ reason: 'timeUp', spots: 2, opponentSpots: 1 })).bossBeaten).toBe(
      true,
    );
    expect(levelOutcome(raceBoss, over({ reason: 'timeUp', spots: 2, opponentSpots: 2 })).bossBeaten).toBe(
      false,
    );
  });

  it('an older end with no bot count: beaten only with more than half of the race’s spots', () => {
    expect(levelOutcome(raceBoss, over({ reason: 'targetReached', spots: 2 })).bossBeaten).toBe(false);
    expect(levelOutcome(raceBoss, over({ reason: 'targetReached', spots: 3 })).bossBeaten).toBe(true);
    // The level says how many spots it has: 3 of 7 is not more than half.
    const seven = { ...raceBoss, targets: { spots: Array.from({ length: 7 }, () => FIND_TARGET) } };
    expect(levelOutcome(seven, over({ reason: 'targetReached', spots: 3 })).bossBeaten).toBe(false);
  });

  it('a race boss I quit: not beaten', () => {
    expect(levelOutcome(raceBoss, over({ reason: 'quit', spots: 3, opponentSpots: 0 })).bossBeaten).toBe(
      false,
    );
  });

  it('a duel boss: beaten by the target first or a lead when the time runs out; not by the bot’s win or a quit', () => {
    const boss = { ...DUEL_LEVEL, boss: true };
    const race = (id: string) => {
      const g = levelDriver(DUEL_LEVEL);
      for (const [k, cell] of ['A1', 'A2', 'B4', 'G8', 'A5'].entries()) g.solve(id, cell, 1000 * (k + 1));
      return g.state.result!;
    };
    expect(levelOutcome(boss, race('me'))).toMatchObject({ reason: 'completed', bossBeaten: true });
    expect(levelOutcome(boss, race(PIP.id))).toMatchObject({ reason: 'botWon', bossBeaten: false });
    const ahead = levelDriver(DUEL_LEVEL);
    ahead.solve('me', 'A1', 1000);
    ahead.tickTo(30000);
    expect(levelOutcome(boss, ahead.state.result!)).toMatchObject({ reason: 'timeUp', bossBeaten: true });
    const behind = levelDriver(DUEL_LEVEL);
    behind.solve(PIP.id, 'A1', 1000);
    behind.tickTo(30000);
    expect(levelOutcome(boss, behind.state.result!)).toMatchObject({ reason: 'timeUp', bossBeaten: false });
    const quit = levelDriver(DUEL_LEVEL);
    quit.solve('me', 'A1', 1000);
    quit.playerAct('me', { type: 'surrender' }, 2000);
    expect(levelOutcome(boss, quit.state.result!).bossBeaten).toBe(false);
  });

  it('a boss with no bot (only under D72 ב): beaten by finishing it with a star', () => {
    const boss = { ...FILL_BOX_LEVEL, boss: true };
    const g = levelDriver(FILL_BOX_LEVEL);
    for (const cell of ['D4', 'D5', 'E4', 'E5', 'F4']) g.solve('me', cell, 9000);
    expect(levelOutcome(boss, g.state.result!)).toMatchObject({ stars: 3, bossBeaten: true });
    const t = levelDriver(FILL_BOX_LEVEL);
    t.tickTo(20000);
    expect(levelOutcome(boss, t.state.result!)).toMatchObject({ reason: 'timeUp', bossBeaten: false });
  });
});
