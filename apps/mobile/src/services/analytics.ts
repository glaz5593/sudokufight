import type { TelemetryEventName, TelemetryProps } from '@sudoku-fight/protocol';

import { firebaseAnalytics } from './firebaseAnalytics';
import { telemetry } from './telemetry';

/**
 * Analytics (spec §22). One entry point for every event, which goes to two places, each on its own:
 * - our server (spec §27.1), through the offline queue in services/telemetry, exactly as before;
 * - Firebase Analytics (work plan stage 14, services/firebaseAnalytics.ts), in builds with Firebase, under
 *   GA4's rules and without personal data.
 * In development it is also written to the console.
 */
export type AnalyticsEventName = TelemetryEventName;
/** Flat values only (strings, numbers, booleans, null), at most 2 KB of JSON. */
export type AnalyticsProps = TelemetryProps;

/** Records an event. Never throws and never waits, so it is safe anywhere in the UI. */
export function track(name: AnalyticsEventName, props: AnalyticsProps = {}): void {
  try {
    if (__DEV__) console.log(`[analytics] ${name}`, props);
    telemetry().track(name, props);
  } catch (error) {
    // Analytics must never break the app.
    if (__DEV__) console.log(`[analytics] could not record ${name}`, error);
  }
  // Apart, so neither one failing keeps the event from the other.
  try {
    firebaseAnalytics().log(name, props);
  } catch (error) {
    if (__DEV__) console.log(`[analytics] could not log ${name} to Firebase`, error);
  }
}
