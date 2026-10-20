// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { router, useLocalSearchParams } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import RootLayout from '../../app/_layout';
import { redirectSystemPath } from '../../app/+native-intent';
import NotFoundRoute from '../../app/+not-found';
import RoomByCodeRoute from '../../app/room/[code]';
import { RoomsApiError } from '../api/roomsApi';
import { registerProfile, signIn, useAuth } from '../auth/authStore';
import {
  pendingInviteCode,
  rememberInvite,
  rememberRoom,
  roomToResume,
  usePendingInvite,
} from '../auth/pendingInvite';
import { installSignedInPlayer, installTestAuth, TEST_PLAYER } from '../auth/testing/testAuth';
import { useToast } from '../components/ui/toastStore';
import { localGamesHeld } from '../game/backgroundPause';
import { useGameStore } from '../game/gameStore';
import i18n from '../i18n';
import { createFriendsRooms } from '../net/friends';
import { deviceFriendsDeps, setFriendsRooms } from '../net/friendsDevice';
import { FakeFriendsTable, FakeRoomsApi, FCODE } from '../net/testing/fakeFriends';
import { useSettings } from '../state/settings';

/**
 * Room links end to end (1.0.4, friends-room.md §6.5, §6.6, D88), through the real root layout (its auth gate and
 * InviteLinkPrompt) with stand-in screens: a link before the sign-in goes into the room right after it (and
 * after a registration); the app closed in a room goes back to it; a link while the app runs goes in, or asks
 * first over a practice (frozen), a search, another room or a game; a waiting invite asks at the game's end;
 * an unknown link leads home.
 */

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../services/telemetry', () => ({
  startTelemetry: jest.fn(),
  telemetry: () => ({ track: jest.fn() }),
}));
// The layout opens the practice database: here it never opens (and is not needed).
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: () => new Promise(() => undefined) }));
// The real room screen's sounds and haptics.
type Mocks = typeof import('../screens/home/testing/nativeMocks');
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').expoHaptics);

jest.setTimeout(60_000);

function stand(name: string) {
  return function StandIn() {
    return <Text testID={`screen-${name}`}>{name}</Text>;
  };
}

/** The room's route as app/room/[code].tsx gets it: its code, and `resume`. */
function RoomStandIn() {
  const { code, resume } = useLocalSearchParams<{ code: string; resume?: string }>();
  return <Text testID="screen-room">{`${code}${resume === '1' ? ' resume' : ''}`}</Text>;
}

const ROUTES = {
  _layout: RootLayout,
  index: stand('home'),
  modes: stand('modes'),
  login: stand('login'),
  'register/fighter': stand('fighter'),
  'choose-name': stand('choose-name'),
  game: stand('game'),
  match: stand('match'),
  'results/[id]': stand('results'),
  'friends/room': stand('friends-room'),
  'room/[code]': RoomStandIn,
  '+not-found': NotFoundRoute,
};

const STAGING_LINK = 'sudokufight://room/123456';

const toasts = () => {
  const { current, queue } = useToast.getState();
  return [current, ...queue].filter((t) => t !== null).map((t) => t.message);
};

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** A link while the app runs (app/+native-intent.tsx, as expo-router calls it). */
async function linkArrives(url = STAGING_LINK) {
  await act(async () => {
    expect(redirectSystemPath({ path: url, initial: false })).toBeNull();
  });
}

const question = () => screen.queryByTestId('room-link-question');
const answer = async (which: 'confirm' | 'cancel') => {
  await act(async () => fireEvent.press(screen.getByTestId(`room-link-question-${which}`)));
  await wait(1000);
};

/** What the game store holds, as far as the links read it (game/gameStore.ts; game/onlineSession.ts). */
function fakePractice(status = 'running') {
  return { getView: () => ({ status }), close: jest.fn() };
}
function fakeOnline(o: { kind?: string; code?: string | null; hasGame?: boolean; status?: string }) {
  const listeners = new Set<() => void>();
  const state = { over: false, status: o.status ?? 'live' };
  return {
    request: { kind: o.kind ?? 'match' },
    friendsCode: o.code ?? null,
    hasGame: o.hasGame ?? true,
    get online() {
      return { status: state.status, closeReason: null };
    },
    getView: () => ({ status: state.over ? 'over' : 'running' }),
    subscribeOnline: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    close: jest.fn(),
    end() {
      state.over = true;
      listeners.forEach((l) => l());
    },
  };
}
const hold = (part: Record<string, unknown>) => useGameStore.setState(part as never);

/** The app at `url` (renderRouter's render settles first). */
async function open(url: string, routes: Record<string, unknown> = ROUTES) {
  const app = renderRouter(routes as typeof ROUTES, { initialUrl: url });
  await app;
  return { pathname: () => app.getPathname() };
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ language: 'he', reduceMotion: 'on', sound: false, haptics: false });
  usePendingInvite.setState({
    invite: null,
    room: null,
    arrival: null,
    started: false,
    prompt: null,
    going: null,
  });
  useGameStore.setState({ session: null, online: null, match: null, view: null, lastUpdate: null });
  useToast.getState().clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a link before the sign-in goes into the room right after it [D88]', () => {
  it('signed out: the login first ("אחרי הכניסה נמשיך ישר לחדר"), then straight into the room', async () => {
    const auth = await installSignedInPlayer();
    await auth.provider.signOut();
    rememberInvite('123456');
    const app = await open('/room/123456');
    await screen.findByTestId('screen-login');
    expect(toasts()).toContain('אחרי הכניסה נמשיך ישר לחדר ⁦123 456⁩');

    await act(async () => signIn(TEST_PLAYER.email, TEST_PLAYER.password));
    await screen.findByTestId('screen-room');
    expect(app.pathname()).toBe('/room/123456');
    // Used up: the next sign-in goes home.
    expect(pendingInviteCode()).toBeNull();
  });

  it('a new player: the registration first, then the room', async () => {
    const auth = installTestAuth();
    await auth.provider.signUp('new@example.com', 'Arena1234');
    rememberInvite('654321');
    const app = await open('/room/654321');
    await screen.findByTestId('screen-fighter');

    await act(async () =>
      registerProfile({ displayName: 'Newbie', avatarId: TEST_PLAYER.avatarId, country: 'IL' }),
    );
    await screen.findByTestId('screen-room');
    expect(app.pathname()).toBe('/room/654321');
  });

  it('an invite past its 60 minutes: Home after the sign-in, and "ההזמנה … פגה"', async () => {
    const auth = await installSignedInPlayer();
    await auth.provider.signOut();
    rememberInvite('123456', Date.now() - 61 * 60_000);
    const app = await open('/');
    await screen.findByTestId('screen-login');
    await act(async () => signIn(TEST_PLAYER.email, TEST_PLAYER.password));
    await screen.findByTestId('screen-home');
    expect(app.pathname()).toBe('/');
    await waitFor(() => expect(toasts()).toContain('ההזמנה לחדר ⁦123 456⁩ פגה'));
    expect(usePendingInvite.getState().invite).toBeNull();
  });

  it('signed in, the link opening the app: its room at once', async () => {
    await installSignedInPlayer();
    rememberInvite('123456');
    const app = await open('/room/123456');
    await screen.findByTestId('screen-room');
    expect(app.pathname()).toBe('/room/123456');
    await waitFor(() => expect(pendingInviteCode()).toBeNull());
  });
});

describe('the app closed in a room goes back to it (§6.5)', () => {
  it('the same account: from Home into /room/<code>?resume=1, once', async () => {
    const auth = await installSignedInPlayer();
    const uid = auth.provider.currentUser()!.uid;
    rememberRoom('123456', uid);
    const app = await open('/');
    await screen.findByTestId('screen-room');
    expect(screen.getByTestId('screen-room')).toHaveTextContent('123456 resume');
    expect(app.pathname()).toBe('/room/123456');
    await act(async () => router.back());
    await screen.findByTestId('screen-home');
    await wait(1000);
    expect(app.pathname()).toBe('/');
  });

  it('another account on this phone: Home', async () => {
    await installSignedInPlayer();
    rememberRoom('123456', 'someone-else');
    const app = await open('/');
    await screen.findByTestId('screen-home');
    await wait(1000);
    expect(app.pathname()).toBe('/');
  });

  it('kept while the store holds the friends room, forgotten once out of it', async () => {
    const auth = await installSignedInPlayer();
    const uid = auth.provider.currentUser()!.uid;
    await open('/');
    await screen.findByTestId('screen-home');
    const room = fakeOnline({ kind: 'friends', code: '123456', hasGame: false, status: 'lobby' });
    await act(async () => hold({ online: room }));
    expect(roomToResume(uid)).toBe('123456');
    await act(async () => useGameStore.setState({ online: null }));
    expect(roomToResume(uid)).toBeNull();
  });
});

describe('a link while the app runs (§6.6)', () => {
  it('free (Home): straight into the room', async () => {
    await installSignedInPlayer();
    const app = await open('/');
    await screen.findByTestId('screen-home');
    await linkArrives();
    await screen.findByTestId('screen-room');
    expect(app.pathname()).toBe('/room/123456');
    expect(question()).toBeNull();
  });

  it('a practice: asks over the frozen board; "הישאר" keeps it (the countdown only then)', async () => {
    await installSignedInPlayer();
    const app = await open('/');
    await screen.findByTestId('screen-home');
    const practice = fakePractice();
    await act(async () => {
      hold({ session: practice });
      router.push('/game');
    });
    await screen.findByTestId('screen-game');

    await linkArrives();
    expect(await screen.findByText('לעזוב את האימון ולהצטרף לחדר?')).toBeOnTheScreen();
    expect(screen.getByText('האימון יישמר, כמו ביציאה רגילה.')).toBeOnTheScreen();
    expect(localGamesHeld()).toBe(true);

    await answer('cancel');
    expect(localGamesHeld()).toBe(false);
    expect(app.pathname()).toBe('/game');
    expect(practice.close).not.toHaveBeenCalled();
    expect(pendingInviteCode()).toBeNull();
  });

  it('a practice: "הצטרף לחדר" leaves it (saved as on any leaving) and goes in', async () => {
    await installSignedInPlayer();
    const app = await open('/');
    await screen.findByTestId('screen-home');
    const practice = fakePractice();
    await act(async () => {
      hold({ session: practice });
      router.push('/game');
    });
    await screen.findByTestId('screen-game');
    await linkArrives();
    await screen.findByText('לעזוב את האימון ולהצטרף לחדר?');

    await answer('confirm');
    await screen.findByTestId('screen-room');
    expect(app.pathname()).toBe('/room/123456');
    expect(practice.close).toHaveBeenCalled();
    expect(useGameStore.getState().session).toBeNull();
    expect(localGamesHeld()).toBe(false);
    // Home is under the room.
    await act(async () => router.back());
    await screen.findByTestId('screen-home');
  });

  it('a stage: the same question (its screen closes it as it leaves)', async () => {
    await installSignedInPlayer();
    await open('/', { ...ROUTES, 'levels/play': stand('stage') });
    await screen.findByTestId('screen-home');
    await act(async () => router.push('/levels/play'));
    await screen.findByTestId('screen-stage');
    await linkArrives();
    expect(await screen.findByText('לעזוב את האימון ולהצטרף לחדר?')).toBeOnTheScreen();
    await answer('confirm');
    await screen.findByTestId('screen-room');
  });

  it('a ranked search: "לבטל את החיפוש ולהצטרף?"; yes stops it', async () => {
    await installSignedInPlayer();
    await open('/');
    await screen.findByTestId('screen-home');
    const search = { close: jest.fn() };
    await act(async () => {
      hold({ match: search });
      router.push('/match');
    });
    await screen.findByTestId('screen-match');
    await linkArrives();
    expect(await screen.findByText('לבטל את החיפוש ולהצטרף?')).toBeOnTheScreen();
    await answer('confirm');
    await screen.findByTestId('screen-room');
    expect(search.close).toHaveBeenCalled();
    expect(useGameStore.getState().match).toBeNull();
  });

  it('another friends room before its game: "לעבור לחדר ⁦123 456⁩?"; the same room: nothing', async () => {
    await installSignedInPlayer();
    const app = await open('/');
    await screen.findByTestId('screen-home');
    const other = fakeOnline({ kind: 'friends', code: '654321', hasGame: false, status: 'lobby' });
    await act(async () => {
      hold({ online: other });
      router.push('/friends/room');
    });
    await screen.findByTestId('screen-friends-room');

    await linkArrives('sudokufight://room/654321');
    await wait(500);
    expect(question()).toBeNull();
    expect(app.pathname()).toBe('/friends/room');

    await linkArrives();
    expect(await screen.findByText('לעבור לחדר ⁦123 456⁩?')).toBeOnTheScreen();
    await answer('cancel');
    expect(app.pathname()).toBe('/friends/room');
    expect(other.close).not.toHaveBeenCalled();
  });

  it('an online game: "אתה באמצע משחק"; the invite waits, and asks once the game is over', async () => {
    await installSignedInPlayer();
    const app = await open('/');
    await screen.findByTestId('screen-home');
    const game = fakeOnline({ kind: 'match', hasGame: true });
    await act(async () => {
      hold({ online: game });
      router.push('/game');
    });
    await screen.findByTestId('screen-game');

    await linkArrives();
    expect(await screen.findByText('אתה באמצע משחק')).toBeOnTheScreen();
    expect(screen.getByText('אפשר להצטרף אחריו. ההזמנה לחדר ⁦123 456⁩ תחכה לך.')).toBeOnTheScreen();
    await answer('confirm'); // "חזרה למשחק"
    expect(app.pathname()).toBe('/game');
    expect(game.close).not.toHaveBeenCalled();
    expect(pendingInviteCode()).toBe('123456');

    // The game ends: its results, then "יש לך הזמנה לחדר ⁦123 456⁩ · הצטרף".
    await act(async () => {
      game.end();
      hold({ view: null });
      router.replace('/results/g1');
    });
    expect(await screen.findByText('יש לך הזמנה לחדר ⁦123 456⁩')).toBeOnTheScreen();
    await answer('confirm');
    await screen.findByTestId('screen-room');
    expect(app.pathname()).toBe('/room/123456');
  });

  it('an online game: "לא עכשיו" (or Android back) on "אתה באמצע משחק" keeps the invite too, as the dialog says', async () => {
    await installSignedInPlayer();
    await open('/');
    await screen.findByTestId('screen-home');
    const game = fakeOnline({ kind: 'match', hasGame: true });
    await act(async () => {
      hold({ online: game });
      router.push('/game');
    });
    await screen.findByTestId('screen-game');
    await linkArrives();
    await screen.findByText('אתה באמצע משחק');
    await answer('cancel'); // "לא עכשיו"
    expect(game.close).not.toHaveBeenCalled();
    expect(pendingInviteCode()).toBe('123456');
    await act(async () => {
      game.end();
      hold({ view: null });
      router.replace('/results/g1');
    });
    expect(await screen.findByText('יש לך הזמנה לחדר ⁦123 456⁩')).toBeOnTheScreen();
  });

  it('a waiting invite turned down ("לא עכשיו") is forgotten', async () => {
    await installSignedInPlayer();
    await open('/');
    await screen.findByTestId('screen-home');
    await act(async () => {
      rememberInvite('123456');
    });
    expect(await screen.findByText('יש לך הזמנה לחדר ⁦123 456⁩')).toBeOnTheScreen();
    await answer('cancel');
    expect(pendingInviteCode()).toBeNull();
    expect(question()).toBeNull();
  });

  it('signed out: nothing is asked; the sign-in comes first, then the room', async () => {
    const auth = await installSignedInPlayer();
    await auth.provider.signOut();
    const app = await open('/');
    await screen.findByTestId('screen-login');
    await linkArrives();
    expect(question()).toBeNull();
    expect(app.pathname()).toBe('/login');
    await act(async () => signIn(TEST_PLAYER.email, TEST_PLAYER.password));
    await screen.findByTestId('screen-room');
  });
});

describe('the room screen itself (app/room/[code].tsx) at a start [D88, §6.5]', () => {
  let table: FakeFriendsTable;
  let api: FakeRoomsApi;
  const REAL = { ...ROUTES, 'room/[code]': RoomByCodeRoute };

  beforeEach(() => {
    table = new FakeFriendsTable();
    api = new FakeRoomsApi(table);
    // The routes as on the phone: none while nobody is signed in (net/friendsDevice.ts signedInRoomsApi).
    setFriendsRooms(
      createFriendsRooms(
        deviceFriendsDeps({
          api: () => (useAuth.getState().user ? api : null),
          makeHost: () => table.host,
        }),
      ),
    );
  });

  afterEach(async () => {
    await act(async () => useGameStore.getState().clear());
    setFriendsRooms(null);
  });

  it('a link that starts the app, the sign-in still being restored: the join waits for it, then the room', async () => {
    const auth = await installSignedInPlayer();
    // A cold start: the sign-in comes back only later (Firebase restores it after the first screen mounted).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const restore = auth.provider.restore.bind(auth.provider);
    auth.provider.restore = () => gate.then(restore);
    rememberInvite(FCODE);
    const app = await open(`/room/${FCODE}`, REAL);
    await wait(500);
    expect(api.calls).toEqual([]);
    expect(useAuth.getState().status).toBe('loading');

    await act(async () => release());
    await screen.findByTestId('screen-friends-room');
    expect(app.pathname()).toBe('/friends/room');
    expect(api.calls).toEqual([{ kind: 'join', body: expect.objectContaining({ code: FCODE }) }]);
    expect(useGameStore.getState().online?.isFriends).toBe(true);
    expect(pendingInviteCode()).toBeNull();
  });

  it('the app closed in a room that closed meanwhile: said once, and the room forgotten for the next start', async () => {
    const auth = await installSignedInPlayer();
    const uid = auth.provider.currentUser()!.uid;
    rememberRoom(FCODE, uid);
    api.refuse = new RoomsApiError('roomClosed', 410, { error: 'roomClosed', rooms: true });
    const app = await open('/', REAL);
    expect(await screen.findByText('החדר נסגר.')).toBeOnTheScreen();
    expect(app.pathname()).toBe(`/room/${FCODE}`);
    expect(api.calls).toHaveLength(1);
    // What the next start reads (useAuthGate → roomToResume): nothing, so it stays on Home.
    expect(roomToResume(uid)).toBeNull();
    // "לבית": Home, and nothing more asked of the server.
    await act(async () => fireEvent.press(screen.getByTestId('friends-home')));
    await screen.findByTestId('screen-home');
    await wait(1000);
    expect(app.pathname()).toBe('/');
    expect(api.calls).toHaveLength(1);
  });

  it('the app closed in a room, no connection at the start: the room is kept for the next start', async () => {
    const auth = await installSignedInPlayer();
    const uid = auth.provider.currentUser()!.uid;
    rememberRoom(FCODE, uid);
    api.refuse = new RoomsApiError('network', null);
    await open('/', REAL);
    await screen.findByTestId('friends-failed');
    expect(roomToResume(uid)).toBe(FCODE);
  });
});

describe('a link the app does not know (+not-found)', () => {
  it('says so, and leads home', async () => {
    await installSignedInPlayer();
    const app = await open('/no/such/screen');
    expect(await screen.findByText('הקישור הזה לא מוכר')).toBeOnTheScreen();
    await act(async () => fireEvent.press(screen.getByTestId('not-found-home')));
    await screen.findByTestId('screen-home');
    expect(app.pathname()).toBe('/');
    expect(useAuth.getState().status).toBe('ready');
  });
});
