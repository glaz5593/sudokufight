import type { TelemetryEventName, TelemetryProps } from '@sudoku-fight/protocol';

/**
 * Google Analytics 4's rules, for the events track() also logs to Firebase Analytics (work plan stage 14).
 * Pure: an event as track() takes it in, what GA4 accepts out, or null to log nothing there (our server still
 * gets the event, unchanged: services/telemetry).
 *
 * - Names (events and parameters): a letter first, then letters, digits and `_`, at most 40 characters, and
 *   not one of GA4's reserved names or prefixes. The protocol's keys are camelCase (`durationSec`); GA4's
 *   reports use snake_case (`duration_sec`).
 * - At most 25 parameters an event. Strings at most 100 characters (cut), numbers finite, booleans as
 *   'true'/'false', null left out.
 * - No personal data, ever. Our events carry none (spec §27.1); this is the guard should one ever do: a key
 *   that names a person, a secret or an id is dropped, and so is a string that looks like an email address,
 *   a token or a UUID.
 */

export const GA4_LIMITS = { name: 40, params: 25, value: 100 } as const;

export type Ga4Params = Record<string, string | number>;

export interface Ga4Event {
  name: string;
  params: Ga4Params;
}

export interface Ga4ScreenView {
  screen_name: string;
  screen_class: string;
}

/** Event names GA4 keeps for itself (logging one is refused). */
const RESERVED_EVENTS = new Set([
  'ad_activeview',
  'ad_click',
  'ad_exposure',
  'ad_impression',
  'ad_query',
  'ad_reward',
  'adunit_exposure',
  'app_background',
  'app_clear_data',
  'app_exception',
  'app_remove',
  'app_store_refund',
  'app_store_subscription_cancel',
  'app_store_subscription_convert',
  'app_store_subscription_renew',
  'app_uninstall',
  'app_update',
  'app_upgrade',
  'dynamic_link_app_open',
  'dynamic_link_app_update',
  'dynamic_link_first_open',
  'error',
  'first_open',
  'first_visit',
  'in_app_purchase',
  'notification_dismiss',
  'notification_foreground',
  'notification_open',
  'notification_receive',
  'os_update',
  'session_start',
  'session_start_with_rollout',
  'user_engagement',
]);
const RESERVED_PREFIXES = ['firebase_', 'google_', 'ga_'];

/**
 * Keys that would name a person, a secret, or one game or player (`playerId`, `gameId`): never sent to Google.
 * (`players`, a count, is fine.)
 */
const PERSONAL_KEY = /mail|name|user|uid|token|password|secret|phone|address|^ip$|install|device|id$|ids$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const TOKEN = /\b(?:Bearer\s|dev:)|\beyJ[\w-]+\.[\w-]+/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** A name as GA4 takes it (snake_case, a letter first, at most 40 characters), or null. */
export function ga4Name(raw: string): string | null {
  const name = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, GA4_LIMITS.name)
    .replace(/_+$/, '');
  if (name === '' || RESERVED_PREFIXES.some((p) => name.startsWith(p))) return null;
  return name;
}

const looksPersonal = (value: string) => EMAIL.test(value) || TOKEN.test(value) || UUID.test(value);

/** A parameter's value as GA4 takes it, or undefined to leave it out. */
function ga4Value(value: TelemetryProps[string]): string | number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (looksPersonal(value)) return undefined;
  return value.slice(0, GA4_LIMITS.value);
}

/** The event GA4 is given for track(name, props), or null (an invalid or reserved name). */
export function ga4Event(name: TelemetryEventName, props: TelemetryProps = {}): Ga4Event | null {
  const eventName = ga4Name(name);
  if (eventName === null || RESERVED_EVENTS.has(eventName)) return null;
  const params: Ga4Params = {};
  let count = 0;
  for (const [key, raw] of Object.entries(props)) {
    if (count === GA4_LIMITS.params) break;
    if (PERSONAL_KEY.test(key)) continue;
    const paramName = ga4Name(key);
    const value = ga4Value(raw);
    if (paramName === null || value === undefined || paramName in params) continue;
    params[paramName] = value;
    count++;
  }
  return { name: eventName, params };
}

/**
 * The screen GA4 is told about for `screen_view { screen }` (spec §27.1): the route's pattern ('/results/[id]',
 * services/telemetry/screens.ts), as both the screen's name and class. Null when there is no screen to name.
 */
export function ga4ScreenView(props: TelemetryProps = {}): Ga4ScreenView | null {
  const screen = props.screen;
  if (typeof screen !== 'string' || screen === '' || looksPersonal(screen)) return null;
  const name = screen.slice(0, GA4_LIMITS.value);
  return { screen_name: name, screen_class: name };
}
