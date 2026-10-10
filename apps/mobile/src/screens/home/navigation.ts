import { router } from 'expo-router';

import type { NavTab } from '../../components/ui';

/** The routes of the bottom navigation's tabs (spec §4.2: בית · טבלת מובילים · היסטוריה · הישגים). */
export const TAB_PATHS = {
  home: '/',
  leaderboard: '/leaderboard',
  history: '/history',
  achievements: '/achievements',
} as const satisfies Record<NavTab, string>;

/**
 * Switches tabs. Home stays at the bottom of the stack and at most one other tab sits on it, so the back
 * button of the phone always leads home and the stack never grows with tab taps.
 */
export function goToTab(tab: NavTab, from: NavTab): void {
  if (tab === from) return;
  if (tab === 'home') {
    if (router.canDismiss()) router.dismissTo(TAB_PATHS.home);
    else router.replace(TAB_PATHS.home);
  } else if (from === 'home') {
    router.push(TAB_PATHS[tab]);
  } else {
    router.replace(TAB_PATHS[tab]);
  }
}

/** A header's back button: the previous screen, or Home when the screen was opened directly (a deep link). */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace(TAB_PATHS.home);
}
