import 'react-native-reanimated';

import { type AppLevel, attemptLevel, bossTraits, fillRegionOf, ROW_LETTERS } from '@sudoku-fight/engine';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ltr } from '../../../components/player/format';
import { LEVEL_MOTION, LEVEL_UI } from '../../../config/levels';
import i18n from '../../../i18n';
import { firstBossOf, firstLevelOf, levelAt } from '../../../levels/__tests__/helpers/levelsOf';
import { useSettings } from '../../../state/settings';
import { motion } from '../../../theme/motion';
import { chipProgress, chipsSpanMs } from '../BossIntro';
import { ReadyView, readyWhere } from '../ReadyView';

/**
 * "מוכן?" (components.md §19.8; D56): the kind, the goal and the star scale, no board, for LEVEL_UI.readyMs (2 s),
 * then the stage starts; a fade only (200 ms under Reduced Motion, the same 2 s). It stands still while the app
 * is in the background (D65) and goes on from where it was.
 *
 * 1.0.3 (levels-ui.md §2.4, §3.2): [D76] it says where to look, per kind, from the attempt's board (the digit and
 * the region of the board really played; the race never a spot or a digit); [D77] a boss gets its opening
 * instead, for LEVEL_UI.bossReadyMs (3 s), its chips only from the engine's bossTraits.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const hidden = { includeHiddenElements: true };
// Picked by kind, never by id (a rebuild may give an id another kind): helpers/levelsOf.
const FIND = firstLevelOf('find', 1);
const BOX = firstLevelOf('fillBox', 1);
const ROW = firstLevelOf('fillRow');
const RACE = firstLevelOf('findDuel');
const PUZZLE = firstLevelOf('puzzle');
const DUEL = firstLevelOf('duel');
const CHAIN = firstLevelOf('chain');
// Chapter 1's boss (the first bot, D72), chapter 2's (its bot 10% faster), and Overlord's (chapters 28–30).
const BOSS_1 = levelAt(1, 10);
const BOSS_2 = levelAt(2, 10);
const OVERLORD = levelAt(28, 10);
const DUEL_BOSS = firstBossOf('duel');

const show = (node: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={METRICS}>{node}</SafeAreaProvider>);

const tFor = () => i18n.getFixedT('he', 'levels');

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ReadyView', () => {
  it('waits 2000 ms (LEVEL_UI.readyMs), then the stage starts', async () => {
    expect(LEVEL_UI.readyMs).toBe(2000);
    const onDone = jest.fn();
    await show(<ReadyView level={FIND} onDone={onDone} />);
    await act(async () => void jest.advanceTimersByTime(1999));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reads LEVEL_UI.readyMs: another length, another wait', async () => {
    jest.replaceProperty(LEVEL_UI, 'readyMs', 500);
    const onDone = jest.fn();
    await show(<ReadyView level={FIND} onDone={onDone} />);
    await act(async () => void jest.advanceTimersByTime(499));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('says the kind, where to look, the goal and the scale, with no board', async () => {
    const { digit, scope } = FIND.targets.target;
    if (scope.kind !== 'box') throw new Error('chapter 1’s first find is in a box');
    await show(<ReadyView level={FIND} onDone={jest.fn()} />);
    expect(screen.getByTestId('level-ready-content')).toHaveProp(
      'accessibilityLabel',
      `מוכן? שלב 1, מיקום מדויק. איפה ה־${digit}? בריבוע ${scope.index + 1}. ` +
        'מצא את המקום המדויק של ספרה אחת. השלב נגמר ב־20 ש׳.',
    );
    expect(screen.getByText('מוכן?')).toBeTruthy();
    expect(screen.getByTestId('level-ready-scale-3')).toHaveProp('accessibilityLabel', '3 כוכבים: עד 5 ש׳');
    expect(screen.queryByTestId('board')).toBeNull();
  });

  it('fades in and out only; under Reduced Motion the fades are 200 ms, and it still lasts 2 s', async () => {
    const onDone = jest.fn();
    await show(<ReadyView level={FIND} onDone={onDone} />);
    const content = screen.getByTestId('level-ready-content');
    expect(content).toHaveAnimatedStyle({ opacity: 0 });
    await act(async () => void jest.advanceTimersByTime(300));
    expect(content).toHaveAnimatedStyle({ opacity: 1 });
    expect(content).not.toHaveAnimatedStyle({ transform: expect.anything() });
    await screen.unmount();

    useSettings.setState({ reduceMotion: 'on' });
    await show(<ReadyView level={FIND} onDone={onDone} />);
    await act(async () => void jest.advanceTimersByTime(250));
    expect(screen.getByTestId('level-ready-content')).toHaveAnimatedStyle({ opacity: 1 });
    await act(async () => void jest.advanceTimersByTime(1749));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('paused (the app in the background): the 2 s stand still, then go on from where they were', async () => {
    const onDone = jest.fn();
    const view = await show(<ReadyView level={FIND} onDone={onDone} />);
    await act(async () => void jest.advanceTimersByTime(1500));
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ReadyView level={FIND} onDone={onDone} paused />
      </SafeAreaProvider>,
    );
    await act(async () => void jest.advanceTimersByTime(10_000));
    expect(onDone).not.toHaveBeenCalled();
    await view.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ReadyView level={FIND} onDone={onDone} />
      </SafeAreaProvider>,
    );
    await act(async () => void jest.advanceTimersByTime(499));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('paused: the fades stand still too, so the intro is still there after the trip away, never a blank', async () => {
    const onDone = jest.fn();
    const at = (paused: boolean) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <ReadyView level={FIND} onDone={onDone} paused={paused} />
      </SafeAreaProvider>
    );
    const view = await render(at(false));
    await act(async () => void jest.advanceTimersByTime(500));
    const content = () => screen.getByTestId('level-ready-content');
    expect(content()).toHaveAnimatedStyle({ opacity: 1 });
    await view.rerender(at(true));
    await act(async () => void jest.advanceTimersByTime(10_000));
    expect(content()).toHaveAnimatedStyle({ opacity: 1 });
    await view.rerender(at(false));
    await act(async () => void jest.advanceTimersByTime(100));
    expect(content()).toHaveAnimatedStyle({ opacity: 1 });
    // 1500 ms were left: full until the last fade (240 ms), then out as the stage starts.
    await act(async () => void jest.advanceTimersByTime(1500 - 100 - motion.duration.stateChange - 20));
    expect(content()).toHaveAnimatedStyle({ opacity: 1 });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(motion.duration.stateChange + 20));
    expect(content()).toHaveAnimatedStyle({ opacity: 0 });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('ReadyView: where to look, from the attempt [D76]', () => {
  it('attempt 2: the digit and the box of the board played, never the stored stage’s', async () => {
    const played = attemptLevel(FIND, 2);
    if (played.kind !== 'find') throw new Error('a find');
    const stored = FIND.targets.target;
    const now = played.targets.target;
    // The fixture is only worth it while the two differ.
    expect(now.digit).not.toBe(stored.digit);
    if (now.scope.kind !== 'box') throw new Error('a box');
    await show(<ReadyView level={FIND} played={played} onDone={jest.fn()} />);
    expect(screen.getByTestId('level-ready-prompt')).toHaveTextContent(`איפה ה־${now.digit}?`);
    expect(screen.getByTestId('level-ready-caption')).toHaveTextContent(`בריבוע ${now.scope.index + 1}`);
    expect(screen.queryByText(`איפה ה־${stored.digit}?`)).toBeNull();
  });

  it('fill the box: the small map lights the attempt’s box, "ריבוע N" under it, always LTR', async () => {
    const played = attemptLevel(BOX, 2);
    const region = fillRegionOf(played)!;
    expect(region.index).not.toBe(fillRegionOf(BOX)!.index);
    await show(<ReadyView level={BOX} played={played} onDone={jest.fn()} />);
    const map = screen.getByTestId('level-ready-map', hidden);
    expect(map).toHaveStyle({ width: 72, height: 72, direction: 'ltr' });
    expect(screen.getAllByTestId('level-ready-map-lit', hidden)).toHaveLength(1);
    expect(screen.getByTestId('level-ready-caption')).toHaveTextContent(`ריבוע ${region.index + 1}`);
    expect(screen.queryByTestId('level-ready-prompt')).toBeNull();
  });

  it('fill the row: "שורה D", the row of the board played (attempt 2 is still a row, D69)', async () => {
    const played = attemptLevel(ROW, 2);
    const region = fillRegionOf(played)!;
    expect(region.unit).toBe('row');
    await show(<ReadyView level={ROW} played={played} onDone={jest.fn()} />);
    expect(screen.getByTestId('level-ready-caption')).toHaveTextContent(`שורה ${ROW_LETTERS[region.index]}`);
    expect(screen.getByTestId('level-ready-map', hidden)).toBeTruthy();
  });

  it('Pinpoint on the whole board: "איפה ה־6?" with no map', () => {
    const target = FIND.targets.target;
    const board: AppLevel = { ...FIND, targets: { target: { ...target, scope: { kind: 'board' } } } };
    const where = readyWhere(FIND, board, tFor())!;
    expect(where.prompt).toBe(`איפה ה־${target.digit}?`);
    expect(where.region).toBeNull();
    expect(where.spoken).toBe(`איפה ה־${target.digit}? בכל הלוח.`);
  });

  it('the race: "5 מקומות, מרוץ מול Pip", no spot, no digit, no map (no head start on the bot)', async () => {
    await show(<ReadyView level={RACE} onDone={jest.fn()} />);
    expect(screen.getByTestId('level-ready-line')).toHaveTextContent(
      `${RACE.targets.spots.length} מקומות, מרוץ מול Pip`,
    );
    expect(screen.queryByTestId('level-ready-prompt')).toBeNull();
    expect(screen.queryByTestId('level-ready-map', hidden)).toBeNull();
    expect(screen.queryByText(/בריבוע|בשורה|בעמודה/)).toBeNull();
  });

  it('the puzzle says its counts with no map; the duel and the chain as in 1.0.2', async () => {
    await show(<ReadyView level={PUZZLE} onDone={jest.fn()} />);
    const fixed = PUZZLE.targets.fixed.length;
    const moving = PUZZLE.targets.start.length - fixed;
    expect(screen.getByTestId('level-ready-line')).toHaveTextContent(
      readyWhere(PUZZLE, PUZZLE, tFor())!.line!,
    );
    expect(readyWhere(PUZZLE, PUZZLE, tFor())!.line).toContain(String(moving));
    expect(screen.queryByTestId('level-ready-map', hidden)).toBeNull();
    for (const level of [DUEL, CHAIN]) {
      await screen.unmount();
      await show(<ReadyView level={level} onDone={jest.fn()} />);
      expect(screen.queryByTestId('level-ready-where')).toBeNull();
      expect(screen.queryByTestId('level-ready-map', hidden)).toBeNull();
    }
  });

  it('LEVEL_UI.readyRegion off: no map, no digit, as in 1.0.2', async () => {
    jest.replaceProperty(LEVEL_UI, 'readyRegion', false);
    await show(<ReadyView level={BOX} onDone={jest.fn()} />);
    expect(screen.queryByTestId('level-ready-where')).toBeNull();
    expect(screen.queryByTestId('level-ready-map', hidden)).toBeNull();
    await screen.unmount();
    await show(<ReadyView level={FIND} onDone={jest.fn()} />);
    expect(screen.queryByTestId('level-ready-prompt')).toBeNull();
  });

  it('while the attempt is read (played null): the words show, and the 2 s start only once it is known', async () => {
    const onDone = jest.fn();
    const played = attemptLevel(FIND, 2);
    const at = (p: AppLevel | null) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <ReadyView level={FIND} played={p} onDone={onDone} />
      </SafeAreaProvider>
    );
    const view = await render(at(null));
    expect(screen.getByText('מוכן?')).toBeTruthy();
    expect(screen.queryByTestId('level-ready-prompt')).toBeNull();
    await act(async () => void jest.advanceTimersByTime(5000));
    expect(onDone).not.toHaveBeenCalled();
    await view.rerender(at(played));
    expect(screen.getByTestId('level-ready-prompt')).toBeTruthy();
    await act(async () => void jest.advanceTimersByTime(LEVEL_UI.readyMs - 1));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('ReadyView: a boss’s opening [D77]', () => {
  it('replaces "מוכן?": the crown, "שלב בוס!", the bot, and lasts 3000 ms (LEVEL_UI.bossReadyMs)', async () => {
    expect(LEVEL_UI.bossReadyMs).toBe(3000);
    const onDone = jest.fn();
    await show(<ReadyView level={BOSS_1} onDone={onDone} />);
    expect(screen.getByTestId('boss-intro')).toBeTruthy();
    expect(screen.queryByText('מוכן?')).toBeNull();
    expect(screen.getByTestId('boss-intro-title')).toHaveTextContent('שלב בוס!');
    expect(screen.getByTestId('boss-intro-crown')).toBeTruthy();
    expect(screen.getByTestId('boss-intro-avatar', hidden)).toBeTruthy();
    expect(screen.getByTestId('boss-intro-sub')).toHaveTextContent('שלב 10 · מרוץ מול הבוט');
    expect(screen.getByTestId('boss-intro-versus')).toHaveTextContent('הבוס: Pip');
    expect(screen.getByTestId('glyph-triangle', hidden)).toBeTruthy();
    await act(async () => void jest.advanceTimersByTime(2999));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reads LEVEL_UI.bossReadyMs; paused, the 3 s stand still', async () => {
    jest.replaceProperty(LEVEL_UI, 'bossReadyMs', 1000);
    const onDone = jest.fn();
    const at = (paused: boolean) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <ReadyView level={BOSS_2} onDone={onDone} paused={paused} />
      </SafeAreaProvider>
    );
    const view = await render(at(false));
    await act(async () => void jest.advanceTimersByTime(600));
    await view.rerender(at(true));
    await act(async () => void jest.advanceTimersByTime(10_000));
    expect(onDone).not.toHaveBeenCalled();
    await view.rerender(at(false));
    await act(async () => void jest.advanceTimersByTime(399));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a chip for each of the engine’s traits: chapter 1 "הבוט הראשון: Pip", chapter 2 "Pip מהיר ב־10%"', async () => {
    expect(bossTraits(BOSS_1)).toEqual([{ key: 'firstBot', bot: 'Pip' }]);
    await show(<ReadyView level={BOSS_1} onDone={jest.fn()} />);
    expect(screen.getByText('מה קשה יותר')).toBeTruthy();
    expect(screen.getByTestId('boss-trait-firstBot')).toHaveTextContent('הבוט הראשון: Pip');
    expect(screen.queryByTestId('boss-trait-faster')).toBeNull();
    await screen.unmount();

    const [faster] = bossTraits(BOSS_2);
    expect(faster).toMatchObject({ key: 'faster', pct: 10 });
    await show(<ReadyView level={BOSS_2} onDone={jest.fn()} />);
    expect(screen.getByTestId('boss-trait-faster')).toHaveTextContent(`Pip מהיר ב־${ltr('10%')}`);
    expect(screen.getByTestId('level-ready-content')).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining(`שלב בוס! שלב 20, מרוץ מול הבוט. הבוס: Pip. Pip מהיר ב־${ltr('10%')}.`),
    );
  });

  it('Overlord’s boss: "Overlord"; a duel boss is opened the same way', async () => {
    await show(<ReadyView level={OVERLORD} onDone={jest.fn()} />);
    expect(screen.getByTestId('boss-trait-overlord')).toHaveTextContent('Overlord');
    await screen.unmount();
    await show(<ReadyView level={DUEL_BOSS} onDone={jest.fn()} />);
    expect(screen.getByTestId('boss-intro-title')).toHaveTextContent('שלב בוס!');
    expect(screen.getAllByTestId(/^boss-trait-/)).toHaveLength(bossTraits(DUEL_BOSS).length);
  });

  it('only what bossTraits says: no trait, no "מה קשה יותר" and no chip', async () => {
    // A boss with no bot and no more cells (D72 ב's shape, made from a fill-box) has no trait at all.
    const noBot = { ...BOX, boss: true } as AppLevel;
    expect(bossTraits(noBot)).toEqual([]);
    await show(<ReadyView level={noBot} onDone={jest.fn()} />);
    expect(screen.queryByText('מה קשה יותר')).toBeNull();
    expect(screen.queryAllByTestId(/^boss-trait-/)).toHaveLength(0);
  });

  it('a boss with no bot (only under D72 ב): the gold medallion with its crown, no avatar', async () => {
    const noBot = { ...BOX, boss: true } as AppLevel;
    await show(<ReadyView level={noBot} onDone={jest.fn()} />);
    expect(screen.getByTestId('boss-intro-medallion')).toBeTruthy();
    expect(screen.queryByTestId('boss-intro-avatar', hidden)).toBeNull();
    expect(screen.queryByTestId('boss-intro-versus')).toBeNull();
  });

  it('full motion: the crown lands (1.4 → 1) and the chips come in one by one', async () => {
    await show(<ReadyView level={BOSS_1} onDone={jest.fn()} />);
    const crown = screen.getByTestId('boss-intro-crown');
    expect(crown).toHaveAnimatedStyle({ transform: [{ scale: LEVEL_MOTION.bossCrownFrom }] });
    expect(screen.getByTestId('boss-trait-firstBot')).toHaveAnimatedStyle({ opacity: 0 });
    await act(async () => void jest.advanceTimersByTime(1500));
    expect(crown).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
    expect(screen.getByTestId('boss-trait-firstBot')).toHaveAnimatedStyle({
      opacity: 1,
      transform: [{ translateY: 0 }],
    });
  });

  it('Reduced Motion: no landing, everything there together, the same 3 s', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const onDone = jest.fn();
    await show(<ReadyView level={BOSS_2} onDone={onDone} />);
    expect(screen.getByTestId('boss-intro-crown')).toHaveAnimatedStyle({ transform: [{ scale: 1 }] });
    expect(screen.getByTestId('boss-trait-faster')).toHaveAnimatedStyle({
      opacity: 1,
      transform: [{ translateY: 0 }],
    });
    await act(async () => void jest.advanceTimersByTime(2999));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => void jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the chips’ clock: 240 ms each, 120 ms apart', () => {
    expect(chipsSpanMs(0)).toBe(0);
    expect(chipsSpanMs(2)).toBe(LEVEL_MOTION.bossChipStaggerMs + LEVEL_MOTION.bossChipMs);
    expect(chipProgress(0, 0)).toBe(0);
    expect(chipProgress(120, 0)).toBe(0.5);
    expect(chipProgress(120, 1)).toBe(0);
    expect(chipProgress(240, 1)).toBe(0.5);
    expect(chipProgress(360, 1)).toBe(1);
  });

  it('speaks English: "Boss stage!", "Your first bot: Pip"', async () => {
    await act(async () => void (await i18n.changeLanguage('en')));
    await show(<ReadyView level={BOSS_1} onDone={jest.fn()} />);
    expect(screen.getByTestId('boss-intro-title')).toHaveTextContent('Boss stage!');
    expect(screen.getByTestId('boss-trait-firstBot')).toHaveTextContent('Your first bot: Pip');
  });
});
