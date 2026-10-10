import 'react-native-reanimated';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { type ProgressApi, ProgressApiError } from '../../../api/progressApi';
import { entry, fakeProgressApi, ranked } from '../../../api/testing/fakeProgress';
import { SKELETON_OPACITY } from '../../../components/ui';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { LeaderboardScreen } from '../LeaderboardScreen';

/**
 * The leaderboard's states (work plan stage 13; spec §4.1 "מצבים ריקים" and "מצבי שגיאה", §16.3;
 * Loading.dc.html): the skeleton while a table loads (still under reduced motion), no connection and the
 * server's error with "נסה שוב" and the support code, the friends tab with no opponents yet, and signed out,
 * in Hebrew and English.
 */

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  });

/** An API whose answers wait until the test lets them through. */
function heldApi(data = { tabs: { general: ranked(6) } }) {
  const inner = fakeProgressApi(data);
  const waiting: (() => void)[] = [];
  const api: ProgressApi = {
    ...inner,
    leaderboard: (query) =>
      new Promise((resolve, reject) => {
        waiting.push(() => void inner.leaderboard(query).then(resolve, reject));
      }),
  };
  const release = () =>
    act(async () => {
      for (const go of waiting.splice(0)) go();
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    });
  return { api, release };
}

async function show(api: ProgressApi | null) {
  const props = { onOpenPlayer: jest.fn(), onPlay: jest.fn(), onTab: jest.fn() };
  await render(
    <LeaderboardScreen
      api={() => api}
      myId="me"
      myAvatar="av07"
      myLeague={{ league: 'gold', rating: 1276 }}
      share={jest.fn(async () => undefined)}
      {...props}
    />,
  );
  await settle();
  return props;
}

let announce: jest.SpyInstance;

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on' });
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => announce.mockRestore());

describe('leaderboard states (stage 13)', () => {
  it('loading: the podium and the rows as a skeleton, one "טוען…" for screen readers; then the table', async () => {
    const { api, release } = heldApi();
    await show(api);
    const loading = screen.getByRole('progressbar', { name: 'טוען…' });
    expect(loading).toHaveProp('accessibilityState', { busy: true });
    expect(screen.getByTestId('leaderboard-loading')).toBe(loading);
    expect(screen.queryByTestId('leaderboard-podium')).toBeNull();
    expect(screen.queryByRole('button', { name: 'נסה שוב' })).toBeNull();
    await release();
    expect(screen.queryByTestId('leaderboard-loading')).toBeNull();
    expect(screen.getByTestId('leaderboard-podium')).toBeOnTheScreen();
  });

  it('no connection: the explanation, the support code and "נסה שוב", said as it appears', async () => {
    const api = fakeProgressApi({ tabs: { general: ranked(5) } });
    api.leaderboard = async () => {
      throw new ProgressApiError('unavailable', 503);
    };
    await show(api);
    expect(screen.getByTestId('leaderboard-offline')).toBeOnTheScreen();
    expect(screen.getByTestId('leaderboard-offline-title')).toHaveTextContent('אין חיבור לשרת');
    expect(screen.getByTestId('leaderboard-offline-body')).toHaveTextContent('הטבלה תתעדכן כשיחזור החיבור.');
    expect(screen.getByTestId('leaderboard-offline-code')).toHaveAccessibleName('קוד שגיאה: unavailable-503');
    expect(announce).toHaveBeenCalledWith('אין חיבור לשרת. הטבלה תתעדכן כשיחזור החיבור.');

    api.leaderboard = fakeProgressApi({ tabs: { general: ranked(5) } }).leaderboard;
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    await settle();
    expect(screen.queryByTestId('leaderboard-offline')).toBeNull();
    expect(screen.getByTestId('leaderboard-row-p4')).toBeOnTheScreen();
  });

  it('the server’s error: "משהו השתבש", what to do, the code', async () => {
    const api = fakeProgressApi();
    api.failWith = 'badRequest';
    await show(api);
    expect(screen.getByTestId('leaderboard-error-title')).toHaveTextContent('משהו השתבש');
    expect(screen.getByTestId('leaderboard-error-body')).toHaveTextContent(
      'השרת לא הצליח לענות כרגע. נסה שוב בעוד רגע.',
    );
    expect(screen.getByTestId('leaderboard-error-code')).toHaveTextContent('badRequest');
    expect(screen.getByTestId('leaderboard-retry')).toBeOnTheScreen();
  });

  it('friends with no opponents yet: the empty state and "הזמן חברים"', async () => {
    await show(fakeProgressApi({ friends: { recentOpponents: [], inviteUrl: 'https://sf.example/i/abc' } }));
    await fireEvent.press(screen.getByRole('tab', { name: 'חברים' }));
    await settle();
    expect(screen.getByTestId('leaderboard-friends-empty-title')).toHaveTextContent('עוד אין יריבים');
    expect(screen.getByTestId('leaderboard-friends-empty-body')).toHaveTextContent(
      'שחק משחק מדורג, והיריבים שלך יופיעו כאן.',
      { exact: false },
    );
    expect(screen.getByRole('button', { name: 'הזמן חברים' })).toBeOnTheScreen();
    expect(screen.queryByTestId('leaderboard-friends-empty-code')).toBeNull();
  });

  it('signed out: says so, with nothing to retry', async () => {
    await show(null);
    expect(screen.getByRole('header', { name: 'צריך להתחבר כדי לראות את זה' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'נסה שוב' })).toBeNull();
  });

  it('a table read before stays when the next read fails, with a note and "נסה שוב"', async () => {
    const api = fakeProgressApi({ tabs: { general: ranked(5) }, me: entry({ id: 'me', rank: 9 }) });
    await show(api);
    api.failWith = 'network';
    await act(async () => {
      screen.getByTestId('leaderboard-list').props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(screen.getByTestId('leaderboard-row-p4')).toBeOnTheScreen();
    expect(screen.getByTestId('leaderboard-note-offline')).toBeOnTheScreen();
    expect(screen.queryByTestId('leaderboard-offline')).toBeNull();
  });

  it('speaks English: loading, offline with its code, the friends empty state', async () => {
    await i18n.changeLanguage('en');
    const { api, release } = heldApi();
    await show(api);
    expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeOnTheScreen();
    await release();

    const offline = fakeProgressApi();
    offline.failWith = 'timeout';
    await show(offline);
    expect(screen.getByTestId('leaderboard-offline-title')).toHaveTextContent('No connection to the server');
    expect(screen.getByTestId('leaderboard-offline-code')).toHaveAccessibleName('Error code: timeout');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();

    await show(fakeProgressApi({ friends: { recentOpponents: [], inviteUrl: null } }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Friends' }));
    await settle();
    expect(screen.getByTestId('leaderboard-friends-empty-title')).toHaveTextContent('No opponents yet');
    expect(screen.getByRole('button', { name: 'Play' })).toBeOnTheScreen();
  });
});

describe('leaderboard skeleton motion (motion.md skeleton)', () => {
  it('pulses with full motion, and stands still at 0.7 with reduced motion', async () => {
    jest.useFakeTimers();
    try {
      useSettings.setState({ reduceMotion: 'off' });
      const { api } = heldApi();
      await render(
        <LeaderboardScreen
          api={() => api}
          myId="me"
          myAvatar="av07"
          myLeague={null}
          onOpenPlayer={jest.fn()}
          onPlay={jest.fn()}
          onTab={jest.fn()}
        />,
      );
      const blocks = () =>
        screen
          .getByTestId('leaderboard-loading')
          .queryAll((n) => typeof n.type === 'string' && n.props.jestAnimatedStyle !== undefined);
      expect(blocks().length).toBeGreaterThan(5);
      expect(blocks()[0]).toHaveAnimatedStyle({ opacity: SKELETON_OPACITY.low });
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      expect(blocks()[0]).toHaveAnimatedStyle({ opacity: SKELETON_OPACITY.high });

      await act(async () => {
        useSettings.setState({ reduceMotion: 'on' });
      });
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      for (const b of blocks()) expect(b).toHaveAnimatedStyle({ opacity: SKELETON_OPACITY.still });
    } finally {
      jest.useRealTimers();
    }
  });
});
