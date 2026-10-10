import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { useAuth } from '../src/auth/authStore';
import { refreshMyProgress } from '../src/progress/appProgress';
import { useMyLevel, useMyProgress } from '../src/progress/hooks';
import { useProgress } from '../src/progress/progressStore';
import { goToTab } from '../src/screens/home';
import { openPlayerCard } from '../src/screens/player/navigation';
import { ProgressScreen } from '../src/screens/progress';
import { useProfile } from '../src/state/profile';

/**
 * /achievements: the "הישגים" tab (spec §15): my level and XP, my league, how XP is earned, the achievements
 * ("בקרוב" until the list is approved) and the interferences collection. Read again each time it opens.
 */
export default function AchievementsRoute() {
  const myId = useAuth((s) => s.me?.id ?? null);
  const myAvatar = useProfile((s) => s.avatarId);
  const progress = useMyProgress();
  const level = useMyLevel();
  const status = useProgress((s) => s.status);
  const pending = useProgress((s) => s.pending);

  useFocusEffect(
    useCallback(() => {
      void refreshMyProgress();
    }, []),
  );

  return (
    <ProgressScreen
      progress={progress}
      status={status}
      pending={pending}
      myAvatar={myAvatar}
      level={level}
      onOpenMyCard={myId ? () => openPlayerCard(myId) : undefined}
      onOpenInterferences={() => router.push('/interferences')}
      onRetry={() => void refreshMyProgress()}
      onTab={(tab) => goToTab(tab, 'achievements')}
    />
  );
}
