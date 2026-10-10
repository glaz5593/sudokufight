import type { GameType } from '@sudoku-fight/engine';
import { Redirect, router } from 'expo-router';

import { serverEndpoint } from '../../src/config/server';
import { useGameStore } from '../../src/game/gameStore';
import { deviceHost } from '../../src/net/device';
import { netIdentity } from '../../src/net/identity';
import { DevOnlineScreen, useOnlineInfo } from '../../src/screens/game';

const { hostname, port, secure } = serverEndpoint;
const address = `${secure ? 'wss' : 'ws'}://${hostname}:${port}`;

/** A private room for 2 players (stage 7): the game screen shows its code while waiting. */
const create = (gameType: GameType) => {
  useGameStore.getState().startOnline({ kind: 'create', options: { gameType, playerCount: 2 } }, deviceHost);
  router.push('/game');
};

const join = (code: string) => {
  useGameStore.getState().startOnline({ kind: 'join', code }, deviceHost);
  router.push('/game');
};

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** /dev/online (stage 7): create a private room on the game server, or join one by its code. Development builds only. */
export default function DevOnlineRoute() {
  const online = useGameStore((s) => s.online);
  const info = useOnlineInfo(online?.connection);
  if (!__DEV__) return <Redirect href="/" />;
  const open = info && info.status !== 'closed' ? info : null;
  return (
    <DevOnlineScreen
      serverAddress={address}
      identity={netIdentity}
      onCreate={create}
      onJoin={join}
      current={open}
      onBackToGame={() => router.push('/game')}
      onMetrics={() => router.push('/dev/metrics')}
      onClose={close}
    />
  );
}
