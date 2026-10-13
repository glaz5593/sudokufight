import 'react-native-reanimated';

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import type { ProgressApi } from '../../../api/progressApi';
import { entry, type FakeBoards, fakeProgressApi, ranked } from '../../../api/testing/fakeProgress';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { LeaderboardScreen, type LeaderboardScreenProps } from '../LeaderboardScreen';

/**
 * The leaderboard tab (spec §14.2; work plan stage 12): the tabs, the podium and the rows, my row pinned,
 * paging and refresh, option A's 2 / 3 / 4 picker, the friends tab [D27] and the offline state, in Hebrew and
 * English.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const hidden = { includeHiddenElements: true };
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  });

const ME = entry({ id: 'me', displayName: 'MosheG', rank: 214, rating: 1287, league: 'gold', level: 14 });

async function show(data: FakeBoards | ProgressApi | null, over: Partial<LeaderboardScreenProps> = {}) {
  const api = data === null ? null : 'leaderboard' in data ? data : fakeProgressApi(data);
  const props = {
    onOpenPlayer: jest.fn<void, [string]>(),
    onPlay: jest.fn(),
    onTab: jest.fn(),
    share: jest.fn(async () => undefined),
  };
  await render(
    <LeaderboardScreen
      api={() => api}
      myId="me"
      myAvatar="lava-lamp"
      myLeague={{ league: 'gold', rating: 1276 }}
      {...props}
      {...over}
    />,
  );
  await settle();
  return { api, ...props };
}

const rowIds = () =>
  screen
    .queryAllByTestId(/^leaderboard-row-/)
    .map((r) => (r.props.testID as string).replace('leaderboard-row-', ''));

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
});

describe('LeaderboardScreen', () => {
  it('"כללי": my league, the podium of the first three, a row for everyone after, my row pinned', async () => {
    const { onOpenPlayer } = await show({ tabs: { general: ranked(8) }, me: ME });
    expect(screen.getByRole('header', { name: 'טבלת מובילים' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'כללי' })).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('leaderboard-caption')).toHaveTextContent('כללי · הדירוג הגבוה של כל שחקן');
    expect(screen.getByTestId('leaderboard-league')).toHaveTextContent('ליגת זהבעוד 124 ליהלום', {
      exact: false,
    });

    const podium = screen.getByTestId('leaderboard-podium');
    expect(
      within(podium)
        .getAllByRole('button')
        .map((b) => b.props.testID),
    ).toEqual(['leaderboard-podium-2-p2', 'leaderboard-podium-1-p1', 'leaderboard-podium-3-p3']);
    expect(rowIds()).toEqual(['p4', 'p5', 'p6', 'p7', 'p8']);
    expect(screen.getByTestId('leaderboard-row-p4')).toHaveProp(
      'accessibilityLabel',
      'מקום 4, Player4, ישראל, ליגת זהב, רמה 5, דירוג 1580',
    );

    const mine = screen.getByTestId('leaderboard-me-row');
    expect(mine).toHaveProp(
      'accessibilityLabel',
      'מקום 214, MosheG (אתה), ישראל, ליגת זהב, רמה 14, דירוג 1287',
    );
    // Me is P1: the ● next to my name.
    expect(within(mine).getByTestId('glyph-circle', hidden)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('leaderboard-row-p5'));
    await fireEvent.press(screen.getByTestId('leaderboard-podium-1-p1'));
    await fireEvent.press(mine);
    await fireEvent.press(screen.getByRole('button', { name: 'כרטיס השחקן שלי' }));
    expect(onOpenPlayer.mock.calls.map((c) => c[0])).toEqual(['p5', 'p1', 'me', 'me']);
  });

  it('my row in the list is marked too', async () => {
    await show({ tabs: { general: [...ranked(4), { ...ME, rank: 5 }] }, me: { ...ME, rank: 5 } });
    expect(screen.getByTestId('leaderboard-row-me')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining('MosheG (אתה)'),
    );
  });

  it('switches tabs: each reads its own table (option B: no 2 / 3 / 4 picker)', async () => {
    const { api } = await show({ tabs: { general: ranked(4), normal: ranked(6, 1, 'n') }, me: ME });
    await fireEvent.press(screen.getByRole('tab', { name: 'רגיל' }));
    await settle();
    expect((api as ReturnType<typeof fakeProgressApi>).queries.at(-1)).toEqual({
      tab: 'normal',
      players: null,
    });
    expect(screen.getByTestId('leaderboard-caption')).toHaveTextContent('דירוג רגיל · כל העולם');
    expect(rowIds()).toEqual(['n4', 'n5', 'n6']);
    expect(screen.queryByTestId('leaderboard-players')).toBeNull();
  });

  it('option A: a game-type tab shows the 2 / 3 / 4 picker, and a size reads its own table', async () => {
    const { api } = await show({
      sized: { 'fast:2': ranked(5, 1, 'two'), 'fast:3': ranked(6, 1, 'three') },
      tabs: { general: ranked(4) },
    });
    expect(screen.queryByTestId('leaderboard-players')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: 'מהיר' }));
    await settle();
    expect(screen.getByRole('radio', { name: '2 שחקנים' })).toHaveProp('accessibilityState', {
      checked: true,
    });
    expect(rowIds()).toEqual(['two4', 'two5']);
    await fireEvent.press(screen.getByRole('radio', { name: '3 שחקנים' }));
    await settle();
    expect((api as ReturnType<typeof fakeProgressApi>).queries.at(-1)).toEqual({ tab: 'fast', players: 3 });
    expect(rowIds()).toEqual(['three4', 'three5', 'three6']);
    expect(screen.getByTestId('leaderboard-caption')).toHaveTextContent('דירוג מהיר · 3 שחקנים · כל העולם');
  });

  it('pages by the cursor as the list ends, and pull-to-refresh reads the first page again', async () => {
    const api = fakeProgressApi({ tabs: { general: ranked(70) }, pageSize: 30, me: ME });
    await show(api);
    /** The rows the list holds (it draws the first ones; the rest as it scrolls). */
    const rows = () => (screen.getByTestId('leaderboard-list').props.data as unknown[]).length;
    expect(rows()).toBe(27);
    const list = screen.getByTestId('leaderboard-list');
    await act(async () => {
      list.props.onEndReached();
    });
    await settle();
    expect(api.queries.at(-1)).toEqual({ tab: 'general', players: null, cursor: '30' });
    expect(rows()).toBe(57);

    await act(async () => {
      list.props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(api.queries.at(-1)).toEqual({ tab: 'general', players: null });
    expect(rows()).toBe(27);
  });

  it('friends [D27]: the recent opponents and "הזמן חברים" (the share sheet with the invite link)', async () => {
    const { share, onOpenPlayer } = await show({
      tabs: { general: ranked(3) },
      me: ME,
      friends: {
        recentOpponents: [entry({ id: 'nina', displayName: 'NinaVolt', rank: 33 })],
        inviteUrl: 'https://sf.app/i/abc',
      },
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'חברים' }));
    await settle();
    expect(screen.getByTestId('leaderboard-caption')).toHaveTextContent('היריבים האחרונים שלך');
    expect(rowIds()).toEqual(['nina']);
    expect(screen.queryByTestId('leaderboard-podium')).toBeNull();
    await fireEvent.press(screen.getByTestId('leaderboard-row-nina'));
    expect(onOpenPlayer).toHaveBeenCalledWith('nina');
    await fireEvent.press(screen.getByRole('button', { name: 'הזמן חברים' }));
    expect(share).toHaveBeenCalledWith('https://sf.app/i/abc', 'בוא לשחק נגדי בסודוקו פייט!');
  });

  it('friends, empty: the empty state; without an invite link, no invite button', async () => {
    const { onPlay } = await show({
      tabs: { general: ranked(3) },
      friends: { recentOpponents: [], inviteUrl: null },
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'חברים' }));
    await settle();
    expect(screen.getByTestId('leaderboard-friends-empty')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'עוד אין יריבים' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'הזמן חברים' })).toBeNull();
    await fireEvent.press(screen.getByTestId('leaderboard-empty-play'));
    expect(onPlay).toHaveBeenCalled();
  });

  it('no rating in this table yet: the pinned line says so, with "שחק"', async () => {
    const { onPlay } = await show({ tabs: { general: ranked(3) }, me: null });
    expect(screen.getByTestId('leaderboard-me-none')).toHaveTextContent('עוד אין לך דירוג בטבלה הזו', {
      exact: false,
    });
    await fireEvent.press(screen.getByRole('button', { name: 'שחק משחק מדורג כדי להיכנס לטבלה' }));
    expect(onPlay).toHaveBeenCalled();
  });

  it('an empty table: "עוד אין כאן אף אחד"', async () => {
    await show({ tabs: {} });
    expect(screen.getByTestId('leaderboard-empty')).toBeOnTheScreen();
  });

  it('offline: the offline state and "נסה שוב"; with a table read before, it stays with a note', async () => {
    const api = fakeProgressApi({ tabs: { general: ranked(5) } });
    api.failWith = 'network';
    await show(api);
    expect(screen.getByTestId('leaderboard-offline')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'אין חיבור לשרת' })).toBeOnTheScreen();
    api.failWith = null;
    await fireEvent.press(screen.getByTestId('leaderboard-retry'));
    await settle();
    expect(rowIds()).toEqual(['p4', 'p5']);

    api.failWith = 'timeout';
    await act(async () => {
      screen.getByTestId('leaderboard-list').props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(rowIds()).toEqual(['p4', 'p5']);
    expect(screen.getByTestId('leaderboard-note-offline')).toHaveTextContent(
      'אין חיבור לשרת: מוצג מה שנטען קודם.',
      {
        exact: false,
      },
    );
  });

  it('a provisional player: "בדירוג זמני" instead of a league', async () => {
    await show({ tabs: { general: ranked(3) } }, { myLeague: { league: null, rating: null } });
    expect(screen.getByTestId('leaderboard-league-provisional')).toHaveTextContent(
      'בדירוג זמניהליגה תופיע אחרי 10 משחקים מדורגים באחד מסוגי המשחק',
    );
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await show({ tabs: { general: ranked(5) }, me: ME });
    expect(screen.getByRole('header', { name: 'Leaderboard' })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Friends' })).toBeOnTheScreen();
    expect(screen.getByTestId('leaderboard-me-row')).toHaveProp(
      'accessibilityLabel',
      'Place 214, MosheG (you), Israel, Gold league, Level 14, Rating 1287',
    );
    expect(screen.getByTestId('leaderboard-league')).toHaveTextContent('124 to Diamond', { exact: false });
  });
});
