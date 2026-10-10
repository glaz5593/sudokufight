import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { I18nManager } from 'react-native';

import { directionProblems, hostStyles } from '../../../../components/ui/testing/layout';
import { ConnectingView } from '../ConnectingView';
import { ConnectionError } from '../ConnectionError';
import { lobbyOf } from '../connectionModel';
import { LobbyView } from '../LobbyView';
import { OpponentLeft } from '../OpponentLeft';
import { OpponentReconnecting } from '../OpponentReconnecting';
import { SelfReconnecting } from '../SelfReconnecting';
import { type Setup, setUp } from '../testing/setup';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../../services/feedback', () => ({ cue: jest.fn() }));

/**
 * CLAUDE.md: the UI follows the language's direction by itself. Every connection screen lays out with plain
 * rows (React Native mirrors them in Hebrew), never forces a direction and never pins one side only, so its
 * styles are the same in both directions. (Only the room code and the numbers set `writingDirection: 'ltr'`.)
 */
const SCREENS: [string, ReactElement][] = [
  [
    'OpponentReconnecting',
    <OpponentReconnecting
      key="o"
      model={{
        kind: 'opponentReconnecting',
        playerId: 'nina',
        name: 'NinaVolt',
        colorIndex: 1,
        secondsLeft: 9,
        remainingMs: 9000,
        graceMs: 15_000,
        expired: false,
      }}
    />,
  ],
  [
    'SelfReconnecting',
    <SelfReconnecting
      key="s"
      model={{
        kind: 'selfReconnecting',
        phase: 'lost',
        attempt: 2,
        secondsLeft: 9,
        remainingMs: 9000,
        graceMs: 15_000,
        syncItems: ['board', 'score', 'locks', 'timers'],
      }}
    />,
  ],
  [
    'OpponentLeft',
    <OpponentLeft
      key="l"
      model={{
        kind: 'opponentLeft',
        playerId: 'nina',
        name: 'NinaVolt',
        colorIndex: 1,
        me: { id: 'me', name: 'MosheG', score: 55 },
        opponentScore: 39.5,
        ratingDelta: 9,
        gameType: 'normal',
        graceSeconds: 15,
      }}
      onResults={jest.fn()}
      onHome={jest.fn()}
    />,
  ],
  [
    'ConnectionError',
    <ConnectionError
      key="e"
      model={{
        kind: 'error',
        failure: 'unreachable',
        code: '504',
        attempts: 2,
        retrying: false,
        refusal: null,
      }}
      onRetry={jest.fn()}
      onHome={jest.fn()}
      onPractice={jest.fn()}
    />,
  ],
  [
    'LobbyView',
    <LobbyView
      key="y"
      model={lobbyOf({
        code: 'ABC234',
        gameType: 'fast',
        playerCount: 3,
        players: [{ id: 'me', name: 'MosheG' }],
        playerId: 'me',
      })}
      onLeave={jest.fn()}
      onCopy={jest.fn()}
    />,
  ],
  [
    'ConnectingView',
    <ConnectingView key="c" model={{ kind: 'connecting', step: 'room' }} onCancel={jest.fn()} />,
  ],
];

let env: Setup;
beforeEach(async () => {
  env = await setUp('he');
});
afterEach(() => env.restore());

describe.each(SCREENS)('%s', (_, ui) => {
  it('lays out the same in both directions, without pinning a side', async () => {
    const layouts: unknown[] = [];
    for (const rtl of [true, false]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      await render(ui);
      expect(directionProblems(screen.container)).toEqual([]);
      layouts.push(hostStyles(screen.container));
      await screen.unmount();
    }
    expect(layouts[0]).toEqual(layouts[1]);
  });
});
