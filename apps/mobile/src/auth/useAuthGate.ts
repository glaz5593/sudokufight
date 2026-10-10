import { router, useRootNavigationState, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';

import { initAuth, useAuth } from './authStore';
import { redirectFor } from './redirect';

/**
 * The root layout's part of accounts (work plan stage 8): starts the auth store once per run and keeps the
 * player on the screens their status allows (redirect.ts). Returns whether the Splash should cover the app:
 * while the status loads, and at start until the screen under it is the right one (so a signed-out player
 * never sees Home for a frame). Later changes (sign-in, sign-out) just move to their screen.
 *
 * A redirect starts a fresh stack (signing in leaves no login screen behind Home; signing out leaves no Home
 * behind the login screen).
 */
export function useAuthGate(): { splash: boolean } {
  const status = useAuth((s) => s.status);
  const segments = useSegments();
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const target = redirectFor(status, segments);
  // Settled: the first time the status is known and the screen is right. Derived during render.
  const [settled, setSettled] = useState(false);
  if (!settled && status !== 'loading' && target === null) setSettled(true);

  useEffect(() => {
    void initAuth();
  }, []);

  useEffect(() => {
    if (!navigationReady || target === null) return;
    if (router.canDismiss()) router.dismissAll();
    router.replace(target);
  }, [navigationReady, target]);

  return { splash: status === 'loading' || (!settled && target !== null) };
}
