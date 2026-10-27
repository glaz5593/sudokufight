import type { PlayerStats } from '@sudoku-fight/protocol';
import { act, render, renderHook, screen } from '@testing-library/react-native';

import { card } from '../../../api/testing/fakeProgress';
import { useAuth } from '../../../auth';
import { ltr } from '../../../components/player';
import i18n from '../../../i18n';
import { adoptCard, forgetProgress } from '../../../progress/progressStore';
import { useSettings } from '../../../state/settings';
import { usePracticeStats } from '../../home/practiceStats';
import { memoryRepo } from '../../replay/testing/sources';
import { HistoryScreen } from '../HistoryScreen';
import {
  type HistorySummary,
  type HistoryT,
  historySummaryOf,
  percentText,
  summaryLine,
} from '../historySummary';
import { useHistorySummary } from '../useHistorySummary';

/**
 * The history header (History.dc.html): "86 משחקים · 57% ניצחונות" and the "רצף 3" chip. My card's ranked
 * numbers (the design's are the Profile's), the practices counted apart; before my card, the practices.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const hidden = { includeHiddenElements: true };
const he = i18n.getFixedT('he', 'history') as HistoryT;
const en = i18n.getFixedT('en', 'history') as HistoryT;

const STATS: PlayerStats = card({ id: 'me' }).stats; // 86 games, 49 wins, streak 3
const NO_PRACTICE = { gamesPlayed: null, winRate: null, streak: null };

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

describe('historySummaryOf', () => {
  it('my card: its ranked games, win % and streak; the practices apart', () => {
    expect(historySummaryOf(STATS, { gamesPlayed: 12, winRate: 0.9, streak: 5 })).toEqual<HistorySummary>({
      source: 'ranked',
      games: 86,
      winRate: 49 / 86,
      streak: 3,
      practices: 12,
    });
    // No ranked game yet: no win % and no streak (not "0%").
    expect(
      historySummaryOf({ ...STATS, games: 0, wins: 0, losses: 0, winRate: null, streak: 0 }, NO_PRACTICE),
    ).toEqual({ source: 'ranked', games: 0, winRate: null, streak: null, practices: null });
  });

  it('no card yet: the practices on this phone (their win % and streak against bots); nothing read: none', () => {
    expect(historySummaryOf(null, { gamesPlayed: 12, winRate: 0.5, streak: 2 })).toEqual({
      source: 'practice',
      games: 12,
      winRate: 0.5,
      streak: 2,
      practices: null,
    });
    expect(historySummaryOf(null, NO_PRACTICE)).toBeNull();
  });

  it('in words, the percent isolated', () => {
    const ranked = historySummaryOf(STATS, { gamesPlayed: 12, winRate: null, streak: null })!;
    expect(summaryLine(ranked, he)).toBe(`86 משחקים · ${ltr('57%')} ניצחונות · 12 אימונים`);
    expect(summaryLine({ ...ranked, practices: 0 }, en)).toBe(`86 games · ${ltr('57%')} wins`);
    expect(summaryLine({ ...ranked, games: 1, winRate: 1, practices: 1 }, he)).toBe(
      `משחק אחד · ${ltr('100%')} ניצחונות · אימון אחד`,
    );
    const practice = historySummaryOf(null, { gamesPlayed: 4, winRate: 0.25, streak: 0 })!;
    expect(summaryLine(practice, he)).toBe(`4 אימונים · ${ltr('25%')} ניצחונות`);
    expect(summaryLine({ ...practice, winRate: null }, en)).toBe('4 practices');
    expect(percentText(2 / 3, he)).toBe(ltr('67%'));
    expect(percentText(2 / 3, en)).toBe(ltr('67%'));
  });
});

describe('the header', () => {
  const show = async (summary: HistorySummary | null) => {
    await render(
      <HistoryScreen
        deps={() => ({ practice: memoryRepo, ranked: null })}
        onOpen={jest.fn()}
        onPlay={jest.fn()}
        onTab={jest.fn()}
        myAvatar="lava-lamp"
        summary={summary}
      />,
    );
    await act(async () => {
      await new Promise((r) => setImmediate(r));
    });
  };

  it('games and win % under the title, and the streak chip (History.dc.html)', async () => {
    await show(historySummaryOf(STATS, { gamesPlayed: 0, winRate: null, streak: null }));
    expect(screen.getByTestId('history-summary')).toHaveTextContent(`86 משחקים · ${ltr('57%')} ניצחונות`);
    const streak = screen.getByTestId('history-streak');
    expect(streak).toHaveProp('accessibilityLabel', 'רצף ניצחונות: 3 ניצחונות');
    expect(streak).toHaveTextContent('רצף3');
  });

  it('no streak chip without a win in a row; no line without numbers', async () => {
    await show({ source: 'ranked', games: 5, winRate: 0.4, streak: 0, practices: null });
    expect(screen.getByTestId('history-summary')).toBeOnTheScreen();
    expect(screen.queryByTestId('history-streak')).toBeNull();
    await show(null);
    expect(screen.queryByTestId('history-summary')).toBeNull();
    expect(screen.queryByTestId('history-streak', hidden)).toBeNull();
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    await show(historySummaryOf(STATS, NO_PRACTICE));
    expect(screen.getByTestId('history-summary')).toHaveTextContent(`86 games · ${ltr('57%')} wins`);
    expect(screen.getByTestId('history-streak')).toHaveProp('accessibilityLabel', 'Win streak: 3 wins');
  });
});

describe('useHistorySummary', () => {
  const realRefresh = usePracticeStats.getState().refresh;
  afterEach(() => {
    useAuth.setState({ status: 'loading', user: null });
    forgetProgress();
    usePracticeStats.setState({ gamesPlayed: null, winRate: null, streak: null, refresh: realRefresh });
  });

  it('my saved card when it is the signed-in player’s, the practices counted again as the tab opens', async () => {
    const refresh = jest.fn(() => Promise.resolve());
    usePracticeStats.setState({ gamesPlayed: 7, winRate: 0.5, streak: 1, refresh });
    const { result, unmount } = await renderHook(() => useHistorySummary());
    expect(refresh).toHaveBeenCalledTimes(1);
    // Signed out: the practices.
    expect(result.current).toMatchObject({ source: 'practice', games: 7 });

    await act(async () => {
      useAuth.setState({ status: 'ready', user: { uid: 'uid-me' } } as never);
      adoptCard('uid-me', card({ id: 'me' }), 1);
    });
    expect(result.current).toEqual({
      source: 'ranked',
      games: 86,
      winRate: 49 / 86,
      streak: 3,
      practices: 7,
    });
    await unmount();
  });
});
