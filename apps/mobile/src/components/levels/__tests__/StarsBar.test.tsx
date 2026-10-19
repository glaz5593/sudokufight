import 'react-native-reanimated';

import type { StarRule } from '@sudoku-fight/engine';
import { act, render, screen } from '@testing-library/react-native';
import { I18nManager, StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { axisOf, litStars, StarsBar } from '../StarsBar';

/**
 * The star meter (components.md §19.5): a time axis that fills left to right in both languages, a mark at
 * each threshold at its share of the axis, the stars above each band, a label that lists the thresholds; a
 * race's pips by owner (● me, ▲ the bot); a fill that moves, or jumps under Reduced Motion.
 */

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;

const FIND: StarRule = { by: 'timeMs', three: 5000, two: 10000, one: 20000 };
const RACE: StarRule = { by: 'spots', three: 4, two: 3, one: 2 };

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => jest.useRealTimers());

describe('StarsBar', () => {
  it('a time axis reads left to right, in Hebrew too (the axis is time, not reading order)', async () => {
    expect(I18nManager.isRTL || i18n.language === 'he').toBe(true);
    await render(<StarsBar rule={FIND} value={0} max={20000} />);
    expect(styleOf(screen.getByTestId('stars-bar-axis', hidden))).toMatchObject({ direction: 'ltr' });
    // The fill is the track's first child, so it grows from the axis's start: the left.
    const track = screen.getByTestId('stars-bar-track', hidden);
    expect(styleOf(track)).toMatchObject({ flexDirection: 'row' });
    expect((track.children[0] as unknown as { props: { testID: string } }).props.testID).toBe(
      'stars-bar-fill',
    );
  });

  it('marks each threshold at its share of the axis, with its seconds under it', async () => {
    await render(<StarsBar rule={FIND} value={0} max={20000} />);
    expect(styleOf(screen.getByTestId('stars-bar-tick-3', hidden)).start).toBe('25%');
    expect(styleOf(screen.getByTestId('stars-bar-tick-2', hidden)).start).toBe('50%');
    expect(styleOf(screen.getByTestId('stars-bar-tick-1', hidden)).start).toBe('100%');
    expect(screen.getByTestId('stars-bar-number-3', hidden)).toHaveTextContent('5');
    expect(screen.getByTestId('stars-bar-number-2', hidden)).toHaveTextContent('10');
    expect(axisOf(FIND, 7000, 30000).marks.map((m) => [m.stars, m.share, m.lit])).toEqual([
      [3, 5000 / 30000, false],
      [2, 10000 / 30000, true],
      [1, 20000 / 30000, true],
    ]);
    expect(litStars(axisOf(FIND, 7000).marks)).toBe(2);
  });

  it('its label lists the thresholds', async () => {
    await render(<StarsBar rule={FIND} value={0} max={20000} />);
    expect(screen.getByRole('progressbar')).toHaveProp(
      'accessibilityLabel',
      '3 כוכבים: עד 5 ש׳ · 2 כוכבים: עד 10 ש׳ · כוכב אחד: עד 20 ש׳',
    );
    await act(async () => void (await i18n.changeLanguage('en')));
    await render(<StarsBar rule={RACE} value={0} spots={[null, null, null, null, null]} />);
    expect(screen.getByRole('progressbar')).toHaveProp(
      'accessibilityLabel',
      // The range is an LTR isolate: its dash would turn it around in a Hebrew line.
      '3 stars: ⁦4–5⁩ spots · 2 stars: 3 spots · 1 star: 2 spots',
    );
  });

  it('a band’s stars are gold while it can be had, faint once lost', async () => {
    await render(<StarsBar rule={FIND} value={7000} max={20000} />);
    // 7 s: ★★★ (up to 5 s) is lost, ★★ and ★ can still be had.
    expect(screen.getAllByTestId('stars-bar-mark-3-out', hidden)).toHaveLength(3);
    expect(screen.getAllByTestId('stars-bar-mark-2-lit', hidden)).toHaveLength(2);
    expect(screen.getAllByTestId('stars-bar-mark-1-lit', hidden)[0]).toHaveProp('width', 11);
  });

  it('a race: a pip per spot, in its taker’s colour and shape', async () => {
    await render(<StarsBar rule={RACE} value={2} spots={['me', 'bot', 'me', null, null]} />);
    expect(screen.getByTestId('stars-bar-pip-0-me', hidden)).toBeTruthy();
    expect(screen.getByTestId('stars-bar-pip-1-bot', hidden)).toBeTruthy();
    expect(screen.getByTestId('stars-bar-pip-3-open', hidden)).toBeTruthy();
    expect(screen.getAllByTestId('glyph-circle', hidden)).toHaveLength(2);
    expect(screen.getAllByTestId('glyph-triangle', hidden)).toHaveLength(1);
  });

  it('the fill moves to a new value; under Reduced Motion it jumps', async () => {
    jest.useFakeTimers();
    const view = await render(<StarsBar rule={FIND} value={0} max={20000} />);
    await view.rerender(<StarsBar rule={FIND} value={10000} max={20000} />);
    expect(screen.getByTestId('stars-bar-fill', hidden)).not.toHaveAnimatedStyle({ width: '50%' });
    await act(async () => void jest.advanceTimersByTime(400));
    expect(screen.getByTestId('stars-bar-fill', hidden)).toHaveAnimatedStyle({ width: '50%' });
    await view.unmount();

    useSettings.setState({ reduceMotion: 'on' });
    const still = await render(<StarsBar rule={FIND} value={0} max={20000} />);
    await still.rerender(<StarsBar rule={FIND} value={10000} max={20000} />);
    // One frame: there already (with full motion it would be on its way, 240 ms).
    await act(async () => void jest.advanceTimersByTime(16));
    expect(screen.getByTestId('stars-bar-fill', hidden)).toHaveAnimatedStyle({ width: '50%' });
  });
});
