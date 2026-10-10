// First: expo-router's testing library swaps Reanimated for its old mock (no useReducedMotion), unless the real
// module is already in place as the mock (see the jest.mock below).
import 'react-native-reanimated';
import { router } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import RootLayout from '../../../../app/_layout';
import { installSignedInPlayer } from '../../../auth/testing/testAuth';
import { track } from '../../analytics';
import { IDLE_TIMEOUT_MS } from '../../startup';
import { startTelemetry } from '..';
import { screenOf } from '../screens';

/**
 * Spec §27.1: the root layout reports a screen_view for every screen entered, by the route's pattern, once
 * for the same screen twice in a row, never for the dev tools; and starts telemetry once per run. The real
 * root layout, with stand-in screens.
 */

jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));
jest.mock('../../analytics', () => ({ track: jest.fn() }));
jest.mock('..', () => ({ startTelemetry: jest.fn() }));
// The layout opens the practice database: here it never opens (and is not needed).
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: () => new Promise(() => undefined) }));

function stand(name: string) {
  return function StandIn() {
    return <Text testID={`screen-${name}`}>{name}</Text>;
  };
}
const ROUTES = {
  _layout: RootLayout,
  index: stand('home'),
  settings: stand('settings'),
  game: stand('game'),
  'results/[id]': stand('results'),
  leaderboard: stand('leaderboard'),
  history: stand('history'),
  achievements: stand('achievements'),
  'dev/hello': stand('hello'),
};

const screenViews = () =>
  jest
    .mocked(track)
    .mock.calls.filter(([name]) => name === 'screen_view')
    .map(([, props]) => props?.screen);

async function go(path: Parameters<typeof router.push>[0]) {
  await act(async () => router.push(path));
}

beforeEach(async () => {
  jest.clearAllMocks();
  // Stage 8: the root layout keeps a signed-out player on the login screens; this one has registered.
  await installSignedInPlayer();
});

describe('screenOf', () => {
  it('the route pattern, not the values in it', () => {
    expect(screenOf([])).toBe('/');
    expect(screenOf(['settings'])).toBe('/settings');
    expect(screenOf(['results', '[id]'])).toBe('/results/[id]');
    expect(screenOf(['(tabs)', 'history'])).toBe('/history');
    expect(screenOf(['history', 'index'])).toBe('/history');
    expect(screenOf(['+not-found'])).toBe('/+not-found');
  });

  it('no screen for the dev tools or the sitemap', () => {
    expect(screenOf(['dev', 'hello'])).toBeNull();
    expect(screenOf(['dev', 'design-system'])).toBeNull();
    expect(screenOf(['_sitemap'])).toBeNull();
  });
});

describe('the root layout', () => {
  it('starts telemetry once, then reports each screen entered by its pattern', async () => {
    await renderRouter(ROUTES, { initialUrl: '/' });
    await screen.findByTestId('screen-home');
    // Spec §22 (open in under 2 s): it starts once the first screen is up and the JS thread is idle.
    await act(async () => {
      jest.advanceTimersByTime(IDLE_TIMEOUT_MS);
    });
    expect(startTelemetry).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('app_open');
    expect(screenViews()).toEqual(['/']);

    await go('/results/abc');
    expect(screen.getByTestId('screen-results')).toBeTruthy();
    // Another game's results: the same screen, not reported twice in a row.
    await go('/results/def');
    // The dev tools are not screens of the game.
    await go('/dev/hello');
    await go('/settings');
    await act(async () => router.back()); // /dev/hello
    await act(async () => router.back()); // /results/def
    expect(screenViews()).toEqual(['/', '/results/[id]', '/settings', '/results/[id]']);
    expect(startTelemetry).toHaveBeenCalledTimes(1);
  });

  it('an app opened on a deep link reports that screen first', async () => {
    await renderRouter(ROUTES, { initialUrl: '/results/xyz' });
    await screen.findByTestId('screen-results');
    expect(screenViews()).toEqual(['/results/[id]']);
  });

  it('opened on a dev route: no screen_view until a game screen', async () => {
    await renderRouter(ROUTES, { initialUrl: '/dev/hello' });
    await screen.findByTestId('screen-hello');
    expect(screenViews()).toEqual([]);
    await go('/game');
    expect(screenViews()).toEqual(['/game']);
  });
});
