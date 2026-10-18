// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { cellName, type Digit, type GameState, type PlayerId, type PlayerInfo } from '@sudoku-fight/engine';
import type { HistoryGame, HistoryPage, MatchPlayer, Me } from '@sudoku-fight/protocol';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import RootLayout from '../../app/_layout';
import AchievementsRoute from '../../app/achievements';
import BotSelectRoute from '../../app/bot-select';
import GameRoute from '../../app/game';
import GameTypeRoute from '../../app/game-type';
import HistoryRoute from '../../app/history';
import Index from '../../app/index';
import LeaderboardRoute from '../../app/leaderboard';
import MatchRoute from '../../app/match/index';
import ModesRoute from '../../app/modes';
import ReplayRoute from '../../app/replay/[id]';
import ResultsRoute from '../../app/results/[id]';
import SettingsRoute from '../../app/settings';
import VerifyEmailRoute from '../../app/verify-email';
import { refreshMe, useAuth } from '../auth/authStore';
import { installSignedInPlayer, type TestAuth } from '../auth/testing/testAuth';
import { signedText } from '../components/player';
import type { RankedDeps } from '../game/gameStore';
import { useGameStore } from '../game/gameStore';
import { PUZZLE } from '../game/testing/practice';
import { memoryDb, type SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { setHealthCheck } from '../net/connectivity';
import { FakeMatchmaking } from '../net/testing/fakeMatchmaking';
import { elapse, FakeTable, ME, OPP } from '../net/testing/fakeServer';
import { rankedRefresh } from '../progress/appProgress';
import type { HistoryApi } from '../screens/history/historyApi';
import { track } from '../services/analytics';
import { useProfile } from '../state/profile';
import { useSettings } from '../state/settings';
import { motion } from '../theme/motion';

/**
 * Ranked games end to end (work plan stages 9 and 10, spec §10, §11, §16.1), through the app's real routes
 * (the root layout and its auth gate included), a signed-in account (the development sign-in and the
 * in-memory account server), the phone's practice database (sql.js), and the fake matchmaking and game
 * servers of src/net/testing around the real engine:
 *
 * 1. Home → "שחק" → Modes → "מדורג · 2" → the game type → searching (the range widens as the server says) →
 *    found (VS) → 3-2-1-GO → played to the full board → the results, the rating counting up to the engine's →
 *    Home shows the new rating → History lists the game under "מדורג".
 * 2. Nobody found in 60 s: "המשך לחפש" lifts the range's cap; then "שחק מול בוט בינתיים" starts a bot practice.
 * 3. No connection (spec §16.1): the ranked cards dimmed with "דורש חיבור", the banner, "עבור לאימון".
 * 4. "מדורג · 4": three opponents found, all four counted down, the game played to the end, the podium.
 * 5. The rating after the game without a restart (Moshe's device test of 1.0.0): "לבית" before the server
 *    stored the game, and the results left with Android's back.
 *
 * Along the way the analytics of spec §22 are checked: matchmaking_wait{sec,result}, game_start, game_end.
 */

/** What the app's wiring gets instead of the network: a fake game server per search, and the server's history. */
const mockNet: {
  /** The players the next match's game is created with (their ratings move by the engine's Elo). */
  players: PlayerInfo[];
  table: FakeTable | null;
  mm: FakeMatchmaking | null;
  /** Ranked games the server has finished, newest first (GET /v1/me/games). */
  games: HistoryGame[];
  deps(): RankedDeps;
} = {
  players: [],
  table: null,
  mm: null,
  games: [],
  deps() {
    // One search, one server: its clock is the phone's (Jest's fake Date), and both move on together.
    const table = new FakeTable({ players: mockNet.players });
    table.clock.set(Date.now());
    const mm = new FakeMatchmaking(table.clock, table.scheduler);
    mm.rating = 1200;
    mockNet.table = table;
    mockNet.mm = mm;
    return {
      connector: mm,
      clock: table.clock,
      scheduler: table.scheduler,
      track: (name, props) => track(name, props),
      makeHost: () => table.host,
    };
  },
};

const mockApp: { db: SqlJsDb | null; history: (HistoryApi & { calls: string[] }) | null } = {
  db: null,
  history: null,
};

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => mockApp.db }));
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
// What the app reports (Moshe's black screens of 1.0.0): a game's end must report nothing.
jest.mock('../services/crashlytics', () => {
  const reporter = { enabled: true, recordError: jest.fn(), setUser: jest.fn(), log: jest.fn() };
  return { crashReporter: () => reporter };
});
const crash = jest
  .requireMock<{ crashReporter: () => { recordError: jest.Mock } }>('../services/crashlytics')
  .crashReporter();
// The phone's matchmaking wiring brings the network SDK: the fake servers instead.
jest.mock('../net/matchmakingDevice', () => ({ deviceMatchmakingDeps: () => mockNet.deps() }));
// The history and the replay as wired in the app (the phone's database), with the server's routes in memory.
type MockWiring = typeof import('../screens/history/appWiring');
jest.mock('../screens/history/appWiring', () => {
  const actual = jest.requireActual<MockWiring>('../screens/history/appWiring');
  return {
    signedInHistoryApi: () => mockApp.history,
    appHistoryDeps: () => ({ ...actual.appHistoryDeps(), ranked: mockApp.history }),
    appReplayDeps: () => ({ ...actual.appReplayDeps(), ranked: mockApp.history }),
  } satisfies MockWiring;
});
type NativeMocks = typeof import('../screens/home/testing/nativeMocks');
jest.mock(
  'expo-audio',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoAudio,
);
jest.mock(
  'expo-haptics',
  () => jest.requireActual<NativeMocks>('../screens/home/testing/nativeMocks').expoHaptics,
);

jest.setTimeout(300_000);

const ROUTES = {
  _layout: RootLayout,
  index: Index,
  modes: ModesRoute,
  'game-type': GameTypeRoute,
  'bot-select': BotSelectRoute,
  'match/index': MatchRoute,
  game: GameRoute,
  'results/[id]': ResultsRoute,
  'replay/[id]': ReplayRoute,
  settings: SettingsRoute,
  leaderboard: LeaderboardRoute,
  history: HistoryRoute,
  achievements: AchievementsRoute,
  'verify-email': VerifyEmailRoute,
};

const hidden = { includeHiddenElements: true };
const tracked = jest.mocked(track);
let auth: TestAuth;

/**
 * The ranked account on this phone, as matchmaking shows it (TEST_PLAYER: Tester, sun, IL, 1200
 * provisional).
 */
const ME_MATCH: MatchPlayer = {
  id: ME,
  name: 'Tester',
  avatarId: 'sun',
  country: 'IL',
  rating: 1200,
  provisional: true,
};
const NINA: MatchPlayer = {
  id: OPP,
  name: 'NinaVolt',
  avatarId: 'maya',
  country: 'DE',
  rating: 1305,
  provisional: false,
};
const ZIV: MatchPlayer = {
  id: 'p3',
  name: 'Ziv',
  avatarId: 'omer',
  country: 'FR',
  rating: 1250,
  provisional: false,
};
const LEA: MatchPlayer = {
  id: 'p4',
  name: 'Lea',
  avatarId: 'sudoku-board',
  country: 'US',
  rating: 1190,
  provisional: false,
};

/** A matched player as the game's config has them: the rating and how many rated games (provisional under 10). */
const infoOf = (p: MatchPlayer): PlayerInfo => ({
  id: p.id,
  name: p.name,
  rating: p.rating,
  ratedGames: p.provisional ? 0 : 12,
});

interface App {
  pathname(): string;
  searchParams(): Record<string, string | string[]>;
  unmount(): void;
}

async function launch(): Promise<App> {
  const app = renderRouter(ROUTES, { initialUrl: '/' });
  const rendered = await app;
  await screen.findByTestId('home-scroll');
  return {
    pathname: () => app.getPathname(),
    searchParams: () => app.getSearchParams(),
    unmount: () => rendered.unmount(),
  };
}

/** The phone's timers and the fake servers' clock move on together, `step` at a time. */
async function pass(ms: number, step = 50) {
  for (let done = 0; done < ms; done += step) {
    const d = Math.min(step, ms - done);
    await act(async () => {
      const table = mockNet.table;
      if (table) await elapse(table, d, Math.min(10, d));
      jest.advanceTimersByTime(d);
    });
  }
}

/** A message from a fake server, now. */
async function server(send: () => void) {
  await act(async () => send());
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

function net(): { table: FakeTable; mm: FakeMatchmaking } {
  if (!mockNet.table || !mockNet.mm) throw new Error('no search yet');
  return { table: mockNet.table, mm: mockNet.mm };
}

/** The props of every `name` event so far. */
const eventsOf = (name: string) => tracked.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

/** Home → "שחק" → the ranked card of `players` → `gameType` → "מצא יריב(ים)": the match screen. */
async function search(app: App, players: 2 | 3 | 4, start: string) {
  await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
  await waitFor(() => expect(app.pathname()).toBe('/modes'));
  await press(`mode-ranked${players}`);
  await waitFor(() => expect(app.pathname()).toBe('/game-type'));
  expect(app.searchParams()).toMatchObject({ mode: 'ranked', players: String(players) });
  await press(`type-${PUZZLE.gameType}`);
  await fireEvent.press(screen.getByRole('button', { name: start }));
  await waitFor(() => expect(app.pathname()).toBe('/match'));
}

/** Everyone in: ready, 3 · 2 · 1, GO (matchmaking's "started", the game room's snapshot), and the board. */
async function countDownAndStart(app: App, ids: PlayerId[]) {
  const { mm, table } = net();
  await server(() => mm.ready(ids));
  await server(() => void mm.countdown(3000));
  const step = () => screen.getByTestId('match-countdown-step-text');
  expect(step()).toHaveTextContent('3');
  await pass(1000, 100);
  expect(step()).toHaveTextContent('2');
  await pass(1000, 100);
  expect(step()).toHaveTextContent('1');
  await pass(1000, 100);
  expect(step()).toHaveTextContent('GO!');
  await server(() => {
    mm.started();
    table.startGame();
  });
  await pass(400);
  await waitFor(() => expect(app.pathname()).toBe('/game'));
  await screen.findByTestId('game');
}

/**
 * Plays the game to the full board: me on the screen (a cell, then its digit), the others at the server, in
 * `order`, round after round, every digit right.
 */
async function playToTheEnd(order: PlayerId[]): Promise<GameState> {
  const game = net().table.game!;
  const puzzle = game.state.config.puzzle;
  let turn = 0;
  while (game.state.status === 'running') {
    const cell = game.state.grid.findIndex((d, i) => d === 0 && !game.state.locks.some((l) => l.cell === i));
    if (cell < 0) throw new Error('no free cell');
    const who = order[turn++ % order.length]!;
    const digit = Number(puzzle.solution[cell]) as Digit;
    if (who === ME) {
      await press(`cell-${cellName(cell)}`);
      await pass(100);
      await press(`key-${digit}`);
    } else {
      await act(async () => {
        expect(game.act(who, { type: 'select', cell }).rejected).toBeNull();
        expect(game.act(who, { type: 'place', cell, digit }).rejected).toBeNull();
      });
    }
    await pass(150);
    if (turn > 400) throw new Error('the game does not end');
  }
  return game.state;
}

/** Moves on until `ok`, a little at a time (so a screen that just opened is caught at its first moments). */
async function passUntil(ok: () => boolean, max = 5000, step = 50) {
  for (let done = 0; done < max && !ok(); done += step) await pass(step, step);
  expect(ok()).toBe(true);
}

/** The server's record of a finished game, seen from my seat (what GET /v1/me/games answers). */
function historyGameOf(state: GameState, players: readonly MatchPlayer[]): HistoryGame {
  const result = state.result!;
  const config = state.config;
  return {
    id: config.id,
    mode: config.mode,
    gameType: config.gameType,
    playerCount: config.players.length,
    startedAt: state.startedAt ?? state.createdAt,
    endedAt: state.endedAt,
    endReason: result.reason,
    mySeat: config.players.findIndex((p) => p.id === ME),
    players: config.players.map((p, seat) => {
      const rank = result.ranking.find((r) => r.playerId === p.id);
      const change = result.ratingChanges.find((c) => c.playerId === p.id);
      const profile = players.find((m) => m.id === p.id);
      return {
        seat,
        userId: p.id,
        displayName: p.name ?? null,
        avatarId: profile && profile.avatarId !== 'av00' ? profile.avatarId : null,
        country: profile?.country ?? null,
        score: rank?.score ?? null,
        mistakes: rank?.mistakes ?? null,
        place: rank?.place ?? null,
        status: rank?.status ?? 'active',
        ratingKey: change ? config.gameType : null,
        ratingBefore: change?.before ?? null,
        ratingAfter: change?.after ?? null,
      };
    }),
  };
}

beforeAll(async () => {
  mockApp.db = await memoryDb();
  auth = await installSignedInPlayer();
  mockApp.history = {
    calls: [],
    async myGames(cursor) {
      mockApp.history!.calls.push(`games:${cursor ?? ''}`);
      const page: HistoryPage = { games: [...mockNet.games], nextCursor: null };
      return page;
    },
    async replay() {
      throw new Error('not in this test');
    },
  };
});

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ language: 'he', reduceMotion: 'on', sound: true, haptics: true });
  useProfile.setState({ lastPlay: null, botLevel: null });
  tracked.mockClear();
  mockNet.table = null;
  mockNet.mm = null;
});

afterEach(async () => {
  await act(async () => {
    useGameStore.getState().clear();
    rankedRefresh().stop();
  });
  setHealthCheck(null);
  jest.useRealTimers();
});

describe('ranked games, end to end (work plan stages 9–10)', () => {
  it('2 players: search, found, 3-2-1-GO, the whole board, the rating counted up, Home and History', async () => {
    mockNet.players = [ME_MATCH, NINA].map(infoOf);
    const app = await launch();
    expect(screen.getByTestId(`rating-${PUZZLE.gameType}`)).toHaveTextContent(/1200זמני$/);

    // ---- Home → "שחק" → "מדורג · 2" (my rating in its card) → the type → "מצא יריב" ----
    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    await waitFor(() => expect(app.pathname()).toBe('/modes'));
    expect(screen.getByTestId('rating-ranked2')).toHaveTextContent('דירוג 1200 · רגיל');
    await fireEvent.press(screen.getByRole('button', { name: 'חזרה' }));
    await waitFor(() => expect(app.pathname()).toBe('/'));
    await search(app, 2, 'מצא יריב');
    const { mm, table } = net();
    expect(mm.joins).toEqual([`${PUZZLE.gameType}-2p`]);
    expect(screen.getByRole('header')).toHaveTextContent('מתחבר לתור…');

    // ---- searching: the range, widened by the server every 5 s (spec §10, D6) ----
    await server(() => mm.searching());
    expect(screen.getByRole('header')).toHaveTextContent('מחפש יריב…');
    expect(screen.getByTestId('match-search-range-value')).toHaveTextContent('⁦1150–1250⁩');
    await pass(5000, 250);
    expect(screen.getByTestId('match-search-elapsed')).toHaveTextContent('0:05');
    await server(() => mm.searching({ elapsedMs: 5000 }));
    expect(screen.getByTestId('match-search-range-value')).toHaveTextContent('⁦1125–1275⁩');
    await pass(5000, 250);
    await server(() => mm.searching({ elapsedMs: 10_000 }));
    expect(screen.getByTestId('match-search-range-value')).toHaveTextContent('⁦1100–1300⁩');
    expect(screen.getByTestId('match-search-elapsed')).toHaveTextContent('0:10');

    // ---- found: the VS, both players, ready once in the match's room (D37) ----
    await server(() => mm.found({ players: [ME_MATCH, NINA] }));
    expect(screen.getByRole('header')).toHaveTextContent('נמצא יריב!');
    expect(screen.getByTestId('match-found-vs')).toHaveTextContent('VS');
    expect(screen.getByTestId('seat-opp')).toHaveTextContent(/NinaVolt.*1305/);
    expect(screen.getByTestId('seat-me')).toHaveTextContent(/Tester.*אני.*1200.*זמני/);
    await pass(100);
    expect(table.calls.at(-1)).toMatchObject({ kind: 'reserved' });
    expect(eventsOf('matchmaking_wait')).toEqual([{ sec: 10, result: 'found' }]);
    await server(() => mm.ready([ME]));
    await pass(800, 100);
    expect(screen.getByTestId('match-found-count')).toHaveTextContent('1/2');

    // ---- 3 · 2 · 1 · GO, and the board ----
    await countDownAndStart(app, [ME, OPP]);
    expect(eventsOf('game_start')).toEqual([{ mode: 'ranked', type: PUZZLE.gameType, players: 2 }]);
    // Both as the VS showed them: the flags on the cards (the match's profiles, spec §6.8).
    expect(within(screen.getByTestId('card-opponent')).getByTestId('flag-DE', hidden)).toBeTruthy();
    expect(within(screen.getByTestId('card-me')).getByTestId('flag-IL', hidden)).toBeTruthy();

    // ---- the whole board: two cells of mine for each of hers, so I win ----
    const final = await playToTheEnd([ME, ME, OPP]);
    const result = final.result!;
    expect(result.reason).toBe('boardComplete');
    expect(result.ranking.find((r) => r.playerId === ME)?.place).toBe(1);
    const mine = result.ratingChanges.find((c) => c.playerId === ME)!;
    const before = Math.round(mine.before);
    const after = Math.round(mine.after);
    expect(before).toBe(1200);
    expect(after).toBeGreaterThan(before);
    // The results animate (reduced motion off from here): the new rating counts up from the old one.
    await act(async () => useSettings.setState({ reduceMotion: 'off' }));

    // ---- the results: "ניצחון!", the rating counting from 1200 to the engine's ----
    await passUntil(() => app.pathname() === `/results/${final.config.id}`);
    // The number counts on the UI thread (an animated text, silent for screen readers: the card's label says
    // "from … to …"): what it shows now is its animated `text`, as Reanimated's Jest props hold it.
    const value = () =>
      Number(
        (
          screen.getByTestId('results-rating-value', hidden).props.jestAnimatedProps as {
            value: { text: string };
          }
        ).value.text,
      );
    expect(value()).toBe(before);
    expect(screen.getByTestId('results-rating-delta')).toHaveTextContent(signedText(mine.delta));
    expect(screen.getByTestId('results-rating')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`מ־${before} ל־${after}`),
    );
    const seen = new Set<number>();
    const countFor = motion.sequence.victory.ratingCountAt + motion.duration.rewardMax + 600;
    for (let t = 0; t < countFor; t += 50) {
      await pass(50);
      seen.add(value());
    }
    expect(value()).toBe(after);
    // On the way: numbers between the two, never past them.
    expect([...seen].some((v) => v > before && v < after)).toBe(true);
    expect([...seen].every((v) => v >= before && v <= after)).toBe(true);
    expect(eventsOf('game_end')).toEqual([
      expect.objectContaining({ mode: 'ranked', result: 'win', mistakes: 0 }),
    ]);

    // ---- the server stores it: the new rating (GET /v1/me) and the game in the history ----
    const uid = auth.provider.currentUser()!.uid;
    const row = auth.server.users.get(uid)!;
    row.me = {
      ...row.me,
      ratings: row.me.ratings.map((r) =>
        r.key === PUZZLE.gameType ? { ...r, rating: mine.after, games: 1, peak: mine.after } : r,
      ),
    };
    mockNet.games = [historyGameOf(final, [ME_MATCH, NINA])];
    await act(async () => useSettings.setState({ reduceMotion: 'on' }));
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    await waitFor(() => expect(app.pathname()).toBe('/'));
    await waitFor(() =>
      expect(screen.getByTestId(`rating-${PUZZLE.gameType}`)).toHaveTextContent(new RegExp(`${after}זמני$`)),
    );

    // ---- History: the game under "מדורג" ----
    await press('nav-history');
    await waitFor(() => expect(app.pathname()).toBe('/history'));
    await press('history-filter-ranked');
    const card = await screen.findByTestId(`history-card-${final.config.id}`);
    expect(card).toHaveProp('accessibilityLabel', expect.stringMatching(/^ניצחון, /));
    expect(screen.getByTestId(`history-card-${final.config.id}-rating`)).toHaveTextContent(
      signedText(mine.after - mine.before),
    );
    app.unmount();
  });

  it('nobody found in 60 s: "המשך לחפש" lifts the cap, then "שחק מול בוט בינתיים" starts a bot practice', async () => {
    mockNet.players = [ME_MATCH, NINA].map(infoOf);
    const app = await launch();
    await search(app, 2, 'מצא יריב');
    const { mm } = net();
    await server(() => mm.searching());
    await pass(60_000, 1000);
    await server(() => mm.timeout());

    // ---- Match-Timeout: how long, in what range, and three ways on ----
    expect(screen.getByRole('header')).toHaveTextContent('עדיין לא מצאנו יריב ברמה שלך');
    expect(screen.getByTestId('match-timeout-elapsed')).toHaveTextContent('1:00');
    expect(screen.getByTestId('match-timeout-body')).toHaveTextContent(/בטווח ⁦900–1500⁩/);
    expect(eventsOf('matchmaking_wait')).toEqual([{ sec: 60, result: 'timeout' }]);

    // ---- "המשך לחפש": the same search, no cap on the range ----
    await fireEvent.press(screen.getByRole('button', { name: 'המשך לחפש' }));
    expect(mm.room.sent).toContainEqual({ type: 'keepSearching' });
    await server(() => mm.searching({ elapsedMs: 65_000, extended: true }));
    expect(screen.getByRole('header')).toHaveTextContent('מחפש יריב…');
    expect(screen.getByText('בלי הגבלת טווח: הטווח ממשיך להתרחב')).toBeOnTheScreen();
    expect(screen.getByTestId('match-search-range-value')).toHaveTextContent('⁦825–1575⁩');
    await pass(55_000, 1000);
    await server(() => mm.timeout({ elapsedMs: 120_000, range: 625, extended: true }));
    expect(eventsOf('matchmaking_wait')).toEqual([
      { sec: 60, result: 'timeout' },
      { sec: 120, result: 'timeout' },
    ]);

    // ---- "שחק מול בוט בינתיים": out of the queue, and a practice against the bot in the same type ----
    await fireEvent.press(screen.getByRole('button', { name: 'שחק מול בוט בינתיים' }));
    await waitFor(() => expect(app.pathname()).toBe('/game'));
    expect(mm.room.left).toBe(true);
    expect(useGameStore.getState()).toMatchObject({
      match: null,
      online: null,
      session: { mode: 'bot', gameType: PUZZLE.gameType },
    });
    expect(await screen.findByTestId('game')).toBeOnTheScreen();
    app.unmount();
  });

  it('offline (spec §16.1): the ranked cards dimmed, the banner, and "עבור לאימון"', async () => {
    let checks = 0;
    setHealthCheck(async () => {
      checks++;
      return false;
    });
    const app = await launch();
    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    await waitFor(() => expect(app.pathname()).toBe('/modes'));
    expect(await screen.findByTestId('offline-banner')).toHaveAccessibleName(
      'אין חיבור לאינטרנט. משחקים מדורגים לא זמינים',
    );
    for (const k of ['ranked2', 'ranked3', 'ranked4']) {
      expect(screen.getByTestId(`mode-${k}`)).toHaveProp('accessibilityState', { disabled: true });
      expect(screen.getByTestId(`offline-${k}`)).toHaveTextContent('דורש חיבור');
    }
    await press('mode-ranked2');
    expect(app.pathname()).toBe('/modes');
    expect(screen.getByTestId('mode-solo')).toHaveProp('accessibilityState', { disabled: false });
    // Checking again in the background, every 10 s.
    await pass(10_000, 500);
    expect(checks).toBeGreaterThanOrEqual(2);

    await fireEvent.press(screen.getByRole('button', { name: 'עבור לאימון' }));
    await waitFor(() => expect(app.pathname()).toBe('/game-type'));
    expect(app.searchParams()).toEqual({ mode: 'solo' });
    expect(screen.getByRole('button', { name: 'התחל אימון' })).toBeOnTheScreen();
    expect(eventsOf('matchmaking_wait')).toEqual([]);
    app.unmount();
  });

  it('4 players: three opponents found, all four counted down, the game to the end, the podium', async () => {
    const four = [ME_MATCH, NINA, ZIV, LEA];
    mockNet.players = four.map(infoOf);
    const app = await launch();
    await search(app, 4, 'מצא יריבים');
    const { mm } = net();
    expect(mm.joins).toEqual([`${PUZZLE.gameType}-4p`]);

    // ---- searching for three ----
    await server(() => mm.searching());
    expect(screen.getByTestId('match-search-header')).toHaveTextContent(/מדורג · 4 שחקנים/);
    expect(screen.getByRole('header')).toHaveTextContent('מחפש יריבים…');
    expect(screen.getAllByTestId('empty-seat')).toHaveLength(3);
    await pass(20_000, 1000);
    await server(() => mm.searching({ elapsedMs: 20_000 }));
    expect(screen.getByTestId('match-search-range-value')).toHaveTextContent('⁦1050–1350⁩');

    // ---- found: all four, me first, then the others by seat ----
    await server(() => mm.found({ players: four }));
    expect(screen.getByRole('header')).toHaveTextContent('נמצאו יריבים!');
    const seats = screen
      .getAllByTestId(/^seat-(me|opp|p3|p4)$/)
      .map((el) => String(el.props.testID).slice('seat-'.length));
    expect(seats).toEqual([ME, OPP, 'p3', 'p4']);
    expect(eventsOf('matchmaking_wait')).toEqual([{ sec: 20, result: 'found' }]);

    await countDownAndStart(app, [ME, OPP, 'p3', 'p4']);
    expect(eventsOf('game_start')).toEqual([{ mode: 'ranked', type: PUZZLE.gameType, players: 4 }]);
    // The compact cards (spec §6.8), each opponent with the country the match gave them.
    expect(screen.getByTestId('group-hud')).toBeOnTheScreen();
    for (const [id, country] of [
      [OPP, 'DE'],
      ['p3', 'FR'],
      ['p4', 'US'],
    ] as const) {
      expect(within(screen.getByTestId(`card-${id}`)).getByTestId(`flag-${country}`, hidden)).toBeTruthy();
    }

    // ---- the whole board ----
    const final = await playToTheEnd([ME, OPP, ME, 'p3', 'p4']);
    const result = final.result!;
    expect(result.reason).toBe('boardComplete');
    expect(result.ranking).toHaveLength(4);

    // ---- the podium and the 4th place, and my rating change as the engine computed it ----
    await passUntil(() => app.pathname() === `/results/${final.config.id}`);
    expect(await screen.findByTestId('results-ranking')).toBeOnTheScreen();
    const [a, b, c, d] = result.ranking;
    for (const r of [a!, b!, c!])
      expect(screen.getByTestId(`results-podium-${r.place}-${r.playerId}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`results-ranking-${d!.place}-${d!.playerId}`)).toBeOnTheScreen();
    expect(screen.getAllByLabelText(/^מקום \d: אני · /)).toHaveLength(1);
    const mine = result.ratingChanges.find((r) => r.playerId === ME)!;
    expect(screen.getByTestId('results-rating')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`מ־${Math.round(mine.before)} ל־${Math.round(mine.after)}`),
    );
    const myPlace = result.ranking.find((r) => r.playerId === ME)!.place;
    expect(eventsOf('game_end')).toEqual([
      expect.objectContaining({ mode: 'ranked', result: myPlace === 1 ? 'win' : 'loss' }),
    ]);
    app.unmount();
  });
  describe('the rating after the game, without restarting the app (Moshe’s device test of 1.0.0)', () => {
    /** The account on the server: `id` as given, every rating back at 1200 with no games. */
    function freshAccount(id?: string): { row: { me: Me }; original: Me } {
      const row = auth.server.users.get(auth.provider.currentUser()!.uid)!;
      const original = row.me;
      row.me = {
        ...row.me,
        id: id ?? row.me.id,
        ratings: row.me.ratings.map((r) => ({ ...r, rating: 1200, games: 0, provisional: true, peak: 1200 })),
      };
      return { row, original };
    }

    /** The server stores the game: my rating and one more game in the game's key. */
    function storeOnServer(row: { me: Me }, rating: number) {
      row.me = {
        ...row.me,
        ratings: row.me.ratings.map((r) =>
          r.key === PUZZLE.gameType ? { ...r, rating, games: 1, peak: Math.max(r.peak, rating) } : r,
        ),
      };
    }

    const shownRating = () => useAuth.getState().me?.ratings.find((r) => r.key === PUZZLE.gameType)?.rating;
    const gets = () => auth.server.calls.filter((c) => c === 'GET /v1/me').length;

    /** Home → a 2-player search → found → GO; then Nina gives up, and I win: the results. */
    async function playAndWin(app: App): Promise<GameState> {
      await search(app, 2, 'מצא יריב');
      const { mm, table } = net();
      await server(() => mm.searching());
      await server(() => mm.found({ players: [ME_MATCH, NINA] }));
      await pass(100);
      await server(() => mm.ready([ME]));
      await countDownAndStart(app, [ME, OPP]);
      // A right digit of mine first: an opponent who leaves before my first move gives me no rating (§11.2).
      const game = table.game!;
      const cell = game.state.grid.findIndex((d) => d === 0);
      await press(`cell-${cellName(cell)}`);
      await pass(100);
      await press(`key-${Number(game.state.config.puzzle.solution[cell])}`);
      await pass(150);
      expect(game.state.players.find((p) => p.id === ME)!.correct).toBe(1);
      await server(() => void table.opponent({ type: 'surrender' }));
      const final = table.game!.state;
      expect(final.status).toBe('over');
      await passUntil(() => app.pathname() === `/results/${final.config.id}`);
      return final;
    }

    it('"לבית" before the server stored it: Home shows the new rating at once, never 1200 again', async () => {
      mockNet.players = [ME_MATCH, NINA].map(infoOf);
      // A ranked game knows me by the account's id (Me.id): the game's player id here.
      const { row, original } = freshAccount(ME);
      try {
        const app = await launch();
        await act(async () => refreshMe());
        expect(screen.getByTestId(`rating-${PUZZLE.gameType}`)).toHaveTextContent(/1200זמני$/);

        const final = await playAndWin(app);
        const mine = final.result!.ratingChanges.find((c) => c.playerId === ME)!;
        const after = Math.round(mine.after);
        expect(after).toBeGreaterThan(1200);
        // From the end on, the account shows the game's rating, and never the old one again.
        expect(shownRating()).toBe(mine.after);
        const seen: (number | undefined)[] = [];
        const unsubscribe = useAuth.subscribe(() => seen.push(shownRating()));

        await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
        await waitFor(() => expect(app.pathname()).toBe('/'));
        const card = () => screen.getByTestId(`rating-${PUZZLE.gameType}`);
        await waitFor(() => expect(card()).toHaveTextContent(new RegExp(`${after}זמני$`)));
        // The server is still writing: the reads (results' "לבית", the follow-up's) answer 1200, 0 games.
        const before = gets();
        await pass(5000, 250);
        expect(gets()).toBeGreaterThan(before);
        expect(card()).toHaveTextContent(new RegExp(`${after}זמני$`));
        expect(rankedRefresh().following).toMatchObject({ gameId: final.config.id });

        // Stored: the next read confirms it, and the reads stop.
        storeOnServer(row, mine.after);
        await passUntil(() => rankedRefresh().following === null, 30_000, 250);
        const confirmed = gets();
        await pass(30_000, 1000);
        expect(gets()).toBe(confirmed);
        expect(card()).toHaveTextContent(new RegExp(`${after}זמני$`));
        unsubscribe();
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((r) => r === mine.after)).toBe(true);
        app.unmount();
      } finally {
        row.me = { ...row.me, id: original.id };
      }
    });

    it('the results left with Android’s back (no "לבית"): the new rating comes once the server stored it', async () => {
      mockNet.players = [ME_MATCH, NINA].map(infoOf);
      const { row } = freshAccount();
      const app = await launch();
      await act(async () => refreshMe());
      expect(screen.getByTestId(`rating-${PUZZLE.gameType}`)).toHaveTextContent(/1200זמני$/);

      const final = await playAndWin(app);
      const mine = final.result!.ratingChanges.find((c) => c.playerId === ME)!;
      const after = Math.round(mine.after);
      // Android's back on the results: the game type, the session still in the store, nothing read on the way.
      await act(async () => router.back());
      await waitFor(() => expect(app.pathname()).toBe('/game-type'));
      expect(shownRating()).toBe(1200);

      // The server stores the game a moment later; the follow-up reads it, with no screen doing anything.
      await pass(1000, 250);
      storeOnServer(row, mine.after);
      await passUntil(() => shownRating() === mine.after, 30_000, 250);
      expect(rankedRefresh().following).toBeNull();

      // Home shows it.
      await act(async () => router.dismissTo('/'));
      await waitFor(() => expect(app.pathname()).toBe('/'));
      await waitFor(() =>
        expect(screen.getByTestId(`rating-${PUZZLE.gameType}`)).toHaveTextContent(
          new RegExp(`${after}זמני$`),
        ),
      );
      app.unmount();
    });
  });

  /**
   * Moshe's device test of 1.0.0 (15.10.2026): "הוא סיים את המשחק באמצע, קיבלתי מסך שחור. לפעמים גם קיבלתי מסך
   * שחור כשאני פרשתי". Every end that is not a full board, through the real routes: the final board holds
   * (motion.md `game.end`; 200 ms here, reduced motion), then the results; never an empty route, never a
   * fallback, nothing reported.
   */
  describe('the end of a ranked game in the middle, never a black screen (Moshe’s device test of 1.0.0)', () => {
    /** Home → a 2-player search → found → GO: the board, and my lock on its first free cell. */
    async function playWithALock(app: App): Promise<{ table: FakeTable }> {
      await search(app, 2, 'מצא יריב');
      const { mm, table } = net();
      await server(() => mm.searching());
      await server(() => mm.found({ players: [ME_MATCH, NINA] }));
      await pass(100);
      await server(() => mm.ready([ME]));
      await countDownAndStart(app, [ME, OPP]);
      const cell = table.game!.state.grid.findIndex((d) => d === 0);
      await press(`cell-${cellName(cell)}`);
      await pass(100);
      expect(table.game!.state.locks.some((l) => l.playerId === ME)).toBe(true);
      return { table };
    }

    /** Nothing went wrong on the way: no fallback, no report. */
    function noBlackScreen() {
      expect(screen.queryByTestId('flow-fallback')).toBeNull();
      expect(screen.queryByTestId('results-fallback')).toBeNull();
      expect(crash.recordError).not.toHaveBeenCalled();
    }

    beforeEach(() => {
      mockNet.players = [ME_MATCH, NINA].map(infoOf);
      crash.recordError.mockClear();
    });

    it('the opponent gives up while I hold a lock: the board holds, then "ניצחון!"; "לבית" goes home', async () => {
      const app = await launch();
      const { table } = await playWithALock(app);
      await server(() => void table.opponent({ type: 'surrender' }));
      const id = table.game!.state.config.id;
      await pass(100);
      // Over, and still the final board for a moment.
      expect(app.pathname()).toBe('/game');
      expect(screen.getByTestId('game')).toBeOnTheScreen();
      await passUntil(() => app.pathname() === `/results/${id}`);
      expect(await screen.findByTestId('results-title')).toHaveTextContent('ניצחון!');
      expect(screen.getByText(/היריב נכנע לפני שהלוח התמלא/)).toBeOnTheScreen();
      noBlackScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
      await waitFor(() => expect(app.pathname()).toBe('/'));
      expect(useGameStore.getState().online).toBeNull();
      noBlackScreen();
      app.unmount();
    });

    it('I give up while holding a lock: "הפסד", after the dialog and the hold', async () => {
      const app = await launch();
      const { table } = await playWithALock(app);
      await fireEvent.press(screen.getByRole('button', { name: 'כניעה' }));
      await pass(400);
      await fireEvent.press(
        within(screen.getByTestId('ranked-surrender')).getByRole('button', { name: 'כן, להיכנע' }),
      );
      const id = table.game!.state.config.id;
      await pass(100);
      expect(table.game!.state.status).toBe('over');
      expect(app.pathname()).toBe('/game');
      await passUntil(() => app.pathname() === `/results/${id}`);
      expect(await screen.findByTestId('results-title')).toHaveTextContent('הפסד');
      noBlackScreen();
      app.unmount();
    });

    it('the opponent leaves the game: "the opponent left", then "לתוצאות" → "ניצחון!"', async () => {
      const app = await launch();
      const { table } = await playWithALock(app);
      await server(() => void table.game!.apply({ type: 'disconnect', playerId: OPP }));
      const graceMs = table.game!.state.config.rules.graceMs;
      await passUntil(() => screen.queryByTestId('opponent-left') !== null, graceMs + 5000, 250);
      expect(app.pathname()).toBe('/game');
      // The results wait for "לתוצאות".
      await pass(3000, 250);
      expect(app.pathname()).toBe('/game');
      await fireEvent.press(screen.getByRole('button', { name: 'לתוצאות' }));
      await passUntil(() => app.pathname() === `/results/${table.game!.state.config.id}`);
      expect(await screen.findByTestId('results-title')).toHaveTextContent('ניצחון!');
      noBlackScreen();
      app.unmount();
    });

    it('"לבית" on "the opponent left": Home, and the finished game let go', async () => {
      const app = await launch();
      const { table } = await playWithALock(app);
      await server(() => void table.game!.apply({ type: 'disconnect', playerId: OPP }));
      const graceMs = table.game!.state.config.rules.graceMs;
      await passUntil(() => screen.queryByTestId('opponent-left') !== null, graceMs + 5000, 250);
      await fireEvent.press(
        within(screen.getByTestId('opponent-left')).getByRole('button', { name: 'לבית' }),
      );
      await waitFor(() => expect(app.pathname()).toBe('/'));
      await pass(500);
      expect(useGameStore.getState().online).toBeNull();
      expect(screen.getByTestId('home-scroll')).toBeOnTheScreen();
      noBlackScreen();
      app.unmount();
    });
  });
});
