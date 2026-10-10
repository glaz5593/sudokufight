import {
  MAX_BATCH_BYTES,
  MAX_EVENTS_PER_BATCH,
  MAX_PROPS_BYTES,
  PLATFORMS,
  type Platform,
  TELEMETRY_EVENT_NAMES,
  type TelemetryBatch,
  type TelemetryEvent,
  type TelemetryEventName,
  type TelemetryProps,
} from '@sudoku-fight/protocol';

import { isUuid } from './uuid';

/**
 * Usage events, made to fit the protocol's contract for `POST /v1/events` (spec §27.2) before they are queued
 * and again before they are sent: one bad event would make the server refuse its whole batch (400), so a bad
 * event is fixed or left out, never sent. Pure: no React Native or Expo imports, so the server's tests can
 * check these batches against its own schema.
 */

/** The server's limit on a prop's key (MAX_PROP_KEY_LENGTH in apps/server/src/telemetry/schema.ts). */
export const MAX_PROP_KEY_LENGTH = 64;
/**
 * The server refuses events from before this (its MIN_EVENT_TIME): such a time means the phone's clock is
 * wrong. They are left out here, or they would take their batch down with them.
 */
export const MIN_EVENT_TIME = Date.UTC(2024, 0, 1);
const APP_VERSION = /^[\x20-\x7e]{1,32}$/;
/** Props too big are cut down string by string, never below this many characters. */
const MIN_TRIMMED_STRING = 32;
const ELLIPSIS = '…';
const HIGH_SURROGATE_AT_END = /[\uD800-\uDBFF]$/;

/** What every batch from this install says about itself. */
export interface BatchMeta {
  installId: string;
  platform: Platform;
  appVersion: string;
}

export interface BatchLimits {
  maxEvents: number;
  maxBytes: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = {
  maxEvents: MAX_EVENTS_PER_BATCH,
  maxBytes: MAX_BATCH_BYTES,
};

// ---------------------------------------------------------------------------------------------------------
// Sizes

/** The UTF-8 size of the character at `s[i]`: 4 for a surrogate pair (two UTF-16 units), else 1–3. */
function charBytes(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) return 4;
  return 3;
}

/** The length of `s` in UTF-8 bytes (what the server measures), without TextEncoder or Buffer. */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length;) {
    const size = charBytes(s, i);
    bytes += size;
    i += size === 4 ? 2 : 1;
  }
  return bytes;
}

/** The longest start of `s` within `maxBytes` of UTF-8, never half a surrogate pair. */
function prefixWithin(s: string, maxBytes: number): string {
  let bytes = 0;
  let i = 0;
  while (i < s.length) {
    const size = charBytes(s, i);
    if (bytes + size > maxBytes) break;
    bytes += size;
    i += size === 4 ? 2 : 1;
  }
  return s.slice(0, i);
}

/** The size of `value` as JSON, in UTF-8 bytes. */
export const jsonBytes = (value: unknown): number => utf8Length(JSON.stringify(value) ?? '');

// ---------------------------------------------------------------------------------------------------------
// Names, versions, platforms

export function isTelemetryEventName(name: unknown): name is TelemetryEventName {
  return typeof name === 'string' && (TELEMETRY_EVENT_NAMES as readonly string[]).includes(name);
}

export function platformOf(os: string): Platform | null {
  return (PLATFORMS as readonly string[]).includes(os) ? (os as Platform) : null;
}

/** The app's version as the server takes it: 1–32 printable ASCII characters ("0.0.0" when unknown). */
export function cleanAppVersion(version: unknown): string {
  const printable = typeof version === 'string' ? version.replace(/[^\x20-\x7e]/g, '').trim() : '';
  return printable.slice(0, 32) || '0.0.0';
}

// ---------------------------------------------------------------------------------------------------------
// Props and events

type FlatValue = string | number | boolean | null;

/** A flat value as is (a number that is not finite becomes null, as JSON would); anything else: undefined. */
function flatValue(value: unknown): FlatValue | undefined {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    default:
      return value === null ? null : undefined;
  }
}

/**
 * `s` shorter by about `over` bytes, an ellipsis included, but no shorter than MIN_TRIMMED_STRING characters.
 * Always shorter than `s` when `s` is longer than that and the ellipsis.
 */
function cut(s: string, over: number): string {
  let kept = prefixWithin(s, utf8Length(s) - over - utf8Length(ELLIPSIS));
  if (kept.length < MIN_TRIMMED_STRING) {
    kept = s.slice(0, MIN_TRIMMED_STRING);
    if (HIGH_SURROGATE_AT_END.test(kept)) kept = kept.slice(0, -1);
  }
  return kept + ELLIPSIS;
}

/**
 * Props the server takes: an object of flat values (strings, numbers, booleans, null), keys of 1–64
 * characters, at most MAX_PROPS_BYTES of JSON. Other values and keys are left out. Too big: the longest
 * strings are cut (with "…") until it fits. Still too big (too many keys): null, and the event is left out.
 */
export function sanitizeProps(input: unknown): TelemetryProps | null {
  const props: TelemetryProps = {};
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input)) {
      if (key.length === 0 || key.length > MAX_PROP_KEY_LENGTH || key === '__proto__') continue;
      const flat = flatValue(value);
      if (flat !== undefined) props[key] = flat;
    }
  }
  let over = jsonBytes(props) - MAX_PROPS_BYTES;
  while (over > 0) {
    let longest: string | null = null;
    for (const [key, value] of Object.entries(props)) {
      // A string of MIN_TRIMMED_STRING characters and an ellipsis can't get any shorter.
      if (typeof value !== 'string' || value.length <= MIN_TRIMMED_STRING + ELLIPSIS.length) continue;
      if (longest === null || value.length > (props[longest] as string).length) longest = key;
    }
    if (longest === null) return null;
    // Escapes in the JSON ("\n" is two bytes there) may leave it a little over: then another round.
    props[longest] = cut(props[longest] as string, over);
    over = jsonBytes(props) - MAX_PROPS_BYTES;
  }
  return props;
}

/**
 * An event as the server takes it, or null when it can't be made so: a UUID id, a known name, props that fit
 * (see sanitizeProps) and a time in integer epoch ms, not before 2024.
 */
export function sanitizeEvent(input: unknown): TelemetryEvent | null {
  if (typeof input !== 'object' || input === null) return null;
  const { id, name, props, t } = input as Record<string, unknown>;
  if (!isUuid(id) || !isTelemetryEventName(name)) return null;
  if (typeof t !== 'number' || !Number.isFinite(t)) return null;
  const time = Math.round(t);
  if (time < MIN_EVENT_TIME) return null;
  const clean = sanitizeProps(props ?? {});
  if (clean === null) return null;
  return { id, name, props: clean, t: time };
}

// ---------------------------------------------------------------------------------------------------------
// Batches

export interface BuiltBatches {
  /** In queue order; each within MAX_EVENTS_PER_BATCH events and MAX_BATCH_BYTES of JSON. */
  batches: TelemetryBatch[];
  /** Ids of events that can't be sent as they are, nor fixed: the queue drops them. */
  rejected: string[];
}

/**
 * Splits `events` (oldest first) into batches the server takes: by count (MAX_EVENTS_PER_BATCH) and by the
 * size of the request body (MAX_BATCH_BYTES), every event checked again (it may have waited on the phone
 * since an older version of the app). Throws when `meta` itself is wrong (no batch could pass).
 */
export function buildBatches(
  events: readonly TelemetryEvent[],
  meta: BatchMeta,
  limits: BatchLimits = DEFAULT_BATCH_LIMITS,
): BuiltBatches {
  if (!isUuid(meta.installId)) throw new Error('telemetry: the install id is not a UUID');
  if (platformOf(meta.platform) === null) throw new Error(`telemetry: unknown platform ${meta.platform}`);
  if (!APP_VERSION.test(meta.appVersion))
    throw new Error('telemetry: the app version is not 1–32 characters');
  const head = {
    installId: meta.installId.toLowerCase(),
    platform: meta.platform,
    appVersion: meta.appVersion,
  };
  // `{"installId":…,"appVersion":…,"events":[]}`: each event adds its JSON, and a comma after the first.
  const envelope = jsonBytes({ ...head, events: [] });

  const batches: TelemetryBatch[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let current: TelemetryEvent[] = [];
  let bytes = envelope;
  for (const input of events) {
    const event = sanitizeEvent(input);
    if (event === null) {
      rejected.push(input.id);
      continue;
    }
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const size = jsonBytes(event);
    if (envelope + size > limits.maxBytes) {
      rejected.push(event.id);
      continue;
    }
    // A full batch goes; the event starts the next one (where it fits: checked above).
    if (current.length > 0 && (current.length >= limits.maxEvents || bytes + 1 + size > limits.maxBytes)) {
      batches.push({ ...head, events: current });
      current = [];
      bytes = envelope;
    }
    bytes += (current.length > 0 ? 1 : 0) + size;
    current.push(event);
  }
  if (current.length > 0) batches.push({ ...head, events: current });
  return { batches, rejected };
}
