import { type InterferenceKind, ManualClock } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';

import { Board, boardModel } from '../../../../components/board';
import { HIT_DIM, HIT_DIM_COLOR } from '../../../../components/interference';
import i18n from '../../../../i18n';
import { useSettings } from '../../../../state/settings';
import { duel, ME } from '../../testing/duel';
import {
  BoardHitLayer,
  type BoardHitLayerProps,
  cellsKey,
  cellsOfKey,
  scrambleCellsOf,
} from '../BoardHitLayer';
import type { HitInfo } from '../hitModel';

// Skia draws natively; under Jest a canvas is a plain view.
jest.mock(
  '@shopify/react-native-skia',
  () => jest.requireActual('../../../../components/interference/testing/skiaMock').skiaModule,
);

/** [D46] the board's dim of every hit, and [D47] the scramble's tiles, inside the board's slot. */

const hidden = { includeHiddenElements: true };
const START = 10_000;
const SIDE = 358;

let clock: ManualClock;

const hitOn = (over: Partial<HitInfo> = {}): HitInfo => ({
  kind: 'fireworks',
  fromId: 'bot-3',
  fromName: 'Mr. Hoot',
  fromColorIndex: 1,
  endsAt: START + 5000,
  totalMs: 5000,
  gameId: 'g-1',
  id: 3,
  ...over,
});

/** A real board: the bot solved two cells, I hold a lock (none of which the scramble may cover but the solved). */
function makeBoard() {
  const g = duel({ rules: { interferences: true } });
  g.bot.solve(g.cells[0]!);
  g.bot.solve(g.cells[1]!);
  g.host.select(g.cells[5]!);
  const view = g.host.getView();
  const board = boardModel(view, view.players.find((p) => p.id === ME)!.seat, g.clock.now());
  g.session.close();
  return { board, cells: g.cells };
}

/** One real board for every test (a game is slow to set up). */
let made: ReturnType<typeof makeBoard> | null = null;
const realBoard = () => (made ??= makeBoard());

const layer = (hit: HitInfo | null, props: Partial<BoardHitLayerProps> = {}) => (
  <BoardHitLayer
    hit={hit}
    now={clock.now()}
    clock={clock}
    cells={realBoard().board.cells}
    width={SIDE}
    {...props}
  />
);

const dim = () => screen.getByTestId('hit-dim', hidden);
/** The dim's opacity once the UI thread has had a frame to apply it (the hit's clock moves on by a frame). */
const dimOpacity = async () => {
  await act(async () => {
    jest.advanceTimersByTime(16);
  });
  return getAnimatedStyle(dim()).opacity as number;
};
/** The opacity between `at` ms into the hit and a few frames later (the UI thread's clock runs on). */
const between = (got: number, from: number, to: number) => {
  expect(got).toBeGreaterThanOrEqual(Math.min(from, to) - 1e-6);
  expect(got).toBeLessThanOrEqual(Math.max(from, to) + 1e-6);
};

afterEach(() => jest.useRealTimers());

beforeEach(async () => {
  jest.useFakeTimers();
  clock = new ManualClock(START);
  useSettings.setState({ reduceMotion: 'off' });
  await i18n.changeLanguage('he');
});

describe('BoardHitLayer: the dim [D46]', () => {
  it('renders nothing without a hit, or once it is over', async () => {
    const { toJSON, rerender } = await render(layer(null));
    expect(toJSON()).toBeNull();
    clock.advance(5_000);
    await rerender(layer(hitOn()));
    expect(toJSON()).toBeNull();
  });

  it.each(['fireworks', 'cats', 'warp', 'scramble', 'ink', 'keypad'] as const)(
    '%s: darkens the board with the solid scrim colour at 60 %%, rounded like it',
    async (kind) => {
      clock.advance(1_000);
      await render(layer(hitOn({ kind })));
      expect(dim()).toHaveStyle({ backgroundColor: HIT_DIM_COLOR, position: 'absolute' });
      expect(await dimOpacity()).toBeCloseTo(HIT_DIM.opacity, 5);
    },
  );

  it('fades in over 240 ms, and out over the last 240 ms, gone exactly at endsAt', async () => {
    await render(layer(hitOn()));
    between(await dimOpacity(), 0, 0.6 * (40 / 240));
    clock.advance(120);
    await render(layer(hitOn({ id: 4 })));
    between(await dimOpacity(), 0.3, 0.6 * (160 / 240));
    clock.advance(4_760); // 4880 ms in: half way out
    await render(layer(hitOn({ id: 5 })));
    between(await dimOpacity(), 0.3, 0.6 * (80 / 240));
    clock.advance(120);
    const { toJSON } = await render(layer(hitOn({ id: 6 })));
    expect(toJSON()).toBeNull();
  });

  it('stands still while the game is frozen', async () => {
    await render(layer(hitOn({ endsAt: null, remainingMs: 4_900 })));
    // 100 ms in, and it stays there: half faded in, however long the freeze lasts.
    expect(await dimOpacity()).toBeCloseTo(0.25, 5);
    clock.advance(60_000);
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(await dimOpacity()).toBeCloseTo(0.25, 5);
  });

  it('with reduced motion: the same dim, only faded in (200 ms), never moving', async () => {
    clock.advance(100);
    await render(layer(hitOn(), { reduceMotion: true }));
    between(await dimOpacity(), 0.3, 0.6 * (140 / 200));
    clock.advance(900);
    await render(layer(hitOn({ id: 8 }), { reduceMotion: true }));
    expect(await dimOpacity()).toBeCloseTo(0.6, 5);
  });

  it('is never touchable and hidden from screen readers (the hit layer says the board is dimmed)', async () => {
    await render(layer(hitOn()));
    const root = screen.getByTestId('board-hit', hidden);
    expect(root).toHaveProp('pointerEvents', 'none');
    expect(root).toHaveProp('accessibilityElementsHidden', true);
    expect(root).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(screen.queryByTestId('hit-dim')).toBeNull(); // hidden from them…
    expect(dim()).toBeTruthy(); // …but drawn
  });

  it('a tap on the board under it still reaches the board', async () => {
    const { board, cells } = realBoard();
    const onCellPress = jest.fn();
    clock.advance(1_000);
    await render(
      <View>
        <Board model={board} width={SIDE} onCellPress={onCellPress} />
        <BoardHitLayer
          hit={hitOn({ kind: 'scramble' })}
          now={clock.now()}
          clock={clock}
          cells={board.cells}
          width={SIDE}
        />
      </View>,
    );
    const empty = board.cells.find((c) => c.kind === 'empty' && c.interactive)!;
    await fireEvent.press(screen.getByTestId(`cell-${empty.name}`));
    expect(onCellPress).toHaveBeenCalledWith(empty.index);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('a kind this app does not know still dims, and draws nothing else (no crash) [D47]', async () => {
    clock.advance(1_000);
    await render(layer(hitOn({ kind: 'dragons' as InterferenceKind })));
    expect(await dimOpacity()).toBeCloseTo(0.6, 5);
    expect(screen.queryByTestId('hit-scramble', hidden)).toBeNull();
  });
});

describe('BoardHitLayer: the scramble [D47]', () => {
  it('covers only the filled cells (given and solved), never a lock, an empty cell or a wait', () => {
    const { board } = realBoard();
    const covered = scrambleCellsOf(board.cells);
    const kinds = new Set(covered.map((c) => board.cells[c.cell]!.kind));
    expect([...kinds].sort()).toEqual(['given', 'solved']);
    expect(covered).toHaveLength(board.cells.filter((c) => c.kind === 'given' || c.kind === 'solved').length);
    for (const c of covered) expect(c.digit).toBe(board.cells[c.cell]!.digit);
    // On its own colour: the bot's solved cells (P2's tint), the checkerboard's elsewhere.
    const solved = covered.filter((c) => board.cells[c.cell]!.kind === 'solved');
    expect(solved.length).toBe(2);
    expect(solved.every((c) => c.background === 3)).toBe(true);
    expect(covered.every((c) => c.background <= 1 || board.cells[c.cell]!.kind === 'solved')).toBe(true);
  });

  it('keys the plan on the cells: the same cells, the same key, and back', () => {
    const covered = scrambleCellsOf(realBoard().board.cells);
    expect(cellsOfKey(cellsKey(covered))).toEqual(covered);
    expect(cellsOfKey('')).toEqual([]);
  });

  it('rolls over the board for a scramble only, under the dim; reduced motion: the still "?"', async () => {
    clock.advance(1_000);
    const { rerender } = await render(layer(hitOn({ kind: 'scramble' })));
    expect(screen.getByTestId('hit-scramble', hidden)).toHaveStyle({ width: SIDE, height: SIDE });
    const root = screen.getByTestId('board-hit', hidden);
    // The dim is drawn last: over the tiles.
    expect(root.children.map((c) => (typeof c === 'string' ? c : c.props.testID))).toEqual([
      'hit-scramble',
      'hit-dim',
    ]);
    await rerender(layer(hitOn({ kind: 'scramble' }), { reduceMotion: true }));
    expect(screen.getByTestId('hit-scramble-still', hidden)).toBeTruthy();
    await rerender(layer(hitOn({ kind: 'ink', id: 4 })));
    expect(screen.queryByTestId('hit-scramble', hidden)).toBeNull();
    expect(screen.queryByTestId('hit-scramble-still', hidden)).toBeNull();
  });
});
