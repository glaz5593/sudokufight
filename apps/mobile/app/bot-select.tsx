import { isGameType } from '@sudoku-fight/engine';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { BotSelectScreen, DEFAULT_BOT_LEVEL } from '../src/screens/home';
import { useProfile } from '../src/state/profile';

/**
 * /bot-select?gameType=fast : "בחר יריב בוט" (spec §4.2: GameType → BotSelect → Game), on the level played last.
 * Without a valid game type there is nothing to choose for: back to the game type of a bot practice.
 */
export default function BotSelectRoute() {
  const { gameType } = useLocalSearchParams<{ gameType?: string }>();
  const remembered = useProfile((s) => s.botLevel);
  if (!isGameType(gameType)) return <Redirect href={{ pathname: '/game-type', params: { mode: 'bot' } }} />;
  return <BotSelectScreen gameType={gameType} initialLevel={remembered ?? DEFAULT_BOT_LEVEL} />;
}
