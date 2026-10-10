// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { initAuth, setAuthDeps, useAuth } from '../../../auth/authStore';
import { installSignedInPlayer, type TestAuth } from '../../../auth/testing/testAuth';
import { directionProblems } from '../../../components/ui/testing/layout';
import { openPracticeRepo } from '../../../game/practiceRepo';
import { practiceStorageOrNull } from '../../../game/storage';
import { memoryDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { usePracticeHistory } from '../../../state/practiceHistory';
import { useProfile } from '../../../state/profile';
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
afterEach(() => setAuthDeps(null));

describe('Home with an account (stage 8)', () => {
  it('the card is the account’s: name, flag, ratings 1200 provisional [D23], and opens the profile', async () => {
    auth = await installSignedInPlayer({ displayName: 'MosheG', avatarId: 'av05', country: 'IL' });
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
      'הכרטיס שלי: MosheG, ישראל, דירוג זמני: 10 המשחקים הראשונים, דירוג מהיר 1200, זמני, ' +
        'דירוג רגיל 1200, זמני, דירוג קשה 1200, זמני, 0 משחקים',
    );
    expect(card).toHaveProp('accessibilityRole', 'button');
    expect(card).toHaveProp('accessibilityHint', 'עריכת הפרופיל');
    // The game screens' "me" follows the account.
    expect(useProfile.getState()).toMatchObject({ name: 'MosheG', avatarId: 'av05', country: 'IL' });

    await fireEvent.press(card);
    expect(app.pathname()).toBe('/edit-profile');
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
