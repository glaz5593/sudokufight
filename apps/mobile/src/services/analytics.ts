import type { TelemetryEventName, TelemetryProps } from '@sudoku-fight/protocol';

import { telemetry } from './telemetry';

/**
 * Analytics (spec §22). One entry point for every event: it goes to our server (spec §27.1, through the
 * offline queue in services/telemetry), and stage 14 adds Firebase Analytics here. In development it is also
 * written to the console.
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
}
