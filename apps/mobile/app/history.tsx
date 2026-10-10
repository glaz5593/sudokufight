import { router } from 'expo-router';

import { type HistoryEntry, HistoryScreen } from '../src/screens/history';
import { appHistoryDeps } from '../src/screens/history/appWiring';
import { goToTab } from '../src/screens/home';
import { useProfile } from '../src/state/profile';

const openReplay = (entry: HistoryEntry) =>
  router.push({ pathname: '/replay/[id]', params: { id: entry.id, source: entry.source } });

/** /history: a bottom-nav tab (spec §14.1): every game, ranked and practice, each opening its replay. */
export default function HistoryRoute() {
  const myAvatar = useProfile((s) => s.avatarId);
  return (
    <HistoryScreen
      deps={appHistoryDeps}
      onOpen={openReplay}
      onPlay={() => router.push('/modes')}
      onTab={(tab) => goToTab(tab, 'history')}
      myAvatar={myAvatar}
    />
  );
}
