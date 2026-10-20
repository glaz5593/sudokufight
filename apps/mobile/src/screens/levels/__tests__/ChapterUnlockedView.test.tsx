import 'react-native-reanimated';

import { DEFAULT_PROGRESS_RULES } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ltr } from '../../../components/player/format';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { ChapterUnlockedView } from '../ChapterUnlockedView';

/**
 * "פרק חדש נפתח" (components.md §19.11): the chapter and its name, the new bot's line, what is new, "‎+50 XP"
 * (LRI-isolated) once; the map shows it once per chapter (levels.db celebrated). With Reduced Motion nothing
 * that moves is mounted: the content is there at once.
 */

const METRICS = {
  frame: { x: 0, y: 0, width: 360, height: 780 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const hidden = { includeHiddenElements: true };

const show = (onDone = jest.fn()) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ChapterUnlockedView chapter={5} bot={2} xp={DEFAULT_PROGRESS_RULES.xp.levelGate} onDone={onDone} />
    </SafeAreaProvider>,
  );

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => jest.useRealTimers());

describe('ChapterUnlockedView', () => {
  it('"פרק 5 · Biscuit", the bot’s line, what is new, and "‎+50 XP" once', async () => {
    const onDone = jest.fn();
    await show(onDone);
    expect(screen.getByText('פרק חדש נפתח!')).toBeTruthy();
    expect(screen.getByText('פרק 5 · Biscuit')).toBeTruthy();
    expect(screen.getByText(/^Biscuit: /)).toBeTruthy();
    expect(screen.getByTestId('chapter-unlocked-news')).toHaveTextContent(
      'מה חדש: בוט חדש: Biscuit, צייד הנקודות, ובמילוי כל ספרה חסרה לפחות פעם אחת',
    );
    expect(screen.getAllByText(`${ltr('+50')} XP`)).toHaveLength(1);
    expect(DEFAULT_PROGRESS_RULES.xp.levelGate).toBe(50);
    await fireEvent.press(screen.getByTestId('chapter-unlocked-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('with full motion the title slams in and the XP pops last', async () => {
    jest.useFakeTimers();
    await show();
    expect(screen.getByTestId('chapter-unlocked-title')).toHaveAnimatedStyle({ opacity: 0 });
    expect(screen.getByTestId('chapter-unlocked-xp')).toHaveAnimatedStyle({ opacity: 0 });
    expect(
      (screen.getByTestId('chapter-unlocked-xp').props as { jestAnimatedStyle?: unknown }).jestAnimatedStyle,
    ).toBeDefined();
    await act(async () => void jest.advanceTimersByTime(2000));
    expect(screen.getByTestId('chapter-unlocked-title')).toHaveAnimatedStyle({
      opacity: 1,
      transform: [{ scale: 1 }],
    });
    expect(screen.getByTestId('chapter-unlocked-xp')).toHaveAnimatedStyle({
      opacity: 1,
      transform: [{ scale: 1 }],
    });
  });

  it('Reduced Motion: no animation mounted, everything there at once', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    await show();
    for (const id of ['chapter-unlocked-title', 'chapter-unlocked-bot', 'chapter-unlocked-xp']) {
      const el = screen.getByTestId(id, hidden);
      // A plain View: no animated style at all.
      expect((el.props as { jestAnimatedStyle?: unknown }).jestAnimatedStyle).toBeUndefined();
      expect(el).toBeOnTheScreen();
    }
    expect(screen.getByText(`${ltr('+50')} XP`)).toBeTruthy();
  });
});
