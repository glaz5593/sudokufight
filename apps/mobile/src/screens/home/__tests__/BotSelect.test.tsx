// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { router } from 'expo-router';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { directionProblems } from '../../../components/ui/testing/layout';
import { ltr } from '../../../components/player';
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

const storage = jest.mocked(practiceStorageOrNull);
let repo: PracticeRepo;

beforeEach(async () => {
  jest.useRealTimers();
  repo = await openPracticeRepo(await memoryDb());
  storage.mockImplementation(async () => repo);
  useProfile.setState({ name: null, avatarId: 'av00', country: 'IL', lastPlay: null, botLevel: null });
  useToast.getState().clear();
  await i18n.changeLanguage('he');
});

afterEach(() => {
  useGameStore.getState().clear();
  jest.useRealTimers();
});

const card = (level: number) => screen.getByTestId(`bot-${level}`);
const checkedLevels = () => [1, 2, 3, 4, 5].filter((l) => card(l).props.accessibilityState.checked === true);

describe('"בחר יריב בוט" (spec §4.1 #9, §9)', () => {
  it('shows the five bots of the engine: avatar, name, level title, how it plays, think time and mistakes', async () => {
    await renderApp('/bot-select?gameType=normal');
    expect(screen.getByRole('header', { name: 'בחר יריב בוט' })).toBeTruthy();
    expect(screen.getByText('אימון מול בוט · רגיל')).toBeTruthy();
    const group = screen.getByLabelText('בחר יריב בוט', { exact: true });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.props.testID),
    ).toEqual(['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5']);
    const names = [1, 2, 3, 4, 5].map((l) => screen.getByTestId(`bot-${l}-name`).props.children as string);
    expect(names).toEqual(['Pip', 'Biscuit', 'Mr. Hoot', 'Maestro', 'Overlord'].map(ltr));
    const titles = [1, 2, 3, 4, 5].map((l) => screen.getByTestId(`bot-${l}-title`));
    expect(titles.map((t) => t.props.children.props.children)).toEqual([
      '1 · טירון',
      '2 · חובב',
      '3 · מתקדם',
      '4 · מאסטר',
      '5 · גרנדמאסטר',
    ]);
    expect(screen.getByTestId('bot-1-think')).toHaveTextContent(`זמן חשיבה למהלך${ltr('8–11')} ש׳`);
    expect(screen.getByTestId('bot-1-mistakes')).toHaveTextContent(`טעויות${ltr('15%')}`);
    expect(screen.getByTestId('bot-5-mistakes')).toHaveTextContent(`טעויות${ltr('1%')}`);
    expect(card(4)).toHaveTextContent(/מהיר, כמעט לא טועה, וקצת שחצן 😎/);
    expect(card(1)).toHaveProp(
      'accessibilityLabel',
      'רמה 1, טירון: Pip. איטי, טועה לא מעט, וכמעט אף פעם לא מפריע. זמן חשיבה 8 עד 11 שניות למהלך, 15% טעויות',
    );
    // The avatars of the level table, never typed in the screen.
    expect([1, 2, 3, 4, 5].map((l) => avatarsIn(card(l)))).toEqual([
      ['av44'],
      ['av42'],
      ['av49'],
      ['av39'],
      ['av40'],
    ]);
    expect(screen.getByText('ללא דירוג')).toBeTruthy();
    expect(screen.getByText('עובד גם בלי אינטרנט')).toBeTruthy();
    expect(directionProblems(card(3))).toEqual([]);
  });

  it('times the bots for a fast game: the table × 0.67 (spec §9)', async () => {
    await renderApp('/bot-select?gameType=fast');
    expect(screen.getByTestId('bot-1-think')).toHaveTextContent(ltr('5.4–7.4'), { exact: false });
    expect(screen.getByTestId('bot-5-think')).toHaveTextContent(ltr('1.3–2.7'), { exact: false });
    expect(card(1)).toHaveProp('accessibilityLabel', expect.stringContaining('זמן חשיבה 5.4 עד 7.4 שניות'));
  });

  it('times the bots for a hard game: the table × 1.5 (spec §9)', async () => {
    await renderApp('/bot-select?gameType=hard');
    expect(screen.getByText('אימון מול בוט · קשה')).toBeTruthy();
    expect(screen.getByTestId('bot-1-think')).toHaveTextContent(ltr('12–16.5'), { exact: false });
    expect(screen.getByTestId('bot-4-think')).toHaveTextContent(ltr('4.5–7.5'), { exact: false });
  });

  it('opens on Mr. Hoot the first time, and a tap chooses another', async () => {
    await renderApp('/bot-select?gameType=fast');
    expect(checkedLevels()).toEqual([3]);
    await fireEvent.press(card(1));
    expect(checkedLevels()).toEqual([1]);
    await fireEvent.press(card(1)); // again: stays
    expect(checkedLevels()).toEqual([1]);
  });

  it('opens on the level played last', async () => {
    useProfile.setState({ botLevel: 4 });
    await renderApp('/bot-select?gameType=fast');
    expect(checkedLevels()).toEqual([4]);
  });

  it('starts the practice against the chosen bot; the game takes the selection’s place', async () => {
    const app = await renderApp('/game-type?mode=bot&gameType=fast');
    await fireEvent.press(screen.getByRole('button', { name: 'בחירת יריב' }));
    expect(app.pathname()).toBe('/bot-select');

    await fireEvent.press(screen.getByRole('radio', { name: /Overlord/ }));
    const start = screen.getByRole('button', { name: 'יאללה, למשחק' });
    expect(start).toHaveProp('accessibilityHint', 'מתחיל אימון מהיר מול Overlord');
    await fireEvent.press(start);
    await waitFor(() => expect(app.pathname()).toBe('/game'));

    const session = useGameStore.getState().session!;
    expect(session).toMatchObject({ mode: 'bot', gameType: 'fast', botLevel: 5 });
    expect(session.getView().players.map((p) => p.id)).toEqual(['me', 'bot-5']);
    expect(useProfile.getState()).toMatchObject({
      lastPlay: { mode: 'bot', gameType: 'fast', botLevel: 5 },
      botLevel: 5,
    });
    await session.flush();
    expect(await repo.getGame(session.id)).toMatchObject({
      mode: 'bot',
      gameType: 'fast',
      opponents: [{ id: 'bot-5', name: 'Overlord', isBot: true }],
    });

    // The game replaced the bot selection: back goes to the game type.
    await act(async () => {
      router.back();
    });
    expect(app.pathname()).toBe('/game-type');
  });

  it('says so when the practice cannot start, and stays', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    storage.mockImplementation(() => Promise.reject(new Error('disk full')));
    const app = await renderApp('/bot-select?gameType=hard');
    await fireEvent.press(screen.getByTestId('start'));
    await waitFor(() =>
      expect(useToast.getState().current).toMatchObject({
        variant: 'error',
        message: 'לא הצלחנו להתחיל את המשחק. נסו שוב.',
      }),
    );
    expect(app.pathname()).toBe('/bot-select');
    expect(useGameStore.getState().session).toBeNull();
  });

  it('without a game type, goes back to the game type of a bot practice', async () => {
    const app = await renderApp('/bot-select?gameType=blitz');
    expect(app.pathname()).toBe('/game-type');
    expect(app.searchParams()).toEqual({ mode: 'bot' });
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    await renderApp('/bot-select?gameType=fast');
    expect(screen.getByRole('header', { name: 'Choose a bot' })).toBeTruthy();
    expect(screen.getByText('Practice vs bot · Fast')).toBeTruthy();
    expect(card(5)).toHaveProp(
      'accessibilityLabel',
      'Level 5, Grandmaster: Overlord. Fast, precise, and interferes without mercy. Thinks 1.3 to 2.7 seconds a move, 1% mistakes',
    );
    expect(screen.getByRole('button', { name: "Let's play" })).toBeTruthy();
  });
});
