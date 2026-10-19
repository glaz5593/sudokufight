import {
  DEFAULT_PROGRESS_RULES,
  leagueFor,
  levelFor,
  playerLeague,
  type ProgressRules,
  xpForGame,
} from './progress';

describe('leagues (spec §11.3, D38, D9)', () => {
  it.each([
    [1099, 'bronze'],
    [1100, 'silver'],
    [1249, 'silver'],
    [1250, 'gold'],
    [1399, 'gold'],
    [1400, 'diamond'],
    [1599, 'diamond'],
    [1600, 'legend'],
  ] as const)('%i is %s', (rating, league) => {
    expect(leagueFor(rating)).toBe(league);
  });

  it('the start rating (1200) is silver', () => {
    expect(leagueFor(1200)).toBe('silver');
  });

  it('follows the highest settled rating, and none while all are provisional', () => {
    expect(playerLeague([{ rating: 1300, games: 9 }])).toBeNull();
    expect(
      playerLeague([
        { rating: 1150, games: 12 },
        { rating: 1420, games: 10 },
        { rating: 1700, games: 3 },
      ]),
    ).toBe('diamond');
  });
});

describe('XP (spec §15)', () => {
  it('solo practice: 10, no move bonus', () => {
    expect(xpForGame({ mode: 'solo' })).toBe(10);
  });

  it('a win (ranked first place or vs a bot): 50 + 1 per correct move', () => {
    expect(xpForGame({ mode: 'ranked', won: true, correct: 23 })).toBe(73);
    expect(xpForGame({ mode: 'bot', won: true, correct: 0 })).toBe(50);
  });

  it('any other ranked or bot result: 20 + 1 per correct move', () => {
    expect(xpForGame({ mode: 'ranked', won: false, correct: 12 })).toBe(32);
    expect(xpForGame({ mode: 'bot', won: false, correct: -3 })).toBe(20);
  });

  it('reads its numbers from the rules', () => {
    const rules: ProgressRules = {
      ...DEFAULT_PROGRESS_RULES,
      xp: { win: 5, played: 2, solo: 1, perCorrect: 0, levelStar: 1, levelGate: 2 },
    };
    expect(xpForGame({ mode: 'bot', won: true, correct: 40 }, rules)).toBe(5);
  });
});

describe('levels (spec §15: level n → n + 1 takes 200 × n)', () => {
  it.each([
    [0, 1, 0, 200],
    [199, 1, 199, 200],
    [200, 2, 0, 400],
    [599, 2, 399, 400],
    [600, 3, 0, 600],
    [1200, 4, 0, 800],
  ])('%i XP → level %i (%i of %i)', (xp, level, into, next) => {
    expect(levelFor(xp)).toEqual({ level, xpIntoLevel: into, xpForNext: next });
  });

  it('negative or fractional XP counts as its whole non-negative part', () => {
    expect(levelFor(-50)).toEqual({ level: 1, xpIntoLevel: 0, xpForNext: 200 });
    expect(levelFor(200.9).level).toBe(2);
  });
});
