// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import {
  type AppLevel,
  cellName,
  type Digit,
  isLevelOpen,
  levelIdOf,
  ManualClock,
  ManualScheduler,
} from '@sudoku-fight/engine';
import { act, fireEvent, screen } from 'expo-router/testing-library';

import LevelPlayRoute from '../../app/levels/play';
import LevelsRoute from '../../app/levels/index';
import { useAuth } from '../auth/authStore';
import { LEVEL_UI } from '../config/levels';
import type { SqlJsDb } from '../game/testing/sqlJsDb';
import i18n from '../i18n';
import { levelById } from '../levels/levelsData';
import { openLevelsStorage } from '../levels/levelsStorage';
import { forgetLevels } from '../levels/levelsStore';
import { renderApp } from '../screens/home/testing/homeTesting';
import { useTutorials } from '../screens/levels/HowToPlay';
import { track } from '../services/analytics';
import { useSettings } from '../state/settings';

/**
 * Staged practice end to end (dev-plan §2ח, §3.1): the app's real routes from "משחק חדש" to the map, a stage, its
 * result and back, the stage screens playing on a manual clock (find, the race, fill the box, the duel, and the
 * bosses), the end stored in a real levels.db (sql.js, one database per file name), and the practice's history
 * untouched. Then chapters 1–3, every stage through its result and "לשלב הבא" to the next: the gates of
 * chapters 2 and 3 open on the stars of the chapter before.
 */

const mockDbs = new Map<string, Promise<SqlJsDb>>();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (name: string) => {
    let db = mockDbs.get(name);
    if (!db) {
      db = jest.requireActual<typeof import('../game/testing/sqlJsDb')>('../game/testing/sqlJsDb').memoryDb();
      mockDbs.set(name, db);
    }
    return db;
  },
}));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../services/analytics', () => ({ track: jest.fn() }));
type Mocks = typeof import('../screens/home/testing/nativeMocks');
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../screens/home/testing/nativeMocks').expoHaptics);
// The stages run on this test's manual clock (the app's session, its deps given).
const mockRun: { clock: ManualClock | null; scheduler: ManualScheduler | null } = {
  clock: null,
  scheduler: null,
};
type SessionModule = typeof import('../levels/levelSession');
jest.mock('../levels/levelSession', () => {
  const actual = jest.requireActual<SessionModule>('../levels/levelSession');
  const startLevel: SessionModule['startLevel'] = (level, options, deps) =>
    actual.startLevel(level, options, {
      ...deps,
      clock: mockRun.clock!,
      scheduler: mockRun.scheduler!,
      appState: null,
    });
  return { ...actual, startLevel };
});

jest.setTimeout(600_000);

const hidden = { includeHiddenElements: true };
const ROUTES = { 'levels/index': LevelsRoute, 'levels/play': LevelPlayRoute };
const OWNER = 'levels-e2e';

/** The stage's clock and the phone's timers move on together. */
async function wait(ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    const d = Math.min(step, ms - t);
    await act(async () => {
      mockRun.scheduler!.advance(d);
      jest.advanceTimersByTime(d);
    });
  }
}

/** Waits (moving both clocks on a little) until `ok`, at most `ms`. */
async function until(ok: () => boolean, ms = 5000) {
  for (let t = 0; t < ms && !ok(); t += 20) await wait(20, 20);
  if (!ok()) throw new Error('timed out');
}

const press = (testID: string) => fireEvent.press(screen.getByTestId(testID, hidden));
const pressCell = (cell: number) => press(`cell-${cellName(cell)}`);
const answer = (level: AppLevel, cell: number) => Number(level.board.solution[cell]) as Digit;

/** Plays the stage on the screen as a player would (the stored board: every attempt here is the first). */
async function play(level: AppLevel) {
  switch (level.kind) {
    case 'find':
      await wait(1000);
      await pressCell(level.targets.target.accept[0]!);
      return;
    case 'findDuel':
      for (const spot of level.targets.spots) {
        await wait(200);
        await pressCell(spot.accept[0]!);
      }
      return;
    case 'fillBox':
      for (const cell of level.targets.cells) {
        await pressCell(cell);
        await press(`key-${answer(level, cell)}`);
        await wait(200);
      }
      return;
    case 'duel': {
      // Lock an empty cell, its right digit; the next one. The bot plays meanwhile (a cell it holds or took is
      // skipped), and the first to 30 (or the 30 s) ends it.
      const tried = new Set<number>();
      for (let k = 0; k < 120 && !screen.queryByTestId('level-result'); k++) {
        const cell = [...level.board.grid].findIndex((d, i) => {
          if (d !== '0' || tried.has(i)) return false;
          // Empty and nobody's: "D5, ריקה" and nothing more (a lock adds who holds it).
          const label = String(screen.getByTestId(`cell-${cellName(i)}`, hidden).props.accessibilityLabel);
          return label === `${cellName(i)}${i18n.t('board:separator.list')}${i18n.t('board:cell.empty')}`;
        });
        if (cell < 0) break;
        tried.add(cell);
        await pressCell(cell);
        if (screen.queryByTestId('level-result')) break;
        await press(`key-${answer(level, cell)}`);
        await wait(250);
      }
      return;
    }
    default:
      throw new Error(`chapters 1–3 have no ${level.kind}`);
  }
}

/** From "מוכן?" to the stage's result: its 2 s, the stage played, the hold. */
async function stageToResult(id: string) {
  const level = levelById(id)!;
  await until(() => screen.queryByTestId('level-ready') !== null);
  await wait(LEVEL_UI.readyMs + 50);
  await until(
    () => screen.queryByTestId('tap-level') !== null || screen.queryByTestId('level-game') !== null,
  );
  await play(level);
  await until(() => screen.queryByTestId('level-result') !== null, 40_000);
}

async function count(table: string): Promise<number> {
  const db = await mockDbs.get('practice.db');
  if (!db) return 0;
  return (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`, []))?.n ?? 0;
}

beforeEach(async () => {
  mockRun.clock = new ManualClock(1_000_000);
  mockRun.scheduler = new ManualScheduler(mockRun.clock);
  jest.mocked(track).mockClear();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'on', language: 'he' });
  useTutorials.setState({ seen: {} });
  await act(async () =>
    useAuth.setState({
      status: 'ready',
      user: { uid: OWNER, email: null, emailVerified: true, methods: [] },
    }),
  );
});
afterEach(async () => {
  await act(async () => useAuth.setState({ status: 'loading', user: null }));
  forgetLevels();
  mockDbs.clear();
});

it('משחק חדש → אימון בשלבים → the map → stage 1 played to its end → the result → למפה', async () => {
  const app = await renderApp('/modes', ROUTES);
  await fireEvent.press(screen.getByTestId('mode-levels'));
  expect(app.pathname()).toBe('/levels');
  await screen.findByTestId('level-map');
  await fireEvent.press(screen.getByTestId('level-panel-play'));
  expect(app.pathnameWithParams()).toBe('/levels/play?id=L001');

  // The kind's first stage: "איך משחקים", its pictures drawn by the real board.
  await screen.findByTestId('how-to-play');
  expect(screen.getByTestId('how-to-play-board-find-1', hidden)).toBeTruthy();
  await press('how-to-play-got');

  await stageToResult('L001');
  expect(app.pathname()).toBe('/levels/play');
  expect(screen.getByTestId('level-result-title')).toHaveTextContent('שלב 1 הושלם');
  expect(screen.getByTestId('level-result-stars', hidden)).toHaveProp(
    'accessibilityLabel',
    expect.stringContaining('שלושה כוכבים'),
  );

  // Told once each: its start and its end.
  const names = jest.mocked(track).mock.calls.map(([name]) => name);
  expect(names.filter((n) => n === 'level_start')).toHaveLength(1);
  expect(names.filter((n) => n === 'level_end')).toHaveLength(1);
  expect(track).toHaveBeenCalledWith(
    'level_start',
    expect.objectContaining({ level: 1, attempt: 1, quick: false }),
  );
  expect(track).toHaveBeenCalledWith(
    'level_end',
    expect.objectContaining({ level: 1, stars: 3, reason: 'completed' }),
  );
  expect(names).not.toContain('game_start');
  expect(names).not.toContain('game_end');

  // Stored: L001 played, L002 open; the practices' history untouched.
  const repo = await openLevelsStorage();
  const progress = await repo.progress(OWNER);
  expect(progress.L001).toMatchObject({ stars: 3, plays: 1 });
  expect(isLevelOpen('L002', progress)).toBe(true);
  expect(await count('practice_games')).toBe(0);
  expect(await count('puzzle_plays')).toBe(0);

  await press('level-result-map');
  await until(() => app.pathname() === '/levels');
  await until(() => screen.queryByTestId('node-2-tile-pin', hidden) !== null);
  expect(screen.getByTestId('node-1')).toHaveProp(
    'accessibilityLabel',
    'שלב 1, איפה ה־7, שלושה כוכבים מתוך שלושה',
  );
});

it('chapters 1–3 end to end: find, the race, fill the box, the duel and their bosses, "לשלב הבא" each time', async () => {
  // "איך משחקים" has its own tests (HowToPlayPanels, HowToPlay).
  useTutorials.setState({ seen: { find: true, findDuel: true, fillBox: true, duel: true, boss: true } });
  const app = await renderApp('/levels/play?id=L001', ROUTES);
  const kinds = new Set<string>();
  for (let n = 1; n <= 30; n++) {
    const id = levelIdOf(n);
    const level = levelById(id)!;
    kinds.add(level.boss ? `boss:${level.kind}` : level.kind);
    await stageToResult(id);
    expect(screen.getByTestId('level-result-title')).toHaveTextContent(new RegExp(`^שלב ${n}( |$)`));
    if (n === 30) break;
    // "לשלב הבא": straight into the next stage (the quick entry, through "מוכן?").
    await press('level-result-next');
    await until(() => app.searchParams().id === levelIdOf(n + 1));
  }
  expect([...kinds].sort()).toEqual(
    ['boss:duel', 'boss:fillBox', 'boss:findDuel', 'duel', 'fillBox', 'find', 'findDuel'].sort(),
  );
  const repo = await openLevelsStorage();
  const progress = await repo.progress(OWNER);
  expect(Object.keys(progress)).toHaveLength(30);
  // The gates of chapters 2 and 3 opened on the stars of the chapter before (20 of 30, its boss played).
  expect(await repo.openedGates(OWNER)).toEqual(expect.arrayContaining([2, 3]));
  const starts = jest.mocked(track).mock.calls.filter(([name]) => name === 'level_start');
  expect(starts).toHaveLength(30);
  expect(starts.slice(1).every(([, props]) => (props as { quick: boolean }).quick)).toBe(true);
  expect(await count('practice_games')).toBe(0);
});
