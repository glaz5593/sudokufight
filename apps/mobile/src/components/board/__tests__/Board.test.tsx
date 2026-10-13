import { parseCellName } from '@sudoku-fight/engine';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { color, size, tokens } from '../../../theme';
import { Board } from '../Board';
import { boardModel } from '../boardModel';
import { DEMO_PUZZLE, demoBoard, DemoGame } from '../demo';
import { boardGeometry, cellHitSlop, cornerOf, fontPx, geometryForCell, px } from '../geometry';

const styleOf = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as ViewStyle) ?? {};

describe('Board', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('he');
    useSettings.setState({ reduceMotion: 'off' });
  });

  const demo = () => {
    const { view, mySeat, now } = demoBoard();
    return boardModel(view, mySeat, now, { avatars: { nina: 'lava-lamp', aiko: 'maya' } });
  };

  it('is a grid of 81 cell buttons with a summary label, always left to right', async () => {
    await render(<Board model={demo()} />);
    const grid = screen.getByTestId('board');
    expect(grid.props.accessibilityLabel).toBe(
      'לוח המשחק · המשבצת שלך F8 · D4 נעולה על ידי NinaVolt · A8 נעולה על ידי Aiko_M',
    );
    expect(within(grid).getAllByRole('button')).toHaveLength(81);
    expect(styleOf(grid)).toMatchObject({ direction: 'ltr', backgroundColor: color.board.boxGap });
    expect(grid.props.role).toBe('grid');
  });

  it('lays out boxes of 3 × 3 with 3 dp gaps, 1 dp lines and the checkerboard', async () => {
    await render(<Board model={demo()} />);
    const grid = screen.getByTestId('board');
    expect(styleOf(grid).gap).toBe(tokens.border.boxGap);
    // Row A from the left: A1 … A9; the first box row holds boxes 0, 1, 2.
    const buttons = within(grid).getAllByRole('button');
    expect(buttons.slice(0, 3).map((b) => b.props.testID)).toEqual(['cell-A1', 'cell-A2', 'cell-A3']);
    expect(buttons.slice(9, 12).map((b) => b.props.testID)).toEqual(['cell-A4', 'cell-A5', 'cell-A6']);
    expect(styleOf(screen.getByTestId('cell-A4-face')).backgroundColor).not.toBe(color.board.cell);
    expect(styleOf(screen.getByTestId('cell-E5-face')).backgroundColor).toBe(color.board.cell);
    expect(styleOf(screen.getByTestId('cell-E1-face')).backgroundColor).toBe(color.board.cellAlt);
    expect(styleOf(screen.getByTestId('cell-A1')).width).toBeCloseTo(size.boardCell, 1);
  });

  it('draws every state of the demo board', async () => {
    await render(<Board model={demo()} />);
    expect(
      screen.getByRole('button', { name: /^F8, ריקה, נעולה אצלך, 7 שניות, ספרות שגויות: \d$/ }),
    ).toBeSelected();
    expect(screen.getByRole('button', { name: 'A8, ריקה, נעולה על ידי Aiko_M, 7 שניות' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'D4, ריקה, נעולה על ידי NinaVolt, הטיימר עצור' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: /^A1, \d, נפתרה על ידיך$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^B2, \d, נפתרה על ידי OmarK$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^E5, ריקה, ספרות שגויות: \d, \d$/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'A3, 4, רמז' })).toBeDisabled();
    expect(screen.getAllByTestId('cell-avatar')).toHaveLength(2);
    expect(screen.getAllByTestId('cell-pulse')).toHaveLength(1);
    for (const shape of ['circle', 'triangle', 'square', 'diamond'])
      expect(screen.getAllByTestId(`cell-glyph-${shape}`).length).toBeGreaterThan(0);
  });

  it('reports taps on interactive cells only', async () => {
    const onCellPress = jest.fn();
    await render(<Board model={demo()} onCellPress={onCellPress} />);
    await fireEvent.press(screen.getByTestId('cell-E5'));
    await fireEvent.press(screen.getByTestId('cell-A8'));
    await fireEvent.press(screen.getByTestId('cell-A3'));
    await fireEvent.press(screen.getByTestId('cell-A1'));
    await fireEvent.press(screen.getByTestId('cell-F8'));
    expect(onCellPress.mock.calls).toEqual([[parseCellName('E5')], [parseCellName('A8')]]);
  });

  it('routes each flash to its cell', async () => {
    const m = demo();
    await render(
      <Board
        model={m}
        flashes={[
          { cell: parseCellName('A1'), kind: 'correct', id: 1 },
          { cell: parseCellName('E5'), kind: 'wrong', id: 2, digit: 3 },
        ]}
      />,
    );
    expect(within(screen.getByTestId('cell-A1')).getByTestId('cell-flash-correct-fill')).toBeOnTheScreen();
    expect(within(screen.getByTestId('cell-E5')).getByTestId('cell-flash-wrong-fill')).toBeOnTheScreen();
    expect(within(screen.getByTestId('cell-E5')).getByTestId('cell-flash-digit')).toHaveTextContent('3');
    expect(screen.getAllByTestId(/^cell-flash-/)).toHaveLength(3);
  });

  it('rounds the outer corners on the corner boxes and cells (no clipping of touch slop)', async () => {
    await render(<Board model={demo()} />);
    expect(styleOf(screen.getByTestId('board')).overflow).toBeUndefined();
    expect(styleOf(screen.getByTestId('cell-A1-face')).borderTopLeftRadius).toBe(tokens.radius.board);
    expect(styleOf(screen.getByTestId('cell-I9-face')).borderBottomRightRadius).toBe(tokens.radius.board);
    expect(styleOf(screen.getByTestId('cell-E5-face')).borderTopLeftRadius).toBeUndefined();
  });

  it('gives each cell touch slop that covers the gaps and reaches 44 dp on the outer edge', async () => {
    await render(<Board model={demo()} />);
    const slop = (name: string) => screen.getByTestId(`cell-${name}`).props.hitSlop;
    const g = boardGeometry();
    const outer = (size.touch - g.cell) / 2;
    expect(slop('A1')).toEqual({ top: outer, left: outer, bottom: 0.5, right: 0.5 });
    expect(slop('C3')).toEqual({ top: 0.5, left: 0.5, bottom: 1.5, right: 1.5 });
    expect(slop('I9')).toEqual({ top: 0.5, left: 0.5, bottom: outer, right: outer });
  });

  it('can show coordinate rails, with my lock’s row and column in my colour', async () => {
    await render(<Board model={demo()} showCoordinates />);
    expect(screen.getByTestId('board-with-coordinates')).toBeOnTheScreen();
    // Decorative: hidden from screen readers (each cell's label carries its name).
    const hidden = { includeHiddenElements: true };
    expect(screen.queryByText('A')).not.toBeOnTheScreen();
    expect(screen.getByText('A', hidden)).toBeOnTheScreen();
    const rail = (id: string) => styleOf(screen.getByTestId(`rail-${id}`, hidden));
    expect(rail('row-F')).toMatchObject({ color: color.players[0].ring });
    expect(rail('col-8')).toMatchObject({ color: color.players[0].ring });
    expect(rail('row-B')).toMatchObject({ color: color.textMuted });
    expect(rail('col-1')).toMatchObject({ color: color.textMuted });
    await render(<Board model={demo()} />);
    expect(screen.queryByText('A', hidden)).not.toBeOnTheScreen();
  });

  it('is the same board in English: only the words change', async () => {
    await i18n.changeLanguage('en');
    await render(<Board model={demo()} />);
    expect(screen.getByTestId('board').props.accessibilityLabel).toBe(
      'Game board · your cell F8 · D4 locked by NinaVolt · A8 locked by Aiko_M',
    );
    const buttons = within(screen.getByTestId('board')).getAllByRole('button');
    expect(buttons[0]!.props.testID).toBe('cell-A1');
  });

  it('draws a fresh game from the engine', async () => {
    const g = new DemoGame();
    await render(<Board model={boardModel(g.view('moshe'), 0, g.now)} width={300} />);
    const givens = [...DEMO_PUZZLE.givens].filter((c) => c !== '0').length;
    expect(screen.getAllByTestId('cell-digit')).toHaveLength(givens);
    expect(styleOf(screen.getByTestId('cell-A1')).width).toBeCloseTo(boardGeometry(300).cell);
  });
});

describe('geometry', () => {
  it('matches the design at 358 dp: cells of 38.4', () => {
    const g = boardGeometry();
    expect(g.width).toBe(size.board);
    expect(g.cell).toBeCloseTo(38.44, 1);
    expect(g.scale).toBeCloseTo(1, 2);
    expect(3 * (3 * g.cell + 2 * tokens.border.grid) + 2 * tokens.border.boxGap).toBeCloseTo(size.board);
  });

  it('scales inner values with the cell, in whole dp, and fonts to half a dp', () => {
    const small = boardGeometry(300);
    expect(px(small, 3)).toBe(Math.round(3 * small.scale));
    expect(px(small, 0.2)).toBe(1);
    expect(fontPx(boardGeometry(), 22)).toBe(22);
    expect(fontPx(geometryForCell(2 * size.boardCell), 11)).toBe(22);
  });

  it('never lets two cells share a touch point', () => {
    const g = boardGeometry();
    for (let k = 0; k < 8; k++) {
      const a = cellHitSlop(0, k, g);
      const b = cellHitSlop(0, k + 1, g);
      const gap = (k + 1) % 3 === 0 ? tokens.border.boxGap : tokens.border.grid;
      expect(a.right + b.left).toBeCloseTo(gap);
    }
  });

  it('finds the board’s corner cells', () => {
    expect([cornerOf(0, 0), cornerOf(0, 8), cornerOf(8, 0), cornerOf(8, 8), cornerOf(4, 4)]).toEqual([
      'topLeft',
      'topRight',
      'bottomLeft',
      'bottomRight',
      null,
    ]);
  });
});
