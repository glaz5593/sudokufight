// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { THINK_TIME_MS } from '@sudoku-fight/engine';
import { router } from 'expo-router';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { directionProblems } from '../../../components/ui/testing/layout';
import { useToast } from '../../../components/ui';
import { useGameStore } from '../../../game/gameStore';
import { openPracticeRepo, type PracticeRepo } from '../../../game/practiceRepo';
import { practiceStorageOrNull } from '../../../game/storage';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { useProfile } from '../../../state/profile';
import { renderApp } from '../testing/homeTesting';

type Mocks = typeof import('../testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../game/storage', () => jest.requireActual<Mocks>('../testing/nativeMocks').practiceStorage);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoHaptics);

const storage = jest.mocked(practiceStorageOrNull);
let repo: PracticeRepo;

beforeEach(async () => {
  jest.useRealTimers();
  repo = await openPracticeRepo(await memoryDb());
  storage.mockImplementation(async () => repo);
  useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null });
  useToast.getState().clear();
  await i18n.changeLanguage('he');
});

afterEach(() => {
  useGameStore.getState().clear();
  jest.useRealTimers();
});

describe('"משחק חדש" (spec §5.1)', () => {
  it('offers exactly five modes; both practices are open, the three ranked ones say "בקרוב"', async () => {
    await renderApp('/modes');
    expect(screen.getByRole('header', { name: 'משחק חדש' })).toBeTruthy();
    const keys = ['ranked2', 'ranked3', 'ranked4', 'solo', 'bot'];
    const cards = keys.map((k) => screen.getByTestId(`mode-${k}`));
    expect(cards).toHaveLength(5);
    expect(cards.map((c) => c.props.accessibilityState.disabled)).toEqual([true, true, true, false, false]);
    for (const k of ['ranked2', 'ranked3', 'ranked4'])
      expect(screen.getByTestId(`soon-${k}`)).toHaveTextContent('בקרוב');
    expect(screen.queryByTestId('soon-solo')).toBeNull();
    expect(screen.queryByTestId('soon-bot')).toBeNull();
    expect(screen.getByTestId('mode-ranked2')).toHaveProp(
      'accessibilityLabel',
      'מדורג · 2 שחקנים, אחד על אחד · אותו לוח, דירוג, בקרוב',
    );
    expect(screen.getByTestId('mode-solo')).toHaveProp(
      'accessibilityLabel',
      'אימון לבד, בקצב שלך, ללא דירוג, עובד גם בלי אינטרנט',
    );
    expect(screen.getByTestId('mode-bot')).toHaveProp(
      'accessibilityLabel',
      'אימון מול בוט, 5 רמות, ללא דירוג, עובד גם בלי אינטרנט',
    );
    expect(directionProblems(screen.getByTestId('mode-solo'))).toEqual([]);
  });

  it('a mode that is not built yet does nothing', async () => {
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByTestId('mode-ranked2'));
    await fireEvent.press(screen.getByTestId('mode-ranked4'));
    expect(app.pathname()).toBe('/modes');
  });

  it('practice against a bot opens the game type of a bot practice, the last bot game type preselected', async () => {
    useProfile.setState({ lastPlay: { mode: 'bot', gameType: 'fast', botLevel: 2 } });
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByRole('button', { name: /^אימון מול בוט/ }));
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'bot', gameType: 'fast' });
    expect(screen.getByText('אימון מול בוט')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^מהיר\./ })).toHaveProp('accessibilityState', {
      checked: true,
    });
  });

  it('solo practice opens the game type, with the last game type preselected', async () => {
    useProfile.setState({ lastPlay: { mode: 'solo', gameType: 'hard' } });
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByRole('button', { name: /^אימון לבד/ }));
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'solo', gameType: 'hard' });
    expect(screen.getByRole('radio', { name: /^קשה\./ })).toHaveProp('accessibilityState', { checked: true });
  });

  it('the back button returns to Home', async () => {
    const app = await renderApp('/');
    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    expect(app.pathname()).toBe('/modes');
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    expect(app.pathname()).toBe('/');
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await renderApp('/modes');
    expect(screen.getByRole('header', { name: 'New game' })).toBeTruthy();
    expect(screen.getByTestId('mode-solo')).toHaveProp(
      'accessibilityLabel',
      'Solo practice, At your own pace, Unrated, Works offline',
    );
    expect(screen.getAllByText('Soon')).toHaveLength(3);
  });
});

describe('"סוג משחק" (spec §5.2)', () => {
  it('shows the three game types with their lock time, board and duration; normal by default', async () => {
    await renderApp('/game-type?mode=solo');
    expect(screen.getByRole('header', { name: 'סוג משחק' })).toBeTruthy();
    const group = screen.getByLabelText('סוג משחק', { exact: true });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.props.testID)).toEqual(['type-fast', 'type-normal', 'type-hard']);
    expect(radios.map((r) => r.props.accessibilityState.checked)).toEqual([false, true, false]);
    // The lock time comes from the rules (THINK_TIME_MS), never typed in the screen.
    for (const [type, ms] of Object.entries(THINK_TIME_MS))
      expect(screen.getByTestId(`type-${type}`)).toHaveTextContent(new RegExp(`${ms / 1000} ש׳`));
    expect(screen.getByTestId('type-fast')).toHaveProp(
      'accessibilityLabel',
      'מהיר. נפתר בבודד גלוי בלבד. זמן למשבצת 8 שניות, לוח קל, משך משוער 4 עד 6 דקות',
    );
    expect(screen.getByTestId('type-hard')).toHaveTextContent(/דורש זוגות או צמצומים/);
  });

  it('starts the chosen practice and the game screen takes its place', async () => {
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByTestId('mode-solo'));
    expect(app.pathname()).toBe('/game-type');

    await fireEvent.press(screen.getByRole('radio', { name: /^מהיר\./ }));
    expect(screen.getByTestId('type-fast')).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId('type-normal')).toHaveProp('accessibilityState', { checked: false });

    await fireEvent.press(screen.getByRole('button', { name: 'התחל אימון' }));
    await waitFor(() => expect(app.pathname()).toBe('/game'));
    const session = useGameStore.getState().session!;
    expect(session).toMatchObject({ mode: 'solo', gameType: 'fast' });
    expect(useProfile.getState().lastPlay).toEqual({ mode: 'solo', gameType: 'fast' });
    await session.flush();
    expect((await repo.getGame(session.id))?.gameType).toBe('fast');

    // The game replaced the game-type screen: back goes to the modes.
    await act(async () => {
      router.back();
    });
    expect(app.pathname()).toBe('/modes');
  });

  it('says so when the practice cannot start, and stays', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.mockImplementation(() => Promise.reject(new Error('disk full')));
    const app = await renderApp('/game-type?mode=solo&gameType=hard');
    await fireEvent.press(screen.getByTestId('start'));
    await waitFor(() =>
      expect(useToast.getState().current).toMatchObject({
        variant: 'error',
        message: 'לא הצלחנו להתחיל את המשחק. נסו שוב.',
      }),
    );
    expect(app.pathname()).toBe('/game-type');
    expect(screen.getByTestId('start')).toHaveProp('accessibilityState', { disabled: false, busy: false });
  });

  it('without a mode it is solo practice (the "משחק חדש" of the results names only the type)', async () => {
    await renderApp('/game-type?gameType=hard');
    expect(screen.getByText('אימון לבד')).toBeTruthy();
    expect(screen.getByTestId('type-hard')).toHaveProp('accessibilityState', { checked: true });
  });

  it('a mode it cannot start goes back to the modes', async () => {
    const app = await renderApp('/game-type?mode=ranked&gameType=fast');
    expect(app.pathname()).toBe('/modes');
  });

  it('for a bot practice, the button goes on to the bot selection with the chosen type; nothing starts yet', async () => {
    const app = await renderApp('/modes');
    await fireEvent.press(screen.getByTestId('mode-bot'));
    expect(app.searchParams()).toEqual({ mode: 'bot' });
    expect(screen.getByText(/בשלב הבא בוחרים יריב/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: /^קשה\./ }));
    const next = screen.getByRole('button', { name: 'בחירת יריב' });
    expect(next).toHaveProp('accessibilityHint', 'בחירת בוט למשחק קשה');
    await fireEvent.press(next);
    expect(app.pathname()).toBe('/bot-select');
    expect(app.searchParams()).toEqual({ gameType: 'hard' });
    expect(useGameStore.getState().session).toBeNull();

    // Back: the game type of the bot practice again.
    await act(async () => {
      router.back();
    });
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'bot' });
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await renderApp('/game-type?mode=solo&gameType=fast');
    expect(screen.getByRole('header', { name: 'Game type' })).toBeTruthy();
    expect(screen.getByText('Solo practice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start practice' })).toBeTruthy();
    expect(screen.getByTestId('type-fast')).toHaveProp(
      'accessibilityLabel',
      'Fast. Solved with naked singles only. 8 seconds per cell, Easy board, about 4 to 6 minutes',
    );
  });
});
