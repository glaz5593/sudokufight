/**
 * Usage reporting from the app to our server (spec §27.1, §27.2): `POST /v1/events`.
 *
 * - Every install gets a random `installId` on first launch, so it counts even without an account.
 * - Events wait in a queue on the phone and go out in batches when there is a connection. Each event has its
 *   own id, so a batch that is sent twice (a retry after a lost answer) is stored once.
 * - Who the user is comes only from a verified Firebase ID token in the Authorization header (stage 8),
 *   never from the body.
 */

export const TELEMETRY_PATH = '/v1/events';

/** At most this many events in one batch. */
export const MAX_EVENTS_PER_BATCH = 100;
/** At most this many bytes of JSON in one event's props. */
export const MAX_PROPS_BYTES = 2048;
/**
 * At most this many bytes of JSON in one request body. 100 events with full props would pass it, so the app
 * splits a batch by size as well as by count.
 */
export const MAX_BATCH_BYTES = 64 * 1024;

export const PLATFORMS = ['ios', 'android', 'web'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * The events the app reports: spec §22's analytics list, plus `screen_view` (§27.1).
 * The server rejects any other name, so a typo can't fill the table with junk.
 */
export const TELEMETRY_EVENT_NAMES = [
  'app_open',
  'screen_view',
  'register_step',
  'register_complete',
  'game_start',
  'game_end',
  'interference_sent',
  'reaction_sent',
  'matchmaking_wait',
  'reconnect',
  'latency_sample',
  'replay_open',
  'account_delete',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

/** Flat values only; keys up to 64 characters, at most MAX_PROPS_BYTES of JSON in all. */
export type TelemetryProps = Record<string, string | number | boolean | null>;

export interface TelemetryEvent {
  /** A UUID made on the phone; the server ignores an id it already has. */
  id: string;
  name: TelemetryEventName;
  props: TelemetryProps;
  /**
   * The phone's clock, epoch ms (an integer), when it happened. Before 2024, or more than a day ahead of the
   * server's clock, is refused.
   */
  t: number;
}

export interface TelemetryBatch {
  /** A UUID made on first launch and kept on the phone. */
  installId: string;
  platform: Platform;
  /** The app's version, e.g. "0.1.0" (1–32 printable characters). */
  appVersion: string;
  events: TelemetryEvent[];
}

/**
 * The answers to `POST /v1/events`:
 * - 202 TelemetryResponse: stored; drop the batch from the queue.
 * - 400 / 413 TelemetryError: malformed or too big; sending it again won't help, so drop it.
 * - 429 TelemetryError: too many batches; keep it and wait `Retry-After` seconds.
 * - 5xx or no answer: keep it and try again later.
 */
export interface TelemetryResponse {
  /** New events stored. */
  accepted: number;
  /** Events already stored (same id). */
  duplicates: number;
}

export interface TelemetryError {
  error: 'badRequest' | 'tooLarge' | 'tooManyRequests' | 'internal';
  /** For 400: what was wrong, e.g. "events.3.name: Invalid option…". */
  message?: string;
}
