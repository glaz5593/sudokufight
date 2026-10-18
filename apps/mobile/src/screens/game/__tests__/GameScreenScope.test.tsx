import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import i18n from '../../../i18n';
import { useSettings } from '../../../state/settings';
import { GameScreen } from '../GameScreen';
import { type Duel, duel } from '../testing/duel';

/**
 * [D35] The scope of an interference is a setting (components/interference/config): the whole screen until the
 * proposal is approved (GameScreenDuel covers that), or the board alone. Here it is set to the board: the game
 * screen hands the hit layer the board's rect, in the screen's coordinates, and the effect covers only it.
 */
jest.mock('../../../components/interference/config', () => ({
  ...jest.requireActual<object>('../../../components/interference/config'),
  INTERFERENCE_SCOPE: 'board',
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../services/feedback', () => ({
  cue: jest.fn(),
  preloadCues: jest.fn(),
  cueCountUp: jest.fn(() => jest.fn()),
}));

const hidden = { includeHiddenElements: true };

let game: Duel | null = null;

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

it('with the scope set to the board, an interference on me covers the board alone [D35]', async () => {
  // Interferences on: a practice against a bot has none [D44].
  const g = (game = duel({ rules: { interferences: true } }));
  await render(<GameScreen session={g.session} onEnded={jest.fn()} />);
  // A 390 × 844 screen as on Dir-C-Game: the board's room at 288, the board 358 wide inside its gutters.
  const layout = (testID: string, x: number, y: number, width: number, height: number) =>
    fireEvent(screen.getByTestId(testID), 'layout', { nativeEvent: { layout: { x, y, width, height } } });
  await layout('board-room', 0, 288, 390, 358);
  await layout('board-slot', 16, 0, 358, 358);

  await act(async () => g.bot.solve(g.cells[0]!));
  await act(async () => g.bot.interfere('fireworks'));
  const region = screen.getByTestId('hit-layer-region', hidden);
  expect(StyleSheet.flatten(region.props.style)).toMatchObject({
    left: 16,
    top: 288,
    width: 358,
    height: 358,
  });
  expect(within(region).getByTestId('hit-fireworks', hidden)).toBeOnTheScreen();
  // The banner still says it, above the cards.
  expect(screen.getByTestId('hit-layer-banner', hidden)).toBeOnTheScreen();
});
