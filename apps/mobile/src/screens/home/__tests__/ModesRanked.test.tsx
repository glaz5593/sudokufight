// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { ManualClock, ManualScheduler } from '@sudoku-fight/engine';
import type { Me } from '@sudoku-fight/protocol';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import MatchRoute from '../../../../app/match/index';
import { useAuth } from '../../../auth/authStore';
import { useToast } from '../../../components/ui';
import { useGameStore } from '../../../game/gameStore';
import { openPracticeRepo } from '../../../game/practiceRepo';
import { practiceStorageOrNull } from '../../../game/storage';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { setHealthCheck } from '../../../net/connectivity';
import { deviceMatchmakingDeps } from '../../../net/matchmakingDevice';
import { FakeMatchmaking } from '../../../net/testing/fakeMatchmaking';
import { FakeTable } from '../../../net/testing/fakeServer';
import { useProfile } from '../../../state/profile';
import { useSettings } from '../../../state/settings';
import { renderApp } from '../testing/homeTesting';

/**
 * Ranked 2 players from the home screens (work plan stage 9): the Modes card with my rating, the game type
 * of a ranked game, "מצא יריב" (a verified email first, config/account.ts [D22]), the match screen; Home's
 * "עוד סיבוב" for a ranked setting; and Modes without a connection (spec §16.1): dimmed ranked cards,
 * the banner, "עבור לאימון", "בדוק שוב" and the background check.
 */

type Mocks = typeof import('../testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../game/storage', () => jest.requireActual<Mocks>('../testing/nativeMocks').practiceStorage);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoHaptics);
// The phone's wiring brings the network SDK: a fake matchmaking server instead.
jest.mock('../../../net/matchmakingDevice', () => ({ deviceMatchmakingDeps: jest.fn() }));

const storage = jest.mocked(practiceStorageOrNull);
const wiring = jest.mocked(deviceMatchmakingDeps);

const ME_ACCOUNT: Me = {
  id: 'me',
  displayName: 'MosheG',
  avatarId: 'lava-lamp',
  country: 'IL',
  email: 'moshe@example.com',
  emailVerified: true,
  createdAt: 0,
  displayNameChangedAt: null,
  nextRenameAt: null,
  ratings: [
    { key: 'fast', rating: 1240, games: 3, provisional: true, peak: 1240 },
    { key: 'normal', rating: 1287, games: 14, provisional: false, peak: 1300 },
    { key: 'hard', rating: 1200, games: 0, provisional: true, peak: 1200 },
  ],
};

function signIn(emailVerified = true) {
  useAuth.setState({
    status: 'ready',
    provider: 'dev',
    user: { uid: 'u1', email: 'moshe@example.com', emailVerified, methods: ['password'] },
    me: { ...ME_ACCOUNT, emailVerified },
    meOffline: false,
  });
}

/** The fake matchmaking server the mocked wiring hands out. */
function fakeWiring() {
  const table = new FakeTable();
  const clock = new ManualClock(1_000_000);
  const mm = new FakeMatchmaking(clock, new ManualScheduler(clock));
  wiring.mockImplementation(() => ({
    connector: mm,
    clock,
    scheduler: mm.scheduler,
    makeHost: () => table.host,
  }));
  return mm;
}

const routes = {
  'match/index': () => <MatchRoute />,
  'verify-email': () => <Text testID="stub-verify">verify</Text>,
};

beforeEach(async () => {
  jest.useRealTimers();
  const repo = await openPracticeRepo(await memoryDb());
  storage.mockImplementation(async () => repo);
  useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null, botLevel: null });
  useSettings.setState({ reduceMotion: 'off' });
  useToast.getState().clear();
  signIn();
  await i18n.changeLanguage('he');
});

afterEach(() => {
  useGameStore.getState().clear();
  setHealthCheck(null);
  useAuth.setState({ status: 'loading', user: null, me: null });
  wiring.mockReset();
  jest.useRealTimers();
});

describe('ranked 2 players (stage 9)', () => {
  it('shows my rating in the type I play, opens the ranked game type, and "מצא יריב" searches', async () => {
    const mm = fakeWiring();
    const app = await renderApp('/modes', routes);
    expect(screen.getByTestId('rating-ranked2')).toHaveTextContent('דירוג 1287 · רגיל');
    expect(screen.getByTestId('mode-ranked2')).toHaveProp(
      'accessibilityLabel',
      'מדורג · 2 שחקנים, אחד על אחד · אותו לוח, הדירוג שלך במשחק רגיל: 1287',
    );

    await fireEvent.press(screen.getByTestId('mode-ranked2'));
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'ranked', players: '2' });
    expect(screen.getByText('מדורג · 2 שחקנים')).toBeOnTheScreen();
    expect(screen.getByText(/יריב קרוב לדירוג שלך/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: /^מהיר\./ }));
    const start = screen.getByRole('button', { name: 'מצא יריב' });
    expect(start).toHaveProp('accessibilityHint', 'מחפש יריב למשחק מדורג מהיר');
    await fireEvent.press(start);

    expect(app.pathname()).toBe('/match');
    const match = useGameStore.getState().match!;
    expect(match.queueKey).toBe('fast-2p');
    expect(mm.joins).toEqual(['fast-2p']);
    expect(useProfile.getState().lastPlay).toEqual({ mode: 'ranked', gameType: 'fast', players: 2 });
    await act(async () => mm.searching());
    expect(screen.getByRole('header')).toHaveTextContent('מחפש יריב…');
    expect(screen.getByTestId('match-search-header')).toHaveTextContent('מדורג · 2 שחקנים · מהיר');

    // "ביטול חיפוש": out of the queue, back to the game type.
    await fireEvent.press(screen.getByRole('button', { name: 'ביטול חיפוש' }));
    expect(mm.room.sent).toEqual([{ type: 'cancel' }]);
    await waitFor(() => expect(app.pathname()).toBe('/game-type'));
    expect(useGameStore.getState().match).toBeNull();
  });

  it('the ranked game type shows my rating in each type, as the GameType board ("הדירוג שלך")', async () => {
    fakeWiring();
    await renderApp('/game-type?mode=ranked&players=2', routes);
    expect(screen.getByTestId('type-normal-rating')).toHaveTextContent(/^הדירוג שלך1287$/);
    // The first 10 games in a type are provisional (spec §11.2).
    expect(screen.getByTestId('type-fast-rating')).toHaveTextContent(/^הדירוג שלך1240זמני$/);
    expect(screen.getByRole('radio', { name: /^רגיל\./ })).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/, הדירוג שלך במשחק רגיל: 1287$/),
    );
    expect(screen.getByRole('radio', { name: /^מהיר\./ })).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/, הדירוג שלך במשחק מהיר: 1240, זמני$/),
    );

    // A practice has no rating to show.
    await renderApp('/game-type?mode=solo', routes);
    expect(screen.queryByTestId('type-normal-rating')).toBeNull();

    // English.
    await i18n.changeLanguage('en');
    await renderApp('/game-type?mode=ranked&players=2', routes);
    expect(screen.getByTestId('type-hard-rating')).toHaveTextContent(/^Your rating1200Provisional$/);
    expect(screen.getByRole('radio', { name: /^Normal\./ })).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/, Your Normal rating is 1287$/),
    );
  });

  it('an unverified email gets the verification screen instead of a search [D22]', async () => {
    fakeWiring();
    signIn(false);
    const app = await renderApp('/game-type?mode=ranked&players=2&gameType=normal', routes);
    await fireEvent.press(screen.getByRole('button', { name: 'מצא יריב' }));
    expect(app.pathname()).toBe('/verify-email');
    expect(useGameStore.getState().match).toBeNull();
    expect(wiring).not.toHaveBeenCalled();
    expect(useToast.getState().current).toMatchObject({
      variant: 'info',
      message: 'כדי לשחק במדורג צריך לאמת את כתובת המייל.',
    });
  });

  it('Home\'s "עוד סיבוב" after a ranked game searches the same queue', async () => {
    const mm = fakeWiring();
    useProfile.setState({ lastPlay: { mode: 'ranked', gameType: 'hard', players: 2 } });
    const app = await renderApp('/', routes);
    const again = await screen.findByTestId('play-again');
    expect(again).toHaveTextContent(/מדורג · 2 שחקנים · קשה/);
    await fireEvent.press(again);
    await waitFor(() => expect(app.pathname()).toBe('/match'));
    expect(mm.joins).toEqual(['hard-2p']);
  });

  it('the match screen with no search goes back to the modes', async () => {
    const app = await renderApp('/match', routes);
    await waitFor(() => expect(app.pathname()).toBe('/modes'));
  });
});

describe('ranked 3 and 4 players (stage 10)', () => {
  it('each card shows my rating in its own queue’s key, and "מצא יריבים" searches that table', async () => {
    const mm = fakeWiring();
    // RATING_OPTION A (spec §11.1): a rating per type and table.
    const entry = (key: string, rating: number) => ({
      key,
      rating,
      games: 12,
      provisional: false,
      peak: rating,
    });
    useAuth.setState({
      me: {
        ...ME_ACCOUNT,
        ratings: [entry('normal-2p', 1310), entry('normal-3p', 1190), entry('normal-4p', 1255)],
      },
    });
    const app = await renderApp('/modes', routes);
    expect(screen.getByTestId('rating-ranked2')).toHaveTextContent('דירוג 1310 · רגיל');
    expect(screen.getByTestId('rating-ranked3')).toHaveTextContent('דירוג 1190 · רגיל');
    expect(screen.getByTestId('rating-ranked4')).toHaveTextContent('דירוג 1255 · רגיל');
    expect(screen.getByTestId('mode-ranked4')).toHaveProp(
      'accessibilityLabel',
      'מדורג · 4 שחקנים, כולם נגד כולם, הדירוג שלך במשחק רגיל: 1255',
    );

    await fireEvent.press(screen.getByTestId('mode-ranked4'));
    expect(app.searchParams()).toEqual({ mode: 'ranked', players: '4' });
    await fireEvent.press(screen.getByRole('radio', { name: /^מהיר\./ }));
    await fireEvent.press(screen.getByRole('button', { name: 'מצא יריבים' }));
    expect(app.pathname()).toBe('/match');
    expect(mm.joins).toEqual(['fast-4p']);
    expect(useProfile.getState().lastPlay).toEqual({ mode: 'ranked', gameType: 'fast', players: 4 });
    await act(async () => mm.searching());
    expect(screen.getByTestId('match-search-header')).toHaveTextContent('מדורג · 4 שחקנים · מהיר');
    expect(screen.getByRole('header')).toHaveTextContent('מחפש יריבים…');
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(3);
  });
});

describe('no connection before a game (spec §16.1)', () => {
  it('dims the ranked cards, shows the banner, offers practice and another check, and comes back online', async () => {
    let online = false;
    let checks = 0;
    setHealthCheck(async () => {
      checks++;
      return online;
    });
    const app = await renderApp('/modes', routes);
    await screen.findByTestId('offline-banner');
    expect(screen.getByTestId('offline-banner')).toHaveAccessibleName(
      'אין חיבור לאינטרנט. משחקים מדורגים לא זמינים',
    );
    const ranked = screen.getByTestId('mode-ranked2');
    expect(ranked).toHaveProp('accessibilityState', { disabled: true });
    expect(ranked).toHaveProp(
      'accessibilityLabel',
      'מדורג · 2 שחקנים, אחד על אחד · אותו לוח, דירוג, דורש חיבור לאינטרנט',
    );
    expect(screen.getByTestId('offline-ranked2')).toHaveTextContent('דורש חיבור');
    // Every ranked table needs the connection, 3 and 4 players too (stage 10).
    for (const k of ['ranked3', 'ranked4']) {
      expect(screen.getByTestId(`mode-${k}`)).toHaveProp('accessibilityState', { disabled: true });
      expect(screen.getByTestId(`offline-${k}`)).toHaveTextContent('דורש חיבור');
    }
    expect(screen.getByText('זמין כשיש חיבור')).toBeOnTheScreen();
    expect(screen.getByText('זמין גם בלי אינטרנט')).toBeOnTheScreen();
    expect(screen.getByTestId('mode-solo')).toHaveProp('accessibilityState', { disabled: false });
    expect(screen.getByTestId('mode-solo')).toHaveProp(
      'accessibilityLabel',
      'אימון לבד · לוח מלא, בקצב שלך, ללא דירוג, זמין אופליין',
    );
    expect(screen.getByTestId('modes-live')).toHaveTextContent('אין חיבור לאינטרנט');

    // "בדוק שוב": still nothing, attempt 2.
    await fireEvent.press(screen.getByRole('button', { name: 'בדוק שוב' }));
    await screen.findByTestId('still-offline');
    expect(screen.getByTestId('still-offline')).toHaveTextContent('עדיין אין חיבור · ניסיון 2');
    expect(checks).toBe(2);

    // Back online: the ranked cards come back.
    online = true;
    await fireEvent.press(screen.getByRole('button', { name: 'בדוק שוב' }));
    await waitFor(() => expect(screen.queryByTestId('offline-banner')).not.toBeOnTheScreen());
    expect(screen.getByTestId('mode-ranked2')).toHaveProp('accessibilityState', { disabled: false });
    expect(screen.getByTestId('modes-live')).toHaveTextContent('החיבור חזר. משחקים מדורגים זמינים.');
    expect(app.pathname()).toBe('/modes');
  });

  it('"עבור לאימון" opens a solo practice’s game type', async () => {
    setHealthCheck(async () => false);
    const app = await renderApp('/modes', routes);
    await screen.findByTestId('offline-banner');
    await fireEvent.press(screen.getByRole('button', { name: 'עבור לאימון' }));
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'solo' });
  });

  it('checks again in the background while offline', async () => {
    jest.useFakeTimers();
    let checks = 0;
    setHealthCheck(async () => {
      checks++;
      return false;
    });
    await renderApp('/modes', routes);
    await act(async () => {
      await Promise.resolve();
    });
    expect(checks).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(checks).toBe(2);
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(checks).toBe(3);
  });

  it('speaks English, with reduced motion', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await i18n.changeLanguage('en');
    setHealthCheck(async () => false);
    await renderApp('/modes', routes);
    await screen.findByTestId('offline-banner');
    expect(screen.getByTestId('offline-banner')).toHaveAccessibleName(
      "No internet connection. Ranked games aren't available",
    );
    expect(screen.getByText('Available when online')).toBeOnTheScreen();
    expect(screen.getByTestId('offline-ranked2')).toHaveTextContent('Needs connection');
    expect(screen.getByRole('button', { name: 'Go to practice' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeOnTheScreen();
  });
});
