import { cellName, type Digit } from '@sudoku-fight/engine';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ViewStyle } from 'react-native';

import { KEYPAD } from '../../../components/interference';
import { answerIn } from '../../../game/testing/practice';
import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { GameScreen } from '../GameScreen';
import { type Duel, duel } from '../testing/duel';

/**
 * An interference on me, on the board itself (Moshe 2026-10-17): every kind darkens the board inside its slot
 * [D46], the scramble rolls the board's digits under the dim and the keypad's keys trade places [D47]; the board
 * and the keys keep working under them.
 */
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));

const hidden = { includeHiddenElements: true };
let game: Duel | null = null;

/** Time on the game's clock and the phone's timers together, in frames. */
async function together(g: Duel, ms: number) {
  for (let t = 0; t < ms; t += 50) {
    await act(async () => {
      g.scheduler.advance(50);
      jest.advanceTimersByTime(50);
    });
  }
}

/** How far each key (1–9) stands from its own place now, dp. */
function keyShifts(): number[] {
  return ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((digit) => {
    const el = screen.getByTestId(`key-${digit}-place`) as unknown as {
      props: { jestAnimatedStyle?: { value: ViewStyle } };
    };
    return (el.props.jestAnimatedStyle?.value.transform as { translateX: number }[])[0]!.translateX;
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  await i18n.changeLanguage('he');
  useSettings.setState({ reduceMotion: 'off' });
});

afterEach(() => {
  game?.session.close();
  game = null;
  jest.useRealTimers();
});

/** A duel where the bot may interfere (a practice against a bot has none [D44]), with the bot's points for it. */
async function hitBy(kind: 'scramble' | 'keypad' | 'cats') {
  const g = (game = duel({ rules: { interferences: true } }));
  await render(<GameScreen session={g.session} onEnded={jest.fn()} />);
  await act(async () => g.bot.solve(g.cells[0]!));
  await act(async () => g.bot.interfere(kind));
  return g;
}

/** The other side: I hit the bot (in a duel where interferences are on), with my points for it. */
async function iHit(kind: 'scramble' | 'keypad' | 'cats') {
  const g = (game = duel({ rules: { interferences: true } }));
  await render(<GameScreen session={g.session} onEnded={jest.fn()} />);
  await act(async () => {
    for (const cell of g.cells) {
      if (g.host.getView().players[0]!.score >= 2) break;
      g.host.select(cell);
      g.host.place(cell, answerIn(g.puzzle, cell));
    }
  });
  await act(async () => g.host.interfere(g.host.getView().players[1]!.id, kind));
  return g;
}

it.each(['scramble', 'keypad', 'cats'] as const)(
  'only the victim sees a hit: my %s on the bot leaves my board bright and my keys in place [D46]',
  async (kind) => {
    const g = await iHit(kind);
    expect(g.host.getView().players[1]!.hitBy).toMatchObject({ kind });
    // Past the first trade of places (1.5 s) a keypad hit on me would have made.
    await together(g, 1_600);
    expect(g.host.getView().players[1]!.hitBy).toMatchObject({ kind });
    expect(screen.queryByTestId('board-hit', hidden)).toBeNull();
    expect(screen.queryByTestId('hit-dim', hidden)).toBeNull();
    expect(screen.queryByTestId('hit-scramble', hidden)).toBeNull();
    expect(screen.queryByTestId('hit-layer-banner', hidden)).toBeNull();
    expect(keyShifts().every((x) => Math.abs(x) < 0.5)).toBe(true);
  },
);

it('every hit darkens the board inside its slot, for the whole 5 s and no longer [D46]', async () => {
  const g = await hitBy('cats');
  const slot = screen.getByTestId('board-slot');
  expect(within(slot).getByTestId('hit-dim', hidden)).toBeOnTheScreen();
  // Only the board: the keypad and the cards are not under it.
  expect(within(screen.getByTestId('keypad')).queryByTestId('hit-dim', hidden)).toBeNull();
  await together(g, 5_000);
  expect(screen.queryByTestId('board-hit', hidden)).toBeNull();
});

it('the scramble rolls the board’s digits under the dim; a tap on the board still selects [D47]', async () => {
  const g = await hitBy('scramble');
  const slot = screen.getByTestId('board-slot');
  expect(within(slot).getByTestId('hit-scramble', hidden)).toBeOnTheScreen();
  // Visual only: the keypad is untouched (its keys stay in their places).
  await together(g, 1_600);
  expect(keyShifts().every((x) => Math.abs(x) < 0.5)).toBe(true);
  // The real board is untouched under it: its cells still say their own digits, and take taps.
  const empty = g.cells[3]!;
  await fireEvent.press(screen.getByTestId(`cell-${cellName(empty)}`));
  expect(g.host.getView().players.find((p) => p.id === 'me')!.lock?.cell).toBe(empty);
});

it('the keypad’s keys trade places, and each still enters its own digit [D47]', async () => {
  const g = await hitBy('keypad');
  await together(g, KEYPAD.moveMs + KEYPAD.guardMs + 50);
  // Out of their places: every key moved.
  expect(keyShifts().every((x) => Math.abs(x) > 1)).toBe(true);
  const target = g.cells[3]!;
  await fireEvent.press(screen.getByTestId(`cell-${cellName(target)}`));
  await together(g, 100);
  const answer = answerIn(g.puzzle, target) as Digit;
  const key = screen.getByTestId(`key-${answer}`);
  await fireEvent(key, 'pressIn');
  await fireEvent.press(key);
  expect(g.host.getView().grid[target]).toBe(answer);
  // Over: back in their places, 1–9.
  await together(g, 5_300);
  expect(screen.queryByTestId('board-hit', hidden)).toBeNull();
  expect(keyShifts().every((x) => Math.abs(x) < 0.5)).toBe(true);
});
