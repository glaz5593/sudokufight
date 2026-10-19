// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import { type AppLevel, type FindLevelOver, levelIdOf, levelOutcome, type Stars } from '@sudoku-fight/engine';
import { render } from '@testing-library/react-native';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LevelsRoute from '../../../../app/levels/index';
import { LevelPlayFlow, type LevelPlayingProps } from '../../../../app/levels/play';
import { useAuth } from '../../../auth/authStore';
import { useToast } from '../../../components/ui';
import { LEVEL_UI } from '../../../config/levels';
import { openPracticeRepo } from '../../../game/practiceRepo';
import { practiceStorageOrNull } from '../../../game/storage';
import { memoryDb, type SqlJsDb } from '../../../game/testing/sqlJsDb';
import i18n from '../../../i18n';
import { levelFinished } from '../../../levels/appLevels';
import { allLevels } from '../../../levels/levelsData';
import { forgetLevels } from '../../../levels/levelsStore';
import { track } from '../../../services/analytics';
import { useSettings } from '../../../state/settings';
import { useTestingSwitches } from '../../../state/testingSwitches';
import { renderApp } from '../../home/testing/homeTesting';
import { useTutorials } from '../HowToPlay';
import { LevelMapScreen, type LevelMapScreenProps } from '../LevelMapScreen';
import { mapLayout, openOffset } from '../mapModel';

/**
 * The level map (components.md §19.2–§19.4; dev-plan §3.1 2ז): it opens at the current chapter with the current
 * node at 40 %, every node has its label, a locked node shakes and says why (not under Reduced Motion), the
 * boss shows its bot from chapter 2, the header chip jumps to a chapter, a closed gate opens its sheet, an open
 * one reads "פרק 5 פתוח", and the panel's button plays. Then the whole way, with a stand-in for the stage
 * screens: משחק חדש → the map → the panel → "מוכן?" → the result → the map, in Hebrew and English.
 */

type Mocks = typeof import('../../home/testing/nativeMocks');

const mockDbs = new Map<string, Promise<SqlJsDb>>();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (name: string) => {
    let db = mockDbs.get(name);
    if (!db) {
      db = jest
        .requireActual<typeof import('../../../game/testing/sqlJsDb')>('../../../game/testing/sqlJsDb')
        .memoryDb();
      mockDbs.set(name, db);
    }
    return db;
  },
}));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock(
  '../../../game/storage',
  () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').practiceStorage,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);

const hidden = { includeHiddenElements: true };
const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const LEVELS = allLevels();

/** Stages 1…n played, each with these stars (an engine LevelRecords). */
function played(n: number, stars: Stars = 2, from = 1): LevelMapScreenProps['records'] {
  const out: Record<string, { stars: Stars; plays: number; metric: number | null }> = {};
  for (let k = from; k <= n; k++) out[levelIdOf(k)] = { stars, plays: 1, metric: 7600 };
  return out;
}

async function show(over: Partial<LevelMapScreenProps> = {}) {
  const props: LevelMapScreenProps = {
    levels: LEVELS,
    records: {},
    openedChapters: [],
    onBack: jest.fn(),
    onPlay: jest.fn(),
    ...over,
  };
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LevelMapScreen {...props} />
    </SafeAreaProvider>,
  );
  return props;
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
  useToast.getState().clear();
  useTutorials.setState({ seen: {} });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('the level map', () => {
  it('opens at the current chapter, the current node at 40 % of the map', async () => {
    const scrolled = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    await show({ records: played(19) });
    const list = screen.getByTestId('level-map-list');
    // Stage 20 is next: chapter 2, the list's second item.
    expect(list).toHaveProp('initialScrollIndex', 1);
    await fireEvent(list, 'layout', { nativeEvent: { layout: { width: 750, height: 600, x: 0, y: 0 } } });
    const layout = mapLayout(750, 'down', { plateOf: () => 'open' });
    expect(scrolled).toHaveBeenCalledWith({ offset: openOffset(layout, 20, 600), animated: false });
    expect(screen.getByTestId('node-20-ring', hidden)).toBeTruthy();
  });

  it("LEVEL_UI.mapDirection 'up': the list runs from chapter 30 down to stage 1 (D60: 'down')", async () => {
    expect(LEVEL_UI.mapDirection).toBe('down');
    jest.replaceProperty(LEVEL_UI, 'mapDirection', 'up');
    await show({ records: played(19) });
    const list = screen.getByTestId('level-map-list');
    expect((list.props as { data: { chapter: number }[] }).data[0]!.chapter).toBe(30);
    // Chapter 2 is the 29th item from the top.
    expect(list).toHaveProp('initialScrollIndex', 28);
  });

  it('a chapter’s header: "פרק 2", its name, and "★ 18/30"', async () => {
    await show({ records: played(19) });
    const header = screen.getByTestId('chapter-2-header');
    expect(header).toHaveTextContent(/פרק 2/);
    expect(header).toHaveTextContent(/Pip מאתגר/);
    expect(screen.getByTestId('chapter-2-stars')).toHaveProp('accessibilityLabel', '18 כוכבים מתוך 30');
    expect(screen.getByTestId('chapter-2-stars')).toHaveTextContent('⁦18/30⁩');
    expect(screen.getByTestId('level-map-total')).toHaveProp(
      'accessibilityLabel',
      '38 כוכבים מתוך 900, מעבר לפרק',
    );
  });

  it('every node has its label: "שלב 7, איפה ה־7, שני כוכבים מתוך שלושה", "שלב 12, נעול"', async () => {
    await show({ records: played(7) });
    expect(screen.getByRole('button', { name: 'שלב 7, איפה ה־7, שני כוכבים מתוך שלושה' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'שלב 12, נעול' })).toBeOnTheScreen();
    expect(screen.getByTestId('node-8')).toHaveProp('accessibilityLabel', 'שלב 8, מלא את הריבוע, השלב הבא');
    expect(screen.getByTestId('node-10')).toHaveProp('accessibilityLabel', 'שלב 10, נעול');
    // Every node a button with a label.
    for (const node of screen.getAllByTestId(/^node-\d+$/))
      expect(node).toHaveProp('accessibilityLabel', expect.stringMatching(/^שלב \d+, /));
  });

  it('the current node: my P1 pin and the gold ring, pulsing (static under Reduced Motion)', async () => {
    await show({ records: played(7) });
    expect(screen.getByTestId('node-8-tile-pin', hidden)).toBeTruthy();
    expect(screen.getByTestId('node-8-ring-band', hidden)).toBeTruthy();
    expect(screen.queryByTestId('node-7-tile-pin', hidden)).toBeNull();
    await screen.unmount();
    useSettings.setState({ reduceMotion: 'on' });
    await show({ records: played(7) });
    expect(screen.getByTestId('node-8-ring', hidden)).toBeTruthy();
    expect(screen.queryByTestId('node-8-ring-band', hidden)).toBeNull();
  });

  it('a locked node shakes and says to play the current stage first; under Reduced Motion, no shake', async () => {
    jest.useFakeTimers();
    await show({ records: played(7) });
    await fireEvent.press(screen.getByTestId('node-9'));
    expect(useToast.getState().current?.message).toBe('קודם משחקים את שלב 8');
    await act(async () => void jest.advanceTimersByTime(60));
    const moving = screen.getByTestId('node-9-shake');
    expect(moving).not.toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(moving).toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    // The panel says why too.
    expect(screen.getByTestId('level-panel-goal')).toHaveTextContent('שחק את שלב 8 קודם.');
    await screen.unmount();

    useSettings.setState({ reduceMotion: 'on' });
    useToast.getState().clear();
    await show({ records: played(7) });
    await fireEvent.press(screen.getByTestId('node-9'));
    expect(useToast.getState().current?.message).toBe('קודם משחקים את שלב 8');
    await act(async () => void jest.advanceTimersByTime(60));
    expect(screen.getByTestId('node-9-shake')).toHaveAnimatedStyle({ transform: [{ translateX: 0 }] });
    // Instead: the lock badge's border lights up for a moment.
    expect(screen.getByTestId('node-9-tile-lock', hidden)).toHaveStyle({ borderColor: '#eef1f6' });
    await act(async () => void jest.advanceTimersByTime(400));
    expect(screen.getByTestId('node-9-tile-lock', hidden)).not.toHaveStyle({ borderColor: '#eef1f6' });
  });

  it('a stage behind a closed gate says what the gate needs', async () => {
    await show({ records: played(19) });
    await fireEvent.press(screen.getByTestId('node-21'));
    expect(useToast.getState().current?.message).toBe('פרק 3 נפתח ב־20 כוכבים בפרק 2');
  });

  it('the boss shows the chapter’s bot from chapter 2 (none in chapter 1, which has none)', async () => {
    await show({ records: played(19) });
    expect(screen.getByTestId('node-20-bot', hidden)).toBeTruthy();
    expect(screen.getByTestId('node-20-tile-crown', hidden)).toBeTruthy();
    await screen.unmount();
    await show({ records: played(7) });
    expect(screen.getByTestId('node-10-tile-crown', hidden)).toBeTruthy();
    expect(screen.queryByTestId('node-10-bot', hidden)).toBeNull();
  });

  it('LEVEL_UI.nodeKindIcon: no kind icon on a node (D60), unless it is turned on', async () => {
    await show({ records: played(7) });
    expect(screen.queryByTestId('node-7-kind', hidden)).toBeNull();
    await screen.unmount();
    jest.replaceProperty(LEVEL_UI, 'nodeKindIcon', true);
    await show({ records: played(7) });
    expect(within(screen.getByTestId('node-7-kind', hidden)).getByTestId('icon-target', hidden)).toBeTruthy();
  });

  it('the header chip opens the chapter list, and a row takes the map to its chapter', async () => {
    const jumped = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
    await show({ records: played(19) });
    await fireEvent.press(screen.getByTestId('level-map-total'));
    expect(screen.getByRole('header', { name: 'קפיצה לפרק' })).toBeOnTheScreen();
    expect(screen.getByTestId('chapter-jump-1')).toHaveProp(
      'accessibilityLabel',
      'פרק 1, צעדים ראשונים, 20 כוכבים מתוך 30, פתוח',
    );
    expect(screen.getByTestId('chapter-jump-5')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/נעול$/),
    );
    await fireEvent.press(screen.getByTestId('chapter-jump-5'));
    expect(jumped).toHaveBeenCalledWith({ index: 4, animated: true });
  });

  it('a closed gate opens its sheet, with at most 3 stages to play again', async () => {
    await show({ records: played(19) });
    const gate = screen.getByTestId('gate-3');
    expect(gate).toHaveProp('accessibilityLabel', 'פרק 3 נעול, 18 מתוך 20 כוכבים בפרק 2');
    expect(screen.getByTestId('gate-3-count')).toHaveTextContent('⁦18/20⁩');
    await fireEvent.press(gate);
    expect(screen.getByRole('header', { name: 'פרק 3 נעול' })).toBeOnTheScreen();
    const rows = within(screen.getByTestId('gate-sheet-rows')).getAllByRole('button');
    expect(rows.length).toBeLessThanOrEqual(3);
    // The boss not played yet comes first: without it the gate never opens.
    expect(rows[0]).toHaveProp('accessibilityLabel', expect.stringMatching(/^שחק את שלב 20,/));
  });

  it('an open gate reads "פרק 5 פתוח"', async () => {
    await show({ records: played(40) });
    expect(screen.getByTestId('gate-5-open')).toHaveTextContent('פרק 5 פתוח');
    expect(screen.getByTestId('gate-5')).toHaveProp(
      'accessibilityLabel',
      'פרק 5 פתוח, נפתח ב־20 כוכבים מפרק 4',
    );
  });

  it('the panel: the current stage, its goal and scale, and "המשך · שלב N" plays it', async () => {
    const { onPlay } = await show({ records: played(7) });
    expect(screen.getByTestId('level-panel-title')).toHaveTextContent('שלב 8 · מלא את הריבוע');
    expect(screen.getByTestId('level-panel-next')).toBeTruthy();
    expect(screen.getByTestId('level-scale-3')).toHaveProp('accessibilityLabel', '3 כוכבים: עד 10 ש׳');
    await fireEvent.press(screen.getByRole('button', { name: 'המשך · שלב 8' }));
    expect(onPlay).toHaveBeenCalledWith('L008');
    // A played stage: my best, and "שחק".
    await fireEvent.press(screen.getByTestId('node-7'));
    expect(screen.getByTestId('level-panel-best')).toHaveProp(
      'accessibilityLabel',
      'השיא שלך: שני כוכבים מתוך שלושה, ⁦7.6⁩ ש׳',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'שחק' }));
    expect(onPlay).toHaveBeenLastCalledWith('L007');
  });

  it('a staging build’s "פתח את כל השלבים (בדיקה)": every stage and every gate open; the stars as they are', async () => {
    const { onPlay } = await show({ records: played(7), unlockAll: true });
    expect(screen.queryAllByRole('button', { name: /, נעול$/ })).toEqual([]);
    expect(screen.getByTestId('node-12')).not.toHaveProp('accessibilityLabel', 'שלב 12, נעול');
    expect(screen.getByTestId('gate-2-open')).toBeTruthy();
    // A stage far ahead plays: no "locked" toast, and the panel's "שחק".
    await fireEvent.press(screen.getByTestId('node-12'));
    expect(useToast.getState().current).toBeNull();
    await fireEvent.press(screen.getByTestId('level-panel-play'));
    expect(onPlay).toHaveBeenCalledWith('L012');
    // The progress is unchanged: the current stage is still the next one to play, the stars still mine.
    expect(screen.getByTestId('node-8')).toHaveProp('accessibilityLabel', 'שלב 8, מלא את הריבוע, השלב הבא');
    expect(screen.getByRole('button', { name: 'שלב 7, איפה ה־7, שני כוכבים מתוך שלושה' })).toBeOnTheScreen();
  });

  it('"פתח את כל השלבים" comes from the testing switch by default (off: the gates hold)', async () => {
    await show({ records: played(7) });
    expect(screen.getByRole('button', { name: 'שלב 12, נעול' })).toBeOnTheScreen();
    await screen.unmount();
    useTestingSwitches.setState({ unlockAllLevels: true });
    try {
      await show({ records: played(7) });
      expect(screen.queryByRole('button', { name: 'שלב 12, נעול' })).toBeNull();
    } finally {
      await act(async () => useTestingSwitches.setState({ unlockAllLevels: false }));
    }
  });

  it('a stage against a bot: the panel shows the bot with ▲, its name and level', async () => {
    await show({ records: played(11) });
    await fireEvent.press(screen.getByTestId('node-12'));
    expect(screen.getByTestId('level-panel-bot')).toHaveProp('accessibilityLabel', 'Pip · רמה 1 · טירון');
    expect(within(screen.getByTestId('level-panel-bot')).getByTestId('glyph-triangle', hidden)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------
// The whole way, with a stand-in for the stage screens (2ח builds the real ones)

/** A stage that ends as soon as "סיום" is pressed: found in 4 s, stored through the app's levelFinished. */
function FakeStage({ level, onFinished }: LevelPlayingProps) {
  return (
    <View testID="fake-stage">
      <Text>{level.id}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="finish"
        testID="fake-stage-finish"
        onPress={() => {
          const end: FindLevelOver = {
            reason: 'targetReached',
            elapsedMs: 4000,
            penaltyMs: 0,
            spots: 1,
            found: 0,
            stars: 3,
          };
          void levelFinished({ level, end, attempt: 1, startedAt: 1, endedAt: 2 }).then((finished) =>
            onFinished({
              outcome: levelOutcome(level, end),
              finished,
              mistakes: 0,
              opponent: null,
              bestMove: null,
              why: null,
            }),
          );
        }}
      />
    </View>
  );
}

const ROUTES = {
  'levels/index': LevelsRoute,
  'levels/play': () => <LevelPlayFlow Playing={FakeStage} />,
};

let uid = 0;
async function signIn() {
  uid += 1;
  await act(async () =>
    useAuth.setState({
      status: 'ready',
      user: { uid: `map-${uid}`, email: null, emailVerified: true, methods: [] },
    }),
  );
}

describe.each(['he', 'en'] as const)('the way through, %s', (lang) => {
  beforeEach(async () => {
    jest.mocked(practiceStorageOrNull).mockImplementation(async () => openPracticeRepo(await memoryDb()));
    await i18n.changeLanguage(lang);
    useSettings.setState({ reduceMotion: 'on', language: lang });
    // "איך משחקים" has its own tests (HowToPlay.test).
    useTutorials.setState({ seen: { find: true, fillBox: true, boss: true } });
    await signIn();
  });
  afterEach(async () => {
    await act(async () => useAuth.setState({ status: 'loading', user: null }));
    forgetLevels();
  });

  it('משחק חדש → the map → the panel → "מוכן?" → the result → the map, with Reduced Motion', async () => {
    const app = await renderApp('/modes', ROUTES);
    await fireEvent.press(screen.getByTestId('mode-levels'));
    expect(app.pathname()).toBe('/levels');
    await screen.findByTestId('level-map');
    expect(jest.mocked(track)).toHaveBeenCalledWith('level_map_open', { level: 1, stars: 0 });
    // Every node it drew has its label.
    for (const node of screen.getAllByTestId(/^node-\d+$/))
      expect(node).toHaveProp(
        'accessibilityLabel',
        expect.stringMatching(lang === 'he' ? /^שלב \d+, / : /^Stage \d+, /),
      );

    await fireEvent.press(screen.getByTestId('level-panel-play'));
    expect(app.pathnameWithParams()).toBe('/levels/play?id=L001');
    expect(screen.getByTestId('level-ready')).toBeOnTheScreen();
    expect(screen.queryByTestId('fake-stage')).toBeNull();
    await act(async () => void jest.advanceTimersByTime(LEVEL_UI.readyMs));
    await fireEvent.press(screen.getByTestId('fake-stage-finish'));
    await screen.findByTestId('level-result');
    // The result is a state of the stage's route: no navigation.
    expect(app.pathname()).toBe('/levels/play');
    expect(screen.getByTestId('level-result-title')).toHaveTextContent(
      lang === 'he' ? 'שלב 1 הושלם' : 'Stage 1 complete',
    );

    await fireEvent.press(screen.getByTestId('level-result-map'));
    await waitFor(() => expect(app.pathname()).toBe('/levels'));
    // Back on the map: stage 1 played with ★★★, stage 2 is next.
    await waitFor(() =>
      expect(screen.getByTestId('node-1')).toHaveProp(
        'accessibilityLabel',
        lang === 'he'
          ? 'שלב 1, איפה ה־7, שלושה כוכבים מתוך שלושה'
          : "Stage 1, Where's the 7, three stars of three",
      ),
    );
    expect(screen.getByTestId('node-2-tile-pin', hidden)).toBeTruthy();
    // The panel moved on with it.
    expect(screen.getByTestId('level-panel-title')).toHaveTextContent(
      lang === 'he' ? /^שלב 2 · / : /^Stage 2 · /,
    );
  });
});

/** The levels' data the map reads is the shipped file (300 stages). */
it('reads the shipped stages', () => {
  expect(LEVELS).toHaveLength(300);
  expect((LEVELS[6] as AppLevel).kind).toBe('find');
});
