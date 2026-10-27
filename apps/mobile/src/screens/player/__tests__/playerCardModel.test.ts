import { card, myProgress, rating, recent } from '../../../api/testing/fakeProgress';
import { ltr } from '../../../components/player';
import i18n from '../../../i18n';
import {
  groupDigits,
  levelProgressOf,
  monthYearText,
  type ProgressT,
  ratingLayout,
  recentWords,
  sparkLength,
  sparkPoints,
  statCells,
  tileLabel,
  tileOf,
  tileWords,
  winPercent,
  xpText,
} from '../playerCardModel';

/** The player card's pure model (spec §14.3): the ratings by key, the stats, the trend line. */

// Both languages' strings, whatever language the tests start in (a language loads when it is first used).
beforeAll(() => i18n.loadLanguages(['he', 'en']));

const he = i18n.getFixedT('he', 'progress') as ProgressT;
const en = i18n.getFixedT('en', 'progress') as ProgressT;

const A_KEYS = ['fast', 'normal', 'hard'].flatMap((t) => [2, 3, 4].map((n) => `${t}-${n}p`));

describe('ratingLayout', () => {
  it('option B: the three ratings in one row, fast · normal · hard', () => {
    const layout = ratingLayout([rating('hard'), rating('fast'), rating('normal')]);
    expect(layout.option).toBe('B');
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]!.tiles.map((x) => x.key)).toEqual(['fast', 'normal', 'hard']);
  });

  it('option A: all 9 ratings, a group per game type, by table size', () => {
    const layout = ratingLayout([...A_KEYS].reverse().map((k) => rating(k)));
    expect(layout.option).toBe('A');
    expect(layout.groups.map((g) => g.gameType)).toEqual(['fast', 'normal', 'hard']);
    expect(layout.groups[1]!.tiles.map((x) => x.key)).toEqual(['normal-2p', 'normal-3p', 'normal-4p']);
    expect(layout.groups.flatMap((g) => g.tiles)).toHaveLength(9);
  });

  it('a key this app does not know still shows, with its own name', () => {
    const layout = ratingLayout([rating('normal'), rating('blitz')]);
    expect(layout.groups[0]!.tiles.map((x) => tileLabel(x, en, false))).toEqual(['Normal', 'blitz']);
  });
});

describe('a rating tile', () => {
  it('its trend (last minus first), its peak, and whether it is at the peak', () => {
    expect(tileOf(rating('normal', { trend: [1270, 1265, 1287] }))).toMatchObject({
      delta: 17,
      atPeak: false,
    });
    expect(tileOf(rating('normal', { rating: 1310, peak: 1310 }))).toMatchObject({
      atPeak: true,
      peak: 1310,
    });
    expect(tileOf(rating('normal', { trend: [1200] })).delta).toBeNull();
    expect(tileOf(rating('normal', { games: 0, rating: 1200, peak: 1200 })).atPeak).toBe(false);
    expect(tileOf(rating('fast-3p'))).toMatchObject({ gameType: 'fast', players: 3 });
  });

  it('its name and its words, in Hebrew and English', () => {
    const tile = tileOf(rating('normal-3p', { rating: 1287, peak: 1302, trend: [1276, 1287], games: 30 }));
    expect(tileLabel(tile, he, true)).toBe('3 שחקנים');
    expect(tileLabel(tile, he, false)).toBe('רגיל · 3 שחקנים');
    expect(tileWords(tile, he)).toBe(
      'דירוג רגיל · 3 שחקנים 1287, שיא 1302, 30 משחקים, עלייה של 11 במשחקים האחרונים',
    );
    const provisional = tileOf(
      rating('hard', { provisional: true, rating: 1180, peak: 1214, trend: [1190, 1180], games: 4 }),
    );
    expect(tileWords(provisional, en)).toBe(
      'Hard rating 1180, provisional, peak 1214, 4 games, down 10 over the last games',
    );
  });
});

describe('stats', () => {
  it('the cells of spec §14.3, a signed best move isolated', () => {
    const cells = statCells(card({ id: 'x' }).stats, he);
    expect(cells.map((c) => [c.key, c.value])).toEqual([
      ['games', '86'],
      ['wins', '49'],
      ['losses', '37'],
      ['winRate', ltr('57%')],
      ['streak', '3'],
      ['bestStreak', '7'],
      ['bestMove', ltr('+12.5')],
      ['avgMistakes', '2.5'],
    ]);
    expect(cells.map((c) => c.label)).toEqual([
      'משחקים',
      'ניצחונות',
      'הפסדים',
      'אחוז ניצחונות',
      'רצף נוכחי',
      'רצף שיא',
      'מהלך שיא',
      'טעויות למשחק',
    ]);
  });

  it('without games: dashes', () => {
    const none = statCells(
      {
        games: 0,
        wins: 0,
        losses: 0,
        winRate: null,
        streak: 0,
        bestStreak: 0,
        bestMove: null,
        avgMistakes: null,
      },
      en,
    );
    expect(none.filter((c) => c.value === '—').map((c) => c.key)).toEqual([
      'winRate',
      'bestMove',
      'avgMistakes',
    ]);
    expect(winPercent(null)).toBeNull();
    expect(winPercent(2)).toBe(100);
  });
});

describe('level and XP', () => {
  it('mine from my progress; another player’s from the card’s XP and the engine’s rules', () => {
    expect(levelProgressOf({ xp: 0 }, myProgress())).toEqual({
      level: 14,
      xpIntoLevel: 2380,
      xpForNext: 3000,
    });
    // 200 to level 2, 400 more to 3: 650 XP is level 3 with 50 in it, of 600.
    expect(levelProgressOf({ xp: 650 }, null)).toEqual({ level: 3, xpIntoLevel: 50, xpForNext: 600 });
  });

  it('"2,380 / 3,000 XP", left to right', () => {
    expect(groupDigits(1234567)).toBe('1,234,567');
    expect(groupDigits(999)).toBe('999');
    expect(xpText(2380, 3000, he)).toBe(ltr('2,380 / 3,000 XP'));
  });
});

describe('a recent result', () => {
  it('in words', () => {
    const r = recent(1)[0]!;
    expect(recentWords(r, he, '3 באוק׳')).toBe(
      `ניצחון, רגיל · 2 שחקנים, מקום 1, 40 נק׳, דירוג ${ltr('+16')}, 3 באוק׳`,
    );
    expect(recentWords({ ...r, ratingDelta: null, outcome: 'tie' }, en, 'Oct 3')).toBe(
      'Tie, Normal · 2 players, Place 1, 40 pts, Oct 3',
    );
  });
});

describe('the trend line', () => {
  it('fits the trend into the box, oldest at the start, highest at the top', () => {
    expect(sparkPoints([1, 3, 2], 102, 22, 1)).toBe('1,21 51,1 101,11');
    expect(sparkPoints([5, 5], 10, 10, 0)).toBe('0,5 10,5');
    expect(sparkPoints([5], 10, 10)).toBe('');
    expect(sparkLength('0,0 3,4 3,10')).toBe(11);
    expect(sparkLength('')).toBe(0);
  });
});

describe('"במשחק מאז"', () => {
  it('the month and year the account was made, in the language of the app', () => {
    const at = Date.UTC(2026, 3, 12, 9, 30);
    expect(monthYearText(at, 'he')).toBe('אפריל 2026');
    expect(monthYearText(at, 'en')).toBe('April 2026');
    expect(he('card.joinedSince', { date: monthYearText(at, 'he') })).toBe('במשחק מאז אפריל 2026');
    // A language Intl can't take: the year and month as digits.
    expect(monthYearText(at, 'not a language!')).toBe('2026-04');
  });
});
