import { fireEvent, render, screen } from '@testing-library/react-native';

import { ConnectionLayer, type ConnectionLayerProps } from '../ConnectionLayer';
import { connectionModel, type ConnectionModel, lobbyOf } from '../connectionModel';
import { NINA, rankedGame } from '../testing/games';
import { hidden, type Setup, setUp } from '../testing/setup';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));

let env: Setup;
afterEach(() => env.restore());

const handlers = () => ({
  onRetry: jest.fn(),
  onHome: jest.fn(),
  onResults: jest.fn(),
  onLeave: jest.fn(),
  onPractice: jest.fn(),
});

const layer = (model: ConnectionModel, props: Partial<ConnectionLayerProps> = {}) => (
  <ConnectionLayer model={model} {...handlers()} {...props} />
);

/** The components of the layer on screen. */
const shown = () =>
  [
    'opponent-reconnecting',
    'self-reconnecting',
    'opponent-left',
    'connection-error',
    'connecting',
    'lobby',
  ].filter((id) => screen.queryByTestId(id, hidden) !== null);

describe('ConnectionLayer', () => {
  beforeEach(async () => {
    env = await setUp('he');
  });

  it('shows nothing of its own for "none", and lets touches through', async () => {
    await render(layer({ kind: 'none' }));
    expect(shown()).toEqual([]);
    expect(screen.getByTestId('connection-layer')).toHaveProp('pointerEvents', 'box-none');
  });

  it('shows the frozen game for a disconnected opponent, from the freeze line down', async () => {
    const game = rankedGame();
    game.disconnect(NINA);
    await render(layer(connectionModel(game.view(), { kind: 'online' }, game.now()), { freezeTop: 200 }));
    expect(shown()).toEqual(['opponent-reconnecting']);
    expect(screen.getByTestId('opponent-reconnecting')).toHaveStyle({ top: 200 });
  });

  it('shows my reconnection', async () => {
    const game = rankedGame();
    await render(
      layer(
        connectionModel(game.view(), { kind: 'reconnecting', attempt: 1, lostAt: game.now() }, game.now()),
      ),
    );
    expect(shown()).toEqual(['self-reconnecting']);
  });

  it('shows "the opponent left" with its avatars, and goes to the results', async () => {
    const game = rankedGame();
    game.disconnect(NINA);
    game.advance(15_000);
    const h = handlers();
    await render(
      <ConnectionLayer
        model={connectionModel(game.view(), { kind: 'online' }, game.now())}
        {...h}
        avatars={{ me: 'av07', nina: 'av12' }}
        myId="me"
      />,
    );
    expect(shown()).toEqual(['opponent-left']);
    await fireEvent.press(screen.getByRole('button', { name: 'לתוצאות' }));
    expect(h.onResults).toHaveBeenCalledTimes(1);
  });

  it('shows the error with its actions', async () => {
    const h = handlers();
    await render(
      <ConnectionLayer
        model={{
          kind: 'error',
          failure: 'unreachable',
          code: '504',
          attempts: 1,
          retrying: false,
          refusal: null,
        }}
        {...h}
      />,
    );
    expect(shown()).toEqual(['connection-error']);
    await fireEvent.press(screen.getByRole('button', { name: 'נסה שוב' }));
    await fireEvent.press(screen.getByRole('button', { name: 'עבור לאימון' }));
    await fireEvent.press(screen.getByRole('button', { name: 'לבית' }));
    expect([h.onRetry, h.onPractice, h.onHome].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('shows the connecting steps, which can be cancelled', async () => {
    const h = handlers();
    await render(<ConnectionLayer model={{ kind: 'connecting', step: 'room' }} {...h} />);
    expect(shown()).toEqual(['connecting']);
    await fireEvent.press(screen.getByRole('button', { name: 'ביטול' }));
    expect(h.onLeave).toHaveBeenCalledTimes(1);
  });

  it('shows the lobby, which can be left', async () => {
    const h = handlers();
    const model = lobbyOf({
      code: 'ABC234',
      gameType: 'fast',
      playerCount: 2,
      players: [{ id: 'me', name: 'MosheG' }],
      playerId: 'me',
    });
    await render(<ConnectionLayer model={model} {...h} />);
    expect(shown()).toEqual(['lobby']);
    await fireEvent.press(screen.getByRole('button', { name: 'יציאה מהחדר' }));
    expect(h.onLeave).toHaveBeenCalledTimes(1);
  });
});
