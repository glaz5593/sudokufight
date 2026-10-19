import 'react-native-reanimated';

import { parseCellName } from '@sudoku-fight/engine';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, tokens } from '../../../theme';
import { boardGeometry, cellRect } from '../../board/geometry';
import { ResumeCountdown } from '../../board/ResumeCountdown';
import { BoardFreezeLayer } from '../BoardFreezeLayer';
import { CellChipsLayer } from '../CellChipsLayer';
import { RegionFrame } from '../RegionFrame';

/**
 * What a stage draws over its board (components.md §19.7): the area's 2 dp ring (RegionFrame), chips over cells
 * (CellChipsLayer: no touch, hidden from screen readers, a fade that honours Reduced Motion), the race's
 * 3 s freeze (BoardFreezeLayer: a scrim with its ring that takes every touch, said once), and [D65] the
 * resume countdown over the covered board (ResumeCountdown: 3, 2, 1; Reduced Motion: the number just changes).
 */

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;
const WIDTH = 358;
const box5 = ['D4', 'D5', 'D6', 'E4', 'E5', 'E6', 'F4', 'F5', 'F6'].map((n) => parseCellName(n)!);

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => jest.useRealTimers());

describe('RegionFrame', () => {
  it('rings the area’s cells 2 dp out, in the box gap: light for a find, gold for the box to fill', async () => {
    await render(<RegionFrame cells={box5} width={WIDTH} />);
    const g = boardGeometry(WIDTH);
    const first = cellRect(g, box5[0]!);
    const last = cellRect(g, box5[8]!);
    const ring = tokens.border.focus;
    expect(styleOf(screen.getByTestId('region-frame-focus', hidden))).toMatchObject({
      position: 'absolute',
      left: first.x - ring,
      top: first.y - ring,
      width: last.x + last.width - first.x + 2 * ring,
      height: last.y + last.height - first.y + 2 * ring,
      borderWidth: ring,
      borderColor: color.text,
    });
    await screen.unmount();
    await render(<RegionFrame cells={box5} width={WIDTH} tone="gold" />);
    const gold = screen.getByTestId('region-frame-gold', hidden);
    expect(styleOf(gold).borderColor).toBe(color.focusRing);
    expect(gold).toHaveProp('pointerEvents', 'none');
    expect(gold).toHaveProp('accessibilityElementsHidden', true);
  });

  it('draws nothing without cells', async () => {
    await render(<RegionFrame cells={[]} width={WIDTH} />);
    expect(screen.queryByTestId('region-frame-focus', hidden)).toBeNull();
  });
});

describe('CellChipsLayer', () => {
  const chips = [{ id: 1, cell: parseCellName('E4')!, text: '⁦+5⁩', tone: 'penalty' as const }];

  it('takes no touch and is hidden from screen readers; a chip sits on its cell’s top edge', async () => {
    await render(<CellChipsLayer chips={chips} width={WIDTH} />);
    const layer = screen.getByTestId('cell-chips', hidden);
    expect(layer).toHaveProp('pointerEvents', 'none');
    expect(layer).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(screen.queryByText('⁦+5⁩')).toBeNull();
    expect(screen.getByText('⁦+5⁩', hidden)).toBeTruthy();
    const r = cellRect(boardGeometry(WIDTH), parseCellName('E4')!);
    expect(styleOf(screen.getByTestId(`cell-chips-${parseCellName('E4')}`, hidden)).left).toBe(
      r.x + r.width / 2,
    );
  });

  it('a chip fades in over 240 ms; under Reduced Motion, the 200 ms fade', async () => {
    jest.useFakeTimers();
    await render(<CellChipsLayer chips={chips} width={WIDTH} />);
    const chip = screen.getByTestId(`cell-chips-${parseCellName('E4')}`, hidden);
    await act(async () => void jest.advanceTimersByTime(210));
    expect(chip).not.toHaveAnimatedStyle({ opacity: 1 });
    await act(async () => void jest.advanceTimersByTime(200));
    expect(chip).toHaveAnimatedStyle({ opacity: 1 });
    await screen.unmount();

    useSettings.setState({ reduceMotion: 'on' });
    await render(<CellChipsLayer chips={chips} width={WIDTH} />);
    await act(async () => void jest.advanceTimersByTime(210));
    expect(screen.getByTestId(`cell-chips-${parseCellName('E4')}`, hidden)).toHaveAnimatedStyle({
      opacity: 1,
    });
  });
});

describe('BoardFreezeLayer', () => {
  it('a board-sized scrim with the 3 s ring; it takes every touch and says "מוקפא, 3 שניות" once', async () => {
    await render(<BoardFreezeLayer frozenUntil={13_000} totalMs={3000} now={10_000} />);
    const scrim = screen.getByTestId('board-freeze');
    expect(styleOf(scrim)).toMatchObject({ position: 'absolute', backgroundColor: color.scrim });
    expect(scrim.props.onStartShouldSetResponder()).toBe(true);
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'מוקפא, 3 שניות');
    expect(screen.getByTestId('board-freeze-seconds')).toHaveTextContent('3');
    expect(screen.getByTestId('board-freeze-ring', hidden)).toBeTruthy();
  });

  it('out of the spot: says so, with no ring; not frozen: nothing', async () => {
    await render(<BoardFreezeLayer frozenUntil={null} totalMs={3000} now={0} out />);
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'בחוץ עד המקום הבא');
    expect(screen.queryByTestId('board-freeze-ring', hidden)).toBeNull();
    await screen.unmount();
    await render(<BoardFreezeLayer frozenUntil={null} totalMs={3000} now={0} />);
    expect(screen.queryByTestId('board-freeze')).toBeNull();
  });
});

describe('[D65] ResumeCountdown', () => {
  it('covers the board; away it says the game stands still, back it counts with a live announcement', async () => {
    const view = await render(<ResumeCountdown state={{ kind: 'paused' }} />);
    expect(styleOf(screen.getByTestId('resume-countdown'))).toMatchObject({
      position: 'absolute',
      backgroundColor: color.bg,
    });
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'המשחק עצור');
    expect(screen.queryByTestId('resume-countdown-number')).toBeNull();
    await view.rerender(<ResumeCountdown state={{ kind: 'countdown', count: 3 }} />);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('3');
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'ממשיכים בעוד 3 שניות');
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLiveRegion', 'assertive');
    // Full motion: each number pops in.
    expect(screen.getByTestId('resume-countdown-number-animated')).toBeTruthy();
    await view.rerender(<ResumeCountdown state={{ kind: 'countdown', count: 1 }} />);
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'ממשיכים בעוד שנייה');
    await view.rerender(<ResumeCountdown state={null} />);
    expect(screen.queryByTestId('resume-countdown')).toBeNull();
  });

  it('Reduced Motion: the number just changes, nothing animated', async () => {
    useSettings.setState({ reduceMotion: 'on' });
    const view = await render(<ResumeCountdown state={{ kind: 'countdown', count: 3 }} />);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('3');
    expect(screen.queryByTestId('resume-countdown-number-animated')).toBeNull();
    await view.rerender(<ResumeCountdown state={{ kind: 'countdown', count: 2 }} />);
    expect(screen.getByTestId('resume-countdown-number')).toHaveTextContent('2');
    expect(screen.queryByTestId('resume-countdown-number-animated')).toBeNull();
  });

  it('in English too', async () => {
    await act(async () => void (await i18n.changeLanguage('en')));
    await render(<ResumeCountdown state={{ kind: 'countdown', count: 2 }} />);
    expect(screen.getByRole('alert')).toHaveProp('accessibilityLabel', 'Back in 2 seconds');
  });
});
