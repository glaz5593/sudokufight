// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { StyleSheet, Text } from 'react-native';

import { card as playerCard, myProgress } from '../../../api/testing/fakeProgress';
import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { installSignedInPlayer, type TestAuth } from '../../../auth/testing/testAuth';
import { metrics } from '../../../components/player/metrics';
import { directionProblems, PHONE, setWindow, textWidth } from '../../../components/ui/testing/layout';
import { openPracticeRepo } from '../../../game/practiceRepo';
import { practiceStorageOrNull } from '../../../game/storage';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { usePracticeHistory } from '../../../state/practiceHistory';
import { ltr } from '../../../components/player';
import { adoptCard, adoptProgress, forgetProgress } from '../../../progress/progressStore';
import { useProfile } from '../../../state/profile';
import { space, text, tokens } from '../../../theme';
import { GUTTER } from '../parts';
import { usePracticeStats } from '../practiceStats';
import { renderApp } from '../testing/homeTesting';

type Mocks = typeof import('../testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../game/storage', () => jest.requireActual<Mocks>('../testing/nativeMocks').practiceStorage);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../testing/nativeMocks').expoHaptics);

const hidden = { includeHiddenElements: true };
const EXTRA = {
  'edit-profile': () => <Text testID="stub-edit-profile">edit</Text>,
  'player/[id]': () => <Text testID="stub-player">player</Text>,
  'verify-email': () => <Text testID="stub-verify-email">verify</Text>,
};

let auth: TestAuth;

beforeEach(async () => {
  const repo = await openPracticeRepo(await memoryDb());
  jest.mocked(practiceStorageOrNull).mockImplementation(async () => repo);
  usePracticeHistory.setState({ recent: [], status: 'idle' });
  usePracticeStats.setState({ gamesPlayed: null, winRate: null, streak: null });
  useProfile.setState({ name: null, avatarId: 'av00', country: 'US', lastPlay: null, botLevel: null });
  await i18n.changeLanguage('he');
});
afterEach(() => {
  setAuthDeps(null);
  forgetProgress();
});

describe('Home with an account (stage 8)', () => {
  it('the card is the account’s: name, flag, ratings 1200 provisional [D23], and opens my player card', async () => {
    auth = await installSignedInPlayer({ displayName: 'MosheG', avatarId: 'sun', country: 'IL' });
    await initAuth();
    const app = await renderApp('/', EXTRA);
    const card = await screen.findByTestId('profile-card');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('MosheG');
    expect(within(card).getByTestId('flag-IL', hidden)).toBeTruthy();
    expect(screen.getByTestId('profile-league')).toHaveTextContent('דירוג זמני: 10 המשחקים הראשונים');
    for (const type of ['fast', 'normal', 'hard']) {
      expect(within(card).getByTestId(`rating-${type}`)).toHaveTextContent(/1200זמני$/);
    }
    expect(card).toHaveProp(
      'accessibilityLabel',
      'כרטיס השחקן שלי: MosheG, ישראל, דירוג זמני: 10 המשחקים הראשונים, דירוג מהיר 1200, זמני, ' +
        'דירוג רגיל 1200, זמני, דירוג קשה 1200, זמני, 0 משחקים',
    );
    expect(card).toHaveProp('accessibilityRole', 'button');
    expect(card).toHaveProp('accessibilityHint', 'פתיחת כרטיס השחקן');
    // The game screens' "me" follows the account.
    expect(useProfile.getState()).toMatchObject({ name: 'MosheG', avatarId: 'sun', country: 'IL' });

    // Stage 12 (spec §4.2): the card opens my player card.
    await fireEvent.press(card);
    expect(app.pathname()).toBe(`/player/${useAuth.getState().me!.id}`);
  });

  it('stage 12: my level, the XP bar and my league from my progress; my card’s numbers', async () => {
    auth = await installSignedInPlayer({ displayName: 'MosheG', avatarId: 'sun', country: 'IL' });
    await initAuth();
    const { user, me } = useAuth.getState();
    adoptProgress(user!.uid, myProgress(), 1);
    adoptCard(user!.uid, playerCard({ id: me!.id }), 1);
    await renderApp('/', EXTRA);
    const card = await screen.findByTestId('profile-card');
    expect(within(card).getByTestId('league-gold')).toHaveTextContent('ליגת זהב · רמה 14');
    expect(within(card).getByTestId('profile-xp')).toHaveTextContent(ltr('2,380 / 3,000 XP'));
    expect(within(card).getByTestId('stat-games')).toHaveTextContent('86משחקים');
    expect(within(card).getByTestId('stat-wins')).toHaveTextContent(`${ltr('57%')}ניצחונות`);
    expect(within(card).getByTestId('stat-streak')).toHaveTextContent('3רצף');
    expect(card).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`ליגת זהב, רמה 14 · ${ltr('2,380 / 3,000 XP')}`),
    );
  });

  it('stage 12: before a league, "בדירוג זמני" with my level', async () => {
    auth = await installSignedInPlayer();
    await initAuth();
    adoptProgress(
      useAuth.getState().user!.uid,
      myProgress({ league: null, leagueRating: null, level: 2 }),
      1,
    );
    await renderApp('/', EXTRA);
    await screen.findByTestId('profile-card');
    expect(screen.getByTestId('profile-league')).toHaveTextContent('בדירוג זמני · רמה 2');
  });

  it('a settled rating shows its league [D9]', async () => {
    auth = await installSignedInPlayer();
    await initAuth();
    const me = useAuth.getState().me!;
    useAuth.setState({
      me: {
        ...me,
        ratings: [
          { key: 'fast', rating: 1342, games: 30, provisional: false, peak: 1350 },
          { key: 'normal', rating: 1287, games: 12, provisional: false, peak: 1300 },
          { key: 'hard', rating: 1198, games: 4, provisional: true, peak: 1210 },
        ],
      },
    });
    await renderApp('/', EXTRA);
    const card = await screen.findByTestId('profile-card');
    expect(within(card).getByTestId('league-gold')).toHaveTextContent('ליגת זהב');
    expect(within(card).getByTestId('rating-fast')).toHaveTextContent(/1342$/);
    expect(within(card).getByTestId('rating-hard')).toHaveTextContent(/1198זמני$/);
  });

  it('on the phone, "זמני" sits under its number and every rating fits its column (Moshe’s device test)', async () => {
    const restore = setWindow(PHONE);
    try {
      auth = await installSignedInPlayer();
      await initAuth();
      await renderApp('/', EXTRA);
      const card = await screen.findByTestId('profile-card');
      for (const type of ['fast', 'normal', 'hard']) {
        const rating = within(card).getByTestId(`rating-${type}-value`, hidden);
        const stack = rating.children[0] as typeof rating;
        expect(StyleSheet.flatten(stack.props.style).flexDirection).toBeUndefined();
        expect(within(stack).getByTestId(`rating-${type}-value-provisional`, hidden)).toHaveTextContent(
          'זמני',
        );
        expect(within(stack).getByText('1200', hidden)).toHaveProp('numberOfLines', 1);
      }
      // A column is a third of the card. The number fits it, and so does the chip under it; side by side, as
      // the first APK drew them, they did not.
      const home = tokens.layout.home;
      const column =
        (PHONE.width - 2 * GUTTER.home - 2 * home.profileCardPadding - 2 * tokens.border.hairline) / 3;
      const number = textWidth('1200', text('rating').fontSize!, { font: 'Teko' });
      const chip =
        textWidth('זמני', text('plateNameCompact').fontSize!) +
        2 * metrics.rating.provisionalPaddingX +
        2 * tokens.border.hairline;
      expect(number).toBeLessThanOrEqual(column);
      expect(chip).toBeLessThanOrEqual(column);
      expect(number + space[2] + chip).toBeGreaterThan(column);
    } finally {
      await restore();
    }
  });

  it('an unverified email: the banner under the card leads to /verify-email [D22]', async () => {
    auth = await installSignedInPlayer({ emailVerified: false });
    await initAuth();
    const app = await renderApp('/', EXTRA);
    const banner = await screen.findByTestId('verify-banner');
    expect(banner).toHaveProp('accessibilityLabel', 'המייל שלך עוד לא מאומת. לאימות המייל');
    expect(directionProblems(screen.getByTestId('home-scroll'))).toEqual([]);
    await fireEvent.press(banner);
    expect(app.pathname()).toBe('/verify-email');
  });

  it('a verified email: no banner', async () => {
    auth = await installSignedInPlayer();
    await initAuth();
    await renderApp('/', EXTRA);
    await screen.findByTestId('profile-card');
    expect(screen.queryByTestId('verify-banner')).toBeNull();
  });

  it('opened offline on the saved profile, Home asks the server again', async () => {
    auth = await installSignedInPlayer();
    await initAuth();
    useAuth.setState({ meOffline: true });
    const before = auth.server.calls.length;
    await renderApp('/', EXTRA);
    await waitFor(() => expect(useAuth.getState().meOffline).toBe(false));
    expect(auth.server.calls.slice(before)).toEqual(['GET /v1/me']);
  });

  it('speaks English too', async () => {
    await i18n.changeLanguage('en');
    auth = await installSignedInPlayer({ displayName: 'MosheG', emailVerified: false });
    await initAuth();
    await renderApp('/', EXTRA);
    const card = await screen.findByTestId('profile-card');
    expect(card).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(
        /^My player card: MosheG, Israel, Provisional rating: your first 10 games, Fast rating 1200, provisional/,
      ),
    );
    expect(screen.getByTestId('verify-banner')).toHaveTextContent(/Your email isn't verified yet/);
  });
});
