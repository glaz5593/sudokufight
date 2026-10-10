import { isGameType } from '@sudoku-fight/engine';
import { Redirect, useLocalSearchParams } from 'expo-router';

import {
  DEFAULT_GAME_TYPE,
  DEFAULT_MODE,
  DEFAULT_RANKED_PLAYERS,
  GameTypeScreen,
  isOpenPlayerCount,
  isStartableMode,
} from '../src/screens/home';

/**
 * /game-type?mode=solo&gameType=normal : "סוג משחק" (spec §5.2). `gameType` is preselected when given; without a
 * mode it is solo practice. Ranked (stage 9) takes `players` (2 by default): a table this build has not opened
 * goes back to the modes, as does a mode it cannot start.
 */
export default function GameTypeRoute() {
  const {
    mode = DEFAULT_MODE,
    gameType,
    players,
  } = useLocalSearchParams<{ mode?: string; gameType?: string; players?: string }>();
  if (!isStartableMode(mode)) return <Redirect href="/modes" />;
  const count = players === undefined ? DEFAULT_RANKED_PLAYERS : Number(players);
  if (mode === 'ranked' && !isOpenPlayerCount(count)) return <Redirect href="/modes" />;
  return (
    <GameTypeScreen
      mode={mode}
      initialGameType={isGameType(gameType) ? gameType : DEFAULT_GAME_TYPE}
      players={isOpenPlayerCount(count) ? count : DEFAULT_RANKED_PLAYERS}
    />
  );
}
