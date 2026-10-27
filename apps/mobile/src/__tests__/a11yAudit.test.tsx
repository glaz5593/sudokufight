// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { type FindLevelOver, levelOutcome, type PlayerInfo } from '@sudoku-fight/engine';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import AccountSuspendedRoute from '../../app/account-suspended';
import AchievementsRoute from '../../app/achievements';
import BlockedPlayersRoute from '../../app/blocked-players';
import BotSelectRoute from '../../app/bot-select';
import ChooseNameRoute from '../../app/choose-name';
import DesignSystemRoute from '../../app/dev/design-system';
import HelloRoute from '../../app/dev/hello';
import EditProfileRoute from '../../app/edit-profile';
import ForgotPasswordRoute from '../../app/forgot-password';
import GameRoute from '../../app/game';
import GameTypeRoute from '../../app/game-type';
import HistoryRoute from '../../app/history';
import Index from '../../app/index';
import InterferencesRoute from '../../app/interferences';
import LeaderboardRoute from '../../app/leaderboard';
import LevelsRoute from '../../app/levels/index';
import LevelPlayRoute, { LevelPlayFlow, type LevelPlayingProps } from '../../app/levels/play';
import LoginRoute from '../../app/login';
import MatchRoute from '../../app/match/index';
import ModesRoute from '../../app/modes';
import PlayerRoute from '../../app/player/[id]';
import RegisterAccountRoute from '../../app/register/account';
import RegisterFighterRoute from '../../app/register/fighter';
import ReplayRoute from '../../app/replay/[id]';
import ResultsRoute from '../../app/results/[id]';
import SettingsRoute from '../../app/settings';
import VerifyEmailRoute from '../../app/verify-email';
import { createFakeModeration, type FakeModeration } from '../api/testing/fakeModeration';
import { board, card, type FakeCall, fakeFetch, myProgress, ranked } from '../api/testing/fakeProgress';
import { initAuth, setAuthDeps, useAuth } from '../auth/authStore';
import { installSignedInPlayer, installTestAuth } from '../auth/testing/testAuth';
import { type RankedDeps, useGameStore } from '../game/gameStore';
import { openPracticeRepo, type PracticeRepo } from '../game/practiceRepo';
import { practiceStorageOrNull } from '../game/storage';
import { firstBossOf, firstLevelOf, levelsOf } from '../levels/__tests__/helpers/levelsOf';
import { levelById } from '../levels/levelsData';
import { answerIn, emptyCellsOf, PUZZLE } from '../game/testing/practice';
import { memoryDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { blockPlayer, resetBlocks, setModerationApi } from '../moderation/moderation';
import { setHealthCheck } from '../net/connectivity';
import { FakeMatchmaking } from '../net/testing/fakeMatchmaking';
import { elapse, FakeTable, ME, OPP } from '../net/testing/fakeServer';
import { setProgressFetch } from '../progress/appProgress';
import { forgetProgress } from '../progress/progressStore';
import { pass } from '../screens/game/testing/online';
import { seedBotPractices, seedPractices } from '../screens/home/testing/seed';
import { fakeHistoryApi, rankedDuel } from '../screens/replay/testing/sources';
import type { HistoryApi } from '../screens/history/historyApi';
import { useTutorials } from '../screens/levels/HowToPlay';
import { useProfile } from '../state/profile';
import { useSettings } from '../state/settings';
import { auditA11y, hebrewTexts, isThemeColour, MIN_TARGET, THEME_COLOURS } from '../testing/a11yAudit';
import { color } from '../theme';

/**
 * Work plan stage 13, the accessibility audit (spec §22, CLAUDE.md): every route of the app, rendered through
 * expo-router with a signed-in account (the development sign-in, the fake account server), the phone's
 * practice database (sql.js, with saved practices), the progress and history servers in memory and the fake
 * game and matchmaking servers, in Hebrew and in English. On every screen:
 *
 * - every pressable has an accessibilityRole and a name (an accessibilityLabel, or its text);
 * - every touch target is at least 44 × 44 with its hitSlop, where the style fixes its size;
 * - no pressable is buried inside another screen-reader element (iOS would never reach it);
 * - no text has a colour outside the theme (a raw hex).
 *
 * The screens that announce for screen readers have their live region (the game's moves, the connection's
 * states, the modes' connectivity).
 */

const mockApp: {
  repo: PracticeRepo | null;
  history: (HistoryApi & { calls: string[] }) | null;
  ranked: () => RankedDeps;
} = {
  repo: null,
  history: null,
  ranked: () => {
    throw new Error('no ranked deps');
  },
};

type Mocks = typeof import('../screens/home/testing/nativeMocks');
type MockWiring = typeof import('../screens/history/appWiring');

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock(
  '../game/storage',
  () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').practiceStorage,
);
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').expoHaptics);
jest.mock('../net/matchmakingDevice', () => ({ deviceMatchmakingDeps: () => mockApp.ranked() }));
// The dev screen's echo check brings the network SDK: connected, without one.
jest.mock('../net/useEchoRtt', () => ({ useEchoRtt: () => ({ kind: 'connected', rttMs: 42, samples: 3 }) }));
jest.mock('../screens/history/appWiring', () => {
  const actual = jest.requireActual<MockWiring>('../screens/history/appWiring');
  return {
    signedInHistoryApi: () => mockApp.history,
    appHistoryDeps: () => ({ ...actual.appHistoryDeps(), ranked: mockApp.history }),
    appReplayDeps: () => ({ ...actual.appReplayDeps(), ranked: mockApp.history }),
  } satisfies MockWiring;
});

jest.setTimeout(120_000);

/**
 * Staged practice's result (1.0.2): a stage that ends as soon as it starts, with ★★★, so the result is audited.
 * The stage screens themselves (2ח) add their own rows for /levels/play.
 */
function AuditStage({ level, onFinished }: LevelPlayingProps) {
  useEffect(() => {
    const end: FindLevelOver = {
      reason: 'targetReached',
      elapsedMs: 4000,
      penaltyMs: 0,
      spots: 1,
      found: 0,
      stars: 3,
    };
    onFinished({
      outcome: levelOutcome(level, end),
      finished: null,
      mistakes: 1,
      opponent: null,
      bestMove: null,
      why: null,
    });
  }, [level, onFinished]);
  return null;
}

const ROUTES = {
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
  interferences: InterferencesRoute,
  'player/[id]': PlayerRoute,
  'levels/index': LevelsRoute,
  'levels/play': () => <LevelPlayFlow Playing={AuditStage} />,
  // The real stage route (its stage screens, 2ח) under a key of its own: the result case above keeps its stand-in.
  'levels/stage': LevelPlayRoute,
  login: LoginRoute,
  'forgot-password': ForgotPasswordRoute,
  'register/fighter': RegisterFighterRoute,
  'register/account': RegisterAccountRoute,
  'verify-email': VerifyEmailRoute,
  'edit-profile': EditProfileRoute,
  'blocked-players': BlockedPlayersRoute,
  'choose-name': ChooseNameRoute,
  'account-suspended': AccountSuspendedRoute,
  'dev/hello': HelloRoute,
  'dev/design-system': DesignSystemRoute,
};

/** The progress server: my progress, the boards, the cards. */
const progressFetch = fakeFetch((call: FakeCall) => {
  const url = new URL(call.url);
  const myId = useAuth.getState().me?.id ?? 'me';
  if (url.pathname === '/v1/me/progress') return { body: myProgress() };
  if (url.pathname === '/v1/me/practice-results')
    return { body: { accepted: 0, duplicates: 0, progress: myProgress() } };
  if (url.pathname === '/v1/leaderboard') {
    const tab = (url.searchParams.get('tab') ?? 'general') as 'general';
    return {
      body: board({
        tab,
        entries: ranked(12),
        me: { ...ranked(1, 30)[0]!, id: myId, displayName: 'Tester' },
      }),
    };
  }
  const player = url.pathname.match(/^\/v1\/players\/(.+)$/);
  if (player)
    return { body: card({ id: player[1]!, displayName: player[1] === myId ? 'Tester' : 'NinaVolt' }) };
  return { status: 404, body: { error: 'notFound' } };
});

/**
 * The board's 81 cells are let off 44 × 44: nine of them span the board (about 38 dp each on a 360 dp phone),
 * and they tile it edge to edge, their hitSlop reaching the grid lines, so a tap anywhere on the board lands on
 * a cell (WCAG 2.5.8's spacing exception). This and the keypad's keys (flex, about 36 × 60, 40 × 64 with
 * their hitSlop; not measured here, their width is the layout's) are open point 1 of components.md §17, for
 * Moshe. Everything else is 44.
 */
const isBoardCell = (node: { props: { testID?: unknown } }) =>
  typeof node.props.testID === 'string' && /^(replay-board-)?cell-[A-I][1-9]$/.test(node.props.testID);

/** Lets the promise chains run (the router's fake timers are on: microtasks only), and the timers a little. */
const settle = (ms = 0) =>
  act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
    if (ms) jest.advanceTimersByTime(ms);
    for (let i = 0; i < 50; i++) await Promise.resolve();
  });

/** A ranked search on the fake matchmaking server (as the ranked e2e test wires it). */
function rankedWiring({ offline = false }: { offline?: boolean } = {}) {
  const players: PlayerInfo[] = [
    { id: ME, name: 'Tester', rating: 1200, ratedGames: 0 },
    { id: OPP, name: 'NinaVolt', rating: 1305, ratedGames: 12 },
  ];
  const net: { table: FakeTable | null; mm: FakeMatchmaking | null } = { table: null, mm: null };
  mockApp.ranked = () => {
    const table = new FakeTable({ players });
    table.clock.set(Date.now());
    const mm = new FakeMatchmaking(table.clock, table.scheduler);
    mm.rating = 1200;
    mm.offline = offline;
    net.table = table;
    net.mm = mm;
    return {
      connector: mm,
      clock: table.clock,
      scheduler: table.scheduler,
      track: () => undefined,
      makeHost: () => table.host,
    };
  };
  return net;
}

/** The online game of the case at hand (its fake server). */
let table: FakeTable | null = null;

/** An online game in the store (the dev room of stage 7): started, its board on screen. */
async function onlineGame(players?: PlayerInfo[]) {
  table = new FakeTable(players ? { players } : {});
  const session = useGameStore
    .getState()
    .startOnline(
      { kind: 'create', options: { gameType: 'fast', playerCount: players?.length ?? 2 } },
      () => table!.host,
    );
  await session.ready;
  table.lobby();
  table.startGame();
  await elapse(table, 300);
  return { table, session };
}

/** Taps an element (hidden ones too: a modal's content is drawn under its own root). */
const tap = (testID: string) => fireEvent.press(screen.getByTestId(testID, { includeHiddenElements: true }));

const TWO_PLAYERS = async () => void (await onlineGame());

interface Case {
  name: string;
  url: string | (() => string);
  /** The state before the route renders. */
  setup?: () => Promise<void> | void;
  /** After the first render: drive the screen into the state to audit. */
  drive?: () => Promise<void>;
  /** A testID that says the screen is drawn. */
  ready: string;
  /** A testID that must be there after `drive` (the state it drove to). */
  shows?: string;
  /** Signed out (the account screens). */
  signedOut?: boolean;
  /** A live region the screen must have (screen-reader announcements). */
  live?: string;
}

let rankedNet: ReturnType<typeof rankedWiring> | null = null;

const ids: { ended: string; interrupted: string; won: string; lost: string } = {
  ended: '',
  interrupted: '',
  won: '',
  lost: '',
};

const CASES: Case[] = [
  // ---- signed out: the account screens
  { name: 'login', url: '/login', ready: 'login', signedOut: true },
  { name: 'forgot password', url: '/forgot-password', ready: 'forgot-password', signedOut: true },
  { name: 'register: fighter', url: '/register/fighter', ready: 'register-fighter', signedOut: true },
  { name: 'register: account', url: '/register/account', ready: 'register-account', signedOut: true },
  // ---- signed in
  { name: 'verify email', url: '/verify-email', ready: 'verify-email' },
  { name: 'home', url: '/', ready: 'home-scroll' },
  {
    name: 'home, offline (spec §16.1)',
    url: '/',
    setup: () => setHealthCheck(async () => false),
    drive: () => settle(100),
    ready: 'home-scroll',
    shows: 'home-offline',
    live: 'home-live',
  },
  { name: 'modes', url: '/modes', ready: 'mode-solo', live: 'modes-live' },
  {
    name: 'modes, offline (spec §16.1)',
    url: '/modes',
    setup: () => setHealthCheck(async () => false),
    drive: () => settle(100),
    ready: 'mode-solo',
    shows: 'offline-banner',
    live: 'modes-live',
  },
  { name: 'game type: solo', url: '/game-type?mode=solo', ready: 'start' },
  {
    name: 'game type: ranked',
    url: '/game-type?mode=ranked&players=2',
    ready: 'start',
    live: 'game-type-live',
  },
  { name: 'bot select', url: '/bot-select?gameType=fast', ready: 'start' },
  { name: 'settings', url: '/settings', ready: 'setting-language' },
  { name: 'edit profile', url: '/edit-profile', ready: 'edit-profile' },
  { name: 'leaderboard', url: '/leaderboard', ready: 'leaderboard' },
  { name: 'history', url: '/history', ready: 'history' },
  { name: 'achievements', url: '/achievements', ready: 'progress' },
  { name: 'interferences', url: '/interferences', ready: 'interferences' },
  { name: 'my player card', url: () => `/player/${useAuth.getState().me!.id}`, ready: 'player-card' },
  // ---- reporting and blocking (spec §3.5)
  { name: "another player's card: report and block", url: '/player/nina', ready: 'player-moderation' },
  {
    name: 'player card: the report sheet',
    url: '/player/nina',
    ready: 'player-moderation',
    drive: () => tap('player-moderation-report'),
    shows: 'report-sheet-send',
  },
  {
    name: 'player card: the block confirmation',
    url: '/player/nina',
    ready: 'player-moderation',
    drive: () => tap('player-moderation-block'),
    shows: 'block-confirm-confirm',
  },
  {
    name: 'blocked players',
    url: '/blocked-players',
    setup: async () => void (await blockPlayer('nina')),
    ready: 'blocked-list',
  },
  { name: 'blocked players: none', url: '/blocked-players', ready: 'blocked-empty' },
  { name: 'choose a new name (an admin reset it)', url: '/choose-name', ready: 'choose-name' },
  { name: 'account suspended', url: '/account-suspended', ready: 'account-suspended' },
  { name: "another player's card", url: '/player/p7', ready: 'player-card' },
  { name: 'replay: a practice', url: () => `/replay/${ids.ended}?source=practice`, ready: 'replay' },
  { name: 'replay: a bot game', url: () => `/replay/${ids.won}?source=practice`, ready: 'replay' },
  { name: 'replay: a ranked game', url: '/replay/ranked-1?source=ranked', ready: 'replay' },
  { name: 'results: a practice', url: () => `/results/${ids.ended}`, ready: 'results-title' },
  { name: 'results: a bot win', url: () => `/results/${ids.won}`, ready: 'results-title' },
  { name: 'results: a bot loss', url: () => `/results/${ids.lost}`, ready: 'results-title' },
  {
    name: 'game: solo practice',
    url: '/game',
    setup: async () => void (await useGameStore.getState().startPractice({ gameType: 'fast' })),
    ready: 'game',
    live: 'game-live',
  },
  {
    name: 'game: against a bot',
    url: '/game',
    setup: async () =>
      void (await useGameStore.getState().startBotPractice({ gameType: 'normal', level: 2 })),
    ready: 'game',
    live: 'game-live',
  },
  {
    name: 'game: online, 2 players',
    url: '/game',
    setup: async () => void (await onlineGame()),
    ready: 'game',
    live: 'game-live',
  },
  {
    name: 'game: online, 4 players',
    url: '/game',
    setup: async () =>
      void (await onlineGame([
        { id: ME, name: 'Tester', rating: 1200, ratedGames: 0 },
        { id: OPP, name: 'NinaVolt', rating: 1305, ratedGames: 12 },
        { id: 'p3', name: 'Ziv', rating: 1250, ratedGames: 12 },
        { id: 'p4', name: 'Lea', rating: 1190, ratedGames: 12 },
      ])),
    ready: 'game',
    live: 'game-live',
  },
  {
    name: 'match: searching',
    url: '/match',
    setup: () => {
      rankedNet = rankedWiring();
      useGameStore.getState().startRanked({ gameType: 'fast', players: 2 }, mockApp.ranked);
    },
    drive: () =>
      act(async () => {
        rankedNet!.mm!.searching({ elapsedMs: 12_000 });
        await elapse(rankedNet!.table!, 100);
      }),
    ready: 'match-search',
    live: 'match-search-live',
  },
  // ---- overlays and dialogs
  // The language picker (localization plan 0י): its sheet, and the prompt once a language is chosen in it.
  {
    name: 'settings: the language sheet',
    url: '/settings',
    drive: async () => {
      await tap('setting-language');
      await settle(1000);
    },
    ready: 'setting-language',
    shows: 'setting-language-system',
  },
  {
    name: 'settings: the language prompt',
    url: '/settings',
    drive: async () => {
      await tap('setting-language');
      await settle(1000);
      await tap(`setting-language-${useSettings.getState().language === 'he' ? 'en' : 'he'}`);
      await settle(1000);
    },
    ready: 'setting-language',
    shows: 'language-confirm-confirm',
  },
  {
    name: 'settings: delete the account',
    url: '/settings',
    drive: async () => {
      await tap('settings-delete');
      await tap('delete-confirm-confirm');
    },
    ready: 'setting-language',
    shows: 'delete-password-input',
  },
  {
    name: 'game: "end practice"',
    url: '/game',
    setup: async () => void (await useGameStore.getState().startPractice({ gameType: 'fast' })),
    drive: () => tap('end-practice-button'),
    ready: 'game',
    shows: 'end-practice-confirm',
  },
  {
    name: 'game: surrender',
    url: '/game',
    setup: TWO_PLAYERS,
    drive: () => tap('surrender'),
    ready: 'game',
    shows: 'ranked-surrender',
  },
  {
    name: 'game: reactions',
    url: '/game',
    setup: TWO_PLAYERS,
    drive: () => tap('reactions'),
    ready: 'game',
    shows: 'reaction-picker',
  },
  {
    name: 'game: the interference picker (two taps, D45)',
    url: '/game',
    setup: TWO_PLAYERS,
    drive: async () => {
      // Points to spend first: a few right digits of mine.
      const host = useGameStore.getState().online!.host;
      for (const cell of emptyCellsOf(PUZZLE).slice(0, 6)) {
        await act(async () => {
          host.select(cell);
          host.place(cell, answerIn(PUZZLE, cell));
        });
        await pass(table!, 1500);
      }
      await tap('interfere');
      await settle(400);
    },
    ready: 'game',
    shows: 'arsenal-sheet',
    live: 'arsenal-live',
  },
  // ---- the connection (spec §16.2, §16.3)
  {
    name: 'game: the opponent reconnecting',
    url: '/game',
    setup: TWO_PLAYERS,
    drive: async () => {
      table!.game!.apply({ type: 'disconnect', playerId: OPP });
      await pass(table!, 600);
    },
    ready: 'game',
    live: 'opponent-reconnecting-live',
    shows: 'opponent-reconnecting',
  },
  {
    // The soft phase [D42]: nothing over the game, only the mark and one announcement.
    name: 'game: my connection lost, the soft phase',
    url: '/game',
    setup: TWO_PLAYERS,
    drive: async () => {
      table!.offline = true;
      table!.cutMe();
      await pass(table!, 1500);
    },
    ready: 'game',
    live: 'self-offline-announcer',
    shows: 'board-room',
  },
  {
    name: 'game: my connection lost',
    url: '/game',
    setup: TWO_PLAYERS,
    drive: async () => {
      table!.offline = true;
      table!.cutMe();
      // Past the soft phase [D42] (10 s): the hard phase's screen.
      await pass(table!, 11_000, 250);
    },
    ready: 'game',
    live: 'self-reconnecting-live',
    shows: 'self-reconnecting',
  },
  {
    name: 'game: the opponent left',
    url: '/game',
    setup: TWO_PLAYERS,
    drive: async () => {
      table!.game!.apply({ type: 'disconnect', playerId: OPP });
      await pass(table!, 16_500, 250);
    },
    ready: 'game',
    live: 'opponent-left-live',
    shows: 'opponent-left',
  },
  {
    name: 'game: connection error',
    url: '/game',
    setup: () => {
      table = new FakeTable();
      table.offline = true;
      useGameStore.getState().startOnline({ kind: 'join', code: 'ABC234' }, () => table!.host);
    },
    drive: () => pass(table!, 20_000, 250),
    ready: 'online-game',
    live: 'connection-error-live',
    shows: 'connection-error',
  },
  {
    name: 'results: an online win',
    url: '/game',
    setup: TWO_PLAYERS,
    drive: async () => {
      table!.opponent({ type: 'surrender' });
      await pass(table!, 600);
      await screen.findByTestId('results-title', { includeHiddenElements: true });
      await settle(2000);
    },
    ready: 'game',
    shows: 'results-title',
  },
  {
    name: 'match: found',
    url: '/match',
    setup: () => {
      rankedNet = rankedWiring();
      useGameStore.getState().startRanked({ gameType: 'fast', players: 2 }, mockApp.ranked);
    },
    drive: () =>
      act(async () => {
        rankedNet!.mm!.found();
        await elapse(rankedNet!.table!, 100);
      }),
    ready: 'match-search',
    live: 'match-found-live',
    shows: 'match-found',
  },
  {
    name: 'match: no match yet',
    url: '/match',
    setup: () => {
      rankedNet = rankedWiring();
      useGameStore.getState().startRanked({ gameType: 'fast', players: 2 }, mockApp.ranked);
    },
    drive: () =>
      act(async () => {
        rankedNet!.mm!.timeout();
        await elapse(rankedNet!.table!, 100);
      }),
    ready: 'match-search',
    live: 'match-timeout-live',
    shows: 'match-timeout',
  },
  {
    name: 'match: nobody else is searching',
    url: '/match',
    setup: () => {
      rankedNet = rankedWiring();
      useGameStore.getState().startRanked({ gameType: 'fast', players: 2 }, mockApp.ranked);
    },
    drive: () =>
      act(async () => {
        rankedNet!.mm!.searching({ nextRange: null });
        await elapse(rankedNet!.table!, 100);
      }),
    ready: 'match-search',
    live: 'match-search-live',
    shows: 'match-search-alone',
  },
  {
    name: 'match: no connection',
    url: '/match',
    setup: () => {
      rankedNet = rankedWiring({ offline: true });
      useGameStore.getState().startRanked({ gameType: 'fast', players: 2 }, mockApp.ranked);
    },
    drive: () => settle(1000),
    ready: 'match-error',
    live: 'match-error-live',
  },
  // ---- staged practice (1.0.2): the map, a locked gate's sheet, a stage's result
  { name: 'levels: the map', url: '/levels', ready: 'level-map' },
  {
    name: 'levels: a locked gate’s sheet',
    url: '/levels',
    ready: 'level-map',
    drive: () => tap('gate-2'),
    shows: 'gate-sheet-primary',
  },
  {
    name: 'levels: the chapter list',
    url: '/levels',
    ready: 'level-map',
    drive: () => tap('level-map-total'),
    shows: 'chapter-jump-30',
  },
  {
    name: 'levels: a stage’s result',
    url: `/levels/play?id=${firstLevelOf('find', 1).id}`,
    setup: () => void useTutorials.setState({ seen: { find: true, fillBox: true, boss: true } }),
    drive: () => settle(2500),
    ready: 'level-ready',
    shows: 'level-result',
  },
  {
    // A boss's opening, in place of "מוכן?" (levels-ui.md §3.2, D77): chapter 1's, the race against Pip.
    name: 'levels: a boss’s opening',
    url: `/levels/play?id=${firstBossOf('findDuel', 1).id}`,
    setup: () => void useTutorials.setState({ seen: { findDuel: true, boss: true } }),
    drive: () => settle(1000),
    ready: 'level-ready',
    shows: 'boss-intro',
  },
  // ---- staged practice: the stage screens themselves (2ח), one per kind, after "מוכן?" (each picked by its kind,
  // never by id: a rebuild may give an id another kind; levels/__tests__/helpers/levelsOf)
  ...(
    [
      ['find (kind 1)', firstLevelOf('find', 1).id, 'tap-level', 'level-live'],
      ['the race (kind 2)', firstLevelOf('findDuel').id, 'race-hud', 'level-live'],
      ['fill the box (kind 3)', firstLevelOf('fillBox', 1).id, 'box-hud', 'game-live'],
      ['the duel (kind 4)', firstLevelOf('duel').id, 'duel-hud', 'game-live'],
      ['a boss (the duel)', firstBossOf('duel').id, 'stage-boss', 'game-live'],
      // 1.0.3 (levels-ui.md §10): the puzzle (its nine box buttons), fill the row and the column, the race boss.
      ['the puzzle', firstLevelOf('puzzle').id, 'puzzle-board', 'level-live'],
      ['fill the row', firstLevelOf('fillRow').id, 'box-hud', 'game-live'],
      ['fill the column', firstLevelOf('fillCol').id, 'box-hud', 'game-live'],
      ['a boss (the race)', firstBossOf('findDuel').id, 'stage-boss', 'level-live'],
      // The three ideas (2ט): spot the error with its tip card, the point hunter, the chain.
      ['spot the error', levelsOf('spotError')[0]!.id, 'spot-tip', 'level-live'],
      ['the point hunter', levelsOf('pointHunter')[0]!.id, 'hunt-hud', 'game-live'],
      ['the chain', levelsOf('chain')[0]!.id, 'chain-hud', 'game-live'],
    ] as const
  ).map(([kind, id, shows, live]): Case => ({
    name: `levels: a stage, ${kind}`,
    url: `/levels/stage?id=${id}`,
    setup: () =>
      void useTutorials.setState({
        seen: {
          find: true,
          findDuel: true,
          fillBox: true,
          fillRow: true,
          fillCol: true,
          puzzle: true,
          duel: true,
          boss: true,
          spotError: true,
          pointHunter: true,
          chain: true,
        },
      }),
    drive: async () => {
      // "מוכן?" (2 s), or a boss's opening in its place (LEVEL_UI.bossReadyMs, 3 s; D77), for any boss.
      await settle(levelById(id)?.boss ? 3500 : 2500);
      await settle(100);
    },
    ready: 'level-ready',
    shows,
    live,
  })),
  {
    name: 'levels: a stage’s exit dialog',
    url: `/levels/stage?id=${firstLevelOf('find', 1).id}`,
    setup: () => void useTutorials.setState({ seen: { find: true } }),
    drive: async () => {
      await settle(2500);
      await settle(100);
      await tap('stage-exit');
      await settle(400);
    },
    ready: 'level-ready',
    shows: 'level-exit-confirm',
  },
  {
    name: 'levels: "איך משחקים" with its pictures',
    url: `/levels/stage?id=${firstLevelOf('findDuel').id}`,
    setup: () => void useTutorials.setState({ seen: {} }),
    ready: 'how-to-play',
    shows: 'how-to-play-board-findDuel-1',
  },
  {
    name: 'levels: "איך משחקים" of the puzzle (the lock, the held box)',
    url: `/levels/stage?id=${firstLevelOf('puzzle').id}`,
    setup: () => void useTutorials.setState({ seen: {} }),
    ready: 'how-to-play',
    shows: 'how-to-play-board-puzzle-1',
  },
  {
    name: 'levels: "איך משחקים" of an idea (spot the error)',
    url: `/levels/stage?id=${levelsOf('spotError')[0]!.id}`,
    setup: () => void useTutorials.setState({ seen: {} }),
    ready: 'how-to-play',
    shows: 'how-to-play-board-spotError-1',
  },
  { name: 'dev: hello', url: '/dev/hello', ready: 'versions' },
  { name: 'dev: design system', url: '/dev/design-system', ready: 'design-system' },
];

beforeAll(async () => {
  mockApp.repo = await openPracticeRepo(await memoryDb());
  Object.assign(
    ids,
    await seedPractices(mockApp.repo),
    await seedBotPractices(mockApp.repo, 1_760_000_500_000),
  );
  mockApp.history = fakeHistoryApi([rankedDuel('ranked-1')]);
});

/** The report and block routes in memory (spec §3.5). */
let moderation: FakeModeration | null = null;

beforeEach(() => {
  moderation = createFakeModeration();
  moderation.addPlayer({ id: 'nina', displayName: 'NinaVolt', country: 'DE' });
  setModerationApi(() => moderation!.api);
  resetBlocks();
  jest.mocked(practiceStorageOrNull).mockImplementation(async () => mockApp.repo);
  setProgressFetch(progressFetch);
  setHealthCheck(async () => true);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => {
    useGameStore.getState().clear();
  });
  table = null;
  rankedNet = null;
  setHealthCheck(null);
  setProgressFetch(null);
  setModerationApi(null);
  forgetProgress();
  setAuthDeps(null);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe.each(['he', 'en'] as const)('accessibility audit, every route (%s)', (lang) => {
  beforeEach(async () => {
    await i18n.changeLanguage(lang);
    useSettings.setState({ language: lang, reduceMotion: 'off', sound: true, haptics: true });
    useProfile.setState({ name: 'Tester', avatarId: 'sun', country: 'IL', lastPlay: null, botLevel: null });
  });

  it.each(CASES)('$name', async (c) => {
    if (c.signedOut) installTestAuth();
    else await installSignedInPlayer();
    await initAuth();
    await c.setup?.();
    const url = typeof c.url === 'function' ? c.url() : c.url;
    const app = renderRouter(ROUTES, { initialUrl: url });
    await app;
    await screen.findByTestId(c.ready, { includeHiddenElements: true }, { timeout: 5000 });
    await settle(50);
    await c.drive?.();
    if (c.shows) expect(screen.getByTestId(c.shows, { includeHiddenElements: true })).toBeOnTheScreen();

    const problems = auditA11y(screen.container, { smallTargetOk: isBoardCell });
    expect({ screen: c.name, problems }).toEqual({ screen: c.name, problems: [] });
    // In English, no Hebrew: a string that skipped t(). (The language choice names Hebrew in Hebrew.)
    if (lang === 'en')
      expect({ screen: c.name, hebrew: hebrewTexts(screen.container, ['עברית']) }).toEqual({
        screen: c.name,
        hebrew: [],
      });
    if (c.live) {
      // Said to screen readers: Android reads the live region as it changes (iOS gets an announcement).
      const live = screen.getByTestId(c.live, { includeHiddenElements: true });
      expect(live).toHaveProp('accessibilityLiveRegion', expect.stringMatching(/polite|assertive/));
      // The connection's states say themselves as they begin (components.md §11.6).
      if (/reconnecting|left|error|found|timeout|home/.test(c.live)) expect(live).toHaveTextContent(/\S/);
    }
    await app.then((r) => r.unmount());
  });
});

describe('the audit itself', () => {
  it('knows every theme colour, and nothing else', () => {
    expect(THEME_COLOURS.size).toBeGreaterThan(20);
    expect(isThemeColour(color.text)).toBe(true);
    // An animated colour comes out as rgba(): the same colour.
    expect(isThemeColour('rgba(154, 163, 181, 1)')).toBe(color.textMuted === '#9aa3b5');
    expect(isThemeColour('#123456')).toBe(false);
  });

  it('would catch each kind of problem', async () => {
    const { render } = jest.requireActual<typeof import('@testing-library/react-native')>(
      '@testing-library/react-native',
    );
    const view = await render(
      <View testID="box">
        <Pressable onPress={() => undefined} testID="no-role">
          <Text>שחק</Text>
        </Pressable>
        <Pressable onPress={() => undefined} accessibilityRole="button" testID="no-label" />
        <Pressable
          onPress={() => undefined}
          accessibilityRole="button"
          accessibilityLabel="סגירה"
          style={{ width: 24, height: 24 }}
          hitSlop={8}
          testID="small"
        />
        <Pressable
          onPress={() => undefined}
          accessibilityRole="button"
          accessibilityLabel="סגירה"
          style={{ width: 24, height: 24 }}
          hitSlop={10}
          testID="slop-ok"
        />
        <View accessible accessibilityLabel="כרטיס" testID="card">
          <Pressable onPress={() => undefined} accessibilityRole="button" accessibilityLabel="פנימי" />
        </View>
        <Text style={{ color: '#ff0000' }}>אדום</Text>
        <Text style={{ color: color.textMuted }}>בסדר</Text>
      </View>,
    );
    const problems = auditA11y(view.container);
    expect(problems).toEqual([
      expect.stringMatching(/^no role: #no-role/),
      expect.stringMatching(/^no label: #no-label/),
      expect.stringMatching(/^small target: #small .*\(width 24\+16, height 24\+16\)/),
      expect.stringMatching(/^nested: #card .*inside another screen-reader element/),
      expect.stringMatching(/^text colour #ff0000 is not a theme colour/),
    ]);
    expect(MIN_TARGET).toBe(44);
    // In English, the Hebrew strings above would be reported (all but an allowed one).
    expect(hebrewTexts(view.container, ['בסדר']).map((line) => line.split(' ')[0])).toEqual([
      'שחק',
      'סגירה',
      'סגירה',
      'כרטיס',
      'פנימי',
      'אדום',
    ]);
  });
});
