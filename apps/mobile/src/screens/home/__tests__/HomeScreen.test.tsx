// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { router } from 'expo-router';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { ltr, scoreText } from '../../../components/player';
import { directionProblems } from '../../../components/ui/testing/layout';
import { useGameStore } from '../../../game/gameStore';
import { openPracticeRepo, type PracticeRepo } from '../../../game/practiceRepo';
import { practiceStorageOrNull } from '../../../game/storage';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { usePracticeHistory } from '../../../state/practiceHistory';
import { useProfile } from '../../../state/profile';
import { HomeScreen } from '../HomeScreen';
import { usePracticeStats } from '../practiceStats';
import { renderApp } from '../testing/homeTesting';
import { seedBotPractices, seedPractices } from '../testing/seed';

type Mocks = typeof import('../testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../game/storage', () => jest.requireActual<Mocks>('../testing/nativeMocks').practiceStorage);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoHaptics);
// Every avatar a source of its own, so a test can tell which one an image shows (Metro's asset ids in the app).
jest.mock('../../../assets/avatars', () => {
  const actual = jest.requireActual<typeof import('../../../assets/avatars')>('../../../assets/avatars');
  return {
    ...actual,
    AVATARS: Object.fromEntries(Object.keys(actual.AVATARS).map((id) => [id, { uri: id }])),
  };
});

type Node = ReturnType<typeof screen.getByTestId>;
/** The avatar ids of every image under an element (the mocked sources are `{ uri: id }`). */
function avatarsIn(el: Node): string[] {
  const sources = ([] as unknown[]).concat(el.props.source ?? []) as { uri?: unknown }[];
  const own = sources.flatMap((s) => (typeof s?.uri === 'string' ? [s.uri] : []));
  return [...own, ...el.children.flatMap((c) => (typeof c === 'string' ? [] : avatarsIn(c)))];
}
const hidden = { includeHiddenElements: true };

const storage = jest.mocked(practiceStorageOrNull);

let repo: PracticeRepo;

beforeEach(async () => {
  jest.useRealTimers();
  repo = await openPracticeRepo(await memoryDb());
  storage.mockImplementation(async () => repo);
  usePracticeHistory.setState({ recent: [], status: 'idle' });
  usePracticeStats.setState({ gamesPlayed: null, winRate: null, streak: null });
  useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null, botLevel: null });
  await i18n.changeLanguage('he');
});

afterEach(() => {
  useGameStore.getState().clear();
  jest.useRealTimers();
});

describe('Home (spec §4.3)', () => {
  it('without saved games: the player card, "שחק", an empty list and the bottom navigation', async () => {
    await renderApp();
    expect(await screen.findByTestId('recent-empty')).toHaveTextContent(/עוד אין משחקים כאן/);

    const card = screen.getByTestId('profile-card');
    expect(card).toHaveProp('accessibilityLabel', 'הכרטיס שלי: שחקן, ישראל, עוד אין דירוג, 0 משחקים');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('שחקן');
    expect(within(card).getByTestId('stat-games')).toHaveTextContent('0משחקים');
    expect(within(card).getByTestId('rating-normal')).toHaveTextContent('רגיל—');
    expect(screen.getByRole('header', { name: 'סודוקו פייט' })).toBeTruthy();

    expect(screen.getByRole('button', { name: 'שחק' })).toBeTruthy();
    // Nothing to repeat yet.
    expect(screen.queryByTestId('play-again')).toBeNull();
    expect(screen.getByRole('tab', { name: 'בית' })).toHaveProp('accessibilityState', { selected: true });
    expect(directionProblems(screen.getByTestId('home-scroll'))).toEqual([]);
  });

  it('lists the saved practices, newest first, the interrupted one marked, each opening its results', async () => {
    const { ended, interrupted } = await seedPractices(repo);
    const app = await renderApp();

    const list = await screen.findByTestId('recent-list');
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.props.testID)).toEqual([`recent-${interrupted}`, `recent-${ended}`]);
    expect(within(rows[0]!).getByTestId(`interrupted-${interrupted}`)).toHaveTextContent('הופסק');
    expect(rows[0]).toHaveProp('accessibilityLabel', expect.stringMatching(/^אימון לבד · קשה, הופסק, /));
    expect(rows[1]).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^אימון לבד · מהיר, הסתיים, \d+ נקודות?, אין טעויות, /),
    );
    await waitFor(() => expect(screen.getByTestId('stat-games')).toHaveTextContent('2משחקים'));

    // "עוד סיבוב" repeats the newest game's setting when none is remembered.
    expect(screen.getByTestId('play-again')).toHaveProp('accessibilityLabel', 'עוד סיבוב, אימון לבד · קשה');

    await fireEvent.press(rows[1]!);
    expect(app.pathname()).toBe(`/results/${ended}`);
  });

  it('"שחק" opens the game modes, the settings button the settings', async () => {
    const app = await renderApp();
    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    expect(app.pathname()).toBe('/modes');

    await act(async () => {
      router.back();
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'הגדרות' }));
    expect(app.pathname()).toBe('/settings');
  });

  it('"עוד סיבוב" starts the remembered practice straight away and opens the game', async () => {
    useProfile.setState({ lastPlay: { mode: 'solo', gameType: 'hard' } });
    const app = await renderApp();
    const again = await screen.findByTestId('play-again');
    expect(again).toHaveProp('accessibilityLabel', 'עוד סיבוב, אימון לבד · קשה');

    await fireEvent.press(again);
    await waitFor(() => expect(app.pathname()).toBe('/game'));
    const session = useGameStore.getState().session;
    expect(session).toMatchObject({ mode: 'solo', gameType: 'hard' });
    expect(useProfile.getState().lastPlay).toEqual({ mode: 'solo', gameType: 'hard' });
    await session!.flush();
    expect((await repo.getGame(session!.id))?.status).toBe('playing');
  });

  it('coming back home closes a game left open (saved as interrupted) and shows it in the list', async () => {
    useProfile.setState({ lastPlay: { mode: 'solo', gameType: 'fast' } });
    const app = await renderApp();
    await fireEvent.press(await screen.findByTestId('play-again'));
    await waitFor(() => expect(app.pathname()).toBe('/game'));
    const id = useGameStore.getState().session!.id;

    await act(async () => {
      router.back();
    });
    expect(app.pathname()).toBe('/');
    expect(await screen.findByTestId(`interrupted-${id}`)).toBeTruthy();
    expect(useGameStore.getState().session).toBeNull();
    expect((await repo.getGame(id))?.status).toBe('interrupted');
  });

  it('says so when the saved games cannot be read', async () => {
    storage.mockImplementation(async () => null);
    await renderApp();
    expect(await screen.findByTestId('recent-unavailable')).toHaveTextContent(
      'לא הצלחנו לקרוא את המשחקים השמורים במכשיר.',
    );
    expect(screen.getByTestId('stat-games')).toHaveTextContent('—משחקים');
  });

  it('the bottom navigation goes to the other tabs and back home', async () => {
    const app = await renderApp();
    await fireEvent.press(screen.getByRole('tab', { name: 'טבלת מובילים' }));
    expect(app.pathname()).toBe('/leaderboard');
    expect(screen.getByTestId('placeholder-leaderboard')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'טבלת מובילים' })).toHaveProp('accessibilityState', {
      selected: true,
    });

    await fireEvent.press(screen.getByRole('tab', { name: 'היסטוריה' }));
    expect(app.pathname()).toBe('/history');
    await fireEvent.press(screen.getByRole('tab', { name: 'הישגים' }));
    expect(app.pathname()).toBe('/achievements');
    expect(screen.getByText('הישגים, רמות ו־XP יגיעו בקרוב.')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'בית' }));
    expect(app.pathname()).toBe('/');
    // Home stayed at the bottom of the stack: no tab is left behind it.
    expect(router.canGoBack()).toBe(false);
  });

  it('"הכל" opens the history tab', async () => {
    const app = await renderApp();
    await fireEvent.press(screen.getByRole('button', { name: 'הכל' }));
    expect(app.pathname()).toBe('/history');
    expect(screen.getByTestId('history')).toBeTruthy(); // stage 11: the real history tab
  });

  it('links to the dev screens in development builds only', async () => {
    const app = await renderApp();
    expect(screen.getByTestId('dev-links')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'בדיקת חיבור' }));
    expect(app.pathname()).toBe('/dev/hello');
    await act(async () => {
      router.back();
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'מערכת עיצוב' }));
    expect(app.pathname()).toBe('/dev/design-system');
  });

  it('has no dev links in release builds', async () => {
    await renderApp('/', { index: () => <HomeScreen devLinks={false} /> });
    expect(await screen.findByTestId('recent-empty')).toBeTruthy();
    expect(screen.queryByTestId('dev-links')).toBeNull();
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    useProfile.setState({ name: 'MosheG', lastPlay: { mode: 'solo', gameType: 'normal' } });
    await seedPractices(repo);
    await renderApp();
    await screen.findByTestId('recent-list');
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByTestId('play-again')).toHaveProp(
      'accessibilityLabel',
      'One more round, Solo practice · Normal',
    );
    expect(screen.getByText('Recent games')).toBeTruthy();
    expect(screen.getByText('Interrupted')).toBeTruthy();
    expect(screen.getByTestId('profile-card')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^My player card: MosheG, Israel, No rating yet/),
    );
    expect(screen.getByRole('tab', { name: 'Home' })).toBeTruthy();
  });
});

describe('Home with practices against a bot (stage 5)', () => {
  it('lists them with the bot’s avatar and the result: won, lost, interrupted', async () => {
    const { won, lost, interrupted } = await seedBotPractices(repo);
    const app = await renderApp();
    const list = await screen.findByTestId('recent-list');
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.props.testID)).toEqual([
      `recent-${interrupted}`,
      `recent-${lost}`,
      `recent-${won}`,
    ]);
    const wonGame = (await repo.getGame(won))!;
    expect(rows[2]).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(
        new RegExp(
          `^אימון מול בוט · מהיר, ניצחון מול ${ltr('Pip')}, ${literal(scoreText(wonGame.score!))} נקוד`,
        ),
      ),
    );
    expect(rows[1]).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(new RegExp(`^אימון מול בוט · רגיל, הפסד מול ${ltr('Maestro')}, `)),
    );
    expect(rows[0]).toHaveProp('accessibilityLabel', expect.stringMatching(/^אימון מול בוט · קשה, הופסק, /));

    // The bot's avatar, with the result badge of Dir-C-Home; none on a game that did not finish.
    expect(rows.map(avatarsIn)).toEqual([['av42'], ['av39'], ['av44']]);
    expect(within(rows[2]!).getByTestId('result-win', hidden)).toHaveTextContent('נ');
    expect(within(rows[1]!).getByTestId('result-loss', hidden)).toHaveTextContent('ה');
    expect(within(rows[0]!).queryByTestId('result-win', hidden)).toBeNull();
    expect(within(rows[0]!).queryByTestId('result-loss', hidden)).toBeNull();
    expect(within(rows[0]!).getByTestId(`interrupted-${interrupted}`)).toHaveTextContent('הופסק');
    expect(screen.getByTestId(`recent-${won}`)).toHaveTextContent(new RegExp(`ניצחון מול ${ltr('Pip')}`));
    expect(directionProblems(rows[2]!)).toEqual([]);

    await fireEvent.press(rows[2]!);
    expect(app.pathname()).toBe(`/results/${won}`);
  });

  it('the card shows the win rate and the win streak of the bot games [D28]', async () => {
    await seedBotPractices(repo);
    await renderApp();
    const card = screen.getByTestId('profile-card');
    // Won, then lost: half of the decided games, and the streak ended (the interrupted one counts for nothing).
    await waitFor(() =>
      expect(within(card).getByTestId('stat-wins')).toHaveTextContent(`${ltr('50%')}ניצחונות`),
    );
    expect(within(card).getByTestId('stat-streak')).toHaveTextContent('0רצף');
    expect(within(card).getByTestId('stat-games')).toHaveTextContent('3משחקים');
    expect(card).toHaveProp(
      'accessibilityLabel',
      'הכרטיס שלי: שחקן, ישראל, עוד אין דירוג, 3 משחקים, 50% ניצחונות, בלי רצף ניצחונות',
    );
  });

  it('without a decided game, the win rate and the streak are dashes', async () => {
    await seedPractices(repo);
    await renderApp();
    await waitFor(() => expect(screen.getByTestId('stat-games')).toHaveTextContent('2משחקים'));
    expect(screen.getByTestId('stat-wins')).toHaveTextContent('—ניצחונות');
    expect(screen.getByTestId('stat-streak')).toHaveTextContent('—רצף');
  });

  it('"עוד סיבוב" repeats a bot practice with its bot, named on the button', async () => {
    useProfile.setState({ lastPlay: { mode: 'bot', gameType: 'fast', botLevel: 2 }, botLevel: 2 });
    const app = await renderApp();
    const again = await screen.findByTestId('play-again');
    expect(again).toHaveProp('accessibilityLabel', `עוד סיבוב, אימון מול בוט · מהיר · ${ltr('Biscuit')}`);

    await fireEvent.press(again);
    await waitFor(() => expect(app.pathname()).toBe('/game'));
    const session = useGameStore.getState().session!;
    expect(session).toMatchObject({ mode: 'bot', gameType: 'fast', botLevel: 2 });
    expect(session.getView().players.map((p) => p.id)).toEqual(['me', 'bot-2']);
    expect(useProfile.getState().lastPlay).toEqual({ mode: 'bot', gameType: 'fast', botLevel: 2 });
  });

  it('"עוד סיבוב" without a remembered setting takes the newest game, a bot one with its bot', async () => {
    await seedBotPractices(repo);
    await renderApp();
    await screen.findByTestId('recent-list');
    // The newest saved game: hard, against Biscuit (interrupted).
    expect(screen.getByTestId('play-again')).toHaveProp(
      'accessibilityLabel',
      `עוד סיבוב, אימון מול בוט · קשה · ${ltr('Biscuit')}`,
    );
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    const { won } = await seedBotPractices(repo);
    await renderApp();
    await screen.findByTestId('recent-list');
    expect(screen.getByTestId(`recent-${won}`)).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(new RegExp(`^Practice vs bot · Fast, Won vs ${ltr('Pip')}, `)),
    );
    await waitFor(() =>
      expect(screen.getByTestId('profile-card')).toHaveProp(
        'accessibilityLabel',
        'My player card: Player, Israel, No rating yet, 3 games, 50% wins, No win streak',
      ),
    );
  });
});

/** A string as a literal piece of a RegExp. */
function literal(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
