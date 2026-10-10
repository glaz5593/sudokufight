import { router } from 'expo-router';

import { useAuth } from '../src/auth/authStore';
import { signedInProgressApi } from '../src/progress/appProgress';
import { useMyProgress } from '../src/progress/hooks';
import { goToTab } from '../src/screens/home';
import { LeaderboardScreen } from '../src/screens/leaderboard';
import { openPlayerCard } from '../src/screens/player/navigation';
import { useProfile } from '../src/state/profile';

/** /leaderboard: a bottom-nav tab (spec §14.2): the tables, my pinned row, and every player's card. */
export default function LeaderboardRoute() {
  const myId = useAuth((s) => s.me?.id ?? null);
  const myAvatar = useProfile((s) => s.avatarId);
  const progress = useMyProgress();
  return (
    <LeaderboardScreen
      api={signedInProgressApi}
      myId={myId}
      myAvatar={myAvatar}
      myLeague={progress ? { league: progress.league, rating: progress.leagueRating } : null}
      onOpenPlayer={openPlayerCard}
      onPlay={() => router.push('/modes')}
      onTab={(tab) => goToTab(tab, 'leaderboard')}
    />
  );
}
