// First: keeps the real Reanimated in place of the router testing library's old mock (see homeTesting.tsx).
import 'react-native-reanimated';
import {
  type AppLevel,
  type FindLevelOver,
  type GateState,
  levelOutcome,
  type LevelOutcome,
  parseCellName,
} from '@sudoku-fight/engine';
import { render } from '@testing-library/react-native';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LevelPlayFlow, type LevelPlayingProps } from '../../../../app/levels/play';
import { ltr } from '../../../components/player/format';
import { LEVEL_UI } from '../../../config/levels';
import i18n from '../../../i18n';
import type { LevelFinished } from '../../../levels/appLevels';
import { levelById } from '../../../levels/levelsData';
import { useSettings } from '../../../state/settings';
import { useTutorials } from '../HowToPlay';
import { type LevelPlayed, LevelResultView, type LevelResultViewProps } from '../LevelResultView';

/**
 * A stage's result (components.md §19.10; dev-plan §3.1 2ז): a state of the stage's own route, its stars, its
 * measure, the XP only with new stars (LRI-isolated), the chapter's line, and from the original §23 the
 * mistakes, the time, the bot's row and the best move; "למה?" with the wrong tap; one confetti burst on three
 * stars, never under Reduced Motion. "לשלב הבא" starts the next stage through "מוכן?", in the same route.
 */

type Mocks = typeof import('../../home/testing/nativeMocks');
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-audio', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoAudio);
jest.mock('expo-haptics', () => jest.requireActual<Mocks>('../../home/testing/nativeMocks').expoHaptics);

const hidden = { includeHiddenElements: true };
const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const FIND = levelById('L007')!;
const RACE = levelById('L012')!;
const DUEL = levelById('L021')!;

const found = (elapsedMs: number, penaltyMs = 0): FindLevelOver => ({
  reason: 'targetReached',
  elapsedMs,
  penaltyMs,
  spots: 1,
  found: 0,
  stars: 0,
});

const gate = (stars: number, open = false): GateState => ({
  chapter: 1,
  open,
  stars,
  need: 20,
  bossPlayed: false,
});

function finishedOf(outcome: LevelOutcome, over: Partial<LevelFinished> = {}): LevelFinished {
  return {
    attempt: 1,
    outcome,
    played: true,
    mistakes: 0,
    prevBest: 0,
    best: outcome.stars,
    newStars: outcome.stars,
    bestMetric: outcome.metric,
    gate: gate(18),
    gateWasOpen: false,
    gateOpened: false,
    xpEstimate: outcome.stars * 10,
    ...over,
  };
}

function playedOf(level: AppLevel, end: FindLevelOver, over: Partial<LevelPlayed> = {}): LevelPlayed {
  const outcome = levelOutcome(level, end);
  return {
    outcome,
    finished: finishedOf(outcome),
    mistakes: 0,
    opponent: null,
    bestMove: null,
    why: null,
    ...over,
  };
}

async function show(level: AppLevel, played: LevelPlayed, over: Partial<LevelResultViewProps> = {}) {
  const props: LevelResultViewProps = {
    level,
    played,
    chapter: played.finished?.gate
      ? { stars: played.finished.gate.stars, max: 30, gate: played.finished.gate }
      : null,
    next: 'L008',
    onNext: jest.fn(),
    onAgain: jest.fn(),
    onMap: jest.fn(),
    ...over,
  };
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <LevelResultView {...props} />
    </SafeAreaProvider>,
  );
  return props;
}

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => jest.useRealTimers());

describe('LevelResultView', () => {
  it('three stars: the title, the stars, the measure, "שיא חדש!", and one confetti burst', async () => {
    await show(FIND, playedOf(FIND, found(4200)));
    expect(screen.getByTestId('level-result-title')).toHaveTextContent('שלב 7 הושלם');
    expect(screen.getByRole('image', { name: 'שלושה כוכבים מתוך שלושה' })).toBeOnTheScreen();
    expect(screen.getByTestId('level-result-metric')).toHaveProp('accessibilityLabel', `${ltr('4.2')} ש׳`);
    expect(screen.getByTestId('level-result-new-best')).toHaveTextContent('שיא חדש!');
    expect(screen.getByTestId('level-result-confetti', hidden)).toBeTruthy();
    expect(screen.getAllByTestId('level-result-confetti-piece', hidden)).toHaveLength(40);
  });

  it('confetti only on three stars, and never under Reduced Motion', async () => {
    await show(FIND, playedOf(FIND, found(7000)));
    expect(screen.queryByTestId('level-result-confetti', hidden)).toBeNull();
    await screen.unmount();
    useSettings.setState({ reduceMotion: 'on' });
    await show(FIND, playedOf(FIND, found(4200)));
    expect(screen.queryByTestId('level-result-confetti', hidden)).toBeNull();
  });

  it('"‎+20 XP" (an LTR isolate) counts up once the stars are in; none without new stars', async () => {
    jest.useFakeTimers();
    const outcome = levelOutcome(FIND, found(7000));
    await show(FIND, { ...playedOf(FIND, found(7000)), finished: finishedOf(outcome, { xpEstimate: 20 }) });
    expect(screen.getByTestId('level-result-xp')).toHaveProp(
      'accessibilityLabel',
      `${ltr('+20')} XP, הערכה: השרת מאשר`,
    );
    // The stars first (770 ms for two), then the count (650 ms).
    await act(async () => void jest.advanceTimersByTime(1000));
    await act(async () => void jest.advanceTimersByTime(1000));
    expect(screen.getByTestId('level-result-xp-value', hidden)).toHaveAnimatedProps({
      text: `${ltr('+20')} XP`,
    });
    await screen.unmount();

    // A replay with no new star: no XP line, and "השיא שלך: ★★★" instead of "שיא חדש!".
    const replay = levelOutcome(FIND, found(7000));
    await show(FIND, {
      ...playedOf(FIND, found(7000)),
      finished: finishedOf(replay, { prevBest: 3, best: 3, newStars: 0, bestMetric: 3100, xpEstimate: 0 }),
    });
    expect(screen.queryByTestId('level-result-xp')).toBeNull();
    expect(screen.getByTestId('level-result-your-best')).toHaveProp(
      'accessibilityLabel',
      'השיא שלך: שלושה כוכבים מתוך שלושה',
    );
  });

  it('Reduced Motion: the XP is there at once', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await show(FIND, playedOf(FIND, found(4200)));
    expect(screen.getByTestId('level-result-xp-value', hidden)).toHaveAnimatedProps({
      text: `${ltr('+30')} XP`,
    });
  });

  it('the chapter’s line: "בפרק הזה: ★ 18/30 · לשער צריך 20"', async () => {
    await show(FIND, playedOf(FIND, found(4200)));
    const line = screen.getByTestId('level-result-chapter');
    expect(line).toHaveProp('accessibilityLabel', 'בפרק הזה: 18 כוכבים מתוך 30. לשער צריך 20');
    expect(line).toHaveTextContent(`בפרק הזה${ltr('18/30')}· לשער צריך 20`);
  });

  it('my mistakes, and the time when the measure is not the time (the original §23)', async () => {
    await show(FIND, playedOf(FIND, found(9300, 5000), { mistakes: 1 }));
    expect(screen.getByTestId('level-result-mistakes')).toHaveTextContent('טעות אחת');
    // The measure of a find is the time: no second time line.
    expect(screen.queryByTestId('level-result-time')).toBeNull();
    await screen.unmount();
    const race: FindLevelOver = {
      reason: 'targetReached',
      elapsedMs: 23400,
      penaltyMs: 0,
      spots: 4,
      found: 0,
      stars: 0,
    };
    await show(RACE, playedOf(RACE, race, { mistakes: 0 }));
    expect(screen.getByTestId('level-result-metric')).toHaveProp(
      'accessibilityLabel',
      `${ltr('4')} מתוך 5 מקומות`,
    );
    expect(screen.getByTestId('level-result-mistakes')).toHaveTextContent('בלי טעויות');
    expect(screen.getByTestId('level-result-time')).toHaveTextContent('זמן: 23.4 ש׳');
  });

  it('a stage against a bot: its row, with ▲, its spots or score, and who won', async () => {
    const race: FindLevelOver = {
      reason: 'targetReached',
      elapsedMs: 21000,
      penaltyMs: 0,
      spots: 2,
      found: 0,
      stars: 0,
    };
    await show(
      RACE,
      playedOf(RACE, race, {
        opponent: { name: 'Pip', avatar: 'hatchling', botLevel: 1, value: 3, verdict: 'lost' },
      }),
    );
    const row = screen.getByTestId('level-result-opponent');
    expect(row).toHaveProp('accessibilityLabel', 'Pip: 3 מקומות. Pip ניצח');
    expect(screen.getByTestId('glyph-triangle', hidden)).toBeTruthy();
    expect(screen.getByTestId('level-result-verdict')).toHaveTextContent('Pip ניצח');
    await screen.unmount();

    await show(DUEL, {
      outcome: { reason: 'completed', stars: 2, metric: 10.5, elapsedMs: 24000 },
      finished: null,
      mistakes: 1,
      opponent: { name: 'Pip', avatar: 'hatchling', botLevel: 1, value: 19.5, verdict: 'won' },
      bestMove: { cell: parseCellName('D5'), digit: 7, points: 6.5 },
      why: null,
    });
    expect(screen.getByTestId('level-result-opponent')).toHaveProp(
      'accessibilityLabel',
      'Pip: 19.5 נקודות. ניצחת',
    );
    expect(screen.getByTestId('level-result-metric')).toHaveProp('accessibilityLabel', `פער ${ltr('10.5')}`);
    // The duel's best move, its cell LTR.
    expect(screen.getByTestId('level-result-best-move')).toHaveTextContent(
      `המהלך הכי שווה: 7 ב־${ltr('D5')} · 6.5 נקודות`,
    );
    // Nothing stored (no account): no best, no XP, no chapter line.
    expect(screen.queryByTestId('level-result-new-best')).toBeNull();
    expect(screen.queryByTestId('level-result-chapter')).toBeNull();
  });

  it('"למה?" says the session’s explanation, my wrong tap included', async () => {
    const why = `הקשת על ${ltr('A6')}, אבל בשורה A כבר יש 3. נשאר רק ${ltr('C6')}.`;
    await show(FIND, playedOf(FIND, found(9300, 5000), { why, mistakes: 1 }));
    expect(screen.getByRole('header', { name: 'למה?' })).toBeOnTheScreen();
    expect(screen.getByTestId('level-result-why')).toHaveTextContent(why, { exact: false });
  });

  it('zero stars: how it ended, three empty stars, no XP; no next stage at a closed gate', async () => {
    const level = FIND;
    const end: FindLevelOver = {
      reason: 'timeUp',
      elapsedMs: 20000,
      penaltyMs: 0,
      spots: 0,
      found: 0,
      stars: 0,
    };
    await show(level, playedOf(level, end), { next: null });
    expect(screen.getByTestId('level-result-title')).toHaveTextContent('שלב 7');
    expect(screen.getByTestId('level-result-reason')).toHaveTextContent('הזמן נגמר');
    expect(screen.getByRole('image', { name: 'בלי כוכבים' })).toBeOnTheScreen();
    expect(screen.queryByTestId('level-result-xp')).toBeNull();
    expect(screen.queryByTestId('level-result-next')).toBeNull();
    expect(screen.getByTestId('level-result-no-next')).toHaveTextContent('השלב הבא עוד נעול');
  });

  it('speaks English: "Stage 7 complete", "Next stage"', async () => {
    await i18n.changeLanguage('en');
    await show(FIND, playedOf(FIND, found(4200)));
    expect(screen.getByTestId('level-result-title')).toHaveTextContent('Stage 7 complete');
    expect(screen.getByRole('button', { name: 'Next stage' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Again' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'To the map' })).toBeOnTheScreen();
  });
});

// ---------------------------------------------------------------------------------------------------------
// In the route: the result is a state of /levels/play, and "לשלב הבא" starts the next stage through "מוכן?"

/** A stage that ends at once with ★★★ when "finish" is pressed (nothing stored: no account here). */
function FakeStage({ level, quick, onFinished }: LevelPlayingProps) {
  return (
    <View testID="fake-stage">
      <Text testID="fake-stage-id">{`${level.id}${quick ? ' quick' : ''}`}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="finish"
        testID="fake-stage-finish"
        onPress={() =>
          onFinished({
            outcome: levelOutcome(level, found(3000)),
            finished: null,
            mistakes: 0,
            opponent: null,
            bestMove: null,
            why: null,
          })
        }
      />
    </View>
  );
}

const ROUTES = {
  'levels/index': () => <Text testID="map-stub">map</Text>,
  'levels/play': () => <LevelPlayFlow Playing={FakeStage} />,
};

describe('in the stage’s route', () => {
  beforeEach(() => useTutorials.setState({ seen: { find: true, fillBox: true, boss: true } }));

  /** Plays L007 to its result; the router (a thenable: it is returned inside an object). */
  async function playL007() {
    const app = renderRouter(ROUTES, { initialUrl: '/levels/play?id=L007' });
    await app;
    expect(screen.getByTestId('level-ready')).toBeOnTheScreen();
    await act(async () => void jest.advanceTimersByTime(LEVEL_UI.readyMs));
    expect(screen.getByTestId('fake-stage-id')).toHaveTextContent('L007');
    await fireEvent.press(screen.getByTestId('fake-stage-finish'));
    expect(screen.getByTestId('level-result')).toBeOnTheScreen();
    return { app };
  }

  it('the end is a state: the pathname stays; "לשלב הבא" starts L008 through "מוכן?", as a quick entry', async () => {
    const { app } = await playL007();
    expect(app.getPathname()).toBe('/levels/play');
    await fireEvent.press(screen.getByTestId('level-result-next'));
    expect(app.getPathname()).toBe('/levels/play');
    expect(app.getSearchParams()).toMatchObject({ id: 'L008', quick: '1' });
    expect(screen.getByTestId('level-ready')).toBeOnTheScreen();
    await act(async () => void jest.advanceTimersByTime(LEVEL_UI.readyMs));
    expect(screen.getByTestId('fake-stage-id')).toHaveTextContent('L008 quick');
  });

  it('"שוב" plays the same stage again, from "מוכן?"', async () => {
    await playL007();
    await fireEvent.press(screen.getByTestId('level-result-again'));
    expect(screen.getByTestId('level-ready')).toBeOnTheScreen();
    await act(async () => void jest.advanceTimersByTime(LEVEL_UI.readyMs));
    expect(screen.getByTestId('fake-stage-id')).toHaveTextContent('L007');
  });

  it('LEVEL_UI.quickEntry off: "לשלב הבא" goes back to the map with the next stage chosen', async () => {
    jest.replaceProperty(LEVEL_UI, 'quickEntry', false);
    const { app } = await playL007();
    await fireEvent.press(screen.getByTestId('level-result-next'));
    expect(app.getPathname()).toBe('/levels');
    expect(app.getSearchParams()).toMatchObject({ select: 'L008' });
  });

  it('a stage that does not exist: the fallback, never an empty screen', async () => {
    await renderRouter(ROUTES, { initialUrl: '/levels/play?id=L999' });
    expect(await screen.findByTestId('flow-fallback')).toBeOnTheScreen();
  });
});
