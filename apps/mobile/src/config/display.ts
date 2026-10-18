/**
 * The phone's screen while the app is open (spec §22). A setting, so a change is one line (CLAUDE.md).
 */
export const displayConfig = {
  /**
   * Moshe's device test of 1.0.0 (15.10.2026): "האפליקציה צריכה לשמור על מסך דלוק". While the app is open (in
   * the foreground) the screen never turns off, on every screen: the menus, a search, a game, a replay
   * (services/keepAwake.ts, from the root layout). In the background the phone sleeps as usual. False: the
   * phone's own screen timeout. No switch in the settings for now.
   */
  keepScreenOn: true,
} as const;

export type DisplayConfig = typeof displayConfig;
