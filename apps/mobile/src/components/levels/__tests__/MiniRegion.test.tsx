import { render, screen } from '@testing-library/react-native';
import { I18nManager, StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { color, contrast, size } from '../../../theme';
import { litRects, MiniRegion, miniLayout, regionCellsOf, regionOfScope } from '../MiniRegion';

/**
 * The small map of the board with a stage's region lit (levels-ui.md §2.4–2.5, D75–D76): a box, a row, a column
 * or every box, in gold on the nine boxes, always LTR (box 1, row A and column 1 at the top-left, in Hebrew too);
 * 27 dp in a fill stage's header, 72 dp in "מוכן?"; decorative unless it has a label.
 */

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle;

beforeEach(async () => {
  await i18n.changeLanguage('he');
});

describe('regionCellsOf and regionOfScope', () => {
  it('nine cells for a box, a row and a column, row by row; all 81 for the whole board', () => {
    expect(regionCellsOf({ unit: 'box', index: 4 })).toEqual([30, 31, 32, 39, 40, 41, 48, 49, 50]);
    expect(regionCellsOf({ unit: 'row', index: 3 })).toEqual([27, 28, 29, 30, 31, 32, 33, 34, 35]);
    expect(regionCellsOf({ unit: 'col', index: 4 })).toEqual([4, 13, 22, 31, 40, 49, 58, 67, 76]);
    expect(regionCellsOf({ unit: 'board' })).toHaveLength(81);
  });

  it('a find’s scope ("kind") as a region ("unit")', () => {
    expect(regionOfScope({ kind: 'row', index: 2 })).toEqual({ unit: 'row', index: 2 });
    expect(regionOfScope({ kind: 'board' })).toEqual({ unit: 'board' });
  });
});

describe('MiniRegion', () => {
  const side = size.miniRegion.hud;
  const { gap, box, cell } = miniLayout(side);

  it('the nine boxes, the region lit in gold; 27 dp by default', async () => {
    await render(<MiniRegion region={{ unit: 'box', index: 4 }} />);
    const map = screen.getByTestId('mini-region', hidden);
    expect(styleOf(map)).toMatchObject({ width: 27, height: 27 });
    const lit = screen.getByTestId('mini-region-lit', hidden);
    expect(styleOf(lit)).toMatchObject({
      backgroundColor: color.focusRing,
      left: box + gap,
      top: box + gap,
      width: box,
      height: box,
    });
  });

  it('a row runs across the whole map at its row, a column down it at its column', async () => {
    await render(<MiniRegion region={{ unit: 'row', index: 3 }} testID="map" />);
    expect(styleOf(screen.getByTestId('map-lit', hidden))).toMatchObject({
      left: 0,
      top: box + gap,
      width: side,
      height: cell,
    });
    await screen.unmount();
    await render(<MiniRegion region={{ unit: 'col', index: 8 }} testID="map" />);
    expect(styleOf(screen.getByTestId('map-lit', hidden))).toMatchObject({
      left: 2 * (box + gap) + 2 * cell,
      top: 0,
      width: cell,
      height: side,
    });
  });

  it('the whole board: every box lit', async () => {
    await render(<MiniRegion region={{ unit: 'board' }} />);
    expect(screen.getAllByTestId('mini-region-lit', hidden)).toHaveLength(9);
  });

  it('always LTR: column 1 on the left and row A on top, in Hebrew and with the app right-to-left', async () => {
    const rtl = jest.replaceProperty(I18nManager, 'isRTL', true);
    try {
      await render(<MiniRegion region={{ unit: 'col', index: 0 }} />);
      expect(styleOf(screen.getByTestId('mini-region', hidden)).direction).toBe('ltr');
      expect(styleOf(screen.getByTestId('mini-region-lit', hidden)).left).toBe(0);
      expect(litRects({ unit: 'row', index: 0 }, side)[0]).toMatchObject({ left: 0, top: 0 });
      expect(litRects({ unit: 'box', index: 2 }, side)[0]!.left).toBeGreaterThan(side / 2);
    } finally {
      rtl.restore();
    }
  });

  it('72 dp in "מוכן?", the same layout scaled', async () => {
    await render(<MiniRegion region={{ unit: 'box', index: 0 }} size={size.miniRegion.ready} />);
    expect(styleOf(screen.getByTestId('mini-region', hidden))).toMatchObject({ width: 72, height: 72 });
    const big = miniLayout(72);
    expect(styleOf(screen.getByTestId('mini-region-lit', hidden))).toMatchObject({
      left: 0,
      top: 0,
      width: big.box,
    });
    expect(3 * big.box + 2 * big.gap).toBeCloseTo(72);
  });

  it('decorative by default; with a label, one image for a screen reader', async () => {
    await render(<MiniRegion region={{ unit: 'row', index: 3 }} />);
    expect(screen.getByTestId('mini-region', hidden)).toHaveProp('accessibilityElementsHidden', true);
    await screen.unmount();
    await render(<MiniRegion region={{ unit: 'row', index: 3 }} accessibilityLabel="מפת הלוח: שורה D" />);
    const map = screen.getByLabelText('מפת הלוח: שורה D');
    expect(map).toHaveProp('accessibilityRole', 'image');
  });

  it('the region is the lighter one, at least 3:1 against the boxes (greyscale too)', () => {
    expect(contrast(color.focusRing, color.iconFaint)).toBeGreaterThanOrEqual(3);
  });
});
