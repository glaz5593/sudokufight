import { Redirect, router } from 'expo-router';

import { useGameStore } from '../../src/game/gameStore';
import { DevMetricsScreen } from '../../src/screens/game';

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** /dev/metrics (stage 7): the five network measures of the online game that is open (spec §18). Development builds only. */
export default function DevMetricsRoute() {
  const online = useGameStore((s) => s.online);
  if (!__DEV__) return <Redirect href="/" />;
  return <DevMetricsScreen source={online?.host ?? null} onClose={close} />;
}
