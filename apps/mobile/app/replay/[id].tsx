import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { appReplayDeps } from '../../src/screens/history/appWiring';
import { goBack } from '../../src/screens/home';
import { loadReplay, ReplayScreen, type ReplaySourceKind } from '../../src/screens/replay';
import { track } from '../../src/services/analytics';

const sourceOf = (value: string | undefined): ReplaySourceKind | null =>
  value === 'practice' || value === 'ranked' ? value : null;

/**
 * /replay/[id]?source=practice|ranked: the replay of a game (spec §13), from the history or the results. A
 * practice comes from the phone's log [D25], a ranked game from the server; without `source` the phone is
 * tried first. Spec §22: `replay_open` once the replay is there to watch.
 */
export default function ReplayRoute() {
  const { id = '', source } = useLocalSearchParams<{ id: string; source?: string }>();
  const kind = sourceOf(source);
  const load = useCallback(
    async (gameId: string) => {
      const result = await loadReplay(gameId, kind, appReplayDeps());
      if (result.kind === 'found') track('replay_open', { mode: result.replay.mode });
      return result;
    },
    [kind],
  );
  return <ReplayScreen gameId={id} load={load} onBack={goBack} />;
}
