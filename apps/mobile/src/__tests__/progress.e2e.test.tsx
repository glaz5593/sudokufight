// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';

import { levelFor, type League, leagueFor, xpForGame } from '@sudoku-fight/engine';
import type { Leaderboard, PracticeResult } from '@sudoku-fight/protocol';
import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import PlayerRoute from '../../app/player/[id]';
import InterferencesRoute from '../../app/interferences';
import { bodyOf, card, entry, type FakeCall, fakeFetch, ranked } from '../api/testing/fakeProgress';
import { initAuth, setAuthDeps, useAuth } from '../auth/authStore';
import { installSignedInPlayer } from '../auth/testing/testAuth';
import { ltr } from '../components/player';
import { useGameStore } from '../game/gameStore';
import { puzzleById } from '../game/offlinePool';
import { openPracticeRepo } from '../game/practiceRepo';
import { practiceStorageOrNull } from '../game/storage';
import { answerIn, emptyCellsOf } from '../game/testing/practice';
import { memoryDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { practiceFinished, practiceSync, setProgressFetch, startProgress } from '../progress/appProgress';
import { forgetProgress } from '../progress/progressStore';
import { renderApp } from '../screens/home/testing/homeTesting';
import { useSettings } from '../state/settings';

/**
 * Work plan stage 12, "סיום" on the app's side: after a few games, the XP, the level, the league and my place
 * on the leaderboard show what the server says, and practice XP reaches it [D41]. The server is a fake that
 * applies the engine's progress rules (as the real one does): XP per game, levels and leagues. (The app's
 * progress client and sync against the real server: apps/server/test/appProgress.contract.test.ts.)
 *
 * - A practice finished through the app's game store (the session's onFinish, as the game screen plays it) is
 *   queued and sent; the progress tab shows the XP the server answers, then a level up.
 * - The leaderboard: my pinned row follows my rating; a tap on another player's row opens their card.
 * - The interferences collection, from the progress tab: 3 open and 4 locked, "בקרוב".
 */

type Mocks = typeof import('../screens/home/testing/nativeMocks');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock(
  '../game/storage',
  () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').practiceStorage,
);
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').expoHaptics);

jest.setTimeout(60_000);

/** The server: my XP, rating and games; the rest of the board is fixed. */
const server = {
  xp: 0,
  rating: 1200,
  games: 0,
  taken: new Set<string>(),
};

const myLeague = (): League | null => (server.games >= 10 ? leagueFor(server.rating) : null);
const progressBody = () => {
  const level = levelFor(server.xp);
  return {
    xp: server.xp,
    level: level.level,
    xpIntoLevel: level.xpIntoLevel,
    xpForNext: level.xpForNext,
    league: myLeague(),
    leagueRating: server.games >= 10 ? server.rating : null,
  };
};

let myId = '';
const others = ranked(40);
const myRank = () => others.filter((e) => e.rating > server.rating).length + 1;
const meEntry = () =>
  entry({
    id: myId,
    displayName: 'MosheG',
    rank: myRank(),
    rating: server.rating,
    league: myLeague(),
    level: levelFor(server.xp).level,
    provisional: server.games < 10,
    games: server.games,
  });

const fetchFake = fakeFetch((call: FakeCall) => {
  const url = new URL(call.url);
  if (url.pathname === '/v1/me/progress') return { body: progressBody() };
  if (url.pathname === '/v1/me/practice-results') {
    const { results } = bodyOf(call) as { results: PracticeResult[] };
    let accepted = 0;
    for (const r of results) {
      if (server.taken.has(r.id)) continue;
      server.taken.add(r.id);
      accepted++;
      server.xp += xpForGame(
        r.mode === 'solo' ? { mode: 'solo' } : { mode: 'bot', won: r.outcome === 'win', correct: r.correct },
      );
    }
    return { body: { accepted, duplicates: results.length - accepted, progress: progressBody() } };
  }
  if (url.pathname === '/v1/leaderboard') {
    const tab = url.searchParams.get('tab') as Leaderboard['tab'];
    const board: Leaderboard = {
      tab,
      ratingKey: tab === 'general' || tab === 'friends' ? null : tab,
      players: null,
      entries: tab === 'friends' ? [] : others.slice(0, 20),
      me: server.games > 0 ? meEntry() : null,
      nextCursor: null,
      friends: tab === 'friends' ? { recentOpponents: [], inviteUrl: null } : null,
    };
    return { body: board };
  }
  if (url.pathname === `/v1/players/${myId}`)
    return {
      body: card({ id: myId, level: levelFor(server.xp).level, xp: server.xp, league: myLeague() }),
    };
  const other = others.find((e) => url.pathname === `/v1/players/${e.id}`);
  if (other)
    return {
      body: card({
        id: other.id,
        displayName: other.displayName,
        level: other.level,
        league: other.league,
        country: 'FR',
        xp: 4000,
      }),
    };
  return { status: 404, body: { error: 'notFound' } };
});

/** Lets the promise chains run (the router's fake timers are on: microtasks only). */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 200; i++) await Promise.resolve();
  });

const botWin = (id: string, correct: number) =>
  practiceFinished({
    id,
    mode: 'bot',
    gameType: 'normal',
    playerId: 'me',
    result: {
      reason: 'boardComplete',
      ranking: [
        { playerId: 'me', seat: 0, place: 1, score: 40, mistakes: 0, correct, status: 'active' },
        { playerId: 'bot', seat: 1, place: 2, score: 20, mistakes: 1, correct: 10, status: 'active' },
      ],
    },
    endedAt: 1,
  });

let stop: (() => void) | null = null;

beforeEach(async () => {
  jest.useRealTimers();
  const repo = await openPracticeRepo(await memoryDb());
  jest.mocked(practiceStorageOrNull).mockImplementation(async () => repo);
  useSettings.setState({ reduceMotion: 'on' });
  await i18n.changeLanguage('he');
  setProgressFetch(fetchFake);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  useGameStore.getState().clear();
  stop?.();
  practiceSync().stop();
  setProgressFetch(null);
  forgetProgress();
  setAuthDeps(null);
  jest.restoreAllMocks();
});

describe('progress, end to end (work plan stage 12 "סיום")', () => {
  it('practice XP, the level, the league and my place on the leaderboard follow the games', async () => {
    await installSignedInPlayer({ displayName: 'MosheG' });
    await initAuth();
    myId = useAuth.getState().me!.id;
    stop = startProgress();
    await settle();

    const app = await renderApp('/achievements', {
      'player/[id]': PlayerRoute,
      interferences: InterferencesRoute,
    });
    await waitFor(() => expect(screen.getByTestId('progress-xp')).toHaveTextContent(ltr('0 / 200 XP')));
    expect(screen.getByLabelText('רמה 1')).toBeTruthy();
    expect(screen.getByTestId('progress-league-line')).toHaveTextContent(
      'הליגה תופיע אחרי 10 משחקים מדורגים באחד מסוגי המשחק',
    );

    // A solo practice, played to the end through the game store (as the game screen plays it): its end
    // queues the result, and the sync sends it [D41]. Solo: 10 XP.
    const session = (await useGameStore.getState().startPractice({ gameType: 'fast' }))!;
    const puzzle = puzzleById(session.puzzleId)!;
    await act(async () => {
      for (const cell of emptyCellsOf(puzzle)) {
        session.host.select(cell);
        session.host.place(cell, answerIn(puzzle, cell));
      }
    });
    expect(session.getView().status).toBe('over');
    await settle();
    await waitFor(() => expect(screen.getByTestId('progress-xp')).toHaveTextContent(ltr('10 / 200 XP')));
    expect([...server.taken]).toEqual([session.id]);

    // Two practices against a bot and one alone [D41]: 50 + 30, 50 + 40, 10: 190 XP in all.
    await act(async () => {
      botWin('practice-1', 30);
      botWin('practice-2', 40);
    });
    await settle();
    await act(async () => {
      practiceFinished({
        id: 'practice-3',
        mode: 'solo',
        gameType: 'fast',
        playerId: 'me',
        result: { reason: 'boardComplete', ranking: [] },
        endedAt: 2,
      });
    });
    await settle();
    await waitFor(() => expect(screen.getByTestId('progress-xp')).toHaveTextContent(ltr('190 / 200 XP')));
    expect(server.xp).toBe(190);
    // One more: past 200, level 2 (it needs 400 more).
    await act(async () => botWin('practice-4', 20));
    await settle();
    await waitFor(() => expect(screen.getByTestId('progress-xp')).toHaveTextContent(ltr('60 / 400 XP')));
    expect(screen.getByLabelText('רמה 2')).toBeTruthy();
    // The same game again counts once.
    await act(async () => botWin('practice-4', 20));
    await settle();
    expect(server.xp).toBe(260);

    // Ranked games (on the server): ten of them settle a league.
    server.games = 10;
    server.rating = 1287;
    await fireEvent.press(screen.getByRole('tab', { name: 'טבלת מובילים' }));
    await settle();
    expect(app.pathname()).toBe('/leaderboard');
    const rankBefore = myRank();
    expect(await screen.findByTestId('leaderboard-me-row')).toHaveProp(
      'accessibilityLabel',
      `מקום ${rankBefore}, MosheG (אתה), ישראל, ליגת זהב, רמה 2, דירוג 1287`,
    );

    // A few wins later: a higher rating, a better place, after a pull to refresh.
    server.rating = 1452;
    server.games = 14;
    await act(async () => {
      screen.getByTestId('leaderboard-list').props.refreshControl.props.onRefresh();
    });
    await settle();
    expect(myRank()).toBeLessThan(rankBefore);
    await waitFor(() =>
      expect(screen.getByTestId('leaderboard-me-row')).toHaveProp(
        'accessibilityLabel',
        `מקום ${myRank()}, MosheG (אתה), ישראל, ליגת יהלום, רמה 2, דירוג 1452`,
      ),
    );

    // My card, from the leaderboard: the level and the league it says now.
    await fireEvent.press(screen.getByRole('button', { name: 'כרטיס השחקן שלי' }));
    await settle();
    expect(app.pathname()).toBe(`/player/${myId}`);
    expect(
      await screen.findByLabelText('MosheG, הכרטיס שלי, ישראל, במשחק מאז אפריל 2026, ליגת יהלום, רמה 2'),
    ).toBeTruthy();
  });

  it("a tap on a leaderboard row opens that player's card (spec §14.2, §14.3)", async () => {
    await installSignedInPlayer({ displayName: 'MosheG' });
    await initAuth();
    myId = useAuth.getState().me!.id;
    stop = startProgress();
    await settle();

    const app = await renderApp('/leaderboard', { 'player/[id]': PlayerRoute });
    const row = await screen.findByTestId('leaderboard-row-p5');
    expect(row).toHaveProp('accessibilityLabel', expect.stringContaining('Player5'));
    await fireEvent.press(row);
    await settle();
    expect(app.pathname()).toBe('/player/p5');
    // Their card, not mine: name, country, league and level, as the server sent them.
    expect(await screen.findByLabelText('Player5, צרפת, במשחק מאז אפריל 2026, ליגת זהב, רמה 5')).toBeTruthy();
    expect(screen.queryByLabelText(/הכרטיס שלי/)).toBeNull();
  });

  it('the interferences collection, from the progress tab: 3 open, 3 at their levels, 4 "בקרוב" (stage 12, D47)', async () => {
    await installSignedInPlayer({ displayName: 'MosheG' });
    await initAuth();
    stop = startProgress();
    await settle();

    const app = await renderApp('/achievements', { interferences: InterferencesRoute });
    await fireEvent.press(await screen.findByTestId('progress-interferences'));
    await settle();
    expect(app.pathname()).toBe('/interferences');
    // The three first open from the start; the scramble, ink and the keypad at levels 2, 3 and 4 [D17] (this
    // player's level depends on the games the tests before this one played).
    const count = await screen.findByLabelText(/^\d+ מתוך 10 הפרעות פתוחות$/);
    const open = screen.getAllByTestId(/^interferences-open-/).length;
    expect(open).toBeGreaterThanOrEqual(3);
    expect(count.props.accessibilityLabel).toBe(`${open} מתוך 10 הפרעות פתוחות`);
    const locked = screen.getAllByTestId(/^interferences-locked-/).map((l) => l.props.accessibilityLabel);
    expect(open + locked.length).toBe(10);
    expect(locked.slice(0, -4).every((l) => /, נעול, נפתח ברמה [234]$/.test(l))).toBe(true);
    expect(locked.slice(-4)).toEqual([
      'רעידת אדמה, נעול, בקרוב',
      'ערפל, נעול, בקרוב',
      'בועות, נעול, בקרוב',
      'פנס, נעול, בקרוב',
    ]);
  });
});
