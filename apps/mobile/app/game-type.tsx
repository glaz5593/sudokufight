import { isGameType } from '@sudoku-fight/engine';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { DEFAULT_GAME_TYPE, DEFAULT_MODE, GameTypeScreen, isStartableMode } from '../src/screens/home';

/**
 * /game-type?mode=solo&gameType=normal : "סוג משחק" (spec §5.2). `gameType` is preselected when given; without a
 * mode it is solo practice. A mode this build cannot start goes back to the modes.
 */
export default function GameTypeRoute() {
  const { mode = DEFAULT_MODE, gameType } = useLocalSearchParams<{ mode?: string; gameType?: string }>();
  if (!isStartableMode(mode)) return <Redirect href="/modes" />;
  return <GameTypeScreen mode={mode} initialGameType={isGameType(gameType) ? gameType : DEFAULT_GAME_TYPE} />;
}
