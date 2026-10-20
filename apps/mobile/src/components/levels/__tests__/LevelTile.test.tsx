import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { color, contrast, size } from '../../../theme';
import { LevelTile, TILE_ARENA } from '../LevelTile';

/**
 * A stage tile (components.md §19.1, §19.2): a 3 × 3 box with the number in Teko, at 44 (the new-game row), 56
 * (a node) and 68 (a boss); played light, current with my P1 pin, locked dark with a lock badge and a readable
 * number (no opacity), a boss with its crown and (1.0.3, D77) the arena's gold corners unless locked. Decorative:
 * the button around it says what it is.
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

  it('a boss: the arena’s four gold corners when played, open or current; none while locked (D77)', async () => {
    for (const state of ['played', 'current'] as const) {
      await render(<LevelTile n={10} size={68} state={state} boss />);
      expect(screen.getByTestId('level-tile-arena', hidden)).toBeTruthy();
      const corners = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].map((c) =>
        styleOf(screen.getByTestId(`level-tile-arena-${c}`, hidden)),
      );
      for (const c of corners) {
        expect(c).toMatchObject({ borderColor: color.accent, width: TILE_ARENA.length });
      }
      expect(corners[0]).toMatchObject({ borderTopWidth: 3, borderLeftWidth: 3 });
      expect(corners[3]).toMatchObject({ borderBottomWidth: 3, borderRightWidth: 3 });
      await screen.unmount();
    }
    await render(<LevelTile n={10} size={68} state="locked" boss />);
    expect(screen.queryByTestId('level-tile-arena', hidden)).toBeNull();
    await screen.unmount();
    // A regular stage never; a boss's tile in its own stage header (arena off: the band says it).
    await render(<LevelTile n={9} size={56} state="played" />);
    expect(screen.queryByTestId('level-tile-arena', hidden)).toBeNull();
    await screen.unmount();
    await render(<LevelTile n={10} size={44} state="current" boss arena={false} />);
    expect(screen.queryByTestId('level-tile-arena', hidden)).toBeNull();
  });

  it('a boss’s crown badge is 34 × 24 (1.0.3)', async () => {
    await render(<LevelTile n={20} size={68} state="played" boss />);
    const badge = screen.getByTestId('level-tile-crown', hidden).children[0] as unknown as {
      props: { style?: unknown };
    };
    expect(styleOf(badge)).toMatchObject({ width: 34, height: 24 });
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
