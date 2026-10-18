/**
 * The way from a finished game to its results (Moshe's device test of 1.0.0, 15.10.2026: "הוא סיים את המשחק
 * באמצע, קיבלתי מסך שחור. לפעמים גם קיבלתי מסך שחור כשאני פרשתי"). Settings, so a change is one line
 * (CLAUDE.md). The full board keeps its own hold (motion.md `last.cell`, screens/game/model.ts).
 */
export const gameEndConfig = {
  /**
   * An online game that ends before its board is full (a surrender, mine or the opponent's; an abandonment
   * seen on return) holds its final board this long before the results replace it (motion.md `game.end`), so
   * the end's own frames (its events, then the solution) have landed and the fades it started have run, and
   * the navigation never runs inside the server's message. Reduced motion: the 200 ms fade
   * (motion.duration.reducedFade).
   */
  onlineHoldMs: 600,
  /**
   * The results did not replace the game this long after they were asked for (a navigation that was lost):
   * the game screen shows a way on ("לתוצאות", "לבית") and reports it (Crashlytics, non-fatal).
   */
  resultsWatchdogMs: 4_000,
  /**
   * A screen with nothing to draw (a route without its game or search, a game without my seat) shows a
   * spinner first, then, after this long, a way out (screens/FlowFallback.tsx), and reports it.
   */
  fallbackActionsMs: 1_500,
} as const;

export type GameEndConfig = typeof gameEndConfig;
