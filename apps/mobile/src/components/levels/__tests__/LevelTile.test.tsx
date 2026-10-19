import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { color, contrast, size } from '../../../theme';
import { LevelTile } from '../LevelTile';

/**
 * A stage tile (components.md §19.1, §19.2): a 3 × 3 box with the number in Teko, at 44 (the new-game row), 56
 * (a node) and 68 (a boss); played light, current with my P1 pin, locked dark with a lock badge and a readable
 * number (no opacity), a boss with its crown. Decorative: the button around it says what it is.
 */

const hidden = { includeHiddenElements: true };
const styleOf = (el: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(el.props.style as ViewStyle) ?? {}) as ViewStyle & TextStyle;

describe('LevelTile', () => {
  it.each([
    [44, 24],
    [56, 30],
    [68, 34],
  ])('is %i square with a Teko number of %i, LTR', async (px, font) => {
    await render(<LevelTile n={137} size={px} state="played" />);
    expect(styleOf(screen.getByTestId('level-tile-face', hidden))).toMatchObject({ width: px, height: px });
    const number = screen.getByTestId('level-tile-number', hidden);
    expect(number).toHaveTextContent('137');
    expect(styleOf(number)).toMatchObject({
      fontSize: font,
      fontFamily: 'Teko_600SemiBold',
      writingDirection: 'ltr',
    });
    expect(screen.getByTestId('level-tile', hidden)).toHaveProp('accessibilityElementsHidden', true);
    expect([size.levelNode, size.levelNodeBoss]).toEqual([56, 68]);
  });

  it('played: the board’s light cell and dark number; no pin, no lock', async () => {
    await render(<LevelTile n={7} size={56} state="played" />);
    expect(styleOf(screen.getByTestId('level-tile-face', hidden)).backgroundColor).toBe(color.board.cell);
    expect(styleOf(screen.getByTestId('level-tile-number', hidden)).color).toBe(color.board.given);
    expect(screen.queryByTestId('level-tile-pin', hidden)).toBeNull();
    expect(screen.queryByTestId('level-tile-lock', hidden)).toBeNull();
  });

  it('current: my pin, P1 with ●, at the top-start corner', async () => {
    await render(<LevelTile n={14} size={56} state="current" />);
    const pin = screen.getByTestId('level-tile-pin', hidden);
    expect(styleOf(pin)).toMatchObject({ borderColor: color.players[0]!.ring, start: -8, top: -8 });
    expect(screen.getByTestId('glyph-circle', hidden)).toBeTruthy();
  });

  it('locked: dark, a readable number (no opacity) and a lock badge at the top-end corner', async () => {
    await render(<LevelTile n={12} size={56} state="locked" />);
    const face = styleOf(screen.getByTestId('level-tile-face', hidden));
    const number = styleOf(screen.getByTestId('level-tile-number', hidden));
    expect(face.backgroundColor).toBe(color.surface2);
    expect(number.color).toBe(color.textFaint);
    expect(number.opacity).toBeUndefined();
    expect(contrast(color.textFaint, color.surface2)).toBeGreaterThanOrEqual(4.5);
    expect(styleOf(screen.getByTestId('level-tile-lock', hidden))).toMatchObject({ end: -6, top: -6 });
  });

  it('a boss: the crown, gold, or faint while locked', async () => {
    await render(<LevelTile n={20} size={68} state="played" boss />);
    expect(screen.getByTestId('icon-crown', hidden)).toHaveProp('stroke', color.accent);
    await screen.rerender(<LevelTile n={20} size={68} state="locked" boss />);
    expect(screen.getByTestId('icon-crown', hidden)).toHaveProp('stroke', color.iconFaint);
  });

  it('its grid lines sit at a third and two thirds (18 / 37 on 56, 14 / 29 on 44)', async () => {
    await render(<LevelTile n={1} size={56} state="played" />);
    const face = screen.getByTestId('level-tile-face', hidden);
    const lines = face.children
      .map((c) => styleOf(c as unknown as { props: { style?: unknown } }))
      .filter((s) => s.position === 'absolute');
    // The upright lines by their start, the level ones by their top.
    expect(lines.map((s) => (s.width !== undefined ? s.start : s.top))).toEqual([18, 37, 18, 37]);
  });
});
