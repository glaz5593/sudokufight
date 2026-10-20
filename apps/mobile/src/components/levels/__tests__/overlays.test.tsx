import 'react-native-reanimated';

import { parseCellName } from '@sudoku-fight/engine';
import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { LEVEL_MOTION, LEVEL_UI } from '../../../config/levels';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, tokens } from '../../../theme';
import { boardGeometry, cellRect } from '../../board/geometry';
import { ResumeCountdown } from '../../board/ResumeCountdown';
import { BoardFreezeLayer } from '../BoardFreezeLayer';
import { CellChipsLayer } from '../CellChipsLayer';
import { RegionFrame, regionIntroOf } from '../RegionFrame';

/**
 * What a stage draws over its board (components.md §19.7): the region's frame and the answer's ring (RegionFrame,
 * 1.0.3, D75), chips over cells
 * (CellChipsLayer: no touch, hidden from screen readers, a fade that honours Reduced Motion), the race's
 * 3 s freeze (BoardFreezeLayer: a scrim with its ring that takes every touch, said once), and [D65] the
 * resume countdown over the covered board (ResumeCountdown: 3, 2, 1; Reduced Motion: the number just changes).
 */

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;
const WIDTH = 358;
const box5 = ['D4', 'D5', 'D6', 'E4', 'E5', 'E6', 'F4', 'F5', 'F6'].map((n) => parseCellName(n)!);
type Part = { props: { style?: unknown }; children: unknown[] };
/** A frame's parts, inside out (they carry no ids): the gold band is the frame's child, the dark line the gold's. */
const partsOf = (el: unknown) => (el as Part).children as Part[];

beforeEach(async () => {
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});
afterEach(() => jest.useRealTimers());

describe('RegionFrame (levels-ui.md §2.2–2.3, D75)', () => {
  const g = boardGeometry(WIDTH);
  const KEY = tokens.border.regionKeyline;
  const FRAME = tokens.border.regionFrame;
  const THICK = 2 * KEY + FRAME;
  const named = (names: string) => names.split(' ').map((n) => parseCellName(n)!);
  const rowD = named('D1 D2 D3 D4 D5 D6 D7 D8 D9');
  const col5 = named('A5 B5 C5 D5 E5 F5 G5 H5 I5');
  /** The frame's rect: the cells' bounding rect, the frame's whole thickness out on every side. */
  const ringOf = (cells: number[]) => {
    const first = cellRect(g, cells[0]!);
    const last = cellRect(g, cells[cells.length - 1]!);
    return {
      left: first.x - THICK,
      top: first.y - THICK,
      width: last.x + last.width - first.x + 2 * THICK,
      height: last.y + last.height - first.y + 2 * THICK,
    };
  };

  it.each([
    ['a box', box5],
    ['a row (nine cells across)', rowD],
    ['a column', col5],
  ])(
    'the same frame for %s: a dark line, the gold band, a dark line, just outside the cells',
    async (_n, cells) => {
      await render(<RegionFrame cells={cells} width={WIDTH} />);
      const frame = screen.getByTestId('region-frame', hidden);
      expect(styleOf(frame)).toMatchObject({
        position: 'absolute',
        ...ringOf(cells),
        borderWidth: KEY,
        borderColor: color.board.given,
      });
      const [gold] = partsOf(frame);
      expect(styleOf(gold!)).toMatchObject({
        borderWidth: FRAME,
        borderColor: color.focusRing,
      });
      expect(styleOf(partsOf(gold)[0]!)).toMatchObject({
        borderWidth: KEY,
        borderColor: color.board.given,
      });
      expect(frame).toHaveProp('pointerEvents', 'none');
      expect(frame).toHaveProp('accessibilityElementsHidden', true);
    },
  );

  it('a row is nine cells wide and one high; a column the other way round', async () => {
    await render(<RegionFrame cells={rowD} width={WIDTH} />);
    const row = styleOf(screen.getByTestId('region-frame', hidden));
    expect(row.height).toBeCloseTo(g.cell + 2 * THICK);
    expect(row.width).toBeCloseTo(WIDTH + 2 * THICK);
    await screen.unmount();
    await render(<RegionFrame cells={col5} width={WIDTH} />);
    const col = styleOf(screen.getByTestId('region-frame', hidden));
    expect(col.width).toBeCloseTo(g.cell + 2 * THICK);
    expect(col.height).toBeCloseTo(WIDTH + 2 * THICK);
  });

  it('draws nothing without cells', async () => {
    await render(<RegionFrame cells={[]} width={WIDTH} />);
    expect(screen.queryByTestId('region-frame', hidden)).toBeNull();
    expect(screen.queryByTestId('answer-frame', hidden)).toBeNull();
  });

  describe('[D75b] the spotlight', () => {
    beforeEach(() => jest.useFakeTimers());
    const run = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

    it('full motion: the frame lands (1.06 → 1, 0 → 1), then the gold band flashes once, all under a second', async () => {
      await render(<RegionFrame cells={box5} width={WIDTH} intro="full" />);
      const frame = screen.getByTestId('region-frame', hidden);
      const band = screen.getByTestId('region-frame-band', hidden);
      expect(styleOf(band)).toMatchObject({
        borderWidth: LEVEL_MOTION.regionBandWidth,
        borderColor: color.board.regionBand,
      });
      expect(frame).toHaveAnimatedStyle({ opacity: 0, transform: [{ scale: LEVEL_MOTION.regionLandScale }] });
      expect(band).toHaveAnimatedStyle({ opacity: 0 });
      await run(LEVEL_MOTION.regionLandMs + LEVEL_MOTION.regionBandMs / 2);
      expect(frame).toHaveAnimatedStyle({ opacity: 1 });
      expect(band).not.toHaveAnimatedStyle({ opacity: 0 });
      await run(1000);
      expect(frame).toHaveAnimatedStyle({ opacity: 1, transform: [{ scale: 1 }] });
      expect(band).toHaveAnimatedStyle({ opacity: 0 });
      expect(LEVEL_MOTION.regionLandMs + LEVEL_MOTION.regionBandMs).toBeLessThan(1000);
    });

    it('Reduced Motion: the frame is there from the first frame, nothing lands, no band', async () => {
      useSettings.setState({ reduceMotion: 'on' });
      await render(<RegionFrame cells={box5} width={WIDTH} intro="full" />);
      expect(screen.getByTestId('region-frame', hidden)).toHaveAnimatedStyle({
        opacity: 1,
        transform: [{ scale: 1 }],
      });
      expect(screen.queryByTestId('region-frame-band', hidden)).toBeNull();
      expect(regionIntroOf('full', true)).toBe('none');
    });

    it('LEVEL_UI.regionIntro off: no spotlight either', async () => {
      LEVEL_UI.regionIntro = false;
      try {
        await render(<RegionFrame cells={box5} width={WIDTH} intro="full" />);
        expect(screen.getByTestId('region-frame', hidden)).toHaveAnimatedStyle({ opacity: 1 });
        expect(screen.queryByTestId('region-frame-band', hidden)).toBeNull();
      } finally {
        LEVEL_UI.regionIntro = true;
      }
    });

    it('a race’s next spot: the band only, the frame at once; a new key plays it again', async () => {
      const view = await render(<RegionFrame key="spot-1" cells={box5} width={WIDTH} intro="band" />);
      expect(screen.getByTestId('region-frame', hidden)).toHaveAnimatedStyle({
        opacity: 1,
        transform: [{ scale: 1 }],
      });
      await run(LEVEL_MOTION.regionBandMs / 2);
      expect(screen.getByTestId('region-frame-band', hidden)).not.toHaveAnimatedStyle({ opacity: 0 });
      await run(LEVEL_MOTION.regionBandMs);
      expect(screen.getByTestId('region-frame-band', hidden)).toHaveAnimatedStyle({ opacity: 0 });
      await view.rerender(<RegionFrame key="spot-2" cells={rowD} width={WIDTH} intro="band" />);
      await run(LEVEL_MOTION.regionBandMs / 2);
      expect(screen.getByTestId('region-frame-band', hidden)).not.toHaveAnimatedStyle({ opacity: 0 });
    });

    it('no intro: the frame as it is, no band', async () => {
      await render(<RegionFrame cells={box5} width={WIDTH} />);
      expect(screen.getByTestId('region-frame', hidden)).toHaveAnimatedStyle({ opacity: 1 });
      expect(screen.queryByTestId('region-frame-band', hidden)).toBeNull();
    });
  });

  describe('the answer: its own look, never the region’s gold', () => {
    const d4 = parseCellName('D4')!;

    it('a dark ring on the cell, a white line inside it, the digit in a dark chip', async () => {
      await render(<RegionFrame cells={[d4]} width={WIDTH} look="answer" digit={6} />);
      const r = cellRect(g, d4);
      const ring = screen.getByTestId('answer-frame', hidden);
      expect(styleOf(ring)).toMatchObject({
        left: r.x,
        top: r.y,
        width: r.width,
        height: r.height,
        borderWidth: FRAME,
        borderColor: color.board.given,
      });
      const [keyline, chip] = partsOf(ring);
      expect(styleOf(keyline!)).toMatchObject({
        borderWidth: KEY,
        borderColor: color.board.answerKeyline,
      });
      expect(styleOf(chip!).backgroundColor).toBe(color.board.given);
      expect(ring).toHaveTextContent('6');
      // Nothing gold in it: the region's colour is the region's only.
      expect(partsOf(ring).map((p) => styleOf(p).borderColor)).not.toContain(color.focusRing);
      expect(ring).toHaveProp('pointerEvents', 'none');
      expect(ring).toHaveProp('accessibilityElementsHidden', true);
    });

    it('no digit (spot the error: the cell shows its own): the ring alone; the same under Reduced Motion', async () => {
      useSettings.setState({ reduceMotion: 'on' });
      await render(<RegionFrame cells={[d4]} width={WIDTH} look="answer" />);
      const ring = screen.getByTestId('answer-frame', hidden);
      expect(partsOf(ring)).toHaveLength(1);
      expect(ring).not.toHaveTextContent(/\d/);
      expect(screen.queryByTestId('answer-frame-band', hidden)).toBeNull();
    });

    it('is not the region frame: dark against its gold (the pair in src/__tests__/contrast.test.ts)', () => {
      expect(color.board.given).not.toBe(color.focusRing);
      expect(color.board.answerKeyline).not.toBe(color.board.given);
    });
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
