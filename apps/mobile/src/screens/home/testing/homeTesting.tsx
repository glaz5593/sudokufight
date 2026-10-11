/* Test-only: the app's home-level routes for expo-router's renderRouter. */
import { useLocalSearchParams } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactElement } from 'react';
import { Text } from 'react-native';

import AchievementsRoute from '../../../../app/achievements';
import BotSelectRoute from '../../../../app/bot-select';
import GameTypeRoute from '../../../../app/game-type';
import HistoryRoute from '../../../../app/history';
import Index from '../../../../app/index';
import LeaderboardRoute from '../../../../app/leaderboard';
import ModesRoute from '../../../../app/modes';
import SettingsRoute from '../../../../app/settings';

/** Stands in for a screen another part of stage 4 builds (the game, the results). */
function Stub({ name }: { name: string }) {
  const params = useLocalSearchParams();
  return <Text testID={`stub-${name}`}>{`${name} ${JSON.stringify(params)}`}</Text>;
}

/** The real routes of this area, and stubs for the game, the results and the dev screens. */
export const ROUTES = {
  index: Index,
  modes: ModesRoute,
  'game-type': GameTypeRoute,
  'bot-select': BotSelectRoute,
  settings: SettingsRoute,
  leaderboard: LeaderboardRoute,
  history: HistoryRoute,
  achievements: AchievementsRoute,
  game: () => <Stub name="game" />,
  'results/[id]': () => <Stub name="results" />,
  'dev/hello': () => <Stub name="hello" />,
  'dev/design-system': () => <Stub name="design-system" />,
  'dev/sounds': () => <Stub name="sounds" />,
};

export interface RenderedApp {
  pathname(): string;
  pathnameWithParams(): string;
  searchParams(): Record<string, string | string[]>;
}

/**
 * Renders ROUTES (with `overrides` in place of some) at `url` (expo-router's renderRouter, which also turns on Jest's fake timers) and waits for the
 * first render. Test files import 'react-native-reanimated' before this module and mock it with itself: the
 * router's testing library would otherwise swap in Reanimated's old mock, which has no useReducedMotion.
 */
export async function renderApp(
  url = '/',
  overrides: Partial<Record<string, () => ReactElement>> = {},
): Promise<RenderedApp> {
  const result = renderRouter({ ...ROUTES, ...overrides }, { initialUrl: url });
  await result;
  return {
    pathname: () => result.getPathname(),
    pathnameWithParams: () => result.getPathnameWithParams(),
    searchParams: () => result.getSearchParams(),
  };
}
